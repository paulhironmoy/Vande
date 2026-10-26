/**
 * Sealed Six rules, engine version 1 — every number in one place. Each value is explained in docs/GAME_RULES.md and
 * justified by the balance simulation (scripts/simulate-balance.mjs). Changing any value that can alter an outcome
 * requires a new engine version (copy v1 to v2); v1 must stay byte-for-byte stable so old replays keep verifying.
 *
 * Sign convention for every outcome factor: positive helps the BATTER, negative helps the BOWLER.
 */
import type {
  DeliveryFamily,
  DeliveryVariant,
  FieldSetting,
  FieldZone,
  Intensity,
  Intent,
  Length,
  Line,
  PitchId,
  ShotType,
  TimingGrade,
  WeatherId,
} from '@/contracts';

/** The engine version these rules implement (recorded in every replay they produce). */
export const RULES_VERSION = 1;

export const VARIANTS: readonly DeliveryVariant[] = ['yorker', 'good_length', 'bouncer', 'slower', 'inswing', 'outswing', 'offspin', 'legspin'];
export const LINES: readonly Line[] = ['wide_off', 'off', 'middle', 'leg'];
export const LENGTHS: readonly Length[] = ['full', 'good', 'short'];
export const INTENSITIES: readonly Intensity[] = [1, 2, 3];
export const INTENTS: readonly Intent[] = ['attack', 'contain', 'setup'];
export const FIELD_SETTINGS: readonly FieldSetting[] = ['attacking', 'balanced', 'sweeper'];
export const SHOTS: readonly ShotType[] = ['defend', 'rotate', 'drive', 'cut_pull', 'sweep', 'loft', 'leave'];
export const PITCHES: readonly PitchId[] = ['green', 'hard', 'slow'];
export const WEATHERS: readonly WeatherId[] = ['clear', 'humid', 'dew'];
export const POINTERS = ['touch', 'mouse', 'pen', 'keyboard'] as const;
/** Swipe sectors, clockwise from straight up the screen (towards the bowler), 45 degrees each. */
export const SECTOR_ZONES: readonly FieldZone[] = ['mid_off', 'cover', 'point', 'third_man', 'fine_leg', 'square_leg', 'midwicket', 'mid_on'];
export const OFF_SIDE_ZONES: readonly FieldZone[] = ['third_man', 'point', 'cover', 'mid_off'];

export const FAMILY: Record<DeliveryVariant, DeliveryFamily> = {
  yorker: 'pace',
  good_length: 'pace',
  bouncer: 'pace',
  slower: 'pace',
  inswing: 'swing',
  outswing: 'swing',
  offspin: 'spin',
  legspin: 'spin',
};

/** Yorker is always full, Bouncer always short; every other delivery chooses its length. */
export const ALLOWED_LENGTHS: Record<DeliveryVariant, readonly Length[]> = {
  yorker: ['full'],
  good_length: ['full', 'good', 'short'],
  bouncer: ['short'],
  slower: ['full', 'good', 'short'],
  inswing: ['full', 'good', 'short'],
  outswing: ['full', 'good', 'short'],
  offspin: ['full', 'good', 'short'],
  legspin: ['full', 'good', 'short'],
};

/** Available from the first match; the rest unlock through achievements (variety, never power). */
export const STARTER_VARIANTS: readonly DeliveryVariant[] = ['good_length', 'yorker', 'bouncer', 'offspin'];

// ---------------------------------------------------------------------------------------------------------------
// Energy
// ---------------------------------------------------------------------------------------------------------------

/**
 * Energy = base + (intensity − 1), priced by strength (simulation: equal best-response value per energy). Stock seam
 * and spin are cheap; the yorker is the premium weapon.
 */
export const ENERGY_BASE: Record<DeliveryVariant, number> = {
  good_length: 1,
  offspin: 1,
  legspin: 1,
  bouncer: 2,
  slower: 2,
  inswing: 2,
  outswing: 2,
  yorker: 3,
};
/** Six main deliveries must fit this budget (the strongest ball, an express yorker, costs 5: six would need 30). */
export const OVER_ENERGY_BUDGET = 15;
/** The precommitted Super Ball has its own allowance (any delivery costing at most this). */
export const SUPER_BALL_ALLOWANCE = 3;

// ---------------------------------------------------------------------------------------------------------------
// Gestures
// ---------------------------------------------------------------------------------------------------------------

export const MAX_SAMPLES = 120;
/** Release meter: needle 0→100 % over fillMs after the press; sweet spot at sweetMs. */
export const METER = {
  fillMs: 1000,
  sweetMs: 800,
  /** Quality falls linearly: 1 − |release − sweet| / falloffMs. */
  falloffMs: 160,
  perfectQuality: 0.85,
  goodQuality: 0.5,
  minHoldMs: 40,
  maxHoldMs: 1500,
} as const;
/** Teleport: faster than this many surface units per ms between two samples (3 surface widths per 100 ms). */
export const TELEPORT_UNITS_PER_MS = 0.03;
/** Interval floor used for the teleport test so that sub-millisecond coalesced events are not over-penalised. */
export const TELEPORT_MIN_DT_MS = 4;
export const MAX_BAT_TRACE_MS = 4000;
/** Robotic: at least this many samples with zero interval jitter and perfectly linear motion. */
export const ROBOTIC_MIN_SAMPLES = 6;
/** A plan whose releases land within ±this of the sweet spot six or more times out of seven is superhuman. */
export const SUPERHUMAN_MS = 2;
export const SUPERHUMAN_COUNT = 6;
/** Identical traces with at least this many samples in one plan are copy-paste, not human. */
export const DUPLICATE_MIN_SAMPLES = 4;
/** Swipes at least this long (surface units) must agree with the chosen zone within one sector. */
export const MIN_SWIPE = 0.06;
/** A tap may come at most this long after the ideal contact moment (later taps are not shots). */
export const LATE_LIMIT_MS = 600;
/** clientElapsedMs bound (ten minutes). The server enforces its own, tighter answer window. */
export const MAX_CLIENT_ELAPSED_MS = 600_000;

// ---------------------------------------------------------------------------------------------------------------
// Delivery physics (presentation and timing windows)
// ---------------------------------------------------------------------------------------------------------------

/** Release speed in km/h by intensity 1, 2, 3. */
export const SPEED_KPH: Record<DeliveryVariant, readonly [number, number, number]> = {
  yorker: [128, 138, 147],
  good_length: [126, 136, 145],
  bouncer: [129, 139, 148],
  slower: [100, 108, 115],
  inswing: [118, 128, 137],
  outswing: [118, 128, 137],
  offspin: [78, 85, 93],
  legspin: [76, 83, 91],
};
/** Metres from release to the contact point. */
export const FLIGHT_DISTANCE_M = 17.7;
/** Average-speed loss through the air and off the pitch. */
export const DRAG: Record<DeliveryFamily, number> = { pace: 1.1, swing: 1.1, spin: 1.16 };
export const LENGTH_TIME: Record<Length, number> = { full: 0.98, good: 1, short: 1.05 };
export const VARIANT_TIME: Partial<Record<DeliveryVariant, number>> = { yorker: 0.99, bouncer: 1.02 };
export const PITCH_TIME: Record<PitchId, number> = { green: 1, hard: 0.96, slow: 1.06 };
export const WEATHER_TIME: Record<WeatherId, number> = { clear: 1, humid: 1, dew: 0.98 };

/** Half-width of the perfect window (ms) by family, before multipliers. good = perfect × GOOD_MULT, edge = good × EDGE_MULT. */
export const PERFECT_MS: Record<DeliveryFamily, number> = { pace: 30, swing: 32, spin: 34 };
export const INTENSITY_WINDOW: Record<Intensity, number> = { 1: 1.1, 2: 1, 3: 0.88 };
export const VARIANT_WINDOW: Partial<Record<DeliveryVariant, number>> = { yorker: 0.9, slower: 0.95, bouncer: 0.95 };
export const PITCH_WINDOW: Record<PitchId, number> = { green: 1, hard: 0.95, slow: 0.85 };
export const WEATHER_WINDOW: Record<WeatherId, number> = { clear: 1, humid: 1, dew: 1.05 };
export const GOOD_MULT = 2.6;
export const EDGE_MULT = 2;

/** Bounce point, metres from the bowler's stumps (batter's stumps at 20.12). */
export const BOUNCE_AT: Record<DeliveryFamily, Record<Length, number>> = {
  pace: { full: 16.4, good: 13.6, short: 10.8 },
  swing: { full: 16.6, good: 13.8, short: 11 },
  spin: { full: 16.8, good: 15, short: 12.8 },
};
export const YORKER_BOUNCE_AT = 18.7;
export const BOUNCER_BOUNCE_AT = 9.6;
/** Lateral position at the batter, metres from middle stump (+ = off side of a right-hander). */
export const LINE_AT_BAT: Record<Line, number> = { wide_off: 0.42, off: 0.12, middle: 0, leg: -0.12 };
export const HEIGHT_AT_BAT: Record<DeliveryFamily, Record<Length, number>> = {
  pace: { full: 0.4, good: 0.78, short: 1.15 },
  swing: { full: 0.4, good: 0.75, short: 1.1 },
  spin: { full: 0.45, good: 0.7, short: 0.95 },
};
export const YORKER_HEIGHT = 0.12;
export const BOUNCER_HEIGHT = 1.6;
export const PITCH_BOUNCE: Record<PitchId, number> = { green: 1, hard: 1.12, slow: 0.88 };
export const SWING_M: Partial<Record<DeliveryVariant, number>> = { inswing: -0.3, outswing: 0.3, yorker: -0.05, slower: 0.03, offspin: 0.04, legspin: -0.05 };
export const SWING_PITCH: Record<PitchId, number> = { green: 1.25, hard: 0.9, slow: 0.8 };
export const SWING_WEATHER: Record<WeatherId, number> = { clear: 1, humid: 1.25, dew: 0.85 };
export const TURN_M: Partial<Record<DeliveryVariant, number>> = { offspin: -0.2, legspin: 0.24 };
export const TURN_PITCH: Record<PitchId, number> = { green: 0.7, hard: 0.9, slow: 1.6 };
export const TURN_WEATHER: Record<WeatherId, number> = { clear: 1, humid: 1, dew: 0.75 };
export const SPIN_TURN_INTENSITY: Record<Intensity, number> = { 1: 1.25, 2: 1, 3: 0.6 };

// ---------------------------------------------------------------------------------------------------------------
// Outcome model
// ---------------------------------------------------------------------------------------------------------------

export type AttackShot = Exclude<ShotType, 'leave'>;
type ShotRow = Record<AttackShot, number>;

/** Shot vs length (front-foot shots like full balls, back-foot shots like short ones). */
export const LEN_SHOT: Record<Length, ShotRow> = {
  full: { defend: 0.2, rotate: 0.15, drive: 0.45, cut_pull: -0.6, sweep: 0.3, loft: 0.4 },
  good: { defend: 0.35, rotate: 0.25, drive: 0.05, cut_pull: -0.1, sweep: 0, loft: -0.3 },
  short: { defend: 0.05, rotate: 0.1, drive: -0.6, cut_pull: 0.55, sweep: -0.6, loft: 0.15 },
};
/** Shot vs the delivery's own character. */
export const VAR_SHOT: Record<DeliveryVariant, ShotRow> = {
  yorker: { defend: -0.05, rotate: 0, drive: -0.5, cut_pull: -0.4, sweep: -0.55, loft: -0.7 },
  good_length: { defend: 0, rotate: 0, drive: 0, cut_pull: 0, sweep: 0, loft: 0 },
  bouncer: { defend: -0.3, rotate: -0.3, drive: -0.4, cut_pull: -0.3, sweep: -0.4, loft: -0.05 },
  slower: { defend: 0.05, rotate: 0.05, drive: -0.15, cut_pull: -0.1, sweep: 0, loft: -0.25 },
  inswing: { defend: 0, rotate: 0.05, drive: 0, cut_pull: -0.15, sweep: -0.15, loft: -0.05 },
  outswing: { defend: -0.05, rotate: 0, drive: -0.15, cut_pull: 0.05, sweep: -0.15, loft: -0.1 },
  offspin: { defend: 0, rotate: 0, drive: -0.05, cut_pull: -0.25, sweep: 0.05, loft: -0.05 },
  legspin: { defend: -0.05, rotate: -0.05, drive: -0.1, cut_pull: 0.05, sweep: -0.15, loft: -0.05 },
};
/** Shot vs line. */
export const LINE_SHOT: Record<Line, ShotRow> = {
  wide_off: { defend: -0.15, rotate: -0.1, drive: 0.05, cut_pull: 0.2, sweep: -0.35, loft: -0.15 },
  off: { defend: 0.1, rotate: 0, drive: 0.15, cut_pull: 0, sweep: -0.1, loft: 0 },
  middle: { defend: 0.15, rotate: 0.05, drive: 0.05, cut_pull: -0.1, sweep: 0, loft: 0.05 },
  leg: { defend: -0.05, rotate: 0.15, drive: -0.05, cut_pull: 0.1, sweep: 0.15, loft: 0.05 },
};
/** Express pace leaves less time; flighted spin invites footwork, flat spin smothers sweeps. */
export const INTENSITY_SHOT: Record<'pace' | 'spin', Record<Intensity, ShotRow>> = {
  pace: {
    1: { defend: 0.05, rotate: 0.1, drive: 0.12, cut_pull: 0.12, sweep: 0.12, loft: 0.12 },
    2: { defend: 0, rotate: 0, drive: 0, cut_pull: 0, sweep: 0, loft: 0 },
    3: { defend: -0.05, rotate: -0.1, drive: -0.1, cut_pull: -0.1, sweep: -0.1, loft: -0.1 },
  },
  spin: {
    1: { defend: -0.05, rotate: 0, drive: 0.1, cut_pull: 0, sweep: 0.1, loft: 0.1 },
    2: { defend: 0, rotate: 0, drive: 0, cut_pull: 0, sweep: 0, loft: 0 },
    3: { defend: 0.05, rotate: 0, drive: -0.05, cut_pull: -0.05, sweep: -0.15, loft: -0.05 },
  },
};
/** A short spinner is a long hop: it sits up to be pulled, cut or hooked. */
export const SPIN_LONG_HOP: ShotRow = { defend: 0, rotate: 0.1, drive: 0, cut_pull: 0.3, sweep: 0, loft: 0.25 };
/** Fraction of a swing ball's pitch help that survives when it is bowled short. */
export const SHORT_SWING_MULT = 0.3;
/** Playing against the line (to a zone that is not natural for the shot and line). */
export const AGAINST_LINE = -0.3;

/** Zones each shot may target at all. Defend and leave never take a zone. */
export const LEGAL_ZONES: Record<ShotType, readonly FieldZone[]> = {
  defend: [],
  leave: [],
  rotate: ['third_man', 'point', 'cover', 'mid_off', 'mid_on', 'midwicket', 'square_leg', 'fine_leg'],
  drive: ['point', 'cover', 'mid_off', 'mid_on', 'midwicket'],
  cut_pull: ['third_man', 'point', 'cover', 'midwicket', 'square_leg', 'fine_leg'],
  sweep: ['third_man', 'point', 'midwicket', 'square_leg', 'fine_leg'],
  loft: ['third_man', 'point', 'cover', 'mid_off', 'mid_on', 'midwicket', 'square_leg', 'fine_leg'],
};
/** Natural zones for each shot and line ("play with the line"). */
export const NATURAL_ZONES: Record<AttackShot, Record<Line, readonly FieldZone[]>> = {
  defend: { wide_off: [], off: [], middle: [], leg: [] },
  rotate: {
    wide_off: ['third_man', 'point', 'cover', 'mid_off'],
    off: ['third_man', 'point', 'cover', 'mid_off', 'mid_on'],
    middle: ['cover', 'mid_off', 'mid_on', 'midwicket', 'square_leg'],
    leg: ['mid_on', 'midwicket', 'square_leg', 'fine_leg'],
  },
  drive: { wide_off: ['point', 'cover'], off: ['cover', 'mid_off'], middle: ['mid_off', 'mid_on'], leg: ['mid_on', 'midwicket'] },
  cut_pull: {
    wide_off: ['third_man', 'point', 'cover'],
    off: ['third_man', 'point', 'midwicket', 'square_leg'],
    middle: ['midwicket', 'square_leg', 'fine_leg'],
    leg: ['square_leg', 'fine_leg', 'midwicket'],
  },
  sweep: {
    wide_off: ['point', 'third_man'],
    off: ['square_leg', 'fine_leg', 'midwicket'],
    middle: ['square_leg', 'fine_leg', 'midwicket'],
    leg: ['square_leg', 'fine_leg'],
  },
  loft: {
    wide_off: ['cover', 'point', 'mid_off'],
    off: ['mid_off', 'cover', 'mid_on'],
    middle: ['mid_on', 'mid_off', 'midwicket'],
    leg: ['midwicket', 'mid_on', 'square_leg'],
  },
};
/** Short balls are lofted only as hooks (leg side, square or fine) or upper-cuts (third man, point). */
export const SHORT_LOFT_ZONES: Record<Line, readonly FieldZone[]> = {
  wide_off: ['third_man', 'point'],
  off: ['third_man', 'point', 'square_leg'],
  middle: ['square_leg', 'fine_leg', 'midwicket'],
  leg: ['square_leg', 'fine_leg'],
};

/** Pitch × delivery (batter's point of view; negative = the pitch helps this delivery). */
export const PITCH_VAR: Record<PitchId, Record<DeliveryVariant, number>> = {
  green: { yorker: 0, good_length: -0.35, bouncer: 0, slower: 0.05, inswing: -0.35, outswing: -0.35, offspin: 0.2, legspin: 0.2 },
  hard: { yorker: -0.15, good_length: 0.05, bouncer: -0.5, slower: 0, inswing: 0.05, outswing: 0.05, offspin: 0.1, legspin: 0.05 },
  slow: { yorker: 0.2, good_length: 0.15, bouncer: 0.3, slower: -0.35, inswing: 0.1, outswing: 0.1, offspin: -0.5, legspin: -0.45 },
};
/** Weather × delivery (small, always shown). */
export const WEATHER_VAR: Record<WeatherId, Partial<Record<DeliveryVariant, number>>> = {
  clear: {},
  humid: { inswing: -0.15, outswing: -0.15, good_length: -0.05 },
  dew: { offspin: 0.15, legspin: 0.15, slower: 0.05, yorker: 0.03, good_length: 0.03, bouncer: 0.03, inswing: 0.03, outswing: 0.03 },
};
/** Pitch × shot (hard: true bounce for cuts and pulls; slow: low bounce for sweeps, holds up for lofts). */
export const PITCH_SHOT: Record<PitchId, Partial<Record<ShotType, number>>> = {
  green: { drive: -0.08, loft: -0.1, cut_pull: 0.05 },
  hard: { cut_pull: 0.1, loft: 0, sweep: -0.1 },
  slow: { sweep: 0.2, rotate: 0.12, loft: -0.35, drive: -0.05, cut_pull: -0.05 },
};
/** Pace intensity × pitch: express is extra effective on Hard, loses bite on Slow. */
export const PITCH_EXPRESS: Record<PitchId, number> = { green: 0, hard: -0.1, slow: 0.1 };
/** Green new ball: swing and seam strongest for balls 1–3, weaker for 4–6. */
export const NEW_BALL_MULT = { early: 1.3, late: 0.8 } as const;
export const NEW_BALL_VARIANTS: readonly DeliveryVariant[] = ['inswing', 'outswing', 'good_length', 'yorker'];

/** Execution: perfect makes the ball harder for every shot; a loose ball (missed mark) is a gift for attacking shots. */
export const PERFECT_EFFECT = -0.45;
export const LOOSE_EFFECT = 0.75;
export const PRECISION: Record<DeliveryVariant, number> = {
  yorker: 1.2,
  good_length: 0.9,
  bouncer: 1,
  slower: 1,
  inswing: 1,
  outswing: 1,
  offspin: 0.9,
  legspin: 0.9,
};
export const LOOSE_SEVERITY: Record<DeliveryVariant, number> = {
  yorker: 1.3,
  good_length: 0.8,
  bouncer: 1.1,
  slower: 1.2,
  inswing: 1,
  outswing: 1,
  offspin: 1,
  legspin: 1.2,
};
/** A merely 'good' execution of a precision ball misses slightly: a good yorker is a touch full. */
export const GOOD_EFFECT: Partial<Record<DeliveryVariant, number>> = { yorker: 0.2 };
export const LOOSE_SHOT: Record<ShotType, number> = { defend: 0.3, rotate: 0.6, drive: 1, cut_pull: 1, sweep: 1, loft: 1, leave: 0 };

/** Sequencing: a setup ball that contrasts with the next one; repeating the same ball lets the batter line it up. */
export const SETUP_CONTRAST = -0.5;
export const SETUP_PLAIN = 0;
/** By how many times the batter has already seen this delivery (variant + length + line) in the over: 0, 1, 2, 3+. */
export const REPEAT_EFFECT: readonly number[] = [0, 0.25, 0.45, 0.6];
/** A loose ball bowled wide gives width as well (cut and drive gifts). */
export const LOOSE_LINE: Record<Line, number> = { wide_off: 1.3, off: 1, middle: 1, leg: 1.1 };
/** Contrast in pace: at least this many km/h between consecutive balls. */
export const PACE_CONTRAST_KPH = 18;
/** Wicket multiplier on the ball after a successful (contrasting) setup. */
export const SETUP_WICKET_MULT = 1.2;

/** Timing value per grade (factor), and how much of a shot's power each grade delivers. */
export const TIMING_VALUE: Record<TimingGrade, number> = {
  perfect: 1,
  good: 0.55,
  early: -0.25,
  late: -0.25,
  very_early: -0.75,
  very_late: -0.75,
  no_shot: -1,
  interrupted: 0,
};
export const TIMING_POWER: Record<TimingGrade, number> = {
  perfect: 1,
  good: 0.55,
  early: 0.15,
  late: 0.15,
  very_early: 0,
  very_late: 0,
  no_shot: 0,
  interrupted: 0,
};

/**
 * Situational advantage A combines the factors other than the matchup m (each −1..1, + helps the batter):
 *   A = W_EXECUTION·execution + W_PITCH·pitch + W_SETUP·setup (+ NEW_BATTER_A on a new batter's first ball)
 *   P(middle) = MID_BASE[timing] + SHOT_EASE[shot] + K_MATCHUP_MIDDLE·m + K_ADVANTAGE·A   (clamped 0.03..0.96)
 *   power     = POWER_BASE + POWER_TIMING·TIMING_POWER[timing] + POWER_MATCHUP·m + POWER_ADVANTAGE·A + PITCH_POWER + pace
 */
/** Weight of the matchup inside the reported advantage (explanations only). */
export const W_MATCHUP = 1;
export const W_EXECUTION = 1;
export const W_PITCH = 0.8;
export const W_SETUP = 0.6;
export const NEW_BATTER_A = -0.2;

/** Stage 1: chance of middling the ball by timing grade, plus SHOT_EASE and K_ADVANTAGE × A. */
export const MID_BASE: Record<TimingGrade, number> = {
  perfect: 0.88,
  good: 0.74,
  early: 0.42,
  late: 0.42,
  very_early: 0.12,
  very_late: 0.12,
  no_shot: 0,
  interrupted: 0,
};
export const SHOT_EASE: Record<AttackShot, number> = { defend: 0.1, rotate: 0.05, drive: 0, cut_pull: -0.02, sweep: -0.03, loft: -0.06 };
export const K_ADVANTAGE = 0.25;
/** The matchup moves contact and power directly: a shot that does not suit the ball is rarely middled and never powerful. */
export const K_MATCHUP_MIDDLE = 0.25;
export const POWER_MATCHUP = 0.4;
export const MID_MIN = 0.03;
export const MID_MAX = 0.96;
/** Defensive shots protect the wicket: multiplier on edge, lbw and bowled chances. */
export const SHOT_EXPOSURE: Record<AttackShot, number> = { defend: 0.35, rotate: 0.6, drive: 1, cut_pull: 1, sweep: 1, loft: 1.1 };

/** How the non-middled share splits: thick edge, thin edge, pad, clean miss. */
export const MISS_SPLIT: Record<AttackShot, readonly [number, number, number, number]> = {
  defend: [0.55, 0.15, 0.2, 0.1],
  rotate: [0.45, 0.2, 0.15, 0.2],
  drive: [0.35, 0.3, 0.12, 0.23],
  cut_pull: [0.45, 0.2, 0.05, 0.3],
  sweep: [0.35, 0.1, 0.33, 0.22],
  loft: [0.5, 0.1, 0.05, 0.35],
};
export const MISS_SPLIT_VARIANT: Partial<Record<DeliveryVariant, readonly [number, number, number, number]>> = {
  outswing: [1, 1.5, 0.7, 1],
  legspin: [1, 1.5, 0.7, 1],
  inswing: [1, 0.8, 1.5, 1],
  offspin: [1, 0.8, 1.5, 1],
  yorker: [0.8, 1, 1.4, 1.3],
  bouncer: [1.4, 1, 0.1, 1.2],
  slower: [1.3, 1, 1, 1.1],
};
export const MISS_SPLIT_EARLY = [1.3, 0.8, 1, 1] as const;
export const MISS_SPLIT_LATE = [0.8, 1.3, 1.3, 1] as const;
export const MISS_SPLIT_PITCH: Record<PitchId, readonly [number, number, number, number]> = {
  green: [1, 1.25, 1, 1],
  hard: [1.1, 1, 1, 1],
  slow: [1.2, 1, 1.15, 1],
};
export const MISS_SPLIT_LINE: Record<Line, readonly [number, number, number, number]> = {
  wide_off: [1, 1.2, 0.1, 1.3],
  off: [1, 1, 1, 1],
  middle: [1, 1, 1, 1],
  leg: [1, 0.7, 1.3, 1],
};

/** Power of a middled shot (0..1) = POWER_BASE + POWER_TIMING × timing power + POWER_ADVANTAGE × A + pitch + pace. */
export const POWER_BASE = 0.25;
export const POWER_TIMING = 0.45;
export const POWER_ADVANTAGE = 0.25;
/** Lofted shots also need the right length to get under the ball: clearance c = power + LOFT_MATCHUP × matchup. */
export const LOFT_MATCHUP = 0.4;
/** Six chance = six × (c − LOFT_SIX_FROM), capped; four chance = 0.12 + 0.35 (c − 0.2); caught = catchBase + catchMiss (1 − c)². */
export const LOFT_SIX_FROM = 0.25;
export const LOFT_SIX_MAX = 0.6;
export const LOFT: Record<'gap' | 'ring' | 'deep', { six: number; sixMult: number; fourMult: number; catchBase: number; catchMiss: number }> = {
  gap: { six: 1.25, sixMult: 1, fourMult: 1, catchBase: 0.02, catchMiss: 0.28 },
  ring: { six: 1.25, sixMult: 1, fourMult: 1, catchBase: 0.04, catchMiss: 0.43 },
  deep: { six: 1.25, sixMult: 0.5, fourMult: 0.5, catchBase: 0.12, catchMiss: 0.53 },
};
export const PITCH_POWER: Record<PitchId, number> = { green: 0, hard: 0.1, slow: -0.1 };

export type Coverage = 'gap' | 'ring' | 'deep' | 'both';
export interface FieldLayout {
  zones: Record<FieldZone, Coverage>;
  /** Chance a thin edge is caught behind or in the slips. */
  slipCatch: number;
  /** Chance a defensive thick edge or bat-pad is caught by a close fielder. */
  closeCatch: number;
}
export const FIELD_LAYOUTS: Record<FieldSetting, FieldLayout> = {
  attacking: {
    zones: { third_man: 'gap', point: 'ring', cover: 'ring', mid_off: 'ring', mid_on: 'ring', midwicket: 'ring', square_leg: 'ring', fine_leg: 'gap' },
    slipCatch: 0.5,
    closeCatch: 0.08,
  },
  balanced: {
    zones: { third_man: 'deep', point: 'ring', cover: 'ring', mid_off: 'gap', mid_on: 'ring', midwicket: 'gap', square_leg: 'ring', fine_leg: 'deep' },
    slipCatch: 0.35,
    closeCatch: 0.03,
  },
  sweeper: {
    zones: { third_man: 'deep', point: 'deep', cover: 'deep', mid_off: 'ring', mid_on: 'gap', midwicket: 'deep', square_leg: 'ring', fine_leg: 'deep' },
    slipCatch: 0.12,
    closeCatch: 0,
  },
};
/** Field factor for the explanation, by coverage: ground shots and lofted shots. */
export const FIELD_FACTOR_GROUND: Record<Coverage, number> = { gap: 0.6, deep: 0.15, ring: -0.35, both: -0.6 };
export const FIELD_FACTOR_LOFT: Record<Coverage, number> = { gap: 0.7, ring: 0.35, deep: -0.45, both: -0.6 };
export const FIELD_FACTOR_BAT: Record<FieldSetting, number> = { attacking: -0.25, balanced: -0.1, sweeper: 0.1 };

/** Intent multipliers on wicket and boundary chances. */
export const INTENT_WICKET: Record<Intent, number> = { attack: 1.25, contain: 0.8, setup: 0.75 };
export const INTENT_BOUNDARY: Record<Intent, number> = { attack: 1.1, contain: 0.8, setup: 1.15 };
/** Thin edges carry to the cordon more on lively pitches. */
export const CARRY: Record<PitchId, number> = { green: 1.15, hard: 1.1, slow: 0.85 };
/** Lofted shots are riskier with the new ball on a green pitch (balls 1–3). */
export const GREEN_EARLY_LOFT_CATCH = 1.4;

/** Base shot risk for the explanation factor (0..1). */
export const SHOT_RISK: Record<ShotType, number> = { leave: 0.05, defend: 0.08, rotate: 0.2, drive: 0.35, cut_pull: 0.45, sweep: 0.45, loft: 0.65 };

/** Leave / no shot: chance the ball would hit the stumps or pads in line. */
export const LEAVE_HIT: Record<Line, number> = { wide_off: 0, off: 0.08, middle: 0.45, leg: 0.03 };
export const LEAVE_HIT_VARIANT: Partial<Record<DeliveryVariant, number>> = { inswing: 2, outswing: 0.4, offspin: 1.6, legspin: 0.5, yorker: 1.3, bouncer: 0 };
export const LEAVE_HIT_LENGTH: Record<Length, number> = { full: 1.1, good: 1, short: 0.1 };
export const LEAVE_HIT_PITCH: Record<PitchId, number> = { green: 1.05, hard: 0.85, slow: 1.1 };
/** Of the balls that hit: bowled share (the rest are lbw). */
export const LEAVE_BOWLED_SHARE = 0.55;

/** LBW after pad contact and bowled after a clean miss, by line. */
export const LBW_LINE: Record<Line, number> = { wide_off: 0, off: 0.22, middle: 0.32, leg: 0.06 };
export const BOWLED_LINE: Record<Line, number> = { wide_off: 0.01, off: 0.3, middle: 0.42, leg: 0.08 };
export const LBW_LENGTH: Record<Length, number> = { full: 1.2, good: 1, short: 0.2 };
export const BOWLED_LENGTH: Record<Length, number> = { full: 1.15, good: 1, short: 0.15 };
export const LBW_VARIANT: Partial<Record<DeliveryVariant, number>> = { inswing: 1.35, offspin: 1.2, yorker: 1.25, outswing: 0.6, legspin: 0.7, bouncer: 0 };
export const BOWLED_VARIANT: Partial<Record<DeliveryVariant, number>> = { yorker: 1.2, inswing: 1.2, offspin: 1.1, outswing: 0.75, legspin: 0.85, bouncer: 0.1 };
export const LBW_SHOT: Partial<Record<ShotType, number>> = { sweep: 1.25, loft: 0.8, drive: 0.9, cut_pull: 0.7 };
export const LBW_PITCH: Record<PitchId, number> = { green: 1, hard: 0.8, slow: 1.15 };
export const BOWLED_PITCH: Record<PitchId, number> = { green: 1, hard: 0.75, slow: 1.15 };
/** Spinner beats a batter who came down the track: stumped. */
export const STUMPED = 0.45;
/** Rotate: run-out base chance, multipliers by coverage, mistimed bump, and the last-ball scramble. */
export const RUN_OUT_BASE = 0.02;
export const RUN_OUT_COVERAGE: Record<Coverage, number> = { gap: 0.5, ring: 1.5, deep: 0.8, both: 1.5 };
export const RUN_OUT_MISTIMED = 0.04;
export const SCRAMBLE_RUN_OUT = 0.2;
