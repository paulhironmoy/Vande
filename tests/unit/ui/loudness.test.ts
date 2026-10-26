/**
 * Loudness (ITU-R BS.1770-4): reference tones measure what the standard says, the true peak sees between samples,
 * and the highlight master lands at about -14 LUFS with its true peak at or under -1 dBTP and the crowd bed 8 LU
 * under the action.
 */
import { describe, expect, it } from 'vitest';
import { integratedLoudness, measure, normalise } from '@/audio/loudness';
import { masterHighlight } from '@/highlight/audio';

const sine = (f: number, a: number, secs: number, sr: number, phase = 0) => {
  const x = new Float32Array(Math.round(secs * sr));
  for (let i = 0; i < x.length; i++) x[i] = a * Math.sin((2 * Math.PI * f * i) / sr + phase);
  return x;
};

/** Seeded: a quiet bed with sharp, sparse hits (like a match: cracks, stumps, roars). */
function matchLike(sr: number, secs: number) {
  const n = Math.round(sr * secs);
  const action = new Float32Array(n);
  const bed = new Float32Array(n);
  let x = 0x2545f491;
  const rnd = () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) / 4294967296) * 2 - 1;
  };
  for (let i = 0; i < n; i++) bed[i] = rnd() * 0.02;
  for (let hit = 0.5; hit < secs - 0.5; hit += 1.7) {
    const at = Math.round(hit * sr);
    for (let k = 0; k < sr * 0.25 && at + k < n; k++) action[at + k] += rnd() * 0.6 * Math.exp(-k / (sr * 0.03));
  }
  return { action, bed };
}

describe('loudness', () => {
  it('measures the BS.1770 reference tones', () => {
    const s = sine(997, 0.1, 10, 48000);
    expect(integratedLoudness([s, s], 48000)).toBeCloseTo(-20, 1);
    expect(integratedLoudness([sine(997, 1, 10, 48000)], 48000)).toBeCloseTo(-3.01, 1);
    const s44 = sine(997, 0.1, 10, 44100);
    expect(integratedLoudness([s44, s44], 44100)).toBeCloseTo(-20, 1);
    // Gating: a long silence does not drag the reading down.
    const gated = new Float32Array(48000 * 20);
    gated.set(s, 0);
    expect(Math.abs(integratedLoudness([gated, gated], 48000) - -20)).toBeLessThan(0.1);
    expect(integratedLoudness([new Float32Array(48000)], 48000)).toBe(-Infinity);
  });

  it('finds the true peak between samples', () => {
    // A quarter-rate sine at 45 degrees: every sample sits at 0.707 of the real peak.
    const x = sine(12000, 0.5, 1, 48000, Math.PI / 4);
    const m = measure([x], 48000);
    expect(m.samplePeak).toBeCloseTo(-9.03, 1);
    expect(Math.abs(m.truePeak - -6.02)).toBeLessThan(0.15);
  });

  it('normalises to the target with the true peak under the ceiling', () => {
    const sr = 44100;
    const { action, bed } = matchLike(sr, 20);
    const mix = action.map((v, i) => v + bed[i]);
    const r = normalise([mix, mix], sr);
    expect(Math.abs(r.after.integrated - -14)).toBeLessThan(0.5);
    expect(r.after.truePeak).toBeLessThanOrEqual(-1);
  });

  it('masters the highlight: bed 8 LU under the action, about -14 LUFS, at most -1 dBTP, a clean fade', () => {
    const sr = 44100;
    const { action, bed } = matchLike(sr, 30);
    const la = integratedLoudness([action], sr);
    const lb = integratedLoudness([bed], sr);
    const out = masterHighlight(action, bed, sr);
    expect(out.loudness.bedGainDb).toBeCloseTo(la - 8 - lb, 5);
    expect(Math.abs(out.loudness.integrated - -14)).toBeLessThan(0.5);
    expect(out.loudness.truePeak).toBeLessThanOrEqual(-1);
    const ch = out.getChannelData(0);
    expect(out.getChannelData(1)).toBe(ch);
    expect(Math.abs(ch[ch.length - 1])).toBeLessThan(1e-3);
    expect(measure([ch, ch], sr).integrated).toBeCloseTo(out.loudness.integrated, 1);
  });
});
