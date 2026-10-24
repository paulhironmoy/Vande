/**
 * Lite result card (Canvas 2D, rendered locally). Spoiler-free: points, stars, outcome, missions and the challenge
 * code — never the choices or story details. Two sizes: 1200×630 (link previews) and 1080×1080 (chat apps).
 */
import { APP_NAME, C, DISCLAIMER, drawBackground, drawMark, font, roundRect, wrapLines } from './resultCard';

export interface LiteCardModel {
  points: number;
  stars: 0 | 1 | 2 | 3;
  outcomeLabel: string;
  missionsDone: number;
  missionsTotal: number;
  bugs: number;
  code: string;
  url: string;
  /** e.g. 'The Exam Leak' */
  chapterTitle: string;
}

export type LiteCardSize = 'landscape' | 'square';

export const LITE_CARD_DIMENSIONS: Record<LiteCardSize, { width: number; height: number }> = {
  landscape: { width: 1200, height: 630 },
  square: { width: 1080, height: 1080 },
};

export type MedalTier = 'gold' | 'silver' | 'bronze' | 'steel';

export function medalTier(stars: number): MedalTier {
  if (stars >= 3) return 'gold';
  if (stars === 2) return 'silver';
  if (stars === 1) return 'bronze';
  return 'steel';
}

/** Metallic palettes: highlight, body, shadow, rim, glow. */
export const METALS: Record<MedalTier, { hi: string; mid: string; lo: string; rim: string; glow: string; label: string }> = {
  gold: { hi: '#fff4cc', mid: '#f2c45e', lo: '#94600f', rim: '#ffe39a', glow: 'rgba(242,196,94,0.55)', label: 'Gold' },
  silver: { hi: '#ffffff', mid: '#cfd8e6', lo: '#66768f', rim: '#f2f6fb', glow: 'rgba(207,216,230,0.45)', label: 'Silver' },
  bronze: { hi: '#ffdcbd', mid: '#cd8853', lo: '#6a3714', rim: '#f4bd92', glow: 'rgba(205,136,83,0.45)', label: 'Bronze' },
  steel: { hi: '#b7c4d6', mid: '#60718d', lo: '#24324a', rim: '#8d9eb7', glow: 'rgba(96,113,141,0.35)', label: 'Steel' },
};

const MONO = '600 {px}px ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

function mono(px: number): string {
  return MONO.replace('{px}', String(px));
}

function formatPoints(points: number): string {
  return Math.max(0, Math.round(points)).toLocaleString('en-US');
}

function missionsLine(model: LiteCardModel): string {
  const parts = [`Missions ${model.missionsDone}/${model.missionsTotal}`];
  if (model.bugs > 0) parts.push(model.bugs === 1 ? '1 bug squashed' : `${model.bugs} bugs squashed`);
  return parts.join(' · ');
}

/** Accessible description of the card image. */
export function liteCardAlt(model: LiteCardModel): string {
  const bugs = model.bugs > 0 ? `, ${model.bugs === 1 ? '1 bug' : `${model.bugs} bugs`} squashed` : '';
  return `VANDE Lite result for ${model.chapterTitle}: ${formatPoints(model.points)} points, ${model.stars} of 3 stars, ${model.outcomeLabel}. Missions ${model.missionsDone} of ${model.missionsTotal}${bugs}. Challenge code ${model.code}.`;
}

export function liteCardFileName(model: LiteCardModel, size: LiteCardSize = 'landscape'): string {
  return `vande-lite-${Math.max(0, Math.round(model.points))}${size === 'square' ? '-square' : ''}.png`;
}

// ---------------------------------------------------------------------------
// Drawing primitives
// ---------------------------------------------------------------------------

function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, inner = 0.48): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * inner;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Three stars: earned ones are filled saffron with a soft glow, the rest are steel outlines. */
function drawStars(ctx: CanvasRenderingContext2D, startX: number, cy: number, r: number, gap: number, earned: number): number {
  ctx.save();
  ctx.lineJoin = 'round';
  for (let i = 0; i < 3; i++) {
    const cx = startX + r + i * (2 * r + gap);
    if (i < earned) {
      ctx.save();
      ctx.shadowColor = 'rgba(240,162,74,0.55)';
      ctx.shadowBlur = r * 0.9;
      const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
      g.addColorStop(0, '#ffd28a');
      g.addColorStop(1, C.saffron);
      ctx.fillStyle = g;
      starPath(ctx, cx, cy, r);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,240,214,0.55)';
      ctx.lineWidth = Math.max(1, r * 0.06);
      starPath(ctx, cx, cy, r);
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(170,182,200,0.45)';
      ctx.lineWidth = Math.max(1.5, r * 0.09);
      starPath(ctx, cx, cy, r * 0.94);
      ctx.stroke();
    }
  }
  ctx.restore();
  return 3 * 2 * r + 2 * gap;
}

function drawStrap(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, angle: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  g.addColorStop(0, '#0b3f8f');
  g.addColorStop(0.22, C.blue);
  g.addColorStop(0.42, C.electric);
  g.addColorStop(0.5, C.cyan);
  g.addColorStop(0.58, C.electric);
  g.addColorStop(0.78, C.blue);
  g.addColorStop(1, '#0b3f8f');
  ctx.fillStyle = g;
  // Strap with a swallow-tail notch at the top end.
  const notch = w * 0.32;
  ctx.beginPath();
  ctx.moveTo(-w / 2, h / 2);
  ctx.lineTo(w / 2, h / 2);
  ctx.lineTo(w / 2, -h / 2);
  ctx.lineTo(0, -h / 2 + notch);
  ctx.lineTo(-w / 2, -h / 2);
  ctx.closePath();
  ctx.fill();
  // Fine edge highlight
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = Math.max(1, w * 0.02);
  ctx.stroke();
  ctx.restore();
}

/** Award medal: two-tone ribbon, clasp, bevelled metallic disc with a raised star and a specular highlight. */
export function drawMedal(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, tier: MedalTier): void {
  const m = METALS[tier];
  ctx.save();
  // Ribbon (behind the disc): two long straps forming a V that meets under the clasp
  const strapW = r * 0.5;
  const strapH = r * 1.3;
  drawStrap(ctx, cx - r * 0.34, cy - r * 1.18, strapW, strapH, -0.36);
  drawStrap(ctx, cx + r * 0.34, cy - r * 1.18, strapW, strapH, 0.36);
  // Clasp
  const claspW = r * 0.62;
  const claspH = r * 0.16;
  const cg = ctx.createLinearGradient(cx, cy - r - claspH, cx, cy - r + claspH * 0.4);
  cg.addColorStop(0, m.hi);
  cg.addColorStop(0.5, m.mid);
  cg.addColorStop(1, m.lo);
  ctx.fillStyle = cg;
  roundRect(ctx, cx - claspW / 2, cy - r - claspH * 0.55, claspW, claspH, claspH / 2);
  ctx.fill();

  // Disc with glow
  ctx.save();
  ctx.shadowColor = m.glow;
  ctx.shadowBlur = r * 0.45;
  const outer = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r);
  outer.addColorStop(0, m.hi);
  outer.addColorStop(0.45, m.mid);
  outer.addColorStop(1, m.lo);
  ctx.fillStyle = outer;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Bevel ring
  ctx.strokeStyle = m.rim;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = Math.max(1.5, r * 0.035);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.965, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Inner face (slightly recessed)
  const face = ctx.createRadialGradient(cx + r * 0.25, cy + r * 0.3, r * 0.05, cx, cy, r * 0.78);
  face.addColorStop(0, m.hi);
  face.addColorStop(0.55, m.mid);
  face.addColorStop(1, m.lo);
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = Math.max(1, r * 0.02);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.775, 0, Math.PI * 2);
  ctx.stroke();

  // 24 fine ticks on the face rim (the VANDE rhythm)
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = Math.max(1, r * 0.012);
  ctx.lineCap = 'round';
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.69, Math.sin(a) * r * 0.69);
    ctx.lineTo(Math.cos(a) * r * 0.735, Math.sin(a) * r * 0.735);
    ctx.stroke();
  }
  ctx.restore();

  // Raised star (outline only for the steel tier)
  ctx.save();
  ctx.lineJoin = 'round';
  if (tier === 'steel') {
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = Math.max(1.5, r * 0.035);
    starPath(ctx, cx, cy + r * 0.02, r * 0.4);
    ctx.stroke();
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = r * 0.06;
    ctx.shadowOffsetY = r * 0.025;
    const sg = ctx.createLinearGradient(cx, cy - r * 0.42, cx, cy + r * 0.42);
    sg.addColorStop(0, m.hi);
    sg.addColorStop(1, m.mid);
    ctx.fillStyle = sg;
    starPath(ctx, cx, cy + r * 0.02, r * 0.42);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = m.lo;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = Math.max(1, r * 0.018);
    starPath(ctx, cx, cy + r * 0.02, r * 0.42);
    ctx.stroke();
  }
  ctx.restore();

  // Specular highlight
  const spec = ctx.createRadialGradient(cx - r * 0.38, cy - r * 0.48, 0, cx - r * 0.38, cy - r * 0.48, r * 0.75);
  spec.addColorStop(0, 'rgba(255,255,255,0.42)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spec;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, align: 'left' | 'center'): number {
  ctx.save();
  ctx.font = font(650, px);
  const padX = px * 0.9;
  const h = px * 2.1;
  const w = ctx.measureText(text).width + padX * 2;
  const left = align === 'center' ? x - w / 2 : x;
  roundRect(ctx, left, y, w, h, h / 2);
  ctx.fillStyle = 'rgba(247,249,252,0.07)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.13)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = C.paper;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + padX, y + h / 2 + px * 0.04);
  ctx.restore();
  return w;
}

/** Code capsule in a monospaced face; returns its width. */
function drawCodeCapsule(ctx: CanvasRenderingContext2D, code: string, x: number, y: number, px: number): number {
  ctx.save();
  ctx.font = mono(px);
  const padX = px * 0.85;
  const h = px * 2;
  const w = ctx.measureText(code).width + padX * 2;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = 'rgba(98,214,255,0.10)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(98,214,255,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = C.cyan;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(code, x + padX, y + h / 2 + px * 0.04);
  ctx.restore();
  return w;
}

function codeCapsuleWidth(ctx: CanvasRenderingContext2D, code: string, px: number): number {
  ctx.save();
  ctx.font = mono(px);
  const w = ctx.measureText(code).width + px * 0.85 * 2;
  ctx.restore();
  return w;
}

function drawIdentity(ctx: CanvasRenderingContext2D, model: LiteCardModel, pad: number): void {
  drawMark(ctx, pad + 30, pad + 30, 64);
  ctx.save();
  ctx.fillStyle = C.paper;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = font(760, 38);
  ctx.fillText('VANDE', pad + 78, pad + 28);
  ctx.fillStyle = C.cyan;
  ctx.font = font(650, 16);
  ctx.fillText(`LITE · ${model.chapterTitle.toUpperCase()}`, pad + 80, pad + 54);
  ctx.restore();
}

function drawLandscape(ctx: CanvasRenderingContext2D, model: LiteCardModel): void {
  const { width: w, height: h } = LITE_CARD_DIMENSIONS.landscape;
  drawBackground(ctx, w, h);
  const pad = 64;
  drawIdentity(ctx, model, pad);

  // Medal (right)
  drawMedal(ctx, w - 252, 338, 148, medalTier(model.stars));

  // Points
  const pts = formatPoints(model.points);
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.paper;
  ctx.font = font(800, 128);
  ctx.fillText(pts, pad - 4, 262);
  const numW = ctx.measureText(pts).width;
  ctx.fillStyle = C.steel;
  ctx.font = font(650, 30);
  ctx.fillText('points', pad + numW + 12, 262);
  ctx.restore();

  // Stars + outcome + missions
  drawStars(ctx, pad, 312, 24, 14, model.stars);
  ctx.save();
  ctx.fillStyle = C.paper;
  ctx.font = font(760, 42);
  ctx.textAlign = 'left';
  const outcome = wrapLines(ctx, model.outcomeLabel, 620, 1)[0] ?? model.outcomeLabel;
  ctx.fillText(outcome, pad, 392);
  ctx.restore();
  drawPill(ctx, missionsLine(model), pad, 414, 21, 'left');

  // Call to action + code
  ctx.save();
  ctx.fillStyle = C.cyan;
  ctx.font = font(760, 38);
  ctx.textAlign = 'left';
  ctx.fillText('Beat my score', pad, 538);
  const ctaW = ctx.measureText('Beat my score').width;
  ctx.restore();
  drawCodeCapsule(ctx, model.code, pad + ctaW + 22, 506, 20);

  // Disclaimer
  ctx.save();
  ctx.fillStyle = C.muted;
  ctx.font = font(500, 14);
  ctx.textAlign = 'left';
  ctx.fillText(`${APP_NAME} · ${DISCLAIMER}`, pad, h - 30);
  ctx.restore();
}

function drawSquare(ctx: CanvasRenderingContext2D, model: LiteCardModel): void {
  const { width: w, height: h } = LITE_CARD_DIMENSIONS.square;
  drawBackground(ctx, w, h);
  const pad = 72;
  drawIdentity(ctx, model, pad);

  drawMedal(ctx, w / 2, 392, 160, medalTier(model.stars));

  const pts = formatPoints(model.points);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.paper;
  ctx.font = font(800, 136);
  ctx.fillText(pts, w / 2, 690);
  ctx.fillStyle = C.steel;
  ctx.font = font(650, 30);
  ctx.fillText('points', w / 2, 734);
  ctx.restore();

  const starR = 28;
  const starGap = 18;
  const starsW = 3 * 2 * starR + 2 * starGap;
  drawStars(ctx, w / 2 - starsW / 2, 790, starR, starGap, model.stars);

  ctx.save();
  ctx.fillStyle = C.paper;
  ctx.font = font(760, 46);
  ctx.textAlign = 'center';
  const outcome = wrapLines(ctx, model.outcomeLabel, w - pad * 2, 1)[0] ?? model.outcomeLabel;
  ctx.fillText(outcome, w / 2, 870);
  ctx.restore();
  drawPill(ctx, missionsLine(model), w / 2, 892, 22, 'center');

  // CTA + code, centred as one row
  ctx.save();
  ctx.font = font(760, 34);
  const cta = 'Beat my score';
  const ctaW = ctx.measureText(cta).width;
  const capW = codeCapsuleWidth(ctx, model.code, 20);
  const rowW = ctaW + 20 + capW;
  const left = w / 2 - rowW / 2;
  ctx.fillStyle = C.cyan;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(cta, left, 1004);
  ctx.restore();
  drawCodeCapsule(ctx, model.code, w / 2 - rowW / 2 + ctaW + 20, 972, 20);

  ctx.save();
  ctx.fillStyle = C.muted;
  ctx.font = font(500, 15);
  ctx.textAlign = 'center';
  ctx.fillText(DISCLAIMER, w / 2, h - 26);
  ctx.restore();
}

/** Renders the card to a PNG blob. Throws a clear error where Canvas 2D is unavailable (callers fall back). */
export async function renderLiteCard(model: LiteCardModel, size: LiteCardSize = 'landscape'): Promise<Blob> {
  if (typeof document === 'undefined') throw new Error('renderLiteCard needs a browser document.');
  const { width, height } = LITE_CARD_DIMENSIONS[size];
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available on this device.');
  try {
    const fonts = (document as Document & { fonts?: { load(spec: string): Promise<unknown> } }).fonts;
    if (fonts) await Promise.race([fonts.load('800 40px "Manrope Variable"'), new Promise((r) => setTimeout(r, 400))]);
  } catch {
    /* system fonts are fine */
  }
  if (size === 'square') drawSquare(ctx, model);
  else drawLandscape(ctx, model);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the card image.'))), 'image/png');
  });
}
