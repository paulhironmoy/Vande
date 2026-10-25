/**
 * Twist questions on the friend's device: drawing a twist matched to the dared move's kind, the one-attempt-per-
 * device-per-dare store, and the helper's rematch answers. Everything lives in localStorage `vande:lite-twists`
 * (bounded, every access guarded); when storage is unavailable the store falls back to memory for the session.
 *
 * Stable API used by the Lite screen: TWIST_POOL, twistById, dareIdentity, dareKeyOf, pickTwist, readAttempt,
 * ensureAttempt, recordDareAnswer, drawTwist, assignTwist, answerTwist, markReplied, outcomeOf, plus the rematch
 * helpers ensureRematch, readRematch and answerRematch.
 *
 * Rules (docs/prompts/LITE-INCENTIVES-AND-VISUALS-PROMPT.md, A3–A5):
 * - match the action kind of the dared move's best move; fall back to any kind only when the pool has none of it;
 * - prefer twists this device has not seen; never draw retired twists;
 * - random choice from crypto.getRandomValues (Math.random only as a fallback), options shuffled (Fisher–Yates);
 * - one attempt per device per dare: the nonce, twist and order are created once and never change; the first answer
 *   is kept. The only exception: if a stored twist id no longer exists in the pool at all (content error), a new
 *   twist is drawn so the friend is never stuck;
 * - once a reply for an attempt has been shared (`markReplied`), its nonce never changes: verified dares may hand back
 *   a different server nonce, but adopting it then would make the same friend count twice at the helper.
 */
import pool from '@/content/lite/twists.json';
import { hashString } from '@/engine/prng';
import type { Dare } from '@/share/dare';
import type { Twist, TwistAttempt, TwistKind, TwistOutcome, TwistPool } from './contracts';

export const TWIST_POOL = pool as TwistPool;

const STORE_KEY = 'vande:lite-twists';
const MAX_ATTEMPTS = 200;
const MAX_SEEN = 200;
const MAX_REMATCHES = 200;
const NONCE_RE = /^[0-9a-z]{6}$/;
const NONCE_SPACE = 36 ** 6;

export type DareIdentityInput = Pick<Dare, 'seed' | 'path' | 'step' | 'deadline'>;

/** Full identity of a dare: seed, path, step and deadline. Chain and hint are not part of it. */
export function dareIdentity(d: DareIdentityInput): string {
  return `${(d.seed >>> 0).toString(36)}:${d.path || '~'}:${d.step}:${Math.round(d.deadline).toString(36)}`;
}

/**
 * Short storage key for a dare identity. Prefixed with a letter so it is never an integer-like object key (those
 * would not keep insertion order in the bounded ledger maps).
 */
export function dareKeyOf(d: DareIdentityInput): string {
  return `k${(hashString(dareIdentity(d)) >>> 0).toString(36)}`;
}

export function twistById(id: string): Twist | undefined {
  return TWIST_POOL.twists.find((t) => t.id === id);
}

/** Twists that can still be drawn. */
export function liveTwists(): Twist[] {
  return TWIST_POOL.twists.filter((t) => !t.retired);
}

/** A uniform number in [0, 1) from crypto.getRandomValues, or Math.random when that is unavailable. */
export function secureRandom(): number {
  try {
    const c = globalThis.crypto;
    if (c && typeof c.getRandomValues === 'function') {
      const buf = new Uint32Array(1);
      c.getRandomValues(buf);
      return buf[0] / 0x100000000;
    }
  } catch {
    /* fall back */
  }
  return Math.random();
}

/** Six random base36 characters. */
export function newNonce(random: () => number = secureRandom): string {
  const n = Math.min(NONCE_SPACE - 1, Math.max(0, Math.floor(random() * NONCE_SPACE)));
  return n.toString(36).padStart(6, '0');
}

/** Fisher–Yates shuffle into a new array. */
export function shuffle<T>(items: readonly T[], random: () => number = secureRandom): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Draws a live twist of `kind`, preferring ids not in `seen`. Only when the pool has no live twist of that kind does
 * it draw from every kind (still preferring unseen ones). `random` returns [0, 1).
 */
export function pickTwist(kind: TwistKind, seen: readonly string[], random: () => number = secureRandom): Twist | undefined {
  const live = liveTwists();
  const same = live.filter((t) => t.kind === kind);
  const from = same.length ? same : live;
  if (!from.length) return undefined;
  const seenSet = new Set(seen);
  const fresh = from.filter((t) => !seenSet.has(t.id));
  const choices = fresh.length ? fresh : from;
  return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
}

/** How the friend did on this attempt's twist: 'skipped' until a twist was answered. */
export function outcomeOf(attempt: TwistAttempt | undefined): TwistOutcome {
  return attempt?.outcome ?? 'skipped';
}

// ---------------------------------------------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------------------------------------------

/** The helper's answer to a friend's twist (the rematch), one per reply. */
export interface RematchRecord {
  /** The reply identity, e.g. `${dareKey}#${nonce}` from the ledger's replyIdentity. */
  replyKey: string;
  twistId: string;
  /** Option ids in the shuffled display order. */
  order: string[];
  answer?: string;
  outcome?: 'right' | 'wrong';
  /** Unix ms. */
  createdAt: number;
}

interface TwistStore {
  v: 1;
  attempts: TwistAttempt[];
  /** Twist ids this device has been shown, oldest first. */
  seen: string[];
  rematches: RematchRecord[];
}

let memory: TwistStore | null = null;
let storageFailed = false;

function emptyStore(): TwistStore {
  return { v: 1, attempts: [], seen: [], rematches: [] };
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isOutcome = (v: unknown): v is 'right' | 'wrong' => v === 'right' || v === 'wrong';

function cleanAttempt(raw: unknown): TwistAttempt | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (a.v !== 1 || !isStr(a.dareKey) || typeof a.nonce !== 'string' || !NONCE_RE.test(a.nonce)) return null;
  const out: TwistAttempt = { v: 1, dareKey: a.dareKey, nonce: a.nonce, createdAt: typeof a.createdAt === 'number' && Number.isFinite(a.createdAt) ? a.createdAt : 0 };
  if (a.dare && typeof a.dare === 'object') {
    const d = a.dare as Record<string, unknown>;
    if (typeof d.points === 'number' && Number.isFinite(d.points) && d.points >= 0 && typeof d.best === 'boolean') out.dare = { points: Math.round(d.points), best: d.best };
  }
  if (isStr(a.twistId)) {
    out.twistId = a.twistId;
    if (isStrArr(a.order)) out.order = [...a.order];
    if (isStr(a.answer) && isOutcome(a.outcome)) {
      out.answer = a.answer;
      out.outcome = a.outcome;
    }
  }
  if (a.replied === true) out.replied = true;
  return out;
}

function cleanRematch(raw: unknown): RematchRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isStr(r.replyKey) || !isStr(r.twistId) || !isStrArr(r.order)) return null;
  const out: RematchRecord = { replyKey: r.replyKey, twistId: r.twistId, order: [...r.order], createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : 0 };
  if (isStr(r.answer) && isOutcome(r.outcome)) {
    out.answer = r.answer;
    out.outcome = r.outcome;
  }
  return out;
}

function sanitize(raw: unknown): TwistStore {
  const s = emptyStore();
  if (!raw || typeof raw !== 'object') return s;
  const o = raw as Record<string, unknown>;
  if (Array.isArray(o.attempts)) for (const a of o.attempts) {
    const c = cleanAttempt(a);
    if (c && !s.attempts.some((x) => x.dareKey === c.dareKey)) s.attempts.push(c);
  }
  if (Array.isArray(o.seen)) s.seen = [...new Set(o.seen.filter(isStr))];
  if (Array.isArray(o.rematches)) for (const r of o.rematches) {
    const c = cleanRematch(r);
    if (c && !s.rematches.some((x) => x.replyKey === c.replyKey)) s.rematches.push(c);
  }
  return s;
}

function clone(s: TwistStore): TwistStore {
  return JSON.parse(JSON.stringify(s)) as TwistStore;
}

function readStore(): TwistStore {
  if (storageFailed) return clone(memory ?? emptyStore());
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyStore();
    return sanitize(JSON.parse(raw));
  } catch (e) {
    if (e instanceof SyntaxError) return emptyStore();
    storageFailed = true;
    return clone(memory ?? emptyStore());
  }
}

function writeStore(s: TwistStore): void {
  const bounded: TwistStore = {
    v: 1,
    attempts: s.attempts.slice(-MAX_ATTEMPTS),
    seen: [...new Set(s.seen)].slice(-MAX_SEEN),
    rematches: s.rematches.slice(-MAX_REMATCHES),
  };
  memory = clone(bounded);
  if (storageFailed) return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(bounded));
  } catch {
    storageFailed = true;
  }
}

/** Test hook: forget the in-memory fallback and retry storage (simulates a reload). */
export function __resetTwistStoreForTests(): void {
  memory = null;
  storageFailed = false;
}

function newAttempt(dareKey: string): TwistAttempt {
  return { v: 1, dareKey, nonce: newNonce(), createdAt: Date.now() };
}

/** Twist ids this device has been shown, oldest first. */
export function seenTwists(): string[] {
  return readStore().seen;
}

/** Records that this device has been shown a twist (moves it to the newest end). */
export function markTwistSeen(id: string): void {
  if (!isStr(id)) return;
  const s = readStore();
  s.seen = [...s.seen.filter((x) => x !== id), id];
  writeStore(s);
}

// ---------------------------------------------------------------------------------------------------------------
// Friend attempts
// ---------------------------------------------------------------------------------------------------------------

export function readAttempt(dareKey: string): TwistAttempt | undefined {
  return readStore().attempts.find((a) => a.dareKey === dareKey);
}

/** The device's attempt for a dare, created with a fresh nonce if missing; the same record afterwards. */
export function ensureAttempt(dareKey: string): TwistAttempt {
  const s = readStore();
  const found = s.attempts.find((a) => a.dareKey === dareKey);
  if (found) return found;
  const a = newAttempt(dareKey);
  s.attempts.push(a);
  writeStore(s);
  return a;
}

/**
 * Records the friend's first answer to the dared question; later calls return the stored first answer unchanged
 * (one attempt per device per dare, so a retake after the reveal cannot turn a miss into the best move).
 */
export function recordDareAnswer(dareKey: string, answer: { points: number; best: boolean }): TwistAttempt {
  const s = readStore();
  let a = s.attempts.find((x) => x.dareKey === dareKey);
  if (!a) {
    a = newAttempt(dareKey);
    s.attempts.push(a);
  }
  if (!a.dare) {
    a.dare = { points: Math.max(0, Math.round(answer.points)), best: Boolean(answer.best) };
    writeStore(s);
  }
  return a;
}

/**
 * Draws and stores the twist for this attempt once; later calls return the stored one (also across reloads).
 * Undefined only when the pool has no live twist at all.
 */
export function drawTwist(dareKey: string, kind: TwistKind): TwistAttempt | undefined {
  const s = readStore();
  let a = s.attempts.find((x) => x.dareKey === dareKey);
  if (!a) {
    a = newAttempt(dareKey);
    s.attempts.push(a);
  }
  if (a.twistId && twistById(a.twistId)) {
    if (!a.order) {
      a.order = shuffle(twistById(a.twistId)!.options.map((o) => o.id));
      writeStore(s);
    }
    return a;
  }
  const t = pickTwist(kind, s.seen);
  if (!t) {
    writeStore(s);
    return undefined;
  }
  a.twistId = t.id;
  a.order = shuffle(t.options.map((o) => o.id));
  delete a.answer;
  delete a.outcome;
  s.seen = [...s.seen.filter((id) => id !== t.id), t.id];
  writeStore(s);
  return a;
}

/**
 * Verified dares: stores the server-chosen twist (and the nonce the server keeps for this attempt) once. If a twist
 * was already drawn (for example a local draw after the server timed out), the existing one is kept and returned;
 * the reply is then sent unsigned. Once a reply for the attempt has been shared (`replied`), the nonce is kept as it
 * is, so a reply already in the helper's hands and the next one stay the same friend. Undefined when the id is not
 * a live twist in this build.
 */
export function assignTwist(dareKey: string, twistId: string, nonce?: string): TwistAttempt | undefined {
  const t = twistById(twistId);
  if (!t || t.retired) return undefined;
  const s = readStore();
  let a = s.attempts.find((x) => x.dareKey === dareKey);
  if (!a) {
    a = newAttempt(dareKey);
    s.attempts.push(a);
  }
  if (a.twistId && twistById(a.twistId)) return a;
  if (nonce && NONCE_RE.test(nonce) && !a.replied) a.nonce = nonce;
  a.twistId = t.id;
  a.order = shuffle(t.options.map((o) => o.id));
  delete a.answer;
  delete a.outcome;
  s.seen = [...s.seen.filter((id) => id !== t.id), t.id];
  writeStore(s);
  return a;
}

/**
 * Marks that a reply for this attempt has been shared, once; from then on its nonce never changes. Undefined when the
 * device has no attempt for the dare.
 */
export function markReplied(dareKey: string): TwistAttempt | undefined {
  const s = readStore();
  const a = s.attempts.find((x) => x.dareKey === dareKey);
  if (!a) return undefined;
  if (!a.replied) {
    a.replied = true;
    writeStore(s);
  }
  return a;
}

/** Records the first answer to the attempt's twist; later calls keep it. Unknown option ids are ignored. */
export function answerTwist(dareKey: string, optionId: string): TwistAttempt | undefined {
  const s = readStore();
  const a = s.attempts.find((x) => x.dareKey === dareKey);
  if (!a || !a.twistId) return undefined;
  if (a.answer) return a;
  const t = twistById(a.twistId);
  if (!t || !t.options.some((o) => o.id === optionId)) return a;
  a.answer = optionId;
  a.outcome = optionId === t.best ? 'right' : 'wrong';
  writeStore(s);
  return a;
}

// ---------------------------------------------------------------------------------------------------------------
// Rematch (the helper answers the friend's twist)
// ---------------------------------------------------------------------------------------------------------------

export function readRematch(replyKey: string): RematchRecord | undefined {
  return readStore().rematches.find((r) => r.replyKey === replyKey);
}

/**
 * The helper's rematch record for a reply, created once with a shuffled order (and the twist marked as seen on this
 * device). Undefined when the twist id is unknown.
 */
export function ensureRematch(replyKey: string, twistId: string): RematchRecord | undefined {
  const t = twistById(twistId);
  if (!t) return undefined;
  const s = readStore();
  const found = s.rematches.find((r) => r.replyKey === replyKey);
  if (found && found.twistId === twistId) return found;
  const r: RematchRecord = { replyKey, twistId, order: shuffle(t.options.map((o) => o.id)), createdAt: Date.now() };
  s.rematches = [...s.rematches.filter((x) => x.replyKey !== replyKey), r];
  s.seen = [...s.seen.filter((id) => id !== twistId), twistId];
  writeStore(s);
  return r;
}

/** Records the helper's first rematch answer; later calls keep it. */
export function answerRematch(replyKey: string, optionId: string): RematchRecord | undefined {
  const s = readStore();
  const r = s.rematches.find((x) => x.replyKey === replyKey);
  if (!r) return undefined;
  if (r.answer) return r;
  const t = twistById(r.twistId);
  if (!t || !t.options.some((o) => o.id === optionId)) return r;
  r.answer = optionId;
  r.outcome = optionId === t.best ? 'right' : 'wrong';
  writeStore(s);
  return r;
}
