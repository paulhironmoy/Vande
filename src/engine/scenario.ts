import type { CampaignScenarioId, Scenario, ScenarioId } from './types';
import { SCENARIO_IDS, isDailyScenarioId } from './types';
import { SCENARIOS } from '../content';
import { getDayScenario } from './daily';

export { validateScenario } from './validate';

/** Campaign scenarios by id; compiled daily crises resolve through the daily compiler (memoised). */
export function getScenario(id: ScenarioId): Scenario {
  if (isDailyScenarioId(id)) return getDayScenario(id.slice('daily:'.length));
  const s = SCENARIOS[id as CampaignScenarioId];
  if (!s) throw new Error(`Unknown scenario '${id}'`);
  return s;
}

/** All campaign scenarios in chapter order. */
export function listScenarios(): Scenario[] {
  return SCENARIO_IDS.map((id) => getScenario(id)).sort((a, b) => a.chapter - b.chapter);
}
