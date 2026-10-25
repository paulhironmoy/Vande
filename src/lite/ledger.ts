/**
 * Helper and Challenger award ledger (localStorage `vande:lite-awards`, migrated from v1 `vande:lite-helper`).
 *
 * Rules (docs/prompts/LITE-INCENTIVES-AND-VISUALS-PROMPT.md, B1–B4; docs/LITE-INCENTIVES.md), numbers from
 * FRIEND_POINTS:
 * - Ownership (one hop): only replies to dares this device sent earn Helper points. A dare is "sent" once the dare
 *   sheet shares it (`recordSentDare`), keyed by `sentKeyOf(dare)` = dare key + chain, so a dare passed on by a
 *   friend is a different dare even on the same day. A reply to anyone else's dare, or this device's own answer to
 *   its own dare (`opts.ownNonce`), is shown but never paid (`notOwner`).
 * - Helper: +40 for a friend's reply, +100 more only for an R2 reply where the friend found the best move AND got
 *   the twist right. R1 replies (no twist) earn +40 only.
 * - Lateness: a reply the friend provably built after the dare ended (deadline + DEADLINE_GRACE_SECONDS) earns
 *   nothing (`capped: 'ended'`); see `isLateReply` for why this can never catch an on-time reply. Challenger awards
 *   after the deadline earn nothing either.
 * - Caps, the same for everyone: at most `perDareCap` rewarded replies per dare and `perDayCap` per local day
 *   (helper); challenger awards once per dare and at most `perDayCap` per local day. Day counters roll over only when
 *   the local date moves forward: setting the clock back never reopens a cap (moving it forward is an accepted limit).
 * - Dedupe by reply identity (R1: the canonical code; R2: `${dareKey}#${nonce}`). The same reply counts once. When an
 *   already-rewarded attempt comes back worth more (its twist is now right), only the difference is added: an upgrade
 *   uses no new slot and is not blocked by caps.
 * - A reply that arrives over a cap, or late, is recorded with 0 points and stays at 0, even after the day rolls
 *   over, so reopening an old link can never bypass a cap. Capped replies cannot be upgraded.
 * - Pending twists: while the helper has not answered a reply's rematch, the twist-dependent part of that reply (the
 *   +100, or 0) is listed in `pending`, and `visibleHelper` leaves it out of every tally, so the friend's twist result
 *   never shows before the rematch. `revealReply` lifts it once the rematch is answered.
 * - Helper and Challenger points are a personal tally. Nothing here touches the score, stars, medals or bests.
 *
 * The award functions are pure (they return the next ledger); storage happens only in readLedger / writeLedger, with
 * an in-memory fallback when storage is unavailable.
 *
 * Stable API used by the Lite screen: readLedger, writeLedger, replyIdentity, sentKeyOf, recordSentDare, isOwnDare,
 * awardHelperReply, awardChallenger, revealReply, visibleHelper, isLateReply.
 */
import { FRIEND_POINTS } from './points';
import { dareKeyOf } from './twists';
import { encodeDareReply, type Dare, type DareReply } from '@/share/dare';
import type { AwardResult, FriendLedger } from './contracts';

const KEY = 'vande:lite-awards';
const V1_KEY = 'vande:lite-helper';
/** Bound for each of the replies, perDare, challenged, sent and pending maps (latest entries kept). */
export const LEDGER_MAX_ENTRIES = 300;

/** A dare still pays for this long after its deadline (seconds), so a reply sent at 23:59:59 is never lost. */
export const DEADLINE_GRACE_SECONDS = 600;

/**
 * The longest a local calendar day can last, in seconds: 25 hours on the day daylight saving ends, 26 for the rare
 * two-hour standard-time change (for example Magadan in 2014). Used to turn the friend's rematch deadline (their next
 * local midnight when they built the reply) into a safe lower bound on when they built it.
 */
export const MAX_LOCAL_DAY_SECONDS = 26 * 3600;

export function emptyLedger(): FriendLedger {
  return {
    v: 2,
    helper: { points: 0, answers: 0, understood: 0, verifiedPoints: 0 },
    challenger: { points: 0, answers: 0, understood: 0 },
    replies: {},
    perDare: {},
    challenged: {},
    day: { date: '', helper: 0, challenger: 0 },
    sent: {},
    pending: {},
  };
}

/** Local calendar date as YYYY-MM-DD. */
export function localDate(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

function numMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (k) out[k] = num(x);
  return out;
}

function bound(map: Record<string, number>): Record<string, number> {
  const keys = Object.keys(map);
  if (keys.length <= LEDGER_MAX_ENTRIES) return map;
  const out: Record<string, number> = {};
  for (const k of keys.slice(-LEDGER_MAX_ENTRIES)) out[k] = map[k];
  return out;
}

/** Pending entries only for counted replies, each at most the twist bonus. */
function cleanPending(pending: Record<string, number>, replies: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(pending)) if (replies[k] !== undefined) out[k] = Math.min(v, FRIEND_POINTS.understood);
  return out;
}

/** Repairs any stored value into a valid ledger (unknown fields dropped, numbers made finite and non-negative). */
export function sanitizeLedger(raw: unknown): FriendLedger {
  const l = emptyLedger();
  if (!raw || typeof raw !== 'object') return l;
  const o = raw as Record<string, unknown>;
  const h = (o.helper ?? {}) as Record<string, unknown>;
  const c = (o.challenger ?? {}) as Record<string, unknown>;
  const d = (o.day ?? {}) as Record<string, unknown>;
  l.helper = { points: num(h.points), answers: num(h.answers), understood: num(h.understood), verifiedPoints: num(h.verifiedPoints) };
  l.challenger = { points: num(c.points), answers: num(c.answers), understood: num(c.understood) };
  l.replies = numMap(o.replies);
  l.perDare = numMap(o.perDare);
  l.challenged = numMap(o.challenged);
  l.day = { date: typeof d.date === 'string' ? d.date : '', helper: num(d.helper), challenger: num(d.challenger) };
  l.sent = numMap(o.sent);
  l.pending = cleanPending(numMap(o.pending), l.replies);
  return l;
}

/** Converts the v1 helper stats ({answers, best, points, seen}) into a ledger. Every v1 reply counts as fully paid. */
export function migrateV1(raw: unknown): FriendLedger | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.seen)) return null;
  const l = emptyLedger();
  l.helper.answers = num(o.answers);
  l.helper.understood = num(o.best);
  l.helper.points = num(o.points);
  for (const code of o.seen) if (typeof code === 'string' && code) l.replies[code] = FRIEND_POINTS.answer + FRIEND_POINTS.understood;
  l.replies = bound(l.replies);
  return l;
}

let memory: FriendLedger | null = null;
let storageFailed = false;

function cloneLedger(l: FriendLedger): FriendLedger {
  return JSON.parse(JSON.stringify(l)) as FriendLedger;
}

/** The stored ledger (migrating v1 helper stats on first read). Never throws. */
export function readLedger(): FriendLedger {
  if (storageFailed) return cloneLedger(memory ?? emptyLedger());
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      try {
        return sanitizeLedger(JSON.parse(raw));
      } catch {
        return emptyLedger();
      }
    }
    const v1 = localStorage.getItem(V1_KEY);
    if (v1) {
      try {
        const migrated = migrateV1(JSON.parse(v1));
        if (migrated) {
          writeLedger(migrated);
          return migrated;
        }
      } catch {
        /* unreadable v1 value: start fresh */
      }
    }
    return emptyLedger();
  } catch {
    storageFailed = true;
    return cloneLedger(memory ?? emptyLedger());
  }
}

/** Stores the ledger (maps bounded). Never throws; keeps an in-memory copy when storage is unavailable. */
export function writeLedger(l: FriendLedger): void {
  const next = sanitizeLedger(l);
  next.replies = bound(next.replies);
  next.perDare = bound(next.perDare);
  next.challenged = bound(next.challenged);
  next.sent = bound(next.sent);
  next.pending = bound(cleanPending(next.pending, next.replies));
  memory = cloneLedger(next);
  if (storageFailed) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    storageFailed = true;
  }
}

/** Test hook: forget the in-memory fallback and retry storage (simulates a reload). */
export function __resetLedgerForTests(): void {
  memory = null;
  storageFailed = false;
}

// ---------------------------------------------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------------------------------------------

/**
 * The key of a dare this device sent: its dare key (seed, path, step, deadline) plus the chain position. The chain
 * counts, so a dare a friend passes on (chain + 1) is a different dare from the one they received, even when both
 * end at the same midnight.
 */
export function sentKeyOf(dare: Pick<Dare, 'seed' | 'path' | 'step' | 'deadline' | 'chain'>): string {
  return `${dareKeyOf(dare)}.${dare.chain}`;
}

/** Records that this device sent `dare` (pure; the first record wins; bounded like the other maps). */
export function recordSentDare(l: FriendLedger, dare: Dare, now: Date = new Date()): FriendLedger {
  const next = sanitizeLedger(l);
  const k = sentKeyOf(dare);
  if (!(next.sent[k] > 0)) next.sent[k] = Math.max(1, Math.floor(now.getTime()));
  next.sent = bound(next.sent);
  return next;
}

/** True when this device sent `dare` (its replies can earn Helper points here). */
export function isOwnDare(l: FriendLedger, dare: Pick<Dare, 'seed' | 'path' | 'step' | 'deadline' | 'chain'>): boolean {
  return (l.sent?.[sentKeyOf(dare)] ?? 0) > 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Awards
// ---------------------------------------------------------------------------------------------------------------

/** Identity used for dedupe: R2 = `${dareKey}#${nonce}`; R1 = the canonical code (falls back to the given code). */
export function replyIdentity(reply: DareReply, code: string): string {
  if (reply.version === 2 && reply.nonce) return `${dareKeyOf(reply.dare)}#${reply.nonce}`;
  try {
    return encodeDareReply({ dare: reply.dare, points: reply.points, best: reply.best });
  } catch {
    return code.trim();
  }
}

/** Points a reply is worth: +40, and +100 more only for R2 with the best move and a right twist. */
export function helperAmount(reply: DareReply): number {
  const understood = reply.version === 2 && reply.best && reply.twist === 'right';
  return FRIEND_POINTS.answer + (understood ? FRIEND_POINTS.understood : 0);
}

/**
 * True when the friend provably built this reply after the dare ended (its deadline plus DEADLINE_GRACE_SECONDS).
 *
 * Why it can never catch an on-time reply: the friend's app sets `rematchDeadline` to its next local midnight at the
 * moment it builds the reply, so the reply was built no earlier than `rematchDeadline` minus the length of that local
 * day, which is at most MAX_LOCAL_DAY_SECONDS. Both deadlines are absolute instants, so the time zones of the sender
 * and the friend do not matter: when even that earliest possible build time is at or past the end of the grace
 * window, the reply is late. (A plain 24-hour day would not do: on the 25-hour day when daylight saving ends, a reply
 * in the first hour of the day would look an hour later than it was.) R1 replies carry no rematch deadline and are
 * never judged late. A forged rematch deadline can only hide lateness; forging is an accepted limit
 * (docs/LITE-INCENTIVES.md, threat model).
 */
export function isLateReply(reply: DareReply): boolean {
  if (reply.version !== 2 || typeof reply.rematchDeadline !== 'number' || !Number.isFinite(reply.rematchDeadline)) return false;
  return reply.rematchDeadline - MAX_LOCAL_DAY_SECONDS >= reply.dare.deadline + DEADLINE_GRACE_SECONDS;
}

/** The friend took a twist (right or wrong) on this reply, so it carries a rematch whose result must stay hidden. */
function carriesTwist(reply: DareReply): boolean {
  return reply.version === 2 && (reply.twist === 'right' || reply.twist === 'wrong') && Boolean(reply.twistId);
}

function rollDay(l: FriendLedger, now: Date): FriendLedger {
  const date = localDate(now);
  // Only forward: a clock set back keeps today's counters (and the later date), so it cannot reopen a cap.
  if (!l.day.date || date > l.day.date) l.day = { date, helper: 0, challenger: 0 };
  return l;
}

/**
 * Awards the helper for a friend's reply (pure: returns the next ledger). `opts.ownNonce` is this device's own
 * attempt nonce for the reply's dare (`readAttempt(dareKeyOf(reply.dare))?.nonce`): a reply carrying it is this
 * device answering its own dare.
 */
export function awardHelperReply(
  l: FriendLedger,
  reply: DareReply,
  code: string,
  now: Date = new Date(),
  verified = false,
  opts: { ownNonce?: string } = {},
): AwardResult {
  const base = sanitizeLedger(l);
  if (!(base.sent[sentKeyOf(reply.dare)] > 0) || (reply.nonce && reply.nonce === opts.ownNonce)) {
    return { ledger: base, earned: 0, fresh: false, upgraded: false, capped: null, notOwner: true };
  }
  const next = rollDay(base, now);
  const id = replyIdentity(reply, code);
  const prev = next.replies[id];
  if (isLateReply(reply)) {
    // Recorded at 0 so it is never counted later; an earlier on-time count of the same attempt is kept as it was.
    if (prev === undefined) next.replies[id] = 0;
    return { ledger: next, earned: 0, fresh: prev === undefined, upgraded: false, capped: 'ended' };
  }
  const amount = helperAmount(reply);
  const understood = amount > FRIEND_POINTS.answer;
  if (prev !== undefined) {
    if (prev > 0 && amount > prev) {
      const diff = amount - prev;
      next.replies[id] = amount;
      next.helper.points += diff;
      if (understood && prev <= FRIEND_POINTS.answer) next.helper.understood += 1;
      if (verified) next.helper.verifiedPoints += diff;
      if (carriesTwist(reply)) next.pending[id] = amount - FRIEND_POINTS.answer;
      return { ledger: next, earned: diff, fresh: false, upgraded: true, capped: null };
    }
    return { ledger: next, earned: 0, fresh: false, upgraded: false, capped: null };
  }
  const dareKey = dareKeyOf(reply.dare);
  const capped: AwardResult['capped'] = (next.perDare[dareKey] ?? 0) >= FRIEND_POINTS.perDareCap ? 'dare' : next.day.helper >= FRIEND_POINTS.perDayCap ? 'day' : null;
  if (capped) {
    next.replies[id] = 0;
    return { ledger: next, earned: 0, fresh: true, upgraded: false, capped };
  }
  next.replies[id] = amount;
  next.perDare[dareKey] = (next.perDare[dareKey] ?? 0) + 1;
  next.day.helper += 1;
  next.helper.points += amount;
  next.helper.answers += 1;
  if (understood) next.helper.understood += 1;
  if (verified) next.helper.verifiedPoints += amount;
  if (carriesTwist(reply)) next.pending[id] = understood ? FRIEND_POINTS.understood : 0;
  return { ledger: next, earned: amount, fresh: true, upgraded: false, capped: null };
}

/** The rematch for this reply was answered: its twist result may show now (pure). */
export function revealReply(l: FriendLedger, identity: string): FriendLedger {
  const next = sanitizeLedger(l);
  delete next.pending[identity];
  return next;
}

/** Helper totals as they may be shown: every pending twist bonus (and its "understood") left out until revealed. */
export function visibleHelper(l: FriendLedger): { answers: number; understood: number; points: number } {
  const s = sanitizeLedger(l);
  let hiddenPoints = 0;
  let hiddenUnderstood = 0;
  for (const v of Object.values(s.pending)) {
    hiddenPoints += v;
    if (v > 0) hiddenUnderstood += 1;
  }
  return {
    answers: s.helper.answers,
    understood: Math.max(0, s.helper.understood - hiddenUnderstood),
    points: Math.max(0, s.helper.points - hiddenPoints),
  };
}

/**
 * Awards the friend (challenger) when they send their result back (pure: returns the next ledger). With `deadline`
 * (the dare's, unix seconds), a send after deadline + DEADLINE_GRACE_SECONDS earns nothing and is recorded at 0; an
 * earlier on-time award is kept but no longer upgraded.
 */
export function awardChallenger(l: FriendLedger, dareKey: string, understood: boolean, now: Date = new Date(), deadline?: number): AwardResult {
  const next = rollDay(sanitizeLedger(l), now);
  const prev = next.challenged[dareKey];
  if (typeof deadline === 'number' && Number.isFinite(deadline) && now.getTime() / 1000 > deadline + DEADLINE_GRACE_SECONDS) {
    if (prev === undefined) next.challenged[dareKey] = 0;
    return { ledger: next, earned: 0, fresh: prev === undefined, upgraded: false, capped: 'ended' };
  }
  const amount = FRIEND_POINTS.answer + (understood ? FRIEND_POINTS.understood : 0);
  if (prev !== undefined) {
    if (prev > 0 && amount > prev) {
      const diff = amount - prev;
      next.challenged[dareKey] = amount;
      next.challenger.points += diff;
      if (prev <= FRIEND_POINTS.answer) next.challenger.understood += 1;
      return { ledger: next, earned: diff, fresh: false, upgraded: true, capped: null };
    }
    return { ledger: next, earned: 0, fresh: false, upgraded: false, capped: null };
  }
  if (next.day.challenger >= FRIEND_POINTS.perDayCap) {
    next.challenged[dareKey] = 0;
    return { ledger: next, earned: 0, fresh: true, upgraded: false, capped: 'day' };
  }
  next.challenged[dareKey] = amount;
  next.day.challenger += 1;
  next.challenger.points += amount;
  next.challenger.answers += 1;
  if (understood) next.challenger.understood += 1;
  return { ledger: next, earned: amount, fresh: true, upgraded: false, capped: null };
}
