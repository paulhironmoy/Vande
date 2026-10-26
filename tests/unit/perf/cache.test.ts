import { describe, expect, it } from 'vitest';
import { PERF_CACHE_KEY, classifyDevice, clearCachedAssessment, isDeviceAssessment, loadCachedAssessment, saveCachedAssessment } from '@/perf';
import { measurements } from './fixtures';

function memoryStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

describe('assessment cache', () => {
  it('is kept per app version', () => {
    const store = memoryStore();
    const a = classifyDevice(measurements());
    saveCachedAssessment('1.0.0', a, store);
    expect(loadCachedAssessment('1.0.0', store)).toEqual(a);
    expect(loadCachedAssessment('1.0.1', store)).toBeNull();
    clearCachedAssessment(store);
    expect(loadCachedAssessment('1.0.0', store)).toBeNull();
  });

  it('ignores corrupt or tampered entries', () => {
    const store = memoryStore();
    store.setItem(PERF_CACHE_KEY, '{not json');
    expect(loadCachedAssessment('1.0.0', store)).toBeNull();
    store.setItem(PERF_CACHE_KEY, JSON.stringify({ v: 1, appVersion: '1.0.0', assessment: { ...classifyDevice(measurements()), tier: 'ultra' } }));
    expect(loadCachedAssessment('1.0.0', store)).toBeNull();
    expect(isDeviceAssessment(null)).toBe(false);
  });

  it('survives storage that throws', () => {
    const bad = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => saveCachedAssessment('1', classifyDevice(measurements()), bad)).not.toThrow();
    expect(loadCachedAssessment('1', bad)).toBeNull();
    expect(() => clearCachedAssessment(bad)).not.toThrow();
  });
});
