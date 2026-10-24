import { describe, expect, it } from 'vitest';
import {
  DIMENSIONS,
  chapterScore,
  classifyOutcome,
  computeChapterResult,
  createGame,
  evidenceActions,
  listScenarios,
  reduce,
  tick,
  type ActionTag,
  type GameConfig,
  type GameState,
  type Scenario,
} from '@/engine';

type Strategy = 'principled' | 'suppressive' | 'idle' | 'reckless';

const GOOD: ActionTag[] = ['dialogue', 'transparent', 'investigative', 'protect-assembly', 'protect-press', 'proportionate', 'service', 'relief', 'legal-process', 'communication'];
const BAD: ActionTag[] = ['disproportionate', 'suppressive', 'censorship', 'detention', 'force'];

function score(tags: ActionTag[], good: ActionTag[], bad: ActionTag[]): number {
  let s = 0;
  for (const t of tags) {
    if (good.includes(t)) s += 2;
    if (bad.includes(t)) s -= 3;
    if (t === 'wait') s -= 1;
  }
  return s;
}

function play(scenario: Scenario, strategy: Strategy, opponents: GameConfig['opponents'] = ['exploiter', 'disinfo'], difficulty: GameConfig['difficulty'] = 'standard') {
  const config: GameConfig = { scenarioId: scenario.id, seed: 20261023, difficulty, opponents, mode: 'campaign' };
  let s: GameState = createGame(config, scenario);
  s = reduce(s, { type: 'start', tick: 0 }, scenario);
  const verified = new Set<string>();
  while (s.status === 'running') {
    if (strategy !== 'idle') {
      // Evidence handling: principled verifies everything available; reckless never does.
      if (strategy === 'principled' || strategy === 'suppressive') {
        for (const es of Object.values(s.evidence)) {
          if (!es.visible || es.destroyed) continue;
          const acts = evidenceActions(s, scenario, es.id).filter((a) => a.enabled);
          for (const a of acts) {
            if (a.verb === 'preserve' && !es.preserved) s = reduce(s, { type: 'evidence', tick: s.tick, evidenceId: es.id, verb: 'preserve' }, scenario);
            if (strategy === 'principled' && a.verb === 'inspect' && !es.inspected) s = reduce(s, { type: 'evidence', tick: s.tick, evidenceId: es.id, verb: 'inspect' }, scenario);
            if (strategy === 'principled' && a.verb === 'compare' && !s.evidence[es.id].compared)
              s = reduce(s, { type: 'evidence', tick: s.tick, evidenceId: es.id, verb: 'compare', compareWith: a.compareWith }, scenario);
          }
          if (['verified', 'corroborated', 'manipulated'].includes(s.evidence[es.id].state)) verified.add(es.id);
        }
      }
      for (const id of [...s.pendingDecisionIds]) {
        const d = scenario.decisions.find((x) => x.id === id)!;
        let best = d.options[0];
        let bestScore = -Infinity;
        for (const o of d.options) {
          let sc: number;
          if (strategy === 'principled') {
            sc = score(o.tags, GOOD, BAD);
            // Avoid accusations unless the basis is verified.
            if (o.tags.includes('accusation') && !(o.requiresEvidence ?? []).every((e) => ['verified', 'corroborated'].includes(s.evidence[e]?.state ?? '')))
              sc -= 10;
            if (o.tags.includes('accusation') && (o.requiresEvidence ?? []).some((e) => s.evidence[e]?.state === 'manipulated')) sc -= 20;
          } else if (strategy === 'suppressive') {
            sc = score(o.tags, BAD, GOOD);
          } else {
            // reckless: accuse/force immediately whenever offered, otherwise first option
            sc = o.tags.includes('accusation') || o.tags.includes('force') || o.tags.includes('detention') ? 5 : 0;
          }
          if (sc > bestScore) {
            bestScore = sc;
            best = o;
          }
        }
        s = reduce(s, { type: 'decide', tick: s.tick, decisionId: id, optionId: best.id }, scenario);
      }
      for (const rid of [...s.pendingRightsIds]) {
        const m = scenario.rightsMoments.find((x) => x.id === rid)!;
        const opt = strategy === 'principled' ? m.options.find((o) => o.correct)! : m.options.find((o) => !o.correct)!;
        s = reduce(s, { type: 'rights', tick: s.tick, momentId: rid, optionId: opt.id }, scenario);
      }
    }
    s = tick(s, scenario, 1);
  }
  const result = computeChapterResult(s, scenario, '2026-10-23T00:00:00.000Z');
  return { state: s, result };
}

describe('game balance across strategies', () => {
  const scenarios = listScenarios();
  const table: string[] = [];
  const results: Record<string, Record<Strategy, number>> = {};

  for (const scenario of scenarios) {
    results[scenario.id] = { principled: 0, suppressive: 0, idle: 0, reckless: 0 };
    for (const strategy of ['principled', 'suppressive', 'idle', 'reckless'] as Strategy[]) {
      const { state, result } = play(scenario, strategy);
      results[scenario.id][strategy] = result.score;
      const dims = DIMENSIONS.map((d) => `${d.slice(0, 4)}=${Math.round(state.scores[d])}`).join(' ');
      table.push(
        `${scenario.id.padEnd(20)} ${strategy.padEnd(11)} score=${String(result.score).padStart(3)} ${classifyOutcome(state.scores).padEnd(24)} ${dims} | decisions=${state.stats.decisionsMade} expired=${state.stats.decisionsExpired} falseAcc=${state.stats.falseAccusations} dispro=${state.stats.disproportionateActions} manipDet=${state.stats.manipulationsDetected} manipOk=${state.stats.manipulationsSucceeded} resolvedEv=${state.stats.evidenceResolved} destroyed=${state.stats.evidenceDestroyed}`,
      );
    }
  }
  // eslint-disable-next-line no-console
  console.log('\n' + table.join('\n') + '\n');

  for (const scenario of scenarios) {
    const r = results[scenario.id];
    it(`${scenario.id}: a principled, evidence-led player clearly beats suppression, recklessness and inaction`, () => {
      expect(r.principled).toBeGreaterThanOrEqual(62);
      expect(r.principled - r.suppressive).toBeGreaterThanOrEqual(12);
      expect(r.principled - r.idle).toBeGreaterThanOrEqual(12);
      expect(r.principled - r.reckless).toBeGreaterThanOrEqual(8);
    });
    it(`${scenario.id}: suppression damages freedom and trust`, () => {
      const { state } = play(scenario, 'suppressive');
      expect(state.scores.freedom).toBeLessThan(50);
      expect(state.stats.disproportionateActions).toBeGreaterThan(0);
    });
    it(`${scenario.id}: inaction damages safety, grievance or economy`, () => {
      const { state } = play(scenario, 'idle');
      const worst = Math.min(state.scores.safety, state.scores.grievance, state.scores.economy);
      expect(worst).toBeLessThan(45);
    });
  }

  it('all opponents at severe difficulty still leave a principled player a winnable game', () => {
    for (const scenario of scenarios) {
      const { result } = play(scenario, 'principled', ['exploiter', 'provocateur', 'disinfo', 'sabotage', 'overreaction'], 'severe');
      expect(result.score).toBeGreaterThanOrEqual(50);
      expect(chapterScore(result.scores)).toBe(result.score);
    }
  });
});
