/**
 * Allocation-free probe runs of the one ball model, for the match solvers' iterations (flightFromPath, aimShot).
 *
 * The same physics as integrateBall (its own accel() force model and bounce() impulse model, RK4, bounce located
 * inside the step and the step completed), but with a configurable step (PROBE_DT = 4 ms), state in local numbers,
 * no samples, only the events a residual needs (first bounce, a plane or distance crossing, the rope, rest), and the
 * roll integrated in closed form (a = rollDecel + rollDrag·v has an exact solution). A solver iterates on probes and
 * then makes one final integrateBall run on the 1 ms grid for its output. Practice never uses probes.
 */
import type { Vec3 } from '@/contracts/practice';
import { OUTFIELD_TURN_GRIP, accel, bounce, onStrip, type SimResult } from './ball';
import { BALL_R, BOUNDARY_R, OUTFIELD, PITCH_HALF, SPIN_DECAY_S, type PitchParams } from './constants';

const PLANE_Z = PITCH_HALF;
import { dexp, dlog } from './vec';

/** Probe step (s). RK4 at 4 ms differs from the 1 ms grid by well under a millimetre over a delivery or a hit. */
export const PROBE_DT = 0.004;

export interface ProbeIn {
  t0: number;
  p: Vec3;
  v: Vec3;
  spin: Vec3;
  swingCs: number;
  seamDev: number;
  pitch: PitchParams;
  dt: number;
  untilT: number;
  /** Stop once z ≥ untilZ (Infinity: never). */
  untilZ: number;
  /** Record the first crossing of z = planeZ (NaN: off). */
  planeZ: number;
  stopAtFirstBounce: boolean;
  /** Record the first time the distance from (ox, oz) along (ux, uz) reaches d (d NaN: off). */
  along: { ox: number; oz: number; ux: number; uz: number; d: number } | null;
  /** End the probe as soon as the `along` crossing is recorded. */
  stopAtAlong?: boolean;
  /** Integrate the roll (to rest, the rope, untilT) in closed form; false ends the probe when the ball rolls. */
  roll: boolean;
  /** Stop at the rope and record the crossing. */
  rope: boolean;
}

export interface ProbeOut {
  bounced: boolean;
  /** First bounce: time, position, velocity just before and just after, spin after. */
  bT: number;
  bX: number;
  bZ: number;
  bVxPre: number;
  bVzPre: number;
  bVx: number;
  bVy: number;
  bVz: number;
  planeHit: boolean;
  pT: number;
  pX: number;
  pY: number;
  alongHit: boolean;
  aT: number;
  aX: number;
  aY: number;
  aZ: number;
  aSpeed: number;
  aBeforeBounce: boolean;
  ropeHit: boolean;
  rT: number;
  rX: number;
  rY: number;
  rZ: number;
  rOnFull: boolean;
  rSpeed: number;
  rest: boolean;
  sT: number;
  sX: number;
  sZ: number;
  rolling: boolean;
  eT: number;
  eX: number;
  eY: number;
  eZ: number;
  eVx: number;
  eVy: number;
  eVz: number;
}

function blank(): ProbeOut {
  return {
    bounced: false, bT: 0, bX: 0, bZ: 0, bVxPre: 0, bVzPre: 0, bVx: 0, bVy: 0, bVz: 0,
    planeHit: false, pT: 0, pX: 0, pY: 0,
    alongHit: false, aT: 0, aX: 0, aY: 0, aZ: 0, aSpeed: 0, aBeforeBounce: false,
    ropeHit: false, rT: 0, rX: 0, rY: 0, rZ: 0, rOnFull: false, rSpeed: 0,
    rest: false, sT: 0, sX: 0, sZ: 0, rolling: false,
    eT: 0, eX: 0, eY: 0, eZ: 0, eVx: 0, eVy: 0, eVz: 0,
  };
}

const A1 = [0, 0, 0];
const A2 = [0, 0, 0];
const A3 = [0, 0, 0];
const A4 = [0, 0, 0];
const S = new Float64Array(6);

/** RK4 step of length h (the arithmetic of ball.ts's rk4), into S. */
function rk4Into(px: number, py: number, pz: number, vx: number, vy: number, vz: number, w: Vec3, swing: number, h: number): void {
  accel(vx, vy, vz, w, swing, A1);
  const h2 = h / 2;
  const v2x = vx + h2 * A1[0];
  const v2y = vy + h2 * A1[1];
  const v2z = vz + h2 * A1[2];
  accel(v2x, v2y, v2z, w, swing, A2);
  const v3x = vx + h2 * A2[0];
  const v3y = vy + h2 * A2[1];
  const v3z = vz + h2 * A2[2];
  accel(v3x, v3y, v3z, w, swing, A3);
  const v4x = vx + h * A3[0];
  const v4y = vy + h * A3[1];
  const v4z = vz + h * A3[2];
  accel(v4x, v4y, v4z, w, swing, A4);
  const h6 = h / 6;
  S[0] = px + h6 * (vx + 2 * v2x + 2 * v3x + v4x);
  S[1] = py + h6 * (vy + 2 * v2y + 2 * v3y + v4y);
  S[2] = pz + h6 * (vz + 2 * v2z + 2 * v3z + v4z);
  S[3] = vx + h6 * (A1[0] + 2 * A2[0] + 2 * A3[0] + A4[0]);
  S[4] = vy + h6 * (A1[1] + 2 * A2[1] + 2 * A3[1] + A4[1]);
  S[5] = vz + h6 * (A1[2] + 2 * A2[2] + 2 * A3[2] + A4[2]);
}

/** Distance from (x, z) along the unit (dx, dz) to the rope circle (0 if already outside). */
export function ropeAhead(x: number, z: number, dx: number, dz: number): number {
  const b = x * dx + z * dz;
  const c = x * x + z * z - BOUNDARY_R * BOUNDARY_R;
  if (c >= 0) return 0;
  return -b + Math.sqrt(b * b - c);
}

/** Closed-form roll: distance and speed after τ seconds from speed s0 (a = rollDecel + rollDrag·v). */
const RK = OUTFIELD.rollDrag;
const RC = OUTFIELD.rollDecel / OUTFIELD.rollDrag;
function rollD(s0: number, tau: number): number {
  return ((s0 + RC) * (1 - dexp(-RK * tau))) / RK - RC * tau;
}
function rollV(s0: number, tau: number): number {
  return (s0 + RC) * dexp(-RK * tau) - RC;
}
/** Time to roll L metres from s0 (L ≤ the stopping distance), by Newton on the concave distance. */
function rollTime(s0: number, L: number, tauMax: number): number {
  if (L <= 0) return 0;
  let tau = Math.min(tauMax, L / Math.max(s0, 1e-6));
  for (let i = 0; i < 30; i++) {
    const f = rollD(s0, tau) - L;
    const v = rollV(s0, tau);
    if (Math.abs(f) < 1e-9 || v <= 1e-9) break;
    let next = tau - f / v;
    if (next < 0) next = tau / 2;
    if (next > tauMax) next = (tau + tauMax) / 2;
    tau = next;
  }
  return tau;
}

/** The analytic roll from (t, x, z) at ground velocity (vx, vz) to rest, the rope or untilT. Fills the end state. */
function rollOut(o: ProbeOut, inp: ProbeIn, t: number, x: number, z: number, vx: number, vz: number): void {
  o.rolling = true;
  const s0 = Math.sqrt(vx * vx + vz * vz);
  const finish = (tt: number, xx: number, zz: number, ex: number, ez: number) => {
    o.eT = tt;
    o.eX = xx;
    o.eY = BALL_R;
    o.eZ = zz;
    o.eVx = ex;
    o.eVy = 0;
    o.eVz = ez;
  };
  if (s0 < OUTFIELD.stopSpeed) {
    o.rest = true;
    o.sT = t;
    o.sX = x;
    o.sZ = z;
    finish(t, x, z, 0, 0);
    return;
  }
  const dx = vx / s0;
  const dz = vz / s0;
  const tauStop = dlog((s0 + RC) / (OUTFIELD.stopSpeed + RC)) / RK;
  let tauEnd = tauStop;
  let atRope = false;
  if (inp.rope) {
    const L = ropeAhead(x, z, dx, dz);
    if (L <= rollD(s0, tauStop)) {
      const tr = rollTime(s0, L, tauStop);
      o.ropeHit = true;
      o.rT = t + tr;
      o.rX = x + dx * L;
      o.rY = BALL_R;
      o.rZ = z + dz * L;
      o.rOnFull = false;
      o.rSpeed = rollV(s0, tr);
      tauEnd = tr;
      atRope = true;
    }
  }
  const a = inp.along;
  if (a && !o.alongHit) {
    const proj = dx * a.ux + dz * a.uz;
    const a0 = (x - a.ox) * a.ux + (z - a.oz) * a.uz;
    if (proj > 1e-9) {
      const need = (a.d - a0) / proj;
      if (need >= 0 && need <= rollD(s0, tauEnd)) {
        const ta = rollTime(s0, need, tauEnd);
        o.alongHit = true;
        o.aT = t + ta;
        o.aX = x + dx * need;
        o.aY = BALL_R;
        o.aZ = z + dz * need;
        o.aSpeed = rollV(s0, ta);
        o.aBeforeBounce = false;
      }
    }
  }
  if (t + tauEnd > inp.untilT) {
    const tau = Math.max(0, inp.untilT - t);
    const d = rollD(s0, tau);
    const s = rollV(s0, tau);
    finish(t + tau, x + dx * d, z + dz * d, dx * s, dz * s);
    return;
  }
  const d = rollD(s0, tauEnd);
  if (!atRope) {
    o.rest = true;
    o.sT = t + tauEnd;
    o.sX = x + dx * d;
    o.sZ = z + dz * d;
    finish(t + tauEnd, o.sX, o.sZ, 0, 0);
    return;
  }
  const s = rollV(s0, tauEnd);
  finish(t + tauEnd, x + dx * d, z + dz * d, dx * s, dz * s);
}

/** One probe run. Deterministic; allocates only its result. */
export function probe(inp: ProbeIn): ProbeOut {
  const o = blank();
  const h = inp.dt;
  const decay = dexp(-h / SPIN_DECAY_S);
  const w = { x: inp.spin.x, y: inp.spin.y, z: inp.spin.z };
  const vb = { x: 0, y: 0, z: 0 };
  const pb = { x: 0, y: 0, z: 0 };
  let px = inp.p.x;
  let py = inp.p.y < BALL_R ? BALL_R : inp.p.y;
  let pz = inp.p.z;
  let vx = inp.v.x;
  let vy = inp.v.y;
  let vz = inp.v.z;
  let swing = inp.swingCs;
  let pitchBounces = 0;
  const startedGrounded = py <= BALL_R + 1e-9 && vy < OUTFIELD.rollVy && vy > -OUTFIELD.rollVy;
  const R2 = BOUNDARY_R * BOUNDARY_R;
  const a = inp.along;
  const planeOn = inp.planeZ === inp.planeZ;
  if (startedGrounded) {
    if (inp.roll) rollOut(o, inp, inp.t0, px, pz, vx, vz);
    else {
      o.rolling = true;
      o.eT = inp.t0;
      o.eX = px;
      o.eY = BALL_R;
      o.eZ = pz;
      o.eVx = vx;
      o.eVz = vz;
    }
    return o;
  }
  let outside = px * px + pz * pz >= R2;
  let i = 0;
  for (;;) {
    const tPrev = inp.t0 + i * h;
    if (tPrev >= inp.untilT - 1e-12) break;
    i += 1;
    const px0 = px;
    const py0 = py;
    const pz0 = pz;
    const vx0 = vx;
    const vy0 = vy;
    const vz0 = vz;
    let rolledAt = -1;
    rk4Into(px, py, pz, vx, vy, vz, w, swing, h);
    if (S[1] < BALL_R && (vy0 < 0 || S[4] < 0)) {
      let f = py0 - S[1] > 1e-12 ? (py0 - BALL_R) / (py0 - S[1]) : 1;
      f = f < 0 ? 0 : f > 1 ? 1 : f;
      rk4Into(px0, py0, pz0, vx0, vy0, vz0, w, swing, f * h);
      if (S[4] < 0) {
        const f2 = f + (S[1] - BALL_R) / (-S[4] * h);
        f = f2 < 0 ? 0 : f2 > 1 ? 1 : f2;
        rk4Into(px0, py0, pz0, vx0, vy0, vz0, w, swing, f * h);
      }
      px = S[0];
      py = BALL_R;
      pz = S[2];
      vb.x = S[3];
      vb.y = S[4];
      vb.z = S[5];
      const tb = tPrev + f * h;
      // Events on the pre-bounce part of the step are located on that part (no interpolation across the kink).
      if (planeOn && !o.planeHit && pz0 < inp.planeZ && pz >= inp.planeZ) {
        const g = (inp.planeZ - pz0) / (pz - pz0);
        o.planeHit = true;
        o.pT = tPrev + g * (tb - tPrev);
        o.pX = px0 + (px - px0) * g;
        o.pY = py0 + (py - py0) * g;
      }
      if (a && !o.alongHit) {
        const d0 = (px0 - a.ox) * a.ux + (pz0 - a.oz) * a.uz;
        const d1 = (px - a.ox) * a.ux + (pz - a.oz) * a.uz;
        if (d0 < a.d && d1 >= a.d) {
          const g = (a.d - d0) / (d1 - d0);
          o.alongHit = true;
          o.aT = tPrev + g * (tb - tPrev);
          o.aX = px0 + (px - px0) * g;
          o.aY = py0 + (py - py0) * g;
          o.aZ = pz0 + (pz - pz0) * g;
          const ex = vx0 + (vb.x - vx0) * g;
          const ey = vy0 + (vb.y - vy0) * g;
          const ez = vz0 + (vb.z - vz0) * g;
          o.aSpeed = Math.sqrt(ex * ex + ey * ey + ez * ez);
          o.aBeforeBounce = !o.bounced;
          if (inp.stopAtAlong) {
            o.eT = o.aT;
            o.eX = o.aX;
            o.eY = o.aY;
            o.eZ = o.aZ;
            o.eVx = ex;
            o.eVy = ey;
            o.eVz = ez;
            return o;
          }
        }
      }
      pb.x = px;
      pb.y = py;
      pb.z = pz;
      const preX = vb.x;
      const preZ = vb.z;
      const strip = onStrip(pb);
      if (strip) bounce(vb, w, inp.pitch, inp.pitch.turnGrip, pitchBounces === 0 ? inp.seamDev : 0);
      else bounce(vb, w, OUTFIELD, OUTFIELD_TURN_GRIP, 0);
      if (strip) pitchBounces += 1;
      swing = 0;
      if (!o.bounced) {
        o.bounced = true;
        o.bT = tb;
        o.bX = px;
        o.bZ = pz;
        o.bVxPre = preX;
        o.bVzPre = preZ;
        o.bVx = vb.x;
        o.bVy = vb.y;
        o.bVz = vb.z;
      }
      vx = vb.x;
      vy = vb.y;
      vz = vb.z;
      if (inp.stopAtFirstBounce) {
        o.eT = tb;
        o.eX = px;
        o.eY = py;
        o.eZ = pz;
        o.eVx = vx;
        o.eVy = vy;
        o.eVz = vz;
        return o;
      }
      const rem = (1 - f) * h;
      if (vy < OUTFIELD.rollVy) {
        rolledAt = tb;
        vy = 0;
      } else if (rem > 0) {
        rk4Into(px, py, pz, vx, vy, vz, w, 0, rem);
        px = S[0];
        py = S[1] < BALL_R ? BALL_R : S[1];
        pz = S[2];
        vx = S[3];
        vy = S[4];
        vz = S[5];
      }
    } else {
      px = S[0];
      py = S[1];
      pz = S[2];
      vx = S[3];
      vy = S[4];
      vz = S[5];
    }
    w.x *= decay;
    w.y *= decay;
    w.z *= decay;
    if (rolledAt >= 0) {
      // Events up to the bounce were checked last step; the roll from here is exact.
      if (inp.roll) rollOut(o, inp, rolledAt, px, pz, vx, vz);
      else {
        o.rolling = true;
        o.eT = rolledAt;
        o.eX = px;
        o.eY = BALL_R;
        o.eZ = pz;
        o.eVx = vx;
        o.eVz = vz;
      }
      return o;
    }
    if (planeOn && !o.planeHit && pz0 < inp.planeZ && pz >= inp.planeZ) {
      const g = (inp.planeZ - pz0) / (pz - pz0);
      o.planeHit = true;
      o.pT = tPrev + g * h;
      o.pX = px0 + (px - px0) * g;
      o.pY = py0 + (py - py0) * g;
    }
    if (a && !o.alongHit) {
      const d0 = (px0 - a.ox) * a.ux + (pz0 - a.oz) * a.uz;
      const d1 = (px - a.ox) * a.ux + (pz - a.oz) * a.uz;
      if (d0 < a.d && d1 >= a.d) {
        const g = (a.d - d0) / (d1 - d0);
        o.alongHit = true;
        o.aT = tPrev + g * h;
        o.aX = px0 + (px - px0) * g;
        o.aY = py0 + (py - py0) * g;
        o.aZ = pz0 + (pz - pz0) * g;
        const ex = vx0 + (vx - vx0) * g;
        const ey = vy0 + (vy - vy0) * g;
        const ez = vz0 + (vz - vz0) * g;
        o.aSpeed = Math.sqrt(ex * ex + ey * ey + ez * ez);
        o.aBeforeBounce = !o.bounced;
        if (inp.stopAtAlong) {
          o.eT = o.aT;
          o.eX = o.aX;
          o.eY = o.aY;
          o.eZ = o.aZ;
          o.eVx = ex;
          o.eVy = ey;
          o.eVz = ez;
          return o;
        }
      }
    }
    const r2 = px * px + pz * pz;
    if (inp.rope && !outside && r2 >= R2) {
      const dx = px - px0;
      const dz = pz - pz0;
      const qa = dx * dx + dz * dz;
      const qb = 2 * (px0 * dx + pz0 * dz);
      const qc = px0 * px0 + pz0 * pz0 - R2;
      const disc = qb * qb - 4 * qa * qc;
      const g0 = qa > 0 ? (-qb + Math.sqrt(disc > 0 ? disc : 0)) / (2 * qa) : 1;
      const g = g0 < 0 ? 0 : g0 > 1 ? 1 : g0;
      o.ropeHit = true;
      o.rT = tPrev + g * h;
      o.rX = px0 + dx * g;
      o.rY = py0 + (py - py0) * g;
      o.rZ = pz0 + dz * g;
      o.rOnFull = !o.bounced;
      const ex = vx0 + (vx - vx0) * g;
      const ey = vy0 + (vy - vy0) * g;
      const ez = vz0 + (vz - vz0) * g;
      o.rSpeed = Math.sqrt(ex * ex + ey * ey + ez * ez);
      o.eT = o.rT;
      o.eX = o.rX;
      o.eY = o.rY;
      o.eZ = o.rZ;
      o.eVx = ex;
      o.eVy = ey;
      o.eVz = ez;
      return o;
    }
    outside = r2 >= R2;
    if (pz >= inp.untilZ) break;
  }
  o.eT = inp.t0 + i * h;
  o.eX = px;
  o.eY = py;
  o.eZ = pz;
  o.eVx = vx;
  o.eVy = vy;
  o.eVz = vz;
  return o;
}


// ---------------------------------------------------------------------------------------------------------------
// Sampled traces (aimShot's output): the same model, RK4 at the output spacing, the roll sampled in closed form
// ---------------------------------------------------------------------------------------------------------------

export interface TraceIn {
  t0: number;
  p: Vec3;
  v: Vec3;
  spin: Vec3;
  pitch: PitchParams;
  /** Output (and step) spacing (s). At SIM_DT this is integrateBall in the air, bit for bit. */
  dt: number;
  untilT: number;
  stopAtBoundary: boolean;
  stopAtRest: boolean;
}

/**
 * A SimResult for a free ball (no swing, no seam deflection, no stumps detection): bounces, rope, rest, the stumps
 * plane, on the grid t0 + i·dt. Used where integrateBall's 1 ms stepping is not needed for the output.
 */
export function trace(inp: TraceIn): SimResult {
  const h = inp.dt;
  const decay = dexp(-h / SPIN_DECAY_S);
  const w = { x: inp.spin.x, y: inp.spin.y, z: inp.spin.z };
  const vb = { x: 0, y: 0, z: 0 };
  const pb = { x: 0, y: 0, z: 0 };
  let px = inp.p.x;
  let py = inp.p.y < BALL_R ? BALL_R : inp.p.y;
  let pz = inp.p.z;
  let vx = inp.v.x;
  let vy = inp.v.y;
  let vz = inp.v.z;
  let rolling = py <= BALL_R + 1e-9 && vy < OUTFIELD.rollVy && vy > -OUTFIELD.rollVy;
  if (rolling) vy = 0;
  const startedGrounded = rolling;
  const samples: SimResult['samples'] = [{ t: inp.t0, p: { x: px, y: py, z: pz }, v: { x: vx, y: vy, z: vz } }];
  const bounces: SimResult['bounces'] = [];
  let boundary: SimResult['boundary'] = null;
  let stopped: SimResult['stopped'] = null;
  let plane: SimResult['plane'] = null;
  const R2 = BOUNDARY_R * BOUNDARY_R;
  let outside = px * px + pz * pz >= R2;
  // Rolling state: start time, position, direction and speed; the distance and speed are closed-form in τ.
  let rT = 0;
  let rX = 0;
  let rZ = 0;
  let rDx = 0;
  let rDz = 0;
  let rS = 0;
  let rTauStop = 0;
  const startRoll = (t: number) => {
    rolling = true;
    rT = t;
    rX = px;
    rZ = pz;
    rS = Math.sqrt(vx * vx + vz * vz);
    rDx = rS > 0 ? vx / rS : 0;
    rDz = rS > 0 ? vz / rS : 0;
    rTauStop = rS < OUTFIELD.stopSpeed ? 0 : dlog((rS + RC) / (OUTFIELD.stopSpeed + RC)) / RK;
  };
  if (rolling) startRoll(inp.t0);
  let i = 0;
  let tEnd = inp.t0;
  for (;;) {
    const tPrev = inp.t0 + i * h;
    if (tPrev >= inp.untilT - 1e-12) break;
    i += 1;
    const tNow = inp.t0 + i * h;
    const px0 = px;
    const py0 = py;
    const pz0 = pz;
    const vx0 = vx;
    const vy0 = vy;
    const vz0 = vz;
    let rest = false;
    if (rolling) {
      const tau = tNow - rT;
      if (tau >= rTauStop) {
        const d = rollD(rS, rTauStop);
        px = rX + rDx * d;
        pz = rZ + rDz * d;
        vx = 0;
        vz = 0;
        rest = true;
      } else {
        const d = rollD(rS, tau);
        const s = rollV(rS, tau);
        px = rX + rDx * d;
        pz = rZ + rDz * d;
        vx = rDx * s;
        vz = rDz * s;
      }
      py = BALL_R;
      vy = 0;
    } else {
      rk4Into(px, py, pz, vx, vy, vz, w, 0, h);
      if (S[1] < BALL_R && (vy0 < 0 || S[4] < 0)) {
        let f = py0 - S[1] > 1e-12 ? (py0 - BALL_R) / (py0 - S[1]) : 1;
        f = f < 0 ? 0 : f > 1 ? 1 : f;
        rk4Into(px0, py0, pz0, vx0, vy0, vz0, w, 0, f * h);
        if (S[4] < 0) {
          const f2 = f + (S[1] - BALL_R) / (-S[4] * h);
          f = f2 < 0 ? 0 : f2 > 1 ? 1 : f2;
          rk4Into(px0, py0, pz0, vx0, vy0, vz0, w, 0, f * h);
        }
        px = S[0];
        py = BALL_R;
        pz = S[2];
        vb.x = S[3];
        vb.y = S[4];
        vb.z = S[5];
        pb.x = px;
        pb.y = py;
        pb.z = pz;
        const strip = onStrip(pb);
        if (strip) bounce(vb, w, inp.pitch, inp.pitch.turnGrip, 0);
        else bounce(vb, w, OUTFIELD, OUTFIELD_TURN_GRIP, 0);
        vx = vb.x;
        vy = vb.y;
        vz = vb.z;
        const tb = tPrev + f * h;
        bounces.push({ t: tb, p: { x: px, y: py, z: pz }, v: { x: vx, y: vy, z: vz }, surface: strip ? 'pitch' : 'outfield' });
        const rem = (1 - f) * h;
        if (vy < OUTFIELD.rollVy) {
          vy = 0;
          startRoll(tb);
          const tau = tNow - rT;
          const d = rollD(rS, Math.min(tau, rTauStop));
          px = rX + rDx * d;
          pz = rZ + rDz * d;
          const s = tau >= rTauStop ? 0 : rollV(rS, tau);
          vx = rDx * s;
          vz = rDz * s;
          if (tau >= rTauStop) rest = true;
        } else if (rem > 0) {
          rk4Into(px, py, pz, vx, vy, vz, w, 0, rem);
          px = S[0];
          py = S[1] < BALL_R ? BALL_R : S[1];
          pz = S[2];
          vx = S[3];
          vy = S[4];
          vz = S[5];
        }
      } else {
        px = S[0];
        py = S[1];
        pz = S[2];
        vx = S[3];
        vy = S[4];
        vz = S[5];
      }
    }
    w.x *= decay;
    w.y *= decay;
    w.z *= decay;
    tEnd = tNow;
    let done = false;
    if (!plane && pz0 < PLANE_Z && pz >= PLANE_Z) {
      const g = (PLANE_Z - pz0) / (pz - pz0);
      plane = { t: tPrev + g * h, p: { x: px0 + (px - px0) * g, y: py0 + (py - py0) * g, z: PLANE_Z }, v: { x: vx0 + (vx - vx0) * g, y: vy0 + (vy - vy0) * g, z: vz0 + (vz - vz0) * g } };
    }
    const r2 = px * px + pz * pz;
    if (!boundary && !outside && r2 >= R2) {
      const dx = px - px0;
      const dz = pz - pz0;
      const qa = dx * dx + dz * dz;
      const qb = 2 * (px0 * dx + pz0 * dz);
      const qc = px0 * px0 + pz0 * pz0 - R2;
      const disc = qb * qb - 4 * qa * qc;
      const g0 = qa > 0 ? (-qb + Math.sqrt(disc > 0 ? disc : 0)) / (2 * qa) : 1;
      const g = g0 < 0 ? 0 : g0 > 1 ? 1 : g0;
      const tb = tPrev + g * h;
      boundary = { t: tb, p: { x: px0 + dx * g, y: py0 + (py - py0) * g, z: pz0 + dz * g }, onFull: !startedGrounded && !bounces.some((b) => b.t <= tb) };
      if (inp.stopAtBoundary) done = true;
    }
    outside = r2 >= R2;
    if (rest) {
      stopped = { t: tNow, p: { x: px, y: py, z: pz } };
      if (inp.stopAtRest) done = true;
    }
    samples.push({ t: tNow, p: { x: px, y: py, z: pz }, v: { x: vx, y: vy, z: vz } });
    if (done) break;
  }
  return {
    dt: h,
    samples,
    bounces,
    boundary,
    stopped,
    plane,
    stumps: null,
    end: { t: tEnd, p: { x: px, y: py, z: pz }, v: { x: vx, y: vy, z: vz }, spin: { x: w.x, y: w.y, z: w.z } },
    rolling,
  };
}
