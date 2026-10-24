/**
 * Simple play style: plain-language vocabulary shared by every screen.
 * Target reading level: a confident eight-year-old. Short words, concrete nouns, no jargon.
 * Scenario-specific simple copy lives in the scenario JSON (`simple` fields); this file holds the UI vocabulary.
 */
import { useApp } from '@/app/store';
import type { ConfidenceState, Dimension, EvidenceVerb, OpponentId, RepublicOutcome, Scores } from '@/engine/types';

/** React hook: true when the Simple play style is active. */
export function useSimple(): boolean {
  return useApp((s) => s.settings.playStyle === 'simple');
}

/** Non-hook check (event handlers, helpers). */
export function isSimple(): boolean {
  return useApp.getState().settings.playStyle === 'simple';
}

/** Picks the simple variant when the style is simple and a variant exists. */
export function pick<T>(simple: boolean, full: T, simpleValue: T | undefined | null): T {
  return simple && simpleValue !== undefined && simpleValue !== null ? simpleValue : full;
}

export const SIMPLE_DIMENSIONS: Record<Dimension, { label: string; short: string; help: string }> = {
  freedom: { label: 'Freedom', short: 'Free', help: 'Can people speak, gather and be heard?' },
  grievance: { label: 'Problems solved', short: 'Solved', help: 'Are the real problems being fixed?' },
  safety: { label: 'Safety', short: 'Safe', help: 'Is everyone safe from harm?' },
  evidence: { label: 'Facts checked', short: 'Facts', help: 'Do we act on true facts, not rumours?' },
  trust: { label: 'Trust', short: 'Trust', help: 'Do people believe their leaders?' },
  economy: { label: 'Shops and jobs', short: 'Shops', help: 'Are shops open and buses running?' },
};

export const SIMPLE_STATES: Record<ConfidenceState, { label: string; help: string }> = {
  verified: { label: 'True', help: 'Checked and confirmed.' },
  corroborated: { label: 'Backed up', help: 'Other sources say the same.' },
  unverified: { label: 'Not checked yet', help: 'Nobody has checked this yet.' },
  manipulated: { label: 'Fake', help: 'Someone made this up or changed it.' },
  unknown: { label: "Can't tell", help: 'We may never know for sure.' },
};

export const SIMPLE_VERBS: Record<EvidenceVerb, string> = {
  inspect: 'Look closer',
  compare: 'Compare with others',
  preserve: 'Keep it safe',
  unresolved: 'Come back later',
  'clear-unresolved': 'Done with this',
};

export const SIMPLE_OPPONENTS: Record<OpponentId, { nickname: string; behavior: string; pressure: string }> = {
  exploiter: { nickname: 'The Anger Stirrer', behavior: 'Makes people angrier when problems wait too long.', pressure: 'Fix real problems quickly and keep listening.' },
  provocateur: { nickname: 'The Trouble Starter', behavior: 'Tries to start fights between crowds and police.', pressure: 'Stay calm. Deal only with the people causing trouble.' },
  disinfo: { nickname: 'The Rumour Bug', behavior: 'Spreads made-up stories and fake pictures.', pressure: 'Check clues before you believe them.' },
  sabotage: { nickname: 'The Wrecker', behavior: 'Breaks things and hides proof while everyone is distracted.', pressure: 'Keep important clues safe and services running.' },
  overreaction: { nickname: 'The Big Hammer', behavior: 'Tempts you to punish everyone instead of fixing the problem.', pressure: 'Choose fair answers, not harsh ones.' },
};

export const SIMPLE_OUTCOMES: Record<RepublicOutcome, { label: string; summary: string; stars: 1 | 2 | 3 }> = {
  resilient: { label: 'Strong and Fair City', summary: 'People were heard, facts won, and everyone stayed safe and free. Brilliant work.', stars: 3 },
  'free-fragile': { label: 'Free but Shaky', summary: 'People stayed free, but some were not safe and some shops closed. Keep people safer next time.', stars: 2 },
  'order-without-trust': { label: 'Quiet but Unhappy', summary: 'The streets were calm, but people lost their freedom and stopped trusting you.', stars: 1 },
  manipulated: { label: 'Tricked by Rumours', summary: 'Fake stories won. Next time, check clues before you act.', stars: 1 },
  'institutionally-weakened': { label: 'Trust Ran Out', summary: 'People stopped believing the city could solve problems. Listen and act sooner.', stars: 1 },
  'economically-disrupted': { label: 'Shops Shut Down', summary: 'Shops and buses stopped for too long. Keep the city moving next time.', stars: 1 },
};

/** A friendly reading of the mean score for the Simple pulse. */
export function cityMood(scores: Scores): { label: string; tone: 'great' | 'good' | 'shaky' | 'trouble'; help: string } {
  const mean = (scores.freedom + scores.grievance + scores.safety + scores.evidence + scores.trust + scores.economy) / 6;
  const min = Math.min(scores.freedom, scores.grievance, scores.safety, scores.evidence, scores.trust, scores.economy);
  if (mean >= 70 && min >= 50) return { label: 'Doing great', tone: 'great', help: 'Everything is balanced. Keep it up.' };
  if (mean >= 55 && min >= 35) return { label: 'Doing okay', tone: 'good', help: 'Things are steady. Watch the weakest spot.' };
  if (mean >= 40) return { label: 'Getting shaky', tone: 'shaky', help: 'Something needs attention soon.' };
  return { label: 'In trouble', tone: 'trouble', help: 'The city needs help right now.' };
}

export function weakestDimension(scores: Scores): Dimension {
  return (Object.keys(scores) as Dimension[]).reduce((w, d) => (scores[d] < scores[w] ? d : w), 'freedom');
}

/** Stars for a 0..100 score (used on results in the Simple style). */
export function starsFor(score: number): 0 | 1 | 2 | 3 {
  if (score >= 75) return 3;
  if (score >= 55) return 2;
  if (score >= 35) return 1;
  return 0;
}

export const SIMPLE_UI = {
  play: 'Play',
  continue: 'Keep playing',
  startCampaign: 'Start the story (10 minutes)',
  daily: "Today's challenge",
  decisionsHeading: 'What will you do?',
  evidenceHeading: 'Clues',
  pulseHeading: 'How is the city doing?',
  timeLeft: 'Time left',
  clockWaiting: 'The clock is waiting for you. Take your time.',
  pause: 'Pause',
  resume: 'Keep going',
  skipBriefing: 'Skip',
  takeCommand: "Let's go",
  chapterDone: 'Chapter done!',
  notLegalAdvice: 'Educational content—not legal advice',
  fairPlay: 'Fair play moment',
  checkedWarning: "You haven't checked this clue yet.",
  fakeWarning: 'This clue looks fake. Careful!',
  happeningNow: "What's happening",
  undo: 'Undo',
  newClue: 'New clue',
} as const;
