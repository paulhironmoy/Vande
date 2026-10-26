/**
 * src/perf: the one device benchmark and quality classifier (docs/PRACTICE.md, "Quality tiers"). Small and stable:
 * thresholds, the GPU checks, frame statistics, the classifier, the benchmark, the per-version cache and the
 * in-session monitor. No rendering code lives here; the stage supplies the benchmark scene.
 */
export * from './thresholds';
export { SOFTWARE_RENDERER_RE, isSoftwareRenderer, readGpuRenderer, probeGpu, type GpuProbe } from './gpu';
export { frameStats, cleanIntervals, percentile, median, type FrameStats } from './frames';
export {
  classifyDevice,
  profileFor,
  hasHighHeadroom,
  limitedByFrameRateOnly,
  lowerTier,
  under,
  tierRank,
  toleranceFor,
  allowedQualityChoices,
  effectiveQuality,
  PERF_REASONS,
  type PerfMeasurements,
  type PerfReason,
  type QualityChoice,
} from './classify';
export { runDeviceBenchmark, measureEventToFrame, deviceMemoryGb, BENCHMARK_MS, CONFIRM_MS, type BenchmarkRun, type BenchmarkTarget, type BenchmarkOptions } from './benchmark';
export { loadCachedAssessment, saveCachedAssessment, clearCachedAssessment, isDeviceAssessment, PERF_CACHE_KEY } from './cache';
export { SessionMonitor, createFrameSampler, MONITOR_DELIVERIES, MONITOR_MIN_WINDOW_MS, type MonitorDecision, type MonitorState, type FrameSampler } from './monitor';
