/**
 * The Worker's render API, with every request signed (signing.ts) and redirects refused. Nothing the Worker answers
 * can send a request elsewhere or name a file: job ids must have the Worker's format, the upload path must be exactly
 * this job's video path, and every URL must stay on the Worker's origin.
 */
import type { HighlightRenderInput } from '../../src/contracts/highlights.ts';
import { sha256Hex, signRequest, type RenderKey } from './signing.ts';

/** A highlight job id as the Worker issues it (backend/src/highlights/model.ts JOB_ID_RE). */
export const JOB_ID_RE = /^j[a-z2-7]{26}$/;

export function uploadPathFor(jobId: string): string {
  return `/v1/internal/render/jobs/${jobId}/video`;
}

/** Checks a claim before anything uses it; throws on any field that is not what the Worker issues. */
export function validClaim(body: unknown): Claim {
  const c = body as Partial<Claim> | null;
  if (!c || typeof c !== 'object') throw new Error('claim: not an object');
  if (typeof c.jobId !== 'string' || !JOB_ID_RE.test(c.jobId)) throw new Error('claim: bad job id');
  if (!c.input || typeof c.input !== 'object' || c.input.jobId !== c.jobId) throw new Error('claim: the input belongs to another job');
  if (!c.upload || c.upload.path !== uploadPathFor(c.jobId)) throw new Error('claim: unexpected upload path');
  if (typeof c.upload.maxBytes !== 'number' || !Number.isFinite(c.upload.maxBytes) || c.upload.maxBytes <= 0) throw new Error('claim: bad upload size');
  return c as Claim;
}

export interface Claim {
  jobId: string;
  attempt: number;
  leaseUntil: string;
  input: HighlightRenderInput;
  upload: { path: string; maxBytes: number };
}

export class WorkerClient {
  private readonly base: URL;
  private readonly key: RenderKey;
  private readonly fetchImpl: typeof fetch;

  constructor(base: URL, key: RenderKey, fetchImpl: typeof fetch = fetch) {
    this.base = base;
    this.key = key;
    this.fetchImpl = fetchImpl;
  }

  /** The Worker URL of a render API path, or an error: a relative path on the Worker's origin, nothing else. */
  private urlFor(path: string): URL {
    if (!path.startsWith('/v1/internal/render/') || path.includes('..') || path.includes('//') || /[?#\\]/.test(path)) throw new Error(`refusing to call ${path}`);
    const url = new URL(path, this.base);
    if (url.origin !== this.base.origin || url.pathname !== path) throw new Error(`refusing to call ${path}`);
    return url;
  }

  private async send(method: string, path: string, body: Uint8Array, headers: Record<string, string>): Promise<Response> {
    const url = this.urlFor(path);
    const signed = await signRequest(this.key, method, path, await sha256Hex(body));
    return this.fetchImpl(url, { method, headers: { ...headers, ...signed }, body: body.byteLength ? (body as Uint8Array<ArrayBuffer>) : undefined, redirect: 'error' });
  }

  private async json<T>(path: string, value: unknown): Promise<{ status: number; body: T | null }> {
    const res = await this.send('POST', path, new TextEncoder().encode(JSON.stringify(value)), { 'content-type': 'application/json' });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as T) : null };
  }

  /** The next job to render, or null when there is none. */
  async claim(): Promise<Claim | null> {
    const r = await this.json<Claim>('/v1/internal/render/claim', {});
    if (r.status === 204) return null;
    if (r.status !== 200 || !r.body) throw new Error(`claim failed: ${r.status}`);
    return validClaim(r.body);
  }

  async upload(claim: Claim, video: Uint8Array): Promise<string> {
    if (!JOB_ID_RE.test(claim.jobId) || claim.upload.path !== uploadPathFor(claim.jobId)) throw new Error('refusing an unexpected upload path');
    if (video.byteLength > claim.upload.maxBytes) throw new Error('video larger than the Worker accepts');
    const url = this.urlFor(claim.upload.path);
    const sha = await sha256Hex(video);
    const signed = await signRequest(this.key, 'PUT', claim.upload.path, sha);
    const res = await this.fetchImpl(url, {
      method: 'PUT',
      headers: { 'content-type': 'video/mp4', 'content-length': String(video.byteLength), ...signed },
      body: video as Uint8Array<ArrayBuffer>,
      redirect: 'error',
    });
    if (res.status !== 200) throw new Error(`upload failed: ${res.status}`);
    return sha;
  }

  async complete(jobId: string, done: { sha256: string; bytes: number; durationMs: number; frames: number }): Promise<void> {
    if (!JOB_ID_RE.test(jobId)) throw new Error('bad job id');
    const r = await this.json(`/v1/internal/render/jobs/${jobId}/complete`, done);
    if (r.status !== 200) throw new Error(`complete failed: ${r.status}`);
  }

  async fail(jobId: string, error: string, retryable: boolean): Promise<void> {
    if (!JOB_ID_RE.test(jobId)) throw new Error('bad job id');
    await this.json(`/v1/internal/render/jobs/${jobId}/fail`, { error: error.slice(0, 120), retryable });
  }
}
