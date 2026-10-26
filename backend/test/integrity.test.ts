// @vitest-environment node
/**
 * Integrity signals for the Top 100 and the Daily Six boards: the engine's timing audit flags machine-perfect tapping
 * (a flag, never a block) and is stored with the per-innings late answers and missed balls (shown, then settled as
 * leaves: expired, invalid or still waiting at the batting deadline); Auto XI bats with the bowler's field.
 */
import { describe, expect, it, vi } from 'vitest';
import type { DailyAttemptResponse, DailyResultResponse, DailyView, FieldSetting, LeaderboardView, MatchView, NextBallResponse, SealedSixEngineApi, ShotResponse } from '@/contracts';
import { MAX_INVALID_SHOTS } from '../src/config';
import { fakeEngine, testPlan, testShot } from './fakeEngine';
import { advanceTo, backend, duel, Player } from './helpers';

type Plan = 'skip' | 'invalid' | 'late' | undefined;

/**
 * Bats an innings (a duel's, or a Daily Six attempt's with `daily`) ball by ball: 'skip' leaves the ball unanswered
 * past the late window (the app closed on it), 'invalid' sends garbage until it settles, 'late' delivers a shot made
 * in time three minutes later (queued offline); anything else is answered at once.
 */
async function batWith(p: Player, id: string, plans: Record<number, Plan>, daily = false): Promise<number[]> {
  const base = daily ? `/v1/daily/attempts/${id}` : `/v1/matches/${id}/bat`;
  const balls: number[] = [];
  for (let i = 0; i < 12; i++) {
    const n = await p.call<NextBallResponse>('POST', `${base}/next`);
    if (n.status !== 200) break;
    const ball = n.body.delivery.ball;
    balls.push(ball);
    const plan = plans[ball];
    if (plan === 'skip') {
      p.b.clock.advance(11 * 60_000);
      continue;
    }
    if (plan === 'invalid') {
      for (let k = 0; k < MAX_INVALID_SHOTS; k++) expect((await p.call('POST', `${base}/shot`, { ballToken: n.body.ballToken, input: { v: 1, nonsense: k } })).status).toBe(400);
      continue;
    }
    p.b.clock.advance(plan === 'late' ? 3 * 60_000 : 1_000);
    const s = await p.call<ShotResponse>('POST', `${base}/shot`, { ballToken: n.body.ballToken, input: testShot(n.body.delivery, 40) });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    if (s.body.inningsComplete) break;
  }
  return balls;
}

async function batWithOffsets(p: Player, matchId: string, offsets: number[]): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const n = await p.call<NextBallResponse>('POST', `/v1/matches/${matchId}/bat/next`);
    if (n.status !== 200) break;
    p.b.clock.advance(1_000);
    const s = await p.call<ShotResponse>('POST', `/v1/matches/${matchId}/bat/shot`, { ballToken: n.body.ballToken, input: testShot(n.body.delivery, offsets[i % offsets.length]) });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    if (s.body.inningsComplete) break;
  }
}

describe('timing audit', () => {
  it('flags a bot-like innings in match_results (with the late count) but still plays and reveals it', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    expect((await a.lock(matchId, 1)).status).toBe(200);
    expect((await c.lock(matchId, 2)).status).toBe(200);
    await batWithOffsets(a, matchId, [0, 1, -2, 0, 2, -1, 0]); // within ±3 ms of the ideal contact every time
    await batWithOffsets(c, matchId, [45, -30, 60, 15, -55, 35, 25]); // human scatter
    expect((await a.call('GET', `/v1/matches/${matchId}/reveal`)).status).toBe(200);
    const row = await b.db.prepare('SELECT late0, late1, suspect0, suspect1 FROM match_results WHERE match_id = ?1').bind(matchId).first();
    expect(row).toEqual({ late0: 0, late1: 0, suspect0: 1, suspect1: 0 });
    expect(b.metrics.total('timing_suspicious')).toBe(1);
    b.close();
  });

  it('stores the flag and the late count of the best Daily Six attempt', async () => {
    const b = await backend();
    const { a } = await duel(b);
    const at = (await a.call<{ attemptId: string }>('POST', '/v1/daily/attempts')).body;
    for (let i = 0; i < 10; i++) {
      const n = await a.call<NextBallResponse>('POST', `/v1/daily/attempts/${at.attemptId}/next`);
      if (n.status !== 200) break;
      // Ball 1 is answered offline and delivered late (still inside the late window).
      a.b.clock.advance(i === 1 ? 5 * 60_000 : 1_000);
      const s = await a.call<ShotResponse>('POST', `/v1/daily/attempts/${at.attemptId}/shot`, { ballToken: n.body.ballToken, input: testShot(n.body.delivery, 0) });
      expect(s.status).toBe(200);
      if (s.body.inningsComplete) break;
    }
    expect((await a.call('GET', `/v1/daily/attempts/${at.attemptId}/result`)).status).toBe(200);
    const row = await b.db.prepare('SELECT late, suspect FROM daily_scores').first();
    expect(row).toEqual({ late: 1, suspect: 1 });
    b.close();
  });
});

describe('Auto XI', () => {
  it("bats with the bowler's field", async () => {
    const fields: Array<FieldSetting | undefined> = [];
    const spy: SealedSixEngineApi = { ...fakeEngine, autoBat: vi.fn((seed: string, d, f?: FieldSetting) => (fields.push(f), fakeEngine.autoBat(seed, d, f))) };
    const b = await backend({ engine: spy });
    const { a, c, matchId } = await duel(b);
    expect((await a.call('POST', `/v1/matches/${matchId}/lock`, { plan: { ...testPlan(1), field: 'sweeper' } })).status).toBe(200);
    expect((await c.call('POST', `/v1/matches/${matchId}/lock`, { plan: { ...testPlan(2), field: 'attacking' } })).status).toBe(200);
    await a.batInnings(matchId, 20);
    // c never bats: Auto XI plays c's innings against a's over at the batting deadline.
    await advanceTo(b, b.clock.now() + 49 * 3_600_000);
    expect(fields.length).toBeGreaterThanOrEqual(7);
    expect(new Set(fields)).toEqual(new Set(['sweeper']));
    b.close();
  });
});

describe('missed balls', () => {
  it('a ball shown and not answered in time is counted per innings, apart from the late answers', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    await a.lock(matchId, 1);
    await c.lock(matchId, 2);
    // a closes the app on ball 1 and sends garbage on ball 3; c's ball 4 arrives late from the offline queue.
    await batWith(a, matchId, { 1: 'skip', 3: 'invalid' });
    await batWith(c, matchId, { 4: 'late' });
    expect((await a.call('GET', `/v1/matches/${matchId}/reveal`)).status).toBe(200);
    const row = await b.db.prepare('SELECT late0, late1, missed0, missed1 FROM match_results WHERE match_id = ?1').bind(matchId).first();
    expect(row).toEqual({ late0: 0, late1: 1, missed0: 2, missed1: 0 });
    b.close();
  });

  it('a ball still waiting at the batting deadline counts as missed too', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    await a.lock(matchId, 1);
    await c.lock(matchId, 2);
    await a.batInnings(matchId, 40);
    const batBy = Date.parse((await c.view(matchId)).body.deadlines.batBy);
    await advanceTo(b, batBy - 2 * 60_000);
    expect((await c.next(matchId)).status).toBe(200);
    await advanceTo(b, batBy + 2 * 60_000); // inside the late window, so only the deadline settles it
    const row = await b.db.prepare('SELECT missed0, missed1, auto1 FROM match_results WHERE match_id = ?1').bind(matchId).first();
    expect(row).toEqual({ missed0: 0, missed1: 1, auto1: 1 });
    b.close();
  });

  it('Daily Six: over the limit the attempt is used and keeps the streak, but never reaches the boards', async () => {
    const b = await backend();
    const p = new Player(b);
    await p.signup('Bold Comet');
    const first = (await p.call<DailyAttemptResponse>('POST', '/v1/daily/attempts')).body;
    // One missed ball and one late answer: two irregular balls in one innings.
    await batWith(p, first.attemptId, { 1: 'skip', 4: 'late' }, true);
    const r1 = await p.call<DailyResultResponse>('GET', `/v1/daily/attempts/${first.attemptId}/result`);
    expect(r1.status).toBe(200);
    // Nothing has counted yet: no best score.
    expect(r1.body).toMatchObject({ counted: false, bestScore: null });
    expect(b.db.db.prepare('SELECT COUNT(*) AS n FROM daily_scores').get()).toEqual({ n: 0 });
    expect(b.metrics.total('daily_uncounted')).toBe(1);
    expect((await p.call<DailyView>('GET', '/v1/daily')).body).toMatchObject({ attemptsUsed: 1, bestScore: null, streak: 1 });
    expect((await p.call<LeaderboardView>('GET', '/v1/leaderboards/national')).body).toMatchObject({ entries: [], me: null, total: 0 });
    // One missed ball is within the rule: that attempt counts and is the day's best.
    const second = (await p.call<DailyAttemptResponse>('POST', '/v1/daily/attempts')).body;
    await batWith(p, second.attemptId, { 2: 'skip' }, true);
    const r2 = (await p.call<DailyResultResponse>('GET', `/v1/daily/attempts/${second.attemptId}/result`)).body;
    expect(r2).toMatchObject({ counted: true, bestScore: r2.score });
    // Looking at the uncounted attempt again: the day's best is the counted one, never its own score.
    expect((await p.call<DailyResultResponse>('GET', `/v1/daily/attempts/${first.attemptId}/result`)).body).toMatchObject({ counted: false, bestScore: r2.score });
    expect(b.db.db.prepare('SELECT best_score, late, missed FROM daily_scores').get()).toEqual({ best_score: r2.score, late: 0, missed: 1 });
    const board = (await p.call<LeaderboardView>('GET', '/v1/leaderboards/national')).body;
    expect(board).toMatchObject({ total: 1, me: { rank: 1, score: r2.score } });
    expect(b.metrics.total('daily_uncounted')).toBe(1);
    b.close();
  });

  it('Daily Six: three invalid answers on a ball are a missed ball as well', async () => {
    const b = await backend();
    const p = new Player(b);
    await p.signup('Calm Storm');
    const at = (await p.call<DailyAttemptResponse>('POST', '/v1/daily/attempts')).body;
    await batWith(p, at.attemptId, { 0: 'invalid', 5: 'invalid' }, true);
    expect((await p.call<MatchView>('GET', `/v1/matches/${at.attemptId}`)).body.phase).toBe('revealed');
    expect(b.db.db.prepare('SELECT COUNT(*) AS n FROM daily_scores').get()).toEqual({ n: 0 });
    b.close();
  });
});
