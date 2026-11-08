import { describe, expect, it } from 'vitest';
import { autoField, batTravelMs } from '@/physics';
import { bowlerFor, buildBall, buildOver } from '@/practice/game/overs';
import { inningsReducer, newInnings, nextDelivery } from '@/practice/game/innings';
import { nextFlight, playBall } from '@/practice/game/replay';
import { emptyDraft, type BuildDraft } from '@/practice/store';
import type { BuildKit } from '@/practice/ui/flow/types';
import { planFromDraft } from '@/practice/ui/screens/buildPlan';
import { setup } from './flowSetup';

// The original editor journey's intended seed, not a seed selected for a favorable result.
const SEED = 'e2e-build-0';
const ORDER = ['arm_ball', 'wrong_un', 'stock', 'stock', 'stock', 'quicker'];
const builder = { bowlerFor, buildBall, buildOver } as BuildKit;
const draft: BuildDraft = {
  ...emptyDraft('spin'),
  order: 'shuffle',
  balls: ['stock', 'stock', 'quicker', 'arm_ball', 'wrong_un', 'stock'].map((variation, i) => ({
    variation: variation as 'stock' | 'quicker' | 'arm_ball' | 'wrong_un',
    lineM: 0.45 - i * 0.05,
    lengthM: 3 + i * 0.4,
  })),
};
const makePlan = (seed: string) => planFromDraft(builder, draft, { assist: 'learn', conditions: 'balanced', seed });

describe('custom-over seed contract', () => {
  it('uses the controller test seed when present, with the ordinary seed provider as its production fallback', () => {
    const hooked = setup({ deps: { hooks: { seed: () => SEED }, newSeed: () => 'not-the-test-seed' } });
    const ordinary = setup({ deps: { newSeed: () => 'production-provider' } });
    expect(makePlan(hooked.flow.seed()).seed).toBe(SEED);
    expect(makePlan(ordinary.flow.seed()).seed).toBe('production-provider');
    hooked.flow.dispose();
    ordinary.flow.dispose();
  });

  it('freezes the original edited six and its shuffle, then resolves every block without changing the one-wicket rule', () => {
    const plan = makePlan(SEED);
    expect(makePlan(SEED)).toEqual(plan);
    expect(plan.balls.map((b) => b.variation)).toEqual(ORDER);
    expect(plan.balls.map((b) => b.lengthM)).toEqual([4.2, 4.6, 5, 3, 3.4, 3.8]);
    let innings = inningsReducer(
      newInnings({ id: 'built-fixture', conditions: 'balanced', assist: 'learn', handedness: 'right' }),
      {
        type: 'chooseOver',
        plan,
        field: autoField(plan.bowler, 'balanced', 'right', plan.ball),
      },
    );
    const records = [];
    while (innings.status === 'batting') {
      const flight = nextFlight(nextDelivery(innings)!);
      const played = playBall(
        innings,
        {
          kind: 'defend',
          startT: flight.idealContactT - batTravelMs('defend', 0.2) / 1000,
          directionDeg: 0,
          power: 0.2,
          elevation: 0,
          footwork: 'auto',
        },
        20,
      )!;
      records.push(played.record);
      innings = played.state;
    }
    expect(innings).toMatchObject({ status: 'over_complete', balls: 6, runs: 0 });
    expect(records.map((r) => r.plan.variation)).toEqual(ORDER);
    expect(records.map((r) => r.dismissal)).toEqual([null, null, null, null, null, null]);
    expect(records.map((r) => r.ballIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(records.map((r) => r.seed)).size).toBe(6);
  });
});
