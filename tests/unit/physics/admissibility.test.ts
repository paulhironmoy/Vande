import { describe, expect, it } from 'vitest';
import {
  BAT_BODY_RETARGET_M,
  BAT_HAND_REACH_M,
  BAT_HAND_REACH_SOLVE_M,
  BAT_SHOULDER_X_M,
  BAT_SHOULDER_Y_M,
  BAT_TOE_GROUND_M,
  applyBatterPosture,
  batterShoulders,
  batPoseAdmissibility,
  solveBatterRootOffset,
  solveBatterRootOffsetForPoses,
  solveBatterRootOffsetForPosesOracle,
  translateBatterBody,
} from '@/physics/admissibility';
import { batPose, batterBody, buildBatTrack, type BatPose, type BatterBody, type Capsule } from '@/physics/bat';
import {
  bladeFrame,
  bladeGroundSupportY,
  handleCapsule,
  handleGroundSupportY,
} from '@/physics/batGeometry';
import { BLADE_L, HANDLE_L, LOWER_HAND_FROM_CAP, TOP_HAND_FROM_CAP } from '@/physics/constants';
import type { Vec3 } from '@/physics/vec';
import { fly, timedSwing } from './physics-helpers';

function mirrorVec(v: Vec3): Vec3 {
  return { x: -v.x, y: v.y, z: v.z };
}

function mirrorCapsule(c: Capsule): Capsule {
  return { a: mirrorVec(c.a), b: mirrorVec(c.b), r: c.r };
}

function mirrorBody(body: BatterBody): BatterBody {
  return {
    footwork: body.footwork,
    stance: mirrorVec(body.stance),
    pads: [mirrorCapsule(body.pads[0]), mirrorCapsule(body.pads[1])],
    torso: mirrorCapsule(body.torso),
    head: { c: mirrorVec(body.head.c), r: body.head.r },
  };
}

function mirrorPose(pose: BatPose): BatPose {
  return { grip: mirrorVec(pose.grip), toe: mirrorVec(pose.toe), n: mirrorVec(pose.n) };
}

function translated(pose: BatPose, delta: Vec3): BatPose {
  const move = (v: Vec3) => ({ x: v.x + delta.x, y: v.y + delta.y, z: v.z + delta.z });
  return { grip: move(pose.grip), toe: move(pose.toe), n: pose.n };
}

const FULL_SOLID_COUNTEREXAMPLE_POSE: BatPose = {
  grip: { x: 0, y: 1.1, z: 0 },
  toe: { x: 0, y: 0.24, z: 0 },
  n: { x: 0, y: 0, z: 1 },
};

/**
 * A synthetic body whose reach, head, neck and ground terms are all clear. `overlap` moves exactly one previously
 * unmodelled solid onto the blade, so these fixtures prove torso/pad rejection rather than merely observing a
 * minimum on a production track.
 */
function fullSolidCounterexampleBody(overlap: 'torso' | 'pad'): BatterBody {
  const farPad = (x: number): Capsule => ({
    a: { x, y: 0.1, z: 0 },
    b: { x, y: 0.7, z: 0 },
    r: 0.05,
  });
  return {
    footwork: null,
    stance: { x: 0, y: 0, z: 0 },
    pads: overlap === 'pad'
      ? [{ a: { x: 0, y: 0.3, z: 0 }, b: { x: 0, y: 0.7, z: 0 }, r: 0.05 }, farPad(1)]
      : [farPad(-1), farPad(1)],
    torso: overlap === 'torso'
      ? { a: { x: 0, y: 0.5, z: 0 }, b: { x: 0.19, y: 1.2, z: 0 }, r: 0.05 }
      : { a: { x: 0.19, y: 0.7, z: 0 }, b: { x: 0.19, y: 1.2, z: 0 }, r: 0.05 },
    head: { c: { x: 1, y: 1.7, z: 0 }, r: 0.1 },
  };
}

/**
 * A lawful vertical bat held beside the canonical stance, with both hands symmetrically placed around shoulder
 * height. Its fixed 350 mm lateral / 80 mm longitudinal demand puts the top-hand reach disk beyond the unshifted
 * root while retaining a unique solution well inside the 180 mm cap. Unlike a swept gameplay track, this geometry
 * cannot disappear when delivery timing or collision sampling changes.
 */
function completeBodyRootFixture(): { pose: BatPose; body: BatterBody } {
  const body = batterBody(null);
  const [topShoulder, lowerShoulder] = batterShoulders(body);
  const handHalfSeparation = (LOWER_HAND_FROM_CAP - TOP_HAND_FROM_CAP) / 2;
  // 0.35 m beyond the shoulders' midpoint overreached the original 0.453 m solve reach by the margin this fixture needs
  // (a nonzero root within the 180 mm cap, no crouch). Keep that same overreach for the anthropometric reach.
  const grip = {
    x: (topShoulder.x + lowerShoulder.x) / 2 + 0.35 + (BAT_HAND_REACH_SOLVE_M - 0.453),
    y: topShoulder.y + handHalfSeparation + TOP_HAND_FROM_CAP,
    z: (topShoulder.z + lowerShoulder.z) / 2 + 0.08,
  };
  return {
    body,
    pose: {
      grip,
      toe: { x: grip.x, y: grip.y - BLADE_L - HANDLE_L, z: grip.z },
      n: { x: 0, y: 0, z: 1 },
    },
  };
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function rendererMirroredReach(pose: BatPose, body: BatterBody): number {
  const axisLength = distance(pose.grip, pose.toe);
  const axis = {
    x: (pose.grip.x - pose.toe.x) / axisLength,
    y: (pose.grip.y - pose.toe.y) / axisLength,
    z: (pose.grip.z - pose.toe.z) / axisLength,
  };
  const topHand = {
    x: pose.grip.x - axis.x * TOP_HAND_FROM_CAP,
    y: pose.grip.y - axis.y * TOP_HAND_FROM_CAP,
    z: pose.grip.z - axis.z * TOP_HAND_FROM_CAP,
  };
  const lower = {
    x: pose.grip.x - axis.x * LOWER_HAND_FROM_CAP,
    y: pose.grip.y - axis.y * LOWER_HAND_FROM_CAP,
    z: pose.grip.z - axis.z * LOWER_HAND_FROM_CAP,
  };
  const shoulders = batterShoulders(body);
  const top = shoulders[1];
  const lowerShoulder = shoulders[0];
  return Math.max(distance(top, topHand), distance(lowerShoulder, lower));
}

function expectSolverEquivalent(poses: readonly BatPose[], body: BatterBody): void {
  const oracle = solveBatterRootOffsetForPosesOracle(poses, body);
  const optimized = solveBatterRootOffsetForPoses(poses, body);
  expect(optimized.solved).toBe(oracle.solved);
  expect(Math.abs(optimized.offset.x - oracle.offset.x)).toBeLessThanOrEqual(1e-10);
  expect(Math.abs(optimized.offset.z - oracle.offset.z)).toBeLessThanOrEqual(1e-10);
  expect(Math.abs(optimized.crouchM - oracle.crouchM)).toBeLessThanOrEqual(1e-10);
  if (!optimized.solved) return;
  const oracleBody = translateBatterBody(applyBatterPosture(body, oracle.crouchM), oracle.offset);
  const optimizedBody = translateBatterBody(applyBatterPosture(body, optimized.crouchM), optimized.offset);
  for (const pose of poses) {
    const oracleResidual = batPoseAdmissibility(pose, oracleBody);
    const optimizedResidual = batPoseAdmissibility(pose, optimizedBody);
    expect(optimizedResidual.gap).toBeGreaterThanOrEqual(oracleResidual.gap - 1e-10);
    expect(optimizedResidual.reach).toBeLessThanOrEqual(oracleResidual.reach + 1e-10);
  }
}

describe('bat-pose anatomical admissibility', () => {
  const flight = fly({ lengthM: 6.5, lineM: 0.05, speedKph: 136 });
  const swing = timedSwing(flight, 0, { directionDeg: 0, power: 0.7, elevation: 0.1 });
  const track = buildBatTrack(flight, swing, { assist: 'real' });
  const pose = batPose(track, track.effT);

  it('mirrors helmet/neck/ground geometry and preserves reach when presentation swaps handedness once', () => {
    const original = batPoseAdmissibility(pose, track.body);
    const mirroredPose = mirrorPose(pose);
    const mirroredBody = mirrorBody(track.body);
    const canonicalMirrored = batPoseAdmissibility(mirroredPose, mirroredBody);
    expect(canonicalMirrored.helmetGap).toBe(original.helmetGap);
    expect(canonicalMirrored.neckGap).toBe(original.neckGap);
    expect(canonicalMirrored.toeGap).toBe(original.toeGap);
    expect(rendererMirroredReach(mirroredPose, mirroredBody)).toBeCloseTo(original.reach, 14);
  });

  it('reports each signed threshold and the minimum as one continuous gap', () => {
    const value = batPoseAdmissibility(pose, track.body);
    expect(value.gap).toBe(Math.min(
      value.reachGap,
      value.helmetGap,
      value.neckGap,
      value.torsoGap,
      value.padGap,
      value.toeGap,
    ));
    expect(value.reachGap).toBe(BAT_HAND_REACH_M - value.reach);
    if (value.reachGap >= 0) expect(value.reach).toBeLessThanOrEqual(BAT_HAND_REACH_M + 1e-12);
    const frame = bladeFrame(pose);
    expect(value.toeGap).toBe(
      Math.min(bladeGroundSupportY(frame), handleGroundSupportY(handleCapsule(frame))) - BAT_TOE_GROUND_M,
    );

    const delta = { x: 1e-6, y: -2e-6, z: 3e-6 };
    const moved = batPoseAdmissibility(translated(pose, delta), track.body);
    const displacement = Math.hypot(delta.x, delta.y, delta.z);
    // A rigid translation changes each distance constraint by no more than the translation itself.
    expect(Math.abs(moved.gap - value.gap)).toBeLessThanOrEqual(displacement + 1e-12);
  });

  it('keeps finite deterministic margins across the whole canonical track', () => {
    for (let i = 0; i <= 512; i++) {
      const t = track.startT + ((track.zoneOut + 0.25 - track.startT) * i) / 512;
      const first = batPoseAdmissibility(batPose(track, t), track.body);
      const second = batPoseAdmissibility(batPose(track, t), track.body);
      expect(first).toEqual(second);
      for (const component of [
        first.gap,
        first.reachGap,
        first.helmetGap,
        first.neckGap,
        first.torsoGap,
        first.padGap,
        first.toeGap,
      ]) {
        expect(Number.isFinite(component)).toBe(true);
      }
    }
  });

  it('rejects a torso intrusion that reach, head, neck and ground-only admission would accept', () => {
    const value = batPoseAdmissibility(
      FULL_SOLID_COUNTEREXAMPLE_POSE,
      fullSolidCounterexampleBody('torso'),
    );
    expect(Math.min(value.reachGap, value.helmetGap, value.neckGap, value.padGap, value.toeGap)).toBeGreaterThan(0);
    expect(value.torsoGap).toBeLessThan(0);
    expect(value.gap).toBe(value.torsoGap);
  });

  it('rejects a pad intrusion that reach, head, neck, torso and ground-only admission would accept', () => {
    const value = batPoseAdmissibility(
      FULL_SOLID_COUNTEREXAMPLE_POSE,
      fullSolidCounterexampleBody('pad'),
    );
    expect(Math.min(value.reachGap, value.helmetGap, value.neckGap, value.torsoGap, value.toeGap)).toBeGreaterThan(0);
    expect(value.padGap).toBeLessThan(0);
    expect(value.gap).toBe(value.padGap);
  });

  it('solves one static complete-body root with the internal reach reserve', () => {
    const { pose: rootPose, body } = completeBodyRootFixture();
    expect(batPoseAdmissibility(rootPose, body).reach).toBeGreaterThan(BAT_HAND_REACH_SOLVE_M);
    const solved = solveBatterRootOffset(rootPose, body);
    expect(solved.solved).toBe(true);
    expect(solved.crouchM).toBe(0);
    expect(solved.offset.x).toBeGreaterThan(0);
    expect(solved.offset.z).toBeGreaterThan(0);
    expect(Math.hypot(solved.offset.x, solved.offset.z)).toBeLessThanOrEqual(BAT_BODY_RETARGET_M + 1e-12);
    expect(solveBatterRootOffset(rootPose, body)).toEqual(solved);
    const shifted = translateBatterBody(body, solved.offset);
    const safe = batPoseAdmissibility(rootPose, shifted);
    expect(safe.gap).toBeGreaterThanOrEqual(-1e-12);
    expect(safe.reach).toBeLessThanOrEqual(BAT_HAND_REACH_SOLVE_M + 1e-12);
    expect(safe.reachGap).toBeGreaterThanOrEqual(0.001 - 1e-12);
    expect(shifted.stance.x).toBe(body.stance.x + solved.offset.x);
    expect(shifted.head.c.z).toBe(body.head.c.z + solved.offset.z);
    expect(shifted.pads[0].a.x).toBe(body.pads[0].a.x + solved.offset.x);
    expect(shifted.torso.b.z).toBe(body.torso.b.z + solved.offset.z);
    for (const [before, after] of [
      [body.stance, shifted.stance],
      [body.pads[0].a, shifted.pads[0].a],
      [body.pads[0].b, shifted.pads[0].b],
      [body.pads[1].a, shifted.pads[1].a],
      [body.pads[1].b, shifted.pads[1].b],
      [body.torso.a, shifted.torso.a],
      [body.torso.b, shifted.torso.b],
      [body.head.c, shifted.head.c],
    ] satisfies [Vec3, Vec3][]) {
      expect(after.x).toBe(before.x + solved.offset.x);
      expect(after.y).toBe(before.y);
      expect(after.z).toBe(before.z + solved.offset.z);
    }
    expect(shifted.footwork).toBe(body.footwork);
    expect(shifted.pads.map(({ r }) => r)).toEqual(body.pads.map(({ r }) => r));
    expect(shifted.torso.r).toBe(body.torso.r);
    expect(shifted.head.r).toBe(body.head.r);
  });

  it('matches the retained oracle on synthetic and production pose sets, including mirrored inputs', () => {
    const nominal = batterBody(track.footwork, flight);
    const production = [track.startT, track.plannedContactT, track.zoneOut]
      .map((time) => batPose(track, time));
    const denseProduction = Array.from({ length: 7 }, (_, index) => (
      batPose(track, track.startT + ((track.zoneOut - track.startT) * index) / 6)
    ));
    const synthetic = [
      translated(production[1], { x: 0.04, y: -0.03, z: 0.02 }),
      translated(production[1], { x: -0.02, y: 0.04, z: -0.05 }),
    ];
    const impossible = [translated(production[1], { x: 0.8, y: 0.8, z: 0.8 })];
    for (const poses of [production, denseProduction, synthetic, impossible]) {
      expectSolverEquivalent(poses, nominal);
      expectSolverEquivalent(poses.map(mirrorPose), mirrorBody(nominal));
    }
  });

  it('preserves the retained oracle acceptance for a picometre near-tangent disk pair', () => {
    const torsoTopY = 1.4;
    const body: BatterBody = {
      footwork: null,
      stance: { x: 0, y: 0, z: 0 },
      pads: [
        { a: { x: -0.15, y: 0.1, z: 0 }, b: { x: -0.15, y: 0.8, z: 0 }, r: 0.05 },
        { a: { x: 0.15, y: 0.1, z: 0 }, b: { x: 0.15, y: 0.8, z: 0 }, r: 0.05 },
      ],
      torso: { a: { x: 0, y: 1, z: 0 }, b: { x: 0, y: torsoTopY, z: 0 }, r: 0.12 },
      head: { c: { x: 0, y: 1.8, z: 0 }, r: 0.1 },
    };
    const shoulderY = torsoTopY + BAT_SHOULDER_Y_M;
    const radius = Math.sqrt(BAT_HAND_REACH_SOLVE_M ** 2 - 0.1 ** 2);
    const pairGapM = 5e-12;
    const pose = (handX: number, topHandY: number): BatPose => ({
      grip: { x: handX, y: topHandY + TOP_HAND_FROM_CAP, z: 0.015605 },
      toe: { x: handX, y: topHandY + TOP_HAND_FROM_CAP - 0.86, z: 0.015605 },
      n: { x: 0, y: 0, z: 1 },
    });
    const poses = [
      pose(BAT_SHOULDER_X_M - radius, shoulderY + 0.2),
      pose(radius + pairGapM - BAT_SHOULDER_X_M, shoulderY + 0.1),
    ];
    const oracle = solveBatterRootOffsetForPosesOracle(poses, body);
    const optimized = solveBatterRootOffsetForPoses(poses, body);
    // The 5 pm pair gap is recovered to within the oracle's rounding; the frozen value is that rounding for the
    // anthropometric reach (it was 4.999944902550624e-12 for the former 0.453 m one).
    expect(oracle).toEqual({ solved: true, offset: { x: 5.000000413701855e-12, z: 0 }, crouchM: 0 });
    expect(optimized).toEqual(oracle);
  });

  it('changes the unique root continuously under nanometre pose perturbations', () => {
    const { pose: basePose, body } = completeBodyRootFixture();
    const base = solveBatterRootOffset(basePose, body);
    expect(base.solved).toBe(true);
    expect(Math.hypot(base.offset.x, base.offset.z)).toBeGreaterThan(0);
    for (const sign of [-1, 1]) {
      const perturbed = translated(basePose, { x: sign * 1e-9, y: 0, z: -sign * 1e-9 });
      const solved = solveBatterRootOffset(perturbed, body);
      expect(solved.solved).toBe(true);
      expect(solved.crouchM).toBe(base.crouchM);
      const rootDelta = Math.hypot(solved.offset.x - base.offset.x, solved.offset.z - base.offset.z);
      expect(rootDelta).toBeGreaterThan(0);
      expect(rootDelta).toBeLessThan(1e-7);
      const safe = batPoseAdmissibility(perturbed, translateBatterBody(body, solved.offset));
      expect(safe.gap).toBeGreaterThanOrEqual(-1e-12);
      expect(safe.reach).toBeLessThanOrEqual(BAT_HAND_REACH_SOLVE_M + 1e-12);
      expect(safe.reachGap).toBeGreaterThanOrEqual(0.001 - 1e-12);
    }
  });

  it('never exposes the numerical feasibility tolerance beyond the exact 180 mm root cap', () => {
    // Translate one already-safe rigid pose until the unique minimum-root solution reaches the closed cap. The next
    // nanometre must fail closed; a solved result may never report 0.180000000001 m.
    let low = 0;
    let high = 0.6;
    for (let iteration = 0; iteration < 48; iteration++) {
      const middle = (low + high) / 2;
      const solved = solveBatterRootOffset(translated(pose, { x: middle, y: 0, z: 0 }), track.body);
      if (solved.solved) low = middle;
      else high = middle;
    }
    const edge = solveBatterRootOffset(translated(pose, { x: low, y: 0, z: 0 }), track.body);
    expect(edge.solved).toBe(true);
    const edgeNorm = Math.hypot(edge.offset.x, edge.offset.z);
    expect(edgeNorm).toBeLessThanOrEqual(BAT_BODY_RETARGET_M);
    expect(edgeNorm).toBeCloseTo(BAT_BODY_RETARGET_M, 7);
    const beyond = solveBatterRootOffset(translated(pose, { x: high + 1e-9, y: 0, z: 0 }), track.body);
    expect(beyond.solved).toBe(false);
    expect(beyond.offset).toEqual({ x: 0, z: 0 });
  });

  it('intentionally fails closed when the minimum reach shift still intersects anatomy', () => {
    const body = track.body;
    const x = body.head.c.x + 0.04;
    const throughHelmet: BatPose = {
      grip: { x, y: 1.7, z: body.head.c.z },
      toe: { x, y: 0.84, z: body.head.c.z },
      n: { x: 0, y: 0, z: 1 },
    };
    expect(batPoseAdmissibility(throughHelmet, body).reachGap).toBeGreaterThan(0);
    expect(batPoseAdmissibility(throughHelmet, body).helmetGap).toBeLessThan(0);
    expect(solveBatterRootOffset(throughHelmet, body)).toEqual({ solved: false, offset: { x: 0, z: 0 }, crouchM: 0 });
  });

});
