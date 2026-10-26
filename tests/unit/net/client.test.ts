import { describe, expect, it, vi } from 'vitest';
import { createApiClient, type FetchLike } from '@/net/client';
import { ApiClientError } from '@/net/errors';
import { buildPath } from '@/net/routes';
import { readNetConfig } from '@/net/config';

function recorder(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  return { calls, fetch };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('typed API client', () => {
  it('builds paths from the contract routes with encoded parameters', () => {
    expect(buildPath('GET /v1/matches/:id', { id: 'm123' })).toBe('/v1/matches/m123');
    expect(buildPath('GET /v1/invites/:token', { token: 'a/b c' })).toBe('/v1/invites/a%2Fb%20c');
    expect(() => buildPath('GET /v1/matches/:id', {})).toThrow(/missing route parameter id/);
  });

  it('adds Idempotency-Key and JSON to mutations, bearer tokens to signed-in routes only', async () => {
    const r = recorder(() => json({ ok: true }));
    const api = createApiClient({ baseUrl: 'https://api.test/', fetch: r.fetch, accessToken: async () => 'tok-123', clientId: 'vande-cricket/1.0.0' });
    await api.call('POST /v1/matches/:id/bat/next', { params: { id: 'mabc' } });
    await api.call('GET /v1/me');
    await api.call('POST /v1/auth/guest', { body: { locale: 'en', adultConfirmed: true } });
    const [next, me, guest] = r.calls;
    const h = (i: RequestInit) => i.headers as Record<string, string>;
    expect(next.url).toBe('https://api.test/v1/matches/mabc/bat/next');
    expect(h(next.init)['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(h(next.init).authorization).toBe('Bearer tok-123');
    expect(h(me.init)['idempotency-key']).toBeUndefined();
    expect(h(me.init)['x-vande-client']).toBe('vande-cricket/1.0.0');
    expect(h(guest.init).authorization).toBeUndefined();
    expect(h(guest.init)['content-type']).toBe('application/json');
    expect(guest.init.body).toBe('{"locale":"en","adultConfirmed":true}');
  });

  it('turns GET request objects into query strings', async () => {
    const r = recorder(() => json({}));
    const api = createApiClient({ baseUrl: 'https://api.test', fetch: r.fetch, accessToken: async () => 't' });
    await api.call('GET /v1/leaderboards/:scope', { params: { scope: 'city' }, body: { scope: 'city', day: '2026-10-26' } });
    expect(r.calls[0].url).toBe('https://api.test/v1/leaderboards/city?day=2026-10-26');
  });

  it('refreshes once on 401 and retries; a second 401 is final', async () => {
    let token = 'old';
    const r = recorder((_, init) => ((init.headers as Record<string, string>).authorization === 'Bearer new' ? json({ playerId: 'p1' }) : json({ error: { code: 'unauthorized', message: 'expired' } }, 401)));
    const onUnauthorized = vi.fn(async () => {
      token = 'new';
      return true;
    });
    const api = createApiClient({ baseUrl: 'https://api.test', fetch: r.fetch, accessToken: async () => token, onUnauthorized });
    await expect(api.call('GET /v1/me')).resolves.toEqual({ playerId: 'p1' });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    token = 'bad';
    const never = createApiClient({ baseUrl: 'https://api.test', fetch: recorder(() => json({ error: { code: 'unauthorized', message: 'no' } }, 401)).fetch, accessToken: async () => 'x', onUnauthorized: async () => true });
    await expect(never.call('GET /v1/me')).rejects.toMatchObject({ code: 'unauthorized', status: 401 });
  });

  it('maps server errors, network failures and timeouts to ApiClientError with retry hints', async () => {
    const reach: boolean[] = [];
    const busy = createApiClient({ baseUrl: 'https://api.test', fetch: recorder(() => json({ error: { code: 'rate_limited', message: 'slow down' } }, 429, { 'retry-after': '60' })).fetch, onNetworkResult: (ok) => reach.push(ok) });
    const e1 = await busy.call('POST /v1/auth/guest', { body: { locale: 'en', adultConfirmed: true } }).catch((e) => e as ApiClientError);
    expect(e1).toBeInstanceOf(ApiClientError);
    expect(e1).toMatchObject({ code: 'rate_limited', status: 429, retryAfterMs: 60_000, retryable: true });
    const gone = createApiClient({ baseUrl: 'https://api.test', fetch: recorder(() => json({ error: { code: 'deadline_passed', message: 'late' } }, 410)).fetch });
    expect(await gone.call('POST /v1/auth/guest', { body: { locale: 'en', adultConfirmed: true } }).catch((e) => (e as ApiClientError).retryable)).toBe(false);
    const inProgress = createApiClient({ baseUrl: 'https://api.test', fetch: recorder(() => json({ error: { code: 'conflict', message: 'in progress' } }, 409, { 'retry-after': '1' })).fetch });
    expect(await inProgress.call('POST /v1/auth/guest', { body: { locale: 'en', adultConfirmed: true } }).catch((e) => (e as ApiClientError).retryable)).toBe(true);
    const down = createApiClient({ baseUrl: 'https://api.test', fetch: async () => Promise.reject(new TypeError('Failed to fetch')), onNetworkResult: (ok) => reach.push(ok) });
    await expect(down.call('GET /v1/health')).rejects.toMatchObject({ code: 'network', retryable: true });
    const hang = createApiClient({ baseUrl: 'https://api.test', timeoutMs: 20, fetch: (_, init) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))) });
    await expect(hang.call('GET /v1/health')).rejects.toMatchObject({ code: 'timeout' });
    const garbage = createApiClient({ baseUrl: 'https://api.test', fetch: async () => new Response('<html>', { status: 200 }) });
    await expect(garbage.call('GET /v1/health')).rejects.toMatchObject({ code: 'bad_response' });
    const html502 = createApiClient({ baseUrl: 'https://api.test', fetch: async () => new Response('<html>Bad gateway', { status: 502 }) });
    await expect(html502.call('GET /v1/health')).rejects.toMatchObject({ code: 'unavailable', retryable: true });
    expect(reach).toEqual([true, false]);
  });

  it('reads its configuration from the build environment, refusing insecure URLs', () => {
    expect(readNetConfig({}).apiUrl).toBeNull();
    expect(readNetConfig({ VITE_API_URL: 'https://api.vande.example/' }).apiUrl).toBe('https://api.vande.example');
    expect(readNetConfig({ VITE_API_URL: 'http://api.vande.example' }).apiUrl).toBeNull();
    expect(readNetConfig({ VITE_API_LOCAL: '1' }).apiUrl).toBe('http://127.0.0.1:8787');
    expect(readNetConfig({ VITE_API_URL: 'https://api.vande.example', VITE_KILL_ONLINE: '1' }).apiUrl).toBeNull();
  });
});
