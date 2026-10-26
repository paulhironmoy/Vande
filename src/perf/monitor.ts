/**
 * Keeps watching through a ten-over session (phones throttle when they warm up). Frame intervals are sampled while a
 * delivery plays; between balls, `checkpoint()` may step down (never up, so nothing oscillates): High → Standard
 * under 55 fps, Full → Assisted (Lite, the Assisted tolerance) under 50, Assisted → Classic under 45, each judged on
 * the median of the last three deliveries; repeated context loss goes straight to Classic. The caller applies a
 * decision before the next ball, never during one.
 */
import type { PerfTier, QualityProfileId } from '@/contracts';
import { frameStats, median } from './frames';
import { toleranceFor, under, type PerfReason } from './classify';
import { PERF_CUTOFF_FPS, PERF_FULL_AVG_FPS, PERF_FULL_SUSTAINED_FPS, PERF_REPEATED_CONTEXT_LOSSES } from './thresholds';

export interface MonitorState {
  tier: PerfTier;
  profile: QualityProfileId;
  stage: '3d' | '2d';
}

export interface MonitorDecision extends MonitorState {
  reason: Extract<PerfReason, 'session_fps_drop' | 'session_context_lost'>;
  toleranceMs: number;
  /** Median frame rate of the deliveries that triggered it (0 for a context-loss decision). */
  fps: number;
}

/** Deliveries judged together, and the shortest sampled window that counts. */
export const MONITOR_DELIVERIES = 3;
export const MONITOR_MIN_WINDOW_MS = 800;

export class SessionMonitor {
  private windows: number[] = [];
  private current: number[] = [];
  private losses = 0;

  constructor(private state: MonitorState) {}

  get snapshot(): MonitorState {
    return { ...this.state };
  }

  /** The player or settings changed the rendering: judge the new one from scratch. */
  reset(state: MonitorState): void {
    this.state = { ...state };
    this.windows = [];
    this.current = [];
  }

  /** One frame interval (ms) while a delivery plays. */
  sample(intervalMs: number): void {
    if (Number.isFinite(intervalMs) && intervalMs > 0 && intervalMs < 1000) this.current.push(intervalMs);
  }

  noteContextLoss(): void {
    this.losses++;
  }

  /** Recent per-delivery frame rates (diagnostics). */
  recentFps(): number[] {
    return [...this.windows];
  }

  /** Between balls: closes the delivery's window and returns a step down, or null. */
  checkpoint(): MonitorDecision | null {
    const stats = frameStats(this.current, { warmup: 0 });
    this.current = [];
    if (stats.durationMs >= MONITOR_MIN_WINDOW_MS) {
      this.windows.push(stats.avgFps);
      if (this.windows.length > MONITOR_DELIVERIES) this.windows.shift();
    }
    const s = this.state;
    if (this.losses >= PERF_REPEATED_CONTEXT_LOSSES && s.stage === '3d') return this.apply({ tier: 'below', profile: 'lite', stage: '2d' }, 'session_context_lost', 0);
    if (s.stage === '2d' || this.windows.length < MONITOR_DELIVERIES) return null;
    const fps = median(this.windows);
    if (s.tier === 'full') {
      if (under(fps, PERF_FULL_SUSTAINED_FPS)) return this.apply({ tier: 'assisted', profile: 'lite', stage: '3d' }, 'session_fps_drop', fps);
      if (under(fps, PERF_FULL_AVG_FPS) && s.profile === 'high') return this.apply({ tier: 'full', profile: 'standard', stage: '3d' }, 'session_fps_drop', fps);
    } else if (s.tier === 'assisted' && under(fps, PERF_CUTOFF_FPS)) {
      return this.apply({ tier: 'below', profile: 'lite', stage: '2d' }, 'session_fps_drop', fps);
    }
    return null;
  }

  private apply(next: MonitorState, reason: MonitorDecision['reason'], fps: number): MonitorDecision {
    this.state = next;
    this.windows = [];
    return { ...next, reason, toleranceMs: toleranceFor(next.tier), fps: Math.round(fps * 10) / 10 };
  }
}

export interface FrameSampler {
  start(): void;
  stop(): void;
  readonly running: boolean;
}

/** Frame intervals from requestAnimationFrame while started (the stage renders in the same frames). */
export function createFrameSampler(
  onInterval: (ms: number) => void,
  env: { raf: (cb: FrameRequestCallback) => number; caf: (id: number) => void } | null = typeof requestAnimationFrame === 'function'
    ? { raf: (cb) => requestAnimationFrame(cb), caf: (id) => cancelAnimationFrame(id) }
    : null,
): FrameSampler {
  let id = 0;
  let last = 0;
  let running = false;
  const tick = (t: number) => {
    if (!running || !env) return;
    if (last) onInterval(t - last);
    last = t;
    id = env.raf(tick);
  };
  return {
    start() {
      if (running || !env) return;
      running = true;
      last = 0;
      id = env.raf(tick);
    },
    stop() {
      running = false;
      if (env && id) env.caf(id);
      id = 0;
    },
    get running() {
      return running;
    },
  };
}
