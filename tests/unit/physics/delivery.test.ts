import { describe, expect, it } from 'vitest';
import type { BowlerProfile, PaceVariation, SpinVariation } from '@/contracts/practice';
import {
  FLIGHT_TIME_S,
  PACE_BANDS_KPH,
  PACE_KPH,
  PITCH_HALF,
  SLOW_PACE_MAX_FLIGHT_S,
  SPIN_KPH,
} from '@/physics/constants';
import { flight, flightMovement, sampleAt, stockTurnOf } from '@/physics/delivery';
import { LEGSPIN, OFFSPIN, PACE, fly } from './physics-helpers';

const PACE_VARIATIONS: PaceVariation[] = ['stock', 'outswing', 'inswing', 'seam', 'cutter', 'slower', 'bouncer', 'yorker'];
const SPIN_VARIATIONS: SpinVariation[] = ['stock', 'flighted', 'quicker', 'topspinner', 'arm_ball', 'wrong_un'];
const lengthFor = (v: string) => (v === 'bouncer' ? 10.5 : v === 'yorker' ? 0.9 : 5.5);

describe('delivery flight', () => {
  it('is deterministic: same plan, bowler, conditions and seed give a deep-equal flight', () => {
    const a = fly({ variation: 'outswing', lengthM: 5, lineM: 0.1 }, PACE, 'green', 'det');
    const b = fly({ variation: 'outswing', lengthM: 5, lineM: 0.1 }, PACE, 'green', 'det');
    expect(a).toEqual(b);
    expect(fly({ variation: 'stock' }, OFFSPIN, 'turning', 'x', 'left')).toEqual(fly({ variation: 'stock' }, OFFSPIN, 'turning', 'x', 'left'));
  });

  it('pitches on the planned length and passes the stumps on the planned line (within 1 cm), every variation', () => {
    for (const cond of ['balanced', 'green', 'hard', 'turning'] as const) {
      for (const v of PACE_VARIATIONS) {
        const f = fly({ variation: v, lengthM: lengthFor(v), lineM: 0.07, speedKph: v === 'slower' ? 106 : v === 'cutter' ? 124 : 138 }, PACE, cond, `L-${v}`);
        expect(PITCH_HALF - f.bounce!.p.z).toBeCloseTo(lengthFor(v), 2);
        expect(flightMovement(f).lineAtStumpsM).toBeCloseTo(0.07, 2);
      }
      for (const b of [OFFSPIN, LEGSPIN]) {
        for (const v of SPIN_VARIATIONS) {
          const f = fly({ variation: v, lengthM: 4.2, lineM: -0.03, speedKph: 84 }, b, cond, `S-${v}`);
          expect(PITCH_HALF - f.bounce!.p.z).toBeCloseTo(4.2, 2);
          expect(flightMovement(f).lineAtStumpsM).toBeCloseTo(-0.03, 2);
        }
      }
    }
  });

  it('reports the real simulated release speed', () => {
    for (const kph of [PACE_KPH[0], 120, 136, 152, PACE_KPH[1]]) {
      const f = fly({ speedKph: kph });
      expect(f.release.speedKph).toBeCloseTo(kph, 9);
      const v = f.samples[0].v;
      expect(Math.hypot(v.x, v.y, v.z) * 3.6).toBeCloseTo(kph, 9);
    }
  });

  it('stock pace across the bands arrives in the brief’s 0.42–0.63 s; spin in 0.66–0.97 s', () => {
    for (const band of Object.values(PACE_BANDS_KPH)) {
      for (const kph of band) {
        for (const len of [2.5, 5, 7.5]) {
          const t = fly({ speedKph: kph, lengthM: len }).idealContactT;
          expect(t).toBeGreaterThanOrEqual(FLIGHT_TIME_S.pace[0]);
          expect(t).toBeLessThanOrEqual(FLIGHT_TIME_S.pace[1]);
        }
      }
    }
    for (const kph of SPIN_KPH) {
      for (const len of [2.5, 4.5, 6.5]) {
        for (const b of [OFFSPIN, LEGSPIN]) {
          const t = fly({ speedKph: kph, lengthM: len, variation: 'stock' }, b).idealContactT;
          expect(t).toBeGreaterThanOrEqual(FLIGHT_TIME_S.spin[0]);
          expect(t).toBeLessThanOrEqual(FLIGHT_TIME_S.spin[1]);
        }
      }
    }
  });

  it('slower pace balls (slower ball, cutter, Learn pace) take longer, up to the documented bound', () => {
    for (const v of ['slower', 'cutter', 'stock'] as const) {
      const t = fly({ variation: v, speedKph: PACE_KPH[0], lengthM: 4 }).idealContactT;
      expect(t).toBeGreaterThan(FLIGHT_TIME_S.pace[1]);
      expect(t).toBeLessThanOrEqual(SLOW_PACE_MAX_FLIGHT_S);
    }
  });

  it('swings the right way: outswing leaves the batter, inswing comes in; more on a green pitch', () => {
    const out = flightMovement(fly({ variation: 'outswing', lengthM: 5 }, PACE, 'balanced', 'sw'));
    const inn = flightMovement(fly({ variation: 'inswing', lengthM: 5 }, PACE, 'balanced', 'sw'));
    const outGreen = flightMovement(fly({ variation: 'outswing', lengthM: 5 }, PACE, 'green', 'sw'));
    expect(out.airM).toBeGreaterThan(0.08);
    expect(inn.airM).toBeLessThan(-0.08);
    expect(outGreen.airM).toBeGreaterThan(out.airM * 1.2);
    // A left-handed batter: an outswinger still leaves him (batter-relative variations, mirrored frame).
    expect(flightMovement(fly({ variation: 'outswing', lengthM: 5 }, PACE, 'balanced', 'sw', 'left')).airM).toBeGreaterThan(0.08);
  });

  it('seams more on a green pitch than a balanced one', () => {
    const g = Math.abs(flightMovement(fly({ variation: 'seam', lengthM: 6 }, PACE, 'green', 'seam1')).pitchM!);
    const b = Math.abs(flightMovement(fly({ variation: 'seam', lengthM: 6 }, PACE, 'balanced', 'seam1')).pitchM!);
    expect(g).toBeGreaterThan(b * 1.4);
    expect(b).toBeGreaterThan(0.04);
  });

  it('turns honestly: off-break in, leg-break away, googly in, carrom ball away; mirrored for arm and batter', () => {
    const turn = (b: BowlerProfile, v: SpinVariation, h: 'right' | 'left' = 'right') =>
      flightMovement(fly({ variation: v, lengthM: 4.5, speedKph: 84 }, b, 'turning', 'turn', h)).pitchM!;
    expect(turn(OFFSPIN, 'stock')).toBeLessThan(-0.15); // into the right-hander (towards −x, leg side)
    expect(turn(LEGSPIN, 'stock')).toBeGreaterThan(0.15); // away
    expect(turn(LEGSPIN, 'wrong_un')).toBeLessThan(-0.12); // googly turns the other way
    expect(turn(OFFSPIN, 'wrong_un')).toBeGreaterThan(0.12); // carrom ball
    expect(turn({ ...OFFSPIN, arm: 'left' }, 'stock')).toBeGreaterThan(0.15); // left-arm orthodox: away
    expect(turn({ ...LEGSPIN, arm: 'left' }, 'stock')).toBeLessThan(-0.15); // left-arm wrist: in
    expect(turn(OFFSPIN, 'stock', 'left')).toBeGreaterThan(0.15); // off-spinner to a left-hander: away
    expect(Math.abs(turn(OFFSPIN, 'topspinner'))).toBeLessThan(Math.abs(turn(OFFSPIN, 'stock')) * 0.5);
    expect(Math.abs(turn(OFFSPIN, 'arm_ball'))).toBeLessThan(0.08);
    expect(stockTurnOf(OFFSPIN)).toBe(-1);
    expect(stockTurnOf(LEGSPIN)).toBe(1);
    expect(stockTurnOf(OFFSPIN, 'left')).toBe(1);
  });

  it('turns more on a turning pitch, and the off-spinner drifts away before turning in', () => {
    const m = (c: 'balanced' | 'turning') => flightMovement(fly({ lengthM: 4.5, speedKph: 84 }, OFFSPIN, c, 'tp'));
    expect(Math.abs(m('turning').pitchM!)).toBeGreaterThan(Math.abs(m('balanced').pitchM!) * 1.4);
    expect(m('balanced').airM).toBeGreaterThan(0.05);
  });

  it('bounces realistically: good length near the top of the stumps; bouncers to chest and head height', () => {
    const hAt = (len: number, kph = 140, v: PaceVariation = 'stock') => {
      const f = fly({ variation: v, lengthM: len, speedKph: kph, lineM: 0 });
      return sampleAt(f.samples, f.stumpsT).p.y;
    };
    expect(hAt(6)).toBeGreaterThan(0.55);
    expect(hAt(6)).toBeLessThan(0.8);
    expect(hAt(3)).toBeLessThan(hAt(6));
    for (const kph of [125, 145]) {
      const chest = fly({ variation: 'bouncer', lengthM: 10.5, speedKph: kph, lineM: 0 });
      const head = fly({ variation: 'bouncer', lengthM: 11.5, speedKph: kph, lineM: 0 });
      const yc = sampleAt(chest.samples, chest.idealContactT).p.y;
      const yh = sampleAt(head.samples, head.idealContactT).p.y;
      expect(yc).toBeGreaterThan(1.2);
      expect(yc).toBeLessThan(1.5);
      expect(yh).toBeGreaterThan(1.5);
      expect(yh).toBeLessThan(1.85);
    }
  });

  it('knows whether the ball would hit the stumps', () => {
    expect(fly({ lengthM: 4, lineM: 0 }).wouldHitStumps).toBe(true);
    expect(fly({ lengthM: 4, lineM: 0.3 }).wouldHitStumps).toBe(false);
    expect(fly({ variation: 'bouncer', lengthM: 10.5, lineM: 0 }).wouldHitStumps).toBe(false);
    expect(fly({ variation: 'yorker', lengthM: 0.8, lineM: 0.05 }).wouldHitStumps).toBe(true);
  });

  it('runs from the hand to just past the stumps with dense 1 ms samples and exposes spin', () => {
    const f = flight({ plan: { variation: 'stock', lengthM: 6, lineM: 0, speedKph: 140 }, bowler: PACE, conditions: 'balanced', seed: 'd' });
    expect(f.samples[0].t).toBe(0);
    expect(f.samples[1].t).toBeCloseTo(0.001, 12);
    expect(f.samples.at(-1)!.p.z).toBeGreaterThanOrEqual(PITCH_HALF + 0.29);
    expect(f.stumpsT).toBeGreaterThan(f.idealContactT);
    expect(f.bounce!.t).toBeLessThan(f.idealContactT);
    expect(f.spin.release.x).toBeLessThan(0); // seam-up back-spin for a ball travelling to +z
    expect(f.spin.afterBounce).not.toBeNull();
  });
});
