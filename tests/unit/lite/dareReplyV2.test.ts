import { describe, expect, it } from 'vitest';
import { hashString } from '@/engine/prng';
import { dareReplyText, dareReplyUrl, decodeDare, decodeDareReply, encodeDare, encodeDareReply, twistNumberOf, type Dare, type DareReply } from '@/share/dare';

const DEADLINE = Math.floor(new Date(2026, 9, 25, 0, 0, 0).getTime() / 1000);
const REMATCH = Math.floor(new Date(2026, 9, 26, 0, 0, 0).getTime() / 1000);
const base: Dare = { seed: 123456789, path: 'd0-1.e0.d1-0.r0-2', step: 'd2', points: 196, best: true, deadline: DEADLINE, chain: 3 };
const right: DareReply = { dare: base, points: 392, best: true, version: 2, twistId: 't7', twist: 'right', nonce: 'a1b2c3', rematchDeadline: REMATCH };

const R2_SHAPE = /^R2_[0-9a-z]{1,7}_(~|[a-z0-9.-]+)_[dr]\d{1,2}_[0-9a-z]{1,7}_[01]_[0-9a-z]{1,7}_[0-9a-z]{1,7}(_h\d)?_[0-9a-z]{1,7}_[01]_(~|[0-9a-z]{1,2})_[rws]_[0-9a-z]{6}_[0-9a-z]{1,7}_[0-9a-z]{2}(_x[0-9a-z]{16,256})?$/;

/** An R2 code with a valid checksum for arbitrary parts, to test field validation in isolation. */
function craftR2(parts: string[]): string {
  const body = ['R2', ...parts].join('_');
  return `${body}_${(hashString(body) % 1296).toString(36).padStart(2, '0')}`;
}

const seed36 = (123456789).toString(36);
const dareParts = [seed36, 'd0-1.e0.d1-0.r0-2', 'd2', (196).toString(36), '1', DEADLINE.toString(36), '3'];
const r36 = REMATCH.toString(36);

describe('R2 reply codes', () => {
  it('round-trips right, wrong and skipped twists, hints, empty paths and edge values', () => {
    const cases: DareReply[] = [
      right,
      { ...right, twist: 'wrong', best: false, points: 10 },
      { dare: { ...base, hint: 2 }, points: 0, best: false, version: 2, twist: 'skipped', nonce: '000000', rematchDeadline: REMATCH },
      { dare: { ...base, path: '', step: 'r0', chain: 99 }, points: 9999, best: true, version: 2, twistId: 't1', twist: 'right', nonce: 'zzzzzz', rematchDeadline: REMATCH },
      { ...right, twistId: 't1295', twist: 'wrong' },
    ];
    for (const r of cases) {
      const code = encodeDareReply(r);
      expect(code).toMatch(R2_SHAPE);
      expect(decodeDareReply(code)).toEqual(r);
    }
    expect(encodeDareReply({ ...right, twistId: 't1295' })).toContain('_zz_r_');
    expect(encodeDareReply({ ...right, twistId: 't1' })).toContain('_1_r_');
  });

  it('writes ~ and s for a skipped twist and drops any twist id on the way', () => {
    const code = encodeDareReply({ ...right, twist: 'skipped' });
    expect(code).toContain('_~_s_a1b2c3_');
    const back = decodeDareReply(code)!;
    expect(back.twist).toBe('skipped');
    expect('twistId' in back).toBe(false);
    // No outcome and no twist id means skipped.
    expect(decodeDareReply(encodeDareReply({ dare: base, points: 5, best: false, nonce: 'abcdef', rematchDeadline: REMATCH }))!.twist).toBe('skipped');
  });

  it('keeps identical answers apart by their nonce, and the same attempt identical', () => {
    const a = encodeDareReply({ ...right, nonce: 'aaaaaa' });
    const b = encodeDareReply({ ...right, nonce: 'bbbbbb' });
    expect(a).not.toBe(b);
    expect(encodeDareReply({ ...right, nonce: 'aaaaaa' })).toBe(a);
    // The same answers without a nonce collide in R1, which is why R2 exists.
    expect(encodeDareReply({ dare: base, points: 392, best: true })).toBe(encodeDareReply({ dare: base, points: 392, best: true }));
  });

  it('decodes case-insensitively and from full links', () => {
    const code = encodeDareReply(right);
    expect(decodeDareReply(code.toLowerCase())).toEqual(right);
    expect(decodeDareReply(code.toUpperCase())).toEqual(right);
    expect(decodeDareReply(` ${code}\n`)).toEqual(right);
    expect(decodeDareReply(dareReplyUrl(code, 'https://vande.example'))).toEqual(right);
    expect(decodeDareReply(`https://paulhironmoy.github.io/Vande/lite/reply/${encodeURIComponent(code)}?a=1#b`)).toEqual(right);
    expect(decodeDareReply(`https://vande.example/lite/dare/${code}`)).toBeNull();
  });

  it('rejects every single-character tamper of the checked part and never cross-decodes', () => {
    const code = encodeDareReply(right);
    for (let i = 3; i < code.length; i++) {
      const ch = code[i];
      if (ch === '_') continue;
      const replacement = ch === '.' ? '-' : ch === '-' ? '.' : ch === '~' ? '1' : ch === '9' ? '8' : ch === 'z' ? 'y' : /[0-8]/.test(ch) ? String(Number(ch) + 1) : String.fromCharCode(ch.charCodeAt(0) + 1);
      const tampered = code.slice(0, i) + replacement + code.slice(i + 1);
      expect(decodeDareReply(tampered), `position ${i}: ${tampered}`).toBeNull();
    }
    expect(decodeDare(code)).toBeNull();
    expect(decodeDareReply(encodeDare(base))).toBeNull();
    expect(decodeDareReply('R2_nonsense')).toBeNull();
    expect(decodeDareReply(code.replace(/^R2_/, 'R1_'))).toBeNull();
    expect(decodeDareReply(code.replace(/^R2_/, 'R3_'))).toBeNull();
  });

  it('rejects malformed fields even with a valid checksum', () => {
    const ok = craftR2([...dareParts, 'aw', '1', '7', 'r', 'a1b2c3', r36]);
    expect(decodeDareReply(ok)).toEqual(right);
    expect(decodeDareReply(craftR2([...dareParts, 'aw', '1', '~', 'r', 'a1b2c3', r36]))).toBeNull(); // right needs a twist
    expect(decodeDareReply(craftR2([...dareParts, 'aw', '1', '7', 's', 'a1b2c3', r36]))).toBeNull(); // skipped names no twist
    expect(decodeDareReply(craftR2([...dareParts, 'aw', '1', '0', 'r', 'a1b2c3', r36]))).toBeNull(); // twist 0
    expect(decodeDareReply(craftR2([...dareParts, 'aw', '1', '07', 'r', 'a1b2c3', r36]))).toBeNull(); // padded twist
    expect(decodeDareReply(craftR2([...dareParts, 'aw', '1', '7', 'x', 'a1b2c3', r36]))).toBeNull(); // bad outcome
    expect(decodeDareReply(craftR2([...dareParts, 'aw', '1', '7', 'r', 'a1b2c', r36]))).toBeNull(); // short nonce
    expect(decodeDareReply(craftR2([...dareParts, 'aw', '1', '7', 'r', 'a1b2c3d', r36]))).toBeNull(); // long nonce
    expect(decodeDareReply(craftR2([...dareParts, 'aw', '1', '7', 'r', 'a1b2c3', '1']))).toBeNull(); // rematch in the past
    expect(decodeDareReply(craftR2([...dareParts, '7pt', '1', '7', 'r', 'a1b2c3', r36]))).toBeNull(); // points 10,000
    expect(decodeDareReply(craftR2([...dareParts, '0aw', '1', '7', 'r', 'a1b2c3', r36]))).toBeNull(); // padded points
    expect(decodeDareReply(craftR2([...dareParts, 'aw', '2', '7', 'r', 'a1b2c3', r36]))).toBeNull(); // best must be 0/1
    expect(decodeDareReply(craftR2([...dareParts, 'aw', '1', '7', 'r', 'a1b2c3', r36, 'q']))).toBeNull(); // extra field
    expect(decodeDareReply(craftR2([seed36, 'd1-2..e3', 'd2', '5g', '1', DEADLINE.toString(36), '3', 'aw', '1', '7', 'r', 'a1b2c3', r36]))).toBeNull(); // bad path
  });

  it('refuses to encode malformed R2 fields', () => {
    expect(() => encodeDareReply({ ...right, nonce: 'abc' })).toThrow(RangeError);
    expect(() => encodeDareReply({ ...right, nonce: 'ab-def' })).toThrow(RangeError);
    expect(() => encodeDareReply({ ...right, rematchDeadline: undefined })).toThrow(RangeError);
    expect(() => encodeDareReply({ ...right, rematchDeadline: 12 })).toThrow(RangeError);
    expect(() => encodeDareReply({ ...right, rematchDeadline: Number.NaN })).toThrow(RangeError);
    expect(() => encodeDareReply({ ...right, twistId: undefined })).toThrow(RangeError);
    expect(() => encodeDareReply({ ...right, twistId: 't0' })).toThrow(RangeError);
    expect(() => encodeDareReply({ ...right, twistId: 't1296' })).toThrow(RangeError);
    expect(() => encodeDareReply({ ...right, twistId: 'x7' })).toThrow(RangeError);
    expect(() => encodeDareReply({ ...right, twist: 'maybe' as unknown as 'right' })).toThrow(RangeError);
    expect(() => encodeDareReply({ ...right, twist: undefined })).toThrow(RangeError); // a twist id needs an outcome
    expect(() => encodeDareReply({ ...right, sig: 'short' })).toThrow(RangeError);
    expect(() => encodeDareReply({ ...right, sig: 'not hex!'.repeat(4) })).toThrow(RangeError);
    // Upper-case nonces are normalised.
    expect(decodeDareReply(encodeDareReply({ ...right, nonce: 'A1B2C3' }))!.nonce).toBe('a1b2c3');
  });

  it('reserves a trailing signature field outside the checksum for verified dares', () => {
    const sig = 'ab'.repeat(64);
    const code = encodeDareReply({ ...right, sig });
    expect(code.endsWith(`_x${sig}`)).toBe(true);
    expect(code).toMatch(R2_SHAPE);
    expect(decodeDareReply(code)).toEqual({ ...right, sig });
    // The checksum does not cover the signature: a changed signature still decodes (verification is wave 2).
    expect(decodeDareReply(code.replace(/_x[0-9a-z]+$/, `_x${'cd'.repeat(64)}`))!.sig).toBe('cd'.repeat(64));
    // Too short or not in the lowercase alphabet: rejected.
    expect(decodeDareReply(`${encodeDareReply(right)}_xabc`)).toBeNull();
    expect(decodeDareReply(`${encodeDareReply(right)}_x${'z'.repeat(257)}`)).toBeNull();
    expect(decodeDareReply(`${encodeDareReply(right)}_y${'a'.repeat(32)}`)).toBeNull();
  });

  it('still reads R1 codes as version 1 and keeps writing R1 without a nonce', () => {
    const r1: DareReply = { dare: base, points: 392, best: true };
    const code = encodeDareReply(r1);
    expect(code).toMatch(/^R1_/);
    expect(decodeDareReply(code)).toEqual({ ...r1, version: 1 });
    const hint = encodeDareReply({ dare: { ...base, hint: 1 }, points: 0, best: false });
    expect(decodeDareReply(hint)).toEqual({ dare: { ...base, hint: 1 }, points: 0, best: false, version: 1 });
  });

  it('parses twist ids', () => {
    expect(twistNumberOf('t1')).toBe(1);
    expect(twistNumberOf('t1295')).toBe(1295);
    for (const bad of ['t0', 't1296', 't01', 'T5', 'x5', '', undefined]) expect(twistNumberOf(bad)).toBeNull();
  });
});

describe('reply text with a twist', () => {
  const t = (best: boolean, twist?: 'right' | 'wrong' | 'skipped') => dareReplyText({ points: 196, best, senderPoints: 164, moveNumber: 2, twist });

  it('names the twist and invites the rematch only when a twist was taken', () => {
    expect(t(true, 'right')).toBe('I took your dare on move 2: +196 vs your +164. I found the best move. I took a twist too. Your turn: try my twist before midnight.');
    expect(t(false, 'right')).toBe('I took your dare on move 2: +196 vs your +164. I took a twist too. Your turn: try my twist before midnight.');
    expect(t(true, 'wrong')).toBe('I took your dare on move 2: +196 vs your +164. I found the best move. I took a twist too. Your turn: try my twist before midnight.');
    expect(t(false, 'wrong')).toBe('I took your dare on move 2: +196 vs your +164. I took a twist too. Your turn: try my twist before midnight.');
    // The outcome never appears: right and wrong read the same until the rematch is answered.
    expect(t(true, 'right')).toBe(t(true, 'wrong'));
    expect(t(true, 'skipped')).toBe('I took your dare on move 2: +196 vs your +164. I found the best move.');
    expect(t(false, 'skipped')).toBe('I took your dare on move 2: +196 vs your +164.');
    expect(t(true)).toBe(t(true, 'skipped'));
    for (const s of [t(true, 'right'), t(false, 'wrong')]) expect(s).not.toMatch(/https?:|wrong|fail|bad/i);
  });
});
