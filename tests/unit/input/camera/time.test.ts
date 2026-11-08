import { describe, expect, it } from 'vitest';
import { MAX_FRAME_AGE_MS, MIN_FRAME_STEP_MS, normalizeFrameTime } from '@/input/camera/time';

describe('normalizeFrameTime: camera frame time on the performance clock', () => {
  it('prefers the capture time, so a late frame keeps the moment the player moved', () => {
    expect(normalizeFrameTime({ captureTime: 940 }, 1000, 900)).toBe(940);
  });

  it('falls back to the presentation time and then to now', () => {
    expect(normalizeFrameTime({ presentationTime: 980 }, 1000, 900)).toBe(980);
    expect(normalizeFrameTime(undefined, 1000, 900)).toBe(1000);
    expect(normalizeFrameTime({ captureTime: Number.NaN }, 1000, 900)).toBe(1000);
  });

  it('does not believe a time in the future or one that is far too old', () => {
    expect(normalizeFrameTime({ captureTime: 1100 }, 1000, 900)).toBe(1000);
    expect(normalizeFrameTime({ captureTime: 1000 - MAX_FRAME_AGE_MS - 1 }, 1000, 0)).toBe(1000);
  });

  it('is strictly increasing even for equal or backward times', () => {
    expect(normalizeFrameTime({ captureTime: 950 }, 1000, 950)).toBe(950 + MIN_FRAME_STEP_MS);
    expect(normalizeFrameTime({ captureTime: 940 }, 1000, 950)).toBe(950 + MIN_FRAME_STEP_MS);
  });
});
