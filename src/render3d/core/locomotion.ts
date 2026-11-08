/**
 * Locomotion layers for the fielders and the keeper (presentation only): forward kinematics on the shared skeleton,
 * the heading turn a body can make, and the per-frame pose layers StageScene applies through its pose hook
 * (core/fieldClips.ts `fieldPoseHook`):
 *  - planted feet: a foot the clip puts on the ground stays where it landed (two-bone leg IK) until the clip lifts it;
 *    a foot dragged too far from where the body wants it (a turn on the spot, a stride the clip cannot match) takes a
 *    short step instead of sliding; the hips drop a little rather than over-stretch a leg;
 *  - lean: forward into acceleration, back against braking, and banked into a curve (from the physics path's own
 *    acceleration, so the lean never anticipates anything the path does not do);
 *  - weight shift: a slow sway between the feet while standing (planted feet stay planted, the knees take it);
 *  - head: eyes on the ball (the physics ball, a moment behind it), within the neck's range;
 *  - hands: to the physics ball at the take, the catch, the gather and the dive's reach, when it is within reach.
 *
 * Nothing here moves a fielder: the root is always the physics FielderPath (practice/fielding.ts). Pure and
 * deterministic: the planted-foot plan is a function of the track alone, built forward from a fixed anchor and cached.
 */
import { type ActorState, type ActorTrack, evaluateActor } from './actors';
import { CLIPS, type ClipDef, type ClipId, type SampledPose, addBoneRotation, blendPose, clipDuration, clipMarker, createPose, getClip, overlayLower, sampleClip } from './clips';
import { quatFromEulerDeg } from './quat';
import { type Vec3, angleDelta, clamp, headingOf, smoothstep } from './math';
import { BONE_INDEX, BONE_NAMES, type BoneName, SKELETON } from './skeleton';

// ---------------------------------------------------------------------------------------------------------------
// Forward kinematics (pure; matches players.ts applyPose + three.js bone transforms)
// ---------------------------------------------------------------------------------------------------------------

const NB = BONE_NAMES.length;
const PARENT: number[] = SKELETON.map((b) => (b.parent ? BONE_INDEX[b.parent] : -1));
const OFFSET: Array<readonly [number, number, number]> = SKELETON.map((b) => b.offset);
/** Ankle height of the rest pose standing on the ground (m, scale 1). */
export const ANKLE_REST_Y = OFFSET[0][1] + OFFSET[BONE_INDEX.thighL][1] + OFFSET[BONE_INDEX.shinL][1] + OFFSET[BONE_INDEX.footL][1];

/** Joint positions and world rotations of every bone, in the actor's local frame (rig scale 1, facing +z). */
export interface Joints {
  /** NB × 3 joint positions (the bone's origin). */
  p: Float64Array;
  /** NB × 4 accumulated rotations (x, y, z, w). */
  q: Float64Array;
  /**
   * The pose these joints were last computed from (NB × 4 local rotations, then the root): `forwardKinematics` works out
   * only the bones a change since then reaches. Only `forwardKinematics` writes `p` and `q`.
   */
  from: Float64Array;
  /** `from` holds a pose the joints were computed from. */
  fresh: boolean;
}

export function createJoints(): Joints {
  return { p: new Float64Array(NB * 3), q: new Float64Array(NB * 4), from: new Float64Array(NB * 4 + 3), fresh: false };
}

/** Rotates (x, y, z) by unit quaternion q[qo..qo+3] into out[o..o+2]. */
function rotate(q: ArrayLike<number>, qo: number, x: number, y: number, z: number, out: Float64Array | number[], o: number) {
  const qx = q[qo];
  const qy = q[qo + 1];
  const qz = q[qo + 2];
  const qw = q[qo + 3];
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  out[o] = x + qw * tx + (qy * tz - qz * ty);
  out[o + 1] = y + qw * ty + (qz * tx - qx * tz);
  out[o + 2] = z + qw * tz + (qx * ty - qy * tx);
}

/** out = a · b (quaternions at offsets). */
function qmul(a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number, out: Float64Array | Float32Array | number[], o: number) {
  const ax = a[ao];
  const ay = a[ao + 1];
  const az = a[ao + 2];
  const aw = a[ao + 3];
  const bx = b[bo];
  const by = b[bo + 1];
  const bz = b[bo + 2];
  const bw = b[bo + 3];
  out[o] = aw * bx + ax * bw + ay * bz - az * by;
  out[o + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[o + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** The shortest rotation taking unit vector a to unit vector b, into out[o..o+3]. */
function qFromUnit(ax: number, ay: number, az: number, bx: number, by: number, bz: number, out: number[], o = 0) {
  const d = ax * bx + ay * by + az * bz;
  if (d < -0.999999) {
    // Opposite: any perpendicular axis.
    let px = 0;
    let py = -az;
    let pz = ay;
    if (Math.abs(ax) > 0.9) {
      px = az;
      py = 0;
      pz = -ax;
    }
    const n = Math.hypot(px, py, pz) || 1;
    out[o] = px / n;
    out[o + 1] = py / n;
    out[o + 2] = pz / n;
    out[o + 3] = 0;
    return;
  }
  let x = ay * bz - az * by;
  let y = az * bx - ax * bz;
  let z = ax * by - ay * bx;
  let w = 1 + d;
  const n = Math.hypot(x, y, z, w) || 1;
  x /= n;
  y /= n;
  z /= n;
  w /= n;
  out[o] = x;
  out[o + 1] = y;
  out[o + 2] = z;
  out[o + 3] = w;
}

const DIRTY = new Uint8Array(NB);

/**
 * Forward kinematics of a sampled pose (bones in SKELETON order: every parent precedes its children). A bone's joint is a
 * function of its own local rotation and its parent's joint, so with the pose the joints were last computed from kept
 * (`Joints.from`), only the bones whose rotation changed, and their descendants, are worked out again, each by exactly
 * the arithmetic of the full pass: the joints are bit for bit what a full pass gives.
 */
export function forwardKinematics(pose: SampledPose, out: Joints = createJoints()): Joints {
  const q = pose.q;
  const root = pose.root;
  const P = out.p;
  const Q = out.q;
  const F = out.from;
  const all = !out.fresh;
  for (let i = 0; i < NB; i++) {
    const par = PARENT[i];
    const o = OFFSET[i];
    const k = i * 4;
    let dirty = all || (par >= 0 && DIRTY[par] === 1);
    if (!dirty) {
      dirty = !Object.is(q[k], F[k]) || !Object.is(q[k + 1], F[k + 1]) || !Object.is(q[k + 2], F[k + 2]) || !Object.is(q[k + 3], F[k + 3]);
      if (par < 0 && !dirty) dirty = !Object.is(root[0], F[NB * 4]) || !Object.is(root[1], F[NB * 4 + 1]) || !Object.is(root[2], F[NB * 4 + 2]);
    }
    DIRTY[i] = dirty ? 1 : 0;
    if (!dirty) continue;
    F[k] = q[k];
    F[k + 1] = q[k + 1];
    F[k + 2] = q[k + 2];
    F[k + 3] = q[k + 3];
    if (par < 0) {
      F[NB * 4] = root[0];
      F[NB * 4 + 1] = root[1];
      F[NB * 4 + 2] = root[2];
      P[0] = root[0] + o[0];
      P[1] = o[1] + root[1];
      P[2] = root[2] + o[2];
      Q[0] = q[0];
      Q[1] = q[1];
      Q[2] = q[2];
      Q[3] = q[3];
      continue;
    }
    rotate(Q, par * 4, o[0], o[1], o[2], P, i * 3);
    P[i * 3] += P[par * 3];
    P[i * 3 + 1] += P[par * 3 + 1];
    P[i * 3 + 2] += P[par * 3 + 2];
    qmul(Q, par * 4, q, i * 4, Q, i * 4);
  }
  out.fresh = true;
  return out;
}

/** The world point of a local (actor-frame, scale 1) point for a root at `pos` with `heading` and rig `scale`. */
export function localToWorld(x: number, y: number, z: number, pos: Vec3, heading: number, scale: number): Vec3 {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return { x: pos.x + (c * x + s * z) * scale, y: y * scale, z: pos.z + (-s * x + c * z) * scale };
}

/** The local (actor-frame, scale 1) point of a world point. */
export function worldToLocal(p: Vec3, pos: Vec3, heading: number, scale: number): Vec3 {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const dx = (p.x - pos.x) / scale;
  const dz = (p.z - pos.z) / scale;
  return { x: c * dx - s * dz, y: p.y / scale, z: s * dx + c * dz };
}

/** A bone's joint in world space. */
export function jointWorld(j: Joints, bone: BoneName, pos: Vec3, heading: number, scale: number): Vec3 {
  const i = BONE_INDEX[bone] * 3;
  return localToWorld(j.p[i], j.p[i + 1], j.p[i + 2], pos, heading, scale);
}

// ---------------------------------------------------------------------------------------------------------------
// The pose StageScene draws for a track (without its pose hook): clip, lower layer, crossfade
// ---------------------------------------------------------------------------------------------------------------

export interface PoseScratch {
  a: SampledPose;
  b: SampledPose;
  lower: SampledPose;
}
export const createPoseScratch = (): PoseScratch => ({ a: createPose(), b: createPose(), lower: createPose() });

/**
 * The sampled pose StageScene.poseActor builds for `track` at scene time t, before any pose hook and the mirror:
 * the current clip, its lower-body layer, crossfaded from the previous move's. Returns `scratch.a`.
 */
export function trackPoseAt(track: ActorTrack, t: number, scratch: PoseScratch): SampledPose {
  const st = evaluateActor(track, t);
  const pose = sampleClip(st.current.clip, st.current.time, scratch.a);
  if (st.current.lower) overlayLower(pose, sampleClip(st.current.lower, st.current.lowerTime ?? 0, scratch.lower));
  if (st.previous && st.weight < 1) {
    const prev = sampleClip(st.previous.clip, st.previous.time, scratch.b);
    if (st.previous.lower) overlayLower(prev, sampleClip(st.previous.lower, st.previous.lowerTime ?? 0, scratch.lower));
    blendPose(prev, pose, st.weight);
    pose.q.set(prev.q);
    pose.root = [prev.root[0], prev.root[1], prev.root[2]];
    pose.aimR = prev.aimR;
    pose.aimL = prev.aimL;
    pose.bat = prev.bat;
    pose.twoHands = prev.twoHands;
  }
  return pose;
}

// ---------------------------------------------------------------------------------------------------------------
// Headings a body can turn at
// ---------------------------------------------------------------------------------------------------------------

/**
 * Largest heading rate (rad/s) at ground speed v: a standing pivot turns fast (a plant-and-turn, about 7 rad/s), a
 * runner only as fast as his lateral grip allows (ω = a_lat / v, with a_lat about 6.5 m/s², capped).
 */
export function turnRateCap(v: number): number {
  if (v < 0.5) return 7;
  return clamp(6.5 / v, 1.4, 7);
}

// ---------------------------------------------------------------------------------------------------------------
// Two-bone IK in the actor frame (legs and arms)
// ---------------------------------------------------------------------------------------------------------------

const qa: number[] = [0, 0, 0, 1];
const qb: number[] = [0, 0, 0, 1];
const qc: number[] = [0, 0, 0, 1];
const qd: number[] = [0, 0, 0, 1];
const va: number[] = [0, 0, 0];

/** The §9 hinge ranges (deg) of the lower bones: the knee bends at +X, the elbow at −X (MOTION-SPEC §9). */
export const HINGE_RANGE: Readonly<Record<'shin' | 'forearm', readonly [number, number]>> = { shin: [-5, 155], forearm: [-150, 5] };

/**
 * Places the end joint of the chain upper → lower → end at `target` (actor frame, scale 1), blended by `w` from where
 * the pose has it. Hinge-respecting (lead round 6): the lower bone (shin, forearm) turns about its own X only, within
 * its §9 range (HINGE_RANGE), and the upper bone swings and twists to place the end with its hinge plane through the
 * pole (the joint's current offset from the line while clearly bent, else `pole`). The end bone keeps its world
 * orientation (a planted foot stays flat). Updates pose.q; `j` must be the pose's FK and is left stale.
 */
export function twoBoneIK(pose: SampledPose, j: Joints, upper: BoneName, lower: BoneName, end: BoneName, target: readonly [number, number, number], w: number, pole: readonly [number, number, number], poleOnly = false, softFrom = 0.94): void {
  if (w <= 1e-4) return;
  const iu = BONE_INDEX[upper];
  const il = BONE_INDEX[lower];
  const ie = BONE_INDEX[end];
  const P = j.p;
  const Q = j.q;
  const Hx = P[iu * 3];
  const Hy = P[iu * 3 + 1];
  const Hz = P[iu * 3 + 2];
  const Kx = P[il * 3];
  const Ky = P[il * 3 + 1];
  const Kz = P[il * 3 + 2];
  const Ax = P[ie * 3];
  const Ay = P[ie * 3 + 1];
  const Az = P[ie * 3 + 2];
  const Tx = Ax + (target[0] - Ax) * w;
  const Ty = Ay + (target[1] - Ay) * w;
  const Tz = Az + (target[2] - Az) * w;
  const a = Math.hypot(Kx - Hx, Ky - Hy, Kz - Hz);
  const b = Math.hypot(Ax - Kx, Ay - Ky, Az - Kz);
  let nx = Tx - Hx;
  let ny = Ty - Hy;
  let nz = Tz - Hz;
  const dRaw = Math.hypot(nx, ny, nz) || 1e-6;
  nx /= dRaw;
  ny /= dRaw;
  nz /= dRaw;
  // Soft reach: approaching full extension (from softFrom of it) the distance eases in (a straight limb's bend is
  // singular there, and a target swaying across it would snap the knee or elbow).
  const Lmax = a + b - 1e-4;
  const d0 = softFrom * Lmax;
  const d = dRaw <= d0 ? Math.max(dRaw, Math.abs(a - b) + 1e-4) : Lmax - (Lmax - d0) * Math.exp(-(dRaw - d0) / (Lmax - d0));
  // The hinge angle that makes the chain that long, signed the way this joint bends and kept within its range.
  const knee = lower.startsWith('shin');
  const [lo, hi] = HINGE_RANGE[knee ? 'shin' : 'forearm'];
  const bend = (Math.acos(clamp((d * d - a * a - b * b) / (2 * a * b), -1, 1)) * 180) / Math.PI;
  const th = (clamp(knee ? bend : -bend, lo, hi) * Math.PI) / 180;
  // The chain in the upper bone's frame (both bones lie along their −Y at rest): end at u + Rx(θ)·e.
  const cy = -a - b * Math.cos(th);
  const cz = -b * Math.sin(th);
  const cl = Math.hypot(cy, cz) || 1e-6;
  const c0 = 0;
  const c1 = cy / cl;
  const c2 = cz / cl;
  // The joint's offset from the chain line, in that frame (where the knee or elbow points): u − (u·ĉ)ĉ, u = (0, −a, 0).
  let m1 = -a - -a * c1 * c1;
  let m2 = -(-a * c1) * c2;
  let mlL = Math.hypot(m1, m2);
  if (mlL < 1e-6) {
    // Straight: the plane is still the hinge's (local YZ); the knee points forwards (+Z), the elbow backwards (−Z).
    m1 = knee ? -c2 : c2;
    m2 = knee ? c1 : -c1;
    mlL = Math.hypot(m1, m2) || 1;
  }
  m1 /= mlL;
  m2 /= mlL;
  // The pole in the world: the joint's current offset while clearly bent, else `pole`, square to the reach line.
  let mx = Kx - Hx;
  let my = Ky - Hy;
  let mz = Kz - Hz;
  let dot = mx * nx + my * ny + mz * nz;
  mx -= nx * dot;
  my -= ny * dot;
  mz -= nz * dot;
  let ml = Math.hypot(mx, my, mz);
  if (ml < 0.1 * a || poleOnly) {
    mx = pole[0];
    my = pole[1];
    mz = pole[2];
    dot = mx * nx + my * ny + mz * nz;
    mx -= nx * dot;
    my -= ny * dot;
    mz -= nz * dot;
    ml = Math.hypot(mx, my, mz) || 1;
  }
  mx /= ml;
  my /= ml;
  mz /= ml;
  // The upper bone's world rotation: (ĉ, m̂, ĉ×m̂) onto (n̂, p̂, n̂×p̂).
  const lx = [c0, c1, c2];
  const ly = [0, m1, m2];
  const lz = [c1 * m2 - c2 * m1, c2 * 0 - c0 * m2, c0 * m1 - c1 * 0];
  const wx = [nx, ny, nz];
  const wy = [mx, my, mz];
  const wz = [ny * mz - nz * my, nz * mx - nx * mz, nx * my - ny * mx];
  // R = W · Lᵀ (columns W, rows L).
  const R = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let r = 0; r < 3; r++)
    for (let k = 0; k < 3; k++) R[r * 3 + k] = wx[r] * lx[k] + wy[r] * ly[k] + wz[r] * lz[k];
  matToQuat(R, qb); // new upper world
  // The lower bone's world: the upper's, turned about X by θ.
  const hs = Math.sin(th / 2);
  qa[0] = hs;
  qa[1] = 0;
  qa[2] = 0;
  qa[3] = Math.cos(th / 2);
  qmul(qb, 0, qa, 0, qd, 0); // new lower world
  // Back to locals: upper under its parent, lower a pure hinge, end keeping its world orientation.
  const ip = PARENT[iu];
  invInto(Q, ip * 4, qc);
  qmul(qc, 0, qb, 0, pose.q, iu * 4);
  pose.q[il * 4] = qa[0];
  pose.q[il * 4 + 1] = 0;
  pose.q[il * 4 + 2] = 0;
  pose.q[il * 4 + 3] = qa[3];
  invInto(qd, 0, qc);
  qmul(qc, 0, Q, ie * 4, pose.q, ie * 4);
}

/** A unit quaternion (x, y, z, w) of a row-major 3×3 rotation matrix. */
function matToQuat(m: number[], out: number[]) {
  const tr = m[0] + m[4] + m[8];
  let x: number, y: number, z: number, w: number;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s;
    x = (m[7] - m[5]) / s;
    y = (m[2] - m[6]) / s;
    z = (m[3] - m[1]) / s;
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    w = (m[7] - m[5]) / s;
    x = 0.25 * s;
    y = (m[1] + m[3]) / s;
    z = (m[2] + m[6]) / s;
  } else if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    w = (m[2] - m[6]) / s;
    x = (m[1] + m[3]) / s;
    y = 0.25 * s;
    z = (m[5] + m[7]) / s;
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
    w = (m[3] - m[1]) / s;
    x = (m[2] + m[6]) / s;
    y = (m[5] + m[7]) / s;
    z = 0.25 * s;
  }
  const n = Math.hypot(x, y, z, w) || 1;
  out[0] = x / n;
  out[1] = y / n;
  out[2] = z / n;
  out[3] = w / n;
}

function invInto(q: ArrayLike<number>, o: number, out: number[]) {
  out[0] = -q[o];
  out[1] = -q[o + 1];
  out[2] = -q[o + 2];
  out[3] = q[o + 3];
}

// ---------------------------------------------------------------------------------------------------------------
// Body layers that are a pure function of the root path: lean, banking, weight shift
// ---------------------------------------------------------------------------------------------------------------

const G = 9.81;
const STAND_CLIPS = new Set<ClipId>(['idle', 'ready', 'keep_crouch', 'hands_on_hips']);

/**
 * A track's ground position at t: the move's own linear from→to when it has both (no ease, no Hermite `speed`),
 * else evaluateActor. Cheap
 * (binary search), for the layers that sample the root path several times a frame.
 */
export function rootAt(track: ActorTrack, t: number): Vec3 {
  const moves = track.moves;
  let lo = 0;
  let hi = moves.length - 1;
  if (hi < 0) return track.start;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (moves[mid].t0 <= t) lo = mid;
    else hi = mid - 1;
  }
  const m = moves[lo];
  if (!m.from || !m.to || (m.ease && m.ease !== 'linear') || m.speed) return evaluateActor(track, t).pos;
  const u = clamp((t - m.t0) / Math.max(1, m.t1 - m.t0), 0, 1);
  return { x: m.from.x + (m.to.x - m.from.x) * u, y: 0, z: m.from.z + (m.to.z - m.from.z) * u };
}

/** Ground velocity and acceleration of a track around t (world, smoothed over ±0.1 s). */
export function rootMotion(track: ActorTrack, t: number): { vx: number; vz: number; ax: number; az: number } {
  const p = (dt: number) => rootAt(track, t + dt);
  const pm2 = p(-150);
  const pm1 = p(-50);
  const pp1 = p(50);
  const pp2 = p(150);
  const v0x = (pm1.x - pm2.x) / 0.1;
  const v0z = (pm1.z - pm2.z) / 0.1;
  const v1x = (pp2.x - pp1.x) / 0.1;
  const v1z = (pp2.z - pp1.z) / 0.1;
  const vx = (pp1.x - pm1.x) / 0.1;
  const vz = (pp1.z - pm1.z) / 0.1;
  return { vx, vz, ax: (v1x - v0x) / 0.2, az: (v1z - v0z) / 0.2 };
}

/**
 * Lean into acceleration (forward), against braking (back) and into a curve (banked), from the root path; and a slow
 * weight shift between the feet while standing. Adds to the pose in place (before the foot planting).
 */
export function bodyLayers(track: ActorTrack, pose: SampledPose, t: number, clip: ClipId, phase: number, st: ActorState = evaluateActor(track, t), m = rootMotion(track, t), legsOnly = false): void {
  const fx = Math.sin(st.heading);
  const fz = Math.cos(st.heading);
  const lx = Math.cos(st.heading);
  const lz = -Math.sin(st.heading);
  const v = Math.hypot(m.vx, m.vz);
  const aF = m.ax * fx + m.az * fz;
  const aL = m.ax * lx + m.az * lz;
  if (v > 0.4 || Math.abs(aF) > 0.5) {
    const lean = clamp((Math.atan(aF / G) * 180) / Math.PI * 0.55, -9, 9);
    const bank = clamp((Math.atan(aL / G) * 180) / Math.PI * 0.75, -16, 16) * smoothstep(0.8, 3, v);
    if (!legsOnly) addBoneRotation(pose, 'spine', [lean, 0, 0], 1);
    addBoneRotation(pose, 'hips', [lean * 0.4, 0, -bank], 1);
  }
  // A one-shot clip held on its last frame (a celebration's end, a reaction) stands like a hold.
  const held = st.current.clip === clip && !getClip(clip).loop && st.current.time >= clipDuration(clip) - 1e-3;
  if ((STAND_CLIPS.has(clip) || held) && v < 0.25 && !Number.isNaN(phase)) {
    // Weight shift: a slow sway between the feet, each fielder at his own period and phase.
    const period = 3.4 + 1.6 * ((phase * 0.73) % 1);
    const s = Math.sin((2 * Math.PI * t) / 1000 / period + phase * 4.1);
    const s2 = Math.sin((2 * Math.PI * t) / 1000 / (period * 0.53) + phase * 2.3);
    pose.root[0] += 0.03 * s;
    pose.root[1] -= 0.008 * (1 - Math.abs(s));
    addBoneRotation(pose, 'hips', [0, 4 * s2, 3.5 * s], 1);
    if (!legsOnly) {
      addBoneRotation(pose, 'spine', [0.8 * s2, -3 * s2, -2.5 * s], 1);
      addBoneRotation(pose, 'chest', [0.6 * Math.sin((2 * Math.PI * t) / 4200), 0, 0], 1);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Planted feet: a plan built forward in time for one track
// ---------------------------------------------------------------------------------------------------------------

/**
 * Field layer options. `fieldPacks`: whether the field hook draws MOTION's packs at all once registered; off until the
 * pack path measures no worse than the built-in one on every naturalness column (the lead's bar; WEB-FIELD evidence
 * 2026-11-04: it does not yet). `smoothRoot`: the C1 root (measured: at most 0.86 cm from the physics path, no
 * measurable effect; off). `packActionsOnly`: with the packs on, only the stationary or short actions draw from them (the
 * set and ready, pickups and the long barrier, throws, catches, dives, the keeper's crouch, rise, take and dive); all
 * travel (walk in, walk back, runs) and the idles stay on the built-in gait with the feet planted. `packHoldOwnFeet`: a
 * pack hold whose contact bits have both feet down, the body still, draws the clip's own feet (already planted in the
 * clip) with no planting over them. Then whether runs are drawn with the pack's gait loops (else the built-in smooth gait, the packs still
 * drawing the holds, the set, the walk in and the walk back), whether the planted-foot layer also pins a pack gait
 * loop's stance (the built-in loops are always pinned), and whether runs from and to standing use the pack's sprint
 * start and stop (distance-matched). Read when a script's moves and hook are made. `packGaits` is off for now:
 * measured on the physics corpus, the pack run loops under the stance pinning still pop at the drive-to-run hand-off
 * (WEB-FIELD evidence, 2026-11-04), so runs keep the smooth built-in gait while everything else draws from the packs.
 */
export const PLAN_OPTIONS = { fieldPacks: false, packActionsOnly: true, packGaits: false, packGaitIK: true, packStartStop: true, smoothRoot: false, packHoldOwnFeet: false, stepPlan: true };

/** Plan sample rate (Hz) and the step a dragged foot takes (s, lift m), the drift that triggers it (m, rad). */
const PLANT = { hz: 30, stepS: 0.24, liftM: 0.07, driftM: 0.2, driftYaw: 0.6, plantInS: 0.15, releaseS: 0.09, contactY: 0.135, swingVz: 0.25 } as const;

/**
 * A foot's place in its gait cycle at phase `phase` (0 = this foot's strike in the cycle's own timing) and speed v
 * (m/s, scale 1). The windows follow the gait cycles' own feet (the part of the cycle where the foot is low and moving
 * back under the hips): half the cycle walking (the loops' double support is short), about a quarter running.
 */
function gaitFoot(phase: number, v: number): { stance: boolean; p: number } {
  const u = smoothstep(1.4, 5.7, v);
  const start = 0.06 * u;
  const duty = 0.5 - 0.26 * u;
  const q = (((phase - start) % 1) + 1) % 1;
  return q < duty ? { stance: true, p: q / duty } : { stance: false, p: (q - duty) / (1 - duty) };
}

/** Swing-foot clearance at mid-swing (m, scale 1): the ankle never skims the turf. */
const swingClearance = (v: number): number => 0.06 + 0.06 * smoothstep(1.4, 5.7, v);

type FootState = 0 | 1 | 2 | 3; // free, planted, stepping, a gait's swing
/** Holds whose feet stay where they are (the plan may skip its samples while the body stands still in one). */
const HOLD_PLANT = new Set<ClipId>(['idle', 'ready', 'keep_crouch', 'hands_on_hips', 'hands_on_head', 'clap']);
interface FootRun {
  state: FootState;
  /** Plant (world). */
  px: number;
  pz: number;
  yaw: number;
  /** Weight of the plant (ramps in at a landing, out at a lift). */
  w: number;
  /** Step: from, to (world), start time (s). */
  fx: number;
  fz: number;
  tx: number;
  tz: number;
  t0: number;
  /** Step start height (world) and the step's length (s). */
  fy: number;
  dur: number;
  /** Last target given (world). */
  ox: number;
  oy: number;
  oz: number;
  /** Pack stance: which shoe point is pinned (0 heel, 1 ball, 2 tip; -1 none), the correction it needs (world), lift-off. */
  pinK: number;
  dx: number;
  dy: number;
  dz: number;
  liftT: number;
  /** Previous local ankle (for the swing direction). */
  lz: number;
  ly: number;
}

/**
 * The planted-foot plan of one track: per plan sample, for each foot, a world target (x, y, z) and its weight.
 * Advanced forward on demand from `anchor` (scene ms), so it is a pure function of the track.
 */
export class FootPlan {
  private readonly data: Float32Array[] = [];
  private computed = 0;
  private readonly feet: [FootRun, FootRun];
  private readonly joints = createJoints();
  constructor(
    readonly track: ActorTrack,
    readonly anchor: number,
    readonly scale: number,
    /** The base pose the stage draws before planting (so the plan sees the same ankles). */
    private readonly base: (t: number) => { pose: SampledPose; st: ActorState; gait: { phase: number; v: number } | null; contacts?: number },
  ) {
    const free = (): FootRun => ({ state: 0, px: 0, pz: 0, yaw: 0, w: 0, fx: 0, fz: 0, tx: 0, tz: 0, t0: 0, fy: 0, dur: PLANT.stepS, ox: 0, oy: 0, oz: 0, pinK: -1, dx: 0, dy: 0, dz: 0, liftT: -Infinity, lz: 0, ly: 1 });
    this.feet = [free(), free()];
  }

  /** The clip ankles (world) and the actor state at t, with the body layers applied. */
  private sample(t: number): { L: Vec3; R: Vec3; lL: Vec3; lR: Vec3; heading: number; gait: { phase: number; v: number } | null; contacts?: number; shoe: [Vec3[], Vec3[]] } {
    const { pose, st, gait, contacts } = this.base(t);
    forwardKinematics(pose, this.joints);
    const root = { x: st.pos.x + (st.body?.x ?? 0), y: 0, z: st.pos.z + (st.body?.z ?? 0) };
    const j = this.joints;
    // The shoe's heel, ball and tip (world), for pinning the point that touches the ground.
    const shoe = (['footL', 'footR'] as const).map((b) => {
      const i = BONE_INDEX[b];
      return SHOE_POINTS.map((o) => {
        rotate(j.q, i * 4, o[0], o[1], o[2], va, 0);
        return localToWorld(j.p[i * 3] + va[0], j.p[i * 3 + 1] + va[1], j.p[i * 3 + 2] + va[2], root, st.heading, this.scale);
      });
    }) as [Vec3[], Vec3[]];
    const li = BONE_INDEX.footL * 3;
    const ri = BONE_INDEX.footR * 3;
    return {
      L: jointWorld(j, 'footL', root, st.heading, this.scale),
      R: jointWorld(j, 'footR', root, st.heading, this.scale),
      lL: { x: j.p[li], y: j.p[li + 1], z: j.p[li + 2] },
      lR: { x: j.p[ri], y: j.p[ri + 1], z: j.p[ri + 2] },
      heading: st.heading,
      gait,
      shoe,
      ...(contacts !== undefined ? { contacts } : {}),
    };
  }

  private advanceTo(k: number) {
    const dt = 1 / PLANT.hz;
    const ground = ANKLE_REST_Y * this.scale;
    while (this.computed <= k) {
      const i = this.computed;
      const t = this.anchor + (i * 1000) / PLANT.hz;
      const ts = t / 1000;
      if (i > 0 && this.still(t)) {
        // Planted and standing still in a hold, not turning: nothing can change (part of the plan's definition, so
        // it holds whenever the plan is built). The ankles' last local positions are unknown after it (no swing).
        this.data.push(this.data[i - 1]);
        this.feet[0].lz = Number.NaN;
        this.feet[1].lz = Number.NaN;
        this.computed++;
        continue;
      }
      const sm = this.sample(t);
      const out = new Float32Array(10);
      out[8] = Number.NaN;
      out[9] = Number.NaN;
      for (let f = 0; f < 2; f++) {
        const foot = this.feet[f];
        const other = this.feet[1 - f];
        const clip = f === 0 ? sm.L : sm.R;
        const local = f === 0 ? sm.lL : sm.lR;
        const vz = i === 0 || Number.isNaN(foot.lz) ? 0 : (local.z - foot.lz) * PLANT.hz * this.scale;
        // In a gait the stance is the cycle's (by phase: the foot lands ahead of the hips and leaves behind them);
        // otherwise a foot is down while the clip keeps it low and not swinging forward.
        const gait = sm.gait;
        foot.lz = local.z;
        foot.ly = local.y;
        if (gait && sm.contacts !== undefined) {
          // A pack gait loop: its shoe rolls heel → flat → tip while the contact bit is set, so the ankle travels and
          // the point touching the ground does not (MOTION-SPEC §9). Pin that point where it first touched: the ankle
          // target is the clip's ankle moved by that point's drift; a hand-over between points carries the correction
          // on, and after lift-off the correction fades out over 0.1 s.
          const pts = sm.shoe[f];
          const down = (sm.contacts & (f === 0 ? 1 : 2)) !== 0;
          let low = 0;
          for (let q = 1; q < 3; q++) if (pts[q].y < pts[low].y) low = q;
          if (down) {
            if (foot.pinK < 0) {
              foot.pinK = low;
              foot.dx = 0;
              foot.dy = 0;
              foot.dz = 0;
            } else if (low !== foot.pinK) foot.pinK = low;
            else {
              // The pinned point's own drift in the clip since the last sample adds to the correction.
              foot.dx -= pts[low].x - foot.px;
              foot.dz -= pts[low].z - foot.pz;
            }
            foot.px = pts[low].x;
            foot.pz = pts[low].z;
            foot.liftT = ts;
          } else {
            foot.pinK = -1;
            const k = 1 - smoothstep(0, 0.1, ts - foot.liftT);
            foot.dx *= k > 0 ? 1 : 0;
            foot.dz *= k > 0 ? 1 : 0;
            if (k <= 0) {
              foot.dx = 0;
              foot.dz = 0;
            }
          }
          const fade = down ? 1 : 1 - smoothstep(0, 0.1, ts - foot.liftT);
          foot.state = down ? 1 : 3;
          foot.w = Math.min(1, foot.w + dt / 0.04);
          out[f * 4] = clip.x + foot.dx * fade;
          out[f * 4 + 1] = clip.y;
          out[f * 4 + 2] = clip.z + foot.dz * fade;
          out[f * 4 + 3] = PLAN_OPTIONS.packGaitIK ? foot.w : 0;
          foot.ox = out[f * 4];
          foot.oy = out[f * 4 + 1];
          foot.oz = out[f * 4 + 2];
          continue;
        }
        if (gait) {
          // A stepping cycle: planted through the stance; in the swing the foot leaves its plant, catches up with the
          // cycle's own foot, clears the turf, and comes down to land at the next plant.
          const g = gaitFoot(gait.phase + f * 0.5, gait.v);
          // A pack loop says itself which foot is down (its contact bits); the built-in loops by phase.
          if (sm.contacts !== undefined) g.stance = (sm.contacts & (f === 0 ? 1 : 2)) !== 0;
          if (g.stance) {
            if (foot.state !== 1) {
              foot.state = 1;
              foot.px = clip.x;
              foot.pz = clip.z;
              foot.yaw = sm.heading;
            }
            foot.w = Math.min(1, foot.w + dt / 0.06);
            out[f * 4] = foot.px;
            // A pack clip's own foot height is authored (on the toes, the heel lifting at toe-off): kept. The built-in
            // loops float or sink a few centimetres: put on the turf.
            out[f * 4 + 1] = sm.contacts !== undefined ? Math.max(ground - 0.01 * this.scale, clip.y) : ground;
            out[f * 4 + 2] = foot.pz;
          } else {
            if (foot.state !== 3) {
              if (foot.state !== 1) {
                foot.px = clip.x;
                foot.pz = clip.z;
              }
              foot.fy = foot.oy;
              foot.t0 = ts;
              foot.state = 3;
            }
            foot.w = Math.min(1, foot.w + dt / 0.06);
            if (sm.contacts !== undefined) {
              // A pack loop's swing (its own clearance): the foot leaves its plant and joins the clip's foot over 0.12 s.
              const k = smoothstep(0, 0.12, ts - foot.t0);
              out[f * 4] = foot.px + (clip.x - foot.px) * k;
              out[f * 4 + 1] = foot.fy + (clip.y - foot.fy) * k;
              out[f * 4 + 2] = foot.pz + (clip.z - foot.pz) * k;
              out[f * 4 + 3] = foot.w;
              foot.ox = out[f * 4];
              foot.oy = out[f * 4 + 1];
              foot.oz = out[f * 4 + 2];
              continue;
            }
            // The swing follows the cycle's own foot, clear of the turf and down to the next landing; the leg's way out
            // of the plant is the hook's inertialized release (out[8 + f]: the lift-off time), never a snapping target.
            const lift = Math.max(clip.y, ground + swingClearance(gait.v) * this.scale * Math.sin(Math.PI * g.p));
            out[f * 4] = clip.x;
            out[f * 4 + 1] = lift + (ground - lift) * smoothstep(0.8, 1, g.p);
            out[f * 4 + 2] = clip.z;
            // The last stance sample (one plan step before the first swing one): the leg's planted shape then.
            out[8 + f] = (foot.t0 - dt) * 1000;
          }
          out[f * 4 + 3] = foot.w;
          foot.ox = out[f * 4];
          foot.oy = out[f * 4 + 1];
          foot.oz = out[f * 4 + 2];
          continue;
        }
        if (foot.state === 3) {
          // Out of a gait in mid-swing: the foot finishes with a short step from where it is to where the clip has it.
          foot.state = 2;
          foot.fx = foot.ox;
          foot.fy = foot.oy;
          foot.fz = foot.oz;
          foot.tx = clip.x;
          foot.tz = clip.z;
          foot.t0 = ts;
          foot.dur = 0.2;
          foot.yaw = sm.heading;
        }
        const contact = sm.contacts !== undefined ? (sm.contacts & (f === 0 ? 1 : 2)) !== 0 : local.y < PLANT.contactY && vz < PLANT.swingVz;
        const rampIn = PLANT.plantInS;
        const rampOut = PLANT.releaseS;
        if (foot.state === 0) {
          if (contact) {
            // Landing (at the anchor a foot already down starts planted: the hook fades the layer in from there).
            foot.state = 1;
            foot.px = clip.x;
            foot.pz = clip.z;
            foot.yaw = sm.heading;
            foot.w = i === 0 ? 1 : 0;
          } else foot.w = Math.max(0, foot.w - dt / rampOut);
        }
        if (foot.state === 1) {
          if (!contact) {
            foot.state = 0;
            foot.w = Math.max(0, foot.w - dt / rampOut);
          } else {
            foot.w = Math.min(1, foot.w + dt / rampIn);
            const drift = Math.hypot(clip.x - foot.px, clip.z - foot.pz);
            const twist = Math.abs(angleDelta(foot.yaw, sm.heading));
            if ((drift > PLANT.driftM * this.scale || twist > PLANT.driftYaw) && other.state !== 2) {
              // A step: from the plant to where the body will want the foot when it lands.
              const ahead = this.sample(t + PLANT.stepS * 1000);
              const to = f === 0 ? ahead.L : ahead.R;
              foot.state = 2;
              foot.fx = foot.px;
              foot.fz = foot.pz;
              foot.tx = to.x;
              foot.tz = to.z;
              foot.t0 = ts;
              foot.fy = ground;
              foot.dur = PLANT.stepS;
              foot.yaw = ahead.heading;
            }
          }
        }
        let tx = foot.px;
        let ty = sm.contacts !== undefined && foot.state === 1 ? Math.max(ground - 0.01 * this.scale, clip.y) : ground;
        let tz = foot.pz;
        if (foot.state === 2) {
          const u = clamp((ts - foot.t0) / foot.dur, 0, 1);
          const e = u * u * (3 - 2 * u);
          tx = foot.fx + (foot.tx - foot.fx) * e;
          tz = foot.fz + (foot.tz - foot.fz) * e;
          ty = foot.fy + (ground - foot.fy) * e + PLANT.liftM * this.scale * Math.sin(Math.PI * u) * (foot.fy > ground + 0.01 ? 0.4 : 1);
          foot.w = 1;
          if (u >= 1) {
            foot.state = contact ? 1 : 0;
            foot.px = foot.tx;
            foot.pz = foot.tz;
          }
        }
        out[f * 4] = tx;
        out[f * 4 + 1] = ty;
        out[f * 4 + 2] = tz;
        out[f * 4 + 3] = foot.w;
        foot.ox = tx;
        foot.oy = ty;
        foot.oz = tz;
      }
      this.data.push(out);
      this.computed++;
    }
  }

  /** Both feet planted at full weight, in a hold with no cross-fade, the root not moving and the body not turned. */
  private still(t: number): boolean {
    const [a, b] = this.feet;
    if (a.state !== 1 || b.state !== 1 || a.w < 1 || b.w < 1) return false;
    const st = evaluateActor(this.track, t);
    if (st.previous || st.current.lower || !HOLD_PLANT.has(st.current.clip)) return false;
    if (Math.abs(angleDelta(a.yaw, st.heading)) > 0.3 || Math.abs(angleDelta(b.yaw, st.heading)) > 0.3) return false;
    const p0 = rootAt(this.track, t - 200);
    const p1 = rootAt(this.track, t + 200);
    return Math.abs(p0.x - st.pos.x) + Math.abs(p0.z - st.pos.z) + Math.abs(p1.x - st.pos.x) + Math.abs(p1.z - st.pos.z) < 1e-9;
  }

  /** Targets at scene time t (null before the anchor): [Lx, Ly, Lz, Lw, Rx, Ry, Rz, Rw, L lift-off, R lift-off], world, scene ms. */
  at(t: number, out: Float32Array): Float32Array | null {
    if (t < this.anchor) return null;
    const f = ((t - this.anchor) * PLANT.hz) / 1000;
    const k = Math.floor(f);
    // A long seek forward is built in one go; the plan never has to be rebuilt.
    this.advanceTo(k + 1);
    const a = this.data[k];
    const b = this.data[k + 1];
    const u = f - k;
    for (let i = 0; i < 8; i++) out[i] = a[i] + (b[i] - a[i]) * u;
    // Lift-off times are not interpolated: the later sample's, when it has one.
    out[8] = Number.isNaN(b[8]) ? a[8] : b[8];
    out[9] = Number.isNaN(b[9]) ? a[9] : b[9];
    // A step's start or a landing is never interpolated across a jump in the weight's meaning.
    return out;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Applying the plan, the head and the hands
// ---------------------------------------------------------------------------------------------------------------

const KNEE_POLE: readonly [number, number, number] = [0, 0, 1];
/** The shoe's heel, ball and tip in the foot bone's frame (canonical metres; MOTION-SPEC §9). */
const SHOE_POINTS: ReadonlyArray<readonly [number, number, number]> = [
  [0, -0.065, -0.05],
  [0, -0.065, 0.135],
  [0, -0.065, 0.2],
];
const ELBOW_POLE_L: readonly [number, number, number] = [0.6, -0.5, -0.4];
const ELBOW_POLE_R: readonly [number, number, number] = [-0.6, -0.5, -0.4];

/** Plants the feet of `pose` on the plan's targets (world) for an actor at root/heading/scale. */
export function plantFeet(pose: SampledPose, j: Joints, targets: Float32Array, root: Vec3, heading: number, scale: number): void {
  forwardKinematics(pose, j);
  const L = -OFFSET[BONE_INDEX.shinL][1] - OFFSET[BONE_INDEX.footL][1] - 0.004;
  const local: Array<Vec3 | null> = [null, null];
  // Drop the hips a little (at most 8 cm) rather than lift a planted foot that is under them.
  let drop = 0;
  for (let f = 0; f < 2; f++) {
    const w = targets[f * 4 + 3];
    if (w <= 1e-3) continue;
    const l = worldToLocal({ x: targets[f * 4], y: targets[f * 4 + 1], z: targets[f * 4 + 2] }, root, heading, scale);
    local[f] = l;
    const hi = BONE_INDEX[f === 0 ? 'thighL' : 'thighR'] * 3;
    const r = Math.hypot(l.x - j.p[hi], l.z - j.p[hi + 2]);
    // Only a foot under the hips holds them down (fading out by 0.4 m ahead or behind: no step in the hips' height).
    const k = w * (1 - smoothstep(0.2, 0.4, r));
    if (k <= 0) continue;
    const d = Math.hypot(r, l.y - j.p[hi + 1]);
    drop = Math.max(drop, (d - L) * k);
  }
  if (drop > 0) {
    // Softly limited to 8 cm.
    pose.root[1] -= 0.08 * (1 - Math.exp(-drop / 0.08));
    forwardKinematics(pose, j);
  }
  for (let f = 0; f < 2; f++) {
    const l = local[f];
    const w = targets[f * 4 + 3];
    if (!l || w <= 1e-3) continue;
    // A leg reaching far ahead or behind lifts the heel (the ankle rises, the forefoot stays): the target's height is
    // raised to what a straight leg reaches, at most 0.2 m above the ground.
    const hi = BONE_INDEX[f === 0 ? 'thighL' : 'thighR'] * 3;
    const r = Math.hypot(l.x - j.p[hi], l.z - j.p[hi + 2]);
    const need = r < L ? j.p[hi + 1] - Math.sqrt(L * L - r * r) : j.p[hi + 1];
    l.y = Math.max(l.y, Math.min(l.y + 0.2, need));
    const side = f === 0 ? 'L' : 'R';
    const bones = [BONE_INDEX[`thigh${side}`], BONE_INDEX[`shin${side}`], BONE_INDEX[`foot${side}`]];
    // A part weight blends the whole leg's rotations, as plantFeetLocked does (round 8): the IK's soft reach bends a straight
    // leg about 24° whatever the weight, so engaging a leg the first frame its weight is above 0 snapped both shins 22° in
    // one frame (1,339°/s against the 1,200°/s cap). The leg is solved to the whole target, then eased in by w.
    if (w < 1) for (let b = 0; b < 3; b++) for (let k = 0; k < 4; k++) legKeep[b * 4 + k] = pose.q[bones[b] * 4 + k];
    // Knees bend forward, the way the hips face (stable through a straight leg).
    rotate(j.q, 0, KNEE_POLE[0], KNEE_POLE[1], KNEE_POLE[2], kneePole, 0);
    twoBoneIK(pose, j, `thigh${side}`, `shin${side}`, `foot${side}`, [l.x, l.y, l.z], w < 1 ? 1 : w, kneePole, true);
    if (w < 1) blendLegRotations(pose.q, bones, w);
    forwardKinematics(pose, j);
  }
}
const kneePole: [number, number, number] = [0, 0, 1];

/** The leg's three bones' rotations (thigh, shin, foot) a weight w of the way from `legKeep` to what the pose has now. */
function blendLegRotations(q: Float32Array, bones: readonly number[], w: number): void {
  for (let b = 0; b < 3; b++) {
    const o = bones[b] * 4;
    const dot = q[o] * legKeep[b * 4] + q[o + 1] * legKeep[b * 4 + 1] + q[o + 2] * legKeep[b * 4 + 2] + q[o + 3] * legKeep[b * 4 + 3];
    const sg = dot < 0 ? -1 : 1;
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const v = legKeep[b * 4 + k] + (sg * q[o + k] - legKeep[b * 4 + k]) * w;
      q[o + k] = v;
      n += v * v;
    }
    n = Math.sqrt(n) || 1;
    for (let k = 0; k < 4; k++) q[o + k] /= n;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Footsteps (round 7): every foot on the turf is locked in the world, position and orientation, from its landing to its
// lift; between them it swings from one footstep to the next
// ---------------------------------------------------------------------------------------------------------------

/**
 * Footstep constants (s; m at scale 1; rad). The plan samples the base pose at `hz` (looking ahead as far as a decision
 * needs: the next landing and where it goes). A foot off the turf longer than `maxSwingS` is free (the clip's
 * own leg, a dive or a jump); a lift shorter than `flickerS` landing within `flickerM` is no lift. A standing foot the
 * body has left (`driftM`, `driftYaw`) steps (`stepS` long, `stepLiftM` high) once the other foot has stood `settleS`.
 */
const STEP = {
  hz: 30,
  maxSwingS: 0.62,
  maxGaitSwingS: 1.1,
  flickerS: 0.07,
  flickerM: 0.05,
  driftM: 0.13,
  driftYaw: 0.42,
  stepS: 0.24,
  stepLiftM: 0.055,
  settleS: 0.08,
  stepLeadS: 0.15,
  /** A gait's footstep lands at most this far ahead of its hip (m; a near-straight leg's reach). */
  landAheadM: 0.32,
  /** The shortest swing outside a gait (a quicker lift is drawn as a step this long). */
  minSwingS: 0.2,
  /** A clip's foot is down within this of the turf (shoe's lowest point, m). */
  downM: 0.075,
  holdPlaceS: 0.1,
  longPlaceS: 0.15,
  freeRampS: 0.2,
  /** Hip-to-ankle distance kept on a planted leg (share of the leg; the knee about 36° bent) and the IK's soft reach. */
  reach: 0.95,
  soft: 0.96,
  /** The pelvis lowers exactly up to `dropExactM` for a foot's reach, then softly to `dropExactM + dropSoftM`. */
  dropExactM: 0.08,
  dropSoftM: 0.1,
} as const;

/** A StepPlan's targets per foot: ankle x, y, z (world), IK weight, yaw, pitch and pelvis-drop cap. */
export const STEP_STRIDE = 7;

/** The shoe's heel and tip from the ankle (canonical m; the sole 6.5 cm under the ankle). */
const HEEL_Z = -0.05;
/** Hip joint to ankle, the leg's full length (m, scale 1). */
const LEG = -OFFSET[BONE_INDEX.shinL][1] - OFFSET[BONE_INDEX.footL][1];
const TIP_Z = 0.2;
const SOLE_Y = 0.065;

/** One foot's pose: the ankle (world), the shoe's yaw (world, its toe along (sin, cos)) and pitch (rad, + heel up). */
interface FootPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}
/** A footstep: the shoe flat at (x, z) (its ankle there), yaw and base pitch, t0 to t1 (Infinity while it stands). */
interface StancePh {
  k: 0;
  t0: number;
  t1: number;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  /** A gait stance rolls heel to toe over [t0, t1e] (the stance's expected end) at speed v. */
  roll: boolean;
  t1e: number;
  v: number;
}
interface SwingPh {
  k: 1;
  t0: number;
  t1: number;
  a: FootPose;
  b: FootPose;
  clear: number;
  /** A gait's swing follows the cycle's own foot between its ends (offset onto them); its own ankle at t0 and t1. */
  gait: boolean;
  /** The gait's speed (m/s, scale 1). */
  v: number;
  cax: number;
  caz: number;
  cbx: number;
  cbz: number;
  /** Pelvis drop needed at toe-off and landing; the airborne target may not exceed their smooth interpolation. */
  dropA: number;
  dropB: number;
}
interface FreePh {
  k: 2;
  t0: number;
  t1: number;
  a: FootPose;
  b: FootPose | null;
}
type StepPhase = StancePh | SwingPh | FreePh;

/** One plan sample: the base pose's feet (world) and whether each is on the turf. */
interface RawFoot {
  /** The clip's ankle (world). */
  x: number;
  y: number;
  z: number;
  /** Where its ankle would stand were its shoe flat on the turf under its toe (pitched heel-up) or heel. */
  fx: number;
  fz: number;
  yaw: number;
  pitch: number;
  /** The shoe's lowest point above the turf (m, world). */
  lift: number;
  contact: boolean;
  /** Local ankle (for the clip's own foot speed). */
  lx: number;
  lz: number;
  /** The hip joint (world). */
  hx: number;
  hy: number;
  hz: number;
}
interface RawSample {
  t: number;
  /** Gait speed (m/s, scale 1) and phase, NaN when not stepping; whether the stepping is the built-in phase's. */
  v: number;
  phase: number;
  builtinGait: boolean;
  heading: number;
  feet: [RawFoot, RawFoot];
}



/** The heel strike (rad, toe up), the heel-off (rad) and where in the stance it starts, at speed v (m/s). */
const strikePitch = (v: number): number => -0.09 * (1 - smoothstep(2, 5, v));
const offPitch = (v: number): number => 0.26 + 0.6 * smoothstep(1.5, 7, v);
const offFrom = (v: number): number => 0.55 - 0.25 * smoothstep(1.5, 7, v);
/** The footsteps' stance share of a gait cycle (shorter than the loops' own at speed: a sprinter's foot is down briefly). */
const stepDuty = (v: number): number => 0.5 - 0.31 * smoothstep(1.4, 7, v);
/** Where a gait footstep lands: the cycle's own foot this far into the stance (a runner lands under himself). */
const placeShare = (v: number): number => 0.5 - 0.18 * smoothstep(2, 6.5, v);
/** A foot's place in the gait cycle for the footsteps (gaitFoot's windows, the stance share stepDuty). */
function stepFoot(phase: number, v: number): { stance: boolean; p: number } {
  const u = smoothstep(1.4, 5.7, v);
  const start = 0.06 * u;
  const duty = stepDuty(v);
  const q = (((phase - start) % 1) + 1) % 1;
  return q < duty ? { stance: true, p: q / duty } : { stance: false, p: (q - duty) / (1 - duty) };
}

/**
 * The footstep plan of one track: each foot's stances (locked: position, yaw and pitch, rolling heel to toe in a gait),
 * swings (from one footstep to the next, clear of the turf, the horizontal travel inside the vertical) and free spells.
 * Built forward on demand from `anchor` (scene ms), so it is a pure function of the track; `at` evaluates it at any t.
 */
export class StepPlan {
  private readonly raw: RawSample[] = [];
  private readonly ph: [StepPhase[], StepPhase[]] = [[], []];
  /** Per foot, the next raw index whose decision is pending. */
  private readonly next = [0, 0];
  private decided = 0;
  private readonly j = createJoints();
  private readonly dtMs = 1000 / STEP.hz;
  constructor(
    readonly track: ActorTrack,
    readonly anchor: number,
    readonly scale: number,
    private readonly base: (t: number) => { pose: SampledPose; st: ActorState; gait: { phase: number; v: number } | null; contacts?: number },
  ) {}

  private tOf(i: number): number {
    return this.anchor + i * this.dtMs;
  }

  private rawAt(i: number): RawSample {
    while (this.raw.length <= i) this.raw.push(this.sample(this.raw.length));
    return this.raw[i];
  }

  private sample(i: number): RawSample {
    const t = this.tOf(i);
    const { pose, st, gait, contacts } = this.base(t);
    const j = forwardKinematics(pose, this.j);
    const root = { x: st.pos.x + (st.body?.x ?? 0), y: 0, z: st.pos.z + (st.body?.z ?? 0) };
    const s = this.scale;
    const prev = i > 0 ? this.raw[i - 1] : null;
    const feet = [0, 1].map((f) => {
      const bi = BONE_INDEX[f === 0 ? 'footL' : 'footR'];
      const lx = j.p[bi * 3];
      const ly = j.p[bi * 3 + 1];
      const lz = j.p[bi * 3 + 2];
      const A = localToWorld(lx, ly, lz, root, st.heading, s);
      rotate(j.q, bi * 4, 0, 0, 1, va, 0);
      const yaw = st.heading + Math.atan2(va[0], va[2]);
      const pitch = Math.atan2(-va[1], Math.hypot(va[0], va[2]));
      // The shoe's heel and tip (world heights) and the flat stand under the pivot it would roll on.
      rotate(j.q, bi * 4, 0, -SOLE_Y, HEEL_Z, vb, 0);
      const heelY = (ly + vb[1]) * s;
      const heel = localToWorld(lx + vb[0], 0, lz + vb[2], root, st.heading, s);
      rotate(j.q, bi * 4, 0, -SOLE_Y, TIP_Z, vb, 0);
      const tipY = (ly + vb[1]) * s;
      const tip = localToWorld(lx + vb[0], 0, lz + vb[2], root, st.heading, s);
      const dx = Math.sin(yaw);
      const dz = Math.cos(yaw);
      const fx = pitch >= 0 ? tip.x - dx * TIP_Z * s : heel.x - dx * HEEL_Z * s;
      const fz = pitch >= 0 ? tip.z - dz * TIP_Z * s : heel.z - dz * HEEL_Z * s;
      const lift = Math.max(0, Math.min(heelY, tipY));
      let contact: boolean;
      if (gait && contacts === undefined) contact = stepFoot(gait.phase + f * 0.5, gait.v).stance;
      else if (contacts !== undefined) contact = (contacts & (f === 0 ? 1 : 2)) !== 0;
      else {
        // A clip's foot is down while its shoe is near the turf and not travelling (its own speed under the hips).
        const pf = prev?.feet[f];
        const sp = pf ? Math.hypot(lx - pf.lx, lz - pf.lz) * STEP.hz : 0;
        contact = lift < STEP.downM * s && sp < 2;
      }
      const H = jointWorld(j, f === 0 ? 'thighL' : 'thighR', root, st.heading, s);
      return { x: A.x, y: A.y, z: A.z, fx, fz, yaw, pitch, lift, contact, lx, lz, hx: H.x, hy: H.y, hz: H.z };
    }) as [RawFoot, RawFoot];
    return { t, v: gait ? gait.v : Number.NaN, phase: gait ? gait.phase : Number.NaN, builtinGait: Boolean(gait) && contacts === undefined, heading: st.heading, feet };
  }

  /** Linear between samples (yaw the short way): the clip foot's flat stand, yaw, pitch, lift and ankle at t. */
  private rawFootAt(f: number, t: number): RawFoot {
    const x = (t - this.anchor) / this.dtMs;
    const i = Math.max(0, Math.floor(x));
    const u = clamp(x - i, 0, 1);
    const a = this.rawAt(i).feet[f];
    const b = this.rawAt(i + 1).feet[f];
    const L = (p: number, q: number) => p + (q - p) * u;
    // Positions through four samples (Catmull-Rom: a swinging foot's arc, not a polygon).
    const p0 = this.rawAt(Math.max(0, i - 1)).feet[f];
    const p3 = this.rawAt(i + 2).feet[f];
    const u2 = u * u;
    const u3 = u2 * u;
    const C = (m: number, q0: number, q1: number, q2: number) => 0.5 * (2 * q0 + (q1 - m) * u + (2 * m - 5 * q0 + 4 * q1 - q2) * u2 + (3 * q0 - m - 3 * q1 + q2) * u3);
    return { x: C(p0.x, a.x, b.x, p3.x), y: L(a.y, b.y), z: C(p0.z, a.z, b.z, p3.z), fx: C(p0.fx, a.fx, b.fx, p3.fx), fz: C(p0.fz, a.fz, b.fz, p3.fz), yaw: a.yaw + angleDelta(a.yaw, b.yaw) * u, pitch: L(a.pitch, b.pitch), lift: L(a.lift, b.lift), contact: a.contact, lx: a.lx, lz: a.lz, hx: L(a.hx, b.hx), hy: L(a.hy, b.hy), hz: L(a.hz, b.hz) };
  }

  /** Pelvis drop (actor-frame metres) needed to put this ankle within the leg's non-singular reach at t. */
  private dropNeed(f: number, t: number, foot: FootPose): number {
    const hip = this.rawFootAt(f, t);
    const s = this.scale;
    const h = hip.hy - foot.y;
    const d = Math.hypot(foot.x - hip.hx, h, foot.z - hip.hz);
    const reach = STEP.reach * LEG * s;
    return d > reach ? ((d - reach) * d) / (s * Math.max(h, 0.35 * s)) : 0;
  }

  /** A foot down at raw j and j + 1 (a one-sample touch is no landing). */
  private down(f: number, j: number): boolean {
    return this.rawAt(j).feet[f].contact && this.rawAt(j + 1).feet[f].contact;
  }

  /** The stance landing at raw j (at tLand): where the shoe goes and how it rolls. */
  private place(f: number, j: number, tLand: number): StancePh {
    const r = this.rawAt(j);
    let tPlace: number;
    let roll = false;
    let t1e = Infinity;
    const v = Number.isFinite(r.v) ? r.v : 0;
    if (r.builtinGait) {
      // A gait's footstep goes where the cycle's own foot is at mid-stance (the stance's end from the phase's rate).
      const g = stepFoot(r.phase + f * 0.5, r.v);
      const r1 = this.rawAt(j + 1);
      let dp = r1.phase - r.phase;
      if (dp < 0) dp += 1;
      const rate = dp * STEP.hz;
      const left = rate > 1e-3 && g.stance ? ((1 - g.p) * stepDuty(r.v)) / rate : 0.3;
      t1e = r.t + Math.min(0.8, Math.max(0.05, left)) * 1000;
      tPlace = tLand + (t1e - tLand) * placeShare(r.v);
      roll = true;
    } else if (Number.isFinite(r.v)) {
      // A pack's stepping loop: mid-stance by its own contact bits (or a little after the landing for a long stance).
      let k = j;
      const lim = j + Math.round(0.6 * STEP.hz);
      while (k < lim && this.rawAt(k + 1).feet[f].contact) k++;
      tPlace = k < lim ? (tLand + this.tOf(k) + this.dtMs / 2) / 2 : tLand + STEP.longPlaceS * 1000;
    } else tPlace = tLand + STEP.holdPlaceS * 1000;
    const p = this.rawFootAt(f, tPlace);
    let x = p.fx;
    let z = p.fz;
    if (Number.isFinite(r.v)) {
      // Never landing beyond a near-straight leg's reach ahead of the hip (the heel-off reaches the rest behind).
      const hl = this.rawFootAt(f, tLand);
      const s = this.scale;
      const fwx = Math.sin(r.heading);
      const fwz = Math.cos(r.heading);
      const ahead = (x - hl.hx) * fwx + (z - hl.hz) * fwz;
      const F = Math.max(STEP.landAheadM * s, 0.9 * Math.sqrt(Math.max(0, (STEP.reach * LEG * s) ** 2 - (hl.hy - SOLE_Y * s) ** 2)));
      if (ahead > F) {
        x -= (ahead - F) * fwx;
        z -= (ahead - F) * fwz;
      }
    }
    return { k: 0, t0: tLand, t1: Infinity, x, z, yaw: p.yaw, pitch: roll ? 0 : clamp(p.pitch, -0.1, 0.6), roll, t1e, v };
  }

  /** The stance's shoe at t: rolling on its heel (pitched toe-up) or its tip (heel-up), else flat. */
  private stancePose(ph: StancePh, t: number, out: FootPose): FootPose {
    let pitch = ph.pitch;
    if (ph.roll) {
      const p = (t - ph.t0) / Math.max(1, ph.t1e - ph.t0);
      pitch += strikePitch(ph.v) * (1 - smoothstep(0, 0.18, p)) + offPitch(ph.v) * smoothstep(offFrom(ph.v), 1, p);
    }
    return shoeOn(ph.x, ph.z, ph.yaw, pitch, this.scale, out);
  }

  /** How far the body has left a standing foot (1 = a step's worth, by distance or twist); 0 when not standing. */
  private drift(f: number, i: number, cur: StepPhase | undefined): number {
    if (!cur || cur.k !== 0) return 0;
    const foot = this.rawAt(i).feet[f];
    return Math.max(Math.hypot(foot.fx - cur.x, foot.fz - cur.z) / (STEP.driftM * this.scale), Math.abs(angleDelta(cur.yaw, foot.yaw)) / STEP.driftYaw);
  }

  /** Decides every foot's phases through raw index `upto`. */
  private decide(upto: number) {
    while (this.decided <= upto) {
      const i = this.decided;
      for (let f = 0; f < 2; f++) if (this.next[f] <= i) this.decideFoot(f, i);
      this.decided++;
    }
  }

  private decideFoot(f: number, i: number) {
    const list = this.ph[f];
    const t = this.tOf(i);
    const s = this.scale;
    const cur = list[list.length - 1];
    if (!cur) {
      if (this.rawAt(i).feet[f].contact) list.push(this.place(f, i, t));
      else {
        const r = this.rawFootAt(f, t);
        list.push({ k: 2, t0: t - STEP.freeRampS * 1000, t1: Infinity, a: { x: r.x, y: r.y, z: r.z, yaw: r.yaw, pitch: r.pitch }, b: null });
      }
      this.next[f] = i + 1;
      return;
    }
    if (cur.k === 2) {
      // Free: the landing comes into view a ramp ahead.
      const R = Math.round(STEP.freeRampS * STEP.hz);
      if (this.down(f, i + R)) {
        const tl = this.tOf(i + R) - this.dtMs / 2;
        const st = this.place(f, i + R, tl);
        cur.t1 = tl;
        cur.b = this.stancePose(st, tl, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
        list.push(st);
        this.next[f] = i + R + 1;
      } else this.next[f] = i + 1;
      return;
    }
    if (cur.k !== 0) {
      this.next[f] = i + 1;
      return;
    }
    const r = this.rawAt(i);
    const foot = r.feet[f];
    // A gait's foot the hip has run away from leaves early (toe-off at the leg's reach, the heel fully up).
    let forced = false;
    if (foot.contact && cur.roll && r.builtinGait && (cur.x - foot.hx) * Math.sin(r.heading) + (cur.z - foot.hz) * Math.cos(r.heading) < 0) {
      const ank = shoeOn(cur.x, cur.z, cur.yaw, cur.pitch + offPitch(cur.v), s, this.scratch2);
      forced = Math.hypot(ank.x - foot.hx, ank.y - foot.hy, ank.z - foot.hz) > STEP.reach * LEG * s;
    }
    if (foot.contact && !forced) {
      // A standing foot the body has left steps (one foot at a time, the other settled), outside the gaits.
      const other = this.ph[1 - f][this.ph[1 - f].length - 1];
      const settled = t - cur.t0 > STEP.settleS * 1000 && other && other.k === 0 && other.t1 === Infinity && other.t0 <= t - STEP.settleS * 1000;
      const need = this.drift(f, i, cur);
      // Of two feet the body has left, the one left further steps first.
      const first = other?.k !== 0 || this.next[1 - f] > i + 1 || need >= this.drift(1 - f, i, other as StancePh);
      if (!r.builtinGait && need > 1 && settled && first) {
        const te = t + STEP.stepS * 1000;
        const ahead = this.rawFootAt(f, te + STEP.stepLeadS * 1000);
        const st: StancePh = { k: 0, t0: te, t1: Infinity, x: ahead.fx, z: ahead.fz, yaw: ahead.yaw, pitch: clamp(ahead.pitch, -0.1, 0.6), roll: false, t1e: Infinity, v: 0 };
        cur.t1 = t;
        const a = this.stancePose(cur, t, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
        const b = this.stancePose(st, te, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
        list.push({ k: 1, t0: t, t1: te, a, b, clear: STEP.stepLiftM * s, gait: false, v: 0, cax: 0, caz: 0, cbx: 0, cbz: 0, dropA: this.dropNeed(f, t, a), dropB: this.dropNeed(f, te, b) });
        list.push(st);
        this.next[f] = Math.ceil((te - this.anchor) / this.dtMs) + 1;
        return;
      }
      this.next[f] = i + 1;
      return;
    }
    // A lift: find the landing (after the clip's own stance, for an early toe-off).
    let k0 = i + 1;
    if (forced) while (k0 < i + STEP.hz && this.rawAt(k0).feet[f].contact) k0++;
    const lim = k0 + Math.round((r.builtinGait ? STEP.maxGaitSwingS : STEP.maxSwingS) * STEP.hz);
    let jl = -1;
    for (let k = k0; k <= lim; k++)
      if (this.down(f, k)) {
        jl = k;
        break;
      }
    if (jl >= 0 && (jl - i) / STEP.hz <= STEP.flickerS + 1e-6) {
      const land = this.rawAt(jl).feet[f];
      if (Math.hypot(land.fx - cur.x, land.fz - cur.z) < STEP.flickerM * s) {
        this.next[f] = jl;
        return;
      }
    }
    const tl = t - this.dtMs / 2;
    cur.t1 = tl;
    const a = this.stancePose(cur, tl, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
    if (jl < 0) {
      list.push({ k: 2, t0: tl, t1: Infinity, a, b: null });
      this.next[f] = i + 1;
      return;
    }
    let tLand = this.tOf(jl) - this.dtMs / 2;
    if (!r.builtinGait && tLand - tl < STEP.minSwingS * 1000) {
      // A quick lift outside a gait is a step of a step's length (the foot does not dart).
      tLand = tl + STEP.stepS * 1000;
      jl = Math.ceil((tLand - this.anchor) / this.dtMs);
    }
    const st = this.place(f, jl, tLand);
    const b = this.stancePose(st, tLand, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
    const v = Number.isFinite(r.v) ? r.v : 0;
    const ca = this.rawFootAt(f, tl);
    const cb = this.rawFootAt(f, tLand);
    list.push({ k: 1, t0: tl, t1: tLand, a, b, clear: (Number.isFinite(r.v) ? swingClearance(v) : STEP.stepLiftM) * s, gait: r.builtinGait, v, cax: ca.x, caz: ca.z, cbx: cb.x, cbz: cb.z, dropA: this.dropNeed(f, tl, a), dropB: this.dropNeed(f, tLand, b) });
    list.push(st);
    this.next[f] = jl + 1;
  }

  /**
   * Both feet at scene time t (null before the anchor): per foot [x, y, z, w, yaw, pitch, dropCap] (the ankle, world;
   * the IK weight; the shoe's world yaw and pitch; the phase-continuous pelvis-drop limit).
   */
  at(t: number, out: Float32Array): Float32Array | null {
    if (t < this.anchor) return null;
    const i = Math.floor((t - this.anchor) / this.dtMs);
    this.decide(i + 2);
    for (let f = 0; f < 2; f++) {
      const list = this.ph[f];
      let lo = 0;
      let hi = list.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (list[mid].t0 <= t) lo = mid;
        else hi = mid - 1;
      }
      const ph = list[lo];
      const o = f * STEP_STRIDE;
      const fp = this.scratch;
      let w = 1;
      let dropCap: number;
      if (ph.k === 0) {
        this.stancePose(ph, t, fp);
        dropCap = this.dropNeed(f, t, fp);
      }
      else if (ph.k === 1) {
        const u = clamp((t - ph.t0) / Math.max(1, ph.t1 - ph.t0), 0, 1);
        // The travel inside the lift: off the turf before it moves, still before it lands.
        // A walker's foot finishes travelling well before it lands; a runner's follows its own swing nearly to the turf.
        const fast = ph.gait ? smoothstep(2.5, 5, ph.v) : 0;
        const uh = smoothstep(0.04, 0.9 + 0.08 * fast, u);
        const r = this.rawFootAt(f, t);
        const win = smoothstep(0, 0.22, u) * (1 - smoothstep(0.72, 1, u));
        const base = ph.a.y + (ph.b.y - ph.a.y) * smoothstep(0, 1, u);
        fp.x = ph.a.x + (ph.b.x - ph.a.x) * uh;
        fp.z = ph.a.z + (ph.b.z - ph.a.z) * uh;
        if (ph.gait) {
          // The cycle's own swinging foot (its lead and its retraction), offset onto the two footsteps, in the middle.
          const k = smoothstep(0, 0.14, u) * (1 - smoothstep(0.74 + 0.13 * fast, 0.9 + 0.07 * fast, u));
          const s3 = smoothstep(0, 1, u);
          const cx = r.x + (ph.a.x - ph.cax) + (ph.b.x - ph.cbx - (ph.a.x - ph.cax)) * s3;
          const cz = r.z + (ph.a.z - ph.caz) + (ph.b.z - ph.cbz - (ph.a.z - ph.caz)) * s3;
          fp.x += (cx - fp.x) * k;
          fp.z += (cz - fp.z) * k;
        }
        fp.yaw = ph.a.yaw + angleDelta(ph.a.yaw, ph.b.yaw) * uh;
        const lin = ph.a.pitch + (ph.b.pitch - ph.a.pitch) * smoothstep(0, 1, u);
        fp.pitch = lin + (clamp(r.pitch, -0.6, 0.9) - lin) * win * 0.7;
        // Clear of the turf by the shoe's lowest point (a pointed toe hangs below the ankle), not just the ankle.
        const bump = ph.clear * Math.sqrt(Math.sin(Math.PI * u));
        const c = Math.cos(fp.pitch);
        const sn = Math.sin(fp.pitch);
        const under = Math.max(SOLE_Y * c + HEEL_Z * sn, SOLE_Y * c + TIP_Z * sn) * this.scale;
        fp.y = Math.max(base + Math.max(bump, r.lift * win), under + bump);
        // An airborne target must not yank the pelvis down and back up. Its allowed drop is the C1 interpolation of
        // what the same foot needs at toe-off and landing, so it joins both supporting stances continuously.
        dropCap = ph.dropA + (ph.dropB - ph.dropA) * smoothstep(0, 1, u);
      } else {
        // Free: the clip's own foot, the footsteps' fading out after the lift and in before the landing.
        const r = this.rawFootAt(f, t);
        const kOut = 1 - smoothstep(ph.t0, ph.t0 + STEP.freeRampS * 1000, t);
        const kIn = ph.b ? smoothstep(ph.t1 - STEP.freeRampS * 1000, ph.t1, t) : 0;
        fp.x = r.x + (ph.a.x - r.x) * kOut;
        fp.y = r.y + (ph.a.y - r.y) * kOut;
        fp.z = r.z + (ph.a.z - r.z) * kOut;
        fp.yaw = r.yaw + angleDelta(r.yaw, ph.a.yaw) * kOut;
        fp.pitch = r.pitch + (ph.a.pitch - r.pitch) * kOut;
        if (ph.b && kIn > 0) {
          fp.x += (ph.b.x - fp.x) * kIn;
          fp.y += (ph.b.y - fp.y) * kIn;
          fp.z += (ph.b.z - fp.z) * kIn;
          fp.yaw += angleDelta(fp.yaw, ph.b.yaw) * kIn;
          fp.pitch += (ph.b.pitch - fp.pitch) * kIn;
        }
        w = Math.max(kOut, kIn);
        dropCap = this.dropNeed(f, t, fp) * w;
      }
      out[o] = fp.x;
      out[o + 1] = fp.y;
      out[o + 2] = fp.z;
      out[o + 3] = w;
      out[o + 4] = fp.yaw;
      out[o + 5] = fp.pitch;
      out[o + 6] = dropCap;
    }
    return out;
  }
  private readonly scratch: FootPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  private readonly scratch2: FootPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
}

/** The ankle of a shoe flat at (x, z) with `yaw`, pitched about its tip (heel up, pitch > 0) or its heel (toe up). */
function shoeOn(x: number, z: number, yaw: number, pitch: number, scale: number, out: FootPose): FootPose {
  const dx = Math.sin(yaw);
  const dz = Math.cos(yaw);
  const c = Math.cos(pitch);
  const sn = Math.sin(pitch);
  // The pivot's offset from the flat ankle along the shoe, and the ankle's from the pivot once pitched (foot frame).
  const pz = pitch >= 0 ? TIP_Z : HEEL_Z;
  const ay = SOLE_Y * c + pz * sn;
  const az = SOLE_Y * sn + -pz * c;
  out.x = x + dx * (pz + az) * scale;
  out.z = z + dz * (pz + az) * scale;
  out.y = ay * scale;
  out.yaw = yaw;
  out.pitch = pitch;
  return out;
}

const vb: number[] = [0, 0, 0];
const qy: number[] = [0, 0, 0, 1];
const qx: number[] = [0, 0, 0, 1];
const qf: number[] = [0, 0, 0, 1];
const qs: number[] = [0, 0, 0, 1];

/**
 * Plants both feet of `pose` on a StepPlan's targets (world): the pelvis lowers as far as a foot's reach needs, the legs
 * reach their ankles exactly (hinged knees towards the hips' front), and each shoe takes its planned world yaw and pitch,
 * each blended by its weight.
 */
export function plantFeetLocked(pose: SampledPose, j: Joints, tg: Float32Array, root: Vec3, heading: number, scale: number, reachShare: number = STEP.reach, softFrom: number = STEP.soft): void {
  forwardKinematics(pose, j);
  const reach = reachShare * LEG;
  const local: Array<Vec3 | null> = [null, null];
  let drop = 0;
  for (let f = 0; f < 2; f++) {
    const w = tg[f * STEP_STRIDE + 3];
    if (w <= 1e-3) continue;
    const l = worldToLocal({ x: tg[f * STEP_STRIDE], y: tg[f * STEP_STRIDE + 1], z: tg[f * STEP_STRIDE + 2] }, root, heading, scale);
    local[f] = l;
    const hi = BONE_INDEX[f === 0 ? 'thighL' : 'thighR'] * 3;
    const h = j.p[hi + 1] - l.y;
    const d = Math.hypot(l.x - j.p[hi], h, l.z - j.p[hi + 2]);
    // The drop that brings the ankle back within reach (to first order: smooth however far the foot is).
    if (d > reach) {
      const need = ((d - reach) * d * w) / Math.max(h, 0.35);
      drop = Math.max(drop, Math.min(need, Math.max(0, tg[f * STEP_STRIDE + 6])));
    }
  }
  if (drop > 0) {
    const d = drop <= STEP.dropExactM ? drop : STEP.dropExactM + STEP.dropSoftM * (1 - Math.exp(-(drop - STEP.dropExactM) / STEP.dropSoftM));
    pose.root[1] -= d;
    forwardKinematics(pose, j);
  }
  for (let f = 0; f < 2; f++) {
    const l = local[f];
    if (!l) continue;
    const w = tg[f * STEP_STRIDE + 3];
    const side = f === 0 ? 'L' : 'R';
    const bones = [BONE_INDEX[`thigh${side}`], BONE_INDEX[`shin${side}`], BONE_INDEX[`foot${side}`]];
    // A part weight blends the whole leg's rotations (a light IK re-planing the knee would jump at its ends).
    if (w < 1) for (let b = 0; b < 3; b++) for (let k = 0; k < 4; k++) legKeep[b * 4 + k] = pose.q[bones[b] * 4 + k];
    rotate(j.q, 0, KNEE_POLE[0], KNEE_POLE[1], KNEE_POLE[2], kneePole, 0);
    twoBoneIK(pose, j, `thigh${side}`, `shin${side}`, `foot${side}`, [l.x, l.y, l.z], 1, kneePole, true, softFrom);
    forwardKinematics(pose, j);
    // The shoe's planned orientation (actor frame: yaw about Y, then pitch about the shoe's X), under the shin.
    const yaw = (tg[f * STEP_STRIDE + 4] - heading) / 2;
    const pitch = tg[f * STEP_STRIDE + 5] / 2;
    qy[0] = 0;
    qy[1] = Math.sin(yaw);
    qy[2] = 0;
    qy[3] = Math.cos(yaw);
    qx[0] = Math.sin(pitch);
    qx[1] = 0;
    qx[2] = 0;
    qx[3] = Math.cos(pitch);
    qmul(qy, 0, qx, 0, qf, 0);
    invInto(j.q, bones[1] * 4, qs);
    qmul(qs, 0, qf, 0, qf, 0);
    for (let k = 0; k < 4; k++) pose.q[bones[2] * 4 + k] = qf[k];
    if (w < 1)
      for (let b = 0; b < 3; b++) {
        const o = bones[b] * 4;
        const q = pose.q;
        const dot = q[o] * legKeep[b * 4] + q[o + 1] * legKeep[b * 4 + 1] + q[o + 2] * legKeep[b * 4 + 2] + q[o + 3] * legKeep[b * 4 + 3];
        const sg = dot < 0 ? -1 : 1;
        let n = 0;
        for (let k = 0; k < 4; k++) {
          const v = legKeep[b * 4 + k] + (sg * q[o + k] - legKeep[b * 4 + k]) * w;
          q[o + k] = v;
          n += v * v;
        }
        n = Math.sqrt(n) || 1;
        for (let k = 0; k < 4; k++) q[o + k] /= n;
      }
    forwardKinematics(pose, j);
  }
}
const legKeep = new Float32Array(12);

/** Turns the neck and head (within their range) towards a world point, a weight w of the way. */
export function lookAt(pose: SampledPose, j: Joints, target: Vec3, root: Vec3, heading: number, scale: number, w: number): void {
  if (w <= 1e-3) return;
  const hi = BONE_INDEX.head * 3;
  const head = localToWorld(j.p[hi], j.p[hi + 1], j.p[hi + 2], root, heading, scale);
  const dx = target.x - head.x;
  const dz = target.z - head.z;
  const flat = Math.hypot(dx, dz);
  const raw = angleDelta(heading, headingOf(dx, dz));
  // Fades out as the ball comes very close or goes round behind him (the head never whips across the back).
  const k = w * smoothstep(1.0, 2.5, flat) * (1 - smoothstep(1.3, 2.3, Math.abs(raw)));
  if (k <= 1e-3) return;
  const yaw = clamp(raw, -1.2, 1.2) * k;
  const pitch = clamp(Math.atan2(target.y - head.y, flat), -0.45, 0.7) * k;
  const deg = 180 / Math.PI;
  addBoneRotation(pose, 'neck', [-0.4 * pitch * deg, 0.45 * yaw * deg, 0], 1);
  addBoneRotation(pose, 'head', [-0.6 * pitch * deg, 0.55 * yaw * deg, 0], 1);
}

/** Brings the hands (both, or the right) to a world point a weight w of the way, when the shoulders can reach it. */
export function handsTo(pose: SampledPose, j: Joints, target: Vec3, root: Vec3, heading: number, scale: number, w: number, both: boolean, centred = false): boolean {
  if (w <= 1e-3) return false;
  forwardKinematics(pose, j);
  const l = worldToLocal(target, root, heading, scale);
  const reach = ARM_REACH;
  let any = false;
  for (const side of both ? (['L', 'R'] as const) : (['R'] as const)) {
    const si = BONE_INDEX[`upperArm${side}`] * 3;
    // Two hands: the keeper's gloves either side of the ball (the drawn ball is at their midpoint); a fielder's right
    // hand on it (the ball is drawn at his right hand) with the left beside it.
    const off = !both ? 0 : centred ? (side === 'L' ? 0.05 : -0.05) : side === 'L' ? 0.1 : 0;
    // The ball sits in the palm (players.ts BALL_IN_HAND, the point StageScene.handOf draws a held ball at): the hand
    // bone's target is the ball less the palm's offset in the hand's frame (the hand keeps its orientation under IK).
    const hi = BONE_INDEX[`hand${side}`] * 4;
    rotate(j.q, hi, PALM[0], PALM[1], PALM[2], va, 0);
    const tx = l.x + off - va[0];
    const ty = l.y - va[1];
    const tz = l.z - va[2];
    const d = Math.hypot(tx - j.p[si], ty - j.p[si + 1], tz - j.p[si + 2]);
    if (d > reach + 0.6) continue;
    // Elbows bend down and out (a stable pole: a nearly straight arm never flips its bend). Beyond reach the arm points
    // at the target at full extension: never stretched.
    twoBoneIK(pose, j, `upperArm${side}`, `forearm${side}`, `hand${side}`, [tx, ty, tz], w * smoothstep(reach + 0.6, reach + 0.2, d), side === 'L' ? ELBOW_POLE_L : ELBOW_POLE_R, true);
    forwardKinematics(pose, j);
    any = true;
  }
  if (any) {
    pose.aimL = null;
    pose.aimR = null;
  }
  return any;
}

/** The held ball's centre in the hand bone's frame (m, scale 1): players.ts BALL_IN_HAND, where StageScene.handOf draws it. */
export const PALM: readonly [number, number, number] = [0, -0.085, 0.03];

/** The palm point (actor frame, scale 1) of a hand in a pose's FK. */
export function palmLocal(j: Joints, side: 'L' | 'R'): Vec3 {
  const b = BONE_INDEX[`hand${side}`];
  rotate(j.q, b * 4, PALM[0], PALM[1], PALM[2], va, 0);
  return { x: j.p[b * 3] + va[0], y: j.p[b * 3 + 1] + va[1], z: j.p[b * 3 + 2] + va[2] };
}

/** Shoulder to the hand bone at full stretch, with a little slack (m, scale 1). */
const ARM_REACH = 0.285 + 0.255 + 0.04;
/** Shoulder to the hand bone, the arm chain itself (m, scale 1). */
const ARM_CHAIN = 0.285 + 0.255;
/** The whole-body reach's limits: each of spine and chest bends at most this far, the hips drop at most this (m). */
const BODY_REACH = { bendDeg: 30, dropM: 0.25 } as const;
/**
 * The whole-body reach's limits per joint: the normal reach, and the deeper scoop for a ball at ground level (the
 * lead's presentation ruling, 2026-11-04: hips down to 0.4 m, spine and chest to 40° each).
 */
export const BODY_REACH_LIMITS = {
  normal: { hipsDeg: 30, spineDeg: 30, chestDeg: 30, dropM: 0.25 },
  ground: { hipsDeg: 30, spineDeg: 40, chestDeg: 40, dropM: 0.4 },
} as const;
/** A take below this height (m, scale 1) is a ground ball: the deeper scoop. */
export const GROUND_BALL_M = 0.3;

/**
 * Brings the shoulder within arm's reach of a world target when the arm alone cannot: the trunk bends towards it
 * (spine, then chest, each at most BODY_REACH.bendDeg), then the hips drop (at most BODY_REACH.dropM; the planted
 * feet stay, so the knees bend) when the target is below. Returns the hip drop applied (m, scale 1) and the gap left
 * between the shoulder's reach and the target (m; 0 when reachable). `targets`: the foot plan's, to keep the feet.
 */
export function bodyReach(pose: SampledPose, j: Joints, target: Vec3, root: Vec3, heading: number, scale: number, side: 'R' | 'mid', targets: Float32Array | null, limits: { hipsDeg: number; spineDeg: number; chestDeg: number; dropM: number } = BODY_REACH_LIMITS.normal, stepGeometry?: readonly [reachShare: number, softFrom: number], armReachShare = 0.86): { drop: number; short: number } {
  const T = worldToLocal(target, root, heading, scale);
  const shoulder = () => {
    const r = BONE_INDEX.upperArmR * 3;
    const l = BONE_INDEX.upperArmL * 3;
    return side === 'R' ? { x: j.p[r], y: j.p[r + 1], z: j.p[r + 2] } : { x: (j.p[r] + j.p[l]) / 2, y: (j.p[r + 1] + j.p[l + 1]) / 2, z: (j.p[r + 2] + j.p[l + 2]) / 2 };
  };
  // Inside the arm chain's own length (shoulder to the hand bone, 0.54 m), where the arm IK is exact.
  const want = ARM_CHAIN * armReachShare;
  forwardKinematics(pose, j);
  let S = shoulder();
  if (Math.hypot(T.x - S.x, T.y - S.y, T.z - S.z) <= want) return { drop: 0, short: 0 };
  // The trunk: the pelvis, spine and chest (each about its own joint) swing the shoulder towards the target.
  for (const bone of ['hips', 'spine', 'chest'] as const) {
    const bi = BONE_INDEX[bone];
    const P = { x: j.p[bi * 3], y: j.p[bi * 3 + 1], z: j.p[bi * 3 + 2] };
    S = shoulder();
    const ax = S.x - P.x;
    const ay = S.y - P.y;
    const az = S.z - P.z;
    const bx = T.x - P.x;
    const by = T.y - P.y;
    const bz = T.z - P.z;
    const la = Math.hypot(ax, ay, az) || 1;
    const lb = Math.hypot(bx, by, bz) || 1;
    const cos = clamp((ax * bx + ay * by + az * bz) / (la * lb), -1, 1);
    const full = Math.acos(cos);
    // Each joint takes its share of what is left (a third, a half, the rest), at most its limit.
    const share = bone === 'hips' ? 1 / 3 : bone === 'spine' ? 0.5 : 1;
    const lim = bone === 'hips' ? limits.hipsDeg : bone === 'spine' ? limits.spineDeg : limits.chestDeg;
    const ang = Math.min((lim * Math.PI) / 180, full * share);
    if (ang < 1e-4) continue;
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-9) continue;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const h = Math.sin(ang / 2);
    qa[0] = nx * h;
    qa[1] = ny * h;
    qa[2] = nz * h;
    qa[3] = Math.cos(ang / 2);
    qmul(qa, 0, j.q, bi * 4, qb, 0); // new world
    if (PARENT[bi] < 0) {
      pose.q[bi * 4] = qb[0];
      pose.q[bi * 4 + 1] = qb[1];
      pose.q[bi * 4 + 2] = qb[2];
      pose.q[bi * 4 + 3] = qb[3];
      // The pelvis tilts over planted feet.
      if (targets) plantAny(pose, j, targets, root, heading, scale, stepGeometry);
    } else {
      invInto(j.q, PARENT[bi] * 4, qc);
      qmul(qc, 0, qb, 0, pose.q, bi * 4);
    }
    forwardKinematics(pose, j);
    S = shoulder();
    if (Math.hypot(T.x - S.x, T.y - S.y, T.z - S.z) <= want) return { drop: 0, short: 0 };
  }
  // The hips drop when the target is below: the feet stay planted, the knees bend.
  S = shoulder();
  const hz = Math.hypot(T.x - S.x, T.z - S.z);
  const dy = S.y - T.y;
  let drop = 0;
  if (dy > 0 && hz < want) drop = clamp(dy - Math.sqrt(Math.max(0, want * want - hz * hz)), 0, limits.dropM);
  // A high take: the hips rise (out of a crouch), as far as the planted legs allow (the planting drops them back).
  else if (dy < 0 && hz < want) drop = -clamp(-dy - Math.sqrt(Math.max(0, want * want - hz * hz)), 0, BODY_REACH.dropM);
  if (drop !== 0) {
    pose.root[1] -= drop;
    if (targets) plantAny(pose, j, targets, root, heading, scale, stepGeometry);
    else forwardKinematics(pose, j);
  }
  S = shoulder();
  return { drop, short: Math.max(0, Math.hypot(T.x - S.x, T.y - S.y, T.z - S.z) - ARM_CHAIN) * scale };
}

/** Plants the feet on either plan's targets (a StepPlan's 14 values, a FootPlan's 10). */
export function plantAny(pose: SampledPose, j: Joints, targets: Float32Array, root: Vec3, heading: number, scale: number, stepGeometry?: readonly [reachShare: number, softFrom: number]): void {
  if (targets.length >= 2 * STEP_STRIDE) plantFeetLocked(pose, j, targets, root, heading, scale, stepGeometry?.[0], stepGeometry?.[1]);
  else plantFeet(pose, j, targets, root, heading, scale);
}

/** The clip markers the hands meet the ball on, and whether both hands take it. */
export const HAND_MARKERS: Partial<Record<ClipId, { marker: string; both: boolean }>> = {
  keep_take: { marker: 'catch', both: true },
  catch_chest: { marker: 'catch', both: true },
  catch_high: { marker: 'catch', both: true },
  field_pickup: { marker: 'collect', both: false },
  // The throwing hand on the physics release point at the release (the ball leaves from it).
  field_throw: { marker: 'release', both: false },
  field_fumble: { marker: 'touch', both: true },
  keep_dive_r: { marker: 'reach', both: true },
  keep_dive_l: { marker: 'reach', both: true },
  field_dive_r: { marker: 'reach', both: true },
  field_dive_l: { marker: 'reach', both: true },
};

/** Scene time (ms) the current move's clip reaches `marker`, or null when it does not within the move's clip. */
export function markerSceneTime(track: ActorTrack, t: number, clip: ClipId, marker: string): number | null {
  const moves = track.moves;
  let i = 0;
  while (i < moves.length - 1 && t >= moves[i + 1].t0) i++;
  // Walk forward through the moves that continue this clip until the marker is reached.
  const m = clipMarker(clip, marker, NaN);
  if (Number.isNaN(m)) return null;
  for (let k = Math.max(0, i - 3); k < moves.length && k < i + 12; k++) {
    const mv = moves[k];
    if (mv.clip !== clip) continue;
    const rate = mv.rate ?? 1;
    const c0 = mv.clipStart ?? 0;
    const c1 = c0 + ((mv.t1 - mv.t0) / 1000) * rate;
    if (m >= c0 - 1e-6 && m <= c1 + 1e-6) return mv.t0 + ((m - c0) / rate) * 1000;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// A smooth gait, continuous in speed (replaces the four-key, linearly interpolated cycles while drawn)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Every gait loop (walk, jog, run, the drive) is four keys a quarter-cycle apart, the left leg forward at phase 0.
 * Each bone's Euler angles (and the hips' bob) are fitted with the periodic two-harmonic series through its four
 * keys (exact at the keys, smooth between: no corners at the keys as with linear interpolation), and the series'
 * coefficients are blended by ground speed between neighbouring gaits (in log-speed, phase-synced), and towards the
 * drive cycle with forward acceleration. One gait, no switching.
 */
interface GaitFit {
  speed: number;
  /** NB × 3 Euler components × [a0, a1, b1, a2] and root (x, y, z) × the same. */
  c: Float64Array;
}

const GAIT_SPEEDS: ReadonlyArray<readonly [GaitClip, number]> = [
  ['walk', 1.4],
  ['jog', 3.7],
  ['run', 5.7],
];
export type GaitClip = 'walk' | 'jog' | 'run' | 'run_drive';
const GAIT_SET = new Set<string>(['walk', 'jog', 'run', 'run_drive']);
export const isGaitClip = (c: ClipId): c is GaitClip => GAIT_SET.has(c);

let fits: Map<GaitClip, GaitFit> | null = null;
const CLIP_KEYS = (): Record<GaitClip, ClipDef['keys']> => ({ walk: CLIPS.walk.keys, jog: CLIPS.jog.keys, run: CLIPS.run.keys, run_drive: CLIPS.run_drive.keys });

function fitGait(speed: number, keys: ReadonlyArray<{ pose?: Partial<Record<BoneName, readonly [number, number, number]>>; root?: readonly [number, number, number] }>): GaitFit {
  // Euler values at the four quarter-cycle keys (bones a key leaves out keep the previous key's value, as compiled).
  const cur: Partial<Record<BoneName, readonly [number, number, number]>> = {};
  let root: readonly [number, number, number] = [0, 0, 0];
  const at: Array<{ e: Array<readonly [number, number, number]>; r: readonly [number, number, number] }> = [];
  for (let k = 0; k < 4; k++) {
    const key = keys[k];
    if (key.pose) Object.assign(cur, key.pose);
    if (key.root) root = key.root;
    at.push({ e: BONE_NAMES.map((b) => cur[b] ?? [0, 0, 0]), r: root });
  }
  const c = new Float64Array((NB * 3 + 3) * 4);
  const fit4 = (o: number, f0: number, f1: number, f2: number, f3: number) => {
    c[o] = (f0 + f1 + f2 + f3) / 4;
    c[o + 1] = (f0 - f2) / 2;
    c[o + 2] = (f1 - f3) / 2;
    c[o + 3] = (f0 - f1 + f2 - f3) / 4;
  };
  for (let b = 0; b < NB; b++) for (let x = 0; x < 3; x++) fit4((b * 3 + x) * 4, at[0].e[b][x], at[1].e[b][x], at[2].e[b][x], at[3].e[b][x]);
  for (let x = 0; x < 3; x++) fit4((NB * 3 + x) * 4, at[0].r[x], at[1].r[x], at[2].r[x], at[3].r[x]);
  return { speed, c };
}

function gaitFits(): Map<GaitClip, GaitFit> {
  if (!fits) {
    fits = new Map();
    const lib = CLIP_KEYS();
    for (const [clip, speed] of [...GAIT_SPEEDS, ['run_drive', 6.0] as const]) fits.set(clip, fitGait(speed, lib[clip]));
  }
  return fits;
}

const coef = new Float64Array((NB * 3 + 3) * 4);
const eul: number[] = [0, 0, 0];
const tmpQuat: [number, number, number, number] = [0, 0, 0, 1];

/**
 * The smooth gait pose at ground speed v (m/s, rig scale 1), cycle phase (0..1, left foot strike at 0) and forward
 * acceleration aF (m/s²), into `out` (all bones, or with `legsOnly` the hips and legs, and the root offset; aims and
 * bat cleared).
 */
const LEG_BONES = new Set<number>(['hips', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'].map((b) => BONE_INDEX[b as BoneName]));

export function gaitPose(v: number, phase: number, aF: number, out: SampledPose, legsOnly = false): SampledPose {
  const F = gaitFits();
  // Blend weights along the speed axis (log-speed between neighbours).
  const lv = Math.log(Math.max(0.3, v));
  let lo = GAIT_SPEEDS[0];
  let hi = GAIT_SPEEDS[0];
  let u = 0;
  if (v <= GAIT_SPEEDS[0][1]) lo = hi = GAIT_SPEEDS[0];
  else if (v >= GAIT_SPEEDS[GAIT_SPEEDS.length - 1][1]) lo = hi = GAIT_SPEEDS[GAIT_SPEEDS.length - 1];
  else
    for (let i = 0; i + 1 < GAIT_SPEEDS.length; i++)
      if (v < GAIT_SPEEDS[i + 1][1]) {
        lo = GAIT_SPEEDS[i];
        hi = GAIT_SPEEDS[i + 1];
        u = (lv - Math.log(lo[1])) / (Math.log(hi[1]) - Math.log(lo[1]));
        break;
      }
  const ca = F.get(lo[0])!.c;
  const cb = F.get(hi[0])!.c;
  const cd = F.get('run_drive')!.c;
  const wd = smoothstep(1.5, 4, aF) * smoothstep(2, 4, v);
  for (let i = 0; i < coef.length; i++) {
    const x = ca[i] + (cb[i] - ca[i]) * u;
    coef[i] = x + (cd[i] - x) * wd;
  }
  const w = 2 * Math.PI * phase;
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  for (let b = 0; b < NB; b++) {
    if (legsOnly && !LEG_BONES.has(b)) continue;
    for (let x = 0; x < 3; x++) {
      const o = (b * 3 + x) * 4;
      eul[x] = coef[o] + coef[o + 1] * c1 + coef[o + 2] * s1 + coef[o + 3] * c2;
    }
    quatFromEulerDeg(eul[0], eul[1], eul[2], tmpQuat);
    out.q[b * 4] = tmpQuat[0];
    out.q[b * 4 + 1] = tmpQuat[1];
    out.q[b * 4 + 2] = tmpQuat[2];
    out.q[b * 4 + 3] = tmpQuat[3];
  }
  const r: [number, number, number] = [0, 0, 0];
  for (let x = 0; x < 3; x++) {
    const o = (NB * 3 + x) * 4;
    r[x] = coef[o] + coef[o + 1] * c1 + coef[o + 2] * s1 + coef[o + 3] * c2;
  }
  out.root = r;
  out.aimL = null;
  out.aimR = null;
  out.bat = null;
  out.twoHands = true;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Inertialization (a clip switch without a linear cross-fade)
// ---------------------------------------------------------------------------------------------------------------

/** Critically damped decay rate (1/s) of a switch's pose offset: about 97% gone by INERT_S. */
export const INERT = { omega: 25, s: 0.22 } as const;

function qLog(x: number, y: number, z: number, w: number, out: number[], o: number) {
  if (w < 0) {
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }
  const s = Math.hypot(x, y, z);
  const a = s > 1e-9 ? (2 * Math.atan2(s, w)) / s : 2;
  out[o] = x * a;
  out[o + 1] = y * a;
  out[o + 2] = z * a;
}

/**
 * Applies the decaying offset of a switch from `src` to `dst` (the old clip continued, the new one; each sampled at
 * the switch and one frame before it, h seconds apart) to `out` (the new clip at dt seconds after the switch): per
 * bone the offset rotation src·dst⁻¹ and its rate, x(dt) = (x0 + (v0 + ω x0) dt) e^(−ω dt); the root offset alike.
 */
export function inertialize(src0: SampledPose, src1: SampledPose, dst0: SampledPose, dst1: SampledPose, h: number, dt: number, out: SampledPose, omega: number = INERT.omega): void {
  const k = Math.exp(-omega * dt);
  const lin = (x0: number, x1: number) => {
    const v = (x1 - x0) / h;
    return (x1 + (v + omega * x1) * dt) * k;
  };
  const r0: number[] = [0, 0, 0];
  const r1: number[] = [0, 0, 0];
  const off = (a: Float32Array, b: Float32Array, i: number, into: number[]) => {
    // a · b⁻¹
    const bx = -b[i];
    const by = -b[i + 1];
    const bz = -b[i + 2];
    const bw = b[i + 3];
    const ax = a[i];
    const ay = a[i + 1];
    const az = a[i + 2];
    const aw = a[i + 3];
    qLog(aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz, into, 0);
  };
  for (let b = 0; b < NB; b++) {
    const i = b * 4;
    off(src0.q, dst0.q, i, r0);
    off(src1.q, dst1.q, i, r1);
    const x = lin(r0[0], r1[0]);
    const y = lin(r0[1], r1[1]);
    const z = lin(r0[2], r1[2]);
    const ang = Math.hypot(x, y, z);
    if (ang < 1e-7) continue;
    const s = Math.sin(ang / 2) / ang;
    const ox = x * s;
    const oy = y * s;
    const oz = z * s;
    const ow = Math.cos(ang / 2);
    // out = offset · out
    const qx = out.q[i];
    const qy = out.q[i + 1];
    const qz = out.q[i + 2];
    const qw = out.q[i + 3];
    out.q[i] = ow * qx + ox * qw + oy * qz - oz * qy;
    out.q[i + 1] = ow * qy - ox * qz + oy * qw + oz * qx;
    out.q[i + 2] = ow * qz + ox * qy - oy * qx + oz * qw;
    out.q[i + 3] = ow * qw - ox * qx - oy * qy - oz * qz;
  }
  for (let a = 0; a < 3; a++) out.root[a] += lin(src0.root[a] - dst0.root[a], src1.root[a] - dst1.root[a]);
}

// ---------------------------------------------------------------------------------------------------------------
// A C1 root (presentation only): Hermite through every knot of the physics path
// ---------------------------------------------------------------------------------------------------------------

/**
 * How far (world metres, x and z) the C1 curve through the track's knots (every move boundary, so every physics
 * sample) lies from the drawn linear path at t: zero at every knot, so exact at every event. Tangents are finite
 * differences over the neighbouring knots. Null where the move is not a plain linear one.
 */
export function hermiteDeviation(track: ActorTrack, t: number): { x: number; z: number } | null {
  const moves = track.moves;
  let lo = 0;
  let hi = moves.length - 1;
  if (hi < 0) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (moves[mid].t0 <= t) lo = mid;
    else hi = mid - 1;
  }
  const m = moves[lo];
  if (!m.from || !m.to || m.speed || (m.ease && m.ease !== 'linear') || t > m.t1) return null;
  const T0 = m.t0 / 1000;
  const T1 = m.t1 / 1000;
  const dt = T1 - T0;
  if (dt <= 1e-6) return null;
  const linked = (a: (typeof moves)[number] | undefined, at: Vec3) => Boolean(a && a.from && a.to && !a.speed && Math.abs(a.to.x - at.x) + Math.abs(a.to.z - at.z) < 1e-9);
  const prev = moves[lo - 1];
  const next = moves[lo + 1];
  const cx = (m.to.x - m.from.x) / dt;
  const cz = (m.to.z - m.from.z) / dt;
  let m0x = cx;
  let m0z = cz;
  let m1x = cx;
  let m1z = cz;
  if (prev && linked(prev, m.from)) {
    const span = T1 - prev.t0 / 1000;
    m0x = (m.to.x - prev.from!.x) / span;
    m0z = (m.to.z - prev.from!.z) / span;
  }
  if (next && next.from && next.to && Math.abs(next.from.x - m.to.x) + Math.abs(next.from.z - m.to.z) < 1e-9 && !next.speed) {
    const span = next.t1 / 1000 - T0;
    m1x = (next.to.x - m.from.x) / span;
    m1z = (next.to.z - m.from.z) / span;
  }
  const u = clamp((t / 1000 - T0) / dt, 0, 1);
  const u2 = u * u;
  const u3 = u2 * u;
  const h10 = u3 - 2 * u2 + u;
  const h11 = u3 - u2;
  // H(u) − lerp(u): the position terms cancel to the cubic's departure from the chord.
  const h01 = -2 * u3 + 3 * u2;
  return {
    x: (h01 - u) * (m.to.x - m.from.x) + h10 * dt * m0x + h11 * dt * m1x,
    z: (h01 - u) * (m.to.z - m.from.z) + h10 * dt * m0z + h11 * dt * m1z,
  };
}

/** The leg's release from its plant at lift-off: its rotation offset (IK'd over the clip) decays over this (s). */
export const LEG_RELEASE_S = 0.15;

/**
 * Applies the decaying leg offset of a lift-off (`ik` and `clip`: the leg's pose at the lift-off with and without the
 * planting) to `pose`, dt seconds later: critically damped, gone by LEG_RELEASE_S.
 */
export function releaseLeg(pose: SampledPose, ik: SampledPose, clip: SampledPose, side: 'L' | 'R', dt: number): void {
  const omega = 5.5 / LEG_RELEASE_S;
  applyBoneOffset(pose, ik, clip, [`thigh${side}`, `shin${side}`, `foot${side}`] as BoneName[], (1 + omega * dt) * Math.exp(-omega * dt));
}

/** pose.bone ← (ik · clip⁻¹)^k · pose.bone for each bone: a fraction k of the rotation offset ik has over clip. */
export function applyBoneOffset(pose: SampledPose, ik: SampledPose, clip: SampledPose, bones: readonly BoneName[], k: number): void {
  if (k <= 1e-3) return;
  const r: number[] = [0, 0, 0];
  for (const bone of bones) {
    const i = BONE_INDEX[bone as BoneName] * 4;
    // offset = ik · clip⁻¹, scaled by k (as a rotation vector), applied on the left
    const bx = -clip.q[i];
    const by = -clip.q[i + 1];
    const bz = -clip.q[i + 2];
    const bw = clip.q[i + 3];
    const ax = ik.q[i];
    const ay = ik.q[i + 1];
    const az = ik.q[i + 2];
    const aw = ik.q[i + 3];
    let x = aw * bx + ax * bw + ay * bz - az * by;
    let y = aw * by - ax * bz + ay * bw + az * bx;
    let z = aw * bz + ax * by - ay * bx + az * bw;
    let w = aw * bw - ax * bx - ay * by - az * bz;
    if (w < 0) {
      x = -x;
      y = -y;
      z = -z;
      w = -w;
    }
    const sn = Math.hypot(x, y, z);
    const ang = 2 * Math.atan2(sn, w) * k;
    if (sn < 1e-9 || ang < 1e-7) continue;
    r[0] = x / sn;
    r[1] = y / sn;
    r[2] = z / sn;
    const hs = Math.sin(ang / 2);
    const ox = r[0] * hs;
    const oy = r[1] * hs;
    const oz = r[2] * hs;
    const ow = Math.cos(ang / 2);
    const qx = pose.q[i];
    const qy = pose.q[i + 1];
    const qz = pose.q[i + 2];
    const qw = pose.q[i + 3];
    pose.q[i] = ow * qx + ox * qw + oy * qz - oz * qy;
    pose.q[i + 1] = ow * qy - ox * qz + oy * qw + oz * qx;
    pose.q[i + 2] = ow * qz + ox * qy - oy * qx + oz * qw;
    pose.q[i + 3] = ow * qw - ox * qx - oy * qy - oz * qz;
  }
}

/**
 * Bakes a pose's arm aims (clips.ts: the arm pointing at angle phi in the actor's sagittal plane, lateral outwards)
 * into the upper arms' rotations, as players.ts applyAim does after posing (a swing of the upper arm only), and clears
 * them: the layers that follow then work on the arm the stage will draw.
 */
export function bakeAims(pose: SampledPose, j: Joints): void {
  if (!pose.aimL && !pose.aimR) return;
  forwardKinematics(pose, j);
  for (const side of ['L', 'R'] as const) {
    const aim = side === 'L' ? pose.aimL : pose.aimR;
    if (!aim) continue;
    const phi = (aim[0] * Math.PI) / 180;
    const lat = (aim[1] * Math.PI) / 180;
    const sx = side === 'L' ? 1 : -1;
    const dx = sx * Math.sin(lat);
    const dy = -Math.cos(phi) * Math.cos(lat);
    const dz = -Math.sin(phi) * Math.cos(lat);
    const iu = BONE_INDEX[`upperArm${side}`];
    rotate(j.q, iu * 4, 0, -1, 0, va, 0);
    const cl = Math.hypot(va[0], va[1], va[2]) || 1;
    const dl = Math.hypot(dx, dy, dz) || 1;
    qFromUnit(va[0] / cl, va[1] / cl, va[2] / cl, dx / dl, dy / dl, dz / dl, qa);
    qmul(qa, 0, j.q, iu * 4, qb, 0);
    invInto(j.q, PARENT[iu] * 4, qc);
    qmul(qc, 0, qb, 0, pose.q, iu * 4);
    forwardKinematics(pose, j);
  }
  pose.aimL = null;
  pose.aimR = null;
}
