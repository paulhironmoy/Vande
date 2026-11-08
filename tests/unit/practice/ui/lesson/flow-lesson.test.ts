/**
 * The first-ball lesson in the flow (pre-delivery pacing only):
 * - ball 1 is not bowled while the lesson is open, however long the player takes, and nothing happens to them;
 * - it ends only by "Bowl the first ball" or "Skip all teaching", and is then never shown again;
 * - a player who left it (or was paused) comes back to it, not to a bowled ball;
 * - a returning player, a flow without the UI, and a resumed over never meet it;
 * - the lesson does not change the ball: same seed and swing, same record and result with or without it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPracticeSettings, memoryStore, updatePracticeSettings } from '@/practice/store';
import { attack, setup, until, useFakeTimers } from '../flowSetup';

beforeEach(useFakeTimers);
afterEach(() => vi.useRealTimers());

const lessonDeps = { lesson: { input: () => 'mouse' as const } };

/** A first run with the demonstration already seen: only the lesson stands before ball 1. */
function firstRun(extra: { lessonSeen?: boolean; withUi?: boolean } = {}) {
  const store = memoryStore();
  updatePracticeSettings({ teach: true, demoSeen: true, lessonSeen: extra.lessonSeen ?? false }, store);
  return setup({ store, teach: true, deps: extra.withUi === false ? {} : lessonDeps });
}

async function play(flow: ReturnType<typeof setup>['flow']) {
  flow.init();
  flow.prepareOver({ kind: 'random' });
  await until(() => flow.getState().stageReady);
  void flow.play();
}

const bowled = (stages: ReturnType<typeof setup>['createStage']['stages']) =>
  stages.flatMap((s) => s.log.filter((l) => l.call === 'bowl')).length;

describe('ball 1 waits for the player', () => {
  it('opens the lesson on the card’s input and bowls nothing, however long the wait', async () => {
    const { flow, createStage, swings } = firstRun();
    swings.push(attack());
    await play(flow);
    await until(() => flow.getState().phase === 'lesson');
    expect(flow.getState().lesson).toMatchObject({ status: 'waiting', input: 'mouse' });
    // Ten minutes of doing nothing: nothing is bowled, nothing is lost, the lesson is still open.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(flow.getState()).toMatchObject({ phase: 'lesson', screen: 'live' });
    expect(flow.getState().lesson?.status).toBe('waiting');
    expect(bowled(createStage.stages)).toBe(0);
    expect(flow.getState().innings?.balls).toBe(0);
    expect(loadPracticeSettings(flow.store).lessonSeen).toBe(false);
    flow.dispose();
  });

  it('a dry swing and a wrong-moment note leave the ball unbowled and the card open', async () => {
    const { flow, createStage } = firstRun();
    await play(flow);
    await until(() => flow.getState().phase === 'lesson');
    flow.lessonEvent({ type: 'block' });
    expect(flow.getState().lesson).toMatchObject({ status: 'waiting', note: 'tap' });
    flow.lessonEvent({ type: 'hit', read: { kind: 'attack', directionDeg: 10, power: 0.7, elevation: 0 } });
    expect(flow.getState().lesson).toMatchObject({ status: 'tried', tries: 1 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(flow.getState().phase).toBe('lesson');
    expect(bowled(createStage.stages)).toBe(0);
    flow.dispose();
  });

  it('"Bowl the first ball" ends it, remembers it, and ball 1 follows as it always does', async () => {
    const { flow, swings } = firstRun();
    swings.push(attack());
    await play(flow);
    await until(() => flow.getState().phase === 'lesson');
    flow.lessonEvent({ type: 'bowl' });
    await until(() => flow.getState().phase === 'dead');
    expect(flow.getState().lesson).toBeNull();
    expect(flow.getState().innings?.balls).toBe(1);
    expect(loadPracticeSettings(flow.store)).toMatchObject({ lessonSeen: true, teach: true });
    flow.dispose();
  });

  it('"Skip all teaching" ends it for good: teaching off, demonstration and lesson both seen', async () => {
    const { flow, swings } = firstRun();
    swings.push(attack());
    await play(flow);
    await until(() => flow.getState().phase === 'lesson');
    flow.skipTeaching(true);
    await until(() => flow.getState().phase === 'dead');
    expect(loadPracticeSettings(flow.store)).toMatchObject({ teach: false, demoSeen: true, lessonSeen: true });
    flow.dispose();
  });
});

describe('Pause, leaving and coming back', () => {
  it('Pause covers the lesson and Resume returns to it, with the ball still unbowled', async () => {
    const { flow, createStage } = firstRun();
    await play(flow);
    await until(() => flow.getState().phase === 'lesson');
    flow.pause();
    expect(flow.getState().phase).toBe('paused');
    expect(flow.getState().lesson?.status).toBe('waiting');
    await vi.advanceTimersByTimeAsync(5000);
    flow.resume();
    expect(flow.getState().phase).toBe('lesson');
    expect(bowled(createStage.stages)).toBe(0);
    flow.lessonEvent({ type: 'bowl' });
    await until(() => flow.getState().phase === 'runup' || flow.getState().phase === 'live');
    flow.dispose();
  });

  it('the app going away while the lesson is open pauses it; coming back resumes the same lesson', async () => {
    const { flow } = firstRun();
    await play(flow);
    await until(() => flow.getState().phase === 'lesson');
    flow.setHidden(true);
    expect(flow.getState().phase).toBe('paused');
    flow.setHidden(false);
    flow.resume();
    expect(flow.getState().phase).toBe('lesson');
    flow.dispose();
  });

  it('leaving ends it unseen: the player meets it again next time', async () => {
    const { flow, createStage } = firstRun();
    await play(flow);
    await until(() => flow.getState().phase === 'lesson');
    flow.leave();
    await vi.advanceTimersByTimeAsync(1000);
    expect(flow.getState()).toMatchObject({ screen: 'idle', phase: 'idle', lesson: null });
    expect(loadPracticeSettings(flow.store).lessonSeen).toBe(false);
    expect(bowled(createStage.stages)).toBe(0);
    flow.dispose();
  });
});

describe('who never meets it', () => {
  it('a returning player (lesson seen) is bowled to at once', async () => {
    const { flow, swings } = firstRun({ lessonSeen: true });
    swings.push(attack());
    await play(flow);
    await until(() => flow.getState().phase === 'dead');
    expect(flow.getState().lesson).toBeNull();
    flow.dispose();
  });

  it('a flow without the lesson UI is bowled to at once, as before', async () => {
    const { flow, swings } = firstRun({ withUi: false });
    swings.push(attack());
    await play(flow);
    await until(() => flow.getState().phase === 'dead');
    expect(flow.getState().lesson).toBeNull();
    flow.dispose();
  });

  it('a player stored before the lesson existed (demonstration seen, no lessonSeen key) is a returning player', () => {
    const store = memoryStore();
    store.setItem('vc:practice:settings', JSON.stringify({ v: 1, teach: true, demoSeen: true }));
    expect(loadPracticeSettings(store).lessonSeen).toBe(true);
    const fresh = memoryStore();
    fresh.setItem('vc:practice:settings', JSON.stringify({ v: 1, teach: true, demoSeen: false }));
    expect(loadPracticeSettings(fresh).lessonSeen).toBe(false);
    expect(loadPracticeSettings(memoryStore()).lessonSeen).toBe(false);
  });
});

describe('the lesson does not touch the ball (FAIR1 style)', () => {
  it('the same seed and the same swing give the same record and result with and without the lesson', async () => {
    const withLesson = firstRun();
    const without = firstRun({ lessonSeen: true });
    for (const t of [withLesson, without]) t.swings.push(attack(0.7, 12));
    await play(withLesson.flow);
    await until(() => withLesson.flow.getState().phase === 'lesson');
    withLesson.flow.lessonEvent({ type: 'bowl' });
    await until(() => withLesson.flow.getState().phase === 'dead');
    await play(without.flow);
    await until(() => without.flow.getState().phase === 'dead');
    const a = withLesson.flow.getState().last!;
    const b = without.flow.getState().last!;
    // Both flows draw the same seeds (newSeed counts up from the same start), so the over and the ball are the same.
    expect(a.record.seed).toBe(b.record.seed);
    expect(JSON.stringify(a.record.plan)).toBe(JSON.stringify(b.record.plan));
    expect(JSON.stringify(a.record.swing)).toBe(JSON.stringify(b.record.swing));
    expect(JSON.stringify(a.result.outcome)).toBe(JSON.stringify(b.result.outcome));
    expect(a.result.contact.timingErrorMs).toBe(b.result.contact.timingErrorMs);
    withLesson.flow.dispose();
    without.flow.dispose();
  });
});
