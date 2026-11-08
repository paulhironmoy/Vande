/**
 * What to tell a player who is not yet seen. All of it is read from the core's PoseReadiness (the fields it already
 * reports), so the words can never claim something the core did not measure. Pure functions; the copy keys are
 * `practice.camera.guide.*`, `practice.camera.frame.*` and `practice.camera.ready.*`.
 *
 * Order matters: the most useful thing first. A dark picture is said before anything about position, because no
 * position fixes it; "step into view" comes before the finer hints because there is nothing finer to say without a body.
 */
import type { PoseReadiness } from './ports';

/** The single line shown under the preview while the camera looks for the player. */
export type FrameHint =
  /** Seen and steady: the next ball may start. */
  | 'ok'
  | 'dark'
  | 'step_in'
  | 'too_close'
  | 'too_far'
  | 'arms_out'
  /** Seen, but the hands are not yet where they wait, or are moving: hold them in front, still. */
  | 'hands'
  /** Nothing to say yet; the core is still looking. */
  | 'finding';

/** How long the core may look in silence before "Step into view" replaces "Looking for you". */
export const FINDING_MS = 3000;

export function hintOf(r: PoseReadiness, lost = false, waitedMs = 0): FrameHint {
  if (r.ready && !lost) return 'ok';
  if (r.poorLight) return 'dark';
  if (lost) return 'step_in';
  if (!r.shoulders) return r.head || waitedMs >= FINDING_MS ? 'step_in' : 'finding';
  if (r.distance === 'too_close') return 'too_close';
  if (r.distance === 'too_far') return 'too_far';
  if (!r.battingHand) return 'arms_out';
  if (!r.handsReadyZone || !r.still) return 'hands';
  return 'finding';
}

/** The badge beside the preview: `yes` (the green "You are in frame"), `no` (seen, but not yet in frame), `finding` (nothing yet). */
export type FrameBadge = 'yes' | 'no' | 'finding';

export function badgeOf(r: PoseReadiness, lost = false): FrameBadge {
  if (r.inFrame && !lost) return 'yes';
  if (lost || r.shoulders || r.head || r.distance !== 'unknown') return 'no';
  return 'finding';
}

/** A person is tracked well enough to swing (the first-ball lesson's `tracking()`): in frame and not lost. */
export function isTracking(r: PoseReadiness, lost: boolean): boolean {
  return r.inFrame && !lost;
}
