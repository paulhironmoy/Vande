/**
 * Practice physics constants: the ONE source of cricket constants and timing windows for Practice (and, through
 * re-exports, for the renderer's ground geometry). Units are SI (metres, seconds, kilograms) unless a name says ms or
 * km/h. World frame as in src/contracts/practice.ts: origin at the pitch centre on the ground, +Y up, +Z towards the
 * striker, +X = the striker's off side (physics always runs in the striker's own right-handed frame).
 *
 * Sources: MCC Laws of Cricket (2017 Code, 3rd edition 2022) for every dimension; R. D. Mehta, "Fluid mechanics of
 * cricket ball swing" (2005) and "An overview of cricket ball swing" (Sports Engineering, 2005) for drag and swing;
 * Robinson & Robinson, "The motion of an arbitrarily rotating spherical projectile and its application to ball games"
 * (Physica Scripta, 2013) for Magnus drift and dip; Carré, James & Haake, "Impact of a non-homogeneous sphere on a
 * rigid surface" and pitch-testing work (2004–2006) for pitch restitution and friction; Penrose, Hose & Trowbridge
 * (1998) and Mehta & Pallis (2001) for bat–ball restitution. docs/PRACTICE_PHYSICS.md explains each choice.
 */
import type { AssistLevel, PitchCondition, TimingBands } from '@/contracts/practice';
import { BALL_R, PITCH_HALF, POPPING } from './geometry';

// ---------------------------------------------------------------------------------------------------------------
// Ground and wickets: src/physics/geometry.ts (re-exported here, so this stays the one import for physics)
// ---------------------------------------------------------------------------------------------------------------

export * from './geometry';

// ---------------------------------------------------------------------------------------------------------------
// Ball (Law 4) and air
// ---------------------------------------------------------------------------------------------------------------

/** Ball mass: 155.9–163 g (Law 4.1). */
export const BALL_MASS = 0.16;
export const BALL_AREA = Math.PI * BALL_R * BALL_R;
/** Moment of inertia factor, I = k m R² (a cork-and-twine ball is close to a uniform sphere, k = 2/5). */
export const BALL_INERTIA_K = 0.4;

export const G = 9.81;
/** Air density (kg/m³) at about 25 °C near sea level. */
export const AIR_DENSITY = 1.18;
/** Drag coefficient of a seamed cricket ball at 20–45 m/s (Mehta: ≈ 0.35–0.5 below the drag crisis). */
export const DRAG_CD = 0.38;
/** Magnus lift: C_L = min(LIFT_CL_MAX, LIFT_CL_SLOPE × S), S = R·ω⊥ / |v| (spin parameter). */
export const LIFT_CL_SLOPE = 1.0;
export const LIFT_CL_MAX = 0.3;
/**
 * Conventional swing side-force coefficient for a well-presented seam (Mehta measured up to ≈ 0.3; Practice uses a
 * moderate value so swing reads clearly without being freakish). Swing fades above SWING_FADE_FROM_MS (the boundary
 * layer turns turbulent on both sides) down to SWING_FADE_FLOOR of its value at SWING_FADE_TO_MS.
 */
export const SWING_CS = 0.13;
export const SWING_FADE_FROM_MS = 34;
export const SWING_FADE_TO_MS = 42;
export const SWING_FADE_FLOOR = 0.55;
/** Spin decays slowly in flight (time constant, s); negligible over a delivery, visible on long hits. */
export const SPIN_DECAY_S = 12;

// ---------------------------------------------------------------------------------------------------------------
// Pitch and outfield
// ---------------------------------------------------------------------------------------------------------------

export interface PitchParams {
  /** Vertical coefficient of restitution of the pitch. */
  restitution: number;
  /** Coulomb friction between ball and pitch (longitudinal skid, speed loss off the pitch). */
  friction: number;
  /** Lateral seam deflection at the bounce (radians) for a seam landing fully angled; scaled per delivery. */
  seamGrip: number;
  /** Fraction (0..1) of the lateral rolling constraint the surface applies to side-spin: how much the ball turns. */
  turnGrip: number;
  /** Multiplier on swing in the air (humidity, lacquer, grass-polished ball). */
  swingFactor: number;
}

/** Balanced (default), Green (more seam and swing), Hard & Bouncy (more pace and bounce), Turning (grip and spin). */
export const PITCHES: Record<PitchCondition, PitchParams> = {
  balanced: { restitution: 0.6, friction: 0.3, seamGrip: 0.014, turnGrip: 0.55, swingFactor: 1.0 },
  green: { restitution: 0.58, friction: 0.27, seamGrip: 0.026, turnGrip: 0.45, swingFactor: 1.45 },
  hard: { restitution: 0.67, friction: 0.25, seamGrip: 0.012, turnGrip: 0.5, swingFactor: 0.85 },
  turning: { restitution: 0.55, friction: 0.4, seamGrip: 0.012, turnGrip: 0.95, swingFactor: 0.8 },
};

/**
 * Ploughing: a ball arriving at pace digs into the surface, so the longitudinal friction acts above the lowest point
 * and only this fraction of its impulse spins the ball. A rigid-sphere bounce would turn seam-up back-spin into
 * ≈ 40 rev/s of top-spin and a Magnus dip that real post-bounce trajectories do not show.
 */
export const PLOUGH_SPIN_FRACTION = 0.35;

/** Lateral friction available to turn the ball (caps the side impulse, as a multiple of the normal impulse). */
export const TURN_FRICTION_CAP = 0.6;

/** Outfield grass: bounces of a hit ball, then rolling with a constant resistance plus a speed-proportional drag. */
export const OUTFIELD = {
  restitution: 0.4,
  friction: 0.45,
  /** Rolling resistance (m/s²). */
  rollDecel: 0.5,
  /** Grass drag (1/s): a = rollDecel + rollDrag·v. A 90 km/h ground stroke rolls ≈ 60 m. */
  rollDrag: 0.35,
  /** Below this vertical speed after a bounce (m/s) the ball rolls. */
  rollVy: 0.6,
  /** Below this speed (m/s) the ball has stopped. */
  stopSpeed: 0.15,
} as const;

// ---------------------------------------------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------------------------------------------

/** Fixed integration step (s). Every trajectory is integrated on this grid with RK4 in a fixed operation order. */
export const SIM_DT = 0.001;
/** Default output spacing for post-contact simulation (steps per sample). Flights sample every step. */
export const POST_CONTACT_SAMPLE_EVERY = 5;
/** Longest post-contact simulation (s). */
export const MAX_SIM_S = 14;

// ---------------------------------------------------------------------------------------------------------------
// Bowling: release, speeds and realistic flight times
// ---------------------------------------------------------------------------------------------------------------

/**
 * Release geometry, over the wicket, in the striker's frame for a right-arm bowler (a left-arm bowler mirrors x).
 * Heights are a tall fast bowler's 2.05–2.30 m and a spinner's 1.80–2.00 m (chosen per bowler from lookSeed); the
 * hand is ≈ 0.4 m (pace) or 0.3 m (spin) to the off side of middle and ≈ 1.3–1.4 m in front of the bowler's stumps.
 */
export const RELEASE_GEOMETRY = {
  pace: { heightMin: 2.05, heightMax: 2.3, x: 0.42, z: -PITCH_HALF + 1.4 },
  spin: { heightMin: 1.8, heightMax: 2.0, x: 0.3, z: -PITCH_HALF + 1.28 },
} as const;

/**
 * The multiplayer match's release spot (its bowler animation releases there): right-arm over, 0.32 m (pace and swing)
 * or 0.22 m (spin) to the off side, 1.37 m in front of the bowler's stumps. flightFromPath() releases from here.
 */
export const MATCH_RELEASE = { paceX: 0.32, spinX: 0.22, z: -PITCH_HALF + POPPING + 0.15, heightMin: 1.5, heightMax: 2.6 } as const;
/** Per-ball pitch restitution range flightFromPath() may fit to match the server's height at the bat. */
export const MATCH_RESTITUTION: readonly [number, number] = [0.45, 0.75];

/** Release-speed bands (km/h) from the contract, plus the spin range Practice uses. */
export const PACE_BANDS_KPH = {
  controlled: [120, 130],
  fast: [131, 141],
  express: [142, 152],
} as const;
export const SPIN_KPH: readonly [number, number] = [75, 98];
/**
 * Range of ANY pace delivery the flight model handles and validates (km/h): stock bands plus the legitimate slower
 * variations below them (slower ball ≈ 0.8 × stock, cutter ≈ 0.91 × stock, Learn's genuinely slower stock ball).
 */
export const PACE_KPH: readonly [number, number] = [90, 155];

/**
 * Realistic release-to-arrival times (s) for STOCK deliveries (pace across PACE_BANDS_KPH, spin across SPIN_KPH):
 * the brief's reaction-time budget. Slower balls and Learn's slower pace legitimately take longer (that is their
 * point), up to SLOW_PACE_MAX_FLIGHT_S.
 */
export const FLIGHT_TIME_S = {
  pace: [0.42, 0.63],
  spin: [0.66, 0.97],
} as const;
/** Upper bound on the flight time of a slow pace ball (slower ball, cutter or Learn pace down to PACE_KPH[0]). */
export const SLOW_PACE_MAX_FLIGHT_S = 0.8;

/** Spin rates (rev/s): seam-up backspin for pace, and stock rates for spinners (≈ 1700–2000 rpm). */
export const SPIN_RPS = {
  paceBackspin: 13,
  seamBackspin: 17,
  cutter: 11,
  slower: 6,
  finger: 28,
  wrist: 30,
} as const;

/**
 * Contact planes: how far in front of the striker's stumps the ideal contact is, per footwork. Forward = beside a
 * full stride (the ball meets the bat next to the front pad); back = deep in the crease; down the track ≈ 1.1 m out.
 */
export const CONTACT_PLANE_M = {
  forward: 1.8,
  neutral: 1.5,
  back: 1.05,
  down_track: 2.9,
} as const;
/** Automatic footwork: forward to lengths fuller than this (m from the stumps), back to shorter ones. */
export const AUTO_FORWARD_MAX_LENGTH = { pace: 5.2, spin: 6.2 } as const;
/** Yorker lengths (≤ this) are dug out from the crease (back plane) rather than met on a stride. */
export const YORKER_MAX_LENGTH = 1.8;

// ---------------------------------------------------------------------------------------------------------------
// Bat (Law 5, Appendix B) and the virtual batter
// ---------------------------------------------------------------------------------------------------------------

/** Blade length toe → shoulder, width (≤ 4.25 in), edge thickness (≤ 1.56 in) and the collision slab thickness. */
export const BLADE_L = 0.56;
export const BLADE_W = 0.108;
export const BLADE_HALF_W = BLADE_W / 2;
export const EDGE_T = 0.04;
export const BLADE_T = 0.05;
/** Handle length (≤ 52% of the bat); the bottom hand's centre sits this far below the top of the handle. */
export const HANDLE_L = 0.3;
export const HANDS_FROM_TOP = 0.1;
/** Gloves and handle as a capsule around the handle (radius). */
export const GLOVE_R = 0.05;
/** Sweet spot: fraction of the blade from the toe (contract: ≈ 0.22). */
export const SWEET_U = 0.22;
/** A sweet-spot hit: within this distance along the blade and across the face of the sweet spot. */
export const SWEET_ALONG_M = 0.06;

/**
 * Bat–ball impact. COR ≈ 0.5 at the sweet spot (Penrose et al.; Mehta & Pallis), falling along the blade
 * (quadratically, to 35% at ±COR_ALONG_M) and across it (twisting; −35% at the edge of the face). The effective bat
 * mass at the sweet spot includes the hands; edges twist the bat and present far less mass.
 */
export const BAT_COR = 0.52;
export const COR_ALONG_M = 0.15;
export const COR_ALONG_FLOOR = 0.35;
export const COR_ACROSS_LOSS = 0.35;
export const COR_EDGE = 0.32;
export const BAT_EFF_MASS = 0.95;
export const EDGE_EFF_MASS = 0.35;
export const BAT_FRICTION = 0.25;
/** A defensive block with soft hands: a dead bat. */
export const DEFEND_COR = 0.3;
export const DEFEND_EFF_MASS = 0.7;
/** Pads and body (static rebound). */
export const PAD_COR = 0.25;
export const PAD_FRICTION = 0.3;

/** Bat speed at the sweet spot (m/s): attack 8 + 24·power (≈ 29–115 km/h), defence a fixed gentle push. */
export const BAT_SPEED = { attackMin: 8, attackRange: 24, defend: 2 } as const;

/**
 * Virtual bat travel (ms) from swing start to the contact zone: defence 120 ms; an attacking swing 120 + 30·power ms
 * (a harder hit needs a bigger backlift, so it must start earlier). The brief's 120–150 ms range.
 */
export const BAT_TRAVEL_MS = { defend: 120, attackMin: 120, attackRange: 30 } as const;

/** Batter's body: pads (vertical capsules), torso and head. */
export const BODY = {
  padR: 0.075,
  padBottom: 0.06,
  padTop: 0.62,
  torsoR: 0.16,
  torsoBottom: 0.7,
  torsoTop: 1.42,
  headR: 0.12,
  headY: 1.62,
} as const;

// ---------------------------------------------------------------------------------------------------------------
// Timing windows (the one source) and how timing error moves the virtual bat
// ---------------------------------------------------------------------------------------------------------------

/**
 * ± ms around the ideal contact, per assistance level. Learn and Play are the brief's numbers. Real has the brief's
 * perfect and solid bands; its edge limit is what the bat geometry honours. Timing error moves the bat across the
 * line at a rate that reaches the edge of the face (half the 108 mm blade) at the solid limit, so the ball could
 * touch the edge until its centre is one ball radius beyond it, (54 + 36) / 54 × 55 = 91.7 ms, if the face stayed
 * square; but the face rotates 0.30°/ms with the error and presents the edge obliquely, E = 91.7 × cos(0.30° × E),
 * which gives E ≈ 80 ms (measured by scripts/practice-physics-check.mjs).
 */
export const TIMING_BANDS: Record<AssistLevel, TimingBands> = {
  learn: { perfectMs: 55, solidMs: 110, edgeMs: 170 },
  play: { perfectMs: 35, solidMs: 75, edgeMs: 125 },
  real: { perfectMs: 25, solidMs: 55, edgeMs: 80 },
};

/**
 * The Real bands are the physical calibration of the virtual bat (identity mapping). Learn and Play map a timing
 * error onto the Real error with the same outcome (piecewise linear through the band edges), and the Assisted
 * performance tier adds its tolerance to all three band edges (see activeBands in contact.ts).
 */
export const PHYSICAL_BANDS: TimingBands = TIMING_BANDS.real;
/** Lateral bat drift across the line per ms of (Real-equivalent) timing error. */
export const DRIFT_M_PER_MS = BLADE_HALF_W / PHYSICAL_BANDS.solidMs;
/** Lateral sweet zone: the drift at the perfect limit. */
export const SWEET_ACROSS_M = DRIFT_M_PER_MS * PHYSICAL_BANDS.perfectMs;
/** Lift of the bat off the ball's line (toward the toe) per ms² of timing error: ≈ 7 cm at the edge limit. */
export const LIFT_M_PER_MS2 = 0.07 / (PHYSICAL_BANDS.edgeMs * PHYSICAL_BANDS.edgeMs);
/** Face rotation per ms of timing error: early closes the face (towards leg), late opens it; early tilts it up. */
export const FACE_YAW_DEG_PER_MS = 0.3;
export const FACE_TILT_DEG_PER_MS = 0.2;
export const DEFEND_FACE_YAW_DEG_PER_MS = 0.2;
/** How long before the bat reaches the zone the batter commits to the line he has read (ms), per level (null = tracks). */
export const COMMIT_BEFORE_MS: Record<AssistLevel, number | null> = { learn: null, play: 40, real: 80 };
