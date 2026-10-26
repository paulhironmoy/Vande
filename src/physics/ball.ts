/**
 * The one ball integrator for Practice: the delivery from the hand, the ball off the bat, every bounce and the roll.
 *
 * In the air: gravity, quadratic drag, Magnus lift from spin (drift and dip) and, before the first bounce only, the
 * swing side force from the seam. Bounces: pitch or outfield restitution on the normal velocity; Coulomb friction
 * along the line of travel (speed lost off the pitch, top-spin gained); a partial rolling constraint across it (the
 * surface's grip turns side-spin into turn); and, on the first pitch bounce of a delivery, the seam deflection.
 * On the ground: rolling resistance plus grass drag until rest. Fixed step RK4 (SIM_DT) with events located inside
 * the step, all in deterministic arithmetic, so the same start state always produces the same samples.
 */
import type { BallSample } from '@/contracts/practice';
import {
  AIR_DENSITY,
  BALL_AREA,
  BALL_INERTIA_K,
  BALL_MASS,
  BALL_R,
  BOUNDARY_R,
  DRAG_CD,
  G,
  LIFT_CL_MAX,
  LIFT_CL_SLOPE,
  MAX_SIM_S,
  OUTFIELD,
  PITCHES,
  PITCH_HALF,
  PITCH_WIDTH,
  PLOUGH_SPIN_FRACTION,
  POST_CONTACT_SAMPLE_EVERY,
  SIM_DT,
  SPIN_DECAY_S,
  STUMPS_HALF_W,
  STUMPS_TOP,
  STUMP_R,
  SWING_FADE_FLOOR,
  TURN_FRICTION_CAP,
  SWING_FADE_FROM_MS,
  SWING_FADE_TO_MS,
  type PitchParams,
} from './constants';
import { type Vec3, cross, dexp, len, norm, v3 } from './vec';

/** Full ball state: position, velocity and spin vector (rad/s, right-hand rule). */
export interface BallState {
  t: number;
  p: Vec3;
  v: Vec3;
  spin: Vec3;
}

export type Surface = 'pitch' | 'outfield';

export interface SimulateOptions {
  /** Signed swing side-force coefficient (+ pushes towards +x, the off side), active until the first bounce. */
  swingCs?: number;
  /** Seam deflection at the first bounce on the pitch (radians about the vertical, + towards +x). */
  seamDev?: number;
  /** Pitch-strip surface (default balanced). Bounces off the strip use OUTFIELD. */
  pitch?: PitchParams;
  /** Stop once t ≥ untilT (absolute simulation time). */
  untilT?: number;
  /** Stop once the ball's z ≥ untilZ (used by deliveries: just past the striker's stumps). */
  untilZ?: number;
  /** Stop at the rope (default true). */
  stopAtBoundary?: boolean;
  /** Stop when the rolling ball comes to rest (default true). */
  stopAtRest?: boolean;
  /** Stop when the ball hits the striker's stumps (default false; e.g. an inside edge played on). */
  detectStumps?: boolean;
  /** Output one sample every N steps (default 1 = every SIM_DT). */
  sampleEvery?: number;
}

export interface SimResult {
  /** Spacing of `samples` (s): SIM_DT × sampleEvery. Samples sit on the grid t0 + i·dt. */
  dt: number;
  samples: BallSample[];
  bounces: Array<{ t: number; p: Vec3; v: Vec3; surface: Surface }>;
  /** First crossing of the rope (horizontal radius BOUNDARY_R from the pitch centre); onFull = no bounce before. */
  boundary: { t: number; p: Vec3; onFull: boolean } | null;
  /** At rest on the ground. */
  stopped: { t: number; p: Vec3 } | null;
  /** First crossing of the striker's stumps plane (z = PITCH_HALF), if any. */
  plane: { t: number; p: Vec3; v: Vec3 } | null;
  /** Hit the striker's stumps (only with detectStumps). */
  stumps: { t: number; p: Vec3 } | null;
  /** State at the end of the simulation. */
  end: BallState;
  /** True once the ball rolls. */
  rolling: boolean;
}

const KA = (0.5 * AIR_DENSITY * BALL_AREA) / BALL_MASS;
const KD = KA * DRAG_CD;
const ROLL_K = 1 + 1 / BALL_INERTIA_K; // impulse needed to stop slip: m·u / ROLL_K
const SPIN_DECAY_STEP = dexp(-SIM_DT / SPIN_DECAY_S);
/** Grass grips side-spin far less than a prepared pitch. */
export const OUTFIELD_TURN_GRIP = 0.3;

function swingFade(speed: number): number {
  if (speed <= SWING_FADE_FROM_MS) return 1;
  if (speed >= SWING_FADE_TO_MS) return SWING_FADE_FLOOR;
  return 1 - ((1 - SWING_FADE_FLOOR) * (speed - SWING_FADE_FROM_MS)) / (SWING_FADE_TO_MS - SWING_FADE_FROM_MS);
}

/** Acceleration in the air for velocity (vx, vy, vz), spin w and swing coefficient. Writes into out. */
export function accel(vx: number, vy: number, vz: number, w: Vec3, swing: number, out: number[]): void {
  const sp2 = vx * vx + vy * vy + vz * vz;
  const sp = Math.sqrt(sp2);
  let ax = -KD * sp * vx;
  let ay = -G - KD * sp * vy;
  let az = -KD * sp * vz;
  // Magnus: along ω × v with C_L from the spin parameter of the spin component normal to the velocity.
  const mx = w.y * vz - w.z * vy;
  const my = w.z * vx - w.x * vz;
  const mz = w.x * vy - w.y * vx;
  const mm = Math.sqrt(mx * mx + my * my + mz * mz);
  if (mm > 1e-9 && sp > 1e-6) {
    const s = (BALL_R * (mm / sp)) / sp;
    const cl = Math.min(LIFT_CL_MAX, LIFT_CL_SLOPE * s);
    const f = (KA * cl * sp2) / mm;
    ax += f * mx;
    ay += f * my;
    az += f * mz;
  }
  // Swing: horizontal side force perpendicular to the velocity, (up × v) = (vz, 0, −vx).
  if (swing !== 0) {
    const h = Math.sqrt(vx * vx + vz * vz);
    if (h > 1e-6) {
      const f = (KA * swing * swingFade(sp) * sp2) / h;
      ax += f * vz;
      az -= f * vx;
    }
  }
  out[0] = ax;
  out[1] = ay;
  out[2] = az;
}

const A1 = [0, 0, 0];
const A2 = [0, 0, 0];
const A3 = [0, 0, 0];
const A4 = [0, 0, 0];

/** One RK4 step of length h in the air. Returns the new [px, py, pz, vx, vy, vz]. */
function rk4(p: Vec3, v: Vec3, w: Vec3, swing: number, h: number): [number, number, number, number, number, number] {
  accel(v.x, v.y, v.z, w, swing, A1);
  const h2 = h / 2;
  const v2x = v.x + h2 * A1[0];
  const v2y = v.y + h2 * A1[1];
  const v2z = v.z + h2 * A1[2];
  accel(v2x, v2y, v2z, w, swing, A2);
  const v3x = v.x + h2 * A2[0];
  const v3y = v.y + h2 * A2[1];
  const v3z = v.z + h2 * A2[2];
  accel(v3x, v3y, v3z, w, swing, A3);
  const v4x = v.x + h * A3[0];
  const v4y = v.y + h * A3[1];
  const v4z = v.z + h * A3[2];
  accel(v4x, v4y, v4z, w, swing, A4);
  const h6 = h / 6;
  return [
    p.x + h6 * (v.x + 2 * v2x + 2 * v3x + v4x),
    p.y + h6 * (v.y + 2 * v2y + 2 * v3y + v4y),
    p.z + h6 * (v.z + 2 * v2z + 2 * v3z + v4z),
    v.x + h6 * (A1[0] + 2 * A2[0] + 2 * A3[0] + A4[0]),
    v.y + h6 * (A1[1] + 2 * A2[1] + 2 * A3[1] + A4[1]),
    v.z + h6 * (A1[2] + 2 * A2[2] + 2 * A3[2] + A4[2]),
  ];
}

export function onStrip(p: Vec3): boolean {
  return p.x <= PITCH_WIDTH / 2 && p.x >= -PITCH_WIDTH / 2 && p.z <= PITCH_HALF + 1.5 && p.z >= -PITCH_HALF - 1.5;
}

/**
 * Bounce: restitution on the normal, Coulomb friction along the line of travel, partial rolling grip across it,
 * then the seam deflection. Mutates v and w. Returns the post-bounce vertical speed.
 */
export function bounce(v: Vec3, w: Vec3, s: PitchParams | typeof OUTFIELD, turnGrip: number, seamDev: number): void {
  const vyIn = v.y < 0 ? -v.y : 0;
  const e = s.restitution;
  const jn = (1 + e) * vyIn; // normal impulse per unit mass
  v.y = e * vyIn;
  const hx = v.x;
  const hz = v.z;
  const hl = Math.sqrt(hx * hx + hz * hz);
  // Travel direction f and lateral l = up × f in the ground plane.
  const fx = hl > 1e-9 ? hx / hl : 0;
  const fz = hl > 1e-9 ? hz / hl : 1;
  const lx = fz;
  const lz = -fx;
  // Slip velocity of the contact point (bottom of the ball): u = v + ω × (0, −R, 0) = (vx + R ωz, 0, vz − R ωx).
  const ux = v.x + BALL_R * w.z;
  const uz = v.z - BALL_R * w.x;
  const uf = ux * fx + uz * fz;
  const ul = ux * lx + uz * lz;
  const rollF = uf / ROLL_K;
  const capF = s.friction * jn;
  const jf = rollF > capF ? capF : rollF < -capF ? -capF : rollF;
  let jl = (turnGrip * ul) / ROLL_K;
  const capL = TURN_FRICTION_CAP * jn;
  if (jl > capL) jl = capL;
  else if (jl < -capL) jl = -capL;
  // Friction impulse on the ball (per unit mass) opposes the slip.
  const jx = -(jf * fx + jl * lx);
  const jz = -(jf * fz + jl * lz);
  v.x += jx;
  v.z += jz;
  // Spin change: Δω = r × J / (k R²), r = (0, −R, 0)  →  (−Jz, 0, Jx) / (k R); the longitudinal part ploughs.
  const sx = -(PLOUGH_SPIN_FRACTION * jf * fx + jl * lx);
  const sz = -(PLOUGH_SPIN_FRACTION * jf * fz + jl * lz);
  w.x += -sz / (BALL_INERTIA_K * BALL_R);
  w.z += sx / (BALL_INERTIA_K * BALL_R);
  if (seamDev !== 0) {
    // Rotate the ground velocity about +y by seamDev (+ towards +x for a ball travelling to +z).
    const c = 1 - (seamDev * seamDev) / 2 + (seamDev * seamDev * seamDev * seamDev) / 24;
    const sn = seamDev - (seamDev * seamDev * seamDev) / 6;
    const nx = v.x * c + v.z * sn;
    const nz = -v.x * sn + v.z * c;
    v.x = nx;
    v.z = nz;
  }
}

const ROLL_E_STEP = dexp(-OUTFIELD.rollDrag * SIM_DT);

/** Rolling over h seconds (exact for a = rollDecel + rollDrag·v). Mutates p, v. Returns true if it came to rest. */
function rollStep(p: Vec3, v: Vec3, h: number): boolean {
  const s = Math.sqrt(v.x * v.x + v.z * v.z);
  v.y = 0;
  p.y = BALL_R;
  if (s < OUTFIELD.stopSpeed) {
    v.x = 0;
    v.z = 0;
    return true;
  }
  const k = OUTFIELD.rollDrag;
  const c = OUTFIELD.rollDecel / k;
  const e = h === SIM_DT ? ROLL_E_STEP : dexp(-k * h);
  let s1 = (s + c) * e - c;
  let d = ((s + c) * (1 - e)) / k - c * h;
  let rest = false;
  if (s1 < OUTFIELD.stopSpeed) {
    if (s1 < 0) d = (s * h) / 2;
    s1 = 0;
    rest = true;
  }
  const dx = v.x / s;
  const dz = v.z / s;
  p.x += dx * d;
  p.z += dz * d;
  v.x = dx * s1;
  v.z = dz * s1;
  return rest;
}

/** Distance from a point to the striker's stumps (a box: three stumps and bails). */
function distToStumps(x: number, y: number, z: number): number {
  const cx = x < -STUMPS_HALF_W ? -STUMPS_HALF_W : x > STUMPS_HALF_W ? STUMPS_HALF_W : x;
  const cy = y < 0 ? 0 : y > STUMPS_TOP ? STUMPS_TOP : y;
  const zl = PITCH_HALF - STUMP_R;
  const zh = PITCH_HALF + STUMP_R;
  const cz = z < zl ? zl : z > zh ? zh : z;
  const dx = x - cx;
  const dy = y - cy;
  const dz = z - cz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Integrate a ball from `start` on the fixed SIM_DT grid until a stop condition. Pure and deterministic. */
export function integrateBall(start: BallState, opts: SimulateOptions = {}): SimResult {
  const pitch = opts.pitch ?? PITCHES.balanced;
  const every = Math.max(1, Math.floor(opts.sampleEvery ?? 1));
  const stopAtBoundary = opts.stopAtBoundary ?? true;
  const stopAtRest = opts.stopAtRest ?? true;
  const untilT = opts.untilT ?? start.t + MAX_SIM_S;
  const untilZ = opts.untilZ ?? Infinity;
  let swing = opts.swingCs ?? 0;
  const seamDev = opts.seamDev ?? 0;
  const p: Vec3 = { x: start.p.x, y: start.p.y < BALL_R ? BALL_R : start.p.y, z: start.p.z };
  const v: Vec3 = { x: start.v.x, y: start.v.y, z: start.v.z };
  const w: Vec3 = { x: start.spin.x, y: start.spin.y, z: start.spin.z };
  let rolling = p.y <= BALL_R + 1e-9 && v.y < OUTFIELD.rollVy && v.y > -OUTFIELD.rollVy;
  if (rolling) v.y = 0;
  /** A ball that starts on the grass (rolling) is grounded: it can never cross the rope on the full. */
  const startedGrounded = rolling;
  const t0 = start.t;
  const samples: BallSample[] = [{ t: t0, p: { ...p }, v: { ...v } }];
  const bounces: SimResult['bounces'] = [];
  let boundary: SimResult['boundary'] = null;
  let stopped: SimResult['stopped'] = null;
  let plane: SimResult['plane'] = null;
  let stumps: SimResult['stumps'] = null;
  let pitchBounces = 0;
  const R2 = BOUNDARY_R * BOUNDARY_R;
  let outside = p.x * p.x + p.z * p.z >= R2;
  let i = 0;
  let tEnd = t0;
  for (;;) {
    const tPrev = t0 + i * SIM_DT;
    if (tPrev >= untilT - 1e-12) break;
    i += 1;
    const tNow = t0 + i * SIM_DT;
    const px0 = p.x;
    const py0 = p.y;
    const pz0 = p.z;
    const vx0 = v.x;
    const vy0 = v.y;
    const vz0 = v.z;
    let rest = false;
    if (rolling) {
      rest = rollStep(p, v, SIM_DT);
    } else {
      const s = rk4(p, v, w, swing, SIM_DT);
      if (s[1] < BALL_R && (vy0 < 0 || s[4] < 0)) {
        // Ground contact inside the step: locate it, bounce, then finish the step.
        let f = py0 - s[1] > 1e-12 ? (py0 - BALL_R) / (py0 - s[1]) : 1;
        f = f < 0 ? 0 : f > 1 ? 1 : f;
        let s1 = rk4(p, v, w, swing, f * SIM_DT);
        if (s1[4] < 0) {
          const f2 = f + (s1[1] - BALL_R) / (-s1[4] * SIM_DT);
          f = f2 < 0 ? 0 : f2 > 1 ? 1 : f2;
          s1 = rk4(p, v, w, swing, f * SIM_DT);
        }
        p.x = s1[0];
        p.y = BALL_R;
        p.z = s1[2];
        v.x = s1[3];
        v.y = s1[4];
        v.z = s1[5];
        const surface: Surface = onStrip(p) ? 'pitch' : 'outfield';
        if (surface === 'pitch') bounce(v, w, pitch, pitch.turnGrip, pitchBounces === 0 ? seamDev : 0);
        else bounce(v, w, OUTFIELD, OUTFIELD_TURN_GRIP, 0);
        if (surface === 'pitch') pitchBounces += 1;
        swing = 0;
        bounces.push({ t: tPrev + f * SIM_DT, p: { ...p }, v: { ...v }, surface });
        const rem = (1 - f) * SIM_DT;
        if (v.y < OUTFIELD.rollVy) {
          rolling = true;
          v.y = 0;
          if (rem > 0) rest = rollStep(p, v, rem);
        } else if (rem > 0) {
          const s2 = rk4(p, v, w, 0, rem);
          p.x = s2[0];
          p.y = s2[1] < BALL_R ? BALL_R : s2[1];
          p.z = s2[2];
          v.x = s2[3];
          v.y = s2[4];
          v.z = s2[5];
        }
      } else {
        p.x = s[0];
        p.y = s[1];
        p.z = s[2];
        v.x = s[3];
        v.y = s[4];
        v.z = s[5];
      }
    }
    w.x *= SPIN_DECAY_STEP;
    w.y *= SPIN_DECAY_STEP;
    w.z *= SPIN_DECAY_STEP;
    tEnd = tNow;
    let done = false;
    // Striker's stumps plane.
    if (!plane && pz0 < PITCH_HALF && p.z >= PITCH_HALF) {
      const g = (PITCH_HALF - pz0) / (p.z - pz0);
      plane = {
        t: tPrev + g * SIM_DT,
        p: v3(px0 + (p.x - px0) * g, py0 + (p.y - py0) * g, PITCH_HALF),
        v: v3(vx0 + (v.x - vx0) * g, vy0 + (v.y - vy0) * g, vz0 + (v.z - vz0) * g),
      };
    }
    // Hitting the striker's stumps (sub-sampled so a fast ball cannot pass through them between steps).
    if (opts.detectStumps && !stumps) {
      for (let k = 1; k <= 4; k++) {
        const g = k / 4;
        const x = px0 + (p.x - px0) * g;
        const y = py0 + (p.y - py0) * g;
        const z = pz0 + (p.z - pz0) * g;
        if (distToStumps(x, y, z) <= BALL_R) {
          stumps = { t: tPrev + g * SIM_DT, p: v3(x, y, z) };
          done = true;
          break;
        }
      }
    }
    // The rope.
    const r2 = p.x * p.x + p.z * p.z;
    if (!boundary && !outside && r2 >= R2) {
      const dx = p.x - px0;
      const dz = p.z - pz0;
      const a = dx * dx + dz * dz;
      const b = 2 * (px0 * dx + pz0 * dz);
      const c = px0 * px0 + pz0 * pz0 - R2;
      const disc = b * b - 4 * a * c;
      const g = a > 0 ? (-b + Math.sqrt(disc > 0 ? disc : 0)) / (2 * a) : 1;
      const gc = g < 0 ? 0 : g > 1 ? 1 : g;
      const tb = tPrev + gc * SIM_DT;
      const onFull = !startedGrounded && !bounces.some((bb) => bb.t <= tb);
      boundary = { t: tb, p: v3(px0 + dx * gc, py0 + (p.y - py0) * gc, pz0 + dz * gc), onFull };
      if (stopAtBoundary) done = true;
    }
    outside = r2 >= R2;
    if (rest) {
      stopped = { t: tNow, p: { ...p } };
      if (stopAtRest) done = true;
    }
    if (p.z >= untilZ) done = true;
    if (i % every === 0) samples.push({ t: tNow, p: { ...p }, v: { ...v } });
    if (done) break;
  }
  return {
    dt: SIM_DT * every,
    samples,
    bounces,
    boundary,
    stopped,
    plane,
    stumps,
    end: { t: tEnd, p: { ...p }, v: { ...v }, spin: { ...w } },
    rolling,
  };
}

/** Back-spin axis for a ball moving with v: ω ∥ v̂ × up, so ω × v points up (lift). Zero for vertical motion. */
export function backspinVector(v: Vec3, rps: number): Vec3 {
  const a = cross(norm(v), { x: 0, y: 1, z: 0 });
  const l = len(a);
  if (l < 1e-9 || rps === 0) return v3(0, 0, 0);
  const s = (2 * Math.PI * rps) / l;
  return v3(a.x * s, a.y * s, a.z * s);
}

/** Start of a free ball (off the bat, off the pad, or a missed ball carried on to the keeper). */
export interface SimStart {
  t: number;
  p: Vec3;
  v: Vec3;
  /** Back-spin (+) or top-spin (−) about the horizontal axis normal to v, rev/s. Ignored when `spin` is given. */
  spinRps?: number;
  /** Full spin vector (rad/s). */
  spin?: Vec3;
}

/**
 * Post-contact (or carry-on) simulation: flight, bounces on the pitch strip or the outfield, roll to rest, rope.
 * Defaults: one sample every POST_CONTACT_SAMPLE_EVERY steps, stops at the rope and at rest, MAX_SIM_S at most.
 */
export function simulate(start: SimStart, opts: SimulateOptions = {}): SimResult {
  const spin = start.spin ?? backspinVector(start.v, start.spinRps ?? 0);
  return integrateBall({ t: start.t, p: start.p, v: start.v, spin }, { sampleEvery: POST_CONTACT_SAMPLE_EVERY, ...opts });
}
