/** Frame-interval statistics shared by the benchmark and the in-session monitor. */
import { PERF_SPIKE_MS, PERF_WARMUP_FRAMES, PERF_WINDOW_MS } from './thresholds';

export interface FrameStats {
  /** Frames counted (after warm-up). */
  frames: number;
  /** Total measured time (ms). */
  durationMs: number;
  /** Frames per second over the whole run: frames ÷ time. */
  avgFps: number;
  /** 95th-percentile frame interval (ms). */
  p95FrameMs: number;
  /** Intervals longer than PERF_SPIKE_MS. */
  spikes: number;
  /** The lowest frame rate over any PERF_WINDOW_MS window (the whole run when it is shorter): "sustained" drops. */
  minWindowFps: number;
}

const EMPTY: FrameStats = { frames: 0, durationMs: 0, avgFps: 0, p95FrameMs: 0, spikes: 0, minWindowFps: 0 };

/** Valid intervals only: positive, finite, and under a second (a hidden tab or a breakpoint is not a frame). */
export function cleanIntervals(frameMs: readonly number[], warmup = 0): number[] {
  return frameMs.slice(warmup).filter((v) => Number.isFinite(v) && v > 0 && v < 1000);
}

export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

export function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Statistics of one run of frame intervals (ms between presented frames). */
export function frameStats(frameMs: readonly number[], opts: { warmup?: number; windowMs?: number } = {}): FrameStats {
  const xs = cleanIntervals(frameMs, opts.warmup ?? PERF_WARMUP_FRAMES);
  if (!xs.length) return EMPTY;
  const windowMs = opts.windowMs ?? PERF_WINDOW_MS;
  const durationMs = xs.reduce((s, v) => s + v, 0);
  const avgFps = (xs.length / durationMs) * 1000;
  let minWindowFps = avgFps;
  if (durationMs > windowMs) {
    // Two pointers over a sliding window of at least windowMs.
    let sum = 0;
    let j = 0;
    for (let i = 0; i < xs.length; i++) {
      while (j < xs.length && sum < windowMs) sum += xs[j++];
      if (sum < windowMs) break;
      minWindowFps = Math.min(minWindowFps, ((j - i) / sum) * 1000);
      sum -= xs[i];
    }
  }
  return {
    frames: xs.length,
    durationMs,
    avgFps,
    p95FrameMs: percentile(xs, 95),
    spikes: xs.filter((v) => v > PERF_SPIKE_MS).length,
    minWindowFps,
  };
}
