import { describe, expect, it } from 'vitest';
import type { BatSample, Footwork, NormalizedSwing } from '@/contracts/practice';
import {
  BAT_POSTURE_CROUCH_MAX_M,
  batPoseAdmissibility,
  remainingBatterPostureCrouchM,
} from '@/physics/admissibility';
import {
  BAT_ANGULAR_ACCEL_LIMIT_RADPS2,
  BAT_ANGULAR_SPEED_LIMIT_RADPS,
  BAT_GRIP_ACCEL_LIMIT_MPS2,
  BAT_GRIP_SPEED_LIMIT_MPS,
  BAT_POINT_ACCEL_LIMIT_MPS2,
  BAT_POINT_SPEED_LIMIT_MPS,
  batPose,
  batPointVelocity,
  batSamples,
  batTrackAnalyticEnvelope,
  batterBody,
  buildBatTrack,
  presentationBatSamples,
  trackEndT,
  zonePose,
  type BatPose,
  type BatTrack,
} from '@/physics/bat';
import { BLADE_L, BODY, HANDLE_L } from '@/physics/constants';
import { sweep } from '@/physics/collision';
import { batAt } from '@/render3d/practice/frame';
import type { Vec3 } from '@/physics/vec';
import { PACE, fly, timedSwing } from './physics-helpers';

const BAT_FULL = BLADE_L + HANDLE_L;
const DECISIVE = new WeakMap<BatTrack, number>();

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(a: Vec3, amount: number): Vec3 {
  return { x: a.x * amount, y: a.y * amount, z: a.z * amount };
}

function axis(pose: BatPose): Vec3 {
  const value = sub(pose.grip, pose.toe);
  return scale(value, 1 / Math.hypot(value.x, value.y, value.z));
}

function orientationAngle(a: BatPose, b: BatPose): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(axis(a), axis(b)))));
}

function mirrorX(value: Vec3): Vec3 {
  return { x: -value.x, y: value.y, z: value.z };
}

function samplePose(sample: BatSample): BatPose {
  return { grip: sample.grip, toe: sample.toe, n: sample.face };
}

function attackTrack(directionDeg: number, footwork: Footwork, lengthM: number, lineM: number, elevation = 0.1): BatTrack {
  const flight = fly({ variation: lengthM >= 9.5 ? 'bouncer' : 'stock', lengthM, lineM, speedKph: 136 });
  const swing = timedSwing(flight, 0, { kind: 'attack', directionDeg, elevation, power: 0.65 }, footwork);
  const track = buildBatTrack(flight, swing, { assist: 'real' });
  const hit = sweep(flight.samples, track, track.body, 0, flight.samples.at(-1)!.t).hit;
  if (!hit || (hit.part !== 'blade' && hit.part !== 'handle')) throw new Error(`Representative ${track.shot.family} did not hit the bat`);
  DECISIVE.set(track, hit.t);
  return track;
}

function decisiveTime(track: BatTrack): number {
  const value = DECISIVE.get(track);
  if (value === undefined) throw new Error(`Missing decisive time for ${track.shot.family}`);
  return value;
}

function representativeAttacks(): BatTrack[] {
  const front = [-150, -80, -20, 0, 25, 55, 100, 150].map((direction) =>
    attackTrack(direction, 'forward', 4, direction < 0 ? -0.08 : 0.18),
  );
  const back = [
    attackTrack(-140, 'back', 10.5, -0.2, 0.25),
    attackTrack(-80, 'back', 10.5, -0.2, 0.25),
    attackTrack(-30, 'back', 7, -0.08),
    attackTrack(0, 'back', 7, 0.05),
    attackTrack(40, 'back', 7, 0.18),
    attackTrack(90, 'back', 10.5, 0.3, 0.2),
  ];
  return [...front, ...back];
}

function assertRigidSafeSample(sample: BatSample, track: BatTrack): void {
  const pose = samplePose(sample);
  expect(distance(pose.grip, pose.toe)).toBeCloseTo(BAT_FULL, 12);
  expect(Math.hypot(pose.n.x, pose.n.y, pose.n.z)).toBeCloseTo(1, 12);
  expect(Math.abs(dot(axis(pose), pose.n))).toBeLessThan(1e-12);
  expect(batPoseAdmissibility(pose, track.body).gap).toBeGreaterThanOrEqual(-1e-10);
  expect(pose.toe.y).toBeGreaterThanOrEqual(0.005 - 1e-12);
}

interface Kinematics {
  maxGripSpeed: number;
  maxToeSpeed: number;
  maxGripAcceleration: number;
  maxToeAcceleration: number;
  maxAngularSpeed: number;
  maxAngularAcceleration: number;
  maxFaceAngularSpeed: number;
  maxFaceAngularAcceleration: number;
  terminalSpeed: number;
}

function traceKinematics(samples: readonly BatSample[], impulseIndex: number | null): Kinematics {
  let maxGripSpeed = 0;
  let maxToeSpeed = 0;
  let maxGripAcceleration = 0;
  let maxToeAcceleration = 0;
  let maxAngularSpeed = 0;
  let maxAngularAcceleration = 0;
  let maxFaceAngularSpeed = 0;
  let maxFaceAngularAcceleration = 0;
  let previousGripV: Vec3 | null = null;
  let previousToeV: Vec3 | null = null;
  let previousDt = 0;
  let previousAngularSpeed: number | null = null;
  let previousFaceAngularSpeed: number | null = null;
  let terminalSpeed = 0;
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].t - samples[i - 1].t;
    expect(dt).toBeGreaterThan(0);
    const gripV = scale(sub(samples[i].grip, samples[i - 1].grip), 1 / dt);
    const toeV = scale(sub(samples[i].toe, samples[i - 1].toe), 1 / dt);
    const gripSpeed = Math.hypot(gripV.x, gripV.y, gripV.z);
    const toeSpeed = Math.hypot(toeV.x, toeV.y, toeV.z);
    const angularSpeed = Math.acos(Math.max(-1, Math.min(1, dot(axis(samplePose(samples[i - 1])), axis(samplePose(samples[i])))))) / dt;
    const faceAngularSpeed = Math.acos(Math.max(-1, Math.min(1, dot(samples[i - 1].face, samples[i].face)))) / dt;
    maxGripSpeed = Math.max(maxGripSpeed, gripSpeed);
    maxToeSpeed = Math.max(maxToeSpeed, toeSpeed);
    maxAngularSpeed = Math.max(maxAngularSpeed, angularSpeed);
    maxFaceAngularSpeed = Math.max(maxFaceAngularSpeed, faceAngularSpeed);
    if (previousGripV && previousToeV && (impulseIndex === null || i !== impulseIndex + 1)) {
      const centreDt = (previousDt + dt) / 2;
      maxGripAcceleration = Math.max(maxGripAcceleration, distance(gripV, previousGripV) / centreDt);
      maxToeAcceleration = Math.max(maxToeAcceleration, distance(toeV, previousToeV) / centreDt);
      if (previousAngularSpeed !== null) maxAngularAcceleration = Math.max(maxAngularAcceleration, Math.abs(angularSpeed - previousAngularSpeed) / centreDt);
      if (previousFaceAngularSpeed !== null) maxFaceAngularAcceleration = Math.max(maxFaceAngularAcceleration, Math.abs(faceAngularSpeed - previousFaceAngularSpeed) / centreDt);
    }
    if (i === samples.length - 1) terminalSpeed = Math.max(gripSpeed, toeSpeed);
    previousGripV = gripV;
    previousToeV = toeV;
    previousDt = dt;
    previousAngularSpeed = angularSpeed;
    previousFaceAngularSpeed = faceAngularSpeed;
  }
  return {
    maxGripSpeed,
    maxToeSpeed,
    maxGripAcceleration,
    maxToeAcceleration,
    maxAngularSpeed,
    maxAngularAcceleration,
    maxFaceAngularSpeed,
    maxFaceAngularAcceleration,
    terminalSpeed,
  };
}

function runtimeSamples(
  samples: readonly BatSample[],
  contactT: number | null,
  velocityPeakT: number | null = null,
  dt = 0.001,
): BatSample[] {
  const start = samples[0].t;
  const end = samples.at(-1)!.t;
  const anchors = [start, ...(contactT === null ? [] : [contactT]),
    ...(velocityPeakT === null ? [] : [velocityPeakT]), end];
  const times = [...anchors];
  for (let index = 1; start + index * dt < end; index++) {
    const time = start + index * dt;
    // Keep exact authority knots instead of a floating-grid point a few nanoseconds away. Otherwise acos roundoff
    // over the near-zero final interval can manufacture hundreds of rad/s² in an actually held rigid pose.
    if (anchors.every((anchor) => Math.abs(time - anchor) >= dt * 0.5)) times.push(time);
  }
  return times.sort((a, b) => a - b).map((time) => {
    const pose = batAt(samples, time, contactT, velocityPeakT)!;
    return { t: time, grip: pose.grip, toe: pose.toe, face: pose.face };
  });
}

// The presented trace must stay inside the same analytic envelope every collision path is certified against (bat.ts).
// These were literal copies of the former caps (30 m/s, 400 m/s², 25 rad/s, 250 rad/s²), which were below the model's
// own requested strokes; the envelope now follows the one source.
function expectInsideKinematicEnvelope(motion: Kinematics): void {
  expect(motion.maxGripSpeed).toBeLessThanOrEqual(BAT_GRIP_SPEED_LIMIT_MPS);
  expect(motion.maxToeSpeed).toBeLessThanOrEqual(BAT_POINT_SPEED_LIMIT_MPS);
  expect(motion.maxGripAcceleration).toBeLessThanOrEqual(BAT_GRIP_ACCEL_LIMIT_MPS2);
  expect(motion.maxToeAcceleration).toBeLessThanOrEqual(BAT_POINT_ACCEL_LIMIT_MPS2);
  expect(motion.maxAngularSpeed).toBeLessThanOrEqual(BAT_ANGULAR_SPEED_LIMIT_RADPS);
  expect(motion.maxAngularAcceleration).toBeLessThanOrEqual(BAT_ANGULAR_ACCEL_LIMIT_RADPS2);
  expect(motion.maxFaceAngularSpeed).toBeLessThanOrEqual(BAT_ANGULAR_SPEED_LIMIT_RADPS);
  expect(motion.maxFaceAngularAcceleration).toBeLessThanOrEqual(BAT_ANGULAR_ACCEL_LIMIT_RADPS2);
  expect(motion.terminalSpeed).toBeLessThanOrEqual(0.1);
}

describe('authored bat motion', () => {
  it('keeps the normal back-foot frame and continuously bounds the low-read knee bend and lateral lean', () => {
    const topLean = (body: ReturnType<typeof batterBody>) => body.head.c.x - body.pads[1].a.x;
    const normal = batterBody('back', fly({ variation: 'stock', lengthM: 6, lineM: 0.05, speedKph: 136 }));
    expect(normal.pads[0].a.y).toBe(BODY.padBottom);
    expect(normal.pads[0].b.y).toBe(BODY.padTop);
    expect(normal.torso.a.y).toBe(BODY.torsoBottom);
    expect(normal.torso.b.y).toBe(BODY.torsoTop);
    expect(normal.head.c.y).toBe(BODY.headY);
    expect(topLean(normal)).toBeCloseTo(0, 12);

    const mediumLow = batterBody('back', fly({ variation: 'stock', lengthM: 3, lineM: 0.02, speedKph: 140 }));
    const veryLow = batterBody('back', fly({ variation: 'stock', lengthM: 2.5, lineM: 0.02, speedKph: 140 }));
    expect(topLean(mediumLow)).toBeGreaterThan(0);
    expect(topLean(veryLow)).toBeGreaterThan(topLean(mediumLow));
    expect(topLean(veryLow)).toBeLessThan(0.04);

    const yorker = batterBody('back', fly({ variation: 'yorker', lengthM: 0.9, lineM: 0.02, speedKph: 140 }));
    expect(yorker.stance.y).toBe(0);
    expect(yorker.pads[0].a.y).toBe(BODY.padBottom);
    expect(yorker.pads[1].a.y).toBe(BODY.padBottom);
    expect(yorker.pads[0].b.y).toBeCloseTo(BODY.padTop - 0.03, 12);
    expect(yorker.pads[1].b.y).toBeCloseTo(BODY.padTop - 0.03, 12);
    expect(yorker.torso.a.y).toBeCloseTo(BODY.torsoBottom - 0.03, 12);
    expect(yorker.torso.b.y).toBeCloseTo(BODY.torsoTop - 0.03, 12);
    expect(yorker.head.c.y).toBeCloseTo(BODY.headY - 0.03, 12);
    expect(topLean(yorker)).toBeCloseTo(0.04, 12);
    expect(yorker.torso.b.x - yorker.pads[1].a.x + 0.1).toBeCloseTo(0.04, 12);
    expect(yorker.torso.a.x - yorker.pads[1].a.x + 0.14).toBeCloseTo(0.04 * 0.35, 12);
    expect(yorker.pads[1].a.x - yorker.pads[0].a.x).toBeCloseTo(0.14, 12);
  });

  it('keeps the planted pads clear until a perfect straight bat reaches a yorker first', () => {
    const flight = fly({ variation: 'yorker', lengthM: 0.9, lineM: 0.02, speedKph: 140 });
    const swing = timedSwing(flight, 0, { directionDeg: 0, elevation: 0.05, power: 0.4 });
    const track = buildBatTrack(flight, swing, { assist: 'real', expect: { bowler: PACE, conditions: 'balanced' } });
    // Before: automatic footwork dug the yorker out from the back plane (batterBody('back')), where no straight bat
    // could be certified and the bat passed 11-13 cm over the ball. After (PHYS phase 4, 2026-11-03): it is smothered
    // on the forward stride, so the posture limits are those of the footwork actually played.
    expect(track.footwork).toBe('forward');
    const authoredCrouchM = BODY.torsoTop - batterBody(track.footwork, flight).torso.b.y;
    expect(track.batterPosture.crouchM).toBeLessThanOrEqual(remainingBatterPostureCrouchM(batterBody(track.footwork, flight)) + 1e-12);
    expect(authoredCrouchM + track.batterPosture.crouchM).toBeLessThanOrEqual(BAT_POSTURE_CROUCH_MAX_M + 1e-12);
    const t0 = flight.samples.find((sample) => sample.p.z >= 5.5)?.t ?? flight.samples[0].t;
    const bodyOnly = sweep(flight.samples, null, track.body, t0, track.plannedContactT);
    const combined = sweep(flight.samples, track, track.body, t0, flight.samples.at(-1)!.t);
    expect(bodyOnly.hit).toBeNull();
    expect(combined.hit?.part).toBe('blade');
    expect(combined.hit!.t).toBeCloseTo(track.plannedContactT, 5);
  });

  it('preserves the canonical collision track and ignores finish throughout the contact zone', () => {
    const flight = fly({ variation: 'stock', lengthM: 6.5, lineM: 0.05, speedKph: 136 }, undefined, 'balanced', 't3');
    const swing: NormalizedSwing = timedSwing(flight, 0, { kind: 'attack', power: 0.6, elevation: 0.1, directionDeg: 0 });
    const track = buildBatTrack(flight, swing, { assist: 'real' });
    expect(track.zoneIn).toBeLessThan(track.plannedContactT);
    expect(track.zoneOut).toBeGreaterThan(track.plannedContactT);
    expect(zonePose(track, track.plannedContactT)).toEqual(batPose(track, track.plannedContactT));
    const changedFinish: BatTrack = {
      ...track,
      finish: { grip: { x: 99, y: -98, z: 97 }, toe: { x: -96, y: 95, z: -94 }, n: { x: 0, y: 1, z: 0 } },
    };
    for (let i = 0; i <= 512; i++) {
      const time = track.zoneIn + ((track.zoneOut - track.zoneIn) * i) / 512;
      expect(batPose(track, time)).toEqual(zonePose(track, time));
      expect(batPose(changedFinish, time)).toEqual(batPose(track, time));
    }
    // The authoritative pre-result stroke is C1 at activation, planned contact and rest. Exact analytic point
    // velocity—not a finite-difference stencil across a branch—goes continuously to/from rest.
    for (const boundary of [track.zoneIn, track.plannedContactT, track.zoneOut]) {
      const point = batPose(track, boundary).toe;
      const before = batPointVelocity(track, boundary - 1e-8, point);
      const after = batPointVelocity(track, boundary + 1e-8, point);
      expect(distance(before, after)).toBeLessThan(1e-4);
    }
  });

  it('keeps defence collision pose frozen after zone-out but returns a safe exact-contact visible trace', () => {
    const flight = fly({ lengthM: 5.5, lineM: 0.05, speedKph: 136 });
    const swing = timedSwing(flight, 0, { kind: 'defend', power: 0.15, elevation: 0, directionDeg: 0 });
    const track = buildBatTrack(flight, swing, { assist: 'real' });
    const last = zonePose(track, track.zoneOut);
    for (let i = 0; i <= 128; i++) expect(batPose(track, track.zoneOut + (2 * i) / 128)).toEqual(last);
    const hit = sweep(flight.samples, track, track.body, 0, flight.samples.at(-1)!.t).hit;
    expect(['blade', 'handle']).toContain(hit?.part);
    const decisiveT = hit!.t;
    const presented = presentationBatSamples(track, decisiveT)!;
    expect(presented).not.toEqual(batSamples(track));
    expect(presented.filter((sample) => sample.t === decisiveT)).toHaveLength(1);
    expect(samplePose(presented.find((sample) => sample.t === decisiveT)!)).toEqual(batPose(track, decisiveT));
    for (const sample of presented) assertRigidSafeSample(sample, track);
  });

  it('preserves the planned acceleration breakpoint before a later exact hit without creating another impulse', () => {
    const flight = fly(
      { variation: 'stock', lengthM: 6.5, lineM: 0.05, speedKph: 136 },
      PACE,
      'balanced',
      't3',
    );
    // 1 ms early, so the exact hit comes after the planned instant (+0.65 ms). At 0 ms the ordering was a numerical
    // tie (the hit 0.04 us before plannedContactT after the PHYS phase-2 face fixes; 36 ns after it before them).
    const swing = timedSwing(flight, -1, { directionDeg: 0, power: 0.6, elevation: 0.2 });
    const track = buildBatTrack(flight, swing, {
      assist: 'real',
      expect: { bowler: PACE, conditions: 'balanced', handedness: 'right' },
    });
    const hit = sweep(flight.samples, track, track.body, 0, flight.samples.at(-1)!.t).hit;
    expect(['blade', 'handle']).toContain(hit?.part);
    expect(hit!.t).toBeGreaterThan(track.plannedContactT);
    const presented = presentationBatSamples(track, hit!.t)!;
    const zoneIn = presented.filter((sample) => sample.t === track.zoneIn);
    const planned = presented.filter((sample) => sample.t === track.plannedContactT);
    const contact = presented.filter((sample) => sample.t === hit!.t);
    expect(zoneIn).toHaveLength(1);
    expect(planned).toHaveLength(1);
    expect(contact).toHaveLength(1);
    expect(samplePose(planned[0])).toEqual(batPose(track, track.plannedContactT));
    expect(presented.indexOf(planned[0])).toBeLessThan(presented.indexOf(contact[0]));
    const runtime = runtimeSamples(presented, hit!.t, track.plannedContactT);
    const runtimeContact = runtime.findIndex((sample) => sample.t === hit!.t);
    expectInsideKinematicEnvelope(traceKinematics(runtime, runtimeContact));
  });

  it('inserts one exact immutable contact knot and stays inside every presentation envelope for all shot families', () => {
    const tracks = representativeAttacks();
    expect(new Set(tracks.map((track) => track.shot.family))).toEqual(new Set([
      'straight_drive', 'off_drive', 'cover_drive', 'square_drive', 'steer', 'on_drive', 'flick', 'glance',
      'back_drive', 'back_punch', 'back_on_punch', 'cut', 'pull', 'hook',
    ]));
    let incomingGripMax = 0;
    let incomingToeMax = 0;
    for (const track of tracks) {
      const analytic = batTrackAnalyticEnvelope(track);
      expect(analytic.gripSpeed).toBeLessThanOrEqual(BAT_GRIP_SPEED_LIMIT_MPS);
      expect(analytic.pointSpeed).toBeLessThanOrEqual(BAT_POINT_SPEED_LIMIT_MPS);
      expect(analytic.gripAcceleration).toBeLessThanOrEqual(BAT_GRIP_ACCEL_LIMIT_MPS2);
      expect(analytic.pointAcceleration).toBeLessThanOrEqual(BAT_POINT_ACCEL_LIMIT_MPS2);
      expect(analytic.angularSpeed).toBeLessThanOrEqual(BAT_ANGULAR_SPEED_LIMIT_RADPS);
      expect(analytic.angularAcceleration).toBeLessThanOrEqual(BAT_ANGULAR_ACCEL_LIMIT_RADPS2);
      const decisiveT = decisiveTime(track);
      const dt = 0.0005;
      const presented = presentationBatSamples(track, decisiveT, dt)!;
      expect(presented).toEqual(presentationBatSamples(track, decisiveT, dt));
      expect(Object.isFrozen(presented)).toBe(true);
      const contactIndices = presented.flatMap((sample, index) => sample.t === decisiveT ? [index] : []);
      expect(contactIndices).toHaveLength(1);
      const contactIndex = contactIndices[0];
      expect(presented.filter((sample) => sample.t === track.zoneIn)).toHaveLength(1);
      expect(presented.filter((sample) => sample.t === track.plannedContactT)).toHaveLength(1);
      expect(samplePose(presented[contactIndex])).toEqual(batPose(track, decisiveT));
      expect(presented[0].t).toBe(track.startT);
      expect(presented.at(-1)!.t).toBe(trackEndT(track));
      for (let i = 0; i < presented.length; i++) {
        if (i) expect(presented[i].t).toBeGreaterThan(presented[i - 1].t);
        expect(Object.isFrozen(presented[i])).toBe(true);
        expect(Object.isFrozen(presented[i].grip)).toBe(true);
        expect(Object.isFrozen(presented[i].toe)).toBe(true);
        expect(Object.isFrozen(presented[i].face)).toBe(true);
        assertRigidSafeSample(presented[i], track);
      }
      expectInsideKinematicEnvelope(traceKinematics(presented, contactIndex));
      const runtime = runtimeSamples(presented, decisiveT, track.plannedContactT);
      const runtimeContact = runtime.findIndex((sample) => sample.t === decisiveT);
      expect(runtimeContact).toBeGreaterThan(0);
      for (const sample of runtime) assertRigidSafeSample(sample, track);
      expectInsideKinematicEnvelope(traceKinematics(runtime, runtimeContact));
      const canonical = batSamples(track, dt);
      const boundary = canonical.findIndex((sample) => sample.t >= decisiveT);
      const canonicalDt = canonical[boundary].t - canonical[boundary - 1].t;
      incomingGripMax = Math.max(incomingGripMax, distance(canonical[boundary].grip, canonical[boundary - 1].grip) / canonicalDt);
      incomingToeMax = Math.max(incomingToeMax, distance(canonical[boundary].toe, canonical[boundary - 1].toe) / canonicalDt);
    }
    // Sim-v3 makes the authoritative incoming collision tangent itself visible-skeleton-safe. Contact remains the
    // only permitted derivative reset, while both sides independently stay inside the biomechanical envelopes.
    expect(incomingGripMax).toBeGreaterThan(1);
    expect(incomingGripMax).toBeLessThanOrEqual(BAT_GRIP_SPEED_LIMIT_MPS);
    expect(incomingToeMax).toBeGreaterThan(1);
    expect(incomingToeMax).toBeLessThanOrEqual(BAT_POINT_SPEED_LIMIT_MPS);
  });

  it('authors miss/pad/body-style motion without inserting an impulse knot', () => {
    const flight = fly({ lengthM: 6.5, lineM: 0.05, speedKph: 136 });
    const swing = timedSwing(flight, 30, { directionDeg: 20 });
    const track = buildBatTrack(flight, swing, { assist: 'real' });
    const anchor = track.plannedContactT + 0.000123456789;
    const presented = batSamples(track, 0.0005);
    expect(presented).toEqual(batSamples(track, 0.0005));
    expect(presented.some((sample) => sample.t === anchor)).toBe(false);
    expect(Object.isFrozen(presented)).toBe(true);
    for (const sample of presented) assertRigidSafeSample(sample, track);
    expectInsideKinematicEnvelope(traceKinematics(presented, null));
    const runtime = runtimeSamples(presented, null, track.plannedContactT);
    expect(Math.min(...runtime.slice(1).map((sample, index) => sample.t - runtime[index].t))).toBeGreaterThanOrEqual(0.0005 - 1e-12);
    for (const sample of runtime) assertRigidSafeSample(sample, track);
    expectInsideKinematicEnvelope(traceKinematics(runtime, null));
  });

  it('retains visible backlift/downswing, attack-vs-defend and drive/cut/pull/flick semantics', () => {
    for (const track of representativeAttacks()) {
      const decisiveT = decisiveTime(track);
      const trace = presentationBatSamples(track, decisiveT, 0.002)!;
      const contactIndex = trace.findIndex((sample) => sample.t === decisiveT);
      expect(orientationAngle(samplePose(trace[0]), samplePose(trace[contactIndex])), `${track.shot.family} backlift`).toBeGreaterThan(0.005);
      expect(orientationAngle(samplePose(trace[contactIndex]), samplePose(trace.at(-1)!)), `${track.shot.family} follow-through`).toBeGreaterThan(0.005);
    }

    const flight = fly({ lengthM: 6.5, lineM: 0.05, speedKph: 136 });
    const attack = buildBatTrack(flight, timedSwing(flight, 0, { kind: 'attack', directionDeg: 0 }), { assist: 'real' });
    const defend = buildBatTrack(flight, timedSwing(flight, 0, { kind: 'defend', directionDeg: 0, power: 0.15 }), { assist: 'real' });
    const attackTrace = batSamples(attack, 0.002);
    const defendTrace = batSamples(defend, 0.002);
    const attackBacklift = orientationAngle(samplePose(attackTrace[0]), samplePose(attackTrace.reduce((a, b) => Math.abs(b.t - attack.plannedContactT) < Math.abs(a.t - attack.plannedContactT) ? b : a)));
    const defendBacklift = orientationAngle(samplePose(defendTrace[0]), samplePose(defendTrace.reduce((a, b) => Math.abs(b.t - defend.plannedContactT) < Math.abs(a.t - defend.plannedContactT) ? b : a)));
    expect(attackBacklift).toBeGreaterThan(defendBacklift + 0.05);

    const byFamily = new Map(representativeAttacks().map((track) => [track.shot.family, track]));
    const signatures: Vec3[] = [];
    for (const family of ['straight_drive', 'cut', 'pull', 'flick'] as const) {
      const track = byFamily.get(family)!;
      const contact = batPose(track, decisiveTime(track));
      const finish = samplePose(presentationBatSamples(track, decisiveTime(track), 0.002)!.at(-1)!);
      const displacement = sub(finish.grip, contact.grip);
      // Before: the pull was grouped with the cut (finish towards +x). It was never reached: until PHYS phase 3 the
      // representative pull at the 10.5 m ball did not hit the bat. After: the pull is a leg-side stroke and, like the
      // flick, completes over the lead shoulder (bat.ts followThroughSide: only square drive, steer, back punch and
      // cut finish outside the off shoulder); its presentation finish moves the hands 0.112 m towards −x.
      if (family === 'cut') expect(displacement.x, family).toBeGreaterThan(0);
      else expect(displacement.x, family).toBeLessThan(0);
      signatures.push(sub(axis(finish), axis(contact)));
    }
    for (const family of ['cut', 'pull'] as const) {
      const track = byFamily.get(family)!;
      const trace = batSamples(track, 0.002);
      const anchor = trace.reduce((a, b) => Math.abs(b.t - track.plannedContactT) < Math.abs(a.t - track.plannedContactT) ? b : a);
      expect(Math.abs(axis(samplePose(anchor)).y), `${family} cross-bat`).toBeLessThan(0.5);
    }
    const drive = byFamily.get('straight_drive')!;
    const driveTrace = batSamples(drive, 0.002);
    const driveAnchor = driveTrace.reduce((a, b) => Math.abs(b.t - drive.plannedContactT) < Math.abs(a.t - drive.plannedContactT) ? b : a);
    expect(Math.abs(axis(samplePose(driveAnchor)).y), 'straight-drive vertical bat').toBeGreaterThan(0.7);
    for (let i = 0; i < signatures.length; i++) {
      for (let j = i + 1; j < signatures.length; j++) expect(distance(signatures[i], signatures[j])).toBeGreaterThan(0.005);
    }
  });

  it('preserves rigid geometry under the renderer single mirror and returns after a double mirror', () => {
    for (const track of representativeAttacks()) {
      for (const sample of presentationBatSamples(track, decisiveTime(track), 0.002)!) {
        const pose = samplePose(sample);
        const mirrored = { grip: mirrorX(pose.grip), toe: mirrorX(pose.toe), n: mirrorX(pose.n) };
        const restored = { grip: mirrorX(mirrored.grip), toe: mirrorX(mirrored.toe), n: mirrorX(mirrored.n) };
        expect(distance(mirrored.grip, mirrored.toe)).toBe(distance(pose.grip, pose.toe));
        expect(dot(axis(mirrored), mirrored.n)).toBe(dot(axis(pose), pose.n));
        expect(restored).toEqual(pose);
      }
    }
  });

  it('moves every admitted contact into a nonzero safe follow-through', () => {
    for (const track of representativeAttacks()) {
      const decisiveT = decisiveTime(track);
      const presented = presentationBatSamples(track, decisiveT, 0.002)!;
      const contact = batPose(track, decisiveT);
      const finish = samplePose(presented.at(-1)!);
      expect(distance(finish.grip, contact.grip), track.shot.family).toBeGreaterThan(1e-4);
      expect(batPoseAdmissibility(finish, track.body).gap).toBeGreaterThanOrEqual(-1e-10);
    }
  });
});
