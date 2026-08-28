import { describe, expect, it, vi } from 'vitest';
import { canTriggerVibration, safeVibrate } from './vibration';

describe('vibration guard', () => {
  it('blocks vibration before user activation', () => {
    const navigatorLike = {
      vibrate: vi.fn(),
      userActivation: { isActive: false },
    } as unknown as Navigator;

    expect(canTriggerVibration(navigatorLike)).toBe(false);
  });

  it('allows vibration after user activation', () => {
    const navigatorLike = {
      vibrate: vi.fn(),
      userActivation: { isActive: true },
    } as unknown as Navigator;

    expect(canTriggerVibration(navigatorLike)).toBe(true);
  });

  it('only calls navigator.vibrate when permitted', () => {
    const vibrate = vi.fn();
    const navigatorLike = {
      vibrate,
      userActivation: { isActive: false },
    } as unknown as Navigator;

    expect(safeVibrate(navigatorLike, 60)).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
  });
});
