// src/hooks/useSpeechRecognition.ts
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS FILE EXISTS
// `window.SpeechRecognition` / `window.webkitSpeechRecognition` (the Web
// Speech API) only exists in real desktop/mobile Chrome. Android's WebView
// — which is what your Capacitor APK renders your UI in — does NOT implement
// it. That's why `toggleListening()` in AIGuide.tsx was immediately hitting
// the `if (!SpeechRecognition)` branch and showing "Voice input is not
// supported in this browser" as soon as the mic button was tapped on the
// APK, even though it works fine when you test in a browser tab.
//
// FIX: on native platforms we talk to the OS's real speech engine through
// @capacitor-community/speech-recognition. On web we keep the exact same
// Web Speech API behavior AIGuide.tsx already had. Everything else in
// AIGuide.tsx (vibration detector, sendMessage, etc.) is untouched.
//
// ── INSTALL (required before this will work on the APK) ───────────────────
//   npm install @capacitor-community/speech-recognition
//   npx cap sync
//
// ── Android — add to android/app/src/main/AndroidManifest.xml ─────────────
//   <uses-permission android:name="android.permission.RECORD_AUDIO" />
//
// ── iOS — add to ios/App/App/Info.plist ────────────────────────────────────
//   <key>NSSpeechRecognitionUsageDescription</key>
//   <string>Used so ALI can hear your questions.</string>
//   <key>NSMicrophoneUsageDescription</key>
//   <string>Used so ALI can hear your questions.</string>
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { SpeechRecognition as NativeSpeechRecognition } from '@capacitor-community/speech-recognition';

export interface UseSpeechRecognitionOptions {
  /** BCP-47 language tag, e.g. 'fil-PH' or 'en-US' */
  lang?: string;
  /** Called once with the final transcript when listening stops */
  onFinalResult: (transcript: string) => void;
  /** Called with a user-facing error message */
  onError?: (message: string) => void;
  /** Called when listening actually starts (good place to start a vibration/level detector) */
  onStart?: () => void;
  /** Called when listening stops, for any reason */
  onEnd?: () => void;
}

export interface UseSpeechRecognitionResult {
  isSupported: boolean;
  isListening: boolean;
  liveTranscript: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  reset: () => Promise<void>;
}

export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions
): UseSpeechRecognitionResult {
  const { lang = 'fil-PH' } = options;

  const isNative = Capacitor.isNativePlatform?.() ?? Capacitor.getPlatform() !== 'web';
  const [isSupported, setIsSupported] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');

  const mountedRef = useRef(true);
  const webRecognitionRef = useRef<any>(null);
  const liveTranscriptRef = useRef(''); // mirrors state so native stop() can read the latest value synchronously
  const finalizedRef = useRef(false); // guards against double-dispatch between stop() and the async listeningState event

  // Keep latest callbacks in refs so listeners set up once never go stale
  const onFinalResultRef = useRef(options.onFinalResult);
  const onErrorRef = useRef(options.onError);
  const onStartRef = useRef(options.onStart);
  const onEndRef = useRef(options.onEnd);
  useEffect(() => { onFinalResultRef.current = options.onFinalResult; }, [options.onFinalResult]);
  useEffect(() => { onErrorRef.current = options.onError; }, [options.onError]);
  useEffect(() => { onStartRef.current = options.onStart; }, [options.onStart]);
  useEffect(() => { onEndRef.current = options.onEnd; }, [options.onEnd]);

  const updateTranscript = (text: string) => {
    liveTranscriptRef.current = text;
    setLiveTranscript(text);
  };

  // ── Native (Capacitor / APK) setup ──────────────────────────────────────
  useEffect(() => {
    if (!isNative) return;
    let cancelled = false;
    let partialHandle: any;
    let stateHandle: any;

    (async () => {
      try {
        const { available } = await NativeSpeechRecognition.available();
        if (!cancelled) setIsSupported(available);
      } catch {
        if (!cancelled) setIsSupported(false);
      }
    })();

    NativeSpeechRecognition.addListener('partialResults', (data: { matches: string[] }) => {
      if (!mountedRef.current) return;
      updateTranscript(data.matches?.[0] ?? '');
    }).then(h => { partialHandle = h; });

    NativeSpeechRecognition.addListener('listeningState', (data: { status: 'started' | 'stopped' }) => {
      if (!mountedRef.current) return;
      console.log('[useSpeechRecognition] listeningState', data);
      if (data.status === 'started') {
        setIsListening(true);
        onStartRef.current?.();
      } else {
        // The OS can end a session on its own (silence timeout, etc.) — treat
        // whatever we last heard as the final transcript, unless stop() already
        // dispatched it.
        setIsListening(false);
        if (!finalizedRef.current && liveTranscriptRef.current.trim()) {
          finalizedRef.current = true;
          onFinalResultRef.current(liveTranscriptRef.current.trim());
        }
        updateTranscript('');
        onEndRef.current?.();
      }
    }).then(h => { stateHandle = h; });

    return () => {
      cancelled = true;
      partialHandle?.remove();
      stateHandle?.remove();
      NativeSpeechRecognition.removeAllListeners().catch(() => {});
      NativeSpeechRecognition.stop().catch(() => {});
    };
  }, [isNative]);

  // ── Web (browser) setup — unchanged behavior from the original code ────
  useEffect(() => {
    if (isNative) return;

    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition ||
      (window as any).mozSpeechRecognition ||
      (window as any).msSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      setIsSupported(false);
      return;
    }

    const rec = new SpeechRecognitionCtor();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = lang;

    rec.onresult = (event: any) => {
      if (!mountedRef.current) return;
      const last = event.results[event.results.length - 1];
      const transcript = last[0].transcript;
      updateTranscript(transcript);
      if (last.isFinal) onFinalResultRef.current(transcript);
    };
    rec.onstart = () => {
      if (!mountedRef.current) return;
      setIsListening(true);
      onStartRef.current?.();
    };
    rec.onerror = (event: any) => {
      if (!mountedRef.current) return;
      const msgs: Record<string, string> = {
        'not-allowed': 'Microphone access denied. Please allow access.',
        'no-speech': 'No speech detected. Try again.',
      };
      onErrorRef.current?.(msgs[event.error] ?? 'Voice input error. Please try again.');
      setIsListening(false);
      updateTranscript('');
      onEndRef.current?.();
    };
    rec.onend = () => {
      if (!mountedRef.current) return;
      if (!finalizedRef.current && liveTranscriptRef.current.trim()) {
        finalizedRef.current = true;
        onFinalResultRef.current(liveTranscriptRef.current.trim());
      }
      setIsListening(false);
      updateTranscript('');
      onEndRef.current?.();
    };

    webRecognitionRef.current = rec;
  }, [isNative, lang]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── start / stop ─────────────────────────────────────────────────────────

  const start = useCallback(async () => {
    if (!isSupported) {
      onErrorRef.current?.('Voice input is not supported on this device.');
      return;
    }

    if (isNative) {
      try {
        const perm = await NativeSpeechRecognition.checkPermissions();
        if (perm.speechRecognition !== 'granted') {
          const req = await NativeSpeechRecognition.requestPermissions();
          if (req.speechRecognition !== 'granted') {
            onErrorRef.current?.('Microphone access denied. Please allow access.');
            return;
          }
        }
        updateTranscript('');
        finalizedRef.current = false;
        try {
          const listeningStatus = await NativeSpeechRecognition.isListening();
          if (listeningStatus.listening) {
            await NativeSpeechRecognition.stop();
          }
        } catch {
          await NativeSpeechRecognition.stop().catch(() => {});
        }
        const startPromise = NativeSpeechRecognition.start({
          language: lang,
          partialResults: false,
          popup: false,
        });
        setIsListening(true);
        onStartRef.current?.();

        const result = await startPromise;
        console.log('[useSpeechRecognition] native start result', result);
        if (!finalizedRef.current && result?.matches?.[0]?.trim()) {
          finalizedRef.current = true;
          updateTranscript(result.matches[0].trim());
          onFinalResultRef.current(result.matches[0].trim());
        }
        // Some Android WebView implementations may not reliably emit a
        // `listeningState: stopped` event after the final result. Ensure the
        // hook resets UI state so the UI can start another session.
        setIsListening(false);
        updateTranscript('');
        onEndRef.current?.();
      } catch (err: any) {
        const message = err?.message ?? 'Could not start voice recognition. Please try again.';
        const busy = /busy|already|active/i.test(message);
        if (busy) {
          onErrorRef.current?.('Microphone is currently busy. Please try again in a moment.');
        } else {
          onErrorRef.current?.(message);
        }
        setIsListening(false);
      }
    } else {
      try {
        updateTranscript('');
        finalizedRef.current = false;
        try { webRecognitionRef.current?.abort(); } catch { /* ignore */ }
        webRecognitionRef.current?.start();
        setIsListening(true);
      } catch (err: any) {
        if (err?.name === 'InvalidStateError') {
          setIsListening(true);
        } else {
          onErrorRef.current?.('Could not start voice recognition. Please try again.');
        }
      }
    }
  }, [isNative, isSupported, lang]);

  const stop = useCallback(async () => {
    if (isNative) {
      const finalText = liveTranscriptRef.current.trim();
      console.log('[useSpeechRecognition] stop called, finalText=', finalText);
      try {
        await NativeSpeechRecognition.stop();
      } catch { /* ignore */ }
      setIsListening(false);
      updateTranscript('');
      if (!finalizedRef.current && finalText) {
        finalizedRef.current = true;
        onFinalResultRef.current(finalText);
      }
      onEndRef.current?.();
    } else {
      const finalText = liveTranscriptRef.current.trim();
      if (finalText && !finalizedRef.current) {
        finalizedRef.current = true;
        onFinalResultRef.current(finalText);
      }
      webRecognitionRef.current?.stop();
      setIsListening(false);
      updateTranscript('');
    }
  }, [isNative]);

    const reset = useCallback(async () => {
      console.log('[useSpeechRecognition] reset called');
      finalizedRef.current = false;
      try {
        if (isNative) {
          await NativeSpeechRecognition.stop().catch(() => {});
        } else {
          try { webRecognitionRef.current?.abort(); } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      setIsListening(false);
      updateTranscript('');
      onEndRef.current?.();
    }, [isNative]);

  return { isSupported, isListening, liveTranscript, start, stop, reset };
}
