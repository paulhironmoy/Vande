/**
 * PERF3 (input part) and finding F-003: the same physical motion reads the same whatever the event cadence.
 *
 * Each trajectory is a 4 ms digitizer stream (250 Hz), played through the real GestureTracker:
 *   - delivered sample by sample (the reference);
 *   - frame-aligned at 120, 60 and 30 Hz, with coalesced samples and with only the newest sample of each frame;
 *   - at 30 Hz with a 20 ms dispatch delay;
 * and the same motion sampled by a sparser digitizer, every 8, 16.7, 33.3 and 50 ms.
 *
 * Coalesced samples preserve timing exactly. A sparse stream cannot locate nonlinear departure more accurately
 * than its sample interval; timing is bounded by that interval plus the 4 ms reference resolution. Class and
 * elevation remain the same, direction within 0.2°. Existing power tolerances cover endpoint/reach interpolation;
 * sparse departure/end uncertainty is additionally propagated through the logarithmic power curve. This is not
 * proof of perceptual quality: the two old sparse-power misses remain pinned below. Actual phone event capture and
 * player evaluation are still needed. Coalesced 30/60 fps equality is independently asserted.
 */
import { describe, expect, it } from 'vitest';
import { readGesture } from '@/input';
import { MIN_READ_MS, POWER_CURVE } from '@/input/constants';
import { DELIVERIES, SURFACES, bearingDiff, play, strokeSamples, tapSamples, type Played, type ProfileName, type Stroke } from './fixtures';

const T0 = 10_300;
const RATES = [8, 1000 / 60, 1000 / 30, 50];

function within(reference: Played, sampled: Played, powerTol: number, label: string, sampleIntervalMs = 0) {
  const a = reference.swing!;
  const b = sampled.swing!;
  expect(b.kind, label).toBe(a.kind);
  if (sampleIntervalMs === 0) expect(b.startT, label).toBe(a.startT);
  else expect(Math.abs(b.startT - a.startT) * 1000, `${label}: departure timing`).toBeLessThanOrEqual(sampleIntervalMs + 4 + 0.1);
  expect(b.elevation, label).toBeCloseTo(a.elevation, 2);
  expect(Math.abs(bearingDiff(b.directionDeg, a.directionDeg)), label).toBeLessThanOrEqual(0.2);
  let bound = powerTol;
  if (sampleIntervalMs > 0) {
    const ar = readGesture(reference.gesture!)!;
    const br = readGesture(sampled.gesture!)!;
    // Both endpoint events are bracketed by a sampling interval. The 4 ms
    // reference is itself sampled; two endpoint uncertainties bound duration.
    // This is a sampling-error bound, NOT a player-quality acceptance budget.
    const endpointUncertaintyMs = sampleIntervalMs + 4;
    const durationUncertaintyMs = 2 * endpointUncertaintyMs;
    expect(Math.abs(br.endMs! - ar.endMs!), `${label}: stroke end`).toBeLessThanOrEqual(endpointUncertaintyMs + 0.1);
    expect(Math.abs(br.readMs - ar.readMs), `${label}: read duration`).toBeLessThanOrEqual(durationUncertaintyMs + 0.1);
    const low = Math.max(MIN_READ_MS, ar.readMs - durationUncertaintyMs);
    const high = ar.readMs + durationUncertaintyMs;
    const logSlope = (1 - POWER_CURVE.lowPower) / Math.log(POWER_CURVE.fullSpeed / POWER_CURVE.lowSpeed);
    // The former tolerance covers endpoint/reach interpolation. Add only the
    // independently bounded duration uncertainty introduced by departure timing.
    bound += logSlope * Math.log(high / low);
  }
  expect(Math.abs(b.power - a.power), `${label}: power ${a.power} → ${b.power}`).toBeLessThanOrEqual(bound);
}

const profiles: ProfileName[] = ['easeOut', 'minJerk', 'linear'];
const bearings = [0, 45, -60, 135, 180];

describe('the same motion reads the same at every cadence (PERF3, F-003)', () => {
  const lifted: Array<[number, number]> = [
    [30, 80],
    [40, 30],
    [80, 90],
    [120, 120],
    [150, 60],
    [60, 150],
    [200, 120],
    [120, 250],
    [300, 120],
    [340, 130],
  ];

  it('a lifted swipe: stable class/direction/elevation, with bounded finite-sampling timing and power uncertainty', () => {
    for (const profile of profiles)
      for (const bearingDeg of bearings)
        for (const [lengthPx, durationMs] of lifted) {
          const st: Stroke = { lengthPx, bearingDeg, durationMs, profile };
          const ref = play(strokeSamples(st, T0));
          expect(ref.swing!.kind).toBe('attack');
          for (const d of DELIVERIES) within(ref, play(strokeSamples(st, T0), { delivery: d }), 0.02, `${profile} ${lengthPx}/${durationMs} @${bearingDeg} ${d.name}`, d.coalesced === false ? d.frameMs : 0);
          for (const rateMs of RATES) within(ref, play(strokeSamples({ ...st, rateMs }, T0)), 0.02, `${profile} ${lengthPx}/${durationMs} @${bearingDeg} every ${rateMs.toFixed(1)} ms`, rateMs);
        }
  });

  it('a press that rests, then swipes: an attack at every cadence, power exact when coalesced, within one interval’s worth otherwise', () => {
    for (const profile of profiles)
      for (const restMs of [40, 70, 100])
        for (const bearingDeg of [0, 45, -60]) {
          const st: Stroke = { lengthPx: 100, bearingDeg, durationMs: 100, restMs, profile };
          const ref = play(strokeSamples(st, T0));
          expect(ref.swing!.kind).toBe('attack');
          for (const d of DELIVERIES) {
            const tol = d.coalesced !== false ? (d.latencyMs ? 0.05 : 0.001) : (d.frameMs ?? 0) <= 1000 / 60 + 1e-9 ? 0.03 : 0.07;
            within(ref, play(strokeSamples(st, T0), { delivery: d }), tol, `rest ${restMs} ${profile} ${d.name}`, d.coalesced === false ? d.frameMs : 0);
          }
          for (const rateMs of RATES) {
            const tol = rateMs <= 1000 / 60 + 1e-9 ? 0.03 : rateMs <= 1000 / 30 + 1e-9 ? 0.07 : 0.1;
            within(ref, play(strokeSamples({ ...st, rateMs }, T0)), tol, `rest ${restMs} ${profile} every ${rateMs.toFixed(1)} ms`, rateMs);
          }
        }
  });

  it('a swipe that stops and stays: bounded endpoint/read-duration uncertainty, exact timing when coalesced', () => {
    for (const profile of profiles)
      for (const [lengthPx, durationMs] of [
        [50, 40],
        [80, 60],
        [100, 90],
      ] as const)
        for (const bearingDeg of [0, 45]) {
          const st: Stroke = { lengthPx, bearingDeg, durationMs, holdMs: 150, profile };
          const ref = play(strokeSamples(st, T0));
          for (const d of DELIVERIES) {
            const tol = d.coalesced !== false ? 0.001 : (d.frameMs ?? 0) <= 1000 / 60 + 1e-9 ? 0.05 : 0.1;
            within(ref, play(strokeSamples(st, T0), { delivery: d }), tol, `hold ${profile} ${lengthPx}/${durationMs} ${d.name}`, d.coalesced === false ? d.frameMs : 0);
          }
          for (const rateMs of [8, 1000 / 60]) within(ref, play(strokeSamples({ ...st, rateMs }, T0)), 0.05, `hold ${profile} ${lengthPx}/${durationMs} every ${rateMs.toFixed(1)} ms`, rateMs);
          within(ref, play(strokeSamples({ ...st, rateMs: 1000 / 30 }, T0)), 0.1, `hold ${profile} ${lengthPx}/${durationMs} every 33.3 ms`, 1000 / 30);
          within(ref, play(strokeSamples({ ...st, rateMs: 50 }, T0)), 0.17, `hold ${profile} ${lengthPx}/${durationMs} every 50 ms`, 50);
        }
  });

  it('a tap is a tap at every cadence, timed from the press', () => {
    for (const durationMs of [30, 60, 110, 200]) {
      const ref = play(tapSamples(T0, durationMs, { driftPx: 4 })).swing!;
      expect(ref).toMatchObject({ kind: 'defend', startT: 0.3 });
      for (const d of DELIVERIES) expect(play(tapSamples(T0, durationMs, { driftPx: 4 }), { delivery: d }).swing, `${durationMs} ms ${d.name}`).toEqual(ref);
      for (const rateMs of RATES) expect(play(tapSamples(T0, durationMs, { driftPx: 4, rateMs })).swing).toEqual(ref);
    }
  });

  it('identical timestamps give identical swings at 30 and 60 fps (frame-batched, coalesced)', () => {
    for (const st of [
      { lengthPx: 120, bearingDeg: 30, durationMs: 110 },
      { lengthPx: 320, bearingDeg: -20, durationMs: 120 },
      { lengthPx: 90, bearingDeg: 100, durationMs: 80, restMs: 60 },
      { lengthPx: 70, bearingDeg: -120, durationMs: 60, holdMs: 120 },
    ] as Stroke[]) {
      const at30 = play(strokeSamples(st, T0), { delivery: { frameMs: 1000 / 30, coalesced: true } }).swing;
      const at60 = play(strokeSamples(st, T0), { delivery: { frameMs: 1000 / 60, coalesced: true } }).swing;
      expect(at30).toEqual(at60);
    }
  });

  it('retains the two sparse-power deviations from the former press-timed quality limits (F-003 remains open)', () => {
    const lifted: Stroke = { lengthPx: 30, bearingDeg: 0, durationMs: 80, profile: 'minJerk' };
    const a = play(strokeSamples(lifted, T0)).swing!;
    const b = play(strokeSamples({ ...lifted, rateMs: 50 }, T0)).swing!;
    expect([a.power, b.power]).toEqual([0.287, 0.222]);
    expect(Math.abs(a.power - b.power)).toBeGreaterThan(0.02);
    const held: Stroke = { lengthPx: 50, bearingDeg: 0, durationMs: 40, holdMs: 150, profile: 'minJerk' };
    const c = play(strokeSamples(held, T0)).swing!;
    const d = play(strokeSamples(held, T0), { delivery: { frameMs: 1000 / 30, coalesced: false } }).swing!;
    expect([c.power, d.power]).toEqual([0.763, 0.656]);
    expect(Math.abs(c.power - d.power)).toBeGreaterThan(0.1);
  });

  it('holds on every surface, for touch, mouse and pen', () => {
    for (const [name, surface] of Object.entries(SURFACES))
      for (const pointer of ['touch', 'mouse', 'pen'] as const) {
        const st: Stroke = { lengthPx: 110, bearingDeg: 60, durationMs: 100 };
        const ref = play(strokeSamples(st, T0), { surface, pointer });
        for (const d of DELIVERIES) within(ref, play(strokeSamples(st, T0), { surface, pointer, delivery: d }), 0.02, `${name} ${pointer} ${d.name}`, d.coalesced === false ? d.frameMs : 0);
      }
  });
});
