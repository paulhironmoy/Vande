/**
 * The render service trusts nothing in the Worker's answers that could send a request elsewhere or name a file
 * (security review, finding 9): job ids must have the Worker's format, the upload path must be exactly this job's
 * video path, and no URL may leave the Worker's origin.
 */
import { describe, expect, it } from 'vitest';
import { parseRenderKey, toBase64Url } from '../src/signing.ts';
import { JOB_ID_RE, WorkerClient, uploadPathFor, validClaim, type Claim } from '../src/workerClient.ts';

const KEY = `r1:${toBase64Url(new Uint8Array(32).map((_, i) => i + 7))}`;
const JOB = `j${'a'.repeat(26)}`;

function claim(over: Partial<Claim> & { input?: unknown } = {}): Claim {
  return { jobId: JOB, attempt: 1, leaseUntil: '2026-10-26T10:00:00.000Z', input: { jobId: JOB } as Claim['input'], upload: { path: uploadPathFor(JOB), maxBytes: 1024 }, ...over } as Claim;
}

function client(answer: () => Response = () => new Response(null, { status: 200 })) {
  const seen: string[] = [];
  const fake = (async (url: URL | string) => {
    seen.push(String(url));
    return answer();
  }) as unknown as typeof fetch;
  return { c: new WorkerClient(new URL('https://api.example'), parseRenderKey(KEY), fake), seen };
}

describe('render claims', () => {
  it('accepts exactly what the Worker issues', () => {
    expect(validClaim(claim()).jobId).toBe(JOB);
    expect(JOB_ID_RE.test(JOB)).toBe(true);
  });

  it('refuses a bad job id, an input of another job, or any other upload path', () => {
    for (const bad of [
      claim({ jobId: '../../etc/passwd' }),
      claim({ jobId: `j${'a'.repeat(25)}/` }),
      claim({ input: { jobId: `j${'b'.repeat(26)}` } as Claim['input'] }),
      claim({ upload: { path: 'https://evil.example/upload', maxBytes: 1024 } }),
      claim({ upload: { path: '//evil.example/v1/internal/render/jobs/x/video', maxBytes: 1024 } }),
      claim({ upload: { path: `/v1/internal/render/jobs/${JOB}/../../admin/jobs`, maxBytes: 1024 } }),
      claim({ upload: { path: uploadPathFor(JOB), maxBytes: Number.NaN } }),
    ]) {
      expect(() => validClaim(bad)).toThrow();
    }
  });

  it('a claim answer that fails validation is refused before anything uses it', async () => {
    const { c } = client(() => new Response(JSON.stringify(claim({ upload: { path: 'https://evil.example/x', maxBytes: 1 } })), { status: 200 }));
    await expect(c.claim()).rejects.toThrow(/upload path/);
  });

  it('never sends a request off the Worker origin, whatever the upload path says', async () => {
    const { c, seen } = client();
    await expect(c.upload(claim({ upload: { path: 'https://evil.example/upload', maxBytes: 1024 } }), new Uint8Array(4))).rejects.toThrow();
    await expect(c.complete('../x', { sha256: 'x', bytes: 1, durationMs: 40_000, frames: 1 })).rejects.toThrow(/job id/);
    await expect(c.fail(`${JOB}/../../x`, 'boom', true)).rejects.toThrow(/job id/);
    expect(seen).toEqual([]);
    await c.upload(claim(), new Uint8Array(4));
    expect(seen).toEqual([`https://api.example${uploadPathFor(JOB)}`]);
  });
});
