/**
 * The virtual bat: kinematics of a right-handed batter's bat from a NormalizedSwing, as a continuous track that can
 * be sampled at any t (grip, toe, face). Also the batter's body (pads, torso, head) for pad, body and LBW contact.
 *
 * Model (docs/PRACTICE_PHYSICS.md, "Virtual bat"):
 *  - Footwork: automatic from the delivery's length (forward to full, back to short), or manual when given.
 *  - The batter reads the ball: he places the bat where the flight he has seen says the ball will cross his contact
 *    plane. Learn tracks the real ball; Play commits 40 ms and Real 80 ms before the bat arrives, predicting from
 *    the ball's state then (gravity, drag and a normal bounce, no swing, seam or turn), so late movement beats him.
 *  - The face is set so a perfect sweet-spot hit leaves in the intended direction (flick bearing and elevation).
 *  - The bat reaches the zone at startT + batTravelMs (Learn/Play: at idealT + forgive(error), see timing.ts) and
 *    moves along the ball's line at the speed that gives the face the flick's bat speed. Timing error moves it
 *    across the line (drift) and rotates the face at fixed rates: late leaves the bat behind its drift with the face
 *    open (outside edge for off-side and straight strokes, inside edge for leg-side ones; top edge on the pull),
 *    early puts it ahead with the face closed (inside edge, leading edge, ball to leg), and both lift it (toe).
 */
import type {
  AssistLevel,
  BallFlight,
  BatSample,
  Footwork,
  NormalizedSwing,
  PlayedFootwork,
  SwingKind,
} from '@/contracts/practice';
import {
  BALL_R,
  BAT_EFF_MASS,
  COMMIT_BEFORE_MS,
  DEFEND_FACE_YAW_DEG_PER_MS,
  DRIFT_M_PER_MS,
  FACE_TILT_DEG_PER_MS,
  FACE_YAW_DEG_PER_MS,
  LIFT_M_PER_MS2,
  PHYSICAL_BANDS,
  BAT_FRICTION,
  BAT_COR,
  BAT_SPEED,
  BAT_TRAVEL_MS,
  BLADE_L,
  BLADE_T,
  BODY,
  CONTACT_PLANE_M,
  DEFEND_COR,
  DEFEND_EFF_MASS,
  HANDLE_L,
  PITCH_HALF,
  SWEET_U,
} from './constants';
import { contactPlaneZ, sampleAt, timeAtZ } from './delivery';
import { impact } from './impact';
import { activeBands, forgive } from './timing';
import {
  type Vec3,
  UP,
  DEG,
  bearingDeg,
  clamp,
  cross,
  dirFromBearing,
  dtanh,
  dot,
  elevationDeg,
  len,
  norm,
  rotate,
  smooth01,
  v3,
} from './vec';

/** The one formula for the virtual bat's travel (ms) from swing start to the contact zone. */
export function batTravelMs(kind: SwingKind, power: number): number {
  if (kind === 'defend') return BAT_TRAVEL_MS.defend;
  return BAT_TRAVEL_MS.attackMin + BAT_TRAVEL_MS.attackRange * clamp(power, 0, 1);
}

/** Bat speed at the sweet spot (m/s) for a swing. */
export function batSpeed(kind: SwingKind, power: number): number {
  if (kind === 'defend') return BAT_SPEED.defend;
  return BAT_SPEED.attackMin + BAT_SPEED.attackRange * clamp(power, 0, 1);
}

/** Exit elevation the face is set for (deg): defence keeps it down; attack from a hit-down drive to a lofted one. */
export function targetElevationDeg(kind: SwingKind, elevation: number): number {
  return kind === 'defend' ? -14 : -3 + 38 * clamp(elevation, 0, 1);
}

// ---------------------------------------------------------------------------------------------------------------
// Footwork and the batter's body
// ---------------------------------------------------------------------------------------------------------------

/** The footwork actually played: manual as given, automatic resolved from the flight's ideal contact plane. */
export function resolveFootwork(flight: BallFlight, footwork: Footwork): PlayedFootwork {
  if (footwork !== 'auto') return footwork;
  const z = sampleAt(flight.samples, flight.idealContactT).p.z;
  return Math.abs(z - (PITCH_HALF - CONTACT_PLANE_M.forward)) < 0.05 ? 'forward' : 'back';
}

/** Ideal contact time for the footwork played (auto = the flight's idealContactT). */
export function idealTimeFor(flight: BallFlight, footwork: Footwork): number {
  if (footwork === 'auto') return flight.idealContactT;
  return timeAtZ(flight.samples, contactPlaneZ(footwork)) ?? flight.idealContactT;
}

export interface Capsule {
  a: Vec3;
  b: Vec3;
  r: number;
}

export interface BatterBody {
  /** Footwork the body is placed for (null: the stance, i.e. a leave). */
  footwork: PlayedFootwork | null;
  /** Centre between the feet on the ground. */
  stance: Vec3;
  /** Front pad, then back pad (vertical capsules). */
  pads: [Capsule, Capsule];
  torso: Capsule;
  head: { c: Vec3; r: number };
}

function pad(x: number, z: number): Capsule {
  return { a: v3(x, BODY.padBottom, z), b: v3(x, BODY.padTop, z), r: BODY.padR };
}

/**
 * The batter's body in the striker's frame, exactly as the pad, body and LBW collisions use it. For a stroke the
 * stride goes to the line of the ball at the contact plane (front pad just inside the line, bat beside it).
 */
export function batterBody(footwork: PlayedFootwork | null, flight?: BallFlight): BatterBody {
  if (!footwork || !flight) {
    const front = pad(-0.16, PITCH_HALF - 1.44);
    const back = pad(-0.14, PITCH_HALF - 0.76);
    return {
      footwork: null,
      stance: v3(-0.15, 0, PITCH_HALF - 1.1),
      pads: [front, back],
      torso: { a: v3(-0.3, BODY.torsoBottom, PITCH_HALF - 1.08), b: v3(-0.3, BODY.torsoTop, PITCH_HALF - 1.12), r: BODY.torsoR },
      head: { c: v3(-0.2, BODY.headY, PITCH_HALF - 1.2), r: BODY.headR },
    };
  }
  const t = idealTimeFor(flight, footwork === 'forward' || footwork === 'back' ? resolveAutoMatch(flight, footwork) : footwork);
  const c = sampleAt(flight.samples, t).p;
  const zc = footwork === 'forward' || footwork === 'back' ? c.z : contactPlaneZ(footwork);
  const x = clamp(c.x, -0.6, 0.75);
  let front: Capsule;
  let back: Capsule;
  let tx: number;
  let tz: number;
  let head: Vec3;
  switch (footwork) {
    case 'forward':
    case 'down_track':
      front = pad(x - 0.17, zc + 0.12);
      back = footwork === 'forward' ? pad(-0.14, PITCH_HALF - 0.72) : pad(x - 0.35, zc + 0.7);
      tx = x - 0.3;
      tz = zc + 0.45;
      head = v3(x - 0.12, BODY.headY - 0.1, zc + 0.25);
      break;
    case 'back':
      back = pad(x - 0.18, zc + 0.12);
      front = pad(x - 0.32, zc - 0.25);
      tx = x - 0.32;
      tz = zc + 0.25;
      head = v3(x - 0.18, BODY.headY, zc + 0.1);
      break;
    case 'across':
      back = pad(x - 0.15, zc + 0.15);
      front = pad(x - 0.28, zc - 0.3);
      tx = x - 0.3;
      tz = zc + 0.25;
      head = v3(x - 0.15, BODY.headY, zc + 0.1);
      break;
  }
  return {
    footwork,
    stance: v3((front.a.x + back.a.x) / 2, 0, (front.a.z + back.a.z) / 2),
    pads: [front, back],
    torso: { a: v3(tx, BODY.torsoBottom, tz), b: v3(tx + 0.04, BODY.torsoTop, tz - 0.06), r: BODY.torsoR },
    head: { c: head, r: BODY.headR },
  };
}

/** Forward/back may be the automatic choice or a manual one; both use that footwork's own plane. */
function resolveAutoMatch(flight: BallFlight, footwork: 'forward' | 'back'): Footwork {
  return resolveFootwork(flight, 'auto') === footwork ? 'auto' : footwork;
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the ball and setting the face
// ---------------------------------------------------------------------------------------------------------------

export interface BallRead {
  /** Where (and how fast, which way) the batter expects the ball at his contact plane. */
  c: Vec3;
  u: Vec3;
}

/**
 * The batter's read: the ball crossing plane z, as judged at commitT (null = tracks the real ball). He judges length,
 * bounce and pace from the flight he has seen (height and arrival are the real ones), but the line is his
 * extrapolation of the ball's sideways motion at commitT: swing, drift, seam or turn after that point beat him.
 */
export function readBall(flight: BallFlight, zPlane: number, commitT: number | null): BallRead {
  const tReal = timeAtZ(flight.samples, zPlane) ?? flight.samples[flight.samples.length - 1].t;
  const real = sampleAt(flight.samples, tReal);
  if (commitT === null || commitT >= tReal) return { c: real.p, u: real.v };
  const s = sampleAt(flight.samples, Math.max(0, commitT));
  const x = s.p.x + s.v.x * (tReal - s.t);
  return { c: v3(x, real.p.y, real.p.z), u: v3(s.v.x, real.v.y, real.v.z) };
}

/** Incoming spin at the bat (after the bounce if the ball pitched before tContact). */
export function incomingSpin(flight: BallFlight, tContact: number): Vec3 {
  if (flight.bounce && tContact > flight.bounce.t && flight.spin.afterBounce) return flight.spin.afterBounce;
  return flight.spin.release;
}

export interface FaceSolve {
  n: Vec3;
  vLine: number;
  exit: Vec3;
}

/** Defensive face: square to the ball's line, angled gently towards the aim, tilted down to kill the ball. */
export const DEFEND_TILT_DEG = 8;
export const DEFEND_ANGLE_FRACTION = 0.08;

function exitFor(u: Vec3, spin: Vec3, back: Vec3, nb: number, ne: number, speed: number, mass: number, cor: number): { n: Vec3; vLine: number; exit: Vec3 } {
  const n = dirFromBearing(nb, ne);
  const along = clamp(dot(back, n), 0.55, 1);
  const vLine = Math.min(speed / along, speed * 1.6);
  const sv = v3(back.x * vLine, back.y * vLine, back.z * vLine);
  return { n, vLine, exit: impact({ v: u, spin, n, surfaceV: sv, mass, cor, friction: BAT_FRICTION }).v };
}

function wrap(d: number): number {
  let x = d % 360;
  if (x > 180) x -= 360;
  if (x < -180) x += 360;
  return x;
}

/**
 * Face normal for the swing. Attack: the face for which a sweet-spot hit sends the ball at (bearing, elevation),
 * the bat moving along the ball's line at the speed that gives the face the swing's bat speed (damped Newton on the
 * two face angles). Defence: a dead bat presented square to the line, DEFEND_ANGLE_FRACTION of the way towards the
 * aim and DEFEND_TILT_DEG over the ball, so the block drops in front of the batter.
 */
export function solveFace(u: Vec3, spin: Vec3, bearing: number, elevation: number, kind: SwingKind, speed: number, balance: number): FaceSolve {
  const back = norm(v3(-u.x, -u.y, -u.z));
  const mass = (kind === 'defend' ? DEFEND_EFF_MASS : BAT_EFF_MASS) * balance;
  const cor = (kind === 'defend' ? DEFEND_COR : BAT_COR) * (0.9 + 0.1 * balance);
  if (kind === 'defend') {
    const lineB = bearingDeg(back.x, back.z);
    const nb = lineB + DEFEND_ANGLE_FRACTION * clamp(wrap(bearing - lineB), -40, 40);
    const ne = elevationDeg(back) - DEFEND_TILT_DEG;
    const r = exitFor(u, spin, back, nb, ne, speed, mass, cor);
    return { n: r.n, vLine: speed, exit: r.exit };
  }
  const tb = clamp(bearing, -150, 150);
  const target = (nb: number, ne: number) => {
    const r = exitFor(u, spin, back, nb, ne, speed, mass, cor);
    return { r, fb: wrap(bearingDeg(r.exit.x, r.exit.z) - tb), fe: elevationDeg(r.exit) - elevation };
  };
  let nb = clamp(tb * 0.6, -100, 100);
  let ne = elevation * 0.5;
  let cur = target(nb, ne);
  const h = 0.25;
  for (let it = 0; it < 20; it++) {
    if (Math.abs(cur.fb) < 0.02 && Math.abs(cur.fe) < 0.02) break;
    const pb = target(nb + h, ne);
    const pe = target(nb, ne + h);
    const a = (pb.fb - cur.fb) / h;
    const b = (pe.fb - cur.fb) / h;
    const c = (pb.fe - cur.fe) / h;
    const d = (pe.fe - cur.fe) / h;
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-9) break;
    let db = (-cur.fb * d + cur.fe * b) / det;
    let de = (-a * cur.fe + c * cur.fb) / det;
    db = clamp(db, -12, 12);
    de = clamp(de, -12, 12);
    let lambda = 1;
    let accepted = false;
    for (let k = 0; k < 6; k++) {
      const tb2 = clamp(nb + lambda * db, -100, 100);
      const te2 = clamp(ne + lambda * de, -45, 60);
      const nx = target(tb2, te2);
      if (Math.abs(nx.fb) + Math.abs(nx.fe) < Math.abs(cur.fb) + Math.abs(cur.fe)) {
        nb = tb2;
        ne = te2;
        cur = nx;
        accepted = true;
        break;
      }
      lambda /= 2;
    }
    if (!accepted) break;
  }
  return { n: cur.r.n, vLine: cur.r.vLine, exit: cur.r.exit };
}

/** Unit blade axis (toe → grip) for a face normal: vertical bat, or horizontal for a cross-bat stroke (λ = 0..1). */
export function bladeAxis(n: Vec3, horizontal: number): Vec3 {
  const av = norm(v3(UP.x - dot(UP, n) * n.x, UP.y - dot(UP, n) * n.y, UP.z - dot(UP, n) * n.z));
  let ah = norm(cross(n, UP));
  if (ah.x > 0) ah = v3(-ah.x, -ah.y, -ah.z);
  const c = 1 - horizontal;
  const s = horizontal;
  const a = v3(av.x * c + ah.x * s, av.y * c + ah.y * s, av.z * c + ah.z * s);
  const d = dot(a, n);
  return norm(v3(a.x - d * n.x, a.y - d * n.y, a.z - d * n.z));
}

/** Blade geometry from the sweet spot on the face, the face normal and the blade axis. */
export function bladeFrom(sweet: Vec3, n: Vec3, a: Vec3): { centre: Vec3; toe: Vec3; grip: Vec3 } {
  const k = BLADE_L / 2 - SWEET_U * BLADE_L;
  const centre = v3(sweet.x - n.x * (BLADE_T / 2) + a.x * k, sweet.y - n.y * (BLADE_T / 2) + a.y * k, sweet.z - n.z * (BLADE_T / 2) + a.z * k);
  const toe = v3(centre.x - a.x * (BLADE_L / 2), centre.y - a.y * (BLADE_L / 2), centre.z - a.z * (BLADE_L / 2));
  const top = BLADE_L / 2 + HANDLE_L;
  const grip = v3(centre.x + a.x * top, centre.y + a.y * top, centre.z + a.z * top);
  return { centre, toe, grip };
}

// ---------------------------------------------------------------------------------------------------------------
// The bat track
// ---------------------------------------------------------------------------------------------------------------

export interface StrikeOptions {
  assist: AssistLevel;
  /** Assisted performance tier: extra tolerance (ms) on every band edge. */
  tierToleranceMs?: number;
}

/** A bat pose: grip (top of the handle), toe, face normal. */
export interface BatPose {
  grip: Vec3;
  toe: Vec3;
  n: Vec3;
}

export interface BatTrack {
  kind: SwingKind;
  startT: number;
  travelMs: number;
  /** startT + travel: when the player's swing reaches the zone. */
  arriveT: number;
  /** Ideal contact for the footwork played; the raw timing error (ms, + late) and the physical error the bat plays. */
  idealT: number;
  errorMs: number;
  physErrorMs: number;
  /** When the bat really reaches the zone: idealT + physErrorMs (= arriveT in Real with no tier tolerance). */
  effT: number;
  footwork: PlayedFootwork;
  balance: number;
  body: BatterBody;
  read: BallRead;
  commitT: number | null;
  /** At arrival: sweet spot on the face, face normal, blade axis (toe → grip). */
  sweet: Vec3;
  /** How far the bat was raised along its axis to keep the toe above the ground (low balls: contact nearer the toe). */
  toeShift: number;
  n: Vec3;
  a: Vec3;
  /** Ball direction and speed the bat plays along; the bat's speed along that line; the swing's bat speed. */
  uHat: Vec3;
  U: number;
  vLine: number;
  speed: number;
  /** Unit drift direction in the face plane, and the face's rotation rates (deg per ms of physical error). */
  drift: Vec3;
  yawRate: number;
  tiltRate: number;
  /** 0 = vertical bat … 1 = horizontal (pull, hook, cut). */
  horizontal: number;
  intendedBearing: number;
  targetElevation: number;
  zoneIn: number;
  zoneOut: number;
  stance: BatPose;
  backlift: BatPose;
  finish: BatPose;
}

const ZONE_TS = 0.05;
const ZONE_ERR_S = 0.15;
const ZONE_MIN_BLEND_S = 0.015;
const FOLLOW_S = 0.25;
const BAT_FULL = BLADE_L + HANDLE_L;

function balanceFor(flight: BallFlight, footwork: PlayedFootwork, auto: boolean): number {
  if (auto) return 1;
  const L = flight.plan.lengthM;
  if (footwork === 'forward' && L >= 7) return 0.75;
  if (footwork === 'back' && L <= 3.5) return 0.8;
  if (footwork === 'down_track' && flight.release.speedKph > 110) return 0.8;
  if (footwork === 'across') return 0.95;
  return 1;
}

function poseFromSweet(sweet: Vec3, n: Vec3, a: Vec3): BatPose {
  const b = bladeFrom(sweet, n, a);
  if (b.toe.y < 0.005) {
    const up = 0.005 - b.toe.y;
    return { grip: v3(b.grip.x, b.grip.y + up, b.grip.z), toe: v3(b.toe.x, 0.005, b.toe.z), n };
  }
  return { grip: b.grip, toe: b.toe, n };
}

function makePose(grip: Vec3, dir: Vec3, faceHint: Vec3): BatPose {
  const d = norm(dir);
  const toe = v3(grip.x + d.x * BAT_FULL, grip.y + d.y * BAT_FULL, grip.z + d.z * BAT_FULL);
  const a = v3(-d.x, -d.y, -d.z);
  const k = dot(faceHint, a);
  return { grip, toe, n: norm(v3(faceHint.x - k * a.x, faceHint.y - k * a.y, faceHint.z - k * a.z)) };
}

/** Build the bat track for a swing against a flight. Pure: same inputs, same track. */
export function buildBatTrack(flight: BallFlight, swing: NormalizedSwing, opts: StrikeOptions): BatTrack {
  const auto = swing.footwork === 'auto';
  const footwork = resolveFootwork(flight, swing.footwork);
  const idealT = idealTimeFor(flight, auto ? 'auto' : footwork);
  const travelMs = batTravelMs(swing.kind, swing.power);
  const arriveT = swing.startT + travelMs / 1000;
  const errorMs = (arriveT - idealT) * 1000;
  const physErrorMs = forgive(errorMs, activeBands(opts.assist, opts.tierToleranceMs ?? 0));
  const effT = idealT + physErrorMs / 1000;
  const commitMs = COMMIT_BEFORE_MS[opts.assist];
  const commitT = commitMs === null ? null : effT - commitMs / 1000;
  const zPlane = sampleAt(flight.samples, idealT).p.z;
  const read = readBall(flight, zPlane, commitT);
  const balance = balanceFor(flight, footwork, auto);
  const speed = batSpeed(swing.kind, swing.power);
  const targetElevation = targetElevationDeg(swing.kind, swing.elevation);
  const face = solveFace(read.u, incomingSpin(flight, idealT), swing.directionDeg, targetElevation, swing.kind, speed, balance);
  const n = face.n;
  const horizontal = swing.kind === 'attack' ? smooth01((read.c.y - 0.75) / 0.3) : 0;
  const a = bladeAxis(n, horizontal);
  let sweet = v3(read.c.x - n.x * BALL_R, read.c.y - n.y * BALL_R, read.c.z - n.z * BALL_R);
  const b0 = bladeFrom(sweet, n, a);
  let toeShift = 0;
  if (b0.toe.y < 0.005 && a.y > 0.05) {
    toeShift = (0.005 - b0.toe.y) / a.y;
    sweet = v3(sweet.x + a.x * toeShift, sweet.y + a.y * toeShift, sweet.z + a.z * toeShift);
  }
  const U = Math.max(1, len(read.u));
  const uHat = v3(read.u.x / U, read.u.y / U, read.u.z / U);
  let w = norm(cross(a, n));
  let drift: Vec3;
  if (horizontal < 0.5) {
    if (w.x < 0) w = v3(-w.x, -w.y, -w.z);
    drift = swing.directionDeg >= -15 ? w : v3(-w.x, -w.y, -w.z);
  } else {
    if (w.y < 0) w = v3(-w.x, -w.y, -w.z);
    drift = swing.directionDeg < 0 ? w : v3(-w.x, -w.y, -w.z);
  }
  const zoneHalf = (ZONE_ERR_S * U) / (U + face.vLine);
  // The zone opens after a natural backlift, but always early enough for a meeting at the edge band (a very late
  // assisted swing jabs down quickly), and never less than ZONE_MIN_BLEND_S after the swing starts.
  const edgeMeet = ((PHYSICAL_BANDS.edgeMs + 5) / 1000) * (U / (U + face.vLine));
  const zoneIn = Math.max(
    swing.startT + ZONE_MIN_BLEND_S,
    Math.min(Math.max(swing.startT + 0.35 * (effT - swing.startT), effT - zoneHalf), effT - edgeMeet),
  );
  const zoneOut = effT + zoneHalf;
  const body = batterBody(footwork, flight);
  // Before the swing the batter waits with the bat picked up behind him (out of the ball's path), as batters do
  // once the bowler is in his delivery stride; presentation may draw the grounded stance before release.
  const stance = makePose(v3(-0.2, 1.0, PITCH_HALF - 0.85), v3(0.1, 0.45, 0.88), v3(0, -0.88, 0.45));
  const defend = swing.kind === 'defend';
  const backGrip = v3(body.torso.a.x + 0.08, defend ? 1.0 : 1.18, body.torso.a.z + (defend ? 0.05 : 0.2));
  const backlift = defend
    ? makePose(backGrip, v3(0.1, -0.8, 0.35), v3(0, 0, -1))
    : makePose(backGrip, v3(0.12, 0.55, 0.82), v3(0, -0.6, 0.8));
  const finish = makePose(v3(body.head.c.x - 0.12, 1.42, body.head.c.z + 0.05), v3(-0.35, 0.55, 0.75), v3(0, 0.6, -0.8));
  return {
    kind: swing.kind,
    startT: swing.startT,
    travelMs,
    arriveT,
    idealT,
    errorMs,
    physErrorMs,
    effT,
    footwork,
    balance,
    body,
    read,
    commitT,
    sweet,
    toeShift,
    n,
    a,
    uHat,
    U,
    vLine: face.vLine,
    speed,
    drift,
    yawRate: defend ? DEFEND_FACE_YAW_DEG_PER_MS : FACE_YAW_DEG_PER_MS,
    tiltRate: defend ? FACE_TILT_DEG_PER_MS * 0.6 : FACE_TILT_DEG_PER_MS,
    horizontal,
    intendedBearing: swing.directionDeg,
    targetElevation,
    zoneIn,
    zoneOut,
    stance,
    backlift,
    finish,
  };
}

/**
 * The bat in the hitting zone at time t. The face rotates about the virtual ball centre Cv (where a ball on the read
 * line would touch the face at this moment), so the contact stays at the designed point: the ball meets the face
 * DRIFT_M_PER_MS × error across it (along the drift) and LIFT_M_PER_MS2 × error² towards the toe.
 */
export function zonePose(tr: BatTrack, t: number): BatPose {
  const tau = t - tr.effT;
  const s = tr.vLine * ZONE_TS * dtanh(tau / ZONE_TS);
  const eps = -1000 * (tau + s / tr.U);
  const yaw = -tr.yawRate * eps * DEG;
  let n = rotate(tr.n, UP, yaw);
  let a = rotate(tr.a, UP, yaw);
  let d = rotate(tr.drift, UP, yaw);
  const wh = norm(cross(UP, n));
  const tilt = tr.tiltRate * eps * DEG;
  if (len(wh) > 0.5) {
    n = rotate(n, wh, tilt);
    a = rotate(a, wh, tilt);
    d = rotate(d, wh, tilt);
  }
  const dr = -DRIFT_M_PER_MS * eps;
  const up = LIFT_M_PER_MS2 * eps * eps + tr.toeShift;
  const c = tr.read.c;
  const S = v3(
    c.x - tr.uHat.x * s - n.x * BALL_R + d.x * dr + a.x * up,
    c.y - tr.uHat.y * s - n.y * BALL_R + d.y * dr + a.y * up,
    c.z - tr.uHat.z * s - n.z * BALL_R + d.z * dr + a.z * up,
  );
  return poseFromSweet(S, n, a);
}

function blend(p: BatPose, q: BatPose, f: number): BatPose {
  const g = smooth01(f);
  const toe = v3(p.toe.x + (q.toe.x - p.toe.x) * g, p.toe.y + (q.toe.y - p.toe.y) * g, p.toe.z + (q.toe.z - p.toe.z) * g);
  const da = norm(v3(p.grip.x - p.toe.x, p.grip.y - p.toe.y, p.grip.z - p.toe.z));
  const db = norm(v3(q.grip.x - q.toe.x, q.grip.y - q.toe.y, q.grip.z - q.toe.z));
  const a = norm(v3(da.x + (db.x - da.x) * g, da.y + (db.y - da.y) * g, da.z + (db.z - da.z) * g));
  const nn = v3(p.n.x + (q.n.x - p.n.x) * g, p.n.y + (q.n.y - p.n.y) * g, p.n.z + (q.n.z - p.n.z) * g);
  const k = dot(nn, a);
  const n = norm(v3(nn.x - k * a.x, nn.y - k * a.y, nn.z - k * a.z));
  return { toe, grip: v3(toe.x + a.x * BAT_FULL, toe.y + a.y * BAT_FULL, toe.z + a.z * BAT_FULL), n };
}

/** The bat at any time t (stance before the swing, then backlift, the zone and the follow-through). */
export function batPose(tr: BatTrack, t: number): BatPose {
  if (t <= tr.startT) return tr.stance;
  if (t < tr.zoneIn) {
    const span = tr.zoneIn - tr.startT;
    const f = (t - tr.startT) / span;
    if (f < 0.45) return blend(tr.stance, tr.backlift, f / 0.45);
    return blend(tr.backlift, zonePose(tr, tr.zoneIn), (f - 0.45) / 0.55);
  }
  if (t <= tr.zoneOut) return zonePose(tr, t);
  const f = (t - tr.zoneOut) / FOLLOW_S;
  if (tr.kind === 'defend') return zonePose(tr, tr.zoneOut);
  return f >= 1 ? tr.finish : blend(zonePose(tr, tr.zoneOut), tr.finish, f);
}

/** End of the swing (follow-through complete). */
export function trackEndT(tr: BatTrack): number {
  return tr.zoneOut + FOLLOW_S;
}

/** Bat samples from the swing's start to the follow-through, every dt seconds. */
export function batSamples(tr: BatTrack, dt = 0.004): BatSample[] {
  const out: BatSample[] = [];
  const end = trackEndT(tr);
  const n = Math.ceil((end - tr.startT) / dt);
  for (let i = 0; i <= n; i++) {
    const t = tr.startT + i * dt;
    const p = batPose(tr, t);
    out.push({ t, grip: p.grip, toe: p.toe, face: p.n });
  }
  return out;
}
