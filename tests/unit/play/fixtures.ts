import type { DecisionState, EvidenceState, Pulse, RightsMoment, ScenarioDecision, ScenarioEvidence, Scores } from '@/engine/types';

export const scores: Scores = { freedom: 72, grievance: 48, safety: 61, evidence: 55, trust: 58, economy: 66 };

export const pulse: Pulse = {
  balance: 0.72,
  momentum: { freedom: 2.5, grievance: -3, safety: 0.2, evidence: 1.2, trust: -0.4, economy: 0 },
  instability: 0.3,
  direction: 'steady',
  mean: 60,
  weakest: 'grievance',
  strongest: 'freedom',
};

export const decision: ScenarioDecision = {
  id: 'd-leak',
  title: 'Respond to the alleged question-paper leak',
  situation: 'A screenshot of what looks like tomorrow’s paper is spreading. Students are gathering at the University Quarter.',
  district: 'campus',
  triggerAt: 12,
  expiresAfter: 25,
  defaultOption: 'wait',
  urgency: 'high',
  options: [
    {
      id: 'opt-investigate',
      title: 'Open an independent review of the paper',
      preview: 'A review panel starts work; students hear it within the hour.',
      authority: 'Duty to investigate fairly — Article 14 equality before law',
      tags: ['investigative', 'transparent'],
      effects: { grievance: 6, trust: 3 },
      consequence: 'The review panel is announced.',
      undoTicks: 5,
    },
    {
      id: 'opt-arrest',
      title: 'Detain the student who posted the screenshot',
      preview: 'Police pick up the poster tonight; the crowd will hear of it fast.',
      authority: 'Article 21 — liberty and due process',
      tags: ['detention', 'accusation'],
      requiresEvidence: ['ev-screenshot'],
      effects: { safety: 2 },
      falseAccusationEffects: { freedom: -14, trust: -12, evidence: -8 },
      consequence: 'The student is detained.',
    },
    {
      id: 'wait',
      title: 'Wait for more information',
      preview: 'Nothing changes yet; the rumour keeps moving.',
      authority: 'Discretion — no action taken',
      tags: ['wait'],
      effects: { grievance: -2 },
      consequence: 'No action was taken.',
    },
  ],
};

export const decisionState: DecisionState = { id: 'd-leak', status: 'pending', appearedAt: 12, expiresAt: 37 };

export const evidenceItem: ScenarioEvidence = {
  id: 'ev-screenshot',
  title: 'Screenshot of “tomorrow’s paper”',
  source: 'Anonymous forward',
  sourceType: 'anonymous',
  time: '09:14',
  claim: 'A photo of a printed question paper, said to be tomorrow’s exam, circulating on messaging groups.',
  initialState: 'unverified',
  truth: 'false',
  resolvedState: 'manipulated',
  availableAt: 6,
  metadata: [
    { label: 'Created', value: '09:11 today' },
    { label: 'Device', value: 'Photo editing app export', anomaly: true },
    { label: 'Paper code', value: 'Series B — not in use this year', anomaly: true },
  ],
  contradictedBy: ['ev-registrar'],
  visual: { type: 'photo', caption: 'Blurred photo of a printed page with a series code in the corner.' },
  district: 'campus',
  perishable: false,
  resolutionNote: 'The image was exported from an editing app and carries a series code that is not in use. It was fabricated.',
};

export const evidenceState: EvidenceState = {
  id: 'ev-screenshot',
  visible: true,
  arrivedAt: 6,
  state: 'unverified',
  inspected: false,
  compared: false,
  preserved: false,
  markedUnresolved: false,
  destroyed: false,
  updatedAt: 6,
};

export const rightsMoment: RightsMoment = {
  id: 'rm-assembly',
  question: 'A peaceful group has not taken part in the vandalism. What is required before restricting its assembly?',
  options: [
    { id: 'rm-a', text: 'Nothing — the whole area can be cleared as a precaution.', correct: false, feedback: 'Blanket restrictions on peaceful people are not proportionate.' },
    { id: 'rm-b', text: 'Specific evidence of an imminent threat from that group, and the least restrictive response.', correct: true, feedback: 'Restrictions must be specific, evidence-based and proportionate.' },
    { id: 'rm-c', text: 'A complaint from any nearby business.', correct: false, feedback: 'Inconvenience alone does not justify restricting peaceful assembly.' },
  ],
  principle: 'Peaceful assembly is protected; restrictions must be reasonable, specific and the least restrictive option available.',
  why: 'Clearing everyone would have punished people who did nothing wrong and deepened distrust.',
  source: { label: 'Constitution of India, Article 19', url: 'https://www.indiacode.nic.in/' },
  contentDate: '2026-10-23',
};
