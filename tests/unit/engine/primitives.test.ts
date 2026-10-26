// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { canonicalJson, canonicalPlan, commitHash, normalizePlan, sha256HexAsync } from '@/engine/canonical';
import { createRng, hashString, rngFloat, rngFromKey, Sfc32 } from '@/engine/prng';
import { sha256Hex, utf8 } from '@/engine/sha256';
import { randomPlan } from './helpers';

describe('sha256 (frozen primitive)', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });

  it('agrees with WebCrypto for ASCII, Devanagari and emoji input of many lengths', async () => {
    for (const s of ['', 'x', 'वंदे क्रिकेट', '🏏 six!', 'a'.repeat(55), 'b'.repeat(56), 'c'.repeat(64), 'd'.repeat(119)]) {
      const bytes = new TextEncoder().encode(s);
      expect(Array.from(utf8(s))).toEqual(Array.from(bytes));
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
      expect(sha256Hex(s)).toBe(hex);
      expect(await sha256HexAsync(s)).toBe(hex);
    }
  });
});

describe('sfc32 generator (frozen primitive)', () => {
  it('is deterministic and serialisable (functional API)', () => {
    const a = createRng(hashString('seed'));
    const b = createRng(hashString('seed'));
    expect(rngFloat(a)).toEqual(rngFloat(b));
    const one = rngFloat(a);
    expect(one.value).toBeGreaterThanOrEqual(0);
    expect(one.value).toBeLessThan(1);
  });

  it('pins the first outputs for a fixed key (any change breaks old replays)', () => {
    const r = rngFromKey('vande/v1/ball|00000000000000000000000000000000|0|0');
    const first = [r.nextU32(), r.nextU32(), r.nextU32()];
    const again = rngFromKey('vande/v1/ball|00000000000000000000000000000000|0|0');
    expect([again.nextU32(), again.nextU32(), again.nextU32()]).toEqual(first);
    expect(first).toEqual([3826982840, 1135015630, 3103856623]);
  });

  it('gives different streams for different keys and sane statistics', () => {
    const a = rngFromKey('k1');
    const b = rngFromKey('k2');
    expect(a.nextU32()).not.toBe(b.nextU32());
    const r = new Sfc32(1, 2, 3, 4);
    let sum = 0;
    let sumSq = 0;
    let lo = 1;
    let hi = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const x = r.float();
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
      const z = r.normal();
      sum += z;
      sumSq += z * z;
    }
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThan(1);
    expect(Math.abs(sum / n)).toBeLessThan(0.05);
    expect(Math.abs(sumSq / n - 1)).toBeLessThan(0.05);
    for (let i = 0; i < 100; i++) {
      const k = r.int(2, 5);
      expect(k).toBeGreaterThanOrEqual(2);
      expect(k).toBeLessThanOrEqual(5);
    }
  });
});

describe('canonical JSON and commit hashes', () => {
  it('sorts keys, drops undefined and has no whitespace', () => {
    expect(canonicalJson({ b: 1, a: [1, 'x', { d: null, c: true }], u: undefined })).toBe('{"a":[1,"x",{"c":true,"d":null}],"b":1}');
    expect(() => canonicalJson({ x: Number.NaN })).toThrow();
  });

  it('hashes only the known plan fields, independent of key order', async () => {
    const plan = randomPlan(rngFromKey('canon'));
    const shuffled = JSON.parse(JSON.stringify({ superBall: plan.superBall, balls: plan.balls, field: plan.field, v: plan.v, extra: 'ignored' }));
    expect(canonicalPlan(shuffled)).toBe(canonicalPlan(plan));
    expect(normalizePlan(shuffled)).toEqual(plan);
    const h = await commitHash(plan, 'pepper');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(sha256Hex(canonicalPlan(plan) + 'pepper'));
    expect(await commitHash(plan, 'other salt')).not.toBe(h);
  });
});
