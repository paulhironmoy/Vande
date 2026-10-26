/**
 * TEST-ONLY trajectories for the fielding, running and scoring tests: a struck ball under gravity and quadratic drag,
 * bouncing and rolling on the outfield, sampled at a fixed step until it stops or reaches the rope. It stands in for
 * the real integrator (src/physics/ball.ts) so the fielding rules can be tested against controlled, known shots; it
 * is never used by production code.
 */
import type { BallFlight, BallSample, DeliveryVariation, Vec3 } from '@/contracts/practice';
import { BALL_R, BOUNDARY_R, G, PITCH_HALF } from '@/physics/constants';
import type { PostContactBall } from '@/physics/fielding';

export interface StubShot {
  /** Contact time (s after release). */
  t0?: number;
  from?: Vec3;
  bearingDeg: number;
  speedKph: number;
  elevationDeg: number;
  /** Exact launch velocity (overrides bearing, speed and elevation). */
  v0?: Vec3;
  dt?: number;
  /** Drag constant (1/m), bounce restitution, horizontal retention per bounce, rolling deceleration (m/s²). */
  drag?: number;
  restitution?: number;
  retention?: number;
  rollDecel?: number;
}

export function stubShot(s: StubShot): PostContactBall {
  const t0 = s.t0 ?? 0.6;
  const dt = s.dt ?? 1 / 240;
  const k = s.drag ?? 0.0068;
  const e = s.restitution ?? 0.45;
  const fr = s.retention ?? 0.85;
  const roll = s.rollDecel ?? 1.2;
  const b = (s.bearingDeg * Math.PI) / 180;
  const el = (s.elevationDeg * Math.PI) / 180;
  const sp0 = s.speedKph / 3.6;
  let p: Vec3 = { ...(s.from ?? { x: 0, y: 0.6, z: 8.3 }) };
  let v: Vec3 = s.v0 ? { ...s.v0 } : { x: sp0 * Math.cos(el) * Math.sin(b), y: sp0 * Math.sin(el), z: -sp0 * Math.cos(el) * Math.cos(b) };
  const samples: BallSample[] = [{ t: t0, p: { ...p }, v: { ...v } }];
  const bounces: PostContactBall['bounces'] = [];
  let boundary: PostContactBall['boundary'] = null;
  let rolling = false;
  let t = t0;
  for (let i = 0; i < 40000; i++) {
    const sp = Math.hypot(v.x, v.y, v.z);
    if (!rolling) {
      v = { x: v.x - k * sp * v.x * dt, y: v.y - (G + k * sp * v.y) * dt, z: v.z - k * sp * v.z * dt };
      p = { x: p.x + v.x * dt, y: p.y + v.y * dt, z: p.z + v.z * dt };
      if (p.y <= BALL_R && v.y < 0) {
        p = { ...p, y: BALL_R };
        bounces.push({ t: t + dt, p: { ...p } });
        v = { x: v.x * fr, y: -v.y * e, z: v.z * fr };
        if (v.y < 0.8) {
          v = { ...v, y: 0 };
          rolling = true;
        }
      }
    } else {
      const h = Math.hypot(v.x, v.z);
      const nh = Math.max(0, h - roll * dt);
      v = h < 0.05 ? { x: 0, y: 0, z: 0 } : { x: (v.x * nh) / h, y: 0, z: (v.z * nh) / h };
      p = { x: p.x + v.x * dt, y: BALL_R, z: p.z + v.z * dt };
    }
    t += dt;
    samples.push({ t, p: { ...p }, v: { ...v } });
    if (Math.hypot(p.x, p.z) >= BOUNDARY_R) {
      boundary = { t, p: { ...p }, onFull: bounces.length === 0 };
      break;
    }
    if (rolling && v.x === 0 && v.z === 0) break;
  }
  return { t0, samples, bounces, boundary };
}

/**
 * A drag-free ball from the bat that passes over the ground point (x, z) at height `h` exactly `T` seconds after
 * contact, then carries on, lands and rolls (for precise catching geometry).
 */
export function stubThrough(x: number, z: number, h: number, T: number, opts: { t0?: number; dt?: number; from?: Vec3 } = {}): PostContactBall {
  const from = opts.from ?? { x: 0, y: 0.6, z: 8.3 };
  const v0 = { x: (x - from.x) / T, y: (h - from.y + 0.5 * G * T * T) / T, z: (z - from.z) / T };
  return stubShot({ t0: opts.t0, dt: opts.dt ?? 1 / 480, from, bearingDeg: 0, speedKph: 0, elevationDeg: 0, v0, drag: 0 });
}

/**
 * A synthetic delivery flight (test-only) with known movement: it swings `airSwingM` sideways in the air (constant
 * sideways acceleration), pitches `lengthM` in front of the striker's stumps at `lineAtBounceM`, deviates
 * `pitchDevM` off the pitch by the time it reaches the stumps, and carries on just past them.
 */
export function stubFlight(o: {
  speedKph?: number;
  lengthM?: number;
  lineAtBounceM?: number;
  airSwingM?: number;
  pitchDevM?: number;
  restitution?: number;
  variation?: DeliveryVariation;
  seed?: string;
}): BallFlight {
  const speed = (o.speedKph ?? 130) / 3.6;
  const lengthM = o.lengthM ?? 6;
  const zb = PITCH_HALF - lengthM;
  const p0: Vec3 = { x: 0.3, y: 2.1, z: -PITCH_HALF + 1.3 };
  const vz = speed;
  const tb = (zb - p0.z) / vz;
  const xb = o.lineAtBounceM ?? 0.1;
  const ax = (2 * (o.airSwingM ?? 0)) / (tb * tb);
  const vx0 = (xb - p0.x - 0.5 * ax * tb * tb) / tb;
  const vy0 = (BALL_R - p0.y + 0.5 * G * tb * tb) / tb;
  const ts = (PITCH_HALF - zb) / vz;
  const dvx = (o.pitchDevM ?? 0) / ts;
  const vyAfter = -(vy0 - G * tb) * (o.restitution ?? 0.55);
  const samples: BallSample[] = [];
  const dt = 1 / 500;
  const end = (PITCH_HALF + 0.6 - p0.z) / vz;
  const vxPre = vx0 + ax * tb;
  const state = (t: number): BallSample =>
    t <= tb
      ? { t, p: { x: p0.x + vx0 * t + 0.5 * ax * t * t, y: p0.y + vy0 * t - 0.5 * G * t * t, z: p0.z + vz * t }, v: { x: vx0 + ax * t, y: vy0 - G * t, z: vz } }
      : { t, p: { x: xb + (vxPre + dvx) * (t - tb), y: BALL_R + vyAfter * (t - tb) - 0.5 * G * (t - tb) * (t - tb), z: zb + vz * (t - tb) }, v: { x: vxPre + dvx, y: vyAfter - G * (t - tb), z: vz } };
  for (let t = 0; t <= end + 1e-9; t += dt) samples.push(state(t));
  const stumpsT = (PITCH_HALF - p0.z) / vz;
  const atStumps = state(stumpsT);
  const plan = { variation: o.variation ?? 'stock', lengthM, lineM: atStumps.p.x, speedKph: o.speedKph ?? 130 };
  return {
    version: 1,
    plan,
    seed: o.seed ?? 'stub',
    release: { p: p0, v: { x: vx0, y: vy0, z: vz }, spinRps: 0, seamDeg: 0, speedKph: o.speedKph ?? 130 },
    bounce: { t: tb, p: { x: xb, y: BALL_R, z: zb } },
    idealContactT: (PITCH_HALF - 1.6 - p0.z) / vz,
    stumpsT,
    wouldHitStumps: Math.abs(atStumps.p.x) <= 0.1143 + BALL_R && atStumps.p.y <= 0.711 + 0.013 + BALL_R,
    samples,
    // A synthetic flight without spin (its movement is prescribed above, not produced by spin).
    spin: { release: { x: 0, y: 0, z: 0 }, afterBounce: null },
  };
}
