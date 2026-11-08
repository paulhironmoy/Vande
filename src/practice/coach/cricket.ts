/**
 * Cricket orthodoxy for line and length: the coaching layer on top of the simulation (docs/PRACTICE_COACH.md,
 * "Orthodoxy"). The physics decides what every response produces; these rules say which responses a coach would call
 * correct cricket for the ball that was bowled, so the recommended response is never a stroke that merely happened to
 * work, and so the read can be judged ("you played across the line"). Bearings in degrees, + = the off side.
 *
 * The physics today is generous to well-timed strokes in any direction (see the doc's "Limitations"); once it models
 * stroke geometry fully, the simulated risk and runs carry the choice and these rules only break ties.
 */
import type { Decision, Footwork, PlayedFootwork } from '@/contracts/practice';
import type { LengthBand, LineBand } from '@/practice/game';
import { READ_THRESHOLDS, type BallFacts } from './facts';

type Arc = readonly [number, number];

/**
 * Where an orthodox attacking stroke goes, by length and line (null: block or leave). Full balls are driven in the arc
 * of their line; a good length is respected except off the pads, or when it is wide enough to cut; short balls are cut
 * when wide, punched off the back foot on off stump and pulled when straight or at the body. Bouncers and yorkers are
 * never attacked orthodoxly: leave or duck the bouncer, dig the yorker out.
 */
export const ATTACK_ARCS: Readonly<Record<'full' | 'good' | 'short', Readonly<Record<LineBand, Arc | null>>>> = {
  full: {
    down_leg: [-150, -30],
    leg_stump: [-90, 10],
    middle: [-50, 30],
    off_stump: [-5, 60],
    outside_off: [10, 80],
    wide_outside_off: [20, 95],
  },
  good: {
    down_leg: [-150, -25],
    leg_stump: [-110, -20],
    middle: null,
    off_stump: null,
    outside_off: null,
    wide_outside_off: [55, 120],
  },
  short: {
    down_leg: [-150, -45],
    leg_stump: [-115, -30],
    middle: [-115, -30],
    off_stump: [15, 75],
    outside_off: [55, 125],
    wide_outside_off: [55, 125],
  },
};

export const ORTHODOXY = {
  /** An orthodox attacking stroke keeps the ball on the ground: the input's along-the-ground elevations. */
  groundMaxElevation: 0.3,
  /** From this elevation the stroke is lofted (the input's lofted range starts here). */
  loftedFromElevation: 0.45,
  /** Across the line (the physics' own rule, scoring.ts diagnoseBeaten, plus its mirror on the leg side). */
  acrossLine: {
    legSwingDeg: -25,
    offsideOfM: 0.06,
    cutDeg: 65,
    straightWithinM: 0.1,
    offSwingDeg: 45,
    downLegM: -0.15,
  },
  /** Across the movement: to leg against a ball moving away, square on the off side against one coming in. */
  acrossMovement: { legDeg: -20, offDeg: 40 },
  /** Playing with the movement: the arc opens this much further on the side the ball moves to (deg). */
  withMovementDeg: 30,
} as const;

const inArc = (deg: number, arc: Arc) => deg >= arc[0] && deg <= arc[1];

/** The length the stroke meets: going down the track to a spinner turns a good length into a full ball. */
function effectiveLength(f: BallFacts, footwork: PlayedFootwork): LengthBand {
  if (footwork === 'down_track' && f.family === 'spin' && f.lengthBand === 'good') return 'full';
  return f.lengthBand;
}

/**
 * The orthodox arc for an attacking stroke with this footwork (null: do not attack this ball), opened further on the
 * side the ball moves to: play with the swing, the seam or the turn.
 */
export function attackArc(f: BallFacts, footwork: PlayedFootwork): Arc | null {
  const band = effectiveLength(f, footwork);
  if (band === 'yorker' || band === 'bouncer') return null;
  const arc = ATTACK_ARCS[band][f.lineBand];
  if (!arc || f.mover === null) return arc;
  const w = ORTHODOXY.withMovementDeg;
  return f.playedMoveM > 0 ? [arc[0], arc[1] + w] : [arc[0] - w, arc[1]];
}

/** A stroke across the line of the ball (the physics' scoring rule, and an off-side swing at a ball going down leg). */
export function acrossTheLine(directionDeg: number, f: Pick<BallFacts, 'lineAtStumpsM' | 'wouldHitStumps'>): boolean {
  const a = ORTHODOXY.acrossLine;
  if (directionDeg < a.legSwingDeg && f.lineAtStumpsM > a.offsideOfM) return true;
  if (directionDeg > a.cutDeg && f.lineAtStumpsM < a.straightWithinM && f.wouldHitStumps) return true;
  return directionDeg > a.offSwingDeg && f.lineAtStumpsM < a.downLegM;
}

/** A stroke against the movement the batter plays: to leg when it moves away, square on the off side when it comes in. */
export function acrossTheMovement(directionDeg: number, f: Pick<BallFacts, 'mover' | 'playedMoveM'>): boolean {
  if (f.mover === null) return false;
  const a = ORTHODOXY.acrossMovement;
  return f.playedMoveM > 0 ? directionDeg < a.legDeg : directionDeg > a.offDeg;
}

/** Footwork that fights the length: forward to a short ball, back to a full one, down the track to pace or to a short ball. */
export function footworkFightsLength(f: BallFacts, played: PlayedFootwork): boolean {
  if (played === 'forward') return f.short;
  if (played === 'back') return f.lengthBand === 'full';
  if (played === 'down_track') return f.family === 'pace' || f.short;
  return false;
}

/** Footwork a coach accepts for this length: the automatic choice, the other foot on a good length, a spinner's down the track. */
function orthodoxFootwork(f: BallFacts, footwork: Footwork, played: PlayedFootwork): boolean {
  if (footwork === 'auto' || played === f.autoFootwork) return true;
  if (footworkFightsLength(f, played)) return false;
  if (played === 'down_track') return f.family === 'spin' && f.lengthBand !== 'short';
  return (played === 'forward' || played === 'back') && f.lengthBand === 'good';
}

/** The ball can be left: it misses the stumps. */
const leaveIsOrthodox = (f: BallFacts): boolean => !f.wouldHitStumps;

/** The ball should be blocked if it would hit, and may be when it passes close to the stumps below shoulder height. */
function defenceIsOrthodox(f: BallFacts): boolean {
  if (f.wouldHitStumps) return true;
  return f.wideOfStumpsM <= READ_THRESHOLDS.defendWideM && f.heightAtBatM < READ_THRESHOLDS.defendableHeightM;
}

export interface ResponseShape {
  decision: Decision;
  footwork: Footwork;
  played: PlayedFootwork;
  directionDeg: number;
  elevation: number;
}

/** Whether a response is correct cricket for the line and length (and with the movement). */
export function isOrthodox(r: ResponseShape, f: BallFacts): boolean {
  if (r.decision === 'leave') return leaveIsOrthodox(f);
  if (!orthodoxFootwork(f, r.footwork, r.played)) return false;
  if (r.decision === 'defend') return defenceIsOrthodox(f);
  if (r.elevation > ORTHODOXY.groundMaxElevation) return false;
  const arc = attackArc(f, r.played);
  if (!arc || !inArc(r.directionDeg, arc)) return false;
  return !acrossTheLine(r.directionDeg, f) && !acrossTheMovement(r.directionDeg, f);
}

/** Played with the line and the movement (any length, any elevation): the higher-scoring alternative's minimum. */
export function withTheLine(r: Pick<ResponseShape, 'decision' | 'directionDeg'>, f: BallFacts): boolean {
  if (r.decision !== 'attack') return true;
  return !acrossTheLine(r.directionDeg, f) && !acrossTheMovement(r.directionDeg, f);
}

/** The middle of the orthodox arc, used as the "play with the line" direction when no gap lies inside it. */
export function arcMiddle(f: BallFacts, footwork: PlayedFootwork): number | null {
  const arc = attackArc(f, footwork);
  return arc ? Math.round((arc[0] + arc[1]) / 2) : null;
}
