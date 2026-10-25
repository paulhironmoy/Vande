// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { handle, scheduled, type Env } from '../src/index';
import { claimedLiteAnswer, evaluateLiteAnswer, publicGoal, validateGrade, validateStart } from '../src/liteDares';
import { __resetSigningKeyForTests, signHex, signingKey } from '../src/signing';
import { NO_ADDRESS_KEY, limitKey, readBody } from '../src/http';
import { PRUNE_BATCH, type RateLimitBinding } from '../src/ratelimit';
import { SQL } from '../src/sql';
import type { D1Like } from '../src/d1';
import { MemoryCache, MemoryD1 } from './d1-memory';
import { FIXTURE_DEADLINE, playChapter } from './liteFixtures';
import { TWIST_POOL, twistById } from '@/lite/twists';
import { bestOf, evaluateAll, rankOf } from '@/lite/points';
import { applyToken, replayDare } from '@/lite/replay';
import { actionKindOf } from '@/components/game/cards/actionKind';
import {
  bytesToHex,
  darePublicKeyId,
  hexToBytes,
  issueDayOf,
  liteContentVersion,
  liteDareCanonical,
  parseSignatureField,
  type LiteGradeResponse,
  type LiteStartResponse,
} from '@/community/liteDareProtocol';

const NOW = new Date('2026-10-26T09:30:00Z');
const ORIGIN = 'https://paulhironmoy.github.io';
const DEVICE_A = 'a'.repeat(64);
const DEVICE_B = 'b'.repeat(64);
const IP = '203.0.113.9';

let keys: CryptoKeyPair;
let jwkText: string;
let publicHex: string;

beforeEach(async () => {
  __resetSigningKeyForTests();
  keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  jwkText = JSON.stringify(await crypto.subtle.exportKey('jwk', keys.privateKey));
  publicHex = bytesToHex(new Uint8Array((await crypto.subtle.exportKey('raw', keys.publicKey)) as ArrayBuffer));
});

function env(overrides: Partial<Env> = {}): Env {
  return { DB: new MemoryD1(), ALLOWED_ORIGINS: ORIGIN, MIN_COHORT: '3', RATE_SALT: 'test-salt', DARE_SIGNING_KEY: jwkText, ...overrides };
}

const dare0 = { seed: 42, path: '', step: 'd0', deadline: FIXTURE_DEADLINE };
const device = (i: number) => (i % 256).toString(16).padStart(2, '0').repeat(32);

function startBody(over: Record<string, unknown> = {}) {
  return { v: 1, contentVersion: liteContentVersion(), dare: dare0, deviceKey: DEVICE_A, nonce: 'abc123', answerPath: 'd0-0', claim: { points: 196, best: true, kind: 'protect' }, ...over };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request(`https://api.example${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'cf-connecting-ip': IP, 'content-length': String(text.length), ...headers },
    body: text,
  });
}

const at = (now: Date) => ({ now: () => now });

async function start(e: Env, body: unknown = startBody(), now = NOW, headers: Record<string, string> = {}) {
  const res = await handle(post('/v1/lite/attempts', body, headers), e, at(now));
  return { res, body: (await res.json()) as LiteStartResponse & { error?: string; details?: string[]; contentVersion?: string } };
}

interface GradeOpts {
  deviceKey?: string;
  now?: Date;
  ip?: string;
  dare?: typeof dare0;
}

async function grade(e: Env, attemptId: string, twistAnswer: string | null, o: GradeOpts = {}) {
  const body = { v: 1, dare: o.dare ?? dare0, deviceKey: o.deviceKey ?? DEVICE_A, twistAnswer };
  const res = await handle(post(`/v1/lite/attempts/${attemptId}/grade`, body, { 'cf-connecting-ip': o.ip ?? IP }), e, at(o.now ?? NOW));
  return { res, body: (await res.json()) as LiteGradeResponse & { error?: string } };
}

async function verifies(g: LiteGradeResponse, dare = dare0, publicKey = keys.publicKey): Promise<boolean> {
  const parsed = parseSignatureField(g.sig);
  if (!parsed) return false;
  const text = liteDareCanonical({ dare, points: g.points, best: g.best, twistId: g.twistId, twist: g.twist, nonce: g.nonce }, parsed);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, hexToBytes(parsed.hex)!, new TextEncoder().encode(text));
}

/** A fake Workers Rate Limiting binding: allows `limit` calls per key, records the keys it saw. */
function fakeBinding(limit: number): RateLimitBinding & { keys: string[] } {
  const counts = new Map<string, number>();
  const keysSeen: string[] = [];
  return {
    keys: keysSeen,
    async limit({ key }) {
      keysSeen.push(key);
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { success: n <= limit };
    },
  };
}

describe('start', () => {
  it('creates one attempt per device key per dare, draws a live twist of the kind, and repeats idempotently', async () => {
    const e = env();
    const first = await start(e);
    expect(first.res.status).toBe(201);
    expect(first.body).toMatchObject({ kind: 'protect', nonce: 'abc123', points: 196, best: true, verified: 'twist', created: true });
    expect(first.body.attemptId).toMatch(/^[0-9a-f]{32}$/);
    const twist = twistById(first.body.twistId)!;
    expect(twist.kind).toBe('protect');
    expect(twist.retired).toBeFalsy();

    const again = await start(e, startBody({ answerPath: 'd0-3', nonce: 'zzzzzz', claim: { points: 10, best: false, kind: 'wait' } }));
    expect(again.res.status).toBe(200);
    expect(again.body).toMatchObject({ attemptId: first.body.attemptId, twistId: first.body.twistId, nonce: 'abc123', points: 196, created: false });
    const other = await start(e, startBody({ deviceKey: DEVICE_B }));
    expect(other.res.status).toBe(201);
    expect(other.body.attemptId).not.toBe(first.body.attemptId);
    const db = e.DB as MemoryD1;
    expect(db.attempts.size).toBe(2);
    const row = [...db.attempts.values()][0];
    // Times to the hour only; nothing identifies a person.
    expect(row.created_hour).toBe('2026-10-26T09:00:00.000Z');
    expect(JSON.stringify([...db.attempts.values()]) + JSON.stringify([...db.buckets.keys()])).not.toContain(IP);
  });

  it('refuses a different content version with 409, storing nothing', async () => {
    const e = env();
    const r = await start(e, startBody({ contentVersion: '1-old-content' }));
    expect(r.res.status).toBe(409);
    expect(r.body).toMatchObject({ error: 'content version mismatch', contentVersion: liteContentVersion() });
    expect((e.DB as MemoryD1).attempts.size).toBe(0);
    expect(liteContentVersion()).toMatch(/^1-[0-9a-z]+-[0-9a-z]+$/);
  });

  it('without replay: checks what needs no replay and scores fair-play answers from the content', async () => {
    const steps = playChapter(42);
    const fair = steps.find((s) => s.dare.step.startsWith('r'))!;
    const wrongOption = fair.answers.find((a) => a !== fair.bestAnswer)!;
    const e = env();
    const claimedWin = await start(e, startBody({ dare: fair.dare, answerPath: wrongOption, claim: { points: 100, best: true, kind: 'rule' } }));
    expect(claimedWin.res.status).toBe(201);
    expect(claimedWin.body).toMatchObject({ points: 0, best: false, kind: 'rule', verified: 'twist' });
    expect(twistById(claimedWin.body.twistId)!.kind).toBe('rule');
    expect(claimedLiteAnswer(fair.dare, fair.bestAnswer, { points: 0, best: false, kind: 'rule' })).toEqual({ points: 100, best: true, kind: 'rule' });
    expect((await start(e, startBody({ answerPath: 'd0-7', deviceKey: DEVICE_B }))).res.status).toBe(400);
    expect((await start(e, startBody({ answerPath: 'e99.d0-1', deviceKey: device(3) }))).res.status).toBe(400);
  });

  it('with replay (LITE_VERIFY_REPLAY=1): ignores the claim and signs what the replay shows', async () => {
    const e = env({ LITE_VERIFY_REPLAY: '1' });
    const { state, scenario } = replayDare(dare0);
    const evals = evaluateAll(state, scenario, scenario.decisions[0]);
    const best = bestOf(evals);
    const lie = await start(e, startBody({ answerPath: 'd0-3', claim: { points: 9999, best: true, kind: 'enforce' } }));
    expect(lie.res.status).toBe(201);
    expect(lie.body).toMatchObject({ points: evals[3].pts, best: rankOf(evals, scenario.decisions[0].options[3].id).rank === 1, kind: actionKindOf(best.option.tags), verified: 'dare+twist' });
    const bad = await start(e, startBody({ deviceKey: DEVICE_B, dare: { ...dare0, step: 'd5' }, answerPath: 'd5-0' }));
    expect(bad.res.status).toBe(400);
    expect(bad.body.error).toBe('dare could not be replayed');
  }, 60_000);

  it('server replay scores every answer of a whole chapter exactly like the app', () => {
    for (const seed of [7, 2026]) {
      for (const st of playChapter(seed)) {
        const { state: s0, scenario } = replayDare(st.dare);
        let state = s0;
        for (const tok of st.scans) state = applyToken(state, scenario, tok);
        for (const answer of st.answers) {
          const got = evaluateLiteAnswer(st.dare, [...st.scans, answer].join('.'));
          const idx = Number(answer.split('-')[1]);
          if (st.dare.step.startsWith('d')) {
            const d = scenario.decisions[Number(st.dare.step.slice(1))];
            const ev = evaluateAll(state, scenario, d);
            expect(got).toEqual({ points: ev[idx].pts, best: rankOf(ev, d.options[idx].id).rank === 1, kind: actionKindOf(bestOf(ev).option.tags) });
          } else {
            const o = scenario.rightsMoments[Number(st.dare.step.slice(1))].options[idx];
            expect(got).toEqual({ points: o.correct ? 100 : 0, best: o.correct, kind: 'rule' });
          }
        }
      }
    }
  }, 120_000);

  it('rejects malformed, tampered and oversized requests, including streamed bodies without a length', async () => {
    const e = env();
    const bad = [
      startBody({ v: 2 }),
      startBody({ contentVersion: 'Bad Version!' }),
      startBody({ deviceKey: 'A'.repeat(64) }),
      startBody({ deviceKey: 'a'.repeat(63) }),
      startBody({ nonce: 'abc' }),
      startBody({ answerPath: 'd1-0' }),
      startBody({ answerPath: 'x0.d0-0' }),
      startBody({ answerPath: 'd0-0.e1' }),
      startBody({ dare: { ...dare0, path: 'd0-1..e2' } }),
      startBody({ dare: { ...dare0, step: 'e0' } }),
      startBody({ dare: { ...dare0, seed: -1 } }),
      startBody({ dare: { ...dare0, deadline: 5 } }),
      startBody({ dare: { ...dare0, chain: 3 } }),
      startBody({ claim: { points: 10000, best: true, kind: 'protect' } }),
      startBody({ claim: { points: 10, best: 'yes', kind: 'protect' } }),
      startBody({ claim: { points: 10, best: true, kind: 'rule' } }),
      startBody({ claim: { points: 10, best: true, kind: 'magic' } }),
      startBody({ extra: 1 }),
      { ...startBody(), claim: undefined },
      { ...startBody(), contentVersion: undefined },
    ];
    for (const b of bad) expect((await start(e, b)).res.status, JSON.stringify(b)).toBe(400);
    expect(validateStart(startBody()).ok).toBe(true);
    expect((await handle(post('/v1/lite/attempts', '{oops'), e, at(NOW))).status).toBe(400);
    expect((await handle(post('/v1/lite/attempts', startBody(), { 'content-length': '9000' }), e, at(NOW))).status).toBe(413);
    // No content-length and a body that keeps coming: refused once it passes 2 KB, never read whole.
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(1024).fill(32));
        if (pulled > 100) c.close();
      },
    });
    const streamed = new Request('https://api.example/v1/lite/attempts', { method: 'POST', headers: { origin: ORIGIN, 'cf-connecting-ip': IP }, body: stream, duplex: 'half' } as RequestInit);
    expect((await handle(streamed, e, at(NOW))).status).toBe(413);
    expect(pulled).toBeLessThan(10);
    expect(await readBody(new Request('https://x.example/', { method: 'POST', body: 'é'.repeat(10) }), 19)).toBeNull(); // bytes, not characters
    expect((e.DB as MemoryD1).attempts.size).toBe(0);
  });
});

describe('grade', () => {
  it('grades once against the server pool and signs with the key id and issue day; a claim never moves the goal', async () => {
    const e = env();
    const s = (await start(e)).body;
    const twist = twistById(s.twistId)!;
    const first = await grade(e, s.attemptId, twist.best);
    expect(first.res.status).toBe(200);
    expect(first.body).toMatchObject({ attemptId: s.attemptId, points: 196, best: true, twist: 'right', twistId: s.twistId, nonce: 'abc123', verified: 'twist', graded: true });
    expect(first.body.sig).toMatch(/^t[0-9a-f]{8}[0-9a-z]{4}[0-9a-f]{128}$/);
    const header = parseSignatureField(first.body.sig)!;
    expect(header.keyId).toBe(await darePublicKeyId(publicHex));
    expect(header.issueDay).toBe(issueDayOf(NOW));
    expect(await verifies(first.body)).toBe(true);
    const db = e.DB as MemoryD1;
    expect(db.goal.size).toBe(0);
    expect([...db.attempts.values()][0].graded_hour).toBe('2026-10-26T09:00:00.000Z');

    const wrong = twist.options.find((o) => o.id !== twist.best)!.id;
    const again = await grade(e, s.attemptId, wrong);
    expect(again.res.status).toBe(200);
    expect(again.body).toMatchObject({ twist: 'right', sig: first.body.sig, graded: false });
    expect(db.goal.size).toBe(0);
  });

  it('with replay, counts a graded answer in the goal exactly once', async () => {
    const e = env({ LITE_VERIFY_REPLAY: '1' });
    const s = (await start(e)).body;
    const twist = twistById(s.twistId)!;
    expect((await grade(e, s.attemptId, twist.best)).body).toMatchObject({ verified: 'dare+twist', graded: true });
    const db = e.DB as MemoryD1;
    expect(db.goal.get('2026-10-26')).toMatchObject({ answers: 1, best: 1 });
    expect((await grade(e, s.attemptId, twist.best)).body.graded).toBe(false);
    expect(db.goal.get('2026-10-26')).toMatchObject({ answers: 1, best: 1 });
  }, 60_000);

  it('signs a skipped twist with ~ and no twist id, and a wrong twist as not quite', async () => {
    const e = env({ LITE_VERIFY_REPLAY: '1' });
    const s = (await start(e)).body;
    const skipped = await grade(e, s.attemptId, null);
    expect(skipped.body).toMatchObject({ twist: 'skipped', verified: 'dare+twist' });
    expect('twistId' in skipped.body).toBe(false);
    expect(skipped.body.sig.startsWith('v')).toBe(true);
    expect(await verifies(skipped.body)).toBe(true);
    const s2 = (await start(e, startBody({ deviceKey: DEVICE_B, answerPath: 'd0-3' }))).body;
    const t2 = twistById(s2.twistId)!;
    const w = await grade(e, s2.attemptId, t2.options.find((o) => o.id !== t2.best)!.id, { deviceKey: DEVICE_B });
    expect(w.body).toMatchObject({ twist: 'wrong', best: false });
    expect(await verifies(w.body)).toBe(true);
    expect((e.DB as MemoryD1).goal.get('2026-10-26')).toMatchObject({ answers: 2, best: 1 });
  }, 60_000);

  it('a signature covers every field, its key id and its issue day', async () => {
    const e = env();
    const s = (await start(e)).body;
    const g = (await grade(e, s.attemptId, twistById(s.twistId)!.best)).body;
    const h = parseSignatureField(g.sig)!;
    expect(await verifies(g)).toBe(true);
    expect(await verifies({ ...g, points: g.points + 1 })).toBe(false);
    expect(await verifies({ ...g, best: !g.best })).toBe(false);
    expect(await verifies({ ...g, nonce: 'zzzzzz' })).toBe(false);
    expect(await verifies({ ...g, twist: 'wrong' })).toBe(false);
    expect(await verifies({ ...g, twistId: 't999' })).toBe(false);
    expect(await verifies({ ...g, sig: `v${g.sig.slice(1)}` })).toBe(false);
    expect(await verifies({ ...g, sig: `${h.marker}00000000${h.issueDay}${h.hex}` })).toBe(false);
    expect(await verifies({ ...g, sig: `${h.marker}${h.keyId}zzzz${h.hex}` })).toBe(false);
    expect(await verifies(g, { ...dare0, deadline: dare0.deadline + 1 })).toBe(false);
    const stranger = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    expect(await verifies(g, dare0, stranger.publicKey)).toBe(false);
  });

  it('finds the attempt by (dare, device key) and refuses a wrong dare, device, id or encoding', async () => {
    const e = env();
    const s = (await start(e)).body;
    expect((await grade(e, s.attemptId, 'a', { deviceKey: DEVICE_B })).res.status).toBe(404);
    expect((await grade(e, s.attemptId, 'a', { dare: { ...dare0, seed: 43 } })).res.status).toBe(404);
    expect((await grade(e, 'f'.repeat(32), 'a')).res.status).toBe(404);
    expect((await grade(e, 'not-an-id', 'a')).res.status).toBe(404);
    const malformed = await grade(e, '%E0%A4%A', 'a');
    expect(malformed.res.status).toBe(404);
    expect(malformed.res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect((await grade(e, s.attemptId, 'e')).res.status).toBe(400);
    expect(validateGrade({ v: 1, dare: dare0, deviceKey: DEVICE_A, twistAnswer: 'a', extra: 1 }).ok).toBe(false);
    expect(validateGrade({ v: 1, deviceKey: DEVICE_A, twistAnswer: 'a' }).ok).toBe(false); // the dare is required
    expect(TWIST_POOL.twists.every((tw) => tw.options.length <= 4)).toBe(true);
    const db = e.DB as MemoryD1;
    [...db.attempts.values()][0].twist_id = 't1295';
    expect((await grade(e, s.attemptId, 'a')).res.status).toBe(409);
    expect(db.goal.size).toBe(0);
  });
});

describe('fail closed, limits by network, global ceilings and bindings', () => {
  it('answers 503 without a usable signing key, with the kill switch, or without the salt', async () => {
    for (const over of [{ DARE_SIGNING_KEY: undefined }, { DARE_SIGNING_KEY: '{"kty":"EC"}' }, { DARE_SIGNING_KEY: 'not json' }, { KILL_LITE_DARES: '1' }, { RATE_SALT: undefined }]) {
      __resetSigningKeyForTests();
      const e = env(over);
      const r = await start(e);
      expect(r.res.status, JSON.stringify(over)).toBe(503);
      expect(r.body.error).toBe('service not configured');
      expect((await grade(e, 'f'.repeat(32), 'a')).res.status).toBe(503);
      expect((e.DB as MemoryD1).attempts.size).toBe(0);
    }
    __resetSigningKeyForTests();
    expect((await start(env({ RATE_SALT: undefined, ALLOW_UNLIMITED_WRITES: '1' }))).res.status).toBe(201);
  });

  it('keys IPv6 by /64: rotating addresses inside one /64 shares one budget; another /64 has its own', async () => {
    const e = env({ RATE_LIMIT_DARES_PER_MINUTE: '2' });
    const rotate = (i: number) => `2001:db8:1234:5678:${(i * 7919).toString(16)}:${i.toString(16)}::${(i + 1).toString(16)}`;
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await start(e, startBody({ deviceKey: device(10 + i) }), NOW, { 'cf-connecting-ip': rotate(i) })).res.status);
    expect(statuses).toEqual([201, 201, 429, 429, 429, 429]);
    expect((await start(e, startBody({ deviceKey: device(40) }), NOW, { 'cf-connecting-ip': '2001:db8:1234:5679::1' })).res.status).toBe(201);
    // IPv4 stays per address; an IPv4-mapped IPv6 address is the same IPv4 network.
    const v4 = env({ RATE_LIMIT_DARES_PER_MINUTE: '1' });
    expect((await start(v4, startBody({ deviceKey: device(50) }), NOW, { 'cf-connecting-ip': '198.51.100.20' })).res.status).toBe(201);
    expect((await start(v4, startBody({ deviceKey: device(51) }), NOW, { 'cf-connecting-ip': '::ffff:198.51.100.20' })).res.status).toBe(429);
    expect((await start(v4, startBody({ deviceKey: device(52) }), NOW, { 'cf-connecting-ip': '198.51.100.21' })).res.status).toBe(201);
  });

  it('a global ceiling stops rotation across many networks', async () => {
    const e = env({ RATE_LIMIT_GLOBAL_WRITES_PER_MINUTE: '3' });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await start(e, startBody({ deviceKey: device(60 + i) }), NOW, { 'cf-connecting-ip': `2001:db8:${i}::1` })).res.status);
    expect(statuses).toEqual([201, 201, 201, 429, 429]);
    const busy = await start(e, startBody({ deviceKey: device(70) }), NOW, { 'cf-connecting-ip': '2001:db8:99::1' });
    expect(busy.body.error).toBe('busy, try again in a minute');
    const later = new Date(NOW.getTime() + 61_000);
    expect((await start(e, startBody({ deviceKey: device(71) }), later, { 'cf-connecting-ip': '2001:db8:98::1' })).res.status).toBe(201);
  });

  it('requests without an address share one limited key, and X-Forwarded-For is ignored', async () => {
    const e = env({ RATE_LIMIT_DARES_PER_MINUTE: '2' });
    const noIp = (i: number) => new Request('https://api.example/v1/lite/attempts', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-forwarded-for': `192.0.2.${i}` },
      body: JSON.stringify(startBody({ deviceKey: device(80 + i) })),
    });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await handle(noIp(i), e, at(NOW))).status);
    expect(statuses).toEqual([201, 201, 429, 429]);
    expect(limitKey('')).toBe(NO_ADDRESS_KEY);
  });

  it('uses the Workers Rate Limiting bindings when present: no D1 buckets, their verdict applies', async () => {
    const dare = fakeBinding(1);
    const global = fakeBinding(100);
    const e = env({ RL_DARE: dare, RL_GLOBAL: global });
    const s = (await start(e)).body;
    expect((e.DB as MemoryD1).buckets.size).toBe(0);
    expect(dare.keys[0]).toMatch(/^[0-9a-f]{40}$/); // a salted hash of the network, never the address
    expect(global.keys).toHaveLength(1); // the start passed both bindings
    expect(global.keys[0]).toMatch(/^[0-9a-f]{40}$/);
    expect((await grade(e, s.attemptId, null)).res.status).toBe(429); // the per-network binding allows one call
    expect(global.keys).toHaveLength(1); // refused before the global ceiling was consulted
    // A failing binding falls back to D1 buckets, never to "no limit".
    const broken: RateLimitBinding = { limit: async () => { throw new Error('binding down'); } };
    const f = env({ RL_DARE: broken, RL_GLOBAL: broken, RATE_LIMIT_DARES_PER_MINUTE: '1' });
    expect((await start(f)).res.status).toBe(201);
    expect((await start(f, startBody({ deviceKey: DEVICE_B }))).res.status).toBe(429);
    expect((f.DB as MemoryD1).buckets.size).toBeGreaterThan(0);
  });

  it('keeps CORS on every error, including malformed encodings and unexpected failures', async () => {
    const e = env();
    expect((await handle(post('/v1/lite/attempts', startBody(), { origin: 'https://evil.example' }), e, at(NOW))).status).toBe(403);
    const pre = await handle(new Request('https://api.example/v1/lite/attempts', { method: 'OPTIONS', headers: { origin: ORIGIN } }), e, at(NOW));
    expect(pre.status).toBe(204);
    expect((await handle(new Request('https://api.example/v1/lite/nope', { headers: { origin: ORIGIN } }), e, at(NOW))).status).toBe(404);
    expect((await handle(new Request('https://api.example/v1/lite/attempts', { headers: { origin: ORIGIN } }), e, at(NOW))).status).toBe(405);
    const badDay = await handle(new Request('https://api.example/v1/lite/goal/%E0%A4%A', { headers: { origin: ORIGIN } }), env({ LITE_VERIFY_REPLAY: '1' }), at(NOW));
    expect(badDay.status).toBe(400);
    expect(badDay.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const badDaily = await handle(new Request('https://api.example/v1/daily/%E0%A4%A/stats', { headers: { origin: ORIGIN } }), e, at(NOW));
    expect(badDaily.status).toBe(400);
    expect(badDaily.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const exploding: D1Like = { prepare: () => { throw new Error('d1 down'); } };
    const crashed = await worker.fetch(post('/v1/lite/attempts', startBody()), { ...env(), DB: exploding });
    expect(crashed.status).toBe(500);
    expect(crashed.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });
});

describe('goal and cleanup', () => {
  const goal = (e: Env, opts: Parameters<typeof handle>[2] = {}, day = '2026-10-26') =>
    handle(new Request(`https://api.example/v1/lite/goal/${day}`, { headers: { origin: ORIGIN, 'cf-connecting-ip': '198.51.100.3' } }), e, { now: () => NOW, ...opts });

  it('says the goal is off on the free-plan default, cacheably and without database work', async () => {
    const e = env();
    const db = e.DB as MemoryD1;
    db.calls = {};
    const r = await goal(e);
    expect(await r.json()).toMatchObject({ day: '2026-10-26', active: false, answers: 0, ready: false });
    expect(r.headers.get('cache-control')).toContain('max-age=3600');
    expect(Object.keys(db.calls)).toEqual([]);
    expect(await (await goal(env({ LITE_VERIFY_REPLAY: '1', LITE_GOAL_PER_ADDRESS_PER_DAY: '0' }))).json()).toMatchObject({ active: false });
  });

  it('shows the share only from the minimum cohort of replay-verified answers, cached at the edge', async () => {
    const e = env({ MIN_COHORT: '3', LITE_VERIFY_REPLAY: '1' });
    expect(await (await goal(e)).json()).toMatchObject({ day: '2026-10-26', active: true, answers: 0, ready: false, minCohort: 3 });
    for (const [i, path] of ['d0-0', 'd0-3', 'd0-0'].entries()) {
      const s = (await start(e, startBody({ deviceKey: device(i + 1), answerPath: path, claim: { points: 1, best: false, kind: 'wait' } }))).body;
      await grade(e, s.attemptId, null, { deviceKey: device(i + 1), ip: `198.51.100.${10 + i}` });
      const g = (await (await goal(e)).json()) as Record<string, unknown>;
      if (i < 2) {
        expect(g).toMatchObject({ answers: i + 1, ready: false });
        expect(g.share).toBeUndefined();
      } else expect(g).toMatchObject({ answers: 3, best: 2, share: 66.7, ready: true });
    }
    const cache = new MemoryCache();
    const db = e.DB as MemoryD1;
    expect((await goal(e, { cache })).headers.get('x-cache')).toBe('miss');
    db.calls = {};
    const hit = await goal(e, { cache });
    expect(hit.headers.get('x-cache')).toBe('hit');
    expect(hit.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(Object.keys(db.calls)).toEqual([]);
    expect((await goal(e, {}, '2026-02-30')).status).toBe(400);
    expect(publicGoal('2026-10-26', 0, 0, NOW, 0)).toMatchObject({ active: true, ready: true, answers: 0 });
    expect(publicGoal('2026-10-26', 99, 99, NOW, 3, false)).toMatchObject({ active: false, ready: false });
  }, 60_000);

  it('cannot be fabricated: claims never count, and one /64 adds at most 3 verified answers a day', async () => {
    const t = env({ MIN_COHORT: '3' });
    for (let i = 0; i < 30; i++) {
      const s = (await start(t, startBody({ deviceKey: device(100 + i), claim: { points: 999, best: true, kind: 'protect' } }))).body;
      expect((await grade(t, s.attemptId, null, { deviceKey: device(100 + i) })).res.status).toBe(200);
    }
    expect((t.DB as MemoryD1).goal.size).toBe(0);

    // Replay mode, 30 rotating addresses inside one /64 (the reviewer's probe): three count, the goal never gets ready.
    const v = env({ MIN_COHORT: '25', LITE_VERIFY_REPLAY: '1', RATE_LIMIT_DARES_PER_MINUTE: '1000' });
    const db = v.DB as MemoryD1;
    for (let i = 0; i < 30; i++) {
      const ip = `2001:db8:abcd:12::${(i + 1).toString(16)}`;
      const s = (await start(v, startBody({ deviceKey: device(140 + i) }), NOW, { 'cf-connecting-ip': ip })).body;
      expect((await grade(v, s.attemptId, null, { deviceKey: device(140 + i), ip })).body).toMatchObject({ graded: true, verified: 'dare+twist' });
    }
    expect(db.goal.get('2026-10-26')).toMatchObject({ answers: 3, best: 3 });
    expect(await (await goal(v)).json()).toMatchObject({ answers: 3, ready: false });
    // Another /64 counts; the cap resets on the next UTC day.
    const other = (await start(v, startBody({ deviceKey: device(200) }), NOW, { 'cf-connecting-ip': '2001:db8:abcd:13::1' })).body;
    await grade(v, other.attemptId, null, { deviceKey: device(200), ip: '2001:db8:abcd:13::1' });
    expect(db.goal.get('2026-10-26')).toMatchObject({ answers: 4 });
    const tomorrow = new Date('2026-10-27T01:00:00Z');
    const next = (await start(v, startBody({ deviceKey: device(201) }), tomorrow)).body;
    await grade(v, next.attemptId, null, { deviceKey: device(201), now: tomorrow });
    expect(db.goal.get('2026-10-27')).toMatchObject({ answers: 1 });
    expect(JSON.stringify([...db.buckets.keys()])).not.toContain('2001:db8');
    // Without a salt (local development only) nothing is counted.
    const open = env({ RATE_SALT: undefined, ALLOW_UNLIMITED_WRITES: '1', LITE_VERIFY_REPLAY: '1' });
    const o = (await start(open)).body;
    await grade(open, o.attemptId, null);
    expect((open.DB as MemoryD1).goal.size).toBe(0);
  }, 60_000);

  it('cleans up in batches, step by step, keeping newer rows', async () => {
    const e = env();
    const old = new Date(NOW.getTime() - 8 * 86400000);
    await start(e, startBody(), old);
    await start(e, startBody({ deviceKey: DEVICE_B }), NOW);
    const db = e.DB as MemoryD1;
    db.goal.set('2026-01-01', { answers: 5, best: 1, updated_at: '2026-01-01T00:00:00.000Z' });
    db.goal.set('2026-10-25', { answers: 5, best: 1, updated_at: '2026-10-25T00:00:00.000Z' });
    // Many old attempts: removed in several batches by one run.
    for (let i = 0; i < PRUNE_BATCH * 2 + 7; i++) {
      const k = `old${i}|dev`;
      db.attempts.set(k, { ...[...db.attempts.values()][0], dare_key: `old${i}`, device_key: 'dev', created_hour: '2026-10-01T00:00:00.000Z' });
    }
    const report = await scheduled(e, NOW);
    expect(report.lite).toBeGreaterThanOrEqual(PRUNE_BATCH * 2 + 8);
    expect(report.cleanup_incomplete).toBe(0);
    expect(report.queries_left).toBeGreaterThan(0);
    expect([...db.attempts.values()].map((a) => a.device_key)).toEqual([DEVICE_B]);
    await scheduled(e, new Date('2026-07-01T00:00:00Z'));
    expect([...db.goal.keys()]).toEqual(['2026-10-25']);

    // A failing step is reported and the others still run.
    const flaky: D1Like = {
      prepare(sql: string) {
        if (sql === SQL.pruneResults) throw new Error('locked');
        return db.prepare(sql);
      },
    };
    db.buckets.set('000000:stale', { window_start: 0, count: 1 });
    const r2 = await scheduled({ ...e, DB: flaky }, NOW);
    expect(r2.daily_results).toBe(-1);
    expect(r2.rate_buckets).toBeGreaterThanOrEqual(1);
    expect(db.buckets.has('000000:stale')).toBe(false);

    // Per-day goal-cap buckets go once their day is more than 24 hours old.
    const v = env({ LITE_VERIFY_REPLAY: '1' });
    const s = (await start(v)).body;
    await grade(v, s.attemptId, null);
    const vdb = v.DB as MemoryD1;
    await scheduled(v, new Date('2026-10-26T23:00:00Z'));
    expect([...vdb.buckets.values()].some((b) => b.window_start === Date.UTC(2026, 9, 26))).toBe(true);
    await scheduled(v, new Date('2026-10-27T03:17:00Z'));
    expect([...vdb.buckets.values()].some((b) => b.window_start === Date.UTC(2026, 9, 26))).toBe(false);
  }, 60_000);
});

describe('cleanup budget', () => {
  it('stops at CLEANUP_MAX_QUERIES, reports the run as incomplete, and the next run finishes', async () => {
    const e = env({ CLEANUP_MAX_QUERIES: '2' });
    await start(e, startBody(), NOW);
    const db = e.DB as MemoryD1;
    const template = [...db.attempts.values()][0];
    for (let i = 0; i < PRUNE_BATCH * 3; i++) db.attempts.set(`old${i}|dev`, { ...template, dare_key: `old${i}`, device_key: 'dev', created_hour: '2026-10-01T00:00:00.000Z' });
    db.buckets.set('000000:stale', { window_start: 0, count: 1 });
    const first = await scheduled(e, NOW);
    expect(first).toMatchObject({ lite: PRUNE_BATCH * 2, rate_buckets: 0, queries_left: 0, cleanup_incomplete: 1 });
    expect(db.buckets.has('000000:stale')).toBe(true);
    const second = await scheduled({ ...e, CLEANUP_MAX_QUERIES: undefined }, NOW);
    expect(second).toMatchObject({ lite: PRUNE_BATCH, rate_buckets: 1, cleanup_incomplete: 0 });
    expect([...db.attempts.values()].map((a) => a.dare_key)).toEqual([template.dare_key]);
  }, 60_000);
});

describe('network keys', () => {
  it('keys IPv4 by address and IPv6 by /64 in every spelling', () => {
    expect(limitKey('198.51.100.7')).toBe('v4:198.51.100.7');
    expect(limitKey('2001:db8:1:2:3:4:5:6')).toBe('v6:2001:0db8:0001:0002::/64');
    expect(limitKey('2001:DB8:1:2::ffff')).toBe('v6:2001:0db8:0001:0002::/64');
    expect(limitKey('2001:db8:1:2::1%eth0')).toBe('v6:2001:0db8:0001:0002::/64');
    expect(limitKey('::ffff:198.51.100.7')).toBe('v4:198.51.100.7');
    expect(limitKey('64:ff9b::198.51.100.7')).toBe('v6:0064:ff9b:0000:0000::/64');
    expect(limitKey('::1')).toBe('v6:0000:0000:0000:0000::/64');
    for (const bad of ['', ' ', 'nonsense', '1.2.3', '256.1.1.1', '1::2::3', '12345::1', 'g::1']) expect(limitKey(bad), bad).toBe(NO_ADDRESS_KEY);
  });
});

describe('signing', () => {
  it('never quotes the secret in its warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      for (const bad of ['{"kty":"EC","crv":"P-256","d":SECRETSECRETSECRET}', 'SECRET', '{"kty":"EC","crv":"P-256","x":"SECRET","y":"SECRET","d":"SECRET"}']) {
        __resetSigningKeyForTests();
        expect(await signingKey(bad)).toBeNull();
      }
      expect(warn).toHaveBeenCalledTimes(3);
      for (const [message] of warn.mock.calls) expect(String(message)).not.toContain('SECRET');
    } finally {
      warn.mockRestore();
      __resetSigningKeyForTests();
    }
  });

  it('imports the JWK once with its key id, signs 64-byte r||s as 128 hex, and refuses public or foreign keys', async () => {
    const sk = await signingKey(jwkText);
    expect(sk).not.toBeNull();
    expect(sk!.keyId).toBe(await darePublicKeyId(publicHex));
    const hex = await signHex(sk!.key, 'hello');
    expect(hex).toMatch(/^[0-9a-f]{128}$/);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, keys.publicKey, hexToBytes(hex)!, new TextEncoder().encode('hello'))).toBe(true);
    __resetSigningKeyForTests();
    expect(await signingKey(JSON.stringify(await crypto.subtle.exportKey('jwk', keys.publicKey)))).toBeNull();
    __resetSigningKeyForTests();
    expect(await signingKey(undefined)).toBeNull();
  });
});

describe('CPU cost of replay (why the free-plan default signs "twist" only)', () => {
  it('measures replaying the first and the last question of a chapter', () => {
    const steps = playChapter(42);
    const time = (st: (typeof steps)[number]) => {
      const answer = [...st.scans, st.bestAnswer].join('.');
      evaluateLiteAnswer(st.dare, answer);
      const runs: number[] = [];
      for (let i = 0; i < 9; i++) {
        const t0 = performance.now();
        evaluateLiteAnswer(st.dare, answer);
        runs.push(performance.now() - t0);
      }
      return runs.sort((a, b) => a - b)[4];
    };
    const firstMs = time(steps[0]);
    const lastMs = time(steps[steps.length - 1]);
    const st = steps[steps.length - 1];
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) claimedLiteAnswer(st.dare, st.bestAnswer, { points: 100, best: true, kind: st.dare.step.startsWith('r') ? 'rule' : 'protect' });
    const claim = (performance.now() - t0) / 100;
    console.info(`[lite replay CPU] first question ${firstMs.toFixed(2)} ms, last question ${lastMs.toFixed(2)} ms, no-replay check ${claim.toFixed(3)} ms (Workers free plan: 10 ms per request)`);
    expect(lastMs).toBeGreaterThan(firstMs);
    expect(claim).toBeLessThan(2);
    expect(lastMs).toBeLessThan(2000);
  }, 120_000);
});
