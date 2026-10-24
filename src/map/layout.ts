/**
 * Shared geometry, palette and deterministic shape helpers for the city map.
 * Used by the Pixi scene, the SVG fallback and the accessible HTML overlay so
 * every layer agrees on where things are.
 */
import type { DistrictKind, MapDistrictView, MapState, SignalKind } from '@/engine/types';

export interface Point {
  x: number;
  y: number;
}

export interface Layout {
  width: number;
  height: number;
  /** Content box (letterboxed only at extreme aspect ratios). */
  box: { x: number; y: number; w: number; h: number };
  /** Base size unit; district footprint radius ≈ unit. */
  unit: number;
  /** Narrow layouts use short labels and tighter spacing. */
  compact: boolean;
  project(x: number, y: number): Point;
}

const MIN_ASPECT = 0.78;
const MAX_ASPECT = 1.95;

export function computeLayout(width: number, height: number): Layout {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const aspect = w / h;
  let bw = w;
  let bh = h;
  if (aspect > MAX_ASPECT) bw = h * MAX_ASPECT;
  else if (aspect < MIN_ASPECT) bh = w / MIN_ASPECT;
  const bx = (w - bw) / 2;
  const by = (h - bh) / 2;
  const compact = bw < 560;
  const unit = Math.min(bw, bh) / (compact ? 9.2 : 8.4);
  const padX = Math.max(unit * 1.3, compact ? 40 : 56);
  const padTop = Math.max(unit * 1.05, 34);
  const padBottom = Math.max(unit * 1.5, compact ? 54 : 66);
  const spanX = Math.max(1, bw - padX * 2);
  const spanY = Math.max(1, bh - padTop - padBottom);
  return {
    width: w,
    height: h,
    box: { x: bx, y: by, w: bw, h: bh },
    unit,
    compact,
    project: (x: number, y: number) => ({ x: bx + padX + x * spanX, y: by + padTop + y * spanY }),
  };
}

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

export function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Tiny deterministic PRNG (mulberry32) for shapes only — never for game logic. */
export function shapeRng(seed: string): () => number {
  let a = hash32(seed) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Irregular, softly rounded footprint polygon (points relative to the district centre). */
export function footprintPoints(id: string, r: number): Point[] {
  const rng = shapeRng(`fp:${id}`);
  const n = 7;
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.36;
    const rad = r * (0.86 + rng() * 0.26);
    pts.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad * 0.9 });
  }
  return pts;
}

export interface SmoothSegment {
  cx: number;
  cy: number;
  x: number;
  y: number;
}

/** Closed smooth curve through the midpoints of a polygon (quadratic segments). */
export function smoothClosed(pts: Point[]): { start: Point; segments: SmoothSegment[] } {
  const n = pts.length;
  const mid = (i: number): Point => {
    const a = pts[i % n];
    const b = pts[(i + 1) % n];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  const start = mid(0);
  const segments: SmoothSegment[] = [];
  for (let i = 1; i <= n; i++) {
    const cp = pts[i % n];
    const m = mid(i);
    segments.push({ cx: cp.x, cy: cp.y, x: m.x, y: m.y });
  }
  return { start, segments };
}

export function smoothPathD(pts: Point[], ox: number, oy: number): string {
  const { start, segments } = smoothClosed(pts);
  let d = `M${(ox + start.x).toFixed(1)} ${(oy + start.y).toFixed(1)}`;
  for (const s of segments) {
    d += ` Q${(ox + s.cx).toFixed(1)} ${(oy + s.cy).toFixed(1)} ${(ox + s.x).toFixed(1)} ${(oy + s.y).toFixed(1)}`;
  }
  return `${d}Z`;
}

// ---------------------------------------------------------------------------
// Roads & signal paths (gently curved quadratic Béziers)
// ---------------------------------------------------------------------------

export interface Curve {
  a: Point;
  c: Point;
  b: Point;
}

export function roadCurve(id: string, a: Point, b: Point): Curve {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const sign = hash32(`rc:${id}`) % 2 === 0 ? 1 : -1;
  const off = len * 0.085 * sign;
  return { a, c: { x: (a.x + b.x) / 2 + nx * off, y: (a.y + b.y) / 2 + ny * off }, b };
}

export function straightCurve(a: Point, b: Point): Curve {
  return { a, c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, b };
}

export function reverseCurve(cv: Curve): Curve {
  return { a: cv.b, c: cv.c, b: cv.a };
}

export function curvePoint(cv: Curve, t: number): Point {
  const k = Math.max(0, Math.min(1, t));
  const u = 1 - k;
  return {
    x: u * u * cv.a.x + 2 * u * k * cv.c.x + k * k * cv.b.x,
    y: u * u * cv.a.y + 2 * u * k * cv.c.y + k * k * cv.b.y,
  };
}

export function curveTangent(cv: Curve, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const dx = 2 * (1 - k) * (cv.c.x - cv.a.x) + 2 * k * (cv.b.x - cv.c.x);
  const dy = 2 * (1 - k) * (cv.c.y - cv.a.y) + 2 * k * (cv.b.y - cv.c.y);
  return Math.atan2(dy, dx);
}

export function curveLength(cv: Curve): number {
  let len = 0;
  let prev = cv.a;
  for (let i = 1; i <= 16; i++) {
    const p = curvePoint(cv, i / 16);
    len += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return len;
}

export function curvePathD(cv: Curve, toT = 1): string {
  if (toT >= 0.999) return `M${cv.a.x.toFixed(1)} ${cv.a.y.toFixed(1)} Q${cv.c.x.toFixed(1)} ${cv.c.y.toFixed(1)} ${cv.b.x.toFixed(1)} ${cv.b.y.toFixed(1)}`;
  let d = `M${cv.a.x.toFixed(1)} ${cv.a.y.toFixed(1)}`;
  const n = 10;
  for (let i = 1; i <= n; i++) {
    const p = curvePoint(cv, (toT * i) / n);
    d += ` L${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }
  return d;
}

/** Curve a signal travels along: the road between the districts when one exists, else a straight line. */
export function signalCurve(map: MapState, roads: Map<string, Curve>, from: string, to: string, layout: Layout): Curve {
  const direct = map.roads.find((r) => r.from === from && r.to === to);
  if (direct && roads.has(direct.id)) return roads.get(direct.id)!;
  const reverse = map.roads.find((r) => r.from === to && r.to === from);
  if (reverse && roads.has(reverse.id)) return reverseCurve(roads.get(reverse.id)!);
  const a = map.districts.find((d) => d.id === from);
  const b = map.districts.find((d) => d.id === to);
  const pa = a ? layout.project(a.x, a.y) : { x: 0, y: 0 };
  const pb = b ? layout.project(b.x, b.y) : { x: 0, y: 0 };
  return straightCurve(pa, pb);
}

// ---------------------------------------------------------------------------
// Urban fabric & river (ambient context between districts)
// ---------------------------------------------------------------------------

export interface FabricBlock {
  x: number;
  y: number;
  w: number;
  h: number;
  alpha: number;
}

const RIVER_CONTROL: Point[] = [
  { x: -0.12, y: 0.5 },
  { x: 0.12, y: 0.515 },
  { x: 0.33, y: 0.575 },
  { x: 0.5, y: 0.605 },
  { x: 0.66, y: 0.565 },
  { x: 0.86, y: 0.52 },
  { x: 1.12, y: 0.5 },
];

/** Smooth polyline (projected) for the river band. */
export function riverPoints(layout: Layout): Point[] {
  const pts: Point[] = [];
  const n = RIVER_CONTROL.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = RIVER_CONTROL[Math.max(0, i - 1)];
    const p1 = RIVER_CONTROL[i];
    const p2 = RIVER_CONTROL[i + 1];
    const p3 = RIVER_CONTROL[Math.min(n - 1, i + 2)];
    for (let s = 0; s < 6; s++) {
      const t = s / 6;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      pts.push(layout.project(x, y));
    }
  }
  pts.push(layout.project(RIVER_CONTROL[n - 1].x, RIVER_CONTROL[n - 1].y));
  return pts;
}

function distToPolyline(p: Point, poly: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i];
    const b = poly[i + 1];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const l2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
    const d = Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
    if (d < best) best = d;
  }
  return best;
}

/** Faint background city blocks that fill the space between districts. Deterministic. */
export function fabricBlocks(layout: Layout, districts: { x: number; y: number }[]): FabricBlock[] {
  const rng = shapeRng('fabric');
  const u = layout.unit;
  const cell = u * 0.46;
  const river = riverPoints(layout);
  const centres = districts.map((d) => layout.project(d.x, d.y));
  const out: FabricBlock[] = [];
  const { x: bx, y: by, w: bw, h: bh } = layout.box;
  const inset = u * 0.2;
  for (let y = by + inset; y < by + bh - inset; y += cell) {
    for (let x = bx + inset; x < bx + bw - inset; x += cell) {
      if (rng() > 0.62) continue;
      const w = cell * (0.45 + rng() * 0.4);
      const h = cell * (0.4 + rng() * 0.4);
      const px = x + rng() * (cell - w);
      const py = y + rng() * (cell - h);
      const c = { x: px + w / 2, y: py + h / 2 };
      let near = false;
      for (const d of centres) {
        if (Math.hypot(c.x - d.x, c.y - d.y) < u * 1.42) {
          near = true;
          break;
        }
      }
      if (near) continue;
      if (distToPolyline(c, river) < u * 0.42) continue;
      out.push({ x: px, y: py, w, h, alpha: 0.35 + rng() * 0.45 });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Blocks, landmarks & crowds inside districts
// ---------------------------------------------------------------------------

export interface Block {
  x: number;
  y: number;
  w: number;
  h: number;
  cols: number;
  rows: number;
  /** Deterministic lighting order for windows (indices 0..cols*rows-1). */
  order: number[];
}

/** Plaza (where crowds gather) relative to the district centre. */
export function plazaOffset(r: number): Point {
  return { x: -0.12 * r, y: 0.4 * r };
}

/** Institution landmark position relative to the district centre. */
export function institutionOffset(r: number): Point {
  return { x: 0.48 * r, y: -0.36 * r };
}

const BLOCK_COUNT: Record<DistrictKind, number> = {
  campus: 5,
  civic: 4,
  market: 7,
  transit: 3,
  media: 4,
  records: 3,
  residential: 6,
  industrial: 4,
  hospital: 4,
};

export function districtBlocks(id: string, kind: DistrictKind, r: number, hasInstitution: boolean): Block[] {
  const rng = shapeRng(`bl:${id}`);
  const count = BLOCK_COUNT[kind] ?? 4;
  const blocks: Block[] = [];
  const plaza = plazaOffset(r);
  const inst = institutionOffset(r);
  let attempts = 0;
  while (blocks.length < count && attempts < 80) {
    attempts++;
    const a = rng() * Math.PI * 2;
    const dist = r * (0.1 + rng() * 0.46);
    const cx = Math.cos(a) * dist;
    const cy = Math.sin(a) * dist * 0.85;
    const wide = kind === 'transit' || kind === 'campus';
    const w = r * (wide ? 0.34 + rng() * 0.2 : kind === 'market' ? 0.16 + rng() * 0.12 : 0.22 + rng() * 0.18);
    const h = r * (kind === 'market' ? 0.12 + rng() * 0.1 : 0.16 + rng() * 0.16);
    // keep the plaza and the landmark clear
    if (Math.hypot(cx - plaza.x, cy - plaza.y) < r * 0.4) continue;
    if (hasInstitution && Math.hypot(cx - inst.x, cy - inst.y) < r * 0.38) continue;
    let overlaps = false;
    for (const b of blocks) {
      if (Math.abs(b.x + b.w / 2 - cx) < (b.w + w) / 2 + r * 0.04 && Math.abs(b.y + b.h / 2 - cy) < (b.h + h) / 2 + r * 0.04) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;
    const cols = Math.max(2, Math.round(w / (r * 0.085)));
    const rows = Math.max(1, Math.round(h / (r * 0.09)));
    const order = Array.from({ length: cols * rows }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    blocks.push({ x: cx - w / 2, y: cy - h / 2, w, h, cols, rows, order });
  }
  return blocks;
}

export const CROWD_MAX = 56;

/** Deterministic crowd base positions (people), densest at the plaza centre. */
export function crowdPositions(id: string, max: number, r: number): Point[] {
  const rng = shapeRng(`cr:${id}`);
  const plaza = plazaOffset(r);
  const pts: Point[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < max; i++) {
    const t = (i + 0.5) / max;
    const rad = Math.sqrt(t) * r * 0.6;
    const a = i * golden + (rng() - 0.5) * 0.5;
    pts.push({ x: plaza.x + Math.cos(a) * rad, y: plaza.y + Math.sin(a) * rad * 0.78 });
  }
  return pts;
}

export function crowdCount(crowd: number): number {
  if (crowd <= 0.02) return 0;
  return Math.max(3, Math.round(crowd * CROWD_MAX));
}

/** Person dot size variance by index (deterministic). */
export function personScale(i: number): number {
  return 0.82 + ((i * 7919) % 37) / 100;
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

export interface MapPalette {
  footprint: number;
  footprintEdge: number;
  fabric: number;
  river: number;
  blockFill: number;
  blockEdge: number;
  windowLit: number;
  windowDark: number;
  roadOpen: number;
  roadCongested: number;
  roadClosed: number;
  person: number;
  institution: number;
  institutionActive: number;
  rumor: number;
  manipulated: number;
  verified: number;
  official: number;
  danger: number;
  safety: number;
  economy: number;
  legitimacy: number;
  steel: number;
  cyan: number;
  electric: number;
  saffron: number;
  focus: number;
  /** Alpha multipliers tuned for contrast modes. */
  lineAlpha: number;
  glowAlpha: number;
}

const BASE_PALETTE: MapPalette = {
  footprint: 0x11284b,
  footprintEdge: 0xa9e4ff,
  fabric: 0x16305a,
  river: 0x173d70,
  blockFill: 0x0a1a33,
  blockEdge: 0x5a6d8c,
  windowLit: 0x9fdcff,
  windowDark: 0x1b3560,
  roadOpen: 0xaab6c8,
  roadCongested: 0xd9b48a,
  roadClosed: 0xe0405a,
  person: 0xeaf3ff,
  institution: 0xa9e4ff,
  institutionActive: 0x62d6ff,
  rumor: 0xd9a066,
  manipulated: 0xe0405a,
  verified: 0x62d6ff,
  official: 0xa9e4ff,
  danger: 0xe0405a,
  safety: 0x2ed3c4,
  economy: 0x2ecc8a,
  legitimacy: 0xa9e4ff,
  steel: 0xaab6c8,
  cyan: 0x62d6ff,
  electric: 0x38a0ff,
  saffron: 0xf0a24a,
  focus: 0xa9e4ff,
  lineAlpha: 1,
  glowAlpha: 1,
};

export function getPalette(highContrast: boolean, colourBlind: boolean): MapPalette {
  let p: MapPalette = { ...BASE_PALETTE };
  if (colourBlind) {
    p = {
      ...p,
      danger: 0xff6b35,
      roadClosed: 0xff6b35,
      manipulated: 0xff6b35,
      rumor: 0xc3cfe0,
      safety: 0x26c6da,
      economy: 0x8bd346,
      verified: 0x3b82f6,
      official: 0xe0f2ff,
      windowLit: 0x9fd4ff,
    };
  }
  if (highContrast) {
    p = {
      ...p,
      footprint: 0x0d2347,
      footprintEdge: 0xffffff,
      fabric: 0x10244a,
      river: 0x1b4a8a,
      blockFill: 0x061126,
      blockEdge: 0xaebdd4,
      windowLit: 0xffffff,
      windowDark: 0x1a2f52,
      roadOpen: 0xe6ecf5,
      person: 0xffffff,
      institution: 0xffffff,
      focus: 0xffffff,
      lineAlpha: 1.6,
      glowAlpha: 0.7,
    };
  }
  return p;
}

export function lerpColor(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * k);
  const g = Math.round(ag + (bg - ag) * k);
  const bl = Math.round(ab + (bb - ab) * k);
  return (r << 16) | (g << 8) | bl;
}

export function hexCss(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

/** Trust 0..1 → colour: crimson (collapsing) → steel (strained) → ice blue (healthy). */
export function trustColor(trust: number, p: MapPalette): number {
  const t = Math.max(0, Math.min(1, trust));
  return t < 0.5 ? lerpColor(p.danger, p.steel, t / 0.5) : lerpColor(p.steel, p.legitimacy, (t - 0.5) / 0.5);
}

export function signalColor(kind: SignalKind, p: MapPalette): number {
  switch (kind) {
    case 'rumor':
      return p.rumor;
    case 'manipulated':
      return p.manipulated;
    case 'verified':
      return p.verified;
    case 'official':
      return p.official;
  }
}

/** Ambient ground colours for the container background, by city health 0..1. */
export function groundColours(health: number): { top: string; bottom: string; vignette: number } {
  const h = Math.max(0, Math.min(1, health));
  const top = lerpColor(0x121a30, 0x163668, h);
  const bottom = lerpColor(0x0a0d14, 0x07111f, h);
  return { top: hexCss(top), bottom: hexCss(bottom), vignette: Math.round((1 - h) * 0.3 * 100) / 100 };
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const SHORT_NAMES: Record<string, string> = {
  'University Quarter': 'University',
  'Civil Hospital': 'Hospital',
  'Civic Square': 'Civic Sq.',
  'Market Street': 'Market',
  'Records Office': 'Records',
  'Central Transit Hub': 'Transit Hub',
  'Press Enclave': 'Press',
};
const STOP_WORDS = new Set(['central', 'civil', 'civic', 'new', 'old', 'north', 'south', 'east', 'west', 'upper', 'lower']);

export function shortName(name: string): string {
  if (SHORT_NAMES[name]) return SHORT_NAMES[name];
  const words = name.split(/\s+/);
  if (words.length === 1) return name;
  if (STOP_WORDS.has(words[0].toLowerCase()) && words[1]) return words[1];
  return words[0];
}

export type LabelSide = 'below' | 'above';

/**
 * Chooses a side for each district label so labels do not overlap each other.
 * Estimates text boxes (≈7.6px per character at 14px, wrapping at the CSS max-width).
 */
export function labelSides(districts: { id: string; name: string; x: number; y: number }[], layout: Layout): Record<string, LabelSide> {
  const maxW = layout.compact ? 86 : 99;
  const charW = 7.6;
  const lineH = 16;
  const gap = 18; // from marker centre to label edge
  const boxes: { x: number; y: number; w: number; h: number }[] = [];
  const sides: Record<string, LabelSide> = {};
  const ordered = [...districts].sort((a, b) => a.y - b.y || a.x - b.x);
  const estimate = (text: string) => {
    const raw = text.length * charW;
    if (raw <= maxW) return { w: raw, h: lineH };
    return { w: maxW, h: lineH * 2 };
  };
  const overlaps = (b: { x: number; y: number; w: number; h: number }) =>
    boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
  for (const d of ordered) {
    const pos = layout.project(d.x, d.y);
    const text = layout.compact ? shortName(d.name) : d.name;
    const { w, h } = estimate(text);
    const below = { x: pos.x - w / 2, y: pos.y + gap, w, h };
    const above = { x: pos.x - w / 2, y: pos.y - gap - h, w, h };
    if (!overlaps(below)) {
      boxes.push(below);
      sides[d.id] = 'below';
    } else if (!overlaps(above)) {
      boxes.push(above);
      sides[d.id] = 'above';
    } else {
      boxes.push(below);
      sides[d.id] = 'below';
    }
  }
  return sides;
}

// ---------------------------------------------------------------------------
// Descriptions used by labels and ARIA
// ---------------------------------------------------------------------------

export function describeCrowd(crowd: number): string {
  if (crowd < 0.06) return 'quiet';
  if (crowd < 0.22) return 'small gathering';
  if (crowd < 0.45) return 'large gathering';
  if (crowd < 0.72) return 'very large crowd';
  return 'massive crowd';
}

export function describeMood(mood: MapDistrictView['mood']): string {
  switch (mood) {
    case 'calm':
      return 'calm';
    case 'tense':
      return 'tense';
    case 'volatile':
      return 'volatile';
    case 'hopeful':
      return 'hopeful';
  }
}

export function describeIncident(incident: MapDistrictView['incident']): string | null {
  switch (incident) {
    case 'vandalism':
      return 'vandalism reported';
    case 'clash':
      return 'clashes under way';
    case 'fire':
      return 'fire reported';
    case 'outage':
      return 'services down';
    case 'intimidation':
      return 'intimidation reported';
    default:
      return null;
  }
}

export function districtAriaLabel(d: MapDistrictView): string {
  const parts = [`${d.name}: ${describeCrowd(d.crowd)}, ${describeMood(d.mood)}, trust ${Math.round(d.trust * 100)}%`];
  const inc = describeIncident(d.incident);
  if (inc) parts.push(inc);
  if (d.institutionActive && d.institution) parts.push(`${d.institution} responding`);
  if (d.pendingDecisions > 0) parts.push(`${d.pendingDecisions} decision${d.pendingDecisions === 1 ? '' : 's'} waiting`);
  if (d.openEvidence > 0) parts.push(`${d.openEvidence} open evidence item${d.openEvidence === 1 ? '' : 's'}`);
  return parts.join(', ');
}

export function districtById(map: MapState, id: string): MapDistrictView | undefined {
  return map.districts.find((d) => d.id === id);
}
