/**
 * The highlight's soundtrack: the same original synthesised sounds as the in-app replay (crowd bed, bat, stumps,
 * roars, drums, fireworks, the seal chime), scheduled on the highlight's own clock and rendered with an
 * OfflineAudioContext. The action and the crowd bed render to separate channels, so the bed can be set a fixed
 * distance under the action (MIX.bedBelowLu) before the mix is normalised to about -14 LUFS with a -1 dBTP ceiling
 * (YouTube's playback level, with room for the AAC encode). Deterministic (seeded noise, no wall clock); exactly
 * `durationMs` long.
 */
import type { Segment, Timeline } from '@/render3d/core/timeline';
import { timelineTimeOf } from '@/render3d/core/timeline';
import { crowdAt } from '@/render3d/core/choreo';
import { makeNoise, voices, type VoiceTarget } from '@/audio/voices';
import { playCue } from '@/audio/match';
import { applyCompressor, MIX } from '@/audio/mix';
import { integratedLoudness, measure, normalise, type LoudnessReport } from '@/audio/loudness';
import type { HighlightPlan } from './plan';

export const AUDIO_RATE = 44100;

/** Rendered PCM, shaped like the parts of an AudioBuffer that wavBase64 reads. */
export interface PcmAudio {
  sampleRate: number;
  length: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
  /** The mastered result, and the balance applied (for tests and the render log). */
  loudness: LoudnessReport & { bedGainDb: number; gainDb: number; limitedDb: number };
}

export async function renderHighlightAudio(plan: HighlightPlan, tl: Timeline, sampleRate = AUDIO_RATE): Promise<PcmAudio> {
  const length = Math.round((plan.durationMs / 1000) * sampleRate);
  // Channel 0: the action through its compressor. Channel 1: the crowd bed. Every voice is mono.
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const merger = ctx.createChannelMerger(2);
  merger.connect(ctx.destination);
  const action = ctx.createGain();
  action.connect(applyCompressor(ctx.createDynamicsCompressor(), MIX.action)).connect(merger, 0, 0);
  const noise = makeNoise(ctx, 3);
  const v: VoiceTarget = { ctx, out: action, noise };

  // Crowd bed (three filtered noise bands), automated from the replay's crowd envelope inside ball clips.
  const bed = ctx.createGain();
  bed.gain.value = 0.0001;
  bed.connect(merger, 0, 1);
  for (const [freq, q, level] of [
    [380, 0.5, 0.55],
    [950, 0.7, 0.35],
    [2200, 1.1, 0.12],
  ] as const) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = level;
    src.connect(f).connect(g).connect(bed);
    src.start(0, freq / 1000);
  }

  const segAt = (r: number): Segment | null => tl.segments.find((s) => r >= s.t0 && r < s.t0 + s.dur) ?? null;
  for (const sc of plan.scenes) {
    const start = sc.t0 / 1000;
    if ((sc.kind === 'ball' || sc.kind === 'hook') && sc.seg !== undefined) {
      const seg = tl.segments[sc.seg];
      for (let local = 0; local < sc.t1 - sc.t0; local += 250) {
        const r = Math.min(sc.r1, sc.r0 + local);
        const s = segAt(r) ?? seg;
        bed.gain.setValueAtTime(0.03 + crowdAt(s.script, s.sceneStart + Math.max(0, r - s.t0)) * 0.13, (sc.t0 + local) / 1000);
      }
      for (const e of seg.script.events) {
        if (e.t < seg.sceneStart || e.t > seg.sceneEnd) continue;
        const r = timelineTimeOf(seg, e.t);
        if (r < sc.r0 || r > sc.r1) continue;
        const slow = seg.slow && e.t >= seg.slow.t0 && e.t < seg.slow.t1 ? seg.slow.rate : 1;
        playCue(v, e.kind, e.intensity, (sc.t0 + (r - sc.r0)) / 1000, slow);
      }
    } else {
      // Cards: a low, steady crowd and one sound each.
      bed.gain.setValueAtTime(sc.kind === 'result' ? 0.11 : 0.04, start);
      if (sc.kind === 'intro') voices.seal(v, start + 0.25);
      if (sc.kind === 'result') {
        voices.roar(v, start + 0.15, 0.9, 3.2);
        voices.fireworks(v, start + 0.6, 0.8);
      }
      if (sc.kind === 'potm') voices.drums(v, start + 0.1, 0.7);
      if (sc.kind === 'cta') voices.seal(v, start + 0.2);
    }
  }
  const rendered = await ctx.startRendering();
  return masterHighlight(rendered.getChannelData(0), rendered.getChannelData(1), sampleRate);
}

/**
 * Balances the bed under the action, normalises the mix (about -14 LUFS, at most -1 dBTP) and fades out over the
 * last second. The voices are mono, so both output channels carry the same signal.
 */
export function masterHighlight(action: Float32Array, bed: Float32Array, sampleRate: number): PcmAudio {
  const la = integratedLoudness([action], sampleRate);
  const lb = integratedLoudness([bed], sampleRate);
  const bedGainDb = Number.isFinite(la) && Number.isFinite(lb) ? la - MIX.bedBelowLu - lb : 0;
  const bedGain = 10 ** (bedGainDb / 20);
  const n = action.length;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = action[i] + bed[i] * bedGain;
  // Two identical channels measure 3.01 dB louder than one: normalise the mono signal to the stereo target.
  const r = normalise([mono], sampleRate, { target: -14 - 10 * Math.log10(2) });
  const out = r.channels[0];
  const fade = Math.min(n, Math.round(sampleRate));
  for (let i = 0; i < fade; i++) out[n - fade + i] *= 1 - (i + 1) / fade;
  // As delivered (after the fade), for the stereo file.
  const final = measure([out], sampleRate);
  return {
    sampleRate,
    length: n,
    numberOfChannels: 2,
    getChannelData: () => out,
    loudness: { integrated: final.integrated + 10 * Math.log10(2), truePeak: final.truePeak, samplePeak: final.samplePeak, bedGainDb, gainDb: r.gainDb, limitedDb: r.limitedDb },
  };
}

/** 16-bit PCM WAV, base64 (what the render service muxes). */
export function wavBase64(buf: { sampleRate: number; length: number; numberOfChannels: number; getChannelData(channel: number): Float32Array }): string {
  const ch = Math.min(2, buf.numberOfChannels);
  const n = buf.length;
  const bytes = new Uint8Array(44 + n * ch * 2);
  const view = new DataView(bytes.buffer);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  view.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, ch, true);
  view.setUint32(24, buf.sampleRate, true);
  view.setUint32(28, buf.sampleRate * ch * 2, true);
  view.setUint16(32, ch * 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, n * ch * 2, true);
  const data = [buf.getChannelData(0), buf.getChannelData(ch > 1 ? 1 : 0)];
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
