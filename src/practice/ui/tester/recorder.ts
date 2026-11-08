/**
 * The tester mode's recorder for one Practice visit: it writes only after the facilitator records consent, stamps
 * every event with the ms since the session began, and reads each gesture into closed facts (its class, how long the
 * press dwelt and lasted, how far it travelled), never its raw samples.
 */
import type { GestureInput, NormalizedSwing } from '@/contracts';
import { recordTesterAnswer, recordTesterEvent, setTesterSessionField, startTesterSession, type GestureClass, type TesterAnswer, type TesterCohort, type TesterEvent, type TesterSession } from '@/practice/store';
import { shotElevationRead } from '../coaching';
import { randomHex } from '../flow/core';

/** A press that moves less than this is still a tap (px); the input module owns the real threshold. */
const MOVE_PX = 6;

export interface GestureRead {
  pointer: string;
  dwellMs: number | null;
  durMs: number | null;
  lenFrac: number | null;
  travelling: boolean | null;
}

export function readGesture(input: GestureInput): GestureRead {
  const s = input.samples;
  if (!s.length) return { pointer: input.pointer, dwellMs: null, durMs: null, lenFrac: null, travelling: null };
  const first = s[0];
  const last = s[s.length - 1];
  const moved = s.find((p) => Math.hypot(p.x - first.x, p.y - first.y) > MOVE_PX);
  const len = Math.hypot(last.x - first.x, last.y - first.y);
  const prev = s.length > 1 ? s[s.length - 2] : first;
  const speed = last.t > prev.t ? Math.hypot(last.x - prev.x, last.y - prev.y) / (last.t - prev.t) : 0;
  return {
    pointer: input.pointer,
    dwellMs: moved ? Math.round(moved.t - first.t) : null,
    durMs: Math.round(last.t - first.t),
    lenFrac: input.surface.height > 0 ? Math.round((len / input.surface.height) * 100) / 100 : null,
    travelling: speed > 0.2,
  };
}

/**
 * The tester protocol's closed gesture class. Its two attack buckets use the same physics boundary as the player-facing
 * read: transitional/uppish strokes remain in the non-lofted bucket; only fully lofted intent is `flick_lofted`.
 */
export function gestureClass(pointer: string | null, swing: NormalizedSwing | null): GestureClass {
  if (!swing) return 'leave';
  if (pointer === 'keyboard') return 'key';
  if (swing.kind === 'defend') return 'tap';
  const elevation = shotElevationRead(swing.elevation);
  return elevation === 'lofted' ? 'flick_lofted' : 'flick_ground';
}

export class TesterRecorder {
  id: string | null = null;
  cohort: TesterCohort | null = null;
  private startedAt = 0;

  get active(): boolean {
    return this.id !== null;
  }

  begin(meta: Omit<TesterSession, 'id' | 'events' | 'answers' | 'startedAt' | 'consent'>): void {
    const id = `t-${randomHex(6)}`;
    if (!startTesterSession({ ...meta, id, consent: true, startedAt: new Date().toISOString() })) return;
    this.id = id;
    this.cohort = meta.cohort;
    this.startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  t(): number {
    return Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - this.startedAt);
  }

  /** An event, stamped now (the caller gives everything but the time). */
  event(e: DistributiveOmit<TesterEvent, 't'>): void {
    if (this.id) recordTesterEvent(this.id, { ...e, t: this.t() } as TesterEvent);
  }

  answer(a: TesterAnswer): void {
    if (this.id) recordTesterAnswer(this.id, a);
  }

  field(patch: Parameters<typeof setTesterSessionField>[1]): void {
    if (this.id) setTesterSessionField(this.id, patch);
  }

  end(): void {
    this.id = null;
    this.cohort = null;
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
