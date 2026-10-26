/**
 * The one device benchmark, run while "Preparing the pitch…" shows. It plays the stage's own benchmark scene and
 * measures frame times, spikes, shader compilation and context loss (through the stage), the event-to-frame
 * response (here, while that scene renders) and the memory hint, then classifies (classify.ts).
 *
 * Runs: Standard first. A Full result with headroom is confirmed with a short run at High; a result held back only by
 * its frame rate gets a short run at Lite (a device that cannot hold Standard may still hold Lite at 45+ fps).
 * About 1.6 s on a typical device, at most about 2.8 s, and only once per app version (cache.ts).
 */
import type { DeviceAssessment, QualityProfileId } from '@/contracts';
import { classifyDevice, hasHighHeadroom, limitedByFrameRateOnly, tierRank, type PerfMeasurements, type PerfReason } from './classify';
import { frameStats, median } from './frames';
import { probeGpu, type GpuProbe } from './gpu';

/** The stage's benchmark scene, as src/render3d's PracticeStage provides it. */
export interface BenchmarkRun {
  frameMs: number[];
  shaderCompileMs: number;
  contextLosses: number;
  renderer: string;
  webgl2: boolean;
  hardware: boolean;
}

export interface BenchmarkTarget {
  benchmark(ms: number): Promise<BenchmarkRun>;
  setProfile(profile: QualityProfileId): void;
}

export interface BenchmarkOptions {
  /** The main run at Standard (ms). */
  durationMs?: number;
  /** The confirmation runs at High or Lite (ms). */
  confirmMs?: number;
  /** navigator.deviceMemory by default. */
  memoryGb?: number | null;
  /** The event-to-frame measurement (default: measureEventToFrame while the scene renders). */
  measureInput?: () => Promise<number | null>;
  /** WebGL 2 probe used when there is no stage. */
  probe?: () => GpuProbe;
}

export const BENCHMARK_MS = 1400;
export const CONFIRM_MS = 900;

export function deviceMemoryGb(nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator): number | null {
  const v = (nav as (Navigator & { deviceMemory?: number }) | undefined)?.deviceMemory;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

interface FrameEnv {
  raf: (cb: FrameRequestCallback) => number;
  now: () => number;
  post: (cb: () => void) => void;
  wait: (ms: number) => Promise<void>;
}

function defaultEnv(): FrameEnv | null {
  if (typeof requestAnimationFrame !== 'function' || typeof performance === 'undefined') return null;
  let channel: MessageChannel | null = null;
  const queue: Array<() => void> = [];
  return {
    raf: (cb) => requestAnimationFrame(cb),
    now: () => performance.now(),
    // A task queued like an input event: it waits behind whatever the main thread is doing (a long render).
    post: (cb) => {
      if (typeof MessageChannel === 'undefined') {
        setTimeout(cb, 0);
        return;
      }
      if (!channel) {
        channel = new MessageChannel();
        channel.port1.onmessage = () => queue.shift()?.();
      }
      queue.push(cb);
      channel.port2.postMessage(0);
    },
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

/**
 * Median time from an input-like task being queued to the second animation frame after it ran: the frame that
 * shows a response has then been submitted. It covers main-thread queueing and render time, not the touch
 * digitiser or the display, which JavaScript cannot see; real swings are measured by the stage (input to the first
 * frame showing the bat moving) and reported separately.
 */
export async function measureEventToFrame(samples = 6, env: FrameEnv | null = defaultEnv()): Promise<number | null> {
  if (!env) return null;
  const out: number[] = [];
  for (let i = 0; i < samples; i++) {
    // A different phase within the frame each time.
    await env.wait(40 + ((i * 7) % 17));
    const t0 = env.now();
    const ms = await new Promise<number>((resolve) => {
      env.post(() => env.raf(() => env.raf(() => resolve(env.now() - t0))));
    });
    if (Number.isFinite(ms) && ms >= 0 && ms < 2000) out.push(ms);
  }
  return out.length ? median(out) : null;
}

async function measure(stage: BenchmarkTarget, profile: QualityProfileId, ms: number, o: BenchmarkOptions, memoryGb: number | null): Promise<PerfMeasurements> {
  stage.setProfile(profile);
  const input = o.measureInput ?? (() => measureEventToFrame());
  const [run, inputToFrameMs] = await Promise.all([stage.benchmark(ms), input().catch(() => null)]);
  return {
    webgl2: run.webgl2,
    hardware: run.hardware,
    renderer: run.renderer,
    shaderCompileMs: run.shaderCompileMs,
    frameMs: run.frameMs,
    contextLosses: run.contextLosses,
    inputToFrameMs,
    memoryGb,
    profile,
  };
}

function withReason(a: DeviceAssessment, r: PerfReason): DeviceAssessment {
  return { ...a, reasons: a.reasons[0] === 'ok' ? [r] : [...a.reasons, r] };
}

/**
 * Benchmarks the device on the stage (or, without one, records why there is none) and classifies it. The stage is
 * left at the chosen profile.
 */
export async function runDeviceBenchmark(stage: BenchmarkTarget | null, o: BenchmarkOptions = {}): Promise<DeviceAssessment> {
  const a = await benchmarkRuns(stage, o);
  try {
    stage?.setProfile(a.profile);
  } catch {
    /* a stage that already failed is replaced by the caller */
  }
  return a;
}

async function benchmarkRuns(stage: BenchmarkTarget | null, o: BenchmarkOptions): Promise<DeviceAssessment> {
  const memoryGb = o.memoryGb === undefined ? deviceMemoryGb() : o.memoryGb;
  const none = (): DeviceAssessment => {
    const p = (o.probe ?? probeGpu)();
    return classifyDevice({ webgl2: p.webgl2, hardware: p.hardware, renderer: p.renderer, shaderCompileMs: 0, frameMs: [], contextLosses: 0, inputToFrameMs: null, memoryGb });
  };
  if (!stage) return none();
  let first: PerfMeasurements;
  try {
    first = await measure(stage, 'standard', o.durationMs ?? BENCHMARK_MS, o, memoryGb);
  } catch {
    return none();
  }
  const a = classifyDevice(first);
  const confirmMs = o.confirmMs ?? CONFIRM_MS;
  try {
    const confirm = a.tier === 'full' && hasHighHeadroom(frameStats(first.frameMs), first) ? 'high' : a.tier !== 'full' && limitedByFrameRateOnly(a) ? 'lite' : null;
    if (confirm) {
      const m = await measure(stage, confirm, confirmMs, o, memoryGb);
      // A context loss in any run counts against the device.
      if (m.contextLosses > 0) return classifyDevice({ ...first, contextLosses: first.contextLosses + m.contextLosses });
      const b = { ...classifyDevice(m), shaderCompileMs: a.shaderCompileMs };
      if (confirm === 'high' && b.tier === 'full' && b.profile === 'high') return withReason(b, 'high_headroom');
      if (confirm === 'lite' && tierRank(b.tier) > tierRank(a.tier)) return withReason(b, 'lite_rerun');
    }
  } catch {
    /* a failed confirmation run keeps the first result */
  }
  return a;
}
