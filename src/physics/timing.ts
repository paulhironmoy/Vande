/**
 * Timing windows in play: the active bands for an assistance level (plus the Assisted performance tier's tolerance),
 * the SwingTiming classification, and the forgiveness map that makes Learn and Play swings more forgiving.
 *
 * The virtual bat is calibrated physically against the Real bands (PHYSICAL_BANDS): timing error moves it across
 * the line and rotates its face at fixed rates, so its geometry produces "middle on the sweet spot" inside ±25 ms,
 * "middle" inside ±55 ms, an edge up to ±90 ms and a miss beyond. Learn and Play keep that geometry and instead
 * move the bat's arrival in time: a player error e (ms) is replaced by forgive(e), a piecewise-linear map through
 * the band edges (active perfect → physical perfect, solid → solid, edge → edge, slope 1 beyond the edge), so the bat
 * reaches the zone at idealContactT + forgive(e). The report always keeps the raw error e and the player's intended
 * direction; the outcome is pure physics of the (forgiven) bat. Real with no tier tolerance maps e to itself.
 */
import type { AssistLevel, SwingTiming, TimingBands } from '@/contracts/practice';
import { PHYSICAL_BANDS, TIMING_BANDS } from './constants';

/** Bands for a level, each edge widened by the Assisted tier's tolerance (ms). */
export function activeBands(assist: AssistLevel, tierToleranceMs = 0): TimingBands {
  const b = TIMING_BANDS[assist];
  const tol = tierToleranceMs > 0 ? tierToleranceMs : 0;
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
