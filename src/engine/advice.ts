/**
 * Bowling advice for the planner (engine v1): how each locked delivery is earned, what works on a pitch and in the
 * weather, and an honest summary of an over before it is sealed. Pure and deterministic. Every read is a heuristic of
 * the engine's own model (its tables and the batter's best response, the same measure as tactical efficiency), never a
 * promise about an outcome. Copy lives in src/i18n/engine under `advice.*`.
 */
import type { Conditions, DeliveryFamily, DeliveryPlan, DeliveryVariant, FieldSetting, Length, MatchEventLog, MatchKind, PitchId } from '@/contracts';
import { autoXiBalls } from './auto';
import { contrasts, type BallContext, type DeliveryCore, type PrevBall } from './v1/model';
import { bowlingChoice, optionRange, wicketCost } from './v1/performance';
import { energyCost } from './v1/plan';
import { FAMILY, FIELD_SETTINGS, LINES, OVER_ENERGY_BUDGET, SUPER_BALL_ALLOWANCE, VARIANTS } from './v1/tables';

/** A line of advice: an engine copy key and its params. */
export interface AdviceLine {
  key: string;
  params?: Record<string, string | number>;
}

// --- Unlocks ----------------------------------------------------------------------------------------------------------

export type UnlockAchievement = 'tight_over' | 'stumps' | 'caught' | 'spin_wicket';
export type UnlockableVariant = 'slower' | 'inswing' | 'outswing' | 'legspin';

/** The achievement that unlocks each delivery beyond the four starters. Unlocks are earned, never bought. */
export const UNLOCKS: Readonly<Record<UnlockableVariant, UnlockAchievement>> = {
  slower: 'tight_over',
  inswing: 'stumps',
  outswing: 'caught',
  legspin: 'spin_wicket',
};
/** Official matches the server reveals: only these count towards unlocks. */
export const UNLOCK_MATCH_KINDS: readonly MatchKind[] = ['duel', 'cup'];
/** Most runs a batter may score off the player's over for `tight_over`. */
export const TIGHT_OVER_RUNS = 6;

/** How a locked delivery is earned (null for a starter). */
export function unlockHint(variant: DeliveryVariant): AdviceLine | null {
  return Object.prototype.hasOwnProperty.call(UNLOCKS, variant) ? { key: `advice.unlock.${variant}` } : null;
}

/**
 * Deliveries `player` earns as the bowler of a revealed official match (their over, the other player's innings):
 * Slower ball for an over of 6 runs or fewer, In-swing for a batter bowled or LBW, Out-swing for a batter caught,
 * Leg-spin for any wicket with Off-spin (run-outs are not the bowler's). Nothing counts when the player's over was an
 * Auto Over; balls Auto XI batted for the opponent never count, and a tight over needs the batter to have played every
 * ball. Which matches are official (not late practice) is the platform's to decide; it merges the result into the
 * player's unlocks.
 */
export function unlocksEarned(log: MatchEventLog, player: 0 | 1): DeliveryVariant[] {
  if (!log || !UNLOCK_MATCH_KINDS.includes(log.kind) || log.commits?.[player]?.auto) return [];
  const i = log.innings.findIndex((inn) => inn && inn.bowler === player);
  if (i !== 0 && i !== 1) return [];
  const inn = log.innings[i];
  const auto = new Set(autoXiBalls(log)[i]);
  const earned = new Set<DeliveryVariant>();
  for (const o of inn.balls) {
    if (auto.has(o.ball) || !o.wicket || o.wicket === 'run_out') continue;
    if (o.wicket === 'bowled' || o.wicket === 'lbw') earned.add('inswing');
    if (o.wicket === 'caught') earned.add('outswing');
    if (o.delivery.variant === 'offspin') earned.add('legspin');
  }
  if (![...auto].some((b) => b < 6) && inn.runs <= TIGHT_OVER_RUNS) earned.add('slower');
  return VARIANTS.filter((v) => earned.has(v));
}

// --- Pitch and weather ------------------------------------------------------------------------------------------------

/**
 * What each pitch rewards and punishes, exactly as its hint says it. Tests check every claim against the outcome model
 * (each "good" ball is harder to score from than each "poor" one, in every weather) and the simulation (its best over
 * for the pitch follows the hint, and an over of "poor" balls concedes more).
 */
export const PITCH_ADVICE: Readonly<Record<PitchId, { good: ReadonlyArray<readonly [DeliveryVariant, Length]>; poor: ReadonlyArray<readonly [DeliveryVariant, Length]> }>> = {
  // Seam and swing on a good length (best with the new ball); spin is easier to hit, full or short worst of all.
  green: {
    good: [['good_length', 'good'], ['inswing', 'good'], ['outswing', 'good']],
    poor: [['offspin', 'full'], ['offspin', 'short'], ['legspin', 'full'], ['legspin', 'short']],
  },
  // Yorkers and bouncers bite; a full ball that is not a yorker is a half-volley to smash.
  hard: {
    good: [['yorker', 'full'], ['bouncer', 'short']],
    poor: [['good_length', 'full'], ['inswing', 'full'], ['outswing', 'full'], ['offspin', 'full'], ['legspin', 'full']],
  },
  // Spin and slower balls grip; fast short balls and full swing sit up to be hit.
  slow: {
    good: [['offspin', 'good'], ['offspin', 'full'], ['legspin', 'good'], ['legspin', 'full'], ['slower', 'good'], ['slower', 'short']],
    poor: [['bouncer', 'short'], ['good_length', 'short'], ['inswing', 'full'], ['outswing', 'full']],
  },
};

/** Whether a delivery is one the pitch hint recommends ('good'), warns against ('poor'), or neither. */
export function pitchKind(d: Pick<DeliveryPlan, 'variant' | 'length'>, pitch: PitchId): 'good' | 'poor' | null {
  const is = (list: ReadonlyArray<readonly [DeliveryVariant, Length]>) => list.some(([v, l]) => v === d.variant && l === d.length);
  return is(PITCH_ADVICE[pitch].good) ? 'good' : is(PITCH_ADVICE[pitch].poor) ? 'poor' : null;
}

/** One line for the pitch, and one for the weather when it matters (humid air helps swing; dew hurts spin most). */
export function pitchHints(conditions: Conditions): AdviceLine[] {
  const lines: AdviceLine[] = [{ key: `advice.pitch.${conditions.pitch}` }];
  if (conditions.weather === 'humid' || conditions.weather === 'dew') lines.push({ key: `advice.weather.${conditions.weather}` });
  return lines;
}

// --- Over summary -----------------------------------------------------------------------------------------------------

/** An over's deliveries (gestures are not needed: the summary is about choices, not releases). */
export interface OverShape {
  field: FieldSetting;
  balls: ReadonlyArray<Omit<DeliveryPlan, 'gesture'>>;
  superBall: Omit<DeliveryPlan, 'gesture'>;
}

export interface OverSummary {
  /** Main balls per family. */
  families: Record<DeliveryFamily, number>;
  energy: { used: number; budget: number };
  /** Main balls per length. */
  lengths: Record<Length, number>;
  /** Different lines among the main balls (1–4). */
  lines: number;
  field: FieldSetting;
  superBall: { variant: DeliveryVariant; cost: number; allowance: number };
  /** Honest reads, most important first (at most three). */
  reads: AdviceLine[];
  /** 0–1: how good the six choices are for this pitch, field and energy (1 = the best ball of each cost). */
  pitchFit: number;
  /** Main balls the pitch hint recommends and warns against. */
  pitchBalls: { good: number; poor: number };
}

/** Thresholds of the reads (calibrated with the simulation, see docs/GAME_RULES.md section 17). */
export const ADVICE = {
  /** Identical deliveries (variant, length and line) before an over reads as predictable. */
  predictable: 3,
  /** Unused energy (of 15) worth pointing out: the simulation's best overs always use 14 or 15. */
  energyLeft: 3,
  /** Intent count (of six) for "all-out attack" or "playing it safe". */
  intent: 5,
  /** A ball scoring below this (0–1, against every ball of its cost) and `weakGap` runs worse than the best of them. */
  weakBall: 0.25,
  weakGap: 0.6,
  /** Balls the pitch hint recommends for "good fit for this pitch" (with none it warns against, no easy ball and no repeats). */
  fitsPitch: 3,
  /** Balls the pitch hint warns against for "goes against this pitch". */
  againstPitch: 2,
  /** Runs (batter's best response, six balls) another field must save to be suggested. */
  fieldMargin: 0.6,
} as const;

const core = (d: Omit<DeliveryPlan, 'gesture'>): DeliveryCore => ({ variant: d.variant, line: d.line, length: d.length, intensity: d.intensity, intent: d.intent });
const neutral = (k: number): BallContext => ({ ball: k, superBall: false, lastBall: k >= 5, newBatter: k === 0, prev: null, repeats: 0 });

/**
 * An over at a glance (families, energy, lengths, lines, field, Super Ball) and honest reads, most important first:
 * predictable (the same ball three or more times: each repeat is easier to hit), balls the pitch punishes (its hint),
 * a ball that is easy to hit for its energy cost, a wasted set-up (section 5.5), a field that suits these balls better,
 * all-out attack or playing it safe (intent multipliers), energy left over, suits the pitch, a set-up that is ready.
 * `unlocked` limits the comparisons to deliveries the player can bowl.
 */
export function overSummary(over: OverShape, conditions: Conditions, opts: { unlocked?: readonly DeliveryVariant[] } = {}): OverSummary {
  const balls = over.balls.map(core);
  const variants = opts.unlocked && opts.unlocked.length ? VARIANTS.filter((v) => opts.unlocked!.includes(v)) : VARIANTS;
  const families: Record<DeliveryFamily, number> = { pace: 0, swing: 0, spin: 0 };
  const lengths: Record<Length, number> = { full: 0, good: 0, short: 0 };
  for (const d of balls) {
    families[FAMILY[d.variant]]++;
    lengths[d.length]++;
  }
  const used = balls.reduce((s, d) => s + energyCost(d), 0);
  const lines = LINES.filter((l) => balls.some((d) => d.line === l)).length;

  // Choice quality for this pitch, field and ball (neutral context: sequencing has its own reads).
  const lambdas = balls.map((_, k) => wicketCost(neutral(k), 0));
  const choices = balls.map((d, k) => bowlingChoice(d, over.field, conditions, neutral(k), lambdas[k], variants));
  const scores = choices.map((c) => c.score);
  const pitchFit = scores.length ? scores.reduce((s, x) => s + x, 0) / scores.length : 0;
  let weakest = -1;
  choices.forEach((c, k) => {
    if (c.score < ADVICE.weakBall && c.best - c.min >= ADVICE.weakGap && (weakest < 0 || c.score < scores[weakest])) weakest = k;
  });
  const good = balls.filter((d) => pitchKind(d, conditions.pitch) === 'good').length;
  const poor = balls.filter((d) => pitchKind(d, conditions.pitch) === 'poor').length;

  // The field these balls suit best (the batter's best response summed over the over).
  const fieldValue = (f: FieldSetting) => balls.reduce((s, d, k) => s + optionRange(d, 'good', f, conditions, neutral(k), lambdas[k]).best, 0);
  const values = FIELD_SETTINGS.map((f) => [f, fieldValue(f)] as const);
  const own = values.find(([f]) => f === over.field)?.[1] ?? 0;
  const better = values.reduce((a, b) => (b[1] < a[1] ? b : a));

  // Repeats: the most times one exact delivery is bowled.
  const counts = new Map<string, number>();
  for (const d of balls) counts.set(`${d.variant}|${d.length}|${d.line}`, (counts.get(`${d.variant}|${d.length}|${d.line}`) ?? 0) + 1);
  const most = Math.max(0, ...counts.values());

  // Set-ups: each needs the very next ball to attack and contrast with it (a sixth-ball set-up has no next ball).
  let wasted = -1;
  let ready = -1;
  balls.forEach((d, k) => {
    if (d.intent !== 'setup') return;
    const next = balls[k + 1];
    const prev: PrevBall = { ...d, grade: 'good' };
    if (next && next.intent === 'attack' && contrasts(prev, next)) {
      if (ready < 0) ready = k;
    } else if (wasted < 0) wasted = k;
  });
  const attacks = balls.filter((d) => d.intent === 'attack').length;
  const contains = balls.filter((d) => d.intent === 'contain').length;

  const reads: AdviceLine[] = [];
  if (most >= ADVICE.predictable) reads.push({ key: 'advice.read.predictable', params: { count: most } });
  if (poor >= ADVICE.againstPitch) reads.push({ key: 'advice.read.against_pitch', params: { count: poor } });
  if (weakest >= 0) reads.push({ key: 'advice.read.weak_ball', params: { n: weakest + 1 } });
  if (wasted >= 0) reads.push({ key: 'advice.read.setup_wasted', params: { n: wasted + 1 } });
  if (better[0] !== over.field && own - better[1] >= ADVICE.fieldMargin) reads.push({ key: `advice.read.field_${better[0]}` });
  if (attacks >= ADVICE.intent) reads.push({ key: 'advice.read.attack' });
  else if (contains >= ADVICE.intent) reads.push({ key: 'advice.read.contain' });
  if (OVER_ENERGY_BUDGET - used >= ADVICE.energyLeft) reads.push({ key: 'advice.read.energy_left', params: { n: OVER_ENERGY_BUDGET - used } });
  if (good >= ADVICE.fitsPitch && poor === 0 && weakest < 0 && most < ADVICE.predictable) reads.push({ key: 'advice.read.fits_pitch' });
  if (ready >= 0) reads.push({ key: 'advice.read.setup_ready', params: { n: ready + 1, next: ready + 2 } });

  return {
    families,
    energy: { used, budget: OVER_ENERGY_BUDGET },
    lengths,
    lines,
    field: over.field,
    superBall: { variant: over.superBall.variant, cost: energyCost(core(over.superBall)), allowance: SUPER_BALL_ALLOWANCE },
    reads: reads.slice(0, 3),
    pitchFit: Math.round(pitchFit * 1000) / 1000,
    pitchBalls: { good, poor },
  };
}
