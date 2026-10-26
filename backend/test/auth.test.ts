// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import type { Profile, SessionTokens } from '@/contracts';
import { __resetGoogleVerifierForTests } from '../src/auth/routes';
import { GOOGLE_JWKS_URL, createGoogleVerifier } from '../src/auth/google';
import { toBase64Url, utf8 } from '../src/security/encoding';
import { REFRESH_GRACE_MS } from '../src/config';
import { API, ORIGIN, Player, T0, backend } from './helpers';

afterEach(() => __resetGoogleVerifierForTests());

describe('guest accounts and access tokens', () => {
  it('signs up without any personal data and returns working tokens', async () => {
    const b = await backend();
    const p = new Player(b);
    const t = await p.signup();
    expect(t.playerId).toMatch(/^p[a-z2-7]{26}$/);
    expect(t.refreshToken).toMatch(/^rt1\.s[a-z2-7]{26}\.[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(t.expiresAt) - T0).toBe(15 * 60_000);
    const me = await p.call<Profile>('GET', '/v1/me');
    expect(me.status).toBe(200);
    expect(me.body.playerId).toBe(t.playerId);
    expect(me.body.alias).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d\d$/);
    expect(me.body.linked).toEqual({ google: false, passkey: false });
    // The access token's subject is the internal account id, never the public player id.
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(t.accessToken.split('.')[2].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
    expect(claims.sub).toMatch(/^u/);
    expect(claims.sub).not.toBe(t.playerId);
    b.close();
  });

  it('stores only hashes of refresh secrets', async () => {
    const b = await backend();
    const t = await new Player(b).signup();
    const secret = t.refreshToken.split('.')[2];
    const dump = JSON.stringify(b.db.db.prepare('SELECT * FROM sessions').all());
    expect(dump).not.toContain(secret);
    expect(dump).not.toContain(t.accessToken);
    b.close();
  });

  it('refuses missing, malformed, tampered and expired access tokens', async () => {
    const b = await backend();
    const p = new Player(b);
    const t = await p.signup();
    expect((await p.call('GET', '/v1/me', undefined, { token: null })).status).toBe(401);
    expect((await p.call('GET', '/v1/me', undefined, { token: 'not-a-token-at-all-xxxxxxxx' })).status).toBe(401);
    const parts = t.accessToken.split('.');
    const forged = JSON.stringify({ sub: 'uattacker', pid: t.playerId, sid: 'sx', iat: T0 / 1000, exp: T0 / 1000 + 9999 });
    const tampered = [parts[0], parts[1], toBase64Url(utf8(forged)), parts[3]].join('.');
    expect((await p.call('GET', '/v1/me', undefined, { token: tampered })).status).toBe(401);
    b.clock.advance(15 * 60_000 + 1);
    const expired = await p.call<{ error: { code: string } }>('GET', '/v1/me', undefined, { token: t.accessToken });
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe('unauthorized');
    b.close();
  });

  it('a different TOKEN_KEYS ring cannot verify the token (keys are per deployment)', async () => {
    const one = await backend();
    const two = await backend();
    const t = await new Player(one).signup();
    const p2 = new Player(two);
    expect((await p2.call('GET', '/v1/me', undefined, { token: t.accessToken })).status).toBe(401);
    one.close();
    two.close();
  });

  it('replays the same account for a retried sign-up with the same Idempotency-Key', async () => {
    const b = await backend();
    const p = new Player(b);
    const key = crypto.randomUUID();
    const first = await p.call<SessionTokens>('POST', '/v1/auth/guest', { adultConfirmed: true, locale: 'hi' }, { idem: key });
    const again = await p.call<SessionTokens>('POST', '/v1/auth/guest', { adultConfirmed: true, locale: 'hi' }, { idem: key });
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.headers.get('idempotent-replay')).toBe('true');
    expect(again.body).toEqual(first.body);
    expect(Number((b.db.db.prepare('SELECT count(*) AS n FROM accounts').get() as { n: number }).n)).toBe(1);
    // The stored response holds tokens, so it is encrypted at rest.
    const stored = JSON.stringify(b.db.db.prepare('SELECT body_enc FROM idempotency').all());
    expect(stored).not.toContain(first.body.refreshToken.split('.')[2]);
    const other = await p.call('POST', '/v1/auth/guest', { adultConfirmed: true, locale: 'en' }, { idem: key });
    expect(other.status).toBe(409);
    b.close();
  });

  it('validates the sign-up body', async () => {
    const b = await backend();
    const p = new Player(b);
    expect((await p.call('POST', '/v1/auth/guest', { adultConfirmed: true, locale: 'xx' })).status).toBe(400);
    expect((await p.call('POST', '/v1/auth/guest', { adultConfirmed: true, locale: 'en', alias: 'Bhenchod' })).status).toBe(400);
    expect((await p.call('POST', '/v1/auth/guest', { adultConfirmed: true, locale: 'en', avatarSeed: 'NOT VALID' })).status).toBe(400);
    expect((await p.call('POST', '/v1/auth/guest', { adultConfirmed: true, locale: 'en' }, { idem: false })).status).toBe(400);
    const ok = await p.call<SessionTokens>('POST', '/v1/auth/guest', { adultConfirmed: true, locale: 'hi-Latn', alias: 'Chakka King', avatarSeed: 'abc12345' });
    expect(ok.status).toBe(201);
    b.close();
  });

  it('is 18+: no account without the age confirmation, and an accepted sign-up records it', async () => {
    const b = await backend();
    const p = new Player(b);
    for (const body of [{ locale: 'en' }, { locale: 'en', adultConfirmed: false }, { locale: 'en', adultConfirmed: 'yes' }, { locale: 'en', adultConfirmed: 1 }]) {
      const r = await p.call<{ error: { code: string; message: string } }>('POST', '/v1/auth/guest', body);
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('forbidden');
      expect(r.body.error.message).toBe('VANDE Cricket is for players aged 18 and over. Confirm your age in the app to play online.');
    }
    expect(Number((b.db.db.prepare('SELECT count(*) AS n FROM accounts').get() as { n: number }).n)).toBe(0);
    const ok = await p.call<SessionTokens>('POST', '/v1/auth/guest', { locale: 'en', adultConfirmed: true });
    expect(ok.status).toBe(201);
    const me = await p.call<{ adultConfirmed: boolean }>('GET', '/v1/me', undefined, { token: ok.body.accessToken });
    expect(me.body.adultConfirmed).toBe(true);
    b.close();
  });
});

describe('refresh rotation', () => {
  async function refresh(p: Player, refreshToken: string, idem?: string) {
    return p.call<SessionTokens & { error?: { code: string } }>('POST', '/v1/auth/refresh', { refreshToken }, idem ? { idem, token: null } : { token: null });
  }

  it('rotates the refresh token on every use and keeps the player', async () => {
    const b = await backend();
    const p = new Player(b);
    const t0 = await p.signup();
    const r1 = await refresh(p, t0.refreshToken);
    expect(r1.status).toBe(200);
    expect(r1.body.playerId).toBe(t0.playerId);
    expect(r1.body.refreshToken).not.toBe(t0.refreshToken);
    expect(r1.body.refreshToken.split('.')[1]).toBe(t0.refreshToken.split('.')[1]);
    const r2 = await refresh(p, r1.body.refreshToken);
    expect(r2.status).toBe(200);
    p.tokens = r2.body;
    expect((await p.call('GET', '/v1/me')).status).toBe(200);
    b.close();
  });

  it('replays a lost refresh response for the same Idempotency-Key', async () => {
    const b = await backend();
    const p = new Player(b);
    const t0 = await p.signup();
    const key = crypto.randomUUID();
    const r1 = await refresh(p, t0.refreshToken, key);
    const retry = await refresh(p, t0.refreshToken, key);
    expect(retry.status).toBe(200);
    expect(retry.body.refreshToken).toBe(r1.body.refreshToken);
    b.close();
  });

  it('answers a racing refresh with the old token inside the grace window with 409 and changes nothing', async () => {
    const b = await backend();
    const p = new Player(b);
    const t0 = await p.signup();
    const r1 = await refresh(p, t0.refreshToken);
    const race = await refresh(p, t0.refreshToken);
    expect(race.status).toBe(409);
    expect(race.headers.get('retry-after')).toBe('1');
    expect((await refresh(p, r1.body.refreshToken)).status).toBe(200);
    b.close();
  });

  it('revokes the whole family when a rotated token is reused after the grace window', async () => {
    const b = await backend();
    const p = new Player(b);
    const t0 = await p.signup();
    const r1 = await refresh(p, t0.refreshToken);
    b.clock.advance(REFRESH_GRACE_MS + 1);
    const reuse = await refresh(p, t0.refreshToken);
    expect(reuse.status).toBe(401);
    expect((await refresh(p, r1.body.refreshToken)).status).toBe(401);
    expect(b.metrics.get('refresh_reuse_revoked')).toBe(1);
    const audit = b.db.db.prepare("SELECT action FROM audit_log WHERE action = 'session_revoked_reuse'").all();
    expect(audit).toHaveLength(1);
    b.close();
  });

  it('ignores garbage for a known family without revoking it', async () => {
    const b = await backend();
    const p = new Player(b);
    const t0 = await p.signup();
    const family = t0.refreshToken.split('.')[1];
    expect((await refresh(p, `rt1.${family}.${'A'.repeat(43)}`)).status).toBe(401);
    expect((await refresh(p, 'rt1.bogus')).status).toBe(401);
    expect((await refresh(p, t0.refreshToken)).status).toBe(200);
    b.close();
  });
});

describe('fail-closed secrets', () => {
  it('answers 503 without RATE_SALT, TOKEN_KEYS or DATA_KEYS and never issues tokens', async () => {
    for (const missing of ['RATE_SALT', 'TOKEN_KEYS', 'DATA_KEYS'] as const) {
      const b = await backend({ vars: { [missing]: undefined } });
      const r = await new Player(b).call<{ error: { code: string; message: string } }>('POST', '/v1/auth/guest', { adultConfirmed: true, locale: 'en' });
      expect(r.status, missing).toBe(503);
      expect(r.body.error.code).toBe('unavailable');
      expect(r.body.error.message).not.toContain(missing);
      b.close();
    }
  });

  it('refuses a malformed keyring and a short salt', async () => {
    const b = await backend({ vars: { TOKEN_KEYS: 'k1:tooShort' } });
    expect((await new Player(b).call('POST', '/v1/auth/guest', { adultConfirmed: true, locale: 'en' })).status).toBe(503);
    b.close();
    const c = await backend({ vars: { RATE_SALT: 'short' } });
    expect((await new Player(c).call('POST', '/v1/auth/guest', { adultConfirmed: true, locale: 'en' })).status).toBe(503);
    c.close();
  });

  it('refuses to lock without SIGNING_KEY, while sign-up keeps working', async () => {
    const b = await backend({ vars: { SIGNING_KEY: undefined } });
    const a = new Player(b);
    await a.signup();
    const d = await a.call<{ matchId: string }>('POST', '/v1/duels', {});
    expect(d.status).toBe(201);
    const { testPlan } = await import('./fakeEngine');
    expect((await a.call('POST', `/v1/matches/${d.body.matchId}/lock`, { plan: testPlan(1) })).status).toBe(503);
    b.close();
  });

  it('only lets ALLOW_UNLIMITED_WRITES skip the salt outside production', async () => {
    const dev = await backend({ rateLimits: 'off' });
    expect((await new Player(dev).call('POST', '/v1/auth/guest', { adultConfirmed: true, locale: 'en' })).status).toBe(201);
    dev.close();
    const prod = await backend({ rateLimits: 'off', vars: { ENVIRONMENT: 'production' } });
    expect((await new Player(prod).call('POST', '/v1/auth/guest', { adultConfirmed: true, locale: 'en' })).status).toBe(503);
    prod.close();
  });
});

// ---- Google ------------------------------------------------------------------------------------------------------

const CLIENT_ID = 'test-client.apps.googleusercontent.com';

async function googleKeys(kid = 'k1') {
  const pair = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid, alg: 'RS256', use: 'sig' };
  async function sign(claims: Record<string, unknown>, headerKid = kid): Promise<string> {
    const h = toBase64Url(utf8(JSON.stringify({ alg: 'RS256', kid: headerKid, typ: 'JWT' })));
    const p = toBase64Url(utf8(JSON.stringify(claims)));
    const s = toBase64Url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, utf8(`${h}.${p}`))));
    return `${h}.${p}.${s}`;
  }
  return { jwk, sign };
}

function jwksFetch(keys: object[], counter = { n: 0 }) {
  return async (url: string) => {
    counter.n++;
    if (url !== GOOGLE_JWKS_URL) throw new Error(`unexpected fetch ${url}`);
    return new Response(JSON.stringify({ keys }), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } });
  };
}

describe('Google linking and recovery', () => {
  const claims = (over: Record<string, unknown> = {}) => ({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1234567890', iat: Math.floor(T0 / 1000) - 10, exp: Math.floor(T0 / 1000) + 3600, email: 'someone@example.com', ...over });

  it('is disabled (503) until GOOGLE_CLIENT_IDS is set', async () => {
    const b = await backend();
    const p = new Player(b);
    await p.signup();
    const r = await p.call<{ error: { code: string } }>('POST', '/v1/auth/link/google', { idToken: 'x.y.z' });
    expect(r.status).toBe(503);
    b.close();
  });

  it('links with a valid ID token, stores only a peppered hash, and recovers the account on a new device', async () => {
    const g = await googleKeys();
    const b = await backend({ vars: { GOOGLE_CLIENT_IDS: `other-id,${CLIENT_ID}` }, fetch: jwksFetch([g.jwk]) });
    const p = new Player(b);
    const t = await p.signup('Swift Falcon');
    const idToken = await g.sign(claims());
    const linked = await p.call('POST', '/v1/auth/link/google', { idToken });
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    expect((await p.call<Profile>('GET', '/v1/me')).body.linked.google).toBe(true);
    const stored = JSON.stringify(b.db.db.prepare('SELECT * FROM identities').all());
    expect(stored).not.toContain('1234567890');
    expect(stored).not.toContain('example.com');
    // Linking again is idempotent; a second player cannot take the same Google account.
    expect((await p.call('POST', '/v1/auth/link/google', { idToken })).status).toBe(200);
    const q = new Player(b);
    await q.signup();
    expect((await q.call('POST', '/v1/auth/link/google', { idToken })).status).toBe(409);
    // Recovery: a fresh device signs in with Google and gets the original player back.
    const fresh = new Player(b);
    const rec = await fresh.call<SessionTokens>('POST', '/v1/auth/google', { idToken }, { token: null });
    expect(rec.status).toBe(200);
    expect(rec.body.playerId).toBe(t.playerId);
    b.close();
  });

  it('rejects wrong audience, wrong issuer, expired, future, unsigned and foreign-key tokens', async () => {
    const g = await googleKeys();
    const evil = await googleKeys('k1');
    const b = await backend({ vars: { GOOGLE_CLIENT_IDS: CLIENT_ID }, fetch: jwksFetch([g.jwk]) });
    const p = new Player(b);
    await p.signup();
    const bad = [
      await g.sign(claims({ aud: 'someone-else' })),
      await g.sign(claims({ iss: 'https://evil.example' })),
      await g.sign(claims({ exp: Math.floor(T0 / 1000) - 120 })),
      await g.sign(claims({ iat: Math.floor(T0 / 1000) + 600 })),
      await g.sign(claims({ sub: '' })),
      await evil.sign(claims()),
      (await g.sign(claims())).replace(/\.[^.]+$/, '.AAAA'),
      'not.a.jwt',
    ];
    for (const idToken of bad) expect((await p.call('POST', '/v1/auth/link/google', { idToken })).status, idToken.slice(0, 20)).toBe(401);
    b.close();
  });

  it('caches the JWKS and refetches once for an unknown key id', async () => {
    const g1 = await googleKeys('k1');
    const g2 = await googleKeys('k2');
    const counter = { n: 0 };
    let keys: object[] = [g1.jwk];
    const fetcher = async (url: string) => jwksFetch(keys, counter)(url);
    let now = T0;
    const v = createGoogleVerifier({ fetch: fetcher });
    expect(await v.verify(await g1.sign(claims()), [CLIENT_ID], now)).toEqual({ sub: '1234567890' });
    expect(await v.verify(await g1.sign(claims()), [CLIENT_ID], now)).not.toBeNull();
    expect(counter.n).toBe(1);
    keys = [g1.jwk, g2.jwk];
    now += 61_000;
    expect(await v.verify(await g2.sign(claims(), 'k2'), [CLIENT_ID], now)).not.toBeNull();
    expect(counter.n).toBe(2);
    // An unknown kid inside the refetch interval does not hammer Google.
    expect(await v.verify(await g2.sign(claims(), 'k9'), [CLIENT_ID], now + 1000)).toBeNull();
    expect(counter.n).toBe(2);
  });
});

describe('passkeys (adapter, off until configured)', () => {
  it('answers 503 until PASSKEYS_ENABLED=1, then links and recovers through the verifier', async () => {
    const off = await backend();
    const p = new Player(off);
    await p.signup();
    expect((await p.call('POST', '/v1/auth/link/passkey', { credential: 'mock-passkey:abcdefgh1' })).status).toBe(503);
    off.close();
    const on = await backend({ vars: { PASSKEYS_ENABLED: '1' } });
    const q = new Player(on);
    const t = await q.signup();
    expect((await q.call('POST', '/v1/auth/link/passkey', { credential: 'mock-passkey:abcdefgh1' })).status).toBe(200);
    expect((await q.call('POST', '/v1/auth/link/passkey', { credential: 'garbage' })).status).toBe(401);
    const rec = await new Player(on).call<SessionTokens>('POST', '/v1/auth/passkey', { credential: 'mock-passkey:abcdefgh1' }, { token: null });
    expect(rec.body.playerId).toBe(t.playerId);
    on.close();
  });
});

describe('request plumbing', () => {
  it('needs a known origin for browsers and allows non-browser clients', async () => {
    const b = await backend();
    const bad = await b.fetch(`${API}/v1/health`, { headers: { origin: 'https://evil.example' } });
    expect(bad.status).toBe(403);
    const ok = await b.fetch(`${API}/v1/health`, { headers: { origin: ORIGIN } });
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect((await b.fetch(`${API}/v1/health`)).status).toBe(200);
    b.close();
  });
});
