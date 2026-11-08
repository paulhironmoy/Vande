/**
 * Practice preferences on this device: assistance, batting hand, graphics, the Random Over's choices (difficulty,
 * pitch, bowling type), Learn's landing cue, and how many deliveries the input hint has been shown for. Sound levels and
 * captions belong to src/audio (its own key, cleared with Practice data).
 */
import type { AssistLevel, BowlerFamily, Difficulty, Handedness, PitchCondition } from '@/contracts';
import type { QualityChoice } from '@/perf';
import { PRACTICE_KEYS, isObj, localStore, readJson, writeJson, type KeyStore } from './storage';

/** The Random Over's optional bowling-type constraint. */
export type BowlingChoice = BowlerFamily | 'any';

export interface PracticeSettings {
  v: 1;
  assist: AssistLevel;
  handedness: Handedness;
  /** 'auto' follows the device check; a lower presentation may be chosen, never more than the device earned. */
  quality: QualityChoice;
  /** The Random Over's pitch (Quick Practice always bowls on Balanced). */
  conditions: PitchCondition;
  /** The Random Over's difficulty (Quick Practice uses Club). */
  difficulty: Difficulty;
  /** The Random Over's bowling type. */
  bowling: BowlingChoice;
  /** Learn's optional landing cue. */
  learnCue: boolean;
  /** The stage's optional, subtle focus aid around the ball (off by default). */
  focusAid: boolean;
  /** Deliveries the "Tap to defend · Flick to hit" hint has been shown for (it stops after a few). */
  hintsShown: number;
  /** Teaching (the first-run demonstration, the pre-delivery hint, plain-word glosses); one tap turns it off for good. */
  teach: boolean;
  /** The first-run demonstration has been watched or skipped. */
  demoSeen: boolean;
}

export const DEFAULT_PRACTICE_SETTINGS: PracticeSettings = {
  v: 1,
  assist: 'learn',
  handedness: 'right',
  quality: 'auto',
  conditions: 'balanced',
  difficulty: 'club',
  bowling: 'any',
  learnCue: true,
  focusAid: false,
  hintsShown: 0,
  teach: true,
  demoSeen: false,
};

const ASSISTS: readonly AssistLevel[] = ['learn', 'play', 'real'];
const HANDS: readonly Handedness[] = ['right', 'left'];
const QUALITIES: readonly QualityChoice[] = ['auto', 'lite', 'standard', 'high', 'classic'];
const PITCHES: readonly PitchCondition[] = ['balanced', 'green', 'hard', 'turning'];
const DIFFICULTIES: readonly Difficulty[] = ['beginner', 'club', 'expert'];
const BOWLING: readonly BowlingChoice[] = ['any', 'pace', 'spin'];

export function loadPracticeSettings(store: KeyStore | null = localStore()): PracticeSettings {
  const raw = readJson(store, PRACTICE_KEYS.settings);
  if (!isObj(raw)) return { ...DEFAULT_PRACTICE_SETTINGS };
  const d = DEFAULT_PRACTICE_SETTINGS;
  const pick = <T>(v: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback;
  return {
    v: 1,
    assist: pick(raw.assist, ASSISTS, d.assist),
    handedness: pick(raw.handedness, HANDS, d.handedness),
    quality: pick(raw.quality, QUALITIES, d.quality),
    conditions: pick(raw.conditions, PITCHES, d.conditions),
    difficulty: pick(raw.difficulty, DIFFICULTIES, d.difficulty),
    bowling: pick(raw.bowling, BOWLING, d.bowling),
    learnCue: typeof raw.learnCue === 'boolean' ? raw.learnCue : d.learnCue,
    focusAid: raw.focusAid === true,
    hintsShown:
      Number.isInteger(raw.hintsShown) && (raw.hintsShown as number) >= 0 ? Math.min(99, raw.hintsShown as number) : 0,
    teach: raw.teach !== false,
    demoSeen: raw.demoSeen === true,
  };
}

function savePracticeSettings(next: PracticeSettings, store: KeyStore | null = localStore()): void {
  writeJson(store, PRACTICE_KEYS.settings, next);
}

export function updatePracticeSettings(
  patch: Partial<Omit<PracticeSettings, 'v'>>,
  store: KeyStore | null = localStore(),
): PracticeSettings {
  const next = { ...loadPracticeSettings(store), ...patch, v: 1 as const };
  savePracticeSettings(next, store);
  return next;
}
