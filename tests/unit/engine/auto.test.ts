// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BattingInput, InningsState, OverPlan } from '@/contracts';
import { autoXiBalls, autoXiSeed, engine } from '@/engine';
import { rngFromKey } from '@/engine/prng';
import { clone, CONDITIONS, hexSeed, logFor, randomInput, randomPlan, type PlayedMatch } from './helpers';

/** A duel where player `late` stops answering after `answered` balls and the platform's Auto XI bats the rest. */
function deadlineMatch(key: string, late: 0 | 1, answered: number): PlayedMatch {
  const rng = rngFromKey(`test/auto|${key}`);
  const conditions = CONDITIONS[0];
  const plans: [OverPlan, OverPlan] = [randomPlan(rng), randomPlan(rng)];
  const seed = hexSeed(rng);
  const states: [InningsState, InningsState] = [engine.startInnings(0), engine.startInnings(1)];
  const inputs: [Array<BattingInput | null>, Array<BattingInput | null>] = [[], []];
  for (const seat of [0, 1] as const) {
    const over = plans[seat === 0 ? 1 : 0];
    let state = states[seat];
    while (!state.done) {
      const d = engine.revealDelivery(over, state.nextBall, conditions);
      const auto = seat === late && inputs[seat].length >= answered;
      const raw = auto ? engine.autoBat(autoXiSeed(seed, seat, d.ball), d, over.field) : randomInput(rng, d, 50);
      const checked = engine.validateBattingInput(raw, d);
      const input = checked.ok ? checked.input : null;
      inputs[seat].push(input);
      state = engine.resolveNextBall(state, { seed, conditions, plan: over, input }).state;
    }
    states[seat] = state;
  }
  return { seed, conditions, plans, inputs, states };
}

describe('autoXiBalls', () => {
  it("finds exactly the balls the platform's Auto XI batted, after a JSON round trip", async () => {
    for (const [late, answered] of [[1, 2], [0, 0], [1, 6]] as const) {
      const log = clone(await logFor(deadlineMatch(`${late}-${answered}`, late, answered)));
      expect(await engine.verifyMatchLog(log)).toEqual({ ok: true });
      const expected = log.inputs[late].map((i) => i.ball).filter((b) => b >= answered);
      const found = autoXiBalls(log);
      expect(found[late]).toEqual(expected);
      expect(found[late === 0 ? 1 : 0]).toEqual([]);
    }
  });

  it('never labels a player who batted every ball, nor a Daily Six attempt', async () => {
    const log = await logFor(deadlineMatch('none', 1, 99));
    expect(autoXiBalls(log)).toEqual([[], []]);
    expect(autoXiBalls({ ...log, kind: 'daily' })).toEqual([[], []]);
    expect(autoXiSeed('abc', 1, 4)).toBe('abc:auto-xi:1:4');
  });
});
