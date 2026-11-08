/**
 * The crowd bed: a continuous murmur, three band-passed noise layers that breathe on slow LFOs, through a brightness
 * low-pass (a hushed crowd is muffled, an excited one bright) into the bed bus. Built once per context, off the input
 * path. In Practice it follows the emotion machine's base curve exactly: each transition schedules the same
 * exponential approach (and the relaxation after its hold) as AudioParam targets, so it needs no frames and keeps
 * moving in Delivery Quiet Mode. The reactions themselves are one-shots on the crowd bus (src/audio/bank.ts).
 */
import { baseLevel, clamp01, type EmotionState } from './emotionCore';
import type { LiveGraph } from './engine';
import { logAudio } from './timingLog';

/** Practice: the bed's gain for an arousal level (the murmur 0.3 → about 0.04, the breath 0.07 → about 0.011). */
export const bedGain = (level: number) => 0.005 + 0.16 * Math.pow(clamp01(level), 1.25);
/** Practice: the bed's brightness for an arousal level (Hz). */
export const bedBrightness = (level: number) => 600 + 3400 * clamp01(level);

interface Bed {
  gain: GainNode;
  tone: BiquadFilterNode;
  lastGain: number;
}

let bed: Bed | null = null;
let bedCtx: BaseAudioContext | null = null;

function start(g: LiveGraph): Bed {
  if (bed && bedCtx === g.ctx) return bed;
  const ctx = g.ctx;
  const gain = ctx.createGain();
  gain.gain.value = 0.0001;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 12000;
  tone.Q.value = 0.5;
  tone.connect(gain).connect(g.bedInput);
  for (const [freq, q, level, lfoHz] of [
    [380, 0.5, 0.55, 0.13],
    [950, 0.7, 0.35, 0.21],
    [2200, 1.1, 0.12, 0.31],
  ] as const) {
    const src = ctx.createBufferSource();
    src.buffer = g.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const layer = ctx.createGain();
    layer.gain.value = level;
    // A slow swell, so the bed breathes like a real crowd.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = lfoHz;
    const depth = ctx.createGain();
    depth.gain.value = level * 0.35;
    lfo.connect(depth).connect(layer.gain);
    lfo.start();
    src.connect(f).connect(layer).connect(tone);
    src.start(0, freq / 1000);
  }
  bed = { gain, tone, lastGain: 0.0001 };
  bedCtx = ctx;
  return bed;
}

/** Builds the bed in idle time (silent until a curve or a level asks for it), so no delivery pays for its nodes. */
export function warmBed(g: LiveGraph): void {
  try {
    start(g);
  } catch {
    /* idle-time warm-up never throws: the bed is built on first use instead */
  }
}

/** Follows a gain smoothly (Sealed Six's renderer envelope, and Practice before its first moment). */
export function followGain(g: LiveGraph, gain: number, brightness = 12000): void {
  const b = start(g);
  if (Math.abs(gain - b.lastGain) < 0.001) return;
  b.lastGain = gain;
  const t = g.ctx.currentTime;
  b.gain.gain.setTargetAtTime(gain, t, 0.25);
  b.tone.frequency.setTargetAtTime(brightness, t, 0.25);
}

/**
 * Schedules the machine's base curve from `nowPerf`: where it is now, its approach to the target from the transition
 * (at context time `atCtx`), and after a finite hold the relaxation to the resting murmur.
 */
export function followCurve(g: LiveGraph, s: Readonly<EmotionState>, nowPerf: number, atCtx: number): void {
  const b = start(g);
  const ctx = g.ctx;
  const t = ctx.currentTime;
  const cur = baseLevel(s, nowPerf);
  const at = atCtx > t ? atCtx : t;
  schedule(b.gain.gain, bedGain, s, cur, t, at);
  schedule(b.tone.frequency, bedBrightness, s, cur, t, at);
  b.lastGain = bedGain(s.to);
  logAudio('crowd', 'bed', nowPerf + Math.max(0, at - t) * 1000, { ctx, ctxTime: at, level: s.to, bus: 'bed' });
}

function schedule(param: AudioParam, map: (level: number) => number, s: Readonly<EmotionState>, cur: number, t: number, at: number) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(map(cur), t);
  param.setTargetAtTime(map(s.to), at, s.tau / 1000);
  if (Number.isFinite(s.hold)) param.setTargetAtTime(map(s.rest), at + s.hold / 1000, s.relax / 1000);
}

/** Back from the background: the bed goes straight to where the curve is now (nothing frozen from before). */
export function resyncBed(g: LiveGraph, s: Readonly<EmotionState>, nowPerf: number): void {
  if (!bed || bedCtx !== g.ctx) return;
  followCurve(g, s, nowPerf, g.ctx.currentTime);
}

/** Fades the bed out (a stage disposed). */
export function fadeBed(g: LiveGraph): void {
  if (!bed || bedCtx !== g.ctx) return;
  bed.gain.gain.setTargetAtTime(0.0001, g.ctx.currentTime, 0.2);
  bed.lastGain = 0.0001;
}
