import { describe, expect, it } from 'vitest';
import { deviceLocale } from '@/app/store';

describe('first-run language', () => {
  it('starts Hindi phones in Hindi and keeps English otherwise', () => {
    expect(deviceLocale(['hi-IN', 'en-IN'])).toBe('hi');
    expect(deviceLocale(['en-GB'])).toBe('en');
    expect(deviceLocale(['hi-Latn'])).toBe('hi-Latn');
  });

  it('never picks a machine-drafted locale automatically', () => {
    expect(deviceLocale(['ta-IN'])).toBe('en');
    expect(deviceLocale(['bn-IN', 'hi-IN'])).toBe('en');
  });
});
