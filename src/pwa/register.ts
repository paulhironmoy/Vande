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

/** Registers the service worker once (no-op where unsupported, e.g. some WebViews or insecure contexts). */
export function registerPwa(): void {
  if (started) return;
  started = true;
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
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

export function getPwaStatus(): PwaStatus {
  return status;
}
