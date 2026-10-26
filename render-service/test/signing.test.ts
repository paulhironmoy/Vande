import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/config.ts';
import { canonical, fromBase64Url, parseRenderKey, sha256Hex, signRequest, toBase64Url } from '../src/signing.ts';
import { safePath } from '../src/staticServer.ts';
import { WorkerClient } from '../src/workerClient.ts';

const KEY = `r1:${toBase64Url(new Uint8Array(32).map((_, i) => i + 1))}`;

/** An independent verifier: HKDF-SHA256 then HMAC-SHA256, as the Worker does it. */
async function verify(material: Uint8Array, headers: Record<string, string>, method: string, path: string): Promise<boolean> {
  const enc = new TextEncoder();
  const ikm = await crypto.subtle.importKey('raw', material as Uint8Array<ArrayBuffer>, 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('vande-cricket/v1'), info: enc.encode('hmac|render') }, ikm, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['verify']);
  const data = enc.encode(canonical(method, path, headers['x-vc-ts'], headers['x-vc-nonce'], headers['x-vc-body-sha256']));
  return crypto.subtle.verify('HMAC', key, fromBase64Url(headers['x-vc-sig']) as Uint8Array<ArrayBuffer>, data);
}

describe('callback signing', () => {
  it('signs method, path, time, nonce and body hash with the HKDF-derived key', async () => {
    const key = parseRenderKey(KEY);
    const body = '{"sha256":"x"}';
    const h = await signRequest(key, 'post', '/v1/internal/render/jobs/jx/complete', await sha256Hex(body), 1_793_000_000_000, '0123456789abcdef-nonce');
    expect(h).toMatchObject({ 'x-vc-key': 'r1', 'x-vc-ts': '1793000000000', 'x-vc-nonce': '0123456789abcdef-nonce', 'x-vc-body-sha256': await sha256Hex(body) });
    expect(await verify(key.material, h, 'POST', '/v1/internal/render/jobs/jx/complete')).toBe(true);
    // Any change breaks it.
    expect(await verify(key.material, h, 'POST', '/v1/internal/render/jobs/jy/complete')).toBe(false);
    expect(await verify(key.material, { ...h, 'x-vc-ts': '1793000000001' }, 'POST', '/v1/internal/render/jobs/jx/complete')).toBe(false);
    expect(await verify(new Uint8Array(32), h, 'POST', '/v1/internal/render/jobs/jx/complete')).toBe(false);
    // Fresh nonces by default.
    const a = await signRequest(key, 'POST', '/p', 'e'.repeat(64));
    const b = await signRequest(key, 'POST', '/p', 'e'.repeat(64));
    expect(a['x-vc-nonce']).not.toBe(b['x-vc-nonce']);
  });

  it('refuses malformed keys and non-https or non-origin Worker URLs', () => {
    expect(() => parseRenderKey(undefined)).toThrow();
    expect(() => parseRenderKey('r1:short')).toThrow();
    expect(() => readConfig({ WORKER_URL: 'http://api.example', RENDER_KEY: KEY })).toThrow(/https/);
    expect(() => readConfig({ WORKER_URL: 'https://api.example/v1', RENDER_KEY: KEY })).toThrow(/origin/);
    expect(readConfig({ WORKER_URL: 'https://api.example', RENDER_KEY: KEY }).workerUrl.origin).toBe('https://api.example');
    expect(readConfig({ WORKER_URL: 'http://127.0.0.1:8787', RENDER_KEY: KEY }).capture).toBe('jpeg');
  });

  it('the client calls only the render API, never follows redirects, and signs the exact bytes it sends', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fake = (async (url: URL | string, init: RequestInit) => {
      seen.push({ url: String(url), init });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const client = new WorkerClient(new URL('https://api.example'), parseRenderKey(KEY), fake);
    expect(await client.claim()).toBeNull();
    expect(seen[0].url).toBe('https://api.example/v1/internal/render/claim');
    expect(seen[0].init.redirect).toBe('error');
    const headers = seen[0].init.headers as Record<string, string>;
    expect(headers['x-vc-body-sha256']).toBe(await sha256Hex('{}'));
    expect(await verify(parseRenderKey(KEY).material, headers, 'POST', '/v1/internal/render/claim')).toBe(true);
  });

  it('serves only files inside the page directory', () => {
    expect(safePath('/app/dist', '/render.html')).toBe('/app/dist/render.html');
    expect(safePath('/app/dist', '/assets/render-1.js?v=2')).toBe('/app/dist/assets/render-1.js');
    expect(safePath('/app/dist', '/../etc/passwd')).toBe('/app/dist/etc/passwd');
    expect(safePath('/app/dist', '/%2e%2e/%2e%2e/etc/passwd')).toBe('/app/dist/etc/passwd');
    expect(safePath('/app/dist', '/a%00b')).toBeNull();
    expect(safePath('/app/dist', '/%E0%A4%A')).toBeNull();
  });
});
