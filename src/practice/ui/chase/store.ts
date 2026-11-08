/**
 * What a Target Chase keeps on the device (local only, nothing is sent): the chase being batted, so a pause, a kill or
 * a reload can resume it, and the last finished result of each seed. The shapes and their checks are CHASE-CORE's
 * (src/practice/chase); these are the reads and writes, with the same rules as the innings save: synchronous, every
 * read validates, anything damaged is treated as absent, and a save made under another simulation version is dropped.
 */
import { PRACTICE_SIM_VERSION } from '@/contracts';
import {
  CHASE_VERSION,
  isSavedChase,
  parseChaseHistory,
  type ChaseDefinition,
  type ChaseHistory,
  type SavedChase,
} from '@/practice/chase';
import type { PracticeInningsState } from '@/contracts';
import {
  PRACTICE_KEYS,
  isInningsState,
  isObj,
  localStore,
  readJson,
  removeKey,
  writeJson,
  type KeyStore,
} from '@/practice/store';

/** A saved chase and whether its last ball was cut short by the app closing (to say so on the next start). */
export interface LoadedChase {
  saved: SavedChase;
  notice: 'resumed_leave' | null;
}

/** The chase being batted, or null when there is none or it cannot be read. */
export function loadSavedChase(store: KeyStore | null = localStore()): LoadedChase | null {
  const raw = readJson(store, PRACTICE_KEYS.chase);
  if (!isObj(raw) || raw.v !== 1) return null;
  const saved = raw.saved;
  if (!isSavedChase(saved) || !isInningsState(saved.innings)) return null;
  return { saved, notice: raw.notice === 'resumed_leave' ? 'resumed_leave' : null };
}

/**
 * Why a saved chase that exists cannot be used: Practice was updated (another simulation version), or it is damaged.
 * Null when there is none, or it can be read. The flow then forgets it and says so calmly.
 */
export function droppedChase(store: KeyStore | null = localStore()): 'updated' | 'unreadable' | null {
  const raw = readJson(store, PRACTICE_KEYS.chase);
  if (raw === null) return null;
  if (isObj(raw) && raw.v === 1 && isSavedChase(raw.saved) && isInningsState((raw.saved as SavedChase).innings))
    return null;
  const saved = isObj(raw) && isObj(raw.saved) ? raw.saved : null;
  const innings = saved && isObj(saved.innings) ? saved.innings : null;
  const definition = saved && isObj(saved.definition) ? saved.definition : null;
  if (
    (innings && innings.version !== PRACTICE_SIM_VERSION) ||
    (definition && definition.simVersion !== PRACTICE_SIM_VERSION)
  )
    return 'updated';
  return 'unreadable';
}

/**
 * Saves the chase's innings (with its definition) at once; false when storage is unavailable or full. `notice` marks
 * that the last ball was resolved as a leave because the app went away during it; any later save clears it.
 */
export function saveChase(
  definition: ChaseDefinition,
  innings: PracticeInningsState,
  store: KeyStore | null = localStore(),
  notice: 'resumed_leave' | null = null,
): boolean {
  const saved: SavedChase = { v: CHASE_VERSION, definition, innings };
  return writeJson(store, PRACTICE_KEYS.chase, notice ? { v: 1, saved, notice } : { v: 1, saved });
}

export function clearChase(store: KeyStore | null = localStore()): void {
  removeKey(store, PRACTICE_KEYS.chase);
}

export function loadChaseHistory(store: KeyStore | null = localStore()): ChaseHistory {
  return parseChaseHistory(readJson(store, PRACTICE_KEYS.chaseHistory));
}

export function saveChaseHistory(history: ChaseHistory, store: KeyStore | null = localStore()): boolean {
  return writeJson(store, PRACTICE_KEYS.chaseHistory, history);
}
