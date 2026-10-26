/**
 * Vector helpers and deterministic elementary functions for the Practice physics.
 *
 * Math.sin/cos/atan2/exp are implementation-approximated: V8, JavaScriptCore and SpiderMonkey may differ in the
 * last bit, which could flip a discrete outcome (edge versus middle) in a replay on another browser. The functions
 * here use only IEEE-754 basic arithmetic and Math.sqrt (both correctly rounded), Math.round and comparisons, so
 * every engine computes bit-identical results. Accuracy is better than 1e-15 relative over the ranges used.
 */
import type { Vec3 } from '@/contracts/practice';

export type { Vec3 };

export const PI = 3.141592653589793;
export const HALF_PI = PI / 2;
export const DEG = PI / 180;
export const RAD = 180 / PI;
const SQRT3 = Math.sqrt(3);
const PIO2_HI = 1.5707963267341256;
const PIO2_LO = 6.077100506506192e-11;
const LN2_HI = 0.6931471803691238;
const LN2_LO = 1.9082149292705877e-10;
const LN2 = 0.6931471805599453;

// sin/cos kernels on |r| ≤ π/4 (Taylor, Horner form, coefficients 1/n!).
const S1 = -1 / 6;
const S2 = 1 / 120;
const S3 = -1 / 5040;
const S4 = 1 / 362880;
const S5 = -1 / 39916800;
const S6 = 1 / 6227020800;
const S7 = -1 / 1307674368000;
const S8 = 1 / 355687428096000;
const C1 = -1 / 2;
const C2 = 1 / 24;
const C3 = -1 / 720;
const C4 = 1 / 40320;
const C5 = -1 / 3628800;
const C6 = 1 / 479001600;
const C7 = -1 / 87178291200;
const C8 = 1 / 20922789888000;

function sinK(r: number): number {
  const r2 = r * r;
  return r + r * r2 * (S1 + r2 * (S2 + r2 * (S3 + r2 * (S4 + r2 * (S5 + r2 * (S6 + r2 * (S7 + r2 * S8)))))));
}
function cosK(r: number): number {
  const r2 = r * r;
  return 1 + r2 * (C1 + r2 * (C2 + r2 * (C3 + r2 * (C4 + r2 * (C5 + r2 * (C6 + r2 * (C7 + r2 * C8)))))));
}

/** Deterministic sine (radians). */
export function dsin(x: number): number {
  const k = Math.round(x / HALF_PI);
  const r = x - k * PIO2_HI - k * PIO2_LO;
  const q = ((k % 4) + 4) % 4;
  return q === 0 ? sinK(r) : q === 1 ? cosK(r) : q === 2 ? -sinK(r) : -cosK(r);
}

/** Deterministic cosine (radians). */
export function dcos(x: number): number {
  const k = Math.round(x / HALF_PI);
  const r = x - k * PIO2_HI - k * PIO2_LO;
  const q = ((k % 4) + 4) % 4;
  return q === 0 ? cosK(r) : q === 1 ? -sinK(r) : q === 2 ? -cosK(r) : sinK(r);
}

/** Deterministic arctangent (radians). */
export function datan(x: number): number {
  if (x !== x) return x;
  let sign = 1;
  if (x < 0) {
    x = -x;
    sign = -1;
  }
  let inv = false;
  if (x > 1) {
    x = 1 / x;
    inv = true;
  }
  let add = 0;
  if (x > 0.2679491924311227) {
    x = (x * SQRT3 - 1) / (x + SQRT3);
    add = PI / 6;
  }
  const x2 = x * x;
  // atan series to x^29 (|x| ≤ tan(π/12)).
  let s = 1 / 29;
  s = -1 / 27 + x2 * s;
  s = 1 / 25 + x2 * s;
  s = -1 / 23 + x2 * s;
  s = 1 / 21 + x2 * s;
  s = -1 / 19 + x2 * s;
  s = 1 / 17 + x2 * s;
  s = -1 / 15 + x2 * s;
  s = 1 / 13 + x2 * s;
  s = -1 / 11 + x2 * s;
  s = 1 / 9 + x2 * s;
  s = -1 / 7 + x2 * s;
  s = 1 / 5 + x2 * s;
  s = -1 / 3 + x2 * s;
  let r = add + x + x * x2 * s;
  if (inv) r = HALF_PI - r;
  return sign * r;
}

/** Deterministic atan2(y, x) (radians, −π..π). */
export function datan2(y: number, x: number): number {
  if (x > 0) return datan(y / x);
  if (x < 0) return y >= 0 ? datan(y / x) + PI : datan(y / x) - PI;
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}

export function dasin(x: number): number {
  const c = x < -1 ? -1 : x > 1 ? 1 : x;
  return datan2(c, Math.sqrt(Math.max(0, 1 - c * c)));
}

export function dacos(x: number): number {
  const c = x < -1 ? -1 : x > 1 ? 1 : x;
  return datan2(Math.sqrt(Math.max(0, 1 - c * c)), c);
}

/** Deterministic e^x for |x| < 700. */
export function dexp(x: number): number {
  if (x > 700) return Infinity;
  if (x < -700) return 0;
  const k = Math.round(x / LN2);
  const r = x - k * LN2_HI - k * LN2_LO;
  let s = 1 / 20922789888000; // 1/16!
  const inv = [
    1 / 1307674368000, 1 / 87178291200, 1 / 6227020800, 1 / 479001600, 1 / 39916800, 1 / 3628800, 1 / 362880, 1 / 40320,
    1 / 5040, 1 / 720, 1 / 120, 1 / 24, 1 / 6, 1 / 2, 1, 1,
  ];
  for (let i = 0; i < inv.length; i++) s = inv[i] + r * s;
  let m = 1;
  if (k > 0) for (let i = 0; i < k; i++) m *= 2;
  else for (let i = 0; i < -k; i++) m *= 0.5;
  return s * m;
}

export function dtanh(x: number): number {
  if (x > 20) return 1;
  if (x < -20) return -1;
  if (x > -1e-4 && x < 1e-4) return x - (x * x * x) / 3;
  const e = dexp(2 * x);
  return (e - 1) / (e + 1);
}

// ---------------------------------------------------------------------------------------------------------------
// Scalars and vectors
// ---------------------------------------------------------------------------------------------------------------

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smooth01 = (t: number): number => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const len = (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const dist = (a: Vec3, b: Vec3): number => len(sub(a, b));
export const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 0 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 };
};
export const lerpV = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
export const UP: Vec3 = { x: 0, y: 1, z: 0 };

/** Rotate v about the unit axis k by angle a (Rodrigues). */
export function rotate(v: Vec3, k: Vec3, a: number): Vec3 {
  const c = dcos(a);
  const s = dsin(a);
  const kv = cross(k, v);
  const kd = dot(k, v) * (1 - c);
  return { x: v.x * c + kv.x * s + k.x * kd, y: v.y * c + kv.y * s + k.y * kd, z: v.z * c + kv.z * s + k.z * kd };
}

/**
 * Bearings (contract): degrees from straight down the ground (towards the bowler, −z), positive towards the off side
 * (+x). Elevation: degrees above the horizontal.
 */
export function bearingDeg(dx: number, dz: number): number {
  return datan2(dx, -dz) * RAD;
}
export function elevationDeg(v: Vec3): number {
  return datan2(v.y, Math.sqrt(v.x * v.x + v.z * v.z)) * RAD;
}
export function dirFromBearing(bearing: number, elevation = 0): Vec3 {
  const b = bearing * DEG;
  const e = elevation * DEG;
  const ce = dcos(e);
  return { x: dsin(b) * ce, y: dsin(e), z: -dcos(b) * ce };
}
/** Smallest signed difference a − b between two bearings (degrees, −180..180). */
export function bearingDelta(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** Deterministic natural logarithm for x > 0 (range reduction by exact halving/doubling, then the atanh series). */
export function dlog(x: number): number {
  if (!(x > 0)) return x === 0 ? -Infinity : NaN;
  if (x === Infinity) return Infinity;
  let m = x;
  let k = 0;
  while (m >= 1.4142135623730951) {
    m *= 0.5;
    k += 1;
  }
  while (m < 0.7071067811865476) {
    m *= 2;
    k -= 1;
  }
  const s = (m - 1) / (m + 1);
  const s2 = s * s;
  // 2·atanh(s) = 2(s + s³/3 + s⁵/5 + …), |s| ≤ 0.1716: terms to s^23.
  let p = 1 / 23;
  p = 1 / 21 + s2 * p;
  p = 1 / 19 + s2 * p;
  p = 1 / 17 + s2 * p;
  p = 1 / 15 + s2 * p;
  p = 1 / 13 + s2 * p;
  p = 1 / 11 + s2 * p;
  p = 1 / 9 + s2 * p;
  p = 1 / 7 + s2 * p;
  p = 1 / 5 + s2 * p;
  p = 1 / 3 + s2 * p;
  const lnm = 2 * (s + s * s2 * p);
  return k * LN2_HI + (k * LN2_LO + lnm);
}
