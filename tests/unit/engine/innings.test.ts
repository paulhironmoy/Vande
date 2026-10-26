// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BattingInput, InningsState, OverPlan } from '@/contracts';
import { SUPER_BALL_INDEX } from '@/contracts/cricket';
import { engine } from '@/engine';
import { rngFromKey } from '@/engine/prng';
import { battingInputFor } from '@/engine/v1/policies';
import { hexSeed, randomInput, randomPlan } from './helpers';

const conditions = { pitch: 'green', weather: 'humid' } as const;

/** Plays one innings with `answer`, checking the per-call contract on every ball. */
function play(plan: OverPlan, seed: string, answer: (ball: number) => BattingInput | null) {
  let state = engine.startInnings(0);
  const outcomes = [];
  while (!state.done) {
    const before = state;
    const delivery = engine.revealDelivery(plan, state.mainDone ? SUPER_BALL_INDEX : state.nextBall, conditions);
    const input = answer(delivery.ball);
    const r = engine.resolveNextBall(state, { seed, conditions, plan, input });
    expect(r.outcome.ball).toBe(before.nextBall);
    expect(r.feedback).toEqual({ ball: r.outcome.ball, timing: r.outcome.timing, contact: r.outcome.contact });
    expect(before.outcomes.length).toBeLessThanOrEqual(r.state.outcomes.length);
    outcomes.push(r.outcome);
    state = r.state;
  }
  return { state, outcomes };
}

describe('innings flow', () => {
  it('always bowls six main balls and then the Super Ball', () => {
    for (let k = 0; k < 200; k++) {
      const rng = rngFromKey(`flow|${k}`);
      const plan = randomPlan(rng);
      const { state, outcomes } = play(plan, hexSeed(rng), (ball) => randomInput(rng, engine.revealDelivery(plan, ball, conditions), 120));
      expect(outcomes.map((o) => o.ball)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(state.outcomes).toHaveLength(6);
      expect(state.superBall?.ball).toBe(SUPER_BALL_INDEX);
      expect(state.done && state.mainDone).toBe(true);
      expect(state.nextBall).toBe(7);
      expect(state.wickets).toBeLessThanOrEqual(2);
      const live = state.outcomes.filter((o) => !o.dead);
      expect(state.runs).toBe(live.reduce((s, o) => s + o.runs, 0));
      expect(state.wickets).toBe(live.filter((o) => o.wicket).length);
    }
  });

  it('turns the balls after a second wicket into dead balls that score nothing but give normal feedback', () => {
    let found = 0;
    for (let k = 0; k < 400 && found < 20; k++) {
      const rng = rngFromKey(`dead|${k}`);
      const plan = randomPlan(rng, 15);
      // Wild, mistimed slogs: plenty of early wickets.
      const { state } = play(plan, hexSeed(rng), (ball) => {
        const d = engine.revealDelivery(plan, ball, conditions);
        return battingInputFor(rng, d, 'loft', 'mid_on', d.timing.releaseToContactMs + 160 + rng.float() * 60);
      });
      const second = state.outcomes.findIndex((o, i) => o.wicket && state.outcomes.slice(0, i).some((p) => p.wicket));
      if (second < 0 || second === 5) continue;
      found++;
      const after = state.outcomes.slice(second + 1);
      expect(after.every((o) => o.dead === true && o.runs === 0 && o.wicket === null && o.fielder === null)).toBe(true);
      expect(state.outcomes.slice(0, second + 1).every((o) => o.dead === undefined)).toBe(true);
      expect(after.every((o) => o.factors.explainKey === 'explain.dead_ball' && !o.cues.key && o.cues.celebration === 'none')).toBe(true);
      const summary = engine.summarise(state, 0);
      expect(summary.balls).toHaveLength(second + 1);
      expect(summary.ballsFaced).toBe(second + 1);
      expect(summary.wickets).toBe(2);
      expect(summary.batter).toBe(0);
      expect(summary.bowler).toBe(1);
      // The Super Ball is a fresh contest even after an all-out innings.
      expect(state.superBall?.dead).toBeUndefined();
    }
    expect(found).toBeGreaterThan(5);
  });

  it('treats a missing answer as a leave that can never take a wicket', () => {
    const rng = rngFromKey('unanswered');
    const plan = randomPlan(rng);
    const { state } = play(plan, hexSeed(rng), () => null);
    expect(state.runs).toBe(0);
    expect(state.wickets).toBe(0);
    expect([...state.outcomes, state.superBall].every((o) => o?.timing === 'interrupted' && o.shot === 'leave' && o.factors.explainKey === 'explain.unanswered')).toBe(true);
  });

  it('never throws: finished innings are idempotent and inputs for other balls are ignored', () => {
    const rng = rngFromKey('robust');
    const plan = randomPlan(rng);
    const seed = hexSeed(rng);
    const { state } = play(plan, seed, (ball) => randomInput(rng, engine.revealDelivery(plan, ball, conditions)));
    const again = engine.resolveNextBall(state, { seed, conditions, plan, input: null });
    expect(again.state).toBe(state);
    expect(again.outcome).toBe(state.superBall);
    const fresh: InningsState = engine.startInnings(1);
    const otherBall = randomInput(rng, engine.revealDelivery(plan, 4, conditions));
    const r = engine.resolveNextBall(fresh, { seed, conditions, plan, input: otherBall });
    expect(r.outcome.ball).toBe(0);
    expect(r.outcome.timing).toBe('interrupted');
  });

  it('never throws even on inputs that could not pass validation (they resolve as unanswered)', () => {
    const shots = ['defend', 'rotate', 'drive', 'cut_pull', 'sweep', 'loft', 'leave', 'hook'];
    for (let k = 0; k < 300; k++) {
      const rng = rngFromKey(`garbage|${k}`);
      const plan = randomPlan(rng);
      let state = engine.startInnings(0);
      while (!state.done) {
        const ball = state.mainDone ? SUPER_BALL_INDEX : state.nextBall;
        const junk =
          rng.float() < 0.5
            ? ({ v: 1, ball, shot: rng.pick(shots), zone: rng.pick([null, 'cover', 'nowhere']), tapMs: rng.pick([null, -50, 1e9, Number.NaN, 400]), trace: { pointer: 'touch', samples: [] }, clientElapsedMs: 0 } as unknown as BattingInput)
            : null;
        const r = engine.resolveNextBall(state, { seed: `g${k}`, conditions, plan, input: junk });
        expect(r.outcome.ball).toBe(ball);
        state = r.state;
      }
      expect(state.outcomes).toHaveLength(6);
    }
  });

  it('is a pure function of its arguments', () => {
    const rng = rngFromKey('pure');
    const plan = randomPlan(rng);
    const seed = hexSeed(rng);
    const input = randomInput(rng, engine.revealDelivery(plan, 0, conditions));
    const a = engine.resolveNextBall(engine.startInnings(0), { seed, conditions, plan, input });
    const b = engine.resolveNextBall(engine.startInnings(0), { seed, conditions, plan, input: JSON.parse(JSON.stringify(input)) });
    expect(b).toEqual(a);
    const otherSeed = engine.resolveNextBall(engine.startInnings(0), { seed: `${seed.slice(0, -1)}${seed.endsWith('0') ? '1' : '0'}`, conditions, plan, input });
    // Same input, different seed: the timing grade is identical (it is the batter's), the draw may differ.
    expect(otherSeed.outcome.timing).toBe(a.outcome.timing);
  });
});
