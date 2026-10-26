/**
 * Gesture tracker: the state machine behind GestureSurface, free of the DOM so it can be tested with exact timestamps.
 * One gesture per arming (one per delivery):
 *
 *   armed press      pointer-down → swing start at once (onSwingStart), then
 *                      - no movement beyond the threshold for TAP_DECIDE_MS, or lifted without moving → a tap
 *                      - movement beyond the threshold → a flick, emitted once READ_WINDOW_MS of movement is
 *                        covered by samples, at pointer-up, or READ_GRACE_MS after the window if the finger stopped
 *   resting finger   a pointer already down when the tracker is armed starts its swing at its first intentional
 *                    movement (and never as a tap: lifting a resting finger is not a shot)
 *   keyboard         Space / Enter → defence at the key's timestamp (same start rule and bat travel as a tap);
 *                    W/↑ forward (twice quickly: down the track), S/↓ back, the off-side arrow across, the leg-side
 *                    arrow back to automatic footwork
 *
 * Nothing waits for pointer-up. Samples live only until the gesture is emitted.
 */
import type { Footwork, GestureInput, GestureSample, Handedness } from '@/contracts/practice';
import { DOWN_TRACK_DOUBLE_MS, READ_WINDOW_MS, TAP_DECIDE_MS } from './constants';
import { crossingIndex, moveThreshold, onsetIndex } from './normalize';

/** After the read window, how long a flick may go without a new sample before it counts as stopped. */
export const READ_GRACE_MS = 25;

export type PointerKind = GestureInput['pointer'];

export interface TrackerEvents {
  swingStart(atPerfMs: number, pointer: PointerKind): void;
  gesture(input: GestureInput): void;
}

export interface TrackerScheduler {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
}

const defaultScheduler: TrackerScheduler = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

type Mode = 'resting' | 'pressing' | 'flicking' | 'spent';

interface Active {
  id: number;
  kind: PointerKind;
  samples: GestureSample[];
  mode: Mode;
  onsetMs: number;
}

export type KeyResult = 'swing' | 'footwork' | 'ignored';

export class GestureTracker {
  private armed = false;
  private enabled = false;
  private active: Active | null = null;
  private timer: unknown = null;
  private surface = { width: 1, height: 1 };
  private footworkDefault: Footwork = 'auto';
  private footworkKey: Footwork | null = null;
  private lastForwardMs = Number.NEGATIVE_INFINITY;
  private handedness: Handedness = 'right';

  constructor(
    private readonly events: TrackerEvents,
    private readonly sched: TrackerScheduler = defaultScheduler,
  ) {}

  setSurface(width: number, height: number) {
    if (width > 0 && height > 0) this.surface = { width, height };
  }
  setFootwork(f: Footwork) {
    this.footworkDefault = f;
  }
  setHandedness(h: Handedness) {
    this.handedness = h;
  }
  isArmed(): boolean {
    return this.armed;
  }

  /** Enables or disables input. A rising edge arms one gesture; a pointer already down becomes a resting finger. */
  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) this.arm();
    else this.disarm();
  }

  /** Arms a fresh gesture for a new delivery (while enabled). */
  rearm() {
    if (this.enabled) this.arm();
  }

  private arm() {
    this.clearTimer();
    this.armed = true;
    this.footworkKey = null;
    this.lastForwardMs = Number.NEGATIVE_INFINITY;
    const a = this.active;
    if (a) {
      // Already down: only its movement from here on can start a swing.
      a.mode = 'resting';
      a.samples = a.samples.length ? [a.samples[a.samples.length - 1]] : [];
    }
  }

  private disarm() {
    this.clearTimer();
    this.armed = false;
    if (this.active) {
      this.active.mode = 'resting';
      this.active.samples = this.active.samples.slice(-1);
    }
  }

  pointerDown(id: number, kind: PointerKind, sample: GestureSample) {
    if (this.active) return;
    const pressing = this.armed;
    this.active = { id, kind, samples: [sample], mode: pressing ? 'pressing' : 'resting', onsetMs: sample.t };
    if (!pressing) return;
    this.events.swingStart(sample.t, kind);
    this.schedule(sample.t + TAP_DECIDE_MS, () => {
      if (this.active?.mode === 'pressing') this.emit();
    });
  }

  pointerMove(id: number, samples: readonly GestureSample[]) {
    const a = this.active;
    if (!a || a.id !== id || a.mode === 'spent') return;
    for (const s of samples) {
      const last = a.samples[a.samples.length - 1];
      if (!last || s.t >= last.t) a.samples.push(s);
    }
    this.advance(a);
  }

  pointerUp(id: number, sample: GestureSample | null) {
    const a = this.active;
    if (!a || a.id !== id) return;
    if (sample && (a.mode === 'pressing' || a.mode === 'flicking')) {
      const last = a.samples[a.samples.length - 1];
      if (!last || sample.t >= last.t) a.samples.push(sample);
      if (a.mode === 'pressing') this.advance(a);
    }
    if (a.mode === 'pressing' || a.mode === 'flicking') this.emit();
    this.active = null;
  }

  pointerCancel(id: number) {
    this.pointerUp(id, null);
  }

  /** A key press (event.code, event.timeStamp). Repeats are ignored. */
  key(code: string, t: number, repeat = false): KeyResult {
    if (!this.enabled) return 'ignored';
    const swingKey = code === 'Space' || code === 'Enter' || code === 'NumpadEnter';
    if (swingKey) {
      if (repeat) return this.armed ? 'swing' : 'ignored';
      if (!this.armed || (this.active && this.active.mode !== 'resting')) return 'ignored';
      this.events.swingStart(t, 'keyboard');
      this.emitKeyboard(t);
      return 'swing';
    }
    if (repeat) return 'ignored';
    const offKey = this.handedness === 'left' ? ['KeyA', 'ArrowLeft'] : ['KeyD', 'ArrowRight'];
    const legKey = this.handedness === 'left' ? ['KeyD', 'ArrowRight'] : ['KeyA', 'ArrowLeft'];
    if (code === 'KeyW' || code === 'ArrowUp') {
      this.footworkKey = this.footworkKey === 'forward' && t - this.lastForwardMs <= DOWN_TRACK_DOUBLE_MS ? 'down_track' : 'forward';
      this.lastForwardMs = t;
      return 'footwork';
    }
    if (code === 'KeyS' || code === 'ArrowDown') {
      this.footworkKey = 'back';
      return 'footwork';
    }
    if (offKey.includes(code)) {
      this.footworkKey = 'across';
      return 'footwork';
    }
    if (legKey.includes(code)) {
      this.footworkKey = 'auto';
      return 'footwork';
    }
    return 'ignored';
  }

  /** Footwork the next gesture will carry (a key chosen this delivery, else the on-screen default). */
  footwork(): Footwork {
    return this.footworkKey ?? this.footworkDefault;
  }

  dispose() {
    this.clearTimer();
    this.active = null;
    this.armed = false;
    this.enabled = false;
  }

  // ---- internals ------------------------------------------------------------------------------------------------

  private advance(a: Active) {
    const thr = moveThreshold(this.surface);
    if (a.mode === 'resting') {
      if (!this.armed || a.samples.length < 2) {
        if (!this.armed) a.samples = a.samples.slice(-1);
        return;
      }
      const end = a.samples.length - 1;
      const o = onsetIndex(a.samples, end);
      const s = a.samples;
      if (o < end && Math.hypot(s[end].x - s[o].x, s[end].y - s[o].y) > thr) {
        // A resting finger moves on purpose: the swing starts where that movement began.
        a.samples = s.slice(o);
        a.mode = 'flicking';
        a.onsetMs = a.samples[0].t;
        this.events.swingStart(a.onsetMs, a.kind);
        this.scheduleRead(a);
      } else if (o === end) {
        // Still: keep only the latest position as the anchor for the next movement.
        a.samples = [s[end]];
      }
      return;
    }
    if (a.mode === 'pressing') {
      const c = crossingIndex(a.samples, thr);
      const first = a.samples[0].t;
      if (c >= 0 && a.samples[c].t - first <= TAP_DECIDE_MS) {
        a.mode = 'flicking';
        a.onsetMs = a.samples[onsetIndex(a.samples, c)].t;
        this.scheduleRead(a);
      } else if (a.samples[a.samples.length - 1].t - first >= TAP_DECIDE_MS) {
        // No movement beyond the threshold in time (even if a late batch of samples moves afterwards): a tap.
        this.emit();
        return;
      }
    }
    if (a.mode === 'flicking' && a.samples[a.samples.length - 1].t >= a.onsetMs + READ_WINDOW_MS) this.emit();
  }

  private scheduleRead(a: Active) {
    this.schedule(a.onsetMs + READ_WINDOW_MS + READ_GRACE_MS, () => {
      if (this.active === a && a.mode === 'flicking') this.emit();
    });
  }

  private emit() {
    const a = this.active;
    if (!a || !this.armed) return;
    this.clearTimer();
    this.armed = false;
    // A tap carries only what was seen by its decision time, so normalizeGesture reads exactly the same tap.
    const first = a.samples[0]?.t ?? 0;
    const samples = a.mode === 'pressing' ? a.samples.filter((s) => s.t - first <= TAP_DECIDE_MS) : a.samples;
    const input: GestureInput = { pointer: a.kind, samples, surface: { ...this.surface }, footwork: this.footwork() };
    a.mode = 'spent';
    a.samples = [];
    this.events.gesture(input);
  }

  private emitKeyboard(t: number) {
    this.clearTimer();
    this.armed = false;
    const input: GestureInput = {
      pointer: 'keyboard',
      samples: [{ t, x: this.surface.width / 2, y: this.surface.height / 2 }],
      surface: { ...this.surface },
      footwork: this.footwork(),
    };
    this.events.gesture(input);
  }

  private schedule(atMs: number, fn: () => void) {
    this.clearTimer();
    this.timer = this.sched.setTimer(() => {
      this.timer = null;
      fn();
    }, Math.max(0, atMs - this.sched.now()));
  }

  private clearTimer() {
    if (this.timer !== null) this.sched.clearTimer(this.timer);
    this.timer = null;
  }
}
