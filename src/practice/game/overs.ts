/**
 * Practice overs: the seeded Quick Random Over, the guided first over, and the Build an Over helpers. One bowler
 * family bowls the whole over, all six balls are fixed before the first is bowled, and every ball is legal: Practice
 * bowls no wides and no no-balls (docs/PRACTICE_RULES.md, "Wides and no-balls"), so all six count.
 *
 * Randomness comes only from the shared seeded generator (src/engine/prng.ts, SHA-256 keyed), so a seed always gives
 * the same over, and each ball's physics seed is derived from the over seed (`ballSeed`).
 *
 * Every over carries its ball (BallCondition): a new white ball unless the setup chooses another (DEFAULT_BALL). The
 * ball's age changes the swing and seam (src/physics/constants.ts BALL_AGE_FACTORS), so it is part of the exact ball.
 *
 * Speeds are honest: the km/h stored here is the release speed the physics bowls and the screen shows. Difficulty, not
 * the assistance level, sets the bowling (assistance changes only the timing bands): Beginner bowls genuinely slower
 * (pace about 100–114 km/h, spin at the bottom of the physics' spin range) rather than relabelling a slow ball as fast.
 */
import {
  PRACTICE_SIM_VERSION,
  type AssistLevel,
  type BallCondition,
  type BowlerFamily,
  type BowlerProfile,
  type DeliveryVariation,
  type Difficulty,
  type PaceBand,
  type PaceVariation,
  type PitchCondition,
  type PracticeDeliveryPlan,
  type PracticeOverPlan,
  type SpinType,
  type SpinVariation,
} from '@/contracts/practice';
import { rngFromKey, type Sfc32 } from '@/engine/prng';
import { sha256Hex } from '@/engine/sha256';
import { BODY, DEFAULT_BALL, PACE_BANDS_KPH, PACE_KPH, SPIN_KPH, YORKER_MAX_LENGTH } from '@/physics/constants';
import { flight, flightMovement } from '@/physics/delivery';

// ---------------------------------------------------------------------------------------------------------------
// Speeds (km/h, real)
// ---------------------------------------------------------------------------------------------------------------

// The pace bowler's stock-ball bands (controlled, fast, express) and the ranges of pace and spin speeds are the
// physics' own (src/physics/constants.ts PACE_BANDS_KPH, PACE_KPH, SPIN_KPH): a plan never asks for a speed the
// physics does not model.

/** Beginner difficulty: a genuinely slower pace bowler (shown at its true speed). The name is kept for its users. */
export const LEARN_PACE_KPH = [100, 114] as const;
export const BEGINNER_PACE_KPH = LEARN_PACE_KPH;
/** Stock speeds of the two kinds of spinner (inside SPIN_KPH), and Beginner's slower spinner (its bottom). */
export const SPIN_STOCK_KPH: Readonly<Record<SpinType, readonly [number, number]>> = { finger: [80, 90], wrist: [76, 86] };
export const LEARN_SPIN_KPH = [SPIN_KPH[0], SPIN_KPH[0] + 3] as const;
export const BEGINNER_SPIN_KPH = LEARN_SPIN_KPH;

// ---------------------------------------------------------------------------------------------------------------
// Variations
// ---------------------------------------------------------------------------------------------------------------

/** stock = the bowler's stock ball; movement = his everyday variation (swing, seam, flight); change = a change-up. */
export type VariationKind = 'stock' | 'movement' | 'change';

export interface VariationSpec {
  kind: VariationKind;
  /** Typical length (m in front of the striker's stumps) and line at the stumps (m, + = striker's off side). */
  lengthM: readonly [number, number];
  lineM: readonly [number, number];
  /** Speed against the stock ball: stock × scale + delta (km/h). */
  kphScale: number;
  kphDelta: number;
}

export const PACE_VARIATIONS: Readonly<Record<PaceVariation, VariationSpec>> = {
  // The stock ball works the channel just outside off stump; about a third of it would hit the stumps.
  stock: { kind: 'stock', lengthM: [5, 7], lineM: [0.06, 0.32], kphScale: 1, kphDelta: 0 },
  outswing: { kind: 'movement', lengthM: [3.5, 5.5], lineM: [0.06, 0.3], kphScale: 1, kphDelta: -2 },
  inswing: { kind: 'movement', lengthM: [3.5, 5.5], lineM: [-0.02, 0.22], kphScale: 1, kphDelta: -2 },
  seam: { kind: 'movement', lengthM: [5, 7], lineM: [0.02, 0.28], kphScale: 1, kphDelta: 0 },
  cutter: { kind: 'change', lengthM: [5.5, 7.5], lineM: [0, 0.25], kphScale: 0.91, kphDelta: 0 },
  slower: { kind: 'change', lengthM: [4, 6], lineM: [0.03, 0.26], kphScale: 0.8, kphDelta: 0 },
  // A bouncer's length is solved against the flight so it arrives between shoulder and head (`bouncerLength`).
  bouncer: { kind: 'change', lengthM: [10, 12], lineM: [-0.1, 0.3], kphScale: 1, kphDelta: 2 },
  yorker: { kind: 'change', lengthM: [0.5, 1.2], lineM: [-0.1, 0.12], kphScale: 1, kphDelta: 0 },
};

export const SPIN_VARIATIONS: Readonly<Record<SpinVariation, VariationSpec>> = {
  stock: { kind: 'stock', lengthM: [3.5, 5], lineM: [0.02, 0.3], kphScale: 1, kphDelta: 0 },
  flighted: { kind: 'movement', lengthM: [2.5, 3.6], lineM: [0.04, 0.3], kphScale: 1, kphDelta: -7 },
  quicker: { kind: 'movement', lengthM: [4.5, 6], lineM: [-0.02, 0.22], kphScale: 1, kphDelta: 8 },
  topspinner: { kind: 'change', lengthM: [3.5, 5], lineM: [0, 0.25], kphScale: 1, kphDelta: -2 },
  arm_ball: { kind: 'change', lengthM: [3.5, 5], lineM: [0.02, 0.24], kphScale: 1, kphDelta: 5 },
  wrong_un: { kind: 'change', lengthM: [3.5, 5], lineM: [0.02, 0.3], kphScale: 1, kphDelta: -1 },
};

/** Any legal Practice delivery is bowled within the speeds the physics models (km/h): PACE_KPH and SPIN_KPH. */
export const SPEED_LIMITS_KPH: Readonly<Record<BowlerFamily, readonly [number, number]>> = { pace: PACE_KPH, spin: SPIN_KPH };

const PACE_LIST: readonly PaceVariation[] = ['stock', 'outswing', 'inswing', 'seam', 'cutter', 'slower', 'bouncer', 'yorker'];
/** A finger spinner's wrong'un is the carrom ball; a wrist spinner's is the googly. */
const SPIN_LIST: Readonly<Record<SpinType, readonly SpinVariation[]>> = {
  finger: ['stock', 'flighted', 'quicker', 'arm_ball', 'wrong_un'],
  wrist: ['stock', 'flighted', 'quicker', 'topspinner', 'wrong_un'],
};

/** The variations a bowler of this family (and spin type) bowls, stock first. */
export function variationsFor(family: BowlerFamily, spinType?: SpinType): DeliveryVariation[] {
  if (family === 'pace') return [...PACE_LIST];
  if (spinType) return [...SPIN_LIST[spinType]];
  return ['stock', 'flighted', 'quicker', 'topspinner', 'arm_ball', 'wrong_un'];
}

export function variationSpec(family: BowlerFamily, v: DeliveryVariation): VariationSpec | null {
  if (family === 'pace') return (PACE_VARIATIONS as Record<string, VariationSpec>)[v] ?? null;
  return (SPIN_VARIATIONS as Record<string, VariationSpec>)[v] ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Legal limits (the same for random and built overs)
// ---------------------------------------------------------------------------------------------------------------

/** Where a Practice delivery may be aimed: line at the striker's stumps (m, + = off side) and length (m in front). */
export const BUILD_LIMITS: Readonly<Record<BowlerFamily, { lineM: readonly [number, number]; lengthM: readonly [number, number] }>> = {
  pace: { lineM: [-0.3, 0.5], lengthM: [0.4, 13] },
  spin: { lineM: [-0.3, 0.5], lengthM: [1.5, 7] },
};
/**
 * A pace bouncer pitches at least this short and a yorker within the physics' YORKER_MAX_LENGTH (the length it digs
 * out from the crease); every other pace ball stays between the two (m).
 */
export const BOUNCER_MIN_LENGTH_M = 7.5;
export const PACE_OTHER_LENGTH_M = [YORKER_MAX_LENGTH, 8] as const;
/** At most this many bouncers in an over (random overs bowl at most one). */
export const MAX_BOUNCERS = 2;

/**
 * Where a bouncer arrives at the batter (m above the ground, at the contact plane): above the shoulder (the top of the
 * batter's torso) and no higher than the top of his head, which keeps it legal (Law 21.10, the ball passing above head
 * height is a no-ball). The physics' body: BODY.torsoTop and BODY.headY + BODY.headR.
 */
export const BOUNCER_ARRIVAL_M = [BODY.torsoTop, BODY.headY + BODY.headR] as const;
/** The heights a random bouncer aims for (inside the window, clear of both edges), and a built one. */
export const BOUNCER_TARGET_M = [BOUNCER_ARRIVAL_M[0] + 0.06, BOUNCER_ARRIVAL_M[1] - 0.08] as const;
export const BOUNCER_BUILT_TARGET_M = (BOUNCER_TARGET_M[0] + BOUNCER_TARGET_M[1]) / 2;

/** Height at the batter of a delivery (from the one flight model), with the over's ball (default new). */
export function arrivalHeight(plan: PracticeDeliveryPlan, bowler: BowlerProfile, conditions: PitchCondition, seed: string, ball?: BallCondition): number {
  return flightMovement(flight({ plan, bowler, conditions, seed, ...(ball ? { ball } : {}) })).heightAtBatM;
}

/** A copy of a ball condition (the default when none is given), so plans never share one object. */
export function ballOf(ball?: BallCondition): BallCondition {
  return { colour: ball?.colour ?? DEFAULT_BALL.colour, age: ball?.age ?? DEFAULT_BALL.age };
}

const BALL_COLOURS: ReadonlySet<string> = new Set(['red', 'white']);
const BALL_AGES: ReadonlySet<string> = new Set(['new', 'worn']);
/** Whether a value is a legal BallCondition. */
export function isBallCondition(b: unknown): b is BallCondition {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  return typeof o.colour === 'string' && BALL_COLOURS.has(o.colour) && typeof o.age === 'string' && BALL_AGES.has(o.age);
}

/**
 * The length (m) at which a bouncer from this bowler, at this speed, line and seed, on this pitch, arrives at the
 * batter at `targetM`: a bracketed secant (Illinois) solve on the real flight, where arrival height rises smoothly
 * with the length. About six flights; to within a few millimetres of the target height.
 */
export function bouncerLength(plan: PracticeDeliveryPlan, bowler: BowlerProfile, conditions: PitchCondition, seed: string, targetM: number, ball?: BallCondition): number {
  const lo = BOUNCER_MIN_LENGTH_M;
  const hi = BUILD_LIMITS.pace.lengthM[1];
  const f = (L: number) => arrivalHeight({ ...plan, variation: 'bouncer', lengthM: L }, bowler, conditions, seed, ball) - targetM;
  let a = 9.5;
  let b = 11.5;
  let fa = f(a);
  let fb = f(b);
  if (fa > 0) {
    b = a;
    fb = fa;
    a = lo;
    fa = f(a);
    if (fa >= 0) return lo;
  } else if (fb < 0) {
    a = b;
    fa = fb;
    b = hi;
    fb = f(b);
    if (fb <= 0) return hi;
  }
  let side = 0;
  for (let i = 0; i < 12; i++) {
    const c = (a * fb - b * fa) / (fb - fa);
    const fc = f(c);
    if (Math.abs(fc) < 0.004 || b - a < 0.005) return round2(c);
    if (fc > 0) {
      b = c;
      fb = fc;
      if (side === -1) fa /= 2;
      side = -1;
    } else {
      a = c;
      fa = fc;
      if (side === 1) fb /= 2;
      side = 1;
    }
  }
  return round2((a + b) / 2);
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

function lengthRange(family: BowlerFamily, variation: DeliveryVariation): readonly [number, number] {
  const lim = BUILD_LIMITS[family].lengthM;
  if (family === 'spin') return lim;
  if (variation === 'bouncer') return [BOUNCER_MIN_LENGTH_M, lim[1]];
  if (variation === 'yorker') return [lim[0], YORKER_MAX_LENGTH];
  return PACE_OTHER_LENGTH_M;
}

/**
 * The honest stock-speed range (km/h) of a bowler at a difficulty: Beginner bowls the slower ranges, Club and Expert
 * the band's (pace) or the spin type's. The assistance level never changes the bowling.
 */
export function stockRangeFor(family: BowlerFamily, opts: { paceBand?: PaceBand; spinType?: SpinType; difficulty?: Difficulty }): readonly [number, number] {
  const beginner = opts.difficulty === 'beginner';
  if (family === 'pace') return beginner ? BEGINNER_PACE_KPH : PACE_BANDS_KPH[opts.paceBand ?? 'fast'];
  return beginner ? BEGINNER_SPIN_KPH : SPIN_STOCK_KPH[opts.spinType ?? 'finger'];
}

/**
 * The bowler's stock speed for a band (or spin type) at a difficulty: the middle of its honest range. `assist` is
 * accepted for old callers and ignored (assistance changes only the timing bands).
 */
export function stockKph(family: BowlerFamily, opts: { paceBand?: PaceBand; spinType?: SpinType; assist?: AssistLevel; difficulty?: Difficulty }): number {
  const r = stockRangeFor(family, opts);
  return (r[0] + r[1]) / 2;
}

/** Speed of a variation from the bowler's stock speed (km/h, one decimal). */
export function variationKph(family: BowlerFamily, variation: DeliveryVariation, stock: number): number {
  const spec = variationSpec(family, variation);
  const s = spec ? stock * spec.kphScale + spec.kphDelta : stock;
  const lim = SPEED_LIMITS_KPH[family];
  return round1(clamp(s, lim[0], lim[1]));
}

// ---------------------------------------------------------------------------------------------------------------
// Build an Over
// ---------------------------------------------------------------------------------------------------------------

/**
 * One delivery of a built over: the tapped target (clamped to the legal area, and to the right length for a bouncer
 * or a yorker) and the honest speed for the variation and band (Learn bowls slower).
 */
export function buildBall(opts: {
  family: BowlerFamily;
  target: { lineM: number; lengthM: number };
  variation: DeliveryVariation;
  paceBand?: PaceBand;
  spinType?: SpinType;
  assist?: AssistLevel;
  difficulty?: Difficulty;
}): PracticeDeliveryPlan {
  const { family, target, variation } = opts;
  if (!variationsFor(family, opts.spinType).includes(variation)) throw new Error(`practice: ${variation} is not a ${family}${opts.spinType ? ` (${opts.spinType})` : ''} delivery`);
  const lim = BUILD_LIMITS[family];
  const len = lengthRange(family, variation);
  return {
    variation,
    lengthM: round2(clamp(target.lengthM, len[0], len[1])),
    lineM: round2(clamp(target.lineM, lim.lineM[0], lim.lineM[1])),
    speedKph: variationKph(family, variation, stockKph(family, opts)),
  };
}

/** A bowler profile for a built over (the look is seeded so the same build shows the same bowler). */
export function bowlerFor(opts: { family: BowlerFamily; paceBand?: PaceBand; spinType?: SpinType; arm?: 'right' | 'left'; seed: string }): BowlerProfile {
  return opts.family === 'pace'
    ? { family: 'pace', paceBand: opts.paceBand ?? 'fast', arm: opts.arm ?? 'right', lookSeed: lookSeed(opts.seed) }
    : { family: 'spin', spinType: opts.spinType ?? 'finger', arm: opts.arm ?? 'right', lookSeed: lookSeed(opts.seed) };
}

const lookSeed = (seed: string) => sha256Hex(`vande-practice-look|${seed}`).slice(0, 16);

/** Seeded Fisher–Yates (the one shuffle of a built over, at lock-in). */
function shuffleWith<T>(rng: Sfc32, items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Lock a built over: six legal balls for one bowler, optionally shuffled once (seeded, so the same build and seed
 * shuffle the same way). Each bouncer's length is then solved against the flight on the innings' pitch so it arrives
 * between shoulder and head height (its tapped line is kept). The over's ball defaults to a new white ball. Throws
 * with the validation errors when the over is not legal.
 */
export function buildOver(opts: { bowler: BowlerProfile; balls: readonly PracticeDeliveryPlan[]; shuffle: boolean; seed: string; conditions?: PitchCondition; ball?: BallCondition }): PracticeOverPlan {
  if (opts.balls.length !== 6) throw new Error(`practice: a built over needs six balls, got ${opts.balls.length}`);
  const shuffled = opts.shuffle ? shuffleWith(rngFromKey(`vande-practice-shuffle|${opts.seed}`), opts.balls) : [...opts.balls];
  const conditions = opts.conditions ?? 'balanced';
  const ball = ballOf(opts.ball);
  const order = shuffled.map((b, i) =>
    b.variation === 'bouncer' && opts.bowler.family === 'pace' ? { ...b, lengthM: bouncerLength(b, opts.bowler, conditions, ballSeed({ seed: opts.seed }, i), BOUNCER_BUILT_TARGET_M, ball) } : b,
  );
  const plan: PracticeOverPlan = {
    version: PRACTICE_SIM_VERSION,
    bowler: opts.bowler,
    ball,
    balls: order.map((b) => ({ ...b })) as PracticeOverPlan['balls'],
    seed: opts.seed,
    source: 'built',
    ...(opts.shuffle ? { shuffled: true } : {}),
  };
  const v = validateOver(plan);
  if (!v.ok) throw new Error(`practice: illegal built over (${v.errors.join(', ')})`);
  return plan;
}

// ---------------------------------------------------------------------------------------------------------------
// The pitch map (Build an Over taps)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The pitch map the Build an Over screen draws: across, from the leg-side edge (u = 0) to the off-side edge (u = 1) of
 * the striker's own frame; up, from the striker's stumps (v = 0) to `lengthM[1]` metres down the pitch (v = 1).
 */
export const PITCH_MAP = { lineM: [-0.6, 0.8], lengthM: [0, 11] } as const;

export function targetFromTap(u: number, v: number, family: BowlerFamily): { lineM: number; lengthM: number } {
  const lim = BUILD_LIMITS[family];
  const line = PITCH_MAP.lineM[0] + clamp(u, 0, 1) * (PITCH_MAP.lineM[1] - PITCH_MAP.lineM[0]);
  const length = PITCH_MAP.lengthM[0] + clamp(v, 0, 1) * (PITCH_MAP.lengthM[1] - PITCH_MAP.lengthM[0]);
  return { lineM: round2(clamp(line, lim.lineM[0], lim.lineM[1])), lengthM: round2(clamp(length, lim.lengthM[0], lim.lengthM[1])) };
}

export function tapFromTarget(t: { lineM: number; lengthM: number }): { u: number; v: number } {
  return {
    u: (t.lineM - PITCH_MAP.lineM[0]) / (PITCH_MAP.lineM[1] - PITCH_MAP.lineM[0]),
    v: (t.lengthM - PITCH_MAP.lengthM[0]) / (PITCH_MAP.lengthM[1] - PITCH_MAP.lengthM[0]),
  };
}

export type LengthBand = 'yorker' | 'full' | 'good' | 'short' | 'bouncer';
export type LineBand = 'down_leg' | 'leg_stump' | 'middle' | 'off_stump' | 'outside_off' | 'wide_outside_off';

/** Plain-language length of a ball (spinners' lengths are fuller: the ball dips). */
export function lengthBand(lengthM: number, family: BowlerFamily): LengthBand {
  if (family === 'spin') return lengthM < 2.5 ? 'full' : lengthM <= 5 ? 'good' : 'short';
  if (lengthM <= YORKER_MAX_LENGTH) return 'yorker';
  if (lengthM < 4.5) return 'full';
  if (lengthM <= 7) return 'good';
  if (lengthM < BOUNCER_MIN_LENGTH_M + 0.5) return 'short';
  return 'bouncer';
}

/** Plain-language line at the stumps (striker's frame; stumps are ±0.114 m). */
export function lineBand(lineM: number): LineBand {
  if (lineM < -0.16) return 'down_leg';
  if (lineM < -0.06) return 'leg_stump';
  if (lineM <= 0.06) return 'middle';
  if (lineM <= 0.16) return 'off_stump';
  if (lineM <= 0.35) return 'outside_off';
  return 'wide_outside_off';
}

// ---------------------------------------------------------------------------------------------------------------
// Validation and seeds
// ---------------------------------------------------------------------------------------------------------------

/** Physics seed of ball i (0–5) of an over, derived from the over seed. */
export function ballSeed(over: Pick<PracticeOverPlan, 'seed'>, i: number): string {
  return sha256Hex(`vande-practice-ball|${over.seed}|${i}`).slice(0, 32);
}

export interface OverValidation {
  ok: boolean;
  errors: string[];
}

/** A legal Practice over: six legal balls, one bowler (one family) throughout, honest speeds, valid seed. */
export function validateOver(over: PracticeOverPlan): OverValidation {
  const errors: string[] = [];
  if (!over || typeof over !== 'object') return { ok: false, errors: ['not_an_over'] };
  if (over.version !== PRACTICE_SIM_VERSION) errors.push('version');
  if (typeof over.seed !== 'string' || over.seed.length === 0) errors.push('seed');
  if (over.source !== 'random' && over.source !== 'built' && over.source !== 'guided' && over.source !== 'reference') errors.push('source');
  if (!isBallCondition(over.ball)) errors.push('ball');
  const b = over.bowler;
  const family = b?.family;
  if (family !== 'pace' && family !== 'spin') return { ok: false, errors: [...errors, 'bowler_family'] };
  if (b.arm !== 'right' && b.arm !== 'left') errors.push('bowler_arm');
  if (typeof b.lookSeed !== 'string') errors.push('bowler_look');
  if (family === 'pace' && (!b.paceBand || !(b.paceBand in PACE_BANDS_KPH) || b.spinType !== undefined)) errors.push('pace_bowler_profile');
  if (family === 'spin' && (!b.spinType || !(b.spinType in SPIN_STOCK_KPH) || b.paceBand !== undefined)) errors.push('spin_bowler_profile');
  if (!Array.isArray(over.balls) || over.balls.length !== 6) return { ok: false, errors: [...errors, 'six_balls'] };
  const allowed = variationsFor(family, b.spinType);
  const lim = BUILD_LIMITS[family];
  const speeds = SPEED_LIMITS_KPH[family];
  let bouncers = 0;
  over.balls.forEach((ball, i) => {
    if (!ball || !allowed.includes(ball.variation)) {
      errors.push(`ball${i}:variation`);
      return;
    }
    if (ball.variation === 'bouncer') bouncers++;
    const len = lengthRange(family, ball.variation);
    if (!Number.isFinite(ball.lengthM) || ball.lengthM < len[0] - 1e-9 || ball.lengthM > len[1] + 1e-9) errors.push(`ball${i}:length`);
    if (!Number.isFinite(ball.lineM) || ball.lineM < lim.lineM[0] - 1e-9 || ball.lineM > lim.lineM[1] + 1e-9) errors.push(`ball${i}:line`);
    if (!Number.isFinite(ball.speedKph) || ball.speedKph < speeds[0] || ball.speedKph > speeds[1]) errors.push(`ball${i}:speed`);
  });
  if (bouncers > MAX_BOUNCERS) errors.push('too_many_bouncers');
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------------------------------------------
// Quick Random Over
// ---------------------------------------------------------------------------------------------------------------

/** Chance the random bowler is a spinner, by pitch. */
const SPIN_SHARE: Readonly<Record<PitchCondition, number>> = { balanced: 0.4, green: 0.25, hard: 0.25, turning: 0.65 };
/** Relative weights of the pace change-ups, by pitch (cutters grip on green and turning pitches, bouncers fly on hard ones). */
const PACE_CHANGE_WEIGHTS: Readonly<Record<PitchCondition, Partial<Record<PaceVariation, number>>>> = {
  balanced: { cutter: 1, slower: 1, bouncer: 1, yorker: 1 },
  green: { cutter: 1.5, slower: 0.7, bouncer: 0.7, yorker: 1 },
  hard: { cutter: 1, slower: 0.8, bouncer: 1.8, yorker: 1 },
  turning: { cutter: 1.5, slower: 1.3, bouncer: 0.6, yorker: 1 },
};
const EXTREMES: ReadonlySet<DeliveryVariation> = new Set<DeliveryVariation>(['bouncer', 'yorker']);

function weighted<T extends string>(rng: Sfc32, weights: Partial<Record<T, number>>, exclude: ReadonlySet<T> = new Set()): T | null {
  const items = (Object.keys(weights) as T[]).filter((k) => !exclude.has(k) && (weights[k] ?? 0) > 0).sort();
  const total = items.reduce((s, k) => s + (weights[k] ?? 0), 0);
  if (items.length === 0 || total <= 0) return null;
  let x = rng.float() * total;
  for (const k of items) {
    x -= weights[k] ?? 0;
    if (x < 0) return k;
  }
  return items[items.length - 1];
}

/** Generation level: the guided over, then the three difficulties (Beginner, Club = 'open', Expert). */
type Level = 'guided' | 'beginner' | 'open' | 'expert';

const LEVEL_OF: Readonly<Record<Difficulty, Level>> = { beginner: 'beginner', club: 'open', expert: 'expert' };

/**
 * Bowling quality by difficulty (never hidden randomness: the same seed and difficulty give the same over).
 *  - loose: the share of stock and movement balls that are bad balls (a half-volley, short and wide, on the pads,
 *    full and wide): Beginner bowls plenty to score from, Club some, Expert very few;
 *  - spread: the part of each variation's line and length range the bowler uses (Expert hits the channel);
 *  - bands: the pace bands (weights of controlled, fast, express) outside Learn, which is genuinely slower.
 */
export const DIFFICULTY_BOWLING: Readonly<Record<Difficulty, { loose: number; spread: number; bands: readonly [number, number, number] }>> = {
  beginner: { loose: 0.25, spread: 1, bands: [1, 0, 0] },
  club: { loose: 0.15, spread: 1, bands: [0.3, 0.5, 0.2] },
  expert: { loose: 0.04, spread: 0.6, bands: [0, 0.45, 0.55] },
};
const DIFFICULTY_OF: Readonly<Record<Level, Difficulty>> = { guided: 'beginner', beginner: 'beginner', open: 'club', expert: 'expert' };

/**
 * Where an Expert bowler pitches each variation (m from the striker's stumps): the corridor, a length too short to be
 * driven off a stride and too full to be punched off the back foot, with the swing ball a little fuller and the
 * slower ball dipping onto a full length. The spread (DIFFICULTY_BOWLING) is then the part of this range he uses.
 */
export const EXPERT_LENGTH_M: Readonly<Partial<Record<DeliveryVariation, readonly [number, number]>>> = {
  stock: [5.3, 6.6],
  outswing: [4.8, 5.8],
  inswing: [4.8, 5.8],
  seam: [5.4, 6.6],
  cutter: [5.6, 7],
  slower: [4.6, 5.6],
};

/** Bad balls, by family: where each kind pitches (m) and finishes (line at the stumps, m). All are legal. */
export const LOOSE_BALLS: Readonly<Record<BowlerFamily, ReadonlyArray<{ kind: 'half_volley' | 'short_wide' | 'on_pads' | 'wide_full'; lengthM: readonly [number, number]; lineM: readonly [number, number] }>>> = {
  pace: [
    { kind: 'half_volley', lengthM: [2.4, 3.4], lineM: [0, 0.22] },
    { kind: 'short_wide', lengthM: [7.4, 8], lineM: [0.36, 0.5] },
    { kind: 'on_pads', lengthM: [4.5, 6.5], lineM: [-0.28, -0.16] },
    { kind: 'wide_full', lengthM: [3, 4.5], lineM: [0.38, 0.5] },
  ],
  spin: [
    { kind: 'half_volley', lengthM: [1.6, 2.4], lineM: [0, 0.22] },
    { kind: 'short_wide', lengthM: [6, 7], lineM: [0.3, 0.5] },
    { kind: 'on_pads', lengthM: [3.5, 5], lineM: [-0.28, -0.16] },
    { kind: 'wide_full', lengthM: [2.6, 4], lineM: [0.38, 0.5] },
  ],
};

/** Constraints on the order of a generated over (all levels: at most one bouncer; beginners: a readable sequence). */
export function fairSequence(vs: readonly DeliveryVariation[], family: BowlerFamily, beginner: boolean): boolean {
  if (vs.filter((v) => v === 'bouncer').length > 1) return false;
  if (!beginner) return true;
  const kind = (v: DeliveryVariation) => variationSpec(family, v)?.kind ?? 'stock';
  if (vs[0] !== 'stock') return false;
  for (let i = 1; i < vs.length; i++) if (kind(vs[i]) === 'change' && kind(vs[i - 1]) === 'change') return false;
  if (vs.filter((v) => EXTREMES.has(v)).length > 1) return false;
  return true;
}

function composition(rng: Sfc32, family: BowlerFamily, spinType: SpinType | undefined, conditions: PitchCondition, level: Level): DeliveryVariation[] {
  const out: DeliveryVariation[] = [];
  if (family === 'pace') {
    const natural: PaceVariation = rng.float() < 0.55 ? 'outswing' : 'inswing';
    const nChange = level === 'guided' ? 0 : level === 'beginner' ? 1 : level === 'expert' ? 2 : rng.float() < 0.5 ? 2 : 1;
    const nMove = level === 'guided' ? 1 : conditions === 'green' || level === 'expert' ? 2 : rng.float() < 0.4 ? 2 : 1;
    const used = new Set<PaceVariation>();
    for (let i = 0; i < nChange; i++) {
      const exclude = new Set<PaceVariation>(used);
      if (level === 'beginner' && out.some((v) => EXTREMES.has(v))) {
        exclude.add('bouncer');
        exclude.add('yorker');
      }
      // A beginner is never bounced.
      if (level === 'guided' || level === 'beginner') exclude.add('bouncer');
      const v = weighted(rng, PACE_CHANGE_WEIGHTS[conditions], exclude);
      if (!v) break;
      used.add(v);
      out.push(v);
    }
    const movePool: PaceVariation[] = conditions === 'green' || conditions === 'hard' ? [natural, 'seam'] : [natural, natural, 'seam'];
    for (let i = 0; i < nMove; i++) out.push(level === 'guided' ? natural : rng.pick(movePool));
  } else {
    const type = spinType ?? 'finger';
    const changes: SpinVariation[] = type === 'finger' ? ['arm_ball', 'wrong_un'] : ['topspinner', 'wrong_un'];
    // A beginner is not shown the ball that turns the other way.
    const pool = level === 'guided' || level === 'beginner' ? changes.filter((v) => v !== 'wrong_un') : changes;
    const nChange = level === 'guided' ? 0 : level === 'beginner' ? 1 : level === 'expert' ? 2 : rng.float() < 0.4 ? 2 : 1;
    const nMove = level === 'guided' ? 1 : level === 'expert' || rng.float() < 0.5 ? 2 : 1;
    const used = new Set<SpinVariation>();
    for (let i = 0; i < nChange; i++) {
      const left = pool.filter((v) => !used.has(v));
      if (left.length === 0) break;
      const v = rng.pick(left);
      used.add(v);
      out.push(v);
    }
    for (let i = 0; i < nMove; i++) out.push(level === 'guided' ? 'flighted' : rng.pick<SpinVariation>(['flighted', 'quicker']));
  }
  while (out.length < 6) out.push('stock');
  return out;
}

function arrange(rng: Sfc32, vs: DeliveryVariation[], family: BowlerFamily, beginner: boolean): DeliveryVariation[] {
  for (let attempt = 0; attempt < 64; attempt++) {
    const s = shuffleWith(rng, vs);
    if (fairSequence(s, family, beginner)) return s;
  }
  // Constructive fallback: stock first, change-ups spread out, the rest in between.
  const kind = (v: DeliveryVariation) => variationSpec(family, v)?.kind ?? 'stock';
  const changes = vs.filter((v) => kind(v) === 'change');
  const others = vs.filter((v) => kind(v) !== 'change').sort((a, b) => (a === 'stock' ? -1 : b === 'stock' ? 1 : 0));
  const slots: DeliveryVariation[] = [];
  const at = new Set(changes.length === 1 ? [3] : [2, 4]);
  for (let i = 0; i < 6; i++) slots.push(at.has(i) && changes.length ? changes.shift()! : (others.shift() ?? changes.shift() ?? 'stock'));
  return slots;
}

function lerp(r: readonly [number, number], u: number): number {
  return r[0] + (r[1] - r[0]) * u;
}

/** One over at a generation level. The assistance level is not an input: it changes only the timing bands. */
function generateOver(opts: { seed: string; conditions: PitchCondition; family?: BowlerFamily; level: Level; source: PracticeOverPlan['source']; ball?: BallCondition }): PracticeOverPlan {
  const { seed, conditions, level } = opts;
  const ball = ballOf(opts.ball);
  const rng = rngFromKey(`vande-practice-over|${PRACTICE_SIM_VERSION}|${level}|${seed}`);
  const familyDraw = rng.float();
  const family: BowlerFamily = opts.family ?? (familyDraw < SPIN_SHARE[conditions] ? 'spin' : 'pace');
  const beginner = level === 'guided' || level === 'beginner';
  const quality = DIFFICULTY_BOWLING[DIFFICULTY_OF[level]];
  const armDraw = rng.float();
  const arm: 'right' | 'left' = beginner || armDraw < 0.8 ? 'right' : 'left';
  let bowler: BowlerProfile;
  let stockRange: readonly [number, number];
  if (family === 'pace') {
    const u = rng.float();
    const w = quality.bands;
    const paceBand: PaceBand = u < w[0] ? 'controlled' : u < w[0] + w[1] ? 'fast' : 'express';
    bowler = { family, paceBand, arm, lookSeed: lookSeed(seed) };
    stockRange = stockRangeFor('pace', { paceBand, difficulty: DIFFICULTY_OF[level] });
  } else {
    const spinType: SpinType = rng.float() < 0.55 ? 'finger' : 'wrist';
    bowler = { family, spinType, arm, lookSeed: lookSeed(seed) };
    stockRange = stockRangeFor('spin', { spinType, difficulty: DIFFICULTY_OF[level] });
  }
  const stock = lerp(stockRange, rng.float());
  const vs = arrange(rng, composition(rng, family, bowler.spinType, conditions, level), family, beginner);
  const lim = BUILD_LIMITS[family];
  const looseKinds = LOOSE_BALLS[family];
  const balls = vs.map((variation, i): PracticeDeliveryPlan => {
    const spec = variationSpec(family, variation)!;
    const len = lengthRange(family, variation);
    // The bowler's accuracy: Expert uses the middle of each range (the channel), the others all of it.
    const within = (u: number) => 0.5 + (u - 0.5) * quality.spread;
    const lengths = (level === 'expert' && family === 'pace' ? EXPERT_LENGTH_M[variation] : undefined) ?? spec.lengthM;
    let lengthM = round2(clamp(lerp(lengths, within(rng.float())), len[0], len[1]));
    let lineM = round2(clamp(lerp(spec.lineM, within(rng.float())), lim.lineM[0], lim.lineM[1]));
    // A bad ball now and then (stock and movement balls only): where it pitches and finishes, still legal.
    if (spec.kind !== 'change' && level !== 'guided' && rng.float() < quality.loose) {
      const lb = looseKinds[Math.min(looseKinds.length - 1, Math.floor(rng.float() * looseKinds.length))];
      lengthM = round2(clamp(lerp(lb.lengthM, rng.float()), len[0], len[1]));
      lineM = round2(clamp(lerp(lb.lineM, rng.float()), lim.lineM[0], lim.lineM[1]));
    }
    const jitter = (rng.float() - 0.5) * 2;
    const speeds = SPEED_LIMITS_KPH[family];
    const speedKph = round1(clamp(stock * spec.kphScale + spec.kphDelta + jitter, speeds[0], speeds[1]));
    const heightU = rng.float();
    if (variation !== 'bouncer') return { variation, lengthM, lineM, speedKph };
    // A real bouncer: its length is whatever makes it arrive between shoulder and head on this pitch.
    const target = lerp(BOUNCER_TARGET_M, heightU);
    return { variation, lengthM: bouncerLength({ variation, lengthM, lineM, speedKph }, bowler, conditions, ballSeed({ seed }, i), target, ball), lineM, speedKph };
  }) as PracticeOverPlan['balls'];
  return { version: PRACTICE_SIM_VERSION, bowler, ball, balls, seed, source: opts.source };
}

/**
 * The Quick Random Over: six unknown, legal, fixed deliveries from one bowler, balanced like a real over (mostly the
 * stock ball and the bowler's natural movement, with one or two change-ups) rather than six extremes. A beginner's
 * over opens with a stock ball, never puts two change-ups back to back, bowls at most one bouncer or yorker, and (in
 * Learn) leaves out the spinner's wrong'un and the bouncer. A bouncer's length is solved against the flight so it
 * really arrives between shoulder and head height on the pitch. The ball is a new white one unless the setup chooses
 * another.
 *
 * Difficulty (DIFFICULTY_BOWLING) is better bowling, never hidden randomness: Beginner bowls more bad balls to score
 * from and the readable sequence above; Club a realistic mix; Expert hits the channel, bowls two change-ups and two
 * movement balls, rarely a bad ball, and quicker. Without `difficulty`, `beginner` chooses Beginner or Club.
 * Deterministic in its inputs.
 */
export function randomOver(opts: { seed: string; conditions: PitchCondition; assist: AssistLevel; family?: BowlerFamily; beginner?: boolean; difficulty?: Difficulty; ball?: BallCondition }): PracticeOverPlan {
  const level: Level = opts.difficulty ? LEVEL_OF[opts.difficulty] : opts.beginner ? 'beginner' : 'open';
  return generateOver({ seed: opts.seed, conditions: opts.conditions, family: opts.family, level, source: 'random', ball: opts.ball });
}

/**
 * The first-time experience: a separate, non-scoring warm-up (one readable stock ball, just outside off stump on a
 * good length, at Learn pace), then the guided six-ball over that counts (Learn pace bowler, balanced pitch, stock
 * balls and his natural swing only, source 'guided').
 */
export function guidedStart(seed: string, ball?: BallCondition): { warmup: { bowler: BowlerProfile; plan: PracticeDeliveryPlan; seed: string }; over: PracticeOverPlan } {
  const over = generateOver({ seed, conditions: 'balanced', family: 'pace', level: 'guided', source: 'guided', ball });
  const plan: PracticeDeliveryPlan = { variation: 'stock', lengthM: 5.8, lineM: 0.15, speedKph: variationKph('pace', 'stock', stockKph('pace', { difficulty: 'beginner' })) };
  return { warmup: { bowler: over.bowler, plan, seed: sha256Hex(`vande-practice-warmup|${seed}`).slice(0, 32) }, over };
}
