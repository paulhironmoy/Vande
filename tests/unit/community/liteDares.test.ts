import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';

vi.mock('@/app/flags', async (importOriginal) => {
  const real = (await importOriginal()) as { flags: Record<string, unknown> };
  // The build flag on, so the component and default paths can be exercised; individual tests override with `enabled`.
  return { flags: { ...real.flags, liteVerifiedDares: true, communityApiUrl: 'https://api.example', darePublicKey: '' } };
});

import {
  LITE_GOAL_OFF_KEY,
  LITE_DARE_TIMEOUT_MS,
  __resetLiteDaresForTests,
  fetchLiteGoal,
  gradeVerifiedAttempt,
  liteDeviceKey,
  replyCountsAsVerified,
  replyVerification,
  replyVerifiedScope,
  startVerifiedAttempt,
  verifiedDaresEnabled,
  verifyReplySignature,
} from '@/community/liteDares';
import { LiteGoal } from '@/components/game/community/LiteGoal';
import { sha256Hex } from '@/community/hash';
import { dareIdentity, twistById } from '@/lite/twists';
import { decodeDareReply, encodeDareReply, type DareReply } from '@/share/dare';
import { bytesToHex, darePublicKeyId, hexToBytes, issueDayOf, liteContentVersion, liteDareCanonical, signatureField, utcDay } from '@/community/liteDareProtocol';
import { handle, type Env } from '../../../backend/src/index';
import { __resetSigningKeyForTests, signHex, signingKey } from '../../../backend/src/signing';
import { MemoryD1 } from '../../../backend/test/d1-memory';

const DEADLINE = Math.floor(Date.UTC(2026, 9, 27) / 1000);
const dare = { seed: 42, path: '', step: 'd0', deadline: DEADLINE, points: 196, best: true, chain: 1 };
const INSTALL = '0123456789abcdef0123456789abcdef';
const ORIGIN = 'https://paulhironmoy.github.io';

let keys: CryptoKeyPair;
let publicKeyHex: string;
let jwkText: string;

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  publicKeyHex = bytesToHex(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)));
  jwkText = JSON.stringify(await crypto.subtle.exportKey('jwk', keys.privateKey));
});

beforeEach(() => {
  __resetLiteDaresForTests();
  __resetSigningKeyForTests();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** The real Worker behind a fetch function (no network). */
function workerFetch(over: Partial<Env> = {}) {
  const env: Env = { DB: new MemoryD1(), ALLOWED_ORIGINS: ORIGIN, MIN_COHORT: '2', RATE_SALT: 'salt', DARE_SIGNING_KEY: jwkText, ...over };
  const calls: { url: string; body?: unknown }[] = [];
  const f = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const headers = new Headers(init?.headers);
    headers.set('origin', ORIGIN);
    return handle(new Request(String(url), { method: init?.method ?? 'GET', headers, body: init?.body }), env);
  }) as unknown as typeof fetch;
  return { f, env, calls };
}

const opts = (f: typeof fetch, over: Record<string, unknown> = {}) => ({ fetchImpl: f, baseUrl: 'https://api.example', publicKeyHex, enabled: true, ...over });

describe('gating and device keys', () => {
  it('is on only when the build enables it and the player opted in', () => {
    expect(verifiedDaresEnabled(true)).toBe(true);
    expect(verifiedDaresEnabled(false)).toBe(false);
    expect(verifiedDaresEnabled(true, { enabled: false })).toBe(false);
  });

  it('derives one key per device per dare from the install id, unlinkable across dares', async () => {
    const k = await liteDeviceKey(INSTALL, dare);
    expect(k).toBe(await sha256Hex(`${INSTALL}:${dareIdentity(dare)}`));
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(await liteDeviceKey(INSTALL, { ...dare, step: 'd1' })).not.toBe(k);
    expect(await liteDeviceKey('another-install', dare)).not.toBe(k);
    expect(await liteDeviceKey('', dare)).toBeNull();
  });

  it('makes no request at all when off or not opted in', async () => {
    const f = vi.fn() as unknown as typeof fetch;
    const input = { optedIn: false, installId: INSTALL, dare, nonce: 'abc123', answerPath: 'd0-0', claim: { points: 196, best: true, kind: 'protect' as const } };
    expect(await startVerifiedAttempt(input, opts(f))).toBeNull();
    expect(await startVerifiedAttempt({ ...input, optedIn: true }, opts(f, { enabled: false }))).toBeNull();
    expect(await gradeVerifiedAttempt({ optedIn: false, installId: INSTALL, dare, attemptId: 'a'.repeat(32), twistAnswer: 'a' }, opts(f))).toBeNull();
    expect(await fetchLiteGoal('2026-10-26', false, opts(f))).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});

describe('start and grade against the real Worker', () => {
  it('round-trips into an R2 reply whose signature the helper verifies offline', async () => {
    const { f, calls } = workerFetch();
    const s = await startVerifiedAttempt({ optedIn: true, installId: INSTALL, dare, nonce: 'Abc123', answerPath: 'd0-0', claim: { points: 196, best: true, kind: 'protect' } }, opts(f));
    expect(s).toMatchObject({ kind: 'protect', nonce: 'abc123', points: 196, best: true, verified: 'twist', created: true });
    expect(calls[0].url).toBe('https://api.example/v1/lite/attempts');
    expect(calls[0].body).toEqual({
      v: 1,
      contentVersion: liteContentVersion(),
      dare: { seed: 42, path: '', step: 'd0', deadline: DEADLINE },
      deviceKey: await liteDeviceKey(INSTALL, dare),
      nonce: 'abc123',
      answerPath: 'd0-0',
      claim: { points: 196, best: true, kind: 'protect' },
    });
    // Nothing but the protocol fields leaves the device: no install id, no chain, no hint, no sender points.
    expect(JSON.stringify(calls[0].body)).not.toContain(INSTALL);

    const twist = twistById(s!.twistId)!;
    const g = await gradeVerifiedAttempt({ optedIn: true, installId: INSTALL, dare, attemptId: s!.attemptId, twistAnswer: twist.best }, opts(f));
    expect(g).toMatchObject({ twist: 'right', twistId: s!.twistId, points: 196, best: true, nonce: 'abc123', verified: 'twist' });

    const reply: DareReply = { dare, points: g!.points, best: g!.best, version: 2, twistId: g!.twistId, twist: g!.twist, nonce: g!.nonce, rematchDeadline: DEADLINE + 86400, sig: g!.sig };
    const decoded = decodeDareReply(encodeDareReply(reply))!;
    expect(decoded.sig).toBe(g!.sig);
    expect(await verifyReplySignature(decoded, publicKeyHex)).toBe(true);
    expect(await replyVerification(decoded, publicKeyHex)).toBe('twist');
    expect(await replyVerifiedScope(decoded, publicKeyHex)).toBe('twist');
    // A valid 't' signature proves the twist only: it never counts as a verified award.
    expect(await replyCountsAsVerified(decoded, publicKeyHex)).toBe(false);

    // Helper-side tampering is caught offline.
    expect(await verifyReplySignature({ ...decoded, points: decoded.points + 50 }, publicKeyHex)).toBe(false);
    expect(await verifyReplySignature({ ...decoded, twist: 'wrong' }, publicKeyHex)).toBe(false);
    expect(await verifyReplySignature({ ...decoded, nonce: 'zzzzzz' }, publicKeyHex)).toBe(false);
    expect(await verifyReplySignature({ ...decoded, dare: { ...decoded.dare, seed: 43 } }, publicKeyHex)).toBe(false);
    expect(await verifyReplySignature({ ...decoded, sig: `v${decoded.sig!.slice(1)}` }, publicKeyHex)).toBe(false);
    // Chain and hint are not covered: passing a dare on does not invalidate the friend's reply.
    expect(await verifyReplySignature({ ...decoded, dare: { ...decoded.dare, chain: 5, hint: 1 } }, publicKeyHex)).toBe(true);
    // No key, a malformed key, a foreign key, no signature, or an R1 reply: never verified.
    expect(await verifyReplySignature(decoded, '')).toBe(false);
    expect(await verifyReplySignature(decoded, '04abcd')).toBe(false);
    const stranger = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    expect(await verifyReplySignature(decoded, bytesToHex(new Uint8Array(await crypto.subtle.exportKey('raw', stranger.publicKey))))).toBe(false);
    expect(await verifyReplySignature({ ...decoded, sig: undefined }, publicKeyHex)).toBe(false);
    expect(await verifyReplySignature({ dare, points: 196, best: true, version: 1 }, publicKeyHex)).toBe(false);
  });

  it('the replaying Worker signs dare+twist and returns the stored result on a repeated grade', async () => {
    const { f } = workerFetch({ LITE_VERIFY_REPLAY: '1' });
    const s = await startVerifiedAttempt({ optedIn: true, installId: INSTALL, dare, nonce: 'abc123', answerPath: 'd0-0', claim: { points: 1, best: false, kind: 'wait' } }, opts(f));
    expect(s?.verified).toBe('dare+twist');
    expect(s?.points).not.toBe(1); // the server's replay, not the claim
    const g1 = await gradeVerifiedAttempt({ optedIn: true, installId: INSTALL, dare, attemptId: s!.attemptId, twistAnswer: null }, opts(f));
    const g2 = await gradeVerifiedAttempt({ optedIn: true, installId: INSTALL, dare, attemptId: s!.attemptId, twistAnswer: 'a' }, opts(f));
    expect(g1).toMatchObject({ twist: 'skipped', verified: 'dare+twist', graded: true });
    expect(g2).toMatchObject({ twist: 'skipped', sig: g1!.sig, graded: false });
    const reply: DareReply = { dare, points: g1!.points, best: g1!.best, version: 2, twist: 'skipped', nonce: g1!.nonce, rematchDeadline: DEADLINE, sig: g1!.sig };
    const signed = decodeDareReply(encodeDareReply(reply))!;
    expect(await replyVerification(signed, publicKeyHex)).toBe('dare+twist');
    expect(await replyVerifiedScope(signed, publicKeyHex)).toBe('dare+twist');
    expect(await replyCountsAsVerified(signed, publicKeyHex)).toBe(true);
    // Tampered or unsigned: not verified, whatever the scope letter says.
    expect(await replyCountsAsVerified({ ...signed, points: signed.points + 1 }, publicKeyHex)).toBe(false);
    expect(await replyCountsAsVerified({ ...signed, sig: undefined }, publicKeyHex)).toBe(false);
  });

  it('drops a server answer whose signature does not match the build key (misconfigured keys stay local)', async () => {
    const { f } = workerFetch();
    const s = await startVerifiedAttempt({ optedIn: true, installId: INSTALL, dare, nonce: 'abc123', answerPath: 'd0-0', claim: { points: 196, best: true, kind: 'protect' } }, opts(f));
    const other = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const otherHex = bytesToHex(new Uint8Array(await crypto.subtle.exportKey('raw', other.publicKey)));
    expect(await gradeVerifiedAttempt({ optedIn: true, installId: INSTALL, dare, attemptId: s!.attemptId, twistAnswer: 'a' }, opts(f, { publicKeyHex: otherHex }))).toBeNull();
  });

  it('falls back to null when the Worker fails closed', async () => {
    const { f } = workerFetch({ DARE_SIGNING_KEY: undefined });
    expect(await startVerifiedAttempt({ optedIn: true, installId: INSTALL, dare, nonce: 'abc123', answerPath: 'd0-0', claim: { points: 196, best: true, kind: 'protect' } }, opts(f))).toBeNull();
  });
});

describe('failures never throw and never wait long', () => {
  const input = { optedIn: true, installId: INSTALL, dare, nonce: 'abc123', answerPath: 'd0-0', claim: { points: 196, best: true, kind: 'protect' as const } };

  it('returns null on network errors, bad statuses and malformed bodies', async () => {
    const reject = vi.fn(async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    expect(await startVerifiedAttempt(input, opts(reject))).toBeNull();
    const status = vi.fn(async () => new Response('{}', { status: 500 })) as unknown as typeof fetch;
    expect(await startVerifiedAttempt(input, opts(status))).toBeNull();
    const junk = vi.fn(async () => new Response(JSON.stringify({ attemptId: 'x', twistId: 't1' }), { status: 200 })) as unknown as typeof fetch;
    expect(await startVerifiedAttempt(input, opts(junk))).toBeNull();
    const notJson = vi.fn(async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    expect(await startVerifiedAttempt(input, opts(notJson))).toBeNull();
    expect(await gradeVerifiedAttempt({ optedIn: true, installId: INSTALL, dare, attemptId: 'not-hex', twistAnswer: 'a' }, opts(junk))).toBeNull();
    expect(await fetchLiteGoal('2026-10-26', true, opts(status))).toBeNull();
    expect(await fetchLiteGoal('26-10-2026', true, opts(status))).toBeNull();
  });

  it('gives up after the timeout even if the request never answers', async () => {
    expect(LITE_DARE_TIMEOUT_MS).toBeLessThanOrEqual(3000);
    const hang = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const t = Date.now();
    expect(await startVerifiedAttempt(input, opts(hang, { timeoutMs: 40 }))).toBeNull();
    expect(Date.now() - t).toBeLessThan(1500);
  });
});

describe('goal', () => {
  it('reads real numbers, caches them briefly, and the component shows them only when ready', async () => {
    const day = utcDay();
    const answer = { day, active: true, answers: 40, minCohort: 25, ready: true, best: 25, share: 62.5, asOf: new Date().toISOString() };
    const f = vi.fn(async () => new Response(JSON.stringify(answer), { status: 200 })) as unknown as typeof fetch;
    expect(await fetchLiteGoal(day, true, opts(f))).toEqual(answer);
    expect(await fetchLiteGoal(day, true, opts(f))).toEqual(answer);
    expect(f).toHaveBeenCalledTimes(1);

    __resetLiteDaresForTests();
    vi.stubGlobal('fetch', f);
    render(createElement(LiteGoal, { optedIn: true }));
    expect(await screen.findByTestId('lite-goal')).toBeTruthy();
    expect(screen.getByTestId('lite-goal').textContent).toBe('Today 63% of dare answers found the best move');
  });

  it('renders nothing below the cohort, when not opted in, or when the read fails', async () => {
    const day = utcDay();
    const notReady = vi.fn(async () => new Response(JSON.stringify({ day, active: true, answers: 3, minCohort: 25, ready: false, asOf: 'x' }), { status: 200 })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', notReady);
    const { container, rerender } = render(createElement(LiteGoal, { optedIn: true }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.innerHTML).toBe('');
    __resetLiteDaresForTests();
    const spy = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', spy);
    rerender(createElement(LiteGoal, { optedIn: false }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.innerHTML).toBe('');
    expect(spy).not.toHaveBeenCalled();
    __resetLiteDaresForTests();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    rerender(createElement(LiteGoal, { optedIn: true, day: '2026-10-25' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.innerHTML).toBe('');
  });
});

describe('key script', () => {
  it('prints a working pair and the install commands, and writes nothing', async () => {
    const { execFileSync } = await import('node:child_process');
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('scripts/lite-dare-keys.mjs', 'utf8');
    expect(source).not.toMatch(/from 'node:fs'|from 'fs'|writeFile|appendFile|mkdir/);
    const out = execFileSync(process.execPath, ['scripts/lite-dare-keys.mjs'], { encoding: 'utf8' });
    expect(out).toContain('npx wrangler secret put DARE_SIGNING_KEY');
    expect(out).toContain('VITE_LITE_VERIFIED_DARES=1');
    const pub = /VITE_DARE_PUBLIC_KEY=(04[0-9a-f]{128})/.exec(out)?.[1];
    const jwkLine = out.split('\n').find((l: string) => l.startsWith('{"kty":"EC"'));
    expect(pub).toBeTruthy();
    expect(jwkLine).toBeTruthy();
    __resetSigningKeyForTests();
    const key = await signingKey(jwkLine);
    expect(key!.keyId).toBe(await darePublicKeyId(pub!));
    const sig = await signHex(key!.key, 'probe');
    const verifyKey = await crypto.subtle.importKey('raw', hexToBytes(pub!)!, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, hexToBytes(sig)!, new TextEncoder().encode('probe'))).toBe(true);
  });
});

describe('key rotation, issue days and content versions', () => {
  async function pair() {
    const k = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    return { k, hex: bytesToHex(new Uint8Array(await crypto.subtle.exportKey('raw', k.publicKey))) };
  }
  async function signedReply(signer: { k: CryptoKeyPair; hex: string }, issueDay: string, marker: 'v' | 't' = 'v'): Promise<DareReply> {
    const fields = { dare, points: 196, best: true, twistId: 't3', twist: 'right' as const, nonce: 'abc123' };
    const header = { marker, keyId: await darePublicKeyId(signer.hex), issueDay };
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signer.k.privateKey, new TextEncoder().encode(liteDareCanonical(fields, header)));
    return { ...fields, version: 2, rematchDeadline: DEADLINE + 86400, sig: signatureField(header, bytesToHex(new Uint8Array(sig))) };
  }

  it('accepts any configured key by its id, so replies signed before a rotation keep verifying', async () => {
    const oldKey = await pair();
    const newKey = await pair();
    const today = issueDayOf(new Date());
    const fromOld = await signedReply(oldKey, today);
    const fromNew = await signedReply(newKey, today);
    const decodedOld = decodeDareReply(encodeDareReply(fromOld))!;
    expect(decodedOld.sig).toMatch(/^v[0-9a-f]{8}[0-9a-z]{4}[0-9a-f]{128}$/);
    expect(await replyCountsAsVerified(decodedOld, [newKey.hex, oldKey.hex])).toBe(true);
    expect(await replyCountsAsVerified(decodeDareReply(encodeDareReply(fromNew))!, [newKey.hex, oldKey.hex])).toBe(true);
    // Once the old key is removed from the build, its replies count as local ones.
    expect(await replyCountsAsVerified(decodedOld, [newKey.hex])).toBe(false);
    // A key id that matches no configured key is never tried against another key.
    const relabelled = { ...decodedOld, sig: `v${(await darePublicKeyId(newKey.hex))}${decodedOld.sig!.slice(9)}` };
    expect(await replyCountsAsVerified(relabelled, [newKey.hex, oldKey.hex])).toBe(false);
  });

  it('refuses signatures dated in the future, and accepts older ones', async () => {
    const k = await pair();
    const day = Math.floor(Date.now() / 86_400_000);
    const ahead = await signedReply(k, (day + 3).toString(36).padStart(4, '0'));
    const tomorrow = await signedReply(k, (day + 1).toString(36).padStart(4, '0'));
    const lastMonth = await signedReply(k, (day - 30).toString(36).padStart(4, '0'));
    expect(await verifyReplySignature(decodeDareReply(encodeDareReply(ahead))!, [k.hex])).toBe(false);
    expect(await verifyReplySignature(decodeDareReply(encodeDareReply(tomorrow))!, [k.hex])).toBe(true); // clock skew
    expect(await verifyReplySignature(decodeDareReply(encodeDareReply(lastMonth))!, [k.hex])).toBe(true);
    expect(await replyVerifiedScope(decodeDareReply(encodeDareReply(await signedReply(k, issueDayOf(new Date()), 't')))!, [k.hex])).toBe('twist');
  });

  it('falls back to local play when the Worker runs different content (409)', async () => {
    const mismatch = vi.fn(async () => new Response(JSON.stringify({ error: 'content version mismatch' }), { status: 409 })) as unknown as typeof fetch;
    expect(await startVerifiedAttempt({ optedIn: true, installId: INSTALL, dare, nonce: 'abc123', answerPath: 'd0-0', claim: { points: 196, best: true, kind: 'protect' } }, opts(mismatch))).toBeNull();
    expect(liteContentVersion()).toBe(liteContentVersion());
  });

  it('stops asking for the goal once the server says it is off for the day', async () => {
    const day = utcDay();
    const off = vi.fn(async () => new Response(JSON.stringify({ day, active: false, answers: 0, minCohort: 25, ready: false, asOf: 'x' }), { status: 200 })) as unknown as typeof fetch;
    expect(await fetchLiteGoal(day, true, opts(off))).toBeNull();
    expect(localStorage.getItem(LITE_GOAL_OFF_KEY)).toBe(day);
    expect(await fetchLiteGoal(day, true, opts(off))).toBeNull();
    expect(off).toHaveBeenCalledTimes(1);
    // A new day asks again.
    expect(await fetchLiteGoal('2099-01-01', true, opts(off))).toBeNull();
    expect(off).toHaveBeenCalledTimes(2);
    // The real Worker says "off" on the free-plan default.
    const { f } = workerFetch();
    __resetLiteDaresForTests();
    expect(await fetchLiteGoal(day, true, opts(f))).toBeNull();
    expect(localStorage.getItem(LITE_GOAL_OFF_KEY)).toBe(day);
  });
});
