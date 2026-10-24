/**
 * PixiJS city scene — the living gameplay surface.
 *
 * Pure Graphics/Sprites with procedurally generated textures (no external assets).
 * Geometry is (re)built only when state or size changes; per-frame work is limited to
 * transforms, alpha and a handful of short-lived effect graphics.
 */
import { Application, Container, Graphics, Sprite, Texture, type Ticker } from 'pixi.js';
import type {
  DistrictMood,
  IncidentKind,
  MapActionKind,
  MapDistrictView,
  MapRoadView,
  MapSignalView,
  MapState,
  RoadStatus,
  SignalKind,
} from '@/engine/types';
import {
  CROWD_MAX,
  computeLayout,
  crowdCount,
  crowdPositions,
  curveLength,
  curvePoint,
  curveTangent,
  districtBlocks,
  fabricBlocks,
  footprintPoints,
  getPalette,
  institutionOffset,
  personScale,
  plazaOffset,
  riverPoints,
  roadCurve,
  signalColor,
  signalCurve,
  smoothClosed,
  trustColor,
  type Block,
  type Curve,
  type Layout,
  type MapPalette,
  type Point,
} from '../layout';

export interface CitySceneOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  reducedMotion: boolean;
  highContrast: boolean;
  colourBlind: boolean;
  onContextLost?: () => void;
}

export interface CityScene {
  update(map: MapState, focus?: string): void;
  setMotion(reduced: boolean): void;
  setPalette(highContrast: boolean, colourBlind: boolean): void;
  resize(width: number, height: number): void;
  destroy(): void;
}

/** Lightweight frame statistics (scripting time only) for performance checks. */
export const mapStats = { frames: 0, animateMs: 0, maxAnimateMs: 0 };

// ---------------------------------------------------------------------------
// Procedural textures (Canvas2D → Texture)
// ---------------------------------------------------------------------------

interface Textures {
  dot: Texture;
  glow: Texture;
  bug: Texture;
  dash: Texture;
  ring: Texture;
  spark: Texture;
}

function canvasTexture(h: number, w: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (ctx) draw(ctx, w, h);
  const t = Texture.from(c);
  t.source.scaleMode = 'linear';
  return t;
}

function makeTextures(): Textures {
  const dot = canvasTexture(24, 24, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  const glow = canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.42)');
    g.addColorStop(0.65, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  // Abstract manipulation glyph: asymmetric body with short limbs. Never a person.
  const bug = canvasTexture(24, 24, (ctx) => {
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(6, 12);
    ctx.lineTo(10, 6);
    ctx.lineTo(17, 8);
    ctx.lineTo(19, 14);
    ctx.lineTo(13, 18);
    ctx.lineTo(8, 16);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(10, 6);
    ctx.lineTo(7, 2);
    ctx.moveTo(17, 8);
    ctx.lineTo(21, 4);
    ctx.moveTo(8, 16);
    ctx.lineTo(3, 20);
    ctx.stroke();
  });
  const dash = canvasTexture(8, 28, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(255,255,255,1)';
    const r = h / 2;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(w - r, 0);
    ctx.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(r, h);
    ctx.arc(r, r, r, Math.PI / 2, (Math.PI * 3) / 2);
    ctx.closePath();
    ctx.fill();
  });
  const ring = canvasTexture(96, 96, (ctx, w, h) => {
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 4, 0, Math.PI * 2);
    ctx.stroke();
  });
  const spark = canvasTexture(10, 10, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  return { dot, glow, bug, dash, ring, spark };
}

// ---------------------------------------------------------------------------
// Runtime nodes
// ---------------------------------------------------------------------------

interface MoodMix {
  calm: number;
  tense: number;
  volatile: number;
  hopeful: number;
}

interface DistrictNode {
  id: string;
  view: MapDistrictView;
  pos: Point;
  r: number;
  container: Container;
  glow: Sprite;
  haze: Sprite;
  footprint: Graphics;
  blocksG: Graphics;
  windowsG: Graphics;
  inst: Graphics | null;
  pts: Point[];
  blocks: Block[];
  crowdBase: Point[];
  crowd: Sprite[];
  cur: { crowd: number; trust: number; services: number; shown: number; mood: MoodMix };
  drawnLit: number;
  drawnOutage: boolean;
  incident: IncidentKind | null;
  incidentTimer: number;
  instTimer: number;
  hopeTimer: number;
  restore: number; // -1 inactive, else 0..1 progress of relighting
}

interface RoadNode {
  id: string;
  view: MapRoadView;
  curve: Curve;
  length: number;
  line: Graphics;
  dashes: Sprite[];
  offset: number;
}

interface Bug {
  sprite: Sprite;
  lag: number;
  phase: number;
  dissolve: number;
}

interface SignalNode {
  id: string;
  view: MapSignalView;
  curve: Curve;
  kind: SignalKind;
  progress: number;
  path: Graphics;
  head: Sprite;
  headGlow: Sprite;
  trail: Sprite[];
  bugs: Bug[];
  fading: boolean;
  alpha: number;
  ringTimer: number;
}

interface Effect {
  update(dt: number): boolean;
  destroy(): void;
}

const MOODS: DistrictMood[] = ['calm', 'tense', 'volatile', 'hopeful'];

function approach(cur: number, target: number, dt: number, tau: number): number {
  if (dt <= 0) return cur;
  return target + (cur - target) * Math.exp(-dt / tau);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

class Scene implements CityScene {
  private app: Application;
  private canvas: HTMLCanvasElement;
  private tex: Textures;
  private palette: MapPalette;
  private layout: Layout;
  private reduced: boolean;
  private map: MapState | null = null;
  private focusId: string | undefined;
  private time = 0;

  private fabricLayer = new Container();
  private fabricG = new Graphics();
  private glowLayer = new Container();
  private roadLayer = new Container();
  private dashLayer = new Container();
  private districtLayer = new Container();
  private crowdLayer = new Container();
  private effectLayer = new Container();
  private signalLayer = new Container();
  private focusLayer = new Container();
  private focusG = new Graphics();
  private focusGlow: Sprite;
  private staticG = new Graphics();

  private districts = new Map<string, DistrictNode>();
  private roads = new Map<string, RoadNode>();
  private roadCurves = new Map<string, Curve>();
  private signals = new Map<string, SignalNode>();
  private effects: Effect[] = [];
  private seenActions = new Map<string, number>();
  private onLost: (() => void) | undefined;
  private destroyed = false;
  private fabricDirty = true;

  constructor(app: Application, opts: CitySceneOptions) {
    this.app = app;
    this.canvas = opts.canvas;
    this.reduced = opts.reducedMotion;
    this.palette = getPalette(opts.highContrast, opts.colourBlind);
    this.layout = computeLayout(opts.width, opts.height);
    this.tex = makeTextures();
    this.onLost = opts.onContextLost;

    this.focusGlow = new Sprite(this.tex.glow);
    this.focusGlow.anchor.set(0.5);
    this.focusGlow.blendMode = 'add';
    this.focusGlow.visible = false;
    this.focusLayer.addChild(this.focusGlow, this.focusG);
    this.effectLayer.addChild(this.staticG);
    this.fabricLayer.addChild(this.fabricG);

    app.stage.eventMode = 'none';
    app.stage.addChild(
      this.fabricLayer,
      this.glowLayer,
      this.roadLayer,
      this.dashLayer,
      this.districtLayer,
      this.crowdLayer,
      this.effectLayer,
      this.signalLayer,
      this.focusLayer,
    );

    this.canvas.addEventListener('webglcontextlost', this.handleLost);
    app.ticker.maxFPS = 60;
    app.ticker.add(this.frame);
    if (this.reduced) app.ticker.stop();
  }

  private handleLost = (e: Event) => {
    e.preventDefault();
    this.onLost?.();
  };

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  update(map: MapState, focus?: string): void {
    if (this.destroyed) return;
    const first = this.map === null;
    this.map = map;
    this.focusId = focus ?? map.focus;

    for (const d of map.districts) {
      let node = this.districts.get(d.id);
      if (!node) {
        node = this.createDistrict(d);
        this.districts.set(d.id, node);
        this.fabricDirty = true;
      }
      const prevView = node.view;
      node.view = d;
      if (d.incident !== node.incident) {
        node.incident = d.incident;
        node.incidentTimer = 0;
      }
      if (prevView.institutionActive !== d.institutionActive && node.inst) this.drawInstitution(node);
      if (first) this.snapDistrict(node);
    }
    this.sortDistricts();

    for (const r of map.roads) {
      let node = this.roads.get(r.id);
      if (!node) {
        node = this.createRoad(r);
        this.roads.set(r.id, node);
      } else if (node.view.status !== r.status) {
        node.view = r;
        this.drawRoad(node);
        this.buildDashes(node);
      } else {
        node.view = r;
      }
    }

    if (this.fabricDirty) this.drawFabric();

    const live = new Set<string>();
    for (const s of map.signals) {
      live.add(s.id);
      let node = this.signals.get(s.id);
      if (!node) {
        node = this.createSignal(s);
        this.signals.set(s.id, node);
      }
      node.view = s;
    }
    for (const [id, node] of this.signals) {
      if (!live.has(id)) node.fading = true;
    }

    for (const a of map.recentActions) {
      const key = `${a.district}|${a.kind}|${a.at}`;
      if (this.seenActions.has(key)) continue;
      this.seenActions.set(key, map.tick);
      if (!this.reduced) this.spawnAction(a.district, a.kind);
      if (a.kind === 'restore') {
        const node = this.districts.get(a.district);
        if (node) node.restore = 0;
      }
    }
    for (const [key, t] of this.seenActions) {
      if (map.tick - t > 40) this.seenActions.delete(key);
    }

    this.drawFocus();
    if (this.reduced) {
      this.snapAll();
      this.drawStatic();
      this.animate(0);
      this.app.render();
    }
  }

  setMotion(reduced: boolean): void {
    if (this.destroyed || this.reduced === reduced) return;
    this.reduced = reduced;
    if (reduced) {
      this.app.ticker.stop();
      for (const e of this.effects) e.destroy();
      this.effects = [];
      this.snapAll();
      this.drawStatic();
      this.animate(0);
      this.app.render();
    } else {
      this.staticG.clear();
      this.app.ticker.start();
    }
  }

  setPalette(highContrast: boolean, colourBlind: boolean): void {
    if (this.destroyed) return;
    this.palette = getPalette(highContrast, colourBlind);
    this.redrawAll();
  }

  resize(width: number, height: number): void {
    if (this.destroyed) return;
    if (width < 2 || height < 2) return;
    this.app.renderer.resize(width, height);
    this.layout = computeLayout(width, height);
    this.redrawAll();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.canvas.removeEventListener('webglcontextlost', this.handleLost);
    this.app.ticker.remove(this.frame);
    for (const e of this.effects) e.destroy();
    this.effects = [];
    for (const t of Object.values(this.tex)) t.destroy(true);
    try {
      this.app.destroy({ removeView: false }, { children: true });
    } catch {
      /* renderer may already be gone after context loss */
    }
  }

  // -------------------------------------------------------------------------
  // Creation
  // -------------------------------------------------------------------------

  private districtGeometry(id: string, kind: MapDistrictView['kind'], x: number, y: number, hasInst: boolean) {
    const pos = this.layout.project(x, y);
    const r = this.layout.unit;
    return {
      pos,
      r,
      pts: footprintPoints(id, r),
      blocks: districtBlocks(id, kind, r, hasInst),
      crowdBase: crowdPositions(id, CROWD_MAX, r),
    };
  }

  private createDistrict(d: MapDistrictView): DistrictNode {
    const geo = this.districtGeometry(d.id, d.kind, d.x, d.y, Boolean(d.institution));
    const container = new Container();
    const glow = new Sprite(this.tex.glow);
    glow.anchor.set(0.5);
    glow.blendMode = 'add';
    const haze = new Sprite(this.tex.glow);
    haze.anchor.set(0.5);
    haze.blendMode = 'add';
    haze.alpha = 0;
    const footprint = new Graphics();
    const blocksG = new Graphics();
    const windowsG = new Graphics();
    const inst = d.institution ? new Graphics() : null;
    container.addChild(footprint, blocksG, windowsG);
    if (inst) container.addChild(inst);
    const crowd: Sprite[] = [];
    for (let i = 0; i < CROWD_MAX; i++) {
      const s = new Sprite(this.tex.dot);
      s.anchor.set(0.5);
      s.alpha = 0;
      s.visible = false;
      crowd.push(s);
      this.crowdLayer.addChild(s);
    }
    this.glowLayer.addChild(glow, haze);
    this.districtLayer.addChild(container);
    const node: DistrictNode = {
      id: d.id,
      view: d,
      pos: geo.pos,
      r: geo.r,
      container,
      glow,
      haze,
      footprint,
      blocksG,
      windowsG,
      inst,
      pts: geo.pts,
      blocks: geo.blocks,
      crowdBase: geo.crowdBase,
      crowd,
      cur: { crowd: 0, trust: d.trust, services: d.services, shown: 0, mood: { calm: 1, tense: 0, volatile: 0, hopeful: 0 } },
      drawnLit: -1,
      drawnOutage: false,
      incident: d.incident,
      incidentTimer: 0,
      instTimer: 0,
      hopeTimer: 0,
      restore: -1,
    };
    this.drawDistrict(node);
    return node;
  }

  private createRoad(r: MapRoadView): RoadNode {
    const line = new Graphics();
    this.roadLayer.addChild(line);
    const node: RoadNode = {
      id: r.id,
      view: r,
      curve: { a: { x: 0, y: 0 }, c: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
      length: 1,
      line,
      dashes: [],
      offset: 0,
    };
    this.layoutRoad(node);
    this.drawRoad(node);
    this.buildDashes(node);
    return node;
  }

  private createSignal(s: MapSignalView): SignalNode {
    const color = signalColor(s.kind, this.palette);
    const path = new Graphics();
    const head = new Sprite(s.kind === 'rumor' || s.kind === 'manipulated' ? this.tex.dash : this.tex.dot);
    head.anchor.set(0.5);
    head.tint = color;
    const headGlow = new Sprite(this.tex.glow);
    headGlow.anchor.set(0.5);
    headGlow.tint = color;
    headGlow.blendMode = 'add';
    const trail: Sprite[] = [];
    const trailCount = s.kind === 'verified' || s.kind === 'official' ? 6 : 3;
    for (let i = 0; i < trailCount; i++) {
      const t = new Sprite(this.tex.dash);
      t.anchor.set(0.5);
      t.tint = color;
      trail.push(t);
    }
    const bugs: Bug[] = [];
    const bugCount = s.kind === 'rumor' ? 4 : s.kind === 'manipulated' ? 7 : 0;
    for (let i = 0; i < bugCount; i++) {
      const sp = new Sprite(this.tex.bug);
      sp.anchor.set(0.5);
      sp.tint = color;
      bugs.push({ sprite: sp, lag: 0.025 + i * 0.022 + (i % 2) * 0.01, phase: i * 1.9, dissolve: 0 });
    }
    this.signalLayer.addChild(path, ...trail, ...bugs.map((b) => b.sprite), headGlow, head);
    const node: SignalNode = {
      id: s.id,
      view: s,
      curve: { a: { x: 0, y: 0 }, c: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
      kind: s.kind,
      progress: Math.max(0, s.progress - 0.04),
      path,
      head,
      headGlow,
      trail,
      bugs,
      fading: false,
      alpha: 0,
      ringTimer: 0,
    };
    this.layoutSignal(node);
    return node;
  }

  private destroySignal(node: SignalNode): void {
    node.path.destroy();
    node.head.destroy();
    node.headGlow.destroy();
    for (const t of node.trail) t.destroy();
    for (const b of node.bugs) b.sprite.destroy();
    this.signals.delete(node.id);
  }

  // -------------------------------------------------------------------------
  // Layout & drawing
  // -------------------------------------------------------------------------

  private redrawAll(): void {
    for (const node of this.districts.values()) {
      const geo = this.districtGeometry(node.id, node.view.kind, node.view.x, node.view.y, Boolean(node.view.institution));
      node.pos = geo.pos;
      node.r = geo.r;
      node.pts = geo.pts;
      node.blocks = geo.blocks;
      node.crowdBase = geo.crowdBase;
      node.drawnLit = -1;
      this.drawDistrict(node);
    }
    for (const road of this.roads.values()) {
      this.layoutRoad(road);
      this.drawRoad(road);
      this.buildDashes(road);
    }
    this.drawFabric();
    for (const sig of this.signals.values()) {
      this.layoutSignal(sig);
      const color = signalColor(sig.kind, this.palette);
      sig.head.tint = color;
      sig.headGlow.tint = color;
      for (const t of sig.trail) t.tint = color;
      for (const b of sig.bugs) b.sprite.tint = color;
    }
    for (const e of this.effects) e.destroy();
    this.effects = [];
    this.drawFocus();
    if (this.reduced) {
      this.drawStatic();
      this.animate(0);
      this.app.render();
    }
  }

  private sortDistricts(): void {
    const nodes = [...this.districts.values()].sort((a, b) => a.pos.y - b.pos.y);
    nodes.forEach((n, i) => this.districtLayer.setChildIndex(n.container, i));
  }

  private drawFabric(): void {
    const map = this.map;
    if (!map) return;
    this.fabricDirty = false;
    const p = this.palette;
    const g = this.fabricG;
    const u = this.layout.unit;
    g.clear();
    // river band
    const river = riverPoints(this.layout);
    if (river.length > 1) {
      g.moveTo(river[0].x, river[0].y);
      for (let i = 1; i < river.length; i++) g.lineTo(river[i].x, river[i].y);
      g.stroke({ width: u * 0.5 + 6, color: p.river, alpha: 0.1, cap: 'round', join: 'round' });
      g.moveTo(river[0].x, river[0].y);
      for (let i = 1; i < river.length; i++) g.lineTo(river[i].x, river[i].y);
      g.stroke({ width: u * 0.5, color: p.river, alpha: 0.26, cap: 'round', join: 'round' });
      g.moveTo(river[0].x, river[0].y - u * 0.25);
      for (let i = 1; i < river.length; i++) g.lineTo(river[i].x, river[i].y - u * 0.25);
      g.stroke({ width: 1, color: p.cyan, alpha: 0.1, cap: 'round', join: 'round' });
      g.moveTo(river[0].x, river[0].y + u * 0.25);
      for (let i = 1; i < river.length; i++) g.lineTo(river[i].x, river[i].y + u * 0.25);
      g.stroke({ width: 1, color: p.cyan, alpha: 0.06, cap: 'round', join: 'round' });
    }
    // faint arterial streets across the fabric
    const cell = u * 0.46 * 3;
    const { x: bx, y: by, w: bw, h: bh } = this.layout.box;
    for (let x = bx + cell; x < bx + bw; x += cell) g.moveTo(x, by).lineTo(x, by + bh);
    for (let y = by + cell; y < by + bh; y += cell) g.moveTo(bx, y).lineTo(bx + bw, y);
    g.stroke({ width: 1, color: p.footprintEdge, alpha: 0.035 * p.lineAlpha });
    // background blocks
    for (const b of fabricBlocks(this.layout, map.districts)) {
      g.rect(b.x, b.y, b.w, b.h);
      g.fill({ color: p.fabric, alpha: 0.12 * b.alpha });
      g.stroke({ width: 1, color: p.footprintEdge, alpha: 0.04 * b.alpha * p.lineAlpha });
    }
  }

  private drawDistrict(node: DistrictNode): void {
    this.drawFootprint(node);
    this.drawBlocks(node);
    this.drawWindows(node, true);
    if (node.inst) this.drawInstitution(node);
    node.glow.position.set(node.pos.x, node.pos.y + node.r * 0.1);
    node.glow.scale.set((node.r * 2.9) / 64);
    const plaza = plazaOffset(node.r);
    node.haze.position.set(node.pos.x + plaza.x, node.pos.y + plaza.y);
    node.haze.scale.set((node.r * 1.7) / 64);
    node.haze.tint = this.palette.danger;
    for (let i = 0; i < node.crowd.length; i++) {
      const s = node.crowd[i];
      s.tint = this.palette.person;
      s.scale.set(Math.max(0.14, node.r * 0.0052) * personScale(i));
    }
  }

  private drawFootprint(node: DistrictNode): void {
    const p = this.palette;
    const g = node.footprint;
    const { pos, pts } = node;
    g.clear();
    const { start, segments } = smoothClosed(pts);
    // soft under-shadow for depth
    g.moveTo(pos.x + start.x, pos.y + start.y + node.r * 0.07);
    for (const s of segments) g.quadraticCurveTo(pos.x + s.cx, pos.y + s.cy + node.r * 0.07, pos.x + s.x, pos.y + s.y + node.r * 0.07);
    g.closePath();
    g.fill({ color: 0x000000, alpha: 0.4 });
    // footprint
    g.moveTo(pos.x + start.x, pos.y + start.y);
    for (const s of segments) g.quadraticCurveTo(pos.x + s.cx, pos.y + s.cy, pos.x + s.x, pos.y + s.y);
    g.closePath();
    g.fill({ color: p.footprint, alpha: 0.96 });
    g.stroke({ width: 1.2, color: p.footprintEdge, alpha: Math.min(1, 0.22 * p.lineAlpha) });
    // inner plaza (slightly lighter ground where people gather)
    const plaza = plazaOffset(node.r);
    g.ellipse(pos.x + plaza.x, pos.y + plaza.y, node.r * 0.5, node.r * 0.36);
    g.fill({ color: p.footprintEdge, alpha: 0.045 });
    g.stroke({ width: 1, color: p.footprintEdge, alpha: 0.08 });
    // edge illumination along the upper rim
    let open = false;
    let prevEnd = start;
    for (const s of segments) {
      const upper = s.y < -node.r * 0.1 || prevEnd.y < -node.r * 0.1;
      if (upper) {
        if (!open) {
          g.moveTo(pos.x + prevEnd.x, pos.y + prevEnd.y);
          open = true;
        }
        g.quadraticCurveTo(pos.x + s.cx, pos.y + s.cy, pos.x + s.x, pos.y + s.y);
      } else if (open) {
        g.stroke({ width: 1.6, color: p.footprintEdge, alpha: Math.min(1, 0.5 * p.lineAlpha), cap: 'round' });
        open = false;
      }
      prevEnd = { x: s.x, y: s.y };
    }
    if (open) g.stroke({ width: 1.6, color: p.footprintEdge, alpha: Math.min(1, 0.5 * p.lineAlpha), cap: 'round' });
    // faint internal streets
    const inner = node.r * 0.6;
    for (let i = -2; i <= 2; i++) {
      const y = pos.y + i * (inner / 2.2);
      const half = inner * Math.sqrt(Math.max(0, 1 - (i / 2.6) ** 2));
      g.moveTo(pos.x - half, y).lineTo(pos.x + half, y);
    }
    g.stroke({ width: 1, color: p.cyan, alpha: 0.06 });
  }

  private drawBlocks(node: DistrictNode): void {
    const p = this.palette;
    const g = node.blocksG;
    const { pos } = node;
    g.clear();
    for (const b of node.blocks) {
      // drop shadow
      g.rect(pos.x + b.x + 1.5, pos.y + b.y + 2, b.w, b.h);
      g.fill({ color: 0x000000, alpha: 0.35 });
      g.rect(pos.x + b.x, pos.y + b.y, b.w, b.h);
      g.fill({ color: p.blockFill, alpha: 0.97 });
      g.stroke({ width: 1, color: p.blockEdge, alpha: Math.min(1, 0.55 * p.lineAlpha) });
      // top edge light
      g.moveTo(pos.x + b.x + 1, pos.y + b.y + 0.5).lineTo(pos.x + b.x + b.w - 1, pos.y + b.y + 0.5);
      g.stroke({ width: 1, color: p.footprintEdge, alpha: Math.min(1, 0.42 * p.lineAlpha) });
    }
  }

  private drawWindows(node: DistrictNode, force = false): void {
    const p = this.palette;
    const outage = node.view.incident === 'outage';
    const fraction = node.restore >= 0 ? node.cur.services * Math.min(1, node.restore) : node.cur.services;
    const lit = outage ? 0 : fraction;
    const litKey = Math.round(lit * 24);
    if (!force && litKey === node.drawnLit && outage === node.drawnOutage) return;
    node.drawnLit = litKey;
    node.drawnOutage = outage;
    const g = node.windowsG;
    const { pos, r } = node;
    g.clear();
    const ws = Math.max(1.8, r * 0.058);
    for (const b of node.blocks) {
      const total = b.cols * b.rows;
      const litCount = Math.round(total * lit);
      const padX = (b.w - b.cols * ws) / (b.cols + 1);
      const padY = (b.h - b.rows * ws) / (b.rows + 1);
      for (let k = 0; k < total; k++) {
        const idx = b.order[k];
        const col = idx % b.cols;
        const row = Math.floor(idx / b.cols);
        const x = pos.x + b.x + padX + col * (ws + padX);
        const y = pos.y + b.y + padY + row * (ws + padY);
        g.rect(x, y, ws, ws);
        if (k < litCount) g.fill({ color: p.windowLit, alpha: 0.95 });
        else g.fill({ color: p.windowDark, alpha: 0.75 });
      }
    }
  }

  private drawInstitution(node: DistrictNode): void {
    if (!node.inst) return;
    const p = this.palette;
    const g = node.inst;
    const off = institutionOffset(node.r);
    const cx = node.pos.x + off.x;
    const cy = node.pos.y + off.y;
    const rad = node.r * 0.28;
    const active = node.view.institutionActive;
    g.clear();
    g.regularPoly(cx, cy + rad * 0.1, rad, 6, Math.PI / 6);
    g.fill({ color: 0x000000, alpha: 0.4 });
    g.regularPoly(cx, cy, rad, 6, Math.PI / 6);
    g.fill({ color: p.blockFill, alpha: 1 });
    g.stroke({ width: active ? 2 : 1.4, color: active ? p.institutionActive : p.institution, alpha: Math.min(1, (active ? 0.95 : 0.65) * p.lineAlpha) });
    g.regularPoly(cx, cy, rad * 0.56, 6, Math.PI / 6);
    g.fill({ color: active ? p.institutionActive : p.institution, alpha: active ? 0.6 : 0.24 });
    g.moveTo(cx - rad * 0.9, cy).lineTo(cx + rad * 0.9, cy);
    g.stroke({ width: 1, color: p.institution, alpha: 0.5 });
  }

  private layoutRoad(node: RoadNode): void {
    const map = this.map;
    const a = map?.districts.find((d) => d.id === node.view.from);
    const b = map?.districts.find((d) => d.id === node.view.to);
    const pa = a ? this.layout.project(a.x, a.y) : { x: 0, y: 0 };
    const pb = b ? this.layout.project(b.x, b.y) : { x: 0, y: 0 };
    node.curve = roadCurve(node.id, pa, pb);
    node.length = Math.max(1, curveLength(node.curve));
    this.roadCurves.set(node.id, node.curve);
  }

  private drawRoad(node: RoadNode): void {
    const p = this.palette;
    const g = node.line;
    const base = Math.max(1.2, this.layout.unit * 0.045);
    const status: RoadStatus = node.view.status;
    const cv = node.curve;
    const stroke = (width: number, color: number, alpha: number) => {
      g.moveTo(cv.a.x, cv.a.y).quadraticCurveTo(cv.c.x, cv.c.y, cv.b.x, cv.b.y);
      g.stroke({ width, color, alpha, cap: 'round' });
    };
    g.clear();
    stroke(base * 5, 0x000000, 0.2); // depth under-glow
    if (status === 'open') {
      stroke(base * 2.4, p.roadOpen, Math.min(1, 0.07 * p.lineAlpha));
      stroke(base, p.roadOpen, Math.min(1, 0.38 * p.lineAlpha));
    } else if (status === 'congested') {
      stroke(base * 2.4, p.roadCongested, Math.min(1, 0.32 * p.lineAlpha));
    } else {
      stroke(base, p.roadClosed, Math.min(1, 0.24 * p.lineAlpha));
      // barricade ticks
      const tl = this.layout.unit * 0.17;
      for (const t of [0.42, 0.5, 0.58]) {
        const c = curvePoint(cv, t);
        const ang = curveTangent(cv, t);
        const nx = -Math.sin(ang);
        const ny = Math.cos(ang);
        g.moveTo(c.x - nx * tl, c.y - ny * tl).lineTo(c.x + nx * tl, c.y + ny * tl);
      }
      g.stroke({ width: Math.max(2, base * 1.6), color: p.roadClosed, alpha: 0.95, cap: 'round' });
    }
  }

  private buildDashes(node: RoadNode): void {
    for (const d of node.dashes) d.destroy();
    node.dashes = [];
    const status = node.view.status;
    if (status === 'open') return;
    const spacing = this.layout.unit * 0.42;
    const count = Math.max(2, Math.floor(node.length / spacing));
    const color = status === 'congested' ? this.palette.roadCongested : this.palette.roadClosed;
    for (let i = 0; i < count; i++) {
      const s = new Sprite(this.tex.dash);
      s.anchor.set(0.5);
      s.tint = color;
      s.scale.set(this.layout.unit * 0.0075, this.layout.unit * 0.012);
      s.alpha = status === 'congested' ? 0.75 : 0.55;
      node.dashes.push(s);
      this.dashLayer.addChild(s);
    }
    this.placeDashes(node);
  }

  private placeDashes(node: RoadNode): void {
    const n = node.dashes.length;
    if (!n) return;
    const spacing = node.length / n;
    const margin = this.layout.unit * 0.95;
    for (let i = 0; i < n; i++) {
      let s = (i * spacing + node.offset) % node.length;
      if (s < 0) s += node.length;
      const t = s / node.length;
      const pt = curvePoint(node.curve, t);
      const d = node.dashes[i];
      d.position.set(pt.x, pt.y);
      d.rotation = curveTangent(node.curve, t);
      const edge = Math.min(s, node.length - s);
      d.visible = edge > margin * 0.8;
    }
  }

  private layoutSignal(node: SignalNode): void {
    const map = this.map;
    if (map) node.curve = signalCurve(map, this.roadCurves, node.view.from, node.view.to, this.layout);
    const u = this.layout.unit;
    const strong = node.kind === 'verified' || node.kind === 'official';
    node.head.scale.set(strong ? u * 0.012 : u * 0.009, strong ? u * 0.012 : u * 0.014);
    node.headGlow.scale.set((u * (strong ? 1.1 : 0.7)) / 64);
    for (const t of node.trail) t.scale.set(u * 0.008, u * 0.009);
    for (const bgl of node.bugs) bgl.sprite.scale.set(Math.max(0.3, u * 0.0085));
  }

  private drawFocus(): void {
    const g = this.focusG;
    g.clear();
    const node = this.focusId ? this.districts.get(this.focusId) : undefined;
    if (!node) {
      this.focusGlow.visible = false;
      return;
    }
    const p = this.palette;
    const rad = node.r * 1.2;
    g.circle(node.pos.x, node.pos.y, rad);
    g.stroke({ width: 2, color: p.focus, alpha: 0.9 });
    g.circle(node.pos.x, node.pos.y, rad + 5);
    g.stroke({ width: 1, color: p.focus, alpha: 0.35 });
    this.focusGlow.visible = true;
    this.focusGlow.tint = p.focus;
    this.focusGlow.alpha = 0.35 * p.glowAlpha;
    this.focusGlow.position.set(node.pos.x, node.pos.y);
    this.focusGlow.scale.set((rad * 2.6) / 64);
  }

  /** Reduced-motion: static markers for recent actions, incidents and institution activity. */
  private drawStatic(): void {
    const g = this.staticG;
    g.clear();
    const map = this.map;
    if (!map) return;
    const p = this.palette;
    for (const a of map.recentActions) {
      if (map.tick - a.at > 4) continue;
      const node = this.districts.get(a.district);
      if (!node) continue;
      const color = actionColor(a.kind, p);
      g.circle(node.pos.x, node.pos.y, node.r * 1.05);
      g.stroke({ width: 2, color, alpha: 0.85 });
      g.circle(node.pos.x, node.pos.y, node.r * 1.3);
      g.stroke({ width: 1, color, alpha: 0.4 });
    }
    for (const node of this.districts.values()) {
      if (node.view.incident) {
        const plaza = plazaOffset(node.r);
        const cx = node.pos.x + plaza.x;
        const cy = node.pos.y + plaza.y;
        const color = node.view.incident === 'fire' ? p.saffron : p.danger;
        g.circle(cx, cy, node.r * 0.5);
        g.stroke({ width: 2, color, alpha: 0.9 });
        g.circle(cx, cy, node.r * 0.62);
        g.stroke({ width: 1, color, alpha: 0.45 });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Animation
  // -------------------------------------------------------------------------

  private frame = (ticker: Ticker) => {
    if (this.destroyed) return;
    const dt = Math.min(0.05, ticker.deltaMS / 1000);
    this.time += dt;
    const t0 = performance.now();
    this.animate(dt);
    const ms = performance.now() - t0;
    mapStats.frames += 1;
    mapStats.animateMs += ms;
    if (ms > mapStats.maxAnimateMs) mapStats.maxAnimateMs = ms;
  };

  private snapDistrict(node: DistrictNode): void {
    const v = node.view;
    node.cur.crowd = v.crowd;
    node.cur.trust = v.trust;
    node.cur.services = v.services;
    node.cur.shown = crowdCount(v.crowd);
    for (const m of MOODS) node.cur.mood[m] = v.mood === m ? 1 : 0;
  }

  private snapAll(): void {
    for (const node of this.districts.values()) {
      this.snapDistrict(node);
      node.restore = -1;
    }
    for (const sig of this.signals.values()) {
      sig.progress = sig.view.progress;
      sig.alpha = sig.fading ? 0 : 1;
    }
  }

  private animate(dt: number): void {
    const p = this.palette;
    const t = this.time;
    const reduced = this.reduced;

    // Districts -----------------------------------------------------------
    for (const node of this.districts.values()) {
      const v = node.view;
      const c = node.cur;
      if (!reduced) {
        c.crowd = approach(c.crowd, v.crowd, dt, 0.9);
        c.trust = approach(c.trust, v.trust, dt, 1.2);
        c.services = approach(c.services, v.services, dt, 1.0);
        c.shown = approach(c.shown, crowdCount(v.crowd), dt, 0.7);
        for (const m of MOODS) c.mood[m] = approach(c.mood[m], v.mood === m ? 1 : 0, dt, 0.8);
      }
      node.glow.tint = trustColor(c.trust, p);
      node.glow.alpha = (0.14 + 0.42 * c.trust) * p.glowAlpha;
      if (node.restore >= 0) {
        node.restore += dt / 1.4;
        if (node.restore >= 1) node.restore = -1;
      }
      this.drawWindows(node);
      node.windowsG.alpha = v.incident === 'outage' ? (reduced ? 0.4 : 0.25 + 0.2 * Math.abs(Math.sin(t * 9 + node.pos.x))) : 1;

      const shown = Math.floor(c.shown + 0.001);
      const amp =
        node.r *
        (c.mood.calm * 0.045 + c.mood.tense * 0.03 + c.mood.volatile * 0.075 + c.mood.hopeful * 0.035) *
        (reduced ? 0 : 1);
      const plaza = plazaOffset(node.r);
      for (let i = 0; i < node.crowd.length; i++) {
        const s = node.crowd[i];
        const want = i < shown;
        const targetAlpha = want ? 0.86 : 0;
        s.alpha = reduced ? targetAlpha : approach(s.alpha, targetAlpha, dt, 0.35);
        s.visible = s.alpha > 0.02;
        if (!s.visible) continue;
        const base = node.crowdBase[i];
        const ph = i * 1.73;
        const dist = Math.hypot(base.x - plaza.x, base.y - plaza.y) / Math.max(1, node.r);
        let dx = 0;
        let dy = 0;
        if (!reduced) {
          const hope = c.mood.hopeful * Math.sin(t * 0.9 - dist * 3) * 0.04;
          dx = amp * (c.mood.calm * Math.sin(t * 0.5 + ph) + c.mood.tense * Math.sin(t * 2.6 + ph * 1.3) + c.mood.volatile * Math.sin(t * 6.3 + ph * 2.1) + hope * (base.x - plaza.x));
          dy = amp * (c.mood.calm * Math.cos(t * 0.42 + ph * 0.7) + c.mood.tense * Math.cos(t * 2.2 + ph) + c.mood.volatile * Math.cos(t * 5.7 + ph * 1.7) + hope * (base.y - plaza.y));
        }
        s.position.set(node.pos.x + base.x + dx, node.pos.y + base.y + dy);
        s.tint = c.mood.hopeful > 0.5 ? p.safety : p.person;
      }
      const hazeTarget = Math.max(c.mood.volatile * 0.3, v.incident === 'intimidation' ? 0.18 : 0) * p.glowAlpha;
      node.haze.alpha = reduced ? hazeTarget : approach(node.haze.alpha, hazeTarget, dt, 0.6);
      if (reduced) continue;
      if (c.mood.hopeful > 0.5) {
        node.hopeTimer += dt;
        if (node.hopeTimer > 2.2) {
          node.hopeTimer = 0;
          this.effects.push(this.ringEffect(node.pos.x + plaza.x, node.pos.y + plaza.y, node.r * 0.3, node.r * 1.1, p.safety, 1.8, 0.45));
        }
      }
      if (v.institutionActive && node.inst) {
        node.instTimer += dt;
        node.inst.alpha = 0.85 + 0.15 * Math.sin(t * 4);
        if (node.instTimer > 1.3) {
          node.instTimer = 0;
          const off = institutionOffset(node.r);
          this.effects.push(this.ringEffect(node.pos.x + off.x, node.pos.y + off.y, node.r * 0.25, node.r * 0.9, p.institutionActive, 1.2, 0.8));
        }
      } else if (node.inst) node.inst.alpha = 1;
      if (v.incident) this.animateIncident(node, dt);
    }

    // Roads ---------------------------------------------------------------
    for (const road of this.roads.values()) {
      if (!reduced && road.view.status === 'congested') {
        road.offset += dt * this.layout.unit * 0.22;
        this.placeDashes(road);
      }
    }

    // Signals -------------------------------------------------------------
    const cleaners: Point[] = [];
    for (const sig of this.signals.values()) {
      if (sig.kind === 'verified' || sig.kind === 'official') cleaners.push(curvePoint(sig.curve, sig.progress));
    }
    const toRemove: SignalNode[] = [];
    for (const sig of this.signals.values()) {
      const target = sig.fading ? 0 : 1;
      sig.alpha = reduced ? target : approach(sig.alpha, target, dt, 0.3);
      if (sig.fading && sig.alpha < 0.03) {
        toRemove.push(sig);
        continue;
      }
      sig.progress = reduced ? sig.view.progress : approach(sig.progress, sig.view.progress, dt, 0.4);
      const strong = sig.kind === 'verified' || sig.kind === 'official';
      const color = signalColor(sig.kind, p);
      const head = curvePoint(sig.curve, sig.progress);
      const ang = curveTangent(sig.curve, sig.progress);
      // travelled path
      const g = sig.path;
      g.clear();
      const steps = 10;
      g.moveTo(sig.curve.a.x, sig.curve.a.y);
      for (let i = 1; i <= steps; i++) {
        const pt = curvePoint(sig.curve, (sig.progress * i) / steps);
        g.lineTo(pt.x, pt.y);
      }
      g.stroke({ width: strong ? 2 : 1.5, color, alpha: sig.alpha * (strong ? 0.5 : 0.35), cap: 'round', join: 'round' });
      sig.head.position.set(head.x, head.y);
      sig.head.rotation = ang;
      sig.head.alpha = sig.alpha;
      sig.headGlow.position.set(head.x, head.y);
      sig.headGlow.alpha = sig.alpha * (strong ? 0.8 : 0.45) * p.glowAlpha;
      for (let i = 0; i < sig.trail.length; i++) {
        const tr = sig.trail[i];
        const pr = sig.progress - (i + 1) * 0.028;
        const pt = curvePoint(sig.curve, Math.max(0, pr));
        tr.position.set(pt.x, pt.y);
        tr.rotation = curveTangent(sig.curve, Math.max(0, pr));
        tr.alpha = sig.alpha * (0.55 - i * 0.08) * (pr > 0 ? 1 : 0);
      }
      const nx = -Math.sin(ang);
      const ny = Math.cos(ang);
      for (const b of sig.bugs) {
        const pr = Math.max(0, sig.progress - b.lag);
        const pt = curvePoint(sig.curve, pr);
        const wob = reduced ? 0 : Math.sin(t * 7 + b.phase) * this.layout.unit * 0.06;
        b.sprite.position.set(pt.x + nx * wob, pt.y + ny * wob);
        b.sprite.rotation = ang + (reduced ? 0 : Math.sin(t * 5 + b.phase) * 0.5);
        for (const c of cleaners) {
          if (Math.hypot(c.x - pt.x, c.y - pt.y) < this.layout.unit * 0.6) b.dissolve = Math.min(1, b.dissolve + dt * 2.5);
        }
        const k = 1 - b.dissolve;
        b.sprite.alpha = sig.alpha * 0.95 * k;
        b.sprite.scale.set(Math.max(0.3, this.layout.unit * 0.0085) * (0.4 + 0.6 * k));
      }
      if (!reduced && strong) {
        sig.ringTimer += dt;
        if (sig.ringTimer > 0.55) {
          sig.ringTimer = 0;
          this.effects.push(this.ringEffect(head.x, head.y, this.layout.unit * 0.1, this.layout.unit * 0.5, color, 0.6, 0.6));
        }
      }
    }
    for (const sig of toRemove) this.destroySignal(sig);

    // Effects -------------------------------------------------------------
    if (!reduced) {
      const keep: Effect[] = [];
      for (const e of this.effects) {
        if (e.update(dt)) keep.push(e);
        else e.destroy();
      }
      this.effects = keep;
    }

    // Focus ring breathing
    if (!reduced && this.focusGlow.visible) {
      const s = 1 + 0.03 * Math.sin(t * 2.2);
      this.focusGlow.alpha = (0.3 + 0.08 * Math.sin(t * 2.2)) * p.glowAlpha;
      this.focusGlow.scale.set(this.focusBaseScale() * s);
    }
  }

  private focusBaseScale(): number {
    const node = this.focusId ? this.districts.get(this.focusId) : undefined;
    return node ? (node.r * 1.2 * 2.6) / 64 : 1;
  }

  private animateIncident(node: DistrictNode, dt: number): void {
    const p = this.palette;
    const plaza = plazaOffset(node.r);
    const cx = node.pos.x + plaza.x;
    const cy = node.pos.y + plaza.y;
    node.incidentTimer += dt;
    switch (node.view.incident) {
      case 'vandalism':
        if (node.incidentTimer > 0.85) {
          node.incidentTimer = 0;
          const b = node.blocks[Math.floor(Math.random() * node.blocks.length)] ?? { x: 0, y: 0, w: 0, h: 0 };
          this.effects.push(this.sparkBurst(node.pos.x + b.x + b.w / 2, node.pos.y + b.y + b.h / 2, 6, p.danger, node.r * 0.5, 0.55));
        }
        break;
      case 'clash':
        if (node.incidentTimer > 1.0) {
          node.incidentTimer = 0;
          this.effects.push(this.ringEffect(cx, cy, node.r * 0.15, node.r * 0.8, p.danger, 0.9, 0.9));
          this.effects.push(this.ringEffect(cx + node.r * 0.2, cy - node.r * 0.1, node.r * 0.1, node.r * 0.6, p.steel, 0.9, 0.7));
          this.effects.push(this.sparkBurst(cx, cy, 5, p.danger, node.r * 0.35, 0.45));
        }
        break;
      case 'fire':
        if (node.incidentTimer > 0.3) {
          node.incidentTimer = 0;
          const b = node.blocks[0] ?? { x: 0, y: 0, w: 0, h: 0 };
          this.effects.push(this.riseEffect(node.pos.x + b.x + b.w / 2, node.pos.y + b.y, p.saffron, node.r * 0.35, 1.1, 3, 0.6));
        }
        break;
      case 'intimidation':
        if (node.incidentTimer > 2.4) {
          node.incidentTimer = 0;
          this.effects.push(this.ringEffect(cx, cy, node.r * 0.2, node.r * 1.2, p.danger, 2.2, 0.5));
        }
        break;
      default:
        break;
    }
  }

  private spawnAction(districtId: string, kind: MapActionKind): void {
    const node = this.districts.get(districtId);
    if (!node) return;
    const p = this.palette;
    const plaza = plazaOffset(node.r);
    const cx = node.pos.x;
    const cy = node.pos.y;
    const px = cx + plaza.x;
    const py = cy + plaza.y;
    switch (kind) {
      case 'deploy':
        this.effects.push(this.ringEffect(px, py, node.r * 0.2, node.r * 1.0, p.safety, 1.2, 0.9));
        this.effects.push(this.dotsArrive(px, py, node.r, p.safety));
        break;
      case 'dialogue':
        this.effects.push(this.arcsMeet(px, py, node.r * 0.55, p.cyan));
        break;
      case 'announce':
        for (let i = 0; i < 3; i++) this.effects.push(this.ringEffect(cx, cy, node.r * 0.3, this.layout.unit * 7, p.cyan, 2.4, 0.6, i * 0.35));
        break;
      case 'investigate':
        this.effects.push(this.sweep(node, p.cyan));
        break;
      case 'restore':
        this.effects.push(this.ringEffect(cx, cy, node.r * 0.3, node.r * 1.1, p.economy, 1.2, 0.5));
        break;
      case 'protect':
        this.effects.push(this.shieldArc(cx, cy, node.r * 1.12, p.legitimacy));
        break;
      case 'relief':
        this.effects.push(this.riseEffect(px, py, p.economy, node.r * 0.6, 1.8, 8, 0.8));
        break;
      case 'legal':
        this.effects.push(this.squarePulse(cx, cy, node.r * 0.9, p.legitimacy));
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Effect factories (closures; each returns false when finished)
  // -------------------------------------------------------------------------

  private ringEffect(x: number, y: number, r0: number, r1: number, color: number, dur: number, alpha: number, delay = 0): Effect {
    const s = new Sprite(this.tex.ring);
    s.anchor.set(0.5);
    s.tint = color;
    s.blendMode = 'add';
    s.position.set(x, y);
    s.visible = false;
    this.effectLayer.addChild(s);
    let t = -delay;
    return {
      update: (dt) => {
        t += dt;
        if (t < 0) return true;
        const k = Math.min(1, t / dur);
        const ease = 1 - Math.pow(1 - k, 2.2);
        const rad = lerp(r0, r1, ease);
        s.visible = true;
        s.scale.set((rad * 2) / 96);
        s.alpha = alpha * (1 - k);
        return k < 1;
      },
      destroy: () => s.destroy(),
    };
  }

  private sparkBurst(x: number, y: number, n: number, color: number, spread: number, dur: number): Effect {
    const sprites: { s: Sprite; vx: number; vy: number }[] = [];
    for (let i = 0; i < n; i++) {
      const s = new Sprite(this.tex.spark);
      s.anchor.set(0.5);
      s.tint = color;
      s.blendMode = 'add';
      s.position.set(x, y);
      s.scale.set(0.9);
      const a = Math.random() * Math.PI * 2;
      const sp = (0.4 + Math.random() * 0.6) * spread;
      sprites.push({ s, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - spread * 0.4 });
      this.effectLayer.addChild(s);
    }
    let t = 0;
    return {
      update: (dt) => {
        t += dt;
        const k = Math.min(1, t / dur);
        for (const it of sprites) {
          it.s.x += it.vx * dt;
          it.s.y += it.vy * dt;
          it.vy += spread * 1.5 * dt;
          it.s.alpha = 1 - k;
        }
        return k < 1;
      },
      destroy: () => sprites.forEach((it) => it.s.destroy()),
    };
  }

  private riseEffect(x: number, y: number, color: number, height: number, dur: number, n: number, alpha: number): Effect {
    const glow = new Sprite(this.tex.glow);
    glow.anchor.set(0.5);
    glow.tint = color;
    glow.blendMode = 'add';
    glow.position.set(x, y);
    glow.scale.set(height / 64);
    this.effectLayer.addChild(glow);
    const dots: { s: Sprite; dx: number; speed: number; ph: number }[] = [];
    for (let i = 0; i < n; i++) {
      const s = new Sprite(this.tex.spark);
      s.anchor.set(0.5);
      s.tint = color;
      s.blendMode = 'add';
      s.scale.set(0.7);
      dots.push({ s, dx: (Math.random() - 0.5) * height * 0.8, speed: 0.6 + Math.random() * 0.6, ph: Math.random() * 6 });
      this.effectLayer.addChild(s);
    }
    let t = 0;
    return {
      update: (dt) => {
        t += dt;
        const k = Math.min(1, t / dur);
        glow.alpha = alpha * Math.sin(k * Math.PI) * 0.6;
        glow.y = y - height * 0.4 * k;
        for (const d of dots) {
          const kk = Math.min(1, k * d.speed * 1.4);
          d.s.position.set(x + d.dx + Math.sin(t * 3 + d.ph) * 3, y - height * kk);
          d.s.alpha = (1 - kk) * alpha;
        }
        return k < 1;
      },
      destroy: () => {
        glow.destroy();
        dots.forEach((d) => d.s.destroy());
      },
    };
  }

  private dotsArrive(x: number, y: number, r: number, color: number): Effect {
    const dots: Sprite[] = [];
    const n = 6;
    for (let i = 0; i < n; i++) {
      const s = new Sprite(this.tex.dot);
      s.anchor.set(0.5);
      s.tint = color;
      s.scale.set(Math.max(0.16, r * 0.007));
      dots.push(s);
      this.effectLayer.addChild(s);
    }
    let t = 0;
    const dur = 1.4;
    return {
      update: (dt) => {
        t += dt;
        const k = Math.min(1, t / dur);
        for (let i = 0; i < n; i++) {
          const kk = Math.min(1, Math.max(0, k * 1.6 - i * 0.08));
          const ease = 1 - Math.pow(1 - kk, 2);
          const sx = x + r * 1.4;
          const sy = y - r * 1.1;
          const tx = x + (i - (n - 1) / 2) * r * 0.16;
          const ty = y - r * 0.25;
          dots[i].position.set(lerp(sx, tx, ease), lerp(sy, ty, ease));
          dots[i].alpha = kk > 0 ? (k > 0.8 ? (1 - k) / 0.2 : 1) : 0;
        }
        return k < 1;
      },
      destroy: () => dots.forEach((d) => d.destroy()),
    };
  }

  private arcsMeet(x: number, y: number, r: number, color: number): Effect {
    const g = new Graphics();
    this.effectLayer.addChild(g);
    let t = 0;
    const dur = 1.5;
    return {
      update: (dt) => {
        t += dt;
        const k = Math.min(1, t / dur);
        const ease = 1 - Math.pow(1 - Math.min(1, k * 1.3), 2);
        const gap = r * 0.9 * (1 - ease);
        const fade = k > 0.7 ? (1 - k) / 0.3 : 1;
        g.clear();
        g.arc(x - gap, y, r * 0.5, Math.PI * 0.6, Math.PI * 1.4);
        g.stroke({ width: 2.5, color, alpha: 0.9 * fade, cap: 'round' });
        g.arc(x + gap, y, r * 0.5, -Math.PI * 0.4, Math.PI * 0.4);
        g.stroke({ width: 2.5, color, alpha: 0.9 * fade, cap: 'round' });
        if (ease > 0.95) {
          g.circle(x, y, r * 0.12 + r * 0.3 * (k - 0.7));
          g.stroke({ width: 1.5, color, alpha: 0.7 * fade });
        }
        return k < 1;
      },
      destroy: () => g.destroy(),
    };
  }

  private sweep(node: DistrictNode, color: number): Effect {
    const g = new Graphics();
    this.effectLayer.addChild(g);
    let t = 0;
    const dur = 1.6;
    const { pos, r } = node;
    return {
      update: (dt) => {
        t += dt;
        const k = Math.min(1, t / dur);
        const y = pos.y - r + 2 * r * k;
        const dy = Math.abs(y - pos.y) / r;
        const half = r * Math.sqrt(Math.max(0, 1 - dy * dy)) * 1.02;
        g.clear();
        if (half > 2) {
          g.rect(pos.x - half, y - r * 0.18, half * 2, r * 0.18);
          g.fill({ color, alpha: 0.12 });
          g.moveTo(pos.x - half, y).lineTo(pos.x + half, y);
          g.stroke({ width: 2, color, alpha: 0.85, cap: 'round' });
        }
        return k < 1;
      },
      destroy: () => g.destroy(),
    };
  }

  private shieldArc(x: number, y: number, r: number, color: number): Effect {
    const g = new Graphics();
    this.effectLayer.addChild(g);
    let t = 0;
    const dur = 3.2;
    return {
      update: (dt) => {
        t += dt;
        const k = Math.min(1, t / dur);
        const a = k < 0.2 ? k / 0.2 : k > 0.75 ? (1 - k) / 0.25 : 1;
        g.clear();
        g.arc(x, y, r, Math.PI * 1.1, Math.PI * 1.9);
        g.stroke({ width: 3, color, alpha: 0.9 * a, cap: 'round' });
        g.arc(x, y, r + 6, Math.PI * 1.15, Math.PI * 1.85);
        g.stroke({ width: 1, color, alpha: 0.4 * a, cap: 'round' });
        return k < 1;
      },
      destroy: () => g.destroy(),
    };
  }

  private squarePulse(x: number, y: number, size: number, color: number): Effect {
    const g = new Graphics();
    this.effectLayer.addChild(g);
    let t = 0;
    const dur = 1.4;
    return {
      update: (dt) => {
        t += dt;
        const k = Math.min(1, t / dur);
        const s = size * (0.8 + 0.5 * k);
        g.clear();
        g.rect(x - s / 2, y - s / 2, s, s);
        g.stroke({ width: 2, color, alpha: 0.9 * (1 - k) });
        return k < 1;
      },
      destroy: () => g.destroy(),
    };
  }
}

function actionColor(kind: MapActionKind, p: MapPalette): number {
  switch (kind) {
    case 'deploy':
      return p.safety;
    case 'dialogue':
    case 'announce':
    case 'investigate':
      return p.cyan;
    case 'restore':
    case 'relief':
      return p.economy;
    case 'protect':
    case 'legal':
      return p.legitimacy;
  }
}

export async function createCityScene(opts: CitySceneOptions): Promise<CityScene> {
  const app = new Application();
  await app.init({
    canvas: opts.canvas,
    width: Math.max(2, opts.width),
    height: Math.max(2, opts.height),
    antialias: true,
    backgroundAlpha: 0,
    resolution: Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2),
    autoDensity: true,
    preference: ['webgl', 'canvas'],
    powerPreference: 'high-performance',
  });
  return new Scene(app, opts);
}
