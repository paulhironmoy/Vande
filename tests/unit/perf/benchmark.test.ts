import { describe, expect, it } from 'vitest';
import type { QualityProfileId } from '@/contracts';
import { measureEventToFrame, runDeviceBenchmark, type BenchmarkRun, type BenchmarkTarget } from '@/perf';
import { steady } from './fixtures';

/** A stage whose benchmark scene runs at a given frame rate per profile. */
function fakeStage(fpsByProfile: Record<QualityProfileId, number>, over: Partial<BenchmarkRun> = {}): BenchmarkTarget & { profiles: QualityProfileId[]; current: QualityProfileId } {
  const s = {
    profiles: [] as QualityProfileId[],
    current: 'standard' as QualityProfileId,
    setProfile(p: QualityProfileId) {
      s.current = p;
    },
    async benchmark(ms: number): Promise<BenchmarkRun> {
      s.profiles.push(s.current);
      return { frameMs: steady(fpsByProfile[s.current], ms / 1000), shaderCompileMs: 300, contextLosses: 0, renderer: 'Mali-G57 MC2', webgl2: true, hardware: true, ...over };
    },
  };
  return s;
}

const fast = { measureInput: async () => 22, durationMs: 1400, confirmMs: 900 };

describe('runDeviceBenchmark', () => {
  it('a steady 60 fps device with little memory is Full at Standard after one run', async () => {
    const stage = fakeStage({ lite: 60, standard: 60, high: 60 });
    const a = await runDeviceBenchmark(stage, { ...fast, memoryGb: 4 });
    expect(a.tier).toBe('full');
    expect(a.profile).toBe('standard');
    expect(stage.profiles).toEqual(['standard']);
    expect(stage.current).toBe('standard');
  });

  it('confirms High with a second run when there is headroom', async () => {
    const stage = fakeStage({ lite: 60, standard: 60, high: 60 });
    const a = await runDeviceBenchmark(stage, { ...fast, memoryGb: 8 });
    expect(stage.profiles).toEqual(['standard', 'high']);
    expect(a.profile).toBe('high');
    expect(a.reasons).toEqual(['high_headroom']);
    expect(stage.current).toBe('high');
  });

  it('stays at Standard when High cannot hold the rate', async () => {
    const stage = fakeStage({ lite: 60, standard: 60, high: 44 });
    const a = await runDeviceBenchmark(stage, { ...fast, memoryGb: 8 });
    expect(a.tier).toBe('full');
    expect(a.profile).toBe('standard');
    expect(stage.current).toBe('standard');
  });

  it('a device that cannot hold Standard but holds Lite at 45+ is Assisted, not Below', async () => {
    const stage = fakeStage({ lite: 50, standard: 38, high: 30 });
    const a = await runDeviceBenchmark(stage, { ...fast, memoryGb: 4 });
    expect(stage.profiles).toEqual(['standard', 'lite']);
    expect(a.tier).toBe('assisted');
    expect(a.profile).toBe('lite');
    expect(a.reasons).toContain('lite_rerun');
  });

  it('a device that holds 60 at Lite but not Standard is Full at Lite (no extra tolerance)', async () => {
    const a = await runDeviceBenchmark(fakeStage({ lite: 60, standard: 48, high: 30 }), { ...fast, memoryGb: 4 });
    expect(a.tier).toBe('full');
    expect(a.profile).toBe('lite');
    expect(a.toleranceMs).toBe(0);
  });

  it('a software renderer is not re-run: Below straight away', async () => {
    const stage = fakeStage({ lite: 60, standard: 60, high: 60 }, { renderer: 'Google SwiftShader', hardware: false });
    const a = await runDeviceBenchmark(stage, fast);
    expect(stage.profiles).toEqual(['standard']);
    expect(a.tier).toBe('below');
  });

  it('a context loss during the confirmation run counts', async () => {
    const stage = fakeStage({ lite: 60, standard: 60, high: 60 });
    const base = stage.benchmark.bind(stage);
    stage.benchmark = async (ms) => ({ ...(await base(ms)), contextLosses: stage.current === 'high' ? 1 : 0 });
    const a = await runDeviceBenchmark(stage, { ...fast, memoryGb: 8 });
    expect(a.tier).toBe('assisted');
    expect(a.contextLosses).toBe(1);
  });

  it('without a stage it says why (no WebGL 2)', async () => {
    const a = await runDeviceBenchmark(null, { probe: () => ({ webgl2: false, renderer: '', hardware: false }) });
    expect(a.tier).toBe('below');
    expect(a.reasons).toEqual(['no_webgl2']);
  });

  it('a failing stage benchmark falls back to the probe', async () => {
    const stage: BenchmarkTarget = {
      setProfile() {},
      benchmark: async () => {
        throw new Error('context failed');
      },
    };
    const a = await runDeviceBenchmark(stage, { probe: () => ({ webgl2: true, renderer: 'Adreno (TM) 610', hardware: true }) });
    expect(a.tier).toBe('below');
    expect(a.reasons).toContain('no_frames');
  });
});

describe('measureEventToFrame', () => {
  it('measures a queued task to the second frame after it', async () => {
    let t = 0;
    const env = {
      now: () => t,
      wait: async (ms: number) => {
        t += ms;
      },
      post: (cb: () => void) => {
        t += 5;
        cb();
      },
      raf: (cb: FrameRequestCallback) => {
        t += 16;
        cb(t);
        return 1;
      },
    };
    expect(await measureEventToFrame(4, env)).toBe(37);
    expect(await measureEventToFrame(4, null)).toBeNull();
  });
});
