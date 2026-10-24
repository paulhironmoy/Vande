import { describe, expect, it } from 'vitest';
import { MINI } from '../fixtures/mini-scenario';
import { createGame, reduce, tick } from '../../../src/engine/simulation';
import {
  carryScores,
  chapterScore,
  classifyOutcome,
  computeCampaignResult,
  computeChapterResult,
  describeCondition,
  updateRepublic,
} from '../../../src/engine/scoring';
import { decodeChallenge } from '../../../src/engine/challenge';
import type { GameConfig, RepublicCondition, Scores } from '../../../src/engine/types';

const s = (freedom: number, grievance: number, safety: number, evidence: number, trust: number, economy: number): Scores => ({ freedom, grievance, safety, evidence, trust, economy });

describe('chapterScore', () => {
  it('applies the balance-weighted formula', () => {
    expect(chapterScore(s(60, 60, 60, 60, 60, 60))).toBe(60);
    // mean 60, min 30 → 60 - 0.35 * 30 = 49.5 → 50
    expect(chapterScore(s(66, 66, 66, 66, 66, 30))).toBe(Math.round(60 - 0.35 * 30));
    expect(chapterScore(s(100, 100, 100, 100, 100, 100))).toBe(100);
    expect(chapterScore(s(0, 0, 0, 0, 0, 0))).toBe(0);
  });
});

describe('classifyOutcome', () => {
  it('produces each of the six outcomes', () => {
    expect(classifyOutcome(s(72, 70, 68, 75, 70, 66))).toBe('resilient');
    expect(classifyOutcome(s(70, 60, 40, 62, 58, 55))).toBe('free-fragile');
    expect(classifyOutcome(s(45, 55, 70, 60, 40, 60))).toBe('order-without-trust');
    expect(classifyOutcome(s(60, 58, 62, 35, 55, 60))).toBe('manipulated');
    expect(classifyOutcome(s(60, 58, 62, 58, 55, 30))).toBe('economically-disrupted');
    expect(classifyOutcome(s(58, 35, 55, 58, 40, 56))).toBe('institutionally-weakened');
  });

  it('falls back by weakest dimension', () => {
    expect(classifyOutcome(s(50, 56, 55, 58, 56, 57))).toBe('order-without-trust');
    expect(classifyOutcome(s(58, 56, 50, 58, 56, 57))).toBe('free-fragile');
    expect(classifyOutcome(s(58, 56, 56, 50, 56, 57))).toBe('manipulated');
  });
});

describe('carryScores', () => {
  it('regresses toward 50', () => {
    expect(carryScores(s(100, 0, 50, 80, 20, 60))).toEqual(s(80, 20, 50, 68, 32, 56));
  });
});

const config: GameConfig = { scenarioId: 'examination-crisis', seed: 5, difficulty: 'standard', opponents: ['disinfo', 'exploiter'], mode: 'campaign' };

function finished(choices: { tick: number; decisionId: string; optionId: string }[] = []) {
  let g = reduce(createGame(config, MINI), { type: 'start', tick: 0 }, MINI);
  for (const c of choices.sort((a, b) => a.tick - b.tick)) {
    g = tick(g, MINI, c.tick - g.tick);
    g = reduce(g, { type: 'decide', ...c }, MINI);
  }
  return tick(g, MINI, 60 - g.tick);
}

describe('computeChapterResult', () => {
  it('summarises a chapter where the player did nothing', () => {
    const g = finished();
    const r = computeChapterResult(g, MINI, '2026-10-23T10:00:00.000Z');
    expect(r.scenarioId).toBe('examination-crisis');
    expect(r.chapter).toBe(1);
    expect(r.score).toBe(chapterScore(r.scores));
    expect(r.startScores).toEqual(MINI.startingScores);
    expect(r.unresolved).toContain('No inquiry timetable was agreed.');
    expect(r.resolved).toHaveLength(0);
    expect(r.rightsProtected).toContain('Peaceful assembly was not dispersed by force.');
    expect(r.improvement).toBe('Open dialogue earlier.');
    expect(r.manipulations).toHaveLength(1);
    expect(r.manipulations[0]).toMatchObject({ evidenceId: 'ev-fake', opponent: 'disinfo', succeeded: true });
    expect(r.stats.manipulationsSucceeded).toBe(1);
    expect(r.missedEvidence.map((m) => m.id)).toEqual(['ev-fake']);
    expect(r.keyDecision).toBeDefined();
    expect(r.keyDecision?.flags).toContain('auto');
    expect(r.durationTicks).toBe(60);
    expect(r.completedAt).toBe('2026-10-23T10:00:00.000Z');
    expect(typeof r.closing).toBe('string');
  });

  it('credits exposure and dialogue', () => {
    let g = reduce(createGame(config, MINI), { type: 'start', tick: 0 }, MINI);
    g = tick(g, MINI, 9);
    g = reduce(g, { type: 'evidence', tick: 9, evidenceId: 'ev-fake', verb: 'inspect' }, MINI);
    g = reduce(g, { type: 'decide', tick: 9, decisionId: 'd-force', optionId: 'o-dialogue' }, MINI);
    g = tick(g, MINI, 60 - g.tick);
    const r = computeChapterResult(g, MINI, '2026-10-23T10:00:00.000Z');
    expect(r.resolved).toContain('Talks opened a credible inquiry.');
    expect(r.manipulations[0].succeeded).toBe(false);
    expect(r.missedEvidence).toHaveLength(0);
    expect(r.keyDecision?.decisionId).toBe('d-force');
    expect(r.keyDecision?.optionId).toBe('o-dialogue');
  });

  it('marks a false accusation as the key decision', () => {
    const r = computeChapterResult(finished([{ tick: 6, decisionId: 'd-accuse', optionId: 'o-accuse' }]), MINI, '2026-10-23T10:00:00.000Z');
    expect(r.keyDecision?.decisionId).toBe('d-accuse');
    expect(r.keyDecision?.flags).toContain('false-accusation');
    expect(r.rightsHarmed).toContain('A person was named without proof.');
    expect(r.improvement).toBe('Verify before naming anyone.');
  });
});

describe('computeCampaignResult', () => {
  it('aggregates chapters into a campaign with a challenge code', () => {
    const c1 = computeChapterResult(finished(), MINI, '2026-10-23T10:00:00.000Z');
    const c2 = { ...c1, scenarioId: 'electoral-dispute' as const, chapter: 2 as const };
    const c3 = { ...c1, scenarioId: 'information-storm' as const, chapter: 3 as const };
    const r = computeCampaignResult([c1, c2, c3], { mode: 'campaign', seed: 5, difficulty: 'standard', opponents: ['exploiter', 'disinfo'], id: 'run-1', completedAt: '2026-10-23T10:30:00.000Z' });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.finalScores).toEqual(c3.scores);
    expect(r.outcome).toBe(classifyOutcome(c3.scores));
    expect(r.chapters).toHaveLength(3);
    expect(r.mostConsequential?.scenarioId).toBeDefined();
    expect(r.hardestDecision).toContain(r.mostConsequential!.title);
    expect(r.valuesProtected.length).toBeLessThanOrEqual(3);
    const decoded = decodeChallenge(r.challengeCode);
    expect(decoded).toMatchObject({ scenario: 'campaign', seed: 5, difficulty: 'standard', opponents: ['exploiter', 'disinfo'], score: r.score });
    const single = computeCampaignResult([c1], { mode: 'daily', seed: 5, difficulty: 'standard', opponents: ['exploiter', 'disinfo'], id: 'run-2', completedAt: '2026-10-23T10:30:00.000Z' });
    expect(decodeChallenge(single.challengeCode)?.scenario).toBe('examination-crisis');
  });
});

describe('republic condition', () => {
  const fresh: RepublicCondition = { freedom: 50, safety: 50, trust: 50, economy: 50, legitimacy: 50, campaigns: 0, crises: 0, updatedAt: '' };

  it('takes the first result directly, then blends with EMA 0.3', () => {
    const c1 = computeChapterResult(finished(), MINI, '2026-10-23T10:00:00.000Z');
    const first = updateRepublic(fresh, c1);
    expect(first.freedom).toBe(c1.scores.freedom);
    expect(first.legitimacy).toBe(Math.round(((c1.scores.grievance + c1.scores.evidence) / 2) * 10) / 10);
    expect(first.crises).toBe(1);
    expect(first.campaigns).toBe(0);
    const second = updateRepublic({ ...first, freedom: 80 }, { ...c1, scores: { ...c1.scores, freedom: 40 } });
    expect(second.freedom).toBe(68);
    const campaign = computeCampaignResult([c1, c1, c1], { mode: 'campaign', seed: 1, difficulty: 'standard', opponents: ['exploiter'], id: 'x', completedAt: '2026-10-23T11:00:00.000Z' });
    const third = updateRepublic(second, campaign);
    expect(third.campaigns).toBe(1);
    expect(third.crises).toBe(5);
    expect(third.updatedAt).toBe('2026-10-23T11:00:00.000Z');
  });

  it('describes the condition in plain language', () => {
    expect(describeCondition(fresh).label).toBe('Untested');
    expect(describeCondition({ ...fresh, crises: 1, freedom: 80, safety: 80, trust: 80, economy: 80, legitimacy: 80 }).label).toBe('Resilient');
    expect(describeCondition({ ...fresh, crises: 1, freedom: 65, safety: 65, trust: 65, economy: 65, legitimacy: 60 }).label).toBe('Steady');
    expect(describeCondition({ ...fresh, crises: 1, freedom: 55, safety: 50, trust: 52, economy: 50, legitimacy: 50 }).summary).toMatch(/Weakest: safety|Weakest: the economy|Weakest: institutional legitimacy/);
    expect(describeCondition({ ...fresh, crises: 1, freedom: 40, safety: 40, trust: 40, economy: 40, legitimacy: 40 }).label).toBe('Fragile');
    expect(describeCondition({ ...fresh, crises: 1, freedom: 20, safety: 20, trust: 20, economy: 20, legitimacy: 20 }).label).toBe('In crisis');
  });
});
