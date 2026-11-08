/**
 * Classic's painted venue (the 2D stage's equivalent of the 3D stadium): original, drawn from code, no asset bytes.
 *
 * The batter's eye never moves, so the bowl behind the bowler is painted once, from that eye, onto a strip (an offscreen
 * canvas): the two tiers with seated spectators in rows, aisles, the ribbon between the tiers, the roof, the pavilion
 * behind the sight screen and the boundary boards. Every frame the strip is drawn through the live pinhole camera in
 * narrow slices, so it stays where the stands are when the gaze turns, at any aspect, without a draw call per person.
 * Geometry comes from `core/venueGeometry.ts` (the same numbers the 3D stadium builds with). The sight screen, the pitch and
 * the players are drawn after it by `batterView.ts`, so the ball still reads against the dark screen.
 *
 * The picture is seeded (deterministic) and evening-lit, like Classic's sky. A host whose canvas is not a real one (a test
 * double, no offscreen canvas) gets `-1` back and paints its plain band, exactly as before this module existed.
 */
import type { CameraPose } from '../core/camera';
import { BOUNDARY_R } from '../core/ground';
import { seededStream, type Vec3 } from '../core/math';
import {
  BACK_WALL,
  FASCIA,
  PARAPET,
  ROOF,
  SIGHT_SCREEN_GAP_HALF,
  STAND_ROWS,
  STAND_TIERS,
  azimuthOf,
  ringPoint,
  wallHeight,
  type StandTier,
} from '../core/venueGeometry';

/** Strip size in pixels: 2048 across 132 degrees of the bowl, 192 up the wall. */
export const STRIP_W = 2048;
export const STRIP_H = 192;
/** The strip covers azimuth PI (the bowler's end) plus or minus this much. */
export const STRIP_SPAN = (66 * Math.PI) / 180;
/** The vertical wall (metres from the pitch's centre, on the bowler's end axis) the picture hangs on. */
export const WALL_R = 95;
/** Wall heights of the strip's bottom (the ground at the boards) and top (the roof's high front lip). */
export const H_BOT = wallHeight(BOUNDARY_R + 8, 0, WALL_R);
export const H_TOP = wallHeight(ROOF.rInner, ROOF.y + ROOF.h / 2, WALL_R);
/** Slices drawn per frame. */
export const SLICES = 24;

export interface VenueHost {
  readonly ctx: CanvasRenderingContext2D;
  readonly w: number;
  readonly h: number;
  project(p: Vec3): { x: number; y: number; d: number } | null;
}

/** Strip x of an azimuth: x grows with the screen, that is, as the azimuth falls (the batter faces -z, a = PI). */
const stripX = (a: number) => ((Math.PI + STRIP_SPAN - a) / (2 * STRIP_SPAN)) * STRIP_W;
/** Strip y of a wall height. */
const stripY = (h: number) => ((H_TOP - h) / (H_TOP - H_BOT)) * STRIP_H;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Seated spectators' shirts (indigo and orange are the home and away blocks of the 3D stands) and skin. */
const SHIRTS = [
  '#3b2fc9',
  '#e8901a',
  '#f2f2ee',
  '#ffb347',
  '#5fcdf2',
  '#e65c80',
  '#ffd46e',
  '#2e3342',
  '#7dd6b3',
] as const;
const SHIRT_WEIGHT = [0.2, 0.17, 0.14, 0.08, 0.08, 0.08, 0.07, 0.1, 0.08];
const SKIN = '#8a5a3c';

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (s: number) => Math.round(Math.min(255, ((n >> s) & 255) * f));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

/**
 * Paints the whole strip. Deterministic: the same canvas calls in the same order every time (a test pins this).
 * Back rows first so the front rows cover them; the upper tier before the lower.
 */
export function paintVenueStrip(g: CanvasRenderingContext2D): void {
  const rand = seededStream(2026);
  g.fillStyle = '#0d0b28';
  g.fillRect(0, 0, STRIP_W, STRIP_H);

  const pickShirt = (): number => {
    let t = rand();
    for (let i = 0; i < SHIRT_WEIGHT.length; i++) {
      t -= SHIRT_WEIGHT[i];
      if (t <= 0) return i;
    }
    return SHIRT_WEIGHT.length - 1;
  };

  const paintTier = (tier: StandTier, rows: number, glow: number) => {
    for (let k = rows - 1; k >= 0; k--) {
      const ra = lerp(tier.r0, tier.r1, k / rows);
      const rb = lerp(tier.r0, tier.r1, (k + 1) / rows);
      const ya = lerp(tier.y0, tier.y1, k / rows);
      const yb = lerp(tier.y0, tier.y1, (k + 1) / rows);
      // The riser face, then a dark line where the tread meets the next riser.
      const top = stripY(wallHeight(ra, yb, WALL_R));
      const bottom = stripY(wallHeight(ra, ya, WALL_R));
      const front = 1 - (k / rows) * 0.45;
      g.fillStyle = shade('#6d7098', glow * front);
      g.fillRect(0, top, STRIP_W, bottom - top + 0.5);
      // Seated people on the tread, 0.5 m wide at 0.62 m a seat, aisles every 18 m of arc, one seat in six empty.
      const rs = ra + (rb - ra) * 0.42;
      const step = 0.62 / rs;
      const wAz = 0.5 / rs;
      const seatY = stripY(wallHeight(rs, yb, WALL_R));
      const bodyTop = stripY(wallHeight(rs, yb + 0.62, WALL_R));
      const headTop = stripY(wallHeight(rs, yb + 0.86, WALL_R));
      const pxPerRad = STRIP_W / (2 * STRIP_SPAN);
      const bodies: number[][] = SHIRTS.map(() => []);
      const heads: number[] = [];
      for (let a = Math.PI - STRIP_SPAN; a < Math.PI + STRIP_SPAN; a += step) {
        if (Math.abs(a - Math.PI) < SIGHT_SCREEN_GAP_HALF + 0.03) continue;
        const s = a * rs;
        if (Math.abs((((s % 18) + 18) % 18) - 9) > 8.3) continue;
        if (rand() < 0.16) continue;
        const x = stripX(a + wAz / 2);
        const w = wAz * pxPerRad;
        bodies[pickShirt()].push(x, bodyTop, w, seatY - bodyTop);
        heads.push(x + w * 0.22, headTop, w * 0.56, bodyTop - headTop + 0.4);
      }
      for (let i = 0; i < SHIRTS.length; i++) {
        if (!bodies[i].length) continue;
        g.fillStyle = shade(SHIRTS[i], glow * front * 0.72);
        g.beginPath();
        for (let j = 0; j < bodies[i].length; j += 4)
          g.rect(bodies[i][j], bodies[i][j + 1], bodies[i][j + 2], bodies[i][j + 3]);
        g.fill();
      }
      g.fillStyle = shade(SKIN, glow * front * 0.8);
      g.beginPath();
      for (let j = 0; j < heads.length; j += 4) g.rect(heads[j], heads[j + 1], heads[j + 2], heads[j + 3]);
      g.fill();
    }
  };
  paintTier(STAND_TIERS.upper, STAND_ROWS.upper, 0.62);
  paintTier(STAND_TIERS.lower, STAND_ROWS.lower, 0.78);

  // Behind the sight screen both tiers stop: a dark void and the back wall (24 to 29 m at 109.6 m) show through the gap.
  const gap0 = stripX(Math.PI + SIGHT_SCREEN_GAP_HALF);
  const gapW = stripX(Math.PI - SIGHT_SCREEN_GAP_HALF) - gap0;
  g.fillStyle = '#0b0a24';
  g.fillRect(gap0, 0, gapW, STRIP_H);
  const wallLow = stripY(wallHeight(BACK_WALL.r, BACK_WALL.y0, WALL_R));
  g.fillStyle = '#262843';
  g.fillRect(
    gap0,
    stripY(wallHeight(BACK_WALL.r, BACK_WALL.y1, WALL_R)),
    gapW,
    wallLow - stripY(wallHeight(BACK_WALL.r, BACK_WALL.y1, WALL_R)),
  );

  // The ribbon between the tiers: an LED band with a cyan keyline.
  const ribbonTop = stripY(wallHeight(FASCIA.r, FASCIA.y + FASCIA.h / 2, WALL_R));
  const ribbonBottom = stripY(wallHeight(FASCIA.r, FASCIA.y - FASCIA.h / 2, WALL_R));
  g.fillStyle = '#1b2670';
  g.fillRect(0, ribbonTop, STRIP_W, ribbonBottom - ribbonTop);
  g.fillStyle = 'rgba(95,227,255,0.55)';
  g.fillRect(0, ribbonTop, STRIP_W, 1);

  // The roof: its underside between the low back edge and the high front lip, with a pale rim against the sky.
  const roofLow = stripY(wallHeight(ROOF.rOuter, ROOF.y - ROOF.h / 2, WALL_R));
  g.fillStyle = '#16133a';
  g.fillRect(0, 0, STRIP_W, roofLow);
  g.fillStyle = 'rgba(143,152,216,0.7)';
  g.fillRect(0, 0, STRIP_W, 2);
  g.fillStyle = 'rgba(8,6,24,0.55)';
  for (let a = Math.PI - STRIP_SPAN; a < Math.PI + STRIP_SPAN; a += 0.052) g.fillRect(stripX(a), 0, 3, roofLow); // trusses

  // The pavilion behind the sight screen: 56 m wide and 15 m high at 81 m, a tower above its middle, lit balconies.
  const pr = BOUNDARY_R + 19;
  const half = Math.atan2(28, pr);
  const px0 = stripX(Math.PI + half);
  const pw = stripX(Math.PI - half) - px0;
  const pTop = stripY(wallHeight(pr, 15, WALL_R));
  const pBottom = stripY(wallHeight(pr, 0, WALL_R));
  g.fillStyle = '#3e3a4a';
  g.fillRect(px0, pTop, pw, pBottom - pTop);
  const towerHalf = Math.atan2(7.5, pr);
  g.fillRect(
    stripX(Math.PI + towerHalf),
    stripY(wallHeight(pr + 1, 22, WALL_R)),
    stripX(Math.PI - towerHalf) - stripX(Math.PI + towerHalf),
    pTop - stripY(wallHeight(pr + 1, 22, WALL_R)),
  );
  g.fillStyle = 'rgba(255,214,160,0.78)';
  for (const [y0, y1] of [
    [3.2, 5.2],
    [8.2, 10.4],
  ] as const) {
    const t = stripY(wallHeight(pr, y1, WALL_R));
    const b = stripY(wallHeight(pr, y0, WALL_R));
    for (let i = 0; i < 18; i++) g.fillRect(px0 + (pw * (i + 0.12)) / 18, t, (pw * 0.62) / 18, b - t);
  }

  // The boundary boards along the rope: dark panels with a cyan edge and original accent blocks (no lettering).
  const boardTop = stripY(wallHeight(PARAPET.r, PARAPET.y1, WALL_R));
  g.fillStyle = '#0b1235';
  g.fillRect(0, boardTop, STRIP_W, STRIP_H - boardTop);
  g.fillStyle = 'rgba(95,227,255,0.6)';
  g.fillRect(0, boardTop, STRIP_W, 1);
  for (let x = 14; x + 20 <= STRIP_W; x += 52) {
    g.fillStyle = (x / 52) % 3 < 1 ? 'rgba(255,170,51,0.55)' : 'rgba(95,227,255,0.38)';
    g.fillRect(x, boardTop + 3, 20, Math.max(2, STRIP_H - boardTop - 6));
  }
}

/** Whether the host's canvas is a real one (a recording test double or a partial mock has no numeric canvas width). */
function isRealContext(ctx: CanvasRenderingContext2D): boolean {
  const c = (ctx as unknown as { canvas?: unknown }).canvas;
  return typeof c === 'object' && c !== null && typeof (c as { width?: unknown }).width === 'number';
}

/** Makes the offscreen strip canvas and its 2D context, or null where there is none (tests inject their own). */
export type StripFactory = () => { canvas: CanvasImageSource; ctx: CanvasRenderingContext2D } | null;

const makeStrip: StripFactory = () => {
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const c = new OffscreenCanvas(STRIP_W, STRIP_H);
      const ctx = c.getContext('2d');
      return ctx ? { canvas: c, ctx: ctx as unknown as CanvasRenderingContext2D } : null;
    }
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = STRIP_W;
      c.height = STRIP_H;
      const ctx = c.getContext('2d');
      return ctx ? { canvas: c, ctx } : null;
    }
  } catch {
    /* no offscreen canvas: the host paints its plain band */
  }
  return null;
};

export class ClassicVenue {
  private strip: CanvasImageSource | null = null;
  private failed = false;

  constructor(private readonly make: StripFactory = makeStrip) {}

  /** Paints the strip now (at mount, never inside a delivery). A host with no real canvas keeps its plain band. */
  prepare(ctx: CanvasRenderingContext2D): boolean {
    if (this.strip) return true;
    if (this.failed || !isRealContext(ctx)) return false;
    try {
      const made = this.make();
      if (!made) throw new Error('no canvas');
      paintVenueStrip(made.ctx);
      this.strip = made.canvas;
      return true;
    } catch {
      this.failed = true;
      return false;
    }
  }

  /**
   * Draws the bowl through the camera in SLICES vertical slices; returns the draw calls made, or -1 when there is no
   * picture (the caller paints its plain band). The camera must face the bowler's end for any of it to show.
   */
  paint(host: VenueHost, cam: CameraPose): number {
    if (!this.strip && !this.prepare(host.ctx)) return -1;
    const strip = this.strip!;
    const f = { x: cam.target.x - cam.pos.x, z: cam.target.z - cam.pos.z };
    const forward = azimuthOf(f.x, f.z);
    const focal = host.h / 2 / Math.tan((cam.fov * Math.PI) / 360);
    const halfH = Math.atan(host.w / 2 / focal);
    // The azimuth range on screen, kept inside what the strip holds; azimuth falls from the left of the screen to the right.
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const centre = Math.PI + wrap(forward - Math.PI);
    const hi = Math.min(centre + halfH + 0.04, Math.PI + STRIP_SPAN);
    const lo = Math.max(centre - halfH - 0.04, Math.PI - STRIP_SPAN);
    if (!(hi > lo)) return -1;
    const g = host.ctx;
    const dA = (hi - lo) / SLICES;
    let calls = 0;
    for (let i = 0; i < SLICES; i++) {
      const a0 = hi - i * dA;
      const a1 = a0 - dA;
      const am = (a0 + a1) / 2;
      const left = host.project(ringPoint(a0, WALL_R, (H_TOP + H_BOT) / 2));
      const right = host.project(ringPoint(a1, WALL_R, (H_TOP + H_BOT) / 2));
      const top = host.project(ringPoint(am, WALL_R, H_TOP));
      const bottom = host.project(ringPoint(am, WALL_R, H_BOT));
      if (!left || !right || !top || !bottom) continue;
      const dw = right.x - left.x;
      if (!(dw > 0.2) || !(bottom.y > top.y)) continue;
      const sx = stripX(a0);
      g.drawImage(strip, sx, 0, stripX(a1) - sx, STRIP_H, left.x, top.y, dw + 0.6, bottom.y - top.y);
      calls++;
    }
    return calls;
  }
}
