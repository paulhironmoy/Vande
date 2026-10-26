import { describe, expect, it } from 'vitest';
import type { AssistLevel } from '@/contracts/practice';
import { TIMING_BANDS } from '@/physics/constants';
import { strike } from '@/physics/contact';
import { activeBands, classifyTiming, forgive } from '@/physics/timing';
import { bearingDelta } from '@/physics/vec';
import { EDGES, LEGSPIN, OFFSPIN, PACE, fly, play } from './physics-helpers';

const LEVELS: AssistLevel[] = ['learn', 'play', 'real'];

describe('timing bands', () => {
  it('classifies at the band edges for each assist level', () => {
    for (const a of LEVELS) {
      const b = TIMING_BANDS[a];
      for (const s of [-1, 1]) {
        expect(classifyTiming(s * b.perfectMs, b)).toBe('perfect');
        expect(classifyTiming(s * (b.perfectMs + 0.5), b)).toBe('solid');
        expect(classifyTiming(s * b.solidMs, b)).toBe('solid');
        expect(classifyTiming(s * (b.solidMs + 0.5), b)).toBe('mistimed');
        expect(classifyTiming(s * b.edgeMs, b)).toBe('mistimed');
        expect(classifyTiming(s * (b.edgeMs + 0.5), b)).toBe('missed');
      }
    }
  });

  it('has the brief’s bands, and the Assisted tier widens every edge by its tolerance', () => {
    expect(TIMING_BANDS.learn).toEqual({ perfectMs: 55, solidMs: 110, edgeMs: 170 });
    expect(TIMING_BANDS.play).toEqual({ perfectMs: 35, solidMs: 75, edgeMs: 125 });
    expect(TIMING_BANDS.real.perfectMs).toBe(25);
    expect(TIMING_BANDS.real.solidMs).toBe(55);
    expect(activeBands('play', 10)).toEqual({ perfectMs: 45, solidMs: 85, edgeMs: 135 });
    expect(classifyTiming(40, activeBands('play', 10))).toBe('perfect');
  });

  it('forgives Learn and Play onto the Real geometry, and leaves Real alone', () => {
    const real = TIMING_BANDS.real;
    for (const e of [-200, -80, -55, -25, 0, 13, 25, 55, 80, 200]) expect(forgive(e, real)).toBeCloseTo(e, 12);
    for (const a of ['learn', 'play'] as const) {
      const b = TIMING_BANDS[a];
      expect(forgive(b.perfectMs, b)).toBeCloseTo(real.perfectMs, 12);
      expect(forgive(-b.solidMs, b)).toBeCloseTo(-real.solidMs, 12);
      expect(forgive(b.edgeMs, b)).toBeCloseTo(real.edgeMs, 12);
      let prev = -Infinity;
      for (let e = -300; e <= 300; e += 7) {
        const m = forgive(e, b);
        expect(m).toBeGreaterThan(prev);
        prev = m;
      }
    }
  });
});

describe('contact from the physics', () => {
  const f = fly({ lengthM: 6.5, lineM: 0.05, speedKph: 136 });

  it('is deterministic', () => {
    expect(play(f, 17, { directionDeg: 25 })).toEqual(play(f, 17, { directionDeg: 25 }));
  });

  it('the bands emerge from the bat geometry at every level', () => {
    for (const a of LEVELS) {
      const b = TIMING_BANDS[a];
      const kindAt = (e: number) => play(f, e, {}, a);
      for (const e of [0, b.perfectMs - 3, -(b.perfectMs - 3)]) expect(kindAt(e).quality?.sweet).toBe(true);
      for (const e of [b.perfectMs + 4, -(b.perfectMs + 4)]) expect(kindAt(e).quality?.sweet).toBe(false);
      for (const e of [b.solidMs - 3, -(b.solidMs - 3)]) expect(kindAt(e).contact.kind).toBe('middle');
      for (const e of [b.solidMs + 6, -(b.solidMs + 6)]) expect(EDGES.has(kindAt(e).contact.kind)).toBe(true);
      expect(kindAt(-(b.edgeMs + 15)).contact.kind).toBe('miss');
      expect(kindAt(a === 'learn' ? 185 : b.edgeMs + 15).contact.kind).toBe('miss');
    }
  });

  it('late leaves the face open (outside edge, square on the off side); early closes it (inside edge, to leg)', () => {
    const late = play(f, 70, { directionDeg: 0 });
    const early = play(f, -70, { directionDeg: 0 });
    expect(late.contact.kind).toBe('outside_edge');
    expect(early.contact.kind).toBe('inside_edge');
    const lateMid = play(f, 40);
    const earlyMid = play(f, -40);
    expect(lateMid.contact.exitBearingDeg!).toBeGreaterThan(15);
    expect(earlyMid.contact.exitBearingDeg!).toBeLessThan(-15);
    expect(earlyMid.contact.exitElevationDeg!).toBeGreaterThan(lateMid.contact.exitElevationDeg!);
    expect(late.contact.intendedBearingDeg).toBe(0);
  });

  it('early on a leg-side stroke finds the leading edge; late on the pull finds the top edge', () => {
    const flick = play(f, -70, { directionDeg: -55 });
    expect(flick.contact.kind).toBe('leading_edge');
    const short = fly({ variation: 'bouncer', lengthM: 10.5, lineM: 0, speedKph: 136 });
    const pull = play(short, 70, { directionDeg: -70, power: 0.8, elevation: 0.3 });
    expect(pull.contact.kind).toBe('top_edge');
    expect(play(short, 0, { directionDeg: -70, power: 0.8, elevation: 0.3 }).contact.kind).toBe('middle');
  });

  it('a perfect hit leaves in the intended direction, and the exit follows the face when mistimed', () => {
    for (const dir of [-60, -30, 0, 20, 45, 70]) {
      const r = play(f, 0, { directionDeg: dir, power: 0.7 });
      expect(r.contact.kind).toBe('middle');
      expect(Math.abs(bearingDelta(r.contact.exitBearingDeg!, dir))).toBeLessThan(4);
    }
    const shifts = [-30, -15, 15, 30].map((e) => {
      const r = play(f, e, { directionDeg: 20, power: 0.7 });
      return { face: bearingDelta(r.contact.faceBearingDeg!, play(f, 0, { directionDeg: 20, power: 0.7 }).contact.faceBearingDeg!), exit: bearingDelta(r.contact.exitBearingDeg!, 20) };
    });
    for (const s of shifts) expect(Math.sign(s.exit)).toBe(Math.sign(s.face));
    expect(shifts[0].exit).toBeLessThan(shifts[1].exit);
    expect(shifts[3].exit).toBeGreaterThan(shifts[2].exit);
  });

  it('hits harder off the sweet spot of a faster bat, and the sweet spot beats the toe', () => {
    const soft = play(f, 0, { power: 0.2 });
    const hard = play(f, 0, { power: 1 });
    expect(hard.contact.exitSpeedKph!).toBeGreaterThan(soft.contact.exitSpeedKph! + 25);
    expect(hard.contact.batSpeedKph!).toBeGreaterThan(soft.contact.batSpeedKph!);
    const yorker = fly({ variation: 'yorker', lengthM: 1.2, lineM: 0.05, speedKph: 140 });
    const dug = play(yorker, 0, { power: 0.6 });
    if (dug.contact.kind === 'middle') {
      expect(dug.contact.bladeU!).toBeLessThan(0.15);
      expect(dug.contact.exitSpeedKph!).toBeLessThan(hard.contact.exitSpeedKph!);
    }
  });

  it('a perfectly timed defence drops the ball dead in front (pace and spin, lengths, footwork)', () => {
    const cases = [
      { b: PACE, kph: 136, lens: [2.5, 4, 6, 7, 9] },
      { b: OFFSPIN, kph: 84, lens: [2.5, 4, 5.5, 7] },
      { b: LEGSPIN, kph: 84, lens: [2.5, 4, 5.5, 7] },
    ];
    for (const c of cases) {
      for (const L of c.lens) {
        const d = fly({ lengthM: L, lineM: 0.1, speedKph: c.kph }, c.b);
        for (const fw of ['auto', 'forward', 'back'] as const) {
          for (const dir of [-20, 0, 20]) {
            const r = play(d, 0, { kind: 'defend', power: 0.15, elevation: 0, directionDeg: dir }, 'play', fw);
            expect(r.contact.kind).toBe('middle');
            expect(r.exit!.v.z).toBeLessThan(0);
            expect(r.contact.exitSpeedKph!).toBeLessThan(25);
            // A block slower than 10 km/h dies at the batter's feet whatever its direction (spin can squirt it).
            if (r.contact.exitSpeedKph! >= 10) expect(Math.abs(bearingDelta(r.contact.exitBearingDeg!, dir))).toBeLessThanOrEqual(30);
          }
        }
      }
    }
  });

  it('a well-timed attack goes within 10° of the aim against pace and spin', () => {
    for (const [b, kph] of [[PACE, 140], [OFFSPIN, 84], [LEGSPIN, 84]] as const) {
      for (const L of [3, 5, 6.5]) {
        const d = fly({ lengthM: L, lineM: 0.05, speedKph: kph }, b);
        for (const dir of [-45, 0, 45]) {
          const r = play(d, 0, { directionDeg: dir, power: 0.7, elevation: 0.15 }, 'play');
          expect(Math.abs(bearingDelta(r.contact.exitBearingDeg!, dir))).toBeLessThan(10);
        }
      }
    }
  });

  it('a leave reports a leave, or the pad when a straight ball comes into the batter', () => {
    const wide = fly({ lengthM: 6, lineM: 0.45 });
    const left = strike(wide, null, { assist: 'real' });
    expect(left.contact.kind).toBe('leave');
    expect(left.contact.timing).toBe('none');
    expect(left.bat).toHaveLength(0);
    const offbreak = fly({ lengthM: 4, lineM: -0.13, speedKph: 84 }, OFFSPIN, 'turning');
    const padded = strike(offbreak, null, { assist: 'real' });
    expect(padded.contact.kind).toBe('pad');
    expect(padded.impact?.part).toBe('pad');
    expect(padded.impact!.vOut.z).toBeLessThan(padded.impact!.vIn.z);
  });

  it('a swing started after the ball has passed never blocks it with a waiting bat; a malformed swing is a leave', () => {
    const straight = fly({ lengthM: 5, lineM: 0 });
    const tooLate = strike(straight, { kind: 'attack', startT: straight.stumpsT + 0.05, directionDeg: 0, power: 0.5, elevation: 0, footwork: 'auto' }, { assist: 'learn' });
    expect(tooLate.contact.kind).toBe('miss');
    expect(tooLate.contact.timing).toBe('missed');
    expect(tooLate.exit).toBeNull();
    const bad = strike(straight, { kind: 'attack', startT: Number.NaN, directionDeg: 0, power: 0.5, elevation: 0, footwork: 'auto' }, { assist: 'real' });
    expect(bad.contact.kind === 'leave' || bad.contact.kind === 'pad').toBe(true);
    expect(bad.bat).toHaveLength(0);
  });

  it('records the footwork played and the matching ideal contact', () => {
    const full = fly({ lengthM: 3 });
    const short = fly({ lengthM: 8 });
    expect(play(full, 0).footwork).toBe('forward');
    expect(play(short, 0).footwork).toBe('back');
    const r = play(full, 0, {}, 'real', 'back');
    expect(r.footwork).toBe('back');
    expect(r.idealT).toBeGreaterThan(full.idealContactT);
  });
});
