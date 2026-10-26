// @vitest-environment node
/**
 * Ratings after every reveal and the Daily Top 100 cutoff: ranking with src/engine/ranking.ts, frozen days only,
 * the permanent badge, one highlight job per best match, and idempotency when the cutoff repeats or races.
 */
import { describe, expect, it } from 'vitest';
import type { NextBallResponse, Profile, ShotResponse, Top100Entry } from '@/contracts';
import { matchEligibility, TOP100 } from '@/engine/ranking';
import { MAX_IRREGULAR_BALLS } from '../src/config';
import type { DayResultRow } from '../src/highlights/jobs';
import { DAILY_CUTOFF_CRON } from '../src/ops/cron';
import { playerDays } from '../src/top100/cutoff';
import { testShot } from './fakeEngine';
import { CUTOFF_1, DAY1, freeze, mine, playDuel, players, row, sweep } from './highlightHelpers';
import { advanceTo, backend, type Player } from './helpers';

/** A complete duel where `skipHome` lists the home batter's balls left unanswered until they expire. */
async function duelSkipping(home: Player, away: Player, skipHome: number[]): Promise<string> {
  const created = await home.call<{ matchId: string; inviteToken: string }>('POST', '/v1/duels', { conditions: { pitch: 'hard', weather: 'clear' } });
  const matchId = created.body.matchId;
  await away.call('POST', `/v1/invites/${created.body.inviteToken}/accept`);
  await home.lock(matchId, 1);
  await away.lock(matchId, 2);
  for (let i = 0; i < 12; i++) {
    const n = await home.call<NextBallResponse>('POST', `/v1/matches/${matchId}/bat/next`);
    if (n.status !== 200) break;
    if (skipHome.includes(n.body.delivery.ball)) {
      home.b.clock.advance(11 * 60_000);
      continue;
    }
    home.b.clock.advance(1_000);
    const s = await home.call<ShotResponse>('POST', `/v1/matches/${matchId}/bat/shot`, { ballToken: n.body.ballToken, input: testShot(n.body.delivery, 40) });
    if (s.body.inningsComplete) break;
  }
  await away.batInnings(matchId, 300);
  await home.b.idle();
  return matchId;
}

function resultRow(over: Partial<DayResultRow>): DayResultRow {
  return {
    match_id: 'm1', kind: 'duel', cup_id: null, stage: null, revealed_ms: 1, uid0: 'u0', uid1: 'u1', winner: 0, runs0: 12, wickets0: 0, runs1: 6, wickets1: 1,
    late0: 0, late1: 0, missed0: 0, missed1: 0, auto0: 0, auto1: 0, suspect0: 0, suspect1: 0, r0: 1200, r1: 1200,
    te0: 0.8, cl0: 0.6, ex0: 0.7, te1: 0.75, cl1: 0.5, ex1: 0.6,
    pid0: 'p0', alias0: 'Swift Tiger', avatar0: 'a1234567', st0: 'active', ef0: null, rm0: 0, loc0: 'en',
    pid1: 'p1', alias1: 'Calm Cobra', avatar1: 'b1234567', st1: 'active', ef1: null, rm1: 0, loc1: 'en',
    ...over,
  };
}

describe('ratings', () => {
  it('move once per rated duel (winner up, loser down) and never for an Auto side', async () => {
    const b = await backend();
    const [a, c, d] = await players(b, 3);
    const m1 = await playDuel(a, c, [40, 300]);
    const r = await row<{ winner: number; rated: number; d0: number; d1: number; r0: number; r1: number }>(b, 'SELECT winner, rated, d0, d1, r0, r1 FROM match_results WHERE match_id = ?1', m1);
    expect(r).toMatchObject({ rated: 1, r0: 1200, r1: 1200 });
    const winner = r!.winner === 0 ? a : c;
    const loser = r!.winner === 0 ? c : a;
    const pw = (await winner.call<Profile>('GET', '/v1/me')).body;
    const pl = (await loser.call<Profile>('GET', '/v1/me')).body;
    expect(pw.rating).toBe(1220);
    expect(pl.rating).toBe(1180);
    // Recording the same result again (a retried sync) changes nothing.
    await b.db.prepare("INSERT INTO match_results (match_id, kind, day, revealed_ms, uid0, uid1, runs0, wickets0, runs1, wickets1, winner, late0, late1, auto0, auto1, rated, d0, d1) SELECT match_id, kind, day, revealed_ms, uid0, uid1, runs0, wickets0, runs1, wickets1, winner, late0, late1, auto0, auto1, rated, d0, d1 FROM match_results WHERE match_id = ?1 ON CONFLICT(match_id) DO NOTHING").bind(m1).run();
    expect((await winner.call<Profile>('GET', '/v1/me')).body.rating).toBe(1220);
    // d never bats: Auto XI plays its innings, so the match is not rated.
    const created = await a.call<{ matchId: string; inviteToken: string }>('POST', '/v1/duels', {});
    await d.call('POST', `/v1/invites/${created.body.inviteToken}/accept`);
    await a.lock(created.body.matchId, 1);
    await d.lock(created.body.matchId, 2);
    await a.batInnings(created.body.matchId, 40);
    await advanceTo(b, b.clock.now() + 49 * 3_600_000);
    expect(await row(b, 'SELECT rated, auto1 FROM match_results WHERE match_id = ?1', created.body.matchId)).toEqual({ rated: 0, auto1: 1 });
    expect((await d.call<Profile>('GET', '/v1/me')).body.rating).toBe(1200);
    b.close();
  });
});

describe('Daily Top 100 cutoff', () => {
  it('ranks the IST day that ended, freezes it, awards the permanent badge and creates one job per best match', async () => {
    const b = await backend();
    const [a, c, d, e] = await players(b, 4);
    await playDuel(a, c, [40, 300]);
    await playDuel(d, e, [60, 280]);
    await playDuel(a, d, [40, 260]);
    // Before the cutoff: an honest "decided at midnight", never a provisional list.
    const early = await a.call<{ error: { code: string } }>('GET', `/v1/top100/${DAY1}`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('sealed');
    expect(early.headers.get('x-decided-at')).toBe(new Date(CUTOFF_1).toISOString());
    await freeze(b);
    const list = await a.call<Top100Entry[]>('GET', `/v1/top100/${DAY1}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThan(0);
    expect(list.body.map((x) => x.rank)).toEqual(list.body.map((_, i) => i + 1));
    for (const x of list.body) {
      expect(x.matchIds.length).toBeGreaterThan(0);
      expect(x.matchIds).toContain(x.bestMatchId);
    }
    // Today is still being decided.
    expect((await a.call('GET', '/v1/top100/2026-10-27')).status).toBe(409);
    expect((await a.call('GET', '/v1/top100/2026-10-29')).status).toBe(404);
    // Badges for every ranked player; one job per distinct best match (both players are its participants).
    const ranked = new Set(list.body.map((x) => x.playerId));
    for (const p of [a, c, d, e]) {
      const me = (await p.call<Profile>('GET', '/v1/me')).body;
      expect(me.badges.includes('youtube_top100')).toBe(ranked.has(me.playerId));
    }
    const best = new Set(list.body.map((x) => x.bestMatchId));
    const jobs = await row<{ n: number }>(b, 'SELECT COUNT(*) AS n FROM highlight_jobs');
    expect(jobs?.n).toBe(best.size);
    const aJobs = await mine(a);
    for (const j of aJobs) {
      expect(j.status).toBe('pending_consent');
      expect(j.participants).toHaveLength(2);
      expect(j.title).toMatch(/· Daily Top 100 #\d+ \| VANDE Cricket #Shorts$/);
      expect(j.description).toContain(`/h/${j.attributionCode}`);
    }
    b.close();
  });

  it('dedupes: when both players of a match qualify with it, there is one job with both participants', async () => {
    const b = await backend();
    const [a, c] = await players(b, 2);
    const m = await playDuel(a, c, [40, 90]);
    await freeze(b);
    const list = (await a.call<Top100Entry[]>('GET', `/v1/top100/${DAY1}`)).body;
    expect(list.map((x) => x.bestMatchId)).toEqual([m, m]);
    const jobs = await mine(a);
    expect(jobs).toHaveLength(1);
    expect((await mine(c)).map((j) => j.jobId)).toEqual([jobs[0].jobId]);
    expect(new Set(jobs[0].participants)).toEqual(new Set(list.map((x) => x.playerId)));
    b.close();
  });

  it('is idempotent: a repeated, a concurrent and a retried run write exactly one ranking', async () => {
    const b = await backend();
    const [a, c, d] = await players(b, 3);
    await playDuel(a, c, [40, 300]);
    await playDuel(c, d, [50, 200]);
    await advanceTo(b, CUTOFF_1 + 60_000);
    // Two runs at once, then the cron, then the sweeper's retry.
    await Promise.all([b.scheduled(DAILY_CUTOFF_CRON), b.scheduled(DAILY_CUTOFF_CRON)]);
    await b.scheduled(DAILY_CUTOFF_CRON);
    await sweep(b);
    const counts = await row<{ entries: number; days: number; jobs: number }>(b, 'SELECT (SELECT COUNT(*) FROM top100_entries) AS entries, (SELECT COUNT(*) FROM top100_days) AS days, (SELECT COUNT(*) FROM highlight_jobs) AS jobs');
    expect(counts?.days).toBe(1);
    const first = (await a.call<Top100Entry[]>('GET', `/v1/top100/${DAY1}`)).body;
    expect(counts?.entries).toBe(first.length);
    // Badges are added once.
    const me = (await a.call<Profile>('GET', '/v1/me')).body;
    expect(me.badges.filter((x) => x === 'youtube_top100').length).toBeLessThanOrEqual(1);
    // Notified once per ranked player (the collapse key would merge repeats anyway).
    expect(b.notify.sent.filter((m) => m.kind === 'top100').length).toBe(first.length);
    b.close();
  });

  it('leaves out timing-audit flags, too many late answers and Auto sides (ranking eligibility)', async () => {
    const b = await backend();
    const [a, c, d, e] = await players(b, 4);
    const flagged = await playDuel(a, c, [0, 300]); // a taps within 3 ms of perfect every ball
    const clean = await playDuel(d, e, [40, 300]);
    await freeze(b);
    const list = (await a.call<Top100Entry[]>('GET', `/v1/top100/${DAY1}`)).body;
    expect(list.flatMap((x) => x.matchIds)).not.toContain(flagged);
    expect(list.flatMap((x) => x.matchIds)).toContain(clean);
    b.close();
  });

  it('missed balls count with the late answers: two in an innings make the match ineligible, one does not', async () => {
    const b = await backend();
    const [a, c, d, e] = await players(b, 4);
    const twice = await duelSkipping(a, c, [1, 4]);
    const once = await duelSkipping(d, e, [2]);
    expect(await row(b, 'SELECT missed0, late0 FROM match_results WHERE match_id = ?1', twice)).toEqual({ missed0: 2, late0: 0 });
    await freeze(b);
    const ids = (await a.call<Top100Entry[]>('GET', `/v1/top100/${DAY1}`)).body.flatMap((x) => x.matchIds);
    expect(ids).not.toContain(twice);
    expect(ids).toContain(once);
    b.close();
  });

  it("a match without the engine's performance is left out for both players (never scored as 0) and counted", async () => {
    const b = await backend();
    const [a, c, d] = await players(b, 3);
    const broken = await playDuel(a, c, [40, 300]);
    const fine = await playDuel(a, d, [40, 260]);
    await b.db.prepare('UPDATE match_results SET te1 = NULL, cl1 = NULL, ex1 = NULL WHERE match_id = ?1').bind(broken).run();
    await freeze(b);
    const list = (await a.call<Top100Entry[]>('GET', `/v1/top100/${DAY1}`)).body;
    expect(list.flatMap((x) => x.matchIds)).not.toContain(broken);
    expect(list.flatMap((x) => x.matchIds)).toContain(fine);
    expect(b.metrics.total('top100_missing_performance')).toBe(1);
    // Everyone who played still took part that day.
    expect(await row(b, 'SELECT players FROM top100_days WHERE day = ?1', DAY1)).toEqual({ players: 3 });
    b.close();
  });

  it('the ranking input: late plus missed per innings, and no stand-in performance', () => {
    expect(MAX_IRREGULAR_BALLS).toBe(TOP100.maxLateAnswers);
    const { players: days, missingPerformance } = playerDays(DAY1, [resultRow({ match_id: 'm1', late0: 1, missed0: 1, missed1: 1 }), resultRow({ match_id: 'm2', revealed_ms: 2, te1: null })]);
    expect(missingPerformance).toBe(1);
    expect(days.map((p) => p.playerId).sort()).toEqual(['p0', 'p1']);
    const p0 = days.find((p) => p.playerId === 'p0')!;
    const p1 = days.find((p) => p.playerId === 'p1')!;
    expect(p0.matches.map((m) => m.matchId)).toEqual(['m1']);
    expect(p0.matches[0].lateAnswers).toEqual([2, 1]);
    expect(p1.matches[0].lateAnswers).toEqual([1, 2]);
    expect(p0.matches[0].opponentPerformance).toEqual({ tacticalEfficiency: 0.75, clutch: 0.5, execution: 0.6 });
    expect(matchEligibility(p0.matches[0])).toContain('late_answers');
  });

  it('does nothing without the ranking helper (fails closed)', async () => {
    const b = await backend({ helpers: {} });
    const [a, c] = await players(b, 2);
    await playDuel(a, c);
    await freeze(b);
    expect(await row(b, 'SELECT day FROM top100_days')).toBeNull();
    expect((await a.call('GET', `/v1/top100/${DAY1}`)).status).toBe(409);
    b.close();
  });
});

describe('nightly cleanup with the wave C tables', () => {
  it('runs every step without an error', async () => {
    const { createWorker } = await import('../src/app');
    const { runScheduled, CLEANUP_CRON } = await import('../src/ops/cron');
    const { readConfig } = await import('../src/config');
    const { fakeEngine, fakeHelpers } = await import('./fakeEngine');
    const b = await backend();
    const [a, c] = await players(b, 2);
    await playDuel(a, c);
    await freeze(b);
    const { deps } = createWorker({ engines: [fakeEngine], helpers: fakeHelpers, now: b.clock.now });
    const report = await runScheduled({ cron: CLEANUP_CRON, scheduledTime: b.clock.now() }, b.env, deps, readConfig(b.env));
    const failed = Object.entries(report).filter(([, v]) => v === -1);
    expect(failed).toEqual([]);
    expect(report).toHaveProperty('highlight_jobs');
    expect(report).toHaveProperty('internal_nonces');
    b.close();
  });
});
