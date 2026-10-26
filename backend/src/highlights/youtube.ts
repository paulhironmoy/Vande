/**
 * The YouTube adapter. `MockYouTube` is the default (deterministic ids, resumable sessions in memory, injectable
 * quota exhaustion and transient, permanent or crash failures). `RealYouTube` is used only when the Worker has the
 * OAuth secrets (YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN): server-side OAuth with a refresh token that never
 * leaves the Worker, resumable uploads (POST for a session, PUT chunks with Content-Range, an empty PUT asking for the
 * received range to find the resume point after a crash), privacy changes, deletion and cheap statistics polling. Upload session URIs are
 * accepted only on the YouTube upload endpoint (no other host is ever sent video bytes).
 */
import { sha256 } from '../security/crypto';
import { toBase32 } from '../security/encoding';

export type YouTubeErrorKind = 'quota' | 'transient' | 'permanent' | 'auth' | 'gone';

export class YouTubeError extends Error {
  constructor(
    readonly kind: YouTubeErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export type Privacy = 'public' | 'unlisted' | 'private';

export interface UploadMeta {
  jobId: string;
  title: string;
  description: string;
  privacy: 'public' | 'unlisted';
  bytes: number;
  categoryId: string;
  language: string;
}

export type UploadState = { state: 'incomplete'; received: number } | { state: 'complete'; videoId: string };

export interface YouTubePublisher {
  readonly kind: 'mock' | 'real';
  startUpload(meta: UploadMeta): Promise<{ sessionUri: string }>;
  /** Where an interrupted upload stands (an empty PUT that asks for the received byte range). */
  queryUpload(sessionUri: string, total: number): Promise<UploadState>;
  uploadChunk(sessionUri: string, chunk: Uint8Array, start: number, total: number): Promise<UploadState>;
  setPrivacy(videoId: string, privacy: Privacy): Promise<void>;
  remove(videoId: string): Promise<void>;
  /** View counts by video id (one quota unit per 50 ids). */
  statistics(videoIds: readonly string[]): Promise<Map<string, number>>;
}

export const UPLOAD_SESSION_PREFIX = 'https://www.googleapis.com/upload/youtube/v3/videos?';

export function isYouTubeSessionUri(uri: string): boolean {
  if (!uri.startsWith(UPLOAD_SESSION_PREFIX)) return false;
  try {
    const u = new URL(uri);
    return u.origin === 'https://www.googleapis.com' && u.pathname === '/upload/youtube/v3/videos' && !!u.searchParams.get('upload_id');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Mock
// ---------------------------------------------------------------------------------------------------------------

type MockOp = 'start' | 'query' | 'chunk' | 'privacy' | 'remove' | 'stats';

export class MockYouTube implements YouTubePublisher {
  readonly kind = 'mock' as const;
  /** Every API call, in order ("start:<job>", "chunk:<job>:<start>", …). */
  readonly calls: string[] = [];
  /** Completed uploads per job: never more than one. */
  readonly inserts = new Map<string, number>();
  readonly videos = new Map<string, { jobId: string; privacy: Privacy; removed: boolean; views: number; bytes: number }>();
  private readonly sessions = new Map<string, { jobId: string; total: number; received: number; videoId: string | null; privacy: Privacy }>();
  private failures: Array<{ op: MockOp | null; kind: YouTubeErrorKind | 'crash' }> = [];
  private seq = 0;
  quotaExhausted = false;

  /** The next matching call fails. 'crash' applies a chunk and then fails, like a Worker dying after the bytes left. */
  failNext(kind: YouTubeErrorKind | 'crash', op: MockOp | null = null, times = 1): this {
    for (let i = 0; i < times; i++) this.failures.push({ op, kind });
    return this;
  }

  private take(op: MockOp): YouTubeErrorKind | 'crash' | null {
    const i = this.failures.findIndex((f) => f.op === null || f.op === op);
    if (i < 0) return null;
    return this.failures.splice(i, 1)[0].kind;
  }

  private fail(op: MockOp): void {
    const k = this.take(op);
    if (k) throw new YouTubeError(k === 'crash' ? 'transient' : k, `mock ${op} failed (${k})`);
  }

  private static async idFor(jobId: string): Promise<string> {
    return `mock-${toBase32(await sha256(`yt|${jobId}`)).slice(0, 11)}`;
  }

  async startUpload(meta: UploadMeta): Promise<{ sessionUri: string }> {
    this.calls.push(`start:${meta.jobId}`);
    this.fail('start');
    if (this.quotaExhausted) throw new YouTubeError('quota', 'quotaExceeded', 403);
    const sessionUri = `https://mock.youtube.invalid/upload?upload_id=${meta.jobId}-${++this.seq}`;
    this.sessions.set(sessionUri, { jobId: meta.jobId, total: meta.bytes, received: 0, videoId: null, privacy: meta.privacy });
    return { sessionUri };
  }

  async queryUpload(sessionUri: string, total: number): Promise<UploadState> {
    this.calls.push(`query:${this.sessions.get(sessionUri)?.jobId ?? '?'}`);
    this.fail('query');
    const s = this.sessions.get(sessionUri);
    if (!s || s.total !== total) throw new YouTubeError('gone', 'upload session not found', 404);
    return s.videoId ? { state: 'complete', videoId: s.videoId } : { state: 'incomplete', received: s.received };
  }

  async uploadChunk(sessionUri: string, chunk: Uint8Array, start: number, total: number): Promise<UploadState> {
    const s = this.sessions.get(sessionUri);
    this.calls.push(`chunk:${s?.jobId ?? '?'}:${start}`);
    const failure = this.take('chunk');
    if (failure && failure !== 'crash') throw new YouTubeError(failure, `mock chunk failed (${failure})`);
    if (!s || s.total !== total) throw new YouTubeError('gone', 'upload session not found', 404);
    if (s.videoId) return { state: 'complete', videoId: s.videoId };
    if (start !== s.received) throw new YouTubeError('permanent', `chunk at ${start}, expected ${s.received}`, 400);
    s.received += chunk.byteLength;
    if (s.received >= s.total) {
      s.videoId = await MockYouTube.idFor(s.jobId);
      this.inserts.set(s.jobId, (this.inserts.get(s.jobId) ?? 0) + 1);
      this.videos.set(s.videoId, { jobId: s.jobId, privacy: s.privacy, removed: false, views: 0, bytes: s.total });
    }
    if (failure === 'crash') throw new YouTubeError('transient', 'connection lost after the chunk was sent');
    return s.videoId ? { state: 'complete', videoId: s.videoId } : { state: 'incomplete', received: s.received };
  }

  async setPrivacy(videoId: string, privacy: Privacy): Promise<void> {
    this.calls.push(`privacy:${videoId}:${privacy}`);
    this.fail('privacy');
    const v = this.videos.get(videoId);
    if (!v || v.removed) throw new YouTubeError('gone', 'video not found', 404);
    v.privacy = privacy;
  }

  async remove(videoId: string): Promise<void> {
    this.calls.push(`remove:${videoId}`);
    this.fail('remove');
    const v = this.videos.get(videoId);
    if (v) v.removed = true;
  }

  async statistics(videoIds: readonly string[]): Promise<Map<string, number>> {
    this.calls.push(`stats:${videoIds.length}`);
    this.fail('stats');
    const out = new Map<string, number>();
    for (const id of videoIds) {
      const v = this.videos.get(id);
      if (v && !v.removed) out.set(id, v.views);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Real
// ---------------------------------------------------------------------------------------------------------------

export interface RealYouTubeOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetch(input: string, init?: RequestInit): Promise<Response>;
  now(): number;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const START_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';

async function errorKind(res: Response): Promise<YouTubeError> {
  let reason = '';
  try {
    const body = (await res.json()) as { error?: { errors?: Array<{ reason?: string }>; status?: string } };
    reason = body.error?.errors?.[0]?.reason ?? body.error?.status ?? '';
  } catch {
    /* no body */
  }
  const s = res.status;
  if (s === 401) return new YouTubeError('auth', 'unauthorized', s);
  if (s === 403 && /quotaExceeded|dailyLimitExceeded/.test(reason)) return new YouTubeError('quota', reason, s);
  if (s === 403 && /rateLimitExceeded|userRateLimitExceeded/.test(reason)) return new YouTubeError('transient', reason, s);
  if (s === 404 || s === 410) return new YouTubeError('gone', reason || 'not found', s);
  if (s === 429 || s >= 500) return new YouTubeError('transient', reason || `status ${s}`, s);
  return new YouTubeError('permanent', reason || `status ${s}`, s);
}

export class RealYouTube implements YouTubePublisher {
  readonly kind = 'real' as const;
  private token: { value: string; expMs: number } | null = null;

  constructor(private readonly o: RealYouTubeOptions) {}

  private async accessToken(force = false): Promise<string> {
    if (!force && this.token && this.token.expMs > this.o.now() + 60_000) return this.token.value;
    const body = new URLSearchParams({ client_id: this.o.clientId, client_secret: this.o.clientSecret, refresh_token: this.o.refreshToken, grant_type: 'refresh_token' });
    let res: Response;
    try {
      res = await this.o.fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    } catch {
      throw new YouTubeError('transient', 'token endpoint unreachable');
    }
    if (!res.ok) throw res.status >= 500 ? new YouTubeError('transient', `token ${res.status}`, res.status) : new YouTubeError('auth', `token ${res.status}`, res.status);
    const t = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!t.access_token) throw new YouTubeError('auth', 'no access token');
    this.token = { value: t.access_token, expMs: this.o.now() + Math.max(60, Math.min(3600, t.expires_in ?? 3600)) * 1000 };
    return t.access_token;
  }

  /** One authorised request; a 401 refreshes the token once. Network failures are transient. */
  private async call(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.accessToken(attempt > 0);
      let res: Response;
      try {
        res = await this.o.fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` } });
      } catch {
        throw new YouTubeError('transient', 'YouTube unreachable');
      }
      if (res.status !== 401 || attempt > 0) return res;
    }
    throw new YouTubeError('auth', 'unauthorized');
  }

  private static async state(res: Response, total: number): Promise<UploadState> {
    if (res.status === 200 || res.status === 201) {
      const v = (await res.json()) as { id?: string };
      if (!v.id) throw new YouTubeError('permanent', 'upload finished without a video id', res.status);
      return { state: 'complete', videoId: v.id };
    }
    if (res.status === 308) {
      const range = /bytes=0-(\d+)/.exec(res.headers.get('range') ?? '');
      const received = range ? Number(range[1]) + 1 : 0;
      return { state: 'incomplete', received: Math.min(received, total) };
    }
    throw await errorKind(res);
  }

  async startUpload(meta: UploadMeta): Promise<{ sessionUri: string }> {
    const res = await this.call(START_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': 'video/mp4', 'x-upload-content-length': String(meta.bytes) },
      body: JSON.stringify({
        snippet: { title: meta.title, description: meta.description, categoryId: meta.categoryId, defaultLanguage: meta.language, tags: ['cricket', 'VANDE Cricket', 'Shorts'] },
        status: { privacyStatus: meta.privacy, selfDeclaredMadeForKids: false, embeddable: true, license: 'youtube' },
      }),
    });
    if (!res.ok) throw await errorKind(res);
    const uri = res.headers.get('location') ?? '';
    if (!isYouTubeSessionUri(uri)) throw new YouTubeError('permanent', 'unexpected upload session location');
    return { sessionUri: uri };
  }

  async queryUpload(sessionUri: string, total: number): Promise<UploadState> {
    if (!isYouTubeSessionUri(sessionUri)) throw new YouTubeError('gone', 'not a YouTube upload session');
    const res = await this.call(sessionUri, { method: 'PUT', headers: { 'content-range': `bytes */${total}`, 'content-length': '0' } });
    return RealYouTube.state(res, total);
  }

  async uploadChunk(sessionUri: string, chunk: Uint8Array, start: number, total: number): Promise<UploadState> {
    if (!isYouTubeSessionUri(sessionUri)) throw new YouTubeError('gone', 'not a YouTube upload session');
    const end = start + chunk.byteLength - 1;
    const res = await this.call(sessionUri, { method: 'PUT', headers: { 'content-range': `bytes ${start}-${end}/${total}`, 'content-type': 'video/mp4' }, body: chunk as Uint8Array<ArrayBuffer> });
    return RealYouTube.state(res, total);
  }

  async setPrivacy(videoId: string, privacy: Privacy): Promise<void> {
    const res = await this.call(`${VIDEOS_URL}?part=status`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: videoId, status: { privacyStatus: privacy } }) });
    if (!res.ok) throw await errorKind(res);
  }

  async remove(videoId: string): Promise<void> {
    const res = await this.call(`${VIDEOS_URL}?id=${encodeURIComponent(videoId)}`, { method: 'DELETE' });
    if (res.ok || res.status === 404) return;
    throw await errorKind(res);
  }

  async statistics(videoIds: readonly string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (let i = 0; i < videoIds.length; i += 50) {
      const ids = videoIds.slice(i, i + 50).map(encodeURIComponent).join(',');
      const res = await this.call(`${VIDEOS_URL}?part=statistics&id=${ids}`, { method: 'GET' });
      if (!res.ok) throw await errorKind(res);
      const body = (await res.json()) as { items?: Array<{ id: string; statistics?: { viewCount?: string } }> };
      for (const item of body.items ?? []) out.set(item.id, Number(item.statistics?.viewCount ?? 0));
    }
    return out;
  }
}
