import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LEDGER_MAX_ENTRIES,
  __resetLedgerForTests,
  awardChallenger,
  awardHelperReply,
  emptyLedger,
  helperAmount,
  localDate,
  migrateV1,
  readLedger,
  replyIdentity,
  sanitizeLedger,
  writeLedger,
} from '@/lite/ledger';
import { dareKeyOf } from '@/lite/twists';
import { FRIEND_POINTS } from '@/lite/points';
import { encodeDareReply, type Dare, type DareReply } from '@/share/dare';
import type { FriendLedger } from '@/lite/contracts';

const DEADLINE = Math.floor(new Date(2026, 9, 25, 0, 0, 0).getTime() / 1000);
const REMATCH = DEADLINE + 86400;
const dare = (n = 0): Dare => ({ seed: 1000 + n, path: 'd0-1', step: 'd1', points: 196, best: true, deadline: DEADLINE, chain: 1 });
let nonceN = 0;
const nextNonce = () => (nonceN++).toString(36).padStart(6, '0');
const r2 = (d: Dare, over: Partial<DareReply> = {}): DareReply => ({
  dare: d,
  points: 196,
  best: true,
  version: 2,
  twistId: 't3',
  twist: 'right',
  nonce: nextNonce(),
  rematchDeadline: REMATCH,
  ...over,
});
const codeOf = (r: DareReply) => encodeDareReply(r);
const DAY1 = new Date(2026, 9, 24, 10, 0, 0);
const DAY1_LATE = new Date(2026, 9, 24, 23, 59, 59);
const DAY2 = new Date(2026, 9, 25, 0, 0, 1);

function award(l: FriendLedger, r: DareReply, now = DAY1, verified = false) {
  return awardHelperReply(l, r, codeOf(r), now, verified);
}

beforeEach(() => {
  localStorage.clear();
  __resetLedgerForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  __resetLedgerForTests();
});

describe('Helper awards', () => {
  it('pays +40 per answer and +100 more only for an R2 best move with a right twist', () => {
    expect(helperAmount(r2(dare()))).toBe(FRIEND_POINTS.answer + FRIEND_POINTS.understood);
    expect(helperAmount(r2(dare(), { twist: 'wrong' }))).toBe(40);
    expect(helperAmount(r2(dare(), { best: false }))).toBe(40);
    expect(helperAmount(r2(dare(), { twist: 'skipped', twistId: undefined }))).toBe(40);
    // R1 replies carry no twist, so even a best move earns +40 only.
    expect(helperAmount({ dare: dare(), points: 196, best: true, version: 1 })).toBe(40);
    expect(helperAmount({ dare: dare(), points: 196, best: true })).toBe(40);

    const first = award(emptyLedger(), r2(dare()));
    expect(first).toMatchObject({ earned: 140, fresh: true, upgraded: false, capped: null });
    expect(first.ledger.helper).toEqual({ points: 140, answers: 1, understood: 1, verifiedPoints: 0 });
    const second = award(first.ledger, r2(dare(), { twist: 'wrong' }));
    expect(second.earned).toBe(40);
    expect(second.ledger.helper).toMatchObject({ points: 180, answers: 2, understood: 1 });
  });

  it('counts the same reply once, but two friends with identical answers twice', () => {
    const reply = r2(dare());
    const a = award(emptyLedger(), reply);
    const again = award(a.ledger, reply);
    expect(again).toMatchObject({ earned: 0, fresh: false, upgraded: false, capped: null });
    expect(again.ledger.helper.points).toBe(140);
    // Same answers, different device nonce: a second friend.
    const other = award(again.ledger, { ...reply, nonce: nextNonce() });
    expect(other.earned).toBe(140);
    expect(other.ledger.helper.answers).toBe(2);
    // An R1 code is its own identity (the canonical code).
    const r1: DareReply = { dare: dare(), points: 196, best: true, version: 1 };
    const c1 = encodeDareReply({ dare: r1.dare, points: r1.points, best: r1.best });
    expect(replyIdentity(r1, `  ${c1.toLowerCase()} `)).toBe(c1);
    const x = awardHelperReply(other.ledger, r1, c1, DAY1);
    expect(x.earned).toBe(40);
    expect(awardHelperReply(x.ledger, r1, c1.toLowerCase(), DAY1).earned).toBe(0);
    expect(replyIdentity(reply, 'ignored')).toBe(`${dareKeyOf(reply.dare)}#${reply.nonce}`);
  });

  it('rewards at most 3 replies per dare and says so; other dares still pay', () => {
    let l = emptyLedger();
    const replies = [0, 1, 2, 3].map(() => r2(dare(1)));
    for (const r of replies.slice(0, 3)) l = award(l, r).ledger;
    expect(l.helper.answers).toBe(3);
    const fourth = award(l, replies[3]);
    expect(fourth).toMatchObject({ earned: 0, fresh: true, capped: 'dare' });
    expect(fourth.ledger.helper.points).toBe(420);
    // Reopening the capped reply: already counted, still nothing.
    const reopen = award(fourth.ledger, replies[3]);
    expect(reopen).toMatchObject({ earned: 0, fresh: false, capped: null });
    // A different dare is unaffected.
    expect(award(reopen.ledger, r2(dare(2))).earned).toBe(140);
  });

  it('rewards at most 10 replies per local day, then starts again after midnight; capped replies stay at 0', () => {
    let l = emptyLedger();
    for (let i = 0; i < 10; i++) l = award(l, r2(dare(100 + i)), DAY1).ledger;
    expect(l.day).toEqual({ date: localDate(DAY1), helper: 10, challenger: 0 });
    const eleventh = r2(dare(200));
    const capped = award(l, eleventh, DAY1_LATE);
    expect(capped).toMatchObject({ earned: 0, capped: 'day', fresh: true });
    // Next day: new replies pay again, the capped one does not come back.
    const next = award(capped.ledger, r2(dare(201)), DAY2);
    expect(next.earned).toBe(140);
    expect(next.ledger.day).toEqual({ date: localDate(DAY2), helper: 1, challenger: 0 });
    expect(award(next.ledger, eleventh, DAY2)).toMatchObject({ earned: 0, fresh: false });
  });

  it('upgrades an answered reply once its twist is right: only the difference, no new slot, even at a cap', () => {
    const d = dare(5);
    const nonce = nextNonce();
    let l = emptyLedger();
    const skipped = award(l, r2(d, { nonce, twist: 'skipped', twistId: undefined }));
    expect(skipped.earned).toBe(40);
    l = skipped.ledger;
    for (let i = 0; i < 2; i++) l = award(l, r2(d)).ledger; // the dare is now at its cap of 3
    for (let i = 0; i < 7; i++) l = award(l, r2(dare(300 + i))).ledger; // and the day is at 10
    const up = award(l, r2(d, { nonce, twist: 'right' }));
    expect(up).toMatchObject({ earned: 100, fresh: false, upgraded: true, capped: null });
    expect(up.ledger.perDare[dareKeyOf(d)]).toBe(3);
    expect(up.ledger.day.helper).toBe(10);
    expect(up.ledger.helper.understood).toBe(l.helper.understood + 1);
    // Only once.
    expect(award(up.ledger, r2(d, { nonce, twist: 'right' }))).toMatchObject({ earned: 0, upgraded: false });
    // Never downwards.
    expect(award(up.ledger, r2(d, { nonce, twist: 'wrong' })).earned).toBe(0);
  });

  it('never upgrades a capped reply', () => {
    let l = emptyLedger();
    for (let i = 0; i < 3; i++) l = award(l, r2(dare(9))).ledger;
    const nonce = nextNonce();
    const capped = award(l, r2(dare(9), { nonce, twist: 'skipped', twistId: undefined }));
    expect(capped.capped).toBe('dare');
    expect(award(capped.ledger, r2(dare(9), { nonce, twist: 'right' }))).toMatchObject({ earned: 0, upgraded: false });
  });

  it('tracks verified points separately and never mutates its input', () => {
    const l = emptyLedger();
    const frozen = JSON.stringify(l);
    const v = award(l, r2(dare(7)), DAY1, true);
    expect(v.ledger.helper.verifiedPoints).toBe(140);
    expect(JSON.stringify(l)).toBe(frozen);
    const u = award(v.ledger, r2(dare(8)), DAY1, false);
    expect(u.ledger.helper).toMatchObject({ points: 280, verifiedPoints: 140 });
  });
});

describe('Challenger awards', () => {
  it('pays once per dare, upgrades to the twist bonus, caps at 10 a day and rolls over at midnight', () => {
    const k = dareKeyOf(dare(1));
    const a = awardChallenger(emptyLedger(), k, false, DAY1);
    expect(a).toMatchObject({ earned: 40, fresh: true, capped: null });
    expect(awardChallenger(a.ledger, k, false, DAY1)).toMatchObject({ earned: 0, fresh: false });
    const up = awardChallenger(a.ledger, k, true, DAY1);
    expect(up).toMatchObject({ earned: 100, upgraded: true });
    expect(up.ledger.challenger).toEqual({ points: 140, answers: 1, understood: 1 });
    expect(awardChallenger(up.ledger, k, true, DAY1).earned).toBe(0);

    let l = up.ledger;
    for (let i = 2; i <= 10; i++) l = awardChallenger(l, dareKeyOf(dare(i)), true, DAY1).ledger;
    expect(l.day.challenger).toBe(10);
    const capped = awardChallenger(l, dareKeyOf(dare(11)), true, DAY1_LATE);
    expect(capped).toMatchObject({ earned: 0, capped: 'day', fresh: true });
    expect(awardChallenger(capped.ledger, dareKeyOf(dare(12)), false, DAY2).earned).toBe(40);
    // Helper and challenger day counts are separate.
    expect(capped.ledger.day.helper).toBe(0);
  });
});

describe('ledger storage', () => {
  it('round-trips through storage and survives a reload', () => {
    const l = award(emptyLedger(), r2(dare())).ledger;
    writeLedger(l);
    __resetLedgerForTests();
    expect(readLedger()).toEqual(l);
    expect(JSON.parse(localStorage.getItem('vande:lite-awards')!)).toEqual(l);
  });

  it('migrates the v1 helper stats once, so old replies are never paid again', () => {
    const oldCode = encodeDareReply({ dare: dare(), points: 196, best: true });
    localStorage.setItem('vande:lite-helper', JSON.stringify({ answers: 3, best: 2, points: 380, seen: [oldCode, 'R1_other'] }));
    const l = readLedger();
    expect(l.helper).toEqual({ points: 380, answers: 3, understood: 2, verifiedPoints: 0 });
    expect(l.replies[oldCode]).toBe(140);
    expect(localStorage.getItem('vande:lite-awards')).not.toBeNull();
    const again = awardHelperReply(l, { dare: dare(), points: 196, best: true, version: 1 }, oldCode, DAY1);
    expect(again.earned).toBe(0);
    expect(migrateV1({ answers: 1 })).toBeNull();
    expect(migrateV1(null)).toBeNull();
    // Once migrated, the new key wins.
    localStorage.setItem('vande:lite-helper', JSON.stringify({ answers: 99, best: 0, points: 9999, seen: [] }));
    expect(readLedger().helper.points).toBe(380);
  });

  it('repairs corrupted values and keeps the maps bounded', () => {
    localStorage.setItem('vande:lite-awards', '{not json');
    expect(readLedger()).toEqual(emptyLedger());
    expect(sanitizeLedger({ helper: { points: -5, answers: 'x' }, replies: { a: 40, b: -1, c: 'q' }, day: { date: 7 } })).toMatchObject({
      helper: { points: 0, answers: 0 },
      replies: { a: 40, b: 0, c: 0 },
      day: { date: '', helper: 0, challenger: 0 },
    });
    const big = emptyLedger();
    for (let i = 0; i < LEDGER_MAX_ENTRIES + 50; i++) big.replies[`r#${i}`] = 40;
    writeLedger(big);
    const stored = readLedger();
    expect(Object.keys(stored.replies)).toHaveLength(LEDGER_MAX_ENTRIES);
    expect(stored.replies[`r#${LEDGER_MAX_ENTRIES + 49}`]).toBe(40);
    expect(stored.replies['r#0']).toBeUndefined();
  });

  it('keeps working in memory when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const first = readLedger();
    expect(first).toEqual(emptyLedger());
    const next = award(first, r2(dare())).ledger;
    expect(() => writeLedger(next)).not.toThrow();
    expect(readLedger().helper.points).toBe(140);
  });

  it('falls back to memory when only writing fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const next = award(readLedger(), r2(dare(3))).ledger;
    writeLedger(next);
    expect(readLedger().helper.points).toBe(140);
  });

  it('formats the local date', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localDate(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });
});
