import { describe, expect, it } from 'vitest';
import type { GestureInput, GestureSample } from '@/contracts/practice';
import { canPlay, elevationOf, minPowerForElevation, moveThreshold, normalizeGesture, powerOf, readGesture, referenceLength, speedForPower } from '@/input';
import { DEPARTURE, DEFEND_POWER, KEYBOARD, LOFT_REACH, MIN_READ_MS, MOVE_THRESHOLD, POWER_CURVE, READ_MAX_MS, REFERENCE_PX, STILL, TAP_HOLD_MS } from '@/input/constants';
import { OPTS, RELEASE, SURFACES, strokeSamples, tapSamples } from './fixtures';

const PHONE = SURFACES.phone;
const REF = referenceLength(PHONE);
const input = (samples: GestureSample[], surface: { width: number; height: number } = PHONE, pointer: GestureInput['pointer'] = 'touch'): GestureInput => ({ pointer, samples, surface });
/** A straight, lifted swipe from a press at `t0`: `lengthPx` along `bearingDeg` in `ms` (ease-out unless given). */
const swipe = (t0: number, bearingDeg: number, lengthPx: number, ms: number, extra: Partial<Parameters<typeof strokeSamples>[0]> = {}) => strokeSamples({ lengthPx, bearingDeg, durationMs: ms, ...extra }, t0);

describe('direction: the swipe’s own bearing (batter frame, + = off side)', () => {
  it('maps screen directions to bearings for a right-hander, all the way round', () => {
    for (let screen = -175; screen <= 180; screen += 5) {
      const s = normalizeGesture(input(swipe(RELEASE + 300, screen, 90, 90)), OPTS)!;
      expect(s.kind).toBe('attack');
      expect(Math.abs(((s.directionDeg - screen + 540) % 360) - 180)).toBeLessThanOrEqual(0.06);
    }
  });

  it('mirrors left-handers: the screen right is their leg side', () => {
    const lh = { ...OPTS, handedness: 'left' as const };
    expect(normalizeGesture(input(swipe(RELEASE + 300, 90, 90, 90)), lh)!.directionDeg).toBeCloseTo(-90, 1);
    expect(normalizeGesture(input(swipe(RELEASE + 300, -60, 90, 90)), lh)!.directionDeg).toBeCloseTo(60, 1);
    const straight = normalizeGesture(input(swipe(RELEASE + 300, 0, 90, 90)), lh)!;
    expect(Object.is(straight.directionDeg, -0)).toBe(false);
    expect(straight.directionDeg).toBe(0);
    expect(normalizeGesture(input(swipe(RELEASE + 300, 180, 90, 90)), lh)!.directionDeg).toBe(180);
  });

  it('reads the line from the press to where the stroke ends, so a thumb’s arc keeps its overall direction', () => {
    for (const curveDeg of [-30, -15, 15, 30]) {
      const s = normalizeGesture(input(strokeSamples({ lengthPx: 110, bearingDeg: 40, durationMs: 100, curveDeg }, RELEASE + 300)), OPTS)!;
      expect(s.directionDeg).toBeCloseTo(40, 0);
    }
  });
});

describe('tap or swipe', () => {
  it('a press without movement is the defensive straight bat', () => {
    const s = normalizeGesture(input(tapSamples(RELEASE + 400, 60)), OPTS)!;
    expect(s).toEqual({ kind: 'defend', startT: 0.4, directionDeg: 0, power: DEFEND_POWER, elevation: 0, footwork: 'auto' });
  });

  it('jitter and drift inside the threshold stay a tap; movement beyond it is a swipe', () => {
    const thr = moveThreshold(PHONE);
    const jitter: GestureSample[] = [
      { t: RELEASE + 400, x: 300, y: 100 },
      { t: RELEASE + 410, x: 300 + thr * 0.6, y: 100 - thr * 0.5 },
      { t: RELEASE + 430, x: 300 - thr * 0.4, y: 100 },
      { t: RELEASE + 480, x: 300 + thr * 0.7, y: 100 + thr * 0.6 },
    ];
    expect(normalizeGesture(input(jitter), OPTS)!.kind).toBe('defend');
    const moved = [...jitter, { t: RELEASE + 490, x: 300, y: 100 - thr * 1.5 }];
    expect(normalizeGesture(input(moved), OPTS)!.kind).toBe('attack');
  });

  it('the threshold is a share of the reference length, clamped', () => {
    expect(REF).toBeCloseTo(412 * 0.46, 6);
    expect(moveThreshold(PHONE)).toBeCloseTo(MOVE_THRESHOLD.frac * 412 * 0.46, 6);
    expect(referenceLength({ width: 640, height: 100 })).toBe(REFERENCE_PX.min);
    expect(referenceLength({ width: 1920, height: 497 })).toBe(REFERENCE_PX.max);
    expect(moveThreshold({ width: 300, height: 50 })).toBe(Math.max(MOVE_THRESHOLD.minPx, MOVE_THRESHOLD.frac * REFERENCE_PX.min));
    expect(moveThreshold({ width: 4000, height: 3000 })).toBe(Math.min(MOVE_THRESHOLD.maxPx, MOVE_THRESHOLD.frac * REFERENCE_PX.max));
  });

  it('a finger that rests and then swipes is an attack (any rest inside TAP_HOLD_MS)', () => {
    for (const restMs of [20, 50, 70, 100, 120]) {
      const s = normalizeGesture(input(swipe(RELEASE + 300, 20, 100, 100, { restMs })), OPTS)!;
      expect(s.kind, `rest ${restMs} ms`).toBe('attack');
      expect(s.directionDeg).toBeCloseTo(20, 0);
    }
  });

  it('waiting past TAP_HOLD_MS does not consume the later swipe', () => {
    const s = normalizeGesture(input(swipe(RELEASE + 300, 0, 100, 100, { restMs: TAP_HOLD_MS + 10 })), OPTS)!;
    expect(s.kind).toBe('attack');
    expect(s.startT).toBeGreaterThan(0.3 + TAP_HOLD_MS / 1000);
    // Crossing the hold boundary cannot change a later movement into a defence.
    const thr = moveThreshold(PHONE);
    const late: GestureSample[] = [
      { t: RELEASE + 300, x: 300, y: 100 },
      { t: RELEASE + 300 + TAP_HOLD_MS - 10, x: 300, y: 100 },
      { t: RELEASE + 300 + TAP_HOLD_MS + 10, x: 300, y: 100 - thr * 1.8 },
    ];
    expect(normalizeGesture(input(late), OPTS)!.kind).toBe('attack');
    late[2] = { ...late[2], y: 100 - thr * 2.2 };
    expect(normalizeGesture(input(late), OPTS)!.kind).toBe('attack');
  });
});

describe('timing: the tap’s press or swipe’s departure, never the handler clock', () => {
  it('uses an analytically known departure time for a linear swipe, with or without a rest', () => {
    const down = RELEASE + 512.3;
    const o = { ...OPTS, calibrationMs: 62 };
    const expected = (512.3 - 62) / 1000;
    expect(normalizeGesture(input(tapSamples(down, 90)), o)!.startT).toBeCloseTo(expected, 4);
    for (const restMs of [0, 80, 300]) {
      // 1.5 px/ms crosses the 2.5 px departure circle after exactly 5/3 ms.
      const s = normalizeGesture(input(swipe(down, 30, 120, 80, { restMs, profile: 'linear' })), o)!;
      expect(s.startT).toBeCloseTo(expected + (restMs + DEPARTURE.radiusPx / 1.5) / 1000, 4);
    }
  });

  it('is independent of when the gesture is normalized (no clock is read)', () => {
    const samples = swipe(RELEASE + 450, -20, 120, 110);
    expect(normalizeGesture(input(samples), OPTS)).toEqual(normalizeGesture(input(samples.map((x) => ({ ...x }))), OPTS));
  });

  it('uses the calibration of the gesture’s own modality when one is given', () => {
    const down = RELEASE + 400;
    const calibrations = { touch: 70, mouse: 15, keyboard: 5 };
    const o = { ...OPTS, calibrationMs: 40, calibrations };
    expect(normalizeGesture(input(tapSamples(down, 60)), o)!.startT).toBeCloseTo(0.33, 6);
    expect(normalizeGesture(input(tapSamples(down, 60), SURFACES.desktop, 'mouse'), o)!.startT).toBeCloseTo(0.385, 6);
    expect(normalizeGesture({ pointer: 'keyboard', samples: [{ t: down, x: 0, y: 0 }], surface: PHONE }, o)!.startT).toBeCloseTo(0.395, 6);
    // No offset of its own: the general one.
    expect(normalizeGesture(input(tapSamples(down, 60), PHONE, 'pen'), o)!.startT).toBeCloseTo(0.36, 6);
  });

  it('applies the time scale hook to the simulation clock', () => {
    const s = normalizeGesture(input([{ t: RELEASE + 600, x: 1, y: 1 }]), { ...OPTS, timeScale: 0.5 })!;
    expect(s.startT).toBeCloseTo(0.3, 6);
  });
});

describe('power: the stroke’s speed, continuous and log-linear', () => {
  it('the documented curve', () => {
    expect(powerOf(POWER_CURVE.lowSpeed)).toBeCloseTo(POWER_CURVE.lowPower, 9);
    expect(powerOf(POWER_CURVE.fullSpeed)).toBe(1);
    expect(powerOf(1000)).toBe(1);
    expect(powerOf(0)).toBe(POWER_CURVE.min);
    expect(powerOf(0.5)).toBe(POWER_CURVE.min);
    for (const p of [0.2, 0.35, 0.5, 0.75, 0.9, 1]) expect(powerOf(speedForPower(p))).toBeCloseTo(p, 9);
    // Equal ratios of speed are equal steps of power: 10% faster is always the same small step.
    const step = (1 - POWER_CURVE.lowPower) * (Math.log(1.1) / Math.log(POWER_CURVE.fullSpeed / POWER_CURVE.lowSpeed));
    for (const v of [2.5, 4, 7, 11, 16]) expect(powerOf(v * 1.1) - powerOf(v)).toBeCloseTo(step, 9);
    expect(step).toBeLessThan(0.04);
  });

  it('is the reach over the time from movement departure, in reference lengths per second', () => {
    const r = readGesture(input(swipe(RELEASE + 300, 0, 120, 100, { profile: 'linear' })))!;
    const readMs = 100 - DEPARTURE.radiusPx / 1.2;
    expect(r.readMs).toBeCloseTo(readMs, 6);
    expect(r.reach).toBeCloseTo(120 / REF, 6);
    expect(r.speed).toBeCloseTo(((120 / REF) / readMs) * 1000, 6);
    expect(normalizeGesture(input(swipe(RELEASE + 300, 0, 120, 100, { profile: 'linear' })), OPTS)!.power).toBeCloseTo(powerOf(r.speed), 3);
  });

  it('reference-scaled motion differs only by the analytically bounded fixed departure radius', () => {
    const k = referenceLength(SURFACES.desktop) / REF;
    const phone = normalizeGesture(input(swipe(RELEASE + 300, 10, 100, 90, { profile: 'linear' })), OPTS)!;
    const desk = normalizeGesture(input(swipe(RELEASE + 300, 10, 100 * k, 90, { profile: 'linear' }), SURFACES.desktop, 'mouse'), OPTS)!;
    const expected = (lengthPx: number, ref: number) => powerOf((lengthPx / ref) / ((90 - DEPARTURE.radiusPx / (lengthPx / 90)) / 1000));
    expect(phone.power).toBeCloseTo(expected(100, REF), 3);
    expect(desk.power).toBeCloseTo(expected(100 * k, REF * k), 3);
    expect(Math.abs(desk.power - phone.power)).toBeLessThan(0.01);
    expect(desk.elevation).toBe(phone.elevation);
  });

  it('a quick flick lifted at once is timed over at least MIN_READ_MS', () => {
    const r = readGesture(input(swipe(RELEASE + 300, 0, 40, 8)))!;
    expect(r.readMs).toBe(MIN_READ_MS);
  });
});

describe('elevation: along the ground, unless the swipe is long', () => {
  it('the documented curve: zero up to LOFT_REACH.from, then linear to 1', () => {
    expect(elevationOf(0)).toBe(0);
    expect(elevationOf(LOFT_REACH.from)).toBe(0);
    expect(elevationOf((LOFT_REACH.from + LOFT_REACH.full) / 2)).toBeCloseTo(0.5, 9);
    expect(elevationOf(LOFT_REACH.full)).toBe(1);
    expect(elevationOf(5)).toBe(1);
  });

  it('ordinary phone swipes, up to 200 px, stay along the ground', () => {
    for (const [len, ms] of [[30, 80], [60, 60], [80, 90], [120, 120], [150, 60], [150, 150], [200, 120]]) {
      const s = normalizeGesture(input(swipe(RELEASE + 300, 25, len, ms)), OPTS)!;
      expect(s.kind).toBe('attack');
      expect(s.elevation, `${len} px over ${ms} ms`).toBe(0);
    }
  });

  it('a long, quick swipe is lofted, and longer is higher', () => {
    const e = (len: number) => normalizeGesture(input(swipe(RELEASE + 300, 0, len, 120)), OPTS)!.elevation;
    expect(e(LOFT_REACH.full * REF * 1.05)).toBe(1);
    expect(e(1.35 * REF)).toBeCloseTo(0.5, 2);
    expect(e(1.25 * REF)).toBeLessThan(e(1.35 * REF));
    expect(e(1.35 * REF)).toBeLessThan(e(1.45 * REF));
  });

  it('a long but slow swipe is read when the read closes, so it stays low: the loft is a quick stroke', () => {
    const r = readGesture(input(swipe(RELEASE + 300, 0, 2 * REF, 400, { profile: 'linear' })))!;
    expect(r.closedBy).toBe('cap');
    expect(r.travelling).toBe(true);
    expect(r.endMs! - r.startMs).toBeCloseTo(READ_MAX_MS, 6);
    expect(normalizeGesture(input(swipe(RELEASE + 300, 0, 2 * REF, 400, { profile: 'linear' })), OPTS)!.elevation).toBe(0);
  });
});

describe('where the read ends', () => {
  it('at the lift: the exact lift sample', () => {
    const s = swipe(RELEASE + 300, 0, 90, 70);
    const r = readGesture(input(s))!;
    expect(r.closedBy).toBe('end');
    expect(r.endMs).toBe(s[s.length - 1].t);
  });

  it('when the finger stops and stays: the moment it arrived, so holding reads like lifting', () => {
    const held = readGesture(input(swipe(RELEASE + 300, 0, 60, 50, { holdMs: 100, profile: 'linear' })))!;
    const lifted = readGesture(input(swipe(RELEASE + 300, 0, 60, 50, { profile: 'linear' })))!;
    expect(held.closedBy).toBe('stop');
    expect(held.reach).toBeCloseTo(lifted.reach, 6);
    expect(Math.abs(held.readMs - lifted.readMs)).toBeLessThanOrEqual(3);
    expect(Math.abs(powerOf(held.speed) - powerOf(lifted.speed))).toBeLessThan(0.02);
  });

  it('a brief pause before the lift is part of the stroke; a still finger is not', () => {
    const r = readGesture(input(swipe(RELEASE + 300, 0, 60, 50, { holdMs: STILL.ms - 10, profile: 'linear' })))!;
    expect(r.closedBy).toBe('end');
  });

  it('a stroke that comes back is read at its farthest point', () => {
    const out = swipe(RELEASE + 300, 30, 80, 60, { profile: 'linear' });
    const tip = out[out.length - 1];
    const back: GestureSample[] = [...out];
    for (let t = 4; t <= 40; t += 4) back.push({ t: tip.t + t, x: tip.x - (tip.x - out[0].x) * (t / 40) * 0.8, y: tip.y - (tip.y - out[0].y) * (t / 40) * 0.8 });
    const r = readGesture(input(back))!;
    expect(r.closedBy).toBe('turn');
    expect(r.screenBearingDeg).toBeCloseTo(30, 0);
    expect(r.reach).toBeCloseTo(80 / REF, 2);
  });
});

describe('keyboard', () => {
  it('a key with no stroke is the defence, exactly a tap at the same moment', () => {
    const t = RELEASE + 488.8;
    const key = normalizeGesture({ pointer: 'keyboard', samples: [{ t, x: 0, y: 0 }], surface: PHONE }, { ...OPTS, calibrationMs: 40 })!;
    const tap = normalizeGesture(input([{ t, x: 200, y: 90 }]), { ...OPTS, calibrationMs: 40 })!;
    expect(key).toEqual(tap);
  });

  it('keyboard samples alone never make a swipe', () => {
    expect(normalizeGesture({ pointer: 'keyboard', samples: swipe(RELEASE + 300, 45, 300, 60), surface: PHONE }, OPTS)!.kind).toBe('defend');
  });

  it('a key attack: its direction (mirrored for a left-hander), and fixed power and elevation; Shift lofts', () => {
    const at = (screenBearingDeg: number, loft: boolean) => ({ pointer: 'keyboard' as const, samples: [{ t: RELEASE + 500, x: 0, y: 0 }], surface: PHONE, key: { kind: 'attack' as const, screenBearingDeg, loft } });
    expect(normalizeGesture(at(45, false), OPTS)).toEqual({ kind: 'attack', startT: 0.5, directionDeg: 45, power: KEYBOARD.power, elevation: 0, footwork: 'auto' });
    expect(normalizeGesture(at(-90, true), OPTS)).toEqual({ kind: 'attack', startT: 0.5, directionDeg: -90, power: KEYBOARD.loftPower, elevation: KEYBOARD.loftElevation, footwork: 'auto' });
    expect(normalizeGesture(at(-90, false), { ...OPTS, handedness: 'left' })!.directionDeg).toBe(90);
    expect(normalizeGesture({ ...at(0, false), footwork: 'back' }, OPTS)!.footwork).toBe('back');
  });
});

describe('what a player can play (for the coach’s demonstrations)', () => {
  it('along the ground any power; a lofted swipe needs the speed its reach takes', () => {
    expect(canPlay({ kind: 'attack', power: 0.3, elevation: 0 })).toBe(true);
    expect(canPlay({ kind: 'attack', power: 1, elevation: 1 })).toBe(true);
    expect(minPowerForElevation(0)).toBe(POWER_CURVE.min);
    expect(minPowerForElevation(1)).toBeCloseTo(powerOf((LOFT_REACH.full / READ_MAX_MS) * 1000), 9);
    expect(canPlay({ kind: 'attack', power: 0.6, elevation: 0.55 })).toBe(false);
    expect(canPlay({ kind: 'attack', power: minPowerForElevation(0.55), elevation: 0.55 })).toBe(true);
    expect(canPlay({ kind: 'attack', power: KEYBOARD.loftPower, elevation: KEYBOARD.loftElevation }, 'keyboard')).toBe(true);
    expect(canPlay({ kind: 'attack', power: 0.9, elevation: 0 }, 'keyboard')).toBe(false);
    expect(canPlay({ kind: 'defend', power: DEFEND_POWER, elevation: 0 }, 'keyboard')).toBe(true);
  });
});

describe('unusable input', () => {
  it('returns null rather than guessing', () => {
    expect(normalizeGesture(input([]), OPTS)).toBeNull();
    expect(normalizeGesture(input([{ t: 2, x: 0, y: 0 }, { t: 1, x: 50, y: 0 }]), OPTS)).toBeNull();
    expect(normalizeGesture(input([{ t: Number.NaN, x: 0, y: 0 }]), OPTS)).toBeNull();
    expect(normalizeGesture(input([{ t: 1, x: 0, y: 0 }], { width: 0, height: 10 }), OPTS)).toBeNull();
    expect(normalizeGesture(input([{ t: 1, x: 0, y: 0 }]), { ...OPTS, releasePerfMs: Number.NaN })).toBeNull();
    expect(normalizeGesture(input([{ t: 1, x: 0, y: 0 }]), { ...OPTS, calibrationMs: Number.NaN })).toBeNull();
  });
});
