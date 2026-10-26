/**
 * The trusted renderer's API (render-service/, a Cloud Run job). It needs no network beyond this Worker: it claims a
 * job (lease 20 min), renders HighlightRenderInput frame by frame, streams the MP4 back (stored as a temporary R2
 * object, its SHA-256 checked by R2 itself) and completes or fails the job. Every request is signed:
 *
 *   x-vc-key: <kid>   x-vc-ts: <unix ms>   x-vc-nonce: <16–64 of [A-Za-z0-9-]>   x-vc-body-sha256: <hex>
 *   x-vc-sig: base64url(HMAC-SHA256(K, "METHOD\npath\nts\nnonce\nbody-sha256"))
 *
 * K is HKDF-SHA256(RENDER_KEYS entry, salt "vande-cricket/v1", info "hmac|render"). Requests more than 5 minutes off
 * the Worker's clock, with an unknown key, a reused nonce, a body that does not match its hash or a bad signature are
 * refused (401); the routes are unreachable without RENDER_KEYS (503). render-service/src/signing.ts is the client.
 */
import type { HighlightRenderInput } from '@/contracts';
import { MINUTE_MS } from '../config';
import type { RequestContext } from '../http/context';
import { fail } from '../http/errors';
import type { Reply } from '../http/router';
import { warnOnce } from '../http/log';
import { hmac, hmacKeyFor, sha256Hex, timingSafeEqual } from '../security/crypto';
import { fromBase64Url, type Bytes } from '../security/encoding';
import { parseKeyring } from '../security/keyring';
import { renderInputFor } from './jobs';
import { JOB_ID_RE, videoKeyFor, type JobRow } from './model';
import { getJob, scheduleUpload } from './pipeline';
import { HSQL } from './sql';

export const RENDER_LEASE_MS = 20 * MINUTE_MS;
export const RENDER_MAX_ATTEMPTS = 3;
export const MAX_VIDEO_BYTES = 95 * 1024 * 1024;
const CLOCK_WINDOW_MS = 5 * MINUTE_MS;
const NONCE_RE = /^[A-Za-z0-9-]{16,64}$/;

export function renderCanonical(method: string, path: string, ts: string, nonce: string, bodySha256: string): string {
  return `${method.toUpperCase()}\n${path}\n${ts}\n${nonce}\n${bodySha256}`;
}

/** Verifies a signed render-service request. `bodyHash` is the hash of the JSON body (null: the header is used). */
export async function verifyInternal(ctx: RequestContext, bodyHash: string | null): Promise<void> {
  const ring = parseKeyring(ctx.env.RENDER_KEYS);
  if (!ring) {
    warnOnce(ctx.deps.logger, 'RENDER_KEYS', 'RENDER_KEYS is missing or malformed; the render API is disabled');
    fail('unavailable', 'service not configured');
  }
  const h = ctx.request.headers;
  const kid = h.get('x-vc-key') ?? '';
  const ts = h.get('x-vc-ts') ?? '';
  const nonce = h.get('x-vc-nonce') ?? '';
  const declared = (h.get('x-vc-body-sha256') ?? '').toLowerCase();
  const sig = fromBase64Url(h.get('x-vc-sig') ?? '');
  const material = ring.all.get(kid);
  const tsMs = Number(ts);
  const deny = () => fail('unauthorized', 'request signature is not valid');
  if (!material || !sig || !/^\d{13}$/.test(ts) || !NONCE_RE.test(nonce) || !/^[0-9a-f]{64}$/.test(declared)) deny();
  if (Math.abs(ctx.now - tsMs) > CLOCK_WINDOW_MS) deny();
  if (bodyHash !== null && bodyHash !== declared) deny();
  const key = await hmacKeyFor(material as Bytes, kid, 'render');
  const expected = await hmac(key, renderCanonical(ctx.request.method, ctx.url.pathname, ts, nonce, declared));
  if (!timingSafeEqual(expected, sig as Uint8Array)) deny();
  // A nonce is good for one request (replays inside the clock window are refused).
  const used = await ctx.env.DB.prepare(HSQL.useNonce).bind(`render:${nonce}`, ctx.now).run();
  if ((used.meta?.changes ?? 0) === 0) deny();
}

async function jobForRender(ctx: RequestContext): Promise<JobRow> {
  const jobId = ctx.params.jobId;
  const row = JOB_ID_RE.test(jobId) ? await getJob(ctx.env, jobId) : null;
  if (!row) fail('not_found', 'job not found');
  return row;
}

export async function claimRender(ctx: RequestContext): Promise<Reply> {
  await verifyInternal(ctx, await sha256Hex(ctx.rawBody));
  for (let i = 0; i < 3; i++) {
    const claimed = await ctx.env.DB.prepare(HSQL.claimRender).bind(ctx.now, ctx.now + RENDER_LEASE_MS).first<{ job_id: string }>();
    if (!claimed) return new Response(null, { status: 204 });
    const row = await getJob(ctx.env, claimed.job_id);
    if (!row) continue;
    const input: HighlightRenderInput | null = await renderInputFor(ctx.env, ctx.cfg, row);
    if (!input) {
      await ctx.env.DB.prepare(HSQL.renderFailed).bind(row.job_id, 'dead_letter', 'replay_missing', null, ctx.now).run();
      continue;
    }
    ctx.deps.metrics.count('render_claimed');
    return { status: 200, body: { jobId: row.job_id, attempt: row.attempts, leaseUntil: new Date(ctx.now + RENDER_LEASE_MS).toISOString(), input, upload: { path: `/v1/internal/render/jobs/${row.job_id}/video`, maxBytes: MAX_VIDEO_BYTES } } };
  }
  return new Response(null, { status: 204 });
}

/** Streams the MP4 into R2 (never buffered here); R2 refuses it unless its SHA-256 is the signed one. */
export async function putRenderedVideo(ctx: RequestContext): Promise<Reply> {
  await verifyInternal(ctx, null);
  const row = await jobForRender(ctx);
  if (row.status !== 'rendering' || (row.lease_ms ?? 0) < ctx.now) fail('conflict', 'this job is not being rendered (lease lost)');
  const length = Number(ctx.request.headers.get('content-length') ?? 'NaN');
  if (!Number.isInteger(length) || length <= 0) fail('invalid', 'content-length is required', { status: 411 });
  if (length > MAX_VIDEO_BYTES) fail('invalid', 'video too large', { status: 413 });
  if (!/^video\/mp4\b/i.test(ctx.request.headers.get('content-type') ?? '')) fail('invalid', 'content-type must be video/mp4', { status: 415 });
  if (!ctx.env.FILES || !ctx.request.body) fail('unavailable', 'storage not configured');
  const sha = (ctx.request.headers.get('x-vc-body-sha256') ?? '').toLowerCase();
  try {
    await ctx.env.FILES.put(videoKeyFor(row.job_id), ctx.request.body, { httpMetadata: { contentType: 'video/mp4' }, customMetadata: { sha256: sha, job: row.job_id }, sha256: sha });
  } catch {
    fail('invalid', 'the video does not match its signed hash');
  }
  return { status: 200, body: { stored: true } };
}

export async function completeRender(ctx: RequestContext): Promise<Reply> {
  await verifyInternal(ctx, await sha256Hex(ctx.rawBody));
  const row = await jobForRender(ctx);
  const b = (ctx.body ?? {}) as { sha256?: unknown; bytes?: unknown; durationMs?: unknown; frames?: unknown };
  if (typeof b.sha256 !== 'string' || typeof b.bytes !== 'number' || typeof b.durationMs !== 'number') fail('invalid', 'sha256, bytes and durationMs are required');
  if (b.durationMs < 30_000 || b.durationMs > 60_000) fail('invalid', 'a highlight is 30–60 s');
  if (row.status !== 'rendering') {
    // Withdrawn or cancelled while rendering: drop the upload.
    await ctx.env.FILES?.delete(videoKeyFor(row.job_id)).catch(() => undefined);
    fail('conflict', 'this job is no longer being rendered');
  }
  const head = await ctx.env.FILES?.head(videoKeyFor(row.job_id));
  if (!head || head.size !== b.bytes || head.customMetadata?.sha256 !== b.sha256.toLowerCase()) fail('invalid', 'the stored video does not match');
  const auto = ctx.env.HIGHLIGHT_AUTO_APPROVE === '1';
  const next = auto ? 'approved' : 'pending_moderation';
  const r = await ctx.env.DB.prepare(HSQL.renderStored).bind(row.job_id, videoKeyFor(row.job_id), b.sha256.toLowerCase(), b.bytes, Math.round(b.durationMs), next, ctx.now).run();
  if ((r.meta?.changes ?? 0) === 0) fail('conflict', 'this job is no longer being rendered');
  ctx.deps.metrics.count('highlight_status', [next]);
  row.status = next;
  if (auto) {
    await ctx.env.DB.prepare(HSQL.insertModeration).bind(row.job_id, 'pass', 'pass', 'pass', 'auto', null, 'approve', 'HIGHLIGHT_AUTO_APPROVE=1', ctx.now).run();
    await scheduleUpload(ctx.env, ctx.deps, row);
  }
  return { status: 200, body: { status: row.status } };
}

export async function failRender(ctx: RequestContext): Promise<Reply> {
  await verifyInternal(ctx, await sha256Hex(ctx.rawBody));
  const row = await jobForRender(ctx);
  const b = (ctx.body ?? {}) as { error?: unknown; retryable?: unknown };
  const error = typeof b.error === 'string' ? b.error.replace(/[^\w .:-]/g, '').slice(0, 120) : 'render_failed';
  const status = await renderAttemptFailed(ctx, row, error, b.retryable !== false);
  return { status: 200, body: { status } };
}

/** Retries with backoff (5, 10, 20 min) up to RENDER_MAX_ATTEMPTS, then dead_letter (an admin can retry). */
export async function renderAttemptFailed(ctx: Pick<RequestContext, 'env' | 'deps' | 'now'>, row: JobRow, error: string, retryable: boolean): Promise<string> {
  const last = !retryable || row.attempts >= RENDER_MAX_ATTEMPTS;
  const status = last ? 'dead_letter' : 'render_failed';
  const retryAt = last ? null : ctx.now + 5 * MINUTE_MS * 2 ** Math.max(0, row.attempts - 1);
  const r = await ctx.env.DB.prepare(HSQL.renderFailed).bind(row.job_id, status, error, retryAt, ctx.now).run();
  if ((r.meta?.changes ?? 0) > 0) ctx.deps.metrics.count('highlight_status', [status]);
  return status;
}

