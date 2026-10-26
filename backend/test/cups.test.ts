// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CupView, MatchEventLog, Profile, RoomPost } from '@/contracts';
import { computeStandings, roundRobin } from '../src/cup/schedule';
import { Player, advanceTo, backend, cup, cupView, playRound, roomView } from './helpers';

const HOUR = 3_600_000;

/** Runs a whole cup: each round is played (fully or partly) and then revealed by the clock. */
async function runCup(s: Awaited<ReturnType<typeof cup>>, opts: { locks?: (i: number, round: number | 'final') => boolean } = {}): Promise<CupView> {
  const { b, players, cupId } = s;
  let v = await cupView(players[0], cupId);
  await advanceTo(b, Date.parse(v.schedule.rounds[0].lockBy) - HOUR);
  for (let guard = 0; guard < 20; guard++) {
    v = await cupView(players[0], cupId);
    if (v.status === 'complete' || v.status === 'cancelled') return v;
    const open = v.status === 'final' && v.schedule.final ? { round: 'final' as const, ...v.schedule.final } : v.schedule.rounds.find((r) => Date.parse(r.revealAt) > b.clock.now());
    if (!open) throw new Error('no open round');
    const round = 'round' in open ? open.round : 'final';
    await playRound(players, cupId, { locks: (i) => (opts.locks ? opts.locks(i, round) : true) });
    await advanceTo(b, Date.parse(open.revealAt) + 2_000);
  }
  throw new Error('cup did not finish');
}

function checkTable(v: CupView, groupFixtures: number) {
  const points = v.standings.reduce((n, r) => n + r.points, 0);
  const played = v.standings.reduce((n, r) => n + r.played, 0);
  expect(played).toBe(groupFixtures * 2);
  expect(points).toBe(groupFixtures * 2);
  const nrr = v.standings.reduce((n, r) => n + r.netRunRate * r.played, 0);
  expect(Math.abs(nrr)).toBeLessThan(0.01 * v.standings.length);
  for (let i = 1; i < v.standings.length; i++) expect(v.standings[i - 1].points).toBeGreaterThanOrEqual(v.standings[i].points);
}

describe('round robin and standings', () => {
  it('pairs everyone exactly once with byes for odd counts and balanced seats', () => {
    for (const n of [3, 4, 5, 7, 10]) {
      const rounds = roundRobin(n);
      expect(rounds).toHaveLength(n % 2 ? n : n - 1);
      const pairs = new Set<string>();
      const home = new Array(n).fill(0);
      for (const round of rounds) {
        const busy = new Set<number>();
        for (const [h, a] of round) {
          expect(busy.has(h) || busy.has(a)).toBe(false);
          busy.add(h);
          busy.add(a);
          pairs.add([h, a].sort().join('-'));
          home[h]++;
        }
      }
      expect(pairs.size).toBe((n * (n - 1)) / 2);
      expect(Math.max(...home) - Math.min(...home)).toBeLessThanOrEqual(1);
    }
  });

  it('awards 2 for a win and 1 for a tie, orders by points then net run rate', () => {
    const t = computeStandings(4, [
      { home: 0, away: 1, runs: [24, 10], winner: 0 },
      { home: 2, away: 3, runs: [12, 12], winner: null },
      { home: 0, away: 2, runs: [8, 9], winner: 1 },
      { home: 1, away: 3, runs: [30, 6], winner: 0 },
    ]);
    // Points first (3, 2, 2, 1); the two on 2 points are split by net run rate (6.5 ahead of 5).
    expect(t.map((r) => [r.member, r.points])).toEqual([[2, 3], [0, 2], [1, 2], [3, 1]]);
    const byMember = Object.fromEntries(t.map((r) => [r.member, r]));
    expect(byMember[2]).toMatchObject({ points: 3, won: 1, tied: 1, lost: 0, form: ['T', 'W'] });
    expect(byMember[0]).toMatchObject({ points: 2, netRunRate: 6.5 });
    expect(byMember[1]).toMatchObject({ points: 2, netRunRate: 5 });
    expect(byMember[3]).toMatchObject({ points: 1, netRunRate: -12 });
    expect(t[0].member).toBe(2);
    expect(t[1].member).toBe(0);
  });
});

describe('Group Cup progression', () => {
  it('4 players: three rounds, a final, a winner with the cup_winner badge, every result in the room after its reveal', async () => {
    const b = await backend();
    const s = await cup(b, 4);
    const v = await runCup(s);
    expect(v.status).toBe('complete');
    expect(v.fixtures.filter((f) => f.round !== 'final')).toHaveLength(6);
    expect(v.fixtures.every((f) => f.status === 'revealed')).toBe(true);
    checkTable(v, 6);
    const finalFixture = v.fixtures.find((f) => f.round === 'final');
    expect([finalFixture?.home, finalFixture?.away].sort()).toEqual([v.standings[0].playerId, v.standings[1].playerId].sort());
    const profiles = await Promise.all(s.players.map((p) => p.call<Profile>('GET', '/v1/me')));
    expect(profiles.filter((p) => p.body.badges.includes('cup_winner'))).toHaveLength(1);
    // The champion is named once the final is revealed: a finalist, the one with the badge.
    const champion = profiles.find((p) => p.body.badges.includes('cup_winner'))?.body.playerId;
    expect(v.winner?.id).toBe(champion);
    expect([finalFixture?.home, finalFixture?.away]).toContain(v.winner?.id);
    const room = await roomView(s.players[2], v.roomId);
    const kinds = room.posts.map((p) => p.kind);
    expect(kinds.filter((k) => k === 'scorecard')).toHaveLength(7);
    expect(kinds.filter((k) => k === 'reveal_ready')).toHaveLength(4);
    expect(kinds).toContain('achievement');
    expect(kinds.filter((k) => k === 'standings')).toHaveLength(3);
    b.close();
  });

  it('3 players: a bye every round, then the final', async () => {
    const b = await backend();
    const s = await cup(b, 3);
    const v = await runCup(s);
    expect(v.status).toBe('complete');
    expect(v.fixtures.filter((f) => f.round !== 'final')).toHaveLength(3);
    expect(v.schedule.rounds).toHaveLength(3);
    checkTable(v, 3);
    b.close();
  });

  it('7 players, three of whom never play: Auto Over and Auto XI complete their fixtures', async () => {
    const b = await backend();
    const s = await cup(b, 7, { maxPlayers: 8 });
    const v = await runCup(s, { locks: (i) => i < 4 });
    expect(v.status).toBe('complete');
    expect(v.fixtures.filter((f) => f.round !== 'final')).toHaveLength(21);
    checkTable(v, 21);
    const absent = new Set(s.players.slice(4).map((p) => p.tokens!.playerId));
    for (const f of v.fixtures.filter((x) => x.round !== 'final')) {
      if (absent.has(f.home)) expect(f.auto[0]).toBe(true);
      if (absent.has(f.away)) expect(f.auto[1]).toBe(true);
    }
    b.close();
  });

  it('10 players and nobody ever plays (not even the creator): the cup still finishes on its own', async () => {
    const b = await backend();
    const s = await cup(b, 10);
    const start = await cupView(s.players[0], s.cupId);
    await advanceTo(b, Date.parse(start.schedule.rounds[8].revealAt) + 2_000);
    const mid = await cupView(s.players[5], s.cupId);
    expect(mid.status).toBe('final');
    expect(mid.fixtures.filter((f) => f.round !== 'final' && f.status === 'revealed')).toHaveLength(45);
    expect(mid.fixtures.every((f) => f.round === 'final' || (f.auto[0] && f.auto[1]))).toBe(true);
    checkTable(mid, 45);
    await advanceTo(b, Date.parse(mid.schedule.final!.revealAt) + 2_000);
    expect((await cupView(s.players[9], s.cupId)).status).toBe('complete');
    b.close();
  }, 60_000);
});

describe('Group Cup edge cases', () => {
  it('fewer than three players at the start: cancelled with a clear reason', async () => {
    const b = await backend();
    const s = await cup(b, 2, { maxPlayers: 6 });
    const v0 = await cupView(s.players[0], s.cupId);
    expect(v0.status).toBe('gathering');
    expect(v0.inviteToken).toBe(s.inviteToken);
    await advanceTo(b, b.clock.now() + 2 * HOUR);
    const v = await cupView(s.players[1], s.cupId);
    expect(v.status).toBe('cancelled');
    expect(v.fixtures).toEqual([]);
    expect(v.winner).toBeNull();
    const room = await roomView(s.players[0], v.roomId);
    expect(room.posts.find((p) => p.kind === 'standings')?.payload).toMatchObject({ status: 'cancelled', reason: 'fewer_than_three_players' });
    const late = new Player(b);
    await late.signup();
    expect((await late.call('POST', `/v1/invites/${s.inviteToken}/accept`)).status).toBe(410);
    b.close();
  });

  it('a full cup refuses more players; members only can see it', async () => {
    const b = await backend();
    const s = await cup(b, 3, { maxPlayers: 3 });
    const extra = new Player(b);
    await extra.signup();
    expect((await extra.call('POST', `/v1/invites/${s.inviteToken}/accept`)).status).toBe(409);
    expect((await extra.call('GET', `/v1/cups/${s.cupId}`)).status).toBe(404);
    expect((await extra.call('GET', `/v1/rooms/r${s.cupId.slice(1)}`)).status).toBe(404);
    const preview = await extra.call<{ kind: string; cupName: string; members: number }>('GET', `/v1/invites/${s.inviteToken}`);
    expect(preview.body).toMatchObject({ kind: 'cup', cupName: 'Office Cup 2026', members: 3 });
    expect(JSON.stringify(preview.body)).not.toMatch(/uid|alias":"(?!Cup Captain)/);
    b.close();
  });

  it('lock counts only ("2 of 4 locked"), never who or when; a missed lock becomes an Auto Over; late play is refused', async () => {
    const b = await backend();
    const s = await cup(b, 4);
    const v0 = await cupView(s.players[0], s.cupId);
    await advanceTo(b, Date.parse(v0.schedule.rounds[0].lockBy) - HOUR + 60_000);
    await playRound(s.players, s.cupId, { locks: (i) => i === 0 || i === 1, bats: () => false });
    const v1 = await cupView(s.players[3], s.cupId);
    expect(v1.lockedCount).toEqual({ round: 1, locked: 2, total: 4 });
    expect(v1.winner).toBeNull();
    const room = await roomView(s.players[3], v1.roomId);
    const lockPosts = room.posts.filter((p: RoomPost) => p.kind === 'lock_status');
    expect(lockPosts).toHaveLength(1);
    expect(lockPosts[0].payload).toEqual({ round: '1', locked: 2, total: 4 });
    expect(lockPosts[0].authorId).toBeNull();
    // Player 3 never locks: at the lock deadline an Auto Over is sealed for them.
    await advanceTo(b, Date.parse(v0.schedule.rounds[0].lockBy) + 1_000);
    const mine = (await cupView(s.players[3], s.cupId)).fixtures.find((f) => f.home === s.players[3].tokens!.playerId || f.away === s.players[3].tokens!.playerId)!;
    const late = await s.players[3].lock(mine.matchId, 9);
    expect(late.status).toBe(410);
    // Auto Over sealed the two missing overs: still only the players' own locks count, and the room says it plainly.
    expect((await cupView(s.players[0], s.cupId)).lockedCount).toEqual({ round: 1, locked: 2, total: 4 });
    const room2 = await roomView(s.players[0], v1.roomId);
    expect(room2.posts.filter((p: RoomPost) => p.kind === 'lock_status').map((p: RoomPost) => p.payload)).toEqual([{ round: '1', locked: 2, total: 4 }]);
    const autoCards = room2.posts.filter((p: RoomPost) => p.kind === 'deadline' && p.payload.phase === 'auto_over').map((p: RoomPost) => p.payload.alias);
    const aliasOf = (pl: (typeof s.players)[number]) => v1.members.find((m) => m.id === pl.tokens!.playerId)?.alias;
    expect(autoCards.sort()).toEqual([s.players[2], s.players[3]].map(aliasOf).sort());
    await advanceTo(b, Date.parse(v0.schedule.rounds[0].revealAt) + 2_000);
    const after = await cupView(s.players[3], s.cupId);
    const before = JSON.stringify(after.standings);
    // Practice after the deadline changes nothing official.
    expect((await s.players[3].next(mine.matchId)).status).toBe(409);
    const log = (await s.players[3].call<MatchEventLog>('GET', `/v1/matches/${mine.matchId}/reveal`)).body;
    expect(log.plans[0].balls).toHaveLength(6);
    expect(JSON.stringify((await cupView(s.players[3], s.cupId)).standings)).toBe(before);
    const seat = mine.home === s.players[3].tokens!.playerId ? 0 : 1;
    expect(log.commits[seat].auto).toBe(true);
    b.close();
  });

  it('round results stay sealed until the round reveal time, then all fixtures reveal together', async () => {
    const b = await backend();
    const s = await cup(b, 4);
    const v0 = await cupView(s.players[0], s.cupId);
    await advanceTo(b, Date.parse(v0.schedule.rounds[0].lockBy) - HOUR + 60_000);
    await playRound(s.players, s.cupId);
    const mid = await cupView(s.players[0], s.cupId);
    // Player 0 sees their own fixture's progress; the other fixture only as in progress (never which pair or when).
    const me = s.players[0].tokens!.playerId;
    const round1 = mid.fixtures.filter((f) => f.round === 1);
    expect(round1.find((f) => f.home === me || f.away === me)?.status).toBe('awaiting_reveal');
    expect(round1.find((f) => f.home !== me && f.away !== me)?.status).toBe('planning');
    expect(mid.standings.every((r) => r.played === 0)).toBe(true);
    const room = await roomView(s.players[1], mid.roomId);
    expect(room.posts.some((p) => p.kind === 'scorecard')).toBe(false);
    const f = mid.fixtures[0];
    expect((await s.players[0].call('GET', `/v1/matches/${f.matchId}/reveal`)).status).toBe(409);
    await advanceTo(b, Date.parse(v0.schedule.rounds[0].revealAt) + 2_000);
    const after = await cupView(s.players[0], s.cupId);
    expect(after.fixtures.filter((x) => x.round === 1).map((x) => x.status)).toEqual(['revealed', 'revealed']);
    expect(after.standings.reduce((n, r) => n + r.played, 0)).toBe(4);
    expect(after.myTasks.some((t) => t.kind === 'watch')).toBe(true);
    b.close();
  });

  it('table movement is reported after each reveal', async () => {
    const b = await backend();
    const s = await cup(b, 4);
    const v0 = await cupView(s.players[0], s.cupId);
    await advanceTo(b, Date.parse(v0.schedule.rounds[0].lockBy) - HOUR + 60_000);
    await playRound(s.players, s.cupId);
    await advanceTo(b, Date.parse(v0.schedule.rounds[0].revealAt) + 2_000);
    expect((await cupView(s.players[0], s.cupId)).standings.every((r) => r.movement === 0)).toBe(true);
    await playRound(s.players, s.cupId);
    await advanceTo(b, Date.parse(v0.schedule.rounds[1].revealAt) + 2_000);
    const v2 = await cupView(s.players[0], s.cupId);
    expect(v2.standings.reduce((n, r) => n + r.movement, 0)).toBe(0);
    b.close();
  });
});
