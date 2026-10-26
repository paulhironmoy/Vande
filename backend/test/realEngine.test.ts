// @vitest-environment node
/**
 * The same duel against the real `@/engine`. Runs as soon as the engine works (it is skipped while the engine is a
 * stub or does not load), so the switch from the fake engine needs no edit. Plans come from the engine's own Auto
 * Over and batting inputs from its Auto XI policy, so the test does not depend on rule numbers.
 */
import { describe, expect, it } from 'vitest';
import type { Conditions, DailyAttemptResponse, DailyResultResponse, DailyView, MatchEventLog, NextBallResponse, SealedSixEngineApi, ShotResponse } from '@/contracts';
import { createLocalBackend } from '../local/harness';
import { Player, T0 } from './helpers';

const real: SealedSixEngineApi | null = await import('@/engine')
  .then((m) => {
    const e = m.engine as SealedSixEngineApi;
    const conditions: Conditions = { pitch: 'hard', weather: 'clear' };
    const plan = e.autoOver('probe', conditions);
    e.revealDelivery(plan, 0, conditions);
    return e;
  })
  .catch(() => null);

describe.skipIf(!real)('with the real engine', () => {
  it("Auto XI at the batting deadline uses the engine's key, so the reveal labels exactly its balls", async () => {
    const engine = real as SealedSixEngineApi;
    const { autoXiBalls, autoXiSeed } = await import('@/engine');
    expect(autoXiSeed('s33d', 1, 4)).toBe('s33d:auto-xi:1:4');
    const b = await createLocalBackend({ engine, now: T0 });
    const a = new Player(b);
    const c = new Player(b);
    await a.signup();
    await c.signup();
    const d = await a.call<{ matchId: string; inviteToken: string }>('POST', '/v1/duels', { conditions: { pitch: 'hard', weather: 'clear' } });
    await c.call('POST', `/v1/invites/${d.body.inviteToken}/accept`);
    const matchId = d.body.matchId;
    for (const [p, key] of [[a, 'plan-a'], [c, 'plan-c']] as const) expect((await p.call('POST', `/v1/matches/${matchId}/lock`, { plan: engine.autoOver(key, { pitch: 'hard', weather: 'clear' }) })).status).toBe(200);
    // A bats the whole innings; C bats two balls of their own, then never comes back.
    const bat = async (p: Player, balls: number) => {
      for (let i = 0; i < balls; i++) {
        const n = await p.call<NextBallResponse>('POST', `/v1/matches/${matchId}/bat/next`);
        if (n.status !== 200) break;
        const input = engine.autoBat(`human-${i}`, n.body.delivery, n.body.field);
        b.clock.advance(input.clientElapsedMs + 250);
        const s = await p.call<ShotResponse>('POST', `/v1/matches/${matchId}/bat/shot`, { ballToken: n.body.ballToken, input });
        expect(s.status, JSON.stringify(s.body)).toBe(200);
        if (s.body.inningsComplete) break;
      }
    };
    await bat(a, 10);
    await bat(c, 2);
    await b.advance(2 * 24 * 3_600_000);
    const log = await a.call<MatchEventLog>('GET', `/v1/matches/${matchId}/reveal`);
    expect(log.status, JSON.stringify(log.body).slice(0, 200)).toBe(200);
    const cInnings = log.body.innings.findIndex((x) => x.batter === 1);
    const labelled = autoXiBalls(log.body);
    // Exactly the balls the server had Auto XI bat (C's third ball onwards), and none of anyone's own.
    expect(labelled[cInnings]).toEqual(log.body.inputs[cInnings].map((x) => x.ball).filter((ball) => ball >= 2));
    expect(labelled[cInnings].length).toBeGreaterThan(0);
    expect(labelled[1 - cInnings]).toEqual([]);
    expect((await engine.verifyMatchLog(log.body)).ok).toBe(true);
    b.close();
  });

  it('seals, bats and reveals a duel, and the revealed log verifies', async () => {
    const engine = real as SealedSixEngineApi;
    const b = await createLocalBackend({ engine, now: T0 });
    const a = new Player(b);
    const c = new Player(b);
    await a.signup();
    await c.signup();
    const d = await a.call<{ matchId: string; inviteToken: string }>('POST', '/v1/duels', { conditions: { pitch: 'slow', weather: 'dew' } });
    await c.call('POST', `/v1/invites/${d.body.inviteToken}/accept`);
    const matchId = d.body.matchId;
    for (const [p, seed] of [[a, 'plan-a'], [c, 'plan-c']] as const) {
      const lock = await p.call('POST', `/v1/matches/${matchId}/lock`, { plan: engine.autoOver(seed, { pitch: 'slow', weather: 'dew' }) });
      expect(lock.status, JSON.stringify(lock.body)).toBe(200);
    }
    for (const p of [a, c]) {
      for (let i = 0; i < 10; i++) {
        const n = await p.call<NextBallResponse>('POST', `/v1/matches/${matchId}/bat/next`);
        if (n.status !== 200) break;
        const input = engine.autoBat(`bat-${i}`, n.body.delivery);
        b.clock.advance(input.clientElapsedMs + 250); // the time the answer really takes, plus the network
        const s = await p.call<{ inningsComplete: boolean }>('POST', `/v1/matches/${matchId}/bat/shot`, { ballToken: n.body.ballToken, input });
        expect(s.status, JSON.stringify(s.body)).toBe(200);
        if (s.body.inningsComplete) break;
      }
    }
    const log = await a.call<MatchEventLog>('GET', `/v1/matches/${matchId}/reveal`);
    expect(log.status, JSON.stringify(log.body).slice(0, 300)).toBe(200);
    expect((await engine.verifyMatchLog(log.body)).ok).toBe(true);
    const stored = (await b.matches.storage(matchId).get<Uint8Array>(['log'])).get('log');
    console.info(`[real engine replay] JSON ${JSON.stringify(log.body).length} bytes, stored gzip ${stored?.byteLength} bytes`);
    b.close();
  });

  it('an official duel unlocks what the bowler earned (with a room card), and the next lock may use it', async () => {
    const engine = real as SealedSixEngineApi;
    const { unlocksEarned } = await import('@/engine/advice');
    const b = await createLocalBackend({ engine, now: T0 });
    const a = new Player(b);
    const c = new Player(b);
    await a.signup('Swift Tiger');
    await c.signup('Calm Cobra');
    const conditions: Conditions = { pitch: 'hard', weather: 'clear' };
    const duel = async () => {
      const d = await a.call<{ matchId: string; inviteToken: string }>('POST', '/v1/duels', { conditions });
      expect((await c.call('POST', `/v1/invites/${d.body.inviteToken}/accept`)).status).toBe(200);
      return d.body.matchId;
    };
    // An over that uses a delivery only an unlock allows (any of the four, whichever the engine's plan accepts).
    const lockedPlan = (variant: string) => {
      const base = engine.autoOver('unlock-probe', conditions) as unknown as { balls: Array<{ variant: string; length: string; intensity: number }> };
      for (let i = 0; i < base.balls.length; i++) {
        for (const length of ['good', 'full', 'short']) {
          for (const intensity of [1, 2]) {
            const plan = JSON.parse(JSON.stringify(base)) as typeof base;
            Object.assign(plan.balls[i], { variant, length, intensity });
            if (engine.validatePlan(plan as never, [variant] as never).ok && !engine.validatePlan(plan as never, [] as never).ok) return plan;
          }
        }
      }
      return null;
    };
    const first = await duel();
    // A new player has only the starters: every unlockable delivery is refused.
    for (const v of ['slower', 'inswing', 'outswing', 'legspin']) {
      const locked = lockedPlan(v);
      if (locked) expect((await a.call('POST', `/v1/matches/${first}/lock`, { plan: locked })).status, v).toBe(400);
    }
    for (const [p, key] of [[a, 'plan-a'], [c, 'plan-c']] as const) expect((await p.call('POST', `/v1/matches/${first}/lock`, { plan: engine.autoOver(key, conditions) })).status).toBe(200);
    // A bats; C leaves every ball of A's over, so A's over is a tight one (and may take wickets).
    const bat = async (p: Player, leave: boolean) => {
      for (let i = 0; i < 10; i++) {
        const n = await p.call<NextBallResponse>('POST', `/v1/matches/${first}/bat/next`);
        if (n.status !== 200) break;
        const auto = engine.autoBat(`bat-${i}`, n.body.delivery, n.body.field);
        const input = leave ? { ...auto, shot: 'leave', zone: null, tapMs: null, trace: { ...auto.trace, samples: [] } } : auto;
        b.clock.advance(auto.clientElapsedMs + 250);
        const s = await p.call<ShotResponse>('POST', `/v1/matches/${first}/bat/shot`, { ballToken: n.body.ballToken, input });
        expect(s.status, JSON.stringify(s.body)).toBe(200);
        if (s.body.inningsComplete) break;
      }
    };
    await bat(a, false);
    await bat(c, true);
    await b.idle();
    const log = (await a.call<MatchEventLog>('GET', `/v1/matches/${first}/reveal`)).body;
    const earned = unlocksEarned(log, 0);
    expect(earned.length).toBeGreaterThan(0);
    const plan = lockedPlan(earned[0]);
    expect(plan).not.toBeNull();
    const me = (await a.call<{ unlocks: string[] }>('GET', '/v1/me')).body;
    expect(me.unlocks).toEqual(expect.arrayContaining(earned));
    expect([...(await c.call<{ unlocks: string[] }>('GET', '/v1/me')).body.unlocks].sort()).toEqual([...unlocksEarned(log, 1)].sort());
    // …a card in the duel's room celebrates each new one…
    const roomId = (await a.view(first)).body.roomId as string;
    const room = (await a.call<{ posts: Array<{ kind: string; payload: Record<string, unknown> }> }>('GET', `/v1/rooms/${roomId}`)).body;
    expect(room.posts.filter((x) => x.kind === 'achievement').map((x) => x.payload)).toEqual(expect.arrayContaining(earned.map((v) => ({ badge: `unlock_${v}`, alias: 'Swift Tiger' }))));
    // …and the next lock accepts it.
    const next = await duel();
    const lock = await a.call('POST', `/v1/matches/${next}/lock`, { plan });
    expect(lock.status, JSON.stringify(lock.body)).toBe(200);
    // C earned nothing it can use here: the same plan is refused for C.
    if (!unlocksEarned(log, 1).includes(earned[0])) expect((await c.call('POST', `/v1/matches/${next}/lock`, { plan })).status).toBe(400);
    b.close();
  });

  it('plays a Daily Six attempt: the engine builds the replay, it verifies, and its commit is the one published', async () => {
    const engine = real as SealedSixEngineApi;
    const b = await createLocalBackend({ engine, now: T0 });
    const p = new Player(b);
    await p.signup();
    const day = (await p.call<DailyView>('GET', '/v1/daily')).body;
    expect(day.overCommits).toHaveLength(3);
    const a = (await p.call<DailyAttemptResponse>('POST', '/v1/daily/attempts')).body;
    for (let i = 0; i < 10; i++) {
      const n = await p.call<NextBallResponse>('POST', `/v1/daily/attempts/${a.attemptId}/next`);
      if (n.status !== 200) break;
      if (i === 2) {
        b.clock.advance(11 * 60_000); // never answered: settles as a leave, the next ball stays aligned
        continue;
      }
      const input = engine.autoBat(`daily-${i}`, n.body.delivery, n.body.field);
      b.clock.advance(input.clientElapsedMs + 250);
      const s = await p.call<ShotResponse>('POST', `/v1/daily/attempts/${a.attemptId}/shot`, { ballToken: n.body.ballToken, input });
      expect(s.status, JSON.stringify(s.body)).toBe(200);
      if (s.body.inningsComplete) break;
    }
    const r = await p.call<DailyResultResponse>('GET', `/v1/daily/attempts/${a.attemptId}/result`);
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(r.body.log.kind).toBe('daily');
    expect(r.body.log.commits[1].hash).toBe(day.overCommits[0]);
    expect(r.body.log.result.dailyScore).toBe(r.body.score);
    expect(r.body.log.result.marginRuns).toBe(0);
    // No Super Ball in a Daily Six attempt: six balls, then the reveal.
    expect(r.body.log.events.some((e) => e.t === 'ball' && e.innings === 'super')).toBe(false);
    expect(await engine.verifyMatchLog(r.body.log)).toEqual({ ok: true });
    b.close();
  });
});
