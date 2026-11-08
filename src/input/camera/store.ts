/**
 * Where the pack is kept between visits: IndexedDB, in app storage. Not Cache Storage: in the Android shell
 * src/pwa/register.ts deletes every Cache Storage key at every launch (RULINGS R-4). Entries are keyed by pack id, so a new
 * pack never reads an old file and old entries are removed on every start.
 */
export interface PackStore {
  get(key: string): Promise<Blob | undefined>;
  put(key: string, blob: Blob): Promise<void>;
  /** Every key that does not start with `prefix` is removed (older pack ids). */
  keepOnly(prefix: string): Promise<void>;
  clear(): Promise<void>;
}

export function memoryStore(): PackStore & { map: Map<string, Blob> } {
  const map = new Map<string, Blob>();
  return {
    map,
    get: async (k) => map.get(k),
    put: async (k, b) => void map.set(k, b),
    keepOnly: async (p) => {
      for (const k of [...map.keys()]) if (!k.startsWith(p)) map.delete(k);
    },
    clear: async () => map.clear(),
  };
}

const DB = 'vande-camera';
const STORE = 'files';

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

export function indexedDbStore(
  factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB,
): PackStore | null {
  if (!factory) return null;
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const r = factory.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error('IndexedDB could not open'));
    });
  const withStore = async <T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => Promise<T>): Promise<T> => {
    const db = await open();
    try {
      return await run(db.transaction(STORE, mode).objectStore(STORE));
    } finally {
      db.close();
    }
  };
  return {
    get: (k) => withStore('readonly', async (s) => (await request(s.get(k))) as Blob | undefined),
    put: (k, b) => withStore('readwrite', async (s) => void (await request(s.put(b, k)))),
    keepOnly: (p) =>
      withStore('readwrite', async (s) => {
        const keys = (await request(s.getAllKeys())) as string[];
        await Promise.all(keys.filter((k) => !String(k).startsWith(p)).map((k) => request(s.delete(k))));
      }),
    clear: () => withStore('readwrite', async (s) => void (await request(s.clear()))),
  };
}

/** Deletes the downloaded pack ("Clear Practice data"). Never throws. */
export async function forgetCameraPack(): Promise<void> {
  try {
    await indexedDbStore()?.clear();
  } catch {
    /* nothing stored, or storage blocked */
  }
}
