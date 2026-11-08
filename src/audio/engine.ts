/**
 * The one AudioContext and the live mix (constitution §13). Four buses, each with the player's level and a duck,
 * feed the action compressor; the crowd bed joins after it; then the makeup gain, the true-peak-safe limiter and the
 * master (src/audio/mix.ts holds the measured gains):
 *
 *   effects voices   → level(effects)                → duck ─┐
 *   crowd one-shots  → level(crowd)                  → duck ─┤
 *   music (the dhol) → level(music)                  → duck ─┼→ action compressor → mix → makeup → limiter → master
 *   interface        → level(effects) → quiet gate   → duck ─┘                         ↑
 *   crowd bed        → bed level(crowd × MIX.liveBedGain) → duck ─────────────────────┘
 *
 * Priority: release, then pitch contact, then bat contact. Each of those ducks every lower bus (the crowd, the music
 * and the interface) for its own length, so nothing masks them. Delivery Quiet Mode closes the interface gate from
 * the bowler's approach to dead ball. Built in idle time, off the input path; nothing plays before the first gesture,
 * while Sound is off, or in the background. Going to the background stops every voice and suspends the context, so
 * nothing is left hanging when the app returns.
 */
import { applyCompressor, MIX } from './mix';
import { getAudioSettings, subscribeAudioSettings, type AudioSettings } from './settings';
import { joinAmbientSession, onVisibility, pageHidden } from './system';
import { makeNoise, type VoiceTarget } from './voices';

export type Bus = 'effects' | 'crowd' | 'music' | 'interface';
type Ducked = 'crowd' | 'bed' | 'music' | 'interface';
const DUCKED: readonly Ducked[] = ['crowd', 'bed', 'music', 'interface'];

export interface LiveGraph {
  ctx: AudioContext;
  master: GainNode;
  /** Where each bus's voices connect. */
  input: Record<Bus, GainNode>;
  /** The crowd bed's input (it joins after the action compressor). */
  bedInput: GainNode;
  noise: AudioBuffer;
  /** Live-synthesis targets, one per bus and one that routes Sealed Six cues to all four (made once). */
  target: Record<Bus, VoiceTarget>;
  routed: VoiceTarget;
  level: Record<Bus, GainNode>;
  bedLevel: GainNode;
  duck: Record<Ducked, GainNode>;
  gate: GainNode;
}

/** How long each high-priority sound holds the duck (s), and how far each lower bus goes (gain). */
export const DUCK = {
  hold: { release: 0.22, bounce: 0.12, contact: 0.3 },
  depth: { crowd: 0.35, bed: 0.35, music: 0.2, interface: 0 } as Readonly<Record<Ducked, number>>,
  /** Time constants (s): in, and back. */
  attack: 0.004,
  recover: 0.12,
} as const;

/** A level (0..1) as a gain: a gentle curve, so "Low" (0.5) is about −10 dB. */
export const busGain = (level: number) => (level <= 0 ? 0 : Math.pow(Math.min(1, level), 1.7));
const INTERFACE_TRIM = 0.8;

let soundOn = true;
let unlocked = false;
let quiet = false;
let graph: LiveGraph | null = null;
let listening = false;
let preparing = false;
const graphListeners: Array<(g: LiveGraph) => void> = [];
const resumeListeners = new Set<() => void>();

function applyLevels(g: LiveGraph, s: Readonly<AudioSettings>, smooth: boolean) {
  const set = (n: GainNode, v: number) =>
    smooth ? n.gain.setTargetAtTime(v, g.ctx.currentTime, 0.05) : (n.gain.value = v);
  set(g.level.effects, busGain(s.effects));
  set(g.level.crowd, busGain(s.crowd));
  set(g.level.music, busGain(s.music));
  set(g.level.interface, busGain(s.effects) * INTERFACE_TRIM);
  set(g.bedLevel, MIX.liveBedGain * busGain(s.crowd));
}

function ensureGraph(): LiveGraph | null {
  if (graph) return graph;
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    joinAmbientSession();
    const ctx = new Ctor({ latencyHint: 'interactive' });
    const gain = (v = 1) => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };
    const master = gain(soundOn ? MIX.master : 0);
    const action = applyCompressor(ctx.createDynamicsCompressor(), MIX.action);
    const mixBus = gain();
    action.connect(mixBus);
    const makeup = gain(10 ** (MIX.liveMakeupDb / 20));
    mixBus
      .connect(makeup)
      .connect(applyCompressor(ctx.createDynamicsCompressor(), MIX.limiter))
      .connect(master)
      .connect(ctx.destination);
    const input = { effects: gain(), crowd: gain(), music: gain(), interface: gain() };
    const level = { effects: gain(), crowd: gain(), music: gain(), interface: gain() };
    const duck = { crowd: gain(), bed: gain(), music: gain(), interface: gain() };
    const gate = gain(quiet ? 0 : 1);
    input.effects.connect(level.effects).connect(action);
    input.crowd.connect(level.crowd).connect(duck.crowd).connect(action);
    input.music.connect(level.music).connect(duck.music).connect(action);
    input.interface.connect(level.interface).connect(gate).connect(duck.interface).connect(action);
    const bedInput = gain();
    const bedLevel = gain();
    bedInput.connect(bedLevel).connect(duck.bed).connect(mixBus);
    const noise = makeNoise(ctx);
    const target = (out: AudioNode): VoiceTarget => ({ ctx, out, noise, track: trackVoice });
    const g: LiveGraph = {
      ctx,
      master,
      input,
      bedInput,
      noise,
      target: {
        effects: target(input.effects),
        crowd: target(input.crowd),
        music: target(input.music),
        interface: target(input.interface),
      },
      routed: {
        ctx,
        out: input.effects,
        crowd: input.crowd,
        music: input.music,
        ui: input.interface,
        noise,
        track: trackVoice,
      },
      level,
      bedLevel,
      duck,
      gate,
    };
    applyLevels(g, getAudioSettings(), false);
    subscribeAudioSettings(() => applyLevels(g, getAudioSettings(), true));
    // Never in the background: every voice stops and the context suspends; back (if Sound is on) on return.
    onVisibility((hidden) => {
      if (hidden) {
        stopAllVoices();
        resetDucks(g);
        void ctx.suspend().catch(() => undefined);
      } else if (soundOn && unlocked) {
        void ctx.resume().catch(() => undefined);
        for (const l of resumeListeners) l();
      }
    });
    graph = g;
    for (const l of graphListeners.splice(0)) l(g);
    return graph;
  } catch {
    return null;
  }
}

/** Calls fn with the graph as soon as it exists (at once when it does). */
export function onGraph(fn: (g: LiveGraph) => void): void {
  if (graph) fn(graph);
  else graphListeners.push(fn);
}

/** Called when the app returns from the background with sound (re-sync anything that follows a curve). */
export function onAudioResume(fn: () => void): () => void {
  resumeListeners.add(fn);
  return () => {
    resumeListeners.delete(fn);
  };
}

/**
 * Builds the graph (a suspended AudioContext, the mix and the noise buffer) in idle time. Creating an AudioContext
 * costs 100–200 ms of main thread on many devices; built here, the first tap only resumes it (about 0.1 ms).
 */
function prepareWhenIdle(): void {
  if (graph || preparing || typeof window === 'undefined' || !soundOn) return;
  preparing = true;
  const run = () => {
    preparing = false;
    ensureGraph();
  };
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
    .requestIdleCallback;
  if (typeof idle === 'function') idle(run, { timeout: 1500 });
  else setTimeout(run, 200);
}

/** One-time unlock listeners (browser autoplay policy) and the idle-time warm-up. Safe to call repeatedly. */
export function installAudioUnlock(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  const unlock = () => {
    unlocked = true;
    const g = graph ?? ensureGraph();
    if (g && soundOn && !pageHidden() && g.ctx.state === 'suspended') void g.ctx.resume().catch(() => undefined);
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  prepareWhenIdle();
}

/** The app's Sound switch (the master). */
export function setMasterSound(on: boolean): void {
  soundOn = on;
  if (on && listening) prepareWhenIdle();
  const g = graph;
  if (!g) return;
  if (!on) {
    g.master.gain.setTargetAtTime(0, g.ctx.currentTime, 0.05);
    stopAllVoices();
    void g.ctx.suspend().catch(() => undefined);
  } else if (unlocked && !pageHidden()) {
    void g.ctx.resume().catch(() => undefined);
    g.master.gain.setTargetAtTime(MIX.master, g.ctx.currentTime, 0.1);
  }
}

/** The graph when a sound may play now (Sound on, unlocked, running, in the foreground); otherwise null. */
export function audible(): LiveGraph | null {
  if (!soundOn || !unlocked || pageHidden()) return null;
  const g = ensureGraph();
  return g && g.ctx.state === 'running' ? g : null;
}

const quietListeners = new Set<(quiet: boolean) => void>();

/** Delivery Quiet Mode: the interface gate closes (and anything sounding on it fades in 20 ms). */
export function setQuiet(on: boolean): void {
  if (quiet === on) return;
  quiet = on;
  const g = graph;
  if (g) g.gate.gain.setTargetAtTime(on ? 0 : 1, g.ctx.currentTime, on ? 0.02 : 0.08);
  for (const l of quietListeners) l(on);
}
export const isQuiet = () => quiet;

/** Called when Delivery Quiet Mode begins or ends. */
export function onQuietChange(fn: (quiet: boolean) => void): () => void {
  quietListeners.add(fn);
  return () => {
    quietListeners.delete(fn);
  };
}

/** Ducks every lower bus under a release, a pitch contact or a bat contact sounding at `when` (context time). */
export function duckUnder(kind: keyof typeof DUCK.hold, when?: number): void {
  const g = graph;
  if (!g) return;
  const now = g.ctx.currentTime;
  const at = when ?? now;
  const start = at - 0.004 > now ? at - 0.004 : now;
  const end = at + DUCK.hold[kind];
  for (const k of DUCKED) {
    // A wicket's silence owns the crowd duck until it ends (a cue arriving with it never reopens the crowd).
    if (k === 'crowd' && start < crowdSilencedUntil) continue;
    const p = g.duck[k].gain;
    p.cancelScheduledValues(start);
    p.setTargetAtTime(DUCK.depth[k], start, DUCK.attack);
    p.setTargetAtTime(1, end, DUCK.recover);
  }
}

/**
 * A wicket's decisive silence: every crowd one-shot still sounding fades out within about 100 ms and the crowd bus
 * stays closed for `holdS`, then opens for the crowd's shift (the bed follows the emotion curve on its own).
 */
let crowdSilencedUntil = 0;

export function silenceCrowd(when: number, holdS: number): void {
  const g = graph;
  if (!g) return;
  const start = when > g.ctx.currentTime ? when : g.ctx.currentTime;
  crowdSilencedUntil = start + holdS;
  const p = g.duck.crowd.gain;
  p.cancelScheduledValues(start);
  p.setTargetAtTime(0, start, 0.03);
  p.setTargetAtTime(1, start + holdS, 0.05);
}

function resetDucks(g: LiveGraph) {
  crowdSilencedUntil = 0;
  for (const k of DUCKED) {
    const p = g.duck[k].gain;
    p.cancelScheduledValues(0);
    p.value = 1;
  }
}

// Every scheduled source, so going to the background can stop them all (a ring: 64 is far more than ever overlap).
const VOICE_SLOTS = 64;
const voiceNodes: Array<AudioScheduledSourceNode | null> = new Array<AudioScheduledSourceNode | null>(VOICE_SLOTS).fill(
  null,
);
const voiceEnds = new Float64Array(VOICE_SLOTS);
let voiceNext = 0;

export function trackVoice(node: AudioScheduledSourceNode, end: number): void {
  voiceNodes[voiceNext] = node;
  voiceEnds[voiceNext] = end;
  voiceNext = (voiceNext + 1) % VOICE_SLOTS;
}

/** Stops every voice still sounding or scheduled. */
function stopAllVoices(): void {
  const now = graph ? graph.ctx.currentTime : 0;
  for (let i = 0; i < VOICE_SLOTS; i++) {
    const n = voiceNodes[i];
    if (n && voiceEnds[i] > now) {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    }
    voiceNodes[i] = null;
  }
}

/** TEST HOOK: the graph if it exists (never builds it). */
export const currentGraph = () => graph;
