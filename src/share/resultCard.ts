/**
 * Local result-card generation (Canvas 2D). No network, no backend.
 * `buildCardModel` is pure and testable; `renderCard` needs a browser canvas.
 */
import type { CampaignResult, Dimension, RepublicOutcome } from '@/engine/types';
import { DIMENSIONS, OUTCOME_LABELS } from '@/engine/types';
import { getScenario } from '@/engine';
import { SIMPLE_DIMENSIONS, SIMPLE_OUTCOMES, simpleValue } from '@/app/simple';

export const TAGLINE = 'I held the Republic together. Can you?';
export const DISCLAIMER = 'Independent game · not affiliated with any government, party or institution';
export const APP_NAME = 'VANDE: Republic Under Pressure';

export type CardSize = 'landscape' | 'portrait';

export const CARD_DIMENSIONS: Record<CardSize, { width: number; height: number }> = {
  landscape: { width: 1200, height: 630 },
  portrait: { width: 1080, height: 1350 },
};

export interface CardModel {
  appName: string;
  wordmark: string;
  subtitle: string;
  outcome: RepublicOutcome;
  outcomeLabel: string;
  score: number;
  hardestDecision: string;
  values: string[];
  code: string;
  url: string;
  tagline: string;
  disclaimer: string;
  dateLabel: string;
  dims: { dim: Dimension; label: string; value: number }[];
  mode: CampaignResult['mode'];
}

const DIM_SHORT: Record<Dimension, string> = {
  freedom: 'Freedom',
  grievance: 'Grievance',
  safety: 'Safety',
  evidence: 'Evidence',
  trust: 'Trust',
  economy: 'Economy',
};

export function challengeUrl(code: string, origin: string, base = '/'): string {
  const o = origin.replace(/\/+$/, '');
  let b = base || '/';
  if (!b.startsWith('/')) b = `/${b}`;
  if (!b.endsWith('/')) b = `${b}/`;
  return `${o}${b}?c=${encodeURIComponent(code)}`;
}

export function challengeCodeFromUrl(input: string): string | null {
  if (!input) return null;
  try {
    const u = new URL(input, 'https://vande.invalid');
    const q = u.searchParams.get('c');
    if (q) return q.trim() || null;
    const m = u.pathname.match(/\/c\/([^/]+)\/?$/);
    if (m) return decodeURIComponent(m[1]);
    return null;
  } catch {
    return null;
  }
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)));
}

export interface CardModelOptions {
  origin: string;
  base?: string;
  now?: Date;
  /** Simple play style: plain-language outcome, decision and value labels. */
  simple?: boolean;
}

/** Plain-language "decision — option" line for the most consequential decision, from the scenario's simple layer. */
function simpleHardestDecision(result: CampaignResult): string | undefined {
  const key = result.mostConsequential;
  if (!key) return undefined;
  try {
    const scenario = getScenario(key.scenarioId);
    const decision = scenario.decisions.find((d) => d.id === key.decisionId);
    if (!decision) return undefined;
    const option = decision.options.find((o) => o.id === key.optionId);
    const title = decision.simple?.title ?? decision.title;
    const optionTitle = decision.simple?.options[key.optionId]?.title ?? option?.title ?? key.optionTitle;
    return `${title} — ${optionTitle}`;
  } catch {
    return undefined;
  }
}

export function buildCardModel(result: CampaignResult, opts: CardModelOptions): CardModel {
  const simple = opts.simple === true;
  const code = result.challengeCode;
  const fullHardest = (result.hardestDecision ?? result.mostConsequential?.optionTitle ?? result.mostConsequential?.title ?? 'Every decision counted').trim();
  const hardest = (simple ? (simpleHardestDecision(result) ?? fullHardest) : fullHardest).trim();
  const values = (result.valuesProtected ?? [])
    .map((v) => simpleValue(v.trim(), simple))
    .filter(Boolean)
    .slice(0, 4);
  const date = new Date(result.completedAt);
  const dateLabel = Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return {
    appName: APP_NAME,
    wordmark: 'VANDE//REPUBLIC',
    subtitle: 'REPUBLIC UNDER PRESSURE',
    outcome: result.outcome,
    outcomeLabel: simple ? (SIMPLE_OUTCOMES[result.outcome]?.label ?? OUTCOME_LABELS[result.outcome] ?? 'Your city') : (OUTCOME_LABELS[result.outcome] ?? 'Republic result'),
    score: clampScore(result.score),
    hardestDecision: hardest,
    values: values.length > 0 ? values : simple ? ['People could speak and gather', 'Everyone stayed safe'] : ['Lawful protest', 'Proportionate safety'],
    code,
    url: challengeUrl(code, opts.origin, opts.base ?? '/'),
    tagline: TAGLINE,
    disclaimer: DISCLAIMER,
    dateLabel,
    dims: DIMENSIONS.map((dim) => ({ dim, label: simple ? SIMPLE_DIMENSIONS[dim].short : DIM_SHORT[dim], value: clampScore(result.finalScores[dim]) })),
    mode: result.mode,
  };
}

export function shareText(model: CardModel): string {
  return `${model.tagline}\n${model.outcomeLabel} · ${model.score}/100 in ${model.appName}.\nChallenge code: ${model.code}\n${model.url}`;
}

// ---------------------------------------------------------------------------
// Canvas rendering
// ---------------------------------------------------------------------------

export const C = {
  midnight: '#07111f',
  navy: '#0b1d36',
  ink700: '#0a1830',
  ink500: '#142a4d',
  blue: '#136ef6',
  electric: '#38a0ff',
  cyan: '#62d6ff',
  paper: '#f7f9fc',
  steel: '#aab6c8',
  muted: '#7c8ca6',
  safety: '#2ed3c4',
  saffron: '#f0a24a',
  danger: '#e0405a',
  dims: {
    freedom: '#4da3ff',
    grievance: '#a9e4ff',
    safety: '#2ed3c4',
    evidence: '#62d6ff',
    trust: '#7b8cff',
    economy: '#2ecc8a',
  } as Record<Dimension, string>,
};

const FONT = '"Manrope Variable", "Manrope", "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export function font(weight: number, px: number): string {
  return `${weight} ${px}px ${FONT}`;
}

export function scoreColor(score: number): string {
  if (score >= 75) return C.safety;
  if (score >= 55) return C.electric;
  if (score >= 40) return C.saffron;
  return C.danger;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length > maxLines) lines.length = maxLines;
  const consumed = lines.join(' ').split(/\s+/).length;
  if (consumed < words.length && lines.length > 0) {
    let last = lines[lines.length - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1).trimEnd();
    lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}

/** The VANDE mark: two opposing arcs forming a V, an equilibrium line, 24 subtle radial ticks. */
export function drawMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color = C.cyan): void {
  const r = size / 2;
  ctx.save();
  ctx.translate(cx, cy);
  // 24-point radial rhythm (subtle ticks on the rim — not spokes)
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = Math.max(1, size * 0.025);
  ctx.lineCap = 'round';
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const inner = r * 0.9;
    const outer = r * 0.98;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
    ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Two opposing arcs held in balance → V silhouette
  ctx.lineWidth = Math.max(2, size * 0.085);
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(-r * 0.62, -r * 0.5, r * 0.78, Math.PI * 0.08, Math.PI * 0.5, false);
  ctx.stroke();
  ctx.strokeStyle = C.paper;
  ctx.beginPath();
  ctx.arc(r * 0.62, -r * 0.5, r * 0.78, Math.PI * 0.5, Math.PI * 0.92, false);
  ctx.stroke();
  // Equilibrium line
  ctx.strokeStyle = C.paper;
  ctx.lineWidth = Math.max(1.5, size * 0.05);
  ctx.beginPath();
  ctx.moveTo(-r * 0.46, r * 0.02);
  ctx.lineTo(r * 0.46, r * 0.02);
  ctx.stroke();
  ctx.restore();
}

export function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#122b52');
  g.addColorStop(0.45, C.navy);
  g.addColorStop(1, C.midnight);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // soft spatial glow
  const glow = ctx.createRadialGradient(w * 0.78, h * 0.18, 10, w * 0.78, h * 0.18, w * 0.5);
  glow.addColorStop(0, 'rgba(56,160,255,0.28)');
  glow.addColorStop(1, 'rgba(56,160,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  // fine grid
  ctx.strokeStyle = 'rgba(98,214,255,0.05)';
  ctx.lineWidth = 1;
  for (let x = 0.5; x < w; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0.5; y < h; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  // edge illumination
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(0, 0.5);
  ctx.lineTo(w, 0.5);
  ctx.stroke();
}

export function drawScoreRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, score: number, numberPx: number): void {
  ctx.save();
  ctx.lineWidth = Math.max(8, r * 0.085);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(170,182,200,0.16)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  const color = scoreColor(score);
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = r * 0.25;
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * score) / 100);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = C.paper;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = font(760, numberPx);
  ctx.fillText(String(score), cx, cy + numberPx * 0.34);
  ctx.fillStyle = C.steel;
  ctx.font = font(560, Math.round(numberPx * 0.15));
  ctx.fillText('out of 100', cx, cy + numberPx * 0.34 + numberPx * 0.24);
  ctx.restore();
}

function drawChips(ctx: CanvasRenderingContext2D, items: string[], x: number, y: number, maxWidth: number, px: number): number {
  ctx.save();
  ctx.font = font(650, px);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const padX = px * 0.9;
  const h = px * 2.1;
  let cx = x;
  let cy = y;
  for (const item of items) {
    const w = ctx.measureText(item).width + padX * 2;
    if (cx + w > x + maxWidth && cx > x) {
      cx = x;
      cy += h + px * 0.6;
    }
    roundRect(ctx, cx, cy, w, h, h / 2);
    ctx.fillStyle = 'rgba(46,211,196,0.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(46,211,196,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = C.safety;
    ctx.fillText(item, cx + padX, cy + h / 2 + 1);
    cx += w + px * 0.6;
  }
  ctx.restore();
  return cy + h;
}

function drawDims(ctx: CanvasRenderingContext2D, model: CardModel, x: number, y: number, width: number, px: number): void {
  const gap = px * 0.9;
  const colW = (width - gap * (model.dims.length - 1)) / model.dims.length;
  const fit = (text: string, max: number): string => {
    if (ctx.measureText(text).width <= max) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
    return `${t}…`;
  };
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  model.dims.forEach((d, i) => {
    const cx = x + i * (colW + gap);
    ctx.fillStyle = 'rgba(170,182,200,0.14)';
    roundRect(ctx, cx, y, colW, px * 0.5, px * 0.25);
    ctx.fill();
    ctx.fillStyle = C.dims[d.dim];
    roundRect(ctx, cx, y, Math.max(px * 0.5, (colW * d.value) / 100), px * 0.5, px * 0.25);
    ctx.fill();
    // Two rows: value (bold) then a short label, each fitted to the column so nothing overlaps.
    ctx.fillStyle = C.paper;
    ctx.font = font(760, px * 1.05);
    ctx.fillText(String(d.value), cx, y + px * 1.8);
    ctx.fillStyle = C.steel;
    ctx.font = font(560, px * 0.72);
    ctx.fillText(fit(d.label, colW), cx, y + px * 2.75);
  });
  ctx.restore();
}

function paintLandscape(ctx: CanvasRenderingContext2D, model: CardModel): void {
  const { width: w, height: h } = CARD_DIMENSIONS.landscape;
  drawBackground(ctx, w, h);
  const pad = 72;
  drawMark(ctx, pad + 34, 92, 68);
  ctx.fillStyle = C.paper;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = font(760, 40);
  ctx.fillText('VANDE', pad + 90, 92);
  ctx.fillStyle = C.steel;
  ctx.font = font(650, 15);
  ctx.save();
  ctx.letterSpacing = '3px';
  ctx.fillText(model.subtitle, pad + 92, 118);
  ctx.restore();
  if (model.dateLabel) {
    ctx.fillStyle = C.muted;
    ctx.font = font(560, 16);
    ctx.textAlign = 'right';
    ctx.fillText(model.dateLabel, w - pad, 92);
  }

  // Outcome
  ctx.textAlign = 'left';
  ctx.fillStyle = C.cyan;
  ctx.font = font(650, 16);
  ctx.save();
  ctx.letterSpacing = '2px';
  ctx.fillText('REPUBLIC OUTCOME', pad, 214);
  ctx.restore();
  ctx.fillStyle = C.paper;
  ctx.font = font(760, 58);
  const outcomeLines = wrapLines(ctx, model.outcomeLabel, 640, 2);
  outcomeLines.forEach((line, i) => ctx.fillText(line, pad, 282 + i * 64));

  // Score ring
  drawScoreRing(ctx, w - pad - 150, 300, 118, model.score, 128);

  // Hardest decision
  const hdY = 282 + outcomeLines.length * 64 + 18;
  ctx.fillStyle = C.steel;
  ctx.font = font(650, 15);
  ctx.save();
  ctx.letterSpacing = '2px';
  ctx.fillText('HARDEST DECISION', pad, hdY);
  ctx.restore();
  ctx.fillStyle = C.paper;
  ctx.font = font(560, 24);
  const hdLines = wrapLines(ctx, model.hardestDecision, 660, 2);
  hdLines.forEach((line, i) => ctx.fillText(line, pad, hdY + 36 + i * 32));

  // Values protected
  const chipsY = hdY + 36 + hdLines.length * 32 + 10;
  drawChips(ctx, model.values, pad, chipsY, 700, 16);

  // Dimensions strip
  drawDims(ctx, model, w - pad - 300, 452, 300, 14);

  // Bottom bar
  ctx.fillStyle = 'rgba(247,249,252,0.06)';
  ctx.fillRect(0, h - 92, w, 1);
  ctx.fillStyle = C.cyan;
  ctx.font = font(650, 24);
  ctx.textAlign = 'left';
  ctx.fillText(model.tagline, pad, h - 50);
  ctx.fillStyle = C.steel;
  ctx.font = font(560, 16);
  ctx.textAlign = 'right';
  ctx.fillText(`Code ${model.code}`, w - pad, h - 58);
  ctx.fillStyle = C.muted;
  ctx.font = font(450, 14);
  ctx.fillText(model.url.replace(/^https?:\/\//, ''), w - pad, h - 36);
  ctx.textAlign = 'left';
  ctx.fillText(model.disclaimer, pad, h - 22);
}

function paintPortrait(ctx: CanvasRenderingContext2D, model: CardModel): void {
  const { width: w, height: h } = CARD_DIMENSIONS.portrait;
  drawBackground(ctx, w, h);
  const pad = 80;
  drawMark(ctx, w / 2, 130, 84);
  ctx.fillStyle = C.paper;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = font(760, 48);
  ctx.fillText('VANDE', w / 2, 232);
  ctx.fillStyle = C.steel;
  ctx.font = font(650, 17);
  ctx.save();
  ctx.letterSpacing = '4px';
  ctx.fillText(model.subtitle, w / 2, 264);
  ctx.restore();

  drawScoreRing(ctx, w / 2, 470, 150, model.score, 168);

  ctx.fillStyle = C.cyan;
  ctx.font = font(650, 17);
  ctx.save();
  ctx.letterSpacing = '3px';
  ctx.fillText('REPUBLIC OUTCOME', w / 2, 690);
  ctx.restore();
  ctx.fillStyle = C.paper;
  ctx.font = font(760, 58);
  const outcomeLines = wrapLines(ctx, model.outcomeLabel, w - pad * 2, 2);
  outcomeLines.forEach((line, i) => ctx.fillText(line, w / 2, 756 + i * 66));

  let y = 756 + outcomeLines.length * 66 + 40;
  ctx.textAlign = 'left';
  ctx.fillStyle = C.steel;
  ctx.font = font(650, 16);
  ctx.save();
  ctx.letterSpacing = '2px';
  ctx.fillText('HARDEST DECISION', pad, y);
  ctx.restore();
  ctx.fillStyle = C.paper;
  ctx.font = font(560, 28);
  const hdLines = wrapLines(ctx, model.hardestDecision, w - pad * 2, 3);
  hdLines.forEach((line, i) => ctx.fillText(line, pad, y + 42 + i * 38));
  y = y + 42 + hdLines.length * 38 + 16;

  y = drawChips(ctx, model.values, pad, y, w - pad * 2, 19) + 44;
  drawDims(ctx, model, pad, y, w - pad * 2, 16);

  ctx.fillStyle = 'rgba(247,249,252,0.06)';
  ctx.fillRect(0, h - 190, w, 1);
  ctx.fillStyle = C.cyan;
  ctx.font = font(650, 30);
  ctx.textAlign = 'center';
  wrapLines(ctx, model.tagline, w - pad * 2, 2).forEach((line, i) => ctx.fillText(line, w / 2, h - 132 + i * 36));
  ctx.fillStyle = C.steel;
  ctx.font = font(560, 20);
  ctx.fillText(`Challenge code ${model.code}`, w / 2, h - 80);
  ctx.fillStyle = C.muted;
  ctx.font = font(450, 16);
  ctx.fillText(model.url.replace(/^https?:\/\//, ''), w / 2, h - 52);
  ctx.font = font(450, 14);
  ctx.fillText(model.disclaimer, w / 2, h - 26);
}

async function ensureFonts(): Promise<void> {
  try {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts) return;
    await Promise.race([
      Promise.all([fonts.load('760 48px "Manrope Variable"'), fonts.load('560 24px "Manrope Variable"')]),
      new Promise((resolve) => setTimeout(resolve, 800)),
    ]);
  } catch {
    /* system fallback fonts are fine */
  }
}

/** Renders the card to a PNG blob. Throws a clear error where Canvas 2D is unavailable (e.g. jsdom). */
export async function renderCard(model: CardModel, size: CardSize = 'landscape'): Promise<Blob> {
  if (typeof document === 'undefined') throw new Error('Result cards can only be rendered in a browser.');
  const { width, height } = CARD_DIMENSIONS[size];
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available in this environment, so the result card cannot be drawn.');
  await ensureFonts();
  if (size === 'landscape') paintLandscape(ctx, model);
  else paintPortrait(ctx, model);
  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The result card could not be encoded as an image.'))), 'image/png');
    } catch (err) {
      reject(err instanceof Error ? err : new Error('The result card could not be encoded as an image.'));
    }
  });
}
