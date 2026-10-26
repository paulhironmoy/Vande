/**
 * Practice keeps everything on the device, in localStorage: synchronous, so the in-flight flag is written before a
 * delivery starts, and it survives an Android pause, a kill and a reload. Every read validates; anything corrupt is
 * treated as absent. Nothing here is ever sent anywhere.
 */
export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Every key Practice owns ("Delete local data" clears them all through clearPracticeData). */
export const PRACTICE_KEYS = {
  innings: 'vc:practice:innings',
  settings: 'vc:practice:settings',
  calibration: 'vc:practice:calibration',
  metrics: 'vc:practice:metrics',
  draft: 'vc:practice:draft',
} as const;

export function localStore(): KeyStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readJson(store: KeyStore | null, key: string): unknown {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

/** Writes JSON; false when storage is unavailable or full (the caller decides whether that matters). */
export function writeJson(store: KeyStore | null, key: string, value: unknown): boolean {
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(store: KeyStore | null, key: string): void {
  try {
    store?.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** A KeyStore in memory (tests, and a fallback when storage is blocked). */
export function memoryStore(): KeyStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

export const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const isInt = (v: unknown): v is number => Number.isInteger(v);
