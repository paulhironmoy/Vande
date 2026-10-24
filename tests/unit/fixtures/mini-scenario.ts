import type { Scenario } from '../../../src/engine/types';

/** Small scenario exercising every engine mechanic. Duration 60 ticks. */
export const MINI: Scenario = {
  id: 'examination-crisis',
  chapter: 1,
  title: 'Mini Crisis',
  subtitle: 'Fixture',
  duration: 60,
  briefing: {
    grievance: 'Students believe an exam was compromised.',
    knownFacts: ['An answer sheet circulated online.'],
    unverifiedClaims: ['A clerk sold the paper.'],
    responsibility: 'Keep the peace and find out what happened.',
    objective: 'Resolve the grievance without excess.',
    lines: ['Morning.', 'A crowd gathers.'],
  },
  startingScores: { freedom: 60, grievance: 50, safety: 60, evidence: 55, trust: 55, economy: 60 },
  districts: [
    { id: 'campus', name: 'University Quarter', kind: 'campus', x: 0.18, y: 0.3, baseline: { crowd: 0.2, trust: 0.5, services: 0.9 }, institution: 'University Registrar' },
    { id: 'civic', name: 'Civic Square', kind: 'civic', x: 0.5, y: 0.44, baseline: { crowd: 0.1, trust: 0.55, services: 0.95 }, institution: 'District Collectorate' },
    { id: 'market', name: 'Market Street', kind: 'market', x: 0.8, y: 0.34, baseline: { crowd: 0.1, trust: 0.6, services: 1 } },
  ],
  roads: [
    { id: 'r-campus-civic', from: 'campus', to: 'civic' },
    { id: 'r-civic-market', from: 'civic', to: 'market' },
  ],
  evidence: [
    {
      id: 'ev-true', title: 'Hostel CCTV clip', source: 'Hostel warden', sourceType: 'citizen', time: '08:10',
      claim: 'A person entered the exam store at night.', initialState: 'unverified', truth: 'true', resolvedState: 'verified',
      availableAt: 2, metadata: [{ label: 'Camera', value: 'Block C' }], corroboratedBy: ['ev-official'],
      visual: { type: 'video', caption: 'CCTV still' }, district: 'campus', perishable: true, resolutionNote: 'The registrar confirmed the entry log.',
    },
    {
      id: 'ev-official', title: 'Registrar entry log', source: 'University Registrar', sourceType: 'official', time: '08:40',
      claim: 'Store room access log shows one entry at 02:14.', initialState: 'verified', truth: 'true', resolvedState: 'verified',
      availableAt: 4, metadata: [{ label: 'Record', value: 'Access log' }], visual: { type: 'ledger', caption: 'Access log' }, district: 'campus',
      resolutionNote: 'Official log.',
    },
    {
      id: 'ev-fake', title: 'Clerk confession screenshot', source: 'Anonymous forward', sourceType: 'anonymous', time: '08:55',
      claim: 'A clerk admits selling the paper.', initialState: 'unverified', truth: 'false', resolvedState: 'manipulated',
      injectedBy: 'disinfo', metadata: [{ label: 'Font rendering', value: 'Mismatched', anomaly: true }], contradictedBy: ['ev-official'],
      visual: { type: 'message', caption: 'Screenshot' }, district: 'civic', setsFlagsOnResolve: ['fake-exposed'], resolutionNote: 'The screenshot was fabricated.',
    },
    {
      id: 'ev-unknowable', title: 'Rumour of a second leak', source: 'Anonymous post', sourceType: 'anonymous', time: '09:00',
      claim: 'A second paper also leaked.', initialState: 'unverified', truth: 'unknowable', resolvedState: 'unknown',
      availableAt: 3, metadata: [{ label: 'Origin', value: 'Unknown' }], contradictedBy: ['ev-official'],
      visual: { type: 'message', caption: 'Post' }, resolutionNote: 'No source could confirm or deny it.',
    },
    {
      id: 'ev-press', title: 'Local report on queue', source: 'City Desk', sourceType: 'press', time: '09:05',
      claim: 'Students queued peacefully at the registrar.', initialState: 'unverified', truth: 'true', resolvedState: 'corroborated',
      availableAt: 5, metadata: [{ label: 'Reporter', value: 'City Desk' }], corroboratedBy: ['ev-true'],
      visual: { type: 'photo', caption: 'Queue' }, district: 'campus', resolutionNote: 'Consistent with the CCTV clip.',
    },
  ],
  decisions: [
    {
      id: 'd-accuse', title: 'Name the clerk publicly', situation: 'A screenshot names a clerk.', district: 'civic', triggerAt: 6, expiresAfter: 40, urgency: 'high', defaultOption: 'o-wait',
      options: [
        { id: 'o-accuse', title: 'Announce the clerk is responsible', preview: 'Crowds hear a culprit has been found.', authority: 'Duty of candour', tags: ['accusation', 'communication'], requiresEvidence: ['ev-fake'], effects: { safety: 4, grievance: 3 }, falseAccusationEffects: { freedom: -15, trust: -12, evidence: -10 }, consequence: 'The name spreads fast.', setsFlags: ['accused'] },
        { id: 'o-wait', title: 'Wait for verification', preview: 'Nothing changes yet.', authority: 'Presumption of innocence', tags: ['wait'], effects: {}, consequence: 'You hold the name back.' },
      ],
    },
    {
      id: 'd-force', title: 'Crowd at the gate', situation: 'A large crowd blocks the registrar gate.', district: 'campus', triggerAt: 8, expiresAfter: 40, urgency: 'medium', defaultOption: 'o-hold', rightsMomentId: 'rm-1',
      options: [
        { id: 'o-force', title: 'Clear the gate by force', preview: 'Police push the crowd back.', authority: 'Public order powers', tags: ['force'], proportionateIf: { flag: 'violence-active' }, effects: { safety: 6 }, disproportionateEffects: { freedom: -10, trust: -8 }, consequence: 'The gate is cleared.', setsFlags: ['force-used'], mapEffects: [{ kind: 'action', district: 'campus', action: 'deploy' }, { kind: 'crowd', district: 'campus', magnitude: -0.3 }] },
        { id: 'o-dialogue', title: 'Send the registrar to talk', preview: 'Organisers meet the registrar.', authority: 'Article 19(1)(b) — peaceful assembly', tags: ['dialogue', 'protect-assembly'], effects: { trust: 3 }, undoTicks: 5, delayed: [{ afterTicks: 5, effects: { grievance: 4 }, message: 'Talks produce a timetable for the inquiry.' }], consequence: 'The crowd listens.', setsFlags: ['talks-open'], mapEffects: [{ kind: 'action', district: 'campus', action: 'dialogue' }] },
        { id: 'o-hold', title: 'Hold position', preview: 'Nothing changes yet.', authority: 'Discretion', tags: ['wait'], effects: { grievance: -2 }, consequence: 'The crowd waits too.' },
      ],
    },
    {
      id: 'd-expire', title: 'Restore the bus route', situation: 'Buses are diverted.', district: 'market', triggerAt: 10, expiresAfter: 5, urgency: 'low', defaultOption: 'o-idle',
      options: [
        { id: 'o-act', title: 'Reopen the route', preview: 'Buses return.', authority: 'Transit Authority', tags: ['service'], effects: { economy: 3 }, consequence: 'Buses run again.', mapEffects: [{ kind: 'road', road: 'r-civic-market', status: 'open' }] },
        { id: 'o-idle', title: 'Leave the diversion', preview: 'Commuters keep waiting.', authority: 'Discretion', tags: ['wait'], effects: { grievance: -5 }, consequence: 'Commuters grumble.' },
      ],
    },
    {
      id: 'd-bait', title: 'Shut down campus internet', situation: 'An adviser suggests a shutdown.', district: 'campus', expiresAfter: 20, urgency: 'high', defaultOption: 'o-ignore',
      options: [
        { id: 'o-shutdown', title: 'Order a shutdown', preview: 'All campus connectivity stops.', authority: 'Emergency powers', tags: ['suppressive', 'disproportionate', 'censorship'], effects: { safety: 5 }, disproportionateEffects: { freedom: -15, trust: -10 }, consequence: 'Everyone goes dark.', setsFlags: ['shutdown'] },
        { id: 'o-ignore', title: 'Decline the shutdown', preview: 'Connectivity stays on.', authority: 'Proportionality', tags: ['wait', 'proportionate'], effects: {}, consequence: 'Networks stay up.' },
      ],
    },
  ],
  rightsMoments: [
    {
      id: 'rm-1', question: 'A peaceful group did not take part in vandalism. What is needed before restricting its assembly?',
      options: [
        { id: 'r-a', text: 'Specific evidence of a real threat from that group', correct: true, feedback: 'Restrictions must be specific and proportionate.' },
        { id: 'r-b', text: 'Nothing — any crowd can be dispersed', correct: false, feedback: 'Peaceful assembly is protected.' },
        { id: 'r-c', text: 'A complaint from any shopkeeper', correct: false, feedback: 'A complaint alone is not a proven threat.' },
      ],
      principle: 'Restrictions on peaceful assembly must be specific, necessary and proportionate.',
      why: 'Blanket dispersal punishes people for what others did.',
      source: { label: 'Constitution of India', url: 'https://www.indiacode.nic.in/' },
      contentDate: '2026-10-23',
    },
  ],
  events: [
    { id: 'e-crowd', at: 1, kind: 'crowd', message: 'Students gather at the registrar gate.', mapEffects: [{ kind: 'crowd', district: 'campus', magnitude: 0.3 }, { kind: 'mood', district: 'campus', mood: 'tense' }] },
    { id: 'e-violence', at: 30, kind: 'incident', message: 'Stones are thrown near Civic Square.', condition: { notFlag: 'talks-open' }, effects: { safety: -6 }, mapEffects: [{ kind: 'incident', district: 'civic', incident: 'clash' }], setsFlags: ['violence-active'] },
    { id: 'e-play', at: -1, kind: 'incident', message: 'Shutters are smashed on Market Street.', effects: { safety: -5 }, mapEffects: [{ kind: 'incident', district: 'market', incident: 'vandalism' }] },
    { id: 'e-anger', at: -1, kind: 'crowd', message: 'Anger hardens while nothing is answered.', effects: { grievance: -4 }, mapEffects: [{ kind: 'crowd', district: 'campus', magnitude: 0.1 }] },
    { id: 'e-calm', at: 50, kind: 'relief', message: 'The evening settles.', effects: { safety: 2 } },
  ],
  opponentPlays: [
    { id: 'p-disinfo-inject', opponent: 'disinfo', kind: 'inject-evidence', target: 'ev-fake', earliest: 4, latest: 4 },
    { id: 'p-provocateur-event', opponent: 'provocateur', kind: 'event', target: 'e-play', earliest: 8, latest: 30, respondsTo: ['force'] },
    { id: 'p-sabotage-destroy', opponent: 'sabotage', kind: 'destroy-evidence', target: 'ev-true', earliest: 15, latest: 15 },
    { id: 'p-overreaction-bait', opponent: 'overreaction', kind: 'decision', target: 'd-bait', earliest: 20, latest: 20, message: 'An adviser pushes for a shutdown.' },
    { id: 'p-exploiter-event', opponent: 'exploiter', kind: 'event', target: 'e-anger', earliest: 25, latest: 25, respondsTo: ['wait'] },
    { id: 'p-exploiter-late', opponent: 'exploiter', kind: 'event', target: 'e-anger', earliest: 40, latest: 45, minDifficulty: 'severe' },
  ],
  resolution: {
    resolved: [{ condition: { flag: 'talks-open' }, text: 'Talks opened a credible inquiry.' }],
    unresolved: [{ condition: { notFlag: 'talks-open' }, text: 'No inquiry timetable was agreed.' }],
    rightsProtected: [{ condition: { notFlag: 'force-used' }, text: 'Peaceful assembly was not dispersed by force.' }],
    rightsHarmed: [{ condition: { flag: 'force-used' }, text: 'Force was used on a crowd that had not turned violent.' }, { condition: { flag: 'accused' }, text: 'A person was named without proof.' }],
    improvements: [{ condition: { flag: 'accused' }, text: 'Verify before naming anyone.' }, { condition: { notFlag: 'talks-open' }, text: 'Open dialogue earlier.' }],
    closing: { good: 'The city breathes.', mixed: 'The city waits.', poor: 'The city burns slowly.' },
  },
};
