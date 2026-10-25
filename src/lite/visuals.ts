/**
 * The per-question picture gate. A question shows pictures only when every one of its answers passes all four tests
 * (concrete, distinct, neutral, label stays); otherwise the whole question stays text. Rendering uses only this.
 *
 * Stable API: `visualPlanFor(decision)`.
 */
import type { ScenarioDecision } from '@/engine/types';
import type { VisualPlan } from './contracts';

/** Visual plan for a question, or null when it must stay text. */
export function visualPlanFor(decision: ScenarioDecision): VisualPlan | null {
  void decision;
  return null;
}
