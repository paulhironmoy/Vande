#!/usr/bin/env node
/**
 * Cover-drive P2: encode the Blender hero (scripts/blender/cover_drive_hero_export.py skin JSON) into the runtime's
 * own VSK1 skeleton and VPM3 skinned-mesh formats, using the existing encoders and weight quantizer of
 * scripts/export-unity-production-character-v3.mjs, so the bytes follow exactly the contract Unity already decodes.
 *
 *   node scripts/cover-drive/encode-hero.mjs <export-dir> <out-dir>
 *
 * Writes hero-skeleton.bytes, hero-lod0.bytes, hero-lod1.bytes, and when exported hero-eyes.bytes and
 * hero-gear-lod0/lod1.bytes, all against the new skeleton id, plus encode.json (bytes, SHA-256, counts, regions,
 * skeleton id). It writes nothing into unity/: placing these in a Resources folder ships them in every build, so that
 * waits for the lead's wiring decision (the P2 report's request).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  V3_BONE_COUNT,
  V3_BONE_NAMES,
  computeTangents,
  encodeVpm3,
  encodeVsk1,
  quantizeV3Weights,
} from '../export-unity-production-character-v3.mjs';

const [exportDir, outDir] = process.argv.slice(2).map((p) => path.resolve(p));
if (!exportDir || !outDir) throw new Error('usage: encode-hero.mjs <export-dir> <out-dir>');
mkdirSync(outDir, { recursive: true });

// Same canonical driver semantics as export-unity-production-character-v3.mjs, then hero-bundle's Hips -> root map.
const SEMANTIC = new Map([
  ['spine05', 0], ['spine03', 1], ['spine01', 2], ['neck01', 3], ['head', 4],
  ['upperarm01.L', 5], ['lowerarm01.L', 6], ['wrist.L', 7],
  ['upperarm01.R', 8], ['lowerarm01.R', 9], ['wrist.R', 10],
  ['upperleg01.L', 11], ['lowerleg01.L', 12], ['foot.L', 13],
  ['upperleg01.R', 14], ['lowerleg01.R', 15], ['foot.R', 16],
]);
const NONE = 0xffff;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const m = Math.hypot(...a); return m > 1e-12 ? a.map((x) => x / m) : [0, 1, 0]; };

function skeleton(bonesJson) {
  if (bonesJson.length !== V3_BONE_COUNT || bonesJson.some((b, i) => b.name !== V3_BONE_NAMES[i]))
    throw new Error('the exported skeleton is not the game skeleton in V3 order');
  const bones = bonesJson.map((b, index) => ({
    parent: b.parent,
    semantic: SEMANTIC.get(b.name) ?? NONE,
    localPosition: b.parent < 0 ? b.head : sub(b.head, bonesJson[b.parent].head),
    localRotation: [0, 0, 0, 1],
    index,
  }));
  const hips = bones.findIndex((b) => b.semantic === 0);
  return bones.map((b, index) => ({
    parent: b.parent,
    semantic: index === 0 ? 0 : index === hips ? NONE : b.semantic,
    localPosition: b.localPosition,
    localRotation: b.localRotation,
  }));
}

function mesh(json) {
  const vertices = json.vertices.map((v) => ({
    position: v.position, bindPos: [...v.position], uv: v.uv, region: v.region, normal: [0, 1, 0],
    ...quantizeV3Weights(v.weights),
  }));
  // Smooth normals per position (seams split for UVs share one normal), area weighted.
  const acc = new Map();
  const key = (p) => p.map((x) => x.toFixed(6)).join(',');
  for (let i = 0; i < json.indices.length; i += 3) {
    const [a, b, c] = json.indices.slice(i, i + 3).map((k) => vertices[k].position);
    const n = cross(sub(b, a), sub(c, a));
    for (const p of [a, b, c]) {
      const k = key(p);
      const cur = acc.get(k) ?? [0, 0, 0];
      acc.set(k, [cur[0] + n[0], cur[1] + n[1], cur[2] + n[2]]);
    }
  }
  for (const v of vertices) v.normal = norm(acc.get(key(v.position)) ?? [0, 1, 0]);
  const tangents = computeTangents(vertices, json.indices);
  vertices.forEach((v, i) => { v.tangent = tangents[i]; });
  return { vertices, indices: json.indices };
}

const report = { schema: 'vande.cover-drive.hero-encode.v1', files: {} };
const lod0 = JSON.parse(readFileSync(path.join(exportDir, 'hero-skin-lod0.json'), 'utf8'));
const vsk = encodeVsk1(skeleton(lod0.bones));
const skeletonId = vsk.subarray(16, 24);
writeFileSync(path.join(outDir, 'hero-skeleton.bytes'), vsk);
report.skeletonId = Buffer.from(skeletonId).toString('hex');
report.files['hero-skeleton.bytes'] = { bytes: vsk.length, sha256: sha(vsk) };
const sources = [
  ['hero-lod0.bytes', 'hero-skin-lod0.json'],
  ['hero-lod1.bytes', 'hero-skin-lod1.json'],
  ['hero-eyes.bytes', 'hero-eyes.json'],
  ['hero-gear-lod0.bytes', 'hero-gear-lod0.json'],
  ['hero-gear-lod1.bytes', 'hero-gear-lod1.json'],
];
for (const [outName, jsonName] of sources) {
  const jsonPath = path.join(exportDir, jsonName);
  if (!existsSync(jsonPath)) continue;
  const json = jsonName === 'hero-skin-lod0.json' ? lod0 : JSON.parse(readFileSync(jsonPath, 'utf8'));
  const m = mesh(json);
  if (m.vertices.length > 0xffff) throw new Error(`${outName} has ${m.vertices.length} vertices (> 65535)`);
  const bytes = encodeVpm3(m, skeletonId);
  writeFileSync(path.join(outDir, outName), bytes);
  const regions = {};
  for (let i = 0; i < m.indices.length; i += 3) {
    const r = m.vertices[m.indices[i]].region;
    regions[r] = (regions[r] ?? 0) + 1;
  }
  report.files[outName] = { bytes: bytes.length, sha256: sha(bytes), vertices: m.vertices.length,
    triangles: m.indices.length / 3, trianglesByRegion: regions };
}
writeFileSync(path.join(outDir, 'encode.json'), `${JSON.stringify(report, null, 1)}\n`);
process.stdout.write(`${JSON.stringify(report)}\n`);
