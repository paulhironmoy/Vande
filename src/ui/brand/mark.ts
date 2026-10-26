/**
 * The VANDE Cricket mark: a white match ball whose seam forms a V, inside an amber hexagon seal (six sides for the
 * Sealed Six). Original artwork defined in code so the app, the share cards, the highlight overlays and every
 * exported brand file (public/brand, public/icons, Android launcher and splash) draw the same geometry.
 */

export const MARK_VIEWBOX = 120;

type P = [number, number];

function hexPath(cx: number, cy: number, r: number): string {
  const pts = [-90, -30, 30, 90, 150, 210].map((a) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)]);
  return `M${pts.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' L')}Z`;
}

const qPoint = (p0: P, c: P, p1: P, t: number): P => [(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1]];
const qTangent = (p0: P, c: P, p1: P, t: number): P => [2 * (1 - t) * (c[0] - p0[0]) + 2 * t * (p1[0] - c[0]), 2 * (1 - t) * (c[1] - p0[1]) + 2 * t * (p1[1] - c[1])];

function stitches(p0: P, c: P, p1: P, gap: number, n: number, len: number): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = 0.1 + (i * 0.62) / (n - 1);
    const [x, y] = qPoint(p0, c, p1, t);
    const [dx, dy] = qTangent(p0, c, p1, t);
    const l = Math.hypot(dx, dy);
    const tx = dx / l;
    const ty = dy / l;
    const nx = -ty;
    const ny = tx;
    for (const side of [-1, 1]) {
      const bx = x + nx * gap * side;
      const by = y + ny * gap * side;
      out.push(`M${(bx - (tx * len) / 2 - nx * side * 1.1).toFixed(2)} ${(by - (ty * len) / 2 - ny * side * 1.1).toFixed(2)}L${(bx + (tx * len) / 2 + nx * side * 1.1).toFixed(2)} ${(by + (ty * len) / 2 + ny * side * 1.1).toFixed(2)}`);
    }
  }
  return out.join('');
}

const LEFT: [P, P, P] = [[40, 36], [47, 70], [60, 88]];
const RIGHT: [P, P, P] = [[80, 36], [73, 70], [60, 88]];
const q = ([a, b, c]: [P, P, P]) => `M${a[0]} ${a[1]}Q${b[0]} ${b[1]} ${c[0]} ${c[1]}`;

export const MARK = {
  hex: hexPath(60, 60, 52),
  ball: { cx: 60, cy: 61, r: 33 },
  seam: `${q(LEFT)}${q(RIGHT)}`,
  stitches: `${stitches(...LEFT, 5.8, 5, 3)}${stitches(...RIGHT, 5.8, 5, 3)}`,
} as const;

export const BRAND_COLORS = {
  night: '#06051f',
  night2: '#151143',
  indigo: '#2b2378',
  amberLight: '#ffdba3',
  amber: '#ffaa33',
  amberDeep: '#e08a12',
  seam: '#0aa6cc',
  cyan: '#19d3fa',
  chalk: '#f5f4ff',
} as const;

/** Draws the mark on a 2D canvas at (x, y) with the given size (share cards and highlight overlays). */
export function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const s = size / MARK_VIEWBOX;
  const c = BRAND_COLORS;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  const bg = ctx.createRadialGradient(60, 36, 4, 60, 40, 90);
  bg.addColorStop(0, c.indigo);
  bg.addColorStop(0.6, c.night2);
  bg.addColorStop(1, c.night);
  const gold = ctx.createLinearGradient(0, 0, 120, 120);
  gold.addColorStop(0, c.amberLight);
  gold.addColorStop(0.45, c.amber);
  gold.addColorStop(1, c.amberDeep);
  const hex = new Path2D(MARK.hex);
  ctx.fillStyle = bg;
  ctx.fill(hex);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 6;
  ctx.strokeStyle = gold;
  ctx.stroke(hex);
  const ball = ctx.createRadialGradient(47, 49, 2, 55, 55, 40);
  ball.addColorStop(0, '#ffffff');
  ball.addColorStop(0.55, '#e9e7fb');
  ball.addColorStop(1, '#a9a3e6');
  ctx.fillStyle = ball;
  ctx.beginPath();
  ctx.arc(MARK.ball.cx, MARK.ball.cy, MARK.ball.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineCap = 'round';
  ctx.strokeStyle = c.seam;
  ctx.lineWidth = 6.5;
  ctx.stroke(new Path2D(MARK.seam));
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.8;
  ctx.stroke(new Path2D(MARK.stitches));
  ctx.restore();
}
