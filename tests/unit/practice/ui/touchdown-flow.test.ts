/**
 * The touch-down cue in the delivery flow (owner decision 2026-11-04, CTL1: the bat starts moving at touch-down). The
 * stage starts the stroke inside the press's own handler, so the handler must not wait on anything slow: the modality's
 * calibration is read once, when the delivery is armed, and a press (or the intent that follows it) reuses it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRACTICE_KEYS, memoryStore, updatePracticeSettings, type KeyStore } from '@/practice/store';
import { quickPlay, setup, until, useFakeTimers } from './flowSetup';

beforeEach(() => useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('the touch-down cue in the flow (CTL1)', () => {
  it('gives the stage the calibration read when the delivery was armed, and a press reads no storage', async () => {
    const base = memoryStore();
    base.setItem(PRACTICE_KEYS.calibration, JSON.stringify({ v: 2, touch: { offsetMs: 40, attempts: 5 } }));
    updatePracticeSettings({ teach: false, demoSeen: true }, base);
    let calibrationReads = 0;
    const store: KeyStore = {
      getItem: (k) => {
        if (k === PRACTICE_KEYS.calibration) calibrationReads++;
        return base.getItem(k);
      },
      setItem: (k, v) => base.setItem(k, v),
      removeItem: (k) => base.removeItem(k),
    };
    const { flow, createStage } = setup({ store });
    flow.init();
    await quickPlay(flow);
    await until(() => flow.getState().phase === 'live');
    const stage = createStage.stages[0];
    const prepare = vi.spyOn(stage, 'prepareSwing');
    const begin = vi.spyOn(stage, 'beginSwing');
    const armedReads = calibrationReads;
    expect(armedReads).toBeGreaterThan(0);
    const press = performance.now();
    flow.onSwingStart(press, 'touch');
    flow.onSwingStart(press + 5, 'touch');
    flow.onSwingIntent({ atPerfMs: press + 60, pointer: 'touch' });
    expect(calibrationReads).toBe(armedReads);
    expect(prepare).toHaveBeenNthCalledWith(1, press, 40);
    expect(begin).toHaveBeenCalledWith(press + 60, 40);
    // Another modality has its own offset (none stored: 0), from the same read.
    flow.onSwingStart(press + 80, 'mouse');
    expect(prepare).toHaveBeenLastCalledWith(press + 80, 0);
    expect(calibrationReads).toBe(armedReads);
    flow.dispose();
  });
});
