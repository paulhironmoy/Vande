// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  batterBody,
  rootReachIntersectionPossible,
  type BatPose,
  type BatterBody,
} from '@/physics/bat';
import {
  BAT_BODY_RETARGET_M,
  BAT_HAND_REACH_SOLVE_M,
  batterShoulders,
  solveBatterRootOffsetForPosesOracle,
} from '@/physics/admissibility';
import {
  BLADE_L,
  HANDLE_L,
  LOWER_HAND_FROM_CAP,
  TOP_HAND_FROM_CAP,
} from '@/physics/constants';

function lawfulVerticalFixture(body: BatterBody): BatPose {
  const [topShoulder, lowerShoulder] = batterShoulders(body);
  const handHalfSeparation = (LOWER_HAND_FROM_CAP - TOP_HAND_FROM_CAP) / 2;
  const grip = {
    x: (topShoulder.x + lowerShoulder.x) / 2 + 0.35,
    y: topShoulder.y + handHalfSeparation + TOP_HAND_FROM_CAP,
    z: (topShoulder.z + lowerShoulder.z) / 2 + 0.08,
  };
  return {
    grip,
    toe: { x: grip.x, y: grip.y - BLADE_L - HANDLE_L, z: grip.z },
    n: { x: 0, y: 0, z: 1 },
  };
}

function translated(pose: BatPose, x: number, y: number, z: number): BatPose {
  return {
    grip: { x: pose.grip.x + x, y: pose.grip.y + y, z: pose.grip.z + z },
    toe: { x: pose.toe.x + x, y: pose.toe.y + y, z: pose.toe.z + z },
    n: pose.n,
  };
}

describe('legacy root-reach necessary precheck', () => {
  it('retains a solved pose and rejects mutually disjoint authority poses', () => {
    const body = batterBody(null);
    const fixture = lawfulVerticalFixture(body);
    const boundary = solveBatterRootOffsetForPosesOracle([fixture], body);
    expect(boundary.solved).toBe(true);
    expect(rootReachIntersectionPossible([fixture], body)).toBe(true);

    const impossible = [
      translated(fixture, -0.9, 0, 0),
      translated(fixture, 0.9, 0, 0),
    ];
    expect(solveBatterRootOffsetForPosesOracle(impossible, body).solved).toBe(false);
    expect(rootReachIntersectionPossible(impossible, body)).toBe(false);
  });

  it('is conservative on both sides of the root-cap/reach tangency', () => {
    const body = batterBody(null);
    const fixture = lawfulVerticalFixture(body);
    const [topShoulder] = batterShoulders(body);
    const topHandVertical = (LOWER_HAND_FROM_CAP - TOP_HAND_FROM_CAP) / 2;
    const overstatedReach = BAT_HAND_REACH_SOLVE_M + 2e-9;
    const topPlanarRadius = Math.sqrt(overstatedReach ** 2 - topHandVertical ** 2);
    const topCentreX = fixture.grip.x - topShoulder.x;
    const tangentTranslationX = BAT_BODY_RETARGET_M + 2e-9 + topPlanarRadius - topCentreX;
    const cancelCentreZ = topShoulder.z - fixture.grip.z;
    const inside = translated(fixture, tangentTranslationX - 1e-7, 0, cancelCentreZ);
    const outside = translated(fixture, tangentTranslationX + 1e-7, 0, cancelCentreZ);

    expect(solveBatterRootOffsetForPosesOracle([inside], body).solved).toBe(true);
    expect(rootReachIntersectionPossible([inside], body)).toBe(true);
    expect(rootReachIntersectionPossible([outside], body)).toBe(false);
  });

  it('has zero false negatives against the retained exhaustive oracle over a broad deterministic corpus', () => {
    const body = batterBody(null);
    const fixture = lawfulVerticalFixture(body);
    const sets: BatPose[][] = [];
    for (const x of [-0.75, -0.4, -0.18, 0, 0.18, 0.4, 0.75]) {
      for (const z of [-0.45, -0.12, 0, 0.12, 0.45]) {
        const centre = translated(fixture, x, ((x + z) * 0.03), z);
        sets.push([centre]);
        if (Math.abs(x) <= 0.18 && Math.abs(z) <= 0.12) {
          sets.push([
            translated(centre, -0.015, -0.01, 0.012),
            translated(centre, 0.015, 0.01, -0.012),
          ]);
        }
      }
    }

    let solved = 0;
    let rejected = 0;
    for (const poses of sets) {
      const possible = rootReachIntersectionPossible(poses, body);
      const oracle = solveBatterRootOffsetForPosesOracle(poses, body);
      if (oracle.solved) {
        solved++;
        expect(possible).toBe(true);
      }
      if (!possible) rejected++;
    }
    expect(solved).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
  });
});
