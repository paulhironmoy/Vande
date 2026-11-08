/**
 * The crowd's emotion: the one emotion source for Practice (north star "Emotional authenticity"; constitution §11,
 * §13, §29). A pure, deterministic state machine. Its only inputs are the delivery's resolved moments, each taking
 * effect at the instant it physically happened (the stage may deliver one ahead, with that time, for sample-accurate
 * audio: nothing shows before it), and the match context. It outputs how loud and engaged the crowd is (arousal), its mood, whether it is glad or dismayed
 * (valence: a home crowd behind the batter), what it expects, and the crowd reaction to play. Nothing here can reach
 * the simulation: the crowd follows outcomes, never shapes them.
 *
 * Free of Web Audio and of the audio graph: render3d imports it directly ('@/audio/emotion').
 *
 * The level is closed-form in time, so sampling allocates nothing and is frame-rate independent:
 *   arousal(t) = base(t) + reaction(t) + tail(t)
 *   base       approaches its target exponentially (time constant tau); after `hold` it relaxes to the resting murmur
 *              (time constant `relax`) — natural decay, with no further input needed
 *   reaction   one transient per crowd reaction: fast attack, exponential decay, aimed so the total peaks at the
 *              reaction's level (a four about 0.74, a six about 0.92, 1.0 only under pressure); the previous one
 *              keeps decaying as the tail, so the base (which the crowd bed follows) never jumps
 * Habituation keeps the maximum from following every event: fatigue rises with each celebration and relaxes over
 * about 40 s, and peaks shrink with it. Momentum (boundaries lift it, dot balls and wickets lower it) and pressure
 * (final over, a close chase, a milestone in reach) shape the murmur, the hush and the swings.
 */
import type { ContactKind, Dismissal, SwingTiming } from '@/contracts/practice';
import type { CaptionKey } from './captions';

/** The stage's moments (src/render3d/practice StageMoment is structurally one of these). */
type EmotionMomentKind =
  | 'approach'
  | 'gather'
  | 'release'
  | 'pitch'
  | 'contact'
  | 'pad'
  | 'beaten'
  | 'carry'
  | 'fielded'
  | 'four'
  | 'six'
  | 'wicket'
  | 'survived'
  | 'dot'
  | 'runs'
  | 'dead'
  | 'reflection';

export interface EmotionMoment {
  kind: EmotionMomentKind;
  /** 0..1: contact quality, closeness of a close call, progress towards the rope … */
  intensity: number;
  contact?: ContactKind;
  timing?: SwingTiming;
  dismissal?: Dismissal;
  runs?: number;
}

export type EmotionPhase =
  'between' | 'approach' | 'stride' | 'flight' | 'contact' | 'chase' | 'outcome' | 'reflection';
export type EmotionOutcome = 'four' | 'six' | 'wicket' | 'close_call' | 'runs' | 'dot' | 'leave' | null;

export type CrowdMood =
  | 'murmur'
  | 'anticipation'
  | 'concentration'
  | 'breath'
  | 'response'
  | 'gasp'
  | 'expectation'
  | 'frustration'
  | 'relief'
  | 'applause'
  | 'celebration'
  | 'eruption'
  | 'ovation'
  | 'restless'
  | 'silence'
  | 'dismay'
  | 'reflection';

/** A crowd reaction for the sound (src/audio/crowdVoices.ts synthesises each). */
export type CrowdReaction =
  'lift' | 'ooh' | 'groan' | 'relief' | 'applause' | 'cheer' | 'eruption' | 'ovation' | 'dismay';

/** Match context of the next delivery. It never touches the simulation. */
export interface DeliveryContext {
  /** 0 relaxed … 1 the most pressure (final over, a close chase, the last ball). */
  pressure?: number;
  /** A milestone this ball could bring up. */
  milestone?: 'fifty' | 'hundred' | null;
  /** In Practice a wicket ends the innings, so every dismissal is a damaging one (default true). */
  wicketEndsInnings?: boolean;
  /** The striker's runs before this ball (a milestone is recognised when a ball takes them past 50 or 100). */
  runs?: number;
  /**
   * In a chase: the runs that win it (with `runs`, the striker's runs before this ball, the scoreboard the crowd can
   * read). Absent in every other innings. Public information before the ball, never a forecast of it.
   */
  target?: number | null;
  /** In a chase: the legal balls left, this one included (1 on the last ball). */
  ballsLeft?: number | null;
}

export interface CrowdEmotion {
  phase: EmotionPhase;
  mood: CrowdMood;
  /** 0 hushed … 1 the stadium at full voice. */
  arousal: number;
  /** −1 dismay … +1 joy. */
  valence: number;
  /** 0..1: expectation building (the approach, a ball racing to the rope). */
  expectation: number;
  /** The outcome from the moment it is physically confirmed (null before). */
  outcome: EmotionOutcome;
  pressure: number;
}

/** Anchor levels (arousal) and timing (ms). */
export const CROWD = {
  murmur: 0.3,
  subdued: 0.12,
  approachMax: 0.62,
  hush: 0.12,
  breath: 0.07,
  /** The decisive silence of a wicket: reached within 150 ms of the physical event. */
  silence: 0.03,
  /** How long the silence holds before the crowd's shift (ms). */
  silenceHoldMs: 900,
  /** The most the crowd shows before an outcome is confirmed (a ball racing to the rope): below every four. */
  expectMax: 0.6,
  /** Peaks at no pressure and no fatigue. The bands never overlap: six > four > single > dot ≥ leave, always. */
  four: 0.74,
  six: 0.92,
  /**
   * A chase ends on the ball: the runs that reach the target (a four 0.82, a six 0.90, a run or two 0.62, plus up to
   * 0.10 / 0.10 / 0.25 as the finish gets closer: six > four > runs holds at every closeness), and, on the last ball
   * when they fall short, the share of a routine reaction a hit gets (the crowd is polite, then quiet), the least a
   * run is applauded (above the groan of a dot, so single > dot holds there too) and the groan of a dot.
   */
  winFour: 0.82,
  winSix: 0.9,
  winRuns: 0.62,
  lostShare: 0.6,
  lostRunsFloor: 0.24,
  lostGroan: 0.2,
  /** After the reflection moment the crowd settles to its murmur over this long. */
  settleMs: 4200,
  /** Default relaxation from a held reaction back to the murmur. */
  relaxMs: 2400,
  /** Fatigue (habituation) relaxes with this time constant. */
  fatigueTauMs: 40_000,
} as const;

/** The machine's full state: plain numbers and strings, so it copies without allocation. */
export interface EmotionState {
  at: number;
  pressure: number;
  milestone: 'fifty' | 'hundred' | null;
  wicketEndsInnings: boolean;
  runsBefore: number | null;
  /** The chase this ball belongs to: the runs that win it and the legal balls left (null outside a chase). */
  target: number | null;
  ballsLeft: number | null;
  /** What this ball did to the chase once the physics confirmed it: reached the target, or cannot (last ball short). */
  verdict: 'won' | 'lost' | null;
  /** A context arrived for the coming delivery. */
  fresh: boolean;
  fatigue: number;
  fatigueAt: number;
  momentum: number;
  dots: number;
  subdued: boolean;
  from: number;
  to: number;
  t0: number;
  tau: number;
  hold: number;
  relax: number;
  rest: number;
  vFrom: number;
  vTo: number;
  vT0: number;
  vTau: number;
  eFrom: number;
  eTo: number;
  eT0: number;
  eTau: number;
  rAmp: number;
  rAt: number;
  rAttack: number;
  rDecay: number;
  /** The previous reaction, still decaying on its own (so the base, which the crowd bed follows, never jumps). */
  tAmp: number;
  tAt: number;
  tAttack: number;
  tDecay: number;
  phase: EmotionPhase;
  settleAt: number;
  mood: CrowdMood;
  moodUntil: number;
  nextMood: CrowdMood;
  outcome: EmotionOutcome;
  /**
   * The last input's time and what was in effect just before it: phase, mood and outcome switch exactly at an input's
   * own time, so a moment delivered ahead of time (for sample-accurate audio) never shows early.
   */
  switchAt: number;
  phaseBefore: EmotionPhase;
  moodBefore: CrowdMood;
  outcomeBefore: EmotionOutcome;
  quality: number;
  edged: boolean;
  padded: boolean;
  carry: number;
  risen: boolean;
  /** The crowd has lifted for this hit (on its first carry: a block that goes nowhere gets no reaction). */
  lifted: boolean;
  /** What the last input asked for: a crowd reaction (null: none), its strength over the base, a crowd caption. */
  reaction: CrowdReaction | null;
  reactionLevel: number;
  caption: CaptionKey | null;
}

export function initialEmotion(): EmotionState {
  const m = CROWD.murmur;
  return {
    at: Number.NEGATIVE_INFINITY,
    pressure: 0,
    milestone: null,
    wicketEndsInnings: true,
    runsBefore: null,
    target: null,
    ballsLeft: null,
    verdict: null,
    fresh: false,
    fatigue: 0,
    fatigueAt: 0,
    momentum: 0,
    dots: 0,
    subdued: false,
    from: m,
    to: m,
    t0: 0,
    tau: 1000,
    hold: Number.POSITIVE_INFINITY,
    relax: CROWD.relaxMs,
    rest: m,
    vFrom: 0,
    vTo: 0,
    vT0: 0,
    vTau: 1000,
    eFrom: 0,
    eTo: 0,
    eT0: 0,
    eTau: 1000,
    rAmp: 0,
    rAt: 0,
    rAttack: 1,
    rDecay: 1,
    tAmp: 0,
    tAt: 0,
    tAttack: 1,
    tDecay: 1,
    phase: 'between',
    settleAt: Number.NEGATIVE_INFINITY,
    mood: 'murmur',
    moodUntil: Number.POSITIVE_INFINITY,
    nextMood: 'murmur',
    outcome: null,
    switchAt: Number.NEGATIVE_INFINITY,
    phaseBefore: 'between',
    moodBefore: 'murmur',
    outcomeBefore: null,
    quality: 0,
    edged: false,
    padded: false,
    carry: 0,
    risen: false,
    lifted: false,
    reaction: null,
    reactionLevel: 0,
    caption: null,
  };
}

export const blankCrowdEmotion = (): CrowdEmotion => ({
  phase: 'between',
  mood: 'murmur',
  arousal: CROWD.murmur,
  valence: 0,
  expectation: 0,
  outcome: null,
  pressure: 0,
});

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const clampV = (x: number) => (x < -1 ? -1 : x > 1 ? 1 : x);
const approach = (from: number, to: number, t0: number, tau: number, at: number) =>
  at <= t0 ? from : to + (from - to) * Math.exp(-(at - t0) / tau);

/** The base level at `at` (exponential approach, then the relaxation to rest after the hold). */
export function baseLevel(s: Readonly<EmotionState>, at: number): number {
  const dt = at - s.t0;
  if (dt <= 0) return s.from;
  if (dt <= s.hold) return s.to + (s.from - s.to) * Math.exp(-dt / s.tau);
  const held = s.to + (s.from - s.to) * Math.exp(-s.hold / s.tau);
  return s.rest + (held - s.rest) * Math.exp(-(dt - s.hold) / s.relax);
}

const transient = (amp: number, t0: number, attack: number, decay: number, at: number) => {
  const x = at - t0;
  return amp <= 0 || x <= 0 ? 0 : amp * (1 - Math.exp(-x / attack)) * Math.exp(-x / decay);
};

/** The current reaction's transient at `at`. */
export const reactionValue = (s: Readonly<EmotionState>, at: number) =>
  transient(s.rAmp, s.rAt, s.rAttack, s.rDecay, at);
/** The previous reaction's tail at `at`. */
export const tailValue = (s: Readonly<EmotionState>, at: number) => transient(s.tAmp, s.tAt, s.tAttack, s.tDecay, at);

export const valenceAt = (s: Readonly<EmotionState>, at: number) => clampV(approach(s.vFrom, s.vTo, s.vT0, s.vTau, at));
export const expectationAt = (s: Readonly<EmotionState>, at: number) =>
  clamp01(approach(s.eFrom, s.eTo, s.eT0, s.eTau, at));
/** The mood in effect at `at`. */
export const moodAt = (s: Readonly<EmotionState>, at: number): CrowdMood =>
  at < s.switchAt ? s.moodBefore : at < s.moodUntil ? s.mood : s.nextMood;
/** The phase in effect at `at`. */
export const phaseAt = (s: Readonly<EmotionState>, at: number): EmotionPhase =>
  at < s.switchAt ? s.phaseBefore : s.phase === 'reflection' && at >= s.settleAt ? 'between' : s.phase;
/** The outcome in effect at `at` (null until physically confirmed). */
export const outcomeAt = (s: Readonly<EmotionState>, at: number): EmotionOutcome =>
  at < s.switchAt ? s.outcomeBefore : s.outcome;

/** The resting murmur for the state's context and memory. */
export function restLevel(s: Readonly<EmotionState>): number {
  if (s.subdued) return CROWD.subdued;
  const r = CROWD.murmur + 0.08 * s.pressure + 0.05 * Math.max(0, s.momentum) + 0.012 * Math.min(4, s.dots);
  return r < 0.24 ? 0.24 : r > 0.42 ? 0.42 : r;
}

/** Samples the state at `at` into `out` (no allocation when `out` is given). Pure. */
export function sampleEmotion(
  s: Readonly<EmotionState>,
  at: number,
  out: CrowdEmotion = blankCrowdEmotion(),
): CrowdEmotion {
  out.arousal = clamp01(baseLevel(s, at) + reactionValue(s, at) + tailValue(s, at));
  out.valence = valenceAt(s, at);
  out.expectation = expectationAt(s, at);
  out.phase = phaseAt(s, at);
  out.mood = moodAt(s, at);
  out.outcome = outcomeAt(s, at);
  out.pressure = s.pressure;
  return out;
}
