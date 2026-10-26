// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { NO_ADDRESS_KEY, limitKey } from '../src/http/http';
import type { RateLimitBinding } from '../src/env';
import { Player, backend } from './helpers';

const signup = (p: Player) => p.call('POST', '/v1/auth/guest', { adultConfirmed: true, locale: 'en' });

describe('network keys', () => {
  it('groups IPv4 by address, IPv6 by /64 (or /56, /48), maps IPv4-in-IPv6, and shares one key for unusable input', () => {
    expect(limitKey('203.0.113.5')).toBe('v4:203.0.113.5');
    expect(limitKey('2001:db8:1:2:aaaa::1')).toBe(limitKey('2001:db8:1:2:ffff:1:2:3'));
    expect(limitKey('2001:db8:1:2::1')).not.toBe(limitKey('2001:db8:1:3::1'));
    // Anonymous routes: one /56 (or /48) is one network, so a rented server's thousands of /64s count once.
    expect(limitKey('2001:db8:1:2::1', 56)).toBe(limitKey('2001:db8:1:ff::1', 56));
    expect(limitKey('2001:db8:1:100::1', 56)).not.toBe(limitKey('2001:db8:1:2::1', 56));
    expect(limitKey('2001:db8:1:ffff::1', 48)).toBe(limitKey('2001:db8:1:2::1', 48));
    expect(limitKey('2001:db8:1:2::1', 56)).toBe('v6:2001:0db8:0001:0000::/56');
    expect(limitKey('::ffff:198.51.100.9')).toBe('v4:198.51.100.9');
    expect(limitKey('')).toBe(NO_ADDRESS_KEY);
    expect(limitKey('not-an-ip')).toBe(NO_ADDRESS_KEY);
    expect(limitKey('999.1.1.1')).toBe(NO_ADDRESS_KEY);
  });
});

describe('rate limits (bindings)', () => {
  it('limits sign-ups per network per minute; another network and the next minute are fine', async () => {
    const b = await backend({ bindingLimits: { RL_AUTH: 3 } });
    const p = new Player(b, '203.0.113.9');
    for (let i = 0; i < 3; i++) expect((await signup(p)).status).toBe(201);
    const r = await signup(p);
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('60');
    expect((await signup(new Player(b, '203.0.113.10'))).status).toBe(201);
    b.clock.advance(60_000);
    expect((await signup(p)).status).toBe(201);
    expect(b.metrics.get('rate_limited', 'auth')).toBe(1);
    b.close();
  });

  it('treats a whole IPv6 /56 as one network on anonymous routes (rotating /64s gains nothing)', async () => {
    const b = await backend({ bindingLimits: { RL_AUTH: 2 } });
    expect((await signup(new Player(b, '2001:db8:7:7::1'))).status).toBe(201);
    expect((await signup(new Player(b, '2001:db8:7:8:abcd::99'))).status).toBe(201);
    expect((await signup(new Player(b, '2001:db8:7:9:1:2:3:4'))).status).toBe(429);
    expect((await signup(new Player(b, '2001:db8:7:100::1'))).status).toBe(201);
    b.close();
  });

  it('a global ceiling stops address rotation (anonymous traffic has its own)', async () => {
    const b = await backend({ bindingLimits: { RL_GLOBAL_ANON: 5 } });
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await signup(new Player(b, `198.18.0.${i + 1}`))).status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
    expect(statuses.slice(5)).toEqual([429, 429, 429]);
    b.close();
  });

  it('limits floods of bad tokens per network before checking them', async () => {
    const b = await backend({ bindingLimits: { RL_NET: 3 } });
    const p = new Player(b, '203.0.113.66');
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await p.call('GET', '/v1/me', undefined, { token: `at1.k1.${'x'.repeat(30)}.y` })).status);
    expect(statuses).toEqual([401, 401, 401, 429]);
    b.close();
  });

  it('limits a signed-in player across networks (per-player key)', async () => {
    const b = await backend({ bindingLimits: { RL_PLAYER: 3 } });
    const p = new Player(b);
    await p.signup();
    const ips = ['192.0.2.1', '192.0.2.2', '192.0.2.3', '192.0.2.4'];
    const statuses = [];
    for (const ip of ips) statuses.push((await p.call('PATCH', '/v1/me', { locale: 'hi' }, { ip })).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    b.close();
  });
});

describe('rate limits (D1 fallback)', () => {
  it('uses salted, hashed buckets in D1 and never stores an address', async () => {
    const b = await backend({ rateLimits: 'd1', vars: { RATE_AUTH_PER_MINUTE: '2' } });
    const p = new Player(b, '203.0.113.77');
    expect((await signup(p)).status).toBe(201);
    expect((await signup(p)).status).toBe(201);
    expect((await signup(p)).status).toBe(429);
    const rows = JSON.stringify(b.db.db.prepare('SELECT * FROM rate_buckets').all());
    expect(rows).not.toContain('203.0.113');
    expect(rows.length).toBeGreaterThan(10);
    b.close();
  });

  it('a failing binding falls back to D1 instead of to no limit', async () => {
    const broken: RateLimitBinding = { limit: async () => Promise.reject(new Error('binding down')) };
    const b = await backend({ rateLimits: 'd1', vars: { RL_AUTH: broken, RATE_AUTH_PER_MINUTE: '1' } });
    const p = new Player(b);
    expect((await signup(p)).status).toBe(201);
    expect((await signup(p)).status).toBe(429);
    b.close();
  });
});

describe('daily caps', () => {
  it('caps guest accounts per network per day and duels per player per day', async () => {
    const b = await backend({ vars: { GUESTS_PER_NETWORK_PER_DAY: '2', DUELS_PER_PLAYER_PER_DAY: '2' } });
    const ip = '203.0.113.200';
    expect((await signup(new Player(b, ip))).status).toBe(201);
    expect((await signup(new Player(b, ip))).status).toBe(201);
    b.clock.advance(120_000);
    expect((await signup(new Player(b, ip))).status).toBe(429);
    const p = new Player(b);
    await p.signup();
    expect((await p.call('POST', '/v1/duels', {})).status).toBe(201);
    expect((await p.call('POST', '/v1/duels', {})).status).toBe(201);
    expect((await p.call('POST', '/v1/duels', {})).status).toBe(429);
    b.clock.advance(24 * 3_600_000);
    expect((await p.call('POST', '/v1/duels', {})).status).toBe(201);
    b.close();
  });
});
