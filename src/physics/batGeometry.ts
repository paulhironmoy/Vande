/** Canonical rigid-bat solid shared by collision and anatomical admission. */
import { BLADE_HALF_W, BLADE_L, BLADE_T, BLADE_TOE_R, GLOVE_R, HANDLE_L } from './constants';
import { type Vec3, cross, dot, norm, v3 } from './vec';

/** Replay-stable Euclidean magnitude using only basic arithmetic and correctly-rounded sqrt. */
function distance3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

export interface BatGeometryPose {
  grip: Vec3;
  toe: Vec3;
  n: Vec3;
}

export interface GeometryCapsule {
  a: Vec3;
  b: Vec3;
  r: number;
}

export interface BladeFrame {
  centre: Vec3;
  /** Blade axis toe → grip, face normal, width axis (a × n). */
  a: Vec3;
  n: Vec3;
  w: Vec3;
}

export interface BladeContact {
  /** Closest point on the blade box, the distance from it to the query point, and its local coordinates. */
  q: Vec3;
  dist: number;
  lu: number;
  lw: number;
  ln: number;
}

export function bladeFrame(pose: BatGeometryPose): BladeFrame {
  const a = norm(v3(
    pose.grip.x - pose.toe.x,
    pose.grip.y - pose.toe.y,
    pose.grip.z - pose.toe.z,
  ));
  const projection = dot(pose.n, a);
  const n = norm(v3(
    pose.n.x - projection * a.x,
    pose.n.y - projection * a.y,
    pose.n.z - projection * a.z,
  ));
  const w = cross(a, n);
  const halfLength = BLADE_L / 2;
  return {
    centre: v3(
      pose.toe.x + a.x * halfLength,
      pose.toe.y + a.y * halfLength,
      pose.toe.z + a.z * halfLength,
    ),
    a,
    n,
    w,
  };
}

function local(frame: BladeFrame, point: Vec3): [number, number, number] {
  const dx = point.x - frame.centre.x;
  const dy = point.y - frame.centre.y;
  const dz = point.z - frame.centre.z;
  return [
    dx * frame.a.x + dy * frame.a.y + dz * frame.a.z,
    dx * frame.w.x + dy * frame.w.y + dz * frame.w.z,
    dx * frame.n.x + dy * frame.n.y + dz * frame.n.z,
  ];
}

/**
 * Closest point on the blade solid the ball collides with, the distance to it and the query point's local coordinates.
 * The solid is the blade box with its toe rounded in profile (BLADE_TOE_R): the prism, along the width axis, of the
 * length x thickness rectangle whose two toe corners are quarter circles. Away from those corners the arithmetic is the
 * box's, unchanged.
 */
export function bladeContact(frame: BladeFrame, point: Vec3): BladeContact {
  const [lu, lw, ln] = local(frame, point);
  const halfLength = BLADE_L / 2;
  const halfThickness = BLADE_T / 2;
  let cu = Math.max(-halfLength, Math.min(halfLength, lu));
  const cw = Math.max(-BLADE_HALF_W, Math.min(BLADE_HALF_W, lw));
  let cn = Math.max(-halfThickness, Math.min(halfThickness, ln));
  const cornerU = -halfLength + BLADE_TOE_R;
  const cornerN = halfThickness - BLADE_TOE_R;
  const du = lu - cornerU;
  const dn = Math.abs(ln) - cornerN;
  if (du < 0 && dn > 0) {
    // Beside a rounded toe corner: the nearest point lies on (or inside) the quarter circle about its centre.
    const radial = Math.sqrt(du * du + dn * dn);
    if (radial > BLADE_TOE_R) {
      const k = BLADE_TOE_R / radial;
      cu = cornerU + du * k;
      cn = (ln < 0 ? -1 : 1) * (cornerN + dn * k);
    } else {
      cu = lu;
      cn = ln;
    }
  }
  const q = v3(
    frame.centre.x + frame.a.x * cu + frame.w.x * cw + frame.n.x * cn,
    frame.centre.y + frame.a.y * cu + frame.w.y * cw + frame.n.y * cn,
    frame.centre.z + frame.a.z * cu + frame.w.z * cw + frame.n.z * cn,
  );
  return { q, dist: distance3(point.x - q.x, point.y - q.y, point.z - q.z), lu, lw, ln };
}

/** Handle and gloves: a capsule from the blade shoulder to 40 mm below the handle cap. */
export function handleCapsule(frame: BladeFrame): GeometryCapsule {
  const halfLength = BLADE_L / 2;
  const a = v3(
    frame.centre.x + frame.a.x * halfLength,
    frame.centre.y + frame.a.y * halfLength,
    frame.centre.z + frame.a.z * halfLength,
  );
  const top = halfLength + HANDLE_L - 0.04;
  return {
    a,
    b: v3(
      frame.centre.x + frame.a.x * top,
      frame.centre.y + frame.a.y * top,
      frame.centre.z + frame.a.z * top,
    ),
    r: GLOVE_R,
  };
}

/** Exact point-to-canonical-blade-box distance. */
export function pointBladeDistance(frame: BladeFrame, point: Vec3): number {
  const dx = point.x - frame.centre.x;
  const dy = point.y - frame.centre.y;
  const dz = point.z - frame.centre.z;
  return Math.sqrt(boxDistanceSquared(
    dx * frame.a.x + dy * frame.a.y + dz * frame.a.z,
    dx * frame.w.x + dy * frame.w.y + dz * frame.w.z,
    dx * frame.n.x + dy * frame.n.y + dz * frame.n.z,
  ));
}

const HALF_L = BLADE_L / 2;
const HALF_T = BLADE_T / 2;

/** Squared distance from a local point to the canonical blade box: the same per-axis order as the array form. */
function boxDistanceSquared(u: number, w: number, n: number): number {
  const ou = Math.max(Math.abs(u) - HALF_L, 0);
  const ow = Math.max(Math.abs(w) - BLADE_HALF_W, 0);
  const on = Math.max(Math.abs(n) - HALF_T, 0);
  let squared = 0;
  squared += ou * ou;
  squared += ow * ow;
  squared += on * on;
  return squared;
}

/** Scratch for the plane-crossing parameters of one segment: at most 2 + 2 per axis. Reused, never shared. */
const SEGMENT_BREAKS = new Float64Array(8);

/**
 * Exact finite-segment-to-oriented-box distance. Plane-crossing parameters partition the segment into intervals with
 * a fixed active AABB face set; on each interval the squared distance is one quadratic whose clamped stationary point
 * and boundaries are exhaustive. Allocation-free; every floating-point operation and its order is the original
 * array implementation's (tests/unit/physics/batGeometryEquivalence.test.ts holds it bit-identical).
 */
export function segmentBladeDistance(frame: BladeFrame, first: Vec3, second: Vec3): number {
  const c = frame.centre;
  const fa = frame.a;
  const fw = frame.w;
  const fn = frame.n;
  const ax = first.x - c.x;
  const ay = first.y - c.y;
  const az = first.z - c.z;
  const su = ax * fa.x + ay * fa.y + az * fa.z;
  const sw = ax * fw.x + ay * fw.y + az * fw.z;
  const sn = ax * fn.x + ay * fn.y + az * fn.z;
  const bx = second.x - c.x;
  const by = second.y - c.y;
  const bz = second.z - c.z;
  const du = (bx * fa.x + by * fa.y + bz * fa.z) - su;
  const dw = (bx * fw.x + by * fw.y + bz * fw.z) - sw;
  const dn = (bx * fn.x + by * fn.y + bz * fn.z) - sn;
  const breaks = SEGMENT_BREAKS;
  let count = 0;
  breaks[count++] = 0;
  breaks[count++] = 1;
  if (!(Math.abs(du) <= 1e-15)) {
    let time = (-HALF_L - su) / du;
    if (time > 0 && time < 1) breaks[count++] = time;
    time = (HALF_L - su) / du;
    if (time > 0 && time < 1) breaks[count++] = time;
  }
  if (!(Math.abs(dw) <= 1e-15)) {
    let time = (-BLADE_HALF_W - sw) / dw;
    if (time > 0 && time < 1) breaks[count++] = time;
    time = (BLADE_HALF_W - sw) / dw;
    if (time > 0 && time < 1) breaks[count++] = time;
  }
  if (!(Math.abs(dn) <= 1e-15)) {
    let time = (-HALF_T - sn) / dn;
    if (time > 0 && time < 1) breaks[count++] = time;
    time = (HALF_T - sn) / dn;
    if (time > 0 && time < 1) breaks[count++] = time;
  }
  // Insertion sort: the same ascending order as Array.prototype.sort with (l, r) => l - r on these finite values.
  for (let i = 1; i < count; i++) {
    const value = breaks[i];
    let j = i - 1;
    while (j >= 0 && breaks[j] - value > 0) {
      breaks[j + 1] = breaks[j];
      j--;
    }
    breaks[j + 1] = value;
  }
  let bestSquared = Math.min(
    boxDistanceSquared(su + du * 0, sw + dw * 0, sn + dn * 0),
    boxDistanceSquared(su + du * 1, sw + dw * 1, sn + dn * 1),
  );
  // The original keeps a sorted value when it exceeds its sorted predecessor (not the last kept value) by > 1e-14.
  let low = breaks[0];
  for (let index = 1; index < count; index++) {
    if (!(breaks[index] - breaks[index - 1] > 1e-14)) continue;
    const high = breaks[index];
    const middle = (low + high) / 2;
    let quadratic = 0;
    let linear = 0;
    let value = su + du * middle;
    if (!(value >= -HALF_L && value <= HALF_L)) {
      const plane = value < -HALF_L ? -HALF_L : HALF_L;
      quadratic += du * du;
      linear += du * (su - plane);
    }
    value = sw + dw * middle;
    if (!(value >= -BLADE_HALF_W && value <= BLADE_HALF_W)) {
      const plane = value < -BLADE_HALF_W ? -BLADE_HALF_W : BLADE_HALF_W;
      quadratic += dw * dw;
      linear += dw * (sw - plane);
    }
    value = sn + dn * middle;
    if (!(value >= -HALF_T && value <= HALF_T)) {
      const plane = value < -HALF_T ? -HALF_T : HALF_T;
      quadratic += dn * dn;
      linear += dn * (sn - plane);
    }
    const stationary = quadratic > 0 ? Math.max(low, Math.min(high, -linear / quadratic)) : low;
    bestSquared = Math.min(
      bestSquared,
      boxDistanceSquared(su + du * low, sw + dw * low, sn + dn * low),
      boxDistanceSquared(su + du * high, sw + dw * high, sn + dn * high),
      boxDistanceSquared(su + du * stationary, sw + dw * stationary, sn + dn * stationary),
    );
    low = high;
  }
  return Math.sqrt(Math.max(0, bestSquared));
}

export function pointSegmentDistance(point: Vec3, first: Vec3, second: Vec3): number {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const dz = second.z - first.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  const amount = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (
    (point.x - first.x) * dx + (point.y - first.y) * dy + (point.z - first.z) * dz
  ) / lengthSquared));
  return distance3(
    point.x - (first.x + dx * amount),
    point.y - (first.y + dy * amount),
    point.z - (first.z + dz * amount),
  );
}

/** Exact closest distance between two finite 3-D segments (Ericson, Real-Time Collision Detection). */
export function segmentSegmentDistance(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): number {
  // Scalar form of the vector version (same products, sums and order; dot(a, b) = a.x*b.x + a.y*b.y + a.z*b.z).
  const d1x = q1.x - p1.x;
  const d1y = q1.y - p1.y;
  const d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x;
  const d2y = q2.y - p2.y;
  const d2z = q2.z - p2.z;
  const rx = p1.x - p2.x;
  const ry = p1.y - p2.y;
  const rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  const epsilon = 1e-15;
  let s: number;
  let t: number;
  if (a <= epsilon && e <= epsilon) return distance3(rx, ry, rz);
  if (a <= epsilon) {
    s = 0;
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= epsilon) {
      t = 0;
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denominator = a * e - b * b;
      s = denominator === 0 ? 0 : Math.max(0, Math.min(1, (b * f - c * e) / denominator));
      const numerator = b * s + f;
      if (numerator < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else if (numerator > e) {
        t = 1;
        s = Math.max(0, Math.min(1, (b - c) / a));
      } else {
        t = numerator / e;
      }
    }
  }
  return distance3(
    p1.x + d1x * s - (p2.x + d2x * t),
    p1.y + d1y * s - (p2.y + d2y * t),
    p1.z + d1z * s - (p2.z + d2z * t),
  );
}

/** Exact lowest vertical support of the blade OBB. */
export function bladeGroundSupportY(frame: BladeFrame): number {
  return frame.centre.y
    - BLADE_L / 2 * Math.abs(frame.a.y)
    - BLADE_HALF_W * Math.abs(frame.w.y)
    - BLADE_T / 2 * Math.abs(frame.n.y);
}

/** Exact lowest support of the handle/glove capsule. */
export function handleGroundSupportY(capsule: GeometryCapsule): number {
  return Math.min(capsule.a.y, capsule.b.y) - capsule.r;
}
