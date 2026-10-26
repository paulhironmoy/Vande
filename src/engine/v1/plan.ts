/** Bowling plans: energy, shape and legality checks, unlocks and gesture plausibility (engine v1). */
import type { DeliveryPlan, DeliveryVariant, OverPlan } from '@/contracts';
import { normalizePlan } from '../canonical';
import {
  ALLOWED_LENGTHS,
  DUPLICATE_MIN_SAMPLES,
  ENERGY_BASE,
  FIELD_SETTINGS,
  INTENSITIES,
  INTENTS,
  LINES,
  LENGTHS,
  METER,
  OVER_ENERGY_BUDGET,
  STARTER_VARIANTS,
  SUPER_BALL_ALLOWANCE,
  SUPERHUMAN_COUNT,
  SUPERHUMAN_MS,
  VARIANTS,
} from './tables';
import { checkTrace, releaseMs } from './traces';

type Core = Omit<DeliveryPlan, 'gesture'>;

/** Energy of one delivery: base by variant + (intensity − 1). Invalid deliveries cost Infinity. */
export function energyCost(d: Core): number {
  const base = ENERGY_BASE[d.variant];
  if (base === undefined || !(INTENSITIES as readonly number[]).includes(d.intensity)) return Number.POSITIVE_INFINITY;
  return base + (d.intensity - 1);
}

/** Energy of the six main deliveries. */
export function planEnergy(plan: OverPlan): number {
  let sum = 0;
  for (const b of plan.balls) sum += energyCost(b);
  return sum;
}

function checkDelivery(d: DeliveryPlan, label: string, unlocked: ReadonlySet<string>): string[] {
  if (!d || typeof d !== 'object') return [`${label}.missing`];
  const errors: string[] = [];
  if (!(VARIANTS as readonly string[]).includes(d.variant)) errors.push(`${label}.variant`);
  else {
    if (!unlocked.has(d.variant)) errors.push(`${label}.locked_variant`);
    if ((LENGTHS as readonly string[]).includes(d.length) && !ALLOWED_LENGTHS[d.variant].includes(d.length)) errors.push(`${label}.length_not_allowed`);
  }
  if (!(LINES as readonly string[]).includes(d.line)) errors.push(`${label}.line`);
  if (!(LENGTHS as readonly string[]).includes(d.length)) errors.push(`${label}.length`);
  if (!(INTENSITIES as readonly number[]).includes(d.intensity)) errors.push(`${label}.intensity`);
  if (!(INTENTS as readonly string[]).includes(d.intent)) errors.push(`${label}.intent`);
  for (const e of checkTrace(d.gesture, 'execution')) errors.push(`${label}.gesture.${e.slice('trace.'.length)}`);
  return errors;
}

function sameTrace(a: DeliveryPlan['gesture'], b: DeliveryPlan['gesture']): boolean {
  if (a.samples.length !== b.samples.length || a.samples.length < DUPLICATE_MIN_SAMPLES) return false;
  for (let i = 0; i < a.samples.length; i++) {
    const p = a.samples[i];
    const q = b.samples[i];
    if (p[0] !== q[0] || p[1] !== q[1] || p[2] !== q[2]) return false;
  }
  return true;
}

export function validatePlan(plan: OverPlan, unlocked: readonly DeliveryVariant[]): { ok: true; plan: OverPlan } | { ok: false; errors: string[] } {
  if (!plan || typeof plan !== 'object') return { ok: false, errors: ['plan.missing'] };
  const errors: string[] = [];
  if (plan.v !== 1) errors.push('plan.version');
  if (!(FIELD_SETTINGS as readonly string[]).includes(plan.field)) errors.push('plan.field');
  const allowed = new Set<string>([...STARTER_VARIANTS, ...(Array.isArray(unlocked) ? unlocked : [])]);
  if (!Array.isArray(plan.balls) || plan.balls.length !== 6) {
    errors.push('plan.balls_length');
    return { ok: false, errors };
  }
  plan.balls.forEach((b, i) => errors.push(...checkDelivery(b, `ball${i}`, allowed)));
  errors.push(...checkDelivery(plan.superBall, 'super', allowed));
  if (errors.length) return { ok: false, errors };

  if (planEnergy(plan) > OVER_ENERGY_BUDGET) errors.push('plan.energy_over_budget');
  if (energyCost(plan.superBall) > SUPER_BALL_ALLOWANCE) errors.push('plan.super_ball_over_allowance');

  const all = [...plan.balls, plan.superBall];
  let bullseyes = 0;
  for (const d of all) if (Math.abs(releaseMs(d.gesture) - METER.sweetMs) <= SUPERHUMAN_MS) bullseyes++;
  if (bullseyes >= SUPERHUMAN_COUNT) errors.push('plan.superhuman_consistency');
  outer: for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++)
      if (sameTrace(all[i].gesture, all[j].gesture)) {
        errors.push('plan.duplicate_gesture');
        break outer;
      }
  if (errors.length) return { ok: false, errors };
  return { ok: true, plan: normalizePlan(plan) };
}
