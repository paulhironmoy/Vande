import { describe, expect, it } from 'vitest';
import { DEFAULT_OPPONENTS, createGame, evidenceActions, getScenario, reduce, tick } from '@/engine';
import { DIMENSIONS, type DecisionOption, type GameState, type Scenario, type ScenarioDecision } from '@/engine/types';
import {
  FRIEND_POINTS,
  INSIGHT,
  LITE_POINTS,
  bestOf,
  evaluateAll,
  evaluateMove,
  insightFor,
  movePoints,
  pointsRules,
  rankOf,
  streakMultiplier,
} from '@/lite/points';

/** Frozen copy of the scoring that lived inline in LitePlayScreen before the extraction (the parity reference). */
function referenceEvaluate(state: GameState, scenario: Scenario, d: ScenarioDecision, o: DecisionOption) {
  let after = state;
  try {
    after = reduce(state, { type: 'decide', tick: state.tick, decisionId: d.id, optionId: o.id }, scenario);
  } catch {
    /* no change */
  }
  let pos = 0;
  let neg = 0;
  for (const k of DIMENSIONS) {
    const dv = Math.round(after.scores[k] - state.scores[k]);
    if (dv > 0) pos += dv;
    else neg -= dv;
  }
  let pts = Math.max(10, 100 + pos * 8 - neg * 8);
  const checked = (id: string) => {
    const es = state.evidence[id];
    return Boolean(es && (es.state === 'verified' || es.state === 'corroborated' || es.state === 'manipulated'));
  };
  const relied = (o.requiresEvidence ?? []).filter((id) => state.evidence[id]?.visible);
  if (relied.length && relied.every(checked)) pts *= 2;
  const fb = after.lastFeedback;
  const harsh = o.tags.some((t) => ['disproportionate', 'suppressive', 'censorship'].includes(t)) || fb?.warning === 'disproportionate' || fb?.warning === 'false-accusation';
  return { pts, harsh };
}

function start(seed: number): { state: GameState; scenario: Scenario } {
  const scenario = getScenario('examination-crisis');
  const made = createGame({ scenarioId: scenario.id, seed, difficulty: 'standard', opponents: [...DEFAULT_OPPONENTS], mode: 'campaign' }, scenario);
  return { state: reduce(made, { type: 'start', tick: made.tick }, scenario), scenario };
}

function advance(state: GameState, scenario: Scenario): GameState {
  let g = state;
  for (let i = 0; i < 400; i++) {
    if (g.status === 'ended' || g.pendingDecisionIds.length || g.pendingRightsIds.length) break;
    if (g.status === 'paused') g = reduce(g, { type: 'resume', tick: g.tick }, scenario);
    const before = g.tick;
    g = tick(g, scenario, 1);
    if (g.tick === before) break;
  }
  return g;
}

function scanAll(state: GameState, scenario: Scenario, d: ScenarioDecision): GameState {
  let g = state;
  for (const o of d.options)
    for (const evId of o.requiresEvidence ?? []) {
      if (!g.evidence[evId]?.visible) continue;
      for (const verb of ['inspect', 'compare', 'preserve'] as const)
        for (const a of evidenceActions(g, scenario, evId).filter((x) => x.enabled && x.verb === verb))
          g = reduce(g, { type: 'evidence', tick: g.tick, evidenceId: evId, verb, compareWith: a.compareWith }, scenario);
    }
  return g;
}

describe('Lite points module', () => {
  it('scores every Chapter 1 option exactly like the old inline code, with and without scanned clues', () => {
    let compared = 0;
    for (const seed of [1, 7, 42, 2026]) {
      for (const scan of [false, true]) {
        let { state, scenario } = start(seed);
        for (let guard = 0; guard < 40; guard++) {
          state = advance(state, scenario);
          if (state.status === 'ended') break;
          const rid = state.pendingRightsIds[0];
          if (rid) {
            const rm = scenario.rightsMoments.find((r) => r.id === rid)!;
            const ok = rm.options.find((o) => o.correct) ?? rm.options[0];
            state = reduce(state, { type: 'rights', tick: state.tick, momentId: rid, optionId: ok.id }, scenario);
            continue;
          }
          const d = scenario.decisions.find((x) => x.id === state.pendingDecisionIds[0])!;
          if (scan) state = scanAll(state, scenario, d);
          const evals = evaluateAll(state, scenario, d);
          d.options.forEach((o, i) => {
            const ref = referenceEvaluate(state, scenario, d, o);
            expect(evals[i].pts).toBe(ref.pts);
            expect(evals[i].harsh).toBe(ref.harsh);
            expect(evaluateMove(state, scenario, d, o, i).pts).toBe(ref.pts);
            compared++;
          });
          const pick = bestOf(evals).option;
          state = reduce(state, { type: 'decide', tick: state.tick, decisionId: d.id, optionId: pick.id }, scenario);
        }
      }
    }
    expect(compared).toBeGreaterThan(100);
  });

  it('keeps the move formula, the streak ladder and the constants the players see', () => {
    expect(movePoints(0, 0)).toBe(100);
    expect(movePoints(12, 0)).toBe(196);
    expect(movePoints(0, 30)).toBe(10);
    expect([0, 1, 2, 3, 4, 5, 9].map(streakMultiplier)).toEqual([1, 1, 1.25, 1.5, 1.75, 2, 2]);
    expect(LITE_POINTS).toMatchObject({ clueVerified: 50, clueFakeCaught: 200, fairPlayCorrect: 100, missionBonus: 50, starBonus: 100, clueMultiplier: 2 });
    expect(FRIEND_POINTS).toMatchObject({ answer: 40, understood: 100, perDareCap: 3, perDayCap: 10 });
  });

  it('ranks ties as best and pays Insight only for the best move or a close second, never negative', () => {
    const { state, scenario } = advanceToFirst();
    const d = scenario.decisions.find((x) => x.id === state.pendingDecisionIds[0])!;
    const evals = evaluateAll(state, scenario, d);
    const best = bestOf(evals);
    expect(rankOf(evals, best.option.id).rank).toBe(1);
    const tied = evals.map((e) => ({ ...e, pts: 100 }));
    for (const e of tied) expect(rankOf(tied, e.option.id).rank).toBe(1);

    expect(insightFor('tricky', 1, 0, 12)).toBe(50);
    expect(insightFor('tough', 1, 0, 12)).toBe(100);
    expect(insightFor('boss', 1, 0, 12)).toBe(150);
    expect(insightFor('boss', 2, 12, 12)).toBe(75);
    expect(insightFor('boss', 2, 13, 12)).toBe(0);
    expect(insightFor('tough', 3, 0, 12)).toBe(0);
    expect(insightFor('tricky', 4, 999, 12)).toBe(0);
  });

  it('generates the How points work card from the same numbers', () => {
    const text = pointsRules()
      .map((r) => `${r.title}: ${r.text}`)
      .join('\n');
    for (const n of [LITE_POINTS.moveBase, LITE_POINTS.movePerBarPoint, LITE_POINTS.moveMin, LITE_POINTS.clueVerified, LITE_POINTS.clueFakeCaught, LITE_POINTS.fairPlayCorrect, LITE_POINTS.missionBonus, LITE_POINTS.starBonus, FRIEND_POINTS.answer, FRIEND_POINTS.understood, FRIEND_POINTS.perDareCap, FRIEND_POINTS.perDayCap])
      expect(text).toContain(String(n));
    for (const k of ['tricky', 'tough', 'boss'] as const) expect(text).toContain(String(INSIGHT.base * INSIGHT.tiers[k].multiplier));
    expect(text).toContain('×2');
    expect(text).toMatch(/never taken away/i);
    expect(text).toMatch(/never changes your score, stars or medals/i);
    expect(text).toContain(INSIGHT.name);
  });
});

function advanceToFirst() {
  const { state, scenario } = start(42);
  return { state: advance(state, scenario), scenario };
}
