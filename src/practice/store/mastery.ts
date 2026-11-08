/**
 * Exact-ball mastery on this device: one MasteryState per exact ball (src/practice/coach masteryKey), so practising a
 * ball again later continues where it was left. The coach engine decides progress (never one lucky result); this
 * file only keeps the states, validated on every read and bounded to the most recently practised balls.
 */
import { PRACTICE_SIM_VERSION, type ContactKind, type Decision, type MasteryAttempt, type MasteryState, type PlayedFootwork } from '@/contracts';
import { PRACTICE_KEYS, isInt, isNum, isObj, localStore, readJson, writeJson, type KeyStore } from './storage';

/** Balls kept (least recently practised dropped first), and attempts kept per ball. */
export const MASTERY_MAX_BALLS = 60;
const MASTERY_MAX_ATTEMPTS = 40;

const STAGES: readonly number[] = [1, 2, 3, 4];
const DECISIONS: readonly Decision[] = ['leave', 'defend', 'attack'];
const FOOTWORK: readonly PlayedFootwork[] = ['forward', 'back', 'across', 'down_track'];
const CONTACTS: readonly ContactKind[] = ['middle', 'inside_edge', 'outside_edge', 'top_edge', 'leading_edge', 'pad', 'body', 'miss', 'leave'];

function isAttempt(v: unknown): v is MasteryAttempt {
  return (
    isObj(v) &&
    STAGES.includes(v.stage as number) &&
    DECISIONS.includes(v.decision as Decision) &&
    FOOTWORK.includes(v.footwork as PlayedFootwork) &&
    (v.timingErrorMs === null || isNum(v.timingErrorMs)) &&
    CONTACTS.includes(v.contact as ContactKind) &&
    isInt(v.runs) &&
    typeof v.out === 'boolean' &&
    typeof v.success === 'boolean'
  );
}

function isMasteryStateShape(v: unknown): v is MasteryState {
  return isObj(v) && typeof v.key === 'string' && v.key.length > 0 && v.key.length < 300 && STAGES.includes(v.stage as number) && Array.isArray(v.attempts) && v.attempts.every(isAttempt) && typeof v.mastered === 'boolean';
}

interface Saved {
  v: 2;
  simVersion: typeof PRACTICE_SIM_VERSION;
  /** Most recently practised last. */
  items: MasteryState[];
}

function load(store: KeyStore | null): Saved {
  const raw = readJson(store, PRACTICE_KEYS.mastery);
  if (!isObj(raw) || raw.v !== 2 || raw.simVersion !== PRACTICE_SIM_VERSION || !Array.isArray(raw.items)) {
    return { v: 2, simVersion: PRACTICE_SIM_VERSION, items: [] };
  }
  return { v: 2, simVersion: PRACTICE_SIM_VERSION, items: raw.items.filter(isMasteryStateShape) };
}

/** The saved mastery of one exact ball, or null when it has never been practised. */
export function loadMastery(key: string, store: KeyStore | null = localStore()): MasteryState | null {
  return load(store).items.find((m) => m.key === key) ?? null;
}

/** Saves (or replaces) one ball's mastery as the most recent; false when storage is unavailable. */
export function saveMastery(state: MasteryState, store: KeyStore | null = localStore()): boolean {
  const saved = load(store);
  const trimmed: MasteryState = { ...state, attempts: state.attempts.slice(-MASTERY_MAX_ATTEMPTS) };
  const items = [...saved.items.filter((m) => m.key !== state.key), trimmed].slice(-MASTERY_MAX_BALLS);
  return writeJson(store, PRACTICE_KEYS.mastery, { v: 2, simVersion: PRACTICE_SIM_VERSION, items } satisfies Saved);
}

/** Every saved mastery (most recently practised last). */
export function allMastery(store: KeyStore | null = localStore()): MasteryState[] {
  return load(store).items;
}

