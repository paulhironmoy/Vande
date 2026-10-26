// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { MatchView, NextBallResponse } from '@/contracts';
import { open } from '../src/security/crypto';
import { parseKeyring } from '../src/security/keyring';
import { testShot } from './fakeEngine';
import { Player, backend, duel } from './helpers';

const FORBIDDEN_IN_VIEWS = ['gesture', 'samples', 'intent', 'salt', 'runs', 'wicket', 'outcome', 'execution', 'lockedHour', 'revealedMs', 'uid'];

describe('authorization', () => {
  it('hides a match from everyone but its two players', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    const x = new Player(b);
    await x.signup();
    for (const [method, path, body] of [
      ['GET', `/v1/matches/${matchId}`, undefined],
      ['POST', `/v1/matches/${matchId}/lock`, { plan: (await import('./fakeEngine')).testPlan(1) }],
      ['POST', `/v1/matches/${matchId}/bat/next`, undefined],
      ['GET', `/v1/matches/${matchId}/reveal`, undefined],
      ['POST', `/v1/matches/${matchId}/rematch`, undefined],
      ['POST', `/v1/matches/${matchId}/share`, undefined],
    ] as const) {
      const r = await x.call<{ error: { code: string } }>(method, path, body);
      expect(r.status, path).toBe(404);
      expect(r.body.error.code).toBe('not_found');
    }
    expect((await x.call<MatchView[]>('GET', '/v1/matches')).body).toEqual([]);
    expect((await a.call('GET', `/v1/matches/${matchId}`, undefined, { token: null })).status).toBe(401);
    expect((await c.view(matchId)).status).toBe(200);
    expect((await x.call('GET', '/v1/matches/not-a-match-id')).status).toBe(404);
    b.close();
  });

  it('never shows the opponent a plan, a time or a result before the reveal', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    const seen: string[] = [];
    const look = async () => {
      seen.push(JSON.stringify((await a.view(matchId)).body), JSON.stringify((await c.view(matchId)).body));
      seen.push(JSON.stringify((await a.call('GET', '/v1/matches')).body), JSON.stringify((await c.call('GET', '/v1/matches')).body));
    };
    await look();
    await a.lock(matchId, 1);
    await look();
    await c.lock(matchId, 2);
    await look();
    for (let i = 0; i < 3; i++) {
      const n = await a.next(matchId);
      expect(Object.keys(n.body).sort()).toEqual(['ballToken', 'ballsLeft', 'delivery', 'field']);
      expect(Object.keys(n.body.delivery).sort()).toEqual(['ball', 'family', 'intensity', 'length', 'line', 'path', 'timing', 'variant']);
      const s = await a.shot(matchId, n.body.ballToken, testShot(n.body.delivery));
      expect(Object.keys(s.body).sort()).toEqual(['feedback', 'inningsComplete']);
      expect(Object.keys(s.body.feedback).sort()).toEqual(['ball', 'contact', 'timing']);
      await look();
    }
    await a.batInnings(matchId);
    await look();
    const ring = parseKeyring(b.env.DATA_KEYS)!;
    const secret = (await b.matches.storage(matchId).get<string>(['secret'])).get('secret')!;
    const seed = (JSON.parse((await open(ring.all, 'secret', matchId, secret, matchId))!) as { seed: string }).seed;
    for (const text of seen) {
      for (const w of FORBIDDEN_IN_VIEWS) expect(text, w).not.toContain(`"${w}`);
      expect(text).not.toContain(seed);
    }
    b.close();
  });

  it('enforces invite rules: not your own, not someone else’s, idempotent for the acceptor', async () => {
    const b = await backend();
    const a = new Player(b);
    await a.signup();
    const d = await a.call<{ matchId: string; inviteToken: string }>('POST', '/v1/duels', {});
    const own = await a.call<{ error: { code: string } }>('POST', `/v1/invites/${d.body.inviteToken}/accept`);
    expect(own.status).toBe(403);
    const c = new Player(b);
    await c.signup();
    expect((await c.call('POST', `/v1/invites/${d.body.inviteToken}/accept`)).status).toBe(200);
    const again = await c.call<{ matchId: string }>('POST', `/v1/invites/${d.body.inviteToken}/accept`);
    expect(again.status).toBe(200);
    expect(again.body.matchId).toBe(d.body.matchId);
    const x = new Player(b);
    await x.signup();
    const late = await x.call<{ error: { code: string } }>('POST', `/v1/invites/${d.body.inviteToken}/accept`);
    expect(late.status).toBe(409);
    expect((await x.call('POST', `/v1/invites/${d.body.inviteToken}/accept`, undefined, { token: null })).status).toBe(401);
    b.close();
  });

  it('refuses batting before both overs are locked and after the innings is done', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    await a.lock(matchId, 1);
    const early = await a.call<{ error: { code: string } }>('POST', `/v1/matches/${matchId}/bat/next`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('not_your_turn');
    await c.lock(matchId, 2);
    await a.batInnings(matchId);
    const done = await a.next(matchId);
    expect(done.status).toBe(409);
    b.close();
  });

  it('a ball token is useless to the opponent and in another match', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    await a.lock(matchId, 1);
    await c.lock(matchId, 2);
    const n = (await a.next(matchId)).body as NextBallResponse;
    const stolen = await c.shot(matchId, n.ballToken, testShot(n.delivery));
    expect(stolen.status).toBe(400);
    const other = await duel(b);
    await other.a.lock(other.matchId, 3);
    await other.c.lock(other.matchId, 4);
    const elsewhere = await other.a.shot(other.matchId, n.ballToken, testShot(n.delivery));
    expect(elsewhere.status).toBe(400);
    expect((await a.shot(matchId, n.ballToken, testShot(n.delivery))).status).toBe(200);
    b.close();
  });
});
