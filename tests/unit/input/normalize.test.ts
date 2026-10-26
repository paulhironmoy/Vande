import { describe, expect, it } from 'vitest';
import type { GestureInput, GestureSample } from '@/contracts/practice';
import { calibrationFromTaps, calibrationError, elevationOf, moveThreshold, normalizeGesture, powerOf, readGesture } from '@/input';
import { ATTACK_MIN_POWER, CALIBRATION, DEFEND_POWER, ELEVATION, READ_WINDOW_MS, TAP_DECIDE_MS } from '@/input/constants';

const PHONE = { width: 844, height: 180 };
const DESKTOP = { width: 1366, height: 330 };
const RELEASE = 10_000;

/** A straight flick from (x0, y0): `speed` px/ms along `bearingDeg` (0 = up the screen, + = right) for `ms`, sampled every 4 ms. */
function flick(t0: number, bearingDeg: number, speed: number, ms: number, opts: { x0?: number; y0?: number; step?: number; restMs?: number } = {}): GestureSample[] {
  const step = opts.step ?? 4;
  const a = (bearingDeg * Math.PI) / 180;
  const x0 = opts.x0 ?? 400;
  const y0 = opts.y0 ?? 120;
  const out: GestureSample[] = [{ t: t0, x: x0, y: y0 }];
  const rest = opts.restMs ?? 0;
  for (let t = step; t <= rest; t += step) out.push({ t: t0 + t, x: x0, y: y0 });
  for (let t = step; t <= ms; t += step) out.push({ t: t0 + rest + t, x: x0 + Math.sin(a) * speed * t, y: y0 - Math.cos(a) * speed * t });
  return out;
}
const input = (samples: GestureSample[], surface = PHONE, pointer: GestureInput['pointer'] = 'touch'): GestureInput => ({ pointer, samples, surface });
const opts = { releasePerfMs: RELEASE, calibrationMs: 0, handedness: 'right' as const };

describe('direction mapping (batter frame, + = off side)', () => {
  it('maps screen directions to bearings for a right-hander', () => {
    const cases: Array<[number, number]> = [
      [0, 0],
      [45, 45],
      [90, 90],
      [135, 135],
      [-45, -45],
      [-90, -90],
      [-135, -135],
      [180, 180],
    ];
    for (const [screen, bearing] of cases) {
      const s = normalizeGesture(input(flick(RELEASE + 300, screen, 1.2, 60)), opts)!;
      expect(s.kind).toBe('attack');
      expect(s.directionDeg).toBeCloseTo(bearing, 0);
    }
  });

  it('mirrors left-handers: the screen right is their leg side', () => {
    const lh = { ...opts, handedness: 'left' as const };
    expect(normalizeGesture(input(flick(RELEASE + 300, 90, 1.2, 60)), lh)!.directionDeg).toBeCloseTo(-90, 0);
    expect(normalizeGesture(input(flick(RELEASE + 300, -60, 1.2, 60)), lh)!.directionDeg).toBeCloseTo(60, 0);
    const straight = normalizeGesture(input(flick(RELEASE + 300, 0, 1.2, 60)), lh)!;
    expect(Object.is(straight.directionDeg, -0)).toBe(false);
    expect(straight.directionDeg).toBe(0);
  });

  it('reads direction from the first READ_WINDOW_MS of movement, not where the finger ends up', () => {
    // Up for 60 ms, then a hard turn to the right: the window only sees the first part.
    const s = flick(RELEASE + 300, 0, 1.2, 60);
    const end = s[s.length - 1];
    for (let t = 4; t <= 80; t += 4) s.push({ t: end.t + t, x: end.x + 2 * t, y: end.y });
    expect(normalizeGesture(input(s), opts)!.directionDeg).toBeCloseTo(0, 0);
  });
});

describe('tap versus flick', () => {
  it('a press without movement is the defensive straight bat', () => {
    const s = normalizeGesture(input([{ t: RELEASE + 400, x: 300, y: 100 }, { t: RELEASE + 450, x: 300, y: 100 }]), opts)!;
    expect(s).toEqual({ kind: 'defend', startT: 0.4, directionDeg: 0, power: DEFEND_POWER, elevation: 0, footwork: 'auto' });
  });

  it('jitter inside the threshold is still a tap; movement beyond it is a flick', () => {
    const thr = moveThreshold(PHONE);
    const jitter = [
      { t: RELEASE + 400, x: 300, y: 100 },
      { t: RELEASE + 410, x: 300 + thr * 0.6, y: 100 - thr * 0.5 },
      { t: RELEASE + 430, x: 300 - thr * 0.4, y: 100 },
    ];
    expect(normalizeGesture(input(jitter), opts)!.kind).toBe('defend');
    const moved = [...jitter, { t: RELEASE + 440, x: 300, y: 100 - thr * 1.5 }];
    expect(normalizeGesture(input(moved), opts)!.kind).toBe('attack');
  });

  it('the threshold scales with the surface and is clamped', () => {
    expect(moveThreshold({ width: 2000, height: 1000 })).toBe(18);
    expect(moveThreshold({ width: 100, height: 80 })).toBe(7);
    expect(moveThreshold(PHONE)).toBeCloseTo(7.2, 5);
  });
});

describe('timing comes from the samples’ own timestamps', () => {
  it('swing start is the pointer-down minus calibration, on the simulation clock', () => {
    const down = RELEASE + 512.3;
    const s = normalizeGesture(input(flick(down, 30, 1, 60)), { ...opts, calibrationMs: 62 })!;
    expect(s.startT).toBeCloseTo((512.3 - 62) / 1000, 4);
    const tap = normalizeGesture(input([{ t: down, x: 10, y: 10 }]), { ...opts, calibrationMs: 62 })!;
    expect(tap.startT).toBeCloseTo(s.startT, 6);
  });

  it('is independent of when the gesture is normalized (no clock is read)', () => {
    const samples = flick(RELEASE + 450, -20, 0.9, 52);
    const a = normalizeGesture(input(samples), opts);
    const b = normalizeGesture(input(samples.map((x) => ({ ...x }))), opts);
    expect(a).toEqual(b);
  });

  it('a resting finger starts its swing at its first intentional movement', () => {
    const down = RELEASE - 800; // already on the glass before the ball was bowled
    const s = flick(down, 10, 1.1, 60, { restMs: 1100 });
    const read = readGesture(input(s))!;
    expect(read.kind).toBe('flick');
    expect(read.startMs).toBeCloseTo(down + 1100, 0);
    expect(normalizeGesture(input(s), opts)!.startT).toBeCloseTo(0.3, 2);
  });

  it('an armed press that hesitates briefly still starts at the pointer-down', () => {
    const down = RELEASE + 380;
    const s = flick(down, 10, 1.1, 60, { restMs: TAP_DECIDE_MS - 20 });
    expect(normalizeGesture(input(s), opts)!.startT).toBeCloseTo(0.38, 4);
  });

  it('applies the time scale hook to the simulation clock', () => {
    const s = normalizeGesture(input([{ t: RELEASE + 600, x: 1, y: 1 }]), { ...opts, timeScale: 0.5 })!;
    expect(s.startT).toBeCloseTo(0.3, 6);
  });
});

describe('power and elevation', () => {
  it('power grows with flick speed, normalized by the surface size', () => {
    const slow = normalizeGesture(input(flick(RELEASE + 300, 0, 0.4, 60)), opts)!.power;
    const fast = normalizeGesture(input(flick(RELEASE + 300, 0, 1.4, 60)), opts)!.power;
    expect(fast).toBeGreaterThan(slow);
    expect(slow).toBeGreaterThanOrEqual(ATTACK_MIN_POWER);
    expect(normalizeGesture(input(flick(RELEASE + 300, 0, 9, 60)), opts)!.power).toBe(1);
    // The same flick in surface lengths gives the same power on a phone and a desktop.
    const k = Math.min(DESKTOP.width, DESKTOP.height) / Math.min(PHONE.width, PHONE.height);
    const phone = normalizeGesture(input(flick(RELEASE + 300, 0, 0.8, 60)), opts)!.power;
    const desk = normalizeGesture(input(flick(RELEASE + 300, 0, 0.8 * k, 60), DESKTOP, 'mouse'), opts)!.power;
    expect(desk).toBeCloseTo(phone, 2);
  });

  it('a short flick stays along the ground and a long one is lofted', () => {
    const short = normalizeGesture(input(flick(RELEASE + 300, 0, 1.2, READ_WINDOW_MS - 15)), opts)!;
    const long = normalizeGesture(input(flick(RELEASE + 300, 0, 1.2, READ_WINDOW_MS + 30)), opts)!;
    expect(short.elevation).toBeLessThanOrEqual(ELEVATION.groundMax);
    expect(long.elevation).toBeGreaterThanOrEqual(ELEVATION.loftFrom);
    const longer = normalizeGesture(input(flick(RELEASE + 300, 0, 2, READ_WINDOW_MS + 30)), opts)!;
    expect(longer.elevation).toBeGreaterThanOrEqual(long.elevation);
  });

  it('a flick that stops inside the window is short even if the finger stays down', () => {
    const s = flick(RELEASE + 300, 0, 1.4, 20);
    const end = s[s.length - 1];
    for (let t = 4; t <= 40; t += 4) s.push({ t: end.t + t, x: end.x, y: end.y });
    expect(normalizeGesture(input(s), opts)!.elevation).toBeLessThanOrEqual(ELEVATION.groundMax);
  });

  it('the documented curves', () => {
    expect(powerOf(0)).toBe(ATTACK_MIN_POWER);
    expect(powerOf(100)).toBe(1);
    expect(elevationOf(0, false)).toBe(0);
    expect(elevationOf(1, false)).toBe(ELEVATION.groundMax);
    expect(elevationOf(0, true)).toBe(ELEVATION.loftFrom);
    expect(elevationOf(1, true)).toBe(1);
  });
});

describe('keyboard parity', () => {
  it('Space at time t is the same defence as a tap at t: same start rule, same values', () => {
    const t = RELEASE + 488.8;
    const key = normalizeGesture({ pointer: 'keyboard', samples: [{ t, x: 0, y: 0 }], surface: PHONE }, { ...opts, calibrationMs: 40 })!;
    const tap = normalizeGesture(input([{ t, x: 200, y: 90 }]), { ...opts, calibrationMs: 40 })!;
    expect(key).toEqual(tap);
  });

  it('keyboard samples can never become a flick', () => {
    const key = normalizeGesture({ pointer: 'keyboard', samples: flick(RELEASE + 300, 45, 3, 60), surface: PHONE }, opts)!;
    expect(key.kind).toBe('defend');
  });

  it('carries footwork through unchanged', () => {
    expect(normalizeGesture({ pointer: 'keyboard', samples: [{ t: RELEASE, x: 0, y: 0 }], surface: PHONE, footwork: 'back' }, opts)!.footwork).toBe('back');
  });
});

describe('unusable input', () => {
  it('returns null rather than guessing', () => {
    expect(normalizeGesture(input([]), opts)).toBeNull();
    expect(normalizeGesture(input([{ t: 2, x: 0, y: 0 }, { t: 1, x: 50, y: 0 }]), opts)).toBeNull();
    expect(normalizeGesture(input([{ t: Number.NaN, x: 0, y: 0 }]), opts)).toBeNull();
    expect(normalizeGesture(input([{ t: 1, x: 0, y: 0 }], { width: 0, height: 10 }), opts)).toBeNull();
    expect(normalizeGesture(input([{ t: 1, x: 0, y: 0 }]), { ...opts, releasePerfMs: Number.NaN })).toBeNull();
  });
});

describe('calibration', () => {
  it('is the median of plausible attempts', () => {
    expect(calibrationFromTaps([40, 70, 55])).toEqual({ offsetMs: 55, attempts: 3 });
    expect(calibrationFromTaps([40, 70, 55, 61])).toEqual({ offsetMs: 58, attempts: 4 });
    expect(calibrationError(1062, 1000)).toBe(62);
  });
  it('rejects wild taps and clamps the result', () => {
    expect(calibrationFromTaps([60, 2000, -900, 64, Number.NaN])).toEqual({ offsetMs: 62, attempts: 2 });
    expect(calibrationFromTaps([280, 290, 299]).offsetMs).toBe(CALIBRATION.maxMs);
    expect(calibrationFromTaps([-200, -250]).offsetMs).toBe(CALIBRATION.minMs);
    expect(calibrationFromTaps([])).toEqual({ offsetMs: 0, attempts: 0 });
  });
});
