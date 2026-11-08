/**
 * Forward kinematics works out only the bones a pose change reaches (PERF-3, 2026-11-07): `Joints` keeps the pose it was
 * computed from, and a bone whose local rotation (bit for bit, signed zeros and all) and whose parent are unchanged keeps
 * its joint. The result must be the full pass's, bit for bit, whatever the sequence of poses a `Joints` is given: single
 * bones, whole poses, the root, the same pose again, two poses alternately, and a fresh `Joints`.
 */
import { describe, expect, it } from 'vitest';
import { createPose, type SampledPose } from '@/render3d/core/clips';
import { createJoints, forwardKinematics } from '@/render3d/core/locomotion';
import { BONE_NAMES, SKELETON } from '@/render3d/core/skeleton';

const NB = BONE_NAMES.length;
const PARENT = SKELETON.map((b) => (b.parent ? BONE_NAMES.indexOf(b.parent) : -1));

/** The full pass as it was before the incremental one (a frozen copy of the arithmetic). */
function reference(pose: SampledPose): { p: Float64Array; q: Float64Array } {
  const P = new Float64Array(NB * 3);
  const Q = new Float64Array(NB * 4);
  const q = pose.q;
  const rotate = (qo: number, x: number, y: number, z: number, o: number) => {
    const qx = Q[qo],
      qy = Q[qo + 1],
      qz = Q[qo + 2],
      qw = Q[qo + 3];
    const tx = 2 * (qy * z - qz * y);
    const ty = 2 * (qz * x - qx * z);
    const tz = 2 * (qx * y - qy * x);
    P[o] = x + qw * tx + (qy * tz - qz * ty);
    P[o + 1] = y + qw * ty + (qz * tx - qx * tz);
    P[o + 2] = z + qw * tz + (qx * ty - qy * tx);
  };
  const qmul = (ao: number, bo: number, o: number) => {
    const ax = Q[ao],
      ay = Q[ao + 1],
      az = Q[ao + 2],
      aw = Q[ao + 3];
    const bx = q[bo],
      by = q[bo + 1],
      bz = q[bo + 2],
      bw = q[bo + 3];
    Q[o] = aw * bx + ax * bw + ay * bz - az * by;
    Q[o + 1] = aw * by - ax * bz + ay * bw + az * bx;
    Q[o + 2] = aw * bz + ax * by - ay * bx + az * bw;
    Q[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
  };
  for (let i = 0; i < NB; i++) {
    const par = PARENT[i];
    const o = SKELETON[i].offset;
    if (par < 0) {
      P[0] = pose.root[0] + o[0];
      P[1] = o[1] + pose.root[1];
      P[2] = pose.root[2] + o[2];
      Q[0] = q[0];
      Q[1] = q[1];
      Q[2] = q[2];
      Q[3] = q[3];
      continue;
    }
    rotate(par * 4, o[0], o[1], o[2], i * 3);
    P[i * 3] += P[par * 3];
    P[i * 3 + 1] += P[par * 3 + 1];
    P[i * 3 + 2] += P[par * 3 + 2];
    qmul(par * 4, i * 4, i * 4);
  }
  return { p: P, q: Q };
}

/** A small deterministic generator (the test must not depend on Math.random). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomQuat(r: () => number, out: Float32Array, o: number): void {
  const x = r() * 2 - 1,
    y = r() * 2 - 1,
    z = r() * 2 - 1,
    w = r() * 2 - 1;
  const n = Math.hypot(x, y, z, w) || 1;
  out[o] = x / n;
  out[o + 1] = y / n;
  out[o + 2] = z / n;
  out[o + 3] = w / n;
}

function same(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

function expectFull(j: { p: Float64Array; q: Float64Array }, pose: SampledPose, what: string): void {
  const ref = reference(pose);
  expect(same(j.p, ref.p), `${what}: positions`).toBe(true);
  expect(same(j.q, ref.q), `${what}: rotations`).toBe(true);
}

describe('incremental forward kinematics', () => {
  it('equals the full pass after every kind of change, in sequence, on one Joints', () => {
    const r = rng(7);
    const pose = createPose();
    for (let i = 0; i < NB; i++) randomQuat(r, pose.q, i * 4);
    pose.root = [r(), r(), r()];
    const j = createJoints();
    forwardKinematics(pose, j);
    expectFull(j, pose, 'first call');
    for (let step = 0; step < 4000; step++) {
      const kind = step % 8;
      if (kind === 0) {
        // The same pose again: nothing to work out.
        forwardKinematics(pose, j);
      } else if (kind <= 3) {
        // One bone, any bone (a leaf, a branch, the root bone).
        const b = Math.floor(r() * NB);
        randomQuat(r, pose.q, b * 4);
        forwardKinematics(pose, j);
      } else if (kind === 4) {
        // Several bones at once.
        for (let k = 0; k < 4; k++) randomQuat(r, pose.q, Math.floor(r() * NB) * 4);
        forwardKinematics(pose, j);
      } else if (kind === 5) {
        pose.root = [r() * 3, r(), r() * 3];
        forwardKinematics(pose, j);
      } else if (kind === 6) {
        // A bone to a value and straight back (the bisection patterns of the reach and the pelvis turn).
        const b = Math.floor(r() * NB);
        const keep = Array.from(pose.q.subarray(b * 4, b * 4 + 4));
        randomQuat(r, pose.q, b * 4);
        forwardKinematics(pose, j);
        expectFull(j, pose, `step ${step} out`);
        pose.q.set(keep, b * 4);
        forwardKinematics(pose, j);
      } else {
        // The whole pose.
        for (let i = 0; i < NB; i++) randomQuat(r, pose.q, i * 4);
        forwardKinematics(pose, j);
      }
      expectFull(j, pose, `step ${step}`);
    }
  });

  it('tells a negative zero from a zero, and a changed root from a changed bone', () => {
    const pose = createPose();
    pose.q[1 * 4] = 0;
    const j = createJoints();
    forwardKinematics(pose, j);
    pose.q[1 * 4] = -0;
    forwardKinematics(pose, j);
    expectFull(j, pose, 'a negative zero');
    pose.root = [0, 0, 0];
    forwardKinematics(pose, j);
    pose.root = [-0, 0, 0];
    forwardKinematics(pose, j);
    expectFull(j, pose, 'a negative zero root');
    pose.root = [0, 0.25, 0];
    forwardKinematics(pose, j);
    expectFull(j, pose, 'a root lift');
  });

  it('serves two poses on one Joints alternately, and a fresh Joints alike', () => {
    const r = rng(11);
    const a = createPose();
    const b = createPose();
    for (let i = 0; i < NB; i++) {
      randomQuat(r, a.q, i * 4);
      randomQuat(r, b.q, i * 4);
    }
    a.root = [1, 2, 3];
    b.root = [-1, 0.5, 2];
    const j = createJoints();
    for (let k = 0; k < 40; k++) {
      const pose = k % 3 === 0 ? a : b;
      forwardKinematics(pose, j);
      expectFull(j, pose, `alternation ${k}`);
      // A bone or two differ between the poses after a while.
      if (k % 5 === 4) randomQuat(r, b.q, Math.floor(r() * NB) * 4);
      expectFull(forwardKinematics(pose), pose, `fresh ${k}`);
    }
  });

  it('is not fooled by a pose edited in place after the call (the joints are of the pose as it was)', () => {
    const r = rng(3);
    const pose = createPose();
    for (let i = 0; i < NB; i++) randomQuat(r, pose.q, i * 4);
    const j = createJoints();
    forwardKinematics(pose, j);
    const before = reference(pose);
    randomQuat(r, pose.q, 5 * 4);
    // Not asked again: the joints still hold the pose they were computed from.
    expect(same(j.p, before.p) && same(j.q, before.q)).toBe(true);
    forwardKinematics(pose, j);
    expectFull(j, pose, 'after the edit');
  });
});
