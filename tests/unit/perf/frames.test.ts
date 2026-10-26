import { describe, expect, it } from 'vitest';
import { cleanIntervals, frameStats, median, percentile } from '@/perf';
import { steady } from './fixtures';

describe('frame statistics', () => {
  it('average frame rate is frames over time', () => {
    const s = frameStats(steady(60, 2), { warmup: 0 });
    expect(s.frames).toBe(120);
    expect(s.avgFps).toBeCloseTo(60, 5);
    expect(s.p95FrameMs).toBeCloseTo(16.667, 2);
    expect(s.spikes).toBe(0);
  });

  it('the sustained (worst one-second window) rate finds a dip', () => {
    const s = frameStats([...steady(60, 1), ...steady(30, 1), ...steady(60, 1)], { warmup: 0 });
    expect(s.minWindowFps).toBeGreaterThan(29);
    expect(s.minWindowFps).toBeLessThan(31);
    expect(s.avgFps).toBeGreaterThan(40);
  });

  it('a run shorter than the window uses its own average', () => {
    const s = frameStats(steady(50, 0.5), { warmup: 0 });
    expect(s.minWindowFps).toBeCloseTo(s.avgFps, 5);
  });

  it('ignores invalid intervals (hidden tab, negative, NaN)', () => {
    expect(cleanIntervals([16, -1, Number.NaN, 5000, 17])).toEqual([16, 17]);
    expect(frameStats([]).frames).toBe(0);
  });

  it('percentile and median', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});
