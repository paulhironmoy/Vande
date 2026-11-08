/**
 * Whether this device has seen the camera's consent screen. It lives in the camera's one small key
 * (`PRACTICE_KEYS.camera`, which "Clear Practice data" removes), next to whatever the camera core keeps there:
 * every write reads the stored object first and changes only the two fields below, so the core's own fields survive.
 *
 * Seeing the consent never starts the camera. The camera starts only from the player's tap on "Use camera" in a
 * visit, and "seen" only shortens the screen (the plain privacy line, the download size and the two buttons).
 */
import { PRACTICE_KEYS, localStore, readJson, writeJson, type KeyStore } from '@/practice/store';

/** Bumped when the consent wording changes in a way that must be shown again. */
export const CONSENT_VERSION = 1;

function stored(store: KeyStore | null): Record<string, unknown> {
  const raw = readJson(store, PRACTICE_KEYS.camera);
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
}

/** True when the consent of this version was shown here before. */
export function consentSeen(store: KeyStore | null = localStore()): boolean {
  const v = stored(store).consentV;
  return stored(store).consentSeen === true && typeof v === 'number' && v >= CONSENT_VERSION;
}

/** Remembers that the consent was shown (false when storage is unavailable; the screen is then simply shown again). */
export function rememberConsent(store: KeyStore | null = localStore()): boolean {
  return writeJson(store, PRACTICE_KEYS.camera, { ...stored(store), consentSeen: true, consentV: CONSENT_VERSION });
}
