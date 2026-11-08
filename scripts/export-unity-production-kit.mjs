#!/usr/bin/env node
/**
 * Deterministic MakeHuman CC0 generic-kit candidate baker for VANDE Stage 1.
 *
 * This tool deliberately produces scratch candidates only. The selected
 * clothes, hair and shoes are a rig-compatible visual foundation, not cricket
 * equipment and not player-facing acceptance evidence. Helmet, batting pads,
 * batting/keeper gloves and cricket shoes still require original art.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import yauzl from 'yauzl';

import {
  applyFictionalIdentity,
  parseObj,
} from './export-unity-production-human.mjs';
import {
  computeTangents,
  encodeVpm3,
  makeV3BoneResolver,
  parseVpm3Header,
  parseVsk1,
  quantizeV3Weights,
} from './export-unity-production-character-v3.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const DEFAULT_KIT_ARCHIVE =
  '/private/tmp/vande-realistic-player-source/makehuman_system_assets_cc0.zip';
export const DEFAULT_KIT_SOURCE_DIR = '/private/tmp/vande-realistic-player-source';
export const DEFAULT_KIT_OUTPUT_DIR = '/private/tmp/vande-production-kit-output';
export const DEFAULT_SKELETON_PATH =
  '/private/tmp/vande-production-character-v3-output/hero-skeleton.bytes';
export const SYSTEM_ASSET_PACK_URL =
  'https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip';

const MAX_ZIP_ENTRY_BYTES = 20_000_000;
const TARGET_HEIGHT_METRES = 1.78;
export const KIT_MOBILE_PROFILES = Object.freeze([
  Object.freeze({ lod: 1, usage: 'hero-batter-live', maximumCombinedTriangles: 6_000 }),
  Object.freeze({ lod: 2, usage: 'live-bowler', maximumCombinedTriangles: 4_000 }),
  // LOD3 deliberately moves live-batter geometry from generic clothes into the
  // protected anatomical face. It is baked directly from the pinned CC0 source
  // meshes, rather than simplifying an already simplified kit LOD again.
  Object.freeze({ lod: 3, usage: 'face-protected-live-batter', maximumCombinedTriangles: 2_490 }),
]);

/** Stable, reviewable selection. Stems are matched case-insensitively. */
export const DEFAULT_KIT_SELECTION = Object.freeze([
  Object.freeze({ id: 'uniform', stem: 'male_casualsuit06', region: 1, required: true }),
  // Region 11 is the production-character shader's hair material. Region 4 is batting-pad material and made the
  // imported hair render as white protective equipment.
  Object.freeze({ id: 'hair', stem: 'short04', region: 11, required: true }),
  Object.freeze({ id: 'shoes', stem: 'shoes03', region: 3, required: true }),
]);

const OPTIONAL_TEXTURE_STEMS = Object.freeze([
  'young_lightskinned_male_diffuse3',
  'young_darkskinned_male_diffuse',
]);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, scalar) => [a[0] * scalar, a[1] * scalar, a[2] * scalar];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const magnitude = (value) => Math.hypot(...value);
const normalize = (value, fallback = [0, 1, 0]) => {
  const length = magnitude(value);
  return Number.isFinite(length) && length > 1e-10 ? mul(value, 1 / length) : [...fallback];
};

function makeCoordinateTransform(body) {
  const admitted = [...new Set(body.triangles)].map((index) => body.positions[index]);
  const minimumY = Math.min(...admitted.map((position) => position[1]));
  const maximumY = Math.max(...admitted.map((position) => position[1]));
  const height = maximumY - minimumY;
  if (!Number.isFinite(height) || height <= 0) throw new Error('Pinned body height is invalid');
  const scale = TARGET_HEIGHT_METRES / height;
  return (position) => applyFictionalIdentity([
    position[0] * scale,
    (position[1] - minimumY) * scale,
    position[2] * scale,
  ]);
}

function openZip(path) {
  return new Promise((resolvePromise, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: true }, (error, zip) => {
      if (error) reject(error);
      else resolvePromise(zip);
    });
  });
}

function readEntry(zip, entry) {
  if (entry.uncompressedSize > MAX_ZIP_ENTRY_BYTES)
    throw new Error(`Selected ZIP entry ${entry.fileName} exceeds the bounded entry size`);
  return new Promise((resolvePromise, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) return reject(error);
      const chunks = [];
      let size = 0;
      stream.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_ZIP_ENTRY_BYTES) stream.destroy(new Error('ZIP entry expanded beyond its declared bound'));
        else chunks.push(chunk);
      });
      stream.once('error', reject);
      stream.once('end', () => resolvePromise(Buffer.concat(chunks, size)));
    });
  });
}

/** Read only entries relevant to the selected assets; never inflate the whole pack. */
export async function readSelectedZipEntries(path, selection = DEFAULT_KIT_SELECTION) {
  const stems = [
    ...selection.map(({ stem }) => stem.toLowerCase()),
    ...OPTIONAL_TEXTURE_STEMS,
  ];
  const zip = await openZip(path);
  const result = new Map();
  return await new Promise((resolvePromise, reject) => {
    let pending = false;
    const fail = (error) => {
      try { zip.close(); } catch { /* already closed or broken: the original error is what gets reported */ }
      reject(error);
    };
    zip.once('error', fail);
    zip.once('end', () => resolvePromise(result));
    zip.on('entry', (entry) => {
      if (pending) return fail(new Error('ZIP reader advanced while a selected entry was pending'));
      const name = entry.fileName.replaceAll('\\', '/');
      const lower = name.toLowerCase();
      const selected = !name.endsWith('/') && stems.some((stem) => lower.includes(stem));
      if (!selected) return zip.readEntry();
      pending = true;
      readEntry(zip, entry).then((bytes) => {
        result.set(name, bytes);
        pending = false;
        zip.readEntry();
      }, fail);
    });
    zip.readEntry();
  });
}

function contentBySuffix(entries, stem, suffix, { required = true } = {}) {
  const normalizedStem = stem.toLowerCase();
  const matches = [...entries.entries()].filter(([name]) => {
    const lower = name.toLowerCase();
    return lower.includes(normalizedStem) && lower.endsWith(suffix.toLowerCase());
  });
  if (matches.length === 0) {
    if (!required) return null;
    throw new Error(`Asset ${stem} has no ${suffix} entry in the CC0 pack`);
  }
  matches.sort(([left], [right]) => left.length - right.length || left.localeCompare(right));
  return { name: matches[0][0], bytes: matches[0][1] };
}

/** Parse the vertex-transfer section of a MakeHuman MHCLO/MHPXY file. */
export function parseMhcloVertexMap(text) {
  const mappings = [];
  let inVertices = false;
  let destinationIndex = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const tokens = line.split(/\s+/);
    if (tokens[0] === 'verts') {
      if (tokens[1] == null || !/^\d+$/.test(tokens[1]))
        throw new Error(`MHCLO verts section has an invalid destination offset: ${line}`);
      destinationIndex = Number(tokens[1]);
      inVertices = true;
      continue;
    }
    if (!inVertices) {
      continue;
    }
    if (!/^-?\d+$/.test(tokens[0])) {
      if (tokens[0] === 'delete_verts' || tokens[0] === 'delete_faces' || tokens[0] === 'faces')
        inVertices = false;
      continue;
    }
    let mapping;
    if (tokens.length === 1) {
      const vertex = Number(tokens[0]);
      if (vertex < 0) throw new Error('MHCLO direct vertex index must be non-negative');
      mapping = { indices: [vertex], weights: [1] };
    } else {
      if (tokens.length < 6) throw new Error(`MHCLO mapping has too few columns: ${line}`);
      const indices = tokens.slice(0, 3).map(Number);
      const weights = tokens.slice(3, 6).map(Number);
      // MakeHuman permits small signed extrapolation weights in MHCLO transfer
      // records. They normally sum to one; bound them rather than rejecting a
      // valid fitted garment.
      if (!indices.every((value) => Number.isInteger(value) && value >= 0) ||
          !weights.every((value) => Number.isFinite(value) && Math.abs(value) <= 8))
        throw new Error(`MHCLO mapping contains invalid values: ${line}`);
      const total = weights.reduce((sum, value) => sum + value, 0);
      if (Math.abs(total) <= 1e-8) throw new Error(`MHCLO mapping has zero transfer weight: ${line}`);
      mapping = { indices, weights: weights.map((value) => value / total) };
    }
    if (mappings[destinationIndex] != null)
      throw new Error(`MHCLO writes garment vertex ${destinationIndex} more than once`);
    mappings[destinationIndex++] = mapping;
  }
  if (mappings.length === 0) throw new Error('MHCLO contains no vertex mappings');
  if (Array.from({ length: mappings.length }, (_, index) => mappings[index]).some((mapping) => mapping == null))
    throw new Error('MHCLO vertex-transfer sections leave an unmapped garment vertex');
  return mappings;
}

export function sourceWeightMaps(sourceWeights, skeleton, vertexCount) {
  if (sourceWeights.license !== 'CC0') throw new Error('MakeHuman weights must declare CC0');
  const resolveBone = makeV3BoneResolver(skeleton);
  const maps = Array.from({ length: vertexCount }, () => new Map());
  for (const [boneName, entries] of Object.entries(sourceWeights.weights)) {
    const bone = resolveBone(boneName);
    for (const [vertex, weight] of entries) {
      if (!Number.isInteger(vertex) || vertex < 0 || vertex >= vertexCount ||
          !Number.isFinite(weight) || weight < 0)
        throw new Error(`Invalid MakeHuman weight for ${boneName}/${vertex}`);
      maps[vertex].set(bone, (maps[vertex].get(bone) ?? 0) + weight);
    }
  }
  return maps;
}

/** Blend base-body weights through the MHCLO barycentric vertex transfer. */
export function transferMappedWeights(baseMaps, mappings) {
  return mappings.map((mapping, garmentVertex) => {
    const blended = new Map();
    for (let source = 0; source < mapping.indices.length; source++) {
      const baseMap = baseMaps[mapping.indices[source]];
      if (!baseMap) throw new Error(`Garment vertex ${garmentVertex} maps outside the base body`);
      const share = mapping.weights[source];
      for (const [bone, weight] of baseMap)
        blended.set(bone, (blended.get(bone) ?? 0) + weight * share);
    }
    const entries = [...blended.entries()].filter(([, weight]) => weight > 1e-8);
    if (entries.length === 0) throw new Error(`Garment vertex ${garmentVertex} has no transferred weight`);
    return entries;
  });
}

function computeNormals(vertices, indices) {
  // OBJ UV seams duplicate render vertices, not cloth. Accumulate every
  // incident face by the original garment-position identity so a texture seam
  // cannot turn into a hard lighting seam on a shoulder, sleeve or pad-facing
  // silhouette. Simplified meshes retain this identity on each selected
  // source vertex and therefore use the same smoothing rule at every LOD.
  const normalBySource = new Map();
  for (let offset = 0; offset < indices.length; offset += 3) {
    const [a, b, c] = indices.slice(offset, offset + 3);
    const face = cross(
      sub(vertices[b].position, vertices[a].position),
      sub(vertices[c].position, vertices[a].position),
    );
    if (magnitude(face) <= 1e-12) continue;
    for (const index of [a, b, c]) {
      const source = vertices[index].sourcePositionIndex ?? index;
      normalBySource.set(source, add(normalBySource.get(source) ?? [0, 0, 0], face));
    }
  }
  return vertices.map((vertex, index) =>
    normalize(normalBySource.get(vertex.sourcePositionIndex ?? index) ?? [0, 1, 0]));
}

export function buildKitMesh(obj, perPositionWeights, coordinateTransform, region) {
  if (obj.triangleTexcoords.length !== obj.triangles.length ||
      obj.triangleTexcoords.some((index) => index == null))
    throw new Error('Kit OBJ must provide a UV for every admitted face corner');
  if (perPositionWeights.length !== obj.positions.length)
    throw new Error(`Kit weights ${perPositionWeights.length} do not match OBJ positions ${obj.positions.length}`);
  const vertices = [];
  const remap = new Map();
  const indices = obj.triangles.map((positionIndex, corner) => {
    const uvIndex = obj.triangleTexcoords[corner];
    const key = `${positionIndex}/${uvIndex}`;
    if (!remap.has(key)) {
      const position = coordinateTransform(obj.positions[positionIndex]);
      vertices.push({
        position,
        bindPos: [...position],
        normal: [0, 1, 0],
        tangent: [1, 0, 0, 1],
        uv: [...obj.texcoords[uvIndex]],
        sourcePositionIndex: positionIndex,
        region,
        ...quantizeV3Weights(perPositionWeights[positionIndex]),
      });
      remap.set(key, vertices.length - 1);
    }
    return remap.get(key);
  });
  const normals = computeNormals(vertices, indices);
  for (let index = 0; index < vertices.length; index++) vertices[index].normal = normals[index];
  const tangents = computeTangents(vertices, indices);
  for (let index = 0; index < vertices.length; index++) vertices[index].tangent = tangents[index];
  return { vertices, indices };
}

/** Allocate an exact combined profile budget proportionally with deterministic remainders. */
export function allocateKitTriangleBudgets(meshes, maximumCombinedTriangles) {
  if (!Number.isInteger(maximumCombinedTriangles) || maximumCombinedTriangles < meshes.length * 4)
    throw new Error('Combined kit triangle budget is invalid');
  const counts = meshes.map((mesh) => mesh.indices.length / 3);
  if (counts.some((count) => !Number.isInteger(count) || count < 4))
    throw new Error('Every kit mesh must contain at least four triangles');
  const sourceTotal = counts.reduce((sum, count) => sum + count, 0);
  if (maximumCombinedTriangles >= sourceTotal) return [...counts];
  const values = counts.map((count, index) => {
    const exact = maximumCombinedTriangles * count / sourceTotal;
    const floor = Math.max(4, Math.floor(exact));
    return { index, floor, fraction: exact - Math.floor(exact), count };
  });
  let remaining = maximumCombinedTriangles - values.reduce((sum, value) => sum + value.floor, 0);
  const order = [...values].sort((left, right) =>
    right.fraction - left.fraction || right.count - left.count || left.index - right.index);
  for (let cursor = 0; remaining > 0; cursor = (cursor + 1) % order.length) {
    const value = order[cursor];
    if (value.floor >= value.count) continue;
    value.floor++;
    remaining--;
  }
  if (remaining !== 0) throw new Error('Unable to allocate the combined kit triangle budget');
  return values.sort((left, right) => left.index - right.index).map(({ floor }) => floor);
}

/** Open-surface-safe deterministic mobile reduction; skin data follows retained source vertices. */
export function simplifyKitMesh(high, targetTriangles) {
  if (!Number.isInteger(targetTriangles) || targetTriangles < 4)
    throw new Error(`Invalid kit LOD target ${targetTriangles}`);
  const sourceTriangles = high.indices.length / 3;
  if (targetTriangles >= sourceTriangles) {
    return {
      vertices: high.vertices.map((vertex) => ({
        ...vertex,
        position: [...vertex.position], normal: [...vertex.normal], tangent: [...vertex.tangent],
        bindPos: [...vertex.bindPos], uv: [...vertex.uv], bones: [...vertex.bones], weights: [...vertex.weights],
      })),
      indices: [...high.indices],
    };
  }
  const positions = new Float32Array(high.vertices.length * 3);
  const uvs = new Float32Array(high.vertices.length * 2);
  for (let index = 0; index < high.vertices.length; index++) {
    positions.set(high.vertices[index].position, index * 3);
    uvs.set(high.vertices[index].uv, index * 2);
  }
  let sourceIndices = null;
  for (const maximumError of [0.08, 0.2, 0.5, 1.0]) {
    const [candidate] = MeshoptSimplifier.simplifyWithAttributes(
      new Uint32Array(high.indices),
      positions,
      3,
      uvs,
      2,
      [10],
      null,
      targetTriangles * 3,
      maximumError,
      [],
    );
    sourceIndices = candidate;
    if (candidate.length / 3 <= targetTriangles) break;
  }
  if (sourceIndices.length % 3 !== 0 || sourceIndices.length / 3 > targetTriangles)
    throw new Error(`Kit simplifier missed target ${targetTriangles}`);
  const indices = new Uint32Array(sourceIndices);
  const [remap, vertexCount] = MeshoptSimplifier.compactMesh(indices);
  const missing = 0xffffffff;
  const vertices = new Array(vertexCount);
  for (let source = 0; source < remap.length; source++) {
    const compact = remap[source];
    if (compact === missing) continue;
    const vertex = high.vertices[source];
    vertices[compact] = {
      ...vertex,
      position: [...vertex.position], normal: [0, 1, 0], tangent: [1, 0, 0, 1],
      bindPos: [...vertex.bindPos], uv: [...vertex.uv], bones: [...vertex.bones], weights: [...vertex.weights],
    };
  }
  if (vertices.some((vertex) => vertex == null)) throw new Error('Kit LOD compaction left an empty vertex');
  const compactIndices = Array.from(indices);
  const normals = computeNormals(vertices, compactIndices);
  for (let index = 0; index < vertices.length; index++) vertices[index].normal = normals[index];
  const tangents = computeTangents(vertices, compactIndices);
  for (let index = 0; index < vertices.length; index++) vertices[index].tangent = tangents[index];
  return { vertices, indices: compactIndices };
}

async function writeIfChanged(path, bytes) {
  let current = null;
  try { current = await readFile(path); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (current == null || !current.equals(bytes)) await writeFile(path, bytes);
}

function selectedAssetEntries(entries, descriptor) {
  const obj = contentBySuffix(entries, descriptor.stem, '.obj', { required: descriptor.required });
  if (obj == null) return null;
  const transfer = contentBySuffix(entries, descriptor.stem, '.mhclo', { required: false }) ??
    contentBySuffix(entries, descriptor.stem, '.mhpxy', { required: false });
  if (transfer == null)
    throw new Error(`Asset ${descriptor.stem} needs MHCLO/MHPXY transfer data`);
  const material = contentBySuffix(entries, descriptor.stem, '.mhmat', { required: false });
  return { obj, transfer, material };
}

export async function exportProductionKit({
  archivePath = DEFAULT_KIT_ARCHIVE,
  sourceDir = DEFAULT_KIT_SOURCE_DIR,
  outputDir = DEFAULT_KIT_OUTPUT_DIR,
  skeletonPath = DEFAULT_SKELETON_PATH,
  selection = DEFAULT_KIT_SELECTION,
} = {}) {
  const [archiveBytes, bodyBytes, skeletonSourceBytes, weightsBytes, skeletonBytes] = await Promise.all([
    readFile(archivePath),
    readFile(join(sourceDir, 'base.obj')),
    readFile(join(sourceDir, 'default.mhskel')),
    readFile(join(sourceDir, 'default_weights.mhw')),
    readFile(skeletonPath),
  ]);
  const skeletonHeader = parseVsk1(skeletonBytes);
  const skeletonId = skeletonBytes.subarray(16, 24);
  const body = parseObj(bodyBytes.toString('utf8'), { includeGroup: 'body' });
  const skeleton = JSON.parse(skeletonSourceBytes.toString('utf8'));
  const sourceWeights = JSON.parse(weightsBytes.toString('utf8'));
  const baseMaps = sourceWeightMaps(sourceWeights, skeleton, body.positions.length);
  const coordinateTransform = makeCoordinateTransform(body);
  const entries = await readSelectedZipEntries(archivePath, selection);

  await mkdir(outputDir, { recursive: true });
  const candidates = [];
  for (const descriptor of selection) {
    const source = selectedAssetEntries(entries, descriptor);
    if (source == null) continue;
    const obj = parseObj(source.obj.bytes.toString('utf8'));
    const mappings = parseMhcloVertexMap(source.transfer.bytes.toString('utf8'));
    if (mappings.length !== obj.positions.length)
      throw new Error(`${descriptor.id} mapping count ${mappings.length} != OBJ positions ${obj.positions.length}`);
    candidates.push({
      descriptor,
      source,
      mesh: buildKitMesh(
        obj,
        transferMappedWeights(baseMaps, mappings),
        coordinateTransform,
        descriptor.region,
      ),
    });
  }
  await MeshoptSimplifier.ready;
  const profileBudgets = new Map(KIT_MOBILE_PROFILES.map((profile) => [
    profile.lod,
    allocateKitTriangleBudgets(
      candidates.map(({ mesh }) => mesh),
      profile.maximumCombinedTriangles,
    ),
  ]));
  const assets = [];
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
    const { descriptor, source, mesh } = candidates[candidateIndex];
    const meshes = [{ lod: 0, usage: 'close-up-source', mesh }];
    for (const profile of KIT_MOBILE_PROFILES) {
      meshes.push({
        lod: profile.lod,
        usage: profile.usage,
        mesh: simplifyKitMesh(mesh, profileBudgets.get(profile.lod)[candidateIndex]),
      });
    }
    const lods = [];
    for (const candidate of meshes) {
      const bytes = encodeVpm3(candidate.mesh, skeletonId);
      const header = parseVpm3Header(bytes);
      if (header.skeletonId !== skeletonHeader.skeletonId)
        throw new Error(`${descriptor.id} LOD${candidate.lod} skeleton ID does not match the hero VSK1`);
      const path = join(outputDir, `${descriptor.id}-lod${candidate.lod}.bytes`);
      await writeIfChanged(path, bytes);
      lods.push({
        lod: candidate.lod,
        usage: candidate.usage,
        outputPath: path,
        bytes: bytes.length,
        sha256: sha256(bytes),
        vertexCount: header.vertexCount,
        triangleCount: header.indexCount / 3,
      });
    }
    const materialTextures = [];
    const textureCandidates = [...entries.entries()]
      .filter(([name]) => name.toLowerCase().includes(descriptor.stem.toLowerCase()) &&
        /\.(png|jpe?g)$/i.test(name))
      .sort(([left], [right]) => left.localeCompare(right));
    for (const [sourceName, textureBytes] of textureCandidates) {
      const sourceBase = basename(sourceName, extname(sourceName));
      const extension = extname(sourceName).toLowerCase() === '.png' ? '.png' : '.jpg';
      const texturePath = join(outputDir, `${descriptor.id}-${sourceBase}${extension}`);
      await writeIfChanged(texturePath, textureBytes);
      materialTextures.push({
        source: sourceName,
        outputPath: texturePath,
        bytes: textureBytes.length,
        sha256: sha256(textureBytes),
      });
    }
    assets.push({
      id: descriptor.id,
      status: 'GENERIC CC0 FOUNDATION / NOT CRICKET EQUIPMENT / NOT ACCEPTED',
      sourceObj: source.obj.name,
      sourceTransfer: source.transfer.name,
      sourceMaterial: source.material?.name ?? null,
      outputPath: lods[0].outputPath,
      bytes: lods[0].bytes,
      sha256: lods[0].sha256,
      vertexCount: lods[0].vertexCount,
      triangleCount: lods[0].triangleCount,
      lods,
      materialTextures,
    });
  }

  const textures = [];
  for (const stem of OPTIONAL_TEXTURE_STEMS) {
    const candidate = [...entries.entries()]
      .filter(([name]) => name.toLowerCase().includes(stem) && /\.(png|jpe?g)$/i.test(name))
      .sort(([left], [right]) => left.length - right.length || left.localeCompare(right))[0];
    if (!candidate) continue;
    const extension = candidate[0].toLowerCase().endsWith('.png') ? '.png' : '.jpg';
    const path = join(outputDir, `${stem}${extension}`);
    await writeIfChanged(path, candidate[1]);
    textures.push({ source: candidate[0], outputPath: path, bytes: candidate[1].length, sha256: sha256(candidate[1]) });
  }

  const manifest = {
    status: 'TECHNICAL GENERIC-KIT FOUNDATION ONLY / NOT PLAYER-FACING ACCEPTED',
    generatedAtUtc: new Date(0).toISOString(),
    source: {
      url: SYSTEM_ASSET_PACK_URL,
      archivePath,
      archiveBytes: archiveBytes.length,
      archiveSha256: sha256(archiveBytes),
      license: 'CC0-1.0',
      officialLicensePage: 'https://www.makehumancommunity.org/about/license.html',
    },
    skeletonId: skeletonHeader.skeletonId,
    normalPolicy: 'area-weighted garment normals are welded by original OBJ position across UV seams; the source identity is retained through every simplified kit LOD',
    mobileProfiles: KIT_MOBILE_PROFILES.map((profile) => ({
      ...profile,
      achievedCombinedTriangles: assets.reduce(
        (sum, asset) => sum + asset.lods.find(({ lod }) => lod === profile.lod).triangleCount,
        0,
      ),
    })),
    assets,
    textures,
    limitations: [
      'The selected outfit, hair and shoes are generic MakeHuman assets, not cricket-specific production art.',
      'Helmet, grille, batting pads, batting gloves, keeper gloves and cricket shoes remain unsourced.',
      'Cricket motion, clipping, WebGL/Android performance and visual acceptance are UNPROVEN.',
      'Android fresh-installed size and India-weighted working reach are UNPROVEN.',
    ],
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const manifestPath = join(outputDir, 'generic-kit-provenance.json');
  await writeIfChanged(manifestPath, manifestBytes);
  return {
    ...manifest,
    manifestPath,
    totalMeshBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
    totalDeliveredMeshBytes: assets.reduce(
      (sum, asset) => sum + asset.lods.reduce((lodSum, lod) => lodSum + lod.bytes, 0),
      0,
    ),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  exportProductionKit({
    archivePath: process.argv[2] ?? DEFAULT_KIT_ARCHIVE,
    outputDir: process.argv[3] ?? DEFAULT_KIT_OUTPUT_DIR,
  }).then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`), (error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
