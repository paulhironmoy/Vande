// @vitest-environment node
/**
 * The admin console API: never reachable without authentication (Cloudflare Access JWT verified by the Worker, or the
 * local ADMIN_TOKEN outside production), every action audited, and the MP4 preview behind short-lived signed links.
 */
import { describe, expect, it } from 'vitest';
import type { AdminJob, AdminJobDetail } from '@/admin/types';
import { buildRouter } from '../src/app';
import { toBase64Url, utf8 } from '../src/security/encoding';
import { Admin, RenderClient, consent, freeze, mine, playDuel, players, row } from './highlightHelpers';
import { API, Player, backend } from './helpers';

const TEAM = 'vande.cloudflareaccess.com';
const AUD = 'a'.repeat(64);

async function accessKeys() {
  const pair = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  const fetch = async (url: string) => {
    if (url !== `https://${TEAM}/cdn-cgi/access/certs`) throw new Error(`unexpected fetch ${url}`);
    return new Response(JSON.stringify({ keys: [{ kid: 'k1', kty: 'RSA', alg: 'RS256', n: jwk.n, e: jwk.e }] }), { headers: { 'cache-control': 'max-age=3600' } });
  };
  const sign = async (claims: Record<string, unknown>, kid = 'k1', key = pair.privateKey) => {
    const head = toBase64Url(utf8(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })));
    const body = toBase64Url(utf8(JSON.stringify(claims)));
    const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8(`${head}.${body}`)));
    return `${head}.${body}.${toBase64Url(sig)}`;
  };
  return { fetch, sign };
}

describe('admin authentication', () => {
  it('every admin route answers 401 without authentication, with a wrong token, or with the dev token in production', async () => {
    const admin = buildRouter().keys().filter((k) => k.includes('/v1/admin/') && !k.includes('/media/'));
    expect(admin.length).toBeGreaterThanOrEqual(13);
    const b = await backend();
    const nobody = new Player(b);
    for (const key of admin) {
      const [method, path] = key.split(' ');
      const url = path.replace(':jobId', `j${'a'.repeat(26)}`);
      expect((await nobody.call(method, url, method === 'POST' ? {} : undefined, { token: null, idem: false })).status, key).toBe(401);
      expect((await nobody.call(method, url, method === 'POST' ? {} : undefined, { token: null, idem: false, headers: { authorization: 'Bearer wrong-token-wrong-token-wrong-token' } })).status, key).toBe(401);
      expect((await nobody.call(method, url, method === 'POST' ? {} : undefined, { token: null, idem: false, headers: { 'cf-access-jwt-assertion': 'not.a.jwt' } })).status, key).toBe(401);
    }
    // A player's own session is no admin session.
    await nobody.signup();
    expect((await nobody.call('GET', '/v1/admin/jobs')).status).toBe(401);
    expect((await new Admin(b).call('GET', '/v1/admin/whoami')).body).toEqual({ id: 'dev-token', via: 'token' });
    b.close();
    const prod = await backend({ vars: { ENVIRONMENT: 'production', ALLOW_UNLIMITED_WRITES: undefined } });
    expect((await new Admin(prod).call('GET', '/v1/admin/whoami')).status).toBe(401);
    prod.close();
  });

  it('accepts a Cloudflare Access JWT only with the right signature, issuer, audience and expiry', async () => {
    const keys = await accessKeys();
    const b = await backend({ fetch: keys.fetch, vars: { ENVIRONMENT: 'production', CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD } });
    const now = Math.floor(b.clock.now() / 1000);
    const ok = { iss: `https://${TEAM}`, aud: [AUD], exp: now + 600, iat: now - 5, email: 'ops@vande.example' };
    const call = async (jwt: string) => new Player(b).call<{ id: string; via: string }>('GET', '/v1/admin/whoami', undefined, { token: null, headers: { 'cf-access-jwt-assertion': jwt } });
    const good = await call(await keys.sign(ok));
    expect(good.status).toBe(200);
    expect(good.body).toEqual({ id: 'ops@vande.example', via: 'access' });
    expect((await call(await keys.sign({ ...ok, aud: ['b'.repeat(64)] }))).status).toBe(401);
    expect((await call(await keys.sign({ ...ok, iss: 'https://evil.cloudflareaccess.com' }))).status).toBe(401);
    expect((await call(await keys.sign({ ...ok, exp: now - 120 }))).status).toBe(401);
    expect((await call(await keys.sign(ok, 'unknown-kid'))).status).toBe(401);
    const other = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign'])) as CryptoKeyPair;
    expect((await call(await keys.sign(ok, 'k1', other.privateKey))).status).toBe(401);
    const parts = (await keys.sign(ok)).split('.');
    expect((await call(`${parts[0]}.${toBase64Url(utf8(JSON.stringify({ ...ok, email: 'intruder@x' })))}.${parts[2]}`)).status).toBe(401);
    b.close();
  });
});

describe('admin console actions', () => {
  it('lists jobs, shows the consent trail and moderation, signs short-lived MP4 links and audits every action', async () => {
    const b = await backend();
    const [a, c] = await players(b, 2);
    await playDuel(a, c, [40, 90]);
    await freeze(b);
    const [job] = await mine(a);
    const admin = new Admin(b);
    const list = await admin.call<{ jobs: AdminJob[]; counts: Record<string, number> }>('GET', '/v1/admin/jobs?day=2026-10-26');
    expect(list.status).toBe(200);
    expect(list.body.jobs.map((j) => j.jobId)).toEqual([job.jobId]);
    expect(list.body.counts).toEqual({ pending_consent: 1 });
    expect((await admin.call('GET', '/v1/admin/jobs?status=nope')).status).toBe(400);
    // Approving before the render and consent is refused.
    expect((await admin.call('POST', `/v1/admin/jobs/${job.jobId}/approve`, {})).status).toBe(409);
    await consent(a, job.jobId, 'granted');
    await consent(c, job.jobId, 'granted', 'unlisted');
    const render = new RenderClient(b);
    await render.claim();
    await render.deliver(job.jobId);
    const detail = await admin.call<AdminJobDetail>('GET', `/v1/admin/jobs/${job.jobId}`);
    expect(detail.body.job.status).toBe('pending_moderation');
    expect(detail.body.consents.map((x) => [x.decision, x.approvedVisibility])).toEqual([['granted', 'public'], ['granted', 'unlisted']]);
    expect(detail.body.moderation[0]).toMatchObject({ reviewer: 'auto', decision: 'pass' });
    // The preview link: works now, never after 10 minutes, never with another signature.
    const link = await admin.call<{ url: string; expiresAt: string }>('POST', `/v1/admin/jobs/${job.jobId}/preview-url`);
    expect(link.status).toBe(200);
    const url = new URL(link.body.url);
    const path = `${url.pathname}${url.search}`;
    const whole = await b.fetch(`${API}${path}`);
    expect(whole.status).toBe(200);
    expect(whole.headers.get('content-type')).toBe('video/mp4');
    expect((await whole.arrayBuffer()).byteLength).toBe(64 * 1024);
    const part = await b.fetch(`${API}${path}`, { headers: { range: 'bytes=0-99' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 0-99/${64 * 1024}`);
    expect((await b.fetch(`${API}${path.replace(/sig=[^&]+/, 'sig=AAAA')}`)).status).toBe(403);
    b.clock.set(b.clock.now() + 11 * 60_000);
    expect((await b.fetch(`${API}${path}`)).status).toBe(403);
    // Reject with notes.
    const rejected = await admin.call('POST', `/v1/admin/jobs/${job.jobId}/reject`, { notes: 'camera cut too abrupt' });
    expect(rejected.status).toBe(200);
    expect(await row(b, 'SELECT status FROM highlight_jobs WHERE job_id = ?1', job.jobId)).toEqual({ status: 'rejected' });
    expect(await row(b, "SELECT reviewer, admin, decision, notes FROM highlight_moderation WHERE job_id = ?1 AND reviewer = 'admin'", job.jobId)).toEqual({ reviewer: 'admin', admin: 'dev-token', decision: 'reject', notes: 'camera cut too abrupt' });
    // Every action is in the audit log (with the admin identity, never a player id).
    const audited = await b.db.prepare("SELECT detail FROM audit_log WHERE action = 'admin_action' ORDER BY at_ms").all<{ detail: string }>();
    expect(audited.results.map((x) => JSON.parse(x.detail).action)).toEqual(['preview', 'reject']);
    // Retry the render after a rejection is not allowed; the queue and quota views answer.
    expect((await admin.call('POST', `/v1/admin/jobs/${job.jobId}/retry-render`)).status).toBe(409);
    expect((await admin.call('GET', '/v1/admin/quota')).status).toBe(200);
    expect((await admin.call<{ jobs: AdminJob[] }>('GET', '/v1/admin/dlq')).body.jobs).toEqual([]);
    b.close();
  });

  it('unlists and removes a published video through the adapter', async () => {
    const b = await backend({ vars: { HIGHLIGHT_AUTO_APPROVE: '1' } });
    const [a, c] = await players(b, 2);
    await playDuel(a, c, [40, 90]);
    await freeze(b);
    const [job] = await mine(a);
    await consent(a, job.jobId, 'granted');
    await consent(c, job.jobId, 'granted');
    const render = new RenderClient(b);
    await render.claim();
    await render.deliver(job.jobId);
    await b.drainQueues();
    const admin = new Admin(b);
    expect((await admin.call('POST', `/v1/admin/jobs/${job.jobId}/unlist`)).status).toBe(202);
    await b.drainQueues();
    expect(await row(b, 'SELECT status, visibility FROM highlight_jobs WHERE job_id = ?1', job.jobId)).toEqual({ status: 'unlisted', visibility: 'unlisted' });
    expect((await admin.call('POST', `/v1/admin/jobs/${job.jobId}/remove`)).status).toBe(202);
    await b.drainQueues();
    expect(await row(b, 'SELECT status FROM highlight_jobs WHERE job_id = ?1', job.jobId)).toEqual({ status: 'removed' });
    b.close();
  });
});
