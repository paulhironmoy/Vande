/**
 * Puts the Director's channels on a pose (P2). Two passes:
 *
 *   applyLife   breath and sway, on the sampled pose in a pose hook BEFORE the planted-feet plan and the arm IK (the
 *               actor's local frame, before the stage's mirror), so the feet stay where they landed and the gloves stay
 *               on the handle while the body breathes;
 *   applyHead   the head and the eyes, on the rig's own bones as the stage has finished them (the drawn form, after the
 *               mirror): the humans hook fits the striker's trunk and neck to the physics body and turns him to the bat,
 *               and the glove solve then leans his chest and spine towards the handle, so only the finished bones say
 *               where the head points. It measures that, and turns the neck and head the rest of the way to the head in
 *               space the plan wants, as far as the neck can turn (its range relative to the chest, which the clips
 *               themselves already use up to 86 degrees of yaw), so what is drawn looks where the plan says whatever
 *               the trunk did. The neck takes 35% of the turn and the head 65%. The eyes take what the head leaves of the
 *               gaze (`eyesFor`, after any rate limit the stage puts on the finished bones).
 *
 * Nothing allocates (module scratch only), nothing reads a clock, and nothing here sees the ball, the plan or the
 * result: only the baked channels and the pose.
 */
import P from '../params.json';
import { CH } from '../channels';
import { soft } from '../bake';
import { DRAWN, FACE, smooth, type Seam } from './face';
import { addBoneRotation, type SampledPose } from '../../../clips';

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;
/** Eyeball radius (m): the iris moves R sin(angle) across the painted eye. */
export const EYEBALL_R = 0.0115;

const E3: [number, number, number] = [0, 0, 0];

/**
 * Breath, sway and the hips' roll (the `life` channels, `w` = a fade weight 0..1; the channels are already zero in
 * Reduced Motion and in the quiet windows): the chest and spine extend on the inhale, the root shifts a few millimetres
 * and the hips roll a degree with the spine counter-rolled so the shoulders stay nearer level. `scale` is the rig's.
 */
export function applyLife(pose: SampledPose, ch: Float32Array, w: number, scale: number): void {
  const b = ch[CH.breath] * w;
  const sx = ch[CH.swayX] * w;
  const sz = ch[CH.swayZ] * w;
  const sr = ch[CH.swayRoll] * w;
  const po = ch[CH.posture] * w;
  const tw = ch[CH.twist] * w;
  if (b === 0 && sx === 0 && sz === 0 && sr === 0 && po === 0 && tw === 0) return;
  pose.root[0] += sx / 1000 / scale;
  pose.root[2] += sz / 1000 / scale;
  if (sr !== 0) {
    add(pose, 'hips', 0, 0, sr);
    add(pose, 'spine', 0, 0, -0.6 * sr);
  }
  if (po !== 0) {
    // posture (P3): + lifts the chest (leans the trunk back, 60% in the chest, 40% in the spine), - lets the shoulders drop
    add(pose, 'spine', -0.4 * po, 0, 0);
    add(pose, 'chest', -0.6 * po, 0, 0);
  }
  if (tw !== 0) {
    // twist (P3): + turns the upper body to the left (+ Y turns left), 40% in the spine, 60% in the chest
    add(pose, 'spine', 0, 0.4 * tw, 0);
    add(pose, 'chest', 0, 0.6 * tw, 0);
  }
  if (b !== 0) {
    // + X leans forward: an inhale lifts the chest, so it is the other way.
    add(pose, 'chest', -0.65 * b, 0, 0);
    add(pose, 'spine', -0.35 * b, 0, 0);
  }
}

/** A rotation of `bone` by Euler degrees (x, y, z), through the one scratch triple. */
function add(pose: SampledPose, bone: Parameters<typeof addBoneRotation>[1], x: number, y: number, z: number): void {
  E3[0] = x;
  E3[1] = y;
  E3[2] = z;
  addBoneRotation(pose, bone, E3, 1);
}

// ---------------------------------------------------------------------------------------------------------------
// Quaternions on scratch (x, y, z, w). No allocation.
// ---------------------------------------------------------------------------------------------------------------

/** out = a * b (out may not alias a or b). */
function mul(a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number, out: Float64Array, oo: number): void {
  const ax = a[ao], ay = a[ao + 1], az = a[ao + 2], aw = a[ao + 3];
  const bx = b[bo], by = b[bo + 1], bz = b[bo + 2], bw = b[bo + 3];
  out[oo] = aw * bx + ax * bw + ay * bz - az * by;
  out[oo + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[oo + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[oo + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** Scratch: five accumulated rotations (hips, spine, chest, neck, head) and four more for the turn being built. */
const Q = new Float64Array(5 * 4);
const R = new Float64Array(4);
const R2 = new Float64Array(4);
const V = new Float64Array(3);
/** [d, up] of the head. */
const D = new Float64Array(3);
const U = new Float64Array(3);

/** Rotates (x, y, z) by the conjugate of q (q[qo..]) into V. */
function invRot(q: ArrayLike<number>, qo: number, x: number, y: number, z: number): void {
  const qx = -q[qo], qy = -q[qo + 1], qz = -q[qo + 2], qw = q[qo + 3];
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  V[0] = x + qw * tx + (qy * tz - qz * ty);
  V[1] = y + qw * ty + (qz * tx - qx * tz);
  V[2] = z + qw * tz + (qx * ty - qy * tx);
}

const wrap180 = (x: number): number => (x > 180 ? x - 360 : x < -180 ? x + 360 : x);
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** q[bi] = axis_angle(axis, angle) * q[bi] (a bone's new local rotation). */
function turnBone(q: { [i: number]: number }, bi: number, ax: number, ay: number, az: number, angle: number): void {
  const h = angle * 0.5;
  const s = Math.sin(h);
  R[0] = ax * s;
  R[1] = ay * s;
  R[2] = az * s;
  R[3] = Math.cos(h);
  mul(R, 0, q as ArrayLike<number>, bi * 4, R2, 0);
  const n = Math.hypot(R2[0], R2[1], R2[2], R2[3]) || 1;
  q[bi * 4] = R2[0] / n;
  q[bi * 4 + 1] = R2[1] / n;
  q[bi * 4 + 2] = R2[2] / n;
  q[bi * 4 + 3] = R2[3] / n;
}

export interface HeadFrame {
  /** The drawn actor's heading (rad) and role: see face.ts. */
  heading: number;
  bowler: boolean;
}

/**
 * What `turnHead` and `eyesFor` measured and decided (for the tests and the probes; the stage reads `FACE`). `clamped`:
 * the neck's range kept the head short of the plan's head in space; `limited` is set by the stage when its rate limit
 * held a bone back.
 */
export const HEAD = { yaw: 0, pitch: 0, roll: 0, dYaw: 0, dPitch: 0, dRoll: 0, eyeYaw: 0, eyePitch: 0, clamped: false, limited: false };

const QY = new Float64Array(4);
const QP = new Float64Array(4);
const QR = new Float64Array(4);
const QT = new Float64Array(4);
const QS = new Float64Array(4);

/** Rotates (x, y, z) by q (q[qo..]) into V. */
function rot(q: ArrayLike<number>, qo: number, x: number, y: number, z: number): void {
  const qx = q[qo], qy = q[qo + 1], qz = q[qo + 2], qw = q[qo + 3];
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  V[0] = x + qw * tx + (qy * tz - qz * ty);
  V[1] = y + qw * ty + (qz * tx - qx * tz);
  V[2] = z + qw * tz + (qx * ty - qy * tx);
}

/** The accumulated rotations hips, spine, chest, neck, head into `Q` (parent before child). */
function chain(q: { [i: number]: number }): void {
  Q[0] = q[0]; Q[1] = q[1]; Q[2] = q[2]; Q[3] = q[3];
  for (let i = 1; i < 5; i++) {
    mul(Q, (i - 1) * 4, q as ArrayLike<number>, i * 4, QT, 0);
    Q[i * 4] = QT[0]; Q[i * 4 + 1] = QT[1]; Q[i * 4 + 2] = QT[2]; Q[i * 4 + 3] = QT[3];
  }
}

/** The head's line of sight and up (the head's +z and +y) from `Q`, into D and U. */
function headAxes(): void {
  const hx = Q[16], hy = Q[17], hz = Q[18], hw = Q[19];
  D[0] = 2 * (hx * hz + hw * hy);
  D[1] = 2 * (hy * hz - hw * hx);
  D[2] = 1 - 2 * (hx * hx + hy * hy);
  U[0] = 2 * (hx * hy - hw * hz);
  U[1] = 1 - 2 * (hx * hx + hz * hz);
  U[2] = 2 * (hy * hz + hw * hx);
}

const RA: [number, number] = [0, 0];

/** The line of sight D in the role's world frame: yaw (+ left) and pitch (+ down) in degrees (into a module tuple, no allocation). */
function roleAngles(f: HeadFrame): [number, number] {
  const c = Math.cos(f.heading);
  const s = Math.sin(f.heading);
  const wx = c * D[0] + s * D[2];
  const wz = -s * D[0] + c * D[2];
  RA[0] = (f.bowler ? Math.atan2(wx, wz) : Math.atan2(-wx, -wz)) * DEG;
  RA[1] = Math.atan2(-D[1], Math.hypot(wx, wz)) * DEG;
  return RA;
}

/** The roll of the head about its line of sight against the level (+ to the right shoulder), degrees, from D and U (`headAxes`). */
function rollOf(): number {
  const lx0 = -D[1] * D[0];
  const ly0 = 1 - D[1] * D[1];
  const lz0 = -D[1] * D[2];
  const ll = Math.hypot(lx0, ly0, lz0);
  if (ll <= 1e-4) return 0;
  const lx = lx0 / ll, ly = ly0 / ll, lz = lz0 / ll;
  const sinr = (ly * U[2] - lz * U[1]) * D[0] + (lz * U[0] - lx * U[2]) * D[1] + (lx * U[1] - ly * U[0]) * D[2];
  return Math.atan2(sinr, lx * U[0] + ly * U[1] + lz * U[2]) * DEG;
}

/** Remembers the head the pass ended with (`DRAWN`), for the next script's first frames (the seam). D, U and the role angles are current. */
function remember(f: HeadFrame, yaw: number, pitch: number): void {
  const d = f.bowler ? DRAWN.bowler : DRAWN.striker;
  d.ok = true;
  d.yaw = yaw;
  d.pitch = pitch;
  d.roll = rollOf();
}

/**
 * The head pass on a pose that has no plan (a delivery's first frames, before its plans are baked): only `remember`s the head
 * as it ends up, so the next script can continue from it. `q`: bones 0..4 of the rig, drawn form.
 */
export function noteDrawn(q: { [i: number]: number }, f: HeadFrame): void {
  chain(q);
  headAxes();
  const ra = roleAngles(f);
  remember(f, ra[0], ra[1]);
}

/**
 * The neck's range relative to the chest (degrees): yaw either way, pitch down and up. The clips use up to 72 (striker)
 * and 86 (bowler) of yaw and 39 down, 42 up (probe p6-neckrange, 192 deliveries): the range is theirs plus a margin.
 */
const NECK = { yaw0: 85, yaw1: 165, down: 55, up: 60 };

const ROLE: [number, number] = [0, 0];

/** A limit that passes everything up to 90% of it unchanged (the clips themselves reach that far) and eases into the rest. */
function knee(x: number, limit: number): number {
  const a = 0.9 * limit;
  const t = x < 0 ? -x : x;
  if (t <= a) return x;
  const y = a + (limit - a) * Math.tanh((t - a) / (limit - a));
  return x < 0 ? -y : y;
}

/**
 * Where the head goes for a target `x` degrees to one side of the chest's front: there, up to the neck's yaw range;
 * and as the target goes round behind him (a bowler turning to walk back) it returns to the front instead of holding
 * the extreme twist, smoothly (no jump as the target passes behind). Continuous, with slope 1 up to the range.
 */
function yawReach(x: number): number {
  const t = x < 0 ? -x : x;
  if (t <= NECK.yaw0) return x;
  const u = Math.min(1, (t - NECK.yaw0) / (NECK.yaw1 - NECK.yaw0));
  const y = t * (1 - u * u * (3 - 2 * u));
  return x < 0 ? -y : y;
}

/**
 * The plan's head in space (role yaw, pitch) brought inside the neck's range: the direction in the chest's frame, its
 * yaw and pitch limited softly, and back. Inside the range it is the plan's own, to rounding.
 */
function reachable(f: HeadFrame, yaw: number, pitch: number): [number, number] {
  // role -> world -> actor-local direction
  const cy = Math.cos(yaw * RAD), sy = Math.sin(yaw * RAD), cp = Math.cos(pitch * RAD), sp = Math.sin(pitch * RAD);
  const wx = (f.bowler ? 1 : -1) * sy * cp;
  const wz = (f.bowler ? 1 : -1) * cy * cp;
  const c = Math.cos(f.heading);
  const s = Math.sin(f.heading);
  const lx = c * wx - s * wz;
  const lz = s * wx + c * wz;
  // into the chest's frame (Q index 2 is the accumulated chest rotation)
  invRot(Q, 8, lx, -sp, lz);
  const vx = V[0], vy = V[1], vz = V[2];
  const yc = Math.atan2(vx, vz) * DEG;
  const pc = Math.atan2(-vy, Math.hypot(vx, vz)) * DEG;
  const mid = (NECK.down - NECK.up) / 2;
  const half = (NECK.down + NECK.up) / 2;
  const y2 = yawReach(yc);
  // A look that has to be pulled back towards the chest's front (a bowler who has turned away and walks back, with the plan still
  // on the batter behind him) keeps the WORLD pitch the plan wants, not the pitch it had in the chest's frame: that one was
  // measured for a direction behind the chest, which a chest that leans or arches puts far below the horizon (64 degrees for a
  // plan of 24), and once clamped to the neck's range it hung the head straight down (85 degrees) and left its yaw to the sliver of
  // horizontal that is left, which flips by 180 degrees (the 106 degrees a frame of the head, 61 of the neck). The share of the pull
  // rises with it, 0 at the edge of the free range and 1 where the head is back at the front, so nothing jumps.
  // (the sine of the chest front's pitch along the pulled yaw is its height in the world, V[1])
  const cy2 = Math.cos(y2 * RAD), sy2 = Math.sin(y2 * RAD);
  rot(Q, 8, sy2, 0, cy2);
  const pk = pc + (pitch + Math.asin(clamp(V[1], -1, 1)) * DEG - pc) * smooth((Math.abs(yc) - NECK.yaw0) / (NECK.yaw1 - NECK.yaw0));
  const p2 = knee(pk - mid, half) + mid;
  if (Math.abs(y2 - yc) < 1e-9 && Math.abs(p2 - pc) < 1e-9) {
    HEAD.clamped = false;
    ROLE[0] = yaw;
    ROLE[1] = pitch;
    return ROLE;
  }
  HEAD.clamped = true;
  // back out: chest frame -> actor-local -> world -> role
  const cp2 = Math.cos(p2 * RAD), sp2 = Math.sin(p2 * RAD);
  rot(Q, 8, sy2 * cp2, -sp2, cy2 * cp2);
  const ax = V[0], ay = V[1], az = V[2];
  const wx2 = c * ax + s * az;
  const wz2 = -s * ax + c * az;
  ROLE[0] = (f.bowler ? Math.atan2(wx2, wz2) : Math.atan2(-wx2, -wz2)) * DEG;
  ROLE[1] = Math.atan2(-ay, Math.hypot(wx2, wz2)) * DEG;
  return ROLE;
}

/**
 * Closes the loop on the head: where the head of `q` (bones 0..4 of the rig, drawn form) points now (role frame: yaw +
 * left, pitch + down, roll + right), where the channels want it (`CH.headYaw/Pitch/Roll`, the head in space) as far as
 * the neck can turn, and the neck and head turned the rest of the way (halved in Reduced Motion, scaled by the fade
 * `w`). Rewrites bones 3 and 4 of `q`.
 */
export function turnHead(q: { [i: number]: number }, ch: Float32Array | null, f: HeadFrame, rm: boolean, w: number, seam: Seam | null = null): void {
  const H = P.head;
  chain(q);
  headAxes();
  const ra = roleAngles(f);
  const yawA = ra[0];
  const pitchA = ra[1];
  // Roll about the line of sight against the level (+ to the right shoulder).
  const rollA = rollOf();
  // The seam (P3): the first frame of a script that follows another finds how far its head is from the one the scene before
  // ended with, and the pass gives that back, a smaller share of it every frame.
  if (seam && seam.pending) {
    seam.oy = wrap180(seam.h0y - yawA);
    seam.op = seam.h0p - pitchA;
    seam.or = seam.h0r - rollA;
    seam.pending = false;
  }
  let dY = 0;
  let dP = 0;
  let dR = 0;
  if (ch) {
    const gain = rm ? H.rmGainX : 1;
    const rt = reachable(f, ch[CH.headYaw], ch[CH.headPitch]);
    dY = gain * wrap180(rt[0] - yawA) * w;
    dP = gain * (rt[1] - pitchA) * w;
    dR = soft(gain * (ch[CH.headRoll] - rollA), H.limitDeg[2]) * w;
  }
  if (seam) {
    dY += seam.oy * seam.k;
    dP += seam.op * seam.k;
    dR += seam.or * seam.k;
  }
  HEAD.yaw = yawA; HEAD.pitch = pitchA; HEAD.roll = rollA; HEAD.dYaw = dY; HEAD.dPitch = dP; HEAD.dRoll = dR;
  if (dY === 0 && dP === 0 && dR === 0) return;
  // One rotation in the local frame: yaw about the vertical, then pitch about the new left axis, then roll about the
  // new line of sight (the order that keeps the head level, which is how a head turns).
  const phi = dY * RAD;
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  QY[0] = 0; QY[1] = Math.sin(phi * 0.5); QY[2] = 0; QY[3] = Math.cos(phi * 0.5);
  const d1x = cp * D[0] + sp * D[2];
  const d1y = D[1];
  const d1z = -sp * D[0] + cp * D[2];
  const hl = Math.hypot(d1x, d1z);
  const ax = hl > 1e-6 ? d1z / hl : 1;
  const az = hl > 1e-6 ? -d1x / hl : 0;
  const th = dP * RAD;
  const st = Math.sin(th * 0.5);
  QP[0] = ax * st; QP[1] = 0; QP[2] = az * st; QP[3] = Math.cos(th * 0.5);
  // the line of sight after the pitch (Rodrigues about the left axis)
  const ct = Math.cos(th);
  const sn = Math.sin(th);
  const dot = ax * d1x + az * d1z;
  const cxr = -az * d1y;
  const cyr = az * d1x - ax * d1z;
  const czr = ax * d1y;
  let ex = d1x * ct + cxr * sn + ax * dot * (1 - ct);
  let ey = d1y * ct + cyr * sn;
  let ez = d1z * ct + czr * sn + az * dot * (1 - ct);
  const el = Math.hypot(ex, ey, ez) || 1;
  ex /= el; ey /= el; ez /= el;
  const rh = dR * RAD * 0.5;
  const sr = Math.sin(rh);
  QR[0] = ex * sr; QR[1] = ey * sr; QR[2] = ez * sr; QR[3] = Math.cos(rh);
  // R = roll * pitch * yaw
  mul(QP, 0, QY, 0, QT, 0);
  mul(QR, 0, QT, 0, QS, 0);
  let rw = QS[3];
  let rxx = QS[0], ryy = QS[1], rzz = QS[2];
  if (rw < 0) { rw = -rw; rxx = -rxx; ryy = -ryy; rzz = -rzz; }
  const sh = Math.hypot(rxx, ryy, rzz);
  if (sh <= 1e-9) return;
  // The turn is shared between the neck and the head as one rotation about an axis, and at exactly 180 degrees that axis has two answers,
  // opposite to each other: a head turned 179.9 degrees about one is turned 179.9 about the other a frame later (the neck's 61 and the
  // head's 106 degrees in one frame, 126 with a chest leaned 45 degrees or more). No correction the neck can make is that big, so a turn
  // within 29 degrees of it is eased to nothing as it nears it; every smaller turn (all of those in play) is untouched.
  let angle = 2 * Math.atan2(sh, rw);
  angle *= smooth((Math.PI - angle) * 2);
  const kx = rxx / sh, ky = ryy / sh, kz = rzz / sh;
  // The neck takes its share about the axis seen from the chest's frame, the head the rest about the axis seen from
  // the neck's (as it was): new local = (parent^-1 * turn * parent) * local.
  const share = H.neckShare;
  invRot(Q, 8, kx, ky, kz);
  turnBone(q, 3, V[0], V[1], V[2], angle * share);
  invRot(Q, 12, kx, ky, kz);
  turnBone(q, 4, V[0], V[1], V[2], angle * (1 - share));
}

/**
 * The eyes and the face from the bones as they now are (after `turnHead` and any limit on it): the eyes take what the
 * head leaves of the gaze (`CH.gazeYaw/Pitch`) within the eye's range (10 degrees in Reduced Motion); `FACE` gets the
 * lids (the upper lid follows a downward look) and the iris offset, for the shader.
 */
export function eyesFor(q: { [i: number]: number }, ch: Float32Array, f: HeadFrame, rm: boolean): void {
  const G = P.gaze;
  chain(q);
  headAxes();
  const rb = roleAngles(f);
  const headYaw = rb[0];
  const headPitch = rb[1];
  remember(f, headYaw, headPitch);
  const eyeY = rm ? G.eyeRmDeg : G.eyeYawDeg;
  const eyeP = rm ? G.eyeRmDeg : G.eyePitchDeg;
  const eYaw = soft(wrap180(ch[CH.gazeYaw] - headYaw), eyeY);
  const ePitch = soft(ch[CH.gazePitch] - headPitch, eyeP);
  HEAD.eyeYaw = eYaw;
  HEAD.eyePitch = ePitch;
  const follow = Math.max(0, clamp(ePitch / 30, -1, 1) * 0.5);
  const lidL = ch[CH.blinkL];
  const lidR = ch[CH.blinkR];
  FACE.valid = true;
  FACE.lidL = lidL + (1 - lidL) * 0.4 * follow;
  FACE.lidR = lidR + (1 - lidR) * 0.4 * follow;
  // Role yaw + is a turn about the vertical in the sense of the rig's own left (the rig mesh is never mirrored): the
  // iris moves +x for a look to the left and -y for a look down.
  FACE.gx = EYEBALL_R * Math.sin(eYaw * RAD);
  FACE.gy = -EYEBALL_R * Math.sin(ePitch * RAD);
  mixFace(ch);
}

const WX = new Float64Array(5);
/** One of the shader's four expression numbers from the five weights in `WX`, times the gain, kept inside the shader's range. */
function mixAt(k: number): number {
  const M = P.expr.mix;
  return clamp(P.expr.gain * (M.concentration[k] * WX[0] + M.effort[k] * WX[1] + M.frustration[k] * WX[2] + M.relief[k] * WX[3] + M.celebration[k] * WX[4]), -1, 1);
}

/**
 * The expression mixer (P3): the five weights (concentration, effort, frustration, relief, celebration; zero below the detail
 * level that shows a face) times the rows of the shader's own table (players.ts EXPRESSIONS, copied into params.json), restrained
 * by `expr.gain` and kept inside the shader's range.
 */
function mixFace(ch: Float32Array): void {
  const w0 = ch[CH.xConcentration];
  const w1 = ch[CH.xEffort];
  const w2 = ch[CH.xFrustration];
  const w3 = ch[CH.xRelief];
  const w4 = ch[CH.xCelebration];
  if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0) {
    FACE.ex = FACE.ey = FACE.ez = FACE.ew = 0;
    return;
  }
  WX[0] = w0;
  WX[1] = w1;
  WX[2] = w2;
  WX[3] = w3;
  WX[4] = w4;
  FACE.ex = mixAt(0);
  FACE.ey = mixAt(1);
  FACE.ez = mixAt(2);
  FACE.ew = mixAt(3);
}

/** `turnHead` then `eyesFor`: the whole head pass on bones that need no further limit (the tests, the probes). */
export function applyHead(q: { [i: number]: number }, ch: Float32Array, f: HeadFrame, rm: boolean, w: number): void {
  turnHead(q, ch, f, rm, w);
  eyesFor(q, ch, f, rm);
}
