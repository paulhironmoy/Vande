/**
 * Timing calibration, kept per modality (CTL9, finding F-028): each kind of input is corrected only by its own offset.
 */
import { describe, expect, it } from 'vitest';
import {
  MODALITIES,
  calibrationError,
  calibrationFor,
  calibrationFromTaps,
  calibrationsFromTaps,
  eventModality,
  normalizeGesture,
  resolveCalibrations,
  withCalibration,
} from '@/input';
import { CALIBRATION } from '@/input/constants';
import { OPTS, RELEASE, SURFACES, tapSamples } from './fixtures';

describe('calibrationFromTaps', () => {
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

describe('per modality', () => {
  it('attempts made with a mix of inputs give each input its own median, and only those with attempts', () => {
    const set = calibrationsFromTaps([
      { modality: 'touch', errorMs: 70 },
      { modality: 'touch', errorMs: 60 },
      { modality: 'touch', errorMs: 65 },
      { modality: 'keyboard', errorMs: 12 },
      { modality: 'keyboard', errorMs: 8 },
      { modality: 'mouse', errorMs: 900 },
    ]);
    expect(set).toEqual({ touch: { offsetMs: 65, attempts: 3 }, keyboard: { offsetMs: 10, attempts: 2 } });
  });

  it('a new calibration replaces only its own modality', () => {
    const set = withCalibration({ touch: { offsetMs: 65, attempts: 5 } }, 'mouse', { offsetMs: 14, attempts: 5 });
    expect(set).toEqual({ touch: { offsetMs: 65, attempts: 5 }, mouse: { offsetMs: 14, attempts: 5 } });
    expect(withCalibration(set, 'keyboard', { offsetMs: 0, attempts: 0 })).toEqual(set);
  });

  it('never borrows another input’s offset, except a pen, which shares the touch screen', () => {
    const set = { touch: { offsetMs: 65, attempts: 5 } };
    expect(calibrationFor(set, 'touch')).toBe(65);
    expect(calibrationFor(set, 'pen')).toBe(65);
    expect(calibrationFor(set, 'mouse')).toBe(0);
    expect(calibrationFor(set, 'keyboard')).toBe(0);
    expect(calibrationFor({ ...set, pen: { offsetMs: 40, attempts: 3 } }, 'pen')).toBe(40);
    expect(calibrationFor(null, 'touch')).toBe(0);
    expect(resolveCalibrations(set)).toEqual({ touch: 65, mouse: 0, pen: 65, keyboard: 0 });
    expect(MODALITIES).toEqual(['touch', 'mouse', 'pen', 'keyboard']);
  });

  it('normalizeGesture applies the swing’s own modality: a touch calibration never moves a mouse or key swing', () => {
    const calibrations = resolveCalibrations({ touch: { offsetMs: 65, attempts: 5 } });
    const o = { ...OPTS, calibrationMs: 0, calibrations };
    const press = RELEASE + 500;
    expect(
      normalizeGesture({ pointer: 'touch', samples: tapSamples(press, 60), surface: SURFACES.phone }, o)!.startT,
    ).toBeCloseTo(0.435, 6);
    expect(
      normalizeGesture({ pointer: 'mouse', samples: tapSamples(press, 60), surface: SURFACES.desktop }, o)!.startT,
    ).toBeCloseTo(0.5, 6);
    expect(
      normalizeGesture({ pointer: 'keyboard', samples: [{ t: press, x: 0, y: 0 }], surface: SURFACES.desktop }, o)!
        .startT,
    ).toBeCloseTo(0.5, 6);
  });

  it('tells the modality from the event', () => {
    expect(eventModality(new KeyboardEvent('keydown', { code: 'Space' }))).toBe('keyboard');
    expect(eventModality(new PointerEvent('pointerdown', { pointerType: 'mouse' }))).toBe('mouse');
    expect(eventModality(new PointerEvent('pointerdown', { pointerType: 'pen' }))).toBe('pen');
    expect(eventModality(new PointerEvent('pointerdown', { pointerType: 'touch' }))).toBe('touch');
  });
});
