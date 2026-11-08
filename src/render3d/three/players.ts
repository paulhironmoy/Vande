/**
 * Procedural players: one skinned mesh per player (single draw call), built in code (original work, no external
 * assets). A sculpted head (jaw, brow, eye sockets, nose, ears) with painted eyes, brows and lips that blink on the
 * stadium clock; hair styles with volume and facial hair; kits with collar, placket, side panels, stitching and a
 * fabric weave; batting gloves with finger rolls, pads with vertical rolls, knee roll and straps, spiked shoes; a
 * batting helmet with a shell, peak, ear guards, neck guard, a real-spaced metal grille and chin strap; keeper gloves
 * and pads; caps, sun hats and the umpires' hats. Variants (hair styles, beards, headgear) live in one geometry per
 * gear and LOD and are switched per player by uniforms (an unused variant collapses to a point), so every player of
 * a gear shares one geometry and one shader. Two LODs per gear.
 */
import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  Group,
  LOD,
  Matrix4,
  MeshDepthMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  RGBADepthPacking,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  BoxGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  type Material,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { KitSpec } from '@/contracts';
import { BONE_INDEX, BONE_NAMES, SKELETON, type BoneName } from '../core/skeleton';
import { HINGE_RANGE } from '../core/locomotion';
import { CARRY_BAT_KEY, type SampledPose } from '../core/clips';
import type { Look } from '../core/actors';
import { hash32 } from '../core/math';
import { avatarTraits } from '@/ui/avatar/traits';
import { LOWER_HAND_FROM_CAP, TOP_HAND_FROM_CAP } from '@/physics/constants';
import { placeBat, placeBatSpan } from './props';
import { FRAME } from '../core/motion/director/stage/face';
import { HEAD as DIRECTOR_HEAD, eyesFor, noteDrawn, turnHead } from '../core/motion/director/stage/pose';

/** The stadium clock (ms) for the players' small idle details (blinks); the stadium sets it every frame. */
export const PLAYER_CLOCK = { value: 0 };

// Region ids painted by the shader.
const R = {
  skin: 0,
  shirt: 1,
  trousers: 2,
  shoes: 3,
  pads: 4,
  gloves: 5,
  helmet: 6,
  grille: 7,
  cap: 8,
  hat: 9,
  sole: 10,
  hair: 11,
  keeperGloves: 12,
  strap: 13,
  padding: 14,
  spikes: 15,
  collar: 16,
} as const;
type Region = (typeof R)[keyof typeof R];

/** Variant groups (aVar = group × 10 + option): hair styles, the full-beard mesh, headgear. 0 = always drawn. */
const HAIR_STYLES = ['crop', 'wavy', 'curly', 'side_part', 'tied', 'shaved'] as const;
const V_HAIR = 10;
const V_BEARD = 20;
const V_HEAD = 30;
/** Headgear options per gear: keeper 0 helmet / 1 cap; fielder 0 cap / 1 sun hat / 2 none / 3 patka. */
export type Headgear = 'helmet' | 'cap' | 'sunhat' | 'none' | 'patka';
const HEADGEAR_OPTION: Record<Gear, Partial<Record<Headgear, number>>> = {
  batter: { helmet: 0 },
  keeper: { helmet: 0, cap: 1 },
  fielder: { cap: 0, sunhat: 1, none: 2, patka: 3 },
  bowler: { none: 0 },
  umpire: { sunhat: 0 },
};

export type Gear = Look['gear'];

const restWorld = new Map<BoneName, Vector3>();
{
  const acc = new Map<BoneName, Vector3>();
  for (const b of SKELETON) {
    const p = b.parent ? acc.get(b.parent)!.clone() : new Vector3();
    p.add(new Vector3(...b.offset));
    acc.set(b.name, p);
    restWorld.set(b.name, p);
  }
}
const W = (b: BoneName) => restWorld.get(b)!.clone();

/** The head's volume (bind pose): centre and half-extents. Eyes on its vertical middle, the face towards +z. */
export const HEAD = Object.freeze({ c: new Vector3(0, 1.705, 0.014), rx: 0.077, ry: 0.118, rz: 0.098 });
const EYE_Y = HEAD.c.y + 0.002;
const g3v = (v: Vector3) => `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;
const EYE_X = 0.033;

interface Part {
  geo: BufferGeometry;
  /** Skin to `bone`, optionally blending towards `blendBone` near the segment start (`a`) for smooth joints. */
  bone: BoneName;
  blend?: { bone: BoneName; a: Vector3; b: Vector3; range: number };
  blendEnd?: { bone: BoneName; range: number };
  region: Region | ((p: Vector3) => Region);
  /** Variant id (see V_HAIR, V_BEARD, V_HEAD), 0 for always. */
  variant?: number;
  /** For hair and beard shells: the skull points they grow from (collapsed onto under headgear). */
  base?: Float32Array;
}

/** Every part indexed (shared vertices are skinned once: far less vertex work than a triangle soup). */
function prep(geo: BufferGeometry): BufferGeometry {
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  if (!geo.attributes.normal) geo.computeVertexNormals();
  return geo.index ? geo : mergeVertices(geo, 1e-5);
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const gauss2 = (a: number, b: number, sa: number, sb: number) => Math.exp(-((a / sa) ** 2) - (b / sb) ** 2);

function segment(a: Vector3, b: Vector3, r0: number, r1: number, radial: number, rings: number): BufferGeometry {
  const len = a.distanceTo(b);
  const g = new CylinderGeometry(r1, r0, len, radial, rings, true);
  const dir = b.clone().sub(a).normalize();
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);
  g.applyQuaternion(q);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

function blob(at: Vector3, rx: number, ry: number, rz: number, w: number, h: number): BufferGeometry {
  const g = new SphereGeometry(1, w, h);
  g.scale(rx, ry, rz);
  g.translate(at.x, at.y, at.z);
  return g;
}

/** A capsule from a to b. */
function capsule(a: Vector3, b: Vector3, r: number, radial: number): BufferGeometry {
  const len = Math.max(1e-4, a.distanceTo(b));
  const g = new CapsuleGeometry(r, len, 3, radial);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  const mid = a.clone().add(b).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

/** A tube through points (grille bars, straps). */
function tube(points: Vector3[], r: number, segs: number, radial: number): BufferGeometry {
  return new TubeGeometry(new CatmullRomCurve3(points), segs, r, radial, false);
}

/** A grid surface (rows × cols of points) as an indexed geometry with smooth normals. */
function gridSurface(rows: number, cols: number, at: (i: number, j: number, out: Vector3) => void, closeCols = false): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const v = new Vector3();
  const nc = closeCols ? cols : cols + 1;
  for (let i = 0; i <= rows; i++) {
    for (let j = 0; j < nc; j++) {
      at(i, j, v);
      pos.push(v.x, v.y, v.z);
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const j1 = closeCols ? (j + 1) % cols : j + 1;
      const a = i * nc + j;
      const b = i * nc + j1;
      const c = (i + 1) * nc + j1;
      const d = (i + 1) * nc + j;
      idx.push(a, d, c, a, c, b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Flips a surface's triangles where they face away from `want(centroid)` (each triangle checked on its own). */
function orient(g: BufferGeometry, want: (c: Vector3) => Vector3): BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const p = ng.attributes.position as BufferAttribute;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  for (let k = 0; k < p.count; k += 3) {
    a.fromBufferAttribute(p, k);
    b.fromBufferAttribute(p, k + 1);
    c.fromBufferAttribute(p, k + 2);
    n.copy(b).sub(a).cross(c.clone().sub(a));
    const centre = a.clone().add(b).add(c).divideScalar(3);
    if (n.dot(want(centre)) < 0) {
      p.setXYZ(k + 1, c.x, c.y, c.z);
      p.setXYZ(k + 2, b.x, b.y, b.z);
    }
  }
  ng.computeVertexNormals();
  return ng;
}

/** A thin closed slab from a strip of (inner, outer) point pairs, `t` thick along `up`: top, underside and edge. */
function slab(strip: Array<[Vector3, Vector3]>, t: number, up: Vector3): BufferGeometry {
  const off = up.clone().multiplyScalar(t / 2);
  const surf = (pick: (k: number, j: number) => Vector3) => gridSurface(strip.length - 1, 1, (i, j, out) => out.copy(pick(i, j)));
  const down = up.clone().negate();
  const top = orient(surf((i, j) => strip[i][j].clone().add(off)), () => up);
  const bottom = orient(surf((i, j) => strip[i][j].clone().sub(off)), () => down);
  const mid = strip[Math.floor(strip.length / 2)][0];
  const edge = orient(surf((i, j) => strip[i][1].clone().addScaledVector(off, j === 0 ? 1 : -1)), (cc) => cc.clone().sub(mid));
  // Smooth the top and underside across the strip (their triangles now agree).
  return mergeGeometries([top, bottom, edge])!;
}

// ---------------------------------------------------------------------------------------------------------------
// Head: a sculpted ellipsoid (jaw and chin, brow ridge, eye sockets, cheekbones, the mouth's muzzle, a fuller back
// of the skull), a nose with nostril wings, ears; hair shells grown from the skull; a full-beard shell.
// ---------------------------------------------------------------------------------------------------------------

/** The skull surface point in direction d (unit, head-local: x lateral, y up, z forward). */
function sculpt(d: Vector3, out: Vector3): Vector3 {
  let x = d.x * HEAD.rx;
  const y = d.y * HEAD.ry;
  let z = d.z * HEAD.rz;
  const yn = d.y;
  const front = Math.max(0, d.z);
  if (yn < 0) {
    const t = -yn;
    x *= 1 - 0.3 * smooth(0.12, 0.92, t) * (0.55 + 0.45 * front);
    z *= 1 - 0.14 * smooth(0.45, 1.0, t) * (1 - front);
  }
  if (d.z < 0 && yn > -0.25) z *= 1.06;
  // A flatter face, a brow ridge, eye sockets, cheekbones, the mouth's muzzle and the chin.
  if (d.z > 0.55) z -= (d.z - 0.55) * 0.016;
  // Jaw angle held wide, then the chin narrows; temples drawn in.
  x *= 1 + 0.06 * gauss2(yn + 0.58, 0, 0.14, 10) * smooth(0.45, 0.8, Math.abs(d.x));
  x *= 1 - 0.035 * gauss2(yn - 0.3, 0, 0.12, 10) * smooth(0.5, 0.85, Math.abs(d.x)) * front;
  z += 0.0065 * gauss2(yn - 0.22, d.x, 0.06, 0.5) * front;
  z -= 0.0085 * (gauss2(yn - 0.01, d.x - 0.42, 0.08, 0.13) + gauss2(yn - 0.01, d.x + 0.42, 0.08, 0.13)) * front;
  z += 0.0035 * gauss2(yn + 0.08, d.x, 0.12, 0.12) * front;
  x *= 1 + 0.065 * gauss2(yn + 0.12, 0, 0.14, 10) * smooth(0.35, 0.75, Math.abs(d.x)) * front;
  z += 0.0065 * gauss2(yn + 0.5, d.x, 0.14, 0.34) * front;
  z += 0.003 * (gauss2(yn + 0.47, d.x, 0.035, 0.26) + gauss2(yn + 0.62, d.x, 0.04, 0.24)) * front;
  z += 0.0085 * gauss2(yn + 0.86, d.x, 0.1, 0.28) * front;
  return out.set(x, y, z).add(HEAD.c);
}

const dirOf = (theta: number, phi: number, out: Vector3) => out.set(Math.sin(theta) * Math.sin(phi), Math.cos(theta), Math.sin(theta) * Math.cos(phi));

function headGeometry(rows: number, cols: number): BufferGeometry {
  const d = new Vector3();
  return gridSurface(rows, cols, (i, j, out) => sculpt(dirOf((i / rows) * Math.PI, (j / cols) * Math.PI * 2, d), out), true);
}

function noseGeometry(): BufferGeometry {
  // A wedge: a narrow bridge from between the eyes widening to the base, the tip about 2 cm proud of the face, the
  // underside turning back to the upper lip; nostril wings tucked in either side of the base.
  const g = new SphereGeometry(1, 14, 14);
  const p = g.attributes.position as BufferAttribute;
  const v = new Vector3();
  const zFace = HEAD.c.z + HEAD.rz - 0.013;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const t = (1 - v.y) / 2;
    const w = 0.0042 + 0.0068 * smooth(0.05, 0.85, t);
    const proud = 0.003 + 0.016 * smooth(0.0, 0.78, t) * (1 - 0.55 * smooth(0.82, 1.0, t));
    const z = zFace + (v.z > 0 ? v.z * proud : v.z * 0.004);
    p.setXYZ(i, v.x * w, EYE_Y - 0.004 - t * 0.046, z);
  }
  g.computeVertexNormals();
  const wings = [-1, 1].map((s2) => blob(new Vector3(s2 * 0.0098, EYE_Y - 0.0452, zFace + 0.0042), 0.0049, 0.0042, 0.0052, 8, 6));
  return mergeGeometries([g.toNonIndexed(), ...wings.map((w) => w.toNonIndexed())])!;
}

function earGeometry(side: 1 | -1): BufferGeometry {
  const g = blob(new Vector3(side * (HEAD.rx + 0.002), EYE_Y - 0.012, HEAD.c.z - 0.006), 0.0075, 0.026, 0.017, 8, 8);
  g.translate(-side * (HEAD.rx + 0.003), -(EYE_Y - 0.012), -(HEAD.c.z - 0.006));
  g.rotateY(side * 0.32);
  g.rotateX(-0.12);
  g.translate(side * (HEAD.rx + 0.003), EYE_Y - 0.012, HEAD.c.z - 0.006);
  return g;
}

/**
 * Where the hair shell stands (1) or lies inside the skull (0), by direction: above the forehead, over the ears, down
 * to the nape. Its edge sits a little inside the hairline the skin shader paints, so the shell's own edge never shows.
 */
function hairMask(d: Vector3): number {
  const front = Math.max(0, d.z);
  const side = Math.abs(d.x);
  const line = 0.42 * front * (1 - 0.35 * side) + 0.12 * (1 - front) - 0.55 * Math.max(0, -d.z);
  return smooth(line + 0.045, line + 0.15, d.y);
}

/**
 * A hair shell for a style: grown out from the skull by the style's thickness, tapering to nothing at the hairline,
 * tucked inside the skull where there is no hair. Its `aBase` attribute holds the skull points it grows from (headgear
 * presses hair onto them).
 */
function hairShell(style: (typeof HAIR_STYLES)[number], rows: number, cols: number): BufferGeometry {
  const d = new Vector3();
  const s = new Vector3();
  const n = new Vector3();
  const seed = hash32(style) % 1000;
  const thick = (dd: Vector3): number => {
    const az = Math.atan2(dd.x, dd.z);
    switch (style) {
      case 'crop':
        return 0.0045 + 0.0012 * Math.sin(az * 9 + seed);
      case 'wavy':
        return 0.011 + 0.004 * Math.sin(az * 6 + dd.y * 9 + seed) + 0.003 * Math.max(0, dd.y);
      case 'curly':
        return 0.016 + 0.005 * Math.sin(az * 17 + seed) * Math.sin(dd.y * 21 + seed) + 0.004 * Math.max(0, dd.y);
      case 'side_part':
        return 0.008 + (dd.x > -0.25 ? 0.0045 : 0.0015) * smooth(-0.2, 0.6, dd.y) + 0.003 * Math.max(0, dd.z) * Math.max(0, dd.y);
      case 'tied':
        return 0.004;
      default:
        return 0.0015;
    }
  };
  const basePts: number[] = [];
  const geo = gridSurface(rows, cols, (i, j, out) => {
    dirOf((i / rows) * Math.PI, (j / cols) * Math.PI * 2, d);
    sculpt(d, s);
    n.copy(s).sub(HEAD.c).normalize();
    const m = hairMask(d);
    out.copy(s).addScaledVector(n, -0.0025 + (thick(d) + 0.0025) * m);
    basePts.push(s.x, s.y, s.z);
  }, true);
  geo.setAttribute('aBase', new BufferAttribute(new Float32Array(basePts), 3));
  if (style !== 'tied') return geo;
  // A bun at the back of the crown.
  const bun = blob(new Vector3(0, HEAD.c.y + 0.085, HEAD.c.z - 0.085), 0.03, 0.026, 0.028, 10, 8);
  bun.deleteAttribute('uv');
  const crown = new Float32Array(bun.attributes.position.count * 3);
  for (let k = 0; k < crown.length; k += 3) crown.set([0, HEAD.c.y + 0.08, HEAD.c.z - 0.07], k);
  bun.setAttribute('aBase', new BufferAttribute(crown, 3));
  return mergeGeometries([geo.toNonIndexed(), bun.toNonIndexed()])!;
}

/** The full beard: a shell over the jaw, chin and upper lip (with its skull points in `aBase`). */
function beardShell(rows: number, cols: number): BufferGeometry {
  const d = new Vector3();
  const s = new Vector3();
  const n = new Vector3();
  const basePts: number[] = [];
  const geo = gridSurface(rows, cols, (i, j, out) => {
    dirOf((i / rows) * Math.PI, (j / cols) * Math.PI * 2, d);
    sculpt(d, s);
    n.copy(s).sub(HEAD.c).normalize();
    const jaw = smooth(-0.18, -0.42, d.y) * smooth(-0.35, 0.05, d.z);
    const lip = gauss2(d.y + 0.42, d.x, 0.06, 0.28) * Math.max(0, d.z);
    const mouth = gauss2(d.y + 0.56, d.x, 0.05, 0.22) * Math.max(0, d.z);
    const m = Math.max(jaw, lip * 0.8) * (1 - mouth * 0.9);
    out.copy(s).addScaledVector(n, m > 0.05 ? 0.0075 * m + 0.001 : -0.003);
    basePts.push(s.x, s.y, s.z);
  }, true);
  geo.setAttribute('aBase', new BufferAttribute(new Float32Array(basePts), 3));
  return geo;
}

// ---------------------------------------------------------------------------------------------------------------
// Headgear
// ---------------------------------------------------------------------------------------------------------------

/** An open shell over the head: an ellipsoid from its crown down to a rim at polar angle rim(φ) (φ = 0 at the front). */
function shell(c: Vector3, rx: number, ry: number, rz: number, rim: (phi: number) => number, rows: number, cols: number, inward = 0): BufferGeometry {
  const g = gridSurface(rows, cols, (i, j, out) => {
    const phi = (j / cols) * Math.PI * 2;
    const theta = (i / rows) * rim(phi);
    out.set(Math.sin(theta) * Math.sin(phi) * (rx - inward), Math.cos(theta) * (ry - inward), Math.sin(theta) * Math.cos(phi) * (rz - inward)).add(c);
  }, true);
  if (inward > 0) {
    // The padding faces inwards: reverse the winding.
    const idx = g.index!.array as Uint16Array | Uint32Array;
    for (let k = 0; k < idx.length; k += 3) {
      const t = idx[k + 1];
      idx[k + 1] = idx[k + 2];
      idx[k + 2] = t;
    }
    g.computeVertexNormals();
  }
  return g;
}

const DEG = Math.PI / 180;
/** A rim that is `front` degrees from the crown at the front, `side` at the sides and `back` at the back. */
const rimOf = (front: number, side: number, back: number) => (phi: number) => {
  const c = Math.cos(phi);
  return (c > 0 ? side + (front - side) * c : side + (back - side) * -c) * DEG;
};

/** Points along a shell's rim (for peaks, brims and guards). */
function rimPoint(c: Vector3, rx: number, ry: number, rz: number, rim: (phi: number) => number, phi: number, grow = 0): Vector3 {
  const th = rim(phi);
  return new Vector3(Math.sin(th) * Math.sin(phi) * (rx + grow), Math.cos(th) * (ry + grow), Math.sin(th) * Math.cos(phi) * (rz + grow)).add(c);
}

/** A peak or brim off a rim, from phi0 to phi1: `reach` outwards, dropping `drop` at its edge. */
function brim(c: Vector3, rx: number, ry: number, rz: number, rim: (phi: number) => number, phi0: number, phi1: number, reach: number, drop: number, n: number): BufferGeometry {
  const strip: Array<[Vector3, Vector3]> = [];
  for (let i = 0; i <= n; i++) {
    const phi = phi0 + ((phi1 - phi0) * i) / n;
    const a = rimPoint(c, rx, ry, rz, rim, phi);
    const out = new Vector3(Math.sin(phi), 0, Math.cos(phi));
    // Peaks are deepest at the front.
    const k = reach * (phi1 - phi0 < Math.PI * 1.9 ? 0.55 + 0.45 * Math.cos(phi) : 1);
    strip.push([a, a.clone().addScaledVector(out, k).add(new Vector3(0, -drop, 0))]);
  }
  return slab(strip, 0.0045, new Vector3(0, 1, 0));
}

interface Headpiece {
  geo: BufferGeometry;
  region: Region;
}

/** The batting helmet: shell with ear guards, padding, peak, neck guard, a metal grille at real spacing, chin strap. */
function helmetParts(detail: boolean): Headpiece[] {
  const c = HEAD.c.clone().add(new Vector3(0, 0.012, -0.004));
  const [rx, ry, rz] = [0.102, 0.134, 0.121];
  const rim = rimOf(72, 112, 122);
  const rows = detail ? 12 : 5;
  const cols = detail ? 28 : 12;
  const parts: Headpiece[] = [
    { geo: shell(c, rx, ry, rz, rim, rows, cols), region: R.helmet },
    { geo: brim(c, rx, ry, rz, rim, -78 * DEG, 78 * DEG, 0.062, 0.016, detail ? 14 : 6), region: R.helmet },
  ];
  if (!detail) return parts;
  parts.push({ geo: shell(c, rx, ry, rz, rim, rows, cols, 0.009), region: R.padding });
  // Neck guard (stem guard) below the back of the shell.
  const neck: Array<[Vector3, Vector3]> = [];
  for (let i = 0; i <= 8; i++) {
    const phi = Math.PI - 0.55 + (1.1 * i) / 8;
    const a = rimPoint(c, rx, ry, rz, rim, phi, -0.004);
    neck.push([a, a.clone().add(new Vector3(Math.sin(phi) * 0.006, -0.045, Math.cos(phi) * 0.006))]);
  }
  parts.push({ geo: slab(neck, 0.006, new Vector3(0, 0, 1)), region: R.helmet });
  // Grille: three horizontal arcs and three uprights, ≈ 6 cm below the peak (less than a ball's width).
  const arc = (y: number, chin: number) => {
    const pts: Vector3[] = [];
    for (let i = 0; i <= 10; i++) {
      const psi = (-80 + 16 * i) * DEG;
      pts.push(new Vector3(0.099 * Math.sin(psi), y - chin * Math.cos(psi), HEAD.c.z + 0.006 + 0.138 * Math.cos(psi)));
    }
    return pts;
  };
  const yTop = EYE_Y - 0.022;
  const yMid = EYE_Y - 0.062;
  const yBot = EYE_Y - 0.098;
  for (const [y, chin] of [[yTop, 0], [yMid, 0.004], [yBot, 0.012]] as const) parts.push({ geo: tube(arc(y, chin), 0.0032, 24, 5), region: R.grille });
  for (const psi of [0, -32, 32].map((d) => d * DEG)) {
    const at = (y: number, chin: number) => new Vector3(0.099 * Math.sin(psi), y - chin * Math.cos(psi), HEAD.c.z + 0.006 + 0.138 * Math.cos(psi));
    parts.push({ geo: tube([at(yTop, 0), at(yMid, 0.004), at(yBot, 0.012)], 0.003, 6, 5), region: R.grille });
  }
  parts.push({
    geo: tube([new Vector3(-0.09, 1.632, 0.004), new Vector3(-0.05, 1.59, 0.046), new Vector3(0, 1.578, 0.064), new Vector3(0.05, 1.59, 0.046), new Vector3(0.09, 1.632, 0.004)], 0.0045, 12, 4),
    region: R.strap,
  });
  return parts;
}

function capParts(detail: boolean): Headpiece[] {
  const c = HEAD.c.clone().add(new Vector3(0, 0.008, -0.004));
  const [rx, ry, rz] = [0.087, 0.127, 0.107];
  const rim = rimOf(68, 88, 96);
  const parts: Headpiece[] = [
    { geo: shell(c, rx, ry, rz, rim, detail ? 8 : 4, detail ? 22 : 10), region: R.cap },
    { geo: brim(c, rx, ry, rz, rim, -70 * DEG, 70 * DEG, 0.072, 0.018, detail ? 12 : 5), region: R.cap },
  ];
  if (detail) parts.push({ geo: blob(new Vector3(c.x, c.y + ry + 0.002, c.z), 0.007, 0.004, 0.007, 6, 4), region: R.cap });
  return parts;
}

/** A wide-brimmed hat (a fielder's sun hat, or the umpire's hat with a deeper brim). */
function hatParts(detail: boolean, reach: number): Headpiece[] {
  const c = HEAD.c.clone().add(new Vector3(0, 0.016, -0.004));
  const [rx, ry, rz] = [0.088, 0.122, 0.107];
  const rim = rimOf(80, 84, 88);
  return [
    { geo: shell(c, rx, ry, rz, rim, detail ? 8 : 4, detail ? 22 : 10), region: R.hat },
    { geo: brim(c, rx, ry, rz, rim, 0, Math.PI * 2, reach, 0.012, detail ? 28 : 12), region: R.hat },
  ];
}

function patkaParts(detail: boolean): Headpiece[] {
  const c = HEAD.c.clone().add(new Vector3(0, 0.01, -0.004));
  return [
    { geo: shell(c, 0.088, 0.128, 0.108, rimOf(62, 86, 94), detail ? 8 : 4, detail ? 20 : 10), region: R.cap },
    { geo: blob(new Vector3(0, HEAD.c.y + 0.108, HEAD.c.z + 0.025), 0.034, 0.03, 0.032, detail ? 10 : 6, detail ? 8 : 4), region: R.cap },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Hands, gloves, shoes, pads
// ---------------------------------------------------------------------------------------------------------------

/**
 * The batting glove's grip, in the hand bone's bind frame (x for the left hand; ×side for the right). The handle runs
 * through the closed glove along `axis`, diagonally across the palm from the heel of the hand (little finger, towards
 * the cap) to the base of the index finger (towards the toe), through `centre`. `fingers`: each roll's place along the
 * axis and its thickness, index first.
 */
export const GLOVE_GRIP = Object.freeze({
  centre: [-0.034, -0.078, 0.004] as const,
  axis: [0, -Math.sin(20 * (Math.PI / 180)), Math.cos(20 * (Math.PI / 180))] as const,
  fingers: [[0.033, 0.0112], [0.011, 0.0114], [-0.011, 0.0108], [-0.032, 0.0098]] as ReadonlyArray<readonly [number, number]>,
});
/** The handle radius the rolls close round (the bat's rubber grip, props.GRIP_R, plus a little leather). */
const GRIP_R_GLOVE = 0.0186;

/** One finger roll curled round the grip channel: from the knuckle (towards the back of the hand) over the far side. */
function fingerRoll(centre: Vector3, axis: Vector3, side: 1 | -1, radius: number, tube: number, detail: boolean): BufferGeometry {
  const e1 = new Vector3(side, 0, 0);
  const e2 = new Vector3(0, -1, 0).addScaledVector(axis, axis.y).normalize();
  const e3 = new Vector3().crossVectors(e1, e2);
  const g = new TorusGeometry(radius, tube, detail ? 7 : 4, detail ? 14 : 7, (255 * Math.PI) / 180);
  g.applyMatrix4(new Matrix4().makeBasis(e1, e2, e3).setPosition(centre));
  return g;
}

/** A hand at the wrist (`side` +1 left, −1 right; palm towards the body, thumb forward, fingers down). */
function handParts(wr: Vector3, side: 1 | -1, kind: 'bare' | 'batting' | 'keeper', detail: boolean): Array<{ geo: BufferGeometry; region: Region }> {
  const at = (x: number, y: number, z: number) => wr.clone().add(new Vector3(x * side, y, z));
  const out: Array<{ geo: BufferGeometry; region: Region }> = [];
  const rad = detail ? 8 : 5;
  if (kind === 'bare') {
    out.push({ geo: blob(at(0, -0.052, 0.006), 0.019, 0.05, 0.041, detail ? 10 : 6, detail ? 8 : 5), region: R.skin });
    if (detail) {
      const tips = [-0.13, -0.137, -0.133, -0.122];
      [0.017, 0.006, -0.005, -0.016].forEach((z, i) => out.push({ geo: capsule(at(-0.004, -0.09, z), at(-0.012, tips[i], z + 0.01), 0.0082, 6), region: R.skin }));
      out.push({ geo: capsule(at(-0.006, -0.03, 0.03), at(-0.014, -0.075, 0.048), 0.0095, 6), region: R.skin });
    }
    return out;
  }
  if (kind === 'batting') {
    // A batting glove closed in a grip: the cuff, the padded back of the hand, and the finger rolls curled round the
    // handle's channel (GLOVE_GRIP) from the knuckles over the far side of the handle, with the thumb roll across
    // them. Batters hold a bat nearly all the time; a free hand reads as a loosely closed fist.
    const c = at(GLOVE_GRIP.centre[0], GLOVE_GRIP.centre[1], GLOVE_GRIP.centre[2]);
    const axis = new Vector3(0, GLOVE_GRIP.axis[1], GLOVE_GRIP.axis[2]);
    out.push({ geo: segment(at(0, 0.035, 0), at(0, -0.018, 0.004), 0.04, 0.041, rad + 4, 1), region: R.gloves });
    out.push({ geo: blob(at(0.006, -0.056, 0.004), 0.022, 0.05, 0.043, detail ? 12 : 6, detail ? 8 : 5), region: R.gloves });
    const rolls = detail ? GLOVE_GRIP.fingers : ([[0.017, 0.017], [-0.017, 0.016]] as const);
    for (const [along, tube] of rolls) out.push({ geo: fingerRoll(c.clone().addScaledVector(axis, along), axis, side, GRIP_R_GLOVE + tube, tube, detail), region: R.gloves });
    if (detail) out.push({ geo: capsule(at(-0.008, -0.03, 0.036), at(-0.06, -0.074, 0.03), 0.0125, 7), region: R.gloves });
    return out;
  }
  // Keeping gloves: a broad, padded mitt with a webbed thumb.
  out.push({ geo: segment(at(0, 0.04, 0), at(0, -0.02, 0.004), 0.046, 0.047, rad + 4, 1), region: R.keeperGloves });
  out.push({ geo: blob(at(0, -0.08, 0.008), 0.034, 0.08, 0.06, detail ? 12 : 6, detail ? 8 : 5), region: R.keeperGloves });
  if (detail) {
    out.push({ geo: blob(at(0.004, -0.15, 0.004), 0.03, 0.05, 0.057, 10, 7), region: R.keeperGloves });
    out.push({ geo: capsule(at(0, -0.04, 0.052), at(0.006, -0.1, 0.07), 0.016, 7), region: R.keeperGloves });
  }
  return out;
}

/** A cricket shoe: rounded upper, a sole stepped up at the heel, spikes under the forefoot and heel. */
function shoeParts(ankle: Vector3, detail: boolean): Array<{ geo: BufferGeometry; region: Region | ((p: Vector3) => Region) }> {
  const out: Array<{ geo: BufferGeometry; region: Region | ((p: Vector3) => Region) }> = [];
  const top = ankle.y;
  out.push({ geo: blob(new Vector3(ankle.x, top - 0.032, 0.055), 0.05, 0.04, 0.132, detail ? 12 : 6, detail ? 8 : 4), region: R.shoes });
  out.push({ geo: blob(new Vector3(ankle.x, top - 0.012, -0.03), 0.046, 0.045, 0.05, detail ? 10 : 6, detail ? 6 : 4), region: R.shoes });
  const sole = new BoxGeometry(0.098, 0.016, 0.285, 1, 1, detail ? 4 : 1);
  sole.translate(ankle.x, top - 0.064, 0.052);
  out.push({ geo: sole, region: R.sole });
  if (detail) {
    for (const [dx, dz] of [[-0.028, 0.14], [0.028, 0.14], [-0.03, 0.09], [0.03, 0.09], [0, 0.115], [-0.024, -0.05], [0.024, -0.05]]) {
      const spike = new CylinderGeometry(0.0015, 0.0042, 0.009, 5);
      spike.translate(ankle.x + dx, top - 0.077, dz);
      out.push({ geo: spike, region: R.spikes });
    }
  }
  return out;
}

/** Leg guards: vertical rolls round the front of the shin, a knee roll, thigh rolls (batting), side wings, straps. */
function padParts(knee: Vector3, ankle: Vector3, keeper: boolean, detail: boolean): Array<{ geo: BufferGeometry; region: Region; thigh?: boolean }> {
  const out: Array<{ geo: BufferGeometry; region: Region; thigh?: boolean }> = [];
  if (!detail) {
    const pad = new BoxGeometry(0.15, keeper ? 0.4 : 0.5, 0.09, 1, 1, 1);
    pad.translate(knee.x, (knee.y + ankle.y) / 2 + 0.04, 0.05);
    out.push({ geo: pad, region: R.pads });
    out.push({ geo: blob(knee.clone().add(new Vector3(0, 0.03, 0.07)), 0.085, 0.07, 0.06, 8, 6), region: R.pads });
    return out;
  }
  const rolls = keeper ? 5 : 6;
  const r = keeper ? 0.017 : 0.0195;
  const y0 = ankle.y + 0.055;
  const y1 = knee.y - 0.03;
  for (let k = 0; k < rolls; k++) {
    const a = (-70 + (140 * k) / (rolls - 1)) * DEG;
    const ax = knee.x + Math.sin(a) * 0.068;
    const az = Math.cos(a) * 0.068 + 0.01;
    out.push({ geo: capsule(new Vector3(ax, y0, az), new Vector3(ax, y1, az + 0.004), r, 8), region: R.pads });
  }
  out.push({ geo: capsule(new Vector3(knee.x - 0.062, knee.y + 0.012, 0.062), new Vector3(knee.x + 0.062, knee.y + 0.012, 0.062), keeper ? 0.032 : 0.042, 10), region: R.pads });
  if (!keeper) {
    for (let k = 0; k < 4; k++) {
      const a = (-50 + (100 * k) / 3) * DEG;
      const ax = knee.x + Math.sin(a) * 0.078;
      const az = Math.cos(a) * 0.072 + 0.006;
      out.push({ geo: capsule(new Vector3(ax, knee.y + 0.07, az), new Vector3(ax, knee.y + 0.2, az - 0.006), 0.017, 7), region: R.pads, thigh: true });
    }
  }
  for (const s of [1, -1]) {
    const wing = new BoxGeometry(0.012, y1 - y0, 0.08);
    wing.translate(knee.x + s * 0.083, (y0 + y1) / 2, -0.004);
    out.push({ geo: wing, region: R.pads });
  }
  for (const y of [ankle.y + 0.1, (ankle.y + knee.y) / 2, knee.y - 0.06]) {
    const pts: Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = (100 + (160 * i) / 8) * DEG;
      pts.push(new Vector3(knee.x + Math.sin(a) * 0.072, y, Math.cos(a) * 0.06));
    }
    out.push({ geo: tube(pts, 0.006, 10, 4), region: R.strap });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The body
// ---------------------------------------------------------------------------------------------------------------

function bodyParts(lod: 0 | 1, gear: Gear): Part[] {
  const detail = lod === 0;
  const rad = detail ? 14 : 7;
  const rings = detail ? 6 : 2;
  const sph = detail ? [14, 10] : [8, 6];
  const parts: Part[] = [];
  const hips = W('hips');
  const spine = W('spine');
  const chest = W('chest');
  const neck = W('neck');
  const head = W('head');
  const shirtLow = hips.y + 0.02;
  const shirtOrTrousers = (p: Vector3): Region => (p.y > shirtLow ? R.shirt : R.trousers);

  // Torso (shirt), slightly tapered and flattened front-to-back.
  const torso = new CapsuleGeometry(0.168, 0.29, detail ? 6 : 3, detail ? 22 : 10);
  torso.scale(1, 1, 0.72);
  torso.translate(0, (spine.y + chest.y) / 2 + 0.11, 0.0);
  parts.push({ geo: torso, bone: 'chest', blend: { bone: 'spine', a: spine.clone(), b: chest.clone().add(new Vector3(0, 0.2, 0)), range: 0.55 }, region: shirtOrTrousers });
  const belly = new CapsuleGeometry(0.147, 0.08, detail ? 4 : 2, detail ? 20 : 10);
  belly.scale(1, 1, 0.78);
  belly.translate(0, spine.y + 0.04, 0.005);
  parts.push({ geo: belly, bone: 'spine', blend: { bone: 'hips', a: hips.clone(), b: spine.clone().add(new Vector3(0, 0.12, 0)), range: 0.6 }, region: shirtOrTrousers });
  const pelvis = new CapsuleGeometry(0.136, 0.11, detail ? 4 : 2, detail ? 18 : 9);
  pelvis.rotateZ(Math.PI / 2);
  pelvis.scale(1, 1.05, 0.8);
  pelvis.translate(0, hips.y - 0.035, -0.005);
  parts.push({ geo: pelvis, bone: 'hips', region: R.trousers });
  if (detail) {
    // A polo collar, open at the front.
    const pts: Vector3[] = [];
    for (let i = 0; i <= 14; i++) {
      const a = (28 + (304 * i) / 14) * DEG;
      pts.push(new Vector3(Math.sin(a) * 0.071, neck.y + 0.012 - 0.008 * Math.cos(a), Math.cos(a) * 0.064 + 0.004));
    }
    parts.push({ geo: tube(pts, 0.011, 20, 5), bone: 'chest', blend: { bone: 'neck', a: neck.clone(), b: neck.clone().add(new Vector3(0, 0.1, 0)), range: 0.4 }, region: R.collar });
  }

  // Neck and head.
  parts.push({ geo: segment(neck.clone().add(new Vector3(0, -0.04, 0)), head.clone().add(new Vector3(0, 0.03, 0)), 0.052, 0.047, rad, 1), bone: 'neck', blend: { bone: 'chest', a: neck.clone().add(new Vector3(0, -0.04, 0)), b: head.clone(), range: 0.45 }, region: R.skin });
  parts.push({ geo: headGeometry(detail ? 22 : 9, detail ? 28 : 12), bone: 'head', region: R.skin });
  if (detail) {
    parts.push({ geo: noseGeometry(), bone: 'head', region: R.skin });
    parts.push({ geo: earGeometry(1), bone: 'head', region: R.skin }, { geo: earGeometry(-1), bone: 'head', region: R.skin });
  }
  // Hair: every style for players whose hair shows (bowlers, fielders without a cap, umpires under the hat brim);
  // a close crop under the batter's helmet.
  const styles = gear === 'batter' ? (['crop'] as const) : HAIR_STYLES;
  styles.forEach((style) => {
    if (style === 'shaved') return;
    parts.push({ geo: hairShell(style, detail ? 15 : 6, detail ? 22 : 8), bone: 'head', region: R.hair, variant: V_HAIR + HAIR_STYLES.indexOf(style) });
  });
  if (gear !== 'batter') parts.push({ geo: beardShell(detail ? 13 : 5, detail ? 20 : 8), bone: 'head', region: R.hair, variant: V_BEARD });

  // Arms: sleeves (long for the umpire), skin or gloves below.
  const longSleeves = gear === 'umpire';
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 1 : -1;
    const sh = W(`upperArm${side}`);
    const el = W(`forearm${side}`);
    const wr = W(`hand${side}`);
    parts.push({ geo: blob(sh.clone().add(new Vector3(0, -0.01, 0)), 0.078, 0.074, 0.07, sph[0], sph[1]), bone: `upperArm${side}`, region: R.shirt });
    const sleeveEnd = sh.y - 0.15;
    parts.push({ geo: segment(sh, el, 0.063, 0.05, rad, rings), bone: `upperArm${side}`, blendEnd: { bone: `forearm${side}`, range: 0.22 }, region: (p) => (longSleeves || p.y > sleeveEnd ? R.shirt : R.skin) });
    if (detail && !longSleeves) parts.push({ geo: segment(new Vector3(sh.x, sleeveEnd + 0.012, sh.z), new Vector3(sh.x, sleeveEnd - 0.004, sh.z), 0.0565, 0.0545, rad, 1), bone: `upperArm${side}`, region: R.collar });
    parts.push({ geo: segment(el, wr, 0.049, 0.038, rad, rings), bone: `forearm${side}`, blend: { bone: `upperArm${side}`, a: el.clone(), b: wr.clone(), range: 0.22 }, region: longSleeves ? R.shirt : R.skin });
    const kind = gear === 'batter' ? 'batting' : gear === 'keeper' ? 'keeper' : 'bare';
    for (const h of handParts(wr, s as 1 | -1, kind, detail)) parts.push({ geo: h.geo, bone: `hand${side}`, region: h.region });
  }

  // Legs, shoes and (batter, keeper) pads.
  for (const side of ['L', 'R'] as const) {
    const hip = W(`thigh${side}`);
    const knee = W(`shin${side}`);
    const ankle = W(`foot${side}`);
    parts.push({ geo: segment(hip.clone().add(new Vector3(0, 0.04, 0)), knee, 0.098, 0.068, rad, rings), bone: `thigh${side}`, blend: { bone: 'hips', a: hip.clone().add(new Vector3(0, 0.04, 0)), b: knee.clone(), range: 0.22 }, blendEnd: { bone: `shin${side}`, range: 0.2 }, region: R.trousers });
    parts.push({ geo: segment(knee, ankle.clone().add(new Vector3(0, 0.02, 0)), 0.066, 0.046, rad, rings), bone: `shin${side}`, blend: { bone: `thigh${side}`, a: knee.clone(), b: ankle.clone(), range: 0.18 }, region: R.trousers });
    for (const p of shoeParts(ankle, detail)) parts.push({ geo: p.geo, bone: `foot${side}`, region: p.region });
    if (gear === 'batter' || gear === 'keeper') {
      for (const p of padParts(knee, ankle, gear === 'keeper', detail)) {
        parts.push(p.thigh ? { geo: p.geo, bone: `thigh${side}`, region: p.region } : { geo: p.geo, bone: `shin${side}`, blend: { bone: `thigh${side}`, a: knee.clone().add(new Vector3(0, 0.08, 0)), b: ankle.clone(), range: 0.12 }, region: p.region });
      }
    }
  }

  // Headgear variants.
  const head2 = (pieces: Headpiece[], option: number) => pieces.forEach((h) => parts.push({ geo: h.geo, bone: 'head', region: h.region, variant: V_HEAD + option }));
  if (gear === 'batter') head2(helmetParts(detail), 0);
  else if (gear === 'keeper') {
    head2(helmetParts(detail), 0);
    head2(capParts(detail), 1);
  } else if (gear === 'fielder') {
    head2(capParts(detail), 0);
    head2(hatParts(detail, 0.056), 1);
    head2(patkaParts(detail), 3);
  } else if (gear === 'umpire') head2(hatParts(detail, 0.06), 0);
  return parts;
}

const geoCache = new Map<string, BufferGeometry>();

function buildGeometry(lod: 0 | 1, gear: Gear): BufferGeometry {
  const key = `${gear}:${lod}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const pieces: BufferGeometry[] = [];
  const p = new Vector3();
  for (const part of bodyParts(lod, gear)) {
    const g = prep(part.geo);
    const n = g.attributes.position.count;
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const region = new Float32Array(n);
    const bind = new Float32Array(n * 3);
    const variant = new Float32Array(n).fill(part.variant ?? 0);
    const main = BONE_INDEX[part.bone];
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(g.attributes.position as BufferAttribute, i);
      bind.set([p.x, p.y, p.z], i * 3);
      region[i] = typeof part.region === 'function' ? part.region(p) : part.region;
      let other = -1;
      let wOther = 0;
      if (part.blend) {
        const { a, b, range } = part.blend;
        const ab = b.clone().sub(a);
        const t = ab.lengthSq() > 0 ? p.clone().sub(a).dot(ab) / ab.lengthSq() : 1;
        if (t < range) {
          wOther = 0.5 * (1 - Math.max(0, t / range));
          other = BONE_INDEX[part.blend.bone];
        }
      }
      if (part.blendEnd) {
        const child = W(part.blendEnd.bone);
        const parent = W(part.bone);
        const ab = child.clone().sub(parent);
        const t = ab.lengthSq() > 0 ? p.clone().sub(parent).dot(ab) / ab.lengthSq() : 0;
        if (t > 1 - part.blendEnd.range) {
          wOther = 0.5 * Math.min(1, (t - (1 - part.blendEnd.range)) / part.blendEnd.range);
          other = BONE_INDEX[part.blendEnd.bone];
        }
      }
      si[i * 4] = main;
      sw[i * 4] = 1 - wOther;
      if (other >= 0) {
        si[i * 4 + 1] = other;
        sw[i * 4 + 1] = wOther;
      }
    }
    g.setAttribute('skinIndex', new BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new BufferAttribute(sw, 4));
    g.setAttribute('region', new BufferAttribute(region, 1));
    g.setAttribute('bindPos', new BufferAttribute(bind, 3));
    g.setAttribute('aVar', new BufferAttribute(variant, 1));
    if (!g.attributes.aBase) g.setAttribute('aBase', new BufferAttribute(bind.slice(), 3));
    pieces.push(g);
  }
  // Each piece keeps its own smooth normals (no re-computation after merging: that would facet everything).
  const merged = mergeGeometries(pieces)!;
  merged.computeBoundingSphere();
  geoCache.set(key, merged);
  return merged;
}

// ---------------------------------------------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------------------------------------------

const PATTERN_ID: Record<KitSpec['pattern'], number> = { plain: 0, stripes: 1, hoops: 2, chevron: 3, sash: 4 };

interface PlayerUniforms {
  uPrimary: { value: Color };
  uSecondary: { value: Color };
  uTrouser: { value: Color };
  uSkin: { value: Color };
  uSkinShade: { value: Color };
  uHair: { value: Color };
  uIris: { value: Color };
  uHelmet: { value: Color };
  /** Hat colour (the fielder's sun hat, the umpire's hat). */
  uHat: { value: Color };
  uPattern: { value: number };
  uBeard: { value: number };
  uHairline: { value: number };
  uFace: { value: number };
  /** Variants: hair style (HAIR_STYLES index), the full-beard mesh, headgear option; hair pressed under headgear. */
  uHairStyle: { value: number };
  uBeardMesh: { value: number };
  uHeadgear: { value: number };
  uHairUnder: { value: number };
  /** Brows: 0 soft, 1 straight, 2 bold. Eyes: 0 round, 1 almond, 2 narrow. */
  uBrow: { value: number };
  uEyes: { value: number };
  /** Expression: brow raise (+) / frown (−), smile (+) / grimace (−), mouth open, eyes squeezed. */
  uExpr: { value: [number, number, number, number] };
  /** Blinks run on the shared stadium clock with a per-player phase, except on a rig the Director drives (uLidL >= 0). */
  uTime: { value: number };
  uBlinkPhase: { value: number };
  /**
   * The Director's lids, one per eye (0 open .. 1 closed) and the iris offset in the rig's bind frame (m): while uLidL is
   * negative the rig is not driven and blinks on the periodic clock above, exactly as before (fielders, keeper, umpires).
   */
  uLidL: { value: number };
  uLidR: { value: number };
  uGaze: { value: [number, number] };
  /** Ghost tint (Coach Mode) and its strength. */
  uGhost: { value: Color };
  uGhostAmt: { value: number };
}

const PLAYER_VERTEX = `
attribute float aVar;
attribute vec3 aBase;
uniform float uHairStyle, uBeardMesh, uHeadgear, uHairUnder;
`;

/** Collapses unused variants to a point and presses hair under headgear (bind pose, before skinning). */
const PLAYER_VARIANTS = `
{
  float grp = floor(aVar / 10.0 + 0.001);
  float opt = aVar - grp * 10.0;
  float show = 1.0;
  if (grp > 0.5 && grp < 1.5) show = step(abs(opt - uHairStyle), 0.5);
  else if (grp > 1.5 && grp < 2.5) show = step(0.5, uBeardMesh);
  else if (grp > 2.5) show = step(abs(opt - uHeadgear), 0.5);
  // Under headgear the hair above the eye line sinks just inside the skull (the painted hairline shows instead).
  if (grp > 0.5 && grp < 1.5 && uHairUnder > 0.5 && aBase.y > ${(EYE_Y + 0.012).toFixed(3)}) transformed = aBase - normalize(aBase - ${g3v(HEAD.c)}) * 0.003;
  if (show < 0.5) transformed = vec3(0.0, ${HEAD.c.y.toFixed(3)}, 0.0);
}
`;

/** Night readability fill (rim and broadcast fill on the players): full under lights, lower by day. The stadium sets it. */
export const PLAYER_FILL = { value: 1 };

const g3 = (v: Vector3) => `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;

const PLAYER_FRAGMENT_COMMON = `
varying float vRegion;
varying vec3 vBind;
uniform vec3 uPrimary, uSecondary, uTrouser, uSkin, uSkinShade, uHair, uIris, uHelmet, uHat, uGhost;
uniform float uPattern, uBeard, uHairline, uFace, uBrow, uEyes, uTime, uBlinkPhase, uGhostAmt, uFill, uLidL, uLidR;
uniform vec2 uGaze;
uniform vec4 uExpr;
float vcRough = 0.7;
float vcMetal = 0.0;
float vcWrap = 0.0;
const vec3 HC = ${g3(HEAD.c)};
const vec3 HR = vec3(${HEAD.rx}, ${HEAD.ry}, ${HEAD.rz});
const float EYE_Y = ${EYE_Y.toFixed(4)};
const float EYE_X = ${EYE_X.toFixed(4)};
float ph12(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float sstep(float a, float b, float v) { return smoothstep(a, b, v); }
float sq(float v) { return v * v; }
vec3 kitColor(vec3 b) {
  float m = 0.0;
  if (uPattern > 0.5 && uPattern < 1.5) m = sstep(0.72, 0.75, fract(b.x * 8.0 + 0.5));
  else if (uPattern > 1.5 && uPattern < 2.5) m = sstep(0.7, 0.73, fract(b.y * 6.5));
  else if (uPattern > 2.5 && uPattern < 3.5) m = sstep(0.76, 0.8, fract((abs(b.x) * 1.5 - b.y) * 3.6));
  else if (uPattern > 3.5) m = 1.0 - sstep(0.055, 0.065, abs(b.x * 0.95 + (b.y - 1.27)));
  float front = step(0.06, b.z);
  float placket = step(abs(b.x), 0.012) * step(1.4, b.y) * step(b.y, 1.535) * front;
  float side = sstep(0.128, 0.136, abs(b.x)) * step(b.y, 1.44) * step(1.0, b.y);
  vec3 c = mix(uPrimary, uSecondary, clamp(m + side * 0.85 + placket * 0.9, 0.0, 1.0));
  float btn = (1.0 - step(0.0042, length(vec2(b.x, b.y - 1.505)))) + (1.0 - step(0.0042, length(vec2(b.x, b.y - 1.462))));
  c = mix(c, vec3(0.92), clamp(btn, 0.0, 1.0) * front);
  // Stitching: dashed seams down the side panels and across the shoulders.
  float seamSide = (1.0 - sstep(0.0008, 0.0018, abs(abs(b.x) - 0.127))) * step(b.y, 1.44) * step(1.0, b.y);
  float seamShoulder = (1.0 - sstep(0.0008, 0.0018, abs(b.y - 1.5 + abs(b.x) * 0.25))) * sstep(0.07, 0.09, abs(b.x));
  c *= 1.0 - max(seamSide, seamShoulder) * step(0.5, fract((b.y + b.x) * 160.0)) * 0.32;
  // The fabric's weave, faded where it would alias.
  float fw = fwidth(b.y * 380.0);
  c *= 1.0 + 0.04 * sin(b.x * 1210.0) * sin(b.y * 1190.0 + b.z * 600.0) * (1.0 - sstep(0.25, 0.9, fw));
  return c;
}
vec3 skinColor(vec3 b) {
  vec3 c = uSkin;
  vec3 h = (b - HC) / HR;
  vcWrap = 0.5;
  vcRough = 0.66;
  if (length(h) > 1.35 || b.y < HC.y - HR.y * 1.2) return c;
  float front = sstep(0.3, 0.7, h.z);
  c = mix(c, uSkinShade, sstep(-0.55, -0.98, h.y) * 0.55 * (1.0 - front * 0.4));
  // A little warmth on the cheeks, nose and ears.
  float cheeks = exp(-sq((abs(h.x) - 0.48) / 0.2) - sq((h.y + 0.28) / 0.22)) * front;
  c = mix(c, c * vec3(1.07, 0.9, 0.86), cheeks * 0.45);
  // Scalp stubble on a shaved head.
  float scalp = sstep(0.42, 0.6, h.y + 0.25 * (1.0 - front)) * (1.0 - uHairline);
  c = mix(c, uHair, scalp * 0.42 * (0.7 + 0.3 * ph12(floor(b.xz * 900.0))));
  // The hairline, painted on the skin (soft-edged), so the hair shell's own edge never shows.
  vec3 hd = normalize(h);
  float hfront = max(0.0, hd.z);
  float hline = 0.42 * hfront * (1.0 - 0.35 * abs(hd.x)) + 0.12 * (1.0 - hfront) - 0.55 * max(0.0, -hd.z);
  float hairOn = sstep(hline + 0.01, hline + 0.07, hd.y) * uHairline;
  c = mix(c, uHair * 0.92, hairOn * (0.85 + 0.15 * ph12(floor(b.xy * 1500.0))));
  // Facial hair (painted): stubble, moustache, a short or full beard's density on the skin.
  float jaw = sstep(-0.2, -0.45, h.y) * sstep(-0.25, 0.1, h.z);
  float lipTop = exp(-sq((h.y + 0.43) / 0.07) - sq(h.x / 0.3)) * front;
  float speck = 0.65 + 0.35 * ph12(floor(b.xy * 1400.0));
  float beard = clamp(uBeard, 0.0, 1.0);
  float facial = max(jaw * sstep(0.25, 0.6, beard), lipTop * sstep(0.15, 0.3, beard));
  c = mix(c, uHair * 1.1, facial * mix(0.35, 0.9, sstep(0.4, 0.85, beard)) * speck);
  if (uFace > 0.5 && h.z > 0.4) {
    float ex = abs(b.x) - EYE_X;
    float ey = b.y - EYE_Y;
    float ew = mix(0.0128, 0.0136, step(0.5, uEyes));
    float eh = (uEyes < 0.5 ? 0.0062 : uEyes < 1.5 ? 0.0052 : 0.0043) * (1.0 - uExpr.w * 0.55);
    float bt = fract(uTime / 4300.0 + uBlinkPhase);
    float blink = sstep(0.0, 0.014, bt) * (1.0 - sstep(0.026, 0.045, bt));
    // A rig the Director drives (uLidL >= 0) takes its lids and its gaze from it; every other rig keeps the periodic blink.
    float directed = step(0.0, uLidL);
    float side = b.x > 0.0 ? 1.0 : -1.0;
    blink = mix(blink, clamp(b.x > 0.0 ? uLidL : uLidR, 0.0, 1.0), directed);
    vec2 gz = uGaze * directed;
    float shape = max(0.0, 1.0 - (ex * ex) / (ew * ew));
    float topLid = eh * sqrt(shape) * (1.0 - 2.0 * blink);
    float botLid = -eh * sqrt(shape) * 0.85;
    float inEye = step(0.001, shape) * step(ey, topLid) * step(botLid, ey);
    vec3 eye = vec3(0.92, 0.9, 0.86);
    float ir = length(vec2(ex - gz.x * side, ey + 0.0004 - gz.y));
    eye = mix(eye, uIris, 1.0 - sstep(0.0044, 0.0051, ir));
    eye = mix(eye, vec3(0.015), 1.0 - sstep(0.0017, 0.0023, ir));
    eye += vec3(0.55) * (1.0 - sstep(0.0, 0.0009, length(vec2(ex - 0.0015 - gz.x * side * 0.35, ey - 0.0017 - gz.y * 0.35))));
    eye *= 0.72 + 0.28 * sstep(topLid + 0.0002, topLid - 0.0022, ey);
    c = mix(c, eye, inEye);
    // Lashes on the upper lid, a crease above it, a soft shadow under the lower lid.
    float lash = (1.0 - sstep(0.0005, 0.0015, abs(ey - topLid))) * step(0.02, shape);
    c = mix(c, vec3(0.05, 0.04, 0.04), lash * 0.95);
    float crease = (1.0 - sstep(0.0004, 0.0012, abs(ey - eh * sqrt(shape) - 0.0032))) * step(0.1, shape);
    c = mix(c, uSkinShade, crease * 0.6 * (1.0 - blink));
    c = mix(c, uSkinShade, (1.0 - sstep(0.0, 0.003, abs(ey - botLid + 0.0016))) * step(0.1, shape) * 0.3);
    // Brows: soft, straight or bold; raised or drawn together by the expression.
    float bx = abs(b.x);
    float arch = uBrow > 1.5 ? 0.0 : (uBrow > 0.5 ? -0.0015 : -0.0035) * sq((bx - 0.03) / 0.02);
    float browY = EYE_Y + 0.0172 + uExpr.x * 0.004 + arch - max(0.0, -uExpr.x) * 0.004 * (1.0 - sstep(0.012, 0.03, bx));
    float thick = uBrow > 1.5 ? 0.0034 : uBrow > 0.5 ? 0.0027 : 0.0022;
    thick *= 1.0 - 0.45 * sstep(0.035, 0.052, bx);
    float brow = (1.0 - sstep(thick, thick + 0.0011, abs(b.y - browY))) * sstep(0.008, 0.012, bx) * (1.0 - sstep(0.049, 0.054, bx));
    c = mix(c, uHair * 0.85, brow * 0.92);
    // Nostrils and the shade beside the nose.
    // Lips: upper darker, lower fuller and lighter; the expression lifts or drops the corners and opens the mouth.
    float mx = abs(b.x);
    float my = EYE_Y - 0.072 + uExpr.y * 0.0045 * sq(mx / 0.022);
    float d = b.y - my;
    float lipW = 1.0 - sstep(0.018, 0.024, mx);
    vec3 lip = mix(uSkinShade, vec3(0.62, 0.3, 0.3), 0.38);
    c = mix(c, lip * 0.78, (1.0 - sstep(0.004, 0.0058, d)) * step(0.0, d) * lipW * 0.9);
    c = mix(c, lip * 1.12, (1.0 - sstep(0.005, 0.0074, -d)) * step(d, 0.0) * lipW * 0.85);
    float open = uExpr.z * 0.008;
    float mouth = (1.0 - sstep(0.0008 + open, 0.0018 + open, abs(d + open * 0.4))) * (1.0 - sstep(0.017, 0.02, mx));
    vec3 inside = mix(vec3(0.12, 0.03, 0.035), vec3(0.88, 0.86, 0.8), step(0.0, d + open * 0.4) * step(0.003, open) * (1.0 - sstep(0.012, 0.014, mx)));
    c = mix(c, inside, mouth * 0.92);
    // Soft shading in the eye sockets and beside the nose, under the lower lip.
    float socket = exp(-sq(ex / 0.017) - sq((ey + 0.001) / 0.012)) * (1.0 - inEye);
    c *= 1.0 - 0.16 * socket;
    c *= 1.0 - 0.1 * exp(-sq((abs(b.x) - 0.017) / 0.006) - sq((b.y - (EYE_Y - 0.055)) / 0.012));
    c *= 1.0 - 0.12 * exp(-sq(b.x / 0.014) - sq((b.y - (EYE_Y - 0.0855)) / 0.004));
    vcRough = 0.6 - 0.07 * exp(-sq(h.x / 0.3) - sq((h.y - 0.35) / 0.25));
  }
  return c;
}
vec3 regionColor(float r, vec3 b) {
  if (r < 0.5) return skinColor(b);
  if (r < 1.5) { vcRough = 0.78; return kitColor(b); }
  if (r < 2.5) {
    vcRough = 0.82;
    float belt = (1.0 - step(0.012, abs(b.y - ${(W('hips').y + 0.025).toFixed(3)}))) * 0.4;
    float seam = (1.0 - sstep(0.001, 0.002, abs(abs(b.x) - 0.105 - (1.0 - b.y) * 0.02))) * step(b.y, 0.95) * 0.18;
    return uTrouser * (1.0 - belt - seam);
  }
  if (r < 3.5) { vcRough = 0.48; return mix(vec3(0.93), uSecondary, step(0.03, b.y) * step(b.y, 0.05) * step(0.02, abs(b.x - sign(b.x) * 0.095))); }
  if (r < 4.5) {
    vcRough = 0.58;
    float accent = sstep(0.074, 0.08, abs(abs(b.x) - 0.095));
    return mix(vec3(0.95, 0.95, 0.96), uSecondary * 0.9, accent * 0.45) * (0.96 + 0.04 * sin(b.y * 400.0));
  }
  if (r < 5.5) { vcRough = 0.6; return mix(vec3(0.96), uSecondary, step(0.55, fract(b.y * 26.0)) * step(b.y, 0.97) * step(0.9, b.y) * 0.7); }
  if (r < 6.5) {
    vcRough = 0.22;
    vec3 h = (b - HC) / HR;
    float ridge = (1.0 - sstep(0.006, 0.009, abs(b.x))) * step(0.3, h.y) * step(h.z, 1.4);
    return mix(uHelmet, uSecondary, ridge);
  }
  if (r < 7.5) { vcRough = 0.3; vcMetal = 0.85; return vec3(0.7, 0.72, 0.76); }
  if (r < 8.5) {
    vcRough = 0.72;
    vec3 h = (b - HC) / HR;
    float piping = (1.0 - sstep(0.0018, 0.003, abs(b.x))) * step(0.35, h.y) * step(0.0, h.z + 0.6);
    float seams = (1.0 - sstep(0.0012, 0.0022, abs(abs(b.x) - abs(b.z - HC.z) * 0.9))) * step(0.5, h.y);
    return mix(uPrimary, uSecondary, clamp(piping + seams * 0.6, 0.0, 1.0));
  }
  if (r < 9.5) { vcRough = 0.85; return uHat; }
  if (r < 10.5) { vcRough = 0.9; return vec3(0.14); }
  if (r < 11.5) {
    vcRough = 0.66;
    float strands = sin((b.y * 1.0 + b.x * 0.35 + b.z * 0.6) * 950.0 + ph12(floor(b.xz * 300.0)) * 6.0) * 0.5 + 0.5;
    return uHair * (0.86 + 0.22 * strands * (1.0 - sstep(0.4, 1.0, fwidth(b.y * 950.0))));
  }
  if (r < 12.5) { vcRough = 0.65; return mix(vec3(0.94, 0.92, 0.86), uSecondary, step(0.92, b.y) * 0.6); }
  if (r < 13.5) { vcRough = 0.85; return vec3(0.11, 0.115, 0.13); }
  if (r < 14.5) { vcRough = 0.95; return vec3(0.07, 0.07, 0.08); }
  if (r < 15.5) { vcRough = 0.35; vcMetal = 0.7; return vec3(0.62); }
  vcRough = 0.75;
  return mix(uSecondary, uPrimary, step(0.82, fract(b.y * 40.0)) * 0.5);
}
`;

function patchPlayer(material: MeshStandardMaterial, uniforms: PlayerUniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uFill: PLAYER_FILL });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float region;\nattribute vec3 bindPos;\nvarying float vRegion;\nvarying vec3 vBind;\n${PLAYER_VERTEX}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvRegion = region;\nvBind = bindPos;\n${PLAYER_VARIANTS}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PLAYER_FRAGMENT_COMMON}`)
      // A touch of contact shadow at the feet grounds the player (bind-pose height, so it moves with the legs).
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = regionColor(vRegion, vBind) * mix(0.74, 1.0, smoothstep(0.0, 0.3, vBind.y));')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vcRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vcMetal;')
      // Skin: soft wrap lighting (light reaches round the form, warmer where it wraps).
      .replace(
        'vec3 irradiance = dotNL * directLight.color;',
        `float wrapNL = saturate( ( dot( geometryNormal, directLight.direction ) + vcWrap ) / ( 1.0 + vcWrap ) );
	vec3 irradiance = ( vcWrap > 0.001 ? wrapNL * mix( vec3( 1.0 ), vec3( 1.0, 0.74, 0.64 ), vcWrap * ( 1.0 - dotNL ) * 0.6 ) : vec3( dotNL ) ) * directLight.color;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
// Floodlight rim and broadcast fill (night readability; lower by day): a fresnel edge brighter on upward-facing
// surfaces, and dark kits keep their colour on the shadow side.
vec3 vcUpW = inverseTransformDirection(normal, viewMatrix);
float vcUp = clamp(vcUpW.y * 0.5 + 0.5, 0.0, 1.0);
float rimF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.4);
totalEmissiveRadiance += (mix(vec3(0.3, 0.42, 0.7), vec3(0.62, 0.72, 0.9), vcUp) * rimF * (0.28 + 0.24 * vcUp) + diffuseColor.rgb * rimF * 0.12) * uFill;
totalEmissiveRadiance += diffuseColor.rgb * mix(vec3(0.05, 0.08, 0.06), vec3(0.1, 0.11, 0.16), vcUp) * 0.6 * uFill;
totalEmissiveRadiance += uGhost * uGhostAmt;`,
      );
  };
  material.customProgramCacheKey = () => 'vande-player-v5';
}

function createPlayerMaterial(): { material: MeshStandardMaterial; uniforms: PlayerUniforms } {
  const uniforms: PlayerUniforms = {
    uPrimary: { value: new Color('#3b2fc9') },
    uSecondary: { value: new Color('#19d3fa') },
    uTrouser: { value: new Color('#1a1650') },
    uSkin: { value: new Color('#b07650') },
    uSkinShade: { value: new Color('#94593a') },
    uHair: { value: new Color('#141012') },
    uIris: { value: new Color('#3a2414') },
    uHelmet: { value: new Color('#141a3a') },
    uHat: { value: new Color('#e9e4d4') },
    uPattern: { value: 0 },
    uBeard: { value: 0 },
    uHairline: { value: 1 },
    uFace: { value: 1 },
    uHairStyle: { value: 0 },
    uBeardMesh: { value: 0 },
    uHeadgear: { value: 0 },
    uHairUnder: { value: 0 },
    uBrow: { value: 1 },
    uEyes: { value: 1 },
    uExpr: { value: [0, 0, 0, 0] },
    uTime: PLAYER_CLOCK,
    uBlinkPhase: { value: 0 },
    uLidL: { value: -1 },
    uLidR: { value: -1 },
    uGaze: { value: [0, 0] },
    uGhost: { value: new Color('#000000') },
    uGhostAmt: { value: 0 },
  };
  const material = new MeshStandardMaterial({ roughness: 0.7, metalness: 0.0 });
  patchPlayer(material, uniforms);
  return { material, uniforms };
}

/** The shadow pass sees the same variants (hidden hair and headgear cast no shadow). */
function playerDepthMaterial(uniforms: PlayerUniforms): MeshDepthMaterial {
  const m = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${PLAYER_VERTEX}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${PLAYER_VARIANTS}`);
  };
  m.customProgramCacheKey = () => 'vande-player-depth-v1';
  return m;
}

// ---------------------------------------------------------------------------------------------------------------
// Player instances
// ---------------------------------------------------------------------------------------------------------------

/** Umpires: neutral, original clothing; a dark navy shirt (they stand behind the bowler's arm), charcoal trousers. */
const UMPIRE_SHIRT = new Color('#1d2742');
const UMPIRE_TROUSER = new Color('#2c2e35');
const UMPIRE_HAT = new Color('#1f2944');

export interface PlayerRig {
  root: Group;
  lod: LOD;
  bones: Bone[];
  boneMap: Record<BoneName, Bone>;
  skeleton: Skeleton;
  meshes: SkinnedMesh[];
  uniforms: PlayerUniforms;
  material: MeshStandardMaterial;
  /** Coach Mode's ghost material (translucent, compiled with the rig through a hidden twin mesh). */
  ghostMaterial: MeshStandardMaterial;
  gear: Gear;
  lookKey: string;
  scale: number;
  headgear: Headgear;
}

export function createRig(gear: Gear, lodDistance: number): PlayerRig {
  const bones: Bone[] = [];
  const boneMap = {} as Record<BoneName, Bone>;
  for (const def of SKELETON) {
    const b = new Bone();
    b.name = def.name;
    b.position.set(...def.offset);
    if (def.parent) boneMap[def.parent].add(b);
    bones.push(b);
    boneMap[def.name] = b;
  }
  const { material, uniforms } = createPlayerMaterial();
  const ghostMaterial = new MeshStandardMaterial({ roughness: 0.7, metalness: 0, transparent: true, depthWrite: false, opacity: 0.4 });
  patchPlayer(ghostMaterial, uniforms);
  const depth = playerDepthMaterial(uniforms);
  const root = new Group();
  root.add(boneMap.hips);
  root.updateMatrixWorld(true);
  // Inverses must be computed from the rest pose with world matrices up to date.
  const skeleton = new Skeleton(bones);
  skeleton.calculateInverses();
  const lod = new LOD();
  const meshes: SkinnedMesh[] = [];
  ([0, 1] as const).forEach((level) => {
    const m = new SkinnedMesh(buildGeometry(level, gear), material);
    m.frustumCulled = false;
    m.bind(skeleton, new Matrix4());
    m.castShadow = level === 0;
    m.customDepthMaterial = depth;
    meshes.push(m);
    lod.addLevel(m, level === 0 ? 0 : lodDistance);
  });
  root.add(lod);
  // A hidden twin with the ghost material, so its program is compiled with the scene (never on first use).
  const twin = new SkinnedMesh(buildGeometry(1, gear), ghostMaterial);
  twin.bind(skeleton, new Matrix4());
  twin.visible = false;
  twin.frustumCulled = false;
  twin.name = 'ghost-warmup';
  root.add(twin);
  const headgear: Headgear = gear === 'batter' || gear === 'keeper' ? (gear === 'keeper' ? 'cap' : 'helmet') : gear === 'umpire' ? 'sunhat' : gear === 'bowler' ? 'none' : 'cap';
  const rig: PlayerRig = { root, lod, bones, boneMap, skeleton, meshes, uniforms, material, ghostMaterial, gear, lookKey: '', scale: 1, headgear };
  setRigHeadgear(rig, headgear);
  return rig;
}

const IRISES = ['#2a1a10', '#3a2414', '#4a2f1a', '#2d2318', '#3d3022'];
const EYES = { round: 0, almond: 1, narrow: 2 } as const;
const BROWS = { soft: 0, straight: 1, bold: 2 } as const;
const BEARD_PAINT = { none: 0, stubble: 0.32, moustache: 0.2, short: 0.62, full: 0.9 } as const;

/** Applies colours, proportions and the face for a look (kit + generated traits). */
export function dressRig(rig: PlayerRig, look: Look, kit: KitSpec) {
  const key = `${look.seed}|${look.scale ?? ''}|${kit.id}|${kit.primary}|${kit.secondary}|${kit.pattern}`;
  if (rig.lookKey === key) return;
  rig.lookKey = key;
  const tr = avatarTraits(look.seed);
  const u = rig.uniforms;
  const h = hash32(`face:${look.seed}`);
  u.uSkin.value.set(tr.skin);
  u.uSkinShade.value.set(tr.skinShade);
  u.uHair.value.set(tr.hair);
  u.uIris.value.set(IRISES[h % IRISES.length]);
  u.uBeard.value = BEARD_PAINT[tr.beard];
  u.uBeardMesh.value = tr.beard === 'full' ? 1 : 0;
  u.uHairline.value = tr.hairStyle === 'shaved' ? 0 : 1;
  u.uHairStyle.value = HAIR_STYLES.indexOf(tr.hairStyle);
  u.uEyes.value = EYES[tr.eyes];
  u.uBrow.value = BROWS[tr.brow];
  u.uBlinkPhase.value = ((h >>> 8) % 1000) / 1000;
  if (look.gear === 'umpire') {
    u.uPrimary.value.copy(UMPIRE_SHIRT);
    u.uSecondary.value.copy(UMPIRE_SHIRT).multiplyScalar(1.25);
    u.uTrouser.value.copy(UMPIRE_TROUSER);
    u.uHat.value.copy(UMPIRE_HAT);
    u.uPattern.value = 0;
  } else {
    u.uPrimary.value.set(kit.primary);
    u.uSecondary.value.set(kit.secondary);
    u.uTrouser.value.set(kit.primary).multiplyScalar(0.42);
    u.uHat.value.set('#ece6d4');
    u.uPattern.value = PATTERN_ID[kit.pattern];
  }
  u.uHelmet.value.set(kit.primary).multiplyScalar(0.35).offsetHSL(0, -0.1, 0.02);
  // Fielders: a cap, a sun hat, bareheaded or a patka, from the look (keepers and batters are set by the stage).
  if (look.gear === 'fielder') setRigHeadgear(rig, tr.headwear === 'patka' ? 'patka' : tr.headwear === 'cap' ? 'cap' : tr.headwear === 'band' ? 'sunhat' : (h >>> 4) % 3 === 0 ? 'none' : 'cap');
  rig.scale = look.scale ?? tr.height;
  rig.root.scale.setScalar(rig.scale);
}

/**
 * Headgear for a rig: the keeper wears a helmet standing up to the stumps and a cap standing back (default cap);
 * fielders a cap, sun hat, nothing or a patka. Other gears keep theirs. Hair is pressed under anything worn.
 */
export function setRigHeadgear(rig: PlayerRig, headgear: Headgear) {
  const option = HEADGEAR_OPTION[rig.gear][headgear];
  if (option === undefined) return;
  rig.headgear = headgear;
  rig.uniforms.uHeadgear.value = option;
  rig.uniforms.uHairUnder.value = headgear === 'none' ? 0 : 1;
}

export type Expression = 'neutral' | 'concentration' | 'effort' | 'frustration' | 'relief' | 'celebration';
/** [brow raise (+) / frown (−), smile (+) / grimace (−), mouth open, eyes squeezed] per expression at full weight. */
const EXPRESSIONS: Record<Expression, [number, number, number, number]> = {
  neutral: [0, 0, 0, 0],
  concentration: [-0.6, -0.1, 0, 0.35],
  effort: [-0.9, -0.5, 0.45, 0.6],
  frustration: [-1, -0.8, 0.15, 0.2],
  relief: [0.7, 0.6, 0.25, 0],
  celebration: [0.9, 1, 0.9, 0.25],
};

/** A facial expression (close-ups, dead-ball reactions), blended by `weight` 0..1. */
export function setRigExpression(rig: PlayerRig, expression: Expression, weight = 1) {
  const e = EXPRESSIONS[expression] ?? EXPRESSIONS.neutral;
  const w = Math.min(1, Math.max(0, weight));
  rig.uniforms.uExpr.value = [e[0] * w, e[1] * w, e[2] * w, e[3] * w];
}

/**
 * The Director's face for a rig this frame (director/face.ts FACE: the lids and the iris offset), or null: the rig goes
 * back to the periodic blink and a centred iris, which is what every rig that is not directed always draws. Cheap: four
 * uniform writes for a directed rig, one comparison for the rest.
 */
export function setRigFace(rig: PlayerRig, face: { valid: boolean; lidL: number; lidR: number; gx: number; gy: number; ex?: number; ey?: number; ez?: number; ew?: number } | null) {
  const u = rig.uniforms;
  if (!face || !face.valid) {
    if (u.uLidL.value >= 0) {
      u.uLidL.value = -1;
      u.uLidR.value = -1;
      u.uGaze.value[0] = 0;
      u.uGaze.value[1] = 0;
      // the expression the Director mixed (P3) goes with it; a rig it never directed keeps whatever setRigExpression gave it
      const x = u.uExpr.value;
      x[0] = x[1] = x[2] = x[3] = 0;
    }
    return;
  }
  u.uLidL.value = Math.min(1, Math.max(0, face.lidL));
  u.uLidR.value = Math.min(1, Math.max(0, face.lidR));
  u.uGaze.value[0] = face.gx;
  u.uGaze.value[1] = face.gy;
  const x = u.uExpr.value;
  x[0] = face.ex ?? 0;
  x[1] = face.ey ?? 0;
  x[2] = face.ez ?? 0;
  x[3] = face.ew ?? 0;
}

const HEAD_Q = new Float64Array(20);
const HEAD_FRAME = { heading: 0, bowler: false };

/** The neck's and head's last finished rotations on this rig and the speeds they moved at (see `limitHead`). */
interface HeadMemory {
  t: number;
  q: Float64Array;
  s: Float64Array;
  /** The same three as they were when the frame at `t` began (its pass may run again: see `limitHead`). */
  pt: number;
  pq: Float64Array;
  ps: Float64Array;
}
const HEAD_MEMORY = new WeakMap<PlayerRig, HeadMemory>();
/**
 * MOTION-SPEC §9: the neck and head turn at most 720 deg/s and change their speed by at most 300 deg/s from one 60 Hz frame
 * to the next (18,000 deg/s^2). The limit keeps them to 600 deg/s (83%) and lets a speed grow by at most 5,000 deg/s^2 (83
 * deg/s a frame): measured over the 192 strikers and the bowlers (probe p4-headcaps) 0 frames pass the speed cap; the
 * change-of-speed cap is passed in a few frames where the trunk the neck stabilises against passes it itself (the stroke's
 * trunk turn is 1.68 times its own cap in the baseline). The neck and head also never arrive faster than they can brake
 * (when `brake` is set for the frame: the striker's always, the bowler's from 150 ms after the ball has left his hand, face.ts
 * `BRAKE`; a brake that comes on while his head is still fast and near its target is a step of its own): the speed is held
 * to the one from which slowing by `HEAD_LIMIT.brake` (6,000 deg/s^2: 100 deg/s a frame, a third of the cap) every frame
 * still stops them within the angle that is left, so a head swing ends in a few frames instead of stopping dead from 600
 * deg/s (that is 600 deg/s of change in one frame). Over the 192-delivery corpus 0 frames pass the change-of-speed cap
 * (striker 22 and bowler 93 frames did without it). Not for the bowler before the release: his neck and head counter-rotate
 * a trunk that turns at 500 deg/s through the delivery stride to stay on the batter, and the stopping distance a brake needs
 * at that speed (18 degrees) would take them off him (probe p9: within 10 degrees of the batter in 90% of the frames with a
 * brake, 100% without). A bone remembered from a frame at most `memoryMs` earlier is
 * continued; a longer gap (a seek, a new shot) starts afresh. Tunable for the probes.
 */
export const HEAD_LIMIT = { speed: 600, accel: 5000, brake: 6000, memoryMs: 50 };

/**
 * Holds the finished neck and head to the §9 caps: from the last frame's rotation (a frame at most HEAD_MEMORY_MS
 * before, on this rig) each bone turns by no more than the speed cap allows and than its last speed plus the
 * acceleration cap allows; the head then lags the plan's head in space for those few frames and catches up. The clip's
 * own neck and head are inside the caps (551 and 474 deg/s over the 192-delivery corpus); the stroke's trunk is not
 * (its turn passes 600 deg/s) and counter-rotating it exactly would put the difference into the neck and the head.
 * Returns whether a bone was held back.
 */
function limitHead(rig: PlayerRig, t: number, brake: boolean): boolean {
  let mem = HEAD_MEMORY.get(rig);
  if (!mem) HEAD_MEMORY.set(rig, (mem = { t: Number.NaN, q: new Float64Array(8), s: new Float64Array(2), pt: Number.NaN, pq: new Float64Array(8), ps: new Float64Array(2) }));
  // The same frame posed again (a second pass of one frame: a camera that reads the posed bones and draws, a probe, a seek to the
  // frame just shown) starts from where the frame began, as the first pass did. Otherwise its dt is 0, it is not continued and nothing
  // is held: the second pass would draw the head the first pass had held back, at any speed (the 106 degrees a frame of the reel's
  // camera pass), and the frame would depend on how many times it was posed.
  if (Math.abs(t - mem.t) < 0.5 && !Number.isNaN(mem.pt)) {
    mem.t = mem.pt;
    mem.q.set(mem.pq);
    mem.s.set(mem.ps);
  } else {
    mem.pt = mem.t;
    mem.pq.set(mem.q);
    mem.ps.set(mem.s);
  }
  const dt = t - mem.t;
  const continued = dt > 0.5 && dt <= HEAD_LIMIT.memoryMs;
  let held = false;
  for (let b = 0; b < 2; b++) {
    const bone = rig.bones[3 + b].quaternion;
    const o = b * 4;
    let ang = 0;
    if (continued) {
      const d = Math.abs(mem.q[o] * bone.x + mem.q[o + 1] * bone.y + mem.q[o + 2] * bone.z + mem.q[o + 3] * bone.w);
      ang = 2 * Math.acos(d > 1 ? 1 : d) * (180 / Math.PI);
      // the speed v from which braking by dv a frame (v, v - dv, v - 2 dv, ...) just stops within `ang`: dt (v^2 / 2 dv + v / 2) = ang
      const dtS = dt / 1000;
      const dv = HEAD_LIMIT.brake * dtS;
      const sStop = brake ? 0.5 * (Math.sqrt(dv * dv + (8 * dv * ang) / dtS) - dv) : Number.POSITIVE_INFINITY;
      const sMax = Math.min(HEAD_LIMIT.speed, mem.s[b] + HEAD_LIMIT.accel * dtS, sStop);
      const step = (sMax * dt) / 1000;
      if (ang > step && ang > 1e-9) {
        // slerp from the last rotation towards the new one by step / ang
        const k = step / ang;
        const sign = mem.q[o] * bone.x + mem.q[o + 1] * bone.y + mem.q[o + 2] * bone.z + mem.q[o + 3] * bone.w < 0 ? -1 : 1;
        const nx = sign * bone.x, ny = sign * bone.y, nz = sign * bone.z, nw = sign * bone.w;
        const dot = Math.min(1, mem.q[o] * nx + mem.q[o + 1] * ny + mem.q[o + 2] * nz + mem.q[o + 3] * nw);
        const th = Math.acos(dot);
        const sn = Math.sin(th) || 1;
        const a = Math.sin((1 - k) * th) / sn;
        const c = Math.sin(k * th) / sn;
        bone.set(a * mem.q[o] + c * nx, a * mem.q[o + 1] + c * ny, a * mem.q[o + 2] + c * nz, a * mem.q[o + 3] + c * nw).normalize();
        ang = step;
        held = true;
      }
    }
    mem.s[b] = continued ? (ang * 1000) / dt : 0;
    mem.q[o] = bone.x; mem.q[o + 1] = bone.y; mem.q[o + 2] = bone.z; mem.q[o + 3] = bone.w;
  }
  mem.t = t;
  return held;
}

/**
 * The Director's head pass on a rig whose bones are finished (after the arm IK and the glove solve have leaned the
 * trunk): measures where the head points, turns the neck and head to the plan's head in space as far as the neck can
 * turn (director/stage/pose.ts), holds them to the §9 caps, and fills `FACE` with the lids and the iris from the head
 * as it ends up. Does nothing (and leaves `FACE` invalid) unless the Director's life pass sampled a plan for this actor
 * this call (director/stage/face.ts FRAME.head).
 */
export function applyDirectedHead(rig: PlayerRig): void {
  const h = FRAME.head;
  if (!h.on) return;
  for (let i = 0; i < 5; i++) {
    const q = rig.bones[i].quaternion;
    HEAD_Q[i * 4] = q.x;
    HEAD_Q[i * 4 + 1] = q.y;
    HEAD_Q[i * 4 + 2] = q.z;
    HEAD_Q[i * 4 + 3] = q.w;
  }
  const frame = HEAD_FRAME;
  frame.heading = FRAME.heading;
  frame.bowler = h.bowler;
  turnHead(HEAD_Q, h.ch, frame, h.rm, h.w, h.seam);
  rig.bones[3].quaternion.set(HEAD_Q[12], HEAD_Q[13], HEAD_Q[14], HEAD_Q[15]);
  rig.bones[4].quaternion.set(HEAD_Q[16], HEAD_Q[17], HEAD_Q[18], HEAD_Q[19]);
  DIRECTOR_HEAD.limited = limitHead(rig, FRAME.t, h.brake);
  for (let i = 3; i < 5; i++) {
    const q = rig.bones[i].quaternion;
    HEAD_Q[i * 4] = q.x;
    HEAD_Q[i * 4 + 1] = q.y;
    HEAD_Q[i * 4 + 2] = q.z;
    HEAD_Q[i * 4 + 3] = q.w;
  }
  // A delivery's first frames have no plan yet (it is baked in the spare time of the run-up): the head is only continued from the
  // scene before (the seam) and remembered; the lids and the iris stay the rig's own.
  if (h.ch) eyesFor(HEAD_Q, h.ch, frame, h.rm);
  else noteDrawn(HEAD_Q, frame);
  rig.bones[3].updateWorldMatrix(true, true);
}

/**
 * The bowler's arms once the ball has left his hand: the built-in clips he chases, throws and celebrates with aim an arm by the shortest
 * swing to a direction, and an arm aimed past straight up spins about its own length in a few frames (46 degrees a frame at the top
 * of a celebration for an arm that points 15 degrees further each frame); a cross-fade to a clip that does not aim an arm used to put
 * it down in one frame (see clips.blendAim). Every arm bone is held to `speed` degrees a second from the frame before, the pose that
 * ends up being the aim's, a few frames late at the worst. MOTION-SPEC section 9 caps a bowling or throwing arm at 1800 degrees a second
 * in the packs' clips; 1440 is 24 degrees a frame. The stage uses it for the bowler only, and only after the release has been drawn
 * (the batters' arms are held to the bat, the bowler's to the release point). A bone remembered from a frame at most `memoryMs`
 * earlier is continued, a longer gap (a seek, a new shot) starts afresh, and a frame posed again starts from where it began.
 */
export const ARM_LIMIT = { speed: 1440, memoryMs: 50 };
const ARM_BONES = [5, 6, 7, 8, 9, 10] as const;

interface ArmMemory {
  t: number;
  q: Float64Array;
  pt: number;
  pq: Float64Array;
}
const ARM_MEMORY = new WeakMap<PlayerRig, ArmMemory>();

/** Holds the finished arm bones to `ARM_LIMIT.speed` from the frame before. Returns whether a bone was held back. */
export function limitArms(rig: PlayerRig, t: number): boolean {
  let mem = ARM_MEMORY.get(rig);
  if (!mem) ARM_MEMORY.set(rig, (mem = { t: Number.NaN, q: new Float64Array(24), pt: Number.NaN, pq: new Float64Array(24) }));
  if (Math.abs(t - mem.t) < 0.5 && !Number.isNaN(mem.pt)) {
    mem.t = mem.pt;
    mem.q.set(mem.pq);
  } else {
    mem.pt = mem.t;
    mem.pq.set(mem.q);
  }
  const dt = t - mem.t;
  const continued = dt > 0.5 && dt <= ARM_LIMIT.memoryMs;
  const step = (ARM_LIMIT.speed * dt) / 1000;
  let held = false;
  for (let b = 0; b < ARM_BONES.length; b++) {
    const bone = rig.bones[ARM_BONES[b]].quaternion;
    const o = b * 4;
    if (continued) {
      const dot = mem.q[o] * bone.x + mem.q[o + 1] * bone.y + mem.q[o + 2] * bone.z + mem.q[o + 3] * bone.w;
      const ang = 2 * Math.acos(Math.abs(dot) > 1 ? 1 : Math.abs(dot)) * (180 / Math.PI);
      if (ang > step && ang > 1e-9) {
        const k = step / ang;
        const sign = dot < 0 ? -1 : 1;
        const nx = sign * bone.x, ny = sign * bone.y, nz = sign * bone.z, nw = sign * bone.w;
        const th = Math.acos(Math.min(1, mem.q[o] * nx + mem.q[o + 1] * ny + mem.q[o + 2] * nz + mem.q[o + 3] * nw));
        const sn = Math.sin(th) || 1;
        const a = Math.sin((1 - k) * th) / sn;
        const c = Math.sin(k * th) / sn;
        bone.set(a * mem.q[o] + c * nx, a * mem.q[o + 1] + c * ny, a * mem.q[o + 2] + c * nz, a * mem.q[o + 3] + c * nw).normalize();
        held = true;
      }
    }
    mem.q[o] = bone.x; mem.q[o + 1] = bone.y; mem.q[o + 2] = bone.z; mem.q[o + 3] = bone.w;
  }
  mem.t = t;
  if (held) {
    rig.bones[5].updateWorldMatrix(false, true);
    rig.bones[8].updateWorldMatrix(false, true);
  }
  return held;
}

/** Solid shadow state captured only across an actual ghost interval (profiles can legitimately disable shadows). */
const ghostShadowState = new WeakMap<PlayerRig, boolean[]>();

/** Applies the active profile's solid shadow policy without making a currently translucent teaching ghost cast. */
export function setRigShadowPolicy(rig: PlayerRig, shadows: boolean) {
  const desired = rig.meshes.map((_mesh, index) => shadows && index === 0);
  const restore = ghostShadowState.get(rig);
  if (restore) {
    restore.splice(0, restore.length, ...desired);
    for (const mesh of rig.meshes) mesh.castShadow = false;
    return;
  }
  rig.meshes.forEach((mesh, index) => (mesh.castShadow = desired[index]));
}

/**
 * A translucent ghost of a rig (Coach Mode's demonstration batter), or back to solid (null). The ghost keeps the kit's
 * shading, tinted towards `color`, and draws after the solid players without writing depth. It swaps to the rig's
 * own ghost material (compiled with the rig at mount), so showing a ghost never compiles a shader.
 */
export function setRigGhost(rig: PlayerRig, ghost: { color: string; opacity: number } | null) {
  const u = rig.uniforms;
  if (ghost) {
    if (!ghostShadowState.has(rig)) ghostShadowState.set(rig, rig.meshes.map((mesh) => mesh.castShadow));
    u.uGhost.value.set(ghost.color);
    u.uGhostAmt.value = 0.35;
    rig.ghostMaterial.opacity = Math.min(1, Math.max(0.05, ghost.opacity));
  } else {
    u.uGhost.value.set('#000000');
    u.uGhostAmt.value = 0;
  }
  const restoreShadows = ghost ? null : ghostShadowState.get(rig);
  for (const mesh of rig.meshes) {
    mesh.material = ghost ? rig.ghostMaterial : rig.material;
    mesh.renderOrder = ghost ? 6 : 0;
    if (ghost) mesh.castShadow = false;
    else if (restoreShadows) mesh.castShadow = restoreShadows[rig.meshes.indexOf(mesh)] ?? false;
  }
  if (!ghost && restoreShadows) ghostShadowState.delete(rig);
}

// ---------------------------------------------------------------------------------------------------------------
// Posing and IK
// ---------------------------------------------------------------------------------------------------------------

const tmpQ = new Quaternion();
const tmpQ2 = new Quaternion();
const tmpQ3 = new Quaternion();
const tmpV = new Vector3();
const tmpV2 = new Vector3();
const tmpV3 = new Vector3();
const DOWN = new Vector3(0, -1, 0);

export function applyPose(rig: PlayerRig, pose: SampledPose) {
  const q = pose.q;
  for (let i = 0; i < BONE_NAMES.length; i++) {
    rig.bones[i].quaternion.set(q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3]);
  }
  const hips = rig.boneMap.hips;
  hips.position.set(pose.root[0], SKELETON[0].offset[1] + pose.root[1], pose.root[2]);
}

/**
 * Rotates `bone` (swing only) so its rest axis (local -Y) points along world direction `dir`; with `weight` below 1, that part of the
 * way from where the clip's own pose has it (the same swing turned by that share: the arm in a cross-fade between a clip that aims it
 * and one that does not).
 */
function aimBone(bone: Object3D, dir: Vector3, weight = 1) {
  bone.updateWorldMatrix(true, false);
  bone.getWorldQuaternion(tmpQ);
  const cur = tmpV.copy(DOWN).applyQuaternion(tmpQ).normalize();
  tmpQ2.setFromUnitVectors(cur, tmpV2.copy(dir).normalize());
  if (weight < 1) tmpQ2.slerp(tmpQ3.identity(), 1 - (weight < 0 ? 0 : weight));
  tmpQ.premultiply(tmpQ2);
  const parent = bone.parent!;
  parent.getWorldQuaternion(tmpQ2);
  bone.quaternion.copy(tmpQ2.invert().multiply(tmpQ));
  bone.updateMatrixWorld(true);
}

/** Arm aim in the actor's root frame (phi: 0 down, 90 back, 180 up, 270 forward; lateral: outwards). */
export function applyAim(rig: PlayerRig, side: 'L' | 'R', phiDeg: number, lateralDeg: number, weight = 1) {
  const phi = (phiDeg * Math.PI) / 180;
  const lat = (lateralDeg * Math.PI) / 180;
  const sx = side === 'L' ? 1 : -1;
  const d = tmpV3.set(sx * Math.sin(lat), -Math.cos(phi) * Math.cos(lat), -Math.sin(phi) * Math.cos(lat));
  d.applyQuaternion(rig.root.getWorldQuaternion(tmpQ2));
  aimBone(rig.boneMap[`upperArm${side}`], d.clone(), weight);
}

/** The upper arm's twist about its own length (§9: within 110°). */
const UPPER_ARM_TWIST_MAX_DEG = 105;
/** The wrist's swing (the hand's long axis off the forearm's) the arm solve keeps within, given the hand (§9: 85°). */
const WRIST_SWING_MAX_DEG = 80;
/** MOTION-SPEC §9's own limits for the two (the solver's ranges keep 5° inside them). */
const UPPER_ARM_TWIST_LAW_DEG = 110;
const WRIST_SWING_LAW_DEG = 85;

/**
 * What one arm remembers of its last frame (round 8): its upper arm's rotation in the chest's frame at the end of the
 * last solve. The two §9 ranges (upper-arm twist, wrist swing) leave the elbow two windows to sit in, and a solve from
 * the pole alone flips between them as the demanded twist crosses 180° (the striker's left elbow jumped 21 cm for three
 * frames in the trigger, in every external view). In a run of frames (each within ELBOW_MEMORY_MS of the one before)
 * the next solve therefore starts from the swivel that keeps the upper arm nearest to where it was, and eases back to
 * the pole's at ELBOW_HOME_DEG_PER_S once the ranges allow it. A seek, a new script or a first frame has no memory: the
 * arm is then solved from the pole alone, as it always was. The hand is on its target for every swivel, so this moves
 * the elbow and nothing else.
 */
interface ElbowMemory {
  /** The scene time (ms) of the frame being solved, the time since the frame before it, and that frame's end state. */
  stamp: number;
  dtMs: number;
  prev: Quaternion | null;
  /** The upper arm's rotation after the latest solve of this frame (it becomes `prev` at the next frame). */
  now: Quaternion | null;
  /**
   * The glove's roll round the handle from the orthodox grip (rad), as it ended the last frame (`rollPrev`; null: none) and as it
   * stands in this frame so far (`rollNow`). See relaxGrip.
   */
  rollPrev: number | null;
  rollNow: number | null;
  /** The turn `want` of the forearm round the handle (relaxGrip) at the end of the last frame and in this one so far. */
  wantPrev: number | null;
  wantNow: number | null;
}
/** A remembered elbow is used only when the last frame was at most this long ago (ms): 20 fps and faster. */
const ELBOW_MEMORY_MS = 50;
/** How fast the swivel eases back to the pole's (deg/s): about 3° a frame at 60 fps, 1 cm of elbow. */
const ELBOW_HOME_DEG_PER_S = 180;
const ELBOW_MEMORY = new WeakMap<PlayerRig, Record<'L' | 'R', ElbowMemory>>();

/** The top hand's weight on the handle as last drawn, and the stamp of that frame. */
interface TopHandMemory {
  stamp: number;
  weight: number;
}
const TOP_HAND_MEMORY = new WeakMap<PlayerRig, TopHandMemory>();
/** The top glove lets go of the bat, or takes it, over this long at most (ms) once a frame follows another. */
const TOP_HAND_LET_GO_MS = 250;
const TOP_HAND_TAKE_MS = 120;

/**
 * The top hand's weight on the handle this frame: the clip's (or 1 for the physics bat), but never changing faster than
 * the glove can let go or take hold (round 8). The external bat hands over to the clip's key over 320 ms, and the clip
 * (bat_run, bat_rest) often carries it one-handed: the weight used to drop 1 → 0 in one frame there and the top arm
 * (an elbow 30 cm away, the trunk's lean after it) with it. A seek, a new script or a first frame takes the target.
 */
function easeTopHand(rig: PlayerRig, stamp: number | undefined, target: number): number {
  const mem = TOP_HAND_MEMORY.get(rig);
  if (stamp === undefined) {
    TOP_HAND_MEMORY.delete(rig);
    return target;
  }
  let w = target;
  if (mem) {
    const dt = stamp - mem.stamp;
    if (dt === 0) w = mem.weight;
    else if (dt > 0 && dt <= ELBOW_MEMORY_MS) w = Math.max(mem.weight - dt / TOP_HAND_LET_GO_MS, Math.min(mem.weight + dt / TOP_HAND_TAKE_MS, target));
  }
  TOP_HAND_MEMORY.set(rig, { stamp, weight: w });
  return w;
}

/** The chest's and the spine's lean (rotations on top of the clip's, in their own frames) as last drawn, and that frame's stamp. */
interface LeanMemory {
  stamp: number;
  chest: Quaternion;
  spine: Quaternion;
  /** The memory as it was when this frame began (round 9: a frame posed again starts from where it began, as the first pass did). */
  before: LeanMemory | null;
}
const LEAN_MEMORY = new WeakMap<PlayerRig, LeanMemory>();
/** The lean a bone takes on or gives up at most this fast (deg/s) once a frame follows another: under MOTION-SPEC §9's 600°/s. */
const LEAN_MAX_DEG_PER_S = 360;

/**
 * Holds the chest's and spine's lean (what solveGrips added to the clip's rotation to reach the bat) to LEAN_MAX_DEG_PER_S
 * from the frame before (round 8): the bat's first move asked 15° of chest in one frame, 1.4–1.5 times the §9 cap in 5 of
 * 192 deliveries. A seek or a first frame has no frame before and leans as asked. Returns whether a bone was held back (the
 * arms are then solved again). Without the lean the gloves are off the handle by up to 12 cm in those frames; held to the
 * speed, up to a few centimetres for a few frames.
 */
function easeLean(rig: PlayerRig, stamp: number | undefined, base: { chest: Quaternion; spine: Quaternion }): boolean {
  const now: LeanMemory = { stamp: stamp ?? NaN, chest: base.chest.clone().invert().multiply(rig.boneMap.chest.quaternion), spine: base.spine.clone().invert().multiply(rig.boneMap.spine.quaternion), before: null };
  let prev = LEAN_MEMORY.get(rig) ?? null;
  // The same frame posed again (a camera that reads the posed bones and draws, a seek to the frame just shown): its first pass
  // is what the frame before it was held to, so it starts from where the frame began and draws what the first pass drew.
  if (prev && stamp !== undefined && prev.stamp === stamp) prev = prev.before;
  now.before = prev && { ...prev, before: null };
  let held = false;
  if (stamp !== undefined && prev && stamp - prev.stamp > 0 && stamp - prev.stamp <= ELBOW_MEMORY_MS) {
    const maxRad = (LEAN_MAX_DEG_PER_S * (stamp - prev.stamp) * DEG) / 1000;
    for (const name of ['chest', 'spine'] as const) {
      const angle = 2 * Math.acos(Math.min(1, Math.abs(prev[name].dot(now[name]))));
      if (angle <= maxRad) continue;
      now[name] = prev[name].clone().slerp(now[name], maxRad / angle);
      rig.boneMap[name].quaternion.copy(base[name]).multiply(now[name]);
      rig.boneMap[name].updateMatrixWorld(true);
      held = true;
    }
  }
  if (stamp === undefined) LEAN_MEMORY.delete(rig);
  else LEAN_MEMORY.set(rig, now);
  return held;
}

/** Moves both arms' memory on to the frame stamped `stamp` (scene ms; none: no memory) and returns it. */
function nextElbowFrame(rig: PlayerRig, stamp: number | undefined): Record<'L' | 'R', ElbowMemory> {
  let arms = ELBOW_MEMORY.get(rig);
  if (!arms) {
    arms = {
      L: { stamp: NaN, dtMs: 0, prev: null, now: null, rollPrev: null, rollNow: null, wantPrev: null, wantNow: null },
      R: { stamp: NaN, dtMs: 0, prev: null, now: null, rollPrev: null, rollNow: null, wantPrev: null, wantNow: null },
    };
    ELBOW_MEMORY.set(rig, arms);
  }
  for (const m of [arms.L, arms.R]) {
    if (stamp === undefined) {
      m.stamp = NaN;
      m.prev = null;
      m.now = null;
      m.rollPrev = null;
      m.rollNow = null;
      m.wantPrev = null;
      m.wantNow = null;
    } else if (m.stamp !== stamp) {
      // A new frame: last frame's end state is this frame's start, if the last frame is near enough in time.
      const dt = stamp - m.stamp;
      const near = dt > 0 && dt <= ELBOW_MEMORY_MS;
      m.prev = near ? m.now : null;
      m.rollPrev = near ? m.rollNow : null;
      m.wantPrev = near ? m.wantNow : null;
      m.dtMs = dt > 0 ? dt : 0;
      m.stamp = stamp;
      m.now = null;
      m.rollNow = m.rollPrev;
      m.wantNow = m.wantPrev;
    }
  }
  return arms;
}

/**
 * What an arm's elbow solve works from (round 9; reachIK's own first half): the chain for a wrist target and a hand, the
 * upper arm's local rotation for a turn of the elbow's plane about the reach line (`localFor`), its twist (`tw`, deg), the
 * wrist's swing for a turn (`swingOf`, deg; 0 without a hand) and `ref`, the turn that continues the arm's memory. Pure: no
 * bone is changed, so a caller can weigh many turns, and many hands, before it settles one (seekClearance).
 */
interface ArmGeometry {
  upper: Bone;
  fore: Bone;
  hand: Bone;
  th: number;
  handWorld: Quaternion;
  localFor: (phi: number) => Quaternion;
  tw: (q: Quaternion) => number;
  swingOf: (phi: number) => number;
  ref: number;
  /** How far the wrist target lies from where the arm can put the wrist (m; 0 when it can be reached): out of reach, or too near the shoulder for the elbow's range. */
  beyond: number;
}

function armGeometry(rig: PlayerRig, side: 'L' | 'R', target: Vector3, pole: Vector3, handRot: Quaternion | null, memory: ElbowMemory | null): ArmGeometry {
  const upper = rig.boneMap[`upperArm${side}`];
  const fore = rig.boneMap[`forearm${side}`];
  const hand = rig.boneMap[`hand${side}`];
  upper.updateWorldMatrix(true, true);
  // The hand keeps its world orientation (a held ball, a closed glove): the forearm's own twist is not carried over.
  const handWorld = handRot ? handRot.clone() : hand.getWorldQuaternion(new Quaternion());
  const s = new Vector3().setFromMatrixPosition(upper.matrixWorld);
  const e = new Vector3().setFromMatrixPosition(fore.matrixWorld);
  const w = new Vector3().setFromMatrixPosition(hand.matrixWorld);
  const a = s.distanceTo(e);
  const b = e.distanceTo(w);
  const toT = target.clone().sub(s);
  const reachLength = toT.length();
  const d = Math.min(Math.max(reachLength, Math.abs(a - b) + 1e-3), a + b - 1e-3);
  const n = toT.normalize();
  const [lo, hi] = HINGE_RANGE.forearm;
  const bend = (Math.acos(Math.max(-1, Math.min(1, (d * d - a * a - b * b) / (2 * a * b)))) * 180) / Math.PI;
  const th = (Math.max(lo, Math.min(hi, -bend)) * Math.PI) / 180;
  // The chain in the upper arm's frame (both bones along their −Y at rest), and where the elbow points from it.
  const c = new Vector3(0, -a - b * Math.cos(th), -b * Math.sin(th)).normalize();
  const u = new Vector3(0, -a, 0);
  const ml = u.clone().sub(c.clone().multiplyScalar(u.dot(c)));
  if (ml.lengthSq() < 1e-10) ml.set(0, c.z, -c.y);
  ml.normalize();
  // The pole, square to the reach line (a straight arm keeps a sensible elbow: down).
  const m = pole.clone().sub(s);
  m.sub(n.clone().multiplyScalar(m.dot(n)));
  if (m.lengthSq() < 1e-8) m.set(0, -1, 0).sub(n.clone().multiplyScalar(-n.y));
  m.normalize();
  // The upper arm's world rotation: (ĉ, m̂, ĉ×m̂) onto (n̂, p̂, n̂×p̂); the elbow's plane turned about the reach line,
  // as little as it takes, to keep the upper arm's twist within §9 (UPPER_ARM_TWIST_MAX_DEG).
  const L = new Matrix4().makeBasis(c, ml, c.clone().cross(ml)).transpose();
  const parentInv = upper.parent!.getWorldQuaternion(new Quaternion()).invert();
  const localFor = (phi: number) => {
    const mp = m.clone().applyAxisAngle(n, phi);
    const R = new Matrix4().makeBasis(n, mp, n.clone().cross(mp)).multiply(L);
    return parentInv.clone().multiply(new Quaternion().setFromRotationMatrix(R));
  };
  const twistOf = (q: Quaternion) => Math.abs((2 * Math.atan2(q.y, q.w) * 180) / Math.PI + 360) % 360;
  const tw = (q: Quaternion) => {
    const t = twistOf(q);
    return t > 180 ? 360 - t : t;
  };
  // The wrist's swing at a plane turn: the angle between the forearm's long axis (its Y, after the hinge) and the hand's.
  const handY = handRot ? new Vector3(0, 1, 0).applyQuaternion(handRot) : null;
  const foreY = new Vector3(0, Math.cos(th), Math.sin(th));
  const swingOf = (phi: number) => {
    if (!handY) return 0;
    const mp = m.clone().applyAxisAngle(n, phi);
    const y = foreY.clone().applyMatrix4(new Matrix4().makeBasis(n, mp, n.clone().cross(mp)).multiply(L));
    return (Math.acos(Math.max(-1, Math.min(1, y.dot(handY)))) * 180) / Math.PI;
  };
  // Where the plane starts: the pole's (0) or, in a run of frames, the turn that keeps the upper arm nearest to where it
  // was. The arm's rotation is q(phi) = (cos(phi/2) + sin(phi/2)·axis)·q(0), so its dot with the remembered rotation is a
  // sinusoid of phi/2 and the nearest turn is 2·atan2(B, A) (A, B: that sinusoid's two coefficients), eased back to the
  // pole's (0) at ELBOW_HOME_DEG_PER_S.
  let ref = 0;
  if (memory?.prev && handRot) {
    const q0 = localFor(0);
    const axis = n.clone().applyQuaternion(parentInv);
    const A = q0.dot(memory.prev);
    const B = new Quaternion(axis.x, axis.y, axis.z, 0).multiply(q0).dot(memory.prev);
    if (A * A + B * B > 1e-8) {
      ref = Math.atan2(B, A) * 2;
      ref = Math.atan2(Math.sin(ref), Math.cos(ref));
      const home = (((ELBOW_HOME_DEG_PER_S * Math.min(memory.dtMs, ELBOW_MEMORY_MS)) / 1000) * Math.PI) / 180;
      ref -= Math.max(-home, Math.min(home, ref));
    }
  }
  return { upper, fore, hand, th, handWorld, localFor, tw, swingOf, ref, beyond: Math.abs(reachLength - Math.sqrt(Math.max(0, a * a + b * b + 2 * a * b * Math.cos(th)))) };
}

/**
 * The arm's two-bone IK (round 6: hinge-respecting): the forearm turns about its own X only, within the §9 elbow range
 * (HINGE_RANGE.forearm), and the upper arm swings and twists to put the wrist on `target` with the elbow's hinge plane
 * through `pole` (a world point the elbow points towards). The hand is set afterwards by the caller: to `handRot`
 * (world) when given, and the elbow's plane is then also turned, as little as it takes, to keep the upper arm's twist
 * and the wrist's swing (unless `wristLimit` is off) within their ranges (round 7), else as near the pole's as the
 * upper arm's twist allows. With the arm's `memory` the plane starts from where the elbow was (ElbowMemory, round 8).
 * `forcePhi` (round 9) puts the plane at that turn (from the pole's) without any search: seekClearance has weighed the turns.
 */
export function reachIK(rig: PlayerRig, side: 'L' | 'R', target: Vector3, pole: Vector3, handRot: Quaternion | null = null, memory: ElbowMemory | null = null, wristLimit = true, forcePhi?: number) {
  const { upper, fore, hand, th, handWorld, localFor, tw, swingOf, ref } = armGeometry(rig, side, target, pole, handRot, memory);
  // How far a plane turn is outside the two ranges (deg; 0 inside both), the upper arm's twist first.
  const over = (phi: number) => 10 * Math.max(0, tw(localFor(phi)) - UPPER_ARM_TWIST_MAX_DEG) + (wristLimit ? Math.max(0, swingOf(phi) - WRIST_SWING_MAX_DEG) : 0);
  let phi = forcePhi ?? ref;
  if (forcePhi === undefined && over(ref) > 0) {
    // The smaller turn of the plane from there, either way, that brings both within range (5° steps, then refined between
    // the last step out and the first in, so the elbow moves on smoothly as the need grows); none: the least outside.
    const step = Math.PI / 36;
    let found: { sg: number; k: number } | null = null;
    let least = { phi: ref, over: over(ref) };
    for (let k = 1; k <= 36 && !found; k++) {
      for (const sg of [1, -1]) {
        const o = over(ref + sg * k * step);
        if (o <= 0 && !found) found = { sg, k };
        if (o < least.over) least = { phi: ref + sg * k * step, over: o };
      }
    }
    // Without a hand to keep (the bowler's release reach), the plane turns in its 5° steps, or not at all (as round 6).
    if (found && handRot) {
      let lo = (found.k - 1) * step;
      let hi = found.k * step;
      for (let it = 0; it < 6; it++) {
        const mid = (lo + hi) / 2;
        if (over(ref + found.sg * mid) <= 0) hi = mid;
        else lo = mid;
      }
      phi = ref + found.sg * hi;
    } else if (found) phi = ref + found.sg * found.k * step;
    else if (handRot) phi = least.phi;
  }
  const local = localFor(phi);
  if (memory && handRot) memory.now = local.clone();
  upper.quaternion.copy(local);
  fore.quaternion.set(Math.sin(th / 2), 0, 0, Math.cos(th / 2));
  upper.updateWorldMatrix(false, true);
  hand.quaternion.copy(fore.getWorldQuaternion(new Quaternion()).invert().multiply(handWorld));
  hand.updateWorldMatrix(false, true);
}

export function boneWorld(rig: PlayerRig, name: BoneName, out = new Vector3()): Vector3 {
  return out.setFromMatrixPosition(rig.boneMap[name].matrixWorld);
}

/** Where a held ball sits in a hand, in the hand bone's frame (m, canonical): in the palm (MOTION-SPEC, UNITY parity). */
export const BALL_IN_HAND: readonly [number, number, number] = [0, -0.085, 0.03];

/** The held ball's centre in a rig's hand (world): the hand joint plus BALL_IN_HAND in the hand's frame. */
export function ballInHand(rig: PlayerRig, side: 'L' | 'R', out = new Vector3()): Vector3 {
  return out.set(BALL_IN_HAND[0], BALL_IN_HAND[1], BALL_IN_HAND[2]).applyMatrix4(rig.boneMap[side === 'L' ? 'handL' : 'handR'].matrixWorld);
}

// ---------------------------------------------------------------------------------------------------------------
// Holding the bat: an orthodox grip closed round the handle
// ---------------------------------------------------------------------------------------------------------------

/**
 * The V's between thumb and forefinger point down the back of the handle between the splice and the outside edge:
 * the top hand's back faces the way the face does and the bottom hand's the way the back of the bat does, both turned
 * this far round the handle towards the outside edge.
 */
const GRIP_V_DEG = 35;
/** Most the chest and spine lean (each, degrees) to bring both hands onto a bat the arms alone cannot reach. */
const REACH_LEAN_MAX_DEG = 30;

const gripAxisLocal = new Vector3(GLOVE_GRIP.axis[0], GLOVE_GRIP.axis[1], GLOVE_GRIP.axis[2]);
const gm1 = new Matrix4();
const gm2 = new Matrix4();
const gu = new Vector3();
const gw = new Vector3();

/** The world rotation of a hand whose glove closes round a handle along `dir` (cap → toe) with its back to `back`. */
function gripRotation(side: 'L' | 'R', dir: Vector3, back: Vector3, out = new Quaternion()): Quaternion {
  const u2 = new Vector3(side === 'L' ? 1 : -1, 0, 0);
  gu.crossVectors(gripAxisLocal, u2);
  gw.crossVectors(dir, back);
  gm1.makeBasis(gripAxisLocal, u2, gu).transpose();
  gm2.makeBasis(dir, back, gw).multiply(gm1);
  return out.setFromRotationMatrix(gm2);
}

/** The glove's grip point (world): where the handle's axis passes through the closed hand. */
export function gripPoint(rig: PlayerRig, side: 'L' | 'R', out = new Vector3()): Vector3 {
  const hand = rig.boneMap[`hand${side}`];
  hand.updateWorldMatrix(true, false);
  return out.set(GLOVE_GRIP.centre[0] * (side === 'L' ? 1 : -1), GLOVE_GRIP.centre[1], GLOVE_GRIP.centre[2]).applyMatrix4(hand.matrixWorld);
}

/** Turns a bone (world-space rotation `q` applied on top of its current world rotation). */
function turnBone(bone: Object3D, q: Quaternion) {
  bone.updateWorldMatrix(true, false);
  bone.getWorldQuaternion(tmpQ);
  tmpQ.premultiply(q);
  bone.parent!.getWorldQuaternion(tmpQ2);
  bone.quaternion.copy(tmpQ2.invert().multiply(tmpQ));
  bone.updateMatrixWorld(true);
}

/** Sets a bone's world rotation. */
function setWorldRotation(bone: Object3D, q: Quaternion) {
  bone.parent!.updateWorldMatrix(true, false);
  bone.parent!.getWorldQuaternion(tmpQ2);
  bone.quaternion.copy(tmpQ2.invert().multiply(q));
  bone.updateMatrixWorld(true);
}

interface HandGrip {
  side: 'L' | 'R';
  /** The grip point on the handle (world), the handle's direction and the back of the hand's wanted direction. */
  at: Vector3;
  dir: Vector3;
  back: Vector3;
  /** Wrist target (world) and the hand's world rotation. */
  wrist: Vector3;
  rot: Quaternion;
  pole: Vector3;
}

function handGrip(rig: PlayerRig, side: 'L' | 'R', at: Vector3, dir: Vector3, back: Vector3): HandGrip {
  const rot = gripRotation(side, dir, back);
  const s = rig.scale;
  const centre = new Vector3(GLOVE_GRIP.centre[0] * (side === 'L' ? 1 : -1), GLOVE_GRIP.centre[1], GLOVE_GRIP.centre[2]).multiplyScalar(s).applyQuaternion(rot);
  const wrist = at.clone().sub(centre);
  // The forearm continues the back of the hand: the elbow is bent towards where the forearm would lie.
  const pole = wrist.clone().addScaledVector(new Vector3(0, 1, 0).applyQuaternion(rot), 0.3 * s);
  return { side, at, dir, back, wrist, rot, pole };
}

/** Most the glove turns round the handle away from the orthodox V's to keep the wrist in line with the forearm. */
const GRIP_TWIST_MAX_DEG = 75;
/** How fast the glove's roll drifts to the roll the forearm asks for (deg/s): 6° a frame at 60 fps. */
const ROLL_HOME_DEG_PER_S = 360;
/** A turn of the forearm round the handle of more than this in one frame is the arm moving fast (the swing's first move). */
const ROLL_FOLLOW_DEG = 40;

/**
 * Re-aims a grip round the handle so the hand continues the forearm the arm solve produced (a wrist cocked within its
 * range, not snapped), at most GRIP_TWIST_MAX_DEG from the orthodox V's. Round 9: the roll is a state of the glove (`mem`:
 * it drifts from the roll of the frame before, ROLL_HOME_DEG_PER_S) and is held inside the wrist's arc on the circle;
 * `instant` takes the roll the forearm asks for at once.
 */
function relaxGrip(rig: PlayerRig, g: HandGrip, mem: ElbowMemory | null = null, instant = false): HandGrip {
  const fore = rig.boneMap[`forearm${g.side}`];
  fore.updateWorldMatrix(true, false);
  const forearmUp = new Vector3(0, 1, 0).transformDirection(fore.matrixWorld);
  const handUp = new Vector3(0, 1, 0).applyQuaternion(g.rot);
  const a = handUp.addScaledVector(g.dir, -handUp.dot(g.dir));
  const b = forearmUp.addScaledVector(g.dir, -forearmUp.dot(g.dir));
  if (a.lengthSq() < 1e-6 || b.lengthSq() < 1e-6) return g;
  a.normalize();
  b.normalize();
  // cap·sin(β): the wanted twist, bounded, and continuous through β = ±180° (a hard clamp would flip the glove there).
  const want = Math.atan2(new Vector3().crossVectors(a, b).dot(g.dir), a.dot(b));
  if (mem) mem.wantNow = want;
  let beta = GRIP_TWIST_MAX_DEG * DEG * Math.sin(want);
  // Round 9: in a run of frames the roll is the glove's own state: it drifts to the roll above at ROLL_HOME_DEG_PER_S from the
  // roll it had (the wrist's arc, below, is what holds it), instead of being set afresh from the forearm every frame.
  if (mem && mem.rollPrev !== null && !instant) {
    const home = (ROLL_HOME_DEG_PER_S * Math.min(mem.dtMs, ELBOW_MEMORY_MS) * DEG) / 1000;
    const gap = Math.atan2(Math.sin(beta - mem.rollPrev), Math.cos(beta - mem.rollPrev));
    beta = mem.rollPrev + Math.max(-home, Math.min(home, gap));
  }
  // Round 7 (§9 wrist): the hand's long axis lies on a cone about the handle and the forearm's at its own angle to it;
  // the wrist's swing is the angle between them, set by how far round the handle they are apart (want − β). When that
  // is more than the wrist takes (WRIST_SWING_MAX_DEG), the glove turns on round the handle just as far as it must.
  const cf = forearmUp.set(0, 1, 0).transformDirection(fore.matrixWorld).dot(g.dir);
  const ch = new Vector3(0, 1, 0).applyQuaternion(g.rot).dot(g.dir);
  const sfh = Math.sqrt(Math.max(0, 1 - cf * cf) * Math.max(0, 1 - ch * ch));
  if (sfh > 1e-6) {
    const c = (Math.cos(WRIST_SWING_MAX_DEG * DEG) - cf * ch) / sfh;
    const swing = Math.acos(Math.max(-1, Math.min(1, cf * ch + sfh * Math.cos(want - beta))));
    if (swing > WRIST_SWING_MAX_DEG * DEG && c < 1) {
      const dm = Math.acos(Math.max(-1, c));
      // Round 9: the rolls the wrist takes are the arc [want − dm, want + dm] of the circle, and a roll outside it goes to the
      // nearer end of it (the old clamp took the end by the sign of `want`, which turned the glove 120° in one frame, and the
      // arm after it, where the forearm lies opposite the glove: want near ±180°, the rest pose of both arms).
      const off = Math.atan2(Math.sin(beta - want), Math.cos(beta - want));
      if (Math.abs(off) > dm) beta = want + (off === 0 ? 0 : off > 0 ? dm : -dm);
    }
  }
  if (mem) mem.rollNow = beta;
  return handGrip(rig, g.side, g.at, g.dir, turnAbout(g.back, g.dir, beta / DEG));
}

/**
 * How much the gripping arms keep clear of their two ranges (round 9): the arm is moved, a little a frame, towards a turn of the
 * elbow and a roll of the glove that leave this much of the upper arm's twist (105°) and of the wrist's swing (80°) to spare.
 * An arm sitting on the edge of a range is the one that flips: the edge is the first thing a small change in the bat takes it
 * across, and the nearest turn that satisfies the range is then in the other window of the range, 150° of forearm away. Clear
 * of the edge it has no reason to leave the window it is in. MOTION-SPEC §9's own limits (110°, 85°) come before everything
 * else: a window that cannot hold them is left for the nearest one that can, in one frame, as before.
 */
const CLEAR_AIM_DEG = 10;
/** The most a frame moves the glove's roll and the elbow's plane in that search (deg), and the grid it looks at them on. */
const CLEAR_ROLL_DEG = 22.5;
const CLEAR_PLANE_DEG = 30;
const CLEAR_GRID_DEG = 7.5;
/**
 * An arm that stays where it is: its roll as it was (no roll move) and the plane its search lands on within this many degrees of the
 * one the memory gives it (ELBOW_HOME_DEG_PER_S takes that 3° a frame at 60 fps, 9° at 20). The top glove of a batter's stance is
 * such an arm: with 6° of the upper arm's twist to spare, between balls, less than CLEAR_AIM_DEG, it is searched again on every frame
 * he stands, and the search puts it back where it was. Found to CLEAR_FINE_DEG, the plane is the same on every one of those frames.
 * Found to the 0.4° the 6 golden steps leave, it moved the elbow by that much, both ways, on every frame: a ripple of the upper arm
 * and the glove at half the frame rate for as long as he stood (14.6 against 8.6 deg/s of arm rotation between balls, and a step a
 * frame, so it grew with the frame rate). Any other pick keeps the 6 steps: how a window is left is pinned frame by frame.
 */
const CLEAR_STAY_DEG = 10;
const CLEAR_FINE_DEG = 0.01;
/** What a degree moved costs against a degree of clearance gained (a move of 30° must buy more than 4.5° of clearance). */
const CLEAR_MOVE_COST = 0.15;

/** The clearance (deg) of an arm as it stands: the less of what the upper arm's twist and the wrist's swing have to spare. */
function armClearance(rig: PlayerRig, g: HandGrip): number {
  const q = rig.boneMap[`upperArm${g.side}`].quaternion;
  const t = Math.abs((2 * Math.atan2(q.y, q.w) * 180) / Math.PI + 360) % 360;
  const twist = t > 180 ? 360 - t : t;
  const fy = new Vector3(0, 1, 0).transformDirection(rig.boneMap[`forearm${g.side}`].matrixWorld);
  const swing = (Math.acos(Math.max(-1, Math.min(1, fy.dot(new Vector3(0, 1, 0).applyQuaternion(g.rot))))) * 180) / Math.PI;
  return Math.min(UPPER_ARM_TWIST_MAX_DEG - twist, WRIST_SWING_MAX_DEG - swing);
}

function seekClearance(rig: PlayerRig, g: HandGrip, ortho: Vector3, mem: ElbowMemory): HandGrip {
  const short = boneWorld(rig, `hand${g.side}`, new Vector3()).distanceTo(g.wrist) > 0.003;
  if (!short && armClearance(rig, g) >= CLEAR_AIM_DEG) return g;
  const rollNow = mem.rollNow ?? 0;
  type Pick = { score: number; law: number; beta: number; phi: number; grip: HandGrip };
  const search = (offsets: number[], planeSpanDeg: number): Pick => {
    let best: Pick = { score: -Infinity, law: Infinity, beta: rollNow, phi: 0, grip: g };
    const consider = (offDeg: number) => {
      const beta = rollNow + offDeg * DEG;
      const grip = handGrip(rig, g.side, g.at, g.dir, turnAbout(ortho, g.dir, beta / DEG));
      const arm = armGeometry(rig, g.side, grip.wrist, grip.pole, grip.rot, mem);
      const score = (phi: number) => {
        const tw = arm.tw(arm.localFor(phi));
        const sw = arm.swingOf(phi);
        const clear = Math.min(UPPER_ARM_TWIST_MAX_DEG - tw, WRIST_SWING_MAX_DEG - sw);
        const law = 10 * Math.max(0, tw - UPPER_ARM_TWIST_LAW_DEG) + Math.max(0, sw - WRIST_SWING_LAW_DEG);
        const move = Math.abs(offDeg) + (Math.abs(Math.atan2(Math.sin(phi - arm.ref), Math.cos(phi - arm.ref))) * 180) / Math.PI;
        return { s: Math.min(CLEAR_AIM_DEG, clear) - CLEAR_MOVE_COST * move - 1000 * law - 1000 * arm.beyond, law };
      };
      let lo = { s: -Infinity, phi: arm.ref, law: Infinity };
      const kmax = Math.round(planeSpanDeg / CLEAR_GRID_DEG);
      for (let k = -kmax; k <= kmax; k++) {
        const phi = arm.ref + k * CLEAR_GRID_DEG * DEG;
        const r = score(phi);
        if (r.s > lo.s) lo = { s: r.s, phi, law: r.law };
      }
      let a0 = lo.phi - CLEAR_GRID_DEG * DEG;
      let a1 = lo.phi + CLEAR_GRID_DEG * DEG;
      for (let it = 0; it < 6; it++) {
        const m1 = a0 + (a1 - a0) * 0.382;
        const m2 = a0 + (a1 - a0) * 0.618;
        if (score(m1).s >= score(m2).s) a1 = m2;
        else a0 = m1;
      }
      if (offDeg === 0 && Math.abs((a0 + a1) / 2 - arm.ref) < CLEAR_STAY_DEG * DEG) {
        // Golden section on, each score kept for the step after it, down to CLEAR_FINE_DEG (10 steps more).
        let m1 = a0 + (a1 - a0) * 0.382;
        let m2 = a0 + (a1 - a0) * 0.618;
        let f1 = score(m1).s;
        let f2 = score(m2).s;
        while (a1 - a0 > CLEAR_FINE_DEG * DEG) {
          if (f1 >= f2) {
            a1 = m2;
            m2 = m1;
            f2 = f1;
            m1 = a0 + (a1 - a0) * 0.382;
            f1 = score(m1).s;
          } else {
            a0 = m1;
            m1 = m2;
            f1 = f2;
            m2 = a0 + (a1 - a0) * 0.618;
            f2 = score(m2).s;
          }
        }
      }
      const mid = (a0 + a1) / 2;
      const r = score(mid);
      if (r.s > lo.s) lo = { s: r.s, phi: mid, law: r.law };
      if (lo.s > best.score) best = { score: lo.s, law: lo.law, beta, phi: lo.phi, grip };
    };
    for (const off of offsets) consider(off);
    const bestOff = ((best.beta - rollNow) * 180) / Math.PI;
    for (const d of [-CLEAR_GRID_DEG / 2, CLEAR_GRID_DEG / 2]) consider(bestOff + d);
    return best;
  };
  const near: number[] = [0];
  for (let k = 1; k * CLEAR_GRID_DEG <= CLEAR_ROLL_DEG + 1e-6; k++) near.push(k * CLEAR_GRID_DEG, -k * CLEAR_GRID_DEG);
  let pick = mem.prev ? search(near, CLEAR_PLANE_DEG) : null;
  // No frame behind it, or a window that cannot hold §9: look all round for the nearest one that can.
  if (!pick || pick.law > 0) {
    const wide = search([0, 15, -15, 30, -30, 45, -45, 60, -60, 90, -90, 120, -120, 150, -150, 180], 180);
    if (!pick || wide.law < pick.law || (wide.law === pick.law && wide.score > pick.score)) pick = wide;
  }
  // Still outside §9 (the 7.5° grid missed a thin window): look closer round the best roll found.
  if (pick.law > 0) {
    const at = ((pick.beta - rollNow) * 180) / Math.PI;
    const fine = search([-12, -9, -6, -4, -2, -1, 1, 2, 4, 6, 9, 12].map((d) => at + d), 45);
    if (fine.law < pick.law || (fine.law === pick.law && fine.score > pick.score)) pick = fine;
  }
  reachIK(rig, pick.grip.side, pick.grip.wrist, pick.grip.pole, pick.grip.rot, mem, false, pick.phi);
  mem.rollNow = pick.beta;
  return pick.grip;
}

/**
 * The roll the glove drifts to can put the wrist where the arm cannot reach it (at full stretch, or too near the shoulder for the
 * elbow's range) when the forearm has just turned fast: the swing's first move asks for a turn of the glove it has not yet made,
 * and a turn of 40° moves the wrist 6 cm. Then the glove turns, from the roll it has towards the roll the forearm asks for, as far
 * as it takes for the wrist to be within reach, never further.
 */
function reachableRoll(rig: PlayerRig, orth: HandGrip, drifted: HandGrip, mem: ElbowMemory): HandGrip {
  const geo = (g: HandGrip) => armGeometry(rig, g.side, g.wrist, g.pole, g.rot, mem).beyond;
  if (geo(drifted) <= 0.002) return drifted;
  const driftedRoll = mem.rollNow ?? 0;
  relaxGrip(rig, orth, mem, true);
  const wantedRoll = mem.rollNow ?? 0;
  const gap = Math.atan2(Math.sin(wantedRoll - driftedRoll), Math.cos(wantedRoll - driftedRoll));
  let best = { grip: drifted, roll: driftedRoll, beyond: geo(drifted) };
  for (let k = 1; k <= 8; k++) {
    const roll = driftedRoll + (gap * k) / 8;
    const grip = handGrip(rig, orth.side, orth.at, orth.dir, turnAbout(orth.back, orth.dir, roll / DEG));
    const beyond = geo(grip);
    if (beyond < best.beyond - 1e-6) best = { grip, roll, beyond };
    if (beyond <= 0.002) break;
  }
  mem.rollNow = best.roll;
  return best.grip;
}

/** The farthest a shoulder comes forward to a glove the arm still cannot reach (m at rig scale 1; a reach, a shrug). */
const SHOULDER_REACH_M = 0.04;

/**
 * Closes the gloves round the handle: the arms to the wrist targets (round 8: the elbow's plane from where it was, and the
 * wrist's range only in the last passes, once the glove has been turned to continue the forearm: a swing the orthodox
 * glove could not keep within range would throw the plane to the other window of the twist range, and the glove's turn
 * after it, from one frame to the next), the trunk leaning and the shoulders coming forward to what they cannot reach.
 * `stamp` is the frame's scene time (the arms' memory runs only across frames close in time).
 */
function solveGrips(rig: PlayerRig, grips: HandGrip[], stamp: number | undefined) {
  const mem = nextElbowFrame(rig, stamp);
  // The shoulders at rest (a reach of the last frame never carries over).
  for (const side of ['L', 'R'] as const) rig.boneMap[`upperArm${side}`].position.fromArray(SKELETON[BONE_INDEX[`upperArm${side}`]].offset as number[]);
  rig.root.updateMatrixWorld(true);
  const ortho = grips.map((g) => g.back.clone());
  for (const g of grips) reachIK(rig, g.side, g.wrist, g.pole, g.rot, mem[g.side], false);
  for (let i = 0; i < grips.length; i++) {
    const m = mem[grips[i].side];
    const orth = grips[i];
    grips[i] = relaxGrip(rig, orth, m);
    // The glove's roll drifts (relaxGrip), but where the forearm has just turned fast round the handle (the swing's first move) the
    // arm is at full stretch and a glove that has not yet turned puts the wrist out of reach: it turns as far as that takes.
    const turned = m.wantPrev !== null && m.wantNow !== null && Math.abs(Math.atan2(Math.sin(m.wantNow - m.wantPrev), Math.cos(m.wantNow - m.wantPrev))) > ROLL_FOLLOW_DEG * DEG;
    if (m.rollPrev !== null && turned) grips[i] = reachableRoll(rig, orth, grips[i], m);
    reachIK(rig, grips[i].side, grips[i].wrist, grips[i].pole, grips[i].rot, m, false);
  }
  // A bat the arms alone cannot reach: lean the chest, then the spine, a little towards it and solve again (each
  // bone at most REACH_LEAN_MAX_DEG in all).
  const leanBase = { chest: rig.boneMap.chest.quaternion.clone(), spine: rig.boneMap.spine.quaternion.clone() };
  const used = { chest: 0, spine: 0 };
  for (let k = 0; k < 6; k++) {
    let worst = 0;
    const now = new Vector3();
    const want = new Vector3();
    for (const g of grips) {
      const w = boneWorld(rig, `hand${g.side}`, new Vector3());
      worst = Math.max(worst, w.distanceTo(g.wrist));
      now.add(w);
      want.add(g.wrist);
    }
    if (worst < 0.002) break;
    const name = k % 2 === 0 ? 'chest' : 'spine';
    const pivot = boneWorld(rig, name, new Vector3());
    const a = now.multiplyScalar(1 / grips.length).sub(pivot).normalize();
    const b = want.multiplyScalar(1 / grips.length).sub(pivot).normalize();
    const q = new Quaternion().setFromUnitVectors(a, b);
    const ang = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
    const cap = Math.min(REACH_LEAN_MAX_DEG * DEG - used[name], (REACH_LEAN_MAX_DEG / 2) * DEG);
    if (cap <= 1e-4) continue;
    if (ang > cap) q.slerp(new Quaternion(), 1 - cap / ang);
    used[name] += Math.min(ang, cap);
    turnBone(rig.boneMap[name], q);
    for (const g of grips) reachIK(rig, g.side, g.wrist, g.pole, g.rot, mem[g.side], false);
  }
  // The lean comes and goes no faster than the trunk's §9 speed (the bat's first move asked 15° of the chest in one frame).
  if (easeLean(rig, stamp, leanBase)) for (const g of grips) reachIK(rig, g.side, g.wrist, g.pole, g.rot, mem[g.side], false);
  // Still short (the trunk has turned as far as it may): the shoulder comes forward to it, at most SHOULDER_REACH_M.
  for (const g of grips) {
    const hand = boneWorld(rig, `hand${g.side}`, new Vector3());
    const e = hand.distanceTo(g.wrist);
    if (e < 0.002) continue;
    const arm = rig.boneMap[`upperArm${g.side}`];
    const sh = boneWorld(rig, `upperArm${g.side}`, new Vector3());
    const to = g.wrist.clone().sub(sh).normalize().multiplyScalar(Math.min(e * 1.05, SHOULDER_REACH_M * rig.scale)).add(sh);
    arm.parent!.updateMatrixWorld(true);
    arm.position.copy(arm.parent!.worldToLocal(to));
    arm.updateMatrixWorld(true);
    reachIK(rig, g.side, g.wrist, g.pole, g.rot, mem[g.side], false);
  }
  // The arms once more, as they now stand (the trunk's lean and the shoulder's reach moved them): an arm with less than
  // CLEAR_AIM_DEG to spare in either of its two ranges is moved towards one that has that much (seekClearance).
  for (let i = 0; i < grips.length; i++) grips[i] = seekClearance(rig, grips[i], ortho[i], mem[grips[i].side]);
  for (const g of grips) setWorldRotation(rig.boneMap[`hand${g.side}`], g.rot);
}

/** `v` turned by `deg` about the unit axis `k` (Rodrigues; v ⟂ k). */
function turnAbout(v: Vector3, k: Vector3, deg: number): Vector3 {
  const a = deg * DEG;
  return v.clone().multiplyScalar(Math.cos(a)).add(new Vector3().crossVectors(k, v).multiplyScalar(Math.sin(a))).addScaledVector(k, k.dot(v) * (1 - Math.cos(a)));
}

export interface HeldBatPose {
  grip: { x: number; y: number; z: number };
  toe: { x: number; y: number; z: number };
  face: { x: number; y: number; z: number };
}

/**
 * Places a batter's bat and closes the gloves round it, after the pose (and arm aims) are applied:
 * - `physicsBat` (world): the bat is placed exactly there (props.placeBatSpan; never moved), and both hands reach it;
 * - else the clip's bat key: the bottom hand's point and the blade's direction in the actor frame, the face towards
 *   the bowler;
 * - else the bat is carried in the bottom hand, toe down.
 * The grip is orthodox for either hand: the top hand (left for a right-hander, right for a left-hander, `mirror`) at
 * TOP_HAND_FROM_CAP below the cap and the bottom hand at LOWER_HAND_FROM_CAP, each glove's channel on the handle's
 * axis, the V's aligned (GRIP_V_DEG).
 */
export function holdBat(rig: PlayerRig, bat: Object3D, physicsBat: HeldBatPose | null, pose: SampledPose, mirror: boolean): void {
  const m = mirror ? -1 : 1;
  const bottom: 'L' | 'R' = mirror ? 'L' : 'R';
  const top: 'L' | 'R' = mirror ? 'R' : 'L';
  const s = rig.scale;
  const rootQ = rig.root.getWorldQuaternion(new Quaternion());
  let cap: Vector3;
  let dir: Vector3;
  if (physicsBat) {
    placeBatSpan(bat, physicsBat.grip, physicsBat.toe, physicsBat.face);
    cap = new Vector3(physicsBat.grip.x, physicsBat.grip.y, physicsBat.grip.z);
    dir = new Vector3(physicsBat.toe.x, physicsBat.toe.y, physicsBat.toe.z).sub(cap).normalize();
  } else if (pose.bat) {
    const lower = rig.root.localToWorld(new Vector3(pose.bat.grip[0], pose.bat.grip[1], pose.bat.grip[2]).multiplyScalar(s / rig.root.scale.x));
    dir = new Vector3(pose.bat.dir[0], pose.bat.dir[1], pose.bat.dir[2]).normalize().applyQuaternion(rootQ);
    // The clip's own face when its key carries one (MOTION-SPEC v1.2 bat.face; bat.clipBatPose reads it too), else towards the bowler.
    // It was always the second, so the bat turned about its blade in the frame the external bat handed over to the clip's key.
    const kf = pose.bat.face;
    placeBat(bat, lower, dir, kf ? new Vector3(kf[0], kf[1], kf[2]).applyQuaternion(rootQ) : new Vector3(m, 0, 0).applyQuaternion(rootQ));
    cap = lower.clone().addScaledVector(dir, -LOWER_HAND_FROM_CAP);
  } else {
    // Carried without a key of the clip's own: the bottom hand holds it at the carried key (clips.CARRY_BAT_KEY), the
    // same key a crossfade to or from a keyed clip blends through, so the bat never jumps.
    const k = CARRY_BAT_KEY;
    const lower = rig.root.localToWorld(new Vector3(k.grip[0] * m, k.grip[1], k.grip[2]).multiplyScalar(s / rig.root.scale.x));
    dir = new Vector3(k.dir[0] * m, k.dir[1], k.dir[2]).normalize().applyQuaternion(rootQ);
    placeBat(bat, lower, dir, new Vector3(0, 0, 1).applyQuaternion(rootQ));
    cap = lower.clone().addScaledVector(dir, -LOWER_HAND_FROM_CAP);
  }
  bat.updateMatrixWorld(true);
  const face = new Vector3(0, 0, 1).transformDirection(bat.matrixWorld);
  face.addScaledVector(dir, -face.dot(dir)).normalize();
  const grips = [
    handGrip(rig, bottom, cap.clone().addScaledVector(dir, LOWER_HAND_FROM_CAP), dir, turnAbout(face.clone().negate(), dir, GRIP_V_DEG * m)),
  ];
  // The top hand: on the handle for the physics bat; for a clip, as much as the clip's crossfade says (it lets go of
  // the bat, or takes it, over the crossfade instead of snapping).
  // The frame's time, if the batters' hook stamped it (the arms' memory); it never outlives this frame.
  const stamp = pose.stamp;
  pose.stamp = undefined;
  const topW = easeTopHand(rig, stamp, physicsBat ? 1 : pose.bat ? (pose.topHand ?? (pose.twoHands ? 1 : 0)) : 0);
  if (topW <= 1e-3) {
    solveGrips(rig, grips, stamp);
    return;
  }
  const topBones = (['upperArm', 'forearm', 'hand'] as const).map((b) => rig.boneMap[`${b}${top}`]);
  const free = topW < 1 ? topBones.map((b) => b.quaternion.clone()) : null;
  grips.push(handGrip(rig, top, cap.clone().addScaledVector(dir, TOP_HAND_FROM_CAP), dir, turnAbout(face, dir, GRIP_V_DEG * m)));
  solveGrips(rig, grips, stamp);
  if (free) {
    topBones.forEach((b, i) => b.quaternion.slerpQuaternions(free[i], b.quaternion.clone(), topW));
    topBones[0].updateMatrixWorld(true);
  }
}

export type { Material };
