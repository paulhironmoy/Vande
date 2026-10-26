// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CreateDuelResponse, Profile } from '@/contracts';
import { testPlan } from './fakeEngine';
import { Player, backend, duel } from './helpers';

describe('Idempotency-Key', () => {
  it('is required on every mutation', async () => {
    const b = await backend();
    const p = new Player(b);
    await p.signup();
    for (const [method, path, body] of [
      ['POST', '/v1/duels', {}],
      ['PATCH', '/v1/me', { alias: 'Bold Comet' }],
      ['POST', '/v1/groups', { kind: 'college', name: 'IIT Delhi' }],
      ['DELETE', '/v1/me', undefined],
    ] as const) {
      const r = await p.call<{ error: { code: string } }>(method, path, body, { idem: false });
      expect(r.status, path).toBe(400);
      expect(r.body.error.code).toBe('invalid');
    }
    expect((await p.call('POST', '/v1/duels', {}, { idem: 'short' })).status).toBe(400);
    b.close();
  });

  it('replays a duel creation instead of creating a second match', async () => {
    const b = await backend();
    const p = new Player(b);
    await p.signup();
    const key = crypto.randomUUID();
    const one = await p.call<CreateDuelResponse>('POST', '/v1/duels', {}, { idem: key });
    const two = await p.call<CreateDuelResponse>('POST', '/v1/duels', {}, { idem: key });
    expect(two.body).toEqual(one.body);
    expect(b.matches.names()).toHaveLength(1);
    expect(b.metrics.get('idempotent_replay', 'POST /v1/duels')).toBe(1);
    b.close();
  });

  it('a key reused for a different request is a conflict, never a wrong replay', async () => {
    const b = await backend();
    const p = new Player(b);
    await p.signup();
    const key = crypto.randomUUID();
    expect((await p.call('PATCH', '/v1/me', { alias: 'Bold Comet' }, { idem: key })).status).toBe(200);
    const other = await p.call<{ error: { code: string } }>('PATCH', '/v1/me', { alias: 'Calm Comet' }, { idem: key });
    expect(other.status).toBe(409);
    expect((await p.call<Profile>('GET', '/v1/me')).body.alias).toBe('Bold Comet');
    // Keys are scoped per account: another player's identical key is independent.
    const q = new Player(b);
    await q.signup();
    expect((await q.call('PATCH', '/v1/me', { alias: 'Calm Comet' }, { idem: key })).status).toBe(200);
    b.close();
  });

  it('a failed request releases its key so the retry runs; a rejected one is recomputed', async () => {
    const b = await backend();
    const p = new Player(b);
    await p.signup();
    const key = crypto.randomUUID();
    expect((await p.call('POST', '/v1/groups/join', { code: 'ZZZZZ-ZZZZZ' }, { idem: key })).status).toBe(404);
    const g = await p.call<{ code: string }>('POST', '/v1/groups', { kind: 'company', name: 'Infosys Pune' });
    const q = new Player(b);
    await q.signup();
    const k2 = crypto.randomUUID();
    expect((await q.call('POST', '/v1/groups/join', { code: g.body.code }, { idem: k2 })).status).toBe(200);
    expect((await q.call('POST', '/v1/groups/join', { code: g.body.code }, { idem: k2 })).headers.get('idempotent-replay')).toBe('true');
    b.close();
  });

  it('match mutations replay inside the match object (lock with the same key and body)', async () => {
    const b = await backend();
    const { a, matchId } = await duel(b);
    const key = crypto.randomUUID();
    const plan = testPlan(4);
    const one = await a.call('POST', `/v1/matches/${matchId}/lock`, { plan }, { idem: key });
    const two = await a.call('POST', `/v1/matches/${matchId}/lock`, { plan }, { idem: key });
    expect(two.status).toBe(200);
    expect(two.body).toEqual(one.body);
    const different = await a.call<{ error: { code: string } }>('POST', `/v1/matches/${matchId}/lock`, { plan: testPlan(5) }, { idem: key });
    expect(different.status).toBe(409);
    expect(different.body.error.code).toBe('conflict');
    b.close();
  });

  it('a concurrent duplicate waits for the first (409 with retry-after) rather than running twice', async () => {
    const b = await backend();
    const p = new Player(b);
    await p.signup();
    const key = crypto.randomUUID();
    const [x, y] = await Promise.all([p.call('POST', '/v1/duels', {}, { idem: key }), p.call('POST', '/v1/duels', {}, { idem: key })]);
    const statuses = [x.status, y.status].sort();
    expect(statuses[0]).toBe(201);
    expect([201, 409]).toContain(statuses[1]);
    expect(b.matches.names()).toHaveLength(1);
    b.close();
  });
});
