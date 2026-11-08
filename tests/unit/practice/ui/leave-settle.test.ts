/**
 * Bowled-leave step 1 (src/practice/ui/flow/delivery.ts awaitSwing, state.ts LEAVE_CUE_DISPATCH_MS): with nothing in
 * flight at the leave deadline the leave settles after the cue allowance plus the largest calibration, not after the
 * full arrival window; anything in flight keeps the full window; which swings count is unchanged.
 * The fake ball reaches the stumps 560 ms after release, so the deadline is release + 680 ms.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveCalibrations } from '@/practice/store/calibration';
import { memoryStore } from '@/practice/store/storage';
import { LEAVE_CUE_DISPATCH_MS, LEAVE_GRACE_S, SWING_ARRIVAL_MS } from '@/practice/ui/flow/state';
import { setup, until, useFakeTimers } from './flowSetup';
import { LATE_SAMPLE_WAIT_MS } from '@/input/constants';

beforeEach(() => useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

/** Plays to the live ball and returns the deadline (perf ms) and helpers. */
async function live(o: Parameters<typeof setup>[0] = {}) {
  const t = setup(o);
  t.flow.init();
  t.flow.prepareOver({ kind: 'random' });
  await until(() => t.flow.getState().stageReady);
  void t.flow.play();
  await until(() => t.flow.getState().phase === 'live');
  const stage = t.createStage.stages[0];
  const deadline = stage.simToPerf(0.56 + LEAVE_GRACE_S);
  const to = (perf: number) => vi.advanceTimersByTimeAsync(Math.max(0, perf - performance.now()));
  const settled = () => t.flow.getState().phase !== 'live';
  return { ...t, stage, deadline, to, settled };
}

describe('a leave with nothing in flight settles at once (bowled-leave step 1)', () => {
  it("the cue allowance is the input tracker's own allowance for batched events", () => {
    expect(LEAVE_CUE_DISPATCH_MS).toBe(LATE_SAMPLE_WAIT_MS);
  });

  it('no cue, no press: settled 40 ms after the deadline instead of 250 ms', async () => {
    const { deadline, to, settled, flow } = await live();
    await to(deadline + LEAVE_CUE_DISPATCH_MS - 2);
    expect(settled()).toBe(false);
    await to(deadline + LEAVE_CUE_DISPATCH_MS + 2);
    expect(settled()).toBe(true);
    await until(() => flow.getState().phase === 'dead');
    expect(flow.getState().last?.result.swing).toBeNull();
    flow.dispose();
  });

  it('a calibrated input (touch +120 ms): the wait grows by that offset, the largest of all inputs', async () => {
    const store = memoryStore();
    saveCalibrations({ touch: { offsetMs: 120, attempts: 5 }, keyboard: { offsetMs: 10, attempts: 5 } }, store);
    const { deadline, to, settled, flow } = await live({ store });
    await to(deadline + 120 + LEAVE_CUE_DISPATCH_MS - 2);
    expect(settled()).toBe(false);
    await to(deadline + 120 + LEAVE_CUE_DISPATCH_MS + 2);
    expect(settled()).toBe(true);
    flow.dispose();
  });

  it('a press still being read at the deadline keeps the full window, and its swing still counts', async () => {
    const { deadline, to, settled, flow } = await live();
    await to(deadline - 30);
    flow.onSwingStart(deadline - 30, 'touch');
    await to(deadline + SWING_ARRIVAL_MS - 20);
    expect(settled()).toBe(false);
    flow.onGesture({
      pointer: 'touch',
      samples: [
        { t: deadline - 30, x: 10, y: 10 },
        { t: deadline - 10, x: 30, y: -20 },
      ],
      surface: { width: 400, height: 200 },
    });
    await until(() => flow.getState().phase === 'dead');
    expect(flow.getState().last?.result.swing?.kind).toBe('attack');
    flow.dispose();
  });

  it('a finger resting on the surface (a pointer down) keeps the full window', async () => {
    const { deadline, to, settled, flow, engine } = await live();
    engine.pointerIsDown = () => true;
    await to(deadline + SWING_ARRIVAL_MS - 20);
    expect(settled()).toBe(false);
    await to(deadline + SWING_ARRIVAL_MS + 20);
    expect(settled()).toBe(true);
    flow.dispose();
  });

  it('a cue arriving during the short wait restores the full window; a swing started in time still counts', async () => {
    const { deadline, to, flow } = await live();
    await to(deadline + 30);
    flow.onSwingStart(deadline - 5, 'touch');
    await to(deadline + 120);
    expect(flow.getState().phase).toBe('live');
    flow.onGesture({
      pointer: 'touch',
      samples: [
        { t: deadline - 5, x: 10, y: 10 },
        { t: deadline + 15, x: 30, y: -20 },
      ],
      surface: { width: 400, height: 200 },
    });
    await until(() => flow.getState().phase === 'dead');
    expect(flow.getState().last?.result.swing?.kind).toBe('attack');
    flow.dispose();
  });

  it('which swings count is unchanged: a swing whose own start is after the deadline is still a leave', async () => {
    const { deadline, to, flow } = await live();
    await to(deadline + 10);
    flow.onSwingStart(deadline + 10, 'touch');
    flow.onGesture({
      pointer: 'touch',
      samples: [
        { t: deadline + 10, x: 10, y: 10 },
        { t: deadline + 30, x: 30, y: -20 },
      ],
      surface: { width: 400, height: 200 },
    });
    await until(() => flow.getState().phase === 'dead');
    expect(flow.getState().last?.result.swing).toBeNull();
    flow.dispose();
  });
});
