/**
 * Ground geometry shared by the 3D and 2D presentations.
 *
 * World frame: origin at the centre of the pitch on the ground, +Y up, Z along the pitch with the bowler's stumps at
 * z = -10.06 and the striker's stumps at z = +10.06. +X is the OFF side of the (right-handed) striker, matching
 * BallPath.lineAtBatM. Headings are radians, 0 facing +z, positive turning towards +x.
 */
import type { FieldSetting, FieldZone } from '@/contracts';
import { FIELD_POSITIONS, type FieldPositionKind } from '@/engine/fieldDisplay';
import { BOUNDARY_R, CONTACT_Z, PITCH_HALF, POPPING } from '@/physics/geometry';
import { DEG, type Vec3, v3 } from './math';

/**
 * Cricket geometry comes from the one source, src/physics/geometry.ts, so what is drawn is what collides: the pitch,
 * the creases, the stumps (true 0.0968 m centre-to-centre spacing, 17.5 mm radius), the ball, the rope (a stylised,
 * slightly compact 62 m so a phone screen shows the whole oval), the 30-yard ring, and the contact reference.
 */
export {
  PITCH_HALF,
  PITCH_WIDTH,
  POPPING,
  RETURN_CREASE_X,
  STUMP_H,
  STUMP_SPACING,
  STUMP_R,
  BAIL_RISE,
  BALL_R,
  BOUNDARY_R,
  RING_R,
  CONTACT_Z,
  STRIKER_REF,
  POPPING_CREASE_HALF,
  RETURN_CREASE_LENGTH,
} from '@/physics/geometry';

export const STRIKER_STUMPS: Vec3 = v3(0, 0, PITCH_HALF);
export const BOWLER_STUMPS: Vec3 = v3(0, 0, -PITCH_HALF);
/** Release point for a right-arm-over bowler (bowling arm next to the stumps, body on the off side). */
export const RELEASE: Vec3 = v3(0.32, 2.1, -PITCH_HALF + POPPING + 0.15);

/** Bearing of each zone from the striker: 0 = straight down the pitch, positive = off side. */
export const ZONE_BEARING: Record<FieldZone, number> = {
  mid_off: 22,
  cover: 62,
  point: 96,
  third_man: 142,
  fine_leg: -142,
  square_leg: -96,
  midwicket: -62,
  mid_on: -22,
};
export const ZONES: readonly FieldZone[] = ['third_man', 'point', 'cover', 'mid_off', 'mid_on', 'midwicket', 'square_leg', 'fine_leg'];

export const STRIKER_POS: Vec3 = v3(-0.34, 0, PITCH_HALF - 1.05);

export function zoneDir(zone: FieldZone, offsetDeg = 0): Vec3 {
  const a = (ZONE_BEARING[zone] + offsetDeg) * DEG;
  return v3(Math.sin(a), 0, -Math.cos(a));
}

/** Distance from the striker to the boundary rope along a zone direction. */
export function distanceToBoundary(zone: FieldZone, offsetDeg = 0, inset = 0): number {
  const d = zoneDir(zone, offsetDeg);
  const sx = 0;
  const sz = CONTACT_Z;
  const R = BOUNDARY_R - inset;
  // |s + d t| = R  →  t² + 2 (s·d) t + |s|² − R² = 0
  const b = sx * d.x + sz * d.z;
  const c = sx * sx + sz * sz - R * R;
  return -b + Math.sqrt(Math.max(0, b * b - c));
}

/** Zone for a bearing from the striker (used to quantise a swipe or a ball direction). */
export function zoneForBearing(bearingDeg: number): FieldZone {
  let best: FieldZone = 'mid_off';
  let bestD = Infinity;
  for (const z of ZONES) {
    let d = Math.abs(((bearingDeg - ZONE_BEARING[z] + 540) % 360) - 180);
    if (d < bestD) {
      bestD = d;
      best = z;
    }
  }
  return best;
}

export type FielderRole =
  | 'slip1'
  | 'slip2'
  | 'gully'
  | 'short_leg'
  | 'point'
  | 'backward_point'
  | 'deep_point'
  | 'cover'
  | 'deep_cover'
  | 'deep_extra_cover'
  | 'mid_off'
  | 'long_off'
  | 'mid_on'
  | 'long_on'
  | 'midwicket'
  | 'deep_midwicket'
  | 'square_leg'
  | 'backward_square'
  | 'third_man'
  | 'fine_leg';

export interface FielderSpot {
  role: FielderRole;
  /** Zone this fielder stands in (and covers, unless a close catcher). */
  zone: FieldZone;
  pos: Vec3;
  /** On the boundary. */
  deep: boolean;
  /** 'ring' (inside the circle), 'deep' (on the rope) or 'close' (slips, gully: they catch edges, cover no zone). */
  kind: FieldPositionKind;
}

/**
 * The nine fielders of a setting, exactly where the engine's coverage puts them (FIELD_POSITIONS from gameplay's
 * display mapping), so the gaps the map and the 3D field show are the gaps the engine plays.
 */
export function fieldSpots(setting: FieldSetting): FielderSpot[] {
  return FIELD_POSITIONS[setting].map(({ role, zone, bearingDeg, distanceM, kind }) => {
    const a = bearingDeg * DEG;
    let x = Math.sin(a) * distanceM;
    let z = CONTACT_Z - Math.cos(a) * distanceM;
    const r = Math.hypot(x, z);
    const max = BOUNDARY_R - 4;
    if (r > max) {
      x *= max / r;
      z *= max / r;
    }
    return { role, zone, pos: v3(x, 0, z), deep: kind === 'deep', kind };
  });
}

/** Wicketkeeper position: stands up to spin, back to pace. */
export function keeperPos(family: 'pace' | 'swing' | 'spin'): Vec3 {
  return v3(0.15, 0, PITCH_HALF + (family === 'spin' ? 0.9 : family === 'swing' ? 7.5 : 11));
}

export const NON_STRIKER_POS: Vec3 = v3(-1.15, 0, -PITCH_HALF + POPPING + 0.4);
export const UMPIRE_POS: Vec3 = v3(-0.55, 0, -PITCH_HALF - 1.7);
export const SQUARE_UMPIRE_POS: Vec3 = v3(-24, 0, PITCH_HALF - 1.2);

/** Run-up length per bowler action, metres behind the bowling crease. */
export function runUpLength(action: 'pace_long' | 'pace_short' | 'swing_side_on' | 'spin_off' | 'spin_leg'): number {
  switch (action) {
    case 'pace_long':
      return 17;
    case 'pace_short':
      return 11;
    case 'swing_side_on':
      return 14;
    case 'spin_off':
      return 5.5;
    case 'spin_leg':
      return 6.5;
  }
}

