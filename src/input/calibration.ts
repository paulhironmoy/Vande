/**
 * Timing calibration: "Tap when the moving ball crosses the line." Each attempt's error is the tap's event timestamp
 * minus the moment the ball crossed the line (ms; + = the tap registered late, which is what touch and display
 * latency do). The offset is the median of the plausible attempts, clamped, so one wild tap cannot move it.
 *
 * Latency differs between kinds of input (a touch screen reports later than a keyboard), so calibration is kept per
 * modality (CTL9): touch, mouse, pen and keyboard each have their own offset, measured with that input, and a swing
 * is corrected only by the offset of the input that made it (normalizeGesture's `calibrations`). A modality never
 * borrows another's offset, except a pen, which shares the touch screen's digitizer and uses the touch offset until it
 * has its own. The caller stores the set locally (src/practice/store/calibration.ts); nothing here is persisted.
 */
import type { Calibration, CalibrationSet, InputModality } from '@/contracts/practice';
import { CALIBRATION } from './constants';

export type { CalibrationSet };

/** Every modality that can be calibrated, in a fixed order. */
export const MODALITIES: readonly InputModality[] = ['touch', 'mouse', 'pen', 'keyboard'];


/** The error of one attempt: tap timestamp minus the line-crossing time (both performance.now() ms). */
export function calibrationError(tapPerfMs: number, crossPerfMs: number): number {
  return tapPerfMs - crossPerfMs;
}

export function calibrationFromTaps(errorsMs: readonly number[]): Calibration {
  const valid = errorsMs.filter((e) => Number.isFinite(e) && Math.abs(e) <= CALIBRATION.rejectAbsMs).sort((a, b) => a - b);
  if (valid.length === 0) return { offsetMs: 0, attempts: 0 };
  const mid = valid.length >> 1;
  const median = valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
  const clamped = Math.min(CALIBRATION.maxMs, Math.max(CALIBRATION.minMs, median));
  const offsetMs = Math.round(clamped * 10) / 10;
  return { offsetMs: offsetMs === 0 ? 0 : offsetMs, attempts: valid.length };
}

/**
 * Calibrations from attempts made with any mix of inputs: each modality's attempts give its own median. A modality
 * without a counted attempt is absent (so storing the result never overwrites another modality's offset).
 */
export function calibrationsFromTaps(taps: ReadonlyArray<{ modality: InputModality; errorMs: number }>): CalibrationSet {
  const out: CalibrationSet = {};
  for (const m of MODALITIES) {
    const c = calibrationFromTaps(taps.filter((x) => x.modality === m).map((x) => x.errorMs));
    if (c.attempts > 0) out[m] = c;
  }
  return out;
}

/** Adds (or replaces) one modality's calibration in a set, leaving the others as they were. */
export function withCalibration(set: CalibrationSet, modality: InputModality, c: Calibration): CalibrationSet {
  return c.attempts > 0 && Number.isFinite(c.offsetMs) ? { ...set, [modality]: { offsetMs: c.offsetMs, attempts: c.attempts } } : { ...set };
}

/** The offset (ms) a swing made with `modality` is corrected by: its own, a pen's from touch, else 0. */
export function calibrationFor(set: CalibrationSet | null | undefined, modality: InputModality): number {
  const own = set?.[modality];
  if (own && own.attempts > 0 && Number.isFinite(own.offsetMs)) return own.offsetMs;
  const touch = set?.touch;
  if (modality === 'pen' && touch && touch.attempts > 0 && Number.isFinite(touch.offsetMs)) return touch.offsetMs;
  return 0;
}

/** Every modality's offset, for normalizeGesture's `calibrations` option and the stage's provisional swing. */
export function resolveCalibrations(set: CalibrationSet | null | undefined): Record<InputModality, number> {
  return { touch: calibrationFor(set, 'touch'), mouse: calibrationFor(set, 'mouse'), pen: calibrationFor(set, 'pen'), keyboard: calibrationFor(set, 'keyboard') };
}

/** The modality of a DOM event: a key press is the keyboard; a pointer event is its pointer type. */
export function eventModality(e: Event): InputModality {
  if (typeof KeyboardEvent !== 'undefined' && e instanceof KeyboardEvent) return 'keyboard';
  if (e.type.startsWith('key')) return 'keyboard';
  const type = (e as PointerEvent).pointerType;
  return type === 'mouse' ? 'mouse' : type === 'pen' ? 'pen' : 'touch';
}
