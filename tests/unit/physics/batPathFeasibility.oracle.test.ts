// @vitest-environment node
/**
 * Manual feasibility oracle for the post-sim-v3 generalized rigid-bat path.
 *
 * This file is intentionally excluded from normal CI (`VANDE_BAT_PATH_ORACLE=1` is required). It does not change
 * gameplay. The eventual production path may only be implemented after this oracle finds a fully capped,
 * anatomy-admitted witness for the locked CTL4/EX2 cases.
 */
import { describe, expect, it } from 'vitest';
import type { BallFlight, NormalizedSwing } from '@/contracts/practice';
import type { BatPose, BatterBody } from '@/physics/bat';
import {
  BAT_ANGULAR_ACCEL_LIMIT_RADPS2,
  BAT_ANGULAR_SPEED_LIMIT_RADPS,
  BAT_GRIP_ACCEL_LIMIT_MPS2,
  BAT_GRIP_SPEED_LIMIT_MPS,
  BAT_POINT_ACCEL_LIMIT_MPS2,
  BAT_POINT_SPEED_LIMIT_MPS,
  batTravelMs,
  batterBody,
  bladeAxis,
  bladeFrom,
  buildBatTrack,
  incomingSpin,
  solveFace,
} from '@/physics/bat';
import {
  applyBatterPosture,
  BAT_HAND_REACH_SOLVE_M,
  batterShoulders,
  batPoseAdmissibility,
  solveBatterRootOffsetForPoses,
  translateBatterBody,
} from '@/physics/admissibility';
import {
  BALL_R,
  BLADE_HALF_W,
  BLADE_L,
  BLADE_T,
  DRIFT_M_PER_MS,
  GLOVE_R,
  HANDLE_L,
  LOWER_HAND_FROM_CAP,
  SWEET_U,
  TOP_HAND_FROM_CAP,
} from '@/physics/constants';
import { type Vec3, DEG, clamp, cross, datan2, dist, dot, len, norm, rotate, scale, sub, v3 } from '@/physics/vec';
import { flight as makeFlight } from '@/physics/delivery';
import { referenceLength } from '@/input/normalize';
import { REFERENCE_OVER } from '@/practice/game';
import { SURFACES, play as playInput, strokeSamples } from '../input/fixtures';
import { fly, timedSwing } from './physics-helpers';

const ENABLED = process.env.VANDE_BAT_PATH_ORACLE === '1';
const DT = 0.0005;
const BAT_FULL = BLADE_L + HANDLE_L;

interface KinematicSample {
  t: number;
  pose: BatPose;
  gripV: Vec3;
  gripA: Vec3;
  omega: Vec3;
  alpha: Vec3;
}

interface ContactGeometry {
  pose: BatPose;
  point: Vec3;
  ballCentre: Vec3;
  desired: Vec3;
  authoredOmega: Vec3;
  body: BatterBody;
  beforeS: number;
  afterS: number;
  contactU: number;
  validContactLocation: boolean;
  label: string;
}

const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const addScaled = (a: Vec3, b: Vec3, s: number): Vec3 => v3(a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);

interface TargetBase {
  current: ReturnType<typeof buildBatTrack>;
  face: ReturnType<typeof solveFace>;
  n: Vec3;
  baseAxis: Vec3;
  facePoint: Vec3;
  body: BatterBody;
}

interface TargetSource {
  key: string;
  flight: BallFlight;
  swing: NormalizedSwing;
}

const targetBaseCache = new Map<string, TargetBase>();

function targetBaseFor(
  plan: { variation: 'stock' | 'yorker'; lengthM: number; lineM: number; speedKph: number },
  targetSpeed: number,
  label: string,
  swingInput: { power: number; elevation: number; directionDeg?: number },
  source?: TargetSource,
): TargetBase {
  const cacheKey = JSON.stringify({ plan, targetSpeed, label, swingInput, source: source?.key ?? null });
  const cached = targetBaseCache.get(cacheKey);
  if (cached) return cached;
  const flight = source?.flight ?? fly(plan, undefined, 'balanced', `bat-path-${label}`);
  const swing =
    source?.swing ??
    timedSwing(flight, 0, {
      kind: 'attack',
      directionDeg: swingInput.directionDeg ?? 0,
      elevation: swingInput.elevation,
      power: swingInput.power,
    });
  const current = buildBatTrack(flight, swing, { assist: 'real' });
  const face = solveFace(
    current.read.u,
    incomingSpin(flight, current.idealT),
    current.intendedBearing,
    current.targetElevation,
    current.kind,
    targetSpeed,
    current.balance,
  );
  const n = face.n;
  const facePoint = v3(
    current.contactAim.x - n.x * BALL_R,
    current.contactAim.y - n.y * BALL_R,
    current.contactAim.z - n.z * BALL_R,
  );
  const base = {
    current,
    face,
    n,
    baseAxis: bladeAxis(n, current.horizontal),
    facePoint,
    body: batterBody(current.footwork, flight),
  };
  targetBaseCache.set(cacheKey, base);
  return base;
}

function lockedControlSource(
  index: number,
  plan: { variation: 'stock'; lengthM: number; lineM: number; speedKph: number },
): TargetSource {
  const flight = makeFlight({
    plan,
    bowler: REFERENCE_OVER.bowler,
    conditions: 'balanced',
    seed: `input-system-ctl4-${index}`,
    handedness: 'right',
    ball: REFERENCE_OVER.ball,
  });
  const releasePerfMs = 50_000;
  const probePress = releasePerfMs + 300;
  const samples = strokeSamples({ lengthPx: 100, bearingDeg: 0, durationMs: 40, profile: 'linear' }, probePress);
  const probe = playInput(samples, { surface: SURFACES.phone, opts: { releasePerfMs } }).swing;
  if (!probe) throw new Error('locked CTL4 top-power gesture did not normalize');
  const anchorDelayMs = probe.startT * 1000 - (probePress - releasePerfMs);
  const press = releasePerfMs + flight.idealContactT * 1000 - batTravelMs(probe.kind, probe.power) - anchorDelayMs;
  const swing = playInput(
    samples.map((sample) => ({ ...sample, t: sample.t + press - probePress })),
    { surface: SURFACES.phone, opts: { releasePerfMs } },
  ).swing;
  if (!swing) throw new Error('locked CTL4 timed top-power gesture did not normalize');
  return { key: `input-system-ctl4-${index}/top-${referenceLength(SURFACES.phone)}`, flight, swing };
}

function driftForAxis(a: Vec3, n: Vec3, horizontal: number, directionDeg: number): Vec3 {
  let w = norm(cross(a, n));
  if (horizontal < 0.5) {
    if (w.x < 0) w = scale(w, -1);
    return directionDeg >= -15 ? w : scale(w, -1);
  }
  if (w.y < 0) w = scale(w, -1);
  return directionDeg < 0 ? w : scale(w, -1);
}

function targetGeometry(
  plan: { variation: 'stock' | 'yorker'; lengthM: number; lineM: number; speedKph: number },
  targetSpeed: number,
  label: string,
  swingInput: { power: number; elevation: number; directionDeg?: number } = { power: 1, elevation: 0.1 },
  requestedU = SWEET_U,
  axisRotationDeg = 0,
  source?: TargetSource,
  axisOverride?: Vec3,
): ContactGeometry {
  const base = targetBaseFor(plan, targetSpeed, label, swingInput, source);
  const { current, face, n, facePoint } = base;
  let a = axisOverride ?? rotate(base.baseAxis, n, (axisRotationDeg * Math.PI) / 180);
  if (current.horizontal < 0.5 && a.y < 0) a = scale(a, -1);
  let sweet = addScaled(facePoint, a, (SWEET_U - requestedU) * BLADE_L);
  let blade = bladeFrom(sweet, n, a);
  let toeShift = 0;
  if (blade.toe.y < 0.005 && a.y > 0.05) {
    toeShift = (0.005 - blade.toe.y) / a.y;
    sweet = addScaled(sweet, a, toeShift);
    blade = bladeFrom(sweet, n, a);
  }
  const contactU = requestedU - toeShift / BLADE_L;
  const u = norm(current.read.u);
  const drift = driftForAxis(a, n, current.horizontal, current.intendedBearing);
  // The locked CTL4/EX2 probes are ideally timed, for which the existing causal drift calibration is 1.08.
  const driftScale = 1.08;
  const requested = v3(
    -u.x * face.vLine +
      ((drift.x * DRIFT_M_PER_MS * 1000 * (len(current.read.u) + face.vLine)) / len(current.read.u)) * driftScale,
    -u.y * face.vLine +
      ((drift.y * DRIFT_M_PER_MS * 1000 * (len(current.read.u) + face.vLine)) / len(current.read.u)) * driftScale,
    -u.z * face.vLine +
      ((drift.z * DRIFT_M_PER_MS * 1000 * (len(current.read.u) + face.vLine)) / len(current.read.u)) * driftScale,
  );
  const axial = dot(requested, a);
  const desired = addScaled(requested, a, -axial);
  const widthAxis = norm(cross(a, n));
  const yaw = current.yawRate * 500 * DEG;
  const tilt = current.tiltRate * 500 * DEG;
  const authoredOmega = add(scale(a, yaw), scale(widthAxis, tilt));
  return {
    pose: { grip: blade.grip, toe: blade.toe, n },
    point: facePoint,
    ballCentre: current.contactAim,
    desired,
    authoredOmega,
    body: base.body,
    beforeS: current.plannedContactT - current.startT,
    // The current lowered-speed track may use a shorter collision ramp. The generalized oracle owns the authored
    // top-power follow-through window, which buildBatTrack defines as min(140 ms, travelMs).
    afterS: Math.max(0.08, Math.min(0.14, current.travelMs / 1000)),
    contactU,
    validContactLocation: blade.toe.y >= 0.005 - 1e-12 && contactU >= -1e-9 && contactU <= 1 + 1e-9,
    label: `${label}@${targetSpeed}/u${requestedU.toFixed(3)}/a${axisRotationDeg}`,
  };
}

function productionAxes(base: TargetBase): Vec3[] {
  const { current, n } = base;
  const shoulderTarget = v3(base.body.torso.b.x, base.body.torso.b.y - 0.08, base.body.torso.b.z);
  const fromContact = sub(shoulderTarget, current.shot.aim);
  const k = dot(fromContact, n);
  const projected = norm(addScaled(fromContact, n, -k));
  const out: Vec3[] = [];
  const append = (candidate: Vec3) => {
    const d = dot(candidate, n);
    let axis = norm(addScaled(candidate, n, -d));
    if (current.horizontal < 0.5 && axis.y < 0) axis = scale(axis, -1);
    if (current.horizontal < 0.5 ? axis.y < 0.5 : Math.abs(axis.y) > 0.5) return;
    if (out.some((value) => dot(value, axis) > 1 - 1e-10)) return;
    out.push(axis);
  };
  append(base.baseAxis);
  if (len(projected) > 0.5) append(projected);
  for (let degrees = 5; degrees <= 180; degrees += 5) {
    append(rotate(base.baseAxis, n, (degrees * Math.PI) / 180));
    append(rotate(base.baseAxis, n, (-degrees * Math.PI) / 180));
  }
  return out.sort(
    (left, right) =>
      Math.acos(clamp(dot(base.baseAxis, left), -1, 1)) - Math.acos(clamp(dot(base.baseAxis, right), -1, 1)),
  );
}

function productionContactGeometryCandidates(
  plan: { variation: 'stock' | 'yorker'; lengthM: number; lineM: number; speedKph: number },
  targetSpeed: number,
  label: string,
  swingInput: { power: number; elevation: number; directionDeg?: number },
  source: TargetSource,
): ContactGeometry[] {
  const base = targetBaseFor(plan, targetSpeed, label, swingInput, source);
  const us = Array.from({ length: 41 }, (_, index) => index / 40).sort(
    (left, right) => Math.abs(left - SWEET_U) - Math.abs(right - SWEET_U),
  );
  const axes = productionAxes(base);
  const candidates: ContactGeometry[] = [];
  for (const u of us) {
    for (let axisIndex = 0; axisIndex < axes.length; axisIndex++) {
      const value = targetGeometry(plan, targetSpeed, label, swingInput, u, 0, source, axes[axisIndex]);
      if (!value.validContactLocation) continue;
      candidates.push({ ...value, label: `${label}@${targetSpeed}/u${u.toFixed(3)}/axis${axisIndex}` });
    }
  }
  return candidates;
}

function contactGeometryCandidates(
  plan: { variation: 'stock' | 'yorker'; lengthM: number; lineM: number; speedKph: number },
  targetSpeed: number,
  label: string,
  swingInput: { power: number; elevation: number; directionDeg?: number } = { power: 1, elevation: 0.1 },
): ContactGeometry[] {
  const us = [SWEET_U, ...Array.from({ length: 11 }, (_, index) => index / 10)]
    .filter((value, index, values) => values.findIndex((other) => Math.abs(other - value) < 1e-12) === index)
    .sort((left, right) => Math.abs(left - SWEET_U) - Math.abs(right - SWEET_U));
  const angles = [0, 15, -15, 30, -30, 45, -45, 60, -60, 75, -75, 90, -90, 120, -120, 180];
  const candidates: ContactGeometry[] = [];
  for (const u of us) {
    for (const angle of angles) {
      const geometry = targetGeometry(plan, targetSpeed, label, swingInput, u, angle);
      const axis = norm(sub(geometry.pose.grip, geometry.pose.toe));
      if (axis.y < 0.5) continue;
      if (geometry.pose.toe.y < 0.005 - 1e-12) continue;
      if (!geometry.validContactLocation) continue;
      candidates.push(geometry);
    }
  }
  return candidates;
}

function frame(pose: BatPose): { a: Vec3; n: Vec3; w: Vec3 } {
  const a = norm(sub(pose.grip, pose.toe));
  const n = norm(addScaled(pose.n, a, -dot(pose.n, a)));
  return { a, n, w: cross(a, n) };
}

function advancePose(pose: BatPose, gripDelta: Vec3, omega: Vec3, dt: number): BatPose {
  const speed = len(omega);
  const a0 = norm(sub(pose.grip, pose.toe));
  const a = speed > 0 ? rotate(a0, scale(omega, 1 / speed), speed * dt) : a0;
  const n = speed > 0 ? rotate(pose.n, scale(omega, 1 / speed), speed * dt) : pose.n;
  const grip = add(pose.grip, gripDelta);
  return { grip, toe: addScaled(grip, a, -BAT_FULL), n };
}

function velocityAt(
  knots: readonly Vec3[],
  knotTimes: readonly number[],
  time: number,
): { value: Vec3; derivative: Vec3 } {
  let segment = 0;
  while (segment < knotTimes.length - 2 && time > knotTimes[segment + 1]) segment++;
  const seconds = knotTimes[segment + 1] - knotTimes[segment];
  const u = clamp((time - knotTimes[segment]) / seconds, 0, 1);
  const delta = sub(knots[segment + 1], knots[segment]);
  return { value: addScaled(knots[segment], delta, u), derivative: scale(delta, 1 / seconds) };
}

/** Integrate two bounded steering/acceleration legs and a 2 ms zero-acceleration contact plateau. */
function halfPath(
  contact: BatPose,
  contactGripV: Vec3,
  contactOmega: Vec3,
  middleGripV: Vec3,
  middleOmega: Vec3,
  duration: number,
  direction: -1 | 1,
): KinematicSample[] {
  const gripKnots =
    direction < 0 ? [v3(), middleGripV, contactGripV, contactGripV] : [contactGripV, contactGripV, middleGripV, v3()];
  const omegaKnots =
    direction < 0 ? [v3(), middleOmega, contactOmega, contactOmega] : [contactOmega, contactOmega, middleOmega, v3()];
  const plateauS = Math.min(0.002, duration / 10);
  const rampS = duration - plateauS;
  const knotTimes = direction < 0 ? [0, rampS / 2, rampS, duration] : [0, plateauS, plateauS + rampS / 2, duration];
  const steps = Math.ceil(duration / DT);
  const h = duration / steps;
  let pose = contact;
  const out: KinematicSample[] = [];
  for (let i = 0; i <= steps; i++) {
    const elapsed = i * h;
    const fromStart = direction < 0 ? duration - elapsed : elapsed;
    const grip = velocityAt(gripKnots, knotTimes, fromStart);
    const angular = velocityAt(omegaKnots, knotTimes, fromStart);
    const t = direction * elapsed;
    out.push({ t, pose, gripV: grip.value, gripA: grip.derivative, omega: angular.value, alpha: angular.derivative });
    if (i === steps) break;
    const nextElapsed = (i + 0.5) * h;
    const nextFromStart = direction < 0 ? duration - nextElapsed : nextElapsed;
    const vm = velocityAt(gripKnots, knotTimes, nextFromStart).value;
    const wm = velocityAt(omegaKnots, knotTimes, nextFromStart).value;
    pose = advancePose(pose, scale(vm, direction * h), wm, direction * h);
  }
  return out;
}

function localConvexPoints(pose: BatPose): Vec3[] {
  const f = frame(pose);
  const points = [pose.grip];
  for (const along of [-BAT_FULL, -HANDLE_L]) {
    for (const across of [-BLADE_HALF_W, BLADE_HALF_W]) {
      for (const normal of [-BLADE_T / 2, BLADE_T / 2]) {
        points.push(addScaled(addScaled(addScaled(pose.grip, f.a, along), f.w, across), f.n, normal));
      }
    }
  }
  // Capsule extrema around both ends of the glove/handle envelope. The 16 deterministic radial directions are a
  // lower-cost diagnostic; the final witness must additionally pass the conservative enclosing-radius certificate.
  for (const along of [-HANDLE_L, -0.04]) {
    const centre = addScaled(pose.grip, f.a, along);
    for (let k = 0; k < 16; k++) {
      const theta = (2 * Math.PI * k) / 16;
      points.push(addScaled(addScaled(centre, f.w, Math.cos(theta) * GLOVE_R), f.n, Math.sin(theta) * GLOVE_R));
    }
  }
  return points;
}

function sampleCaps(sample: KinematicSample): {
  gripSpeed: number;
  angularSpeed: number;
  pointSpeed: number;
  gripAccel: number;
  angularAccel: number;
  pointAccel: number;
} {
  let pointSpeed = 0;
  let pointAccel = 0;
  for (const point of localConvexPoints(sample.pose)) {
    const r = sub(point, sample.pose.grip);
    const rotational = cross(sample.omega, r);
    const centripetal = cross(sample.omega, rotational);
    const tangential = cross(sample.alpha, r);
    pointSpeed = Math.max(pointSpeed, len(add(sample.gripV, rotational)));
    pointAccel = Math.max(pointAccel, len(add(add(sample.gripA, tangential), centripetal)));
  }
  return {
    gripSpeed: len(sample.gripV),
    angularSpeed: len(sample.omega),
    pointSpeed,
    gripAccel: len(sample.gripA),
    angularAccel: len(sample.alpha),
    pointAccel,
  };
}

function contactTwistAt(geometry: ContactGeometry, fraction: number): { gripV: Vec3; omega: Vec3; fraction: number } {
  const r = sub(geometry.point, geometry.pose.grip);
  const r2 = dot(r, r);
  const axial = scale(r, dot(geometry.desired, r) / r2);
  const perpendicular = sub(geometry.desired, axial);
  const rotationalTarget = scale(perpendicular, fraction);
  const omega = add(scale(cross(r, rotationalTarget), 1 / r2), geometry.authoredOmega);
  const gripV = sub(geometry.desired, cross(omega, r));
  return { gripV, omega, fraction };
}

function candidateContactTwists(
  geometry: ContactGeometry,
  steps = 64,
  descending = false,
): Array<{ gripV: Vec3; omega: Vec3; fraction: number }> {
  const out = [];
  for (let index = 0; index <= steps; index++) {
    const step = descending ? steps - index : index;
    const value = contactTwistAt(geometry, step / steps);
    const { gripV, omega } = value;
    if (len(gripV) <= BAT_GRIP_SPEED_LIMIT_MPS + 1e-12 && len(omega) <= BAT_ANGULAR_SPEED_LIMIT_RADPS + 1e-12) {
      out.push(value);
    }
  }
  return out;
}

type PowerPolynomial = readonly number[];

const PRE_CONTACT_LOOP: PowerPolynomial = [0, 0, 0, -4, 7, -3];
const POST_CONTACT_LOOP: PowerPolynomial = [0, 1, 0, -6, 8, -3];
const BAT_ENCLOSING_RADIUS_M = Math.max(Math.hypot(BAT_FULL, BLADE_HALF_W, BLADE_T / 2), HANDLE_L + GLOVE_R);

function derivativePolynomial(values: PowerPolynomial): number[] {
  return values.slice(1).map((value, index) => value * (index + 1));
}

function evaluatePolynomial(values: PowerPolynomial, u: number): number {
  let result = 0;
  for (let index = values.length - 1; index >= 0; index--) result = result * u + values[index];
  return result;
}

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let value = 1;
  for (let index = 1; index <= Math.min(k, n - k); index++) value = (value * (n - index + 1)) / index;
  return value;
}

function powerToBernstein(values: PowerPolynomial): number[] {
  const degree = values.length - 1;
  return Array.from({ length: degree + 1 }, (_, k) => {
    let value = 0;
    for (let index = 0; index <= k; index++) value += (values[index] * binomial(k, index)) / binomial(degree, index);
    return value;
  });
}

function splitBernsteinHalf(values: readonly number[]): readonly [number[], number[]] {
  const rows = [values.slice()];
  while (rows.at(-1)!.length > 1) {
    const previous = rows.at(-1)!;
    rows.push(previous.slice(0, -1).map((value, index) => (value + previous[index + 1]) / 2));
  }
  return [rows.map((row) => row[0]), rows.map((row) => row.at(-1)!).reverse()];
}

/** Rigorous polynomial bound: every subdivided Bezier curve lies in the convex hull of its control values. */
function bernsteinAbsoluteBound(values: PowerPolynomial, subdivisionDepth = 10): number {
  let segments = [powerToBernstein(values)];
  for (let depth = 0; depth < subdivisionDepth; depth++) {
    segments = segments.flatMap((segment) => splitBernsteinHalf(segment));
  }
  return Math.max(...segments.flatMap((segment) => segment.map(Math.abs)));
}

const LOOP_D1_BOUND = Math.max(
  bernsteinAbsoluteBound(derivativePolynomial(PRE_CONTACT_LOOP)),
  bernsteinAbsoluteBound(derivativePolynomial(POST_CONTACT_LOOP)),
);
const LOOP_D2_BOUND = Math.max(
  bernsteinAbsoluteBound(derivativePolynomial(derivativePolynomial(PRE_CONTACT_LOOP))),
  bernsteinAbsoluteBound(derivativePolynomial(derivativePolynomial(POST_CONTACT_LOOP))),
);

function analyticLoopCaps(twist: { gripV: Vec3; omega: Vec3 }, durationS: number): ReturnType<typeof sampleCaps> {
  const gripSpeed = len(twist.gripV) * LOOP_D1_BOUND;
  const angularSpeed = len(twist.omega) * LOOP_D1_BOUND;
  const gripAccel = (len(twist.gripV) * LOOP_D2_BOUND) / durationS;
  const angularAccel = (len(twist.omega) * LOOP_D2_BOUND) / durationS;
  return {
    gripSpeed,
    angularSpeed,
    pointSpeed: gripSpeed + BAT_ENCLOSING_RADIUS_M * angularSpeed,
    gripAccel,
    angularAccel,
    pointAccel:
      gripAccel + BAT_ENCLOSING_RADIUS_M * angularAccel + BAT_ENCLOSING_RADIUS_M * angularSpeed * angularSpeed,
  };
}

/** Smallest duration certified by the same analytic whole-bat caps; a longer loop only increases hand excursion. */
function minimumLoopDurationS(twist: { gripV: Vec3; omega: Vec3 }): number | null {
  const gripSpeed = len(twist.gripV) * LOOP_D1_BOUND;
  const angularSpeed = len(twist.omega) * LOOP_D1_BOUND;
  const pointSpeed = gripSpeed + BAT_ENCLOSING_RADIUS_M * angularSpeed;
  if (
    gripSpeed > BAT_GRIP_SPEED_LIMIT_MPS + 1e-12 ||
    angularSpeed > BAT_ANGULAR_SPEED_LIMIT_RADPS + 1e-12 ||
    pointSpeed > BAT_POINT_SPEED_LIMIT_MPS + 1e-12
  )
    return null;
  const centripetal = BAT_ENCLOSING_RADIUS_M * angularSpeed * angularSpeed;
  if (centripetal >= BAT_POINT_ACCEL_LIMIT_MPS2) return null;
  const firstOrderPointAccel = (len(twist.gripV) + BAT_ENCLOSING_RADIUS_M * len(twist.omega)) * LOOP_D2_BOUND;
  return (
    Math.max(
      0.02,
      (len(twist.gripV) * LOOP_D2_BOUND) / BAT_GRIP_ACCEL_LIMIT_MPS2,
      (len(twist.omega) * LOOP_D2_BOUND) / BAT_ANGULAR_ACCEL_LIMIT_RADPS2,
      firstOrderPointAccel / (BAT_POINT_ACCEL_LIMIT_MPS2 - centripetal),
    ) * 1.000001
  );
}

function loopHalfSamples(
  contact: BatPose,
  twist: { gripV: Vec3; omega: Vec3 },
  durationS: number,
  side: 'pre' | 'post',
): KinematicSample[] {
  const polynomial = side === 'pre' ? PRE_CONTACT_LOOP : POST_CONTACT_LOOP;
  const first = derivativePolynomial(polynomial);
  const second = derivativePolynomial(first);
  const steps = Math.ceil(durationS / DT);
  const angularSpeed = len(twist.omega);
  const angularAxis = angularSpeed > 1e-15 ? scale(twist.omega, 1 / angularSpeed) : v3(0, 1, 0);
  const contactAxis = norm(sub(contact.grip, contact.toe));
  const samples: KinematicSample[] = [];
  for (let index = 0; index <= steps; index++) {
    const u = index / steps;
    const q = evaluatePolynomial(polynomial, u);
    const q1 = evaluatePolynomial(first, u);
    const q2 = evaluatePolynomial(second, u);
    const theta = durationS * angularSpeed * q;
    const axis = angularSpeed > 1e-15 ? rotate(contactAxis, angularAxis, theta) : contactAxis;
    const n = angularSpeed > 1e-15 ? rotate(contact.n, angularAxis, theta) : contact.n;
    const grip = addScaled(contact.grip, twist.gripV, durationS * q);
    samples.push({
      t: side === 'pre' ? -durationS + durationS * u : durationS * u,
      pose: { grip, toe: addScaled(grip, axis, -BAT_FULL), n },
      gripV: scale(twist.gripV, q1),
      gripA: scale(twist.gripV, q2 / durationS),
      omega: scale(twist.omega, q1),
      alpha: scale(twist.omega, q2 / durationS),
    });
  }
  return samples;
}

interface LoopWitness {
  fraction: number;
  durationS: number;
  root: { x: number; z: number };
  crouchM: number;
  gapM: number;
  analyticCaps: ReturnType<typeof sampleCaps>;
  sampledCaps: ReturnType<typeof sampleCaps>;
  contactPointSpeedErrorMps: number;
  contactPoseContinuityM: number;
  contactVelocityContinuityMps: number;
  contactAccelerationContinuityMps2: number;
  endpointPoseErrorM: number;
  endpointSpeedMps: number;
  endpointAccelerationMps2: number;
}

interface LoopSearchReport {
  splitCount: number;
  analyticallyLegalSplits: number;
  availableDurationSplits: number;
  minimumCertifiedDuration: { fraction: number; seconds: number; analyticCaps: ReturnType<typeof sampleCaps> } | null;
  sampledCapPass: number;
  anatomyAttempts: number;
  witness: LoopWitness | null;
}

function findQuinticLoopWitness(geometry: ContactGeometry): LoopSearchReport {
  const splits = Array.from({ length: 513 }, (_, index) => contactTwistAt(geometry, (512 - index) / 512));
  const report: LoopSearchReport = {
    splitCount: splits.length,
    analyticallyLegalSplits: 0,
    availableDurationSplits: 0,
    minimumCertifiedDuration: null,
    sampledCapPass: 0,
    anatomyAttempts: 0,
    witness: null,
  };
  for (const twist of splits) {
    const durationS = minimumLoopDurationS(twist);
    if (durationS === null) continue;
    report.analyticallyLegalSplits++;
    const durationCaps = analyticLoopCaps(twist, durationS);
    if (!report.minimumCertifiedDuration || durationS < report.minimumCertifiedDuration.seconds) {
      report.minimumCertifiedDuration = { fraction: twist.fraction, seconds: durationS, analyticCaps: durationCaps };
    }
    if (durationS > geometry.beforeS + 1e-12 || durationS > geometry.afterS + 1e-12) continue;
    report.availableDurationSplits++;
    const analyticCaps = durationCaps;
    if (!capsPass(analyticCaps)) continue;
    const pre = loopHalfSamples(geometry.pose, twist, durationS, 'pre');
    const post = loopHalfSamples(geometry.pose, twist, durationS, 'post');
    const samples = [...pre.slice(0, -1), ...post];
    const sampledCaps = pathCaps(samples);
    if (!capsPass(sampledCaps)) continue;
    const capFields = Object.keys(analyticCaps) as Array<keyof typeof analyticCaps>;
    if (capFields.some((key) => sampledCaps[key] > analyticCaps[key] + 1e-8)) {
      throw new Error(`sampled ${geometry.label} loop exceeded analytic enclosing-radius certificate`);
    }
    report.sampledCapPass++;
    report.anatomyAttempts++;
    const solved = solveDenseBody(samples, geometry.body);
    if (!solved) continue;
    const preContact = pre.at(-1)!;
    const postContact = post[0];
    const preEndpoint = pre[0];
    const postEndpoint = post.at(-1)!;
    const contactPointVelocity = add(twist.gripV, cross(twist.omega, sub(geometry.point, geometry.pose.grip)));
    report.witness = {
      fraction: twist.fraction,
      durationS,
      root: solved.root.offset,
      crouchM: solved.root.crouchM,
      gapM: solved.gap,
      analyticCaps,
      sampledCaps,
      contactPointSpeedErrorMps: dist(contactPointVelocity, geometry.desired),
      contactPoseContinuityM: Math.max(
        dist(preContact.pose.grip, postContact.pose.grip),
        dist(preContact.pose.toe, postContact.pose.toe),
        dist(preContact.pose.n, postContact.pose.n),
      ),
      contactVelocityContinuityMps: Math.max(
        dist(preContact.gripV, postContact.gripV),
        dist(preContact.omega, postContact.omega),
      ),
      contactAccelerationContinuityMps2: Math.max(
        dist(preContact.gripA, postContact.gripA),
        dist(preContact.alpha, postContact.alpha),
      ),
      endpointPoseErrorM: Math.max(
        dist(preEndpoint.pose.grip, geometry.pose.grip),
        dist(preEndpoint.pose.toe, geometry.pose.toe),
        dist(postEndpoint.pose.grip, geometry.pose.grip),
        dist(postEndpoint.pose.toe, geometry.pose.toe),
      ),
      endpointSpeedMps: Math.max(
        len(preEndpoint.gripV),
        len(preEndpoint.omega),
        len(postEndpoint.gripV),
        len(postEndpoint.omega),
      ),
      endpointAccelerationMps2: Math.max(
        len(preEndpoint.gripA),
        len(preEndpoint.alpha),
        len(postEndpoint.gripA),
        len(postEndpoint.alpha),
      ),
    };
    break;
  }
  return report;
}

function basisPerpendicular(v: Vec3): readonly [Vec3, Vec3] {
  const e0 = norm(v);
  const seed = Math.abs(e0.y) < 0.8 ? v3(0, 1, 0) : v3(1, 0, 0);
  const e1 = norm(cross(e0, seed));
  return [e1, cross(e0, e1)];
}

interface Witness {
  fraction: number;
  steering: readonly [number, number, number, number];
  root: { x: number; z: number };
  crouchM: number;
  caps: ReturnType<typeof sampleCaps>;
  gap: number;
  contactSpeedError: number;
}

interface IndependentWitness extends Omit<Witness, 'steering'> {
  steering: { pre: readonly [number, number, number, number]; post: readonly [number, number, number, number] };
  contactPoseContinuityError: number;
  contactVelocityContinuityError: number;
  contactAccelerationContinuityError: number;
}

interface SearchDiagnostics {
  twists: number;
  paths: number;
  capPass: number;
  rootPass: number;
  preRootPass: number;
  postRootPass: number;
  contactRoot: ReturnType<typeof solveBatterRootOffsetForPoses>;
  densePass: number;
  bestCaps: ReturnType<typeof sampleCaps> | null;
  minimumCapPenalty: number;
}

function solveDenseBody(
  samples: readonly KinematicSample[],
  nominal: BatterBody,
): {
  root: ReturnType<typeof solveBatterRootOffsetForPoses>;
  body: BatterBody;
  gap: number;
} | null {
  const last = samples.length - 1;
  const indices = [0, 1, 2, 3, 4, 5, 6].map((part) => Math.round((last * part) / 6));
  const constraintIndices = [...new Set(indices)];
  for (let iteration = 0; iteration < 10; iteration++) {
    const root = solveBatterRootOffsetForPoses(
      constraintIndices.map((index) => samples[index].pose),
      nominal,
    );
    if (!root.solved) return null;
    const body = translateBatterBody(applyBatterPosture(nominal, root.crouchM), root.offset);
    let worst = Infinity;
    let worstIndex = -1;
    for (let index = 0; index < samples.length; index++) {
      const value = batPoseAdmissibility(samples[index].pose, body);
      const gap = Math.min(value.gap, BAT_HAND_REACH_SOLVE_M - value.reach);
      if (gap < worst) {
        worst = gap;
        worstIndex = index;
      }
    }
    if (worst >= -1e-9) return { root, body, gap: worst };
    if (constraintIndices.includes(worstIndex)) return null;
    constraintIndices.push(worstIndex);
    constraintIndices.sort((a, b) => a - b);
  }
  return null;
}

function capPenalty(value: ReturnType<typeof sampleCaps>): number {
  return Math.max(
    value.gripSpeed / BAT_GRIP_SPEED_LIMIT_MPS,
    value.angularSpeed / BAT_ANGULAR_SPEED_LIMIT_RADPS,
    value.pointSpeed / BAT_POINT_SPEED_LIMIT_MPS,
    value.gripAccel / BAT_GRIP_ACCEL_LIMIT_MPS2,
    value.angularAccel / BAT_ANGULAR_ACCEL_LIMIT_RADPS2,
    value.pointAccel / BAT_POINT_ACCEL_LIMIT_MPS2,
  );
}

function pathCaps(samples: readonly KinematicSample[]): ReturnType<typeof sampleCaps> {
  return samples.map(sampleCaps).reduce((a, b) => ({
    gripSpeed: Math.max(a.gripSpeed, b.gripSpeed),
    angularSpeed: Math.max(a.angularSpeed, b.angularSpeed),
    pointSpeed: Math.max(a.pointSpeed, b.pointSpeed),
    gripAccel: Math.max(a.gripAccel, b.gripAccel),
    angularAccel: Math.max(a.angularAccel, b.angularAccel),
    pointAccel: Math.max(a.pointAccel, b.pointAccel),
  }));
}

function capsPass(value: ReturnType<typeof sampleCaps>): boolean {
  return (
    value.gripSpeed <= BAT_GRIP_SPEED_LIMIT_MPS + 1e-9 &&
    value.angularSpeed <= BAT_ANGULAR_SPEED_LIMIT_RADPS + 1e-9 &&
    value.pointSpeed <= BAT_POINT_SPEED_LIMIT_MPS + 1e-9 &&
    value.gripAccel <= BAT_GRIP_ACCEL_LIMIT_MPS2 + 1e-9 &&
    value.angularAccel <= BAT_ANGULAR_ACCEL_LIMIT_RADPS2 + 1e-9 &&
    value.pointAccel <= BAT_POINT_ACCEL_LIMIT_MPS2 + 1e-9
  );
}

function handReachExcess(
  samples: readonly KinematicSample[],
  body: BatterBody,
  limit = BAT_HAND_REACH_SOLVE_M,
): {
  topM: number;
  lowerM: number;
} {
  const shoulders = batterShoulders(body);
  let topM = -Infinity;
  let lowerM = -Infinity;
  for (const sample of samples) {
    const axis = norm(sub(sample.pose.grip, sample.pose.toe));
    const top = addScaled(sample.pose.grip, axis, -TOP_HAND_FROM_CAP);
    const lower = addScaled(sample.pose.grip, axis, -LOWER_HAND_FROM_CAP);
    topM = Math.max(topM, dist(shoulders[0], top) - limit);
    lowerM = Math.max(lowerM, dist(shoulders[1], lower) - limit);
  }
  return { topM, lowerM };
}

function shoulderDemandSnapshot(sample: KinematicSample, body: BatterBody) {
  const shoulders = batterShoulders(body);
  const axis = norm(sub(sample.pose.grip, sample.pose.toe));
  const hands = [
    addScaled(sample.pose.grip, axis, -TOP_HAND_FROM_CAP),
    addScaled(sample.pose.grip, axis, -LOWER_HAND_FROM_CAP),
  ] as const;
  const deltas = hands.map((hand, index) => {
    const toward = sub(hand, shoulders[index]);
    const distanceM = len(toward);
    return distanceM > BAT_HAND_REACH_SOLVE_M ? scale(toward, (distanceM - BAT_HAND_REACH_SOLVE_M) / distanceM) : v3();
  }) as unknown as readonly [Vec3, Vec3];
  const displaced = [add(shoulders[0], deltas[0]), add(shoulders[1], deltas[1])] as const;
  const staticMidpoint = scale(add(shoulders[0], shoulders[1]), 0.5);
  const displacedMidpoint = scale(add(displaced[0], displaced[1]), 0.5);
  const span = sub(displaced[1], displaced[0]);
  return {
    t: sample.t,
    shoulders,
    hands,
    minimumDisplacement: deltas,
    displacedShoulders: displaced,
    midpointDelta: sub(displacedMidpoint, staticMidpoint),
    span,
    spanM: len(span),
    yawRad: datan2(span.z, span.x),
  };
}

function maximumDemandSample(samples: readonly KinematicSample[], body: BatterBody): KinematicSample {
  let best = samples[0];
  let bestDemand = -Infinity;
  for (const sample of samples) {
    const snapshot = shoulderDemandSnapshot(sample, body);
    const demand = Math.max(len(snapshot.minimumDisplacement[0]), len(snapshot.minimumDisplacement[1]));
    if (demand > bestDemand) {
      best = sample;
      bestDemand = demand;
    }
  }
  return best;
}

/** Explicit inputs only: Unity parity owns every physical bound; this scratch oracle invents none. */
export interface DynamicShoulderBounds {
  maxMidpointDisplacementM: number;
  maxIndividualShoulderDisplacementM: number;
  maxYawRad: number;
  maxMidpointSpeedMps: number;
  maxMidpointAccelerationMps2: number;
  maxIndividualShoulderSpeedMps: number;
  maxIndividualShoulderAccelerationMps2: number;
  maxYawSpeedRadps: number;
  maxYawAccelerationRadps2: number;
  yawIntervals: number;
  allowContactArticulation: boolean;
  requireUnarticulatedStart: boolean;
  requireUnarticulatedEnd: boolean;
}

export interface DynamicShoulderFrame {
  midpointDelta: Vec3;
  yawRad: number;
  shoulders: readonly [Vec3, Vec3];
}

export interface DynamicShoulderFeasibility {
  feasible: boolean;
  reason: string | null;
  contactArticulation: { midpointM: number; yawRad: number; individualM: number } | null;
  required: {
    midpointDisplacementM: number;
    individualShoulderDisplacementM: number;
    midpointSpeedMps: number;
    midpointAccelerationMps2: number;
    individualShoulderSpeedMps: number;
    individualShoulderAccelerationMps2: number;
    yawRad: number;
    yawSpeedRadps: number;
    yawAccelerationRadps2: number;
  };
  frames: readonly DynamicShoulderFrame[];
}

function projectIntoBall(point: Vec3, centre: Vec3, radius: number): Vec3 {
  const delta = sub(point, centre);
  const amount = len(delta);
  return amount <= radius || amount === 0 ? point : addScaled(centre, delta, radius / amount);
}

/** Deterministic closest common midpoint shift inside two equal reach balls. */
function closestTwoBallPoint(first: Vec3, second: Vec3, radius: number, reference: Vec3): Vec3 | null {
  if (dist(first, second) > 2 * radius + 1e-12) return null;
  let point = reference;
  let firstCorrection = v3();
  let secondCorrection = v3();
  let converged = false;
  for (let cycle = 0; cycle < 160; cycle++) {
    let movement = 0;
    for (const index of [0, 1] as const) {
      const correction = index === 0 ? firstCorrection : secondCorrection;
      const centre = index === 0 ? first : second;
      const corrected = add(point, correction);
      const projected = projectIntoBall(corrected, centre, radius);
      const nextCorrection = sub(corrected, projected);
      if (index === 0) firstCorrection = nextCorrection;
      else secondCorrection = nextCorrection;
      movement = Math.max(movement, dist(point, projected));
      point = projected;
    }
    const violation = Math.max(dist(point, first) - radius, dist(point, second) - radius);
    if (violation <= 1e-11 && movement <= 1e-11) {
      converged = true;
      break;
    }
  }
  if (!converged || dist(point, first) > radius + 1e-9 || dist(point, second) > radius + 1e-9) return null;
  return point;
}

function frameAt(
  pose: BatPose,
  body: BatterBody,
  yawRad: number,
  referenceMidpoint: Vec3,
): DynamicShoulderFrame | null {
  const base = batterShoulders(body);
  const midpoint = scale(add(base[0], base[1]), 0.5);
  const offsets = [sub(base[0], midpoint), sub(base[1], midpoint)] as const;
  const rotated = offsets.map((offset) => rotate(offset, v3(0, 1, 0), yawRad)) as unknown as readonly [Vec3, Vec3];
  const axis = norm(sub(pose.grip, pose.toe));
  const hands = [
    addScaled(pose.grip, axis, -TOP_HAND_FROM_CAP),
    addScaled(pose.grip, axis, -LOWER_HAND_FROM_CAP),
  ] as const;
  const centres = [sub(hands[0], add(midpoint, rotated[0])), sub(hands[1], add(midpoint, rotated[1]))] as const;
  const midpointDelta = closestTwoBallPoint(centres[0], centres[1], BAT_HAND_REACH_SOLVE_M, referenceMidpoint);
  if (!midpointDelta) return null;
  return {
    midpointDelta,
    yawRad,
    shoulders: [add(add(midpoint, midpointDelta), rotated[0]), add(add(midpoint, midpointDelta), rotated[1])],
  };
}

/**
 * Greedy deterministic witness search for a rigid shoulder frame. It is sufficient-only: failure means this bounded
 * yaw lattice/path found no witness, never that the Unity rig is impossible. Nonzero contact articulation is tested
 * whenever the caller explicitly allows it, which is required for the low yorker contact.
 */
export function certifyDynamicShoulderPath(
  samples: readonly KinematicSample[],
  body: BatterBody,
  bounds: DynamicShoulderBounds,
  contactIndex: number,
): DynamicShoulderFeasibility {
  if (bounds.yawIntervals < 1 || !Number.isInteger(bounds.yawIntervals))
    throw new Error('yawIntervals must be a positive integer');
  const baseShoulders = batterShoulders(body);
  const frames: DynamicShoulderFrame[] = [];
  const zeroRequired = (index: number): boolean =>
    (index === 0 && bounds.requireUnarticulatedStart) ||
    (index === samples.length - 1 && bounds.requireUnarticulatedEnd) ||
    (index === contactIndex && !bounds.allowContactArticulation);
  let previousMidpointVelocity = v3();
  let previousShoulderVelocities = [v3(), v3()] as [Vec3, Vec3];
  let previousYawVelocity = 0;
  const required = {
    midpointDisplacementM: 0,
    individualShoulderDisplacementM: 0,
    midpointSpeedMps: 0,
    midpointAccelerationMps2: 0,
    individualShoulderSpeedMps: 0,
    individualShoulderAccelerationMps2: 0,
    yawRad: 0,
    yawSpeedRadps: 0,
    yawAccelerationRadps2: 0,
  };
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    const previous = frames.at(-1);
    const dt = index === 0 ? 0 : sample.t - samples[index - 1].t;
    const yawValues = zeroRequired(index)
      ? [0]
      : Array.from(
          { length: bounds.yawIntervals + 1 },
          (_, step) => -bounds.maxYawRad + (2 * bounds.maxYawRad * step) / bounds.yawIntervals,
        )
          .concat(0)
          .sort(
            (left, right) =>
              Math.abs(left - (previous?.yawRad ?? 0)) - Math.abs(right - (previous?.yawRad ?? 0)) || left - right,
          );
    let selected: null | {
      frame: DynamicShoulderFrame;
      midpointVelocity: Vec3;
      shoulderVelocities: [Vec3, Vec3];
      yawVelocity: number;
      score: number;
    } = null;
    for (const yaw of yawValues) {
      const frame = frameAt(sample.pose, body, yaw, previous?.midpointDelta ?? v3());
      if (!frame) continue;
      if (zeroRequired(index) && (len(frame.midpointDelta) > 1e-12 || Math.abs(yaw) > 1e-12)) continue;
      const midpointM = len(frame.midpointDelta);
      const individualM = Math.max(
        dist(frame.shoulders[0], baseShoulders[0]),
        dist(frame.shoulders[1], baseShoulders[1]),
      );
      if (
        midpointM > bounds.maxMidpointDisplacementM + 1e-12 ||
        individualM > bounds.maxIndividualShoulderDisplacementM + 1e-12
      )
        continue;
      const midpointVelocity = dt > 0 ? scale(sub(frame.midpointDelta, previous!.midpointDelta), 1 / dt) : v3();
      const shoulderVelocities: [Vec3, Vec3] =
        dt > 0
          ? [
              scale(sub(frame.shoulders[0], previous!.shoulders[0]), 1 / dt),
              scale(sub(frame.shoulders[1], previous!.shoulders[1]), 1 / dt),
            ]
          : [v3(), v3()];
      const yawVelocity = dt > 0 ? (yaw - previous!.yawRad) / dt : 0;
      const midpointAcceleration = dt > 0 ? scale(sub(midpointVelocity, previousMidpointVelocity), 1 / dt) : v3();
      const shoulderAccelerations: [Vec3, Vec3] =
        dt > 0
          ? [
              scale(sub(shoulderVelocities[0], previousShoulderVelocities[0]), 1 / dt),
              scale(sub(shoulderVelocities[1], previousShoulderVelocities[1]), 1 / dt),
            ]
          : [v3(), v3()];
      const yawAcceleration = dt > 0 ? (yawVelocity - previousYawVelocity) / dt : 0;
      if (
        len(midpointVelocity) > bounds.maxMidpointSpeedMps + 1e-9 ||
        len(midpointAcceleration) > bounds.maxMidpointAccelerationMps2 + 1e-9 ||
        Math.max(len(shoulderVelocities[0]), len(shoulderVelocities[1])) >
          bounds.maxIndividualShoulderSpeedMps + 1e-9 ||
        Math.max(len(shoulderAccelerations[0]), len(shoulderAccelerations[1])) >
          bounds.maxIndividualShoulderAccelerationMps2 + 1e-9 ||
        Math.abs(yawVelocity) > bounds.maxYawSpeedRadps + 1e-9 ||
        Math.abs(yawAcceleration) > bounds.maxYawAccelerationRadps2 + 1e-9
      )
        continue;
      const score =
        midpointM + individualM + Math.abs(yaw) + (previous ? dist(frame.midpointDelta, previous.midpointDelta) : 0);
      if (!selected || score < selected.score - 1e-15) {
        selected = { frame, midpointVelocity, shoulderVelocities, yawVelocity, score };
      }
    }
    if (!selected) {
      return {
        feasible: false,
        reason: `no bounded shoulder frame at sample ${index}/${samples.length - 1}`,
        contactArticulation: null,
        required,
        frames,
      };
    }
    const dtForRequired = index === 0 ? 0 : sample.t - samples[index - 1].t;
    const midpointAcceleration =
      dtForRequired > 0 ? scale(sub(selected.midpointVelocity, previousMidpointVelocity), 1 / dtForRequired) : v3();
    const shoulderAccelerations =
      dtForRequired > 0
        ? [
            scale(sub(selected.shoulderVelocities[0], previousShoulderVelocities[0]), 1 / dtForRequired),
            scale(sub(selected.shoulderVelocities[1], previousShoulderVelocities[1]), 1 / dtForRequired),
          ]
        : [v3(), v3()];
    const yawAcceleration = dtForRequired > 0 ? (selected.yawVelocity - previousYawVelocity) / dtForRequired : 0;
    required.midpointDisplacementM = Math.max(required.midpointDisplacementM, len(selected.frame.midpointDelta));
    required.individualShoulderDisplacementM = Math.max(
      required.individualShoulderDisplacementM,
      dist(selected.frame.shoulders[0], baseShoulders[0]),
      dist(selected.frame.shoulders[1], baseShoulders[1]),
    );
    required.midpointSpeedMps = Math.max(required.midpointSpeedMps, len(selected.midpointVelocity));
    required.midpointAccelerationMps2 = Math.max(required.midpointAccelerationMps2, len(midpointAcceleration));
    required.individualShoulderSpeedMps = Math.max(
      required.individualShoulderSpeedMps,
      len(selected.shoulderVelocities[0]),
      len(selected.shoulderVelocities[1]),
    );
    required.individualShoulderAccelerationMps2 = Math.max(
      required.individualShoulderAccelerationMps2,
      len(shoulderAccelerations[0]),
      len(shoulderAccelerations[1]),
    );
    required.yawRad = Math.max(required.yawRad, Math.abs(selected.frame.yawRad));
    required.yawSpeedRadps = Math.max(required.yawSpeedRadps, Math.abs(selected.yawVelocity));
    required.yawAccelerationRadps2 = Math.max(required.yawAccelerationRadps2, Math.abs(yawAcceleration));
    frames.push(selected.frame);
    previousMidpointVelocity = selected.midpointVelocity;
    previousShoulderVelocities = selected.shoulderVelocities;
    previousYawVelocity = selected.yawVelocity;
  }
  const contact = frames[contactIndex];
  const contactIndividualM = contact
    ? Math.max(dist(contact.shoulders[0], baseShoulders[0]), dist(contact.shoulders[1], baseShoulders[1]))
    : 0;
  return {
    feasible: true,
    reason: null,
    contactArticulation: contact
      ? {
          midpointM: len(contact.midpointDelta),
          yawRad: contact.yawRad,
          individualM: contactIndividualM,
        }
      : null,
    required,
    frames,
  };
}

function findIndependentHalfWitness(geometry: ContactGeometry): {
  witness: IndependentWitness | null;
  twists: number;
  capPassHalves: number;
  preFeasible: number;
  postFeasible: number;
  pairs: number;
  closestPair: unknown;
} {
  // Start with the shortest deterministic candidate that still leaves two bounded steering/acceleration legs.
  // Candidates whose exact acceleration exceeds a cap are rejected below; shorter travel increases the chance that
  // one static planted body can own both halves without relaxing any envelope.
  const duration = Math.min(geometry.beforeS, geometry.afterS, 0.068);
  const segmentSeconds = (duration - Math.min(0.002, duration / 10)) / 2;
  const twists = candidateContactTwists(geometry);
  let capPassHalves = 0;
  let preFeasible = 0;
  let postFeasible = 0;
  let pairs = 0;
  let closestPair: null | {
    scoreM: number;
    preRoot: Half['solved']['root'];
    postRoot: Half['solved']['root'];
    rootDelta: { xM: number; zM: number; planarM: number; crouchM: number };
    preUnderPost: ReturnType<typeof handReachExcess>;
    postUnderPre: ReturnType<typeof handReachExcess>;
    bestCommon: {
      lambda: number;
      root: { x: number; z: number };
      crouchM: number;
      pre: ReturnType<typeof handReachExcess>;
      post: ReturnType<typeof handReachExcess>;
      maximumExcessM: number;
    };
    parity: unknown;
  } = null;
  type Half = {
    samples: KinematicSample[];
    steering: readonly [number, number, number, number];
    solved: NonNullable<ReturnType<typeof solveDenseBody>>;
    caps: ReturnType<typeof sampleCaps>;
  };
  for (const twist of twists) {
    const [we1, we2] = basisPerpendicular(twist.omega);
    const [ve1, ve2] = basisPerpendicular(twist.gripV);
    const omegaMid = scale(twist.omega, 0.5);
    const gripMid = scale(twist.gripV, 0.5);
    const omegaBudget = Math.sqrt(
      Math.max(0, (BAT_ANGULAR_ACCEL_LIMIT_RADPS2 * segmentSeconds) ** 2 - (len(twist.omega) / 2) ** 2),
    );
    const gripBudget = Math.sqrt(
      Math.max(0, (BAT_GRIP_ACCEL_LIMIT_MPS2 * segmentSeconds) ** 2 - (len(twist.gripV) / 2) ** 2),
    );
    const pre: Half[] = [];
    const post: Half[] = [];
    for (const ws1 of [-1, 0, 1])
      for (const ws2 of [-1, 0, 1]) {
        if (ws1 !== 0 && ws2 !== 0) continue;
        for (const vs1 of [-1, 0, 1])
          for (const vs2 of [-1, 0, 1]) {
            if (vs1 !== 0 && vs2 !== 0) continue;
            const steering = [ws1, ws2, vs1, vs2] as const;
            const wm = addScaled(addScaled(omegaMid, we1, ws1 * omegaBudget * 0.95), we2, ws2 * omegaBudget * 0.95);
            const vm = addScaled(addScaled(gripMid, ve1, vs1 * gripBudget * 0.95), ve2, vs2 * gripBudget * 0.95);
            for (const direction of [-1, 1] as const) {
              const samples = halfPath(geometry.pose, twist.gripV, twist.omega, vm, wm, duration, direction);
              if (direction < 0) samples.reverse();
              const caps = pathCaps(samples);
              if (!capsPass(caps)) continue;
              capPassHalves++;
              const solved = solveDenseBody(samples, geometry.body);
              if (!solved) continue;
              const half = { samples, steering, solved, caps };
              if (direction < 0) {
                preFeasible++;
                pre.push(half);
              } else {
                postFeasible++;
                post.push(half);
              }
            }
          }
      }
    const orderedPairs = pre
      .flatMap((left) =>
        post.map((right) => ({
          left,
          right,
          rootDistance:
            Math.hypot(
              left.solved.root.offset.x - right.solved.root.offset.x,
              left.solved.root.offset.z - right.solved.root.offset.z,
            ) + Math.abs(left.solved.root.crouchM - right.solved.root.crouchM),
        })),
      )
      .sort((a, b) => a.rootDistance - b.rootDistance);
    const closest = orderedPairs[0];
    if (closest && (!closestPair || closest.rootDistance < closestPair.scoreM - 1e-15)) {
      const preRoot = closest.left.solved.root;
      const postRoot = closest.right.solved.root;
      const preUnderPostBody = translateBatterBody(
        applyBatterPosture(geometry.body, postRoot.crouchM),
        postRoot.offset,
      );
      const postUnderPreBody = translateBatterBody(applyBatterPosture(geometry.body, preRoot.crouchM), preRoot.offset);
      let common: {
        lambda: number;
        root: { x: number; z: number };
        crouchM: number;
        pre: ReturnType<typeof handReachExcess>;
        post: ReturnType<typeof handReachExcess>;
        maximumExcessM: number;
      } | null = null;
      for (let step = 0; step <= 100; step++) {
        const lambda = step / 100;
        const root = {
          x: preRoot.offset.x + (postRoot.offset.x - preRoot.offset.x) * lambda,
          z: preRoot.offset.z + (postRoot.offset.z - preRoot.offset.z) * lambda,
        };
        const crouchM = preRoot.crouchM + (postRoot.crouchM - preRoot.crouchM) * lambda;
        const body = translateBatterBody(applyBatterPosture(geometry.body, crouchM), root);
        const preExcess = handReachExcess(closest.left.samples, body);
        const postExcess = handReachExcess(closest.right.samples, body);
        const maximumExcessM = Math.max(preExcess.topM, preExcess.lowerM, postExcess.topM, postExcess.lowerM);
        if (!common || maximumExcessM < common.maximumExcessM - 1e-15) {
          common = { lambda, root, crouchM, pre: preExcess, post: postExcess, maximumExcessM };
        }
      }
      closestPair = {
        scoreM: closest.rootDistance,
        preRoot,
        postRoot,
        rootDelta: {
          xM: postRoot.offset.x - preRoot.offset.x,
          zM: postRoot.offset.z - preRoot.offset.z,
          planarM: Math.hypot(postRoot.offset.x - preRoot.offset.x, postRoot.offset.z - preRoot.offset.z),
          crouchM: postRoot.crouchM - preRoot.crouchM,
        },
        preUnderPost: handReachExcess(closest.left.samples, preUnderPostBody),
        postUnderPre: handReachExcess(closest.right.samples, postUnderPreBody),
        bestCommon: common!,
        parity: (() => {
          const commonBody = translateBatterBody(applyBatterPosture(geometry.body, common!.crouchM), common!.root);
          return {
            pre: shoulderDemandSnapshot(maximumDemandSample(closest.left.samples, commonBody), commonBody),
            contact: shoulderDemandSnapshot(closest.left.samples.at(-1)!, commonBody),
            post: shoulderDemandSnapshot(maximumDemandSample(closest.right.samples, commonBody), commonBody),
          };
        })(),
      };
    }
    for (const { left, right } of orderedPairs.slice(0, 256)) {
      pairs++;
      const before = left.samples.at(-1)!;
      const after = right.samples[0];
      const poseContinuity = Math.max(
        dist(before.pose.grip, after.pose.grip),
        dist(before.pose.toe, after.pose.toe),
        dist(before.pose.n, after.pose.n),
      );
      const velocityContinuity = Math.max(dist(before.gripV, after.gripV), dist(before.omega, after.omega));
      const accelerationContinuity = Math.max(dist(before.gripA, after.gripA), dist(before.alpha, after.alpha));
      if (poseContinuity > 1e-12 || velocityContinuity > 1e-12 || accelerationContinuity > 1e-12) continue;
      const samples = [...left.samples.slice(0, -1), ...right.samples];
      const solved = solveDenseBody(samples, geometry.body);
      if (!solved) continue;
      const caps = {
        gripSpeed: Math.max(left.caps.gripSpeed, right.caps.gripSpeed),
        angularSpeed: Math.max(left.caps.angularSpeed, right.caps.angularSpeed),
        pointSpeed: Math.max(left.caps.pointSpeed, right.caps.pointSpeed),
        gripAccel: Math.max(left.caps.gripAccel, right.caps.gripAccel),
        angularAccel: Math.max(left.caps.angularAccel, right.caps.angularAccel),
        pointAccel: Math.max(left.caps.pointAccel, right.caps.pointAccel),
      };
      const contactVelocity = add(twist.gripV, cross(twist.omega, sub(geometry.point, geometry.pose.grip)));
      return {
        witness: {
          fraction: twist.fraction,
          steering: { pre: left.steering, post: right.steering },
          root: solved.root.offset,
          crouchM: solved.root.crouchM,
          caps,
          gap: solved.gap,
          contactSpeedError: dist(contactVelocity, geometry.desired),
          contactPoseContinuityError: poseContinuity,
          contactVelocityContinuityError: velocityContinuity,
          contactAccelerationContinuityError: accelerationContinuity,
        },
        twists: twists.length,
        capPassHalves,
        preFeasible,
        postFeasible,
        pairs,
        closestPair,
      };
    }
  }
  return { witness: null, twists: twists.length, capPassHalves, preFeasible, postFeasible, pairs, closestPair };
}

function findWitness(
  geometry: ContactGeometry,
  diagnoseHalves = false,
): { witness: Witness | null; diagnostics: SearchDiagnostics } {
  // The authored window is an availability ceiling, not a requirement to keep moving. A real stroke reaches rest as
  // soon as the acceleration envelope permits, then holds its finish; using the full 140 ms needlessly translates
  // the hands through another third of a metre. 105 ms still permits 25 rad/s to ramp through two <=250 rad/s² legs.
  const duration = Math.min(geometry.beforeS, geometry.afterS, 0.105);
  let best: Witness | null = null;
  const twists = candidateContactTwists(geometry);
  const diagnostics: SearchDiagnostics = {
    twists: twists.length,
    paths: 0,
    capPass: 0,
    rootPass: 0,
    preRootPass: 0,
    postRootPass: 0,
    contactRoot: solveBatterRootOffsetForPoses([geometry.pose], geometry.body),
    densePass: 0,
    bestCaps: null,
    minimumCapPenalty: Infinity,
  };
  for (const twist of twists) {
    const [we1, we2] = basisPerpendicular(twist.omega);
    const [ve1, ve2] = basisPerpendicular(twist.gripV);
    const omegaMid = scale(twist.omega, 0.5);
    const gripMid = scale(twist.gripV, 0.5);
    const segmentSeconds = (duration - Math.min(0.002, duration / 10)) / 2;
    const omegaBudget = Math.sqrt(
      Math.max(0, (BAT_ANGULAR_ACCEL_LIMIT_RADPS2 * segmentSeconds) ** 2 - (len(twist.omega) / 2) ** 2),
    );
    const gripBudget = Math.sqrt(
      Math.max(0, (BAT_GRIP_ACCEL_LIMIT_MPS2 * segmentSeconds) ** 2 - (len(twist.gripV) / 2) ** 2),
    );
    for (const ws1 of [-1, 0, 1])
      for (const ws2 of [-1, 0, 1]) {
        if (ws1 !== 0 && ws2 !== 0) continue;
        for (const vs1 of [-1, 0, 1])
          for (const vs2 of [-1, 0, 1]) {
            if (vs1 !== 0 && vs2 !== 0) continue;
            const wm = addScaled(addScaled(omegaMid, we1, ws1 * omegaBudget * 0.95), we2, ws2 * omegaBudget * 0.95);
            const vm = addScaled(addScaled(gripMid, ve1, vs1 * gripBudget * 0.95), ve2, vs2 * gripBudget * 0.95);
            const pre = halfPath(geometry.pose, twist.gripV, twist.omega, vm, wm, duration, -1).reverse();
            const post = halfPath(geometry.pose, twist.gripV, twist.omega, vm, wm, duration, 1);
            const samples = [...pre.slice(0, -1), ...post];
            diagnostics.paths++;
            const extrema = samples.map(sampleCaps).reduce((a, b) => ({
              gripSpeed: Math.max(a.gripSpeed, b.gripSpeed),
              angularSpeed: Math.max(a.angularSpeed, b.angularSpeed),
              pointSpeed: Math.max(a.pointSpeed, b.pointSpeed),
              gripAccel: Math.max(a.gripAccel, b.gripAccel),
              angularAccel: Math.max(a.angularAccel, b.angularAccel),
              pointAccel: Math.max(a.pointAccel, b.pointAccel),
            }));
            const penalty = capPenalty(extrema);
            if (penalty < diagnostics.minimumCapPenalty) {
              diagnostics.minimumCapPenalty = penalty;
              diagnostics.bestCaps = extrema;
            }
            if (
              extrema.gripSpeed > BAT_GRIP_SPEED_LIMIT_MPS + 1e-9 ||
              extrema.angularSpeed > BAT_ANGULAR_SPEED_LIMIT_RADPS + 1e-9 ||
              extrema.pointSpeed > BAT_POINT_SPEED_LIMIT_MPS + 1e-9 ||
              extrema.gripAccel > BAT_GRIP_ACCEL_LIMIT_MPS2 + 1e-9 ||
              extrema.angularAccel > BAT_ANGULAR_ACCEL_LIMIT_RADPS2 + 1e-9 ||
              extrema.pointAccel > BAT_POINT_ACCEL_LIMIT_MPS2 + 1e-9
            )
              continue;
            diagnostics.capPass++;
            if (diagnoseHalves && diagnostics.preRootPass === 0 && solveDenseBody(pre, geometry.body))
              diagnostics.preRootPass++;
            if (diagnoseHalves && diagnostics.postRootPass === 0 && solveDenseBody(post, geometry.body))
              diagnostics.postRootPass++;
            const solved = solveDenseBody(samples, geometry.body);
            if (!solved) continue;
            diagnostics.rootPass++;
            diagnostics.densePass++;
            const contactVelocity = add(twist.gripV, cross(twist.omega, sub(geometry.point, geometry.pose.grip)));
            const witness = {
              fraction: twist.fraction,
              steering: [ws1, ws2, vs1, vs2] as const,
              root: solved.root.offset,
              crouchM: solved.root.crouchM,
              caps: extrema,
              gap: solved.gap,
              contactSpeedError: dist(contactVelocity, geometry.desired),
            };
            if (!best || witness.gap > best.gap) best = witness;
          }
      }
  }
  return { witness: best, diagnostics };
}

describe.skipIf(!ENABLED)('manual generalized rigid-bat path feasibility oracle', () => {
  it('certifies the bounded zero-net quintic loop family on exact locked CTL4 ball-2 at 23 m/s', () => {
    const plan = { variation: 'stock', lengthM: 4.5, lineM: -0.05, speedKph: 138 } as const;
    const source = lockedControlSource(2, plan);
    const candidates = productionContactGeometryCandidates(
      plan,
      23,
      'locked-ctl4-2-loop',
      {
        power: source.swing.power,
        elevation: source.swing.elevation,
        directionDeg: source.swing.directionDeg,
      },
      source,
    );
    const contactFeasible = candidates
      .map((geometry, index) => ({
        index,
        geometry,
        contactRoot: solveBatterRootOffsetForPoses([geometry.pose], geometry.body),
      }))
      .filter((entry) => entry.contactRoot.solved);
    expect(
      contactFeasible.length,
      'the exact locked production contact grid must contain a contact-feasible pose',
    ).toBeGreaterThan(0);
    const searches: Array<{ index: number; label: string; search: LoopSearchReport }> = [];
    let witnessed: { index: number; geometry: ContactGeometry; search: LoopSearchReport } | null = null;
    for (const entry of contactFeasible) {
      const search = findQuinticLoopWitness(entry.geometry);
      searches.push({ index: entry.index, label: entry.geometry.label, search });
      if (search.witness) {
        witnessed = { index: entry.index, geometry: entry.geometry, search };
        break;
      }
    }
    const minimumDuration =
      searches
        .flatMap((entry) =>
          entry.search.minimumCertifiedDuration
            ? [{ index: entry.index, label: entry.label, ...entry.search.minimumCertifiedDuration }]
            : [],
        )
        .sort((left, right) => left.seconds - right.seconds || left.index - right.index)[0] ?? null;
    const aggregate = searches.reduce(
      (value, entry) => ({
        splitCount: value.splitCount + entry.search.splitCount,
        analyticallyLegalSplits: value.analyticallyLegalSplits + entry.search.analyticallyLegalSplits,
        availableDurationSplits: value.availableDurationSplits + entry.search.availableDurationSplits,
        sampledCapPass: value.sampledCapPass + entry.search.sampledCapPass,
        anatomyAttempts: value.anatomyAttempts + entry.search.anatomyAttempts,
      }),
      { splitCount: 0, analyticallyLegalSplits: 0, availableDurationSplits: 0, sampledCapPass: 0, anatomyAttempts: 0 },
    );
    const first = contactFeasible[0];
    const report = {
      scope: {
        seed: source.flight.seed,
        gesture: source.key,
        targetContactPointSpeedMps: 23,
        availableBeforeS: first.geometry.beforeS,
        availableAfterS: first.geometry.afterS,
        productionContactCandidates: candidates.length,
        contactFeasibleCandidates: contactFeasible.length,
        geometriesSearched: searches.length,
        searchComplete: witnessed === null && searches.length === contactFeasible.length,
        endpointCondition: 'same pose; zero velocity and acceleration',
        loopFamily: 'quintic Hermite zero-net pre/post; fixed world contact-omega axis',
        splitOrder: '513 fractions, 1 down to 0 inclusive',
        duration: 'smallest analytically capped duration, >=20ms, bounded by authored pre/post windows',
        certificate: `10-level subdivided Bernstein derivative hull + ${BAT_ENCLOSING_RADIUS_M}m whole-bat radius`,
        limitation:
          'no-witness applies only to this exact production grid, fixed-axis quintic loop family and conservative enclosing-radius certificate; never to all static-root paths',
      },
      desiredContactVelocityMps: len(first.geometry.desired),
      polynomialBounds: { d1: LOOP_D1_BOUND, d2: LOOP_D2_BOUND },
      aggregate,
      minimumDuration,
      witnessed,
    };
    console.info(`BAT_LOCKED_QUINTIC_LOOP_ORACLE ${JSON.stringify(report)}`);
    expect(aggregate.splitCount).toBe(513 * searches.length);
    expect(witnessed, report.scope.limitation).toBeNull();
    expect(searches.length).toBe(contactFeasible.length);
    expect(aggregate.availableDurationSplits).toBe(0);
    expect(minimumDuration).not.toBeNull();
    expect(minimumDuration!.seconds).toBeGreaterThan(Math.min(first.geometry.beforeS, first.geometry.afterS));
  }, 120_000);

  it('measures yorker contact articulation without freezing a Unity shoulder bound', () => {
    const candidates = contactGeometryCandidates(
      { variation: 'yorker', lengthM: 0.9, lineM: 0.02, speedKph: 140 },
      13.2,
      'yorker-dynamic-contact',
      { power: 0.4, elevation: 0.05 },
    );
    const unbounded: DynamicShoulderBounds = {
      maxMidpointDisplacementM: Number.POSITIVE_INFINITY,
      maxIndividualShoulderDisplacementM: Number.POSITIVE_INFINITY,
      maxYawRad: 0,
      maxMidpointSpeedMps: Number.POSITIVE_INFINITY,
      maxMidpointAccelerationMps2: Number.POSITIVE_INFINITY,
      maxIndividualShoulderSpeedMps: Number.POSITIVE_INFINITY,
      maxIndividualShoulderAccelerationMps2: Number.POSITIVE_INFINITY,
      maxYawSpeedRadps: Number.POSITIVE_INFINITY,
      maxYawAccelerationRadps2: Number.POSITIVE_INFINITY,
      yawIntervals: 1,
      allowContactArticulation: true,
      requireUnarticulatedStart: false,
      requireUnarticulatedEnd: false,
    };
    const measured = candidates
      .map((geometry) => {
        const sample: KinematicSample = {
          t: 0,
          pose: geometry.pose,
          gripV: v3(),
          gripA: v3(),
          omega: v3(),
          alpha: v3(),
        };
        return { geometry, result: certifyDynamicShoulderPath([sample], geometry.body, unbounded, 0) };
      })
      .filter((value) => value.result.feasible)
      .sort(
        (left, right) =>
          left.result.required.individualShoulderDisplacementM -
            right.result.required.individualShoulderDisplacementM ||
          left.result.required.midpointDisplacementM - right.result.required.midpointDisplacementM ||
          left.geometry.label.localeCompare(right.geometry.label),
      );
    console.info(
      `YORKER_DYNAMIC_CONTACT_ORACLE ${JSON.stringify(
        measured[0]
          ? {
              selected: measured[0].geometry.label,
              required: measured[0].result.required,
              contactArticulation: measured[0].result.contactArticulation,
            }
          : null,
      )}`,
    );
    expect(measured.length).toBeGreaterThan(0);
    expect(measured[0].result.contactArticulation!.midpointM).toBeGreaterThan(0);
  });

  it('pairs independently steered pre/post paths on the least-moved CTL4 body at 23 m/s', () => {
    const plan = { variation: 'stock', lengthM: 4.5, lineM: -0.05, speedKph: 138 } as const;
    const feasible = contactGeometryCandidates(plan, 23, 'ctl4-half')
      .map((geometry) => ({ geometry, root: solveBatterRootOffsetForPoses([geometry.pose], geometry.body) }))
      .filter((value) => value.root.solved)
      .sort(
        (left, right) =>
          left.root.crouchM - right.root.crouchM ||
          Math.hypot(left.root.offset.x, left.root.offset.z) - Math.hypot(right.root.offset.x, right.root.offset.z),
      );
    const attempts = [];
    for (const selected of [feasible[2] ?? feasible[0]]) {
      const result = findIndependentHalfWitness(selected.geometry);
      attempts.push({ selected: selected.geometry.label, ...result });
      if (result.witness) break;
    }
    console.info(`BAT_INDEPENDENT_HALF_ORACLE ${JSON.stringify(attempts)}`);
    expect(feasible.length).toBeGreaterThan(0);
  }, 120_000);

  it('scans planner-ordered contact locations and blade rolls before testing a path', () => {
    const cases = [
      {
        plan: { variation: 'stock', lengthM: 2.5, lineM: 0, speedKph: 120 } as const,
        speed: 23,
        label: 'ctl4-0',
        swing: { power: 1, elevation: 0.1 },
      },
      {
        plan: { variation: 'stock', lengthM: 3.5, lineM: 0.05, speedKph: 130 } as const,
        speed: 23,
        label: 'ctl4-1',
        swing: { power: 1, elevation: 0.1 },
      },
      {
        plan: { variation: 'stock', lengthM: 4.5, lineM: -0.05, speedKph: 138 } as const,
        speed: 23,
        label: 'ctl4-2',
        swing: { power: 1, elevation: 0.1 },
      },
      {
        plan: { variation: 'yorker', lengthM: 0.9, lineM: 0.02, speedKph: 140 } as const,
        speed: 13.2,
        label: 'yorker',
        swing: { power: 0.4, elevation: 0.05 },
      },
    ];
    const report = cases.map((entry) => {
      const candidates = contactGeometryCandidates(entry.plan, entry.speed, entry.label, entry.swing);
      const feasible = candidates
        .map((geometry) => ({ geometry, root: solveBatterRootOffsetForPoses([geometry.pose], geometry.body) }))
        .filter((value) => value.root.solved)
        .sort(
          (left, right) =>
            left.root.crouchM - right.root.crouchM ||
            Math.hypot(left.root.offset.x, left.root.offset.z) - Math.hypot(right.root.offset.x, right.root.offset.z),
        );
      return {
        label: entry.label,
        candidates: candidates.length,
        feasible: feasible.length,
        first: feasible[0] ? { label: feasible[0].geometry.label, root: feasible[0].root } : null,
        choices: feasible.slice(0, 10).map((value) => ({ label: value.geometry.label, root: value.root })),
      };
    });
    console.info(`BAT_CONTACT_ORACLE ${JSON.stringify(report)}`);
    expect(report).toHaveLength(4);
  }, 120_000);

  it('searches locked CTL4 contact geometries at 23 and 24 m/s without changing gameplay', () => {
    const plans = [
      { variation: 'stock', lengthM: 2.5, lineM: 0, speedKph: 120 },
      { variation: 'stock', lengthM: 3.5, lineM: 0.05, speedKph: 130 },
      { variation: 'stock', lengthM: 4.5, lineM: -0.05, speedKph: 138 },
    ] as const;
    const results = [];
    for (let index = 0; index < plans.length; index++) {
      for (const speed of [23, 24]) {
        const feasible = contactGeometryCandidates(plans[index], speed, `ctl4-${index}`)
          .map((geometry) => ({ geometry, root: solveBatterRootOffsetForPoses([geometry.pose], geometry.body) }))
          .filter((value) => value.root.solved)
          .sort(
            (left, right) =>
              left.root.crouchM - right.root.crouchM ||
              Math.hypot(left.root.offset.x, left.root.offset.z) - Math.hypot(right.root.offset.x, right.root.offset.z),
          );
        const geometry = feasible[0]?.geometry;
        const search = geometry ? findWitness(geometry) : null;
        results.push({
          label: `ctl4-${index}@${speed}`,
          desiredMps: geometry ? len(geometry.desired) : null,
          contactFeasible: feasible.length,
          selected: geometry?.label ?? null,
          ...(search ?? { witness: null, diagnostics: null }),
        });
      }
    }
    const yorkerCandidates = contactGeometryCandidates(
      { variation: 'yorker', lengthM: 0.9, lineM: 0.02, speedKph: 140 },
      13.2,
      'yorker-straight',
      { power: 0.4, elevation: 0.05 },
    )
      .map((geometry) => ({ geometry, root: solveBatterRootOffsetForPoses([geometry.pose], geometry.body) }))
      .filter((value) => value.root.solved);
    const yorker = yorkerCandidates[0]?.geometry;
    results.push({
      label: 'yorker-straight@13.2',
      desiredMps: yorker ? len(yorker.desired) : null,
      contactFeasible: yorkerCandidates.length,
      selected: yorker?.label ?? null,
      ...(yorker ? findWitness(yorker) : { witness: null, diagnostics: null }),
    });
    console.info(`BAT_PATH_ORACLE ${JSON.stringify(results)}`);
    expect(results).toHaveLength(7);
  }, 120_000);
});
