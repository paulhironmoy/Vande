/**
 * aimShot(): outcome-first post-contact flights for the multiplayer match. The server has already decided where the
 * ball goes; this finds the launch velocity whose simulate() trajectory (the one ball integrator: drag, Magnus,
 * bounces, roll, rope) gets it there, so the reveal shows real physics timed by its own tArrive.
 *
 * Reaching a point leaves one free parameter, so the launch elevation chooses the trajectory (opts.elevationDeg, or a
 * mode default) and the solver finds speed (bracketed secant, Illinois) and azimuth (corrected for any sideways
 * drift). Modes:
 *   carry             through target.p in the air (a catch at hand height); tArrive when it gets there
 *   ground            along the ground to rest at target.p, or passing it at arriveSpeedKph (a pickup)
 *   bounce_then_rope  lands first, then crosses the rope in target.p's direction (a four)
 *   over_rope         crosses the rope on the full at target.p (target.p.y = the height over the rope; a six)
 * Fails soft: when no speed up to maxSpeedKph (or no elevation tried) works, the nearest trajectory is returned with
 * feasible = false and errorM = how far it misses. Pure and deterministic.
 */
import { type SimResult, backspinVector } from './ball';
import { probe, trace } from './probe';
import { BALL_R, BOUNDARY_R, G, MAX_SIM_S, OUTFIELD, POST_CONTACT_SAMPLE_EVERY, PITCHES, SIM_DT, type PitchParams } from './constants';
import { DEG, clamp, datan2, dcos, dlog, dsin, v3, type Vec3 } from './vec';

export type AimMode = 'carry' | 'ground' | 'bounce_then_rope' | 'over_rope';

export interface AimTarget {
  p: Vec3;
  mode: AimMode;
}

export interface AimOptions {
  /** Spin vector (rad/s). Default: 15 rev/s back-spin for carry and over_rope, none for ground strokes. */
  spin?: Vec3;
  /** Pitch-strip surface for bounces on the pitch (default balanced). */
  pitch?: PitchParams;
  /** Fastest launch allowed (default 165 km/h). */
  maxSpeedKph?: number;
  /** Launch elevation (deg). Default: carry 8° + 0.5°/m (8–50°), over_rope 32°, bounce_then_rope 5°, ground −4°. */
  elevationDeg?: number;
  /** ground: pass target.p at this speed instead of stopping there; bounce_then_rope: speed at the rope (default 30). */
  arriveSpeedKph?: number;
  /** Output spacing of the returned simulation (steps; default POST_CONTACT_SAMPLE_EVERY). */
  sampleEvery?: number;
}

export interface AimResult {
  v: Vec3;
  spin: Vec3;
  /** The full trajectory from `from` (to rest or the rope), on the fixed grid. */
  sim: SimResult;
  /** When and where the ball meets the target (catch, pickup, rest, or the rope crossing). */
  tArrive: number;
  arrive: Vec3;
  feasible: boolean;
  /** Distance between `arrive` and target.p (m). */
  errorM: number;
}

const BACKSPIN_RPS = 15;

interface Probe {
  /** Signed objective: 0 at the target; increases with launch speed. */
  g: number;
  t: number;
  p: Vec3;
  ok: boolean;
}

function horiz(a: Vec3, b: Vec3): { d: number; ux: number; uz: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  return { d, ux: d > 1e-9 ? dx / d : 0, uz: d > 1e-9 ? dz / d : -1 };
}

/** First time the ball's distance along (ux, uz) from `o` reaches d, interpolated; before `beforeT` if given. */
function crossing(sim: SimResult, o: Vec3, ux: number, uz: number, d: number, beforeT = Infinity): { t: number; p: Vec3 } | null {
  const s = sim.samples;
  for (let i = 1; i < s.length; i++) {
    if (s[i].t > beforeT) return null;
    const a = (s[i - 1].p.x - o.x) * ux + (s[i - 1].p.z - o.z) * uz;
    const b = (s[i].p.x - o.x) * ux + (s[i].p.z - o.z) * uz;
    if (a < d && b >= d) {
      const g = (d - a) / (b - a);
      const p0 = s[i - 1].p;
      const p1 = s[i].p;
      return { t: s[i - 1].t + g * (s[i].t - s[i - 1].t), p: v3(p0.x + (p1.x - p0.x) * g, p0.y + (p1.y - p0.y) * g, p0.z + (p1.z - p0.z) * g) };
    }
  }
  return null;
}

function along(o: Vec3, p: Vec3, ux: number, uz: number): number {
  return (p.x - o.x) * ux + (p.z - o.z) * uz;
}

export function defaultElevationDeg(mode: AimMode, distanceM: number): number {
  switch (mode) {
    case 'carry':
      return clamp(8 + 0.5 * distanceM, 8, 50);
    case 'over_rope':
      return 32;
    case 'bounce_then_rope':
      return 5;
    case 'ground':
      return -4;
  }
}

/** Distance from o along (ux, uz) to the rope (circle of BOUNDARY_R about the pitch centre). */
function ropeDistance(o: Vec3, ux: number, uz: number): number {
  const b = o.x * ux + o.z * uz;
  const c = o.x * o.x + o.z * o.z - BOUNDARY_R * BOUNDARY_R;
  return -b + Math.sqrt(Math.max(0, b * b - c));
}

function candidates(mode: AimMode, d: number, given: number | undefined, dy = 0): number[] {
  if (given !== undefined) return [given];
  const e = defaultElevationDeg(mode, d);
  switch (mode) {
    case 'carry': {
      // Last resort: well above the line of sight to the target (a close, high catch).
      const sight = (datan2(dy, Math.max(0.1, d)) * 180) / Math.PI;
      return [e, Math.min(55, e + 8), Math.max(3, e - 6), Math.min(70, Math.max(e + 12, sight + 15))];
    }
    case 'over_rope':
      return [e, 38, 44, 26];
    case 'bounce_then_rope':
      return [e, 1, -3];
    case 'ground':
      return [e, -8, 0];
  }
}

/** Probe step for aimShot's iterations (s): RK4 at 8 ms is within ≈ 0.2 mm of the output trace over a hit. */
const AIM_PROBE_DT = 0.008;

export function aimShot(from: { t: number; p: Vec3 }, target: AimTarget, opts: AimOptions = {}): AimResult {
  const o = from.p;
  const mode = target.mode;
  const pitch = opts.pitch ?? PITCHES.balanced;
  const vmax = (opts.maxSpeedKph ?? 165) / 3.6;
  const every = opts.sampleEvery ?? POST_CONTACT_SAMPLE_EVERY;
  const h0 = horiz(o, target.p);
  const arriveV = opts.arriveSpeedKph !== undefined ? opts.arriveSpeedKph / 3.6 : mode === 'bounce_then_rope' ? 30 / 3.6 : null;
  const spinFor = (v: Vec3): Vec3 =>
    opts.spin ?? (mode === 'carry' || mode === 'over_rope' ? backspinVector(v, BACKSPIN_RPS) : v3(0, 0, 0));
  const launch = (speed: number, elevDeg: number, az: number): Vec3 => {
    const e = elevDeg * DEG;
    const c = dcos(e);
    return v3(speed * c * dsin(az), speed * dsin(e), speed * c * dcos(az));
  };
  const maxT = from.t + MAX_SIM_S;
  const stopAtRope = mode === 'bounce_then_rope' || mode === 'ground';

  /** The objective from an allocation-free probe (iterations). */
  const probeEval = (speed: number, elevDeg: number, az: number, ux: number, uz: number): Probe => {
    const v = launch(speed, elevDeg, az);
    const horizSpeed = Math.max(0.5, speed * dcos(elevDeg * DEG));
    const reachBy = Math.min(maxT, from.t + (2 * h0.d) / horizSpeed + 0.5);
    const along = { ox: o.x, oz: o.z, ux, uz, d: h0.d };
    const base = { t0: from.t, p: o, v, spin: spinFor(v), swingCs: 0, seamDev: 0, pitch, dt: AIM_PROBE_DT, untilZ: Infinity, planeZ: NaN };
    const at = (x: number, z: number) => (x - o.x) * ux + (z - o.z) * uz;
    if (mode === 'carry' || mode === 'over_rope') {
      // About fifty RK4 steps to the target, whatever the flight time (4–20 ms).
      const dt = clamp((reachBy - from.t) / 100, AIM_PROBE_DT / 2, 0.02);
      const r = probe({ ...base, dt, untilT: reachBy, stopAtFirstBounce: true, along, stopAtAlong: true, roll: false, rope: false });
      if (r.alongHit && r.aBeforeBounce) return { g: r.aY - target.p.y, t: r.aT, p: v3(r.aX, r.aY, r.aZ), ok: true };
      const reach = r.bounced ? at(r.bX, r.bZ) : at(r.eX, r.eZ);
      return { g: -(h0.d - reach) * 0.5 - Math.max(0, target.p.y), t: r.eT, p: v3(r.eX, r.eY, r.eZ), ok: false };
    }
    if (mode === 'ground' && arriveV === null) {
      const r = probe({ ...base, untilT: maxT, stopAtFirstBounce: false, along: null, roll: true, rope: true });
      const ex = r.rest ? r.sX : r.ropeHit ? r.rX : r.eX;
      const ez = r.rest ? r.sZ : r.ropeHit ? r.rZ : r.eZ;
      return { g: at(ex, ez) - h0.d, t: r.rest ? r.sT : r.eT, p: v3(ex, BALL_R, ez), ok: !r.ropeHit };
    }
    if (mode === 'ground') {
      const r = probe({ ...base, untilT: reachBy, stopAtFirstBounce: false, along, roll: true, rope: true });
      if (r.alongHit) return { g: r.aSpeed - (arriveV ?? 0), t: r.aT, p: v3(r.aX, r.aY, r.aZ), ok: true };
      return { g: -(h0.d - at(r.eX, r.eZ)) * 0.2 - (arriveV ?? 0), t: r.eT, p: v3(r.eX, r.eY, r.eZ), ok: false };
    }
    const r = probe({ ...base, untilT: maxT, stopAtFirstBounce: false, along: null, roll: true, rope: true });
    if (r.ropeHit) return { g: r.rSpeed - (arriveV ?? 0), t: r.rT, p: v3(r.rX, r.rY, r.rZ), ok: !r.rOnFull };
    return { g: -(ropeDistance(o, ux, uz) - at(r.eX, r.eZ)) * 0.2 - (arriveV ?? 0), t: r.eT, p: v3(r.eX, r.eY, r.eZ), ok: false };
  };

  type Eval = Probe & { sim: SimResult; v: Vec3 };
  /** The output trajectory (the same model on the output grid) and the arrival read from it. */
  const finalEval = (speed: number, elevDeg: number, az: number, ux: number, uz: number): Eval => {
    const v = launch(speed, elevDeg, az);
    const sim = trace({ t0: from.t, p: o, v, spin: spinFor(v), pitch, dt: every * SIM_DT, untilT: maxT, stopAtBoundary: stopAtRope, stopAtRest: true });
    const firstBounce = sim.bounces.length ? sim.bounces[0].t : Infinity;
    if (mode === 'carry' || mode === 'over_rope') {
      const c = crossing(sim, o, ux, uz, h0.d, firstBounce);
      if (c) return { g: c.p.y - target.p.y, t: c.t, p: c.p, ok: true, sim, v };
      const reach = sim.bounces.length ? along(o, sim.bounces[0].p, ux, uz) : along(o, sim.end.p, ux, uz);
      return { g: -(h0.d - reach) * 0.5 - Math.max(0, target.p.y), t: sim.end.t, p: sim.end.p, ok: false, sim, v };
    }
    if (mode === 'ground') {
      if (arriveV === null) {
        const endP = sim.stopped ? sim.stopped.p : sim.end.p;
        return { g: along(o, endP, ux, uz) - h0.d, t: sim.stopped ? sim.stopped.t : sim.end.t, p: endP, ok: !sim.boundary, sim, v };
      }
      const c = crossing(sim, o, ux, uz, h0.d);
      if (c) return { g: sampleVel(sim, c.t) - arriveV, t: c.t, p: c.p, ok: true, sim, v };
      return { g: -(h0.d - along(o, sim.end.p, ux, uz)) * 0.2 - arriveV, t: sim.end.t, p: sim.end.p, ok: false, sim, v };
    }
    if (sim.boundary) {
      return { g: sampleVel(sim, sim.boundary.t) - (arriveV ?? 0), t: sim.boundary.t, p: sim.boundary.p, ok: !sim.boundary.onFull, sim, v };
    }
    return { g: -(ropeDistance(o, ux, uz) - along(o, sim.end.p, ux, uz)) * 0.2 - (arriveV ?? 0), t: sim.end.t, p: sim.end.p, ok: false, sim, v };
  };

  const tol = mode === 'carry' || mode === 'over_rope' ? 0.002 : 0.05;
  let best: { r: Eval; err: number } | null = null;
  for (const elev of candidates(mode, h0.d, opts.elevationDeg, target.p.y - o.y)) {
    const ux = h0.ux;
    const uz = h0.uz;
    let az = datan2(ux, uz);
    let speed = 0;
    let found: Probe | null = null;
    const est = speedEstimate(mode, h0.d, target.p.y - o.y, elev, arriveV, ropeDistance(o, ux, uz));
    for (let pass = 0; pass < 3; pass++) {
      const solved = solveSpeed((sp) => probeEval(sp, elev, az, ux, uz), 1, vmax, tol, est);
      found = solved.r;
      speed = solved.speed;
      // Correct the azimuth for sideways drift (side-spin), then solve again.
      const dx = found.p.x - o.x;
      const dz = found.p.z - o.z;
      const lat = dx * uz - dz * ux;
      const reach = Math.max(1, dx * ux + dz * uz);
      if (Math.abs(lat) < 0.01 || mode === 'bounce_then_rope') break;
      az -= datan2(lat, reach);
    }
    if (!found) continue;
    const final = finalEval(speed, elev, az, ux, uz);
    const errorM = missDistance(mode, o, target.p, final, ux, uz);
    const feasible = final.ok && speed < vmax - 1e-6 && Math.abs(final.g) <= Math.max(5 * tol, 0.02);
    if (feasible) return { v: final.v, spin: spinFor(final.v), sim: final.sim, tArrive: final.t, arrive: final.p, feasible: true, errorM };
    if (!best || errorM < best.err) best = { r: final, err: errorM };
  }
  const b = best!;
  return { v: b.r.v, spin: spinFor(b.r.v), sim: b.r.sim, tArrive: b.r.t, arrive: b.r.p, feasible: false, errorM: b.err };
}

/**
 * A first guess of the launch speed (m/s): drag-free ballistics for carries and sixes, the closed-form roll for
 * ground strokes and fours (the solver brackets around it).
 */
function speedEstimate(mode: AimMode, d: number, dy: number, elevDeg: number, arriveV: number | null, dRope: number): number {
  if (mode === 'carry' || mode === 'over_rope') {
    const e = elevDeg * DEG;
    const c = dcos(e);
    const tn = dsin(e) / c;
    const denom = 2 * c * c * (d * tn - dy);
    return denom > 0 ? Math.sqrt((G * d * d) / denom) * 1.08 : 20;
  }
  const dist = mode === 'ground' ? d : dRope;
  const end = mode === 'ground' && arriveV === null ? OUTFIELD.stopSpeed : (arriveV ?? 0);
  // Rolling from s to speed `end` covers (s − end)/k − (c/k)·ln((s + c)/(end + c)); solve for s by bisection.
  const k = OUTFIELD.rollDrag;
  const cc = OUTFIELD.rollDecel / k;
  const cover = (s: number) => (s - end) / k - (cc / k) * dlog((s + cc) / (end + cc));
  let lo = end;
  let hi = 60;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (cover(mid) < dist) lo = mid;
    else hi = mid;
  }
  return ((lo + hi) / 2) * 1.12;
}

/** How far the trajectory misses the target: in 3D for carries, on the ground for ground strokes, at the rope. */
function missDistance(mode: AimMode, o: Vec3, target: Vec3, r: Probe & { sim: SimResult }, ux: number, uz: number): number {
  if (mode === 'bounce_then_rope') {
    const d = ropeDistance(o, ux, uz);
    const rope = v3(o.x + ux * d, 0, o.z + uz * d);
    const at = r.sim.boundary ? r.sim.boundary.p : r.p;
    const dx = at.x - rope.x;
    const dz = at.z - rope.z;
    return Math.sqrt(dx * dx + dz * dz) + (r.sim.boundary?.onFull ? 1 : 0);
  }
  const dx = r.p.x - target.x;
  const dy = mode === 'ground' ? 0 : r.p.y - target.y;
  const dz = r.p.z - target.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function sampleVel(sim: SimResult, t: number): number {
  const s = sim.samples;
  for (let i = 1; i < s.length; i++) {
    if (s[i].t >= t) {
      const v = s[i].v;
      return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    }
  }
  const v = sim.end.v;
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

/**
 * Bracketed secant (Illinois) on an objective increasing with speed, bracketed around an estimate when one is given;
 * returns the best probe found.
 */
function solveSpeed<T extends Probe>(f: (s: number) => T, lo: number, hi: number, tol: number, est?: number): { speed: number; r: T } {
  let a = lo;
  let b = hi;
  let fa: T | null = null;
  let fb: T | null = null;
  if (est !== undefined && est > lo && est < hi) {
    // Grow a bracket from the estimate (a few probes) instead of starting from the whole range.
    let x0 = est * 0.94;
    let x1 = Math.min(hi, est * 1.12);
    let f0 = f(x0);
    let f1 = f(x1);
    for (let k = 0; k < 6 && f0.g > 0 && x0 > lo; k++) {
      x1 = x0;
      f1 = f0;
      x0 = Math.max(lo, x0 * 0.75);
      f0 = f(x0);
    }
    for (let k = 0; k < 8 && f1.g < 0 && x1 < hi; k++) {
      x0 = x1;
      f0 = f1;
      x1 = Math.min(hi, x1 * 1.3);
      f1 = f(x1);
    }
    a = x0;
    fa = f0;
    b = x1;
    fb = f1;
  }
  if (!fa) fa = f(a);
  if (!fb) fb = f(b);
  if (fb.g < 0) return { speed: b, r: fb };
  if (fa.g > 0) return { speed: a, r: fa };
  let side = 0;
  let bestS = Math.abs(fa.g) < Math.abs(fb.g) ? a : b;
  let bestR = Math.abs(fa.g) < Math.abs(fb.g) ? fa : fb;
  let ga = fa.g;
  let gb = fb.g;
  for (let it = 0; it < 40; it++) {
    const c = (a * gb - b * ga) / (gb - ga);
    const s = c > a && c < b ? c : (a + b) / 2;
    const fc = f(s);
    if (Math.abs(fc.g) < Math.abs(bestR.g)) {
      bestS = s;
      bestR = fc;
    }
    if (Math.abs(fc.g) <= tol || b - a < 1e-4) break;
    if (fc.g < 0) {
      a = s;
      ga = fc.g;
      if (side === -1) gb /= 2;
      side = -1;
    } else {
      b = s;
      gb = fc.g;
      if (side === 1) ga /= 2;
      side = 1;
    }
  }
  return { speed: bestS, r: bestR };
}
