/**
 * Multiplayer match deliveries through the one physics engine. The server (frozen engine v1) decides a BallPath and
 * the flight time it validates taps against; flightFromPath() finds the physical release that reproduces it:
 *
 *   hard  arrival at the contact plane (CONTACT_Z) at releaseToContactMs, pitching at −PITCH_HALF + bounceAtM, the
 *         line at the bat lineAtBatM, released at releaseHeightM from the match's right-arm-over spot;
 *   soft  the height at the bat (heightAtBatM), the movement in the air (swingM) and off the pitch (turnM), and the
 *         speed (the release speed is solved, so it can differ a little from path.speedKph; the fit reports it).
 *
 * Unknowns: release speed, elevation, azimuth and, only here, the pitch's restitution for that ball (bounded to
 * MATCH_RESTITUTION): the server's heightAtBatM is authoritative in multiplayer, so the bounce is fitted to it rather
 * than predicted. Swing is the air side force (also the spinner's drift); turn is a bounce deflection (pace seam or
 * spin turn; the surface's turn grip is off so spin cannot add to it); the spin vector (rifle and over-spin from
 * spinRpm, back-spin for pace) is the real spin the integrator flies and the renderer draws. Pure and deterministic.
 */
import type { BallPath, DeliveryFamily, PitchId } from '@/contracts';
import type { BallFlight, Handedness, PitchCondition, PracticeDeliveryPlan } from '@/contracts/practice';
import { PRACTICE_SIM_VERSION } from '@/contracts/practice';
import { integrateBall, type SimResult } from './ball';
import {
  AIR_DENSITY,
  BALL_AREA,
  BALL_MASS,
  BALL_R,
  CONTACT_Z,
  G,
  MATCH_RELEASE,
  MATCH_RESTITUTION,
  PITCHES,
  PITCH_HALF,
  type PitchParams,
} from './constants';
import { hitsStumpsAt, spinVector, timeAtZ } from './delivery';
import { probe } from './probe';

/** Probe step for the fit's iterations (s): RK4 at 8 ms is within ≈ 0.2 mm and 1 µs of the delivered 1 ms flight. */
const FIT_PROBE_DT = 0.008;
import { RAD, clamp, dasin, datan2, dcos, dsin, len, v3, type Vec3 } from './vec';

/** Engine pitch → Practice conditions (every engine pitch has an equivalent). */
export const CONDITIONS_FOR_PITCH: Record<PitchId, PitchCondition> = { green: 'green', hard: 'hard', slow: 'turning' };

export interface PathFit {
  /** Solved release speed (the real simulated one). */
  speedKph: number;
  /** Achieved values at the contact plane and of the movement. */
  heightAtBatM: number;
  swingM: number;
  turnM: number;
  /** Fitted restitution for this ball's bounce. */
  restitution: number;
  /** Residuals of the hard targets. */
  timeErrorMs: number;
  bounceErrorM: number;
  lineErrorM: number;
  converged: boolean;
}

export interface FromPathOptions {
  family: DeliveryFamily;
  releaseToContactMs: number;
  /** The striker's handedness: a right-arm-over bowler releases on a left-hander's leg side (default right). */
  handedness?: Handedness;
  seed?: string;
  /** Conditions for friction and seam/spin defaults (default balanced; use CONDITIONS_FOR_PITCH for engine pitches). */
  conditions?: PitchCondition;
}

interface Knobs {
  speed: number;
  theta: number;
  phi: number;
  e: number;
}

interface Model {
  p0: Vec3;
  spinParts: { rifle: number; side: number; top: number };
  swingCs: number;
  seamDev: number;
  base: PitchParams;
  zb: number;
}

const KA = (0.5 * AIR_DENSITY * BALL_AREA) / BALL_MASS;

function launch(k: Knobs): Vec3 {
  const c = dcos(k.theta);
  return v3(k.speed * c * dsin(k.phi), k.speed * dsin(k.theta), k.speed * c * dcos(k.phi));
}

/** The residual's measurements from an allocation-free 4 ms probe (iterations only; the output is a 1 ms run). */
function probeMeasure(m: Model, k: Knobs, untilZ: number): Measure {
  const v = launch(k);
  const o = probe({
    t0: 0,
    p: m.p0,
    v,
    spin: spinVector(m.spinParts, v),
    swingCs: m.swingCs,
    seamDev: m.seamDev,
    pitch: { ...m.base, restitution: k.e, turnGrip: 0 },
    dt: FIT_PROBE_DT,
    untilT: 3,
    untilZ,
    planeZ: CONTACT_Z,
    stopAtFirstBounce: false,
    along: null,
    roll: false,
    rope: false,
  });
  let zb: number;
  if (o.bounced) zb = o.bZ;
  else {
    const hh = Math.max(0, o.eY - BALL_R);
    const tf = (o.eVy + Math.sqrt(o.eVy * o.eVy + 2 * G * hh)) / G;
    zb = o.eZ + o.eVz * tf;
  }
  const tc = o.planeHit ? o.pT : o.eT;
  const xc = o.planeHit ? o.pX : o.eX;
  const yc = o.planeHit ? o.pY : o.eY;
  const air = o.bounced ? o.bX - (m.p0.x + (v.x / v.z) * (o.bZ - m.p0.z)) : 0;
  const turn = o.bounced && o.bZ < CONTACT_Z && o.planeHit ? xc - (o.bX + (o.bVxPre / o.bVzPre) * (CONTACT_Z - o.bZ)) : 0;
  return { zb, tc, xc, yc, air, turn };
}

interface Measure {
  zb: number;
  tc: number;
  xc: number;
  yc: number;
  air: number;
  turn: number;
}

function measure(sim: SimResult): Measure {
  const s = sim.samples;
  const b = sim.bounces[0];
  const tc = timeAtZ(s, CONTACT_Z) ?? s[s.length - 1].t;
  let i = 1;
  while (i < s.length - 1 && s[i].t < tc) i++;
  const a = s[i - 1];
  const c = s[i];
  const g = c.t > a.t ? (tc - a.t) / (c.t - a.t) : 0;
  const xc = a.p.x + (c.p.x - a.p.x) * g;
  const yc = a.p.y + (c.p.y - a.p.y) * g;
  const s0 = s[0];
  // No bounce yet (aimed long): continue to the ground ballistically so the residual stays smooth.
  let zb: number;
  if (b) zb = b.p.z;
  else {
    const e = s[s.length - 1];
    const h = Math.max(0, e.p.y - BALL_R);
    const tf = (e.v.y + Math.sqrt(e.v.y * e.v.y + 2 * G * h)) / G;
    zb = e.p.z + e.v.z * tf;
  }
  const air = b ? b.p.x - (s0.p.x + (s0.v.x / s0.v.z) * (b.p.z - s0.p.z)) : 0;
  let turn = 0;
  if (b && b.p.z < CONTACT_Z) {
    // The direction just before the bounce: the last sample before it (within one step).
    let j = 1;
    while (j < s.length - 1 && s[j].t < b.t) j++;
    const pre = s[j - 1];
    turn = xc - (b.p.x + (pre.v.x / pre.v.z) * (CONTACT_Z - b.p.z));
  }
  return { zb, tc, xc, yc, air, turn };
}

function solve4(A: number[][], b: number[], active: boolean[]): number[] | null {
  const idx = active.map((on, i) => (on ? i : -1)).filter((i) => i >= 0);
  const n = idx.length;
  const M = idx.map((r) => [...idx.map((c) => A[r][c]), -b[r]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-14) return null;
    const tmp = M[col];
    M[col] = M[piv];
    M[piv] = tmp;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  const x = [0, 0, 0, 0];
  for (let r = 0; r < n; r++) x[idx[r]] = M[r][n] / M[r][r];
  return x;
}

interface Targets {
  zb: number;
  tc: number;
  line: number;
  h: number;
}

function residual(me: Measure, tg: Targets, speed: number, useHeight: boolean): number[] {
  return [me.zb - tg.zb, (me.tc - tg.tc) * speed, me.xc - tg.line, useHeight ? (me.yc - tg.h) * 0.5 : 0];
}

const norm2 = (r: number[]) => r[0] * r[0] + r[1] * r[1] + r[2] * r[2] + r[3] * r[3];

function jacobian(m: Model, k: Knobs, tg: Targets, untilZ: number, useHeight: boolean, F: number[]): number[][] {
  const steps: Array<[keyof Knobs, number]> = [
    ['speed', 0.01],
    ['theta', 1e-4],
    ['phi', 1e-4],
    ['e', 1e-3],
  ];
  const J = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  steps.forEach(([key, h], col) => {
    if (key === 'e' && !useHeight) return;
    const kk = { ...k, [key]: k[key] + h };
    const r = residual(probeMeasure(m, kk, untilZ), tg, k.speed, useHeight);
    for (let row = 0; row < 4; row++) J[row][col] = (r[row] - F[row]) / h;
  });
  return J;
}

/**
 * Newton fit of the release (speed, elevation, azimuth, and restitution when the ball pitches before the bat). If
 * the server's height needs a restitution outside MATCH_RESTITUTION, it is held at the bound and the hard targets are
 * fitted alone (the height is then the nearest the pitch allows).
 */
function fit(m: Model, start: Knobs, tg: Targets, J0: number[][] | null = null): { k: Knobs; me: Measure; useHeight: boolean; J: number[][] } {
  const untilZ = Math.max(CONTACT_Z, m.zb) + 0.5;
  let useHeight = m.zb < CONTACT_Z - 0.15;
  let k = { ...start };
  let me = probeMeasure(m, k, untilZ);
  let F = residual(me, tg, k.speed, useHeight);
  let J = J0 ?? jacobian(m, k, tg, untilZ, useHeight, F);
  const done = () =>
    Math.abs(me.zb - tg.zb) < 2e-4 && Math.abs(me.tc - tg.tc) < 5e-6 && Math.abs(me.xc - tg.line) < 2e-4 && (!useHeight || Math.abs(me.yc - tg.h) < 2e-3);
  for (let it = 0; it < 40 && !done(); it++) {
    const dx = solve4(J, F, [true, true, true, useHeight]);
    if (!dx) break;
    if (useHeight) {
      const e = k.e + dx[3];
      if (e < MATCH_RESTITUTION[0] || e > MATCH_RESTITUTION[1]) {
        k = { ...k, e: e < MATCH_RESTITUTION[0] ? MATCH_RESTITUTION[0] : MATCH_RESTITUTION[1] };
        useHeight = false;
        me = probeMeasure(m, k, untilZ);
        F = residual(me, tg, k.speed, useHeight);
        J = jacobian(m, k, tg, untilZ, useHeight, F);
        continue;
      }
    }
    const step = [clamp(dx[0], -3, 3), clamp(dx[1], -0.05, 0.05), clamp(dx[2], -0.05, 0.05), useHeight ? clamp(dx[3], -0.08, 0.08) : 0];
    let accepted = false;
    let lambda = 1;
    for (let ls = 0; ls < 8; ls++) {
      const k2: Knobs = {
        speed: k.speed + lambda * step[0],
        theta: k.theta + lambda * step[1],
        phi: k.phi + lambda * step[2],
        e: clamp(k.e + lambda * step[3], MATCH_RESTITUTION[0], MATCH_RESTITUTION[1]),
      };
      const me2 = probeMeasure(m, k2, untilZ);
      const F2 = residual(me2, tg, k2.speed, useHeight);
      if (norm2(F2) < norm2(F)) {
        k = k2;
        me = me2;
        F = F2;
        accepted = true;
        break;
      }
      lambda /= 2;
    }
    if (!accepted) {
      J = jacobian(m, k, tg, untilZ, useHeight, F);
      const retry = solve4(J, F, [true, true, true, useHeight]);
      if (!retry) break;
      const k3: Knobs = { speed: k.speed + clamp(retry[0], -3, 3), theta: k.theta + clamp(retry[1], -0.05, 0.05), phi: k.phi + clamp(retry[2], -0.05, 0.05), e: k.e };
      const me3 = probeMeasure(m, k3, untilZ);
      const F3 = residual(me3, tg, k3.speed, useHeight);
      if (norm2(F3) >= norm2(F)) break;
      k = k3;
      me = me3;
      F = F3;
    }
  }
  return { k, me, useHeight, J };
}

function variationFor(path: BallPath, family: DeliveryFamily): PracticeDeliveryPlan['variation'] {
  if (family === 'spin') return 'stock';
  if (family === 'swing') return path.swingM >= 0 ? 'outswing' : 'inswing';
  if (path.bounceAtM <= 10.2) return 'bouncer';
  if (path.bounceAtM >= 18) return 'yorker';
  return path.seamUpright ? 'stock' : 'slower';
}

/**
 * The BallFlight (1 ms samples, release to just past the stumps, in the striker's frame) that reproduces a server
 * BallPath, plus how closely it does. `plan` is descriptive (variation, length and line achieved, solved speed).
 */
export function flightFromPath(path: BallPath, opts: FromPathOptions): BallFlight & { fit: PathFit } {
  const family = opts.family;
  const spin = family === 'spin';
  const side = (opts.handedness ?? 'right') === 'left' ? -1 : 1;
  const base = PITCHES[opts.conditions ?? 'balanced'];
  const p0 = v3(side * (spin ? MATCH_RELEASE.spinX : MATCH_RELEASE.paceX), clamp(path.releaseHeightM || 2.1, MATCH_RELEASE.heightMin, MATCH_RELEASE.heightMax), MATCH_RELEASE.z);
  const zb = -PITCH_HALF + path.bounceAtM;
  const tc = Math.max(0.25, opts.releaseToContactMs / 1000);
  const tg: Targets = { zb, tc, line: path.lineAtBatM, h: clamp(path.heightAtBatM, BALL_R, 2.4) };
  const w = (2 * Math.PI * Math.max(300, path.spinRpm)) / 60;
  const turnDir = path.turnM > 0 ? 1 : path.turnM < 0 ? -1 : 0;
  const spinParts = spin
    ? { rifle: -turnDir * 0.75 * w, side: 0, top: 0.66 * w }
    : path.seamUpright
      ? { rifle: 0, side: 0, top: -w }
      : { rifle: 0.55 * w, side: 0, top: 0.83 * w };
  // Initial guesses from flat-earth kinematics.
  const D1 = zb - p0.z;
  const D2 = CONTACT_Z - zb;
  const speed0 = D2 > 0 ? (D1 / 0.96 + D2 / (0.96 * 0.88)) / tc : (CONTACT_Z - p0.z) / (0.96 * tc);
  const T1 = Math.max(0.05, D1 / (0.96 * speed0));
  const vy0 = (BALL_R - p0.y + 0.5 * G * T1 * T1) / T1;
  const post = D2 > 0.05 ? D2 : 0;
  const model: Model = {
    p0,
    spinParts,
    swingCs: path.swingM / Math.max(0.05, 0.5 * KA * speed0 * speed0 * T1 * T1),
    seamDev: post > 0 ? path.turnM / post : 0,
    base,
    zb,
  };
  let k: Knobs = {
    speed: speed0,
    theta: dasin(clamp(vy0 / speed0, -0.9, 0.9)),
    phi: datan2(path.lineAtBatM - p0.x, CONTACT_Z - p0.z),
    e: clamp(base.restitution, MATCH_RESTITUTION[0], MATCH_RESTITUTION[1]),
  };
  let res = fit(model, k, tg);
  // Soft movement targets: rescale swing and seam deflection, then refit (two passes at most).
  for (let pass = 0; pass < 2; pass++) {
    const airErr = path.swingM - res.me.air;
    const turnErr = post > 0 ? path.turnM - res.me.turn : 0;
    if (Math.abs(airErr) < 0.004 && Math.abs(turnErr) < 0.004) break;
    model.swingCs += airErr / Math.max(0.05, 0.5 * KA * res.k.speed * res.k.speed * T1 * T1);
    if (post > 0) model.seamDev += turnErr / post;
    k = res.k;
    res = fit(model, k, tg, res.useHeight ? res.J : null);
  }
  k = res.k;
  const pitch: PitchParams = { ...base, restitution: k.e, turnGrip: 0 };
  const v0 = launch(k);
  const spin0 = spinVector(spinParts, v0);
  const sim = integrateBall(
    { t: 0, p: p0, v: v0, spin: spin0 },
    { swingCs: model.swingCs, seamDev: model.seamDev, pitch, untilZ: Math.max(PITCH_HALF + 0.3, zb + 0.3), untilT: 3, stopAtBoundary: false, stopAtRest: false },
  );
  const first = sim.bounces[0];
  const bounce = first && first.p.z <= PITCH_HALF ? { t: first.t, p: first.p } : null;
  let afterBounce: Vec3 | null = null;
  if (bounce) {
    const probe = integrateBall(
      { t: 0, p: p0, v: v0, spin: spin0 },
      { swingCs: model.swingCs, seamDev: model.seamDev, pitch, untilT: bounce.t + 0.002, stopAtBoundary: false, stopAtRest: false },
    );
    afterBounce = probe.end.spin;
  }
  const samples = sim.samples.filter((s) => s.p.z <= PITCH_HALF + 0.3 || s.t <= (bounce?.t ?? 0));
  const plane = sim.plane ?? { t: sim.end.t, p: sim.end.p, v: sim.end.v };
  const idealContactT = timeAtZ(samples, CONTACT_Z) ?? tc;
  const speed = len(v0);
  // Report what the delivered (1 ms) flight achieves, not the last probe.
  const me = measure(sim);
  return {
    version: PRACTICE_SIM_VERSION,
    plan: { variation: variationFor(path, family), lengthM: PITCH_HALF - zb, lineM: plane.p.x, speedKph: speed * 3.6 },
    seed: opts.seed ?? '',
    release: {
      p: p0,
      v: v0,
      spinRps: w / (2 * Math.PI),
      seamDeg: spin ? datan2(spinParts.top, spinParts.rifle) * RAD : path.seamUpright ? (family === 'swing' ? (path.swingM >= 0 ? 18 : -18) : 0) : 40,
      speedKph: speed * 3.6,
    },
    bounce,
    idealContactT,
    stumpsT: plane.t,
    wouldHitStumps: hitsStumpsAt(plane.p.x, plane.p.y),
    samples,
    spin: { release: spin0, afterBounce },
    fit: {
      speedKph: speed * 3.6,
      heightAtBatM: me.yc,
      swingM: me.air,
      turnM: me.turn,
      restitution: k.e,
      timeErrorMs: (idealContactT - tc) * 1000,
      bounceErrorM: me.zb - zb,
      lineErrorM: me.xc - path.lineAtBatM,
      converged: Math.abs(idealContactT - tc) < 5e-4 && Math.abs(me.zb - zb) < 0.02 && Math.abs(me.xc - path.lineAtBatM) < 0.02,
    },
  };
}
