// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { handle, scheduled, type Env } from '../src/index';
import { claimedLiteAnswer, evaluateLiteAnswer, publicGoal, validateGrade, validateStart } from '../src/liteDares';
import { __resetSigningKeyForTests, signHex, signingKey } from '../src/signing';
import { MemoryCache, MemoryD1 } from './d1-memory';
import { FIXTURE_DEADLINE, playChapter } from './liteFixtures';
import { TWIST_POOL, twistById } from '@/lite/twists';
import { bestOf, evaluateAll, rankOf } from '@/lite/points';
import { applyToken, replayDare } from '@/lite/replay';
import { actionKindOf } from '@/components/game/cards/actionKind';
import { hexToBytes, liteDareCanonical, parseSignatureField, type LiteGradeResponse, type LiteStartResponse } from '@/community/liteDareProtocol';

const NOW = new Date('2026-10-26T09:30:00Z');
const ORIGIN = 'https://paulhironmoy.github.io';
const DEVICE_A = 'a'.repeat(64);
const DEVICE_B = 'b'.repeat(64);

let keys: CryptoKeyPair;
let jwkText: string;

beforeEach(async () => {
  __resetSigningKeyForTests();
  keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  jwkText = JSON.stringify(await crypto.subtle.exportKey('jwk', keys.privateKey));
});

function env(overrides: Partial<Env> = {}): Env {
  return { DB: new MemoryD1(), ALLOWED_ORIGINS: ORIGIN, MIN_COHORT: '3', RATE_SALT: 'test-salt', DARE_SIGNING_KEY: jwkText, ...overrides };
}

const dare0 = { seed: 42, path: '', step: 'd0', deadline: FIXTURE_DEADLINE };

function startBody(over: Record<string, unknown> = {}) {
  return { v: 1, dare: dare0, deviceKey: DEVICE_A, nonce: 'abc123', answerPath: 'd0-0', claim: { points: 196, best: true, kind: 'protect' }, ...over };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request(`https://api.example${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'cf-connecting-ip': '203.0.113.9', 'content-length': String(text.length), ...headers },
    body: text,
  });
}

const at = (now: Date) => ({ now: () => now });

async function start(e: Env, body: unknown = startBody(), now = NOW) {
  const res = await handle(post('/v1/lite/attempts', body), e, at(now));
  return { res, body: (await res.json()) as LiteStartResponse & { error?: string; details?: string[] } };
}

async function grade(e: Env, attemptId: string, twistAnswer: string | null, deviceKey = DEVICE_A, now = NOW) {
  const res = await handle(post(`/v1/lite/attempts/${attemptId}/grade`, { v: 1, deviceKey, twistAnswer }), e, at(now));
  return { res, body: (await res.json()) as LiteGradeResponse & { error?: string } };
}

async function verifies(g: LiteGradeResponse, dare = dare0, publicKey = keys.publicKey): Promise<boolean> {
  const parsed = parseSignatureField(g.sig);
  if (!parsed) return false;
  const text = liteDareCanonical({ dare, points: g.points, best: g.best, twistId: g.twistId, twist: g.twist, nonce: g.nonce }, parsed.marker);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, hexToBytes(parsed.hex)!, new TextEncoder().encode(text));
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

    // Same device and dare: the same attempt and twist back, even with another answer, claim or nonce.
    const again = await start(e, startBody({ answerPath: 'd0-3', nonce: 'zzzzzz', claim: { points: 10, best: false, kind: 'wait' } }));
    expect(again.res.status).toBe(200);
    expect(again.body).toMatchObject({ attemptId: first.body.attemptId, twistId: first.body.twistId, nonce: 'abc123', points: 196, created: false });
    // Another device: its own attempt.
    const other = await start(e, startBody({ deviceKey: DEVICE_B }));
    expect(other.res.status).toBe(201);
    expect(other.body.attemptId).not.toBe(first.body.attemptId);
    const db = e.DB as MemoryD1;
    expect(db.attempts.size).toBe(2);
    // Nothing stored identifies a person: no address, only hashes and game moves.
    expect(JSON.stringify([...db.attempts.values()]) + JSON.stringify([...db.buckets.keys()])).not.toContain('203.0.113.9');
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
    // Indexes that do not exist are refused.
    expect((await start(e, startBody({ answerPath: 'd0-7', deviceKey: DEVICE_B }))).res.status).toBe(400);
    expect((await start(e, startBody({ answerPath: 'e99.d0-1', deviceKey: 'c'.repeat(64) }))).res.status).toBe(400);
  });

  it('with replay (LITE_VERIFY_REPLAY=1): ignores the claim and signs what the replay shows', async () => {
    const e = env({ LITE_VERIFY_REPLAY: '1' });
    const { state, scenario } = replayDare(dare0);
    const evals = evaluateAll(state, scenario, scenario.decisions[0]);
    const best = bestOf(evals);
    const lie = await start(e, startBody({ answerPath: 'd0-3', claim: { points: 9999, best: true, kind: 'enforce' } }));
    expect(lie.res.status).toBe(201);
    expect(lie.body).toMatchObject({ points: evals[3].pts, best: rankOf(evals, scenario.decisions[0].options[3].id).rank === 1, kind: actionKindOf(best.option.tags), verified: 'dare+twist' });
    // A path that does not replay to the dared step is refused.
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
            const evals = evaluateAll(state, scenario, d);
            expect(got).toEqual({ points: evals[idx].pts, best: rankOf(evals, d.options[idx].id).rank === 1, kind: actionKindOf(bestOf(evals).option.tags) });
          } else {
            const o = scenario.rightsMoments[Number(st.dare.step.slice(1))].options[idx];
            expect(got).toEqual({ points: o.correct ? 100 : 0, best: o.correct, kind: 'rule' });
          }
        }
      }
    }
  }, 120_000);

  it('rejects malformed, tampered and oversized requests', async () => {
    const e = env();
    const bad = [
      startBody({ v: 2 }),
      startBody({ deviceKey: 'A'.repeat(64) }),
      startBody({ deviceKey: 'a'.repeat(63) }),
      startBody({ nonce: 'abc' }),
      startBody({ answerPath: 'd1-0' }), // answers another step
      startBody({ answerPath: 'x0.d0-0' }),
      startBody({ answerPath: 'd0-0.e1' }), // scans only before the answer
      startBody({ dare: { ...dare0, path: 'd0-1..e2' } }),
      startBody({ dare: { ...dare0, step: 'e0' } }),
      startBody({ dare: { ...dare0, seed: -1 } }),
      startBody({ dare: { ...dare0, deadline: 5 } }),
      startBody({ dare: { ...dare0, chain: 3 } }),
      startBody({ claim: { points: 10000, best: true, kind: 'protect' } }),
      startBody({ claim: { points: 10, best: 'yes', kind: 'protect' } }),
      startBody({ claim: { points: 10, best: true, kind: 'rule' } }), // a move dare needs a move kind
      startBody({ claim: { points: 10, best: true, kind: 'magic' } }),
      startBody({ extra: 1 }),
      { ...startBody(), claim: undefined },
    ];
    for (const b of bad) {
      const r = await start(e, b);
      expect(r.res.status, JSON.stringify(b)).toBe(400);
    }
    expect(validateStart(startBody()).ok).toBe(true);
    expect((await handle(post('/v1/lite/attempts', '{oops'), e, at(NOW))).status).toBe(400);
    const big = await handle(post('/v1/lite/attempts', startBody(), { 'content-length': '9000' }), e, at(NOW));
    expect(big.status).toBe(413);
    expect((e.DB as MemoryD1).attempts.size).toBe(0);
  });
});

describe('grade', () => {
  it('grades once against the server pool, signs the reply fields, and counts the goal once', async () => {
    const e = env();
    const s = (await start(e)).body;
    const twist = twistById(s.twistId)!;
    const first = await grade(e, s.attemptId, twist.best);
    expect(first.res.status).toBe(200);
    expect(first.body).toMatchObject({ attemptId: s.attemptId, points: 196, best: true, twist: 'right', twistId: s.twistId, nonce: 'abc123', verified: 'twist', graded: true });
    expect(first.body.sig).toMatch(/^t[0-9a-f]{128}$/);
    expect(await verifies(first.body)).toBe(true);
    const db = e.DB as MemoryD1;
    expect(db.goal.get('2026-10-26')).toMatchObject({ answers: 1, best: 1 });

    // A second grade (even with another answer) returns the stored result and never regrades or recounts.
    const wrong = twist.options.find((o) => o.id !== twist.best)!.id;
    const again = await grade(e, s.attemptId, wrong);
    expect(again.res.status).toBe(200);
    expect(again.body).toMatchObject({ twist: 'right', sig: first.body.sig, graded: false });
    expect(db.goal.get('2026-10-26')).toMatchObject({ answers: 1, best: 1 });
  });

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
    const w = await grade(e, s2.attemptId, t2.options.find((o) => o.id !== t2.best)!.id, DEVICE_B);
    expect(w.body).toMatchObject({ twist: 'wrong', best: false });
    expect(await verifies(w.body)).toBe(true);
    expect((e.DB as MemoryD1).goal.get('2026-10-26')).toMatchObject({ answers: 2, best: 1 });
  });

  it('a signature covers every field: any change, or a swapped marker, breaks it', async () => {
    const e = env();
    const s = (await start(e)).body;
    const g = (await grade(e, s.attemptId, twistById(s.twistId)!.best)).body;
    expect(await verifies(g)).toBe(true);
    expect(await verifies({ ...g, points: g.points + 1 })).toBe(false);
    expect(await verifies({ ...g, best: !g.best })).toBe(false);
    expect(await verifies({ ...g, nonce: 'zzzzzz' })).toBe(false);
    expect(await verifies({ ...g, twist: 'wrong' })).toBe(false);
    expect(await verifies({ ...g, twistId: 't999' })).toBe(false);
    expect(await verifies({ ...g, sig: `v${g.sig.slice(1)}` })).toBe(false);
    expect(await verifies(g, { ...dare0, deadline: dare0.deadline + 1 })).toBe(false);
    const stranger = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    expect(await verifies(g, dare0, stranger.publicKey)).toBe(false);
  });

  it('refuses other devices, unknown attempts, bad answers and malformed requests', async () => {
    const e = env();
    const s = (await start(e)).body;
    expect((await grade(e, s.attemptId, 'a', DEVICE_B)).res.status).toBe(404);
    expect((await grade(e, 'f'.repeat(32), 'a')).res.status).toBe(404);
    expect((await grade(e, 'not-an-id', 'a')).res.status).toBe(404);
    expect((await grade(e, s.attemptId, 'e')).res.status).toBe(400);
    expect(validateGrade({ v: 1, deviceKey: DEVICE_A, twistAnswer: 'a', extra: 1 }).ok).toBe(false);
    expect(validateGrade({ v: 1, deviceKey: DEVICE_A }).ok).toBe(false);
    // Every pool twist has four options a..d; a twist that vanished from the pool cannot be graded at all.
    expect(TWIST_POOL.twists.every((tw) => tw.options.length <= 4)).toBe(true);
    const db = e.DB as MemoryD1;
    db.attempts.get(s.attemptId)!.twist_id = 't1295';
    expect((await grade(e, s.attemptId, 'a')).res.status).toBe(409);
    expect(db.goal.size).toBe(0);
  });
});

describe('fail closed, kill switch and rate limits', () => {
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
    const open = env({ RATE_SALT: undefined, ALLOW_UNLIMITED_WRITES: '1' });
    expect((await start(open)).res.status).toBe(201);
  });

  it('limits start and grade per address per minute on their own budget', async () => {
    const e = env({ RATE_LIMIT_DARES_PER_MINUTE: '2', RATE_LIMIT_PER_MINUTE: '1' });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await start(e, startBody({ deviceKey: String(i).repeat(64) }))).res.status);
    expect(statuses).toEqual([201, 201, 429, 429]);
    const later = new Date(NOW.getTime() + 61_000);
    expect((await start(e, startBody({ deviceKey: 'e'.repeat(64) }), later)).res.status).toBe(201);
    // The daily-results write budget is separate.
    const results = await handle(
      new Request('https://api.example/v1/daily/2026-10-26/results', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body: JSON.stringify({ v: 1, dailyId: '2026-10-26', contentVersion: 'daily-1', submissionId: 'ab'.repeat(16), score: 60, outcome: 'resilient', fingerprint: 'DESDE', mode: 'simple', appVersion: '1.0.0', platform: 'web' }) }),
      e,
      at(NOW),
    );
    expect(results.status).toBe(201);
  });

  it('keeps CORS rules and 404s for unknown lite paths', async () => {
    const e = env();
    expect((await handle(post('/v1/lite/attempts', startBody(), { origin: 'https://evil.example' }), e, at(NOW))).status).toBe(403);
    const pre = await handle(new Request('https://api.example/v1/lite/attempts', { method: 'OPTIONS', headers: { origin: ORIGIN } }), e, at(NOW));
    expect(pre.status).toBe(204);
    expect((await handle(new Request('https://api.example/v1/lite/nope', { headers: { origin: ORIGIN } }), e, at(NOW))).status).toBe(404);
    expect((await handle(new Request('https://api.example/v1/lite/attempts', { headers: { origin: ORIGIN } }), e, at(NOW))).status).toBe(405);
  });
});

describe('goal and cleanup', () => {
  const goal = (e: Env, opts: Parameters<typeof handle>[2] = {}, day = '2026-10-26') =>
    handle(new Request(`https://api.example/v1/lite/goal/${day}`, { headers: { origin: ORIGIN, 'cf-connecting-ip': '198.51.100.3' } }), e, { now: () => NOW, ...opts });

  it('shows the share only from the minimum cohort, real numbers only, cached at the edge', async () => {
    const e = env({ MIN_COHORT: '3' });
    expect(await (await goal(e)).json()).toMatchObject({ day: '2026-10-26', answers: 0, ready: false, minCohort: 3 });
    for (const [i, path] of ['d0-0', 'd0-3', 'd0-0'].entries()) {
      const device = String(i + 1).repeat(64);
      const s = (await start(e, startBody({ deviceKey: device, answerPath: path, claim: { points: 100, best: path === 'd0-0', kind: 'protect' } }))).body;
      await grade(e, s.attemptId, null, device);
      const g = (await (await goal(e)).json()) as Record<string, unknown>;
      if (i < 2) {
        expect(g).toMatchObject({ answers: i + 1, ready: false });
        expect(g.share).toBeUndefined();
        expect(g.best).toBeUndefined();
      } else expect(g).toMatchObject({ answers: 3, best: 2, share: 66.7, ready: true });
    }
    const cache = new MemoryCache();
    const db = e.DB as MemoryD1;
    const miss = await goal(e, { cache });
    expect(miss.headers.get('x-cache')).toBe('miss');
    expect(miss.headers.get('cache-control')).toContain('max-age=300');
    db.calls = {};
    const hit = await goal(e, { cache });
    expect(hit.headers.get('x-cache')).toBe('hit');
    expect(hit.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(Object.keys(db.calls)).toEqual([]);
    expect((await goal(e, {}, '2026-02-30')).status).toBe(400);
    expect(publicGoal('2026-10-26', 0, 0, NOW, 0)).toMatchObject({ ready: true, answers: 0 });
  });

  it('deletes attempts after 7 days and goal rows after 180, keeping newer ones', async () => {
    const e = env();
    const old = new Date(NOW.getTime() - 8 * 86400000);
    await start(e, startBody(), old);
    await start(e, startBody({ deviceKey: DEVICE_B }), NOW);
    const db = e.DB as MemoryD1;
    db.goal.set('2026-01-01', { answers: 5, best: 1, updated_at: '2026-01-01T00:00:00.000Z' });
    db.goal.set('2026-10-25', { answers: 5, best: 1, updated_at: '2026-10-25T00:00:00.000Z' });
    expect(db.attempts.size).toBe(2);
    await scheduled(e, NOW);
    expect([...db.attempts.values()].map((a) => a.device_key)).toEqual([DEVICE_B]);
    await scheduled(e, new Date('2026-07-01T00:00:00Z'));
    expect([...db.goal.keys()]).toEqual(['2026-10-25']);
  });
});

describe('signing', () => {
  it('imports the JWK once, signs 64-byte r||s as 128 hex, and refuses public or foreign keys', async () => {
    const key = await signingKey(jwkText);
    expect(key).not.toBeNull();
    const hex = await signHex(key!, 'hello');
    expect(hex).toMatch(/^[0-9a-f]{128}$/);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, keys.publicKey, hexToBytes(hex)!, new TextEncoder().encode('hello'))).toBe(true);
    __resetSigningKeyForTests();
    const pub = JSON.stringify(await crypto.subtle.exportKey('jwk', keys.publicKey));
    expect(await signingKey(pub)).toBeNull();
    __resetSigningKeyForTests();
    expect(await signingKey(undefined)).toBeNull();
  });
});

describe('CPU cost of replay (why the free-plan default signs "twist" only)', () => {
  it('measures replaying the first and the last question of a chapter', () => {
    const steps = playChapter(42);
    const time = (st: (typeof steps)[number]) => {
      const answer = [...st.scans, st.bestAnswer].join('.');
      evaluateLiteAnswer(st.dare, answer); // warm up
      const runs: number[] = [];
      for (let i = 0; i < 9; i++) {
        const t = performance.now();
        evaluateLiteAnswer(st.dare, answer);
        runs.push(performance.now() - t);
      }
      return runs.sort((a, b) => a - b)[4];
    };
    const firstMs = time(steps[0]);
    const lastMs = time(steps[steps.length - 1]);
    const claim = (() => {
      const st = steps[steps.length - 1];
      const t = performance.now();
      for (let i = 0; i < 100; i++) claimedLiteAnswer(st.dare, st.bestAnswer, { points: 100, best: true, kind: st.dare.step.startsWith('r') ? 'rule' : 'protect' });
      return (performance.now() - t) / 100;
    })();
    console.info(`[lite replay CPU] first question ${firstMs.toFixed(2)} ms, last question ${lastMs.toFixed(2)} ms, no-replay check ${claim.toFixed(3)} ms (Workers free plan: 10 ms per request)`);
    // Replay cost grows with how far into the chapter the dared question is.
    expect(lastMs).toBeGreaterThan(firstMs);
    // The free-plan path does no simulation at all.
    expect(claim).toBeLessThan(2);
    // Sanity bound only (machines differ); the measured numbers are recorded in docs/BACKEND.md.
    expect(lastMs).toBeLessThan(2000);
  }, 120_000);
});
