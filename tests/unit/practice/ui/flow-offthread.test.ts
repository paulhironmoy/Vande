/**
 * The flow with a work thread (src/practice/ui/flow/offThread.ts): the same innings, records and readings as without
 * one, the main thread never simulating a live ball or a reading itself, the reading starting at the dead ball, and
 * every way the worker can fail ending in the main thread's own computation (never a stuck ball or card). Fakes for
 * the physics and coach (./fakes.ts, ./fakeCoach.ts) on both sides, so the flow's own behaviour is what is tested; the
 * real physics and coach across threads are offthread-equality.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRACTICE_SIM_VERSION, type NormalizedSwing } from '@/contracts';
import { PRACTICE_KEYS, loadFormSamples } from '@/practice/store';
import { createOffThread, type OffThreadWork } from '@/practice/ui/flow/offThread';
import { INSIGHT_AFTER_DEAD_MS, INSIGHT_OFFTHREAD_AFTER_DEAD_MS, INSIGHT_SLICE_MS } from '@/practice/ui/flow/state';
import type { WorkKit } from '@/practice/worker/host';
import { fakeCoach } from './fakeCoach';
import { fakeEngine } from './fakes';
import { attack, caught, defend, quickPlay, setup, until, useFakeTimers } from './flowSetup';
import { BUILD, inProcessWorker, type HarnessOptions } from './workerHarness';

beforeEach(() => useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

/** The worker side runs its own instances of the same fakes, as a real worker runs its own copy of the modules. */
function fakeWorkKit(): WorkKit & { calls: string[] } {
  const engine = fakeEngine();
  const coach = fakeCoach();
  return {
    calls: engine.calls,
    resolveDelivery: engine.resolveDelivery,
    repeatDelivery: engine.repeatDelivery,
    analyzeBallInSlices: coach.analyzeBallInSlices,
    coachTip: coach.coachTip,
    formSample: coach.formSample,
    optionOf: coach.optionOf,
  };
}

function withWork(o: HarnessOptions = {}, extra: Partial<Parameters<typeof createOffThread>[0]> = {}) {
  const kit = fakeWorkKit();
  const h = inProcessWorker({ kit, yieldTask: () => Promise.resolve(), ...o });
  const work: OffThreadWork = createOffThread({
    build: BUILD,
    sim: PRACTICE_SIM_VERSION,
    spawn: () => h.port,
    ...extra,
  });
  return { kit, h, work };
}

/** The coach's main-thread readings, recorded (none should happen while the worker reads). */
function recordingCoach() {
  const coach = fakeCoach();
  const calls: Array<{ at: number; sliceMs?: number }> = [];
  const inner = coach.analyzeBallInSlices;
  coach.analyzeBallInSlices = (record, result, opts) => {
    calls.push({ at: performance.now(), sliceMs: opts?.sliceMs });
    return inner(record, result, opts);
  };
  return { coach, calls };
}

async function playOver(
  swingsIn: Array<NormalizedSwing | 'leave'>,
  deps: NonNullable<Parameters<typeof setup>[0]>['deps'] = {},
) {
  // Teaching off (setup's default): the first-run demonstration has its own test below.
  const t = setup({ deps });
  t.flow.init();
  t.swings.push(...swingsIn);
  await quickPlay(t.flow);
  // Main-thread physics from here on is the balls' (the setup screen's throwaway warm-up is before it).
  const mark = t.engine.calls.length;
  for (let i = 0; i < swingsIn.length; i++) {
    await until(() => t.flow.getState().phase === 'dead' && (t.flow.getState().innings?.balls ?? 0) === i + 1);
    await until(() => t.flow.getState().insight?.status === 'ready');
    if (i < swingsIn.length - 1) t.flow.nextBall();
  }
  return { ...t, ballCalls: () => t.engine.calls.slice(mark) };
}

const OVER: Array<NormalizedSwing | 'leave'> = [
  attack(0.6, 30),
  defend(),
  'leave',
  attack(0.9, 60),
  defend(),
  attack(0.5, 10),
];

describe('a ball resolved on the work thread', () => {
  it('gives the same innings, records, readings and saved evidence as the main thread alone', async () => {
    const alone = await playOver(OVER);
    const { work, kit } = withWork();
    const { coach, calls } = recordingCoach();
    const off = await playOver(OVER, { work, coach });
    const strip = (s: string | null) => (s ? JSON.parse(s) : null);
    const a = strip(alone.store.getItem(PRACTICE_KEYS.innings));
    const b = strip(off.store.getItem(PRACTICE_KEYS.innings));
    // The innings ids differ by construction (one id counter per setup); everything about the balls is the same.
    expect({ ...b, id: null, startedAt: null }).toEqual({ ...a, id: null, startedAt: null });
    expect(JSON.stringify(off.flow.getState().innings?.current?.deliveries)).toBe(
      JSON.stringify(alone.flow.getState().innings?.current?.deliveries),
    );
    expect(JSON.stringify(loadFormSamples(off.store))).toBe(JSON.stringify(loadFormSamples(alone.store)));
    expect(JSON.stringify(off.flow.getState().insight)).toBe(JSON.stringify({ ...alone.flow.getState().insight }));
    // The main thread simulated no live ball and read none; the worker did all six of each.
    expect(off.ballCalls().filter((c) => c === 'resolve')).toEqual([]);
    expect(alone.ballCalls().filter((c) => c === 'resolve')).toHaveLength(6);
    expect(calls).toEqual([]);
    expect(kit.calls.filter((c) => c === 'resolve').length).toBeGreaterThanOrEqual(6);
    expect(work.stats().balls.map((b) => b.path)).toEqual(Array(6).fill('worker'));
    expect(work.stats().reads.map((r) => r.path)).toEqual(Array(6).fill('worker'));
    // Each reading named the worker's own result instead of sending it back.
    expect(work.stats().reads.every((r) => r.reused)).toBe(true);
  });

  it('the coach reads it from the moment it is dead (no main-thread pacing is needed)', async () => {
    const { work } = withWork();
    const { flow, swings } = setup({ deps: { work } });
    flow.init();
    swings.push(attack());
    await quickPlay(flow);
    await until(() => flow.getState().phase === 'dead');
    const deadAt = performance.now();
    await until(() => flow.getState().insight?.status === 'ready');
    expect(INSIGHT_OFFTHREAD_AFTER_DEAD_MS).toBe(0);
    expect(performance.now() - deadAt).toBeLessThan(INSIGHT_AFTER_DEAD_MS);
  });

  it('leaving Practice while the worker computes commits the swing, exactly as the one-frame main-thread call did', async () => {
    // A worker that never answers the swing: the ball is mid-computation when the player leaves.
    const { work, h } = withWork({ drop: ['resolved'] }, { resolveTimeoutMs: 60_000 });
    const t = setup({ deps: { work } });
    t.flow.init();
    const swing = caught();
    t.swings.push(swing);
    await quickPlay(t.flow);
    await until(() => h.sent.some((m) => m.t === 'resolve'));
    expect(t.flow.getState().innings?.inFlight).not.toBeNull();
    t.flow.leave();
    const s = t.flow.getState();
    expect(s.innings?.inFlight).toBeNull();
    expect(s.notice).not.toBe('resumed_leave');
    const rec = s.innings!.current!.deliveries[0];
    expect(rec.swing).toEqual(swing);
    // The fake physics: an attack at 180° is caught. The swing's result stood; it did not become a leave.
    expect(rec.dismissal).toBe('caught');
    expect(work.stats().balls.at(-1)).toMatchObject({ path: 'local', reason: 'interrupted' });
    // And the same as without a worker, leaving right after the same swing.
    const alone = setup();
    alone.flow.init();
    alone.swings.push(swing);
    await quickPlay(alone.flow);
    await until(() => alone.flow.getState().phase === 'playing' || alone.flow.getState().phase === 'dead');
    alone.flow.leave();
    expect(JSON.stringify(alone.flow.getState().innings!.current!.deliveries[0])).toBe(JSON.stringify(rec));
  });

  it('the app going away while the worker computes: the swing is committed now and the ball plays on', async () => {
    const { work, h } = withWork({ drop: ['resolved'] }, { resolveTimeoutMs: 60_000 });
    const t = setup({ deps: { work } });
    t.flow.init();
    t.swings.push(attack(0.6, 30));
    await quickPlay(t.flow);
    await until(() => h.sent.some((m) => m.t === 'resolve'));
    t.flow.setHidden(true);
    expect(t.flow.getState().innings?.inFlight).toBeNull();
    expect(t.flow.getState().innings?.current?.deliveries[0].swing?.kind).toBe('attack');
    t.flow.setHidden(false);
    await until(() => t.flow.getState().phase === 'dead' || t.flow.getState().phase === 'paused');
  });

  it('a silent worker never holds the ball: after the bound the main thread resolves it, with the same result', async () => {
    const { work } = withWork({ drop: ['resolved'] }, { resolveTimeoutMs: 500 });
    const off = await playOver([attack(0.6, 30)], { work });
    const alone = await playOver([attack(0.6, 30)]);
    expect(work.stats().balls.at(-1)).toMatchObject({ path: 'local', reason: 'timeout' });
    expect(JSON.stringify(off.flow.getState().innings?.current?.deliveries)).toBe(
      JSON.stringify(alone.flow.getState().innings?.current?.deliveries),
    );
  });
});

describe('when the worker cannot read the ball, the main thread does, paced as before', () => {
  it('a worker error mid-reading: read here, and still only INSIGHT_AFTER_DEAD_MS after the dead ball, in slices', async () => {
    const { work } = withWork({ errorOn: 'analyze' });
    const { coach, calls } = recordingCoach();
    const { flow, swings, store } = setup({ deps: { work, coach } });
    flow.init();
    swings.push(attack());
    let deadAt = -1;
    flow.subscribe(() => {
      if (deadAt < 0 && flow.getState().phase === 'dead') deadAt = performance.now();
    });
    await quickPlay(flow);
    await until(() => flow.getState().phase === 'dead');
    await until(() => flow.getState().insight?.status === 'ready');
    expect(work.canWork()).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].at - deadAt).toBeGreaterThanOrEqual(INSIGHT_AFTER_DEAD_MS);
    expect(calls[0].sliceMs).toBe(INSIGHT_SLICE_MS);
    expect(loadFormSamples(store)).toHaveLength(1);
    // The next ball, with no worker left, is resolved here too and still plays.
    swings.push(defend());
    flow.nextBall();
    await until(() => flow.getState().phase === 'dead' && flow.getState().innings?.balls === 2);
    expect(work.stats().balls.at(-1)).toMatchObject({ path: 'local', reason: 'failed' });
  });

  it('no worker can be made: everything runs on the main thread, as it always did', async () => {
    const work = createOffThread({ build: BUILD, sim: PRACTICE_SIM_VERSION, spawn: () => null });
    const off = await playOver(OVER.slice(0, 3), { work });
    const alone = await playOver(OVER.slice(0, 3));
    expect(JSON.stringify(off.flow.getState().innings?.current?.deliveries)).toBe(
      JSON.stringify(alone.flow.getState().innings?.current?.deliveries),
    );
    expect(work.stats().balls.map((b) => b.reason)).toEqual(['no_worker', 'no_worker', 'no_worker']);
  });

  it('"Next ball" during a reading aborts it on the worker; the next ball is read, not the old one', async () => {
    const { work, h } = withWork({ later: (f) => setTimeout(f, 30) });
    const { flow, swings } = setup({ deps: { work } });
    flow.init();
    swings.push(defend(), defend());
    await quickPlay(flow);
    await until(() => flow.getState().phase === 'dead');
    await until(() => h.sent.some((m) => m.t === 'analyze'));
    flow.nextBall();
    await until(() => flow.getState().phase === 'dead' && flow.getState().innings?.balls === 2);
    await until(() => flow.getState().insight?.status === 'ready');
    expect(h.sent.some((m) => m.t === 'abort')).toBe(true);
    expect(flow.getState().insight?.key.endsWith('.1')).toBe(true);
  });
});

describe('Coach Mode and the demonstration on the work thread', () => {
  it('the demonstration simulated with the reading is used; attempts resolve and read off the main thread', async () => {
    const { work } = withWork();
    const { coach, calls } = recordingCoach();
    const { flow, swings, engine, createStage } = setup({ deps: { work, coach } });
    flow.init();
    swings.push(attack(0.6));
    await quickPlay(flow);
    const mark = engine.calls.length;
    await until(() => flow.getState().insight?.status === 'ready');
    swings.push(defend());
    flow.coachLoop.practiceThisBall();
    await until(
      () =>
        flow.getState().screen === 'coach' &&
        flow.getState().coach?.latest !== null &&
        flow.getState().phase === 'idle',
    );
    // No main-thread simulation at all: not the ball, not the guide, not the attempt, not its reading.
    expect(engine.calls.slice(mark).filter((c) => c === 'repeat' || c === 'resolve')).toEqual([]);
    expect(calls).toEqual([]);
    expect(createStage.stages[0].assistance).toContain(1);
    expect(flow.getState().coach?.attempts).toEqual([true]);
    void flow.coachLoop.coachDemonstrate();
    await until(() => createStage.stages[0].calls().includes('demonstrate'));
    expect(engine.calls.filter((c) => c === 'repeat')).toEqual([]);
  });

  it('the first-run demonstration is read on the worker; Skip stays live meanwhile', async () => {
    const { work, h } = withWork({ later: (f) => setTimeout(f, 200) });
    const { coach } = recordingCoach();
    const analyzeBall = vi.spyOn(coach, 'analyzeBall');
    const { flow, createStage } = setup({ teach: true, deps: { work, coach } });
    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    void flow.play();
    await until(() => flow.getState().phase === 'intro');
    await until(() => createStage.stages[0].calls().includes('demonstrate'));
    expect(analyzeBall).not.toHaveBeenCalled();
    expect(h.sent.some((m) => m.t === 'analyze' && m.want.guide)).toBe(true);
    await until(
      () => flow.getState().phase === 'ready' || flow.getState().phase === 'runup' || flow.getState().phase === 'live',
    );
  });
});
