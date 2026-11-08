/**
 * The timing calibration ("Tap when the moving ball crosses the line"), kept per kind of input (CTL9, F-028): a touch
 * screen reports later than a mouse or a keyboard, so each has its own offset, measured with that input, and a swing
 * is corrected only by the offset of the input that made it. Computed by src/input; only stored here.
 *
 * Stored as { v: 2, touch?, mouse?, pen?, keyboard? }, each { offsetMs, attempts }. A calibration saved before this
 * (one offset for everything) was measured with the device's main input, so it becomes that input's: touch on a
 * touch-first device, otherwise the mouse.
 */
import type { Calibration } from '@/contracts';
import {
  PRACTICE_KEYS,
  isInt,
  isNum,
  isObj,
  localStore,
  readJson,
  removeKey,
  writeJson,
  type KeyStore,
} from './storage';

export type CalibratedInput = 'touch' | 'mouse' | 'pen' | 'keyboard';
export type StoredCalibrations = Partial<Record<CalibratedInput, Calibration>>;
export const CALIBRATED_INPUTS: readonly CalibratedInput[] = ['touch', 'mouse', 'pen', 'keyboard'];

/** Within what src/input can produce (its clamp is −60…220 ms); anything outside is corrupt. */
const MIN_MS = -200;
const MAX_MS = 400;

function valid(raw: unknown): Calibration | null {
  if (!isObj(raw) || !isNum(raw.offsetMs) || !isInt(raw.attempts)) return null;
  if (raw.offsetMs < MIN_MS || raw.offsetMs > MAX_MS || (raw.attempts as number) < 1) return null;
  return { offsetMs: raw.offsetMs, attempts: raw.attempts as number };
}

/** The device's main input, for a calibration saved before inputs were told apart. */
function mainInput(): CalibratedInput {
  try {
    return typeof matchMedia === 'function' && matchMedia('(any-pointer: coarse)').matches ? 'touch' : 'mouse';
  } catch {
    return 'mouse';
  }
}

export function loadCalibrations(
  store: KeyStore | null = localStore(),
  main: () => CalibratedInput = mainInput,
): StoredCalibrations {
  const raw = readJson(store, PRACTICE_KEYS.calibration);
  if (!isObj(raw)) return {};
  if (raw.v !== 2) {
    const legacy = valid(raw);
    return legacy ? { [main()]: legacy } : {};
  }
  const out: StoredCalibrations = {};
  for (const m of CALIBRATED_INPUTS) {
    const c = valid(raw[m]);
    if (c) out[m] = c;
  }
  return out;
}

/** Saves the inputs given (each replaces only its own; the others are kept). False when none was measured. */
export function saveCalibrations(set: StoredCalibrations, store: KeyStore | null = localStore()): boolean {
  const next: StoredCalibrations = { ...loadCalibrations(store) };
  let any = false;
  for (const m of CALIBRATED_INPUTS) {
    const c = set[m];
    if (c && isNum(c.offsetMs) && c.attempts >= 1) {
      next[m] = { offsetMs: Math.round(c.offsetMs), attempts: c.attempts };
      any = true;
    }
  }
  return any && writeJson(store, PRACTICE_KEYS.calibration, { v: 2, ...next });
}

export function clearCalibration(store: KeyStore | null = localStore()): void {
  removeKey(store, PRACTICE_KEYS.calibration);
}

/** One input's calibration, if it has one. */
export function loadCalibration(input: CalibratedInput, store: KeyStore | null = localStore()): Calibration | null {
  return loadCalibrations(store)[input] ?? null;
}
