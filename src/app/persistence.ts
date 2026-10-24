/**
 * Local persistence. IndexedDB via `idb`, with a transparent in-memory + localStorage fallback
 * (private browsing, blocked storage, very old WebViews). Nothing here ever leaves the device.
 */
import { openDB, type IDBPDatabase } from 'idb';
import type {
  CampaignProgress,
  DailyRecord,
  HistoryEntry,
  PersonalBests,
  RepublicCondition,
  ScenarioId,
  Settings,
} from '@/engine/types';

export type StoreName = 'settings' | 'republic' | 'bests' | 'history' | 'daily' | 'session' | 'meta';
export const STORE_NAMES: readonly StoreName[] = ['settings', 'republic', 'bests', 'history', 'daily', 'session', 'meta'] as const;

const DB_NAME = 'vande';
const DB_VERSION = 1;
const KEY = 'current';
const LS_PREFIX = 'vande:';

/** Which scenarios the current run plays, in order, plus how it was started. */
export interface SessionPlan {
  scenarioIds: ScenarioId[];
  challengeCode?: string;
  dailyDate?: string;
}

/** Gameplay UI context preserved across refresh, rotation and layout changes. */
export interface SessionUi {
  openEvidenceId?: string;
  trayOpen: boolean;
  focusDistrict?: string;
}

export interface SessionRecord {
  progress: CampaignProgress;
  plan: SessionPlan;
  ui: SessionUi;
  savedAt: string;
}

export interface MetaRecord {
  introDone?: boolean;
  createdAt?: string;
  lastSeenVersion?: string;
}

interface Backend {
  readonly kind: 'idb' | 'memory';
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  set<T>(store: StoreName, key: string, value: T): Promise<void>;
  del(store: StoreName, key: string): Promise<void>;
  clear(): Promise<void>;
}

class IdbBackend implements Backend {
  readonly kind = 'idb' as const;
  constructor(private db: IDBPDatabase) {}
  async get<T>(store: StoreName, key: string): Promise<T | undefined> {
    return (await this.db.get(store, key)) as T | undefined;
  }
  async set<T>(store: StoreName, key: string, value: T): Promise<void> {
    await this.db.put(store, value, key);
  }
  async del(store: StoreName, key: string): Promise<void> {
    await this.db.delete(store, key);
  }
  async clear(): Promise<void> {
    const tx = this.db.transaction([...STORE_NAMES], 'readwrite');
    await Promise.all([...STORE_NAMES.map((s) => tx.objectStore(s).clear()), tx.done]);
  }
  close(): void {
    try {
      this.db.close();
    } catch {
      /* ignore */
    }
  }
}

class MemoryBackend implements Backend {
  readonly kind = 'memory' as const;
  private data = new Map<string, unknown>();
  private ls: Storage | null;
  constructor() {
    this.ls = safeLocalStorage();
    if (this.ls) {
      for (let i = 0; i < this.ls.length; i++) {
        const k = this.ls.key(i);
        if (k && k.startsWith(LS_PREFIX)) {
          try {
            this.data.set(k.slice(LS_PREFIX.length), JSON.parse(this.ls.getItem(k) ?? 'null'));
          } catch {
            /* ignore corrupt entry */
          }
        }
      }
    }
  }
  private k(store: StoreName, key: string) {
    return `${store}:${key}`;
  }
  async get<T>(store: StoreName, key: string): Promise<T | undefined> {
    return this.data.get(this.k(store, key)) as T | undefined;
  }
  async set<T>(store: StoreName, key: string, value: T): Promise<void> {
    this.data.set(this.k(store, key), value);
    try {
      this.ls?.setItem(LS_PREFIX + this.k(store, key), JSON.stringify(value));
    } catch {
      /* quota or blocked — keep in memory only */
    }
  }
  async del(store: StoreName, key: string): Promise<void> {
    this.data.delete(this.k(store, key));
    try {
      this.ls?.removeItem(LS_PREFIX + this.k(store, key));
    } catch {
      /* ignore */
    }
  }
  async clear(): Promise<void> {
    this.data.clear();
    try {
      if (this.ls) {
        const keys: string[] = [];
        for (let i = 0; i < this.ls.length; i++) {
          const k = this.ls.key(i);
          if (k && k.startsWith(LS_PREFIX)) keys.push(k);
        }
        keys.forEach((k) => this.ls!.removeItem(k));
      }
    } catch {
      /* ignore */
    }
  }
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = '__vande_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

let backendPromise: Promise<Backend> | null = null;

async function openBackend(): Promise<Backend> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no indexedDB');
    const db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(upgradeDb) {
        for (const name of STORE_NAMES) {
          if (!upgradeDb.objectStoreNames.contains(name)) upgradeDb.createObjectStore(name);
        }
      },
      blocked() {
        /* another tab holds an old version; we still proceed with the fallback */
      },
    });
    // Smoke-test a write so that broken IDB implementations fall back cleanly.
    await db.put('meta', { probe: true }, '__probe__');
    await db.delete('meta', '__probe__');
    return new IdbBackend(db);
  } catch {
    return new MemoryBackend();
  }
}

function backend(): Promise<Backend> {
  if (!backendPromise) backendPromise = openBackend();
  return backendPromise;
}

/** Test helper: close the connection, optionally delete the database, and start fresh next time. */
export async function __resetPersistenceForTests(deleteDb = true): Promise<void> {
  if (backendPromise) {
    try {
      const b = await backendPromise;
      if (b instanceof IdbBackend) b.close();
      else await b.clear();
    } catch {
      /* ignore */
    }
  }
  backendPromise = null;
  if (deleteDb && typeof indexedDB !== 'undefined') {
    await new Promise<void>((resolve) => {
      try {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}

async function get<T>(store: StoreName): Promise<T | undefined> {
  return (await backend()).get<T>(store, KEY);
}
async function set<T>(store: StoreName, value: T): Promise<void> {
  return (await backend()).set(store, KEY, value);
}
async function del(store: StoreName): Promise<void> {
  return (await backend()).del(store, KEY);
}

export const storage = {
  getSettings: () => get<Settings>('settings'),
  setSettings: (v: Settings) => set('settings', v),
  getRepublic: () => get<RepublicCondition>('republic'),
  setRepublic: (v: RepublicCondition) => set('republic', v),
  getBests: () => get<PersonalBests>('bests'),
  setBests: (v: PersonalBests) => set('bests', v),
  getHistory: () => get<HistoryEntry[]>('history'),
  setHistory: (v: HistoryEntry[]) => set('history', v),
  getDaily: () => get<DailyRecord[]>('daily'),
  setDaily: (v: DailyRecord[]) => set('daily', v),
  getSession: () => get<SessionRecord>('session'),
  setSession: (v: SessionRecord) => set('session', v),
  clearSession: () => del('session'),
  getMeta: () => get<MetaRecord>('meta'),
  setMeta: (v: MetaRecord) => set('meta', v),
  async clearAll(): Promise<void> {
    await (await backend()).clear();
  },
  async backendKind(): Promise<'idb' | 'memory'> {
    return (await backend()).kind;
  },
  /** Everything stored locally, as a plain object (for export). */
  async exportAll(): Promise<Record<StoreName, unknown>> {
    const b = await backend();
    const out = {} as Record<StoreName, unknown>;
    for (const name of STORE_NAMES) out[name] = (await b.get(name, KEY)) ?? null;
    return out;
  },
  async estimateUsage(): Promise<{ usage: number; quota: number } | undefined> {
    try {
      if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
        const e = await navigator.storage.estimate();
        return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
      }
    } catch {
      /* ignore */
    }
    return undefined;
  },
};
