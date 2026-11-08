/**
 * The Director's two entry points.
 *
 *   prepare(anchors)             off the frame path (idle, or bowl()): the plan and its baked trace;
 *   sample(plan, tMs, out)       once per drawn frame: O(1), no allocation, scene time only.
 *
 * A pure function of (person, delivery key, anchors, scene time): no clock, no Math.random. Replays rebuild the plan
 * from the same key and anchors and give the same trace, bit for bit.
 */
import P from './params.json';
import { CH, CHANNELS, SCALE } from './channels';
import { bakeSteps, traceFrames, type BakeProgress } from './bake';
import { buildEvents } from './plan';
import { ballKey, personKey } from './seeds';
import type { Detail, DirectorAnchors, DirectorPlan } from './types';

/** The detail level for a head of `px` CSS pixels (hysteresis against the previous level when given). */
export function detailForPx(px: number, prev?: Detail): Detail {
  const [lo, hi] = P.detail.px;
  const h = P.detail.hyst;
  // With a previous level, a level is entered only 15% above its threshold and left only 15% below it.
  const up1 = prev === undefined ? lo : prev >= 1 ? lo * (1 - h) : lo * (1 + h);
  const up2 = prev === undefined ? hi : prev >= 2 ? hi * (1 - h) : hi * (1 + h);
  return px >= up2 ? 2 : px >= up1 ? 1 : 0;
}

/** A plan being baked a slice at a time (off the frame path, in the spare time of frames): see `startPrepare`. */
export interface PlanJob {
  /** True once the plan is ready. */
  readonly done: boolean;
  /** The finished plan; null until `done`. */
  readonly plan: DirectorPlan | null;
  /**
   * The plan being filled in (P3): the same object as `plan` once done. Its events and parameters are final from the start and
   * its trace is final up to `horizonMs`; `sample` is exact for any time before the horizon and holds zeros after it.
   */
  readonly partial: DirectorPlan;
  /** Scene time before which `partial` is final (a sample there is bit-equal to the finished plan's); infinite once done. */
  readonly horizonMs: number;
  /**
   * Runs up to `slices` slices of the bake and returns true once it is done. A slice is 64 integration steps (about a quarter
   * of a second of script) or 32 clip-head reads, about 10 to 300 us each; the caller decides how many to run per frame (the
   * Director itself reads no clock).
   */
  advance(slices: number): boolean;
  /** Runs slices until the plan is final before scene time `tMs` (or done); the number of slices it ran. */
  advanceTo(tMs: number): number;
}

/**
 * Starts baking a plan: the events are built now (a few microseconds), the trace a slice at a time by `advance`. The
 * plan is the same, bit for bit, however it is sliced and whether it is sliced at all (`prepare` is `startPrepare` run to
 * the end).
 */
export function startPrepare(a: DirectorAnchors, opts: { hz?: 60 | 120 | 240; reuse?: { plan: DirectorPlan; untilMs: number } } = {}): PlanJob {
  const hz = opts.hz ?? 60;
  const ev = buildEvents(a);
  const r = opts.reuse && opts.reuse.plan.hz === hz && opts.reuse.plan.t0 === a.start ? { trace: opts.reuse.plan.trace, untilMs: opts.reuse.untilMs } : undefined;
  const n = traceFrames(a, hz);
  const sub = Math.round(240 / hz);
  const trace = new Int16Array(n * CHANNELS);
  const progress: BakeProgress = { step: 0 };
  const steps = bakeSteps(a, ev, hz, r, trace, progress);
  const kept = r ? Math.max(0, Math.min(n, Math.floor((r.untilMs - a.start) / (1000 / hz)), r.trace.length / CHANNELS)) : 0;
  const partial: DirectorPlan = {
    ...ev,
    role: a.role,
    key: ballKey(a.key, personKey(a.person, a.role)),
    reducedMotion: a.reducedMotion,
    t0: a.start,
    hz,
    n,
    trace,
    detail: detailForPx(a.headPx),
  };
  let done = false;
  // Frames 0 .. final are final: the copied ones, and those written at a step already done.
  let final = kept - 1;
  const job: PlanJob = {
    get done() {
      return done;
    },
    get plan() {
      return done ? partial : null;
    },
    get partial() {
      return partial;
    },
    get horizonMs() {
      // `sample` at t reads frames floor(f) and floor(f) + 1, f = (t - t0) hz / 1000: both final when floor(f) + 1 <= final.
      return done ? Number.POSITIVE_INFINITY : a.start + (Math.max(0, final) * 1000) / hz;
    },
    advance(slices) {
      for (let i = 0; !done && i < slices; i++) {
        const r2 = steps.next();
        if (r2.done) {
          done = true;
          final = n - 1;
        } else {
          // the steps below progress.step are done: the frames written at them are final
          final = Math.max(final, Math.floor((progress.step - 1) / sub));
        }
      }
      return done;
    },
    advanceTo(tMs) {
      let ran = 0;
      while (!done && job.horizonMs <= tMs) {
        job.advance(1);
        ran++;
      }
      return ran;
    },
  };
  return job;
}

/**
 * Builds the plan and bakes its trace (`hz`: trace frames per second, 60, 120 or 240).
 *
 * `reuse` is for the hand-over from the live script to the result script: frames before `untilMs` are copied from the
 * earlier plan instead of being computed (so the clip's head is not asked for them). `untilMs` must not exceed the first
 * moment the new anchors matter: the earliest of contact + 125, outcomeAt + 180, strokeEnd and dead + 125 ms (honesty
 * tests prove the two traces are bit-equal before it). Ignored if the earlier plan has another rate or start.
 */
export function prepare(a: DirectorAnchors, opts: { hz?: 60 | 120 | 240; reuse?: { plan: DirectorPlan; untilMs: number } } = {}): DirectorPlan {
  const job = startPrepare(a, opts);
  while (!job.advance(1 << 20)) {
    /* advance runs to the end */
  }
  return job.plan!;
}

/**
 * Reads the trace at scene ms `tMs` into `out` (CHANNELS floats, channels.ts): linear between two frames, held at the
 * ends. `detail` (default the plan's) drops what is too small to see: 0 keeps the head overlay and life only, 1 adds
 * the eyes and lids, 2 the expressions.
 */
export function sample(plan: DirectorPlan, tMs: number, out: Float32Array, detail: Detail = plan.detail): Float32Array {
  const last = plan.n - 1;
  let f = ((tMs - plan.t0) * plan.hz) / 1000;
  f = f < 0 ? 0 : f > last ? last : f;
  let i = f | 0;
  if (i >= last) i = last > 0 ? last - 1 : 0;
  const w = last > 0 ? f - i : 0;
  const a = i * CHANNELS;
  const b = last > 0 ? a + CHANNELS : a;
  const tr = plan.trace;
  for (let c = 0; c < CHANNELS; c++) out[c] = (tr[a + c] + (tr[b + c] - tr[a + c]) * w) * SCALE[c];
  if (detail < 2) for (let c = CH.xConcentration; c <= CH.xCelebration; c++) out[c] = 0;
  if (detail < 1) for (let c = CH.eyeYawL; c <= CH.lidFollow; c++) out[c] = 0;
  return out;
}

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * `sample` for a script that loops at `loopMs` (a between-balls scene): in the last `fadeMs` of the loop the trace is
 * cross-faded into the pre-roll before its start (a plan with `seamMs` and `start = -seamMs`), so every channel reaches
 * the value the next loop starts from and nothing pops at the wrap. `scratch` holds the second read (CHANNELS floats).
 * `next` (P3, rolling laps): the plan of the following lap, whose pre-roll the end of this one is faded into (default: this plan's
 * own, so a scene that stands for a minute repeats; with `next` it never repeats).
 */
export function sampleWrapped(plan: DirectorPlan, tMs: number, loopMs: number, fadeMs: number, out: Float32Array, scratch: Float32Array, detail: Detail = plan.detail, next: DirectorPlan = plan): Float32Array {
  sample(plan, tMs, out, detail);
  if (tMs <= loopMs - fadeMs) return out;
  sample(next, tMs - loopMs, scratch, detail);
  const w = smooth((tMs - (loopMs - fadeMs)) / fadeMs);
  for (let c = 0; c < CHANNELS; c++) out[c] += (scratch[c] - out[c]) * w;
  return out;
}
