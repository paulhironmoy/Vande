import { describe, expect, it } from 'vitest';
import { PRACTICE_SIM_VERSION, type AssistanceStage, type CoachAnalysis, type MasteryState } from '@/contracts/practice';
import {
  MASTERY_RULE,
  MASTERY_SUCCESS_VERSION,
  analyzeBall,
  isMastered,
  isMasteryState,
  masteryAttempt,
  masteryEvent,
  masteryKey,
  masteryProgress,
  nextStage,
  recordAttempt,
  startMastery,
} from '@/practice/coach';
import { play, referenceRecord } from './fixtures';

// Real attempts at the reference inswinger: its recommended response (a success) and leaving it (bowled, a failure).
const BALL = referenceRecord('ref-2');
const REC = analyzeBall(BALL).options[0];
const GOOD: CoachAnalysis = (() => {
  const { record, result } = play(BALL, REC.swing);
  return analyzeBall(record, result);
})();
const BAD: CoachAnalysis = (() => {
  const { record, result } = play(BALL, null);
  return analyzeBall(record, result);
})();

/** Play a sequence of 'g'ood and 'b'ad attempts, each at the stage the state says (or a forced one). */
function run(seq: string, state: MasteryState = startMastery('k'), forced?: AssistanceStage): MasteryState {
  let s = state;
  for (const ch of seq) s = recordAttempt(s, ch === 'g' ? GOOD : BAD, forced ?? s.stage);
  return s;
}

describe('mastery: the attempts are judged against the recommended response', () => {
  it('the recommended stroke is a success; leaving the ball onto the stumps is not', () => {
    expect(REC.decision).not.toBe('leave');
    expect(masteryAttempt(GOOD, 1)).toMatchObject({ stage: 1, decision: REC.decision, contact: 'middle', out: false, success: true });
    expect(masteryAttempt(BAD, 2)).toMatchObject({ stage: 2, decision: 'leave', out: true, success: false });
  });

  it('the rule is the one documented', () => {
    expect(MASTERY_RULE).toMatchObject({ advanceAfter: 2, masteredStage: 4, masteredWindow: 4, masteredSuccesses: 3 });
    // 2026-11-03 (lead ruling, WA7): a stroke's success also needs a measured clean contact (strokeMeasuredClean). The
    // rule is stricter; every earlier condition is unchanged and still pinned.
    expect(MASTERY_RULE.success).toEqual({ noDismissal: true, recommendedDecision: true, contact: 'middle', strokeMeasuredClean: true, orCorrectLeave: true });
  });

  it('a stroke met as a slow fend or off the sweet zone is not a success; a block is judged by its face alone (WA7)', () => {
    // The attempt's own measured contact comes with its tip (coachTip: CoachTip.cleanContact, quality.ts cleanByMeasure).
    const stroke = { ...GOOD, attempted: { ...GOOD.attempted, decision: 'attack', contact: 'middle' }, options: [{ ...GOOD.options[0], decision: 'attack' }] } as CoachAnalysis;
    expect(masteryAttempt(stroke, 1, { cleanContact: false }).success).toBe(false);
    expect(masteryAttempt(stroke, 1, { cleanContact: true }).success).toBe(true);
    expect(masteryAttempt(stroke, 1).success).toBe(true); // without the measurement the label decides (callers pass the tip)
    const block = { ...GOOD, attempted: { ...GOOD.attempted, decision: 'defend', contact: 'middle' }, options: [{ ...GOOD.options[0], decision: 'defend' }] } as CoachAnalysis;
    expect(masteryAttempt(block, 1, { cleanContact: false }).success).toBe(true);
    // Recorded through recordAttempt, two measured slow fends never advance the stage.
    let s = startMastery('k');
    for (let i = 0; i < 2; i++) s = recordAttempt(s, stroke, s.stage, { cleanContact: false });
    expect(s.stage).toBe(1);
  });
});

describe('mastery: the stages', () => {
  it('starts at stage 1 with full assistance', () => {
    expect(startMastery('ball')).toEqual({ key: 'ball', stage: 1, attempts: [], mastered: false });
    // 2026-11-03: the key carries the meaning of a success (MASTERY_SUCCESS_VERSION 2), so states recorded when a slow
    // fend counted as a success are never found again (dropped quietly, not reinterpreted). Still one key per
    // simulation version, ball and setting, as before.
    expect(MASTERY_SUCCESS_VERSION).toBe(2);
    expect(masteryKey(BALL)).toBe(`sim${PRACTICE_SIM_VERSION}|m2|${BALL.seed}|right|play`);
    expect(masteryKey({ ...BALL, version: (PRACTICE_SIM_VERSION - 1) as typeof PRACTICE_SIM_VERSION })).toBe(
      `sim${PRACTICE_SIM_VERSION - 1}|m2|${BALL.seed}|right|play`,
    );
    expect(masteryKey(BALL)).not.toBe(`sim${PRACTICE_SIM_VERSION}|${BALL.seed}|right|play`);
  });

  it('one success does not advance; two in a row do; a failure resets the run', () => {
    expect(run('g').stage).toBe(1);
    expect(run('gg').stage).toBe(2);
    expect(run('gbg').stage).toBe(1);
    expect(run('gbgg').stage).toBe(2);
    expect(run('gggg').stage).toBe(3);
    expect(run('gggggg').stage).toBe(4);
    expect(run('gggggggggg').stage).toBe(4);
  });

  it('nextStage replays the history: the state stage is never trusted on its own', () => {
    const s = run('gggg');
    expect(nextStage({ ...s, stage: 1 })).toBe(3);
  });

  it('a player who chooses less help moves on to it, and more help does not count', () => {
    const s = run('g', startMastery('k'), 3);
    expect(s.stage).toBe(3);
    const t = run('gg', s, 1);
    expect(t.stage).toBe(3);
  });
});

describe('mastery: never one lucky result', () => {
  it('needs stage 4 and three successes in its last four attempts', () => {
    const at4 = run('gggggg');
    expect(at4.stage).toBe(4);
    expect(at4.mastered).toBe(false);
    expect(run('g', at4).mastered).toBe(false);
    expect(run('gg', at4).mastered).toBe(false);
    expect(run('ggg', at4).mastered).toBe(true);
    expect(run('gbgg', at4).mastered).toBe(true);
    expect(run('gbbgg', at4).mastered).toBe(false);
    expect(run('gbbggg', at4).mastered).toBe(true);
  });

  it('the fewest attempts that can master a ball is nine', () => {
    const s = run('ggggggggg');
    expect(s.mastered).toBe(true);
    expect(s.attempts.length).toBe(9);
    expect(run('gggggggg').mastered).toBe(false);
  });

  it('a single success with no assistance is not mastery', () => {
    expect(run('g', startMastery('k'), 4).mastered).toBe(false);
    expect(run('bgb', startMastery('k'), 4).mastered).toBe(false);
  });

  it('once shown, mastery stays shown', () => {
    const m = run('ggggggggg');
    const later = run('bbbb', m);
    expect(later.mastered).toBe(true);
    expect(isMastered(later)).toBe(true);
  });
});

describe('mastery: feedback', () => {
  it('progress says where the player stands', () => {
    expect(masteryProgress(run('g'))).toEqual({ stage: 1, streak: 1, neededToAdvance: 1, stageAttempts: 1, recentSuccesses: null, recentWindow: 4, mastered: false });
    expect(masteryProgress(run('gggggggb'))).toMatchObject({ stage: 4, neededToAdvance: 0, stageAttempts: 2, recentSuccesses: 1, mastered: false });
  });

  it('events for audio: stage_up, mastered, or nothing', () => {
    const s1 = run('g');
    const s2 = run('g', s1);
    expect(masteryEvent(s1, s2)).toBe('stage_up');
    expect(masteryEvent(startMastery('k'), s1)).toBeNull();
    const before = run('gggggggg');
    const after = run('g', before);
    expect(masteryEvent(before, after)).toBe('mastered');
    expect(masteryEvent(after, run('g', after))).toBeNull();
  });
});

describe('mastery: stored state', () => {
  it('accepts its own state through JSON and rejects corrupt data', () => {
    const s = run('ggbg');
    expect(isMasteryState(JSON.parse(JSON.stringify(s)))).toBe(true);
    expect(isMasteryState(null)).toBe(false);
    expect(isMasteryState({ ...s, stage: 5 })).toBe(false);
    expect(isMasteryState({ ...s, key: 3 })).toBe(false);
    expect(isMasteryState({ ...s, attempts: [{ ...s.attempts[0], contact: 'wicket' }] })).toBe(false);
    expect(isMasteryState({ ...s, attempts: [{ ...s.attempts[0], success: 'yes' }] })).toBe(false);
  });
});
