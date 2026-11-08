/**
 * Contact material for the cricket bat face.
 *
 * This module is deliberately independent of bat-path and contact resolution code so both the face planner and the
 * authoritative impact can use exactly the same location-dependent restitution and effective-mass calibration.
 */
import type { NormalizedSwing } from '@/contracts/practice';
import {
  BAT_COR,
  BLADE_HALF_W,
  BLADE_L,
  COR_ACROSS_LOSS,
  COR_ALONG_FLOOR,
  COR_ALONG_M,
  COR_ALONG_TOE_M,
  DEFEND_COR,
  SWEET_U,
  SWING_MASS_CAP,
  SWING_PIVOT_M,
} from './constants';

/** Effective restitution of a face hit at (bladeU, across offset); it falls off faster towards the toe. */
export function faceCor(kind: NormalizedSwing['kind'], bladeU: number, across: number, balance: number): number {
  const du = (bladeU - SWEET_U) * BLADE_L;
  const q = du / (du < 0 ? COR_ALONG_TOE_M : COR_ALONG_M);
  const along = Math.max(COR_ALONG_FLOOR, 1 - (1 - COR_ALONG_FLOOR) * q * q);
  const w = Math.min(1, Math.abs(across) / BLADE_HALF_W);
  const acrossF = 1 - COR_ACROSS_LOSS * w * w;
  const balanceFactor = 0.9 + 0.1 * balance;
  // A defensive block is a braced bat-and-hands system: even a toe/edge-of-face contact keeps enough normal
  // restitution to arrest the incoming ball. Attack retains the much stronger location penalty used for mishits.
  if (kind === 'defend') return DEFEND_COR * (1.02 + 0.02 * along * acrossF) * balanceFactor;
  return BAT_COR * along * acrossF * balanceFactor;
}

/**
 * The swing's arc at a point along the blade (bladeU, 0 = toe): its speed and effective-mass factors relative to the
 * sweet spot (constants.ts SWING_PIVOT_M). 1 and 1 at the sweet spot; slower and heavier up the blade, quicker and
 * lighter towards the toe.
 */
export function swingArm(bladeU: number): { speed: number; mass: number } {
  const r = SWING_PIVOT_M - (bladeU - SWEET_U) * BLADE_L;
  const rr = r > 0.05 ? r : 0.05;
  const m = (SWING_PIVOT_M / rr) * (SWING_PIVOT_M / rr);
  return { speed: rr / SWING_PIVOT_M, mass: m < SWING_MASS_CAP ? m : SWING_MASS_CAP };
}
