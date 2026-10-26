/**
 * Broadcast overlays for the highlight Short, drawn on a 1080x1920 2D canvas over the 3D picture. Every value is a
 * pure function of the highlight time, so a frame is identical however often (or in whatever order) it is drawn.
 * Shorts keep their own UI at the bottom and right edge, so essential text stays inside x 56–1024, y 80–1500.
 */
import type { BallOutcome, HighlightRenderInput, MatchEventLog } from '@/contracts';
import type { MessageKey, Translator } from '@/i18n';
import type { Segment, Timeline } from '@/render3d/core/timeline';
import { scoreAt, timelineTimeOf } from '@/render3d/core/timeline';
import { drawMark } from '@/ui/brand/mark';
import { resultText } from '@/screens/reveal/text';
import type { HighlightPlan, Scene } from './plan';

export const W = 1080;
export const H = 1920;

/**
 * The two names the video shows, in log.players order: the moderated current display names from the render input.
 * Never log.players[].alias, which is the match-time alias and may have changed since or never been checked.
 * Throws when the input has none, so a cut is never composed without them.
 */
export function displayNames(input: Pick<HighlightRenderInput, 'aliases'>): [string, string] {
  const a: unknown = input.aliases;
  if (!Array.isArray(a) || a.length !== 2 || a.some((x) => typeof x !== 'string' || x.trim() === '')) throw new Error('highlight input has no moderated aliases');
  return [a[0] as string, a[1] as string];
}

const nameOf = (a: OverlayAssets, p: 0 | 1): string => a.input.aliases[p];

export interface OverlayAssets {
  t: Translator;
  log: MatchEventLog;
  tl: Timeline;
  input: HighlightRenderInput;
  plan: HighlightPlan;
  avatars: [CanvasImageSource | null, CanvasImageSource | null];
  qr: { path: Path2D; n: number } | null;
  day: string;
}

const FAMILY = '"Manrope Variable", Manrope, "Noto Sans Devanagari", system-ui, sans-serif';
const font = (weight: number, px: number) => `${weight} ${px}px ${FAMILY}`;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const backOut = (x: number) => {
  const c = 1.70158;
  const t = clamp(x, 0, 1) - 1;
  return 1 + (c + 1) * t * t * t + c * t * t;
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (!line || ctx.measureText(next).width <= maxWidth) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = fit(ctx, `${kept[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`, maxWidth);
    return kept;
  }
  return lines;
}

function glassPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, edge = 'rgba(143,135,232,0.35)') {
  roundRect(ctx, x, y, w, h, r);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(29,24,88,0.86)');
  g.addColorStop(1, 'rgba(11,9,41,0.9)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = edge;
  ctx.stroke();
}

function pill(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, tone: 'amber' | 'cyan' | 'violet' | 'clay', px = 30, align: 'center' | 'left' | 'right' = 'center'): number {
  ctx.font = font(750, px);
  const w = ctx.measureText(text).width + px * 1.5;
  const h = px * 1.9;
  const x = align === 'center' ? cx - w / 2 : align === 'left' ? cx : cx - w;
  const c = { amber: ['rgba(255,170,51,0.2)', '#ffdba3'], cyan: ['rgba(25,211,250,0.18)', '#93eeff'], violet: ['rgba(195,140,255,0.2)', '#e2c9ff'], clay: ['rgba(210,170,114,0.22)', '#f1d7ad'] }[tone];
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = c[0];
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = c[1];
  ctx.globalAlpha *= 0.6;
  ctx.stroke();
  ctx.globalAlpha /= 0.6;
  ctx.fillStyle = c[1];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2 + 1);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  return w;
}

function portrait(ctx: CanvasRenderingContext2D, img: CanvasImageSource | null, cx: number, cy: number, size: number, ring: string) {
  ctx.save();
  ctx.shadowColor = 'rgba(2,1,16,0.7)';
  ctx.shadowBlur = 40;
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 + 6, 0, Math.PI * 2);
  ctx.fillStyle = ring;
  ctx.fill();
  ctx.restore();
  if (img) ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
  else {
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#28216f';
    ctx.fill();
  }
}

function shade(ctx: CanvasRenderingContext2D, alpha: number) {
  ctx.fillStyle = `rgba(6,5,31,${alpha})`;
  ctx.fillRect(0, 0, W, H);
}

function vignettes(ctx: CanvasRenderingContext2D) {
  const top = ctx.createLinearGradient(0, 0, 0, 420);
  top.addColorStop(0, 'rgba(3,2,26,0.72)');
  top.addColorStop(1, 'rgba(3,2,26,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, 420);
  const bottom = ctx.createLinearGradient(0, H - 620, 0, H);
  bottom.addColorStop(0, 'rgba(3,2,26,0)');
  bottom.addColorStop(1, 'rgba(3,2,26,0.78)');
  ctx.fillStyle = bottom;
  ctx.fillRect(0, H - 620, W, 620);
}

function brandHeader(ctx: CanvasRenderingContext2D, a: OverlayAssets) {
  drawMark(ctx, 56, 70, 84);
  ctx.fillStyle = '#f5f4ff';
  ctx.font = font(820, 46);
  ctx.fillText('VANDE', 156, 116);
  ctx.fillStyle = '#ffc266';
  ctx.font = font(750, 22);
  ctx.fillText('CRICKET · SEALED SIX', 158, 148);
  ctx.font = font(700, 26);
  const label = fit(ctx, `${a.input.fixtureLabel} · ${a.day}`, 430);
  const w = ctx.measureText(label).width + 44;
  roundRect(ctx, W - 56 - w, 82, w, 56, 28);
  ctx.fillStyle = 'rgba(14,11,52,0.72)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(25,211,250,0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#e9f9ff';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, W - 56 - w + 22, 111);
  ctx.textBaseline = 'alphabetic';
}

// ---- ball clips -------------------------------------------------------------------------------------------------

function scoreBug(ctx: CanvasRenderingContext2D, a: OverlayAssets, replay: number) {
  const { log, tl, t } = a;
  const s = scoreAt(tl, replay);
  const x = 56;
  const y = 196;
  const w = W - 112;
  const h = 132;
  glassPanel(ctx, x, y, w, h, 30);
  const sides: Array<{ p: 0 | 1; text: string; batting: boolean }> = ([0, 1] as const).map((p) => {
    const inningsOfP = log.innings.findIndex((inn) => inn.batter === p);
    let text = '—';
    const batting = s.batting === p && s.innings !== null;
    if (batting && s.score) text = `${s.score.runs}/${s.score.wickets}`;
    else if (inningsOfP >= 0) {
      const done = s.innings === 'super' || (typeof s.innings === 'number' && inningsOfP < s.innings);
      if (done) text = `${log.innings[inningsOfP].runs}/${log.innings[inningsOfP].wickets}`;
    }
    return { p, text, batting };
  });
  sides.forEach((side, i) => {
    const cx = i === 0 ? x + 24 : x + w / 2 + 12;
    const img = a.avatars[side.p];
    if (img) ctx.drawImage(img, cx, y + 24, 84, 84);
    ctx.fillStyle = side.batting ? '#ffffff' : '#cac7ee';
    ctx.font = font(750, 30);
    ctx.fillText(fit(ctx, nameOf(a, side.p), 220), cx + 100, y + 62);
    ctx.fillStyle = side.batting ? '#93eeff' : '#a29fd0';
    ctx.font = font(820, 40);
    ctx.fillText(side.text, cx + 100, y + 108);
    if (side.batting) {
      ctx.fillStyle = '#19d3fa';
      roundRect(ctx, cx + 100, y + h - 14, 120, 6, 3);
      ctx.fill();
    }
  });
  if (s.innings === 'super') pill(ctx, t.t('highlight.super_ball'), W / 2, y + h + 16, 'violet', 26);
}

function ballCaption(ctx: CanvasRenderingContext2D, a: OverlayAssets, seg: Segment, local: number) {
  const o = seg.outcome as BallOutcome;
  const alpha = smooth(150, 520, local) * (1 - smooth(3000, 3500, local));
  if (alpha <= 0) return;
  const { t } = a;
  ctx.save();
  ctx.globalAlpha = alpha;
  const y = 1300 + (1 - smooth(150, 520, local)) * 30;
  glassPanel(ctx, 56, y, W - 112, 188, 30, 'rgba(255,170,51,0.45)');
  ctx.fillStyle = '#ffc266';
  ctx.font = font(750, 26);
  const eyebrow = seg.innings === 'super' ? t.t('highlight.super_ball') : t.t('highlight.ball_of', { innings: Number(seg.innings) + 1, n: (seg.ball ?? 0) + 1 });
  ctx.fillText(eyebrow.toUpperCase(), 92, y + 52);
  ctx.fillStyle = '#ffffff';
  ctx.font = font(820, 46);
  ctx.fillText(fit(ctx, t.t('highlight.matchup', { batter: nameOf(a, seg.batting), bowler: nameOf(a, seg.bowling) }), W - 184), 92, y + 110);
  ctx.fillStyle = '#cac7ee';
  ctx.font = font(560, 30);
  const delivery = `${t.t(`variant.${o.delivery.variant}` as MessageKey)} · ${t.t(`line.${o.delivery.line}` as MessageKey)}`;
  ctx.fillText(fit(ctx, `${delivery}  →  ${t.t(`shot.${o.shot}` as MessageKey)}`, W - 184), 92, y + 156);
  ctx.restore();
}

function eventBadge(ctx: CanvasRenderingContext2D, a: OverlayAssets, seg: Segment, replay: number, tags: string[]) {
  const o = seg.outcome as BallOutcome;
  const decisive = timelineTimeOf(seg, seg.script.times.decisive);
  const age = replay - decisive;
  if (age < 0 || age > 2800) return;
  const { t } = a;
  let big: string | null = null;
  let sub = '';
  let color = '#ffffff';
  let glow = 'rgba(255,255,255,0.4)';
  const fate = o.cues.fate;
  if (o.wicket) {
    big = t.t('highlight.out');
    sub = t.t(`wicket.${o.wicket}` as MessageKey);
    color = '#ff7a90';
    glow = 'rgba(255,77,106,0.55)';
  } else if (o.runs === 6) {
    big = t.t('highlight.six');
    sub = fate.kind === 'six' ? t.t('highlight.six_sub', { m: Math.round(fate.distanceM), zone: t.t(`zone.${fate.zone}` as MessageKey) }) : '';
    color = '#ffc266';
    glow = 'rgba(255,170,51,0.6)';
  } else if (o.runs === 4) {
    big = t.t('highlight.four');
    sub = fate.kind === 'four' ? t.t('highlight.four_sub', { zone: t.t(`zone.${fate.zone}` as MessageKey) }) : '';
    color = '#93eeff';
    glow = 'rgba(25,211,250,0.6)';
  } else if (tags.includes('best')) {
    big = t.t('highlight.perfect');
    sub = t.t(`execution.${o.executionGrade}` as MessageKey);
    color = '#e2c9ff';
    glow = 'rgba(195,140,255,0.55)';
  }
  if (!big) return;
  const pop = backOut(age / 380);
  const fade = 1 - smooth(2300, 2800, age);
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.translate(W / 2, 860);
  ctx.scale(0.6 + 0.4 * pop, 0.6 + 0.4 * pop);
  ctx.textAlign = 'center';
  ctx.font = font(900, big.length > 8 ? 140 : 210);
  ctx.shadowColor = glow;
  ctx.shadowBlur = 60;
  ctx.fillStyle = color;
  ctx.fillText(big, 0, 0);
  ctx.shadowBlur = 0;
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(3,2,26,0.55)';
  ctx.strokeText(big, 0, 0);
  if (sub) {
    ctx.font = font(750, 46);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(3,2,26,0.8)';
    ctx.shadowBlur = 18;
    ctx.fillText(fit(ctx, sub, 900), 0, 90);
  }
  ctx.restore();
}

function drawBall(ctx: CanvasRenderingContext2D, a: OverlayAssets, scene: Scene, local: number, replay: number) {
  const seg = a.tl.segments[scene.seg ?? 0];
  vignettes(ctx);
  brandHeader(ctx, a);
  scoreBug(ctx, a, replay);
  const tags = scene.tags ?? [];
  if (tags.includes('turning')) pill(ctx, t2(a, 'highlight.turning_point'), W / 2, 372, 'amber', 30);
  else if (tags.includes('super')) pill(ctx, t2(a, 'highlight.super_ball'), W / 2, 372, 'violet', 30);
  if (seg?.outcome) {
    eventBadge(ctx, a, seg, replay, tags);
    ballCaption(ctx, a, seg, local);
  }
}

/** The first two seconds: the biggest moment, teased ("Coming up"), before the intro. No score yet. */
function drawHook(ctx: CanvasRenderingContext2D, a: OverlayAssets, scene: Scene, local: number, replay: number) {
  const seg = a.tl.segments[scene.seg ?? 0];
  vignettes(ctx);
  ctx.save();
  ctx.globalAlpha = smooth(0, 200, local);
  pill(ctx, t2(a, 'highlight.coming_up'), W / 2, 372, 'amber', 34);
  ctx.restore();
  if (seg?.outcome) eventBadge(ctx, a, seg, replay, scene.tags ?? []);
}

const t2 = (a: OverlayAssets, key: MessageKey) => a.t.t(key).toUpperCase();

// ---- cards ------------------------------------------------------------------------------------------------------

function drawIntro(ctx: CanvasRenderingContext2D, a: OverlayAssets, local: number) {
  const { t, log, input } = a;
  shade(ctx, 0.58);
  const glow = ctx.createRadialGradient(W / 2, 120, 20, W / 2, 120, 900);
  glow.addColorStop(0, 'rgba(255,170,51,0.28)');
  glow.addColorStop(1, 'rgba(255,170,51,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  const k1 = smooth(0, 500, local);
  ctx.save();
  ctx.globalAlpha = k1;
  drawMark(ctx, W / 2 - 110, 180 + (1 - k1) * 40, 220);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = font(820, 120);
  ctx.fillText('VANDE', W / 2, 540);
  ctx.fillStyle = '#ffc266';
  ctx.font = font(750, 44);
  ctx.fillText('C R I C K E T', W / 2, 604);
  ctx.restore();

  const k2 = smooth(350, 900, local);
  ctx.save();
  ctx.globalAlpha = k2;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#93eeff';
  ctx.font = font(750, 30);
  ctx.fillText(t.t('highlight.sealed_six').toUpperCase(), W / 2, 700);
  ctx.fillStyle = '#ffffff';
  ctx.font = font(820, 62);
  ctx.fillText(fit(ctx, input.fixtureLabel, W - 160), W / 2, 780);
  ctx.fillStyle = '#cac7ee';
  ctx.font = font(560, 34);
  ctx.fillText(a.day, W / 2, 834);
  ctx.restore();

  const k3 = smooth(700, 1300, local);
  ctx.save();
  ctx.globalAlpha = k3;
  const ys = 1060;
  ([0, 1] as const).forEach((p) => {
    const cx = p === 0 ? 290 : W - 290;
    const dx = (1 - k3) * (p === 0 ? -60 : 60);
    portrait(ctx, a.avatars[p], cx + dx, ys, 250, p === 0 ? 'rgba(25,211,250,0.85)' : 'rgba(255,170,51,0.85)');
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = font(820, 46);
    ctx.fillText(fit(ctx, nameOf(a, p), 420), cx + dx, ys + 200);
    const rank = input.ranks[p];
    if (rank !== null) pill(ctx, t.t('highlight.rank', { rank }), cx + dx, ys + 232, 'amber', 26);
  });
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(245,244,255,0.75)';
  ctx.font = font(900, 64);
  ctx.fillText(t.t('highlight.vs').toUpperCase(), W / 2, ys + 22);
  ctx.restore();

  const k4 = smooth(1100, 1600, local);
  ctx.save();
  ctx.globalAlpha = k4;
  const c = log.conditions;
  const a1 = t.t(`pitch.${c.pitch}` as MessageKey);
  const a2 = t.t(`weather.${c.weather}` as MessageKey);
  ctx.font = font(750, 30);
  const w1 = ctx.measureText(a1).width + 45;
  const w2 = ctx.measureText(a2).width + 45;
  const start = W / 2 - (w1 + 18 + w2) / 2;
  pill(ctx, a1, start, 1400, 'clay', 30, 'left');
  pill(ctx, a2, start + w1 + 18, 1400, 'cyan', 30, 'left');
  ctx.restore();
}

function drawResult(ctx: CanvasRenderingContext2D, a: OverlayAssets, local: number) {
  const { t, log } = a;
  shade(ctx, 0.5);
  brandHeader(ctx, a);
  const k = smooth(0, 520, local);
  ctx.save();
  ctx.globalAlpha = k;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffc266';
  ctx.font = font(750, 34);
  ctx.fillText(t.t('highlight.result').toUpperCase(), W / 2, 560);
  ctx.fillStyle = '#ffffff';
  ctx.font = font(820, 84);
  const lines = wrap(ctx, resultText(log.result, log, t, a.input.aliases), W - 140, 3);
  lines.forEach((l, i) => ctx.fillText(l, W / 2, 660 + i * 96));
  const y = 700 + lines.length * 96 + 80;
  ([0, 1] as const).forEach((p) => {
    const inn = log.innings.find((x) => x.batter === p);
    const cx = p === 0 ? W / 2 - 230 : W / 2 + 230;
    portrait(ctx, a.avatars[p], cx, y + 90, 170, log.result.winner === p ? 'rgba(255,170,51,0.9)' : 'rgba(143,135,232,0.6)');
    ctx.fillStyle = '#ffffff';
    ctx.font = font(750, 38);
    ctx.fillText(fit(ctx, nameOf(a, p), 380), cx, y + 230);
    ctx.fillStyle = '#93eeff';
    ctx.font = font(820, 72);
    ctx.fillText(inn ? `${inn.runs}/${inn.wickets}` : '—', cx, y + 312);
  });
  ctx.restore();
}

function drawPotm(ctx: CanvasRenderingContext2D, a: OverlayAssets, local: number) {
  const { t, log } = a;
  shade(ctx, 0.5);
  brandHeader(ctx, a);
  const p = log.result.playerOfMatch;
  const k = smooth(0, 520, local);
  const batted = log.innings.find((x) => x.batter === p);
  const bowled = log.innings.find((x) => x.bowler === p);
  ctx.save();
  ctx.globalAlpha = k;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffc266';
  ctx.font = font(750, 34);
  ctx.fillText(t.t('highlight.potm').toUpperCase(), W / 2, 520);
  const halo = ctx.createRadialGradient(W / 2, 830, 60, W / 2, 830, 360);
  halo.addColorStop(0, 'rgba(255,194,102,0.45)');
  halo.addColorStop(1, 'rgba(255,194,102,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 440, W, 800);
  portrait(ctx, a.avatars[p], W / 2, 830, 360 * (0.92 + 0.08 * backOut(local / 600)), 'rgba(255,170,51,0.95)');
  ctx.fillStyle = '#ffffff';
  ctx.font = font(820, 76);
  ctx.fillText(fit(ctx, nameOf(a, p), W - 160), W / 2, 1110);
  ctx.fillStyle = '#cac7ee';
  ctx.font = font(600, 38);
  ctx.fillText(t.t('highlight.potm_line', { runs: batted?.runs ?? 0, wickets: bowled?.wickets ?? 0 }), W / 2, 1176);
  ctx.restore();
}

function drawStandings(ctx: CanvasRenderingContext2D, a: OverlayAssets, local: number) {
  const { t, input } = a;
  shade(ctx, 0.62);
  brandHeader(ctx, a);
  const rows = (input.standings ?? []).slice(0, 6);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.globalAlpha = smooth(0, 400, local);
  ctx.fillStyle = '#ffc266';
  ctx.font = font(750, 34);
  ctx.fillText(t.t('highlight.standings').toUpperCase(), W / 2, 500);
  ctx.restore();
  rows.forEach((r, i) => {
    const k = smooth(200 + i * 140, 600 + i * 140, local);
    const y = 570 + i * 128;
    ctx.save();
    ctx.globalAlpha = k;
    glassPanel(ctx, 96, y + (1 - k) * 24, W - 192, 108, 26);
    ctx.fillStyle = '#ffffff';
    ctx.font = font(820, 44);
    ctx.fillText(`${r.to}`, 136, y + 70);
    ctx.font = font(700, 38);
    ctx.fillText(fit(ctx, r.alias, 520), 220, y + 68);
    const up = r.from === null ? null : r.from - r.to;
    const label = up === null ? t.t('highlight.new_entry') : up > 0 ? `▲ ${up}` : up < 0 ? `▼ ${-up}` : '•';
    ctx.textAlign = 'right';
    ctx.fillStyle = up === null ? '#e2c9ff' : up > 0 ? '#3ee6a8' : up < 0 ? '#ff7a90' : '#a29fd0';
    ctx.font = font(820, 38);
    ctx.fillText(label, W - 136, y + 68);
    ctx.restore();
  });
}

function drawCta(ctx: CanvasRenderingContext2D, a: OverlayAssets, local: number) {
  const { t, input } = a;
  shade(ctx, 0.66);
  const glow = ctx.createRadialGradient(W / 2, 1000, 40, W / 2, 1000, 760);
  glow.addColorStop(0, 'rgba(25,211,250,0.22)');
  glow.addColorStop(1, 'rgba(25,211,250,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  const k = smooth(0, 500, local);
  ctx.save();
  ctx.globalAlpha = k;
  ctx.textAlign = 'center';
  drawMark(ctx, W / 2 - 70, 170, 140);
  ctx.fillStyle = '#ffffff';
  ctx.font = font(900, 104);
  const lines = wrap(ctx, t.t('highlight.cta_title'), W - 120, 2);
  lines.forEach((l, i) => ctx.fillText(l, W / 2, 470 + i * 116));
  ctx.fillStyle = '#cac7ee';
  ctx.font = font(560, 38);
  wrap(ctx, t.t('highlight.cta_body'), W - 200, 2).forEach((l, i) => ctx.fillText(l, W / 2, 470 + lines.length * 116 + 10 + i * 52));
  if (a.qr) {
    const size = 400;
    const x = W / 2 - size / 2;
    const y = 840;
    ctx.save();
    ctx.shadowColor = 'rgba(25,211,250,0.45)';
    ctx.shadowBlur = 50;
    roundRect(ctx, x - 26, y - 26, size + 52, size + 52, 36);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / a.qr.n, size / a.qr.n);
    ctx.fillStyle = '#06051f';
    ctx.fill(a.qr.path);
    ctx.restore();
    drawMark(ctx, W / 2 - 44, y + size / 2 - 44, 88);
  }
  ctx.fillStyle = '#93eeff';
  ctx.font = font(750, 38);
  ctx.fillText(fit(ctx, input.cta.url.replace(/^https?:\/\//, ''), W - 160), W / 2, 1380);
  ctx.fillStyle = '#ffc266';
  ctx.font = font(750, 30);
  ctx.fillText(t.t('brand.tagline'), W / 2, 1440);
  ctx.restore();
}

/** Draws the overlay for one frame. `local` is the time inside the scene, `replay` what the 3D picture shows. */
export function drawOverlay(ctx: CanvasRenderingContext2D, a: OverlayAssets, scene: Scene, index: number, local: number, replay: number): void {
  ctx.save();
  switch (scene.kind) {
    case 'hook':
      drawHook(ctx, a, scene, local, replay);
      break;
    case 'intro':
      drawIntro(ctx, a, local);
      break;
    case 'ball':
      drawBall(ctx, a, scene, local, replay);
      break;
    case 'result':
      drawResult(ctx, a, local);
      break;
    case 'potm':
      drawPotm(ctx, a, local);
      break;
    case 'standings':
      drawStandings(ctx, a, local);
      break;
    case 'cta':
      drawCta(ctx, a, local);
      break;
  }
  ctx.restore();
  // Cut through black between scenes (and in from black at the start).
  // The hook starts on its first frame (a Short has two seconds to catch the eye); later cuts dip briefly.
  const dip = scene.kind === 'hook' ? 0 : 1 - smooth(0, index === 0 ? 450 : 220, local);
  const out = scene.t1 - scene.t0 - local;
  const dipOut = index === a.plan.scenes.length - 1 ? 1 - smooth(0, 600, out) : 1 - smooth(0, 160, out);
  const black = Math.max(dip, dipOut) * 0.92;
  if (black > 0.002) {
    ctx.fillStyle = `rgba(3,2,26,${black})`;
    ctx.fillRect(0, 0, W, H);
  }
}
