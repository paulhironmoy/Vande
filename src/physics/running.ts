/**
 * Automatic running between the wickets. Practice has no Run, Cancel or Dive controls: the batters run 0, 1, 2 or 3
 * whenever, and only when, they would make their ground with a safety margin before the ball is back at the stumps.
 * So there is never a run-out, and the runs come from the play itself: how far and how fast the ball went, where the
 * fielders were, how long the pickup and the throw took (fielding.ts). No probability table is involved.
 *
 * Run times come from a simple sprint model of a batter in pads carrying a bat: he finishes the stroke and calls
 * (`START_S`), accelerates at `ACCEL` to `TOP_SPEED` over the 17.68 m between the popping creases less the stretch of
 * the bat at the far end (`RUN_M`), and loses `TURN_S` turning for each extra run. That gives about 3.2 s for one,
 * 6.3 s for two and 9.4 s for three, in line with measured first-class running.
 */
import type { SimEvent } from '@/contracts/practice';

export const RUNNING = {
  /** Finish the stroke, call, first step (s after the ball leaves the bat). */
  START_S: 0.35,
  /** Acceleration (m/s²) and top speed (m/s) between the wickets. */
  ACCEL: 5.5,
  TOP_SPEED: 7.5,
  /** Sprint per run: 17.68 m between the popping creases, less ~1.2 m of bat stretched over the line. */
  RUN_M: 16.5,
  /** Extra time lost at each turn (decelerate, ground the bat, push off) beyond running from standing (s). */
  TURN_S: 0.15,
  /** The batters only complete a run they would make with at least this long to spare (s). */
  SAFETY_MARGIN_S: 0.45,
  MAX_RUNS: 3,
} as const;

/** Seconds to sprint one run from standing. */
export function sprintS(d: number = RUNNING.RUN_M): number {
  const dAcc = (RUNNING.TOP_SPEED * RUNNING.TOP_SPEED) / (2 * RUNNING.ACCEL);
  if (d <= dAcc) return Math.sqrt((2 * d) / RUNNING.ACCEL);
  return RUNNING.TOP_SPEED / RUNNING.ACCEL + (d - dAcc) / RUNNING.TOP_SPEED;
}

/** Seconds after the ball leaves the bat at which the batters complete run 1, 2 and 3. */
export function runCompletionS(): [number, number, number] {
  const one = RUNNING.START_S + sprintS();
  const next = sprintS() + RUNNING.TURN_S;
  return [one, one + next, one + 2 * next];
}

export interface RunningResult {
  runs: 0 | 1 | 2 | 3;
  /** Simulation times at which each completed run was made. */
  completedT: number[];
  /** Time to spare on the last completed run, or how far short the first run would have been (negative), in s. */
  spareS: number;
}

/**
 * The runs the batters take when the ball leaves the bat at `t0` and is back at the stumps (with someone to take it)
 * at `returnT`. The most runs r ≤ 3 such that run r is complete `SAFETY_MARGIN_S` before the return.
 */
export function autoRuns(t0: number, returnT: number): RunningResult {
  const times = runCompletionS();
  const available = returnT - t0;
  let runs = 0;
  while (runs < RUNNING.MAX_RUNS && times[runs] + RUNNING.SAFETY_MARGIN_S <= available + 1e-9) runs++;
  const completedT = times.slice(0, runs).map((s) => t0 + s);
  const spareS = runs > 0 ? available - times[runs - 1] : available - times[0];
  return { runs: runs as RunningResult['runs'], completedT, spareS };
}

/** One `run` event per completed run. */
export function runEvents(r: RunningResult): SimEvent[] {
  return r.completedT.map((t, i) => ({ t, kind: 'run', completed: i + 1 }) as SimEvent);
}
