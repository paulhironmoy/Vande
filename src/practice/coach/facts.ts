/**
 * What the ball did, measured on its own flight (src/physics delivery.ts): the coach's one description of a delivery.
 * Every number is read off the simulated flight that was bowled (pitch point, line and height at the stumps plane,
 * movement in the air and off the pitch), never off the plan, so a worn ball's smaller swing, a seamer's deviation or
 * a spinner's turn are what the coach explains. Physics frame: + x is the striker's off side (docs/PRACTICE_COACH.md).
 */
import type { BallFlight, BowlerFamily, CoachAnalysis, DeliveryVariation, PlayedFootwork } from '@/contracts/practice';
import { BALL_R, BEATEN_BY, PITCH_HALF, STUMPS_HALF_W, STUMPS_TOP, flightMovement, resolveFootwork, sampleAt } from '@/physics';
import { lengthBand, lineBand, type LengthBand, type LineBand } from '@/practice/game';

/** What moved the ball most: swing or seam (pace), the cutter's grip, a spinner's turn or drift. */
export type Mover = 'swing' | 'seam' | 'cut' | 'turn' | 'drift';

/** The coach's thresholds for reading a delivery (m). */
export const READ_THRESHOLDS = {
  /** Net sideways movement a batter has to play: half the width of the bat's face. */
  movementM: 0.05,
  /** At or above this at the bat the ball is short-pitched for the batter (the physics' "beaten by bounce" height). */
  highAtBatM: BEATEN_BY.highAtBatM,
  /** A short ball below this at the bat can still be defended; above it the batter leaves, sways or ducks. */
  defendableHeightM: 1.35,
  /** A ball passing within this of the line of the stumps is close enough to defend (m outside the line). */
  defendWideM: 0.08,
} as const;

export interface BallFacts {
  family: BowlerFamily;
  variation: DeliveryVariation;
  /** Release speed (km/h), the physics' own. */
  speedKph: number;
  /** Where it pitched: metres in front of the striker's stumps (null for a full toss). */
  lengthM: number | null;
  lineAtStumpsM: number;
  /** Sideways movement in the air (swing, drift) and off the pitch (seam, cut, turn), + towards the off side. */
  airM: number;
  pitchM: number | null;
  heightAtBatM: number;
  heightAtStumpsM: number;
  wouldHitStumps: boolean;
  lengthBand: LengthBand;
  lineBand: LineBand;
  /** How far outside the line of the stumps it passes (m, > 0 wide of them, ≤ 0 in line). */
  wideOfStumpsM: number;
  /** It passes over the top of the stumps. */
  overTheTop: boolean;
  /** Net sideways movement at the stumps against the line it left the hand on (m, + = towards the off side). */
  movementM: number;
  /**
   * The movement the batter plays: the larger of the air movement and the movement off the pitch (m, signed). A
   * spinner's drift and turn often cancel in the net, but the batter plays the turn.
   */
  playedMoveM: number;
  /** What moved it most; null when that movement is under READ_THRESHOLDS.movementM. */
  mover: Mover | null;
  /** Short-pitched at the batter: a short length or a bouncer, or at least READ_THRESHOLDS.highAtBatM high. */
  short: boolean;
  /** A full ball or a yorker. */
  full: boolean;
  /** The footwork the physics plays for this length (forward to full and good lengths, back to short, yorkers dug out). */
  autoFootwork: PlayedFootwork;
}

const IN_LINE_M = STUMPS_HALF_W + BALL_R;

/** Rounded, never negative zero (analyses compare byte for byte through JSON). */
const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;
const r1 = (v: number) => Math.round(v * 10) / 10 || 0;

/** The delivery as the coach describes it. Pure: the same flight always gives the same facts. */
export function ballFacts(flight: BallFlight, family: BowlerFamily): BallFacts {
  const m = flightMovement(flight);
  const s0 = flight.samples[0];
  const plane = sampleAt(flight.samples, flight.stumpsT);
  const straightX = s0.p.x + (s0.v.x / s0.v.z) * (plane.p.z - s0.p.z);
  const movementM = plane.p.x - straightX;
  const lengthM = flight.bounce ? PITCH_HALF - flight.bounce.p.z : null;
  const band = lengthBand(lengthM ?? flight.plan.lengthM, family);
  const pitch = m.pitchM ?? 0;
  const inAir = Math.abs(m.airM) >= Math.abs(pitch);
  const playedMoveM = inAir ? m.airM : pitch;
  let mover: Mover | null = null;
  if (Math.abs(playedMoveM) >= READ_THRESHOLDS.movementM) {
    if (family === 'spin') mover = inAir ? 'drift' : 'turn';
    else if (flight.plan.variation === 'cutter') mover = inAir ? 'swing' : 'cut';
    else mover = inAir ? 'swing' : 'seam';
  }
  return {
    family,
    variation: flight.plan.variation,
    speedKph: r1(flight.release.speedKph),
    lengthM: lengthM === null ? null : r3(lengthM),
    lineAtStumpsM: r3(m.lineAtStumpsM),
    airM: r3(m.airM),
    pitchM: m.pitchM === null ? null : r3(m.pitchM),
    heightAtBatM: r3(m.heightAtBatM),
    heightAtStumpsM: r3(plane.p.y),
    wouldHitStumps: flight.wouldHitStumps,
    lengthBand: band,
    lineBand: lineBand(m.lineAtStumpsM),
    wideOfStumpsM: r3(Math.abs(m.lineAtStumpsM) - IN_LINE_M),
    overTheTop: plane.p.y >= STUMPS_TOP + BALL_R,
    movementM: r3(movementM),
    playedMoveM: r3(playedMoveM),
    mover,
    short: band === 'short' || band === 'bouncer' || m.heightAtBatM >= READ_THRESHOLDS.highAtBatM,
    full: band === 'full' || band === 'yorker',
    autoFootwork: resolveFootwork(flight, 'auto'),
  };
}

/** The contract's "what the ball did" block. */
export function analysisBall(f: BallFacts): CoachAnalysis['ball'] {
  return {
    variation: f.variation,
    speedKph: f.speedKph,
    lengthM: f.lengthM,
    lineAtStumpsM: f.lineAtStumpsM,
    airMovementM: f.airM,
    pitchMovementM: f.pitchM,
    heightAtBatM: f.heightAtBatM,
    wouldHitStumps: f.wouldHitStumps,
  };
}
