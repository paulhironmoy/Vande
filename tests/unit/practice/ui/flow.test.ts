import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANALYTICS_EVENTS, PROP_RULES, sanitizeProps } from '@/analytics';
import { ANALYTICS_PROP_KEYS } from '@/contracts';
import { PRACTICE_KEYS, loadInnings, type KeyStore } from '@/practice/store';
import type { OneGestureState } from '@/input';
import { attack, caught, defend, quickPlay, setup, until, useFakeTimers } from './flowSetup';

const saved = (store: KeyStore) => loadInnings(store);
const contactState = (patch: Partial<OneGestureState> = {}): OneGestureState => ({
  phase: 'loading',
  atPerfMs: 200,
  pressAtPerfMs: 100,
  timingAtPerfMs: null,
  pointer: 'touch',
  pullbackDepth: 0.4,
  pullbackIntent: 0.55,
  lateralAdjustment: 0.2,
  aggression: 0.36,
  elevationIntent: 0,
  forwardBearingDeg: null,
  forwardVelocity: 0,
  pathPower: 0,
  committed: false,
  ...patch,
});

beforeEach(() => useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('PREPARE: the setup screen', () => {
  it('a Random Over opens the setup with balanced defaults and prepares the stage behind it, before Play', async () => {
    const { flow, engine, createStage, benchmark } = setup();
    expect(flow.init()).toBe('menu');
    flow.prepareOver({ kind: 'random' });
    const st = flow.getState();
    expect(st.screen).toBe('setup');
    expect(st.pending).toMatchObject({ kind: 'random', conditions: 'balanced', continuing: false, overNumber: 1 });
    expect(st.pending?.intent?.intention).toBe('save_singles');
    expect(engine.calls).toContain('randomOver:club:balanced:any');
    // Discreet: the device check runs while the setup is read, and nothing is committed yet.
    await until(() => flow.getState().stageReady);
    expect(benchmark).toHaveBeenCalledTimes(1);
    expect(flow.getState().innings).toBeNull();
    expect(createStage.stages[0].calls()).not.toContain('bowl');
  });

  it('a Random Over regenerates when its choices change, and Back commits nothing', () => {
    const { flow, engine, store } = setup();
    flow.init();
    flow.prepareOver({ kind: 'random', random: { difficulty: 'beginner', conditions: 'green', bowling: 'pace' } });
    expect(engine.calls).toContain('randomOver:beginner:green:pace');
    flow.updateRandom({ difficulty: 'expert', conditions: 'turning', bowling: 'spin' });
    expect(engine.calls).toContain('randomOver:expert:turning:spin');
    expect(flow.getState().pending?.conditions).toBe('turning');
    flow.cancelSetup();
    expect(flow.getState().screen).toBe('idle');
    expect(store.getItem(PRACTICE_KEYS.innings)).toBeNull();
  });

  it('Play commits the over and bowls at once', async () => {
    const { flow, store, swings } = setup();
    flow.init();
    swings.push(defend());
    await quickPlay(flow);
    expect(saved(store)?.current?.plan.source).toBe('random');
    expect(flow.getState().overKind).toBe('random');
  });
});

describe('the innings', () => {
  it('uses a language change for future run-up and outcome announcements without rebuilding the flow', async () => {
    const { flow } = setup({
      deps: {
        words: {
          runup: (n) => `old run-up ${n}`,
          outcome: () => 'old outcome',
        },
      },
    });
    flow.init();
    flow.setLanguage('hi', 'localized ready cue', {
      runup: (n) => `new run-up ${n}`,
      outcome: () => 'new outcome',
    });
    await quickPlay(flow);
    await until(() => flow.getState().phase === 'runup');
    expect(flow.getState().announce?.text).toBe('new run-up 1');
    await until(() => flow.getState().phase === 'dead');
    expect(flow.getState().announce?.text).toBe('new outcome');
    flow.dispose();
  });

  it('a waiting press prepares the grip; only committed intent starts the visible stroke', async () => {
    const { flow, createStage } = setup();
    flow.init();
    await quickPlay(flow);
    await until(() => flow.getState().phase === 'live');
    const stage = createStage.stages[0];
    const begin = vi.spyOn(stage, 'beginSwing');
    const press = performance.now();
    flow.onSwingStart(press, 'touch');
    expect(stage.calls()).toContain('prepareSwing');
    expect(begin).not.toHaveBeenCalled();
    flow.onContactState(contactState());
    expect(stage.contactStates.at(-1)).toMatchObject({ phase: 'loading', pathPower: 0, committed: false });
    expect(stage.calls()).toContain('contact:loading');
    await vi.advanceTimersByTimeAsync(300);
    expect(begin).not.toHaveBeenCalled();
    const onset = performance.now();
    flow.onSwingIntent({ atPerfMs: onset, pointer: 'touch' });
    expect(begin).toHaveBeenCalledExactlyOnceWith(onset, 0);
    expect(flow.getState().innings?.balls).toBe(0);
    flow.onContactState(contactState({ phase: 'cancelled' }));
    flow.onGestureCancel();
    expect(stage.contactStates.at(-1)?.phase).toBe('cancelled');
    expect(stage.calls()).toContain('cancelSwing');
    flow.onSwingStart(onset + 20, 'touch');
    flow.onSwingIntent({ atPerfMs: onset + 30, pointer: 'touch' });
    flow.onContactState(
      contactState({
        phase: 'committing',
        timingAtPerfMs: onset + 30,
        committed: true,
        forwardBearingDeg: 25,
        forwardVelocity: 3,
        pathPower: 0.48,
      }),
    );
    expect(stage.contactStates.at(-1)).toMatchObject({
      phase: 'committing',
      forwardBearingDeg: 25,
      pathPower: 0.48,
      committed: true,
    });
    expect(begin).toHaveBeenLastCalledWith(onset + 30, 0);
    expect(begin).toHaveBeenCalledTimes(2);
    flow.dispose();
  });

  it('saves the in-flight flag before each delivery is bowled, and the record before it is shown', async () => {
    const { flow, swings, createStage } = setup({ autoNext: true });
    flow.init();
    swings.push(attack(0.6), defend(), 'leave', attack(0.9), attack(0.3), defend());
    await quickPlay(flow);
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
  });

  it('the score changes only after the stage has shown the ball', async () => {
    const { flow, swings } = setup();
    flow.init();
    swings.push(attack(0.9));
    await quickPlay(flow);
    await until(() => flow.getState().phase === 'playing');
    expect(flow.getState().innings?.runs).toBe(6);
    expect(flow.getState().board.runs).toBe(0);
    await until(() => flow.getState().phase === 'dead');
    expect(flow.getState().board.runs).toBe(6);
  });

  it('nothing advances by itself after a dead ball: the player chooses (Next ball)', async () => {
    const { flow, swings, createStage } = setup();
    flow.init();
    swings.push(defend(), defend());
    await quickPlay(flow);
    await until(() => flow.getState().phase === 'dead');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(flow.getState().phase).toBe('dead');
    expect(createStage.stages[0].calls().filter((c) => c === 'bowl')).toHaveLength(1);
    flow.nextBall();
    await until(() => flow.getState().phase === 'dead' && (flow.getState().innings?.balls ?? 0) === 2);
    expect(createStage.stages[0].calls().filter((c) => c === 'bowl')).toHaveLength(2);
  });

  it('one wicket on any ball ends the innings at once', async () => {
    const { flow, swings, createStage, events } = setup({ autoNext: true });
    flow.init();
    swings.push(attack(0.6), defend(), caught(), attack(0.9));
    await quickPlay(flow);
    await until(() => flow.getState().screen === 'out');
    const s = flow.getState().innings!;
    expect(s).toMatchObject({ status: 'out', balls: 3 });
    expect(s.dismissal?.record.ballIndex).toBe(2);
    expect(events.map(([e]) => e)).toEqual(expect.arrayContaining(['practice_wicket', 'practice_innings_completed']));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(createStage.stages[0].calls().filter((c) => c === 'bowl')).toHaveLength(3);
  });

  it('a full over before the next; runs accumulate; ten overs complete the innings', async () => {
    const { flow, swings, events } = setup({ autoNext: true });
    flow.init();
    swings.push(...Array.from({ length: 6 }, () => attack(0.3)));
    await quickPlay(flow);
    for (let over = 1; over < 10; over++) {
      await until(() => flow.getState().screen === 'over_summary');
      expect(flow.getState().innings).toMatchObject({ runs: 6 * over });
      swings.push(...Array.from({ length: 6 }, () => attack(0.3)));
      flow.prepareOver({ kind: 'random' });
      expect(flow.getState().pending).toMatchObject({ continuing: true, overNumber: over + 1 });
      void flow.play();
    }
    await until(() => flow.getState().screen === 'complete');
    expect(flow.getState().innings).toMatchObject({ status: 'complete', balls: 60, runs: 60 });
    expect(events.filter(([e]) => e === 'practice_next_over')).toHaveLength(9);
    expect(events.filter(([e]) => e === 'practice_innings_completed')).toHaveLength(1);
  }, 60_000);

  it('never pauses during a delivery', async () => {
    const { flow } = setup();
    flow.init();
    await quickPlay(flow);
    await until(() => flow.getState().phase === 'live');
    flow.pause();
    expect(flow.getState().phase).toBe('live');
    await until(() => flow.getState().phase === 'dead');
    flow.pause();
    expect(flow.getState().phase).toBe('paused');
    flow.resume();
    expect(flow.getState().phase).toBe('dead');
  });

  it('Restart over: the same over again from ball 1, its runs removed (between balls only)', async () => {
    const { flow, swings, engine } = setup();
    flow.init();
    swings.push(attack(0.9), defend());
    await quickPlay(flow);
    await until(() => flow.getState().phase === 'dead');
    flow.nextBall();
    await until(() => flow.getState().phase === 'dead' && flow.getState().innings?.balls === 2);
    const seed = flow.getState().innings!.current!.plan.seed;
    expect(flow.restartOver()).toBe(true);
    expect(flow.getState().innings).toMatchObject({ runs: 0, balls: 0 });
    await until(() => engine.calls.filter((c) => c === `flight:${seed}:0`).length === 2);
  });
});

describe('no save-scumming', () => {
  it('a reload with a ball in flight resumes it as a leave, never a fresh ball', async () => {
    const a = setup();
    a.flow.init();
    await quickPlay(a.flow);
    await until(() => a.flow.getState().phase === 'live');
    expect(saved(a.store)?.inFlight).toEqual({ overIndex: 0, ballIndex: 0 });
    vi.clearAllTimers();
    const b = setup({ store: a.store });
    expect(b.flow.init()).toBe('menu');
    const s = b.flow.getState().innings!;
    expect(b.engine.calls).toContain('resume');
    expect(s).toMatchObject({ inFlight: null, balls: 1 });
    expect(b.flow.getState().notice).toBe('resumed_leave');
    // Continue: the setup of the same over, then ball 2 of it.
    b.swings.push(defend());
    b.flow.continueInnings();
    expect(b.flow.getState().pending).toMatchObject({ continuing: true, bowled: 1 });
    await until(() => b.flow.getState().stageReady);
    void b.flow.play();
    await until(() => b.flow.getState().phase === 'dead');
    expect(b.engine.calls.filter((c) => c.startsWith('flight:'))).toEqual([`flight:${s.current!.plan.seed}:1`]);
  });

  it('leaving mid-delivery settles the ball as a leave at once', async () => {
    const { flow, store, engine } = setup();
    flow.init();
    await quickPlay(flow);
    await until(() => flow.getState().phase === 'runup');
    flow.leave();
    expect(engine.calls).toContain('resume');
    expect(flow.getState().innings).toMatchObject({ balls: 1, inFlight: null });
    expect(saved(store)?.inFlight).toBeNull();
  });

  it('hiding the app during a delivery resolves it as a leave, then waits for the player', async () => {
    const { flow, swings } = setup();
    flow.init();
    swings.push(attack(0.9));
    await quickPlay(flow);
    await until(() => flow.getState().phase === 'live');
    flow.setHidden(true);
    await until(() => flow.getState().phase === 'paused');
    const st = flow.getState();
    expect(st.last?.interrupted).toBe(true);
    expect(st.last?.result.swing).toBeNull();
    expect(st.notice).toBe('interrupted');
    flow.resume();
    expect(flow.getState().phase).toBe('dead');
  });

  it('a ball settled because the app went away is still explained after a kill', async () => {
    const a = setup();
    a.flow.init();
    await quickPlay(a.flow);
    await until(() => a.flow.getState().phase === 'live');
    a.flow.setHidden(true);
    await until(() => saved(a.store)?.balls === 1);
    vi.clearAllTimers();
    const b = setup({ store: a.store });
    b.flow.init();
    expect(b.flow.getState().notice).toBe('resumed_leave');
    expect(b.engine.calls).not.toContain('resume');
  });

  it('an innings from an older version of Practice is dropped calmly, never resumed', () => {
    const a = setup();
    a.store.setItem(
      PRACTICE_KEYS.innings,
      JSON.stringify({ v: 1, state: { version: 0, id: 'old', status: 'batting' } }),
    );
    expect(a.flow.init()).toBe('menu');
    expect(a.flow.getState().notice).toBe('updated');
    expect(a.store.getItem(PRACTICE_KEYS.innings)).toBeNull();
  });
});

describe('a busy main thread never turns a swing into a leave', () => {
  it('accepts a threshold detected after the deadline when its event-time departure was in time', async () => {
    const { flow } = setup();
    flow.init();
    await quickPlay(flow);
    await until(() => flow.getState().phase === 'live');
    const release = performance.now();
    await vi.advanceTimersByTimeAsync(700);
    expect(flow.getState().phase).toBe('live');

    flow.onSwingStart(release + 650);
    flow.onGesture({
      pointer: 'touch',
      samples: [
        { t: release + 650, x: 10, y: 10 },
        { t: release + 670, x: 30, y: -20 },
      ],
      surface: { width: 400, height: 200 },
    });

    await until(() => flow.getState().phase === 'dead');
    expect(flow.getState().last?.result.swing?.kind).toBe('attack');
  });

  it('rejects a gesture whose own departure is after the leave deadline during that arrival window', async () => {
    const { flow } = setup();
    flow.init();
    await quickPlay(flow);
    await until(() => flow.getState().phase === 'live');
    const release = performance.now();
    await vi.advanceTimersByTimeAsync(700);
    expect(flow.getState().phase).toBe('live');

    flow.onSwingStart(release + 700);
    flow.onGesture({
      pointer: 'touch',
      samples: [
        { t: release + 700, x: 10, y: 10 },
        { t: release + 730, x: 30, y: -20 },
      ],
      surface: { width: 400, height: 200 },
    });

    await until(() => flow.getState().phase === 'dead');
    expect(flow.getState().last?.result.swing).toBeNull();
  });

  it('a swing that started before the deadline counts even when its gesture arrives after it', async () => {
    const { flow } = setup();
    flow.init();
    await quickPlay(flow);
    await until(() => flow.getState().phase === 'live');
    const release = performance.now();
    await vi.advanceTimersByTimeAsync(300);
    flow.onSwingStart(performance.now());
    await vi.advanceTimersByTimeAsync(500);
    expect(flow.getState().phase).toBe('live');
    flow.onGesture({
      pointer: 'touch',
      samples: [
        { t: release + 300, x: 10, y: 10 },
        { t: release + 340, x: 30, y: -20 },
      ],
      surface: { width: 400, height: 200 },
    });
    await until(() => flow.getState().phase === 'dead');
    expect(flow.getState().last?.result.swing?.kind).toBe('attack');
  });

  it('a swing due before the deadline wins even when the release itself was handled late', async () => {
    const { flow, swings } = setup({ lateReleaseMs: 2_000 });
    flow.init();
    swings.push(defend());
    await quickPlay(flow);
    await until(() => flow.getState().phase === 'dead');
    expect(flow.getState().last?.result.swing?.kind).toBe('defend');
  });

  it('no press at all is a leave', async () => {
    const { flow } = setup();
    flow.init();
    await quickPlay(flow);
    await until(() => flow.getState().phase === 'dead');
    expect(flow.getState().last?.result.swing).toBeNull();
  });
});

describe('analytics', () => {
  it('sends only the closed dictionary with closed properties (no ids, no gestures)', async () => {
    const { flow, swings, events } = setup({ autoNext: true });
    flow.init();
    swings.push(attack(0.6), caught());
    await quickPlay(flow);
    await until(() => flow.getState().screen === 'out');
    expect(events.length).toBeGreaterThan(3);
    for (const [e, p] of events) {
      expect(ANALYTICS_EVENTS).toContain(e);
      for (const k of Object.keys(p ?? {})) expect(ANALYTICS_PROP_KEYS).toContain(k);
      expect(sanitizeProps(p ?? {})).toEqual(p ?? {});
    }
    const delivery = events.find(([e]) => e === 'practice_delivery')?.[1];
    expect(delivery).toMatchObject({
      mode: 'practice',
      assist: 'learn',
      tier: 'full',
      timing: 'on_time',
      outcome: 'four',
      latencyBucket: '<50ms',
    });
    expect(Object.keys(PROP_RULES)).toEqual(expect.arrayContaining(Object.keys(delivery ?? {})));
  });
});
