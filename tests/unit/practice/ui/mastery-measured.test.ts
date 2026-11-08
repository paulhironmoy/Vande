/**
 * Honest mastery (WA7): the coach loop records each Coach Mode attempt with its reading's tip, so the coach's own
 * rule (MASTERY_RULE, metStandard) judges a stroke by its measured clean contact. A slow fend met in the middle of
 * the bat (cleanContact false) is not a success and never advances the help; the same strokes met cleanly do. The
 * flow runs on the fakes, with the coach's real mastery functions and a fixed analysis that meets the recommended
 * response's standard by its label (an attack, as recommended, off the middle, not out).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRACTICE_SIM_VERSION, type CoachAnalysis } from '@/contracts';
import { MASTERY_SUCCESS_VERSION, masteryEvent, masteryKey, masteryProgress, recordAttempt, startMastery } from '@/practice/coach';
import { loadMastery, memoryStore, saveMastery } from '@/practice/store';
import { attack, quickPlay, setup, until, useFakeTimers } from './flowSetup';

beforeEach(() => useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

/** Plays the dead ball, opens Coach Mode on it, then plays `attempts` exact-ball attempts; returns the mastery reached. */
async function attemptsWith(cleanContact: boolean | undefined, attempts: number) {
  const value = setup();
  const coach = value.coach!;
  const inner = coach.analyzeBallInSlices;
  // Every reading meets the recommended response's standard by its label: an attack, as recommended, off the middle.
  coach.analyzeBallInSlices = async (record, result, opts) => {
    const a = await inner(record, result, opts);
    const option = { ...a.options[0], decision: 'attack' as const, footwork: 'forward' as const };
    return { ...a, attempted: { ...a.attempted, decision: 'attack', footwork: 'forward', contact: 'middle', dismissal: null, power: 0.7, directionDeg: 55 }, options: [option] } as CoachAnalysis;
  };
  coach.coachTip = (_r, a) => ({ mistake: null, fact: { kind: 'reason', reason: a.why[0], zone: null, fielder: null }, action: coach.primaryInsight(a).recommendation, ...(cleanContact === undefined ? {} : { cleanContact }) });
  // The coach's real mastery rule.
  coach.startMastery = startMastery;
  coach.recordAttempt = recordAttempt;
  coach.masteryProgress = masteryProgress;
  coach.masteryEvent = masteryEvent;
  const { flow, swings } = value;
  flow.init();
  swings.push(attack(0.7, 55));
  await quickPlay(flow);
  await until(() => flow.getState().insight?.status === 'ready');
  swings.push(attack(0.7, 55));
  flow.coachLoop.practiceThisBall();
  await until(() => (flow.getState().coach?.attempts.length ?? 0) === 1 && flow.getState().phase === 'idle');
  for (let i = 1; i < attempts; i++) {
    swings.push(attack(0.7, 55));
    void flow.coachLoop.replayExactBall();
    await until(() => (flow.getState().coach?.attempts.length ?? 0) === i + 1 && flow.getState().phase === 'idle');
  }
  return { mastery: flow.getState().coach!.mastery, feels: value.feels };
}

describe('a measured slow fend does not advance mastery', () => {
  it('three slow fends labelled "middle": no success recorded, still at help 1, no chime', async () => {
    const { mastery, feels } = await attemptsWith(false, 3);
    expect(mastery.attempts.map((a) => a.contact)).toEqual(['middle', 'middle', 'middle']);
    expect(mastery.attempts.map((a) => a.success)).toEqual([false, false, false]);
    expect(mastery.stage).toBe(1);
    expect(feels).toEqual([]);
  });

  it('the same strokes met cleanly do advance (the rule, unchanged: two successes in a row)', async () => {
    const { mastery } = await attemptsWith(true, 3);
    expect(mastery.attempts.map((a) => a.success)).toEqual([true, true, true]);
    expect(mastery.stage).toBe(2);
  });

  it('the store and UI keep the coach’s key as an opaque string: an old (m1-era) state is simply not found', () => {
    const store = memoryStore();
    const record = { version: PRACTICE_SIM_VERSION, seed: 'seed-x', handedness: 'right', assist: 'real' } as const;
    const key = masteryKey(record);
    expect(key).toContain(`|m${MASTERY_SUCCESS_VERSION}|`);
    // A state saved under the key format before the success version existed.
    const old = `sim${PRACTICE_SIM_VERSION}|seed-x|right|real`;
    expect(saveMastery({ ...startMastery(old), stage: 3 }, store)).toBe(true);
    expect(loadMastery(key, store)).toBeNull();
    expect(saveMastery(startMastery(key), store)).toBe(true);
    expect(loadMastery(key, store)?.stage).toBe(1);
  });
});
