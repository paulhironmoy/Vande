/**
 * Timing calibration: "Tap when the moving ball crosses the line." Each attempt's error is the tap's event timestamp
 * minus the moment the ball crossed the line (ms; + = the tap registered late, which is what touch and display
 * latency do). The offset is the median of the plausible attempts, clamped, so one wild tap cannot move it. The
 * caller stores it locally and passes it to normalizeGesture as `calibrationMs` (one per pointer type is best: a
 * keyboard has less latency than a touch screen).
 */
import type { Calibration } from '@/contracts/practice';
import { CALIBRATION } from './constants';

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
