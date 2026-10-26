/**
 * Raw input traces: plausibility checks shared by both gestures, the release-meter execution quality, swipe zones,
 * and deterministic human-like trace synthesis for engine-driven players (Auto Over, Auto XI, ghosts, daily setter).
 * Pure arithmetic only (no Math.atan2/Math.sin), so results are identical on every JavaScript engine.
 */
import type { ExecutionGrade, FieldZone, InputTrace, PointerKind } from '@/contracts';
import type { Sfc32 } from '../prng';
import {
  MAX_BAT_TRACE_MS,
  MAX_SAMPLES,
  METER,
  POINTERS,
  ROBOTIC_MIN_SAMPLES,
  SECTOR_ZONES,
  TELEPORT_MIN_DT_MS,
  TELEPORT_UNITS_PER_MS,
} from './tables';

export type TraceKind = 'execution' | 'batting';

/** Returns a list of error codes (empty when the trace is plausible). */
export function checkTrace(trace: InputTrace, kind: TraceKind): string[] {
  if (!trace || typeof trace !== 'object') return ['trace.missing'];
  const errors: string[] = [];
  if (!(POINTERS as readonly string[]).includes(trace.pointer)) errors.push('trace.pointer');
  const samples = trace.samples;
  if (!Array.isArray(samples)) return [...errors, 'trace.samples'];
  if (samples.length > MAX_SAMPLES) errors.push('trace.too_many_samples');
  if (kind === 'execution' && samples.length < 2) errors.push('trace.too_few_samples');
  for (let i = 0; i < samples.length && i < MAX_SAMPLES + 1; i++) {
    const s = samples[i];
    if (!Array.isArray(s) || s.length !== 3 || !s.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      errors.push('trace.malformed_sample');
      return errors;
    }
  }
  if (samples.length === 0) return errors;
  if (samples[0][0] !== 0) errors.push('trace.first_sample_not_zero');
  let outOfRange = false;
  let duplicate = false;
  let backwards = false;
  let teleport = false;
  for (let i = 0; i < samples.length; i++) {
    const [t, x, y] = samples[i];
    if (x < 0 || x > 1 || y < 0 || y > 1) outOfRange = true;
    if (i === 0) continue;
    const [pt, px, py] = samples[i - 1];
    const dt = t - pt;
    if (dt === 0) duplicate = true;
    else if (dt < 0) backwards = true;
    const dx = x - px;
    const dy = y - py;
    const reach = TELEPORT_UNITS_PER_MS * (dt > TELEPORT_MIN_DT_MS ? dt : TELEPORT_MIN_DT_MS);
    if (dx * dx + dy * dy > reach * reach) teleport = true;
  }
  if (outOfRange) errors.push('trace.coordinate_out_of_range');
  if (duplicate) errors.push('trace.duplicate_timestamp');
  if (backwards) errors.push('trace.non_monotonic_time');
  if (teleport) errors.push('trace.teleport');
  const duration = samples[samples.length - 1][0];
  if (kind === 'execution') {
    if (duration < METER.minHoldMs) errors.push('trace.duration_too_short');
    if (duration > METER.maxHoldMs) errors.push('trace.duration_too_long');
  } else if (duration > MAX_BAT_TRACE_MS) errors.push('trace.duration_too_long');
  if (isRobotic(trace)) errors.push('trace.robotic_pattern');
  return errors;
}

/**
 * Robotic: perfectly constant sample intervals together with perfectly linear, constant-velocity motion. Real
 * devices always show interval jitter or path noise; scripted interpolation shows neither.
 */
export function isRobotic(trace: InputTrace): boolean {
  const s = trace.samples;
  if (trace.pointer === 'keyboard' || s.length < ROBOTIC_MIN_SAMPLES) return false;
  const dt0 = s[1][0] - s[0][0];
  for (let i = 2; i < s.length; i++) if (Math.abs(s[i][0] - s[i - 1][0] - dt0) > 1e-9) return false;
  const dx = s[s.length - 1][1] - s[0][1];
  const dy = s[s.length - 1][2] - s[0][2];
  if (dx * dx + dy * dy < 0.02 * 0.02) return false;
  for (let i = 2; i < s.length; i++) {
    const ax = s[i][1] - 2 * s[i - 1][1] + s[i - 2][1];
    const ay = s[i][2] - 2 * s[i - 1][2] + s[i - 2][2];
    if (Math.abs(ax) > 1e-9 || Math.abs(ay) > 1e-9) return false;
  }
  return true;
}

/** Release time of an execution gesture: the last sample. */
export function releaseMs(trace: InputTrace): number {
  return trace.samples[trace.samples.length - 1][0];
}

function round(v: number, places: number): number {
  const f = places === 1 ? 10 : places === 2 ? 100 : places === 3 ? 1000 : 10000;
  return Math.round(v * f) / f;
}

/** Quality 0..1 from the release time (rounded to 3 decimals) and its grade. */
export function qualityFromRelease(release: number): { quality: number; grade: ExecutionGrade } {
  const err = Math.abs(release - METER.sweetMs);
  let q = 1 - err / METER.falloffMs;
  if (q < 0) q = 0;
  if (q > 1) q = 1;
  q = round(q, 3);
  return { quality: q, grade: gradeOf(q) };
}

export function gradeOf(q: number): ExecutionGrade {
  return q >= METER.perfectQuality ? 'perfect' : q >= METER.goodQuality ? 'good' : 'loose';
}

export function executionQuality(trace: InputTrace): { ok: true; quality: number; grade: ExecutionGrade } | { ok: false; errors: string[] } {
  const errors = checkTrace(trace, 'execution');
  if (errors.length) return { ok: false, errors };
  return { ok: true, ...qualityFromRelease(releaseMs(trace)) };
}

// ---------------------------------------------------------------------------------------------------------------
// Swipe zones
// ---------------------------------------------------------------------------------------------------------------

/**
 * Sector index 0–7 of a swipe vector in surface coordinates (x right, y down), clockwise from straight up.
 * Exact comparisons only. Returns -1 for a zero vector.
 */
export function sectorOf(dx: number, dy: number): number {
  const X = dx;
  const Y = -dy;
  if (X === 0 && Y === 0) return -1;
  if (X >= 0 && Y > 0) return X < Y ? 0 : 1;
  if (X > 0 && Y <= 0) return X > -Y ? 2 : 3;
  if (X <= 0 && Y < 0) return -X < -Y ? 4 : 5;
  return -X > Y ? 6 : 7;
}

/** Field zone a swipe points at (batter's view, right-handed batter), or null for a zero-length swipe. */
export function zoneFromSwipe(dx: number, dy: number): FieldZone | null {
  const s = sectorOf(dx, dy);
  return s < 0 ? null : SECTOR_ZONES[s];
}

const C = 0.9238795325112867;
const S = 0.3826834323650898;
/** Unit vectors (x right, y up) at each sector centre. */
const SECTOR_VECTORS: ReadonlyArray<readonly [number, number]> = [
  [S, C],
  [C, S],
  [C, -S],
  [S, -C],
  [-S, -C],
  [-C, -S],
  [-C, S],
  [-S, C],
];

/** Unit swipe vector (surface coordinates, y down) pointing at the centre of a zone's sector. */
export function swipeVectorForZone(zone: FieldZone): { dx: number; dy: number } {
  const v = SECTOR_VECTORS[SECTOR_ZONES.indexOf(zone)];
  return { dx: v[0], dy: -v[1] };
}

/** Swipe displacement (first → last sample) and its length. */
export function swipeOf(trace: InputTrace): { dx: number; dy: number; length: number } {
  const s = trace.samples;
  if (s.length < 2) return { dx: 0, dy: 0, length: 0 };
  const dx = s[s.length - 1][1] - s[0][1];
  const dy = s[s.length - 1][2] - s[0][2];
  return { dx, dy, length: Math.sqrt(dx * dx + dy * dy) };
}

export function sectorsAdjacent(a: number, b: number): boolean {
  const d = (a - b + 8) % 8;
  return d === 0 || d === 1 || d === 7;
}

// ---------------------------------------------------------------------------------------------------------------
// Synthesis (engine-driven players). Looks like a real device: jittered intervals, small path noise.
// ---------------------------------------------------------------------------------------------------------------

/** A release-meter gesture released at `release` ms (clamped to the legal hold range). */
export function synthExecutionTrace(rng: Sfc32, release: number, pointer: PointerKind = 'touch'): InputTrace {
  const end = round(Math.min(METER.maxHoldMs - 1, Math.max(METER.minHoldMs + 1, release)), 1);
  const samples: Array<[number, number, number]> = [];
  let x = 0.45 + rng.float() * 0.1;
  let y = 0.86 + rng.float() * 0.06;
  const climb = 0.25 + rng.float() * 0.1;
  samples.push([0, round(x, 4), round(y, 4)]);
  let t = 0;
  for (;;) {
    t += 30 + rng.float() * 7;
    if (t >= end - 8) break;
    x += (rng.float() - 0.5) * 0.008;
    y -= (climb * 34) / end + (rng.float() - 0.5) * 0.004;
    if (y < 0.05) y = 0.05;
    samples.push([round(t, 1), round(x, 4), round(y, 4)]);
    if (samples.length >= 60) break;
  }
  x += (rng.float() - 0.5) * 0.006;
  samples.push([end, round(x, 4), round(Math.max(0.05, y - 0.01), 4)]);
  if (pointer === 'keyboard') return { pointer, samples: [[0, 0.5, 0.5], [end, 0.5, 0.5]] };
  return { pointer, samples };
}

/** A batting swipe towards `zone` lasting `durationMs`, or a short tap when zone is null. Empty for no touch. */
export function synthBattingTrace(rng: Sfc32, zone: FieldZone | null, durationMs: number, touch = true): InputTrace {
  if (!touch) return { pointer: 'touch', samples: [] };
  const samples: Array<[number, number, number]> = [];
  const x0 = 0.48 + rng.float() * 0.04;
  const y0 = 0.5 + rng.float() * 0.04;
  if (!zone) {
    const end = round(Math.max(45, Math.min(160, durationMs)), 1);
    samples.push([0, round(x0, 4), round(y0, 4)]);
    samples.push([round(end * (0.45 + rng.float() * 0.1), 1), round(x0 + (rng.float() - 0.5) * 0.004, 4), round(y0 + (rng.float() - 0.5) * 0.004, 4)]);
    samples.push([end, round(x0 + (rng.float() - 0.5) * 0.004, 4), round(y0 + (rng.float() - 0.5) * 0.004, 4)]);
    return { pointer: 'touch', samples };
  }
  const v = swipeVectorForZone(zone);
  const len = 0.24 + rng.float() * 0.08;
  const end = round(Math.max(120, Math.min(MAX_BAT_TRACE_MS - 1, durationMs)), 1);
  const steps = 8 + Math.floor(rng.float() * 5);
  samples.push([0, round(x0, 4), round(y0, 4)]);
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    const ease = f * (2 - f);
    const t = i === steps ? end : round((end * i) / steps + (rng.float() - 0.5) * 3, 1);
    const nx = x0 + v.dx * len * ease + (rng.float() - 0.5) * 0.006;
    const ny = y0 + v.dy * len * ease + (rng.float() - 0.5) * 0.006;
    samples.push([t, round(Math.min(1, Math.max(0, nx)), 4), round(Math.min(1, Math.max(0, ny)), 4)]);
  }
  for (let i = 1; i < samples.length; i++) if (samples[i][0] <= samples[i - 1][0]) samples[i][0] = round(samples[i - 1][0] + 1, 1);
  return { pointer: 'touch', samples };
}
