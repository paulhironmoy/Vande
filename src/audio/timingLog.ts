/**
 * TEST BUILDS ONLY (VITE_PRACTICE_TEST_HOOKS=1): the event-timing log examiners read. Every sound, haptic, crowd change,
 * caption and moment is recorded with the performance.now() time it was due, and every sound also with the audio-clock
 * time it was scheduled at, mapped to performance.now() through the context's output timestamp (so it includes the
 * output latency the browser reports). Read it through window.__vandeAudio.log(). In production the flag is a build
 * constant, so every call below is a no-op the bundler removes.
 */
import type { CrowdEmotion } from './emotionCore';

export type AudioLogType = 'sound' | 'haptic' | 'crowd' | 'caption' | 'moment';

export interface AudioLogEntry {
  type: AudioLogType;
  /** An effect id, a crowd reaction or 'bed', a haptic pattern, a caption key or a moment kind. */
  name: string;
  /** performance.now() at which it was due (the event's own time when the stage passed one). */
  atPerfMs: number;
  /** Sounds: the audio-clock time it was scheduled at (s) and that time as performance.now() (ms). */
  ctxTime: number | null;
  audioPerfMs: number | null;
  /** A sound's gain, or the crowd's level (arousal 0..1). */
  level: number | null;
  /** The bus a sound played on. */
  bus: string | null;
  /** Crowd level samples: the crowd's mood and phase. */
  detail?: string;
}

const BUILD_HOOKS = import.meta.env.VITE_PRACTICE_TEST_HOOKS === '1';
let on = BUILD_HOOKS;
/** About 15 minutes of play: the crowd level is sampled at 20 Hz. */
const MAX = 20000;
const entries: AudioLogEntry[] = [];
let emotionSource: (() => Readonly<CrowdEmotion>) | null = null;

export const audioLogOn = () => on;

/** performance.now() when the sample at context time t reaches the output (null without a running clock). */
function ctxToPerf(ctx: BaseAudioContext, t: number): number | null {
  const live = ctx as AudioContext;
  try {
    const ts = typeof live.getOutputTimestamp === 'function' ? live.getOutputTimestamp() : null;
    if (ts && typeof ts.contextTime === 'number' && typeof ts.performanceTime === 'number' && ts.performanceTime > 0)
      return ts.performanceTime + (t - ts.contextTime) * 1000;
  } catch {
    /* fall through */
  }
  const latency = (live.baseLatency ?? 0) + (live.outputLatency ?? 0);
  return performance.now() + (t - ctx.currentTime + latency) * 1000;
}

/** The context time at which a sound must start to be heard at performance time `perfMs` (never in the past). */
export function perfToCtx(ctx: BaseAudioContext, perfMs: number): number {
  const live = ctx as AudioContext;
  let t: number;
  try {
    const ts = typeof live.getOutputTimestamp === 'function' ? live.getOutputTimestamp() : null;
    if (ts && typeof ts.contextTime === 'number' && typeof ts.performanceTime === 'number' && ts.performanceTime > 0)
      t = ts.contextTime + (perfMs - ts.performanceTime) / 1000;
    else
      t = ctx.currentTime + (perfMs - performance.now()) / 1000 - ((live.baseLatency ?? 0) + (live.outputLatency ?? 0));
  } catch {
    t = ctx.currentTime;
  }
  const soonest = ctx.currentTime + 0.002;
  return Number.isFinite(t) && t > soonest ? t : soonest;
}

export function logAudio(
  type: AudioLogType,
  name: string,
  atPerfMs: number,
  extra?: { ctx?: BaseAudioContext; ctxTime?: number; level?: number; bus?: string; detail?: string },
): void {
  if (!on) return;
  const ctxTime = extra?.ctxTime ?? null;
  entries.push({
    type,
    name,
    atPerfMs,
    ctxTime,
    audioPerfMs: ctxTime !== null && extra?.ctx ? ctxToPerf(extra.ctx, ctxTime) : null,
    level: extra?.level ?? null,
    bus: extra?.bus ?? null,
    ...(extra?.detail ? { detail: extra.detail } : {}),
  });
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
}

/** The Practice sink registers its emotion machine so the hooks can read the crowd's state. */
export function setEmotionSource(fn: (() => Readonly<CrowdEmotion>) | null): void {
  emotionSource = fn;
}

/** A disposed sink clears only its own source (a newer sink may have registered since). */
export function clearEmotionSource(fn: () => Readonly<CrowdEmotion>): void {
  if (emotionSource === fn) emotionSource = null;
}

interface AudioTestApi {
  log(): AudioLogEntry[];
  clear(): void;
  emotion(): CrowdEmotion | null;
}

declare global {
  interface Window {
    __vandeAudio?: AudioTestApi;
  }
}

function install(rebind = false) {
  if (typeof window === 'undefined' || (window.__vandeAudio && !rebind)) return;
  window.__vandeAudio = {
    log: () => entries.slice(),
    clear: () => void entries.splice(0),
    emotion: () => (emotionSource ? { ...emotionSource() } : null),
  };
}

if (BUILD_HOOKS) install();

/** TEST HOOK (unit tests): turn the log on or off and expose window.__vandeAudio. */
export function enableAudioLog(enabled: boolean): void {
  on = enabled;
  entries.splice(0);
  if (enabled) install(true);
}
