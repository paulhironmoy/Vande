import { describe, expect, it } from 'vitest';
import type { CupView, Fixture, MatchEventLog, RoomPost, StandingRow } from '@/contracts';
import { cupState, currentRound, movementOf, myFixtures, mySeat, nextTask, nrrText, phaseAt, playedByAuto, roundsOf, startsAt } from '@/social/cups/cupModel';
import { cardOf, codeFromUrl, rematchTarget, reportable, withReaction } from '@/social/rooms/roomModel';
import { consentDeadline, statusGroup, withDisplayNames, withdrawEffect, youtubeUrl } from '@/social/highlights/highlightModel';
import { decidedAt, istDay, previousDay } from '@/social/components/time';

const ref = (id: string, alias: string) => ({ id, alias, avatar: { seed: `${id}seed` }, kit: { id: 'starter' as const, primary: '#111111', secondary: '#222222', pattern: 'plain' as const }, kind: 'human' as const });
const T = (h: number) => new Date(Date.UTC(2026, 9, 26, h)).toISOString();

function fixture(over: Partial<Fixture>): Fixture {
  return { fixtureId: 'f', round: 1, home: 'pa', away: 'pb', matchId: 'm1', status: 'planning', auto: [false, false], ...over };
}

function cup(over: Partial<CupView> = {}): CupView {
  return {
    cupId: 'c1',
    name: 'Office Cup',
    status: 'group_stage',
    size: 4,
    members: [ref('pa', 'Asha'), ref('pb', 'Bala'), ref('pc', 'Chandu')],
    inviteToken: null,
    schedule: { rounds: [{ round: 1, lockBy: T(8), batBy: T(9), revealAt: T(9) }, { round: 2, lockBy: T(10), batBy: T(11), revealAt: T(11) }], final: { lockBy: T(12), batBy: T(13), revealAt: T(13) } },
    fixtures: [fixture({ fixtureId: 'f1', round: 1, home: 'pa', away: 'pb', matchId: 'm1', status: 'revealed', auto: [false, true] }), fixture({ fixtureId: 'f2', round: 2, home: 'pc', away: 'pa', matchId: 'm2' })],
    standings: [],
    roomId: 'r1',
    myTasks: [],
    lockedCount: { round: 2, locked: 1, total: 2 },
    winner: null,
    ...over,
  };
}

describe('cup model', () => {
  it('derives rounds with their public phases and the round in play', () => {
    const now = Date.UTC(2026, 9, 26, 10, 30);
    const rounds = roundsOf(cup(), now);
    expect(rounds.map((r) => [r.round, r.phase])).toEqual([[1, 'revealed'], [2, 'batting'], ['final', 'locking']]);
    expect(currentRound(rounds)?.round).toBe(2);
    expect(phaseAt({ lockBy: T(10), batBy: T(11), revealAt: T(12) }, Date.UTC(2026, 9, 26, 11, 30))).toBe('revealing');
  });

  it('follows the server for the round in play, whatever the device clock says', () => {
    // The device clock is hours behind (round 1 still "locking" by it), but the server has revealed round 1 and opened round 2.
    const behind = roundsOf(cup(), Date.UTC(2026, 9, 26, 6));
    expect(behind[0].phase).toBe('locking');
    expect(currentRound(behind)?.round).toBe(2);
    // ...or hours ahead: round 2 is still open on the server.
    expect(currentRound(roundsOf(cup(), Date.UTC(2026, 9, 26, 20)))?.round).toBe(2);
    // Nothing open (between rounds): the clock picks the next round that still has fixtures to play.
    const between = cup({ fixtures: [fixture({ fixtureId: 'f1', round: 1, status: 'revealed' }), fixture({ fixtureId: 'f2', round: 2, status: 'scheduled' })] });
    expect(currentRound(roundsOf(between, Date.UTC(2026, 9, 26, 9, 30)))?.round).toBe(2);
    // All revealed: no round in play.
    expect(currentRound(roundsOf(cup({ fixtures: [fixture({ fixtureId: 'f1', round: 1, status: 'revealed' })] }), Date.UTC(2026, 9, 26, 6)))).toBeNull();
  });

  it('knows my fixtures, my side and when Auto played for me', () => {
    const c = cup();
    expect(myFixtures(c, 'pb').map((f) => f.fixtureId)).toEqual(['f1']);
    expect(mySeat(c.fixtures[1], 'pa')).toBe(1);
    expect(mySeat(c.fixtures[1], 'zz')).toBeNull();
    expect(playedByAuto(c.fixtures[0], 'pb')).toBe(true);
    expect(playedByAuto(c.fixtures[0], 'pa')).toBe(false);
  });

  it('names the cup state, including a gathering cup short of players', () => {
    expect(cupState(cup({ status: 'gathering', members: [ref('pa', 'A'), ref('pb', 'B')] }))).toBe('gathering_short');
    expect(cupState(cup({ status: 'gathering' }))).toBe('gathering');
    expect(cupState(cup({ status: 'cancelled' }))).toBe('cancelled');
    expect(startsAt(cup())).toBe(T(8));
  });

  it('never relies on colour: movement and NRR carry their own sign', () => {
    const row = (movement: number) => ({ movement }) as StandingRow;
    expect([movementOf(row(2)), movementOf(row(-1)), movementOf(row(0))]).toEqual(['up', 'down', 'same']);
    const fmt = (n: number) => n.toFixed(2);
    expect([nrrText(1.25, fmt), nrrText(-0.5, fmt), nrrText(0, fmt)]).toEqual(['+1.25', '−0.50', '0.00']);
  });
});

describe('room cards', () => {
  const post = (kind: RoomPost['kind'], payload: RoomPost['payload'], extra: Partial<RoomPost> = {}): RoomPost => ({ postId: 'p1', kind, payload, authorId: null, createdHour: T(10), reactions: {}, myReaction: null, ...extra });
  const members = [ref('pa', 'Asha'), ref('pb', 'Bala')];

  it('builds a card for every kind from the closed payload keys only', () => {
    expect(cardOf(post('lock_status', { round: '2', locked: 3, total: 6 }), members)).toEqual({ kind: 'lock_status', round: '2', locked: 3, total: 6 });
    expect(cardOf(post('reveal_ready', { round: '1', stage: 'final' }), members)).toMatchObject({ kind: 'reveal_ready', final: true, matchId: null });
    expect(cardOf(post('scorecard', { homeAlias: 'Asha', awayAlias: 'Bala', homeRuns: 21, homeWickets: 1, awayRuns: 19, awayWickets: 2, winnerAlias: 'Asha', tie: false }), members)).toMatchObject({ kind: 'scorecard', winner: 'Asha', homeRuns: 21 });
    expect(cardOf(post('banter', { phraseId: 'banter.good_game' }, { authorId: 'pb' }), members)).toMatchObject({ kind: 'banter', author: { alias: 'Bala' } });
    expect(cardOf(post('highlight', { url: 'https://vande.example/h/k7q2m9xa', title: 'Asha vs Bala' }), members)).toMatchObject({ kind: 'highlight', code: 'k7q2m9xa' });
    expect(cardOf(post('achievement', { badge: 'cup_winner', alias: 'Asha' }), members)).toEqual({ kind: 'achievement', badge: 'cup_winner', alias: 'Asha' });
    expect(cardOf({ ...post('text', {}), kind: 'mystery' as RoomPost['kind'] }, members)).toEqual({ kind: 'unknown' });
  });

  it('says plainly when Auto stepped in, and a lock reminder stays a reminder', () => {
    expect(cardOf(post('deadline', { round: '1', phase: 'auto_over', alias: 'Bala' }), members)).toEqual({ kind: 'deadline', round: '1', phase: 'auto_over', by: null, alias: 'Bala' });
    expect(cardOf(post('deadline', { phase: 'auto_xi', alias: 'Asha' }), members)).toMatchObject({ phase: 'auto_xi', alias: 'Asha' });
    expect(cardOf(post('deadline', { phase: 'lock', by: T(12) }), members)).toMatchObject({ phase: 'lock', by: T(12), alias: null });
    expect(cardOf(post('deadline', { phase: 'something else' }), members)).toMatchObject({ phase: 'lock' });
  });

  it('a rematch card leads the asker to the new duel and the opponent to the offer on the old one', () => {
    const card = cardOf(post('rematch', { matchId: 'm-new', fromAlias: 'Asha', fromId: 'pa', rematchOf: 'm-old' }), members);
    expect(card).toEqual({ kind: 'rematch', matchId: 'm-new', fromAlias: 'Asha', fromId: 'pa', rematchOf: 'm-old' });
    if (card.kind !== 'rematch') throw new Error('not a rematch card');
    expect(rematchTarget(card, 'pa')).toBe('m-new');
    expect(rematchTarget(card, 'pb')).toBe('m-old');
    // Older cards without the new fields still open the new duel.
    const old = cardOf(post('rematch', { matchId: 'm-new', fromAlias: 'Asha' }), members);
    if (old.kind !== 'rematch') throw new Error('not a rematch card');
    expect(rematchTarget(old, 'pb')).toBe('m-new');
  });

  it('a reaction toggles optimistically without inventing counts', () => {
    const p = post('banter', { phraseId: 'banter.rematch' }, { reactions: { clap: 2 }, myReaction: 'clap' });
    expect(withReaction(p, 'fire')).toMatchObject({ reactions: { clap: 1, fire: 1 }, myReaction: 'fire' });
    expect(withReaction(p, null)).toMatchObject({ reactions: { clap: 1 }, myReaction: null });
    expect(withReaction(post('banter', {}, { reactions: { clap: 1 }, myReaction: 'clap' }), null).reactions).toEqual({});
  });

  it('only member posts by others can be reported or blocked', () => {
    expect(reportable(post('banter', {}, { authorId: 'pb' }), 'pa')).toBe(true);
    expect(reportable(post('banter', {}, { authorId: 'pa' }), 'pa')).toBe(false);
    expect(reportable(post('scorecard', {}), 'pa')).toBe(false);
    expect(codeFromUrl('https://x.example/Vande/h/abcd1234?a=wa')).toBe('abcd1234');
    expect(codeFromUrl('https://x.example/i/abcd1234')).toBeNull();
  });
});

describe('highlight model and time', () => {
  it('groups statuses as the player sees them and states the withdrawal effect', () => {
    expect(statusGroup('pending_consent')).toBe('decide');
    expect(statusGroup('pending_moderation')).toBe('queued');
    expect(statusGroup('dead_letter')).toBe('failed');
    expect(statusGroup('unlisted')).toBe('live');
    expect(withdrawEffect('scheduled')).toBe('cancel');
    expect(withdrawEffect('uploading')).toBe('remove');
    expect(withdrawEffect('published')).toBe('remove');
    expect(withdrawEffect('consent_declined')).toBe('nothing');
    expect(youtubeUrl('abc_DEF-123')).toBe('https://www.youtube.com/shorts/abc_DEF-123');
  });

  it('uses public rule times only: midnight IST and 48 hours of consent', () => {
    expect(decidedAt('2026-10-26')).toBe('2026-10-26T18:30:00.000Z');
    expect(consentDeadline({ day: '2026-10-26' })).toBe('2026-10-28T18:30:00.000Z');
    expect(istDay(Date.UTC(2026, 9, 26, 18, 29))).toBe('2026-10-26');
    expect(istDay(Date.UTC(2026, 9, 26, 18, 30))).toBe('2026-10-27');
    expect(previousDay('2026-11-01')).toBe('2026-10-31');
  });
});

describe('highlight display names', () => {
  it('replaces the match-time aliases with the moderated names, in log.players order, and keeps the rest', () => {
    const p = (id: string, alias: string) => ({ id, alias, avatar: { seed: `${id}seed01` }, kit: { id: 'starter' as const, primary: '#111111', secondary: '#222222', pattern: 'plain' as const }, kind: 'human' as const });
    const log = { matchId: 'm1', players: [p('a', 'Old Name'), p('b', 'Calm Cobra')] } as unknown as MatchEventLog;
    const shown = withDisplayNames(log, ['Swift Tiger', null]);
    expect(shown.players.map((x) => x.alias)).toEqual(['Swift Tiger', 'Calm Cobra']);
    expect(shown.players[0].id).toBe('a');
    expect(log.players[0].alias).toBe('Old Name');
  });
});

describe('my next fixture', () => {
  it('puts a deadline (lock, then bat) before watching the last reveal, whatever the server order', () => {
    const watch = { kind: 'watch' as const, matchId: 'm1', by: null };
    const lock = { kind: 'lock' as const, matchId: 'm2', by: '2026-10-26T12:00:00.000Z' };
    const bat = { kind: 'bat' as const, matchId: 'm3', by: '2026-10-26T13:00:00.000Z' };
    expect(nextTask([watch, lock])).toBe(lock);
    expect(nextTask([watch, bat])).toBe(bat);
    expect(nextTask([bat, lock])).toBe(lock);
    expect(nextTask([watch])).toBe(watch);
    expect(nextTask([])).toBeNull();
  });
});
