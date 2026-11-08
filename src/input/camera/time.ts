/**
 * Camera frame timestamps on the performance clock (the input owner's timestamp rule, docs/PRACTICE_CAMERA_INPUT.md §5).
 *
 * A swing is timed from the moment the player MOVED, so every sample is stamped with the frame's capture time, not with the
 * moment inference finished. A frame that arrives late therefore keeps its true time; only the moment the tracker learns of it
 * is later. Everything stays on the main thread's performance.now() clock (a worker's performance.now() has another origin, so
 * the worker only ever returns durations), the same clock as pointer events (src/input/pointer.ts eventTime).
 */

/** The part of requestVideoFrameCallback's metadata that matters (Chromium gives captureTime for camera frames). */
export interface FrameMeta {
  captureTime?: number;
  presentationTime?: number;
  expectedDisplayTime?: number;
}

/** A capture time this far in the past is not believed (a stalled pipeline, a wrong clock): the arrival time is used. */
export const MAX_FRAME_AGE_MS = 500;
/** A capture time later than the arrival time by more than this is not believed either. */
export const MAX_FRAME_FUTURE_MS = 2;
/** The smallest step between two frames' times; keeps time strictly increasing. */
export const MIN_FRAME_STEP_MS = 0.5;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * The frame's time on the performance clock: its capture time when the browser gives one that makes sense, else its
 * presentation time, else `now`; never in the future, never older than MAX_FRAME_AGE_MS, always after `prev`.
 */
export function normalizeFrameTime(meta: FrameMeta | undefined, now: number, prev: number): number {
  let t = finite(meta?.captureTime) ? meta.captureTime : finite(meta?.presentationTime) ? meta.presentationTime : now;
  if (t > now + MAX_FRAME_FUTURE_MS || t < now - MAX_FRAME_AGE_MS) t = now;
  if (finite(prev) && t <= prev) t = prev + MIN_FRAME_STEP_MS;
  return t;
}
