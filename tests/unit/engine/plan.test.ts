// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { DeliveryPlan, OverPlan } from '@/contracts';
import { engine, planEnergy, SUPER_BALL_ALLOWANCE } from '@/engine';
import { rngFromKey } from '@/engine/prng';
import { ALLOWED_LENGTHS, ENERGY_BASE, INTENSITIES, VARIANTS } from '@/engine/v1/tables';
import { synthExecutionTrace } from '@/engine/v1/traces';
import { ALL_VARIANTS, clone, randomPlan } from './helpers';

const rng = rngFromKey('plan-tests');
const g = (release = 800 + rng.normal() * 30) => synthExecutionTrace(rng, release);
const d = (variant: DeliveryPlan['variant'], length: DeliveryPlan['length'], intensity: DeliveryPlan['intensity'] = 2, intent: DeliveryPlan['intent'] = 'contain'): DeliveryPlan => ({
  variant,
  line: 'off',
  length,
  intensity,
  intent,
  gesture: g(),
});
function stockPlan(): OverPlan {
  return {
    v: 1,
    field: 'balanced',
    balls: [d('good_length', 'good'), d('yorker', 'full', 1, 'attack'), d('bouncer', 'short', 1, 'setup'), d('offspin', 'good'), d('good_length', 'full'), d('offspin', 'good', 1)],
    superBall: d('yorker', 'full', 1, 'attack'),
  };
}

describe('energy', () => {
  it('costs base + (intensity − 1), with the express yorker the most expensive ball', () => {
    for (const variant of VARIANTS)
      for (const intensity of INTENSITIES) expect(engine.energyCost({ variant, line: 'off', length: ALLOWED_LENGTHS[variant][0], intensity, intent: 'attack' })).toBe(ENERGY_BASE[variant] + intensity - 1);
    expect(engine.energyCost({ variant: 'yorker', line: 'middle', length: 'full', intensity: 3, intent: 'attack' })).toBe(5);
    expect(engine.energyCost({ variant: 'good_length', line: 'middle', length: 'good', intensity: 1, intent: 'attack' })).toBe(1);
    expect(engine.energyCost({ variant: 'nope' as DeliveryPlan['variant'], line: 'off', length: 'good', intensity: 2, intent: 'attack' })).toBe(Number.POSITIVE_INFINITY);
  });

  it('is budgeted so that the strongest delivery cannot be bowled six times', () => {
    const strongest = Math.max(...VARIANTS.map((v) => engine.energyCost({ variant: v, line: 'off', length: ALLOWED_LENGTHS[v][0], intensity: 3, intent: 'attack' })));
    expect(strongest * 6).toBeGreaterThan(engine.OVER_ENERGY_BUDGET);
    expect(engine.OVER_ENERGY_BUDGET).toBe(15);
    expect(SUPER_BALL_ALLOWANCE).toBe(3);
  });
});

describe('validatePlan', () => {
  it('accepts a sensible starter plan and returns the normalised copy', () => {
    const plan = stockPlan();
    const r = engine.validatePlan({ ...plan, extra: 1 } as OverPlan, []);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan).toEqual(plan);
      expect(planEnergy(r.plan)).toBeLessThanOrEqual(engine.OVER_ENERGY_BUDGET);
    }
  });

  it('accepts 500 random legal plans', () => {
    for (let i = 0; i < 500; i++) expect(engine.validatePlan(randomPlan(rngFromKey(`legal|${i}`)), ALL_VARIANTS).ok).toBe(true);
  });

  const reject = (mutate: (p: OverPlan) => void, code: string, unlocked = ALL_VARIANTS) => {
    const p = clone(stockPlan());
    mutate(p);
    const r = engine.validatePlan(p, unlocked);
    expect(r.ok, code).toBe(false);
    if (!r.ok) expect(r.errors).toContain(code);
  };

  it('rejects malformed plans', () => {
    expect(engine.validatePlan(null as unknown as OverPlan, []).ok).toBe(false);
    reject((p) => ((p as { v: number }).v = 2), 'plan.version');
    reject((p) => ((p as { field: string }).field = 'umbrella'), 'plan.field');
    reject((p) => (p.balls as unknown as DeliveryPlan[]).pop(), 'plan.balls_length');
    reject((p) => ((p.balls[0] as { variant: string }).variant = 'googly'), 'ball0.variant');
    reject((p) => ((p.balls[1] as { line: string }).line = 'wide_leg'), 'ball1.line');
    reject((p) => ((p.balls[1] as { intensity: number }).intensity = 4), 'ball1.intensity');
    reject((p) => ((p.balls[2] as { intent: string }).intent = 'sledge'), 'ball2.intent');
    reject((p) => ((p.superBall as unknown) = undefined), 'super.missing');
  });

  it('enforces length rules: yorkers are full, bouncers short', () => {
    reject((p) => (p.balls[1].length = 'good'), 'ball1.length_not_allowed');
    reject((p) => (p.balls[2].length = 'full'), 'ball2.length_not_allowed');
  });

  it('enforces the energy budget and the Super Ball allowance', () => {
    reject((p) => {
      for (const b of p.balls) {
        b.variant = 'yorker';
        b.length = 'full';
        b.intensity = 2;
      }
    }, 'plan.energy_over_budget');
    reject((p) => (p.superBall.intensity = 2), 'plan.super_ball_over_allowance');
  });

  it('enforces unlocks (starter variants are always available)', () => {
    reject((p) => (p.balls[0].variant = 'legspin'), 'ball0.locked_variant', []);
    const p = clone(stockPlan());
    p.balls[0].variant = 'legspin';
    expect(engine.validatePlan(p, ['legspin']).ok).toBe(true);
    expect(engine.STARTER_VARIANTS).toEqual(['good_length', 'yorker', 'bouncer', 'offspin']);
  });

  it('rejects implausible gestures, superhuman consistency and copy-pasted gestures', () => {
    reject((p) => (p.balls[3].gesture = { pointer: 'touch', samples: [[0, 0.5, 0.5]] }), 'ball3.gesture.too_few_samples');
    reject((p) => (p.balls[4].gesture = { pointer: 'touch', samples: [[0, 0.5, 0.5], [0, 0.5, 0.4], [800, 0.5, 0.3]] }), 'ball4.gesture.duplicate_timestamp');
    reject((p) => {
      const all = [...p.balls, p.superBall];
      all.forEach((b, i) => (b.gesture = synthExecutionTrace(rngFromKey(`bull|${i}`), 800 + (i % 2 ? 1 : -1))));
    }, 'plan.superhuman_consistency');
    reject((p) => (p.balls[5].gesture = clone(p.balls[0].gesture)), 'plan.duplicate_gesture');
  });
});
