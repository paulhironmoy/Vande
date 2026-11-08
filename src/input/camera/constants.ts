/**
 * The camera input's numbers, in one place (docs/PRACTICE_CAMERA_INPUT.md explains each one).
 *
 * The camera becomes one "virtual finger" on a FIXED virtual surface, which the existing GestureTracker reads like any
 * other contact. Lengths on the body are in BODY UNITS (u): one u is the player's shoulder width in the picture, so the
 * distance from the camera does not change what a movement means. Speeds are u per second, times are milliseconds on the
 * performance.now() clock of the camera frames' capture time.
 *
 * These are the SAME on every delivery and for every player. They are tuned on synthetic traces only; what they feel like
 * to a person is UNPROVEN (human work). Nothing here looks at the ball, the delivery, the score or the result.
 */

/** The virtual surface: reference length 260 px, movement threshold 15.6 px (src/input/constants.ts). */
export const VIRTUAL_SURFACE = { width: 640, height: 260 } as const;
/** Where an at-rest contact sits on it (the press). Raising the hands moves it DOWN the surface (the pullback). */
export const VIRTUAL_ORIGIN = { x: 320, y: 130 } as const;

/** The tracker's pointer id for the camera's one contact (a DOM pointer id is never this large). */
export const CAMERA_POINTER_ID = 0x7ffe0001;

/** Landmark use. Visibility is the Tasks API's probability (0..1). */
export const POSE = {
  /** A jump of the shoulders between two frames (in u) or of the body scale (share) that no person makes: another person, a reset. */
  jumpU: 1.5,
  jumpScale: 0.3,
  /** Below this a landmark is not used; its weight rises linearly to 1 at `fullVisibility`. */
  minVisibility: 0.5,
  fullVisibility: 0.8,
  /** Shoulder width as a share of the frame width: outside, the player is too far or too close. */
  shoulderFrac: { min: 0.05, max: 0.55 },
  /** A wrist farther than this from its own shoulder (in u) is a teleporting outlier: its weight is zero. */
  reachU: 2.2,
  /** The slow average of the shoulder width (ms); frozen while a contact is open so a stroke's scale cannot change. */
  scaleTauMs: 400,
  /** A missing or invalid frame is held for at most this many frames and ms (never extrapolated); then tracking is lost. */
  coastFrames: 2,
  coastMs: 100,
  /** No valid frame for this long: tracking lost. */
  lostMs: 300,
} as const;

/** Gains from body movement to the virtual surface. */
export const GAIN = {
  /** px of virtual y per u of hand rise: a 1.2 u (about 48 cm) backlift fills the pullback intent (0.72 reference lengths). */
  backliftPxPerU: 156,
  /** Sideways movement while loading is halved so a diagonal raise still reads "predominantly down" to the tracker. */
  lateralLoad: 0.5,
  /**
   * Forward-stroke gain on both axes after the strike gate. An arm swings far slower than a finger flicks: the first
   * 40 ms of a fast arm swing is about 10% of the stroke. 7 makes a 160 ms swing read about 0.88 power, 250 ms about 0.47.
   */
  strike: 7,
} as const;

/** The rest position (where the hands wait) and its dead-band. */
export const REST = {
  /** While idle or loaded the output holds until the hand leaves this band (no filter lag on real movement). */
  deadBandU: 0.04,
  /** The rest anchor follows a steady hand only while it is no higher than this above the anchor. */
  followRiseU: 0.15,
  anchorTauMs: 1500,
  /** The hands are steady when they moved less than `steadyExtentU` (u, each axis) over `steadyWindowMs`. */
  steadyExtentU: 0.18,
  steadyWindowMs: 250,
} as const;

/** Opening the contact: the first sign of intentional movement while a delivery is live. */
export const ONSET = {
  /** Hand rise above the anchor that opens the contact (about 10 cm). */
  riseU: 0.25,
  /** On this many consecutive valid frames. */
  frames: 2,
  /** How many past frames are kept to find the last still frame (the press) and to replay the proving frames. */
  historyFrames: 24,
} as const;

/** The forward stroke: when the lowering of the hands counts as a stroke, and which kind. */
export const STRIKE = {
  /** Descent from the peak that can start a decision (about 8 cm). */
  descentU: 0.2,
  /** The sideways-to-down slope of the stroke is limited to this (about 72 degrees from straight). */
  maxSlope: 3,
  /** An attack needs a backlift of at least this (u, about 14 cm); a smaller one is at most a defence. */
  minPeakRiseU: 0.35,
  /** A short backlift (under `DEFENCE.maxPeakRiseU`) is an attack only from this mean descent speed (u/s since the peak). */
  attackUPerS: 2.0,
  /** A big backlift (at least `DEFENCE.maxPeakRiseU`) is an attack from this speed; slower is just lowering the hands. */
  minUPerS: 1.4,
  /**
   * The speed of the stroke is measured from the last frame within this of the highest rise (u): wide enough that landmark
   * noise during a hold cannot move it far from the real start of the descent.
   */
  speedEpsU: 0.06,
  /** A stroke must be decided within this long (ms) of the last frame near the top; a slower lowering is just lowering. */
  windowMs: 300,
  /** A frame this close to the highest rise (u) still counts as "at the top"; any lower frame is held back for the decision. */
  onsetEpsU: 0.003,
} as const;

/**
 * The stroke's samples are densified to this spacing (ms) between camera frames by straight lines, so the tracker reads a
 * continuous movement like a finger's (its "silence" rule would otherwise treat the 33 ms between frames as a pause and
 * place the swing's start late). 0 sends the frames as they are.
 */
export const STROKE_SAMPLE_MS = 5;

/** A short, gentle push (a small backlift, then a controlled push down) is the defensive straight bat: a tap at its onset. */
export const DEFENCE = {
  /**
   * The backlift height (u) that separates the small-backlift class (a defence, or a short quick shot) from the attacking class.
   * It belongs in the GAP between the two populations, not at the edge of the small one: a defensive lift is the hands going
   * from the waist to about the chest (roughly 0.3 to 0.5 u, 12 to 20 cm), an attacking backlift goes to the shoulders or above
   * (0.8 u and more). The measurement is not exact to better than about 0.1 u: the pose model's wrist error is 0.035 to 0.09 u
   * RMS and the shoulder width in the picture can differ by 12 to 18% from the player's real proportions (SYNTH-VIDEO-5,
   * 2026-11-08), so a boundary needs a margin of that size on both sides. 0.6 u is the middle of the gap. (It was 0.45, which
   * left a real small backlift on the line where noise decided.)
   */
  maxPeakRiseU: 0.6,
  /** Slower than this is not a push, it is lowering the hands. */
  minUPerS: 0.5,
  /** The synthetic tap is released this long after its press (well inside the tracker's 250 ms tap window). */
  tapMs: 40,
} as const;

/** Hands coming back down without a stroke. */
export const RELAX = {
  /** The hands are back when the rise is below this share of the peak ... */
  fracOfPeak: 0.35,
  /** ... or below this share of the onset rise, for this long. */
  holdMs: 120,
  /** A backlift this high and held this long was deliberate: coming back is a leave. Anything less was a fidget. */
  deliberatePeakU: 0.5,
  deliberateLoadedMs: 150,
  /** A loaded contact idle this long is dropped as a fidget. */
  maxLoadedMs: 20_000,
} as const;

/** After the swing was emitted, the contact is closed when the hands settle (steady for `holdMs`) or after `maxMs`. */
export const SETTLE = { holdMs: 150, maxMs: 700 } as const;

/** The readiness check before a delivery: "show your upper body and your batting hand" until a stable pose is seen. */
export const READY = {
  stableMs: 400,
  /** Hands at waist-to-chest height are the ready pose (u below the shoulder line). */
  handsBelowShoulderU: { min: 0.3, max: 2.2 },
  /** Shoulder width as a share of the frame width: about 4 m away ... about 1.1 m away (62 degree lens). */
  tooFarFrac: 0.08,
  tooCloseFrac: 0.3,
  /** Head height above the frame's top edge, in u, needed for raised hands to stay in view. */
  headroomU: 0.9,
} as const;

/** The camera capture request and its step-down ladder; the model's own limit is a person within about 4 m, head visible. */
export const CAPTURE = {
  width: 640,
  height: 480,
  frameRate: 30,
  /** The picture handed to the model is shrunk to this width (the model works at 256 px). */
  modelWidth: 384,
  /** Below this measured rate or above this inference time (p50), camera batting is not offered ("too slow"). */
  minFps: 20,
  maxInferenceMsP50: 45,
  /** A frame whose mean brightness (0..255) is below this for `blackFrames` frames is a black picture. */
  blackMean: 6,
  blackFrames: 30,
  /** Mean brightness below this is "poor light". */
  dimMean: 45,
} as const;
