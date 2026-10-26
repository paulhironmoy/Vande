/**
 * Bridge to the engine's public presentation helpers (stable, pure). The renderer aligns its choreography to the
 * engine's per-ball timeline so engine-authored camera cues land on the right moments. Every call is guarded: if
 * the engine cannot answer (older/newer rules, or a stub during development), the renderer falls back to its own
 * timing and still plays the ball.
 */
import type { BallOutcome, BowlerAction, Conditions } from '@/contracts';
import * as Engine from '@/engine';

const FALLBACK_RUN_UP: Record<BowlerAction, number> = { pace_long: 2200, pace_short: 1800, swing_side_on: 2000, spin_off: 1300, spin_leg: 1350 };

export function runUpMs(action: BowlerAction): number {
  try {
    const v = (Engine as { RUN_UP_MS?: Record<BowlerAction, number> }).RUN_UP_MS?.[action];
    if (typeof v === 'number' && v > 0) return v;
  } catch {
    /* fall through */
  }
  return FALLBACK_RUN_UP[action];
}

export interface EngineBallTimeline {
  releaseAtMs: number;
  bounceAtMs: number;
  contactAtMs: number;
  endMs: number;
}

export function engineBallTimeline(outcome: BallOutcome, conditions: Conditions): EngineBallTimeline | null {
  try {
    const fn = (Engine as { ballTimeline?: (o: BallOutcome, c: Conditions) => EngineBallTimeline }).ballTimeline;
    const tl = fn ? fn(outcome, conditions) : null;
    if (tl && tl.contactAtMs > tl.releaseAtMs && tl.releaseAtMs > 0) return tl;
  } catch {
    /* fall through */
  }
  return null;
}
