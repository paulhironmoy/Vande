/** Synthetic benchmark measurements for the classifier tests. */
import type { PerfMeasurements } from '@/perf';

/** Steady frame intervals at `fps` for `seconds`. */
export function steady(fps: number, seconds: number): number[] {
  return Array.from({ length: Math.round(fps * seconds) }, () => 1000 / fps);
}

/** A mid-range Adreno phone at a steady 60 fps. */
export function measurements(over: Partial<PerfMeasurements> = {}): PerfMeasurements {
  return {
    webgl2: true,
    hardware: true,
    renderer: 'Adreno (TM) 619',
    shaderCompileMs: 240,
    frameMs: steady(60, 1.6),
    contextLosses: 0,
    inputToFrameMs: 24,
    memoryGb: 4,
    profile: 'standard',
    ...over,
  };
}
