import { describe, expect, it, vi } from 'vitest';
import type { DeviceAssessment } from '@/contracts/practice';
import { FRAME_BUDGET_MS, QUALITY_FOR_PROFILE, QualityController, PRESETS, autoQuality, shouldRender } from '@/render3d/core/quality';
import { PERF_FULL_SUSTAINED_FPS } from '@/perf';

describe('QualityController', () => {
  it('steps down one level after sustained over-budget frames, never up', () => {
    const onChange = vi.fn();
    const qc = new QualityController({ initial: 'standard', adaptive: true, onChange, graceFrames: 10, windowFrames: 30 });
    for (let i = 0; i < 10 + 30 + 20; i++) qc.sample(30);
    expect(qc.quality).toBe('low');
    expect(onChange).toHaveBeenCalledWith('low', 'low_fps');
    for (let i = 0; i < 300; i++) qc.sample(8);
    expect(qc.quality).toBe('low');
  });

  it('ignores slow frames during the grace period and when not adaptive', () => {
    const qc = new QualityController({ initial: 'standard', adaptive: true, graceFrames: 100, windowFrames: 30 });
    for (let i = 0; i < 99; i++) qc.sample(60);
    expect(qc.quality).toBe('standard');
    const fixed = new QualityController({ initial: 'high', adaptive: false, graceFrames: 0, windowFrames: 10 });
    for (let i = 0; i < 200; i++) fixed.sample(80);
    expect(fixed.quality).toBe('high');
    expect(fixed.fps).toBeCloseTo(12.5, 1);
  });

  it('does not downgrade a healthy 60 fps stream', () => {
    const qc = new QualityController({ initial: 'standard', adaptive: true, graceFrames: 5, windowFrames: 30 });
    for (let i = 0; i < 400; i++) qc.sample(16.7 + (i % 7 === 0 ? 6 : 0));
    expect(qc.quality).toBe('standard');
  });

  it('paces low mode at 30 fps', () => {
    expect(PRESETS.low.maxFps).toBe(30);
    expect(PRESETS.standard.maxFps).toBe(60);
    expect(shouldRender(100, 90, 30)).toBe(false);
    expect(shouldRender(100, 70, 30)).toBe(true);
    expect(shouldRender(100, 99, 60)).toBe(true);
  });

  it('steps down against src/perf’s frame budget, not a copy of its own', () => {
    expect(FRAME_BUDGET_MS[60]).toBeCloseTo(1000 / PERF_FULL_SUSTAINED_FPS, 9);
    expect(FRAME_BUDGET_MS[30]).toBeCloseTo(2000 / PERF_FULL_SUSTAINED_FPS, 9);
    const qc = new QualityController({ initial: 'standard', adaptive: true, graceFrames: 0, windowFrames: 30 });
    for (let i = 0; i < 200; i++) qc.sample(FRAME_BUDGET_MS[60] - 1);
    expect(qc.quality).toBe('standard');
  });

  it('starts from the device assessment src/perf measured, else from the GPU probe (never a model-name list)', () => {
    const a = (tier: DeviceAssessment['tier'], profile: DeviceAssessment['profile']) => ({ tier, profile }) as DeviceAssessment;
    expect(autoQuality(a('full', 'high'), '')).toBe('high');
    expect(autoQuality(a('full', 'standard'), '')).toBe('standard');
    expect(autoQuality(a('assisted', 'lite'), '')).toBe('low');
    expect(autoQuality(a('below', 'lite'), 'Adreno (TM) 730')).toBe('low');
    expect(autoQuality(null, 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver)')).toBe('low');
    expect(autoQuality(null, 'Mali-G52 MC2')).toBe('standard');
    expect(QUALITY_FOR_PROFILE).toEqual({ lite: 'low', standard: 'standard', high: 'high' });
  });
});
