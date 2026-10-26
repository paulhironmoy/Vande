// @vitest-environment node
/**
 * The real YouTube adapter against a stubbed YouTube (OAuth token endpoint, resumable uploads, videos API), and the
 * pipeline's promise never to claim a publication that did not happen: production without the channel's secrets
 * holds jobs as awaiting_channel (no room card, no push), and a removal that keeps failing becomes removal_failed
 * (an alert, the dead-letter list, hourly retries) until the video is gone.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { HighlightJob, RoomView } from '@/contracts';
import type { LocalBackend } from '../local/harness';
import { CHUNK_BYTES, __resetYouTubeForTests } from '../src/highlights/uploader';
import { MockYouTube, RealYouTube, YouTubeError, type YouTubeErrorKind } from '../src/highlights/youtube';
import { Admin, RenderClient, consent, fakeMp4, freeze, mine, playDuel, players, row, sweep } from './highlightHelpers';
import { advanceTo, backend, type Player } from './helpers';

const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos';
const VIDEOS = 'https://www.googleapis.com/youtube/v3/videos';
const TOKEN = 'https://oauth2.googleapis.com/token';

interface Seen {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Uint8Array | string | null;
}

/** A stand-in for Google's endpoints: OAuth, resumable sessions that keep the bytes, and the videos API. */
class FakeYouTube {
  readonly seen: Seen[] = [];
  readonly sessions = new Map<string, { total: number; chunks: Uint8Array[]; received: number; videoId: string | null }>();
  readonly videos = new Map<string, { privacy: string; removed: boolean; bytes: number; views: number }>();
  tokens = 0;
  private seq = 0;
  /** The next calls of this kind answer with this status and reason (or throw, for 'network'). */
  private failures: Array<{ on: 'start' | 'chunk' | 'query' | 'delete' | 'privacy' | 'token'; status: number | 'network' | 'crash'; reason?: string }> = [];

  fail(on: FakeYouTube['failures'][number]['on'], status: number | 'network' | 'crash', reason?: string, times = 1): this {
    for (let i = 0; i < times; i++) this.failures.push({ on, status, reason });
    return this;
  }

  private take(on: FakeYouTube['failures'][number]['on']) {
    const i = this.failures.findIndex((f) => f.on === on);
    return i < 0 ? null : this.failures.splice(i, 1)[0];
  }

  private static error(status: number, reason?: string): Response {
    return new Response(JSON.stringify({ error: { code: status, errors: reason ? [{ reason }] : [] } }), { status, headers: { 'content-type': 'application/json' } });
  }

  private range(s: { received: number }): Record<string, string> {
    return s.received ? { range: `bytes=0-${s.received - 1}` } : {};
  }

  /** Everything a session received, in order. */
  bytesOf(id: string): Uint8Array {
    const s = this.sessions.get(id)!;
    const out = new Uint8Array(s.received);
    let at = 0;
    for (const c of s.chunks) {
      out.set(c, at);
      at += c.byteLength;
    }
    return out;
  }

  readonly fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const raw = init.body;
    const body = raw instanceof Uint8Array ? raw : typeof raw === 'string' ? raw : null;
    const method = init.method ?? 'GET';
    this.seen.push({ method, url: input, headers, body });
    if (input === TOKEN) {
      const f = this.take('token');
      if (f) return f.status === 'network' ? Promise.reject(new TypeError('fetch failed')) : FakeYouTube.error(f.status as number);
      this.tokens++;
      return Response.json({ access_token: `at-${this.tokens}`, expires_in: 3600 });
    }
    if (headers.authorization !== `Bearer at-${this.tokens}`) return FakeYouTube.error(401);
    const url = new URL(input);
    if (`${url.origin}${url.pathname}` === UPLOAD && method === 'POST') {
      const f = this.take('start');
      if (f) return FakeYouTube.error(f.status as number, f.reason);
      const id = `up${++this.seq}`;
      this.sessions.set(id, { total: Number(headers['x-upload-content-length']), chunks: [], received: 0, videoId: null });
      return new Response(null, { status: 200, headers: { location: `${UPLOAD}?uploadType=resumable&upload_id=${id}` } });
    }
    if (`${url.origin}${url.pathname}` === UPLOAD && method === 'PUT') {
      const s = this.sessions.get(url.searchParams.get('upload_id') ?? '');
      if (!s) return FakeYouTube.error(404);
      const cr = headers['content-range'] ?? '';
      if (/^bytes \*\//.test(cr)) {
        const f = this.take('query');
        if (f) return FakeYouTube.error(f.status as number, f.reason);
        return s.videoId ? Response.json({ id: s.videoId }, { status: 200 }) : new Response(null, { status: 308, headers: this.range(s) });
      }
      const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(cr);
      if (!m || Number(m[1]) !== s.received || !(body instanceof Uint8Array)) return FakeYouTube.error(400, 'badContentRange');
      const f = this.take('chunk');
      if (f && f.status !== 'crash') return FakeYouTube.error(f.status as number, f.reason);
      s.chunks.push(body.slice());
      s.received += body.byteLength;
      if (s.received >= s.total && !s.videoId) {
        s.videoId = `yt${String(this.seq).padStart(9, '0')}`;
        this.videos.set(s.videoId, { privacy: 'public', removed: false, bytes: s.received, views: 0 });
      }
      // 'crash': YouTube took the bytes but the answer never arrived.
      if (f?.status === 'crash') return Promise.reject(new TypeError('connection reset'));
      return s.videoId ? Response.json({ id: s.videoId }, { status: 201 }) : new Response(null, { status: 308, headers: this.range(s) });
    }
    if (`${url.origin}${url.pathname}` === VIDEOS && method === 'DELETE') {
      const f = this.take('delete');
      if (f) return FakeYouTube.error(f.status as number, f.reason);
      const v = this.videos.get(url.searchParams.get('id') ?? '');
      if (!v || v.removed) return FakeYouTube.error(404, 'videoNotFound');
      v.removed = true;
      return new Response(null, { status: 204 });
    }
    if (`${url.origin}${url.pathname}` === VIDEOS && method === 'PUT') {
      const f = this.take('privacy');
      if (f) return FakeYouTube.error(f.status as number, f.reason);
      const b = JSON.parse(String(body)) as { id: string; status: { privacyStatus: string } };
      const v = this.videos.get(b.id);
      if (!v) return FakeYouTube.error(404, 'videoNotFound');
      v.privacy = b.status.privacyStatus;
      return Response.json({ id: b.id });
    }
    if (`${url.origin}${url.pathname}` === VIDEOS && method === 'GET') {
      const ids = (url.searchParams.get('id') ?? '').split(',');
      return Response.json({ items: ids.filter((id) => this.videos.has(id)).map((id) => ({ id, statistics: { viewCount: String(this.videos.get(id)!.views) } })) });
    }
    return FakeYouTube.error(400, 'unexpected');
  };

  real(now = () => Date.UTC(2026, 9, 26, 6, 30)): RealYouTube {
    return new RealYouTube({ clientId: 'cid', clientSecret: 'secret', refreshToken: 'rt', fetch: this.fetch, now });
  }
}

const META = { jobId: 'jtest', title: 'Swift Tiger vs Calm Cobra', description: 'Friend Duel', privacy: 'public' as const, bytes: 10, categoryId: '20', language: 'en' };

async function kind(p: Promise<unknown>): Promise<YouTubeErrorKind | 'ok'> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof YouTubeError) return e.kind;
    throw e;
  }
}

afterEach(() => __resetYouTubeForTests());

describe('RealYouTube (stubbed Google endpoints)', () => {
  it('a resumable upload: one OAuth token, a session on the upload endpoint, chunks with Content-Range, the video id', async () => {
    const g = new FakeYouTube();
    const yt = g.real();
    const { sessionUri } = await yt.startUpload({ ...META, bytes: 10 });
    expect(sessionUri).toMatch(/^https:\/\/www\.googleapis\.com\/upload\/youtube\/v3\/videos\?uploadType=resumable&upload_id=up1$/);
    const start = g.seen.find((x) => x.method === 'POST' && x.url.startsWith(UPLOAD))!;
    expect(start.headers).toMatchObject({ authorization: 'Bearer at-1', 'x-upload-content-type': 'video/mp4', 'x-upload-content-length': '10' });
    expect(JSON.parse(String(start.body))).toMatchObject({ snippet: { title: META.title, categoryId: '20', defaultLanguage: 'en' }, status: { privacyStatus: 'public', selfDeclaredMadeForKids: false } });
    // The OAuth refresh: form-encoded, the refresh token stays server side.
    const token = g.seen.find((x) => x.url === TOKEN)!;
    expect(String(token.body)).toBe('client_id=cid&client_secret=secret&refresh_token=rt&grant_type=refresh_token');
    expect(await yt.uploadChunk(sessionUri, new Uint8Array([1, 2, 3, 4, 5, 6]), 0, 10)).toEqual({ state: 'incomplete', received: 6 });
    expect(await yt.uploadChunk(sessionUri, new Uint8Array([7, 8, 9, 10]), 6, 10)).toEqual({ state: 'complete', videoId: 'yt000000001' });
    expect(g.seen.filter((x) => x.method === 'PUT').map((x) => x.headers['content-range'])).toEqual(['bytes 0-5/10', 'bytes 6-9/10']);
    expect([...g.bytesOf('up1')]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // One token for the whole upload.
    expect(g.tokens).toBe(1);
  });

  it('resumes: asks for the received range (or none) and continues from there', async () => {
    const g = new FakeYouTube();
    const yt = g.real();
    const { sessionUri } = await yt.startUpload({ ...META, bytes: 8 });
    expect(await yt.queryUpload(sessionUri, 8)).toEqual({ state: 'incomplete', received: 0 });
    g.fail('chunk', 'crash');
    expect(await kind(yt.uploadChunk(sessionUri, new Uint8Array([1, 2, 3, 4, 5]), 0, 8))).toBe('transient');
    // The bytes arrived although the answer did not: the empty PUT says so.
    expect(await yt.queryUpload(sessionUri, 8)).toEqual({ state: 'incomplete', received: 5 });
    expect(g.seen.at(-1)!.headers).toMatchObject({ 'content-range': 'bytes */8', 'content-length': '0' });
    expect(await yt.uploadChunk(sessionUri, new Uint8Array([6, 7, 8]), 5, 8)).toMatchObject({ state: 'complete' });
    // Once complete, asking again gives the video (a crash after the last chunk is not a second upload).
    expect(await yt.queryUpload(sessionUri, 8)).toEqual({ state: 'complete', videoId: expect.stringMatching(/^yt/) });
    expect(g.videos.size).toBe(1);
  });

  it('maps refusals: quota, rate limits, expired sessions, auth and everything else', async () => {
    const g = new FakeYouTube();
    const yt = g.real();
    g.fail('start', 403, 'quotaExceeded');
    expect(await kind(yt.startUpload(META))).toBe('quota');
    g.fail('start', 403, 'dailyLimitExceeded');
    expect(await kind(yt.startUpload(META))).toBe('quota');
    g.fail('start', 403, 'rateLimitExceeded');
    expect(await kind(yt.startUpload(META))).toBe('transient');
    g.fail('start', 429);
    expect(await kind(yt.startUpload(META))).toBe('transient');
    g.fail('start', 503);
    expect(await kind(yt.startUpload(META))).toBe('transient');
    g.fail('start', 400, 'invalidTitle');
    expect(await kind(yt.startUpload(META))).toBe('permanent');
    expect(await kind(yt.queryUpload(`${UPLOAD}?uploadType=resumable&upload_id=missing`, 10))).toBe('gone');
    // Session URIs on any other host are refused before a byte is sent.
    const before = g.seen.length;
    expect(await kind(yt.uploadChunk('https://evil.example/upload/youtube/v3/videos?upload_id=x', new Uint8Array([1]), 0, 1))).toBe('gone');
    expect(await kind(yt.queryUpload('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable', 1))).toBe('gone');
    expect(g.seen.length).toBe(before);
    // A token endpoint that refuses is an auth problem; one that is down is transient.
    const h = new FakeYouTube().fail('token', 400);
    expect(await kind(h.real().startUpload(META))).toBe('auth');
    const k = new FakeYouTube().fail('token', 'network');
    expect(await kind(k.real().startUpload(META))).toBe('transient');
  });

  it('refreshes the access token once on a 401, and when it expires', async () => {
    let now = Date.UTC(2026, 9, 26, 6, 30);
    const g = new FakeYouTube();
    const yt = g.real(() => now);
    await yt.startUpload(META);
    expect(g.tokens).toBe(1);
    // Revoked at Google: the next call gets a 401, refreshes once and succeeds.
    g.tokens++;
    await yt.startUpload(META);
    expect(g.tokens).toBe(3);
    now += 3_600_000;
    await yt.startUpload(META);
    expect(g.tokens).toBe(4);
  });

  it('removes a video (already gone counts as removed), changes privacy and reads view counts in batches of 50', async () => {
    const g = new FakeYouTube();
    const yt = g.real();
    const { sessionUri } = await yt.startUpload({ ...META, bytes: 2 });
    const done = await yt.uploadChunk(sessionUri, new Uint8Array([1, 2]), 0, 2);
    const videoId = done.state === 'complete' ? done.videoId : '';
    await yt.setPrivacy(videoId, 'unlisted');
    expect(g.videos.get(videoId)?.privacy).toBe('unlisted');
    g.videos.get(videoId)!.views = 42;
    const ids = [videoId, ...Array.from({ length: 60 }, (_, i) => `other${i}`)];
    expect([...(await yt.statistics(ids))]).toEqual([[videoId, 42]]);
    expect(g.seen.filter((x) => x.method === 'GET' && x.url.startsWith(VIDEOS))).toHaveLength(2);
    g.fail('delete', 403, 'quotaExceeded');
    expect(await kind(yt.remove(videoId))).toBe('quota');
    g.fail('delete', 500);
    expect(await kind(yt.remove(videoId))).toBe('transient');
    await yt.remove(videoId);
    expect(g.videos.get(videoId)?.removed).toBe(true);
    expect(await kind(yt.remove(videoId))).toBe('ok');
    expect(g.seen.filter((x) => x.method === 'DELETE').at(-1)!.url).toBe(`${VIDEOS}?id=${videoId}`);
  });
});

// ---- the pipeline ---------------------------------------------------------------------------------------------------

async function status(b: LocalBackend, jobId: string): Promise<string> {
  return ((await row<{ status: string }>(b, 'SELECT status FROM highlight_jobs WHERE job_id = ?1', jobId)) as { status: string }).status;
}

/** A Top 100 duel whose highlight both players granted, rendered and delivered (approved automatically or by an admin). */
async function rendered(b: LocalBackend, video = fakeMp4(64 * 1024), admin = true): Promise<{ a: Player; c: Player; job: HighlightJob }> {
  const [a, c] = await players(b, 2);
  await playDuel(a, c, [40, 90]);
  await freeze(b);
  const [job] = await mine(a);
  expect((await consent(a, job.jobId, 'granted', 'public')).status).toBe(200);
  expect((await consent(c, job.jobId, 'granted', 'public')).status).toBe(200);
  const render = new RenderClient(b);
  expect((await render.claim()).status).toBe(200);
  expect((await render.deliver(job.jobId, video)).status).toBe(200);
  if (admin) expect((await new Admin(b).call('POST', `/v1/admin/jobs/${job.jobId}/approve`, {})).status).toBe(200);
  expect(await status(b, job.jobId)).toBe('scheduled');
  return { a, c, job };
}

const highlightPosts = async (p: Player, job: HighlightJob) => (await p.call<RoomView>('GET', `/v1/rooms/r${job.matchId.slice(1)}`)).body.posts.filter((x) => x.kind === 'highlight');

describe('never a publication that did not happen', () => {
  it('production without the channel secrets: held as awaiting_channel, no YouTube call, no room card, no push; published once the secrets exist', async () => {
    const g = new FakeYouTube();
    const b = await backend({ youtube: null, fetch: g.fetch, vars: { ENVIRONMENT: 'production', ALLOW_UNLIMITED_WRITES: undefined, HIGHLIGHT_AUTO_APPROVE: '1' } });
    const video = fakeMp4(CHUNK_BYTES + 4096);
    const { a, job } = await rendered(b, video, false);
    await b.drainQueues();
    expect(await row(b, 'SELECT status, last_error, youtube_video_id FROM highlight_jobs')).toEqual({ status: 'awaiting_channel', last_error: 'no_channel_credentials', youtube_video_id: null });
    expect(g.seen).toEqual([]);
    expect(await highlightPosts(a, job)).toEqual([]);
    expect(b.notify.sent.filter((m) => m.kind === 'highlight_published')).toEqual([]);
    expect((await a.call('GET', `/v1/h/${job.attributionCode}`, undefined, { token: null })).status).toBe(404);
    expect((await mine(a))[0].status).toBe('awaiting_channel');
    // The sweeper leaves it alone while there is still no channel…
    await sweep(b);
    await b.drainQueues();
    expect(await status(b, job.jobId)).toBe('awaiting_channel');
    // …and schedules it again once the secrets exist: the real adapter uploads it, resumably, and it is announced once.
    Object.assign(b.env, { YT_CLIENT_ID: 'cid', YT_CLIENT_SECRET: 'secret', YT_REFRESH_TOKEN: 'rt' });
    g.fail('chunk', 'crash');
    await sweep(b);
    await b.drainQueues();
    expect(await status(b, job.jobId)).toBe('uploading');
    await advanceTo(b, b.clock.now() + 2 * 60_000);
    await b.drainQueues();
    expect(await status(b, job.jobId)).toBe('published');
    const videoId = (await row<{ youtube_video_id: string }>(b, 'SELECT youtube_video_id FROM highlight_jobs'))!.youtube_video_id;
    expect(videoId).toMatch(/^yt/);
    expect(g.videos.size).toBe(1);
    // Every byte arrived once, in order (compared as buffers: an element-wise diff of 8 MiB is slow).
    expect(Buffer.compare(g.bytesOf('up1'), video)).toBe(0);
    // The crash cost no second copy of the first chunk: YouTube said where to continue.
    expect(g.seen.filter((x) => x.headers['content-range'] === `bytes 0-${CHUNK_BYTES - 1}/${video.byteLength}`)).toHaveLength(1);
    expect(g.seen.filter((x) => x.method === 'POST' && x.url.startsWith(UPLOAD))).toHaveLength(1);
    expect(await highlightPosts(a, job)).toHaveLength(1);
    expect(b.notify.sent.filter((m) => m.kind === 'highlight_published')).toHaveLength(2);
    b.close();
  });

  it('a withdrawal while the channel is missing simply cancels: nothing was uploaded', async () => {
    const b = await backend({ youtube: null, vars: { ENVIRONMENT: 'production', ALLOW_UNLIMITED_WRITES: undefined, HIGHLIGHT_AUTO_APPROVE: '1' } });
    const { a, job } = await rendered(b, fakeMp4(4096), false);
    await b.drainQueues();
    expect(await status(b, job.jobId)).toBe('awaiting_channel');
    expect((await a.call('POST', `/v1/highlights/${job.jobId}/withdraw`, {})).status).toBe(200);
    expect(await row(b, 'SELECT status, video_key FROM highlight_jobs')).toEqual({ status: 'consent_declined', video_key: null });
    b.close();
  });

  it('development keeps the mock (and its ids never reach the public)', async () => {
    const b = await backend({ youtube: null });
    const { a, job } = await rendered(b);
    await b.drainQueues();
    expect(await status(b, job.jobId)).toBe('published');
    expect((await a.call<{ youtubeVideoId: string | null }>('GET', `/v1/h/${job.attributionCode}`, undefined, { token: null })).body.youtubeVideoId).toBeNull();
    b.close();
  });

  it('a removal that keeps failing: removal_failed, an alert, the dead-letter list, the room card down, retried hourly until gone', async () => {
    const b = await backend();
    const yt = b.youtube as MockYouTube;
    const { a, job } = await rendered(b);
    await b.drainQueues();
    expect(await status(b, job.jobId)).toBe('published');
    expect(await highlightPosts(a, job)).toHaveLength(1);
    const videoId = (await row<{ youtube_video_id: string }>(b, 'SELECT youtube_video_id FROM highlight_jobs'))!.youtube_video_id;
    yt.failNext('transient', 'remove', 20);
    expect((await a.call('POST', `/v1/highlights/${job.jobId}/withdraw`, {})).status).toBe(200);
    for (let i = 0; i < 12 && (await status(b, job.jobId)) !== 'removal_failed'; i++) {
      await b.drainQueues();
      await advanceTo(b, b.clock.now() + 10 * 60_000);
    }
    expect(await row(b, 'SELECT status, last_error FROM highlight_jobs')).toEqual({ status: 'removal_failed', last_error: 'retries_exhausted' });
    expect(b.metrics.total('highlight_removal_failed')).toBe(1);
    expect(yt.videos.get(videoId)?.removed).toBe(false);
    // Visible: to the players, to admins, and no longer promoted anywhere.
    expect((await mine(a))[0].status).toBe('removal_failed');
    expect((await new Admin(b).call<{ jobs: Array<{ jobId: string; status: string }> }>('GET', '/v1/admin/dlq')).body.jobs).toEqual([expect.objectContaining({ jobId: job.jobId, status: 'removal_failed' })]);
    expect(await highlightPosts(a, job)).toEqual([]);
    expect((await a.call('GET', `/v1/h/${job.attributionCode}`, undefined, { token: null })).status).toBe(404);
    // YouTube recovers: the hourly retry removes it.
    (yt as unknown as { failures: unknown[] }).failures.length = 0;
    await advanceTo(b, b.clock.now() + 61 * 60_000);
    await sweep(b);
    await b.drainQueues();
    expect(await status(b, job.jobId)).toBe('removed');
    expect(yt.videos.get(videoId)?.removed).toBe(true);
    expect((await new Admin(b).call<{ jobs: unknown[] }>('GET', '/v1/admin/dlq')).body.jobs).toEqual([]);
    b.close();
  });

  it('a removal in production without the channel secrets also ends as removal_failed, never as removed', async () => {
    const g = new FakeYouTube();
    const b = await backend({ youtube: null, fetch: g.fetch, vars: { ENVIRONMENT: 'production', ALLOW_UNLIMITED_WRITES: undefined, HIGHLIGHT_AUTO_APPROVE: '1', YT_CLIENT_ID: 'cid', YT_CLIENT_SECRET: 'secret', YT_REFRESH_TOKEN: 'rt' } });
    const { a, job } = await rendered(b, fakeMp4(4096), false);
    await b.drainQueues();
    expect(await status(b, job.jobId)).toBe('published');
    // The secrets are gone (rotated badly, say) when the player withdraws.
    Object.assign(b.env, { YT_CLIENT_ID: undefined, YT_CLIENT_SECRET: undefined, YT_REFRESH_TOKEN: undefined });
    __resetYouTubeForTests();
    expect((await a.call('POST', `/v1/highlights/${job.jobId}/withdraw`, {})).status).toBe(200);
    for (let i = 0; i < 12 && (await status(b, job.jobId)) !== 'removal_failed'; i++) {
      await b.drainQueues();
      await advanceTo(b, b.clock.now() + 10 * 60_000);
    }
    expect(await status(b, job.jobId)).toBe('removal_failed');
    expect([...g.videos.values()].every((v) => !v.removed)).toBe(true);
    b.close();
  });
});
