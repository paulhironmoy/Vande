/**
 * Where the tap landed against the ideal contact moment, for the meter shown after each ball. The client measures
 * the offset from its own tap and the delivery's public timing; the sealed grade from the server is the truth, so
 * the mark is kept inside that grade's band (a perfect never shows as 40 ms late). Timing only: nothing here says
 * anything about runs or wickets.
 */
import type { DeliveryTiming, TimingGrade } from '@/contracts';

export interface TimingMark {
  /** ms from the ideal moment: negative is early, positive is late (inside the grade's band). */
  offsetMs: number;
  /** 0 (very early) … 0.5 (perfect) … 1 (very late) across the meter. */
  pos: number;
}

/** Half the meter's width, in ms: the edge band plus room for very early and very late. */
export function meterRange(timing: DeliveryTiming): number {
  return Math.max(timing.edgeMs * 1.6, timing.goodMs + 60);
}

/** The band edges as fractions of half the meter (perfect, good, edge). */
export function meterBands(timing: DeliveryTiming): { perfect: number; good: number; edge: number } {
  const r = meterRange(timing);
  return { perfect: timing.perfectMs / r, good: timing.goodMs / r, edge: timing.edgeMs / r };
}

export function timingMark(timing: DeliveryTiming, tapMs: number | null, grade: TimingGrade): TimingMark | null {
  if (tapMs === null || grade === 'no_shot' || grade === 'interrupted') return null;
  const raw = tapMs - timing.releaseToContactMs;
  const { perfectMs: p, goodMs: g, edgeMs: e } = timing;
  const side = raw < 0 ? -1 : 1;
  const within = (lo: number, hi: number, sign: number) => sign * Math.min(hi, Math.max(lo, Math.abs(raw)));
  let off: number;
  switch (grade) {
    case 'perfect':
      off = Math.max(-p, Math.min(p, raw));
      break;
    case 'good':
      off = within(Math.min(p + 1, g), g, side);
      break;
    case 'early':
      off = within(Math.min(g + 1, e), e, -1);
      break;
    case 'late':
      off = within(Math.min(g + 1, e), e, 1);
      break;
    case 'very_early':
      off = -Math.max(e + 1, raw < 0 ? -raw : e + 1);
      break;
    case 'very_late':
      off = Math.max(e + 1, raw > 0 ? raw : e + 1);
      break;
    default:
      off = raw;
  }
  off = Math.round(off);
  const r = meterRange(timing);
  const pos = 0.5 + Math.max(-1, Math.min(1, off / r)) * 0.5;
  return { offsetMs: off, pos: Math.max(0.02, Math.min(0.98, pos)) };
}
