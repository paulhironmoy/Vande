import type { PassportAccomplishment, PassportState } from '@/engine/types';
import { ACCOMPLISHMENTS, type AccomplishmentContext } from './accomplishments';

/**
 * Evaluates every accomplishment against a completed run and returns the newly earned ones
 * (ids already in `already` are skipped). The store persists the result via `awardAccomplishments`.
 */
export function evaluateAccomplishments(ctx: AccomplishmentContext, already: PassportState | undefined, now: string = new Date().toISOString()): PassportAccomplishment[] {
  const known = new Set((already?.earned ?? []).map((e) => e.id));
  const out: PassportAccomplishment[] = [];
  for (const def of ACCOMPLISHMENTS) {
    if (known.has(def.id)) continue;
    let reason: string | null = null;
    try {
      reason = def.evaluate(ctx);
    } catch {
      reason = null;
    }
    if (reason) out.push({ id: def.id, earnedAt: now, reason, dailyId: ctx.dailyId, scenarioId: ctx.scenarioId });
  }
  return out;
}

export { ACCOMPLISHMENTS } from './accomplishments';
export type { AccomplishmentContext, AccomplishmentDefinition } from './accomplishments';
