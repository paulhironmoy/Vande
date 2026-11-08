import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCachedAssessment } from '@/perf';
import { PRACTICE_KEYS, allMastery, loadFormSamples, loadMastery, loadPracticeSettings } from '@/practice/store';
import type { AttemptComparison } from '@/contracts';
import { masteryConfirmation } from '@/practice/ui/flow/coachLoop';
import { fakeCoach } from './fakeCoach';
import { attack, defend, quickPlay, setup, until, useFakeTimers } from './flowSetup';

beforeEach(() => useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('UNDERSTAND: the dead ball', () => {
  it('shows the outcome at once and the coach’s one insight right after; form evidence is kept', async () => {
    const { flow, store, swings } = setup();
    flow.init();
    swings.push(attack(0.6));
    await quickPlay(flow);
    await until(() => flow.getState().phase === 'dead');
    await until(() => flow.getState().insight?.status === 'ready');
    expect(flow.getState().insight?.primary?.recommendation.kind).toBe('defend_forward');
    expect(loadFormSamples(store)).toHaveLength(1);
  });

  it('without the coach the dead ball still shows the outcome, and Coach Mode is not offered', async () => {
    const { flow } = setup({ coach: false });
    flow.init();
    await quickPlay(flow);
    await until(() => flow.getState().phase === 'dead');
    expect(flow.getState().insight).toBeNull();
    flow.coachLoop.practiceThisBall();
    expect(flow.getState().screen).toBe('live');
  });
});

describe('MASTER: exact-ball Coach Mode', () => {
  it('"Practice this ball" replays the exact ball at once (help 1), never touching the innings, and compares', async () => {
    const { flow, store, swings, engine, createStage } = setup();
    flow.init();
    swings.push(attack(0.6));
    await quickPlay(flow);
    await until(() => flow.getState().insight?.status === 'ready');
    const before = store.getItem(PRACTICE_KEYS.innings);
    swings.push(defend());
    flow.coachLoop.practiceThisBall();
    await until(
      () =>
        flow.getState().screen === 'coach' &&
        flow.getState().coach?.latest !== null &&
        flow.getState().phase === 'idle',
    );
    expect(engine.calls).toContain('repeat');
    expect(createStage.stages[0].assistance).toContain(1);
    expect(store.getItem(PRACTICE_KEYS.innings)).toBe(before);
    expect(flow.getState().innings?.balls).toBe(1);
    const c = flow.getState().coach!;
    expect(c.comparison?.changes).toEqual(['same_again']);
    expect(c.attempts).toEqual([true]);
    expect(loadMastery(c.key, store)?.attempts).toHaveLength(1);
    flow.coachLoop.leaveCoach();
    expect(flow.getState()).toMatchObject({ screen: 'live', phase: 'dead', coach: null });
    expect(createStage.stages[0].assistance.at(-1)).toBeNull();
  });

  it('help is removed only after repeatable success; identical repeats ("the same") progress quietly, never chiming', async () => {
    const { flow, swings, feels, store } = setup();
    flow.init();
    swings.push(defend());
    await quickPlay(flow);
    await until(() => flow.getState().insight?.status === 'ready');
    flow.coachLoop.practiceThisBall();
    await until(() => (flow.getState().coach?.attempts.length ?? 0) === 1 && flow.getState().phase === 'idle');
    const seen = [
      {
        verdict: flow.getState().coach!.comparison?.verdict,
        stage: flow.getState().coach!.mastery.stage,
        mastered: false,
        event: flow.getState().coach!.event,
      },
    ];
    for (let i = 0; i < 9; i++) {
      swings.push(defend());
      void flow.coachLoop.replayExactBall();
      await until(() => (flow.getState().coach?.attempts.length ?? 0) === i + 2 && flow.getState().phase === 'idle');
      const c = flow.getState().coach!;
      seen.push({
        verdict: c.comparison?.verdict,
        stage: c.mastery.stage,
        mastered: c.mastery.mastered,
        event: c.event,
      });
    }
    const c = flow.getState().coach!;
    // The mastery rule follows the recorded attempts whatever the verdict (WA7: never one lucky result, no XP) ...
    expect(c.mastery.stage).toBe(4);
    expect(c.mastery.mastered).toBe(true);
    expect(allMastery(store)).toHaveLength(1);
    // ... and the first try was a leave, so the first clean block was 'better'; every later one repeated the one before
    // exactly ('same'). Every stage change and the mastery itself came on a 'same' attempt, so nothing chimed (WA6).
    expect(seen.map((x) => x.verdict)).toEqual([
      'same',
      'better',
      'same',
      'same',
      'same',
      'same',
      'same',
      'same',
      'same',
      'same',
    ]);
    const changed = seen.filter(
      (x, i) => i > 0 && (x.stage !== seen[i - 1].stage || x.mastered !== seen[i - 1].mastered),
    );
    expect(changed.length).toBe(4);
    expect(changed.every((x) => x.verdict === 'same')).toBe(true);
    expect(seen.every((x) => x.event === null)).toBe(true);
    expect(feels).toEqual([]);
  });

  it('the mastery confirmation plays only on a "better" verdict, whatever the stage does (WA6, COACH5)', async () => {
    // A coach whose comparison follows a script, so a stage completed on 'worse' and on 'better' can both be seen.
    const script: Array<'better' | 'worse' | 'same'> = [
      'worse',
      'better',
      'same',
      'worse',
      'better',
      'better',
      'same',
      'worse',
      'better',
    ];
    const coach = fakeCoach();
    let n = 0;
    coach.compareAttempts = (prev, next) => ({
      changes: ['same_again'],
      verdict: script[n++] ?? 'same',
      timingMs: null,
      runsDelta: next.attempted.runs - prev.attempted.runs,
    });
    const { flow, swings, feels } = setup({ deps: { coach } });
    flow.init();
    swings.push(defend());
    await quickPlay(flow);
    await until(() => flow.getState().insight?.status === 'ready');
    swings.push(defend());
    flow.coachLoop.practiceThisBall();
    const seen: Array<{ verdict: string | undefined; stage: number; mastered: boolean; event: string | null }> = [];
    await until(() => (flow.getState().coach?.attempts.length ?? 0) === 1 && flow.getState().phase === 'idle');
    const record = () => {
      const c = flow.getState().coach!;
      seen.push({
        verdict: c.comparison?.verdict,
        stage: c.mastery.stage,
        mastered: c.mastery.mastered,
        event: c.event,
      });
    };
    record();
    for (let i = 1; i < script.length; i++) {
      swings.push(defend());
      void flow.coachLoop.replayExactBall();
      await until(() => (flow.getState().coach?.attempts.length ?? 0) === i + 1 && flow.getState().phase === 'idle');
      record();
    }
    // Every attempt here succeeds, so the fake rule moves a stage every second attempt and masters at the ninth.
    expect(seen.map((x) => x.stage)).toEqual([1, 2, 2, 3, 3, 4, 4, 4, 4]);
    expect(seen.map((x) => x.mastered)).toEqual([false, false, false, false, false, false, false, false, true]);
    // Attempt 2 completes a stage on 'better' (chimes); attempt 4 completes one on 'worse' (silent, still recorded);
    // attempt 6 on 'better' (chimes); attempt 9 masters the ball on 'better' (the mastery moment).
    expect(seen.map((x) => x.event)).toEqual([null, 'stage_up', null, null, null, 'stage_up', null, null, 'mastered']);
    expect(feels).toEqual(['stage_up', 'stage_up', 'mastered']);
    // No confirmation ever accompanies a verdict that is not 'better'.
    expect(seen.filter((x) => x.event !== null).every((x) => x.verdict === 'better')).toBe(true);
  });

  it('masteryConfirmation: the event passes only with a better verdict', () => {
    const cmp = (verdict: 'better' | 'worse' | 'same'): AttemptComparison => ({
      changes: [],
      verdict,
      timingMs: null,
      runsDelta: 0,
    });
    expect(masteryConfirmation(cmp('better'), 'stage_up')).toBe('stage_up');
    expect(masteryConfirmation(cmp('better'), 'mastered')).toBe('mastered');
    expect(masteryConfirmation(cmp('better'), null)).toBeNull();
    for (const v of ['worse', 'same'] as const)
      for (const e of ['stage_up', 'mastered', null] as const) expect(masteryConfirmation(cmp(v), e)).toBeNull();
    expect(masteryConfirmation(null, 'mastered')).toBeNull();
  });

  it('back from Coach Mode to the dead ball, "Next ball" bowls the next ball (once)', async () => {
    const { flow, swings } = setup();
    flow.init();
    swings.push(defend());
    await quickPlay(flow);
    await until(() => flow.getState().insight?.status === 'ready');
    swings.push(defend());
    flow.acceptDeadBallAction('practice_ball');
    await until(
      () =>
        flow.getState().screen === 'coach' &&
        (flow.getState().coach?.attempts.length ?? 0) === 1 &&
        flow.getState().phase === 'idle',
    );
    flow.coachLoop.leaveCoach();
    expect(flow.getState()).toMatchObject({ screen: 'live', phase: 'dead' });
    swings.push(defend());
    const next = vi.spyOn(flow, 'nextBall');
    flow.acceptDeadBallAction('next_ball');
    flow.acceptDeadBallAction('next_ball');
    expect(next).toHaveBeenCalledTimes(1);
    await until(
      () => (flow.getState().innings?.current?.deliveries.length ?? 0) === 2 && flow.getState().phase === 'dead',
    );
  });

  it('a ball from the summary opens Coach Mode for that exact ball', async () => {
    const { flow, swings } = setup({ autoNext: true });
    flow.init();
    swings.push(...Array.from({ length: 6 }, () => defend()));
    await quickPlay(flow);
    await until(() => flow.getState().screen === 'over_summary');
    const record = flow.getState().innings!.overs[0].deliveries[3];
    flow.coachLoop.practiceBall(record);
    await until(() => flow.getState().coach?.base !== null);
    expect(flow.getState().coach).toMatchObject({ ballNumber: 4, overNumber: 1 });
    flow.coachLoop.leaveCoach();
    expect(flow.getState().screen).toBe('over_summary');
  });
});

describe('teaching (first run) and the expert’s one-tap skip', () => {
  it('a first run gets one short demonstration before the first ball, remembered once watched', async () => {
    const { flow, store, createStage } = setup({ teach: true });
    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    void flow.play();
    await until(() => flow.getState().phase === 'intro');
    await until(() => createStage.stages[0].calls().includes('demonstrate'));
    await until(() => flow.getState().phase === 'ready');
    expect(loadPracticeSettings(store).demoSeen).toBe(true);
    await until(() => flow.getState().phase === 'live');
  });

  it('"Skip teaching" ends the demonstration at once and turns all teaching off for good', async () => {
    const { flow, store } = setup({ teach: true });
    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    void flow.play();
    await until(() => flow.getState().phase === 'intro');
    flow.skipTeaching(true);
    await until(() => flow.getState().phase === 'runup');
    expect(loadPracticeSettings(store)).toMatchObject({ teach: false, demoSeen: true });
  });
});

describe('device tiers and fair timing', () => {
  it('runs the device check once per app version', async () => {
    const a = setup();
    a.flow.init();
    a.flow.prepareOver({ kind: 'random' });
    await until(() => a.flow.getState().stageReady);
    expect(a.benchmark).toHaveBeenCalledTimes(1);
    expect(loadCachedAssessment('1.0.0', a.store)?.tier).toBe('full');
    a.flow.dispose();
    const b = setup({ store: a.store });
    b.flow.init();
    b.flow.prepareOver({ kind: 'random' });
    await until(() => b.flow.getState().stageReady);
    expect(b.benchmark).not.toHaveBeenCalled();
  });

  it('below the cutoff: Classic straight away, said in product words on the setup screen', async () => {
    const { flow, createStage } = setup({ tier: 'below' });
    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    expect(createStage.stages.at(-1)?.kind).toBe('2d');
    expect(flow.getState()).toMatchObject({ screen: 'setup', notice: 'classic' });
    expect(flow.getState().quality).toMatchObject({ stage: '2d', tier: 'below', toleranceMs: 20 });
  });

  it('a WebGL failure falls back to Classic without a dead end', async () => {
    const { flow, events, createStage } = setup({
      fail3d: true,
      deps: { benchmark: async () => (await import('./fakes')).assessment('below') },
    });
    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    expect(events.some(([e, p]) => e === 'renderer_fallback' && p?.reason)).toBe(true);
    expect(createStage.stages.at(-1)?.kind).toBe('2d');
  });

  it('the timing forgiveness is latched for a whole over; a change shows from the next over, with a notice', async () => {
    const { flow, swings, createStage } = setup({
      autoNext: true,
      deps: {
        frameSampler: (on) => ({
          start: () => Array.from({ length: 60 }, () => on(40)).length && undefined,
          stop() {},
          running: false,
        }),
      },
    });
    flow.init();
    swings.push(...Array.from({ length: 6 }, () => defend()));
    await quickPlay(flow);
    await until(() => flow.getState().screen === 'over_summary');
    const first = flow.getState().innings!.overs[0].deliveries;
    // The session monitor stepped the device down mid-over: the over kept the forgiveness it began with.
    expect(createStage.stages[0].calls()).toContain('setProfile:lite');
    expect(new Set(first.map((d) => d.tierToleranceMs))).toEqual(new Set([0]));
    swings.push(defend());
    flow.prepareOver({ kind: 'random' });
    void flow.play();
    await until(() => (flow.getState().innings?.current?.deliveries.length ?? 0) === 1);
    // The new over carries the forgiveness in force as it began (12 ms Assisted, or 20 ms once Classic), and says so.
    expect(flow.getState().innings!.current!.deliveries[0].tierToleranceMs).toBeGreaterThanOrEqual(12);
    expect(flow.getState().notice).toBe('help_changed');
  });
});

describe('replays', () => {
  it('Replay this over plays the six recorded balls in order, then returns', async () => {
    const { flow, swings, createStage, events } = setup({ autoNext: true });
    flow.init();
    swings.push(...Array.from({ length: 6 }, () => attack(0.6)));
    await quickPlay(flow);
    await until(() => flow.getState().screen === 'over_summary');
    flow.coachLoop.replayOver(0);
    await until(() => flow.getState().replay?.index === 5 && !flow.getState().replay?.playing);
    expect(createStage.stages[0].calls().filter((c) => c === 'replay')).toHaveLength(6);
    expect(events.some(([e]) => e === 'practice_replay')).toBe(true);
    flow.coachLoop.closeReplay();
    expect(flow.getState().screen).toBe('over_summary');
  });
});
