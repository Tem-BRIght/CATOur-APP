// src/services/aiGuideService.ts
// ─────────────────────────────────────────────────────────────────────────
// Powers the chat-style "ALI" AI Guide screen (AIGuideChat.tsx).
// CHANGED: no longer calls Groq directly with an exposed API key. All chat
// completions now route through the `groqChat` Cloud Function (see
// functions/src/index.ts), which holds the real Groq key server-side and
// requires the caller to be signed in.
// ─────────────────────────────────────────────────────────────────────────

import {
  doc, getDoc, setDoc, collection, query, where, orderBy, limit, getDocs,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { firestore, functions } from '../firebase';
import { Destination } from '../types';
import { haversineKm } from './distance';
import { getWalkingRoute, describeRouteForPrompt } from './routingService';
import { getCurrentWeather, describeWeatherForPrompt } from './weatherService';

// ── Config ────────────────────────────────────────────────────────────────────

/** How many destinations we feed the model per turn — keeps the prompt small. */
const MAX_CATALOG_ITEMS = 25;
/** How many search terms / visited places we remember per user. */
const MAX_HISTORY_ITEMS = 10;
/** Cap on how many destinations the AI is allowed to recommend at once. */
const MAX_RECOMMENDATIONS = 5;

// NEW — callable client for the groqChat Cloud Function.
interface GroqChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
interface GroqChatRequest {
  messages: GroqChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
}
interface GroqChatResponse {
  reply: string;
}
const callGroqChat = httpsCallable<GroqChatRequest, GroqChatResponse>(functions, 'groqChat');

// Lightweight intent detection so we can hand ALI real numbers (actual
// walking distance/ETA, actual current weather) instead of letting the
// model guess/hallucinate them.
const DIRECTIONS_INTENT =
  /\b(direction|route|how (do|can|to) i get|how far|way to get|paano (ako )?(pumunta|makarating|makakarating)|papaano|paano po|saan (ang daan|papunta)|malayo ba|gaano kalayo)\b/i;

const FOLLOWUP_ROUTE_INTENT =
  /\b(going there|heading there|go there|take me there|route there|directions there)\b/i;

const MAP_INTENT =
  /\b(show|display|open|view|give)\s+(me\s+)?(a\s+)?map\b|\bmap\b/i;

const DESTINATIONS_INTENT =
  /\b(destination|destinations|place|places|spot|spots|attraction|attractions|where can i go)\b/i;

const WEATHER_INTENT =
  /\b(weather|forecast|climate|temperature|is it (raining|hot|cold)|panahon|ulan|umuulan|mainit ba|malamig ba|storm|bagyo)\b/i;

const RATING_INTENT =
  /\b(highest[- ]rated|best[- ]rated|top[- ]rated|most[- ]rated|highest ratings?|best ratings?|most ratings?|most reviews?)\b/i;

const VISITS_INTENT =
  /\b(most visited|most visits|top visited|most popular|popular places?|top destinations?)\b/i;

// ── Public types ──────────────────────────────────────────────────────────────

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AIGuideResponse {
  reply: string;
  recommendedDestinationIds: string[];
  showRouteToId?: string;
}

export interface AskAIGuideParams {
  uid: string;
  message: string;
  history?: ChatTurn[];
  destinations: Destination[];
  coords?: { latitude: number; longitude: number } | null;
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `
You are ALI, the official AI tour guide for the CATOUR app. You ONLY help tourists
discover and plan visits to places in Pasig City, Philippines.

Rules you must always follow:
1. SCOPE: Only ever discuss Pasig City tourism (destinations, culture, food, transport,
   getting-around tips within Pasig City). If the user asks about anything outside that
   scope (other cities, countries, or unrelated topics), politely decline and steer the
   conversation back to what you can help with in Pasig City. Never answer the
   off-topic question itself.
2. GROUNDING: Only recommend destinations that appear in the "AVAILABLE DESTINATIONS"
   list you're given below. Never invent a place, rating, or address that isn't there.
   If the CONTEXT section includes a "Current weather" line or a "Walking route" /
   "Straight-line distance" line, treat those as verified facts you may quote — never
   invent your own temperature, rain status, walking distance, or ETA. If no such line
   is present but the tourist asks about weather or directions, say you don't have that
   information right now rather than guessing a number.
3. PERSONALIZATION: If the tourist's recent searches or previously visited places are
   provided, use them to tailor suggestions (e.g. lean into the category they keep
   searching for), but don't mention "your data" explicitly — just be naturally helpful.
4. SPECIFICITY: If the user asks about something specific, or distances are provided,
   prioritize the closest relevant matches and say roughly how far they are.
5. POPULARITY: When the user asks for general recommendations ("what should I visit",
   "what's popular"), prefer destinations with higher rank/rating/review counts —
   these represent the most-visited spots in the app.
6. TONE: Professional, warm, and easy to understand. Avoid jargon. Keep replies
   concise — 2 to 3 sentences, unless the user asks for more detail.
7. LANGUAGE: Always reply in the same language style as the tourist's message —
   English, Tagalog, or a natural Taglish mix — matching their phrasing rather than
   defaulting to English. Write natural sentences and paragraphs by default; only
   use a numbered/bulleted list when you're actually listing several distinct
   places or steps.
8. OUTPUT FORMAT: Respond with STRICT JSON only — no markdown, no code fences, no
   commentary outside the JSON — matching exactly this shape:
   {"reply": "<what ALI says out loud to the user>", "recommendedDestinationIds": ["id1","id2"]}
   - "recommendedDestinationIds" must only contain IDs copied exactly from the
     AVAILABLE DESTINATIONS list.
   - Use at most ${MAX_RECOMMENDATIONS} IDs, ordered best-match first.
   - Use an empty array when no specific destination applies (e.g. a scope refusal,
     or a general question that doesn't need cards).
9. Help Center: If the tourist asks for help with the app itself (login, account, notifications, etc.),
    politely answer in a concise way, what system features are available, and refer them to the app's 
    Help Center for more details. Do not provide any personal account information or troubleshooting 
    steps that require access to the user's account.
10. SUPPORT: If the tourist asks about app support, contacting the Cultural Affair Tourism Office (CATO),
    or the Help Center, provide support@catour.app, (02) 8643-1111 loc 1156, Monday-Friday 9:00 AM-5:00 PM,
    and Pasig City CATO Office. Suggest Settings > Contact Support for more help.
  
`.trim();

// ── Destination ranking / catalog building ───────────────────────────────────

interface RankedDestination {
  dest: Destination;
  distanceKm: number | null;
  score: number;
}

function popularityScore(d: Destination): number {
  const dd = d as any;
  const rating  = Number(dd.rating) || 0;
  const reviews = Number(dd.reviews) || 0;
  const ranked  = dd.ranking != null ? 1 : 0;
  const featured = dd.featured ? 1 : 0;

  const reviewsScore = Math.min(Math.log10(reviews + 1) / 3, 1);
  const ratingScore  = rating / 5;

  return ratingScore * 0.4 + reviewsScore * 0.3 + ranked * 0.2 + featured * 0.1;
}

function getCoords(dest: Destination): { lat: number; lng: number } | null {
  const dd = dest as any;
  const lat = dd.location?.lat ?? dd.locationCoords?.lat ?? dd.lat ?? null;
  const lng = dd.location?.lng ?? dd.locationCoords?.lng ?? dd.lng ?? null;
  return lat != null && lng != null ? { lat, lng } : null;
}

function findDestinationForQuestion(
  message: string,
  ranked: RankedDestination[],
  history: ChatTurn[] = [],
): Destination | null {
  const searchableText = [
    message,
    ...history.slice().reverse().slice(0, 4).map(turn => turn.text),
  ].join(' ').toLowerCase();
  const churchTerms = /\b(church|cathedral|simbahan)\b/i.test(message);

  return ranked.find(({ dest }) => {
    const value = dest as any;
    const title = `${value.title || ''} ${value.name || ''}`.toLowerCase();
    const category = `${value.category || ''} ${(value.tags || []).join(' ')}`.toLowerCase();
    const names = [value.title, value.name].filter(Boolean).map((name: string) => name.toLowerCase());
    return (names.some((name: string) => name.length > 2 && searchableText.includes(name)))
      || (churchTerms && /church|cathedral|religious/.test(category));
  })?.dest ?? null;
}

export function rankDestinations(
  destinations: Destination[],
  coords?: { latitude: number; longitude: number } | null,
): RankedDestination[] {
  const openOnly = destinations.filter(
    d => (d as any).status !== 'draft' && (d as any).status !== 'Temporarily Closed',
  );

  const ranked: RankedDestination[] = openOnly.map(dest => {
    const dc = getCoords(dest);
    const distanceKm = coords && dc
      ? haversineKm(coords.latitude, coords.longitude, dc.lat, dc.lng)
      : null;
    return { dest, distanceKm, score: popularityScore(dest) };
  });

  if (coords) {
    ranked.forEach(r => {
      if (r.distanceKm != null) {
        const proximityBoost = Math.max(0, 1 - r.distanceKm / 10);
        r.score += proximityBoost * 0.15;
      }
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, MAX_CATALOG_ITEMS);
}

function buildCatalogText(ranked: RankedDestination[]): string {
  return ranked
    .map(({ dest, distanceKm }) => {
      const dd = dest as any;
      const name = dd.title || dd.name || 'Unnamed';
      const category = dd.category || 'general';
      const rating = dd.rating || 0;
      const reviews = dd.reviews || 0;
      const desc = (dd.desc || dd.description || '').slice(0, 140);
      const distancePart = distanceKm != null ? ` | ${distanceKm.toFixed(1)}km away` : '';
      return `- ID:${dest.id} | ${name} | ${category} | rating ${rating} (${reviews} reviews)${distancePart} | ${desc}`;
    })
    .join('\n');
}

function getRequestedRecommendationIds(message: string, ranked: RankedDestination[]): string[] | null {
  const wantsRatingOrder = RATING_INTENT.test(message);
  const wantsVisitOrder = VISITS_INTENT.test(message);
  if (!wantsRatingOrder && !wantsVisitOrder && !DESTINATIONS_INTENT.test(message)) return null;

  const ordered = [...ranked].sort((a, b) => {
    const aData = a.dest as any;
    const bData = b.dest as any;

    if (wantsRatingOrder) {
      return (Number(bData.rating) || 0) - (Number(aData.rating) || 0)
        || (Number(bData.reviews) || 0) - (Number(aData.reviews) || 0);
    }

    if (wantsVisitOrder) {
      const aRank = Number(aData.ranking ?? aData.mostVisitedRank);
      const bRank = Number(bData.ranking ?? bData.mostVisitedRank);
      if (Number.isFinite(aRank) && Number.isFinite(bRank) && aRank !== bRank) return aRank - bRank;
      if (Number.isFinite(aRank) !== Number.isFinite(bRank)) return Number.isFinite(aRank) ? -1 : 1;
    }

    return b.score - a.score;
  });

  return ordered.slice(0, MAX_RECOMMENDATIONS).map(({ dest }) => dest.id);
}

// ── Per-user history (searches + visited places) ─────────────────────────────

interface AIGuideHistory {
  recentSearches: string[];
  recentDestinationIds: string[];
}

const historyRef = (uid: string) => doc(firestore, 'aiGuideHistory', uid);

export async function getAIGuideHistory(uid: string): Promise<AIGuideHistory> {
  try {
    const snap = await getDoc(historyRef(uid));
    if (!snap.exists()) return { recentSearches: [], recentDestinationIds: [] };
    const data = snap.data();
    return {
      recentSearches: Array.isArray(data.recentSearches) ? data.recentSearches : [],
      recentDestinationIds: Array.isArray(data.recentDestinationIds) ? data.recentDestinationIds : [],
    };
  } catch (err) {
    console.warn('[aiGuideService] getAIGuideHistory failed:', err);
    return { recentSearches: [], recentDestinationIds: [] };
  }
}

function pushRecent(list: string[], value: string): string[] {
  const deduped = [value, ...list.filter(v => v !== value)];
  return deduped.slice(0, MAX_HISTORY_ITEMS);
}

export function recordSearchTerm(uid: string, term: string): void {
  const trimmed = term.trim();
  if (!uid || !trimmed) return;
  (async () => {
    try {
      const current = await getAIGuideHistory(uid);
      await setDoc(historyRef(uid), {
        recentSearches: pushRecent(current.recentSearches, trimmed),
        recentDestinationIds: current.recentDestinationIds,
      }, { merge: true });
    } catch (err) {
      console.warn('[aiGuideService] recordSearchTerm failed:', err);
    }
  })();
}

export function recordDestinationView(uid: string, destinationId: string): void {
  if (!uid || !destinationId) return;
  (async () => {
    try {
      const current = await getAIGuideHistory(uid);
      await setDoc(historyRef(uid), {
        recentSearches: current.recentSearches,
        recentDestinationIds: pushRecent(current.recentDestinationIds, destinationId),
      }, { merge: true });
    } catch (err) {
      console.warn('[aiGuideService] recordDestinationView failed:', err);
    }
  })();
}

async function getRecentConfirmedVisits(uid: string): Promise<string[]> {
  try {
    const snap = await getDocs(
      query(collection(firestore, 'visits'), where('uid', '==', uid), orderBy('createdAt', 'desc'), limit(10)),
    );
    return snap.docs.map(d => (d.data().destinationName || d.data().destinationId || '')).filter(Boolean);
  } catch {
    return [];
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

const FALLBACK_RESPONSE: AIGuideResponse = {
  reply: "I'm having a little trouble connecting right now. Could you try asking again in a moment? I'm happy to help you find great spots in Pasig City once I'm back online.",
  recommendedDestinationIds: [],
};

function safeParseAIGuideJSON(text: string, ranked: RankedDestination[]): AIGuideResponse {
  const validIds = new Set(ranked.map(r => r.dest.id));
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  const candidates = [cleaned, extractJsonCandidate(cleaned)]
    .filter((candidate, index, all): candidate is string => Boolean(candidate) && all.indexOf(candidate) === index);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { reply?: unknown; recommendedDestinationIds?: unknown };
      const reply = typeof parsed.reply === 'string' && parsed.reply.trim()
        ? parsed.reply.trim()
        : FALLBACK_RESPONSE.reply;
      const ids: string[] = Array.isArray(parsed.recommendedDestinationIds)
        ? parsed.recommendedDestinationIds.filter((id: unknown) => typeof id === 'string' && validIds.has(id))
        : [];
      return { reply, recommendedDestinationIds: ids.slice(0, MAX_RECOMMENDATIONS) };
    } catch {
      // Try the next candidate before falling back to a readable response.
    }
  }

  // A response can be cut off before the closing JSON brace. Keep the readable
  // reply instead of exposing the transport wrapper in the chat bubble.
  const replyMatch = cleaned.match(/"reply"\s*:\s*"((?:\\.|[^"\\])*)/s);
  if (replyMatch?.[1]) {
    try {
      return {
        reply: JSON.parse(`"${replyMatch[1]}"`),
        recommendedDestinationIds: [],
      };
    } catch {
      return {
        reply: replyMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim(),
        recommendedDestinationIds: [],
      };
    }
  }

  console.warn('[aiGuideService] failed to parse AI JSON, showing raw text:', text);
  return { reply: text.trim() || FALLBACK_RESPONSE.reply, recommendedDestinationIds: [] };
}

export interface NearbyAttraction { name: string; distance: string; icon?: string; }
export interface ItinerarySlot { time: string; activity: string; tip?: string; }
export interface ItineraryDay { day: number; theme: string; slots: ItinerarySlot[]; }

function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const cleaned = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const start = cleaned.search(/[\[{]/);
  if (start === -1) return null;

  const candidate = cleaned.slice(start);
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < candidate.length; i += 1) {
    const char = candidate[i];
    if (inString) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '[' || char === '{') {
      depth += 1;
      continue;
    }

    if (char === ']' || char === '}') {
      depth -= 1;
      if (depth === 0) {
        return candidate.slice(0, i + 1).trim();
      }
    }
  }

  return candidate.trim() || null;
}

export function parseItineraryResponse(raw: string | null | undefined): ItineraryDay[] {
  const text = String(raw ?? '').trim();
  if (!text) return [];

  const candidates: string[] = [];
  const direct = extractJsonCandidate(text);
  if (direct) candidates.push(direct);

  const fenced = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  if (fenced && !candidates.includes(fenced)) candidates.push(fenced);

  for (const candidate of candidates) {
    try {
      let parsed: unknown = JSON.parse(candidate);
      for (let depth = 0; depth < 2; depth += 1) {
        if (!parsed || typeof parsed !== 'object' || typeof (parsed as Record<string, unknown>).reply !== 'string') break;
        try {
          parsed = JSON.parse((parsed as Record<string, string>).reply);
        } catch {
          break;
        }
      }
      if (Array.isArray(parsed)) {
        return normalizeItineraryDays(parsed);
      }
      if (parsed && typeof parsed === 'object') {
        const container = parsed as Record<string, unknown>;
        const nested = Array.isArray(container.days)
          ? container.days
          : Array.isArray(container.itinerary)
            ? container.itinerary
            : Array.isArray(container.data)
              ? container.data
              : [];
        if (nested.length > 0) {
          return normalizeItineraryDays(nested);
        }
      }
    } catch {
      // Try a more forgiving extraction for trailing prose or extra wrappers.
    }
  }

  const looseMatch = text.match(/\[[\s\S]*\]/);
  if (looseMatch) {
    try {
      const parsed = JSON.parse(looseMatch[0]);
      if (Array.isArray(parsed)) return normalizeItineraryDays(parsed);
    } catch {
      // ignore and fall through
    }
  }

  return [];
}

function normalizeItineraryDays(value: unknown[]): ItineraryDay[] {
  return value.map((day, index) => {
    const item = (day && typeof day === 'object' ? day : {}) as Record<string, unknown>;
    const rawSlots = Array.isArray(item.slots)
      ? item.slots
      : Array.isArray(item.activities)
        ? item.activities
        : [];

    return {
      day: Number(item.day) || index + 1,
      theme: typeof item.theme === 'string' ? item.theme : '',
      slots: rawSlots.map((slot, slotIndex) => {
        if (typeof slot === 'string') {
          return { time: '', activity: slot };
        }
        const entry = (slot && typeof slot === 'object' ? slot : {}) as Record<string, unknown>;
        return {
          time: typeof entry.time === 'string' ? entry.time : `Activity ${slotIndex + 1}`,
          activity: typeof entry.activity === 'string'
            ? entry.activity
            : typeof entry.description === 'string'
              ? entry.description
              : '',
          tip: typeof entry.tip === 'string' ? entry.tip : undefined,
        };
      }).filter(slot => slot.activity.trim()),
    };
  }).filter(day => day.slots.length > 0);
}

function buildFallbackItinerary(dest: Destination): ItineraryDay[] {
  const data = dest as any;
  const name = dest.name || data.title || 'this destination';
  const description = dest.description || data.description || data.desc || '';
  const nearby = Array.isArray(data.nearbyAttractions) ? data.nearbyAttractions : [];
  const hours = data.hours || data.openingHours || '';
  const admission = data.admission || data.entranceFee || '';

  const slots: ItinerarySlot[] = [
    {
      time: '9:00 AM',
      activity: `Arrive at ${name} and take time to look around the main grounds.`,
      tip: hours ? `Check the destination hours before leaving: ${hours}.` : undefined,
    },
    {
      time: '10:30 AM',
      activity: description
        ? `Explore ${name} and learn more about it: ${description}`
        : `Explore ${name}, take photos, and enjoy the site's main features.`,
      tip: admission ? `Admission information: ${admission}.` : undefined,
    },
  ];

  if (nearby[0]?.name) {
    slots.push({
      time: '12:00 PM',
      activity: `Continue to the nearby attraction ${nearby[0].name}.`,
      tip: nearby[0].distance ? `It is listed as ${nearby[0].distance} away.` : undefined,
    });
  } else {
    slots.push({
      time: '12:00 PM',
      activity: `Take a break nearby and plan the next part of your Pasig City visit.`,
    });
  }

  return [{ day: 1, theme: `A visit to ${name}`, slots }];
}

export async function generateDestinationItinerary(dest: Destination): Promise<ItineraryDay[]> {
  const now = new Date();
  const localDate = now.toLocaleDateString();
  const localTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const d = dest as any;
  const genName    = dest.name    || d.title    || '';
  const genAddress = dest.address || (typeof d.location === 'string' ? d.location : '') || '';
  const genDesc    = dest.description || d.fullDescription || d.shortDescription || '';
  const contextParts: string[] = [
    `Destination: ${genName}`,
    `Current user local time: ${localDate} ${localTime}`,
    genAddress      ? `Address: ${genAddress}`                                : '',
    d.hours             ? `Opening hours: ${d.hours}`                          : '',
    d.admission         ? `Admission/fees: ${d.admission}`                     : '',
    d.visitDuration     ? `Suggested visit duration: ${d.visitDuration}`       : '',
    d.bestTimeToVisit   ? `Best time to visit: ${d.bestTimeToVisit}`           : '',
    d.whatToBring       ? `What to bring: ${d.whatToBring}`                      : '',
    d.suitableFor       ? `Suitable for: ${d.suitableFor}`                     : '',
    d.parking           ? `Parking: ${d.parking}`                              : '',
    genDesc             ? `Description: ${genDesc}`                            : '',
    (d.nearbyAttractions as NearbyAttraction[])?.length
      ? `Nearby attractions: ${(d.nearbyAttractions as NearbyAttraction[]).map(n => `${n.name} (${n.distance})`).join(', ')}`
      : '',
  ].filter(Boolean);

  const systemPrompt = `You are an expert local travel guide. Generate a detailed, practical day-by-day itinerary in valid JSON only — no markdown, no extra text.

Return an array of day objects. Each day has:
- "day": number (1, 2, ...)
- "theme": short evocative title for the day (e.g. "Arrival & First Impressions")
- "slots": array of time-slot objects, each with:
  - "time": time string like "9:00 AM"
  - "activity": what to do (1–2 sentences, specific and actionable)
  - "tip": optional insider tip (1 sentence)

Use the user local timestamp to set the itinerary start time. If the user asks in the morning, begin with morning activities; if afternoon, prioritize afternoon/evening; if evening, include night options or start early next day as appropriate.

Generate exactly 1 day (morning, afternoon, evening slots) unless the suggested visit duration implies multiple days. Tailor every slot to the destination's actual hours, admission, amenities, and nearby attractions. Be specific — name real features, use real times.

Respond ONLY with a valid JSON array, no markdown, no code fences.`;

  const userPrompt = `Create an itinerary for:\n${contextParts.join('\n')}\nRequested at: ${localDate} ${localTime}`;

  let raw = '[]';
  try {
    const result = await callGroqChat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 1200,
      top_p: 0.9,
    });
    raw = result.data.reply?.trim() || '[]';
  } catch (err) {
    console.warn('[aiGuideService] itinerary generation fell back:', err);
    return buildFallbackItinerary(dest);
  }

  const parsed = parseItineraryResponse(raw);
  if (parsed.length > 0) return parsed;

  return buildFallbackItinerary(dest);
}

export async function askAIGuide(params: AskAIGuideParams): Promise<AIGuideResponse> {
  const { uid, message, history = [], destinations, coords } = params;

  const ranked = rankDestinations(destinations, coords);
  const catalogText = buildCatalogText(ranked);

  const [guideHistory, confirmedVisits] = await Promise.all([
    getAIGuideHistory(uid),
    getRecentConfirmedVisits(uid),
  ]);

  const contextLines: string[] = [];
  if (guideHistory.recentSearches.length) {
    contextLines.push(`Tourist's recent searches: ${guideHistory.recentSearches.join(', ')}`);
  }
  if (confirmedVisits.length) {
    contextLines.push(`Places this tourist has actually visited before: ${confirmedVisits.join(', ')}`);
  }
  if (coords) {
    contextLines.push(`Tourist's current coordinates: ${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)} (distances above are already calculated from here).`);
  } else {
    contextLines.push('Tourist location is not available — do not claim to know how far anything is.');
  }

  let showRouteToId: string | undefined;
  if (DIRECTIONS_INTENT.test(message) || FOLLOWUP_ROUTE_INTENT.test(message) || MAP_INTENT.test(message)) {
    const isMapRequest = MAP_INTENT.test(message);
    const candidate = findDestinationForQuestion(message, ranked, history);
    const candidateCoords = candidate ? getCoords(candidate) : null;

    if (!coords && !isMapRequest) {
      contextLines.push('The tourist asked for directions, but their location is not available — ask them to enable location instead of guessing a distance.');
    } else if (candidate && candidateCoords) {
      // The destination map is useful even when the walking-route provider is unavailable.
      showRouteToId = candidate.id;
      if (coords) {
        try {
          const route = await getWalkingRoute(
            { lat: coords.latitude, lng: coords.longitude },
            candidateCoords,
          );
          const placeName = (candidate as any).title || (candidate as any).name || 'that place';
          contextLines.push(describeRouteForPrompt(route, placeName));
        } catch (err) {
          console.warn('[aiGuideService] direction lookup failed:', err);
          contextLines.push('Show the destination on a map, but do not claim a route, distance, or ETA because live route details are unavailable.');
        }
      } else {
        contextLines.push('Show the destination on a map, but do not claim a route, distance, or ETA because the tourist location is unavailable.');
        showRouteToId = candidate.id;
      }
    } else {
      contextLines.push('The tourist asked for directions or a map but did not identify a destination. Ask one short clarifying question; do not choose a place or show a route.');
    }
  }

  if (WEATHER_INTENT.test(message)) {
    const weather = coords
      ? await getCurrentWeather(coords.latitude, coords.longitude)
      : await getCurrentWeather();
    if (weather) {
      contextLines.push(describeWeatherForPrompt(weather));
    } else {
      contextLines.push('The tourist asked about the weather, but live weather data is unavailable right now — say so instead of guessing.');
    }
  }

  const userPrompt = [
    `AVAILABLE DESTINATIONS (Pasig City only):\n${catalogText || '(none loaded)'}`,
    contextLines.length ? `CONTEXT:\n${contextLines.join('\n')}` : '',
    `TOURIST MESSAGE: ${message}`,
  ].filter(Boolean).join('\n\n');

  // CHANGED — routes through the groqChat Cloud Function instead of
  // fetching Groq directly. No client-side API key check needed anymore;
  // the function itself decides whether it's configured.
  try {
    const result = await callGroqChat({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.map(turn => ({ role: turn.role, content: turn.text })),
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.6,
      max_tokens: 400,
      top_p: 0.9,
    });

    const text = result.data.reply;
    if (!text) return FALLBACK_RESPONSE;

    const parsed = safeParseAIGuideJSON(text, ranked);
    const requestedIds = getRequestedRecommendationIds(message, ranked);
    const response = requestedIds ? { ...parsed, recommendedDestinationIds: requestedIds } : parsed;
    return showRouteToId ? { ...response, showRouteToId } : response;
  } catch (err) {
    console.error('[aiGuideService] askAIGuide failed:', err);
    return FALLBACK_RESPONSE;
  }
}
