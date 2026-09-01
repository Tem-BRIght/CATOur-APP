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
import { CATOUR_APP_GUIDE } from './catourAppGuide';

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

// Lightweight intent detection so we can hand ALI real numbers and verified details
// instead of letting the model guess or hallucinate them.
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

const SAFETY_ETIQUETTE_INTENT =
  /\b(safe|safety|scam|scams|dress code|etiquette|custom|customs|bawal|rules|guidelines|night|danger|safe to walk|ingat)\b/i;

const LOGISTICS_INTENT =
  /\b(fee|entrance|admission|ticket|price|magkano|bayad|hours|opening hours|schedule|oras|restroom|toilet|cr|comfort room|parking)\b/i;

const FOOD_INTENT =
  /\b(food|eat|restaurant|kainan|cafe|dining|coffee|street food|snack|merienda|dinner|lunch|breakfast|kain|bakery|panaderya)\b/i;

const BIKING_INTENT =
  /\b(bike|biking|bicycle|bike lane|bike route|cycling|cyclist|padyak|siklista)\b/i;

const RESTING_PARK_INTENT =
  /\b(rest|resting|bench|sit|chill|relax|park|parks|plaza|plazas|picnic|tambay|pahinga|upuan)\b/i;

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
You are ALI, the official AI Tour Guide for the CATOUR app in Pasig City, Philippines.
You assist signed-in tourists who are actively exploring destinations in Pasig City.

${CATOUR_APP_GUIDE}

Response Style:
- Always answer in complete, well-formed sentences. Never send sentence fragments or placeholder text.
- Respond immediately and directly — lead with the answer first, then add context. Don't preface with filler like "Let me think" or "I'll look that up."
- Keep responses short and readable: 2–4 sentences for simple questions, up to a short paragraph for directions or historical context. Tourists are reading this on mobile outdoors.
- Use a warm, friendly, knowledgeable local-guide tone — like a helpful local resident who knows the city inside out.
- Avoid jargon; assume the tourist may not speak Tagalog fluently or know local customs.
- Match the tourist's language style (English, Tagalog, or a natural Taglish mix).

Formatting for Lists & Recommendations (Text Display & Readability):
- When a response includes multiple items (recommendations, spots to visit, steps, or options of 3 or more items):
  - NEVER run items together in a single paragraph with inline numbers (e.g. NEVER write "1) Spot A, 2) Spot B, 3) Spot C").
  - Start with a short intro sentence, then break into a new line — don't continue the numbered items on the same line as the intro.
  - Put EACH numbered item on its OWN line, formatted strictly as:
    1. **[Name/Title]** – [short description].
    2. **[Name/Title]** – [short description].
  - Keep the number, title, and dash style (" – ") consistently structured across all items.
  - Keep each item's description short — one sentence, under 20 words — so the list stays scannable rather than dense.

Knowledge Scope & Broad Coverage:
- Do not limit answers to only the curated list of tourist spots in the primary database. Also discuss and recommend food spots (e.g., Kapitolyo dining district, Caruncho Ave night food stalls, Pasig Mega Market specialties), resting spots (parks, benches, plazas like Plaza Rizal, Rainforest Adventure Park lawns, Capitol Commons park, Ortigas Park, Pasig River Esplanade), and biking-friendly routes/spots (e.g., Emerald Avenue car-free Sundays, CATO bike lanes, linear parks) when asked.
- If asked about a category or spot with limited data (e.g., local bakeries, specific barangay landmarks): acknowledge the gap politely, offer the closest relevant known spots or area context, and suggest how they can find more (e.g., "I don't have confirmed details on that specific bakery yet, but you can find great local treats near Pasig Mega Market or Kapitolyo!"). Never give a flat dead-end refusal.

Location Accuracy (Critical):
- Always ground answers strictly in Pasig City, Philippines. Never answer with details or recommendations for another city (e.g. do NOT mix up details or describe Manila, Makati, Boracay, or Baguio).
- Before responding, confirm the place referenced is in Pasig City. If a spot name is ambiguous or outside Pasig City, say so explicitly rather than substituting unrelated location information.
- Never generate false historical or factual claims for places without data.

Depth & Usefulness of Answers:
- Avoid generic one-line descriptions. Where applicable, include practical, in-depth details:
  - What visitors can actually see or do there (not just what it is).
  - Best time to visit, and typical time needed.
  - Standout feature that makes it worth visiting versus similar spots.
- Help the tourist decide WHY to go, not just that it exists.

Handling Uncertainty:
- Replace flat refusals like "cannot confirm because no reliable source" with a helpful, specific response: explain what detail is unconfirmed (e.g. holiday operating hours, live menu pricing), suggest checking posted signs on-site or official sources, and pivot to verified nearby options.

Voice Input & Code-Switching Robustness:
- Account for speech-to-text pronunciation variations, Filipino/Taglish accents, and phonetic mismatches (e.g. "Dimas Alang", "Maybunga", "Bitukang Manok", "Bahay na Tisa", "Pizang Rizal"). If speech input is ambiguous or doesn't match any place, ask a short clarifying question (e.g. "Did you mean [closest match]?") rather than guessing unrelated information.

Output Format & Grounding:
- Output STRICT JSON only — no markdown outside JSON, no backticks:
  {"reply": "<what ALI says to the tourist>", "recommendedDestinationIds": ["id1", "id2"]}
  - "recommendedDestinationIds" must only contain valid IDs from AVAILABLE DESTINATIONS (at most ${MAX_RECOMMENDATIONS} IDs, best-match first).
  - Use an empty array [] when recommending general food strips, bike routes, or when no database card is needed.
- SUPPORT: If asked about app help, CATO, or office contacts, provide support@catour.app, (02) 8643-1111 loc 1156, Mon-Fri 9AM-5PM, Pasig City CATO Office, or Settings > Contact Support.
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
      const hoursPart = dd.hours ? ` | Hours: ${dd.hours}` : '';
      const admissionPart = dd.admission ? ` | Fee: ${dd.admission}` : '';
      const addressPart = dd.address ? ` | Addr: ${dd.address}` : '';
      return `- ID:${dest.id} | ${name} | ${category} | rating ${rating} (${reviews} reviews)${distancePart}${hoursPart}${admissionPart}${addressPart} | ${desc}`;
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

export function parseRouteIntent(
  message: string,
  destinations: Destination[],
): { originId?: string; destinationId?: string } | null {
  const text = message.trim();
  if (!text) return null;

  const lower = text.toLowerCase();
  const candidateNames = destinations
    .map(dest => {
      const value = dest as any;
      const title = typeof value.title === 'string' ? value.title : '';
      const name = typeof value.name === 'string' ? value.name : '';
      return { id: dest.id, title: title.trim(), name: name.trim() };
    })
    .filter(item => item.title || item.name)
    .sort((a, b) => (b.title.length + b.name.length) - (a.title.length + a.name.length));

  const findMatch = (): string | null => {
    for (const item of candidateNames) {
      const names = [item.title, item.name].filter(Boolean).map(value => value.toLowerCase());
      if (names.some(name => lower.includes(name))) {
        return item.id;
      }
    }
    return null;
  };

  const originId = (() => {
    const prefixMatch = lower.match(/(?:from|starting from|start from|begin from|leave from)\s+(.+?)(?:\s+to\s+|$)/i);
    if (prefixMatch?.[1]) {
      const phrase = prefixMatch[1].trim();
      for (const item of candidateNames) {
        const combined = [item.title, item.name].filter(Boolean).join(' ').toLowerCase();
        if (combined.includes(phrase) || phrase.includes(combined)) return item.id;
      }
    }
    return null;
  })();

  const destinationId = findMatch();
  if (!destinationId && !originId) return null;

  return {
    ...(originId ? { originId } : {}),
    ...(destinationId && destinationId !== originId ? { destinationId } : {}),
  };
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

function generateSmartLocalFallback(
  message: string,
  ranked: RankedDestination[],
  showRouteToId?: string
): AIGuideResponse {
  const topSpots = ranked.slice(0, 3);
  const topIds = topSpots.map(r => r.dest.id);

  // 1. Food intent
  if (FOOD_INTENT.test(message)) {
    return {
      reply: `Here are great food hubs to explore in Pasig City:

1. **Kapitolyo Dining Strip** – Renowned foodie hub with cozy artisan cafés, local grill houses, and craft eateries.
2. **Pasig Mega Market** – Famous for traditional Filipino street snacks, local kakanin, and fresh fruit stalls.
3. **Caruncho Avenue Food Stalls** – Great for quick evening bites, refreshing drinks, and budget-friendly merienda.`,
      recommendedDestinationIds: topIds.slice(0, 2),
      showRouteToId,
    };
  }

  // 2. Biking intent
  if (BIKING_INTENT.test(message)) {
    return {
      reply: `Here are top biking-friendly routes and spots in Pasig City:

1. **Emerald Avenue (Car-Free Sundays)** – Open, safe street for cycling, walking, and outdoor fitness.
2. **Pasig Linear Parks & CATO Bike Lanes** – Scenic riverside corridors connecting heritage spots with dedicated bike paths.
3. **Rainforest Adventure Park Trails** – Paved greenery loops ideal for casual pedaling and family rides.`,
      recommendedDestinationIds: topIds.slice(0, 2),
      showRouteToId,
    };
  }

  // 3. Resting / Parks intent
  if (RESTING_PARK_INTENT.test(message)) {
    return {
      reply: `Here are relaxing resting spots and open green parks in Pasig City:

1. **Plaza Rizal** – Shaded historic town square with benches right in front of the cathedral.
2. **Rainforest Adventure Park** – Sprawling public park with shaded picnic groves, a lagoon, and mini zoo.
3. **Capitol Commons Park** – Modern open lawn with shaded benches and breezy walking paths near cafés.`,
      recommendedDestinationIds: topIds.slice(0, 2),
      showRouteToId,
    };
  }

  if (MAP_INTENT.test(message)) {
    return {
      reply: showRouteToId
        ? 'I can show the route on the map. Tap "View route on map" below, or open Maps from the Home screen.'
        : 'Yes, CATOUR has a Maps button. From Home, tap the map or location button to open Maps, or tell me which Pasig destination you want a route to.',
      recommendedDestinationIds: showRouteToId ? [showRouteToId] : topIds,
      showRouteToId,
    };
  }

  // 4. Logistics / Hours / Fees
  if (LOGISTICS_INTENT.test(message)) {
    if (topSpots.length > 0) {
      const d = topSpots[0].dest as any;
      const title = d.title || d.name || 'this destination';
      const hours = d.hours || 'regular visiting hours';
      const fee = d.admission || 'free admission';
      return {
        reply: `${title} is located in Pasig City with ${fee} and is open during ${hours}. Feel free to check the details card below for full visitor guidelines.`,
        recommendedDestinationIds: [topSpots[0].dest.id],
        showRouteToId,
      };
    }
  }

  // 5. General / Best Spots / Recommendations
  if (topSpots.length > 0) {
    const listLines = topSpots.map((r, i) => {
      const dd = r.dest as any;
      const name = dd.title || dd.name || `Spot ${i + 1}`;
      const desc = dd.shortDescription || dd.desc || dd.category || 'Historical landmark and visitor favorite in Pasig.';
      return `${i + 1}. **${name}** – ${desc.slice(0, 80).trim()}.`;
    });

    return {
      reply: `Here are top must-see spots in Pasig City:\n\n${listLines.join('\n')}`,
      recommendedDestinationIds: topIds,
      showRouteToId,
    };
  }

  return {
    reply: "Welcome to Pasig City! I can help you find historic landmarks, great local food spots, and relaxing parks across the city. What would you like to explore today?",
    recommendedDestinationIds: [],
    showRouteToId,
  };
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
      contextLines.push('The tourist asked about a map but did not identify a destination. Tell them CATOUR can show maps: they can tap the map/location button on Home, or name a Pasig destination so you can show its route. Never say that CATOUR cannot show a map.');
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

  // If asking about logistics (fees/hours/restrooms) or safety/etiquette for a specific place
  if (LOGISTICS_INTENT.test(message) || SAFETY_ETIQUETTE_INTENT.test(message) || FOOD_INTENT.test(message) || BIKING_INTENT.test(message) || RESTING_PARK_INTENT.test(message)) {
    const candidate = findDestinationForQuestion(message, ranked, history);
    if (candidate) {
      const cd = candidate as any;
      const cName = cd.title || cd.name || 'this destination';
      const details: string[] = [`Verified details for ${cName}:`];
      if (cd.hours) details.push(`- Hours: ${cd.hours}`);
      if (cd.admission) details.push(`- Admission/Fee: ${cd.admission}`);
      if (cd.address) details.push(`- Address: ${cd.address}`);
      if (cd.suitableFor) details.push(`- Good for: ${cd.suitableFor}`);
      if (cd.whatToBring) details.push(`- What to bring/wear: ${cd.whatToBring}`);
      if (Array.isArray(cd.nearbyAttractions) && cd.nearbyAttractions.length) {
        details.push(`- Nearby spots: ${cd.nearbyAttractions.map((n: any) => n.name || n).join(', ')}`);
      }
      contextLines.push(details.join('\n'));
    }
  }

  const userPrompt = [
    `AVAILABLE DESTINATIONS (Pasig City only):\n${catalogText || '(none loaded)'}`,
    contextLines.length ? `CONTEXT:\n${contextLines.join('\n')}` : '',
    `TOURIST MESSAGE: ${message}`,
  ].filter(Boolean).join('\n\n');

  // Route through groqChat Cloud Function, with instant smart fallback
  try {
    const result = await callGroqChat({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.map(turn => ({ role: turn.role, content: turn.text })),
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.6,
      max_tokens: 600,
      top_p: 0.9,
    });

    const text = result.data.reply;
    if (!text) return generateSmartLocalFallback(message, ranked, showRouteToId);

    const parsed = safeParseAIGuideJSON(text, ranked);
    const requestedIds = getRequestedRecommendationIds(message, ranked);
    const response = requestedIds ? { ...parsed, recommendedDestinationIds: requestedIds } : parsed;
    return showRouteToId ? { ...response, showRouteToId } : response;
  } catch (err) {
    console.warn('[aiGuideService] askAIGuide fell back to local intelligence:', err);
    return generateSmartLocalFallback(message, ranked, showRouteToId);
  }
}
