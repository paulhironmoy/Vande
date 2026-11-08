// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { deliveryContext, matchPressure, type MatchSituation } from '@/audio/situation';
import {
  CHASE_ASK_LIMITS,
  askOf,
  audioSituation,
  chaseBridgeBlock,
  chaseReducer,
  chaseSituation,
  dueBall,
  makeChase,
  startChase,
  type BallRuns,
  type ChaseSituation,
  type ChaseState,
} from '@/practice/chase';

const base = makeChase('c000', 'standard')!;
const chaseOf = (target: number): ChaseState => startChase({ ...base, target });
const play = (s: ChaseState, ...runs: Array<BallRuns | 'W'>): ChaseState =>
  runs.reduce<ChaseState>(
    (acc, r) =>
      chaseReducer(acc, {
        type: 'ball',
        ...dueBall(acc.ballsFaced),
        runs: r === 'W' ? 0 : r,
        dismissal: r === 'W' ? 'bowled' : null,
      }),
    s,
  );

describe('the match situation', () => {
  it('describes the start of a chase', () => {
    expect(chaseSituation(chaseOf(14))).toEqual<ChaseSituation>({
      v: 1,
      result: 'in_progress',
      target: 14,
      runs: 0,
      runsNeeded: 14,
      ballsFaced: 0,
      ballsLeft: 12,
      ballNumber: 1,
      overNumber: 1,
      ballInOver: 1,
      ballsLeftInOver: 6,
      wicketsLeft: 1,
      requiredRateX100: 700,
      requiredRate: 7,
      currentRateX100: null,
      currentRate: null,
      phase: 'first_over',
      ask: 'steady',
      winnable: true,
      oneBallFinish: false,
      lastBall: false,
      pressure: matchPressure({ runs: 0, wicketsInHand: 1, ballsLeft: 12, target: 14, batterRuns: 0 }),
    });
  });

  it('names the ball due next, the over and the phase all the way through', () => {
    let s = chaseOf(72);
    const seen: Array<[number, number, number, number, string]> = [];
    for (let k = 0; k < 12; k++) {
      const x = chaseSituation(s);
      seen.push([x.ballNumber, x.overNumber, x.ballInOver, x.ballsLeftInOver, x.phase]);
      s = play(s, 1);
    }
    expect(seen).toEqual([
      [1, 1, 1, 6, 'first_over'],
      [2, 1, 2, 5, 'first_over'],
      [3, 1, 3, 4, 'first_over'],
      [4, 1, 4, 3, 'first_over'],
      [5, 1, 5, 2, 'first_over'],
      [6, 1, 6, 1, 'first_over'],
      [7, 2, 1, 6, 'last_over'],
      [8, 2, 2, 5, 'last_over'],
      [9, 2, 3, 4, 'last_over'],
      [10, 2, 4, 3, 'last_over'],
      [11, 2, 5, 2, 'last_over'],
      [12, 2, 6, 1, 'last_ball'],
    ]);
  });

  it('flags the last ball and a ball that can win it', () => {
    const last = chaseSituation(play(chaseOf(20), 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1));
    expect(last).toMatchObject({
      lastBall: true,
      phase: 'last_ball',
      ballsLeft: 1,
      runsNeeded: 9,
      oneBallFinish: false,
      winnable: false,
    });
    expect(chaseSituation(play(chaseOf(14), 6, 4, 1, 1, 0, 0, 0))).toMatchObject({
      runsNeeded: 2,
      oneBallFinish: true,
      winnable: true,
    });
    expect(chaseSituation(chaseOf(6))).toMatchObject({ oneBallFinish: true });
    expect(chaseSituation(chaseOf(7))).toMatchObject({ oneBallFinish: false });
  });

  it('knows when the target is out of reach (more than six a ball) but keeps the chase going', () => {
    const s = play(chaseOf(40), 0, 0, 0, 0, 0, 0, 0);
    expect(s.result).toBe('in_progress');
    expect(chaseSituation(s)).toMatchObject({ runsNeeded: 40, ballsLeft: 5, winnable: false, ask: 'out_of_reach' });
  });

  it('is finished, with every ball figure at zero, once the chase is decided', () => {
    for (const s of [play(chaseOf(4), 6), play(chaseOf(20), 'W'), play(chaseOf(20), ...Array<BallRuns>(12).fill(0))]) {
      expect(chaseSituation(s)).toMatchObject({
        phase: 'finished',
        ask: 'done',
        ballNumber: 0,
        overNumber: 0,
        ballInOver: 0,
        ballsLeftInOver: 0,
        lastBall: false,
        oneBallFinish: false,
        pressure: 0,
        requiredRate: null,
      });
    }
    expect(chaseSituation(play(chaseOf(4), 6)).winnable).toBe(true);
    expect(chaseSituation(play(chaseOf(20), 'W')).winnable).toBe(false);
    expect(chaseSituation(chaseReducer(chaseOf(9), { type: 'abandon' }))).toMatchObject({
      result: 'abandoned',
      phase: 'finished',
    });
  });

  it('grades what the target asks per remaining ball', () => {
    expect(CHASE_ASK_LIMITS).toEqual({ comfortable: 1, steady: 2, stretching: 3.5, demanding: 6 });
    expect(askOf(6, 6)).toBe('comfortable');
    expect(askOf(7, 6)).toBe('steady');
    expect(askOf(12, 6)).toBe('steady');
    expect(askOf(13, 6)).toBe('stretching');
    expect(askOf(21, 6)).toBe('stretching');
    expect(askOf(22, 6)).toBe('demanding');
    expect(askOf(36, 6)).toBe('demanding');
    expect(askOf(37, 6)).toBe('out_of_reach');
    expect(askOf(1, 0)).toBe('out_of_reach');
    expect(askOf(0, 5)).toBe('comfortable');
  });

  it('only gets harder to ask for as the runs needed grow, balls left fixed', () => {
    const order = ['comfortable', 'steady', 'stretching', 'demanding', 'out_of_reach'];
    for (let left = 1; left <= 12; left++) {
      let last = 0;
      for (let need = 1; need <= 72; need++) {
        const i = order.indexOf(askOf(need, left));
        expect(i).toBeGreaterThanOrEqual(last);
        last = i;
      }
    }
  });

  it('is JSON-safe and the same for the same state', () => {
    const s = play(chaseOf(15), 4, 0, 1);
    expect(JSON.parse(JSON.stringify(chaseSituation(s)))).toEqual(chaseSituation(s));
  });
});

describe('the crowd hears the chase', () => {
  it('gives the audio situation exactly as src/audio/situation.ts takes it', () => {
    const s = play(chaseOf(18), 4, 1);
    const audio: MatchSituation = audioSituation(s);
    expect(audio).toEqual({ runs: 5, wicketsInHand: 1, ballsLeft: 10, target: 18, batterRuns: 5 });
    expect(deliveryContext(audio)).toMatchObject({ wicketEndsInnings: true });
    expect(chaseSituation(s).pressure).toBe(matchPressure(audio));
    expect(audioSituation(play(chaseOf(18), 'W')).wicketsInHand).toBe(0);
  });

  it('feels more pressure the nearer the end, for the same runs still needed', () => {
    for (const need of [4, 6, 10, 14]) {
      let last = -1;
      for (let left = 12; left >= 1; left--) {
        if (need > 6 * left) break;
        // The chase with `need` runs to get and `left` balls to go: runs 12 - left balls of one run each.
        const s = chaseOf(need + (12 - left));
        const state = play(s, ...Array<BallRuns>(12 - left).fill(1));
        expect(state.runsNeeded).toBe(need);
        const p = chaseSituation(state).pressure;
        expect(p, `need ${need} left ${left}`).toBeGreaterThanOrEqual(last);
        expect(p).toBeLessThanOrEqual(1);
        last = p;
      }
    }
  });

  it('feels most pressure on the last ball of a close chase, and little when it cannot be won', () => {
    const last = chaseSituation(play(chaseOf(17), ...Array<BallRuns>(11).fill(1)));
    expect(last).toMatchObject({ runsNeeded: 6, ballsLeft: 1, winnable: true, lastBall: true });
    const early = chaseSituation(chaseOf(17));
    expect(last.pressure).toBeGreaterThan(early.pressure);
    expect(last.pressure).toBe(1);
    // A target that even a six cannot reach is not tense.
    const lost = chaseSituation(play(chaseOf(18), ...Array<BallRuns>(11).fill(1)));
    expect(lost).toMatchObject({ runsNeeded: 7, winnable: false });
    expect(lost.pressure).toBeLessThan(early.pressure);
  });
});

describe('the figures the Unity bridge carries', () => {
  it('are the six figures, with the four result spellings', () => {
    const live = play(chaseOf(14), 4, 2);
    expect(chaseBridgeBlock(live)).toEqual({
      target: 14,
      maxBalls: 12,
      runsNeeded: 8,
      ballsLeft: 10,
      outcome: 'in_progress',
      requiredRateX100: 480,
    });
    expect(chaseBridgeBlock(play(chaseOf(6), 6))).toEqual({
      target: 6,
      maxBalls: 12,
      runsNeeded: 0,
      ballsLeft: 11,
      outcome: 'won',
      requiredRateX100: null,
    });
    // A wicket does not zero the balls left.
    expect(chaseBridgeBlock(play(chaseOf(20), 1, 'W'))).toMatchObject({
      outcome: 'lost_wicket',
      ballsLeft: 10,
      runsNeeded: 19,
      requiredRateX100: null,
    });
    expect(chaseBridgeBlock(play(chaseOf(20), ...Array<BallRuns>(12).fill(0)))).toMatchObject({
      outcome: 'lost_balls',
      ballsLeft: 0,
      runsNeeded: 20,
    });
    expect(chaseBridgeBlock(chaseReducer(chaseOf(20), { type: 'abandon' }))).toBeNull();
  });

  it('agrees with the score the bridge sends for every ball: runs, balls and wickets', () => {
    let s = chaseOf(40);
    for (const r of [1, 0, 6, 'W'] as Array<BallRuns | 'W'>) {
      s = play(s, r);
      const b = chaseBridgeBlock(s)!;
      expect(b.ballsLeft).toBe(12 - s.ballsFaced);
      expect(b.runsNeeded).toBe(Math.max(0, 40 - s.runs));
    }
    expect(s.wicketsLost).toBe(1);
    expect(s.runs).toBe(7);
    expect(s.ballsFaced).toBe(4);
  });
});
