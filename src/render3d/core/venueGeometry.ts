/**
 * Where the stands, the fascia ribbon, the roof and the sight-screen gaps are, in metres, in the world frame of
 * `core/ground.ts` (origin mid-pitch, +y up; azimuth 0 is towards the striker's end, +z, and azimuth PI towards the
 * bowler's end, so a point of the ring at azimuth a, radius r and height y is (r sin a, y, r cos a)).
 *
 * One source for the 3D stadium (`three/stadium.ts`), Classic's painted venue (`fallback2d/venuePaint.ts`) and the
 * baked venue's wedge modules (`three/venue*.ts`). Pure numbers: nothing here imports a rendering library, so the 2D
 * stage can use it without pulling in three.js.
 */
import { BOUNDARY_R, PITCH_HALF } from './ground';

/** One tier of stepped rows: it climbs from (r0, y0) to (r1, y1). */
export interface StandTier {
  readonly r0: number;
  readonly r1: number;
  readonly y0: number;
  readonly y1: number;
}

/** The two tiers behind the rope. Rows: 14 and 13 on the detailed tiers, 8 and 8 on the lite one (stadium.ts decides). */
export const STAND_TIERS: { readonly lower: StandTier; readonly upper: StandTier } = Object.freeze({
  lower: Object.freeze({ r0: BOUNDARY_R + 8, r1: BOUNDARY_R + 27, y0: 1.2, y1: 10.5 }),
  upper: Object.freeze({ r0: BOUNDARY_R + 30, r1: BOUNDARY_R + 47, y0: 13.5, y1: 27 }),
});

/** Rows per tier on the detailed (standard and high) tiers. */
export const STAND_ROWS = Object.freeze({ lower: 14, upper: 13 });

/** The ribbon between the tiers (the LED fascia): radius, centre height and height. */
export const FASCIA = Object.freeze({ r: BOUNDARY_R + 28.5, y: 12.4, h: 1.6 });

/**
 * The cantilever roof over the upper tier, as stadium.ts builds it (a cone strip): its inner, field-side edge is the high
 * one (radius `rInner`, height `y + h / 2`) and its outer edge the low one (radius `rOuter`, height `y - h / 2`).
 */
export const ROOF = Object.freeze({ rInner: BOUNDARY_R + 37, rOuter: BOUNDARY_R + 48.5, y: 30.6, h: 5.5 });

/** The back wall closing the upper tier (r, from y0 to y1) and the parapet in front of the lower tier (stadium.ts `wall`). */
export const BACK_WALL = Object.freeze({ r: BOUNDARY_R + 47.6, y0: 24, y1: 29 });
export const PARAPET = Object.freeze({ r: BOUNDARY_R + 7.5, y0: 0, y1: 1.6 });

/**
 * Half the width of the gap in both tiers behind each end for the sight screen (18 m wide at BOUNDARY_R + 6.5, plus
 * 1.5 m a side): `atan2(18 / 2 + 1.5, BOUNDARY_R + 6.5)`, the value stadium.ts derives from SIGHT_SCREEN.
 */
export const SIGHT_SCREEN_GAP_HALF = Math.atan2(18 / 2 + 1.5, BOUNDARY_R + 6.5);

/** The batter's eye (the same numbers as `BATTER_EYE` in `core/camera.ts`; a test pins them together). */
export const EYE = Object.freeze({ height: 1.68, z: PITCH_HALF - 1.2 });

/** A point of the ring at azimuth `a` (radians), radius `r` and height `y`. */
export const ringPoint = (a: number, r: number, y: number) => ({ x: Math.sin(a) * r, y, z: Math.cos(a) * r });

/** The azimuth of a world direction on the ground plane (0 towards +z, PI towards -z, positive towards +x). */
export const azimuthOf = (x: number, z: number) => Math.atan2(x, z);

/**
 * The height on a vertical wall `wallR` metres out (on the bowler's end axis) that the batter's eye sees at the same
 * elevation as the point (r, y) of the bowl: a picture painted on that wall from the nominal eye reads exactly like
 * the bowl does, whatever the real depth of each tier.
 */
export function wallHeight(r: number, y: number, wallR: number): number {
  return EYE.height + ((y - EYE.height) * (wallR + EYE.z)) / (r + EYE.z);
}
