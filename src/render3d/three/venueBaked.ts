/**
 * The baked venue: the wedge pack (venueGlb.ts) turned into instanced meshes around the bowl, with one patched unlit
 * material. Loaded lazily (a dynamic import from venue.ts), never in the initial transfer, never on the default Android build.
 *
 * The wedge is a 6-degree slice of the two tiers, the back wall, the parapet and the roof with its trusses, centred on
 * azimuth 0; 60 rotations about +Y make the ring. The three wedges at each end, behind the sight screens, are the gap
 * wedge (level 2: back wall, parapet and roof, no tiers). Wedges near the bowler's end use LOD0 (stepped rows) when the
 * pack has it; the rest use LOD1. The crowd on the tiers is the atlas;
 * the vertex colour is the baked ambient occlusion times the surface colour (no sun and no shadow is baked: the stage's
 * one key light and the stand uniforms do the lighting, as for the painted stands, so the six environment looks and
 * Delivery Quiet Mode keep working).
 *
 * The material takes the stand-in's own uniform objects (ambient tint, front/back spill, phone lights, excitement,
 * decorative time, the row below which the instanced spectators sit), so every environment and quality change reaches it
 * with no call of its own. A dithered dissolve (`uFade`) swaps it in without a transparent pass.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  MeshBasicMaterial,
  SRGBColorSpace,
  Texture,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { SIGHT_SCREEN_GAP_HALF } from '../core/venueGeometry';
import { parseVenuePack, type VenuePackData } from './venueGlb';

/** The stand-in's shared uniform objects (the `su` of createStadium), by name. */
export type StandUniforms = Record<string, { value: unknown }>;

export interface BakedVenue {
  group: Group;
  /** 0 = nothing of the baked venue shows, 1 = all of it (the stand-in's replaced parts are hidden by the controller). */
  setFade(f: number): void;
  /** Compiles the program (against the scene's fog) and uploads the atlas, with the group not yet in the scene. */
  warm(renderer: WebGLRenderer, camera: Camera, scene: Scene): void;
  stats(): { triangles: number; drawCalls: number; instances: number[]; textureBytes: number; geometryBytes: number };
  dispose(): void;
}

const USED_UNIFORMS = ['uTime', 'uExcite', 'uPhones', 'uFront', 'uBack', 'uPaintFrom', 'uAmbient'] as const;
export const VENUE_PROGRAM_KEY = 'vande-venue-v1';
/** The azimuth span around the bowler's end (radians) where wedges use LOD0. */
export const LOD0_SPAN = (60 * Math.PI) / 180;
/**
 * Wedges left out for the sight screens: the wedges whose centre lies within the gap half-angle (atan2(10.5, 68.5), 8.7
 * degrees) of azimuth 0 and of PI, plus the half of the wedge the gap's edge cuts: three wedges at each end of a 60-ring.
 */
export function gapWedges(wedges: number, wedgeRad: number): Set<number> {
  const half = Math.max(0, Math.ceil(SIGHT_SCREEN_GAP_HALF / wedgeRad - 0.5));
  const out = new Set<number>();
  for (const centre of [0, wedges / 2])
    for (let d = -half; d <= half; d++) out.add((((centre + d) % wedges) + wedges) % wedges);
  return out;
}

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function geometryOf(mesh: VenuePackData['meshes'][number]): BufferGeometry {
  const g = new BufferGeometry();
  // Crowd-tier vertices carry only baked ambient occlusion (a linear light factor; the atlas gives the colour); the other
  // surfaces carry their colour as authored, which is sRGB.
  const colors = new Float32Array(mesh.colors.length);
  for (let v = 0; v < mesh.tier.length; v++)
    for (let c = 0; c < 3; c++)
      colors[v * 3 + c] = mesh.tier[v] ? mesh.colors[v * 3 + c] : srgbToLinear(mesh.colors[v * 3 + c]);
  g.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  g.setAttribute('uv', new BufferAttribute(mesh.uvs, 2));
  g.setAttribute('color', new BufferAttribute(colors, 3));
  g.setAttribute('aTier', new BufferAttribute(Float32Array.from(mesh.tier), 1));
  g.setIndex(new BufferAttribute(mesh.indices, 1));
  g.computeBoundingSphere();
  return g;
}

const COMMON = /* glsl */ `
float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }
float bayer4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float x0 = mod(q.x, 2.0), x1 = floor(q.x / 2.0), y0 = mod(q.y, 2.0), y1 = floor(q.y / 2.0);
  return (abs(x0 - y0) * 8.0 + y0 * 4.0 + abs(x1 - y1) * 2.0 + y1 + 0.5) / 16.0;
}`;

function bakedMaterial(
  map: Texture,
  uniforms: StandUniforms,
  variants: number,
): { material: MeshBasicMaterial; fade: { value: number } } {
  const material = new MeshBasicMaterial({ map, vertexColors: true, fog: true });
  // Where it overlaps the stand-in (the dissolve) the baked surface wins, so the two never fight for the depth.
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  const fade = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFade = fade;
    for (const k of USED_UNIFORMS) shader.uniforms[k] = uniforms[k];
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aTier;
attribute float aVariant;
varying float vTier;
varying vec3 vWorldV;`,
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
#ifdef USE_MAP
vMapUv.x += aTier * aVariant * ${(1 / variants).toFixed(6)};
#endif
vTier = aTier;
vWorldV = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uFade, uTime, uExcite, uPhones, uFront, uBack, uPaintFrom;
uniform vec3 uAmbient;
varying float vTier;
varying vec3 vWorldV;
${COMMON}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
if (uFade < 1.0 && bayer4(gl_FragCoord.xy) >= uFade) discard;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float spill = mix(uFront, uBack, smoothstep(2.0, 27.0, vWorldV.y));
// The rows the instanced spectators sit in show empty seats: the painted crowd starts at uPaintFrom, as on the stand-in.
float seatRow = step(0.5, vTier) * step(vWorldV.y, uPaintFrom);
vec3 lit = mix(diffuseColor.rgb, vec3(0.1, 0.12, 0.27) * vColor.rgb, seatRow);
// Phone lights at night, with the same hash and rule as the painted stands (their flicker freezes in Quiet Mode).
vec2 cell = floor(vec2(atan(vWorldV.x, vWorldV.z) * length(vWorldV.xz) / 0.62, vWorldV.y / 0.62));
float tw = step(0.9975 - uExcite * 0.006, h21(cell + floor(uTime * 0.0021)));
diffuseColor.rgb = lit * spill * uAmbient + vec3(1.0, 0.98, 0.92) * tw * vTier * (1.0 - seatRow) * 1.6 * uPhones;`,
      );
  };
  material.customProgramCacheKey = () => VENUE_PROGRAM_KEY;
  return { material, fade };
}

/** Builds the venue from a parsed pack and its decoded atlas. Instances are placed deterministically. */
export function buildBakedVenue(
  pack: VenuePackData,
  atlas: ImageBitmap | HTMLImageElement | HTMLCanvasElement,
  uniforms: StandUniforms,
): BakedVenue {
  for (const k of USED_UNIFORMS) if (!uniforms[k]) throw new Error(`stand uniform ${k} is missing`);
  const texture = new Texture(atlas as unknown as HTMLImageElement);
  texture.flipY = false; // glTF convention: v runs down the image, as the pack's UVs do
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  const { material, fade } = bakedMaterial(texture, uniforms, pack.meta.variants);

  const group = new Group();
  group.name = 'venue-baked';
  const wedges = pack.meta.wedges;
  const step = pack.meta.wedgeRad;
  const gap = gapWedges(wedges, step);
  const hasLod0 = pack.meta.lods.includes(0);
  const lods = new Map<number, { geometry: BufferGeometry; mesh: VenuePackData['meshes'][number] }>();
  pack.meta.lods.forEach((lod, i) => lods.set(lod, { geometry: geometryOf(pack.meshes[i]), mesh: pack.meshes[i] }));
  const lists: Record<number, number[]> = { 0: [], 1: [], 2: [] };
  for (let i = 0; i < wedges; i++) {
    // The wedges behind the sight screens have no tiers but keep the back wall, the parapet and the roof (level 2).
    if (gap.has(i)) {
      lists[2].push(i);
      continue;
    }
    const away = Math.abs(Math.atan2(Math.sin(i * step - Math.PI), Math.cos(i * step - Math.PI)));
    lists[hasLod0 && away <= LOD0_SPAN + 1e-6 ? 0 : 1].push(i);
  }
  const m = new Matrix4();
  const meshes: InstancedMesh[] = [];
  const counts: number[] = [];
  let triangles = 0;
  let geometryBytes = 0;
  for (const lod of [0, 1, 2]) {
    const entry = lods.get(lod);
    const list = lists[lod];
    if (!entry || !list.length) continue;
    const mesh = new InstancedMesh(entry.geometry, material, list.length);
    const variant = new Float32Array(list.length);
    list.forEach((wedge, k) => {
      m.makeRotationY(wedge * step);
      mesh.setMatrixAt(k, m);
      variant[k] = (wedge * 5 + (wedge >> 2)) % pack.meta.variants;
    });
    entry.geometry.setAttribute('aVariant', new InstancedBufferAttribute(variant, 1));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.name = `venue-lod${lod}`;
    group.add(mesh);
    meshes.push(mesh);
    counts.push(list.length);
    triangles += (entry.mesh.indices.length / 3) * list.length;
    geometryBytes +=
      entry.mesh.positions.byteLength +
      entry.mesh.uvs.byteLength +
      entry.mesh.colors.byteLength +
      entry.mesh.indices.byteLength;
  }
  const textureBytes = Math.round((atlas.width ?? 0) * (atlas.height ?? 0) * 4 * (4 / 3));
  return {
    group,
    setFade(f) {
      fade.value = Math.min(1, Math.max(0, f));
    },
    warm(renderer, camera, scene) {
      renderer.compile(group, camera, scene);
      renderer.initTexture(texture);
    },
    stats: () => ({ triangles, drawCalls: meshes.length, instances: counts, textureBytes, geometryBytes }),
    dispose() {
      group.removeFromParent();
      for (const mesh of meshes) mesh.dispose();
      for (const { geometry } of lods.values()) geometry.dispose();
      material.dispose();
      texture.dispose();
      (atlas as ImageBitmap).close?.();
    },
  };
}

/** Fetches, parses, decodes and builds a pack. Rejects on any error; the controller keeps the stand-in then. */
export async function loadBakedVenue(
  url: string,
  uniforms: StandUniforms,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<BakedVenue> {
  const res = await fetchImpl(url, { signal, credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const pack = parseVenuePack(await res.arrayBuffer());
  const bitmap = await createImageBitmap(new Blob([pack.image.bytes as BlobPart], { type: pack.image.mime }), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  if (signal.aborted) {
    bitmap.close();
    throw new DOMException('aborted', 'AbortError');
  }
  return buildBakedVenue(pack, bitmap, uniforms);
}
