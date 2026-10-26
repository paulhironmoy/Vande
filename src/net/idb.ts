/**
 * The app's network database (IndexedDB via `idb`): the outbox and a small key-value store for in-flight request
 * keys. Falls back to memory when IndexedDB is unavailable (private windows that block it), so nothing throws.
 */
import { openDB, type IDBPDatabase } from 'idb';

export const NET_DB = 'vande-net';
const VERSION = 1;

export interface KeyValue {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const opened = new Map<string, Promise<IDBPDatabase | null>>();

export function openNetDb(name = NET_DB): Promise<IDBPDatabase | null> {
  let db = opened.get(name);
  if (!db) {
    db = (typeof indexedDB === 'undefined'
      ? Promise.resolve(null)
      : openDB(name, VERSION, {
          upgrade(d) {
            if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'id' });
            if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
          },
        })
    ).catch(() => null);
    opened.set(name, db);
  }
  return db;
}

/** Test hook: closes and forgets opened databases. */
export async function __closeNetDbs(): Promise<void> {
  for (const p of opened.values()) (await p)?.close();
  opened.clear();
}

export function memoryKeyValue(): KeyValue {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => void m.set(k, v),
    remove: async (k) => void m.delete(k),
  };
}

export function idbKeyValue(name = NET_DB): KeyValue {
  const fallback = memoryKeyValue();
  return {
    async get(k) {
      const db = await openNetDb(name);
      if (!db) return fallback.get(k);
      return ((await db.get('kv', k)) as string | undefined) ?? null;
    },
    async set(k, v) {
      const db = await openNetDb(name);
      if (!db) return fallback.set(k, v);
      await db.put('kv', v, k);
    },
    async remove(k) {
      const db = await openNetDb(name);
      if (!db) return fallback.remove(k);
      await db.delete('kv', k);
    },
  };
}
