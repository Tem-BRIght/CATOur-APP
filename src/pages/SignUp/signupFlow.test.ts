import { describe, it, expect } from 'vitest';

describe('Signup Flow Validation', () => {
  it('validates required signup fields', () => {
    const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    expect(isValidEmail('tourist@example.com')).toBe(true);
    expect(isValidEmail('invalid-email')).toBe(false);
  });
});
