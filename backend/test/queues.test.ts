// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MockPushSender } from '../src/ops/push';
import { Player, backend, duel } from './helpers';

describe('notifications', () => {
  it('sends spoiler-free pushes for joins, locks and the reveal through the queue', async () => {
    const push = new MockPushSender();
    const b = await backend({ push, vars: { ACTIVITY_JITTER_S: '60-600' } });
    const { a, c, matchId } = await duel(b);
    const tokenA = `token-a-${'a'.repeat(40)}`;
    const tokenC = `token-c-${'c'.repeat(40)}`;
    await a.call('POST', '/v1/push/register', { token: tokenA, platform: 'android' });
    await c.call('POST', '/v1/push/register', { token: tokenC, platform: 'android' });
    await a.lock(matchId, 1);
    await c.lock(matchId, 2);
    await b.drainQueues();
    // "Opponent locked" pushes are held back 1–10 minutes (the activity jitter) so they never tell when the over was
    // locked; the lock becomes visible to the opponent at the same moment, so batting starts after it too.
    expect(push.sent.map((s) => s.message.kind)).not.toContain('opponent_locked');
    await b.advance(11 * 60_000);
    await a.batInnings(matchId);
    await c.batInnings(matchId);
    await b.drainQueues();
    const kinds = push.sent.map((s) => `${s.token === tokenA ? 'A' : 'C'}:${s.message.kind}`).sort();
    expect(kinds).toEqual(['A:opponent_joined', 'A:opponent_locked', 'A:reveal_ready', 'C:opponent_locked', 'C:reveal_ready']);
    for (const s of push.sent) expect(Object.keys(s.message).sort()).toEqual(['collapseKey', 'kind', 'matchId']);
    expect(push.sent.every((s) => s.message.matchId === matchId)).toBe(true);
    b.close();
  });

  it('retries transient provider failures, then dead-letters; drops tokens the provider rejects', async () => {
    const push = new MockPushSender();
    const b = await backend({ push });
    const { a, c, matchId } = await duel(b);
    const token = `token-a-${'z'.repeat(40)}`;
    await a.call('POST', '/v1/push/register', { token, platform: 'android' });
    push.failNext = 100;
    await c.lock(matchId, 2);
    for (let i = 0; i < 8; i++) {
      await b.drainQueues();
      b.clock.advance(15 * 60_000);
    }
    expect(push.sent).toHaveLength(0);
    expect(b.metrics.total('notify_dead_letter')).toBeGreaterThan(0);
    push.failNext = 0;
    push.invalid.add(token);
    const { uid } = b.db.db.prepare('SELECT uid FROM accounts WHERE player_id = ?').get(a.tokens!.playerId) as { uid: string };
    await b.notify.send({ v: 1, kind: 'reveal_ready', uid, matchId, dedupe: 'again' });
    await b.drainQueues();
    expect(b.db.db.prepare('SELECT * FROM push_tokens').all()).toEqual([]);
    b.close();
  });

  it('drops notifications quietly when push is not configured', async () => {
    const b = await backend();
    const p = new Player(b);
    await p.signup();
    await b.notify.send({ v: 1, kind: 'reveal_ready', uid: 'unobody', matchId: 'mnothing', dedupe: 'x' });
    await b.drainQueues();
    expect(b.notify.messages).toHaveLength(0);
    b.close();
  });
});

describe('retention cleanup', () => {
  it('prunes idempotency records, rate buckets, revoked sessions and old audit rows within a query budget', async () => {
    const b = await backend({ rateLimits: 'd1' });
    const p = new Player(b);
    await p.signup();
    await p.call('PATCH', '/v1/me', { alias: 'Bold Comet' });
    const count = (t: string) => Number((b.db.db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n);
    expect(count('idempotency')).toBeGreaterThan(0);
    expect(count('rate_buckets')).toBeGreaterThan(0);
    b.clock.advance(181 * 24 * 3_600_000);
    await b.scheduled();
    expect(count('idempotency')).toBe(0);
    expect(count('rate_buckets')).toBe(0);
    expect(count('audit_log')).toBe(0);
    expect(count('sessions')).toBe(1);
    b.close();
  });
});
