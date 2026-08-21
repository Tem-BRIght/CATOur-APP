// src/services/proximityAIService.ts
// ─────────────────────────────────────────────────────────────────────────
// CHANGED: narration generation now calls the `groqChat` Cloud Function
// instead of fetching Groq directly — the API key no longer ships to the
// client. Geofencing, cooldown, and narration caching are all unchanged.
// ─────────────────────────────────────────────────────────────────────────

import { httpsCallable } from 'firebase/functions';
import { haversineKm } from './distance';
import { fetchDestinations } from './destinationService';
import { Destination } from '../types';
import { firestore, functions } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

// ── Config ────────────────────────────────────────────────────────────────────

export const DEFAULT_TRIGGER_RADIUS_M = 100;
const RETRIGGER_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours
const NARRATION_CACHE_MS = 24 * 60 * 60 * 1000; // 24 hours

// NEW — callable client for the groqChat Cloud Function (same shape as in
// aiService.ts — kept duplicated rather than shared to avoid a circular
// service dependency; feel free to hoist this into a tiny groqClient.ts if
// a third caller ever needs it).
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

export type TriggerSource = 'gps' | 'qr' | 'manual';

// ── Geofence-eligible destinations ───────────────────────────────────────────

export interface GeofenceDestination extends Destination {
  aiTriggerEnabled?: boolean;
  aiTriggerRadius?: number;
}

function getCoords(dest: Destination): { lat: number; lng: number } | null {
  const d = dest as any;
  const lat = d.location?.lat ?? d.locationCoords?.lat ?? d.lat ?? null;
  const lng = d.location?.lng ?? d.locationCoords?.lng ?? d.lng ?? null;
  return lat != null && lng != null ? { lat, lng } : null;
}

export async function getGeofenceDestinations(): Promise<GeofenceDestination[]> {
  const all = await fetchDestinations();
  return all.filter(d => {
    const dd = d as any;
    if (dd.aiTriggerEnabled === false) return false;
    if (dd.status === 'Temporarily Closed' || dd.status === 'draft') return false;
    return getCoords(d) !== null;
  }) as GeofenceDestination[];
}

export function findArrival(
  coords: { latitude: number; longitude: number },
  destinations: GeofenceDestination[],
): GeofenceDestination | null {
  let closest: GeofenceDestination | null = null;
  let closestKm = Infinity;

  for (const dest of destinations) {
    const dc = getCoords(dest);
    if (!dc) continue;

    const km = haversineKm(coords.latitude, coords.longitude, dc.lat, dc.lng);
    const radiusM = dest.aiTriggerRadius ?? DEFAULT_TRIGGER_RADIUS_M;

    if (km * 1000 <= radiusM && km < closestKm) {
      closest = dest;
      closestKm = km;
    }
  }

  return closest;
}

// ── Per-user cooldown (localStorage) ─────────────────────────────────────────

function cooldownKey(uid: string, destId: string) {
  return `proximityAI:cooldown:${uid}:${destId}`;
}

export function hasRecentlyTriggered(uid: string, destId: string): boolean {
  try {
    const raw = localStorage.getItem(cooldownKey(uid, destId));
    if (!raw) return false;
    const ts = parseInt(raw, 10);
    return Date.now() - ts < RETRIGGER_COOLDOWN_MS;
  } catch {
    return false;
  }
}

export function markTriggered(uid: string, destId: string): void {
  try {
    localStorage.setItem(cooldownKey(uid, destId), String(Date.now()));
  } catch {
    // localStorage unavailable — degrade gracefully
  }
}

// ── AI-generated narration ───────────────────────────────────────────────────

function narrationCacheKey(destId: string) {
  return `proximityAI:narration:${destId}`;
}

function readNarrationCache(destId: string): string | null {
  try {
    const raw = localStorage.getItem(narrationCacheKey(destId));
    if (!raw) return null;
    const { text, ts } = JSON.parse(raw);
    if (Date.now() - ts > NARRATION_CACHE_MS) return null;
    return text || null;
  } catch {
    return null;
  }
}

function writeNarrationCache(destId: string, text: string): void {
  try {
    localStorage.setItem(narrationCacheKey(destId), JSON.stringify({ text, ts: Date.now() }));
  } catch {
    // ignore
  }
}

function buildFactSheet(dest: Destination): string {
  const d = dest as any;
  const lines: string[] = [];
  const name = d.title || d.name;
  if (name) lines.push(`Name: ${name}`);
  if (d.category) lines.push(`Category: ${d.category}`);
  const desc = d.desc || d.description;
  if (desc) lines.push(`Description: ${desc}`);
  if (d.hours) lines.push(`Hours: ${d.hours}`);
  if (d.admission) lines.push(`Admission: ${d.admission}`);
  if (d.suitableFor) lines.push(`Good for: ${d.suitableFor}`);
  if (Array.isArray(d.goodFor) && d.goodFor.length) lines.push(`Tags: ${d.goodFor.join(', ')}`);
  if (d.address) lines.push(`Address: ${d.address}`);
  return lines.join('\n');
}

/**
 * generateArrivalNarration
 * CHANGED: no more direct fetch() to Groq with an exposed key — routes
 * through the groqChat Cloud Function. Falls back to a templated sentence
 * if the call fails (network issue, function down, etc.), same as before.
 */
export async function generateArrivalNarration(
  dest: Destination,
  opts: { forceRefresh?: boolean } = {},
): Promise<string> {
  const name = (dest as any).title || (dest as any).name || 'this place';

  if (!opts.forceRefresh) {
    const cached = readNarrationCache(dest.id);
    if (cached) return cached;
  }

  const fallback = `Welcome to ${name}! I hope you enjoy your visit — feel free to open the AI Guide any time you have questions about this place.`;

  try {
    const systemPrompt =
      'You are a warm, knowledgeable local tour guide speaking OUT LOUD to a tourist who has just arrived ' +
      'at a destination. Greet them and share 2-4 short, natural spoken sentences about the place, using ONLY ' +
      'the facts provided below. Do not invent facts, prices, or hours that are not given. No markdown, no lists, ' +
      'no headings — plain spoken language only, as if welcoming them in person.';

    const userPrompt = `Facts about the destination:\n${buildFactSheet(dest)}`;

    const result = await callGroqChat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 180,
      top_p: 0.9,
    });

    const finalText = result.data.reply?.trim() || fallback;
    writeNarrationCache(dest.id, finalText);
    return finalText;
  } catch (err) {
    console.warn('[proximityAIService] generateArrivalNarration fell back:', err);
    return fallback;
  }
}

// ── Lightweight analytics (optional, non-blocking) ───────────────────────────

export type AIActivityAction = TriggerSource | 'generic' | 'askQuestion';

export interface AIActivityDestination {
  id: string;
  title?: string;
  name?: string;
}

export function logAIActivity(
  uid: string,
  action: AIActivityAction,
  dest?: Destination | AIActivityDestination,
  query?: string,
): void {
  try {
    addDoc(collection(firestore, 'aiProximityTriggers'), {
      uid,
      action,
      destinationId: dest?.id || null,
      destinationName: dest ? ((dest as any).title || (dest as any).name || '') : '',
      query: query?.trim() || null,
      createdAt: serverTimestamp(),
    }).catch(err => console.warn('[proximityAIService] logAIActivity failed:', err));
  } catch {
    // best-effort only
  }
}

export function logProximityTrigger(uid: string, dest: Destination, source: TriggerSource): void {
  logAIActivity(uid, source, dest);
}