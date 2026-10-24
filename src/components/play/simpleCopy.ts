/**
 * Gameplay-only vocabulary for the Simple play style (see src/app/simple.ts for the shared UI words).
 * Every string here is written for a confident eight-year-old: short, concrete, kind.
 */
import type { ActionFeedback, Dimension, DistrictMood, IncidentKind, Scenario, TimerPace, Urgency } from '@/engine/types';
import { SIMPLE_DIMENSIONS, SIMPLE_UI } from '@/app/simple';

export const SIMPLE_URGENCY: Record<Urgency, string> = { high: 'Now', medium: 'Soon', low: 'Take your time' };

export function simplePhase(tick: number, duration: number): string {
  const f = duration > 0 ? tick / duration : 0;
  if (f < 0.34) return 'Start';
  if (f < 0.75) return 'Middle';
  return 'Finish';
}

/** One plain rule line for options whose authority is about speech, assembly or equal treatment. */
const RULES: { test: RegExp; text: string }[] = [
  { test: /19\s*\(\s*1\s*\)\s*\(\s*a\s*\)|free speech|speech|expression|press|journalis|report/i, text: 'Rule: everyone may speak and share news.' },
  { test: /19\s*\(\s*1\s*\)\s*\(\s*b\s*\)|assembl|gather|protest|sit-in|march/i, text: 'Rule: people may gather peacefully.' },
  { test: /article\s*14|equal|same rules|even-handed/i, text: 'Rule: treat everyone the same.' },
];
export function simpleRule(authority: string | undefined): string | undefined {
  if (!authority) return undefined;
  return RULES.find((r) => r.test.test(authority))?.text;
}

export function simpleWarningText(text: string): string {
  return /manipulat|fake|fabricat/i.test(text) ? SIMPLE_UI.fakeWarning : SIMPLE_UI.checkedWarning;
}

export const SIMPLE_FEEDBACK_WARNING: Record<NonNullable<ActionFeedback['warning']>, string> = {
  'false-accusation': 'Oh no. That clue was not true. People feel less free and trust you less.',
  disproportionate: 'That was too harsh. People feel less free and trust you less.',
  'unverified-basis': 'You acted before checking the clue. Be careful.',
};

const UP: Record<Dimension, string> = {
  freedom: 'Nice. People feel more free.',
  grievance: 'Nice. A real problem is getting fixed.',
  safety: 'Good. People are safer now.',
  evidence: 'Great. You stuck to the facts.',
  trust: 'Nice. People trust you more.',
  economy: 'Good. Shops and buses keep going.',
};
const DOWN: Record<Dimension, string> = {
  freedom: 'Hmm. Some people feel less free now.',
  grievance: 'Hmm. The problem is still waiting.',
  safety: 'Careful. Some people are less safe.',
  evidence: 'Hmm. Rumours got a bit stronger.',
  trust: 'Hmm. People trust you a little less.',
  economy: 'Hmm. Some shops had to close.',
};

/** One short encouraging line derived from the feedback's direction, never from numbers. */
export function encouragement(feedback: ActionFeedback): string {
  if (feedback.warning) return SIMPLE_FEEDBACK_WARNING[feedback.warning];
  const ups = feedback.dims.filter((d) => feedback.direction[d] === 'up');
  const downs = feedback.dims.filter((d) => feedback.direction[d] === 'down');
  if (ups.length > 0 && ups.length >= downs.length) return UP[ups[0]];
  if (downs.length > 0) return DOWN[downs[0]];
  return "Okay. Let's see what happens next.";
}

export function dimDirectionWords(d: Dimension, dir: 'up' | 'down' | undefined): string {
  const name = SIMPLE_DIMENSIONS[d].label;
  return dir === 'up' ? `${name} up` : dir === 'down' ? `${name} down` : `${name} changed`;
}

export function simpleCrowd(crowd: number): string {
  if (crowd < 0.12) return 'Hardly anyone here';
  if (crowd < 0.35) return 'Some people here';
  if (crowd < 0.65) return 'Lots of people here';
  return 'A huge crowd here';
}
export function simpleMood(mood: DistrictMood): string {
  switch (mood) {
    case 'calm':
      return 'People are calm';
    case 'tense':
      return 'People are worried';
    case 'volatile':
      return 'People are angry';
    case 'hopeful':
      return 'People feel hopeful';
  }
}
export function simpleServices(v: number): string {
  if (v >= 0.8) return 'Shops and buses running';
  if (v >= 0.45) return 'Some shops closed';
  return 'Shops and buses stopped';
}
export function simpleTrust(v: number): string {
  if (v >= 0.66) return 'Trust is good';
  if (v >= 0.4) return 'Trust is okay';
  return 'Trust is low';
}
export const SIMPLE_INCIDENT: Record<IncidentKind, string> = {
  vandalism: 'Things are being broken here',
  clash: 'People are fighting here',
  fire: 'There is a fire here',
  outage: 'The power or water is off here',
  intimidation: 'People are being scared here',
};

export const SIMPLE_PACE: Record<TimerPace, string> = {
  standard: 'Normal speed: a chapter takes about three minutes.',
  relaxed: 'Slower speed: a chapter takes about four and a half minutes.',
  extended: 'Slowest speed: a chapter takes about six minutes.',
};

export const SIMPLE_TEXT = {
  anomaly: "This doesn't add up!",
  detailHint: 'Look closer and compare before you trust a clue.',
  metaHint: 'Press "Look closer" to see where this clue came from.',
  claimHeading: 'What it says',
  metaHeading: 'Details',
  actionsHeading: 'What you can do',
  nothingMore: 'Nothing more to do with this clue.',
  destroyed: 'This clue was destroyed before you could keep it safe.',
  whatWeFound: 'What we found',
  backToList: 'Back to clues',
  markerDestroyed: 'Gone',
  markerPreserved: 'Kept safe',
  markerUnresolved: 'Come back later',
  markerUsed: 'You used this',
  noClues: 'No clues yet. They will show up here soon.',
  pauseLead: 'Paused. Nothing moves until you press Keep going.',
  abandon: 'Stop this chapter',
  abandonConfirm: 'Stopping ends this story. Earlier chapters are saved, but this one will not count.',
  yesStop: 'Yes, stop',
  keepPlaying: 'Keep playing',
  speedHeading: 'Clock speed',
  leaveHeading: 'Stop playing',
  settingsNote: 'You can change the speed, text size and colours in Settings any time.',
  openSettings: 'Open settings',
  monitoringTitle: 'Nothing to decide right now',
  monitoringBody: 'New choices will pop up here. You can look at clues while you wait.',
  verdictRight: 'Yes! That is fair.',
  verdictWrong: 'Not quite.',
  principleHeading: 'The rule',
  whyHeading: 'Why it mattered',
  readRule: 'Read the real rule (for grown-ups)',
  reviewed: 'Checked on',
  next: 'Next',
  readyTitle: 'Ready?',
  readyBody: 'The clock starts when you press Start.',
  begin: 'Start',
  chapterDoneBody: "Let's see how the city did.",
  seeResult: 'See how you did',
  pulseSheetTitle: 'How is the city doing?',
  clueSheetTitle: 'Clues',
  clueDetailTitle: 'Clue',
  showChoice: 'Show choice',
  showChoices: 'Show choices',
  showClues: 'Show clues',
  helpingHere: 'Helpers are on the way here',
  timeToDecide: 'Time to choose',
  newChoice: 'New choice',
} as const;

export function simpleChoiceOf(i: number, n: number): string {
  return `Choice ${i} of ${n}`;
}
export function simpleReview(n: number): string {
  return `Look at ${n} clue${n === 1 ? '' : 's'}`;
}
export function simpleItems(n: number, open: number): string {
  const base = `${n} clue${n === 1 ? '' : 's'}`;
  return open > 0 ? `${base} · ${open} to look at` : `${base} · all looked at`;
}

/** Feed lines come from the engine as full text; swap in the scenario's simple wording where a match exists. */
export function makeFeedSimplifier(scenario: Scenario): (text: string) => string {
  const exact = new Map<string, string>();
  for (const e of scenario.events) if (e.simple) exact.set(e.message, e.simple);
  const swaps: [string, string][] = [];
  for (const d of scenario.decisions) {
    if (d.simple?.title && d.simple.title !== d.title) swaps.push([d.title, d.simple.title]);
    for (const o of d.options) {
      const so = d.simple?.options[o.id];
      if (so?.title && so.title !== o.title) swaps.push([o.title, so.title]);
    }
  }
  for (const ev of scenario.evidence) if (ev.simple?.title && ev.simple.title !== ev.title) swaps.push([ev.title, ev.simple.title]);
  swaps.sort((a, b) => b[0].length - a[0].length);
  return (text: string) => {
    const hit = exact.get(text);
    if (hit) return hit;
    let out = text.replace(/^New evidence — /, 'New clue — ').replace(/^Decision needed — /, 'Your choice — ');
    for (const [full, simple] of swaps) if (out.includes(full)) out = out.replace(full, simple);
    return out;
  };
}
