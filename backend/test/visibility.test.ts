// @vitest-environment node
/**
 * Activity jitter and reveal slots (security review, finding 5, with root's refinement): a player learns at once what
 * their own action completes (the second locker bats at once; the second finisher sees the reveal countdown at once)
 * and learns about the opponent's actions only after the jitter. A lock or a finished innings reaches the opponent
 * (view, phase, match list, push), the room and the cup only after the same random delay; a duel reveals for both at
 * the next 5-minute slot at least 60 s after both innings end; in a cup other members' fixtures show counts only.
 */
import { describe, expect, it } from 'vitest';
import type { MatchView } from '@/contracts';
import type { LocalBackend } from '../local/harness';
import { revealSlotAt, type MatchMeta } from '../src/match/state';
import { advanceTo, backend, cup, cupView, duel, roomView } from './helpers';

const JITTER = { ACTIVITY_JITTER_S: '60-600' };
const SLOTS = { ACTIVITY_JITTER_S: '60-600', DUEL_REVEAL_SLOT_S: '300' };
const HEX64 = /^[0-9a-f]{64}$/;

async function meta(b: LocalBackend, matchId: string): Promise<MatchMeta> {
  return (await b.matches.storage(matchId).get<MatchMeta>(['meta'])).get('meta')!;
}

async function listRow(b: LocalBackend, uid: string, matchId: string) {
  return b.db.prepare('SELECT updated_ms, view_json FROM match_players WHERE uid = ?1 AND match_id = ?2').bind(uid, matchId).first<{ updated_ms: number; view_json: string }>();
}

const uidOf = (token: string) => JSON.parse(Buffer.from(token.split('.')[2], 'base64url').toString()).sub as string;

describe('activity jitter in a duel', () => {
  it('hides the opponent lock (view, phase, commit, list order) until the push arrives, then shows it', async () => {
    const b = await backend({ vars: JITTER });
    const { a, c, matchId } = await duel(b);
    const cUid = uidOf(c.tokens!.accessToken);
    const rowBefore = await listRow(b, cUid, matchId);
    b.clock.advance(5_000);
    expect((await a.lock(matchId, 1)).status).toBe(200);
    const visibleAt = (await meta(b, matchId)).visibleAt!.lock[0]!;
    const delay = visibleAt - b.clock.now();
    expect(delay).toBeGreaterThanOrEqual(60_000);
    expect(delay).toBeLessThanOrEqual(600_000);
    const hidden = (await c.view(matchId)).body as MatchView;
    expect(hidden.locked).toEqual([false, false]);
    expect(hidden.opponentCommit).toBeNull();
    // The opponent's row in the match list is not rewritten (its order and content say nothing yet).
    expect(await listRow(b, cUid, matchId)).toEqual(rowBefore);
    // The push is held back exactly as long.
    const pushAt = (b.notify as unknown as { messages: Array<{ body: { kind: string }; notBefore: number }> }).messages.find((m) => m.body.kind === 'opponent_locked')!.notBefore;
    expect(Math.abs(pushAt - visibleAt)).toBeLessThan(1_000);
    expect((await a.view(matchId)).body.locked).toEqual([true, false]); // the player's own flag is exact
    await advanceTo(b, visibleAt + 1);
    const shown = (await c.view(matchId)).body as MatchView;
    expect(shown.locked).toEqual([true, false]);
    expect(shown.opponentCommit).toMatch(HEX64);
    expect(JSON.parse((await listRow(b, cUid, matchId))!.view_json).locked).toEqual([true, false]);
    // No exact time leaves the object: the view carries none of the internal times.
    const m = await meta(b, matchId);
    expect(JSON.stringify(shown)).not.toContain(String(m.lockedAt![0]));
    b.close();
  });

  it('the second locker bats at once; the first waits for the jittered visibility; the room card waits too', async () => {
    const b = await backend({ vars: JITTER });
    const { a, c, matchId } = await duel(b);
    expect((await a.lock(matchId, 1)).status).toBe(200);
    expect((await c.lock(matchId, 2)).status).toBe(200); // same millisecond: still strictly second
    // c's own lock completed the pair: c knows both overs are sealed and bats at once.
    const cv = (await c.view(matchId)).body as MatchView;
    expect(cv.phase).toBe('batting');
    expect(cv.locked).toEqual([true, true]);
    expect(cv.opponentCommit).toMatch(HEX64);
    expect((await c.next(matchId)).status).toBe(200);
    // a locked first and learns of c's lock only after the jitter: planning, and batting is refused like before a lock.
    const av = (await a.view(matchId)).body as MatchView;
    expect(av.phase).toBe('planning');
    expect(av.locked).toEqual([true, false]);
    expect(av.opponentCommit).toBeNull();
    expect((await a.next(matchId)).status).toBe(409);
    expect((await roomView(a, `r${matchId.slice(1)}`)).posts.some((p) => p.kind === 'lock_status')).toBe(false);
    const m = await meta(b, matchId);
    await advanceTo(b, m.visibleAt!.lock[1]! + 1);
    expect((await a.view(matchId)).body.phase).toBe('batting');
    expect((await a.next(matchId)).status).toBe(200);
    await advanceTo(b, Math.max(m.visibleAt!.lock[0]!, m.visibleAt!.lock[1]!) + 1);
    expect((await roomView(a, `r${matchId.slice(1)}`)).posts.find((p) => p.kind === 'lock_status')?.payload).toEqual({ locked: 2, total: 2 });
    b.close();
  });

  it('a finished innings is hidden from the opponent the same way, and never before the lock it follows', async () => {
    const b = await backend({ vars: JITTER });
    const { a, c, matchId } = await duel(b);
    await a.lock(matchId, 1);
    await c.lock(matchId, 2);
    await c.batInnings(matchId); // the second locker bats at once, maybe before its lock is visible to a
    const m = await meta(b, matchId);
    expect(m.visibleAt!.done[1]!).toBeGreaterThanOrEqual(m.visibleAt!.lock[1]!);
    expect((await a.view(matchId)).body.battingDone).toEqual([false, false]);
    expect((await c.view(matchId)).body.battingDone).toEqual([false, true]);
    await advanceTo(b, m.visibleAt!.done[1]! + 1);
    const av = (await a.view(matchId)).body as MatchView;
    expect(av.battingDone).toEqual([false, true]);
    expect(av.locked).toEqual([true, true]);
    b.close();
  });
});

describe('duel reveal slots', () => {
  it('the slot is the next whole 5 minutes at least 60 s away (0: at once)', () => {
    const t = Date.UTC(2026, 9, 26, 6, 30, 0);
    const min = 60_000;
    expect(revealSlotAt(t, 300_000)).toBe(t + 5 * min); // on a boundary: 60 s later is 06:31, so 06:35
    expect(revealSlotAt(t + 4 * min, 300_000)).toBe(t + 5 * min); // exactly 60 s before the boundary
    expect(revealSlotAt(t + 4 * min + 1, 300_000)).toBe(t + 10 * min); // less than 60 s left: the next one
    expect(revealSlotAt(t + 3 * min + 59_999, 300_000)).toBe(t + 5 * min);
    expect(revealSlotAt(t + 123, 0)).toBe(t + 123);
    for (let now = t; now < t + 30 * min; now += 7_919) {
      const slot = revealSlotAt(now, 300_000);
      expect(slot % 300_000).toBe(0);
      expect(slot - now).toBeGreaterThanOrEqual(min);
      expect(slot - now).toBeLessThanOrEqual(min + 300_000);
    }
  });

  it('the second finisher sees the countdown at once, the first only once it is visible; both reveal at the slot', async () => {
    const b = await backend({ vars: SLOTS });
    const { a, c, matchId } = await duel(b);
    await a.lock(matchId, 1);
    await c.lock(matchId, 2);
    await advanceTo(b, b.clock.now() + 11 * 60_000);
    await a.batInnings(matchId); // a finishes first
    b.clock.advance(30_000);
    await c.batInnings(matchId); // c's last ball ends both innings
    const m = await meta(b, matchId);
    const slot = m.revealAtMs!;
    expect(m.phase).toBe('batting');
    expect(slot).toBe(revealSlotAt(m.doneAt![1]!, 300_000));
    expect(slot % 300_000).toBe(0);
    // c completed it: awaiting the reveal, with the countdown, at once.
    const cv = (await c.view(matchId)).body as MatchView;
    expect(cv.phase).toBe('awaiting_reveal');
    expect(cv.battingDone).toEqual([true, true]);
    expect(cv.deadlines.revealAt).toBe(new Date(slot).toISOString());
    // a learns only after the jitter: no countdown, c's innings not shown as done.
    const av = (await a.view(matchId)).body as MatchView;
    expect(av.phase).toBe('awaiting_reveal');
    expect(av.deadlines.revealAt).toBeNull();
    // Nothing is revealed or announced before the slot.
    expect((await a.call('GET', `/v1/matches/${matchId}/reveal`)).status).toBe(409);
    expect((await c.call('GET', `/v1/matches/${matchId}/reveal`)).status).toBe(409);
    expect(b.notify.sent.filter((x) => x.kind === 'reveal_ready')).toEqual([]);
    expect((await roomView(a, `r${matchId.slice(1)}`)).posts.some((p) => p.kind === 'reveal_ready' || p.kind === 'scorecard')).toBe(false);
    const doneSeen = m.visibleAt!.done[1]!;
    if (doneSeen < slot) {
      await advanceTo(b, doneSeen + 1);
      const later = (await a.view(matchId)).body as MatchView;
      expect(later.deadlines.revealAt).toBe(new Date(slot).toISOString());
      expect(later.battingDone).toEqual([true, true]);
      expect(b.notify.sent.filter((x) => x.kind === 'reveal_ready')).toEqual([]);
    }
    await advanceTo(b, slot + 1);
    expect((await a.view(matchId)).body.phase).toBe('revealed');
    expect((await c.view(matchId)).body.phase).toBe('revealed');
    expect((await a.call('GET', `/v1/matches/${matchId}/reveal`)).status).toBe(200);
    const pushes = b.notify.sent.filter((x) => x.kind === 'reveal_ready');
    expect(pushes).toHaveLength(2);
    expect((await roomView(a, `r${matchId.slice(1)}`)).posts.some((p) => p.kind === 'scorecard')).toBe(true);
    b.close();
  });

  it('cups keep their fixed reveal times (no slot)', async () => {
    const b = await backend({ vars: SLOTS });
    const s = await cup(b, 4);
    const v0 = await cupView(s.players[0], s.cupId);
    await advanceTo(b, Date.parse(v0.schedule.rounds[0].lockBy) - 3_600_000 + 60_000);
    const fixture = (await cupView(s.players[0], s.cupId)).fixtures.find((f) => f.round === 1)!;
    expect((await meta(b, fixture.matchId)).revealAtMs).toBe(Date.parse(v0.schedule.rounds[0].revealAt));
    b.close();
  });
});

describe('activity jitter in a Group Cup', () => {
  it('other fixtures show counts only; the second locker gets the bat task at once, the first after the jitter', async () => {
    const b = await backend({ vars: JITTER });
    const s = await cup(b, 4);
    const v0 = await cupView(s.players[0], s.cupId);
    await advanceTo(b, Date.parse(v0.schedule.rounds[0].lockBy) - 3_600_000 + 60_000);
    const v1 = await cupView(s.players[0], s.cupId);
    const ids = v1.members.map((m) => m.id);
    const target = v1.fixtures.find((f) => f.round === 1)!;
    const home = s.players[ids.indexOf(target.home)];
    const away = s.players[ids.indexOf(target.away)];
    const observer = s.players.find((p) => p !== home && p !== away)!;
    expect((await home.lock(target.matchId, 1)).status).toBe(200);
    expect((await away.lock(target.matchId, 2)).status).toBe(200);
    await b.idle();
    // Nothing visible to others yet: the count did not move.
    expect((await cupView(observer, s.cupId)).lockedCount).toEqual({ round: 1, locked: 0, total: 4 });
    // away completed the pair: bat task and "batting" at once; home (the first locker) has neither yet.
    const awayView = await cupView(away, s.cupId);
    expect(awayView.myTasks.some((t) => t.kind === 'bat' && t.matchId === target.matchId)).toBe(true);
    expect(awayView.fixtures.find((f) => f.matchId === target.matchId)?.status).toBe('batting');
    const homeView = await cupView(home, s.cupId);
    expect(homeView.myTasks.filter((t) => t.kind === 'lock' || t.kind === 'bat')).toEqual([]);
    expect(homeView.fixtures.find((f) => f.matchId === target.matchId)?.status).toBe('planning');
    await advanceTo(b, b.clock.now() + 11 * 60_000);
    await b.idle();
    const later = await cupView(observer, s.cupId);
    expect(later.lockedCount).toEqual({ round: 1, locked: 2, total: 4 });
    // The observer never learns which pair locked.
    expect(later.fixtures.filter((f) => f.round === 1).map((f) => f.status)).toEqual(['planning', 'planning']);
    expect((await cupView(home, s.cupId)).myTasks.some((t) => t.kind === 'bat' && t.matchId === target.matchId)).toBe(true);
    expect((await cupView(home, s.cupId)).fixtures.find((f) => f.matchId === target.matchId)?.status).toBe('batting');
    b.close();
  });
});
