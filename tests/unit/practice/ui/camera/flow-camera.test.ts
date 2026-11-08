/**
 * Camera batting in the flow (pre-delivery pacing only):
 * - when the camera is the control and no steady batter is in view, the next ball waits in the `camera` phase, however
 *   long that takes, and nothing is lost; the ball comes the moment a batter is seen;
 * - a ball in flight is never touched, whatever the camera sees meanwhile;
 * - Pause covers the wait, the app going away pauses it, leaving ends it;
 * - the gate is asked before every ball, and before the first-ball lesson;
 * - the gate does not change the ball: same seed and swing, same record and result.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStore, updatePracticeSettings } from '@/practice/store';
import type { CameraGate } from '@/practice/ui/camera/gate';
import { attack, defend, quickPlay, setup, until, useFakeTimers } from '../flowSetup';

beforeEach(useFakeTimers);
afterEach(() => vi.useRealTimers());

function fakeGate(o: { wanted?: boolean; ready?: boolean } = {}) {
  let wanted = o.wanted ?? true;
  let ready = o.ready ?? false;
  const subs = new Set<() => void>();
  const gate: CameraGate = {
    wanted: () => wanted,
    ready: () => !wanted || ready,
    subscribe: (cb) => {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
  };
  return Object.assign(gate, {
    setReady(v: boolean) {
      ready = v;
      subs.forEach((f) => f());
    },
    setWanted(v: boolean) {
      wanted = v;
      subs.forEach((f) => f());
    },
    listeners: () => subs.size,
  });
}

const bowled = (stages: ReturnType<typeof setup>['createStage']['stages']) =>
  stages.flatMap((s) => s.log.filter((l) => l.call === 'bowl')).length;

async function begin(flow: ReturnType<typeof setup>['flow']) {
  flow.init();
  flow.prepareOver({ kind: 'random' });
  await until(() => flow.getState().stageReady);
  void flow.play();
}

describe('the next ball waits for a batter in view', () => {
  it('holds in the camera phase, bowls nothing however long the wait, then bowls the moment a batter is seen', async () => {
    const gate = fakeGate({ ready: false });
    const { flow, createStage, swings } = setup({ deps: { camera: gate } });
    swings.push(attack());
    await begin(flow);
    await until(() => flow.getState().phase === 'camera');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(flow.getState()).toMatchObject({ phase: 'camera', screen: 'live' });
    expect(bowled(createStage.stages)).toBe(0);
    expect(flow.getState().innings?.balls).toBe(0);
    // The ball is not a busy moment: Back and Pause still work, and the card can switch the control.
    expect(flow.busy()).toBe(false);
    gate.setReady(true);
    await until(() => flow.getState().phase === 'dead');
    expect(flow.getState().innings?.balls).toBe(1);
    expect(gate.listeners()).toBe(0);
    flow.dispose();
  });

  it('never enters the camera phase when a batter is already in view, or when the camera is not the control', async () => {
    for (const gate of [fakeGate({ ready: true }), fakeGate({ wanted: false })]) {
      const { flow, swings } = setup({ deps: { camera: gate } });
      const phases: string[] = [];
      flow.subscribe(() => phases.push(flow.getState().phase));
      swings.push(attack());
      await begin(flow);
      await until(() => flow.getState().phase === 'dead');
      expect(phases).not.toContain('camera');
      expect(gate.listeners()).toBe(0);
      flow.dispose();
    }
  });

  it('is a flow without the camera when no gate is given: the ball is bowled at once, as before', async () => {
    const { flow, swings } = setup();
    swings.push(attack());
    const phases: string[] = [];
    flow.subscribe(() => phases.push(flow.getState().phase));
    await begin(flow);
    await until(() => flow.getState().phase === 'dead');
    expect(phases).not.toContain('camera');
    flow.dispose();
  });

  it('goes on at once when the player switches to mouse or touch while the ball waits', async () => {
    const gate = fakeGate({ ready: false });
    const { flow, swings } = setup({ deps: { camera: gate } });
    swings.push(attack());
    await begin(flow);
    await until(() => flow.getState().phase === 'camera');
    gate.setWanted(false);
    await until(() => flow.getState().phase === 'dead');
    flow.dispose();
  });
});

describe('every ball, never a ball in flight', () => {
  it('asks again before the next ball: ready for ball 1, waiting for ball 2', async () => {
    const gate = fakeGate({ ready: true });
    const { flow, createStage, swings } = setup({ deps: { camera: gate } });
    swings.push(attack(), attack());
    await begin(flow);
    await until(() => flow.getState().phase === 'dead');
    gate.setReady(false);
    flow.nextBall();
    await until(() => flow.getState().phase === 'camera');
    expect(bowled(createStage.stages)).toBe(1);
    gate.setReady(true);
    await until(() => flow.getState().phase === 'dead' && (flow.getState().innings?.balls ?? 0) === 2);
    flow.dispose();
  });

  it('lets a ball in flight finish whatever the camera sees meanwhile', async () => {
    const gate = fakeGate({ ready: true });
    const { flow, swings } = setup({ deps: { camera: gate } });
    swings.push(attack());
    await begin(flow);
    await until(() => ['runup', 'live', 'playing'].includes(flow.getState().phase));
    gate.setReady(false);
    gate.setWanted(true);
    await until(() => flow.getState().phase === 'dead');
    expect(flow.getState().innings?.balls).toBe(1);
    expect(flow.getState().phase).not.toBe('camera');
    flow.dispose();
  });
});

describe('Pause, the app going away, leaving', () => {
  it('Pause covers the wait; a batter coming into view while paused does not bowl; Resume goes on', async () => {
    const gate = fakeGate({ ready: false });
    const { flow, createStage, swings } = setup({ deps: { camera: gate } });
    swings.push(attack());
    await begin(flow);
    await until(() => flow.getState().phase === 'camera');
    flow.pause();
    expect(flow.getState().phase).toBe('paused');
    gate.setReady(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(flow.getState().phase).toBe('paused');
    expect(bowled(createStage.stages)).toBe(0);
    flow.resume();
    await until(() => flow.getState().phase === 'dead');
    flow.dispose();
  });

  it('Resume returns to the wait when nobody is in view yet', async () => {
    const gate = fakeGate({ ready: false });
    const { flow, createStage } = setup({ deps: { camera: gate } });
    await begin(flow);
    await until(() => flow.getState().phase === 'camera');
    flow.pause();
    flow.resume();
    expect(flow.getState().phase).toBe('camera');
    await vi.advanceTimersByTimeAsync(1000);
    expect(bowled(createStage.stages)).toBe(0);
    flow.dispose();
  });

  it('the app going away pauses the wait; coming back and resuming returns to it', async () => {
    const gate = fakeGate({ ready: false });
    const { flow } = setup({ deps: { camera: gate } });
    await begin(flow);
    await until(() => flow.getState().phase === 'camera');
    flow.setHidden(true);
    expect(flow.getState().phase).toBe('paused');
    flow.setHidden(false);
    flow.resume();
    expect(flow.getState().phase).toBe('camera');
    flow.dispose();
  });

  it('leaving ends the wait with no ball and lets go of the camera gate', async () => {
    const gate = fakeGate({ ready: false });
    const { flow, createStage } = setup({ deps: { camera: gate } });
    await begin(flow);
    await until(() => flow.getState().phase === 'camera');
    flow.leave();
    await vi.advanceTimersByTimeAsync(1000);
    expect(flow.getState()).toMatchObject({ screen: 'idle', phase: 'idle' });
    expect(bowled(createStage.stages)).toBe(0);
    expect(gate.listeners()).toBe(0);
    // A batter coming into view afterwards bowls nothing.
    gate.setReady(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(bowled(createStage.stages)).toBe(0);
    flow.dispose();
  });
});

describe('with the first-ball lesson', () => {
  it('the camera comes first, then the lesson card, then the ball', async () => {
    const store = memoryStore();
    updatePracticeSettings({ teach: true, demoSeen: true, lessonSeen: false }, store);
    const gate = fakeGate({ ready: false });
    const { flow, createStage, swings } = setup({
      store,
      teach: true,
      deps: { camera: gate, lesson: { input: () => 'camera' as const } },
    });
    swings.push(attack());
    await begin(flow);
    await until(() => flow.getState().phase === 'camera');
    expect(flow.getState().lesson).toBeNull();
    gate.setReady(true);
    await until(() => flow.getState().phase === 'lesson');
    expect(bowled(createStage.stages)).toBe(0);
    flow.lessonEvent({ type: 'bowl' });
    await until(() => flow.getState().phase === 'dead');
    flow.dispose();
  });
});

describe('the gate does not touch the ball (FAIR1 style)', () => {
  it('the same seed and the same swing give the same record and result with the camera gate and without it', async () => {
    const gate = fakeGate({ ready: false });
    const withGate = setup({ deps: { camera: gate } });
    const without = setup();
    for (const t of [withGate, without]) t.swings.push(attack(0.7, 12));
    await begin(withGate.flow);
    await until(() => withGate.flow.getState().phase === 'camera');
    gate.setReady(true);
    await until(() => withGate.flow.getState().phase === 'dead');
    await begin(without.flow);
    await until(() => without.flow.getState().phase === 'dead');
    const a = withGate.flow.getState().last!;
    const b = without.flow.getState().last!;
    expect(a.record.seed).toBe(b.record.seed);
    expect(JSON.stringify(a.record.plan)).toBe(JSON.stringify(b.record.plan));
    expect(JSON.stringify(a.record.swing)).toBe(JSON.stringify(b.record.swing));
    expect(JSON.stringify(a.result.outcome)).toBe(JSON.stringify(b.result.outcome));
    expect(a.result.contact.timingErrorMs).toBe(b.result.contact.timingErrorMs);
    withGate.flow.dispose();
    without.flow.dispose();
  });
});

describe('Coach Mode waits for the camera too', () => {
  it('"Practice this ball" waits for a batter in view, then replays the exact ball', async () => {
    const gate = fakeGate({ ready: true });
    const { flow, swings, createStage } = setup({ deps: { camera: gate } });
    flow.init();
    swings.push(attack(0.6));
    await quickPlay(flow);
    await until(() => flow.getState().insight?.status === 'ready');
    // The player has stepped out of the picture before they ask for the same ball again.
    const before = bowled(createStage.stages);
    gate.setReady(false);
    swings.push(defend());
    flow.coachLoop.practiceThisBall();
    await until(() => flow.getState().screen === 'coach' && flow.getState().phase === 'camera');
    expect(bowled(createStage.stages)).toBe(before);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(bowled(createStage.stages)).toBe(before);
    gate.setReady(true);
    await until(() => flow.getState().coach?.latest !== null && flow.getState().phase === 'idle');
    expect(bowled(createStage.stages)).toBe(before + 1);
    expect(gate.listeners()).toBe(0);
    flow.dispose();
  });

  it('leaving Coach Mode while it waits replays nothing, even when a batter comes into view later', async () => {
    const gate = fakeGate({ ready: true });
    const { flow, swings, createStage } = setup({ deps: { camera: gate } });
    flow.init();
    swings.push(attack(0.6));
    await quickPlay(flow);
    await until(() => flow.getState().insight?.status === 'ready');
    const before = bowled(createStage.stages);
    gate.setReady(false);
    flow.coachLoop.practiceThisBall();
    await until(() => flow.getState().phase === 'camera');
    flow.coachLoop.leaveCoach();
    expect(flow.getState()).toMatchObject({ screen: 'live', coach: null });
    gate.setReady(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(bowled(createStage.stages)).toBe(before);
    expect(flow.getState().screen).toBe('live');
    expect(gate.listeners()).toBe(0);
    flow.dispose();
  });

  it('asking twice keeps one wait that leaving still ends (the newer wait is never forgotten)', async () => {
    const gate = fakeGate({ ready: true });
    const { flow, swings, createStage } = setup({ deps: { camera: gate } });
    flow.init();
    swings.push(attack(0.6));
    await quickPlay(flow);
    await until(() => flow.getState().insight?.status === 'ready');
    const before = bowled(createStage.stages);
    gate.setReady(false);
    flow.coachLoop.practiceThisBall();
    await until(() => flow.getState().phase === 'camera');
    void flow.coachLoop.replayExactBall();
    await vi.advanceTimersByTimeAsync(100);
    expect(flow.getState().phase).toBe('camera');
    flow.leave();
    await vi.advanceTimersByTimeAsync(100);
    expect(gate.listeners()).toBe(0);
    gate.setReady(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(bowled(createStage.stages)).toBe(before);
    flow.dispose();
  });
});
