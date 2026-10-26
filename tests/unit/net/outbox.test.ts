import { afterEach, describe, expect, it } from 'vitest';
import { ApiClientError } from '@/net/errors';
import { __closeNetDbs } from '@/net/idb';
import { Outbox, backoffDelay, idbOutboxStorage, memoryOutboxStorage, type OutboxEntry, type OutboxResult } from '@/net/outbox';

afterEach(async () => {
  await __closeNetDbs();
});

function harness(opts: { storage?: ReturnType<typeof memoryOutboxStorage>; send?: (e: OutboxEntry) => Promise<unknown> } = {}) {
  let now = 1_000_000;
  const sent: OutboxEntry[] = [];
  let mode: 'online' | 'offline' | ((e: OutboxEntry) => Promise<unknown>) = 'online';
  const storage = opts.storage ?? memoryOutboxStorage();
  const results: OutboxResult[] = [];
  const outbox = new Outbox({
    storage,
    now: () => now,
    random: () => 0.5,
    schedule: () => () => undefined,
    send:
      opts.send ??
      (async (e) => {
        if (typeof mode === 'function') return mode(e);
        if (mode === 'offline') throw new ApiClientError('network', 'offline');
        sent.push(e);
        return { ok: e.id };
      }),
  });
  outbox.onResult((r) => results.push(r));
  return {
    outbox,
    storage,
    sent,
    results,
    advance: (ms: number) => (now += ms),
    setMode: (m: typeof mode) => (mode = m),
  };
}

describe('outbox', () => {
  it('persists an entry before sending it', async () => {
    const storage = memoryOutboxStorage();
    let storedAtSend = 0;
    const outbox = new Outbox({ storage, send: async () => (storedAtSend = (await storage.list()).length), schedule: () => () => undefined });
    const r = await outbox.submit({ route: 'POST /v1/matches/:id/bat/shot', params: { id: 'm1' }, body: { x: 1 }, group: 'match:m1' });
    expect(storedAtSend).toBe(1);
    expect(r.status).toBe('sent');
    expect(await storage.list()).toEqual([]);
  });

  it('keeps a shot made offline and delivers it with its idempotency key once the network is back', async () => {
    const h = harness();
    h.setMode('offline');
    const r = await h.outbox.submit<{ ok: string }>({ route: 'POST /v1/matches/:id/bat/shot', params: { id: 'm1' }, body: { input: 1 }, group: 'match:m1' });
    expect(r.status).toBe('queued');
    if (r.status !== 'queued') return;
    const [entry] = await h.outbox.pending();
    expect(entry.attempts).toBe(1);
    expect(entry.lastError).toBe('network');
    h.setMode('online');
    await h.outbox.flush();
    expect(h.sent).toEqual([]); // not due yet: backoff
    h.advance(60_000);
    await h.outbox.flush();
    expect(h.sent.map((e) => e.id)).toEqual([r.entry.id]);
    await expect(r.delivered).resolves.toEqual({ ok: r.entry.id });
  });

  it('keeps each lane in order and lets other lanes go on', async () => {
    const h = harness();
    h.setMode(async (e) => {
      if (e.group === 'match:a' && (e.body as { n: number }).n === 1) throw new ApiClientError('unavailable', 'busy', 503);
      h.sent.push(e);
      return {};
    });
    for (const n of [1, 2, 3]) await h.outbox.enqueue({ route: 'POST /x', group: 'match:a', body: { n } });
    await h.outbox.enqueue({ route: 'POST /x', group: 'match:b', body: { n: 9 } });
    await h.outbox.flush();
    expect(h.sent.map((e) => (e.body as { n: number }).n)).toEqual([9]);
    h.setMode('online');
    h.advance(120_000);
    await h.outbox.flush();
    expect(h.sent.map((e) => (e.body as { n: number }).n)).toEqual([9, 1, 2, 3]);
  });

  it('drops an entry only on a definitive answer, and reports it', async () => {
    const h = harness();
    h.setMode(async (e) => {
      if ((e.body as { n: number }).n === 1) throw new ApiClientError('deadline_passed', 'late', 410);
      h.sent.push(e);
      return { fine: true };
    });
    const first = await h.outbox.submit({ route: 'POST /x', group: 'g', body: { n: 1 } }).catch((e) => e as ApiClientError);
    expect(first).toMatchObject({ code: 'deadline_passed' });
    await h.outbox.submit({ route: 'POST /x', group: 'g', body: { n: 2 } });
    expect(h.results.map((r) => r.ok)).toEqual([false, true]);
    expect(await h.outbox.pending()).toEqual([]);
  });

  it('retries "in progress" conflicts and honours retry-after', async () => {
    const h = harness();
    h.setMode(async () => {
      throw new ApiClientError('conflict', 'in progress', 409, 5_000);
    });
    await h.outbox.enqueue({ route: 'POST /x', group: 'g' });
    await h.outbox.flush();
    const [e] = await h.outbox.pending();
    expect(e.attempts).toBe(1);
    expect(e.nextAttemptAt).toBeGreaterThanOrEqual(1_000_000 + 5_000);
  });

  it('survives an app restart (IndexedDB) and delivers what was queued', async () => {
    const storage = idbOutboxStorage('vande-net-test-restart');
    const first = harness({ storage });
    first.setMode('offline');
    await first.outbox.submit({ route: 'POST /v1/matches/:id/bat/shot', params: { id: 'm9' }, body: { ballToken: 't', input: {} }, group: 'match:m9', idempotencyKey: '11111111-2222-4333-8444-555555555555' });
    await __closeNetDbs();
    const delivered: OutboxEntry[] = [];
    const reopened = new Outbox({ storage: idbOutboxStorage('vande-net-test-restart'), now: () => 2_000_000, send: async (e) => void delivered.push(e), schedule: () => () => undefined });
    await reopened.flush();
    expect(delivered).toHaveLength(1);
    expect(delivered[0].id).toBe('11111111-2222-4333-8444-555555555555');
    expect(delivered[0].params).toEqual({ id: 'm9' });
    expect(await reopened.pending()).toEqual([]);
  });

  it('gives up only after the maximum age', async () => {
    const h = harness();
    h.setMode('offline');
    await h.outbox.enqueue({ route: 'POST /x', group: 'g' });
    h.advance(8 * 24 * 3_600_000);
    await h.outbox.flush();
    expect(await h.outbox.pending()).toEqual([]);
    expect(h.results[0]).toMatchObject({ ok: false });
  });

  it('backs off exponentially with full jitter, capped at a minute', () => {
    expect(backoffDelay(0, () => 0.999)).toBeLessThan(1_000);
    expect(backoffDelay(3, () => 0.999)).toBeLessThan(8_000);
    expect(backoffDelay(3, () => 0.999)).toBeGreaterThan(7_000);
    expect(backoffDelay(20, () => 0.999)).toBeLessThanOrEqual(60_000);
    expect(backoffDelay(5, () => 0)).toBe(250);
  });
});
