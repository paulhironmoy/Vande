import { describe, expect, it } from 'vitest';
import {
  PERF_ASSISTED_TOLERANCE_MS,
  PERF_CLASSIC_TOLERANCE_MS,
  allowedQualityChoices,
  classifyDevice,
  effectiveQuality,
  frameStats,
  isSoftwareRenderer,
  limitedByFrameRateOnly,
} from '@/perf';
import { measurements, steady } from './fixtures';

describe('software renderers', () => {
  it.each([
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    'Google SwiftShader',
    'llvmpipe (LLVM 15.0.7, 256 bits)',
    'Mesa lavapipe',
    'softpipe',
    'Microsoft Basic Render Driver',
    'Apple Software Renderer',
  ])('recognises %s', (r) => expect(isSoftwareRenderer(r)).toBe(true));

  it.each(['Adreno (TM) 619', 'Mali-G57 MC2', 'PowerVR Rogue GE8320', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)', 'NVIDIA GeForce RTX 3060/PCIe/SSE2', ''])(
    'does not flag %s',
    (r) => expect(isSoftwareRenderer(r)).toBe(false),
  );
});

describe('classifyDevice', () => {
  it('Full Batter View: 55+ fps, steady, hardware, stable, responsive', () => {
    const a = classifyDevice(measurements());
    expect(a.tier).toBe('full');
    expect(a.profile).toBe('standard');
    expect(a.toleranceMs).toBe(0);
    expect(a.reasons).toEqual(['ok']);
    expect(a.avgFps).toBeCloseTo(60, 0);
  });

  it('exactly 55 fps average is still Full; 54 is Assisted', () => {
    expect(classifyDevice(measurements({ frameMs: steady(55, 2) })).tier).toBe('full');
    const a = classifyDevice(measurements({ frameMs: steady(54, 2) }));
    expect(a.tier).toBe('assisted');
    expect(a.reasons).toContain('fps_assisted');
  });

  it('Assisted Performance: 45–54 fps, Lite, a slight extra tolerance', () => {
    const a = classifyDevice(measurements({ frameMs: steady(48, 2) }));
    expect(a.tier).toBe('assisted');
    expect(a.profile).toBe('lite');
    expect(a.toleranceMs).toBe(PERF_ASSISTED_TOLERANCE_MS);
  });

  it('45 fps is the cutoff: 45 is Assisted, 44 is Below', () => {
    expect(classifyDevice(measurements({ frameMs: steady(45, 2) })).tier).toBe('assisted');
    const b = classifyDevice(measurements({ frameMs: steady(44, 2) }));
    expect(b.tier).toBe('below');
    expect(b.reasons).toContain('fps_below_cutoff');
    expect(b.toleranceMs).toBe(PERF_CLASSIC_TOLERANCE_MS);
  });

  it('a sustained one-second dip under 50 fps keeps a 55+ average out of Full', () => {
    const frameMs = [...steady(60, 1.2), ...steady(40, 1.1), ...steady(60, 2.5)];
    const stats = frameStats(frameMs);
    expect(stats.avgFps).toBeGreaterThanOrEqual(55);
    expect(stats.minWindowFps).toBeLessThan(50);
    const a = classifyDevice(measurements({ frameMs }));
    expect(a.tier).toBe('assisted');
    expect(a.reasons).toContain('fps_dips');
  });

  it('a short blip (under a second) is not a sustained fall', () => {
    const frameMs = [...steady(60, 1), ...steady(40, 0.2), ...steady(60, 1)];
    expect(classifyDevice(measurements({ frameMs })).tier).toBe('full');
  });

  it('more than two spikes over 50 ms is not Full', () => {
    const frameMs = steady(60, 2);
    frameMs.splice(20, 0, 70, 80);
    expect(classifyDevice(measurements({ frameMs })).tier).toBe('full');
    frameMs.splice(60, 0, 90);
    const a = classifyDevice(measurements({ frameMs }));
    expect(a.spikes).toBe(3);
    expect(a.tier).toBe('assisted');
    expect(a.reasons).toContain('frame_spikes');
  });

  it('warm-up frames (first uploads) are ignored', () => {
    expect(classifyDevice(measurements({ frameMs: [400, 120, 90, ...steady(60, 2)] })).tier).toBe('full');
  });

  it('a software rasteriser is below the cutoff whatever its frame rate', () => {
    const a = classifyDevice(measurements({ renderer: 'Google SwiftShader', frameMs: steady(60, 2) }));
    expect(a.tier).toBe('below');
    expect(a.hardware).toBe(false);
    expect(a.reasons).toContain('software_renderer');
    // The stage's own judgement counts too.
    expect(classifyDevice(measurements({ hardware: false })).tier).toBe('below');
  });

  it('no WebGL 2 is below the cutoff', () => {
    const a = classifyDevice(measurements({ webgl2: false, frameMs: [] }));
    expect(a.tier).toBe('below');
    expect(a.reasons).toEqual(['no_webgl2']);
  });

  it('one context loss is Assisted; repeated context loss is Below', () => {
    expect(classifyDevice(measurements({ contextLosses: 1 })).tier).toBe('assisted');
    const b = classifyDevice(measurements({ contextLosses: 2 }));
    expect(b.tier).toBe('below');
    expect(b.reasons).toContain('context_lost_repeated');
  });

  it('input latency: over 50 ms is Assisted, over 100 ms is Below; unmeasured does not count', () => {
    expect(classifyDevice(measurements({ inputToFrameMs: 50 })).tier).toBe('full');
    expect(classifyDevice(measurements({ inputToFrameMs: 64 })).reasons).toContain('input_latency_high');
    expect(classifyDevice(measurements({ inputToFrameMs: 64 })).tier).toBe('assisted');
    expect(classifyDevice(measurements({ inputToFrameMs: 140 })).tier).toBe('below');
    expect(classifyDevice(measurements({ inputToFrameMs: null })).tier).toBe('full');
  });

  it('no frames at all is below the cutoff', () => {
    expect(classifyDevice(measurements({ frameMs: [] })).reasons).toContain('no_frames');
  });

  it('memory: a 3 GB phone (reports 2) renders Lite but keeps Full; under 2 is Assisted', () => {
    const a = classifyDevice(measurements({ memoryGb: 2 }));
    expect(a.tier).toBe('full');
    expect(a.profile).toBe('lite');
    expect(classifyDevice(measurements({ memoryGb: 1 })).tier).toBe('assisted');
    expect(classifyDevice(measurements({ memoryGb: null })).profile).toBe('standard');
  });

  it('High only when measured at High; a Full run at Lite stays Lite', () => {
    expect(classifyDevice(measurements({ profile: 'high', memoryGb: 8 })).profile).toBe('high');
    expect(classifyDevice(measurements({ profile: 'lite' })).profile).toBe('lite');
    expect(classifyDevice(measurements({ profile: 'standard', memoryGb: 8 })).profile).toBe('standard');
  });

  it('slow shader compilation is noted without changing the tier', () => {
    const a = classifyDevice(measurements({ shaderCompileMs: 2400 }));
    expect(a.tier).toBe('full');
    expect(a.reasons).toEqual(['shader_compile_slow']);
  });

  it('reports several reasons at once and the lowest tier wins', () => {
    const a = classifyDevice(measurements({ frameMs: steady(50, 2), contextLosses: 2, inputToFrameMs: 70 }));
    expect(a.tier).toBe('below');
    expect(a.reasons).toEqual(expect.arrayContaining(['context_lost_repeated', 'fps_assisted', 'input_latency_high']));
  });

  it('frame-rate-only limits are recognised (worth a run at Lite)', () => {
    expect(limitedByFrameRateOnly(classifyDevice(measurements({ frameMs: steady(40, 2) })))).toBe(true);
    expect(limitedByFrameRateOnly(classifyDevice(measurements({ frameMs: steady(40, 2), renderer: 'llvmpipe' })))).toBe(false);
    expect(limitedByFrameRateOnly(classifyDevice(measurements()))).toBe(false);
  });
});

describe('quality choices', () => {
  it('never more than the device earned; Classic is always there', () => {
    const full = classifyDevice(measurements({ profile: 'high', memoryGb: 8 }));
    expect(allowedQualityChoices(full)).toEqual(['auto', 'lite', 'standard', 'high', 'classic']);
    expect(allowedQualityChoices(classifyDevice(measurements()))).toEqual(['auto', 'lite', 'standard', 'classic']);
    expect(allowedQualityChoices(classifyDevice(measurements({ frameMs: steady(48, 2) })))).toEqual(['auto', 'lite', 'classic']);
    expect(allowedQualityChoices(classifyDevice(measurements({ webgl2: false })))).toEqual(['auto', 'classic']);
    expect(allowedQualityChoices(null)).toEqual(['auto', 'classic']);
  });

  it('below the cutoff the first-person stage is never used', () => {
    const below = classifyDevice(measurements({ renderer: 'SwiftShader' }));
    expect(effectiveQuality(below, 'auto')).toEqual({ stage: '2d', profile: 'lite' });
    expect(effectiveQuality(below, 'high')).toEqual({ stage: '2d', profile: 'lite' });
    const full = classifyDevice(measurements());
    expect(effectiveQuality(full, 'auto')).toEqual({ stage: '3d', profile: 'standard' });
    expect(effectiveQuality(full, 'lite')).toEqual({ stage: '3d', profile: 'lite' });
    expect(effectiveQuality(full, 'high')).toEqual({ stage: '3d', profile: 'standard' });
    expect(effectiveQuality(full, 'classic')).toEqual({ stage: '2d', profile: 'lite' });
  });
});
