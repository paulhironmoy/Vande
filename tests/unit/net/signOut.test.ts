/**
 * Signing out (POST /v1/auth/logout) and signing out other devices (POST /v1/auth/revoke-others) from the net layer:
 * the server is told first; only then does the device forget the session and the queued requests, so nothing queued
 * for the account replays under a later guest account. Offline, nothing is forgotten.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionTokens } from '@/contracts';
import { createNet } from '@/net';
import { memoryOutboxStorage } from '@/net/outbox';
import { SESSION_KEY } from '@/net/session';
import { createMemorySecureStore } from '@/platform/secureStore';

const TOKENS: SessionTokens = { playerId: 'pme', accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: '2099-01-01T00:00:00.000Z' };
const CONFIG = { apiUrl: 'http://127.0.0.1:8787', timeoutMs: 2_000, clientId: 'vande-cricket/test' };

afterEach(() => vi.restoreAllMocks());

type Answer = { status: number; body: unknown } | 'offline';

function harness(answer: (method: string, path: string) => Answer) {
  const calls: Array<{ method: string; path: string; auth: string | null }> = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    calls.push({ method: init?.method ?? 'GET', path: url.pathname, auth: headers.get('authorization') });
    const a = answer(init?.method ?? 'GET', url.pathname);
    if (a === 'offline') throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json' } });
  });
  const store = createMemorySecureStore();
  const outboxStorage = memoryOutboxStorage();
  const net = createNet({ adultConfirmed: () => true, secureStore: store, setOnline: () => undefined, locale: () => 'en', config: CONFIG, fetch, outboxStorage, connectivity: { setOnline: () => undefined } });
  if (!net) throw new Error('no net');
  return { net, calls, store, outboxStorage };
}

const ok = (body: unknown = { ok: true }): Answer => ({ status: 200, body });

describe('sign-out', () => {
  it('tells the server first, then forgets the session and every queued request', async () => {
    const h = harness((_m, p) => (p === '/v1/auth/logout' ? ok() : p === '/v1/report' ? 'offline' : ok()));
    await h.net.session.adopt(TOKENS);
    h.net.outbox.stop();
    await h.net.outbox.enqueue({ route: 'POST /v1/report', body: { reason: 'spam' }, group: 'reports' });
    const dropped = h.net.outbox.waitFor((await h.net.outbox.pending())[0].id).catch((e: Error) => e.message);
    await h.net.signOut();
    expect(h.calls.find((c) => c.path === '/v1/auth/logout')).toEqual({ method: 'POST', path: '/v1/auth/logout', auth: 'Bearer access-1' });
    expect(await h.net.outbox.pending()).toEqual([]);
    expect(await dropped).toBe('signed out on this device');
    expect(await h.net.session.current()).toBeNull();
    expect(h.store.dump()[SESSION_KEY]).toBeUndefined();
    h.net.dispose();
  });

  it('offline: throws and forgets nothing, so the player stays signed in', async () => {
    const h = harness(() => 'offline');
    await h.net.session.adopt(TOKENS);
    h.net.outbox.stop();
    await h.net.outbox.enqueue({ route: 'POST /v1/report', body: { reason: 'spam' }, group: 'reports' });
    await expect(h.net.signOut()).rejects.toMatchObject({ code: 'network' });
    expect(await h.net.session.current()).toEqual(TOKENS);
    expect(await h.net.outbox.pending()).toHaveLength(1);
    h.net.dispose();
  });

  it('a session the server already ended is simply forgotten', async () => {
    const h = harness((_m, p) => (p === '/v1/auth/refresh' ? { status: 401, body: { error: { code: 'unauthorized', message: 'revoked' } } } : { status: 401, body: { error: { code: 'unauthorized', message: 'revoked' } } }));
    await h.net.session.adopt(TOKENS);
    await h.net.signOut();
    expect(await h.net.session.current()).toBeNull();
    h.net.dispose();
  });

  it('without a session nothing is sent and no account is created just to sign out', async () => {
    const h = harness(() => ok(TOKENS));
    await h.net.signOut();
    expect(h.calls).toEqual([]);
    h.net.dispose();
  });

  it('signs out the other devices and keeps this one', async () => {
    const h = harness((_m, p) => (p === '/v1/auth/revoke-others' ? ok({ revoked: 2 }) : ok()));
    await h.net.session.adopt(TOKENS);
    expect(await h.net.revokeOthers()).toBe(2);
    expect(h.calls.at(-1)).toEqual({ method: 'POST', path: '/v1/auth/revoke-others', auth: 'Bearer access-1' });
    expect(await h.net.session.current()).toEqual(TOKENS);
    h.net.dispose();
  });
});
