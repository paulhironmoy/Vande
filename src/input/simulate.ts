/**
 * Replays a finger (or mouse or pen) trajectory through the real GestureTracker on a simulated clock: the way the
 * browser would deliver it (each sample at its own time, or frame-aligned with or without coalesced samples, with an
 * optional dispatch delay), with the tracker's own timers. Deterministic, DOM-free, and loadable by Node's type
 * stripping, so tests and examiner scripts exercise the shipped state machine rather than an emulation of it.
 *
 *   const { gesture } = traceGesture({ surface: { width: 915, height: 190 }, samples, frameMs: 33, coalesced: false });
 *   const swing = gesture && normalizeGesture(gesture, { releasePerfMs, calibrationMs: 0, handedness: 'right' });
 */
import type { Footwork, GestureInput, GestureSample, Handedness } from '@/contracts/practice';
import { GestureTracker, type OneGestureState, type PointerKind, type SwingIntent, type TrackerScheduler } from './tracker';

export interface TraceOptions {
  /** Default 'touch'. */
  pointer?: Exclude<PointerKind, 'keyboard'>;
  /** The gesture surface in CSS px. */
  surface: { width: number; height: number };
  /** The digitizer's samples on the event clock (performance.now() ms): the first is the pointer-down. */
  samples: readonly GestureSample[];
  /** The last sample is the pointer-up (default true); false leaves the finger on the glass. */
  lifted?: boolean;
  /**
   * Frame-aligned delivery: moves are dispatched at the end of each `frameMs` frame (0 or absent: every sample at its
   * own time). The press and the lift are dispatched at once (pending moves are flushed before the lift).
   */
  frameMs?: number;
  /** With frame-aligned delivery: every sample of the frame (coalesced events, the default) or only its newest. */
  coalesced?: boolean;
  /** Dispatch delay added to every event (ms). */
  latencyMs?: number;
  /** When the tracker is armed (default: 1 ms before the first sample; later than the press makes a resting finger). */
  armAtMs?: number;
  footwork?: Footwork;
  /** Footwork by where the press lands (GestureSurface `pressFootwork`). */
  pressFootwork?: boolean;
  handedness?: Handedness;
  /** How long after the last event to keep the clock running for the tracker's timers (default 400 ms). */
  tailMs?: number;
}

export interface TraceResult {
  /** The emitted gesture (null: no swing, a leave). */
  gesture: GestureInput | null;
  /** When the tracker emitted it, on the simulated clock (ms), or null. */
  emittedAtMs: number | null;
  /** Every swingStart: the swing's own timestamp, and when it was reported. */
  starts: Array<{ atPerfMs: number; pointer: PointerKind; footwork: Footwork; reportedAtMs: number }>;
  intents: Array<SwingIntent & { reportedAtMs: number }>;
  states: Array<OneGestureState & { reportedAtMs: number }>;
}

type Delivery = { at: number; order: number; run: (tr: GestureTracker) => void };

/** A scheduler whose clock moves only when the simulation says so. */
function simClock(start: number) {
  let now = start;
  let next = 1;
  const timers: Array<{ at: number; id: number; fn: () => void }> = [];
  const sched: TrackerScheduler = {
    now: () => now,
    setTimer: (fn, ms) => {
      const id = next++;
      timers.push({ at: now + Math.max(0, ms), id, fn });
      return id;
    },
    clearTimer: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  /** Runs every timer due before `to` (strictly), then sets the clock to `to`. */
  const runUntil = (to: number, inclusive = false) => {
    for (;;) {
      let best = -1;
      for (let i = 0; i < timers.length; i++) if (best < 0 || timers[i].at < timers[best].at || (timers[i].at === timers[best].at && timers[i].id < timers[best].id)) best = i;
      if (best < 0) break;
      const t = timers[best];
      if (inclusive ? t.at > to : t.at >= to) break;
      timers.splice(best, 1);
      now = Math.max(now, t.at);
      t.fn();
    }
    now = Math.max(now, to);
  };
  return { sched, runUntil, now: () => now };
}

/** Plays one trajectory through a fresh GestureTracker and reports what it emitted. */
export function traceGesture(o: TraceOptions): TraceResult {
  const samples = o.samples;
  if (!samples.length) return { gesture: null, emittedAtMs: null, starts: [], intents: [], states: [] };
  const pointer = o.pointer ?? 'touch';
  const lifted = o.lifted !== false;
  const lat = o.latencyMs ?? 0;
  const t0 = samples[0].t;
  const armAt = o.armAtMs ?? t0 - 1;
  const clock = simClock(Math.min(armAt, t0) - 1);
  const result: TraceResult = { gesture: null, emittedAtMs: null, starts: [], intents: [], states: [] };
  const tracker = new GestureTracker(
    {
      swingStart: (atPerfMs, p, footwork) => result.starts.push({ atPerfMs, pointer: p, footwork, reportedAtMs: clock.now() }),
      gesture: (g) => {
        if (!result.gesture) {
          result.gesture = g;
          result.emittedAtMs = clock.now();
        }
      },
      intent: (i) => result.intents.push({ ...i, reportedAtMs: clock.now() }),
      state: (state) => result.states.push({ ...state, reportedAtMs: clock.now() }),
    },
    clock.sched,
  );
  tracker.setSurface(o.surface.width, o.surface.height);
  tracker.setFootwork(o.footwork ?? 'auto');
  tracker.setHandedness(o.handedness ?? 'right');
  tracker.setPressFootwork(o.pressFootwork === true);

  const out: Delivery[] = [];
  let order = 0;
  const add = (at: number, run: Delivery['run']) => out.push({ at, order: order++, run });
  add(armAt, (tr) => tr.setEnabled(true));
  add(t0 + lat, (tr) => tr.pointerDown(1, pointer, samples[0]));
  const moves = samples.slice(1, lifted ? -1 : undefined);
  const up = lifted && samples.length > 1 ? samples[samples.length - 1] : lifted ? samples[0] : null;
  const frame = o.frameMs && o.frameMs > 0 ? o.frameMs : 0;
  if (!frame) {
    for (const s of moves) add(s.t + lat, (tr) => tr.pointerMove(1, [s]));
  } else {
    // Frames end at t0 + k·frame; a frame's moves are dispatched together when it ends.
    const groups = new Map<number, GestureSample[]>();
    for (const s of moves) {
      const k = Math.max(1, Math.ceil((s.t - t0) / frame));
      const g = groups.get(k) ?? [];
      g.push(s);
      groups.set(k, g);
    }
    const upAt = up ? up.t : Number.POSITIVE_INFINITY;
    for (const [k, g] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
      const batch = o.coalesced === false ? [g[g.length - 1]] : g;
      // A frame that would end after the lift is flushed just before the lift instead.
      const at = Math.min(t0 + k * frame, upAt) + lat;
      add(at, (tr) => tr.pointerMove(1, batch));
    }
  }
  if (up) add(up.t + lat, (tr) => tr.pointerUp(1, up));
  out.sort((a, b) => a.at - b.at || a.order - b.order);
  for (const d of out) {
    clock.runUntil(d.at);
    d.run(tracker);
  }
  const lastAt = out.length ? out[out.length - 1].at : t0;
  clock.runUntil(lastAt + (o.tailMs ?? 400), true);
  tracker.dispose();
  return result;
}

/** A trajectory as the digitizer sees it: a press at `t0`, then positions every `rateMs` along `at(u)` (u: 0 → 1). */
export function sampleStroke(args: {
  t0: number;
  x0: number;
  y0: number;
  /** Displacement at progress u (0 → 1), in CSS px. */
  at: (u: number) => { dx: number; dy: number };
  durationMs: number;
  /** Still time before the stroke starts (the finger rests on the glass). */
  restMs?: number;
  /** Still time after it ends, before the lift (or before the samples end when not lifted). */
  holdMs?: number;
  rateMs?: number;
}): GestureSample[] {
  const rate = args.rateMs ?? 4;
  const rest = args.restMs ?? 0;
  const hold = args.holdMs ?? 0;
  const out: GestureSample[] = [{ t: args.t0, x: args.x0, y: args.y0 }];
  const start = args.t0 + rest;
  const end = start + args.durationMs;
  const stop = end + hold;
  for (let t = args.t0 + rate; t < stop + 1e-9; t += rate) {
    const u = t <= start ? 0 : t >= end ? 1 : (t - start) / args.durationMs;
    const d = args.at(u);
    out.push({ t, x: args.x0 + d.dx, y: args.y0 + d.dy });
  }
  // The stroke's end (and the lift, when it comes) at their exact times.
  const last = out[out.length - 1];
  if (last.t < stop - 1e-9) {
    const d = args.at(1);
    out.push({ t: stop, x: args.x0 + d.dx, y: args.y0 + d.dy });
  }
  return out;
}
