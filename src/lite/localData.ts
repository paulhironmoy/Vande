/**
 * Lite keeps a few small things on the device: the best score and best Insight, the Helper/Challenger ledger
 * (`vande:lite-awards`, migrated from `vande:lite-helper`), twist attempts and rematches (`vande:lite-twists`), and the
 * run counters of the current session (`vande:lite-run`). "Delete all local data" in Settings removes all of them.
 */
import { __resetLedgerForTests } from './ledger';
import { __resetTwistStoreForTests } from './twists';

export const LITE_KEY_PREFIX = 'vande:lite-';

/** Removes every Lite key from localStorage and sessionStorage and forgets the in-memory fallbacks. Never throws. */
export function wipeLiteLocalData(): void {
  for (const store of [safe(() => localStorage), safe(() => sessionStorage)]) {
    if (!store) continue;
    try {
      const keys: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k && k.startsWith(LITE_KEY_PREFIX)) keys.push(k);
      }
      for (const k of keys) store.removeItem(k);
    } catch {
      /* storage unavailable: nothing persisted to remove */
    }
  }
  __resetLedgerForTests();
  __resetTwistStoreForTests();
  try {
    window.dispatchEvent(new Event(LITE_WIPED_EVENT));
  } catch {
    /* no window (tests, workers) */
  }
}

/** Fired after the wipe so in-memory caches (the reply landing's award memo) forget too. */
export const LITE_WIPED_EVENT = 'vande:lite-wiped';

function safe<T>(get: () => T): T | null {
  try {
    return get();
  } catch {
    return null;
  }
}
