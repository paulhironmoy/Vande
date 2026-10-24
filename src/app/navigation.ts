/**
 * Keeps the browser URL/history, the Android hardware back button and the store's navigation stack in sync.
 * The store is the source of truth; history entries mirror it so that back always means "one step back".
 */
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { flushPersistence, useApp } from './store';
import { buildUrl } from './routes';

function replaceUrl(): void {
  try {
    const url = buildUrl(useApp.getState().screen);
    history.replaceState({ vande: true }, '', url);
  } catch {
    /* ignore (e.g. file:// or sandboxed) */
  }
}

function pushUrl(): void {
  try {
    const url = buildUrl(useApp.getState().screen);
    history.pushState({ vande: true }, '', url);
  } catch {
    /* ignore */
  }
}

export function useNavigationSync(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let ignoreNext = false;

    // Mirror store navigation into history.
    const unsub = useApp.subscribe((s, prev) => {
      if (s.screen === prev.screen) return;
      if (ignoreNext) {
        ignoreNext = false;
        replaceUrl();
        return;
      }
      if (s.stack.length > prev.stack.length) pushUrl();
      else replaceUrl();
    });

    // Browser / hardware back (web).
    const onPop = () => {
      const before = useApp.getState().screen;
      ignoreNext = true;
      const handled = useApp.getState().back();
      const after = useApp.getState().screen;
      if (before === after) {
        ignoreNext = false;
        // The press was consumed (e.g. gameplay paused) or we are at the root: restore the entry.
        if (handled) pushUrl();
        else replaceUrl();
      }
    };
    window.addEventListener('popstate', onPop);

    // Online status.
    const onOnline = () => useApp.setState({ online: true });
    const onOffline = () => useApp.setState({ online: false });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // Flush gameplay persistence when the page is hidden/unloaded.
    const onPageHide = () => {
      void flushPersistence();
    };
    window.addEventListener('pagehide', onPageHide);

    // Android hardware back button (Capacitor).
    let removeNative: (() => void) | undefined;
    let cancelled = false;
    if (Capacitor.isNativePlatform()) {
      void import('@capacitor/app')
        .then(async ({ App }) => {
          if (cancelled) return;
          const handle = await App.addListener('backButton', () => {
            const handled = useApp.getState().back();
            if (!handled) void App.exitApp();
          });
          removeNative = () => void handle.remove();
          const stateHandle = await App.addListener('appStateChange', ({ isActive }) => {
            if (!isActive) {
              const s = useApp.getState();
              if (s.game?.status === 'running') s.pauseGame();
              void flushPersistence();
            }
          });
          const prevRemove = removeNative;
          removeNative = () => {
            prevRemove();
            void stateHandle.remove();
          };
        })
        .catch(() => undefined);
    }

    return () => {
      cancelled = true;
      unsub();
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('pagehide', onPageHide);
      removeNative?.();
    };
  }, []);

  // Once hydrated, make sure the URL reflects the resolved screen (deep links normalise, "/" stays "/").
  const hydrated = useApp((s) => s.hydrated);
  useEffect(() => {
    if (hydrated) replaceUrl();
  }, [hydrated]);
}
