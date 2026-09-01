import { describe, expect, it } from 'vitest';
import { shouldShowTouristList } from './touristListAccess';

describe('tourist list access gate', () => {
  it('shows the tourist list only when the session is active and at least one tourist has checked in', () => {
    expect(shouldShowTouristList({ status: 'active', checkedInUids: ['tourist-1'] })).toBe(true);
    expect(shouldShowTouristList({ status: 'active', checkedInUids: [] })).toBe(false);
    expect(shouldShowTouristList({ status: 'pending', checkedInUids: ['tourist-1'] })).toBe(false);
    expect(shouldShowTouristList({ status: 'Cancelled', checkedInUids: ['tourist-1'] })).toBe(false);
  });
});
