/**
 * The pace bowler's run-up composed from MOTION-BOWL's cleared clips (a TS port of plan() and compose() in
 * scripts/blender/motion/bowler_runup.py): `bowl_start` (from the top of the mark into a jog, leaving at a foot strike),
 * N approach strides on the phase-synced gait loops (`bowl_jog` 3.0, `bowl_run` 5.0, `bowl_stride` 6.2 m/s, blended by
 * speed with the stride-consistent weight w = (v·Ta − Sa) / ((Sb − Sa) − v(Tb − Ta)), the phase advancing at 1/T(w)
 * and the ground at v, the speed ramping 3.0 → 6.2 m/s by a smoothstep), then the delivery `bowl_pace` entered at its
 * `entry` marker (a left strike) with the ground continuous, through the bound to the release.
 *
 * The plan fits the release exactly to the run-up duration D: it picks the exit strike, the stride count and the ramp
 * placement; below the shortest standing run-up it is a rolling start (the clips begin `preRoll` before the visible
 * start). Nothing here changes a physics time or position: the caller places the composed ground rigidly so the ball
 * in hand is at the physics release point at the physics release time. Pure and deterministic.
 */
import { motionSource, type MotionSource, type SampledPose } from '../clips';


const LOOPS = ['bowl_jog', 'bowl_run', 'bowl_stride'] as const;
export type RunupAction = 'pace' | 'off' | 'leg';
const DELIVERY: Record<RunupAction, string> = { pace: 'bowl_pace', off: 'bowl_off', leg: 'bowl_leg' };
const FOLLOW: Record<RunupAction, string> = { pace: 'bowl_pace_follow', off: 'bowl_spin_off_follow', leg: 'bowl_spin_leg_follow' };
/** The clips this composer uses for an action (all cleared by the lead, 2026-11-04 03:24Z). */
const runupClips = (a: RunupAction) => ['bowl_start', ...LOOPS, DELIVERY[a], FOLLOW[a]];
const K_SPIN: readonly [number, number] = [0.96, 1.04];
const R_MIN = 0.9;
const R_MAX = 1.6;
const HOLD_MAX = 0.7;

interface Loop {
  v: number;
  T: number;
  S: number;
  id: string;
}

export interface RunupPlan {
  action: RunupAction;
  /** Spin: the approach cadence scale (stride unchanged), easing in and out; 1 for pace. */
  k: number;
  D: number;
  exit: 'exitL' | 'exitR';
  phase0: number;
  steps: number;
  /** Loop-section duration (s), the ramp's start and length (s), its placement (0..1). */
  A: number;
  tA: number;
  R: number;
  lam: number;
  /** Standing at the top before setting off (s), and the rolling start's lead-in skipped before the visible start (s). */
  hold: number;
  preRoll: number;
}

export interface ComposedRunup {
  plan: RunupPlan;
  /** Composed-clip times (s): the exit from bowl_start, the delivery entry, the release, the follow-through's end. */
  tExit: number;
  tEntry: number;
  tRelease: number;
  tEnd: number;
  source: MotionSource;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** True when every clip of the composer for this action is loaded (and cleared). */
export function canComposeRunup(action: RunupAction = 'pace'): boolean {
  return runupClips(action).every((id) => motionSource(`vmp:${id}`) !== undefined);
}

function src(id: string): MotionSource {
  const s = motionSource(`vmp:${id}`);
  if (!s) throw new Error(`run-up clip ${id} not loaded`);
  return s;
}

function loopTable(): Loop[] {
  return LOOPS.map((id) => {
    const s = src(id);
    return { v: s.speedMps, T: s.duration, S: s.speedMps * s.duration, id };
  }).sort((a, b) => a.v - b.v);
}

/** Bracketing loops and the stride-consistent weight w with S(w) / T(w) = v. */
function blendOf(table: Loop[], v: number): [Loop, Loop, number] {
  if (v <= table[0].v) return [table[0], table[0], 0];
  const last = table[table.length - 1];
  if (v >= last.v) return [last, last, 0];
  for (let i = 0; i < table.length - 1; i++) {
    const a = table[i];
    const b = table[i + 1];
    if (a.v <= v && v <= b.v) {
      const w = (v * a.T - a.S) / (b.S - a.S - v * (b.T - a.T));
      return [a, b, Math.max(0, Math.min(1, w))];
    }
  }
  return [last, last, 0];
}

const cycleT = (table: Loop[], v: number) => {
  const [a, b, w] = blendOf(table, v);
  return a.T * (1 - w) + b.T * w;
};
const rampV = (v1: number, t: number, tA: number, R: number, v0: number) => v0 + (v1 - v0) * smoothstep(tA, tA + R, t);

function cyclesOver(table: Loop[], A: number, tA: number, R: number, v0: number, v1: number, n = 400): number {
  if (A <= 0) return 0;
  const h = A / n;
  let s = 0;
  for (let i = 0; i < n; i++) s += h / cycleT(table, rampV(v1, (i + 0.5) * h, tA, R, v0));
  return s;
}

function paceRamp(A: number, lam: number): [number, number] {
  const R = Math.min(R_MIN + (R_MAX - R_MIN) * lam, A);
  return [lam * Math.max(0, A - R), R];
}

/** The loop-section time that covers exactly n steps for ramp placement lam. */
function paceA(table: Loop[], n: number, lam: number, v0: number, v1: number): number {
  let lo = 0.05;
  let hi = 6;
  for (let k = 0; k < 32; k++) {
    const A = 0.5 * (lo + hi);
    const [tA, R] = paceRamp(A, lam);
    if (cyclesOver(table, A, tA, R, v0, v1, 160) * 2 < n) lo = A;
    else hi = A;
  }
  return 0.5 * (lo + hi);
}

/** The run-up plan for a run-up start → release of D seconds (rolling start below the shortest standing one). */
export function planRunup(D: number, action: RunupAction = 'pace', allowRoll = true): RunupPlan | null {
  const table = loopTable();
  const tau = src(DELIVERY[action]).markers.release ?? 0.6;
  const start = src('bowl_start').markers;
  const v0 = src('bowl_jog').speedMps;
  const v1 = action === 'pace' ? src('bowl_stride').speedMps : v0;
  const stepJog = table[0].T / 2;
  let best: { score: number; p: RunupPlan } | null = null;
  for (const [exit, parity, phase0] of [['exitL', 0, 0], ['exitR', 1, 0.5]] as const) {
    const tX = start[exit];
    if (tX === undefined) continue;
    const aStar = D - tX - tau;
    for (let n = parity; n < 40; n += 2) {
      let lam = 0;
      let A: number;
      let hold: number;
      let k = 1;
      if (action === 'pace') {
        if (n < 2) continue;
        let a0 = paceA(table, n, 0, v0, v1);
        const a1 = paceA(table, n, 1, v0, v1);
        if (a1 < R_MIN) continue;
        a0 = Math.max(a0, R_MIN);
        if (a0 > aStar + HOLD_MAX + 1e-9) break;
        if (a0 - 1e-9 <= aStar && aStar <= a1 + 1e-9) {
          let lo = 0;
          let hi = 1;
          for (let it = 0; it < 26; it++) {
            const m = 0.5 * (lo + hi);
            if (paceA(table, n, m, v0, v1) < aStar) lo = m;
            else hi = m;
          }
          lam = 0.5 * (lo + hi);
          A = paceA(table, n, lam, v0, v1);
          hold = Math.max(0, D - tX - tau - A);
        } else if (aStar > a1 && aStar - a1 <= HOLD_MAX) {
          lam = 1;
          A = a1;
          hold = aStar - a1;
        } else continue;
      } else {
        const amin = (n * stepJog) / K_SPIN[1];
        const amax = (n * stepJog) / K_SPIN[0];
        if (amin > aStar + HOLD_MAX + 1e-9) break;
        if (amin - 1e-9 <= aStar && aStar <= amax + 1e-9) {
          A = aStar;
          hold = 0;
        } else if (aStar > amax && aStar - amax <= HOLD_MAX) {
          A = amax;
          hold = aStar - amax;
        } else continue;
        k = A > 0 ? (n * stepJog) / A : 1;
      }
      const [tA, R] = action === 'pace' ? paceRamp(A, lam) : [0, 0];
      const score = Math.round(hold * 1e4) * 1e3 + Math.round(Math.abs(k - 1) * 1e3);
      if (!best || score < best.score) best = { score, p: { action, k, D, exit, phase0, steps: n, A, tA, R, lam, hold, preRoll: 0 } };
    }
  }
  if (best) return best.p;
  if (!allowRoll) return null;
  // A rolling start: the shortest standing plan, begun before the visible run-up start.
  for (let i = 100; i < 700; i++) {
    const trial = i / 100;
    if (trial <= D) continue;
    const p = planRunup(trial, action, false);
    if (p) return { ...p, preRoll: trial - D - p.hold, hold: 0, D };
  }
  return null;
}

const nlerpInto = (a: Float32Array, b: Float32Array, w: number, out: Float32Array) => {
  for (let i = 0; i < out.length; i += 4) {
    const s = a[i] * b[i] + a[i + 1] * b[i + 1] + a[i + 2] * b[i + 2] + a[i + 3] * b[i + 3] < 0 ? -1 : 1;
    const x = a[i] + (s * b[i] - a[i]) * w;
    const y = a[i + 1] + (s * b[i + 1] - a[i + 1]) * w;
    const z = a[i + 2] + (s * b[i + 2] - a[i + 2]) * w;
    const q = a[i + 3] + (s * b[i + 3] - a[i + 3]) * w;
    const l = Math.hypot(x, y, z, q) || 1;
    out[i] = x / l;
    out[i + 1] = y / l;
    out[i + 2] = z / l;
    out[i + 3] = q / l;
  }
};

/** Composes the plan's clip (composed time 0 = the plan's start, before any preRoll). */
/** MOTION-BOWL's bouncer delivery (pace only): played in place of bowl_pace, same seam and markers. */
const BOUNCER = { delivery: 'bowl_pace_bouncer', follow: 'bowl_pace_bouncer_follow' } as const;

/** True when the pace bouncer's own delivery and follow-through are loaded (with the stock follow-through it joins). */
export function canComposeBouncer(): boolean {
  return canComposeRunup('pace') && [BOUNCER.delivery, BOUNCER.follow].every((id) => motionSource(`vmp:${id}`) !== undefined);
}

/**
 * The bouncer's follow-through: its own clip up to its `join` marker, then bowl_pace_follow from that same time (the
 * frames decode identically there; MOTION-BOWL), its ground carried on from the join.
 */
function bouncerFollow(): MotionSource {
  const a = src(BOUNCER.follow);
  const b = src(FOLLOW.pace);
  const join = Math.min(a.markers.join ?? a.duration, a.duration, b.duration);
  const ga = a.ground!(join);
  const gb = b.ground!(join);
  return {
    duration: b.duration,
    loop: false,
    speedMps: 0,
    markers: b.markers,
    sample: (t, out) => (t < join ? a.sample(t, out) : b.sample(t, out)),
    contacts: (t) => (t < join ? a.contacts?.(t) ?? 0 : b.contacts?.(t) ?? 0),
    ground: (t) => {
      if (t < join) return a.ground!(t);
      const g = b.ground!(t);
      return { x: ga.x + g.x - gb.x, z: ga.z + g.z - gb.z, yawDeg: ga.yawDeg + g.yawDeg - gb.yawDeg };
    },
  };
}

export function composeRunup(plan: RunupPlan, scratch: { a: SampledPose; b: SampledPose }, variant: 'bouncer' | null = null): ComposedRunup {
  const table = loopTable();
  const st = src('bowl_start');
  const bouncer = variant === 'bouncer' && plan.action === 'pace' && canComposeBouncer();
  const dl = bouncer ? src(BOUNCER.delivery) : src(DELIVERY[plan.action]);
  const fl = bouncer ? bouncerFollow() : src(FOLLOW[plan.action]);
  const v0 = src('bowl_jog').speedMps;
  const v1 = plan.action === 'pace' ? src('bowl_stride').speedMps : v0;
  const kOf = (t: number) => (plan.A > 0 ? 1 + 2 * (plan.k - 1) * Math.sin((Math.PI * t) / plan.A) ** 2 : 1);
  const tX0 = st.markers[plan.exit];
  const tX = plan.hold + tX0;
  const e = dl.markers.entry ?? 0;
  const tE = tX + plan.A;
  const tRelease = tE + (dl.markers.release - e);
  const tEnd = tE + (dl.duration - e);
  const tFollowEnd = tEnd + fl.duration;
  // The loop section's phase (cycles) and ground (m) integrated on a fine grid.
  const fine = 1000;
  const hh = plan.A / fine;
  const ph = new Float64Array(fine + 1);
  const gz = new Float64Array(fine + 1);
  for (let i = 0; i < fine; i++) {
    const t = (i + 0.5) * hh;
    const v = rampV(v1, t, plan.tA, plan.R, v0);
    const kt = kOf(t);
    ph[i + 1] = ph[i] + (kt * hh) / cycleT(table, v);
    gz[i + 1] = gz[i] + kt * v * hh;
  }
  const loopState = (tl: number): [number, number] => {
    const f = Math.max(0, Math.min(fine, hh > 0 ? tl / hh : 0));
    const i = Math.min(fine - 1, Math.floor(f));
    const u = f - i;
    return [plan.phase0 + ph[i] + (ph[i + 1] - ph[i]) * u, gz[i] + (gz[i + 1] - gz[i]) * u];
  };
  const gExit = st.ground!(tX0);
  const zLoops = loopState(plan.A)[1];
  const g0 = dl.ground!(e);
  const deliveryGround = (t: number) => {
    const g = dl.ground!(e + Math.min(t, tEnd) - tE);
    return { x: gExit.x + g.x - g0.x, z: gExit.z + zLoops + g.z - g0.z, yawDeg: g.yawDeg - g0.yawDeg };
  };
  const dEnd = deliveryGround(tEnd);
  const ground = (t: number): { x: number; z: number; yawDeg: number } => {
    if (t <= tX) return st.ground!(Math.max(0, t - plan.hold));
    if (t <= tE) return { x: gExit.x, z: gExit.z + loopState(t - tX)[1], yawDeg: 0 };
    if (t <= tEnd) return deliveryGround(t);
    // The follow-through from where the delivery left him, in his heading then.
    const f = fl.ground!(Math.min(t, tFollowEnd) - tEnd);
    const yaw = (dEnd.yawDeg * Math.PI) / 180;
    return { x: dEnd.x + f.x * Math.cos(yaw) + f.z * Math.sin(yaw), z: dEnd.z - f.x * Math.sin(yaw) + f.z * Math.cos(yaw), yawDeg: dEnd.yawDeg + f.yawDeg };
  };
  const contactsAt = (t: number): number => {
    if (t <= tX) return st.contacts?.(Math.max(0, t - plan.hold)) ?? 0;
    if (t <= tE) {
      const [phase] = loopState(t - tX);
      const [a, b, w] = blendOf(table, rampV(v1, t - tX, plan.tA, plan.R, v0));
      const c = w < 0.5 ? a : b;
      return src(c.id).contacts?.(phase * c.T) ?? 0;
    }
    if (t <= tEnd) return dl.contacts?.(e + t - tE) ?? 0;
    return fl.contacts?.(Math.min(t, tFollowEnd) - tEnd) ?? 0;
  };
  const source: MotionSource = {
    duration: tFollowEnd,
    loop: false,
    speedMps: 0,
    markers: { exit: tX, entry: tE, release: tRelease, end: tEnd, stop: tFollowEnd },
    sample: (t: number, out: SampledPose) => {
      if (t <= tX) {
        st.sample(Math.max(0, t - plan.hold), out);
        return;
      }
      if (t <= tE) {
        const tl = t - tX;
        const [phase] = loopState(tl);
        const [a, b, w] = blendOf(table, rampV(v1, tl, plan.tA, plan.R, v0));
        src(a.id).sample(phase * a.T, out);
        if (w > 0 && a !== b) {
          src(b.id).sample(phase * b.T, scratch.b);
          nlerpInto(out.q, scratch.b.q, w, out.q);
          out.root = [out.root[0] + (scratch.b.root[0] - out.root[0]) * w, out.root[1] + (scratch.b.root[1] - out.root[1]) * w, out.root[2] + (scratch.b.root[2] - out.root[2]) * w];
        }
        return;
      }
      if (t <= tEnd) dl.sample(e + t - tE, out);
      else fl.sample(Math.min(t, tFollowEnd) - tEnd, out);
    },
    contacts: contactsAt,
    ground,
  };
  void scratch.a;
  return { plan, tExit: tX, tEntry: tE, tRelease, tEnd: tFollowEnd, source };
}
