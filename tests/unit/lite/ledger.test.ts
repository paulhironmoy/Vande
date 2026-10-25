import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEADLINE_GRACE_SECONDS,
  LEDGER_MAX_ENTRIES,
  MAX_LOCAL_DAY_SECONDS,
  __resetLedgerForTests,
  awardChallenger,
  awardHelperReply,
  emptyLedger,
  helperAmount,
  isLateReply,
  isOwnDare,
  localDate,
  migrateV1,
  readLedger,
  recordSentDare,
  replyIdentity,
  revealReply,
  sanitizeLedger,
  sentKeyOf,
  visibleHelper,
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

/** The helper sent the reply's dare from this device (the normal case), then opens the reply. */
function award(l: FriendLedger, r: DareReply, now = DAY1, verified = false) {
  return awardHelperReply(recordSentDare(l, r.dare, now), r, codeOf(r), now, verified);
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
    const again = awardHelperReply(recordSentDare(l, dare()), { dare: dare(), points: 196, best: true, version: 1 }, oldCode, DAY1);
    expect(again).toMatchObject({ earned: 0, fresh: false });
    expect(again.notOwner).toBeUndefined();
    expect(l.sent).toEqual({});
    expect(l.pending).toEqual({});
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

// ---------------------------------------------------------------------------------------------------------------
// Review fixes: ownership, lateness, pending twists, no clock rollback, challenger deadline
// ---------------------------------------------------------------------------------------------------------------

/** Unix seconds of the first local midnight after `t` for a fixed UTC offset in minutes (no daylight saving). */
const midnightAfter = (t: number, offsetMin: number) => {
  const off = offsetMin * 60;
  return (Math.floor((t + off) / 86400) + 1) * 86400 - off;
};
/** Every whole-hour offset from UTC−12 to UTC+14, plus the real half- and quarter-hour ones. */
const OFFSETS = [...Array.from({ length: 27 }, (_, i) => (i - 12) * 60), -570, -210, 210, 270, 330, 345, 390, 525, 570, 630, 765, 825];

describe('ownership (one hop)', () => {
  it('pays only for replies to dares this device sent; anyone else who opens the link earns nothing', () => {
    const reply = r2(dare(40));
    const stranger = emptyLedger();
    const out = awardHelperReply(stranger, reply, codeOf(reply), DAY1);
    expect(out).toMatchObject({ earned: 0, fresh: false, upgraded: false, capped: null, notOwner: true });
    expect(out.ledger).toEqual(stranger);
    const owner = recordSentDare(emptyLedger(), reply.dare, DAY1);
    expect(isOwnDare(owner, reply.dare)).toBe(true);
    expect(isOwnDare(stranger, reply.dare)).toBe(false);
    const paid = awardHelperReply(owner, reply, codeOf(reply), DAY1);
    expect(paid).toMatchObject({ earned: 140, fresh: true });
    expect(paid.notOwner).toBeUndefined();
    // R1 replies need the sent dare too.
    const r1: DareReply = { dare: dare(41), points: 196, best: true, version: 1 };
    const c1 = encodeDareReply(r1);
    expect(awardHelperReply(emptyLedger(), r1, c1, DAY1).notOwner).toBe(true);
    expect(awardHelperReply(recordSentDare(emptyLedger(), r1.dare), r1, c1, DAY1).earned).toBe(40);
  });

  it('treats a dare passed on by a friend as a different dare, even when it ends at the same midnight', () => {
    const original = dare(42);
    const passedOn: Dare = { ...original, points: 100, best: false, chain: 2 };
    expect(dareKeyOf(passedOn)).toBe(dareKeyOf(original));
    expect(sentKeyOf(original)).toBe(`${dareKeyOf(original)}.1`);
    expect(sentKeyOf(passedOn)).toBe(`${dareKeyOf(original)}.2`);
    const sender = recordSentDare(emptyLedger(), original, DAY1);
    // A reply meant for the friend who passed it on, forwarded to the original sender: a friend's friend.
    const forwarded = r2(passedOn);
    expect(awardHelperReply(sender, forwarded, codeOf(forwarded), DAY1).notOwner).toBe(true);
    const passer = recordSentDare(emptyLedger(), passedOn, DAY1);
    expect(awardHelperReply(passer, forwarded, codeOf(forwarded), DAY1).earned).toBe(140);
    expect(isOwnDare(passer, original)).toBe(false);
  });

  it("never pays this device's own answer to its own dare", () => {
    const d = dare(43);
    const owner = recordSentDare(emptyLedger(), d, DAY1);
    const own = r2(d);
    const self = awardHelperReply(owner, own, codeOf(own), DAY1, true, { ownNonce: own.nonce });
    expect(self).toMatchObject({ earned: 0, notOwner: true });
    expect(self.ledger).toEqual(owner);
    // A real friend (another nonce) still counts, and no own nonce means no self check.
    const friend = r2(d);
    expect(awardHelperReply(owner, friend, codeOf(friend), DAY1, false, { ownNonce: own.nonce }).earned).toBe(140);
    expect(awardHelperReply(owner, own, codeOf(own), DAY1, false, {}).earned).toBe(140);
    // An R1 reply has no nonce, so an own nonce never matches it.
    const r1: DareReply = { dare: d, points: 196, best: true, version: 1 };
    expect(awardHelperReply(owner, r1, encodeDareReply(r1), DAY1, false, { ownNonce: own.nonce }).earned).toBe(40);
  });

  it('records sent dares purely, keeps the first record, survives storage and stays bounded', () => {
    const l = emptyLedger();
    const frozen = JSON.stringify(l);
    const once = recordSentDare(l, dare(44), new Date(1_000_000));
    expect(JSON.stringify(l)).toBe(frozen);
    const twice = recordSentDare(once, dare(44), new Date(9_000_000));
    expect(twice.sent[sentKeyOf(dare(44))]).toBe(1_000_000);
    writeLedger(twice);
    __resetLedgerForTests();
    expect(isOwnDare(readLedger(), dare(44))).toBe(true);
    let big = emptyLedger();
    for (let i = 0; i < LEDGER_MAX_ENTRIES + 20; i++) big = recordSentDare(big, dare(1000 + i), new Date(1_000_000 + i));
    expect(Object.keys(big.sent)).toHaveLength(LEDGER_MAX_ENTRIES);
    expect(isOwnDare(big, dare(1000 + LEDGER_MAX_ENTRIES + 19))).toBe(true);
    expect(isOwnDare(big, dare(1000))).toBe(false);
    expect(sanitizeLedger({ sent: { a: -3, b: 'x', c: 5 } }).sent).toEqual({ a: 0, b: 0, c: 5 });
    expect(isOwnDare(sanitizeLedger({ sent: { [sentKeyOf(dare(45))]: 0 } }), dare(45))).toBe(false);
  });
});

describe('lateness: replies built after the dare ended', () => {
  it('never ends an on-time reply, for any sender and friend time zones from UTC−12 to UTC+14', () => {
    const created = Math.floor(Date.UTC(2026, 9, 24, 7, 13) / 1000);
    let checked = 0;
    for (const sender of OFFSETS) {
      for (let h = 0; h < 24; h += 5) {
        const sentAt = created + h * 3600;
        const deadline = midnightAfter(sentAt, sender);
        for (const friend of OFFSETS) {
          for (const at of [sentAt, deadline - 3600, deadline - 1, deadline, deadline + DEADLINE_GRACE_SECONDS - 1, deadline + DEADLINE_GRACE_SECONDS]) {
            const reply = r2({ ...dare(46), deadline }, { rematchDeadline: midnightAfter(at, friend) });
            expect(isLateReply(reply), `sender ${sender}, friend ${friend}, at ${at - deadline}s`).toBe(false);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(10_000);
  });

  it('stays safe on the 25-hour day when daylight saving ends, where a 24-hour bound would wrongly end the reply', () => {
    // The friend's local day runs 25 hours; they reply 5 minutes into it, 5 minutes after the sender's deadline.
    const dayStart = Math.floor(Date.UTC(2026, 9, 24, 23, 0) / 1000);
    const deadline = dayStart;
    const builtAt = dayStart + 300;
    const rematchDeadline = dayStart + 25 * 3600;
    expect(builtAt).toBeLessThan(deadline + DEADLINE_GRACE_SECONDS); // on time, inside the grace window
    expect(rematchDeadline - 86_400 >= deadline + DEADLINE_GRACE_SECONDS).toBe(true); // the plain 24-hour bound misfires
    expect(isLateReply(r2({ ...dare(47), deadline }, { rematchDeadline }))).toBe(false);
    expect(MAX_LOCAL_DAY_SECONDS).toBeGreaterThanOrEqual(25 * 3600);
  });

  it('ends a reply built a full local day after the grace window, in every time zone', () => {
    const deadline = Math.floor(Date.UTC(2026, 9, 25, 4, 0) / 1000);
    for (const friend of OFFSETS) {
      const at = deadline + DEADLINE_GRACE_SECONDS + MAX_LOCAL_DAY_SECONDS;
      expect(isLateReply(r2({ ...dare(48), deadline }, { rematchDeadline: midnightAfter(at, friend) })), `friend ${friend}`).toBe(true);
    }
    // R1 replies carry no rematch deadline and are never judged late.
    expect(isLateReply({ dare: { ...dare(48), deadline }, points: 196, best: true, version: 1 })).toBe(false);
  });

  it('records a late reply at 0 for good without using a slot, and keeps an earlier on-time count of the same attempt', () => {
    const d = dare(49);
    const lateRematch = d.deadline + DEADLINE_GRACE_SECONDS + MAX_LOCAL_DAY_SECONDS + 3600;
    const owner = recordSentDare(emptyLedger(), d, DAY1);
    const late = r2(d, { rematchDeadline: lateRematch });
    const first = awardHelperReply(owner, late, codeOf(late), DAY2);
    expect(first).toMatchObject({ earned: 0, fresh: true, capped: 'ended' });
    const id = replyIdentity(late, codeOf(late));
    expect(first.ledger.replies[id]).toBe(0);
    expect(first.ledger.perDare[dareKeyOf(d)]).toBeUndefined();
    expect(first.ledger.day.helper).toBe(0);
    expect(first.ledger.pending[id]).toBeUndefined();
    expect(awardHelperReply(first.ledger, late, codeOf(late), DAY2)).toMatchObject({ earned: 0, fresh: false, capped: 'ended' });

    // On time first (twist skipped), then the same attempt comes back late with a right twist: no upgrade.
    const nonce = nextNonce();
    const onTime = r2(d, { nonce, twist: 'skipped', twistId: undefined });
    const counted = awardHelperReply(owner, onTime, codeOf(onTime), DAY1).ledger;
    const lateUpgrade = r2(d, { nonce, twist: 'right', rematchDeadline: lateRematch });
    const res = awardHelperReply(counted, lateUpgrade, codeOf(lateUpgrade), DAY2);
    expect(res).toMatchObject({ earned: 0, fresh: false, upgraded: false, capped: 'ended' });
    expect(res.ledger.replies[replyIdentity(onTime, codeOf(onTime))]).toBe(40);
    expect(res.ledger.helper.points).toBe(40);
  });
});

describe('pending twists (hidden until the rematch is answered)', () => {
  it('hides the +100 of a cracked twist from every tally until the reply is revealed', () => {
    const reply = r2(dare(50));
    const out = award(emptyLedger(), reply);
    const id = replyIdentity(reply, codeOf(reply));
    expect(out.ledger.pending[id]).toBe(100);
    expect(out.ledger.helper).toMatchObject({ points: 140, understood: 1, answers: 1 });
    expect(visibleHelper(out.ledger)).toEqual({ answers: 1, understood: 0, points: 40 });
    const before = JSON.stringify(out.ledger);
    const shown = revealReply(out.ledger, id);
    expect(JSON.stringify(out.ledger)).toBe(before);
    expect(shown.pending[id]).toBeUndefined();
    expect(visibleHelper(shown)).toEqual({ answers: 1, understood: 1, points: 140 });
  });

  it('lists a wrong twist at 0, and nothing for skipped twists, R1, capped or late replies', () => {
    const wrong = r2(dare(51), { twist: 'wrong' });
    const w = award(emptyLedger(), wrong);
    expect(w.ledger.pending[replyIdentity(wrong, codeOf(wrong))]).toBe(0);
    expect(visibleHelper(w.ledger)).toEqual({ answers: 1, understood: 0, points: 40 });

    const skipped = r2(dare(52), { twist: 'skipped', twistId: undefined });
    expect(award(emptyLedger(), skipped).ledger.pending).toEqual({});

    const r1: DareReply = { dare: dare(53), points: 196, best: true, version: 1 };
    expect(awardHelperReply(recordSentDare(emptyLedger(), r1.dare), r1, encodeDareReply(r1), DAY1).ledger.pending).toEqual({});

    let l = emptyLedger();
    for (let i = 0; i < 3; i++) l = award(l, r2(dare(54), { twist: 'skipped', twistId: undefined })).ledger;
    const capped = award(l, r2(dare(54)));
    expect(capped.capped).toBe('dare');
    expect(capped.ledger.pending).toEqual({});

    const late = r2(dare(55), { rematchDeadline: dare(55).deadline + DEADLINE_GRACE_SECONDS + MAX_LOCAL_DAY_SECONDS });
    expect(award(emptyLedger(), late, DAY2).ledger.pending).toEqual({});
  });

  it('re-hides the bonus when an answered reply is upgraded, and sums every pending reply', () => {
    const d = dare(56);
    const nonce = nextNonce();
    const first = award(emptyLedger(), r2(d, { nonce, twist: 'skipped', twistId: undefined }));
    const id = `${dareKeyOf(d)}#${nonce}`;
    expect(first.ledger.pending[id]).toBeUndefined();
    const up = award(first.ledger, r2(d, { nonce, twist: 'right' }));
    expect(up).toMatchObject({ earned: 100, upgraded: true });
    expect(up.ledger.pending[id]).toBe(100);
    const other = award(up.ledger, r2(dare(57)));
    expect(visibleHelper(other.ledger)).toEqual({ answers: 2, understood: 0, points: 80 });
    expect(visibleHelper(revealReply(other.ledger, id))).toEqual({ answers: 2, understood: 1, points: 180 });
  });

  it('keeps pending entries through storage, drops orphans and clamps corrupt values', () => {
    const reply = r2(dare(58));
    const l = award(emptyLedger(), reply).ledger;
    writeLedger(l);
    __resetLedgerForTests();
    expect(visibleHelper(readLedger())).toEqual(visibleHelper(l));
    const repaired = sanitizeLedger({ ...l, pending: { ...l.pending, 'k-orphan#000000': 100, [replyIdentity(reply, codeOf(reply))]: 9999 } });
    expect(repaired.pending).toEqual({ [replyIdentity(reply, codeOf(reply))]: 100 });
    expect(visibleHelper(sanitizeLedger({ helper: { points: 10, understood: 0, answers: 1 }, replies: { x: 140 }, pending: { x: 100 } }))).toEqual({ answers: 1, understood: 0, points: 0 });
  });
});

describe('day counters never roll back', () => {
  it('a clock set back keeps today’s counters and cannot reopen the daily cap', () => {
    let l = emptyLedger();
    for (let i = 0; i < 10; i++) l = award(l, r2(dare(600 + i)), DAY2).ledger;
    expect(l.day).toEqual({ date: localDate(DAY2), helper: 10, challenger: 0 });
    const back = award(l, r2(dare(700)), DAY1);
    expect(back).toMatchObject({ earned: 0, capped: 'day' });
    expect(back.ledger.day.date).toBe(localDate(DAY2));
    let c = l;
    for (let i = 0; i < 10; i++) c = awardChallenger(c, `k-c${i}`, false, DAY2).ledger;
    expect(awardChallenger(c, 'k-c-back', false, DAY1)).toMatchObject({ earned: 0, capped: 'day' });
    // Moving forward still starts a new day.
    expect(award(back.ledger, r2(dare(701)), new Date(2026, 9, 26, 9, 0, 0)).earned).toBe(140);
  });
});

describe('Challenger deadline', () => {
  it('pays until the grace window ends, then records 0 and never upgrades an earlier award', () => {
    const deadline = Math.floor(DAY1.getTime() / 1000) + 3600;
    const at = (s: number) => new Date(s * 1000);
    expect(awardChallenger(emptyLedger(), 'k-ch1', true, at(deadline + DEADLINE_GRACE_SECONDS), deadline)).toMatchObject({ earned: 140, capped: null });
    const late = awardChallenger(emptyLedger(), 'k-ch2', true, at(deadline + DEADLINE_GRACE_SECONDS + 1), deadline);
    expect(late).toMatchObject({ earned: 0, fresh: true, capped: 'ended' });
    expect(late.ledger.challenged['k-ch2']).toBe(0);
    expect(late.ledger.day.challenger).toBe(0);
    expect(awardChallenger(late.ledger, 'k-ch2', true, at(deadline + 99_999), deadline)).toMatchObject({ earned: 0, fresh: false, capped: 'ended' });

    const onTime = awardChallenger(emptyLedger(), 'k-ch3', false, at(deadline - 60), deadline).ledger;
    const afterwards = awardChallenger(onTime, 'k-ch3', true, at(deadline + DEADLINE_GRACE_SECONDS + 5), deadline);
    expect(afterwards).toMatchObject({ earned: 0, upgraded: false, capped: 'ended' });
    expect(afterwards.ledger.challenged['k-ch3']).toBe(40);
    // Without a deadline nothing changes.
    expect(awardChallenger(emptyLedger(), 'k-ch4', true, at(deadline + 99_999)).earned).toBe(140);
  });
});
