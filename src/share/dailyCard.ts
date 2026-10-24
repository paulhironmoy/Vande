/**
 * Spoiler-free daily share card, drawn locally with Canvas 2D (no server, no network).
 * Shows: VANDE identity, the daily date, the glyph pattern, the outcome word, the official score (or a broad band for
 * practice), an invitation and the challenge link. Never any decision text.
 */
import type { DailyAttemptResult, DailyId, FingerprintCode, RepublicOutcome, ScoreBand } from '@/engine/types';
import { OUTCOME_LABELS } from '@/engine/types';
import { SIMPLE_OUTCOMES } from '@/app/simple';
import { APP_NAME, C, DISCLAIMER, challengeUrl, drawBackground, drawMark, font, roundRect, scoreColor } from './resultCard';
import { GLYPHS, drawGlyph, fingerprintAlt, fingerprintToUnicode, parseFingerprint } from './fingerprint';

export const DAILY_INVITATION = 'Can you hold the Republic together today?';

export type DailyCardSize = 'landscape' | 'square';

export const DAILY_CARD_DIMENSIONS: Record<DailyCardSize, { width: number; height: number }> = {
  landscape: { width: 1200, height: 630 },
  square: { width: 1080, height: 1080 },
};

export interface DailyCardInput {
  dailyId: DailyId;
  result: DailyAttemptResult;
  /** Official first attempt (score shown) or practice (band shown). */
  official: boolean;
  /** Daily challenge code (see encodeDailyChallenge). */
  code: string;
  origin: string;
  base?: string;
  simple?: boolean;
}

export interface DailyCardModel {
  appName: string;
  wordmark: string;
  subtitle: string;
  dailyId: DailyId;
  dateLabel: string;
  fingerprint: string;
  codes: FingerprintCode[];
  outcome: RepublicOutcome;
  outcomeLabel: string;
  score: number;
  band: ScoreBand;
  official: boolean;
  /** "Official result" / "Practice" wording. */
  attemptLabel: string;
  code: string;
  url: string;
  invitation: string;
  disclaimer: string;
  alt: string;
  simple: boolean;
}

export function scoreBandOf(score: number): ScoreBand {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  if (s >= 85) return '85-100';
  if (s >= 70) return '70-84';
  if (s >= 55) return '55-69';
  if (s >= 40) return '40-54';
  return '0-39';
}

export function dailyDateLabel(dailyId: DailyId): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dailyId);
  if (!m) return dailyId;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return dailyId;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function buildDailyCardModel(input: DailyCardInput): DailyCardModel {
  const simple = input.simple === true;
  const outcomeLabel = simple ? (SIMPLE_OUTCOMES[input.result.outcome]?.label ?? OUTCOME_LABELS[input.result.outcome]) : OUTCOME_LABELS[input.result.outcome];
  const score = Math.max(0, Math.min(100, Math.round(input.result.score)));
  const band = scoreBandOf(score);
  const fingerprint = parseFingerprint(input.result.fingerprint).join('');
  const attemptLabel = input.official ? (simple ? 'Official result' : 'Official result') : simple ? 'Practice' : 'Practice run';
  return {
    appName: APP_NAME,
    wordmark: 'VANDE',
    subtitle: 'DAILY CRISIS',
    dailyId: input.dailyId,
    dateLabel: dailyDateLabel(input.dailyId),
    fingerprint,
    codes: parseFingerprint(fingerprint),
    outcome: input.result.outcome,
    outcomeLabel,
    score,
    band,
    official: input.official,
    attemptLabel,
    code: input.code,
    url: challengeUrl(input.code, input.origin, input.base ?? '/'),
    invitation: DAILY_INVITATION,
    disclaimer: DISCLAIMER,
    alt: fingerprintAlt(fingerprint, outcomeLabel, input.official ? score : undefined, simple),
    simple,
  };
}

/** Plain-text share body: invitation, date, pattern, link. Spoiler-free. */
export function dailyShareText(model: DailyCardModel): string {
  const scoreLine = model.official ? `${model.outcomeLabel} · ${model.score}/100` : `${model.outcomeLabel} · practice ${model.band}`;
  return `${model.invitation}\nVANDE daily crisis · ${model.dateLabel}\n${fingerprintToUnicode(model.fingerprint) || '—'} · ${scoreLine}\n${model.url}`;
}

export function dailyFileName(model: DailyCardModel, size: DailyCardSize): string {
  return `vande-daily-${model.dailyId}${size === 'square' ? '-square' : ''}.png`;
}

function drawGlyphRow(ctx: CanvasRenderingContext2D, codes: FingerprintCode[], x: number, y: number, maxWidth: number, size: number): number {
  const n = Math.max(1, codes.length);
  const gap = size * 0.55;
  let glyph = size;
  if (n * glyph + (n - 1) * gap > maxWidth) glyph = Math.max(size * 0.45, (maxWidth - (n - 1) * gap) / n);
  const total = n * glyph + (n - 1) * gap;
  const startX = x + (maxWidth - total) / 2;
  if (codes.length === 0) {
    ctx.save();
    ctx.fillStyle = C.muted;
    ctx.font = font(560, size * 0.6);
    ctx.textAlign = 'center';
    ctx.fillText('—', x + maxWidth / 2, y + glyph * 0.7);
    ctx.restore();
    return glyph;
  }
  codes.forEach((code, i) => {
    const cx = startX + i * (glyph + gap) + glyph / 2;
    const cy = y + glyph / 2;
    // soft tile behind each glyph for legibility at small sizes
    ctx.save();
    roundRect(ctx, cx - glyph * 0.72, cy - glyph * 0.72, glyph * 1.44, glyph * 1.44, glyph * 0.3);
    ctx.fillStyle = 'rgba(247,249,252,0.06)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(247,249,252,0.1)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    drawGlyph(ctx, code, cx, cy, glyph, GLYPHS[code].color);
  });
  return glyph;
}

function drawCard(ctx: CanvasRenderingContext2D, model: DailyCardModel, size: DailyCardSize): void {
  const { width: w, height: h } = DAILY_CARD_DIMENSIONS[size];
  const square = size === 'square';
  drawBackground(ctx, w, h);
  const pad = square ? 72 : 64;
  // Identity
  drawMark(ctx, pad + 30, pad + 30, 64);
  ctx.fillStyle = C.paper;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = font(760, 38);
  ctx.fillText(model.wordmark, pad + 78, pad + 28);
  ctx.fillStyle = C.cyan;
  ctx.font = font(650, 16);
  ctx.fillText(`${model.subtitle}  ·  ${model.dateLabel.toUpperCase()}`, pad + 80, pad + 54);
  // Attempt label (right)
  ctx.textAlign = 'right';
  ctx.fillStyle = model.official ? C.safety : C.steel;
  ctx.font = font(650, 18);
  ctx.fillText(model.attemptLabel.toUpperCase(), w - pad, pad + 24);

  // Glyph pattern
  const glyphTop = square ? 240 : 170;
  const glyphSize = square ? 118 : 96;
  ctx.fillStyle = C.steel;
  ctx.textAlign = 'center';
  ctx.font = font(650, 16);
  ctx.fillText((model.simple ? 'MY PATTERN' : 'STRATEGY PATTERN').toUpperCase(), w / 2, glyphTop - 18);
  const used = drawGlyphRow(ctx, model.codes, pad, glyphTop, w - pad * 2, glyphSize);

  // Outcome + score
  const outcomeY = glyphTop + used + (square ? 150 : 110);
  ctx.fillStyle = C.paper;
  ctx.textAlign = 'center';
  ctx.font = font(760, square ? 64 : 56);
  ctx.fillText(model.outcomeLabel, w / 2, outcomeY);
  ctx.font = font(650, square ? 30 : 26);
  ctx.fillStyle = scoreColor(model.score);
  const scoreText = model.official ? `${model.score} out of 100` : `${model.simple ? 'Practice' : 'Practice'} · ${model.band}`;
  ctx.fillText(scoreText, w / 2, outcomeY + (square ? 48 : 42));

  // Invitation + link
  ctx.fillStyle = C.cyan;
  ctx.font = font(700, square ? 34 : 30);
  ctx.fillText(model.invitation, w / 2, h - (square ? 150 : 112));
  ctx.fillStyle = C.steel;
  ctx.font = font(560, square ? 22 : 20);
  ctx.fillText(model.url.replace(/^https?:\/\//, ''), w / 2, h - (square ? 104 : 74));
  ctx.fillStyle = C.muted;
  ctx.font = font(500, 14);
  ctx.fillText(model.disclaimer, w / 2, h - (square ? 56 : 34));
}

export async function renderDailyCard(model: DailyCardModel, size: DailyCardSize = 'landscape'): Promise<Blob> {
  if (typeof document === 'undefined') throw new Error('renderDailyCard needs a browser document.');
  const { width, height } = DAILY_CARD_DIMENSIONS[size];
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available on this device.');
  try {
    const fonts = (document as Document & { fonts?: { load(spec: string): Promise<unknown> } }).fonts;
    if (fonts) await Promise.race([fonts.load('760 40px "Manrope Variable"'), new Promise((r) => setTimeout(r, 400))]);
  } catch {
    /* fall back to system fonts */
  }
  drawCard(ctx, model, size);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the card image.'))), 'image/png');
  });
}
