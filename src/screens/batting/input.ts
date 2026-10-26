/**
 * Builds the raw batting input from one gesture: a swipe towards the zone whose release is the timing tap (or a
 * short tap for defend and leave). Matches the engine's validation rules (src/engine/v1/batting.ts): monotonic
 * samples, at most 4 s, swipe direction within one sector of the zone, tap within the late limit.
 */
import type { BattingInput, FieldZone, InputTrace, RevealedDelivery, ShotType, TimingGrade, Contact } from '@/contracts';
import * as Engine from '@/engine';
import { SECTOR_ORDER, sectorDistance, zoneFromSwipe } from '@/ui/cricket/aim';
import '../engineRules';

/** One press on the hit surface: a PointerTrace (src/input/pointer.ts, timed from its own events), or the keyboard's tap. */
export interface Gesture {
  pointer: InputTrace['pointer'];
  /** Timestamp of the first sample (performance.now() clock). */
  t0: number;
  /** [ms since t0 (0.1 ms), x 0..1, y 0..1 (4 decimals)] in the hit surface. */
  samples: Array<[number, number, number]>;
}

const MAX_TRACE_MS = 3900;
const MIN_SWIPE = 0.06;

export function swipeZone(g: Gesture): FieldZone | null {
  const s = g.samples;
  if (s.length < 2) return null;
  const dx = s[s.length - 1][1] - s[0][1];
  const dy = s[s.length - 1][2] - s[0][2];
  if (Math.hypot(dx, dy) < MIN_SWIPE) return null;
  return zoneFromSwipe(dx, dy);
}

/** Trims to the last ~4 s and at most 120 samples, re-basing time to the first kept sample. */
function trimmed(g: Gesture): InputTrace {
  let s = g.samples;
  const end = s[s.length - 1][0];
  s = s.filter((x) => x[0] >= end - MAX_TRACE_MS);
  if (s.length > 120) s = [s[0], ...s.slice(s.length - 119)];
  const base = s[0][0];
  return { pointer: g.pointer, samples: s.map(([t, x, y]) => [Math.round((t - base) * 10) / 10, x, y]) };
}

/** The evidence trace for a chosen zone: the full swipe when it agrees with the zone, else the release as a tap. */
export function traceFor(g: Gesture | null, zone: FieldZone | null): InputTrace {
  if (!g || g.samples.length === 0) return { pointer: 'touch', samples: [] };
  const swiped = swipeZone(g);
  if (!zone || !swiped || sectorDistance(swiped, zone) <= 1) return trimmed(g);
  // The swipe pointed somewhere the shot cannot go and the aim was snapped: send only the release, as a tap.
  const last = g.samples[g.samples.length - 1];
  const dur = Math.max(40, Math.min(90, last[0]));
  return { pointer: g.pointer, samples: [[0, last[1], last[2]], [dur, last[1], last[2]]] };
}

export function buildInput(args: {
  delivery: RevealedDelivery;
  shot: ShotType;
  zone: FieldZone | null;
  gesture: Gesture | null;
  tapMs: number | null;
  receivedAt: number;
  now: number;
}): BattingInput {
  const { delivery, shot } = args;
  const zone = shot === 'defend' || shot === 'leave' ? null : args.zone;
  const trace = args.tapMs === null ? { pointer: 'touch' as const, samples: [] } : traceFor(args.gesture, zone);
  const traceMs = trace.samples.length ? trace.samples[trace.samples.length - 1][0] : 0;
  const tapMs = args.tapMs === null ? null : Math.round(args.tapMs * 10) / 10;
  const elapsed = Math.max(Math.round(args.now - args.receivedAt), Math.ceil(tapMs ?? 0), Math.ceil(traceMs));
  return { v: 1, ball: delivery.ball, shot, zone, tapMs, trace, clientElapsedMs: elapsed };
}

/** Local timing grade (for the immediate swing animation; the server's feedback is the truth). */
export function predictTiming(tapMs: number | null, delivery: RevealedDelivery): TimingGrade {
  try {
    const fn = (Engine as { timingGrade?: (t: number | null, d: RevealedDelivery['timing']) => TimingGrade }).timingGrade;
    if (fn) return fn(tapMs, delivery.timing);
  } catch {
    /* fall through */
  }
  if (tapMs === null) return 'no_shot';
  const err = tapMs - delivery.timing.releaseToContactMs;
  const a = Math.abs(err);
  if (a <= delivery.timing.perfectMs) return 'perfect';
  if (a <= delivery.timing.goodMs) return 'good';
  if (a <= delivery.timing.edgeMs) return err < 0 ? 'early' : 'late';
  return err < 0 ? 'very_early' : 'very_late';
}

export function predictContact(shot: ShotType, timing: TimingGrade): Contact {
  if (shot === 'leave' || timing === 'no_shot') return 'none';
  if (timing === 'perfect' || timing === 'good') return 'middle';
  if (timing === 'early' || timing === 'late') return 'thick_edge';
  return 'miss';
}

export { SECTOR_ORDER };
