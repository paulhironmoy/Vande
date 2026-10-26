// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CreateDuelResponse, InvitePreview, MatchEventLog, MatchView, RoomView } from '@/contracts';
import { INVITE_CODE_RE, INVITE_TOKEN_RE, SIGNED_INVITE_TOKEN_RE } from '@/net/shared/ids';
import { fromBase64Url, toBase64Url } from '../src/security/encoding';
import { Player, advanceTo, backend, duel } from './helpers';

/** The signed token a short code stands for (D1 invite_codes). */
function tokenBehind(b: Awaited<ReturnType<typeof backend>>, code: string): { token: string; exp_ms: number } {
  return b.db.db.prepare('SELECT token, exp_ms FROM invite_codes WHERE code = ?').get(code) as { token: string; exp_ms: number };
}

describe('invite tokens', () => {
  it('links carry a short random code that stands for a signed token with a 128-bit nonce', async () => {
    const b = await backend();
    const a = new Player(b);
    await a.signup();
    const d = await a.call<CreateDuelResponse>('POST', '/v1/duels', {});
    expect(d.status).toBe(201);
    expect(d.body.inviteToken).toMatch(INVITE_CODE_RE);
    expect(d.body.inviteToken).toMatch(INVITE_TOKEN_RE);
    expect(d.body.inviteUrl).toBe(`http://localhost:5173/i/${d.body.inviteToken}`);
    const behind = tokenBehind(b, d.body.inviteToken);
    expect(behind.token).toMatch(SIGNED_INVITE_TOKEN_RE);
    expect(behind.exp_ms).toBe(Date.parse((await a.view(d.body.matchId)).body.deadlines.lockBy));
    const payload = fromBase64Url(behind.token.split('.')[0])!;
    const nonce = payload.slice(18, 34);
    expect(nonce.length).toBe(16);
    expect(new Set(nonce).size).toBeGreaterThan(8);
    // Codes are random, not derived: two duels never share one.
    const codes = new Set<string>([d.body.inviteToken]);
    for (let i = 0; i < 5; i++) codes.add((await a.call<CreateDuelResponse>('POST', '/v1/duels', {})).body.inviteToken);
    expect(codes.size).toBe(6);
    b.close();
  });

  it('a link with the long signed token (made before codes) keeps working', async () => {
    const b = await backend();
    const a = new Player(b);
    const c = new Player(b);
    await a.signup('Swift Tiger');
    await c.signup();
    const d = (await a.call<CreateDuelResponse>('POST', '/v1/duels', {})).body;
    const long = tokenBehind(b, d.inviteToken).token;
    expect((await new Player(b).call<InvitePreview>('GET', `/v1/invites/${long}`)).body.inviterAlias).toBe('Swift Tiger');
    expect((await c.call<{ matchId: string }>('POST', `/v1/invites/${long}/accept`)).body.matchId).toBe(d.matchId);
    b.close();
  });

  it("is in the creator's own view while nobody has joined, and never in anyone else's", async () => {
    const b = await backend();
    const a = new Player(b);
    const c = new Player(b);
    await a.signup();
    await c.signup();
    const d = (await a.call<CreateDuelResponse>('POST', '/v1/duels', {})).body;
    // Any of the creator's devices can share it again: the match and the match list carry it.
    expect((await a.call<MatchView>('GET', `/v1/matches/${d.matchId}`)).body.inviteUrl).toBe(d.inviteUrl);
    await b.idle();
    expect((await a.call<MatchView[]>('GET', '/v1/matches')).body.find((m) => m.matchId === d.matchId)?.inviteUrl).toBe(d.inviteUrl);
    expect((await c.call('POST', `/v1/invites/${d.inviteToken}/accept`)).status).toBe(200);
    expect((await c.call<MatchView>('GET', `/v1/matches/${d.matchId}`)).body.inviteUrl).toBeNull();
    expect((await a.call<MatchView>('GET', `/v1/matches/${d.matchId}`)).body.inviteUrl).toBeNull();
    await b.idle();
    for (const p of [a, c]) expect(JSON.stringify((await p.call<MatchView[]>('GET', '/v1/matches')).body)).not.toContain(d.inviteToken);
    b.close();
  });

  it('resists guessing: random, tampered and truncated tokens all get the same not_found', async () => {
    const b = await backend({ bindingLimits: { RL_INVITE: 100_000 } });
    const a = new Player(b);
    await a.signup();
    const d = await a.call<CreateDuelResponse>('POST', '/v1/duels', {});
    const c = new Player(b);
    const answers = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const fake = `${toBase64Url(crypto.getRandomValues(new Uint8Array(38)))}.${toBase64Url(crypto.getRandomValues(new Uint8Array(16)))}`;
      const r = await c.call<{ error: { code: string; message: string } }>('GET', `/v1/invites/${fake}`);
      answers.add(`${r.status}:${r.body.error.code}:${r.body.error.message}`);
    }
    const t = tokenBehind(b, d.body.inviteToken).token;
    for (let i = 0; i < t.length; i += 3) {
      if (t[i] === '.') continue;
      const flipped = t.slice(0, i) + (t[i] === 'A' ? 'B' : 'A') + t.slice(i + 1);
      const r = await c.call<{ error: { code: string; message: string } }>('GET', `/v1/invites/${flipped}`);
      answers.add(`${r.status}:${r.body.error.code}:${r.body.error.message}`);
    }
    for (const bad of [t.slice(0, 40), `${t}x`, 'hello', '%E0%A4%A']) {
      const r = await c.call<{ error: { code: string; message: string } }>('GET', `/v1/invites/${bad}`);
      answers.add(`${r.status}:${r.body.error.code}:${r.body.error.message}`);
    }
    expect([...answers]).toEqual(['404:not_found:invite not found']);
    b.close();
  });

  it('a short code that does not exist answers exactly like an expired one, so codes cannot be enumerated', async () => {
    const b = await backend({ bindingLimits: { RL_INVITE: 100_000 } });
    const a = new Player(b);
    await a.signup();
    const d = (await a.call<CreateDuelResponse>('POST', '/v1/duels', {})).body;
    const v = new Player(b);
    await v.signup();
    const misses = new Set<string>();
    const ask = async (method: 'GET' | 'POST', code: string) => {
      const r = await v.call<{ error: { code: string; message: string } }>(method, method === 'GET' ? `/v1/invites/${code}` : `/v1/invites/${code}/accept`);
      return `${r.status}:${r.body.error?.code}:${r.body.error?.message}`;
    };
    const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
    for (let i = 0; i < 200; i++) {
      const guess = Array.from(crypto.getRandomValues(new Uint8Array(10)), (x) => alphabet[x % 32]).join('');
      if (guess === d.inviteToken) continue;
      misses.add(await ask(i % 2 ? 'POST' : 'GET', guess));
    }
    // One character off the real code is just another miss.
    misses.add(await ask('GET', `${d.inviteToken.slice(0, 9)}${d.inviteToken[9] === 'a' ? 'b' : 'a'}`));
    expect([...misses]).toEqual(['410:deadline_passed:this invite link has expired or is not valid']);
    // The real code, once its invite expired, gives that very answer on both routes.
    expect((await v.call('GET', `/v1/invites/${d.inviteToken}`)).status).toBe(200);
    await advanceTo(b, Date.parse((await a.view(d.matchId)).body.deadlines.lockBy) + 60_000);
    expect(await ask('GET', d.inviteToken)).toBe([...misses][0]);
    expect(await ask('POST', d.inviteToken)).toBe([...misses][0]);
    b.close();
  });

  it('every code lookup spends the per-network invite budget, on the signed-in accept route too', async () => {
    const b = await backend({ bindingLimits: { RL_INVITE: 3 } });
    const a = new Player(b);
    await a.signup();
    const d = (await a.call<CreateDuelResponse>('POST', '/v1/duels', {})).body;
    const guesser = new Player(b, '192.0.2.77');
    await guesser.signup();
    for (let i = 0; i < 3; i++) expect((await guesser.call('POST', `/v1/invites/zzzzzzzzz${i + 2}/accept`)).status).toBe(410);
    const limited = await guesser.call<{ error: { code: string } }>('POST', `/v1/invites/${d.inviteToken}/accept`);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate_limited');
    // The same network's previews share that budget; another network is unaffected.
    expect((await new Player(b, '192.0.2.77').call('GET', `/v1/invites/${d.inviteToken}`)).status).toBe(429);
    const friend = new Player(b, '192.0.2.78');
    await friend.signup();
    expect((await friend.call('POST', `/v1/invites/${d.inviteToken}/accept`)).status).toBe(200);
    b.close();
  });

  it('a rematch and a cup are invited with short codes too, and expired codes are pruned at night', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    await a.lock(matchId, 1);
    await c.lock(matchId, 2);
    await a.batInnings(matchId);
    await c.batInnings(matchId);
    const r = (await a.call<CreateDuelResponse>('POST', `/v1/matches/${matchId}/rematch`)).body;
    expect(r.inviteToken).toMatch(INVITE_CODE_RE);
    expect(r.inviteUrl).toBe(`http://localhost:5173/i/${r.inviteToken}`);
    expect((await a.view(matchId)).body.rematch?.inviteUrl).toBe(r.inviteUrl);
    const cup = (await a.call<{ cupId: string; inviteToken: string; inviteUrl: string }>('POST', '/v1/cups', { name: 'Office Cup', pace: 'sprint', maxPlayers: 4 })).body;
    expect(cup.inviteToken).toMatch(INVITE_CODE_RE);
    expect(cup.inviteUrl).toBe(`http://localhost:5173/i/${cup.inviteToken}`);
    expect((await a.call<{ inviteToken: string | null }>('GET', `/v1/cups/${cup.cupId}`)).body.inviteToken).toBe(cup.inviteToken);
    expect((await c.call<InvitePreview>('GET', `/v1/invites/${cup.inviteToken}`)).body.kind).toBe('cup');
    const live = () => Number((b.db.db.prepare('SELECT count(*) AS n FROM invite_codes').get() as { n: number }).n);
    expect(live()).toBe(3);
    await advanceTo(b, b.clock.now() + 3 * 86_400_000);
    await b.scheduled();
    expect(live()).toBe(0);
    b.close();
  });

  it('previews are public and spoiler-free, also after the creator locked', async () => {
    const b = await backend();
    const a = new Player(b);
    await a.signup('Midnight Seamer');
    const d = await a.call<CreateDuelResponse>('POST', '/v1/duels', { conditions: { pitch: 'green', weather: 'humid' } });
    await a.lock(d.body.matchId, 1);
    const visitor = new Player(b);
    const p = await visitor.call<InvitePreview>('GET', `/v1/invites/${d.body.inviteToken}`);
    expect(p.status).toBe(200);
    expect(p.body).toEqual({ kind: 'duel', inviterAlias: 'Midnight Seamer', conditions: { pitch: 'green', weather: 'humid' }, expiresAt: expect.stringMatching(/:00\.000Z$/) });
    b.close();
  });

  it('accepting needs an account; invite lookups are rate limited per network', async () => {
    const b = await backend({ bindingLimits: { RL_INVITE: 5 } });
    const a = new Player(b);
    await a.signup();
    const d = await a.call<CreateDuelResponse>('POST', '/v1/duels', {});
    const v = new Player(b, '192.0.2.44');
    for (let i = 0; i < 5; i++) expect((await v.call('GET', `/v1/invites/${d.body.inviteToken}`)).status).toBe(200);
    const limited = await v.call<{ error: { code: string } }>('GET', `/v1/invites/${d.body.inviteToken}`);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect((await new Player(b, '192.0.2.45').call('GET', `/v1/invites/${d.body.inviteToken}`)).status).toBe(200);
    b.close();
  });
});

describe('rematch', () => {
  it('after the reveal either player can challenge again; the invite is reserved for the opponent', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    expect((await a.call('POST', `/v1/matches/${matchId}/rematch`)).status).toBe(409);
    await a.lock(matchId, 1);
    await c.lock(matchId, 2);
    await a.batInnings(matchId);
    await c.batInnings(matchId);
    const r1 = await c.call<CreateDuelResponse>('POST', `/v1/matches/${matchId}/rematch`);
    expect(r1.status).toBe(201);
    const r2 = await c.call<CreateDuelResponse>('POST', `/v1/matches/${matchId}/rematch`);
    expect(r2.body).toEqual(r1.body);
    const x = new Player(b);
    await x.signup();
    expect((await x.call('POST', `/v1/invites/${r1.body.inviteToken}/accept`)).status).toBe(403);
    expect((await a.call('POST', `/v1/invites/${r1.body.inviteToken}/accept`)).status).toBe(200);
    const view = (await a.view(r1.body.matchId)).body;
    expect(view.players[0]?.alias).toBe('Calm Cobra');
    expect(view.conditions).toEqual({ pitch: 'hard', weather: 'clear' });
    expect((await a.call<MatchEventLog>('GET', `/v1/matches/${matchId}/reveal`)).status).toBe(200);
    b.close();
  });

  it('one offer per duel: the asker sees it as theirs, the opponent gets it to accept, on the match, the home list and the room', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    await a.lock(matchId, 1);
    await c.lock(matchId, 2);
    await a.batInnings(matchId);
    await c.batInnings(matchId);
    expect((await a.view(matchId)).body.rematch).toBeNull();
    const asked = await a.call<CreateDuelResponse>('POST', `/v1/matches/${matchId}/rematch`);
    expect(asked.status).toBe(201);
    // The opponent tapping Rematch afterwards gets the same offer (never a second duel)…
    const again = await c.call<CreateDuelResponse>('POST', `/v1/matches/${matchId}/rematch`);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(asked.body);
    // …and the views tell them apart: the asker's own, the opponent's to accept through the invitation.
    expect((await a.view(matchId)).body.rematch).toEqual({ matchId: asked.body.matchId, inviteUrl: asked.body.inviteUrl, fromMe: true });
    expect((await c.view(matchId)).body.rematch).toEqual({ matchId: asked.body.matchId, inviteUrl: asked.body.inviteUrl, fromMe: false });
    // The opponent's home list carries the revealed duel with the offer, first.
    await b.idle();
    const list = (await c.call<MatchView[]>('GET', '/v1/matches')).body;
    expect(list[0].matchId).toBe(matchId);
    expect(list[0].rematch).toMatchObject({ matchId: asked.body.matchId, fromMe: false });
    // The room says who asked and where each player answers it.
    const room = (await c.call<RoomView>('GET', `/v1/rooms/${(await c.view(matchId)).body.roomId}`)).body;
    const card = room.posts.find((p) => p.kind === 'rematch');
    expect(card?.payload).toEqual({ matchId: asked.body.matchId, fromAlias: 'Swift Tiger', fromId: a.tokens!.playerId, rematchOf: matchId });
    // Accepting through the invitation seats the opponent in the new duel.
    expect((await c.call('POST', `/v1/invites/${asked.body.inviteToken}/accept`)).status).toBe(200);
    expect((await c.view(asked.body.matchId)).body.me).toBe(1);
    b.close();
  });

  it('an offer that expired is replaced by a new one from whoever asks next', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    await a.lock(matchId, 1);
    await c.lock(matchId, 2);
    await a.batInnings(matchId);
    await c.batInnings(matchId);
    const first = (await a.call<CreateDuelResponse>('POST', `/v1/matches/${matchId}/rematch`)).body;
    await advanceTo(b, b.clock.now() + 25 * 3_600_000);
    expect((await c.view(matchId)).body.rematch).toBeNull();
    const second = await c.call<CreateDuelResponse>('POST', `/v1/matches/${matchId}/rematch`);
    expect(second.status).toBe(201);
    expect(second.body.matchId).not.toBe(first.matchId);
    expect((await c.view(matchId)).body.rematch).toMatchObject({ matchId: second.body.matchId, fromMe: true });
    expect((await a.view(matchId)).body.rematch).toMatchObject({ matchId: second.body.matchId, fromMe: false });
    b.close();
  });
});
