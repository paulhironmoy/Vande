/**
 * The haptic map (constitution §12; src/audio/feel.ts and haptics.ts): one pattern per event, contact in proportion
 * to quality, an edge distinct and light, a six stronger than a four, mastery restrained; native steps through
 * Capacitor Haptics (impacts and very short vibrations), nothing while Vibration is off or the app is hidden.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('@capacitor/haptics', () => ({
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
  NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
  Haptics: {
    impact: async ({ style }: { style: string }) => void native.calls.push(`impact:${style}`),
    vibrate: async ({ duration }: { duration: number }) => void native.calls.push(`vibrate:${duration}`),
    notification: async ({ type }: { type: string }) => void native.calls.push(`notification:${type}`),
  },
}));

import { FEEL_PATTERNS, practiceContactFeel, type FeelPattern } from '@/audio/feel';
import { hapticPattern, playFeel, setHapticsEnabled, setHapticsNative } from '@/audio/haptics';

const onTime = (p: FeelPattern) => FEEL_PATTERNS[p].web.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);

describe('the haptic map', () => {
  it('every §12 moment has its own pattern; each lasts exactly its vibrate pattern', () => {
    for (const [name, spec] of Object.entries(FEEL_PATTERNS)) {
      expect(spec.web.length % 2, name).toBe(1);
      expect(spec.web.every((ms) => ms > 0)).toBe(true);
      expect(
        spec.web.reduce((a, b) => a + b, 0),
        name,
      ).toBe(spec.ms);
      expect(spec.native.length).toBeGreaterThan(0);
    }
    // The original three are unchanged (Sealed Six batting depends on them).
    expect(FEEL_PATTERNS.tick.web).toEqual([10]);
    expect(FEEL_PATTERNS.pulse.web).toEqual([24]);
    expect(FEEL_PATTERNS.double.web).toEqual([32, 70, 14]);
  });

  it('contact in proportion to quality; edges distinct and light; nothing for a leave or a miss', () => {
    expect(practiceContactFeel('middle', 'perfect')).toBe('double');
    expect(practiceContactFeel('middle', 'solid')).toBe('pulse');
    expect(practiceContactFeel('middle', 'mistimed')).toBe('soft');
    for (const edge of ['inside_edge', 'outside_edge', 'top_edge', 'leading_edge'] as const)
      expect(practiceContactFeel(edge)).toBe('tick');
    expect(practiceContactFeel('pad')).toBe('tap');
    expect(practiceContactFeel('miss')).toBeNull();
    expect(practiceContactFeel('leave')).toBeNull();
    expect(onTime('soft')).toBeLessThan(onTime('pulse'));
    expect(onTime('pulse')).toBeLessThan(onTime('double'));
    expect(onTime('tick')).toBeLessThan(onTime('soft'));
  });

  it('subtle where it should be, stronger where it should be', () => {
    // Release (optional): the subtlest; a close call restrained; mastery restrained success.
    expect(onTime('whisper')).toBeLessThan(onTime('restrained'));
    expect(onTime('restrained')).toBeLessThan(onTime('tick'));
    expect(onTime('mastery')).toBeLessThan(onTime('confirm'));
    // A six is a stronger confirmation than a four; a wicket is decisive.
    expect(onTime('confirm_strong')).toBeGreaterThan(onTime('confirm'));
    expect(onTime('decisive')).toBeGreaterThan(onTime('sharp'));
    expect(FEEL_PATTERNS.decisive.native[0]).toEqual([0, 'heavy']);
    expect(FEEL_PATTERNS.whisper.native[0]).toEqual([0, 'vibrate', 5]);
  });
});

describe('playing patterns', () => {
  beforeEach(() => {
    native.calls = [];
    vi.useFakeTimers();
    setHapticsEnabled(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    setHapticsNative(false);
    setHapticsEnabled(true);
  });

  it('native steps: impacts at their offsets and very short vibrations', async () => {
    setHapticsNative(true);
    // The first pattern loads Capacitor Haptics; from then on every step is scheduled at once.
    hapticPattern('tick');
    await vi.dynamicImportSettled();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(native.calls).toEqual(['impact:LIGHT']);
    native.calls = [];
    hapticPattern('decisive');
    expect(native.calls).toEqual(['impact:HEAVY']);
    vi.advanceTimersByTime(119);
    expect(native.calls).toEqual(['impact:HEAVY']);
    vi.advanceTimersByTime(1);
    expect(native.calls).toEqual(['impact:HEAVY', 'impact:MEDIUM']);
    hapticPattern('whisper');
    expect(native.calls.at(-1)).toBe('vibrate:5');
  });

  it('the web vibrates the pattern; nothing while Vibration is off or the app is hidden', () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    playFeel('confirm_strong');
    expect(vibrate).toHaveBeenLastCalledWith([24, 70, 24, 70, 14]);
    vibrate.mockClear();
    setHapticsEnabled(false);
    vi.advanceTimersByTime(1000);
    playFeel('confirm');
    hapticPattern('confirm');
    expect(vibrate).not.toHaveBeenCalled();
    setHapticsEnabled(true);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    vi.advanceTimersByTime(1000);
    hapticPattern('confirm');
    expect(vibrate).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });
});
