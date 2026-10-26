/**
 * Continuous (swept) collision between the ball and the batter: the blade (a thin box), the handle and gloves (a
 * capsule), the pads and the body (capsules, a sphere for the head).
 *
 * Conservative advancement: between two flight samples the ball centre moves linearly; at time t the separation
 * d(t) = distance(ball centre, nearest surface) − R is evaluated on the exact bat pose, and time advances by
 * d / vmax, where vmax bounds the closing speed (ball speed plus the fastest point of the bat over the interval).
 * The step can never jump past a contact, so a 160 km/h ball cannot tunnel through a 30 m/s bat, whatever the
 * sample spacing; the first time of impact is found to within 10 µm of separation.
 */
import type { BallSample } from '@/contracts/practice';
import { BALL_R, BLADE_HALF_W, BLADE_L, BLADE_T, GLOVE_R, HANDLE_L } from './constants';
import { type BatPose, type BatTrack, type BatterBody, type Capsule, batPose } from './bat';
import { type Vec3, cross, dot, norm, v3 } from './vec';

export type BladeRegion = 'face' | 'edge' | 'back' | 'toe' | 'shoulder';

export interface BladeFrame {
  centre: Vec3;
  /** Blade axis toe → grip, face normal, width axis (a × n). */
  a: Vec3;
  n: Vec3;
  w: Vec3;
}

export function bladeFrame(p: BatPose): BladeFrame {
  const a = norm(v3(p.grip.x - p.toe.x, p.grip.y - p.toe.y, p.grip.z - p.toe.z));
  const k = dot(p.n, a);
  const n = norm(v3(p.n.x - k * a.x, p.n.y - k * a.y, p.n.z - k * a.z));
  const w = cross(a, n);
  const h = BLADE_L / 2;
  return { centre: v3(p.toe.x + a.x * h, p.toe.y + a.y * h, p.toe.z + a.z * h), a, n, w };
}

export interface BladeContact {
  /** Closest point on the blade box, the distance from it to the ball centre, and the ball centre in the frame. */
  q: Vec3;
  dist: number;
  lu: number;
  lw: number;
  ln: number;
}

export function bladeContact(f: BladeFrame, p: Vec3): BladeContact {
  const dx = p.x - f.centre.x;
  const dy = p.y - f.centre.y;
  const dz = p.z - f.centre.z;
  const lu = dx * f.a.x + dy * f.a.y + dz * f.a.z;
  const lw = dx * f.w.x + dy * f.w.y + dz * f.w.z;
  const ln = dx * f.n.x + dy * f.n.y + dz * f.n.z;
  const hu = BLADE_L / 2;
  const ht = BLADE_T / 2;
  const cu = lu < -hu ? -hu : lu > hu ? hu : lu;
  const cw = lw < -BLADE_HALF_W ? -BLADE_HALF_W : lw > BLADE_HALF_W ? BLADE_HALF_W : lw;
  const cn = ln < -ht ? -ht : ln > ht ? ht : ln;
  const q = v3(
    f.centre.x + f.a.x * cu + f.w.x * cw + f.n.x * cn,
    f.centre.y + f.a.y * cu + f.w.y * cw + f.n.y * cn,
    f.centre.z + f.a.z * cu + f.w.z * cw + f.n.z * cn,
  );
  const ex = p.x - q.x;
  const ey = p.y - q.y;
  const ez = p.z - q.z;
  return { q, dist: Math.sqrt(ex * ex + ey * ey + ez * ez), lu, lw, ln };
}

/** Region of the blade the ball touches, from the ball centre in the blade frame. */
export function bladeRegion(c: BladeContact): BladeRegion {
  const hu = BLADE_L / 2;
  if (c.lu > hu) return 'shoulder';
  if (c.lu < -hu) return 'toe';
  if (c.lw > BLADE_HALF_W || c.lw < -BLADE_HALF_W) return 'edge';
  return c.ln >= 0 ? 'face' : 'back';
}

function segPoint(a: Vec3, b: Vec3, p: Vec3): Vec3 {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz;
  let s = l2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2 : 0;
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  return v3(a.x + abx * s, a.y + aby * s, a.z + abz * s);
}

function capsuleDist(c: Capsule, p: Vec3): { q: Vec3; d: number } {
  const s = segPoint(c.a, c.b, p);
  const dx = p.x - s.x;
  const dy = p.y - s.y;
  const dz = p.z - s.z;
  const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const k = l > 0 ? c.r / l : 0;
  return { q: v3(s.x + dx * k, s.y + dy * k, s.z + dz * k), d: l - c.r };
}

/** Handle and gloves: a capsule from the top of the blade to just below the grip. */
export function handleCapsule(f: BladeFrame): Capsule {
  const h = BLADE_L / 2;
  const a = v3(f.centre.x + f.a.x * h, f.centre.y + f.a.y * h, f.centre.z + f.a.z * h);
  const top = h + HANDLE_L - 0.04;
  return { a, b: v3(f.centre.x + f.a.x * top, f.centre.y + f.a.y * top, f.centre.z + f.a.z * top), r: GLOVE_R };
}

export type Part = 'blade' | 'handle' | 'front_pad' | 'back_pad' | 'torso' | 'head';

export interface SweepHit {
  part: Part;
  t: number;
  /** Ball centre and velocity at impact. */
  ball: Vec3;
  ballV: Vec3;
  /** Contact point on the surface and the unit normal from it towards the ball centre. */
  point: Vec3;
  normal: Vec3;
  /** Blade hits: frame and local coordinates at impact. */
  blade: { frame: BladeFrame; contact: BladeContact; region: BladeRegion } | null;
}

export interface SweepResult {
  hit: SweepHit | null;
  /** Closest approach of the ball to the blade (bat swings only): ball centre, nearest blade point, separation. */
  closest: { t: number; ball: Vec3; bat: Vec3; dist: number } | null;
}

interface Probe {
  d: number;
  part: Part;
  q: Vec3;
  bladeD: number;
  bladeQ: Vec3;
}

function probe(p: Vec3, pose: BatPose | null, body: BatterBody): Probe {
  let best: Probe = { d: Infinity, part: 'torso', q: p, bladeD: Infinity, bladeQ: p };
  if (pose) {
    const f = bladeFrame(pose);
    const c = bladeContact(f, p);
    const bd = c.dist - BALL_R;
    best = { d: bd, part: 'blade', q: c.q, bladeD: bd, bladeQ: c.q };
    const h = capsuleDist(handleCapsule(f), p);
    if (h.d - BALL_R < best.d) best = { ...best, d: h.d - BALL_R, part: 'handle', q: h.q };
  }
  const parts: Array<[Part, Capsule]> = [
    ['front_pad', body.pads[0]],
    ['back_pad', body.pads[1]],
    ['torso', body.torso],
  ];
  for (const [part, cap] of parts) {
    const c = capsuleDist(cap, p);
    if (c.d - BALL_R < best.d) best = { ...best, d: c.d - BALL_R, part, q: c.q };
  }
  const hx = p.x - body.head.c.x;
  const hy = p.y - body.head.c.y;
  const hz = p.z - body.head.c.z;
  const hl = Math.sqrt(hx * hx + hy * hy + hz * hz);
  const hd = hl - body.head.r - BALL_R;
  if (hd < best.d) {
    const k = hl > 0 ? body.head.r / hl : 0;
    best = { ...best, d: hd, part: 'head', q: v3(body.head.c.x + hx * k, body.head.c.y + hy * k, body.head.c.z + hz * k) };
  }
  return best;
}

function dist3(a: Vec3, b: Vec3): number {
  const x = b.x - a.x;
  const y = b.y - a.y;
  const z = b.z - a.z;
  return Math.sqrt(x * x + y * y + z * z);
}

function poseSpeed(track: BatTrack, t: number): number {
  const h = 0.0005;
  const a = batPose(track, t - h);
  const b = batPose(track, t + h);
  const vg = dist3(a.grip, b.grip) / (2 * h);
  const vt = dist3(a.toe, b.toe) / (2 * h);
  return vg > vt ? vg : vt;
}

const HIT_EPS = 1e-5;

/**
 * Sweep the ball path (fixed-step samples) against the bat track (or none, for a leave) and the body, from t0 to t1.
 * Returns the first contact, and the closest approach to the blade.
 */
export function sweep(samples: BallSample[], track: BatTrack | null, body: BatterBody, t0: number, t1: number): SweepResult {
  let closest: SweepResult['closest'] = null;
  for (let i = 1; i < samples.length; i++) {
    const A = samples[i - 1];
    const B = samples[i];
    if (B.t < t0 || A.t > t1) continue;
    const ta = A.t;
    const tb = B.t;
    const span = tb - ta;
    const vb = dist3(A.p, B.p) / span;
    let vBat = 0;
    if (track) {
      const s1 = poseSpeed(track, ta);
      const s2 = poseSpeed(track, (ta + tb) / 2);
      const s3 = poseSpeed(track, tb);
      vBat = Math.max(s1, s2, s3) * 1.3 + 4;
    }
    const vmax = vb + vBat + 1e-3;
    let t = ta;
    for (let guard = 0; guard < 4000 && t <= tb; guard++) {
      const g = (t - ta) / span;
      const p = v3(A.p.x + (B.p.x - A.p.x) * g, A.p.y + (B.p.y - A.p.y) * g, A.p.z + (B.p.z - A.p.z) * g);
      const pose = track ? batPose(track, t) : null;
      const pr = probe(p, pose, body);
      if (track && (!closest || pr.bladeD < closest.dist)) closest = { t, ball: p, bat: pr.bladeQ, dist: pr.bladeD };
      if (pr.d <= HIT_EPS) {
        const ballV = v3((B.p.x - A.p.x) / span, (B.p.y - A.p.y) / span, (B.p.z - A.p.z) / span);
        const nx = p.x - pr.q.x;
        const ny = p.y - pr.q.y;
        const nz = p.z - pr.q.z;
        let normal = norm(v3(nx, ny, nz));
        let blade: SweepHit['blade'] = null;
        if (pr.part === 'blade' && pose) {
          const frame = bladeFrame(pose);
          const contact = bladeContact(frame, p);
          const region = bladeRegion(contact);
          if (region === 'face' && contact.dist < 1e-9) normal = frame.n;
          blade = { frame, contact, region };
        }
        if (normal.x === 0 && normal.y === 0 && normal.z === 0) normal = v3(0, 0, -1);
        return { hit: { part: pr.part, t, ball: p, ballV, point: pr.q, normal, blade }, closest };
      }
      const step = pr.d / vmax;
      t += step > 1e-6 ? step : 1e-6;
    }
  }
  return { hit: null, closest };
}
