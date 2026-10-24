import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import schema from '../../../src/content/schema/scenario.schema.json';
import { validateScenario } from '../../../src/engine/validate';
import { SCENARIO_IDS, type Scenario, type ScenarioId } from '../../../src/engine/types';
import { MINI } from '../fixtures/mini-scenario';
import { createGame, reduce, tick } from '../../../src/engine/simulation';
import { computeChapterResult } from '../../../src/engine/scoring';

const here = path.dirname(fileURLToPath(import.meta.url));
const scenarioDir = path.resolve(here, '../../../src/content/scenarios');
const allPresent = SCENARIO_IDS.every((id) => existsSync(path.join(scenarioDir, `${id}.json`)));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const schemaValidate = ajv.compile(schema);

describe('fixture scenario', () => {
  it('passes the validator and the JSON schema', () => {
    const result = validateScenario(MINI);
    expect(result.errors).toEqual([]);
    expect(schemaValidate(JSON.parse(JSON.stringify(MINI)))).toBe(true);
  });

  it('the validator reports readable referential errors', () => {
    const broken = JSON.parse(JSON.stringify(MINI)) as Scenario;
    broken.decisions[0].defaultOption = 'missing-option';
    (broken.evidence[0].corroboratedBy as string[]).push('ghost');
    const result = validateScenario(broken);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("decisions[0].defaultOption: 'missing-option' not found");
    expect(result.errors.some((e) => e.includes("evidence[0].corroboratedBy[1]: evidence 'ghost' not found"))).toBe(true);
  });
});

function runSevere(scenario: Scenario, seed: number) {
  let g = reduce(createGame({ scenarioId: scenario.id, seed, difficulty: 'severe', opponents: ['exploiter', 'provocateur', 'disinfo', 'sabotage', 'overreaction'], mode: 'campaign' }, scenario), { type: 'start', tick: 0 }, scenario);
  while (g.status === 'running') {
    g = tick(g, scenario, 1);
    // Always take the first option of the oldest pending decision, verify every visible item once.
    const pending = g.pendingDecisionIds[0];
    if (pending) {
      const dec = scenario.decisions.find((d) => d.id === pending)!;
      g = reduce(g, { type: 'decide', tick: g.tick, decisionId: pending, optionId: dec.options[0].id }, scenario);
    }
    for (const rid of g.pendingRightsIds) {
      const rm = scenario.rightsMoments.find((r) => r.id === rid)!;
      g = reduce(g, { type: 'rights', tick: g.tick, momentId: rid, optionId: rm.options[0].id }, scenario);
    }
    for (const es of Object.values(g.evidence)) {
      if (es.visible && !es.inspected && !es.destroyed) g = reduce(g, { type: 'evidence', tick: g.tick, evidenceId: es.id, verb: 'inspect' }, scenario);
    }
  }
  return g;
}

describe('each shipped scenario file', () => {
  for (const id of SCENARIO_IDS as readonly ScenarioId[]) {
    const file = path.join(scenarioDir, `${id}.json`);
    it.skipIf(!existsSync(file))(`${id} validates, matches the schema and completes deterministically`, () => {
      const scenario = JSON.parse(readFileSync(file, 'utf8')) as Scenario;
      expect(scenario.id).toBe(id);
      const result = validateScenario(scenario);
      expect(result.errors, `${id} validator`).toEqual([]);
      const ok = schemaValidate(scenario);
      expect(ok, `${id} schema: ${ajv.errorsText(schemaValidate.errors)}`).toBe(true);
      expect(scenario.duration).toBeGreaterThanOrEqual(120);
      const a = runSevere(scenario, 77);
      const b = runSevere(scenario, 77);
      expect(a).toEqual(b);
      expect(a.status).toBe('ended');
      expect(a.tick).toBe(scenario.duration);
      const chapter = computeChapterResult(a, scenario, '2026-10-23T00:00:00.000Z');
      expect(chapter.score).toBeGreaterThanOrEqual(0);
      expect(chapter.score).toBeLessThanOrEqual(100);
      expect(Object.values(a.evidence).filter((e) => e.visible).length).toBeGreaterThan(0);
      expect(Object.keys(a.decisions).length).toBeGreaterThan(0);
    });
  }
});

describe.skipIf(!allPresent)('shipped scenarios', () => {
  it('load, validate and pass the JSON schema', async () => {
    const { listScenarios } = await import('../../../src/engine/scenario');
    const scenarios = listScenarios();
    expect(scenarios.map((s) => s.chapter)).toEqual([1, 2, 3]);
    for (const scenario of scenarios) {
      const result = validateScenario(scenario);
      expect(result.errors, `${scenario.id} validator`).toEqual([]);
      const ok = schemaValidate(scenario);
      expect(ok, `${scenario.id} schema: ${ajv.errorsText(schemaValidate.errors)}`).toBe(true);
      expect(scenario.duration).toBeGreaterThanOrEqual(120);
    }
  });
});
