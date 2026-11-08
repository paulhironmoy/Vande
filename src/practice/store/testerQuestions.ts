/**
 * The tester mode's one-tap questions and when they are asked (release/player-experience/shared/playtest/): a small
 * config object, so the protocol can change the schedule without changing code. Every answer is a closed code.
 */
const YES_PARTLY_NO = ['yes', 'partly', 'no'] as const;
const YES_NO = ['yes', 'no'] as const;
const ONE_TO_TEN = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] as const;

export const TESTER_ANSWERS = {
  intent_rookie: ['leave', 'block', 'ground', 'air'],
  intent_expert: ['leave', 'forward_defence', 'back_defence', 'drive', 'cut', 'pull', 'flick', 'lofted'],
  intent_direction: ['off', 'straight', 'leg'],
  control: YES_PARTLY_NO,
  pace_or_spin: ['pace', 'spin'],
  line: ['outside_off', 'stumps', 'leg_side'],
  length: ['full', 'good', 'short'],
  movement: ['in', 'away', 'none', 'up'],
  setup_score: YES_PARTLY_NO,
  why: YES_PARTLY_NO,
  rate_control: ONE_TO_TEN,
  rate_fairness: ONE_TO_TEN,
  rate_clarity: ONE_TO_TEN,
  rate_satisfaction: ONE_TO_TEN,
  rate_credibility: ONE_TO_TEN,
  understood_input: YES_PARTLY_NO,
  motion_comfort: ['none', 'mild', 'severe'],
  scripted: YES_NO,
  obscured: YES_NO,
  fidelity_perceptual: ONE_TO_TEN,
  fidelity_tactical: ONE_TO_TEN,
  fidelity_emotional: ONE_TO_TEN,
} as const;

export type TesterQuestion = keyof typeof TESTER_ANSWERS;

/** When each question is asked. Over numbers count the session's innings overs from 1. */
export const TESTER_SCHEDULE = {
  /** After every innings ball of these overs, before its explanation. */
  intentOvers: [1] as readonly number[],
  readOvers: [2] as readonly number[],
  /** After ball 1 of each of the first this-many overs. */
  paceOrSpinOvers: 3,
  /** Once, after the session's first ball. */
  afterFirstBall: ['setup_score'] as readonly TesterQuestion[],
  /** When Coach Mode closes after at least one attempt. */
  afterCoach: ['why'] as readonly TesterQuestion[],
  /** After the fifth attempt at one exact ball. */
  masteryRun: 5,
  afterMasteryRun: [
    'rate_control',
    'rate_clarity',
    'rate_satisfaction',
    'rate_credibility',
  ] as readonly TesterQuestion[],
  /** When the facilitator ends the session (after the continuation window). */
  endOfSession: [
    'understood_input',
    'rate_fairness',
    'motion_comfort',
    'scripted',
    'obscured',
  ] as readonly TesterQuestion[],
  endOfSessionExperts: ['fidelity_perceptual', 'fidelity_tactical', 'fidelity_emotional'] as readonly TesterQuestion[],
  /** The end-of-over screen's continuation window: a next over started within it, unprompted, is voluntary. */
  continuationWindowMs: 60_000,
} as const;

export const TESTER_MARKER_REASONS = [
  'controls',
  'ball_tracking',
  'result',
  'coaching',
  'navigation',
  'other',
] as const;
export const TESTER_EXPLAINED = ['correct', 'wrong', 'none'] as const;
export const TESTER_TASKS = ['defend', 'hit', 'leave'] as const;
export const TESTER_EXPLOITS = ['same_shot_scores', 'timing_trick', 'other'] as const;
