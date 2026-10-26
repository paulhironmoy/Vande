/**
 * Shared hooks for the experience routes: services, the local player gate, deferred guest sign-up, "in play"
 * protection, a ticking clock for honest deadlines, and a small loader with online-aware retry and polling.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/app/store';
import { useRouter, type Route } from '@/app/router';
import { useServices, type Services } from '@/app/services';
import type { Net } from '@/net';
import type { LocalPlayer } from '@/app/storeTypes';
import { isApiClientError } from '@/net/errors';

/** Services once booted; `net` is null in offline-only builds. */
export function useNet(): { services: Services | null; net: Net | null; booting: boolean } {
  const services = useServices();
  return { services, net: services?.net ?? null, booting: services === null };
}

/** Marks the screen as "in play" (planner or innings on screen): no update prompt, permission ask or promotion. */
export function useInPlay(active: boolean): void {
  const setInPlay = useApp((s) => s.setInPlay);
  useEffect(() => {
    setInPlay(active);
    return () => setInPlay(false);
  }, [active, setInPlay]);
}

const AFTER_START_KEY = 'vc:after-start';

/** Where first run should continue after onboarding (e.g. back to an invite). */
export function setAfterStart(route: Route | null): void {
  try {
    if (route) sessionStorage.setItem(AFTER_START_KEY, JSON.stringify(route));
    else sessionStorage.removeItem(AFTER_START_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function takeAfterStart(): Route | null {
  try {
    const raw = sessionStorage.getItem(AFTER_START_KEY);
    sessionStorage.removeItem(AFTER_START_KEY);
    return raw ? (JSON.parse(raw) as Route) : null;
  } catch {
    return null;
  }
}

const AFTER_TRAINING_KEY = 'vc:after-training';

/** Where Training should lead when it ends (e.g. back to the match an invited friend just joined). */
export function setAfterTraining(route: Route | null): void {
  try {
    if (route) sessionStorage.setItem(AFTER_TRAINING_KEY, JSON.stringify(route));
    else sessionStorage.removeItem(AFTER_TRAINING_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function peekAfterTraining(): Route | null {
  try {
    const raw = sessionStorage.getItem(AFTER_TRAINING_KEY);
    return raw ? (JSON.parse(raw) as Route) : null;
  } catch {
    return null;
  }
}

/** The local player, sending first-time visitors to onboarding (and back here afterwards). */
export function usePlayerGate(here: Route): LocalPlayer | null {
  const player = useApp((s) => s.player);
  const navigate = useRouter((s) => s.navigate);
  useEffect(() => {
    if (player) return;
    setAfterStart(here.name === 'home' ? null : here);
    navigate({ name: 'onboarding' }, { replace: true });
  }, [player, here, navigate]);
  return player;
}

export type SyncState = 'idle' | 'syncing' | 'ok' | 'offline' | 'alias_rejected' | 'error';

/**
 * Guest sign-up, later and automatically: a player created offline (or before the API answered) gets their server
 * account as soon as the app is online, with the alias, avatar, kit and language they chose.
 */
export async function syncAccount(net: Net, player: LocalPlayer, locale: string): Promise<{ id: string } | { error: SyncState }> {
  try {
    const tokens = await net.session.ensure(player.alias);
    try {
      await net.api.call('PATCH /v1/me', { body: { avatar: player.avatar, kit: player.kit, locale: locale as never } });
    } catch {
      /* the profile can be completed later; the account exists */
    }
    return { id: tokens.playerId };
  } catch (e) {
    if (isApiClientError(e)) {
      if (e.code === 'invalid') return { error: 'alias_rejected' };
      if (e.retryable) return { error: 'offline' };
    }
    return { error: 'error' };
  }
}

export function useAccountSync(): SyncState {
  const { net } = useNet();
  const player = useApp((s) => s.player);
  const online = useApp((s) => s.online);
  const [state, setState] = useState<SyncState>(player?.id ? 'ok' : 'idle');
  const busy = useRef(false);
  useEffect(() => {
    if (!net || !player || player.id || !online || busy.current) return;
    busy.current = true;
    setState('syncing');
    void syncAccount(net, player, useApp.getState().settings.locale).then((r) => {
      busy.current = false;
      if ('id' in r) {
        const current = useApp.getState().player;
        if (current) useApp.getState().setPlayer({ ...current, id: r.id });
        setState('ok');
      } else setState(r.error);
    });
  }, [net, player, online]);
  return player?.id ? 'ok' : state;
}

/** Current time, ticking every `ms` (for countdowns to server deadlines). */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export interface Loaded<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/**
 * Runs `fn` now, again when `deps` change, when the app comes back online after an error, and every `pollMs` while
 * the page is visible (when given). Keeps the last good data while reloading.
 */
export function useLoad<T>(fn: (() => Promise<T>) | null, deps: unknown[], opts: { pollMs?: number | null } = {}): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(fn));
  const [tick, setTick] = useState(0);
  const online = useApp((s) => s.online);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    const run = fnRef.current;
    if (!run) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    run().then(
      (v) => {
        if (!alive) return;
        setData(v);
        setError(null);
        setLoading(false);
      },
      (e) => {
        if (!alive) return;
        setError(e);
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, Boolean(fn)]);

  // Back online after a failure: try again.
  useEffect(() => {
    if (online && error) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  useEffect(() => {
    const ms = opts.pollMs;
    if (!ms || !fn) return;
    const id = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') reload();
    }, ms);
    return () => clearInterval(id);
  }, [opts.pollMs, Boolean(fn), reload]);

  return { data, error, loading, reload };
}
