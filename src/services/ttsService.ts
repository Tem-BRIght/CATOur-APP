import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

export type VoiceGender = 'female' | 'male';
export interface TtsState { isSpeaking: boolean; isPaused: boolean; speakingId: string | null }
export interface SpeakOptions {
  id: string;
  rate?: number;
  gender?: VoiceGender;
  muted?: boolean;
  lang?: string;
  onEnd?: () => void;
}

type Listener = (state: TtsState) => void;
let state: TtsState = { isSpeaking: false, isPaused: false, speakingId: null };
let currentUtterance: SpeechSynthesisUtterance | null = null;
let lastSpokenText: string | null = null;
let lastSpokenOpts: SpeakOptions | null = null;
const listeners = new Set<Listener>();

function setState(patch: Partial<TtsState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener(state));
}

export function stripMarkdown(text: string): string {
  if (!text) return '';
  let cleaned = text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/#{1,6}\s+/g, '');
  const transitions = ['First', 'Next', 'After that', 'Then', 'Also', 'Following that', 'And finally'];
  const lines = cleaned.split('\n');
  const numbered = lines.map((line, index) => /^\s*\d+[.)]\s+/.test(line) ? index : -1).filter((index) => index >= 0);
  if (numbered.length >= 2) {
    numbered.forEach((lineIndex, index) => {
      const transition = index === numbered.length - 1 && numbered.length > 2
        ? 'And finally' : transitions[Math.min(index, transitions.length - 2)];
      lines[lineIndex] = lines[lineIndex].replace(/^\s*\d+[.)]\s+/, `${transition}, `);
    });
    cleaned = lines.join('\n');
  }
  return cleaned.replace(/^[-*•]\s+/gm, '').replace(/\s*[-–—]\s*/g, ', ')
    .replace(/\n+/g, '. ').replace(/\s{2,}/g, ' ').replace(/\.\s*\./g, '.').trim();
}

export function pickVoice(gender: VoiceGender = 'female'): SpeechSynthesisVoice | undefined {
  if (typeof window === 'undefined' || !window.speechSynthesis) return undefined;
  const voices = window.speechSynthesis.getVoices();
  const filipino = voices.filter((voice) => /^(fil|tl)([-_]|$)/i.test(voice.lang) || /filipin|tagalog/i.test(voice.name));
  if (filipino.length) return filipino.find((voice) => gender === 'female' ? /female|woman|girl/i.test(voice.name) : /male|man/i.test(voice.name)) || filipino[0];
  const enPH = voices.filter((voice) => /^en[-_]ph$/i.test(voice.lang));
  if (enPH.length) return enPH[0];
  const pattern = gender === 'female' ? /female|zira|susan|karen|hazel|samantha|victoria/i : /male|david|mark|paul|alex|james|robert/i;
  return voices.find((voice) => pattern.test(voice.name)) || voices.find((voice) => voice.lang.startsWith('en'));
}

export function subscribeTts(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export function getTtsState(): TtsState { return state; }

function speakWeb(rawText: string, options: SpeakOptions): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    setState({ isSpeaking: false, isPaused: false, speakingId: null });
    return;
  }
  const text = stripMarkdown(rawText);
  if (!text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickVoice(options.gender);
  if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
  else utterance.lang = options.lang || 'en-US';
  utterance.rate = options.rate || 1;
  utterance.onstart = () => setState({ isSpeaking: true, isPaused: false, speakingId: options.id });
  utterance.onend = () => { setState({ isSpeaking: false, isPaused: false, speakingId: null }); options.onEnd?.(); };
  utterance.onerror = () => setState({ isSpeaking: false, isPaused: false, speakingId: null });
  utterance.onpause = () => setState({ isSpeaking: false, isPaused: true });
  utterance.onresume = () => setState({ isSpeaking: true, isPaused: false });
  currentUtterance = utterance;
  window.speechSynthesis.speak(utterance);
}

export async function speak(rawText: string, options: SpeakOptions): Promise<void> {
  if (options.muted) return;
  const text = stripMarkdown(rawText);
  if (!text) return;
  lastSpokenText = rawText;
  lastSpokenOpts = options;
  if (Capacitor.isNativePlatform()) {
    try {
      await TextToSpeech.stop().catch(() => undefined);
      setState({ isSpeaking: true, isPaused: false, speakingId: options.id });
      await TextToSpeech.speak({ text, lang: options.lang || 'en-US', rate: options.rate || 1, pitch: 1, volume: 1, category: 'ambient' });
      setState({ isSpeaking: false, isPaused: false, speakingId: null });
      options.onEnd?.();
      return;
    } catch (error) {
      console.warn('[ttsService] native TTS failed; using web fallback:', error);
    }
  }
  speakWeb(text, options);
}

export function pause(): void {
  if (Capacitor.isNativePlatform()) {
    void TextToSpeech.stop();
    setState({ isSpeaking: false, isPaused: true });
  } else if (window.speechSynthesis?.speaking) window.speechSynthesis.pause();
}

export function resume(): void {
  if (Capacitor.isNativePlatform()) {
    if (lastSpokenText && lastSpokenOpts) void speak(lastSpokenText, lastSpokenOpts);
  } else if (window.speechSynthesis?.paused) window.speechSynthesis.resume();
}

export function stop(): void {
  if (Capacitor.isNativePlatform()) void TextToSpeech.stop();
  if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
  currentUtterance = null;
  lastSpokenText = null;
  lastSpokenOpts = null;
  setState({ isSpeaking: false, isPaused: false, speakingId: null });
}
