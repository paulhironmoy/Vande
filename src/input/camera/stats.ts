/** Small numbers about the camera pipeline for the diagnostics and the measurements: inference time and frame pacing. */
export function percentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

/** A ring of recent samples with percentiles. */
export class Ring {
  private readonly buf: number[] = [];
  constructor(private readonly size: number) {}
  push(v: number) {
    this.buf.push(v);
    if (this.buf.length > this.size) this.buf.shift();
  }
  get length() {
    return this.buf.length;
  }
  p(q: number): number {
    return percentile(
      [...this.buf].sort((a, b) => a - b),
      q,
    );
  }
  mean(): number {
    return this.buf.length ? this.buf.reduce((a, b) => a + b, 0) / this.buf.length : 0;
  }
  clear() {
    this.buf.length = 0;
  }
}

export interface CameraStats {
  delivered: number;
  processed: number;
  dropped: number;
  delegate: 'GPU' | 'CPU' | null;
  inferenceMs: { p50: number; p95: number; p99: number };
  /** Pose results per second over the last frames, by capture time. */
  fps: number;
  /** Capture-to-pose (frame callback to landmarks back on the page), ms. */
  pipelineMs: { p50: number; p95: number };
}
