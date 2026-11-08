import { describe, expect, it } from 'vitest';
import { deviceLocale, normalizeSettings } from '@/app/store';

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

describe('settings migration', () => {
  it('preserves the explicit 200% choice and defaults unsupported legacy values', () => {
    expect(normalizeSettings({ textScale: 2 }).textScale).toBe(2);
    expect(normalizeSettings({ textScale: 1.3 }).textScale).toBe(1.3);
    expect(normalizeSettings({ textScale: 1.75 }).textScale).toBe(1);
    expect(normalizeSettings({ textScale: '2' }).textScale).toBe(1);
  });
});
