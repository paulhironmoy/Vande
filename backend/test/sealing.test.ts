// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { MatchEventLog, MatchView } from '@/contracts';
import { open, sha256Hex } from '../src/security/crypto';
import { parseKeyring } from '../src/security/keyring';
import { commitMessage, verifyText } from '../src/security/signing';
import type { MatchMeta } from '../src/match/state';
import { fakeEngine, testPlan } from './fakeEngine';
import { backend, duel, storedText } from './helpers';

const SEALED_WORDS = ['gesture', 'samples', 'intent', '"salt"', 'yorker', 'good_length', 'bouncer', 'offspin', 'contain', 'attack'];

describe('commit and reveal', () => {
  it('commits a salted SHA-256 of the canonical plan, signs it with a published key, and reveals plan + salt', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    const plan = testPlan(7);
    const lock = await a.call<{ commitHash: string; sig: string; keyId: string }>('POST', `/v1/matches/${matchId}/lock`, { plan });
    expect(lock.status).toBe(200);
    expect(lock.body.commitHash).toMatch(/^[0-9a-f]{64}$/);
    expect(lock.body.sig).toMatch(/^[0-9a-f]{128}$/);
    const keys = await a.call<{ keys: Array<{ keyId: string; publicKey: string; status: string }> }>('GET', '/v1/keys');
    const key = keys.body.keys.find((k) => k.keyId === lock.body.keyId);
    expect(key?.status).toBe('active');
    expect(await verifyText(key!.publicKey, commitMessage(matchId, 0, lock.body.commitHash, fakeEngine.ENGINE_VERSION), lock.body.sig)).toBe(true);
    expect(await verifyText(key!.publicKey, commitMessage(matchId, 1, lock.body.commitHash, fakeEngine.ENGINE_VERSION), lock.body.sig)).toBe(false);

    await c.lock(matchId, 8);
    await a.batInnings(matchId);
    await c.batInnings(matchId);
    const log = (await c.call<MatchEventLog>('GET', `/v1/matches/${matchId}/reveal`)).body;
    expect(log.plans[0]).toEqual(plan);
    expect(await sha256Hex(fakeEngine.canonicalPlan(log.plans[0]) + log.commits[0].salt)).toBe(lock.body.commitHash);
    expect(log.commits[0].sig).toBe(lock.body.sig);
    expect(log.commits[0].lockedHour).toMatch(/T\d\d:00:00\.000Z$/);
    const verified = await fakeEngine.verifyMatchLog(log);
    expect(verified.ok).toBe(true);
    // The seed was committed at creation, before any plan existed.
    const meta = (await b.matches.storage(matchId).get<MatchMeta>(['meta'])).get('meta')!;
    expect(await sha256Hex(log.seed)).toBe(meta.seedCommit);
    b.close();
  });

  it('stores plans and the seed encrypted; ciphertexts are bound to their match, seat and hash', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    const lock = await a.lock(matchId, 3);
    await c.lock(matchId, 4);
    const text = storedText(b, matchId);
    for (const w of SEALED_WORDS) expect(text, w).not.toContain(w);
    const storage = b.matches.storage(matchId);
    const envelope = (await storage.get<string>(['plan0'])).get('plan0')!;
    expect(envelope).toMatch(/^e1\.dev1\./);
    const ring = parseKeyring(b.env.DATA_KEYS)!;
    const secret = (await storage.get<string>(['secret'])).get('secret')!;
    const seed = (JSON.parse((await open(ring.all, 'secret', matchId, secret, matchId))!) as { seed: string }).seed;
    expect(seed).toMatch(/^[0-9a-f]{32}$/);
    expect(text).not.toContain(seed);
    expect(await open(ring.all, 'plan', matchId, envelope, `${matchId}|0|${lock.body.commitHash}`)).toContain('"salt"');
    expect(await open(ring.all, 'plan', matchId, envelope, `${matchId}|1|${lock.body.commitHash}`)).toBeNull();
    expect(await open(ring.all, 'plan', 'mother', envelope, `${matchId}|0|${lock.body.commitHash}`)).toBeNull();
    expect(await open(parseKeyring(`dev1:${'A'.repeat(43)}`)!.all, 'plan', matchId, envelope, `${matchId}|0|${lock.body.commitHash}`)).toBeNull();
    b.close();
  });

  it('a locked over never changes: the same plan replays its commit, another plan is already_locked', async () => {
    const b = await backend();
    const { a, matchId } = await duel(b);
    const first = await a.lock(matchId, 5);
    const same = await a.lock(matchId, 5);
    expect(same.status).toBe(200);
    expect(same.body).toEqual(first.body);
    const other = await a.call<{ error: { code: string } }>('POST', `/v1/matches/${matchId}/lock`, { plan: testPlan(6) });
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('already_locked');
    b.close();
  });

  it('validates plans with the engine and never echoes them', async () => {
    const b = await backend();
    const { a, matchId } = await duel(b);
    const locked = testPlan(1, { variant: 'legspin' });
    const r = await a.call<{ error: { code: string; message: string } }>('POST', `/v1/matches/${matchId}/lock`, { plan: locked });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toContain('locked');
    const broken = await a.call<{ error: { code: string; message: string } }>('POST', `/v1/matches/${matchId}/lock`, { plan: { v: 1, field: 'balanced', balls: [] } });
    expect(broken.status).toBe(400);
    const notJson = await a.call('POST', `/v1/matches/${matchId}/lock`, undefined, { raw: '{"plan":' });
    expect(notJson.status).toBe(400);
    const copy = testPlan(2);
    copy.balls[1] = { ...copy.balls[1], gesture: copy.balls[0].gesture };
    expect((await a.call('POST', `/v1/matches/${matchId}/lock`, { plan: copy })).status).toBe(400);
    expect((await a.view(matchId)).body.locked).toEqual([false, false]);
    b.close();
  });

  it('lets the creator lock before the invite is accepted, and shows only hashes', async () => {
    const b = await backend();
    const { Player } = await import('./helpers');
    const a = new Player(b);
    await a.signup();
    const d = await a.call<{ matchId: string; inviteToken: string }>('POST', '/v1/duels', {});
    expect((await a.lock(d.body.matchId, 1)).status).toBe(200);
    const view = (await a.view(d.body.matchId)).body;
    expect(view.phase).toBe('awaiting_opponent');
    expect(view.locked).toEqual([true, false]);
    const c = new Player(b);
    await c.signup();
    await c.call('POST', `/v1/invites/${d.body.inviteToken}/accept`);
    const cv = (await c.view(d.body.matchId)).body;
    expect(cv.opponentCommit).toBe(view.myCommit);
    expect(cv.myCommit).toBeNull();
    for (const w of SEALED_WORDS) expect(JSON.stringify(cv)).not.toContain(w);
    b.close();
  });

  it('refuses a reveal while sealed, also to the batter who finished', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    await a.lock(matchId, 1);
    await c.lock(matchId, 2);
    await a.batInnings(matchId);
    const r = await a.call<{ error: { code: string } }>('GET', `/v1/matches/${matchId}/reveal`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('sealed');
    const view: MatchView = (await c.view(matchId)).body;
    expect(view.battingDone).toEqual([true, false]);
    b.close();
  });
});
