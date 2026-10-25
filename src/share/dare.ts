/**
 * Lite "dare" links: the ice-bucket loop. A player answers one move, then dares friends to take the same move in the
 * same city before the sender's next local midnight. The code carries everything needed to replay up to that move
 * (seed + replay path), the sender's points on it, whether they found the best move, the deadline and the chain
 * position. No backend, no personal data.
 *
 * Format (URL-path-safe, unreserved characters only):
 *   `I1_<seed36>_<path or ~>_<step>_<points36>_<0|1>_<deadline36>_<chain36>[_h<hint>]_<chk>`
 * where `chk` is two base36 characters of `hashString(body)`. The optional `h<0-2>` field carries a hint; codes
 * without it (the original form) still decode.
 *
 * Reply links use the same dare fields. The original R1 form carries the friend's points and best-move flag:
 *   `R1_<dare fields>[_h<hint>]_<friendPoints36>_<0|1>_<chk>`
 * R2 (current) adds the twist, a per-attempt nonce and the rematch deadline:
 *   `R2_<dare fields>[_h<hint>]_<friendPoints36>_<0|1>_<twist36 or ~>_<r|w|s>_<nonce>_<rematchDeadline36>_<chk>[_x<sig>]`
 *   - twist36: the twist number n of twist id `t<n>` (n = 1..1295) in base36, or `~` when no twist was taken
 *   - r|w|s: twist right, wrong (not quite) or skipped; `s` if and only if the twist field is `~`
 *   - nonce: exactly six base36 characters, random per friend attempt, so identical answers stay distinct replies
 *   - rematchDeadline36: unix seconds when the rematch ends (the friend's next local midnight when they replied)
 *   - `_x<sig>`: reserved for verified dares (wave 2). It follows the checksum and is not covered by it. Codes are
 *     case-insensitive (decoding lowercases), so the signature must use a lowercase alphabet such as hex
 *     (16–256 characters). It is decoded into `reply.sig` but not verified here.
 * The checksums catch typos and casual edits; they are not a security feature.
 */
import { hashString } from '@/engine/prng';
import type { TwistOutcome } from '@/lite/contracts';

export interface Dare {
  /** Run seed (uint32). */
  seed: number;
  /**
   * Replay path to reach the dared question: tokens joined by '.', each `d<i>-<o>` (decision index, option index),
   * `e<i>` (scan evidence index) or `r<i>-<o>` (rights moment index, option index). May be empty. ≤ 400 chars.
   */
  path: string;
  /** The dared question: `d<i>` or `r<i>`. */
  step: string;
  /** Points the sender scored on this move (0..9999). */
  points: number;
  /** The sender found the best move. */
  best: boolean;
  /** Unix seconds when the dare ends (the sender's next local midnight). */
  deadline: number;
  /** 1 for the first dare; +1 each time it is passed on (1..99). */
  chain: number;
  /** Optional hint the sender attached: an index into DARE_HINTS. */
  hint?: 0 | 1 | 2;
}

/** Hints a sender may attach to a dare (indexes are encoded in the link, so the order must never change). */
export const DARE_HINTS = ['Think about who gets hurt.', 'Check the clue before you act.', 'Fair beats fast.'] as const;

/** The friend's answer to a dare, sent back so the sender learns how they did. */
export interface DareReply {
  dare: Dare;
  /** Friend's points on the move (0..9999). */
  points: number;
  /** The friend found the best move. */
  best: boolean;
  /** 1 = an R1 code (no twist), 2 = an R2 code. Absent means 1. */
  version?: 1 | 2;
  /** R2: the twist the friend got (also the rematch question). */
  twistId?: string;
  /** R2: how the friend did on the twist. */
  twist?: TwistOutcome;
  /** R2: per-attempt random nonce that makes this friend's reply unique. */
  nonce?: string;
  /** R2: unix seconds when the rematch ends (the friend's next local midnight when they replied). */
  rematchDeadline?: number;
  /** R2 + verified dares: base64url signature over the reply (wave 2). */
  sig?: string;
}

const PREFIX = 'I1';
const MAX_SEED = 0xffffffff;
const MAX_POINTS = 9999;
const MAX_CHAIN = 99;
const MAX_PATH = 400;
/** Deadlines are unix seconds; anything outside 2001…2106 is not a real deadline. */
const MIN_DEADLINE = 1_000_000_000;
const MAX_DEADLINE = 0xffffffff;

const IDX = '(?:0|[1-9]\\d?)';
const TOKEN = `(?:d${IDX}-${IDX}|e${IDX}|r${IDX}-${IDX})`;
const PATH_RE = new RegExp(`^(?:${TOKEN}(?:\\.${TOKEN})*)?$`);
const STEP_RE = new RegExp(`^[dr]${IDX}$`);
const B36 = '[0-9a-z]{1,7}';
/** Dare fields shared by dare and reply codes: seed, path, step, points, best, deadline, chain, optional hint. */
const DARE_FIELDS = `(${B36})_(~|[a-z0-9.-]{1,${MAX_PATH}})_([dr]${IDX})_(${B36})_([01])_(${B36})_(${B36})(?:_h([0-9]))?`;
const CODE_RE = new RegExp(`^i1_${DARE_FIELDS}_([0-9a-z]{2})$`);
const REPLY_RE = new RegExp(`^r1_${DARE_FIELDS}_(${B36})_([01])_([0-9a-z]{2})$`);
const REPLY_PREFIX = 'R1';
const REPLY2_RE = new RegExp(`^r2_${DARE_FIELDS}_(${B36})_([01])_(~|[0-9a-z]{1,2})_([rws])_([0-9a-z]{6})_(${B36})_([0-9a-z]{2})(?:_x([0-9a-z]{16,256}))?$`);
const REPLY2_PREFIX = 'R2';
/** Twist ids are `t<n>`, n = 1..1295, so the number fits two base36 characters. */
const MAX_TWIST = 1295;
const TWIST_ID_RE = /^t([1-9]\d{0,3})$/;
const NONCE_RE = /^[0-9a-z]{6}$/;
const SIG_RE = /^[0-9a-z]{16,256}$/;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function checksum(body: string): string {
  return (hashString(body) % 1296).toString(36).padStart(2, '0');
}

interface DareParts {
  seed36: string;
  path: string;
  step: string;
  points36: string;
  best: string;
  deadline36: string;
  chain36: string;
  /** '' when absent, otherwise a single digit. */
  hint: string;
}

function fieldsOf(parts: DareParts): string[] {
  const fields = [parts.seed36, parts.path || '~', parts.step, parts.points36, parts.best, parts.deadline36, parts.chain36];
  if (parts.hint) fields.push(`h${parts.hint}`);
  return fields;
}

function bodyOf(parts: DareParts): string {
  return [PREFIX, ...fieldsOf(parts)].join('_');
}

function isHint(value: unknown): value is 0 | 1 | 2 {
  return value === 0 || value === 1 || value === 2;
}

/** True when `path` follows the replay grammar (empty is valid). */
export function isDarePath(path: string): boolean {
  return typeof path === 'string' && path.length <= MAX_PATH && PATH_RE.test(path);
}

/**
 * Builds the code. Numbers are normalised (seed as uint32, points 0–9999, chain 1–99, deadline as whole seconds).
 * The path and step are structural and must follow the grammar; a malformed one throws a RangeError so a broken
 * link can never be shared.
 */
function partsOf(d: Dare): DareParts {
  const path = (d.path ?? '').toLowerCase();
  const step = (d.step ?? '').toLowerCase();
  if (!isDarePath(path)) throw new RangeError(`Invalid dare path '${d.path}'`);
  if (!STEP_RE.test(step)) throw new RangeError(`Invalid dare step '${d.step}'`);
  if (d.hint !== undefined && !isHint(d.hint)) throw new RangeError(`Invalid dare hint '${String(d.hint)}'`);
  return {
    seed36: (d.seed >>> 0).toString(36),
    path,
    step,
    points36: clampInt(d.points, 0, MAX_POINTS).toString(36),
    best: d.best ? '1' : '0',
    deadline36: clampInt(d.deadline, MIN_DEADLINE, MAX_DEADLINE).toString(36),
    chain36: clampInt(d.chain, 1, MAX_CHAIN).toString(36),
    hint: d.hint === undefined ? '' : String(d.hint),
  };
}

export function encodeDare(d: Dare): string {
  const body = bodyOf(partsOf(d));
  return `${body}_${checksum(body)}`;
}

/** Pulls the code out of a pasted value: a bare code or any URL containing `/lite/dare/<code>`. */
function extractCode(input: string, kind: 'dare' | 'reply' = 'dare'): string {
  const trimmed = input.trim();
  const fromPath = (kind === 'dare' ? /\/lite\/dare\/([^/?#\s]+)/i : /\/lite\/reply\/([^/?#\s]+)/i).exec(trimmed);
  let raw = fromPath ? fromPath[1] : trimmed;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* keep the raw value; validation rejects anything malformed */
  }
  return raw.trim().toLowerCase();
}

/** Parses a base36 field that must be canonical (no padding) and within [min, max]. */
function b36(raw: string, min: number, max: number): number | null {
  const n = parseInt(raw, 36);
  if (!Number.isInteger(n) || n < min || n > max || n.toString(36) !== raw) return null;
  return n;
}

/**
 * Parses a dare code (or a link containing one). Returns null for anything malformed, out of range, non-canonical
 * or failing the checksum. Case and surrounding whitespace are ignored.
 */
/** Validates the dare fields captured by DARE_FIELDS (in order) and returns the parts and the dare, or null. */
function dareFrom(g: string[]): { parts: DareParts; dare: Dare } | null {
  const [seed36, pathRaw, step, points36, bestRaw, deadline36, chain36, hintRaw] = g;
  const path = pathRaw === '~' ? '' : pathRaw;
  if (!isDarePath(path)) return null;
  const seed = b36(seed36, 0, MAX_SEED);
  const points = b36(points36, 0, MAX_POINTS);
  const deadline = b36(deadline36, MIN_DEADLINE, MAX_DEADLINE);
  const chain = b36(chain36, 1, MAX_CHAIN);
  if (seed === null || points === null || deadline === null || chain === null) return null;
  let hint: Dare['hint'];
  if (hintRaw !== undefined) {
    const h = Number(hintRaw);
    if (!isHint(h)) return null;
    hint = h;
  }
  const parts: DareParts = { seed36, path, step, points36, best: bestRaw, deadline36, chain36, hint: hintRaw ?? '' };
  const dare: Dare = { seed, path, step, points, best: bestRaw === '1', deadline, chain };
  if (hint !== undefined) dare.hint = hint;
  return { parts, dare };
}

export function decodeDare(input: string): Dare | null {
  if (typeof input !== 'string' || !input.trim()) return null;
  const m = CODE_RE.exec(extractCode(input, 'dare'));
  if (!m) return null;
  const parsed = dareFrom(m.slice(1, 9));
  if (!parsed) return null;
  if (checksum(bodyOf(parsed.parts)) !== m[9]) return null;
  return parsed.dare;
}

/** The number n of a twist id `t<n>` (1..1295), or null for anything else. */
export function twistNumberOf(id: string | undefined): number | null {
  if (typeof id !== 'string') return null;
  const m = TWIST_ID_RE.exec(id);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= MAX_TWIST ? n : null;
}

/**
 * Builds a reply code. With a `nonce` it writes the current R2 form (and then requires a valid `rematchDeadline`, a
 * twist outcome, and a valid `twistId` when the outcome is right or wrong); without one it writes the original R1
 * form, kept for compatibility. Malformed R2 fields throw a RangeError so a broken link can never be shared.
 */
export function encodeDareReply(r: DareReply): string {
  const dareFields = fieldsOf(partsOf(r.dare));
  const friend36 = clampInt(r.points, 0, MAX_POINTS).toString(36);
  const bestFlag = r.best ? '1' : '0';
  if (r.nonce === undefined) {
    const body = [REPLY_PREFIX, ...dareFields, friend36, bestFlag].join('_');
    return `${body}_${checksum(body)}`;
  }
  const nonce = String(r.nonce).toLowerCase();
  if (!NONCE_RE.test(nonce)) throw new RangeError(`Invalid reply nonce '${r.nonce}'`);
  const rematch = r.rematchDeadline;
  if (typeof rematch !== 'number' || !Number.isFinite(rematch) || Math.round(rematch) < MIN_DEADLINE || Math.round(rematch) > MAX_DEADLINE) {
    throw new RangeError(`Invalid rematch deadline '${String(rematch)}'`);
  }
  const outcome = r.twist ?? (r.twistId === undefined ? 'skipped' : undefined);
  let twistField = '~';
  let outcomeChar = 's';
  if (outcome === 'right' || outcome === 'wrong') {
    const n = twistNumberOf(r.twistId);
    if (n === null) throw new RangeError(`Invalid twist id '${String(r.twistId)}'`);
    twistField = n.toString(36);
    outcomeChar = outcome === 'right' ? 'r' : 'w';
  } else if (outcome !== 'skipped') {
    throw new RangeError(`Invalid twist outcome '${String(r.twist)}'`);
  }
  const body = [REPLY2_PREFIX, ...dareFields, friend36, bestFlag, twistField, outcomeChar, nonce, Math.round(rematch).toString(36)].join('_');
  let code = `${body}_${checksum(body)}`;
  if (r.sig !== undefined) {
    const sig = String(r.sig).toLowerCase();
    if (!SIG_RE.test(sig)) throw new RangeError('Invalid reply signature');
    code += `_x${sig}`;
  }
  return code;
}

/** Parses an R2 reply code that has already been extracted and lowercased; null when malformed or tampered. */
function decodeReplyV2(code: string): DareReply | null {
  const m = REPLY2_RE.exec(code);
  if (!m) return null;
  const parsed = dareFrom(m.slice(1, 9));
  if (!parsed) return null;
  const [friend36, friendBest, twistRaw, outcomeRaw, nonce, rematch36, chk, sig] = m.slice(9, 17);
  const points = b36(friend36, 0, MAX_POINTS);
  const rematchDeadline = b36(rematch36, MIN_DEADLINE, MAX_DEADLINE);
  if (points === null || rematchDeadline === null) return null;
  // `s` (skipped) if and only if no twist is named.
  if ((twistRaw === '~') !== (outcomeRaw === 's')) return null;
  let twistNumber: number | null = null;
  if (twistRaw !== '~') {
    twistNumber = b36(twistRaw, 1, MAX_TWIST);
    if (twistNumber === null) return null;
  }
  const body = [REPLY2_PREFIX, ...fieldsOf(parsed.parts), friend36, friendBest, twistRaw, outcomeRaw, nonce, rematch36].join('_');
  if (checksum(body) !== chk) return null;
  const reply: DareReply = {
    dare: parsed.dare,
    points,
    best: friendBest === '1',
    version: 2,
    twist: outcomeRaw === 'r' ? 'right' : outcomeRaw === 'w' ? 'wrong' : 'skipped',
    nonce,
    rematchDeadline,
  };
  if (twistNumber !== null) reply.twistId = `t${twistNumber}`;
  if (sig !== undefined) reply.sig = sig;
  return reply;
}

/**
 * Parses a reply code (or any URL containing `/lite/reply/<code>`): R2 (version 2, with the twist, nonce and
 * rematch deadline) or the original R1 (version 1). Null when malformed or tampered.
 */
export function decodeDareReply(input: string): DareReply | null {
  if (typeof input !== 'string' || !input.trim()) return null;
  const code = extractCode(input, 'reply');
  if (code.startsWith('r2_')) return decodeReplyV2(code);
  const m = REPLY_RE.exec(code);
  if (!m) return null;
  const parsed = dareFrom(m.slice(1, 9));
  if (!parsed) return null;
  const [friend36, friendBest, chk] = [m[9], m[10], m[11]];
  const points = b36(friend36, 0, MAX_POINTS);
  if (points === null) return null;
  const body = [REPLY_PREFIX, ...fieldsOf(parsed.parts), friend36, friendBest].join('_');
  if (checksum(body) !== chk) return null;
  return { dare: parsed.dare, points, best: friendBest === '1', version: 1 };
}

function basePath(): string {
  let base = '/';
  try {
    base = (import.meta.env?.BASE_URL as string | undefined) || '/';
  } catch {
    base = '/';
  }
  if (!base.startsWith('/')) base = `/${base}`;
  if (!base.endsWith('/')) base = `${base}/`;
  return base;
}

/** Shareable link that opens the dare: `${origin}${BASE_URL}lite/dare/${code}`. */
export function dareUrl(code: string, origin?: string): string {
  const o = (origin ?? (typeof location !== 'undefined' ? location.origin : '')).replace(/\/+$/, '');
  return `${o}${basePath()}lite/dare/${encodeURIComponent(code)}`;
}

/** Link the friend sends back: `${origin}${BASE_URL}lite/reply/${code}`. */
export function dareReplyUrl(code: string, origin?: string): string {
  const o = (origin ?? (typeof location !== 'undefined' ? location.origin : '')).replace(/\/+$/, '');
  return `${o}${basePath()}lite/reply/${encodeURIComponent(code)}`;
}

/** Unix seconds of the coming local midnight. Called exactly at 00:00, it returns the following day's midnight. */
export function nextLocalMidnight(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.floor(next.getTime() / 1000);
}

/** Remaining time until `deadline` (unix seconds): '5h 12m', '12m 30s', '45s' or 'Ended'. */
export function dareTimeLeft(deadline: number, nowMs: number = Date.now()): { ms: number; expired: boolean; label: string } {
  const ms = Math.max(0, deadline * 1000 - nowMs);
  if (ms <= 0) return { ms: 0, expired: true, label: 'Ended' };
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const label = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  return { ms, expired: false, label };
}

/** Two or three short lines for the share text (the link is added separately by the caller). */
export function dareShareText(input: { moveNumber: number; points: number; best: boolean; chain: number; chapterTitle: string }): string {
  const move = clampInt(input.moveNumber, 1, 999);
  const points = clampInt(input.points, 0, MAX_POINTS);
  const scored = points > 0 ? (input.best ? ` and found the best move: +${points.toLocaleString('en-US')}` : ` and scored +${points.toLocaleString('en-US')}`) : '';
  const lines = [`I took move ${move} of ${input.chapterTitle}${scored}.`, 'Your turn, before midnight. Then dare 3 friends.'];
  const chain = clampInt(input.chain, 1, MAX_CHAIN);
  if (chain > 1) lines.push(`You're #${chain} in this dare chain.`);
  return lines.join('\n');
}

/**
 * A few short sentences for the reply (the link is added separately by the caller). With a twist taken (right or
 * wrong) it also names the twist and invites the sender to the rematch; a skipped twist adds neither.
 */
export function dareReplyText(input: { points: number; best: boolean; senderPoints: number; moveNumber: number; twist?: TwistOutcome }): string {
  const move = clampInt(input.moveNumber, 1, 999);
  const mine = clampInt(input.points, 0, MAX_POINTS);
  const theirs = clampInt(input.senderPoints, 0, MAX_POINTS);
  const fmt = (n: number) => `+${n.toLocaleString('en-US')}`;
  const score = theirs > 0 ? `${fmt(mine)} vs your ${fmt(theirs)}` : fmt(mine);
  const tookTwist = input.twist === 'right' || input.twist === 'wrong';
  // The twist outcome is never in the message: it stays hidden until the friend answers the rematch.
  const found = `${input.best ? ' I found the best move.' : ''}${tookTwist ? ' I took a twist too.' : ''}`;
  const rematch = tookTwist ? ' Your turn: try my twist before midnight.' : '';
  return `I took your dare on move ${move}: ${score}.${found}${rematch}`;
}
