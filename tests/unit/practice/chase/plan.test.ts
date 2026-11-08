// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { DeliveryOutcome, PracticeInningsState } from '@/contracts/practice';
import { autoField } from '@/physics';
import { inningsReducer, nextDelivery, validateOver } from '@/practice/game';
import {
  CHASE_BALLS,
  ballActionOf,
  chaseFromInnings,
  chaseInningsAction,
  chaseInningsError,
  chaseInningsReducer,
  chaseOver,
  chaseOvers,
  chaseReducer,
  chaseSeedAt,
  chaseStep,
  inningsDeliveries,
  makeChase,
  resumeChase,
  startChase,
  startChaseInnings,
  verifyChaseInnings,
  type ChaseDefinition,
} from '@/practice/chase';
import { DEFEND_ALL, DRIVE_ALL, LEAVE_ALL, MIXED, makeRecord, playChase, syntheticInnings } from './helpers';

const def0 = makeChase('c000', 'standard')!;
const lowTarget = (d: ChaseDefinition, target: number): ChaseDefinition => ({ ...d, target });

describe('the 12 balls of a chase', () => {
  it('are two legal Practice overs made from the seed, with the field Practice sets for them', () => {
    const [a, b] = chaseOvers(def0, 'right');
    for (const [i, o] of [a, b].entries()) {
      expect(o.overIndex).toBe(i);
      expect(o.plan.balls).toHaveLength(6);
      expect(validateOver(o.plan)).toMatchObject({ ok: true });
      expect(o.plan.source).toBe('random');
      expect(o.field).toEqual(autoField(o.plan.bowler, 'balanced', 'right', o.plan.ball));
    }
    expect(a.plan.seed).not.toBe(b.plan.seed);
  });

  it('are the same every time for a seed, and the same at every difficulty', () => {
    const first = JSON.stringify(chaseOvers(def0, 'right'));
    expect(JSON.stringify(chaseOvers(def0, 'right'))).toBe(first);
    for (const d of ['easy', 'standard', 'hard'] as const)
      expect(JSON.stringify(chaseOvers(makeChase('c000', d)!, 'right'))).toBe(first);
    expect(JSON.stringify(chaseOver(def0, 1, 'right'))).toBe(JSON.stringify(chaseOvers(def0, 'right')[1]));
  });

  it('differ from seed to seed', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const [a, b] = chaseOvers(makeChase(chaseSeedAt(i))!, 'right');
      seen.add(JSON.stringify(a.plan.balls));
      seen.add(JSON.stringify(b.plan.balls));
    }
    expect(seen.size).toBe(48);
  });

  it('are the mirror image for a left-hander: the same balls from bowlers of the other arm, in the field that gives', () => {
    const right = chaseOvers(def0, 'right');
    const left = chaseOvers(def0, 'left');
    right.forEach((r, i) => {
      const l = left[i];
      expect(l.plan.bowler.arm).toBe(r.plan.bowler.arm === 'right' ? 'left' : 'right');
      expect({ ...l.plan, bowler: { ...l.plan.bowler, arm: r.plan.bowler.arm } }).toEqual(r.plan);
      expect(validateOver(l.plan)).toMatchObject({ ok: true });
      // The physics flips the arm again for a left-handed striker, so the field it sets is the right-hander's.
      expect(l.field).toEqual(r.field);
      expect(l.field).toEqual(autoField(l.plan.bowler, 'balanced', 'left', l.plan.ball));
    });
  });
});

describe('a chase on the Practice innings', () => {
  it('starts with the first over chosen and the first ball next', () => {
    const innings = startChaseInnings(def0, { id: 'x', assist: 'learn', handedness: 'right' });
    expect(innings).toMatchObject({ status: 'batting', runs: 0, balls: 0, assist: 'learn', conditions: 'balanced' });
    expect(innings.current?.plan).toEqual(chaseOver(def0, 0, 'right').plan);
    const step = chaseStep(def0, innings);
    expect(step.kind).toBe('bowl');
    if (step.kind === 'bowl') expect(step.next).toMatchObject({ overIndex: 0, ballIndex: 0 });
    expect(chaseFromInnings(def0, innings)).toEqual(startChase(def0));
    expect(verifyChaseInnings(def0, innings)).toBeNull();
  });

  it('waits while a ball is in flight', () => {
    const innings = startChaseInnings(def0, { id: 'x', assist: 'play', handedness: 'right' });
    const started = chaseInningsReducer(def0, innings, { type: 'deliveryStarted' });
    expect(chaseStep(def0, started)).toEqual({ kind: 'wait' });
  });

  it('is counted exactly as the innings counts it, after every ball, whatever the batter does', () => {
    for (const [name, batter] of Object.entries({ drive: DRIVE_ALL, mixed: MIXED, defend: DEFEND_ALL })) {
      const played = playChase(lowTarget(def0, 40), batter);
      let state = startChase(lowTarget(def0, 40));
      for (const r of played.records) state = chaseReducer(state, ballActionOf(r));
      expect(state, name).toEqual(played.state);
      expect(played.state.runs, name).toBe(played.innings.runs);
      expect(played.state.ballsFaced, name).toBe(played.innings.balls);
      expect(played.state.wicketsLost, name).toBe(played.innings.dismissal ? 1 : 0);
      expect(verifyChaseInnings(lowTarget(def0, 40), played.innings), name).toBeNull();
    }
  });

  it('is won when the target is reached, and the innings is closed with the runs it had', () => {
    const def = lowTarget(def0, 1);
    // Leaving every ball scores nothing, so find a seed whose first balls a straight drive does score off.
    let found = false;
    for (let i = 0; i < 12 && !found; i++) {
      const d = lowTarget(makeChase(chaseSeedAt(i))!, 1);
      const p = playChase(d, DRIVE_ALL);
      if (p.state.result === 'won') {
        found = true;
        expect(p.summary).toMatchObject({ result: 'won', runsShort: 0, target: 1 });
        expect(p.innings.status).toBe('complete');
        expect(p.state.runs).toBeGreaterThanOrEqual(1);
        // The winning ball ended it: no more balls than the one that scored.
        expect(p.state.ballsFaced).toBe(p.records.length);
        expect(p.state.decidingBall?.runs).toBeGreaterThanOrEqual(1);
      }
    }
    expect(found).toBe(true);
    expect(def.target).toBe(1);
  });

  it('is lost by the wicket when the batter is out, and the innings is already out', () => {
    let found = false;
    for (let i = 0; i < 16 && !found; i++) {
      const d = makeChase(chaseSeedAt(i))!;
      const p = playChase(d, LEAVE_ALL);
      if (p.state.result === 'lost_wicket') {
        found = true;
        expect(p.innings.status).toBe('out');
        expect(p.summary).toMatchObject({ result: 'lost_wicket' });
        expect(p.state.decidingBall?.dismissal).not.toBeNull();
        expect(p.state.wicketsLost).toBe(1);
      }
    }
    expect(found).toBe(true);
  });

  it('is lost by the balls when the 12 are bowled and the target is not reached', () => {
    let found = false;
    for (let i = 0; i < 24 && !found; i++) {
      const d = lowTarget(makeChase(chaseSeedAt(i))!, 72);
      const p = playChase(d, DEFEND_ALL);
      if (p.state.result === 'lost_balls') {
        found = true;
        expect(p.state.ballsFaced).toBe(CHASE_BALLS);
        expect(p.innings.overs).toHaveLength(2);
        expect(p.innings.status).toBe('complete');
        expect(p.summary).toMatchObject({ result: 'lost_balls', ballsLeft: 0 });
        expect(p.summary!.runsShort).toBe(72 - p.state.runs);
      }
    }
    expect(found).toBe(true);
  });

  it("goes over to the second over by itself: next over, then the chase's own second over", () => {
    const def = lowTarget(def0, 72);
    let innings: PracticeInningsState = startChaseInnings(def, { id: 'x', assist: 'play', handedness: 'right' });
    for (let k = 0; k < 6; k++) {
      const step = chaseStep(def, innings);
      if (step.kind !== 'bowl') throw new Error(step.kind);
      innings = chaseInningsReducer(def, innings, { type: 'deliveryStarted' });
      const record = makeRecord(step.next, null, 0, { outcome: { runs: 0, dismissal: null } as DeliveryOutcome });
      innings = chaseInningsReducer(def, innings, { type: 'deliveryResolved', record });
    }
    expect(innings.status).toBe('over_complete');
    expect(chaseStep(def, innings)).toEqual({ kind: 'next_over' });
    expect(chaseInningsAction(def, innings)).toEqual({ type: 'nextOver' });
    innings = chaseInningsReducer(def, innings, { type: 'nextOver' });
    const step = chaseStep(def, innings);
    expect(step.kind).toBe('choose_over');
    const action = chaseInningsAction(def, innings);
    expect(action).toMatchObject({ type: 'chooseOver' });
    innings = chaseInningsReducer(def, innings, action!);
    expect(innings.status).toBe('batting');
    expect(innings.current?.plan).toEqual(chaseOver(def, 1, 'right').plan);
    const next = nextDelivery(innings)!;
    expect(next).toMatchObject({ overIndex: 1, ballIndex: 0 });
  });
});

describe('what a chase does not allow on the innings', () => {
  const def72 = lowTarget(def0, 72);

  it('never restarts an over (it would take runs off)', () => {
    const one = syntheticInnings(def72, [{ runs: 1 }]);
    expect(one.balls).toBe(1);
    expect(chaseInningsError(def72, one, { type: 'restartOver' })).toBe('restart_not_allowed_in_chase');
    expect(chaseInningsReducer(def72, one, { type: 'restartOver' })).toBe(one);
    // The innings by itself would have allowed it.
    expect(inningsReducer(one, { type: 'restartOver' }).balls).toBe(0);
  });

  it("only lets the chase's own overs be chosen, and only two", () => {
    const other = chaseOver(makeChase('c001')!, 0, 'right');
    const mine = chaseOver(def0, 0, 'right');
    const bare = {
      ...startChaseInnings(def0, { id: 'x', assist: 'play', handedness: 'right' }),
      status: 'choosing_over',
      current: null,
    } as PracticeInningsState;
    expect(chaseInningsError(def0, bare, { type: 'chooseOver', plan: other.plan, field: other.field })).toBe(
      'not_the_chase_over',
    );
    expect(chaseInningsError(def0, bare, { type: 'chooseOver', plan: mine.plan, field: mine.field })).toBeNull();
    // A wrong field for the right plan is refused too.
    expect(
      chaseInningsError(def0, bare, {
        type: 'chooseOver',
        plan: mine.plan,
        field: { ...mine.field, fielders: mine.field.fielders.map((f, i) => (i === 2 ? { ...f, x: f.x + 7 } : f)) },
      }),
    ).toBe('not_the_chase_over');
    // The second over is the chase's second, not the first again.
    const afterOne = chaseInningsReducer(def72, syntheticInnings(def72, Array(6).fill({ runs: 0 })), {
      type: 'nextOver',
    });
    expect(afterOne.status).toBe('choosing_over');
    const second = chaseOver(def72, 1, 'right');
    expect(
      chaseInningsError(def72, afterOne, { type: 'chooseOver', plan: second.plan, field: second.field }),
    ).toBeNull();
    const first = chaseOver(def72, 0, 'right');
    expect(chaseInningsError(def72, afterOne, { type: 'chooseOver', plan: first.plan, field: first.field })).toBe(
      'not_the_chase_over',
    );
    // There is no third.
    const third = {
      ...afterOne,
      overs: [afterOne.overs[0], afterOne.overs[0]],
    } as unknown as PracticeInningsState;
    expect(chaseInningsError(def72, third, { type: 'chooseOver', plan: second.plan, field: second.field })).toBe(
      'chase_has_two_overs',
    );
  });

  it('refuses a ball after the win, and the screen then closes the innings', () => {
    const def = lowTarget(def0, 4);
    const innings = syntheticInnings(def, [{ runs: 0 }, { runs: 6 }]);
    expect(innings).toMatchObject({ status: 'batting', runs: 6, balls: 2 });
    expect(chaseFromInnings(def, innings)).toMatchObject({ result: 'won', ballsFaced: 2 });
    expect(chaseStep(def, innings)).toMatchObject({
      kind: 'finished',
      closeInnings: true,
      summary: { result: 'won', runsShort: 0 },
    });
    expect(chaseInningsError(def, innings, { type: 'deliveryStarted' })).toBe('chase_over');
    expect(chaseInningsError(def, innings, { type: 'nextOver' })).not.toBeNull();
    expect(chaseInningsAction(def, innings)).toEqual({ type: 'abandon' });
    expect(chaseInningsReducer(def, innings, { type: 'deliveryStarted' })).toBe(innings);
    const closed = chaseInningsReducer(def, innings, { type: 'abandon' });
    expect(closed.status).toBe('complete');
    // Closing the innings did not change the chase: still a win, with the same score.
    expect(chaseFromInnings(def, closed)).toEqual(chaseFromInnings(def, innings));
    expect(chaseStep(def, closed)).toMatchObject({ kind: 'finished', closeInnings: false });
    expect(chaseInningsAction(def, closed)).toBeNull();
    expect(chaseInningsError(def, closed, { type: 'abandon' })).toBe('innings_over');
  });

  it('is finished at once by a wicket (the innings is already out), and by the 12th ball', () => {
    const out = syntheticInnings(def72, [{ runs: 2 }, { runs: 0, dismissal: 'lbw' }]);
    expect(out.status).toBe('out');
    expect(chaseFromInnings(def72, out)).toMatchObject({ result: 'lost_wicket', runs: 2, ballsFaced: 2 });
    expect(chaseStep(def72, out)).toMatchObject({ kind: 'finished', closeInnings: false });
    const twelve = syntheticInnings(def72, Array(12).fill({ runs: 1 }));
    expect(twelve.status).toBe('over_complete');
    expect(chaseFromInnings(def72, twelve)).toMatchObject({ result: 'lost_balls', runs: 12, ballsFaced: 12 });
    expect(chaseStep(def72, twelve)).toMatchObject({
      kind: 'finished',
      closeInnings: true,
      summary: { runsShort: 60 },
    });
    expect(chaseInningsReducer(def72, twelve, { type: 'nextOver' })).toBe(twelve);
  });

  it('is abandoned, not lost, when the innings is abandoned with the chase open', () => {
    const mid = syntheticInnings(def72, [{ runs: 1 }, { runs: 4 }]);
    const left = chaseInningsReducer(def72, mid, { type: 'abandon' });
    expect(chaseFromInnings(def72, left)).toMatchObject({ result: 'abandoned', runs: 5 });
    expect(chaseStep(def72, left)).toEqual({ kind: 'finished', summary: null, closeInnings: false });
  });
});

describe('resuming a saved chase', () => {
  const def = lowTarget(def0, 30);

  it('resolves a ball that was in flight as a leave, the same way every time', () => {
    const inFlight = syntheticInnings(def, [{ runs: 1 }, { runs: 0 }], { inFlight: true });
    expect(inFlight.inFlight).not.toBeNull();
    const saved = { v: 1 as const, definition: def, innings: inFlight };
    const a = resumeChase(saved)!;
    const b = resumeChase(JSON.parse(JSON.stringify(saved)))!;
    expect(a).not.toBeNull();
    expect(a.innings.inFlight).toBeNull();
    expect(a.state.ballsFaced).toBe(3);
    expect(inningsDeliveries(a.innings)[2].swing).toBeNull();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('resumes a chase that is between balls, and across the over break, unchanged', () => {
    for (const n of [0, 1, 5, 6, 7, 11]) {
      const innings = syntheticInnings(def, Array(n).fill({ runs: 1 }));
      const r = resumeChase({ v: 1, definition: def, innings })!;
      expect(r.innings, `after ${n}`).toEqual(innings);
      expect(r.state, `after ${n}`).toEqual(chaseFromInnings(def, innings));
      expect(verifyChaseInnings(def, innings), `after ${n}`).toBeNull();
    }
  });

  it('resumes a chase that has ended, as the same result', () => {
    const won = syntheticInnings(lowTarget(def0, 4), [{ runs: 6 }]);
    expect(resumeChase({ v: 1, definition: lowTarget(def0, 4), innings: won })!.state.result).toBe('won');
    const out = syntheticInnings(def, [{ runs: 0, dismissal: 'caught' }]);
    expect(resumeChase({ v: 1, definition: def, innings: out })!.state.result).toBe('lost_wicket');
  });

  it('is refused when the save is not this chase', () => {
    const good = {
      v: 1 as const,
      definition: def,
      innings: syntheticInnings(def, [{ runs: 1 }, { runs: 2 }], { inFlight: true }),
    };
    expect(resumeChase(good)).not.toBeNull();
    // Another chase's definition, and a damaged one.
    expect(resumeChase({ ...good, definition: makeChase('c001', 'standard')! })).toBeNull();
    expect(resumeChase({ ...good, definition: { ...def, target: 0 } })).toBeNull();
    // An over that is not the chase's.
    const swapped = JSON.parse(JSON.stringify(good)) as typeof good;
    swapped.innings.current!.plan = chaseOver(makeChase('c002')!, 0, 'right').plan;
    expect(resumeChase(swapped)).toBeNull();
    // A ball that is not the over's next ball.
    const wrongBall = JSON.parse(JSON.stringify(good)) as typeof good;
    wrongBall.innings.current!.deliveries[1] = { ...wrongBall.innings.current!.deliveries[1], ballIndex: 4 };
    expect(resumeChase(wrongBall)).toBeNull();
    // A runs value the physics never gives.
    const badRuns = JSON.parse(JSON.stringify(good)) as typeof good;
    badRuns.innings.current!.deliveries[0] = { ...badRuns.innings.current!.deliveries[0], runs: 5 as never };
    expect(resumeChase(badRuns)).toBeNull();
    // More balls than a chase has.
    const long = syntheticInnings(def, Array(12).fill({ runs: 0 }));
    long.overs.push(long.overs[0]);
    expect(verifyChaseInnings(def, long)).toBe('too_many_balls');
    // A score that does not add up.
    const off = { ...syntheticInnings(def, [{ runs: 1 }]), runs: 9 };
    expect(verifyChaseInnings(def, off)).toBe('score_mismatch');
  });

  it('refuses a save whose innings is damaged beyond reading, without throwing', () => {
    const good = { v: 1 as const, definition: def, innings: syntheticInnings(def, [{ runs: 1 }]) };
    for (const innings of [
      null,
      undefined,
      7,
      'x',
      {},
      { overs: null },
      { ...good.innings, overs: 'no' },
      { ...good.innings, current: { plan: 1 } },
    ])
      expect(resumeChase({ ...good, innings: innings as never })).toBeNull();
    expect(resumeChase(null as never)).toBeNull();
    expect(resumeChase({} as never)).toBeNull();
  });

  it('a deep check plays every record again and refuses one the physics does not give', () => {
    const real = playChase(def, DEFEND_ALL);
    expect(real.records.length).toBeGreaterThanOrEqual(2);
    expect(verifyChaseInnings(def, real.innings, { deep: true })).toBeNull();
    const edited = JSON.parse(JSON.stringify(real.innings)) as PracticeInningsState;
    const list = edited.current ? edited.current.deliveries : edited.overs[0].deliveries;
    // A ball the physics did not score as a six, written down as one: the shallow check cannot know, the deep one does.
    list[0] = { ...list[0], runs: 6 };
    edited.runs = edited.runs - real.records[0].runs + 6;
    expect(verifyChaseInnings(def, edited)).toBeNull();
    expect(verifyChaseInnings(def, edited, { deep: true })).toBe('record_not_reproducible');
    expect(resumeChase({ v: 1, definition: def, innings: edited }, { deep: true })).toBeNull();
  });
});
