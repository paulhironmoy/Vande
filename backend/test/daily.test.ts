// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { DailyAttemptResponse, DailyResultResponse, DailyView, LeaderboardView, MatchView, NextBallResponse, SealedSixEngineApi, ShotResponse } from '@/contracts';
import { dailySalt } from '../src/daily/salt';
import { MemoryLogger } from '../src/http/log';
import { fakeDailyCommits, fakeEngine, testShot } from './fakeEngine';
import { Player, T0, advanceTo, backend, duel } from './helpers';

const IST_MIDNIGHT_AFTER_T0 = Date.UTC(2026, 9, 26, 18, 30);
const DAY = 86_400_000;

async function start(p: Player) {
  return p.call<DailyAttemptResponse>('POST', '/v1/daily/attempts');
}

/** Bats a whole attempt; `offset` shifts every tap (0 is perfect timing). */
async function play(p: Player, attemptId: string, offset = 0, shot: 'drive' | 'defend' | 'loft' = 'drive'): Promise<ShotResponse[]> {
  const out: ShotResponse[] = [];
  for (let i = 0; i < 9; i++) {
    const n = await p.call<NextBallResponse>('POST', `/v1/daily/attempts/${attemptId}/next`);
    if (n.status !== 200) break;
    p.b.clock.advance(1_000);
    const s = await p.call<ShotResponse>('POST', `/v1/daily/attempts/${attemptId}/shot`, { ballToken: n.body.ballToken, input: testShot(n.body.delivery, offset, shot) });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    out.push(s.body);
    if (s.body.inningsComplete) break;
  }
  return out;
}

async function playFull(p: Player, offset = 0, shot: 'drive' | 'defend' | 'loft' = 'drive'): Promise<DailyResultResponse> {
  const a = await start(p);
  expect([200, 201]).toContain(a.status);
  await play(p, a.body.attemptId, offset, shot);
  const r = await p.call<DailyResultResponse>('GET', `/v1/daily/attempts/${a.body.attemptId}/result`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}

describe('Daily Six', () => {
  it('shows the IST day, its conditions and the reset at 00:00 IST', async () => {
    const b = await backend();
    const p = new Player(b);
    await p.signup();
    const v = await p.call<DailyView>('GET', '/v1/daily');
    const { overCommits, ...rest } = v.body;
    expect(rest).toEqual({ day: '2026-10-26', conditions: { pitch: 'hard', weather: 'clear' }, attemptsUsed: 0, attemptsMax: 3, bestScore: null, streak: 0, resetsAt: '2026-10-26T18:30:00.000Z' });
    // The three sealed overs' commits, published when the day opens: hashes only, never their salts.
    const salt = await dailySalt(b.env, new MemoryLogger());
    expect(overCommits).toEqual(fakeDailyCommits('2026-10-26', salt).map((c) => c.hash));
    expect(JSON.stringify(v.body)).not.toContain(salt);
    for (const c of fakeDailyCommits('2026-10-26', salt)) expect(JSON.stringify(v.body)).not.toContain(c.salt);
    b.close();
  });

  it('salts the overs with a server secret: the client cannot compute them, every day differs, the salt never leaves', async () => {
    const calls: Array<[string, string | undefined]> = [];
    const spy: SealedSixEngineApi = { ...fakeEngine, dailyChallenge: vi.fn((day: string, salt?: string) => (calls.push([day, salt]), fakeEngine.dailyChallenge(day, salt))) };
    const b = await backend({ engine: spy });
    const p = new Player(b);
    await p.signup();
    const r = await playFull(p, 40);
    await advanceTo(b, IST_MIDNIGHT_AFTER_T0 + 60_000);
    await p.call<DailyView>('GET', '/v1/daily');
    const salt = await dailySalt(b.env, new MemoryLogger());
    expect(salt).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(calls.map((c) => c[1]))).toEqual(new Set([salt]));
    expect(new Set(calls.map((c) => c[0]))).toEqual(new Set(['2026-10-26', '2026-10-27']));
    // Without the salt (what a client could compute from the open engine) the over is a different one.
    expect(fakeEngine.dailyChallenge('2026-10-26').overs[0]).not.toEqual(r.log.plans[1]);
    expect(fakeEngine.dailyChallenge('2026-10-27', salt).overs[0]).not.toEqual(fakeEngine.dailyChallenge('2026-10-26', salt).overs[0]);
    expect(JSON.stringify(r)).not.toContain(salt);
    // Another deployment (another key) has other overs.
    const b2 = await backend({ engine: spy });
    expect(await dailySalt(b2.env, new MemoryLogger())).not.toBe(salt);
    b.close();
    b2.close();
  });

  it('fails closed without the salt key or the engine helper', async () => {
    for (const opts of [{ vars: { DAILY_SALT_KEY: '' } }, { vars: { DAILY_SALT_KEY: 'too-short' } }, { helpers: { dailyCommits: undefined } }]) {
      const b = await backend(opts);
      const p = new Player(b);
      await p.signup();
      expect((await p.call('GET', '/v1/daily')).status).toBe(503);
      expect((await start(p)).status).toBe(503);
      b.close();
    }
  });

  it('replays verify: the engine builds the log, its commit is the published over commit, unanswered balls stay aligned', async () => {
    const b = await backend();
    const p = new Player(b);
    await p.signup();
    const day = (await p.call<DailyView>('GET', '/v1/daily')).body;
    const a = (await start(p)).body;
    const view = (await p.call<MatchView>('GET', `/v1/matches/${a.attemptId}`)).body;
    expect(view.opponentCommit).toBe(day.overCommits[0]);
    expect(view.roomId).toBeNull();
    // Answer balls 0, 2 and 4 only; 1, 3 and 5 time out as leaves.
    for (let i = 0; i < 9; i++) {
      const n = await p.call<NextBallResponse>('POST', `/v1/daily/attempts/${a.attemptId}/next`);
      if (n.status !== 200) break;
      if (n.body.delivery.ball % 2 === 1) {
        p.b.clock.advance(11 * 60_000);
        continue;
      }
      p.b.clock.advance(1_000);
      const s = await p.call<ShotResponse>('POST', `/v1/daily/attempts/${a.attemptId}/shot`, { ballToken: n.body.ballToken, input: testShot(n.body.delivery, 30) });
      if (s.body.inningsComplete) break;
    }
    const r = (await p.call<DailyResultResponse>('GET', `/v1/daily/attempts/${a.attemptId}/result`)).body;
    expect(r.log.commits[1].hash).toBe(day.overCommits[0]);
    expect(r.log.commits[1].salt).toMatch(/^[0-9a-f]{32}$/);
    expect(r.log.commits[1].sig).not.toBe('');
    expect(r.log.inputs[0].map((i) => i.ball)).toEqual(expect.arrayContaining([0, 2, 4]));
    expect(r.log.inputs[0].some((i) => i.ball % 2 === 1 && i.ball < 6)).toBe(false);
    expect(await fakeEngine.verifyMatchLog(r.log)).toEqual({ ok: true });
    b.close();
  });

  it('an attempt is the six balls of the over: no Super Ball, the sixth answer completes it and the reveal follows', async () => {
    const b = await backend();
    const p = new Player(b);
    await p.signup();
    const a = (await start(p)).body;
    const left: number[] = [];
    const done: boolean[] = [];
    for (let i = 0; i < 9; i++) {
      const n = await p.call<NextBallResponse>('POST', `/v1/daily/attempts/${a.attemptId}/next`);
      if (n.status !== 200) break;
      left.push(n.body.ballsLeft);
      b.clock.advance(1_000);
      const s = await p.call<ShotResponse>('POST', `/v1/daily/attempts/${a.attemptId}/shot`, { ballToken: n.body.ballToken, input: testShot(n.body.delivery, 40) });
      done.push(s.body.inningsComplete);
    }
    expect(left).toEqual([5, 4, 3, 2, 1, 0]);
    expect(done).toEqual([false, false, false, false, false, true]);
    const after = await p.call<{ error: { code: string } }>('POST', `/v1/daily/attempts/${a.attemptId}/next`);
    expect(after.status).toBe(409);
    expect((await p.call<MatchView>('GET', `/v1/matches/${a.attemptId}`)).body).toMatchObject({ phase: 'revealed', myBallsFaced: 6 });
    const r = (await p.call<DailyResultResponse>('GET', `/v1/daily/attempts/${a.attemptId}/result`)).body;
    expect(r.log.result.dailyScore).toBe(r.score);
    expect(r.log.result.marginRuns).toBe(0);
    expect(r.log.inputs[0].map((x) => x.ball)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(r.log.events.some((e) => e.t === 'ball' && e.innings === 'super')).toBe(false);
    b.close();
  });

  it('three attempts a day: an attempt in progress is resumed, a fourth is refused, the best of three counts', async () => {
    const b = await backend();
    const p = new Player(b);
    await p.signup();
    const first = await start(p);
    expect(first.status).toBe(201);
    expect(first.body.attempt).toBe(1);
    const again = await start(p);
    expect(again.status).toBe(200);
    expect(again.body.attemptId).toBe(first.body.attemptId);
    expect((await p.call('GET', `/v1/daily/attempts/${first.body.attemptId}/result`)).status).toBe(409);
    const balls = await play(p, first.body.attemptId, 0);
    expect(balls).toHaveLength(6);
    const r1 = (await p.call<DailyResultResponse>('GET', `/v1/daily/attempts/${first.body.attemptId}/result`)).body;
    expect(r1.log.kind).toBe('daily');
    expect(r1.log.players[1]).toMatchObject({ kind: 'daily', alias: 'Daily Six' });
    expect(r1.log.innings[1].ballsFaced).toBe(0);
    expect(r1.bestScore).toBe(r1.score);
    const r2 = await playFull(p, 300, 'defend');
    const r3 = await playFull(p, 70);
    expect(r3.bestScore).toBe(Math.max(r1.score, r2.score, r3.score));
    const fourth = await start(p);
    expect(fourth.status).toBe(409);
    const v = (await p.call<DailyView>('GET', '/v1/daily')).body;
    expect(v).toMatchObject({ attemptsUsed: 3, bestScore: Math.max(r1.score, r2.score, r3.score), streak: 1 });
    b.close();
  });

  it('is the same challenge for everyone (same over and commit) with a fresh secret seed for every attempt', async () => {
    const b = await backend();
    const p = new Player(b);
    const q = new Player(b);
    await p.signup();
    await q.signup();
    const ap = (await start(p)).body;
    const aq = (await start(q)).body;
    const np = (await p.call<NextBallResponse>('POST', `/v1/daily/attempts/${ap.attemptId}/next`)).body;
    const nq = (await q.call<NextBallResponse>('POST', `/v1/daily/attempts/${aq.attemptId}/next`)).body;
    expect(np.delivery).toEqual(nq.delivery);
    const vp = (await p.call<MatchView>('GET', `/v1/matches/${ap.attemptId}`)).body;
    const vq = (await q.call<MatchView>('GET', `/v1/matches/${aq.attemptId}`)).body;
    expect(vp.kind).toBe('daily');
    expect(vp.opponentCommit).toBe(vq.opponentCommit);
    expect(vp.seedCommit).not.toBe(vq.seedCommit);
    await play(p, ap.attemptId, 20);
    const second = (await start(p)).body;
    expect(second.attempt).toBe(2);
    const v2 = (await p.call<MatchView>('GET', `/v1/matches/${second.attemptId}`)).body;
    expect(v2.seedCommit).not.toBe(vp.seedCommit);
    expect(v2.opponentCommit).not.toBe(vp.opponentCommit);
    // Another player cannot touch my attempt.
    expect((await q.call('POST', `/v1/daily/attempts/${ap.attemptId}/next`)).status).toBe(404);
    expect((await q.call('GET', `/v1/daily/attempts/${ap.attemptId}/result`)).status).toBe(404);
    b.close();
  });

  it('resets at 00:00 IST; streaks grow on consecutive days and restart after a gap', async () => {
    const b = await backend();
    const p = new Player(b);
    await p.signup();
    await playFull(p);
    await advanceTo(b, IST_MIDNIGHT_AFTER_T0 + 60_000);
    let v = (await p.call<DailyView>('GET', '/v1/daily')).body;
    expect(v).toMatchObject({ day: '2026-10-27', attemptsUsed: 0, bestScore: null, streak: 1 });
    await playFull(p);
    expect((await p.call<DailyView>('GET', '/v1/daily')).body.streak).toBe(2);
    await advanceTo(b, IST_MIDNIGHT_AFTER_T0 + 2 * DAY + 60_000);
    expect((await p.call<DailyView>('GET', '/v1/daily')).body.streak).toBe(0);
    await playFull(p);
    v = (await p.call<DailyView>('GET', '/v1/daily')).body;
    expect(v).toMatchObject({ day: '2026-10-29', streak: 1 });
    b.close();
  });

  it('an attempt left open at the reset is finished with leaves and still counts', async () => {
    const b = await backend();
    const p = new Player(b);
    await p.signup();
    const a = (await start(p)).body;
    const n = (await p.call<NextBallResponse>('POST', `/v1/daily/attempts/${a.attemptId}/next`)).body;
    b.clock.advance(1_000);
    await p.call('POST', `/v1/daily/attempts/${a.attemptId}/shot`, { ballToken: n.ballToken, input: testShot(n.delivery, 0) });
    await advanceTo(b, IST_MIDNIGHT_AFTER_T0 + 1_000);
    const r = await p.call<DailyResultResponse>('GET', `/v1/daily/attempts/${a.attemptId}/result`);
    expect(r.status).toBe(200);
    expect(r.body.log.innings[0].balls.slice(1).every((x) => x.timing === 'interrupted')).toBe(true);
    expect(b.db.db.prepare('SELECT finished, current_id FROM daily_attempts').get()).toEqual({ finished: 1, current_id: null });
    expect(b.db.db.prepare('SELECT best_score FROM daily_scores WHERE day = ?').get('2026-10-26')).toEqual({ best_score: r.body.score });
    b.close();
  });
});

describe('Daily Six storage', () => {
  it('an attempt object deletes itself 30 days after its reveal; the score stays in D1', async () => {
    const b = await backend();
    const p = new Player(b);
    await p.signup();
    const r = await playFull(p);
    const id = (b.db.db.prepare('SELECT current_id FROM daily_attempts').get() as { current_id: string | null }).current_id;
    expect(id).toBeNull();
    const names = b.matches.names();
    expect(names).toHaveLength(1);
    expect(b.matches.storage(names[0]).data.size).toBeGreaterThan(0);
    await advanceTo(b, b.clock.now() + 31 * DAY);
    expect(b.matches.storage(names[0]).data.size).toBe(0);
    expect((await p.call('GET', `/v1/daily/attempts/${names[0]}/result`)).status).toBe(404);
    expect(b.db.db.prepare('SELECT best_score FROM daily_scores').get()).toEqual({ best_score: r.score });
    b.close();
  });
});

describe('leaderboards', () => {
  async function scored(b: Awaited<ReturnType<typeof backend>>, alias: string, offset: number, city?: string) {
    const p = new Player(b);
    await p.signup(alias);
    if (city) await p.call('PATCH', '/v1/me', { city });
    const r = await playFull(p, offset, offset > 200 ? 'defend' : 'drive');
    return { p, score: r.score };
  }

  it('national and city boards rank the best scores with shared ties, my rank and the real total', async () => {
    const b = await backend();
    const players = [await scored(b, 'Bold Comet', 0, 'pune'), await scored(b, 'Calm Storm', 0, 'pune'), await scored(b, 'Rapid Viper', 70, 'delhi'), await scored(b, 'Silent Keeper', 400)];
    const national = (await players[3].p.call<LeaderboardView>('GET', '/v1/leaderboards/national')).body;
    expect(national.total).toBe(4);
    expect(national.entries).toHaveLength(4);
    const sorted = [...players].sort((x, y) => y.score - x.score);
    expect(national.entries.map((e) => e.score)).toEqual(sorted.map((x) => x.score));
    for (let i = 1; i < national.entries.length; i++) {
      const e = national.entries[i];
      const prev = national.entries[i - 1];
      expect(e.rank).toBe(e.score === prev.score ? prev.rank : i + 1);
    }
    const myRank = 1 + players.filter((x) => x.score > players[3].score).length;
    expect(national.me).toMatchObject({ isMe: true, rank: myRank, score: players[3].score });
    const pune = (await players[0].p.call<LeaderboardView>('GET', '/v1/leaderboards/city')).body;
    expect(pune.total).toBe(2);
    expect(pune.entries.map((e) => e.alias).sort()).toEqual(['Bold Comet', 'Calm Storm']);
    const noCity = (await players[3].p.call<LeaderboardView>('GET', '/v1/leaderboards/city')).body;
    expect(noCity).toMatchObject({ entries: [], total: 0 });
    expect(JSON.stringify(national)).not.toMatch(/"uid"|"u[a-z2-7]{26}"/);
    b.close();
  });

  it('college and company boards are for members of that group only', async () => {
    const b = await backend();
    const a = await scored(b, 'Bold Comet', 0);
    const c = await scored(b, 'Calm Storm', 70);
    const outsider = await scored(b, 'Rapid Viper', 0);
    const g = (await a.p.call<{ groupId: string; code: string }>('POST', '/v1/groups', { kind: 'college', name: 'Anna University' })).body;
    await c.p.call('POST', '/v1/groups/join', { code: g.code });
    const board = await c.p.call<LeaderboardView>('GET', `/v1/leaderboards/college?groupId=${g.groupId}`);
    expect(board.status).toBe(200);
    expect(board.body.entries.map((e) => e.alias).sort()).toEqual(['Bold Comet', 'Calm Storm']);
    expect(board.body).toMatchObject({ total: 2, groupId: g.groupId });
    expect((await outsider.p.call('GET', `/v1/leaderboards/college?groupId=${g.groupId}`)).status).toBe(403);
    expect((await a.p.call('GET', `/v1/leaderboards/company?groupId=${g.groupId}`)).status).toBe(403);
    expect((await a.p.call('GET', '/v1/leaderboards/college')).status).toBe(400);
    b.close();
  });

  it('friends are the players you finished a duel with', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    await a.lock(matchId, 1);
    await c.lock(matchId, 2);
    await a.batInnings(matchId);
    await c.batInnings(matchId);
    const stranger = await scored(b, 'Rapid Viper', 0);
    await playFull(a);
    await playFull(c, 70);
    const board = (await a.call<LeaderboardView>('GET', '/v1/leaderboards/friends')).body;
    expect(board.entries.map((e) => e.alias).sort()).toEqual(['Calm Cobra', 'Swift Tiger']);
    expect(board.total).toBe(2);
    expect(board.entries.some((e) => e.playerId === stranger.p.tokens!.playerId)).toBe(false);
    b.close();
  });

  it('validates the day and the scope', async () => {
    const b = await backend();
    const p = await scored(b, 'Bold Comet', 0);
    expect((await p.p.call('GET', '/v1/leaderboards/national?day=2026-10-27')).status).toBe(400);
    expect((await p.p.call('GET', '/v1/leaderboards/national?day=2026-08-01')).status).toBe(400);
    expect((await p.p.call('GET', '/v1/leaderboards/national?day=2026-10-25')).status).toBe(200);
    expect((await p.p.call('GET', '/v1/leaderboards/galaxy')).status).toBe(404);
    expect(T0).toBeLessThan(IST_MIDNIGHT_AFTER_T0);
    b.close();
  });
});
