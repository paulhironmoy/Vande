import { describe, expect, it } from 'vitest';
import {
  BAT_ANGULAR_ACCEL_LIMIT_RADPS2,
  BAT_ANGULAR_SPEED_LIMIT_RADPS,
  BAT_GRIP_ACCEL_LIMIT_MPS2,
  BAT_GRIP_SPEED_LIMIT_MPS,
  BAT_POINT_ACCEL_LIMIT_MPS2,
  BAT_POINT_SPEED_LIMIT_MPS,
  GENERALIZED_COLLISION_CONTACT_U_MAX,
  GENERALIZED_COLLISION_CONTACT_U_MIN,
  GENERALIZED_COLLISION_CONTACT_U_STEP,
  batPointVelocity,
  batPose,
  batSamples,
  batTrackAnalyticEnvelope,
  batTravelMs,
  buildBatTrack,
  collisionKinematicsAt,
  presentationBatSamples,
} from '@/physics/bat';
import {
  BAT_BODY_RETARGET_M,
  BAT_HAND_REACH_SOLVE_M,
  BAT_POSTURE_CROUCH_MAX_M,
  batterShoulders,
  batPoseAdmissibility,
} from '@/physics/admissibility';
import { sweep } from '@/physics/collision';
import { strike } from '@/physics/contact';
import { flight } from '@/physics/delivery';
import { BALL_R, LOWER_HAND_FROM_CAP, SWEET_U, TOP_HAND_FROM_CAP } from '@/physics/constants';
import { REFERENCE_OVER } from '@/practice/game';
import { SURFACES, play, strokeSamples } from '../input/fixtures';
import { PACE, fly, timedSwing } from './physics-helpers';

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function cross(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function lockedTopPowerTrack() {
  const plan = { variation: 'stock', lengthM: 4.5, lineM: -0.05, speedKph: 138 } as const;
  const f = flight({
    plan,
    bowler: REFERENCE_OVER.bowler,
    conditions: 'balanced',
    seed: 'input-system-ctl4-2',
    handedness: 'right',
    ball: REFERENCE_OVER.ball,
  });
  const releasePerfMs = 50_000;
  const probePress = releasePerfMs + 300;
  const samples = strokeSamples({ lengthPx: 100, bearingDeg: 0, durationMs: 40, profile: 'linear' }, probePress);
  const probe = play(samples, { surface: SURFACES.phone, opts: { releasePerfMs } }).swing!;
  const anchorDelayMs = probe.startT * 1000 - (probePress - releasePerfMs);
  const press = releasePerfMs + f.idealContactT * 1000 - batTravelMs(probe.kind, probe.power) - anchorDelayMs;
  const swing = play(
    samples.map((sample) => ({ ...sample, t: sample.t + press - probePress })),
    { surface: SURFACES.phone, opts: { releasePerfMs } },
  ).swing!;
  return { track: buildBatTrack(f, swing, { assist: 'real' }), flight: f, swing };
}

function straightDriveTrack(lineM = 0.18, speedKph = 136, seed = 't1') {
  const f = fly({ variation: 'stock', lengthM: 4, lineM, speedKph }, PACE, 'balanced', seed);
  const swing = timedSwing(f, 0, { kind: 'attack', directionDeg: 0, elevation: 0.1, power: 0.65 }, 'forward');
  return { track: buildBatTrack(f, swing, { assist: 'real' }), flight: f, swing };
}

describe('generalized rigid-bat collision path', () => {
  it('contains the independently frozen contact geometry in its fixture-independent search domain', () => {
    const frozenWitnessContactU = 0.0425438604;
    const lower =
      Math.floor(frozenWitnessContactU / GENERALIZED_COLLISION_CONTACT_U_STEP) * GENERALIZED_COLLISION_CONTACT_U_STEP;
    const upper =
      Math.ceil(frozenWitnessContactU / GENERALIZED_COLLISION_CONTACT_U_STEP) * GENERALIZED_COLLISION_CONTACT_U_STEP;
    expect(frozenWitnessContactU).toBeGreaterThan(GENERALIZED_COLLISION_CONTACT_U_MIN);
    expect(frozenWitnessContactU).toBeLessThan(GENERALIZED_COLLISION_CONTACT_U_MAX);
    expect(lower).toBeGreaterThanOrEqual(GENERALIZED_COLLISION_CONTACT_U_MIN);
    expect(upper).toBeLessThanOrEqual(GENERALIZED_COLLISION_CONTACT_U_MAX);
    expect(upper - lower).toBeCloseTo(GENERALIZED_COLLISION_CONTACT_U_STEP, 12);
  });

  it('rediscovers a full-nullspace straight drive with continuous held endpoints and a physical face impact', () => {
    const { track, flight: straightFlight, swing } = straightDriveTrack();
    expect(track.collisionPath?.kind).toBe('free-grip-so3');
    expect(track.speed).toBeCloseTo(23.6, 10);
    // The planner aims the sweet spot at the read at every speed, so the drive is planned at the contact lattice point
    // nearest SWEET_U. It used to be planned at the toe-most lattice point (U_MIN, 0.025): a toe hit by design.
    expect(track.contactU).toBeCloseTo(
      Math.round(SWEET_U / GENERALIZED_COLLISION_CONTACT_U_STEP) * GENERALIZED_COLLISION_CONTACT_U_STEP,
      12,
    );

    const poseDistance = (left: ReturnType<typeof batPose>, right: ReturnType<typeof batPose>) =>
      Math.max(distance(left.grip, right.grip), distance(left.toe, right.toe), distance(left.n, right.n));
    const entry = collisionKinematicsAt(track, track.zoneIn);
    const exit = collisionKinematicsAt(track, track.zoneOut);
    expect(poseDistance(track.stance, entry.pose)).toBeLessThan(1e-12);
    expect(poseDistance(track.backlift, entry.pose)).toBeLessThan(1e-12);
    expect(poseDistance(track.finish, exit.pose)).toBeLessThan(1e-12);
    expect(poseDistance(batPose(track, track.startT - 1e-9), batPose(track, track.startT))).toBeLessThan(1e-9);
    expect(poseDistance(batPose(track, track.zoneOut), batPose(track, track.zoneOut + 1e-9))).toBeLessThan(1e-9);
    for (const endpoint of [entry, exit]) {
      expect(Math.hypot(...Object.values(endpoint.gripVelocity))).toBeLessThan(1e-9);
      expect(Math.hypot(...Object.values(endpoint.angularVelocity))).toBeLessThan(1e-9);
      expect(batPoseAdmissibility(endpoint.pose, track.body).gap).toBeGreaterThanOrEqual(0);
    }

    const shoulders = batterShoulders(track.body);
    for (const sample of batSamples(track, 0.002)) {
      const axisLength = distance(sample.grip, sample.toe);
      const axis = {
        x: (sample.grip.x - sample.toe.x) / axisLength,
        y: (sample.grip.y - sample.toe.y) / axisLength,
        z: (sample.grip.z - sample.toe.z) / axisLength,
      };
      for (const handIndex of [0, 1] as const) {
        const offset = handIndex === 0 ? TOP_HAND_FROM_CAP : LOWER_HAND_FROM_CAP;
        const hand = {
          x: sample.grip.x - axis.x * offset,
          y: sample.grip.y - axis.y * offset,
          z: sample.grip.z - axis.z * offset,
        };
        expect(distance(hand, shoulders[handIndex])).toBeLessThanOrEqual(BAT_HAND_REACH_SOLVE_M + 1e-9);
      }
      expect(
        batPoseAdmissibility({ grip: sample.grip, toe: sample.toe, n: sample.face }, track.body).gap,
      ).toBeGreaterThanOrEqual(-1e-9);
    }

    const point = {
      x: track.contactAim.x - track.n.x * BALL_R,
      y: track.contactAim.y - track.n.y * BALL_R,
      z: track.contactAim.z - track.n.z * BALL_R,
    };
    const plannedState = collisionKinematicsAt(track, track.plannedContactT);
    const plannedRotational = cross(plannedState.angularVelocity, {
      x: point.x - plannedState.pose.grip.x,
      y: point.y - plannedState.pose.grip.y,
      z: point.z - plannedState.pose.grip.z,
    });
    expect(
      distance(batPointVelocity(track, track.plannedContactT, point), {
        x: plannedState.gripVelocity.x + plannedRotational.x,
        y: plannedState.gripVelocity.y + plannedRotational.y,
        z: plannedState.gripVelocity.z + plannedRotational.z,
      }),
    ).toBeLessThan(1e-10);

    const actual = sweep(straightFlight.samples, track, track.body, 0, straightFlight.samples.at(-1)!.t).hit;
    expect(actual?.part).toBe('blade');
    expect(actual?.blade?.region).toBe('face');
    const struck = strike(straightFlight, swing, { assist: 'real' });
    expect(struck.contact.t).toBeCloseTo(actual!.t, 10);
    expect(struck.exit).not.toBeNull();

    const envelope = batTrackAnalyticEnvelope(track);
    expect(envelope.gripSpeed).toBeLessThanOrEqual(BAT_GRIP_SPEED_LIMIT_MPS);
    expect(envelope.pointSpeed).toBeLessThanOrEqual(BAT_POINT_SPEED_LIMIT_MPS);
    expect(envelope.gripAcceleration).toBeLessThanOrEqual(BAT_GRIP_ACCEL_LIMIT_MPS2);
    expect(envelope.pointAcceleration).toBeLessThanOrEqual(BAT_POINT_ACCEL_LIMIT_MPS2);
    expect(envelope.angularSpeed).toBeLessThanOrEqual(BAT_ANGULAR_SPEED_LIMIT_RADPS);
    expect(envelope.angularAcceleration).toBeLessThanOrEqual(BAT_ANGULAR_ACCEL_LIMIT_RADPS2);
  }, 30_000);

  it.each([
    { lineM: 0.17, speedKph: 135, seed: 'nullspace-heldout-a' },
    { lineM: 0.19, speedKph: 137, seed: 'nullspace-heldout-b' },
  ])(
    'keeps a nearby non-fixture straight drive physical ($seed)',
    ({ lineM, speedKph, seed }) => {
      const { track, flight: heldoutFlight } = straightDriveTrack(lineM, speedKph, seed);
      expect(track.collisionPath?.kind).toBe('free-grip-so3');
      const entry = collisionKinematicsAt(track, track.zoneIn);
      const exit = collisionKinematicsAt(track, track.zoneOut);
      expect(distance(track.stance.grip, entry.pose.grip)).toBeLessThan(1e-12);
      expect(distance(track.finish.grip, exit.pose.grip)).toBeLessThan(1e-12);
      expect(Math.hypot(...Object.values(entry.gripVelocity))).toBeLessThan(1e-9);
      expect(Math.hypot(...Object.values(exit.gripVelocity))).toBeLessThan(1e-9);
      expect(batPoseAdmissibility(entry.pose, track.body).gap).toBeGreaterThanOrEqual(0);
      expect(batPoseAdmissibility(exit.pose, track.body).gap).toBeGreaterThanOrEqual(0);
      const actual = sweep(heldoutFlight.samples, track, track.body, 0, heldoutFlight.samples.at(-1)!.t).hit;
      expect(actual?.part).toBe('blade');
      const envelope = batTrackAnalyticEnvelope(track);
      expect(envelope.pointSpeed).toBeLessThanOrEqual(BAT_POINT_SPEED_LIMIT_MPS);
      expect(envelope.pointAcceleration).toBeLessThanOrEqual(BAT_POINT_ACCEL_LIMIT_MPS2);
      expect(envelope.angularAcceleration).toBeLessThanOrEqual(BAT_ANGULAR_ACCEL_LIMIT_RADPS2);
    },
    30_000,
  );

  it('preserves the locked top-power contact exactly under every cap', () => {
    const { track, flight: lockedFlight, swing } = lockedTopPowerTrack();
    const path = track.collisionPath;
    expect(track.contactU).toBeGreaterThanOrEqual(GENERALIZED_COLLISION_CONTACT_U_MIN - 1e-12);
    expect(track.contactU).toBeLessThanOrEqual(GENERALIZED_COLLISION_CONTACT_U_MAX + 1e-12);
    expect(Math.hypot(track.batterRootOffset.x, track.batterRootOffset.z)).toBeLessThanOrEqual(
      BAT_BODY_RETARGET_M + 1e-12,
    );
    expect(track.batterPosture.crouchM).toBeLessThanOrEqual(BAT_POSTURE_CROUCH_MAX_M + 1e-12);
    const before = collisionKinematicsAt(track, track.plannedContactT - 1e-9);
    const at = collisionKinematicsAt(track, track.plannedContactT);
    const after = collisionKinematicsAt(track, track.plannedContactT + 1e-9);
    expect(distance(before.pose.grip, after.pose.grip)).toBeLessThan(1e-6);
    expect(distance(before.pose.toe, after.pose.toe)).toBeLessThan(1e-6);
    expect(distance(before.pose.n, after.pose.n)).toBeLessThan(1e-6);
    expect(distance(before.gripVelocity, after.gripVelocity)).toBeLessThan(1e-5);
    expect(distance(before.angularVelocity, after.angularVelocity)).toBeLessThan(1e-5);
    const point = {
      x: track.contactAim.x - track.n.x * BALL_R,
      y: track.contactAim.y - track.n.y * BALL_R,
      z: track.contactAim.z - track.n.z * BALL_R,
    };
    expect(Math.hypot(...Object.values(batPointVelocity(track, track.plannedContactT, point)))).toBeGreaterThan(20);
    if (path) {
      expect(distance(at.pose.grip, path.contact.grip)).toBeLessThan(1e-12);
      expect(distance(at.pose.toe, path.contact.toe)).toBeLessThan(1e-12);
      expect(distance(at.pose.n, path.contact.n)).toBeLessThan(1e-12);
    }
    const expectedContactVelocity = cross(at.angularVelocity, {
      x: point.x - at.pose.grip.x,
      y: point.y - at.pose.grip.y,
      z: point.z - at.pose.grip.z,
    });
    expectedContactVelocity.x += at.gripVelocity.x;
    expectedContactVelocity.y += at.gripVelocity.y;
    expectedContactVelocity.z += at.gripVelocity.z;
    expect(distance(batPointVelocity(track, track.plannedContactT, point), expectedContactVelocity)).toBeLessThan(
      1e-10,
    );

    const actual = sweep(lockedFlight.samples, track, track.body, 0, lockedFlight.samples.at(-1)!.t).hit;
    expect(actual?.part).toBe('blade');
    expect(actual!.t).toBeLessThan(track.plannedContactT);
    expect(Math.abs(actual!.t - track.plannedContactT)).toBeLessThan(0.0001);
    const actualState = collisionKinematicsAt(track, actual!.t);
    const actualRotational = cross(actualState.angularVelocity, {
      x: actual!.point.x - actualState.pose.grip.x,
      y: actual!.point.y - actualState.pose.grip.y,
      z: actual!.point.z - actualState.pose.grip.z,
    });
    const actualExpected = {
      x: actualState.gripVelocity.x + actualRotational.x,
      y: actualState.gripVelocity.y + actualRotational.y,
      z: actualState.gripVelocity.z + actualRotational.z,
    };
    expect(distance(batPointVelocity(track, actual!.t, actual!.point), actualExpected)).toBeLessThan(1e-10);
    expect(Math.hypot(...Object.values(actualExpected))).toBeGreaterThan(20);
    expect(batPoseAdmissibility(batPose(track, actual!.t), track.body).gap).toBeGreaterThanOrEqual(0);

    const struck = strike(lockedFlight, swing, { assist: 'real' });
    expect(struck.contact.t).toBeCloseTo(actual!.t, 10);
    expect(struck.exit).not.toBeNull();
    expect(struck.exit!.v).toEqual(
      expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
        z: expect.any(Number),
      }),
    );

    for (const time of [track.zoneIn, track.zoneOut]) {
      const endpoint = collisionKinematicsAt(track, time);
      expect(Math.hypot(...Object.values(endpoint.gripVelocity))).toBeLessThan(1e-9);
      expect(Math.hypot(...Object.values(endpoint.angularVelocity))).toBeLessThan(1e-9);
      expect(Math.hypot(...Object.values(endpoint.gripAcceleration))).toBeLessThan(1e-9);
      expect(Math.hypot(...Object.values(endpoint.angularAcceleration))).toBeLessThan(1e-9);
      expect(batPoseAdmissibility(endpoint.pose, track.body).gap).toBeGreaterThanOrEqual(0);
    }
    const authorities = path
      ? [
          track.zoneIn,
          track.plannedContactT - path.pre.angularRampS,
          track.plannedContactT - path.pre.handRampS,
          track.plannedContactT,
          track.plannedContactT + path.post.handRampS,
          track.plannedContactT + path.post.angularRampS,
          track.zoneOut,
        ]
      : [track.zoneIn, track.plannedContactT, track.zoneOut];
    const canonical = batSamples(track);
    for (const authority of authorities) {
      expect(canonical.filter((sample) => Math.abs(sample.t - authority) <= 1e-12)).toHaveLength(1);
    }
    const presented = presentationBatSamples(track, actual!.t)!;
    expect(presented.filter((sample) => Math.abs(sample.t - actual!.t) <= 1e-12)).toHaveLength(1);
    expect(presented.filter((sample) => Math.abs(sample.t - track.plannedContactT) <= 1e-12)).toHaveLength(1);

    const envelope = batTrackAnalyticEnvelope(track);
    expect(envelope.gripSpeed).toBeLessThanOrEqual(BAT_GRIP_SPEED_LIMIT_MPS);
    expect(envelope.pointSpeed).toBeLessThanOrEqual(BAT_POINT_SPEED_LIMIT_MPS);
    expect(envelope.gripAcceleration).toBeLessThanOrEqual(BAT_GRIP_ACCEL_LIMIT_MPS2);
    expect(envelope.pointAcceleration).toBeLessThanOrEqual(BAT_POINT_ACCEL_LIMIT_MPS2);
    expect(envelope.angularSpeed).toBeLessThanOrEqual(BAT_ANGULAR_SPEED_LIMIT_RADPS);
    expect(envelope.angularAcceleration).toBeLessThanOrEqual(BAT_ANGULAR_ACCEL_LIMIT_RADPS2);
  }, 30_000);
});
