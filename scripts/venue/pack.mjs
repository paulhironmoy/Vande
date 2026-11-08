#!/usr/bin/env node
/**
 * Packs the venue (ASSETS-VENUE): assets-src/venue/wedge.json (written by scripts/blender/venue/build_venue.py) plus the
 * crowd atlas painted by scripts/venue/crowd.mjs become two small GLB files for the web stage:
 *
 *   venue-p.glb  Premium:  LOD0 + LOD1 + the gap wedge, 1024 x 512 WebP atlas
 *   venue-b.glb  Balanced: LOD1 + the gap wedge,        512 x 256 WebP atlas
 *
 *   node scripts/venue/pack.mjs                     write both into src/render3d/three/venue/pack/
 *   node scripts/venue/pack.mjs --out DIR           write them into DIR
 *   node scripts/venue/pack.mjs --check             rebuild in memory and compare with the files in place (exit 1 if they differ)
 *   node scripts/venue/pack.mjs --report            print raw / gzip / brotli sizes and what meshopt would save
 *   node scripts/venue/pack.mjs --unity DIR [--fbx-from DIR]   also write Unity's atlas PNG (and copy Blender's FBX files) into DIR
 *
 * Format: glTF 2.0 binary with KHR_mesh_quantization (int16 positions at 1/256 m under a node scale, normalised uint16 UVs,
 * normalised uint8 RGBA colour: RGB = baked ambient occlusion times the surface colour, A = 255 on crowd-tier surfaces),
 * KHR_materials_unlit and EXT_texture_webp. No Draco, no KTX2 and no meshopt: the geometry is a few kilobytes (instanced
 * from code), so a decoder would cost more than it saves (docs: ASSETS-VENUE VENUE-PLAN.md section 5, `--report`).
 * Deterministic: fixed seed, fixed encoder settings.
 */
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paintAtlas } from './crowd.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '..', '..');
export const WEDGE_JSON = join(REPO_ROOT, 'assets-src/venue/wedge.json');
export const PACK_DIR = join(REPO_ROOT, 'src/render3d/three/venue/pack');
/** Position quantisation: int16 units of 1/256 m (range +-128 m, the bowl is inside 111 m). */
export const POSITION_UNITS = 256;

export const PACKS = [
  { file: 'venue-p.glb', lods: [0, 1, 2], atlasWidth: 1024 },
  { file: 'venue-b.glb', lods: [1, 2], atlasWidth: 512 },
];

const align4 = (n) => (n + 3) & ~3;

function typed(kind, values) {
  const t = new kind(values.length);
  for (let i = 0; i < values.length; i++) t[i] = values[i];
  return t;
}

/** Builds the glTF JSON and BIN for the given LODs and atlas. Returns a GLB as a Buffer. */
export function buildGlb(wedge, lods, atlasWebp, atlasSize) {
  const views = [];
  const bins = [];
  let offset = 0;
  const addView = (bytes, target, stride) => {
    const padded = align4(offset);
    if (padded > offset) bins.push(Buffer.alloc(padded - offset));
    offset = padded;
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, ...(target ? { target } : {}), ...(stride ? { byteStride: stride } : {}) });
    bins.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    offset += bytes.byteLength;
    return views.length - 1;
  };
  const accessors = [];
  const meshes = [];
  const nodes = [];

  for (const lod of lods) {
    const m = wedge.lods[lod];
    const n = m.vertices;
    // Positions: int16 x3 padded to 8 bytes (glTF wants vertex elements on 4-byte boundaries).
    const pos = new Int16Array(n * 4);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) {
        const q = Math.round(m.pos[i * 3 + c] * POSITION_UNITS);
        if (q < -32767 || q > 32767) throw new Error(`position out of int16 range: ${m.pos[i * 3 + c]}`);
        pos[i * 4 + c] = q;
        min[c] = Math.min(min[c], q);
        max[c] = Math.max(max[c], q);
      }
    }
    const uv = new Uint16Array(n * 2);
    for (let i = 0; i < n * 2; i++) uv[i] = Math.round(Math.min(1, Math.max(0, m.uv[i])) * 65535);
    const col = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) col[i * 4 + c] = Math.round(Math.min(1, Math.max(0, m.col[i * 3 + c])) * 255);
      col[i * 4 + 3] = m.tier[i] ? 255 : 0;
    }
    const idx = typed(Uint16Array, m.idx);
    const base = accessors.length;
    accessors.push({ bufferView: addView(pos, 34962, 8), componentType: 5122, count: n, type: 'VEC3', min, max });
    accessors.push({ bufferView: addView(uv, 34962), componentType: 5123, normalized: true, count: n, type: 'VEC2' });
    accessors.push({ bufferView: addView(col, 34962), componentType: 5121, normalized: true, count: n, type: 'VEC4' });
    accessors.push({ bufferView: addView(idx, 34963), componentType: 5123, count: idx.length, type: 'SCALAR' });
    meshes.push({ name: `wedge_lod${lod}`, primitives: [{ attributes: { POSITION: base, TEXCOORD_0: base + 1, COLOR_0: base + 2 }, indices: base + 3, material: 0, mode: 4 }] });
    nodes.push({ name: `wedge_lod${lod}`, mesh: meshes.length - 1, scale: [1 / POSITION_UNITS, 1 / POSITION_UNITS, 1 / POSITION_UNITS] });
  }
  const imageView = addView(new Uint8Array(atlasWebp), 0);

  const json = {
    asset: {
      version: '2.0',
      generator: 'VANDE scripts/venue/pack.mjs',
      extras: {
        venue: {
          version: wedge.version,
          wedges: wedge.constants.wedges,
          wedgeRad: wedge.constants.wedgeRad,
          variants: wedge.atlas.variants,
          lods: lods,
          atlas: atlasSize,
          positionUnits: POSITION_UNITS,
        },
      },
    },
    extensionsUsed: ['KHR_mesh_quantization', 'KHR_materials_unlit', 'EXT_texture_webp'],
    extensionsRequired: ['KHR_mesh_quantization', 'EXT_texture_webp'],
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials: [
      {
        name: 'venue',
        pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 },
        extensions: { KHR_materials_unlit: {} },
      },
    ],
    textures: [{ sampler: 0, extensions: { EXT_texture_webp: { source: 0 } } }],
    images: [{ name: 'venue-atlas', mimeType: 'image/webp', bufferView: imageView }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: align4(offset) }],
  };
  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPadded = Buffer.concat([jsonBytes, Buffer.alloc(align4(jsonBytes.length) - jsonBytes.length, 0x20)]);
  const bin = Buffer.concat([...bins, Buffer.alloc(align4(offset) - offset)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + bin.length, 8);
  const chunk = (type, data) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, data]);
  };
  return Buffer.concat([header, chunk(0x4e4f534a, jsonPadded), chunk(0x004e4942, bin)]);
}

export async function atlasWebp(wedge, width) {
  const { default: sharp } = await import('sharp');
  const { rgba, height } = paintAtlas(wedge, { width });
  const webp = await sharp(Buffer.from(rgba), { raw: { width, height, channels: 4 } })
    .removeAlpha()
    .webp({ quality: 82, effort: 6, smartSubsample: false })
    .toBuffer();
  return { webp, size: [width, height] };
}

export async function buildPack(wedge, pack) {
  const { webp, size } = await atlasWebp(wedge, pack.atlasWidth);
  return buildGlb(wedge, pack.lods, webp, size);
}

const sizes = (b) => `raw ${b.length}  gzip ${gzipSync(b, { level: 9 }).length}  brotli ${brotliCompressSync(b).length}`;

async function main() {
  const args = process.argv.slice(2);
  const arg = (name) => {
    const i = args.indexOf(`--${name}`);
    return i < 0 ? null : args[i + 1];
  };
  const out = resolve(arg('out') ?? PACK_DIR);
  const wedge = JSON.parse(readFileSync(arg('wedge') ?? WEDGE_JSON, 'utf8'));
  let bad = 0;
  mkdirSync(out, { recursive: true });
  for (const pack of PACKS) {
    const glb = await buildPack(wedge, pack);
    const path = join(out, pack.file);
    if (args.includes('--check')) {
      const same = existsSync(path) && readFileSync(path).equals(glb);
      console.log(`${same ? 'ok     ' : 'DIFFERS'} ${pack.file} (${glb.length} B)`);
      if (!same) bad++;
    } else {
      writeFileSync(path, glb);
      console.log(`wrote ${path}: ${sizes(glb)}`);
    }
  }
  const unity = arg('unity');
  if (unity) {
    // Unity gets the atlas as a PNG (it has no WebP importer) beside the FBX files Blender wrote; UNITY wires the material.
    const { default: sharp } = await import('sharp');
    const { rgba, width, height } = paintAtlas(wedge, { width: 512 });
    const png = await sharp(Buffer.from(rgba), { raw: { width, height, channels: 4 } })
      .removeAlpha()
      .png({ palette: true, quality: 95, colors: 192, effort: 10, compressionLevel: 9 })
      .toBuffer();
    mkdirSync(resolve(unity), { recursive: true });
    writeFileSync(join(resolve(unity), 'venue-atlas.png'), png);
    console.log(`wrote ${join(resolve(unity), 'venue-atlas.png')}: ${png.length} B (${width}x${height})`);
    const from = arg('fbx-from');
    if (from) {
      for (const f of ['wedge-lod0.fbx', 'wedge-lod1.fbx', 'wedge-lod2.fbx']) {
        copyFileSync(join(resolve(from), f), join(resolve(unity), f));
        console.log(`copied ${f}: ${statSync(join(resolve(unity), f)).size} B`);
      }
    }
  }
  if (args.includes('--report')) {
    // What meshopt would save on the geometry alone (the reason the packs do not use it).
    const { MeshoptEncoder } = await import('meshoptimizer');
    await MeshoptEncoder.ready;
    for (const lod of [0, 1]) {
      const m = wedge.lods[lod];
      const pos = new Int16Array(m.vertices * 4);
      for (let i = 0; i < m.vertices; i++) for (let c = 0; c < 3; c++) pos[i * 4 + c] = Math.round(m.pos[i * 3 + c] * POSITION_UNITS);
      const enc = MeshoptEncoder.encodeVertexBuffer(new Uint8Array(pos.buffer), m.vertices, 8);
      const raw = pos.byteLength;
      console.log(`LOD${lod} positions: ${raw} B raw, ${gzipSync(Buffer.from(pos.buffer), { level: 9 }).length} B gzip, ${enc.length} B meshopt`);
    }
  }
  if (bad) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
