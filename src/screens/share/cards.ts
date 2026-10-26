/**
 * Share cards, drawn locally on a canvas (no server, no uploads): the invitation, a match card (spoiler-safe until the
 * reveal), the Daily Six result and a practice "beat my over" card. 1080x1350 (4:5) so WhatsApp and the share sheet
 * show them large. Every card is useful to someone who has never played: what the game is, the challenge, and a link
 * that opens in the browser with no install.
 */
import type { Conditions, KitSpec, MatchEventLog, PlayerRef, AvatarSpec } from '@/contracts';
import type { MessageKey, Translator } from '@/i18n';
import { drawMark } from '@/ui/brand/mark';
import { avatarImage } from '@/ui/avatar/avatarSvg';

export const CARD_W = 1080;
export const CARD_H = 1350;

export interface CardPlayer {
  alias: string;
  avatar: AvatarSpec;
  kit?: KitSpec;
}

export type CardModel =
  | { kind: 'invite'; eyebrow: string; title: string; body: string; players: [CardPlayer]; chips: string[]; cta: string; url: string }
  | { kind: 'match'; eyebrow: string; title: string; body: string; players: [CardPlayer, CardPlayer]; score: [string, string] | null; result: string | null; potm: string | null; cta: string; url: string }
  | { kind: 'daily'; eyebrow: string; title: string; body: string; players: [CardPlayer]; big: string; stats: Array<{ text: string; tone: 'amber' | 'violet' | 'cyan' }>; cta: string; url: string }
  | { kind: 'practice'; eyebrow: string; title: string; body: string; players: [CardPlayer, CardPlayer]; score: [string, string]; result: string; cta: string; url: string };

const conditionChips = (t: Translator, c: Conditions | null) => (c ? [t.t(`pitch.${c.pitch}` as MessageKey), t.t(`weather.${c.weather}` as MessageKey)] : []);
const shortUrl = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

export function inviteCardModel(t: Translator, o: { inviter: CardPlayer; conditions: Conditions | null; url: string; cup?: { name: string | null } }): CardModel {
  // A Group Cup invite says what joining means: round robin, one sealed over per round before its deadline, a final.
  if (o.cup)
    return {
      kind: 'invite',
      eyebrow: t.t('card.cup_invite.eyebrow'),
      title: o.cup.name ? t.t('card.cup_invite.title', { name: o.inviter.alias, cup: o.cup.name }) : t.t('card.cup_invite.title_unnamed', { name: o.inviter.alias }),
      body: t.t('card.cup_invite.body'),
      players: [o.inviter],
      chips: [t.t('card.cup_invite.chip_format'), t.t('card.cup_invite.chip_final')],
      cta: t.t('card.cup_invite.cta'),
      url: shortUrl(o.url),
    };
  return {
    kind: 'invite',
    eyebrow: t.t('card.invite.eyebrow'),
    title: t.t('card.invite.title', { name: o.inviter.alias }),
    body: t.t('card.invite.body'),
    players: [o.inviter],
    chips: conditionChips(t, o.conditions),
    cta: t.t('card.cta_browser'),
    url: shortUrl(o.url),
  };
}

/** Before the reveal: names and the sealed state only. After: both scores, the result and Player of the Match. */
export function matchCardModel(t: Translator, o: { log: MatchEventLog | null; players: [CardPlayer, CardPlayer]; revealed: boolean; url: string }): CardModel {
  const base = { kind: 'match' as const, players: o.players, url: shortUrl(o.url), cta: t.t('card.cta_watch') };
  if (!o.revealed || !o.log) return { ...base, eyebrow: t.t('card.match.eyebrow_sealed'), title: t.t('card.match.title_sealed'), body: t.t('card.match.body_sealed'), score: null, result: null, potm: null };
  const log = o.log;
  const score = log.innings.map((inn) => t.t('card.score', { runs: inn.runs, wickets: inn.wickets })) as [string, string];
  const r = log.result;
  const result = r.tie || r.winner === null ? t.t('card.match.tie') : t.t('card.match.won', { name: log.players[r.winner].alias });
  return { ...base, eyebrow: t.t('card.match.eyebrow_revealed'), title: t.t('card.match.title_revealed'), body: t.t('card.match.body_revealed'), score, result, potm: t.t('card.potm', { name: log.players[r.playerOfMatch].alias }) };
}

export function dailyCardModel(t: Translator, o: { player: CardPlayer; day: string; score: number; best: number | null; streak: number; conditions: Conditions | null; url: string }): CardModel {
  const stats: Array<{ text: string; tone: 'amber' | 'violet' | 'cyan' }> = [];
  // Only a counted score is a best (an attempt with irregular balls counts on no board).
  if (o.best !== null) stats.push({ text: t.t('card.daily.best', { score: t.number(o.best) }), tone: 'amber' });
  if (o.streak > 0) stats.push({ text: t.t('card.daily.streak', { count: o.streak }), tone: 'violet' });
  for (const c of conditionChips(t, o.conditions)) stats.push({ text: c, tone: 'cyan' });
  return {
    kind: 'daily',
    eyebrow: t.t('card.daily.eyebrow', { day: t.date(`${o.day}T12:00:00+05:30`, { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) }),
    title: t.t('card.daily.title', { name: o.player.alias }),
    body: t.t('card.daily.body'),
    players: [o.player],
    big: t.number(o.score),
    stats,
    cta: t.t('card.cta_browser'),
    url: shortUrl(o.url),
  };
}

export function practiceCardModel(t: Translator, o: { me: CardPlayer; ghost: CardPlayer; myScore: [number, number]; ghostScore: [number, number]; result: 'won' | 'lost' | 'tie'; url: string }): CardModel {
  return {
    kind: 'practice',
    eyebrow: t.t('card.practice.eyebrow'),
    title: t.t('card.practice.title', { name: o.me.alias }),
    body: t.t('card.practice.body', { ghost: o.ghost.alias }),
    players: [o.me, o.ghost],
    score: [t.t('card.score', { runs: o.myScore[0], wickets: o.myScore[1] }), t.t('card.score', { runs: o.ghostScore[0], wickets: o.ghostScore[1] })],
    result: o.result === 'won' ? t.t('card.practice.won', { ghost: o.ghost.alias }) : o.result === 'lost' ? t.t('card.practice.lost', { ghost: o.ghost.alias }) : t.t('card.match.tie'),
    cta: t.t('card.cta_beat'),
    url: shortUrl(o.url),
  };
}

export function playerOf(p: PlayerRef): CardPlayer {
  return { alias: p.alias, avatar: p.avatar, kit: p.kit };
}

// ---- drawing --------------------------------------------------------------------------------------------------

const FONT = '"Manrope Variable", Manrope, "Noto Sans Devanagari", system-ui, sans-serif';

async function fontsReady(locale: string): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const loads = [document.fonts.load(`800 64px "Manrope Variable"`), document.fonts.load(`500 32px "Manrope Variable"`)];
  if (locale === 'hi' || locale === 'mr') loads.push(document.fonts.load(`700 48px "Noto Sans Devanagari"`, 'अआ'));
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 1500))]).catch(() => undefined);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth || !line) line = next;
    else {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
    let last = lines[maxLines - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

function background(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1d1858');
  g.addColorStop(0.45, '#0f0c33');
  g.addColorStop(1, '#06051f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Floodlight glows.
  for (const [x, y, r, a] of [
    [W * 0.12, -40, 520, 0.32],
    [W * 0.88, -40, 520, 0.32],
  ] as const) {
    const fl = ctx.createRadialGradient(x, y, 10, x, y, r);
    fl.addColorStop(0, `rgba(255, 196, 110, ${a})`);
    fl.addColorStop(1, 'rgba(255, 196, 110, 0)');
    ctx.fillStyle = fl;
    ctx.fillRect(0, 0, W, H);
  }
  // Floodlight towers and lamps.
  ctx.fillStyle = 'rgba(255, 236, 200, 0.95)';
  for (const x of [W * 0.12, W * 0.88]) {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) ctx.fillRect(x - 34 + i * 18, 40 + j * 16, 12, 10);
  }
  // Stand silhouette.
  ctx.fillStyle = 'rgba(3, 2, 26, 0.55)';
  ctx.beginPath();
  ctx.moveTo(0, H * 0.34);
  ctx.quadraticCurveTo(W / 2, H * 0.24, W, H * 0.34);
  ctx.lineTo(W, H * 0.42);
  ctx.quadraticCurveTo(W / 2, H * 0.33, 0, H * 0.42);
  ctx.closePath();
  ctx.fill();
  // Outfield and the pitch strip in perspective.
  const field = ctx.createRadialGradient(W / 2, H * 1.05, 40, W / 2, H * 1.05, H * 0.75);
  field.addColorStop(0, 'rgba(58, 154, 92, 0.45)');
  field.addColorStop(1, 'rgba(13, 59, 44, 0)');
  ctx.fillStyle = field;
  ctx.fillRect(0, H * 0.4, W, H * 0.6);
  const strip = ctx.createLinearGradient(0, H * 0.62, 0, H);
  strip.addColorStop(0, 'rgba(210, 170, 114, 0.04)');
  strip.addColorStop(1, 'rgba(210, 170, 114, 0.2)');
  ctx.fillStyle = strip;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 60, H * 0.62);
  ctx.lineTo(W / 2 + 60, H * 0.62);
  ctx.lineTo(W / 2 + 170, H);
  ctx.lineTo(W / 2 - 170, H);
  ctx.closePath();
  ctx.fill();
  // Popping crease near the bottom, in chalk.
  ctx.strokeStyle = 'rgba(244, 241, 232, 0.28)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 230, H * 0.93);
  ctx.lineTo(W / 2 + 230, H * 0.93);
  ctx.stroke();
  // Grain-free vignette.
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.8);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(2,1,16,0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function chip(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, tone: 'cyan' | 'amber' | 'violet'): number {
  ctx.font = `700 30px ${FONT}`;
  const w = ctx.measureText(text).width + 48;
  roundRect(ctx, x, y, w, 58, 29);
  const colors = { cyan: ['rgba(25,211,250,0.16)', '#93eeff'], amber: ['rgba(255,170,51,0.18)', '#ffdba3'], violet: ['rgba(195,140,255,0.18)', '#e2c9ff'] }[tone];
  ctx.fillStyle = colors[0];
  ctx.fill();
  ctx.strokeStyle = colors[1];
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = colors[1];
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 24, y + 30);
  ctx.textBaseline = 'alphabetic';
  return w;
}

async function drawPortrait(ctx: CanvasRenderingContext2D, p: CardPlayer, cx: number, cy: number, size: number) {
  try {
    const img = await avatarImage(p.avatar, p.kit, size * 2);
    ctx.save();
    ctx.shadowColor = 'rgba(2,1,16,0.6)';
    ctx.shadowBlur = 30;
    ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
    ctx.restore();
  } catch {
    ctx.fillStyle = '#28216f';
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Draws a card model into a canvas (exported for previews and tests in real browsers). */
export async function drawCard(canvas: HTMLCanvasElement, m: CardModel, locale: string): Promise<void> {
  await fontsReady(locale);
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  const W = CARD_W;
  const H = CARD_H;
  background(ctx, W, H);
  const pad = 84;

  // Brand header.
  drawMark(ctx, pad, 72, 92);
  ctx.fillStyle = '#f5f4ff';
  ctx.font = `820 46px ${FONT}`;
  ctx.fillText('VANDE', pad + 116, 118);
  ctx.fillStyle = '#ffc266';
  ctx.font = `750 24px ${FONT}`;
  ctx.fillText('CRICKET  ·  SEALED SIX', pad + 118, 152);

  // Eyebrow + title + body.
  let y = 300;
  ctx.fillStyle = '#ffc266';
  ctx.font = `750 30px ${FONT}`;
  ctx.fillText(m.eyebrow.toUpperCase(), pad, y);
  y += 26;
  ctx.fillStyle = '#ffffff';
  ctx.font = `820 76px ${FONT}`;
  for (const line of wrap(ctx, m.title, W - pad * 2, 3)) {
    y += 86;
    ctx.fillText(line, pad, y);
  }
  ctx.fillStyle = '#cac7ee';
  ctx.font = `500 36px ${FONT}`;
  y += 26;
  for (const line of wrap(ctx, m.body, W - pad * 2, 3)) {
    y += 50;
    ctx.fillText(line, pad, y);
  }

  // Middle: players and numbers, kept clear of the footer.
  const fy0 = H - 170;
  const mid = m.kind === 'invite' || m.kind === 'daily' ? Math.max(y + 70, 760) : Math.min(Math.max(y + 50, 640), fy0 - 470);
  if (m.kind === 'invite' || m.kind === 'daily') {
    const p = m.players[0];
    await drawPortrait(ctx, p, pad + 110, mid + 90, 220);
    ctx.fillStyle = '#ffffff';
    ctx.font = `750 48px ${FONT}`;
    ctx.fillText(wrap(ctx, p.alias, 560, 1)[0] ?? '', pad + 260, mid + 70);
    if (m.kind === 'invite') {
      let x = pad + 260;
      for (const [i, c] of m.chips.entries()) x += chip(ctx, c, x, mid + 100, i === 0 ? 'amber' : 'cyan') + 14;
    } else {
      ctx.fillStyle = '#ffaa33';
      ctx.font = `820 132px ${FONT}`;
      ctx.fillText(m.big, pad + 260, mid + 200);
      let x = pad;
      for (const c of m.stats) {
        const w = chip(ctx, c.text, x, mid + 250, c.tone);
        x += w + 14;
        if (x > W - 300) break;
      }
    }
  } else {
    const [a, b] = m.players;
    await drawPortrait(ctx, a, pad + 100, mid + 90, 190);
    await drawPortrait(ctx, b, W - pad - 100, mid + 90, 190);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = `750 38px ${FONT}`;
    ctx.fillText(wrap(ctx, a.alias, 300, 1)[0] ?? '', pad + 100, mid + 230);
    ctx.fillText(wrap(ctx, b.alias, 300, 1)[0] ?? '', W - pad - 100, mid + 230);
    if (m.score) {
      ctx.fillStyle = '#93eeff';
      ctx.font = `820 64px ${FONT}`;
      ctx.fillText(m.score[0], pad + 100, mid + 300);
      ctx.fillText(m.score[1], W - pad - 100, mid + 300);
      ctx.fillStyle = '#a29fd0';
      ctx.font = `750 40px ${FONT}`;
      ctx.fillText('VS', W / 2, mid + 100);
    } else {
      // Sealed: a seal emblem instead of numbers.
      drawMark(ctx, W / 2 - 70, mid + 20, 140);
      ctx.fillStyle = '#e2c9ff';
      ctx.font = `750 32px ${FONT}`;
      ctx.fillText(m.eyebrow, W / 2, mid + 210);
    }
    if (m.result) {
      ctx.fillStyle = '#ffdba3';
      ctx.font = `820 46px ${FONT}`;
      ctx.fillText(wrap(ctx, m.result, W - pad * 2, 1)[0] ?? '', W / 2, mid + 375);
    }
    if (m.kind === 'match' && m.potm && mid + 425 < fy0 - 20) {
      ctx.fillStyle = '#cac7ee';
      ctx.font = `600 32px ${FONT}`;
      ctx.fillText(m.potm, W / 2, mid + 425);
    }
    ctx.textAlign = 'left';
  }

  // Footer: call to action and the link (opens in the browser, no install).
  const fy = H - 170;
  roundRect(ctx, pad, fy, W - pad * 2, 110, 55);
  const cta = ctx.createLinearGradient(pad, fy, W - pad, fy + 110);
  cta.addColorStop(0, '#ffc266');
  cta.addColorStop(1, '#ffaa33');
  ctx.fillStyle = cta;
  ctx.fill();
  ctx.fillStyle = '#1c0f00';
  ctx.textAlign = 'center';
  ctx.font = `820 40px ${FONT}`;
  ctx.fillText(wrap(ctx, m.cta, W - pad * 2 - 80, 1)[0] ?? '', W / 2, fy + 52);
  ctx.fillText(fitLine(ctx, m.url, W - pad * 2 - 80, 650, 28, 22), W / 2, fy + 90);
  ctx.textAlign = 'left';
}

/**
 * One line that always fits `maxWidth`: smaller type first, then the middle elided (a link keeps its host and its
 * end, so it stays recognisable; the full link travels in the message itself). Leaves `ctx.font` set.
 */
export function fitLine(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, weight: number, maxPx: number, minPx: number): string {
  for (let px = maxPx; px >= minPx; px -= 2) {
    ctx.font = `${weight} ${px}px ${FONT}`;
    if (ctx.measureText(text).width <= maxWidth) return text;
  }
  for (let keep = text.length - 1; keep > 8; keep--) {
    const head = Math.ceil(keep * 0.7);
    const s = `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
    if (ctx.measureText(s).width <= maxWidth) return s;
  }
  return `${text.slice(0, 8)}…`;
}

/** Renders a card to a PNG blob (null where canvas is unavailable). */
export async function cardBlob(m: CardModel, locale: string): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    await drawCard(canvas, m, locale);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  } catch {
    return null;
  }
}
