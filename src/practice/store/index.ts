/**
 * src/practice/store: everything Practice keeps on the device (settings, the innings in progress with in-flight
 * protection, the timing calibration, the Build an Over draft, local metrics). Nothing is sent anywhere.
 */
import { clearCachedAssessment } from '@/perf';
import { PRACTICE_KEYS, localStore, removeKey, type KeyStore } from './storage';

export * from './storage';
export * from './settings';
export * from './calibration';
export * from './innings';
export * from './metrics';

/**
 * Deletes everything Practice keeps on this device (for "Delete local data" in the app settings, and Practice's own
 * "Clear Practice data"), including the cached device check.
 */
export function clearPracticeData(store: KeyStore | null = localStore()): void {
  for (const key of Object.values(PRACTICE_KEYS)) removeKey(store, key);
  clearCachedAssessment(store);
}
