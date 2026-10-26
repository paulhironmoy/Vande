// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MockPushSender } from '../src/ops/push';
import { Player, backend, duel } from './helpers';

const HOUR = 3_600_000;

async function withPush(p: Player, n = 0) {
  await p.call('POST', '/v1/push/register', { token: `device-${n}-${'k'.repeat(40)}`, platform: 'android' });
}

function uidOf(b: Awaited<ReturnType<typeof backend>>, p: Player): string {
  return (b.db.db.prepare('SELECT uid FROM accounts WHERE player_id = ?').get(p.tokens!.playerId) as { uid: string }).uid;
}

describe('notification policy', () => {
  it('a player can turn notifications off and set quiet hours', async () => {
    const b = await backend();
    const p = new Player(b);
    await p.signup();
    expect((await p.call('GET', '/v1/push/settings')).body).toEqual({ enabled: true, quietHours: { start: '22:00', end: '08:00' } });
    expect((await p.call('POST', '/v1/push/settings', { quietHours: { start: '23:30', end: '06:00' } })).body).toEqual({ enabled: true, quietHours: { start: '23:30', end: '06:00' } });
    expect((await p.call('POST', '/v1/push/settings', { quietHours: null })).body).toEqual({ enabled: true, quietHours: null });
    expect((await p.call('POST', '/v1/push/settings', { enabled: false })).body).toEqual({ enabled: false, quietHours: null });
    expect((await p.call('POST', '/v1/push/settings', { quietHours: { start: '25:00', end: '06:00' } })).status).toBe(400);
    b.close();
  });

  it('global opt-out and a muted room stop pushes; "important" lets only reveals and deadlines through', async () => {
    const push = new MockPushSender();
    const b = await backend({ push });
    const { a, c, matchId } = await duel(b);
    await withPush(a, 1);
    await withPush(c, 2);
    await a.call('POST', '/v1/push/settings', { enabled: false });
    await c.call('POST', `/v1/rooms/r${matchId.slice(1)}/settings`, { notify: 'important' });
    await a.lock(matchId, 1);
    await c.lock(matchId, 2);
    await a.batInnings(matchId);
    await c.batInnings(matchId);
    b.clock.advance(11 * 60_000);
    await b.drainQueues();
    const toA = push.sent.filter((s) => s.token.startsWith('device-1'));
    const toC = push.sent.filter((s) => s.token.startsWith('device-2'));
    expect(toA).toEqual([]);
    expect(toC.map((s) => s.message.kind)).toEqual(['reveal_ready']);
    expect(b.metrics.total('notify_dropped')).toBeGreaterThanOrEqual(3);
    b.close();
  });

  it('quiet hours drop routine pushes and hold important ones until the morning (IST)', async () => {
    const push = new MockPushSender();
    // 17:30 UTC = 23:00 IST, inside the default quiet hours.
    const b = await backend({ push, now: Date.UTC(2026, 9, 26, 17, 30) });
    const p = new Player(b);
    await p.signup();
    await withPush(p);
    const uid = uidOf(b, p);
    await b.notify.send({ v: 1, kind: 'opponent_joined', uid, matchId: 'mx', dedupe: 'a' });
    await b.notify.send({ v: 1, kind: 'reveal_ready', uid, matchId: 'mx', dedupe: 'b' });
    await b.drainQueues();
    expect(push.sent).toEqual([]);
    expect(b.metrics.get('notify_deferred', 'reveal_ready')).toBe(1);
    // 08:00 IST is 02:30 UTC the next day.
    b.clock.set(Date.UTC(2026, 9, 27, 2, 31));
    await b.drainQueues();
    expect(push.sent.map((s) => s.message.kind)).toEqual(['reveal_ready']);
    b.close();
  });

  it('caps routine pushes at 4 a day and all pushes at 8', async () => {
    const push = new MockPushSender();
    const b = await backend({ push });
    const p = new Player(b);
    await p.signup();
    await withPush(p);
    const uid = uidOf(b, p);
    for (let i = 0; i < 6; i++) await b.notify.send({ v: 1, kind: 'opponent_joined', uid, matchId: `m${i}`, dedupe: `r${i}` });
    for (let i = 0; i < 6; i++) await b.notify.send({ v: 1, kind: 'reveal_ready', uid, matchId: `m${i}`, dedupe: `i${i}` });
    await b.drainQueues();
    expect(push.sent.filter((s) => s.message.kind === 'opponent_joined')).toHaveLength(4);
    expect(push.sent).toHaveLength(8);
    b.clock.advance(24 * HOUR);
    await b.notify.send({ v: 1, kind: 'opponent_joined', uid, matchId: 'm9', dedupe: 'next-day' });
    await b.drainQueues();
    expect(push.sent).toHaveLength(9);
    b.close();
  });

  it('sends one deadline reminder per player per match, never more', async () => {
    const push = new MockPushSender();
    const b = await backend({ push });
    const { a, c, matchId } = await duel(b);
    await withPush(a, 1);
    await withPush(c, 2);
    // Lock window 24 h: the reminder goes 2 h before the lock deadline to players who have not locked.
    await a.lock(matchId, 1);
    await b.advance(22 * HOUR + 60_000);
    await b.drainQueues();
    const reminders = () => push.sent.filter((s) => s.message.kind === 'deadline_reminder');
    expect(reminders().map((s) => s.token.slice(0, 8))).toEqual(['device-2']);
    await c.lock(matchId, 2);
    // Batting window: c's reminder was already used; a still gets one.
    await b.advance(24 * HOUR - 60_000);
    await b.drainQueues();
    expect(reminders().map((s) => s.token.slice(0, 8)).sort()).toEqual(['device-1', 'device-2']);
    b.close();
  });
});
