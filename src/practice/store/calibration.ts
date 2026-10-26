/**
 * The timing calibration ("Tap when the moving ball crosses the line"): the median offset that input normalisation
 * subtracts from every swing start. Computed by src/input's calibrationFromTaps; only stored here.
 */
import type { Calibration } from '@/contracts';
import { PRACTICE_KEYS, isInt, isNum, isObj, localStore, readJson, removeKey, writeJson, type KeyStore } from './storage';

/** Within what src/input can produce (its clamp is −60…220 ms); anything outside is corrupt. */
const MIN_MS = -200;
const MAX_MS = 400;

export function loadCalibration(store: KeyStore | null = localStore()): Calibration | null {
  const raw = readJson(store, PRACTICE_KEYS.calibration);
  if (!isObj(raw) || !isNum(raw.offsetMs) || !isInt(raw.attempts)) return null;
  if (raw.offsetMs < MIN_MS || raw.offsetMs > MAX_MS || (raw.attempts as number) < 1) return null;
  return { offsetMs: raw.offsetMs, attempts: raw.attempts as number };
}

export function saveCalibration(c: Calibration, store: KeyStore | null = localStore()): boolean {
  if (!isNum(c.offsetMs) || c.attempts < 1) return false;
  return writeJson(store, PRACTICE_KEYS.calibration, { offsetMs: Math.round(c.offsetMs), attempts: c.attempts });
}

export function clearCalibration(store: KeyStore | null = localStore()): void {
  removeKey(store, PRACTICE_KEYS.calibration);
}

/** The offset in use (0 until calibrated). */
export function calibrationMs(store: KeyStore | null = localStore()): number {
  return loadCalibration(store)?.offsetMs ?? 0;
}
