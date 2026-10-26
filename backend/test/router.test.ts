// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildRouter } from '../src/app';
import { MemoryLogger } from '../src/http/log';
import { API, ORIGIN, Player, backend } from './helpers';

const CONTRACT_KEYS = [
  'POST /v1/auth/guest', 'POST /v1/auth/refresh', 'POST /v1/auth/link/google', 'GET /v1/me', 'PATCH /v1/me', 'POST /v1/me/export', 'DELETE /v1/me',
  'POST /v1/groups', 'POST /v1/groups/join', 'POST /v1/duels', 'GET /v1/invites/:token', 'POST /v1/invites/:token/accept', 'GET /v1/matches',
  'GET /v1/matches/:id', 'POST /v1/matches/:id/lock', 'POST /v1/matches/:id/bat/next', 'POST /v1/matches/:id/bat/shot', 'GET /v1/matches/:id/reveal',
  'POST /v1/matches/:id/rematch', 'POST /v1/cups', 'GET /v1/cups/:id', 'GET /v1/rooms/:id', 'POST /v1/rooms/:id/react', 'POST /v1/rooms/:id/banter',
  'POST /v1/rooms/:id/settings', 'POST /v1/report', 'POST /v1/blocks/:playerId', 'GET /v1/daily', 'POST /v1/daily/attempts',
  'POST /v1/daily/attempts/:id/next', 'POST /v1/daily/attempts/:id/shot', 'GET /v1/daily/attempts/:id/result', 'GET /v1/leaderboards/:scope',
  'GET /v1/top100/:day', 'GET /v1/highlights/mine', 'POST /v1/highlights/:jobId/consent', 'POST /v1/highlights/:jobId/withdraw', 'POST /v1/push/register',
  'GET /v1/push/settings', 'POST /v1/push/settings', 'POST /v1/rooms/:id/text', 'GET /v1/highlights/:jobId/preview', 'GET /v1/h/:code', 'GET /v1/h/:code/replay',
  'POST /v1/attribution', 'POST /v1/matches/:id/share', 'GET /v1/s/:code', 'POST /v1/matches/:id/moments',
];

describe('router and HTTP plumbing', () => {
  it('serves every contract route, plus the admin console and the render service routes', async () => {
    const keys = buildRouter().keys();
    expect(keys).toEqual(expect.arrayContaining(CONTRACT_KEYS));
    expect(keys).toEqual(expect.arrayContaining(['GET /v1/admin/jobs', 'POST /v1/internal/render/claim', 'PUT /v1/internal/render/jobs/:jobId/video']));
    const b = await backend();
    const p = new Player(b);
    await p.signup();
    const r = await p.call<unknown[]>('GET', '/v1/highlights/mine');
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
    b.close();
  });

  it('answers CORS preflights for allowed origins only', async () => {
    const b = await backend();
    const ok = await b.fetch(`${API}/v1/duels`, { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'POST' } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-headers')).toContain('idempotency-key');
    expect(ok.headers.get('access-control-allow-methods')).toContain('PATCH');
    expect(ok.headers.get('access-control-allow-credentials')).toBeNull();
    const bad = await b.fetch(`${API}/v1/duels`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    expect(bad.status).toBe(403);
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
    b.close();
  });

  it('versions, unknown paths and methods', async () => {
    const b = await backend();
    const p = new Player(b);
    const v2 = await p.call<{ error: { code: string } }>('GET', '/v2/me');
    expect(v2.status).toBe(409);
    expect(v2.body.error.code).toBe('version_mismatch');
    expect((await p.call('GET', '/v1/nothing-here')).status).toBe(404);
    expect((await p.call('GET', '/')).status).toBe(404);
    expect((await p.call('PUT', '/v1/me', {})).status).toBe(405);
    b.close();
  });

  it('limits body size and insists on JSON', async () => {
    const b = await backend();
    const p = new Player(b);
    await p.signup();
    expect((await p.call('PATCH', '/v1/me', undefined, { raw: JSON.stringify({ alias: 'x'.repeat(5000) }) })).status).toBe(413);
    expect((await p.call('PATCH', '/v1/me', undefined, { raw: 'alias=x', headers: { 'content-type': 'text/plain' } })).status).toBe(415);
    expect((await p.call('PATCH', '/v1/me', undefined, { raw: '{oops' })).status).toBe(400);
    b.close();
  });

  it('echoes a well-formed request id, makes one up otherwise, and logs route patterns only', async () => {
    const logger = new MemoryLogger();
    const b = await backend({ logger });
    const a = await b.fetch(`${API}/v1/health`, { headers: { 'x-request-id': 'abc-123-def-456' } });
    expect(a.headers.get('x-request-id')).toBe('abc-123-def-456');
    const c = await b.fetch(`${API}/v1/health`, { headers: { 'x-request-id': 'bad id with spaces' } });
    expect(c.headers.get('x-request-id')).toMatch(/^[0-9a-f]{16}$/);
    const p = new Player(b, '203.0.113.123');
    await p.signup();
    const d = await p.call<{ inviteToken: string }>('POST', '/v1/duels', {});
    await p.call('GET', `/v1/invites/${d.body.inviteToken}`);
    const lines = JSON.stringify(logger.records);
    expect(lines).toContain('GET /v1/invites/:token');
    expect(lines).not.toContain(d.body.inviteToken);
    expect(lines).not.toContain('203.0.113.123');
    expect(lines).not.toContain(p.tokens!.playerId);
    expect(logger.records.find((r) => r.evt === 'request')).toMatchObject({ level: 'info', route: 'GET /v1/health', status: 200 });
    b.close();
  });

  it('health and published keys need no account', async () => {
    const b = await backend();
    const h = await new Player(b).call<{ ok: boolean; engines: number[] }>('GET', '/v1/health');
    expect(h.body).toMatchObject({ ok: true, engines: [1] });
    const k = await new Player(b).call<{ keys: unknown[] }>('GET', '/v1/keys');
    expect(k.body.keys).toHaveLength(1);
    expect(k.headers.get('cache-control')).toBe('public, max-age=3600');
    b.close();
  });
});
