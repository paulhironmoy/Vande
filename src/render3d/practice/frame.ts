/**
 * Frames and clocks of a Practice delivery.
 *
 * Space: physics works in the striker's own frame (right-handed; a left-hander's world is mirrored x → −x). The
 * presentation draws the real world, so every physics position is mirrored back for a left-hander (`toWorld`), and
 * bearings flip sign. The bowler's body is drawn with its real arm.
 *
 * Time: scene milliseconds run from the start of the run-up; the ball leaves the hand at `releaseScene`. Simulation
 * time t (seconds after release) and performance.now() map onto it through the delivery's timebase, so what is
 * drawn never depends on frame numbers: a frame at performance time P shows the simulation at perfToSim(P).
 */
import type { BallSample, BatSample, Vec3 } from '@/contracts/practice';

export const toWorld = (p: Vec3, mirror: boolean): Vec3 => (mirror ? { x: -p.x, y: p.y, z: p.z } : { x: p.x, y: p.y, z: p.z });

export interface Timebase {
  /** performance.now() when the run-up began. */
  startPerfMs: number;
  /** Scene ms from the start of the run-up to the release. */
  releaseScene: number;
  /** Simulation seconds per real second (a test hook; 1 in play). */
  timeScale: number;
}

export const sceneAtPerf = (tb: Timebase, perfMs: number): number => (perfMs - tb.startPerfMs) * tb.timeScale;
export const perfAtScene = (tb: Timebase, scene: number): number => tb.startPerfMs + scene / tb.timeScale;
export const simToScene = (tb: Pick<Timebase, 'releaseScene'>, t: number): number => tb.releaseScene + t * 1000;
export const sceneToSim = (tb: Pick<Timebase, 'releaseScene'>, scene: number): number => (scene - tb.releaseScene) / 1000;
export const simToPerf = (tb: Timebase, t: number): number => perfAtScene(tb, simToScene(tb, t));
export const perfToSim = (tb: Timebase, perfMs: number): number => sceneToSim(tb, sceneAtPerf(tb, perfMs));
export const releasePerf = (tb: Timebase): number => perfAtScene(tb, tb.releaseScene);

/** Index of the last sample at or before t (−1 before the first). Samples are in time order. */
export function sampleIndex<T extends { t: number }>(samples: readonly T[], t: number): number {
  let lo = 0;
  let hi = samples.length - 1;
  if (hi < 0 || t < samples[0].t) return -1;
  if (t >= samples[hi].t) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const lerp3 = (a: Vec3, b: Vec3, u: number): Vec3 => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u });

/** Ball position at simulation time t (seconds), interpolated; clamped to the first and last sample. */
export function ballAt(samples: readonly BallSample[], t: number): Vec3 | null {
  if (samples.length === 0) return null;
  const i = sampleIndex(samples, t);
  if (i < 0) return { ...samples[0].p };
  if (i >= samples.length - 1) return { ...samples[samples.length - 1].p };
  const a = samples[i];
  const b = samples[i + 1];
  const span = b.t - a.t;
  return lerp3(a.p, b.p, span > 0 ? (t - a.t) / span : 0);
}

/** Ball velocity (m/s) at t: the sample's own velocity, interpolated. */
export function ballVelocityAt(samples: readonly BallSample[], t: number): Vec3 | null {
  if (samples.length === 0) return null;
  const i = Math.max(0, sampleIndex(samples, t));
  if (i >= samples.length - 1) return { ...samples[samples.length - 1].v };
  const a = samples[i];
  const b = samples[i + 1];
  const span = b.t - a.t;
  return lerp3(a.v, b.v, span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 0);
}

export interface BatPose {
  /** Top of the handle. */
  grip: Vec3;
  toe: Vec3;
  /** Unit face normal. */
  face: Vec3;
}

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};

/** Bat at simulation time t from physics samples (null before the swing starts); holds the last sample after. */
export function batAt(samples: readonly BatSample[], t: number): BatPose | null {
  if (samples.length === 0 || t < samples[0].t) return null;
  const i = sampleIndex(samples, t);
  if (i >= samples.length - 1) {
    const z = samples[samples.length - 1];
    return { grip: { ...z.grip }, toe: { ...z.toe }, face: norm(z.face) };
  }
  const a = samples[i];
  const b = samples[i + 1];
  const span = b.t - a.t;
  const u = span > 0 ? (t - a.t) / span : 0;
  return { grip: lerp3(a.grip, b.grip, u), toe: lerp3(a.toe, b.toe, u), face: norm(lerp3(a.face, b.face, u)) };
}

export function batToWorld(p: BatPose, mirror: boolean): BatPose {
  return { grip: toWorld(p.grip, mirror), toe: toWorld(p.toe, mirror), face: toWorld(p.face, mirror) };
}

/** Blend of two bat poses (u = 0 → a, 1 → b), face renormalized. */
export function blendBat(a: BatPose, b: BatPose, u: number): BatPose {
  return { grip: lerp3(a.grip, b.grip, u), toe: lerp3(a.toe, b.toe, u), face: norm(lerp3(a.face, b.face, u)) };
}
