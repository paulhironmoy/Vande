import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsEventName, AnalyticsProps, NormalizedSwing } from '@/contracts';
import { ANALYTICS_EVENTS, PROP_RULES, sanitizeProps } from '@/analytics';
import { ANALYTICS_PROP_KEYS } from '@/contracts';
import { loadCachedAssessment } from '@/perf';
import { PRACTICE_KEYS, loadInnings, loadMetrics, loadPracticeSettings, memoryStore, updatePracticeSettings, type KeyStore } from '@/practice/store';
import { COACH_MS, PracticeFlow, type FlowDeps } from '@/practice/ui/flow/controller';
import { assessment, fakeEngine, stageFactory } from './fakes';

const attack = (power = 0.6, directionDeg = 30): NormalizedSwing => ({ kind: 'attack', startT: 0.38, directionDeg, power, elevation: 0, footwork: 'auto' });
const defend = (): NormalizedSwing => ({ kind: 'defend', startT: 0.38, directionDeg: 0, power: 0.2, elevation: 0, footwork: 'auto' });
const caught = () => attack(0.6, 180);

function setup(o: { store?: KeyStore; tier?: 'full' | 'assisted' | 'below'; fail3d?: boolean; lateReleaseMs?: number; deps?: Partial<FlowDeps> } = {}) {
  const store = o.store ?? memoryStore();
  const engine = fakeEngine();
  const createStage = stageFactory(store, { fail3d: o.fail3d, lateReleaseMs: o.lateReleaseMs });
  const events: Array<[AnalyticsEventName, AnalyticsProps | undefined]> = [];
  const swings: Array<NormalizedSwing | 'leave'> = [];
  const benchmark = vi.fn(async () => assessment(o.tier ?? 'full'));
  let n = 0;
  const flow = new PracticeFlow({
    engine,
    createStage,
    appVersion: '1.0.0',
    store,
    benchmark,
    analytics: (e, p) => events.push([e, p]),
    hooks: { takeSwing: () => swings.shift() ?? null },
    newSeed: () => `seed${n++}`,
    newId: () => `inn${n++}`,
    isLandscape: () => true,
    frameSampler: () => ({ start() {}, stop() {}, running: false }),
    ...o.deps,
  });
  let key = -1;
  const attach = () => {
    const k = flow.getState().canvasKey;
    if (k !== key) {
      key = k;
      flow.attachCanvas(document.createElement('canvas'));
    }
  };
  flow.subscribe(attach);
  attach();
  return { flow, store, engine, createStage, events, swings, benchmark };
}

async function until(pred: () => boolean, maxMs = 200_000): Promise<void> {
  for (let t = 0; t < maxMs; t += 50) {
    if (pred()) return;
    await vi.advanceTimersByTimeAsync(50);
  }
  throw new Error('condition not reached');
}

const savedInnings = (store: KeyStore) => loadInnings(store);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('first-time experience', () => {
  it('a new player goes straight to a non-scoring warm-up, then the guided over counts', async () => {
    const { flow, store, swings, engine } = setup();
    expect(flow.init()).toBe('guided');
    swings.push(defend());
    void flow.startGuided();
    await until(() => flow.getState().phase === 'warmup_explain');
    const st = flow.getState();
    expect(st.last?.kind).toBe('warmup');
    expect(st.innings).toBeNull();
    expect(savedInnings(store)).toBeNull();
    expect(engine.calls.filter((c) => c.startsWith('flight:'))).toEqual(['flight:seed0:w']);
    flow.startGuidedOver();
    expect(loadPracticeSettings(store).guidedDone).toBe(true);
    expect(flow.getState().innings?.current?.plan.source).toBe('guided');
    expect(flow.getState().innings?.assist).toBe('learn');
    swings.push(...Array.from({ length: 6 }, () => attack(0.6)));
    await until(() => flow.getState().screen === 'over_summary');
    expect(flow.getState().innings?.runs).toBe(24);
    expect(flow.getState().innings?.balls).toBe(6);
  });

  it('records time to first delivery once, as a bucket', async () => {
    const { flow, swings, events } = setup({ deps: { openedAt: 0 } });
    flow.init();
    swings.push(defend());
    void flow.startGuided();
    await until(() => flow.getState().phase === 'warmup_explain');
    const ttfd = events.filter(([e]) => e === 'practice_first_delivery');
    expect(ttfd).toHaveLength(1);
    expect(ttfd[0][1]?.ttfdBucket).toBe('<5s');
  });
});

describe('the innings', () => {
  it('saves the in-flight flag before each delivery is bowled, and the record before it is shown', async () => {
    const { flow, store, swings, createStage } = setup();
    updatePracticeSettings({ guidedDone: true }, store);
    flow.init();
    swings.push(attack(0.6), defend(), 'leave', attack(0.9), attack(0.3), defend());
    void flow.startRandom();
    await until(() => flow.getState().phase === 'radar');
    flow.fieldReady();
    await until(() => flow.getState().screen === 'over_summary');
    const log = createStage.stages[0].log;
    const bowls = log.filter((e) => e.call === 'bowl');
    const plays = log.filter((e) => e.call === 'play');
    expect(bowls).toHaveLength(6);
    bowls.forEach((e, i) => {
      expect(e.saved?.inFlight).toEqual({ overIndex: 0, ballIndex: i });
      expect(e.saved?.balls).toBe(i);
    });
    plays.forEach((e, i) => {
      expect(e.saved?.inFlight).toBeNull();
      expect(e.saved?.balls).toBe(i + 1);
    });
    const s = flow.getState().innings!;
    expect(s.status).toBe('over_complete');
    expect(s.runs).toBe(4 + 0 + 0 + 6 + 1 + 0);
    expect(s.overs[0].deliveries.map((d) => d.swing?.kind ?? null)).toEqual(['attack', 'defend', null, 'attack', 'attack', 'defend']);
  });

  it('the scoreboard changes only after the stage has shown the ball', async () => {
    const { flow, store, swings } = setup();
    updatePracticeSettings({ guidedDone: true }, store);
    flow.init();
    swings.push(attack(0.9));
    void flow.startRandom();
    await until(() => flow.getState().phase === 'radar');
    flow.fieldReady();
    await until(() => flow.getState().phase === 'playing');
    expect(flow.getState().innings?.runs).toBe(6);
    expect(flow.getState().board.runs).toBe(0);
    await until(() => flow.getState().phase === 'coaching');
    expect(flow.getState().board.runs).toBe(6);
  });

  it('one wicket on any ball ends the innings at once', async () => {
    const { flow, store, swings, createStage, events } = setup();
    updatePracticeSettings({ guidedDone: true }, store);
    flow.init();
    swings.push(attack(0.6), defend(), caught(), attack(0.9));
    void flow.startRandom();
    await until(() => flow.getState().phase === 'radar');
    flow.fieldReady();
    await until(() => flow.getState().screen === 'out');
    const s = flow.getState().innings!;
    expect(s.status).toBe('out');
    expect(s.balls).toBe(3);
    expect(s.dismissal?.record.ballIndex).toBe(2);
    expect(createStage.stages[0].calls().filter((c) => c === 'bowl')).toHaveLength(3);
    expect(events.map(([e]) => e)).toEqual(expect.arrayContaining(['practice_wicket', 'practice_innings_completed']));
    expect(events.find(([e]) => e === 'practice_innings_completed')?.[1]?.outcome).toBe('out');
    // Nothing more is bowled after the wicket.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(createStage.stages[0].calls().filter((c) => c === 'bowl')).toHaveLength(3);
  });

  it('a full over before the next; runs accumulate; ten overs complete the innings', async () => {
    const { flow, store, swings, events } = setup();
    updatePracticeSettings({ guidedDone: true }, store);
    flow.init();
    void flow.startRandom();
    for (let over = 1; over <= 10; over++) {
      swings.push(...Array.from({ length: 6 }, () => attack(0.3)));
      await until(() => flow.getState().phase === 'radar');
      flow.fieldReady();
      if (over < 10) {
        await until(() => flow.getState().screen === 'over_summary');
        expect(flow.getState().innings?.overs).toHaveLength(over);
        expect(flow.getState().innings?.runs).toBe(6 * over);
        void flow.nextOver();
      }
    }
    await until(() => flow.getState().screen === 'complete');
    const s = flow.getState().innings!;
    expect(s.status).toBe('complete');
    expect(s.overs).toHaveLength(10);
    expect(s.balls).toBe(60);
    expect(s.runs).toBe(60);
    expect(events.filter(([e]) => e === 'practice_next_over')).toHaveLength(9);
    expect(events.filter(([e]) => e === 'practice_over_completed')).toHaveLength(10);
    expect(events.filter(([e]) => e === 'practice_innings_completed')).toHaveLength(1);
  }, 60_000);

  it('auto-advances between balls, and "Next ball" skips the wait', async () => {
    const { flow, store, swings, createStage } = setup();
    updatePracticeSettings({ guidedDone: true }, store);
    flow.init();
    swings.push(defend(), defend());
    void flow.startRandom();
    await until(() => flow.getState().phase === 'radar');
    flow.fieldReady();
    await until(() => flow.getState().phase === 'coaching');
    flow.nextBall();
    await vi.advanceTimersByTimeAsync(10);
    expect(flow.getState().phase).toBe('runup');
    await until(() => flow.getState().phase === 'coaching');
    await vi.advanceTimersByTimeAsync(COACH_MS + 50);
    expect(createStage.stages[0].calls().filter((c) => c === 'bowl')).toHaveLength(3);
  });

  it('never pauses during a delivery', async () => {
    const { flow, store } = setup();
    updatePracticeSettings({ guidedDone: true }, store);
    flow.init();
    void flow.startRandom();
    await until(() => flow.getState().phase === 'radar');
    flow.fieldReady();
    await until(() => flow.getState().phase === 'live');
    flow.pause();
    expect(flow.getState().phase).toBe('live');
  });
});

describe('no save-scumming', () => {
  it('a reload with a ball in flight resumes it as a leave, never a fresh ball', async () => {
    const a = setup();
    updatePracticeSettings({ guidedDone: true }, a.store);
    a.flow.init();
    void a.flow.startRandom();
    await until(() => a.flow.getState().phase === 'radar');
    a.flow.fieldReady();
    await until(() => a.flow.getState().phase === 'live');
    expect(savedInnings(a.store)?.inFlight).toEqual({ overIndex: 0, ballIndex: 0 });
    // The app is killed here: nothing else of the first visit runs.
    vi.clearAllTimers();
    const b = setup({ store: a.store });
    expect(b.flow.init()).toBe('menu');
    const s = b.flow.getState().innings!;
    expect(b.engine.calls).toContain('resume');
    expect(s.inFlight).toBeNull();
    expect(s.balls).toBe(1);
    expect(s.current?.deliveries[0].swing).toBeNull();
    expect(b.flow.getState().notice).toBe('resumed_leave');
    expect(savedInnings(a.store)?.balls).toBe(1);
    // Continuing bowls the second ball of the same fixed over.
    b.swings.push(defend());
    void b.flow.continueInnings();
    await until(() => b.flow.getState().phase === 'radar');
    b.flow.fieldReady();
    await until(() => b.flow.getState().phase === 'coaching');
    expect(b.engine.calls.filter((c) => c.startsWith('flight:'))).toEqual([`flight:${s.current!.plan.seed}:1`]);
  });

  it('leaving mid-delivery settles the ball as a leave at once', async () => {
    const { flow, store, engine } = setup();
    updatePracticeSettings({ guidedDone: true }, store);
    flow.init();
    void flow.startRandom();
    await until(() => flow.getState().phase === 'radar');
    flow.fieldReady();
    await until(() => flow.getState().phase === 'runup');
    flow.leave();
    expect(engine.calls).toContain('resume');
    expect(flow.getState().innings?.balls).toBe(1);
    expect(flow.getState().innings?.inFlight).toBeNull();
    expect(savedInnings(store)?.inFlight).toBeNull();
  });

  it('hiding the app during a delivery resolves it as a leave, then waits for the player', async () => {
    const { flow, store, swings } = setup();
    updatePracticeSettings({ guidedDone: true }, store);
    flow.init();
    swings.push(attack(0.9));
    void flow.startRandom();
    await until(() => flow.getState().phase === 'radar');
    flow.fieldReady();
    await until(() => flow.getState().phase === 'live');
    flow.setHidden(true);
    await until(() => flow.getState().phase === 'paused');
    const st = flow.getState();
    expect(st.last?.interrupted).toBe(true);
    expect(st.last?.result.swing).toBeNull();
    expect(st.innings?.runs).toBe(0);
    expect(st.notice).toBe('interrupted');
    await vi.advanceTimersByTimeAsync(COACH_MS * 2);
    expect(flow.getState().phase).toBe('paused');
    flow.resume();
    await vi.advanceTimersByTimeAsync(10);
    expect(flow.getState().phase).toBe('runup');
  });

  it('a ball settled because the app went away is still explained after a kill', async () => {
    const a = setup();
    updatePracticeSettings({ guidedDone: true }, a.store);
    a.flow.init();
    void a.flow.startRandom();
    await until(() => a.flow.getState().phase === 'radar');
    a.flow.fieldReady();
    await until(() => a.flow.getState().phase === 'live');
    // HOME (or a reload) fires "hidden" first: the ball is settled as a leave and saved…
    a.flow.setHidden(true);
    await until(() => savedInnings(a.store)?.balls === 1);
    // …then the OS kills the app before the player comes back.
    vi.clearAllTimers();
    const b = setup({ store: a.store });
    expect(b.flow.init()).toBe('menu');
    expect(b.flow.getState().notice).toBe('resumed_leave');
    expect(b.flow.getState().innings?.balls).toBe(1);
    expect(b.engine.calls).not.toContain('resume');
  });

  it('repeating a ball never touches the innings or its saved state', async () => {
    const { flow, store, swings, engine } = setup();
    updatePracticeSettings({ guidedDone: true }, store);
    flow.init();
    swings.push(...Array.from({ length: 6 }, () => defend()));
    void flow.startRandom();
    await until(() => flow.getState().phase === 'radar');
    flow.fieldReady();
    await until(() => flow.getState().screen === 'over_summary');
    const before = store.getItem(PRACTICE_KEYS.innings);
    const record = flow.getState().innings!.overs[0].deliveries[3];
    swings.push(attack(0.9));
    void flow.repeatBall(record);
    await until(() => flow.getState().phase === 'coaching' && flow.getState().last?.kind === 'repeat');
    expect(engine.calls).toContain('repeat');
    expect(flow.getState().last?.result.outcome.runs).toBe(6);
    expect(store.getItem(PRACTICE_KEYS.innings)).toBe(before);
    expect(flow.getState().innings?.runs).toBe(0);
    expect(loadMetrics(store).repeats).toBe(1);
    flow.backToSummary();
    expect(flow.getState().screen).toBe('over_summary');
  });
});

describe('a busy main thread never turns a swing into a leave', () => {
  it('a swing that started before the deadline counts even when its gesture arrives after it', async () => {
    const { flow, store } = setup();
    updatePracticeSettings({ guidedDone: true }, store);
    flow.init();
    void flow.startRandom();
    await until(() => flow.getState().phase === 'radar');
    flow.fieldReady();
    await until(() => flow.getState().phase === 'live');
    const release = performance.now();
    // The press lands in time (300 ms after release, before the 680 ms deadline)…
    await vi.advanceTimersByTimeAsync(300);
    flow.onSwingStart(performance.now());
    // …but the main thread is busy past the deadline before the gesture is handled.
    await vi.advanceTimersByTimeAsync(500);
    expect(flow.getState().phase).toBe('live');
    flow.onGesture({ pointer: 'touch', samples: [{ t: release + 300, x: 10, y: 10 }, { t: release + 340, x: 30, y: -20 }], surface: { width: 400, height: 200 } });
    await until(() => flow.getState().phase === 'coaching');
    expect(flow.getState().last?.result.swing?.kind).toBe('attack');
  });

  it('a swing due before the deadline wins even when the release itself was handled late', async () => {
    // The release callback runs 2 s late: every time in the delivery is already past when the flow schedules it.
    const { flow, store, swings } = setup({ lateReleaseMs: 2_000 });
    updatePracticeSettings({ guidedDone: true }, store);
    flow.init();
    swings.push(defend());
    void flow.startRandom();
    await until(() => flow.getState().phase === 'radar');
    flow.fieldReady();
    await until(() => flow.getState().phase === 'coaching');
    expect(flow.getState().last?.result.swing?.kind).toBe('defend');
  });

  it('no press at all is still a leave', async () => {
    const { flow, store } = setup();
    updatePracticeSettings({ guidedDone: true }, store);
    flow.init();
    void flow.startRandom();
    await until(() => flow.getState().phase === 'radar');
    flow.fieldReady();
    await until(() => flow.getState().phase === 'coaching');
    expect(flow.getState().last?.result.swing).toBeNull();
  });
});

describe('audio warm-up', () => {
  it('when no press has warmed audio yet, nothing is bowled until one "Start batting" tap', async () => {
    let warm = false;
    const { flow, store, createStage } = setup({ deps: { audioWarmed: () => warm } });
    updatePracticeSettings({ guidedDone: true }, store);
    flow.init();
    void flow.startRandom();
    await until(() => flow.getState().phase === 'radar');
    flow.fieldReady();
    await until(() => flow.getState().needTap);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(createStage.stages[0].calls()).not.toContain('bowl');
    warm = true; // the tap's own press warmed audio
    flow.tapped();
    await until(() => flow.getState().phase === 'live');
    expect(flow.getState().needTap).toBe(false);
    expect(createStage.stages[0].calls()).toContain('bowl');
  });

  it('a press that already warmed audio (the Practice tap) asks for nothing', async () => {
    const { flow, store } = setup({ deps: { audioWarmed: () => true } });
    updatePracticeSettings({ guidedDone: true }, store);
    flow.init();
    void flow.startRandom();
    await until(() => flow.getState().phase === 'radar');
    flow.fieldReady();
    await until(() => flow.getState().phase === 'live');
    expect(flow.getState().needTap).toBe(false);
  });
});

describe('replays', () => {
  it('Replay This Over plays the six recorded balls in order, then returns', async () => {
    const { flow, store, swings, createStage, events } = setup();
    updatePracticeSettings({ guidedDone: true }, store);
    flow.init();
    swings.push(...Array.from({ length: 6 }, () => attack(0.6)));
    void flow.startRandom();
    await until(() => flow.getState().phase === 'radar');
    flow.fieldReady();
    await until(() => flow.getState().screen === 'over_summary');
    flow.replayOver(0);
    await until(() => flow.getState().replay?.index === 5 && !flow.getState().replay?.playing);
    expect(createStage.stages[0].calls().filter((c) => c === 'replay')).toHaveLength(6);
    expect(events.some(([e]) => e === 'practice_replay')).toBe(true);
    flow.closeReplay();
    expect(flow.getState().screen).toBe('over_summary');
  });
});

describe('device tiers', () => {
  it('runs the device check once per app version', async () => {
    const a = setup();
    updatePracticeSettings({ guidedDone: true }, a.store);
    a.flow.init();
    void a.flow.startRandom();
    await until(() => a.flow.getState().phase === 'radar');
    expect(a.benchmark).toHaveBeenCalledTimes(1);
    expect(loadCachedAssessment('1.0.0', a.store)?.tier).toBe('full');
    a.flow.dispose();
    const b = setup({ store: a.store });
    b.flow.init();
    void b.flow.startRandom();
    await until(() => b.flow.getState().phase === 'radar');
    expect(b.benchmark).not.toHaveBeenCalled();
  });

  it('below the cutoff: no first-person stage; Classic practice on the 2D stage', async () => {
    const { flow, store, createStage } = setup({ tier: 'below' });
    updatePracticeSettings({ guidedDone: true }, store);
    flow.init();
    void flow.startRandom();
    await until(() => flow.getState().screen === 'compat');
    expect(createStage.stages[0].kind).toBe('3d');
    expect(createStage.stages[0].disposed).toBe(true);
    void flow.playClassic();
    await until(() => flow.getState().phase === 'radar');
    expect(createStage.stages[1].kind).toBe('2d');
    expect(flow.getState().quality).toMatchObject({ stage: '2d', tier: 'below', toleranceMs: 20 });
  });

  it('a WebGL failure falls back to the compatibility message and Classic', async () => {
    const { flow, store, createStage, events } = setup({ fail3d: true, deps: { benchmark: async () => assessment('below') } });
    updatePracticeSettings({ guidedDone: true }, store);
    flow.init();
    void flow.startRandom();
    await until(() => flow.getState().screen === 'compat');
    expect(events.some(([e, p]) => e === 'renderer_fallback' && p?.reason)).toBe(true);
    void flow.playClassic();
    await until(() => flow.getState().phase === 'radar');
    expect(createStage.stages.at(-1)?.kind).toBe('2d');
  });

  it('quality steps down only between balls, after the frame rate stays low', async () => {
    const { flow, store, swings, createStage } = setup({
      deps: { frameSampler: (on) => ({ start: () => Array.from({ length: 60 }, () => on(40)).length && undefined, stop() {}, running: false }) },
    });
    updatePracticeSettings({ guidedDone: true }, store);
    flow.init();
    swings.push(defend(), defend(), defend(), defend(), defend());
    void flow.startRandom();
    await until(() => flow.getState().phase === 'radar');
    flow.fieldReady();
    await until(() => (flow.getState().innings?.balls ?? 0) >= 5 && flow.getState().phase === 'coaching');
    const calls = createStage.stages[0].calls();
    const i = calls.indexOf('setProfile:lite');
    expect(i).toBeGreaterThan(-1);
    // Never between a bowl and its play.
    const lastBowl = calls.lastIndexOf('bowl', i);
    const lastPlay = calls.lastIndexOf('play', i);
    expect(lastPlay).toBeGreaterThan(lastBowl);
    expect(flow.getState().quality).toMatchObject({ tier: 'assisted', profile: 'lite', toleranceMs: 12 });
    const recs = flow.getState().innings!.current!.deliveries;
    expect(recs[0].tierToleranceMs).toBe(0);
    expect(recs[recs.length - 1].tierToleranceMs).toBe(12);
  });
});

describe('analytics', () => {
  it('sends only the closed dictionary with closed properties (no ids, no gestures)', async () => {
    const { flow, store, swings, events } = setup();
    updatePracticeSettings({ guidedDone: true }, store);
    flow.init();
    swings.push(attack(0.6), caught());
    void flow.startRandom();
    await until(() => flow.getState().phase === 'radar');
    flow.fieldReady();
    await until(() => flow.getState().screen === 'out');
    expect(events.length).toBeGreaterThan(3);
    for (const [e, p] of events) {
      expect(ANALYTICS_EVENTS).toContain(e);
      for (const k of Object.keys(p ?? {})) expect(ANALYTICS_PROP_KEYS).toContain(k);
      expect(sanitizeProps(p ?? {})).toEqual(p ?? {});
    }
    const delivery = events.find(([e]) => e === 'practice_delivery')?.[1];
    expect(delivery).toMatchObject({ mode: 'practice', assist: 'learn', tier: 'full', timing: 'on_time', outcome: 'four', latencyBucket: '<50ms' });
    expect(Object.keys(PROP_RULES)).toEqual(expect.arrayContaining(Object.keys(delivery ?? {})));
  });
});
