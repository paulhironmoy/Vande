import { describe, expect, it } from 'vitest';
import { calibrationFor, calibrationsFromTaps, resolveCalibrations, withCalibration } from '@/input/calibration';
import { strokePath, synthFrames, traceCamera } from '@/input/camera/simulate';

const SPEC = { startMs: 1000, rise: 1.0, riseMs: 350, holdMs: 150, descent: 1.3, downMs: 200 };

describe('camera calibration entry', () => {
  it('is its own modality: stored, resolved, never borrowed from touch (a pen is the only borrower)', () => {
    const set = { touch: { offsetMs: 65, attempts: 5 } };
    expect(calibrationFor(set, 'camera')).toBe(0);
    expect(resolveCalibrations(set).camera).toBe(0);
    const withCam = withCalibration(set, 'camera', { offsetMs: 90, attempts: 4 });
    expect(calibrationFor(withCam, 'camera')).toBe(90);
    expect(calibrationFor(withCam, 'touch')).toBe(65);
    expect(
      calibrationsFromTaps([
        { modality: 'camera', errorMs: 80 },
        { modality: 'camera', errorMs: 100 },
        { modality: 'touch', errorMs: 50 },
      ]),
    ).toEqual({
      camera: { offsetMs: 90, attempts: 2 },
      touch: { offsetMs: 50, attempts: 1 },
    });
  });

  it('a camera swing is corrected by the camera offset only', () => {
    const frames = synthFrames({ hand: strokePath(SPEC), fps: 30, t0: 0, durationMs: 3000 });
    const zero = traceCamera({ frames, armAtMs: 600 }).swing;
    const cam = traceCamera({ frames, armAtMs: 600, calibrationMs: 70 }).swing;
    expect(((zero?.startT ?? 0) - (cam?.startT ?? 0)) * 1000).toBeCloseTo(70, 0);
  });
});
