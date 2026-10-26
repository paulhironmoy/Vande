// @vitest-environment node
/**
 * The report queue: what players report reaches moderators (never who reported), and each action works and is
 * audited: dismiss, a safe rename carried everywhere the name shows, a suspension from social features (matches keep
 * working), lifting it, and taking a reported post down.
 */
import { describe, expect, it } from 'vitest';
import type { AdminReport } from '@/admin/types';
import type { CupView, MatchView, Profile, RoomView } from '@/contracts';
import { Admin } from './highlightHelpers';
import { advanceTo, backend, cup, cupView, duel, roomView, type Player } from './helpers';

type Queue = { reports: AdminReport[]; counts: { open: number; closed: number } };

async function queue(b: Awaited<ReturnType<typeof backend>>, query = ''): Promise<Queue> {
  const r = await new Admin(b).call<Queue>('GET', `/v1/admin/reports${query}`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}

describe('the report queue', () => {
  it('lists reports with the reported player and post as they are now, never the reporter', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    const roomId = (await a.view(matchId)).body.roomId as string;
    expect((await c.call('POST', `/v1/rooms/${roomId}/banter`, { phraseId: 'banter.bring_it' })).status).toBe(200);
    const post = (await roomView(a, roomId)).posts.find((p) => p.kind === 'banter')!;
    expect((await a.call('POST', '/v1/report', { postId: post.postId, playerId: c.tokens!.playerId, reason: 'abusive' })).status).toBe(200);
    expect((await a.call('POST', '/v1/report', { playerId: c.tokens!.playerId, reason: 'cheating' })).status).toBe(200);
    // Nobody reports themselves.
    expect((await c.call('POST', '/v1/report', { playerId: c.tokens!.playerId, reason: 'spam' })).status).toBe(400);
    const q = await queue(b);
    expect(q.counts).toEqual({ open: 2, closed: 0 });
    expect(q.reports.map((r) => [r.kind, r.reason])).toEqual([['player', 'cheating'], ['post', 'abusive']]);
    expect(q.reports[1]).toMatchObject({
      status: 'open',
      player: { playerId: c.tokens!.playerId, alias: 'Calm Cobra', status: 'active', suspendedUntil: null, openReports: 2 },
      post: { postId: post.postId, present: true, kind: 'banter', phraseId: 'banter.bring_it', text: null },
      history: [],
    });
    // The reporter is nowhere in what moderators see.
    expect(JSON.stringify(q)).not.toContain(a.tokens!.playerId);
    expect(JSON.stringify(q)).not.toContain('Swift Tiger');
    expect((await queue(b, '?kind=post')).reports).toHaveLength(1);
    expect((await new Admin(b).call('GET', '/v1/admin/reports?status=everything')).status).toBe(400);
    b.close();
  });

  it('dismiss closes it, with the moderator and the notes in its history', async () => {
    const b = await backend();
    const { a, c } = await duel(b);
    await a.call('POST', '/v1/report', { playerId: c.tokens!.playerId, reason: 'other' });
    const [r] = (await queue(b)).reports;
    expect((await new Admin(b).call('POST', `/v1/admin/reports/${r.id}/dismiss`, { notes: 'a normal name' })).body).toEqual({ status: 'dismissed' });
    const closed = await queue(b, '?status=closed');
    expect(closed.counts).toEqual({ open: 0, closed: 1 });
    expect(closed.reports[0]).toMatchObject({ status: 'dismissed', resolution: 'dismissed', history: [{ action: 'dismissed', admin: 'dev-token', notes: 'a normal name' }] });
    expect((await new Admin(b).call('POST', '/v1/admin/reports/999999/dismiss', {})).status).toBe(404);
    b.close();
  });

  it('rename: a generated name everywhere the old one showed (profile, match, cup table, rooms)', async () => {
    const b = await backend();
    const { players, cupId } = await cup(b, 3);
    const [captain, bad] = players;
    const roomId = (await cupView(captain, cupId)).roomId;
    await captain.call('POST', '/v1/report', { playerId: bad.tokens!.playerId, reason: 'abusive' });
    const before = (await bad.call<Profile>('GET', '/v1/me')).body.alias;
    const [r] = (await queue(b)).reports;
    const renamed = await new Admin(b).call<{ status: string; alias: string }>('POST', `/v1/admin/reports/${r.id}/rename`, {});
    expect(renamed.status).toBe(200);
    expect(renamed.body.alias).not.toBe(before);
    await b.drainQueues();
    await b.idle();
    expect((await bad.call<Profile>('GET', '/v1/me')).body.alias).toBe(renamed.body.alias);
    const view: CupView = await cupView(captain, cupId);
    expect(view.members.map((m) => m.alias)).toContain(renamed.body.alias);
    expect(JSON.stringify(view)).not.toContain(before);
    const room: RoomView = await roomView(captain, roomId);
    expect(JSON.stringify(room.members)).not.toContain(before);
    expect((await queue(b, '?status=closed')).reports[0]).toMatchObject({ resolution: 'renamed', history: [{ action: 'renamed' }] });
    b.close();
  });

  it('rename reaches the match views of both players', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    await a.call('POST', '/v1/report', { playerId: c.tokens!.playerId, reason: 'abusive' });
    const [r] = (await queue(b)).reports;
    const { alias } = (await new Admin(b).call<{ alias: string }>('POST', `/v1/admin/reports/${r.id}/rename`, {})).body;
    await b.drainQueues();
    await b.idle();
    const mine: MatchView = (await a.view(matchId)).body;
    expect(mine.players[1]?.alias).toBe(alias);
    const list = (await a.call<MatchView[]>('GET', '/v1/matches')).body;
    expect(list.find((m) => m.matchId === matchId)?.players[1]?.alias).toBe(alias);
    b.close();
  });

  it('suspend pauses rooms, cups, groups and name changes, never matches; unsuspend and the end date lift it', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    const roomId = (await c.view(matchId)).body.roomId as string;
    await a.call('POST', '/v1/report', { playerId: c.tokens!.playerId, reason: 'abusive' });
    const [r] = (await queue(b)).reports;
    expect((await new Admin(b).call('POST', `/v1/admin/reports/${r.id}/suspend`, { days: 0 })).status).toBe(400);
    const s = await new Admin(b).call<{ until: string }>('POST', `/v1/admin/reports/${r.id}/suspend`, { days: 7, notes: 'abusive banter' });
    expect(s.status).toBe(200);
    const refused = async (p: Player, method: string, path: string, body?: unknown) => {
      const res = await p.call<{ error: { code: string; message: string } }>(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.error.message).toMatch(/^A moderator paused posting, cups, groups and name changes on this account until \d{4}-\d{2}-\d{2}\. Matches and Daily Six still work\.$/);
    };
    await refused(c, 'POST', `/v1/rooms/${roomId}/banter`, { phraseId: 'banter.bring_it' });
    await refused(c, 'POST', '/v1/cups', { name: 'Late Cup', maxPlayers: 3, pace: 'sprint' });
    await refused(c, 'POST', '/v1/groups', { kind: 'college', name: 'Night Owls' });
    await refused(c, 'PATCH', '/v1/me', { alias: 'Another Name' });
    // Matches, the profile's other fields and muting still work.
    expect((await c.call('PATCH', '/v1/me', { city: 'pune' })).status).toBe(200);
    expect((await c.call('POST', `/v1/rooms/${roomId}/settings`, { muted: true })).status).toBe(200);
    expect((await c.lock(matchId, 2)).status).toBe(200);
    expect((await c.call('POST', '/v1/duels', {})).status).toBe(201);
    expect((await queue(b, '?status=closed')).reports[0].player?.suspendedUntil).toBe(s.body.until);
    // Lifted early…
    expect((await new Admin(b).call('POST', `/v1/admin/reports/${r.id}/unsuspend`, { notes: 'appeal accepted' })).status).toBe(200);
    expect((await c.call('POST', `/v1/rooms/${roomId}/banter`, { phraseId: 'banter.bring_it' })).status).toBe(200);
    // …or at its end.
    await new Admin(b).call('POST', `/v1/admin/reports/${r.id}/suspend`, { days: 1 });
    await refused(c, 'PATCH', '/v1/me', { alias: 'Another Name' });
    await advanceTo(b, b.clock.now() + 86_400_000 + 60_000);
    expect((await c.call('PATCH', '/v1/me', { alias: 'Another Name' })).status).toBe(200);
    const history = (await queue(b, '?status=closed')).reports[0].history.map((h) => h.action);
    expect(history).toEqual(['suspended', 'unsuspended', 'suspended']);
    b.close();
  });

  it('remove-post takes a reported post down from its room', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    const roomId = (await a.view(matchId)).body.roomId as string;
    await c.call('POST', `/v1/rooms/${roomId}/banter`, { phraseId: 'banter.bring_it' });
    const post = (await roomView(a, roomId)).posts.find((p) => p.kind === 'banter')!;
    await a.call('POST', '/v1/report', { postId: post.postId, reason: 'spam' });
    const [r] = (await queue(b)).reports;
    // The author is found from the post itself.
    expect(r.player?.playerId).toBe(c.tokens!.playerId);
    expect((await new Admin(b).call<{ removed: boolean }>('POST', `/v1/admin/reports/${r.id}/remove-post`, {})).body).toEqual({ status: 'actioned', removed: true });
    expect((await roomView(a, roomId)).posts.some((p) => p.postId === post.postId)).toBe(false);
    expect((await queue(b, '?status=closed')).reports[0].post).toMatchObject({ postId: post.postId, present: false });
    // A player report has no post to remove.
    await a.call('POST', '/v1/report', { playerId: c.tokens!.playerId, reason: 'spam' });
    const [p] = (await queue(b)).reports;
    expect((await new Admin(b).call('POST', `/v1/admin/reports/${p.id}/remove-post`, {})).status).toBe(409);
    b.close();
  });
});
