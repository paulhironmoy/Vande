import { describe, expect, it } from 'vitest';
import { UnityPracticeClock } from '@/practice/unity';

describe('Unity Practice monotonic clock', () => {
  it('requires three observations and selects the lowest-RTT sample from five', () => {
    const clock = new UnityPracticeClock();
    const rtts = [12, 4, 10, 8, 6];
    for (let index = 0; index < rtts.length; index += 1) {
      const hostSendPerfMs = 1_000 + index * 100;
      const roundTripMs = rtts[index];
      const unityReceiveMs = hostSendPerfMs - 50 + roundTripMs / 2;
      const estimate = clock.add({
        sampleId: `sample-${index + 1}`,
        hostSendPerfMs,
        unityReceiveMs,
        unitySendMs: unityReceiveMs + 1,
        hostReceivePerfMs: hostSendPerfMs + roundTripMs + 1,
      });
      expect(estimate.hostMinusUnityMs).toBe(50);
      expect(clock.ready).toBe(index >= 2);
    }

    expect(clock.complete).toBe(true);
    expect(clock.selected?.sampleId).toBe('sample-2');
    expect(clock.selected?.roundTripMs).toBe(4);
    expect(clock.toHostPerfMs(2_000)).toBe(2_050);
  });

  it('rejects duplicate, backwards and impossible samples', () => {
    const clock = new UnityPracticeClock();
    clock.add({ sampleId: 'one', hostSendPerfMs: 100, unityReceiveMs: 50, unitySendMs: 51, hostReceivePerfMs: 110 });
    expect(() =>
      clock.add({
        sampleId: 'one',
        hostSendPerfMs: 200,
        unityReceiveMs: 150,
        unitySendMs: 151,
        hostReceivePerfMs: 210,
      }),
    ).toThrow(/unique/);
    expect(() =>
      clock.add({ sampleId: 'two', hostSendPerfMs: 90, unityReceiveMs: 160, unitySendMs: 161, hostReceivePerfMs: 220 }),
    ).toThrow(/monotonic order/);
    expect(() =>
      new UnityPracticeClock().add({
        sampleId: 'impossible',
        hostSendPerfMs: 100,
        unityReceiveMs: 40,
        unitySendMs: 63,
        hostReceivePerfMs: 110,
      }),
    ).toThrow(/processing/);
  });

  it('clamps only bounded cross-runtime timestamp quantization to zero delay', () => {
    const estimate = new UnityPracticeClock().add({
      sampleId: 'sub-millisecond-webgl',
      hostSendPerfMs: 1_345.2008,
      unityReceiveMs: 82.9999,
      unitySendMs: 83.9999,
      hostReceivePerfMs: 1_346.1,
    });

    expect(estimate.roundTripMs).toBe(0);
    expect(estimate.hostMinusUnityMs).toBeCloseTo(1_262.1505, 4);
  });
});
