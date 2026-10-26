/**
 * Two players, two devices, the real network client (src/net) against the in-process Worker: create, invite, accept,
 * lock through the outbox, bat with BattingClient (one shot made offline and delivered later), reveal.
 */
import { describe, expect, it } from 'vitest';
import type { MatchEventLog } from '@/contracts';
import { createLocalBackend, type LocalBackend } from '../../../backend/local/harness';
import { fakeEngine, fakeHelpers, testPlan, testShot } from '../../../backend/test/fakeEngine';
import { createNet, type Net } from '@/net';
import { memoryKeyValue } from '@/net/idb';
import { memoryOutboxStorage } from '@/net/outbox';
import { createMemorySecureStore } from '@/platform/secureStore';

function device(b: LocalBackend) {
  const state = { offline: false, online: [] as boolean[] };
  const net = createNet({
    adultConfirmed: () => true,
    config: { apiUrl: 'https://api.local', timeoutMs: 5_000, clientId: 'vande-cricket/test' },
    secureStore: createMemorySecureStore(),
    setOnline: (v) => state.online.push(v),
    locale: () => 'en',
    now: b.clock.now,
    outboxStorage: memoryOutboxStorage(),
    kv: memoryKeyValue(),
    fetch: async (url, init) => {
      if (state.offline) throw new TypeError('Failed to fetch');
      return b.fetch(new Request(url, { method: init.method, headers: init.headers, body: init.body }));
    },
    connectivity: { target: new EventTarget(), nav: { onLine: true }, appResume: async () => () => undefined },
  }) as Net;
  return { net, state };
}

async function batAll(net: Net, matchId: string, b: LocalBackend) {
  for (let i = 0; i < 10; i++) {
    const ball = await net.batting.next(matchId).catch(() => null);
    if (!ball) break;
    b.clock.advance(1_200);
    const r = await net.batting.shot(matchId, ball.ballToken, testShot(ball.delivery));
    if (r.status !== 'resolved') throw new Error('expected an online shot');
    if (r.response.inningsComplete) break;
  }
}

describe('a duel through the network client', () => {
  it('survives an offline shot and reveals for both players', async () => {
    const b = await createLocalBackend({ engine: fakeEngine, helpers: fakeHelpers, now: Date.UTC(2026, 9, 26, 6, 30) });
    const A = device(b);
    const C = device(b);
    const duel = await A.net.api.call('POST /v1/duels', { body: { conditions: { pitch: 'green', weather: 'humid' } } });
    expect(duel.inviteUrl).toContain('/i/');
    const preview = await C.net.api.call('GET /v1/invites/:token', { params: { token: duel.inviteToken } });
    expect(preview.kind).toBe('duel');
    await C.net.api.call('POST /v1/invites/:token/accept', { params: { token: duel.inviteToken } });
    for (const [d, seed] of [[A, 1], [C, 2]] as const) {
      const r = await d.net.outbox.submit({ route: 'POST /v1/matches/:id/lock', params: { id: duel.matchId }, body: { plan: testPlan(seed) }, group: `match:${duel.matchId}` });
      expect(r.status).toBe('sent');
    }
    await batAll(A.net, duel.matchId, b);

    // C: first ball revealed, then the network drops right after the shot is made.
    const ball = await C.net.batting.next(duel.matchId);
    b.clock.advance(1_000);
    C.state.offline = true;
    const queued = await C.net.batting.shot(duel.matchId, ball.ballToken, testShot(ball.delivery));
    expect(queued.status).toBe('queued');
    await expect(C.net.batting.next(duel.matchId)).rejects.toMatchObject({ code: 'offline' });
    expect(await C.net.outbox.pending(`match:${duel.matchId}`)).toHaveLength(1);
    b.clock.advance(2 * 60_000);
    C.state.offline = false;
    const next = await C.net.batting.next(duel.matchId); // delivers the queued shot first, then asks for ball 2
    expect(next.delivery.ball).toBe(1);
    if (queued.status === 'queued') await expect(queued.delivered).resolves.toMatchObject({ feedback: { ball: 0 } });
    b.clock.advance(1_200);
    await C.net.batting.shot(duel.matchId, next.ballToken, testShot(next.delivery));
    await batAll(C.net, duel.matchId, b);

    const view = await A.net.api.call('GET /v1/matches/:id', { params: { id: duel.matchId } });
    expect(view.phase).toBe('revealed');
    const logA: MatchEventLog = await A.net.api.call('GET /v1/matches/:id/reveal', { params: { id: duel.matchId } });
    const logC: MatchEventLog = await C.net.api.call('GET /v1/matches/:id/reveal', { params: { id: duel.matchId } });
    expect(logA).toEqual(logC);
    expect(logC.innings[1].balls[0].timing).not.toBe('interrupted');
    expect(b.metrics.get('ball_resolved', 'late')).toBe(1);
    A.net.dispose();
    C.net.dispose();
    b.close();
  });
});
