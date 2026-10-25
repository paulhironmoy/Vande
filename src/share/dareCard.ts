/**
 * Dare card (Canvas 2D, rendered locally, 1080×1080 for chat apps). It shows the dared question but never the
 * sender's answer: "DARE" lockup with an hourglass, move and chapter, the question, the score to beat, the
 * before-midnight deadline, the chain position and the code.
 */
import { APP_NAME, C, DISCLAIMER, drawBackground, drawMark, font, roundRect, wrapLines } from './resultCard';

export interface DareCardModel {
  moveNumber: number;
  /** The question, never the answer. */
  moveTitle: string;
  points: number;
  best: boolean;
  chain: number;
  /** e.g. 'Ends at midnight' */
  deadlineLabel: string;
  code: string;
  /** Optional chapter name shown next to the move, e.g. 'The Exam Leak'. */
  chapterTitle?: string;
}

export const DARE_CARD_SIZE = { width: 1080, height: 1080 } as const;

const MONO = '600 {px}px ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
const mono = (px: number) => MONO.replace('{px}', String(px));

function formatPoints(points: number): string {
  return Math.max(0, Math.round(points)).toLocaleString('en-US');
}

/** Accessible description of the card image. */
export function dareCardAlt(model: DareCardModel): string {
  const target = model.points > 0 ? `Beat +${formatPoints(model.points)}` : 'Can you find the best move?';
  const best = model.best ? ' The sender found the best move.' : '';
  const chain = model.chain > 1 ? ` Dare chain number ${model.chain}.` : '';
  const where = model.chapterTitle ? ` of ${model.chapterTitle}` : '';
  return `VANDE dare, move ${model.moveNumber}${where}: ${model.moveTitle}. ${target}. ${model.deadlineLabel || 'Before midnight'}.${best}${chain} Code ${model.code}.`;
}

export function dareCardFileName(model: DareCardModel): string {
  return `vande-dare-move-${Math.max(1, Math.round(model.moveNumber))}.png`;
}

/** Hourglass glyph: frame bars, two glass bulbs and a sand stream. */
export function drawHourglass(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string = C.saffron): void {
  const w = size * 0.62;
  const h = size;
  const top = cy - h / 2;
  const bottom = cy + h / 2;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Frame bars
  ctx.strokeStyle = C.paper;
  ctx.lineWidth = Math.max(2, size * 0.09);
  ctx.beginPath();
  ctx.moveTo(cx - w / 2 - size * 0.08, top);
  ctx.lineTo(cx + w / 2 + size * 0.08, top);
  ctx.moveTo(cx - w / 2 - size * 0.08, bottom);
  ctx.lineTo(cx + w / 2 + size * 0.08, bottom);
  ctx.stroke();
  // Glass
  ctx.strokeStyle = 'rgba(247,249,252,0.85)';
  ctx.lineWidth = Math.max(1.5, size * 0.06);
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, top + size * 0.06);
  ctx.quadraticCurveTo(cx - w / 2, cy - size * 0.12, cx - size * 0.05, cy);
  ctx.quadraticCurveTo(cx - w / 2, cy + size * 0.12, cx - w / 2, bottom - size * 0.06);
  ctx.moveTo(cx + w / 2, top + size * 0.06);
  ctx.quadraticCurveTo(cx + w / 2, cy - size * 0.12, cx + size * 0.05, cy);
  ctx.quadraticCurveTo(cx + w / 2, cy + size * 0.12, cx + w / 2, bottom - size * 0.06);
  ctx.stroke();
  // Sand: a little left in the top bulb, a pile below, a thin stream
  const sand = ctx.createLinearGradient(cx, top, cx, bottom);
  sand.addColorStop(0, '#ffe29e');
  sand.addColorStop(1, color);
  ctx.fillStyle = sand;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.28, cy - size * 0.2);
  ctx.lineTo(cx + w * 0.28, cy - size * 0.2);
  ctx.lineTo(cx, cy - size * 0.03);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.4, bottom - size * 0.08);
  ctx.quadraticCurveTo(cx, bottom - size * 0.34, cx + w * 0.4, bottom - size * 0.08);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, size * 0.03);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, bottom - size * 0.24);
  ctx.stroke();
  ctx.restore();
}

/** A rounded pill with optional leading glyph; returns its width. */
function pillWidth(ctx: CanvasRenderingContext2D, text: string, px: number, glyph: boolean): number {
  ctx.save();
  ctx.font = font(700, px);
  const w = ctx.measureText(text).width + px * 1.8 + (glyph ? px * 1.35 : 0);
  ctx.restore();
  return w;
}

function drawPill(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  px: number,
  tone: 'gold' | 'cyan' | 'steel',
  glyph?: 'hourglass' | 'chain' | 'star',
): number {
  const colors = {
    gold: { fill: 'rgba(240,162,74,0.14)', stroke: 'rgba(240,162,74,0.55)', text: '#ffd28a' },
    cyan: { fill: 'rgba(98,214,255,0.10)', stroke: 'rgba(98,214,255,0.5)', text: C.cyan },
    steel: { fill: 'rgba(247,249,252,0.07)', stroke: 'rgba(255,255,255,0.16)', text: C.paper },
  }[tone];
  const w = pillWidth(ctx, text, px, Boolean(glyph));
  const h = px * 2.1;
  ctx.save();
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = colors.fill;
  ctx.fill();
  ctx.strokeStyle = colors.stroke;
  ctx.lineWidth = 2;
  ctx.stroke();
  let tx = x + px * 0.9;
  if (glyph === 'hourglass') {
    drawHourglass(ctx, tx + px * 0.45, y + h / 2, px * 1.05, C.saffron);
    tx += px * 1.35;
  } else if (glyph === 'chain') {
    ctx.strokeStyle = colors.text;
    ctx.lineWidth = Math.max(2, px * 0.12);
    const cy = y + h / 2;
    roundRect(ctx, tx - px * 0.05, cy - px * 0.28, px * 0.7, px * 0.56, px * 0.28);
    ctx.stroke();
    roundRect(ctx, tx + px * 0.45, cy - px * 0.28, px * 0.7, px * 0.56, px * 0.28);
    ctx.stroke();
    tx += px * 1.35;
  } else if (glyph === 'star') {
    const cx = tx + px * 0.45;
    const cy = y + h / 2;
    const r = px * 0.5;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? r : r * 0.48;
      const px2 = cx + Math.cos(a) * rr;
      const py2 = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px2, py2);
      else ctx.lineTo(px2, py2);
    }
    ctx.closePath();
    ctx.fillStyle = colors.text;
    ctx.fill();
    tx += px * 1.35;
  }
  ctx.fillStyle = colors.text;
  ctx.font = font(700, px);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, tx, y + h / 2 + px * 0.04);
  ctx.restore();
  return w;
}

function drawCard(ctx: CanvasRenderingContext2D, model: DareCardModel): void {
  const { width: w, height: h } = DARE_CARD_SIZE;
  drawBackground(ctx, w, h);
  // Warm glow behind the lockup: a dare should feel like a spark
  const warm = ctx.createRadialGradient(w * 0.2, h * 0.14, 10, w * 0.2, h * 0.14, w * 0.55);
  warm.addColorStop(0, 'rgba(240,162,74,0.20)');
  warm.addColorStop(1, 'rgba(240,162,74,0)');
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, w, h);

  const pad = 84;

  // DARE lockup
  drawHourglass(ctx, pad + 40, 152, 92, C.saffron);
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const dareGrad = ctx.createLinearGradient(0, 100, 0, 200);
  dareGrad.addColorStop(0, '#fff3c4');
  dareGrad.addColorStop(1, C.saffron);
  ctx.fillStyle = dareGrad;
  ctx.font = font(850, 128);
  ctx.fillText('DARE', pad + 100, 196);
  ctx.restore();

  // Move · chapter
  ctx.save();
  ctx.fillStyle = C.cyan;
  ctx.font = font(760, 30);
  ctx.textAlign = 'left';
  const kicker = `Move ${Math.max(1, Math.round(model.moveNumber))}${model.chapterTitle ? ` · ${model.chapterTitle}` : ''}`.toUpperCase();
  ctx.fillText(wrapLines(ctx, kicker, w - pad * 2, 1)[0] ?? kicker, pad, 272);
  ctx.restore();

  // The question (≤ 3 lines)
  ctx.save();
  ctx.fillStyle = C.paper;
  ctx.font = font(780, 62);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const lines = wrapLines(ctx, model.moveTitle, w - pad * 2, 3);
  lines.forEach((line, i) => ctx.fillText(line, pad, 352 + i * 74));
  ctx.restore();

  // Pills (deadline, best move, chain): lay out first so the score can sit just above them
  const PILL_PX = 26;
  const pills: { text: string; tone: 'gold' | 'cyan' | 'steel'; glyph: 'hourglass' | 'chain' | 'star' }[] = [
    { text: model.deadlineLabel || 'Before midnight', tone: 'gold', glyph: 'hourglass' },
  ];
  if (model.best) pills.push({ text: 'Best move found', tone: 'cyan', glyph: 'star' });
  if (model.chain > 1) pills.push({ text: `Dare chain #${Math.round(model.chain)}`, tone: 'steel', glyph: 'chain' });
  const rows: (typeof pills)[] = [[]];
  let rowW = 0;
  for (const p of pills) {
    const pw = pillWidth(ctx, p.text, PILL_PX, true);
    if (rows[rows.length - 1].length && rowW + 16 + pw > w - pad * 2) {
      rows.push([]);
      rowW = 0;
    }
    rows[rows.length - 1].push(p);
    rowW += (rowW ? 16 : 0) + pw;
  }
  const pillH = PILL_PX * 2.1;
  const pillsTop = rows.length > 1 ? 800 : 846;

  // Score to beat, anchored above the pills
  const scoreBase = pillsTop - 96;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if (model.points > 0) {
    ctx.fillStyle = C.steel;
    ctx.font = font(700, 54);
    ctx.fillText('Beat', pad, scoreBase - 6);
    const beatW = ctx.measureText('Beat').width;
    const numGrad = ctx.createLinearGradient(0, scoreBase - 130, 0, scoreBase);
    numGrad.addColorStop(0, '#fff3c4');
    numGrad.addColorStop(0.55, '#f5c25b');
    numGrad.addColorStop(1, C.saffron);
    ctx.shadowColor = 'rgba(240,162,74,0.45)';
    ctx.shadowBlur = 36;
    ctx.fillStyle = numGrad;
    ctx.font = font(850, 168);
    ctx.fillText(`+${formatPoints(model.points)}`, pad + beatW + 24, scoreBase);
  } else {
    ctx.fillStyle = '#ffd28a';
    ctx.font = font(800, 58);
    const ask = wrapLines(ctx, 'Can you find the best move?', w - pad * 2, 2);
    ask.forEach((line, i) => ctx.fillText(line, pad, scoreBase - (ask.length - 1 - i) * 68));
  }
  ctx.restore();

  rows.forEach((row, r) => {
    let x = pad;
    for (const p of row) x += drawPill(ctx, p.text, x, pillsTop + r * (pillH + 10), PILL_PX, p.tone, p.glyph) + 16;
  });

  // Footer: VANDE identity left, code capsule right
  drawMark(ctx, pad + 26, h - 92, 52);
  ctx.save();
  ctx.fillStyle = C.paper;
  ctx.font = font(760, 30);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('VANDE', pad + 64, h - 80);
  ctx.restore();

  ctx.save();
  ctx.font = mono(24);
  const codeW = ctx.measureText(model.code).width;
  const capW = Math.min(w - pad * 2 - 220, codeW + 40);
  const capH = 50;
  const capX = w - pad - capW;
  const capY = h - 92 - capH / 2;
  roundRect(ctx, capX, capY, capW, capH, capH / 2);
  ctx.fillStyle = 'rgba(98,214,255,0.10)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(98,214,255,0.45)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = C.cyan;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let code = model.code;
  while (code.length > 4 && ctx.measureText(code).width > capW - 40) code = `${code.slice(0, -2)}…`.replace(/……$/, '…');
  ctx.fillText(code, capX + 20, capY + capH / 2 + 1);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = C.muted;
  ctx.font = font(500, 18);
  ctx.textAlign = 'center';
  ctx.fillText(`${APP_NAME} · ${DISCLAIMER}`, w / 2, h - 28);
  ctx.restore();
}

/** Renders the dare card to a PNG blob. Throws a clear error where Canvas 2D is unavailable (callers fall back). */
export async function renderDareCard(model: DareCardModel): Promise<Blob> {
  if (typeof document === 'undefined') throw new Error('renderDareCard needs a browser document.');
  const canvas = document.createElement('canvas');
  canvas.width = DARE_CARD_SIZE.width;
  canvas.height = DARE_CARD_SIZE.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available on this device.');
  try {
    const fonts = (document as Document & { fonts?: { load(spec: string): Promise<unknown> } }).fonts;
    if (fonts) await Promise.race([fonts.load('800 40px "Manrope Variable"'), new Promise((r) => setTimeout(r, 400))]);
  } catch {
    /* system fonts are fine */
  }
  drawCard(ctx, model);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the dare image.'))), 'image/png');
  });
}
