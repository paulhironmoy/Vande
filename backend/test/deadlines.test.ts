// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { MatchEventLog, RoomView } from '@/contracts';
import type { MatchMeta } from '../src/match/state';
import { fakeHelpers, testShot } from './fakeEngine';
import { Player, backend, duel } from './helpers';

const HOUR = 3_600_000;

async function meta(b: Awaited<ReturnType<typeof backend>>, matchId: string): Promise<MatchMeta> {
  return (await b.matches.storage(matchId).get<MatchMeta>(['meta'])).get('meta')!;
}

describe('deadlines', () => {
  it('an invite nobody accepts expires at the lock deadline (alarm)', async () => {
    const b = await backend();
    const a = new Player(b);
    await a.signup();
    const d = await a.call<{ matchId: string; inviteToken: string }>('POST', '/v1/duels', {});
    await a.lock(d.body.matchId, 1);
    expect(b.matches.storage(d.body.matchId).alarm).toBe((await meta(b, d.body.matchId)).lockByMs);
    await b.advance(24 * HOUR + 1);
    expect((await meta(b, d.body.matchId)).phase).toBe('expired');
    expect((await a.view(d.body.matchId)).body.phase).toBe('expired');
    const c = new Player(b);
    await c.signup();
    expect((await c.call('GET', `/v1/invites/${d.body.inviteToken}`)).status).toBe(410);
    expect((await c.call('POST', `/v1/invites/${d.body.inviteToken}/accept`)).status).toBe(410);
    expect((await a.call('GET', '/v1/matches')).body).toEqual([expect.objectContaining({ matchId: d.body.matchId, phase: 'expired' })]);
    expect(b.matches.storage(d.body.matchId).alarm).toBeNull();
    b.close();
  });

  it('opponent joins but never locks: Auto Over is sealed for them and the match goes on', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    await a.lock(matchId, 1);
    await b.advance(24 * HOUR + 1);
    const view = (await a.view(matchId)).body;
    expect(view.locked).toEqual([true, true]);
    expect(view.phase).toBe('batting');
    const late = await c.call<{ error: { code: string } }>('POST', `/v1/matches/${matchId}/lock`, { plan: (await import('./fakeEngine')).testPlan(9) });
    expect(late.status).toBe(410);
    expect(late.body.error.code).toBe('deadline_passed');
    await a.batInnings(matchId);
    // The opponent never bats either: Auto XI plays their innings at the batting deadline, then the reveal.
    await b.advance(24 * HOUR);
    const log = (await a.call<MatchEventLog>('GET', `/v1/matches/${matchId}/reveal`)).body;
    expect(log.commits[1].auto).toBe(true);
    expect(log.commits[0].auto).toBeUndefined();
    expect(log.innings[1].balls.length).toBeGreaterThan(0);
    expect(b.metrics.get('auto_over')).toBe(1);
    expect(b.metrics.total('auto_xi')).toBeGreaterThan(0);
    // The duel's room says plainly that Auto played for Calm Cobra, and never counts it as a lock.
    const room = (await a.call<RoomView>('GET', `/v1/rooms/${view.roomId}`)).body;
    const auto = room.posts.filter((p) => p.kind === 'deadline' && typeof p.payload.phase === 'string' && p.payload.phase.startsWith('auto_')).map((p) => [p.payload.phase, p.payload.alias]);
    expect(auto.sort()).toEqual([['auto_over', 'Calm Cobra'], ['auto_xi', 'Calm Cobra']]);
    expect(room.posts.some((p) => p.kind === 'lock_status')).toBe(false);
    b.close();
  });

  it("without the engine's Auto XI key the missed balls are leaves: the match still finishes, nothing is invented", async () => {
    const b = await backend({ helpers: { ...fakeHelpers, autoXiSeed: undefined } });
    const { a, c, matchId } = await duel(b);
    await a.lock(matchId, 1);
    await c.lock(matchId, 2);
    await a.batInnings(matchId);
    await b.advance(48 * HOUR + 1);
    const log = (await a.call<MatchEventLog>('GET', `/v1/matches/${matchId}/reveal`)).body;
    expect(log.inputs[1]).toEqual([]);
    expect(log.innings[1].balls.every((x) => x.timing === 'interrupted')).toBe(true);
    expect(b.metrics.total('auto_xi')).toBe(0);
    b.close();
  });

  it('neither player locks: the match expires without a result', async () => {
    const b = await backend();
    const { a, matchId } = await duel(b);
    await b.advance(24 * HOUR + 1);
    expect((await a.view(matchId)).body.phase).toBe('expired');
    expect((await a.call('GET', `/v1/matches/${matchId}/reveal`)).status).toBe(409);
    b.close();
  });

  it('batting deadline: an outstanding ball becomes a leave and Auto XI finishes the innings', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    await a.lock(matchId, 1);
    await c.lock(matchId, 2);
    await a.batInnings(matchId);
    const n1 = (await c.next(matchId)).body;
    await c.shot(matchId, n1.ballToken, testShot(n1.delivery));
    await c.next(matchId); // ball 1 revealed, then the app is closed for good
    await b.advance(48 * HOUR + 1);
    expect((await c.view(matchId)).body.phase).toBe('revealed');
    const log = (await c.call<MatchEventLog>('GET', `/v1/matches/${matchId}/reveal`)).body;
    expect(log.innings[1].balls[1].timing).toBe('interrupted');
    expect(log.innings[1].balls.length).toBe(log.innings[1].ballsFaced);
    b.close();
  });

  it('deadlines apply on the next request even if an alarm is late, and alarms are idempotent', async () => {
    const b = await backend();
    const { a, matchId } = await duel(b);
    await a.lock(matchId, 1);
    b.clock.advance(24 * HOUR + 1); // no alarm fired yet
    expect((await a.view(matchId)).body.locked).toEqual([true, true]);
    const rev = (await meta(b, matchId)).rev;
    await b.runAlarms();
    await b.runAlarms();
    expect((await meta(b, matchId)).rev).toBe(rev);
    expect(b.metrics.get('auto_over')).toBe(1);
    b.close();
  });

  it('late play after the reveal is refused', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    await a.lock(matchId, 1);
    await c.lock(matchId, 2);
    await a.batInnings(matchId);
    await c.batInnings(matchId);
    expect((await a.next(matchId)).status).toBe(409);
    expect((await a.lock(matchId, 1)).status).toBe(200); // same plan: replays the commit
    expect((await a.lock(matchId, 3)).status).toBe(409);
    b.close();
  });
});
