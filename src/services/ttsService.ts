// src/services/ttsService.ts
// ─────────────────────────────────────────────────────────────────────────────
// Shared Web Speech API (SpeechSynthesis) wrapper.
//
// Extracted from AIGuide.tsx so the same voice logic (voice picking, speed,
// mute handling) can be reused by the global proximity trigger overlay,
// which needs to "talk" even when the user is NOT on the /ai-guide screen.
//
// This module holds no React state — it's a plain singleton controller with
// a subscribe() API, so any component can mount/unmount without losing the
// in-progress utterance.
// ─────────────────────────────────────────────────────────────────────────────

export type VoiceGender = 'female' | 'male';

export interface TtsState {
  isSpeaking: boolean;
  isPaused: boolean;
  speakingId: string | null;
}

type Listener = (state: TtsState) => void;

let state: TtsState = { isSpeaking: false, isPaused: false, speakingId: null };
let currentUtterance: SpeechSynthesisUtterance | null = null;
const listeners = new Set<Listener>();

function setState(patch: Partial<TtsState>) {
  state = { ...state, ...patch };
  listeners.forEach(l => l(state));
}

/**
 * Strip markdown and format lists into natural spoken prose transitions
 * so TTS speaks naturally (e.g. "First, ... Next, ... After that, ... Then, ... And finally, ...")
 * rather than reading raw numbers or symbols.
 */
export function stripMarkdown(text: string): string {
  if (!text) return '';

  // 1. Remove markdown bold, italic, code, headings
  let cleaned = text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/#{1,6}\s+/g, '');

  const spokenTransitions = ['First', 'Next', 'After that', 'Then', 'Also', 'Following that', 'And finally'];

  // 2. Multi-line numbered list conversion: "1. Immaculate..." or "1) Immaculate..."
  const lines = cleaned.split('\n');
  const numberedLineIndices: number[] = [];
  lines.forEach((line, idx) => {
    if (/^\s*\d+[\.\)]\s+/.test(line)) {
      numberedLineIndices.push(idx);
    }
  });

  if (numberedLineIndices.length >= 2) {
    const total = numberedLineIndices.length;
    numberedLineIndices.forEach((lineIdx, i) => {
      let transition = spokenTransitions[Math.min(i, spokenTransitions.length - 2)];
      if (i === total - 1 && total > 2) {
        transition = 'And finally';
      }
      lines[lineIdx] = lines[lineIdx].replace(/^\s*\d+[\.\)]\s+/, `${transition}, `);
    });
    cleaned = lines.join('\n');
  } else {
    // 3. Inline numbered list conversion: " 1) ... 2) ... 3) ..."
    let inlineCount = 0;
    const inlineMatches = cleaned.match(/(?:^|\s)\d+[\.\)]\s+/g);
    if (inlineMatches && inlineMatches.length >= 2) {
      const total = inlineMatches.length;
      cleaned = cleaned.replace(/(?:^|\s)\d+[\.\)]\s+/g, (match) => {
        let transition = spokenTransitions[Math.min(inlineCount, spokenTransitions.length - 2)];
        if (inlineCount === total - 1 && total > 2) {
          transition = 'And finally';
        }
        inlineCount += 1;
        const leadingSpace = match.startsWith(' ') ? ' ' : '';
        return `${leadingSpace}${transition}, `;
      });
    } else {
      cleaned = cleaned.replace(/^\s*\d+[\.\)]\s+/gm, '');
    }
  }

  // 4. Clean bullets, dashes, and extra whitespace
  return cleaned
    .replace(/^[-*•]\s+/gm, '')
    .replace(/\s*–\s*/g, ', ')
    .replace(/\s*—\s*/g, ', ')
    .replace(/\n+/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\.\s*\./g, '.')
    .trim();
}

/**
 * pickVoice
 * Picks the best available voice for ALI, preferring an actual Filipina
 * voice when the device/browser exposes one, and otherwise falling back
 * step-by-step to the closest approximation.
 *
 * Priority order (gender === 'female'):
 *   1. A voice whose lang is fil-PH / tl-PH (Filipino/Tagalog), or whose
 *      name literally says "Filipino"/"Filipina"/"Tagalog" — this is the
 *      real thing when it's present (mostly Android Chrome + some Google
 *      TTS engines expose "Filipino (Philippines)").
 *   2. Among those, one whose name suggests a female voice.
 *   3. A voice with lang en-PH (Philippine English) — closer accent than
 *      a plain en-US voice even though it's not Tagalog.
 *   4. The existing generic English-female heuristic (zira/susan/etc.).
 *   5. Any English voice at all.
 *
 * NOTE: actual voice availability is entirely controlled by the OS/browser,
 * not by this app — desktop Chrome/Edge on Windows or macOS typically does
 * NOT ship a Filipino voice, so on those platforms this will land on step
 * 3 or 4. Android devices and some mobile browsers are far more likely to
 * have a real Filipino voice installed.
 */
export function pickVoice(gender: VoiceGender = 'female'): SpeechSynthesisVoice | undefined {
  if (!window.speechSynthesis) return undefined;
  const voices = window.speechSynthesis.getVoices();

  // 1. Real Filipino/Tagalog voice, if the platform has one installed.
  const filipinoVoices = voices.filter(
    v => /^(fil|tl)([-_]|$)/i.test(v.lang) || /filipin|tagalog/i.test(v.name)
  );
  if (filipinoVoices.length) {
    const filipinoFemale = filipinoVoices.find(v =>
      gender === 'female' ? /female|woman|girl/i.test(v.name) : /male|man/i.test(v.name)
    );
    return filipinoFemale ?? filipinoVoices[0];
  }

  // 2. Philippine-accented English, if available.
  const enPH = voices.filter(v => /^en[-_]ph$/i.test(v.lang));
  if (enPH.length) {
    const enPHGendered = enPH.find(v =>
      gender === 'female' ? /female|woman|girl/i.test(v.name) : /male|man/i.test(v.name)
    );
    return enPHGendered ?? enPH[0];
  }

  // 3. Generic English fallback (previous behaviour).
  let voice: SpeechSynthesisVoice | undefined;
  if (gender === 'female') {
    voice = voices.find(v => /female|zira|susan|karen|hazel|samantha|victoria/i.test(v.name));
  } else {
    voice = voices.find(v => /male|david|mark|paul|alex|james|robert/i.test(v.name));
  }
  return voice ?? voices.find(v => v.lang.startsWith('en'));
}

export function subscribeTts(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export function getTtsState(): TtsState {
  return state;
}

export interface SpeakOptions {
  id: string;               // caller-supplied id, e.g. a destination id
  rate?: number;             // 0.5–2, default 1
  gender?: VoiceGender;
  muted?: boolean;
  /**
   * BCP-47 lang hint, e.g. 'fil-PH'. Defaults to 'fil-PH' so browsers that
   * choose a system voice by lang code (rather than only by the explicit
   * `voice` we set below) still get a chance to speak as Filipino/Tagalog
   * even when pickVoice() couldn't find a named Filipino voice object.
   * Has no effect if the picked voice forces its own lang, which most
   * engines do.
   */
  lang?: string;
  onEnd?: () => void;
}

export function speak(rawText: string, opts: SpeakOptions): void {
  if (!window.speechSynthesis || opts.muted) return;

  window.speechSynthesis.cancel();

  try {
    const text = stripMarkdown(rawText);
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(opts.gender ?? 'female');
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = opts.lang ?? 'fil-PH';
    }

    utterance.rate = opts.rate ?? 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    utterance.onstart = () => setState({ isSpeaking: true, isPaused: false, speakingId: opts.id });
    utterance.onend = () => {
      setState({ isSpeaking: false, isPaused: false, speakingId: null });
      opts.onEnd?.();
    };
    utterance.onerror = () => setState({ isSpeaking: false, isPaused: false, speakingId: null });
    utterance.onpause = () => setState({ isSpeaking: false, isPaused: true });
    utterance.onresume = () => setState({ isSpeaking: true, isPaused: false });

    currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.error('[ttsService] speak failed:', err);
    setState({ isSpeaking: false, isPaused: false, speakingId: null });
  }
}

export function pause(): void {
  if (window.speechSynthesis?.speaking) window.speechSynthesis.pause();
}

export function resume(): void {
  if (window.speechSynthesis?.paused) window.speechSynthesis.resume();
}

export function stop(): void {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  currentUtterance = null;
  setState({ isSpeaking: false, isPaused: false, speakingId: null });
}