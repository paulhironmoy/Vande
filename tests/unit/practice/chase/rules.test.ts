// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { rngFromKey } from '@/engine/prng';
import {
  CHASE_BALLS,
  CHASE_MAX_TARGET,
  CHASE_VERSION,
  chaseAllowed,
  chaseDefinitionError,
  chaseError,
  chaseReducer,
  chaseSummary,
  currentRateX100Of,
  dueBall,
  isDecided,
  makeChase,
  requiredRateX100Of,
  startChase,
  type BallRuns,
  type ChaseAction,
  type ChaseDefinition,
  type ChaseState,
} from '@/practice/chase';
import type { Dismissal } from '@/contracts/practice';

const base = makeChase('c000', 'standard')!;
const defOf = (target: number): ChaseDefinition => ({ ...base, target });

/** The ball due next as an action. */
const ball = (s: ChaseState, runs: BallRuns = 0, dismissal: Dismissal | null = null): ChaseAction => ({
  type: 'ball',
  ...dueBall(s.ballsFaced),
  runs,
  dismissal,
});
const play = (s: ChaseState, ...runs: Array<BallRuns | 'W'>): ChaseState =>
  runs.reduce<ChaseState>((acc, r) => chaseReducer(acc, r === 'W' ? ball(acc, 0, 'bowled') : ball(acc, r)), s);

describe('a chase', () => {
  it('starts with nothing bowled and the whole target to get', () => {
    const s = startChase(defOf(14));
    expect(s).toMatchObject({
      v: CHASE_VERSION,
      result: 'in_progress',
      runs: 0,
      ballsFaced: 0,
      ballsLeft: 12,
      wicketsLost: 0,
      runsNeeded: 14,
      requiredRateX100: 700,
      requiredRate: 7,
      currentRateX100: null,
      currentRate: null,
      balls: [],
      decidingBall: null,
    });
  });

  it('is won by the run that reaches the target, and that ball ends it', () => {
    let s = play(startChase(defOf(10)), 4, 4);
    expect(s).toMatchObject({ result: 'in_progress', runs: 8, runsNeeded: 2, ballsLeft: 10 });
    s = play(s, 2);
    expect(s).toMatchObject({
      result: 'won',
      runs: 10,
      runsNeeded: 0,
      ballsFaced: 3,
      ballsLeft: 9,
      requiredRate: null,
    });
    expect(s.decidingBall).toEqual({ overIndex: 0, ballIndex: 2, ballNumber: 3, key: '0:2', runs: 2, dismissal: null });
    // The winning run ended it: no further ball is taken, and the score cannot grow.
    expect(chaseError(s, ball(s, 6))).toBe('chase_over');
    expect(chaseReducer(s, ball(s, 6))).toBe(s);
  });

  it('is won by more than the target: the winning ball keeps all its runs', () => {
    const s = play(startChase(defOf(5)), 1, 6);
    expect(s).toMatchObject({ result: 'won', runs: 7, runsNeeded: 0 });
  });

  it('is lost when the wicket falls, whatever the target', () => {
    const s = play(startChase(defOf(20)), 4, 'W');
    expect(s).toMatchObject({
      result: 'lost_wicket',
      runs: 4,
      runsNeeded: 16,
      wicketsLost: 1,
      ballsFaced: 2,
      ballsLeft: 10,
    });
    expect(s.decidingBall).toEqual({
      overIndex: 0,
      ballIndex: 1,
      ballNumber: 2,
      key: '0:1',
      runs: 0,
      dismissal: 'bowled',
    });
    expect(s.requiredRate).toBeNull();
    expect(chaseReducer(s, ball(s, 6))).toBe(s);
  });

  it('is lost by the balls when the 12th ball is bowled and the target is not reached', () => {
    const s = play(startChase(defOf(13)), 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
    expect(s).toMatchObject({
      result: 'lost_balls',
      runs: 12,
      runsNeeded: 1,
      ballsFaced: 12,
      ballsLeft: 0,
      wicketsLost: 0,
    });
    expect(s.decidingBall).toMatchObject({ overIndex: 1, ballIndex: 5, ballNumber: 12, key: '1:5' });
  });

  it('has no tie: reaching the target exactly on the last ball wins, one run short loses', () => {
    const eleven = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] as const;
    expect(play(startChase(defOf(12)), ...eleven, 1)).toMatchObject({
      result: 'won',
      runs: 12,
      ballsFaced: 12,
      ballsLeft: 0,
    });
    expect(play(startChase(defOf(13)), ...eleven, 1)).toMatchObject({ result: 'lost_balls', runs: 12, runsNeeded: 1 });
  });

  it('is won by a boundary off the last ball, and lost by a dot ball off it', () => {
    const eleven = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] as const;
    expect(play(startChase(defOf(8)), ...eleven, 6)).toMatchObject({ result: 'won', runs: 8, ballsFaced: 12 });
    expect(play(startChase(defOf(8)), ...eleven, 4)).toMatchObject({ result: 'lost_balls', runs: 6, runsNeeded: 2 });
    expect(play(startChase(defOf(3)), ...eleven, 0)).toMatchObject({ result: 'lost_balls', runs: 2, runsNeeded: 1 });
  });

  it('calls a wicket on the 12th ball a wicket loss (the wicket is what ended it), never a loss by the balls', () => {
    const eleven = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as const;
    const s = play(startChase(defOf(5)), ...eleven, 'W');
    expect(s).toMatchObject({ result: 'lost_wicket', ballsFaced: 12, ballsLeft: 0, wicketsLost: 1 });
    expect(s.decidingBall).toMatchObject({ ballNumber: 12, dismissal: 'bowled' });
  });

  it('can be won on the very first ball, and the loss by wicket can come on the first', () => {
    expect(play(startChase(defOf(4)), 6)).toMatchObject({ result: 'won', ballsFaced: 1, ballsLeft: 11 });
    expect(play(startChase(defOf(4)), 'W')).toMatchObject({ result: 'lost_wicket', ballsFaced: 1, runs: 0 });
  });

  it('keeps the score exactly as the balls made it, whichever way each ball scored its runs', () => {
    // 5 is not a number of runs a ball can score; the others are the physics' own set.
    const s = play(startChase(defOf(40)), 0, 1, 2, 3, 4, 6);
    expect(s.runs).toBe(16);
    expect(s.balls.map((b) => b.runs)).toEqual([0, 1, 2, 3, 4, 6]);
    expect(s.balls[5]).toEqual({ overIndex: 0, ballIndex: 5, runs: 6, dismissal: null });
    const next = chaseReducer(s, ball(s, 1));
    expect(next.balls[6]).toMatchObject({ overIndex: 1, ballIndex: 0 });
  });

  it('abandoned is neither a win nor a loss, and it ends the chase for good', () => {
    const s = chaseReducer(play(startChase(defOf(14)), 1, 2), { type: 'abandon' });
    expect(s).toMatchObject({
      result: 'abandoned',
      runs: 3,
      decidingBall: null,
      requiredRate: null,
      requiredRateX100: null,
    });
    expect(isDecided(s)).toBe(false);
    expect(chaseSummary(s, 'play')).toBeNull();
    expect(chaseReducer(s, ball(s, 6))).toBe(s);
    expect(chaseReducer(s, { type: 'abandon' })).toBe(s);
    // A decided chase cannot be abandoned into something else.
    const won = play(startChase(defOf(1)), 1);
    expect(chaseReducer(won, { type: 'abandon' })).toBe(won);
  });
});

describe('what the chase refuses', () => {
  const s0 = startChase(defOf(14));

  it('a ball out of order, a ball twice, a runs value the physics never gives, and a wicket that scores', () => {
    expect(chaseError(s0, { type: 'ball', overIndex: 0, ballIndex: 1, runs: 0, dismissal: null })).toBe('wrong_ball');
    expect(chaseError(s0, { type: 'ball', overIndex: 1, ballIndex: 0, runs: 0, dismissal: null })).toBe('wrong_ball');
    const s1 = play(s0, 2);
    expect(chaseError(s1, { type: 'ball', overIndex: 0, ballIndex: 0, runs: 1, dismissal: null })).toBe('wrong_ball');
    expect(chaseError(s0, { type: 'ball', overIndex: 0, ballIndex: 0, runs: 5 as BallRuns, dismissal: null })).toBe(
      'bad_runs',
    );
    expect(chaseError(s0, { type: 'ball', overIndex: 0, ballIndex: 0, runs: -1 as BallRuns, dismissal: null })).toBe(
      'bad_runs',
    );
    expect(chaseError(s0, { type: 'ball', overIndex: 0, ballIndex: 0, runs: 2, dismissal: 'bowled' })).toBe(
      'bad_dismissal',
    );
    expect(
      chaseError(s0, { type: 'ball', overIndex: 0, ballIndex: 0, runs: 0, dismissal: 'run_out' as Dismissal }),
    ).toBe('bad_dismissal');
    expect(
      chaseError(s0, { type: 'ball', overIndex: 0, ballIndex: 0, runs: 0, dismissal: undefined as unknown as null }),
    ).toBe('bad_dismissal');
    for (const bad of [
      { type: 'ball', overIndex: 0, ballIndex: 1, runs: 0, dismissal: null },
      { type: 'ball', overIndex: 0, ballIndex: 0, runs: 5, dismissal: null },
    ] as ChaseAction[])
      expect(chaseReducer(s0, bad)).toBe(s0);
  });

  it('every dismissal the physics gives ends it', () => {
    for (const how of ['bowled', 'caught', 'caught_behind', 'lbw'] as const) {
      const s = chaseReducer(s0, ball(s0, 0, how));
      expect(s).toMatchObject({ result: 'lost_wicket', wicketsLost: 1 });
      expect(s.decidingBall?.dismissal).toBe(how);
    }
  });

  it('does not change a state it is given', () => {
    const frozen = JSON.stringify(s0);
    chaseReducer(s0, ball(s0, 4));
    expect(JSON.stringify(s0)).toBe(frozen);
  });
});

describe('the figures', () => {
  it('rounds the required rate to hundredths, halves up, as one integer', () => {
    expect(requiredRateX100Of(14, 12)).toBe(700);
    expect(requiredRateX100Of(7, 12)).toBe(350);
    expect(requiredRateX100Of(13, 7)).toBe(1114); // 13 * 600 / 7 = 1114.2857
    expect(requiredRateX100Of(1, 12)).toBe(50);
    expect(requiredRateX100Of(1, 7)).toBe(86); // 85.714
    expect(requiredRateX100Of(0, 5)).toBeNull();
    expect(requiredRateX100Of(5, 0)).toBeNull();
    expect(currentRateX100Of(0, 0)).toBeNull();
    expect(currentRateX100Of(7, 5)).toBe(840);
  });

  it('agrees with the floor formula the Unity HUD uses, for every needed and balls-left pair', () => {
    for (let need = 1; need <= CHASE_MAX_TARGET; need++)
      for (let left = 1; left <= CHASE_BALLS; left++) {
        const exact = Math.floor((need * 1200 + left) / (2 * left));
        expect(requiredRateX100Of(need, left)).toBe(exact);
        // ... and with toFixed(2) of the plain division, which is what a web screen would otherwise print.
        expect((exact / 100).toFixed(2)).toBe(((need * 6) / left).toFixed(2));
      }
  });

  it('allows what a chase allows, and never a restart or a practice ball in the middle of one', () => {
    const live = startChase(defOf(10));
    expect(chaseAllowed(live)).toEqual({
      bowl: true,
      practiceThisBall: false,
      watchDecidingBall: false,
      restartOver: false,
      tryAgain: false,
    });
    for (const done of [play(live, 6, 6), play(live, 'W'), play(live, ...Array<BallRuns>(12).fill(0))]) {
      expect(chaseAllowed(done)).toEqual({
        bowl: false,
        practiceThisBall: true,
        watchDecidingBall: true,
        restartOver: false,
        tryAgain: true,
      });
    }
    expect(chaseAllowed(chaseReducer(live, { type: 'abandon' }))).toMatchObject({
      bowl: false,
      practiceThisBall: false,
      tryAgain: true,
    });
  });

  it('summarises a finished chase for the win and loss screen', () => {
    expect(chaseSummary(startChase(defOf(10)), 'play')).toBeNull();
    const won = chaseSummary(play(startChase(defOf(10)), 4, 4, 6), 'learn')!;
    expect(won).toMatchObject({
      v: CHASE_VERSION,
      seed: 'c000',
      difficulty: 'standard',
      target: 10,
      result: 'won',
      runs: 14,
      ballsFaced: 3,
      ballsLeft: 9,
      runsShort: 0,
      assist: 'learn',
    });
    const lost = chaseSummary(play(startChase(defOf(10)), 4, 'W'), 'real')!;
    expect(lost).toMatchObject({ result: 'lost_wicket', runs: 4, runsShort: 6, ballsLeft: 10, assist: 'real' });
    expect(lost.decidingBall.key).toBe('0:1');
  });

  it('checks a definition', () => {
    expect(chaseDefinitionError(base)).toBeNull();
    expect(chaseDefinitionError(null)).toBe('not_an_object');
    expect(chaseDefinitionError({ ...base, v: 2 })).toBe('wrong_version');
    expect(chaseDefinitionError({ ...base, simVersion: 2 })).toBe('wrong_sim_version');
    expect(chaseDefinitionError({ ...base, seed: '' })).toBe('bad_seed');
    expect(chaseDefinitionError({ ...base, difficulty: 'insane' })).toBe('bad_difficulty');
    expect(chaseDefinitionError({ ...base, overs: 3 })).toBe('bad_shape');
    expect(chaseDefinitionError({ ...base, balls: 18 })).toBe('bad_shape');
    expect(chaseDefinitionError({ ...base, target: 0 })).toBe('bad_target');
    expect(chaseDefinitionError({ ...base, target: 73 })).toBe('bad_target');
    expect(chaseDefinitionError({ ...base, target: 6.5 })).toBe('bad_target');
    expect(chaseDefinitionError({ ...base, bowling: 'insane' })).toBe('bad_bowling');
    expect(chaseDefinitionError({ ...base, conditions: 'wet' })).toBe('bad_conditions');
    expect(chaseDefinitionError({ ...base, policy: null })).toBe('bad_policy');
    expect(chaseDefinitionError({ ...base, referenceWinRate: 2 })).toBe('bad_reference_rate');
  });
});

describe('properties of the reducer (500 random chases)', () => {
  const RUN_SET: BallRuns[] = [0, 0, 0, 0, 1, 1, 1, 2, 3, 4, 6];
  const HOW: Dismissal[] = ['bowled', 'caught', 'caught_behind', 'lbw'];

  interface Outcome {
    runs: BallRuns;
    dismissal: Dismissal | null;
    /** A malformed action the chase must refuse instead of the ball (null: the ball is as it should be). */
    corrupt: 'ball_order' | 'runs' | 'wicket_with_runs' | null;
  }

  /** A random chase: a target and a stream of ball outcomes (each ball a wicket about one time in nine). */
  function scenario(i: number) {
    const rng = rngFromKey(`chase-properties|${i}`);
    const target = 1 + rng.int(0, CHASE_MAX_TARGET - 1);
    const outcomes: Outcome[] = [];
    for (let k = 0; k < 16; k++) {
      const wicket = rng.float() < 1 / 9;
      const c = rng.float();
      outcomes.push({
        runs: wicket ? 0 : RUN_SET[rng.int(0, RUN_SET.length - 1)],
        dismissal: wicket ? HOW[rng.int(0, HOW.length - 1)] : null,
        corrupt: c < 0.04 ? 'ball_order' : c < 0.08 ? 'runs' : c < 0.12 ? 'wicket_with_runs' : null,
      });
    }
    return { target, outcomes };
  }

  /** The action for an outcome, built from the ball that is due (or malformed on purpose). */
  function actionFor(s: ChaseState, o: Outcome): ChaseAction {
    const due = dueBall(s.ballsFaced);
    if (o.corrupt === 'ball_order')
      return {
        type: 'ball',
        overIndex: due.overIndex,
        ballIndex: (due.ballIndex + 1) % 6,
        runs: o.runs,
        dismissal: o.dismissal,
      };
    if (o.corrupt === 'runs') return { type: 'ball', ...due, runs: 5 as BallRuns, dismissal: null };
    if (o.corrupt === 'wicket_with_runs') return { type: 'ball', ...due, runs: 4, dismissal: 'lbw' };
    return { type: 'ball', ...due, runs: o.runs, dismissal: o.dismissal };
  }

  it('keeps every figure consistent after every action, and decides once, for ever', () => {
    let refusedTotal = 0;
    let decidedTotal = 0;
    for (let i = 0; i < 500; i++) {
      const { target, outcomes } = scenario(i);
      let s = startChase(defOf(target));
      let decidedAt: ChaseState | null = null;
      for (const o of outcomes) {
        const a = actionFor(s, o);
        const refused = chaseError(s, a) !== null;
        const before = s;
        s = chaseReducer(s, a);
        if (refused) {
          refusedTotal++;
          expect(s).toBe(before);
          continue;
        }
        expect(s).not.toBe(before);
        expect(s.ballsFaced).toBe(before.ballsFaced + 1);
        expect(s.runs).toBeGreaterThanOrEqual(before.runs);
        expect(s.ballsFaced + s.ballsLeft).toBe(CHASE_BALLS);
        expect(s.balls).toHaveLength(s.ballsFaced);
        expect(s.runs).toBe(s.balls.reduce((n, b) => n + b.runs, 0));
        expect(s.runsNeeded).toBe(Math.max(0, target - s.runs));
        expect(s.wicketsLost).toBe(s.balls.some((b) => b.dismissal) ? 1 : 0);
        // The verdict follows the rules, and nothing else.
        const out = s.balls.some((b) => b.dismissal);
        const expected = out
          ? 'lost_wicket'
          : s.runs >= target
            ? 'won'
            : s.ballsFaced === CHASE_BALLS
              ? 'lost_balls'
              : 'in_progress';
        expect(s.result).toBe(expected);
        if (s.result === 'in_progress') {
          expect(s.decidingBall).toBeNull();
          expect(s.requiredRateX100).toBe(requiredRateX100Of(s.runsNeeded, s.ballsLeft));
          expect(s.runsNeeded).toBeGreaterThan(0);
          expect(s.ballsLeft).toBeGreaterThan(0);
        } else {
          expect(s.decidingBall).toMatchObject({ ballNumber: s.ballsFaced, runs: s.balls[s.ballsFaced - 1].runs });
          expect(s.requiredRate).toBeNull();
          expect(s.requiredRateX100).toBeNull();
          decidedAt ??= s;
        }
        if (s.result === 'won') expect(s.balls.slice(0, -1).reduce((n, b) => n + b.runs, 0)).toBeLessThan(target);
        expect(chaseAllowed(s).bowl).toBe(s.result === 'in_progress');
      }
      // Once decided, nothing changed it afterwards.
      if (decidedAt) {
        decidedTotal++;
        expect(s).toBe(decidedAt);
      }
    }
    // The random chases really did exercise the refusals and the endings.
    expect(refusedTotal).toBeGreaterThan(500);
    expect(decidedTotal).toBeGreaterThan(300);
  });

  it('is a pure function of the balls: the same balls give the same state, byte for byte', () => {
    const run = (target: number, outcomes: Outcome[]) =>
      outcomes.reduce((s, o) => chaseReducer(s, actionFor(s, o)), startChase(defOf(target)));
    for (let i = 0; i < 100; i++) {
      const { target, outcomes } = scenario(i);
      expect(JSON.stringify(run(target, outcomes))).toBe(JSON.stringify(run(target, outcomes)));
    }
  });

  it('a lower target is never harder: with the same balls it is won at least as early', () => {
    const run = (target: number, outcomes: Outcome[]) =>
      outcomes.reduce((s, o) => chaseReducer(s, actionFor(s, o)), startChase(defOf(target)));
    for (let i = 0; i < 200; i++) {
      const { target, outcomes } = scenario(i);
      const hi = run(target, outcomes);
      const lo = run(Math.max(1, target - 5), outcomes);
      if (hi.result === 'won') {
        expect(lo.result).toBe('won');
        expect(lo.ballsFaced).toBeLessThanOrEqual(hi.ballsFaced);
      }
    }
  });
});
