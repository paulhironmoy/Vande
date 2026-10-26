/// <reference types="vite-plugin-pwa/client" />
/**
 * Service-worker registration with a tiny module-level status store.
 * Deliberately independent of the app store so it can be mounted anywhere.
 */
import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

export interface PwaStatus {
  registered: boolean;
  needRefresh: boolean;
  offlineReady: boolean;
  updating: boolean;
  error?: string;
}

let status: PwaStatus = { registered: false, needRefresh: false, offlineReady: false, updating: false };
const listeners = new Set<() => void>();
let updateFn: ((reloadPage?: boolean) => Promise<void>) | undefined;
let started = false;

function set(patch: Partial<PwaStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => status;

/** True inside the Capacitor shell, where the web bundle ships with the app and a service worker would only serve stale files. */
function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  try {
    return Boolean(cap?.isNativePlatform?.());
  } catch {
    return false;
  }
}

/** Removes any service worker left behind by an earlier app version so an app update is never shadowed by old caches. */
async function unregisterStaleWorkers(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* best effort */
  }
}

/** Registers the service worker once (no-op where unsupported, e.g. some WebViews or insecure contexts). */
export function registerPwa(): void {
  if (started) return;
  started = true;
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  if (isNativeShell()) {
    // The Android app bundle is the offline copy; updates arrive through the app store, not the service worker.
    void unregisterStaleWorkers();
    return;
  }
  try {
    updateFn = registerSW({
      immediate: true,
      onNeedRefresh() {
        set({ needRefresh: true });
      },
      onOfflineReady() {
        set({ offlineReady: true });
      },
      onRegisteredSW(_url, registration) {
        set({ registered: true });
        if (!registration) return;
        // Check for a new build every hour while the tab stays open.
        window.setInterval(
          () => {
            if (navigator.onLine) void registration.update();
          },
          60 * 60 * 1000,
        );
      },
      onRegisterError(error: unknown) {
        set({ error: error instanceof Error ? error.message : String(error) });
      },
    });
  } catch (error) {
    set({ error: error instanceof Error ? error.message : String(error) });
  }
}

/** Activates the waiting service worker and reloads to the new version. */
export async function applyPwaUpdate(): Promise<void> {
  if (!updateFn) return;
  set({ updating: true });
  try {
    await updateFn(true);
  } finally {
    set({ updating: false, needRefresh: false });
  }
}

/** Hides the update prompt until the next page load. */
export function dismissPwaUpdate(): void {
  set({ needRefresh: false });
}

export function usePwaStatus(): PwaStatus {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
