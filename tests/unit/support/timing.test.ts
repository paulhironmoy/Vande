// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { LOAD_CEILING, bestOf, cpuMicros, cpuMsPerCall, skipOverBudgetWhenLoaded } from './timing';

/** A stand-in for vitest's test context: `skip` throws, as the real one does. */
class Skipped extends Error {}
const ctx = { skip: (note?: string): never => { throw new Skipped(note); } };

describe('bestOf', () => {
  it('is the least of the rounds', () => {
    const rounds = [9, 4, 7, 5];
    let i = 0;
    expect(bestOf(4, () => rounds[i++])).toBe(4);
    expect(i).toBe(4);
  });

  it('stops at the first round inside the budget: no later round can change that verdict', () => {
    const rounds = [9, 4, 1, 0.5];
    let i = 0;
    expect(bestOf(4, () => rounds[i++], 5)).toBe(4);
    expect(i).toBe(2);
  });

  it('runs every round while none is inside the budget, and reports the least', () => {
    let i = 0;
    expect(bestOf(3, () => [30, 20, 25][i++], 5)).toBe(20);
    expect(i).toBe(3);
  });
});

describe('cpuMsPerCall', () => {
  it('counts the time the thread ran, not the time it waited', () => {
    const t0 = performance.now();
    const waited = cpuMsPerCall(() => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40), 1);
    expect(performance.now() - t0).toBeGreaterThanOrEqual(35); // it did wait about 40 ms of the wall clock ...
    expect(waited).toBeLessThan(20); // ... and used (almost) no CPU, however busy the machine is
  });

  it('counts the time the thread worked', () => {
    let sink = 0;
    const before = cpuMicros();
    const worked = cpuMsPerCall(() => {
      for (let i = 0; i < 5_000_000; i++) sink += Math.sqrt(i); // about 35 ms of work on an M1 Pro
    }, 1);
    expect(sink).toBeGreaterThan(0);
    expect(worked).toBeGreaterThan(3); // far under what the work costs: a busy machine can add CPU time, never remove the work
    expect(cpuMicros()).toBeGreaterThan(before);
  });
});

describe('skipOverBudgetWhenLoaded', () => {
  it('returns when the figure is inside the budget, loaded or not', () => {
    expect(() => skipOverBudgetWhenLoaded(ctx, 'x', 2.9, 3, 'ms', 500)).not.toThrow();
    expect(() => skipOverBudgetWhenLoaded(ctx, 'x', 2.9, 3, 'ms', 0)).not.toThrow();
  });

  it('returns when the machine is quiet, so that the assertion after it fails the overrun', () => {
    expect(() => skipOverBudgetWhenLoaded(ctx, 'x', 30, 3, 'ms', LOAD_CEILING)).not.toThrow();
    expect(() => skipOverBudgetWhenLoaded(ctx, 'x', 30, 3, 'ms', 4.2)).not.toThrow();
  });

  it('skips by name, with the figures and the load, when the budget is exceeded on a loaded machine; and says so on stderr', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let note = '';
    try {
      skipOverBudgetWhenLoaded(ctx, 'prepare, a minute of standing', 25.04, 15, 'ms', 31.27);
    } catch (e) {
      expect(e).toBeInstanceOf(Skipped);
      note = (e as Error).message;
    }
    expect(note).toBe('prepare, a minute of standing: 25.04 ms against a budget of 15.00 ms cannot be judged, the machine load is 31.3 (above 20)');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('SKIPPED');
    expect(String(warn.mock.calls[0][0])).toContain(note);
  });

  it('a figure equal to the budget is over it (the assertions are strict: toBeLessThan)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => skipOverBudgetWhenLoaded(ctx, 'x', 3, 3, 'ms', 99)).toThrow(Skipped);
  });
});
