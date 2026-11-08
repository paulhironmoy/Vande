/**
 * Timing windows in play: the active bands for an assistance level (plus the Assisted performance tier's tolerance),
 * the SwingTiming classification, and the forgiveness map that makes Learn and Play swings more forgiving.
 *
 * The labels follow the physics (lead decision 2026-11-03): the Real bands are the measured windows of the virtual
 * bat on the reference over (constants.ts TIMING_BANDS), while the bat's own rates, how timing error moves it across
 * the line and rotates its face, are fixed by BAT_TIMING_CALIBRATION. Learn and Play keep that geometry and instead
 * move the bat's arrival in time: a player error e (ms) is replaced by forgive(e), a piecewise-linear map through
 * the band edges (active perfect → Real perfect, solid → solid, edge → edge, slope 1 beyond the edge), so the bat
 * reaches the zone at idealContactT + forgive(e). The report always keeps the raw error e and the player's intended
 * direction; the outcome is pure physics of the (forgiven) bat. Real maps e to itself on every device: it applies
 * no forgiveness at all, so the Assisted performance tier's tolerance widens Learn and Play only. A bat that met the
 * ball is never labelled "missed", and a block met on the face is at least "solid" (contact.ts metTiming).
 */
import type { AssistLevel, SwingTiming, TimingBands } from '@/contracts/practice';
import { PHYSICAL_BANDS, TIMING_BANDS } from './constants';

/**
 * Bands for a level. Learn and Play widen each edge by the Assisted tier's tolerance (ms), the declared device
 * allowance; Real ignores it: zero forgiveness on every tier (the record still keeps the raw tolerance).
 */
export function activeBands(assist: AssistLevel, tierToleranceMs = 0): TimingBands {
  const b = TIMING_BANDS[assist];
  const tol = assist !== 'real' && tierToleranceMs > 0 ? tierToleranceMs : 0;
  return { perfectMs: b.perfectMs + tol, solidMs: b.solidMs + tol, edgeMs: b.edgeMs + tol };
}

/** SwingTiming of a signed error against the active bands ('missed' beyond the edge band). */
export function classifyTiming(errorMs: number, bands: TimingBands): Exclude<SwingTiming, 'none'> {
  const a = errorMs < 0 ? -errorMs : errorMs;
  if (a <= bands.perfectMs) return 'perfect';
  if (a <= bands.solidMs) return 'solid';
  if (a <= bands.edgeMs) return 'mistimed';
  return 'missed';
}

/** Forgiveness map: the physical (Real-equivalent) error the bat plays for a player error under `bands`. */
export function forgive(errorMs: number, bands: TimingBands): number {
  const s = errorMs < 0 ? -1 : 1;
  const a = errorMs * s;
  const k0 = bands.perfectMs;
  const k1 = bands.solidMs;
  const k2 = bands.edgeMs;
  const p0 = PHYSICAL_BANDS.perfectMs;
  const p1 = PHYSICAL_BANDS.solidMs;
  const p2 = PHYSICAL_BANDS.edgeMs;
  let m: number;
  if (a <= k0) m = (a * p0) / k0;
  else if (a <= k1) m = p0 + ((a - k0) * (p1 - p0)) / (k1 - k0);
  else if (a <= k2) m = p1 + ((a - k1) * (p2 - p1)) / (k2 - k1);
  else m = p2 + (a - k2);
  return s * m;
}
