// @vitest-environment node
/**
 * The reference over (src/practice/game/reference.ts): every shape the brief asks for, measured on the real flight
 * from the batter's end on the balanced pitch (docs/PRACTICE_PHYSICS.md, "Reference over").
 */
import { describe, expect, it } from 'vitest';
import type { BallFlight, Handedness } from '@/contracts/practice';
import {
  BALL_R,
  BODY,
  CONTACT_PLANE_M,
  FLIGHT_TIME_S,
  PITCH_HALF,
  STUMPS_HALF_W,
  batTravelMs,
  flight,
  flightMovement,
  idealTimeFor,
  resolveFootwork,
  sampleAt,
} from '@/physics';
import { batterBody } from '@/physics/bat';
import { strike } from '@/physics/contact';
import { timeAtZ } from '@/physics/delivery';
import {
  BOUNCER_ARRIVAL_M,
  REFERENCE_BALL,
  REFERENCE_BALLS,
  REFERENCE_CONDITIONS,
  REFERENCE_OVER,
  ballSeed,
  bouncerLength,
  buildOver,
  lengthBand,
  overPattern,
  referenceBall,
  validateOver,
  variationKph,
  type ReferenceBallId,
} from '@/practice/game';

const fly = (i: number, handedness: Handedness = 'right'): BallFlight =>
  flight({
    plan: REFERENCE_OVER.balls[i],
    bowler: REFERENCE_OVER.bowler,
    conditions: REFERENCE_CONDITIONS,
    seed: REFERENCE_BALLS[i].seed,
    handedness,
    ball: REFERENCE_OVER.ball,
  });
const FLIGHTS = REFERENCE_OVER.balls.map((_, i) => fly(i));

/** Lateral position of the release line (the ball's direction as it leaves the hand) at z. */
function releaseLineX(f: BallFlight, z: number): number {
  const s0 = f.samples[0];
  return s0.p.x + (s0.v.x / s0.v.z) * (z - s0.p.z);
}
/** Deviation from the release line at time t (m, + = towards the off side). */
function deviation(f: BallFlight, t: number): number {
  const s = sampleAt(f.samples, t);
  return s.p.x - releaseLineX(f, s.p.z);
}
/** Unit travel direction f and lateral direction l = up × f at release (horizontal). */
function frame(f: BallFlight) {
  const v = f.release.v;
  const h = Math.hypot(v.x, v.z);
  return { fx: v.x / h, fz: v.z / h, lx: v.z / h, lz: -v.x / h };
}
const BACK_PLANE_Z = PITCH_HALF - CONTACT_PLANE_M.back;
const FORWARD_PLANE_Z = PITCH_HALF - CONTACT_PLANE_M.forward;

describe('the reference over: fixed, legal and honest', () => {
  it('is one legal over from one right-arm fast bowler, with a new white ball on the balanced pitch', () => {
    expect(validateOver(REFERENCE_OVER)).toEqual({ ok: true, errors: [] });
    expect(REFERENCE_OVER.source).toBe('reference');
    expect(REFERENCE_CONDITIONS).toBe('balanced');
    expect(REFERENCE_OVER.ball).toEqual({ colour: 'white', age: 'new' });
    expect(REFERENCE_BALL).toEqual(REFERENCE_OVER.ball);
    expect(REFERENCE_OVER.bowler).toMatchObject({ family: 'pace', paceBand: 'fast', arm: 'right' });
    expect(REFERENCE_OVER.balls.map((b) => b.variation)).toEqual([
      'outswing',
      'inswing',
      'stock',
      'cutter',
      'bouncer',
      'yorker',
    ]);
  });

  it('is deep-frozen, so nobody can change the benchmark', () => {
    expect(Object.isFrozen(REFERENCE_OVER)).toBe(true);
    expect(Object.isFrozen(REFERENCE_OVER.balls)).toBe(true);
    for (const b of REFERENCE_OVER.balls) expect(Object.isFrozen(b)).toBe(true);
    expect(Object.isFrozen(REFERENCE_OVER.bowler)).toBe(true);
    expect(Object.isFrozen(REFERENCE_OVER.ball)).toBe(true);
    expect(Object.isFrozen(REFERENCE_BALLS)).toBe(true);
    expect(() => {
      (REFERENCE_OVER.balls[0] as { lengthM: number }).lengthM = 9;
    }).toThrow();
  });

  it('names its six balls with ids, closed objectives and the seeds every over derives', () => {
    expect(REFERENCE_BALLS.map((b) => b.id)).toEqual(['ref-1', 'ref-2', 'ref-3', 'ref-4', 'ref-5', 'ref-6']);
    expect(REFERENCE_BALLS.map((b) => b.objective)).toEqual([
      'leave_or_drive_late',
      'play_straight',
      'get_behind_it',
      'soft_hands',
      'sway_or_hook',
      'dig_it_out',
    ]);
    REFERENCE_BALLS.forEach((b, i) => {
      expect(b.index).toBe(i);
      expect(b.variation).toBe(REFERENCE_OVER.balls[i].variation);
      expect(b.seed).toBe(ballSeed(REFERENCE_OVER, i));
    });
    expect(new Set(REFERENCE_BALLS.map((b) => b.seed)).size).toBe(6);
    expect(referenceBall('ref-4').variation).toBe('cutter');
    expect(() => referenceBall('ref-7' as ReferenceBallId)).toThrow();
  });

  it('bowls honest fast-bowler speeds (the cutter about 10% slower) with real flight times', () => {
    const stock = 139.5;
    REFERENCE_OVER.balls.forEach((b, i) => {
      expect(b.speedKph).toBe(variationKph('pace', b.variation, stock));
      expect(FLIGHTS[i].release.speedKph).toBeCloseTo(b.speedKph, 9);
      if (b.variation !== 'cutter') {
        expect(b.speedKph).toBeGreaterThanOrEqual(135);
        expect(b.speedKph).toBeLessThanOrEqual(142);
      }
      // Release to the ideal contact inside the brief's 0.42–0.63 s for pace.
      expect(FLIGHTS[i].idealContactT).toBeGreaterThanOrEqual(FLIGHT_TIME_S.pace[0]);
      expect(FLIGHTS[i].idealContactT).toBeLessThanOrEqual(FLIGHT_TIME_S.pace[1]);
    });
    const cutter = REFERENCE_OVER.balls[3].speedKph / stock;
    expect(cutter).toBeGreaterThan(0.88);
    expect(cutter).toBeLessThan(0.92);
  });

  it('is deterministic: every flight is byte-identical when bowled again', () => {
    REFERENCE_OVER.balls.forEach((_, i) => expect(JSON.stringify(fly(i))).toBe(JSON.stringify(FLIGHTS[i])));
  });
});

describe('the reference over: each ball behaves like the real thing (batter end, balanced pitch)', () => {
  it('ref-1, the full outswinger: pitched up, starting on off stump and leaving the batter late by 15–40 cm', () => {
    const f = FLIGHTS[0];
    const plan = REFERENCE_OVER.balls[0];
    expect(plan.lengthM).toBeGreaterThanOrEqual(2.5);
    expect(plan.lengthM).toBeLessThanOrEqual(3.5);
    expect(f.bounce!.p.z).toBeCloseTo(PITCH_HALF - plan.lengthM, 3);
    // It starts on off stump: the release line reaches the stumps on the off stump (± 4 cm of its outer edge).
    expect(Math.abs(releaseLineX(f, PITCH_HALF) - STUMPS_HALF_W)).toBeLessThan(0.04);
    // Away, by the bat (the forward stride's plane): 15–40 cm off the release line, all of it the physics' swing.
    const dev = deviation(f, f.idealContactT);
    expect(sampleAt(f.samples, f.idealContactT).p.z).toBeCloseTo(FORWARD_PLANE_Z, 2);
    expect(dev).toBeGreaterThan(0.15);
    expect(dev).toBeLessThan(0.4);
    expect(flightMovement(f).airM).toBeGreaterThan(0.15);
    // Late: about three quarters of that movement comes in the second half of the flight.
    expect(1 - deviation(f, f.idealContactT / 2) / dev).toBeGreaterThan(0.65);
    // The seam cue agrees: upright, angled towards slip, the shine on the leg side (it swings to the rough side).
    const { fx, fz, lx, lz } = frame(f);
    expect(f.seam.wobble).toBe(0);
    expect(f.seam.axis.x * fx + f.seam.axis.z * fz).toBeGreaterThan(0.2);
    expect(f.seam.shine.x * lx + f.seam.shine.z * lz).toBeLessThan(-0.9);
    expect(f.wouldHitStumps).toBe(false);
  });

  it('ref-2, the inswinger: starts outside off, swings in and would hit the stumps', () => {
    const f = FLIGHTS[1];
    expect(releaseLineX(f, PITCH_HALF)).toBeGreaterThan(STUMPS_HALF_W + BALL_R + 0.1);
    const m = flightMovement(f);
    expect(m.airM).toBeLessThan(-0.12);
    expect(deviation(f, f.idealContactT)).toBeLessThan(-0.15);
    expect(Math.abs(m.lineAtStumpsM)).toBeLessThan(STUMPS_HALF_W);
    expect(f.wouldHitStumps).toBe(true);
    expect(sampleAt(f.samples, f.stumpsT).p.y).toBeLessThan(0.65);
    const { fx, fz, lx, lz } = frame(f);
    expect(f.seam.wobble).toBe(0);
    expect(f.seam.axis.x * fx + f.seam.axis.z * fz).toBeLessThan(-0.2);
    expect(f.seam.shine.x * lx + f.seam.shine.z * lz).toBeGreaterThan(0.9);
  });

  it('ref-3, the hard length: 7–8 m, climbing to the waist at the back-foot plane and hurrying the batter', () => {
    const f = FLIGHTS[2];
    const plan = REFERENCE_OVER.balls[2];
    expect(plan.lengthM).toBeGreaterThanOrEqual(7);
    expect(plan.lengthM).toBeLessThan(8);
    expect(lengthBand(plan.lengthM, 'pace')).toBe('short');
    // Automatic footwork is back; the ideal contact is the back-foot plane, 1.05 m in front of the stumps.
    const at = sampleAt(f.samples, f.idealContactT);
    expect(at.p.z).toBeCloseTo(BACK_PLANE_Z, 2);
    // 0.93 m: waist high on the batter (torso 0.70–1.42 m). Rib height (≥ 1.0 m) would need ≈ 8.3–8.6 m, past the
    // 8 m the rules allow a ball that is not a bouncer (PACE_OTHER_LENGTH_M), even from this 2.30 m release.
    expect(at.p.y).toBeGreaterThan(0.9);
    expect(at.p.y).toBeLessThan(1.25);
    // Still climbing at the batter, quick off the pitch, and over the stumps if left.
    expect(at.v.y).toBeGreaterThan(2);
    expect(Math.hypot(at.v.x, at.v.y, at.v.z) * 3.6).toBeGreaterThan(105);
    expect(f.idealContactT).toBeLessThan(0.53);
    expect(f.wouldHitStumps).toBe(false);
  });

  it('ref-4, the cutter: slower, gripping and leaving the batter off the pitch with a scrambled seam', () => {
    const f = FLIGHTS[3];
    const m = flightMovement(f);
    // Nearly all of its movement comes off the pitch: the rifle spin grips (a leg-cutter, seeded) and the seam lands away.
    expect(Math.abs(m.airM)).toBeLessThan(0.03);
    expect(m.pitchM!).toBeGreaterThan(0.06);
    expect(f.seam.wobble).toBeGreaterThan(0.5);
    // From middle-and-off to clip off stump.
    expect(f.wouldHitStumps).toBe(true);
  });

  it('ref-5, the bouncer: at head height, legal, and on a line he can sway out of or hook', () => {
    const f = FLIGHTS[4];
    const plan = REFERENCE_OVER.balls[4];
    const h = flightMovement(f).heightAtBatM;
    expect(sampleAt(f.samples, f.idealContactT).p.z).toBeCloseTo(BACK_PLANE_Z, 2);
    expect(h).toBeGreaterThan(BOUNCER_ARRIVAL_M[0]);
    expect(h).toBeLessThan(BOUNCER_ARRIVAL_M[1]);
    expect(Math.abs(h - BODY.headY)).toBeLessThan(0.03);
    // Its length is exactly the physics' solve for a head-height arrival with this bowler, seed and ball.
    expect(
      bouncerLength(
        plan,
        REFERENCE_OVER.bowler,
        REFERENCE_CONDITIONS,
        REFERENCE_BALLS[4].seed,
        BODY.headY,
        REFERENCE_OVER.ball,
      ),
    ).toBe(plan.lengthM);
    // A leave from the stance clears the head (centre −0.20 m, 1.62 m, 1.2 m in front of the stumps) by > 5 cm.
    const head = batterBody(null).head;
    const closest = Math.min(...f.samples.map((s) => Math.hypot(s.p.x - head.c.x, s.p.y - head.c.y, s.p.z - head.c.z)));
    expect(closest - head.r - BALL_R).toBeGreaterThan(0.05);
    expect(f.wouldHitStumps).toBe(false);
  });

  it('ref-6, the yorker: at the toes, onto the base of the stumps', () => {
    const f = FLIGHTS[5];
    expect(lengthBand(REFERENCE_OVER.balls[5].lengthM, 'pace')).toBe('yorker');
    // "At the toes" is measured where the batter stands in his crease (the stance plane, 1.1 m in front of the
    // stumps), not at automatic footwork's contact plane. Before (to PHYS phase 4): automatic footwork dug yorkers
    // out from the back plane, so flightMovement(f).heightAtBatM was the height there (0.063 m). After (lead ruling
    // (a), 2026-11-03): it smothers them on the forward stride, 0.70 m further up the pitch, where this ball is still
    // 0.198 m up on its way down. At the stance plane it is 0.072 m. Threshold unchanged.
    const stanceT = timeAtZ(f.samples, batterBody(null).stance.z);
    expect(stanceT).not.toBeNull();
    expect(sampleAt(f.samples, stanceT!).p.y).toBeLessThan(0.15);
    // Automatic footwork meets it forward, and a straight bat timed to the ideal contact meets it with the bat.
    expect(resolveFootwork(f, 'auto')).toBe('forward');
    const drive = { kind: 'attack', directionDeg: 0, elevation: 0.05, power: 0.55, footwork: 'auto' } as const;
    const met = strike(
      f,
      { ...drive, startT: idealTimeFor(f, 'auto') - batTravelMs('attack', drive.power) / 1000 },
      {
        assist: 'real',
        expect: { bowler: REFERENCE_OVER.bowler, conditions: REFERENCE_CONDITIONS, handedness: 'right' },
      },
    );
    expect(met.track!.footwork).toBe('forward');
    expect(['middle', 'inside_edge', 'outside_edge', 'top_edge', 'leading_edge']).toContain(met.contact.kind);
    expect(f.wouldHitStumps).toBe(true);
    expect(sampleAt(f.samples, f.stumpsT).p.y).toBeLessThan(0.2);
  });

  it('keeps every shape for a left-handed batter (the plan is batter-relative)', () => {
    REFERENCE_OVER.balls.forEach((_, i) => {
      const r = flightMovement(FLIGHTS[i]);
      const l = flightMovement(fly(i, 'left'));
      expect(Math.sign(l.airM)).toBe(Math.sign(r.airM));
      expect(Math.abs(l.airM - r.airM)).toBeLessThan(0.01);
      expect(Math.abs((l.pitchM ?? 0) - (r.pitchM ?? 0))).toBeLessThan(0.01);
      expect(Math.abs(l.heightAtBatM - r.heightAtBatM)).toBeLessThan(0.02);
      expect(Math.abs(l.lineAtStumpsM - r.lineAtStumpsM)).toBeLessThan(0.005);
      expect(fly(i, 'left').wouldHitStumps).toBe(FLIGHTS[i].wouldHitStumps);
    });
  });
});

describe('overPattern: the known pattern of a fixed over', () => {
  it('reads the reference over honestly off its plans', () => {
    expect(overPattern(REFERENCE_OVER)).toEqual({
      family: 'pace',
      arm: 'right',
      mainLine: 'stumps',
      onTheStumps: 5,
      swing: 'both',
      turn: 'none',
      shortBalls: 2,
      bouncers: 1,
      yorkers: 1,
      changeOfPace: 1,
      paceKph: [126.9, 141.5],
    });
  });

  it('makes a spinner’s turn and arm ball batter-relative', () => {
    const bowler = { family: 'spin' as const, spinType: 'finger' as const, arm: 'right' as const, lookSeed: 'pattern' };
    const ball = (variation: 'stock' | 'wrong_un' | 'arm_ball' | 'flighted', speedKph = 85) => ({
      variation,
      lengthM: 4,
      lineM: 0.1,
      speedKph,
    });
    const over = buildOver({
      bowler,
      balls: [
        ball('stock'),
        ball('flighted', 78),
        ball('stock'),
        ball('arm_ball', 90),
        ball('stock'),
        ball('wrong_un'),
      ],
      shuffle: false,
      seed: 'pattern',
    });
    // A right-arm off-spinner to a right-hander: the stock ball turns in, the carrom ball away, the arm ball goes away.
    // Only the flighted ball (−8%) is a change of pace; the arm ball's +5 km/h is 5.9%, under the 6% threshold.
    expect(overPattern(over)).toMatchObject({
      family: 'spin',
      swing: 'away',
      turn: 'both',
      shortBalls: 0,
      bouncers: 0,
      yorkers: 0,
      changeOfPace: 1,
      paceKph: [78, 90],
    });
    // The same over to a left-hander: the arm ball now comes into him.
    expect(overPattern(over, 'left').swing).toBe('in');
    const plain = buildOver({
      bowler,
      balls: [ball('stock'), ball('stock'), ball('stock'), ball('stock'), ball('stock'), ball('stock')],
      shuffle: false,
      seed: 'pattern',
    });
    expect(overPattern(plain)).toMatchObject({ swing: 'none', turn: 'in', changeOfPace: 0 });
    expect(overPattern(plain, 'left').turn).toBe('away');
  });
});
