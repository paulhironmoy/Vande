// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { aggregates, handle, scheduled, type Env } from '../src/index';
import { MemoryCache, MemoryD1 } from './d1-memory';
import { validateSubmission } from '../src/validate';
import { medianFromHistogram, publicStats, strategyClass } from '../src/stats';
import { jsonPath } from '../src/sql';

const NOW = new Date('2026-10-26T09:30:00Z');
const ORIGIN = 'https://paulhironmoy.github.io';

function env(overrides: Partial<Env> = {}): Env {
  return { DB: new MemoryD1(), ALLOWED_ORIGINS: `${ORIGIN},https://localhost`, MIN_COHORT: '3', RATE_SALT: 'test-salt', RATE_LIMIT_PER_MINUTE: '5', ...overrides };
}

function submission(i: number, overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    dailyId: '2026-10-26',
    contentVersion: 'daily-1',
    submissionId: (i.toString(16).padStart(2, '0') + 'a'.repeat(30)).slice(0, 32),
    score: 60 + i,
    outcome: 'resilient',
    fingerprint: 'DESDE',
    mode: 'simple',
    appVersion: '1.0.0',
    platform: 'web',
    ...overrides,
  };
}

function post(body: unknown, headers: Record<string, string> = {}, dailyId = '2026-10-26'): Request {
  const text = JSON.stringify(body);
  return new Request(`https://api.example/v1/daily/${dailyId}/results`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'cf-connecting-ip': '203.0.113.5', 'content-length': String(text.length), ...headers },
    body: text,
  });
}

describe('validation', () => {
  it('accepts a well-formed submission and rejects every malformed field', () => {
    expect(validateSubmission(submission(1), NOW).ok).toBe(true);
    const bad = [
      { v: 2 },
      { dailyId: '2026-13-01' },
      { dailyId: '2026-10-20' },
      { dailyId: '2026-10-28' },
      { submissionId: 'xyz' },
      { score: 101 },
      { score: 50.5 },
      { outcome: 'victory' },
      { fingerprint: 'DQ' },
      { fingerprint: 'DDDDDDDDDDDDD' },
      { mode: 'kid' },
      { platform: 'ios' },
      { appVersion: 'a'.repeat(40) },
      { extra: 1 },
    ];
    for (const b of bad) expect(validateSubmission(submission(1, b), NOW).ok, JSON.stringify(b)).toBe(false);
    expect(validateSubmission(submission(1), NOW, ['daily-2']).ok).toBe(false);
    expect(validateSubmission(submission(1), NOW, [], 5000).ok).toBe(false);
  });
});

describe('stats maths', () => {
  it('classifies strategies and computes medians from histograms', () => {
    expect(strategyClass('DESDE')).toBe('restraint');
    expect(strategyClass('DXS')).toBe('force');
    expect(strategyClass('WWD')).toBe('passive');
    expect(strategyClass('DPPE')).toBe('mixed');
    expect(medianFromHistogram([{ key: '60', n: 1 }, { key: '70', n: 1 }], 2)).toBe(65);
    expect(medianFromHistogram([{ key: '60', n: 2 }, { key: '70', n: 1 }], 3)).toBe(60);
    const stats = publicStats('2026-10-26', 'daily-1', { count: 2, bands: [], outcomes: [], strategies: [], scores: [] }, NOW, 3);
    expect(stats.ready).toBe(false);
    expect(stats.scoreBands).toBeUndefined();
  });
});

describe('handler', () => {
  it('serves health and rejects unknown routes', async () => {
    const e = env();
    const h = await handle(new Request('https://api.example/v1/health', { headers: { origin: ORIGIN } }), e, { now: () => NOW });
    expect(h.status).toBe(200);
    expect(await h.json()).toMatchObject({ ok: true });
    const nf = await handle(new Request('https://api.example/v1/nope', { headers: { origin: ORIGIN } }), e, { now: () => NOW });
    expect(nf.status).toBe(404);
  });

  it('accepts once, reports duplicates, and never stores the raw address', async () => {
    const e = env();
    const first = await handle(post(submission(1)), e, { now: () => NOW });
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ accepted: true, duplicate: false });
    const again = await handle(post(submission(1)), e, { now: () => NOW });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ accepted: false, duplicate: true });
    const db = e.DB as MemoryD1;
    expect(db.results.size).toBe(1);
    const stored = JSON.stringify([...db.results.values()]) + JSON.stringify([...db.buckets.keys()]);
    expect(stored).not.toContain('203.0.113.5');
    expect([...db.results.values()][0].received_hour).toBe('2026-10-26T09:00:00.000Z');
  });

  it('enforces CORS, body size, daily id mismatch and invalid JSON', async () => {
    const e = env();
    const badOrigin = await handle(post(submission(1), { origin: 'https://evil.example' }), e, { now: () => NOW });
    expect(badOrigin.status).toBe(403);
    const preflight = await handle(new Request('https://api.example/v1/daily/2026-10-26/results', { method: 'OPTIONS', headers: { origin: ORIGIN } }), e, { now: () => NOW });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const big = await handle(post({ ...submission(2), appVersion: '1' }, { 'content-length': '9000' }), e, { now: () => NOW });
    expect(big.status).toBe(413);
    const mismatch = await handle(post(submission(3), {}, '2026-10-25'), e, { now: () => NOW });
    expect(mismatch.status).toBe(400);
    const badJson = await handle(new Request('https://api.example/v1/daily/2026-10-26/results', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: '{not json' }), e, { now: () => NOW });
    expect(badJson.status).toBe(400);
  });

  it('rate limits per address per minute without storing addresses', async () => {
    const e = env({ RATE_LIMIT_PER_MINUTE: '3' });
    const statuses: number[] = [];
    for (let i = 10; i < 15; i++) statuses.push((await handle(post(submission(i)), e, { now: () => NOW })).status);
    expect(statuses).toEqual([201, 201, 201, 429, 429]);
    const later = new Date(NOW.getTime() + 61_000);
    expect((await handle(post(submission(20)), e, { now: () => later })).status).toBe(201);
    expect(JSON.stringify([...(e.DB as MemoryD1).buckets.keys()])).not.toContain('203.0.113.5');
  });

  it('hides percentages under the cohort threshold and reports real aggregates above it', async () => {
    const e = env({ MIN_COHORT: '3' });
    const stats = async () => {
      const r = await handle(new Request('https://api.example/v1/daily/2026-10-26/stats?cv=daily-1', { headers: { origin: ORIGIN } }), e, { now: () => NOW });
      expect(r.headers.get('cache-control')).toContain('max-age=300');
      return r.json() as Promise<Record<string, unknown>>;
    };
    expect(await stats()).toMatchObject({ count: 0, ready: false, minCohort: 3 });
    await handle(post(submission(1, { score: 40, outcome: 'free-fragile', fingerprint: 'WWW' })), e, { now: () => NOW });
    await handle(post(submission(2, { score: 60 })), e, { now: () => NOW });
    const two = await stats();
    expect(two).toMatchObject({ count: 2, ready: false });
    expect(two.scoreBands).toBeUndefined();
    await handle(post(submission(3, { score: 90, fingerprint: 'DXS' })), e, { now: () => NOW });
    const three = await stats();
    expect(three).toMatchObject({ count: 3, ready: true, median: 60 });
    expect(three.scoreBands).toMatchObject({ '40-54': 33.3, '55-69': 33.3, '85-100': 33.3 });
    expect(three.outcomes).toMatchObject({ resilient: 66.7, 'free-fragile': 33.3 });
    expect(three.strategyMix).toMatchObject({ passive: 33.3, restraint: 33.3, force: 33.3 });
    // a different content version is a separate cohort
    const other = await handle(new Request('https://api.example/v1/daily/2026-10-26/stats?cv=daily-9', { headers: { origin: ORIGIN } }), e, { now: () => NOW });
    expect(await other.json()).toMatchObject({ count: 0 });
  });

  it('prunes old rate buckets and results on the schedule', async () => {
    const e = env();
    await handle(post(submission(1)), e, { now: () => NOW });
    const db = e.DB as MemoryD1;
    expect(db.results.size).toBe(1);
    expect(db.stats.size).toBe(1);
    await scheduled(e, new Date('2027-06-01T00:00:00Z'));
    expect(db.results.size).toBe(0);
    expect(db.buckets.size).toBe(0);
    expect(db.stats.size).toBe(0);
  });
});

describe('incremental stats, cache and read limiting', () => {
  const get = (e: Env, opts: Parameters<typeof handle>[2] = {}, cv = 'daily-1') =>
    handle(new Request(`https://api.example/v1/daily/2026-10-26/stats?cv=${cv}`, { headers: { origin: ORIGIN, 'cf-connecting-ip': '198.51.100.7' } }), e, { now: () => NOW, ...opts });

  it('keeps the incremental row equal to a full aggregation after many inserts, and reads only that row', async () => {
    const e = env({ MIN_COHORT: '3', RATE_LIMIT_PER_MINUTE: '50' });
    const db = e.DB as MemoryD1;
    const samples = [
      { score: 12, outcome: 'manipulated', fingerprint: 'XXW' },
      { score: 40, outcome: 'free-fragile', fingerprint: 'WWW' },
      { score: 55, outcome: 'order-without-trust', fingerprint: 'DPPE' },
      { score: 63, outcome: 'resilient', fingerprint: 'DESDE' },
      { score: 63, outcome: 'resilient', fingerprint: 'DEEDS' },
      { score: 88, outcome: 'resilient', fingerprint: 'DXS' },
      { score: 100, outcome: 'economically-disrupted', fingerprint: 'SSSD' },
    ];
    for (let i = 0; i < samples.length; i++) expect((await handle(post(submission(40 + i, samples[i])), e, { now: () => NOW })).status).toBe(201);
    // a duplicate must not move the counters
    expect((await handle(post(submission(40, samples[0])), e, { now: () => NOW })).status).toBe(200);
    expect(db.stats.get('2026-10-26|daily-1')?.count).toBe(samples.length);

    const incremental = await aggregates(db, '2026-10-26', 'daily-1');
    const saved = db.stats.get('2026-10-26|daily-1')!;
    db.stats.delete('2026-10-26|daily-1'); // simulate a day written before migration 0002
    const full = await aggregates(db, '2026-10-26', 'daily-1');
    db.stats.set('2026-10-26|daily-1', saved);
    const norm = (rows: { key: string; n: number }[]) => [...rows].sort((a, b) => a.key.localeCompare(b.key));
    expect(incremental.count).toBe(full.count);
    expect(norm(incremental.bands)).toEqual(norm(full.bands));
    expect(norm(incremental.outcomes)).toEqual(norm(full.outcomes));
    expect(norm(incremental.strategies)).toEqual(norm(full.strategies));
    expect(norm(incremental.scores)).toEqual(norm(full.scores));
    expect(publicStats('2026-10-26', 'daily-1', incremental, NOW, 3)).toEqual(publicStats('2026-10-26', 'daily-1', full, NOW, 3));

    db.calls = {};
    const r = await get(e);
    expect(r.status).toBe(200);
    expect((await r.json()) as Record<string, unknown>).toMatchObject({ count: 7, ready: true, median: 63 });
    expect(db.calls.statsRow).toBe(1);
    expect(db.calls.countForDay ?? 0).toBe(0); // no scan when the incremental row exists
  });

  it('serves repeated stats reads from the edge cache with fresh CORS headers and no database work', async () => {
    const e = env();
    await handle(post(submission(1)), e, { now: () => NOW });
    const cache = new MemoryCache();
    const db = e.DB as MemoryD1;
    const first = await get(e, { cache });
    expect(first.headers.get('x-cache')).toBe('miss');
    expect(cache.puts).toBe(1);
    db.calls = {};
    const second = await get(e, { cache });
    expect(second.headers.get('x-cache')).toBe('hit');
    expect(second.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(second.headers.get('cache-control')).toContain('max-age=300');
    expect(await second.json()).toEqual(await first.json());
    expect(Object.keys(db.calls)).toEqual([]); // nothing touched D1
    expect(cache.hits).toBe(1);
  });

  it('rate limits uncached stats reads per address with a separate, higher cap', async () => {
    const e = env({ RATE_LIMIT_READS_PER_MINUTE: '2', RATE_LIMIT_PER_MINUTE: '1' });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await get(e)).status);
    expect(statuses).toEqual([200, 200, 429, 429]);
    // read buckets never consume the write budget
    expect((await handle(post(submission(5)), e, { now: () => NOW })).status).toBe(201);
    const cache = new MemoryCache();
    await cache.put(new Request('https://api.example/v1/daily/2026-10-26/stats?cv=daily-1'), new Response('{"count":0}', { status: 200 }));
    expect((await get(e, { cache })).status).toBe(200); // cache hits bypass the limiter
  });

  it('refuses writes when RATE_SALT is missing unless unlimited writes are explicitly allowed', async () => {
    const closed = env({ RATE_SALT: undefined });
    const refused = await handle(post(submission(1)), closed, { now: () => NOW });
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ error: 'service not configured' });
    expect((closed.DB as MemoryD1).results.size).toBe(0);
    const open = env({ RATE_SALT: undefined, ALLOW_UNLIMITED_WRITES: '1' });
    expect((await handle(post(submission(1)), open, { now: () => NOW })).status).toBe(201);
    expect((await get(closed)).status).toBe(200); // reads still work without a salt (served from cache in production)
  });

  it('builds safe JSON1 paths for every key shape it stores', () => {
    expect(jsonPath('40-54')).toBe('$."40-54"');
    expect(jsonPath(63)).toBe('$."63"');
    expect(jsonPath('a"b')).toBe('$."ab"');
  });
});
