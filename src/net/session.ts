/**
 * Session: guest-first sign-in, refresh rotation and recovery. Tokens live only in the platform's SecureStore.
 *
 *   - ensure(): signs up as a guest when there is no session. The sign-up's Idempotency-Key is stored first, so a
 *     retry after a lost response (even after an app restart) gets the same account, never a second one. VANDE Cricket
 *     is 18+: only a player who confirmed it on the age screen is signed up (`adultConfirmed: true`); anyone else gets
 *     AgeNotConfirmedError and nothing is sent. An existing or recovered session never asks again.
 *   - accessToken(): the current token, refreshed a minute before it expires.
 *   - refresh(): one at a time across tabs (Web Locks when available). It re-reads the store after taking the lock
 *     (another tab may have refreshed already) and stores the request's key with the token it refreshes, so a retry
 *     after a lost response replays the server's answer instead of looking like token theft.
 *   - A 401 from refresh means the session is gone (revoked, reused or expired): the session is cleared and 'lost'
 *     is emitted so the app can offer recovery through a linked Google account or passkey.
 */
import type { LocaleId, SecureStore, SessionTokens } from '@/contracts';
import type { ApiClient } from './client';
import { AgeNotConfirmedError, isApiClientError } from './errors';
import { newIdempotencyKey } from './routes';

export const SESSION_KEY = 'vc.session.v1';
const SIGNUP_KEY = 'vc.session.signup';
const REFRESH_KEY = 'vc.session.refresh';
const REFRESH_EARLY_MS = 60_000;

export type SessionEvent = 'signed_in' | 'refreshed' | 'lost' | 'signed_out';

export interface Locks {
  run<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

/** Web Locks across tabs when the browser has them (Android WebView 69+), otherwise one in-page queue per name. */
export function defaultLocks(): Locks {
  const locks = (typeof navigator !== 'undefined' ? (navigator as { locks?: { request(name: string, cb: () => Promise<unknown>): Promise<unknown> } }).locks : undefined) ?? null;
  const chains = new Map<string, Promise<unknown>>();
  return {
    run<T>(name: string, fn: () => Promise<T>): Promise<T> {
      // The lock is held until fn's promise settles; request() resolves with fn's value.
      if (locks?.request) return locks.request(name, fn) as Promise<T>;
      const prev = chains.get(name) ?? Promise.resolve();
      const next = prev.then(
        () => fn(),
        () => fn(),
      ) as Promise<T>;
      chains.set(name, next.catch(() => undefined));
      return next;
    },
  };
}

export interface SessionOptions {
  store: SecureStore;
  /** An API client for anonymous calls (sign-up, refresh, recovery). */
  api: ApiClient;
  locale: () => LocaleId;
  now?: () => number;
  locks?: Locks;
  /** Whether this player confirmed on the age screen that they are 18 or over. Without it (or when absent) no account is created. */
  adultConfirmed?: () => boolean;
}

export class SessionManager {
  private cached: SessionTokens | null | undefined = undefined;
  private listeners = new Set<(e: SessionEvent) => void>();
  private readonly now: () => number;
  private readonly locks: Locks;

  constructor(private readonly o: SessionOptions) {
    this.now = o.now ?? (() => Date.now());
    this.locks = o.locks ?? defaultLocks();
  }

  onChange(cb: (e: SessionEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(e: SessionEvent): void {
    for (const l of this.listeners) l(e);
  }

  private async read(): Promise<SessionTokens | null> {
    const raw = await this.o.store.get(SESSION_KEY);
    if (!raw) return null;
    try {
      const s = JSON.parse(raw) as SessionTokens;
      return s && typeof s.refreshToken === 'string' && typeof s.accessToken === 'string' ? s : null;
    } catch {
      return null;
    }
  }

  private async save(tokens: SessionTokens): Promise<void> {
    await this.o.store.set(SESSION_KEY, JSON.stringify(tokens));
    this.cached = tokens;
  }

  async current(): Promise<SessionTokens | null> {
    if (this.cached === undefined) this.cached = await this.read();
    return this.cached;
  }

  async playerId(): Promise<string | null> {
    return (await this.current())?.playerId ?? null;
  }

  private adult(): boolean {
    try {
      return this.o.adultConfirmed?.() === true;
    } catch {
      return false;
    }
  }

  /** The existing session, or a new guest account (only for a player who confirmed they are 18 or over). */
  async ensure(alias?: string): Promise<SessionTokens> {
    const existing = await this.current();
    if (existing) return existing;
    if (!this.adult()) throw new AgeNotConfirmedError();
    return this.locks.run('vc-session-signup', async () => {
      const again = await this.read();
      if (again) {
        this.cached = again;
        return again;
      }
      if (!this.adult()) throw new AgeNotConfirmedError();
      let key = await this.o.store.get(SIGNUP_KEY);
      if (!key) {
        key = newIdempotencyKey();
        await this.o.store.set(SIGNUP_KEY, key);
      }
      const tokens = await this.o.api.call('POST /v1/auth/guest', { body: { locale: this.o.locale(), adultConfirmed: true, ...(alias ? { alias } : {}) } }, { idempotencyKey: key, anonymous: true });
      await this.save(tokens);
      await this.o.store.remove(SIGNUP_KEY);
      this.emit('signed_in');
      return tokens;
    });
  }

  /** A usable access token, refreshing first when it expires within a minute; null when signed out. */
  async accessToken(): Promise<string | null> {
    const s = await this.current();
    if (!s) return null;
    if (Date.parse(s.expiresAt) - this.now() > REFRESH_EARLY_MS) return s.accessToken;
    try {
      await this.refresh();
    } catch {
      /* offline: the old token is all we have; the server will say if it expired */
    }
    return (await this.current())?.accessToken ?? null;
  }

  /** Rotates the refresh token. True when a fresh access token is stored. Throws on network trouble. */
  async refresh(): Promise<boolean> {
    const seen = (await this.current())?.refreshToken ?? null;
    return this.locks.run('vc-session-refresh', async () => {
      const s = await this.read();
      this.cached = s;
      if (!s) return false;
      if (s.refreshToken !== seen && Date.parse(s.expiresAt) - this.now() > REFRESH_EARLY_MS) return true;
      let key: string | null = null;
      try {
        const pending = JSON.parse((await this.o.store.get(REFRESH_KEY)) ?? 'null') as { for: string; key: string } | null;
        if (pending?.for === s.refreshToken) key = pending.key;
      } catch {
        /* ignore a corrupt record */
      }
      if (!key) {
        key = newIdempotencyKey();
        await this.o.store.set(REFRESH_KEY, JSON.stringify({ for: s.refreshToken, key }));
      }
      try {
        const tokens = await this.o.api.call('POST /v1/auth/refresh', { body: { refreshToken: s.refreshToken } }, { idempotencyKey: key, anonymous: true });
        await this.save(tokens);
        await this.o.store.remove(REFRESH_KEY);
        this.emit('refreshed');
        return true;
      } catch (e) {
        if (isApiClientError(e) && e.code === 'unauthorized') {
          await this.clear('lost');
          return false;
        }
        if (isApiClientError(e) && e.code === 'conflict') {
          const latest = await this.read();
          this.cached = latest;
          return !!latest && latest.refreshToken !== s.refreshToken;
        }
        throw e;
      }
    });
  }

  /** Recovery on a new device: replaces the local (guest) session with the recovered account's tokens. */
  async adopt(tokens: SessionTokens): Promise<void> {
    await this.save(tokens);
    this.emit('signed_in');
  }

  /** Forgets the local session (after account deletion, or when the server revoked it). */
  async clear(reason: 'lost' | 'signed_out' = 'signed_out'): Promise<void> {
    await this.o.store.remove(SESSION_KEY);
    await this.o.store.remove(REFRESH_KEY);
    this.cached = null;
    this.emit(reason);
  }
}
