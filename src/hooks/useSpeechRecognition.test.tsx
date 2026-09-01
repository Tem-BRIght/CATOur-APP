import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { nativeSpeechRecognitionMock } = vi.hoisted(() => ({
  nativeSpeechRecognitionMock: {
    available: vi.fn(async () => ({ available: true })),
    addListener: vi.fn(async () => ({ remove: vi.fn() })),
    removeAllListeners: vi.fn(async () => {}),
    checkPermissions: vi.fn(async () => ({ speechRecognition: 'granted' })),
    requestPermissions: vi.fn(async () => ({ speechRecognition: 'granted' })),
    isListening: vi.fn(async () => ({ listening: false })),
    start: vi.fn(async () => ({ matches: ['hello there'] })),
    stop: vi.fn(async () => {}),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
  },
}));

vi.mock('@capacitor-community/speech-recognition', () => ({
  SpeechRecognition: nativeSpeechRecognitionMock,
}));

import { useSpeechRecognition } from './useSpeechRecognition';

describe('useSpeechRecognition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeSpeechRecognitionMock.available.mockResolvedValue({ available: true });
    nativeSpeechRecognitionMock.checkPermissions.mockResolvedValue({ speechRecognition: 'granted' });
    nativeSpeechRecognitionMock.requestPermissions.mockResolvedValue({ speechRecognition: 'granted' });
    nativeSpeechRecognitionMock.isListening.mockResolvedValue({ listening: false });
    nativeSpeechRecognitionMock.start.mockResolvedValue({ matches: ['hello there'] });
    nativeSpeechRecognitionMock.stop.mockResolvedValue(undefined);
  });

  it('keeps the native recognizer in listening mode until the OS actually stops it', async () => {
    const onFinalResult = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition({ lang: 'en-US', onFinalResult }));

    await act(async () => {
      await result.current.start();
    });

    expect(nativeSpeechRecognitionMock.start).toHaveBeenCalled();
    expect(result.current.isListening).toBe(true);
  });
});
