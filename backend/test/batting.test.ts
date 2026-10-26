// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { MatchEventLog, NextBallResponse, ShotResponse } from '@/contracts';
import { testShot } from './fakeEngine';
import { backend, duel } from './helpers';

async function ready() {
  const b = await backend();
  const d = await duel(b);
  await d.a.lock(d.matchId, 1);
  await d.c.lock(d.matchId, 2);
  return { b, ...d };
}

describe('one delivery at a time', () => {
  it('reveals exactly one ball, and asking again returns the same ball without restarting its clock', async () => {
    const { b, a, matchId } = await ready();
    const first = await a.next(matchId);
    expect(first.status).toBe(200);
    expect(first.body.delivery.ball).toBe(0);
    expect(first.body.ballsLeft).toBe(6);
    expect(['attacking', 'balanced', 'sweeper']).toContain(first.body.field);
    b.clock.advance(5_000);
    const again = await a.next(matchId);
    expect(again.body).toEqual(first.body);
    expect(b.metrics.get('ball_revealed')).toBe(1);
    // The batter's own view knows how far they got; the opponent's does not see it.
    await a.shot(matchId, first.body.ballToken, testShot(first.body.delivery));
    const second = await a.next(matchId);
    expect(second.body.delivery.ball).toBe(1);
    expect((await a.view(matchId)).body.myBallsFaced).toBe(1);
    b.close();
  });

  it('bats a full innings: six balls then the Super Ball', async () => {
    const { b, a, matchId } = await ready();
    const balls: number[] = [];
    for (let i = 0; i < 8; i++) {
      const n = await a.next(matchId);
      if (n.status !== 200) break;
      balls.push(n.body.delivery.ball);
      const s = await a.shot(matchId, n.body.ballToken, testShot(n.body.delivery, 0, 'defend'));
      if (s.body.inningsComplete) break;
    }
    expect(balls).toEqual([0, 1, 2, 3, 4, 5, 6]);
    b.close();
  });
});

describe('dead balls', () => {
  it('after two wickets the batter still faces all six balls and the Super Ball; the rest are dead', async () => {
    const { b, a, c, matchId } = await ready();
    const balls: number[] = [];
    for (let i = 0; i < 8; i++) {
      const n = await a.next(matchId);
      if (n.status !== 200) break;
      balls.push(n.body.delivery.ball);
      expect(n.body.ballsLeft).toBe(6 - n.body.delivery.ball);
      const s = await a.shot(matchId, n.body.ballToken, testShot(n.body.delivery, -600, 'loft'));
      expect(s.status).toBe(200);
      expect(Object.keys(s.body.feedback).sort()).toEqual(['ball', 'contact', 'timing']);
      if (s.body.inningsComplete) break;
    }
    expect(balls).toEqual([0, 1, 2, 3, 4, 5, 6]);
    await c.batInnings(matchId);
    const log = (await a.call<MatchEventLog>('GET', `/v1/matches/${matchId}/reveal`)).body;
    expect(log.innings[0].wickets).toBe(2);
    expect(log.innings[0].balls).toHaveLength(2);
    expect(log.innings[0].ballsFaced).toBe(2);
    b.close();
  });
});

describe('leaving the ball', () => {
  it('accepts a leave with an empty trace and no tap', async () => {
    const { b, a, matchId } = await ready();
    const n = (await a.next(matchId)).body;
    const leave = { v: 1, ball: n.delivery.ball, shot: 'leave', zone: null, tapMs: null, trace: { pointer: 'touch', samples: [] }, clientElapsedMs: 900 };
    const s = await a.shot(matchId, n.ballToken, leave);
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body.feedback).toEqual({ ball: 0, timing: 'no_shot', contact: 'none' });
    b.close();
  });
});

describe('ball tokens', () => {
  it('a duplicate shot replays the first answer and resolves nothing twice', async () => {
    const { b, a, matchId } = await ready();
    const n = (await a.next(matchId)).body;
    const s1 = await a.shot(matchId, n.ballToken, testShot(n.delivery, 0));
    const s2 = await a.shot(matchId, n.ballToken, testShot(n.delivery, 150, 'loft'));
    expect(s2.status).toBe(200);
    expect(s2.body).toEqual(s1.body);
    expect(b.metrics.get('ball_resolved', 'live')).toBe(1);
    // An old token after the next ball was revealed changes nothing either.
    const n2 = (await a.next(matchId)).body;
    expect((await a.shot(matchId, n.ballToken, testShot(n.delivery))).body).toEqual(s1.body);
    expect((await a.next(matchId)).body.ballToken).toBe(n2.ballToken);
    b.close();
  });

  it('concurrent duplicates resolve once', async () => {
    const { b, a, matchId } = await ready();
    const n = (await a.next(matchId)).body;
    const results = await Promise.all([0, 1, 2, 3].map(() => a.shot(matchId, n.ballToken, testShot(n.delivery))));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => JSON.stringify(r.body))).size).toBe(1);
    expect(b.metrics.get('ball_resolved', 'live')).toBe(1);
    b.close();
  });

  it('refuses forged, truncated and foreign tokens', async () => {
    const { b, a, matchId } = await ready();
    const n = (await a.next(matchId)).body;
    const parts = n.ballToken.split('.');
    const payload = JSON.parse(atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')));
    const forgedPayload = btoa(JSON.stringify({ ...payload, r: payload.r + 3_600_000 })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    for (const bad of [`${parts[0]}.${parts[1]}.${forgedPayload}.${parts[3]}`, n.ballToken.slice(0, -2), 'bt1.x.y.z', 42, null]) {
      const r = await a.call<{ error: { code: string } }>('POST', `/v1/matches/${matchId}/bat/shot`, { ballToken: bad, input: testShot(n.delivery) });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('invalid');
    }
    expect((await a.shot(matchId, n.ballToken, testShot(n.delivery))).status).toBe(200);
    b.close();
  });

  it('validates inputs, and three invalid answers settle the ball as a leave', async () => {
    const { b, a, matchId } = await ready();
    const n = (await a.next(matchId)).body;
    const wrongBall = { ...testShot(n.delivery), ball: 3 };
    expect((await a.shot(matchId, n.ballToken, wrongBall)).status).toBe(400);
    const tooFast = { ...testShot(n.delivery), clientElapsedMs: 60_000 };
    expect((await a.shot(matchId, n.ballToken, tooFast)).status).toBe(400);
    const r3 = await a.call<{ error: { message: string } }>('POST', `/v1/matches/${matchId}/bat/shot`, { ballToken: n.ballToken, input: { v: 1, nonsense: true } });
    expect(r3.status).toBe(400);
    expect(r3.body.error.message).toContain('leave');
    const next = await a.next(matchId);
    expect(next.body.delivery.ball).toBe(1);
    b.close();
  });
});

describe('interrupted batting', () => {
  it('app closed mid-ball: the unanswered ball becomes a leave when the batter returns', async () => {
    const { b, a, c, matchId } = await ready();
    const n = (await a.next(matchId)).body;
    b.clock.advance(5 * 60_000);
    const back = await a.next(matchId);
    expect(back.status).toBe(200);
    expect(back.body.delivery.ball).toBe(1);
    const late = await a.call<{ error: { code: string } }>('POST', `/v1/matches/${matchId}/bat/shot`, { ballToken: n.ballToken, input: testShot(n.delivery) });
    expect(late.status).toBe(410);
    expect(late.body.error.code).toBe('deadline_passed');
    await a.shot(matchId, back.body.ballToken, testShot(back.body.delivery));
    for (let i = 0; i < 6; i++) {
      const x = await a.next(matchId);
      if (x.status !== 200) break;
      const s = await a.shot(matchId, x.body.ballToken, testShot(x.body.delivery));
      if (s.body.inningsComplete) break;
    }
    await c.batInnings(matchId);
    const log = (await a.call<MatchEventLog>('GET', `/v1/matches/${matchId}/reveal`)).body;
    const first = log.innings[0].balls[0];
    expect(first.timing).toBe('interrupted');
    expect(first.runs).toBe(0);
    expect(first.wicket).toBeNull();
    b.close();
  });

  it('network lost after a shot: the queued answer is accepted when it arrives within the late window', async () => {
    const { b, a, matchId } = await ready();
    const n = (await a.next(matchId)).body;
    const made = testShot(n.delivery, 0); // made in time on the device (clientElapsedMs ≈ 1 s)
    b.clock.advance(3 * 60_000); // …but only delivered three minutes later
    const s = await a.shot(matchId, n.ballToken, made);
    expect(s.status).toBe(200);
    expect(s.body.feedback.timing).toBe('perfect');
    expect(b.metrics.get('ball_resolved', 'late')).toBe(1);
    b.close();
  });

  it('a queued answer past the late window is refused and the ball counts as a leave', async () => {
    const { b, a, matchId } = await ready();
    const n = (await a.next(matchId)).body;
    b.clock.advance(11 * 60_000);
    const s = await a.call<{ error: { code: string } }>('POST', `/v1/matches/${matchId}/bat/shot`, { ballToken: n.ballToken, input: testShot(n.delivery) });
    expect(s.status).toBe(410);
    expect((await a.next(matchId)).body.delivery.ball).toBe(1);
    b.close();
  });

  it('an answer the device itself made too slowly does not count', async () => {
    const { b, a, matchId } = await ready();
    const n = (await a.next(matchId)).body;
    b.clock.advance(60_000);
    const slow = { ...testShot(n.delivery), clientElapsedMs: 45_000 };
    expect((await a.shot(matchId, n.ballToken, slow)).status).toBe(410);
    b.close();
  });

  it('a retried next with the same Idempotency-Key replays its ball instead of revealing another', async () => {
    const { b, a, matchId } = await ready();
    const key = crypto.randomUUID();
    const n = (await a.next(matchId, key)).body;
    const s = (await a.shot(matchId, n.ballToken, testShot(n.delivery))).body;
    const replay = await a.next(matchId, key);
    expect(replay.body).toEqual(n);
    expect(b.metrics.get('ball_revealed')).toBe(1);
    expect((await a.shot(matchId, replay.body.ballToken, testShot(n.delivery))).body).toEqual(s);
    b.close();
  });

  it('survives the match object being evicted between balls', async () => {
    const { b, a, c, matchId } = await ready();
    const n = (await a.next(matchId)).body as NextBallResponse;
    b.matches.evict();
    const s = (await a.shot(matchId, n.ballToken, testShot(n.delivery))).body as ShotResponse;
    expect(s.feedback.ball).toBe(0);
    b.matches.evict();
    expect((await a.next(matchId)).body.delivery.ball).toBe(1);
    b.matches.evict();
    await a.batInnings(matchId);
    await c.batInnings(matchId);
    b.matches.evict();
    expect((await c.view(matchId)).body.phase).toBe('revealed');
    b.close();
  });
});
