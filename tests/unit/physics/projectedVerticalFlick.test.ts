// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  BAT_ANGULAR_ACCEL_LIMIT_RADPS2,
  BAT_ANGULAR_SPEED_LIMIT_RADPS,
  BAT_GRIP_ACCEL_LIMIT_MPS2,
  BAT_GRIP_SPEED_LIMIT_MPS,
  BAT_POINT_ACCEL_LIMIT_MPS2,
  BAT_POINT_SPEED_LIMIT_MPS,
  batSamples,
  batTrackAnalyticEnvelope,
} from '@/physics/bat';
import { BAT_HAND_REACH_SOLVE_M, batterShoulders, batPoseAdmissibility } from '@/physics/admissibility';
import { LOWER_HAND_FROM_CAP, TOP_HAND_FROM_CAP } from '@/physics/constants';
import { sweep } from '@/physics/collision';
import { fly, play } from './physics-helpers';

const BASE_DELIVERY = { variation: 'stock', lengthM: 3.5, lineM: -0.12, speedKph: 136 } as const;
const BASE_SWING = { directionDeg: -70, power: 0.5, elevation: 0.05 } as const;

function angularDifferenceDeg(left: number, right: number): number {
  return ((left - right + 540) % 360) - 180;
}

function distance(left: { x: number; y: number; z: number }, right: { x: number; y: number; z: number }): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

describe('projected vertical flick behavior', () => {
  it('meets the full ball on the physical face and sends it toward the authored outcome', () => {
    const ball = fly(BASE_DELIVERY);
    const result = play(ball, 0, BASE_SWING);
    const track = result.track!;
    const actual = sweep(ball.samples, track, track.body, 0, ball.samples.at(-1)!.t).hit;

    expect(actual?.part).toBe('blade');
    expect(actual?.blade?.region).toBe('face');
    expect(result.contact.kind).toBe('middle');
    expect(result.exit).not.toBeNull();
    expect(result.contact.exitSpeedKph).toBeGreaterThan(50);
    expect(Math.abs(angularDifferenceDeg(result.contact.exitBearingDeg!, BASE_SWING.directionDeg))).toBeLessThan(1);
    expect(Math.abs(result.contact.exitElevationDeg! - track.targetElevation)).toBeLessThan(1);
  });

  it('retains the same actual face-hit behavior for a nearby held-out line', () => {
    const ball = fly({ ...BASE_DELIVERY, lineM: -0.1 });
    const result = play(ball, 0, BASE_SWING);
    const track = result.track!;
    const actual = sweep(ball.samples, track, track.body, 0, ball.samples.at(-1)!.t).hit;

    expect(actual?.part).toBe('blade');
    expect(actual?.blade?.region).toBe('face');
    expect(result.contact.kind).toBe('middle');
    expect(result.exit).not.toBeNull();
    expect(Math.abs(angularDifferenceDeg(result.contact.exitBearingDeg!, BASE_SWING.directionDeg))).toBeLessThan(1);
    expect(Math.abs(result.contact.exitElevationDeg! - track.targetElevation)).toBeLessThan(1);
  });

  // Refrozen 2026-11-03 (PHYS phase 2). The collapsed anatomy (0.454 m reach) could not certify -65 deg, so this pinned a
  // fail-closed miss. With the anthropometric reach the complete path is certified and meets the face. The property
  // kept is the fail-closed contract itself: every visible sample is admissible, within reach and inside every cap.
  it('admits the nearby -65 deg direction once its complete path is certified, and every visible sample remains physical', () => {
    const ball = fly(BASE_DELIVERY);
    const result = play(ball, 0, { ...BASE_SWING, directionDeg: -65 });
    const track = result.track!;
    const actual = sweep(ball.samples, track, track.body, 0, ball.samples.at(-1)!.t).hit;

    // Was: no hit, and not middle.
    expect(actual?.part).toBe('blade');
    expect(actual?.blade?.region).toBe('face');
    expect(result.contact.kind).toBe('middle');
    const shoulders = batterShoulders(track.body);
    for (const sample of batSamples(track, 0.001)) {
      const length = distance(sample.grip, sample.toe);
      const axis = {
        x: (sample.grip.x - sample.toe.x) / length,
        y: (sample.grip.y - sample.toe.y) / length,
        z: (sample.grip.z - sample.toe.z) / length,
      };
      const pose = { grip: sample.grip, toe: sample.toe, n: sample.face };
      expect(batPoseAdmissibility(pose, track.body).gap).toBeGreaterThanOrEqual(-1e-9);
      for (const handIndex of [0, 1] as const) {
        const offset = handIndex === 0 ? TOP_HAND_FROM_CAP : LOWER_HAND_FROM_CAP;
        const hand = {
          x: sample.grip.x - axis.x * offset,
          y: sample.grip.y - axis.y * offset,
          z: sample.grip.z - axis.z * offset,
        };
        expect(distance(hand, shoulders[handIndex])).toBeLessThanOrEqual(BAT_HAND_REACH_SOLVE_M + 1e-9);
      }
    }
    const envelope = batTrackAnalyticEnvelope(track);
    expect(envelope.gripSpeed).toBeLessThanOrEqual(BAT_GRIP_SPEED_LIMIT_MPS);
    expect(envelope.pointSpeed).toBeLessThanOrEqual(BAT_POINT_SPEED_LIMIT_MPS);
    expect(envelope.gripAcceleration).toBeLessThanOrEqual(BAT_GRIP_ACCEL_LIMIT_MPS2);
    expect(envelope.pointAcceleration).toBeLessThanOrEqual(BAT_POINT_ACCEL_LIMIT_MPS2);
    expect(envelope.angularSpeed).toBeLessThanOrEqual(BAT_ANGULAR_SPEED_LIMIT_RADPS);
    expect(envelope.angularAcceleration).toBeLessThanOrEqual(BAT_ANGULAR_ACCEL_LIMIT_RADPS2);
  });

  // Refrozen 2026-11-03 (PHYS phase 2). These pinned the collapsed planner's -67..-56 deg boundary as a miss on a null
  // path at U 0.22. Each direction is now a requested-speed (20 m/s) face hit at the sweet-spot lattice point on the
  // certified free-grip path, exiting within 1 deg of its own aim.
  it.each([-67, -66, -65, -64, -63, -62, -61, -60, -59, -58, -57, -56])(
    'preserves the repaired face-hit identity at direction %d',
    (directionDeg) => {
      const ball = fly(BASE_DELIVERY);
      const result = play(ball, 0, { ...BASE_SWING, directionDeg });
      const track = result.track!;
      const actual = sweep(ball.samples, track, track.body, 0, ball.samples.at(-1)!.t).hit;

      expect(actual?.part).toBe('blade');
      expect(actual?.blade?.region).toBe('face');
      expect(result.contact.kind).toBe('middle');
      expect(track.collisionPath?.kind).toBe('free-grip-so3');
      expect(track.contactU).toBeCloseTo(0.225, 12);
      expect(track.speed).toBeCloseTo(20, 12);
      expect(Math.abs(angularDifferenceDeg(result.contact.exitBearingDeg!, directionDeg))).toBeLessThan(1);
    },
  );
});
