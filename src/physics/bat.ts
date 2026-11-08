/**
 * The virtual bat: kinematics of a right-handed batter's bat from a NormalizedSwing, as a continuous track that can
 * be sampled at any t (grip, toe, face). Also the batter's body (pads, torso, head) for pad, body and LBW contact.
 *
 * Model (docs/PRACTICE_PHYSICS.md, "Virtual bat"):
 *  - Footwork: automatic from the delivery's length (forward to full, back to short), or manual when given.
 *  - The batter reads the ball: he places the bat where the flight he has seen says the ball will cross his contact
 *    plane. At every level he commits 150 ms before the bat arrives (one read model), predicting from
 *    the ball's state then (gravity, drag and a normal bounce, no swing, seam or turn), so late movement beats him.
 *  - The stroke (shot.ts) fixes the bat: a vertical or a horizontal blade, and its reach. The bat aims its sweet spot
 *    at the read, as far as the stroke reaches (the read clamped into the reach); a ball outside the reach meets the
 *    bat away from the sweet spot, or passes it.
 *  - The face is set so a perfect sweet-spot hit leaves in the intended direction (flick bearing and elevation).
 *  - The bat reaches the zone at startT + batTravelMs (Learn/Play: the whole swing moves so it arrives at
 *    idealT + forgive(error), with its own travel, see timing.ts and buildBatTrackAt) and
 *    moves along the ball's line at the speed that gives the face the flick's bat speed. Timing error moves it
 *    across the line (drift) and rotates the face at fixed rates: late leaves the bat behind its drift with the face
 *    open (outside edge for off-side and straight strokes, inside edge for leg-side ones; top edge on the pull),
 *    early puts it ahead with the face closed (inside edge, leading edge, ball to leg), and both lift it (toe).
 */
import type {
  AssistLevel,
  BallCondition,
  BallFlight,
  BatSample,
  BowlerProfile,
  Footwork,
  Handedness,
  NormalizedSwing,
  PitchCondition,
  PlayedFootwork,
  SwingKind,
} from '@/contracts/practice';
import {
  applyBatterPosture,
  BAT_BODY_RETARGET_M,
  BAT_HAND_REACH_SOLVE_M,
  batterShoulders,
  batPoseAdmissibility,
  batPoseGapReach,
  remainingBatterPostureCrouchM,
  solveBatterRootOffsetForPoses,
  translateBatterBody,
} from './admissibility';
import { bounce } from './ball';
import { faceCor, swingArm } from './batMaterial';
import {
  BALL_R,
  BACK_FOOT_PUNCH,
  BAT_EFF_MASS,
  COMMIT_BEFORE_MS,
  DEFEND_FACE_YAW_DEG_PER_MS,
  DRIFT_M_PER_MS,
  FACE_TILT_DEG_PER_MS,
  FACE_YAW_DEG_PER_MS,
  BAT_FRICTION,
  BAT_COR,
  BAT_SPEED,
  BAT_TRAVEL_MS,
  BLADE_HALF_W,
  BLADE_L,
  BLADE_T,
  BODY,
  CONTACT_PLANE_M,
  DEFEND_COR,
  DEFEND_EFF_MASS,
  HANDLE_L,
  GLOVE_R,
  LOWER_HAND_FROM_CAP,
  PITCH_HALF,
  BAT_TIMING_CALIBRATION,
  SWEET_U,
  TOP_HAND_FROM_CAP,
  type PitchParams,
} from './constants';
import { contactPlaneZ, releaseFor, sampleAt, spinVector, timeAtZ } from './delivery';
import { impact } from './impact';
import { type ShotPlan, planShot } from './shot';
import { activeBands, forgive } from './timing';
import {
  type Vec3,
  UP,
  DEG,
  bearingDeg,
  clamp,
  cross,
  dacos,
  datan2,
  dcos,
  dirFromBearing,
  dsin,
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
  let authoredCrouchM = 0;
  let authoredLeanX = 0;
  switch (footwork) {
    case 'forward':
    case 'down_track':
      // The front pad stays inside the bat/ball line even when the whole planted athlete leans into the stroke.
      // A 27 cm pad-to-line offset leaves lawful bat-width clearance after the bounded 18 cm root retarget.
      front = pad(x - 0.27, zc + 0.12);
      back = footwork === 'forward' ? pad(-0.14, PITCH_HALF - 0.72) : pad(x - 0.35, zc + 0.7);
      tx = x - 0.15;
      // A front-foot stroke brings the chest over the planted knee and the head close to the ball line. This authored
      // lean is part of the footwork pose, not a hidden IK stretch; the later root/crouch solve remains bounded.
      tz = zc + 0.2;
      head = v3(x - 0.12, BODY.headY - 0.1, zc + 0.25);
      break;
    case 'back':
      back = pad(x - 0.18, zc + 0.12);
      front = pad(x - 0.32, zc - 0.25);
      tx = x - 0.32;
      tz = zc + 0.25;
      head = v3(x - 0.18, BODY.headY, zc + 0.1);
      // Select a deeper crease stance continuously from the pre-result contact-height read: fully down for a ball
      // below 12 cm, smoothly upright by 32 cm. Feet stay planted; this is authored footwork, before the unchanged
      // bounded posture solver applies any additional crouch required by the complete visible swing.
      {
        const lowRead = 1 - smooth01((c.y - 0.12) / 0.2);
        authoredCrouchM = 0.03 * lowRead;
        // A batter digging out a low ball leans the shoulder frame towards the read while the planted feet and pads
        // stay put. This prevents the anatomy solver from dragging a correctly planted back pad across the ball line
        // merely to bring both hands to the low bat. The lean is continuous in the pre-result height/line read and is
        // capped at 40 mm; the torso base moves only 35% as far, preserving a connected, visible lateral body tilt.
        const towardsRead = c.x - (tx + 0.04);
        authoredLeanX = Math.sign(towardsRead) * Math.min(Math.abs(towardsRead), 0.04 * lowRead);
      }
      break;
    case 'across':
      back = pad(x - 0.15, zc + 0.15);
      front = pad(x - 0.28, zc - 0.3);
      tx = x - 0.3;
      tz = zc + 0.25;
      head = v3(x - 0.15, BODY.headY, zc + 0.1);
      break;
  }
  const lowerUpper = (value: Vec3): Vec3 => authoredCrouchM === 0
    ? value
    : v3(value.x, value.y - authoredCrouchM, value.z);
  return {
    footwork,
    stance: v3((front.a.x + back.a.x) / 2, 0, (front.a.z + back.a.z) / 2),
    pads: [
      { ...front, b: lowerUpper(front.b) },
      { ...back, b: lowerUpper(back.b) },
    ],
    torso: {
      // On a stride the hips sit between the planted feet, weighted towards the front foot, and the trunk leans from
      // them over the front knee; the shoulders and head stay where the footwork places them. An upright torso 20 cm
      // behind the contact plane and 15 cm inside the line put the batter's belly where his hands hold the bat.
      a: lowerUpper(footwork === 'forward' || footwork === 'down_track'
        ? v3(0.65 * front.a.x + 0.35 * back.a.x, BODY.torsoBottom, 0.65 * front.a.z + 0.35 * back.a.z)
        : v3(tx + authoredLeanX * 0.35, BODY.torsoBottom, tz)),
      b: lowerUpper(v3(tx + 0.04 + authoredLeanX, BODY.torsoTop, tz - 0.06)),
      r: BODY.torsoR,
    },
    head: { c: lowerUpper(v3(head.x + authoredLeanX, head.y, head.z)), r: BODY.headR },
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

/** What the batter expects off the pitch: the spin of the bowler's stock ball, on this pitch (he plays for it). */
export interface ReadExpectation {
  spin: Vec3;
  pitch: PitchParams;
}

/**
 * The batter's read: the ball crossing plane z, as judged at commitT (null = tracks the real ball). He judges length,
 * bounce and pace from the flight he has seen (height and arrival are the real ones); the line is his prediction at
 * commitT: the ball's sideways motion then, with the swing he has seen curving it on while it is in the air, and,
 * when he committed before it pitched, the deviation off the pitch he expects (the bowler's stock ball: `expect`,
 * through the same bounce physics; none without it). Whatever departs from that after the commit beats him: swing
 * beyond the curve he saw, the seam landing, a wrong'un or an arm ball, extra or less turn.
 */
export function readBall(flight: BallFlight, zPlane: number, commitT: number | null, expect: ReadExpectation | null = null): BallRead {
  const samples = flight.samples;
  const tReal = timeAtZ(samples, zPlane) ?? samples[samples.length - 1].t;
  const real = sampleAt(samples, tReal);
  if (commitT === null || commitT >= tReal) return { c: real.p, u: real.v };
  const s = sampleAt(samples, Math.max(0, commitT));
  const b = flight.bounce;
  const airborneAtCommit = !b || s.t < b.t;
  // The sideways acceleration he sees (swing, drift), measured while the ball is still in the air.
  let ax = 0;
  const h = 0.002;
  if (airborneAtCommit && s.t - h >= 0 && (!b || s.t + h < b.t)) ax = (sampleAt(samples, s.t + h).v.x - sampleAt(samples, s.t - h).v.x) / (2 * h);
  if (b && s.t < b.t && b.t < tReal) {
    const t1 = b.t - s.t;
    const xb = s.p.x + s.v.x * t1 + 0.5 * ax * t1 * t1;
    let vx = s.v.x + ax * t1;
    if (expect) {
      const pre = sampleAt(samples, Math.max(0, b.t - 0.0005));
      const v = v3(vx, pre.v.y, pre.v.z);
      bounce(v, v3(expect.spin.x, expect.spin.y, expect.spin.z), expect.pitch, expect.pitch.turnGrip, 0);
      vx = v.x;
    }
    return { c: v3(xb + vx * (tReal - b.t), real.p.y, real.p.z), u: v3(vx, real.v.y, real.v.z) };
  }
  // Committed after it pitched (the line he saw off the pitch), or to a ball still in the air at the plane.
  const dt = tReal - s.t;
  const curve = airborneAtCommit ? ax : 0;
  return { c: v3(s.p.x + s.v.x * dt + 0.5 * curve * dt * dt, real.p.y, real.p.z), u: v3(s.v.x + curve * dt, real.v.y, real.v.z) };
}

/** The expectation for a strike: the bowler's stock ball at this ball's line, length and pace (null without a bowler). */
export function readExpectation(flight: BallFlight, e: StrikeOptions['expect']): ReadExpectation | null {
  if (!e) return null;
  const plan = { variation: 'stock' as const, lengthM: flight.plan.lengthM, lineM: flight.plan.lineM, speedKph: flight.plan.speedKph };
  const spec = releaseFor(plan, e.bowler, e.conditions, flight.seed, e.handedness ?? 'right', e.ball);
  return { spin: spinVector(spec.spin, flight.release.v), pitch: spec.pitch };
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

/** Inputs for the material-consistent face solve shared by projected vertical and horizontal path candidates. */
export interface ProjectedFaceRequest {
  incomingVelocity: Vec3;
  incomingSpin: Vec3;
  contactAim: Vec3;
  intendedBearingDeg: number;
  targetElevationDeg: number;
  kind: SwingKind;
  speedMps: number;
  balance: number;
  horizontal: number;
  /** Proper rotation of the semantic blade axis around the face normal. */
  semanticRollRad: number;
  requestedContactU: number;
  physicalTimingErrorMs: number;
  /** Deterministic initial guess only; the returned face is solved from the projected impact equation. */
  initialNormal: Vec3;
}

/** One coherent face, blade and centre-face impact solution. */
export interface ProjectedFaceSolve extends FaceSolve {
  a: Vec3;
  drift: Vec3;
  sweet: Vec3;
  toeShift: number;
  contactU: number;
  surfaceV: Vec3;
}

/** Defensive face: square to the ball's line, angled gently towards the aim, tilted down to kill the ball. */
export const DEFEND_TILT_DEG = 8;
export const DEFEND_ANGLE_FRACTION = 0.08;

function exitFor(u: Vec3, spin: Vec3, back: Vec3, nb: number, ne: number, speed: number, mass: number, cor: number): { n: Vec3; vLine: number; exit: Vec3 } {
  const n = dirFromBearing(nb, ne);
  // `speed` is the real surface-point speed, not merely its face-normal component. The previous speed/along model
  // could demand >30 m/s from a bat whose visible rigid body was capped at 30 m/s.
  const vLine = speed;
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
  /**
   * The real bowler, the pitch and the striker's hand: the batter plays for the bowler's stock ball (readBall). Without
   * it he expects no deviation off the pitch. resolveDelivery always passes it.
   */
  expect?: { bowler: BowlerProfile; conditions: PitchCondition; handedness?: Handedness; ball?: BallCondition };
}

/** A bat pose: grip (top of the handle), toe, face normal. */
export interface BatPose {
  grip: Vec3;
  toe: Vec3;
  n: Vec3;
}

export interface PresentationMotion {
  offset: Vec3;
  rotationAxis: Vec3;
  angle: number;
}

/** One causal rigid-body velocity field for the authoritative pre-result swing. */
export interface BatRigidTwist {
  /** Linear velocity of the handle cap at the planned contact instant (m/s). */
  gripVelocity: Vec3;
  /** World-space angular velocity (rad/s). */
  angularVelocity: Vec3;
}

interface BatCollisionPathSide {
  durationS: number;
  handRampS: number;
  angularRampS: number;
  correctionAxis: Vec3;
  correctionAngleRad: number;
}

interface FreeGripSo3PathSide {
  durationS: number;
  /** Translation ramp for the exact contact grip velocity; named consistently with the retained hand-ramp path. */
  handRampS: number;
  angularRampS: number;
  /** World-space free endpoint displacement blended by the C1 quintic profile. */
  gripEndpointCorrectionM: Vec3;
  /** World-space proper-rotation vector blended independently by the same quintic profile. */
  orientationRotationVectorRad: Vec3;
}

/**
 * One deterministic C1 rigid-bat path. The anchor hand follows a shoulder sphere, the blade has an independent
 * proper rotation, and a quintic endpoint correction brings the ordered second hand towards its shoulder. This is
 * physics-internal: bridge v5 continues to receive canonical BatSample poses rather than a second motion contract.
 */
export interface ShoulderSphereCollisionPath {
  kind: 'shoulder-sphere';
  contact: BatPose;
  anchorShoulder: Vec3;
  anchorRadius: Vec3;
  anchorAxis: Vec3;
  anchorRateRadps: number;
  anchorHandFromCapM: number;
  otherHandFromCapM: number;
  contactAxis: Vec3;
  contactNormal: Vec3;
  angularAxis: Vec3;
  angularRateRadps: number;
  pre: BatCollisionPathSide;
  post: BatCollisionPathSide;
  envelope: BatAnalyticEnvelope;
}

/**
 * A deterministic free-grip C1 path. Translation and proper rotation have independent pre/post endpoints, while
 * `BatTrack.collisionTwist` remains the single exact contact velocity authority. The body stays static throughout.
 */
export interface FreeGripSo3CollisionPath {
  kind: 'free-grip-so3';
  contact: BatPose;
  pre: FreeGripSo3PathSide;
  post: FreeGripSo3PathSide;
  envelope: BatAnalyticEnvelope;
}

export type BatCollisionPath = ShoulderSphereCollisionPath | FreeGripSo3CollisionPath;

export interface BatCollisionKinematics {
  pose: BatPose;
  gripVelocity: Vec3;
  gripAcceleration: Vec3;
  angularVelocity: Vec3;
  angularAcceleration: Vec3;
}

/**
 * Analytic caps on every collision path. They must admit the model's own strokes: the fastest requested sweet-spot
 * speed is BAT_SPEED.attackMin + attackRange = 32 m/s, and a rigid bat turning about quiet hands moves its toe
 * (0.86 m from the cap) 1.17 times faster than the sweet spot (0.74 m), so a bat point must be allowed about 38 m/s;
 * that needs about 30 rad/s of bat rotation, whose centripetal acceleration alone at the toe is about 870 m/s².
 * The previous 30 m/s, 25 rad/s and 400 m/s² caps were below the requested strokes themselves, so the planner could
 * only meet them by silently lowering the bat speed. The grip (hand) caps are unchanged.
 * The acceleration caps are peak values of the C1 speed profile (rampRate below), whose peak is RAMP_PEAK_FACTOR = 1.5
 * times its mean over a ramp. Phase 3 (2026-11-03) scaled them by that factor (grip 200 → 300 m/s², point 1500 →
 * 2250 m/s², angular 600 → 900 rad/s²) so the mean acceleration of every ramp, its length and its swept poses stay
 * those of the old constant-acceleration tent. At the old values the smooth peak lengthened the ramps of 74 of 864
 * sampled swings and the planner silently lowered their bat speed (a back-foot pull at a bouncer from 23.6 to 12.7
 * m/s); with the scaled caps 11 of 864 differ by more than 2% (wedge/physics/phase3/speed.json).
 */
export const BAT_GRIP_SPEED_LIMIT_MPS = 18;
export const BAT_POINT_SPEED_LIMIT_MPS = 40;
export const BAT_GRIP_ACCEL_LIMIT_MPS2 = 300;
export const BAT_POINT_ACCEL_LIMIT_MPS2 = 2250;
export const BAT_ANGULAR_SPEED_LIMIT_RADPS = 40;
export const BAT_ANGULAR_ACCEL_LIMIT_RADPS2 = 900;
/** Public, fixture-independent containment contract for the bounded synchronous generalized-path search. */
export const GENERALIZED_COLLISION_CONTACT_U_STEP = 1 / 40;
export const GENERALIZED_COLLISION_CONTACT_U_MIN = GENERALIZED_COLLISION_CONTACT_U_STEP;
export const GENERALIZED_COLLISION_CONTACT_U_MAX = 1 - GENERALIZED_COLLISION_CONTACT_U_STEP;
const GENERALIZED_COLLISION_CONTACT_LOCATION_LIMIT = 4;
const GENERALIZED_COLLISION_AXIS_LIMIT = 4;
const LEGACY_ATTACK_CONTACT_LOCATION_LIMIT = 4;
const LEGACY_ATTACK_AXIS_LIMIT = 4;
/**
 * One deterministic work ledger shared by every synchronous fallback inside a single buildBatTrack call. Credits
 * represent bounded candidate/certificate blocks, not wall time; every preferred, generalized and legacy planner
 * draws from the same ledger. The final reserve is available only to author an anatomy-safe fail-closed whiff.
 */
interface FallbackWorkBudget { remaining: number }
/**
 * 320 credits (was 160). With 160 the anatomy-ceiling bisection could spend the whole ledger, so the rebuilt stroke at
 * the found speed never ran and the batter got the fail-closed whiff (the representative pull at a bouncer; 97 of 549
 * sampled attacks). The allocation-free geometry (batGeometry.ts, pathPointCaps) made the planner 3.8× faster, which
 * pays for the doubled bound. The ledger is a pure work bound: it never reads a result.
 */
const FALLBACK_WORK_LIMIT = 320;
const FAIL_CLOSED_WHIFF_RESERVE = 30;
const LOWER_SPEED_GENERALIZED_WORK_ALLOWANCE = 16;
const HIGH_SPEED_GENERALIZED_CANDIDATE_ALLOWANCE = 32;
const PROJECTED_REJECT_GENERALIZED_CANDIDATE_ALLOWANCE = 8;
const VERTICAL_RECOVERY_GENERALIZED_CANDIDATE_ALLOWANCE = 12;
const PROJECTED_REJECT_GENERALIZED_WORK_ALLOWANCE = 24;
const OFF_SIDE_VERTICAL_EXACT_REPLAY_WORK_ALLOWANCE = 28;
const PROJECTED_VERTICAL_BODY_ALLOWANCE = 13;
function spendFallbackWork(
  budget: FallbackWorkBudget,
  credits: number,
  preserveWhiffReserve = true,
): boolean {
  const floor = preserveWhiffReserve ? FAIL_CLOSED_WHIFF_RESERVE : 0;
  if (!Number.isInteger(credits) || credits <= 0 || budget.remaining - credits < floor) return false;
  budget.remaining -= credits;
  return true;
}

function withFallbackWorkAllowance<T>(
  budget: FallbackWorkBudget,
  allowance: number,
  work: (bounded: FallbackWorkBudget) => T,
): T {
  const bounded: FallbackWorkBudget = {
    remaining: Math.min(budget.remaining, FAIL_CLOSED_WHIFF_RESERVE + allowance),
  };
  const before = bounded.remaining;
  const result = work(bounded);
  budget.remaining -= before - bounded.remaining;
  return result;
}
/** Conservative contact-point ceiling that leaves room for a slower 18 m/s handle and a <=30 m/s toe. */
/**
 * Keep the whole perfect window on the face's sweet region, then grow continuously to the physical edge window.
 * The causal trajectory—not a post-hoc contact label—still produces every middle/edge/miss transition.
 */
function timingDriftVelocityScale(physicalErrorMs: number, intendedBearing: number): number {
  const magnitude = Math.abs(physicalErrorMs);
  const c = BAT_TIMING_CALIBRATION;
  const u = clamp((magnitude - c.perfectMs) / (c.solidMs - c.perfectMs), 0, 1);
  const edgeU = clamp((magnitude - c.solidMs) / (c.edgeMs - c.solidMs), 0, 1);
  // Closing the face early and opening it late have different geometric leverage around the planted two-hand arc.
  // A leg-side clip's already-closed plane amplifies the same early error, so its extra timing translation tapers to
  // zero by -55°. These are causal velocity calibrations: contact remains whatever the continuous sweep produces.
  if (physicalErrorMs < 0) {
    const earlySolid = 0.4 * Math.sqrt(clamp(u * 8, 0, 1));
    const legSideLeverage = clamp((intendedBearing + 55) / 55, 0, 1);
    return 1.08 + legSideLeverage * (earlySolid + 0.35 * Math.sqrt(edgeU));
  }
  return 1.08 + 0.02 * smooth01(u) + 0.3 * Math.sqrt(edgeU);
}

export interface BatTrack {
  kind: SwingKind;
  /**
   * When the bat starts its stroke. Real: the player's start. Learn and Play (phase 5e, SYS1): the player's start
   * shifted by the forgiveness, physErrorMs - errorMs, so the whole swing moves and its travel stays travelMs.
   */
  startT: number;
  travelMs: number;
  /** startT + travel: when the played swing reaches the zone (= effT up to rounding). */
  arriveT: number;
  /**
   * Ideal contact for the footwork played; the player's raw timing error (ms, + late; the report and the label) and
   * the physical error the bat plays (forgive(errorMs), the Real error the swing is played at).
   */
  idealT: number;
  errorMs: number;
  physErrorMs: number;
  /** When the bat really reaches the zone: idealT + physErrorMs. */
  effT: number;
  /** Predicted ball/bat meeting instant after resolving their closing speeds and the physical timing error. */
  plannedContactT: number;
  footwork: PlayedFootwork;
  balance: number;
  /** One static planted-batter x/z retarget, applied consistently to every body collider and presentation root. */
  batterRootOffset: { x: number; z: number };
  /** One static planted crouch; pad bottoms/feet stay grounded while the upper body lowers consistently. */
  batterPosture: { crouchM: number };
  body: BatterBody;
  read: BallRead;
  commitT: number | null;
  /** The stroke played and where its sweet spot aims (the read clamped into the stroke's reach). */
  shot: ShotPlan;
  /** Ball-centre aim at plannedContactT, including timing drift/lift but before ball-radius face offset. */
  contactAim: Vec3;
  /** At arrival: sweet spot on the face, face normal, blade axis (toe → grip). */
  sweet: Vec3;
  /** How far the bat was raised along its axis to keep the toe above the ground (low balls: contact nearer the toe). */
  toeShift: number;
  /** Planned face-contact fraction from toe (0) to shoulder (1); the physical sweet spot remains SWEET_U. */
  contactU: number;
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
  /** One velocity-continuous rigid swing through plannedContactT; scoring never depends on result/presentation authoring. */
  collisionTwist: BatRigidTwist;
  /** Generalized path when continuously certified; null retains the legacy rigid-screw path as a safe fallback. */
  collisionPath: BatCollisionPath | null;
  /** True when the complete visible track is certified anatomy-safe and therefore eligible for bat collision. */
  geometryAdmitted: boolean;
}

const FOLLOW_S = 0.25;
const BAT_FULL = BLADE_L + HANDLE_L;

/** Replay-stable planar magnitude using only basic arithmetic and correctly-rounded sqrt. */
function planarMagnitude(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}

export interface BatAnalyticEnvelope {
  gripSpeed: number;
  pointSpeed: number;
  gripAcceleration: number;
  pointAcceleration: number;
  angularSpeed: number;
  angularAcceleration: number;
  anatomyGapSpeed: number;
}

const BAT_POINT_RADIUS_M = BAT_FULL + BLADE_HALF_W + BLADE_T / 2;
/** Tight enclosing radius used only for generalized-path material-point derivative bounds. */
const BAT_CONVEX_RADIUS_M = Math.max(
  Math.sqrt(BAT_FULL * BAT_FULL + BLADE_HALF_W * BLADE_HALF_W + BLADE_T / 2 * (BLADE_T / 2)),
  HANDLE_L + GLOVE_R,
);

function twistEnvelope(twist: BatRigidTwist, rampSeconds: number): BatAnalyticEnvelope {
  const gripSpeed = len(twist.gripVelocity);
  const angularSpeed = len(twist.angularVelocity);
  // Every point in the blade/handle convex hull is within BAT_POINT_RADIUS_M of the handle cap. These are analytic
  // global bounds for the affine rigid velocity field, not observations at sampled endpoints.
  const pointSpeed = gripSpeed + BAT_POINT_RADIUS_M * angularSpeed;
  const gripAcceleration = RAMP_PEAK_FACTOR * gripSpeed / Math.max(1e-9, rampSeconds);
  const angularAcceleration = RAMP_PEAK_FACTOR * angularSpeed / Math.max(1e-9, rampSeconds);
  const pointAcceleration = gripAcceleration
    + BAT_POINT_RADIUS_M * angularAcceleration
    + BAT_POINT_RADIUS_M * angularSpeed * angularSpeed;
  return {
    gripSpeed,
    pointSpeed,
    gripAcceleration,
    pointAcceleration,
    angularSpeed,
    angularAcceleration,
    anatomyGapSpeed: pointSpeed,
  };
}

/** Exact global derivative bounds for the one causal collision swing; the held finish is static. */
export function batTrackAnalyticEnvelope(track: BatTrack): BatAnalyticEnvelope {
  if (track.collisionPath) return track.collisionPath.envelope;
  const pre = twistEnvelope(track.collisionTwist, Math.max(1e-9, track.plannedContactT - track.zoneIn));
  const post = twistEnvelope(track.collisionTwist, Math.max(1e-9, track.zoneOut - track.plannedContactT));
  return {
    gripSpeed: pre.gripSpeed,
    pointSpeed: pre.pointSpeed,
    gripAcceleration: Math.max(pre.gripAcceleration, post.gripAcceleration),
    pointAcceleration: Math.max(pre.pointAcceleration, post.pointAcceleration),
    angularSpeed: pre.angularSpeed,
    angularAcceleration: Math.max(pre.angularAcceleration, post.angularAcceleration),
    anatomyGapSpeed: pre.anatomyGapSpeed,
  };
}

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

/**
 * A right-handed batter finishes outside a shoulder, never through the head.  The physics frame is always
 * right-handed and presentation mirrors it exactly once, so these signs must not inspect the player's handedness.
 * The square/steering/punching off-side families finish outside the off shoulder; drives through the arc and
 * leg-side strokes complete over the lead (leg-side) shoulder.
 */
function followThroughSide(shot: ShotPlan): -1 | 1 {
  switch (shot.family) {
    case 'square_drive':
    case 'steer':
    case 'back_punch':
    case 'cut':
      return 1;
    default:
      return -1;
  }
}

function driftForAxis(a: Vec3, n: Vec3, horizontal: number, directionDeg: number): Vec3 {
  let w = norm(cross(a, n));
  if (horizontal < 0.5) {
    if (w.x < 0) w = v3(-w.x, -w.y, -w.z);
    return directionDeg >= -15 ? w : v3(-w.x, -w.y, -w.z);
  }
  if (w.y < 0) w = v3(-w.x, -w.y, -w.z);
  return directionDeg < 0 ? w : v3(-w.x, -w.y, -w.z);
}

function plannedSweet(aim: Vec3, n: Vec3, a: Vec3, requestedU: number): { sweet: Vec3; toeShift: number; contactU: number } | null {
  const facePoint = v3(aim.x - n.x * BALL_R, aim.y - n.y * BALL_R, aim.z - n.z * BALL_R);
  let sweet = v3(
    facePoint.x + a.x * (SWEET_U - requestedU) * BLADE_L,
    facePoint.y + a.y * (SWEET_U - requestedU) * BLADE_L,
    facePoint.z + a.z * (SWEET_U - requestedU) * BLADE_L,
  );
  const initial = bladeFrom(sweet, n, a);
  let toeShift = 0;
  if (initial.toe.y < 0.005) {
    if (a.y <= 0.05) return null;
    toeShift = (0.005 - initial.toe.y) / a.y;
    sweet = v3(sweet.x + a.x * toeShift, sweet.y + a.y * toeShift, sweet.z + a.z * toeShift);
  }
  const contactU = requestedU - toeShift / BLADE_L;
  if (contactU < -1e-9 || contactU > 1 + 1e-9) return null;
  return { sweet, toeShift, contactU: clamp(contactU, 0, 1) };
}

/**
 * The exact point-velocity policy shared by face authoring and every path planner. A planted two-hand stroke does
 * not receive an unbounded thrust along the handle: the requested velocity is projected off the blade axis. This is
 * a conservative hand-motion policy, not a claim that rigid-body mechanics forbid all axial grip translation.
 */
function projectedContactVelocity(
  uHat: Vec3,
  incomingSpeed: number,
  a: Vec3,
  drift: Vec3,
  vLine: number,
  physicalErrorMs: number,
  intendedBearing: number,
): Vec3 {
  const driftVelocityScale = timingDriftVelocityScale(physicalErrorMs, intendedBearing);
  const driftSpeed = DRIFT_M_PER_MS * 1000 * (incomingSpeed + vLine) / incomingSpeed * driftVelocityScale;
  const requested = v3(
    -uHat.x * vLine + drift.x * driftSpeed,
    -uHat.y * vLine + drift.y * driftSpeed,
    -uHat.z * vLine + drift.z * driftSpeed,
  );
  const axialVelocity = dot(requested, a);
  return v3(
    requested.x - a.x * axialVelocity,
    requested.y - a.y * axialVelocity,
    requested.z - a.z * axialVelocity,
  );
}

interface ProjectedFaceEvaluation extends ProjectedFaceSolve {
  bearingErrorDeg: number;
  elevationErrorDeg: number;
}

/**
 * Solve a horizontal candidate's face with the same velocity projection and contact material that its rigid path
 * will use. The older face solve remains the vertical-stroke authority and supplies only the deterministic initial
 * guess here. Failure to converge, retain face geometry or remain in the semantic blade class fails closed.
 */
export function solveProjectedFace(request: ProjectedFaceRequest): ProjectedFaceSolve | null {
  const U = Math.max(1, len(request.incomingVelocity));
  const uHat = v3(
    request.incomingVelocity.x / U,
    request.incomingVelocity.y / U,
    request.incomingVelocity.z / U,
  );
  const targetBearing = clamp(request.intendedBearingDeg, -150, 150);
  const evaluate = (faceBearing: number, faceElevation: number): ProjectedFaceEvaluation | null => {
    const n = dirFromBearing(faceBearing, faceElevation);
    const semantic = bladeAxis(n, request.horizontal);
    const a = norm(rotate(semantic, n, request.semanticRollRad));
    const geometry = plannedSweet(request.contactAim, n, a, request.requestedContactU);
    if (!geometry) return null;
    const drift = driftForAxis(a, n, request.horizontal, request.intendedBearingDeg);
    const surfaceV = projectedContactVelocity(
      uHat,
      U,
      a,
      drift,
      request.speedMps,
      request.physicalTimingErrorMs,
      request.intendedBearingDeg,
    );
    const mass = (request.kind === 'defend' ? DEFEND_EFF_MASS : BAT_EFF_MASS)
      * request.balance
      * swingArm(geometry.contactU).mass;
    const cor = faceCor(request.kind, geometry.contactU, 0, request.balance);
    const exit = impact({
      v: request.incomingVelocity,
      spin: request.incomingSpin,
      n,
      surfaceV,
      mass,
      cor,
      friction: BAT_FRICTION,
    }).v;
    return {
      n,
      a,
      drift,
      sweet: geometry.sweet,
      toeShift: geometry.toeShift,
      contactU: geometry.contactU,
      surfaceV,
      vLine: request.speedMps,
      exit,
      bearingErrorDeg: wrap(bearingDeg(exit.x, exit.z) - targetBearing),
      elevationErrorDeg: elevationDeg(exit) - request.targetElevationDeg,
    };
  };

  let faceBearing = clamp(bearingDeg(request.initialNormal.x, request.initialNormal.z), -100, 100);
  let faceElevation = clamp(elevationDeg(request.initialNormal), -45, 60);
  let current = evaluate(faceBearing, faceElevation);
  if (!current) return null;
  const h = 0.1;
  for (let iteration = 0; iteration < 24; iteration++) {
    if (Math.abs(current.bearingErrorDeg) <= 1e-8 && Math.abs(current.elevationErrorDeg) <= 1e-8) break;
    const bearingProbe = evaluate(faceBearing + h, faceElevation);
    const elevationProbe = evaluate(faceBearing, faceElevation + h);
    if (!bearingProbe || !elevationProbe) return null;
    const aa = wrap(bearingProbe.bearingErrorDeg - current.bearingErrorDeg) / h;
    const ab = wrap(elevationProbe.bearingErrorDeg - current.bearingErrorDeg) / h;
    const ba = (bearingProbe.elevationErrorDeg - current.elevationErrorDeg) / h;
    const bb = (elevationProbe.elevationErrorDeg - current.elevationErrorDeg) / h;
    const determinant = aa * bb - ab * ba;
    if (Math.abs(determinant) < 1e-10) return null;
    let deltaBearing = (-current.bearingErrorDeg * bb + current.elevationErrorDeg * ab) / determinant;
    let deltaElevation = (-aa * current.elevationErrorDeg + ba * current.bearingErrorDeg) / determinant;
    deltaBearing = clamp(deltaBearing, -12, 12);
    deltaElevation = clamp(deltaElevation, -12, 12);
    const oldScore = Math.abs(current.bearingErrorDeg) + Math.abs(current.elevationErrorDeg);
    let accepted = false;
    for (let damping = 1; damping >= 1 / 128; damping /= 2) {
      const nextBearing = clamp(faceBearing + damping * deltaBearing, -100, 100);
      const nextElevation = clamp(faceElevation + damping * deltaElevation, -45, 60);
      const next = evaluate(nextBearing, nextElevation);
      if (!next) continue;
      const nextScore = Math.abs(next.bearingErrorDeg) + Math.abs(next.elevationErrorDeg);
      if (nextScore + 1e-14 < oldScore) {
        faceBearing = nextBearing;
        faceElevation = nextElevation;
        current = next;
        accepted = true;
        break;
      }
    }
    if (!accepted) return null;
  }
  if (Math.abs(current.bearingErrorDeg) > 1e-6 || Math.abs(current.elevationErrorDeg) > 1e-6) return null;
  if (!shotClassAllowsAxis(current.a, request.horizontal)) return null;
  return {
    n: current.n,
    a: current.a,
    drift: current.drift,
    sweet: current.sweet,
    toeShift: current.toeShift,
    contactU: current.contactU,
    surfaceV: current.surfaceV,
    vLine: current.vLine,
    exit: current.exit,
  };
}

function semanticRollRad(base: Vec3, candidate: Vec3, n: Vec3): number {
  return datan2(dot(cross(base, candidate), n), clamp(dot(base, candidate), -1, 1));
}

function candidateTrackForGeometry(
  base: BatTrack,
  incomingSpinAtContact: Vec3,
  requestedU: number,
  seedAxis: Vec3,
  baseAxis: Vec3,
): BatTrack | null {
  // The vertical face from solveFace, used for a dead bat and as the vertical attack's fallback.
  const vertical = (): BatTrack | null => {
    const geometry = plannedSweet(base.contactAim, base.n, seedAxis, requestedU);
    if (!geometry) return null;
    return {
      ...base,
      a: seedAxis,
      sweet: geometry.sweet,
      toeShift: geometry.toeShift,
      contactU: geometry.contactU,
      drift: driftForAxis(seedAxis, base.n, base.horizontal, base.intendedBearing),
    };
  };
  if (base.horizontal < 0.5 && base.kind === 'defend') return vertical();
  // Every attacking stroke, vertical or horizontal, first solves its face through the same projected surface velocity
  // and material its path will really have (with the drift velocity and without the axial component): solving a
  // vertical attack's face for a bat moving purely along the line left a systematic ~1 deg exit error even at perfect
  // timing. Where that solve does not converge (the face turned to about 150 deg: glance, steer), a vertical attack
  // keeps the solveFace geometry instead of losing the stroke.
  const solved = solveProjectedFace({
    incomingVelocity: base.read.u,
    incomingSpin: incomingSpinAtContact,
    contactAim: base.contactAim,
    intendedBearingDeg: base.intendedBearing,
    targetElevationDeg: base.targetElevation,
    kind: base.kind,
    speedMps: base.vLine,
    balance: base.balance,
    horizontal: base.horizontal,
    semanticRollRad: semanticRollRad(baseAxis, seedAxis, base.n),
    requestedContactU: requestedU,
    physicalTimingErrorMs: base.physErrorMs,
    initialNormal: base.n,
  });
  if (!solved) return base.horizontal < 0.5 ? vertical() : null;
  return {
    ...base,
    n: solved.n,
    a: solved.a,
    sweet: solved.sweet,
    toeShift: solved.toeShift,
    contactU: solved.contactU,
    drift: solved.drift,
  };
}

/**
 * One build-local geometry domain shared by the generalized and legacy planners. Both planners inspect different
 * bounded orderings of the same semantic axes/contact lattice; retaining each exact solve here prevents a fallback
 * from solving an already-visited face a second time. The cache is scoped to one immutable base track (and therefore
 * one speed/material request), so it cannot leak a face across a corrected speed or another delivery.
 */
interface CandidateTrackDomain {
  axes: Vec3[];
  /**
   * The same contact location and face roll, with the face solved for another line speed (the speed actually played
   * when anatomy caps the stroke; PHYS2 5d). Absent for domains built outside buildBatTrack.
   */
  atSpeed?: (speed: number, requestedU: number, rollRad: number) => BatTrack | null;
  candidate(requestedU: number, axisIndex: number): BatTrack | null;
  candidateAtSemanticRoll(requestedU: number, semanticRollRad: number): BatTrack | null;
}

function candidateTrackDomain(
  base: BatTrack,
  nominalBody: BatterBody,
  baseAxis: Vec3,
  incomingSpinAtContact: Vec3,
): CandidateTrackDomain {
  const axes = axisCandidates(baseAxis, base.n, base.horizontal, base.contactAim, nominalBody);
  const byContact = new Map<number, Map<number, BatTrack | null>>();
  const bySemanticRoll = new Map<number, Map<number, BatTrack | null>>();
  return {
    axes,
    candidate(requestedU, axisIndex) {
      if (axisIndex < 0 || axisIndex >= axes.length) return null;
      let byAxis = byContact.get(requestedU);
      if (!byAxis) {
        byAxis = new Map<number, BatTrack | null>();
        byContact.set(requestedU, byAxis);
      }
      if (byAxis.has(axisIndex)) return byAxis.get(axisIndex) ?? null;
      const solved = candidateTrackForGeometry(
        base,
        incomingSpinAtContact,
        requestedU,
        axes[axisIndex],
        baseAxis,
      );
      byAxis.set(axisIndex, solved);
      return solved;
    },
    candidateAtSemanticRoll(requestedU, semanticRollRad) {
      if (!Number.isFinite(semanticRollRad)) return null;
      let byRoll = bySemanticRoll.get(requestedU);
      if (!byRoll) {
        byRoll = new Map<number, BatTrack | null>();
        bySemanticRoll.set(requestedU, byRoll);
      }
      if (byRoll.has(semanticRollRad)) return byRoll.get(semanticRollRad) ?? null;
      const solved = solveProjectedFace({
        incomingVelocity: base.read.u,
        incomingSpin: incomingSpinAtContact,
        contactAim: base.contactAim,
        intendedBearingDeg: base.intendedBearing,
        targetElevationDeg: base.targetElevation,
        kind: base.kind,
        speedMps: base.vLine,
        balance: base.balance,
        horizontal: base.horizontal,
        semanticRollRad,
        requestedContactU: requestedU,
        physicalTimingErrorMs: base.physErrorMs,
        initialNormal: base.n,
      });
      const candidate = solved ? {
        ...base,
        n: solved.n,
        a: solved.a,
        sweet: solved.sweet,
        toeShift: solved.toeShift,
        contactU: solved.contactU,
        drift: solved.drift,
        vLine: solved.vLine,
      } : null;
      byRoll.set(semanticRollRad, candidate);
      return candidate;
    },
  };
}

interface PlannedCollisionTwist {
  twist: BatRigidTwist;
  rampSeconds: number;
}

/** The handle/rotation split (step of 512) each planned twist was chosen with, keyed by the twist object. */
const TWIST_SPLIT_STEPS = new WeakMap<BatRigidTwist, number>();

function collisionTwistFor(
  contact: BatPose,
  contactPoint: Vec3,
  desiredVelocity: Vec3,
  authoredAngularVelocity: Vec3,
  availableBeforeSeconds: number,
  minimumRampSeconds: number,
  splitStep: number | null = null,
): PlannedCollisionTwist | null {
  const radius = v3(
    contactPoint.x - contact.grip.x,
    contactPoint.y - contact.grip.y,
    contactPoint.z - contact.grip.z,
  );
  const radius2 = dot(radius, radius);
  if (radius2 < 1e-8) return null;
  const alongScale = dot(desiredVelocity, radius) / radius2;
  const perpendicular = v3(
    desiredVelocity.x - radius.x * alongScale,
    desiredVelocity.y - radius.y * alongScale,
    desiredVelocity.z - radius.z * alongScale,
  );
  let best: { planned: PlannedCollisionTwist; gripTravel: number; pointTravel: number; step: number } | null = null;
  // Split the requested point velocity between handle translation and rotation, then use the shortest acceleration
  // ramp that still obeys every analytic cap. The bat remains visibly held before that ramp; shortening the ramp is
  // what keeps both planted hands inside the measured skeleton envelope without introducing a hidden velocity jump.
  // A replayed plan (buildBatTrack, PHYS2 phase 5) keeps its on-time split: the argmin below depends on the timing-
  // dependent minimum ramp, and switching split between neighbouring milliseconds moved the bat across the face by
  // 5 cm (ref-4 Real 45 deg drive, +3/+4 ms).
  for (let step = splitStep ?? 512; step >= (splitStep ?? 0); step--) {
    const fraction = step / 512;
    const rotationalTarget = v3(
      perpendicular.x * fraction,
      perpendicular.y * fraction,
      perpendicular.z * fraction,
    );
    const omegaNumerator = cross(radius, rotationalTarget);
    const angularVelocity = v3(
      omegaNumerator.x / radius2 + authoredAngularVelocity.x,
      omegaNumerator.y / radius2 + authoredAngularVelocity.y,
      omegaNumerator.z / radius2 + authoredAngularVelocity.z,
    );
    const rotationAtContact = cross(angularVelocity, radius);
    const gripVelocity = v3(
      desiredVelocity.x - rotationAtContact.x,
      desiredVelocity.y - rotationAtContact.y,
      desiredVelocity.z - rotationAtContact.z,
    );
    const twist = { gripVelocity, angularVelocity };
    const gripSpeed = len(gripVelocity);
    const angularSpeed = len(angularVelocity);
    const centripetal = BAT_POINT_RADIUS_M * angularSpeed * angularSpeed;
    if (centripetal >= BAT_POINT_ACCEL_LIMIT_MPS2) continue;
    const rampSeconds = Math.max(
      minimumRampSeconds,
      RAMP_PEAK_FACTOR * gripSpeed / BAT_GRIP_ACCEL_LIMIT_MPS2,
      RAMP_PEAK_FACTOR * angularSpeed / BAT_ANGULAR_ACCEL_LIMIT_RADPS2,
      RAMP_PEAK_FACTOR * (gripSpeed + BAT_POINT_RADIUS_M * angularSpeed) / (BAT_POINT_ACCEL_LIMIT_MPS2 - centripetal),
    ) * 1.000001;
    if (rampSeconds > availableBeforeSeconds + 1e-12) continue;
    const envelope = twistEnvelope(twist, rampSeconds);
    if (envelope.gripSpeed > BAT_GRIP_SPEED_LIMIT_MPS + 1e-12
      || envelope.pointSpeed > BAT_POINT_SPEED_LIMIT_MPS + 1e-12
      || envelope.gripAcceleration > BAT_GRIP_ACCEL_LIMIT_MPS2 + 1e-12
      || envelope.pointAcceleration > BAT_POINT_ACCEL_LIMIT_MPS2 + 1e-12
      || envelope.angularSpeed > BAT_ANGULAR_SPEED_LIMIT_RADPS + 1e-12
      || envelope.angularAcceleration > BAT_ANGULAR_ACCEL_LIMIT_RADPS2 + 1e-12) continue;
    const gripTravel = gripSpeed * rampSeconds;
    const pointTravel = (gripSpeed + BAT_POINT_RADIUS_M * angularSpeed) * rampSeconds;
    // Hands are the scarce anatomical resource. Prefer the admissible velocity split that moves the handle least;
    // only then minimize total bat-point travel. A real stroke creates head speed by rotating about comparatively
    // quiet hands, not by translating both hands half a metre through the contact zone.
    if (!best
      || gripTravel < best.gripTravel - 1e-12
      || (Math.abs(gripTravel - best.gripTravel) <= 1e-12 && pointTravel < best.pointTravel - 1e-12)) {
      best = { planned: { twist, rampSeconds }, gripTravel, pointTravel, step };
    }
  }
  if (best) TWIST_SPLIT_STEPS.set(best.planned.twist, best.step);
  return best?.planned ?? null;
}

interface GeneralizedPathCandidate {
  path: BatCollisionPath;
  body: BatterBody;
  root: { x: number; z: number };
  crouchM: number;
  contactTwist: BatRigidTwist;
}

interface PathCaps extends BatAnalyticEnvelope {
  minimumGap: number;
}

interface PreparedGeneralizedPath extends GeneralizedPathCandidate {
  track: BatTrack;
  quick: PathCaps;
  score: number;
  geometryOrdinal: number;
}

/**
 * Face yaw rate about the blade axis (rad/s of swing time). FACE_YAW_DEG_PER_MS is per ms of timing error; the ball
 * meets a bat that is ε ms early or late ε·U/(U + vLine) ms after or before its planned pose, so the swing-time rate is
 * the per-error rate × (U + vLine)/U, exactly the conversion the drift uses (projectedContactVelocity).
 */
function faceYawRadps(candidate: BatTrack, vLine: number): number {
  return candidate.yawRate * 1000 * (candidate.U + vLine) / candidate.U * DEG;
}

function contactVelocityRequest(candidate: BatTrack, contactPose: BatPose, vLine: number): {
  point: Vec3;
  desired: Vec3;
  authoredOmega: Vec3;
} {
  const point = v3(
    candidate.contactAim.x - candidate.n.x * BALL_R,
    candidate.contactAim.y - candidate.n.y * BALL_R,
    candidate.contactAim.z - candidate.n.z * BALL_R,
  );
  const desired = projectedContactVelocity(
    candidate.uHat,
    candidate.U,
    candidate.a,
    candidate.drift,
    vLine,
    candidate.physErrorMs,
    candidate.intendedBearing,
  );
  const bladeAxis = poseAxis(contactPose);
  const widthAxis = norm(cross(bladeAxis, contactPose.n));
  const yaw = faceYawRadps(candidate, vLine);
  const tilt = candidate.tiltRate * 500 * DEG;
  return {
    point,
    desired,
    authoredOmega: v3(
      bladeAxis.x * yaw + widthAxis.x * tilt,
      bladeAxis.y * yaw + widthAxis.y * tilt,
      bladeAxis.z * yaw + widthAxis.z * tilt,
    ),
  };
}

function handPoint(pose: BatPose, fromCapM: number): Vec3 {
  const axis = poseAxis(pose);
  return v3(
    pose.grip.x - axis.x * fromCapM,
    pose.grip.y - axis.y * fromCapM,
    pose.grip.z - axis.z * fromCapM,
  );
}

function tangentTwistForFraction(
  contact: BatPose,
  contactPoint: Vec3,
  desiredVelocity: Vec3,
  authoredOmega: Vec3,
  body: BatterBody,
  fraction: number,
): { twist: BatRigidTwist; anchorIndex: 0 | 1 } | null {
  const contactRadius = subVec(contactPoint, contact.grip);
  const radius2 = dot(contactRadius, contactRadius);
  if (radius2 < 1e-8) return null;
  const alongScale = dot(desiredVelocity, contactRadius) / radius2;
  const perpendicular = subVec(desiredVelocity, scaleVec(contactRadius, alongScale));
  const omegaNumerator = cross(contactRadius, scaleVec(perpendicular, fraction));
  let omega = addVec(scaleVec(omegaNumerator, 1 / radius2), authoredOmega);
  const offsets = [TOP_HAND_FROM_CAP, LOWER_HAND_FROM_CAP] as const;
  const shoulders = batterShoulders(body);
  const hands = offsets.map((offset) => handPoint(contact, offset)) as [Vec3, Vec3];
  const distances = hands.map((hand, index) => len(subVec(hand, shoulders[index]))) as [number, number];
  if (distances.some((distance) => distance > BAT_HAND_REACH_SOLVE_M + 1e-9)) return null;
  const anchorIndex: 0 | 1 = distances[1] > distances[0] ? 1 : 0;
  const binding = ([0, 1] as const).filter((index) => distances[index] >= BAT_HAND_REACH_SOLVE_M - 0.00025);
  const constrained: readonly (0 | 1)[] = binding.length > 0 ? binding : [anchorIndex];
  const rows = constrained.map((index) => {
    const handRadius = subVec(hands[index], contact.grip);
    const radial = norm(subVec(hands[index], shoulders[index]));
    return {
      gradient: cross(subVec(handRadius, contactRadius), radial),
      target: -dot(desiredVelocity, radial),
    };
  });
  if (rows.some((row) => dot(row.gradient, row.gradient) < 1e-10)) return null;
  if (rows.length === 1) {
    const row = rows[0];
    omega = addVec(omega, scaleVec(
      row.gradient,
      (row.target - dot(row.gradient, omega)) / dot(row.gradient, row.gradient),
    ));
  } else {
    const [left, right] = rows;
    const aa = dot(left.gradient, left.gradient);
    const ab = dot(left.gradient, right.gradient);
    const bb = dot(right.gradient, right.gradient);
    const determinant = aa * bb - ab * ab;
    if (determinant < 1e-10 * aa * bb) return null;
    const ra = left.target - dot(left.gradient, omega);
    const rb = right.target - dot(right.gradient, omega);
    const la = (ra * bb - rb * ab) / determinant;
    const lb = (rb * aa - ra * ab) / determinant;
    omega = addVec(omega, addVec(scaleVec(left.gradient, la), scaleVec(right.gradient, lb)));
  }
  const gripVelocity = subVec(desiredVelocity, cross(omega, contactRadius));
  if (len(gripVelocity) > BAT_GRIP_SPEED_LIMIT_MPS + 1e-9
    || len(omega) > BAT_ANGULAR_SPEED_LIMIT_RADPS + 1e-9) return null;
  const reconstructed = addVec(gripVelocity, cross(omega, contactRadius));
  if (len(subVec(reconstructed, desiredVelocity)) > 1e-8) return null;
  for (const index of constrained) {
    const handRadius = subVec(hands[index], contact.grip);
    const radial = norm(subVec(hands[index], shoulders[index]));
    if (Math.abs(dot(addVec(gripVelocity, cross(omega, handRadius)), radial)) > 1e-7) return null;
  }
  return { twist: { gripVelocity, angularVelocity: omega }, anchorIndex };
}

interface FreeGripTwistCoordinates {
  /** Fraction of the contact-point transverse velocity authored through rigid rotation. */
  fraction: number;
  /** Dimensionless spin about the contact radius. It changes hand/blade motion without changing contact velocity. */
  radialRatio: number;
  /** Dimensionless second transverse nullspace component. */
  transverseRatio: number;
}

/**
 * Contact-exact full 3-D twist for the free-grip family. Any angular velocity is lawful because grip translation is
 * reconstructed from `desired - omega x contactRadius`; these coordinates are a scale-free deterministic basis for
 * that nullspace, not a result-conditioned impulse. Reach and every solid remain whole-path inequalities.
 */
function freeGripTwistForCoordinates(
  contact: BatPose,
  contactPoint: Vec3,
  desiredVelocity: Vec3,
  authoredOmega: Vec3,
  coordinates: FreeGripTwistCoordinates,
): BatRigidTwist | null {
  const { fraction, radialRatio, transverseRatio } = coordinates;
  if (![fraction, radialRatio, transverseRatio].every(Number.isFinite)
    || fraction < 0 || fraction > 1) return null;
  const contactRadius = subVec(contactPoint, contact.grip);
  const radius2 = dot(contactRadius, contactRadius);
  if (radius2 < 1e-8) return null;
  const alongScale = dot(desiredVelocity, contactRadius) / radius2;
  const perpendicular = subVec(desiredVelocity, scaleVec(contactRadius, alongScale));
  const firstRaw = cross(contactRadius, perpendicular);
  const firstMagnitude = len(firstRaw);
  const radiusMagnitude = Math.sqrt(radius2);
  if (firstMagnitude < 1e-10 || radiusMagnitude < 1e-8) return null;
  const first = scaleVec(firstRaw, 1 / firstMagnitude);
  const radial = scaleVec(contactRadius, 1 / radiusMagnitude);
  const transverse = norm(cross(radial, first));
  const baseRate = len(perpendicular) / radiusMagnitude;
  const omega = addVec(
    authoredOmega,
    addVec(
      scaleVec(first, fraction * baseRate),
      addVec(scaleVec(radial, radialRatio * baseRate), scaleVec(transverse, transverseRatio * baseRate)),
    ),
  );
  const gripVelocity = subVec(desiredVelocity, cross(omega, contactRadius));
  if (len(gripVelocity) > BAT_GRIP_SPEED_LIMIT_MPS + 1e-9
    || len(omega) > BAT_ANGULAR_SPEED_LIMIT_RADPS + 1e-9) return null;
  const reconstructed = addVec(gripVelocity, cross(omega, contactRadius));
  if (len(subVec(reconstructed, desiredVelocity)) > 1e-8) return null;
  return { gripVelocity, angularVelocity: omega };
}

function assembleFreeGripSo3Path(
  contact: BatPose,
  beforeS: number,
  afterS: number,
  handRampS: number,
  angularRampS: number,
  preGripEndpointCorrectionM: Vec3,
  postGripEndpointCorrectionM: Vec3,
  preOrientationRotationVectorRad: Vec3,
  postOrientationRotationVectorRad: Vec3,
): FreeGripSo3CollisionPath | null {
  const scalars = [beforeS, afterS, handRampS, angularRampS];
  const vectors = [
    preGripEndpointCorrectionM,
    postGripEndpointCorrectionM,
    preOrientationRotationVectorRad,
    postOrientationRotationVectorRad,
  ];
  if (!scalars.every(Number.isFinite) || !vectors.every((value) => (
    Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)
  ))) return null;
  const commonWindowS = Math.min(beforeS, afterS);
  if (beforeS <= 0 || afterS <= 0 || handRampS <= 0 || angularRampS <= 0
    || handRampS > commonWindowS + 1e-12 || angularRampS > commonWindowS + 1e-12
    || len(preGripEndpointCorrectionM) > BAT_HAND_REACH_SOLVE_M + 1e-12
    || len(postGripEndpointCorrectionM) > BAT_HAND_REACH_SOLVE_M + 1e-12
    || len(preOrientationRotationVectorRad) > Math.PI / 2 + 1e-12
    || len(postOrientationRotationVectorRad) > Math.PI / 2 + 1e-12) return null;
  const side = (
    durationS: number,
    gripEndpointCorrectionM: Vec3,
    orientationRotationVectorRad: Vec3,
  ): FreeGripSo3PathSide => ({
    durationS,
    handRampS,
    angularRampS,
    gripEndpointCorrectionM,
    orientationRotationVectorRad,
  });
  return {
    kind: 'free-grip-so3',
    contact,
    pre: side(beforeS, preGripEndpointCorrectionM, preOrientationRotationVectorRad),
    post: side(afterS, postGripEndpointCorrectionM, postOrientationRotationVectorRad),
    envelope: {
      gripSpeed: 0,
      pointSpeed: 0,
      gripAcceleration: 0,
      pointAcceleration: 0,
      angularSpeed: 0,
      angularAcceleration: 0,
      anatomyGapSpeed: 0,
    },
  };
}

function pathPrimitive(
  contact: BatPose,
  twist: BatRigidTwist,
  body: BatterBody,
  anchorIndex: 0 | 1,
  side: 'pre' | 'post',
  durationS: number,
  handRampS: number,
  angularRampS: number,
  steeringGain: number,
): BatCollisionPathSide | null {
  const offsets = [TOP_HAND_FROM_CAP, LOWER_HAND_FROM_CAP] as const;
  const otherIndex: 0 | 1 = anchorIndex === 0 ? 1 : 0;
  const shoulders = batterShoulders(body);
  const contactAxis = poseAxis(contact);
  const anchorHand = handPoint(contact, offsets[anchorIndex]);
  const anchorRadius = subVec(anchorHand, shoulders[anchorIndex]);
  const anchorVelocity = addVec(twist.gripVelocity, cross(twist.angularVelocity, subVec(anchorHand, contact.grip)));
  const anchorAxisRaw = cross(anchorRadius, anchorVelocity);
  if (len(anchorRadius) < 1e-8 || len(anchorAxisRaw) < 1e-8 || len(twist.angularVelocity) < 1e-8) return null;
  const direction = side === 'pre' ? -1 : 1;
  const anchorAngle = direction * 0.5 * (len(anchorVelocity) / len(anchorRadius)) * handRampS;
  const angularAngle = direction * 0.5 * len(twist.angularVelocity) * angularRampS;
  const endpointHand = addVec(shoulders[anchorIndex], rotate(anchorRadius, norm(anchorAxisRaw), anchorAngle));
  const endpointAxis = rotate(contactAxis, norm(twist.angularVelocity), angularAngle);
  const handSeparation = offsets[anchorIndex] - offsets[otherIndex];
  if (Math.abs(handSeparation) < 1e-9) return null;
  const towardOtherShoulder = norm(subVec(shoulders[otherIndex], endpointHand));
  const desiredAxis = scaleVec(towardOtherShoulder, Math.sign(handSeparation));
  const correctionRaw = cross(endpointAxis, desiredAxis);
  return {
    durationS,
    handRampS,
    angularRampS,
    correctionAxis: len(correctionRaw) > 1e-10 ? norm(correctionRaw) : UP,
    correctionAngleRad: dacos(clamp(dot(endpointAxis, desiredAxis), -1, 1)) * steeringGain,
  };
}

function assembleCollisionPath(
  contact: BatPose,
  twist: BatRigidTwist,
  body: BatterBody,
  anchorIndex: 0 | 1,
  beforeS: number,
  afterS: number,
  handRampS: number,
  angularRampS: number,
  steeringGain: number,
): BatCollisionPath | null {
  if (![beforeS, afterS, handRampS, angularRampS, steeringGain].every(Number.isFinite)
    || beforeS <= 0 || afterS <= 0 || handRampS <= 0 || angularRampS <= 0
    || handRampS > Math.min(beforeS, afterS) + 1e-12
    || angularRampS > Math.min(beforeS, afterS) + 1e-12
    || steeringGain < 0 || steeringGain > 1) return null;
  const offsets = [TOP_HAND_FROM_CAP, LOWER_HAND_FROM_CAP] as const;
  const shoulders = batterShoulders(body);
  const anchorHand = handPoint(contact, offsets[anchorIndex]);
  const anchorRadius = subVec(anchorHand, shoulders[anchorIndex]);
  const anchorVelocity = addVec(twist.gripVelocity, cross(twist.angularVelocity, subVec(anchorHand, contact.grip)));
  const anchorAxisRaw = cross(anchorRadius, anchorVelocity);
  if (len(anchorRadius) < 1e-8 || len(anchorAxisRaw) < 1e-8 || len(twist.angularVelocity) < 1e-8) return null;
  const pre = pathPrimitive(contact, twist, body, anchorIndex, 'pre', beforeS, handRampS, angularRampS, steeringGain);
  const post = pathPrimitive(contact, twist, body, anchorIndex, 'post', afterS, handRampS, angularRampS, steeringGain);
  if (!pre || !post) return null;
  return {
    kind: 'shoulder-sphere',
    contact,
    anchorShoulder: shoulders[anchorIndex],
    anchorRadius,
    anchorAxis: norm(anchorAxisRaw),
    anchorRateRadps: len(anchorVelocity) / len(anchorRadius),
    anchorHandFromCapM: offsets[anchorIndex],
    otherHandFromCapM: offsets[anchorIndex === 0 ? 1 : 0],
    contactAxis: poseAxis(contact),
    contactNormal: contact.n,
    angularAxis: norm(twist.angularVelocity),
    angularRateRadps: len(twist.angularVelocity),
    pre,
    post,
    envelope: {
      gripSpeed: 0,
      pointSpeed: 0,
      gripAcceleration: 0,
      pointAcceleration: 0,
      angularSpeed: 0,
      angularAcceleration: 0,
      anatomyGapSpeed: 0,
    },
  };
}

const CAP_ALONG = [-BAT_FULL, -HANDLE_L] as const;
const CAP_ACROSS = [-BLADE_HALF_W, BLADE_HALF_W] as const;
const CAP_NORMAL = [-BLADE_T / 2, BLADE_T / 2] as const;
const CAP_GLOVE_ALONG = [-HANDLE_L, -0.04] as const;

/**
 * Analytic speed/acceleration envelope of the rigid bat's corners and glove capsule at one kinematic sample.
 * Scalar and allocation-free: every product, sum and their order is the vector form's
 * (addVec(addVec(scaleVec(axis, along), scaleVec(width, across)), scaleVec(n, normal)), cross, len), so the
 * envelope is bit-identical (tests/unit/physics/batGeometryEquivalence.test.ts).
 */
function pathPointCaps(sample: BatCollisionKinematics): BatAnalyticEnvelope {
  const axis = poseAxis(sample.pose);
  const width = norm(cross(axis, sample.pose.n));
  const n = sample.pose.n;
  const gvx = sample.gripVelocity.x;
  const gvy = sample.gripVelocity.y;
  const gvz = sample.gripVelocity.z;
  const gax = sample.gripAcceleration.x;
  const gay = sample.gripAcceleration.y;
  const gaz = sample.gripAcceleration.z;
  const wx = sample.angularVelocity.x;
  const wy = sample.angularVelocity.y;
  const wz = sample.angularVelocity.z;
  const alx = sample.angularAcceleration.x;
  const aly = sample.angularAcceleration.y;
  const alz = sample.angularAcceleration.z;
  let pointSpeed = len(sample.gripVelocity);
  let pointAcceleration = len(sample.gripAcceleration);
  for (const along of CAP_ALONG) {
    for (const across of CAP_ACROSS) {
      for (const normal of CAP_NORMAL) {
        const rx = (axis.x * along + width.x * across) + n.x * normal;
        const ry = (axis.y * along + width.y * across) + n.y * normal;
        const rz = (axis.z * along + width.z * across) + n.z * normal;
        const rotx = wy * rz - wz * ry;
        const roty = wz * rx - wx * rz;
        const rotz = wx * ry - wy * rx;
        const vx = gvx + rotx;
        const vy = gvy + roty;
        const vz = gvz + rotz;
        const ax = (gax + (aly * rz - alz * ry)) + (wy * rotz - wz * roty);
        const ay = (gay + (alz * rx - alx * rz)) + (wz * rotx - wx * rotz);
        const az = (gaz + (alx * ry - aly * rx)) + (wx * roty - wy * rotx);
        pointSpeed = Math.max(pointSpeed, Math.sqrt(vx * vx + vy * vy + vz * vz));
        pointAcceleration = Math.max(pointAcceleration, Math.sqrt(ax * ax + ay * ay + az * az));
      }
    }
  }
  const omega = len(sample.angularVelocity);
  const alpha = len(sample.angularAcceleration);
  for (const along of CAP_GLOVE_ALONG) {
    const rx = axis.x * along;
    const ry = axis.y * along;
    const rz = axis.z * along;
    const rotx = wy * rz - wz * ry;
    const roty = wz * rx - wx * rz;
    const rotz = wx * ry - wy * rx;
    const cx = (gax + (aly * rz - alz * ry)) + (wy * rotz - wz * roty);
    const cy = (gay + (alz * rx - alx * rz)) + (wz * rotx - wx * rotz);
    const cz = (gaz + (alx * ry - aly * rx)) + (wx * roty - wy * rotx);
    const vx = gvx + rotx;
    const vy = gvy + roty;
    const vz = gvz + rotz;
    pointSpeed = Math.max(pointSpeed, Math.sqrt(vx * vx + vy * vy + vz * vz) + omega * GLOVE_R);
    pointAcceleration = Math.max(
      pointAcceleration,
      Math.sqrt(cx * cx + cy * cy + cz * cz) + (alpha + omega * omega) * GLOVE_R,
    );
  }
  return {
    gripSpeed: len(sample.gripVelocity),
    pointSpeed,
    gripAcceleration: len(sample.gripAcceleration),
    pointAcceleration,
    angularSpeed: omega,
    angularAcceleration: alpha,
    anatomyGapSpeed: pointSpeed,
  };
}

function pathJerkBounds(path: BatCollisionPath, twist: BatRigidTwist): { grip: number; point: number; angular: number } {
  let grip = 0;
  let point = 0;
  let angular = 0;
  for (const sideName of ['pre', 'post'] as const) {
    const side = path[sideName];
    const durationSquared = side.durationS * side.durationS;
    const durationCubed = durationSquared * side.durationS;
    const correctionMagnitude = path.kind === 'free-grip-so3'
      ? len(path[sideName].orientationRotationVectorRad)
      : Math.abs(path[sideName].correctionAngleRad);
    const correctionOmega = correctionMagnitude * 1.875 / side.durationS;
    const correctionAlpha = correctionMagnitude * (10 / Math.sqrt(3)) / durationSquared;
    const correctionJerk = correctionMagnitude * 60 / durationCubed;
    const baseOmega = path.kind === 'free-grip-so3' ? len(twist.angularVelocity) : path.angularRateRadps;
    const baseAlpha = RAMP_PEAK_FACTOR * baseOmega / side.angularRampS;
    const baseJerk = RAMP_JERK_FACTOR * baseOmega / (side.angularRampS * side.angularRampS);
    const totalOmega = baseOmega + correctionOmega;
    const totalAlpha = baseAlpha + correctionAlpha + correctionOmega * baseOmega;
    const angularJerk = correctionJerk
      + baseJerk
      + 2 * correctionOmega * baseAlpha
      + correctionAlpha * baseOmega
      + correctionOmega * correctionOmega * baseOmega;
    const rotationJerk = angularJerk + 3 * totalOmega * totalAlpha
      + totalOmega * totalOmega * totalOmega;
    const gripJerk = path.kind === 'free-grip-so3'
      ? len(path[sideName].gripEndpointCorrectionM) * 60 / durationCubed
        + RAMP_JERK_FACTOR * len(twist.gripVelocity) / (side.handRampS * side.handRampS)
      : (() => {
          const anchorOmega = path.anchorRateRadps;
          const anchorAlpha = RAMP_PEAK_FACTOR * anchorOmega / side.handRampS;
          const anchorJerk = len(path.anchorRadius) * (
            RAMP_JERK_FACTOR * anchorOmega / (side.handRampS * side.handRampS)
            + 3 * anchorOmega * anchorAlpha + anchorOmega * anchorOmega * anchorOmega
          );
          return anchorJerk + path.anchorHandFromCapM * rotationJerk;
        })();
    grip = Math.max(grip, gripJerk);
    angular = Math.max(angular, angularJerk);
    point = Math.max(point, gripJerk + BAT_CONVEX_RADIUS_M * rotationJerk);
  }
  return { grip, point, angular };
}

interface CollisionPathCertificateSample {
  caps: BatAnalyticEnvelope;
  gap: number;
  planningReachMargin: number;
  planningHandSpeed: number;
}

/**
 * Continuous certificate over smooth analytic path segments. Endpoint acceleration limits are one-sided at every
 * authored join. Global jerk bounds enclose acceleration between the endpoints; the resulting speed bounds enclose
 * both solid Hausdorff motion and the two exact ordered-hand reach traces. Subdivision is deterministic and fails
 * closed at the declared resolution/work cap.
 */
function certifyCollisionPathContinuous(
  track: BatTrack,
  path: BatCollisionPath,
  body: BatterBody,
  minimumStepS: number,
): PathCaps | null {
  const maxima: BatAnalyticEnvelope = {
    gripSpeed: 0,
    pointSpeed: 0,
    gripAcceleration: 0,
    pointAcceleration: 0,
    angularSpeed: 0,
    angularAcceleration: 0,
    anatomyGapSpeed: 0,
  };
  const shoulders = batterShoulders(body);
  if (path.kind === 'shoulder-sphere' && len(path.anchorRadius) > BAT_HAND_REACH_SOLVE_M + 1e-9) return null;
  const anchorIndex: 0 | 1 | null = path.kind === 'shoulder-sphere'
    ? (Math.abs(path.anchorHandFromCapM - TOP_HAND_FROM_CAP) <= 1e-12 ? 0 : 1)
    : null;
  const jerk = pathJerkBounds(path, track.collisionTwist);
  let minimumGap = Infinity;
  let work = 0;
  const workLimit = 32_768;

  for (const sideName of ['pre', 'post'] as const) {
    const side = path[sideName];
    const cache = new Map<number, CollisionPathCertificateSample>();
    const sampleAtDistance = (distance: number, leftLimit: boolean): CollisionPathCertificateSample | null => {
      const key = leftLimit ? -1 - distance : distance;
      const retained = cache.get(key);
      if (retained) return retained;
      if (++work > workLimit) return null;
      const sample = collisionPathSideKinematics(path, track.collisionTwist, sideName, distance, leftLimit);
      const caps = pathPointCaps(sample);
      const admissibility = batPoseGapReach(sample.pose, body);
      let planningReachMargin = Infinity;
      let planningHandSpeed = 0;
      for (const handIndex of [0, 1] as const) {
        if (anchorIndex === handIndex) continue;
        const offset = handIndex === 0 ? TOP_HAND_FROM_CAP : LOWER_HAND_FROM_CAP;
        const hand = handPoint(sample.pose, offset);
        const handRadius = subVec(hand, sample.pose.grip);
        planningReachMargin = Math.min(
          planningReachMargin,
          BAT_HAND_REACH_SOLVE_M - len(subVec(hand, shoulders[handIndex])),
        );
        planningHandSpeed = Math.max(planningHandSpeed, len(addVec(
          sample.gripVelocity,
          cross(sample.angularVelocity, handRadius),
        )));
      }
      const value = { caps, gap: admissibility.gap, planningReachMargin, planningHandSpeed };
      cache.set(key, value);
      return value;
    };

    const boundaries = [0, side.handRampS, side.angularRampS, side.durationS]
      .sort((left, right) => left - right)
      .filter((value, index, values) => index === 0 || value - values[index - 1] > 1e-12);
    const intervals: Array<{ low: number; high: number }> = [];
    for (let index = boundaries.length - 2; index >= 0; index--) {
      intervals.push({ low: boundaries[index], high: boundaries[index + 1] });
    }
    while (intervals.length > 0) {
      const interval = intervals.pop()!;
      const width = interval.high - interval.low;
      if (!(width > 0) || !Number.isFinite(width)) return null;
      const low = sampleAtDistance(interval.low, false);
      const high = sampleAtDistance(interval.high, true);
      if (!low || !high) return null;
      const halfWidth = width / 2;
      const gripAcceleration = Math.max(low.caps.gripAcceleration, high.caps.gripAcceleration)
        + jerk.grip * halfWidth;
      const pointAcceleration = Math.max(low.caps.pointAcceleration, high.caps.pointAcceleration)
        + jerk.point * halfWidth;
      const angularAcceleration = Math.max(low.caps.angularAcceleration, high.caps.angularAcceleration)
        + jerk.angular * halfWidth;
      const gripSpeed = Math.max(low.caps.gripSpeed, high.caps.gripSpeed) + gripAcceleration * halfWidth;
      const pointSpeed = Math.max(low.caps.pointSpeed, high.caps.pointSpeed) + pointAcceleration * halfWidth;
      const angularSpeed = Math.max(low.caps.angularSpeed, high.caps.angularSpeed)
        + angularAcceleration * halfWidth;
      const gap = Math.min(low.gap, high.gap) - pointSpeed * halfWidth;
      const planningHandSpeed = Math.max(low.planningHandSpeed, high.planningHandSpeed)
        + pointAcceleration * halfWidth;
      const planningReachMargin = Math.min(low.planningReachMargin, high.planningReachMargin)
        - planningHandSpeed * halfWidth;
      const finite = [
        gripAcceleration,
        pointAcceleration,
        angularAcceleration,
        gripSpeed,
        pointSpeed,
        angularSpeed,
        gap,
        planningReachMargin,
      ].every(Number.isFinite);
      const safe = finite
        && gripSpeed <= BAT_GRIP_SPEED_LIMIT_MPS + 1e-9
        && pointSpeed <= BAT_POINT_SPEED_LIMIT_MPS + 1e-9
        && gripAcceleration <= BAT_GRIP_ACCEL_LIMIT_MPS2 + 1e-9
        && pointAcceleration <= BAT_POINT_ACCEL_LIMIT_MPS2 + 1e-9
        && angularSpeed <= BAT_ANGULAR_SPEED_LIMIT_RADPS + 1e-9
        && angularAcceleration <= BAT_ANGULAR_ACCEL_LIMIT_RADPS2 + 1e-9
        && gap >= -1e-9
        && planningReachMargin >= -1e-9;
      if (!safe) {
        if (width <= minimumStepS + 1e-15) return null;
        const middle = (interval.low + interval.high) / 2;
        // LIFO order remains low-to-high and deterministic.
        intervals.push({ low: middle, high: interval.high }, { low: interval.low, high: middle });
        continue;
      }
      maxima.gripSpeed = Math.max(maxima.gripSpeed, gripSpeed);
      maxima.pointSpeed = Math.max(maxima.pointSpeed, pointSpeed);
      maxima.gripAcceleration = Math.max(maxima.gripAcceleration, gripAcceleration);
      maxima.pointAcceleration = Math.max(maxima.pointAcceleration, pointAcceleration);
      maxima.angularSpeed = Math.max(maxima.angularSpeed, angularSpeed);
      maxima.angularAcceleration = Math.max(maxima.angularAcceleration, angularAcceleration);
      minimumGap = Math.min(minimumGap, gap, planningReachMargin);
    }
  }
  maxima.anatomyGapSpeed = maxima.pointSpeed;
  return { ...maxima, minimumGap };
}

function certifyCollisionPath(
  track: BatTrack,
  path: BatCollisionPath,
  body: BatterBody,
  stepS: number,
  continuous: boolean,
): PathCaps | null {
  if (continuous) return certifyCollisionPathContinuous(track, path, body, stepS);
  const maxima: BatAnalyticEnvelope = {
    gripSpeed: 0,
    pointSpeed: 0,
    gripAcceleration: 0,
    pointAcceleration: 0,
    angularSpeed: 0,
    angularAcceleration: 0,
    anatomyGapSpeed: 0,
  };
  let minimumGap = Infinity;
  const shoulders = batterShoulders(body);
  if (path.kind === 'shoulder-sphere' && len(path.anchorRadius) > BAT_HAND_REACH_SOLVE_M + 1e-9) return null;
  const anchorIndex: 0 | 1 | null = path.kind === 'shoulder-sphere'
    ? (Math.abs(path.anchorHandFromCapM - TOP_HAND_FROM_CAP) <= 1e-12 ? 0 : 1)
    : null;
  let planningReachMargin = Infinity;
  let planningHandSpeed = 0;
  const includeSample = (
    sideName: 'pre' | 'post',
    distanceFromContact: number,
    leftLimit: boolean,
  ) => {
    const sample = collisionPathSideKinematics(
      path,
      track.collisionTwist,
      sideName,
      distanceFromContact,
      leftLimit,
    );
    const caps = pathPointCaps(sample);
    maxima.gripSpeed = Math.max(maxima.gripSpeed, caps.gripSpeed);
    maxima.pointSpeed = Math.max(maxima.pointSpeed, caps.pointSpeed);
    maxima.gripAcceleration = Math.max(maxima.gripAcceleration, caps.gripAcceleration);
    maxima.pointAcceleration = Math.max(maxima.pointAcceleration, caps.pointAcceleration);
    maxima.angularSpeed = Math.max(maxima.angularSpeed, caps.angularSpeed);
    maxima.angularAcceleration = Math.max(maxima.angularAcceleration, caps.angularAcceleration);
    const admissibility = batPoseGapReach(sample.pose, body);
    minimumGap = Math.min(minimumGap, admissibility.gap);
    for (const handIndex of [0, 1] as const) {
      if (anchorIndex === handIndex) continue;
      const offset = handIndex === 0 ? TOP_HAND_FROM_CAP : LOWER_HAND_FROM_CAP;
      const hand = handPoint(sample.pose, offset);
      const handRadius = subVec(hand, sample.pose.grip);
      planningReachMargin = Math.min(planningReachMargin, BAT_HAND_REACH_SOLVE_M - len(subVec(
        hand,
        shoulders[handIndex],
      )));
      planningHandSpeed = Math.max(planningHandSpeed, len(addVec(
        sample.gripVelocity,
        cross(sample.angularVelocity, handRadius),
      )));
    }
  };
  for (const [sideName, duration] of [['pre', path.pre.durationS], ['post', path.post.durationS]] as const) {
    const count = Math.max(1, Math.ceil(duration / stepS));
    for (let index = 0; index <= count; index++) {
      const distanceFromContact = duration * index / count;
      includeSample(sideName, distanceFromContact, false);
    }
    // Uniform samples do not necessarily land exactly on a profile join. Evaluate both one-sided authorities
    // explicitly; duplicates are harmless and avoid an allocation/sort in the production certificate.
    for (const boundary of [path[sideName].handRampS, path[sideName].angularRampS, duration]) {
      includeSample(sideName, boundary, false);
      includeSample(sideName, boundary, true);
    }
  }
  maxima.anatomyGapSpeed = maxima.pointSpeed;
  const rejected = maxima.gripSpeed > BAT_GRIP_SPEED_LIMIT_MPS + 1e-9
    || maxima.pointSpeed > BAT_POINT_SPEED_LIMIT_MPS + 1e-9
    || maxima.gripAcceleration > BAT_GRIP_ACCEL_LIMIT_MPS2 + 1e-9
    || maxima.pointAcceleration > BAT_POINT_ACCEL_LIMIT_MPS2 + 1e-9
    || maxima.angularSpeed > BAT_ANGULAR_SPEED_LIMIT_RADPS + 1e-9
    || maxima.angularAcceleration > BAT_ANGULAR_ACCEL_LIMIT_RADPS2 + 1e-9
    || minimumGap < -1e-9
    || planningReachMargin < -1e-9;
  if (rejected) return null;
  return { ...maxima, minimumGap: Math.min(minimumGap, planningReachMargin) };
}

interface FreeGripBodyCandidate {
  body: BatterBody;
  root: { x: number; z: number };
  crouchM: number;
  contactGap: number;
}

function freeGripBodyCandidateAt(
  contact: BatPose,
  nominalBody: BatterBody,
  root: { x: number; z: number },
  crouchM: number,
): FreeGripBodyCandidate | null {
  if (!Number.isFinite(root.x) || !Number.isFinite(root.z) || !Number.isFinite(crouchM)
    || planarMagnitude(root.x, root.z) > BAT_BODY_RETARGET_M + 1e-12) return null;
  const body = translateBatterBody(applyBatterPosture(nominalBody, crouchM), root);
  const admissibility = batPoseAdmissibility(contact, body);
  if (admissibility.gap < -1e-9 || admissibility.reach > BAT_HAND_REACH_SOLVE_M + 1e-9) return null;
  return { body, root, crouchM, contactGap: Math.min(
    admissibility.gap,
    BAT_HAND_REACH_SOLVE_M - admissibility.reach,
  ) };
}

function lateralFreeGripBodyCandidate(
  contact: BatPose,
  nominalBody: BatterBody,
  radiusRatio: number,
  crouchRatio: number,
): FreeGripBodyCandidate | null {
  const maximumCrouchM = remainingBatterPostureCrouchM(nominalBody);
  const phase = datan2(
    contact.grip.z - nominalBody.torso.b.z,
    contact.grip.x - nominalBody.torso.b.x,
  );
  const angle = phase - Math.PI / 2;
  const radius = BAT_BODY_RETARGET_M * radiusRatio;
  return freeGripBodyCandidateAt(
    contact,
    nominalBody,
    { x: radius * dcos(angle), z: radius * dsin(angle) },
    maximumCrouchM * crouchRatio,
  );
}

function priorityFreeGripBodyCandidate(contact: BatPose, nominalBody: BatterBody): FreeGripBodyCandidate | null {
  return lateralFreeGripBodyCandidate(contact, nominalBody, 0.995, 1);
}

function freeGripBodyCandidates(contact: BatPose, nominalBody: BatterBody): FreeGripBodyCandidate[] {
  const out: FreeGripBodyCandidate[] = [];
  const append = (root: { x: number; z: number }, crouchM: number) => {
    const candidate = freeGripBodyCandidateAt(contact, nominalBody, root, crouchM);
    if (!candidate) return;
    if (out.some((value) => (
      Math.abs(value.root.x - root.x) <= 1e-12
      && Math.abs(value.root.z - root.z) <= 1e-12
      && Math.abs(value.crouchM - crouchM) <= 1e-12
    ))) return;
    out.push(candidate);
  };
  const maximumCrouchM = remainingBatterPostureCrouchM(nominalBody);
  const phase = datan2(
    contact.grip.z - nominalBody.torso.b.z,
    contact.grip.x - nominalBody.torso.b.x,
  );
  // A lateral, almost full-root stance is the geometry-derived clearance landmark: it moves the torso away from
  // the blade plane without spending reach directly along the contact ray. It is tried first, then the complete
  // bounded strata below retain deterministic fallback coverage.
  const priority = priorityFreeGripBodyCandidate(contact, nominalBody);
  if (priority) out.push(priority);
  const minimum = solveBatterRootOffsetForPoses([contact], nominalBody);
  if (minimum.solved) append(minimum.offset, minimum.crouchM);
  // The minimum-norm reach solve can be solid-blocked even when translating laterally to the closed root boundary
  // clears the body. World-compass cap sectors are geometry-independent escape seeds; every one still undergoes the
  // exact contact full-solid/reach validation above and the complete path certificate below.
  const capRadius = BAT_BODY_RETARGET_M * 0.995;
  for (let sector = 0; sector < 16; sector++) {
    const angle = sector * Math.PI / 8;
    append(
      { x: capRadius * dcos(angle), z: capRadius * dsin(angle) },
      maximumCrouchM,
    );
  }
  // The phase is contact geometry; fixed angular/radial strata preserve domain diversity without a fixture root.
  for (let sector = 0; sector < 16; sector++) {
    const angle = phase + sector * Math.PI / 8;
    const sectorCandidates: FreeGripBodyCandidate[] = [];
    const start = out.length;
    for (const radiusRatio of [0.5, 0.78, 0.995]) {
      const radius = BAT_BODY_RETARGET_M * radiusRatio;
      const root = { x: radius * dcos(angle), z: radius * dsin(angle) };
      for (const crouchRatio of [0.5, 0.75, 0.875, 1]) {
        append(root, maximumCrouchM * crouchRatio);
      }
    }
    sectorCandidates.push(...out.splice(start));
    sectorCandidates.sort((left, right) => right.contactGap - left.contactGap
      || planarMagnitude(left.root.x, left.root.z) - planarMagnitude(right.root.x, right.root.z)
      || left.crouchM - right.crouchM);
    out.push(...sectorCandidates.slice(0, 2));
  }
  return out;
}

function minimumRotationVector(from: Vec3, to: Vec3): Vec3 | null {
  const source = norm(from);
  const target = norm(to);
  const cosine = clamp(dot(source, target), -1, 1);
  const angle = dacos(cosine);
  if (angle <= 1e-12) return v3(0, 0, 0);
  const rawAxis = cross(source, target);
  if (len(rawAxis) <= 1e-10 || angle > Math.PI / 2 + 1e-12) return null;
  return scaleVec(norm(rawAxis), angle);
}

interface ScoredFreeSide {
  gripEndpointCorrectionM: Vec3;
  orientationRotationVectorRad: Vec3;
  score: number;
}

interface FreeGripEndpointLandmark {
  angleOffsetRad: number;
  clearanceTorsoRatio: number;
  yTorsoRatio: number;
  axisVertical: number;
}

const FREE_GRIP_NULLSPACE_COORDINATES: readonly FreeGripTwistCoordinates[] = [
  // The first scale-free node has independent frozen evidence. The remaining symmetric nodes keep a small bounded
  // 3-D neighborhood when another geometry needs the opposite contact-radius spin or transverse hand motion.
  { fraction: 31 / 40, radialRatio: 1 / 10, transverseRatio: 1 / 8 },
  { fraction: 31 / 40, radialRatio: 1 / 10, transverseRatio: 0 },
  { fraction: 31 / 40, radialRatio: 0, transverseRatio: 1 / 8 },
  { fraction: 31 / 40, radialRatio: 0, transverseRatio: 0 },
  { fraction: 31 / 40, radialRatio: -1 / 10, transverseRatio: 1 / 8 },
  { fraction: 31 / 40, radialRatio: 1 / 10, transverseRatio: -1 / 8 },
  { fraction: 31 / 40, radialRatio: -1 / 10, transverseRatio: 0 },
  { fraction: 31 / 40, radialRatio: 0, transverseRatio: -1 / 8 },
  { fraction: 31 / 40, radialRatio: -1 / 10, transverseRatio: -1 / 8 },
] as const;

const FREE_GRIP_PRE_LANDMARK: FreeGripEndpointLandmark = {
  angleOffsetRad: Math.PI / 4,
  clearanceTorsoRatio: -1 / 8,
  yTorsoRatio: -5 / 4,
  axisVertical: 3 / 10,
};
const FREE_GRIP_POST_LANDMARK: FreeGripEndpointLandmark = {
  angleOffsetRad: 0,
  clearanceTorsoRatio: -1 / 8,
  yTorsoRatio: -1,
  axisVertical: 0,
};

function freeGripLandmarkSide(
  contact: BatPose,
  twist: BatRigidTwist,
  body: BatterBody,
  beforeS: number,
  afterS: number,
  handRampS: number,
  angularRampS: number,
  sideName: 'pre' | 'post',
  landmark: FreeGripEndpointLandmark,
): ScoredFreeSide | null {
  const zero = v3(0, 0, 0);
  const blank = assembleFreeGripSo3Path(
    contact, beforeS, afterS, handRampS, angularRampS, zero, zero, zero, zero,
  );
  if (!blank) return null;
  const endpoint = freeGripSo3SideKinematics(blank, twist, sideName, blank[sideName].durationS);
  const shoulders = batterShoulders(body);
  const centre = v3(
    (shoulders[0].x + shoulders[1].x) / 2,
    (shoulders[0].y + shoulders[1].y) / 2,
    (shoulders[0].z + shoulders[1].z) / 2,
  );
  const bearing = datan2(endpoint.pose.grip.z - centre.z, endpoint.pose.grip.x - centre.x)
    + landmark.angleOffsetRad;
  const outward = v3(dcos(bearing), 0, dsin(bearing));
  const radius = body.torso.r + BLADE_HALF_W + landmark.clearanceTorsoRatio * body.torso.r;
  const targetGrip = v3(
    centre.x + outward.x * radius,
    centre.y + landmark.yTorsoRatio * body.torso.r,
    centre.z + outward.z * radius,
  );
  const gripEndpointCorrectionM = subVec(targetGrip, endpoint.pose.grip);
  if (len(gripEndpointCorrectionM) > BAT_HAND_REACH_SOLVE_M + 1e-12) return null;
  const targetAxis = norm(v3(-outward.x, landmark.axisVertical, -outward.z));
  const orientationRotationVectorRad = minimumRotationVector(poseAxis(endpoint.pose), targetAxis);
  if (!orientationRotationVectorRad) return null;
  const oneSide = assembleFreeGripSo3Path(
    contact,
    beforeS,
    afterS,
    handRampS,
    angularRampS,
    sideName === 'pre' ? gripEndpointCorrectionM : zero,
    sideName === 'post' ? gripEndpointCorrectionM : zero,
    sideName === 'pre' ? orientationRotationVectorRad : zero,
    sideName === 'post' ? orientationRotationVectorRad : zero,
  );
  if (!oneSide) return null;
  return {
    gripEndpointCorrectionM,
    orientationRotationVectorRad,
    score: scoreFreeGripSide(oneSide, twist, body, sideName, 4),
  };
}

function scoreFreeGripSide(
  path: FreeGripSo3CollisionPath,
  twist: BatRigidTwist,
  body: BatterBody,
  sideName: 'pre' | 'post',
  subdivisions = 16,
): number {
  const side = path[sideName];
  const distances = [0, side.handRampS, side.angularRampS, side.durationS];
  for (let index = 1; index < subdivisions; index++) distances.push(side.durationS * index / subdivisions);
  distances.sort((left, right) => left - right);
  const unique = distances.filter((value, index) => index === 0 || Math.abs(value - distances[index - 1]) > 1e-12);
  const shoulders = batterShoulders(body);
  let score = 0;
  let maximumRatio = 0;
  let minimumMargin = Infinity;
  for (const distance of unique) {
    for (const leftLimit of [false, true]) {
      if (leftLimit && ![side.handRampS, side.angularRampS, side.durationS]
        .some((boundary) => Math.abs(distance - boundary) <= 1e-12)) continue;
      const sample = freeGripSo3SideKinematics(path, twist, sideName, distance, leftLimit);
      const caps = pathPointCaps(sample);
      const ratios = [
        caps.gripSpeed / BAT_GRIP_SPEED_LIMIT_MPS,
        caps.pointSpeed / BAT_POINT_SPEED_LIMIT_MPS,
        caps.gripAcceleration / BAT_GRIP_ACCEL_LIMIT_MPS2,
        caps.pointAcceleration / BAT_POINT_ACCEL_LIMIT_MPS2,
        caps.angularSpeed / BAT_ANGULAR_SPEED_LIMIT_RADPS,
        caps.angularAcceleration / BAT_ANGULAR_ACCEL_LIMIT_RADPS2,
      ];
      for (const ratio of ratios) {
        maximumRatio = Math.max(maximumRatio, ratio);
        const excess = Math.max(0, ratio - 1);
        score += excess * excess * 100;
      }
      const admissibility = batPoseGapReach(sample.pose, body);
      let planningReachMargin = Infinity;
      for (const handIndex of [0, 1] as const) {
        const offset = handIndex === 0 ? TOP_HAND_FROM_CAP : LOWER_HAND_FROM_CAP;
        planningReachMargin = Math.min(
          planningReachMargin,
          BAT_HAND_REACH_SOLVE_M - len(subVec(handPoint(sample.pose, offset), shoulders[handIndex])),
        );
      }
      const margin = Math.min(admissibility.gap, planningReachMargin);
      minimumMargin = Math.min(minimumMargin, margin);
      const intrusion = Math.max(0, -margin / 0.02);
      score += intrusion * intrusion * 100;
      const reserveDeficit = Math.max(0, (0.001 - margin) / 0.01);
      score += reserveDeficit * reserveDeficit * 100;
    }
  }
  return score + maximumRatio - Math.min(0.02, minimumMargin) * 5;
}

function freeGripSideCandidates(
  contact: BatPose,
  twist: BatRigidTwist,
  body: BatterBody,
  beforeS: number,
  afterS: number,
  handRampS: number,
  angularRampS: number,
  sideName: 'pre' | 'post',
  refine = true,
  preferredOnly = false,
): ScoredFreeSide[] {
  const zero = v3(0, 0, 0);
  const blank = assembleFreeGripSo3Path(contact, beforeS, afterS, handRampS, angularRampS, zero, zero, zero, zero);
  if (!blank) return [];
  const endpoint = freeGripSo3SideKinematics(
    blank,
    twist,
    sideName,
    blank[sideName].durationS,
  );
  const centre = v3(
    (batterShoulders(body)[0].x + batterShoulders(body)[1].x) / 2,
    (batterShoulders(body)[0].y + batterShoulders(body)[1].y) / 2,
    (batterShoulders(body)[0].z + batterShoulders(body)[1].z) / 2,
  );
  const baseAngle = datan2(endpoint.pose.grip.z - centre.z, endpoint.pose.grip.x - centre.x);
  const baseAxis = poseAxis(endpoint.pose);
  const coarse: ScoredFreeSide[] = [];
  const appendControl = (angleOffset: number, clearance: number, yOffset: number, vertical: number) => {
    const angle = baseAngle + angleOffset;
    const outward = v3(dcos(angle), 0, dsin(angle));
    const radius = body.torso.r + BLADE_HALF_W + clearance;
    const targetGrip = v3(
      centre.x + outward.x * radius,
      centre.y + yOffset,
      centre.z + outward.z * radius,
    );
    const gripEndpointCorrectionM = subVec(targetGrip, endpoint.pose.grip);
    if (len(gripEndpointCorrectionM) > BAT_HAND_REACH_SOLVE_M) return;
    const targetAxis = norm(v3(-outward.x, vertical, -outward.z));
    const orientationRotationVectorRad = minimumRotationVector(baseAxis, targetAxis);
    if (!orientationRotationVectorRad) return;
    const path = assembleFreeGripSo3Path(
      contact,
      beforeS,
      afterS,
      handRampS,
      angularRampS,
      sideName === 'pre' ? gripEndpointCorrectionM : zero,
      sideName === 'post' ? gripEndpointCorrectionM : zero,
      sideName === 'pre' ? orientationRotationVectorRad : zero,
      sideName === 'post' ? orientationRotationVectorRad : zero,
    );
    if (!path) return;
    coarse.push({
      gripEndpointCorrectionM,
      orientationRotationVectorRad,
      score: scoreFreeGripSide(path, twist, body, sideName, refine ? 4 : 2),
    });
  };
  if (preferredOnly) {
    for (const angleOffset of [-Math.PI / 4, 0, Math.PI / 4]) {
      appendControl(
        angleOffset,
        sideName === 'pre' ? 0.01 : 0.02,
        sideName === 'pre' ? 0.06 : -0.02,
        0,
      );
    }
  } else {
    for (const angleOffset of [-Math.PI / 4, 0, Math.PI / 4]) {
      for (const clearance of [0.01, 0.02, 0.04]) {
        for (const yOffset of [-0.02, 0.06]) {
          for (const vertical of [-0.15, 0]) appendControl(angleOffset, clearance, yOffset, vertical);
        }
      }
    }
  }
  coarse.sort((left, right) => left.score - right.score);
  if (!refine) return coarse.slice(0, 3);
  const scored = coarse.slice(0, 6).map((value) => {
    const zero = v3(0, 0, 0);
    const path = assembleFreeGripSo3Path(
      contact,
      beforeS,
      afterS,
      handRampS,
      angularRampS,
      sideName === 'pre' ? value.gripEndpointCorrectionM : zero,
      sideName === 'post' ? value.gripEndpointCorrectionM : zero,
      sideName === 'pre' ? value.orientationRotationVectorRad : zero,
      sideName === 'post' ? value.orientationRotationVectorRad : zero,
    );
    return path ? { ...value, score: scoreFreeGripSide(path, twist, body, sideName) } : value;
  });
  scored.sort((left, right) => left.score - right.score);
  return scored.slice(0, 3);
}

function freeGripCandidatesForGeometry(
  candidate: BatTrack,
  nominalBody: BatterBody,
  contactPose: BatPose,
  geometryOrdinal: number,
  broad: boolean,
): PreparedGeneralizedPath[] {
  const request = contactVelocityRequest(candidate, contactPose, candidate.vLine);
  const beforeS = candidate.plannedContactT - candidate.zoneIn;
  const afterS = candidate.zoneOut - candidate.plannedContactT;
  const commonWindowS = Math.min(beforeS, afterS);
  if (commonWindowS < 0.02) return [];
  const twists = [0.8, 0.75, 0.85, 0.7, 0.9].map((fraction) => freeGripTwistForCoordinates(
    contactPose,
    request.point,
    request.desired,
    request.authoredOmega,
    { fraction, radialRatio: 0, transverseRatio: 0 },
  )).filter((value): value is BatRigidTwist => value !== null).filter((twist) => {
    const zero = v3(0, 0, 0);
    const path = assembleFreeGripSo3Path(
      contactPose, beforeS, afterS, commonWindowS, commonWindowS, zero, zero, zero, zero,
    );
    if (!path) return false;
    // The C1 profile has zero ramp acceleration at contact and its peak at mid-ramp: screen both instants.
    return (['pre', 'post'] as const).every((side) => [0, commonWindowS / 2].every((distance) => {
      const caps = pathPointCaps(freeGripSo3SideKinematics(path, twist, side, distance));
      return caps.gripAcceleration <= BAT_GRIP_ACCEL_LIMIT_MPS2 + 1e-9
        && caps.pointAcceleration <= BAT_POINT_ACCEL_LIMIT_MPS2 + 1e-9
        && caps.angularAcceleration <= BAT_ANGULAR_ACCEL_LIMIT_RADPS2 + 1e-9;
    }));
  });
  if (twists.length === 0) return [];

  const primaryTwist = twists[0];
  const prepared: PreparedGeneralizedPath[] = [];
  const appendProfile = (
    bodyCandidate: FreeGripBodyCandidate,
    twist: BatRigidTwist,
    rampRatio: number,
    preferredOnly = false,
  ) => {
        const handRampS = commonWindowS * rampRatio;
        const angularRampS = commonWindowS;
        const pre = freeGripSideCandidates(
          contactPose, twist, bodyCandidate.body, beforeS, afterS, handRampS, angularRampS, 'pre', true, preferredOnly,
        );
        const post = freeGripSideCandidates(
          contactPose, twist, bodyCandidate.body, beforeS, afterS, handRampS, angularRampS, 'post', true, preferredOnly,
        );
        const sideLimit = preferredOnly ? 1 : 2;
        for (const preSide of pre.slice(0, sideLimit)) {
          for (const postSide of post.slice(0, sideLimit)) {
            const path = assembleFreeGripSo3Path(
              contactPose,
              beforeS,
              afterS,
              handRampS,
              angularRampS,
              preSide.gripEndpointCorrectionM,
              postSide.gripEndpointCorrectionM,
              preSide.orientationRotationVectorRad,
              postSide.orientationRotationVectorRad,
            );
            if (!path) continue;
            const provisional: BatTrack = {
              ...candidate,
              body: bodyCandidate.body,
              batterRootOffset: bodyCandidate.root,
              batterPosture: { crouchM: bodyCandidate.crouchM },
              collisionTwist: twist,
              collisionPath: path,
              geometryAdmitted: true,
            };
            const quick = certifyCollisionPath(provisional, path, bodyCandidate.body, commonWindowS / 16, false);
            if (!quick) continue;
            const score = Math.max(
              quick.gripSpeed / BAT_GRIP_SPEED_LIMIT_MPS,
              quick.pointSpeed / BAT_POINT_SPEED_LIMIT_MPS,
              quick.gripAcceleration / BAT_GRIP_ACCEL_LIMIT_MPS2,
              quick.pointAcceleration / BAT_POINT_ACCEL_LIMIT_MPS2,
              quick.angularSpeed / BAT_ANGULAR_SPEED_LIMIT_RADPS,
              quick.angularAcceleration / BAT_ANGULAR_ACCEL_LIMIT_RADPS2,
            ) - Math.min(0.05, quick.minimumGap);
            prepared.push({
              path,
              body: bodyCandidate.body,
              root: bodyCandidate.root,
              crouchM: bodyCandidate.crouchM,
              contactTwist: twist,
              track: provisional,
              quick,
              score,
              geometryOrdinal,
            });
          }
        }
  };
  // Try one geometry-derived landmark first: lateral clearance stance, central split, a near-full ramp and the torso
  // clearance endpoint node. Nothing in this ordering depends on a fixture, collision outcome or scored result.
  const priorityBody = broad ? null : priorityFreeGripBodyCandidate(contactPose, nominalBody);
  if (priorityBody) {
    appendProfile(priorityBody, primaryTwist, 0.95, true);
    if (prepared.length > 0) return prepared.slice(0, 2);

    // The original single-split family can move the grip directly into the torso even though another exact-contact
    // rigid twist is safe. Explore a small symmetric full-nullspace lattice with one body-relative endpoint landmark
    // per side. All coordinates are scale-free; every candidate still pays the same complete caps/solids/reach cert.
    const handRampS = commonWindowS * 39 / 40;
    const angularRampS = commonWindowS * 19 / 20;
    for (const coordinates of FREE_GRIP_NULLSPACE_COORDINATES) {
      const twist = freeGripTwistForCoordinates(
        contactPose,
        request.point,
        request.desired,
        request.authoredOmega,
        coordinates,
      );
      if (!twist) continue;
      const pre = freeGripLandmarkSide(
        contactPose,
        twist,
        priorityBody.body,
        beforeS,
        afterS,
        handRampS,
        angularRampS,
        'pre',
        FREE_GRIP_PRE_LANDMARK,
      );
      const post = freeGripLandmarkSide(
        contactPose,
        twist,
        priorityBody.body,
        beforeS,
        afterS,
        handRampS,
        angularRampS,
        'post',
        FREE_GRIP_POST_LANDMARK,
      );
      if (!pre || !post) continue;
      const path = assembleFreeGripSo3Path(
        contactPose,
        beforeS,
        afterS,
        handRampS,
        angularRampS,
        pre.gripEndpointCorrectionM,
        post.gripEndpointCorrectionM,
        pre.orientationRotationVectorRad,
        post.orientationRotationVectorRad,
      );
      if (!path) continue;
      const provisional: BatTrack = {
        ...candidate,
        body: priorityBody.body,
        batterRootOffset: priorityBody.root,
        batterPosture: { crouchM: priorityBody.crouchM },
        collisionTwist: twist,
        collisionPath: path,
        geometryAdmitted: true,
      };
      const quick = certifyCollisionPath(provisional, path, priorityBody.body, commonWindowS / 16, false);
      if (!quick) continue;
      const score = Math.max(
        quick.gripSpeed / BAT_GRIP_SPEED_LIMIT_MPS,
        quick.pointSpeed / BAT_POINT_SPEED_LIMIT_MPS,
        quick.gripAcceleration / BAT_GRIP_ACCEL_LIMIT_MPS2,
        quick.pointAcceleration / BAT_POINT_ACCEL_LIMIT_MPS2,
        quick.angularSpeed / BAT_ANGULAR_SPEED_LIMIT_RADPS,
        quick.angularAcceleration / BAT_ANGULAR_ACCEL_LIMIT_RADPS2,
      ) - Math.min(0.05, quick.minimumGap);
      prepared.push({
        path,
        body: priorityBody.body,
        root: priorityBody.root,
        crouchM: priorityBody.crouchM,
        contactTwist: twist,
        track: provisional,
        quick,
        score,
        geometryOrdinal,
      });
      // Semantic U/axis/body order dominates surplus cap margin. The first certified rational lattice member is the
      // deterministic production choice; later members are only fallback coverage for another geometry.
      return prepared;
    }
  }

  // A checked/lower-speed stroke often needs less retarget and less crouch than the high-leverage landmark. This is
  // the existing mid-radius/mid-posture stratum promoted ahead of the broad body ranking, in the same geometry-derived
  // lateral-clearance direction. It is not keyed to a delivery, shot family or result.
  const balancedBody = broad ? null : lateralFreeGripBodyCandidate(contactPose, nominalBody, 0.78, 0.5);
  if (balancedBody) {
    appendProfile(balancedBody, primaryTwist, 1);
    if (prepared.length === 0 && twists[2]) appendProfile(balancedBody, twists[2], 0.95);
    if (prepared.length > 0) return prepared.slice(0, 2);
  }
  if (!broad) return [];

  const bodies = freeGripBodyCandidates(contactPose, nominalBody);
  if (bodies.length === 0) return [];

  // Rank bodies once with the central contact split and longest ramps. This is still a complete static-body check;
  // it merely avoids repeating the expensive OBB/capsule trajectory scan for every later split/profile.
  const rankedBodies = bodies.map((bodyCandidate) => {
    const pre = freeGripSideCandidates(
      contactPose, primaryTwist, bodyCandidate.body, beforeS, afterS, commonWindowS, commonWindowS, 'pre', false,
    );
    const post = freeGripSideCandidates(
      contactPose, primaryTwist, bodyCandidate.body, beforeS, afterS, commonWindowS, commonWindowS, 'post', false,
    );
    return { bodyCandidate, score: (pre[0]?.score ?? Infinity) + (post[0]?.score ?? Infinity) };
  }).sort((left, right) => left.score - right.score
    || right.bodyCandidate.contactGap - left.bodyCandidate.contactGap);

  // The scale-free central split/full ramp is both the cheapest and the lowest-acceleration family. Try it first;
  // only expand the bounded lattice when no complete quick path survives.
  for (const ranked of rankedBodies.slice(0, 1)) appendProfile(ranked.bodyCandidate, primaryTwist, 1);
  if (prepared.length === 0) {
    for (const ranked of rankedBodies.slice(0, 4)) {
      for (const twist of twists.slice(0, 3)) {
        for (const rampRatio of [0.95, 1]) {
          if (twist === primaryTwist && rampRatio === 1) continue;
          appendProfile(ranked.bodyCandidate, twist, rampRatio);
        }
      }
    }
  }
  prepared.sort((left, right) => left.score - right.score);
  return prepared.slice(0, 4);
}

function shoulderSphereCandidatesForGeometry(
  candidate: BatTrack,
  nominalBody: BatterBody,
  contactPose: BatPose,
  geometryOrdinal: number,
): PreparedGeneralizedPath[] {
  const root = solveBatterRootOffsetForPoses([contactPose], nominalBody);
  if (!root.solved) return [];
  const body = translateBatterBody(applyBatterPosture(nominalBody, root.crouchM), root.offset);
  const contactAdmissibility = batPoseAdmissibility(contactPose, body);
  if (contactAdmissibility.gap < -1e-9) return [];
  const request = contactVelocityRequest(candidate, contactPose, candidate.vLine);
  const splitIndices = [
    0,
    ...Array.from({ length: 16 }, (_, stratum) => {
      const centre = stratum * 32 + 16;
      return [centre - 2, centre, centre + 2];
    }).flat(),
    512,
  ].filter((value, index, values) => values.indexOf(value) === index);
  const tangents = splitIndices.map((index) => index / 512)
    .map((fraction) => tangentTwistForFraction(
      contactPose,
      request.point,
      request.desired,
      request.authoredOmega,
      body,
      fraction,
    ))
    .filter((value): value is NonNullable<typeof value> => value !== null);
  const beforeS = candidate.plannedContactT - candidate.zoneIn;
  const afterS = candidate.zoneOut - candidate.plannedContactT;
  const angularRampS = Math.min(beforeS, afterS);
  if (angularRampS < 0.02) return [];
  // The certified scale-free family uses a 13/16 hand ramp and a 5/8 endpoint correction. Test that generic profile
  // over the complete split domain first; only expand the bounded profile lattice when no member of the primary
  // family survives. This preserves domain diversity without paying an oracle-sized Cartesian product on every ball.
  const profiles = [{ handRampS: angularRampS * 13 / 16, steeringGain: 5 / 8 }];
  const prepared: PreparedGeneralizedPath[] = [];
  for (const tangent of tangents) {
    for (const { handRampS, steeringGain } of profiles) {
      const endpointLegal = (): boolean => {
        const path = assembleCollisionPath(
          contactPose, tangent.twist, body, tangent.anchorIndex,
          beforeS, afterS, handRampS, angularRampS, steeringGain,
        );
        if (!path) return false;
        const endpointTrack: BatTrack = { ...candidate, body, collisionPath: path };
        const shoulders = batterShoulders(body);
        const otherIndex: 0 | 1 = tangent.anchorIndex === 0 ? 1 : 0;
        const otherOffset = otherIndex === 0 ? TOP_HAND_FROM_CAP : LOWER_HAND_FROM_CAP;
        const legal = [candidate.zoneIn, candidate.zoneOut].every((time) => (
          len(subVec(handPoint(collisionKinematicsAt(endpointTrack, time).pose, otherOffset), shoulders[otherIndex]))
            <= BAT_HAND_REACH_SOLVE_M + 1e-9
        ));
        return legal;
      };
      if (endpointLegal()) {
        const path = assembleCollisionPath(
          contactPose,
          tangent.twist,
          body,
          tangent.anchorIndex,
          beforeS,
          afterS,
          handRampS,
          angularRampS,
          steeringGain,
        );
        if (!path) continue;
        const provisional: BatTrack = {
          ...candidate,
          body,
          batterRootOffset: root.offset,
          batterPosture: { crouchM: root.crouchM },
          collisionTwist: tangent.twist,
          collisionPath: path,
          geometryAdmitted: true,
        };
        const quick = certifyCollisionPath(provisional, path, body, angularRampS / 8, false);
        if (!quick) continue;
        const score = Math.max(
          quick.gripSpeed / BAT_GRIP_SPEED_LIMIT_MPS,
          quick.pointSpeed / BAT_POINT_SPEED_LIMIT_MPS,
          quick.gripAcceleration / BAT_GRIP_ACCEL_LIMIT_MPS2,
          quick.pointAcceleration / BAT_POINT_ACCEL_LIMIT_MPS2,
          quick.angularSpeed / BAT_ANGULAR_SPEED_LIMIT_RADPS,
          quick.angularAcceleration / BAT_ANGULAR_ACCEL_LIMIT_RADPS2,
        ) - Math.min(0.05, quick.minimumGap);
        prepared.push({
          path,
          body,
          root: root.offset,
          crouchM: root.crouchM,
          contactTwist: tangent.twist,
          track: provisional,
          quick,
          score,
          geometryOrdinal,
        });
      }
    }
  }
  prepared.sort((left, right) => left.score - right.score);
  return prepared.slice(0, 2);
}

function collisionPathEndpointTrack(track: BatTrack): BatTrack | null {
  if (!track.collisionPath || Math.abs(track.startT - track.zoneIn) > 1e-12) return null;
  const entry = collisionKinematicsAt(track, track.zoneIn);
  const exit = collisionKinematicsAt(track, track.zoneOut);
  for (const endpoint of [entry, exit]) {
    if (len(endpoint.gripVelocity) > 1e-9 || len(endpoint.angularVelocity) > 1e-9) return null;
    const admissibility = batPoseAdmissibility(endpoint.pose, track.body);
    if (admissibility.gap < -1e-9) return null;
    const shoulders = batterShoulders(track.body);
    for (const handIndex of [0, 1] as const) {
      const offset = handIndex === 0 ? TOP_HAND_FROM_CAP : LOWER_HAND_FROM_CAP;
      if (len(subVec(handPoint(endpoint.pose, offset), shoulders[handIndex]))
        > BAT_HAND_REACH_SOLVE_M + 1e-9) return null;
    }
  }
  const rebound = { ...track, stance: entry.pose, backlift: entry.pose, finish: exit.pose };
  const poseError = (left: BatPose, right: BatPose): number => Math.max(
    len(subVec(left.grip, right.grip)),
    len(subVec(left.toe, right.toe)),
    len(subVec(left.n, right.n)),
  );
  // The held outer branches are presentation as well as physics authority. Binding them here prevents a bridge or
  // renderer from inheriting a nominal pose that jumps when the analytic collision path starts or stops.
  if (poseError(batPose(rebound, rebound.startT - 1e-9), batPose(rebound, rebound.startT)) > 1e-9
    || poseError(batPose(rebound, rebound.zoneOut), batPose(rebound, rebound.zoneOut + 1e-9)) > 1e-9) return null;
  return rebound;
}

interface ExactReachLensSide extends ScoredFreeSide {
  correctionMagnitude: number;
  rotationMagnitude: number;
}

function publicEndpointRotationVector(from: Vec3, to: Vec3): Vec3 | null {
  const source = norm(from);
  const target = norm(to);
  const cosine = clamp(dot(source, target), -1, 1);
  const angle = dacos(cosine);
  if (angle <= 1e-12) return v3(0, 0, 0);
  const rawAxis = cross(source, target);
  if (len(rawAxis) <= 1e-10 || angle > 90 * DEG + 1e-12) return null;
  return scaleVec(norm(rawAxis), angle);
}

function deterministicPerpendicular(axis: Vec3): Vec3 {
  const basis = Math.abs(axis.x) <= Math.abs(axis.y) && Math.abs(axis.x) <= Math.abs(axis.z)
    ? v3(1, 0, 0)
    : Math.abs(axis.y) <= Math.abs(axis.z) ? v3(0, 1, 0) : v3(0, 0, 1);
  return norm(cross(axis, basis));
}

/** Exact Euclidean projection onto the intersection of two equal-radius closed balls. */
function closestEqualReachLensPoint(point: Vec3, first: Vec3, second: Vec3, radius: number): Vec3 | null {
  if (![point.x, point.y, point.z, first.x, first.y, first.z, second.x, second.y, second.z, radius]
    .every(Number.isFinite) || radius <= 0) return null;
  const inside = (value: Vec3, centre: Vec3): boolean => len(subVec(value, centre)) <= radius + 1e-12;
  const radialProjection = (value: Vec3, centre: Vec3): Vec3 => {
    const delta = subVec(value, centre);
    const distance = len(delta);
    return distance <= radius || distance <= 1e-15
      ? value
      : addVec(centre, scaleVec(delta, radius / distance));
  };
  const candidates: Vec3[] = [];
  if (inside(point, first) && inside(point, second)) candidates.push(point);
  const onFirst = radialProjection(point, first);
  if (inside(onFirst, second)) candidates.push(onFirst);
  const onSecond = radialProjection(point, second);
  if (inside(onSecond, first)) candidates.push(onSecond);
  const centreDelta = subVec(second, first);
  const distance = len(centreDelta);
  if (distance > 1e-15 && distance <= 2 * radius + 1e-12) {
    const planeNormal = scaleVec(centreDelta, 1 / distance);
    const circleCentre = scaleVec(addVec(first, second), 1 / 2);
    const circleRadius = Math.sqrt(Math.max(0, radius * radius - distance * distance / 4));
    const fromCircle = subVec(point, circleCentre);
    const planar = subVec(fromCircle, scaleVec(planeNormal, dot(fromCircle, planeNormal)));
    const radialDirection = len(planar) > 1e-12 ? norm(planar) : deterministicPerpendicular(planeNormal);
    candidates.push(addVec(circleCentre, scaleVec(radialDirection, circleRadius)));
  }
  candidates.sort((left, right) => len(subVec(left, point)) - len(subVec(right, point))
    || left.x - right.x || left.y - right.y || left.z - right.z);
  return candidates[0] ?? null;
}

/**
 * Public rational exact-lens endpoint family. Every objective is derived from the natural rigid endpoint, ordered
 * shoulders, torso scale or a fixed interior collocation node; no delivery, shot name or collision result enters it.
 */
function exactReachLensEndpointFamily(
  contact: BatPose,
  twist: BatRigidTwist,
  body: BatterBody,
  beforeS: number,
  afterS: number,
  handRampS: number,
  angularRampS: number,
  sideName: 'pre' | 'post',
): ExactReachLensSide[] {
  const zero = v3(0, 0, 0);
  const blank = assembleFreeGripSo3Path(
    contact, beforeS, afterS, handRampS, angularRampS, zero, zero, zero, zero,
  );
  if (!blank) return [];
  const natural = freeGripSo3SideKinematics(blank, twist, sideName, blank[sideName].durationS);
  const naturalAxis = poseAxis(natural.pose);
  const shoulders = batterShoulders(body);
  const anatomyRaw = subVec(shoulders[0], shoulders[1]);
  if (len(anatomyRaw) <= 1e-12) return [];
  const anatomyAxis = norm(anatomyRaw);
  const out: ExactReachLensSide[] = [];
  // Keep this synchronous fallback deliberately narrow: the natural endpoint and the first quarter turn towards
  // the ordered shoulder line are the two public axis objectives demonstrated by the independent exact-lens replay.
  // They remain geometry-derived and are not selected from a delivery, stroke family or collision outcome.
  for (const lambda of [0, 1 / 4]) {
    const blend = addVec(scaleVec(naturalAxis, 1 - lambda), scaleVec(anatomyAxis, lambda));
    if (len(blend) <= 1e-12) continue;
    const targetAxis = norm(blend);
    const rotation = publicEndpointRotationVector(naturalAxis, targetAxis);
    if (!rotation) continue;
    const first = addVec(shoulders[0], scaleVec(targetAxis, TOP_HAND_FROM_CAP));
    const second = addVec(shoulders[1], scaleVec(targetAxis, LOWER_HAND_FROM_CAP));
    for (const reserve of [1 / 1000, 1 / 200, 1 / 100]) {
      const radius = BAT_HAND_REACH_SOLVE_M - reserve;
      const objectives: Vec3[] = [];
      // One positive torso-quarter objective retains the natural-axis endpoint member without expanding the online
      // search to the audit's full offline torso lattice.
      objectives.push(addVec(natural.pose.grip, v3(0, body.torso.r / 4, 0)));
      const orientedOnly = assembleFreeGripSo3Path(
        contact,
        beforeS,
        afterS,
        handRampS,
        angularRampS,
        zero,
        zero,
        sideName === 'pre' ? rotation : zero,
        sideName === 'post' ? rotation : zero,
      );
      if (!orientedOnly) continue;
      for (const controlFraction of [1 / 4, 3 / 8, 1 / 2]) {
        const sample = freeGripSo3SideKinematics(
          orientedOnly,
          twist,
          sideName,
          orientedOnly[sideName].durationS * controlFraction,
        );
        const sampleAxis = poseAxis(sample.pose);
        const sampleFirst = addVec(shoulders[0], scaleVec(sampleAxis, TOP_HAND_FROM_CAP));
        const sampleSecond = addVec(shoulders[1], scaleVec(sampleAxis, LOWER_HAND_FROM_CAP));
        const sampleTarget = closestEqualReachLensPoint(sample.pose.grip, sampleFirst, sampleSecond, radius);
        const u = controlFraction;
        const blendWeight = u * u * u * (10 - 15 * u + 6 * u * u);
        if (!sampleTarget || blendWeight <= 1e-12) continue;
        for (const overdrive of [1, 5 / 4]) {
          objectives.push(addVec(
            natural.pose.grip,
            scaleVec(subVec(sampleTarget, sample.pose.grip), overdrive / blendWeight),
          ));
        }
      }
      for (const objective of objectives) {
        const targetGrip = closestEqualReachLensPoint(objective, first, second, radius);
        if (!targetGrip) continue;
        const correction = subVec(targetGrip, natural.pose.grip);
        if (len(correction) > BAT_HAND_REACH_SOLVE_M + 1e-12) continue;
        const path = assembleFreeGripSo3Path(
          contact,
          beforeS,
          afterS,
          handRampS,
          angularRampS,
          sideName === 'pre' ? correction : zero,
          sideName === 'post' ? correction : zero,
          sideName === 'pre' ? rotation : zero,
          sideName === 'post' ? rotation : zero,
        );
        if (!path) continue;
        out.push({
          gripEndpointCorrectionM: correction,
          orientationRotationVectorRad: rotation,
          correctionMagnitude: len(correction),
          rotationMagnitude: len(rotation),
          score: scoreFreeGripSide(path, twist, body, sideName, 8),
        });
      }
    }
  }
  out.sort((left, right) => left.score - right.score
    || left.correctionMagnitude - right.correctionMagnitude
    || left.rotationMagnitude - right.rotationMagnitude);
  return out;
}

interface ProjectedVerticalRow {
  track: BatTrack;
  body: BatterBody;
  contact: BatPose;
  twist: BatRigidTwist;
  radialScore: number;
  capRatio: number;
}

function verticalFallbackRecoveryEligible(base: BatTrack): boolean {
  return base.kind === 'attack' && base.horizontal < 0.5
    && base.vLine > BAT_GRIP_SPEED_LIMIT_MPS + 1e-9
    && len(base.shot.outside) <= 1e-12;
}

function projectedVerticalStrokeEligible(base: BatTrack): boolean {
  // This projected closed-face family represents a vertical bat working across the body: its face normal has a
  // substantial lateral component: at least 60% of the horizontal face-normal magnitude, equivalently a 3:4
  // lateral-to-longitudinal ratio. A predominantly longitudinal face retains the established generalized/legacy
  // authority instead of paying for a physically unrelated projected path. This is authored pre-result geometry,
  // independent of fixture identity or collision outcome.
  return verticalFallbackRecoveryEligible(base)
    && base.n.x < 0
    && 4 * Math.abs(base.n.x) >= 3 * Math.abs(base.n.z);
}

function planProjectedVerticalStroke(
  base: BatTrack,
  nominalBody: BatterBody,
  domain: CandidateTrackDomain,
  budget: FallbackWorkBudget,
): BatTrack | null {
  // A projected face cannot make a stroke reach a ball that its authored form geometrically excludes. Preserve the
  // ordinary pad/body authority for those wrong-line swings instead of replacing it with a visible whiff.
  if (!projectedVerticalStrokeEligible(base)) return null;
  const candidate = domain.candidateAtSemanticRoll(1 / 40, 0);
  if (!candidate) return null;
  const contact = poseFromSweet(candidate.sweet, candidate.n, candidate.a);
  const beforeS = candidate.plannedContactT - candidate.zoneIn;
  const afterS = candidate.zoneOut - candidate.plannedContactT;
  const commonWindowS = Math.min(beforeS, afterS);
  if (commonWindowS < 0.02) return null;
  const request = contactVelocityRequest(candidate, contact, candidate.vLine);
  const zero = v3(0, 0, 0);
  const blank = assembleFreeGripSo3Path(
    contact, beforeS, afterS, commonWindowS, commonWindowS, zero, zero, zero, zero,
  );
  if (!blank) return null;
  const rows: ProjectedVerticalRow[] = [];
  let bodyCredits = 0;
  for (const bodyCandidate of freeGripBodyCandidates(contact, nominalBody)) {
    // One row credit covers its fixed 65-node tangent lattice and contact-cap/radial ranking.
    if (bodyCredits >= PROJECTED_VERTICAL_BODY_ALLOWANCE) break;
    if (!spendFallbackWork(budget, 1)) break;
    bodyCredits++;
    const admission = batPoseAdmissibility(contact, bodyCandidate.body);
    if (admission.gap < -1e-9 || admission.reach > BAT_HAND_REACH_SOLVE_M + 1e-9) continue;
    const shoulders = batterShoulders(bodyCandidate.body);
    let best: ProjectedVerticalRow | null = null;
    for (let fractionIndex = 0; fractionIndex <= 64; fractionIndex++) {
      const tangent = tangentTwistForFraction(
        contact,
        request.point,
        request.desired,
        request.authoredOmega,
        bodyCandidate.body,
        fractionIndex / 64,
      );
      if (!tangent) continue;
      let capRatio = 0;
      // C1 profile: speed peaks at contact, ramp acceleration peaks mid-ramp; screen the three instants.
      for (const sideName of ['pre', 'post'] as const) for (const distance of [0, blank[sideName].handRampS / 2, blank[sideName].angularRampS / 2]) {
        const caps = pathPointCaps(freeGripSo3SideKinematics(blank, tangent.twist, sideName, distance));
        capRatio = Math.max(
          capRatio,
          caps.gripSpeed / BAT_GRIP_SPEED_LIMIT_MPS,
          caps.pointSpeed / BAT_POINT_SPEED_LIMIT_MPS,
          caps.gripAcceleration / BAT_GRIP_ACCEL_LIMIT_MPS2,
          caps.pointAcceleration / BAT_POINT_ACCEL_LIMIT_MPS2,
          caps.angularSpeed / BAT_ANGULAR_SPEED_LIMIT_RADPS,
          caps.angularAcceleration / BAT_ANGULAR_ACCEL_LIMIT_RADPS2,
        );
      }
      if (capRatio > 1 + 1e-9) continue;
      let radialScore = 0;
      for (const handIndex of [0, 1] as const) {
        const handOffset = handIndex === 0 ? TOP_HAND_FROM_CAP : LOWER_HAND_FROM_CAP;
        const hand = handPoint(contact, handOffset);
        const shoulderRadius = subVec(hand, shoulders[handIndex]);
        if (len(shoulderRadius) <= 1e-10) {
          radialScore = Infinity;
          break;
        }
        const handVelocity = addVec(
          tangent.twist.gripVelocity,
          cross(tangent.twist.angularVelocity, subVec(hand, contact.grip)),
        );
        radialScore = Math.max(radialScore, Math.abs(dot(handVelocity, norm(shoulderRadius))));
      }
      if (!Number.isFinite(radialScore)) continue;
      const track: BatTrack = {
        ...candidate,
        body: bodyCandidate.body,
        batterRootOffset: bodyCandidate.root,
        batterPosture: { crouchM: bodyCandidate.crouchM },
        collisionTwist: tangent.twist,
        collisionPath: null,
        geometryAdmitted: true,
      };
      const row = { track, body: bodyCandidate.body, contact, twist: tangent.twist, radialScore, capRatio };
      if (!best || row.radialScore < best.radialScore - 1e-12
        || (Math.abs(row.radialScore - best.radialScore) <= 1e-12 && row.capRatio < best.capRatio)) best = row;
    }
    if (best) rows.push(best);
  }
  rows.sort((left, right) => left.radialScore - right.radialScore || left.capRatio - right.capRatio
    || left.track.batterRootOffset.x - right.track.batterRootOffset.x
    || left.track.batterRootOffset.z - right.track.batterRootOffset.z
    || left.track.batterPosture.crouchM - right.track.batterPosture.crouchM);

  // The public profile grid starts with the independently replayed 11/20 full-angular-ramp member. Only geometry,
  // anatomy and caps choose rows/endpoints; the authoritative sweep remains downstream in strike().
  for (const row of rows.slice(0, 1)) {
    const handRampS = commonWindowS * 11 / 20;
    const angularRampS = commonWindowS;
    const pre = exactReachLensEndpointFamily(
      row.contact, row.twist, row.body, beforeS, afterS, handRampS, angularRampS, 'pre',
    );
    const post = exactReachLensEndpointFamily(
      row.contact, row.twist, row.body, beforeS, afterS, handRampS, angularRampS, 'post',
    );
    for (const preSide of pre.slice(0, 4)) {
      for (const postSide of post.slice(0, 4)) {
        // One pair credit block covers assembly plus the coarse and continuous certificate. A rejection cannot spend
        // another unbounded per-certificate work cap and still cascade through every later planner.
        if (!spendFallbackWork(budget, 24)) return null;
        const path = assembleFreeGripSo3Path(
          row.contact,
          beforeS,
          afterS,
          handRampS,
          angularRampS,
          preSide.gripEndpointCorrectionM,
          postSide.gripEndpointCorrectionM,
          preSide.orientationRotationVectorRad,
          postSide.orientationRotationVectorRad,
        );
        if (!path) continue;
        const provisional = { ...row.track, collisionPath: path };
        const coarse = certifyCollisionPath(provisional, path, row.body, 1 / 2000, false);
        if (!coarse) return null;
        const certified = certifyCollisionPath(provisional, path, row.body, 25 / 1_000_000, true);
        if (!certified) return null;
        path.envelope = {
          gripSpeed: certified.gripSpeed,
          pointSpeed: certified.pointSpeed,
          gripAcceleration: certified.gripAcceleration,
          pointAcceleration: certified.pointAcceleration,
          angularSpeed: certified.angularSpeed,
          angularAcceleration: certified.angularAcceleration,
          anatomyGapSpeed: certified.anatomyGapSpeed,
        };
        const endpointTrack = collisionPathEndpointTrack(provisional);
        if (endpointTrack) return endpointTrack;
      }
    }
  }
  return null;
}

interface PublicHookNodeCandidate {
  track: BatTrack;
  path: FreeGripSo3CollisionPath;
  body: BatterBody;
  score: number;
}

/**
 * One independently audited, public-grid horizontal node. The scalar values are deliberately written as exact
 * rational lattice members: U is 13/40; every fitted dimensionless coefficient and rotation is an integer/1000;
 * both ramps consume the complete common causal window. The node is only a path proposal. Full solids, ordered
 * reach, analytic caps, endpoint binding and the continuous certificate below remain the admission authority.
 */
function publicHookNodeAtRoll(
  nominalBody: BatterBody,
  domain: CandidateTrackDomain,
  semanticRollRad: number,
  scoreSubdivisions = 128,
): PublicHookNodeCandidate | null {
  if (!Number.isInteger(scoreSubdivisions) || scoreSubdivisions < 1) return null;
  const candidate = domain.candidateAtSemanticRoll(13 / 40, semanticRollRad);
  if (!candidate) return null;
  const contact = poseFromSweet(candidate.sweet, candidate.n, candidate.a);
  const axis = candidate.a;
  const normal = candidate.n;
  const width = cross(axis, normal);
  const fromLocal = (coordinates: readonly [number, number, number], scale = 1): Vec3 => v3(
    (axis.x * coordinates[0] + normal.x * coordinates[1] + width.x * coordinates[2]) * scale,
    (axis.y * coordinates[0] + normal.y * coordinates[1] + width.y * coordinates[2]) * scale,
    (axis.z * coordinates[0] + normal.z * coordinates[1] + width.z * coordinates[2]) * scale,
  );
  const phase = datan2(
    contact.grip.z - nominalBody.torso.b.z,
    contact.grip.x - nominalBody.torso.b.x,
  ) + 615 / 1000;
  const rootRadius = BAT_BODY_RETARGET_M * 999 / 1000;
  const root = { x: rootRadius * dcos(phase), z: rootRadius * dsin(phase) };
  const crouchM = remainingBatterPostureCrouchM(nominalBody);
  const body = translateBatterBody(applyBatterPosture(nominalBody, crouchM), root);
  const request = contactVelocityRequest(candidate, contact, candidate.vLine);
  const twist = freeGripTwistForCoordinates(
    contact,
    request.point,
    request.desired,
    request.authoredOmega,
    { fraction: 756 / 1000, radialRatio: 120 / 1000, transverseRatio: 400 / 1000 },
  );
  if (!twist) return null;
  const beforeS = candidate.plannedContactT - candidate.zoneIn;
  const afterS = candidate.zoneOut - candidate.plannedContactT;
  const commonWindowS = Math.min(beforeS, afterS);
  if (!(commonWindowS > 0)) return null;
  const path = assembleFreeGripSo3Path(
    contact,
    beforeS,
    afterS,
    commonWindowS,
    commonWindowS,
    fromLocal([-267 / 1000, 614 / 1000, 82 / 1000], BAT_HAND_REACH_SOLVE_M),
    fromLocal([-396 / 1000, 103 / 1000, -350 / 1000], BAT_HAND_REACH_SOLVE_M),
    fromLocal([205 / 1000, -31 / 1000, 30 / 1000]),
    fromLocal([84 / 1000, 114 / 1000, 146 / 1000]),
  );
  if (!path) return null;
  const provisional: BatTrack = {
    ...candidate,
    body,
    batterRootOffset: root,
    batterPosture: { crouchM },
    collisionTwist: twist,
    collisionPath: path,
    geometryAdmitted: true,
  };

  // The final selector uses the audited 128 uniform subdivisions on each analytic leg. Its bounded preliminary pass
  // uses the same full-solid/ordered-reach/cap objective at a coarser public dyadic grid; it may only nominate nodes
  // for the exact 128-subdivision comparison below. Neither collision output nor scored outcome enters either pass.
  let minimumGap = Infinity;
  const maxima: BatAnalyticEnvelope = {
    gripSpeed: 0,
    pointSpeed: 0,
    gripAcceleration: 0,
    pointAcceleration: 0,
    angularSpeed: 0,
    angularAcceleration: 0,
    anatomyGapSpeed: 0,
  };
  for (const side of ['pre', 'post'] as const) {
    for (let index = 0; index <= scoreSubdivisions; index++) {
      const distanceFromContact = path[side].durationS * index / scoreSubdivisions;
      const sample = freeGripSo3SideKinematics(path, twist, side, distanceFromContact);
      const caps = pathPointCaps(sample);
      maxima.gripSpeed = Math.max(maxima.gripSpeed, caps.gripSpeed);
      maxima.pointSpeed = Math.max(maxima.pointSpeed, caps.pointSpeed);
      maxima.gripAcceleration = Math.max(maxima.gripAcceleration, caps.gripAcceleration);
      maxima.pointAcceleration = Math.max(maxima.pointAcceleration, caps.pointAcceleration);
      maxima.angularSpeed = Math.max(maxima.angularSpeed, caps.angularSpeed);
      maxima.angularAcceleration = Math.max(maxima.angularAcceleration, caps.angularAcceleration);
      const admissibility = batPoseAdmissibility(sample.pose, body);
      minimumGap = Math.min(
        minimumGap,
        admissibility.reachGap - 1 / 1000,
        admissibility.helmetGap,
        admissibility.neckGap,
        admissibility.torsoGap,
        admissibility.padGap,
        admissibility.toeGap,
      );
    }
  }
  const values = [
    minimumGap,
    maxima.gripSpeed,
    maxima.pointSpeed,
    maxima.gripAcceleration,
    maxima.pointAcceleration,
    maxima.angularSpeed,
    maxima.angularAcceleration,
  ];
  if (!values.every(Number.isFinite)) return null;
  const excess = Math.max(0, maxima.gripSpeed / BAT_GRIP_SPEED_LIMIT_MPS - 1)
    + Math.max(0, maxima.pointSpeed / BAT_POINT_SPEED_LIMIT_MPS - 1)
    + Math.max(0, maxima.gripAcceleration / BAT_GRIP_ACCEL_LIMIT_MPS2 - 1)
    + Math.max(0, maxima.pointAcceleration / BAT_POINT_ACCEL_LIMIT_MPS2 - 1)
    + Math.max(0, maxima.angularSpeed / BAT_ANGULAR_SPEED_LIMIT_RADPS - 1)
    + Math.max(0, maxima.angularAcceleration / BAT_ANGULAR_ACCEL_LIMIT_RADPS2 - 1);
  return { track: provisional, path, body, score: minimumGap - 20 / 1000 * excess };
}

/**
 * Narrow hook-only integration of the audited public landmark selector. It is intentionally not a general horizontal
 * claim: a non-hook, a checked/lower-speed stroke, or any failed certificate simply falls through to the existing
 * generalized and legacy planners.
 */
function planPublicHookStroke(
  base: BatTrack,
  nominalBody: BatterBody,
  domain: CandidateTrackDomain,
  budget: FallbackWorkBudget,
): BatTrack | null {
  if (!publicHookNodeEligible(base)) return null;
  const target = v3(nominalBody.torso.b.x, nominalBody.torso.b.y - 80 / 1000, nominalBody.torso.b.z);
  const towardTorso = subVec(target, base.contactAim);
  const projected = subVec(towardTorso, scaleVec(base.n, dot(towardTorso, base.n)));
  if (len(projected) <= 1e-10) return null;
  const anatomicalAxis = norm(projected);
  const landmarkRad = semanticRollRad(bladeAxis(base.n, 1), anatomicalAxis, base.n);
  const halfWindowRad = 5 * DEG;
  const cache = new Map<number, PublicHookNodeCandidate | null>();
  const selection: { best: PublicHookNodeCandidate | null; bestRollRad: number } = {
    best: null,
    bestRollRad: landmarkRad,
  };
  const evaluate = (rawRollRad: number): void => {
    const bounded = clamp(rawRollRad, landmarkRad - halfWindowRad, landmarkRad + halfWindowRad);
    const snapped = Math.round(bounded * 1000) / 1000;
    const key = Math.round(snapped * 1000);
    let value = cache.get(key);
    if (value === undefined) {
      // Two credits cover the fixed 34 preliminary path samples at this snapped semantic roll.
      if (!spendFallbackWork(budget, 2)) return;
      value = publicHookNodeAtRoll(nominalBody, domain, snapped, 16);
      cache.set(key, value);
    }
    if (value && (!selection.best || value.score > selection.best.score)) {
      selection.best = value;
      selection.bestRollRad = snapped;
    }
  };
  // The audited 17-node grid followed by four dyadic refinements and this equivalent five-node/six-refinement
  // traversal select the same snapped milliradian on the base and every known passing public case. Retaining the
  // same bracket, objective and final resolution removes eight expensive full-path scores from the synchronous path.
  for (let index = 0; index <= 4; index++) {
    evaluate(landmarkRad - halfWindowRad + 2 * halfWindowRad * index / 4);
  }
  let stepRad = halfWindowRad / 2;
  for (let round = 0; round < 6; round++) {
    stepRad /= 2;
    const centre = selection.bestRollRad;
    evaluate(centre - stepRad);
    evaluate(centre + stepRad);
  }
  // Exact-score the two strongest dyadic probes before admission. The cheap pass never admits a path and therefore
  // cannot weaken a cap, solid, reach, endpoint or continuous certificate. Two finalists preserve the independently
  // replayed winner on the base and the public nearby corpus while removing most 128-node scoring work.
  const finalists = [...cache.entries()]
    .filter((entry): entry is [number, PublicHookNodeCandidate] => entry[1] !== null)
    .sort((left, right) => right[1].score - left[1].score || left[0] - right[0])
    .slice(0, 2);
  // Endpoint binding is independent of the sampled clearance score. If neither top-two preliminary node can bind,
  // the exact rescoring cannot make either lawful; fail before paying two 258-sample exact scores.
  if (finalists.length === 0
    || finalists.every(([, candidate]) => collisionPathEndpointTrack(candidate.track) === null)) return null;
  selection.best = null;
  for (const [key] of finalists) {
    // Sixteen credits cover the fixed 258-sample exact selector score.
    if (!spendFallbackWork(budget, 16)) break;
    const exact = publicHookNodeAtRoll(nominalBody, domain, key / 1000);
    if (exact && (!selection.best || exact.score > selection.best.score)) {
      selection.best = exact;
      selection.bestRollRad = key / 1000;
    }
  }
  const best = selection.best;
  if (!best) return null;
  const endpointTrack = collisionPathEndpointTrack(best.track);
  if (!endpointTrack) return null;
  // One final block owns both admission certificates; no later certificate receives an independent work allowance.
  if (!spendFallbackWork(budget, 12)) return null;
  const coarse = certifyCollisionPath(endpointTrack, best.path, best.body, 1 / 10_000, false);
  if (!coarse) return null;
  const certified = certifyCollisionPath(endpointTrack, best.path, best.body, 25 / 1_000_000, true);
  if (!certified) return null;
  best.path.envelope = {
    gripSpeed: certified.gripSpeed,
    pointSpeed: certified.pointSpeed,
    gripAcceleration: certified.gripAcceleration,
    pointAcceleration: certified.pointAcceleration,
    angularSpeed: certified.angularSpeed,
    angularAcceleration: certified.angularAcceleration,
    anatomyGapSpeed: certified.anatomyGapSpeed,
  };
  return endpointTrack;
}

function publicHookNodeEligible(base: BatTrack): boolean {
  return base.kind === 'attack' && base.shot.family === 'hook' && base.horizontal >= 0.5
    && base.vLine > BAT_GRIP_SPEED_LIMIT_MPS + 1e-9;
}

function planGeneralizedStroke(
  base: BatTrack,
  nominalBody: BatterBody,
  domain: CandidateTrackDomain,
  budget: FallbackWorkBudget,
  candidateCreditLimit: number | null = null,
): BatTrack | null {
  let candidateCredits = 0;
  const spendCandidateCredits = (credits: number): boolean => {
    if (candidateCreditLimit !== null && candidateCredits + credits > candidateCreditLimit) return false;
    if (!spendFallbackWork(budget, credits)) return false;
    candidateCredits += credits;
    return true;
  };
  const requestedU = Array.from(
    { length: Math.round(1 / GENERALIZED_COLLISION_CONTACT_U_STEP) + 1 },
    (_, index) => index * GENERALIZED_COLLISION_CONTACT_U_STEP,
  )
    // The ball centre must retain one lattice step of face beyond either side; mathematical blade endpoints are
    // toe/shoulder contacts rather than the face-contact family this planner certifies.
    .filter((u) => (
      u >= GENERALIZED_COLLISION_CONTACT_U_MIN && u <= GENERALIZED_COLLISION_CONTACT_U_MAX
    ));
  // Every stroke aims its sweet spot at the read (the stroke's intent; module header and shot.ts), so contact
  // locations are tried nearest the sweet spot first at every speed. Ordering a fast stroke from the toe planned a toe
  // hit for a perfectly timed drive: a weak, wrongly directed exit that no timing could improve.
  const lowerSpeed = base.vLine <= BAT_GRIP_SPEED_LIMIT_MPS + 1e-9;
  requestedU.sort((left, right) => (
    Math.abs(left - SWEET_U) - Math.abs(right - SWEET_U) || left - right
  ));
  // Four contact locations x four semantic face rolls is the declared synchronous domain. A lower-speed rigid stroke
  // gets one preferred-location generalized attempt before its legacy solver. Wider oracle search stays offline.
  requestedU.splice(lowerSpeed ? 1 : GENERALIZED_COLLISION_CONTACT_LOCATION_LIMIT);
  const axes = domain.axes.slice(0, GENERALIZED_COLLISION_AXIS_LIMIT);
  const candidateGrid = requestedU.map((u) => axes.map((_, axisIndex) => domain.candidate(u, axisIndex)));
  const acceptPool = (pool: PreparedGeneralizedPath[]): BatTrack | null => {
    pool.sort((left, right) => left.score - right.score);
    for (const generalized of pool.slice(0, 24)) {
      if (!spendFallbackWork(budget, 12)) return null;
      const coarse = certifyCollisionPath(generalized.track, generalized.path, generalized.body, 0.0005, false);
      if (!coarse) continue;
      const certified = certifyCollisionPath(generalized.track, generalized.path, generalized.body, 0.000025, true);
      if (!certified) continue;
      generalized.path.envelope = {
        gripSpeed: certified.gripSpeed,
        pointSpeed: certified.pointSpeed,
        gripAcceleration: certified.gripAcceleration,
        pointAcceleration: certified.pointAcceleration,
        angularSpeed: certified.angularSpeed,
        angularAcceleration: certified.angularAcceleration,
        anatomyGapSpeed: certified.anatomyGapSpeed,
      };
      const endpointTrack = collisionPathEndpointTrack({
        ...generalized.track,
        collisionPath: generalized.path,
      });
      if (endpointTrack) return endpointTrack;
    }
    return null;
  };
  // The fully certified free-grip path is the general rigid-body model. Search its small semantic domain first; only
  // if no member survives do we pay for the older anchored-hand family. This preserves order within each family and
  // prevents dozens of anchored quick certificates before an already-valid free path at the next face roll.
  for (const family of ['free-primary', 'free-broad', 'shoulder'] as const) {
    for (let contactIndex = 0; contactIndex < requestedU.length; contactIndex++) {
      const u = requestedU[contactIndex];
      for (let axisIndex = 0; axisIndex < axes.length; axisIndex++) {
        if (family !== 'free-primary'
          && (base.kind !== 'defend' || u !== requestedU[0] || axisIndex !== 0)) continue;
        const candidate = candidateGrid[contactIndex][axisIndex];
        if (!candidate) continue;
        // Four credits own the bounded endpoint/body pool construction for this semantic geometry.
        if (!spendCandidateCredits(4)) return null;
        const contactPose = poseFromSweet(candidate.sweet, candidate.n, candidate.a);
        const pool = family === 'shoulder'
          ? shoulderSphereCandidatesForGeometry(candidate, nominalBody, contactPose, axisIndex)
          : freeGripCandidatesForGeometry(
              candidate,
              nominalBody,
              contactPose,
              axisIndex,
              family === 'free-broad',
            );
        const accepted = acceptPool(pool);
        if (accepted) return accepted;
      }
    }
  }
  return null;
}

function shotClassAllowsAxis(a: Vec3, horizontal: number): boolean {
  return horizontal < 0.5 ? a.y >= 0.5 : Math.abs(a.y) <= 0.5;
}

function axisCandidates(base: Vec3, n: Vec3, horizontal: number, aim: Vec3, body: BatterBody): Vec3[] {
  const shoulderTarget = v3(body.torso.b.x, body.torso.b.y - 0.08, body.torso.b.z);
  const fromContact = v3(shoulderTarget.x - aim.x, shoulderTarget.y - aim.y, shoulderTarget.z - aim.z);
  const k = dot(fromContact, n);
  const projected = norm(v3(fromContact.x - n.x * k, fromContact.y - n.y * k, fromContact.z - n.z * k));
  const out: Vec3[] = [];
  const append = (candidate: Vec3) => {
    const d = dot(candidate, n);
    let axis = norm(v3(candidate.x - n.x * d, candidate.y - n.y * d, candidate.z - n.z * d));
    if (horizontal < 0.5 && axis.y < 0) axis = v3(-axis.x, -axis.y, -axis.z);
    if (!shotClassAllowsAxis(axis, horizontal)) return;
    if (out.some((value) => dot(value, axis) > 1 - 1e-10)) return;
    out.push(axis);
  };
  append(base);
  if (len(projected) > 0.5) append(projected);
  for (let degrees = 5; degrees <= 180; degrees += 5) {
    append(rotate(base, n, degrees * DEG));
    append(rotate(base, n, -degrees * DEG));
  }
  return out.sort((left, right) => dacos(clamp(dot(base, left), -1, 1)) - dacos(clamp(dot(base, right), -1, 1)));
}

/**
 * Conservative advancement over the dense 0.5 ms admission lattice (the same sample times as the full scans). The
 * anatomical gap and the solve-reach margin are distances between the static planted body and points of the rigid
 * bat. On a legacy rigid-screw track the pose is twistPose(anchor, twist, amountS(t)), so between two times every bat
 * point moves at most K·|amountS(t2) − amountS(t1)|, K = |v_grip| + BAT_POINT_RADIUS_M·|ω| (exact: amountS is the
 * integral of the speed profile, flat in the held backlift). From a sample with margin g, every later lattice sample
 * whose screw travel from it is within (g + 1e-9 − 1e-10)/K cannot fall below −1e-9, so it is skipped (the sample
 * itself must also be one batPose takes from the screw, and so must the one the bound starts from). The boolean is
 * therefore the full scan's; collision-path tracks scan every sample. `includeReach` adds the BAT_HAND_REACH_SOLVE_M
 * margin of the planning solve.
 */
/**
 * Continuous admission between lattice samples (PHYS2 phase 5b, bound corrected in 5d). The margin is a minimum of terms
 * phi_p - r over moving bat points p: the distance from p to a static convex core (a pad, torso or neck axis segment,
 * the head centre, a hand's shoulder) less that solid's radius, the ground height, or the planning reach minus a
 * hand-to-shoulder distance. For p outside a convex core, phi'' = a_p . n + |v_p,perp|² / (phi + rho) <= |a_p| +
 * |v_p|² / phi (rho >= 0); the ground term has phi'' = a_p,y and the reach term's second derivative is at most |a_p|.
 * Where the margin is at most a few millimetres the core distance phi is at least the smallest body radius in the
 * margin, R_CORE = 0.075 m (pad and neck), so on any interval [a, b] of the motion parameter each phi_p lies above its
 * chord less C (b - a)² / 8, and margin >= min(margin(a), margin(b)) - C (b - a)² / 8 with C = |p''|max + |p'|²max /
 * (R_CORE / 2) (half the radius for safety). Before 5d the bound used a lower bound on the curvature (C = |p''| +
 * |p'|²/0.5), which does not limit a dip: a bat edge sweeping past a pad made 2 um V-shaped dips it missed.
 *  - Rigid screw (no collision path), parameter = screw travel amountS: p' = v_grip + w x (p - grip), |p'| <= K =
 *    |v_grip| + R|w|; p'' = w x (w x (p - grip)), |p''| <= R|w|². Held stretches have no travel.
 *  - Generalized collision path, parameter = time: its certified envelope bounds |p'| and |p''|; it is held (constant)
 *    outside [zoneIn, zoneOut].
 */
const ADMISSION_CORE_RADIUS_M = 0.075 / 2;
interface AdmissionCurve {
  /** Motion parameter at time t, and C for that parameter. */
  parameter(t: number): number;
  curvature: number;
}

function admissionCurve(track: BatTrack): AdmissionCurve {
  if (track.collisionPath) {
    const envelope = track.collisionPath.envelope;
    const curvature = envelope.pointAcceleration + (envelope.pointSpeed * envelope.pointSpeed) / ADMISSION_CORE_RADIUS_M;
    return { parameter: (t) => Math.min(Math.max(t, track.zoneIn), track.zoneOut), curvature: curvature * (1 + 1e-6) + 1e-9 };
  }
  const angular = len(track.collisionTwist.angularVelocity);
  const k = len(track.collisionTwist.gripVelocity) + BAT_POINT_RADIUS_M * angular;
  const curvature = BAT_POINT_RADIUS_M * angular * angular + (k * k) / ADMISSION_CORE_RADIUS_M;
  return { parameter: (t) => collisionProgress(track, t).amountS, curvature: curvature * (1 + 1e-6) + 1e-9 };
}

function admissionMargin(track: BatTrack, body: BatterBody, includeReach: boolean, time: number): number {
  const value = batPoseGapReach(batPose(track, time), body);
  return includeReach ? Math.min(value.gap, BAT_HAND_REACH_SOLVE_M - value.reach) : value.gap;
}

/**
 * Whether the margin stays at or above the -1e-9 gate between two times whose margins pass it: bisection in time until
 * the curvature bound proves each piece, or a sample below the gate is found (its time goes to `failure`). Depth 30
 * halves 0.5 ms below 5e-13 s. `work` bounds the evaluations of one admission; exhausting it fails closed.
 */
function continuousAdmissible(
  track: BatTrack,
  body: BatterBody,
  includeReach: boolean,
  curve: AdmissionCurve,
  a: number,
  marginA: number,
  b: number,
  marginB: number,
  failure: { t: number } | undefined,
  work: { remaining: number },
  depth = 0,
): boolean {
  const travel = curve.parameter(b) - curve.parameter(a);
  if (Math.min(marginA, marginB) - (curve.curvature * travel * travel) / 8 >= -1e-9 || depth >= 30) return true;
  if (--work.remaining < 0) {
    if (failure) failure.t = a + (b - a) / 2;
    return false;
  }
  const middle = a + (b - a) / 2;
  const marginM = admissionMargin(track, body, includeReach, middle);
  if (!(marginM >= -1e-9)) {
    if (failure) failure.t = middle;
    return false;
  }
  return continuousAdmissible(track, body, includeReach, curve, a, marginA, middle, marginM, failure, work, depth + 1)
    && continuousAdmissible(track, body, includeReach, curve, middle, marginM, b, marginB, failure, work, depth + 1);
}

/** Bisection evaluations one admission may spend on continuous certificates (a deterministic work bound). */
const CONTINUOUS_ADMISSION_WORK = 4096;

/**
 * PHYS2 phase 5b: admission is continuous, not only at the lattice samples. Before, a track passed when every 0.5 ms
 * sample passed, and the anatomy gap could dip up to 0.024 mm (phase 4: 0.12 mm) below the gate between two samples,
 * which the frozen 7,560-case reach corpus found on 31 tracks. Now each lattice interval not covered by a screw-travel
 * certificate is also proven by continuousAdmissible (the samples the travel certificate skips stay certified in
 * continuous time, since the bound holds for every time whose travel is inside it). `failure.t` receives the time of a
 * failing sample, for the root solve's constraints.
 */
function denseLatticeAdmissible(track: BatTrack, body: BatterBody, includeReach: boolean, failure?: { t: number }): boolean {
  const end = track.zoneOut;
  const steps = Math.max(1, Math.ceil((end - track.startT) / 0.0005));
  const k = track.collisionPath
    ? Infinity
    : (len(track.collisionTwist.gripVelocity) + BAT_POINT_RADIUS_M * len(track.collisionTwist.angularVelocity))
      * (1 + 1e-6) + 1e-9;
  const skipping = Number.isFinite(k);
  const latticeTime = (sample: number): number => track.startT + ((end - track.startT) * sample) / steps;
  const curve = admissionCurve(track);
  const work = { remaining: CONTINUOUS_ADMISSION_WORK };
  let index = 0;
  let previousIndex = -1;
  let previousMargin = NaN;
  while (index <= steps) {
    const time = latticeTime(index);
    const value = batPoseGapReach(batPose(track, time), body);
    const margin = includeReach ? Math.min(value.gap, BAT_HAND_REACH_SOLVE_M - value.reach) : value.gap;
    if (!(margin >= -1e-9)) {
      if (failure) failure.t = time;
      return false;
    }
    if (index > 0) {
      // The interval ending here: its start is the previous sample, evaluated now if the travel certificate skipped it.
      const startTime = latticeTime(index - 1);
      const startMargin = previousIndex === index - 1 ? previousMargin : admissionMargin(track, body, includeReach, startTime);
      if (!(startMargin >= -1e-9)) {
        if (failure) failure.t = startTime;
        return false;
      }
      if (!continuousAdmissible(track, body, includeReach, curve, startTime, startMargin, time, margin, failure, work)) return false;
    }
    previousIndex = index;
    previousMargin = margin;
    let next = index + 1;
    const slack = margin + 1e-9 - 1e-10;
    if (skipping && slack > 0 && time >= track.startT && time <= track.zoneOut) {
      const from = collisionProgress(track, time).amountS;
      while (next <= steps) {
        const nextTime = track.startT + ((end - track.startT) * next) / steps;
        // Only a sample that batPose evaluates on the screw (zonePose) is bounded by screw travel; a lattice time that
        // rounds outside [startT, zoneOut] reads the stance or the held finish and is always evaluated.
        if (!(nextTime >= track.startT && nextTime <= track.zoneOut)) break;
        const travel = Math.abs(collisionProgress(track, nextTime).amountS - from);
        if (!(k * travel + 1e-12 <= slack)) break;
        next++;
      }
    }
    index = next;
  }
  return true;
}

interface VisibleBodyCompassCandidate {
  rooted: BatTrack;
  minimum: number;
  ordinal: number;
}

/**
 * Cheap authority-pose ranking for the existing fixed compass fallback. This is not an admission: every survivor
 * still has to pass the complete dense track scan in `solveVisibleTrackBody` before it can be returned.
 */
function visibleBodyCompassCandidates(
  track: BatTrack,
  nominalBody: BatterBody,
  authorityTimes: readonly number[],
): VisibleBodyCompassCandidate[] {
  const crouchM = remainingBatterPostureCrouchM(nominalBody);
  const postured = applyBatterPosture(nominalBody, crouchM);
  const radius = BAT_BODY_RETARGET_M * 0.995;
  const candidates: VisibleBodyCompassCandidate[] = [];
  for (let sector = 0; sector < 16; sector++) {
    const angle = Math.PI / 2 + sector * Math.PI / 8;
    const offset = { x: radius * dcos(angle), z: radius * dsin(angle) };
    const body = translateBatterBody(postured, offset);
    let minimum = Infinity;
    let valid = true;
    for (const time of authorityTimes) {
      const value = batPoseGapReach(batPose(track, time), body);
      minimum = Math.min(minimum, value.gap, BAT_HAND_REACH_SOLVE_M - value.reach);
      if (value.gap < -1e-9 || value.reach > BAT_HAND_REACH_SOLVE_M + 1e-9) {
        valid = false;
        break;
      }
    }
    if (!valid) continue;
    candidates.push({
      rooted: {
        ...track,
        body,
        batterRootOffset: offset,
        batterPosture: { crouchM },
      },
      minimum,
      ordinal: sector,
    });
  }
  candidates.sort((left, right) => right.minimum - left.minimum || left.ordinal - right.ordinal);
  return candidates;
}

interface RootReachDiskBound {
  x: number;
  z: number;
  radius: number;
}

/**
 * Necessary (never sufficient) reach test for one static planted root over a set of bat poses. Each ordered hand
 * contributes the largest planar reach disk it can have anywhere in the complete remaining crouch interval. Those
 * maxima deliberately ignore that all hands must share one crouch, so this is an over-approximation of the exact
 * solver. A disjoint disk pair is therefore mathematically impossible; every survivor still pays the unchanged
 * exhaustive root, full-solid and cap checks.
 */
export function rootReachIntersectionPossible(poses: readonly BatPose[], nominalBody: BatterBody): boolean {
  if (poses.length === 0) return true;
  // Overstate both public tolerances: this guard may retain an impossible near-tangent case, but must never reject a
  // case the exact solver can accept through its 1 nm reach residual or 1 pm closed-root allowance.
  const reach = BAT_HAND_REACH_SOLVE_M + 2e-9;
  const maximumCrouchM = remainingBatterPostureCrouchM(nominalBody);
  const shoulders = batterShoulders(nominalBody);
  const disks: RootReachDiskBound[] = [{ x: 0, z: 0, radius: BAT_BODY_RETARGET_M + 2e-9 }];
  for (const pose of poses) {
    for (const handIndex of [0, 1] as const) {
      const hand = handPoint(pose, handIndex === 0 ? TOP_HAND_FROM_CAP : LOWER_HAND_FROM_CAP);
      const shoulder = shoulders[handIndex];
      const uprightVertical = hand.y - shoulder.y;
      const bestCrouch = clamp(-uprightVertical, 0, maximumCrouchM);
      const minimumVertical = Math.abs(uprightVertical + bestCrouch);
      if (minimumVertical > reach) return false;
      disks.push({
        x: hand.x - shoulder.x,
        z: hand.z - shoulder.z,
        radius: Math.sqrt(Math.max(0, reach * reach - minimumVertical * minimumVertical)),
      });
    }
  }
  for (let left = 0; left < disks.length; left++) {
    for (let right = left + 1; right < disks.length; right++) {
      const a = disks[left];
      const b = disks[right];
      const dx = a.x - b.x;
      const dz = a.z - b.z;
      const maximumDistance = a.radius + b.radius + 2e-9;
      // Squared distance is equivalent for non-negative radii and keeps this physics gate inside the deterministic
      // arithmetic contract (Math.hypot is not specified to round identically on every JavaScript engine).
      if (dx * dx + dz * dz > maximumDistance * maximumDistance) return false;
    }
  }
  return true;
}

function solveVisibleTrackBody(track: BatTrack, nominalBody: BatterBody): BatTrack | null {
  const authorityTimes = [track.startT, track.plannedContactT, track.zoneOut];
  const authorityPoses = authorityTimes.map((time) => batPose(track, time));
  if (!rootReachIntersectionPossible(authorityPoses, nominalBody)) return null;
  const constraintTimes = [...authorityTimes];
  for (let iteration = 0; iteration < 10; iteration++) {
    const root = solveBatterRootOffsetForPoses(constraintTimes.map((time) => batPose(track, time)), nominalBody);
    if (!root.solved) break;
    const body = translateBatterBody(applyBatterPosture(nominalBody, root.crouchM), root.offset);
    const rooted: BatTrack = {
      ...track,
      body,
      batterRootOffset: root.offset,
      batterPosture: { crouchM: root.crouchM },
    };
    // Passing tracks need only the boolean; the exact argmin scan below runs only when some sample fails. The scan
    // includes the ordered hand reach (PHYS2 phase 5). Before, only the anatomy gap was scanned here and the reach
    // only at the three authority poses, so a root that left a hand 1-3 mm past its reach between them (typically
    // 13-15 ms into the follow-through) was returned, and every caller then rejected the stroke on its dense reach
    // scan: the requested speed failed and the planner fell to another tier. The worst sample now joins the root
    // solve's constraints, exactly as an anatomy-gap failure already did.
    const failure = { t: NaN };
    if (denseLatticeAdmissible(rooted, body, true, failure)) return rooted;
    const count = Math.max(1, Math.ceil((rooted.zoneOut - rooted.startT) / 0.0005));
    let worstGap = Infinity;
    let worstT = rooted.startT;
    for (let index = 0; index <= count; index++) {
      const time = rooted.startT + ((rooted.zoneOut - rooted.startT) * index) / count;
      const value = batPoseGapReach(batPose(rooted, time), body);
      const gap = Math.min(value.gap, BAT_HAND_REACH_SOLVE_M - value.reach);
      if (gap < worstGap) {
        worstGap = gap;
        worstT = time;
      }
    }
    if (worstGap >= -1e-9) {
      // Every lattice sample passes but the margin dips below the gate between two of them (PHYS2 phase 5b): the dip's
      // time joins the constraints, as a failing sample's does.
      if (!Number.isFinite(failure.t)) return rooted;
      worstT = failure.t;
    }
    if (constraintTimes.some((time) => Math.abs(time - worstT) <= 1e-9)) break;
    constraintTimes.push(worstT);
    constraintTimes.sort((left, right) => left - right);
  }

  // Minimum reach is not minimum collision: moving the planted athlete laterally can clear torso/pads while retaining
  // ample ordered-hand reach. Try a fixed, bounded world-compass lattice at the maximum legal authored posture,
  // reject on the three authority poses, then densely validate the complete same track. This is a generic solver
  // completion, not a shot/delivery/result branch; failure remains closed.
  const candidates = visibleBodyCompassCandidates(track, nominalBody, authorityTimes);
  for (const candidate of candidates) {
    if (denseLatticeAdmissible(candidate.rooted, candidate.rooted.body, true)) return candidate.rooted;
  }
  return null;
}

function safeWhiffTrack(
  base: BatTrack,
  nominalBody: BatterBody,
  budget: FallbackWorkBudget,
): BatTrack | null {
  const shoulders = batterShoulders(nominalBody);
  const centre = v3(
    (shoulders[0].x + shoulders[1].x) / 2,
    (shoulders[0].y + shoulders[1].y) / 2,
    (shoulders[0].z + shoulders[1].z) / 2,
  );
  const axes = base.horizontal < 0.5
    ? [norm(v3(-0.12, 0.99, 0.02)), norm(v3(-0.22, 0.96, 0.16))]
    : [norm(v3(-1, 0.05, 0)), norm(v3(-0.94, 0.12, 0.32))];
  for (const a of axes) {
    for (const yOffset of [-0.08, -0.16, 0]) {
      for (const zOffset of [0.2, 0.28, -0.2]) {
        const grip = v3(
          centre.x + a.x * 0.075,
          centre.y + yOffset + a.y * 0.075,
          centre.z + zOffset + a.z * 0.075,
        );
        const toe = v3(grip.x - a.x * BAT_FULL, grip.y - a.y * BAT_FULL, grip.z - a.z * BAT_FULL);
        if (toe.y < 0.005) continue;
        const faceProjection = dot(base.n, a);
        const n = norm(v3(base.n.x - a.x * faceProjection, base.n.y - a.y * faceProjection, base.n.z - a.z * faceProjection));
        const anchor = { grip, toe, n };
        if (batPoseGapReach(anchor, nominalBody).gap < -1e-9) continue;
        const sweet = v3(
          toe.x + a.x * SWEET_U * BLADE_L + n.x * (BLADE_T / 2),
          toe.y + a.y * SWEET_U * BLADE_L + n.y * (BLADE_T / 2),
          toe.z + a.z * SWEET_U * BLADE_L + n.z * (BLADE_T / 2),
        );
        const rooted: BatTrack = {
          ...base,
          a,
          n,
          sweet,
          contactU: SWEET_U,
          toeShift: 0,
          body: nominalBody,
          batterRootOffset: { x: 0, z: 0 },
          batterPosture: { crouchM: 0 },
          stance: anchor,
          backlift: anchor,
          finish: anchor,
          collisionTwist: { gripVelocity: v3(0, 0, 0), angularVelocity: v3(0, 0, 0) },
          collisionPath: null,
          geometryAdmitted: false,
        };
        const preferredSign = followThroughSide(rooted.shot);
        for (const axis of motionAxes(rooted, anchor)) {
          for (const angularSpeed of [4, 2, 1, 0.5]) {
            const twist: BatRigidTwist = {
              gripVelocity: v3(0, 0, 0),
              angularVelocity: v3(
                axis.x * preferredSign * angularSpeed,
                axis.y * preferredSign * angularSpeed,
                axis.z * preferredSign * angularSpeed,
              ),
            };
            const candidate = { ...rooted, collisionTwist: twist };
            if (!spendFallbackWork(budget, 4, false)) return null;
            const solved = solveVisibleTrackBody(candidate, nominalBody);
            if (!solved) continue;
            const stance = zonePose(solved, solved.startT);
            const finish = zonePose(solved, solved.zoneOut);
            // This whiff is a real, anatomy-safe visible bat trajectory. It remains collidable; whether it misses is
            // decided only by the same authoritative sweep as every intended stroke.
            const track = { ...solved, stance, backlift: stance, finish, geometryAdmitted: true };
            if (denseLatticeAdmissible(track, track.body, true)) return track;
          }
        }
      }
    }
  }
  return null;
}

/**
 * Pre-collision visible-skeleton planner. Inputs are only the declared delivery read, swing, timing and anatomy;
 * collision/result state is deliberately unavailable. Face normal/exit intent stay fixed. The planner searches legal
 * blade roll/contact locations, solves one minimum static whole-body root, then certifies every active pose densely.
 */
type VisibleStrokePlan =
  | { track: BatTrack; nextSpeed: null }
  | { track: null; nextSpeed: number | null };

/** Deterministic lower-speed seed for the free-endpoint family; never a proof of maximum feasible speed. */
function generalizedProbeSpeed(base: BatTrack): number {
  const commonWindowS = Math.min(base.plannedContactT - base.zoneIn, base.zoneOut - base.plannedContactT);
  const accelerationSeed = Math.min(base.speed, BAT_POINT_ACCEL_LIMIT_MPS2 * commonWindowS / (1 + Math.SQRT2));
  // This is a reproducible probe, not a ceiling. A quarter-metre-per-second lattice prevents a rounding-only
  // over-cap seed from hiding a nearby continuously certifiable family; any returned track is rebuilt at the exact
  // achieved speed and still has to pass every unchanged cap and anatomy bound.
  return Math.floor(accelerationSeed * 4 + 1e-12) / 4;
}

interface LegacyCandidatePlan {
  candidate: BatTrack;
  plannedTwist: PlannedCollisionTwist | null;
  twistAt(vLine: number): PlannedCollisionTwist | null;
}

function prepareLegacyCandidate(
  domain: CandidateTrackDomain,
  requestedU: number,
  axisIndex: number,
): LegacyCandidatePlan | null {
  const candidate = domain.candidate(requestedU, axisIndex);
  if (!candidate) return null;
  return legacyCandidatePlan(candidate);
}

/** The rigid-screw twist family of one fixed candidate geometry: its twist at any line speed (null past the caps). */
function legacyCandidatePlan(candidate: BatTrack, splitStep: number | null = null): LegacyCandidatePlan {
  const contactPose = poseFromSweet(candidate.sweet, candidate.n, candidate.a);
  const contactPoint = v3(
    candidate.contactAim.x - candidate.n.x * BALL_R,
    candidate.contactAim.y - candidate.n.y * BALL_R,
    candidate.contactAim.z - candidate.n.z * BALL_R,
  );
  const bladeAxis = poseAxis(contactPose);
  const widthAxis = norm(cross(bladeAxis, contactPose.n));
  // Face yaw: the per-error constant converted to swing time exactly as the drift is (faceYawRadps). It used to be a
  // fixed half rate (FACE_YAW × 500 deg/s), 3.3 times too slow at 24.8 m/s, so the swing plane's geometric opening of
  // the face dominated and early timing went squarer instead of closing towards leg. Tilt keeps its half rate: the
  // vertical swing plane itself tilts the face with timing.
  const yaw = faceYawRadps(candidate, candidate.vLine);
  const tilt = candidate.tiltRate * 500 * DEG;
  const authoredAngularVelocity = v3(
    bladeAxis.x * yaw + widthAxis.x * tilt,
    bladeAxis.y * yaw + widthAxis.y * tilt,
    bladeAxis.z * yaw + widthAxis.z * tilt,
  );
  const twistAt = (vLine: number): PlannedCollisionTwist | null => {
    const desiredVelocity = projectedContactVelocity(
      candidate.uHat,
      candidate.U,
      candidate.a,
      candidate.drift,
      vLine,
      candidate.physErrorMs,
      candidate.intendedBearing,
    );
    return collisionTwistFor(
      contactPose,
      contactPoint,
      desiredVelocity,
      authoredAngularVelocity,
      candidate.plannedContactT - candidate.startT,
      0.02 + 0.055 * clamp(Math.abs(candidate.physErrorMs) / 20, 0, 1),
      splitStep,
    );
  };
  return { candidate, plannedTwist: twistAt(candidate.vLine), twistAt };
}

/**
 * The choices one certified rigid stroke was planned with (PHYS2 phase 5): its contact location on the lattice, its
 * face roll about the face normal from the base blade axis, its aim family (null: the stroke's own aim and elevation;
 * otherwise the limit stroke's aim this far towards the middle of its reach, with the plain elevation), the speed its
 * face was solved for, the line speed it was certified at, and the planted body. A mistimed swing replays the on-time
 * plan's choices (buildBatTrack), so timing error perturbs one plan continuously instead of re-selecting the candidate,
 * the body and the speed tier at every millisecond.
 */
interface TrackAnchor {
  splitStep: number | null;
  requestedU: number;
  rollRad: number;
  aimTowardCentre: number | null;
  faceSpeed: number;
  lineSpeed: number;
  root: { x: number; z: number };
  crouchM: number;
}

/**
 * Anchors of tracks certified during the current call, keyed by the returned track object. Read only for the on-time
 * plan built inside the same buildBatTrack call; no result ever depends on an entry from another call.
 */
const TRACK_ANCHORS = new WeakMap<BatTrack, TrackAnchor>();

function anchorTrack(track: BatTrack, base: BatTrack, requestedU: number, seedAxis: Vec3, aimTowardCentre: number | null): BatTrack {
  TRACK_ANCHORS.set(track, {
    splitStep: TWIST_SPLIT_STEPS.get(track.collisionTwist) ?? null,
    requestedU,
    rollRad: semanticRollRad(base.a, seedAxis, base.n),
    aimTowardCentre,
    faceSpeed: base.speed,
    lineSpeed: track.vLine,
    root: { x: track.batterRootOffset.x, z: track.batterRootOffset.z },
    crouchM: track.batterPosture.crouchM,
  });
  return track;
}

/** The seed axis at a face roll from the base blade axis, normalized as axisCandidates does (null: not this class). */
function axisAtRoll(base: BatTrack, rollRad: number): Vec3 | null {
  const rolled = rotate(base.a, base.n, rollRad);
  const d = dot(rolled, base.n);
  let axis = norm(v3(rolled.x - base.n.x * d, rolled.y - base.n.y * d, rolled.z - base.n.z * d));
  if (base.horizontal < 0.5 && axis.y < 0) axis = v3(-axis.x, -axis.y, -axis.z);
  return shotClassAllowsAxis(axis, base.horizontal) ? axis : null;
}

/** Lowest line speed a same-geometry ceiling searches from (m/s), as the limit stroke's bisection. */
const SAME_GEOMETRY_CEILING_FLOOR_MPS = 0.5;
/**
 * Top of the request-independent speed grid every anatomy ceiling bisects on (m/s, above the fastest requested line
 * speed). PHYS2 5d: a ceiling found on a grid spanning [floor, request] moved with the request, so a harder swipe could
 * be certified a grid step slower; on this fixed grid a capped stroke is the same stroke for every request above it.
 */
const CEILING_GRID_TOP_MPS = 32;

/**
 * The fastest certified line speed on the fixed grid [floor, CEILING_GRID_TOP_MPS] (9 bisection steps), capped at
 * `request`: `certify(v)` builds the stroke played at v, face included. Null when even the floor fails.
 */
function cappedSpeedCeiling(request: number, certify: (lineSpeed: number) => BatTrack | null): BatTrack | null {
  let low = SAME_GEOMETRY_CEILING_FLOOR_MPS;
  if (!(request > low)) return null;
  let best = certify(low);
  if (!best) return null;
  let high = CEILING_GRID_TOP_MPS;
  for (let iteration = 0; iteration < 9; iteration++) {
    const middle = (low + high) / 2;
    if (middle >= request) {
      high = middle;
      continue;
    }
    const planned = certify(middle);
    if (planned) {
      low = middle;
      best = planned;
    } else {
      high = middle;
    }
  }
  return best;
}

interface DefenceChoice {
  track: BatTrack;
  bodyMotion: number;
  rootMotion: number;
  contactError: number;
  axisIndex: number;
}

/** A block prefers the quietest planted body, then the smallest root move, contact-location error and axis index. */
function betterDefence(candidate: DefenceChoice, incumbent: DefenceChoice | null): boolean {
  if (!incumbent) return true;
  const sameBody = Math.abs(candidate.bodyMotion - incumbent.bodyMotion) <= 1e-12;
  const sameRoot = Math.abs(candidate.rootMotion - incumbent.rootMotion) <= 1e-12;
  const sameError = Math.abs(candidate.contactError - incumbent.contactError) <= 1e-12;
  return candidate.bodyMotion < incumbent.bodyMotion - 1e-12
    || (sameBody && candidate.rootMotion < incumbent.rootMotion - 1e-12)
    || (sameBody && sameRoot && candidate.contactError < incumbent.contactError - 1e-12)
    || (sameBody && sameRoot && sameError && candidate.axisIndex < incumbent.axisIndex);
}

function planVisibleStroke(
  base: BatTrack,
  nominalBody: BatterBody,
  domain: CandidateTrackDomain,
  budget: FallbackWorkBudget,
  preferCompassAuthority = false,
  returnAtFirstAnatomyCeiling = false,
  refineCompassAuthority = false,
  returnAfterFirstAnatomyContactLocation = false,
): VisibleStrokePlan {
  const requestedU = Array.from({ length: 41 }, (_, index) => index / 40)
    // A defensive face contact must retain one lattice step of blade on either side of the ball centre; selecting
    // the mathematical toe/cap boundary can turn micrometre sweep tolerance into a synthetic edge classification.
    .filter((u) => base.kind !== 'defend' || (u >= 0.025 && u <= 0.975))
    .sort((left, right) => Math.abs(left - SWEET_U) - Math.abs(right - SWEET_U));
  if (base.kind !== 'defend') requestedU.splice(LEGACY_ATTACK_CONTACT_LOCATION_LIMIT);
  const axes = domain.axes.slice();
  if (base.kind !== 'defend') axes.splice(LEGACY_ATTACK_AXIS_LIMIT);
  // Once the requested-speed legacy family has derived a coherent lower speed, cheaply replay the same fixed-world
  // compass authority used by its body solver across the bounded semantic grid. This changes no admission rule: a
  // candidate is returned only after its complete dense track clears solids and ordered reach. It merely avoids
  // repeatedly invoking the much broader root/crouch solver for candidates whose three authority poses cannot even
  // inhabit this already-existing fallback family. A caller may use the safe compass result only to nominate one
  // semantic U/axis, then pay for one exact root/crouch refinement instead of reopening the complete grid.
  if (preferCompassAuthority && base.kind !== 'defend') {
    for (const u of requestedU) {
      const refinements: { candidate: BatTrack; axisIndex: number }[] = [];
      let best: {
        track: BatTrack;
        bodyMotion: number;
        rootMotion: number;
        axisIndex: number;
      } | null = null;
      for (let axisIndex = 0; axisIndex < axes.length; axisIndex++) {
        // As below: a spent ledger returns the best certified compass stroke found so far, never discards it.
        if (!spendFallbackWork(budget, 1)) return best ? { track: best.track, nextSpeed: null } : { track: null, nextSpeed: null };
        const prepared = prepareLegacyCandidate(domain, u, axisIndex);
        if (!prepared?.plannedTwist) continue;
        const candidate: BatTrack = {
          ...prepared.candidate,
          zoneIn: prepared.candidate.plannedContactT - prepared.plannedTwist.rampSeconds,
          zoneOut: prepared.candidate.plannedContactT + prepared.plannedTwist.rampSeconds,
          collisionTwist: prepared.plannedTwist.twist,
          geometryAdmitted: true,
        };
        refinements.push({ candidate, axisIndex });
        const bodies = visibleBodyCompassCandidates(
          candidate,
          nominalBody,
          [candidate.startT, candidate.plannedContactT, candidate.zoneOut],
        );
        let rooted: BatTrack | null = null;
        for (const body of bodies) {
          if (!spendFallbackWork(budget, 4)) return best ? { track: best.track, nextSpeed: null } : { track: null, nextSpeed: null };
          if (denseLatticeAdmissible(body.rooted, body.rooted.body, true)) {
            rooted = body.rooted;
            break;
          }
        }
        if (!rooted) continue;
        const stance = zonePose(rooted, rooted.startT);
        const finish = zonePose(rooted, rooted.zoneOut);
        const planned: BatTrack = anchorTrack({ ...rooted, stance, backlift: stance, finish }, base, u, axes[axisIndex], null);
        const rootMotion = planarMagnitude(planned.batterRootOffset.x, planned.batterRootOffset.z);
        const bodyMotion = Math.sqrt(
          rootMotion * rootMotion + planned.batterPosture.crouchM * planned.batterPosture.crouchM,
        );
        if (!best
          || bodyMotion < best.bodyMotion - 1e-12
          || (Math.abs(bodyMotion - best.bodyMotion) <= 1e-12 && rootMotion < best.rootMotion - 1e-12)
          || (Math.abs(bodyMotion - best.bodyMotion) <= 1e-12
            && Math.abs(rootMotion - best.rootMotion) <= 1e-12 && axisIndex < best.axisIndex)) {
          best = { track: planned, bodyMotion, rootMotion, axisIndex };
        }
      }
      if (best) {
        if (refineCompassAuthority) {
          for (const refinement of refinements) {
            if (!spendFallbackWork(budget, 4)) break;
            const exactRooted = solveVisibleTrackBody(refinement.candidate, nominalBody);
            if (exactRooted) {
              const stance = zonePose(exactRooted, exactRooted.startT);
              const finish = zonePose(exactRooted, exactRooted.zoneOut);
              const exact = anchorTrack({ ...exactRooted, stance, backlift: stance, finish }, base, u, axes[refinement.axisIndex], null);
              if (denseLatticeAdmissible(exact, exact.body, true)) return { track: exact, nextSpeed: null };
            }
          }
        }
        return { track: best.track, nextSpeed: null };
      }
    }
    return { track: null, nextSpeed: null };
  }
  let bestDefence: DefenceChoice | null = null;
  // A spent ledger ends the search; it never discards a stroke this search has already certified. Returning null here
  // used to turn a found, fully certified block into the fail-closed whiff (the reference yorker's forward defence).
  // The partial location competes with the completed ones by the same order a completed location would.
  const exhausted = (
    current: { track: BatTrack; bodyMotion: number; rootMotion: number; axisIndex: number } | null,
    u: number,
  ): VisibleStrokePlan => {
    if (base.kind !== 'defend') return current ? { track: current.track, nextSpeed: null } : { track: null, nextSpeed: null };
    const partial = current ? { ...current, contactError: Math.abs(u - SWEET_U) } : null;
    const found = partial && betterDefence(partial, bestDefence) ? partial : bestDefence;
    return found ? { track: found.track, nextSpeed: null } : { track: null, nextSpeed: null };
  };
  let firstTwistCeiling: number | null = null;
  let firstAnatomyCeiling: number | null = null;
  // Same-geometry speed ceiling (PHYS2 phase 5, lead plan item 2). Before: when the requested speed failed, a failing
  // candidate's ceiling was only used as a speed for buildBatTrack to rebuild the whole stroke (new face, new geometry,
  // often another planner tier), and a candidate that rooted but failed the dense reach scan by millimetres gave no
  // ceiling at all. Either way the planned speed jumped by up to 15 m/s between neighbouring milliseconds. Now the
  // first attacking candidate that fails at the requested speed keeps its own geometry: its fastest certified line
  // speed (complete body solve, stance, finish and dense reach scan) is the stroke returned when no candidate is
  // certified at the requested speed, and the achieved speed is recorded on the track.
  let ceilingSource: { candidate: BatTrack; twistAt: (vLine: number) => PlannedCollisionTwist | null; u: number; seedAxis: Vec3 } | null = null;
  const ceilingTrack = (): BatTrack | null => {
    if (!ceilingSource || base.kind === 'defend') return null;
    const { candidate, twistAt, u, seedAxis } = ceilingSource;
    const rollRad = semanticRollRad(base.a, seedAxis, base.n);
    const track = cappedSpeedCeiling(candidate.vLine, (lineSpeed) => {
      // The face is solved for the line speed played (PHYS2 5d): a face set for the requested speed sent a stroke
      // capped far below it off at the wrong bearing (a -60 deg pull capped at 1.5-5 m/s exited near -90 deg).
      const atSpeed = domain.atSpeed ? domain.atSpeed(lineSpeed, u, rollRad) : candidate;
      if (!atSpeed) return null;
      const twist = domain.atSpeed ? legacyCandidatePlan(atSpeed).twistAt(lineSpeed) : twistAt(lineSpeed);
      if (!twist || !spendFallbackWork(budget, 4)) return null;
      const rooted = solveVisibleTrackBody({
        ...atSpeed,
        zoneIn: candidate.plannedContactT - twist.rampSeconds,
        zoneOut: candidate.plannedContactT + twist.rampSeconds,
        collisionTwist: twist.twist,
        geometryAdmitted: true,
        speed: lineSpeed,
        vLine: lineSpeed,
      }, nominalBody);
      if (!rooted) return null;
      const stance = zonePose(rooted, rooted.startT);
      const finish = zonePose(rooted, rooted.zoneOut);
      const planned: BatTrack = { ...rooted, stance, backlift: stance, finish };
      return denseLatticeAdmissible(planned, planned.body, true) ? planned : null;
    });
    if (!track) return null;
    TRACK_ANCHORS.set(track, {
      splitStep: TWIST_SPLIT_STEPS.get(track.collisionTwist) ?? null,
      requestedU: u,
      rollRad,
      aimTowardCentre: null,
      faceSpeed: track.vLine,
      lineSpeed: track.vLine,
      root: { x: track.batterRootOffset.x, z: track.batterRootOffset.z },
      crouchM: track.batterPosture.crouchM,
    });
    return track;
  };
  for (const u of requestedU) {
    let bestForContactLocation: { track: BatTrack; bodyMotion: number; rootMotion: number; axisIndex: number } | null = null;
    for (let axisIndex = 0; axisIndex < axes.length; axisIndex++) {
      // Two credits cover face/contact geometry; each body/root solve below draws its own shared block.
      if (!spendFallbackWork(budget, 2)) return exhausted(bestForContactLocation, u);
      const prepared = prepareLegacyCandidate(domain, u, axisIndex);
      if (!prepared) continue;
      const { candidate, plannedTwist, twistAt } = prepared;
      if (!plannedTwist) {
        // Locate a rigid-cap ceiling with collision-only probes. The expensive body/root solve is deliberately not
        // repeated here; buildBatTrack will rebuild the face and run the complete planner once at this achieved speed.
        if (firstTwistCeiling === null) {
          let low = 0;
          let lowTwist = twistAt(0);
          if (lowTwist) {
            let high = candidate.vLine;
            for (let iteration = 0; iteration < 12; iteration++) {
              const middle = (low + high) / 2;
              const middleTwist = twistAt(middle);
              if (middleTwist) {
                low = middle;
                lowTwist = middleTwist;
              } else {
                high = middle;
              }
            }
            firstTwistCeiling = low;
          }
        }
        continue;
      }
      const solveWithTwist = (twist: PlannedCollisionTwist): BatTrack | null => {
        if (!spendFallbackWork(budget, 4)) return null;
        return solveVisibleTrackBody({
            ...candidate,
            zoneIn: candidate.plannedContactT - twist.rampSeconds,
            zoneOut: candidate.plannedContactT + twist.rampSeconds,
            collisionTwist: twist.twist,
            geometryAdmitted: true,
          }, nominalBody);
      };
      const rooted = solveWithTwist(plannedTwist);
      if (!rooted && !ceilingSource) ceilingSource = { candidate, twistAt, u, seedAxis: axes[axisIndex] };
      if (!rooted) {
        // Twist caps alone are not sufficient: a faster admissible twist sweeps a longer hand arc. Find the ceiling
        // for this one already-selected contact geometry with body-only probes, then rebuild face and geometry once
        // at that achieved speed. This is bounded work on one candidate, never an outer full-planner bisection.
        if (firstAnatomyCeiling === null) {
          const stoppedTwist = twistAt(0);
          const stopped = stoppedTwist ? solveWithTwist(stoppedTwist) : null;
          if (stopped) {
            let low = 0;
            let high = candidate.vLine;
            for (let iteration = 0; iteration < 8; iteration++) {
              const middle = (low + high) / 2;
              const middleTwist = twistAt(middle);
              if (middleTwist && solveWithTwist(middleTwist)) low = middle;
              else high = middle;
            }
            firstAnatomyCeiling = low;
          }
        }
        if (returnAtFirstAnatomyCeiling && base.kind !== 'defend' && firstAnatomyCeiling !== null) {
          const ceiling = ceilingTrack();
          if (ceiling) return { track: ceiling, nextSpeed: null };
          return { track: null, nextSpeed: firstAnatomyCeiling };
        }
        continue;
      }
      const stance = zonePose(rooted, rooted.startT);
      const finish = zonePose(rooted, rooted.zoneOut);
      const planned: BatTrack = anchorTrack({ ...rooted, stance, backlift: stance, finish }, base, u, axes[axisIndex], null);
      if (!denseLatticeAdmissible(planned, planned.body, true)) {
        if (!ceilingSource) ceilingSource = { candidate, twistAt, u, seedAxis: axes[axisIndex] };
        continue;
      }
      const rootMotion = planarMagnitude(planned.batterRootOffset.x, planned.batterRootOffset.z);
      const bodyMotion = Math.sqrt(
        rootMotion * rootMotion + planned.batterPosture.crouchM * planned.batterPosture.crouchM,
      );
      const current = bestForContactLocation;
      if (!current
        || bodyMotion < current.bodyMotion - 1e-12
        || (Math.abs(bodyMotion - current.bodyMotion) <= 1e-12 && rootMotion < current.rootMotion - 1e-12)
        || (Math.abs(bodyMotion - current.bodyMotion) <= 1e-12 && Math.abs(rootMotion - current.rootMotion) <= 1e-12 && axisIndex < current.axisIndex)) {
        bestForContactLocation = { track: planned, bodyMotion, rootMotion, axisIndex };
      }
      // Contact-location error is the primary stroke-intent criterion. Within that fixed location no whole-body
      // movement can beat zero, and axes are already ordered by minimum face-plane roll.
      if (bodyMotion <= 1e-12) {
        return { track: planned, nextSpeed: null };
      }
    }
    if (bestForContactLocation) {
      if (base.kind !== 'defend') {
        return { track: bestForContactLocation.track, nextSpeed: null };
      }
      // A block prioritizes a quiet planted body over striking the nominal sweet spot: meeting a very full ball a
      // few centimetres nearer the toe is truthful, while dragging the whole batter 180 mm can put the pad in front
      // of an otherwise orthodox defensive bat. Contact-location error remains the deterministic tie-break.
      const candidate = {
        ...bestForContactLocation,
        contactError: Math.abs(u - SWEET_U),
      };
      if (betterDefence(candidate, bestDefence)) bestDefence = candidate;
    } else if (returnAfterFirstAnatomyContactLocation && base.kind !== 'defend') {
      const ceiling = ceilingTrack();
      if (ceiling) return { track: ceiling, nextSpeed: null };
      const firstCoherentCeiling = firstAnatomyCeiling ?? firstTwistCeiling;
      if (firstCoherentCeiling === null) continue;
      // The first semantic contact location remains the speed authority, but every public face roll at that same
      // location gets a chance to retain the requested speed before correction. Its coherent limit may be imposed
      // by either the rigid twist or the anatomy solve, matching the authority used by the complete planner below.
      // This preserves an existing legal requested-speed stroke while preventing a failed location from consuming
      // the complete shared ledger.
      return { track: null, nextSpeed: firstCoherentCeiling };
    }
  }
  if (bestDefence) {
    return { track: bestDefence.track, nextSpeed: null };
  }
  const ceiling = ceilingTrack();
  if (ceiling) return { track: ceiling, nextSpeed: null };
  const nextSpeed = firstAnatomyCeiling ?? firstTwistCeiling;
  return { track: null, nextSpeed: nextSpeed !== null && nextSpeed < base.speed - 1e-6 ? nextSpeed : null };
}

/** Build the bat track for a swing against a flight. Pure: same inputs, same track. */
export function buildBatTrack(flight: BallFlight, swing: NormalizedSwing, opts: StrikeOptions): BatTrack {
  return buildBatTrackAt(flight, swing, opts, true);
}

function buildBatTrackAt(flight: BallFlight, swing: NormalizedSwing, opts: StrikeOptions, replayOnTimePlan: boolean): BatTrack {
  const auto = swing.footwork === 'auto';
  const footwork = resolveFootwork(flight, swing.footwork);
  const idealT = idealTimeFor(flight, auto ? 'auto' : footwork);
  const travelMs = batTravelMs(swing.kind, swing.power);
  const arriveT = swing.startT + travelMs / 1000;
  const errorMs = (arriveT - idealT) * 1000;
  const physErrorMs = forgive(errorMs, activeBands(opts.assist, opts.tierToleranceMs ?? 0));
  if (opts.assist !== 'real') {
    // Learn and Play forgive by moving the whole swing (PHYS2 phase 5e, SYS1, evaluator eval-phys §1.2): the start
    // and the arrival shift together by forgive(e) - e, so the bat plays exactly the Real swing at the band-mapped
    // error, with the stroke's own travel. Before, only the arrival moved and the start stayed the player's, which
    // compressed or stretched the travel and changed the stroke beyond the declared bands (Learn 20 ms, defend 75 ms
    // late: travel 72 ms instead of 120, bowled; Real at the mapped +27.5 ms: middle). The player's raw error stays
    // the report's error and the label's input (contact.ts); assistance changes nothing else.
    const played: NormalizedSwing = { ...swing, startT: swing.startT + (physErrorMs - errorMs) / 1000 };
    const track = buildBatTrackAt(flight, played, { ...opts, assist: 'real', tierToleranceMs: 0 }, replayOnTimePlan);
    track.errorMs = errorMs;
    return track;
  }
  const effT = idealT + physErrorMs / 1000;
  const commitMs = COMMIT_BEFORE_MS[opts.assist];
  const commitT = commitMs === null ? null : effT - commitMs / 1000;
  const zPlane = sampleAt(flight.samples, idealT).p.z;
  const read = readBall(flight, zPlane, commitT, readExpectation(flight, opts.expect));
  const balance = balanceFor(flight, footwork, auto);
  // The stroke's reach and aim come first: a ball above a vertical bat's reach opens the face (it pops up).
  const shot = planShot(swing, footwork, read.c);
  // Only a vertical-bat back-foot stroke is a checked punch. A cut, pull or hook is a full horizontal swing even
  // though it is played from the back foot. The multiplier is part of the requested stroke, before the physical
  // planner finds the fastest version that the same rigid, planted skeleton can actually perform.
  const punch = swing.kind === 'attack'
    && (footwork === 'back' || footwork === 'across')
    && shot.horizontal < 0.5
    ? BACK_FOOT_PUNCH
    : 1;
  const requestedSpeed = batSpeed(swing.kind, swing.power) * punch;
  const targetElevation = targetElevationDeg(swing.kind, swing.elevation) + shot.popDeg;
  const horizontal = shot.horizontal;
  const U = Math.max(1, len(read.u));
  const uHat = v3(read.u.x / U, read.u.y / U, read.u.z / U);
  const yawRate = swing.kind === 'defend' ? DEFEND_FACE_YAW_DEG_PER_MS : FACE_YAW_DEG_PER_MS;
  const tiltRate = swing.kind === 'defend' ? FACE_TILT_DEG_PER_MS * 0.6 : FACE_TILT_DEG_PER_MS;
  // Timing is causal: every swing is authored around the same read/shot pose and its centre merely occurs at plannedContactT.
  // The ball meets that path earlier/later; a constant face-plane drift velocity makes the miss distance emerge from
  // the physical error instead of re-aiming the bat at the mistimed ball.
  const plannedContactT = effT;
  const contactAim = shot.aim;
  // The causal stroke accelerates from rest at activation, passes continuously through the planned contact pose,
  // then decelerates to rest over one bounded follow-through leg. It never switches kinematic branches at plannedContactT.
  const zoneIn = swing.startT;
  const zoneOut = plannedContactT + Math.max(0.08, Math.min(0.14, travelMs / 1000));
  const nominalBody = batterBody(footwork, flight);
  // Before the swing the batter waits with the bat picked up behind him (out of the ball's path), as batters do
  // once the bowler is in his delivery stride; presentation may draw the grounded stance before release.
  const nominalStance = makePose(v3(-0.2, 1.0, PITCH_HALF - 0.85), v3(0.1, 0.45, 0.88), v3(0, -0.88, 0.45));
  const defend = swing.kind === 'defend';
  const nominalBackGrip = v3(nominalBody.torso.a.x + 0.08, defend ? 1.0 : 1.18, nominalBody.torso.a.z + (defend ? 0.05 : 0.2));
  const nominalBacklift = defend
    ? makePose(nominalBackGrip, v3(0.1, -0.8, 0.35), v3(0, 0, -1))
    : makePose(nominalBackGrip, v3(0.12, 0.55, 0.82), v3(0, -0.6, 0.8));
  const nominalFinish = makePose(v3(nominalBody.head.c.x - 0.12, 1.42, nominalBody.head.c.z + 0.05), v3(-0.35, 0.55, 0.75), v3(0, 0.6, -0.8));
  const spinAtIdeal = incomingSpin(flight, idealT);
  const baseFor = (speed: number, aim: Vec3, elevationTarget: number): BatTrack => {
    // Face intent and the complete collision track must be solved for the speed that will really be played. Reusing
    // the requested-speed face after reducing the motion would make direction/elevation depend on a hidden impulse.
    const face = solveFace(read.u, spinAtIdeal, swing.directionDeg, elevationTarget, swing.kind, speed, balance);
    const contactAim = aim;
    const targetElevation = elevationTarget;
    const n = face.n;
    const a = bladeAxis(n, horizontal);
    const drift = driftForAxis(a, n, horizontal, swing.directionDeg);
    let sweet = v3(contactAim.x - n.x * BALL_R, contactAim.y - n.y * BALL_R, contactAim.z - n.z * BALL_R);
    const b0 = bladeFrom(sweet, n, a);
    let toeShift = 0;
    if (b0.toe.y < 0.005 && a.y > 0.05) {
      toeShift = (0.005 - b0.toe.y) / a.y;
      sweet = v3(sweet.x + a.x * toeShift, sweet.y + a.y * toeShift, sweet.z + a.z * toeShift);
    }
    const contactU = clamp(SWEET_U - toeShift / BLADE_L, 0, 1);
    return {
      kind: swing.kind,
      startT: swing.startT,
      travelMs,
      arriveT,
      idealT,
      errorMs,
      physErrorMs,
      effT,
      plannedContactT,
      footwork,
      balance,
      batterRootOffset: { x: 0, z: 0 },
      batterPosture: { crouchM: 0 },
      body: nominalBody,
      read,
      commitT,
      shot,
      contactAim,
      sweet,
      toeShift,
      contactU,
      n,
      a,
      uHat,
      U,
      vLine: face.vLine,
      speed,
      drift,
      yawRate,
      tiltRate,
      horizontal,
      intendedBearing: swing.directionDeg,
      targetElevation,
      zoneIn,
      zoneOut,
      stance: nominalStance,
      backlift: nominalBacklift,
      finish: nominalFinish,
      collisionTwist: { gripVelocity: v3(0, 0, 0), angularVelocity: v3(0, 0, 0) },
      collisionPath: null,
      geometryAdmitted: false,
    };
  };
  const baseAtSpeed = (speed: number): BatTrack => baseFor(speed, contactAim, targetElevation);
  const candidateDomains = new WeakMap<BatTrack, CandidateTrackDomain>();
  const fallbackBudget: FallbackWorkBudget = { remaining: FALLBACK_WORK_LIMIT };
  const domainFor = (base: BatTrack): CandidateTrackDomain => {
    const existing = candidateDomains.get(base);
    if (existing) return existing;
    const created = candidateTrackDomain(base, nominalBody, base.a, spinAtIdeal);
    created.atSpeed = (speed, requestedU, rollRad) => {
      const rebased = baseFor(speed, base.contactAim, base.targetElevation);
      const seed = axisAtRoll(rebased, rollRad);
      return seed ? candidateTrackForGeometry(rebased, spinAtIdeal, requestedU, seed, rebased.a) : null;
    };
    candidateDomains.set(base, created);
    return created;
  };
  // The requested stroke at the anatomical limit (the fail-closed path before the whiff). The batter swings the stroke
  // he chose, at the speed he asked for and with the same timing mechanics, towards the nearest of three aims his
  // planted body can certify: the stroke's own aim without the pop-up face (the ball above the reach is met wherever
  // the bat really is), halfway to the middle of the stroke's reach, and the middle itself. Whether the ball then
  // meets the face, an edge, the body or nothing is decided by the same sweep as every stroke, so the result still
  // depends on timing. Bounded: at most 3 aims x 2 blade rolls, each one exact body solve and dense certificate.
  const reachCentre = v3((shot.x[0] + shot.x[1]) / 2, (shot.y[0] + shot.y[1]) / 2, contactAim.z);
  const limitContactU = Math.round(SWEET_U / GENERALIZED_COLLISION_CONTACT_U_STEP) * GENERALIZED_COLLISION_CONTACT_U_STEP;
  const plainElevation = targetElevationDeg(swing.kind, swing.elevation);
  const limitAim = (towardCentre: number): Vec3 => v3(
    contactAim.x + (reachCentre.x - contactAim.x) * towardCentre,
    contactAim.y + (reachCentre.y - contactAim.y) * towardCentre,
    contactAim.z,
  );
  const certifiedLimit = (speed: number, towardCentre: number, axisIndex: number): BatTrack | null => {
    const base = baseFor(speed, limitAim(towardCentre), plainElevation);
    const domain = domainFor(base);
    if (axisIndex >= domain.axes.length) return null;
    const prepared = prepareLegacyCandidate(domain, limitContactU, axisIndex);
    if (!prepared?.plannedTwist) return null;
    const rooted = solveVisibleTrackBody({
      ...prepared.candidate,
      zoneIn: prepared.candidate.plannedContactT - prepared.plannedTwist.rampSeconds,
      zoneOut: prepared.candidate.plannedContactT + prepared.plannedTwist.rampSeconds,
      collisionTwist: prepared.plannedTwist.twist,
      geometryAdmitted: true,
    }, nominalBody);
    if (!rooted) return null;
    const stance = zonePose(rooted, rooted.startT);
    const finish = zonePose(rooted, rooted.zoneOut);
    const planned: BatTrack = { ...rooted, stance, backlift: stance, finish };
    return denseLatticeAdmissible(planned, planned.body, true)
      ? anchorTrack(planned, base, limitContactU, domain.axes[axisIndex], towardCentre)
      : null;
  };
  // The fastest certified version of the stroke at one aim: a fixed 7-step bisection on the speed alone, before any
  // result exists (null when even a near-stopped bat cannot be certified there).
  const fastestAt = (towardCentre: number): BatTrack | null =>
    cappedSpeedCeiling(requestedSpeed, (speed) => certifiedLimit(speed, towardCentre, 0));
  const limitStroke = (bisect = true): BatTrack | null => {
    for (let axisIndex = 0; axisIndex < 2; axisIndex++) {
      const planned = certifiedLimit(requestedSpeed, 0, axisIndex);
      if (planned) return planned;
    }
    // Blend, don't switch (lead decision 2026-11-03): when the requested speed just fails at the stroke's own aim (a
    // hand a few millimetres past its reach in the follow-through), the batter meets the ball with the fastest
    // certified version of the same stroke there. The speed then falls continuously with the anatomical deficit
    // instead of the aim jumping tens of centimetres off the ball at one timing and back at the next.
    if (bisect) {
      const atBall = fastestAt(0);
      if (atBall) return atBall;
    }
    for (const towardCentre of [0.5, 1]) {
      for (let axisIndex = 0; axisIndex < 2; axisIndex++) {
        const planned = certifiedLimit(requestedSpeed, towardCentre, axisIndex);
        if (planned) return planned;
      }
    }
    if (!bisect) return null;
    // A ball beyond the stroke's reach at every speed: the batter plays the fastest certified version of the same
    // stroke at the middle of its reach. Only if even a near-stopped bat cannot be certified does the fail-closed
    // whiff remain.
    return fastestAt(1);
  };

  const replayAnchor = (anchor: TrackAnchor): BatTrack | null => {
    const towardCentre = anchor.aimTowardCentre;
    // The replay at any line speed solves its face for that speed (PHYS2 5d), like the on-time plan it replays.
    const replayCandidate = (speed: number): BatTrack | null => {
      const rebased = towardCentre === null
        ? baseFor(speed, contactAim, targetElevation)
        : baseFor(speed, limitAim(towardCentre), plainElevation);
      const seed = axisAtRoll(rebased, anchor.rollRad);
      return seed ? candidateTrackForGeometry(rebased, spinAtIdeal, anchor.requestedU, seed, rebased.a) : null;
    };
    const candidate = replayCandidate(anchor.faceSpeed);
    if (!candidate) return null;
    const plan = legacyCandidatePlan(candidate, anchor.splitStep);
    // The planted body is re-solved continuously for the replayed swing (the same static root/crouch solver). Holding
    // the on-time root fixed was measured first: a mistimed swing's longer acceleration ramp (0.02 s on time, 0.075 s
    // from 20 ms of error) sweeps a longer hand arc, and the fixed root forced the ceiling of the ref-1 Real 45 deg
    // drive down to 0.7 m/s at -20 ms.
    // The on-time root and crouch are kept whenever the replayed swing is certified with them; only otherwise is the
    // body solved again for this swing.
    const anchorBody = translateBatterBody(applyBatterPosture(nominalBody, anchor.crouchM), anchor.root);
    const certify = (lineSpeed: number): BatTrack | null => {
      const atSpeed = lineSpeed === anchor.faceSpeed ? candidate : replayCandidate(lineSpeed);
      if (!atSpeed) return null;
      const twist = (atSpeed === candidate ? plan : legacyCandidatePlan(atSpeed, anchor.splitStep)).twistAt(lineSpeed);
      if (!twist) return null;
      const swingTrack: BatTrack = {
        ...atSpeed,
        zoneIn: candidate.plannedContactT - twist.rampSeconds,
        zoneOut: candidate.plannedContactT + twist.rampSeconds,
        collisionTwist: twist.twist,
        geometryAdmitted: true,
        speed: lineSpeed,
        vLine: lineSpeed,
      };
      const held: BatTrack = {
        ...swingTrack,
        body: anchorBody,
        batterRootOffset: { x: anchor.root.x, z: anchor.root.z },
        batterPosture: { crouchM: anchor.crouchM },
      };
      const rooted = denseLatticeAdmissible(held, anchorBody, true) ? held : solveVisibleTrackBody(swingTrack, nominalBody);
      if (!rooted) return null;
      const stance = zonePose(rooted, rooted.startT);
      const finish = zonePose(rooted, rooted.zoneOut);
      const planned: BatTrack = { ...rooted, stance, backlift: stance, finish };
      return denseLatticeAdmissible(planned, planned.body, true) ? planned : null;
    };
    return certify(anchor.lineSpeed) ?? cappedSpeedCeiling(anchor.lineSpeed, certify);
  };

  if (Math.abs(physErrorMs) > BAT_TIMING_CALIBRATION.edgeMs) {
    // Beyond the edge band the swing is still the requested stroke, only far early or late: the sweep decides. (No
    // speed bisection here: so far from its planned pose the bat cannot meet the ball near the planned contact.)
    const limit = limitStroke(false);
    if (limit) return limit;
    const base = baseAtSpeed(requestedSpeed);
    const whiff = safeWhiffTrack(base, nominalBody, fallbackBudget);
    if (!whiff) throw new Error(`No anatomy-safe missed-swing track (${shot.family}, planned=${plannedContactT})`);
    return whiff;
  }

  // Timing error perturbs one plan (PHYS2 phase 5, lead ruling item 3). Before: every millisecond re-ran the whole
  // planner, which re-selected the contact location, face roll, planted body and speed tier, so neighbouring timings
  // could swap candidate geometry (ref-1 Real cover drive -14/-15 ms: bladeU 0.141 -> 0.149, bearing 54.1 -> 51.8 deg)
  // or speed tier (ref-1 Real 45 deg drive -11/-12 ms: 14.7 -> 21.2 m/s). Now an attacking swing first plans the same
  // stroke perfectly timed, then replays that plan's choices (contact location, face roll, aim, planted body and
  // speed) at its own timing; if the replay cannot be certified at that speed it keeps the same geometry at its
  // fastest certified line speed. Only a plan with no rigid anchor, or a replay that cannot be certified at any speed,
  // falls through to the complete planner below.
  if (replayOnTimePlan && swing.kind === 'attack' && Math.abs(errorMs) > 1e-9) {
    const onTime = buildBatTrackAt(flight, { ...swing, startT: swing.startT - errorMs / 1000 }, opts, false);
    const anchor = TRACK_ANCHORS.get(onTime);
    if (anchor) {
      const replayed = replayAnchor(anchor);
      if (replayed) return replayed;
    }
  }

  // A high requested speed can be far beyond this bounded free-endpoint family's acceleration envelope. Test the
  // request once, then let the preferred legacy geometry derive a coherent lower seed. Only if it cannot derive one
  // do we spend the remaining generalized budget on the deterministic acceleration seed.
  const requestedBase = baseAtSpeed(requestedSpeed);
  const requestedPublicHookEligible = publicHookNodeEligible(requestedBase);
  const requestedPublicHook = planPublicHookStroke(
    requestedBase, nominalBody, domainFor(requestedBase), fallbackBudget,
  );
  if (requestedPublicHook) return requestedPublicHook;
  const requestedVerticalFallbackRecoveryEligible = verticalFallbackRecoveryEligible(requestedBase);
  const requestedProjectedVerticalEligible = projectedVerticalStrokeEligible(requestedBase);
  const requestedProjectedVertical = planProjectedVerticalStroke(
    requestedBase,
    nominalBody,
    domainFor(requestedBase),
    fallbackBudget,
  );
  if (requestedProjectedVertical) return requestedProjectedVertical;
  // A rejected public hook historically resolves through the null-path legacy planner. Run that same planner before
  // the broader generalized family so its existing face-hit/miss outcomes are retained inside the one shared ledger.
  const earlyRequestedPlanned = requestedPublicHookEligible
    ? planVisibleStroke(requestedBase, nominalBody, domainFor(requestedBase), fallbackBudget, false, true)
    : null;
  if (earlyRequestedPlanned?.track) return earlyRequestedPlanned.track;
  const attemptedGeneralizedSpeeds: number[] = [];
  const tryGeneralized = (
    base: BatTrack,
    workBudget: FallbackWorkBudget = fallbackBudget,
    candidateCreditLimit: number | null = null,
  ): BatTrack | null => {
    if (attemptedGeneralizedSpeeds.some((speed) => Math.abs(speed - base.speed) <= 1e-9)) return null;
    attemptedGeneralizedSpeeds.push(base.speed);
    return planGeneralizedStroke(base, nominalBody, domainFor(base), workBudget, candidateCreditLimit);
  };
  // The rejected preferred family has already paid the legacy body solve needed to derive this coherent speed.
  // A public hook replays its bounded compass completion; an outside-reach stroke replays the ordinary exact
  // root/crouch solver. If that coherent legacy family fails closed, generalized and safe-whiff paths retain their
  // authority under the same remaining ledger.
  if (earlyRequestedPlanned?.nextSpeed !== null && earlyRequestedPlanned?.nextSpeed !== undefined) {
    const achievedBase = baseAtSpeed(earlyRequestedPlanned.nextSpeed);
    const achievedPlanned = planVisibleStroke(
      achievedBase,
      nominalBody,
      domainFor(achievedBase),
      fallbackBudget,
      true,
    );
    if (achievedPlanned.track) return achievedPlanned.track;
    const achievedGeneralized = tryGeneralized(achievedBase);
    if (achievedGeneralized) return achievedGeneralized;
    const limit = limitStroke();
    if (limit) return limit;
    const whiff = safeWhiffTrack(achievedBase, nominalBody, fallbackBudget);
    if (whiff) return whiff;
    throw new Error(`No anatomy-safe corrected hook track (${shot.family}, requestedSpeed=${requestedSpeed}, achievedSpeed=${earlyRequestedPlanned.nextSpeed}, planned=${plannedContactT})`);
  }
  // A requested stroke already under the handle-speed cap retains the existing generalized-first authority, but its
  // one-location probe cannot spend the work needed by the requested-speed legacy body solve that follows a reject.
  // The bounded child ledger is debited from the one build-wide ledger, so no work disappears or gains a second cap.
  const requestedGeneralized = requestedBase.vLine <= BAT_GRIP_SPEED_LIMIT_MPS + 1e-9
    ? withFallbackWorkAllowance(
        fallbackBudget,
        LOWER_SPEED_GENERALIZED_WORK_ALLOWANCE,
        (bounded) => tryGeneralized(requestedBase, bounded),
      )
    : requestedProjectedVerticalEligible
      ? withFallbackWorkAllowance(
          fallbackBudget,
          PROJECTED_REJECT_GENERALIZED_WORK_ALLOWANCE,
          (bounded) => tryGeneralized(
            requestedBase,
            bounded,
            PROJECTED_REJECT_GENERALIZED_CANDIDATE_ALLOWANCE,
          ),
        )
      : requestedVerticalFallbackRecoveryEligible
        ? withFallbackWorkAllowance(
            fallbackBudget,
            PROJECTED_REJECT_GENERALIZED_WORK_ALLOWANCE,
            (bounded) => tryGeneralized(
              requestedBase,
              bounded,
              VERTICAL_RECOVERY_GENERALIZED_CANDIDATE_ALLOWANCE,
            ),
          )
      : tryGeneralized(
          requestedBase,
          fallbackBudget,
          len(requestedBase.shot.outside) > 1e-12
            ? HIGH_SPEED_GENERALIZED_CANDIDATE_ALLOWANCE
            : null,
        );
  if (requestedGeneralized) return requestedGeneralized;

  let verticalRequestedPlanned: VisibleStrokePlan | null = null;
  if (requestedVerticalFallbackRecoveryEligible) {
    verticalRequestedPlanned = planVisibleStroke(
      requestedBase, nominalBody, domainFor(requestedBase), fallbackBudget, false, true, false, true,
    );
    if (verticalRequestedPlanned.track) return verticalRequestedPlanned.track;
    if (verticalRequestedPlanned.nextSpeed !== null) {
      const achievedBase = baseAtSpeed(verticalRequestedPlanned.nextSpeed);
      // A vertical stroke played into the off-side half-plane first gets one bounded exact body replay at the
      // coherent speed. This preserves a quiet-body solution when it exists cheaply, while the fixed compass
      // completion below still owns cases that need broader root/crouch movement. The projected closed-face
      // leg-side domain skips this replay and retains its separately bounded nomination/refinement authority.
      const achievedExact = achievedBase.n.x >= 0
        ? withFallbackWorkAllowance(
            fallbackBudget,
            OFF_SIDE_VERTICAL_EXACT_REPLAY_WORK_ALLOWANCE,
            (bounded) => planVisibleStroke(
              achievedBase, nominalBody, domainFor(achievedBase), bounded,
            ).track,
          )
        : null;
      if (achievedExact) return achievedExact;
      const achievedPlanned = planVisibleStroke(
        achievedBase,
        nominalBody,
        domainFor(achievedBase),
        fallbackBudget,
        requestedVerticalFallbackRecoveryEligible,
        false,
        requestedVerticalFallbackRecoveryEligible,
      );
      if (achievedPlanned.track) return achievedPlanned.track;
      const achievedGeneralized = tryGeneralized(achievedBase);
      if (achievedGeneralized) return achievedGeneralized;
      const limit = limitStroke();
      if (limit) return limit;
      const whiff = safeWhiffTrack(achievedBase, nominalBody, fallbackBudget);
      if (whiff) return whiff;
      throw new Error(`No anatomy-safe corrected vertical track (${shot.family}, requestedSpeed=${requestedSpeed}, achievedSpeed=${verticalRequestedPlanned.nextSpeed}, planned=${plannedContactT})`);
    }
  }

  const probeSpeed = generalizedProbeSpeed(requestedBase);
  const highProbeEligible = requestedBase.vLine > BAT_GRIP_SPEED_LIMIT_MPS + 1e-9
    && probeSpeed < requestedSpeed - 1e-6;

  // One requested-speed legacy search owns the expensive body/root domain. If it discovers a lower physical ceiling,
  // rebuild once, try the bounded generalized family first, then allow one final coherent legacy search. This fixed
  // global budget prevents each correction speed from independently exhausting both planners.
  // A generalized high-speed search that cannot find a prepared path inside its first fixed candidate allowance
  // must leave enough of the shared ledger for the established outside-reach edge/pad authority. That legacy solve
  // derives one coherent lower speed before any corrected-speed generalized retry. Eligibility is pre-result
  // geometry only; no collision or score output is consulted.
  const legacyCeilingFirst = requestedBase.vLine > BAT_GRIP_SPEED_LIMIT_MPS + 1e-9
    && len(requestedBase.shot.outside) > 1e-12;
  const lowerSpeedCeilingAfterFirstLocation = requestedBase.vLine <= BAT_GRIP_SPEED_LIMIT_MPS + 1e-9;
  const requestedPlanned = earlyRequestedPlanned ?? verticalRequestedPlanned ?? planVisibleStroke(
    requestedBase,
    nominalBody,
    domainFor(requestedBase),
    fallbackBudget,
    false,
    legacyCeilingFirst,
    false,
    lowerSpeedCeilingAfterFirstLocation,
  );
  if (requestedPlanned.track) return requestedPlanned.track;
  let achievedSpeed = requestedSpeed;
  if (requestedPlanned.nextSpeed !== null) {
    // A still-high legacy ceiling means the requested miss was an acceleration/path-shape limitation rather than a
    // wholesale geometry collapse. In that case the deterministic high-leverage probe gets one chance before the
    // lower legacy rebuild; a near-zero ceiling skips an expensive, physically implausible high-speed retry.
    if (highProbeEligible && requestedPlanned.nextSpeed > BAT_GRIP_SPEED_LIMIT_MPS + 1e-9) {
      const probeBase = baseAtSpeed(probeSpeed);
      const probeGeneralized = tryGeneralized(probeBase);
      if (probeGeneralized) return probeGeneralized;
    }
    achievedSpeed = requestedPlanned.nextSpeed;
    const achievedBase = baseAtSpeed(achievedSpeed);
    const achievedLegacy = legacyCeilingFirst || lowerSpeedCeilingAfterFirstLocation
      ? planVisibleStroke(achievedBase, nominalBody, domainFor(achievedBase), fallbackBudget)
      : null;
    if (achievedLegacy?.track) return achievedLegacy.track;
    const achievedGeneralized = tryGeneralized(achievedBase);
    if (achievedGeneralized) return achievedGeneralized;
    let achievedPlanned = achievedLegacy ?? planVisibleStroke(
      achievedBase, nominalBody, domainFor(achievedBase), fallbackBudget,
    );
    if (achievedPlanned.track) return achievedPlanned.track;
    // The ceiling was found for the face solved at the higher speed; re-solving the face at the ceiling moves the
    // contact geometry, so the same anatomy can bind a little lower. Follow that refined ceiling (a pure function of
    // the pre-result geometry) a bounded number of times under the same ledger before giving up on the stroke.
    for (let refinement = 0; refinement < 3 && achievedPlanned.nextSpeed !== null
      && achievedPlanned.nextSpeed < achievedSpeed - 1e-6; refinement++) {
      achievedSpeed = achievedPlanned.nextSpeed;
      const refinedBase = baseAtSpeed(achievedSpeed);
      achievedPlanned = planVisibleStroke(refinedBase, nominalBody, domainFor(refinedBase), fallbackBudget);
      if (achievedPlanned.track) return achievedPlanned.track;
    }
  } else {
    if (probeSpeed < requestedSpeed - 1e-6) {
      achievedSpeed = probeSpeed;
      const probeBase = baseAtSpeed(probeSpeed);
      const probeGeneralized = tryGeneralized(probeBase);
      if (probeGeneralized) return probeGeneralized;
    }
  }

  const limit = limitStroke();
  if (limit) return limit;
  const base = baseAtSpeed(achievedSpeed);
  const whiff = safeWhiffTrack(base, nominalBody, fallbackBudget);
  if (whiff) return whiff;
  throw new Error(`No anatomy-safe stroke track (${shot.family}, requestedSpeed=${requestedSpeed}, achievedSpeed=${achievedSpeed}, planned=${plannedContactT})`);
}

/**
 * Anatomy-valid causal swing selected before collision. A single rigid twist accelerates continuously from rest,
 * reaches its full velocity at the exact planned pose, then decelerates to rest. There is no pre-result impulse or
 * kinematic branch at plannedContactT: misses, pad/body contacts and late blade contacts all see this same trajectory.
 */
export function zonePose(tr: BatTrack, t: number): BatPose {
  return collisionKinematicsAt(tr, t).pose;
}

/** The authoritative bat at any time: the same C1 swing is visible and collidable, followed by a held finish. */
export function batPose(tr: BatTrack, t: number): BatPose {
  if (t < tr.startT) return tr.stance;
  if (t <= tr.zoneOut) return zonePose(tr, t);
  return tr.finish;
}

/** End of the swing (follow-through complete). */
export function trackEndT(tr: BatTrack): number {
  return tr.zoneOut + FOLLOW_S;
}

/** Bat samples from the swing's start to the follow-through, every dt seconds. */
export function batSamples(tr: BatTrack, dt = 0.004): BatSample[] {
  const authorities = [...collisionPathAuthorities(tr), trackEndT(tr)]
    .filter((time, index, values) => time >= tr.startT - 1e-12
      && values.findIndex((value) => Math.abs(value - time) <= 1e-12) === index);
  const authorityGuard = Math.max(1e-12, dt * 0.25);
  const times = regularPresentationTimes(tr, dt)
    .filter((time) => authorities.every((authority) => Math.abs(time - authority) > authorityGuard));
  times.push(...authorities);
  times.sort((left, right) => left - right);
  const out = times.map((time) => freezeBatSample(time, batPose(tr, time)));
  return Object.freeze(out) as unknown as BatSample[];
}

function translatedPose(pose: BatPose, offset: Vec3, amount: number): BatPose {
  return {
    grip: v3(
      pose.grip.x + offset.x * amount,
      pose.grip.y + offset.y * amount,
      pose.grip.z + offset.z * amount,
    ),
    toe: v3(
      pose.toe.x + offset.x * amount,
      pose.toe.y + offset.y * amount,
      pose.toe.z + offset.z * amount,
    ),
    n: pose.n,
  };
}

/**
 * Dense deterministic certificate for a rigid translation segment. Exact contact may bind at zero; no interior may.
 * Every margin is a distance from a static body solid to a point of the translating bat, so between lattice samples i
 * and j it changes by at most |offset|·|j − i|/steps. Samples that this bound proves above −1e-10 are skipped: the
 * boolean is the dense 129-sample scan's (conservative advancement on the same lattice).
 */
function safeTranslation(tr: BatTrack, contact: BatPose, offset: Vec3): boolean {
  const steps = 128;
  const length = len(offset) * (1 + 1e-9);
  let i = 0;
  while (i <= steps) {
    const pose = translatedPose(contact, offset, i / steps);
    const gap = batPoseGapReach(pose, tr.body).gap;
    if (gap < -1e-10) return false;
    let next = i + 1;
    const slack = gap + 1e-10 - 1e-12;
    if (slack > 0 && Number.isFinite(length)) {
      while (next <= steps && length * (next - i) / steps <= slack) next++;
    }
    i = next;
  }
  return true;
}

function unitOrZero(value: Vec3): Vec3 {
  const magnitude = len(value);
  return magnitude <= 1e-12 ? v3(0, 0, 0) : v3(value.x / magnitude, value.y / magnitude, value.z / magnitude);
}

/**
 * A translation direction that opens every anatomical margin within 10 mm of binding: the normalised sum of each such
 * margin's unit gradient (central differences, 0.1 mm), so moving along it increases all of them to first order.
 * Basic arithmetic and sqrt only; zero when no margin is near binding or the gradients cancel.
 */
function marginAscent(tr: BatTrack, contact: BatPose): Vec3 {
  const h = 1e-4;
  const margins = (dx: number, dy: number, dz: number): number[] => {
    const value = batPoseAdmissibility(translatedPose(contact, v3(dx, dy, dz), 1), tr.body);
    return [value.reachGap, value.helmetGap, value.neckGap, value.torsoGap, value.padGap, value.toeGap];
  };
  const at = margins(0, 0, 0);
  const px = margins(h, 0, 0);
  const mx = margins(-h, 0, 0);
  const py = margins(0, h, 0);
  const my = margins(0, -h, 0);
  const pz = margins(0, 0, h);
  const mz = margins(0, 0, -h);
  let sum = v3(0, 0, 0);
  for (let i = 0; i < at.length; i++) {
    if (!(at[i] < 0.01)) continue;
    const gradient = unitOrZero(v3((px[i] - mx[i]) / (2 * h), (py[i] - my[i]) / (2 * h), (pz[i] - mz[i]) / (2 * h)));
    sum = v3(sum.x + gradient.x, sum.y + gradient.y, sum.z + gradient.z);
  }
  return unitOrZero(sum);
}

/**
 * A deterministic safe direction away from the binding anatomical surface, with shot-family directions tried for
 * visual intent before conservative fallbacks. Every accepted candidate is certified back to the exact contact pose.
 */
function presentationOffsets(tr: BatTrack, contact: BatPose, maximum: number, afterContact: boolean): Vec3[] {
  if (!(maximum > 1e-6)) return [];
  const anatomy = batPoseAdmissibility(contact, tr.body);
  if (anatomy.gap < -1e-10) return [];
  const side = followThroughSide(tr.shot);
  const centre = v3(
    (contact.grip.x + contact.toe.x) / 2,
    (contact.grip.y + contact.toe.y) / 2,
    (contact.grip.z + contact.toe.z) / 2,
  );
  const awayFromHead = unitOrZero(v3(
    centre.x - tr.body.head.c.x,
    centre.y - tr.body.head.c.y,
    centre.z - tr.body.head.c.z,
  ));
  const relieveReach = unitOrZero(v3(
    tr.body.torso.b.x - contact.grip.x,
    0,
    tr.body.torso.b.z - contact.grip.z,
  ));
  const intended = afterContact
    ? unitOrZero(v3(side * 0.8, 0.5, -0.2))
    : unitOrZero(v3(-side * 0.2, 0.45, 0.87));
  const candidates = [
    intended,
    relieveReach,
    awayFromHead,
    v3(0, 1, 0),
    v3(side, 0, 0),
    v3(-side, 0, 0),
    v3(0, 0, 1),
    v3(0, 0, -1),
  ];
  const offsets: Vec3[] = [];
  for (const direction of candidates) {
    if (len(direction) <= 1e-12) continue;
    for (const scale of [1, 0.75, 0.5, 0.25, 0.125]) {
      const offset = v3(direction.x * maximum * scale, direction.y * maximum * scale, direction.z * maximum * scale);
      if (safeTranslation(tr, contact, offset)) {
        offsets.push(offset);
        if (offsets.length >= 12) return offsets;
      }
    }
  }
  if (offsets.length > 0) return offsets;
  // A contact on the anatomical boundary (the bat a fraction of a millimetre from the torso with the arms nearly
  // straight) leaves none of the fixed directions above inside the safe set at even 1/8 of the leg. Recoil along the
  // direction that opens every nearly binding margin at once, in steps down to 1/256 of the leg.
  const away = marginAscent(tr, contact);
  if (len(away) > 1e-12) {
    for (let scale = 1; scale >= 1 / 256; scale /= 2) {
      const offset = v3(away.x * maximum * scale, away.y * maximum * scale, away.z * maximum * scale);
      if (safeTranslation(tr, contact, offset)) {
        offsets.push(offset);
        break;
      }
    }
  }
  return offsets;
}

function poseAxis(pose: BatPose): Vec3 {
  return norm(v3(pose.grip.x - pose.toe.x, pose.grip.y - pose.toe.y, pose.grip.z - pose.toe.z));
}

/**
 * The C1 bat-speed profile through contact. `d` is the time from planned contact (0 at contact, `ramp` at the
 * ramp's far end). Smoothstep: the rate falls 1 → 0 as 1 − 3s² + 2s³ (s = d/ramp), so its slope is zero both at
 * contact (a smooth, held peak) and at the ramp's end. The full-ramp travel is ramp/2, exactly as the old linear
 * "tent", and the peak acceleration is RAMP_PEAK_FACTOR × rate/ramp at s = 1/2.
 */
const RAMP_PEAK_FACTOR = 1.5;
/** max |d²(rate)/dt²| × ramp²: the profile's own jerk, for the continuous certificate. */
const RAMP_JERK_FACTOR = 6;
function rampRate(d: number, ramp: number): number {
  const s = d / ramp;
  return 1 - s * s * (3 - 2 * s);
}
function rampIntegral(d: number, ramp: number): number {
  const s = d / ramp;
  return d - ramp * s * s * s * (1 - s / 2);
}
/** d(rate)/d(d): ≤ 0, minimum −RAMP_PEAK_FACTOR/ramp at s = 1/2. */
function rampSlope(d: number, ramp: number): number {
  const s = d / ramp;
  return -6 * s * (1 - s) / ramp;
}

function collisionProgress(tr: BatTrack, t: number): { amountS: number; rate: number; rateDerivative: number } {
  const before = Math.max(1e-9, tr.plannedContactT - tr.zoneIn);
  if (t <= tr.zoneIn) return { amountS: -before / 2, rate: 0, rateDerivative: 0 };
  if (t <= tr.plannedContactT) {
    const d = clamp(tr.plannedContactT - t, 0, before);
    return { amountS: -rampIntegral(d, before), rate: rampRate(d, before), rateDerivative: -rampSlope(d, before) };
  }
  const after = Math.max(1e-9, tr.zoneOut - tr.plannedContactT);
  if (t < tr.zoneOut) {
    const d = clamp(t - tr.plannedContactT, 0, after);
    return { amountS: rampIntegral(d, after), rate: rampRate(d, after), rateDerivative: rampSlope(d, after) };
  }
  return { amountS: after / 2, rate: 0, rateDerivative: 0 };
}

/**
 * vec.rotate (Rodrigues) with its cosine and sine supplied: identical arithmetic in the identical order, so a group of
 * vectors turned about one axis by one angle pays for the polynomial dcos/dsin once (bit-identical to rotate()).
 */
function rotateCS(v: Vec3, k: Vec3, c: number, s: number): Vec3 {
  const kvx = k.y * v.z - k.z * v.y;
  const kvy = k.z * v.x - k.x * v.z;
  const kvz = k.x * v.y - k.y * v.x;
  const kd = (k.x * v.x + k.y * v.y + k.z * v.z) * (1 - c);
  return { x: v.x * c + kvx * s + k.x * kd, y: v.y * c + kvy * s + k.y * kd, z: v.z * c + kvz * s + k.z * kd };
}

/** Pose on the one rigid screw used by the authoritative collision swing. `amountS` has units of seconds. */
function twistPose(anchor: BatPose, twist: BatRigidTwist, amountS: number): BatPose {
  const angularSpeed = len(twist.angularVelocity);
  const rotationAxis = angularSpeed > 1e-12
    ? v3(twist.angularVelocity.x / angularSpeed, twist.angularVelocity.y / angularSpeed, twist.angularVelocity.z / angularSpeed)
    : UP;
  const angle = angularSpeed * amountS;
  const cosine = dcos(angle);
  const sine = dsin(angle);
  const a = rotateCS(poseAxis(anchor), rotationAxis, cosine, sine);
  const n = rotateCS(anchor.n, rotationAxis, cosine, sine);
  const grip = v3(
    anchor.grip.x + twist.gripVelocity.x * amountS,
    anchor.grip.y + twist.gripVelocity.y * amountS,
    anchor.grip.z + twist.gripVelocity.z * amountS,
  );
  return { grip, toe: v3(grip.x - a.x * BAT_FULL, grip.y - a.y * BAT_FULL, grip.z - a.z * BAT_FULL), n };
}

function addVec(left: Vec3, right: Vec3): Vec3 {
  return v3(left.x + right.x, left.y + right.y, left.z + right.z);
}

function subVec(left: Vec3, right: Vec3): Vec3 {
  return v3(left.x - right.x, left.y - right.y, left.z - right.z);
}

function scaleVec(value: Vec3, scale: number): Vec3 {
  return v3(value.x * scale, value.y * scale, value.z * scale);
}

function shoulderSphereSideKinematics(
  path: ShoulderSphereCollisionPath,
  side: 'pre' | 'post',
  fromContactS: number,
  leftLimit = false,
): BatCollisionKinematics {
  const primitive = path[side];
  const direction = side === 'pre' ? -1 : 1;
  const handX = clamp(fromContactS, 0, primitive.handRampS);
  const handAngle = direction * path.anchorRateRadps * rampIntegral(handX, primitive.handRampS);
  const handSpeed = fromContactS < primitive.handRampS
    ? path.anchorRateRadps * rampRate(fromContactS, primitive.handRampS)
    : 0;
  const handAcceleration = fromContactS < primitive.handRampS
    || (leftLimit && Math.abs(fromContactS - primitive.handRampS) <= 1e-12)
    ? direction * path.anchorRateRadps * rampSlope(handX, primitive.handRampS)
    : 0;
  const anchorRadius = rotate(path.anchorRadius, path.anchorAxis, handAngle);
  const anchorHand = addVec(path.anchorShoulder, anchorRadius);
  const anchorOmega = scaleVec(path.anchorAxis, handSpeed);
  const anchorAlpha = scaleVec(path.anchorAxis, handAcceleration);
  const anchorVelocity = cross(anchorOmega, anchorRadius);
  const anchorAcceleration = addVec(
    cross(anchorAlpha, anchorRadius),
    cross(anchorOmega, cross(anchorOmega, anchorRadius)),
  );

  const angularX = clamp(fromContactS, 0, primitive.angularRampS);
  const baseAngle = direction * path.angularRateRadps * rampIntegral(angularX, primitive.angularRampS);
  const baseSpeed = fromContactS < primitive.angularRampS
    ? path.angularRateRadps * rampRate(fromContactS, primitive.angularRampS)
    : 0;
  const baseAcceleration = fromContactS < primitive.angularRampS
    || (leftLimit && Math.abs(fromContactS - primitive.angularRampS) <= 1e-12)
    ? direction * path.angularRateRadps * rampSlope(angularX, primitive.angularRampS)
    : 0;
  const baseCos = dcos(baseAngle);
  const baseSin = dsin(baseAngle);
  const baseAxis = rotateCS(path.contactAxis, path.angularAxis, baseCos, baseSin);
  const baseNormal = rotateCS(path.contactNormal, path.angularAxis, baseCos, baseSin);
  const baseOmega = scaleVec(path.angularAxis, baseSpeed);
  const baseAlpha = scaleVec(path.angularAxis, baseAcceleration);

  const u = clamp(fromContactS / primitive.durationS, 0, 1);
  const u2 = u * u;
  const oneMinusU = 1 - u;
  const q = u2 * u * (10 - 15 * u + 6 * u2);
  const q1 = 30 * u2 * oneMinusU * oneMinusU;
  const q2 = 60 * u * oneMinusU * (1 - 2 * u);
  const correctionAngle = primitive.correctionAngleRad * q;
  const correctionOmega = scaleVec(
    primitive.correctionAxis,
    direction * primitive.correctionAngleRad * q1 / primitive.durationS,
  );
  const correctionAlpha = scaleVec(
    primitive.correctionAxis,
    primitive.correctionAngleRad * q2 / (primitive.durationS * primitive.durationS),
  );
  const correctionCos = dcos(correctionAngle);
  const correctionSin = dsin(correctionAngle);
  const axis = rotateCS(baseAxis, primitive.correctionAxis, correctionCos, correctionSin);
  const normal = rotateCS(baseNormal, primitive.correctionAxis, correctionCos, correctionSin);
  const rotatedOmega = rotateCS(baseOmega, primitive.correctionAxis, correctionCos, correctionSin);
  const rotatedAlpha = rotateCS(baseAlpha, primitive.correctionAxis, correctionCos, correctionSin);
  const angularVelocity = addVec(correctionOmega, rotatedOmega);
  const angularAcceleration = addVec(
    addVec(correctionAlpha, rotatedAlpha),
    cross(correctionOmega, rotatedOmega),
  );
  const handToGrip = scaleVec(axis, path.anchorHandFromCapM);
  const grip = addVec(anchorHand, handToGrip);
  const gripVelocity = addVec(anchorVelocity, cross(angularVelocity, handToGrip));
  const gripAcceleration = addVec(
    anchorAcceleration,
    addVec(
      cross(angularAcceleration, handToGrip),
      cross(angularVelocity, cross(angularVelocity, handToGrip)),
    ),
  );
  return {
    pose: {
      grip,
      toe: subVec(grip, scaleVec(axis, BAT_FULL)),
      n: normal,
    },
    gripVelocity,
    gripAcceleration,
    angularVelocity,
    angularAcceleration,
  };
}

function freeGripSo3SideKinematics(
  path: FreeGripSo3CollisionPath,
  twist: BatRigidTwist,
  side: 'pre' | 'post',
  fromContactS: number,
  leftLimit = false,
): BatCollisionKinematics {
  const primitive = path[side];
  const direction = side === 'pre' ? -1 : 1;
  const distance = clamp(fromContactS, 0, primitive.durationS);
  const rampState = (rampS: number): { integralS: number; rate: number; accelerationRate: number } => {
    if (distance > rampS || (distance === rampS && !leftLimit)) {
      return { integralS: rampS / 2, rate: 0, accelerationRate: 0 };
    }
    return {
      integralS: rampIntegral(distance, rampS),
      rate: rampRate(distance, rampS),
      accelerationRate: direction * rampSlope(distance, rampS),
    };
  };
  const hand = rampState(primitive.handRampS);
  const angular = rampState(primitive.angularRampS);
  const u = clamp(distance / primitive.durationS, 0, 1);
  const u2 = u * u;
  const oneMinusU = 1 - u;
  const q = u2 * u * (10 - 15 * u + 6 * u2);
  const q1 = 30 * u2 * oneMinusU * oneMinusU;
  const q2 = 60 * u * oneMinusU * (1 - 2 * u);

  const spinAxis = len(twist.angularVelocity) > 1e-12 ? norm(twist.angularVelocity) : UP;
  const spinAngle = direction * len(twist.angularVelocity) * angular.integralS;
  const spinCos = dcos(spinAngle);
  const spinSin = dsin(spinAngle);
  const baseAxis = rotateCS(poseAxis(path.contact), spinAxis, spinCos, spinSin);
  const baseNormal = rotateCS(path.contact.n, spinAxis, spinCos, spinSin);
  const baseOmega = scaleVec(twist.angularVelocity, angular.rate);
  const baseAlpha = scaleVec(twist.angularVelocity, angular.accelerationRate);
  const grip = addVec(
    addVec(path.contact.grip, scaleVec(twist.gripVelocity, direction * hand.integralS)),
    scaleVec(primitive.gripEndpointCorrectionM, q),
  );
  const gripVelocity = addVec(
    scaleVec(twist.gripVelocity, hand.rate),
    scaleVec(primitive.gripEndpointCorrectionM, direction * q1 / primitive.durationS),
  );
  const gripAcceleration = addVec(
    scaleVec(twist.gripVelocity, hand.accelerationRate),
    scaleVec(primitive.gripEndpointCorrectionM, q2 / (primitive.durationS * primitive.durationS)),
  );

  const correctionMagnitude = len(primitive.orientationRotationVectorRad);
  const correctionAxis = correctionMagnitude > 1e-12
    ? scaleVec(primitive.orientationRotationVectorRad, 1 / correctionMagnitude)
    : UP;
  const correctionAngle = correctionMagnitude * q;
  const correctionOmega = scaleVec(
    correctionAxis,
    direction * correctionMagnitude * q1 / primitive.durationS,
  );
  const correctionAlpha = scaleVec(
    correctionAxis,
    correctionMagnitude * q2 / (primitive.durationS * primitive.durationS),
  );
  const correctionCos = dcos(correctionAngle);
  const correctionSin = dsin(correctionAngle);
  const axis = rotateCS(baseAxis, correctionAxis, correctionCos, correctionSin);
  const normal = rotateCS(baseNormal, correctionAxis, correctionCos, correctionSin);
  const rotatedOmega = rotateCS(baseOmega, correctionAxis, correctionCos, correctionSin);
  const rotatedAlpha = rotateCS(baseAlpha, correctionAxis, correctionCos, correctionSin);
  const angularVelocity = addVec(correctionOmega, rotatedOmega);
  const angularAcceleration = addVec(
    addVec(correctionAlpha, rotatedAlpha),
    cross(correctionOmega, rotatedOmega),
  );
  return {
    pose: { grip, toe: subVec(grip, scaleVec(axis, BAT_FULL)), n: normal },
    gripVelocity,
    gripAcceleration,
    angularVelocity,
    angularAcceleration,
  };
}

function collisionPathSideKinematics(
  path: BatCollisionPath,
  twist: BatRigidTwist,
  side: 'pre' | 'post',
  fromContactS: number,
  leftLimit = false,
): BatCollisionKinematics {
  return path.kind === 'free-grip-so3'
    ? freeGripSo3SideKinematics(path, twist, side, fromContactS, leftLimit)
    : shoulderSphereSideKinematics(path, side, fromContactS, leftLimit);
}

/** Exact O(1) kinematics for the one authoritative C1 bat path. */
export function collisionKinematicsAt(tr: BatTrack, t: number): BatCollisionKinematics {
  if (tr.collisionPath) {
    const fromContactS = Math.abs(t - tr.plannedContactT);
    return collisionPathSideKinematics(
      tr.collisionPath,
      tr.collisionTwist,
      t <= tr.plannedContactT ? 'pre' : 'post',
      fromContactS,
    );
  }
  const progress = collisionProgress(tr, t);
  const pose = twistPose(poseFromSweet(tr.sweet, tr.n, tr.a), tr.collisionTwist, progress.amountS);
  const angularVelocity = scaleVec(tr.collisionTwist.angularVelocity, progress.rate);
  const gripVelocity = scaleVec(tr.collisionTwist.gripVelocity, progress.rate);
  return {
    pose,
    gripVelocity,
    gripAcceleration: scaleVec(tr.collisionTwist.gripVelocity, progress.rateDerivative),
    angularVelocity,
    angularAcceleration: scaleVec(tr.collisionTwist.angularVelocity, progress.rateDerivative),
  };
}

function collisionPathAuthorities(tr: BatTrack): number[] {
  const path = tr.collisionPath;
  const times = path
    ? [
        tr.zoneIn,
        tr.plannedContactT - path.pre.angularRampS,
        tr.plannedContactT - path.pre.handRampS,
        tr.plannedContactT,
        tr.plannedContactT + path.post.handRampS,
        tr.plannedContactT + path.post.angularRampS,
        tr.zoneOut,
      ]
    : [tr.zoneIn, tr.plannedContactT, tr.zoneOut];
  return times
    .filter((time) => time >= tr.startT - 1e-12 && time <= tr.zoneOut + 1e-12)
    .sort((left, right) => left - right)
    .filter((time, index, values) => index === 0 || Math.abs(time - values[index - 1]) > 1e-12);
}

/** Exact instantaneous velocity of a bat-fixed world point on the causal pre-result swing. */
export function batPointVelocity(tr: BatTrack, t: number, point: Vec3): Vec3 {
  const kinematics = collisionKinematicsAt(tr, t);
  const pose = kinematics.pose;
  const omega = kinematics.angularVelocity;
  const radius = v3(point.x - pose.grip.x, point.y - pose.grip.y, point.z - pose.grip.z);
  const rotational = cross(omega, radius);
  return v3(
    kinematics.gripVelocity.x + rotational.x,
    kinematics.gripVelocity.y + rotational.y,
    kinematics.gripVelocity.z + rotational.z,
  );
}

/** Exact rigid screw from an anchor: translation plus one proper rotation applied to both blade axis and face. */
function motionPose(anchor: BatPose, motion: PresentationMotion, amount: number): BatPose {
  const t = clamp(amount, 0, 1);
  const motionCos = dcos(motion.angle * t);
  const motionSin = dsin(motion.angle * t);
  const a = rotateCS(poseAxis(anchor), motion.rotationAxis, motionCos, motionSin);
  const n = rotateCS(anchor.n, motion.rotationAxis, motionCos, motionSin);
  const grip = v3(
    anchor.grip.x + motion.offset.x * t,
    anchor.grip.y + motion.offset.y * t,
    anchor.grip.z + motion.offset.z * t,
  );
  return {
    grip,
    toe: v3(grip.x - a.x * BAT_FULL, grip.y - a.y * BAT_FULL, grip.z - a.z * BAT_FULL),
    n,
  };
}

function safeMotion(tr: BatTrack, anchor: BatPose, motion: PresentationMotion): boolean {
  // 0.5 ms-equivalent dense certification at the shortest production leg, plus independent runtime interpolation
  // tests. Exact contact may bind at zero; every authored interior point must stay inside the same continuous gap.
  const steps = 192;
  for (let i = 0; i <= steps; i++) {
    if (batPoseGapReach(motionPose(anchor, motion, i / steps), tr.body).gap < -1e-10) return false;
  }
  return true;
}

function motionAxes(tr: BatTrack, anchor: BatPose): Vec3[] {
  const a = poseAxis(anchor);
  const width = norm(cross(a, anchor.n));
  switch (tr.shot.family) {
    case 'cut':
    case 'pull':
    case 'hook':
    case 'square_drive':
    case 'steer':
      return [anchor.n, UP, width];
    case 'flick':
    case 'glance':
    case 'on_drive':
    case 'back_on_punch':
      return [width, anchor.n, UP];
    default:
      return [anchor.n, width, UP];
  }
}

/** Deterministically choose a visible, family-directed and continuously safe rigid motion from one anchor pose. */
function presentationMotion(
  tr: BatTrack,
  anchor: BatPose,
  maximumDistance: number,
  maximumAngle: number,
  afterAnchor: boolean,
): PresentationMotion | null {
  const offsets = presentationOffsets(tr, anchor, maximumDistance, afterAnchor);
  if (offsets.length === 0 || maximumAngle < 1e-4) return null;
  const side = followThroughSide(tr.shot);
  const preferredSign = afterAnchor ? side : -side;
  for (const rotationAxis of motionAxes(tr, anchor)) {
    for (const sign of [preferredSign, -preferredSign]) {
      for (const angleScale of [1, 0.75, 0.5, 0.25, 0.125, 0.0625, 0.03125, 0.015625]) {
        for (const offset of offsets) {
          const motion = { offset, rotationAxis, angle: sign * maximumAngle * angleScale };
          if (safeMotion(tr, anchor, motion)) return motion;
        }
      }
    }
  }
  return null;
}

function freezeBatSample(t: number, pose: BatPose): BatSample {
  const grip = Object.freeze({ x: pose.grip.x, y: pose.grip.y, z: pose.grip.z });
  const toe = Object.freeze({ x: pose.toe.x, y: pose.toe.y, z: pose.toe.z });
  const face = Object.freeze({ x: pose.n.x, y: pose.n.y, z: pose.n.z });
  return Object.freeze({ t, grip, toe, face });
}

function regularPresentationTimes(tr: BatTrack, dt: number): number[] {
  const end = trackEndT(tr);
  const times: number[] = [];
  const count = Math.ceil((end - tr.startT) / dt);
  for (let i = 0; i <= count; i++) {
    const time = tr.startT + i * dt;
    if (time < end) times.push(time);
  }
  if (times.at(-1)! < end) times.push(end);
  return times;
}

/**
 * Build the immutable visible-bat channel for one admitted blade/handle contact. Collision and scoring keep using the
 * same canonical C1 swing through the exact collision pose at `decisiveT`. Only after that knot does the physical
 * impulse authorize a new safe contact-local follow-through. Proper rigid rotation plus translation preserves Law-5
 * length, face orthogonality and exact contact authority.
 *
 * `null` is a planner invariant failure: gameplay collision never depends on presentation authoring, so strike fails
 * loudly instead of silently changing or suppressing an already-authoritative blade/handle outcome.
 */
export function presentationBatSamples(tr: BatTrack, decisiveT: number, dt = 0.004): BatSample[] | null {
  // The collision sweep admits a bat only on [startT, trackEndT], so a hit may sit exactly on either end.
  const end = Math.max(trackEndT(tr), decisiveT);
  if (!Number.isFinite(decisiveT) || !Number.isFinite(dt) || dt <= 0 || decisiveT < tr.startT) return null;
  const contact = batPose(tr, decisiveT);
  if (batPoseGapReach(contact, tr.body).gap < -1e-10) return null;

  const afterDuration = end - decisiveT;
  // Before the impulse, presentation is exactly the authoritative causal collision swing. Only the physical bat/ball
  // impulse may reset the visible tangent. The authored post-contact branch is separately bounded and certified.
  const afterDistance = Math.min(0.18, (8 / 1.875) * afterDuration, (60 / 5.78) * afterDuration * afterDuration);
  const semanticAngle = tr.kind === 'defend' ? 0.12 : tr.horizontal >= 0.5 ? 0.32 : 0.25;
  const afterAngle = Math.min(semanticAngle, (8 / 1.875) * afterDuration, (80 / 5.78) * afterDuration * afterDuration);
  // When no certified motion leaves this contact pose (or no time remains), the bat is held where the impulse met it:
  // the admissible contact pose itself, so the trace always exists. A blade/handle hit can only occur at an
  // admissible pose (the collision gate), so this is reached only on the anatomical boundary.
  const held: PresentationMotion = { offset: v3(0, 0, 0), rotationAxis: UP, angle: 0 };
  const finish = afterDuration > 0 ? presentationMotion(tr, contact, afterDistance, afterAngle, true) ?? held : held;

  const authorityGuard = Math.max(1e-12, dt * 0.25);
  // plannedContactT is the authored velocity peak/body-motion anchor on every trace. Preserve it even when the real
  // ball hits earlier and the visible bat has already branched. A zone-out before a very late hit is also a canonical
  // acceleration breakpoint. Both are ordinary smooth knots; `decisiveT` remains the only contact-impulse knot.
  const authorities = [decisiveT];
  for (const time of collisionPathAuthorities(tr).filter((authority) => authority < decisiveT - 1e-12)) {
    if (time > tr.startT + 1e-12 && time < end - 1e-12
      && authorities.every((authority) => Math.abs(authority - time) > 1e-12)) authorities.push(time);
  }
  // The bridge trace contract always carries the authored planned-contact authority. After an early physical hit it
  // is a sample of the post-impulse branch—not a claim that the pre-impact bat kept moving—so validators can bind the
  // same semantic knot without smearing it through interpolation.
  if (tr.plannedContactT > decisiveT + 1e-12 && tr.plannedContactT < end - 1e-12
    && authorities.every((authority) => Math.abs(authority - tr.plannedContactT) > 1e-12)) {
    authorities.push(tr.plannedContactT);
  }
  if (end > decisiveT + 1e-12) authorities.push(end);
  const times: number[] = [];
  const count = Math.ceil((end - tr.startT) / dt);
  for (let i = 0; i <= count; i++) {
    const time = tr.startT + i * dt;
    if (time < end && authorities.every((authority) => Math.abs(time - authority) > authorityGuard)) times.push(time);
  }
  times.push(...authorities);
  times.sort((left, right) => left - right);
  // PHYS2 phase 5b: every run between two consecutive authority knots that is at least 1 ms long carries at least three
  // knots inside it, evenly spaced when the regular grid leaves fewer. Each run is one smooth piece of the swing (a
  // quartic in time on a rigid screw, a polynomial branch after the impulse), and the presented reconstruction
  // (render3d/practice/frame.ts batAt: quintic Hermite from five-knot polynomial derivatives) reproduces it exactly only
  // when the run has five knots. Near an authority the 4 ms grid could leave two or three, and the reconstruction then
  // missed the swing by micrometres where the planted body is at its clearance.
  const breaks = [tr.startT, ...authorities].sort((left, right) => left - right);
  for (let index = 1; index < breaks.length; index++) {
    const from = breaks[index - 1];
    const to = breaks[index];
    if (!(to - from >= 0.001)) continue;
    const inside = times.filter((time) => time > from && time < to);
    if (inside.length >= 3) continue;
    for (const time of inside) times.splice(times.indexOf(time), 1);
    for (let step = 1; step <= 3; step++) times.push(from + ((to - from) * step) / 4);
  }
  times.sort((left, right) => left - right);

  const out = times.map((time) => {
    if (time === decisiveT) return freezeBatSample(time, contact);
    if (time < decisiveT) return freezeBatSample(time, batPose(tr, time));
    const u = clamp((time - decisiveT) / afterDuration, 0, 1);
    return freezeBatSample(time, motionPose(contact, finish, smooth01(u)));
  });
  for (let i = 1; i < out.length; i++) if (!(out[i].t > out[i - 1].t)) return null;
  return Object.freeze(out) as unknown as BatSample[];
}
