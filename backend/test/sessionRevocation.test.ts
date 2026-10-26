// @vitest-environment node
/**
 * Session revocation (security review, finding 3): sign-out on this device, signing out every other device,
 * recovery on a new device signing out the others, and sensitive routes refusing a revoked device at once (access
 * tokens are otherwise valid for their 15 minutes).
 */
import { describe, expect, it } from 'vitest';
import type { SessionTokens } from '@/contracts';
import type { GoogleVerifier } from '../src/auth/google';
import { Player, backend, duel } from './helpers';
import { consent, freeze, mine, playDuel, players } from './highlightHelpers';

const google: GoogleVerifier = { verify: async (idToken) => (idToken === 'good-google-token' ? { sub: 'google-subject-1' } : null) };

/** A second device of the same account (recovered through Google). */
async function secondDevice(b: Awaited<ReturnType<typeof backend>>, p: Player): Promise<Player> {
  expect((await p.call('POST', '/v1/auth/link/google', { idToken: 'good-google-token' })).status).toBe(200);
  const other = new Player(b);
  const r = await other.call<SessionTokens>('POST', '/v1/auth/google', { idToken: 'good-google-token' }, { token: null });
  expect(r.status).toBe(200);
  other.tokens = r.body;
  return other;
}

describe('session revocation', () => {
  it('logout revokes this device: its refresh token is dead and sensitive routes refuse it at once', async () => {
    const b = await backend();
    const p = new Player(b);
    await p.signup('Logout Tester');
    const access = p.tokens!.accessToken;
    expect((await p.call('POST', '/v1/auth/logout')).status).toBe(200);
    expect((await p.call('POST', '/v1/auth/logout', undefined, { token: access })).status).toBe(200); // idempotent
    const refreshed = await p.call('POST', '/v1/auth/refresh', { refreshToken: p.tokens!.refreshToken }, { token: null });
    expect(refreshed.status).toBe(401);
    expect((await p.call('PATCH', '/v1/me', { alias: 'Renamed Thief' }, { token: access })).status).toBe(401);
    expect((await p.call('POST', '/v1/me/export', undefined, { token: access })).status).toBe(401);
    expect((await p.call('DELETE', '/v1/me', undefined, { token: access })).status).toBe(401);
    expect(b.metrics.get('session_signed_out')).toBe(1);
    b.close();
  });

  it('recovery on a new device signs out every other device; revoke-others does the same and answers how many', async () => {
    const b = await backend({ google, vars: { GOOGLE_CLIENT_IDS: 'web-client' } });
    const p = new Player(b);
    await p.signup('Phone Owner');
    // Recovery: the first device's session family is revoked.
    const recovered = await secondDevice(b, p);
    expect((await p.call('POST', '/v1/auth/refresh', { refreshToken: p.tokens!.refreshToken }, { token: null })).status).toBe(401);
    expect((await p.call('PATCH', '/v1/me', { alias: 'Old Device' }, { token: p.tokens!.accessToken })).status).toBe(401);
    expect((await recovered.call('PATCH', '/v1/me', { alias: 'New Device' })).status).toBe(200);
    // Two more devices, then "sign out other devices" from the recovered one.
    const third = new Player(b);
    third.tokens = (await third.call<SessionTokens>('POST', '/v1/auth/google', { idToken: 'good-google-token' }, { token: null })).body;
    expect((await recovered.call('POST', '/v1/auth/refresh', { refreshToken: recovered.tokens!.refreshToken }, { token: null })).status).toBe(401); // the third sign-in revoked it
    const fourth = new Player(b);
    fourth.tokens = (await fourth.call<SessionTokens>('POST', '/v1/auth/google', { idToken: 'good-google-token' }, { token: null })).body;
    const fifth = new Player(b);
    fifth.tokens = (await fifth.call<SessionTokens>('POST', '/v1/auth/google', { idToken: 'good-google-token' }, { token: null })).body;
    // fifth revoked fourth (recovery); fourth, signed out, cannot sign out the others.
    expect((await fourth.call('POST', '/v1/auth/revoke-others', undefined, { token: fourth.tokens!.accessToken })).status).toBe(401);
    const r = await fifth.call<{ revoked: number }>('POST', '/v1/auth/revoke-others');
    expect(r.status).toBe(200);
    expect(r.body.revoked).toBe(0); // recovery already ended every other session
    expect((await fifth.call('GET', '/v1/me')).status).toBe(200);
    b.close();
  });

  it('revoke-others ends sessions the account kept on other devices', async () => {
    const b = await backend({ google, vars: { GOOGLE_CLIENT_IDS: 'web-client' } });
    const p = new Player(b);
    await p.signup('Many Devices');
    // A second live family of the same account (as if signed in elsewhere before recovery revoked anything).
    const other = await secondDevice(b, p);
    const uid = JSON.parse(Buffer.from(p.tokens!.accessToken.split('.')[2], 'base64url').toString()).sub as string;
    b.db.db.prepare('UPDATE sessions SET revoked = 0 WHERE uid = ?').run(uid);
    const r = await other.call<{ revoked: number }>('POST', '/v1/auth/revoke-others');
    expect(r.body).toEqual({ revoked: 1 });
    expect((await p.call('POST', '/v1/auth/refresh', { refreshToken: p.tokens!.refreshToken }, { token: null })).status).toBe(401);
    expect((await other.call('POST', '/v1/auth/refresh', { refreshToken: other.tokens!.refreshToken }, { token: null })).status).toBe(200);
    b.close();
  });

  it('a revoked device cannot decide or withdraw highlight consent, or delete the account', async () => {
    const b = await backend({ google, vars: { GOOGLE_CLIENT_IDS: 'web-client' } });
    const [a, c] = await players(b, 2);
    await playDuel(a, c, [40, 90]);
    await freeze(b);
    const [job] = await mine(a);
    const stolen = a.tokens!.accessToken;
    const owner = await secondDevice(b, a); // recovery revokes the "stolen" device
    expect((await consent(a, job.jobId, 'granted')).status).toBe(401);
    expect((await a.call('POST', `/v1/highlights/${job.jobId}/consent`, { decision: 'granted', adultConfirmed: true, visibility: 'public' }, { token: stolen })).status).toBe(401);
    expect((await a.call('POST', `/v1/highlights/${job.jobId}/withdraw`, {}, { token: stolen })).status).toBe(401);
    expect((await a.call('DELETE', '/v1/me', undefined, { token: stolen })).status).toBe(401);
    expect((await consent(owner, job.jobId, 'granted')).status).toBe(200);
    b.close();
  });

  it('ordinary routes keep working for a live session, and logout needs no live family', async () => {
    const b = await backend();
    const { a, matchId } = await duel(b);
    expect((await a.view(matchId)).status).toBe(200);
    expect((await a.call('POST', '/v1/auth/logout')).status).toBe(200);
    b.close();
  });
});
