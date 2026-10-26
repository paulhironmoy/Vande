/**
 * Match audio: a continuous, layered crowd bed that follows the renderer's crowd envelope, plus timed one-shot
 * cues (bat, pad, stumps, gloves, roars, drums, fireworks, the seal chime) and haptics. Implements the renderer's
 * PresentationSink. The graph is the shared mix (src/audio/mix.ts): the action through its compressor, the bed
 * under it, makeup and a limiter. Nothing plays until the first user gesture, while Sound is off, or while the app
 * is in the background; where the browser has an audio session it joins the 'ambient' one, so the ringer switch
 * mutes it and the player's own music keeps playing.
 */
import type { Contact, TimingGrade } from '@/contracts';
import type { SceneEventKind } from '@/render3d/core/choreo';
import type { PresentationSink } from '@/render3d/types';
import { haptic, hapticPattern } from './haptics';
import { createFeelScheduler, feelFor } from './feel';
import { applyCompressor, MIX } from './mix';
import { joinAmbientSession, onVisibility, pageHidden } from './system';
import { makeNoise, voices, type VoiceTarget } from './voices';

interface LiveGraph {
  ctx: AudioContext;
  master: GainNode;
  sfx: GainNode;
  /** Where the crowd bed joins the action, before the makeup and the limiter. */
  bus: GainNode;
  bed: { gain: GainNode; layers: Array<{ src: AudioBufferSourceNode; gain: GainNode }> } | null;
  noise: AudioBuffer;
}

let soundOn = true;
let hapticsOn = true;
let unlocked = false;
let graph: LiveGraph | null = null;
let listening = false;

export function setMatchSound(on: boolean) {
  soundOn = on;
  if (on && listening) prepareWhenIdle();
  if (!graph) return;
  if (!on) {
    graph.master.gain.setTargetAtTime(0, graph.ctx.currentTime, 0.05);
    void graph.ctx.suspend().catch(() => undefined);
  } else if (unlocked && !pageHidden()) {
    void graph.ctx.resume().catch(() => undefined);
    graph.master.gain.setTargetAtTime(MIX.master, graph.ctx.currentTime, 0.1);
  }
}
export function setMatchHaptics(on: boolean) {
  hapticsOn = on;
}

function ensureGraph(): LiveGraph | null {
  if (graph) return graph;
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    joinAmbientSession();
    const ctx = new Ctor({ latencyHint: 'interactive' });
    const master = ctx.createGain();
    master.gain.value = soundOn ? MIX.master : 0;
    // The action at unit gain, as in the highlight render the live gains were measured on.
    const sfx = ctx.createGain();
    sfx.gain.value = 1;
    const bus = ctx.createGain();
    sfx.connect(applyCompressor(ctx.createDynamicsCompressor(), MIX.action)).connect(bus);
    const makeup = ctx.createGain();
    makeup.gain.value = 10 ** (MIX.liveMakeupDb / 20);
    bus.connect(makeup).connect(applyCompressor(ctx.createDynamicsCompressor(), MIX.limiter)).connect(master).connect(ctx.destination);
    const g: LiveGraph = { ctx, master, sfx, bus, bed: null, noise: makeNoise(ctx) };
    // Never in the background: suspended while hidden, back (if Sound is on) when the app returns.
    onVisibility((hidden) => {
      if (hidden) void ctx.suspend().catch(() => undefined);
      else if (soundOn && unlocked) void ctx.resume().catch(() => undefined);
    });
    graph = g;
    return graph;
  } catch {
    return null;
  }
}

let preparing = false;

/**
 * Builds the audio graph (a suspended AudioContext, the mix and the noise buffer) in idle time. Creating an
 * AudioContext costs 100–200 ms of main thread on many devices; built here, the first tap or swing only resumes it
 * (≈0.1 ms) instead of stalling the frame that should show the bat move. Browsers allow a suspended context before
 * any gesture.
 */
function prepareWhenIdle() {
  if (graph || preparing || typeof window === 'undefined' || !soundOn) return;
  preparing = true;
  const run = () => {
    preparing = false;
    ensureGraph();
  };
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof idle === 'function') idle(run, { timeout: 1500 });
  else setTimeout(run, 200);
}

/** Installs one-time unlock listeners (browser autoplay policy) and prepares the graph in idle time. Safe to call repeatedly. */
export function installMatchAudioUnlock() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  const unlock = () => {
    unlocked = true;
    // Normally prepared already: the gesture only resumes it.
    const g = graph ?? ensureGraph();
    if (g && soundOn && !pageHidden() && g.ctx.state === 'suspended') void g.ctx.resume().catch(() => undefined);
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  prepareWhenIdle();
}

function startBed(g: LiveGraph) {
  if (g.bed) return g.bed;
  const gain = g.ctx.createGain();
  gain.gain.value = 0.0001;
  const level = g.ctx.createGain();
  level.gain.value = MIX.liveBedGain;
  gain.connect(level).connect(g.bus);
  const layers = (
    [
      [380, 0.5, 0.55, 0.13],
      [950, 0.7, 0.35, 0.21],
      [2200, 1.1, 0.12, 0.31],
    ] as const
  ).map(([freq, q, level, lfoHz]) => {
    const src = g.ctx.createBufferSource();
    src.buffer = g.noise;
    src.loop = true;
    const f = g.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const layer = g.ctx.createGain();
    layer.gain.value = level;
    // Slow swell so the bed breathes like a real crowd.
    const lfo = g.ctx.createOscillator();
    lfo.frequency.value = lfoHz;
    const depth = g.ctx.createGain();
    depth.gain.value = level * 0.35;
    lfo.connect(depth).connect(layer.gain);
    lfo.start();
    src.connect(f).connect(layer).connect(gain);
    src.start(0, freq / 1000);
    return { src, gain: layer };
  });
  g.bed = { gain, layers };
  return g.bed;
}

function stopBed(g: LiveGraph) {
  if (!g.bed) return;
  g.bed.gain.gain.setTargetAtTime(0.0001, g.ctx.currentTime, 0.2);
}

export interface MatchAudioOptions {
  haptics?: boolean;
  /**
   * Live batting: the batting screen plays the bat's sound and haptic itself, at the tap (playSwingFeel) and again
   * when the answer lands (playContactFeel), so the scene's own bat and edge cues are skipped (no double crack, no
   * late buzz).
   */
  liveContact?: boolean;
}

/** PresentationSink for the renderer. One per stage. */
export class MatchAudio implements PresentationSink {
  private lastCrowd = -1;

  constructor(private opts: MatchAudioOptions = {}) {
    installMatchAudioUnlock();
  }

  crowd(level: number) {
    if (!soundOn || !unlocked) return;
    if (Math.abs(level - this.lastCrowd) < 0.01) return;
    this.lastCrowd = level;
    const g = ensureGraph();
    if (!g) return;
    const bed = startBed(g);
    bed.gain.gain.setTargetAtTime(0.025 + level * 0.12, g.ctx.currentTime, 0.25);
  }

  cue(kind: SceneEventKind, intensity: number, rate: number) {
    if (this.opts.liveContact && (kind === 'bat' || kind === 'edge')) return;
    // Live, the batter's own patterns are the only contact haptics (a pad buzz would blur into them).
    if (this.opts.haptics !== false && hapticsOn && !(this.opts.liveContact && kind === 'pad')) this.haptic(kind, intensity);
    if (!soundOn || !unlocked) return;
    const g = ensureGraph();
    if (!g) return;
    const v: VoiceTarget = { ctx: g.ctx, out: g.sfx, noise: g.noise };
    playCue(v, kind, intensity, g.ctx.currentTime + 0.005, rate);
  }

  private haptic(kind: SceneEventKind, intensity: number) {
    if (kind === 'bat') haptic(intensity > 0.85 ? 'medium' : 'light');
    else if (kind === 'edge' || kind === 'pad') haptic('light');
    else if (kind === 'stumps' || kind === 'catch') haptic('heavy');
    else if (kind === 'six' || kind === 'boundary') haptic('success');
    else if (kind === 'seal') haptic('light');
    else if (kind === 'result') haptic('success');
  }

  dispose() {
    if (graph) stopBed(graph);
  }
}

/** Shared by live playback and offline rendering. */
export function playCue(v: VoiceTarget, kind: SceneEventKind, intensity: number, when: number, rate = 1) {
  const pitch = rate < 0.95 ? Math.max(0.55, Math.sqrt(rate)) : 1;
  switch (kind) {
    case 'release':
      voices.release(v, when, intensity);
      break;
    case 'bounce':
      voices.bounce(v, when, intensity, pitch);
      break;
    case 'bat':
      voices.bat(v, when, intensity, pitch);
      break;
    case 'edge':
      voices.edge(v, when, intensity, pitch);
      break;
    case 'pad':
      voices.pad(v, when, intensity, pitch);
      break;
    case 'stumps':
      voices.stumps(v, when, intensity, pitch);
      voices.roar(v, when + 0.12, 0.95, 3.2);
      break;
    case 'bails':
      voices.bails(v, when, intensity, pitch);
      break;
    case 'gloves':
      voices.gloves(v, when, intensity, pitch);
      break;
    case 'catch':
      voices.catch(v, when, intensity, pitch);
      voices.roar(v, when + 0.08, 1, 3.2);
      break;
    case 'fielded':
      voices.fielded(v, when, intensity);
      break;
    case 'throw':
      voices.throw(v, when);
      break;
    case 'boundary':
      voices.roar(v, when, 0.85, 2.8);
      voices.drums(v, when + 0.25, 0.8);
      break;
    case 'six':
      voices.roar(v, when, 1, 3.4);
      voices.drums(v, when + 0.2, 1);
      break;
    case 'appeal':
      voices.roar(v, when, 0.55, 1.4);
      break;
    case 'fireworks':
      voices.fireworks(v, when, intensity);
      break;
    case 'seal':
      voices.seal(v, when);
      break;
    case 'tension':
      voices.tension(v, when, 1.45 / Math.max(0.25, rate));
      break;
    case 'result':
      voices.resultHit(v, when);
      break;
    default:
      break;
  }
}

/** What the tap is predicted to hit, before the sealed answer arrives (see predictContact). */
export type SwingGuess = 'middle' | 'edge' | 'miss' | 'none';

const guessOf = (c: Contact): SwingGuess => (c === 'middle' ? 'middle' : c === 'thick_edge' || c === 'thin_edge' ? 'edge' : c === 'none' ? 'none' : 'miss');

function liveVoice(): { v: VoiceTarget; when: number } | null {
  if (!soundOn || !unlocked) return null;
  const g = ensureGraph();
  if (!g || g.ctx.state !== 'running') return null;
  return { v: { ctx: g.ctx, out: g.sfx, noise: g.noise }, when: g.ctx.currentTime + 0.002 };
}

/** The batter's haptics, never two patterns within 60 ms (src/audio/feel.ts). */
const feel = createFeelScheduler({
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  emit: (pattern) => {
    if (hapticsOn) hapticPattern(pattern);
  },
});

/**
 * The tap itself, with no wait for the network: the predicted outcome's haptic pattern (a tick for an edge, a pulse
 * for the middle, a pulse and a beat for perfect; nothing for a leave or a miss) and the sound the shot is predicted
 * to make. Sound and vibration each follow their own setting.
 */
export function playSwingFeel(predicted: Contact, timing: TimingGrade = 'good'): void {
  const guess = guessOf(predicted);
  const pattern = feelFor(predicted, timing);
  if (pattern && hapticsOn) feel.play(pattern);
  const out = liveVoice();
  if (!out) return;
  if (guess === 'middle') voices.bat(out.v, out.when, 0.75);
  else if (guess === 'edge') voices.edge(out.v, out.when, 0.6);
  else if (guess === 'miss') voices.swish(out.v, out.when);
}

/**
 * The sealed answer lands: a different outcome from the predicted one plays its own pattern (at least 60 ms after the
 * first; the same outcome plays nothing more), and the middle of the bat rings (brighter for perfect timing) while an
 * edge the tap did not predict ticks. Nothing about runs or wickets.
 */
export function playContactFeel(contact: Contact, timing: TimingGrade, predicted: Contact, predictedTiming: TimingGrade = 'good'): void {
  const guess = guessOf(predicted);
  const pattern = feelFor(contact, timing);
  if (pattern && pattern !== feelFor(predicted, predictedTiming) && hapticsOn) feel.play(pattern);
  const out = liveVoice();
  if (!out) return;
  if (contact === 'middle') {
    if (guess !== 'middle') voices.bat(out.v, out.when, 0.9);
    voices.ring(out.v, out.when + 0.004, timing === 'perfect');
  } else if ((contact === 'thick_edge' || contact === 'thin_edge') && guess !== 'edge') {
    voices.edge(out.v, out.when, contact === 'thick_edge' ? 0.8 : 0.55);
  }
}

/** UI-level cue outside the match (e.g. locking an over plays the seal chime). */
export function playSealChime() {
  if (!soundOn || !unlocked) return;
  const g = ensureGraph();
  if (!g) return;
  voices.seal({ ctx: g.ctx, out: g.sfx, noise: g.noise }, g.ctx.currentTime + 0.01);
}
