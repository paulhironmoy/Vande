/**
 * The input layer's part of the locked criteria (ceiling rubric CTL2–CTL5, CTL9; dual rubric EX2) and the Player
 * Experience Director's E-PX-001 acceptance, through the real GestureTracker. The physics' part of CTL2–CTL4 and EX2
 * (launch angle, exit speed, exit bearing) is in system.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { GestureInput, NormalizedSwing } from '@/contracts/practice';
import { GestureTracker, normalizeGesture, referenceLength, type TrackerScheduler } from '@/input';
import { DEPARTURE, KEYBOARD, LOFT_REACH, POWER_CURVE, READ_MAX_MS } from '@/input/constants';
import { DELIVERIES, OPTS, PROFILES, RELEASE, SURFACES, bearingDiff, play, rng, spearman, strokeSamples, tapSamples, type ProfileName, type SurfaceName } from './fixtures';

const PHONE = SURFACES.phone;
const REF = referenceLength(PHONE);
const T0 = RELEASE + 400;
const profiles = Object.keys(PROFILES) as ProfileName[];

/** A keyboard sequence through a fresh tracker on a manual clock. */
function keys(seq: Array<[string, number, boolean?]>, surface = SURFACES.desktop): GestureInput | null {
  let now = 0;
  const timers: Array<{ at: number; fn: () => void }> = [];
  const sched: TrackerScheduler = {
    now: () => now,
    setTimer: (fn, ms) => {
      const t = { at: now + ms, fn };
      timers.push(t);
      return t;
    },
    clearTimer: (id) => {
      const i = timers.indexOf(id as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  let g: GestureInput | null = null;
  const tr = new GestureTracker({ swingStart: () => undefined, gesture: (x) => (g = x) }, sched);
  tr.setSurface(surface.width, surface.height);
  tr.setEnabled(true);
  for (const [code, t, shift] of seq) {
    now = t;
    tr.key(code, t, false, { shift: shift === true });
  }
  now += 1000;
  for (const t of timers.splice(0)) t.fn();
  return g;
}

describe('E-PX-001 acceptance (Player Experience Director)', () => {
  it('an ordinary 60–150 px swipe of 60–150 ms is along the ground', () => {
    let n = 0;
    for (const surface of [SURFACES.phone, SURFACES.common, SURFACES.small])
      for (let len = 60; len <= 150; len += 15)
        for (let ms = 60; ms <= 150; ms += 15)
          for (const profile of profiles)
            for (const bearingDeg of [0, 45, -60, 120]) {
              const s = play(strokeSamples({ lengthPx: len, bearingDeg, durationMs: ms, profile }, T0), { surface }).swing!;
              expect(s.kind).toBe('attack');
              expect(s.elevation, `${len} px / ${ms} ms ${profile}`).toBe(0);
              n++;
            }
    expect(n).toBeGreaterThan(1000);
  });

  it('the loft gesture (a long, quick swipe: 1.6 reference lengths or more within 140 ms) is lofted in ≥ 95% of a jittered corpus', () => {
    const r = rng(0x10f7);
    let lofted = 0;
    const N = 300;
    for (let i = 0; i < N; i++) {
      const name = r.pick<SurfaceName>(['phone', 'phone', 'common', 'small', 'tablet', 'desktop']);
      const surface = SURFACES[name];
      const ref = referenceLength(surface);
      // The documented gesture, played loosely: 1.8 reference lengths ± 12%, 90–140 ms, any profile, a curve, a short rest.
      const st = { lengthPx: ref * 1.8 * (1 + r.gauss() * 0.06), bearingDeg: r.range(-70, 70), durationMs: r.range(90, 140), profile: r.pick(profiles), curveDeg: r.range(-15, 15), restMs: r.chance(0.2) ? r.range(5, 25) : 0, rateMs: r.pick([4, 8, 1000 / 120]), jitterPx: r.range(0.2, 0.8), x0: r.range(0.2, 0.8) * surface.width, y0: r.range(0.6, 0.95) * surface.height };
      const s = play(strokeSamples(st, T0, r), { surface, pointer: name === 'desktop' ? 'mouse' : 'touch', delivery: r.pick(DELIVERIES) }).swing!;
      if (s.kind === 'attack' && s.elevation >= 0.45) lofted++;
    }
    console.info(`E-PX-001 loft corpus: ${lofted}/${N} lofted (elevation ≥ 0.45)`);
    expect(lofted / N).toBeGreaterThanOrEqual(0.95);
  });

  it('a 50–100 ms plant followed by a swipe is a swipe (an attack)', () => {
    for (let restMs = 50; restMs <= 100; restMs += 10)
      for (const [len, ms] of [
        [60, 60],
        [100, 100],
        [150, 120],
      ])
        for (const profile of profiles)
          for (const d of DELIVERIES) {
            const s = play(strokeSamples({ lengthPx: len, bearingDeg: 30, durationMs: ms, restMs, profile }, T0), { delivery: d }).swing!;
            expect(s.kind, `rest ${restMs} ${len}/${ms} ${profile} ${d.name}`).toBe('attack');
            expect(s.directionDeg).toBeCloseTo(30, 0);
          }
  });

  it('power spreads continuously with swipe speed: Spearman ρ ≥ 0.9, and no plateau over 0.9 on ordinary swipes', () => {
    const speeds: number[] = [];
    const powers: number[] = [];
    for (let len = 60; len <= 150; len += 10)
      for (let ms = 60; ms <= 150; ms += 10)
        for (const profile of ['easeOut', 'minJerk'] as const) {
          const s = play(strokeSamples({ lengthPx: len, bearingDeg: 10, durationMs: ms, profile }, T0)).swing!;
          speeds.push(len / ms);
          powers.push(s.power);
        }
    expect(spearman(speeds, powers)).toBeGreaterThanOrEqual(0.9);
    expect(Math.max(...powers)).toBeLessThan(1);
    // High available power is not a plateau. Test the response itself, including
    // strokes the departure-time model now reads above 0.9.
    for (const profile of ['easeOut', 'minJerk'] as const) {
      const a = play(strokeSamples({ lengthPx: 150, bearingDeg: 10, durationMs: 60, profile }, T0)).swing!;
      const b = play(strokeSamples({ lengthPx: 150, bearingDeg: 10, durationMs: 60 / 1.1, profile }, T0)).swing!;
      expect(b.power).toBeGreaterThan(a.power);
      expect(b.power - a.power).toBeLessThan(0.04);
    }
    expect(Math.min(...powers)).toBeLessThan(0.3);
    expect(Math.max(...powers)).toBeGreaterThan(0.8);
    // Spread across the range, not bunched: every 0.1-wide band from 0.3 to 0.8 is used.
    for (let b = 0.3; b < 0.8; b += 0.1) expect(powers.some((p) => p >= b && p < b + 0.1), `band ${b.toFixed(1)}`).toBe(true);
  });

  it('the keyboard attacks: direction from the arrows, Shift to loft', () => {
    const at = (seq: Array<[string, number, boolean?]>) => normalizeGesture(keys(seq)!, { ...OPTS, releasePerfMs: 0 })!;
    expect(at([['ArrowUp', 500]])).toMatchObject({ kind: 'attack', directionDeg: 0, elevation: 0, power: KEYBOARD.power });
    expect(at([['ArrowRight', 500], ['ArrowUp', 510]])).toMatchObject({ kind: 'attack', directionDeg: 45 });
    expect(at([['ArrowLeft', 500, true]])).toMatchObject({ kind: 'attack', directionDeg: -90, elevation: KEYBOARD.loftElevation });
    expect(at([['Space', 500]])).toMatchObject({ kind: 'defend' });
  });
});

describe('CTL2 (input part): defence, grounded attack, lofted attack and leave are distinct swings', () => {
  const kinds = (sw: NormalizedSwing | null) => (sw === null ? 'leave' : sw.kind === 'defend' ? 'defend' : sw.elevation >= 0.45 ? 'lofted' : sw.elevation === 0 ? 'grounded' : 'uppish');
  for (const [name, pointer] of [
    ['touch on a phone', 'touch'],
    ['mouse on a desktop', 'mouse'],
    ['pen on a tablet', 'pen'],
  ] as const) {
    it(name, () => {
      const surface = pointer === 'touch' ? SURFACES.phone : pointer === 'mouse' ? SURFACES.desktop : SURFACES.tablet;
      const ref = referenceLength(surface);
      for (let i = 0; i < 30; i++) {
        const b = -60 + 4 * i;
        expect(kinds(play(tapSamples(T0, 50 + i * 3, { driftPx: 3 }), { surface, pointer }).swing)).toBe('defend');
        expect(kinds(play(strokeSamples({ lengthPx: ref * (0.35 + i * 0.02), bearingDeg: b, durationMs: 70 + i * 2 }, T0), { surface, pointer }).swing)).toBe('grounded');
        expect(kinds(play(strokeSamples({ lengthPx: ref * (1.7 + i * 0.01), bearingDeg: b, durationMs: 100 + i }, T0), { surface, pointer }).swing)).toBe('lofted');
      }
      // No input is no swing: the physics plays a leave.
      expect(kinds(null)).toBe('leave');
    });
  }

  it('keyboard', () => {
    const k = (seq: Array<[string, number, boolean?]>) => normalizeGesture(keys(seq)!, OPTS);
    expect(kinds(k([['Space', 500]]))).toBe('defend');
    expect(kinds(k([['ArrowUp', 500]]))).toBe('grounded');
    expect(kinds(k([['ArrowUp', 500, true]]))).toBe('lofted');
    expect(keys([])).toBeNull();
  });
});

describe('CTL3 (input part): the read direction is the gesture’s direction', () => {
  it('over 8 directions × 60 jittered, curved swipes: median error ≤ 1°, p90 ≤ 3°', () => {
    const r = rng(0xc713);
    const errs: number[] = [];
    for (let dir = 0; dir < 8; dir++)
      for (let i = 0; i < 60; i++) {
        const aim = -180 + dir * 45;
        const st = { lengthPx: r.range(60, 180), bearingDeg: aim, durationMs: r.range(60, 140), profile: r.pick(profiles), curveDeg: r.range(-20, 20), rateMs: r.pick([4, 8, 1000 / 60]), jitterPx: r.range(0.2, 1), x0: 450, y0: 100 };
        const s = play(strokeSamples(st, T0, r), { delivery: r.pick(DELIVERIES) }).swing!;
        errs.push(Math.abs(bearingDiff(s.directionDeg, aim)));
      }
    errs.sort((a, b) => a - b);
    expect(errs[Math.floor(errs.length / 2)]).toBeLessThanOrEqual(1);
    expect(errs[Math.floor(errs.length * 0.9)]).toBeLessThanOrEqual(3);
  });
});

describe('CTL4 (input part): elevation and power follow the gesture continuously', () => {
  it('11 levels of swipe speed give 11 rising powers, and a 10% faster swipe changes power by under 0.04', () => {
    const levels = Array.from({ length: 11 }, (_, i) => 0.3 + i * 0.25); // px per ms
    const powers = levels.map((v) => play(strokeSamples({ lengthPx: v * 100, bearingDeg: 0, durationMs: 100, profile: 'linear' }, T0)).swing!.power);
    expect(spearman(levels, powers)).toBe(1);
    for (let v = 0.5; v <= 2.6; v += 0.1) {
      const a = play(strokeSamples({ lengthPx: v * 80, bearingDeg: 0, durationMs: 80, profile: 'linear' }, T0)).swing!.power;
      const b = play(strokeSamples({ lengthPx: v * 1.1 * 80, bearingDeg: 0, durationMs: 80, profile: 'linear' }, T0)).swing!.power;
      expect(b).toBeGreaterThanOrEqual(a);
      expect(b - a).toBeLessThan(0.04);
    }
  });

  it('11 levels of reach across the loft band give 11 rising elevations, from along the ground to fully lofted', () => {
    const levels = Array.from({ length: 11 }, (_, i) => LOFT_REACH.from + (i * (LOFT_REACH.full - LOFT_REACH.from)) / 10);
    const elev = levels.map((reach) => play(strokeSamples({ lengthPx: reach * REF, bearingDeg: 0, durationMs: 110 }, T0)).swing!.elevation);
    expect(spearman(levels, elev)).toBe(1);
    expect(elev[0]).toBe(0);
    expect(elev[10]).toBe(1);
    for (let i = 1; i < 11; i++) expect(elev[i] - elev[i - 1]).toBeCloseTo(0.1, 2);
  });
});

describe('CTL5 (input part): moving an identical gesture in time moves its swing by exactly that offset', () => {
  it('early, ideal and late gestures give exactly their offsets for every kind and delivery', () => {
    const ideal = RELEASE + 600;
    for (const offset of [-60, -25, 0, 25, 60]) {
      const press = ideal + offset;
      const gestures = [
        tapSamples(press, 60),
        tapSamples(press, 220),
        strokeSamples({ lengthPx: 110, bearingDeg: 20, durationMs: 90 }, press),
        strokeSamples({ lengthPx: 110, bearingDeg: 20, durationMs: 90, restMs: 90 }, press),
        strokeSamples({ lengthPx: 340, bearingDeg: -10, durationMs: 120 }, press),
        strokeSamples({ lengthPx: 60, bearingDeg: 80, durationMs: 50, holdMs: 200 }, press),
      ];
      for (const g of gestures)
        for (const d of DELIVERIES) {
          const p = play(g, { delivery: d });
          const baseline = play(g.map((sample) => ({ ...sample, t: sample.t - offset })), { delivery: d });
          expect(p.swing!.startT - baseline.swing!.startT, `${offset} ms, ${d.name}`).toBeCloseTo(offset / 1000, 6);
          expect({ ...p.swing, startT: 0 }).toEqual({ ...baseline.swing, startT: 0 });
          // The ready cue remains at the press even though swipe timing uses departure.
          expect(p.trace.starts[0].atPerfMs).toBe(press);
        }
    }
  });
});

describe('CTL9: touch, mouse and keyboard each pass on their own, calibrated per modality', () => {
  it('each modality gives the four intents and exact timing, corrected only by its own calibration', () => {
    const calibrations = { touch: 64, mouse: 18, pen: 52, keyboard: 9 };
    const o = { ...OPTS, calibrations };
    const press = RELEASE + 700;
    for (const [pointer, surface] of [
      ['touch', SURFACES.phone],
      ['mouse', SURFACES.desktop],
      ['pen', SURFACES.tablet],
    ] as const) {
      const ref = referenceLength(surface);
      const tap = play(tapSamples(press, 70), { surface, pointer, opts: o }).swing!;
      const ground = play(strokeSamples({ lengthPx: ref * 0.6, bearingDeg: 30, durationMs: 90, profile: 'linear' }, press), { surface, pointer, opts: o }).swing!;
      const loft = play(strokeSamples({ lengthPx: ref * 1.8, bearingDeg: 30, durationMs: 110, profile: 'linear' }, press), { surface, pointer, opts: o }).swing!;
      const want = (700 - calibrations[pointer]) / 1000;
      expect([tap.kind, ground.elevation, loft.elevation >= 0.45]).toEqual(['defend', 0, true]);
      expect(tap.startT, pointer).toBeCloseTo(want, 6);
      expect(ground.startT, pointer).toBeCloseTo(want + DEPARTURE.radiusPx / (ref * 0.6 / 90) / 1000, 4);
      expect(loft.startT, pointer).toBeCloseTo(want + DEPARTURE.radiusPx / (ref * 1.8 / 110) / 1000, 4);
    }
    const key = normalizeGesture(keys([['ArrowUp', press]])!, o)!;
    expect(key.startT).toBeCloseTo((700 - calibrations.keyboard) / 1000, 6);
  });
});

describe('EX2 (input part): the whole range of direction, elevation and power is reachable', () => {
  it('every bearing round the full circle, behind square included', () => {
    for (let b = -179; b <= 180; b += 1) {
      const s = play(strokeSamples({ lengthPx: 90, bearingDeg: b, durationMs: 80, x0: 450, y0: 95 }, T0)).swing!;
      expect(Math.abs(bearingDiff(s.directionDeg, b))).toBeLessThanOrEqual(0.1);
    }
  });

  it('elevation from 0 to 1 and power from the floor to 1', () => {
    const ground = play(strokeSamples({ lengthPx: 60, bearingDeg: 0, durationMs: 140, profile: 'linear' }, T0)).swing!;
    const soft = play(strokeSamples({ lengthPx: 20, bearingDeg: 0, durationMs: 140, profile: 'linear' }, T0)).swing!;
    const full = play(strokeSamples({ lengthPx: REF * 1.9, bearingDeg: 0, durationMs: 95 }, T0)).swing!;
    const hard = play(strokeSamples({ lengthPx: REF * 1.0, bearingDeg: 0, durationMs: 50 }, T0)).swing!;
    expect(ground.elevation).toBe(0);
    expect(full.elevation).toBe(1);
    expect(soft.power).toBe(POWER_CURVE.min);
    expect(hard.power).toBe(1);
    expect(hard.elevation).toBe(0);
    // The read never lasts longer than READ_MAX_MS after the press.
    expect(READ_MAX_MS).toBeLessThanOrEqual(150);
  });
});
