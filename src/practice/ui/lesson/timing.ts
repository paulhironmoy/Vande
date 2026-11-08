/**
 * The plain-words timing note for the first balls (EXPERIENCE-CONSTITUTION, "proportional feedback"): early or late and
 * how much, in proportion to the error, taken straight from the physics' own reading of the swing.
 *
 * Nothing here has a window of its own. The size comes from the measured error (`contact.timingErrorMs`, + = late)
 * against the bands the delivery was judged by (the physics' activeBands for its assistance level and device allowance,
 * handed in by the kit), so it is a pure function of the error and grows with it; the side is the sign of the error. The
 * physics' own label (`contact.timing`) is the fallback when the bands are not known. It can read one step lower where the
 * bat met the ball (a bat that met the ball is never labelled "missed", src/physics/timing.ts), which is about contact and
 * not about how far out the timing was, so the words do not follow that cap. The scale only draws the same bands. A leave
 * has no error and no note.
 */
import type { ContactReport, TimingBands } from '@/contracts';

/** perfect = on time; solid = a touch; mistimed = early or late; missed = much too early or too late. */
export type TimingSize = 'on_time' | 'small' | 'medium' | 'large';
export type TimingSide = 'early' | 'late';

export interface TimingNote {
  size: TimingSize;
  /** Null only when on time with a zero error. */
  side: TimingSide | null;
  /** The physics' signed error (ms, + = late). */
  signedMs: number;
  /** The same, as the whole milliseconds the card says. */
  ms: number;
  /** The copy key under practice.lesson.timing. */
  key: 'on_time' | `${TimingSide}.${Exclude<TimingSize, 'on_time'>}`;
}

/** The balls the note is said for (teaching on): the first over, the same balls the first session glosses its words for. */
export const TIMING_NOTE_BALLS = 6;

const SIZES: Partial<Record<ContactReport['timing'], TimingSize>> = {
  perfect: 'on_time',
  solid: 'small',
  mistimed: 'medium',
  missed: 'large',
};

/** The size of an error inside a delivery's bands: the same comparison as the physics' classifyTiming (tested equal). */
export function sizeWithin(errorMs: number, bands: TimingBands): TimingSize {
  const a = Math.abs(errorMs);
  return a <= bands.perfectMs ? 'on_time' : a <= bands.solidMs ? 'small' : a <= bands.edgeMs ? 'medium' : 'large';
}

export function timingNote(
  contact: Pick<ContactReport, 'timing' | 'timingErrorMs'>,
  bands?: TimingBands | null,
): TimingNote | null {
  const err = contact.timingErrorMs;
  if (err === null || !Number.isFinite(err) || contact.timing === 'none') return null;
  const size = bands ? sizeWithin(err, bands) : SIZES[contact.timing];
  if (!size) return null;
  const ms = Math.round(Math.abs(err));
  const side: TimingSide | null = err < 0 ? 'early' : err > 0 ? 'late' : null;
  if (size === 'on_time') return { size, side, signedMs: err, ms, key: 'on_time' };
  // A label worse than perfect always has a side: a zero error cannot be mistimed.
  const s: TimingSide = side ?? 'late';
  return { size, side: s, signedMs: err, ms, key: `${s}.${size}` };
}

/** The drawn axis: the delivery's three bands (ms either side of ideal) and where this swing fell, -1 … 1. */
export interface TimingScale {
  /** Half the axis in ms: a little past the outer band, so a miss is drawn at the end and not off it. */
  halfMs: number;
  perfectMs: number;
  solidMs: number;
  edgeMs: number;
  /** -1 = far early … 0 = ideal … 1 = far late. */
  at: number;
}

export function timingScale(note: TimingNote, bands: TimingBands): TimingScale {
  const halfMs = Math.max(1, bands.edgeMs * 1.25);
  const at = Math.max(-1, Math.min(1, note.signedMs / halfMs));
  return { halfMs, perfectMs: bands.perfectMs, solidMs: bands.solidMs, edgeMs: bands.edgeMs, at };
}

/** Whether the dead ball says its timing in plain words: teaching on, and one of the first few deliveries. */
export function wantsTimingNote(teach: boolean, hintsShown: number): boolean {
  return teach && hintsShown >= 1 && hintsShown <= TIMING_NOTE_BALLS;
}
