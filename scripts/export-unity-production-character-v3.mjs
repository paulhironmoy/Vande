#!/usr/bin/env node
/**
 * Deterministic MakeHuman CC0 hero-character baker for VANDE Stage 1.
 *
 * This is a parallel candidate pipeline. It does not overwrite the VPM1/VPM2
 * fallback assets. VSK1 carries a compact 75-bone hierarchy; VPM3 carries UVs,
 * tangents and four normalized skin influences. Runtime adoption is separate.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

import {
  applyFictionalIdentity,
  buildLowMesh,
  meshTopologyFacts,
  meshUvFacts,
  parseObj,
} from './export-unity-production-human.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);

export const DEFAULT_V3_SOURCE_DIR = '/private/tmp/vande-realistic-player-source';
export const DEFAULT_V3_OUTPUT_DIR = '/private/tmp/vande-production-character-v3-output';
export const VSK1_MAGIC = 'VSK1';
export const VSK1_VERSION = 1;
export const VSK1_HEADER_BYTES = 32;
export const VSK1_BONE_BYTES = 32;
export const VPM3_MAGIC = 'VPM3';
export const VPM3_VERSION = 3;
export const VPM3_HEADER_BYTES = 32;
export const VPM3_VERTEX_BYTES = 72;
export const VPM3_INFLUENCES = 4;
export const VPM3_INDEX_BYTES = 2;
export const V3_BONE_COUNT = 75;

const TARGET_HEIGHT_METRES = 1.78;
const MAX_VERTICES = 0xffff;
const MAX_INDICES = 200_000;
// V3 is intentionally hero-only: batter/bowler receive a close and live-gameplay
// LOD. Distant fielders retain the measured VPM2 path until device profiling.
const LOD_TRIANGLE_LIMITS = Object.freeze([40_000, 4_000]);

export const V3_PINNED_SOURCES = Object.freeze({
  mesh: Object.freeze({
    localName: 'base.obj',
    sha256: '8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c',
  }),
  skeleton: Object.freeze({
    localName: 'default.mhskel',
    sha256: '99f179bce0aa850b45d4191a1d0d234c5851f881c057439470ded3bddf729a24',
  }),
  weights: Object.freeze({
    localName: 'default_weights.mhw',
    sha256: '0f3641d651ae3d00ad6b4ccee43142edb109d3bd909d27d9e4139ef1beed8625',
  }),
});

const sides = ['L', 'R'];
const coreBones = [
  'root', 'pelvis.L', 'pelvis.R',
  'spine05', 'spine04', 'spine03', 'spine02', 'spine01',
  'neck01', 'neck02', 'neck03', 'head', 'jaw',
];
const armBones = sides.flatMap((side) => [
  `clavicle.${side}`, `shoulder01.${side}`,
  `upperarm01.${side}`, `upperarm02.${side}`,
  `lowerarm01.${side}`, `lowerarm02.${side}`, `wrist.${side}`,
]);
const handBones = sides.flatMap((side) => [
  `metacarpal1.${side}`, `metacarpal2.${side}`,
  `metacarpal3.${side}`, `metacarpal4.${side}`,
  ...Array.from({ length: 5 }, (_, finger) =>
    Array.from({ length: 3 }, (_, segment) => `finger${finger + 1}-${segment + 1}.${side}`)).flat(),
]);
const legBones = sides.flatMap((side) => [
  `upperleg01.${side}`, `upperleg02.${side}`,
  `lowerleg01.${side}`, `lowerleg02.${side}`, `foot.${side}`,
]);

/** Stable semantic order shared with the Unity decoder. Never sort this list. */
export const V3_BONE_NAMES = Object.freeze([...coreBones, ...armBones, ...handBones, ...legBones]);
if (V3_BONE_NAMES.length !== V3_BONE_COUNT || new Set(V3_BONE_NAMES).size !== V3_BONE_COUNT)
  throw new Error(`V3 bone declaration must contain exactly ${V3_BONE_COUNT} unique bones`);

const canonicalSemanticByBone = new Map([
  ['spine05', 0], ['spine03', 1], ['spine01', 2], ['neck01', 3], ['head', 4],
  ['upperarm01.L', 5], ['lowerarm01.L', 6], ['wrist.L', 7],
  ['upperarm01.R', 8], ['lowerarm01.R', 9], ['wrist.R', 10],
  ['upperleg01.L', 11], ['lowerleg01.L', 12], ['foot.L', 13],
  ['upperleg01.R', 14], ['lowerleg01.R', 15], ['foot.R', 16],
]);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, scalar) => [a[0] * scalar, a[1] * scalar, a[2] * scalar];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const magnitude = (value) => Math.hypot(...value);
const normalize = (value, fallback = [0, 1, 0]) => {
  const size = magnitude(value);
  return Number.isFinite(size) && size > 1e-10 ? mul(value, 1 / size) : [...fallback];
};

function assertInteger(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new Error(`${label} must be an integer in [${minimum}, ${maximum}], got ${value}`);
}

function assertFiniteVector(value, label, size) {
  if (!Array.isArray(value) || value.length !== size || !value.every(Number.isFinite))
    throw new Error(`${label} must contain ${size} finite values`);
}

function jointCentroid(skeleton, sourcePositions, jointName) {
  const indices = skeleton.joints[jointName];
  if (!Array.isArray(indices) || indices.length === 0)
    throw new Error(`MakeHuman joint ${jointName} is absent or empty`);
  let total = [0, 0, 0];
  for (const index of indices) {
    if (!sourcePositions[index]) throw new Error(`MakeHuman joint ${jointName} references vertex ${index}`);
    total = add(total, sourcePositions[index]);
  }
  return mul(total, 1 / indices.length);
}

function makeCoordinateTransform(obj) {
  const admitted = [...new Set(obj.triangles)].map((index) => obj.positions[index]);
  const minimumY = Math.min(...admitted.map((position) => position[1]));
  const maximumY = Math.max(...admitted.map((position) => position[1]));
  const sourceHeight = maximumY - minimumY;
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0) throw new Error('MakeHuman body has invalid height');
  const scale = TARGET_HEIGHT_METRES / sourceHeight;
  return (position) => applyFictionalIdentity([
    position[0] * scale,
    (position[1] - minimumY) * scale,
    position[2] * scale,
  ]);
}

/** Resolve an omitted source bone to its nearest retained ancestor. */
export function makeV3BoneResolver(skeleton) {
  const retained = new Map(V3_BONE_NAMES.map((name, index) => [name, index]));
  const cache = new Map();
  const resolving = new Set();
  const resolveBone = (name) => {
    if (cache.has(name)) return cache.get(name);
    if (resolving.has(name)) throw new Error(`Cycle in MakeHuman skeleton at ${name}`);
    const bone = skeleton.bones[name];
    if (!bone) throw new Error(`MakeHuman weights reference undeclared bone ${name}`);
    resolving.add(name);
    const result = retained.has(name)
      ? retained.get(name)
      : bone.parent == null ? null : resolveBone(bone.parent);
    resolving.delete(name);
    if (result == null) throw new Error(`MakeHuman bone ${name} has no retained ancestor`);
    cache.set(name, result);
    return result;
  };
  return resolveBone;
}

function retainedParentIndex(skeleton, name, indexByName) {
  let parent = skeleton.bones[name]?.parent ?? null;
  const visited = new Set([name]);
  while (parent != null && !indexByName.has(parent)) {
    if (visited.has(parent)) throw new Error(`Cycle in MakeHuman parent chain at ${parent}`);
    visited.add(parent);
    const parentBone = skeleton.bones[parent];
    if (!parentBone) throw new Error(`MakeHuman bone ${name} references undeclared parent ${parent}`);
    parent = parentBone.parent;
  }
  return parent == null ? -1 : indexByName.get(parent);
}

export function buildV3Skeleton(skeleton, sourcePositions, coordinateTransform) {
  if (skeleton.license !== 'CC0') throw new Error('Pinned MakeHuman skeleton must declare CC0');
  const indexByName = new Map(V3_BONE_NAMES.map((name, index) => [name, index]));
  const worldPositions = V3_BONE_NAMES.map((name) => {
    const bone = skeleton.bones[name];
    if (!bone) throw new Error(`MakeHuman skeleton is missing retained bone ${name}`);
    return coordinateTransform(jointCentroid(skeleton, sourcePositions, bone.head));
  });
  const bones = V3_BONE_NAMES.map((name, index) => {
    const parent = retainedParentIndex(skeleton, name, indexByName);
    if (parent >= index) throw new Error(`V3 parent ${parent} must precede ${name}/${index}`);
    return {
      name,
      parent,
      semantic: canonicalSemanticByBone.get(name) ?? 0xffff,
      localPosition: parent < 0 ? worldPositions[index] : sub(worldPositions[index], worldPositions[parent]),
      localRotation: [0, 0, 0, 1],
    };
  });
  if (bones.filter(({ parent }) => parent < 0).length !== 1 || bones[0].parent !== -1)
    throw new Error('V3 skeleton must have exactly one root at index zero');
  return bones;
}

function mappedWeights(sourceWeights, skeleton, vertexCount) {
  if (sourceWeights.license !== 'CC0') throw new Error('Pinned MakeHuman weights must declare CC0');
  const maps = Array.from({ length: vertexCount }, () => new Map());
  const resolveBone = makeV3BoneResolver(skeleton);
  for (const [boneName, entries] of Object.entries(sourceWeights.weights)) {
    const boneIndex = resolveBone(boneName);
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2) throw new Error(`Invalid weight entry for ${boneName}`);
      const [vertexIndex, weight] = entry;
      if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= vertexCount)
        throw new Error(`Weight for ${boneName} references vertex ${vertexIndex}`);
      if (!Number.isFinite(weight) || weight < 0) throw new Error(`Invalid weight for ${boneName}/${vertexIndex}`);
      maps[vertexIndex].set(boneIndex, (maps[vertexIndex].get(boneIndex) ?? 0) + weight);
    }
  }
  return maps.map((map, vertexIndex) => {
    const entries = [...map.entries()].filter(([, weight]) => weight > 1e-8);
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    if (!(total > 0)) throw new Error(`MakeHuman vertex ${vertexIndex} has no mapped skin weight`);
    return entries.map(([bone, weight]) => [bone, weight / total]);
  });
}

/** Strongest four influences, deterministic largest-remainder quantization to exactly 255. */
export function quantizeV3Weights(entries) {
  const selected = [...entries]
    .filter(([, weight]) => Number.isFinite(weight) && weight > 0)
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])
    .slice(0, VPM3_INFLUENCES);
  const total = selected.reduce((sum, [, weight]) => sum + weight, 0);
  if (!(total > 0)) throw new Error('Vertex has no positive V3 skin weights');
  const scaled = selected.map(([bone, weight]) => {
    assertInteger(bone, 'bone', 0, V3_BONE_COUNT - 1);
    const exact = weight / total * 255;
    return { bone, floor: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  const remainder = 255 - scaled.reduce((sum, value) => sum + value.floor, 0);
  const distribution = scaled
    .map((value, index) => ({ index, bone: value.bone, fraction: value.fraction }))
    .sort((left, right) => right.fraction - left.fraction || left.bone - right.bone);
  for (let index = 0; index < remainder; index++) scaled[distribution[index].index].floor++;
  const bones = new Array(VPM3_INFLUENCES).fill(0);
  const weights = new Array(VPM3_INFLUENCES).fill(0);
  for (let index = 0; index < scaled.length; index++) {
    bones[index] = scaled[index].bone;
    weights[index] = scaled[index].floor;
  }
  if (weights.reduce((sum, value) => sum + value, 0) !== 255)
    throw new Error('VPM3 quantized skin weights must sum to 255');
  return { bones, weights };
}

const namedBoneIndices = V3_BONE_NAMES.map((name, index) => ({ name, index }));
const headAndSkinBones = new Set(namedBoneIndices
  .filter(({ name }) => name === 'head' || name === 'jaw' || name.startsWith('neck') ||
    name.startsWith('lowerarm') || name.startsWith('wrist') || name.startsWith('metacarpal') ||
    name.startsWith('finger'))
  .map(({ index }) => index));
const footBones = new Set(namedBoneIndices
  .filter(({ name }) => name.startsWith('foot.'))
  .map(({ index }) => index));
const lowerBodyBones = new Set(namedBoneIndices
  .filter(({ name }) => name === 'root' || name.startsWith('pelvis.') || name.startsWith('upperleg') ||
    name.startsWith('lowerleg'))
  .map(({ index }) => index));

function regionForWeights(entries) {
  const dominant = [...entries].sort((left, right) => right[1] - left[1] || left[0] - right[0])[0][0];
  if (headAndSkinBones.has(dominant)) return 0;
  if (footBones.has(dominant)) return 3;
  if (lowerBodyBones.has(dominant)) return 2;
  return 1;
}

function computeNormals(vertices, indices) {
  const accumulated = new Map();
  for (let offset = 0; offset < indices.length; offset += 3) {
    const triangle = indices.slice(offset, offset + 3);
    const face = cross(
      sub(vertices[triangle[1]].position, vertices[triangle[0]].position),
      sub(vertices[triangle[2]].position, vertices[triangle[0]].position),
    );
    if (magnitude(face) <= 1e-12) continue;
    for (const index of triangle) {
      const source = vertices[index].sourcePositionIndex ?? index;
      accumulated.set(source, add(accumulated.get(source) ?? [0, 0, 0], face));
    }
  }
  return vertices.map((vertex, index) => normalize(
    accumulated.get(vertex.sourcePositionIndex ?? index) ?? [0, 1, 0],
  ));
}

export function computeTangents(vertices, indices) {
  const tangent = Array.from({ length: vertices.length }, () => [0, 0, 0]);
  const bitangent = Array.from({ length: vertices.length }, () => [0, 0, 0]);
  for (let offset = 0; offset < indices.length; offset += 3) {
    const [a, b, c] = indices.slice(offset, offset + 3);
    const edge1 = sub(vertices[b].position, vertices[a].position);
    const edge2 = sub(vertices[c].position, vertices[a].position);
    const uv1 = sub(vertices[b].uv, vertices[a].uv);
    const uv2 = sub(vertices[c].uv, vertices[a].uv);
    const divisor = uv1[0] * uv2[1] - uv1[1] * uv2[0];
    if (Math.abs(divisor) <= 1e-12) continue;
    const reciprocal = 1 / divisor;
    const s = mul(sub(mul(edge1, uv2[1]), mul(edge2, uv1[1])), reciprocal);
    const t = mul(sub(mul(edge2, uv1[0]), mul(edge1, uv2[0])), reciprocal);
    for (const index of [a, b, c]) {
      tangent[index] = add(tangent[index], s);
      bitangent[index] = add(bitangent[index], t);
    }
  }
  return vertices.map((vertex, index) => {
    const normal = vertex.normal;
    let orthogonal = sub(tangent[index], mul(normal, dot(normal, tangent[index])));
    if (magnitude(orthogonal) <= 1e-10) {
      const reference = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      orthogonal = cross(reference, normal);
    }
    orthogonal = normalize(orthogonal, [1, 0, 0]);
    const handedness = dot(cross(normal, orthogonal), bitangent[index]) < 0 ? -1 : 1;
    return [...orthogonal, handedness];
  });
}

export function buildV3HighMesh(obj, skeleton, sourceWeights, coordinateTransform) {
  if (obj.triangleTexcoords.length !== obj.triangles.length ||
      obj.triangleTexcoords.some((index) => index == null))
    throw new Error('Pinned MakeHuman body faces must provide a UV for every admitted corner');
  const perSourceWeights = mappedWeights(sourceWeights, skeleton, obj.positions.length);
  const referenced = [];
  const remap = new Map();
  const indices = obj.triangles.map((sourcePositionIndex, corner) => {
    const sourceTexcoordIndex = obj.triangleTexcoords[corner];
    const key = `${sourcePositionIndex}/${sourceTexcoordIndex}`;
    if (!remap.has(key)) {
      remap.set(key, referenced.length);
      referenced.push({ sourcePositionIndex, sourceTexcoordIndex });
    }
    return remap.get(key);
  });
  const vertices = referenced.map(({ sourcePositionIndex, sourceTexcoordIndex }) => {
    const entries = perSourceWeights[sourcePositionIndex];
    const position = coordinateTransform(obj.positions[sourcePositionIndex]);
    return {
      position,
      normal: [0, 1, 0],
      tangent: [1, 0, 0, 1],
      bindPos: [...position],
      uv: [...obj.texcoords[sourceTexcoordIndex]],
      sourcePositionIndex,
      sourceTexcoordIndex,
      region: regionForWeights(entries),
      ...quantizeV3Weights(entries),
    };
  });
  const normals = computeNormals(vertices, indices);
  for (let index = 0; index < vertices.length; index++) vertices[index].normal = normals[index];
  const tangents = computeTangents(vertices, indices);
  for (let index = 0; index < vertices.length; index++) vertices[index].tangent = tangents[index];
  return { vertices, indices };
}

function writeFloatVector(bytes, offset, vector) {
  for (const value of vector) {
    bytes.writeFloatLE(value, offset);
    offset += 4;
  }
  return offset;
}

function encodeVsk1Records(bones) {
  if (!Array.isArray(bones) || bones.length !== V3_BONE_COUNT)
    throw new Error(`VSK1 requires exactly ${V3_BONE_COUNT} bones`);
  const records = Buffer.alloc(V3_BONE_COUNT * VSK1_BONE_BYTES);
  let offset = 0;
  const semanticCounts = new Uint8Array(17);
  for (let index = 0; index < bones.length; index++) {
    const bone = bones[index];
    assertInteger(bone.parent, `bone[${index}].parent`, -1, index - 1);
    assertInteger(bone.semantic, `bone[${index}].semantic`, 0, 0xffff);
    if (bone.semantic !== 0xffff) {
      if (bone.semantic >= semanticCounts.length) throw new Error(`Unknown canonical semantic ${bone.semantic}`);
      semanticCounts[bone.semantic]++;
    }
    assertFiniteVector(bone.localPosition, `bone[${index}].localPosition`, 3);
    assertFiniteVector(bone.localRotation, `bone[${index}].localRotation`, 4);
    records.writeInt16LE(bone.parent, offset);
    offset += 2;
    records.writeUInt16LE(bone.semantic, offset);
    offset += 2;
    offset = writeFloatVector(records, offset, bone.localPosition);
    offset = writeFloatVector(records, offset, bone.localRotation);
  }
  if ([...semanticCounts].some((count) => count !== 1))
    throw new Error(`VSK1 must map each canonical driver semantic exactly once: ${[...semanticCounts]}`);
  if (offset !== records.length) throw new Error('VSK1 record writer length mismatch');
  return records;
}

export function encodeVsk1(bones) {
  const records = encodeVsk1Records(bones);
  const skeletonId = createHash('sha256').update(records).digest().subarray(0, 8);
  const bytes = Buffer.alloc(VSK1_HEADER_BYTES + records.length);
  bytes.write(VSK1_MAGIC, 0, 4, 'ascii');
  bytes.writeUInt16LE(VSK1_VERSION, 4);
  bytes.writeUInt16LE(V3_BONE_COUNT, 6);
  bytes.writeUInt16LE(VSK1_BONE_BYTES, 8);
  bytes.writeUInt16LE(0, 10);
  bytes.writeUInt32LE(0, 12);
  skeletonId.copy(bytes, 16);
  bytes.writeBigUInt64LE(0n, 24);
  records.copy(bytes, VSK1_HEADER_BYTES);
  return bytes;
}

export function parseVsk1(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length < VSK1_HEADER_BYTES) throw new Error('VSK1 payload is shorter than its header');
  const magic = bytes.toString('ascii', 0, 4);
  const version = bytes.readUInt16LE(4);
  const boneCount = bytes.readUInt16LE(6);
  const boneBytes = bytes.readUInt16LE(8);
  const expectedBytes = VSK1_HEADER_BYTES + boneCount * boneBytes;
  if (magic !== VSK1_MAGIC || version !== VSK1_VERSION || boneCount !== V3_BONE_COUNT ||
      boneBytes !== VSK1_BONE_BYTES || bytes.length !== expectedBytes)
    throw new Error('VSK1 header or byte length is invalid');
  const records = bytes.subarray(VSK1_HEADER_BYTES);
  const expectedId = createHash('sha256').update(records).digest().subarray(0, 8);
  if (!bytes.subarray(16, 24).equals(expectedId)) throw new Error('VSK1 skeleton ID does not match its records');
  const semanticCounts = new Uint8Array(17);
  for (let index = 0; index < boneCount; index++) {
    const offset = VSK1_HEADER_BYTES + index * boneBytes;
    const parent = bytes.readInt16LE(offset);
    const semantic = bytes.readUInt16LE(offset + 2);
    if (parent < -1 || parent >= index) throw new Error(`VSK1 bone ${index} has invalid parent ${parent}`);
    if (semantic !== 0xffff) {
      if (semantic >= semanticCounts.length) throw new Error(`VSK1 bone ${index} has invalid semantic ${semantic}`);
      semanticCounts[semantic]++;
    }
  }
  if ([...semanticCounts].some((count) => count !== 1))
    throw new Error('VSK1 canonical semantic mapping is incomplete or duplicated');
  return {
    magic,
    version,
    boneCount,
    boneBytes,
    expectedBytes,
    skeletonId: bytes.subarray(16, 24).toString('hex'),
  };
}

export function encodeVpm3(mesh, skeletonId) {
  assertInteger(mesh.vertices.length, 'vertexCount', 1, MAX_VERTICES);
  assertInteger(mesh.indices.length, 'indexCount', 3, MAX_INDICES);
  if (mesh.indices.length % 3 !== 0) throw new Error('VPM3 indexCount must be divisible by three');
  if (!Buffer.isBuffer(skeletonId)) skeletonId = Buffer.from(skeletonId);
  if (skeletonId.length !== 8) throw new Error('VPM3 skeleton ID must contain eight bytes');
  const bytes = Buffer.alloc(
    VPM3_HEADER_BYTES + mesh.vertices.length * VPM3_VERTEX_BYTES + mesh.indices.length * VPM3_INDEX_BYTES,
  );
  bytes.write(VPM3_MAGIC, 0, 4, 'ascii');
  bytes.writeUInt16LE(VPM3_VERSION, 4);
  bytes.writeUInt16LE(V3_BONE_COUNT, 6);
  bytes.writeUInt32LE(mesh.vertices.length, 8);
  bytes.writeUInt32LE(mesh.indices.length, 12);
  bytes.writeUInt16LE(VPM3_VERTEX_BYTES, 16);
  bytes.writeUInt8(VPM3_INFLUENCES, 18);
  bytes.writeUInt8(VPM3_INDEX_BYTES, 19);
  skeletonId.copy(bytes, 20);
  bytes.writeUInt32LE(0, 28);
  let offset = VPM3_HEADER_BYTES;
  for (const vertex of mesh.vertices) {
    for (const [label, vector, size] of [
      ['position', vertex.position, 3],
      ['normal', vertex.normal, 3],
      ['tangent', vertex.tangent, 4],
      ['bindPos', vertex.bindPos, 3],
      ['uv', vertex.uv, 2],
    ]) {
      assertFiniteVector(vector, `VPM3 ${label}`, size);
      offset = writeFloatVector(bytes, offset, vector);
    }
    assertInteger(vertex.region, 'region', 0, 0xff);
    if (!Array.isArray(vertex.bones) || vertex.bones.length !== VPM3_INFLUENCES ||
        !Array.isArray(vertex.weights) || vertex.weights.length !== VPM3_INFLUENCES)
      throw new Error('VPM3 vertex must contain four bone indices and weights');
    bytes.writeUInt8(vertex.region, offset++);
    for (const bone of vertex.bones) {
      assertInteger(bone, 'bone', 0, V3_BONE_COUNT - 1);
      bytes.writeUInt8(bone, offset++);
    }
    if (vertex.weights.reduce((sum, weight) => sum + weight, 0) !== 255)
      throw new Error('VPM3 quantized skin weights must sum to 255');
    for (const weight of vertex.weights) {
      assertInteger(weight, 'weight', 0, 0xff);
      bytes.writeUInt8(weight, offset++);
    }
    bytes.fill(0, offset, offset + 3);
    offset += 3;
  }
  for (const index of mesh.indices) {
    assertInteger(index, 'index', 0, mesh.vertices.length - 1);
    bytes.writeUInt16LE(index, offset);
    offset += 2;
  }
  if (offset !== bytes.length) throw new Error(`VPM3 writer stopped at ${offset}, expected ${bytes.length}`);
  return bytes;
}

export function parseVpm3Header(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length < VPM3_HEADER_BYTES) throw new Error('VPM3 payload is shorter than its header');
  const value = {
    magic: bytes.toString('ascii', 0, 4),
    version: bytes.readUInt16LE(4),
    boneCount: bytes.readUInt16LE(6),
    vertexCount: bytes.readUInt32LE(8),
    indexCount: bytes.readUInt32LE(12),
    vertexBytes: bytes.readUInt16LE(16),
    influences: bytes.readUInt8(18),
    indexBytes: bytes.readUInt8(19),
    skeletonId: bytes.subarray(20, 28).toString('hex'),
  };
  const expectedBytes = VPM3_HEADER_BYTES +
    value.vertexCount * value.vertexBytes + value.indexCount * value.indexBytes;
  if (value.magic !== VPM3_MAGIC || value.version !== VPM3_VERSION ||
      value.boneCount !== V3_BONE_COUNT || value.vertexBytes !== VPM3_VERTEX_BYTES ||
      value.influences !== VPM3_INFLUENCES || value.indexBytes !== VPM3_INDEX_BYTES ||
      value.vertexCount < 1 || value.vertexCount > MAX_VERTICES ||
      value.indexCount < 3 || value.indexCount > MAX_INDICES || value.indexCount % 3 !== 0 ||
      bytes.length !== expectedBytes)
    throw new Error('VPM3 header or byte length is invalid');
  return { ...value, expectedBytes };
}

async function readPinnedSources(sourceDir) {
  const result = {};
  for (const [kind, descriptor] of Object.entries(V3_PINNED_SOURCES)) {
    const path = join(sourceDir, descriptor.localName);
    const bytes = await readFile(path);
    const digest = sha256(bytes);
    if (digest !== descriptor.sha256)
      throw new Error(`${descriptor.localName} SHA-256 ${digest} does not match pinned ${descriptor.sha256}`);
    result[kind] = { ...descriptor, path, bytes };
  }
  return result;
}

async function writeIfChanged(path, bytes) {
  let current = null;
  try {
    current = await readFile(path);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (current == null || !current.equals(bytes)) await writeFile(path, bytes);
}

function buildBoundedLowMesh(high, maximumTriangles) {
  let lastError = null;
  for (let target = maximumTriangles; target >= Math.max(4, maximumTriangles - 200); target -= 10) {
    try {
      return buildLowMesh(high, target);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`No closed VPM3 LOD at or below ${maximumTriangles} triangles: ${lastError?.message}`);
}

export async function exportProductionCharacterV3({
  sourceDir = DEFAULT_V3_SOURCE_DIR,
  outputDir = DEFAULT_V3_OUTPUT_DIR,
} = {}) {
  const sources = await readPinnedSources(sourceDir);
  const obj = parseObj(sources.mesh.bytes.toString('utf8'), { includeGroup: 'body' });
  const skeleton = JSON.parse(sources.skeleton.bytes.toString('utf8'));
  const weights = JSON.parse(sources.weights.bytes.toString('utf8'));
  const coordinateTransform = makeCoordinateTransform(obj);
  const bones = buildV3Skeleton(skeleton, obj.positions, coordinateTransform);
  const skeletonBytes = encodeVsk1(bones);
  const skeletonHeader = parseVsk1(skeletonBytes);
  const skeletonId = skeletonBytes.subarray(16, 24);

  const high = buildV3HighMesh(obj, skeleton, weights, coordinateTransform);
  high.topology = meshTopologyFacts(high);
  high.uv = meshUvFacts(high);
  if (high.indices.length / 3 > LOD_TRIANGLE_LIMITS[0])
    throw new Error(`VPM3 LOD0 exceeds ${LOD_TRIANGLE_LIMITS[0]} triangles`);
  await MeshoptSimplifier.ready;
  const meshes = [
    high,
    buildBoundedLowMesh(high, LOD_TRIANGLE_LIMITS[1]),
  ];
  for (const mesh of meshes) {
    const tangents = computeTangents(mesh.vertices, mesh.indices);
    for (let index = 0; index < mesh.vertices.length; index++) mesh.vertices[index].tangent = tangents[index];
  }

  await mkdir(outputDir, { recursive: true });
  const skeletonPath = join(outputDir, 'hero-skeleton.bytes');
  await writeIfChanged(skeletonPath, skeletonBytes);
  const outputs = [];
  for (let lod = 0; lod < meshes.length; lod++) {
    const bytes = encodeVpm3(meshes[lod], skeletonId);
    const header = parseVpm3Header(bytes);
    if (header.skeletonId !== skeletonHeader.skeletonId)
      throw new Error(`VPM3 LOD${lod} skeleton ID does not match VSK1`);
    const path = join(outputDir, `hero-lod${lod}.bytes`);
    await writeIfChanged(path, bytes);
    outputs.push({
      path,
      lod,
      bytes: bytes.length,
      sha256: sha256(bytes),
      vertexCount: header.vertexCount,
      indexCount: header.indexCount,
      triangleCount: header.indexCount / 3,
    });
  }
  return {
    status: 'TECHNICAL FOUNDATION ONLY / NOT PLAYER-FACING ACCEPTED',
    sourceDir,
    outputDir,
    skeleton: {
      path: skeletonPath,
      bytes: skeletonBytes.length,
      sha256: sha256(skeletonBytes),
      ...skeletonHeader,
    },
    meshes: outputs,
    totalBytes: skeletonBytes.length + outputs.reduce((sum, output) => sum + output.bytes, 0),
    androidInstalledSizeDelta: 'UNPROVEN',
    indiaWeightedReach: 'UNPROVEN',
  };
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  const sourceDir = process.argv[2] ?? DEFAULT_V3_SOURCE_DIR;
  const outputDir = process.argv[3] ?? DEFAULT_V3_OUTPUT_DIR;
  exportProductionCharacterV3({ sourceDir, outputDir })
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
