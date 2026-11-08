#!/usr/bin/env node
/**
 * Deterministically derives a VANDE-owned, anatomy-only Unity character mesh
 * from the pinned MakeHuman v1.3.0 CC0 base mesh and weights.
 *
 * This tool intentionally contains no MakeHuman application code. It reads
 * graphical assets released under CC0, collapses their weights onto VANDE's
 * existing 17-joint presentation skeleton, poses the neutral source into the
 * VANDE rest pose, applies a small symmetric fictional-athlete proportion
 * treatment, and writes the UV-bearing VPM2 binary format. The Unity decoder
 * remains backward compatible with the retained VPM1 candidates.
 *
 * The result is a technical anatomy candidate whose current player-facing
 * presentation was independently rejected for visual rework. It is not player,
 * physical-device, installed-size, identity, or final-art acceptance evidence.
 */
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), '..');
const DEFAULT_SOURCE_DIR = '/private/tmp/vande-production-art-source';
const OUTPUT_DIR = join(
  REPO_ROOT,
  'unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters',
);
const MANIFEST_PATH = join(
  REPO_ROOT,
  'docs/licenses/makehuman-v1.3.0/production-human-provenance.json',
);
const SKIN_OUTPUT_PATH = join(OUTPUT_DIR, 'human-skin-albedo-1024.png');
const SOURCE_ACQUIRED_AT_UTC = '2026-10-30T05:23:42Z';
const DERIVATIVE_CREATED_AT_UTC = '2026-10-30T05:29:46Z';
const SKIN_SOURCE_ACQUIRED_AT_UTC = '2026-10-30T09:26:27Z';
const SKIN_DERIVATIVE_CREATED_AT_UTC = '2026-10-30T09:28:42Z';
const REVIEW_STATUS_RECORDED_AT_UTC = '2026-10-30T06:16:11Z';
const BAKE_RUNTIME_BASELINE = Object.freeze({
  node: 'v26.0.0',
  v8: '14.6.202.33-node.19',
  platform: 'darwin',
  architecture: 'arm64',
});
const LOCAL_TOOLCHAIN_PATHS = Object.freeze([
  'scripts/export-unity-production-human.mjs',
  'package.json',
  'package-lock.json',
  'node_modules/meshoptimizer/package.json',
  'node_modules/meshoptimizer/meshopt_simplifier.js',
  'node_modules/meshoptimizer/LICENSE.md',
  'docs/licenses/meshoptimizer-1.1.1/LICENSE.md',
]);

export const UPSTREAM = Object.freeze({
  repository: 'https://github.com/makehumancommunity/makehuman',
  tag: 'v1.3.0',
  commit: '1f508f6083b2f823dab15de924b3bde72e08d77c',
  license: 'CC0-1.0',
  sourceFiles: Object.freeze({
    mesh: Object.freeze({
      localName: 'makehuman-base.obj',
      upstreamPath: 'makehuman/data/3dobjs/base.obj',
      sha256: '8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c',
    }),
    skeleton: Object.freeze({
      localName: 'default.mhskel',
      upstreamPath: 'makehuman/data/rigs/default.mhskel',
      sha256: '99f179bce0aa850b45d4191a1d0d234c5851f881c057439470ded3bddf729a24',
    }),
    weights: Object.freeze({
      localName: 'default_weights.mhw',
      upstreamPath: 'makehuman/data/rigs/default_weights.mhw',
      sha256: '0f3641d651ae3d00ad6b4ccee43142edb109d3bd909d27d9e4139ef1beed8625',
    }),
    licenseSummary: Object.freeze({
      localName: 'LICENSE.md',
      upstreamPath: 'LICENSE.md',
      sha256: 'edd99571ca62698f78c943fd4fffb159a413c315fa0d4819d3cec5cadaf8b4f1',
    }),
    licenseAssets: Object.freeze({
      localName: 'LICENSE.ASSETS.md',
      upstreamPath: 'LICENSE.ASSETS.md',
      sha256: 'f6089cba01cb570a24712b41ab8a586ccd3cc5ef53dc266ca50b95c288956d2c',
    }),
    skin: Object.freeze({
      localName: 'skin-source/young_lightskinned_male_diffuse.png',
      upstreamPath: 'skins/young_caucasian_male/young_lightskinned_male_diffuse.png',
      sha256: '862a26e335e958b70534cb5f0d7c47ef30ab148a56c42b3e9da969cf76f12963',
      sourceUrl: 'https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip',
      officialIndexUrl: 'https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html',
      officialIndexRepository: 'https://github.com/makehumancommunity/makehuman-static-website',
      officialIndexCommit: '09ec378f9aff822a1c95d55bac19e6367ff92e12',
      officialIndexPath: 'content/Assets/AssetPacks/makehuman_system_assets.md',
      officialIndexSha256: 'eb034452e780c06ef4ed042d4408ee34f43add9984c1803e69025ef6432316dd',
      archiveSha256: 'b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107',
      archiveBytes: 280_737_770,
      archiveLastModifiedUtc: '2024-04-14T13:28:46Z',
    }),
  }),
});

export const PRODUCTION_HEADER_BYTES = 16;
export const PRODUCTION_VERTEX_BYTES = 52;
export const PRODUCTION_FORMAT_VERSION = 2;
const PRODUCTION_MAGIC = 'VPM2';
const MAX_PRODUCTION_VERTICES = 0xffff;
const SKIN_DERIVATIVE = Object.freeze({
  sourceLocalName: UPSTREAM.sourceFiles.skin.localName,
  localName: 'skin-source/vande-generic-male-skin-albedo-1024.png',
  outputPath: SKIN_OUTPUT_PATH,
  width: 1024,
  height: 1024,
  bytes: 1_065_858,
  sha256: 'a7700f7a538fa723647296416b77713aefda9e6ad3ba037f30bf4c9eab6ad0d0',
  tool: 'ffmpeg 9.0.1 (Apple clang 17.0.0)',
  command: 'ffmpeg -hide_banner -loglevel error -i <source> -vf scale=1024:1024:flags=lanczos -frames:v 1 -compression_level 9 -pred mixed -update 1 <output>',
});

export const JOINT = Object.freeze({
  Hips: 0,
  Spine: 1,
  Chest: 2,
  Neck: 3,
  Head: 4,
  UpperArmLeft: 5,
  ForearmLeft: 6,
  HandLeft: 7,
  UpperArmRight: 8,
  ForearmRight: 9,
  HandRight: 10,
  ThighLeft: 11,
  ShinLeft: 12,
  FootLeft: 13,
  ThighRight: 14,
  ShinRight: 15,
  FootRight: 16,
});

const JOINT_COUNT = 17;
const TARGET_HEIGHT_METRES = 1.78;
const MAX_HIGH_TRIANGLES = 40_000;
const MAX_LOW_TRIANGLES = 4_000;
const MAX_PREMIUM_FAR_TRIANGLES = 2_000;
const MAX_BALANCED_FAR_TRIANGLES = 1_200;
const MAX_RELATIVE_SIMPLIFICATION_ERROR = 0.05;
const UV_ATTRIBUTE_ERROR_WEIGHT = 10;
const MAX_UV_EDGE_LENGTH = 0.25;

/** Exact, symmetric VANDE-authored parameters. No real person or image was referenced. */
export const FICTIONAL_IDENTITY = Object.freeze({
  id: 'vande-fictional-athlete-a-001',
  sourceReference: 'none',
  symmetry: 'bilateral',
  shoulderWidthScale: 1.045,
  waistWidthScale: 0.975,
  calfWidthScale: 1.018,
  jawWidthScale: 1.022,
  chinWidthScale: 0.992,
  cheekWidthScale: 1.012,
  cheekDepthScale: 1.015,
  browDepthScale: 1.012,
});

const TARGET_ANCHORS = Object.freeze([
  [0, 0.96, 0],
  [0, 1.07, 0],
  [0, 1.28, 0],
  [0, 1.515, 0],
  [0, 1.60, 0.012],
  [0.205, 1.46, -0.012],
  [0.205, 1.175, -0.012],
  [0.205, 0.925, -0.012],
  [-0.205, 1.46, -0.012],
  [-0.205, 1.175, -0.012],
  [-0.205, 0.925, -0.012],
  [0.095, 0.905, 0],
  [0.095, 0.475, 0],
  [0.095, 0.060, 0],
  [-0.095, 0.905, 0],
  [-0.095, 0.475, 0],
  [-0.095, 0.060, 0],
]);

const SOURCE_ANCHOR_BONES = Object.freeze([
  'spine05', 'spine03', 'spine01', 'neck01', 'head',
  'upperarm01.L', 'lowerarm01.L', 'wrist.L',
  'upperarm01.R', 'lowerarm01.R', 'wrist.R',
  'upperleg01.L', 'lowerleg01.L', 'foot.L',
  'upperleg01.R', 'lowerleg01.R', 'foot.R',
]);

const NEXT_JOINT = Object.freeze([
  JOINT.Spine, JOINT.Chest, JOINT.Neck, JOINT.Head, JOINT.Head,
  JOINT.ForearmLeft, JOINT.HandLeft, JOINT.HandLeft,
  JOINT.ForearmRight, JOINT.HandRight, JOINT.HandRight,
  JOINT.ShinLeft, JOINT.FootLeft, JOINT.FootLeft,
  JOINT.ShinRight, JOINT.FootRight, JOINT.FootRight,
]);

const TERMINAL_PREVIOUS = Object.freeze({
  [JOINT.Head]: JOINT.Neck,
  [JOINT.HandLeft]: JOINT.ForearmLeft,
  [JOINT.HandRight]: JOINT.ForearmRight,
  [JOINT.FootLeft]: JOINT.ShinLeft,
  [JOINT.FootRight]: JOINT.ShinRight,
});

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const posixRelative = (path) => relative(REPO_ROOT, path).split(sep).join('/');

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, scalar) => [a[0] * scalar, a[1] * scalar, a[2] * scalar];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a) => Math.hypot(a[0], a[1], a[2]);
const normalize = (a) => {
  const value = length(a);
  if (!Number.isFinite(value) || value < 1e-9) throw new Error('Cannot normalize a zero/non-finite vector');
  return mul(a, 1 / value);
};

function smoothstep(a, b, value) {
  const amount = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return amount * amount * (3 - 2 * amount);
}

function basis(direction) {
  const primary = normalize(direction);
  let forward = sub([0, 0, 1], mul(primary, dot([0, 0, 1], primary)));
  if (length(forward) < 1e-5) forward = sub([0, 1, 0], mul(primary, dot([0, 1, 0], primary)));
  forward = normalize(forward);
  const side = normalize(cross(primary, forward));
  return { side, primary, forward };
}

function applyBasisMap(value, sourceBasis, targetBasis, alongScale = 1) {
  return add(
    add(mul(targetBasis.side, dot(value, sourceBasis.side)),
      mul(targetBasis.primary, dot(value, sourceBasis.primary) * alongScale)),
    mul(targetBasis.forward, dot(value, sourceBasis.forward)),
  );
}

export function parseObj(text, { includeGroup = null } = {}) {
  const positions = [];
  const texcoords = [];
  const triangles = [];
  const triangleTexcoords = [];
  const faceCountsByGroup = new Map();
  let groups = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'v') {
      if (parts.length < 4) throw new Error('OBJ vertex is incomplete');
      const value = parts.slice(1, 4).map(Number);
      if (!value.every(Number.isFinite)) throw new Error('OBJ vertex is non-finite');
      positions.push(value);
    } else if (parts[0] === 'vt') {
      if (parts.length < 3) throw new Error('OBJ texture coordinate is incomplete');
      const value = parts.slice(1, 3).map(Number);
      if (!value.every(Number.isFinite)) throw new Error('OBJ texture coordinate is non-finite');
      texcoords.push(value);
    } else if (parts[0] === 'g') {
      groups = parts.slice(1);
    } else if (parts[0] === 'f') {
      const face = parts.slice(1).map((token) => {
        const fields = token.split('/');
        const rawPosition = Number(fields[0]);
        if (!Number.isInteger(rawPosition) || rawPosition === 0)
          throw new Error(`Invalid OBJ face token ${token}`);
        const position = rawPosition > 0 ? rawPosition - 1 : positions.length + rawPosition;
        let texcoord = null;
        if (fields.length > 1 && fields[1] !== '') {
          const rawTexcoord = Number(fields[1]);
          if (!Number.isInteger(rawTexcoord) || rawTexcoord === 0)
            throw new Error(`Invalid OBJ texture coordinate in ${token}`);
          texcoord = rawTexcoord > 0 ? rawTexcoord - 1 : texcoords.length + rawTexcoord;
        }
        return { position, texcoord };
      });
      if (face.length < 3) throw new Error('OBJ face has fewer than three vertices');
      const groupNames = groups.length === 0 ? ['<ungrouped>'] : groups;
      for (const group of groupNames)
        faceCountsByGroup.set(group, (faceCountsByGroup.get(group) ?? 0) + face.length - 2);
      if (includeGroup != null && !groups.includes(includeGroup)) continue;
      for (let corner = 1; corner + 1 < face.length; corner++) {
        // OBJ and Unity use opposite front-face conventions after retaining +Z.
        const ordered = [face[0], face[corner + 1], face[corner]];
        for (const entry of ordered) {
          triangles.push(entry.position);
          triangleTexcoords.push(entry.texcoord);
        }
      }
    }
  }
  if (positions.length === 0 || triangles.length === 0) throw new Error('OBJ contains no renderable mesh');
  for (const index of triangles) {
    if (index < 0 || index >= positions.length) throw new Error(`OBJ index ${index} is out of range`);
  }
  for (const index of triangleTexcoords) {
    if (index != null && (index < 0 || index >= texcoords.length))
      throw new Error(`OBJ texture coordinate ${index} is out of range`);
  }
  return {
    positions,
    texcoords,
    triangles,
    triangleTexcoords,
    includeGroup,
    faceCountsByGroup: Object.fromEntries([...faceCountsByGroup.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

function jointCentroid(skeleton, positions, boneName) {
  const bone = skeleton.bones[boneName];
  if (!bone) throw new Error(`MakeHuman skeleton is missing ${boneName}`);
  const indices = skeleton.joints[bone.head];
  if (!Array.isArray(indices) || indices.length === 0) throw new Error(`MakeHuman joint ${bone.head} is empty`);
  let total = [0, 0, 0];
  for (const index of indices) {
    if (!positions[index]) throw new Error(`MakeHuman joint ${bone.head} references vertex ${index}`);
    total = add(total, positions[index]);
  }
  return mul(total, 1 / indices.length);
}

function directJointForBone(name) {
  switch (name) {
    case 'root':
    case 'pelvis.L':
    case 'pelvis.R':
    case 'spine05': return JOINT.Hips;
    case 'spine04':
    case 'spine03': return JOINT.Spine;
    case 'spine02':
    case 'spine01': return JOINT.Chest;
    case 'neck01':
    case 'neck02':
    case 'neck03': return JOINT.Neck;
    case 'head': return JOINT.Head;
    case 'upperarm01.L':
    case 'upperarm02.L': return JOINT.UpperArmLeft;
    case 'lowerarm01.L':
    case 'lowerarm02.L': return JOINT.ForearmLeft;
    case 'wrist.L': return JOINT.HandLeft;
    case 'upperarm01.R':
    case 'upperarm02.R': return JOINT.UpperArmRight;
    case 'lowerarm01.R':
    case 'lowerarm02.R': return JOINT.ForearmRight;
    case 'wrist.R': return JOINT.HandRight;
    case 'upperleg01.L':
    case 'upperleg02.L': return JOINT.ThighLeft;
    case 'lowerleg01.L':
    case 'lowerleg02.L': return JOINT.ShinLeft;
    case 'foot.L': return JOINT.FootLeft;
    case 'upperleg01.R':
    case 'upperleg02.R': return JOINT.ThighRight;
    case 'lowerleg01.R':
    case 'lowerleg02.R': return JOINT.ShinRight;
    case 'foot.R': return JOINT.FootRight;
    default: return null;
  }
}

export function makeBoneJointResolver(skeleton) {
  const cache = new Map();
  const resolving = new Set();
  const resolveBone = (name) => {
    if (cache.has(name)) return cache.get(name);
    if (resolving.has(name)) throw new Error(`Cycle in MakeHuman skeleton at ${name}`);
    const bone = skeleton.bones[name];
    if (!bone) throw new Error(`MakeHuman weights reference undeclared bone ${name}`);
    resolving.add(name);
    const direct = directJointForBone(name);
    const joint = direct ?? (bone.parent == null ? null : resolveBone(bone.parent));
    resolving.delete(name);
    if (joint == null) throw new Error(`MakeHuman bone ${name} cannot map to VANDE's skeleton`);
    cache.set(name, joint);
    return joint;
  };
  return resolveBone;
}

function collapsedWeights(sourceWeights, skeleton, vertexCount) {
  const maps = Array.from({ length: vertexCount }, () => new Map());
  const resolveBone = makeBoneJointResolver(skeleton);
  for (const [boneName, entries] of Object.entries(sourceWeights.weights)) {
    const joint = resolveBone(boneName);
    for (const [index, weight] of entries) {
      if (!Number.isInteger(index) || index < 0 || index >= vertexCount)
        throw new Error(`Weight for ${boneName} references vertex ${index}`);
      if (!Number.isFinite(weight) || weight < 0) throw new Error(`Invalid weight for ${boneName}/${index}`);
      maps[index].set(joint, (maps[index].get(joint) ?? 0) + weight);
    }
  }
  return maps.map((map, index) => {
    const entries = [...map.entries()].filter(([, weight]) => weight > 1e-7);
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    if (total <= 0) throw new Error(`MakeHuman vertex ${index} has no mapped skin weight`);
    return entries.map(([joint, weight]) => [joint, weight / total]);
  });
}

function sourceTransforms(skeleton, positions, scale) {
  const anchors = SOURCE_ANCHOR_BONES.map((name) => jointCentroid(skeleton, positions, name));
  return anchors.map((anchor, joint) => {
    const previous = TERMINAL_PREVIOUS[joint];
    const sourceNext = previous == null ? NEXT_JOINT[joint] : joint;
    const sourceStart = previous == null ? joint : previous;
    const targetNext = previous == null ? NEXT_JOINT[joint] : joint;
    const targetStart = previous == null ? joint : previous;
    const sourceDirection = sub(anchors[sourceNext], anchors[sourceStart]);
    const targetDirection = sub(TARGET_ANCHORS[targetNext], TARGET_ANCHORS[targetStart]);
    const sourceLength = length(sourceDirection) * scale;
    const targetLength = length(targetDirection);
    const terminal = previous != null;
    return {
      sourceAnchor: mul(anchor, scale),
      targetAnchor: TARGET_ANCHORS[joint],
      sourceBasis: basis(sourceDirection),
      targetBasis: basis(targetDirection),
      alongScale: terminal ? 1 : targetLength / sourceLength,
    };
  });
}

function transformByJoint(position, transform, scale) {
  const source = mul(position, scale);
  const local = sub(source, transform.sourceAnchor);
  return add(transform.targetAnchor,
    applyBasisMap(local, transform.sourceBasis, transform.targetBasis, transform.alongScale));
}

export function applyFictionalIdentity(position) {
  let [x, y, z] = position;
  const shoulder = smoothstep(1.18, 1.32, y) * (1 - smoothstep(1.48, 1.58, y));
  const waist = smoothstep(0.88, 0.99, y) * (1 - smoothstep(1.14, 1.25, y));
  const calf = smoothstep(0.10, 0.20, y) * (1 - smoothstep(0.43, 0.53, y));
  x *= 1 + shoulder * (FICTIONAL_IDENTITY.shoulderWidthScale - 1) +
       waist * (FICTIONAL_IDENTITY.waistWidthScale - 1) +
       calf * (FICTIONAL_IDENTITY.calfWidthScale - 1);

  const jaw = smoothstep(1.565, 1.605, y) * (1 - smoothstep(1.655, 1.69, y));
  const chin = smoothstep(1.525, 1.55, y) * (1 - smoothstep(1.59, 1.62, y));
  const cheek = smoothstep(1.63, 1.655, y) * (1 - smoothstep(1.705, 1.73, y));
  const brow = smoothstep(1.69, 1.71, y) * (1 - smoothstep(1.755, 1.78, y));
  x *= 1 + jaw * (FICTIONAL_IDENTITY.jawWidthScale - 1) +
       chin * (FICTIONAL_IDENTITY.chinWidthScale - 1) +
       cheek * (FICTIONAL_IDENTITY.cheekWidthScale - 1);
  const headCentreZ = TARGET_ANCHORS[JOINT.Head][2];
  z = headCentreZ + (z - headCentreZ) *
    (1 + cheek * (FICTIONAL_IDENTITY.cheekDepthScale - 1) +
         brow * (FICTIONAL_IDENTITY.browDepthScale - 1));
  return [x, y, z];
}

function topTwoWeights(entries) {
  const sorted = [...entries].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 2);
  const total = sorted.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) throw new Error('Vertex has no positive skin weights');
  const first = sorted[0];
  const second = sorted[1] ?? [0, 0];
  const weight0 = Math.max(0, Math.min(0xffff, Math.round((first[1] / total) * 0xffff)));
  return { bone0: first[0], bone1: second[0], weight0, weight1: 0xffff - weight0 };
}

function regionForWeights(entries) {
  const dominant = [...entries].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  if (dominant === JOINT.Head || dominant === JOINT.Neck ||
      dominant === JOINT.ForearmLeft || dominant === JOINT.HandLeft ||
      dominant === JOINT.ForearmRight || dominant === JOINT.HandRight) return 0; // skin
  if (dominant === JOINT.FootLeft || dominant === JOINT.FootRight) return 3; // shoes
  if (dominant === JOINT.Hips || dominant === JOINT.ThighLeft || dominant === JOINT.ShinLeft ||
      dominant === JOINT.ThighRight || dominant === JOINT.ShinRight) return 2; // trousers
  return 1; // shirt
}

function computeNormals(vertices, indices) {
  // UV seams duplicate render vertices, not anatomy. Accumulate by the pinned
  // source-position identity so the diffuse seam does not create a hard normal
  // seam in Unity.
  const normalBySource = new Map();
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = vertices[indices[offset]].position;
    const b = vertices[indices[offset + 1]].position;
    const c = vertices[indices[offset + 2]].position;
    const face = cross(sub(b, a), sub(c, a));
    if (length(face) < 1e-12) continue;
    for (let corner = 0; corner < 3; corner++) {
      const index = indices[offset + corner];
      const source = vertices[index].sourcePositionIndex ?? index;
      normalBySource.set(source, add(normalBySource.get(source) ?? [0, 0, 0], face));
    }
  }
  return vertices.map((vertex, index) => {
    const normal = normalBySource.get(vertex.sourcePositionIndex ?? index) ?? [0, 0, 0];
    return length(normal) < 1e-9 ? [0, 1, 0] : normalize(normal);
  });
}

export function buildHighMesh(obj, skeleton, weights) {
  if (skeleton.license !== 'CC0' || weights.license !== 'CC0')
    throw new Error('Pinned MakeHuman skeleton/weights must declare CC0');
  // Only vertices referenced by the admitted `body` face group enter the derivative. The source contains joint and
  // helper geometry after that group; retaining unreferenced source vertices would still leak those helpers into the
  // shipped binary even though Unity never draws them.
  if (obj.triangleTexcoords.length !== obj.triangles.length ||
      obj.triangleTexcoords.some((index) => index == null))
    throw new Error('Pinned MakeHuman body faces must provide a UV for every admitted corner');
  const referenced = [];
  const remap = new Map();
  const indices = obj.triangles.map((sourcePositionIndex, corner) => {
    const sourceTexcoordIndex = obj.triangleTexcoords[corner];
    const seamKey = `${sourcePositionIndex}/${sourceTexcoordIndex}`;
    let mapped = remap.get(seamKey);
    if (mapped == null) {
      mapped = referenced.length;
      remap.set(seamKey, mapped);
      referenced.push({ sourcePositionIndex, sourceTexcoordIndex });
    }
    return mapped;
  });
  const admittedSourcePositions = [...new Set(referenced.map(({ sourcePositionIndex }) => sourcePositionIndex))];
  const admittedPositions = admittedSourcePositions.map((sourceIndex) => obj.positions[sourceIndex]);
  const sourceMinY = Math.min(...admittedPositions.map((position) => position[1]));
  const sourceMaxY = Math.max(...admittedPositions.map((position) => position[1]));
  const scale = TARGET_HEIGHT_METRES / (sourceMaxY - sourceMinY);
  const perVertexWeights = collapsedWeights(weights, skeleton, obj.positions.length);
  const transforms = sourceTransforms(skeleton, obj.positions, scale);
  const vertices = referenced.map(({ sourcePositionIndex, sourceTexcoordIndex }) => {
    const position = obj.positions[sourcePositionIndex];
    const index = sourcePositionIndex;
    const entries = perVertexWeights[index];
    let posed = [0, 0, 0];
    for (const [joint, weight] of entries)
      posed = add(posed, mul(transformByJoint(position, transforms[joint], scale), weight));
    posed = applyFictionalIdentity(posed);
    const skin = topTwoWeights(entries);
    return {
      position: posed,
      normal: [0, 1, 0],
      bindPos: [...posed],
      uv: [...obj.texcoords[sourceTexcoordIndex]],
      sourcePositionIndex,
      sourceTexcoordIndex,
      region: regionForWeights(entries),
      ...skin,
    };
  });
  const normals = computeNormals(vertices, indices);
  for (let index = 0; index < vertices.length; index++) vertices[index].normal = normals[index];
  return {
    vertices,
    indices,
    sourceVertexCount: obj.positions.length,
    sourceTexcoordCount: obj.texcoords.length,
    admittedSourceVertexCount: admittedSourcePositions.length,
    admittedRenderVertexCount: referenced.length,
  };
}

export function meshTopologyFacts(mesh) {
  const used = new Uint8Array(mesh.vertices.length);
  const edges = new Map();
  const geometricVertices = new Set();
  let degenerateTriangles = 0;
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const triangle = mesh.indices.slice(offset, offset + 3);
    if (triangle.length !== 3 || triangle.some((index) =>
      !Number.isInteger(index) || index < 0 || index >= mesh.vertices.length))
      throw new Error(`Mesh triangle ${offset / 3} has an invalid index`);
    const [a, b, c] = triangle;
    used[a] = 1;
    used[b] = 1;
    used[c] = 1;
    const areaVector = cross(
      sub(mesh.vertices[b].position, mesh.vertices[a].position),
      sub(mesh.vertices[c].position, mesh.vertices[a].position),
    );
    const geometric = [a, b, c].map((index) =>
      mesh.vertices[index].sourcePositionIndex ?? index);
    for (const index of geometric) geometricVertices.add(index);
    if (geometric[0] === geometric[1] || geometric[1] === geometric[2] ||
        geometric[2] === geometric[0] || length(areaVector) <= 1e-10)
      degenerateTriangles++;
    for (const [left, right] of [
      [geometric[0], geometric[1]],
      [geometric[1], geometric[2]],
      [geometric[2], geometric[0]],
    ]) {
      const key = left < right ? `${left}/${right}` : `${right}/${left}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  let maximumEdgeValence = 0;
  for (const valence of edges.values()) {
    if (valence === 1) boundaryEdges++;
    if (valence !== 2) nonManifoldEdges++;
    maximumEdgeValence = Math.max(maximumEdgeValence, valence);
  }
  return {
    vertices: mesh.vertices.length,
    geometricVertices: geometricVertices.size,
    triangles: mesh.indices.length / 3,
    unusedVertices: used.reduce((sum, value) => sum + (value === 0 ? 1 : 0), 0),
    degenerateTriangles,
    undirectedEdges: edges.size,
    boundaryEdges,
    nonManifoldEdges,
    maximumEdgeValence,
  };
}

export function meshUvFacts(mesh) {
  const minimum = [Infinity, Infinity];
  const maximum = [-Infinity, -Infinity];
  let maximumEdgeLength = 0;
  let edgesOverLimit = 0;
  for (const vertex of mesh.vertices) {
    if (!Array.isArray(vertex.uv) || vertex.uv.length !== 2 || !vertex.uv.every(Number.isFinite))
      throw new Error('Mesh contains a missing or non-finite UV');
    for (let axis = 0; axis < 2; axis++) {
      minimum[axis] = Math.min(minimum[axis], vertex.uv[axis]);
      maximum[axis] = Math.max(maximum[axis], vertex.uv[axis]);
    }
  }
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const triangle = mesh.indices.slice(offset, offset + 3);
    for (const [left, right] of [[0, 1], [1, 2], [2, 0]]) {
      const a = mesh.vertices[triangle[left]].uv;
      const b = mesh.vertices[triangle[right]].uv;
      const edge = Math.hypot(a[0] - b[0], a[1] - b[1]);
      maximumEdgeLength = Math.max(maximumEdgeLength, edge);
      if (edge > MAX_UV_EDGE_LENGTH) edgesOverLimit++;
    }
  }
  return {
    minimum,
    maximum,
    maximumEdgeLength,
    maximumAllowedEdgeLength: MAX_UV_EDGE_LENGTH,
    edgesOverLimit,
  };
}

function requireBoundedUvs(mesh, label) {
  const facts = meshUvFacts(mesh);
  if (facts.minimum.some((value) => value < 0) || facts.maximum.some((value) => value > 1) ||
      facts.edgesOverLimit !== 0)
    throw new Error(`${label} violates the bounded UV contract: ${JSON.stringify(facts)}`);
  return facts;
}

function requireClosedManifold(mesh, label) {
  const facts = meshTopologyFacts(mesh);
  if (facts.unusedVertices !== 0 || facts.degenerateTriangles !== 0 ||
      facts.boundaryEdges !== 0 || facts.nonManifoldEdges !== 0 || facts.maximumEdgeValence !== 2) {
    throw new Error(`${label} is not a closed two-manifold: ${JSON.stringify(facts)}`);
  }
  return facts;
}

/** Topology-restricted LOD with an explicit UV error weight and no permissive/prune/regularize flags. */
export function buildLowMesh(high, targetTriangles = MAX_LOW_TRIANGLES) {
  if (!Number.isInteger(targetTriangles) || targetTriangles < 4)
    throw new Error(`Invalid target triangle count ${targetTriangles}`);
  const positions = new Float32Array(high.vertices.length * 3);
  const uvs = new Float32Array(high.vertices.length * 2);
  for (let index = 0; index < high.vertices.length; index++) {
    positions.set(high.vertices[index].position, index * 3);
    uvs.set(high.vertices[index].uv, index * 2);
  }
  // A strong UV weight is required for the 2k/1.2k far tiers: the default
  // geometric-only collapse can join distant atlas islands even when the welded
  // anatomy stays valid. The postconditions below independently bound every
  // surviving UV edge and weld seam duplicates for manifold verification.
  const [simplifiedSourceIndices, relativeError] = MeshoptSimplifier.simplifyWithAttributes(
    new Uint32Array(high.indices),
    positions,
    3,
    uvs,
    2,
    [UV_ATTRIBUTE_ERROR_WEIGHT],
    null,
    targetTriangles * 3,
    MAX_RELATIVE_SIMPLIFICATION_ERROR,
    [],
  );
  if (simplifiedSourceIndices.length % 3 !== 0 || simplifiedSourceIndices.length / 3 > targetTriangles)
    throw new Error(`Topology simplifier missed target ${targetTriangles}: ${simplifiedSourceIndices.length / 3}`);

  const compactIndices = new Uint32Array(simplifiedSourceIndices);
  const [remap, vertexCount] = MeshoptSimplifier.compactMesh(compactIndices);
  if (vertexCount > MAX_PRODUCTION_VERTICES)
    throw new Error(`Simplified mesh has ${vertexCount} seam-split vertices; VPM2 limit is 65,535`);
  const vertices = new Array(vertexCount);
  const missing = 0xffffffff;
  for (let sourceIndex = 0; sourceIndex < remap.length; sourceIndex++) {
    const compactIndex = remap[sourceIndex];
    if (compactIndex === missing) continue;
    const source = high.vertices[sourceIndex];
    vertices[compactIndex] = {
      ...source,
      position: [...source.position],
      normal: [0, 1, 0],
      bindPos: [...source.bindPos],
      uv: [...source.uv],
    };
  }
  if (vertices.some((vertex) => vertex == null))
    throw new Error('Topology simplifier compaction left an unpopulated vertex');
  const indices = Array.from(compactIndices);
  const normals = computeNormals(vertices, indices);
  for (let index = 0; index < vertices.length; index++) vertices[index].normal = normals[index];
  const result = {
    vertices,
    indices,
    simplification: {
      algorithm: 'meshoptimizer-1.1.1 topology-restricted simplifyWithAttributes on seam-split render vertices',
      flags: [],
      attributeWeights: { uv: UV_ATTRIBUTE_ERROR_WEIGHT },
      vertexLock: null,
      targetTriangles,
      achievedTriangles: indices.length / 3,
      maximumRelativeError: MAX_RELATIVE_SIMPLIFICATION_ERROR,
      observedRelativeError: relativeError,
    },
  };
  result.topology = requireClosedManifold(result, `LOD target ${targetTriangles}`);
  result.uv = requireBoundedUvs(result, `LOD target ${targetTriangles}`);
  return result;
}

function assertBoundedInteger(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new Error(`${label} must be an integer in [${minimum}, ${maximum}], got ${value}`);
}

/** UV-bearing production derivative. Retained VANDE assets remain VPM1 and are never rewritten by this baker. */
export function encodeProductionVpm(mesh) {
  assertBoundedInteger(mesh.vertices.length, 'vertexCount', 1, MAX_PRODUCTION_VERTICES);
  assertBoundedInteger(mesh.indices.length, 'indexCount', 3, 0xffffffff);
  if (mesh.indices.length % 3 !== 0) throw new Error('VPM2 indexCount must be divisible by three');
  const bytes = Buffer.alloc(
    PRODUCTION_HEADER_BYTES + mesh.vertices.length * PRODUCTION_VERTEX_BYTES + mesh.indices.length * 2,
  );
  bytes.write(PRODUCTION_MAGIC, 0, 4, 'ascii');
  bytes.writeUInt16LE(PRODUCTION_FORMAT_VERSION, 4);
  bytes.writeUInt16LE(JOINT_COUNT, 6);
  bytes.writeUInt32LE(mesh.vertices.length, 8);
  bytes.writeUInt32LE(mesh.indices.length, 12);
  let offset = PRODUCTION_HEADER_BYTES;
  for (const vertex of mesh.vertices) {
    for (const [label, vector, expected] of [
      ['position', vertex.position, 3],
      ['normal', vertex.normal, 3],
      ['bindPos', vertex.bindPos, 3],
      ['uv', vertex.uv, 2],
    ]) {
      if (!Array.isArray(vector) || vector.length !== expected || !vector.every(Number.isFinite))
        throw new Error(`VPM2 vertex contains an invalid ${label}`);
      for (const value of vector) {
        bytes.writeFloatLE(value, offset);
        offset += 4;
      }
    }
    assertBoundedInteger(vertex.region, 'region', 0, 0xff);
    assertBoundedInteger(vertex.bone0, 'bone0', 0, JOINT_COUNT - 1);
    assertBoundedInteger(vertex.bone1, 'bone1', 0, JOINT_COUNT - 1);
    assertBoundedInteger(vertex.weight0, 'weight0', 0, 0xffff);
    assertBoundedInteger(vertex.weight1, 'weight1', 0, 0xffff);
    if (vertex.weight0 + vertex.weight1 !== 0xffff)
      throw new Error('VPM2 quantized skin weights must sum to 65,535');
    bytes.writeUInt8(vertex.region, offset++);
    bytes.writeUInt8(vertex.bone0, offset++);
    bytes.writeUInt8(vertex.bone1, offset++);
    bytes.writeUInt8(0, offset++);
    bytes.writeUInt16LE(vertex.weight0, offset);
    offset += 2;
    bytes.writeUInt16LE(vertex.weight1, offset);
    offset += 2;
  }
  for (const index of mesh.indices) {
    assertBoundedInteger(index, 'index', 0, mesh.vertices.length - 1);
    bytes.writeUInt16LE(index, offset);
    offset += 2;
  }
  if (offset !== bytes.length) throw new Error(`VPM2 writer stopped at ${offset}, expected ${bytes.length}`);
  return bytes;
}

export function parseProductionVpmHeader(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length < PRODUCTION_HEADER_BYTES) throw new Error('VPM2 payload is shorter than its header');
  const magic = bytes.toString('ascii', 0, 4);
  const version = bytes.readUInt16LE(4);
  const boneCount = bytes.readUInt16LE(6);
  const vertexCount = bytes.readUInt32LE(8);
  const indexCount = bytes.readUInt32LE(12);
  const expectedBytes = PRODUCTION_HEADER_BYTES +
    vertexCount * PRODUCTION_VERTEX_BYTES + indexCount * 2;
  if (magic !== PRODUCTION_MAGIC) throw new Error(`Unexpected VPM2 magic ${JSON.stringify(magic)}`);
  if (version !== PRODUCTION_FORMAT_VERSION) throw new Error(`Unexpected VPM2 version ${version}`);
  if (boneCount !== JOINT_COUNT) throw new Error(`Unexpected VPM2 bone count ${boneCount}`);
  if (vertexCount < 1 || vertexCount > MAX_PRODUCTION_VERTICES)
    throw new Error(`Unexpected VPM2 vertex count ${vertexCount}`);
  if (indexCount < 3 || indexCount % 3 !== 0)
    throw new Error(`Unexpected VPM2 index count ${indexCount}`);
  if (bytes.length !== expectedBytes)
    throw new Error(`VPM2 byte length ${bytes.length} does not match ${expectedBytes}`);
  return {
    magic,
    version,
    boneCount,
    vertexCount,
    indexCount,
    expectedBytes,
    vertexBytes: PRODUCTION_VERTEX_BYTES,
    hasUv: true,
  };
}

function boundsOf(mesh) {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (const { position } of mesh.vertices) {
    for (let axis = 0; axis < 3; axis++) {
      minimum[axis] = Math.min(minimum[axis], position[axis]);
      maximum[axis] = Math.max(maximum[axis], position[axis]);
    }
  }
  return {
    minimum,
    maximum,
    size: maximum.map((value, axis) => value - minimum[axis]),
    centre: maximum.map((value, axis) => (value + minimum[axis]) * 0.5),
  };
}

async function readPinnedSource(sourceDir) {
  const records = {};
  for (const [kind, descriptor] of Object.entries(UPSTREAM.sourceFiles)) {
    const path = join(sourceDir, descriptor.localName);
    const bytes = await readFile(path);
    const digest = sha256(bytes);
    if (digest !== descriptor.sha256)
      throw new Error(`${descriptor.localName} SHA-256 ${digest} does not match pinned ${descriptor.sha256}`);
    records[kind] = { ...descriptor, bytes, path };
  }
  return records;
}

async function writeIfChanged(path, bytes) {
  let previous = null;
  try { previous = await readFile(path); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  if (previous && previous.equals(bytes)) return false;
  await writeFile(path, bytes);
  return true;
}

async function localToolchainRecords() {
  return Promise.all(LOCAL_TOOLCHAIN_PATHS.map(async (path) => {
    const bytes = await readFile(join(REPO_ROOT, path));
    return { path, bytes: bytes.length, sha256: sha256(bytes) };
  }));
}

function assertBakeRuntimeBaseline() {
  const observed = {
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    architecture: process.arch,
  };
  for (const [field, expected] of Object.entries(BAKE_RUNTIME_BASELINE)) {
    if (observed[field] !== expected)
      throw new Error(`Production-human bake runtime ${field}=${observed[field]} does not match declared baseline ${expected}`);
  }
}

export async function exportProductionHuman({ sourceDir = DEFAULT_SOURCE_DIR } = {}) {
  assertBakeRuntimeBaseline();
  const sources = await readPinnedSource(sourceDir);
  const obj = parseObj(sources.mesh.bytes.toString('utf8'), { includeGroup: 'body' });
  const skeleton = JSON.parse(sources.skeleton.bytes.toString('utf8'));
  const weights = JSON.parse(sources.weights.bytes.toString('utf8'));
  const skinDerivativeBytes = await readFile(join(sourceDir, SKIN_DERIVATIVE.localName));
  if (skinDerivativeBytes.length !== SKIN_DERIVATIVE.bytes ||
      sha256(skinDerivativeBytes) !== SKIN_DERIVATIVE.sha256)
    throw new Error('Prepared 1024px skin derivative does not match its checksum-bound transformation record');
  const high = buildHighMesh(obj, skeleton, weights);
  if (high.indices.length / 3 > MAX_HIGH_TRIANGLES)
    throw new Error(`High mesh has ${high.indices.length / 3} triangles, budget ${MAX_HIGH_TRIANGLES}`);
  await MeshoptSimplifier.ready;
  const low = buildLowMesh(high, MAX_LOW_TRIANGLES);
  const premiumFar = buildLowMesh(high, MAX_PREMIUM_FAR_TRIANGLES);
  const balancedFar = buildLowMesh(high, MAX_BALANCED_FAR_TRIANGLES);
  high.topology = requireClosedManifold(high, 'LOD0');
  high.uv = requireBoundedUvs(high, 'LOD0');
  const meshes = [high, low, premiumFar, balancedFar];
  await mkdir(OUTPUT_DIR, { recursive: true });
  const outputs = [];
  for (let lod = 0; lod < meshes.length; lod++) {
    const bytes = encodeProductionVpm(meshes[lod]);
    parseProductionVpmHeader(bytes);
    const path = join(OUTPUT_DIR, `human-lod${lod}.bytes`);
    await writeIfChanged(path, bytes);
    const bounds = boundsOf(meshes[lod]);
    outputs.push({
      path: posixRelative(path),
      lod,
      bytes: bytes.length,
      sha256: sha256(bytes),
      vertexCount: meshes[lod].vertices.length,
      indexCount: meshes[lod].indices.length,
      triangleCount: meshes[lod].indices.length / 3,
      simplification: meshes[lod].simplification ?? null,
      topology: meshes[lod].topology,
      uv: meshes[lod].uv,
      bounds,
    });
  }
  await writeIfChanged(SKIN_OUTPUT_PATH, skinDerivativeBytes);
  const textureOutput = {
    path: posixRelative(SKIN_OUTPUT_PATH),
    bytes: skinDerivativeBytes.length,
    sha256: sha256(skinDerivativeBytes),
    width: SKIN_DERIVATIVE.width,
    height: SKIN_DERIVATIVE.height,
    colourSpace: 'sRGB',
    mipmaps: true,
    sourceAIStatus: 'not AI-generated; exact MakeHuman system-asset derivative',
  };
  const toolchain = await localToolchainRecords();
  const bakeTool = toolchain.find(({ path }) => path === posixRelative(SCRIPT_PATH));
  if (!bakeTool) throw new Error('Production-human bake tool is absent from its toolchain record');

  const manifest = {
    schema: 'vande-production-human-provenance/v1',
    assetId: 'VANDE-HUMAN-ANATOMY-CC0-001',
    status: 'TECHNICAL COMPONENT CANDIDATE / CURRENT PRESENTATION REJECTED',
    purpose: 'Stage 1 Unity anatomy-only presentation candidate for fictional cricket characters',
    generatedAt: 'deterministic-no-wall-clock',
    creationAcquisition: {
      sourceAcquiredAtUtc: SOURCE_ACQUIRED_AT_UTC,
      derivativeCreatedAtUtc: DERIVATIVE_CREATED_AT_UTC,
      skinSourceAcquiredAtUtc: SKIN_SOURCE_ACQUIRED_AT_UTC,
      skinDerivativeCreatedAtUtc: SKIN_DERIVATIVE_CREATED_AT_UTC,
      acquisitionTimestampBasis: 'UTC conversion of the checksum-verified pinned mesh master filesystem timestamp immediately after download; source remains in /private/tmp/vande-production-art-source',
      skinAcquisitionTimestampBasis: 'UTC recorded immediately after the official no-account CC0 archive was checksum-verified and the single selected texture was extracted',
      sourceLocation: '/private/tmp/vande-production-art-source (production scratch; not a shipped runtime path; full system-assets archive removed after verification/extraction and remains recoverable from its recorded URL/hash)',
    },
    rightsOwner: 'MakeHuman asset copyright holders named in the pinned source; derivative treatment by VANDE',
    license: 'CC0-1.0',
    rightsScope: 'CC0 worldwide, perpetual, all-platform commercial use, modification and redistribution as source or in a compiled game; no attribution required',
    attribution: 'none',
    likenessRelease: 'not supplied or claimed; generic fictional-athlete use only, no real-player reference or likeness claim; independent identity review UNPROVEN',
    trademarksEmbeddedWorks: 'the CC0 source atlas contains its own PUBLICDOMAIN MAKEHUMAN.ORG notice in a non-skin UV corner; no team, sponsor or manufacturer mark was added; independent derivative review NOT RUN',
    aiStatus: 'no generative-AI image or real-player image was used; deterministic geometry transforms and Lanczos image resampling only',
    upstream: {
      repository: UPSTREAM.repository,
      tag: UPSTREAM.tag,
      commit: UPSTREAM.commit,
      files: Object.fromEntries(Object.entries(UPSTREAM.sourceFiles).map(([kind, value]) => [kind, {
        path: value.upstreamPath,
        sha256: value.sha256,
        bytes: sources[kind].bytes.length,
        rawUrl: value.sourceUrl ?? `${UPSTREAM.repository}/raw/${UPSTREAM.commit}/${value.upstreamPath}`,
        archiveEntry: value.sourceUrl ? value.upstreamPath : undefined,
      }])),
      systemAssets: {
        relationshipToApplicationTag: 'the pinned v1.3.0 application delegates bundled graphical assets to its official makehuman-assets source; this exact official CC0 pack index commit predates the v1.3.0 release by one month',
        officialIndexUrl: UPSTREAM.sourceFiles.skin.officialIndexUrl,
        officialIndexRepository: UPSTREAM.sourceFiles.skin.officialIndexRepository,
        officialIndexCommit: UPSTREAM.sourceFiles.skin.officialIndexCommit,
        officialIndexPath: UPSTREAM.sourceFiles.skin.officialIndexPath,
        officialIndexSha256: UPSTREAM.sourceFiles.skin.officialIndexSha256,
        archiveUrl: UPSTREAM.sourceFiles.skin.sourceUrl,
        archiveSha256: UPSTREAM.sourceFiles.skin.archiveSha256,
        archiveBytes: UPSTREAM.sourceFiles.skin.archiveBytes,
        archiveLastModifiedUtc: UPSTREAM.sourceFiles.skin.archiveLastModifiedUtc,
        accountOrTermsAcceptance: 'none; direct public URLs',
        repositoryLimitation: 'the historical makehuman-assets Git repository named by the pinned application bootstrap is no longer publicly addressable; archive bytes and official index commit are pinned instead of inventing an asset-repository commit',
      },
      archivedExactTerms: [
        {
          path: 'docs/licenses/makehuman-v1.3.0/LICENSE.md',
          sha256: UPSTREAM.sourceFiles.licenseSummary.sha256,
        },
        {
          path: 'docs/licenses/makehuman-v1.3.0/LICENSE.ASSETS.md',
          sha256: UPSTREAM.sourceFiles.licenseAssets.sha256,
        },
        {
          path: 'docs/licenses/makehuman-v1.3.0/SYSTEM-ASSET-SKIN-SNAPSHOT.md',
          sha256: 'e932cbb0e6222fdea072cd24c4d6576e68d991e8b5819b3a4eadf44252cccfdf',
          appliesTo: 'official CC0 system skin acquisition, exact pack/entry hashes, deterministic downscale and non-claims',
        },
        {
          path: 'docs/licenses/meshoptimizer-1.1.1/LICENSE.md',
          sha256: 'f03037ca7bad1e3eb7f4a63fa6084a8baabd5ba30d3c239a9a7f35705d873e26',
          appliesTo: 'offline LOD simplifier only; not a human-source asset or shipped runtime library',
        },
      ],
      sourceCopyrightNotice: [
        'Copyright (C) 2020 Data Collection AB',
        'Copyright (C) 2020 Joel Palmius',
        'Copyright (C) 2020 Jonas Hauquier',
        '(c) 2021 Data Collection AB, Joel Palmius, Jonas Hauquier',
      ],
      sourceCopyrightNoticesByFile: {
        mesh: [
          'Copyright (C) 2020 Data Collection AB, https://www.datacollection.se',
          'Copyright (C) 2020 Joel Palmius',
          'Copyright (C) 2020 Jonas Hauquier',
        ],
        skeleton: skeleton.copyright,
        weights: weights.copyright,
        skin: 'official MakeHuman system asset; exact index identifies makehuman_system as author/source and CC0 as licence',
      },
    },
    modifications: {
      tool: posixRelative(SCRIPT_PATH),
      toolSha256: bakeTool.sha256,
      toolchain,
      bakeRuntime: {
        ...BAKE_RUNTIME_BASELINE,
        baselinePolicy: 'baker refuses a different runtime until its output is independently compared and the provenance baseline is reviewed',
        sameRuntimeRepeatability: 'PASS — repeated v26.0.0/darwin/arm64 bake was byte-identical',
        crossRuntimePlatformDeterminism: 'UNPROVEN — no second Node runtime, operating system or architecture was tested',
      },
      sourcePose: 'MakeHuman neutral A-pose',
      targetSkeleton: 'VANDE ProductionCharacterJoint 17-joint presentation rig',
      weightPolicy: 'collapse by source hierarchy, normalize, retain strongest two influences',
      restPosePolicy: 'per-joint axial length map plus front-preserving orthonormal basis',
      sourceGeometryPolicy: {
        admittedFaceGroup: 'body',
        excludedPolicy: 'all joint-* and helper-* groups plus every other non-body face group are excluded',
        scaleCalibration: 'vertical span of admitted body referenced vertices only',
        sourceTriangleGroups: obj.faceCountsByGroup,
        admittedSourceTriangles: obj.faceCountsByGroup.body,
        sourcePositionCount: high.sourceVertexCount,
        sourceTexcoordCount: high.sourceTexcoordCount,
        admittedReferencedVertices: high.admittedSourceVertexCount,
        admittedRenderVerticesAfterUvSeams: high.admittedRenderVertexCount,
        uvSeamDuplicateVertices: high.admittedRenderVertexCount - high.admittedSourceVertexCount,
        excludedUnreferencedVertices: high.sourceVertexCount - high.admittedSourceVertexCount,
        excludedSourceTriangles: Object.entries(obj.faceCountsByGroup)
          .filter(([group]) => group !== 'body')
          .reduce((sum, [, count]) => sum + count, 0),
      },
      fictionalIdentity: FICTIONAL_IDENTITY,
      uvPolicy: 'preserve each admitted OBJ position/texture-coordinate corner pair; duplicate render vertices at UV seams while welding source-position identity for normals and topology evidence',
      texturePolicy: 'sample the pinned CC0 1024px albedo only for region 0 (head, neck, forearms and hands); retain VANDE original unbranded procedural kit/trousers/shoes for regions 1–3; missing texture or retained VPM1 UV flag fails closed to procedural skin',
      skinTextureDerivative: {
        sourcePath: UPSTREAM.sourceFiles.skin.upstreamPath,
        sourceSha256: UPSTREAM.sourceFiles.skin.sha256,
        sourceBytes: sources.skin.bytes.length,
        sourceDimensions: [2048, 2048],
        outputPath: textureOutput.path,
        outputSha256: textureOutput.sha256,
        outputBytes: textureOutput.bytes,
        outputDimensions: [textureOutput.width, textureOutput.height],
        tool: SKIN_DERIVATIVE.tool,
        command: SKIN_DERIVATIVE.command,
        modifications: 'Lanczos downscale from 2048x2048 to 1024x1024 and PNG recompression; no retouch, recolour, generated pixels, likeness reference or separate eye/hair texture',
        sourceAIStatus: textureOutput.sourceAIStatus,
      },
      normalPolicy: 'source OBJ has no vertex normals; deterministic area-weighted normals are derived after posing and after topology-restricted LOD simplification',
      regionPolicy: 'four role-generic shader regions: skin=0, shirt=1, trousers=2, shoes=3',
      lowLodPolicy: 'meshoptimizer 1.1.1 topology-restricted simplifyWithAttributes on the original seam-split vertices with UV weight 10 and no permissive, prune or regularize flags; compact original vertices; reject unless every welded undirected edge has exactly two incident faces and every UV edge is at most 0.25',
      simplifier: {
        package: 'meshoptimizer',
        version: '1.1.1',
        license: 'MIT',
        implementationSha256: 'd2e80c60a84c700947f97ab4678cc222a5b9ab409a0745eef2dcaa79bb1ef922',
        licenseSha256: 'f03037ca7bad1e3eb7f4a63fa6084a8baabd5ba30d3c239a9a7f35705d873e26',
        archivedTerms: 'docs/licenses/meshoptimizer-1.1.1/LICENSE.md',
        relativeErrorLimit: MAX_RELATIVE_SIMPLIFICATION_ERROR,
        flags: [],
        api: 'simplifyWithAttributes',
        attributeWeights: { uv: UV_ATTRIBUTE_ERROR_WEIGHT },
        maximumUvEdgeLength: MAX_UV_EDGE_LENGTH,
        vertexLock: null,
        crossRuntimePlatformDeterminism: 'UNPROVEN; bake runtime is pinned above',
      },
    },
    technicalBudget: {
      highTriangleMaximum: MAX_HIGH_TRIANGLES,
      lowTriangleMaximum: MAX_LOW_TRIANGLES,
      premiumFarTriangleMaximum: MAX_PREMIUM_FAR_TRIANGLES,
      balancedLiteFarTriangleMaximum: MAX_BALANCED_FAR_TRIANGLES,
      boneCount: JOINT_COUNT,
      influencesPerVertex: 2,
      format: 'VPM2/version-2/52-byte-vertex with UV0; Unity decoder remains compatible with VPM1/version-1/44-byte-vertex retained assets',
      textureBytes: textureOutput.bytes,
      rawMeshDerivativeBytes: outputs.reduce((sum, output) => sum + output.bytes, 0),
      rawDerivativeBytes: outputs.reduce((sum, output) => sum + output.bytes, 0) + textureOutput.bytes,
      deltaFromPreUvCandidate: {
        previousVpm1MeshBytes: 951_184,
        currentVpm2MeshBytes: outputs.reduce((sum, output) => sum + output.bytes, 0),
        meshBytesDelta: outputs.reduce((sum, output) => sum + output.bytes, 0) - 951_184,
        texturePngBytesDelta: textureOutput.bytes,
        totalRepositoryPayloadBytesDelta:
          outputs.reduce((sum, output) => sum + output.bytes, 0) + textureOutput.bytes - 951_184,
        installedPlaySplitDelta: 'UNPROVEN',
        runtimeCpuGpuMemoryDelta: 'UNPROVEN',
      },
      textureMemoryContract: {
        sourceDimensions: [2048, 2048],
        shippedDimensions: [textureOutput.width, textureOutput.height],
        shippedPngBytes: textureOutput.bytes,
        maximumUncompressedRgba32MipChainBytes: 5_592_404,
        importerMaximumSize: 1024,
        mipmaps: true,
        readable: false,
        androidCompression: 'Unity normal-quality platform compression requested; exact format/bytes UNPROVEN until an Android release artifact is inspected',
        webglCompression: 'Unity normal-quality platform compression requested; exact format/bytes UNPROVEN until a WebGL release artifact is inspected',
      },
      materials: 1,
      editorRuntimeFootprint: {
        status: 'PRE-VPM2 HISTORICAL EDITOR-ONLY / NON-CURRENT — not Android, installed-size, texture-memory, peak-memory or physical-device proof; fresh post-upgrade measurement NOT RUN',
        buildId: '38924bd+3c7bb1b48a98',
        observedAtUtc: '2026-10-30T05:58:55Z',
        resourcePayloadBytes: 951_184,
        sharedTeamMeshObjectsBytes: 2_864_016,
        dynamicBowlerMeshObjectsBytes: 2_589_360,
        combinedMeshObjectsBytes: 5_453_376,
        rendererCount: 619,
        materialCount: 30,
        decodedMeshCount: 4,
        lazyFarMeshCount: 2,
        evidence: '/private/tmp/vande-production-human-full-graphics-final.xml',
      },
      editorLoadCost: {
        status: 'INDICATIVE ONLY — one-minute load average 29.01 exceeded the constitution threshold; no device claim',
        baseDecodeMilliseconds: 5.752,
        firstFarPairDecodeMilliseconds: 1.068,
        teamExpansionMilliseconds: 7.441,
        dynamicOwnerMilliseconds: 6.083,
        evidence: '/private/tmp/vande-production-human-full-graphics-final.xml',
      },
      androidRuntimeMemory: 'UNPROVEN',
      androidInstalledSizeDelta: 'UNPROVEN — source PNG and VPM2 byte deltas are repository facts, not Play-split/fresh-installed evidence',
      indiaWeightedReach: 'UNPROVEN',
      physicalDeviceLoadCost: 'UNPROVEN',
    },
    repositoryPaths: {
      runtimeDirectory: posixRelative(OUTPUT_DIR),
      manifest: posixRelative(MANIFEST_PATH),
      archivedTerms: 'docs/licenses/makehuman-v1.3.0/',
      simplifierArchivedTerms: 'docs/licenses/meshoptimizer-1.1.1/',
      bakeTool: posixRelative(SCRIPT_PATH),
    },
    buildExposure: {
      stage: 'Stage 1 Practice only',
      scene: 'Unity Practice production-character path',
      roles: ['batter', 'pace bowler', 'spin bowler', 'keeper', 'fielder'],
      qualityTiers: {
        LOD0: 'human-lod0.bytes; 26,756 triangles; near Premium hero only',
        LOD1: 'human-lod1.bytes; 4,000 triangles; Balanced/Medium, every wicketkeeper, every fielder below 30 m, and pace/spin bowler at or beyond 12 m (live bowler approximately 20 m)',
        LOD2: 'human-lod2.bytes; 2,000 triangles; fielder at or beyond 30 m in High/Premium',
        LOD3: 'human-lod3.bytes; 1,200 triangles; fielder at or beyond 30 m in Balanced/Medium or Lite/Low',
      },
      distancePolicy: {
        measure: 'actual planar distance from the striker presentation reference',
        boundaryMetres: 30,
        wiring: 'live scene, quality profile and benchmark all pass the actual planar distance into character selection',
        automatedEvidence: '/private/tmp/vande-production-human-world-final.xml',
      },
      loadingPolicy: {
        farMeshes: 'lazy-decode on first actual fielder, then shared by the team resource owner',
        dynamicBowlerOwner: 'loads LOD0 and LOD1 only',
        runtimeClustering: 'none',
      },
      fallbackOrderByRole: {
        Batter: ['licensed anatomy candidate', 'retained VANDE VPM1 batter mesh', 'procedural emergency geometry'],
        PaceBowler: ['licensed anatomy candidate', 'retained VANDE VPM1 bowler mesh', 'procedural emergency geometry'],
        SpinBowler: ['licensed anatomy candidate', 'retained VANDE VPM1 bowler mesh', 'procedural emergency geometry'],
        Wicketkeeper: ['licensed anatomy candidate', 'procedural emergency geometry'],
        Fielder: ['licensed anatomy candidate', 'procedural emergency geometry'],
      },
      exactBuildBinding: 'UNPROVEN — each evidence build must bind these derivative hashes independently',
    },
    reviewerStatus: {
      owner: 'Unity presentation',
      independentReviewer: '/root/production_art_independent_audit',
      recordedAtUtc: REVIEW_STATUS_RECORDED_AT_UTC,
      readinessStatus: 'TECHNICAL COMPONENT CANDIDATE / CURRENT PRESENTATION REJECTED',
      independentDecision: 'REJECT / REWORK — exact Unity WebGL diagnostic exposed the licensed anatomy but failed production-art presentation review',
    },
    evidence: {
      rightsAndSource: [
        'docs/licenses/makehuman-v1.3.0/README.md',
        'docs/licenses/makehuman-v1.3.0/LICENSE.md',
        'docs/licenses/makehuman-v1.3.0/LICENSE.ASSETS.md',
        'docs/licenses/makehuman-v1.3.0/SYSTEM-ASSET-SKIN-SNAPSHOT.md',
        'docs/licenses/makehuman-v1.3.0/production-human-provenance.json',
        'docs/licenses/meshoptimizer-1.1.1/README.md',
        'docs/licenses/meshoptimizer-1.1.1/LICENSE.md',
      ],
      deterministicContract: 'scripts/export-unity-production-human.test.mjs',
      automatedResults: [
        {
          path: '/private/tmp/vande-production-human-offline-lods-focused.xml',
          log: '/private/tmp/vande-production-human-offline-lods-focused.log',
          buildId: '38924bd+fc1ad02ac011',
          recordedAtUtc: '2026-10-30T05:56:16Z',
          method: 'Unity 6000.3.27f1 arm64 batchmode+nographics EditMode; Vande.Practice.Tests.ProductionCharacterDimensionsTests',
          expected: '31 pass / 0 fail',
          observed: '31 pass / 0 fail',
          status: 'PASS; automated builder evidence, not visual/device/human acceptance',
        },
        {
          path: '/private/tmp/vande-production-human-world-final.xml',
          log: '/private/tmp/vande-production-human-world-final.log',
          buildId: '38924bd+3c7bb1b48a98',
          recordedAtUtc: '2026-10-30T05:58:39Z',
          method: 'Unity 6000.3.27f1 arm64 batchmode+nographics EditMode; exact world distance-policy filter; two workers',
          expected: '1 pass / 0 fail',
          observed: '1 pass / 0 fail',
          status: 'PASS; automated builder evidence, not visual/device/human acceptance',
        },
        {
          path: '/private/tmp/vande-production-human-full-graphics-final.xml',
          log: '/private/tmp/vande-production-human-full-graphics-final.log',
          buildId: '38924bd+3c7bb1b48a98',
          recordedAtUtc: '2026-10-30T05:58:55Z',
          method: 'Unity 6000.3.27f1 arm64 with graphics, EditMode all, two workers',
          expected: '0 failures',
          observed: '272 pass / 0 fail',
          status: 'PASS; timing indicative because one-minute load average was 29.01; not visual/device/human acceptance',
        },
      ],
      testDevice: 'MacBookPro18,1; Apple M1 Pro 10-core; 32 GB; macOS 15.7.4 (24G517); Unity 6000.3.27f1 arm64',
      independentVisual: {
        status: 'REJECT / REWORK',
        buildId: '38924bd+efc5ca4ae735',
        recordedAtUtc: '2026-10-30T06:07:30Z',
        method: 'independent original-detail review of the exact Unity WebGL diagnostic frame at 844x390 during run-up',
        expected: 'production-grade character, equipment, pose, coupling, layering and scene match with no Critical/High visual blocker',
        observed: 'licensed anatomy is live, but flat materials, primitive procedural gear, weak face/cloth detail, pose and bat coupling, visible layer merging/overlap, robot-like distant players and scene-light mismatch remain',
        evidence: 'release/production-art/unity-webgl-diagnostic-efc5ca4ae735-20261030T060700Z/live-frame.png',
        limitation: 'one frame does not establish all animation, lighting, clipping or LOD states',
      },
      physicalDevice: 'NOT RUN',
      androidInstalledSize: 'UNPROVEN',
      indiaWeightedReach: 'UNPROVEN',
      humanPlayer: 'NOT RUN',
    },
    outputs,
    textureOutput,
    acceptance: {
      sourceLicenseReview: 'BUILDER SOURCE CHECK COMPLETE; independent legal review NOT RUN',
      deterministicBake: 'BUILDER TEST PASS (not an acceptance decision)',
      independentVisual: 'REJECT / REWORK — current exact WebGL presentation failed independent production-art review',
      clipping: 'VISUAL LAYERING REJECTED IN CAPTURE — pad/leg/crease/stump visually merge or overlap; full 3D clipping matrix NOT RUN',
      androidInstalledDelta: 'UNPROVEN',
      indiaWeightedReach: 'UNPROVEN',
      physicalDevice: 'NOT RUN',
      humanPlayer: 'NOT RUN',
    },
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeIfChanged(MANIFEST_PATH, manifestBytes);
  return { manifest, manifestPath: MANIFEST_PATH };
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const sourceDir = option('--source-dir') ?? DEFAULT_SOURCE_DIR;
  const { manifest, manifestPath } = await exportProductionHuman({ sourceDir });
  for (const output of manifest.outputs)
    process.stdout.write(`${output.path} ${output.bytes} bytes ${output.vertexCount} vertices ${output.triangleCount} triangles\n`);
  process.stdout.write(`${posixRelative(manifestPath)}\n`);
}
