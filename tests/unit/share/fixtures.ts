import type { CampaignResult, ChapterResult, Scores } from '@/engine/types';

export const SCORES: Scores = { freedom: 72, grievance: 61, safety: 68, evidence: 80, trust: 66, economy: 59 };

export function chapterResult(overrides: Partial<ChapterResult> = {}): ChapterResult {
  return {
    scenarioId: 'examination-crisis',
    chapter: 1,
    config: { scenarioId: 'examination-crisis', seed: 123456, difficulty: 'standard', opponents: ['exploiter', 'disinfo'], mode: 'campaign' },
    scores: SCORES,
    startScores: { freedom: 60, grievance: 40, safety: 62, evidence: 58, trust: 55, economy: 64 },
    score: 66,
    fingerprint: 'DESDE',
    resolved: ['An independent review of the examination was announced.'],
    unresolved: ['Students still do not know when results will be re-issued.'],
    manipulations: [{ evidenceId: 'ev-fake-leak', title: 'Leaked answer key', opponent: 'disinfo', succeeded: false, note: 'Exposed by metadata inspection.' }],
    rightsProtected: ['Peaceful assembly at Civic Square continued.'],
    rightsHarmed: [],
    improvement: 'Open the review before the first crowd forms.',
    closing: 'The square emptied slowly, but on its own terms.',
    keyDecision: { decisionId: 'd-review', optionId: 'o-independent', title: 'Respond to the irregularity', optionTitle: 'Order an independent review', impact: 22, tick: 14, flags: [] },
    missedEvidence: [],
    stats: {
      decisionsMade: 8,
      decisionsExpired: 1,
      falseAccusations: 0,
      disproportionateActions: 0,
      unverifiedActions: 1,
      manipulationsDetected: 1,
      manipulationsSucceeded: 0,
      evidenceResolved: 6,
      evidencePreserved: 2,
      evidenceDestroyed: 0,
      rightsCorrect: 2,
      rightsTotal: 3,
    },
    durationTicks: 180,
    completedAt: '2026-10-23T10:15:00.000Z',
    ...overrides,
  };
}

export function campaignResult(overrides: Partial<CampaignResult> = {}): CampaignResult {
  return {
    id: 'run-1',
    mode: 'campaign',
    seed: 123456,
    difficulty: 'standard',
    opponents: ['exploiter', 'disinfo'],
    chapters: [chapterResult()],
    finalScores: SCORES,
    score: 67.6,
    outcome: 'resilient',
    mostConsequential: {
      scenarioId: 'examination-crisis',
      decisionId: 'd-review',
      optionId: 'o-independent',
      title: 'Respond to the irregularity',
      optionTitle: 'Order an independent review',
      impact: 22,
      tick: 14,
      flags: [],
    },
    missedEvidence: [{ scenarioId: 'examination-crisis', id: 'ev-cctv', title: 'Exam hall CCTV', note: 'Overwritten before it was preserved.' }],
    valuesProtected: ['Peaceful assembly', 'Evidence before accusation', 'Proportionate policing', 'Independent press', 'Extra value that should be dropped'],
    hardestDecision: 'Keep the square open while the fabricated leak spread',
    completedAt: '2026-10-23T10:15:00.000Z',
    challengeCode: 'VND1-EX-abc123-S-11-68',
    ...overrides,
  };
}
