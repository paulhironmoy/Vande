// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { RoomView } from '@/contracts';
import { Player, backend, duel, roomView } from './helpers';

const roomOf = (matchId: string) => `r${matchId.slice(1)}`;

describe('Cricket Room of a duel', () => {
  it('is for the two players only and posts only meaningful, spoiler-safe events', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    const roomId = roomOf(matchId);
    const x = new Player(b);
    await x.signup();
    expect((await x.call('GET', `/v1/rooms/${roomId}`)).status).toBe(404);
    expect((await x.call('POST', `/v1/rooms/${roomId}/banter`, { phraseId: 'banter.bring_it' })).status).toBe(404);
    let room = await roomView(c, roomId);
    expect(room.kind).toBe('duel');
    expect(room.members.map((m) => m.alias).sort()).toEqual(['Calm Cobra', 'Swift Tiger']);
    expect(room.posts.map((p) => p.kind)).toEqual(['invite']);
    expect(room.freeText).toBe(false);
    await a.lock(matchId, 1);
    room = await roomView(c, roomId);
    expect(room.posts.some((p) => p.kind === 'lock_status')).toBe(false); // one lock would say who
    await c.lock(matchId, 2);
    await a.batInnings(matchId);
    room = await roomView(a, roomId);
    expect(room.posts.find((p) => p.kind === 'lock_status')?.payload).toEqual({ locked: 2, total: 2 });
    for (const p of room.posts) expect(JSON.stringify(p.payload)).not.toMatch(/Runs|Wickets|winner/i);
    expect(room.posts.every((p) => /T\d\d:00:00\.000Z$/.test(p.createdHour))).toBe(true);
    await c.batInnings(matchId);
    room = await roomView(a, roomId);
    const scorecard = room.posts.find((p) => p.kind === 'scorecard');
    expect(scorecard?.payload).toMatchObject({ matchId, homeAlias: 'Swift Tiger', awayAlias: 'Calm Cobra' });
    expect(room.posts[0].kind).toBe('scorecard');
    expect(room.posts.map((p) => p.kind)).toContain('reveal_ready');
    b.close();
  });

  it('reactions, predefined banter only, and a gentle rate limit', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    const roomId = roomOf(matchId);
    const room = await roomView(a, roomId);
    const postId = room.posts[0].postId;
    expect((await a.call('POST', `/v1/rooms/${roomId}/react`, { postId, reaction: 'fire' })).status).toBe(200);
    expect((await c.call('POST', `/v1/rooms/${roomId}/react`, { postId, reaction: 'fire' })).status).toBe(200);
    expect((await c.call('POST', `/v1/rooms/${roomId}/react`, { postId, reaction: 'clap' })).status).toBe(200);
    let v = await roomView(a, roomId);
    expect(v.posts[0].reactions).toEqual({ fire: 1, clap: 1 });
    expect(v.posts[0].myReaction).toBe('fire');
    await a.call('POST', `/v1/rooms/${roomId}/react`, { postId, reaction: null });
    v = await roomView(a, roomId);
    expect(v.posts[0].reactions).toEqual({ clap: 1 });
    expect((await a.call('POST', `/v1/rooms/${roomId}/react`, { postId, reaction: 'poop' })).status).toBe(400);
    expect((await a.call('POST', `/v1/rooms/${roomId}/react`, { postId: `${roomId}.999`, reaction: 'fire' })).status).toBe(404);
    expect((await a.call('POST', `/v1/rooms/${roomId}/banter`, { phraseId: 'banter.yorker_incoming' })).status).toBe(200);
    expect((await a.call('POST', `/v1/rooms/${roomId}/banter`, { phraseId: 'you are rubbish' })).status).toBe(400);
    v = await roomView(c, roomId);
    expect(v.posts[0]).toMatchObject({ kind: 'banter', payload: { phraseId: 'banter.yorker_incoming' }, authorId: a.tokens!.playerId });
    const statuses = [];
    for (let i = 0; i < 12; i++) statuses.push((await a.call('POST', `/v1/rooms/${roomId}/banter`, { phraseId: 'banter.bring_it' })).status);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    b.close();
  });

  it('free text is off unless the deployment enables it, and then it is moderated', async () => {
    const off = await backend();
    const d1 = await duel(off);
    expect((await d1.a.call('POST', `/v1/rooms/${roomOf(d1.matchId)}/text`, { text: 'good luck!' })).status).toBe(403);
    off.close();
    const on = await backend({ vars: { ROOM_FREE_TEXT: '1' } });
    const d2 = await duel(on);
    const roomId = roomOf(d2.matchId);
    expect((await d2.a.call('POST', `/v1/rooms/${roomId}/text`, { text: 'Good luck, see you at the reveal!' })).status).toBe(200);
    expect((await d2.a.call('POST', `/v1/rooms/${roomId}/text`, { text: 'you chutiya' })).status).toBe(400);
    expect((await d2.a.call('POST', `/v1/rooms/${roomId}/text`, { text: 'call me 98765 43210' })).status).toBe(400);
    expect((await roomView(d2.c, roomId)).freeText).toBe(true);
    on.close();
  });

  it('mute and notify settings are stored for the notification consumer', async () => {
    const b = await backend();
    const { a, matchId } = await duel(b);
    const roomId = roomOf(matchId);
    expect((await a.call('POST', `/v1/rooms/${roomId}/settings`, { muted: true })).status).toBe(200);
    expect(b.db.db.prepare('SELECT muted, notify FROM room_settings').all()).toEqual([{ muted: 1, notify: 'all' }]);
    await a.call('POST', `/v1/rooms/${roomId}/settings`, { muted: false, notify: 'important' });
    expect(b.db.db.prepare('SELECT muted, notify FROM room_settings').all()).toEqual([{ muted: 0, notify: 'important' }]);
    expect((await roomView(a, roomId))).toMatchObject({ muted: false, notify: 'important' });
    await a.call('POST', `/v1/rooms/${roomId}/settings`, { notify: 'all' });
    expect(b.db.db.prepare('SELECT * FROM room_settings').all()).toEqual([]);
    expect((await a.call('POST', `/v1/rooms/${roomId}/settings`, { notify: 'sometimes' })).status).toBe(400);
    b.close();
  });

  it('blocking hides a player’s banter from the blocker only; reports name the post', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    const roomId = roomOf(matchId);
    await a.call('POST', `/v1/rooms/${roomId}/banter`, { phraseId: 'banter.bring_it' });
    const before: RoomView = await roomView(c, roomId);
    const banterPost = before.posts.find((p) => p.kind === 'banter')!;
    expect((await c.call('POST', '/v1/report', { postId: banterPost.postId, reason: 'abusive' })).status).toBe(200);
    expect(b.db.db.prepare('SELECT target_kind, target_id FROM reports').get()).toEqual({ target_kind: 'post', target_id: banterPost.postId });
    await c.call('POST', `/v1/blocks/${a.tokens!.playerId}`);
    expect((await roomView(c, roomId)).posts.some((p) => p.kind === 'banter')).toBe(false);
    expect((await roomView(a, roomId)).posts.some((p) => p.kind === 'banter')).toBe(true);
    b.close();
  });

  it('forgets a deleted player: their posts and seat become "Deleted player"', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    const roomId = roomOf(matchId);
    await a.call('POST', `/v1/rooms/${roomId}/banter`, { phraseId: 'banter.good_game' });
    await a.call('DELETE', '/v1/me');
    const v = await roomView(c, roomId);
    expect(v.members.map((m) => m.alias).sort()).toEqual(['Calm Cobra', 'Deleted player']);
    expect(v.posts.find((p) => p.kind === 'banter')?.authorId).toBe('p-deleted');
    expect(JSON.stringify(v)).not.toContain(a.tokens!.playerId);
    b.close();
  });
});
