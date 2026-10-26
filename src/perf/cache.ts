/**
 * The assessment is cached on the device per app version (a new version may render differently), so the benchmark
 * runs once and the first delivery comes sooner. Settings can run it again. Stored locally only; never sent.
 */
import type { DeviceAssessment, PerfTier, QualityProfileId } from '@/contracts';

export const PERF_CACHE_KEY = 'vc:practice:perf';

interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function localStore(): KeyStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const TIERS: readonly PerfTier[] = ['full', 'assisted', 'below'];
const PROFILES: readonly QualityProfileId[] = ['lite', 'standard', 'high'];
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

export function isDeviceAssessment(x: unknown): x is DeviceAssessment {
  if (!x || typeof x !== 'object') return false;
  const a = x as Record<string, unknown>;
  return (
    typeof a.webgl2 === 'boolean' &&
    typeof a.hardware === 'boolean' &&
    typeof a.renderer === 'string' &&
    num(a.shaderCompileMs) &&
    num(a.avgFps) &&
    num(a.p95FrameMs) &&
    num(a.spikes) &&
    num(a.contextLosses) &&
    (a.inputToFrameMs === null || num(a.inputToFrameMs)) &&
    (a.memoryGb === null || num(a.memoryGb)) &&
    TIERS.includes(a.tier as PerfTier) &&
    PROFILES.includes(a.profile as QualityProfileId) &&
    Array.isArray(a.reasons) &&
    a.reasons.every((r) => typeof r === 'string') &&
    num(a.toleranceMs)
  );
}

export function loadCachedAssessment(appVersion: string, store: KeyStore | null = localStore()): DeviceAssessment | null {
  try {
    const raw = store?.getItem(PERF_CACHE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { v?: number; appVersion?: string; assessment?: unknown };
    if (v.v !== 1 || v.appVersion !== appVersion || !isDeviceAssessment(v.assessment)) return null;
    return v.assessment;
  } catch {
    return null;
  }
}

export function saveCachedAssessment(appVersion: string, assessment: DeviceAssessment, store: KeyStore | null = localStore()): void {
  try {
    store?.setItem(PERF_CACHE_KEY, JSON.stringify({ v: 1, appVersion, assessment }));
  } catch {
    /* storage full or blocked: the benchmark simply runs again next time */
  }
}

export function clearCachedAssessment(store: KeyStore | null = localStore()): void {
  try {
    store?.removeItem(PERF_CACHE_KEY);
  } catch {
    /* ignore */
  }
}
