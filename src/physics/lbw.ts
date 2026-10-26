/**
 * Leg before wicket (Law 36), decided from the physics:
 *  1. The ball must not pitch outside the line of leg stump (whole ball outside the line), unless it struck the
 *     batter before pitching.
 *  2. The first interception by the batter's person (not the bat) must be in line between wicket and wicket, or
 *     outside the line of off stump only when no genuine shot was offered; never outside leg. In line = any part
 *     of the ball within the line of the stumps.
 *  3. Had the batter not intercepted it, the ball would have hit the wicket: the delivery's own flight, continued
 *     past the impact with the same physics (the flight samples are the unimpeded trajectory), must touch the stumps
 *     or bails at the stumps plane.
 * The checks run in that order and the first failure is the reason. All in the striker's frame (leg side is −x).
 */
import type { BallFlight, LbwDecision, Vec3 } from '@/contracts/practice';
import { BALL_R, STUMPS_HALF_W, STUMPS_TOP } from './constants';
import { sampleAt } from './delivery';

const IN_LINE = STUMPS_HALF_W + BALL_R;

/** LBW decision for the batter's first interception of the ball at impact.p (the ball centre at impact). */
export function lbw(flight: BallFlight, impact: { t: number; p: Vec3 }, opts: { shotOffered: boolean }): LbwDecision {
  const projected = sampleAt(flight.samples, flight.stumpsT).p;
  const at = { x: impact.p.x, y: impact.p.y, z: impact.p.z };
  const pitchedFirst = flight.bounce !== null && flight.bounce.t < impact.t;
  if (pitchedFirst && flight.bounce && flight.bounce.p.x <= -IN_LINE) return { out: false, reason: 'pitched_outside_leg', impact: at, projected };
  if (at.x <= -IN_LINE) return { out: false, reason: 'impact_outside_leg', impact: at, projected };
  if (at.x >= IN_LINE && opts.shotOffered) return { out: false, reason: 'impact_outside_off', impact: at, projected };
  if (Math.abs(projected.x) >= IN_LINE) return { out: false, reason: 'missing', impact: at, projected };
  if (projected.y >= STUMPS_TOP + BALL_R) return { out: false, reason: 'high', impact: at, projected };
  return { out: true, reason: 'out', impact: at, projected };
}
