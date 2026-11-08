/// <reference types="node" />
/**
 * TEST HELPERS ONLY: how a test judges a speed budget without flaking on a busy machine, and without lowering the budget.
 *
 *  1. Measure CPU time, not the wall clock. A thread that waits for a core on a busy machine is not slow, it is waiting;
 *     `cpuMicros()` counts only the time the thread ran (`process.threadCpuUsage` where Node has it, else `process.cpuUsage`).
 *  2. Take the best of several rounds (`bestOf`). Noise (a collection, a cache storm, another process) only ever adds
 *     time, so the least of N rounds is the best estimate of what the code costs; a real slowdown raises every round.
 *     A round that is already inside the budget ends the search: no later round can change that verdict.
 *  3. Keep the budget as written, and assert it as written. The one exception is `skipOverBudgetWhenLoaded`: when the
 *     budget is exceeded AND the one-minute load average is above `LOAD_CEILING` (AGENTS.md: a measurement taken above
 *     load 20 is indicative only) the figure cannot be judged, so the test skips BY NAME (the reason, the figures and the
 *     load, in the reporter and on stderr). It never passes silently, and on a quiet machine an overrun is a failure.
 *
 * `tests/unit/support/timing.test.ts` pins these rules.
 */
import { loadavg } from 'node:os';

/** One-minute load average above which a speed figure is indicative only and an overrun is skipped by name, not failed. */
export const LOAD_CEILING = 20;

type Usage = { user: number; system: number };
const usage: () => Usage =
  typeof (process as { threadCpuUsage?: () => Usage }).threadCpuUsage === 'function'
    ? () => (process as unknown as { threadCpuUsage: () => Usage }).threadCpuUsage()
    : () => process.cpuUsage();

/** CPU time (user + system) used so far by the calling thread, in microseconds. */
export function cpuMicros(): number {
  const u = usage();
  return u.user + u.system;
}

/** CPU milliseconds of one call of `fn`, averaged over `calls` calls. */
export function cpuMsPerCall(fn: () => void, calls: number): number {
  const t0 = cpuMicros();
  for (let i = 0; i < calls; i++) fn();
  return (cpuMicros() - t0) / 1000 / calls;
}

/**
 * The least of up to `rounds` measurements. With `enough` it stops at the first round below it (pass the budget): the least
 * can only go down from there, so the verdict "under the budget" is already settled.
 */
export function bestOf(rounds: number, measure: () => number, enough = Number.NEGATIVE_INFINITY): number {
  let best = Number.POSITIVE_INFINITY;
  for (let round = 0; round < rounds; round++) {
    best = Math.min(best, measure());
    if (best < enough) break;
  }
  return best;
}

/** What a test's context offers for a dynamic skip (vitest's `ctx.skip(note)`). */
export interface SkipContext {
  skip(note?: string): never;
}

const figure = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toPrecision(3));

/**
 * Call before the budget assertion `expect(measured).toBeLessThan(budget)`. Returns when the figure is inside the budget
 * or the machine is quiet (the assertion then decides); otherwise skips the test by name. `load` is injectable for tests.
 */
export function skipOverBudgetWhenLoaded(
  ctx: SkipContext,
  what: string,
  measured: number,
  budget: number,
  unit: string,
  load: number = loadavg()[0],
): void {
  if (measured < budget || !(load > LOAD_CEILING)) return;
  const note = `${what}: ${figure(measured)} ${unit} against a budget of ${figure(budget)} ${unit} cannot be judged, the machine load is ${load.toFixed(1)} (above ${LOAD_CEILING})`;
  console.warn(`SKIPPED (speed budget, loaded machine) ${note}`);
  ctx.skip(note);
}
