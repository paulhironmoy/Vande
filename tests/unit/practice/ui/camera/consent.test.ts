/**
 * "Seen" is remembered in the camera's one small key, beside whatever the camera core keeps there, and never starts
 * the camera. A corrupt or missing key means "not seen", and the screen is simply shown again.
 */
import { describe, expect, it } from 'vitest';
import { PRACTICE_KEYS, memoryStore } from '@/practice/store';
import { CONSENT_VERSION, consentSeen, rememberConsent } from '@/practice/ui/camera/consent';

describe('the consent flag', () => {
  it('is not seen on a new device and is seen after it was shown', () => {
    const store = memoryStore();
    expect(consentSeen(store)).toBe(false);
    expect(rememberConsent(store)).toBe(true);
    expect(consentSeen(store)).toBe(true);
  });

  it('keeps the fields the camera core stored in the same key', () => {
    const store = memoryStore();
    store.setItem(PRACTICE_KEYS.camera, JSON.stringify({ delegate: 'CPU', other: { a: 1 } }));
    rememberConsent(store);
    const saved = JSON.parse(store.getItem(PRACTICE_KEYS.camera)!) as Record<string, unknown>;
    expect(saved).toEqual({ delegate: 'CPU', other: { a: 1 }, consentSeen: true, consentV: CONSENT_VERSION });
  });

  it('shows the consent again when it was seen under an older wording', () => {
    const store = memoryStore();
    store.setItem(PRACTICE_KEYS.camera, JSON.stringify({ consentSeen: true, consentV: CONSENT_VERSION - 1 }));
    expect(consentSeen(store)).toBe(false);
    store.setItem(PRACTICE_KEYS.camera, JSON.stringify({ consentSeen: true }));
    expect(consentSeen(store)).toBe(false);
  });

  it('treats a corrupt key, an array or no storage as not seen, without throwing', () => {
    const store = memoryStore();
    store.setItem(PRACTICE_KEYS.camera, '{not json');
    expect(consentSeen(store)).toBe(false);
    store.setItem(PRACTICE_KEYS.camera, '[1,2]');
    expect(consentSeen(store)).toBe(false);
    expect(rememberConsent(store)).toBe(true);
    expect(consentSeen(store)).toBe(true);
    expect(consentSeen(null)).toBe(false);
    expect(rememberConsent(null)).toBe(false);
  });
});
