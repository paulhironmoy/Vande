// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  PRACTICE_MAX_OVERS,
  type Coaching,
  type ContactReport,
  type DeliveryOutcome,
  type DeliveryRecord,
  type DeliveryResult,
  type Dismissal,
  type PracticeInningsState,
  type SwingTiming,
} from '@/contracts/practice';
import { autoField } from '@/physics';
import {
  inningsError,
  inningsReducer,
  inningsSummary,
  newInnings,
  nextDelivery,
  overSummary,
  oversNotation,
  type InningsAction,
} from '@/practice/game/innings';
import { randomOver } from '@/practice/game/overs';
import { makeRecord } from '@/practice/game/replay';

const OPTS = { id: 'inn-1', conditions: 'balanced' as const, assist: 'play' as const, handedness: 'right' as const };
const over = (i: number) => randomOver({ seed: `over-${i}`, conditions: 'balanced', assist: 'play', beginner: false });
const fieldFor = (i: number) => autoField(over(i).bowler, 'balanced');
const choose = (s: PracticeInningsState, i = s.overs.length): PracticeInningsState => inningsReducer(s, { type: 'chooseOver', plan: over(i), field: fieldFor(i) });

/** Bowl the next ball with a given result summary (the reducer's rules do not depend on the physics). */
function bowl(s: PracticeInningsState, runs: DeliveryOutcome['runs'] = 0, dismissal: Dismissal | null = null): PracticeInningsState {
  const next = nextDelivery(s)!;
  const started = inningsReducer(s, { type: 'deliveryStarted' });
  expect(started.inFlight).toEqual({ overIndex: next.overIndex, ballIndex: next.ballIndex });
  const record = makeRecord(next, null, 0, { outcome: { runs, dismissal } as DeliveryOutcome });
  return inningsReducer(started, { type: 'deliveryResolved', record });
}
const bowlOver = (s: PracticeInningsState, runs: DeliveryOutcome['runs'][] = [0, 0, 0, 0, 0, 0]) => runs.reduce((acc, r) => bowl(acc, r), s);

describe('the one-wicket innings', () => {
  it('starts at 0 for 0, choosing an over', () => {
    const s = newInnings(OPTS);
    expect(s).toMatchObject({ status: 'choosing_over', runs: 0, balls: 0, overs: [], current: null, inFlight: null, dismissal: null, version: 1 });
  });

  it('bats a full over, accumulates runs, then offers the next over', () => {
    let s = choose(newInnings(OPTS));
    expect(s.status).toBe('batting');
    s = bowlOver(s, [1, 0, 4, 2, 0, 6]);
    expect(s).toMatchObject({ status: 'over_complete', runs: 13, balls: 6, current: null });
    expect(s.overs).toHaveLength(1);
    expect(s.overs[0].deliveries.map((d) => d.ballIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    s = inningsReducer(s, { type: 'nextOver' });
    expect(s.status).toBe('choosing_over');
    s = bowlOver(choose(s), [3, 3, 0, 0, 0, 1]);
    expect(s).toMatchObject({ runs: 20, balls: 12, status: 'over_complete' });
  });

  it('a wicket on any ball ends the innings at once', () => {
    for (let ball = 0; ball < 6; ball++) {
      let s = choose(newInnings(OPTS));
      for (let k = 0; k < ball; k++) s = bowl(s, 1);
      s = bowl(s, 0, 'caught');
      expect(s.status).toBe('out');
      expect(s.dismissal?.record.ballIndex).toBe(ball);
      expect(s.balls).toBe(ball + 1);
      expect(s.runs).toBe(ball);
      for (const a of [{ type: 'deliveryStarted' }, { type: 'nextOver' }, { type: 'chooseOver', plan: over(1), field: fieldFor(1) }, { type: 'abandon' }] as InningsAction[]) {
        expect(inningsReducer(s, a)).toBe(s);
      }
    }
  });

  it('a full over must be finished before another is chosen', () => {
    let s = bowl(choose(newInnings(OPTS)), 2);
    expect(inningsError(s, { type: 'chooseOver', plan: over(5), field: fieldFor(5) })).toBe('finish_the_over_first');
    expect(inningsReducer(s, { type: 'nextOver' })).toBe(s);
    s = bowlOver(s, [0, 0, 0, 0, 0]);
    expect(s.status).toBe('over_complete');
    expect(inningsError(s, { type: 'chooseOver', plan: over(5), field: fieldFor(5) })).toBe('not_choosing');
  });

  it('ends after ten completed overs', () => {
    let s = newInnings(OPTS);
    for (let o = 0; o < PRACTICE_MAX_OVERS; o++) {
      s = bowlOver(choose(s), [1, 1, 1, 1, 1, 1]);
      if (o < PRACTICE_MAX_OVERS - 1) {
        expect(s.status).toBe('over_complete');
        s = inningsReducer(s, { type: 'nextOver' });
      }
    }
    expect(s).toMatchObject({ status: 'complete', runs: 60, balls: 60 });
    expect(s.overs).toHaveLength(10);
    expect(inningsReducer(s, { type: 'nextOver' })).toBe(s);
  });

  it('a delivery must start before it resolves, resolves once, and must be the next ball of this over', () => {
    let s = choose(newInnings(OPTS));
    const next = nextDelivery(s)!;
    const record = makeRecord(next, null, 0, { outcome: { runs: 4, dismissal: null } as DeliveryOutcome });
    expect(inningsError(s, { type: 'deliveryResolved', record })).toBe('delivery_not_started');
    s = inningsReducer(s, { type: 'deliveryStarted' });
    expect(inningsError(s, { type: 'deliveryStarted' })).toBe('delivery_in_flight');
    expect(inningsError(s, { type: 'deliveryResolved', record: { ...record, ballIndex: 1 } })).toBe('wrong_ball');
    expect(inningsError(s, { type: 'deliveryResolved', record: { ...record, seed: 'other' } })).toBe('not_this_delivery');
    expect(inningsError(s, { type: 'deliveryResolved', record: { ...record, plan: { ...record.plan, speedKph: 99 } } })).toBe('not_this_delivery');
    expect(inningsError(s, { type: 'deliveryResolved', record: { ...record, assist: 'learn' } })).toBe('wrong_settings');
    expect(inningsError(s, { type: 'deliveryResolved', record: { ...record, field: autoField(over(0).bowler, 'green') } })).toBe('wrong_field');
    expect(inningsError(s, { type: 'deliveryResolved', record: { ...record, runs: 5 as DeliveryOutcome['runs'] } })).toBe('bad_runs');
    expect(inningsError(s, { type: 'deliveryResolved', record: { ...record, runs: 4, dismissal: 'bowled' } })).toBe('bad_dismissal');
    s = inningsReducer(s, { type: 'deliveryResolved', record });
    expect(s).toMatchObject({ runs: 4, balls: 1, inFlight: null });
    expect(inningsError(s, { type: 'deliveryResolved', record })).toBe('delivery_not_started');
  });

  it('rejects an illegal over or field', () => {
    const s = newInnings(OPTS);
    const plan = over(0);
    expect(inningsError(s, { type: 'chooseOver', plan: { ...plan, balls: plan.balls.slice(0, 5) as unknown as typeof plan.balls }, field: fieldFor(0) })).toMatch(/^illegal_over/);
    expect(inningsError(s, { type: 'chooseOver', plan, field: { ...fieldFor(0), fielders: fieldFor(0).fielders.slice(1) } })).toMatch(/^illegal_field/);
  });

  it('abandoning ends the innings with the score so far', () => {
    let s = bowl(bowl(choose(newInnings(OPTS)), 4), 1);
    s = inningsReducer(inningsReducer(s, { type: 'deliveryStarted' }), { type: 'abandon' });
    expect(s).toMatchObject({ status: 'complete', runs: 5, balls: 2, inFlight: null });
  });

  it('is pure: actions never mutate the previous state', () => {
    const s0 = choose(newInnings(OPTS));
    const frozen = JSON.stringify(s0);
    bowlOver(s0, [1, 2, 3, 4, 6, 0]);
    expect(JSON.stringify(s0)).toBe(frozen);
  });
});

/** A minimal resolved result for the summaries (only what they read). */
function fakeResult(record: DeliveryRecord, o: { timing: SwingTiming; kind?: ContactReport['kind']; region?: DeliveryOutcome['region']; reason?: Coaching['reason'] }): DeliveryResult {
  return {
    outcome: { runs: record.runs, boundary: record.runs === 4 || record.runs === 6 ? record.runs : null, dismissal: record.dismissal, fielderId: null, endBearingDeg: null, endDistanceM: null, region: o.region ?? null },
    contact: { kind: o.kind ?? (o.timing === 'none' ? 'leave' : 'middle'), timing: o.timing } as ContactReport,
    coaching: { reason: o.reason ?? 'found_the_gap', timing: null, zone: null, fielderRole: null, lbw: null },
    swing: o.timing === 'none' ? null : ({} as DeliveryResult['swing']),
    footwork: 'forward',
    lbw: null,
  } as DeliveryResult;
}

describe('summaries', () => {
  it('over summary: runs, balls, boundaries, timing, scoring areas and the weakest ball', () => {
    let s = choose(newInnings(OPTS));
    s = bowlOver(s, [4, 0, 1, 6, 0, 2]);
    const o = s.overs[0];
    const look: Array<Parameters<typeof fakeResult>[1]> = [
      { timing: 'perfect', region: 'cover' },
      { timing: 'none', reason: 'left_well' },
      { timing: 'solid', region: 'midwicket' },
      { timing: 'perfect', region: 'straight', reason: 'cleared_the_rope' },
      { timing: 'missed', kind: 'miss', reason: 'beaten_by_seam' },
      { timing: 'mistimed', region: 'cover' },
    ];
    const results = o.deliveries.map((r, i) => fakeResult(r, look[i]));
    const sum = overSummary(o, results);
    expect(sum).toMatchObject({ overIndex: 0, runs: 13, balls: 6, fours: 1, sixes: 1, boundaries: 2, dots: 2, complete: true, dismissal: null });
    expect(sum.timing).toEqual({ perfect: 2, solid: 1, mistimed: 1, missed: 1, none: 1 });
    expect(sum.scoringAreas.find((a) => a.region === 'straight')).toEqual({ region: 'straight', runs: 6, balls: 1 });
    expect(sum.scoringAreas[0]).toEqual({ region: 'cover', runs: 6, balls: 2 });
    expect(sum.scoringAreas.find((a) => a.region === 'cover')).toEqual({ region: 'cover', runs: 6, balls: 2 });
    expect(sum.weakest).toMatchObject({ ballIndex: 4, reason: 'beaten_by_seam', timing: 'missed' });
  });

  it('innings summary: score, overs notation, survival and the dismissal', () => {
    let s = choose(newInnings(OPTS));
    s = bowlOver(s, [1, 1, 1, 1, 1, 1]);
    s = choose(inningsReducer(s, { type: 'nextOver' }));
    s = bowl(bowl(s, 4), 0, 'bowled');
    const cache = new Map<string, DeliveryResult>();
    for (const o of [...s.overs, s.current!]) for (const r of o.deliveries) cache.set(`${r.overIndex}:${r.ballIndex}`, fakeResult(r, { timing: r.dismissal ? 'missed' : 'solid', kind: r.dismissal ? 'miss' : 'middle', region: r.dismissal ? null : 'cover', reason: r.dismissal ? 'missed_straight_ball' : 'found_the_gap' }));
    const sum = inningsSummary(s, cache);
    expect(sum).toMatchObject({ status: 'out', finished: true, runs: 10, balls: 8, overs: '1.2', completedOvers: 1, survivedBalls: 7, fours: 1, sixes: 0 });
    expect(sum.perOver).toHaveLength(2);
    expect(sum.dismissal).toMatchObject({ how: 'bowled', reason: 'missed_straight_ball', ballNumber: 8, at: '1.2' });
    expect(sum.strikeRate).toBe(125);
    expect(oversNotation(60)).toBe('10.0');
  });
});
