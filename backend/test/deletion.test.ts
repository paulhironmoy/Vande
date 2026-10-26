// @vitest-environment node
/**
 * Account deletion reaches everything that named the player (security review, finding 2): Cricket Room titles and
 * cards, the archived replay in R2, highlight titles, descriptions and approved titles, every Daily Six attempt
 * (including one in progress, which must never write the boards at the reset), and an unexpired access token of the
 * deleted account can write nothing.
 */
import { describe, expect, it } from 'vitest';
import type { NextBallResponse, RoomView } from '@/contracts';
import { gunzip } from '../src/security/crypto';
import { testShot } from './fakeEngine';
import { Player, advanceTo, backend, duel, roomView } from './helpers';
import { consent, freeze, mine, playDuel, players, row } from './highlightHelpers';

const IST_MIDNIGHT_AFTER_T0 = Date.UTC(2026, 9, 26, 18, 30);
const uidOf = (p: Player) => JSON.parse(Buffer.from(p.tokens!.accessToken.split('.')[2], 'base64url').toString()).sub as string;

describe('account deletion', () => {
  it('scrubs the Cricket Room title and every card that named the player, by player id', async () => {
    const b = await backend();
    const [a, c] = await players(b, 2); // "Swift Tiger" is deleted below
    const matchId = await playDuel(a, c, [40, 90]);
    const roomId = `r${matchId.slice(1)}`;
    const before = await roomView(c, roomId);
    expect(before.title).toBe('Swift Tiger · Friend Duel');
    expect(JSON.stringify(before.posts)).toContain('Swift Tiger');
    expect((await a.call('DELETE', '/v1/me')).status).toBe(200);
    await b.drainQueues();
    const after: RoomView = await roomView(c, roomId);
    expect(after.title).toBe('Deleted player · Friend Duel');
    expect(JSON.stringify(after)).not.toContain('Swift Tiger');
    expect(after.posts.find((p) => p.kind === 'invite')?.payload).toMatchObject({ inviterAlias: 'Deleted player' });
    const card = after.posts.find((p) => p.kind === 'scorecard')?.payload;
    expect(card).toMatchObject({ homeAlias: 'Deleted player', awayAlias: 'Calm Cobra' });
    expect(['Deleted player', 'Calm Cobra', null]).toContain(card?.winnerAlias);
    b.close();
  });

  it('rewrites the archived replay in R2 and every highlight text without the alias', async () => {
    const b = await backend();
    const [a, c] = await players(b, 2);
    const matchId = await playDuel(a, c, [40, 90]);
    await freeze(b);
    const [job] = await mine(a);
    await consent(a, job.jobId, 'granted');
    expect((await a.call('DELETE', '/v1/me')).status).toBe(200);
    await b.drainQueues();
    await b.idle();
    const archived = b.files.objects.get(`logs/${matchId}.json.gz`);
    expect(archived).toBeDefined();
    const log = await gunzip(archived!.data);
    expect(log).not.toContain('Swift Tiger');
    expect(log).toContain('Deleted player');
    const j = (await row<{ alias0: string; title: string; description: string }>(b, 'SELECT alias0, title, description FROM highlight_jobs WHERE job_id = ?1', job.jobId))!;
    expect(j.alias0).toBe('Deleted player');
    expect(j.title).toContain('Deleted player vs Calm Cobra');
    expect(`${j.title}\n${j.description}`).not.toContain('Swift Tiger');
    const approved = (await b.db.prepare('SELECT approved_title FROM highlight_consents WHERE job_id = ?1').bind(job.jobId).all<{ approved_title: string }>()).results;
    expect(approved.length).toBeGreaterThan(0);
    for (const r of approved) expect(r.approved_title).not.toContain('Swift Tiger');
    b.close();
  });

  it('forgets a Daily Six attempt in progress: nothing reaches the boards at the reset', async () => {
    const b = await backend();
    const p = new Player(b);
    await p.signup('Vanishing Batter');
    expect((await p.call('PATCH', '/v1/me', { city: 'pune' })).status).toBe(200);
    const uid = uidOf(p);
    const done = (await p.call<{ attemptId: string }>('POST', '/v1/daily/attempts')).body.attemptId;
    for (let i = 0; i < 9; i++) {
      const n = await p.call<NextBallResponse>('POST', `/v1/daily/attempts/${done}/next`);
      if (n.status !== 200) break;
      b.clock.advance(1_000);
      const s = await p.call<{ inningsComplete: boolean }>('POST', `/v1/daily/attempts/${done}/shot`, { ballToken: n.body.ballToken, input: testShot(n.body.delivery) });
      if (s.body.inningsComplete) break;
    }
    const open = (await p.call<{ attemptId: string }>('POST', '/v1/daily/attempts')).body.attemptId;
    for (let i = 0; i < 2; i++) {
      const n = await p.call<NextBallResponse>('POST', `/v1/daily/attempts/${open}/next`);
      b.clock.advance(1_000);
      expect((await p.call('POST', `/v1/daily/attempts/${open}/shot`, { ballToken: n.body.ballToken, input: testShot(n.body.delivery) })).status).toBe(200);
    }
    expect((await p.call('DELETE', '/v1/me')).status).toBe(200);
    await advanceTo(b, IST_MIDNIGHT_AFTER_T0 + 60_000);
    await b.runAlarms();
    await b.idle();
    expect((await b.db.prepare('SELECT COUNT(*) AS n FROM daily_scores WHERE uid = ?1').bind(uid).first())!).toEqual({ n: 0 });
    expect((await b.db.prepare('SELECT COUNT(*) AS n FROM daily_players WHERE uid = ?1').bind(uid).first())!).toEqual({ n: 0 });
    const reader = new Player(b);
    await reader.signup('Board Reader');
    const board = await reader.call<{ entries: Array<{ alias: string }> }>('GET', '/v1/leaderboards/national?day=2026-10-26');
    expect(JSON.stringify(board.body)).not.toContain('Vanishing Batter');
    // Both attempt objects (the finished one and the one that was open) forgot the player.
    for (const id of [done, open]) {
      const stored = JSON.stringify([...b.matches.storage(id).data.entries()].map(([k, v]) => [k, v instanceof Uint8Array ? '<bytes>' : v]));
      expect(stored).not.toContain('Vanishing Batter');
      expect(stored).not.toContain(uid);
    }
    b.close();
  });

  it('an attempt object that already deleted itself is skipped, not retried from the queue', async () => {
    const b = await backend();
    const p = new Player(b);
    await p.signup('Old Attempt');
    const id = (await p.call<{ attemptId: string }>('POST', '/v1/daily/attempts')).body.attemptId;
    for (let i = 0; i < 9; i++) {
      const n = await p.call<NextBallResponse>('POST', `/v1/daily/attempts/${id}/next`);
      if (n.status !== 200) break;
      b.clock.advance(1_000);
      const s = await p.call<{ inningsComplete: boolean }>('POST', `/v1/daily/attempts/${id}/shot`, { ballToken: n.body.ballToken, input: testShot(n.body.delivery) });
      if (s.body.inningsComplete) break;
    }
    await advanceTo(b, b.clock.now() + 31 * 86_400_000); // the attempt object deletes itself 30 days after its reveal
    expect(b.matches.storage(id).data.size).toBe(0);
    expect((await p.call('DELETE', '/v1/me')).status).toBe(200);
    expect(b.maint.sent).toEqual([]);
    b.close();
  });

  it('an unexpired access token of the deleted account writes nothing', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    const token = a.tokens!.accessToken;
    const uid = uidOf(a);
    expect((await a.call('DELETE', '/v1/me')).status).toBe(200);
    const roomId = `r${matchId.slice(1)}`;
    const attempts = [
      await a.call('POST', '/v1/push/settings', { enabled: true, quietHours: null }, { token }),
      await a.call('POST', `/v1/blocks/${c.tokens!.playerId}`, undefined, { token }),
      await a.call('POST', '/v1/report', { playerId: c.tokens!.playerId, reason: 'spam' }, { token }),
      await a.call('POST', `/v1/rooms/${roomId}/banter`, { phraseId: 'banter.bring_it' }, { token }),
      await a.call('POST', `/v1/rooms/${roomId}/settings`, { muted: true }, { token }),
      await a.call('POST', `/v1/matches/${matchId}/bat/next`, undefined, { token }),
    ];
    expect(attempts.map((r) => r.status)).toEqual([401, 401, 401, 401, 401, 401]);
    for (const table of ['notify_prefs', 'blocks', 'room_settings']) expect(await row(b, `SELECT COUNT(*) AS n FROM ${table} WHERE uid = ?1`, uid)).toEqual({ n: 0 });
    expect(await row(b, 'SELECT COUNT(*) AS n FROM reports')).toEqual({ n: 0 });
    // Deleting again with the same token is still answered "deleted" (idempotent).
    expect((await a.call('DELETE', '/v1/me', undefined, { token })).status).toBe(200);
    b.close();
  });
});

describe('data export', () => {
  it('includes match results, Daily Six, settings, cups, friends, blocks and reports', async () => {
    const b = await backend();
    const [a, c] = await players(b, 2);
    const matchId = await playDuel(a, c, [40, 90]);
    await a.call('POST', '/v1/push/settings', { enabled: true, quietHours: { start: '23:00', end: '07:00' } });
    await a.call('POST', `/v1/rooms/r${matchId.slice(1)}/settings`, { notify: 'important' });
    const x = new Player(b);
    await x.signup('Rude Stranger');
    await a.call('POST', `/v1/blocks/${x.tokens!.playerId}`);
    await a.call('POST', '/v1/report', { playerId: x.tokens!.playerId, reason: 'abusive' });
    const attempt = (await a.call<{ attemptId: string }>('POST', '/v1/daily/attempts')).body.attemptId;
    for (let i = 0; i < 9; i++) {
      const n = await a.call<NextBallResponse>('POST', `/v1/daily/attempts/${attempt}/next`);
      if (n.status !== 200) break;
      b.clock.advance(1_000);
      const s = await a.call<{ inningsComplete: boolean }>('POST', `/v1/daily/attempts/${attempt}/shot`, { ballToken: n.body.ballToken, input: testShot(n.body.delivery) });
      if (s.body.inningsComplete) break;
    }
    const exp = await a.call<{ downloadUrl: string }>('POST', '/v1/me/export');
    expect(exp.status).toBe(201);
    const url = new URL(exp.body.downloadUrl);
    const res = await b.fetch(`http://127.0.0.1:8787${url.pathname}${url.search}`, { headers: { origin: 'http://localhost:5173' } });
    const doc = (await res.json()) as Record<string, unknown> & { matchResults: Array<Record<string, unknown>>; dailySix: { scores: unknown[]; attempts: unknown[]; streak: unknown }; friends: Array<{ playerId: string }> };
    expect(doc.version).toBe(2);
    expect(doc.matchResults).toHaveLength(1);
    expect(doc.matchResults[0]).toMatchObject({ matchId, seat: 0, integrity: expect.objectContaining({ timingAuditFlag: false }) });
    expect(JSON.stringify(doc.matchResults)).not.toContain(uidOf(c));
    expect(doc.dailySix.scores).toHaveLength(1);
    expect(doc.dailySix.attempts).toEqual([{ day: '2026-10-26', started: 1, finished: 1 }]);
    expect(doc.dailySix.streak).toMatchObject({ current: 1 });
    expect(doc.notifications).toEqual({ enabled: true, quietHours: { start: '23:00', end: '07:00' } });
    expect(doc.roomSettings).toEqual([{ roomId: `r${matchId.slice(1)}`, muted: false, notify: 'important' }]);
    expect(doc.friends).toEqual([expect.objectContaining({ playerId: c.tokens!.playerId, alias: 'Calm Cobra' })]);
    expect(doc.blocks).toEqual([expect.objectContaining({ playerId: x.tokens!.playerId })]);
    expect(doc.reports).toEqual([expect.objectContaining({ kind: 'player', target: x.tokens!.playerId, reason: 'abusive' })]);
    expect(doc.cups).toEqual([]);
    b.close();
  });
});
