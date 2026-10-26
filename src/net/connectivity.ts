/**
 * Connectivity: the browser's online/offline events, page visibility, Capacitor's app resume, and what the API
 * client actually experienced (two network failures in a row mean offline, any answer means online). Pushes the
 * result into the root store's `setOnline`, and calls `onOnline` / `onResume` so the outbox flushes at once.
 */

/** The bits of `window` / `document` used here (structural, so tests can pass fakes). */
export interface EventSourceLike {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface ConnectivityOptions {
  setOnline(online: boolean): void;
  onOnline?: () => void;
  onResume?: () => void;
  target?: EventSourceLike;
  nav?: { onLine?: boolean };
  doc?: EventSourceLike & { visibilityState: DocumentVisibilityState };
  /** Subscribes to the native app's resume event (Capacitor App plugin); returns an unsubscribe function. */
  appResume?: (cb: () => void) => Promise<() => void>;
}

export interface Connectivity {
  online(): boolean;
  /** Feed from the API client: true when the server answered, false on a network failure or timeout. */
  report(reachable: boolean): void;
  stop(): void;
}

export const FAILURES_BEFORE_OFFLINE = 2;

export function startConnectivity(o: ConnectivityOptions): Connectivity {
  const target = o.target ?? (typeof window !== 'undefined' ? window : undefined);
  const nav = o.nav ?? (typeof navigator !== 'undefined' ? navigator : undefined);
  const doc = o.doc ?? (typeof document !== 'undefined' ? document : undefined);
  let online = nav?.onLine !== false;
  let failures = 0;
  const set = (v: boolean) => {
    if (v === online) return;
    online = v;
    o.setOnline(v);
    if (v) o.onOnline?.();
  };
  o.setOnline(online);
  const onOnline = () => {
    failures = 0;
    set(true);
    o.onOnline?.();
  };
  const onOffline = () => set(false);
  const onVisible = () => {
    if (doc?.visibilityState === 'visible') o.onResume?.();
  };
  target?.addEventListener('online', onOnline);
  target?.addEventListener('offline', onOffline);
  doc?.addEventListener('visibilitychange', onVisible);
  let unsubscribeResume: (() => void) | null = null;
  let stopped = false;
  void o
    .appResume?.(() => o.onResume?.())
    .then((u) => {
      if (stopped) u();
      else unsubscribeResume = u;
    })
    .catch(() => undefined);
  return {
    online: () => online,
    report(reachable) {
      if (reachable) {
        failures = 0;
        set(true);
      } else if (++failures >= FAILURES_BEFORE_OFFLINE) {
        set(false);
      }
    },
    stop() {
      stopped = true;
      target?.removeEventListener('online', onOnline);
      target?.removeEventListener('offline', onOffline);
      doc?.removeEventListener('visibilitychange', onVisible);
      unsubscribeResume?.();
    },
  };
}

/** Capacitor's App 'resume' event when running natively (no-op on the web). */
export async function capacitorResume(cb: () => void): Promise<() => void> {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return () => undefined;
  const { App } = await import('@capacitor/app');
  const handle = await App.addListener('resume', cb);
  return () => void handle.remove();
}
