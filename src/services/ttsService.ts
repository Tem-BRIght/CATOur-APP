import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

export type VoiceGender = 'female' | 'male';

export interface TtsState {
  isSpeaking: boolean;
  isPaused: boolean;
  speakingId: string | null;
}

type Listener = (state: TtsState) => void;

let state: TtsState = { isSpeaking: false, isPaused: false, speakingId: null };
let currentUtterance: SpeechSynthesisUtterance | null = null;
let lastSpokenText: string | null = null;
let lastSpokenOpts: SpeakOptions | null = null;
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
 * Picks the best available voice for ALI in Web Speech API.
 */
export function pickVoice(gender: VoiceGender = 'female'): SpeechSynthesisVoice | undefined {
  if (typeof window === 'undefined' || !window.speechSynthesis) return undefined;
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

  // 3. Generic English fallback.
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
  id: string;               // caller-supplied id, e.g. a destination id or message index
  rate?: number;             // 0.5–2, default 1
  gender?: VoiceGender;
  muted?: boolean;
  lang?: string;
  onEnd?: () => void;
}

function speakWeb(text: string, opts: SpeakOptions): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    setState({ isSpeaking: false, isPaused: false, speakingId: null });
    return;
  }

  window.speechSynthesis.cancel();

  try {
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
    utterance.onerror = (err) => {
      console.warn('[ttsService] speechSynthesis error:', err);
      setState({ isSpeaking: false, isPaused: false, speakingId: null });
    };
    utterance.onpause = () => setState({ isSpeaking: false, isPaused: true });
    utterance.onresume = () => setState({ isSpeaking: true, isPaused: false });

    currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.error('[ttsService] speakWeb failed:', err);
    setState({ isSpeaking: false, isPaused: false, speakingId: null });
  }
}

export async function speak(rawText: string, opts: SpeakOptions): Promise<void> {
  if (opts.muted) return;

  const text = stripMarkdown(rawText);
  if (!text.trim()) return;

  lastSpokenText = rawText;
  lastSpokenOpts = opts;

  const isNative = Capacitor.isNativePlatform();

  // Native Android/iOS APK playback via Capacitor TextToSpeech
  if (isNative) {
    try {
      await TextToSpeech.stop().catch(() => {});
      setState({ isSpeaking: true, isPaused: false, speakingId: opts.id });

      await TextToSpeech.speak({
        text,
        lang: opts.lang ?? 'en-US',
        rate: opts.rate ?? 1.0,
        pitch: 1.0,
        volume: 1.0,
        category: 'ambient',
      });

      setState({ isSpeaking: false, isPaused: false, speakingId: null });
      opts.onEnd?.();
      return;
    } catch (err) {
      console.warn('[ttsService] native TextToSpeech failed, attempting web fallback:', err);
      speakWeb(text, opts);
      return;
    }
  }

  // Web browser playback
  speakWeb(text, opts);
}

export function pause(): void {
  const isNative = Capacitor.isNativePlatform();
  if (isNative) {
    TextToSpeech.stop().catch(() => {});
    setState({ isSpeaking: false, isPaused: true, speakingId: state.speakingId });
  } else if (typeof window !== 'undefined' && window.speechSynthesis?.speaking) {
    window.speechSynthesis.pause();
    setState({ isSpeaking: false, isPaused: true });
  }
}

export function resume(): void {
  const isNative = Capacitor.isNativePlatform();
  if (isNative) {
    if (lastSpokenText && lastSpokenOpts) {
      void speak(lastSpokenText, lastSpokenOpts);
    }
  } else if (typeof window !== 'undefined' && window.speechSynthesis?.paused) {
    window.speechSynthesis.resume();
    setState({ isSpeaking: true, isPaused: false });
  }
}

export function stop(): void {
  const isNative = Capacitor.isNativePlatform();
  if (isNative) {
    TextToSpeech.stop().catch(() => {});
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  currentUtterance = null;
  lastSpokenText = null;
  lastSpokenOpts = null;
  setState({ isSpeaking: false, isPaused: false, speakingId: null });
}