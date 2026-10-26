/**
 * Procedural players: one skinned mesh per player (single draw call), built in code from primitives (original
 * work, no external assets). Kits, skin, hair, beard and a painted face come from bind-pose coordinates in a
 * patched MeshStandardMaterial, so patterns stay crisp at any distance without textures. Five gear variants
 * (batter, keeper, fielder, bowler, umpire) are merged geometries shared by every player; two LODs each.
 */
import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Group,
  LOD,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  BoxGeometry,
  TorusGeometry,
  Vector3,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { KitSpec } from '@/contracts';
import { BONE_INDEX, BONE_NAMES, SKELETON, type BoneName } from '../core/skeleton';
import type { SampledPose } from '../core/clips';
import type { Look } from '../core/actors';
import { avatarTraits } from '@/ui/avatar/traits';

// Region ids painted by the shader.
const R = { skin: 0, shirt: 1, trousers: 2, shoes: 3, pads: 4, gloves: 5, helmet: 6, grille: 7, cap: 8, hat: 9, sole: 10 } as const;
type Region = (typeof R)[keyof typeof R];

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

interface Part {
  geo: BufferGeometry;
  /** Skin to `bone`, optionally blending towards `blendBone` near the segment start (`a`) for smooth joints. */
  bone: BoneName;
  blend?: { bone: BoneName; a: Vector3; b: Vector3; range: number };
  blendEnd?: { bone: BoneName; range: number };
  region: Region | ((p: Vector3) => Region);
}

function prep(geo: BufferGeometry): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  return g;
}

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

function bodyParts(lod: 0 | 1, gear: Gear): Part[] {
  const rad = lod === 0 ? 14 : 7;
  const rings = lod === 0 ? 6 : 2;
  const sph = lod === 0 ? [14, 10] : [8, 6];
  const parts: Part[] = [];
  const hips = W('hips');
  const spine = W('spine');
  const chest = W('chest');
  const neck = W('neck');
  const head = W('head');
  const shirtLow = hips.y + 0.02;
  const shirtOrTrousers = (p: Vector3): Region => (p.y > shirtLow ? R.shirt : R.trousers);

  // Torso (shirt), slightly tapered and flattened front-to-back.
  const torso = new CapsuleGeometry(0.168, 0.29, lod === 0 ? 6 : 3, lod === 0 ? 22 : 10);
  torso.scale(1, 1, 0.72);
  torso.translate(0, (spine.y + chest.y) / 2 + 0.11, 0.0);
  parts.push({ geo: torso, bone: 'chest', blend: { bone: 'spine', a: spine.clone(), b: chest.clone().add(new Vector3(0, 0.2, 0)), range: 0.55 }, region: shirtOrTrousers });
  const belly = new CapsuleGeometry(0.147, 0.08, lod === 0 ? 4 : 2, lod === 0 ? 20 : 10);
  belly.scale(1, 1, 0.78);
  belly.translate(0, spine.y + 0.04, 0.005);
  parts.push({ geo: belly, bone: 'spine', blend: { bone: 'hips', a: hips.clone(), b: spine.clone().add(new Vector3(0, 0.12, 0)), range: 0.6 }, region: shirtOrTrousers });
  const pelvis = new CapsuleGeometry(0.136, 0.11, lod === 0 ? 4 : 2, lod === 0 ? 18 : 9);
  pelvis.rotateZ(Math.PI / 2);
  pelvis.scale(1, 1.05, 0.8);
  pelvis.translate(0, hips.y - 0.035, -0.005);
  parts.push({ geo: pelvis, bone: 'hips', region: R.trousers });

  // Neck and head.
  parts.push({ geo: segment(neck.clone().add(new Vector3(0, -0.04, 0)), head.clone().add(new Vector3(0, 0.02, 0)), 0.052, 0.047, rad, 1), bone: 'neck', blend: { bone: 'chest', a: neck.clone().add(new Vector3(0, -0.04, 0)), b: head.clone(), range: 0.45 }, region: R.skin });
  const skull = blob(head.clone().add(new Vector3(0, 0.1, 0.008)), 0.106, 0.124, 0.114, sph[0] + 4, sph[1] + 2);
  parts.push({ geo: skull, bone: 'head', region: R.skin });
  const jaw = blob(head.clone().add(new Vector3(0, 0.045, 0.03)), 0.084, 0.064, 0.086, sph[0], sph[1]);
  parts.push({ geo: jaw, bone: 'head', region: R.skin });
  if (lod === 0) {
    const nose = new CylinderGeometry(0.004, 0.017, 0.04, 6);
    nose.rotateX(Math.PI / 2 + 0.5);
    nose.translate(0, head.y + 0.085, 0.112);
    parts.push({ geo: nose, bone: 'head', region: R.skin });
    for (const s of [1, -1]) parts.push({ geo: blob(head.clone().add(new Vector3(0.098 * s, 0.09, 0)), 0.016, 0.028, 0.012, 6, 5), bone: 'head', region: R.skin });
  }

  // Arms: short sleeves over the upper arm, skin below.
  for (const side of ['L', 'R'] as const) {
    const sh = W(`upperArm${side}`);
    const el = W(`forearm${side}`);
    const wr = W(`hand${side}`);
    parts.push({ geo: blob(sh.clone().add(new Vector3(0, -0.01, 0)), 0.078, 0.074, 0.07, sph[0], sph[1]), bone: `upperArm${side}`, region: R.shirt });
    const sleeveEnd = sh.y - 0.14;
    parts.push({
      geo: segment(sh, el, 0.063, 0.05, rad, rings),
      bone: `upperArm${side}`,
      blendEnd: { bone: `forearm${side}`, range: 0.22 },
      region: (p) => (p.y > sleeveEnd ? R.shirt : R.skin),
    });
    parts.push({ geo: segment(el, wr, 0.049, 0.038, rad, rings), bone: `forearm${side}`, blend: { bone: `upperArm${side}`, a: el.clone(), b: wr.clone(), range: 0.22 }, region: R.skin });
    const handG = gear === 'batter' || gear === 'keeper' ? blob(wr.clone().add(new Vector3(0, -0.055, 0.008)), gear === 'keeper' ? 0.06 : 0.05, 0.07, gear === 'keeper' ? 0.058 : 0.046, sph[0], sph[1]) : blob(wr.clone().add(new Vector3(0, -0.05, 0.006)), 0.038, 0.058, 0.03, sph[0], sph[1]);
    parts.push({ geo: handG, bone: `hand${side}`, region: gear === 'batter' || gear === 'keeper' ? R.gloves : R.skin });
  }

  // Legs.
  for (const side of ['L', 'R'] as const) {
    const hip = W(`thigh${side}`);
    const knee = W(`shin${side}`);
    const ankle = W(`foot${side}`);
    parts.push({ geo: segment(hip.clone().add(new Vector3(0, 0.04, 0)), knee, 0.098, 0.068, rad, rings), bone: `thigh${side}`, blend: { bone: 'hips', a: hip.clone().add(new Vector3(0, 0.04, 0)), b: knee.clone(), range: 0.22 }, blendEnd: { bone: `shin${side}`, range: 0.2 }, region: R.trousers });
    parts.push({ geo: segment(knee, ankle.clone().add(new Vector3(0, 0.02, 0)), 0.066, 0.046, rad, rings), bone: `shin${side}`, blend: { bone: `thigh${side}`, a: knee.clone(), b: ankle.clone(), range: 0.18 }, region: R.trousers });
    const shoe = new BoxGeometry(0.1, 0.075, 0.27, lod === 0 ? 3 : 1, 1, lod === 0 ? 4 : 1);
    shoe.translate(ankle.x, ankle.y - 0.03, 0.055);
    parts.push({ geo: shoe, bone: `foot${side}`, region: (p) => (p.y < ankle.y - 0.06 ? R.sole : R.shoes) });
    if (gear === 'batter' || gear === 'keeper') {
      // Leg guards: front panel with a knee roll.
      const pad = new BoxGeometry(0.15, 0.5, 0.09, lod === 0 ? 4 : 1, lod === 0 ? 5 : 1, 1);
      pad.translate(knee.x, (knee.y + ankle.y) / 2 + 0.04, 0.05);
      parts.push({ geo: pad, bone: `shin${side}`, region: R.pads });
      const roll = blob(knee.clone().add(new Vector3(0, 0.03, 0.07)), 0.085, 0.07, 0.06, sph[0], sph[1]);
      parts.push({ geo: roll, bone: `shin${side}`, region: R.pads });
    }
  }

  // Headgear.
  const headTop = head.clone().add(new Vector3(0, 0.1, 0.008));
  if (gear === 'batter' || (gear === 'keeper' && lod === 0)) {
    const shell = new SphereGeometry(0.136, sph[0] + 4, sph[1], 0, Math.PI * 2, 0, Math.PI * 0.56);
    shell.scale(1, 1.02, 1.06);
    shell.translate(headTop.x, headTop.y - 0.005, headTop.z - 0.008);
    parts.push({ geo: shell, bone: 'head', region: R.helmet });
    const peak = new BoxGeometry(0.2, 0.012, 0.09);
    peak.rotateX(-0.18);
    peak.translate(headTop.x, headTop.y + 0.0, headTop.z + 0.14);
    parts.push({ geo: peak, bone: 'head', region: R.helmet });
    if (lod === 0) {
      for (let i = 0; i < 3; i++) {
        const bar = new TorusGeometry(0.115 - i * 0.004, 0.0045, 4, 14, Math.PI * 0.62);
        bar.rotateZ(Math.PI * 1.19);
        bar.rotateX(-0.12);
        bar.translate(headTop.x, headTop.y - 0.04 - i * 0.034, headTop.z + 0.0);
        parts.push({ geo: bar, bone: 'head', region: R.grille });
      }
      const flap = new BoxGeometry(0.17, 0.05, 0.025);
      flap.translate(headTop.x, headTop.y - 0.105, headTop.z - 0.1);
      parts.push({ geo: flap, bone: 'head', region: R.helmet });
    }
  } else if (gear === 'fielder' || gear === 'keeper') {
    const dome = new SphereGeometry(0.119, sph[0] + 2, sph[1], 0, Math.PI * 2, 0, Math.PI * 0.5);
    dome.translate(headTop.x, headTop.y + 0.005, headTop.z);
    parts.push({ geo: dome, bone: 'head', region: R.cap });
    const bill = new CylinderGeometry(0.1, 0.1, 0.008, lod === 0 ? 16 : 8, 1, false, -Math.PI * 0.5, Math.PI);
    bill.scale(0.95, 1, 0.95);
    bill.rotateX(-0.12);
    bill.translate(headTop.x, headTop.y + 0.004, headTop.z + 0.075);
    parts.push({ geo: bill, bone: 'head', region: R.cap });
  } else if (gear === 'umpire') {
    const crown = new CylinderGeometry(0.095, 0.108, 0.075, lod === 0 ? 16 : 8);
    crown.translate(headTop.x, headTop.y + 0.035, headTop.z);
    parts.push({ geo: crown, bone: 'head', region: R.hat });
    const brim = new CylinderGeometry(0.19, 0.19, 0.01, lod === 0 ? 20 : 10);
    brim.translate(headTop.x, headTop.y + 0.0, headTop.z);
    parts.push({ geo: brim, bone: 'head', region: R.hat });
  }
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
    const main = BONE_INDEX[part.bone];
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(g.attributes.position as BufferAttribute, i);
      bind.set([p.x, p.y, p.z], i * 3);
      region[i] = typeof part.region === 'function' ? part.region(p) : part.region;
      let wMain = 1;
      let other = -1;
      let wOther = 0;
      if (part.blend) {
        const { a, b, range } = part.blend;
        const ab = b.clone().sub(a);
        const t = ab.lengthSq() > 0 ? p.clone().sub(a).dot(ab) / ab.lengthSq() : 1;
        if (t < range) {
          const k = Math.max(0, t / range);
          wOther = 0.5 * (1 - k);
          other = BONE_INDEX[part.blend.bone];
        }
      }
      if (part.blendEnd) {
        const child = W(part.blendEnd.bone);
        const parent = W(part.bone);
        const ab = child.clone().sub(parent);
        const t = ab.lengthSq() > 0 ? p.clone().sub(parent).dot(ab) / ab.lengthSq() : 0;
        if (t > 1 - part.blendEnd.range) {
          const k = Math.min(1, (t - (1 - part.blendEnd.range)) / part.blendEnd.range);
          wOther = 0.5 * k;
          other = BONE_INDEX[part.blendEnd.bone];
        }
      }
      wMain = 1 - wOther;
      si[i * 4] = main;
      sw[i * 4] = wMain;
      if (other >= 0) {
        si[i * 4 + 1] = other;
        sw[i * 4 + 1] = wOther;
      }
    }
    g.setAttribute('skinIndex', new BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new BufferAttribute(sw, 4));
    g.setAttribute('region', new BufferAttribute(region, 1));
    g.setAttribute('bindPos', new BufferAttribute(bind, 3));
    pieces.push(g);
  }
  const merged = mergeGeometries(pieces)!;
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  geoCache.set(key, merged);
  return merged;
}

// ---------------------------------------------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------------------------------------------

const PATTERN_ID: Record<KitSpec['pattern'], number> = { plain: 0, stripes: 1, hoops: 2, chevron: 3, sash: 4 };

export interface PlayerUniforms {
  uPrimary: { value: Color };
  uSecondary: { value: Color };
  uTrouser: { value: Color };
  uSkin: { value: Color };
  uHair: { value: Color };
  uHelmet: { value: Color };
  uPattern: { value: number };
  uBeard: { value: number };
  uHairline: { value: number };
  uFace: { value: number };
}

export function createPlayerMaterial(): { material: MeshStandardMaterial; uniforms: PlayerUniforms } {
  const uniforms: PlayerUniforms = {
    uPrimary: { value: new Color('#3b2fc9') },
    uSecondary: { value: new Color('#19d3fa') },
    uTrouser: { value: new Color('#1a1650') },
    uSkin: { value: new Color('#b07650') },
    uHair: { value: new Color('#141012') },
    uHelmet: { value: new Color('#141a3a') },
    uPattern: { value: 0 },
    uBeard: { value: 0 },
    uHairline: { value: 1 },
    uFace: { value: 1 },
  };
  const material = new MeshStandardMaterial({ roughness: 0.7, metalness: 0.0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float region;\nattribute vec3 bindPos;\nvarying float vRegion;\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegion = region;\nvBind = bindPos;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vRegion;
varying vec3 vBind;
uniform vec3 uPrimary, uSecondary, uTrouser, uSkin, uHair, uHelmet;
uniform float uPattern, uBeard, uHairline, uFace;
float vcRough = 0.7;
vec3 kitColor(vec3 b) {
  float m = 0.0;
  if (uPattern > 0.5 && uPattern < 1.5) m = step(0.74, fract(b.x * 8.0 + 0.5));
  else if (uPattern > 1.5 && uPattern < 2.5) m = step(0.72, fract(b.y * 6.5));
  else if (uPattern > 2.5 && uPattern < 3.5) m = step(0.78, fract((abs(b.x) * 1.5 - b.y) * 3.6));
  else if (uPattern > 3.5) m = 1.0 - step(0.06, abs(b.x * 0.95 + (b.y - 1.27)));
  // Collar and side panels in the secondary colour.
  float collar = step(1.5, b.y) * step(abs(b.x), 0.09) * step(0.06, b.z);
  float side = step(0.135, abs(b.x)) * step(b.y, 1.42) * step(1.02, b.y);
  return mix(uPrimary, uSecondary, clamp(m + collar + side * 0.85, 0.0, 1.0));
}
vec3 regionColor(float r, vec3 b) {
  if (r < 0.5) {
    vec3 c = uSkin;
    float headY = b.y - 1.63;
    float front = smoothstep(0.04, 0.1, b.z);
    // Hair on the crown (hairline higher at the front), beard on the jaw, painted brows, eyes and mouth.
    float th = mix(0.035, 0.122, front) + 0.05 * (1.0 - uHairline);
    float hair = smoothstep(th, th + 0.014, headY) * step(1.6, b.y);
    c = mix(c, uHair, hair);
    float beard = uBeard * (1.0 - smoothstep(0.034, 0.05, headY)) * smoothstep(-0.05, -0.028, headY) * step(0.0, b.z);
    c = mix(c, uHair * 1.1, clamp(beard, 0.0, 1.0) * 0.88);
    if (uFace > 0.5 && b.z > 0.07 && headY > 0.0 && headY < 0.14) {
      float ex = abs(abs(b.x) - 0.036);
      float eye = 1.0 - smoothstep(0.008, 0.012, length(vec2(ex * 0.8, headY - 0.086)));
      float brow = (1.0 - smoothstep(0.003, 0.006, abs(headY - 0.108 + ex * 0.35))) * step(ex, 0.021);
      float mouth = (1.0 - smoothstep(0.002, 0.005, abs(headY - 0.03 - b.x * b.x * 2.5))) * step(abs(b.x), 0.022);
      c = mix(c, vec3(0.05, 0.045, 0.06), clamp(eye + brow * 0.85, 0.0, 1.0));
      c = mix(c, uSkin * 0.5, mouth * 0.75);
    }
    vcRough = 0.6;
    return c;
  }
  if (r < 1.5) { vcRough = 0.78; return kitColor(b); }
  if (r < 2.5) { vcRough = 0.82; return uTrouser; }
  if (r < 3.5) { vcRough = 0.5; return mix(vec3(0.92), uSecondary, step(0.03, b.y) * step(b.y, 0.055)); }
  if (r < 4.5) { vcRough = 0.55; return mix(vec3(0.94, 0.95, 0.97), uSecondary * 0.85, step(0.93, fract(b.y * 9.0)) * 0.55); }
  if (r < 5.5) { vcRough = 0.6; return mix(vec3(0.95), uPrimary, step(0.5, fract(b.y * 14.0)) * 0.55); }
  if (r < 6.5) { vcRough = 0.28; return mix(uHelmet, uSecondary, step(1.84, b.y) * step(abs(b.x), 0.012)); }
  if (r < 7.5) { vcRough = 0.25; return vec3(0.72, 0.76, 0.82); }
  if (r < 8.5) { vcRough = 0.7; return mix(uPrimary, uSecondary, step(1.79, b.y) * step(abs(b.x), 0.015)); }
  if (r < 9.5) { vcRough = 0.85; return vec3(0.88, 0.86, 0.8); }
  vcRough = 0.9;
  return vec3(0.12);
}`,
      )
      // A touch of contact shadow at the feet grounds the player (bind-pose height, so it moves with the legs).
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = regionColor(vRegion, vBind) * mix(0.74, 1.0, smoothstep(0.0, 0.3, vBind.y));')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
// Floodlight rim: a cool fresnel edge so players read against the dark outfield (night broadcast look), brighter on
// upward-facing surfaces because the lights are high (shoulders, helmet, the top of the pads).
vec3 vcUpW = inverseTransformDirection(normal, viewMatrix);
float vcUp = clamp(vcUpW.y * 0.5 + 0.5, 0.0, 1.0);
float rimF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.4);
totalEmissiveRadiance += mix(vec3(0.26, 0.46, 0.92), vec3(0.56, 0.78, 1.0), vcUp) * rimF * (0.32 + 0.26 * vcUp) + diffuseColor.rgb * rimF * 0.14;
// Broadcast fill: dark kits keep their colour on the shadow side (sky above, a little grass bounce below).
totalEmissiveRadiance += diffuseColor.rgb * mix(vec3(0.04, 0.085, 0.05), vec3(0.1, 0.11, 0.19), vcUp) * 0.6;`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vcRough;');
  };
  material.customProgramCacheKey = () => 'vande-player-v3';
  return { material, uniforms };
}

// ---------------------------------------------------------------------------------------------------------------
// Player instances
// ---------------------------------------------------------------------------------------------------------------

const UMPIRE_SHIRT = new Color('#9fb6d8');
const UMPIRE_TROUSER = new Color('#22222c');

export interface PlayerRig {
  root: Group;
  lod: LOD;
  bones: Bone[];
  boneMap: Record<BoneName, Bone>;
  skeleton: Skeleton;
  meshes: SkinnedMesh[];
  uniforms: PlayerUniforms;
  material: MeshStandardMaterial;
  gear: Gear;
  lookKey: string;
  scale: number;
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
    meshes.push(m);
    lod.addLevel(m, level === 0 ? 0 : lodDistance);
  });
  root.add(lod);
  return { root, lod, bones, boneMap, skeleton, meshes, uniforms, material, gear, lookKey: '', scale: 1 };
}

/** Applies colours and proportions for a look (kit + generated traits). */
export function dressRig(rig: PlayerRig, look: Look, kit: KitSpec) {
  const key = `${look.seed}|${kit.id}|${kit.primary}|${kit.secondary}|${kit.pattern}`;
  if (rig.lookKey === key) return;
  rig.lookKey = key;
  const tr = avatarTraits(look.seed);
  const u = rig.uniforms;
  u.uSkin.value.set(tr.skin);
  u.uHair.value.set(tr.hair);
  u.uBeard.value = tr.beard === 'none' ? 0 : tr.beard === 'stubble' ? 0.35 : tr.beard === 'moustache' ? 0.2 : 0.85;
  u.uHairline.value = tr.hairStyle === 'shaved' ? 0.2 : 1;
  if (look.gear === 'umpire') {
    u.uPrimary.value.copy(UMPIRE_SHIRT);
    u.uSecondary.value.copy(UMPIRE_SHIRT).multiplyScalar(0.8);
    u.uTrouser.value.copy(UMPIRE_TROUSER);
    u.uPattern.value = 0;
  } else {
    u.uPrimary.value.set(kit.primary);
    u.uSecondary.value.set(kit.secondary);
    u.uTrouser.value.set(kit.primary).multiplyScalar(0.42);
    u.uPattern.value = PATTERN_ID[kit.pattern];
  }
  u.uHelmet.value.set(kit.primary).multiplyScalar(0.35).offsetHSL(0, -0.1, 0.02);
  rig.scale = tr.height;
  rig.root.scale.setScalar(tr.height);
}

// ---------------------------------------------------------------------------------------------------------------
// Posing and IK
// ---------------------------------------------------------------------------------------------------------------

const tmpQ = new Quaternion();
const tmpQ2 = new Quaternion();
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

/** Rotates `bone` (swing only) so its rest axis (local -Y) points along world direction `dir`. */
function aimBone(bone: Object3D, dir: Vector3) {
  bone.updateWorldMatrix(true, false);
  bone.getWorldQuaternion(tmpQ);
  const cur = tmpV.copy(DOWN).applyQuaternion(tmpQ).normalize();
  tmpQ2.setFromUnitVectors(cur, tmpV2.copy(dir).normalize());
  tmpQ.premultiply(tmpQ2);
  const parent = bone.parent!;
  parent.getWorldQuaternion(tmpQ2);
  bone.quaternion.copy(tmpQ2.invert().multiply(tmpQ));
  bone.updateMatrixWorld(true);
}

/** Arm aim in the actor's root frame (phi: 0 down, 90 back, 180 up, 270 forward; lateral: outwards). */
export function applyAim(rig: PlayerRig, side: 'L' | 'R', phiDeg: number, lateralDeg: number) {
  const phi = (phiDeg * Math.PI) / 180;
  const lat = (lateralDeg * Math.PI) / 180;
  const sx = side === 'L' ? 1 : -1;
  const d = tmpV3.set(sx * Math.sin(lat), -Math.cos(phi) * Math.cos(lat), -Math.sin(phi) * Math.cos(lat));
  d.applyQuaternion(rig.root.getWorldQuaternion(tmpQ2));
  aimBone(rig.boneMap[`upperArm${side}`], d.clone());
}

/** Two-bone IK: places the hand of `side` at world point `target`, elbow towards `pole`. */
export function reachIK(rig: PlayerRig, side: 'L' | 'R', target: Vector3, pole: Vector3) {
  const upper = rig.boneMap[`upperArm${side}`];
  const fore = rig.boneMap[`forearm${side}`];
  const hand = rig.boneMap[`hand${side}`];
  upper.updateWorldMatrix(true, true);
  const s = new Vector3().setFromMatrixPosition(upper.matrixWorld);
  const e = new Vector3().setFromMatrixPosition(fore.matrixWorld);
  const w = new Vector3().setFromMatrixPosition(hand.matrixWorld);
  const a = s.distanceTo(e);
  const b = e.distanceTo(w);
  const toT = target.clone().sub(s);
  const d = Math.min(Math.max(toT.length(), Math.abs(a - b) + 1e-3), a + b - 1e-3);
  const n = toT.normalize();
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const m = pole.clone().sub(s);
  m.sub(n.clone().multiplyScalar(m.dot(n)));
  if (m.lengthSq() < 1e-8) m.set(0, -1, 0);
  m.normalize();
  const elbow = s.clone().add(n.clone().multiplyScalar(a * cosA)).add(m.multiplyScalar(a * sinA));
  aimBone(upper, elbow.clone().sub(s));
  fore.updateWorldMatrix(true, false);
  const e2 = new Vector3().setFromMatrixPosition(fore.matrixWorld);
  const tgt = s.clone().add(n.multiplyScalar(d));
  aimBone(fore, tgt.sub(e2));
}

export function boneWorld(rig: PlayerRig, name: BoneName, out = new Vector3()): Vector3 {
  return out.setFromMatrixPosition(rig.boneMap[name].matrixWorld);
}

export type { Material };
