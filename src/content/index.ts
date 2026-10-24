import type { CampaignScenarioId, Scenario } from '../engine/types';
import { validateScenario } from '../engine/validate';
import examinationCrisis from './scenarios/examination-crisis.json';
import electoralDispute from './scenarios/electoral-dispute.json';
import informationStorm from './scenarios/information-storm.json';

export const SCENARIOS: Record<CampaignScenarioId, Scenario> = {
  'examination-crisis': examinationCrisis as unknown as Scenario,
  'electoral-dispute': electoralDispute as unknown as Scenario,
  'information-storm': informationStorm as unknown as Scenario,
};

if (import.meta.env.DEV) {
  for (const [id, scenario] of Object.entries(SCENARIOS)) {
    const result = validateScenario(scenario);
    if (!result.ok) console.warn(`[vande] scenario '${id}' has ${result.errors.length} validation error(s):\n${result.errors.join('\n')}`);
  }
}
