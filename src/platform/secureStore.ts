/**
 * SecureStore implementations (src/contracts/adapters.ts) for session tokens.
 *
 *   Web / PWA: IndexedDB, every value AES-GCM encrypted with a non-extractable WebCrypto key that is itself kept in
 *   IndexedDB. Script on the page cannot export the key, and a copied database is useless without the browser's key
 *   store; it does not stop code running on the page (XSS) from using the session, which the CSP and the short access
 *   token lifetime address (docs/SECURITY.md).
 *   Android: a native plugin `VandeSecureStorage` backed by EncryptedSharedPreferences with a MasterKey in the Android
 *   Keystore (android/app/src/main/java/in/vande/cricket/plugins/SecureStoragePlugin.java). If the plugin is missing,
 *   rejects or does not answer, Android uses the IndexedDB store inside the app's private WebView storage.
 *   Memory: tests, and the last resort when IndexedDB is blocked (a private window): the session lasts for the tab.
 */
import type { SecureStore } from '@/contracts';
import { openDB, type IDBPDatabase } from 'idb';
import { NATIVE_TIMEOUT_MS, nativePlugin, settleWithin } from './capacitor';

export function createMemorySecureStore(): SecureStore & { dump(): Record<string, string> } {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => void m.set(k, v),
    remove: async (k) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

interface SealedValue {
  iv: Uint8Array<ArrayBuffer>;
  ct: ArrayBuffer;
}

export function createIdbSecureStore(dbName = 'vande-secure'): SecureStore {
  let dbPromise: Promise<IDBPDatabase> | null = null;
  let keyPromise: Promise<CryptoKey> | null = null;
  const db = () =>
    (dbPromise ??= openDB(dbName, 1, {
      upgrade(d) {
        d.createObjectStore('keys');
        d.createObjectStore('items');
      },
    }));
  const key = () =>
    (keyPromise ??= (async () => {
      const d = await db();
      const existing = (await d.get('keys', 'main')) as CryptoKey | undefined;
      if (existing) return existing;
      const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await d.put('keys', k, 'main');
      return k;
    })());
  const aad = (k: string) => new TextEncoder().encode(`vande-secure|${k}`);
  return {
    async get(k) {
      const value = (await (await db()).get('items', k)) as SealedValue | undefined;
      if (!value) return null;
      try {
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: value.iv, additionalData: aad(k) }, await key(), value.ct);
        return new TextDecoder().decode(pt);
      } catch {
        return null;
      }
    },
    async set(k, v) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(k) }, await key(), new TextEncoder().encode(v));
      await (await db()).put('items', { iv, ct } satisfies SealedValue, k);
    },
    async remove(k) {
      await (await db()).delete('items', k);
    },
  };
}

/** The native plugin's interface (Android: EncryptedSharedPreferences + Android Keystore). */
export interface NativeSecureStoragePlugin {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
}

export function createNativeSecureStore(plugin: NativeSecureStoragePlugin): SecureStore {
  return {
    get: async (key) => (await plugin.get({ key })).value ?? null,
    set: (key, value) => plugin.set({ key, value }),
    remove: (key) => plugin.remove({ key }),
  };
}

const PROBE_KEY = 'vc.probe';

/** Encrypted IndexedDB when it answers here, else memory (a private window, or IndexedDB blocked or stuck). */
export async function browserSecureStore(timeoutMs = NATIVE_TIMEOUT_MS): Promise<SecureStore> {
  if (typeof indexedDB !== 'undefined') {
    const store = createIdbSecureStore();
    if (await settleWithin(store.get(PROBE_KEY).then(() => true), timeoutMs, false)) return store;
  }
  return createMemorySecureStore();
}

/**
 * Best store available here: the native Keystore plugin, else encrypted IndexedDB, else memory. Always settles: a
 * native plugin that rejects, fails a write-and-read probe (a broken Keystore) or does not answer within `timeoutMs`
 * falls back to the browser store, so the app boots whatever the device does.
 */
export async function defaultSecureStore(timeoutMs = NATIVE_TIMEOUT_MS): Promise<SecureStore> {
  const boxed = await settleWithin(nativePlugin<NativeSecureStoragePlugin>('VandeSecureStorage'), timeoutMs, null);
  if (boxed) {
    const store = createNativeSecureStore(boxed.plugin);
    const probe = async () => {
      const nonce = Math.random().toString(36).slice(2, 10);
      await store.set(PROBE_KEY, nonce);
      return (await store.get(PROBE_KEY)) === nonce;
    };
    if (await settleWithin(probe(), timeoutMs, false)) return store;
  }
  return browserSecureStore(timeoutMs);
}
