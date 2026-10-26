// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { MatchEventLog, MatchView } from '@/contracts';
import { backend, duel } from './helpers';

describe('a complete Friend Duel', () => {
  it('creates, accepts, locks both overs, bats both innings and reveals a verifiable replay', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    expect((await a.view(matchId)).body.phase).toBe('planning');
    const la = await a.lock(matchId, 1);
    expect(la.status, JSON.stringify(la.body)).toBe(200);
    expect((await c.view(matchId)).body.locked).toEqual([true, false]);
    const lc = await c.lock(matchId, 2);
    expect(lc.status, JSON.stringify(lc.body)).toBe(200);
    expect((await a.view(matchId)).body.phase).toBe('batting');

    const ia = await a.batInnings(matchId, 0);
    expect(ia.at(-1)?.inningsComplete).toBe(true);
    expect((await a.view(matchId)).body.phase).toBe('awaiting_reveal');
    expect((await a.call('GET', `/v1/matches/${matchId}/reveal`)).status).toBe(409);

    const ic = await c.batInnings(matchId, 70);
    expect(ic.at(-1)?.inningsComplete).toBe(true);
    const view = await a.view(matchId);
    expect(view.body.phase).toBe('revealed');

    const reveal = await a.call<MatchEventLog>('GET', `/v1/matches/${matchId}/reveal`);
    expect(reveal.status).toBe(200);
    expect(reveal.body.commits[0].hash).toBe(la.body.commitHash);
    expect(reveal.body.commits[1].hash).toBe(lc.body.commitHash);
    expect(reveal.body.commits[0].salt).toMatch(/^[0-9a-f]{32}$/);
    const list = await c.call<MatchView[]>('GET', '/v1/matches');
    expect(list.body.map((v) => v.matchId)).toContain(matchId);
    expect(list.body.find((v) => v.matchId === matchId)?.phase).toBe('revealed');
    b.close();
  });
});
