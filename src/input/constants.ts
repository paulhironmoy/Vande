/**
 * The input model's numbers, in one place (docs/PRACTICE_INPUT.md explains each one).
 *
 * Distances are CSS pixels or REFERENCE LENGTHS: the gesture surface's shorter side, clamped to REFERENCE_PX, so a
 * swipe means much the same on a phone, a tablet and a desktop window. Times are milliseconds on the performance.now()
 * clock of the events themselves (never a frame time, never the moment a handler ran).
 *
 * The model in one breath: a tap (no movement) is the defensive straight bat, timed from the press; a swipe is an
 * attack timed from the moment its movement began (after any rest), whose direction is the swipe's direction, whose
 * power is its own speed and whose elevation is its reach. An ordinary swipe stays along the ground; only a long,
 * quick swipe is lofted. The press itself is the ready cue.
 */

/** The reference length: the surface's shorter side, clamped to [min, max] CSS px (a 915×412 phone: 189.5 px). */
export const REFERENCE_PX = { min: 180, max: 260 } as const;

/** Movement that turns a press into a swipe: this fraction of the reference length, clamped to [minPx, maxPx]. */
export const MOVE_THRESHOLD = { frac: 0.06, minPx: 10, maxPx: 16 } as const;

/**
 * A press lifted without moving within this long is a tap (a defence, timed from the press). Held longer without
 * moving, it is a finger waiting in anticipation: lifting it is not a shot, and its swipe, whenever it comes, is an
 * attack timed from that swipe's own start.
 */
export const TAP_HOLD_MS = 250;

/** The read: a swipe is read from its start until it lifts, stops, or this long after it started, whichever is first. */
export const READ_MAX_MS = 140;

/**
 * A swipe's start: the moment its movement left a circle of `radiusPx` around where the finger rested, interpolated
 * between the samples either side. A sample within `restPx` of the rest point counts as still at rest.
 */
export const DEPARTURE = { radiusPx: 2.5, restPx: 1 } as const;

/** How long past TAP_HOLD_MS or READ_MAX_MS the tracker waits for samples still on their way (frame-batched events). */
export const LATE_SAMPLE_WAIT_MS = 40;

/** A swipe lifted almost at once is still timed over at least this long. */
export const MIN_READ_MS = 20;

/**
 * The canonical one-contact stroke. A downward/backward movement first loads the bat; reversing into the forward
 * stroke commits it. The first 40 ms of that forward stroke is the authoritative read (30 ms is enough when the
 * contact ends earlier; 50 ms is the hard upper bound for a stable read). Distances are reference lengths unless a
 * property explicitly says px.
 *
 * These values describe the control, not an outcome. In particular, pullback only expresses an aggression/elevation
 * envelope; the fixed delivery and the physics still decide what the ball does.
 */
export const ONE_CONTACT = {
  /** Initial movement must be predominantly down the screen to be treated as a pullback instead of a legacy flick. */
  backwardDominance: 0.72,
  /** A reversal must travel at least the normal movement threshold before it is an intentional forward stroke. */
  forwardThresholdScale: 1,
  /** Stable forward-motion window, measured from the interpolated reversal onset. */
  forwardReadMinMs: 30,
  forwardReadMs: 40,
  forwardReadMaxMs: 50,
  /** A pullback of this depth (reference lengths) fills the aggression envelope. */
  fullPullback: 0.72,
  /** This much forward path (reference lengths) fills its contribution to the aggression envelope. */
  fullForwardPath: 0.82,
  /** Small expert lateral adjustment while loaded; only used for footwork when that expert control is enabled. */
  lateralFootwork: 0.06,
  /** A stationary backlift held this long is unambiguously deliberate even without a lateral refinement. */
  intentionalLeaveHoldMs: 250,
  /** Intent below this remains grounded; intent above it maps continuously into elevation. */
  loftIntentFrom: 0.42,
} as const;

/** The finger has stopped when it stays within `epsPx` of where it ends for at least `ms`. */
export const STILL = { epsPx: 2, ms: 25 } as const;

/** A swipe that comes back by more than this share of its farthest reach is read at its farthest point. */
export const TURN_BACK_RATIO = 0.85;

/**
 * Power from the swipe's average speed `v` (reference lengths per second), linear in log(v): `lowSpeed` gives
 * `lowPower`, `fullSpeed` gives 1, never below `min`. Equal ratios of speed are equal steps of power, so a 10% faster
 * swipe is always about 0.035 more power: continuous, monotonic, and no plateau over ordinary swipes.
 */
export const POWER_CURVE = { lowSpeed: 2, lowPower: 0.2, fullSpeed: 20, min: 0.12 } as const;
/** A tap's fixed, low bat speed (the physics uses its own defensive bat speed for every defence). */
export const DEFEND_POWER = 0.2;

/**
 * Elevation from the swipe's reach (straight-line distance from the press to where the read ends, in reference
 * lengths): 0 up to `from`, rising linearly to 1 at `full`. Ordinary swipes (up to about 200 px on a phone) never
 * reach `from`, so they stay along the ground; the loft is a deliberately long, quick swipe.
 */
export const LOFT_REACH = { from: 1.1, full: 1.6 } as const;

/** Intentional movement: a run of movement at least this fast (px per ms); slower drift only moves the rest point. */
export const ONSET_SPEED_PX_PER_MS = 0.08;
/**
 * A still finger may send no samples at all. When the last sample at rest is older than `ms`, the swipe's start inside
 * that silence is estimated by carrying its first moving sample back at the speed it was moving with (never below
 * `minPxPerMs`), and never before a straight interpolation from the rest sample.
 */
export const ONSET_GAP = { ms: 20, minPxPerMs: 0.4 } as const;

/**
 * Keyboard. Space or Enter defends. The arrows play an attacking shot in their direction on screen (two arrows within
 * `chordMs` make a diagonal), the numeric keypad's 1–9 too (5 defends); holding Shift lofts it. W, S and the side
 * letters choose footwork. Keys have no speed or reach, so their power and elevation are fixed.
 */
export const KEYBOARD = { chordMs: 40, power: 0.55, loftPower: 0.85, loftElevation: 0.75 } as const;

/** Keyboard footwork: a second forward press within this long means down the track. */
export const DOWN_TRACK_DOUBLE_MS = 350;

/**
 * Footwork by where the press lands (off until it is introduced; GestureSurface `pressFootwork`): measured down the
 * batting area from its top edge, a press above `forwardAbove` steps forward, one below `backBelow` goes back, and the
 * middle band leaves the footwork automatic. Known at the press itself, so the stride can start with the bat.
 */
export const PRESS_FOOTWORK = { forwardAbove: 0.38, backBelow: 0.62 } as const;

/** Calibration ("tap when the ball crosses the line"): attempts farther out than this are rejected, the median is clamped. */
export const CALIBRATION = { rejectAbsMs: 300, minMs: -60, maxMs: 220 } as const;

/** Stored precision of a normalized swing (keeps records compact and identical across devices). */
export const PRECISION = { startT: 1e-4, directionDeg: 0.1, unit: 1e-3 } as const;
