import { describe, expect, it } from 'vitest';
import { FPS, frameTime, frameTimes, timeline } from '../src/schedule.ts';

describe('frame scheduling', () => {
  it('schedules 30 fps frames at exact times without drift', () => {
    const t = timeline({ durationMs: 42_000, fps: 30 });
    expect(t.frames).toBe(1260);
    const times = [...frameTimes(t)];
    expect(times).toHaveLength(1260);
    expect(times[0]).toEqual({ index: 0, tMs: 0 });
    expect(times[1].tMs).toBeCloseTo(33.333, 3);
    expect(times[30].tMs).toBe(1000);
    expect(times[1259].tMs).toBeCloseTo(41_966.667, 3);
    expect(frameTime(900)).toBe(30_000);
    // No accumulated floating error over a minute.
    expect(frameTime(1800)).toBe(60_000);
  });

  it('accepts 30–60 s at 30 fps only', () => {
    expect(timeline({ durationMs: 30_000, fps: FPS }).frames).toBe(900);
    expect(timeline({ durationMs: 60_000, fps: FPS }).frames).toBe(1800);
    expect(() => timeline({ durationMs: 29_999, fps: 30 })).toThrow(/30–60 s/);
    expect(() => timeline({ durationMs: 60_001, fps: 30 })).toThrow(/30–60 s/);
    expect(() => timeline({ durationMs: Number.NaN, fps: 30 })).toThrow();
    expect(() => timeline({ durationMs: 40_000, fps: 60 })).toThrow(/fps/);
  });
});
