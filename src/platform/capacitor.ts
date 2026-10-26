/** Capacitor detection without loading Capacitor on the web (the bridge object exists only in the native shell). */

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  isPluginAvailable?: (name: string) => boolean;
}

function cap(): CapacitorGlobal | undefined {
  return (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
}

export function isNativePlatform(): boolean {
  try {
    return Boolean(cap()?.isNativePlatform?.());
  } catch {
    return false;
  }
}

/** True when the native side of a Capacitor plugin is installed in this build. */
export function nativePluginAvailable(name: string): boolean {
  try {
    return isNativePlatform() && Boolean(cap()?.isPluginAvailable?.(name));
  } catch {
    return false;
  }
}

/**
 * A native plugin in a box. Never resolve a promise with a Capacitor plugin proxy, here or in any caller: the proxy
 * answers every property, `then` included, so `await proxy` (or returning the proxy from an async function) calls a
 * native method "then" that does not exist. On Android that await never settles (logcat: `"VandeSecureStorage.then()"
 * is not implemented on android`) and everything waiting on it hangs. Keep the proxy in the box; unwrap it where a
 * method is called.
 */
export interface PluginBox<T> {
  readonly plugin: T;
}

const registered = new Map<string, unknown>();
let core: Promise<typeof import('@capacitor/core')> | null = null;

/** A native plugin by name (no JS package needed), boxed, or null on the web or when the plugin is not installed. */
export async function nativePlugin<T>(name: string): Promise<PluginBox<T> | null> {
  if (!nativePluginAvailable(name)) return null;
  // One load of the core for every plugin (a failed chunk load is retried next time).
  const { registerPlugin } = await (core ??= import('@capacitor/core').catch((e: unknown) => {
    core = null;
    throw e;
  }));
  // Register each name once (Capacitor warns on a second registration).
  if (!registered.has(name)) registered.set(name, registerPlugin<T & object>(name));
  return { plugin: registered.get(name) as T };
}

/** How long boot waits for a native answer before falling back. */
export const NATIVE_TIMEOUT_MS = 3_000;

/**
 * The value of `work`, or `fallback` when it rejects or takes longer than `ms`: a native bridge that never answers
 * must not hold up the app. The value must not be a plugin proxy (box it, see PluginBox).
 */
export function settleWithin<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}
