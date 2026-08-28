// src/hooks/useTextToSpeech.ts
// ─────────────────────────────────────────────────────────────────────────────
// Same reasoning as useSpeechRecognition.ts, but for the *output* side: on
// Android WebView, `window.speechSynthesis.getVoices()` frequently comes
// back empty and `onvoiceschanged` never fires, so `speechSynthesis.speak()`
// silently does nothing on a lot of devices. Since the whole point of the
// proximity "AI is telling you about this place" card is that it's spoken
// out loud, we use the native OS TTS engine on native platforms instead.
//
// ── INSTALL ─────────────────────────────────────────────────────────────
//   npm install @capacitor-community/text-to-speech
//   npx cap sync
//
// ── Known limitation ────────────────────────────────────────────────────
// The native plugin only exposes speak()/stop() — no true pause/resume.
// So on native, "pause" stops playback and "resume" re-speaks the same
// text from the start. That's a fine trade-off for a few sentences of
// narration; it's called out below so it isn't a surprise later.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { stripMarkdown } from '../services/ttsService';

export interface SpeakOptions {
  lang?: string;
  rate?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

export function useTextToSpeech() {
  const isNative = Capacitor.isNativePlatform();
  const webUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const lastTextRef = useRef<string>('');
  const lastOptsRef = useRef<SpeakOptions>({});

  const speak = useCallback(async (rawText: string, opts: SpeakOptions = {}) => {
    const text = stripMarkdown(rawText);
    if (!text.trim()) return;

    lastTextRef.current = rawText;
    lastOptsRef.current = opts;

    if (isNative) {
      try {
        console.log('[useTextToSpeech] native speak requested', { text });
        opts.onStart?.();
        await TextToSpeech.stop().catch(() => {});
        await TextToSpeech.speak({
          text,
          lang: opts.lang ?? 'en-US',
          rate: opts.rate ?? 1.0,
          pitch: 1.0,
          volume: 1.0,
          category: 'ambient',
        });
        // speak() resolves once playback finishes
        console.log('[useTextToSpeech] native speak finished');
        opts.onEnd?.();
      } catch (err: any) {
        const msg = err?.message ?? String(err ?? 'Unknown native TTS error');
        console.error('[useTextToSpeech] native TTS failed:', msg);
        opts.onError?.(msg);

        // Fallback: try Web Speech API as a best-effort fallback so APKs
        // that lack the native plugin still produce audio instead of
        // staying silent. This is helpful diagnostically and for users.
        if (window && (window as any).speechSynthesis) {
          try {
            console.log('[useTextToSpeech] falling back to Web Speech API');
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = opts.lang ?? 'en-US';
            utterance.rate = opts.rate ?? 1.0;
            utterance.onstart = () => opts.onStart?.();
            utterance.onend = () => opts.onEnd?.();
            utterance.onerror = (event) => {
              console.error('[useTextToSpeech] fallback speechSynthesis error:', (event as SpeechSynthesisErrorEvent).error);
              opts.onError?.('Could not play narration audio via fallback.');
            };
            window.speechSynthesis.speak(utterance);
            return;
          } catch (we) {
            console.error('[useTextToSpeech] fallback Web Speech API failed:', we);
          }
        }
      }
      return;
    }

    if (!window.speechSynthesis) {
      opts.onError?.('Text-to-speech is not available.');
      return;
    }

    window.speechSynthesis.cancel();
    // Chrome's speechSynthesis engine can end up stuck in a paused state —
    // e.g. after the tab loses focus, or after ~15s of continuous speech
    // (a long-standing Chrome bug) — and a stuck-paused engine silently
    // drops new speak() calls with no error at all. resume() is a no-op if
    // it wasn't actually paused, so it's safe to call unconditionally here.
    window.speechSynthesis.resume();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = opts.lang ?? 'en-US';
    utterance.rate = opts.rate ?? 1.0;
    utterance.onstart = () => opts.onStart?.();
    utterance.onend = () => opts.onEnd?.();
    utterance.onerror = (event) => {
      // Previously this only called opts.onError?.(...) with a generic
      // message and logged nothing — so a real synthesis failure (e.g.
      // 'not-allowed', 'synthesis-failed', 'canceled') looked identical to
      // silent success from the console. Log the actual reason so this is
      // debuggable next time instead of a guessing game.
      console.error('[useTextToSpeech] speechSynthesis error:', (event as SpeechSynthesisErrorEvent).error);
      opts.onError?.('Could not play narration audio.');
    };
    webUtteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);

    // Chrome sometimes silently drops speak() calls that happen outside the
    // direct call-stack of a user gesture (e.g. after an `await fetch(...)`,
    // which is exactly how this gets called from triggerFor()/askQuestion()
    // in Proximityaicontext.tsx). If `.speaking` never flips true shortly
    // after calling speak(), nothing is actually going to play and none of
    // the utterance's own event handlers will fire to tell us that — so
    // check for it explicitly and surface it as a real error instead of
    // just staying silent.
    setTimeout(() => {
      if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
        console.warn('[useTextToSpeech] speak() call appears to have been silently dropped by the browser (not a gesture-driven call, or synthesis engine stuck).');
      }
    }, 250);
  }, [isNative]);

  const pause = useCallback(async () => {
    if (isNative) {
      // No native pause — stop is the closest equivalent (see file header)
      await TextToSpeech.stop().catch(() => {});
    } else {
      window.speechSynthesis?.pause();
    }
  }, [isNative]);

  const resume = useCallback(async () => {
    if (isNative) {
      // No native resume — replay the same narration from the start
      await speak(lastTextRef.current, lastOptsRef.current);
    } else {
      window.speechSynthesis?.resume();
    }
  }, [isNative, speak]);

  const stop = useCallback(async () => {
    if (isNative) {
      await TextToSpeech.stop().catch(() => {});
    } else {
      window.speechSynthesis?.cancel();
    }
  }, [isNative]);

  return { isNative, speak, pause, resume, stop };
}