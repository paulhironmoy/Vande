// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { batSpeed, buildBatTrack } from '@/physics/bat';
import { sweep } from '@/physics/collision';
import { PACE, fly, timedSwing } from './physics-helpers';

const EXPECTED_STOCK = {
  bowler: PACE,
  conditions: 'balanced' as const,
  handedness: 'right' as const,
};

// Refrozen 2026-11-03 (PHYS phase 2, wedge physics REPORT). These identities pinned the collapsed planner: every
// stroke below was played at 0.7-7.9 m/s although 23.6 m/s (17.7 m/s off the back foot) was requested, mostly on a
// toe-first or legacy fallback. The repaired physics plays each one at its requested speed on the generalized path
// with the sweet spot at the read; each test keeps its semantic property (family, face or edge, determinism) and now
// pins the repaired identity. Former pins are listed per test.
const REQUESTED_FRONT = batSpeed('attack', 0.65);
const REQUESTED_BACK = batSpeed('attack', 0.65) * 0.75;

describe('high-speed stroke authority', () => {
  it('preserves the intended blade-edge glance for a full leg-side ball', () => {
    const ball = fly({ variation: 'stock', lengthM: 4, lineM: -0.08, speedKph: 136 });
    const swing = timedSwing(
      ball,
      0,
      {
        kind: 'attack',
        directionDeg: -150,
        elevation: 0.1,
        power: 0.65,
      },
      'forward',
    );

    const track = buildBatTrack(ball, swing, { assist: 'real' });
    const replay = buildBatTrack(ball, swing, { assist: 'real' });
    const hit = sweep(ball.samples, track, track.body, 0, ball.samples.at(-1)!.t).hit;

    expect(replay).toEqual(track);
    expect(track.shot.family).toBe('glance');
    // Was 7.928125 m/s (a speed-reduced legacy fallback).
    expect(track.speed).toBeCloseTo(REQUESTED_FRONT, 12);
    expect(track.collisionPath?.kind).toBe('free-grip-so3');
    expect(hit?.part).toBe('blade');
    expect(hit?.blade?.region).toBe('edge');
  });

  it('preserves the established full-ball flick face contact after a projected-path rejection', () => {
    const ball = fly({ variation: 'stock', lengthM: 4, lineM: -0.08, speedKph: 136 });
    const swing = timedSwing(
      ball,
      0,
      {
        kind: 'attack',
        directionDeg: -80,
        elevation: 0.1,
        power: 0.65,
      },
      'forward',
    );

    const track = buildBatTrack(ball, swing, { assist: 'real' });
    const hit = sweep(ball.samples, track, track.body, 0, ball.samples.at(-1)!.t).hit;

    expect(track.shot.family).toBe('flick');
    // Was 5.8078125 m/s at U 0.2, root (0.017730441, -0.009936948), crouch 0.171191301.
    expect(track.speed).toBeCloseTo(REQUESTED_FRONT, 12);
    expect(track.contactU).toBeCloseTo(0.225, 12);
    expect(track.batterRootOffset.x).toBeCloseTo(-0.127385986036, 9);
    expect(track.batterRootOffset.z).toBeCloseTo(-0.125895276168, 9);
    expect(track.batterPosture.crouchM).toBeCloseTo(0.18, 9);
    expect(hit?.part).toBe('blade');
    expect(hit?.blade?.region).toBe('face');
  });

  it('preserves the first generalized high-speed on-drive authority before legacy recovery', () => {
    const ball = fly({ variation: 'stock', lengthM: 4, lineM: -0.08, speedKph: 136 });
    const swing = timedSwing(
      ball,
      0,
      {
        kind: 'attack',
        directionDeg: -20,
        elevation: 0.1,
        power: 0.65,
      },
      'forward',
    );

    const track = buildBatTrack(ball, swing, { assist: 'real' });
    const hit = sweep(ball.samples, track, track.body, 0, ball.samples.at(-1)!.t).hit;

    expect(track.shot.family).toBe('on_drive');
    expect(track.speed).toBeCloseTo(REQUESTED_FRONT, 12);
    // Was U 0.025: the generalized planner tried the toe first at high speed; it now aims the sweet spot.
    expect(track.contactU).toBeCloseTo(0.225, 12);
    expect(track.collisionPath?.kind).toBe('free-grip-so3');
    expect(hit?.part).toBe('blade');
    expect(hit?.blade?.region).toBe('face');
  });

  it('preserves the expected-delivery flick exact-body authority after projected rejection', () => {
    const ball = fly({ variation: 'stock', lengthM: 4, lineM: -0.08, speedKph: 136 });
    const swing = timedSwing(
      ball,
      0,
      {
        kind: 'attack',
        directionDeg: -80,
        elevation: 0.1,
        power: 0.65,
      },
      'forward',
    );

    const track = buildBatTrack(ball, swing, { assist: 'real', expect: EXPECTED_STOCK });
    const hit = sweep(ball.samples, track, track.body, 0, ball.samples.at(-1)!.t).hit;

    // Was 5.8078125 m/s at U 0.2, root (0.023031918281, -0.012672623864), crouch 0.170888124645.
    expect(track.speed).toBeCloseTo(REQUESTED_FRONT, 12);
    expect(track.contactU).toBeCloseTo(0.225, 12);
    expect(track.batterRootOffset.x).toBeCloseTo(-0.124050282704, 11);
    expect(track.batterRootOffset.z).toBeCloseTo(-0.129183347847, 11);
    expect(track.batterPosture.crouchM).toBeCloseTo(0.18, 11);
    expect(hit?.part).toBe('blade');
    expect(hit?.blade?.region).toBe('face');
  });

  it('keeps a longitudinal expected-delivery on-drive outside the projected family', () => {
    const ball = fly({ variation: 'stock', lengthM: 4, lineM: -0.08, speedKph: 136 });
    const swing = timedSwing(
      ball,
      0,
      {
        kind: 'attack',
        directionDeg: -20,
        elevation: 0.1,
        power: 0.65,
      },
      'forward',
    );

    const track = buildBatTrack(ball, swing, { assist: 'real', expect: EXPECTED_STOCK });
    const hit = sweep(ball.samples, track, track.body, 0, ball.samples.at(-1)!.t).hit;

    // Was 4.3328125 m/s at U 0.175, root (-0.165466824273, -0.068538602737), crouch 0.18.
    expect(track.speed).toBeCloseTo(REQUESTED_FRONT, 12);
    expect(track.contactU).toBeCloseTo(0.225, 12);
    expect(track.collisionPath?.kind).toBe('free-grip-so3');
    expect(track.batterRootOffset.x).toBeCloseTo(-0.115439471825, 11);
    expect(track.batterRootOffset.z).toBeCloseTo(-0.136932605119, 11);
    expect(track.batterPosture.crouchM).toBeCloseTo(0.18, 12);
    expect(hit?.part).toBe('blade');
    expect(hit?.blade?.region).toBe('face');
  });

  // Former pins (speed m/s / U / root x, z / crouch): off 2.95 / 0.175 / 0.126642824511, 0.126642824511 / 0.18;
  // cover 1.5671875 / 0.175 / same / 0.18; square 1.5671875 / 0.2 / same / 0.18; steer 1.659375 / 0.225 /
  // -0.000706408232, -0.000962624524 / 0.156519169666; back drive 0.69140625 / 0.225 / 0.000358299761,
  // -0.000180300667 / 0; back punch 6.568359375 / 0.225 / 0.007527508975, -0.004049505951 / 0.
  it.each([
    {
      label: 'off drive',
      directionDeg: 25,
      footwork: 'forward' as const,
      lengthM: 4,
      lineM: 0.18,
      speed: REQUESTED_FRONT,
      contactU: 0.225,
      rootX: -0.128155936427,
      rootZ: -0.125111414181,
      crouch: 0.18,
    },
    {
      label: 'cover drive',
      directionDeg: 55,
      footwork: 'forward' as const,
      lengthM: 4,
      lineM: 0.18,
      speed: REQUESTED_FRONT,
      contactU: 0.225,
      rootX: -0.137843419088,
      rootZ: -0.114350346804,
      crouch: 0.18,
    },
    {
      label: 'square drive',
      directionDeg: 100,
      footwork: 'forward' as const,
      lengthM: 4,
      lineM: 0.18,
      speed: REQUESTED_FRONT,
      contactU: 0.225,
      rootX: -0.141314260595,
      rootZ: -0.110032221429,
      crouch: 0.18,
    },
    {
      label: 'steer',
      directionDeg: 150,
      footwork: 'forward' as const,
      lengthM: 4,
      lineM: 0.18,
      speed: REQUESTED_FRONT,
      contactU: 0.225,
      rootX: -0.169668109314,
      rootZ: -0.057354534973,
      crouch: 0.18,
    },
    {
      label: 'back drive',
      directionDeg: 0,
      footwork: 'back' as const,
      lengthM: 7,
      lineM: 0.05,
      speed: REQUESTED_BACK,
      contactU: 0.225,
      rootX: -0.067444524374,
      rootZ: -0.123139742293,
      crouch: 0.09,
    },
    {
      label: 'back punch',
      directionDeg: 40,
      footwork: 'back' as const,
      lengthM: 7,
      lineM: 0.18,
      speed: REQUESTED_BACK,
      contactU: 0.225,
      rootX: -0.071899706952,
      rootZ: -0.120592670342,
      crouch: 0.09,
    },
  ])('preserves the established $label fallback identity', (expected) => {
    const ball = fly({ variation: 'stock', lengthM: expected.lengthM, lineM: expected.lineM, speedKph: 136 });
    const swing = timedSwing(
      ball,
      0,
      {
        kind: 'attack',
        directionDeg: expected.directionDeg,
        elevation: 0.1,
        power: 0.65,
      },
      expected.footwork,
    );

    const track = buildBatTrack(ball, swing, { assist: 'real' });
    const hit = sweep(ball.samples, track, track.body, 0, ball.samples.at(-1)!.t).hit;

    expect(track.speed).toBeCloseTo(expected.speed, 12);
    expect(track.contactU).toBeCloseTo(expected.contactU, 12);
    expect(track.batterRootOffset.x).toBeCloseTo(expected.rootX, 11);
    expect(track.batterRootOffset.z).toBeCloseTo(expected.rootZ, 11);
    expect(track.batterPosture.crouchM).toBeCloseTo(expected.crouch, 11);
    expect(hit?.part).toBe('blade');
    expect(hit?.blade?.region).toBe('face');
  });
});
