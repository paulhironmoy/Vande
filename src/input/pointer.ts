/**
 * The one place pointer events are read: each event's own high-resolution timestamp (never the handler's
 * performance.now()), coalesced move events, the pointer kind, and positions relative to a surface. Practice's
 * GestureSurface and the match's batting traces (InputTrace: [ms since the first sample, x 0..1, y 0..1]) both read
 * pointers through here.
 */
import type { GestureSample } from '@/contracts/practice';

export type PointerKind = 'touch' | 'mouse' | 'pen';

/**
 * An event's timestamp on the performance.now() clock. Every current engine stamps events on it; an epoch-based or
 * missing stamp (very old WebViews, synthetic test events) falls back to now.
 */
export function eventTime(e: Event): number {
  const t = e.timeStamp;
  return t > 0 && t < 1e11 ? t : typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function pointerKind(e: PointerEvent): PointerKind {
  return e.pointerType === 'mouse' ? 'mouse' : e.pointerType === 'pen' ? 'pen' : 'touch';
}

/** The move events a pointermove stands for (coalesced samples since the last frame), oldest first. */
export function coalesced(e: PointerEvent): PointerEvent[] {
  const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
  return list.length ? list : [e];
}

/** A sample in CSS px relative to a surface's rectangle. */
export function sampleIn(e: PointerEvent, rect: { left: number; top: number }): GestureSample {
  return { t: eventTime(e), x: e.clientX - rect.left, y: e.clientY - rect.top };
}

export type TraceSample = [number, number, number];

export interface TraceOptions {
  /** Most samples kept (the first is always kept). */
  maxSamples?: number;
  /** Decimals of the normalized coordinates (default 4). */
  decimals?: number;
}

/**
 * Records one press as a trace: [ms since the press (0.1 ms), x, y normalized to the surface 0..1], with event
 * timestamps and coalesced moves, strictly increasing in time.
 */
export class PointerTrace {
  readonly pointer: PointerKind;
  /** Timestamp of the press (performance.now() clock). */
  readonly t0: number;
  readonly samples: TraceSample[];
  private readonly max: number;
  private readonly k: number;

  constructor(down: PointerEvent, private rect: { left: number; top: number; width: number; height: number }, o: TraceOptions = {}) {
    this.pointer = pointerKind(down);
    this.t0 = eventTime(down);
    this.max = o.maxSamples ?? 200;
    this.k = 10 ** (o.decimals ?? 4);
    const [x, y] = this.norm(down);
    this.samples = [[0, x, y]];
  }

  private norm(e: PointerEvent): [number, number] {
    const x = (e.clientX - this.rect.left) / Math.max(1, this.rect.width);
    const y = (e.clientY - this.rect.top) / Math.max(1, this.rect.height);
    const r = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * this.k) / this.k;
    return [r(x), r(y)];
  }

  /** Milliseconds since the press for an event (0.1 ms). */
  elapsed(e: Event): number {
    return Math.round((eventTime(e) - this.t0) * 10) / 10;
  }

  /** Adds the samples of a move (coalesced), keeping time strictly increasing. */
  move(e: PointerEvent): void {
    for (const ev of coalesced(e)) this.add(ev);
  }

  /** Adds the release (or any final) sample. */
  end(e: PointerEvent): void {
    this.add(e, true);
  }

  private add(e: PointerEvent, force = false): void {
    const t = this.elapsed(e);
    const last = this.samples[this.samples.length - 1];
    if (t <= last[0]) return;
    if (!force && this.samples.length >= this.max) return;
    const [x, y] = this.norm(e);
    if (force && this.samples.length >= this.max) this.samples[this.samples.length - 1] = [t, x, y];
    else this.samples.push([t, x, y]);
  }
}
