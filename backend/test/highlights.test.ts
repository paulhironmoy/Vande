// @vitest-environment node
/**
 * The highlight pipeline end to end against the mock YouTube adapter: consent (every path), moderation, the signed
 * render API, admin approval, resumable uploads with quota overflow, the dead-letter queue, publication to the
 * Cricket Room, the public landing and attribution.
 */
import { describe, expect, it } from 'vitest';
import type { HighlightJob, HighlightPreview, HighlightPublic, MatchEventLog, Profile, RoomView, Top100Entry } from '@/contracts';
import type { LocalBackend } from '../local/harness';
import { MockYouTube } from '../src/highlights/youtube';
import { CHUNK_BYTES } from '../src/highlights/uploader';
import { Admin, CUTOFF_1, RenderClient, consent, fakeMp4, freeze, mine, playDuel, players, row, sweep } from './highlightHelpers';
import { advanceTo, backend, type Player } from './helpers';

const DAY_MS = 86_400_000;

async function qualified(b: LocalBackend): Promise<{ a: Player; c: Player; job: HighlightJob }> {
  const [a, c] = await players(b, 2);
  await playDuel(a, c, [40, 90]);
  await freeze(b);
  const [job] = await mine(a);
  expect(job.status).toBe('pending_consent');
  return { a, c, job };
}

async function status(b: LocalBackend, jobId: string): Promise<string> {
  return ((await row<{ status: string }>(b, 'SELECT status FROM highlight_jobs WHERE job_id = ?1', jobId)) as { status: string }).status;
}

/** Consent from both, render, deliver, approve: the job ends up scheduled (and queued). */
async function toApproved(b: LocalBackend, a: Player, c: Player, job: HighlightJob, video = fakeMp4(64 * 1024)): Promise<void> {
  expect((await consent(a, job.jobId, 'granted', 'public')).status).toBe(200);
  expect((await consent(c, job.jobId, 'granted', 'public')).status).toBe(200);
  expect(await status(b, job.jobId)).toBe('queued_render');
  const render = new RenderClient(b);
  const claimed = await render.claim();
  expect(claimed.status).toBe(200);
  expect(claimed.body.jobId).toBe(job.jobId);
  expect((await render.deliver(job.jobId, video)).status).toBe(200);
  expect(await status(b, job.jobId)).toBe('pending_moderation');
  expect((await new Admin(b).call('POST', `/v1/admin/jobs/${job.jobId}/approve`, { notes: 'looks good' })).status).toBe(200);
  expect(await status(b, job.jobId)).toBe('scheduled');
}

describe('consent', () => {
  it('previews the exact render input, needs everyone, and the stricter visibility wins', async () => {
    const b = await backend();
    const { a, c, job } = await qualified(b);
    const preview = await a.call<HighlightPreview>('GET', `/v1/highlights/${job.jobId}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.body.myDecision).toBeNull();
    expect(preview.body.input.log.matchId).toBe(job.matchId);
    expect(preview.body.input.cta.url).toBe(`http://localhost:5173/h/${job.attributionCode}`);
    expect(preview.body.input.ranks.filter((r) => r !== null).length).toBeGreaterThan(0);
    // Strangers see nothing.
    const [x] = await players(b, 1, 'Stranger');
    expect((await x.call('GET', `/v1/highlights/${job.jobId}/preview`)).status).toBe(404);
    expect((await x.call('POST', `/v1/highlights/${job.jobId}/consent`, { decision: 'granted', adultConfirmed: true, visibility: 'public' })).status).toBe(404);
    // Granting needs the 18+ confirmation.
    expect((await consent(a, job.jobId, 'granted', 'public', false)).status).toBe(400);
    const first = await consent(a, job.jobId, 'granted', 'public');
    expect(first.body).toMatchObject({ decision: 'granted', adultConfirmed: true, approvedVisibility: 'public', approvedTitle: job.title });
    expect(await status(b, job.jobId)).toBe('pending_consent');
    await consent(c, job.jobId, 'granted', 'unlisted');
    expect(await status(b, job.jobId)).toBe('queued_render');
    expect((await row(b, 'SELECT visibility FROM highlight_jobs WHERE job_id = ?1', job.jobId))?.visibility).toBe('unlisted');
    expect((await a.call<HighlightPreview>('GET', `/v1/highlights/${job.jobId}/preview`)).body.myDecision).toBe('granted');
    // Consent is closed once decided.
    expect((await consent(a, job.jobId, 'declined')).status).toBe(409);
    b.close();
  });

  it('any decline means no video, and the Top 100 badge stays', async () => {
    const b = await backend();
    const { a, c, job } = await qualified(b);
    await consent(a, job.jobId, 'granted');
    await consent(c, job.jobId, 'declined');
    expect(await status(b, job.jobId)).toBe('consent_declined');
    expect((await new RenderClient(b).claim()).status).toBe(204);
    for (const p of [a, c]) expect((await p.call<Profile>('GET', '/v1/me')).body.badges).toContain('youtube_top100');
    b.close();
  });

  it('no answer within 48 hours counts as declined (recorded as a timeout)', async () => {
    const b = await backend();
    const { a, job } = await qualified(b);
    await consent(a, job.jobId, 'granted');
    await advanceTo(b, CUTOFF_1 + 47 * 3_600_000);
    await sweep(b);
    expect(await status(b, job.jobId)).toBe('pending_consent');
    await advanceTo(b, CUTOFF_1 + 49 * 3_600_000);
    await sweep(b);
    expect(await status(b, job.jobId)).toBe('consent_declined');
    const trail = await b.db.prepare('SELECT decision, reason FROM highlight_consents WHERE job_id = ?1 ORDER BY seq').bind(job.jobId).all();
    expect(trail.results).toEqual([{ decision: 'granted', reason: null }, { decision: 'declined', reason: 'timeout' }]);
    expect((await a.call<Profile>('GET', '/v1/me')).body.badges).toContain('youtube_top100');
    b.close();
  });

  it('a withdrawal before the upload cancels the job and deletes the rendered video', async () => {
    const b = await backend();
    const { a, c, job } = await qualified(b);
    await consent(a, job.jobId, 'granted');
    await consent(c, job.jobId, 'granted');
    const render = new RenderClient(b);
    await render.claim();
    await render.deliver(job.jobId);
    expect(b.files.objects.has(`tmp/highlights/${job.jobId}.mp4`)).toBe(true);
    const w = await c.call('POST', `/v1/highlights/${job.jobId}/withdraw`, { reason: 'changed my mind' });
    expect(w.status).toBe(200);
    expect(w.body).toMatchObject({ decision: 'withdrawn' });
    expect(await status(b, job.jobId)).toBe('consent_declined');
    expect(b.files.objects.has(`tmp/highlights/${job.jobId}.mp4`)).toBe(false);
    await b.drainQueues();
    expect((b.youtube as MockYouTube).calls.filter((x) => x.startsWith('start'))).toEqual([]);
    b.close();
  });

  it('a withdrawal after publication removes the video through the adapter', async () => {
    const b = await backend();
    const { a, c, job } = await qualified(b);
    const codesOnTop100 = async () => (await a.call<Top100Entry[]>('GET', `/v1/top100/${job.day}`)).body.map((e) => e.highlightCode ?? null);
    // Waiting for consent: the Top 100 links no landing.
    expect(new Set(await codesOnTop100())).toEqual(new Set([null]));
    await toApproved(b, a, c, job);
    await b.drainQueues();
    expect(await status(b, job.jobId)).toBe('published');
    // Live: every entry whose best match it is links its public landing.
    expect(new Set(await codesOnTop100())).toEqual(new Set([job.attributionCode]));
    const yt = b.youtube as MockYouTube;
    const videoId = (await row<{ youtube_video_id: string }>(b, 'SELECT youtube_video_id FROM highlight_jobs WHERE job_id = ?1', job.jobId))!.youtube_video_id;
    expect(yt.videos.get(videoId)?.removed).toBe(false);
    expect((await a.call('POST', `/v1/highlights/${job.jobId}/withdraw`, {})).status).toBe(200);
    await b.drainQueues();
    expect(await status(b, job.jobId)).toBe('removed');
    expect(yt.videos.get(videoId)?.removed).toBe(true);
    expect((await a.call('GET', `/v1/h/${job.attributionCode}`)).status).toBe(404);
    // Withdrawn: the link is gone from the Top 100 too.
    expect(new Set(await codesOnTop100())).toEqual(new Set([null]));
    b.close();
  });

  it('a withdrawal during the upload stops it: no video, or the finished one is removed at once', async () => {
    for (const crashAt of ['first', 'last'] as const) {
      const b = await backend();
      const { a, c, job } = await qualified(b);
      const yt = b.youtube as MockYouTube;
      // One chunk: a crash after the last byte leaves a finished video the Worker has not recorded yet.
      const size = crashAt === 'first' ? CHUNK_BYTES + 4096 : 4096;
      yt.failNext('crash', 'chunk');
      await toApproved(b, a, c, job, fakeMp4(size));
      await b.drainQueues();
      expect(await status(b, job.jobId)).toBe('uploading');
      expect((await c.call('POST', `/v1/highlights/${job.jobId}/withdraw`, {})).status).toBe(200);
      for (let i = 0; i < 4; i++) {
        await advanceTo(b, b.clock.now() + 2 * 60_000);
        await b.drainQueues();
      }
      if (crashAt === 'first') {
        expect(await status(b, job.jobId)).toBe('consent_declined');
        expect(yt.inserts.get(job.jobId) ?? 0).toBe(0);
        expect(b.files.objects.has(`tmp/highlights/${job.jobId}.mp4`)).toBe(false);
      } else {
        expect(await status(b, job.jobId)).toBe('removed');
        expect([...yt.videos.values()].every((v) => v.removed)).toBe(true);
      }
      b.close();
    }
  });

  it('deleting the account withdraws: the published video is removed', async () => {
    const b = await backend();
    const { a, c, job } = await qualified(b);
    await toApproved(b, a, c, job);
    await b.drainQueues();
    expect((await c.call('DELETE', '/v1/me')).status).toBe(200);
    await b.drainQueues();
    expect(await status(b, job.jobId)).toBe('removed');
    expect(await row(b, "SELECT COUNT(*) AS n FROM highlight_consents WHERE uid != 'x:deleted' AND player_id = 'p-deleted'")).toEqual({ n: 0 });
    b.close();
  });
});

describe('moderation', () => {
  it('rejects automatically when the timing audit flagged the match, before any render', async () => {
    const b = await backend();
    const { a, c, job } = await qualified(b);
    await b.db.prepare('UPDATE match_results SET suspect1 = 1 WHERE match_id = ?1').bind(job.matchId).run();
    await consent(a, job.jobId, 'granted');
    await consent(c, job.jobId, 'granted');
    expect(await status(b, job.jobId)).toBe('rejected');
    const m = await row<{ anti_cheat: string; reviewer: string; notes: string }>(b, 'SELECT anti_cheat, reviewer, notes FROM highlight_moderation WHERE job_id = ?1', job.jobId);
    expect(m).toMatchObject({ anti_cheat: 'fail', reviewer: 'auto' });
    expect(m?.notes).toContain('timing_audit');
    expect((await new RenderClient(b).claim()).status).toBe(204);
    b.close();
  });

  it('rejects an alias that no longer passes the filter, and the same pair again within 7 days', async () => {
    const b = await backend();
    const { a, c, job } = await qualified(b);
    // Day 2: the same two players again → another job for the same pair.
    await playDuel(a, c, [40, 90]);
    await freeze(b, CUTOFF_1 + DAY_MS + 60_000);
    const day2 = (await mine(a)).find((j) => j.day === '2026-10-27') as HighlightJob;
    expect(day2).toBeDefined();
    // Day 1 still waits for consent; day 2 is a duplicate of it.
    await consent(a, day2.jobId, 'granted');
    await consent(c, day2.jobId, 'granted');
    expect(await status(b, day2.jobId)).toBe('rejected');
    expect((await row<{ duplicate: string }>(b, 'SELECT duplicate FROM highlight_moderation WHERE job_id = ?1', day2.jobId))?.duplicate).toBe('fail');
    // Day 1 with an alias the filter now refuses.
    await b.db.prepare("UPDATE highlight_jobs SET alias0 = 'admin' WHERE job_id = ?1").bind(job.jobId).run();
    await consent(a, job.jobId, 'granted');
    await consent(c, job.jobId, 'granted');
    expect(await status(b, job.jobId)).toBe('rejected');
    expect((await row<{ alias_check: string }>(b, 'SELECT alias_check FROM highlight_moderation WHERE job_id = ?1', job.jobId))?.alias_check).toBe('fail');
    b.close();
  });

  it('waits for an admin after the render, unless HIGHLIGHT_AUTO_APPROVE=1', async () => {
    const b = await backend({ vars: { HIGHLIGHT_AUTO_APPROVE: '1' } });
    const { a, c, job } = await qualified(b);
    await consent(a, job.jobId, 'granted');
    await consent(c, job.jobId, 'granted');
    const render = new RenderClient(b);
    await render.claim();
    await render.deliver(job.jobId);
    expect(await status(b, job.jobId)).toBe('scheduled');
    await b.drainQueues();
    expect(await status(b, job.jobId)).toBe('published');
    b.close();
  });
});

describe('upload adapter', () => {
  it('publishes once, posts to the Cricket Room, notifies, and the landing hides mock ids', async () => {
    const b = await backend();
    const { a, c, job } = await qualified(b);
    await toApproved(b, a, c, job);
    await b.drainQueues();
    expect(await status(b, job.jobId)).toBe('published');
    const yt = b.youtube as MockYouTube;
    expect(yt.inserts.get(job.jobId)).toBe(1);
    // A duplicate message, a retry or an admin retry never uploads again.
    await b.env.MEDIA_QUEUE?.send({ v: 1, kind: 'upload', jobId: job.jobId });
    await b.drainQueues();
    expect(yt.inserts.get(job.jobId)).toBe(1);
    expect(yt.calls.filter((x) => x.startsWith('start')).length).toBe(1);
    // Room post and notifications.
    const room = (await a.call<RoomView>('GET', `/v1/rooms/r${job.matchId.slice(1)}`)).body;
    expect(room.posts.filter((p) => p.kind === 'highlight')).toHaveLength(1);
    expect(room.posts.find((p) => p.kind === 'highlight')?.payload).toMatchObject({ jobId: job.jobId, code: job.attributionCode, matchId: job.matchId, url: `http://localhost:5173/h/${job.attributionCode}` });
    expect(b.notify.sent.filter((m) => m.kind === 'highlight_published')).toHaveLength(2);
    // Public landing and replay.
    const landing = await new (a.constructor as new (bk: LocalBackend) => Player)(b).call<HighlightPublic>('GET', `/v1/h/${job.attributionCode}`, undefined, { token: null });
    expect(landing.status).toBe(200);
    expect(landing.body).toMatchObject({ code: job.attributionCode, youtubeVideoId: null, matchId: job.matchId, visibility: 'public' });
    expect(landing.body.participants.map((p) => p.alias)).toEqual(['Swift Tiger', 'Calm Cobra']);
    const replay = await a.call<MatchEventLog>('GET', `/v1/h/${job.attributionCode}/replay`, undefined, { token: null });
    expect(replay.status).toBe(200);
    expect(replay.body.matchId).toBe(job.matchId);
    b.close();
  });

  it('resumes after a crash from the bytes YouTube received, without a second upload', async () => {
    const b = await backend();
    const { a, c, job } = await qualified(b);
    const yt = b.youtube as MockYouTube;
    yt.failNext('crash', 'chunk');
    await toApproved(b, a, c, job, fakeMp4(CHUNK_BYTES + 4096));
    await b.drainQueues();
    expect(await status(b, job.jobId)).toBe('uploading');
    // The queue retries a minute later.
    await advanceTo(b, b.clock.now() + 2 * 60_000);
    await b.drainQueues();
    expect(await status(b, job.jobId)).toBe('published');
    expect(yt.inserts.get(job.jobId)).toBe(1);
    expect(yt.calls.filter((x) => x.startsWith('start'))).toHaveLength(1);
    expect(yt.calls).toEqual(expect.arrayContaining([`chunk:${job.jobId}:0`, `query:${job.jobId}`, `chunk:${job.jobId}:${CHUNK_BYTES}`]));
    expect(yt.calls.filter((x) => x === `chunk:${job.jobId}:0`)).toHaveLength(1);
    expect(b.metrics.total('upload_resumed')).toBeGreaterThanOrEqual(1);
    b.close();
  });

  it('overflows to the next quota day (Pacific midnight) when the quota minus the headroom is used', async () => {
    // 2,000 units with 20 % headroom leaves room for exactly one 1,600-unit upload per day.
    const b = await backend({ vars: { YT_DAILY_QUOTA: '2000', YT_UNITS_PER_UPLOAD: '1600', YT_HEADROOM: '0.2' } });
    const [a, c, d, e] = await players(b, 4);
    await playDuel(a, c, [40, 90]);
    await playDuel(d, e, [60, 100]);
    await freeze(b);
    const jobs = [...(await mine(a)), ...(await mine(d))];
    expect(jobs).toHaveLength(2);
    for (const [j, p, q] of [[jobs[0], a, c], [jobs[1], d, e]] as const) {
      await consent(p, j.jobId, 'granted');
      await consent(q, j.jobId, 'granted');
    }
    const render = new RenderClient(b);
    for (let i = 0; i < 2; i++) {
      const claimed = await render.claim();
      await render.deliver(claimed.body.jobId);
      await new Admin(b).call('POST', `/v1/admin/jobs/${claimed.body.jobId}/approve`, {});
    }
    await b.drainQueues();
    const states = await Promise.all(jobs.map((j) => status(b, j.jobId)));
    expect(states.sort()).toEqual(['published', 'scheduled']);
    const sched = await row<{ scheduled_ms: number; last_error: string }>(b, "SELECT scheduled_ms, last_error FROM highlight_jobs WHERE status = 'scheduled'");
    // Next Pacific midnight after 2026-10-26 18:31 UTC (PDT, UTC−7) is 2026-10-27 07:00 UTC.
    expect(sched!.scheduled_ms).toBeGreaterThanOrEqual(Date.UTC(2026, 9, 27, 7, 0));
    expect(sched!.last_error).toBe('quota_full');
    const quota = await new Admin(b).call<{ used: number; uploads: number; usable: number; uploadsPerDay: number }>('GET', '/v1/admin/quota');
    expect(quota.body).toMatchObject({ used: 1600, uploads: 1600, usable: 1600, uploadsPerDay: 1 });
    await advanceTo(b, sched!.scheduled_ms + 60_000);
    await sweep(b);
    await b.drainQueues();
    expect((await Promise.all(jobs.map((j) => status(b, j.jobId)))).sort()).toEqual(['published', 'published']);
    b.close();
  });

  it('moves a job to dead_letter after the retries (and an admin can retry it)', async () => {
    const b = await backend();
    const { a, c, job } = await qualified(b);
    const yt = b.youtube as MockYouTube;
    yt.failNext('transient', 'start', 20);
    await toApproved(b, a, c, job);
    for (let i = 0; i < 12; i++) {
      await b.drainQueues();
      await advanceTo(b, b.clock.now() + 3_600_000);
    }
    expect(await status(b, job.jobId)).toBe('dead_letter');
    expect(b.metrics.total('media_dead_letter')).toBe(1);
    // Fixed: the admin retries and it goes through.
    (yt as unknown as { failures: unknown[] }).failures.length = 0;
    expect((await new Admin(b).call('POST', `/v1/admin/jobs/${job.jobId}/retry-upload`)).status).toBe(200);
    await b.drainQueues();
    expect(await status(b, job.jobId)).toBe('published');
    expect(yt.inserts.get(job.jobId)).toBe(1);
    b.close();
  });

  it('a quota refusal from YouTube itself also reschedules; permanent refusals wait for an admin', async () => {
    const b = await backend();
    const { a, c, job } = await qualified(b);
    const yt = b.youtube as MockYouTube;
    yt.quotaExhausted = true;
    await toApproved(b, a, c, job);
    await b.drainQueues();
    expect(await status(b, job.jobId)).toBe('scheduled');
    yt.quotaExhausted = false;
    yt.failNext('permanent', 'start');
    await advanceTo(b, (await row<{ scheduled_ms: number }>(b, 'SELECT scheduled_ms FROM highlight_jobs'))!.scheduled_ms + 60_000);
    await sweep(b);
    await b.drainQueues();
    expect(await row(b, 'SELECT status, last_error FROM highlight_jobs')).toEqual({ status: 'upload_failed', last_error: 'youtube_permanent' });
    b.close();
  });

  it('deletes the temporary MP4 72 hours after a confirmed upload and keeps the replay log', async () => {
    const b = await backend();
    const { a, c, job } = await qualified(b);
    await toApproved(b, a, c, job);
    await b.drainQueues();
    const key = `tmp/highlights/${job.jobId}.mp4`;
    await advanceTo(b, b.clock.now() + 71 * 3_600_000);
    await sweep(b);
    expect(b.files.objects.has(key)).toBe(true);
    await advanceTo(b, b.clock.now() + 2 * 3_600_000);
    await sweep(b);
    expect(b.files.objects.has(key)).toBe(false);
    expect(b.files.objects.has(`logs/${job.matchId}.json.gz`)).toBe(true);
    b.close();
  });
});

describe('render service API', () => {
  it('refuses unsigned, wrongly signed, stale, replayed and mismatched requests', async () => {
    const b = await backend();
    const { a, c, job } = await qualified(b);
    await consent(a, job.jobId, 'granted');
    await consent(c, job.jobId, 'granted');
    const render = new RenderClient(b);
    const plain = await b.fetch('http://127.0.0.1:8787/v1/internal/render/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(plain.status).toBe(401);
    const stale = await render.send('POST', '/v1/internal/render/claim', '{}', { 'content-type': 'application/json' }, { now: b.clock.now() - 10 * 60_000 });
    expect(stale.status).toBe(401);
    const wrongHash = await render.send('POST', '/v1/internal/render/claim', '{}', { 'content-type': 'application/json' }, { sha: 'a'.repeat(64) });
    expect(wrongHash.status).toBe(401);
    const nonce = crypto.randomUUID();
    expect((await render.send('POST', '/v1/internal/render/claim', '{}', { 'content-type': 'application/json' }, { nonce })).status).toBe(200);
    expect((await render.send('POST', '/v1/internal/render/claim', '{}', { 'content-type': 'application/json' }, { nonce })).status).toBe(401);
    // The video must match the signed hash (R2 checks it).
    const bytes = fakeMp4(1024);
    const bad = await render.send('PUT', `/v1/internal/render/jobs/${job.jobId}/video`, bytes, { 'content-type': 'video/mp4', 'content-length': '1024' }, { sha: 'b'.repeat(64) });
    expect(bad.status).toBe(400);
    // Without RENDER_KEYS the API is off.
    const off = await backend({ vars: { RENDER_KEYS: '' } });
    expect((await new RenderClient(off).claim()).status).toBe(503);
    off.close();
    b.close();
  });

  it('retries a failed or abandoned render with backoff, then dead_letter', async () => {
    const b = await backend();
    const { a, c, job } = await qualified(b);
    await consent(a, job.jobId, 'granted');
    await consent(c, job.jobId, 'granted');
    const render = new RenderClient(b);
    expect((await render.claim()).body.jobId).toBe(job.jobId);
    expect((await render.json(`/v1/internal/render/jobs/${job.jobId}/fail`, { error: 'chromium crashed', retryable: true })).body).toEqual({ status: 'render_failed' });
    expect((await render.claim()).status).toBe(204); // backoff
    await advanceTo(b, b.clock.now() + 6 * 60_000);
    expect((await render.claim()).body.jobId).toBe(job.jobId);
    // Abandoned: the lease expires and the sweeper counts it as a failed attempt.
    await advanceTo(b, b.clock.now() + 21 * 60_000);
    await sweep(b);
    expect(await status(b, job.jobId)).toBe('render_failed');
    await advanceTo(b, b.clock.now() + 30 * 60_000);
    expect((await render.claim()).body.jobId).toBe(job.jobId);
    expect((await render.json(`/v1/internal/render/jobs/${job.jobId}/fail`, { error: 'again', retryable: true })).body).toEqual({ status: 'dead_letter' });
    b.close();
  });
});

describe('attribution', () => {
  it('counts landing opens, shares and installs per code per day, and credits invite opens and completed duels', async () => {
    const b = await backend();
    const { a, c, job } = await qualified(b);
    // Not yet published: unknown to the public.
    expect((await a.call('POST', '/v1/attribution', { code: job.attributionCode, event: 'landing_open' }, { token: null })).status).toBe(404);
    await toApproved(b, a, c, job);
    await b.drainQueues();
    for (const event of ['landing_open', 'landing_open', 'share', 'install']) expect((await a.call('POST', '/v1/attribution', { code: job.attributionCode, event }, { token: null, idem: false })).status).toBe(200);
    expect((await a.call('POST', '/v1/attribution', { code: job.attributionCode, event: 'purchase' }, { token: null })).status).toBe(400);
    expect((await a.call('POST', '/v1/attribution', { code: 'zzzz9999', event: 'share' }, { token: null })).status).toBe(404);
    // A newcomer starts a duel from the landing: its invite opens and its completion count too.
    const [n, f] = await players(b, 2, 'Newcomer');
    const created = await n.call<{ matchId: string; inviteToken: string; inviteUrl: string }>('POST', '/v1/duels', { attributionCode: job.attributionCode });
    expect(created.body.inviteUrl).toContain(`?a=${job.attributionCode}`);
    await f.call('GET', `/v1/invites/${created.body.inviteToken}`, undefined, { token: null });
    await f.call('POST', `/v1/invites/${created.body.inviteToken}/accept`);
    await n.lock(created.body.matchId, 1);
    await f.lock(created.body.matchId, 2);
    await n.batInnings(created.body.matchId, 40);
    await f.batInnings(created.body.matchId, 90);
    await n.call('GET', `/v1/matches/${created.body.matchId}/reveal`);
    await b.idle();
    const counts = await b.db.prepare('SELECT event, n FROM attribution_daily WHERE code = ?1 ORDER BY event').bind(job.attributionCode).all();
    expect(counts.results).toEqual([
      { event: 'install', n: 1 },
      { event: 'invite_open', n: 1 },
      { event: 'landing_open', n: 2 },
      { event: 'match_completed', n: 1 },
      { event: 'share', n: 1 },
    ]);
    b.close();
  });
});
