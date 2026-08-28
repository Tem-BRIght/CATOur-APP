// src/context/ProximityAIContext.tsx
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ Saved as Proximityaicontext.tsx (not ProximityAIContext.tsx) on purpose —
// ProximityAIOverlay.tsx imports it as '../../context/Proximityaicontext'.
// Android builds run on a case-sensitive filesystem, so the casing has to
// match exactly or the app will build fine on your Mac/Windows machine and
// then fail (or silently not resolve) in the APK. Keep this filename as-is,
// or rename BOTH the file and the import together.
//
// WHAT THIS DOES
// Watches the user's GPS position. When they walk within range of a place
// from getGeofenceDestinations(), it asks the AI for a short spoken narration
// about that place's history and speaks it — this is the "AI talking about
// the history of a destination" feature. ProximityAIOverlay.tsx only
// renders whatever state this file exposes; all the geofencing/AI/TTS logic
// lives here.
//
// Mount once, as a sibling of your router outlet:
//   <ProximityAIProvider>
//     <IonReactRouter>...</IonReactRouter>
//     <ProximityAIOverlay />
//   </ProximityAIProvider>
// ─────────────────────────────────────────────────────────────────────────────

import React, {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from 'react';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from './AuthContext';
import { useTextToSpeech } from '../hooks/useTextToSpeech';
import { Destination } from '../types';
import {
  getGeofenceDestinations,
  findArrival,
  hasRecentlyTriggered,
  markTriggered,
  generateArrivalNarration,
  logProximityTrigger,
  logAIActivity,
  isArrivalVelocityValid,
  GeofenceDestination,
  TriggerSource,
} from '../services/proximityAIService';
import { functions } from '../firebase';

// ─── Config ─────────────────────────────────────────────────────────────────
// NOTE: the destination catalog, geofence radius (per-destination
// `aiTriggerRadius`, admin-configurable), retrigger cooldown, narration
// caching, and analytics logging all now live in proximityAIService.ts —
// the same service proximityAIService.ts's own header comment describes as
// the shared "GPS geofence + QR check-in" entry point. This file only owns
// the GPS-watch loop, TTS playback, and the voice Q&A follow-up.

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

/**
 * A GPS fix is only trusted for geofencing if the device reports it's
 * accurate to within this many meters. Phones/browsers happily hand back
 * "fixes" from cell-tower or Wi-Fi positioning (accuracy of several hundred
 * meters to a few km) when GPS itself hasn't locked yet.
 */
const MAX_ACCEPTABLE_ACCURACY_METERS = 75;
/** How often we're willing to react to a new GPS fix */
const MIN_CHECK_INTERVAL_MS = 5000;

/** System prompt for follow-up questions asked by voice or tap once the tourist is there. */
function buildQASystemPrompt(dest: ProximityDestination): string {
  const facts: string[] = [`Destination: ${dest.title}`];
  if (dest.description) facts.push(`Background: ${dest.description}`);
  if (dest.category) facts.push(`Category: ${dest.category}`);
  if (dest.hours) facts.push(`Opening Hours: ${dest.hours}`);
  if (dest.address) facts.push(`Address: ${dest.address}`);

  return (
    'You are ALI, the official AI Tour Guide for the CATOUR app, speaking directly to a tourist standing in person at ' +
    `"${dest.title}" in Pasig City, Philippines.\n\n` +
    `Verified details:\n${facts.join('\n')}\n\n` +
    'Response Rules:\n' +
    '1. Answer immediately and directly — lead with the answer first, then add 1-2 sentences of helpful practical context (what to see/do, best time, standout feature).\n' +
    '2. Keep answers short: 1 to 3 natural spoken sentences. The tourist is listening out loud on their phone outdoors.\n' +
    '3. Tone: Warm, friendly, knowledgeable local guide who lives in Pasig City.\n' +
    '4. Knowledge Scope: Help with opening hours, fees, nearest food/restrooms, resting benches, bike paths, etiquette, or safety when asked.\n' +
    '5. Location Accuracy: Ground all details strictly in Pasig City, Philippines. Never mix up or substitute places from other cities.\n' +
    '6. Handling Uncertainty: Never give flat refusals. If a live price or holiday schedule is unconfirmed, state so politely and advise checking posted on-site signage or suggest nearby verified spots.\n' +
    '7. Voice Clarification: If speech input was unclear or sounds like a misheard landmark name, ask a quick clarifying question (e.g. "Did you mean [closest match]?").\n' +
    '8. Language: Match the tourist\'s language (English, Tagalog, or natural Taglish).\n' +
    '9. Format: Plain spoken sentences only. STRICTLY NO markdown, asterisks, bullet points, or headings.'
  );
}

function buildGenericQASystemPrompt(): string {
  return (
    'You are ALI, the warm and knowledgeable AI Tour Guide for the CATOUR app in Pasig City, Philippines.\n' +
    'You are speaking out loud to a tourist who is exploring Pasig City.\n\n' +
    'Response Rules:\n' +
    '1. Answer immediately and directly — lead with the answer first, then add 1-2 sentences of context.\n' +
    '2. Keep answers short: 1 to 3 natural spoken sentences.\n' +
    '3. Tone: Warm, friendly, knowledgeable local guide.\n' +
    '4. Knowledge Scope: Recommend tourist attractions, food spots (Kapitolyo, Mega Market), resting spots (Plaza Rizal, Rainforest Park, Capitol Commons), and bike-friendly routes (Emerald Ave, linear parks) in Pasig City.\n' +
    '5. Location Accuracy: Strictly ground in Pasig City, Philippines. Never discuss or mix up other cities.\n' +
    '6. Depth & Uncertainty: Highlight what visitors can see/do and why to visit. If data on a specific spot is limited, acknowledge it politely and pivot to the closest known options nearby.\n' +
    '7. Voice Clarification: If speech input was unclear, ask a quick clarifying question rather than guessing.\n' +
    '8. Language: Match the tourist\'s language (English, Tagalog, or Taglish).\n' +
    '9. Format: Plain spoken sentences only. STRICTLY NO markdown, asterisks, bullet points, or headings.'
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProximityStatus = 'idle' | 'loading' | 'speaking' | 'paused';

interface ProximityDestination {
  id: string;
  title: string;
  name?: string;
  image?: string;
  imageUrl?: string;
  description?: string;
  category?: string;
  hours?: string;
<<<<<<< HEAD
  admission?: string;
=======
>>>>>>> origin/main
  address?: string;
  lat: number;
  lng: number;
}

<<<<<<< HEAD
function generateProximityQAFallback(dest: ProximityDestination | null, question: string): string {
  const q = question.toLowerCase();
  if (!dest) {
    if (/food|eat|restaurant|kain|dining|snack/i.test(q)) {
      return "Pasig City has fantastic food spots like the Kapitolyo dining district, Caruncho Avenue night food stalls, and Pasig Mega Market specialties.";
    }
    if (/spot|place|visit|must|attraction|heritage/i.test(q)) {
      return "Some top must-visit spots in Pasig City include Pasig Cathedral, Bahay na Tisa, Rainforest Adventure Experience, and Plaza Rizal.";
    }
    if (/bike|cycling|route/i.test(q)) {
      return "For biking in Pasig, Emerald Avenue is popular for open-street Sundays, alongside the city's bike lanes and riverside paths.";
    }
    return "I am here to guide you around Pasig City! You can ask me about nearby landmarks, visiting hours, local food, or relaxing parks.";
  }

  const title = dest.title || 'this place';
  if (/hour|schedule|open|time|close|oras/i.test(q)) {
    return `${title} is open during ${dest.hours || 'regular visiting hours'}. Feel free to check with on-site staff for holiday schedules.`;
  }
  if (/fee|price|admission|ticket|cost|magkano|bayad/i.test(q)) {
    return `For ${title}, admission is listed as ${dest.admission || 'free or standard public access'}.`;
  }
  if (/where|address|location|saan|daan|direction|route/i.test(q)) {
    return `${title} is located at ${dest.address || 'Pasig City, Philippines'}.`;
  }
  if (/history|about|tell me|highlight|tip/i.test(q)) {
    return dest.description
      ? `${title} is a standout spot in Pasig City: ${dest.description}`
      : `Welcome to ${title}! It is one of the notable destinations here in Pasig City.`;
  }

  return dest.description
    ? `${title} in Pasig City: ${dest.description}`
    : `You are currently viewing ${title} in Pasig City. Feel free to ask about its hours, admission, or nearby spots.`;
}

=======
>>>>>>> origin/main
interface ProximityAIContextValue {
  status: ProximityStatus;
  destination: ProximityDestination | null;
  narration: string;
  dismiss: () => void;
  togglePause: () => void;
  /**
   * Manually fires the "AI Talking" flow without waiting for GPS to walk
   * into a geofence — used by the long-press test trigger on the Home FAB.
   * Ignores the retrigger cooldown so it always fires on demand.
   * Pass a destId to test a specific place, otherwise the first loaded
   * destination is used.
   * Returns false (and does nothing) if no eligible destination is loaded
   * yet — e.g. the geofence catalog is still fetching, or Firestore has no
   * destination with valid coordinates — so the caller can show its own
   * "nothing to test yet" feedback instead of the button silently doing
   * nothing.
   */
  triggerManual: (destId?: string) => boolean;
  triggerGeneric: () => boolean;
  triggerForDestination: (destination: Destination, source?: TriggerSource) => Promise<boolean>;
  isGenericMode: boolean;
  resolveDestinationFromText: (text: string) => ProximityDestination | null;

  // NEW — lets the tourist talk back to ALI about the current destination ---
  /** Send a spoken/typed question about the current destination to ALI. */
  askQuestion: (text: string) => Promise<void>;
  /** True while the overlay's mic is actively capturing audio. */
  isListening: boolean;
  /** Live partial transcript while listening (for the "Listening…" bubble). */
  liveTranscript: string;
  setListening: (listening: boolean) => void;
  setLiveTranscript: (text: string) => void;
}

const ProximityAIContext = createContext<ProximityAIContextValue | undefined>(undefined);

export function useProximityAI(): ProximityAIContextValue {
  const ctx = useContext(ProximityAIContext);
  if (!ctx) throw new Error('useProximityAI must be used within a ProximityAIProvider');
  return ctx;
}

/**
 * useProximityAIOptional
 * Same as useProximityAI but returns undefined instead of throwing when
 * there's no <ProximityAIProvider> above in the tree. Safe to call from
 * screens that may render before/without the provider being mounted.
 */
export function useProximityAIOptional(): ProximityAIContextValue | undefined {
  return useContext(ProximityAIContext);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * toProximityDestination
 * Maps a GeofenceDestination (proximityAIService's shape — has `location.lat/lng`,
 * `desc`/`description`, etc.) down to the flat ProximityDestination shape this
 * file's UI state and the overlay component expect.
 */
function toProximityDestination(dest: GeofenceDestination): ProximityDestination {
  const dd = dest as any;
  return {
    id:          dest.id,
    title:       dd.title || dd.name || 'this place',
    name:        dd.name,
    image:       dd.imageUrl || dd.image,
    imageUrl:    dd.imageUrl || dd.image,
    description: dd.desc || dd.description || '',
    category:    dd.category || '',
    hours:       dd.hours || '',
<<<<<<< HEAD
    admission:   dd.admission || dd.entranceFee || '',
=======
>>>>>>> origin/main
    address:     dd.address || '',
    lat:         dd.location?.lat ?? dd.locationCoords?.lat ?? dd.lat,
    lng:         dd.location?.lng ?? dd.locationCoords?.lng ?? dd.lng,
  };
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function resolveNamedDestinationFromText(
  text: string,
  destinations: GeofenceDestination[],
): GeofenceDestination | null {
  const normalizedText = normalizeText(text);
  if (!normalizedText) return null;

  const routeWords = /(show|open|view|take me|let me|go to|going to|heading to|route to|map me|show me|can you|could you|can u).*?(map|route|destination|place)|(going to|heading to|go to|route to|take me to|let me see the route)/i;
  if (!routeWords.test(text)) return null;

  let bestMatch: GeofenceDestination | null = null;
  let bestScore = 0;

  for (const dest of destinations) {
    const candidates = [dest.title, dest.name, dest.address, dest.category].filter(Boolean) as string[];
    for (const candidate of candidates) {
      const normalizedCandidate = normalizeText(candidate);
      if (!normalizedCandidate) continue;

      if (normalizedText.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedText)) {
        const score = normalizedCandidate.length;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = dest;
        }
      }

      const candidateTokens = normalizedCandidate.split(' ');
      const overlap = candidateTokens.filter(token => token.length > 2 && normalizedText.includes(token)).length;
      if (overlap > 0 && overlap > bestScore / 10) {
        bestScore = Math.max(bestScore, overlap * 10);
        bestMatch = dest;
      }
    }
  }

  return bestMatch;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export const ProximityAIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const uid = user?.uid || 'guest'; // proximityAIService's localStorage cooldown/cache keys are per-uid

  const [status, setStatus]             = useState<ProximityStatus>('idle');
  const [destination, setDestination]     = useState<ProximityDestination | null>(null);
  const [narration, setNarration]         = useState('');
  const [isGenericMode, setGenericMode]   = useState(false);
  const [isListening, setListening]       = useState(false); // NEW
  const [liveTranscript, setLiveTranscript] = useState('');   // NEW
  const [geofenceReady, setGeofenceReady] = useState(false);

  // Raw GeofenceDestination[] — kept in the richer shape proximityAIService's
  // findArrival/generateArrivalNarration/logProximityTrigger all expect
  // (location.lat/lng, desc, admission, aiTriggerRadius, etc.), separate from
  // the flattened ProximityDestination the overlay UI renders.
  const geofenceRef      = useRef<GeofenceDestination[]>([]);
  const activeIdRef      = useRef<string | null>(null);
  const lastCheckRef     = useRef<number>(0);
  const watchIdRef       = useRef<number | null>(null);
  const mountedRef       = useRef(true);

  // NEW — per-visit conversation history, so follow-up questions have context.
  // Reset whenever a new destination triggers or the overlay is dismissed.
  const conversationRef = useRef<{ role: 'user' | 'assistant'; content: string }[]>([]);

  const { speak, pause: pauseTTS, resume: resumeTTS, stop: stopTTS } = useTextToSpeech();

  // ── Load geofence-eligible destinations once ──────────────────────────────
  // getGeofenceDestinations() also filters out admin-disabled
  // (aiTriggerEnabled === false) and closed/draft destinations for us.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getGeofenceDestinations();
        if (!cancelled) {
          geofenceRef.current = data;
          setGeofenceReady(true);
        }
      } catch (err) {
        console.error('ProximityAI: failed to load destinations', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Trigger flow: loading -> speaking ───────────────────────────────────────
  // source is only passed for real geofence hits ('gps') so logProximityTrigger
  // analytics don't get skewed by manual "test AI Talking" taps.
  const runTrigger = useCallback(async (
    dest: Destination,
    source: TriggerSource | undefined,
    forceRefresh: boolean,
  ) => {
    const destId = dest.id;
    activeIdRef.current = destId;
    setGenericMode(false);
    conversationRef.current = [];
    setDestination(toProximityDestination(dest));
    setNarration('');
    setStatus('loading');

    const text = await generateArrivalNarration(dest, { forceRefresh });
    if (!mountedRef.current || activeIdRef.current !== destId) return false;

    conversationRef.current.push({ role: 'assistant', content: text });
    setNarration(text);
    setStatus('speaking');
    if (source) logProximityTrigger(uid, dest, source);

    speak(text, {
      lang: 'en-US',
      onEnd: () => {
        if (!mountedRef.current || activeIdRef.current !== destId) return;
        setStatus('paused');
      },
      onError: () => {
        if (!mountedRef.current || activeIdRef.current !== destId) return;
        setStatus('paused');
      },
    });

    return true;
  }, [speak, uid]);

  const triggerFor = useCallback(async (dest: GeofenceDestination, source?: TriggerSource) => {
    return runTrigger(dest, source, !source);
  }, [runTrigger]);

  const triggerForDestination = useCallback(async (
    dest: Destination,
    source: TriggerSource = 'qr',
  ) => {
    return runTrigger(dest, source, true);
  }, [runTrigger]);

  // ── GPS watch ────────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    if (!navigator.geolocation) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        const now = Date.now();
        if (now - lastCheckRef.current < MIN_CHECK_INTERVAL_MS) return;
        lastCheckRef.current = now;

        // Only look for a new trigger when nothing is currently active
        if (activeIdRef.current !== null) return;

        const { latitude, longitude, accuracy, speed } = pos.coords;

        // Ignore fixes while traveling at high vehicle speeds (> 60 km/h)
        if (!isArrivalVelocityValid(speed)) {
          return;
        }

        // Don't trust low-accuracy fixes (e.g. cell/Wi-Fi positioning while
        // GPS hasn't locked yet) for a geofence this tight — a fix reported
        // as accurate to only a few hundred meters can look like it's
        // "inside" a destination's radius even when the tourist is genuinely
        // far away.
        if (accuracy != null && accuracy > MAX_ACCEPTABLE_ACCURACY_METERS) {
          return;
        }

        const arrival = findArrival({ latitude, longitude }, geofenceRef.current);
        if (!arrival || hasRecentlyTriggered(uid, arrival.id)) return;

        triggerFor(arrival, 'gps');
      },
      err => console.warn('ProximityAI: geolocation error', err.message),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 }
    );

    return () => {
      mountedRef.current = false;
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      stopTTS();
    };
    // triggerFor is stable across the component's life (its own deps are stable refs/callbacks)
  }, [geofenceReady, triggerFor, stopTTS, uid]);

  // ── Public actions ───────────────────────────────────────────────────────

  const dismiss = useCallback(() => {
    const id = activeIdRef.current;
    stopTTS();
    setStatus('idle');
    setDestination(null);
    setNarration('');
    setGenericMode(false);
    setListening(false);       // NEW
    setLiveTranscript('');     // NEW
    conversationRef.current = []; // NEW
    activeIdRef.current = null;
    if (id) markTriggered(uid, id);
  }, [stopTTS, uid]);

  const togglePause = useCallback(() => {
    if (status === 'speaking') {
      pauseTTS();
      setStatus('paused');
    } else if (status === 'paused') {
      resumeTTS();
      setStatus('speaking');
    }
  }, [status, pauseTTS, resumeTTS]);

  const resolveDestinationFromText = useCallback((text: string): ProximityDestination | null => {
    const match = resolveNamedDestinationFromText(text, geofenceRef.current);
    return match ? toProximityDestination(match) : null;
  }, []);

  // NEW — conversation loop ---------------------------------------------
  /**
   * askQuestion — called by the overlay once speech recognition returns a
   * final transcript. Sends it to GROQ along with the destination and the
   * last few turns of this visit's conversation, then speaks the reply.
   * No-ops if there's no active destination or nothing was actually said.
   */
  const askQuestion = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const routeMatch = resolveDestinationFromText(trimmed);
    const dest = routeMatch ?? destination;

    if (!destination && routeMatch) {
      setDestination(routeMatch);
      setGenericMode(false);
      activeIdRef.current = routeMatch.id;
      conversationRef.current = [];
    }

    if (!destination && !routeMatch && isGenericMode) {
      conversationRef.current = [];
    }

    stopTTS();
    setListening(false);
    setLiveTranscript('');
    setStatus('loading');
    conversationRef.current.push({ role: 'user', content: trimmed });

    try {
      logAIActivity(uid, 'askQuestion', dest ? { id: dest.id, title: dest.title, name: dest.name } : undefined, trimmed);
      const activeId = activeIdRef.current;
<<<<<<< HEAD
      const historyTurns = conversationRef.current
        .filter((m) => m && typeof m.content === 'string' && m.content.trim().length > 0)
        .slice(-6);

      const result = await callGroqChat({
        messages: [
          { role: 'system', content: dest ? buildQASystemPrompt(dest) : buildGenericQASystemPrompt() },
          ...historyTurns,
        ],
        temperature: 0.7,
        max_tokens: 250,
        top_p: 0.9,
      });

      const reply = result.data.reply?.trim() || generateProximityQAFallback(dest, trimmed);
      const destId = dest?.id ?? null;

      if (!mountedRef.current || (destId ? activeId !== destId : activeId !== null)) return;
=======
      const result = await callGroqChat({
        messages: [
          { role: 'system', content: dest ? buildQASystemPrompt(dest) : buildGenericQASystemPrompt() },
          ...conversationRef.current.slice(-6),
        ],
        temperature: 0.7,
        max_tokens: 180,
        top_p: 0.9,
      });

      const reply = result.data.reply?.trim();
      const destId = dest?.id ?? null;

      if (!mountedRef.current || (destId ? activeId !== destId : activeId !== null)) return;
      if (!reply) {
        setNarration("Sorry, I didn't quite get that — can you ask again?");
        setStatus('paused');
        return;
      }
>>>>>>> origin/main

      conversationRef.current.push({ role: 'assistant', content: reply });
      setNarration(reply);
      setStatus('speaking');
      speak(reply, {
        lang: 'en-US',
        onEnd: () => {
          if (!mountedRef.current || (destId ? activeIdRef.current !== destId : activeIdRef.current !== null)) return;
          setStatus('paused');
        },
        onError: () => {
          if (!mountedRef.current || (destId ? activeIdRef.current !== destId : activeIdRef.current !== null)) return;
          setStatus('paused');
        },
      });
    } catch (err) {
<<<<<<< HEAD
      console.warn('ProximityAI: askQuestion fell back to local intelligence:', err);
      const destId = dest?.id ?? null;
      if (!mountedRef.current || (destId ? activeIdRef.current !== destId : activeIdRef.current !== null)) return;

      const fallbackReply = generateProximityQAFallback(dest, trimmed);
      conversationRef.current.push({ role: 'assistant', content: fallbackReply });
      setNarration(fallbackReply);
      setStatus('speaking');
      speak(fallbackReply, {
        lang: 'en-US',
        onEnd: () => {
          if (!mountedRef.current || (destId ? activeIdRef.current !== destId : activeIdRef.current !== null)) return;
          setStatus('paused');
        },
        onError: () => {
          if (!mountedRef.current || (destId ? activeIdRef.current !== destId : activeIdRef.current !== null)) return;
          setStatus('paused');
        },
      });
=======
      console.error('ProximityAI: askQuestion failed', err);
      const destId = dest?.id ?? null;
      if (!mountedRef.current || (destId ? activeIdRef.current !== destId : activeIdRef.current !== null)) return;
      setNarration("Hmm, I'm having trouble hearing myself think. Try again?");
      setStatus('paused');
>>>>>>> origin/main
    }
  }, [destination, speak, stopTTS]);

  const triggerGeneric = useCallback((): boolean => {
    setGenericMode(true);
    conversationRef.current = [];
    setDestination(null);
    setNarration('Hi! I\'m ALI. Tell me what you want to talk about — Pasig City, food, transport, or anything else.');
    setStatus('paused');
    activeIdRef.current = null;
    logAIActivity(uid, 'generic');
    return true;
  }, [uid]);

  /**
   * triggerManual — for the long-press "test AI Talking" button on Home.
   * Bypasses GPS proximity and the retrigger cooldown so it fires immediately,
   * every time, regardless of where the user physically is. No `source` is
   * passed to triggerFor, so this neither logs analytics nor touches the
   * real cooldown — it's purely for previewing content.
   */
  const triggerManual = useCallback((destId?: string): boolean => {
    const list = geofenceRef.current;
    if (list.length === 0) {
      console.info('ProximityAI: no destinations loaded — starting a generic conversation instead');
      return triggerGeneric();
    }

    const dest = destId ? list.find(d => d.id === destId) : list[0];
    if (!dest) {
      console.info('ProximityAI: destination not found for manual trigger — starting a generic conversation instead', destId);
      return triggerGeneric();
    }

    triggerFor(dest);
    return true;
  }, [triggerFor, triggerGeneric]);

  return (
    <ProximityAIContext.Provider
      value={{
        status,
        destination,
        narration,
        dismiss,
        togglePause,
        triggerManual,
        triggerForDestination,
        triggerGeneric,
        isGenericMode,
        resolveDestinationFromText,
        askQuestion,
        isListening,
        liveTranscript,
        setListening,
        setLiveTranscript,
      }}
    >
      {children}
    </ProximityAIContext.Provider>
  );
};

export default ProximityAIProvider;