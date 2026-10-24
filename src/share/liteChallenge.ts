/**
 * Lite friend challenges: a compact, URL-safe code that reproduces the exact Lite run (same seed → same city,
 * same clues, same opponent moves) and carries the score to beat. No backend, no personal data.
 *
 * Format: `L1-<seed base36>-<points base36>-<stars 0–3>-<checksum>` where the checksum is one base36 character of
 * `hashString(body)`. It catches typos and casual edits; it is not a security feature.
 */
import { hashString } from '@/engine/prng';

export interface LiteChallenge {
  seed: number;
  points: number;
  stars: 0 | 1 | 2 | 3;
}

export const LITE_INVITE = 'Beat my score in VANDE — can you keep the city free and safe?';

const PREFIX = 'L1';
const MAX_POINTS = 99999;
const MAX_SEED = 0xffffffff;
const CODE_RE = /^l1-([0-9a-z]{1,7})-([0-9a-z]{1,4})-([0-3])-([0-9a-z])$/;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function checksum(body: string): string {
  return (hashString(body) % 36).toString(36);
}

function bodyOf(seed36: string, points36: string, stars: string): string {
  return `${PREFIX}-${seed36}-${points36}-${stars}`;
}

/** Builds the code. Seeds are taken as unsigned 32-bit; points are clamped to 0–99,999 and stars to 0–3. */
export function encodeLiteChallenge(c: LiteChallenge): string {
  const seed36 = (c.seed >>> 0).toString(36);
  const points36 = clampInt(c.points, 0, MAX_POINTS).toString(36);
  const stars = String(clampInt(c.stars, 0, 3));
  const body = bodyOf(seed36, points36, stars);
  return `${body}-${checksum(body)}`;
}

/** Pulls the code out of a pasted value: a bare code or any URL containing `/lite/<code>`. */
function extractCode(input: string): string {
  const trimmed = input.trim();
  const fromPath = /\/lite\/([^/?#\s]+)/i.exec(trimmed);
  let raw = fromPath ? fromPath[1] : trimmed;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* keep the raw value; validation below rejects anything malformed */
  }
  return raw.trim().toLowerCase();
}

/**
 * Parses a code (or a link containing one). Returns null for anything malformed, out of range, non-canonical
 * (for example a padded number) or failing the checksum. Case and surrounding whitespace are ignored.
 */
export function decodeLiteChallenge(input: string): LiteChallenge | null {
  if (typeof input !== 'string' || !input.trim()) return null;
  const m = CODE_RE.exec(extractCode(input));
  if (!m) return null;
  const [, seed36, points36, starsRaw, chk] = m;
  const seed = parseInt(seed36, 36);
  const points = parseInt(points36, 36);
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED || seed.toString(36) !== seed36) return null;
  if (!Number.isInteger(points) || points < 0 || points > MAX_POINTS || points.toString(36) !== points36) return null;
  const stars = Number(starsRaw);
  if (!Number.isInteger(stars) || stars < 0 || stars > 3) return null;
  if (checksum(bodyOf(seed36, points36, starsRaw)) !== chk) return null;
  return { seed, points, stars: stars as LiteChallenge['stars'] };
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

/** Shareable link that opens the same Lite run: `${origin}${BASE_URL}lite/${code}`. */
export function liteChallengeUrl(code: string, origin?: string): string {
  const o = (origin ?? (typeof location !== 'undefined' ? location.origin : '')).replace(/\/+$/, '');
  return `${o}${basePath()}lite/${encodeURIComponent(code)}`;
}

function starString(stars: number): string {
  const n = clampInt(stars, 0, 3);
  return `${'★'.repeat(n)}${'☆'.repeat(3 - n)}`;
}

/** Two short lines for the share text (the link is added separately by the caller). */
export function liteShareText(input: { points: number; stars: number; outcomeLabel: string; beatFriend?: boolean }): string {
  const points = clampInt(input.points, 0, MAX_POINTS).toLocaleString('en-US');
  const lead = input.beatFriend ? 'Challenge beaten! ' : '';
  return `${lead}${points} points ${starString(input.stars)} · ${input.outcomeLabel}\n${LITE_INVITE}`;
}
