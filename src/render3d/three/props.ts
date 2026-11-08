/**
 * Props and effects: the bat, the wickets (stumps and bails), the event effects and the blob shadows. Original,
 * procedural work (geometry and canvas-painted textures built in code from seeded streams; no external assets).
 *
 * Everything that moves is evaluated from scene time (no accumulated state), so seeking and offline frame stepping
 * always give the same image: particles are seeded per burst, stumps and bails follow closed-form motion from the
 * script's stump hit, and the Practice pitch scuff is a pure function of the bounce event.
 *
 * Physical dimensions come from src/physics (constants.ts, geometry.ts): what is drawn is what collides. The bat's
 * face is the physics collision face (BLADE_T / 2 in front of the bat's axis), its blade BLADE_L × BLADE_W with EDGE_T
 * edges, and its sweet spot SWEET_U along the blade from the toe; the stumps are STUMP_H tall, STUMP_R in radius and
 * STUMP_SPACING apart; the two bails (Law 8.3: 10.95 cm, barrel 5.40 cm, spigots 3.50 and 2.06 cm) sit in the grooves
 * and rise less than BAIL_RISE above the stumps.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PITCH_HALF, STUMP_H, STUMP_R, STUMP_SPACING } from '../core/ground';
import { BLADE_L, BLADE_T, BLADE_W, EDGE_T, HANDLE_L, LOWER_HAND_FROM_CAP, SWEET_U } from '@/physics/constants';
import { type BallScript, type SceneEvent, sampleBall } from '../core/choreo';
import { clamp, easeOut, seededStream } from '../core/math';

// ---------------------------------------------------------------------------------------------------------------
// Painted textures (shared helpers). A 2D canvas is painted once, then copied into a DataTexture so the alpha channel
// can carry a material property (roughness) without the canvas's premultiplied-alpha loss. Without a 2D canvas
// (jsdom in unit tests, a stripped WebView) every painter returns a 1 × 1 texture of its base value instead.
// ---------------------------------------------------------------------------------------------------------------

export type Painter = (g: CanvasRenderingContext2D, w: number, h: number) => void;

function context2d(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  try {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
  } catch {
    return null;
  }
}

function finishData(t: DataTexture, srgb: boolean, repeat: boolean): DataTexture {
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/** A flat 1 × 1 texture (the fallback when nothing can be painted). */
export function flatTexture(rgba: readonly [number, number, number, number], srgb = true): DataTexture {
  return finishData(new DataTexture(new Uint8Array(rgba), 1, 1), srgb, false);
}

/**
 * Paints `color` (and optionally `alpha`, a greyscale painter whose red channel becomes the alpha byte; without it the
 * colour canvas keeps its own alpha) on canvases of w × h and returns one RGBA DataTexture. Row 0 of the texture is the
 * canvas's bottom row (v = 0), as for a CanvasTexture with flipY.
 */
function paintTexture(
  w: number,
  h: number,
  color: Painter,
  alpha: Painter | null,
  o: { srgb?: boolean; repeat?: boolean; fallback: readonly [number, number, number, number] },
): DataTexture {
  const g = context2d(w, h);
  if (!g) return flatTexture(o.fallback, o.srgb ?? true);
  color(g, w, h);
  const rgb = g.getImageData(0, 0, w, h).data;
  let a: Uint8ClampedArray | null = null;
  if (alpha) {
    const ga = context2d(w, h)!;
    alpha(ga, w, h);
    a = ga.getImageData(0, 0, w, h).data;
  }
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4;
    const dst = y * w * 4;
    for (let x = 0; x < w * 4; x += 4) {
      out[dst + x] = rgb[src + x];
      out[dst + x + 1] = rgb[src + x + 1];
      out[dst + x + 2] = rgb[src + x + 2];
      out[dst + x + 3] = a ? a[src + x] : rgb[src + x + 3];
    }
  }
  return finishData(new DataTexture(out, w, h), o.srgb ?? true, o.repeat ?? false);
}

/**
 * A tangent-space normal map from a greyscale height painter (red channel; white is high). `strength` is the slope
 * scale; `wrap` makes the differences wrap around (tiling textures); `scale` paints the same art on a smaller canvas.
 */
function paintNormalMap(
  w0: number,
  h0: number,
  height: Painter,
  strength0: number,
  wrap = false,
  scale = 1,
): DataTexture {
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const strength = strength0 * scale;
  const g = context2d(w, h);
  if (!g) return flatTexture([128, 128, 255, 255], false);
  if (scale !== 1) g.scale(scale, scale);
  height(g, w0, h0);
  const src = g.getImageData(0, 0, w, h).data;
  // Heights with row 0 at the bottom (texture space, v up).
  const hgt = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) hgt[y * w + x] = src[((h - 1 - y) * w + x) * 4] / 255;
  const at = (x: number, y: number) => {
    if (wrap) return hgt[((y + h) % h) * w + ((x + w) % w)];
    return hgt[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)];
  };
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * w + x) * 4;
      out[i] = Math.round((-dx / l) * 127.5 + 127.5);
      out[i + 1] = Math.round((-dy / l) * 127.5 + 127.5);
      out[i + 2] = Math.round((1 / l) * 127.5 + 127.5);
      out[i + 3] = 255;
    }
  }
  return finishData(new DataTexture(out, w, h), false, wrap);
}

/**
 * A sRGB CanvasTexture (plain colour art: decals, boards). `scale` paints the same art on a smaller canvas (lower
 * tiers). Falls back to a flat texture without a canvas.
 */
export function canvasArt(
  w: number,
  h: number,
  draw: Painter,
  fallback: readonly [number, number, number, number] = [255, 255, 255, 255],
  scale = 1,
): Texture {
  const g = context2d(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
  if (!g) return flatTexture(fallback);
  if (scale !== 1) g.scale(scale, scale);
  draw(g, w, h);
  const t = new CanvasTexture(g.canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Seeded helpers for painters. */
export function rng(seed: number) {
  const r = seededStream(seed);
  return {
    r,
    range: (a: number, b: number) => a + (b - a) * r(),
    pick: <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length) % xs.length],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Bat
// ---------------------------------------------------------------------------------------------------------------

/** The bat's local frame: the top of the handle at the origin, the toe at y = BAT_TOE_Y, the face towards +z. */
export const BAT_TOE_Y = -(HANDLE_L + BLADE_L);
const BAT_SHOULDER_Y = -HANDLE_L;
/** The face plane: the physics collision face, BLADE_T / 2 in front of the bat's axis (src/physics/collision.ts). */
export const BAT_FACE_Z = BLADE_T / 2;
/** The sweet spot on the face, SWEET_U of the blade from the toe (the physics sweet spot). */
export const BAT_SWEET = Object.freeze({ x: 0, y: BAT_TOE_Y + SWEET_U * BLADE_L, z: BAT_FACE_Z });
/** Depth from the face to the top of the spine where it is deepest (Law 5: at most 6.7 cm), and where that is. */
export const BAT_SPINE_DEPTH = 0.064;
const SPINE_PEAK_U = 0.3;
/** The shoulders curve into the handle over this much of the top of the blade. */
const SHOULDER_LEN = 0.05;
const TOE_R = 0.014;
const CORNER_R = 0.0045;
const CANE_R = 0.0158;
export const GRIP_R = 0.0182;

/** Atlas columns (u ranges) of the bat texture, in order around the blade's section: left edge (front half), face,
 * right edge, back (spine), left edge (back half), then the handle. */
const AT = {
  el1: [0, 0.035],
  face: [0.035, 0.41],
  er: [0.41, 0.49],
  back: [0.49, 0.865],
  el2: [0.865, 0.9],
  handle: [0.9, 1],
} as const;

interface Section {
  y: number;
  hw: number;
  edge: number;
  depth: number;
}

/** The blade's cross-section at u (fraction of the blade from the toe). */
function bladeSection(u: number): Section {
  const y = BAT_TOE_Y + u * BLADE_L;
  // Spine: deepest at SPINE_PEAK_U, easing towards the toe and the shoulders.
  const k = u < SPINE_PEAK_U ? u / SPINE_PEAK_U : (1 - u) / (1 - SPINE_PEAK_U);
  const s = Math.sin((Math.PI / 2) * clamp(k, 0, 1));
  let depth = 0.046 + (BAT_SPINE_DEPTH - 0.046) * s * s;
  let edge = EDGE_T * (0.9 + 0.1 * clamp(u / 0.25, 0, 1));
  let hw = BLADE_W / 2;
  // Toe: rounded corners.
  const fromToe = u * BLADE_L;
  if (fromToe < TOE_R) {
    const d = TOE_R - fromToe;
    hw -= TOE_R - Math.sqrt(Math.max(0, TOE_R * TOE_R - d * d));
  }
  // Shoulders: a quarter ellipse from the full width into the handle.
  const fromTop = (1 - u) * BLADE_L;
  if (fromTop < SHOULDER_LEN) {
    const t = 1 - fromTop / SHOULDER_LEN;
    const c = Math.sqrt(Math.max(0, 1 - t * t));
    hw = GRIP_R * 1.15 + (hw - GRIP_R * 1.15) * c;
    depth = 0.04 + (depth - 0.04) * c;
    edge = Math.min(edge, depth) * (0.75 + 0.25 * c);
  }
  return { y, hw, edge, depth };
}

/** How far the convex edges bow out beyond the section's corners (m). */
const EDGE_BULGE = 0.0006;

/**
 * The section's outline, from the middle of the left edge round the face, the right edge and the spine back to the
 * left edge, with the atlas u of each point. Points: [x, z, u].
 */
function sectionOutline(sec: Section): Array<[number, number, number]> {
  // The edges are slightly convex; inset them so the widest point is the physics blade (Law 5: at most 10.8 cm).
  const s = { ...sec, hw: sec.hw - EDGE_BULGE };
  const F = BAT_FACE_Z;
  const r = Math.min(CORNER_R, s.edge * 0.3, s.hw * 0.25);
  const B = F - s.edge; // back of the edges
  const pts: Array<[number, number, number]> = [];
  const lerpU = (range: readonly [number, number], t: number) => range[0] + (range[1] - range[0]) * t;
  // Left edge, front half (from the middle up to the face corner).
  for (let i = 0; i <= 2; i++) {
    const t = i / 3;
    const z = (F + B) / 2 + t * (F - r - (F + B) / 2);
    pts.push([-s.hw - EDGE_BULGE * Math.sin(Math.PI * (0.5 + t * 0.5)), z, lerpU(AT.el1, t * 0.75)]);
  }
  // Front-left corner, face, front-right corner.
  for (let i = 0; i <= 2; i++) {
    const a = Math.PI - (i / 2) * (Math.PI / 2);
    pts.push([
      -s.hw + r + Math.cos(a) * r,
      F - r + Math.sin(a) * r,
      i < 2 ? lerpU(AT.el1, 0.75 + (i / 2) * 0.25) : AT.face[0],
    ]);
  }
  const NF = 10;
  for (let i = 1; i < NF; i++) {
    const x = -s.hw + r + (2 * (s.hw - r) * i) / NF;
    pts.push([x, F + 0.0006 * (1 - (x / s.hw) ** 2), lerpU(AT.face, i / NF)]);
  }
  for (let i = 0; i <= 2; i++) {
    const a = Math.PI / 2 - (i / 2) * (Math.PI / 2);
    pts.push([
      s.hw - r + Math.cos(a) * r,
      F - r + Math.sin(a) * r,
      i === 0 ? AT.face[1] : lerpU(AT.er, (i / 2) * 0.25),
    ]);
  }
  // Right edge (slightly convex), back-right corner.
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    pts.push([s.hw + EDGE_BULGE * Math.sin(Math.PI * t), F - r - t * (s.edge - 2 * r), lerpU(AT.er, 0.25 + t * 0.5)]);
  }
  for (let i = 0; i <= 2; i++) {
    const a = 0 - (i / 2) * (Math.PI / 2);
    pts.push([
      s.hw - r + Math.cos(a) * r,
      B + r + Math.sin(a) * r,
      i < 2 ? lerpU(AT.er, 0.75 + (i / 2) * 0.25) : AT.back[0],
    ]);
  }
  // Back: the spine, a rounded ridge from edge to edge.
  const NB = 14;
  for (let i = 1; i < NB; i++) {
    const x = s.hw - r - (2 * (s.hw - r) * i) / NB;
    const q = Math.abs(x) / Math.max(1e-4, s.hw - r);
    const ridge = Math.pow(Math.max(0, 1 - q * q), 0.85);
    pts.push([x, B - (s.depth - s.edge) * ridge, lerpU(AT.back, i / NB)]);
  }
  for (let i = 0; i <= 2; i++) {
    const a = -Math.PI / 2 - (i / 2) * (Math.PI / 2);
    pts.push([
      -s.hw + r + Math.cos(a) * r,
      B + r + Math.sin(a) * r,
      i === 0 ? AT.back[1] : lerpU(AT.el2, (i / 2) * 0.25),
    ]);
  }
  // Left edge, back half, up to the middle (the ring closes here, in the edge column).
  for (let i = 1; i <= 3; i++) {
    const t = i / 3;
    const z = B + r + t * ((F + B) / 2 - (B + r));
    pts.push([-s.hw - EDGE_BULGE * Math.sin((Math.PI / 2) * t), z, lerpU(AT.el2, 0.25 + t * 0.75)]);
  }
  return pts;
}

/** The blade's cross-section at u (fraction of the blade from the toe): half width, edge thickness, depth to the spine. */
export const batSection = (u: number): { y: number; hw: number; edge: number; depth: number } => bladeSection(u);

/** Stations along the blade (fractions from the toe): dense at the toe and through the shoulders. */
function bladeStations(): number[] {
  const out: number[] = [];
  for (let i = 0; i <= 5; i++) out.push(((TOE_R / BLADE_L) * i) / 5);
  for (let i = 1; i <= 22; i++) out.push(TOE_R / BLADE_L + ((1 - (TOE_R + SHOULDER_LEN) / BLADE_L) * i) / 22);
  for (let i = 1; i <= 10; i++) out.push(1 - SHOULDER_LEN / BLADE_L + ((SHOULDER_LEN / BLADE_L) * i) / 10);
  return out;
}

interface GeoParts {
  pos: number[];
  uv: number[];
  idx: number[];
}

function lofted(): BufferGeometry {
  const g: GeoParts = { pos: [], uv: [], idx: [] };
  const stations = bladeStations();
  const rings = stations.map((u) => ({ s: bladeSection(u), u }));
  const n = sectionOutline(rings[0].s).length;
  for (const { s, u } of rings) {
    for (const [x, z, au] of sectionOutline(s)) {
      g.pos.push(x, s.y, z);
      g.uv.push(au, u);
    }
  }
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < n - 1; i++) {
      const a = r * n + i;
      const b = a + 1;
      const c = a + n + 1;
      const d = a + n;
      g.idx.push(a, b, c, a, c, d);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(g.pos), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(g.uv), 2));
  geo.setIndex(g.idx);
  geo.computeVertexNormals();
  // The ring closes in the middle of the left edge with two copies of each point (two atlas u's): one normal.
  const nrm = geo.attributes.normal as BufferAttribute;
  for (let r = 0; r < rings.length; r++) {
    const a = r * n;
    const b = r * n + n - 1;
    const v = new Vector3(nrm.getX(a) + nrm.getX(b), nrm.getY(a) + nrm.getY(b), nrm.getZ(a) + nrm.getZ(b)).normalize();
    nrm.setXYZ(a, v.x, v.y, v.z);
    nrm.setXYZ(b, v.x, v.y, v.z);
  }
  return geo;
}

/** A flat cap over a section (the toe's end grain, the top of the shoulders), facing `dir` (±1 along y). */
function sectionCap(s: Section, dir: 1 | -1): BufferGeometry {
  const pts = sectionOutline(s);
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  let cx = 0;
  let cz = 0;
  for (const [x, z] of pts) {
    cx += x / pts.length;
    cz += z / pts.length;
  }
  pos.push(cx, s.y, cz);
  uv.push((AT.er[0] + AT.er[1]) / 2, dir < 0 ? 0.002 : 0.998);
  nor.push(0, dir, 0);
  for (const [x, z] of pts) {
    pos.push(x, s.y, z);
    // End grain: the edge column's first rows (painted as the toe's end grain and dirt).
    uv.push(AT.er[0] + (x / (BLADE_W + 0.002) + 0.5) * (AT.er[1] - AT.er[0]), dir < 0 ? 0.004 : 0.996);
    nor.push(0, dir, 0);
  }
  // The outline runs clockwise seen from above (+y): the toe cap (facing −y) keeps that order, the top reverses it.
  for (let i = 1; i < pts.length; i++) {
    if (dir < 0) idx.push(0, i + 1, i);
    else idx.push(0, i, i + 1);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  geo.setIndex(idx);
  return geo;
}

/** The handle: cane, twine binding, the rubber grip with its end cap. Radius profile by height. */
function handleRadius(y: number): number {
  if (y > -0.004) return GRIP_R * 0.98 * Math.sqrt(Math.max(0, 1 - ((y + 0.004) / 0.004) ** 2)) + 0.0001;
  if (y > -0.012) return GRIP_R + 0.0008;
  if (y > -0.262) return GRIP_R;
  if (y > -0.27) return CANE_R + (GRIP_R - CANE_R) * ((y + 0.27) / 0.008);
  return CANE_R + 0.0003;
}

function handleGeometry(): BufferGeometry {
  const ys: number[] = [];
  const y0 = BAT_SHOULDER_Y - 0.035;
  for (let y = y0; y < -0.27; y += 0.01) ys.push(y);
  for (let i = 0; i <= 4; i++) ys.push(-0.27 + i * 0.002);
  for (let i = 1; i <= 25; i++) ys.push(-0.262 + (0.25 * i) / 25);
  ys.push(-0.0115, -0.008, -0.004, -0.0025, -0.0012, -0.0003, 0);
  const R = 18;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const y of ys) {
    const r = handleRadius(y);
    for (let i = 0; i <= R; i++) {
      const a = (i / R) * Math.PI * 2;
      // Seam at the back of the handle (behind the spine).
      pos.push(Math.sin(a) * r, y, -Math.cos(a) * r);
      uv.push(AT.handle[0] + (i / R) * (AT.handle[1] - AT.handle[0]), clamp((y - BAT_SHOULDER_Y) / HANDLE_L, 0, 1));
    }
  }
  for (let j = 0; j < ys.length - 1; j++) {
    for (let i = 0; i < R; i++) {
      const a = j * (R + 1) + i;
      const b = a + 1;
      const c = a + R + 2;
      const d = a + R + 1;
      idx.push(a, d, c, a, c, b);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

let batGeoCache: BufferGeometry | null = null;

/** The bat's geometry (shared by every bat): the lofted blade, its toe and shoulder caps, the handle. */
export function batGeometry(): BufferGeometry {
  if (batGeoCache) return batGeoCache;
  const stations = bladeStations();
  const toe = sectionCap(bladeSection(stations[0]), -1);
  const top = sectionCap(bladeSection(1), 1);
  const geo = mergeGeometries([lofted(), toe, top, handleGeometry()])!;
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  batGeoCache = geo;
  return geo;
}

// ---- The bat's painted atlas: willow grain, the face mark and the spine decal, the edges, ball marks and wear,
// ---- the splice, twine and the rubber grip. Roughness in the alpha channel; a normal map from the same features.

const ATLAS_W = 512;
const ATLAS_H = 1024;
const WILLOW = '#e6cf9f';
/** Canvas x of an atlas u, and canvas y (top = v 1) of a blade fraction v. */
const ax = (u: number) => u * ATLAS_W;
const ay = (v: number) => (1 - v) * ATLAS_H;
const BLADE_COLUMNS: ReadonlyArray<readonly [number, number]> = [AT.el1, AT.face, AT.er, AT.back, AT.el2];

function grainLines(g: CanvasRenderingContext2D, seed: number, alpha: number, color: string) {
  const { r, range } = rng(seed);
  for (const [u0, u1] of BLADE_COLUMNS) {
    let x = ax(u0) + range(2, 10);
    while (x < ax(u1) - 1) {
      g.strokeStyle = color;
      g.globalAlpha = alpha * range(0.45, 1);
      g.lineWidth = range(0.7, 1.6);
      g.beginPath();
      const amp = range(0.4, 2.2);
      const wl = range(260, 700);
      const ph = r() * 6.28;
      for (let y = 0; y <= ATLAS_H; y += 8) {
        const xx = x + Math.sin((y / wl) * 6.28 + ph) * amp + Math.sin(y / 61 + ph * 3) * 0.25;
        if (y === 0) g.moveTo(xx, y);
        else g.lineTo(xx, y);
      }
      g.stroke();
      x += range(14, 26);
    }
  }
  // Fine fibres between the grains.
  for (let i = 0; i < 1600; i++) {
    const [u0, u1] = BLADE_COLUMNS[Math.floor(r() * BLADE_COLUMNS.length)];
    const x = range(ax(u0), ax(u1));
    const y = range(0, ATLAS_H);
    g.globalAlpha = alpha * range(0.15, 0.45);
    g.fillStyle = color;
    g.fillRect(x, y, range(0.5, 1), range(8, 60));
  }
  g.globalAlpha = 1;
}

/** Original marks: a VANDE chevron (two strokes meeting in a point) and the word VANDE. */
function chevron(g: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string, width: number) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(cx - size, cy - size * 0.75);
  g.lineTo(cx, cy + size * 0.75);
  g.lineTo(cx + size, cy - size * 0.75);
  g.stroke();
}

function wordmark(
  g: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  px: number,
  color: string,
  rotate = 0,
  spacing = 0.18,
) {
  g.save();
  g.translate(cx, cy);
  g.rotate(rotate);
  g.fillStyle = color;
  g.font = `800 ${px}px "Manrope Variable", Manrope, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if ('letterSpacing' in g)
    (g as unknown as { letterSpacing: string }).letterSpacing = `${(px * spacing).toFixed(1)}px`;
  g.fillText(text, 0, 0);
  g.restore();
}

function paintBatColor(g: CanvasRenderingContext2D) {
  const W = ATLAS_W;
  const H = ATLAS_H;
  // Willow: pale straw, warmer towards the edges and the toe, a soft lighter band down the middle of the face.
  g.fillStyle = WILLOW;
  g.fillRect(0, 0, W, H);
  for (const [u0, u1] of BLADE_COLUMNS) {
    const grd = g.createLinearGradient(ax(u0), 0, ax(u1), 0);
    grd.addColorStop(0, 'rgba(176,132,72,0.22)');
    grd.addColorStop(0.5, 'rgba(255,248,226,0.10)');
    grd.addColorStop(1, 'rgba(176,132,72,0.22)');
    g.fillStyle = grd;
    g.fillRect(ax(u0), 0, ax(u1) - ax(u0), H);
  }
  const lengthwise = g.createLinearGradient(0, H, 0, 0);
  lengthwise.addColorStop(0, 'rgba(120,86,48,0.30)');
  lengthwise.addColorStop(0.06, 'rgba(150,110,60,0.08)');
  lengthwise.addColorStop(0.5, 'rgba(255,250,230,0.0)');
  lengthwise.addColorStop(1, 'rgba(160,120,70,0.10)');
  g.fillStyle = lengthwise;
  g.fillRect(0, 0, ax(AT.handle[0]), H);
  grainLines(g, 11, 0.42, '#9b7642');
  // A small pin knot low on the back (character, not a defect).
  g.fillStyle = 'rgba(120,84,44,0.35)';
  g.beginPath();
  g.ellipse(ax(AT.back[0] + 0.12), ay(0.17), 2.2, 4.5, 0, 0, Math.PI * 2);
  g.fill();

  // The splice: the handle's cane runs into the blade in a V at the shoulders, face and back.
  for (const col of [AT.face, AT.back]) {
    const cx = ax((col[0] + col[1]) / 2);
    g.fillStyle = 'rgba(150,104,58,0.38)';
    g.beginPath();
    g.moveTo(cx - 17, 0);
    g.lineTo(cx, ay(0.79));
    g.lineTo(cx + 17, 0);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(92,62,32,0.55)';
    g.lineWidth = 1.2;
    g.stroke();
  }

  // Face mark near the shoulders: a quiet navy chevron and wordmark (small, low saturation: it sits near the
  // first-person view's lower corner and must never pull the eye from the ball).
  const fc = ax((AT.face[0] + AT.face[1]) / 2);
  g.globalAlpha = 0.9;
  chevron(g, fc, ay(0.86), 13, '#25306b', 4.5);
  wordmark(g, 'VANDE', fc, ay(0.815), 15, '#25306b');
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(37,48,107,0.55)';
  g.fillRect(fc - 30, ay(0.796), 60, 1.6);

  // Spine decal on the back: a navy panel down the ridge with a cyan chevron, the wordmark along the blade and a gold
  // keyline. Its edges are slightly worn.
  const bc = ax((AT.back[0] + AT.back[1]) / 2);
  const top = ay(0.8);
  const bottom = ay(0.36);
  g.fillStyle = '#1b2563';
  g.beginPath();
  g.moveTo(bc - 52, top);
  g.lineTo(bc + 52, top);
  g.lineTo(bc + 46, bottom);
  g.lineTo(bc, bottom + 26);
  g.lineTo(bc - 46, bottom);
  g.closePath();
  g.fill();
  g.strokeStyle = '#d9a63a';
  g.lineWidth = 2.2;
  g.stroke();
  chevron(g, bc, top + 34, 26, '#19c6ee', 8);
  wordmark(g, 'VANDE', bc, (top + bottom) / 2 + 26, 34, '#f2efe6', Math.PI / 2, 0.32);
  g.fillStyle = '#19c6ee';
  g.fillRect(bc - 40, bottom - 14, 80, 3);
  // Wear on the decal: small chips showing the willow.
  const wear = rng(23);
  g.fillStyle = WILLOW;
  for (let i = 0; i < 26; i++) {
    const side = wear.r() < 0.5 ? -1 : 1;
    g.globalAlpha = wear.range(0.4, 0.9);
    g.fillRect(bc + side * wear.range(40, 52), wear.range(top, bottom), wear.range(1, 3), wear.range(1, 4));
  }
  g.globalAlpha = 1;

  // Ball marks: red-brown leather (red balls) and grey (white balls), clustered round the sweet spot, some on the
  // edges and low on the face; the toe is dirty from tapping the crease.
  const marks = rng(41);
  const sweetV = SWEET_U;
  for (let i = 0; i < 30; i++) {
    const onEdge = i % 8 === 0;
    const col = onEdge ? (marks.r() < 0.5 ? AT.er : AT.el1) : AT.face;
    const cx =
      ax(col[0]) +
      (ax(col[1]) - ax(col[0])) *
        (onEdge ? marks.range(0.2, 0.8) : clamp(0.5 + (marks.r() + marks.r() - 1) * 0.36, 0.08, 0.92));
    const cy = ay(clamp(sweetV + (marks.r() + marks.r() + marks.r() - 1.5) * 0.12, 0.03, 0.6));
    const red = marks.r() < 0.55;
    g.fillStyle = red
      ? `rgba(160,52,44,${marks.range(0.08, 0.2).toFixed(2)})`
      : `rgba(128,124,116,${marks.range(0.07, 0.15).toFixed(2)})`;
    g.beginPath();
    g.ellipse(cx, cy, marks.range(2.5, 5), marks.range(3, 7), marks.range(-0.4, 0.4), 0, Math.PI * 2);
    g.fill();
  }
  const toe = g.createLinearGradient(0, H, 0, ay(0.07));
  toe.addColorStop(0, 'rgba(70,48,28,0.65)');
  toe.addColorStop(1, 'rgba(70,48,28,0)');
  g.fillStyle = toe;
  g.fillRect(0, ay(0.07), ax(AT.handle[0]), H - ay(0.07));
  // Scuffs on the edges (dents and grazes).
  const sc = rng(57);
  for (let i = 0; i < 60; i++) {
    const col = sc.pick([AT.el1, AT.er, AT.el2] as const);
    g.fillStyle = `rgba(110,80,46,${sc.range(0.12, 0.35).toFixed(2)})`;
    g.fillRect(sc.range(ax(col[0]), ax(col[1])), sc.range(ay(0.75), H), sc.range(1, 4), sc.range(1, 3));
  }

  // Handle: the cane, the twine binding and the rubber grip (a chevron ripple in navy with a cyan collar and an end
  // cap). The handle column's v runs from the shoulders (0) to the top of the handle (1).
  const hx = ax(AT.handle[0]);
  const hw = W - hx;
  const hy = (y: number) => ay((y - BAT_SHOULDER_Y) / HANDLE_L);
  g.fillStyle = '#c9a46a';
  g.fillRect(hx, hy(-0.27), hw, H - hy(-0.27));
  g.fillStyle = '#d8c39a';
  g.fillRect(hx, hy(-0.27), hw, hy(-0.296) - hy(-0.27));
  g.fillStyle = 'rgba(110,84,50,0.55)';
  for (let y = hy(-0.27); y < hy(-0.296); y += 4) g.fillRect(hx, y, hw, 1.2);
  g.fillStyle = '#26346f';
  g.fillRect(hx, 0, hw, hy(-0.262));
  for (let y = hy(-0.012); y < hy(-0.262); y += 14) {
    for (let x = 0; x < hw; x += 14) {
      g.fillStyle = 'rgba(120,140,214,0.6)';
      g.beginPath();
      g.moveTo(hx + x, y);
      g.lineTo(hx + x + 7, y + 6);
      g.lineTo(hx + x + 14, y);
      g.lineTo(hx + x + 14, y + 3);
      g.lineTo(hx + x + 7, y + 9);
      g.lineTo(hx + x, y + 3);
      g.closePath();
      g.fill();
    }
  }
  g.fillStyle = '#17b7dc';
  g.fillRect(hx, hy(-0.248), hw, hy(-0.262) - hy(-0.248));
  g.fillStyle = '#121735';
  g.fillRect(hx, 0, hw, hy(-0.012));
}

/** Roughness, stored in the colour atlas's alpha (0..1): oiled willow, glossier decals, matte rubber and twine. */
function paintBatRoughness(g: CanvasRenderingContext2D) {
  g.fillStyle = 'rgb(138,138,138)';
  g.fillRect(0, 0, ATLAS_W, ATLAS_H);
  const bc = ax((AT.back[0] + AT.back[1]) / 2);
  g.fillStyle = 'rgb(84,84,84)';
  g.fillRect(bc - 52, ay(0.8), 104, ay(0.36) - ay(0.8) + 26);
  g.fillStyle = 'rgb(168,168,168)';
  g.fillRect(0, ay(0.07), ax(AT.handle[0]), ATLAS_H - ay(0.07));
  g.fillStyle = 'rgb(205,205,205)';
  g.fillRect(ax(AT.handle[0]), 0, ATLAS_W, ATLAS_H);
}

/** Height (normal map): shallow grain grooves, ball-mark dents, the grip's ripples, the twine, the decal's edge. */
function paintBatHeight(g: CanvasRenderingContext2D) {
  g.fillStyle = 'rgb(128,128,128)';
  g.fillRect(0, 0, ATLAS_W, ATLAS_H);
  grainLines(g, 11, 0.5, 'rgb(96,96,96)');
  const marks = rng(41);
  for (let i = 0; i < 30; i++) {
    const cx =
      ax(AT.face[0]) + (ax(AT.face[1]) - ax(AT.face[0])) * clamp(0.5 + (marks.r() + marks.r() - 1) * 0.36, 0.08, 0.92);
    const cy = ay(clamp(SWEET_U + (marks.r() + marks.r() + marks.r() - 1.5) * 0.12, 0.03, 0.6));
    g.fillStyle = 'rgba(70,70,70,0.5)';
    g.beginPath();
    g.ellipse(cx, cy, 3, 4, 0, 0, Math.PI * 2);
    g.fill();
    marks.r();
    marks.r();
    marks.r();
  }
  const hx = ax(AT.handle[0]);
  const hy = (y: number) => ay((y - BAT_SHOULDER_Y) / HANDLE_L);
  for (let y = hy(-0.012); y < hy(-0.262); y += 14) {
    g.fillStyle = 'rgb(200,200,200)';
    for (let x = 0; x < ATLAS_W - hx; x += 14) {
      g.beginPath();
      g.moveTo(hx + x, y);
      g.lineTo(hx + x + 7, y + 6);
      g.lineTo(hx + x + 14, y);
      g.lineTo(hx + x + 14, y + 3);
      g.lineTo(hx + x + 7, y + 9);
      g.lineTo(hx + x, y + 3);
      g.closePath();
      g.fill();
    }
  }
  g.fillStyle = 'rgb(60,60,60)';
  for (let y = hy(-0.27); y < hy(-0.296); y += 4) g.fillRect(hx, y, ATLAS_W - hx, 1.4);
  const bc = ax((AT.back[0] + AT.back[1]) / 2);
  g.strokeStyle = 'rgb(160,160,160)';
  g.lineWidth = 2;
  g.strokeRect(bc - 52, ay(0.8), 104, ay(0.36) - ay(0.8));
}

let batMaps: { color: Texture; normal: Texture } | null = null;

function batTextures() {
  if (!batMaps) {
    batMaps = {
      color: paintTexture(ATLAS_W, ATLAS_H, paintBatColor, paintBatRoughness, { fallback: [230, 207, 159, 140] }),
      normal: paintNormalMap(ATLAS_W, ATLAS_H, paintBatHeight, 2.2, false, 0.5),
    };
  }
  return batMaps;
}

/** The bat's material: willow colour with roughness from the atlas's alpha, a normal map for grain, grip and marks. */
function createBatMaterial(): MeshStandardMaterial {
  const { color, normal } = batTextures();
  const m = new MeshStandardMaterial({
    map: color,
    normalMap: normal,
    normalScale: new Vector2(0.55, 0.55),
    roughness: 1,
    metalness: 0,
  });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\nroughnessFactor = texture2D( map, vMapUv ).a;',
    );
  };
  m.customProgramCacheKey = () => 'vande-bat-v2';
  return m;
}

/**
 * The bat, built from the physics bat (src/physics/constants.ts): a HANDLE_L handle and a BLADE_L × BLADE_W blade with
 * EDGE_T edges, a spine that is deepest a third of the way up, rounded toe corners and shoulders that curve into the
 * handle, so a drawn edge is a simulated edge. Local frame: the top of the handle at the origin, the toe at
 * y = −(HANDLE_L + BLADE_L), the face towards +z at z = BLADE_T / 2 (the physics face). One mesh, one material
 * (overlays reuse the geometry for ghost bats).
 */
export function createBat(): Mesh {
  const bat = new Mesh(batGeometry(), createBatMaterial());
  bat.castShadow = true;
  bat.name = 'bat';
  return bat;
}

const BAT_UP = new Vector3(0, -1, 0);
const tq = new Quaternion();
const tv = new Vector3();

/** Places the bat with the bottom hand at `grip` (world) and the blade along `dir`, face towards `face`. */
export function placeBat(bat: Object3D, grip: Vector3, dir: Vector3, faceHint: Vector3) {
  bat.scale.set(1, 1, 1);
  // The lower hand's centre sits LOWER_HAND_FROM_CAP below the top of the handle (the mesh origin).
  bat.position.copy(grip).addScaledVector(dir, -LOWER_HAND_FROM_CAP);
  tq.setFromUnitVectors(BAT_UP, tv.copy(dir).normalize());
  bat.quaternion.copy(tq);
  // Twist so the blade face points as close as possible to faceHint.
  const face = new Vector3(0, 0, 1).applyQuaternion(tq);
  const want = faceHint
    .clone()
    .sub(dir.clone().multiplyScalar(faceHint.dot(dir)))
    .normalize();
  if (want.lengthSq() > 0.1) {
    const ang = Math.atan2(face.clone().cross(want).dot(dir), face.dot(want));
    bat.quaternion.premultiply(new Quaternion().setFromAxisAngle(dir, ang));
  }
}

/** Top of the bat mesh's handle and its length from there to the toe (local units, see createBat). */
const BAT_TOP_Y = 0;
const BAT_MESH_LENGTH = HANDLE_L + BLADE_L;
const spanDir = new Vector3();
const spanFace = new Vector3();

/**
 * Places the bat exactly on a physics bat: the top of the handle at `grip`, the toe at `toe` (the blade stretches
 * to the physics length), the face turned towards `face` (all world).
 */
export function placeBatSpan(
  bat: Object3D,
  grip: { x: number; y: number; z: number },
  toe: { x: number; y: number; z: number },
  face: { x: number; y: number; z: number },
) {
  spanDir.set(toe.x - grip.x, toe.y - grip.y, toe.z - grip.z);
  const len = spanDir.length() || BAT_MESH_LENGTH;
  spanDir.divideScalar(len);
  const k = len / BAT_MESH_LENGTH;
  bat.scale.set(1, k, 1);
  bat.position.set(grip.x, grip.y, grip.z).addScaledVector(spanDir, BAT_TOP_Y * k);
  tq.setFromUnitVectors(BAT_UP, spanDir);
  bat.quaternion.copy(tq);
  const now = new Vector3(0, 0, 1).applyQuaternion(tq);
  spanFace.set(face.x, face.y, face.z);
  spanFace.sub(spanDir.clone().multiplyScalar(spanFace.dot(spanDir)));
  if (spanFace.lengthSq() > 1e-6) {
    spanFace.normalize();
    const ang = Math.atan2(now.clone().cross(spanFace).dot(spanDir), now.dot(spanFace));
    bat.quaternion.premultiply(new Quaternion().setFromAxisAngle(spanDir, ang));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Stumps and bails
// ---------------------------------------------------------------------------------------------------------------

/** Bails (Law 8.3): 10.95 cm overall, a 5.40 cm barrel, spigots of 3.50 cm (on the outer stump) and 2.06 cm. */
export const BAIL = Object.freeze({
  length: 0.1095,
  barrel: 0.054,
  longSpigot: 0.035,
  shortSpigot: 0.0206,
  barrelR: 0.0069,
  spigotR: 0.0045,
});
/** The groove cut across each stump's domed top, which seats the spigots. */
export const STUMP_GROOVE = Object.freeze({ depth: 0.003, halfWidth: 0.005, dome: 0.006 });
/** Height of the bails' axis when seated (spigots resting on the groove floor), and of their highest point. */
export const BAIL_AXIS_Y = STUMP_H - STUMP_GROOVE.depth + BAIL.spigotR;
export const BAIL_TOP_Y = BAIL_AXIS_Y + BAIL.barrelR;
/** Where each bail's short spigot ends: just past the middle stump's centre, so the two short spigots meet there. */
const BAIL_INNER_X = 0.0009;

/** Rest layout of one wicket in its own frame (x across, y up): stump centres and the bails' centres and directions. */
export function wicketLayout(): { stumps: number[]; bails: Array<{ x: number; y: number; dir: 1 | -1 }> } {
  return {
    stumps: [-STUMP_SPACING, 0, STUMP_SPACING],
    bails: [
      { x: -(BAIL_INNER_X + BAIL.length / 2), y: BAIL_AXIS_Y, dir: -1 },
      { x: BAIL_INNER_X + BAIL.length / 2, y: BAIL_AXIS_Y, dir: 1 },
    ],
  };
}

/** A tube of revolution with explicit v (by height), seam at the back. */
function tube(
  profile: ReadonlyArray<readonly [number, number]>,
  segments: number,
  v: (y: number) => number,
): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const [y, r] of profile) {
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pos.push(Math.sin(a) * r, y, Math.cos(a) * r);
      uv.push(i / segments, v(y));
    }
  }
  for (let j = 0; j < profile.length - 1; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * (segments + 1) + i;
      idx.push(a, a + 1, a + segments + 2, a, a + segments + 2, a + segments + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A stump: the round body and a domed top with the bail groove across it (along x). */
export function stumpGeometry(): BufferGeometry {
  const { dome, depth, halfWidth } = STUMP_GROOVE;
  const bodyTop = STUMP_H - dome;
  const v = (y: number) => clamp(y / STUMP_H, 0, 1);
  const body = tube(
    [
      [0, STUMP_R],
      [0.02, STUMP_R],
      [bodyTop - 0.002, STUMP_R],
      [bodyTop, STUMP_R * 0.985],
    ],
    24,
    v,
  );
  // The dome: rings from the rim to the top, lowered into a flat-bottomed groove across x.
  const rings = 9;
  const seg = 32;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const r = STUMP_R * 0.985 * Math.cos((t * Math.PI) / 2);
    const yDome = bodyTop + dome * Math.sin((t * Math.PI) / 2);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      const inGroove = 1 - clamp((Math.abs(z) - halfWidth * 0.8) / (halfWidth * 0.4), 0, 1);
      const y = Math.min(yDome, yDome * (1 - inGroove) + Math.min(yDome, STUMP_H - depth) * inGroove);
      pos.push(x, y, z);
      uv.push(i / seg, 0.985 + 0.015 * t);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i;
      idx.push(a, a + 1, a + seg + 2, a, a + seg + 2, a + seg + 1);
    }
  }
  const top = new BufferGeometry();
  // The crown either side of the groove stands exactly at STUMP_H (the Law's height of the stumps).
  let crown = 0;
  for (let k = 1; k < pos.length; k += 3) crown = Math.max(crown, pos[k]);
  for (let k = 1; k < pos.length; k += 3)
    pos[k] += (STUMP_H - crown) * clamp((pos[k] - bodyTop) / (crown - bodyTop), 0, 1);
  top.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  top.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  top.setIndex(idx);
  top.computeVertexNormals();
  return mergeGeometries([body, top])!;
}

/** A bail along +x (short spigot towards −x): a turned profile with collars, beads and rounded spigot ends. */
export function bailGeometry(): BufferGeometry {
  const { length: L, shortSpigot, barrel, spigotR: s, barrelR: b } = BAIL;
  const s0 = -L / 2;
  const s1 = s0 + shortSpigot;
  const b1 = s1 + barrel;
  const e = L / 2;
  const pts: Array<[number, number]> = [
    [0.0001, s0],
    [s * 0.66, s0 + 0.0008],
    [s * 0.9, s0 + 0.0025],
    [s, s0 + 0.005],
    [s, s1 - 0.003],
    [s * 1.12, s1 - 0.0014],
    [b * 0.84, s1],
    [b * 0.9, s1 + 0.002],
    [b * 0.78, s1 + 0.0045],
    [b * 0.87, s1 + 0.007],
    [b * 0.98, s1 + 0.017],
    [b, (s1 + b1) / 2],
    [b * 0.98, b1 - 0.017],
    [b * 0.87, b1 - 0.007],
    [b * 0.78, b1 - 0.0045],
    [b * 0.9, b1 - 0.002],
    [b * 0.84, b1],
    [s * 1.12, b1 + 0.0014],
    [s, b1 + 0.003],
    [s, e - 0.005],
    [s * 0.9, e - 0.0025],
    [s * 0.66, e - 0.0008],
    [0.0001, e],
  ];
  const g = new LatheGeometry(
    pts.map(([r, y]) => new Vector2(r, y)),
    14,
  );
  g.rotateZ(-Math.PI / 2);
  return g;
}

function paintWoodStump(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#f1ede2';
  g.fillRect(0, 0, w, h);
  const { r, range } = rng(71);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(150,128,96,${range(0.03, 0.09).toFixed(3)})`;
    g.fillRect(range(0, w), range(0, h), range(0.6, 1.4), range(30, 160));
  }
  const vy = (y: number) => (1 - y / STUMP_H) * h;
  // The VANDE finish: a navy band with a cyan keyline 11–15 cm below the top.
  g.fillStyle = '#1e2a78';
  g.fillRect(0, vy(STUMP_H - 0.112), w, vy(STUMP_H - 0.148) - vy(STUMP_H - 0.112));
  g.fillStyle = '#1aa9cf';
  g.fillRect(0, vy(STUMP_H - 0.153), w, vy(STUMP_H - 0.158) - vy(STUMP_H - 0.153));
  // Soil on the foot where the stump is driven into the pitch, and grey wear round the top.
  const soil = g.createLinearGradient(0, h, 0, vy(0.07));
  soil.addColorStop(0, 'rgba(96,72,44,0.75)');
  soil.addColorStop(1, 'rgba(96,72,44,0)');
  g.fillStyle = soil;
  g.fillRect(0, vy(0.07), w, h - vy(0.07));
  g.fillStyle = 'rgba(120,112,100,0.25)';
  g.fillRect(0, 0, w, vy(STUMP_H - 0.01));
  void r;
}

function paintLedStump(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#25282f';
  g.fillRect(0, 0, w, h);
  const vy = (y: number) => (1 - y / STUMP_H) * h;
  g.fillStyle = '#4a4f5a';
  g.fillRect(w * 0.43, vy(0.62), w * 0.14, vy(0.1) - vy(0.62));
  g.fillRect(0, 0, w, vy(STUMP_H - 0.04));
  g.fillStyle = '#d7dbe3';
  g.fillRect(w * 0.47, vy(0.36), w * 0.06, 6);
}

function paintLedStumpGlow(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#000000';
  g.fillRect(0, 0, w, h);
  const vy = (y: number) => (1 - y / STUMP_H) * h;
  g.fillStyle = '#ffffff';
  g.fillRect(w * 0.44, vy(0.615), w * 0.12, vy(0.105) - vy(0.615));
  g.fillRect(0, 0, w, vy(STUMP_H - 0.038));
}

export interface StumpsFx {
  group: Group;
  /** Original optional LED assets; current Practice always uses the wooden wicket. */
  readonly ledMeshes: readonly InstancedMesh[];
  update(script: BallScript | null, t: number): void;
  /**
   * The illuminated wicket (an original LED variant: graphite stumps with light windows, red bails that flash when
   * dislodged) or the painted wooden one. Both are built (and compiled) at creation; this only swaps visibility.
   */
  setLed(on: boolean): void;
  dispose(): void;
}

const G = 9.81;
/** The two wickets; `facing` turns each so its front (the LED windows) looks down the pitch. */
const ENDS = [
  { z: PITCH_HALF, key: 'striker' as const, facing: 0 },
  { z: -PITCH_HALF, key: 'nonStriker' as const, facing: Math.PI },
];

interface BailFlight {
  p0: Vector3;
  v0: Vector3;
  axis: Vector3;
  spin: number;
  yaw0: number;
  rest: Quaternion;
  t1: number;
  t2: number;
  t3: number;
  p1: Vector3;
  p2: Vector3;
  vh2: Vector3;
  vy2: number;
  vh3: Vector3;
}

const UP = new Vector3(0, 1, 0);
const BAIL_REST_Y = BAIL.barrelR;
const BAIL_LAND_Y = BAIL.barrelR + 0.012;

/** A bail's closed-form flight once dislodged: ballistic, one low bounce, a short slide to rest lying flat. */
function bailFlight(p0: Vector3, yaw0: number, dir: Vector3, strength: number, rand: () => number): BailFlight {
  const k = clamp(strength, 0.2, 1.3);
  const side = new Vector3(-dir.z, 0, dir.x);
  const v0 = dir
    .clone()
    .multiplyScalar((1.1 + 2.4 * k) * (0.7 + 0.6 * rand()))
    .addScaledVector(side, (rand() - 0.5) * 1.8)
    .addScaledVector(UP, (1.7 + 1.9 * k) * (0.75 + 0.5 * rand()));
  const axis = new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
  const spin = (12 + 20 * rand()) * (0.6 + 0.4 * k);
  const h = p0.y - BAIL_LAND_Y;
  const t1 = (v0.y + Math.sqrt(v0.y * v0.y + 2 * G * h)) / G;
  const p1 = p0.clone().addScaledVector(v0, t1);
  p1.y = BAIL_LAND_Y;
  const vy1 = v0.y - G * t1;
  const vy2 = -vy1 * 0.3;
  const vh2 = new Vector3(v0.x, 0, v0.z).multiplyScalar(0.45);
  const t2 = t1 + (2 * vy2) / G;
  const p2 = p1.clone().addScaledVector(vh2, t2 - t1);
  p2.y = BAIL_REST_Y;
  const vh3 = vh2.clone().multiplyScalar(0.5);
  const t3 = t2 + vh3.length() / 3.5;
  const yawRest = yaw0 + (rand() - 0.5) * 2.4;
  const rest = new Quaternion().setFromAxisAngle(UP, yawRest);
  return { p0, v0, axis, spin, yaw0, rest, t1, t2, t3, p1, p2, vh2, vy2, vh3 };
}

const fq = new Quaternion();
const fq2 = new Quaternion();

/** Position and orientation of a dislodged bail `s` seconds after the hit. */
function bailAt(f: BailFlight, s: number, outP: Vector3, outQ: Quaternion) {
  const base = fq2.setFromAxisAngle(UP, f.yaw0);
  if (s <= f.t1) {
    outP.copy(f.p0).addScaledVector(f.v0, s);
    outP.y = f.p0.y + f.v0.y * s - 0.5 * G * s * s;
    outQ.setFromAxisAngle(f.axis, f.spin * s).multiply(base);
    return;
  }
  const flightQ = fq.setFromAxisAngle(f.axis, f.spin * f.t1).multiply(base);
  if (s <= f.t2) {
    const u = s - f.t1;
    outP.copy(f.p1).addScaledVector(f.vh2, u);
    outP.y = BAIL_LAND_Y + f.vy2 * u - 0.5 * G * u * u + (BAIL_REST_Y - BAIL_LAND_Y) * (u / (f.t2 - f.t1));
    outQ.copy(flightQ).slerp(f.rest, easeOut(u / Math.max(1e-3, f.t2 - f.t1)));
    return;
  }
  const u = Math.min(s, f.t3) - f.t2;
  const T = Math.max(1e-3, f.t3 - f.t2);
  outP.copy(f.p2).addScaledVector(f.vh3, u - (u * u) / (2 * T));
  outP.y = BAIL_REST_Y;
  outQ.copy(f.rest);
}

function stumpsMaterialWood(): MeshStandardMaterial {
  const map = paintTexture(64, 512, paintWoodStump, null, { fallback: [241, 237, 226, 255] });
  return new MeshStandardMaterial({ map, roughness: 0.42, metalness: 0 });
}

export function createStumps(): StumpsFx {
  const group = new Group();
  group.name = 'wickets';
  const stumpGeo = stumpGeometry();
  const bailGeo = bailGeometry();
  const woodMat = stumpsMaterialWood();
  const woodBailMat = new MeshStandardMaterial({ color: '#d4ac72', roughness: 0.32, metalness: 0 });
  const woodStumps = new InstancedMesh(stumpGeo, woodMat, 6);
  const woodBails = new InstancedMesh(bailGeo, woodBailMat, 4);
  woodStumps.castShadow = woodBails.castShadow = true;
  // LED: one mesh per end, so only the broken wicket lights up.
  const ledMap = paintTexture(64, 512, paintLedStump, null, { fallback: [37, 40, 47, 255] });
  const ledGlow = paintTexture(64, 512, paintLedStumpGlow, null, { fallback: [0, 0, 0, 255] });
  const ledEnds = ENDS.map(() => {
    const stumpMat = new MeshStandardMaterial({
      map: ledMap,
      emissiveMap: ledGlow,
      emissive: '#ff3324',
      emissiveIntensity: 0,
      roughness: 0.38,
      metalness: 0.1,
    });
    const bailMat = new MeshStandardMaterial({
      color: '#7a1712',
      emissive: '#ff2414',
      emissiveIntensity: 0.05,
      roughness: 0.22,
      metalness: 0,
    });
    const stumps = new InstancedMesh(stumpGeo, stumpMat, 3);
    const bails = new InstancedMesh(bailGeo, bailMat, 2);
    stumps.castShadow = bails.castShadow = true;
    stumps.visible = bails.visible = false;
    group.add(stumps, bails);
    return { stumps, bails, stumpMat, bailMat };
  });
  group.add(woodStumps, woodBails);
  let led = false;

  const o = new Object3D();
  const layout = wicketLayout();
  const pos = new Vector3();
  const quat = new Quaternion();
  const one = new Vector3(1, 1, 1);
  const mat = new Matrix4();
  const dir = new Vector3();
  const axis = new Vector3();
  const flights = new Map<string, BailFlight[]>();

  /** The stump the ball hit (nearest to the stumps event), else the middle one. */
  const hitStump = (script: BallScript, endZ: number, t: number): number => {
    let best: SceneEvent | null = null;
    for (const e of script.events)
      if (
        e.kind === 'stumps' &&
        e.at &&
        Math.abs(e.at.z - endZ) < 2 &&
        (!best || Math.abs(e.t - t) < Math.abs(best.t - t))
      )
        best = e;
    if (!best?.at) return 1;
    const x = best.at.x;
    return x < -STUMP_SPACING / 2 ? 0 : x > STUMP_SPACING / 2 ? 2 : 1;
  };

  const update = (script: BallScript | null, t: number) => {
    ENDS.forEach((end, e) => {
      const hit = script ? script.stumps[end.key] : null;
      const dt = hit ? t - hit.t : -1;
      const broken = Boolean(hit && dt >= 0);
      const s = Math.max(0, dt) / 1000;
      const k = hit ? clamp(hit.strength, 0, 1.3) : 0;
      if (hit) dir.set(hit.dir.x, 0, hit.dir.z);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, end.z > 0 ? 1 : -1);
      dir.normalize();
      axis.set(dir.z, 0, -dir.x);
      const h = broken && script ? hitStump(script, end.z, hit!.t) : 1;
      for (let i = 0; i < 3; i++) {
        o.position.set(layout.stumps[i], 0, end.z);
        o.quaternion.setFromAxisAngle(UP, end.facing);
        if (broken) {
          if (i === h) {
            // The struck stump is knocked back about its foot (and uprooted by a fast ball).
            const tilt = ((k > 0.6 ? 40 + 42 * Math.min(1, k) : 8 + 40 * k) * Math.PI) / 180;
            const th = tilt * (1 - Math.exp(-s / 0.065)) + tilt * 0.08 * Math.exp(-s / 0.14) * Math.sin(s * 38);
            const slide = (k > 0.6 ? 0.06 + 0.22 * Math.min(1, k) : 0.02 * k) * (1 - Math.exp(-s / 0.09));
            o.position.addScaledVector(dir, slide);
            o.quaternion.premultiply(fq.setFromAxisAngle(axis, th));
          } else {
            // Its neighbours shudder (a damped flex) and keep a slight lean.
            const near = 1 / (1 + Math.abs(i - h));
            const amp = ((3 + 7 * k) * near * Math.PI) / 180;
            const th =
              amp * Math.exp(-s / 0.2) * Math.sin(2 * Math.PI * 6.5 * s) +
              (((1.5 + 3 * k) * near * Math.PI) / 180) * (1 - Math.exp(-s / 0.08));
            o.quaternion.premultiply(fq.setFromAxisAngle(axis, th));
          }
        }
        o.updateMatrix();
        woodStumps.setMatrixAt(e * 3 + i, o.matrix);
        ledEnds[e].stumps.setMatrixAt(i, o.matrix);
      }
      const key = `${e}|${hit ? Math.round(hit.t) : -1}|${hit ? hit.strength.toFixed(3) : ''}|${dir.x.toFixed(3)},${dir.z.toFixed(3)}`;
      let fl = flights.get(key);
      if (broken && !fl) {
        const rand = seededStream(e * 97 + 13 + Math.round(hit!.t));
        fl = layout.bails.map((b) => {
          const yaw = end.facing + (b.dir < 0 ? Math.PI : 0);
          const p0 = new Vector3(b.x, b.y, 0).applyAxisAngle(UP, end.facing).add(new Vector3(0, 0, end.z));
          return bailFlight(p0, yaw, dir.clone(), k, rand);
        });
        if (flights.size > 8) flights.clear();
        flights.set(key, fl);
      }
      for (let j = 0; j < 2; j++) {
        const b = layout.bails[j];
        if (broken && fl) bailAt(fl[j], s, pos, quat);
        else {
          pos.set(b.x, b.y, 0).applyAxisAngle(UP, end.facing);
          pos.z += end.z;
          quat.setFromAxisAngle(UP, end.facing + (b.dir < 0 ? Math.PI : 0));
        }
        mat.compose(pos, quat, one);
        woodBails.setMatrixAt(e * 2 + j, mat);
        ledEnds[e].bails.setMatrixAt(j, mat);
      }
      // LED: a few calm pulses once the wicket is broken (about a second), then a steady glow that fades.
      const glow = broken
        ? (0.55 + 0.45 * Math.cos(2 * Math.PI * 3 * s) ** 2) * (1 - 0.7 * clamp((s - 0.9) / 0.6, 0, 1))
        : 0;
      ledEnds[e].stumpMat.emissiveIntensity = glow * 2.2;
      ledEnds[e].bailMat.emissiveIntensity = broken ? 0.4 + glow * 2.6 : 0.05;
      ledEnds[e].stumps.instanceMatrix.needsUpdate = true;
      ledEnds[e].bails.instanceMatrix.needsUpdate = true;
    });
    woodStumps.instanceMatrix.needsUpdate = true;
    woodBails.instanceMatrix.needsUpdate = true;
  };
  update(null, 0);
  return {
    group,
    ledMeshes: ledEnds.flatMap(({ stumps, bails }) => [stumps, bails]),
    update,
    setLed(on) {
      led = on;
      woodStumps.visible = woodBails.visible = !led;
      for (const l of ledEnds) l.stumps.visible = l.bails.visible = led;
    },
    dispose() {
      stumpGeo.dispose();
      bailGeo.dispose();
      woodMat.dispose();
      woodBailMat.dispose();
      for (const l of ledEnds) {
        l.stumpMat.dispose();
        l.bailMat.dispose();
      }
      ledMap.dispose();
      ledGlow.dispose();
      woodMat.map?.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Event effects: bounce mark (the match's ring, Practice's pitch scuff), impact flash, sparks, catch ring, boundary
// celebrations. Practice draws nothing near the ball during a delivery: no bat sparks, no pad puff, no bounce dust.
// ---------------------------------------------------------------------------------------------------------------

export interface EventFx {
  group: Group;
  /** Match-only bounce ring/contact flash; Practice keeps scuff, catch/seal and particles. */
  readonly matchOnlyMeshes: readonly Mesh[];
  update(script: BallScript | null, t: number, camPos: Vector3, particleScale: number, reducedMotion: boolean): void;
  /**
   * How the pitch of the ball shows in the match: the growing ring, or a brief low dust puff. In Practice
   * (setPractice) neither: the ball leaves a small scuff on the pitch where it landed (a decal, from the bounce on).
   */
  setBounceMark(mark: 'ring' | 'dust'): void;
  /**
   * Practice: no particles near the ball (no bat sparks, pad puff or bounce dust: live-delivery discipline); the
   * bounce leaves a scuff mark; the stumps, catch and boundary responses stay restrained and start only from their
   * confirming event.
   */
  setPractice(on: boolean): void;
  dispose(): void;
}

const MAX_PARTICLES = 900;
/** The Practice scuff: about the size of the ball's skid on the surface. */
export const SCUFF_SIZE = Object.freeze({ width: 0.075, length: 0.15 });

function paintScuff(g: CanvasRenderingContext2D, w: number, h: number) {
  g.clearRect(0, 0, w, h);
  const { range } = rng(91);
  // A darker, compressed oval where the ball skidded, feathered at the edges.
  const grd = g.createRadialGradient(w / 2, h * 0.55, 2, w / 2, h * 0.55, w * 0.5);
  grd.addColorStop(0, 'rgba(70,50,30,0.55)');
  grd.addColorStop(0.55, 'rgba(78,56,34,0.32)');
  grd.addColorStop(1, 'rgba(80,58,36,0)');
  g.save();
  g.translate(w / 2, h * 0.55);
  g.scale(1, (h / w) * 0.82);
  g.translate(-w / 2, -h * 0.55);
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.restore();
  // Scratches along the direction of travel: lighter soil turned up, a few darker grooves.
  for (let i = 0; i < 16; i++) {
    const x = w / 2 + range(-0.3, 0.3) * w;
    const y0 = h * range(0.18, 0.45);
    g.strokeStyle =
      i % 3 === 0
        ? `rgba(60,42,24,${range(0.25, 0.45).toFixed(2)})`
        : `rgba(236,218,184,${range(0.18, 0.4).toFixed(2)})`;
    g.lineWidth = range(0.8, 1.8);
    g.beginPath();
    g.moveTo(x, y0);
    g.lineTo(x + range(-2, 2), y0 + h * range(0.25, 0.5));
    g.stroke();
  }
}

export function createEventFx(glowTex: Texture): EventFx {
  const group = new Group();
  group.name = 'event-fx';
  const bounce = new Mesh(
    new RingGeometry(0.05, 0.11, 24),
    new MeshBasicMaterial({
      color: '#52e2ff',
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    }),
  );
  bounce.rotation.x = -Math.PI / 2;
  const flash = new Mesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({
      map: glowTex,
      color: '#ffffff',
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    }),
  );
  const seal = new Mesh(
    new RingGeometry(0.8, 1, 48),
    new MeshBasicMaterial({
      color: '#52e2ff',
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      fog: false,
    }),
  );
  // The scuff: lit like the pitch, drawn just above it without writing depth.
  const scuffTex = paintTexture(64, 128, paintScuff, null, { fallback: [80, 58, 36, 0] });
  const scuffGeo = new PlaneGeometry(1, 1);
  scuffGeo.rotateX(-Math.PI / 2);
  const scuffMat = new MeshLambertMaterial({
    map: scuffTex,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const scuff = new Mesh(scuffGeo, scuffMat);
  scuff.renderOrder = 1;
  scuff.visible = false;
  const partGeo = new PlaneGeometry(1, 1);
  const partMat = new MeshBasicMaterial({
    map: glowTex,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexColors: false,
    fog: false,
  });
  const parts = new InstancedMesh(partGeo, partMat, MAX_PARTICLES);
  parts.instanceMatrix.setUsage(DynamicDrawUsage);
  parts.frustumCulled = false;
  const colorAttr = new Float32Array(MAX_PARTICLES * 3);
  parts.instanceColor = new InstancedBufferAttribute(colorAttr, 3);
  parts.instanceColor.setUsage(DynamicDrawUsage);
  group.add(bounce, flash, seal, scuff, parts);
  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3();
  const p = new Vector3();
  const c = new Color();
  const look = new Matrix4();
  const up = new Vector3(0, 1, 0);
  const AMBER = new Color('#ffb347');
  const CYAN = new Color('#52e2ff');
  const WHITE = new Color('#ffffff');
  const PINK = new Color('#ff5d8f');
  const GREY = new Color('#9aa3b5');
  const GOLD = new Color('#ffcf5a');
  const SEAL = new Color('#52e2ff');
  const DUST = new Color('#d9c29a');
  const SPLINTER = new Color('#e9dcc0');

  const emitBurst = (
    e: SceneEvent,
    dt: number,
    n: number,
    spread: number,
    life: number,
    colors: Color[],
    gravity: number,
    size: number,
    start: number,
    seed: number,
  ): number => {
    const rand = seededStream(seed);
    let k = start;
    for (let i = 0; i < n && k < MAX_PARTICLES; i++) {
      const u = rand() * Math.PI * 2;
      const v = Math.acos(2 * rand() - 1);
      const speed = spread * (0.45 + rand() * 0.55);
      const lifeI = life * (0.7 + rand() * 0.3);
      if (dt > lifeI) continue;
      const tt = dt / 1000;
      const at = e.at ?? { x: 0, y: 1, z: 0 };
      p.set(
        at.x + Math.sin(v) * Math.cos(u) * speed * tt,
        at.y + Math.cos(v) * speed * tt - 0.5 * gravity * tt * tt,
        at.z + Math.sin(v) * Math.sin(u) * speed * tt,
      );
      const fade = 1 - dt / lifeI;
      s.setScalar(size * (0.6 + fade * 0.6));
      q.setFromRotationMatrix(look);
      m.compose(p, q, s);
      parts.setMatrixAt(k, m);
      c.copy(colors[i % colors.length]).multiplyScalar(fade);
      colorAttr.set([c.r, c.g, c.b], k * 3);
      k++;
    }
    return k;
  };

  const dirA = new Vector3();
  /** Places the scuff at a bounce, along the ball's ground track through it. */
  const placeScuff = (script: BallScript, e: SceneEvent, dt: number) => {
    const at = e.at!;
    const before = sampleBall(script, e.t - 18).pos;
    const after = sampleBall(script, e.t + 18).pos;
    dirA.set(after.x - before.x, 0, after.z - before.z);
    if (dirA.lengthSq() < 1e-8) dirA.set(0, 0, 1);
    scuff.visible = true;
    scuff.position.set(at.x, 0.004, at.z);
    scuff.rotation.set(0, Math.atan2(dirA.x, dirA.z), 0);
    scuff.scale.set(SCUFF_SIZE.width, 1, SCUFF_SIZE.length);
    scuffMat.opacity = clamp(dt / 40, 0, 1) * 0.9;
  };

  let bounceMark: 'ring' | 'dust' = 'ring';
  let practice = false;
  return {
    group,
    matchOnlyMeshes: [bounce, flash],
    setBounceMark(mark) {
      bounceMark = mark;
    },
    setPractice(on) {
      practice = on;
    },
    update(script, t, camPos, particleScale, reducedMotion) {
      bounce.visible = false;
      flash.visible = false;
      seal.visible = false;
      scuff.visible = false;
      let k = 0;
      look.lookAt(camPos, new Vector3(0, 0, 0), up);
      if (script) {
        for (let ei = 0; ei < script.events.length; ei++) {
          const e = script.events[ei];
          const dt = t - e.t;
          if (dt < 0) continue;
          if (practice) {
            // Live-delivery discipline: nothing near the ball, only the scuff the bounce leaves on the pitch.
            if (e.kind === 'bounce' && e.at) placeScuff(script, e, dt);
            if (
              e.kind === 'bounce' ||
              e.kind === 'bat' ||
              e.kind === 'edge' ||
              e.kind === 'pad' ||
              e.kind === 'fireworks' ||
              e.kind === 'seal'
            )
              continue;
            if (e.kind === 'stumps' && dt < 700) {
              // The broken wicket: a little dust and a few splinters at its foot (the bails and LEDs do the rest).
              const foot = { ...e, at: e.at ? { x: e.at.x, y: 0.12, z: e.at.z } : { x: 0, y: 0.12, z: PITCH_HALF } };
              k = emitBurst(
                foot,
                dt,
                Math.round(10 * particleScale) + 4,
                1.1,
                650,
                [DUST, SPLINTER],
                5,
                0.045,
                k,
                ei * 31 + 11,
              );
              continue;
            }
            if (e.kind === 'catch' && dt < 600 && e.at) {
              seal.visible = true;
              seal.position.set(e.at.x, e.at.y, e.at.z);
              seal.quaternion.setFromRotationMatrix(new Matrix4().lookAt(camPos, seal.position, up));
              const u = dt / 600;
              seal.scale.setScalar(0.08 + easeOut(u) * 0.6);
              (seal.material as MeshBasicMaterial).color.copy(GOLD);
              (seal.material as MeshBasicMaterial).opacity = (1 - u) * 0.55;
              continue;
            }
            if (e.kind === 'six' && dt < 1100 && !reducedMotion) {
              k = emitBurst(e, dt, Math.round(18 * particleScale), 4.5, 1000, [AMBER, WHITE], 3, 0.3, k, ei * 31 + 3);
            }
            continue;
          }
          if (e.kind === 'bounce' && bounceMark === 'dust' && dt < 260 && e.at) {
            k = emitBurst(
              { ...e, at: { x: e.at.x, y: 0.03, z: e.at.z } },
              dt,
              7,
              0.9,
              260,
              [DUST],
              6,
              0.035,
              k,
              ei * 31 + 37,
            );
          } else if (e.kind === 'bounce' && bounceMark === 'ring' && dt < 650 && e.at) {
            bounce.visible = true;
            bounce.position.set(e.at.x, 0.03, e.at.z);
            const u = dt / 650;
            bounce.scale.setScalar(1 + u * 2.6);
            (bounce.material as MeshBasicMaterial).opacity = (1 - u) * 0.9;
          } else if ((e.kind === 'bat' || e.kind === 'edge') && dt < 220 && e.at) {
            flash.visible = true;
            flash.position.set(e.at.x, e.at.y, e.at.z);
            flash.quaternion.setFromRotationMatrix(new Matrix4().lookAt(camPos, flash.position, up));
            const u = dt / 220;
            flash.scale.setScalar((0.5 + u * 1.4) * (e.kind === 'bat' ? 1 : 0.6) * (0.6 + e.intensity * 0.6));
            (flash.material as MeshBasicMaterial).opacity = (1 - u) * 0.9;
            if (!reducedMotion)
              k = emitBurst(
                e,
                dt,
                Math.round(26 * particleScale * e.intensity),
                4.5,
                420,
                [WHITE, CYAN],
                6,
                0.06,
                k,
                ei * 31 + 7,
              );
          } else if (e.kind === 'pad' && dt < 420 && e.at) {
            // A dull, low puff off the pad: grey-white, few and slow (nothing like the bat's bright crack).
            k = emitBurst(e, dt, Math.round(10 * particleScale) + 3, 1.2, 400, [GREY, WHITE], 2, 0.05, k, ei * 31 + 23);
          } else if (e.kind === 'catch' && dt < 700 && e.at) {
            // The catch: a gold ring opening at the hands.
            seal.visible = true;
            seal.position.set(e.at.x, e.at.y, e.at.z);
            seal.quaternion.setFromRotationMatrix(new Matrix4().lookAt(camPos, seal.position, up));
            const u = dt / 700;
            seal.scale.setScalar(0.08 + easeOut(u) * 0.9);
            (seal.material as MeshBasicMaterial).color.copy(GOLD);
            (seal.material as MeshBasicMaterial).opacity = (1 - u) * 0.9;
            if (!reducedMotion)
              k = emitBurst(e, dt, Math.round(18 * particleScale), 2.4, 600, [GOLD, WHITE], 3, 0.06, k, ei * 31 + 29);
          } else if ((e.kind === 'stumps' || e.kind === 'bails') && dt < 900 && !reducedMotion) {
            k = emitBurst(e, dt, Math.round(30 * particleScale), 3.2, 800, [AMBER, WHITE], 4, 0.07, k, ei * 31 + 11);
          } else if (e.kind === 'six' && dt < 1400 && !reducedMotion) {
            k = emitBurst(
              e,
              dt,
              Math.round(60 * particleScale),
              6,
              1300,
              [AMBER, CYAN, WHITE],
              3,
              0.35,
              k,
              ei * 31 + 3,
            );
          } else if (e.kind === 'fireworks' && dt < 2600) {
            for (let b = 0; b < 3; b++) {
              const bt = dt - b * 380;
              if (bt < 0) continue;
              const at = e.at ?? { x: 0, y: 30, z: 0 };
              const burst: SceneEvent = {
                ...e,
                at: { x: at.x + (b - 1) * 18, y: Math.max(26, at.y + 14 + b * 6), z: at.z + (b - 1) * 9 },
              };
              k = emitBurst(
                burst,
                bt,
                Math.round((reducedMotion ? 30 : 90) * particleScale),
                16,
                1800,
                b % 2 ? [AMBER, WHITE] : [CYAN, PINK],
                4,
                reducedMotion ? 0.7 : 1.1,
                k,
                ei * 31 + b * 5 + 19,
              );
            }
          } else if (e.kind === 'seal' && dt < 900) {
            const pos = sampleBall(script, e.t - 1).pos;
            seal.visible = true;
            (seal.material as MeshBasicMaterial).color.copy(SEAL);
            seal.position.set(pos.x, pos.y, pos.z);
            seal.quaternion.setFromRotationMatrix(new Matrix4().lookAt(camPos, seal.position, up));
            const u = dt / 900;
            seal.scale.setScalar(0.05 + easeOut(u) * 0.55);
            (seal.material as MeshBasicMaterial).opacity = (1 - u) * 0.95;
          }
        }
      }
      parts.count = k;
      parts.instanceMatrix.needsUpdate = true;
      if (parts.instanceColor) parts.instanceColor.needsUpdate = true;
    },
    dispose() {
      for (const mesh of [bounce, flash, seal]) {
        mesh.geometry.dispose();
        (mesh.material as MeshBasicMaterial).dispose();
      }
      scuffGeo.dispose();
      scuffMat.dispose();
      scuffTex.dispose();
      partGeo.dispose();
      partMat.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Blob shadows: one soft shadow per light source and player. Under lights the sources are the floodlight towers
// (the night-cricket look); by day the stadium passes the sun alone, and the shadow's length follows its elevation.
// ---------------------------------------------------------------------------------------------------------------

export interface BlobShadows {
  mesh: InstancedMesh;
  begin(): void;
  /** Adds the shadows of a player at (x, z): one per source (towers or the sun), at most `perPlayer`. */
  add(x: number, z: number, sources: readonly Vector3[], perPlayer: number, size: number): void;
  end(): void;
  dispose(): void;
}

/** Length of a blob shadow (in body widths) for a light at elevation `el` (radians): long for a low sun. */
export function blobLength(el: number, perPlayer: number): number {
  const k = 1 / Math.tan(clamp(el, 0.12, 1.45));
  return clamp(0.7 + k * 0.55, 1.05, perPlayer > 2 ? 2.4 : 3.6);
}

export function createBlobShadows(shadowTex: Texture, max = 128): BlobShadows {
  const geo = new PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, 0.5);
  const mat = new MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    depthWrite: false,
    color: '#000000',
    opacity: 0.42,
    fog: false,
  });
  const mesh = new InstancedMesh(geo, mat, max);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  let k = 0;
  const o = new Object3D();
  return {
    mesh,
    begin() {
      k = 0;
    },
    add(x, z, sources, perPlayer, size) {
      const n = Math.min(perPlayer, sources.length);
      for (let i = 0; i < n && k < max; i++) {
        const src = sources[i];
        const ang = Math.atan2(x - src.x, z - src.z);
        const el = Math.atan2(src.y, Math.hypot(x - src.x, z - src.z));
        o.position.set(x, 0.025 + k * 0.0004, z);
        o.rotation.set(0, ang, 0);
        o.scale.set(size * 0.75, 1, size * blobLength(el, perPlayer));
        o.updateMatrix();
        mesh.setMatrixAt(k++, o.matrix);
      }
      // One source (the sun) casts one darker shadow; many towers several fainter ones.
      mat.opacity = sources.length === 1 ? 0.5 : 0.42;
    },
    end() {
      mesh.count = k;
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
