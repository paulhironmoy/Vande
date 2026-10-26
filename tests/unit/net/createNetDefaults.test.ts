/**
 * createNet with only the required options (as src/app/services.ts calls it): every optional NetOptions field left
 * out must keep its default (an undefined `now` once overwrote the Outbox default and broke every online innings).
 * Runs a full enqueue → flush against the in-process Worker through the global fetch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalBackend } from '../../../backend/local/harness';
import { fakeEngine, fakeHelpers } from '../../../backend/test/fakeEngine';
import { AgeNotConfirmedError, createNet } from '@/net';
import { Outbox, memoryOutboxStorage } from '@/net/outbox';
import { createMemorySecureStore } from '@/platform/secureStore';
import { claimMoment, memoryShareLedger } from '@/platform/shareMoments';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('createNet defaults', () => {
  it('works with only secureStore, setOnline, locale and the age confirmation: enqueue then flush reaches the Worker', async () => {
    const b = await createLocalBackend({ engine: fakeEngine, helpers: fakeHelpers, now: Date.now() });
    vi.stubEnv('VITE_API_LOCAL', '1');
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => b.fetch(new Request(String(input), { method: init?.method, headers: init?.headers, body: init?.body })));
    const online: boolean[] = [];
    const net = createNet({ secureStore: createMemorySecureStore(), setOnline: (v) => online.push(v), locale: () => 'en', adultConfirmed: () => true });
    expect(net).not.toBeNull();
    const entry = await net!.outbox.enqueue({ route: 'POST /v1/duels', body: { conditions: { pitch: 'hard', weather: 'clear' } }, group: 'duels' });
    expect(entry.createdAt).toBeGreaterThan(0);
    const flushed = await net!.outbox.flush();
    expect(flushed).toMatchObject({ sent: 1, failed: 0 });
    // The duel exists for the account the session created on the way.
    const list = await net!.api.call('GET /v1/matches');
    expect(list).toHaveLength(1);
    net!.dispose();
    b.close();
  });

  it('without the age confirmation a signed-in call creates no account and sends nothing (the implied sign-up too)', async () => {
    const b = await createLocalBackend({ engine: fakeEngine, helpers: fakeHelpers, now: Date.now() });
    const sent: string[] = [];
    let adult = false;
    const net = createNet({
      secureStore: createMemorySecureStore(),
      setOnline: () => undefined,
      locale: () => 'en',
      adultConfirmed: () => adult,
      config: { apiUrl: 'https://api.local', timeoutMs: 5_000, clientId: 'vande-cricket/test' },
      fetch: async (url, init) => {
        sent.push(`${init.method} ${url}`);
        return b.fetch(new Request(url, { method: init.method, headers: init.headers, body: init.body }));
      },
      outboxStorage: memoryOutboxStorage(),
      connectivity: { target: new EventTarget(), nav: { onLine: true }, appResume: async () => () => undefined },
    })!;
    await expect(net.api.call('GET /v1/matches')).rejects.toBeInstanceOf(AgeNotConfirmedError);
    await expect(net.session.ensure('Swift Tiger')).rejects.toMatchObject({ code: 'forbidden', retryable: false });
    expect(sent.filter((r) => !r.includes('/v1/attribution'))).toEqual([]);
    adult = true;
    expect(await net.api.call('GET /v1/matches')).toEqual([]);
    net.dispose();
    b.close();
  });

  it('registers the server share cap: shares ask POST /v1/matches/:id/moments once signed in, never signing anyone up', async () => {
    const b = await createLocalBackend({ engine: fakeEngine, helpers: fakeHelpers, now: Date.now() });
    const sent: string[] = [];
    const net = createNet({
      secureStore: createMemorySecureStore(),
      setOnline: () => undefined,
      locale: () => 'en',
      adultConfirmed: () => true,
      config: { apiUrl: 'https://api.local', timeoutMs: 5_000, clientId: 'vande-cricket/test' },
      fetch: async (url, init) => {
        sent.push(`${init.method} ${new URL(url).pathname}`);
        return b.fetch(new Request(url, { method: init.method, headers: init.headers, body: init.body }));
      },
      outboxStorage: memoryOutboxStorage(),
      connectivity: { target: new EventTarget(), nav: { onLine: true }, appResume: async () => () => undefined },
    })!;
    const ctx = { id: 'mabcdefghijklmnopqrstuvwxyz', kind: 'duel' as const, url: 'https://vande.example/i/abcdefghij' };
    // No session yet: the device's ledger decides and nothing is sent (no account is created to ask).
    expect(await claimMoment(memoryShareLedger(), 'invite', ctx)).toBe(true);
    expect(sent.filter((r) => !r.includes('/v1/attribution'))).toEqual([]);
    await net.session.ensure('Swift Tiger');
    expect(await claimMoment(memoryShareLedger(), 'invite', ctx)).toBe(true);
    await b.advance(11 * 60_000);
    // Another device, or this one after its data was cleared: the server remembers.
    const fresh = memoryShareLedger();
    expect(await claimMoment(fresh, 'invite', ctx)).toBe(false);
    expect(fresh.used(ctx.id, 'invite')).toBe(true);
    expect(sent.filter((r) => r.endsWith('/moments'))).toHaveLength(2);
    net.dispose();
    // Disposed: the claimer is gone, the ledger decides again.
    expect(await claimMoment(memoryShareLedger(), 'invite', ctx)).toBe(true);
    expect(sent.filter((r) => r.endsWith('/moments'))).toHaveLength(2);
    b.close();
  });

  it('an Outbox given undefined optional fields keeps its defaults', async () => {
    const sent: string[] = [];
    const box = new Outbox({ storage: memoryOutboxStorage(), send: async (e) => void sent.push(e.route), now: undefined, random: undefined, schedule: undefined, maxAgeMs: undefined });
    await box.enqueue({ route: 'POST /v1/report', body: {}, group: 'g' });
    expect(await box.flush()).toMatchObject({ sent: 1 });
    expect(sent).toEqual(['POST /v1/report']);
  });
});
