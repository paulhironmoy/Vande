/**
 * Where the nine fielders stand for each field setting, for display (the field map and the 3D view), matching the
 * engine's coverage exactly (FIELD_LAYOUTS in v1/tables.ts): a "ring" zone has a fielder inside the circle, a "deep"
 * zone a fielder on the boundary, and a "gap" zone nobody at all, so "aim for the gaps you can see" is true. Close
 * catchers (slips, gully) stand next to the bat; they catch edges (slipCatch, closeCatch) and cover no zone.
 *
 * Coordinates follow src/render3d/core/ground.ts: a bearing in degrees from the striker (0 = straight down the ground
 * towards the bowler, positive = off side of a right-handed batter) and a distance in metres from the striker's
 * batting position. Every bearing sits inside its zone both for the batting swipe sectors (45° each, clockwise from
 * straight: mid-off, cover, point, third man, fine leg, square leg, midwicket, mid-on) and for the renderer's zone
 * bearings. Display only: outcomes never read positions.
 */
import type { FieldSetting, FieldZone } from '@/contracts';

export type FieldPositionKind = 'ring' | 'deep' | 'close';

export type FieldRole =
  | 'slip1'
  | 'slip2'
  | 'gully'
  | 'point'
  | 'backward_point'
  | 'deep_point'
  | 'cover'
  | 'deep_cover'
  | 'deep_extra_cover'
  | 'mid_off'
  | 'mid_on'
  | 'midwicket'
  | 'deep_midwicket'
  | 'square_leg'
  | 'backward_square'
  | 'third_man'
  | 'fine_leg';

export interface FieldPosition {
  /** Fielding position (unique within a setting). */
  role: FieldRole;
  /** The zone the fielder stands in (and covers, unless a close catcher). */
  zone: FieldZone;
  /** Degrees from straight down the ground, positive = off side. */
  bearingDeg: number;
  /** Metres from the striker. */
  distanceM: number;
  kind: FieldPositionKind;
}

const P = (role: FieldRole, zone: FieldZone, bearingDeg: number, distanceM: number, kind: FieldPositionKind): FieldPosition => ({ role, zone, bearingDeg, distanceM, kind });

/** Nine fielders per setting (the bowler and the wicketkeeper are not listed). */
export const FIELD_POSITIONS: Readonly<Record<FieldSetting, readonly FieldPosition[]>> = {
  // Ring everywhere but third man and fine leg (gaps); two slips and a gully for the edges.
  attacking: [
    P('slip1', 'third_man', 160, 7, 'close'),
    P('slip2', 'third_man', 150, 8, 'close'),
    P('gully', 'point', 114, 11, 'close'),
    P('point', 'point', 98, 20, 'ring'),
    P('cover', 'cover', 62, 22, 'ring'),
    P('mid_off', 'mid_off', 20, 24, 'ring'),
    P('mid_on', 'mid_on', -20, 24, 'ring'),
    P('midwicket', 'midwicket', -62, 22, 'ring'),
    P('square_leg', 'square_leg', -100, 20, 'ring'),
  ],
  // Gaps at mid-off and midwicket; third man and fine leg back on the rope; one slip.
  balanced: [
    P('slip1', 'third_man', 160, 7, 'close'),
    P('point', 'point', 96, 21, 'ring'),
    P('backward_point', 'point', 113, 22, 'ring'),
    P('cover', 'cover', 62, 23, 'ring'),
    P('mid_on', 'mid_on', -18, 25, 'ring'),
    P('square_leg', 'square_leg', -98, 22, 'ring'),
    P('backward_square', 'square_leg', -113, 22, 'ring'),
    P('third_man', 'third_man', 145, 56, 'deep'),
    P('fine_leg', 'fine_leg', -145, 56, 'deep'),
  ],
  // Deep on the off side, at midwicket and behind; mid-off and square leg in the ring; mid-on is the open gap.
  sweeper: [
    P('mid_off', 'mid_off', 20, 24, 'ring'),
    P('square_leg', 'square_leg', -98, 22, 'ring'),
    P('backward_square', 'square_leg', -113, 22, 'ring'),
    P('deep_extra_cover', 'cover', 50, 58, 'deep'),
    P('deep_cover', 'cover', 68, 58, 'deep'),
    P('deep_point', 'point', 100, 58, 'deep'),
    P('third_man', 'third_man', 145, 56, 'deep'),
    P('fine_leg', 'fine_leg', -145, 56, 'deep'),
    P('deep_midwicket', 'midwicket', -60, 58, 'deep'),
  ],
};
