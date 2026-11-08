/**
 * The sound settings on this device: independent levels for the effects, the crowd and the music, Practice vibration,
 * the optional release tick, and captions. Stored like Practice's own settings (src/practice/store): localStorage
 * under 'vc:practice:audio', every read validated, anything corrupt treated as absent, nothing ever sent anywhere.
 *
 * The app's own Sound and Vibration switches (the root store, applied through syncAudioSettings) stay the master
 * switches: Sound off silences every bus, Vibration off stops every haptic. These settings sit beneath them.
 *
 * getAudioSettings() returns a frozen snapshot that changes identity only when a value changes, so a React screen can
 * read it with useSyncExternalStore(subscribeAudioSettings, getAudioSettings). Changes apply to the live mix at once.
 */
import { setCaptionsGate } from './captions';

export interface AudioSettings {
  v: 1;
  /** 0..1 (0 is off): release, pitch, bat contact, edges, stumps, fielding, and the interface. */
  effects: number;
  /** 0..1: the crowd's murmur and reactions. */
  crowd: number;
  /** 0..1: the only music, the celebration dhol after a four or a six. */
  music: number;
  /** Practice vibration (beneath the app's Vibration switch). */
  haptics: boolean;
  /** The optional, very subtle tick at the bowler's release (constitution §12). */
  releaseHaptic: boolean;
  /** Captions for the essential audio cues. */
  captions: boolean;
}

export const AUDIO_SETTINGS_KEY = 'vc:practice:audio';

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = Object.freeze({
  v: 1,
  effects: 1,
  crowd: 1,
  music: 1,
  haptics: true,
  releaseHaptic: false,
  captions: false,
});

/** Suggested segments for a level: Off, Low, Full. */
export const AUDIO_LEVELS = [0, 0.5, 1] as const;

/** A localStorage-shaped store (src/practice/store KeyStore is one). */
export interface AudioKeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function localStore(): AudioKeyStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const level = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(1, Math.max(0, v)) * 100) / 100 : fallback);
const flag = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/** Any value → valid settings (missing or invalid fields take their defaults). */
export function normaliseAudioSettings(raw: unknown): AudioSettings {
  const d = DEFAULT_AUDIO_SETTINGS;
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    v: 1,
    effects: level(r.effects, d.effects),
    crowd: level(r.crowd, d.crowd),
    music: level(r.music, d.music),
    haptics: flag(r.haptics, d.haptics),
    releaseHaptic: flag(r.releaseHaptic, d.releaseHaptic),
    captions: flag(r.captions, d.captions),
  };
}

export function loadAudioSettings(store: AudioKeyStore | null = localStore()): AudioSettings {
  try {
    const raw = store?.getItem(AUDIO_SETTINGS_KEY);
    return normaliseAudioSettings(raw ? (JSON.parse(raw) as unknown) : null);
  } catch {
    return normaliseAudioSettings(null);
  }
}

/** False when storage is unavailable or full (the settings still apply for this session). */
function saveAudioSettings(next: AudioSettings, store: AudioKeyStore | null = localStore()): boolean {
  if (!store) return false;
  try {
    store.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

let backing: AudioKeyStore | null | undefined;
let current: Readonly<AudioSettings> | null = null;
const listeners = new Set<() => void>();

const storeOf = () => (backing === undefined ? localStore() : backing);

function adopt(next: AudioSettings): Readonly<AudioSettings> {
  current = Object.freeze(next);
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* a listener never breaks the settings */
    }
  }
  return current;
}

/** The current settings (a stable snapshot). */
export function getAudioSettings(): Readonly<AudioSettings> {
  if (!current) current = Object.freeze(loadAudioSettings(storeOf()));
  return current;
}

/** Validates, saves and applies at once; returns the new snapshot (the same one when nothing changed). */
export function setAudioSettings(patch: Partial<Omit<AudioSettings, 'v'>>): Readonly<AudioSettings> {
  const prev = getAudioSettings();
  const next = normaliseAudioSettings({ ...prev, ...patch });
  const same = (Object.keys(next) as Array<keyof AudioSettings>).every((k) => next[k] === prev[k]);
  if (same) return prev;
  saveAudioSettings(next, storeOf());
  return adopt(next);
}

/** Called after every change (useSyncExternalStore-compatible). Returns the unsubscribe function. */
export function subscribeAudioSettings(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** Back to the defaults (after "Clear Practice data"), saved and applied at once. */
export function resetAudioSettings(): Readonly<AudioSettings> {
  const next = normaliseAudioSettings(null);
  try {
    storeOf()?.removeItem(AUDIO_SETTINGS_KEY);
  } catch {
    /* ignore */
  }
  return adopt(next);
}

/** TEST HOOK: read and write this store from now on (null: none; undefined: localStorage) and forget the snapshot. */
export function setAudioSettingsStore(store: AudioKeyStore | null | undefined): void {
  backing = store;
  current = null;
}

// Captions read the stored setting when one is due, so they work before anything else has read the settings (Sound
// off, before the audio unlock, the graph never built).
setCaptionsGate(() => getAudioSettings().captions);
