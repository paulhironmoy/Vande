/**
 * Synthesised cricket sounds (original, no recordings). Every voice schedules Web Audio nodes at `when` on any
 * BaseAudioContext, so the same code plays live and renders offline (OfflineAudioContext) for highlight videos.
 * `pitch` < 1 lowers and lengthens impacts for slow motion.
 */
import { Sfc32, createRng } from '@/engine/prng';

export interface VoiceTarget {
  ctx: BaseAudioContext;
  out: AudioNode;
  noise: AudioBuffer;
}

export function makeNoise(ctx: BaseAudioContext, seconds = 2): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // Deterministic white noise from the engine's PRNG (src/engine/prng.ts), so offline renders are reproducible.
  const s = createRng(0x9e3779b9);
  const g = new Sfc32(s.a, s.b, s.c, s.d);
  for (let i = 0; i < len; i++) d[i] = g.float() * 2 - 1;
  return buf;
}

function env(g: GainNode, when: number, attack: number, peak: number, decay: number) {
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
}

function noiseBurst(v: VoiceTarget, when: number, opts: { type: BiquadFilterType; freq: number; q: number; attack: number; decay: number; gain: number; offset?: number }) {
  const { ctx } = v;
  const src = ctx.createBufferSource();
  src.buffer = v.noise;
  const f = ctx.createBiquadFilter();
  f.type = opts.type;
  f.frequency.value = opts.freq;
  f.Q.value = opts.q;
  const g = ctx.createGain();
  env(g, when, opts.attack, opts.gain, opts.decay);
  src.connect(f).connect(g).connect(v.out);
  src.start(when, opts.offset ?? 0.1 + ((when * 7.3) % 1.5));
  src.stop(when + opts.attack + opts.decay + 0.05);
}

function tone(v: VoiceTarget, when: number, freq: number, opts: { type?: OscillatorType; attack?: number; decay: number; gain: number; glideTo?: number }) {
  const { ctx } = v;
  const o = ctx.createOscillator();
  o.type = opts.type ?? 'sine';
  o.frequency.setValueAtTime(freq, when);
  if (opts.glideTo) o.frequency.exponentialRampToValueAtTime(opts.glideTo, when + (opts.attack ?? 0.004) + opts.decay);
  const g = ctx.createGain();
  env(g, when, opts.attack ?? 0.004, opts.gain, opts.decay);
  o.connect(g).connect(v.out);
  o.start(when);
  o.stop(when + (opts.attack ?? 0.004) + opts.decay + 0.05);
}

export const voices = {
  release(v: VoiceTarget, when: number, intensity: number) {
    noiseBurst(v, when, { type: 'bandpass', freq: 900 + intensity * 900, q: 0.8, attack: 0.05, decay: 0.22, gain: 0.08 + intensity * 0.06 });
  },
  bounce(v: VoiceTarget, when: number, _i: number, pitch = 1) {
    tone(v, when, 120 * pitch, { decay: 0.09 / pitch, gain: 0.35 });
    noiseBurst(v, when, { type: 'lowpass', freq: 1400 * pitch, q: 0.7, attack: 0.002, decay: 0.05 / pitch, gain: 0.18 });
  },
  /** Willow on leather: a sharp transient, two body resonances and a low thump. */
  bat(v: VoiceTarget, when: number, intensity: number, pitch = 1) {
    const k = 0.55 + intensity * 0.45;
    noiseBurst(v, when, { type: 'bandpass', freq: 3200 * pitch, q: 1.2, attack: 0.0015, decay: 0.035 / pitch, gain: 0.9 * k });
    tone(v, when, 820 * pitch, { decay: 0.11 / pitch, gain: 0.32 * k, type: 'triangle' });
    tone(v, when, 1760 * pitch, { decay: 0.06 / pitch, gain: 0.18 * k });
    tone(v, when, 140 * pitch, { decay: 0.12 / pitch, gain: 0.3 * k });
  },
  edge(v: VoiceTarget, when: number, intensity: number, pitch = 1) {
    noiseBurst(v, when, { type: 'highpass', freq: 3800 * pitch, q: 0.9, attack: 0.001, decay: 0.025 / pitch, gain: 0.5 * (0.5 + intensity * 0.5) });
    tone(v, when, 1300 * pitch, { decay: 0.04 / pitch, gain: 0.12 });
  },
  pad(v: VoiceTarget, when: number, intensity: number, pitch = 1) {
    noiseBurst(v, when, { type: 'lowpass', freq: 520 * pitch, q: 0.7, attack: 0.003, decay: 0.12 / pitch, gain: 0.55 * (0.6 + intensity * 0.4) });
    tone(v, when, 95 * pitch, { decay: 0.1 / pitch, gain: 0.28 });
  },
  /** Stumps clattering: several wooden knocks. */
  stumps(v: VoiceTarget, when: number, intensity: number, pitch = 1) {
    const knocks = [0, 0.034, 0.071, 0.118];
    knocks.forEach((dt, i) => {
      tone(v, when + dt / pitch, (640 + i * 95) * pitch, { decay: 0.07 / pitch, gain: (0.42 - i * 0.07) * intensity, type: 'triangle' });
      noiseBurst(v, when + dt / pitch, { type: 'bandpass', freq: 2100 * pitch, q: 2, attack: 0.001, decay: 0.03 / pitch, gain: 0.25 * intensity });
    });
  },
  /** Bails flying off LED stumps: two light clicks and a rising electronic zing. */
  bails(v: VoiceTarget, when: number, _i: number, pitch = 1) {
    tone(v, when, 2600 * pitch, { decay: 0.02, gain: 0.16 });
    tone(v, when + 0.045, 2900 * pitch, { decay: 0.02, gain: 0.12 });
    tone(v, when + 0.02, 1500 * pitch, { decay: 0.32, gain: 0.07, glideTo: 3200 * pitch, type: 'sawtooth' });
  },
  gloves(v: VoiceTarget, when: number, intensity: number, pitch = 1) {
    noiseBurst(v, when, { type: 'lowpass', freq: 900 * pitch, q: 0.9, attack: 0.002, decay: 0.07, gain: 0.5 * (0.5 + intensity * 0.5) });
    tone(v, when, 260 * pitch, { decay: 0.06, gain: 0.2 });
  },
  catch(v: VoiceTarget, when: number, intensity: number, pitch = 1) {
    voices.gloves(v, when, intensity, pitch);
  },
  fielded(v: VoiceTarget, when: number, intensity: number) {
    noiseBurst(v, when, { type: 'lowpass', freq: 700, q: 0.8, attack: 0.003, decay: 0.08, gain: 0.25 * intensity });
  },
  throw(v: VoiceTarget, when: number) {
    noiseBurst(v, when, { type: 'bandpass', freq: 1400, q: 1, attack: 0.03, decay: 0.16, gain: 0.07 });
  },
  /** Crowd swell: the stadium erupts. */
  roar(v: VoiceTarget, when: number, intensity: number, length = 2.6) {
    const { ctx } = v;
    for (const [freq, q, gain] of [
      [520, 0.6, 0.38],
      [1250, 0.8, 0.28],
      [2600, 1.1, 0.12],
    ] as const) {
      const src = ctx.createBufferSource();
      src.buffer = v.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(gain * intensity, when + 0.35);
      g.gain.setValueAtTime(gain * intensity, when + length * 0.45);
      g.gain.exponentialRampToValueAtTime(0.0001, when + length);
      src.connect(f).connect(g).connect(v.out);
      src.start(when, (freq / 1000) % 1.5);
      src.stop(when + length + 0.1);
    }
  },
  /** A celebratory drum pattern (generic dhol-style rhythm, synthesised). */
  drums(v: VoiceTarget, when: number, intensity: number) {
    const pattern = [0, 0.18, 0.36, 0.45, 0.63, 0.81, 0.9, 1.08, 1.26, 1.35];
    pattern.forEach((dt, i) => {
      const low = i % 3 !== 2;
      tone(v, when + dt, low ? 92 : 210, { decay: low ? 0.22 : 0.09, gain: (low ? 0.42 : 0.24) * intensity, glideTo: low ? 62 : 180 });
      if (!low) noiseBurst(v, when + dt, { type: 'bandpass', freq: 2400, q: 1.4, attack: 0.001, decay: 0.05, gain: 0.12 * intensity });
    });
  },
  fireworks(v: VoiceTarget, when: number, intensity: number) {
    for (let i = 0; i < 3; i++) {
      const t = when + i * 0.38;
      tone(v, t, 58, { decay: 0.5, gain: 0.32 * intensity, glideTo: 38 });
      for (let k = 0; k < 9; k++) noiseBurst(v, t + 0.12 + k * 0.045 + ((k * 37) % 7) * 0.006, { type: 'highpass', freq: 3000 + k * 120, q: 0.7, attack: 0.001, decay: 0.03, gain: 0.08 * intensity });
    }
  },
  /** The swing itself: a short airy swish (heard at the tap, before anything else is known). */
  swish(v: VoiceTarget, when: number, intensity = 0.7) {
    noiseBurst(v, when, { type: 'bandpass', freq: 2300, q: 0.9, attack: 0.012, decay: 0.09, gain: 0.22 * intensity });
    noiseBurst(v, when + 0.02, { type: 'highpass', freq: 4200, q: 0.7, attack: 0.008, decay: 0.06, gain: 0.08 * intensity });
  },
  /** The middle of the bat: a bright ring that says "sweet spot" (brighter and longer for perfect timing). */
  ring(v: VoiceTarget, when: number, perfect: boolean) {
    tone(v, when, perfect ? 1568 : 1318.5, { decay: perfect ? 0.38 : 0.24, gain: perfect ? 0.13 : 0.09, type: 'sine' });
    if (perfect) tone(v, when + 0.05, 2349.3, { decay: 0.3, gain: 0.05, type: 'sine' });
  },
  /** The held breath before a result: the crowd hushes while a low riser builds. */
  tension(v: VoiceTarget, when: number, length = 1.5) {
    const { ctx } = v;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(55, when);
    o.frequency.exponentialRampToValueAtTime(110, when + length);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(240, when);
    f.frequency.exponentialRampToValueAtTime(1800, when + length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.16, when + length * 0.92);
    g.gain.exponentialRampToValueAtTime(0.0001, when + length + 0.05);
    o.connect(f).connect(g).connect(v.out);
    o.start(when);
    o.stop(when + length + 0.1);
    // A heartbeat under it.
    for (let k = 0; k * 0.5 < length - 0.2; k++) tone(v, when + k * 0.5, 62, { decay: 0.16, gain: 0.22 + k * 0.03, glideTo: 48 });
  },
  /** The result lands: one big hit and a crowd swell. */
  resultHit(v: VoiceTarget, when: number) {
    tone(v, when, 82, { decay: 0.6, gain: 0.5, glideTo: 44 });
    noiseBurst(v, when, { type: 'lowpass', freq: 900, q: 0.7, attack: 0.002, decay: 0.3, gain: 0.35 });
    voices.roar(v, when + 0.05, 0.9, 3);
  },
  /** Sealed: the brand chime when an over locks or a shot is sealed. */
  seal(v: VoiceTarget, when: number) {
    tone(v, when, 659.25, { decay: 0.22, gain: 0.16, type: 'triangle' });
    tone(v, when + 0.09, 987.77, { decay: 0.42, gain: 0.14, type: 'triangle' });
    tone(v, when + 0.09, 1975.5, { decay: 0.2, gain: 0.03 });
  },
};
