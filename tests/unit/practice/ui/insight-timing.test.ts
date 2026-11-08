/**
 * When the coach reads a dead ball (CODEX-REQUESTS item 15; Track D P9: the ref-6 freeze as the stumps broke): never
 * while the ball is live or its consequence is on screen, and then in slices (no simulation starts once a task
 * has spent INSIGHT_SLICE_MS), with output identical to the synchronous analysis.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as physics from '@/physics';
import { analyzeBall, analyzeBallInSlices, clearCoachCache } from '@/practice/coach';
import { yieldToRendering } from '@/practice/ui/flow/coachLoop';
import { INSIGHT_AFTER_DEAD_MS, INSIGHT_SLICE_MS } from '@/practice/ui/flow/state';
import { referenceRecord, swingFor } from '../coach/fixtures';
import { fakeCoach } from './fakeCoach';
import { attack, defend, quickPlay, setup, until, useFakeTimers } from './flowSetup';

vi.mock('@/physics', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/physics')>();
  return { ...real, resolveDelivery: vi.fn(real.resolveDelivery) };
});

describe('the flow: after the dead ball, in slices that let frames be drawn', () => {
  beforeEach(() => useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function recording() {
    const coach = fakeCoach();
    const calls: Array<{ at: number; sliceMs?: number; yieldTo?: unknown }> = [];
    const inner = coach.analyzeBallInSlices;
    coach.analyzeBallInSlices = (record, result, opts) => {
      calls.push({ at: performance.now(), sliceMs: opts?.sliceMs, yieldTo: opts?.yieldTo });
      return inner(record, result, opts);
    };
    return { coach, calls };
  }

  it('the coach starts reading only INSIGHT_AFTER_DEAD_MS after the dead ball, in slices', async () => {
    const { coach, calls } = recording();
    const { flow, swings } = setup({ deps: { coach } });
    flow.init();
    swings.push(attack());
    await quickPlay(flow);
    let deadAt = -1;
    flow.subscribe(() => {
      if (deadAt < 0 && flow.getState().phase === 'dead') deadAt = performance.now();
    });
    await until(() => flow.getState().phase === 'dead');
    expect(flow.getState().insight?.status).toBe('working');
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(INSIGHT_AFTER_DEAD_MS - 100);
    expect(calls).toHaveLength(0);
    await until(() => flow.getState().insight?.status === 'ready');
    expect(calls).toHaveLength(1);
    expect(calls[0].at - deadAt).toBeGreaterThanOrEqual(INSIGHT_AFTER_DEAD_MS);
    expect(INSIGHT_SLICE_MS).toBeLessThanOrEqual(8);
    expect(calls[0].sliceMs).toBe(INSIGHT_SLICE_MS);
    expect(calls[0].yieldTo).toBe(yieldToRendering);
  });

  it('"Next ball" during the consequence: that ball is never read, and the next one is', async () => {
    const { coach, calls } = recording();
    const { flow, swings } = setup({ deps: { coach } });
    flow.init();
    swings.push(defend(), defend());
    await quickPlay(flow);
    await until(() => flow.getState().phase === 'dead');
    flow.nextBall();
    await until(
      () => flow.getState().phase === 'dead' && (flow.getState().innings?.current?.deliveries.length ?? 0) === 2,
    );
    await until(() => flow.getState().insight?.status === 'ready');
    expect(calls).toHaveLength(1);
    expect(flow.getState().insight?.key.endsWith('.1')).toBe(true);
  });

  it('a Coach Mode attempt is read the same way: after its consequence, in slices', async () => {
    const { coach, calls } = recording();
    const { flow, swings } = setup({ deps: { coach } });
    flow.init();
    swings.push(defend());
    await quickPlay(flow);
    await until(() => flow.getState().insight?.status === 'ready');
    swings.push(defend());
    flow.coachLoop.practiceThisBall();
    await until(() => (flow.getState().coach?.attempts.length ?? 0) === 1 && flow.getState().phase === 'idle');
    const attemptRead = calls.at(-1)!;
    expect(attemptRead.sliceMs).toBe(INSIGHT_SLICE_MS);
    expect(attemptRead.yieldTo).toBe(yieldToRendering);
  });
});

describe('the reading itself (real coach and physics)', () => {
  const resolve = physics.resolveDelivery as unknown as ReturnType<typeof vi.fn>;

  for (const [id, swing] of [
    ['ref-1', null],
    ['ref-6', 'defend'],
  ] as const) {
    it(`${id}: no simulation starts once a task has spent its slice, and the result is byte-identical to analyzeBall`, async () => {
      const base = referenceRecord(id, 'real');
      const record = { ...base, swing: swing ? swingFor(base, { kind: 'defend', footwork: 'forward' }) : null };
      clearCoachCache();
      // Each simulation's start, as an offset into the task it ran in (a task begins after every yield).
      let taskStart = performance.now();
      const starts: number[][] = [[]];
      const real = resolve.getMockImplementation() as (args: unknown) => unknown;
      resolve.mockImplementation((args: unknown) => {
        starts.at(-1)!.push(performance.now() - taskStart);
        return real(args);
      });
      let yields = 0;
      const sliced = await analyzeBallInSlices(record, null, {
        sliceMs: INSIGHT_SLICE_MS,
        yieldTo: async () => {
          yields++;
          await yieldToRendering();
          taskStart = performance.now();
          starts.push([]);
        },
      });
      resolve.mockImplementation(real);
      expect(yields).toBeGreaterThan(0);
      // Every simulation but a task's last began inside the slice: a task is the slice plus at most one simulation.
      // (The first task also rebuilds the delivery before the slice clock starts, so it is measured from the yields on.)
      const late = starts.slice(1).flatMap((task) => task.slice(0, -1).filter((t) => t >= INSIGHT_SLICE_MS));
      expect(late).toEqual([]);
      clearCoachCache();
      expect(JSON.stringify(sliced)).toBe(JSON.stringify(analyzeBall(record)));
    }, 60_000);
  }
});
