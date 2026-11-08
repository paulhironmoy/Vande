import { describe, expect, it } from 'vitest';
import { BAT_TOE_GROUND_M } from '@/physics/admissibility';
import {
  bladeFrame,
  bladeGroundSupportY,
  handleGroundSupportY,
  pointBladeDistance,
  segmentBladeDistance,
  type BatGeometryPose,
  type GeometryCapsule,
} from '@/physics/batGeometry';
import { BLADE_HALF_W, BLADE_L, BLADE_T, HANDLE_L } from '@/physics/constants';
import type { Vec3 } from '@/physics/vec';

const BAT_FULL = BLADE_L + HANDLE_L;
const CANONICAL_POSE: BatGeometryPose = {
  toe: { x: 0, y: 0, z: 0 },
  grip: { x: 0, y: BAT_FULL, z: 0 },
  n: { x: 0, y: 0, z: 1 },
};

function capsuleBladeGap(frame: ReturnType<typeof bladeFrame>, capsule: GeometryCapsule): number {
  return segmentBladeDistance(frame, capsule.a, capsule.b) - capsule.r;
}

function translatedY(pose: BatGeometryPose, amount: number): BatGeometryPose {
  const move = (point: Vec3): Vec3 => ({ x: point.x, y: point.y + amount, z: point.z });
  return { toe: move(pose.toe), grip: move(pose.grip), n: pose.n };
}

describe('canonical rigid-bat geometry', () => {
  it('finds segment-to-OBB crossings, face tangency, interior minima and a degenerate point', () => {
    const frame = bladeFrame(CANONICAL_POSE);
    expect(segmentBladeDistance(frame, { x: 0, y: 0.28, z: -1 }, { x: 0, y: 0.28, z: 1 })).toBe(0);
    expect(segmentBladeDistance(frame, { x: BLADE_HALF_W, y: 0.1, z: 0 }, { x: BLADE_HALF_W, y: 0.46, z: 0 })).toBe(0);

    const parallelStart = { x: 0.1, y: -1, z: 0.1 };
    const parallelEnd = { x: 0.1, y: 2, z: 0.1 };
    const diagonalOutside = Math.hypot(0.1 - BLADE_HALF_W, 0.1 - BLADE_T / 2);
    expect(segmentBladeDistance(frame, parallelStart, parallelEnd)).toBeCloseTo(diagonalOutside, 14);

    const point = { x: 0.1, y: 0.28, z: 0.1 };
    expect(segmentBladeDistance(frame, point, point)).toBe(pointBladeDistance(frame, point));
    expect(pointBladeDistance(frame, point)).toBeCloseTo(diagonalOutside, 14);
  });

  it('treats a complete capsule as tangent, separated or penetrating, including a spherical-cap corner', () => {
    const frame = bladeFrame(CANONICAL_POSE);
    const radius = 0.05;
    const parallel = (x: number): GeometryCapsule => ({
      a: { x, y: 0.1, z: 0 },
      b: { x, y: 0.46, z: 0 },
      r: radius,
    });
    expect(capsuleBladeGap(frame, parallel(BLADE_HALF_W + radius))).toBeCloseTo(0, 14);
    expect(capsuleBladeGap(frame, parallel(BLADE_HALF_W + radius + 0.01))).toBeCloseTo(0.01, 14);
    expect(capsuleBladeGap(frame, parallel(BLADE_HALF_W + radius - 0.02))).toBeCloseTo(-0.02, 14);

    const corner = {
      x: BLADE_HALF_W + radius / Math.SQRT2,
      y: 0.28,
      z: BLADE_T / 2 + radius / Math.SQRT2,
    };
    expect(capsuleBladeGap(frame, { a: corner, b: corner, r: radius })).toBeCloseTo(0, 14);
  });

  it('matches the blade support function at an oblique boundary and handles capsule endpoint degeneracy', () => {
    const inverseRoot3 = 1 / Math.sqrt(3);
    const axis = { x: inverseRoot3, y: inverseRoot3, z: inverseRoot3 };
    const toe = { x: 0.2, y: 0.3, z: -0.1 };
    const pose: BatGeometryPose = {
      toe,
      grip: {
        x: toe.x + axis.x * BAT_FULL,
        y: toe.y + axis.y * BAT_FULL,
        z: toe.z + axis.z * BAT_FULL,
      },
      n: { x: 1 / Math.SQRT2, y: -1 / Math.SQRT2, z: 0 },
    };
    const frame = bladeFrame(pose);
    let lowestVertexY = Infinity;
    for (const uSign of [-1, 1]) {
      for (const wSign of [-1, 1]) {
        for (const nSign of [-1, 1]) {
          lowestVertexY = Math.min(
            lowestVertexY,
            frame.centre.y +
              ((uSign * BLADE_L) / 2) * frame.a.y +
              wSign * BLADE_HALF_W * frame.w.y +
              ((nSign * BLADE_T) / 2) * frame.n.y,
          );
        }
      }
    }
    expect(bladeGroundSupportY(frame)).toBeCloseTo(lowestVertexY, 14);

    const onGround = translatedY(pose, BAT_TOE_GROUND_M - bladeGroundSupportY(frame));
    expect(bladeGroundSupportY(bladeFrame(onGround))).toBeCloseTo(BAT_TOE_GROUND_M, 14);
    expect(bladeGroundSupportY(bladeFrame(translatedY(onGround, 1e-6))) - BAT_TOE_GROUND_M).toBeCloseTo(1e-6, 14);
    expect(bladeGroundSupportY(bladeFrame(translatedY(onGround, -1e-6))) - BAT_TOE_GROUND_M).toBeCloseTo(-1e-6, 14);

    expect(
      handleGroundSupportY({
        a: { x: 0, y: 0.3, z: 0 },
        b: { x: 0, y: 0.2, z: 0 },
        r: 0.05,
      }),
    ).toBeCloseTo(0.15, 14);
    expect(
      handleGroundSupportY({
        a: { x: 0, y: 0.055, z: 0 },
        b: { x: 0, y: 0.055, z: 0 },
        r: 0.05,
      }),
    ).toBeCloseTo(BAT_TOE_GROUND_M, 14);
  });
});
