/**
 * The first-ball lesson as a small pure state machine. It paces the moment BEFORE the first ball and nothing else:
 * the ball is not bowled while the lesson is open; the delivery, its physics and its result are the same with or
 * without it (the lesson never reaches the physics, the flow only waits).
 *
 *   waiting  the ghost loops and the card waits, however long the player takes
 *   tried    the player made a real hit move on the lesson's own surface (a dry swing: nothing is bowled)
 *   bowl     the player chose to bowl the first ball (the lesson is done)
 *   skipped  the player chose "Skip all teaching" (the lesson is done, for good)
 *
 * A move that is not a hit (a tap, a pull-back with no flick) only produces a plain-words note; it costs nothing and
 * the card stays. Nothing here has a timer: doing nothing changes nothing.
 */
import type { NormalizedSwing } from '@/contracts';
import type { OneGestureState } from '@/input';
import type { LessonInput } from './inputType';

export type LessonStatus = 'waiting' | 'tried' | 'bowl' | 'skipped';

/** The plain-words notes (src/i18n/practice lesson.note.*) for a move that is not a hit. */
export type LessonNote = 'tap' | 'pull' | 'key_defend' | 'camera';

/** The part of a dry swing the card reads back (the same fields the dead ball's "You played" line uses). */
export type LessonRead = Pick<NormalizedSwing, 'kind' | 'directionDeg' | 'power' | 'elevation'>;

export interface LessonState {
  status: LessonStatus;
  /** The input the card teaches now: it follows the input the player uses. */
  input: LessonInput;
  note: LessonNote | null;
  /** The last dry hit, as read by the same normalizer as a real swing. */
  read: LessonRead | null;
  /** Dry hits so far. */
  tries: number;
  /** The camera has lost the player (only ever true with the camera input). */
  cameraLost: boolean;
  /** Moves made on the card so far: dry hits and wrong-moment moves alike (a count for the test hooks, nothing more). */
  acts: number;
  /** performance.now() when the card opened (0 when the caller gave none): the ghost's loops are counted from it. */
  shownAtPerfMs: number;
}

export type LessonEvent =
  | { type: 'input'; input: LessonInput }
  | { type: 'hit'; read: LessonRead }
  | { type: 'block' }
  | { type: 'pulled' }
  | { type: 'tracking'; tracking: boolean }
  | { type: 'bowl' }
  | { type: 'skipAll' };

export function startLesson(input: LessonInput, shownAtPerfMs = 0): LessonState {
  return { status: 'waiting', input, note: null, read: null, tries: 0, cameraLost: false, acts: 0, shownAtPerfMs };
}

export const isLessonOver = (s: LessonState): boolean => s.status === 'bowl' || s.status === 'skipped';

export function lessonReducer(s: LessonState, e: LessonEvent): LessonState {
  if (isLessonOver(s)) return s;
  switch (e.type) {
    case 'input':
      if (e.input === s.input) return s;
      // Another input: the card re-teaches it; a note about the old one no longer applies.
      return { ...s, input: e.input, note: null, cameraLost: e.input === 'camera' ? s.cameraLost : false };
    case 'hit':
      return { ...s, status: 'tried', note: null, read: e.read, tries: s.tries + 1, acts: s.acts + 1 };
    case 'block':
      return { ...s, note: s.input === 'keyboard' ? 'key_defend' : 'tap', acts: s.acts + 1 };
    case 'pulled':
      return { ...s, note: 'pull', acts: s.acts + 1 };
    case 'tracking':
      if (s.input !== 'camera') return s;
      return { ...s, cameraLost: !e.tracking, note: e.tracking ? (s.note === 'camera' ? null : s.note) : 'camera' };
    case 'bowl':
      return { ...s, status: 'bowl', note: null };
    case 'skipAll':
      return { ...s, status: 'skipped', note: null };
  }
}

/** A finished dry swing (a tap, an arrow key, a flick) as a lesson event. A null swing is a leave: no event. */
export function eventOfSwing(swing: LessonRead | null): LessonEvent | null {
  if (!swing) return null;
  return swing.kind === 'attack' ? { type: 'hit', read: swing } : { type: 'block' };
}

/** The tracker's state for the dry swing as a lesson event: a pull-back let go without a flick is "pulled". */
export function eventOfContact(state: Pick<OneGestureState, 'phase'>): LessonEvent | null {
  return state.phase === 'intentional_leave' ? { type: 'pulled' } : null;
}
