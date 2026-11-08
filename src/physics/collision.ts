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
import { batPoseGapReach } from './admissibility';
import { BALL_R, BLADE_HALF_W, BLADE_L, BLADE_T } from './constants';
import { BAT_POINT_SPEED_LIMIT_MPS, type BatPose, type BatTrack, type BatterBody, type Capsule, batPose, trackEndT } from './bat';
import {
  type BladeContact,
  type BladeFrame,
  bladeContact,
  bladeFrame,
  handleCapsule,
} from './batGeometry';
import { type Vec3, norm, v3 } from './vec';

export { bladeContact, bladeFrame, handleCapsule } from './batGeometry';
export type { BladeContact, BladeFrame } from './batGeometry';

export type BladeRegion = 'face' | 'edge' | 'back' | 'toe' | 'shoulder';

/**
 * Region of the blade the ball touches, from the ball centre in the blade frame.
 *
 * At an edge/corner the centre can be microscopically outside more than one box extent. Classify by the dominant
 * component of the sphere-to-box closest-point vector instead of giving the blade's long axis arbitrary priority:
 * a ball a few micrometres beyond the toe but a full radius in front of the face is a face hit, while a true toe or
 * side-edge arrival remains a toe/edge hit. Exact ties deterministically prefer face/back, then the side edge.
 */
export function bladeRegion(c: BladeContact): BladeRegion {
  const hu = BLADE_L / 2;
  const ht = BLADE_T / 2;
  const alongOutside = Math.max(Math.abs(c.lu) - hu, 0);
  const widthOutside = Math.max(Math.abs(c.lw) - BLADE_HALF_W, 0);
  const normalOutside = Math.max(Math.abs(c.ln) - ht, 0);
  const largest = Math.max(alongOutside, widthOutside, normalOutside);
  const numericTie = Number.EPSILON * Math.max(1, largest) * 8;
  if (normalOutside >= largest - numericTie) return c.ln >= 0 ? 'face' : 'back';
  if (widthOutside >= largest - numericTie) return 'edge';
  return c.lu >= 0 ? 'shoulder' : 'toe';
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
  /** Minimum separation to either rigid bat surface after any anatomy gate. */
  batD: number;
  bladeD: number;
  bladeQ: Vec3;
}

function probe(
  p: Vec3,
  pose: BatPose | null,
  body: BatterBody,
  enforceAnatomy: boolean,
  includeBody: boolean,
): Probe {
  let best: Probe = { d: Infinity, part: 'torso', q: p, batD: Infinity, bladeD: Infinity, bladeQ: p };
  if (pose) {
    const anatomyGate = enforceAnatomy ? HIT_EPS - batPoseGapReach(pose, body).gap : -Infinity;
    const f = bladeFrame(pose);
    const c = bladeContact(f, p);
    const bd = Math.max(c.dist - BALL_R, anatomyGate);
    best = { d: bd, part: 'blade', q: c.q, batD: bd, bladeD: bd, bladeQ: c.q };
    const h = capsuleDist(handleCapsule(f), p);
    const handleD = Math.max(h.d - BALL_R, anatomyGate);
    best.batD = Math.min(bd, handleD);
    if (handleD < best.d) best = { ...best, d: handleD, part: 'handle', q: h.q };
  }
  if (!includeBody) return best;
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

const HIT_EPS = 1e-5;

/**
 * Sweep the ball path (fixed-step samples) against the bat track (or none, for a leave) and the body, from t0 to t1.
 * Returns the first contact, and the closest approach to the blade.
 */
function sweepInternal(
  samples: BallSample[],
  track: BatTrack | null,
  body: BatterBody,
  t0: number,
  t1: number,
  batOnly: boolean,
  bodyFromT = -Infinity,
): SweepResult {
  let closest: SweepResult['closest'] = null;
  // A bat already penetrating the ball when the swing activates is not a contact. It must separate first, then make
  // a future entry. The armed state persists across flight-sample intervals.
  let batArmed = false;
  // The footwork body takes its place at bodyFromT (PHYS2 5f: the swing's own start); before that it does not collide.
  // Like the bat, a body already around the ball when it takes its place is not a contact until they separate.
  const bodyGated = bodyFromT > -Infinity;
  let bodyArmed = !bodyGated;
  for (let i = 1; i < samples.length; i++) {
    const A = samples[i - 1];
    const B = samples[i];
    if (B.t < t0 || A.t > t1) continue;
    const ta = A.t;
    const tb = B.t;
    const span = tb - ta;
    const vb = dist3(A.p, B.p) / span;
    // buildBatTrack analytically rejects any rigid stroke whose farthest bat point can exceed this global bound.
    // Distance to a moving rigid surface and every anatomy gap are 1-Lipschitz in that point motion, so ball speed
    // plus this bound is a true closing-speed ceiling (not an endpoint finite-difference heuristic).
    const vBat = track ? BAT_POINT_SPEED_LIMIT_MPS : 0;
    const vmax = vb + vBat + 1e-3;
    let t = ta;
    for (let guard = 0; guard < 4000 && t <= tb; guard++) {
      const g = (t - ta) / span;
      const p = v3(A.p.x + (B.p.x - A.p.x) * g, A.p.y + (B.p.y - A.p.y) * g, A.p.z + (B.p.z - A.p.z) * g);
      // The waiting stance is presentation only: a bat cannot collide before the player has activated the swing.
      // Every emitted visible track is geometry-admitted and collidable, including a completed mistimed whiff.
      const candidatePose = track?.geometryAdmitted && t >= track.startT && t <= trackEndT(track) ? batPose(track, t) : null;
      let activationStep = Infinity;
      if (candidatePose && !batArmed) {
        const candidate = probe(p, candidatePose, body, !batOnly, !batOnly);
        if (candidate.batD > HIT_EPS) batArmed = true;
        else activationStep = Math.max((HIT_EPS - candidate.batD) / vmax, 1e-6);
      }
      const pose = candidatePose && batArmed ? candidatePose : null;
      let bodyStep = Infinity;
      if (bodyGated && !bodyArmed && t >= bodyFromT) {
        const bd = probe(p, null, body, false, true).d;
        if (bd > HIT_EPS) bodyArmed = true;
        else bodyStep = Math.max((HIT_EPS - bd) / vmax, 1e-6);
      }
      const pr = probe(p, pose, body, !batOnly, !batOnly && bodyArmed);
      if (pose && Number.isFinite(pr.bladeD) && (!closest || pr.bladeD < closest.dist)) {
        closest = { t, ball: p, bat: pr.bladeQ, dist: pr.bladeD };
      }
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
      // While an initially overlapping bat is unarmed, advance no farther than its Lipschitz distance to separation.
      // This observes a separation/re-entry even when both flight-sample endpoints overlap the moving bat.
      const step = Math.min(pr.d / vmax, activationStep, bodyStep);
      let nextT = t + (step > 1e-6 ? step : 1e-6);
      // Conservative advancement must land exactly on activation instead of stepping over the bat's appearance.
      if (track && t < track.startT && nextT > track.startT) nextT = track.startT;
      if (bodyGated && t < bodyFromT && nextT > bodyFromT) nextT = bodyFromT;
      t = nextT;
    }
  }
  return { hit: null, closest };
}

/** Authoritative combined body + anatomy-gated bat sweep. */
export function sweep(samples: BallSample[], track: BatTrack | null, body: BatterBody, t0: number, t1: number): SweepResult {
  return sweepInternal(samples, track, body, t0, t1, false);
}

/**
 * The combined sweep with the batter's footwork body colliding only from bodyFromT (PHYS2 5f: a swing's footwork
 * cannot act before the swing starts). Used only when the plain sweep's first touch came before that time.
 */
export function sweepFrom(samples: BallSample[], track: BatTrack | null, body: BatterBody, t0: number, t1: number, bodyFromT: number): SweepResult {
  return sweepInternal(samples, track, body, t0, t1, false, bodyFromT);
}

/**
 * Earliest purely geometric blade/handle candidate. Body contacts and anatomical eligibility are intentionally absent:
 * strike uses this deterministic first pass only to choose one static whole-batter root offset, then runs `sweep` once.
 */
export function sweepRawBat(samples: BallSample[], track: BatTrack, t0: number, t1: number): SweepResult {
  return sweepInternal(samples, track, track.body, t0, t1, true);
}
