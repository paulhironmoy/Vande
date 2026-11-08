/**
 * Synthetic camera traces and a replay through the real CameraBatter, for tests and examiner scripts: the camera counterpart of
 * src/input/simulate.ts. Deterministic (seeded noise), DOM-free, loadable by Node's type stripping.
 *
 *   const frames = synthFrames({ hand: strokePath({ ... }), fps: 30, durationMs: 3000 });
 *   const { gesture, swing } = traceCamera({ frames, armAtMs: 500, handedness: 'right' });
 *
 * The body is drawn as a person facing the camera: shoulders, elbows, wrists and a nose, with a hand path given in body units
 * (u = shoulder width): height above the shoulder line and sideways (the player's right is +). These are SYNTHETIC trajectories,
 * not recognised human movement: what a real person's swing looks like to the model is UNPROVEN until people try it.
 */
import type { GestureInput, Handedness, NormalizedSwing } from '@/contracts/practice';
import { normalizeGesture } from '../normalize';
import type { OneGestureState, PointerKind, SwingIntent, TrackerScheduler } from '../tracker';
import { CameraBatter, type CameraBatterStatus } from './driver';
import { LANDMARK_COUNT, LANDMARK_STRIDE, LM, type PoseFrame } from './types';

/** Where the hands are, in body units, at a time (ms on the trace's own clock). */
export type HandPath = (tMs: number) => { h: number; x: number };

export interface BodyModel {
  /** Shoulder-middle position as a share of the picture. */
  centerX: number;
  shoulderY: number;
  /** Shoulder width as a share of the picture width (0.16 is about 2 m from a laptop camera). */
  shoulderFrac: number;
}

export const DEFAULT_BODY: BodyModel = { centerX: 0.5, shoulderY: 0.42, shoulderFrac: 0.16 };

/** mulberry32: a small seeded generator, so the same seed gives the same noise. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard normal from two uniforms (Box-Muller). */
export function gauss(r: () => number): number {
  const u = Math.max(1e-12, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

const minJerk = (s: number) => {
  const c = s <= 0 ? 0 : s >= 1 ? 1 : s;
  return 10 * c ** 3 - 15 * c ** 4 + 6 * c ** 5;
};

export interface StrokeSpec {
  /** When the rise starts (ms on the trace's clock). */
  startMs: number;
  /** Hand height at rest, in u relative to the shoulder line (negative = below the shoulders, waist is about -1.2). */
  restH?: number;
  /** How far the hands rise (u) and how long it takes (ms). */
  rise: number;
  riseMs: number;
  /** Held at the top (ms). */
  holdMs: number;
  /** Then they come down by `descent` (u) in `downMs`, drifting `lateral` u sideways (the player's right is +). */
  descent: number;
  downMs: number;
  lateral?: number;
  /** Sideways drift during the rise (u). */
  riseLateral?: number;
}

/** A hand path of one stroke: rest, rise, hold, descent (minimum-jerk each), then still at the end. */
export function strokePath(s: StrokeSpec): HandPath {
  const restH = s.restH ?? -1.2;
  const topAt = s.startMs + s.riseMs;
  const downAt = topAt + s.holdMs;
  return (t) => {
    if (t <= s.startMs) return { h: restH, x: 0 };
    if (t < topAt) {
      const m = minJerk((t - s.startMs) / s.riseMs);
      return { h: restH + s.rise * m, x: (s.riseLateral ?? 0) * m };
    }
    if (t < downAt) return { h: restH + s.rise, x: s.riseLateral ?? 0 };
    const m = minJerk((t - downAt) / s.downMs);
    return { h: restH + s.rise - s.descent * m, x: (s.riseLateral ?? 0) + (s.lateral ?? 0) * m };
  };
}

/** The moment the descent leaves the top by more than `eps` u (the true onset the tracker is trying to find). */
export function trueDescentOnset(s: StrokeSpec, eps = 0.01): number {
  const downAt = s.startMs + s.riseMs + s.holdMs;
  const path = strokePath(s);
  for (let t = downAt; t < downAt + s.downMs; t += 0.25) if (path(t).h < path(downAt).h - eps) return t;
  return downAt + s.downMs;
}

export interface SynthOptions {
  hand: HandPath;
  fps?: number;
  /** First frame's time and the trace length (ms). */
  t0?: number;
  durationMs?: number;
  width?: number;
  height?: number;
  body?: BodyModel;
  /** Landmark noise (u, standard deviation, per axis, independent per landmark and frame) and its seed. */
  noiseU?: number;
  seed?: number;
  /** A frame is dropped (no person found) when this returns true. */
  drop?: (index: number, tMs: number) => boolean;
  /** Frame time jitter (ms, uniform +-). */
  jitterMs?: number;
  /** The feed the model saw was mirrored (a selfie-flipped picture): x is flipped and the labels follow the picture layout. */
  mirrored?: boolean;
  /** The other hand trails the main one by this much sideways (u); the pair is two hands on a bat. */
  handSpreadU?: number;
  /** Wrist visibility (default 0.95). */
  visibility?: number;
}

/** Builds the pose frames of a hand path. A dropped frame has `landmarks: null`. */
export function synthFrames(o: SynthOptions): PoseFrame[] {
  const fps = o.fps ?? 30;
  const dt = 1000 / fps;
  const t0 = o.t0 ?? 0;
  const dur = o.durationMs ?? 3000;
  const W = o.width ?? 640;
  const H = o.height ?? 480;
  const body = o.body ?? DEFAULT_BODY;
  const noise = o.noiseU ?? 0;
  const r = rng(o.seed ?? 1);
  const vis = o.visibility ?? 0.95;
  const spread = o.handSpreadU ?? 0.25;
  const frames: PoseFrame[] = [];
  const uPx = body.shoulderFrac * W;
  for (let i = 0; t0 + i * dt <= t0 + dur; i++) {
    const t = t0 + i * dt + (o.jitterMs ? (r() * 2 - 1) * o.jitterMs : 0);
    if (o.drop?.(i, t)) {
      frames.push({ t, width: W, height: H, landmarks: null });
      continue;
    }
    const hp = o.hand(t0 + i * dt);
    const lm = new Float32Array(LANDMARK_COUNT * LANDMARK_STRIDE);
    // Anatomical labels, raw frame: the player's right is on the picture's left (smaller x). `put` adds noise in u.
    const put = (idx: number, sideways: number, up: number, v: number) => {
      const nx = noise ? gauss(r) * noise : 0;
      const ny = noise ? gauss(r) * noise : 0;
      // sideways: player's right +. In a raw frame the player's right is toward smaller x.
      const sx = o.mirrored ? sideways : -sideways;
      const px = body.centerX * W + (sx + nx) * uPx;
      const py = body.shoulderY * H - (up + ny) * uPx;
      let k = idx;
      if (o.mirrored) {
        // The model labels by picture layout, so a mirrored picture swaps the paired labels.
        if (idx === LM.leftShoulder) k = LM.rightShoulder;
        else if (idx === LM.rightShoulder) k = LM.leftShoulder;
        else if (idx === LM.leftElbow) k = LM.rightElbow;
        else if (idx === LM.rightElbow) k = LM.leftElbow;
        else if (idx === LM.leftWrist) k = LM.rightWrist;
        else if (idx === LM.rightWrist) k = LM.leftWrist;
      }
      lm[k * 4] = Math.min(1, Math.max(0, px / W));
      lm[k * 4 + 1] = Math.min(1, Math.max(0, py / H));
      lm[k * 4 + 3] = v;
    };
    // Anatomical: LM.rightShoulder is the player's right (sideways +0.5 u), LM.leftShoulder the player's left.
    put(LM.rightShoulder, 0.5, 0, 0.99);
    put(LM.leftShoulder, -0.5, 0, 0.99);
    put(LM.nose, 0, 0.7, 0.99);
    put(LM.rightWrist, hp.x + spread / 2, hp.h, vis);
    put(LM.leftWrist, hp.x - spread / 2, hp.h, vis);
    put(LM.rightElbow, 0.5 + (hp.x + spread / 2 - 0.5) * 0.5, hp.h * 0.5, vis);
    put(LM.leftElbow, -0.5 + (hp.x - spread / 2 + 0.5) * 0.5, hp.h * 0.5, vis);
    frames.push({ t, width: W, height: H, landmarks: lm });
  }
  return frames;
}

/** A scheduler whose clock moves only when the simulation says so (the tracker's timers run on it). */
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
  const runUntil = (to: number) => {
    for (;;) {
      let best = -1;
      for (let i = 0; i < timers.length; i++) if (best < 0 || timers[i].at < timers[best].at) best = i;
      if (best < 0 || timers[best].at > to) break;
      const t = timers.splice(best, 1)[0];
      now = Math.max(now, t.at);
      t.fn();
    }
    now = Math.max(now, to);
  };
  return { sched, runUntil };
}

export interface TraceCameraOptions {
  frames: readonly PoseFrame[];
  /** When the delivery goes live (ms on the frames' clock); the tracker is armed then. */
  armAtMs: number;
  /** When it is over (default: after the last frame). */
  disarmAtMs?: number;
  handedness?: Handedness;
  sourceMirrored?: boolean;
  /** Delay between a frame's capture time and the moment the mapper gets it (inference and transfer), ms. */
  latencyMs?: number;
  /** Calibration offset for the camera modality (ms), as the stored set would give. */
  calibrationMs?: number;
}

export interface TraceCameraResult {
  gesture: GestureInput | null;
  swing: NormalizedSwing | null;
  /** When (simulated clock, ms) the tracker emitted the gesture. */
  emittedAtMs: number | null;
  starts: Array<{ atPerfMs: number; pointer: PointerKind; reportedAtMs: number }>;
  intents: Array<SwingIntent & { reportedAtMs: number }>;
  states: Array<OneGestureState & { reportedAtMs: number }>;
  cancels: number;
  statuses: Array<CameraBatterStatus & { reportedAtMs: number }>;
  /** The last status. */
  final: CameraBatterStatus | null;
  /** Number of gestures emitted (must never exceed 1 per arming). */
  gestureCount: number;
}

/**
 * Plays a pose trace through a real CameraBatter (and so the real GestureTracker and normalizeGesture) on a simulated clock.
 * Each frame is delivered `latencyMs` after its capture time; the swing's time stays the frame's own.
 */
export function traceCamera(o: TraceCameraOptions): TraceCameraResult {
  const lat = o.latencyMs ?? 0;
  const first = o.frames[0]?.t ?? 0;
  const clock = simClock(Math.min(first, o.armAtMs) - 1);
  const res: TraceCameraResult = {
    gesture: null,
    swing: null,
    emittedAtMs: null,
    starts: [],
    intents: [],
    states: [],
    cancels: 0,
    statuses: [],
    final: null,
    gestureCount: 0,
  };
  let nowMs = clock.sched.now();
  const batter = new CameraBatter(
    {
      onSwingStart: (atPerfMs, pointer) => res.starts.push({ atPerfMs, pointer, reportedAtMs: nowMs }),
      onIntent: (i) => res.intents.push({ ...i, reportedAtMs: nowMs }),
      onContactState: (s) => res.states.push({ ...s, reportedAtMs: nowMs }),
      onCancel: () => res.cancels++,
      onGesture: (g) => {
        res.gestureCount++;
        if (!res.gesture) {
          res.gesture = g;
          res.emittedAtMs = nowMs;
          res.swing = normalizeGesture(g, {
            releasePerfMs: o.armAtMs,
            calibrationMs: o.calibrationMs ?? 0,
            calibrations: { camera: o.calibrationMs ?? 0 },
            handedness: o.handedness ?? 'right',
          });
        }
      },
      onStatus: (s) => {
        res.statuses.push({ ...s, reportedAtMs: nowMs });
        res.final = s;
      },
    },
    {
      scheduler: clock.sched,
      sourceMirrored: o.sourceMirrored,
      handedness: o.handedness ?? 'right',
      now: () => nowMs,
      otherPointerDown: () => false,
    },
  );
  type Ev = { at: number; order: number; run: () => void };
  const evs: Ev[] = [];
  let order = 0;
  const add = (at: number, run: () => void) => evs.push({ at, order: order++, run });
  add(o.armAtMs, () => batter.setEnabled(true, o.armAtMs));
  for (const f of o.frames) add(f.t + lat, () => batter.push(f));
  const end = (o.frames[o.frames.length - 1]?.t ?? o.armAtMs) + lat;
  add(o.disarmAtMs ?? end + 1, () => batter.setEnabled(false));
  evs.sort((a, b) => a.at - b.at || a.order - b.order);
  for (const e of evs) {
    clock.runUntil(e.at);
    nowMs = e.at;
    e.run();
  }
  clock.runUntil(end + 600);
  batter.dispose();
  return res;
}
