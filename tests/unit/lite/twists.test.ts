import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/content/lite/twists.json', () => {
  const opts = (a: string[], b: string[], c: string[], d?: string[]) => [
    { id: 'a', title: 'Option A', tags: a },
    { id: 'b', title: 'Option B', tags: b },
    { id: 'c', title: 'Option C', tags: c },
    ...(d ? [{ id: 'd', title: 'Option D', tags: d }] : []),
  ];
  return {
    default: {
      version: 1,
      twists: [
        { id: 't1', kind: 'check', title: 'One', situation: 'S1', options: opts(['investigative'], ['wait'], ['suppressive'], ['dialogue']), best: 'a', why: 'Why one.' },
        { id: 't2', kind: 'check', title: 'Two', situation: 'S2', options: opts(['wait'], ['investigative'], ['dialogue']), best: 'b', why: 'Why two.' },
        { id: 't3', kind: 'protect', title: 'Three', situation: 'S3', options: opts(['service'], ['wait'], ['suppressive']), best: 'a', why: 'Why three.' },
        { id: 't4', kind: 'rule', title: 'Four', situation: 'S4', options: [{ id: 'a', title: 'Fair' }, { id: 'b', title: 'Unfair' }, { id: 'c', title: 'Also unfair' }], best: 'a', why: 'Why four.' },
        { id: 't5', kind: 'check', title: 'Five', situation: 'S5', options: opts(['investigative'], ['wait'], ['dialogue']), best: 'a', why: 'Retired.', retired: true },
      ],
    },
  };
});

import {
  __resetTwistStoreForTests,
  answerRematch,
  answerTwist,
  dareIdentity,
  dareKeyOf,
  drawTwist,
  ensureAttempt,
  ensureRematch,
  liveTwists,
  markTwistSeen,
  newNonce,
  outcomeOf,
  pickTwist,
  readAttempt,
  readRematch,
  secureRandom,
  seenTwists,
  shuffle,
  twistById,
} from '@/lite/twists';
import type { Dare } from '@/share/dare';

const DEADLINE = Math.floor(new Date(2026, 9, 25).getTime() / 1000);
const dare: Dare = { seed: 42, path: 'd0-1.e2', step: 'd1', points: 196, best: true, deadline: DEADLINE, chain: 1 };
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

beforeEach(() => {
  localStorage.clear();
  __resetTwistStoreForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  __resetTwistStoreForTests();
});

describe('dare identity', () => {
  it('uses seed, path, step and deadline only, and gives a letter-prefixed short key', () => {
    expect(dareIdentity(dare)).toBe(`${(42).toString(36)}:d0-1.e2:d1:${DEADLINE.toString(36)}`);
    expect(dareIdentity({ ...dare, path: '' })).toContain(':~:');
    const k = dareKeyOf(dare);
    expect(k).toMatch(/^k[0-9a-z]+$/);
    expect(dareKeyOf({ ...dare, chain: 9, hint: 2 } as Dare)).toBe(k);
    expect(dareKeyOf({ ...dare, deadline: DEADLINE + 86400 })).not.toBe(k);
    expect(dareKeyOf({ ...dare, step: 'd2' })).not.toBe(k);
  });
});

describe('drawing a twist', () => {
  it('matches the kind, never draws retired twists, and falls back to any kind only when none exists', () => {
    expect(liveTwists().map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4']);
    for (const r of [0, 0.3, 0.6, 0.99]) expect(['t1', 't2']).toContain(pickTwist('check', [], () => r)!.id);
    expect(pickTwist('protect', [], () => 0.9)!.id).toBe('t3');
    expect(pickTwist('rule', [], () => 0.5)!.id).toBe('t4');
    // No 'enforce' twist exists: any live kind.
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(pickTwist('enforce', [], () => i / 40)!.id);
    expect([...seen].sort()).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('prefers twists this device has not seen, but stays on the same idea when all of them were seen', () => {
    for (const r of [0, 0.5, 0.99]) expect(pickTwist('check', ['t1'], () => r)!.id).toBe('t2');
    for (const r of [0, 0.99]) expect(['t1', 't2']).toContain(pickTwist('check', ['t1', 't2'], () => r)!.id);
    expect(pickTwist('enforce', ['t1', 't2', 't3'], () => 0)!.id).toBe('t4');
  });

  it('draws once per dare, persists across reloads and marks the twist as seen', () => {
    expect(readAttempt(dareKeyOf(dare))).toBeUndefined();
    const a = drawTwist(dareKeyOf(dare), 'check')!;
    expect(['t1', 't2']).toContain(a.twistId);
    expect([...a.order!].sort()).toEqual(twistById(a.twistId!)!.options.map((o) => o.id).sort());
    expect(a.nonce).toMatch(/^[0-9a-z]{6}$/);
    expect(seenTwists()).toContain(a.twistId);
    // Same twist, same order and nonce later, even if asked for another kind, and after a reload.
    expect(drawTwist(dareKeyOf(dare), 'protect')).toEqual(a);
    __resetTwistStoreForTests();
    expect(readAttempt(dareKeyOf(dare))).toEqual(a);
    expect(drawTwist(dareKeyOf(dare), 'rule')).toEqual(a);
  });

  it('keeps the nonce made when the friend first answered the dare, before any twist', () => {
    const key = dareKeyOf({ ...dare, seed: 7 });
    const first = ensureAttempt(key);
    expect(first.twistId).toBeUndefined();
    expect(ensureAttempt(key)).toEqual(first);
    expect(outcomeOf(first)).toBe('skipped');
    const drawn = drawTwist(key, 'protect')!;
    expect(drawn.nonce).toBe(first.nonce);
    expect(drawn.twistId).toBe('t3');
    // Another dare gets another nonce.
    expect(ensureAttempt(dareKeyOf({ ...dare, seed: 8 })).nonce).not.toBe(first.nonce);
  });

  it('records only the first answer and ignores unknown options', () => {
    const key = dareKeyOf(dare);
    expect(answerTwist(key, 'a')).toBeUndefined(); // no attempt yet
    ensureAttempt(key);
    expect(answerTwist(key, 'a')).toBeUndefined(); // no twist drawn yet
    const a = drawTwist(key, 'protect')!;
    expect(answerTwist(key, 'zz')).toEqual(a);
    const right = answerTwist(key, 'a')!;
    expect(right).toMatchObject({ answer: 'a', outcome: 'right' });
    expect(outcomeOf(right)).toBe('right');
    expect(answerTwist(key, 'b')).toMatchObject({ answer: 'a', outcome: 'right' });
    __resetTwistStoreForTests();
    expect(readAttempt(key)).toMatchObject({ answer: 'a', outcome: 'right' });

    const key2 = dareKeyOf({ ...dare, seed: 99 });
    drawTwist(key2, 'protect');
    expect(answerTwist(key2, 'c')).toMatchObject({ answer: 'c', outcome: 'wrong' });
  });

  it('draws from another kind when the pool has none of the needed kind', () => {
    const key = dareKeyOf({ ...dare, seed: 1234 });
    expect(['t1', 't2', 't3', 't4']).toContain(drawTwist(key, 'wait')!.twistId);
  });

  it('returns undefined when the pool has no live twist at all, and still keeps the nonce', async () => {
    vi.resetModules();
    vi.doMock('@/content/lite/twists.json', () => ({ default: { version: 1, twists: [] } }));
    const empty = await import('@/lite/twists');
    empty.__resetTwistStoreForTests();
    expect(empty.drawTwist('kempty', 'check')).toBeUndefined();
    expect(empty.readAttempt('kempty')?.nonce).toMatch(/^[0-9a-z]{6}$/);
    vi.doUnmock('@/content/lite/twists.json');
    vi.resetModules();
  });

  it('keeps working in memory when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const key = dareKeyOf(dare);
    const a = ensureAttempt(key);
    expect(ensureAttempt(key).nonce).toBe(a.nonce);
    const d = drawTwist(key, 'check')!;
    expect(drawTwist(key, 'check')).toEqual(d);
    expect(answerTwist(key, d.order![0])!.answer).toBe(d.order![0]);
  });

  it('bounds the stored attempts and ignores corrupted storage', () => {
    for (let i = 0; i < 205; i++) ensureAttempt(`k${i}`);
    const stored = JSON.parse(localStorage.getItem('vande:lite-twists')!);
    expect(stored.attempts).toHaveLength(200);
    expect(stored.attempts[0].dareKey).toBe('k5');
    localStorage.setItem('vande:lite-twists', '{oops');
    expect(readAttempt('k5')).toBeUndefined();
    localStorage.setItem('vande:lite-twists', JSON.stringify({ attempts: [{ v: 1, dareKey: 'x', nonce: 'bad' }, { v: 1, dareKey: 'y', nonce: 'abcdef', twistId: 't1', order: ['a'], answer: 'a', outcome: 'right' }], seen: ['t1', 5] }));
    expect(readAttempt('x')).toBeUndefined();
    expect(readAttempt('y')).toMatchObject({ twistId: 't1', answer: 'a', outcome: 'right' });
    expect(seenTwists()).toEqual(['t1']);
  });
});

describe('randomness and shuffling', () => {
  it('uses crypto.getRandomValues and falls back to Math.random', () => {
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues');
    const r = secureRandom();
    expect(spy).toHaveBeenCalled();
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(1);
    spy.mockImplementation(() => {
      throw new Error('no crypto');
    });
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    expect(secureRandom()).toBe(0.25);
  });

  it('makes six-character nonces across the whole range', () => {
    expect(newNonce(() => 0)).toBe('000000');
    expect(newNonce(() => 0.9999999999)).toBe('zzzzzz');
    for (let i = 0; i < 50; i++) expect(newNonce()).toMatch(/^[0-9a-z]{6}$/);
  });

  it('shuffles into a new permutation with Fisher–Yates', () => {
    const items = ['a', 'b', 'c', 'd'];
    const out = shuffle(items, seq(0, 0, 0));
    expect(out).toEqual(['b', 'c', 'd', 'a']);
    expect(items).toEqual(['a', 'b', 'c', 'd']);
    expect(shuffle(items, () => 0.999)).toEqual(items);
    const orders = new Set<string>();
    for (let i = 0; i < 400; i++) orders.add(shuffle(items).join(''));
    expect(orders.size).toBeGreaterThan(20);
  });
});

describe('rematch records', () => {
  it('creates one shuffled record per reply, marks the twist seen and keeps the first answer', () => {
    expect(ensureRematch('k1#abcdef', 'nope')).toBeUndefined();
    const r = ensureRematch('k1#abcdef', 't2')!;
    expect([...r.order].sort()).toEqual(['a', 'b', 'c']);
    expect(seenTwists()).toContain('t2');
    expect(ensureRematch('k1#abcdef', 't2')).toEqual(r);
    expect(answerRematch('k1#abcdef', 'b')).toMatchObject({ answer: 'b', outcome: 'right' });
    expect(answerRematch('k1#abcdef', 'a')).toMatchObject({ answer: 'b', outcome: 'right' });
    __resetTwistStoreForTests();
    expect(readRematch('k1#abcdef')).toMatchObject({ answer: 'b', outcome: 'right' });
    expect(answerRematch('missing', 'a')).toBeUndefined();
  });

  it('can mark a twist as seen directly', () => {
    markTwistSeen('t3');
    markTwistSeen('t1');
    markTwistSeen('t3');
    expect(seenTwists()).toEqual(['t1', 't3']);
  });
});

describe('assignTwist (verified dares)', () => {
  it('stores a server-chosen twist once, keeps an existing draw, and ignores unknown ids', async () => {
    const { assignTwist, drawTwist, readAttempt, __resetTwistStoreForTests, TWIST_POOL } = await import('@/lite/twists');
    localStorage.clear();
    __resetTwistStoreForTests();
    const id = TWIST_POOL.twists[0].id;
    const a = assignTwist('k-server', id);
    expect(a?.twistId).toBe(id);
    expect([...(a?.order ?? [])].sort()).toEqual(TWIST_POOL.twists[0].options.map((o) => o.id).sort());
    expect(assignTwist('k-server', TWIST_POOL.twists[1].id)?.twistId).toBe(id);
    expect(readAttempt('k-server')?.twistId).toBe(id);
    const local = drawTwist('k-local', 'talk');
    expect(assignTwist('k-local', TWIST_POOL.twists[2].id)?.twistId).toBe(local?.twistId);
    expect(assignTwist('k-none', 't9999')).toBeUndefined();
  });
});

describe('replied attempts keep their nonce (review fix)', () => {
  it('marks an attempt replied once, survives a reload, and is undefined without an attempt', async () => {
    const { markReplied, ensureAttempt, readAttempt, __resetTwistStoreForTests } = await import('@/lite/twists');
    localStorage.clear();
    __resetTwistStoreForTests();
    expect(markReplied('k-none')).toBeUndefined();
    const a = ensureAttempt('k-rep');
    expect(a.replied).toBeUndefined();
    const m = markReplied('k-rep');
    expect(m?.replied).toBe(true);
    expect(m?.nonce).toBe(a.nonce);
    expect(markReplied('k-rep')?.replied).toBe(true);
    __resetTwistStoreForTests();
    expect(readAttempt('k-rep')).toMatchObject({ replied: true, nonce: a.nonce });
  });

  it('adopts the server nonce only before a reply was shared', async () => {
    const { assignTwist, ensureAttempt, markReplied, readAttempt, __resetTwistStoreForTests } = await import('@/lite/twists');
    localStorage.clear();
    __resetTwistStoreForTests();
    // Before any reply: the server's stored nonce wins (recovers an attempt after a local store loss).
    ensureAttempt('k-fresh');
    expect(assignTwist('k-fresh', 't1', 'srv001')?.nonce).toBe('srv001');
    // After a reply went out with the local nonce: the nonce never changes, the twist is still stored.
    const local = ensureAttempt('k-sent').nonce;
    markReplied('k-sent');
    const kept = assignTwist('k-sent', 't1', 'srv002');
    expect(kept?.nonce).toBe(local);
    expect(kept?.twistId).toBe('t1');
    __resetTwistStoreForTests();
    expect(readAttempt('k-sent')).toMatchObject({ nonce: local, replied: true, twistId: 't1' });
  });

  it('keeps replied only as a true boolean when reading storage', async () => {
    const { readAttempt, __resetTwistStoreForTests } = await import('@/lite/twists');
    localStorage.setItem(
      'vande:lite-twists',
      JSON.stringify({
        v: 1,
        attempts: [
          { v: 1, dareKey: 'k-yes', nonce: 'aaaaaa', createdAt: 1, replied: true },
          { v: 1, dareKey: 'k-str', nonce: 'bbbbbb', createdAt: 1, replied: 'yes' },
          { v: 1, dareKey: 'k-false', nonce: 'cccccc', createdAt: 1, replied: false },
        ],
        seen: [],
        rematches: [],
      }),
    );
    __resetTwistStoreForTests();
    expect(readAttempt('k-yes')?.replied).toBe(true);
    expect(readAttempt('k-str')).toBeDefined();
    expect(readAttempt('k-str')?.replied).toBeUndefined();
    expect(readAttempt('k-false')?.replied).toBeUndefined();
  });
});
