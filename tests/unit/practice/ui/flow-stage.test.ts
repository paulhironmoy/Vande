/**
 * The stage's life on the real device-check path (no fixed tier), where the stage is built and then measured before
 * it is ready:
 * - Play tapped while the stage is still being measured waits for it, and never strands the first ball (RK-F04);
 * - quality changes between balls, down to Classic, never stop an over (F-026);
 * - the timing help is latched per over at its first ball, whatever the device does mid-over (F-006), and a change
 *   between overs is said in the right direction (never in Real, which gives none);
 * - the app going away just before a ball pauses it, and Resume bowls it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PerfTier } from '@/contracts';
import { memoryStore, updatePracticeSettings } from '@/practice/store';
import { assessment } from './fakes';
import { attack, defend, setup, until, useFakeTimers } from './flowSetup';

beforeEach(useFakeTimers);
afterEach(() => vi.useRealTimers());

/** A device check that takes a while, as the real one does (about two seconds of measured frames). */
const slowCheck = (tier: PerfTier, ms = 2200) => async () => {
  await new Promise((r) => setTimeout(r, ms));
  return assessment(tier);
};

/** Every delivery's frames arrive at 25 fps: the session monitor steps the device down between balls. */
const slowFrames = (on: (ms: number) => void) => ({
  start: () => {
    for (let i = 0; i < 60; i++) on(40);
  },
  stop() {},
  running: false,
});

describe('Play tapped before the stage is ready', () => {
  it('waits for the device check, shows the first-run demonstration, then bowls on a ready stage', async () => {
    const { flow, swings, createStage } = setup({ teach: true, deps: { benchmark: slowCheck('full') } });
    flow.init();
    flow.prepareOver({ kind: 'random' });
    await vi.advanceTimersByTimeAsync(100);
    expect(flow.getState().stageReady).toBe(false);
    swings.push(defend());
    void flow.play();
    await vi.advanceTimersByTimeAsync(100);
    expect(flow.getState()).toMatchObject({ screen: 'live', phase: 'loading' });
    await until(() => flow.getState().phase === 'intro');
    expect(flow.getState().stageReady).toBe(true);
    await until(() => flow.getState().phase === 'runup');
    expect(flow.getState().stageReady).toBe(true);
    await until(() => flow.getState().phase === 'dead');
    expect(flow.getState().innings!.current!.deliveries).toHaveLength(1);
    expect(createStage.stages.map((s) => s.usedAfterDispose)).toEqual(createStage.stages.map(() => 0));
    expect(createStage.stages.filter((s) => !s.disposed)).toHaveLength(1);
    expect(createStage.stages.find((s) => !s.disposed)!.calls()).toContain('demonstrate');
  });

  it('a second Play, or leaving and coming back, shares the one preparation', async () => {
    const check = vi.fn(slowCheck('full'));
    const { flow, createStage } = setup({ deps: { benchmark: check } });
    flow.init();
    flow.prepareOver({ kind: 'random' });
    flow.cancelSetup();
    flow.prepareOver({ kind: 'random' });
    void flow.play();
    void flow.play();
    await until(() => flow.getState().phase === 'runup');
    expect(createStage.stages).toHaveLength(1);
    expect(check).toHaveBeenCalledTimes(1);
    flow.dispose();
  });
});

describe('quality changes between balls on the real device-check path', () => {
  it('two complete overs while the device steps down to Classic; the help is one value per over', async () => {
    const { flow, swings, createStage } = setup({ autoNext: true, deps: { benchmark: slowCheck('full', 1500), frameSampler: slowFrames } });
    flow.init();
    swings.push(...Array.from({ length: 12 }, (_, i) => (i % 2 ? defend() : attack(0.6))));
    flow.prepareOver({ kind: 'random' });
    void flow.play();
    await until(() => flow.getState().screen === 'over_summary');
    flow.prepareOver({ kind: 'random' });
    void flow.play();
    await until(() => flow.getState().screen === 'over_summary' && flow.getState().innings!.overs.length === 2);
    const overs = flow.getState().innings!.overs;
    expect(overs.map((o) => o.deliveries.length)).toEqual([6, 6]);
    for (const o of overs) expect(new Set(o.deliveries.map((d) => d.tierToleranceMs)).size).toBe(1);
    expect(overs[1].deliveries[0].tierToleranceMs).toBeGreaterThan(overs[0].deliveries[0].tierToleranceMs);
    expect(createStage.stages.some((s) => s.kind === '2d')).toBe(true);
    expect(createStage.stages.map((s) => s.usedAfterDispose)).toEqual(createStage.stages.map(() => 0));
  });

  it('a change of help between overs is said once, in the right direction; never in Real', async () => {
    for (const assist of ['play', 'real'] as const) {
      const store = memoryStore();
      updatePracticeSettings({ teach: false, demoSeen: true, assist }, store);
      const { flow, swings } = setup({ store, autoNext: true, deps: { frameSampler: slowFrames } });
      flow.init();
      swings.push(...Array.from({ length: 7 }, () => defend()));
      flow.prepareOver({ kind: 'random' });
      void flow.play();
      await until(() => flow.getState().screen === 'over_summary');
      flow.prepareOver({ kind: 'random' });
      void flow.play();
      await until(() => (flow.getState().innings?.current?.deliveries.length ?? 0) === 1);
      // Real gives no timing help on any device, so only the change of graphics is said.
      if (assist === 'real') expect(['classic', 'balanced']).toContain(flow.getState().notice);
      else expect(flow.getState().notice).toBe('help_changed');
      flow.dispose();
    }
  });
});

describe('the app going away just before a ball', () => {
  it('pauses during the ready hint; nothing is bowled while away; Resume bowls the ball', async () => {
    const store = memoryStore();
    updatePracticeSettings({ teach: true, demoSeen: true }, store);
    const { flow, swings } = setup({ store });
    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    swings.push(defend());
    void flow.play();
    await until(() => flow.getState().phase === 'ready');
    flow.setHidden(true);
    expect(flow.getState().phase).toBe('paused');
    await vi.advanceTimersByTimeAsync(5000);
    expect(flow.getState().phase).toBe('paused');
    expect(flow.getState().innings!.current!.deliveries).toHaveLength(0);
    flow.setHidden(false);
    flow.resume();
    await until(() => flow.getState().phase === 'dead');
    expect(flow.getState().innings!.current!.deliveries).toHaveLength(1);
  });
});
