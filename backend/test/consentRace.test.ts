// @vitest-environment node
/**
 * Regression tests from the security review: a consent withdrawal or an admin removal that races the uploader must
 * never end with a published video, and the sweeper removes any live or uploading job whose consent is incomplete.
 */
import { describe, expect, it } from 'vitest';
import type { HighlightJob } from '@/contracts';
import type { LocalBackend } from '../local/harness';
import type { D1Like, D1StatementLike } from '../src/env';
import { HSQL } from '../src/highlights/sql';
import { CHUNK_BYTES } from '../src/highlights/uploader';
import type { MockYouTube } from '../src/highlights/youtube';
import { advanceTo, backend, type Player } from './helpers';
import { Admin, RenderClient, consent, fakeMp4, freeze, mine, playDuel, players, row, sweep } from './highlightHelpers';

/** A statement whose run waits for `before` and reports to `after` (to order two requests deterministically). */
function gated(st: D1StatementLike, before?: () => Promise<void>, after?: () => void): D1StatementLike {
  const wrap = (fn: () => Promise<unknown>) => async () => {
    if (before) await before();
    const r = await fn();
    after?.();
    return r;
  };
  return {
    bind: (...v: unknown[]) => gated(st.bind(...v), before, after),
    run: wrap(() => st.run()) as D1StatementLike['run'],
    first: wrap(() => st.first()) as D1StatementLike['first'],
    all: wrap(() => st.all()) as D1StatementLike['all'],
  };
}

async function approved(b: LocalBackend, video = fakeMp4(64 * 1024)): Promise<{ a: Player; c: Player; job: HighlightJob }> {
  const [a, c] = await players(b, 2);
  await playDuel(a, c, [40, 90]);
  await freeze(b);
  const [job] = await mine(a);
  expect((await consent(a, job.jobId, 'granted')).status).toBe(200);
  expect((await consent(c, job.jobId, 'granted')).status).toBe(200);
  const render = new RenderClient(b);
  expect((await render.claim()).status).toBe(200);
  expect((await render.deliver(job.jobId, video)).status).toBe(200);
  expect((await new Admin(b).call('POST', `/v1/admin/jobs/${job.jobId}/approve`, {})).status).toBe(200);
  return { a, c, job };
}

async function jobState(b: LocalBackend, jobId: string) {
  return (await row<{ status: string; youtube_video_id: string | null; withdraw_pending: number }>(b, 'SELECT status, youtube_video_id, withdraw_pending FROM highlight_jobs WHERE job_id = ?1', jobId))!;
}

describe('a withdrawal racing the uploader', () => {
  it('is never published: the withdrawal read the job before the session started and wrote after it', async () => {
    const b = await backend();
    const { c, job } = await approved(b);
    // Hold the withdrawal's consent row until the uploader has stored its session (the review's interleaving).
    const real = b.env.DB;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let reached!: () => void;
    const atGate = new Promise<void>((r) => (reached = r));
    let armed = false;
    const db: D1Like = {
      prepare(sql: string) {
        const st = real.prepare(sql);
        if (armed && sql === HSQL.insertConsent) {
          reached();
          return gated(st, () => gate);
        }
        if (armed && sql === HSQL.setSession) return gated(st, undefined, () => release());
        return st;
      },
      batch: (s) => real.batch(s),
    };
    (b.env as { DB: D1Like }).DB = db;
    const yt = b.youtube as MockYouTube;
    const start = yt.startUpload.bind(yt);
    let withdrawal: Promise<{ status: number }> | null = null;
    yt.startUpload = async (meta) => {
      armed = true;
      withdrawal = c.call('POST', `/v1/highlights/${job.jobId}/withdraw`, { reason: 'changed my mind' });
      await atGate;
      return start(meta);
    };
    await b.drainQueues();
    expect((await withdrawal!).status).toBe(200);
    armed = false;
    (b.env as { DB: D1Like }).DB = real;
    for (let i = 0; i < 4; i++) {
      await advanceTo(b, b.clock.now() + 2 * 60_000);
      await b.drainQueues();
      await sweep(b);
    }
    const end = await jobState(b, job.jobId);
    expect(['consent_declined', 'removed']).toContain(end.status);
    expect([...yt.videos.values()].every((v) => v.removed)).toBe(true);
    expect((await c.call('GET', `/v1/h/${job.attributionCode}`)).status).toBe(404);
    expect(b.notify.sent.filter((m) => m.kind === 'highlight_published')).toEqual([]);
    b.close();
  });

  it('a withdrawal mid-upload stops it at the next chunk, without being announced', async () => {
    const b = await backend();
    const { c, job } = await approved(b, fakeMp4(CHUNK_BYTES * 2 + 4096));
    const yt = b.youtube as MockYouTube;
    const chunk = yt.uploadChunk.bind(yt);
    let sent = 0;
    yt.uploadChunk = async (...args) => {
      // The participant withdraws right after the first chunk left.
      if (sent++ === 0) {
        const r = await chunk(...args);
        expect((await c.call('POST', `/v1/highlights/${job.jobId}/withdraw`, {})).status).toBe(200);
        return r;
      }
      return chunk(...args);
    };
    await b.drainQueues();
    await b.drainQueues();
    const end = await jobState(b, job.jobId);
    expect(end.status).toBe('consent_declined');
    expect(yt.inserts.get(job.jobId) ?? 0).toBe(0);
    expect(b.notify.sent.filter((m) => m.kind === 'highlight_published')).toEqual([]);
    b.close();
  });
});

describe('an admin removal while the job is uploading', () => {
  it('never re-queues the upload: the job ends removed and nothing is published', async () => {
    const b = await backend();
    const yt = b.youtube as MockYouTube;
    yt.failNext('crash', 'chunk');
    const { job } = await approved(b, fakeMp4(CHUNK_BYTES + 4096));
    await b.drainQueues();
    expect((await jobState(b, job.jobId)).status).toBe('uploading');
    expect((await new Admin(b).call('POST', `/v1/admin/jobs/${job.jobId}/remove`, {})).status).toBe(202);
    expect((await jobState(b, job.jobId)).withdraw_pending).toBe(2);
    // The removal is consumed before the upload's retry falls due (the order that used to publish the video).
    await b.drainQueues();
    for (let i = 0; i < 4; i++) {
      await advanceTo(b, b.clock.now() + 2 * 60_000);
      await b.drainQueues();
    }
    const end = await jobState(b, job.jobId);
    expect(end.status).toBe('removed');
    expect([...yt.videos.values()].every((v) => v.removed)).toBe(true);
    expect(b.notify.sent.filter((m) => m.kind === 'highlight_published')).toEqual([]);
    // Nothing can schedule or retry it back into publication.
    expect((await new Admin(b).call('POST', `/v1/admin/jobs/${job.jobId}/retry-upload`, {})).status).toBe(409);
    b.close();
  });
});

describe('the sweeper reconciles consent', () => {
  it('removes a live video whose latest consent is no longer "granted", and takes the room card down', async () => {
    const b = await backend();
    const { a, job } = await approved(b);
    await b.drainQueues();
    expect((await jobState(b, job.jobId)).status).toBe('published');
    const roomId = `r${job.matchId.slice(1)}`;
    const before = await a.call<{ posts: Array<{ kind: string }> }>('GET', `/v1/rooms/${roomId}`);
    expect(before.body.posts.some((p) => p.kind === 'highlight')).toBe(true);
    // A withdrawal recorded without the rest of its steps (the state a lost race leaves behind).
    const consentRow = (await row<{ uid: string; player_id: string }>(b, 'SELECT uid, player_id FROM highlight_consents WHERE job_id = ?1 ORDER BY seq LIMIT 1', job.jobId))!;
    await b.db.prepare(HSQL.insertConsent).bind(job.jobId, consentRow.uid, consentRow.player_id, 'withdrawn', 0, job.title, 'public', 'test', b.clock.now()).run();
    await sweep(b);
    await b.drainQueues();
    const end = await jobState(b, job.jobId);
    expect(end.status).toBe('removed');
    expect((b.youtube as MockYouTube).videos.get(end.youtube_video_id as string)?.removed).toBe(true);
    const after = await a.call<{ posts: Array<{ kind: string }> }>('GET', `/v1/rooms/${roomId}`);
    expect(after.body.posts.some((p) => p.kind === 'highlight')).toBe(false);
    b.close();
  });
});
