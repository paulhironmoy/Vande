/**
 * Game sound design for VANDE Lite: synthesised, no audio files, no network.
 *
 * Gating mirrors the app's cue system (src/audio/sounds.ts): nothing plays until the first user gesture
 * (browser autoplay policy) and nothing plays while the Sound setting is off (`isSoundEnabled()`).
 * The AudioContext is created lazily on the first unlocked call, so no autoplay warnings are logged.
 *
 * Signal chain: voices → bus → compressor → master (≈ 0.12) → destination,
 *               bus → feedback delay "room" (90 ms, fb 0.18, lowpassed) → wet (0.12) → compressor.
 * Voices are sine/triangle partials with 3–15 ms attacks and exponential decays: soft, bell-like, never square-wave beeps.
 */
import { isSoundEnabled } from './sounds';

export type GameSound = 'select' | 'correct' | 'great' | 'wrong' | 'coin' | 'streak' | 'squash' | 'scan' | 'star' | 'mission' | 'win' | 'lose' | 'flip';

export interface GameSoundOptions {
  /** 0-based level: raises pitch for successive stars or streak levels. */
  step?: number;
  /** 0..1 loudness scale (default 1). */
  intensity?: number;
}

interface Graph {
  ctx: AudioContext;
  bus: GainNode;
}

const RATE_LIMIT_MS = 50;
const MASTER_GAIN = 0.12;

let graph: Graph | null = null;
let unlocked = false;
let listenersInstalled = false;
let noise: AudioBuffer | null = null;
let lastPlayed: Partial<Record<GameSound, number>> = {};

/** MIDI note number → frequency in Hz. */
function hz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const N = {
  A2: 45,
  C5: 72,
  E5: 76,
  F5: 77,
  G5: 79,
  A5: 81,
  B5: 83,
  C6: 84,
  E6: 88,
  G6: 91,
  B6: 95,
  C7: 96,
  D7: 98,
  E7: 100,
} as const;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function hasUserActivation(): boolean {
  try {
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { userActivation?: { hasBeenActive?: boolean } }) : undefined;
    return Boolean(nav?.userActivation?.hasBeenActive);
  } catch {
    return false;
  }
}

function installUnlockListeners(): void {
  if (listenersInstalled || typeof window === 'undefined') return;
  listenersInstalled = true;
  const unlock = () => {
    unlocked = true;
    const g = ensureGraph();
    if (g && g.ctx.state === 'suspended' && isSoundEnabled()) void g.ctx.resume().catch(() => undefined);
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
}

// Install as soon as this module is imported so the very first gesture on the page counts.
installUnlockListeners();

function ensureGraph(): Graph | null {
  if (graph) return graph;
  if (typeof window === 'undefined') return null;
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    comp.connect(master);
    master.connect(ctx.destination);

    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(comp);

    // A small convolution-free room: feedback delay with a darkening lowpass in the loop.
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.09;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.18;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 4200;
    const wet = ctx.createGain();
    wet.gain.value = 0.12;
    bus.connect(delay);
    delay.connect(damp);
    damp.connect(feedback);
    feedback.connect(delay);
    damp.connect(wet);
    wet.connect(comp);

    graph = { ctx, bus };
    return graph;
  } catch {
    return null;
  }
}

function noiseBuffer(ctx: AudioContext): AudioBuffer | null {
  if (noise && noise.sampleRate === ctx.sampleRate) return noise;
  try {
    const len = Math.max(1, Math.floor(ctx.sampleRate * 1));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Deterministic pseudo-noise (no Math.random dependency in tests; sounds identical every time).
    let seed = 0x2f6b9a3d;
    for (let i = 0; i < len; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      data[i] = ((seed >>> 0) / 0xffffffff) * 2 - 1;
    }
    noise = buf;
    return buf;
  } catch {
    return null;
  }
}

interface ToneSpec {
  /** Start offset (s) from the cue's start. */
  at: number;
  f: number;
  dur: number;
  gain: number;
  type?: OscillatorType;
  attack?: number;
  /** Optional pitch glide target (Hz) reached at `glide` seconds. */
  fEnd?: number;
  glide?: number;
  detune?: number;
}

interface NoiseSpec {
  at: number;
  dur: number;
  gain: number;
  filter: BiquadFilterType;
  f: number;
  fEnd?: number;
  q?: number;
  attack?: number;
}

function envelope(param: AudioParam, t: number, peak: number, attack: number, dur: number): void {
  const p = Math.max(0.0002, peak);
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(p, t + Math.max(0.002, attack));
  param.exponentialRampToValueAtTime(0.0001, t + Math.max(attack + 0.01, dur));
}

function playTone(g: Graph, t0: number, spec: ToneSpec, scale: number): void {
  const { ctx, bus } = g;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = spec.type ?? 'sine';
  const t = t0 + spec.at;
  osc.frequency.setValueAtTime(spec.f, t);
  if (spec.fEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, spec.fEnd), t + (spec.glide ?? spec.dur));
  if (spec.detune) osc.detune.setValueAtTime(spec.detune, t);
  envelope(amp.gain, t, spec.gain * scale, spec.attack ?? 0.01, spec.dur);
  osc.connect(amp);
  amp.connect(bus);
  osc.start(t);
  osc.stop(t + spec.dur + 0.05);
  osc.onended = () => {
    try {
      osc.disconnect();
      amp.disconnect();
    } catch {
      /* ignore */
    }
  };
}

function playNoise(g: Graph, t0: number, spec: NoiseSpec, scale: number): void {
  const { ctx, bus } = g;
  const buf = noiseBuffer(ctx);
  if (!buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = spec.filter;
  const t = t0 + spec.at;
  filter.frequency.setValueAtTime(spec.f, t);
  if (spec.fEnd !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(20, spec.fEnd), t + spec.dur);
  filter.Q.value = spec.q ?? 0.8;
  const amp = ctx.createGain();
  envelope(amp.gain, t, spec.gain * scale, spec.attack ?? 0.004, spec.dur);
  src.connect(filter);
  filter.connect(amp);
  amp.connect(bus);
  src.start(t, Math.random() * 0.5);
  src.stop(t + spec.dur + 0.05);
  src.onended = () => {
    try {
      src.disconnect();
      filter.disconnect();
      amp.disconnect();
    } catch {
      /* ignore */
    }
  };
}

/** Bell: fundamental + quiet octave + faint inharmonic partial, fast attack, long exponential tail. */
function bell(at: number, f: number, dur: number, gain: number, attack = 0.006): ToneSpec[] {
  return [
    { at, f, dur, gain, attack },
    { at, f: f * 2, dur: dur * 0.7, gain: gain * 0.18, attack },
    { at, f: f * 2.76, dur: dur * 0.45, gain: gain * 0.05, attack },
  ];
}

/** Soft pad note for chords (slow attack, triangle for warmth). */
function pad(at: number, f: number, dur: number, gain: number, attack = 0.06): ToneSpec[] {
  return [
    { at, f, dur, gain, attack, type: 'triangle' },
    { at, f, dur, gain: gain * 0.5, attack, detune: 6 },
  ];
}

interface Voice {
  tones: ToneSpec[];
  noises: NoiseSpec[];
}

function design(name: GameSound, step: number): Voice {
  const tones: ToneSpec[] = [];
  const noises: NoiseSpec[] = [];
  switch (name) {
    case 'select':
      tones.push({ at: 0, f: 2000, dur: 0.025, gain: 0.22, attack: 0.002 });
      noises.push({ at: 0, dur: 0.02, gain: 0.12, filter: 'bandpass', f: 2200, q: 3, attack: 0.001 });
      break;
    case 'correct':
      tones.push(...bell(0, hz(N.E6), 0.3, 0.5), ...bell(0.085, hz(N.B6), 0.38, 0.46));
      break;
    case 'great':
      [N.C6, N.E6, N.G6, N.C7].forEach((n, i) => tones.push(...bell(i * 0.06, hz(n), 0.36, 0.38)));
      tones.push({ at: 0.18, f: hz(N.C7) * 2, dur: 0.55, gain: 0.05, attack: 0.02, detune: 7 });
      tones.push({ at: 0.2, f: hz(N.E7) * 2, dur: 0.5, gain: 0.035, attack: 0.03, detune: -7 });
      noises.push({ at: 0.16, dur: 0.32, gain: 0.03, filter: 'highpass', f: 6500, q: 0.5, attack: 0.03 });
      break;
    case 'wrong':
      tones.push({ at: 0, f: hz(N.A2), fEnd: 88, glide: 0.2, dur: 0.22, gain: 0.55, attack: 0.008 });
      tones.push({ at: 0, f: hz(N.A2) * 2, dur: 0.12, gain: 0.08, attack: 0.006 });
      noises.push({ at: 0, dur: 0.08, gain: 0.22, filter: 'lowpass', f: 420, q: 0.7, attack: 0.003 });
      break;
    case 'coin':
      tones.push(...bell(0, hz(N.B6), 0.11, 0.34, 0.003), ...bell(0.045, hz(N.E7), 0.13, 0.34, 0.003));
      break;
    case 'streak': {
      const base = N.C5 + Math.min(Math.max(0, step), 6) * 2;
      [0, 4, 7, 12].forEach((iv, i) => tones.push(...bell(i * 0.05, hz(base + iv), 0.24, 0.32, 0.005)));
      break;
    }
    case 'squash':
      tones.push({ at: 0, f: 900, fEnd: 180, glide: 0.12, dur: 0.14, gain: 0.5, attack: 0.003 });
      noises.push({ at: 0, dur: 0.05, gain: 0.18, filter: 'bandpass', f: 1300, q: 1.5, attack: 0.002 });
      noises.push({ at: 0.03, dur: 0.04, gain: 0.1, filter: 'bandpass', f: 2600, q: 2, attack: 0.002 });
      break;
    case 'scan':
      noises.push({ at: 0, dur: 0.5, gain: 0.08, filter: 'bandpass', f: 600, fEnd: 3000, q: 1.2, attack: 0.08 });
      tones.push({ at: 0.05, f: 520, fEnd: 1040, glide: 0.45, dur: 0.48, gain: 0.03, attack: 0.08 });
      break;
    case 'star': {
      const ladder = [N.G6, N.B6, N.D7];
      const idx = Math.max(0, step);
      const midi = idx < ladder.length ? ladder[idx] : N.D7 + (idx - 2) * 3;
      const f = hz(midi);
      tones.push({ at: 0, f, dur: 0.6, gain: 0.42, attack: 0.004 });
      tones.push({ at: 0, f: f * 2, dur: 0.42, gain: 0.1, attack: 0.004 });
      tones.push({ at: 0, f: f * 3.01, dur: 0.25, gain: 0.035, attack: 0.004 });
      noises.push({ at: 0, dur: 0.12, gain: 0.025, filter: 'highpass', f: 7000, q: 0.5, attack: 0.002 });
      break;
    }
    case 'mission':
      [N.F5, N.A5, N.C6].forEach((n) => tones.push(...pad(0, hz(n), 0.36, 0.16)));
      [N.G5, N.C6, N.E6].forEach((n) => tones.push(...pad(0.2, hz(n), 0.42, 0.18)));
      tones.push(...bell(0.2, hz(N.C7), 0.4, 0.1));
      break;
    case 'win':
      [N.C5, N.E5, N.G5, N.C6].forEach((n, i) => tones.push(...bell(i * 0.09, hz(n), 0.32, 0.34, 0.005)));
      [N.C5, N.E5, N.G5, N.C6].forEach((n) => tones.push(...pad(0.38, hz(n), 1.0, 0.12, 0.06)));
      tones.push({ at: 0.42, f: hz(N.C7), dur: 0.95, gain: 0.04, attack: 0.08, detune: 5 });
      tones.push({ at: 0.46, f: hz(N.E7), dur: 0.9, gain: 0.03, attack: 0.08, detune: -5 });
      noises.push({ at: 0.36, dur: 0.6, gain: 0.02, filter: 'highpass', f: 7000, q: 0.5, attack: 0.1 });
      break;
    case 'lose':
      tones.push({ at: 0, f: hz(N.G5), dur: 0.24, gain: 0.3, attack: 0.02 });
      tones.push({ at: 0.18, f: hz(N.E5), dur: 0.32, gain: 0.28, attack: 0.02 });
      break;
    case 'flip':
      noises.push({ at: 0, dur: 0.07, gain: 0.22, filter: 'highpass', f: 2500, q: 0.7, attack: 0.003 });
      noises.push({ at: 0.025, dur: 0.045, gain: 0.1, filter: 'bandpass', f: 4200, q: 1.2, attack: 0.002 });
      break;
  }
  return { tones, noises };
}

function isUnlocked(): boolean {
  if (!unlocked && hasUserActivation()) unlocked = true;
  return unlocked;
}

/** Explicitly unlock audio from inside a user-gesture handler (e.g. the first "Play" tap). */
export function unlockGameAudio(): void {
  unlocked = true;
  try {
    const g = ensureGraph();
    if (g && g.ctx.state === 'suspended' && isSoundEnabled()) void g.ctx.resume().catch(() => undefined);
  } catch {
    /* ignore */
  }
}

/** Plays a synthesized cue. `step` raises pitch for successive stars/streak levels (0-based); `intensity` 0..1 scales loudness. Never throws. */
export function playGameSound(name: GameSound, opts: GameSoundOptions = {}): void {
  try {
    installUnlockListeners();
    if (!isSoundEnabled() || !isUnlocked()) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - (lastPlayed[name] ?? -Infinity) < RATE_LIMIT_MS) return;
    lastPlayed[name] = now;
    const g = ensureGraph();
    if (!g) return;
    if (g.ctx.state === 'suspended') void g.ctx.resume().catch(() => undefined);
    const scale = clamp01(opts.intensity ?? 1);
    if (scale <= 0) return;
    const voice = design(name, Math.floor(opts.step ?? 0));
    const t0 = g.ctx.currentTime + 0.006;
    for (const t of voice.tones) playTone(g, t0, t, scale);
    for (const n of voice.noises) playNoise(g, t0, n, scale);
  } catch {
    /* sound is decoration: never let it break gameplay */
  }
}

/** Test helper: forget the context, unlock state and rate-limit memory. */
export function __resetGameSoundsForTests(): void {
  graph = null;
  noise = null;
  unlocked = false;
  lastPlayed = {};
}
