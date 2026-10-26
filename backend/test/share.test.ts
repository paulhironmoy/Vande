// @vitest-environment node
/**
 * Shared match links: a participant shares a revealed duel or cup match (one keyed code per match, the same for both
 * players), anyone can open it, and it always shows the players' current, moderated names ("Deleted player" after an
 * account deletion), in the response and inside the replay itself.
 */
import { describe, expect, it } from 'vitest';
import type { DailyAttemptResponse, MatchEventLog, SharedMatch } from '@/contracts';
import { SHARED_CODE_RE } from '@/net/shared/ids';
import { API, backend, duel, type Player } from './helpers';

async function played(b: Awaited<ReturnType<typeof backend>>) {
  const d = await duel(b);
  await d.a.lock(d.matchId, 1);
  await d.c.lock(d.matchId, 2);
  await d.a.batInnings(d.matchId);
  await d.c.batInnings(d.matchId);
  await b.idle();
  return d;
}

const share = (p: Player, matchId: string) => p.call<{ code: string; url: string }>('POST', `/v1/matches/${matchId}/share`);
const open = (p: Player, code: string) => p.call<SharedMatch>('GET', `/v1/s/${code}`, undefined, { token: null });

describe('shared match links', () => {
  it('participants of a revealed match only; one code per match, the same from either player', async () => {
    const b = await backend();
    const d = await duel(b);
    await d.a.lock(d.matchId, 1);
    // Not revealed yet: nothing to share.
    expect((await share(d.a, d.matchId)).status).toBe(409);
    await d.c.lock(d.matchId, 2);
    await d.a.batInnings(d.matchId);
    await d.c.batInnings(d.matchId);
    await b.idle();
    const first = await share(d.a, d.matchId);
    expect(first.status).toBe(200);
    expect(first.body.code).toMatch(SHARED_CODE_RE);
    expect(first.body.url).toBe(`http://localhost:5173/s/${first.body.code}`);
    expect((await share(d.a, d.matchId)).body).toEqual(first.body);
    expect((await share(d.c, d.matchId)).body).toEqual(first.body);
    // Not a participant, not a match id, a Daily Six attempt: all not found.
    const { a: stranger } = await duel(b);
    expect((await share(stranger, d.matchId)).status).toBe(404);
    expect((await share(d.a, 'not-a-match')).status).toBe(404);
    const attempt = (await d.a.call<DailyAttemptResponse>('POST', '/v1/daily/attempts')).body;
    expect((await share(d.a, attempt.attemptId)).status).toBe(404);
    b.close();
  });

  it('opens publicly with the current names, inside the replay too, and the conditions', async () => {
    const b = await backend();
    const d = await played(b);
    const { code } = (await share(d.c, d.matchId)).body;
    const r = await open(d.a, code);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ code, kind: 'duel', conditions: { pitch: 'hard', weather: 'clear' }, aliases: ['Swift Tiger', 'Calm Cobra'] });
    expect(r.body.log.players.map((p) => p.alias)).toEqual(['Swift Tiger', 'Calm Cobra']);
    expect(r.headers.get('cache-control')).toContain('public');
    // A new alias shows at once: the page never keeps a match-time name.
    expect((await d.a.call('PATCH', '/v1/me', { alias: 'Bold Comet' })).status).toBe(200);
    expect((await open(d.c, code)).body.aliases).toEqual(['Bold Comet', 'Calm Cobra']);
    // Unknown and malformed codes.
    expect((await open(d.a, 'zzzzzzzzzz')).status).toBe(404);
    expect((await open(d.a, 'NOT_A_CODE')).status).toBe(404);
    b.close();
  });

  it('a player who deletes their account becomes "Deleted player" on the page and in its replay', async () => {
    const b = await backend();
    const d = await played(b);
    const { code } = (await share(d.a, d.matchId)).body;
    expect((await d.c.call('DELETE', '/v1/me')).status).toBe(200);
    await b.drainQueues();
    const r = await open(d.a, code);
    expect(r.status).toBe(200);
    expect(r.body.aliases).toEqual(['Swift Tiger', 'Deleted player']);
    const seat1 = (r.body.log as MatchEventLog).players[1];
    expect(seat1.alias).toBe('Deleted player');
    expect(JSON.stringify(r.body)).not.toContain('Calm Cobra');
    b.close();
  });
});

describe('the share cap (POST /v1/matches/:id/moments)', () => {
  type Allowed = { allowed: boolean };
  it('each moment once per player and match or cup; reopening it soon after is the same moment', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    const claim = (p: Player, id: string, moment: string) => p.call<Allowed>('POST', `/v1/matches/${id}/moments`, { moment }, { idem: false });
    // The creator's invitation, right after creating the duel (no Idempotency-Key needed).
    expect((await claim(a, matchId, 'invite')).body).toEqual({ allowed: true });
    // A cancelled sheet or another chat within ten minutes is the same moment…
    await b.advance(9 * 60_000);
    expect((await claim(a, matchId, 'invite')).body).toEqual({ allowed: true });
    // …after that it is used, also from another device (the server keeps it, not the phone).
    await b.advance(2 * 60_000);
    expect((await claim(a, matchId, 'invite')).body).toEqual({ allowed: false });
    // Each player and each moment counts on its own.
    expect((await claim(c, matchId, 'invite')).body).toEqual({ allowed: true });
    expect((await claim(a, matchId, 'reminder')).body).toEqual({ allowed: true });
    expect((await claim(a, matchId, 'final')).body).toEqual({ allowed: true });
    // A cup's invitation is shared under the cup id.
    const cup = (await a.call<{ cupId: string }>('POST', '/v1/cups', { name: 'Office Cup', pace: 'sprint', maxPlayers: 4 })).body;
    expect((await claim(a, cup.cupId, 'invite')).body).toEqual({ allowed: true });
    expect(Number((b.db.db.prepare('SELECT count(*) AS n FROM share_moments').get() as { n: number }).n)).toBe(5);
    b.close();
  });

  it('checks its input, needs a session, and leaves with the account (exported first)', async () => {
    const b = await backend();
    const { a, matchId } = await duel(b);
    const post = (path: string, body: unknown, token?: string | null) => a.call<{ error?: { code: string } }>('POST', path, body, { idem: false, ...(token === undefined ? {} : { token }) });
    expect((await post(`/v1/matches/${matchId}/moments`, { moment: 'boast' })).status).toBe(400);
    expect((await post(`/v1/matches/${matchId}/moments`, { moment: 'invite', extra: 1 })).status).toBe(400);
    expect((await post('/v1/matches/not-a-match/moments', { moment: 'invite' })).status).toBe(404);
    expect((await post(`/v1/matches/${matchId}/moments`, { moment: 'invite' }, null)).status).toBe(401);
    expect((await post(`/v1/matches/${matchId}/moments`, { moment: 'invite' })).status).toBe(200);
    const exported = await a.call<{ downloadUrl: string }>('POST', '/v1/me/export');
    expect(exported.status).toBe(201);
    const doc = (await a.call<{ shareMoments: Array<{ id: string; moment: string; firstHour: string }> }>('GET', exported.body.downloadUrl.slice(API.length), undefined, { token: null })).body;
    expect(doc.shareMoments).toEqual([{ id: matchId, moment: 'invite', firstHour: '2026-10-26T06:00:00.000Z' }]);
    expect((await a.call('DELETE', '/v1/me')).status).toBe(200);
    expect(Number((b.db.db.prepare('SELECT count(*) AS n FROM share_moments').get() as { n: number }).n)).toBe(0);
    b.close();
  });

  it('records are pruned after 90 days', async () => {
    const b = await backend();
    const { a, matchId } = await duel(b);
    await a.call('POST', `/v1/matches/${matchId}/moments`, { moment: 'invite' }, { idem: false });
    await b.advance(91 * 86_400_000);
    await b.scheduled();
    expect(Number((b.db.db.prepare('SELECT count(*) AS n FROM share_moments').get() as { n: number }).n)).toBe(0);
    b.close();
  });
});
