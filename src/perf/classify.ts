/**
 * The one device classifier (docs/PRACTICE.md, "Quality tiers"). Measurements in, a DeviceAssessment out: the tier
 * (Full Batter View, Assisted Performance, Below cutoff), the rendering profile, the extra timing tolerance and the
 * closed reason codes. Pure, so it is unit-tested with synthetic measurements; never by model name or price.
 *
 *   Full      ≥ 55 fps average, no one-second window under 50, at most 2 spikes, a hardware GPU, a stable context
 *             and a fast event-to-frame response.
 *   Assisted  45–54 fps, or a dip, spikes, one context loss, slow response or very little memory: Lite rendering,
 *             static crowd, simplified lighting, slightly more timing tolerance, stronger readability.
 *   Below     under 45 fps sustained, no WebGL 2, a software rasteriser, repeated context loss or severe latency:
 *             never first-person express bowling; Classic (2D) practice or a compatibility message instead.
 */
import type { DeviceAssessment, PerfTier, QualityProfileId } from '@/contracts';
import { frameStats, type FrameStats } from './frames';
import { isSoftwareRenderer } from './gpu';
import {
  PERF_ASSISTED_TOLERANCE_MS,
  PERF_CLASSIC_TOLERANCE_MS,
  PERF_CUTOFF_FPS,
  PERF_FULL_AVG_FPS,
  PERF_FULL_SUSTAINED_FPS,
  PERF_INPUT_FULL_MS,
  PERF_INPUT_SEVERE_MS,
  PERF_MAX_SPIKES_FULL,
  PERF_REPEATED_CONTEXT_LOSSES,
  PERF_SLOW_SHADER_MS,
} from './thresholds';

/** Closed reason codes (shown in the on-device diagnostics; never sent). */
export type PerfReason =
  | 'ok'
  | 'no_webgl2'
  | 'software_renderer'
  | 'context_lost'
  | 'context_lost_repeated'
  | 'no_frames'
  | 'fps_below_cutoff'
  | 'fps_assisted'
  | 'fps_dips'
  | 'frame_spikes'
  | 'input_latency_high'
  | 'input_latency_severe'
  | 'low_memory'
  | 'shader_compile_slow'
  | 'high_headroom'
  | 'lite_rerun'
  | 'session_fps_drop'
  | 'session_context_lost';

export const PERF_REASONS: readonly PerfReason[] = [
  'ok',
  'no_webgl2',
  'software_renderer',
  'context_lost',
  'context_lost_repeated',
  'no_frames',
  'fps_below_cutoff',
  'fps_assisted',
  'fps_dips',
  'frame_spikes',
  'input_latency_high',
  'input_latency_severe',
  'low_memory',
  'shader_compile_slow',
  'high_headroom',
  'lite_rerun',
  'session_fps_drop',
  'session_context_lost',
];

/** What one benchmark run measured. */
export interface PerfMeasurements {
  webgl2: boolean;
  /** The stage's own judgement; combined with isSoftwareRenderer(renderer). */
  hardware: boolean;
  renderer: string;
  shaderCompileMs: number;
  /** Intervals between presented frames (ms) while the benchmark scene played. */
  frameMs: readonly number[];
  contextLosses: number;
  /** Median event-to-frame response (ms), or null when it could not be measured. */
  inputToFrameMs: number | null;
  /** navigator.deviceMemory (GB, rounded down to a power of two by the browser), or null. */
  memoryGb: number | null;
  /** The rendering profile the frames were measured at. */
  profile?: QualityProfileId;
}

const TIER_RANK: Record<PerfTier, number> = { full: 2, assisted: 1, below: 0 };

/** Strictly below a threshold, ignoring floating-point noise from summed intervals (exactly 55.0 fps is 55). */
export function under(value: number, threshold: number): boolean {
  return value < threshold - 1e-6;
}

/** The lower of two tiers. */
export function lowerTier(a: PerfTier, b: PerfTier): PerfTier {
  return TIER_RANK[a] <= TIER_RANK[b] ? a : b;
}

export function tierRank(t: PerfTier): number {
  return TIER_RANK[t];
}

/** Extra timing tolerance per tier (ms). */
export function toleranceFor(tier: PerfTier): number {
  return tier === 'full' ? 0 : tier === 'assisted' ? PERF_ASSISTED_TOLERANCE_MS : PERF_CLASSIC_TOLERANCE_MS;
}

/**
 * The rendering profile for a tier. High only when a run measured at High still passed Full (frame intervals cannot
 * show headroom under vsync, so it is measured, never guessed); a run that passed at Lite stays Lite.
 */
export function profileFor(tier: PerfTier, _stats: FrameStats, m: Pick<PerfMeasurements, 'memoryGb' | 'shaderCompileMs' | 'profile'>): QualityProfileId {
  if (tier !== 'full') return 'lite';
  // A 3 GB phone reports 2 (deviceMemory rounds down): keep textures and buffers small there.
  if (m.memoryGb !== null && m.memoryGb <= 2) return 'lite';
  if (m.profile === 'high' || m.profile === 'lite') return m.profile;
  return 'standard';
}

/** Vsync-locked with no spikes, plenty of memory and quick shaders: worth measuring again at High. */
export function hasHighHeadroom(stats: FrameStats, m: Pick<PerfMeasurements, 'memoryGb' | 'shaderCompileMs'>): boolean {
  return stats.avgFps >= 58 && stats.p95FrameMs <= 18.5 && stats.spikes === 0 && (m.memoryGb ?? 0) >= 8 && m.shaderCompileMs <= 800;
}

export function classifyDevice(m: PerfMeasurements): DeviceAssessment {
  const stats = frameStats(m.frameMs);
  const reasons: PerfReason[] = [];
  let tier: PerfTier = 'full';
  const below = (r: PerfReason) => {
    reasons.push(r);
    tier = 'below';
  };
  const assisted = (r: PerfReason) => {
    reasons.push(r);
    tier = lowerTier(tier, 'assisted');
  };
  const software = !m.hardware || isSoftwareRenderer(m.renderer);

  if (!m.webgl2) below('no_webgl2');
  else {
    if (software) below('software_renderer');
    if (m.contextLosses >= PERF_REPEATED_CONTEXT_LOSSES) below('context_lost_repeated');
    else if (m.contextLosses > 0) assisted('context_lost');
    if (stats.frames === 0) below('no_frames');
    else {
      if (under(stats.avgFps, PERF_CUTOFF_FPS)) below('fps_below_cutoff');
      else if (under(stats.avgFps, PERF_FULL_AVG_FPS)) assisted('fps_assisted');
      else if (under(stats.minWindowFps, PERF_FULL_SUSTAINED_FPS)) assisted('fps_dips');
      if (stats.spikes > PERF_MAX_SPIKES_FULL) assisted('frame_spikes');
    }
    if (m.inputToFrameMs !== null && Number.isFinite(m.inputToFrameMs)) {
      if (m.inputToFrameMs > PERF_INPUT_SEVERE_MS) below('input_latency_severe');
      else if (m.inputToFrameMs > PERF_INPUT_FULL_MS) assisted('input_latency_high');
    }
    // Under 2 GB reported is under the 3 GB floor whatever the rounding: Lite and the Assisted readability help.
    if (m.memoryGb !== null && m.memoryGb < 2) assisted('low_memory');
  }
  if (m.shaderCompileMs > PERF_SLOW_SHADER_MS) reasons.push('shader_compile_slow');

  const profile = profileFor(tier, stats, m);
  if (!reasons.length) reasons.push('ok');
  return {
    webgl2: m.webgl2,
    hardware: m.webgl2 && !software,
    renderer: m.renderer,
    shaderCompileMs: round(m.shaderCompileMs),
    avgFps: round(stats.avgFps, 1),
    p95FrameMs: round(stats.p95FrameMs, 1),
    spikes: stats.spikes,
    contextLosses: m.contextLosses,
    inputToFrameMs: m.inputToFrameMs === null ? null : round(m.inputToFrameMs, 1),
    memoryGb: m.memoryGb,
    tier,
    profile,
    reasons,
    toleranceMs: toleranceFor(tier),
  };
}

function round(v: number, digits = 0): number {
  if (!Number.isFinite(v)) return 0;
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}

/** Whether only the frame rate (not the GPU, the context or the latency) kept a run out of a better tier. */
export function limitedByFrameRateOnly(a: DeviceAssessment): boolean {
  if (a.tier === 'full') return false;
  const fps: string[] = ['fps_below_cutoff', 'fps_assisted', 'fps_dips', 'frame_spikes', 'shader_compile_slow'];
  return a.reasons.every((r) => fps.includes(r));
}

/** Profiles the player may pick in settings: never more than the device earned (Classic is always allowed). */
export type QualityChoice = 'auto' | QualityProfileId | 'classic';

export function allowedQualityChoices(a: DeviceAssessment | null): QualityChoice[] {
  if (!a || a.tier === 'below') return ['auto', 'classic'];
  if (a.tier === 'assisted') return ['auto', 'lite', 'classic'];
  const order: QualityProfileId[] = ['lite', 'standard', 'high'];
  return ['auto', ...order.slice(0, order.indexOf(a.profile) + 1), 'classic'];
}

/** The effective rendering for a choice: a profile for the first-person stage, or Classic (the 2D stage). */
export function effectiveQuality(a: DeviceAssessment | null, choice: QualityChoice): { stage: '3d' | '2d'; profile: QualityProfileId } {
  if (!a || a.tier === 'below' || choice === 'classic') return { stage: '2d', profile: 'lite' };
  if (choice === 'auto' || !allowedQualityChoices(a).includes(choice)) return { stage: '3d', profile: a.profile };
  return { stage: '3d', profile: choice };
}
