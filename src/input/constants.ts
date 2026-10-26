/**
 * The input model's numbers, in one place (docs/PRACTICE_PRESENTATION.md, "Input mapping", explains each one).
 * Distances are CSS pixels or fractions of the gesture surface's shorter side, so a flick means the same on a phone,
 * a tablet and a desktop window. Times are milliseconds on the performance.now() clock of the events themselves.
 */

/** Movement that turns a press into a flick: this fraction of the surface's shorter side, clamped to [minPx, maxPx]. */
export const MOVE_THRESHOLD = { frac: 0.04, minPx: 7, maxPx: 18 } as const;

/** A press that has not moved beyond the threshold this long after it began is a tap: the defensive straight bat. */
export const TAP_DECIDE_MS = 50;

/** Direction, bat speed and elevation are read from this much movement after the flick begins (brief: 30–50 ms). */
export const READ_WINDOW_MS = 40;

/** A flick lifted almost at once is still read over at least this long (never extrapolated beyond its samples). */
export const MIN_READ_MS = 12;

/** Speed (CSS px per ms) that marks intentional movement: the flick's onset is where this run of movement began. */
export const ONSET_SPEED_PX_PER_MS = 0.08;

/**
 * Bat speed: the flick's average speed over the read window, in surface lengths (shorter side) per second, mapped
 * linearly from `lo` (power ATTACK_MIN_POWER) to `hi` (power 1).
 */
export const POWER_SPEED = { lo: 1.2, hi: 9 } as const;
export const ATTACK_MIN_POWER = 0.12;
/** A tap's fixed, low bat speed. */
export const DEFEND_POWER = 0.2;

/**
 * Elevation from the flick's length (path length over the read window, as a fraction of the shorter side):
 *  - a SHORT flick (the finger lifts, or stops, within the window) stays along the ground: 0 … groundMax by length;
 *  - a LONG flick (still travelling when the window closes) is lofted: loftFrom … 1 by length.
 * "Still travelling" means samples reach the end of the window and the speed over its last `tailMs` is at least
 * `stillRatio` of the window's average speed.
 */
export const ELEVATION = { groundMax: 0.3, loftFrom: 0.45, lengthLo: 0.06, lengthHi: 0.32, tailMs: 12, stillRatio: 0.5 } as const;

/** Calibration ("tap when the ball crosses the line"): attempts farther out than this are rejected, the median is clamped. */
export const CALIBRATION = { rejectAbsMs: 300, minMs: -60, maxMs: 220 } as const;

/** Keyboard footwork: a second forward press within this long means down the track. */
export const DOWN_TRACK_DOUBLE_MS = 350;

/** Stored precision of a normalized swing (keeps records compact and identical across devices). */
export const PRECISION = { startT: 1e-4, directionDeg: 0.1, unit: 1e-3 } as const;
