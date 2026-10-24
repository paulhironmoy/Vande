import type { CommunityStorage, OutboxItem, StatsCacheEntry } from './types';

const OUTBOX_KEY = 'vande:community:outbox';
const STATS_KEY = 'vande:community:stats';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: in-memory only for this session */
  }
}

/** Default adapter: localStorage with an in-memory mirror. The lead can replace it via `setCommunityStorage`. */
export function createLocalStorageAdapter(): CommunityStorage {
  let outbox: OutboxItem[] | undefined;
  let stats: Record<string, StatsCacheEntry> | undefined;
  return {
    async getOutbox() {
      outbox = outbox ?? readJson<OutboxItem[]>(OUTBOX_KEY, []);
      return outbox;
    },
    async setOutbox(items) {
      outbox = items;
      writeJson(OUTBOX_KEY, items);
    },
    async getStats(dailyId) {
      stats = stats ?? readJson<Record<string, StatsCacheEntry>>(STATS_KEY, {});
      return stats[dailyId];
    },
    async setStats(dailyId, entry) {
      stats = stats ?? readJson<Record<string, StatsCacheEntry>>(STATS_KEY, {});
      stats[dailyId] = entry;
      // keep the cache small
      const keys = Object.keys(stats).sort();
      while (keys.length > 60) delete stats[keys.shift() as string];
      writeJson(STATS_KEY, stats);
    },
  };
}

let current: CommunityStorage = createLocalStorageAdapter();

export function setCommunityStorage(storage: CommunityStorage): void {
  current = storage;
}

export function communityStorage(): CommunityStorage {
  return current;
}

/** Clears local community data (used by delete-all). */
export async function clearCommunityStorage(): Promise<void> {
  try {
    await current.setOutbox([]);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(OUTBOX_KEY);
      localStorage.removeItem(STATS_KEY);
    }
  } catch {
    /* ignore */
  }
}
