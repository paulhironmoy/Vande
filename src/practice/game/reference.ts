/**
 * The reference over: the gold-standard vertical slice of docs/prompts/VANDE-PRACTICE-NORTHSTAR.md, and the quality
 * benchmark every other over is measured against. The same six balls every time, from one tall right-arm fast bowler
 * with a new white ball on the balanced pitch, in this order:
 *
 *   ref-1  a full outswinger     pitched up (3 m), starting on off stump and moving away late
 *   ref-2  an inswinger          starting outside off, swinging in to hit the stumps
 *   ref-3  a hard length         7.95 m, still rising at the batter's waist
 *   ref-4  a cutter              9% slower, a leg-cutter that grips and leaves him to clip off stump
 *   ref-5  a bouncer             at head height, on the line of middle stump (he can sway out of it or hook it)
 *   ref-6  a yorker              at the toes, inswinging onto the base of the stumps
 *
 * Nothing here is scripted: every ball is an ordinary PracticeDeliveryPlan flown by the one physics (src/physics
 * `flight()`), and its seed is derived from the over seed like any other over's (`ballSeed`). The over seed was chosen
 * so that each ball's seeded parts (the seam's landing, the amount of swing, the cutter's direction) support the ball's
 * intent, as a good bowler lands the seam; the plans are fixed and frozen. The measured shapes are in
 * docs/PRACTICE_PHYSICS.md ("Reference over") and asserted in tests/unit/practice/game/reference.test.ts.
 */
import {
  PRACTICE_SIM_VERSION,
  type BallCondition,
  type BowlerFamily,
  type BowlerProfile,
  type DeliveryVariation,
  type Handedness,
  type PaceVariation,
  type PitchCondition,
  type PracticeDeliveryPlan,
  type PracticeOverPlan,
} from '@/contracts/practice';
import { BALL_R, STUMPS_HALF_W } from '@/physics/constants';
import { frameArm, stockTurnOf } from '@/physics/delivery';
import { ballSeed, lengthBand, lineBand } from './overs';

/** The reference over is always bowled on the balanced pitch. */
export const REFERENCE_CONDITIONS: PitchCondition = 'balanced';
/** A new white ball (the evening session under lights). */
export const REFERENCE_BALL: BallCondition = Object.freeze({ colour: 'white', age: 'new' });

export type ReferenceBallId = 'ref-1' | 'ref-2' | 'ref-3' | 'ref-4' | 'ref-5' | 'ref-6';
/** The closed training objective of each reference ball (the UI words it). */
export type ReferenceObjective =
  'leave_or_drive_late' | 'play_straight' | 'get_behind_it' | 'soft_hands' | 'sway_or_hook' | 'dig_it_out';

export interface ReferenceBall {
  id: ReferenceBallId;
  /** 0–5, the order bowled. */
  index: number;
  variation: PaceVariation;
  objective: ReferenceObjective;
  /** The ball's physics seed: ballSeed(REFERENCE_OVER, index), as for every over. */
  seed: string;
}

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

/**
 * A tall right-arm fast bowler: his look seed gives a 2.30 m release (the top of RELEASE_GEOMETRY.pace), 0.42 m to the
 * off side of middle, which is what lets a hard length climb to the batter's waist. Stock ball 139.5 km/h ('fast').
 */
const BOWLER: BowlerProfile = { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'vande-reference-bowler-51' };
const OVER_SEED = 'vande-reference-over-v1-1496';

/**
 * The six plans (length m in front of the striker's stumps, line m at the stumps, + = off side, release km/h). The
 * speeds are the honest variation speeds from a 139.5 km/h stock ball (`variationKph`): the swingers 2 km/h slower,
 * the cutter × 0.91, the bouncer 2 km/h quicker. The bouncer's length is `bouncerLength` for an arrival at head height
 * (BODY.headY, 1.62 m) with this bowler, seed and ball, frozen here so the over never changes.
 */
const PLANS: readonly PracticeDeliveryPlan[] = [
  { variation: 'outswing', lengthM: 3.0, lineM: 0.36, speedKph: 137.5 },
  { variation: 'inswing', lengthM: 4.5, lineM: 0.02, speedKph: 137.5 },
  { variation: 'stock', lengthM: 7.95, lineM: 0.08, speedKph: 139.5 },
  { variation: 'cutter', lengthM: 6.0, lineM: 0.1, speedKph: 126.9 },
  { variation: 'bouncer', lengthM: 10.72, lineM: 0.04, speedKph: 141.5 },
  { variation: 'yorker', lengthM: 0.9, lineM: 0.02, speedKph: 139.5 },
];

/** The reference over (source 'reference'): deep-frozen, so no consumer can change it. */
export const REFERENCE_OVER: PracticeOverPlan = deepFreeze({
  version: PRACTICE_SIM_VERSION,
  bowler: { ...BOWLER },
  ball: { ...REFERENCE_BALL },
  balls: PLANS.map((p) => ({ ...p })) as unknown as PracticeOverPlan['balls'],
  seed: OVER_SEED,
  source: 'reference',
});

const OBJECTIVES: readonly ReferenceObjective[] = [
  'leave_or_drive_late',
  'play_straight',
  'get_behind_it',
  'soft_hands',
  'sway_or_hook',
  'dig_it_out',
];

/** The six reference balls in bowling order, with their ids, objectives and seeds. */
export const REFERENCE_BALLS: readonly ReferenceBall[] = deepFreeze(
  REFERENCE_OVER.balls.map((p, index): ReferenceBall => ({
    id: `ref-${index + 1}` as ReferenceBallId,
    index,
    variation: p.variation as PaceVariation,
    objective: OBJECTIVES[index],
    seed: ballSeed(REFERENCE_OVER, index),
  })),
);

/** One reference ball by id. */
export function referenceBall(id: ReferenceBallId): ReferenceBall {
  const b = REFERENCE_BALLS.find((r) => r.id === id);
  if (!b) throw new Error(`practice: no reference ball ${String(id)}`);
  return b;
}

// ---------------------------------------------------------------------------------------------------------------
// The over's known pattern (for the setup's "known bowling pattern information")
// ---------------------------------------------------------------------------------------------------------------

/** Where a ball finishes at the stumps, coarsely: on the stumps, the off-stump channel, outside off, the leg side. */
export type PatternLine = 'stumps' | 'off_stump' | 'outside_off' | 'leg_side';
/** Batter-relative movement planned in an over. */
export type PatternMovement = 'away' | 'in' | 'both' | 'none';

export interface OverPattern {
  family: BowlerFamily;
  /** The real bowler's arm. */
  arm: 'right' | 'left';
  /** The line most balls finish on at the stumps (a tie goes to off stump, then the stumps, outside off, leg side). */
  mainLine: PatternLine;
  /** Balls aimed to finish on the line of the stumps (any part of the ball within them). */
  onTheStumps: number;
  /** Conventional swing planned in the over (outswingers, inswingers, a spinner's arm ball), batter-relative. */
  swing: PatternMovement;
  /** A spinner's turn, batter-relative (the wrong'un turns the other way); 'none' for pace. */
  turn: PatternMovement;
  /** Balls pitched short of a length or shorter (lengthBand 'short' or 'bouncer'), and of those the bouncers. */
  shortBalls: number;
  bouncers: number;
  yorkers: number;
  /** Changes of pace: balls planned at least 6% slower or quicker than the over's median speed. */
  changeOfPace: number;
  /** The slowest and the quickest release speed planned (km/h). */
  paceKph: [number, number];
}

const LINE_OF: Record<ReturnType<typeof lineBand>, PatternLine> = {
  down_leg: 'leg_side',
  leg_stump: 'stumps',
  middle: 'stumps',
  off_stump: 'off_stump',
  outside_off: 'outside_off',
  wide_outside_off: 'outside_off',
};
const LINE_ORDER: readonly PatternLine[] = ['off_stump', 'stumps', 'outside_off', 'leg_side'];

function movement(away: boolean, inward: boolean): PatternMovement {
  return away && inward ? 'both' : away ? 'away' : inward ? 'in' : 'none';
}

/**
 * The known pattern of a fixed over, as closed facts read honestly off its six plans (the setup words them, e.g.
 * "attacks the stumps; swings it both ways; one bouncer; one yorker"). For the reference over and built overs ONLY:
 * never call it on a random over, whose deliveries stay unknown until release (the interface constitution, §5).
 * `handedness` makes the spinner's turn and the arm ball batter-relative (default right).
 */
export function overPattern(plan: PracticeOverPlan, handedness: Handedness = 'right'): OverPattern {
  const family = plan.bowler.family;
  const balls: readonly PracticeDeliveryPlan[] = plan.balls;
  const lines = new Map<PatternLine, number>();
  for (const b of balls) {
    const l = LINE_OF[lineBand(b.lineM)];
    lines.set(l, (lines.get(l) ?? 0) + 1);
  }
  let mainLine: PatternLine = LINE_ORDER[0];
  for (const l of LINE_ORDER) if ((lines.get(l) ?? 0) > (lines.get(mainLine) ?? 0)) mainLine = l;
  const has = (v: DeliveryVariation) => balls.some((b) => b.variation === v);
  const count = (pred: (b: PracticeDeliveryPlan) => boolean) => balls.filter(pred).length;
  let swing: PatternMovement;
  let turn: PatternMovement = 'none';
  if (family === 'pace') {
    swing = movement(has('outswing'), has('inswing'));
  } else {
    // The arm ball goes on with the arm: away from the batter for a right-arm bowler in his frame.
    const armBallAway = frameArm(plan.bowler.arm, handedness) === 'right';
    swing = has('arm_ball') ? movement(armBallAway, !armBallAway) : 'none';
    const stockAway = stockTurnOf(plan.bowler, handedness) > 0;
    const turners = balls.filter((b) => b.variation !== 'arm_ball');
    const turnsAway = turners.some((b) => (b.variation === 'wrong_un' ? !stockAway : stockAway));
    const turnsIn = turners.some((b) => (b.variation === 'wrong_un' ? stockAway : !stockAway));
    turn = movement(turnsAway, turnsIn);
  }
  const speeds = balls.map((b) => b.speedKph).sort((a, b) => a - b);
  const median = (speeds[2] + speeds[3]) / 2;
  return {
    family,
    arm: plan.bowler.arm,
    mainLine,
    onTheStumps: count((b) => Math.abs(b.lineM) <= STUMPS_HALF_W + BALL_R),
    swing,
    turn,
    shortBalls: count((b) => {
      const band = lengthBand(b.lengthM, family);
      return band === 'short' || band === 'bouncer';
    }),
    bouncers: count((b) => b.variation === 'bouncer'),
    yorkers: count((b) => b.variation === 'yorker'),
    changeOfPace: count((b) => Math.abs(b.speedKph - median) >= 0.06 * median),
    paceKph: [speeds[0], speeds[speeds.length - 1]],
  };
}
