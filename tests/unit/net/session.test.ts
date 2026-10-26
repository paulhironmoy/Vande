import { describe, expect, it } from 'vitest';
import { createLocalBackend, type LocalBackend } from '../../../backend/local/harness';
import { fakeEngine, fakeHelpers } from '../../../backend/test/fakeEngine';
import { createApiClient, type FetchLike } from '@/net/client';
import { SessionManager, defaultLocks } from '@/net/session';
import { AgeNotConfirmedError, isAgeNotConfirmed } from '@/net/errors';
import { createMemorySecureStore } from '@/platform/secureStore';

const API = 'https://api.local';

async function setup(): Promise<{ b: LocalBackend; fetch: FetchLike & { loseNextResponse(): void; offline: boolean } }> {
  const b = await createLocalBackend({ engine: fakeEngine, helpers: fakeHelpers, now: Date.UTC(2026, 9, 26, 6, 30) });
  let lose = false;
  const f = Object.assign(
    async (url: string, init: RequestInit) => {
      if (f.offline) throw new TypeError('Failed to fetch');
      const res = await b.fetch(new Request(url, { method: init.method, headers: init.headers, body: init.body }));
      if (lose) {
        lose = false;
        throw new TypeError('connection reset');
      }
      return res;
    },
    { offline: false, loseNextResponse: () => (lose = true) },
  );
  return { b, fetch: f };
}

const accounts = (b: LocalBackend) => Number((b.db.db.prepare('SELECT count(*) AS n FROM accounts').get() as { n: number }).n);

describe('session', () => {
  it('is 18+: no account and no request until the age screen confirmed it; the sign-up then says so', async () => {
    const { b, fetch } = await setup();
    const sent: string[] = [];
    const counting: FetchLike = async (url, init) => {
      sent.push(`${init.method} ${new URL(url).pathname} ${String(init.body ?? '')}`);
      return fetch(url, init);
    };
    const store = createMemorySecureStore();
    const api = createApiClient({ baseUrl: API, fetch: counting });
    let adult: boolean | undefined;
    const s = new SessionManager({ adultConfirmed: () => adult === true, store, api, locale: () => 'en', now: b.clock.now });
    // Unanswered, and an "under 18" answer: nothing is sent, nothing is stored.
    await expect(s.ensure('Swift Tiger')).rejects.toBeInstanceOf(AgeNotConfirmedError);
    adult = false;
    const refused = await s.ensure().catch((e: unknown) => e);
    expect(isAgeNotConfirmed(refused) && refused.code === 'forbidden' && !refused.retryable).toBe(true);
    // Without the option at all, the answer is no as well.
    await expect(new SessionManager({ store, api, locale: () => 'en', now: b.clock.now }).ensure()).rejects.toBeInstanceOf(AgeNotConfirmedError);
    expect(sent).toEqual([]);
    expect(store.dump()).toEqual({});
    expect(accounts(b)).toBe(0);
    // Confirmed: one sign-up that carries the confirmation, and the account records it.
    adult = true;
    const t = await s.ensure('Swift Tiger');
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0].slice(sent[0].indexOf('{')))).toEqual({ locale: 'en', adultConfirmed: true, alias: 'Swift Tiger' });
    expect(Number((b.db.db.prepare('SELECT adult_confirmed AS a FROM accounts').get() as { a: number }).a)).toBe(1);
    // An existing (or recovered) session never asks again.
    adult = false;
    expect(await s.ensure()).toEqual(t);
    expect(await new SessionManager({ store, api, locale: () => 'en', now: b.clock.now }).ensure()).toEqual(t);
    b.close();
  });

  it('signs up once and keeps the session across app restarts', async () => {
    const { b, fetch } = await setup();
    const store = createMemorySecureStore();
    const api = createApiClient({ baseUrl: API, fetch });
    const s1 = new SessionManager({ adultConfirmed: () => true, store, api, locale: () => 'hi', now: b.clock.now });
    const t = await s1.ensure();
    expect(t.playerId).toMatch(/^p/);
    expect(await s1.ensure()).toEqual(t);
    const s2 = new SessionManager({ adultConfirmed: () => true, store, api, locale: () => 'hi', now: b.clock.now });
    expect((await s2.ensure()).playerId).toBe(t.playerId);
    expect(accounts(b)).toBe(1);
    b.close();
  });

  it('a lost sign-up response is retried with the same key: one account, not two', async () => {
    const { b, fetch } = await setup();
    const store = createMemorySecureStore();
    const s = new SessionManager({ adultConfirmed: () => true, store, api: createApiClient({ baseUrl: API, fetch }), locale: () => 'en', now: b.clock.now });
    fetch.loseNextResponse();
    await expect(s.ensure()).rejects.toMatchObject({ code: 'network' });
    const t = await s.ensure();
    expect(accounts(b)).toBe(1);
    expect(t.playerId).toMatch(/^p/);
    b.close();
  });

  it('refreshes before expiry; a lost refresh response replays instead of looking like theft', async () => {
    const { b, fetch } = await setup();
    const store = createMemorySecureStore();
    const s = new SessionManager({ adultConfirmed: () => true, store, api: createApiClient({ baseUrl: API, fetch }), locale: () => 'en', now: b.clock.now });
    const t0 = await s.ensure();
    expect(await s.accessToken()).toBe(t0.accessToken);
    b.clock.advance(14.5 * 60_000);
    fetch.loseNextResponse();
    expect(await s.accessToken()).toBe(t0.accessToken); // offline-ish: keeps the old token
    b.clock.advance(3 * 60_000); // past the refresh grace window: a NEW key would now look like reuse
    const t1 = await s.accessToken();
    expect(t1).not.toBe(t0.accessToken);
    expect(b.metrics.get('refresh_reuse_revoked')).toBe(0);
    const me = await createApiClient({ baseUrl: API, fetch, accessToken: async () => t1 }).call('GET /v1/me');
    expect(me.playerId).toBe(t0.playerId);
    b.close();
  });

  it('two tabs refreshing at once rotate once and end with the same tokens', async () => {
    const { b, fetch } = await setup();
    const store = createMemorySecureStore();
    const locks = defaultLocks();
    const api = createApiClient({ baseUrl: API, fetch });
    const tab1 = new SessionManager({ adultConfirmed: () => true, store, api, locale: () => 'en', now: b.clock.now, locks });
    const tab2 = new SessionManager({ adultConfirmed: () => true, store, api, locale: () => 'en', now: b.clock.now, locks });
    await tab1.ensure();
    await tab2.current();
    b.clock.advance(15 * 60_000);
    const [a, c] = await Promise.all([tab1.accessToken(), tab2.accessToken()]);
    expect(a).toBe(c);
    expect(b.metrics.get('refresh_rotated')).toBe(1);
    b.close();
  });

  it('a revoked session is cleared and reported as lost', async () => {
    const { b, fetch } = await setup();
    const store = createMemorySecureStore();
    const s = new SessionManager({ adultConfirmed: () => true, store, api: createApiClient({ baseUrl: API, fetch }), locale: () => 'en', now: b.clock.now });
    const events: string[] = [];
    s.onChange((e) => events.push(e));
    await s.ensure();
    b.db.db.prepare('UPDATE sessions SET revoked = 1').run();
    expect(await s.refresh()).toBe(false);
    expect(events).toEqual(['signed_in', 'lost']);
    expect(await s.current()).toBeNull();
    expect(store.dump()).toEqual({});
    b.close();
  });
});
