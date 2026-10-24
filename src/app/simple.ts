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

// ---------------------------------------------------------------------------
// Additional vocabulary used by the setup, result and progress screens
// ---------------------------------------------------------------------------
import type { Difficulty, HistoryEntry, KeyDecision, ResolutionRule, Scenario, TimerPace } from '@/engine/types';

/** Plain-words version of describeCondition() labels (keyed by the full label). */
export const SIMPLE_CONDITIONS: Record<string, { label: string; summary: string }> = {
  Untested: { label: 'New city', summary: 'Your city has not faced a problem yet.' },
  Resilient: { label: 'Strong and fair', summary: 'People trust you and the streets are calm.' },
  Steady: { label: 'Doing well', summary: 'Your city is holding together.' },
  Strained: { label: 'A bit wobbly', summary: 'Things work, but some cracks are showing.' },
  Fragile: { label: 'Needs help', summary: 'One more problem could tip it over.' },
  'In crisis': { label: 'In trouble', summary: 'Your city is struggling. It needs you.' },
};

export function simpleCondition(full: { label: string; summary: string }, simple: boolean): { label: string; summary: string } {
  if (!simple) return full;
  return SIMPLE_CONDITIONS[full.label] ?? full;
}

export const SIMPLE_DIFFICULTY: Record<Difficulty, { label: string; description: string }> = {
  measured: { label: 'Gentle', description: 'Trouble makers go easy on you.' },
  standard: { label: 'Normal', description: 'A fair fight.' },
  severe: { label: 'Tough', description: 'They try their hardest.' },
};

export const SIMPLE_PACE: Record<TimerPace, { label: string; description: string }> = {
  standard: { label: 'Normal', description: '3 minutes a chapter' },
  relaxed: { label: 'Slow', description: '4½ minutes a chapter' },
  extended: { label: 'Slowest', description: '6 minutes a chapter' },
};

export const SIMPLE_FLAGS: Record<KeyDecision['flags'][number], string> = {
  'false-accusation': 'Blamed someone without proof',
  disproportionate: 'Too harsh',
  'unverified-basis': 'Acted before checking',
  auto: 'The clock decided',
};

export const SIMPLE_HISTORY_KIND: Record<HistoryEntry['kind'], string> = {
  campaign: 'Story',
  daily: 'Daily',
  challenge: 'Friend game',
  chapter: 'Chapter',
};

/** The five long-term city measures. */
export const SIMPLE_MEASURES: Record<'freedom' | 'safety' | 'trust' | 'economy' | 'legitimacy', string> = {
  freedom: 'Freedom',
  safety: 'Safety',
  trust: 'Trust',
  economy: 'Shops and jobs',
  legitimacy: 'Fairness',
};

/** Plain-words versions of the "values protected" strings produced by the engine. */
export const SIMPLE_VALUES: Record<string, string> = {
  'Peaceful assembly and free expression': 'People could speak and gather',
  'Evidence over rumour': 'Facts beat rumours',
  'Public trust in institutions': 'People trusted their city',
};

export function simpleValue(full: string, simple: boolean): string {
  return simple ? (SIMPLE_VALUES[full] ?? full) : full;
}

/** Scenario title/subtitle with the simple layer applied. */
export function scenarioTitle(scenario: Pick<Scenario, 'title' | 'simple'> | undefined, simple: boolean): string {
  if (!scenario) return '';
  return pick(simple, scenario.title, scenario.simple?.title);
}

export function scenarioSubtitle(scenario: Pick<Scenario, 'subtitle' | 'simple'> | undefined, simple: boolean): string {
  if (!scenario) return '';
  return pick(simple, scenario.subtitle, scenario.simple?.subtitle);
}

/** Looks up the simple version of a resolution text produced by the engine (matched by its full text). */
export function simpleRuleText(rules: ResolutionRule[] | undefined, text: string, simple: boolean): string {
  if (!simple || !rules) return text;
  const rule = rules.find((r) => r.text === text);
  return rule?.simple ?? text;
}

/** Simple closing line: finds which band the engine used and returns the simple version. */
export function simpleClosing(scenario: Scenario | undefined, closing: string, simple: boolean): string {
  if (!simple || !scenario?.simple?.closing) return closing;
  const bands = ['good', 'mixed', 'poor'] as const;
  for (const b of bands) if (scenario.resolution.closing[b] === closing) return scenario.simple.closing[b] || closing;
  return closing;
}

/** Simple mode label for a run ("The whole story", "Today's challenge", "Friend game", "Replay"). */
export function simpleModeLabel(mode: 'campaign' | 'daily' | 'challenge' | 'replay', chapters: number): string {
  switch (mode) {
    case 'daily':
      return "Today's challenge";
    case 'challenge':
      return 'Friend game';
    case 'replay':
      return 'Played again';
    default:
      return chapters > 1 ? `The whole story · ${chapters} chapters` : 'Story';
  }
}
