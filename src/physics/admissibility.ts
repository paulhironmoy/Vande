/** Continuous anatomical admissibility for a visible/colliding bat pose. */
import { BLADE_HALF_W, BLADE_L, BLADE_T, BODY, LOWER_HAND_FROM_CAP, TOP_HAND_FROM_CAP } from './constants';
import type { BatPose, BatterBody } from './bat';
import {
  bladeFrame,
  bladeGroundSupportY,
  handleCapsule,
  handleGroundSupportY,
  pointBladeDistance,
  pointSegmentDistance,
  segmentBladeDistance,
  segmentSegmentDistance,
} from './batGeometry';
import { type Vec3, len, norm, v3 } from './vec';

/**
 * Ordered shoulder-to-hand reach of the 1.78 m reference batter (the body BODY describes; the Unity hero's
 * ReferenceHeightMetres). Anthropometric segment lengths (Drillis & Contini 1966, as tabulated in D. A. Winter,
 * "Biomechanics and Motor Control of Human Movement", Table 4.1): upper arm 0.186 H and forearm 0.146 H, so the
 * shoulder-elbow-wrist chain is 0.332 × 1.78 = 0.591 m. The same 20.1 mm non-singular-elbow reserve the rig uses
 * leaves 0.571 m; physics binds 1 mm inside it. The wrist-to-glove-centre distance (about 0.08 m) is deliberately
 * not added: the reach stays a conservative wrist-joint bound.
 *
 * Simulation 3 previously bound this to the licensed hero mesh's own arm chain (0.475 m, 80% of the anthropometric
 * value for its stature). With an upright torso and an 18 cm crouch that put every ball below about 0.19 m at a
 * forward contact plane out of reach of the lower hand, and the planner then cut bat speed to 1-7 m/s or substituted
 * a slow whiff (wedge physics REPORT §1). A presentation rig that cannot reach these poses is a rig defect.
 */
export const BAT_HAND_REACH_M = 0.57;
/** Internal planning reserve: the pre-collision geometry solve aims 1 mm inside the binding reach gate. */
export const BAT_HAND_REACH_SOLVE_M = 0.569;
/** Maximum static whole-athlete x/z retarget; every collider and the rendered root move together. */
export const BAT_BODY_RETARGET_M = 0.18;
/**
 * Maximum planted lowering of the upper body. Contract v6 bounds `batterPosture.crouchM` to 0.18 m on the wire
 * (src/contracts/unityPractice.ts, Unity BridgeConstants.MaxBatterCrouchMetres, the Android validator), so physics
 * stays inside it. With the anthropometric reach above it is sufficient for every reference-over stroke; a deeper
 * lunge (about 0.3 m from the same proportions) would need a contract change first.
 */
export const BAT_POSTURE_CROUCH_MAX_M = 0.18;
export const BAT_HEAD_NECK_CLEARANCE_M = 0.01;
export const BAT_NECK_R_M = 0.075;
/** Shipped VSK upper-arm joint centres relative to the canonical torso-top/root reference. */
export const BAT_SHOULDER_X_M = 0.187264;
export const BAT_SHOULDER_Y_M = 0.013219;
export const BAT_SHOULDER_Z_M = 0.015605;
export const BAT_TOE_GROUND_M = 0.005;

export interface BatPoseAdmissibility {
  /** Minimum signed margin. A pose is admissible iff this is non-negative. */
  gap: number;
  reachGap: number;
  helmetGap: number;
  neckGap: number;
  torsoGap: number;
  padGap: number;
  toeGap: number;
  /** Maximum shoulder-to-hand distance against the already shifted body. */
  reach: number;
}

interface PlanarPoint { x: number; z: number }

interface ReachDisk { centre: PlanarPoint; radius: number }

/** Replay-stable planar magnitude using only basic arithmetic and correctly-rounded sqrt. */
function planarMagnitude(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}

/** Canonical ordered shoulder centres: x− is the right-handed batter's left/top-hand shoulder after Unity yaw 180°. */
export function batterShoulders(body: BatterBody): readonly [Vec3, Vec3] {
  return [
    v3(body.torso.b.x - BAT_SHOULDER_X_M, body.torso.b.y + BAT_SHOULDER_Y_M, body.torso.b.z + BAT_SHOULDER_Z_M),
    v3(body.torso.b.x + BAT_SHOULDER_X_M, body.torso.b.y + BAT_SHOULDER_Y_M, body.torso.b.z + BAT_SHOULDER_Z_M),
  ];
}

function planarDistance(a: PlanarPoint, b: PlanarPoint): number {
  return planarMagnitude(a.x - b.x, a.z - b.z);
}

function minimumTwoDiskOffset(first: ReachDisk, second: ReachDisk): PlanarPoint | null {
  const candidates: PlanarPoint[] = [];
  const inside = (point: PlanarPoint, disk: ReachDisk) => planarDistance(point, disk.centre) <= disk.radius + 1e-12;
  const radial = (disk: ReachDisk): PlanarPoint => {
    const d = planarMagnitude(disk.centre.x, disk.centre.z);
    if (d <= disk.radius || d === 0) return { x: 0, z: 0 };
    const scale = 1 - disk.radius / d;
    return { x: disk.centre.x * scale, z: disk.centre.z * scale };
  };
  const origin = { x: 0, z: 0 };
  if (inside(origin, first) && inside(origin, second)) candidates.push(origin);
  const firstRadial = radial(first);
  if (inside(firstRadial, second)) candidates.push(firstRadial);
  const secondRadial = radial(second);
  if (inside(secondRadial, first)) candidates.push(secondRadial);
  const dx = second.centre.x - first.centre.x;
  const dz = second.centre.z - first.centre.z;
  const d = planarMagnitude(dx, dz);
  if (d > 1e-15 && d <= first.radius + second.radius + 1e-12 && d >= Math.abs(first.radius - second.radius) - 1e-12) {
    const along = (first.radius * first.radius - second.radius * second.radius + d * d) / (2 * d);
    const height = Math.sqrt(Math.max(0, first.radius * first.radius - along * along));
    const ux = dx / d;
    const uz = dz / d;
    const base = { x: first.centre.x + ux * along, z: first.centre.z + uz * along };
    const perpendicular = { x: -uz * height, z: ux * height };
    candidates.push(
      { x: base.x + perpendicular.x, z: base.z + perpendicular.z },
      { x: base.x - perpendicular.x, z: base.z - perpendicular.z },
    );
  }
  let best: PlanarPoint | null = null;
  let bestNorm = Infinity;
  for (const point of candidates) {
    if (!inside(point, first) || !inside(point, second)) continue;
    const pointNorm = planarMagnitude(point.x, point.z);
    if (pointNorm < bestNorm) {
      best = point;
      bestNorm = pointNorm;
    }
  }
  return best;
}

function reachDisks(pose: BatPose, body: BatterBody, reachLimit: number): ReachDisk[] | null {
  const bladeAxis = norm(sub(pose.grip, pose.toe));
  const topHand = addScaled(pose.grip, bladeAxis, -TOP_HAND_FROM_CAP);
  const lowerHand = addScaled(pose.grip, bladeAxis, -LOWER_HAND_FROM_CAP);
  const [topShoulder, lowerShoulder] = batterShoulders(body);
  const pairs = [[topShoulder, topHand], [lowerShoulder, lowerHand]] as const;
  const disks: ReachDisk[] = [];
  for (const [shoulder, hand] of pairs) {
    const vertical = hand.y - shoulder.y;
    if (Math.abs(vertical) > reachLimit) return null;
    disks.push({
      centre: { x: hand.x - shoulder.x, z: hand.z - shoulder.z },
      radius: Math.sqrt(Math.max(0, reachLimit * reachLimit - vertical * vertical)),
    });
  }
  return disks;
}

function projectIntoDisk(point: PlanarPoint, disk: ReachDisk): PlanarPoint {
  const dx = point.x - disk.centre.x;
  const dz = point.z - disk.centre.z;
  const distance = planarMagnitude(dx, dz);
  if (distance <= disk.radius || distance === 0) return point;
  const scale = disk.radius / distance;
  return { x: disk.centre.x + dx * scale, z: disk.centre.z + dz * scale };
}

/**
 * Unique minimum-norm point in an intersection of reach disks. Dykstra's cyclic projection is deterministic and
 * x-mirror equivariant: the fixed pose-time/ordered-hand sequence is mirrored, never reordered. A finite iteration
 * cap may reject a feasible near-tangent case, but can never accept an infeasible one.
 */
function minimumReachOffset(disks: ReachDisk[]): PlanarPoint | null {
  if (disks.length === 0) return { x: 0, z: 0 };
  if (disks.length === 2) return minimumTwoDiskOffset(disks[0], disks[1]);
  let point = { x: 0, z: 0 };
  const corrections = disks.map(() => ({ x: 0, z: 0 }));
  let converged = false;
  for (let cycle = 0; cycle < 160; cycle++) {
    let movement = 0;
    for (let i = 0; i < disks.length; i++) {
      const before = point;
      const corrected = { x: point.x + corrections[i].x, z: point.z + corrections[i].z };
      const projected = projectIntoDisk(corrected, disks[i]);
      corrections[i] = { x: corrected.x - projected.x, z: corrected.z - projected.z };
      point = projected;
      movement = Math.max(movement, planarDistance(before, point));
    }
    let violation = 0;
    for (const disk of disks) violation = Math.max(violation, planarDistance(point, disk.centre) - disk.radius);
    if (violation <= 1e-11 && movement <= 1e-11) {
      converged = true;
      break;
    }
  }
  if (!converged) return null;
  for (const disk of disks) {
    if (planarDistance(point, disk.centre) > disk.radius + 1e-9) return null;
  }
  return point;
}

interface PreparedReachConstraints {
  /** Fixed pose-time/ordered-hand sequence: top, lower for each pose, exactly as the oracle builds its disks. */
  centreX: Float64Array;
  centreZ: Float64Array;
  centreNorm: Float64Array;
  handY: Float64Array;
  verticalAtUpright: Float64Array;
  minimumVerticalCrouch: number;
  maximumVerticalCrouch: number;
  torsoTopY: number;
}

/** Pose/hand geometry is invariant across the 181 crouch probes; only each reach-disk radius changes. */
function prepareReachConstraints(poses: readonly BatPose[], body: BatterBody, reachLimit: number): PreparedReachConstraints {
  const shoulders = batterShoulders(body);
  const count = poses.length * 2;
  const centreX = new Float64Array(count);
  const centreZ = new Float64Array(count);
  const centreNorm = new Float64Array(count);
  const handY = new Float64Array(count);
  const verticalAtUpright = new Float64Array(count);
  let minimumVerticalCrouch = 0;
  let maximumVerticalCrouch = BAT_POSTURE_CROUCH_MAX_M;
  let index = 0;
  for (const pose of poses) {
    const bladeAxis = norm(sub(pose.grip, pose.toe));
    const hands = [
      addScaled(pose.grip, bladeAxis, -TOP_HAND_FROM_CAP),
      addScaled(pose.grip, bladeAxis, -LOWER_HAND_FROM_CAP),
    ] as const;
    for (let hand = 0; hand < hands.length; hand++) {
      const value = hands[hand];
      const shoulder = shoulders[hand];
      const x = value.x - shoulder.x;
      const z = value.z - shoulder.z;
      const vertical = value.y - shoulder.y;
      centreX[index] = x;
      centreZ[index] = z;
      centreNorm[index] = planarMagnitude(x, z);
      handY[index] = value.y;
      verticalAtUpright[index] = vertical;
      minimumVerticalCrouch = Math.max(minimumVerticalCrouch, -reachLimit - vertical);
      maximumVerticalCrouch = Math.min(maximumVerticalCrouch, reachLimit - vertical);
      index++;
    }
  }
  return {
    centreX,
    centreZ,
    centreNorm,
    handY,
    verticalAtUpright,
    minimumVerticalCrouch,
    maximumVerticalCrouch,
    torsoTopY: body.torso.b.y,
  };
}

/**
 * Allocation-free scalar form of the oracle's exact Dykstra loop. Pose/hand order, 160-cycle cap and every
 * convergence/final tolerance are intentionally identical; the caller owns and clears the correction buffers.
 */
function minimumReachOffsetPrepared(
  prepared: PreparedReachConstraints,
  radii: Float64Array,
  correctionX: Float64Array,
  correctionZ: Float64Array,
): PlanarPoint | null {
  const count = radii.length;
  if (count === 0) return { x: 0, z: 0 };
  if (count === 2) {
    return minimumTwoDiskOffset(
      { centre: { x: prepared.centreX[0], z: prepared.centreZ[0] }, radius: radii[0] },
      { centre: { x: prepared.centreX[1], z: prepared.centreZ[1] }, radius: radii[1] },
    );
  }

  // Exact origin shortcut: Dykstra starts at zero and would project nowhere when zero is in every disk.
  let originInside = true;
  for (let i = 0; i < count; i++) {
    if (prepared.centreNorm[i] > radii[i]) {
      originInside = false;
      break;
    }
  }
  if (originInside) return { x: 0, z: 0 };

  // Do not add pairwise or root-cap pre-prunes here. The retained Dykstra path intentionally accepts up to its
  // 1e-11 convergence and 1e-9 final residuals; an apparently disjoint pair can therefore still be an oracle-valid
  // near-tangent solution (a measured 5 pm pair gap is one such case). Scalarization and vertical pruning retain the
  // speedup without changing that numerical acceptance contract.

  // Exact necessary condition, not a heuristic pre-prune: the loop below accepts a point only within radius + 1e-9 of
  // every centre, so two centres farther apart than both radii + 2e-9 admit none and the loop must return null. The
  // 1e-7 margin (50× that acceptance slack) leaves every near-tangent case, such as the measured 5 pm pair gap, to the
  // full loop; only pairs disjoint by at least 0.1 µm, which can never pass the final residual check, return early.
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      if (planarMagnitude(prepared.centreX[i] - prepared.centreX[j], prepared.centreZ[i] - prepared.centreZ[j])
        > radii[i] + radii[j] + 1e-7) return null;
    }
  }

  correctionX.fill(0);
  correctionZ.fill(0);
  let pointX = 0;
  let pointZ = 0;
  let converged = false;
  for (let cycle = 0; cycle < 160; cycle++) {
    let movement = 0;
    for (let i = 0; i < count; i++) {
      const beforeX = pointX;
      const beforeZ = pointZ;
      const correctedX = pointX + correctionX[i];
      const correctedZ = pointZ + correctionZ[i];
      const dx = correctedX - prepared.centreX[i];
      const dz = correctedZ - prepared.centreZ[i];
      const planar = planarMagnitude(dx, dz);
      if (planar <= radii[i] || planar === 0) {
        pointX = correctedX;
        pointZ = correctedZ;
      } else {
        const scale = radii[i] / planar;
        pointX = prepared.centreX[i] + dx * scale;
        pointZ = prepared.centreZ[i] + dz * scale;
      }
      correctionX[i] = correctedX - pointX;
      correctionZ[i] = correctedZ - pointZ;
      movement = Math.max(movement, planarMagnitude(beforeX - pointX, beforeZ - pointZ));
    }
    let violation = 0;
    for (let i = 0; i < count; i++) {
      violation = Math.max(
        violation,
        planarMagnitude(pointX - prepared.centreX[i], pointZ - prepared.centreZ[i]) - radii[i],
      );
    }
    if (violation <= 1e-11 && movement <= 1e-11) {
      converged = true;
      break;
    }
  }
  if (!converged) return null;
  for (let i = 0; i < count; i++) {
    if (planarMagnitude(pointX - prepared.centreX[i], pointZ - prepared.centreZ[i]) > radii[i] + 1e-9) return null;
  }
  return { x: pointX, z: pointZ };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return v3(a.x - b.x, a.y - b.y, a.z - b.z);
}

function addScaled(a: Vec3, b: Vec3, scale: number): Vec3 {
  return v3(a.x + b.x * scale, a.y + b.y * scale, a.z + b.z * scale);
}

function distance(a: Vec3, b: Vec3): number {
  return len(sub(a, b));
}

function shiftedVec(value: Vec3, shift: PlanarPoint): Vec3 {
  return v3(value.x + shift.x, value.y, value.z + shift.z);
}

function shiftedCapsule(value: { a: Vec3; b: Vec3; r: number }, shift: PlanarPoint) {
  return { a: shiftedVec(value.a, shift), b: shiftedVec(value.b, shift), r: value.r };
}

/** Translate the complete planted batter consistently; bat and ball remain in the unchanged pitch frame. */
export function translateBatterBody(body: BatterBody, shift: PlanarPoint): BatterBody {
  return {
    footwork: body.footwork,
    stance: shiftedVec(body.stance, shift),
    pads: [shiftedCapsule(body.pads[0], shift), shiftedCapsule(body.pads[1], shift)],
    torso: shiftedCapsule(body.torso, shift),
    head: { c: shiftedVec(body.head.c, shift), r: body.head.r },
  };
}

/**
 * Low-ball back-foot reads can author part of the same 180 mm knee-bend envelope before the root solver runs.
 * Measure that already-applied lowering from the canonical torso top so authored plus solved crouch can never exceed
 * the binding posture cap. Other footwork frames retain the full dynamic allowance.
 */
export function remainingBatterPostureCrouchM(body: BatterBody): number {
  const authored = body.footwork === 'back'
    ? Math.max(0, Math.min(BAT_POSTURE_CROUCH_MAX_M, BODY.torsoTop - body.torso.b.y))
    : 0;
  return BAT_POSTURE_CROUCH_MAX_M - authored;
}

/** Apply one planted crouch: feet/pad bottoms stay on the ground; every upper-body collider lowers together. */
export function applyBatterPosture(body: BatterBody, crouchM: number): BatterBody {
  const crouch = Math.max(0, Math.min(remainingBatterPostureCrouchM(body), crouchM));
  const lower = (value: Vec3): Vec3 => v3(value.x, value.y - crouch, value.z);
  return {
    footwork: body.footwork,
    stance: body.stance,
    pads: [
      { a: body.pads[0].a, b: lower(body.pads[0].b), r: body.pads[0].r },
      { a: body.pads[1].a, b: lower(body.pads[1].b), r: body.pads[1].r },
    ],
    torso: { a: lower(body.torso.a), b: lower(body.torso.b), r: body.torso.r },
    head: { c: lower(body.head.c), r: body.head.r },
  };
}

/**
 * Signed anatomical margins for one rigid bat pose. Min/max/distance are continuous, so `gap` has no boolean cliff
 * and can be used directly by conservative advancement. The physics frame is right-handed; mirroring every x once
 * leaves every component unchanged.
 */
export function batPoseAdmissibility(pose: BatPose, body: BatterBody): BatPoseAdmissibility {
  const bladeAxis = norm(sub(pose.grip, pose.toe));
  const topHand = addScaled(pose.grip, bladeAxis, -TOP_HAND_FROM_CAP);
  const lowerHand = addScaled(pose.grip, bladeAxis, -LOWER_HAND_FROM_CAP);
  const shoulders = batterShoulders(body);
  // Canonical physics is always a right-handed frame: left shoulder to top hand, right shoulder to lower hand.
  // A left-handed presentation mirrors the completed frame exactly once; it does not swap this simulation solve.
  const reach = Math.max(distance(shoulders[0], topHand), distance(shoulders[1], lowerHand));
  const reachGap = BAT_HAND_REACH_M - reach;

  const frame = bladeFrame(pose);
  const handle = handleCapsule(frame);
  const helmetGap = Math.min(
    pointBladeDistance(frame, body.head.c) - body.head.r - BAT_HEAD_NECK_CLEARANCE_M,
    pointSegmentDistance(body.head.c, handle.a, handle.b) - handle.r - body.head.r - BAT_HEAD_NECK_CLEARANCE_M,
  );
  const neckTop = v3(body.head.c.x, body.head.c.y - body.head.r, body.head.c.z);
  const neckGap = Math.min(
    segmentBladeDistance(frame, body.torso.b, neckTop) - BAT_NECK_R_M - BAT_HEAD_NECK_CLEARANCE_M,
    segmentSegmentDistance(handle.a, handle.b, body.torso.b, neckTop)
      - handle.r - BAT_NECK_R_M - BAT_HEAD_NECK_CLEARANCE_M,
  );
  const capsuleGap = (capsule: { a: Vec3; b: Vec3; r: number }): number => Math.min(
    segmentBladeDistance(frame, capsule.a, capsule.b) - capsule.r,
    segmentSegmentDistance(handle.a, handle.b, capsule.a, capsule.b) - handle.r - capsule.r,
  );
  const torsoGap = capsuleGap(body.torso);
  const padGap = Math.min(capsuleGap(body.pads[0]), capsuleGap(body.pads[1]));
  const toeGap = Math.min(bladeGroundSupportY(frame), handleGroundSupportY(handle)) - BAT_TOE_GROUND_M;
  return {
    gap: Math.min(reachGap, helmetGap, neckGap, torsoGap, padGap, toeGap),
    reachGap,
    helmetGap,
    neckGap,
    torsoGap,
    padGap,
    toeGap,
    reach,
  };
}

const SAT_HALF_L = BLADE_L / 2;
const SAT_HALF_T = BLADE_T / 2;

/**
 * Separating-axis lower bound on the distance from the segment first→second to the canonical blade box: along each
 * box axis the segment's projection and the box's are at least this far apart, and no two points can be closer than
 * any one axis separation. Cheap (the segment's local coordinates only); never above the exact distance.
 */
function axisSeparation(p: number, q: number, half: number): number {
  const low = p < q ? p : q;
  const high = p < q ? q : p;
  return Math.max(0, low - half, -half - high);
}

function segmentBladeLowerBound(
  frame: ReturnType<typeof bladeFrame>,
  first: Vec3,
  second: Vec3,
): number {
  const c = frame.centre;
  const ax = first.x - c.x;
  const ay = first.y - c.y;
  const az = first.z - c.z;
  const bx = second.x - c.x;
  const by = second.y - c.y;
  const bz = second.z - c.z;
  const a = frame.a;
  const w = frame.w;
  const n = frame.n;
  return Math.max(
    axisSeparation(ax * a.x + ay * a.y + az * a.z, bx * a.x + by * a.y + bz * a.z, SAT_HALF_L),
    axisSeparation(ax * w.x + ay * w.y + az * w.z, bx * w.x + by * w.y + bz * w.z, BLADE_HALF_W),
    axisSeparation(ax * n.x + ay * n.y + az * n.z, bx * n.x + by * n.y + bz * n.z, SAT_HALF_T),
  );
}

/** min(running, exact blade-box capsule term), skipping the exact term only when its lower bound cannot lower it. */
function capsuleBladeTerm(frame: ReturnType<typeof bladeFrame>, capsule: { a: Vec3; b: Vec3; r: number }, running: number): number {
  if (segmentBladeLowerBound(frame, capsule.a, capsule.b) - capsule.r - 1e-9 > running) return running;
  return Math.min(running, segmentBladeDistance(frame, capsule.a, capsule.b) - capsule.r);
}

/**
 * The `gap` and `reach` of batPoseAdmissibility, bit-identical, for the hot callers that read nothing else. `gap` is the
 * minimum of the same terms computed by the same functions in the same arithmetic order; a blade-box term is
 * evaluated only when its separating-axis lower bound (minus 1e-9 for rounding) could still lower the running
 * minimum, so a skipped term is provably larger than the result and cannot change it. Non-finite input or a NaN term
 * disables skipping (every comparison with NaN is false), exactly reproducing the full function's NaN.
 */
export function batPoseGapReach(pose: BatPose, body: BatterBody): { gap: number; reach: number } {
  const bladeAxis = norm(sub(pose.grip, pose.toe));
  const topHand = addScaled(pose.grip, bladeAxis, -TOP_HAND_FROM_CAP);
  const lowerHand = addScaled(pose.grip, bladeAxis, -LOWER_HAND_FROM_CAP);
  const shoulders = batterShoulders(body);
  const reach = Math.max(distance(shoulders[0], topHand), distance(shoulders[1], lowerHand));
  const reachGap = BAT_HAND_REACH_M - reach;

  const frame = bladeFrame(pose);
  const handle = handleCapsule(frame);
  let gap = Math.min(
    reachGap,
    Math.min(bladeGroundSupportY(frame), handleGroundSupportY(handle)) - BAT_TOE_GROUND_M,
    pointSegmentDistance(body.head.c, handle.a, handle.b) - handle.r - body.head.r - BAT_HEAD_NECK_CLEARANCE_M,
    pointBladeDistance(frame, body.head.c) - body.head.r - BAT_HEAD_NECK_CLEARANCE_M,
  );
  const neckTop = v3(body.head.c.x, body.head.c.y - body.head.r, body.head.c.z);
  gap = Math.min(
    gap,
    segmentSegmentDistance(handle.a, handle.b, body.torso.b, neckTop) - handle.r - BAT_NECK_R_M - BAT_HEAD_NECK_CLEARANCE_M,
    segmentSegmentDistance(handle.a, handle.b, body.torso.a, body.torso.b) - handle.r - body.torso.r,
    segmentSegmentDistance(handle.a, handle.b, body.pads[0].a, body.pads[0].b) - handle.r - body.pads[0].r,
    segmentSegmentDistance(handle.a, handle.b, body.pads[1].a, body.pads[1].b) - handle.r - body.pads[1].r,
  );
  const neckClearance = BAT_NECK_R_M + BAT_HEAD_NECK_CLEARANCE_M;
  if (!(segmentBladeLowerBound(frame, body.torso.b, neckTop) - neckClearance - 1e-9 > gap)) {
    gap = Math.min(gap, segmentBladeDistance(frame, body.torso.b, neckTop) - BAT_NECK_R_M - BAT_HEAD_NECK_CLEARANCE_M);
  }
  gap = capsuleBladeTerm(frame, body.torso, gap);
  gap = capsuleBladeTerm(frame, body.pads[0], gap);
  gap = capsuleBladeTerm(frame, body.pads[1], gap);
  return { gap, reach };
}

/**
 * One static per-track planted-batter root solve. Candidate translations are exact two-arm disk-intersection extrema;
 * the smallest deterministic candidate must also keep the translated helmet, neck and toe geometry admissible.
 * A missing solve returns zero, after which contact admissibility fails closed rather than moving body parts apart.
 */
export interface BatterRootSolve {
  solved: boolean;
  offset: { x: number; z: number };
  crouchM: number;
}

export function solveBatterRootOffset(pose: BatPose, nominalBody: BatterBody): BatterRootSolve {
  return solveBatterRootOffsetForPoses([pose], nominalBody);
}

/**
 * Retained scalar-reference oracle for equivalence tests. Do not optimize or reorder this implementation: it is the
 * original object-based disk construction and exact Dykstra path against which the production solver is guarded.
 */
export function solveBatterRootOffsetForPosesOracle(poses: readonly BatPose[], nominalBody: BatterBody): BatterRootSolve {
  const maximumCrouchM = remainingBatterPostureCrouchM(nominalBody);
  const solveAt = (crouchM: number): BatterRootSolve => {
    const postured = applyBatterPosture(nominalBody, crouchM);
    const disks: ReachDisk[] = [];
    for (const pose of poses) {
      const pair = reachDisks(pose, postured, BAT_HAND_REACH_SOLVE_M);
      if (!pair) return { solved: false, offset: { x: 0, z: 0 }, crouchM };
      disks.push(...pair);
    }
    let candidate = minimumReachOffset(disks);
    if (!candidate) {
      return { solved: false, offset: { x: 0, z: 0 }, crouchM };
    }
    const candidateNorm = planarMagnitude(candidate.x, candidate.z);
    if (candidateNorm > BAT_BODY_RETARGET_M + 1e-12) {
      return { solved: false, offset: { x: 0, z: 0 }, crouchM };
    }
    // The feasibility solver uses a 1 pm numerical tolerance. Never leak that tolerance into the public body-root
    // contract: a candidate microscopically outside the exact 180 mm cap is projected back to the closed boundary,
    // then subjected to the same reach/anatomy checks below. Projection cannot turn an infeasible pose into a pass.
    if (candidateNorm > BAT_BODY_RETARGET_M) {
      // Stay one femtometre inside so a subsequent planar-magnitude round-trip cannot exceed the exact root cap.
      const scale = (BAT_BODY_RETARGET_M - 1e-15) / candidateNorm;
      candidate = { x: candidate.x * scale, z: candidate.z * scale };
    }
    const shifted = translateBatterBody(postured, candidate);
    for (const pose of poses) {
      const value = batPoseAdmissibility(pose, shifted);
      if (value.gap < -1e-9 || value.reach > BAT_HAND_REACH_SOLVE_M + 1e-9) {
        return { solved: false, offset: { x: 0, z: 0 }, crouchM };
      }
    }
    return { solved: true, offset: candidate, crouchM };
  };

  const upright = solveAt(0);
  if (upright.solved) return upright;

  // Feasible reach in crouch is a bounded interval. Find its first deterministic feasible bracket, then bisect the
  // lower boundary. The 1 mm scan is conservative for any anatomy-induced non-monotonicity; ambiguity fails closed.
  const step = 0.001;
  let previous = 0;
  for (let crouch = step; crouch <= maximumCrouchM + 1e-12; crouch += step) {
    const current = Math.min(maximumCrouchM, crouch);
    const solved = solveAt(current);
    if (!solved.solved) {
      previous = current;
      continue;
    }
    let low = previous;
    let high = current;
    let best = solved;
    for (let iteration = 0; iteration < 28; iteration++) {
      const middle = (low + high) / 2;
      const candidate = solveAt(middle);
      if (candidate.solved) {
        high = middle;
        best = candidate;
      } else {
        low = middle;
      }
    }
    return best;
  }
  return { solved: false, offset: { x: 0, z: 0 }, crouchM: 0 };
}

/** One static root solve for every collision-active pose supplied by the deterministic stroke planner. */
export function solveBatterRootOffsetForPoses(poses: readonly BatPose[], nominalBody: BatterBody): BatterRootSolve {
  const prepared = prepareReachConstraints(poses, nominalBody, BAT_HAND_REACH_SOLVE_M);
  const count = prepared.centreX.length;
  const radii = new Float64Array(count);
  const correctionX = new Float64Array(count);
  const correctionZ = new Float64Array(count);

  const solveAt = (crouchM: number): BatterRootSolve => {
    // This interval is only a necessary vertical-reach condition. Its 1 pm guard prevents a rounding-only reject;
    // the exact per-hand test below remains authoritative and uses the oracle's arithmetic order.
    if (crouchM < prepared.minimumVerticalCrouch - 1e-12
      || crouchM > prepared.maximumVerticalCrouch + 1e-12) {
      return { solved: false, offset: { x: 0, z: 0 }, crouchM };
    }
    for (let i = 0; i < count; i++) {
      const shoulderY = (prepared.torsoTopY - crouchM) + BAT_SHOULDER_Y_M;
      const vertical = prepared.handY[i] - shoulderY;
      if (Math.abs(vertical) > BAT_HAND_REACH_SOLVE_M) {
        return { solved: false, offset: { x: 0, z: 0 }, crouchM };
      }
      radii[i] = Math.sqrt(Math.max(0, BAT_HAND_REACH_SOLVE_M * BAT_HAND_REACH_SOLVE_M - vertical * vertical));
    }
    // Exact root-cap condition: any accepted point lies within radius + 1e-9 of each centre, so its norm is at least
    // |centre| − radius − 1e-9. Beyond the 180 mm cap (plus its 1e-12 guard and a 1e-7 margin) the candidate below
    // would be rejected anyway; the loop is skipped, never a feasible probe.
    for (let i = 0; i < count; i++) {
      if (prepared.centreNorm[i] - radii[i] > BAT_BODY_RETARGET_M + 1e-7) {
        return { solved: false, offset: { x: 0, z: 0 }, crouchM };
      }
    }
    let candidate = minimumReachOffsetPrepared(prepared, radii, correctionX, correctionZ);
    if (!candidate) {
      return { solved: false, offset: { x: 0, z: 0 }, crouchM };
    }
    const candidateNorm = planarMagnitude(candidate.x, candidate.z);
    if (candidateNorm > BAT_BODY_RETARGET_M + 1e-12) {
      return { solved: false, offset: { x: 0, z: 0 }, crouchM };
    }
    // The feasibility solver uses a 1 pm numerical tolerance. Never leak that tolerance into the public body-root
    // contract: a candidate microscopically outside the exact 180 mm cap is projected back to the closed boundary,
    // then subjected to the same reach/anatomy checks below. Projection cannot turn an infeasible pose into a pass.
    if (candidateNorm > BAT_BODY_RETARGET_M) {
      const scale = (BAT_BODY_RETARGET_M - 1e-15) / candidateNorm;
      candidate = { x: candidate.x * scale, z: candidate.z * scale };
    }
    // Construct the complete body only for the one candidate that survived reach/root pruning. The final public
    // anatomy checks remain byte-for-byte the oracle checks; optimization cannot approve a different pose.
    const postured = applyBatterPosture(nominalBody, crouchM);
    const shifted = translateBatterBody(postured, candidate);
    for (const pose of poses) {
      const value = batPoseGapReach(pose, shifted);
      if (value.gap < -1e-9 || value.reach > BAT_HAND_REACH_SOLVE_M + 1e-9) {
        return { solved: false, offset: { x: 0, z: 0 }, crouchM };
      }
    }
    return { solved: true, offset: candidate, crouchM };
  };

  const upright = solveAt(0);
  if (upright.solved) return upright;

  // Preserve the oracle's exact 1 mm ordering and 28-step lower-bound refinement. The interval check merely makes
  // vertically impossible probes constant-time; it does not skip or reorder a potentially feasible crouch.
  const step = 0.001;
  let previous = 0;
  const maximumCrouchM = remainingBatterPostureCrouchM(nominalBody);
  for (let crouch = step; crouch <= maximumCrouchM + 1e-12; crouch += step) {
    const current = Math.min(maximumCrouchM, crouch);
    const solved = solveAt(current);
    if (!solved.solved) {
      previous = current;
      continue;
    }
    let low = previous;
    let high = current;
    let best = solved;
    for (let iteration = 0; iteration < 28; iteration++) {
      const middle = (low + high) / 2;
      const candidate = solveAt(middle);
      if (candidate.solved) {
        high = middle;
        best = candidate;
      } else {
        low = middle;
      }
    }
    return best;
  }
  return { solved: false, offset: { x: 0, z: 0 }, crouchM: 0 };
}
