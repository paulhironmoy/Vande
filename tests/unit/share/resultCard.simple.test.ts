import { describe, expect, it } from 'vitest';
import { buildCardModel, shareText } from '@/share/resultCard';
import { SIMPLE_DIMENSIONS, SIMPLE_OUTCOMES } from '@/app/simple';
import { getScenario } from '@/engine';
import { campaignResult } from './fixtures';

const opts = { origin: 'https://vande.example', base: '/Vande/' };

describe('buildCardModel — Simple play style', () => {
  it('uses the plain-language outcome, value and dimension labels', () => {
    const result = campaignResult({ valuesProtected: ['Public trust in institutions', 'Evidence over rumour', 'Peaceful assembly and free expression'] });
    const model = buildCardModel(result, { ...opts, simple: true });
    expect(model.outcomeLabel).toBe(SIMPLE_OUTCOMES.resilient.label);
    expect(model.outcomeLabel).toBe('Strong and Fair City');
    expect(model.values).toEqual(['People trusted their city', 'Facts beat rumours', 'People could speak and gather']);
    expect(model.dims.map((d) => d.label)).toEqual(['freedom', 'grievance', 'safety', 'evidence', 'trust', 'economy'].map((d) => SIMPLE_DIMENSIONS[d as keyof typeof SIMPLE_DIMENSIONS].short));
    expect(model.tagline).toBe('I held the Republic together. Can you?');
    expect(model.wordmark).toBe('VANDE//REPUBLIC');
    expect(shareText(model)).toContain('Strong and Fair City');
  });

  it('writes the hardest decision in simple words when the scenario ids are known', () => {
    const scenario = getScenario('examination-crisis');
    const decision = scenario.decisions.find((d) => d.simple)!;
    const option = decision.options[0];
    const result = campaignResult({
      mostConsequential: { scenarioId: 'examination-crisis', decisionId: decision.id, optionId: option.id, title: decision.title, optionTitle: option.title, impact: 30, tick: 20, flags: [] },
      hardestDecision: `${decision.title} — ${option.title}`,
    });
    const simpleModel = buildCardModel(result, { ...opts, simple: true });
    expect(simpleModel.hardestDecision).toBe(`${decision.simple!.title} — ${decision.simple!.options[option.id].title}`);
    const fullModel = buildCardModel(result, { ...opts, simple: false });
    expect(fullModel.hardestDecision).toBe(`${decision.title} — ${option.title}`);
  });

  it('falls back to the full line when the decision ids are unknown, and never changes Full style output', () => {
    const result = campaignResult(); // fixture ids do not exist in the real scenario
    const simpleModel = buildCardModel(result, { ...opts, simple: true });
    expect(simpleModel.hardestDecision).toBe(result.hardestDecision);
    const fullModel = buildCardModel(result, opts);
    expect(fullModel.outcomeLabel).toBe('Resilient Republic');
    expect(fullModel.dims.map((d) => d.label)).toEqual(['Freedom', 'Grievance', 'Safety', 'Evidence', 'Trust', 'Economy']);
    expect(fullModel.values).toEqual(['Peaceful assembly', 'Evidence before accusation', 'Proportionate policing', 'Independent press']);
  });
});
