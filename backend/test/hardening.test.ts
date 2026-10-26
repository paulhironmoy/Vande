// @vitest-environment node
/**
 * Hardening from the security review: anonymous traffic is shed first and cannot use up the signed-in budget
 * (finding 4), the highlight render input carries the moderated display names (finding 6), plain-object lookups use
 * own keys only (finding 7), and the FCM collapse key never carries the internal account id (finding 8).
 */
import { describe, expect, it } from 'vitest';
import type { HighlightPreview } from '@/contracts';
import { MockPushSender } from '../src/ops/push';
import { API, ORIGIN, Player, backend, duel } from './helpers';
import { consent, freeze, mine, playDuel, players, row } from './highlightHelpers';

describe('rate-limit budgets', () => {
  it('an anonymous flood from one rented /48 (rotating /64s) cannot lock signed-in players out', async () => {
    // Scaled down: anonymous ceiling 300 a minute, invite lookups 60 a minute per network.
    const b = await backend({ bindingLimits: { RL_GLOBAL_ANON: 300, RL_INVITE: 60 } });
    const victim = new Player(b, '203.0.113.7');
    await victim.signup('Honest Player');
    const statuses: Record<number, number> = {};
    for (let net = 0; net < 8; net++) {
      for (let i = 0; i < 60; i++) {
        const res = await b.fetch(`${API}/v1/invites/${'A'.repeat(51)}.${'B'.repeat(22)}`, { headers: { origin: ORIGIN, 'cf-connecting-ip': `2001:db8:1234:${(net * 256).toString(16)}::${i + 1}` } });
        statuses[res.status] = (statuses[res.status] ?? 0) + 1;
      }
    }
    expect(statuses[429]).toBeGreaterThan(0);
    expect((await victim.call('GET', '/v1/me')).status).toBe(200);
    expect((await victim.call('GET', '/v1/daily')).status).toBe(200);
    b.close();
  });

  it('rotating /64s inside one /56 counts as one network on anonymous routes', async () => {
    const b = await backend({ bindingLimits: { RL_INVITE: 5 } });
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await b.fetch(`${API}/v1/invites/${'A'.repeat(51)}.${'B'.repeat(22)}`, { headers: { origin: ORIGIN, 'cf-connecting-ip': `2001:db8:1234:${i.toString(16)}::1` } });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5)).toEqual([404, 404, 404, 404, 404]);
    expect(statuses.slice(5)).toEqual([429, 429, 429]);
    b.close();
  });

  it('the signed-in ceiling is checked after the token: forged tokens spend the anonymous budget instead', async () => {
    const b = await backend({ bindingLimits: { RL_GLOBAL: 3, RL_GLOBAL_ANON: 1000 } });
    const p = new Player(b);
    await p.signup();
    for (let i = 0; i < 20; i++) {
      const forged = await new Player(b, `198.18.1.${i + 1}`).call('GET', '/v1/me', undefined, { token: `at1.k1.${'x'.repeat(30)}.y` });
      expect(forged.status).toBe(401);
    }
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await p.call('GET', '/v1/me')).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(b.metrics.get('rate_limited', 'global')).toBe(1);
    b.close();
  });
});

describe('highlight display names', () => {
  it('the render input carries the moderated names of the title, never the replay’s match-time alias', async () => {
    const b = await backend();
    const [a, c] = await players(b, 2);
    await playDuel(a, c, [40, 90]);
    expect((await a.call('PATCH', '/v1/me', { alias: 'Renamed Later' })).status).toBe(200);
    await freeze(b);
    const [job] = await mine(a);
    const preview = await a.call<HighlightPreview>('GET', `/v1/highlights/${job.jobId}/preview`);
    expect(preview.body.input.aliases).toEqual(['Renamed Later', 'Calm Cobra']);
    expect(preview.body.job.title).toContain('Renamed Later vs Calm Cobra');
    expect(preview.body.input.log.players[0].alias).toBe('Swift Tiger'); // the replay itself is not rewritten
    await consent(a, job.jobId, 'granted');
    await consent(c, job.jobId, 'granted');
    expect(await row(b, 'SELECT alias_check FROM highlight_moderation WHERE job_id = ?1', job.jobId)).toEqual({ alias_check: 'pass' });
    b.close();
  });
});

describe('own-key lookups', () => {
  it('a cup pace naming an inherited property ("toString", "constructor") is refused', async () => {
    const b = await backend();
    const p = new Player(b);
    await p.signup('Pace Tester');
    for (const pace of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect((await p.call('POST', '/v1/cups', { name: 'Proto Cup', maxPlayers: 3, pace })).status, pace).toBe(400);
    }
    expect((await p.call('POST', '/v1/cups', { name: 'Proper Cup', maxPlayers: 3, pace: 'sprint' })).status).toBe(201);
    b.close();
  });
});

describe('push collapse keys', () => {
  it('never carry the internal account id', async () => {
    const push = new MockPushSender();
    const b = await backend({ push });
    const { a, c, matchId } = await duel(b);
    await a.call('POST', '/v1/push/register', { token: `token-a-${'a'.repeat(40)}`, platform: 'android' });
    await c.call('POST', '/v1/push/register', { token: `token-c-${'c'.repeat(40)}`, platform: 'android' });
    await a.lock(matchId, 1);
    await c.lock(matchId, 2);
    await a.batInnings(matchId);
    await c.batInnings(matchId);
    await b.drainQueues();
    const uids = [a, c].map((p) => JSON.parse(Buffer.from(p.tokens!.accessToken.split('.')[2], 'base64url').toString()).sub as string);
    expect(push.sent.length).toBeGreaterThan(0);
    for (const s of push.sent) {
      for (const uid of uids) expect(s.message.collapseKey).not.toContain(uid);
      expect(s.message.collapseKey.startsWith(matchId)).toBe(true);
    }
    b.close();
  });
});
