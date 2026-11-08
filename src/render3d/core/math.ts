/** Small, allocation-light math for the renderer core. Pure and deterministic (no Math.random, no clock). */
import { Sfc32, createRng, hashString } from '@/engine/prng';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const lerpV = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
export const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const dist2D = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const invLerp = (a: number, b: number, v: number): number => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp01(invLerp(a, b, v));
  return t * t * (3 - 2 * t);
};
export const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
export const easeIn = (t: number): number => Math.pow(clamp01(t), 3);
export const DEG = Math.PI / 180;

/** Heading (radians, 0 = facing +z, positive turns towards +x) from a ground direction. */
export const headingOf = (dx: number, dz: number): number => Math.atan2(dx, dz);
/** Shortest signed difference between two angles. */
export const angleDelta = (from: number, to: number): number => {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
export const lerpAngle = (a: number, b: number, t: number): number => a + angleDelta(a, b) * t;

/**
 * Deterministic randomness comes from the one PRNG family, src/engine/prng.ts: its string hash, and its sfc32
 * generator seeded from a uint32 (splitmix expansion). The renderer keeps no generator of its own.
 */
export const hash32 = hashString;

/** A [0, 1) stream on the engine's sfc32 for a uint32 seed (mutable, allocation-free per draw). */
export function seededStream(seed: number): () => number {
  const s = createRng(seed >>> 0);
  const g = new Sfc32(s.a, s.b, s.c, s.d);
  return () => g.float();
}
