/**
 * The stadium, built procedurally (original work; no external assets): the sky and the light for three times of day
 * in clear or overcast weather, the outfield with its mowing pattern, the 30-yard ring and the boundary cushion and
 * rope, the pitch with a distinct surface for every physics pitch condition, sight screens behind both ends, two
 * tiers of stands with aisles, railings and an instanced crowd that follows the emotion signals, a pavilion with the
 * players' area, a scoreboard, camera platforms, flags and banners, LED boards and six floodlight towers.
 *
 * Determinism: every frame is a function of (script, scene time) and the stadium clock the stage passes to setTime.
 * Textures are generated once at creation (seeded); setEnvironment and setPracticePitch change uniforms only (plus,
 * with a renderer attached, one small PMREM per light and sky, cached) and are called between deliveries.
 */
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
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
  PMREMGenerator,
  RepeatWrapping,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Conditions, KitSpec } from '@/contracts';
import type { PitchCondition } from '@/contracts/practice';
import { PITCHES, type PitchParams } from '@/physics/constants';
import type { PracticeEnvironment } from '../practice/types';
import {
  BOUNDARY_R,
  PITCH_HALF,
  PITCH_WIDTH,
  POPPING,
  POPPING_CREASE_HALF,
  RETURN_CREASE_LENGTH,
  RETURN_CREASE_X,
  RING_R,
} from '../core/ground';
import { clamp, seededStream } from '../core/math';
import type { QualityPreset } from '../core/quality';
import { PLAYER_CLOCK, PLAYER_FILL } from './players';
import { canvasArt, rng } from './props';

export const TOWER_ANGLES = [35, 90, 145, 215, 270, 325].map((d) => (d * Math.PI) / 180);
export const TOWER_R = BOUNDARY_R + 52;
const TOWER_H = 58;
export const towerPos = (a: number) => new Vector3(Math.sin(a) * TOWER_R, TOWER_H, Math.cos(a) * TOWER_R);

export interface Stadium {
  group: Group;
  keyLight: DirectionalLight;
  rimLight: DirectionalLight;
  hemi: HemisphereLight;
  setTime(ms: number): void;
  /** Crowd arousal 0..1 (Practice passes the emotion signal's arousal). At a hush (≤ 0.12) the crowd is still. */
  setExcitement(v: number): void;
  /** Boundary / wicket board flash 0..1 and colour. */
  setBoardFlash(v: number, color: 'cyan' | 'amber' | 'wicket'): void;
  /** The match's conditions: pitch look ('green' | 'hard' | 'slow') and weather (dew, humidity). */
  setConditions(c: Conditions): void;
  setTeams(home: KitSpec, away: KitSpec): void;
  setQuality(p: QualityPreset): void;
  /**
   * Practice integration (the Practice stage calls these; the match never does):
   * sight screens dark behind a white ball and white behind a red one (constitution §28: they must improve visibility);
   * the Practice pitch surface for a physics PitchCondition (the look follows src/physics PITCHES; 'turning' shows as
   * Dusty; unknown keys fall back to balanced); the light and sky; Delivery Quiet Mode (no decorative motion: boards,
   * fascia, phone lights, flags, clouds; the crowd moves only with its excitement); a localized crowd reaction near
   * the ball (high tier); and an environment map for reflective props (the ball's polished half), or null.
   */
  setSightScreens(tone: 'dark' | 'white'): void;
  setPracticePitch(condition: PitchCondition | 'dry'): void;
  setEnvironment(env: PracticeEnvironment): void;
  setQuiet(on: boolean): void;
  setCrowdFocus(at: { x: number; z: number } | null, strength: number): void;
  ballEnvironment(): Texture | null;
  /**
   * Optional wiring (all between deliveries): the renderer, so setEnvironment can build the small PMREM that
   * ballEnvironment() returns; the tone-mapping exposure for the current environment; the light sources for blob
   * shadows (the six towers under lights, the sun alone by day); the crowd's mood (−1 dismay … +1 joy) and
   * expectation (0..1) from the emotion signals.
   */
  setRenderer(renderer: WebGLRenderer): void;
  exposure(): number;
  shadowSources(): readonly Vector3[];
  setCrowdMood(valence: number, expectation?: number): void;
  /** Read-only state for tests and tools. */
  inspect(): StadiumState;
  dispose(): void;
}

interface StadiumState {
  environment: PracticeEnvironment;
  pitch: PitchLook;
  sightScreen: { tone: 'dark' | 'white'; color: string; width: number; height: number; distance: number };
  quiet: boolean;
  boardOffset: number;
  fasciaOffset: number;
  decorativeTime: number;
  crowd: { count: number; animated: boolean; excitement: number };
}

// ---------------------------------------------------------------------------------------------------------------
// Environment presets (constitution §30): day, late afternoon, evening under lights; clear or lightly overcast.
// Exposure keeps a white or a red ball readable in each (the sight screens and the ball's own outline do the rest).
// ---------------------------------------------------------------------------------------------------------------

export interface EnvLook {
  /** Sky gradient, sun disc and haze, clouds, stars. */
  zenith: string;
  mid: string;
  horizon: string;
  haze: string;
  hazeAmount: number;
  stars: number;
  clouds: number;
  cloudColor: string;
  /** Sun direction (azimuth from +z towards +x, elevation), or null under lights. */
  sun: { azimuth: number; elevation: number; color: string; disc: number } | null;
  fog: { color: string; near: number; far: number };
  hemi: { sky: string; ground: string; intensity: number };
  key: { color: string; intensity: number };
  rim: { color: string; intensity: number };
  /** Floodlights on (0..1): lamp banks, glows, light shafts. */
  floodlights: number;
  /** Unlit surfaces (stands, boards, pavilion glazing): overall brightness and tint, front rows vs back. */
  ambient: { tint: string; front: number; back: number };
  windows: number;
  phones: number;
  exposure: number;
  /** Outfield stripe colours and the floodlit centre's lift. */
  grass: { a: string; b: string; centre: number };
}

const deg = (d: number) => (d * Math.PI) / 180;

/** The six looks. 'evening' + 'clear' is the default and the match's look. */
export const ENVIRONMENTS: Readonly<Record<PracticeEnvironment['light'], Readonly<Record<PracticeEnvironment['sky'], EnvLook>>>> = {
  evening: {
    clear: {
      zenith: '#04031a', mid: '#100d36', horizon: '#1b1636', haze: '#d98a4a', hazeAmount: 0.07, stars: 0.7, clouds: 0.15, cloudColor: '#262246',
      sun: null,
      fog: { color: '#1a1546', near: 120, far: 560 },
      hemi: { sky: '#5f5e9c', ground: '#132e1c', intensity: 0.7 },
      key: { color: '#ffe8c8', intensity: 2.5 },
      rim: { color: '#e4e8f2', intensity: 0.9 },
      floodlights: 1,
      ambient: { tint: '#ffffff', front: 0.66, back: 0.24 },
      windows: 0.75,
      phones: 1,
      exposure: 1.08,
      grass: { a: '#0f4a2a', b: '#1f7a43', centre: 1.12 },
    },
    overcast: {
      zenith: '#0e0c22', mid: '#1c1838', horizon: '#2c2440', haze: '#d8823e', hazeAmount: 0.2, stars: 0, clouds: 0.85, cloudColor: '#3a3150',
      sun: null,
      fog: { color: '#231d3c', near: 95, far: 430 },
      hemi: { sky: '#666490', ground: '#132e1c', intensity: 0.8 },
      key: { color: '#ffe8cc', intensity: 2.2 },
      rim: { color: '#e2e6ee', intensity: 0.78 },
      floodlights: 1,
      ambient: { tint: '#f4f0ff', front: 0.62, back: 0.26 },
      windows: 0.75,
      phones: 1,
      exposure: 1.1,
      grass: { a: '#104628', b: '#1d723f', centre: 1.1 },
    },
  },
  day: {
    clear: {
      zenith: '#2f6fc9', mid: '#6ea4dc', horizon: '#c9def0', haze: '#fff3dc', hazeAmount: 0.25, stars: 0, clouds: 0.22, cloudColor: '#f6f8fb',
      sun: { azimuth: deg(58), elevation: deg(54), color: '#fff3e0', disc: 1 },
      fog: { color: '#bcd2e6', near: 180, far: 900 },
      hemi: { sky: '#b8d4f2', ground: '#4a6b34', intensity: 1.05 },
      key: { color: '#fff1dc', intensity: 3.1 },
      rim: { color: '#d6e6ff', intensity: 0.45 },
      floodlights: 0,
      ambient: { tint: '#ffffff', front: 0.8, back: 0.6 },
      windows: 0,
      phones: 0,
      exposure: 0.92,
      grass: { a: '#2c6a2e', b: '#3f8a3c', centre: 1.0 },
    },
    overcast: {
      zenith: '#8d97a3', mid: '#aab3bd', horizon: '#c7ced4', haze: '#e4e6e6', hazeAmount: 0.2, stars: 0, clouds: 0.95, cloudColor: '#c3c9cf',
      sun: { azimuth: deg(58), elevation: deg(62), color: '#f2f2ee', disc: 0 },
      fog: { color: '#b9c0c6', near: 140, far: 700 },
      hemi: { sky: '#d6dce2', ground: '#55704a', intensity: 1.75 },
      key: { color: '#f4f4f0', intensity: 0.95 },
      rim: { color: '#dfe6ee', intensity: 0.3 },
      floodlights: 0,
      ambient: { tint: '#f2f4f6', front: 0.72, back: 0.6 },
      windows: 0.15,
      phones: 0,
      exposure: 1.02,
      grass: { a: '#2a6230', b: '#3b7f3c', centre: 1.0 },
    },
  },
  late_afternoon: {
    clear: {
      zenith: '#3b69b0', mid: '#86a7cf', horizon: '#f0c690', haze: '#ffb866', hazeAmount: 0.45, stars: 0, clouds: 0.25, cloudColor: '#ffe2bf',
      sun: { azimuth: deg(104), elevation: deg(15), color: '#ffc988', disc: 1 },
      fog: { color: '#d8bf98', near: 150, far: 720 },
      hemi: { sky: '#9cb8de', ground: '#3f5a2b', intensity: 0.78 },
      key: { color: '#ffcf96', intensity: 2.7 },
      rim: { color: '#b9cdf0', intensity: 0.4 },
      floodlights: 0.35,
      ambient: { tint: '#fff0dc', front: 0.8, back: 0.56 },
      windows: 0.25,
      phones: 0,
      exposure: 1.0,
      grass: { a: '#2b6029', b: '#3f8034', centre: 1.0 },
    },
    overcast: {
      zenith: '#6f7484', mid: '#9a9aa2', horizon: '#c9b8a4', haze: '#e0b48a', hazeAmount: 0.3, stars: 0, clouds: 0.9, cloudColor: '#b9aca2',
      sun: { azimuth: deg(104), elevation: deg(22), color: '#f0d6b8', disc: 0 },
      fog: { color: '#b3aaa0', near: 120, far: 620 },
      hemi: { sky: '#c8c4c4', ground: '#4e6440', intensity: 1.4 },
      key: { color: '#f2dcc2', intensity: 0.85 },
      rim: { color: '#d4d8e0', intensity: 0.3 },
      floodlights: 0.6,
      ambient: { tint: '#f6efe6', front: 0.7, back: 0.56 },
      windows: 0.35,
      phones: 0,
      exposure: 1.04,
      grass: { a: '#295b2d', b: '#3a7838', centre: 1.0 },
    },
  },
};

function environmentLook(env: PracticeEnvironment): EnvLook {
  const byLight = ENVIRONMENTS[env.light] ?? ENVIRONMENTS.evening;
  return byLight[env.sky] ?? byLight.clear;
}

// ---------------------------------------------------------------------------------------------------------------
// Pitch surfaces (constitution §27): one look per physics condition, every parameter derived from src/physics PITCHES
// so what is drawn is what the ball does. 'turning' shows as Dusty; 'dry' (not yet a physics key) sits between
// balanced and turning until src/physics defines it; unknown keys fall back to balanced.
// ---------------------------------------------------------------------------------------------------------------

type PitchKey = PitchCondition | 'dry';

export interface PitchLook {
  key: PitchKey;
  label: string;
  /** Soil: light and dark clay, and the dust that lies on a dry surface. */
  soilLight: string;
  soilDark: string;
  dustColor: string;
  /** Grass on the strip: its colour and how much of the surface it covers (0 bare … 1 a live green cover). */
  grassColor: string;
  grassCover: number;
  /** Cracking (0 none … 1 a cracked, dry surface), rough patches, loose dust, polish, footmark depth. */
  crack: number;
  rough: number;
  dust: number;
  sheen: number;
  wear: number;
  /** Base surface roughness (polished hard surface ≈ 0.55 … dusty ≈ 0.95). */
  roughness: number;
}

const LABELS: Record<PitchKey, string> = { balanced: 'Balanced', green: 'Green', hard: 'Hard & Bouncy', turning: 'Dusty', dry: 'Dry' };
const norm01 = (v: number, a: number, b: number) => clamp((v - a) / (b - a), 0, 1);

/** The physics parameters of a condition ('dry' until physics defines it: halfway from balanced to turning). */
export function pitchParams(key: string): PitchParams {
  const table = PITCHES as Record<string, PitchParams | undefined>;
  const hit = table[key];
  if (hit) return hit;
  if (key === 'dry') {
    const a = PITCHES.balanced;
    const b = PITCHES.turning;
    return { restitution: (a.restitution + b.restitution) / 2, friction: (a.friction + b.friction) / 2, seamGrip: (a.seamGrip + b.seamGrip) / 2, turnGrip: (a.turnGrip + b.turnGrip) / 2, swingFactor: (a.swingFactor + b.swingFactor) / 2 };
  }
  return PITCHES.balanced;
}

const mixHex = (a: string, b: string, t: number) => '#' + new Color(a).lerp(new Color(b), clamp(t, 0, 1)).getHexString();

/**
 * A pitch look from physics parameters:
 * - grass cover ← swing factor (a grass-polished, moist surface swings more) and seam grip (grass grips the seam);
 * - cracks ← turn grip (a dry, cracked surface grips spin), rough patches and loose dust ← turn grip with friction;
 * - polish (sheen) ← restitution (a hard, rolled surface bounces) with low friction (it skids);
 * - soil colour: darker and richer when moist (green), paler when hard, warm and pale when dusty.
 */
export function pitchLook(condition: string): PitchLook {
  const key: PitchKey = condition === 'green' || condition === 'hard' || condition === 'turning' || condition === 'dry' ? condition : 'balanced';
  const p = pitchParams(key);
  const swing = norm01(p.swingFactor, 0.8, 1.45);
  const seam = norm01(p.seamGrip, 0.012, 0.026);
  const turn = norm01(p.turnGrip, 0.45, 0.95);
  const fric = norm01(p.friction, 0.3, 0.4);
  const bounce = norm01(p.restitution, 0.55, 0.67);
  const sheen = bounce * (1 - norm01(p.friction, 0.25, 0.4));
  const grassCover = 0.1 + 0.9 * clamp(0.62 * swing + 0.38 * seam, 0, 1);
  const crack = Math.pow(turn, 0.8);
  const dust = fric;
  const rough = 0.15 + 0.85 * norm01(p.turnGrip, 0.5, 0.95) * norm01(p.friction, 0.27, 0.4);
  const moist = norm01(p.swingFactor, 1.0, 1.45);
  const dry = norm01(p.turnGrip, 0.55, 0.95);
  let light = '#c4a274';
  let dark = '#987650';
  light = mixHex(light, '#9f8458', moist);
  dark = mixHex(dark, '#6f5636', moist);
  light = mixHex(light, '#dccaa8', sheen * 0.85);
  dark = mixHex(dark, '#b39b74', sheen * 0.85);
  light = mixHex(light, '#dbbd8f', dry);
  dark = mixHex(dark, '#b28c60', dry);
  return {
    key,
    label: LABELS[key],
    soilLight: light,
    soilDark: dark,
    dustColor: mixHex('#e2cfa8', '#e8d6b0', dry),
    grassColor: mixHex(mixHex('#a39a68', '#86904e', clamp(swing * 2, 0, 1)), '#6f9a42', moist),
    grassCover,
    crack,
    rough,
    dust,
    sheen,
    wear: 0.55 + 0.45 * crack,
    roughness: clamp(0.84 - 0.3 * sheen + 0.12 * dust, 0.5, 0.97),
  };
}

/** The match's three pitch looks map onto the Practice surfaces (its 'slow' pitch is the dusty one). */
const MATCH_PITCH: Record<Conditions['pitch'], PitchKey> = { green: 'green', hard: 'hard', slow: 'turning' };

// ---------------------------------------------------------------------------------------------------------------
// Crease markings (Law 7), from the physics geometry: the popping crease is the back edge of its marking, 4 ft in
// front of the bowling crease (whose back edge is the line of the stumps), marked at least 6 ft either side of middle;
// the return creases are the inside edges of their markings, 4 ft 4 in either side of middle, from the popping crease
// to at least 8 ft behind it.
// ---------------------------------------------------------------------------------------------------------------

/** Width of the painted crease lines (the Laws fix the creases' edges, not the paint's width). */
export const CREASE_LINE_W = 0.05;

export interface CreaseMark {
  kind: 'popping' | 'bowling' | 'return';
  /** +1 the striker's end, −1 the bowler's end. */
  end: 1 | -1;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export function creaseMarkings(): CreaseMark[] {
  const out: CreaseMark[] = [];
  const w = CREASE_LINE_W;
  for (const end of [1, -1] as const) {
    const popping = end * (PITCH_HALF - POPPING);
    const bowling = end * PITCH_HALF;
    // Markings lie on the pitch's side of the popping and bowling creases.
    out.push({ kind: 'popping', end, x0: -POPPING_CREASE_HALF, x1: POPPING_CREASE_HALF, z0: Math.min(popping, popping - end * w), z1: Math.max(popping, popping - end * w) });
    out.push({ kind: 'bowling', end, x0: -RETURN_CREASE_X, x1: RETURN_CREASE_X, z0: Math.min(bowling, bowling - end * w), z1: Math.max(bowling, bowling - end * w) });
    const back = end * (PITCH_HALF - POPPING + RETURN_CREASE_LENGTH);
    for (const side of [1, -1]) {
      const inside = side * RETURN_CREASE_X;
      out.push({ kind: 'return', end, x0: Math.min(inside, inside + side * w), x1: Math.max(inside, inside + side * w), z0: Math.min(popping, back), z1: Math.max(popping, back) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Generated textures. The pitch's macro map (masks over the whole strip) and the tiling micro detail are computed
// into DataTextures (no canvas needed); signage and facades are painted on canvases.
// ---------------------------------------------------------------------------------------------------------------

/** A smooth value noise on a lattice (periodic when `period` is given), seeded. Returns 0..1. */
function valueNoise(seed: number, period = 0): (x: number, y: number) => number {
  const N = 256;
  const rand = seededStream(seed);
  const table = new Float32Array(N * N);
  for (let i = 0; i < table.length; i++) table[i] = rand();
  const at = (i: number, j: number) => {
    if (period > 0) {
      i = ((i % period) + period) % period;
      j = ((j % period) + period) % period;
    }
    return table[((j & (N - 1)) * N + (i & (N - 1))) | 0];
  };
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
}

function dataTexture(data: Uint8Array, w: number, h: number, repeat: boolean): DataTexture {
  const t = new DataTexture(data, w, h);
  t.colorSpace = NoColorSpace;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/** Extent of the pitch's macro map (world metres, centred on the pitch). */
const MACRO = Object.freeze({ width: 4.5, length: 26 });

const gauss = (dx: number, dz: number, sx: number, sz: number) => Math.exp(-((dx / sx) ** 2 + (dz / sz) ** 2));

/**
 * The pitch's macro masks, over MACRO.width × MACRO.length: R wear (bowlers' footmarks at both popping creases, the
 * batters' guard areas, the worn line where the ball pitches), G rough patches (outside a right-hander's off stump in
 * the landing area, fainter elsewhere), B low-frequency soil variation, A grass density.
 */
export function pitchMacroTexture(): DataTexture {
  const W = 256;
  const H = 1024;
  const data = new Uint8Array(W * H * 4);
  const n1 = valueNoise(301);
  const n2 = valueNoise(302);
  const n3 = valueNoise(303);
  const rand = seededStream(304);
  // Individual foot impressions jittered round each footmark centre.
  type Mark = { x: number; z: number; sx: number; sz: number; w: number };
  const marks: Mark[] = [];
  const cluster = (x: number, z: number, n: number, spreadX: number, spreadZ: number, w: number) => {
    for (let i = 0; i < n; i++) marks.push({ x: x + (rand() - 0.5) * spreadX, z: z + (rand() - 0.5) * spreadZ, sx: 0.05 + rand() * 0.03, sz: 0.11 + rand() * 0.05, w: w * (0.6 + rand() * 0.4) });
  };
  const rough: Mark[] = [];
  for (const end of [1, -1] as const) {
    const pop = end * (PITCH_HALF - POPPING);
    // Bowlers' front feet straddle the popping crease (right-arm over lands on the side away from the bowling arm's
    // stumps: +x at the far end, −x at the striker's end); back feet near the bowling crease; left-arm marks fainter.
    const main = -end;
    cluster(main * 0.3, pop + end * 0.08, 26, 0.3, 0.42, 1);
    cluster(main * 0.62, end * (PITCH_HALF - 0.45), 14, 0.26, 0.35, 0.8);
    cluster(-main * 0.3, pop + end * 0.08, 12, 0.26, 0.36, 0.55);
    // Follow-through scuffs angling off the pitch.
    for (let i = 0; i < 9; i++) marks.push({ x: main * (0.45 + i * 0.09), z: pop - end * (0.4 + i * 0.32), sx: 0.06, sz: 0.12, w: 0.45 * (1 - i / 10) });
    // The batter's guard area (a right-hander stands on the leg side of middle) and the front-foot stride.
    cluster(-0.28, pop + end * 0.12, 18, 0.34, 0.5, 0.75);
    cluster(-0.16, pop - end * 0.75, 10, 0.3, 0.4, 0.45);
    // Rough: outside off stump (+x) between 1.5 and 3.6 m in front of the stumps, strongest at the striker's end.
    const strength = end > 0 ? 1 : 0.55;
    for (let i = 0; i < 24; i++) rough.push({ x: 0.55 + (rand() - 0.5) * 0.65, z: end * (PITCH_HALF - 1.6 - rand() * 2.1), sx: 0.12 + rand() * 0.14, sz: 0.16 + rand() * 0.2, w: strength * (0.5 + rand() * 0.5) });
    for (let i = 0; i < 10; i++) rough.push({ x: -0.62 + (rand() - 0.5) * 0.5, z: end * (PITCH_HALF - 1.8 - rand() * 1.6), sx: 0.1 + rand() * 0.1, sz: 0.14 + rand() * 0.14, w: 0.4 * strength * (0.5 + rand() * 0.5) });
  }
  // Splat each mark over its own footprint (max-blended), then add the noise terms per pixel.
  const wearBuf = new Float32Array(W * H);
  const roughBuf = new Float32Array(W * H);
  const px = (x: number) => ((x + MACRO.width / 2) / MACRO.width) * W - 0.5;
  const pz = (z: number) => ((z + MACRO.length / 2) / MACRO.length) * H - 0.5;
  const splat = (buf: Float32Array, m: Mark) => {
    const i0 = Math.max(0, Math.floor(px(m.x - m.sx * 3)));
    const i1 = Math.min(W - 1, Math.ceil(px(m.x + m.sx * 3)));
    const j0 = Math.max(0, Math.floor(pz(m.z - m.sz * 3)));
    const j1 = Math.min(H - 1, Math.ceil(pz(m.z + m.sz * 3)));
    for (let j = j0; j <= j1; j++) {
      const z = ((j + 0.5) / H) * MACRO.length - MACRO.length / 2;
      for (let i = i0; i <= i1; i++) {
        const x = ((i + 0.5) / W) * MACRO.width - MACRO.width / 2;
        const v = m.w * gauss(x - m.x, z - m.z, m.sx, m.sz);
        if (v > buf[j * W + i]) buf[j * W + i] = v;
      }
    }
  };
  for (const m of marks) splat(wearBuf, m);
  for (const m of rough) splat(roughBuf, m);
  for (let j = 0; j < H; j++) {
    const z = ((j + 0.5) / H) * MACRO.length - MACRO.length / 2;
    for (let i = 0; i < W; i++) {
      const x = ((i + 0.5) / W) * MACRO.width - MACRO.width / 2;
      let wear = wearBuf[j * W + i];
      // The ball's landing zones (2–8.5 m from either set of stumps), a little worn on the stumps' line.
      const az = Math.abs(z);
      const landing = clamp((az - 1.5) / 1.2, 0, 1) * clamp((8.6 - az) / 1.5, 0, 1) * Math.exp(-((x / 0.42) ** 2));
      wear = Math.max(wear, 0.22 * landing * (0.6 + 0.4 * n1(x * 3, z * 1.2)));
      const rg = clamp(roughBuf[j * W + i] * (0.7 + 0.6 * n2(x * 9, z * 9)), 0, 1);
      const soil = clamp(n1(x * 1.3, z * 0.45) * 0.6 + n2(x * 4.1, z * 1.7) * 0.3 + n3(x * 11, z * 6) * 0.1, 0, 1);
      // Grass: patchy, thinner on the line of the stumps and in worn areas, thicker towards the strip's edges.
      const edge = clamp((Math.abs(x) - 1.05) / 0.5, 0, 1);
      const grass = clamp(n3(x * 2.2, z * 0.9) * 0.55 + n1(x * 7, z * 3.1) * 0.3 + 0.15 - 0.18 * Math.exp(-((x / 0.5) ** 2)) + edge * 0.35 - wear * 0.6, 0, 1);
      const k = (j * W + i) * 4;
      data[k] = Math.round(clamp(wear, 0, 1) * 255);
      data[k + 1] = Math.round(rg * 255);
      data[k + 2] = Math.round(soil * 255);
      data[k + 3] = Math.round(grass * 255);
    }
  }
  return dataTexture(data, W, H, false);
}

const pitchTextureCache = new Map<string, DataTexture>();
/** The pitch textures, generated once per page and shared by every stadium (each renderer uploads its own copy). */
function cachedPitchTexture(key: string, make: () => DataTexture): DataTexture {
  let t = pitchTextureCache.get(key);
  if (!t) {
    t = make();
    pitchTextureCache.set(key, t);
  }
  return t;
}

/** Size of the tiling micro texture's tile on the ground (metres). */
const MICRO_TILE = 0.8;

/**
 * The tiling micro detail (MICRO_TILE square, seamless): R soil grain and small stones, G grass blades, B distance to
 * the main crack network, A distance to the fine hairline cracks (both 0 on a crack; domain-warped Voronoi edges).
 */
export function pitchMicroTexture(size: number): DataTexture {
  const S = size;
  const data = new Uint8Array(S * S * 4);
  const grainA = valueNoise(401, 64);
  const grainB = valueNoise(402, 128);
  const warp = valueNoise(403, 8);
  const rand = seededStream(404);
  const voronoi = (N: number, seed: number) => {
    const r = seededStream(seed);
    const pts = new Float32Array(N * N * 2);
    for (let i = 0; i < N * N; i++) {
      pts[i * 2] = 0.15 + r() * 0.7;
      pts[i * 2 + 1] = 0.15 + r() * 0.7;
    }
    return (u: number, v: number) => {
      const gx = u * N;
      const gy = v * N;
      const cx = Math.floor(gx);
      const cy = Math.floor(gy);
      let f1 = 81;
      let f2 = 81;
      for (let dy = -1; dy <= 1; dy++) {
        const iy = (cy + dy + N) % N;
        for (let dx = -1; dx <= 1; dx++) {
          const ix = (cx + dx + N) % N;
          const k = (iy * N + ix) * 2;
          const ex = gx - (cx + dx + pts[k]);
          const ey = gy - (cy + dy + pts[k + 1]);
          const d2 = ex * ex + ey * ey;
          if (d2 < f1) {
            f2 = f1;
            f1 = d2;
          } else if (d2 < f2) f2 = d2;
        }
      }
      return Math.sqrt(f2) - Math.sqrt(f1);
    };
  };
  const main = voronoi(5, 405);
  const fine = voronoi(14, 406);
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const wu = u + (warp(u * 8, v * 8) - 0.5) * 0.045;
      const wv = v + (warp(u * 8 + 3.7, v * 8 + 1.3) - 0.5) * 0.045;
      const g = grainA(u * 64, v * 64) * 0.55 + grainB(u * 128, v * 128) * 0.45;
      const k = (y * S + x) * 4;
      data[k] = Math.round(clamp(g, 0, 1) * 235);
      data[k + 2] = Math.round(clamp(main(((wu % 1) + 1) % 1, ((wv % 1) + 1) % 1) * 2.2, 0, 1) * 255);
      data[k + 3] = Math.round(clamp(fine(((wu * 1.0) % 1 + 1) % 1, ((wv % 1) + 1) % 1) * 2.4, 0, 1) * 255);
    }
  }
  // Small stones: a few bright specks in the grain.
  for (let i = 0; i < S * 1.2; i++) {
    const cx = Math.floor(rand() * S);
    const cy = Math.floor(rand() * S);
    const k = (cy * S + cx) * 4;
    data[k] = 255;
  }
  // Grass blades: short strokes, mostly upright in the tile's v direction, wrapping at the edges.
  const blades = Math.round(S * S * 0.012);
  for (let i = 0; i < blades; i++) {
    const x0 = rand() * S;
    const y0 = rand() * S;
    const len = 5 + rand() * (S / 40);
    const a = Math.PI / 2 + (rand() - 0.5) * 1.3;
    const bright = 120 + Math.floor(rand() * 135);
    for (let s = 0; s < len; s++) {
      const px = Math.floor(x0 + Math.cos(a) * s);
      const py = Math.floor(y0 + Math.sin(a) * s);
      const k = ((((py % S) + S) % S) * S + (((px % S) + S) % S)) * 4 + 1;
      data[k] = Math.max(data[k], Math.round(bright * (1 - (s / len) * 0.5)));
    }
  }
  return dataTexture(data, S, S, true);
}

// ---------------------------------------------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------------------------------------------

const NOISE_GLSL = `
float vh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(vh(i), vh(i + vec2(1.0, 0.0)), u.x), mix(vh(i + vec2(0.0, 1.0)), vh(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { return vnoise(p) * 0.6 + vnoise(p * 2.13 + 7.1) * 0.3 + vnoise(p * 4.7 + 3.3) * 0.1; }
`;

const f = (v: number) => v.toFixed(4);

/** GLSL that sets `cr` (0..1) to the crease paint at `p`, anti-aliased by `aa`, from creaseMarkings(). */
function creaseGlsl(): string {
  return creaseMarkings()
    .map((m) => `cr = max(cr, rectAA(p, vec4(${f(m.x0)}, ${f(m.x1)}, ${f(m.z0)}, ${f(m.z1)}), aa));`)
    .join('\n');
}

interface GroundUniforms {
  [k: string]: { value: unknown };
  uGrassA: { value: Color };
  uGrassB: { value: Color };
  uCentre: { value: number };
  uWet: { value: number };
  uMacro: { value: Texture };
  uMicro: { value: Texture };
  uSoilLight: { value: Color };
  uSoilDark: { value: Color };
  uDustColor: { value: Color };
  uPitchGrass: { value: Color };
  uGrassCover: { value: number };
  uCrack: { value: number };
  uRough: { value: number };
  uDust: { value: number };
  uSheen: { value: number };
  uWear: { value: number };
  uPitchRough: { value: number };
}

/**
 * The ground: outfield and pitch in one material (one draw call, no seam, no z-fighting). The outfield has soft
 * mowing stripes whose tones swap with the viewing direction (the blades lean the way they were mown), concentric
 * bands outside the 30-yard ring, its painted dashes, and blade detail near the camera. The pitch combines the macro
 * masks with the tiling micro detail under the condition's uniforms; the creases are analytic (crisp at any distance)
 * and their paint is worn where feet land. `detail` (standard and high) adds the second micro sample and a bump from
 * cracks, footmarks and grass; lite keeps two texture reads per pixel.
 */
function patchGround(mat: MeshStandardMaterial, u: GroundUniforms, detail: boolean) {
  const W2 = PITCH_WIDTH / 2;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldG;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldG = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${detail ? '#define VANDE_DETAIL 1' : ''}
varying vec3 vWorldG;
uniform vec3 uGrassA, uGrassB, uSoilLight, uSoilDark, uDustColor, uPitchGrass;
uniform float uCentre, uWet, uGrassCover, uCrack, uRough, uDust, uSheen, uWear, uPitchRough;
uniform sampler2D uMacro, uMicro;
float rectAA(vec2 p, vec4 r, vec2 aa) {
  vec2 lo = smoothstep(vec2(r.x, r.z) - aa, vec2(r.x, r.z) + aa, p);
  vec2 hi = 1.0 - smoothstep(vec2(r.y, r.w) - aa, vec2(r.y, r.w) + aa, p);
  return lo.x * lo.y * hi.x * hi.y;
}
vec3 vandeBump(vec3 pos, vec3 n, float h) {
  vec3 dpdx = dFdx(pos); vec3 dpdy = dFdy(pos);
  float dhdx = dFdx(h); float dhdy = dFdy(h);
  vec3 r1 = cross(dpdy, n); vec3 r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
  return normalize(abs(det) * n - grad);
}
`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec2 p = vWorldG.xz;
float r = length(p);
vec3 Vw = normalize(cameraPosition - vWorldG);
// ---- outfield: straight mowing stripes (soft edges) along the pitch. Their tones swap with the viewing direction
// (the blades lean the way they were mown) and fade when seen from above.
float fs = fract(p.x / 6.5 + 0.5);
float stripe = smoothstep(0.0, 0.07, fs) * (1.0 - smoothstep(0.5, 0.57, fs));
float graze = smoothstep(0.15, 0.75, length(Vw.xz));
vec2 vxz = Vw.xz / max(length(Vw.xz), 1e-3);
float along = vxz.y * (stripe * 2.0 - 1.0) * graze;
vec3 grass = mix(uGrassA, uGrassB, 0.5 + 0.4 * along);
#ifdef VANDE_DETAIL
float blades = texture2D(uMicro, p * 0.55).g;
float tuft = texture2D(uMicro, p * 0.071 + 0.31).r;
grass *= 0.86 + 0.22 * blades + 0.16 * (tuft - 0.5);
#else
grass *= 0.94 + 0.12 * texture2D(uMicro, p * 0.071 + 0.31).r;
#endif
grass *= mix(uCentre, 0.84, smoothstep(12.0, ${f(BOUNDARY_R + 4)}, r));
// The 30-yard ring: painted dashes.
float ringAA = fwidth(r) * 0.8 + 0.004;
float dash = smoothstep(0.42, 0.47, fract(atan(p.y, p.x) * ${f(46 / (Math.PI * 2))}));
float ring = (1.0 - smoothstep(0.04 - ringAA, 0.04 + ringAA, abs(r - ${f(RING_R)}))) * dash;
grass = mix(grass, vec3(0.86, 0.88, 0.85), ring * 0.8);
grass *= 1.0 - uWet * 0.18;
// ---- pitch (only near the strip: the outfield never pays for it). Gradients are taken outside the branch, so the
// texture reads inside it keep their mip level.
float ax = abs(p.x);
float az = abs(p.y);
vec2 dpx = dFdx(p);
vec2 dpy = dFdy(p);
vec2 aa = fwidth(p) * 0.8 + 0.0015;
float strip = (1.0 - smoothstep(${f(W2 - 0.04)}, ${f(W2 + 0.35)}, ax)) * (1.0 - smoothstep(12.3, 12.9, az));
vec3 pitchCol = grass;
float pitchRoughness = 0.9;
float hBump = 0.0;
if (ax < 2.3 && az < 13.0) {
  vec2 mScale = vec2(1.0 / ${f(MACRO.width)}, 1.0 / ${f(MACRO.length)});
  vec4 M = textureGrad(uMacro, p * mScale + 0.5, dpx * mScale, dpy * mScale);
  vec4 m1 = textureGrad(uMicro, p / ${f(MICRO_TILE)}, dpx / ${f(MICRO_TILE)}, dpy / ${f(MICRO_TILE)});
#ifdef VANDE_DETAIL
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  vec2 q2 = rot * p / ${f(MICRO_TILE * 0.43)} + vec2(0.37, 0.71);
  vec4 m2 = textureGrad(uMicro, q2, rot * dpx / ${f(MICRO_TILE * 0.43)}, rot * dpy / ${f(MICRO_TILE * 0.43)});
#else
  vec4 m2 = m1;
#endif
  float grain = m1.r * 0.6 + m2.r * 0.4;
  float wear = M.r * uWear;
  float roughP = M.g * uRough;
  vec3 soil = mix(uSoilDark, uSoilLight, clamp(M.b * 0.85 + grain * 0.55 - 0.2, 0.0, 1.0));
  soil = mix(soil, uDustColor, uDust * clamp(0.2 + 0.6 * m2.r + 0.3 * M.b - 0.5 * wear, 0.0, 1.0));
  soil = mix(soil, soil * 0.64, wear * 0.8);
  // Rough: broken, crumbly ground, darker in the hollows with paler loose lumps.
  float lumps = smoothstep(0.55, 0.85, m2.r);
  soil = mix(soil, mix(soil * (0.5 + 0.45 * grain), uDustColor * 0.92, lumps * 0.55), clamp(roughP * 1.1, 0.0, 1.0));
  // Small stones in the surface.
  soil = mix(soil, soil * 1.25 + 0.04, smoothstep(0.93, 1.0, m1.r) * 0.6);
  // Cracks: a patchy network (whole cells on some parts of the surface, broken runs on others), hairlines between.
  float patchy = smoothstep(0.38, 0.78, M.b * 0.9 + uCrack * 0.25 + (m2.g - 0.5) * 0.15);
  float cMain = (1.0 - smoothstep(0.0, 0.02 + 0.06 * uCrack, m1.b)) * patchy * smoothstep(0.25, 0.55, m2.r + 0.25);
  float cFine = (1.0 - smoothstep(0.0, 0.07, m2.a)) * smoothstep(0.05, 0.45, uCrack);
  float cracks = clamp(max(cMain * smoothstep(0.15, 0.9, uCrack), cFine * 0.45 * uCrack), 0.0, 1.0);
  soil *= 1.0 - cracks * 0.5;
  float gd = M.a * 0.62 + m1.g * 0.38;
  float cover = clamp(uGrassCover + smoothstep(1.1, 1.52, ax) * 0.45, 0.0, 1.0);
  float gp = smoothstep(0.85 - cover, 1.15 - cover, gd) * (1.0 - clamp(wear * 1.3, 0.0, 1.0)) * (1.0 - roughP * 0.85);
  pitchCol = mix(soil, uPitchGrass * (0.7 + 0.55 * m1.g), gp);
  float cr = 0.0;
  if (az > 7.6 && az < 11.6) {
${creaseGlsl()}
  }
  cr *= 1.0 - clamp(wear * 1.5, 0.0, 1.0) * smoothstep(0.3, 0.75, grain);
  cr *= 0.86 + 0.14 * grain;
  pitchCol = mix(pitchCol, vec3(0.94, 0.93, 0.89), cr * 0.96);
  pitchRoughness = mix(uPitchRough, 0.96, clamp(roughP + wear * 0.5 + cracks, 0.0, 1.0));
  pitchRoughness = mix(pitchRoughness, 0.6, cr * 0.6);
  hBump = (-0.0028 * cracks - 0.006 * wear - 0.005 * roughP * (1.0 - lumps) + 0.0012 * gp) * strip;
}
diffuseColor.rgb = mix(grass, pitchCol, strip);
`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(mix(0.92, 0.55, uWet), pitchRoughness, strip);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
#ifdef VANDE_DETAIL
normal = vandeBump(-vViewPosition, normal, hBump);
#endif`);
  };
  mat.customProgramCacheKey = () => `vande-ground-v2-${detail ? 'detail' : 'lite'}`;
}

/** The sky dome: a gradient with horizon haze (city glow under lights, sun haze by day), the sun, clouds, stars. */
function skyMaterial(detail: boolean): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uZenith: { value: new Color() },
      uMid: { value: new Color() },
      uHorizon: { value: new Color() },
      uHaze: { value: new Color() },
      uHazeAmt: { value: 0 },
      uSunDir: { value: new Vector3(0, 1, 0) },
      uSunColor: { value: new Color() },
      uSunDisc: { value: 0 },
      uClouds: { value: 0 },
      uCloudColor: { value: new Color() },
      uStars: { value: 0 },
    },
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
varying vec3 vDir;
uniform float uTime, uHazeAmt, uSunDisc, uClouds, uStars;
uniform vec3 uZenith, uMid, uHorizon, uHaze, uSunDir, uSunColor, uCloudColor;
${NOISE_GLSL}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.24, h));
  col = mix(col, uZenith, smoothstep(0.2, 0.85, h));
  float az = atan(d.x, d.z);
  float toSun = max(dot(d, normalize(uSunDir)), 0.0);
  float band = (1.0 - smoothstep(-0.04, 0.22, h)) * (0.6 + 0.4 * vnoise(vec2(az * 6.0, 1.0)));
  col += uHaze * uHazeAmt * (band * 0.8 + pow(toSun, 5.0) * 0.7 * uSunDisc);
  vec2 cp = d.xz / max(h + 0.14, 0.06) * 1.3 + vec2(uTime * 0.0000045, uTime * 0.0000012);
  ${detail ? 'float c = fbm(cp);' : 'float c = vnoise(cp * 1.4) * 0.75 + vnoise(cp * 3.1) * 0.25;'}
  float cover = smoothstep(1.0 - uClouds * 0.85, 1.12 - uClouds * 0.85, c) * smoothstep(0.0, 0.12, h);
  vec3 cloud = uCloudColor * (0.82 + 0.3 * pow(toSun, 2.0) * uSunDisc + 0.12 * c);
  col = mix(col, cloud, cover * 0.88);
  col += uSunColor * uSunDisc * (1.0 - cover * 0.9) * (smoothstep(0.99935, 0.99965, toSun) * 7.0 + pow(toSun, 300.0) * 1.2);
  // Stars: a few small points (a soft dot in some cells), only high up and only through clear sky.
  vec2 sp = vec2(az * 60.0, h * 90.0);
  vec2 sc = floor(sp);
  vec2 so = vec2(vh(sc + 7.3), vh(sc + 1.9)) * 0.6 + 0.2;
  float star = step(0.9965, vh(sc)) * (1.0 - smoothstep(0.02, 0.07, length(fract(sp) - so)));
  col += vec3(0.8, 0.85, 1.0) * star * smoothstep(0.25, 0.6, h) * uStars * (1.0 - cover) * 0.8;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Painted art: original fictional signage only (the VANDE marks), facades, the scoreboard, fabric and rope.
// ---------------------------------------------------------------------------------------------------------------

const FONT = '"Manrope Variable", Manrope, system-ui, sans-serif';

/** What the boundary boards and the fascia carry: the match's own lines, or Practice's neutral boards. */
export type StadiumSignage = 'match' | 'practice';

/**
 * Practice boards: neutral, original panels with no wording, brand, player, team or logo. Eight muted panels per
 * strip, each with a quiet cricket pictogram (a wicket, a seamed ball, a bat, a sight-screen band) or a plain weave,
 * kept dark and low in saturation so nothing at the boundary competes with the ball. 2048 × 64 (1024 × 32 in lite).
 */
export function paintPracticeBoards(g: CanvasRenderingContext2D) {
  const panels = ['#16301f', '#1b2433', '#2a1c22', '#1f2326', '#18282c', '#262119', '#1a2230', '#22201f'];
  const ink = 'rgba(214,220,210,0.42)';
  const pw = 2048 / panels.length;
  panels.forEach((bg, i) => {
    const x0 = i * pw;
    g.fillStyle = bg;
    g.fillRect(x0, 0, pw, 64);
    // A faint inner frame and a darker seam between panels.
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.lineWidth = 2;
    g.strokeRect(x0 + 6, 6, pw - 12, 52);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(x0, 0, 3, 64);
    const cx = x0 + pw / 2;
    g.save();
    g.strokeStyle = ink;
    g.fillStyle = ink;
    g.lineWidth = 3;
    g.lineCap = 'round';
    switch (i % 4) {
      case 0: {
        // A wicket: three stumps and two bails.
        for (const dx of [-12, 0, 12]) {
          g.beginPath();
          g.moveTo(cx + dx, 50);
          g.lineTo(cx + dx, 18);
          g.stroke();
        }
        g.fillRect(cx - 14, 13, 13, 3);
        g.fillRect(cx + 1, 13, 13, 3);
        break;
      }
      case 1: {
        // A solid ball with one stitched seam (a single disc: never read as interlocking rings).
        g.beginPath();
        g.arc(cx, 32, 14, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = bg;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(cx - 26, 32, 28, -0.52, 0.52);
        g.stroke();
        for (let k = -3; k <= 3; k++) {
          const a = k * 0.13;
          const x = cx - 26 + Math.cos(a) * 28;
          const y = 32 + Math.sin(a) * 28;
          g.beginPath();
          g.moveTo(x - 3, y);
          g.lineTo(x + 3, y);
          g.stroke();
        }
        break;
      }
      case 2: {
        // A bat, laid across the panel.
        g.save();
        g.translate(cx, 32);
        g.rotate(-0.38);
        g.fillRect(-46, -6, 62, 12);
        g.fillRect(16, -2.5, 30, 5);
        g.restore();
        break;
      }
      default: {
        // A plain weave of short dashes.
        g.lineWidth = 2;
        for (let y = 18; y <= 46; y += 7)
          for (let x = x0 + 26 + ((y / 7) % 2) * 8; x < x0 + pw - 26; x += 16) {
            g.beginPath();
            g.moveTo(x, y);
            g.lineTo(x + 8, y);
            g.stroke();
          }
      }
    }
    g.restore();
  });
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let y = 0; y < 64; y += 4) g.fillRect(0, y, 2048, 1);
}

/** LED board strip: brand lockup and abstract glyphs (our own brand only), or Practice's neutral panels. 2048 × 64, or 1024 × 32 in lite. */
function boardTexture(detail = true, signage: StadiumSignage = 'match'): Texture {
  const t = canvasArt(2048, 64, (g) => {
    if (signage === 'practice') {
      paintPracticeBoards(g);
      return;
    }
    const grd = g.createLinearGradient(0, 0, 2048, 0);
    grd.addColorStop(0, '#0b0930');
    grd.addColorStop(0.5, '#151154');
    grd.addColorStop(1, '#0b0930');
    g.fillStyle = grd;
    g.fillRect(0, 0, 2048, 64);
    g.font = `800 38px ${FONT}`;
    g.textBaseline = 'middle';
    const items = ['VANDE CRICKET', 'SEALED SIX', 'LOCK YOUR OVER', 'REVEAL THE RIVALRY'];
    let x = 30;
    items.forEach((s, i) => {
      g.fillStyle = i % 2 ? '#ffb347' : '#5fe3ff';
      g.fillText(s, x, 34);
      x += g.measureText(s).width + 40;
      g.save();
      g.translate(x, 32);
      g.strokeStyle = '#ffffff';
      g.globalAlpha = 0.65;
      g.lineWidth = 3;
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        g.moveTo(0, 0);
        g.lineTo(Math.cos(a) * 14, Math.sin(a) * 14);
      }
      g.stroke();
      g.restore();
      x += 50;
    });
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 64; i += 4) g.fillRect(0, i, 2048, 1);
  }, [11, 9, 48, 255], detail ? 1 : 0.5);
  t.wrapS = RepeatWrapping;
  // Negative repeat mirrors U: the boards are seen from inside the ring, where a cylinder's U runs right to left.
  t.repeat.set(-6, 1);
  return t;
}

export function glowTexture(): Texture {
  return canvasArt(128, 128, (g) => {
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.18, 'rgba(255,245,220,0.75)');
    grd.addColorStop(0.45, 'rgba(255,214,150,0.22)');
    grd.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  }, [255, 255, 255, 0]);
}

/**
 * The pavilion's facade (1024 × 512 over the 56 m front): a sandstone ground floor with arches and the players' gate,
 * two storeys of members' balconies with white railings and dark glazing, the dressing rooms' balconies either side,
 * a cornice. The window mask (second painter) lights the glazing at night.
 */
function paintFacade(g: CanvasRenderingContext2D, w: number, h: number, mask: boolean) {
  const { range } = rng(611);
  g.fillStyle = mask ? '#000000' : '#d9cdb3';
  g.fillRect(0, 0, w, h);
  if (!mask) {
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(150,130,100,${range(0.03, 0.08).toFixed(3)})`;
      g.fillRect(range(0, w), range(0, h), range(2, 14), range(1, 3));
    }
    // Stone courses.
    g.fillStyle = 'rgba(120,104,80,0.18)';
    for (let y = 0; y < h; y += 12) g.fillRect(0, y, w, 1);
  }
  const storey = (y0: number, y1: number, bays: number, dressing: boolean) => {
    const bw = w / bays;
    for (let b = 0; b < bays; b++) {
      const x0 = b * bw + bw * 0.12;
      const x1 = (b + 1) * bw - bw * 0.12;
      const lit = range(0, 1);
      if (mask) {
        g.fillStyle = `rgba(255,${200 + Math.floor(range(0, 40))},${130 + Math.floor(range(0, 60))},${(0.35 + lit * 0.5).toFixed(2)})`;
        g.fillRect(x0 + 3, y0 + 4, x1 - x0 - 6, (y1 - y0) * 0.72);
        continue;
      }
      // Glazing: dark glass with a faint sky reflection gradient.
      const glass = g.createLinearGradient(0, y0, 0, y1);
      glass.addColorStop(0, '#3a4658');
      glass.addColorStop(1, '#151b26');
      g.fillStyle = glass;
      g.fillRect(x0, y0 + 2, x1 - x0, (y1 - y0) * 0.76);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      for (let m = x0 + 8; m < x1; m += 16) g.fillRect(m, y0 + 2, 1.5, (y1 - y0) * 0.76);
      // Balcony slab and white railing.
      g.fillStyle = '#efe9dc';
      g.fillRect(b * bw, y0 + (y1 - y0) * 0.78, bw, 4);
      g.fillStyle = 'rgba(250,250,246,0.85)';
      g.fillRect(b * bw, y0 + (y1 - y0) * 0.6, bw, 2);
      for (let s = b * bw; s < (b + 1) * bw; s += 5) g.fillRect(s, y0 + (y1 - y0) * 0.6, 1, (y1 - y0) * 0.18);
      if (dressing) {
        g.fillStyle = 'rgba(30,42,120,0.85)';
        g.fillRect(x0, y0 + (y1 - y0) * 0.62, x1 - x0, (y1 - y0) * 0.14);
      }
    }
  };
  storey(h * 0.08, h * 0.36, 14, false);
  storey(h * 0.36, h * 0.64, 14, false);
  // Ground floor: arches, the dressing-room wings and the players' gate (centre-left), plus the cornice.
  if (!mask) {
    g.fillStyle = '#c9b996';
    g.fillRect(0, h * 0.64, w, h * 0.36);
    for (let a = 0; a < 18; a++) {
      const cx = (a + 0.5) * (w / 18);
      g.fillStyle = a === 7 ? '#1d2230' : '#2e3442';
      g.beginPath();
      g.moveTo(cx - 16, h);
      g.lineTo(cx - 16, h * 0.78);
      g.arc(cx, h * 0.78, 16, Math.PI, 0);
      g.lineTo(cx + 16, h);
      g.closePath();
      g.fill();
    }
    g.fillStyle = '#1e2a78';
    g.fillRect(w * 0.37, h * 0.66, w * 0.08, 10);
    g.fillStyle = '#e8e2d2';
    g.fillRect(0, h * 0.04, w, 8);
    g.fillRect(0, h * 0.62, w, 6);
  } else {
    for (let a = 0; a < 18; a++) {
      const cx = (a + 0.5) * (w / 18);
      g.fillStyle = 'rgba(255,214,150,0.45)';
      g.fillRect(cx - 10, h * 0.8, 20, h * 0.14);
    }
  }
  // The dressing rooms: the outer bays of the first floor, flagged with navy and teal panels.
  storey(h * 0.36, h * 0.64, 14, true);
}

/** The scoreboard's display: an original layout (the VANDE mark, segment numerals at rest, progress bars); no text. */
function paintScoreboard(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#05060f';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#1e2a78';
  g.lineWidth = 6;
  g.strokeRect(8, 8, w - 16, h - 16);
  // The mark.
  g.strokeStyle = '#19c6ee';
  g.lineWidth = 14;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(70, 110);
  g.lineTo(130, 230);
  g.lineTo(190, 110);
  g.stroke();
  // Seven-segment numerals, unlit segments faint, lit ones warm.
  const seg = (x: number, y: number, s: number, lit: boolean[]) => {
    const pts: Array<[number, number, number, number]> = [
      [0, 0, 1, 0], [1, 0, 1, 1], [1, 1, 1, 2], [0, 2, 1, 2], [0, 1, 0, 2], [0, 0, 0, 1], [0, 1, 1, 1],
    ];
    pts.forEach(([a, b, c, d], i) => {
      g.strokeStyle = lit[i] ? '#ffcf6a' : 'rgba(255,207,106,0.09)';
      g.lineWidth = s * 0.16;
      g.beginPath();
      g.moveTo(x + a * s, y + b * s);
      g.lineTo(x + c * s, y + d * s);
      g.stroke();
    });
  };
  const DASH = [false, false, false, false, false, false, true];
  for (let i = 0; i < 3; i++) seg(300 + i * 120, 70, 70, DASH);
  for (let i = 0; i < 2; i++) seg(700 + i * 120, 70, 70, DASH);
  // Bars (an over's progress, unlit).
  for (let i = 0; i < 6; i++) {
    g.fillStyle = 'rgba(25,198,238,0.18)';
    g.fillRect(300 + i * 90, 280, 70, 22);
  }
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
}

/** The sight screen's face: a near-uniform board (its tone is the material colour) with faint panel seams. */
function paintScreen(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0,0,0,0.035)';
  for (let x = w / 6; x < w; x += w / 6) g.fillRect(x, 0, 1, h);
  g.fillRect(0, h / 2, w, 1);
}

/** The boundary cushion's fabric: navy with a low-contrast chevron print and a stitched top seam. */
function paintCushion(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#18225e';
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let x = 0; x < w; x += 2) g.fillRect(x, 0, 1, h);
  g.strokeStyle = 'rgba(25,198,238,0.32)';
  g.lineWidth = 3;
  for (let x = 24; x < w; x += 128) {
    g.beginPath();
    g.moveTo(x, h * 0.3);
    g.lineTo(x + 14, h * 0.62);
    g.lineTo(x + 28, h * 0.3);
    g.stroke();
  }
  g.fillStyle = 'rgba(240,240,240,0.35)';
  for (let x = 0; x < w; x += 6) g.fillRect(x, h * 0.08, 3, 1);
}

/** A three-strand rope's twist. */
function paintRope(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#e9e2cf';
  g.fillRect(0, 0, w, h);
  for (let x = -h; x < w + h; x += 10) {
    const grd = g.createLinearGradient(x, 0, x + 10, 0);
    grd.addColorStop(0, 'rgba(120,100,70,0.55)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.0)');
    grd.addColorStop(1, 'rgba(120,100,70,0.55)');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + 10, 0);
    g.lineTo(x + 10 + h * 0.8, h);
    g.lineTo(x + h * 0.8, h);
    g.closePath();
    g.fill();
  }
}

/** Four original flags in a 2 × 2 atlas. */
function paintFlags(g: CanvasRenderingContext2D, w: number, h: number) {
  const cw = w / 2;
  const ch = h / 2;
  const designs: Array<(x: number, y: number) => void> = [
    (x, y) => {
      g.fillStyle = '#1e2a78';
      g.fillRect(x, y, cw, ch);
      g.strokeStyle = '#19c6ee';
      g.lineWidth = 14;
      g.beginPath();
      g.moveTo(x + cw * 0.3, y + ch * 0.25);
      g.lineTo(x + cw * 0.5, y + ch * 0.75);
      g.lineTo(x + cw * 0.7, y + ch * 0.25);
      g.stroke();
    },
    (x, y) => {
      g.fillStyle = '#ffb020';
      g.fillRect(x, y, cw, ch);
      g.fillStyle = '#14161f';
      g.fillRect(x, y + ch * 0.42, cw, ch * 0.16);
    },
    (x, y) => {
      g.fillStyle = '#f5f5f0';
      g.fillRect(x, y, cw, ch);
      g.fillStyle = '#0e7c86';
      g.fillRect(x, y, cw * 0.28, ch);
      g.fillStyle = '#c9a227';
      g.fillRect(x + cw * 0.28, y, cw * 0.06, ch);
    },
    (x, y) => {
      g.fillStyle = '#0e7c86';
      g.fillRect(x, y, cw, ch);
      g.strokeStyle = '#ffcf6a';
      g.lineWidth = 10;
      g.beginPath();
      g.moveTo(x + cw * 0.18, y + ch * 0.2);
      g.lineTo(x + cw * 0.5, y + ch * 0.8);
      g.lineTo(x + cw * 0.82, y + ch * 0.2);
      g.stroke();
    },
  ];
  designs.forEach((d, i) => d((i % 2) * cw, Math.floor(i / 2) * ch));
}

/** A floodlight bank's face: a grid of lamp lenses on a dark frame. */
function paintLamps(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#20232b';
  g.fillRect(0, 0, w, h);
  const cols = 8;
  const rows = 5;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = ((c + 0.5) / cols) * w;
      const cy = ((r + 0.5) / rows) * h;
      const rad = Math.min(w / cols, h / rows) * 0.38;
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
      grd.addColorStop(0, '#ffffff');
      grd.addColorStop(0.7, '#e8e4dc');
      grd.addColorStop(1, '#5a5c62');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(cx, cy, rad, 0, Math.PI * 2);
      g.fill();
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Stands and crowd (constitution §29). Two tiers of stepped rows; the instanced spectators fill the front rows of the
// lower tier (as many rows as the quality tier's crowd count covers) and the painted crowd the rest. Everything that
// moves is gated by the excitement the stage passes (the emotion signal): at a hush the crowd is still.
// ---------------------------------------------------------------------------------------------------------------

interface Tier {
  r0: number;
  r1: number;
  y0: number;
  y1: number;
  rows: number;
}

/** One tier of stands: stepped rows (riser + tread) facing the field, with gaps behind both ends for the screens. */
function tierGeometry(t: Tier, gaps: Array<[number, number]>, segments: number): BufferGeometry {
  const pos: number[] = [];
  const step = (Math.PI * 2) / segments;
  const inGap = (mid: number) =>
    gaps.some(([g0, g1]) => {
      const d = Math.atan2(Math.sin(mid - g0), Math.cos(mid - g0));
      return d >= 0 && d <= g1 - g0;
    });
  // Wound to face the field (risers) and the sky (treads), so the stands are seen from inside the ground.
  const quad = (a: number[], b: number[], c: number[], d: number[]) => pos.push(...a, ...c, ...b, ...a, ...d, ...c);
  for (let row = 0; row < t.rows; row++) {
    const ra = t.r0 + ((t.r1 - t.r0) * row) / t.rows;
    const rb = t.r0 + ((t.r1 - t.r0) * (row + 1)) / t.rows;
    const ya = t.y0 + ((t.y1 - t.y0) * row) / t.rows;
    const yb = t.y0 + ((t.y1 - t.y0) * (row + 1)) / t.rows;
    for (let i = 0; i < segments; i++) {
      const a0 = i * step;
      const a1 = a0 + step;
      if (inGap(a0 + step / 2)) continue;
      const P = (a: number, r: number, y: number) => [Math.sin(a) * r, y, Math.cos(a) * r];
      quad(P(a0, ra, ya), P(a1, ra, ya), P(a1, ra, yb), P(a0, ra, yb));
      quad(P(a0, ra, yb), P(a1, ra, yb), P(a1, rb, yb), P(a0, rb, yb));
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return g;
}

/**
 * The painted crowd and the seating, per seat cell: section-coloured seats, aisles every 18 m with their steps,
 * vomitory entrances, shirts and heads, phone lights at night. Arms go up with the excitement (none at a hush), and
 * the painted crowd leaves the rows the instanced spectators sit in (below uPaintFrom) to empty seats.
 */
function patchStands(mat: MeshBasicMaterial, u: Record<string, { value: unknown }>, detail: boolean) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldS;\nvarying float vUpS;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldS = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvUpS = normal.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${detail ? '#define VANDE_STANDS_DETAIL 1' : ''}
varying vec3 vWorldS;
varying float vUpS;
uniform float uTime, uExcite, uPhones, uFront, uBack, uPaintFrom;
uniform vec3 uTeamA, uTeamB, uAmbient;
float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }
vec3 shirt(float h, float region) {
  if (h < 0.18 + region * 0.2) return uTeamA;
  if (h < 0.34 + region * 0.12) return uTeamB;
  if (h < 0.46) return vec3(0.95, 0.95, 0.93);
  if (h < 0.56) return vec3(1.0, 0.7, 0.28);
  if (h < 0.64) return vec3(0.37, 0.8, 0.95);
  if (h < 0.72) return vec3(0.9, 0.36, 0.5);
  if (h < 0.8) return vec3(1.0, 0.83, 0.43);
  if (h < 0.88) return vec3(0.18, 0.2, 0.26);
  return vec3(0.49, 0.84, 0.7);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float ang = atan(vWorldS.x, vWorldS.z);
float rr = length(vWorldS.xz);
float s = ang * rr;
float sect = floor(s / 18.0);
float aisleD = abs(mod(s, 18.0) - 9.0);
// Risers are seen face on (people from the front), treads from above (heads and shoulders).
float top = step(0.5, vUpS);
vec2 cc = vec2(s / 0.62, mix(vWorldS.y, rr, top) / 0.62);
vec2 cell = floor(cc);
vec2 f = fract(cc);
float h = h21(cell);
float region = step(0.6, h21(vec2(sect, 3.0)));
vec3 seat = mix(vec3(0.07, 0.09, 0.22), vec3(0.04, 0.2, 0.24), step(0.5, fract(sect * 0.5)));
float occ = step(0.13, h) * step(uPaintFrom, vWorldS.y);
float spill = mix(uFront, uBack, smoothstep(2.0, 27.0, vWorldS.y));
vec3 sh = shirt(fract(h * 7.31), region) * (0.5 + 0.35 * fract(h * 3.7));
float e = clamp((uExcite - ${CROWD_HUSH.toFixed(2)}) / ${(1 - CROWD_HUSH).toFixed(2)}, 0.0, 1.0);
float lift = e * step(0.55, fract(h * 5.3 + 0.13 * sin(uTime * 0.003 + h * 40.0)));
#ifdef VANDE_STANDS_DETAIL
float body = mix(step(0.2, f.x) * step(f.x, 0.8) * step(f.y, 0.58 + 0.12 * lift), 1.0 - step(0.36, length((f - 0.5) * vec2(1.0, 1.35))), top);
float head = mix(1.0 - step(0.15, length((f - vec2(0.5, 0.74 + 0.1 * lift)) * vec2(1.0, 1.2))), 1.0 - step(0.16, length(f - vec2(0.5, 0.44))), top);
float arms = (1.0 - top) * lift * step(0.86, f.y) * (step(0.12, f.x) * step(f.x, 0.24) + step(0.76, f.x) * step(f.x, 0.88));
vec3 skin = vec3(0.52, 0.36, 0.25);
vec3 detail = mix(seat, sh, occ * body);
detail = mix(detail, skin, occ * max(head, arms));
vec3 avg = mix(seat, sh, occ * 0.5);
float px = max(length(fwidth(cc)), 1e-4);
vec3 col = mix(detail, avg, smoothstep(0.35, 0.9, px)) * spill;
#else
// Lite: each seat cell is its average (a person's shirt or an empty seat), no figure detail.
vec3 col = mix(seat, sh, occ * (0.55 + 0.25 * lift)) * spill;
#endif
// Aisles: lighter concrete steps; vomitories: dark entrances at every third aisle, low in the tier.
float aisle = 1.0 - smoothstep(0.55, 0.62, aisleD);
vec3 steps = vec3(0.32, 0.33, 0.36) * (0.85 + 0.15 * step(0.5, fract(vWorldS.y / 0.33))) * spill * 1.3;
col = mix(col, steps, aisle);
float vom = (1.0 - smoothstep(1.6, 1.7, aisleD)) * step(mod(sect, 3.0), 0.5) * step(2.0, vWorldS.y) * step(vWorldS.y, 4.6) * step(rr, ${f(BOUNDARY_R + 27)});
col = mix(col, vec3(0.012, 0.012, 0.02), vom);
col *= uAmbient;
// Phone lights at night: more of them as the crowd gets louder (their flicker freezes in Delivery Quiet Mode).
float tw = step(0.9975 - uExcite * 0.006, h21(cell + floor(uTime * 0.0021)));
col += vec3(1.0, 0.98, 0.92) * tw * occ * 1.6 * uPhones * (1.0 - aisle);
diffuseColor.rgb = col;
`,
      );
  };
  mat.customProgramCacheKey = () => `vande-stands-v3-${detail ? 'detail' : 'lite'}`;
}

/** At or below this excitement (the emotion signal's arousal) the crowd is still: a hush. */
export const CROWD_HUSH = 0.12;

interface CrowdUniforms {
  [k: string]: { value: unknown };
  uTime: { value: number };
  uExcite: { value: number };
  uAnimate: { value: number };
  uAllowStand: { value: number };
  uWave: { value: number };
  uWaveT: { value: number };
  uMood: { value: number };
  uExpect: { value: number };
  uFocus: { value: Vector3 };
  uAmb: { value: Color };
  uSunCol: { value: Color };
  uSunDir: { value: Vector3 };
  fogColor: { value: Color };
  fogNear: { value: number };
  fogFar: { value: number };
}

/**
 * The instanced crowd. Seated by default; with the excitement (never a constant loop) they fidget, clap, stand
 * (medium and high tiers, each at their own threshold), raise their arms in celebration or put their hands on their
 * heads in dismay (the mood), and near the ball (setCrowdFocus) they react more. A wave of standing spectators runs
 * round the ground at full voice (high tier). At a hush (excitement ≤ 0.12) nobody moves.
 */
function crowdMaterial(u: CrowdUniforms): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: u,
    vertexShader: `
attribute float aPart;
attribute vec3 aSkin;
attribute vec4 aMisc;
attribute vec2 aSeat;
uniform float uTime, uExcite, uAnimate, uAllowStand, uWave, uWaveT, uMood, uExpect;
uniform vec3 uFocus, uAmb, uSunCol, uSunDir;
varying vec3 vColor;
varying float vDepth;
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
void main() {
  vec3 p = position;
  vec3 n = normal;
  vec4 base = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float near = uFocus.z * (1.0 - smoothstep(5.0, 26.0, distance(base.xz, uFocus.xy)));
  float live = smoothstep(${CROWD_HUSH.toFixed(2)}, 0.28, max(uExcite, near)) * uAnimate;
  float e = clamp(uExcite * (0.72 + 0.56 * aSeat.y) + near * 0.8 + uExpect * 0.15, 0.0, 1.0);
  float ph = aMisc.x * 6.2831853;
  float glad = step(-0.2, uMood);
  float stand = uAllowStand * live * glad * smoothstep(aMisc.y, aMisc.y + 0.1, e);
  float wp = fract(aSeat.x / 6.2831853 - uWaveT);
  stand = max(stand, uWave * live * smoothstep(0.0, 0.025, wp) * (1.0 - smoothstep(0.05, 0.09, wp)));
  float cheer = live * glad * smoothstep(0.55, 0.85, e) * step(0.3, fract(aMisc.x * 7.3));
  float dismay = live * (1.0 - glad) * smoothstep(0.35, 0.65, e) * step(0.35, fract(aMisc.x * 5.1));
  float clap = live * smoothstep(0.2, 0.5, e) * (1.0 - cheer) * (1.0 - dismay) * step(0.45, fract(aMisc.x * 3.7));
  float lean = live * uExpect * 0.25;
  // Parts: 0 torso, 1 head, 2 hair or cap, 3/4 arms (left/right), 5 thighs, 6 shins.
  if (aPart > 2.5 && aPart < 4.5) {
    float side = aPart < 3.5 ? 1.0 : -1.0;
    vec3 pivot = vec3(0.21 * side, 0.84, 0.0);
    float up = cheer * (2.5 + 0.25 * sin(uTime * 0.012 + ph)) + dismay * 2.35 + clap * (1.15 + 0.12 * sin(uTime * 0.03 + ph));
    float spread = cheer * 0.35 - dismay * 0.45 - clap * 0.42;
    vec3 q = rotZ(spread * side) * rotX(-up) * (p - pivot);
    n = rotZ(spread * side) * rotX(-up) * n;
    p = q + pivot;
  }
  if (aPart > 4.5 && aPart < 5.5) {
    vec3 st = vec3(p.x, 0.9 - p.z * 1.19, p.y - 0.45);
    p = mix(p, st, stand);
  } else if (aPart > 5.5) {
    vec3 st = vec3(p.x, p.y * 1.12, p.z - 0.38);
    p = mix(p, st, stand);
  } else {
    p.y += 0.45 * stand;
    p.z += lean * (p.y - 0.45);
  }
  p.y += live * e * 0.035 * max(0.0, sin(uTime * 0.009 + ph * 3.0)) * (1.0 - stand);
  vec4 wp4 = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vec3 wn = normalize(mat3(modelMatrix * instanceMatrix) * n);
  vec3 col = aPart < 0.5 ? instanceColor : aPart < 1.5 ? aSkin : aPart < 2.5 ? (aMisc.z > 0.5 ? instanceColor.bgr * 0.9 : vec3(0.05, 0.04, 0.035)) : aPart < 4.5 ? (aMisc.w > 0.5 ? instanceColor : aSkin) : vec3(0.14, 0.15, 0.2) + 0.12 * aMisc.x;
  float lit = 0.5 + 0.5 * clamp(wn.y * 0.5 + 0.55, 0.0, 1.0);
  vColor = col * (uAmb * lit + uSunCol * max(dot(wn, uSunDir), 0.0));
  vec4 mv = viewMatrix * wp4;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `
uniform vec3 fogColor; uniform float fogNear; uniform float fogFar;
varying vec3 vColor; varying float vDepth;
void main() {
  float f = smoothstep(fogNear, fogFar, vDepth);
  gl_FragColor = vec4(mix(vColor, fogColor, f * 0.85), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
}

/** A seated spectator facing +z (parts tagged for the vertex shader): about 100 triangles (80 in lite). */
function spectatorGeometry(detail: boolean): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const tag = (g: BufferGeometry, part: number) => {
    g.deleteAttribute('uv');
    g.setAttribute('aPart', new BufferAttribute(new Float32Array(g.attributes.position.count).fill(part), 1));
    parts.push(g.index ? g : g);
  };
  const torso = new BoxGeometry(0.38, 0.46, 0.24);
  torso.translate(0, 0.66, -0.02);
  tag(torso, 0);
  const head = new SphereGeometry(0.105, detail ? 6 : 5, detail ? 4 : 3);
  head.translate(0, 1.0, 0.0);
  tag(head, 1);
  if (detail) {
    const hair = new SphereGeometry(0.113, 6, 1, 0, Math.PI * 2, 0, Math.PI * 0.42);
    hair.translate(0, 1.012, -0.005);
    tag(hair, 2);
  }
  for (const side of [1, -1]) {
    const arm = new BoxGeometry(0.085, 0.4, 0.09);
    arm.translate(0.21 * side, 0.65, 0.04);
    tag(arm, side > 0 ? 3 : 4);
  }
  const thighs = new BoxGeometry(0.36, 0.14, 0.38);
  thighs.translate(0, 0.45, 0.17);
  tag(thighs, 5);
  const shins = new BoxGeometry(0.3, 0.42, 0.12);
  shins.translate(0, 0.21, 0.38);
  tag(shins, 6);
  return mergeGeometries(parts)!;
}

/**
 * Banners and flags held up in the crowd (high tier): hidden at a hush, raised and waving with the excitement (they
 * come up in celebrations, after the ball is dead, never during a delivery's hush). Uses the flag atlas.
 */
function crowdBannerMaterial(u: CrowdUniforms, atlas: Texture): ShaderMaterial {
  return new ShaderMaterial({
    side: DoubleSide,
    uniforms: { ...u, uAtlas: { value: atlas } },
    vertexShader: `
attribute float aCloth;
attribute vec2 aClothUv;
attribute vec2 aBanner;
uniform float uTime, uExcite, uAnimate;
uniform vec3 uAmb, uFocus;
varying vec2 vUv;
varying vec3 vShade;
varying float vDepth;
void main() {
  vec4 base = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float near = uFocus.z * (1.0 - smoothstep(5.0, 26.0, distance(base.xz, uFocus.xy)));
  float e = max(uExcite, near) * uAnimate;
  float lift = smoothstep(aBanner.y, aBanner.y + 0.12, e);
  vec3 p = position;
  p.z += aCloth * sin(aClothUv.x * 4.0 - uTime * 0.007 + aBanner.x * 6.2831) * 0.11 * aClothUv.x * lift;
  p.y -= 1.7 * (1.0 - lift);
  p *= step(0.02, lift);
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  float cell = floor(aBanner.x * 4.0);
  vUv = vec2(mod(cell, 2.0) * 0.5 + aClothUv.x * 0.5, (1.0 - floor(cell / 2.0)) * 0.5 + aClothUv.y * 0.5);
  vShade = uAmb * (aCloth > 0.5 ? 1.0 : 0.5);
  vec4 mv = viewMatrix * wp;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `
uniform sampler2D uAtlas;
uniform vec3 fogColor; uniform float fogNear; uniform float fogFar;
varying vec2 vUv; varying vec3 vShade; varying float vDepth;
void main() {
  vec3 c = texture2D(uAtlas, vUv).rgb * vShade;
  gl_FragColor = vec4(mix(c, fogColor, smoothstep(fogNear, fogFar, vDepth) * 0.85), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
}

/** A hand-held flag: a pole and a 0.9 × 0.6 m cloth (aCloth 1, with its own uv for the wave and the atlas). */
function crowdBannerGeometry(): BufferGeometry {
  const pole = new BoxGeometry(0.03, 1.5, 0.03).translate(0, 1.55, 0);
  pole.deleteAttribute('uv');
  pole.setAttribute('aCloth', new BufferAttribute(new Float32Array(pole.attributes.position.count), 1));
  pole.setAttribute('aClothUv', new BufferAttribute(new Float32Array(pole.attributes.position.count * 2), 2));
  const cloth = new PlaneGeometry(0.9, 0.6, 6, 2).translate(0.45, 1.98, 0);
  const uv = cloth.attributes.uv as BufferAttribute;
  cloth.setAttribute('aClothUv', new BufferAttribute(new Float32Array(uv.array), 2));
  cloth.deleteAttribute('uv');
  cloth.setAttribute('aCloth', new BufferAttribute(new Float32Array(cloth.attributes.position.count).fill(1), 1));
  return mergeGeometries([pole.toNonIndexed(), cloth.toNonIndexed()])!;
}

// ---------------------------------------------------------------------------------------------------------------
// Structures: sight screens, the pavilion and the players' area, the scoreboard stand, camera platforms, flags,
// railings and the floodlight towers. Merged geometry per material keeps the draw calls few.
// ---------------------------------------------------------------------------------------------------------------

/** Sight screens (constitution §28): real size behind both ends, matte, no glowing edges. */
export const SIGHT_SCREEN = Object.freeze({ width: 18, height: 7.5, distance: BOUNDARY_R + 6.5, base: 0.0 });
/** Screen tones: dark behind a white ball, off-white behind a red one (and their luminance-raising emissive). */
export const SIGHT_TONES = Object.freeze({ dark: '#0a0c15', white: '#e7e4da' });

const placed = (g: BufferGeometry, x: number, y: number, z: number, ry = 0): BufferGeometry => {
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
};

function box(w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): BufferGeometry {
  return placed(new BoxGeometry(w, h, d), x, y, z, ry);
}

/** A gable roof (prism) of width w (x), depth d (z) and rise h, its eaves at y0. */
function gableRoof(w: number, d: number, h: number, x: number, y0: number, z: number): BufferGeometry {
  const hw = w / 2;
  const hd = d / 2;
  const v = [
    [-hw, 0, -hd], [hw, 0, -hd], [hw, h, 0], [-hw, h, 0],
    [-hw, 0, hd], [hw, 0, hd], [hw, h, 0], [-hw, h, 0],
  ];
  const pos: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c);
  tri(v[0], v[3], v[2]);
  tri(v[0], v[2], v[1]);
  tri(v[4], v[5], v[6]);
  tri(v[4], v[6], v[7]);
  tri(v[0], v[4], v[7]);
  tri(v[1], v[2], v[5]);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  g.translate(x, y0, z);
  return g;
}

const strip = (g: BufferGeometry) => {
  const n = g.index ? g.toNonIndexed() : g;
  if (!n.attributes.uv) n.setAttribute('uv', new BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
  return n;
};
const mergeAll = (gs: BufferGeometry[]) => mergeGeometries(gs.map(strip))!;

interface Structures {
  group: Group;
  screenMat: MeshStandardMaterial;
  windowsMat: MeshLambertMaterial;
  boardMat: MeshBasicMaterial;
  flagUniforms: { uFlagT: { value: number } };
  lampsMat: MeshBasicMaterial;
  glows: Mesh[];
  shafts: Mesh[];
  shaftMat: ShaderMaterial;
  roofLineMat: MeshBasicMaterial;
  flagMat: MeshLambertMaterial;
  flagTex: Texture;
  /** Masonry and facades: darker under lights (they get only the spill), full by day. */
  masonry: MeshLambertMaterial[];
}

function buildStructures(track: <T extends { dispose(): void }>(x: T) => T, detail: boolean, signage: StadiumSignage): Structures {
  // Lite keeps every painted texture at or under 1024 px.
  const group = new Group();
  group.name = 'structures';
  const D = SIGHT_SCREEN.distance;

  // ---- Sight screens: the board, its steel frame and the back trusses on wheels.
  const screenTex = track(canvasArt(256, 128, paintScreen));
  const screenMat = track(new MeshStandardMaterial({ color: SIGHT_TONES.dark, map: screenTex, roughness: 1, metalness: 0 }));
  const steel: BufferGeometry[] = [];
  for (const z of [1, -1]) {
    const s = new Mesh(track(new BoxGeometry(SIGHT_SCREEN.width, SIGHT_SCREEN.height, 0.3)), screenMat);
    s.position.set(0, SIGHT_SCREEN.base + SIGHT_SCREEN.height / 2, z * D);
    s.name = 'sight-screen';
    group.add(s);
    const zb = z * (D + 0.3);
    steel.push(box(SIGHT_SCREEN.width + 0.3, 0.18, 0.36, 0, SIGHT_SCREEN.height + 0.09, z * D));
    steel.push(box(0.18, SIGHT_SCREEN.height, 0.36, -SIGHT_SCREEN.width / 2 - 0.09, SIGHT_SCREEN.height / 2, z * D));
    steel.push(box(0.18, SIGHT_SCREEN.height, 0.36, SIGHT_SCREEN.width / 2 + 0.09, SIGHT_SCREEN.height / 2, z * D));
    for (let i = -3; i <= 3; i++) {
      steel.push(box(0.14, SIGHT_SCREEN.height * 0.92, 1.6, i * 2.9, SIGHT_SCREEN.height * 0.46, zb + z * 0.8));
      steel.push(box(0.5, 0.5, 0.5, i * 2.9, 0.25, zb + z * 1.4));
    }
  }

  // ---- Pavilion (behind the bowler's end) and the players' area beside the screen.
  const PZ = -(BOUNDARY_R + 26);
  const art = detail ? 1 : 0.5;
  const facade = track(canvasArt(1024, 512, (g, w, h) => paintFacade(g, w, h, false), [217, 205, 179, 255], art));
  const facadeMask = track(canvasArt(1024, 512, (g, w, h) => paintFacade(g, w, h, true), [0, 0, 0, 255], art));
  const windowsMat = track(new MeshLambertMaterial({ map: facade, emissiveMap: facadeMask, emissive: '#ffd6a0', emissiveIntensity: 0.7 }));
  const front = new Mesh(track(new PlaneGeometry(56, 15)), windowsMat);
  front.position.set(0, 7.5, PZ + 7.01);
  group.add(front);
  const stone: BufferGeometry[] = [
    box(56, 15, 14, 0, 7.5, PZ),
    box(15, 7, 12, 0, 18.5, PZ - 0.5),
    box(60, 0.6, 16, 0, 15.1, PZ),
    // The players' area: a covered dugout with benches, and the gate in the boundary picket.
    box(9, 0.5, 3.4, -21, 2.5, -(BOUNDARY_R + 4.2)),
    box(9, 2.2, 0.25, -21, 1.1, -(BOUNDARY_R + 5.8)),
    box(0.25, 2.2, 3.4, -25.4, 1.1, -(BOUNDARY_R + 4.2)),
    box(0.25, 2.2, 3.4, -16.6, 1.1, -(BOUNDARY_R + 4.2)),
    // Steps down from the dressing rooms.
    ...[0, 1, 2, 3].map((i) => box(4, 0.3, 1.2, -9.5, 0.15 + i * 0.3, PZ + 7.6 + (3 - i) * 1.1)),
  ];
  const roofs: BufferGeometry[] = [gableRoof(58, 15, 4.5, 0, 15.4, PZ), gableRoof(16, 13, 4, 0, 22, PZ - 0.5)];
  const towerArt = track(canvasArt(256, 128, (g) => {
    g.fillStyle = '#ddd2b8';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#f4efe2';
    g.beginPath();
    g.arc(128, 64, 46, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#1e2a78';
    g.lineWidth = 9;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(104, 44);
    g.lineTo(128, 88);
    g.lineTo(152, 44);
    g.stroke();
  }));
  const towerMat = track(new MeshLambertMaterial({ map: towerArt, emissiveMap: towerArt, emissive: '#000000' }));
  const tower = new Mesh(track(new PlaneGeometry(14, 6)), towerMat);
  tower.position.set(0, 18.5, PZ + 5.52);
  group.add(tower);

  // ---- The scoreboard stand behind the striker's end.
  const SZ = BOUNDARY_R + 27;
  stone.push(box(26, 12, 12, 0, 6, SZ), box(4, 9, 4, -9, 16.5, SZ), box(4, 9, 4, 9, 16.5, SZ));
  steel.push(box(28, 11.5, 1.2, 0, 26, SZ - 0.2));
  // Its front: the same glazed, balconied facade as the pavilion (the members' end and the scoreboard end match).
  const standFront = new Mesh(track(new PlaneGeometry(26, 12)), windowsMat);
  standFront.position.set(0, 6, SZ - 6.01);
  standFront.rotation.y = Math.PI;
  group.add(standFront);
  const board = new Mesh(track(new PlaneGeometry(26, 10)), track(new MeshBasicMaterial({ map: track(canvasArt(1024, 384, paintScoreboard, [5, 6, 15, 255], art)), fog: true, side: DoubleSide })));
  board.position.set(0, 26, SZ - 0.85);
  board.rotation.y = Math.PI;
  group.add(board);

  // ---- Camera platforms on the fascia (outside the screens' width) and square of the wicket.
  for (const a of [160, 200, 72, 288].map((d) => (d * Math.PI) / 180)) {
    const r = BOUNDARY_R + 26;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const yaw = a + Math.PI;
    steel.push(placed(new BoxGeometry(3.2, 0.25, 2.4), x, 11.2, z, yaw));
    steel.push(placed(new BoxGeometry(0.55, 0.45, 0.9), x, 12.2, z, yaw));
    steel.push(placed(new BoxGeometry(0.08, 0.9, 0.08), x, 11.7, z, yaw));
    steel.push(placed(new BoxGeometry(3.2, 0.06, 0.06), x - Math.cos(yaw) * 0, 12.3, z, yaw));
  }

  // ---- Railings: the parapet rail of the lower tier and the front of the upper tier.
  const rails = mergeAll([
    placed(new TorusGeometry(BOUNDARY_R + 7.5, 0.035, 4, 220), 0, 0, 0).rotateX(Math.PI / 2).translate(0, 1.7, 0),
    placed(new TorusGeometry(BOUNDARY_R + 30, 0.035, 4, 220), 0, 0, 0).rotateX(Math.PI / 2).translate(0, 14.6, 0),
  ]);
  const metal = track(new MeshStandardMaterial({ color: '#9aa2ad', roughness: 0.4, metalness: 0.65 }));
  const steelMat = track(new MeshLambertMaterial({ color: '#2b2f38' }));
  const stoneMat = track(new MeshLambertMaterial({ color: '#d4c7aa' }));
  group.add(new Mesh(track(mergeAll(stone)), stoneMat));
  const roofMat = track(new MeshLambertMaterial({ color: '#3e4a52' }));
  group.add(new Mesh(track(mergeAll(roofs)), roofMat));

  // ---- Flags on the pavilion and the stand roofs (they wave on the decorative clock: still when quiet).
  const flagTex = track(canvasArt(512, 256, paintFlags));
  const flagUniforms = { uFlagT: { value: 0 } };
  const flagGeos: BufferGeometry[] = [];
  const poles: BufferGeometry[] = [];
  const flagSpots: Array<[number, number, number]> = [[-6, 26.5, PZ - 0.5], [6, 26.5, PZ - 0.5], [0, 30, PZ - 0.5]];
  for (const d of [30, 60, 120, 150, 210, 240, 300, 330]) {
    const a = (d * Math.PI) / 180;
    // On the roof's leading edge (its highest point), above the soffit light.
    flagSpots.push([Math.sin(a) * (BOUNDARY_R + 37.6), 39.4, Math.cos(a) * (BOUNDARY_R + 37.6)]);
  }
  flagSpots.forEach(([x, y, z], i) => {
    poles.push(placed(new CylinderGeometry(0.11, 0.15, 6.5, 6), x, y - 3.2, z));
    const fg = new PlaneGeometry(3, 2, detail ? 10 : 4, detail ? 4 : 2);
    fg.translate(1.5, 0, 0);
    const uv = fg.attributes.uv as BufferAttribute;
    const cell = i % 4;
    const along = new Float32Array(uv.count);
    for (let k = 0; k < uv.count; k++) {
      along[k] = uv.getX(k);
      uv.setXY(k, (cell % 2) * 0.5 + uv.getX(k) * 0.5, (1 - Math.floor(cell / 2)) * 0.5 + uv.getY(k) * 0.5);
    }
    fg.setAttribute('aFlagU', new BufferAttribute(along, 1));
    // Wind from the bowler's end, slightly from the leg side.
    fg.rotateY(-Math.PI / 2 + 0.35);
    fg.translate(x, y - 1.0, z);
    flagGeos.push(fg);
  });
  group.add(new Mesh(track(mergeAll([rails, ...poles])), metal));
  // Under lights the flags catch the floodlights (a little of their own colour as emissive), by day only the sun.
  const flagMat = track(new MeshLambertMaterial({ map: flagTex, side: DoubleSide, emissiveMap: flagTex, emissive: '#ffffff', emissiveIntensity: 0.4 }));
  flagMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, flagUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uFlagT;\nattribute float aFlagU;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
float fx = aFlagU;
float phase = position.x * 0.13 + position.z * 0.11;
transformed += vec3(0.6, 0.0, 0.8) * sin(fx * 5.0 - uFlagT * 0.0045 + phase) * 0.22 * fx;`,
      );
  };
  flagMat.customProgramCacheKey = () => 'vande-flags-v1';
  group.add(new Mesh(track(mergeAll(flagGeos)), flagMat));

  // ---- LED boards round the boundary.
  const boardTex = track(boardTexture(detail, signage));
  const boardMat = track(new MeshBasicMaterial({ map: boardTex, side: DoubleSide, fog: true }));
  const boards = new Mesh(track(new CylinderGeometry(BOUNDARY_R + 2.6, BOUNDARY_R + 2.6, 0.9, 200, 1, true)), boardMat);
  boards.position.y = 0.45;
  boards.name = 'led-boards';
  group.add(boards);

  // ---- Floodlight towers: tapered poles, the headframes with their lamp banks, glows and (high) light shafts.
  const poleGeo: BufferGeometry[] = [];
  const frameGeo: BufferGeometry[] = [];
  const lampGeo: BufferGeometry[] = [];
  const glowTex = track(glowTexture());
  const glows: Mesh[] = [];
  const shafts: Mesh[] = [];
  const shaftMat = track(
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: { uOpacity: { value: 0.05 } },
      vertexShader: `varying float vV; void main() { vV = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying float vV; uniform float uOpacity; void main() { gl_FragColor = vec4(1.0, 0.92, 0.78, uOpacity * vV * vV); }`,
    }),
  );
  const glowMat = track(new MeshBasicMaterial({ map: glowTex, transparent: true, blending: AdditiveBlending, depthWrite: false, color: '#ffe7c4', fog: false }));
  const glowGeo = track(new PlaneGeometry(1, 1));
  for (const a of TOWER_ANGLES) {
    const base = new Vector3(Math.sin(a) * TOWER_R, 0, Math.cos(a) * TOWER_R);
    poleGeo.push(placed(new CylinderGeometry(0.55, 1.4, TOWER_H, 10), base.x, TOWER_H / 2, base.z));
    const holder = new Object3D();
    holder.position.set(base.x, TOWER_H + 2, base.z);
    holder.lookAt(0, 0, 0);
    holder.updateMatrix();
    const frame = mergeAll([
      new BoxGeometry(12, 0.35, 0.5).translate(0, 3.6, -0.2),
      new BoxGeometry(12, 0.35, 0.5).translate(0, -3.6, -0.2),
      new BoxGeometry(0.35, 7.5, 0.5).translate(-6, 0, -0.2),
      new BoxGeometry(0.35, 7.5, 0.5).translate(6, 0, -0.2),
      new BoxGeometry(11.2, 6.8, 0.6).translate(0, 0, -0.75),
    ]);
    frame.applyMatrix4(holder.matrix);
    frameGeo.push(frame);
    const lamps = new PlaneGeometry(11.2, 6.8);
    lamps.translate(0, 0, -0.42);
    lamps.rotateY(Math.PI);
    lamps.applyMatrix4(holder.matrix);
    lampGeo.push(lamps);
    const glow = new Mesh(glowGeo, glowMat);
    glow.position.set(base.x * 0.985, TOWER_H + 2, base.z * 0.985);
    glow.scale.setScalar(34);
    glow.userData.billboard = true;
    glows.push(glow);
    group.add(glow);
    const shaft = new Mesh(track(new CylinderGeometry(9, 0.6, 1, 16, 1, true)), shaftMat);
    const top = new Vector3(base.x, TOWER_H + 1, base.z);
    const to = new Vector3(0, 0, 0).sub(top);
    const len = to.length() * 0.92;
    shaft.scale.set(1, len, 1);
    shaft.position.copy(top).add(to.clone().multiplyScalar(0.46));
    shaft.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), to.clone().normalize());
    shafts.push(shaft);
    group.add(shaft);
  }
  group.add(new Mesh(track(mergeAll([...steel, ...poleGeo, ...frameGeo])), steelMat));
  const lampsMat = track(new MeshBasicMaterial({ map: track(canvasArt(256, 160, paintLamps)), color: '#ffffff', fog: true, side: DoubleSide }));
  group.add(new Mesh(track(mergeAll(lampGeo)), lampsMat));

  // ---- The stand roof's soffit light (warm, low; off by day).
  const roofLineMat = track(new MeshBasicMaterial({ color: '#ffe9c8', fog: true, side: DoubleSide }));
  const roofLine = new Mesh(track(new TorusGeometry(BOUNDARY_R + 37.4, 0.18, 4, 180)), roofLineMat);
  roofLine.rotation.x = Math.PI / 2;
  roofLine.position.y = 33.1;
  group.add(roofLine);

  return { group, screenMat, windowsMat, boardMat, flagUniforms, lampsMat, glows, shafts, shaftMat, roofLineMat, flagMat, flagTex, masonry: [windowsMat, stoneMat, towerMat] };
}

// ---------------------------------------------------------------------------------------------------------------
// The stadium
// ---------------------------------------------------------------------------------------------------------------

/** Under lights the key light comes from the tower behind the striker on the off side, the rim from across. */
const KEY_TOWER = 0;
const RIM_TOWER = 3;
const SKINS = ['#e7bf9b', '#d8a47e', '#c88c63', '#b4764f', '#9d6340', '#865436', '#6f452c'];
const SHIRTS = ['#f4f4f4', '#ffb347', '#5fe3ff', '#ff5d8f', '#ffd36e', '#7ef0c5', '#b38cff', '#ff7a4d', '#e9edf5', '#2b3a8f', '#1d1f26', '#c43d3d'];

export function createStadium(scene: Scene, preset: QualityPreset, signage: StadiumSignage = 'match'): Stadium {
  const group = new Group();
  group.name = 'stadium';
  scene.add(group);
  const disposables: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(x: T) => {
    disposables.push(x);
    return x;
  };
  const detail = preset.quality !== 'low';
  scene.fog = new Fog('#1a1546', 120, 560);
  scene.background = new Color('#0a0828');

  // Sky
  const skyMat = track(skyMaterial(detail));
  const sky = new Mesh(track(new SphereGeometry(470, 32, 16)), skyMat);
  sky.renderOrder = -10;
  sky.name = 'sky';
  group.add(sky);

  // Lights: the key (one tower under lights, the sun by day) casts the shadows; a rim from across; sky and ground fill.
  const hemi = new HemisphereLight('#4b45a8', '#0b2414', 0.62);
  group.add(hemi);
  const keyLight = new DirectionalLight('#ffe6c4', 2.35);
  keyLight.target.position.set(0, 0, 2);
  group.add(keyLight, keyLight.target);
  const rimLight = new DirectionalLight('#9fd6ff', 0.85);
  group.add(rimLight);
  keyLight.shadow.camera.left = -16;
  keyLight.shadow.camera.right = 16;
  keyLight.shadow.camera.top = 18;
  keyLight.shadow.camera.bottom = -18;
  keyLight.shadow.camera.near = 20;
  keyLight.shadow.camera.far = 190;
  keyLight.shadow.bias = -0.0006;
  keyLight.shadow.normalBias = 0.02;

  // Ground: outfield and pitch in one material.
  const gu: GroundUniforms = {
    uGrassA: { value: new Color('#0f4a2a') },
    uGrassB: { value: new Color('#1f7a43') },
    uCentre: { value: 1.12 },
    uWet: { value: 0 },
    uMacro: { value: cachedPitchTexture('macro', pitchMacroTexture) },
    uMicro: { value: cachedPitchTexture(`micro-${detail ? 512 : 256}`, () => pitchMicroTexture(detail ? 512 : 256)) },
    uSoilLight: { value: new Color() },
    uSoilDark: { value: new Color() },
    uDustColor: { value: new Color() },
    uPitchGrass: { value: new Color() },
    uGrassCover: { value: 0 },
    uCrack: { value: 0 },
    uRough: { value: 0 },
    uDust: { value: 0 },
    uSheen: { value: 0 },
    uWear: { value: 0 },
    uPitchRough: { value: 0.8 },
  };
  const groundMat = track(new MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }));
  patchGround(groundMat, gu, detail);
  const ground = new Mesh(track(new CircleGeometry(BOUNDARY_R + 6, 160)), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'ground';
  group.add(ground);
  // Materials below share programs where they can (same type, maps, side and fog): fewer compiles at mount.
  const apron = new Mesh(track(new RingGeometry(BOUNDARY_R + 6, BOUNDARY_R + 9, 160)), track(new MeshLambertMaterial({ color: '#1d2b26', side: DoubleSide })));
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = 0.01;
  group.add(apron);

  // The boundary: a padded cushion with the rope laid along its field side.
  const cushionTex = track(canvasArt(512, 64, paintCushion, [24, 34, 94, 255]));
  cushionTex.wrapS = RepeatWrapping;
  cushionTex.repeat.set(150, 1);
  const cushion = new Mesh(track(new TorusGeometry(BOUNDARY_R + 0.14, 0.14, 8, 400)), track(new MeshStandardMaterial({ map: cushionTex, roughness: 0.85 })));
  cushion.rotation.x = Math.PI / 2;
  cushion.scale.z = 0.72;
  cushion.position.y = 0.1;
  cushion.name = 'boundary-cushion';
  const ropeTex = track(canvasArt(64, 16, paintRope, [233, 226, 207, 255]));
  ropeTex.wrapS = RepeatWrapping;
  ropeTex.repeat.set(6000, 1);
  const rope = new Mesh(track(new TorusGeometry(BOUNDARY_R - 0.03, 0.024, 6, 720)), track(new MeshStandardMaterial({ map: ropeTex, roughness: 0.9 })));
  rope.rotation.x = Math.PI / 2;
  rope.position.y = 0.024;
  rope.name = 'boundary-rope';
  group.add(cushion, rope);

  // Stands: two tiers, gaps behind both ends for the sight screens.
  const gapHalf = Math.atan2(SIGHT_SCREEN.width / 2 + 1.5, SIGHT_SCREEN.distance);
  const gaps: Array<[number, number]> = [
    [-gapHalf, gapHalf],
    [Math.PI - gapHalf, Math.PI + gapHalf],
  ];
  const lowerT: Tier = { r0: BOUNDARY_R + 8, r1: BOUNDARY_R + 27, y0: 1.2, y1: 10.5, rows: detail ? 14 : 8 };
  const upperT: Tier = { r0: BOUNDARY_R + 30, r1: BOUNDARY_R + 47, y0: 13.5, y1: 27, rows: detail ? 13 : 8 };
  const su = {
    uTime: { value: 0 },
    uExcite: { value: 0.3 },
    uPhones: { value: 1 },
    uFront: { value: 0.62 },
    uBack: { value: 0.22 },
    uPaintFrom: { value: 0 },
    uTeamA: { value: new Color('#3b2fc9') },
    uTeamB: { value: new Color('#e8901a') },
    uAmbient: { value: new Color('#ffffff') },
  };
  const standMat = track(new MeshBasicMaterial({ color: '#ffffff', fog: true }));
  patchStands(standMat, su, detail);
  const segs = detail ? 160 : 96;
  const lowerStand = new Mesh(track(tierGeometry(lowerT, gaps, segs)), standMat);
  const upperStand = new Mesh(track(tierGeometry(upperT, gaps, segs)), standMat);
  lowerStand.name = 'stands-lower';
  upperStand.name = 'stands-upper';
  group.add(lowerStand, upperStand);
  const wallMat = track(new MeshLambertMaterial({ color: '#2a2c3a', side: DoubleSide }));
  const wallGeo = new CylinderGeometry(BOUNDARY_R + 7.5, BOUNDARY_R + 7.5, 1.6, 160, 1, true).translate(0, 0.8, 0);
  const backWallGeo = new CylinderGeometry(BOUNDARY_R + 47.6, BOUNDARY_R + 47.6, 5, 160, 1, true).translate(0, 26.5, 0);
  const wall = new Mesh(track(mergeGeometries([wallGeo, backWallGeo])!), wallMat);
  wall.name = 'parapet';
  group.add(wall);
  const fasciaTex = track(boardTexture(detail, signage));
  fasciaTex.repeat.set(-9, 1);
  const fasciaMat = track(new MeshBasicMaterial({ map: fasciaTex, side: DoubleSide, color: '#8f98d8', fog: true }));
  const fascia = new Mesh(track(new CylinderGeometry(BOUNDARY_R + 28.5, BOUNDARY_R + 28.5, 1.6, 200, 1, true)), fasciaMat);
  fascia.position.y = 12.4;
  group.add(fascia);
  // The cantilever roof slopes up from the back of the upper tier; a back wall closes the stand.
  // The roof's underside takes the light of the bowl: a flat colour per environment (lit grey by day, dusk at night).
  const roofMat = track(new MeshBasicMaterial({ color: '#7d8590', side: DoubleSide, fog: true }));
  const roof = new Mesh(track(new CylinderGeometry(BOUNDARY_R + 37, BOUNDARY_R + 48.5, 5.5, 160, 1, true)), roofMat);
  roof.position.y = 30.6;
  group.add(roof);

  // The instanced crowd: front rows of the lower tier first (shuffled within a row, so any count is spread evenly).
  const cu: CrowdUniforms = {
    uTime: { value: 0 },
    uExcite: { value: 0.3 },
    uAnimate: { value: 1 },
    uAllowStand: { value: 1 },
    uWave: { value: 0 },
    uWaveT: { value: 0 },
    uMood: { value: 0.5 },
    uExpect: { value: 0 },
    uFocus: { value: new Vector3(0, 0, 0) },
    uAmb: { value: new Color('#ffffff') },
    uSunCol: { value: new Color('#000000') },
    uSunDir: { value: new Vector3(0, 1, 0) },
    fogColor: { value: new Color('#1a1546') },
    fogNear: { value: 120 },
    fogFar: { value: 560 },
  };
  const crowdMat = track(crowdMaterial(cu));
  const crowdGeo = track(spectatorGeometry(detail));
  const maxCrowd = 6500;
  const crowd = new InstancedMesh(crowdGeo, crowdMat, maxCrowd);
  crowd.name = 'crowd';
  const skin = new Float32Array(maxCrowd * 3);
  const misc = new Float32Array(maxCrowd * 4);
  const seat = new Float32Array(maxCrowd * 2);
  const rowTop: number[] = [];
  const rand = seededStream(77);
  const o = new Object3D();
  const c = new Color();
  let placedN = 0;
  for (let row = 0; row < lowerT.rows && placedN < maxCrowd; row++) {
    const ra = lowerT.r0 + ((lowerT.r1 - lowerT.r0) * row) / lowerT.rows;
    const rb = lowerT.r0 + ((lowerT.r1 - lowerT.r0) * (row + 1)) / lowerT.rows;
    const yb = lowerT.y0 + ((lowerT.y1 - lowerT.y0) * (row + 1)) / lowerT.rows;
    const r = ra + (rb - ra) * 0.42;
    const n = Math.floor((Math.PI * 2 * r) / 0.58);
    const slots: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const d = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.abs(d) < gapHalf + 0.03 || Math.abs(Math.abs(d) - Math.PI) < gapHalf + 0.03) continue;
      // Aisles every 18 m of arc stay clear.
      const s = a * r;
      if (Math.abs((s % 18) - 9) > 8.3) continue;
      if (rand() < 0.84) slots.push(a);
    }
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    for (const a of slots) {
      if (placedN >= maxCrowd) break;
      const k = placedN;
      o.position.set(Math.sin(a) * r, yb, Math.cos(a) * r);
      o.rotation.set(0, a + Math.PI + (rand() - 0.5) * 0.3, 0);
      o.scale.setScalar(0.92 + rand() * 0.18);
      o.updateMatrix();
      crowd.setMatrixAt(k, o.matrix);
      const sect = Math.floor((a * r) / 18);
      const regional = (sect * 7) % 5 === 0;
      c.set(regional && rand() < 0.6 ? (sect % 2 ? '#2b3a8f' : '#e8901a') : SHIRTS[Math.floor(rand() * SHIRTS.length)]).multiplyScalar(0.72 + rand() * 0.35);
      crowd.setColorAt(k, c);
      c.set(SKINS[Math.floor(rand() * SKINS.length)]);
      skin.set([c.r, c.g, c.b], k * 3);
      misc.set([rand(), 0.45 + rand() * 0.45, rand() < 0.22 ? 1 : 0, rand() < 0.35 ? 1 : 0], k * 4);
      seat.set([a, ((sect * 0.618) % 1 + 1) % 1], k * 2);
      rowTop[k] = yb;
      placedN++;
    }
  }
  crowd.geometry.setAttribute('aSkin', new InstancedBufferAttribute(skin, 3));
  crowd.geometry.setAttribute('aMisc', new InstancedBufferAttribute(misc, 4));
  crowd.geometry.setAttribute('aSeat', new InstancedBufferAttribute(seat, 2));
  crowd.frustumCulled = false;
  group.add(crowd);
  const crowdCount = (p: QualityPreset) => Math.min(p.crowd, placedN);
  /** The painted crowd starts on the row after the last instanced spectator. */
  const paintFrom = (count: number) => (count > 0 ? rowTop[count - 1] + 0.05 : 0);

  // Sight screens, pavilion, scoreboard, platforms, flags, boards, floodlights.
  const st = buildStructures(track, detail, signage);
  group.add(st.group);

  // Crowd banners (high tier): 48 spectators in the front rows each hold a flag, raised with the excitement.
  const bannerCount = 48;
  const banners = new InstancedMesh(track(crowdBannerGeometry()), track(crowdBannerMaterial(cu, st.flagTex)), bannerCount);
  banners.name = 'crowd-banners';
  const bannerAttr = new Float32Array(bannerCount * 2);
  const brand = seededStream(91);
  const bm = new Matrix4();
  for (let i = 0; i < bannerCount; i++) {
    const k = Math.floor(brand() * Math.min(placedN, 1400));
    crowd.getMatrixAt(k, bm);
    banners.setMatrixAt(i, bm);
    bannerAttr.set([brand(), 0.45 + brand() * 0.35], i * 2);
  }
  banners.geometry.setAttribute('aBanner', new InstancedBufferAttribute(bannerAttr, 2));
  banners.frustumCulled = false;
  group.add(banners);

  // ---- State
  let env: PracticeEnvironment = { light: 'evening', sky: 'clear' };
  let look = environmentLook(env);
  let pitch = pitchLook('balanced');
  let tone: 'dark' | 'white' = 'dark';
  let quality = preset;
  let quiet = false;
  let frozenAt = 0;
  let deco = 0;
  let excitement = 0.3;
  let humid = false;
  let boardFlash = 0;
  let flashColor = new Color('#5fe3ff');
  const baseBoard = new Color('#ffffff');
  const sunDir = new Vector3(0, 1, 0);
  const towers = TOWER_ANGLES.map(towerPos);
  let sources: readonly Vector3[] = towers;
  let renderer: WebGLRenderer | null = null;
  let pmrem: PMREMGenerator | null = null;
  const envMaps = new Map<string, WebGLRenderTarget>();
  let envMap: Texture | null = null;

  const applyPitch = (p: PitchLook) => {
    pitch = p;
    gu.uSoilLight.value.set(p.soilLight);
    gu.uSoilDark.value.set(p.soilDark);
    gu.uDustColor.value.set(p.dustColor);
    gu.uPitchGrass.value.set(p.grassColor);
    gu.uGrassCover.value = p.grassCover;
    gu.uCrack.value = p.crack;
    gu.uRough.value = p.rough;
    gu.uDust.value = p.dust;
    gu.uSheen.value = p.sheen;
    gu.uWear.value = p.wear;
    gu.uPitchRough.value = p.roughness;
  };

  const applyScreens = () => {
    st.screenMat.color.set(SIGHT_TONES[tone]);
    // A white screen is lit to read white under any light (but stays below the ball's own brightness); a dark one is
    // never lit.
    st.screenMat.emissive.set(tone === 'white' ? SIGHT_TONES.white : '#000000');
    st.screenMat.emissiveIntensity = tone === 'white' ? (look.sun ? 0.12 : 0.42) : 0;
  };

  const applyLook = () => {
    const L = look;
    const su2 = skyMat.uniforms;
    (su2.uZenith.value as Color).set(L.zenith);
    (su2.uMid.value as Color).set(L.mid);
    (su2.uHorizon.value as Color).set(L.horizon);
    (su2.uHaze.value as Color).set(L.haze);
    su2.uHazeAmt.value = L.hazeAmount;
    su2.uStars.value = L.stars;
    su2.uClouds.value = L.clouds;
    (su2.uCloudColor.value as Color).set(L.cloudColor);
    if (L.sun) {
      sunDir.set(Math.sin(L.sun.azimuth) * Math.cos(L.sun.elevation), Math.sin(L.sun.elevation), Math.cos(L.sun.azimuth) * Math.cos(L.sun.elevation));
      (su2.uSunDir.value as Vector3).copy(sunDir);
      (su2.uSunColor.value as Color).set(L.sun.color);
      su2.uSunDisc.value = L.sun.disc;
      keyLight.position.copy(sunDir).multiplyScalar(140).add(keyLight.target.position);
      rimLight.position.set(-sunDir.x, 0.6, -sunDir.z).multiplyScalar(100);
      sources = [sunDir.clone().multiplyScalar(400)];
    } else {
      sunDir.set(0, 1, 0);
      (su2.uSunDir.value as Vector3).set(0, -1, 0);
      su2.uSunDisc.value = 0;
      keyLight.position.copy(towers[KEY_TOWER]).multiplyScalar(0.6);
      rimLight.position.copy(towers[RIM_TOWER]).multiplyScalar(0.6);
      sources = towers;
    }
    keyLight.color.set(L.key.color);
    keyLight.intensity = L.key.intensity;
    rimLight.color.set(L.rim.color);
    rimLight.intensity = L.rim.intensity;
    hemi.color.set(L.hemi.sky);
    hemi.groundColor.set(L.hemi.ground);
    hemi.intensity = L.hemi.intensity;
    const fogNear = humid ? L.fog.near * 0.66 : L.fog.near;
    const fogFar = humid ? L.fog.far * 0.68 : L.fog.far;
    const fog = scene.fog as Fog;
    fog.color.set(L.fog.color);
    fog.near = fogNear;
    fog.far = fogFar;
    (scene.background as Color).set(L.fog.color);
    cu.fogColor.value.set(L.fog.color);
    cu.fogNear.value = fogNear;
    cu.fogFar.value = fogFar;
    // Floodlights: lamp banks, glows and light shafts.
    const on = L.floodlights;
    st.lampsMat.color.setRGB(0.22 + 0.78 * on, 0.22 + 0.76 * on, 0.24 + 0.7 * on);
    for (const g of st.glows) {
      g.visible = on > 0.05;
      (g.material as MeshBasicMaterial).opacity = Math.min(1, on);
    }
    for (const s of st.shafts) s.visible = quality.lightShafts && on > 0.5;
    st.shaftMat.uniforms.uOpacity.value = 0.05 * on;
    st.roofLineMat.color.set('#ffe9c8').multiplyScalar(0.12 + 0.3 * on);
    st.flagMat.emissiveIntensity = 0.45 * on;
    // Unlit surfaces follow the light.
    su.uAmbient.value.set(L.ambient.tint);
    su.uFront.value = L.ambient.front;
    su.uBack.value = L.ambient.back;
    su.uPhones.value = L.phones;
    st.windowsMat.emissiveIntensity = L.windows * 0.55;
    for (const m of st.masonry) {
      const base = (m.userData.base ??= m.color.clone()) as Color;
      m.color.copy(base).multiplyScalar(L.sun ? 1 : 0.42);
    }
    fasciaMat.color.set('#8f98d8').multiplyScalar(L.sun ? 1.15 : 1);
    roofMat.color.set(L.sun ? '#8a919b' : '#1d1c34').multiplyScalar(L.sun ? L.ambient.front * 0.95 : 1);
    const amb = new Color(L.hemi.sky).multiplyScalar(L.hemi.intensity * 0.55);
    cu.uAmb.value.copy(amb).add(new Color(L.ambient.tint).multiplyScalar(L.sun ? 0.25 : L.ambient.front * 0.55));
    cu.uSunCol.value.set(L.key.color).multiplyScalar(L.sun ? L.key.intensity * 0.22 : 0);
    cu.uSunDir.value.copy(sunDir);
    // The players' night rim and fill fade by day (the sun and sky light them).
    PLAYER_FILL.value = L.sun ? (L.sun.disc > 0 ? 0.35 : 0.5) + (L.floodlights > 0.3 ? 0.15 : 0) : 1;
    gu.uGrassA.value.set(L.grass.a);
    gu.uGrassB.value.set(L.grass.b);
    gu.uCentre.value = L.grass.centre;
    applyScreens();
  };

  /** The environment map for the ball: the current sky with the floodlight banks or the sun, cached per look. */
  const buildEnvMap = () => {
    if (!renderer) return;
    const key = `${env.light}|${env.sky}`;
    let rt = envMaps.get(key);
    if (!rt) {
      pmrem ??= new PMREMGenerator(renderer);
      const s = new Scene();
      const L = look;
      const domeMat = new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        uniforms: { uTop: { value: new Color(L.zenith) }, uMid: { value: new Color(L.mid) }, uHor: { value: new Color(L.horizon) }, uGround: { value: new Color(L.grass.a).multiplyScalar(0.6) } },
        vertexShader: 'varying vec3 vD; void main() { vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'varying vec3 vD; uniform vec3 uTop, uMid, uHor, uGround; void main() { float h = vD.y; vec3 c = mix(uHor, uMid, smoothstep(0.0, 0.25, h)); c = mix(c, uTop, smoothstep(0.2, 0.9, h)); c = mix(uGround, c, smoothstep(-0.05, 0.02, h)); gl_FragColor = vec4(c * 1.4, 1.0); }',
      });
      s.add(new Mesh(new SphereGeometry(100, 24, 12), domeMat));
      const bright = (color: string, k: number) => new MeshBasicMaterial({ color: new Color(color).multiplyScalar(k), side: DoubleSide });
      if (L.sun && L.sun.disc > 0) {
        const sun = new Mesh(new SphereGeometry(5, 12, 8), bright(L.sun.color, 40));
        sun.position.copy(sunDir).multiplyScalar(80);
        s.add(sun);
      }
      if (L.floodlights > 0.05) {
        for (const t of towers) {
          const bank = new Mesh(new PlaneGeometry(9, 5.5), bright('#fff1dc', 14 * L.floodlights));
          bank.position.copy(t).normalize().multiplyScalar(80);
          bank.position.y = 40;
          bank.lookAt(0, 0, 0);
          s.add(bank);
        }
      }
      // The stands' dark ring round the horizon.
      const ring = new Mesh(new CylinderGeometry(70, 70, 26, 32, 1, true), new MeshBasicMaterial({ color: new Color(L.fog.color).multiplyScalar(0.5), side: DoubleSide }));
      ring.position.y = 6;
      s.add(ring);
      rt = pmrem.fromScene(s, 0, 0.1, 400, { size: 64 });
      envMaps.set(key, rt);
      s.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as { dispose(): void }).dispose();
        }
      });
    }
    envMap = rt.texture;
  };

  const stadium: Stadium = {
    group,
    keyLight,
    rimLight,
    hemi,
    setTime(ms) {
      // Delivery Quiet Mode: decorative motion (boards, fascia, phone lights, flags, clouds) holds still.
      if (!quiet) frozenAt = ms;
      deco = quiet ? frozenAt : ms;
      skyMat.uniforms.uTime.value = deco;
      su.uTime.value = deco;
      st.flagUniforms.uFlagT.value = deco;
      st.boardMat.map!.offset.x = (deco * 0.00002) % 1;
      fasciaTex.offset.x = (-deco * 0.000012) % 1;
      // The crowd runs on the stadium clock, but only moves as far as the excitement lets it.
      cu.uTime.value = ms;
      cu.uWaveT.value = ms * 0.00008;
      PLAYER_CLOCK.value = ms;
      const pulse = boardFlash > 0 && !quiet ? 0.5 + 0.5 * Math.sin(ms * 0.02) : 1;
      st.boardMat.color.copy(baseBoard).lerp(flashColor, boardFlash * (0.5 + 0.5 * pulse));
      fasciaMat.color.set('#8f98d8').lerp(flashColor, boardFlash * 0.8);
    },
    setExcitement(v) {
      excitement = clamp(v, 0, 1);
      cu.uExcite.value = excitement;
      su.uExcite.value = excitement;
      cu.uWave.value = quality.quality === 'high' ? clamp((excitement - 0.74) / 0.16, 0, 1) : 0;
    },
    setBoardFlash(v, color) {
      boardFlash = v;
      flashColor = new Color(color === 'amber' ? '#ffb347' : color === 'wicket' ? '#ff4d6a' : '#5fe3ff');
    },
    setConditions(cond) {
      applyPitch(pitchLook(MATCH_PITCH[cond.pitch] ?? 'balanced'));
      gu.uWet.value = cond.weather === 'dew' ? 0.65 : cond.weather === 'humid' ? 0.25 : 0;
      humid = cond.weather === 'humid';
      applyLook();
    },
    setTeams(home, away) {
      const a = new Color(home.primary);
      const b = new Color(away.primary);
      su.uTeamA.value.copy(a);
      su.uTeamB.value.copy(b);
      for (let i = 0; i < placedN; i += 3) crowd.setColorAt(i, (i % 2 ? a : b).clone().multiplyScalar(0.75 + misc[i * 4] * 0.3));
      if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
    },
    setQuality(p) {
      quality = p;
      crowd.count = crowdCount(p);
      su.uPaintFrom.value = paintFrom(crowd.count);
      cu.uAnimate.value = p.crowdAnimated ? 1 : 0;
      cu.uAllowStand.value = p.quality === 'low' ? 0 : 1;
      banners.visible = p.quality === 'high';
      for (const s of st.shafts) s.visible = p.lightShafts && look.floodlights > 0.5;
    },
    setSightScreens(t) {
      tone = t === 'white' ? 'white' : 'dark';
      applyScreens();
    },
    setPracticePitch(condition) {
      applyPitch(pitchLook(condition));
    },
    setEnvironment(e) {
      env = { light: e.light in ENVIRONMENTS ? e.light : 'evening', sky: e.sky === 'overcast' ? 'overcast' : 'clear' };
      look = environmentLook(env);
      applyLook();
      buildEnvMap();
    },
    setQuiet(on) {
      quiet = on;
    },
    setCrowdFocus(at, strength) {
      const s = quality.quality === 'high' ? clamp(strength, 0, 1) : quality.quality === 'standard' ? clamp(strength, 0, 1) * 0.5 : 0;
      if (at) cu.uFocus.value.set(at.x, at.z, s);
      else cu.uFocus.value.z = 0;
    },
    ballEnvironment() {
      return envMap;
    },
    setRenderer(r) {
      renderer = r;
      buildEnvMap();
    },
    exposure() {
      return look.exposure;
    },
    shadowSources() {
      return sources;
    },
    setCrowdMood(valence, expectation = 0) {
      cu.uMood.value = clamp(valence, -1, 1);
      cu.uExpect.value = clamp(expectation, 0, 1);
    },
    inspect() {
      return {
        environment: { ...env },
        pitch: { ...pitch },
        sightScreen: { tone, color: '#' + st.screenMat.color.getHexString(), width: SIGHT_SCREEN.width, height: SIGHT_SCREEN.height, distance: SIGHT_SCREEN.distance },
        quiet,
        boardOffset: st.boardMat.map!.offset.x,
        fasciaOffset: fasciaTex.offset.x,
        decorativeTime: deco,
        crowd: { count: crowd.count, animated: cu.uAnimate.value > 0.5, excitement },
      };
    },
    dispose() {
      scene.remove(group);
      for (const d of disposables) d.dispose();
      crowd.dispose();
      for (const rt of envMaps.values()) rt.dispose();
      envMaps.clear();
      pmrem?.dispose();
    },
  };
  applyPitch(pitch);
  applyLook();
  stadium.setQuality(preset);
  group.userData.glows = st.glows;
  return stadium;
}
