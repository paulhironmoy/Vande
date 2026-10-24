/**
 * Restrained, synthesised sound cues (Web Audio). No audio files, no network.
 * Cues only play after the first user gesture (browser autoplay policy) and when the setting is on.
 */
export type Cue = 'tap' | 'confirm' | 'verify' | 'warning' | 'danger' | 'chapterEnd' | 'open' | 'close' | 'success';

let enabled = true;
let unlocked = false;
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let lastPlayed: Record<string, number> = {};

export function setSoundEnabled(v: boolean): void {
  enabled = v;
  if (!v && ctx && ctx.state === 'running') void ctx.suspend().catch(() => undefined);
  if (v && ctx && ctx.state === 'suspended' && unlocked) void ctx.resume().catch(() => undefined);
}

export function isSoundEnabled(): boolean {
  return enabled;
}

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor: typeof AudioContext | undefined =
    typeof window !== 'undefined'
      ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.11;
    master.connect(ctx.destination);
    return ctx;
  } catch {
    return null;
  }
}

/** Call once at startup: the first pointer/key gesture unlocks audio. */
export function installAudioUnlock(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const unlock = () => {
    unlocked = true;
    const c = ensureContext();
    if (c && c.state === 'suspended' && enabled) void c.resume().catch(() => undefined);
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
  return () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
}

interface Note {
  f: number;
  t: number; // start offset s
  d: number; // duration s
  type?: OscillatorType;
  g?: number; // peak gain multiplier
}

const CUES: Record<Cue, Note[]> = {
  tap: [{ f: 740, t: 0, d: 0.045, type: 'sine', g: 0.5 }],
  open: [{ f: 520, t: 0, d: 0.06, type: 'sine', g: 0.45 }, { f: 780, t: 0.04, d: 0.08, type: 'sine', g: 0.35 }],
  close: [{ f: 620, t: 0, d: 0.06, type: 'sine', g: 0.4 }, { f: 420, t: 0.04, d: 0.08, type: 'sine', g: 0.3 }],
  confirm: [{ f: 523, t: 0, d: 0.09, type: 'triangle', g: 0.6 }, { f: 784, t: 0.07, d: 0.14, type: 'triangle', g: 0.5 }],
  verify: [{ f: 880, t: 0, d: 0.1, type: 'sine', g: 0.45 }, { f: 1320, t: 0.06, d: 0.18, type: 'sine', g: 0.35 }],
  success: [
    { f: 523, t: 0, d: 0.1, type: 'triangle', g: 0.5 },
    { f: 659, t: 0.08, d: 0.1, type: 'triangle', g: 0.5 },
    { f: 784, t: 0.16, d: 0.22, type: 'triangle', g: 0.5 },
  ],
  warning: [{ f: 330, t: 0, d: 0.08, type: 'square', g: 0.22 }, { f: 330, t: 0.13, d: 0.08, type: 'square', g: 0.22 }],
  danger: [{ f: 196, t: 0, d: 0.22, type: 'triangle', g: 0.7 }, { f: 147, t: 0.12, d: 0.28, type: 'triangle', g: 0.6 }],
  chapterEnd: [
    { f: 392, t: 0, d: 0.16, type: 'triangle', g: 0.5 },
    { f: 523, t: 0.14, d: 0.16, type: 'triangle', g: 0.5 },
    { f: 659, t: 0.28, d: 0.3, type: 'triangle', g: 0.5 },
    { f: 784, t: 0.42, d: 0.5, type: 'sine', g: 0.4 },
  ],
};

/** Play a cue. Silently does nothing when disabled, not yet unlocked or unsupported. */
export function playCue(cue: Cue): void {
  if (!enabled || !unlocked) return;
  const c = ensureContext();
  if (!c || !master) return;
  const now = performance.now();
  if (now - (lastPlayed[cue] ?? 0) < 60) return; // de-dupe bursts
  lastPlayed[cue] = now;
  if (c.state === 'suspended') void c.resume().catch(() => undefined);
  const t0 = c.currentTime + 0.005;
  for (const n of CUES[cue]) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = n.type ?? 'sine';
    osc.frequency.setValueAtTime(n.f, t0 + n.t);
    const peak = n.g ?? 0.5;
    gain.gain.setValueAtTime(0.0001, t0 + n.t);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + n.t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.t + n.d);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0 + n.t);
    osc.stop(t0 + n.t + n.d + 0.02);
  }
}

/** Test helper. */
export function __resetSoundsForTests(): void {
  lastPlayed = {};
  unlocked = false;
  ctx = null;
  master = null;
}
