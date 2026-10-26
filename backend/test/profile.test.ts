// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { MatchEventLog, MatchView, Profile } from '@/contracts';
import { API, Player, backend, duel } from './helpers';

describe('profile', () => {
  it('edits alias, avatar, kit, locale, city and the 18+ confirmation, with moderation', async () => {
    const b = await backend();
    const p = new Player(b);
    await p.signup();
    const ok = await p.call<Profile>('PATCH', '/v1/me', {
      alias: '  Rapid   Spinner ',
      avatar: { seed: 'abcd1234ef' },
      kit: { id: 'starter', primary: '#1E2A78', secondary: '#FFB020', pattern: 'sash' },
      locale: 'hi',
      city: 'pune',
      adultConfirmed: true,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ alias: 'Rapid Spinner', avatar: { seed: 'abcd1234ef' }, locale: 'hi', city: 'pune', adultConfirmed: true });
    for (const bad of [
      { alias: 'Chutiya King' },
      { alias: 'Call 9876543210' },
      { alias: 'VANDE Support' },
      { city: 'Atlantis' },
      { kit: { id: 'ipl-team', primary: '#000000', secondary: '#FFFFFF', pattern: 'plain' } },
      { avatar: { seed: 'x', url: 'https://evil.example/face.png' } },
      { locale: 'fr' },
      { adultConfirmed: 'yes' },
      { email: 'someone@example.com' },
    ]) {
      expect((await p.call('PATCH', '/v1/me', bad)).status, JSON.stringify(bad)).toBe(400);
    }
    // 18+ only: the confirmation given at sign-up cannot be withdrawn here.
    const off = await p.call<{ error: { code: string; message: string } }>('PATCH', '/v1/me', { adultConfirmed: false });
    expect(off.status).toBe(400);
    expect(off.body.error).toEqual({ code: 'invalid', message: 'VANDE Cricket is for players aged 18 and over, so this confirmation cannot be turned off. To leave, delete your account.' });
    expect((await p.call<Profile>('GET', '/v1/me')).body.adultConfirmed).toBe(true);
    expect((await p.call<Profile>('PATCH', '/v1/me', { city: null })).body.city).toBeNull();
    const audits = b.db.db.prepare("SELECT detail FROM audit_log WHERE action = 'alias_rejected'").all() as Array<{ detail: string }>;
    expect(audits.map((a) => JSON.parse(a.detail).reason).sort()).toEqual(['contact', 'offensive', 'reserved']);
    b.close();
  });
});

describe('private groups', () => {
  it('creates a group with a code, joins by code (forgiving typing), shows the name to members only', async () => {
    const b = await backend();
    const p = new Player(b);
    await p.signup();
    const g = await p.call<{ groupId: string; code: string }>('POST', '/v1/groups', { kind: 'college', name: 'IIT Bombay 2027' });
    expect(g.status).toBe(201);
    expect(g.body.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    const q = new Player(b);
    await q.signup();
    const typed = g.body.code.toLowerCase().replace('-', ' ').replace(/0/g, 'o').replace(/1/g, 'l');
    const j = await q.call<{ groupId: string }>('POST', '/v1/groups/join', { code: typed });
    expect(j.status, JSON.stringify(j.body)).toBe(200);
    expect(j.body.groupId).toBe(g.body.groupId);
    expect((await q.call<Profile>('GET', '/v1/me')).body.groups).toEqual([{ groupId: g.body.groupId, kind: 'college', name: 'IIT Bombay 2027' }]);
    const outsider = new Player(b);
    await outsider.signup();
    expect((await outsider.call<Profile>('GET', '/v1/me')).body.groups).toEqual([]);
    expect((await outsider.call('POST', '/v1/groups/join', { code: 'ABCDE-FGHJK' })).status).toBe(404);
    expect((await outsider.call('POST', '/v1/groups/join', { code: '123' })).status).toBe(400);
    expect((await outsider.call('POST', '/v1/groups', { kind: 'school', name: 'X School' })).status).toBe(400);
    expect((await outsider.call('POST', '/v1/groups', { kind: 'company', name: 'Gandu Corp' })).status).toBe(400);
    expect(Number((b.db.db.prepare('SELECT member_count AS n FROM groups').get() as { n: number }).n)).toBe(2);
    b.close();
  });

  it('caps memberships and daily join attempts', async () => {
    const b = await backend({ vars: { GROUP_JOINS_PER_PLAYER_PER_DAY: '3' } });
    const p = new Player(b);
    await p.signup();
    for (let i = 0; i < 4; i++) expect((await p.call('POST', '/v1/groups', { kind: 'company', name: `Team Blue ${i}` })).status).toBe(201);
    expect((await p.call('POST', '/v1/groups', { kind: 'company', name: 'One More' })).status).toBe(409);
    const q = new Player(b);
    await q.signup();
    for (let i = 0; i < 3; i++) expect((await q.call('POST', '/v1/groups/join', { code: `ZZZZZ-ZZZZ${i}` })).status).toBe(404);
    expect((await q.call('POST', '/v1/groups/join', { code: 'ZZZZZ-ZZZZ9' })).status).toBe(429);
    b.close();
  });
});

describe('export', () => {
  it('writes an export to R2 and serves it through a signed, expiring link', async () => {
    const b = await backend();
    const { a, matchId } = await duel(b);
    const e = await a.call<{ downloadUrl: string; expiresAt: string }>('POST', '/v1/me/export');
    expect(e.status).toBe(201);
    expect(e.body.downloadUrl.startsWith(`${API}/v1/exports/x`)).toBe(true);
    const path = e.body.downloadUrl.slice(API.length);
    const got = await new Player(b).call<{ profile: Profile; matches: MatchView[]; format: string }>('GET', path, undefined, { token: null });
    expect(got.status).toBe(200);
    expect(got.headers.get('content-disposition')).toContain('attachment');
    expect(got.body.format).toBe('vande-cricket-export');
    expect(got.body.profile.playerId).toBe(a.tokens!.playerId);
    expect(got.body.matches.map((m) => m.matchId)).toEqual([matchId]);
    const text = JSON.stringify(got.body);
    expect(text).not.toMatch(/"uid"|refresh|accessToken/);
    expect((await new Player(b).call('GET', path.replace(/t=[^&]+/, 't=xt1.dev1.e30.AAAA'), undefined, { token: null })).status).toBe(404);
    b.clock.advance(24 * 3_600_000 + 1);
    expect((await new Player(b).call('GET', path, undefined, { token: null })).status).toBe(404);
    await b.scheduled();
    expect(b.files.objects.size).toBe(0);
    b.close();
  });
});

describe('deletion', () => {
  it('deletes the account everywhere: sessions, identities, groups, push tokens, and the player in every match', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    await a.lock(matchId, 1);
    await c.lock(matchId, 2);
    await a.batInnings(matchId);
    await c.batInnings(matchId);
    await c.call('POST', '/v1/push/register', { token: `fcm-token-${'x'.repeat(40)}`, platform: 'android' });
    await c.call('POST', '/v1/groups', { kind: 'college', name: 'Anna University' });
    const gone = await c.call<{ deleted: boolean }>('DELETE', '/v1/me');
    expect(gone.body).toEqual({ deleted: true });
    expect((await c.call('GET', '/v1/me', undefined, {})).status).toBe(401);
    expect((await c.call('POST', '/v1/auth/refresh', { refreshToken: c.tokens!.refreshToken }, { token: null })).status).toBe(401);
    const log = (await a.call<MatchEventLog>('GET', `/v1/matches/${matchId}/reveal`)).body;
    expect(log.players[1].alias).toBe('Deleted player');
    expect(JSON.stringify(log)).not.toContain(c.tokens!.playerId);
    expect((await a.view(matchId)).body.players[1]?.alias).toBe('Deleted player');
    for (const table of ['sessions', 'identities', 'group_members', 'push_tokens', 'match_players', 'idempotency']) {
      const rows = b.db.db.prepare(`SELECT * FROM ${table}`).all();
      expect(JSON.stringify(rows), table).not.toContain(c.tokens!.playerId);
    }
    const account = b.db.db.prepare("SELECT alias, status FROM accounts WHERE status = 'deleted'").all();
    expect(account).toEqual([{ alias: '', status: 'deleted' }]);
    expect(Number((b.db.db.prepare('SELECT member_count AS n FROM groups').get() as { n: number }).n)).toBe(0);
    // A deleted player's tombstone is purged after 30 days.
    b.clock.advance(31 * 24 * 3_600_000);
    await b.scheduled();
    expect(b.db.db.prepare("SELECT * FROM accounts WHERE status = 'deleted'").all()).toEqual([]);
    b.close();
  });

  it('hands a long match history to the maintenance queue and still forgets the player everywhere', async () => {
    const b = await backend();
    const p = new Player(b);
    await p.signup('Rapid Opener');
    const ids: string[] = [];
    for (let i = 0; i < 28; i++) ids.push((await p.call<{ matchId: string }>('POST', '/v1/duels', {})).body.matchId);
    expect((await p.call('DELETE', '/v1/me')).status).toBe(200);
    expect(b.maint.messages.length).toBe(3);
    await b.drainQueues();
    for (const id of ids) {
      const seat0 = (await b.matches.storage(id).get<{ ref: { alias: string } }>(['seat0'])).get('seat0')!;
      expect(seat0.ref.alias).toBe('Deleted player');
    }
    b.close();
  });

  it('a match in progress continues for the opponent after a deletion (Auto Over, Auto XI)', async () => {
    const b = await backend();
    const { a, c, matchId } = await duel(b);
    await a.lock(matchId, 1);
    await c.call('DELETE', '/v1/me');
    await b.advance(24 * 3_600_000 + 1);
    await a.refresh();
    await a.batInnings(matchId);
    await b.advance(24 * 3_600_000);
    await a.refresh();
    const view = (await a.view(matchId)).body;
    expect(view.phase).toBe('revealed');
    expect(view.players[1]?.alias).toBe('Deleted player');
    b.close();
  });
});

describe('push registration, reports and blocks', () => {
  it('stores push tokens encrypted, keeps at most five devices', async () => {
    const b = await backend();
    const p = new Player(b);
    await p.signup();
    for (let i = 0; i < 7; i++) expect((await p.call('POST', '/v1/push/register', { token: `device-token-${i}-${'a'.repeat(30)}`, platform: 'android' })).status).toBe(200);
    const rows = b.db.db.prepare('SELECT token_enc FROM push_tokens').all() as Array<{ token_enc: string }>;
    expect(rows.length).toBe(5);
    expect(JSON.stringify(rows)).not.toContain('device-token');
    expect((await p.call('POST', '/v1/push/register', { token: 'short', platform: 'android' })).status).toBe(400);
    expect((await p.call('POST', '/v1/push/register', { token: `ok-token-${'b'.repeat(30)}`, platform: 'ios' })).status).toBe(400);
    b.close();
  });

  it('files reports and blocks without exposing the reporter', async () => {
    const b = await backend();
    const p = new Player(b);
    const q = new Player(b);
    await p.signup();
    const tq = await q.signup();
    expect((await p.call('POST', '/v1/report', { playerId: tq.playerId, reason: 'abusive' })).status).toBe(200);
    expect((await p.call('POST', '/v1/report', { reason: 'abusive' })).status).toBe(400);
    expect((await p.call('POST', `/v1/blocks/${tq.playerId}`)).status).toBe(200);
    expect((await p.call('POST', `/v1/blocks/${p.tokens!.playerId}`)).status).toBe(400);
    const report = b.db.db.prepare('SELECT reporter_ref FROM reports').get() as { reporter_ref: string };
    expect(report.reporter_ref).toMatch(/^[0-9a-f]{16}$/);
    b.close();
  });
});
