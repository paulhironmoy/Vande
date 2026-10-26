/** Practice preferences on this device: assistance, batting hand, graphics choice, pitch, the landing cue, first run. */
import type { AssistLevel, Handedness, PitchCondition } from '@/contracts';
import type { QualityChoice } from '@/perf';
import { PRACTICE_KEYS, isObj, localStore, readJson, writeJson, type KeyStore } from './storage';

export interface PracticeSettings {
  v: 1;
  assist: AssistLevel;
  handedness: Handedness;
  /** 'auto' follows the device check; a lower profile or Classic may be chosen, never more than the device earned. */
  quality: QualityChoice;
  /** The pitch for the next innings (optional; Balanced by default). */
  conditions: PitchCondition;
  /** Learn's optional landing cue. */
  learnCue: boolean;
  /** The first-time guided over has been completed (or the player was dismissed in it). */
  guidedDone: boolean;
  /** Deliveries the "Tap to defend · Flick to hit" hint has been shown for (it fades after a few). */
  hintsShown: number;
}

export const DEFAULT_PRACTICE_SETTINGS: PracticeSettings = {
  v: 1,
  assist: 'learn',
  handedness: 'right',
  quality: 'auto',
  conditions: 'balanced',
  learnCue: true,
  guidedDone: false,
  hintsShown: 0,
};

const ASSISTS: readonly AssistLevel[] = ['learn', 'play', 'real'];
const HANDS: readonly Handedness[] = ['right', 'left'];
const QUALITIES: readonly QualityChoice[] = ['auto', 'lite', 'standard', 'high', 'classic'];
const PITCHES: readonly PitchCondition[] = ['balanced', 'green', 'hard', 'turning'];

export function loadPracticeSettings(store: KeyStore | null = localStore()): PracticeSettings {
  const raw = readJson(store, PRACTICE_KEYS.settings);
  if (!isObj(raw)) return { ...DEFAULT_PRACTICE_SETTINGS };
  const d = DEFAULT_PRACTICE_SETTINGS;
  const pick = <T,>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
  return {
    v: 1,
    assist: pick(raw.assist, ASSISTS, d.assist),
    handedness: pick(raw.handedness, HANDS, d.handedness),
    quality: pick(raw.quality, QUALITIES, d.quality),
    conditions: pick(raw.conditions, PITCHES, d.conditions),
    learnCue: typeof raw.learnCue === 'boolean' ? raw.learnCue : d.learnCue,
    guidedDone: raw.guidedDone === true,
    hintsShown: Number.isInteger(raw.hintsShown) && (raw.hintsShown as number) >= 0 ? Math.min(99, raw.hintsShown as number) : 0,
  };
}

export function savePracticeSettings(next: PracticeSettings, store: KeyStore | null = localStore()): void {
  writeJson(store, PRACTICE_KEYS.settings, next);
}

export function updatePracticeSettings(patch: Partial<Omit<PracticeSettings, 'v'>>, store: KeyStore | null = localStore()): PracticeSettings {
  const next = { ...loadPracticeSettings(store), ...patch, v: 1 as const };
  savePracticeSettings(next, store);
  return next;
}
