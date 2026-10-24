/**
 * Spoiler-free strategy fingerprint: one glyph per decision, in order. The letters come from the engine
 * (`computeFingerprint`); this module only knows how to show and describe them. Nothing here reveals which
 * decision was taken or what the options said.
 */
import type { FingerprintCode } from '@/engine/types';

export const FINGERPRINT_CODES: readonly FingerprintCode[] = ['D', 'E', 'S', 'P', 'X', 'W'] as const;
export const FINGERPRINT_MAX = 12;
export const FINGERPRINT_RE = /^[DESPXW]{1,12}$/;

export type GlyphShape = 'diamond' | 'circle' | 'square' | 'triangle' | 'cross' | 'ring';
export type StrategyClass = 'restraint' | 'mixed' | 'force' | 'passive';

export interface GlyphMeta {
  code: FingerprintCode;
  shape: GlyphShape;
  /** Text fallback only (alt text, plain-text shares). */
  unicode: string;
  full: string;
  simple: string;
  color: string;
}

export const GLYPHS: Record<FingerprintCode, GlyphMeta> = {
  D: { code: 'D', shape: 'diamond', unicode: '◆', full: 'dialogue', simple: 'talked', color: '#62d6ff' },
  E: { code: 'E', shape: 'circle', unicode: '●', full: 'evidence', simple: 'checked clues', color: '#38a0ff' },
  S: { code: 'S', shape: 'square', unicode: '■', full: 'support', simple: 'helped people', color: '#2ed3c4' },
  P: { code: 'P', shape: 'triangle', unicode: '▲', full: 'lawful force', simple: 'fair action', color: '#7b8cff' },
  X: { code: 'X', shape: 'cross', unicode: '✕', full: 'harsh action', simple: 'too harsh', color: '#e0405a' },
  W: { code: 'W', shape: 'ring', unicode: '○', full: 'waited', simple: 'waited', color: '#aab6c8' },
};

export function isValidFingerprint(fp: unknown): fp is string {
  return typeof fp === 'string' && FINGERPRINT_RE.test(fp);
}

/** Keeps only known letters (upper-cased), capped at FINGERPRINT_MAX. */
export function parseFingerprint(fp: string | undefined | null): FingerprintCode[] {
  if (!fp) return [];
  const out: FingerprintCode[] = [];
  for (const ch of fp.toUpperCase()) {
    if ((FINGERPRINT_CODES as readonly string[]).includes(ch)) out.push(ch as FingerprintCode);
    if (out.length >= FINGERPRINT_MAX) break;
  }
  return out;
}

export function fingerprintToUnicode(fp: string): string {
  return parseFingerprint(fp)
    .map((c) => GLYPHS[c].unicode)
    .join(' ');
}

/** Broad strategy class used for community mixes. Mirrors backend/src/stats.ts. */
export function strategyClass(fp: string): StrategyClass {
  const codes = parseFingerprint(fp);
  if (codes.length === 0) return 'mixed';
  if (codes.includes('X')) return 'force';
  const waited = codes.filter((c) => c === 'W').length;
  if (waited * 2 >= codes.length) return 'passive';
  const restraint = codes.filter((c) => c === 'D' || c === 'E' || c === 'S').length;
  if (restraint / codes.length >= 0.6) return 'restraint';
  return 'mixed';
}

export const STRATEGY_LABELS: Record<StrategyClass, { full: string; simple: string }> = {
  restraint: { full: 'Dialogue, evidence and support', simple: 'Talked, checked, helped' },
  mixed: { full: 'Mixed approach', simple: 'A bit of everything' },
  force: { full: 'Used harsh measures', simple: 'Went harsh at least once' },
  passive: { full: 'Mostly waited', simple: 'Mostly waited' },
};

/** Short, non-spoiler summary such as "4 moves: dialogue, evidence, support, waited". */
export function fingerprintSummary(fp: string, simple = false): string {
  const codes = parseFingerprint(fp);
  if (codes.length === 0) return simple ? 'No moves recorded' : 'No decisions recorded';
  const words = codes.map((c) => (simple ? GLYPHS[c].simple : GLYPHS[c].full));
  return `${codes.length} ${simple ? (codes.length === 1 ? 'move' : 'moves') : codes.length === 1 ? 'decision' : 'decisions'}: ${words.join(', ')}`;
}

/** Accessible text for the glyph row and for share payloads. */
export function fingerprintAlt(fp: string, outcomeLabel: string, score?: number, simple = false): string {
  const pattern = fingerprintToUnicode(fp);
  const summary = fingerprintSummary(fp, simple);
  const scorePart = score !== undefined ? `, score ${Math.round(score)} out of 100` : '';
  return `${simple ? 'Your pattern' : 'Strategy pattern'} ${pattern || '—'} (${summary}). ${simple ? 'Result' : 'Outcome'}: ${outcomeLabel}${scorePart}.`;
}

/** Draws one glyph on a 2D canvas, centred at (cx, cy), fitting a box of `size`. */
export function drawGlyph(ctx: CanvasRenderingContext2D, code: FingerprintCode, cx: number, cy: number, size: number, color = GLYPHS[code].color): void {
  const r = size / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (GLYPHS[code].shape) {
    case 'diamond':
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r, 0);
      ctx.closePath();
      ctx.fill();
      break;
    case 'circle':
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.92, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'square':
      ctx.beginPath();
      ctx.rect(-r * 0.82, -r * 0.82, r * 1.64, r * 1.64);
      ctx.fill();
      break;
    case 'triangle':
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.95, r * 0.75);
      ctx.lineTo(-r * 0.95, r * 0.75);
      ctx.closePath();
      ctx.fill();
      break;
    case 'cross':
      ctx.lineWidth = Math.max(2, size * 0.2);
      ctx.beginPath();
      ctx.moveTo(-r * 0.72, -r * 0.72);
      ctx.lineTo(r * 0.72, r * 0.72);
      ctx.moveTo(r * 0.72, -r * 0.72);
      ctx.lineTo(-r * 0.72, r * 0.72);
      ctx.stroke();
      break;
    case 'ring':
      ctx.lineWidth = Math.max(2, size * 0.16);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.74, 0, Math.PI * 2);
      ctx.stroke();
      break;
  }
  ctx.restore();
}
