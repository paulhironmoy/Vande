import { describe, expect, it, vi } from 'vitest';
import { adminPath, createAdminApi, loadAuth, saveAuth } from '@/admin/api';
import { STATUSES, jobRow, mountAdmin, reportRow } from '@/admin/main';
import type { AdminJob, AdminReport } from '@/admin/types';

const JOB = `j${'a'.repeat(26)}`;

function job(over: Partial<AdminJob> = {}): AdminJob {
  return {
    jobId: JOB,
    day: '2026-10-26',
    matchId: `m${'b'.repeat(26)}`,
    participants: ['p1', 'p2'],
    status: 'pending_moderation',
    title: 'Swift Tiger vs Calm Cobra · Daily Top 100 #1 | VANDE Cricket #Shorts',
    description: 'Friend Duel',
    visibility: 'public',
    videoKey: 'tmp/highlights/x.mp4',
    youtubeVideoId: null,
    scheduledFor: null,
    attempts: 1,
    lastError: null,
    attributionCode: 'k7q2m9xa',
    kind: 'duel',
    fixtureLabel: 'Friend Duel',
    aliases: ['Swift Tiger', 'Calm Cobra'],
    ranks: [1, null],
    consentBy: '2026-10-28T18:31:00.000Z',
    videoBytes: 1000,
    videoMs: 42000,
    publishedAt: null,
    views: 0,
    quotaDay: null,
    withdrawPending: false,
    createdAt: '2026-10-26T18:31:00.000Z',
    updatedAt: '2026-10-26T18:31:00.000Z',
    ...over,
  };
}

describe('admin API client', () => {
  it('builds admin paths and refuses anything that is not a job or report id', () => {
    expect(adminPath('GET /v1/admin/jobs', undefined, { day: '2026-10-26', status: undefined })).toBe('/v1/admin/jobs?day=2026-10-26');
    expect(adminPath('POST /v1/admin/jobs/:jobId/approve', { jobId: JOB })).toBe(`/v1/admin/jobs/${JOB}/approve`);
    expect(() => adminPath('POST /v1/admin/jobs/:jobId/approve', { jobId: '../../me' })).toThrow();
    expect(adminPath('POST /v1/admin/reports/:reportId/suspend', { reportId: '42' })).toBe('/v1/admin/reports/42/suspend');
    expect(() => adminPath('POST /v1/admin/reports/:reportId/suspend', { reportId: '../jobs' })).toThrow();
    // Every status, the new ones included, can be filtered on.
    expect(STATUSES).toEqual(expect.arrayContaining(['awaiting_channel', 'removal_failed']));
  });

  it('sends the local token only to the configured API origin, never cookies across origins, never redirects', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'dev-token', via: 'token' }), { status: 200 }));
    const api = createAdminApi({ base: 'http://127.0.0.1:8787', token: 't'.repeat(40) }, fetchMock as unknown as typeof fetch);
    expect(await api.call('GET /v1/admin/whoami')).toEqual({ id: 'dev-token', via: 'token' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8787/v1/admin/whoami');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${'t'.repeat(40)}`);
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('error');
    const same = createAdminApi({ base: '', token: null }, fetchMock as unknown as typeof fetch);
    await same.call('GET /v1/admin/whoami');
    const [url2, init2] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url2).toBe('/v1/admin/whoami');
    expect((init2.headers as Record<string, string>).authorization).toBeUndefined();
    expect(init2.credentials).toBe('same-origin');
    expect(() => createAdminApi({ base: 'http://evil.example/path', token: null })).toThrow();
  });

  it('keeps the connection settings for the tab only', () => {
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    saveAuth(s, { base: 'http://127.0.0.1:8787', token: 'x'.repeat(32) });
    expect(loadAuth(s)).toEqual({ base: 'http://127.0.0.1:8787', token: 'x'.repeat(32) });
    saveAuth(s, { base: '', token: null });
    expect(store.size).toBe(0);
    expect(loadAuth(null)).toEqual({ base: '', token: null });
  });
});

describe('admin console', () => {
  it('renders player-chosen text as text, never as HTML', () => {
    const row = jobRow(job({ aliases: ['<img src=x onerror=alert(1)>', 'Calm Cobra'], title: '<script>alert(1)</script>' }), () => undefined);
    expect(row.querySelector('img')).toBeNull();
    expect(row.querySelector('script')).toBeNull();
    expect(row.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('lists the day, opens a job and approves it with notes', async () => {
    const calls: Array<[string, unknown]> = [];
    const api = {
      call: vi.fn(async (key: string, opts?: { body?: unknown }) => {
        calls.push([key, opts?.body]);
        if (key === 'GET /v1/admin/whoami') return { id: 'ops@vande.example', via: 'access' };
        if (key === 'GET /v1/admin/jobs') return { jobs: [job()], counts: { pending_moderation: 1 } };
        if (key === 'GET /v1/admin/jobs/:jobId') return { job: job(), consents: [], moderation: [], attribution: [] };
        if (key === 'POST /v1/admin/jobs/:jobId/approve') return { status: 'scheduled' };
        throw new Error(key);
      }),
    };
    const root = document.createElement('div');
    const ui = mountAdmin(root, { api: api as never, storage: null, now: () => Date.UTC(2026, 9, 26, 20, 0) });
    await ui.refresh();
    expect(root.textContent).toContain('ops@vande.example (Cloudflare Access)');
    expect(root.querySelectorAll('table.jobs tbody tr')).toHaveLength(1);
    (root.querySelector('button.link') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.querySelector('.detail h2')?.textContent).toBe(job().title));
    (root.querySelector('.detail textarea') as HTMLTextAreaElement).value = 'ok to publish';
    const approve = [...root.querySelectorAll('.detail button')].find((b) => b.textContent === 'Approve') as HTMLButtonElement;
    approve.click();
    await vi.waitFor(() => expect(calls.some(([k]) => k === 'POST /v1/admin/jobs/:jobId/approve')).toBe(true));
    expect(calls.find(([k]) => k === 'POST /v1/admin/jobs/:jobId/approve')?.[1]).toEqual({ notes: 'ok to publish' });
  });
});

describe('the report queue view', () => {
  const report = (over: Partial<AdminReport> = {}): AdminReport => ({
    id: 7,
    kind: 'post',
    reason: 'abusive',
    status: 'open',
    createdHour: '2026-10-26T09:00:00.000Z',
    resolvedHour: null,
    resolution: null,
    player: { playerId: `p${'c'.repeat(26)}`, alias: 'Calm Cobra', status: 'active', suspendedUntil: null, openReports: 2 },
    post: { postId: `r${'d'.repeat(26)}.3`, present: true, kind: 'text', text: 'you are rubbish', phraseId: null, createdHour: '2026-10-26T08:00:00.000Z' },
    history: [],
    ...over,
  });

  it('shows names and post text as text only', () => {
    const row = reportRow(report({ player: { playerId: 'p1', alias: '<img src=x onerror=alert(1)>', status: 'active', suspendedUntil: null, openReports: 1 }, post: { postId: 'r1.1', present: true, kind: 'text', text: '<b>hi</b>', phraseId: null, createdHour: null } }), () => undefined);
    expect(row.querySelector('img, b')).toBeNull();
    expect(row.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(row.textContent).toContain('<b>hi</b>');
  });

  it('lists open reports, opens one and suspends with notes and days (after a confirmation)', async () => {
    const calls: Array<[string, unknown, unknown]> = [];
    const api = {
      call: vi.fn(async (key: string, opts?: { body?: unknown; params?: unknown; query?: unknown }) => {
        calls.push([key, opts?.body ?? opts?.query, opts?.params]);
        if (key === 'GET /v1/admin/whoami') return { id: 'ops@vande.example', via: 'access' };
        if (key === 'GET /v1/admin/jobs') return { jobs: [], counts: {} };
        if (key === 'GET /v1/admin/reports') return { reports: [report()], counts: { open: 1, closed: 0 } };
        if (key === 'POST /v1/admin/reports/:reportId/suspend') return { status: 'actioned', until: '2026-11-02T09:00:00.000Z' };
        throw new Error(key);
      }),
    };
    const confirm = vi.fn(() => true);
    const root = document.createElement('div');
    const ui = mountAdmin(root, { api: api as never, storage: null, confirm, now: () => Date.UTC(2026, 9, 26, 20, 0) });
    await ui.refresh();
    ([...root.querySelectorAll('nav.tabs button')].find((b) => b.textContent === 'Reports') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.querySelectorAll('table.reports tbody tr')).toHaveLength(1));
    expect(root.textContent).toContain('1 open · 0 closed');
    expect(calls.find(([k]) => k === 'GET /v1/admin/reports')?.[1]).toEqual({ status: 'open', kind: undefined });
    (root.querySelector('table.reports button.link') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.querySelector('.detail h2')?.textContent).toBe('Report #7: post · abusive'));
    expect(root.querySelector('.detail q')?.textContent).toBe('you are rubbish');
    (root.querySelector('.detail textarea') as HTMLTextAreaElement).value = 'repeat abuse';
    (root.querySelector('.detail input[type=number]') as HTMLInputElement).value = '7';
    ([...root.querySelectorAll('.detail button')].find((b) => b.textContent === 'Suspend') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(calls.some(([k]) => k === 'POST /v1/admin/reports/:reportId/suspend')).toBe(true));
    expect(confirm).toHaveBeenCalledWith("Pause Calm Cobra's rooms, cups, groups and name changes for 7 days?");
    const suspend = calls.find(([k]) => k === 'POST /v1/admin/reports/:reportId/suspend');
    expect(suspend?.[1]).toEqual({ notes: 'repeat abuse', days: 7 });
    expect(suspend?.[2]).toEqual({ reportId: '7' });
  });
});
