import type { Scenario, ScenarioId } from './types';
import { SCENARIO_IDS } from './types';
import { SCENARIOS } from '../content';

export { validateScenario } from './validate';

export function getScenario(id: ScenarioId): Scenario {
  const s = SCENARIOS[id];
  if (!s) throw new Error(`Unknown scenario '${id}'`);
  return s;
}

/** All scenarios in chapter order. */
export function listScenarios(): Scenario[] {
  return SCENARIO_IDS.map((id) => getScenario(id)).sort((a, b) => a.chapter - b.chapter);
}
