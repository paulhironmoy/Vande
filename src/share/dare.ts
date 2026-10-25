/**
 * Lite "dare" links: the ice-bucket loop. A player answers one move, then dares friends to take the same move in the
 * same city before the sender's next local midnight. The code carries everything needed to replay up to that move
 * (seed + replay path), the sender's points on it, whether they found the best move, the deadline and the chain
 * position. No backend, no personal data.
 *
 * Format (URL-path-safe, unreserved characters only):
 *   `I1_<seed36>_<path or ~>_<step>_<points36>_<0|1>_<deadline36>_<chain36>[_h<hint>]_<chk>`
 * where `chk` is two base36 characters of `hashString(body)`. The optional `h<0-2>` field carries a hint; codes
 * without it (the original form) still decode. Reply links use the same dare fields behind an `R1` prefix, followed by
 * the friend's points and best-move flag and their own checksum:
 *   `R1_<dare fields>[_h<hint>]_<friendPoints36>_<0|1>_<chk>`
 * The checksums catch typos and casual edits; they are not a security feature.
 */
import { hashString } from '@/engine/prng';

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

/** Builds a reply code: the embedded dare's fields, then the friend's points and best-move flag, with its own checksum. */
export function encodeDareReply(r: DareReply): string {
  const body = [REPLY_PREFIX, ...fieldsOf(partsOf(r.dare)), clampInt(r.points, 0, MAX_POINTS).toString(36), r.best ? '1' : '0'].join('_');
  return `${body}_${checksum(body)}`;
}

/** Parses a reply code (or any URL containing `/lite/reply/<code>`); null when malformed or tampered. */
export function decodeDareReply(input: string): DareReply | null {
  if (typeof input !== 'string' || !input.trim()) return null;
  const m = REPLY_RE.exec(extractCode(input, 'reply'));
  if (!m) return null;
  const parsed = dareFrom(m.slice(1, 9));
  if (!parsed) return null;
  const [friend36, friendBest, chk] = [m[9], m[10], m[11]];
  const points = b36(friend36, 0, MAX_POINTS);
  if (points === null) return null;
  const body = [REPLY_PREFIX, ...fieldsOf(parsed.parts), friend36, friendBest].join('_');
  if (checksum(body) !== chk) return null;
  return { dare: parsed.dare, points, best: friendBest === '1' };
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

/** One or two short sentences for the reply (the link is added separately by the caller). */
export function dareReplyText(input: { points: number; best: boolean; senderPoints: number; moveNumber: number }): string {
  const move = clampInt(input.moveNumber, 1, 999);
  const mine = clampInt(input.points, 0, MAX_POINTS);
  const theirs = clampInt(input.senderPoints, 0, MAX_POINTS);
  const fmt = (n: number) => `+${n.toLocaleString('en-US')}`;
  const score = theirs > 0 ? `${fmt(mine)} vs your ${fmt(theirs)}` : fmt(mine);
  const best = input.best ? ' I found the best move.' : '';
  return `I took your dare on move ${move}: ${score}.${best}`;
}
