import { describe, expect, it } from 'vitest';
import type { BatSample, Vec3 } from '@/contracts/practice';
import { batAt, type BatPose } from '@/render3d/practice/frame';

const BAT_FULL = 0.86;

function rigidBat(t: number, grip: Vec3, angleDegrees: number): BatSample {
  const angle = (angleDegrees * Math.PI) / 180;
  const axis = { x: Math.cos(angle), y: Math.sin(angle), z: 0 };
  return {
    t,
    grip: { ...grip },
    toe: {
      x: grip.x - axis.x * BAT_FULL,
      y: grip.y - axis.y * BAT_FULL,
      z: grip.z,
    },
    face: { x: -axis.y, y: axis.x, z: 0 },
  };
}

function poseAt(
  samples: readonly BatSample[],
  t: number,
  impulseT?: number | null,
  velocityPeakT?: number | null,
): BatPose {
  const pose = batAt(samples, t, impulseT, velocityPeakT);
  expect(pose).not.toBeNull();
  return pose!;
}

function axis(pose: BatPose): Vec3 {
  const value = {
    x: pose.grip.x - pose.toe.x,
    y: pose.grip.y - pose.toe.y,
    z: pose.grip.z - pose.toe.z,
  };
  const length = Math.hypot(value.x, value.y, value.z);
  return { x: value.x / length, y: value.y / length, z: value.z / length };
}

function assertRigid(pose: BatPose): void {
  const a = axis(pose);
  const length = Math.hypot(
    pose.grip.x - pose.toe.x,
    pose.grip.y - pose.toe.y,
    pose.grip.z - pose.toe.z,
  );
  const faceLength = Math.hypot(pose.face.x, pose.face.y, pose.face.z);
  const orthogonal = a.x * pose.face.x + a.y * pose.face.y + a.z * pose.face.z;
  expect(length).toBeCloseTo(BAT_FULL, 12);
  expect(faceLength).toBeCloseTo(1, 12);
  expect(Math.abs(orthogonal)).toBeLessThan(1e-12);
}

function expectPoseClose(actual: BatPose, expected: BatPose, digits = 11): void {
  for (const part of ['grip', 'toe', 'face'] as const) {
    expect(actual[part].x).toBeCloseTo(expected[part].x, digits);
    expect(actual[part].y).toBeCloseTo(expected[part].y, digits);
    expect(actual[part].z).toBeCloseTo(expected[part].z, digits);
  }
}

function clockPose(
  samples: readonly BatSample[],
  target: number,
  nextStep: () => number,
  impulseT?: number | null,
  velocityPeakT?: number | null,
): BatPose {
  let elapsed = 0;
  let pose = poseAt(samples, elapsed, impulseT, velocityPeakT);
  while (elapsed < target) {
    elapsed += Math.min(nextStep(), target - elapsed);
    pose = poseAt(samples, elapsed, impulseT, velocityPeakT);
  }
  return pose;
}

function denseMotionMetrics(
  samples: readonly BatSample[],
  impulseT: number | null,
  velocityPeakT: number | null,
  step = 0.00025,
): {
  gripSpeed: number;
  toeSpeed: number;
  angularSpeed: number;
  gripAcceleration: number;
  toeAcceleration: number;
  angularAcceleration: number;
} {
  const start = samples[0].t;
  const end = samples.at(-1)!.t;
  const candidates: number[] = samples.map((sample) => sample.t);
  for (let t = start; t <= end + 1e-12; t += step) candidates.push(Math.min(t, end));
  candidates.sort((left, right) => left - right);
  const times: number[] = [];
  for (const time of candidates) {
    if (!times.length || time - times.at(-1)! > 1e-10) times.push(time);
  }
  const poses = times.map((time) => ({ time, pose: poseAt(samples, time, impulseT, velocityPeakT) }));
  const intervals: Array<{ start: number; end: number; grip: Vec3; toe: Vec3; angular: number }> = [];
  let gripSpeed = 0;
  let toeSpeed = 0;
  let angularSpeed = 0;
  for (let i = 1; i < poses.length; i++) {
    const before = poses[i - 1];
    const after = poses[i];
    const dt = after.time - before.time;
    const velocity = (part: 'grip' | 'toe'): Vec3 => ({
      x: (after.pose[part].x - before.pose[part].x) / dt,
      y: (after.pose[part].y - before.pose[part].y) / dt,
      z: (after.pose[part].z - before.pose[part].z) / dt,
    });
    const grip = velocity('grip');
    const toe = velocity('toe');
    const beforeAngle = Math.atan2(axis(before.pose).y, axis(before.pose).x);
    const afterAngle = Math.atan2(axis(after.pose).y, axis(after.pose).x);
    const angular = Math.atan2(Math.sin(afterAngle - beforeAngle), Math.cos(afterAngle - beforeAngle)) / dt;
    intervals.push({ start: before.time, end: after.time, grip, toe, angular });
    gripSpeed = Math.max(gripSpeed, Math.hypot(grip.x, grip.y, grip.z));
    toeSpeed = Math.max(toeSpeed, Math.hypot(toe.x, toe.y, toe.z));
    angularSpeed = Math.max(angularSpeed, Math.abs(angular));
  }
  let gripAcceleration = 0;
  let toeAcceleration = 0;
  let angularAcceleration = 0;
  for (let i = 1; i < intervals.length; i++) {
    const before = intervals[i - 1];
    const after = intervals[i];
    if (impulseT !== null && before.end <= impulseT && after.start >= impulseT) continue;
    const dt = ((before.end - before.start) + (after.end - after.start)) / 2;
    gripAcceleration = Math.max(gripAcceleration, Math.hypot(
      after.grip.x - before.grip.x,
      after.grip.y - before.grip.y,
      after.grip.z - before.grip.z,
    ) / dt);
    toeAcceleration = Math.max(toeAcceleration, Math.hypot(
      after.toe.x - before.toe.x,
      after.toe.y - before.toe.y,
      after.toe.z - before.toe.z,
    ) / dt);
    angularAcceleration = Math.max(angularAcceleration, Math.abs(after.angular - before.angular) / dt);
  }
  return { gripSpeed, toeSpeed, angularSpeed, gripAcceleration, toeAcceleration, angularAcceleration };
}

describe('rigid C1 bat trace interpolation', () => {
  it('preserves exact knots, fixed length, orthonormal frame, contact and endpoint semantics', () => {
    const samples = [
      rigidBat(0.20, { x: -0.18, y: 1.12, z: 9.18 }, -24),
      rigidBat(0.35, { x: -0.08, y: 1.28, z: 9.12 }, 8),
      rigidBat(0.50, { x: 0.14, y: 1.08, z: 8.92 }, 61),
      rigidBat(0.68, { x: 0.28, y: 1.34, z: 8.80 }, 108),
      rigidBat(0.82, { x: 0.24, y: 1.48, z: 8.74 }, 132),
    ];

    expect(batAt(samples, 0.19, 0.5)).toBeNull();
    expect(poseAt(samples, 0.2, 0.5)).toEqual({
      grip: samples[0].grip,
      toe: samples[0].toe,
      face: samples[0].face,
    });
    expect(poseAt(samples, 0.5, 0.5)).toEqual({
      grip: samples[2].grip,
      toe: samples[2].toe,
      face: samples[2].face,
    });
    expect(poseAt(samples, 0.95, 0.5)).toEqual({
      grip: samples.at(-1)!.grip,
      toe: samples.at(-1)!.toe,
      face: samples.at(-1)!.face,
    });
    for (let t = 0.2; t <= 0.82 + 1e-12; t += 0.0005) assertRigid(poseAt(samples, Math.min(t, 0.82), 0.5));
  });

  it('is seek-pure at 30 Hz, 60 Hz and seeded random clocks', () => {
    const samples = [
      rigidBat(0.0, { x: -0.20, y: 1.10, z: 9.20 }, -30),
      rigidBat(0.2, { x: -0.08, y: 1.32, z: 9.08 }, 5),
      rigidBat(0.4, { x: 0.12, y: 1.12, z: 8.94 }, 55),
      rigidBat(0.6, { x: 0.28, y: 1.30, z: 8.82 }, 104),
      rigidBat(0.8, { x: 0.24, y: 1.46, z: 8.76 }, 130),
      rigidBat(1.0, { x: 0.18, y: 1.50, z: 8.78 }, 138),
    ];
    const direct = poseAt(samples, 0.6, 0.4);
    expectPoseClose(clockPose(samples, 0.6, () => 1 / 30, 0.4), direct);
    expectPoseClose(clockPose(samples, 0.6, () => 1 / 60, 0.4), direct);
    let state = 1701 >>> 0;
    const randomStep = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return 0.001 + (state / 0x1_0000_0000) * 0.047;
    };
    expectPoseClose(clockPose(samples, 0.6, randomStep, 0.4), direct);

    const first = poseAt(samples, 0.437125, 0.4);
    poseAt(samples, 0.113, 0.4);
    const second = poseAt(samples, 0.437125, 0.4);
    expect(second).toEqual(first);
  });

  it('is C1 at ordinary knots and resets translation and rotation only at exact contact', () => {
    const samples = [
      rigidBat(0.20, { x: 0.00, y: 1.10, z: 9.10 }, 0),
      rigidBat(0.35, { x: 0.15, y: 1.10, z: 9.10 }, 15),
      rigidBat(0.50, { x: 0.30, y: 1.10, z: 9.10 }, 30),
      rigidBat(0.65, { x: 0.00, y: 1.10, z: 9.10 }, 5),
      rigidBat(0.80, { x: -0.15, y: 1.10, z: 9.10 }, -10),
    ];
    const epsilon = 0.00001;
    const angle = (pose: BatPose) => Math.atan2(axis(pose).y, axis(pose).x);
    const beforeOrdinary = poseAt(samples, 0.35 - epsilon, 0.5);
    const ordinary = poseAt(samples, 0.35, 0.5);
    const afterOrdinary = poseAt(samples, 0.35 + epsilon, 0.5);
    const ordinaryLeftV = (ordinary.grip.x - beforeOrdinary.grip.x) / epsilon;
    const ordinaryRightV = (afterOrdinary.grip.x - ordinary.grip.x) / epsilon;
    const ordinaryLeftW = (angle(ordinary) - angle(beforeOrdinary)) / epsilon;
    const ordinaryRightW = (angle(afterOrdinary) - angle(ordinary)) / epsilon;
    expect(ordinaryRightV).toBeCloseTo(ordinaryLeftV, 3);
    expect(ordinaryRightW).toBeCloseTo(ordinaryLeftW, 3);

    const beforeContact = poseAt(samples, 0.5 - epsilon, 0.5);
    const contact = poseAt(samples, 0.5, 0.5);
    const afterContact = poseAt(samples, 0.5 + epsilon, 0.5);
    expect((contact.grip.x - beforeContact.grip.x) / epsilon).toBeGreaterThan(0.9);
    expect((afterContact.grip.x - contact.grip.x) / epsilon).toBeLessThan(-1.9);
    expect((angle(contact) - angle(beforeContact)) / epsilon).toBeGreaterThan(1.7);
    expect((angle(afterContact) - angle(contact)) / epsilon).toBeLessThan(-2.8);
  });

  it('reconstructs a nonuniform C1 velocity peak without exceeding the dense motion caps', () => {
    const velocityPeakT = 0.011;
    const finishT = velocityPeakT * 2;
    const gripAcceleration = 180;
    const angularAcceleration = 220;
    const progress = (time: number, acceleration: number): number => {
      const t = Math.min(time, finishT);
      if (t <= velocityPeakT) return 0.5 * acceleration * t * t;
      const after = t - velocityPeakT;
      return 0.5 * acceleration * velocityPeakT * velocityPeakT +
        acceleration * velocityPeakT * after - 0.5 * acceleration * after * after;
    };
    const times = [0, 0.004, 0.008, velocityPeakT, 0.012, 0.016, 0.020, finishT, 0.026];
    const samples = times.map((time) => rigidBat(
      time,
      { x: -0.25 + progress(time, gripAcceleration), y: 1.12, z: 9.08 },
      5 + (progress(time, angularAcceleration) * 180) / Math.PI,
    ));

    const metrics = denseMotionMetrics(samples, null, velocityPeakT);
    expect(metrics.gripSpeed).toBeLessThanOrEqual(18);
    expect(metrics.toeSpeed).toBeLessThanOrEqual(30);
    expect(metrics.angularSpeed).toBeLessThanOrEqual(25);
    expect(metrics.gripAcceleration).toBeLessThanOrEqual(200);
    expect(metrics.toeAcceleration).toBeLessThanOrEqual(400);
    expect(metrics.angularAcceleration).toBeLessThanOrEqual(250);
    for (const sample of samples) {
      expect(poseAt(samples, sample.t, null, velocityPeakT)).toEqual({
        grip: sample.grip,
        toe: sample.toe,
        face: sample.face,
      });
    }
  });

  it('does not let a sub-0.1 ms later impulse contaminate the velocity-peak tangent', () => {
    const velocityPeakT = 0.011;
    const impulseT = velocityPeakT + 0.000075;
    const finishT = 0.022;
    const gripAcceleration = 180;
    const angularAcceleration = 220;
    const canonicalProgress = (time: number, acceleration: number): number => {
      if (time <= velocityPeakT) return 0.5 * acceleration * time * time;
      const after = time - velocityPeakT;
      return 0.5 * acceleration * velocityPeakT * velocityPeakT +
        acceleration * velocityPeakT * after - 0.5 * acceleration * after * after;
    };
    const postProgress = (time: number): number => {
      const u = Math.max(0, Math.min(1, (time - impulseT) / (finishT - impulseT)));
      return u * u * (3 - 2 * u);
    };
    const gripAtImpulse = canonicalProgress(impulseT, gripAcceleration);
    const angleAtImpulse = canonicalProgress(impulseT, angularAcceleration);
    const times = [0, 0.004, 0.008, velocityPeakT, impulseT, 0.012, 0.016, 0.020, finishT, 0.026];
    const samples = times.map((time) => {
      const afterImpulse = time > impulseT;
      const gripProgress = afterImpulse
        ? gripAtImpulse + 0.003 * postProgress(time)
        : canonicalProgress(time, gripAcceleration);
      const angle = afterImpulse
        ? angleAtImpulse + 0.0035 * postProgress(time)
        : canonicalProgress(time, angularAcceleration);
      return rigidBat(
        time,
        { x: -0.25 + gripProgress, y: 1.12, z: 9.08 },
        5 + (angle * 180) / Math.PI,
      );
    });

    const metrics = denseMotionMetrics(samples, impulseT, velocityPeakT);
    expect(metrics.gripSpeed).toBeLessThanOrEqual(18);
    expect(metrics.toeSpeed).toBeLessThanOrEqual(30);
    expect(metrics.angularSpeed).toBeLessThanOrEqual(25);
    expect(metrics.gripAcceleration).toBeLessThanOrEqual(200);
    expect(metrics.toeAcceleration).toBeLessThanOrEqual(400);
    expect(metrics.angularAcceleration).toBeLessThanOrEqual(250);
    for (const sample of samples) {
      expect(poseAt(samples, sample.t, impulseT, velocityPeakT)).toEqual({
        grip: sample.grip,
        toe: sample.toe,
        face: sample.face,
      });
    }
  });

  it('keeps distinct one-sided velocities at the exact impulse and ignores a later planned peak', () => {
    const impulseT = 0.010;
    const laterPlannedT = 0.014;
    const finishT = 0.020;
    const gripAtImpulse = 0.5 * 100 * impulseT * impulseT;
    const angleAtImpulse = 0.5 * 120 * impulseT * impulseT;
    const times = [0, 0.004, 0.008, impulseT, 0.012, laterPlannedT, 0.016, finishT, 0.024];
    const samples = times.map((time) => {
      if (time <= impulseT) {
        return rigidBat(
          time,
          { x: -0.2 + 0.5 * 100 * time * time, y: 1.1, z: 9.1 },
          (0.5 * 120 * time * time * 180) / Math.PI,
        );
      }
      const after = Math.min(time, finishT) - impulseT;
      const gripProgress = gripAtImpulse - 0.4 * after + 0.5 * 40 * after * after;
      const angle = angleAtImpulse - 0.6 * after + 0.5 * 60 * after * after;
      return rigidBat(
        time,
        { x: -0.2 + gripProgress, y: 1.1, z: 9.1 },
        (angle * 180) / Math.PI,
      );
    });
    const epsilon = 0.000001;
    const before = poseAt(samples, impulseT - epsilon, impulseT, laterPlannedT);
    const at = poseAt(samples, impulseT, impulseT, laterPlannedT);
    const after = poseAt(samples, impulseT + epsilon, impulseT, laterPlannedT);
    const angle = (pose: BatPose) => Math.atan2(axis(pose).y, axis(pose).x);
    expect((at.grip.x - before.grip.x) / epsilon).toBeCloseTo(1, 3);
    expect((after.grip.x - at.grip.x) / epsilon).toBeCloseTo(-0.4, 3);
    expect((angle(at) - angle(before)) / epsilon).toBeCloseTo(1.2, 3);
    expect((angle(after) - angle(at)) / epsilon).toBeCloseTo(-0.6, 3);
    for (let time = impulseT; time <= finishT; time += 0.0005) {
      expectPoseClose(
        poseAt(samples, time, impulseT, laterPlannedT),
        poseAt(samples, time, impulseT, null),
        12,
      );
    }
  });

  it('comes to rest at the first held-tail knot without post-finish overshoot', () => {
    const finish = rigidBat(0.60, { x: 0.28, y: 1.30, z: 8.82 }, 104);
    const samples = [
      rigidBat(0.00, { x: -0.20, y: 1.10, z: 9.20 }, -30),
      rigidBat(0.20, { x: -0.08, y: 1.32, z: 9.08 }, 5),
      rigidBat(0.40, { x: 0.12, y: 1.12, z: 8.94 }, 55),
      finish,
      { ...finish, t: 0.80, grip: { ...finish.grip }, toe: { ...finish.toe }, face: { ...finish.face } },
      { ...finish, t: 1.00, grip: { ...finish.grip }, toe: { ...finish.toe }, face: { ...finish.face } },
    ];
    const epsilon = 0.00001;
    const before = poseAt(samples, finish.t - epsilon);
    const atFinish = poseAt(samples, finish.t);
    const after = poseAt(samples, finish.t + epsilon);
    const translationalSpeed = Math.hypot(
      atFinish.grip.x - before.grip.x,
      atFinish.grip.y - before.grip.y,
      atFinish.grip.z - before.grip.z,
    ) / epsilon;
    expect(translationalSpeed).toBeLessThan(0.01);
    expectPoseClose(atFinish, { grip: finish.grip, toe: finish.toe, face: finish.face }, 12);
    expectPoseClose(after, atFinish, 12);
    for (let t = finish.t; t <= 1 + 1e-12; t += 0.001) {
      expectPoseClose(poseAt(samples, Math.min(t, 1)), atFinish, 11);
    }
  });

  it('does not invent an impulse boundary when two knots are within the contact round-trip tolerance', () => {
    const contactT = 0.5;
    const samples = [
      rigidBat(0.2, { x: 0.00, y: 1.10, z: 9.10 }, 0),
      rigidBat(contactT - 5e-13, { x: 0.20, y: 1.18, z: 9.00 }, 24),
      rigidBat(contactT, { x: 0.21, y: 1.17, z: 8.99 }, 25),
      rigidBat(0.8, { x: -0.15, y: 1.10, z: 9.10 }, -10),
    ];
    expect(poseAt(samples, 0.5001, contactT)).toEqual(poseAt(samples, 0.5001));
  });

  it('takes the deterministic shortest arc across quaternion signs and an exact pi tie', () => {
    const signCrossing = [
      rigidBat(0.2, { x: 0, y: 1.1, z: 9 }, 170),
      rigidBat(0.8, { x: 0, y: 1.1, z: 9 }, -170),
    ];
    const signAxis = axis(poseAt(signCrossing, 0.5));
    expect(signAxis.x).toBeLessThan(-0.999999);
    expect(Math.abs(signAxis.y)).toBeLessThan(0.000001);

    const piTie = [
      rigidBat(0.2, { x: 0, y: 1.1, z: 9 }, 0),
      rigidBat(0.8, { x: 0, y: 1.1, z: 9 }, 180),
    ];
    const tieAxis = axis(poseAt(piTie, 0.5));
    expect(Math.abs(tieAxis.x)).toBeLessThan(0.000001);
    expect(tieAxis.y).toBeGreaterThan(0.999999);
  });

  it('never serves a stale prepared path when a mutable diagnostic trace changes', () => {
    const samples = [
      rigidBat(0.2, { x: 0, y: 1.1, z: 9 }, 0),
      rigidBat(0.8, { x: 0.4, y: 1.3, z: 8.8 }, 40),
    ];
    const before = poseAt(samples, 0.5);
    samples[1].grip.x += 0.3;
    samples[1].toe.x += 0.3;
    const after = poseAt(samples, 0.5);
    expect(after.grip.x).toBeGreaterThan(before.grip.x + 0.1);
    assertRigid(after);
  });
});
