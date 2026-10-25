/**
 * Helper and Challenger award ledger (localStorage `vande:lite-awards`, migrated from v1 `vande:lite-helper`).
 *
 * Rules (docs/prompts/LITE-INCENTIVES-AND-VISUALS-PROMPT.md, B1–B4), all numbers from FRIEND_POINTS:
 * - Helper: +40 for a friend's reply, +100 more only for an R2 reply where the friend found the best move AND got
 *   the twist right. R1 replies (no twist) earn +40 only.
 * - Caps, the same for everyone: at most `perDareCap` rewarded replies per dare and `perDayCap` per local day
 *   (helper); challenger awards once per dare and at most `perDayCap` per local day. Day counters roll over when the
 *   local date changes.
 * - Dedupe by reply identity (R1: the canonical code; R2: `${dareKey}#${nonce}`). The same reply counts once. When an
 *   already-rewarded attempt comes back worth more (its twist is now right), only the difference is added: an upgrade
 *   uses no new slot and is not blocked by caps.
 * - A reply that arrives over a cap is recorded with 0 points and stays at 0, even after the day rolls over, so
 *   reopening an old link can never bypass a cap. Capped replies cannot be upgraded.
 * - Helper and Challenger points are a personal tally. Nothing here touches the score, stars, medals or bests.
 *
 * The award functions are pure (they return the next ledger); storage happens only in readLedger / writeLedger, with
 * an in-memory fallback when storage is unavailable.
 *
 * Stable API used by the Lite screen: readLedger, writeLedger, replyIdentity, awardHelperReply, awardChallenger.
 */
import { FRIEND_POINTS } from './points';
import { dareKeyOf } from './twists';
import { encodeDareReply, type DareReply } from '@/share/dare';
import type { AwardResult, FriendLedger } from './contracts';

const KEY = 'vande:lite-awards';
const V1_KEY = 'vande:lite-helper';
/** Bound for each of the replies, perDare and challenged maps (latest entries kept). */
export const LEDGER_MAX_ENTRIES = 300;

export function emptyLedger(): FriendLedger {
  return {
    v: 2,
    helper: { points: 0, answers: 0, understood: 0, verifiedPoints: 0 },
    challenger: { points: 0, answers: 0, understood: 0 },
    replies: {},
    perDare: {},
    challenged: {},
    day: { date: '', helper: 0, challenger: 0 },
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

function rollDay(l: FriendLedger, now: Date): FriendLedger {
  const date = localDate(now);
  if (l.day.date !== date) l.day = { date, helper: 0, challenger: 0 };
  return l;
}

/** Awards the helper for a friend's reply (pure: returns the next ledger). */
export function awardHelperReply(l: FriendLedger, reply: DareReply, code: string, now: Date = new Date(), verified = false): AwardResult {
  const next = rollDay(sanitizeLedger(l), now);
  const id = replyIdentity(reply, code);
  const amount = helperAmount(reply);
  const understood = amount > FRIEND_POINTS.answer;
  const prev = next.replies[id];
  if (prev !== undefined) {
    if (prev > 0 && amount > prev) {
      const diff = amount - prev;
      next.replies[id] = amount;
      next.helper.points += diff;
      if (understood && prev <= FRIEND_POINTS.answer) next.helper.understood += 1;
      if (verified) next.helper.verifiedPoints += diff;
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
  return { ledger: next, earned: amount, fresh: true, upgraded: false, capped: null };
}

/** Awards the friend (challenger) when they send their result back (pure: returns the next ledger). */
export function awardChallenger(l: FriendLedger, dareKey: string, understood: boolean, now: Date = new Date()): AwardResult {
  const next = rollDay(sanitizeLedger(l), now);
  const amount = FRIEND_POINTS.answer + (understood ? FRIEND_POINTS.understood : 0);
  const prev = next.challenged[dareKey];
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
