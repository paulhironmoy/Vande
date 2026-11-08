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
import type { AssistLevel, BallAge, BallCondition, PitchCondition, TimingBands } from '@/contracts/practice';
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

/**
 * The ball's age (BallCondition.age, fixed for an over). A new ball swings and seams exactly as calibrated here. A worn
 * one (about 40+ overs: the shine has gone, the seam is flatter, the surface scuffed) keeps 60% of its swing
 * coefficient and 75% of its seam deviation at the bounce: it moves the same way, only less. Neither the spin, the
 * cutter's grip nor the pitch changes with age. The colour (red or white) is presentation only. There is no reverse
 * swing: a worn ball never swings towards its shine.
 */
export const BALL_AGE_FACTORS: Readonly<Record<BallAge, { readonly swing: number; readonly seam: number }>> = {
  new: { swing: 1, seam: 1 },
  worn: { swing: 0.6, seam: 0.75 },
};
/** The ball when none is given (a delivery record saved before balls had a condition replays with it). */
export const DEFAULT_BALL: Readonly<BallCondition> = Object.freeze({ colour: 'white', age: 'new' });

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
/**
 * Yorker lengths (≤ this). Before PHYS phase 4 (2026-11-03) automatic footwork dug them out from the crease (back
 * plane, 1.05 m in front of the stumps). There the ball reaches the bat 5 cm in front of the planted torso, and a
 * straight bat grounded beside it needs the hands at 0.74-0.86 m. No candidate stroke passes the anatomy certificate
 * (torso, pad and toe-ground clearance, reach within the contract's 0.18 m crouch cap), so the fallback lifted its
 * aim to 0.31 m and every straight bat passed over the reference yorker. Automatic footwork now smothers it on the
 * forward stride; an explicit back-foot dig-out remains a body-model limitation.
 */
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
/**
 * Radius of the rounded toe (m): the blade's profile is rounded where the face and the back meet the toe, so a ball
 * met at the toe sees a contact normal that turns continuously from the face normal to the toe's. ASSUMPTION (PHYS2
 * phase 5, 2026-11-03): no verifiable public source for a cricket bat's toe radius was found (Law 5 and Appendix B
 * fix length, width, depth and edge, not the toe's shape); 0.01 m is an engineering value, below the 25 mm
 * half-thickness of the collision slab. Sensitivity at 5, 10 and 20 mm is in
 * release/product-sequence/stage-1-practice/wedge/physics/phase5. The ball collision uses this solid; anatomical
 * admission keeps the enclosing box (a superset, so its clearances stay conservative).
 */
export const BLADE_TOE_R = 0.01;
/** Handle length (≤ 52% of the bat) and the one cross-platform hand-centre contract below the handle cap. */
export const HANDLE_L = 0.3;
export const TOP_HAND_FROM_CAP = 0.025;
export const LOWER_HAND_FROM_CAP = 0.125;
/** Gloves and handle as a capsule around the handle (radius). */
export const GLOVE_R = 0.05;
/** Sweet spot: fraction of the blade from the toe (contract: ≈ 0.22). */
export const SWEET_U = 0.22;
/** A sweet-spot hit: within this distance along the blade and across the face of the sweet spot. */
export const SWEET_ALONG_M = 0.06;

/**
 * Bat–ball impact. COR ≈ 0.5 at the sweet spot (Penrose et al.; Mehta & Pallis), falling along the blade
 * (quadratically, to 35% at ±COR_ALONG_M) and across it (twisting; −35% at the edge of the face). The effective bat
 * mass at the sweet spot (bat and hands) is set by the measured collision efficiency of a held cricket bat: a ball
 * meeting a still bat at 100 km/h comes back at about 20 km/h, and off a moving one it leaves at about 0.2 × its
 * speed + 1.2 × the bat's (R. Cross, "Physics of cricket", University of Sydney): (e − m/M)/(1 + m/M) = 0.2 with
 * e = 0.52 and m = 0.16 kg gives M ≈ 0.6 kg. Edges twist the bat and present far less mass. A dead bat with soft
 * hands is the same bat with a low restitution (DEFEND_COR): the ball dies on it and drops in front.
 */
export const BAT_COR = 0.52;
export const COR_ALONG_M = 0.15;
/** Towards the toe the restitution falls faster: the toe end is the bat's free end, where the blade vibrates most. */
export const COR_ALONG_TOE_M = 0.1;
/**
 * The swing's arc: the bat turns about an instantaneous centre near the hands (the bottom hand is 0.64 m above the
 * sweet spot, the centre about 0.2 m further back as the hands themselves move forward). A point on the blade moves
 * at (its distance from that centre) / SWING_PIVOT_M of the sweet spot's speed and presents (SWING_PIVOT_M /
 * distance)² of its effective mass (a pendulum about the centre), capped at SWING_MASS_CAP: a ball met up the blade,
 * towards the shoulder, meets a slower bat and comes off weak; one met towards the toe meets a lighter one.
 */
export const SWING_PIVOT_M = 0.84;
export const SWING_MASS_CAP = 4;
export const COR_ALONG_FLOOR = 0.35;
export const COR_ACROSS_LOSS = 0.35;
export const COR_EDGE = 0.32;
export const BAT_EFF_MASS = 0.6;
export const EDGE_EFF_MASS = 0.22;
export const BAT_FRICTION = 0.25;
/** A defensive block with soft hands: a dead bat. */
export const DEFEND_COR = 0.3;
export const DEFEND_EFF_MASS = 0.6;
/** Pads and body (static rebound). */
export const PAD_COR = 0.25;
export const PAD_FRICTION = 0.3;

/** Bat speed at the sweet spot (m/s): attack 8 + 24·power (≈ 29–115 km/h), defence a fixed gentle push. */
export const BAT_SPEED = { attackMin: 8, attackRange: 24, defend: 2 } as const;
/**
 * A vertical-bat stroke off the back foot (or across) is a punch: no stride to swing through and a checked follow-
 * through, so the bat reaches this fraction of the speed the same swing has off a front-foot stride. The horizontal
 * back-foot strokes (cut, pull, hook) are full swings and keep their speed.
 */
export const BACK_FOOT_PUNCH = 0.75;

/**
 * Virtual bat travel (ms) from swing start to the contact zone: defence 120 ms; an attacking swing 120 + 30·power ms
 * (a harder hit needs a bigger backlift, so it must start earlier). The brief's 120–150 ms range.
 */
export const BAT_TRAVEL_MS = { defend: 120, attackMin: 120, attackRange: 30 } as const;

/**
 * Shot geometry: where each stroke's bat path can put the sweet spot (src/physics/shot.ts). A stroke is one form of
 * bat, vertical or horizontal, with its reach at the contact plane: `x` is the line of the ball (m from middle stump,
 * + towards the off side), `y` its height (m), `loftY` the heights it can be got under when the ball is hit in the
 * air. The numbers are orthodox batting (MCC Coaching Manual: play with the line; drive the ball that is pitched up;
 * back foot to the ball short of a length; cut the short wide ball, pull and hook the short one at the body) set in
 * the bat's and the body's geometry (a 0.86 m bat whose sweet spot is 0.64 m below the bottom hand; BODY, batterBody):
 *  - with the line: a straight stroke meets balls between leg stump and just outside off; an off-side drive or punch
 *    needs the ball on or outside off stump, the square drive and the cut need width; an on-side stroke needs the
 *    ball on the stumps or the pads (to hit a ball from outside off to the leg side is to play across the line);
 *  - a front-foot drive is played to the ball pitched up, met at the pitch of it below the shin-pad's top (0.4 m);
 *    a ball higher than that has pitched short of the stride and is still rising (driving on the up);
 *  - a vertical bat reaches the ground (the toe) and, standing tall on the back foot, about 1.1 m (defence, hands
 *    high: 1.28 m); the back-foot punch through the off side is played to the ball that sits up (0.62–1.15 m);
 *  - a horizontal bat is held between the waist and the top of the head: the pull and the cut take balls from about
 *    0.85 m (0.55 m for a cut, which chops down) to 1.4–1.5 m, the hook from 1.1 m to 1.85 m;
 *  - to loft the ball the bat must get under it: the face opens only on the rising part of the swing's arc, ahead
 *    of its lowest point at the front foot, so a front-foot drive lofts a ball between the toes and the shin
 *    (0.08–0.4 m: the half-volley, a full ball met at the pitch); on the back foot the vertical bat is still coming
 *    down at contact, so it lofts nothing above the shin (0.32 m) and the punch only the ball that sits up to the
 *    waist (0.75–0.95 m). A good-length ball is lofted by getting to the pitch of it, or with a horizontal bat.
 * Beyond its reach the stroke still swings: the ball meets the bat as far from the sweet spot as it lay outside the
 * reach, so it edges, finds the toe, the shoulder or the gloves, or passes the bat.
 */
export const SHOT_FORMS = {
  forward_defence: { horizontal: 0, x: [-0.32, 0.5], y: [0, 0.95], loftY: [0, 0.95] },
  back_defence: { horizontal: 0, x: [-0.32, 0.5], y: [0, 1.28], loftY: [0, 1.28] },
  straight_drive: { horizontal: 0, x: [-0.12, 0.2], y: [0, 0.4], loftY: [0.08, 0.36] },
  off_drive: { horizontal: 0, x: [0, 0.3], y: [0, 0.4], loftY: [0.08, 0.36] },
  cover_drive: { horizontal: 0, x: [0.04, 0.5], y: [0.04, 0.4], loftY: [0.1, 0.34] },
  square_drive: { horizontal: 0, x: [0.16, 0.7], y: [0.04, 0.42], loftY: [0.12, 0.34] },
  steer: { horizontal: 0, x: [0.15, 0.7], y: [0.04, 0.7], loftY: [0.2, 0.45] },
  on_drive: { horizontal: 0, x: [-0.22, 0.08], y: [0, 0.4], loftY: [0.08, 0.36] },
  flick: { horizontal: 0, x: [-0.48, 0.05], y: [0, 0.7], loftY: [0.1, 0.45] },
  glance: { horizontal: 0, x: [-0.55, 0], y: [0, 0.8], loftY: [0.15, 0.55] },
  back_drive: { horizontal: 0, x: [-0.12, 0.22], y: [0, 1.1], loftY: [0.2, 0.32] },
  back_punch: { horizontal: 0, x: [0.04, 0.5], y: [0.62, 1.15], loftY: [0.75, 0.95] },
  back_on_punch: { horizontal: 0, x: [-0.24, 0.08], y: [0, 1.1], loftY: [0.2, 0.32] },
  cut: { horizontal: 1, x: [0.18, 0.85], y: [0.55, 1.4], loftY: [0.8, 1.5] },
  clip: { horizontal: 0, x: [-0.48, 0.06], y: [0, 0.95], loftY: [0.25, 0.5] },
  pull: { horizontal: 1, x: [-0.48, 0.3], y: [0.85, 1.5], loftY: [0.9, 1.45] },
  back_glance: { horizontal: 0, x: [-0.55, 0.02], y: [0, 1.1], loftY: [0.25, 0.6] },
  hook: { horizontal: 1, x: [-0.5, 0.22], y: [1.1, 1.85], loftY: [1.1, 1.8] },
} as const satisfies Record<string, { horizontal: 0 | 1; x: readonly [number, number]; y: readonly [number, number]; loftY: readonly [number, number] }>;
/**
 * The swing's arc near its lowest point: the sweet spot's path curves with this radius (m; flatter than the arm's
 * length because the hands drive forward through the stroke). The batter sets that lowest point at the ball's height
 * within the stroke's reach; a ball above the reach is met on the rising part of the arc, where the face has opened
 * by acos(1 − Δ / R) for a ball Δ above it: it pops up (driving on the up, fending at a lifting ball). A horizontal
 * bat's arc is horizontal: a ball above its reach meets the top edge instead (the collision finds it).
 */
export const SWING_ARC_R = 2.5;
/** A back-foot leg-side stroke is a clip (vertical bat) below this height and a pull above; a fine one a glance or a hook. */
export const SHOT_SWITCH_Y = { pull: 0.85, hook: 1.0 } as const;
/** Width of the height band over which a back-foot leg-side stroke turns from the vertical form to the horizontal (m). */
export const SHOT_SWITCH_BAND_M = 0.16;
/**
 * Lofting: the elevation input from which the stroke needs the ball in its loft heights, and from which it fully
 * does: from a launch at the horizontal (0.08 → 0°) to 15° (0.45), the face opened under the ball.
 */
export const SHOT_LOFT_FROM = 0.08;
export const SHOT_LOFT_FULL = 0.45;
/** A harder swing is committed earlier: each reach range shrinks towards its middle by this × power² of its half-width. */
export const SHOT_POWER_SHRINK = 0.35;

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
 * ± ms around the ideal contact, per assistance level: the declared timing labels (perfect, solid, mistimed beyond,
 * missed beyond the edge). Lead decision 2026-11-03: the labels follow the physics. Real is set from the measured
 * physical windows of the reference over (PHYS phase 3, `wedge/physics/phase3/timing-windows.json`): perfect inside
 * every in-reach attacking sweet window, solid inside every face window, edge beyond them. Learn and Play keep the
 * brief's forgiveness ratios to Real (35/25, 75/55, 125/80 and 55/25, 110/55, 170/80, rounded to whole ms), so inside
 * the edge band a Learn or Play error still maps onto almost the same Real error, and the label is the Real label of
 * that error. Beyond the edge the map has slope 1, as before, from the new edge. The bat's own physical
 * rates are BAT_TIMING_CALIBRATION below and do not move with these labels. Before 2026-11-03: learn 55/110/170,
 * play 35/75/125, real 25/55/80, which labelled 7–16 ms of non-sweet contacts "perfect" and 33–46 ms of edges and
 * misses "solid" on the reference drives.
 */
export const TIMING_BANDS: Record<AssistLevel, TimingBands> = {
  learn: { perfectMs: 31, solidMs: 58, edgeMs: 117 },
  play: { perfectMs: 20, solidMs: 40, edgeMs: 86 },
  real: { perfectMs: 14, solidMs: 29, edgeMs: 55 },
};

/**
 * The virtual bat's own timing calibration (ms of Real-equivalent error): the rates at which timing error moves the
 * bat across the line (DRIFT_M_PER_MS), sizes the sweet zone across the face (SWEET_ACROSS_M) and grows the drift
 * velocity (bat.ts timingDriftVelocityScale), and the error beyond which the planner stops searching near the planned
 * contact (bat.ts, the >edge shortcut). These are physics rates, not labels: they stay fixed when the declared label
 * bands above are recalibrated to the measured windows, so relabelling never moves the bat.
 */
export const BAT_TIMING_CALIBRATION: TimingBands = { perfectMs: 25, solidMs: 55, edgeMs: 80 };

/**
 * The Real label bands, the target of the Learn/Play forgiveness map: Learn and Play map a timing error onto the
 * Real error with the same outcome (piecewise linear through the band edges, timing.ts forgive), and the Assisted
 * performance tier adds its tolerance to all three band edges in Learn and Play, never in Real (activeBands).
 */
export const PHYSICAL_BANDS: TimingBands = TIMING_BANDS.real;
/** Lateral bat drift across the line per ms of (Real-equivalent) timing error. */
export const DRIFT_M_PER_MS = BLADE_HALF_W / BAT_TIMING_CALIBRATION.solidMs;
/** Lateral sweet zone: the drift at the perfect limit. */
export const SWEET_ACROSS_M = DRIFT_M_PER_MS * BAT_TIMING_CALIBRATION.perfectMs;
/** Face rotation per ms of timing error: early closes the face (towards leg), late opens it; early tilts it up. */
export const FACE_YAW_DEG_PER_MS = 0.3;
export const FACE_TILT_DEG_PER_MS = 0.2;
export const DEFEND_FACE_YAW_DEG_PER_MS = 0.2;
/**
 * How long before the bat reaches the zone the batter commits to the line he has read (ms). One read model for every
 * level (F-019): the levels differ only by their declared timing bands (and the device allowance in Learn and Play),
 * so reading late movement learnt in Learn transfers to Real. 150 ms: international batsmen could not adjust their
 * stroke to a deviation off the pitch within about 190 ms (P. McLeod, "Visual reaction time and high-speed ball games",
 * Perception 16, 1987), so swing, seam, drift and turn in the last 150 ms beat the bat.
 */
export const COMMIT_BEFORE_MS: Record<AssistLevel, number | null> = { learn: 150, play: 150, real: 150 };
