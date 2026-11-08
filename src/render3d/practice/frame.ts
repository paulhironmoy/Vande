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

const BAT_FULL = 0.86;
const BAT_VECTOR_EPSILON = 1e-12;
const BAT_QUATERNION_TIE_EPSILON = 1e-15;
const BAT_CONTACT_TIME_ROUNDTRIP_EPSILON = 1e-12;
const BAT_HELD_POSE_TOLERANCE_METRES = 1e-9;

interface BatQuaternion {
  w: number;
  x: number;
  y: number;
  z: number;
}

interface PreparedBatTrack {
  samples: readonly BatSample[];
  grips: readonly Vec3[];
  rotations: readonly BatQuaternion[];
  /** Per segment i (knot i -> i + 1): the quintic Hermite data of the grip and of the rotation in knot i's chart. */
  segments: readonly BatSegment[];
}

/**
 * One interpolation segment. Grip: position, velocity and acceleration at both knots. Rotation: the rotation vector
 * r(t) with rotation(t) = exp(r(t)) * rotations[i], r(t_i) = 0, r(t_i+1) = r1, and its first and second derivatives
 * at both knots, all in the same chart (knot i).
 */
interface BatSegment {
  gripVelocity0: Vec3;
  gripAcceleration0: Vec3;
  gripVelocity1: Vec3;
  gripAcceleration1: Vec3;
  r1: Vec3;
  angularVelocity0: Vec3;
  angularAcceleration0: Vec3;
  angularVelocity1: Vec3;
  angularAcceleration1: Vec3;
}

interface PreparedBatCache {
  byImpulse: Map<number | null, Map<number | null, PreparedBatTrack>>;
}

const preparedBatTracks = new WeakMap<object, PreparedBatCache>();
const batZero = (): Vec3 => ({ x: 0, y: 0, z: 0 });
const batAdd = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const batSub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const batScale = (a: Vec3, scale: number): Vec3 => ({ x: a.x * scale, y: a.y * scale, z: a.z * scale });
const batDot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const batCross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const batMagnitude = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const batNormalize = (a: Vec3): Vec3 => {
  const magnitude = batMagnitude(a);
  if (magnitude <= BAT_VECTOR_EPSILON) throw new Error('Bat frame contains a degenerate vector.');
  return batScale(a, 1 / magnitude);
};

const quaternionScale = (q: BatQuaternion, scale: number): BatQuaternion => ({
  w: q.w * scale,
  x: q.x * scale,
  y: q.y * scale,
  z: q.z * scale,
});
const quaternionNegate = (q: BatQuaternion): BatQuaternion => quaternionScale(q, -1);
const quaternionDot = (a: BatQuaternion, b: BatQuaternion): number =>
  a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
const quaternionMultiply = (a: BatQuaternion, b: BatQuaternion): BatQuaternion => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});
const quaternionNormalize = (q: BatQuaternion): BatQuaternion => {
  const magnitude = Math.hypot(q.w, q.x, q.y, q.z);
  if (magnitude <= BAT_VECTOR_EPSILON) return { w: 1, x: 0, y: 0, z: 0 };
  return quaternionScale(q, 1 / magnitude);
};
const quaternionInverse = (q: BatQuaternion): BatQuaternion => {
  const lengthSquared = quaternionDot(q, q);
  return { w: q.w / lengthSquared, x: -q.x / lengthSquared, y: -q.y / lengthSquared, z: -q.z / lengthSquared };
};
const quaternionRotate = (value: BatQuaternion, point: Vec3): Vec3 => {
  const q = quaternionNormalize(value);
  const vector = { x: q.x, y: q.y, z: q.z };
  const twiceCross = batScale(batCross(vector, point), 2);
  return batAdd(point, batAdd(batScale(twiceCross, q.w), batCross(vector, twiceCross)));
};

function quaternionFromFrame(axis: Vec3, face: Vec3, width: Vec3): BatQuaternion {
  // Matrix columns are local X=axis, local Y=face, local Z=width. Branch/tie order matches Unity exactly.
  const m00 = axis.x;
  const m01 = face.x;
  const m02 = width.x;
  const m10 = axis.y;
  const m11 = face.y;
  const m12 = width.y;
  const m20 = axis.z;
  const m21 = face.z;
  const m22 = width.z;
  const trace = m00 + m11 + m22;
  let result: BatQuaternion;
  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2;
    result = { w: 0.25 * scale, x: (m21 - m12) / scale, y: (m02 - m20) / scale, z: (m10 - m01) / scale };
  } else if (m00 >= m11 && m00 >= m22) {
    const scale = Math.sqrt(1 + m00 - m11 - m22) * 2;
    result = { w: (m21 - m12) / scale, x: 0.25 * scale, y: (m01 + m10) / scale, z: (m02 + m20) / scale };
  } else if (m11 >= m22) {
    const scale = Math.sqrt(1 + m11 - m00 - m22) * 2;
    result = { w: (m02 - m20) / scale, x: (m01 + m10) / scale, y: 0.25 * scale, z: (m12 + m21) / scale };
  } else {
    const scale = Math.sqrt(1 + m22 - m00 - m11) * 2;
    result = { w: (m10 - m01) / scale, x: (m02 + m20) / scale, y: (m12 + m21) / scale, z: 0.25 * scale };
  }
  return quaternionNormalize(result);
}

function canonicalizeQuaternion(value: BatQuaternion): BatQuaternion {
  const q = quaternionNormalize(value);
  if (Math.abs(q.w) > BAT_QUATERNION_TIE_EPSILON) return q.w < 0 ? quaternionNegate(q) : q;
  if (Math.abs(q.x) > BAT_QUATERNION_TIE_EPSILON) return q.x < 0 ? quaternionNegate(q) : q;
  if (Math.abs(q.y) > BAT_QUATERNION_TIE_EPSILON) return q.y < 0 ? quaternionNegate(q) : q;
  return q.z < 0 ? quaternionNegate(q) : q;
}

function alignQuaternionHemisphere(reference: BatQuaternion, candidateValue: BatQuaternion): BatQuaternion {
  const candidate = quaternionNormalize(candidateValue);
  const amount = quaternionDot(reference, candidate);
  if (amount < -BAT_QUATERNION_TIE_EPSILON) return quaternionNegate(candidate);
  if (Math.abs(amount) > BAT_QUATERNION_TIE_EPSILON) return candidate;
  const relative = quaternionMultiply(candidate, quaternionInverse(reference));
  const x = Math.abs(relative.x);
  const y = Math.abs(relative.y);
  const z = Math.abs(relative.z);
  const component = x >= y && x >= z ? relative.x : y >= z ? relative.y : relative.z;
  return component < 0 ? quaternionNegate(candidate) : candidate;
}

function quaternionToRotationVector(value: BatQuaternion): Vec3 {
  let q = quaternionNormalize(value);
  if (q.w < 0) q = quaternionNegate(q);
  const sine = Math.hypot(q.x, q.y, q.z);
  if (sine <= BAT_VECTOR_EPSILON) return { x: q.x * 2, y: q.y * 2, z: q.z * 2 };
  const angle = 2 * Math.atan2(sine, Math.max(0, q.w));
  return batScale({ x: q.x, y: q.y, z: q.z }, angle / sine);
}

function quaternionFromRotationVector(value: Vec3): BatQuaternion {
  const angle = batMagnitude(value);
  if (angle <= BAT_VECTOR_EPSILON) {
    return quaternionNormalize({ w: 1, x: value.x * 0.5, y: value.y * 0.5, z: value.z * 0.5 });
  }
  const half = angle * 0.5;
  const scale = Math.sin(half) / angle;
  return { w: Math.cos(half), x: value.x * scale, y: value.y * scale, z: value.z * scale };
}

function exactPose(sample: BatSample): BatPose {
  return { grip: { ...sample.grip }, toe: { ...sample.toe }, face: { ...sample.face } };
}

function exactAuthorityKnot(samples: readonly BatSample[], authorityT: number | null | undefined): number | null {
  if (authorityT == null || !Number.isFinite(authorityT)) return null;
  let match: number | null = null;
  let matches = 0;
  for (const sample of samples) {
    if (Math.abs(sample.t - authorityT) <= BAT_CONTACT_TIME_ROUNDTRIP_EPSILON) {
      matches++;
      match = sample.t;
    }
  }
  return matches === 1 ? match : null;
}

function frameRotation(sample: BatSample): BatQuaternion {
  const span = batSub(sample.grip, sample.toe);
  if (batMagnitude(span) <= BAT_VECTOR_EPSILON) throw new Error('Bat grip and toe must define a rigid axis.');
  const axis = batNormalize(span);
  const projectedFace = batSub(sample.face, batScale(axis, batDot(sample.face, axis)));
  if (batMagnitude(projectedFace) <= BAT_VECTOR_EPSILON) throw new Error('Bat face must be independent of its rigid axis.');
  let face = batNormalize(projectedFace);
  const width = batNormalize(batCross(axis, face));
  face = batNormalize(batCross(width, axis));
  return quaternionFromFrame(axis, face, width);
}

function sameHeldPose(left: BatSample, right: BatSample): boolean {
  return batMagnitude(batSub(left.grip, right.grip)) <= BAT_HELD_POSE_TOLERANCE_METRES &&
    batMagnitude(batSub(left.toe, right.toe)) <= BAT_HELD_POSE_TOLERANCE_METRES &&
    batMagnitude(batSub(left.face, right.face)) <= BAT_HELD_POSE_TOLERANCE_METRES;
}

/**
 * First and second derivatives at tau = 0 of the polynomial through (taus[j], values[j]): Fornberg's weights
 * (Math. Comp. 51, 1988) on a nonuniform grid. Exact for any polynomial of degree < taus.length (so up to quartic
 * motion with five knots: the physics' own smoothstep speed profile integrates to a quartic in time).
 */
function polynomialDerivatives(taus: readonly number[], values: readonly Vec3[]): { velocity: Vec3; acceleration: Vec3 } {
  const n = taus.length;
  if (n < 2) return { velocity: batZero(), acceleration: batZero() };
  const order = Math.min(2, n - 1);
  const weights: number[][] = Array.from({ length: n }, () => [0, 0, 0]);
  let c1 = 1;
  let c4 = taus[0];
  weights[0][0] = 1;
  for (let i = 1; i < n; i++) {
    const mn = Math.min(i, order);
    let c2 = 1;
    const c5 = c4;
    c4 = taus[i];
    for (let j = 0; j < i; j++) {
      const c3 = taus[i] - taus[j];
      c2 *= c3;
      if (j === i - 1) {
        for (let k = mn; k >= 1; k--) weights[i][k] = (c1 * (k * weights[i - 1][k - 1] - c5 * weights[i - 1][k])) / c2;
        weights[i][0] = (-c1 * c5 * weights[i - 1][0]) / c2;
      }
      for (let k = mn; k >= 1; k--) weights[j][k] = (c4 * weights[j][k] - k * weights[j][k - 1]) / c3;
      weights[j][0] = (c4 * weights[j][0]) / c3;
    }
    c1 = c2;
  }
  let velocity = batZero();
  let acceleration = batZero();
  for (let j = 0; j < n; j++) {
    velocity = batAdd(velocity, batScale(values[j], weights[j][1]));
    if (order >= 2) acceleration = batAdd(acceleration, batScale(values[j], weights[j][2]));
  }
  return { velocity, acceleration };
}

/** Quintic Hermite on [0, h]: position, velocity and acceleration at both ends, evaluated at fraction u. */
function quinticHermite(p0: Vec3, v0: Vec3, a0: Vec3, p1: Vec3, v1: Vec3, a1: Vec3, h: number, u: number): Vec3 {
  const u2 = u * u;
  const u3 = u2 * u;
  const u4 = u3 * u;
  const u5 = u4 * u;
  const h00 = 1 - 10 * u3 + 15 * u4 - 6 * u5;
  const h10 = u - 6 * u3 + 8 * u4 - 3 * u5;
  const h20 = 0.5 * u2 - 1.5 * u3 + 1.5 * u4 - 0.5 * u5;
  const h21 = 0.5 * u3 - u4 + 0.5 * u5;
  const h11 = -4 * u3 + 7 * u4 - 3 * u5;
  const h01 = 10 * u3 - 15 * u4 + 6 * u5;
  return batAdd(
    batAdd(batAdd(batScale(p0, h00), batScale(v0, h10 * h)), batAdd(batScale(a0, h20 * h * h), batScale(a1, h21 * h * h))),
    batAdd(batScale(v1, h11 * h), batScale(p1, h01)),
  );
}

function prepareBatTrack(
  samplesValue: readonly BatSample[],
  impulseT: number | null,
  velocityPeakT: number | null,
): PreparedBatTrack {
  const samples = samplesValue.map((sample) => ({
    t: sample.t,
    grip: { ...sample.grip },
    toe: { ...sample.toe },
    face: { ...sample.face },
  }));
  const grips = samples.map((sample) => ({ ...sample.grip }));
  const rotations = samples.map(frameRotation);
  if (rotations.length) {
    rotations[0] = canonicalizeQuaternion(rotations[0]);
    for (let i = 1; i < rotations.length; i++) rotations[i] = alignQuaternionHemisphere(rotations[i - 1], rotations[i]);
  }
  for (let i = 0; i < samples.length - 1; i++) {
    if (!(samples[i + 1].t - samples[i].t > 0)) throw new Error('Bat interpolation requires strictly increasing sample times.');
  }
  return { samples, grips, rotations, segments: prepareBatSegments(samples, grips, rotations, impulseT, velocityPeakT) };
}

/**
 * Knot derivatives for the quintic reconstruction (PHYS2 phase 5b). Each knot side takes the first and second
 * derivative of the polynomial through up to five consecutive knots of its own smooth run (centred where it can be).
 * A run ends at an authored hold, at the exact contact impulse and at the authored velocity peak, so no estimate mixes
 * two branches of the profile. The rules for those knots are the cubic reconstruction's: the impulse keeps distinct
 * one-sided derivatives; the velocity peak shares the mean of its one-sided estimates (backward only when a later
 * impulse is near-coincident); a knot that starts or ends a hold has zero velocity on both sides and zero acceleration
 * on the held side; the first and last knots are at rest. Rotation derivatives are taken in the chart of each
 * segment's first knot (rotation vectors of rotations[j] * rotations[i]^-1), so both ends of a segment agree.
 */
function prepareBatSegments(
  samples: readonly BatSample[],
  grips: readonly Vec3[],
  rotations: readonly BatQuaternion[],
  impulseT: number | null,
  velocityPeakT: number | null,
): BatSegment[] {
  const count = samples.length;
  if (count < 2) return [];
  const held: boolean[] = [];
  for (let i = 0; i < count - 1; i++) held.push(sameHeldPose(samples[i], samples[i + 1]));
  const impulseIndex = impulseT === null ? -1 : samples.findIndex((sample) => sample.t === impulseT);
  const velocityPeakIndex = velocityPeakT === null ? -1 : samples.findIndex((sample) => sample.t === velocityPeakT);
  const isBreak = (k: number): boolean => k === impulseIndex || k === velocityPeakIndex;
  // Furthest knots reachable from k without crossing a hold or another break knot (a break knot may end the run).
  const runLow = (k: number): number => {
    let j = k;
    while (j > 0 && !held[j - 1]) {
      j--;
      if (isBreak(j)) break;
    }
    return j;
  };
  const runHigh = (k: number): number => {
    let j = k;
    while (j < count - 1 && !held[j]) {
      j++;
      if (isBreak(j)) break;
    }
    return j;
  };
  // A side's acceleration comes from its window; its velocity from the windows in `velocityFrom` (their mean), or zero.
  type Side = { from: number; to: number; zeroVelocity: boolean; velocityFrom?: Side[] } | null;
  const window = (k: number, low: number, high: number): Side => {
    const size = Math.min(5, high - low + 1);
    if (size < 2) return null;
    const start = Math.max(low, Math.min(k - Math.floor((size - 1) / 2), high - size + 1));
    return { from: start, to: start + size - 1, zeroVelocity: false };
  };
  const backward = (k: number): Side => (k > 0 && !held[k - 1] ? window(k, Math.max(runLow(k), k - 4), k) : null);
  const forward = (k: number): Side => (k < count - 1 && !held[k] ? window(k, k, Math.min(runHigh(k), k + 4)) : null);
  // incoming / outgoing side specifications per knot: null = rest (zero velocity and acceleration).
  const incoming: Array<Side[]> = [];
  const outgoing: Array<Side[]> = [];
  for (let k = 0; k < count; k++) {
    if (k === 0 || k === count - 1) {
      // The channel starts and ends at rest; its acceleration there is the one-sided estimate of its own run.
      const into = k === 0 ? null : backward(k);
      const out = k === 0 ? forward(k) : null;
      incoming.push(into ? [{ ...into, zeroVelocity: true }] : []);
      outgoing.push(out ? [{ ...out, zeroVelocity: true }] : []);
      continue;
    }
    if (k === impulseIndex) {
      incoming.push(held[k - 1] ? [] : [backward(k)]);
      outgoing.push(held[k] ? [] : [forward(k)]);
    } else if (held[k - 1] || held[k]) {
      const into = held[k - 1] ? null : backward(k);
      const out = held[k] ? null : forward(k);
      incoming.push(into ? [{ ...into, zeroVelocity: true }] : []);
      outgoing.push(out ? [{ ...out, zeroVelocity: true }] : []);
    } else if (k === velocityPeakIndex) {
      // C1 acceleration reversal: one shared velocity (the mean of the one-sided estimates), and each side keeps the
      // acceleration of its own leg.
      const laterImpulse = impulseIndex > k;
      const before = backward(k);
      const after = laterImpulse ? null : forward(k);
      const shared = laterImpulse ? [before] : [before, after];
      incoming.push(before ? [{ ...before, velocityFrom: shared }] : []);
      outgoing.push(after ? [{ ...after, velocityFrom: shared }] : before ? [{ ...before, velocityFrom: shared }] : []);
    } else {
      const centred = window(k, runLow(k), runHigh(k));
      incoming.push([centred]);
      outgoing.push([centred]);
    }
  }
  const estimate = (sides: Side[], k: number, value: (j: number) => Vec3): { velocity: Vec3; acceleration: Vec3 } => {
    const valid = sides.filter((side): side is NonNullable<Side> => side !== null);
    if (valid.length === 0) return { velocity: batZero(), acceleration: batZero() };
    let velocity = batZero();
    let acceleration = batZero();
    for (const side of valid) {
      const taus: number[] = [];
      const values: Vec3[] = [];
      for (let j = side.from; j <= side.to; j++) {
        taus.push(samples[j].t - samples[k].t);
        values.push(value(j));
      }
      const derivative = polynomialDerivatives(taus, values);
      velocity = batAdd(velocity, side.zeroVelocity ? batZero()
        : side.velocityFrom ? estimate(side.velocityFrom.map((other) => (other ? { ...other, velocityFrom: undefined } : null)), k, value).velocity
          : derivative.velocity);
      acceleration = batAdd(acceleration, derivative.acceleration);
    }
    return { velocity: batScale(velocity, 1 / valid.length), acceleration: batScale(acceleration, 1 / valid.length) };
  };
  const segments: BatSegment[] = [];
  for (let i = 0; i < count - 1; i++) {
    const inverse = quaternionInverse(rotations[i]);
    const chart = (j: number): Vec3 => quaternionToRotationVector(quaternionMultiply(rotations[j], inverse));
    const grip0 = estimate(outgoing[i], i, (j) => grips[j]);
    const grip1 = estimate(incoming[i + 1], i + 1, (j) => grips[j]);
    const angular0 = estimate(outgoing[i], i, chart);
    const angular1 = estimate(incoming[i + 1], i + 1, chart);
    segments.push({
      gripVelocity0: grip0.velocity,
      gripAcceleration0: grip0.acceleration,
      gripVelocity1: grip1.velocity,
      gripAcceleration1: grip1.acceleration,
      r1: chart(i + 1),
      angularVelocity0: angular0.velocity,
      angularAcceleration0: angular0.acceleration,
      angularVelocity1: angular1.velocity,
      angularAcceleration1: angular1.acceleration,
    });
  }
  return segments;
}

function preparedBatTrack(
  samples: readonly BatSample[],
  impulseT: number | null | undefined,
  velocityPeakT: number | null | undefined,
): PreparedBatTrack {
  const exactImpulse = exactAuthorityKnot(samples, impulseT);
  const requestedVelocityPeak = exactAuthorityKnot(samples, velocityPeakT);
  // An early blade impulse replaces the canonical branch. A later planned
  // timestamp can remain an exact trace knot for contract semantics, but it
  // belongs to the post-hit smooth01 branch and is not its velocity peak.
  const exactVelocityPeak = requestedVelocityPeak !== null &&
    (exactImpulse === null || requestedVelocityPeak < exactImpulse - BAT_CONTACT_TIME_ROUNDTRIP_EPSILON)
    ? requestedVelocityPeak
    : null;
  const immutable = Object.isFrozen(samples) && samples.every((sample) =>
    Object.isFrozen(sample) && Object.isFrozen(sample.grip) && Object.isFrozen(sample.toe) && Object.isFrozen(sample.face));
  // Mutable test/diagnostic traces must never reuse a stale prepared view. Production traces are deeply frozen by
  // the presentation builder and take the cached path below.
  if (!immutable) return prepareBatTrack(samples, exactImpulse, exactVelocityPeak);
  let cache = preparedBatTracks.get(samples as object);
  if (!cache) {
    cache = { byImpulse: new Map() };
    preparedBatTracks.set(samples as object, cache);
  }
  let byVelocityPeak = cache.byImpulse.get(exactImpulse);
  if (!byVelocityPeak) {
    byVelocityPeak = new Map();
    cache.byImpulse.set(exactImpulse, byVelocityPeak);
  }
  const found = byVelocityPeak.get(exactVelocityPeak);
  if (found) return found;
  const prepared = prepareBatTrack(samples, exactImpulse, exactVelocityPeak);
  byVelocityPeak.set(exactVelocityPeak, prepared);
  return prepared;
}

/**
 * Rigid bat at simulation time t. `velocityPeakT` is the authored C1 acceleration reversal. Only `impulseT`, the
 * optional exact blade-contact knot, may reset velocity. The channel remains null before its first sample and holds
 * the exact last sample.
 */
export function batAt(
  samples: readonly BatSample[],
  t: number,
  impulseT?: number | null,
  velocityPeakT?: number | null,
): BatPose | null {
  if (samples.length === 0 || t < samples[0].t) return null;
  const track = preparedBatTrack(samples, impulseT, velocityPeakT);
  const i = sampleIndex(track.samples, t);
  if (i >= track.samples.length - 1 || track.samples[i].t === t) return exactPose(track.samples[i]);
  const next = i + 1;
  const span = track.samples[next].t - track.samples[i].t;
  if (!(span > 0)) throw new Error('Bat interpolation requires strictly increasing sample times.');
  const amount = (t - track.samples[i].t) / span;
  const segment = track.segments[i];
  const grip = quinticHermite(
    track.grips[i], segment.gripVelocity0, segment.gripAcceleration0,
    track.grips[next], segment.gripVelocity1, segment.gripAcceleration1,
    span, amount,
  );
  const r = quinticHermite(
    batZero(), segment.angularVelocity0, segment.angularAcceleration0,
    segment.r1, segment.angularVelocity1, segment.angularAcceleration1,
    span, amount,
  );
  const rotation = quaternionNormalize(quaternionMultiply(quaternionFromRotationVector(r), track.rotations[i]));
  const axis = batNormalize(quaternionRotate(rotation, { x: 1, y: 0, z: 0 }));
  const face = batNormalize(quaternionRotate(rotation, { x: 0, y: 1, z: 0 }));
  return { grip, toe: batSub(grip, batScale(axis, BAT_FULL)), face };
}

export function batToWorld(p: BatPose, mirror: boolean): BatPose {
  return { grip: toWorld(p.grip, mirror), toe: toWorld(p.toe, mirror), face: toWorld(p.face, mirror) };
}

/** Blend of two bat poses (u = 0 → a, 1 → b), face renormalized. */
export function blendBat(a: BatPose, b: BatPose, u: number): BatPose {
  return { grip: lerp3(a.grip, b.grip, u), toe: lerp3(a.toe, b.toe, u), face: norm(lerp3(a.face, b.face, u)) };
}
