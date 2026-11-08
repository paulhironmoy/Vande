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

const BASE_DELIVERY = { variation: 'bouncer', lengthM: 10.5, lineM: -0.2, speedKph: 136 } as const;
const BASE_SWING = { directionDeg: -140, power: 0.65, elevation: 0.25 } as const;

function angularDifferenceDeg(left: number, right: number): number {
  return ((left - right + 540) % 360) - 180;
}

function distance(left: { x: number; y: number; z: number }, right: { x: number; y: number; z: number }): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

describe('public-grid hook path behavior', () => {
  it('meets the base bouncer on the physical face and sends the sweet hit toward the authored outcome', () => {
    const ball = fly(BASE_DELIVERY);
    const result = play(ball, 0, BASE_SWING, 'real', 'back');
    const track = result.track!;
    const actual = sweep(ball.samples, track, track.body, 0, ball.samples.at(-1)!.t).hit;

    expect(actual?.part).toBe('blade');
    expect(actual?.blade?.region).toBe('face');
    expect(result.contact.kind).toBe('middle');
    expect(result.quality?.sweet).toBe(true);
    expect(result.exit).not.toBeNull();
    expect(result.contact.exitSpeedKph).toBeGreaterThan(80);
    expect(Math.abs(angularDifferenceDeg(result.contact.exitBearingDeg!, BASE_SWING.directionDeg))).toBeLessThan(1);
    expect(Math.abs(result.contact.exitElevationDeg! - track.targetElevation)).toBeLessThan(1);
  });

  it('retains the same physical face-hit behavior for an independently held-out hook direction', () => {
    const ball = fly(BASE_DELIVERY);
    const swing = { ...BASE_SWING, directionDeg: -142 };
    const result = play(ball, 0, swing, 'real', 'back');
    const track = result.track!;
    const actual = sweep(ball.samples, track, track.body, 0, ball.samples.at(-1)!.t).hit;

    expect(actual?.part).toBe('blade');
    expect(actual?.blade?.region).toBe('face');
    expect(result.contact.kind).toBe('middle');
    expect(result.quality?.sweet).toBe(true);
    expect(result.exit).not.toBeNull();
    expect(Math.abs(angularDifferenceDeg(result.contact.exitBearingDeg!, swing.directionDeg))).toBeLessThan(1);
    expect(Math.abs(result.contact.exitElevationDeg! - track.targetElevation)).toBeLessThan(1);
  });

  // Refrozen 2026-11-03 (PHYS phase 2). -130 deg was not admissible under the collapsed anatomy (0.454 m reach), so this
  // pinned 'not middle'. It is now a requested-speed sweet face hit. The fail-closed contract is kept below: every
  // returned visible sample is admissible, within reach and inside every analytic cap.
  it('admits the -130 deg hook once its path is certified, while every returned visible sample remains physical', () => {
    const ball = fly(BASE_DELIVERY);
    const result = play(ball, 0, { ...BASE_SWING, directionDeg: -130 }, 'real', 'back');
    const track = result.track!;
    // Was: expect(result.contact.kind).not.toBe('middle').
    expect(result.contact.kind).toBe('middle');
    expect(result.quality?.sweet).toBe(true);
    expect(Math.abs(angularDifferenceDeg(result.contact.exitBearingDeg!, -130))).toBeLessThan(1);

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
});
