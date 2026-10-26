/**
 * Hooks shared by the social screens: services, the local-player gate, the server account behind it, a small
 * resource loader (keeps the last good data, retries when the app comes back online, polls only while visible),
 * mutations with honest error states, and a ticking clock for real deadlines.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/app/store';
import { useRouter, type Route } from '@/app/router';
import { useServices, type Services } from '@/app/services';
import type { LocalPlayer } from '@/app/storeTypes';
import type { Net } from '@/net';
import { isAgeNotConfirmed, isApiClientError } from '@/net/errors';
import { setAfterStart } from '@/screens/app/hooks';

export function useSocialServices(): { services: Services | null; net: Net | null; booting: boolean } {
  const services = useServices();
  return { services, net: services?.net ?? null, booting: services === null };
}

export type SocialFailure = 'offline' | 'not_found' | 'forbidden' | 'sealed' | 'expired' | 'rate_limited' | 'conflict' | 'invalid' | 'signed_out' | 'unavailable' | 'age_required' | 'error';

export function socialFailure(e: unknown): SocialFailure {
  // No account without the age confirmation (18+): not a "members only" refusal.
  if (isAgeNotConfirmed(e)) return 'age_required';
  if (!isApiClientError(e)) return 'error';
  switch (e.code) {
    case 'network':
    case 'timeout':
    case 'offline':
      return 'offline';
    case 'not_found':
      return 'not_found';
    case 'forbidden':
      return 'forbidden';
    case 'sealed':
      return 'sealed';
    case 'deadline_passed':
      return 'expired';
    case 'rate_limited':
      return 'rate_limited';
    case 'conflict':
    case 'already_locked':
    case 'not_your_turn':
      return 'conflict';
    case 'invalid':
      return 'invalid';
    case 'unauthorized':
      return 'signed_out';
    case 'unavailable':
      return 'unavailable';
    default:
      return 'error';
  }
}

/** The local player; first-time visitors go to onboarding and come back here afterwards. */
export function usePlayerGate(here: Route): LocalPlayer | null {
  const player = useApp((s) => s.player);
  const navigate = useRouter((s) => s.navigate);
  useEffect(() => {
    if (player) return;
    setAfterStart(here);
    navigate({ name: 'onboarding' }, { replace: true });
  }, [player, here, navigate]);
  return player;
}

/** `age_required`: VANDE Cricket is 18+, and this player has not confirmed it on the age screen, so there is no account. */
export type AccountState = 'idle' | 'syncing' | 'ok' | 'offline' | 'alias_rejected' | 'age_required' | 'error';

/**
 * The server account behind the local player, created with the player's own alias, avatar, kit and language (never
 * a generated stand-in) before any signed-in call.
 */
export async function ensureAccount(net: Net, player: LocalPlayer, locale: string): Promise<{ id: string } | { error: AccountState }> {
  try {
    const tokens = await net.session.ensure(player.alias);
    if (!player.id) {
      try {
        await net.api.call('PATCH /v1/me', { body: { avatar: player.avatar, kit: player.kit, locale: locale as never } });
      } catch {
        /* the profile can be completed later: the account exists */
      }
    }
    return { id: tokens.playerId };
  } catch (e) {
    if (isAgeNotConfirmed(e)) return { error: 'age_required' };
    if (isApiClientError(e)) {
      if (e.code === 'invalid') return { error: 'alias_rejected' };
      if (e.retryable) return { error: 'offline' };
    }
    return { error: 'error' };
  }
}

/** Account state for the signed-in screens: 'ok' once the session exists (the local player gets its id). */
export function useAccount(net: Net | null, player: LocalPlayer | null): { state: AccountState; retry: () => void } {
  const online = useApp((s) => s.online);
  const [state, setState] = useState<AccountState>(net && player?.id ? 'ok' : 'idle');
  const [tick, setTick] = useState(0);
  const running = useRef(false);
  useEffect(() => {
    if (!net || !player || running.current) return;
    running.current = true;
    // A known account renders at once; the session is confirmed in the background.
    if (!player.id) setState('syncing');
    void ensureAccount(net, player, useApp.getState().settings.locale).then((r) => {
      running.current = false;
      if ('id' in r) {
        const current = useApp.getState().player;
        if (current && current.id !== r.id) useApp.getState().setPlayer({ ...current, id: r.id });
        setState('ok');
      } else setState(r.error);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net, player?.alias, online, tick]);
  return { state, retry: useCallback(() => setTick((n) => n + 1), []) };
}

/** Current time, ticking every `ms`. Only ever compared with public server deadlines. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export interface Resource<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
  /** Replaces the data locally (after a mutation answered with the new state). */
  set: (next: T | ((prev: T | null) => T)) => void;
}

/**
 * Runs `fn` now, again when `deps` change, when the app is back online after a failure, and every `pollMs` while
 * the page is visible. Keeps the last good data while reloading. `fn: null` means "not yet" (e.g. no account).
 */
export function useResource<T>(fn: (() => Promise<T>) | null, deps: unknown[], opts: { pollMs?: number | null } = {}): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(fn));
  const [tick, setTick] = useState(0);
  const online = useApp((s) => s.online);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const enabled = Boolean(fn);

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
  }, [...deps, tick, enabled]);

  useEffect(() => {
    if (online && error) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  useEffect(() => {
    const ms = opts.pollMs;
    if (!ms || !enabled) return;
    const id = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') reload();
    }, ms);
    return () => clearInterval(id);
  }, [opts.pollMs, enabled, reload]);

  const set = useCallback((next: T | ((prev: T | null) => T)) => {
    setData((prev) => (typeof next === 'function' ? (next as (p: T | null) => T)(prev) : next));
  }, []);

  return { data, error, loading, reload, set };
}

/** A mutation in flight: `busy` while it runs; failures come back as a SocialFailure (never thrown at the UI). */
export function useAction(): { busy: boolean; run: <T>(fn: () => Promise<T>) => Promise<{ ok: true; value: T } | { ok: false; failure: SocialFailure; error: unknown }> } {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const run = useCallback(async <T,>(fn: () => Promise<T>) => {
    setBusy(true);
    try {
      const value = await fn();
      return { ok: true as const, value };
    } catch (error) {
      return { ok: false as const, failure: socialFailure(error), error };
    } finally {
      if (alive.current) setBusy(false);
    }
  }, []);
  return { busy, run };
}
