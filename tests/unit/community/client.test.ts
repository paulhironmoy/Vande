import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecordV2 } from '@/engine/types';

const flagsState = vi.hoisted(() => ({ communityApiUrl: 'https://api.example', communityEnabled: true, communityMinCohort: 3 }));
vi.mock('@/app/flags', () => ({ flags: flagsState }));

import { buildSubmission, fetchDailyStats, flushOutbox, submitOfficialResult } from '@/community/client';
import { communityStorage, setCommunityStorage, createLocalStorageAdapter } from '@/community/storage';
import type { SubmitContext } from '@/community/types';

const record: DailyRecordV2 = {
  v: 2,
  dailyId: '2026-10-26',
  official: { score: 72, outcome: 'resilient', fingerprint: 'DESDE', completedAt: '2026-10-26T06:00:00.000Z', contentVersion: 'daily-1', mode: 'simple', scores: { freedom: 70, grievance: 70, safety: 70, evidence: 80, trust: 70, economy: 70 } },
};
const ctx: SubmitContext = { installId: 'install-A', appVersion: '1.0.0', platform: 'web', communitySharing: 'on' };

describe('community client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    localStorage.clear();
    setCommunityStorage(createLocalStorageAdapter());
    flagsState.communityEnabled = true;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds exactly the documented payload and nothing else', async () => {
    const payload = await buildSubmission(record, ctx);
    expect(payload).not.toBeNull();
    expect(Object.keys(payload!).sort()).toEqual(['appVersion', 'contentVersion', 'dailyId', 'fingerprint', 'mode', 'outcome', 'platform', 'score', 'submissionId', 'v'].sort());
    expect(payload!.submissionId).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(payload)).not.toContain('install-A');
  });

  it('skips when the player has not opted in or the feature is off', async () => {
    expect(await submitOfficialResult(record, { ...ctx, communitySharing: 'unset' })).toBe('skipped');
    expect(await submitOfficialResult(record, { ...ctx, communitySharing: 'off' })).toBe('skipped');
    flagsState.communityEnabled = false;
    expect(await submitOfficialResult(record, ctx)).toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await submitOfficialResult({ v: 2, dailyId: '2026-10-26' }, ctx)).toBe('skipped');
  });

  it('posts to the results endpoint and maps the status codes', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 201 }));
    expect(await submitOfficialResult(record, ctx)).toBe('accepted');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example/v1/daily/2026-10-26/results');
    expect(init.method).toBe('POST');
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    expect(await submitOfficialResult(record, ctx)).toBe('duplicate');
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 400 }));
    expect(await submitOfficialResult(record, ctx)).toBe('rejected');
  });

  it('queues when offline or when the server fails, and flushes later', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    expect(await submitOfficialResult(record, ctx)).toBe('queued');
    expect((await communityStorage().getOutbox()).length).toBe(1);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    fetchMock.mockRejectedValueOnce(new Error('network'));
    expect(await submitOfficialResult({ ...record, dailyId: '2026-10-27' }, ctx)).toBe('queued');
    expect((await communityStorage().getOutbox()).length).toBe(2);
    fetchMock.mockResolvedValue(new Response('{}', { status: 201 }));
    const flushed = await flushOutbox();
    expect(flushed).toEqual({ sent: 2, remaining: 0 });
  });

  it('never throws when fetch is broken', async () => {
    fetchMock.mockImplementation(() => {
      throw new TypeError('boom');
    });
    expect(await submitOfficialResult(record, ctx)).toBe('queued');
    const stats = await fetchDailyStats('2026-10-26');
    expect(stats.error).toBe('failed');
  });

  it('fetches stats, caches them for ten minutes and marks cached reads', async () => {
    const body = { dailyId: '2026-10-26', contentVersion: 'daily-1', count: 40, minCohort: 25, ready: true, asOf: '2026-10-26T07:00:00.000Z', scoreBands: { '0-39': 10, '40-54': 20, '55-69': 30, '70-84': 30, '85-100': 10 } };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }));
    const first = await fetchDailyStats('2026-10-26', { now: 1_000_000 });
    expect(first.fromCache).toBe(false);
    expect(first.stats?.ready).toBe(true);
    const second = await fetchDailyStats('2026-10-26', { now: 1_000_000 + 60_000 });
    expect(second.fromCache).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // below the client-side cohort floor the stats are never "ready"
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...body, count: 2, ready: true }), { status: 200 }));
    const small = await fetchDailyStats('2026-10-26', { now: 1_000_000 + 20 * 60_000 });
    expect(small.stats?.ready).toBe(false);
  });

  it('returns disabled when the feature is not configured', async () => {
    flagsState.communityEnabled = false;
    expect(await fetchDailyStats('2026-10-26')).toEqual({ fromCache: false, error: 'disabled' });
  });
});
