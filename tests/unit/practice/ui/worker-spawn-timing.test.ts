/**
 * PERF4 (eval-platform VERDICT): the work thread's script must never be fetched inside a delivery. It is created as the
 * setup screen opens, on every path: here the Automatic one, where the real device check is still running (a slow
 * benchmark) when the setup screen shows, and a resumed innings. Its warm-up simulation still waits for the stage, so
 * it never competes with the device check.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRACTICE_SIM_VERSION } from '@/contracts';
import { createOffThread } from '@/practice/ui/flow/offThread';
import { assessment, fakeEngine } from './fakes';
import { fakeCoach } from './fakeCoach';
import { defend, setup, until, useFakeTimers } from './flowSetup';
import { BUILD, inProcessWorker } from './workerHarness';

beforeEach(() => useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

function work() {
  const engine = fakeEngine();
  const coach = fakeCoach();
  const h = inProcessWorker({
    kit: {
      resolveDelivery: engine.resolveDelivery,
      repeatDelivery: engine.repeatDelivery,
      analyzeBallInSlices: coach.analyzeBallInSlices,
      coachTip: coach.coachTip,
      formSample: coach.formSample,
      optionOf: coach.optionOf,
    },
    yieldTask: () => Promise.resolve(),
  });
  const spawn = vi.fn(() => h.port);
  return { h, spawn, work: createOffThread({ build: BUILD, sim: PRACTICE_SIM_VERSION, spawn }) };
}

/** The Automatic path: the device check takes 2.2 s, so the stage is not ready when the setup screen shows. */
const slowCheck =
  (ms = 2200) =>
  async () => {
    await new Promise((r) => setTimeout(r, ms));
    return assessment('full');
  };

describe('the work thread is created as the setup screen opens (PERF4)', () => {
  it('Automatic path: created at once, long before the first run-up; its warm-up waits for the stage', async () => {
    const w = work();
    const { flow, swings } = setup({ deps: { work: w.work, benchmark: slowCheck() } });
    flow.init();
    flow.prepareOver({ kind: 'random' });
    // The setup screen is open and the device check is still running: the worker already exists.
    expect(flow.getState().screen).toBe('setup');
    expect(flow.getState().stageReady).toBe(false);
    expect(w.spawn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(w.h.sent.map((m) => m.t)).toEqual(['hello']);
    // Only once the stage is ready does the warm-up simulation go to it.
    await until(() => flow.getState().stageReady);
    await until(() => w.h.sent.some((m) => m.t === 'warm'));
    // The first ball is then prepared on a worker that was created before it, and answered by it.
    swings.push(defend());
    void flow.play();
    await until(() => flow.getState().phase === 'dead');
    expect(w.spawn).toHaveBeenCalledTimes(1);
    expect(w.work.stats().balls.at(-1)?.path).toBe('worker');
  });

  it('a resumed innings (Continue): created as its setup screen opens', async () => {
    const first = setup();
    first.flow.init();
    first.swings.push(defend());
    first.flow.prepareOver({ kind: 'random' });
    await until(() => first.flow.getState().stageReady);
    void first.flow.play();
    await until(() => first.flow.getState().phase === 'dead');
    first.flow.dispose();
    const w = work();
    const again = setup({ store: first.store, deps: { work: w.work, benchmark: slowCheck() } });
    again.flow.init();
    again.flow.continueInnings();
    expect(again.flow.getState().screen).toBe('setup');
    expect(w.spawn).toHaveBeenCalledTimes(1);
  });
});
