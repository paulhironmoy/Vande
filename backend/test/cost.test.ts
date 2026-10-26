// @vitest-environment node
/**
 * Measured storage writes per operation, on the real migrations in SQLite with D1's billing rule
 * (backend/local/sqlite-d1.ts), plus Durable Object storage keys written per match. These numbers feed
 * docs/COST_MODEL.md; run with --silent=false to print the table:
 *
 *   npx vitest run backend/test/cost.test.ts --silent=false
 */
import { describe, expect, it } from 'vitest';
import type { NextBallResponse } from '@/contracts';
import { testShot } from './fakeEngine';
import { Player, backend, duel } from './helpers';

describe('cost per operation (measured)', () => {
  it('D1 rows written and DO keys written for one complete duel', async () => {
    const b = await backend();
    const rows = () => b.db.totalWritten;
    const phases: Record<string, number> = {};
    let mark = rows();
    const step = (name: string) => {
      phases[name] = rows() - mark;
      mark = rows();
    };
    const a = new Player(b);
    const c = new Player(b);
    await a.signup();
    step('guest sign-up');
    await c.signup();
    mark = rows();
    await a.refresh();
    step('refresh');
    const d = await a.call<{ matchId: string; inviteToken: string }>('POST', '/v1/duels', {});
    step('create duel');
    await c.call('POST', `/v1/invites/${d.body.inviteToken}/accept`);
    step('accept invite');
    await a.lock(d.body.matchId, 1);
    step('lock over');
    await c.lock(d.body.matchId, 2);
    mark = rows();
    await a.batInnings(d.body.matchId);
    step('bat one innings (7 balls)');
    await c.batInnings(d.body.matchId);
    step('bat the last innings + reveal');
    await a.call('PATCH', '/v1/me', { alias: 'Bold Comet' });
    step('profile edit');
    const workerRequests = b.metrics.total('request');
    const doRequests = b.matches.requests;
    const roomRequests = b.rooms.requests;
    const doStorage = b.matches.storage(d.body.matchId);
    const table = Object.entries(phases).map(([k, v]) => `${k.padEnd(32)} ${v}`).join('\n');
    const storedBytes = JSON.stringify([...doStorage.data.values()].map((v) => (v instanceof Uint8Array ? 'x'.repeat(v.byteLength) : v))).length;
    console.info(
      `[D1 rows written, bindings for rate limits]\n${table}\n[Durable Object] put calls ${doStorage.writes.calls}, keys written ${doStorage.writes.keys}, keys stored ${doStorage.data.size}, ~${Math.round(storedBytes / 1024)} KB stored` +
        `\n[requests for 2 sign-ups, 1 refresh, a duel with 2 locks, 2 innings, 1 profile edit] Worker ${workerRequests}, match objects ${doRequests}, room object ${roomRequests}`,
    );
    expect(doStorage.writes.keys).toBeLessThanOrEqual(55);
    expect(roomRequests).toBeLessThanOrEqual(8);
    // Locked so a schema or statement change that writes more is noticed (update docs/COST_MODEL.md with it).
    expect(phases).toEqual({
      'guest sign-up': 9,
      refresh: 4,
      'create duel': 7, // +1 since wave G: the short invite code
      'accept invite': 3,
      'lock over': 3,
      'bat one innings (7 balls)': 2,
      'bat the last innings + reveal': 9, // +2 since wave C: both players' ratings (applied by the trigger)
      'profile edit': 4,
    });
    b.close();
  });

  it('a full duel through the D1 rate-limit fallback (no bindings) costs more rows', async () => {
    const b = await backend({ rateLimits: 'd1' });
    const before = b.db.totalWritten;
    const { a, c, matchId } = await duel(b);
    await a.lock(matchId, 1);
    await c.lock(matchId, 2);
    await a.batInnings(matchId);
    await c.batInnings(matchId);
    const total = b.db.totalWritten - before;
    console.info(`[D1 rows written for two sign-ups and one duel, D1 rate-limit fallback] ${total}`);
    expect(total).toBeGreaterThan(40);
    b.close();
  });
});

describe('cost of production timing (measured)', () => {
  it('a duel with the activity jitter and the 5-minute reveal slot, against the same duel revealed at once', async () => {
    const { advanceTo } = await import('./helpers');
    const run = async (vars: Record<string, string>) => {
      const b = await backend({ vars });
      const a = new Player(b);
      const c = new Player(b);
      await a.signup();
      await c.signup();
      const d0 = b.db.totalWritten;
      const r0 = b.matches.requests;
      const d = await a.call<{ matchId: string; inviteToken: string }>('POST', '/v1/duels', {});
      await c.call('POST', `/v1/invites/${d.body.inviteToken}/accept`);
      await a.lock(d.body.matchId, 1);
      await c.lock(d.body.matchId, 2);
      await advanceTo(b, b.clock.now() + 11 * 60_000); // both locks visible to both
      await a.batInnings(d.body.matchId);
      await c.batInnings(d.body.matchId);
      await advanceTo(b, b.clock.now() + 16 * 60_000); // completion visibility and the reveal slot have passed
      expect((await a.view(d.body.matchId)).body.phase).toBe('revealed');
      const storage = b.matches.storage(d.body.matchId);
      const out = { d1Rows: b.db.totalWritten - d0, doKeys: storage.writes.keys, doPutCalls: storage.writes.calls, alarms: b.matches.alarmsFired, matchRequests: b.matches.requests - r0 };
      b.close();
      return out;
    };
    const instant = await run({ ACTIVITY_JITTER_S: '0', DUEL_REVEAL_SLOT_S: '0' });
    const production = await run({ ACTIVITY_JITTER_S: '60-600', DUEL_REVEAL_SLOT_S: '300' });
    console.info(`[duel from creation to reveal] revealed at once: ${JSON.stringify(instant)}\n[duel from creation to reveal] production timing: ${JSON.stringify(production)}`);
    // Production timing adds a few alarms (lock and completion visibility, the reveal slot) and the writes they make.
    expect(production.alarms - instant.alarms).toBeLessThanOrEqual(6);
    expect(production.doKeys).toBeLessThanOrEqual(instant.doKeys + 10);
    expect(production.d1Rows).toBeLessThanOrEqual(instant.d1Rows + 4);
  });
});

describe('cost of the social product (measured)', () => {
  it('a 4-player cup end to end, one Daily Six attempt, and a leaderboard read', async () => {
    const { cup, cupView, playRound, advanceTo } = await import('./helpers');
    const b = await backend();
    const before = b.db.totalWritten;
    const s = await cup(b, 4);
    const created = b.db.totalWritten - before;
    let v = await cupView(s.players[0], s.cupId);
    await advanceTo(b, Date.parse(v.schedule.rounds[0].lockBy) - 3_600_000 + 60_000);
    for (let guard = 0; guard < 6; guard++) {
      v = await cupView(s.players[0], s.cupId);
      if (v.status === 'complete') break;
      const open = v.status === 'final' && v.schedule.final ? v.schedule.final : v.schedule.rounds.find((r) => Date.parse(r.revealAt) > b.clock.now());
      await playRound(s.players, s.cupId);
      await advanceTo(b, Date.parse(open!.revealAt) + 2_000);
    }
    expect(v.status).toBe('complete');
    const cupRows = b.db.totalWritten - before;
    const fixtures = v.fixtures.length;
    const reqs = { match: b.matches.requests, cup: b.cups.requests, room: b.rooms.requests };

    const p = new Player(b);
    await p.signup();
    const d0 = b.db.totalWritten;
    const a = (await p.call<{ attemptId: string }>('POST', '/v1/daily/attempts')).body;
    for (let i = 0; i < 8; i++) {
      const n = await p.call<NextBallResponse>('POST', `/v1/daily/attempts/${a.attemptId}/next`);
      if (n.status !== 200) break;
      b.clock.advance(1_000);
      const r = await p.call<{ inningsComplete: boolean }>('POST', `/v1/daily/attempts/${a.attemptId}/shot`, { ballToken: n.body.ballToken, input: testShot(n.body.delivery) });
      if (r.body.inningsComplete) break;
    }
    await p.call('GET', `/v1/daily/attempts/${a.attemptId}/result`);
    const dailyRows = b.db.totalWritten - d0;
    const dailyKeys = b.matches.storage(a.attemptId).writes.keys;
    const l0 = b.db.totalWritten;
    await p.call('GET', '/v1/leaderboards/national');
    const leaderboardRows = b.db.totalWritten - l0;
    console.info(
      `[cup, 4 players, ${fixtures} fixtures incl. final] create + 3 joins: ${created} D1 rows; whole cup: ${cupRows} D1 rows (${(cupRows / fixtures).toFixed(1)} per fixture); ` +
        `requests: match objects ${reqs.match}, cup object ${reqs.cup}, room object ${reqs.room}` +
        `\n[Daily Six attempt] ${dailyRows} D1 rows written (start, 7 balls, result), ${dailyKeys} DO keys written` +
        `\n[leaderboard read] ${leaderboardRows} D1 rows written`,
    );
    const byTable: Record<string, number> = {};
    for (const r of b.db.log) byTable[r.table] = (byTable[r.table] ?? 0) + r.written;
    console.info(`[D1 rows written by table, whole test] ${JSON.stringify(byTable)}`);
    expect(leaderboardRows).toBe(0);
    expect(dailyRows).toBeLessThanOrEqual(16);
    // Fixture-related rows only (sign-ups, refreshes and idempotency of the test players excluded).
    const fixtureRows = (byTable.match_players ?? 0) + (byTable.match_results ?? 0) + (byTable.friends ?? 0) + (byTable.audit_log ?? 0) - 1;
    expect(fixtureRows / fixtures).toBeLessThan(20);
    b.close();
  }, 60_000);
});

describe('cost of the Top 100 and one highlight (measured)', () => {
  it('D1 rows for the cutoff, consent, render, approval and upload, and R2 operations', async () => {
    const { freeze, mine, players, playDuel, consent, RenderClient, Admin } = await import('./highlightHelpers');
    const b = await backend();
    const [a, c] = await players(b, 2);
    const r2Before = { ...b.files.ops };
    await playDuel(a, c, [40, 90]);
    const archived = { a: b.files.ops.a - r2Before.a, b: b.files.ops.b - r2Before.b };
    const rows = () => b.db.totalWritten;
    const phases: Record<string, number> = {};
    let mark = rows();
    const step = (name: string) => {
      phases[name] = rows() - mark;
      mark = rows();
    };
    await freeze(b);
    step('cutoff (2 ranked, 1 job)');
    const [job] = await mine(a);
    mark = rows();
    await consent(a, job.jobId, 'granted');
    step('consent (first)');
    await consent(c, job.jobId, 'granted');
    step('consent (last) + automatic checks');
    const render = new RenderClient(b);
    await render.claim();
    step('render claim');
    await render.deliver(job.jobId);
    step('render upload + complete');
    await new Admin(b).call('POST', `/v1/admin/jobs/${job.jobId}/approve`, {});
    step('admin approve');
    await b.drainQueues();
    step('YouTube upload + publish');
    console.info('[cost] highlight pipeline D1 rows', phases, 'R2 ops for a reveal (archive):', archived);
    expect(archived.a).toBe(1);
    // Locked so that a schema or statement change that writes more is noticed (docs/COST_MODEL.md).
    for (const n of Object.values(phases)) expect(n).toBeLessThan(40);
    expect(phases['cutoff (2 ranked, 1 job)']).toBeGreaterThan(0);
    b.close();
  });
});
