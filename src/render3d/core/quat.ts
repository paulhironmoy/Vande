/** Minimal quaternion helpers stored in flat arrays [x, y, z, w]. Matches three.js conventions (Euler order XYZ). */
import { DEG } from './math';

export type Quat = [number, number, number, number];

export function quatFromEulerDeg(ex: number, ey: number, ez: number, out: Quat = [0, 0, 0, 1]): Quat {
  const x = ex * DEG * 0.5;
  const y = ey * DEG * 0.5;
  const z = ez * DEG * 0.5;
  const c1 = Math.cos(x);
  const c2 = Math.cos(y);
  const c3 = Math.cos(z);
  const s1 = Math.sin(x);
  const s2 = Math.sin(y);
  const s3 = Math.sin(z);
  out[0] = s1 * c2 * c3 + c1 * s2 * s3;
  out[1] = c1 * s2 * c3 - s1 * c2 * s3;
  out[2] = c1 * c2 * s3 + s1 * s2 * c3;
  out[3] = c1 * c2 * c3 - s1 * s2 * s3;
  return out;
}

export function quatSlerp(a: ArrayLike<number>, b: ArrayLike<number>, t: number, out: Float32Array | Quat, o = 0): void {
  let bx = b[0];
  let by = b[1];
  let bz = b[2];
  let bw = b[3];
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let k0: number;
  let k1: number;
  if (cos > 0.9995) {
    k0 = 1 - t;
    k1 = t;
  } else {
    const theta = Math.acos(cos);
    const sin = Math.sin(theta);
    k0 = Math.sin((1 - t) * theta) / sin;
    k1 = Math.sin(t * theta) / sin;
  }
  let x = a[0] * k0 + bx * k1;
  let y = a[1] * k0 + by * k1;
  let z = a[2] * k0 + bz * k1;
  let w = a[3] * k0 + bw * k1;
  const l = Math.hypot(x, y, z, w) || 1;
  x /= l;
  y /= l;
  z /= l;
  w /= l;
  out[o] = x;
  out[o + 1] = y;
  out[o + 2] = z;
  out[o + 3] = w;
}
