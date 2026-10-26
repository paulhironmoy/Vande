/**
 * Cricket ground and wicket geometry (MCC Laws 4 and 6–8, and the VANDE stadium): the one source for everything that is
 * both drawn and collided with. Kept apart from the simulation constants (src/physics/constants.ts re-exports it) so
 * the app shell's field diagram can use it without pulling the physics tables into the first paint. Metres; world frame
 * as in src/contracts/practice.ts.
 */

/** Half of the 22-yard pitch (20.12 m between the stumps). Striker's stumps at z = +PITCH_HALF. */
export const PITCH_HALF = 10.06;
/** Pitch width, 10 ft (Law 6.1). */
export const PITCH_WIDTH = 3.05;
/** Popping crease, 4 ft in front of the stumps (Law 7.2). */
export const POPPING = 1.22;
/** Return creases, 4 ft 4 in either side of the middle stump (Law 7.4). */
export const RETURN_CREASE_X = 1.32;
/** Stump height above the ground, 28 in (Law 8.2). Bails excluded. */
export const STUMP_H = 0.711;
/** Bails may stand at most 0.5 in above the stumps (Law 8.3). */
export const BAIL_RISE = 0.0127;
/** Top of the wicket including the bails. */
export const STUMPS_TOP = STUMP_H + BAIL_RISE;
/** Width of the three stumps, 9 in (Law 8.2), and half of it. */
export const STUMPS_W = 0.2286;
export const STUMPS_HALF_W = STUMPS_W / 2;
/** Stump radius (diameter 1.375–1.5 in, Law 8.2). */
export const STUMP_R = 0.0175;
/** Centre-to-centre distance between adjacent stumps (outer stumps' outer edges are 9 in apart). */
export const STUMP_SPACING = STUMPS_HALF_W - STUMP_R;
/** Boundary rope radius from the pitch centre (the 3D stadium's rope). */
export const BOUNDARY_R = 62;
/** The 30-yard fielding circle. */
export const RING_R = 27.43;
/** Striker's reference point for bearings and distances (front of the popping crease, as the renderer uses). */
export const CONTACT_Z = PITCH_HALF - POPPING - 0.25;
export const STRIKER_REF = { x: 0, z: CONTACT_Z } as const;

/** The popping crease is marked at least 6 ft (1.83 m) either side of the middle stump (Law 7.2). */
export const POPPING_CREASE_HALF = 1.83;
/** Return creases (RETURN_CREASE_X either side) run from the popping crease to at least 8 ft (2.44 m) behind it (Law 7.4). */
export const RETURN_CREASE_LENGTH = 2.44;

/** Ball radius: circumference 22.4–22.9 cm (Law 4.1). */
export const BALL_R = 0.036;
