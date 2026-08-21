import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockUseAuth = vi.fn();
const mockSpeak = vi.fn();
const mockPause = vi.fn();
const mockResume = vi.fn();
const mockStop = vi.fn();

vi.mock('./AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('../hooks/useTextToSpeech', () => ({
  useTextToSpeech: () => ({
    speak: mockSpeak,
    pause: mockPause,
    resume: mockResume,
    stop: mockStop,
  }),
}));

vi.mock('../services/proximityAIService', () => ({
  getGeofenceDestinations: vi.fn(async () => []),
  findArrival: vi.fn(),
  hasRecentlyTriggered: vi.fn(() => false),
  markTriggered: vi.fn(),
  generateArrivalNarration: vi.fn(async () => 'Welcome'),
  logProximityTrigger: vi.fn(),
  logAIActivity: vi.fn(),
}));

import { ProximityAIProvider, useProximityAI } from './Proximityaicontext';

function TestConsumer() {
  const ctx = useProximityAI();

  return (
    <>
      <div data-testid="status">{ctx.status}</div>
      <div data-testid="generic">{String(ctx.isGenericMode)}</div>
      <div data-testid="narration">{ctx.narration}</div>
      <button type="button" onClick={() => ctx.triggerManual()}>
        trigger
      </button>
    </>
  );
}

describe('ProximityAIProvider', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: { uid: 'user-1' } });
    mockSpeak.mockReset();
    mockPause.mockReset();
    mockResume.mockReset();
    mockStop.mockReset();
  });

  it('falls back to a normal conversation when no destination is nearby', () => {
    const { getByTestId, getByText } = render(
      <ProximityAIProvider>
        <TestConsumer />
      </ProximityAIProvider>
    );

    fireEvent.click(getByText('trigger'));

    expect(getByTestId('generic')).toHaveTextContent('true');
    expect(getByTestId('status')).toHaveTextContent('paused');
    expect(getByTestId('narration')).toHaveTextContent('Hi! I\'m ALI');
  });
});
