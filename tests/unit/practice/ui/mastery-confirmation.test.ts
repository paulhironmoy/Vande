/**
 * WA6 and WA7 together, with the coach's own rule (src/practice/coach): what happens to an exact-ball attempt that is not
 * "better". The mastery confirmation (sound, haptic, the moment) needs a 'better' verdict; the stage and mastery do not,
 * because they follow the recorded attempts by MASTERY_RULE. The evidence for that decision: repeating a successful
 * response exactly is, by compareAttempts' own definition, 'same' every time, so a rule that only counted 'better'
 * attempts could never move past the first stage, and repeatability (what mastery means) would be impossible.
 */
import { describe, expect, it } from 'vitest';
import { PRACTICE_SIM_VERSION, type CoachAnalysis } from '@/contracts/practice';
import {
  MASTERY_RULE,
  compareAttempts,
  masteryEvent,
  metStandard,
  recordAttempt,
  startMastery,
} from '@/practice/coach';
import { masteryConfirmation } from '@/practice/ui/flow/coachLoop';

/**
 * A clean forward block of the recommended block, as the coach records it (contract-shaped, fixed: the comparison and
 * the mastery rule read only these recorded fields, so the evidence does not move with the physics being repaired).
 */
const CLEAN: CoachAnalysis = {
  version: PRACTICE_SIM_VERSION,
  ball: {
    variation: 'stock',
    speedKph: 132,
    lengthM: 6,
    lineAtStumpsM: 0.05,
    airMovementM: 0,
    pitchMovementM: 0.02,
    heightAtBatM: 0.6,
    wouldHitStumps: true,
  },
  read: { length: 'right', line: 'right', pace: 'unclear', movement: 'right', bounce: 'unclear' },
  attempted: {
    decision: 'defend',
    footwork: 'forward',
    directionDeg: 0,
    elevation: 0,
    power: 0.2,
    timingErrorMs: 4,
    contact: 'middle',
    timing: 'perfect',
    runs: 0,
    dismissal: null,
    spread: null,
  },
  why: ['solid_defence'],
  options: [
    {
      kind: 'recommended',
      decision: 'defend',
      swing: { kind: 'defend', startT: 0.4, directionDeg: 0, power: 0.2, elevation: 0, footwork: 'forward' },
      footwork: 'forward',
      outcome: {
        runs: 0,
        boundary: null,
        dismissal: null,
        fielderId: null,
        endBearingDeg: null,
        endDistanceM: null,
        region: null,
      },
      contact: 'middle',
      contactPoint: null,
      contactT: 0.5,
      dismissalRisk: 0,
      expectedRuns: 0,
      region: null,
      risks: [],
    },
  ],
} as unknown as CoachAnalysis;

describe('an attempt that is not better (the coach’s own comparison and mastery rule)', () => {
  it('progresses by the mastery rule, silently; gating progress on "better" would never leave stage 1', () => {
    const attempt = CLEAN;
    expect(metStandard(attempt)).toBe(true);
    let state = startMastery('sim3|seed|right|real');
    let gatedOnBetter = startMastery('sim3|seed|right|real');
    let previous = attempt;
    const verdicts: string[] = [];
    const confirmations: Array<string | null> = [];
    const stages: number[] = [];
    for (let i = 0; i < 9; i++) {
      const comparison = compareAttempts(previous, attempt);
      const next = recordAttempt(state, attempt, state.stage);
      verdicts.push(comparison.verdict);
      confirmations.push(masteryConfirmation(comparison, masteryEvent(state, next)));
      if (comparison.verdict === 'better') gatedOnBetter = recordAttempt(gatedOnBetter, attempt, gatedOnBetter.stage);
      state = next;
      stages.push(state.stage);
      previous = attempt;
    }
    // The identical clean block, nine times: 'same' every time (COACH5: the verdict follows the recorded deltas).
    expect(verdicts).toEqual(Array(9).fill('same'));
    // The rule: two in a row per stage, then three of the last four with no help; mastered at the ninth (WA7).
    expect(MASTERY_RULE.advanceAfter).toBe(2);
    expect(stages).toEqual([1, 2, 2, 3, 3, 4, 4, 4, 4]);
    expect(state.mastered).toBe(true);
    expect(state.attempts).toHaveLength(9);
    // No confirmation on a 'same' attempt, even the one that masters the ball (WA6).
    expect(confirmations).toEqual(Array(9).fill(null));
    // The rejected alternative: count only 'better' attempts. It never records one, so it never leaves stage 1.
    expect(gatedOnBetter.attempts).toHaveLength(0);
    expect(gatedOnBetter.stage).toBe(1);
    expect(gatedOnBetter.mastered).toBe(false);
  });
});
