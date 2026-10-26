/**
 * Practice overs: the seeded Quick Random Over, the guided first over, and the Build an Over helpers. One bowler
 * family bowls the whole over, all six balls are fixed before the first is bowled, and every ball is legal: Practice
 * bowls no wides and no no-balls (docs/PRACTICE_RULES.md, "Wides and no-balls"), so all six count.
 *
 * Randomness comes only from the shared seeded generator (src/engine/prng.ts, SHA-256 keyed), so a seed always gives
 * the same over, and each ball's physics seed is derived from the over seed (`ballSeed`).
 *
 * Speeds are honest: the km/h stored here is the release speed the physics bowls and the screen shows. Learn bowls
 * genuinely slower (pace about 100–114 km/h, spin at the bottom of the physics' spin range) rather than relabelling a
 * slow ball as fast.
 */
import {
  PRACTICE_SIM_VERSION,
  type AssistLevel,
  type BowlerFamily,
  type BowlerProfile,
  type DeliveryVariation,
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
import { BODY, PACE_BANDS_KPH, PACE_KPH, SPIN_KPH, YORKER_MAX_LENGTH } from '@/physics/constants';
import { flight, flightMovement } from '@/physics/delivery';

// ---------------------------------------------------------------------------------------------------------------
// Speeds (km/h, real)
// ---------------------------------------------------------------------------------------------------------------

// The pace bowler's stock-ball bands (controlled, fast, express) and the ranges of pace and spin speeds are the
// physics' own (src/physics/constants.ts PACE_BANDS_KPH, PACE_KPH, SPIN_KPH): a plan never asks for a speed the
// physics does not model.

/** Learn assistance: a genuinely slower pace bowler (shown at its true speed). */
export const LEARN_PACE_KPH = [100, 114] as const;
/** Stock speeds of the two kinds of spinner (inside SPIN_KPH), and Learn's slower spinner (its bottom). */
export const SPIN_STOCK_KPH: Readonly<Record<SpinType, readonly [number, number]>> = { finger: [80, 90], wrist: [76, 86] };
export const LEARN_SPIN_KPH = [SPIN_KPH[0], SPIN_KPH[0] + 3] as const;

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

/** Height at the batter of a delivery (from the one flight model). */
export function arrivalHeight(plan: PracticeDeliveryPlan, bowler: BowlerProfile, conditions: PitchCondition, seed: string): number {
  return flightMovement(flight({ plan, bowler, conditions, seed })).heightAtBatM;
}

/**
 * The length (m) at which a bouncer from this bowler, at this speed, line and seed, on this pitch, arrives at the
 * batter at `targetM`: a bracketed secant (Illinois) solve on the real flight, where arrival height rises smoothly
 * with the length. About six flights; to within a few millimetres of the target height.
 */
export function bouncerLength(plan: PracticeDeliveryPlan, bowler: BowlerProfile, conditions: PitchCondition, seed: string, targetM: number): number {
  const lo = BOUNCER_MIN_LENGTH_M;
  const hi = BUILD_LIMITS.pace.lengthM[1];
  const f = (L: number) => arrivalHeight({ ...plan, variation: 'bouncer', lengthM: L }, bowler, conditions, seed) - targetM;
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

/** The bowler's stock speed for a band (or spin type) at an assistance level: the middle of its honest range. */
export function stockKph(family: BowlerFamily, opts: { paceBand?: PaceBand; spinType?: SpinType; assist?: AssistLevel }): number {
  const r = family === 'pace' ? (opts.assist === 'learn' ? LEARN_PACE_KPH : PACE_BANDS_KPH[opts.paceBand ?? 'fast']) : opts.assist === 'learn' ? LEARN_SPIN_KPH : SPIN_STOCK_KPH[opts.spinType ?? 'finger'];
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
 * between shoulder and head height (its tapped line is kept). Throws with the validation errors when the over is not
 * legal.
 */
export function buildOver(opts: { bowler: BowlerProfile; balls: readonly PracticeDeliveryPlan[]; shuffle: boolean; seed: string; conditions?: PitchCondition }): PracticeOverPlan {
  if (opts.balls.length !== 6) throw new Error(`practice: a built over needs six balls, got ${opts.balls.length}`);
  const shuffled = opts.shuffle ? shuffleWith(rngFromKey(`vande-practice-shuffle|${opts.seed}`), opts.balls) : [...opts.balls];
  const conditions = opts.conditions ?? 'balanced';
  const order = shuffled.map((b, i) =>
    b.variation === 'bouncer' && opts.bowler.family === 'pace' ? { ...b, lengthM: bouncerLength(b, opts.bowler, conditions, ballSeed({ seed: opts.seed }, i), BOUNCER_BUILT_TARGET_M) } : b,
  );
  const plan: PracticeOverPlan = {
    version: PRACTICE_SIM_VERSION,
    bowler: opts.bowler,
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
  if (over.source !== 'random' && over.source !== 'built' && over.source !== 'guided') errors.push('source');
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

type Level = 'guided' | 'beginner' | 'open';

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

function composition(rng: Sfc32, family: BowlerFamily, spinType: SpinType | undefined, conditions: PitchCondition, assist: AssistLevel, level: Level): DeliveryVariation[] {
  const out: DeliveryVariation[] = [];
  if (family === 'pace') {
    const natural: PaceVariation = rng.float() < 0.55 ? 'outswing' : 'inswing';
    const nChange = level === 'guided' ? 0 : level === 'beginner' ? 1 : rng.float() < 0.5 ? 2 : 1;
    const nMove = level === 'guided' ? 1 : conditions === 'green' ? 2 : rng.float() < 0.4 ? 2 : 1;
    const used = new Set<PaceVariation>();
    for (let i = 0; i < nChange; i++) {
      const exclude = new Set<PaceVariation>(used);
      if (level === 'beginner' && out.some((v) => EXTREMES.has(v))) {
        exclude.add('bouncer');
        exclude.add('yorker');
      }
      // A complete beginner in Learn is not bounced.
      if (level !== 'open' && assist === 'learn') exclude.add('bouncer');
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
    // A complete beginner in Learn is not shown the ball that turns the other way.
    const pool = level !== 'open' && assist === 'learn' ? changes.filter((v) => v !== 'wrong_un') : changes;
    const nChange = level === 'guided' ? 0 : level === 'beginner' ? 1 : rng.float() < 0.4 ? 2 : 1;
    const nMove = level === 'guided' ? 1 : rng.float() < 0.5 ? 2 : 1;
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

function generateOver(opts: { seed: string; conditions: PitchCondition; assist: AssistLevel; family?: BowlerFamily; level: Level; source: PracticeOverPlan['source'] }): PracticeOverPlan {
  const { seed, conditions, assist, level } = opts;
  const rng = rngFromKey(`vande-practice-over|${PRACTICE_SIM_VERSION}|${level}|${seed}`);
  const familyDraw = rng.float();
  const family: BowlerFamily = opts.family ?? (familyDraw < SPIN_SHARE[conditions] ? 'spin' : 'pace');
  const beginner = level !== 'open';
  const armDraw = rng.float();
  const arm: 'right' | 'left' = beginner || armDraw < 0.8 ? 'right' : 'left';
  let bowler: BowlerProfile;
  let stockRange: readonly [number, number];
  if (family === 'pace') {
    const u = rng.float();
    const paceBand: PaceBand =
      assist === 'learn' ? 'controlled' : assist === 'play' ? (beginner ? (u < 0.55 ? 'controlled' : 'fast') : u < 0.3 ? 'controlled' : u < 0.8 ? 'fast' : 'express') : u < 0.15 ? 'controlled' : u < 0.6 ? 'fast' : 'express';
    bowler = { family, paceBand, arm, lookSeed: lookSeed(seed) };
    stockRange = assist === 'learn' ? LEARN_PACE_KPH : PACE_BANDS_KPH[paceBand];
  } else {
    const spinType: SpinType = rng.float() < 0.55 ? 'finger' : 'wrist';
    bowler = { family, spinType, arm, lookSeed: lookSeed(seed) };
    stockRange = assist === 'learn' ? LEARN_SPIN_KPH : SPIN_STOCK_KPH[spinType];
  }
  const stock = lerp(stockRange, rng.float());
  const vs = arrange(rng, composition(rng, family, bowler.spinType, conditions, assist, level), family, beginner);
  const lim = BUILD_LIMITS[family];
  const balls = vs.map((variation, i): PracticeDeliveryPlan => {
    const spec = variationSpec(family, variation)!;
    const len = lengthRange(family, variation);
    const lengthM = round2(clamp(lerp(spec.lengthM, rng.float()), len[0], len[1]));
    const lineM = round2(clamp(lerp(spec.lineM, rng.float()), lim.lineM[0], lim.lineM[1]));
    const jitter = (rng.float() - 0.5) * 2;
    const speeds = SPEED_LIMITS_KPH[family];
    const speedKph = round1(clamp(stock * spec.kphScale + spec.kphDelta + jitter, speeds[0], speeds[1]));
    const heightU = rng.float();
    if (variation !== 'bouncer') return { variation, lengthM, lineM, speedKph };
    // A real bouncer: its length is whatever makes it arrive between shoulder and head on this pitch.
    const target = lerp(BOUNCER_TARGET_M, heightU);
    return { variation, lengthM: bouncerLength({ variation, lengthM, lineM, speedKph }, bowler, conditions, ballSeed({ seed }, i), target), lineM, speedKph };
  }) as PracticeOverPlan['balls'];
  return { version: PRACTICE_SIM_VERSION, bowler, balls, seed, source: opts.source };
}

/**
 * The Quick Random Over: six unknown, legal, fixed deliveries from one bowler, balanced like a real over (mostly the
 * stock ball and the bowler's natural movement, with one or two change-ups) rather than six extremes. A beginner's
 * over opens with a stock ball, never puts two change-ups back to back, bowls at most one bouncer or yorker, and (in
 * Learn) leaves out the spinner's wrong'un and the bouncer. A bouncer's length is solved against the flight so it
 * really arrives between shoulder and head height on the pitch. Deterministic in its inputs.
 */
export function randomOver(opts: { seed: string; conditions: PitchCondition; assist: AssistLevel; family?: BowlerFamily; beginner: boolean }): PracticeOverPlan {
  return generateOver({ ...opts, level: opts.beginner ? 'beginner' : 'open', source: 'random' });
}

/**
 * The first-time experience: a separate, non-scoring warm-up (one readable stock ball, just outside off stump on a
 * good length, at Learn pace), then the guided six-ball over that counts (Learn pace bowler, balanced pitch, stock
 * balls and his natural swing only, source 'guided').
 */
export function guidedStart(seed: string): { warmup: { bowler: BowlerProfile; plan: PracticeDeliveryPlan; seed: string }; over: PracticeOverPlan } {
  const over = generateOver({ seed, conditions: 'balanced', assist: 'learn', family: 'pace', level: 'guided', source: 'guided' });
  const plan: PracticeDeliveryPlan = { variation: 'stock', lengthM: 5.8, lineM: 0.15, speedKph: variationKph('pace', 'stock', stockKph('pace', { assist: 'learn' })) };
  return { warmup: { bowler: over.bowler, plan, seed: sha256Hex(`vande-practice-warmup|${seed}`).slice(0, 32) }, over };
}
