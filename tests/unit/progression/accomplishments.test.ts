import { describe, expect, it } from 'vitest';
import type { ChapterResult, Scores } from '@/engine/types';
import { ACCOMPLISHMENTS } from '@/progression/accomplishments';
import { evaluateAccomplishments } from '@/progression/passport';
import { republicChangeLine, strategicFeedback } from '@/progression/feedback';

const scores = (v: Partial<Scores> = {}): Scores => ({ freedom: 60, grievance: 60, safety: 60, evidence: 60, trust: 60, economy: 60, ...v });

function result(over: Partial<ChapterResult> = {}, stats: Partial<ChapterResult['stats']> = {}): ChapterResult {
  return {
    scenarioId: 'daily:d001',
    chapter: 1,
    config: { scenarioId: 'daily:d001', seed: 1, difficulty: 'standard', opponents: ['disinfo'], mode: 'daily' },
    scores: scores(),
    startScores: scores({ trust: 50 }),
    score: 70,
    fingerprint: 'DES',
    resolved: [],
    unresolved: [],
    manipulations: [],
    rightsProtected: [],
    rightsHarmed: [],
    improvement: '',
    closing: '',
    missedEvidence: [],
    stats: {
      decisionsMade: 5,
      decisionsExpired: 0,
      falseAccusations: 0,
      disproportionateActions: 0,
      unverifiedActions: 0,
      manipulationsDetected: 1,
      manipulationsSucceeded: 0,
      evidenceResolved: 3,
      evidencePreserved: 1,
      evidenceDestroyed: 0,
      rightsCorrect: 1,
      rightsTotal: 1,
      ...stats,
    },
    durationTicks: 110,
    completedAt: '2026-10-24T10:00:00.000Z',
    ...over,
  };
}

describe('civic passport', () => {
  it('defines seven behaviour-based accomplishments with short how-to lines', () => {
    expect(ACCOMPLISHMENTS.map((a) => a.id)).toEqual(['evidence-first', 'rights-guardian', 'coalition-builder', 'institutional-reformer', 'calm-under-pressure', 'transparent-leader', 'restorative-strategist']);
    for (const a of ACCOMPLISHMENTS) {
      expect(a.howTo.split(' ').length).toBeLessThanOrEqual(8);
      expect(a.simpleHowTo.split(' ').length).toBeLessThanOrEqual(8);
      expect(a.howTo.toLowerCase()).not.toMatch(/streak|every day|daily/);
    }
  });

  it('awards for how you played, explains why, and never twice', () => {
    const r = result({ scores: scores({ freedom: 78, trust: 70, grievance: 70, safety: 70, economy: 70 }) });
    const earned = evaluateAccomplishments({ result: r, fingerprint: 'DDEES', official: true, dailyId: '2026-10-24' }, { v: 1, earned: [] }, '2026-10-24T10:00:00.000Z');
    const ids = earned.map((e) => e.id);
    expect(ids).toContain('evidence-first');
    expect(ids).toContain('rights-guardian');
    expect(ids).toContain('coalition-builder');
    expect(ids).toContain('institutional-reformer');
    expect(ids).toContain('calm-under-pressure');
    expect(ids).toContain('transparent-leader');
    expect(ids).toContain('restorative-strategist');
    for (const e of earned) {
      expect(e.reason.length).toBeGreaterThan(10);
      expect(e.dailyId).toBe('2026-10-24');
    }
    const again = evaluateAccomplishments({ result: r, fingerprint: 'DDEES', official: false }, { v: 1, earned }, '2026-10-25T10:00:00.000Z');
    expect(again).toEqual([]);
  });

  it('withholds accomplishments after harsh, unchecked or late play', () => {
    const harsh = result({ scores: scores({ freedom: 40 }) }, { disproportionateActions: 1, decisionsExpired: 1, unverifiedActions: 1 });
    const earned = evaluateAccomplishments({ result: harsh, fingerprint: 'XWDE', official: true }, undefined);
    expect(earned.map((e) => e.id)).not.toContain('rights-guardian');
    expect(earned.map((e) => e.id)).not.toContain('calm-under-pressure');
    expect(earned.map((e) => e.id)).not.toContain('evidence-first');
  });
});

describe('result feedback lines', () => {
  it('reads the strategy from the fingerprint, in one sentence without numbers', () => {
    expect(strategicFeedback('XDE', undefined, true)).toBe('A harsh choice cost freedom and trust.');
    expect(strategicFeedback('WWD', undefined, false)).toMatch(/Waiting/);
    expect(strategicFeedback('EED', undefined, true)).toMatch(/checked clues/);
    expect(strategicFeedback('DDS', undefined, false)).toMatch(/Dialogue/);
    expect(strategicFeedback('S', undefined, true)).toMatch(/services/i);
    expect(strategicFeedback('DES', result(undefined, { falseAccusations: 1 }), false)).toMatch(/unchecked evidence/);
    for (const fp of ['XDE', 'WWD', 'EED', 'DDS', 'S', 'P']) expect(strategicFeedback(fp, undefined, true)).not.toMatch(/\d/);
  });

  it('names the biggest Republic change plainly', () => {
    expect(republicChangeLine({ trust: 2.4, safety: -1 }, false)).toBe('Trust +2 in your Republic');
    expect(republicChangeLine({ economy: -3 }, true)).toBe('Shops and jobs −3 in your city');
    expect(republicChangeLine({ trust: 0.2 }, true)).toBe('Your city stayed about the same.');
    expect(republicChangeLine(undefined, false)).toBeNull();
  });
});
