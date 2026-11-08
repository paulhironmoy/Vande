#!/usr/bin/env node
/**
 * Deterministically assembles VANDE's licensed MakeHuman hero foundation into
 * one VPM3 renderer per LOD. This is an offline technical candidate only: it
 * does not certify cricket equipment, motion, Android size/reach, or visual
 * acceptance.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

import {
  UPSTREAM,
  applyFictionalIdentity,
  buildLowMesh,
  parseObj,
} from './export-unity-production-human.mjs';
import {
  DEFAULT_V3_SOURCE_DIR,
  V3_BONE_NAMES,
  V3_PINNED_SOURCES,
  VPM3_HEADER_BYTES,
  buildV3HighMesh,
  buildV3Skeleton,
  encodeVpm3,
  encodeVsk1,
  parseVpm3Header,
  parseVsk1,
} from './export-unity-production-character-v3.mjs';
import {
  DEFAULT_KIT_ARCHIVE,
  DEFAULT_KIT_SELECTION,
  SYSTEM_ASSET_PACK_URL,
  buildKitMesh,
  exportProductionKit,
  parseMhcloVertexMap,
  readSelectedZipEntries,
  sourceWeightMaps,
  transferMappedWeights,
} from './export-unity-production-kit.mjs';
import {
  BAT_TRIANGLE_BUDGETS,
  GEAR_TRIANGLE_BUDGETS,
  exportProductionCricketGear,
  parseVbt1Header,
} from './export-unity-production-cricket-gear.mjs';
import {
  CLIPS,
  DEFAULT_SOURCE_DIR as DEFAULT_MOTION_SOURCE_DIR,
  decodeVmaHeader,
  exportProductionMotion,
} from './export-unity-production-motion.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const DEFAULT_HERO_BUNDLE_OUTPUT_DIR = '/private/tmp/vande-production-hero-bundle';
export const SYSTEM_ASSET_ARCHIVE_SHA256 =
  'b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107';
export const DARK_SKIN_SOURCE_SHA256 =
  'e3f0dbb634e4c68561338f0087f7a122444e84ec56df102212f1222aa12e4d50';
export const HERO_EYES = Object.freeze({
  fileName: 'hero-eyes.bytes',
  textureFileName: 'hero-eye-albedo-256.png',
  shaderRegion: 16,
  vertexCount: 96,
  triangleCount: 172,
  headBone: 11,
  meshSha256: '84cfdd71fe6c34d5de8241fc9f27c794f1a1c192bbae8e62f71c91d33288669d',
  textureSha256: 'd47fd0debb3b3234d6b48926ca2c3c8283b9cb12bc5e2ea159658fc0ea8991d3',
  sources: Object.freeze({
    object: Object.freeze({
      archiveEntry: 'eyes/low-poly/low-poly.obj',
      sha256: '783fe1e6331162c876520b4c2bed7a8ca06354ca15497e8ebd68bb1b59f4d3de',
    }),
    transfer: Object.freeze({
      archiveEntry: 'eyes/low-poly/low-poly.mhclo',
      sha256: '68582e28e9176cba7cfcf35208f671b6201b8d1bc95c32decff61a3160ec34d8',
    }),
    material: Object.freeze({
      archiveEntry: 'eyes/materials/brown.mhmat',
      sha256: '4abad93ce50541c08127721e77bce035640c9f16bed16cd0f5524b1cd5908465',
    }),
    albedo: Object.freeze({
      archiveEntry: 'eyes/materials/brown_eye.png',
      sha256: '4659691c7295ad6206c78b003e5fd0e5f91dcd53032fa914a229bb48cabe424b',
    }),
  }),
});
if (V3_BONE_NAMES[HERO_EYES.headBone] !== 'head')
  throw new Error('The pinned hero-eye head binding no longer resolves to the VSK1 head bone');
export const HERO_RENDERED_KIT_SELECTION = Object.freeze(
  DEFAULT_KIT_SELECTION.filter(({ id }) => id === 'hair' || id === 'shoes'),
);
if (HERO_RENDERED_KIT_SELECTION.length !== 2 ||
    HERO_RENDERED_KIT_SELECTION.find(({ id }) => id === 'hair')?.region !== 11 ||
    HERO_RENDERED_KIT_SELECTION.find(({ id }) => id === 'shoes')?.region !== 3)
  throw new Error('The fitted-body hero must render exactly the pinned hair and shoe assets');
const HERO_ARCHIVE_SELECTION = Object.freeze([
  ...HERO_RENDERED_KIT_SELECTION,
  Object.freeze({ id: 'eye-geometry', stem: 'eyes/low-poly/low-poly', required: true }),
  Object.freeze({ id: 'eye-material', stem: 'eyes/materials/brown.mhmat', required: true }),
  Object.freeze({ id: 'eye-albedo', stem: 'eyes/materials/brown_eye.png', required: true }),
]);
export const RETAINED_SPINNER_CAP = Object.freeze({
  maximumCompleteBowlerTriangles: 4_000,
  detailTier: 'Low part retained on every live detail tier',
  crown: Object.freeze({ mesh: 'DomeLow', segments: 8, rings: 3, triangles: 48 }),
  peak: Object.freeze({ mesh: 'Box', triangles: 12 }),
  triangles: 60,
  policySource: 'ProductionHeroCharacterFormat.cs / KeepProceduralCricketEquipment',
  constructionSource: 'ProductionCharacterRig.cs / BuildCap; ProductionCharacterResources.cs / CreateDome and CreateBox',
});
export const RETAINED_FIELDER_CAP = Object.freeze({
  premiumMaximumCompleteTriangles: 2_000,
  balancedLiteMaximumCompleteTriangles: 1_200,
  crown: RETAINED_SPINNER_CAP.crown,
  peak: RETAINED_SPINNER_CAP.peak,
  triangles: RETAINED_SPINNER_CAP.triangles,
  policySource: 'ProductionHeroCharacterFormat.cs / KeepProceduralCricketEquipment',
  constructionSource: RETAINED_SPINNER_CAP.constructionSource,
});
const faceLandmark = (id, u, v, radiusU, radiusV) =>
  Object.freeze({ id, centre: Object.freeze([u, v]), radius: Object.freeze([radiusU, radiusV]) });
/** Pinned MakeHuman-v1.3.0 UV landmarks for the anatomical +Z face. */
export const HERO_FACE_LOD1_POLICY = Object.freeze({
  version: 'makehuman-v1.3.0-fitted-body-kit-uv-landmarks-v2',
  shaderRegion: 0,
  anatomicalFrontAxis: '+Z',
  minimumLandmarkMeanBindZ: 0.10,
  expectedSourceTriangles: 969,
  expectedLockedVertices: 611,
  expectedCombinedSourceTriangles: 29_533,
  maximumOutputTriangles: 5_000,
  simplificationCeilingTriangles: 4_999,
  expectedOutputTriangles: 4_999,
  expectedOutputVertices: 3_325,
  expectedOutputBytes: 269_426,
  expectedOutputSha256: 'd4b7423361caf85d62e5cdeef639614990ff392c5870ef474f488ced0abffaef',
  expectedObservedRelativeError: 0.029654789716005325,
  intentionalUnusedTriangleHeadroom: 1,
  headroomRationale: 'the fitted-body simplifier deterministically resolves one triangle below the hard budget; no padding or protected-identity weakening is permitted',
  expectedKitTriangles: Object.freeze({ hair: 505, shoes: 1_984 }),
  expectedSourceTriangleIdentitySha256: '079e4c925de25e622780cdc429e2156b4f95712fadd83a8dc0d5658a4b680ffb',
  expectedSourceVertexIdentitySha256: '897fe581ce80f5e77b14e300fdd8a8b33831eb65bcc77a73834159150fdb3715',
  expectedFinalVertexIdentitySha256: 'b8e5e94f889033da828bb84a1f52740a8a143e06d3403a9f1311e228cfc53ae5',
  expectedOutputTrianglesByRegion: Object.freeze({
    0: 2_219,
    1: 1_079,
    2: 800,
    3: 748,
    11: 153,
  }),
  landmarks: Object.freeze([
    faceLandmark('left-brow', 0.811547, 0.440054, 0.010, 0.010),
    faceLandmark('right-brow', 0.808255, 0.539877, 0.010, 0.010),
    faceLandmark('left-eye', 0.839764, 0.439762, 0.010, 0.010),
    faceLandmark('right-eye', 0.839743, 0.540149, 0.010, 0.010),
    faceLandmark('nose', 0.885850, 0.488944, 0.010, 0.009),
    faceLandmark('mouth', 0.924361, 0.486956, 0.015, 0.015),
    faceLandmark('chin', 0.950341, 0.490552, 0.010, 0.015),
    faceLandmark('left-ocular-island', 0.050, 0.590, 0.008, 0.015),
    faceLandmark('right-ocular-island', 0.115, 0.590, 0.008, 0.015),
  ]),
});
export const HERO_BUNDLE_LODS = Object.freeze([
  Object.freeze({ lod: 0, body: 'high', kit: 0, usage: 'close-up', maximumTriangles: 40_000 }),
  Object.freeze({
    lod: 1,
    body: 'high',
    kit: 3,
    usage: 'live-batter-face-protected',
    maximumTriangles: 5_000,
    faceProtectionPolicy: HERO_FACE_LOD1_POLICY.version,
  }),
  Object.freeze({
    lod: 2,
    body: 'low',
    kit: 2,
    usage: 'live-bowler/low-batter',
    maximumTriangles: RETAINED_SPINNER_CAP.maximumCompleteBowlerTriangles -
      RETAINED_SPINNER_CAP.triangles - HERO_EYES.triangleCount,
  }),
  Object.freeze({
    lod: 3,
    body: 'low',
    kit: 2,
    usage: 'distant-fielder-premium',
    maximumTriangles: RETAINED_FIELDER_CAP.premiumMaximumCompleteTriangles -
      RETAINED_FIELDER_CAP.triangles - HERO_EYES.triangleCount,
    maximumRelativeError: 0.10,
  }),
  Object.freeze({
    lod: 4,
    body: 'low',
    kit: 2,
    usage: 'distant-fielder-balanced-lite',
    maximumTriangles: RETAINED_FIELDER_CAP.balancedLiteMaximumCompleteTriangles -
      RETAINED_FIELDER_CAP.triangles - HERO_EYES.triangleCount,
    maximumRelativeError: 0.25,
  }),
]);
export const HERO_BUNDLE_GEAR = Object.freeze([
  Object.freeze({ detail: 'high', gearLod: 0, batLod: 0 }),
  Object.freeze({ detail: 'live', gearLod: 1, batLod: 1 }),
]);
export const HERO_BUNDLE_MOTIONS = Object.freeze([
  Object.freeze({
    id: 'cmu-35-run-jog-reference',
    fileName: 'motion-runup.bytes',
    role: 'runup_reference_only',
  }),
  Object.freeze({
    id: 'cmu-124-baseball-swing-reference',
    fileName: 'motion-batting-weight.bytes',
    role: 'batting_weight_transfer_reference_only',
  }),
]);

const TARGET_HEIGHT_METRES = 1.78;
const DARK_SKIN_STEM = 'young_darkskinned_male_diffuse';
const NO_CANONICAL_SEMANTIC = 0xffff;
const LIVE_SIMPLIFICATION_ERROR_LIMIT = 0.05;
const MAX_SHADER_REGION = 11;
export const FITTED_BODY_REGIONS = Object.freeze({
  skin: 0,
  jersey: 1,
  trousers: 2,
  shoeFoot: 3,
});
export const FITTED_CRICKET_TRANSITION_POLICY = Object.freeze({
  version: 'vande-fitted-cricket-transitions-v3-body-conformal-bands',
  shaderRegion: FITTED_BODY_REGIONS.jersey,
  crossSectionSegments: 4,
  features: Object.freeze([
    Object.freeze({ id: 'collar', firstRegion: 0, secondRegion: 1, segments: 12,
      bandHalfWidth: 0.0040, relief: 0.0013, standOff: 0.0005 }),
    Object.freeze({ id: 'waist-hem', firstRegion: 1, secondRegion: 2, segments: 12,
      bandHalfWidth: 0.0045, relief: 0.0013, standOff: 0.0005 }),
    Object.freeze({ id: 'left-sleeve-cuff', firstRegion: 0, secondRegion: 1, segments: 6,
      bandHalfWidth: 0.0035, relief: 0.0011, standOff: 0.0005 }),
    Object.freeze({ id: 'right-sleeve-cuff', firstRegion: 0, secondRegion: 1, segments: 6,
      bandHalfWidth: 0.0035, relief: 0.0011, standOff: 0.0005 }),
  ]),
  expectedVertices: 144,
  expectedTriangles: 288,
  minimumLiveRetainedVertexFraction: 0.50,
  minimumLiveRetainedTriangleFraction: 0.50,
  minimumLiveNonDegenerateAxes: 3,
  construction:
    'closed four-sided low-relief bands interpolated on the actual categorical body boundary; nearest complete authored four-slot body skin record is copied exactly',
});
const FITTED_BODY_SKIN_BONES = new Set(V3_BONE_NAMES
  .map((name, index) => ({ name, index }))
  .filter(({ name }) => name === 'head' || name === 'jaw' || name.startsWith('neck') ||
    name.startsWith('lowerarm') || name.startsWith('wrist') || name.startsWith('metacarpal') ||
    name.startsWith('finger'))
  .map(({ index }) => index));
const FITTED_BODY_FOOT_BONES = new Set(V3_BONE_NAMES
  .map((name, index) => ({ name, index }))
  .filter(({ name }) => name.startsWith('foot.'))
  .map(({ index }) => index));
const FITTED_BODY_TROUSER_BONES = new Set(V3_BONE_NAMES
  .map((name, index) => ({ name, index }))
  .filter(({ name }) => name === 'root' || name.startsWith('pelvis.') ||
    name.startsWith('upperleg') || name.startsWith('lowerleg'))
  .map(({ index }) => index));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function writeIfChanged(path, bytes) {
  let current = null;
  try { current = await readFile(path); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (current == null || !current.equals(bytes)) await writeFile(path, bytes);
}

function makeCoordinateTransform(body) {
  const positions = [...new Set(body.triangles)].map((index) => body.positions[index]);
  const minimumY = Math.min(...positions.map((position) => position[1]));
  const maximumY = Math.max(...positions.map((position) => position[1]));
  const height = maximumY - minimumY;
  if (!Number.isFinite(height) || height <= 0) throw new Error('Pinned body height is invalid');
  const scale = TARGET_HEIGHT_METRES / height;
  return (position) => applyFictionalIdentity([
    position[0] * scale,
    (position[1] - minimumY) * scale,
    position[2] * scale,
  ]);
}

/**
 * The canonical motion semantic named Hips must drive the VSK root. MakeHuman's
 * root is the common ancestor of the two pelvis chains and spine05; mapping the
 * semantic to spine05 leaves both legs outside the animated subtree.
 */
export function mapCanonicalHipsToRoot(bones) {
  if (!Array.isArray(bones) || bones.length === 0) throw new Error('A non-empty VSK bone list is required');
  const roots = bones.map(({ parent }, index) => parent === -1 ? index : -1).filter((index) => index >= 0);
  if (roots.length !== 1) throw new Error(`Expected one VSK root, found ${roots.length}`);
  const root = roots[0];
  if (root !== 0) throw new Error(`VSK root must be bone 0, found ${root}`);
  if (bones[root].semantic !== NO_CANONICAL_SEMANTIC && bones[root].semantic !== 0)
    throw new Error(`VSK root already owns unexpected semantic ${bones[root].semantic}`);
  const hips = bones.map(({ semantic }, index) => semantic === 0 ? index : -1).filter((index) => index >= 0);
  if (hips.length !== 1) throw new Error(`Expected one canonical Hips semantic, found ${hips.length}`);
  return bones.map((bone, index) => ({
    ...bone,
    localPosition: [...bone.localPosition],
    localRotation: [...bone.localRotation],
    semantic: index === root ? 0 : index === hips[0] ? NO_CANONICAL_SEMANTIC : bone.semantic,
  }));
}

function skinFingerprint(vertex) {
  return `${vertex.region}/${vertex.bones.join(',')}/${vertex.weights.join(',')}`;
}

function maximumNonZeroInfluences(mesh) {
  return Math.max(...mesh.vertices.map(({ weights }) => weights.filter((weight) => weight > 0).length));
}

function triangleIdentity(a, b, c) {
  return [a, b, c].sort((left, right) => left - right).join(',');
}

function landmarkContains(vertex, landmark, policy) {
  if (vertex.region !== policy.shaderRegion) return false;
  const du = (vertex.uv[0] - landmark.centre[0]) / landmark.radius[0];
  const dv = (vertex.uv[1] - landmark.centre[1]) / landmark.radius[1];
  return du * du + dv * dv <= 1;
}

/** Build a deterministic Meshopt lock from the pinned +Z anatomical-face UV islands. */
export function buildProtectedFaceLock(mesh, policy = HERO_FACE_LOD1_POLICY) {
  if (!Array.isArray(mesh?.vertices) || !Array.isArray(mesh?.indices) || mesh.indices.length % 3 !== 0)
    throw new Error('Protected-face source mesh is malformed');
  if (!Array.isArray(policy?.landmarks) || policy.landmarks.length === 0)
    throw new Error('Protected-face policy has no landmarks');

  const memberships = mesh.vertices.map((vertex) => policy.landmarks
    .map((landmark, index) => landmarkContains(vertex, landmark, policy) ? index : -1)
    .filter((index) => index >= 0));
  const vertexLock = new Uint8Array(mesh.vertices.length);
  const protectedTriangleKeys = new Set();
  const protectedTriangles = [];
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const triangle = mesh.indices.slice(offset, offset + 3);
    if (!triangle.every((index) => memberships[index].length > 0)) continue;
    const key = triangleIdentity(...triangle);
    if (protectedTriangleKeys.has(key))
      throw new Error(`Protected-face source contains duplicate triangle ${key}`);
    protectedTriangleKeys.add(key);
    protectedTriangles.push(triangle);
    for (const index of triangle) vertexLock[index] = 1;
  }
  // A sparse UV island can contain valid landmark vertices without containing
  // all three corners of a source triangle. Protect its complete incident skin
  // one-ring so that the landmark owns real topology; never enlarge a UV
  // threshold or pad the output to manufacture a triangle count.
  for (let landmarkIndex = 0; landmarkIndex < policy.landmarks.length; landmarkIndex++) {
    const protectedForLandmark = protectedTriangles.filter((triangle) =>
      triangle.some((index) => memberships[index].includes(landmarkIndex))).length;
    if (protectedForLandmark > 0) continue;
    const landmark = policy.landmarks[landmarkIndex];
    const candidates = [];
    for (let offset = 0; offset < mesh.indices.length; offset += 3) {
      const triangle = mesh.indices.slice(offset, offset + 3);
      if (!triangle.every((index) => mesh.vertices[index].region === policy.shaderRegion) ||
          !triangle.some((index) => memberships[index].includes(landmarkIndex))) continue;
      const score = triangle.reduce((sum, index) => {
        const vertex = mesh.vertices[index];
        const du = (vertex.uv[0] - landmark.centre[0]) / landmark.radius[0];
        const dv = (vertex.uv[1] - landmark.centre[1]) / landmark.radius[1];
        return sum + du * du + dv * dv;
      }, 0);
      candidates.push({ triangle, score, offset });
    }
    candidates.sort((left, right) => left.score - right.score || left.offset - right.offset);
    for (const candidate of candidates) {
      const key = triangleIdentity(...candidate.triangle);
      if (protectedTriangleKeys.has(key)) continue;
      protectedTriangleKeys.add(key);
      protectedTriangles.push(candidate.triangle);
      for (const index of candidate.triangle) vertexLock[index] = 1;
    }
    if (candidates.length === 0)
      throw new Error(`Protected-face landmark ${landmark.id} has insufficient incident skin topology`);
  }

  const lockedVertices = vertexLock.reduce((sum, value) => sum + value, 0);
  const lockedSourceIndices = [...vertexLock.keys()].filter((index) => vertexLock[index] !== 0);
  const sourceTriangleIdentitySha256 = sha256(Buffer.from(
    [...protectedTriangleKeys].sort().join('\n'),
  ));
  const sourceVertexIdentitySha256 = sha256(Buffer.from(JSON.stringify(lockedSourceIndices.map((index) => {
    const vertex = mesh.vertices[index];
    return {
      sourceIndex: index,
      position: vertex.position,
      bindPos: vertex.bindPos,
      uv: vertex.uv,
      region: vertex.region,
      bones: vertex.bones,
      weights: vertex.weights,
    };
  }))));
  const landmarks = policy.landmarks.map((landmark, landmarkIndex) => {
    const indices = memberships
      .map((values, index) => values.includes(landmarkIndex) ? index : -1)
      .filter((index) => index >= 0);
    if (indices.length === 0)
      throw new Error(`Protected-face landmark ${landmark.id} is vacuous`);
    const meanBindZ = indices.reduce((sum, index) => sum + mesh.vertices[index].bindPos[2], 0) / indices.length;
    if (!Number.isFinite(meanBindZ) || meanBindZ < policy.minimumLandmarkMeanBindZ)
      throw new Error(`Protected-face landmark ${landmark.id} is not on anatomical +Z`);
    const intersectingProtectedTriangles = protectedTriangles.filter((triangle) =>
      triangle.some((index) => memberships[index].includes(landmarkIndex))).length;
    if (intersectingProtectedTriangles === 0)
      throw new Error(`Protected-face landmark ${landmark.id} is not represented by protected topology`);
    return {
      id: landmark.id,
      centre: [...landmark.centre],
      radius: [...landmark.radius],
      qualifyingVertices: indices.length,
      intersectingProtectedTriangles,
      meanBindZ,
    };
  });
  if (protectedTriangleKeys.size !== policy.expectedSourceTriangles)
    throw new Error(`Protected-face source has ${protectedTriangleKeys.size} triangles; expected ` +
      `${policy.expectedSourceTriangles}`);
  if (lockedVertices !== policy.expectedLockedVertices)
    throw new Error(`Protected-face source locks ${lockedVertices} vertices; expected ${policy.expectedLockedVertices}`);

  return {
    vertexLock,
    protectedTriangleKeys,
    metrics: {
      policyVersion: policy.version,
      anatomicalFrontAxis: policy.anatomicalFrontAxis,
      sourceTriangles: protectedTriangleKeys.size,
      lockedVertices,
      maximumOutputTriangles: policy.maximumOutputTriangles,
      simplificationCeilingTriangles: policy.simplificationCeilingTriangles,
      expectedOutputTriangles: policy.expectedOutputTriangles,
      intentionalUnusedTriangleHeadroom: policy.intentionalUnusedTriangleHeadroom,
      headroomRationale: policy.headroomRationale,
      sourceTriangleIdentitySha256,
      sourceVertexIdentitySha256,
      landmarks,
    },
  };
}

/**
 * Split every categorical shader-region boundary before simplification. The
 * MakeHuman body derives its shader region from the dominant skinning bone, so
 * some source triangles straddle skin/fitted-kit regions. Interpolating that
 * integer-like value inside one triangle is undefined for the runtime shader.
 *
 * Original vertices stay at their original indices. A corner is duplicated
 * only when its triangle's deterministic majority region differs from the
 * corner region. This disconnects the region components without changing any
 * position, bind position, UV, authored normal/tangent, or four-slot skin
 * record. Protected-face triangles are pure skin and therefore keep their
 * original vertex and triangle identities.
 */
export function splitMixedTriangleRegions(mesh, protection = null) {
  if (!Array.isArray(mesh?.vertices) || !Array.isArray(mesh?.indices) || mesh.indices.length % 3 !== 0)
    throw new Error('Shader-region split source mesh is malformed');
  if (protection != null && (!(protection.vertexLock instanceof Uint8Array) ||
      protection.vertexLock.length !== mesh.vertices.length ||
      !(protection.protectedTriangleKeys instanceof Set)))
    throw new Error('Shader-region split received malformed protected-face data');

  const vertices = mesh.vertices.map((source) => ({
    ...source,
    position: [...source.position], normal: [...source.normal], tangent: [...source.tangent],
    bindPos: [...source.bindPos], uv: [...source.uv], bones: [...source.bones], weights: [...source.weights],
  }));
  const duplicateBySourceAndRegion = new Map();
  const indices = [];
  let mixedSourceTriangles = 0;
  let reassignedCorners = 0;
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const triangle = mesh.indices.slice(offset, offset + 3);
    const counts = new Map();
    for (const sourceIndex of triangle) {
      const region = mesh.vertices[sourceIndex]?.region;
      if (!Number.isInteger(region) || region < 0 || region > MAX_SHADER_REGION)
        throw new Error(`Shader-region split source vertex ${sourceIndex} has unsupported region ${region}`);
      counts.set(region, (counts.get(region) ?? 0) + 1);
    }
    const targetRegion = [...counts]
      .sort((left, right) => right[1] - left[1] || left[0] - right[0])[0][0];
    if (counts.size > 1) mixedSourceTriangles++;
    for (const sourceIndex of triangle) {
      const source = mesh.vertices[sourceIndex];
      if (source.region === targetRegion) {
        indices.push(sourceIndex);
        continue;
      }
      reassignedCorners++;
      const key = `${sourceIndex}/${targetRegion}`;
      let outputIndex = duplicateBySourceAndRegion.get(key);
      if (outputIndex == null) {
        outputIndex = vertices.length;
        duplicateBySourceAndRegion.set(key, outputIndex);
        vertices.push({
          ...source,
          position: [...source.position], normal: [...source.normal], tangent: [...source.tangent],
          bindPos: [...source.bindPos], uv: [...source.uv], bones: [...source.bones], weights: [...source.weights],
          region: targetRegion,
        });
      }
      indices.push(outputIndex);
    }
  }

  const triangleRegions = triangleRegionDistribution({ vertices, indices });
  const mixedOutputTriangles = Object.entries(triangleRegions)
    .filter(([key]) => key.includes('+'))
    .reduce((sum, [, count]) => sum + count, 0);
  if (mixedOutputTriangles !== 0)
    throw new Error(`Shader-region split retained ${mixedOutputTriangles} mixed triangles`);

  let splitProtection = null;
  if (protection != null) {
    const vertexLock = new Uint8Array(vertices.length);
    vertexLock.set(protection.vertexLock);
    for (const key of protection.protectedTriangleKeys) {
      const [a, b, c] = key.split(',').map(Number);
      if (vertices[a]?.region !== HERO_FACE_LOD1_POLICY.shaderRegion ||
          vertices[b]?.region !== HERO_FACE_LOD1_POLICY.shaderRegion ||
          vertices[c]?.region !== HERO_FACE_LOD1_POLICY.shaderRegion)
        throw new Error(`Protected-face triangle ${key} crosses a shader-region boundary`);
    }
    splitProtection = { ...protection, vertexLock };
  }

  return {
    mesh: {
      vertices,
      indices,
      regionBoundary: {
        policy: 'disconnect mixed source triangles by deterministic majority region; tie uses lower region id',
        mixedSourceTriangles,
        mixedOutputTriangles,
        duplicatedVertices: vertices.length - mesh.vertices.length,
        reassignedCorners,
        triangleRegions,
        authoredVertexAttributesPreserved: true,
        maximumPositionDriftMetres: 0,
        maximumBindPositionDriftMetres: 0,
        maximumUvDrift: 0,
        maximumNormalComponentDrift: 0,
        maximumTangentComponentDrift: 0,
        fourSlotSkinRecordsPreservedExactly: true,
      },
    },
    protection: splitProtection,
  };
}

/**
 * Simplify the already combined renderer so the fitted body, hair and shoes
 * share one live-game draw. meshoptimizer returns only source vertices; region,
 * authored shading, and quantized four-bone skin records therefore remain
 * byte-exact. UVs, normals, skin records and a one-hot shader region are also
 * error attributes.
 */
export function simplifyCombinedHeroMesh(
  mesh,
  maximumTriangles,
  maximumRelativeError = LIVE_SIMPLIFICATION_ERROR_LIMIT,
  protection = null,
) {
  if (!Number.isInteger(maximumTriangles) || maximumTriangles < 4)
    throw new Error(`Invalid combined-hero triangle budget ${maximumTriangles}`);
  if (!Array.isArray(mesh.vertices) || !Array.isArray(mesh.indices) || mesh.indices.length % 3 !== 0)
    throw new Error('Combined hero mesh is malformed');
  const vertexLock = protection?.vertexLock ?? null;
  if (vertexLock != null && (!(vertexLock instanceof Uint8Array) || vertexLock.length !== mesh.vertices.length))
    throw new Error('Protected-face lock must have one Uint8 entry per combined source vertex');
  if (protection != null && !(protection.protectedTriangleKeys instanceof Set))
    throw new Error('Protected-face topology identities must be a Set');
  if (mesh.indices.length / 3 <= maximumTriangles) {
    const protectedOutputVertexIndices = vertexLock == null
      ? []
      : [...vertexLock.keys()].filter((index) => vertexLock[index] !== 0);
    return {
      ...combineMeshes([mesh]),
      protectedOutputVertexIndices,
      simplification: {
        algorithm: 'none/already-within-budget',
        sourceTriangles: mesh.indices.length / 3,
        targetTriangles: maximumTriangles,
        achievedTriangles: mesh.indices.length / 3,
        observedRelativeError: 0,
        protection: protection == null ? null : {
          ...protection.metrics,
          retainedTriangles: protection.protectedTriangleKeys.size,
          retainedLockedVertices: protectedOutputVertexIndices.length,
          retainedTriangleIdentitySha256: protection.metrics.sourceTriangleIdentitySha256,
          retainedSourceVertexIdentitySha256: protection.metrics.sourceVertexIdentitySha256,
          maximumPositionDriftMetres: 0,
          maximumBindPositionDriftMetres: 0,
          maximumUvDrift: 0,
          maximumNormalComponentDrift: 0,
          maximumTangentComponentDrift: 0,
          fourSlotSkinRecordsPreservedExactly: true,
        },
        regionBoundary: mesh.regionBoundary ?? null,
      },
    };
  }

  const positions = new Float32Array(mesh.vertices.length * 3);
  // uv2 + normal3 + four bone ids + four weights + regions[0..11] = 25 attributes.
  const attributeStride = 25;
  const attributes = new Float32Array(mesh.vertices.length * attributeStride);
  const sourceFingerprints = new Set();
  const sourceRegions = new Set();
  for (let index = 0; index < mesh.vertices.length; index++) {
    const vertex = mesh.vertices[index];
    if (!Number.isInteger(vertex.region) || vertex.region < 0 || vertex.region > MAX_SHADER_REGION)
      throw new Error(`Combined hero vertex ${index} has unsupported shader region ${vertex.region}`);
    if (vertex.weights.reduce((sum, weight) => sum + weight, 0) !== 255)
      throw new Error(`Combined hero vertex ${index} has invalid quantized skin weights`);
    positions.set(vertex.position, index * 3);
    const offset = index * attributeStride;
    attributes.set(vertex.uv, offset);
    attributes.set(vertex.normal, offset + 2);
    for (let influence = 0; influence < 4; influence++) {
      attributes[offset + 5 + influence] = vertex.weights[influence] === 0
        ? 0
        : vertex.bones[influence] / 74;
      attributes[offset + 9 + influence] = vertex.weights[influence] / 255;
    }
    attributes[offset + 13 + vertex.region] = 1;
    sourceFingerprints.add(skinFingerprint(vertex));
    sourceRegions.add(vertex.region);
  }
  const attributeWeights = [
    10, 10, // UV
    1, 1, 1, // normal
    4, 4, 4, 4, // retained bone identities
    4, 4, 4, 4, // retained quantized weights
    ...new Array(MAX_SHADER_REGION + 1).fill(100), // categorical shader region
  ];
  const outputTriangleCeiling = protection?.metrics.simplificationCeilingTriangles ?? maximumTriangles;
  if (!Number.isInteger(outputTriangleCeiling) || outputTriangleCeiling < 4 ||
      outputTriangleCeiling > maximumTriangles)
    throw new Error('Protected-face output ceiling must be a positive integer within the LOD budget');
  let requestedTriangles;
  let simplifiedSourceIndices;
  let observedRelativeError;
  let achievedTriangles;
  const simplifyAt = (triangleRequest) => {
    const [indices, error] = MeshoptSimplifier.simplifyWithAttributes(
      new Uint32Array(mesh.indices),
      positions,
      3,
      attributes,
      attributeStride,
      attributeWeights,
      vertexLock,
      triangleRequest * 3,
      maximumRelativeError,
      [],
    );
    return { indices, error, triangles: indices.length / 3, request: triangleRequest };
  };
  let candidate = simplifyAt(outputTriangleCeiling);
  if (Number.isInteger(candidate.triangles) && candidate.triangles <= outputTriangleCeiling &&
      protection != null && candidate.triangles < outputTriangleCeiling) {
    // A protected boundary can undershoot the requested count. Probe only a
    // tiny deterministic window above the external ceiling and keep the
    // densest authentic simplifier result which still satisfies that ceiling;
    // never pad, truncate or manufacture a triangle to hit the registered LOD.
    for (let extra = 1; extra <= 16; extra++) {
      const probe = simplifyAt(outputTriangleCeiling + extra);
      if (!Number.isInteger(probe.triangles)) break;
      if (probe.triangles <= outputTriangleCeiling && probe.triangles > candidate.triangles)
        candidate = probe;
      if (candidate.triangles === outputTriangleCeiling || probe.triangles > outputTriangleCeiling) break;
    }
  } else if (Number.isInteger(candidate.triangles) && candidate.triangles > outputTriangleCeiling) {
    // Attribute/topology locks can also produce a small deterministic
    // overshoot. Tighten the request by that overshoot plus one until the
    // externally registered hard ceiling is met.
    for (let attempt = 1; attempt < 8 && candidate.triangles > outputTriangleCeiling; attempt++) {
      const tightened = Math.max(1,
        candidate.request - (candidate.triangles - outputTriangleCeiling) - 1);
      candidate = simplifyAt(tightened);
    }
  }
  ({ indices: simplifiedSourceIndices, error: observedRelativeError,
    triangles: achievedTriangles, request: requestedTriangles } = candidate);
  if (!Number.isInteger(achievedTriangles) || achievedTriangles > outputTriangleCeiling)
    throw new Error(`Combined hero simplifier achieved ${achievedTriangles}, ceiling ${outputTriangleCeiling}`);

  let retainedProtectedTriangles = 0;
  let retainedLockedVertices = 0;
  if (protection != null) {
    const outputTriangleKeys = new Set();
    for (let offset = 0; offset < simplifiedSourceIndices.length; offset += 3)
      outputTriangleKeys.add(triangleIdentity(...simplifiedSourceIndices.slice(offset, offset + 3)));
    const missingProtectedTriangles = [...protection.protectedTriangleKeys]
      .filter((key) => !outputTriangleKeys.has(key));
    if (missingProtectedTriangles.length > 0)
      throw new Error(`Combined hero simplification removed ${missingProtectedTriangles.length} ` +
        'protected-face triangles');
    retainedProtectedTriangles = protection.protectedTriangleKeys.size;
    const retainedSourceVertices = new Set(simplifiedSourceIndices);
    for (let index = 0; index < vertexLock.length; index++) {
      if (!vertexLock[index]) continue;
      if (!retainedSourceVertices.has(index))
        throw new Error(`Combined hero simplification removed protected-face vertex ${index}`);
      retainedLockedVertices++;
    }
  }

  const compactIndices = new Uint32Array(simplifiedSourceIndices);
  const [remap, vertexCount] = MeshoptSimplifier.compactMesh(compactIndices);
  const vertices = new Array(vertexCount);
  const missing = 0xffffffff;
  for (let sourceIndex = 0; sourceIndex < remap.length; sourceIndex++) {
    const compactIndex = remap[sourceIndex];
    if (compactIndex === missing) continue;
    const source = mesh.vertices[sourceIndex];
    vertices[compactIndex] = {
      ...source,
      position: [...source.position], normal: [...source.normal], tangent: [...source.tangent],
      bindPos: [...source.bindPos], uv: [...source.uv], bones: [...source.bones], weights: [...source.weights],
    };
  }
  if (vertices.some((vertex) => vertex == null))
    throw new Error('Combined hero simplification left an unpopulated vertex');
  const protectedOutputVertexIndices = [];
  let maximumPositionDriftMetres = 0;
  let maximumBindPositionDriftMetres = 0;
  let maximumUvDrift = 0;
  let maximumNormalComponentDrift = 0;
  let maximumTangentComponentDrift = 0;
  let maximumRetainedNormalComponentDrift = 0;
  let maximumRetainedTangentComponentDrift = 0;
  for (let sourceIndex = 0; sourceIndex < remap.length; sourceIndex++) {
    const compactIndex = remap[sourceIndex];
    if (compactIndex === missing) continue;
    const source = mesh.vertices[sourceIndex];
    const output = vertices[compactIndex];
    maximumRetainedNormalComponentDrift = Math.max(maximumRetainedNormalComponentDrift,
      ...source.normal.map((value, axis) => Math.abs(value - output.normal[axis])));
    maximumRetainedTangentComponentDrift = Math.max(maximumRetainedTangentComponentDrift,
      ...source.tangent.map((value, axis) => Math.abs(value - output.tangent[axis])));
  }
  if (maximumRetainedNormalComponentDrift !== 0 || maximumRetainedTangentComponentDrift !== 0)
    throw new Error('Combined hero simplification drifted an authored normal or tangent');
  if (protection != null) {
    for (let sourceIndex = 0; sourceIndex < vertexLock.length; sourceIndex++) {
      if (!vertexLock[sourceIndex]) continue;
      const compactIndex = remap[sourceIndex];
      if (compactIndex === missing) throw new Error(`Protected-face vertex ${sourceIndex} was not compacted`);
      protectedOutputVertexIndices.push(compactIndex);
      const source = mesh.vertices[sourceIndex];
      const output = vertices[compactIndex];
      maximumPositionDriftMetres = Math.max(maximumPositionDriftMetres,
        ...source.position.map((value, axis) => Math.abs(value - output.position[axis])));
      maximumBindPositionDriftMetres = Math.max(maximumBindPositionDriftMetres,
        ...source.bindPos.map((value, axis) => Math.abs(value - output.bindPos[axis])));
      maximumUvDrift = Math.max(maximumUvDrift,
        ...source.uv.map((value, axis) => Math.abs(value - output.uv[axis])));
      maximumNormalComponentDrift = Math.max(maximumNormalComponentDrift,
        ...source.normal.map((value, axis) => Math.abs(value - output.normal[axis])));
      maximumTangentComponentDrift = Math.max(maximumTangentComponentDrift,
        ...source.tangent.map((value, axis) => Math.abs(value - output.tangent[axis])));
      if (source.region !== output.region ||
          source.bones.some((value, slot) => value !== output.bones[slot]) ||
          source.weights.some((value, slot) => value !== output.weights[slot]))
        throw new Error(`Protected-face vertex ${sourceIndex} changed its region or skin record`);
    }
    if (maximumPositionDriftMetres !== 0 || maximumBindPositionDriftMetres !== 0 || maximumUvDrift !== 0 ||
        maximumNormalComponentDrift !== 0 || maximumTangentComponentDrift !== 0)
      throw new Error('Protected-face vertex record drifted during simplification');
  }
  const indices = Array.from(compactIndices);
  const outputRegions = new Set(vertices.map(({ region }) => region));
  if (sourceRegions.size !== outputRegions.size || [...sourceRegions].some((region) => !outputRegions.has(region)))
    throw new Error('Combined hero simplification removed a shader region');
  if (vertices.some((vertex) => !sourceFingerprints.has(skinFingerprint(vertex))))
    throw new Error('Combined hero simplification changed a region or skin record');
  return {
    vertices,
    indices,
    protectedOutputVertexIndices,
    simplification: {
      algorithm: 'meshoptimizer-1.1.1 simplifyWithAttributes on final combined renderer',
      sourceTriangles: mesh.indices.length / 3,
      targetTriangles: maximumTriangles,
      internalRequestedTriangles: requestedTriangles,
      achievedTriangles,
      maximumRelativeError,
      observedRelativeError,
      attributes: 'uv, normal, four bone ids, four quantized weights, one-hot shader region',
      sourceVertexRecordsRetainedExactly: true,
      maximumRetainedNormalComponentDrift,
      maximumRetainedTangentComponentDrift,
      regionBoundary: mesh.regionBoundary ?? null,
      protection: protection == null ? null : {
        ...protection.metrics,
        retainedTriangles: retainedProtectedTriangles,
        retainedLockedVertices,
        retainedTriangleIdentitySha256: protection.metrics.sourceTriangleIdentitySha256,
        retainedSourceVertexIdentitySha256: protection.metrics.sourceVertexIdentitySha256,
        maximumPositionDriftMetres,
        maximumBindPositionDriftMetres,
        maximumUvDrift,
        maximumNormalComponentDrift,
        maximumTangentComponentDrift,
        fourSlotSkinRecordsPreservedExactly: true,
      },
    },
  };
}

/**
 * Classify one MakeHuman anatomy vertex as fitted cricket presentation paint.
 *
 * The classifier deliberately follows the dominant entry in the already
 * quantized four-slot VPM3 skin record. That makes the paint follow the same
 * authored deformation driver as the surface itself: torso and upper-arm
 * vertices become jersey, pelvis/leg vertices become trousers, and feet become
 * shoes without introducing a second garment rig or a shoulder/sleeve seam.
 */
export function classifyFittedBodyVertexRegion(vertex) {
  if (!Array.isArray(vertex?.bones) || vertex.bones.length !== 4 ||
      !Array.isArray(vertex?.weights) || vertex.weights.length !== 4)
    throw new Error('Fitted-body classification requires one four-slot VPM3 skin record');
  if (vertex.weights.some((weight) => !Number.isInteger(weight) || weight < 0 || weight > 255) ||
      vertex.weights.reduce((sum, weight) => sum + weight, 0) !== 255)
    throw new Error('Fitted-body classification requires quantized weights summing to 255');
  if (vertex.bones.some((bone) => !Number.isInteger(bone) || bone < 0 || bone >= V3_BONE_NAMES.length))
    throw new Error('Fitted-body classification encountered an unsupported VSK1 bone');
  const dominant = [0, 1, 2, 3]
    .sort((left, right) => vertex.weights[right] - vertex.weights[left] ||
      vertex.bones[left] - vertex.bones[right] || left - right)[0];
  const bone = vertex.bones[dominant];
  if (FITTED_BODY_SKIN_BONES.has(bone)) return FITTED_BODY_REGIONS.skin;
  if (FITTED_BODY_FOOT_BONES.has(bone)) return FITTED_BODY_REGIONS.shoeFoot;
  if (FITTED_BODY_TROUSER_BONES.has(bone)) return FITTED_BODY_REGIONS.trousers;
  return FITTED_BODY_REGIONS.jersey;
}

const fittedBodySkinRecord = (vertex) => ({
  position: vertex.position,
  normal: vertex.normal,
  tangent: vertex.tangent,
  bindPos: vertex.bindPos,
  uv: vertex.uv,
  bones: vertex.bones,
  weights: vertex.weights,
  sourcePositionIndex: vertex.sourcePositionIndex,
  sourceTexcoordIndex: vertex.sourceTexcoordIndex,
});

/**
 * Paint the full licensed anatomy surface as a fitted cricket kit, then make
 * every visible triangle categorical. Boundary corners are duplicated only to
 * carry a material id; their position, bind position, authored normal/tangent,
 * UV and all four skin slots remain exact. The coincident, identically skinned
 * boundary cannot open into the independent-garment shoulder tears which this
 * path replaces.
 */
export function buildFittedBodyCricketKitMesh(mesh) {
  if (mesh == null || !Array.isArray(mesh.vertices) || !Array.isArray(mesh.indices) ||
      mesh.vertices.length === 0 || mesh.indices.length === 0 || mesh.indices.length % 3 !== 0)
    throw new Error('Fitted-body source mesh is malformed');
  const sourceSkinRecords = mesh.vertices.map(fittedBodySkinRecord);
  const sourceSkinRecordSha256 = sha256(Buffer.from(JSON.stringify(sourceSkinRecords)));
  const sourceRegions = regionDistribution(mesh);
  const painted = {
    vertices: mesh.vertices.map((source) => ({
      ...source,
      position: [...source.position],
      normal: [...source.normal],
      tangent: [...source.tangent],
      bindPos: [...source.bindPos],
      uv: [...source.uv],
      bones: [...source.bones],
      weights: [...source.weights],
      region: classifyFittedBodyVertexRegion(source),
    })),
    indices: [...mesh.indices],
  };
  const paintedSkinRecordSha256 = sha256(Buffer.from(JSON.stringify(
    painted.vertices.map(fittedBodySkinRecord),
  )));
  if (paintedSkinRecordSha256 !== sourceSkinRecordSha256)
    throw new Error('Fitted-body paint changed an authored geometry or four-slot skin record');
  const split = splitMixedTriangleRegions(painted);
  const allowed = new Set(Object.values(FITTED_BODY_REGIONS));
  if (split.mesh.vertices.some(({ region }) => !allowed.has(region)))
    throw new Error('Fitted-body paint emitted a non-body shader region');
  const outputTriangleRegions = triangleRegionDistribution(split.mesh);
  if (Object.keys(outputTriangleRegions).some((key) => key.includes('+')))
    throw new Error('Fitted-body paint retained a mixed-region triangle');
  return {
    mesh: split.mesh,
    fittedBodyPaint: {
      policy: 'dominant quantized four-slot deformation bone; categorical triangle majority; ties choose lower region id',
      source: 'full pinned MakeHuman v1.3.0 anatomy surface; no separate uniform geometry; region-painted feet remain beneath the CC0 shoe shell',
      regionSemantics: {
        0: 'skin: head, jaw, neck, lower arms, wrists and hands',
        1: 'jersey: spine, clavicles, shoulders and upper arms',
        2: 'trousers: root, pelvis, upper legs and lower legs',
        3: 'shoe/foot presentation: feet',
      },
      sourceRegions,
      paintedVertexRegions: regionDistribution(painted),
      sourceTriangleRegions: triangleRegionDistribution(painted),
      outputTriangleRegions,
      sourceSkinRecordSha256,
      paintedSkinRecordSha256,
      classificationSha256: sha256(Buffer.from(JSON.stringify(painted.vertices.map((vertex) => [
        vertex.sourcePositionIndex,
        vertex.sourceTexcoordIndex,
        vertex.region,
      ])))),
      fourSlotSkinRecordsPreservedExactly: true,
      mixedRegionSafety: split.mesh.regionBoundary,
    },
  };
}

const transitionAdd = (left, right) => left.map((value, axis) => value + right[axis]);
const transitionSub = (left, right) => left.map((value, axis) => value - right[axis]);
const transitionMul = (value, scalar) => value.map((component) => component * scalar);
const transitionDot = (left, right) =>
  left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
const transitionCross = (left, right) => [
  left[1] * right[2] - left[2] * right[1],
  left[2] * right[0] - left[0] * right[2],
  left[0] * right[1] - left[1] * right[0],
];
const transitionLength = (value) => Math.hypot(...value);
const transitionNormalize = (value, fallback = [1, 0, 0]) => {
  const length = transitionLength(value);
  return Number.isFinite(length) && length > 1e-9
    ? transitionMul(value, 1 / length)
    : [...fallback];
};

function transitionQuantile(values, quantile) {
  if (!Array.isArray(values) || values.length === 0)
    throw new Error('Fitted-clothing transition quantile has no samples');
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.round(Math.max(0, Math.min(1, quantile)) * (sorted.length - 1))];
}

function transitionPositionKey(position) {
  return position.map((value) => Number(value).toPrecision(12)).join('/');
}

function fittedBoundaryPoints(mesh, firstRegion, secondRegion, predicate) {
  const byPosition = new Map();
  for (const vertex of mesh.vertices) {
    const key = transitionPositionKey(vertex.bindPos);
    const entry = byPosition.get(key) ?? { position: [...vertex.bindPos], regions: new Set(), vertices: [] };
    entry.regions.add(vertex.region);
    entry.vertices.push(vertex);
    byPosition.set(key, entry);
  }
  return [...byPosition.values()]
    .filter((entry) => entry.regions.has(firstRegion) && entry.regions.has(secondRegion) &&
      predicate(entry.position))
    .sort((left, right) => transitionPositionKey(left.position)
      .localeCompare(transitionPositionKey(right.position)));
}

function nearestTransitionSkinSource(vertices, bindPosition) {
  let best = null;
  let bestDistanceSquared = Number.POSITIVE_INFINITY;
  for (const vertex of vertices) {
    const delta = transitionSub(vertex.bindPos, bindPosition);
    const distanceSquared = transitionDot(delta, delta);
    if (distanceSquared < bestDistanceSquared) {
      best = vertex;
      bestDistanceSquared = distanceSquared;
    }
  }
  if (best == null) throw new Error('Fitted-clothing transition has no authored skin source');
  return { vertex: best, distance: Math.sqrt(bestDistanceSquared) };
}

function transitionPointTriangleDistanceSquared(point, a, b, c) {
  const ab = transitionSub(b, a);
  const ac = transitionSub(c, a);
  const ap = transitionSub(point, a);
  const d1 = transitionDot(ab, ap);
  const d2 = transitionDot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return transitionDot(ap, ap);
  const bp = transitionSub(point, b);
  const d3 = transitionDot(ab, bp);
  const d4 = transitionDot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return transitionDot(bp, bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const amount = d1 / (d1 - d3);
    const closest = transitionAdd(a, transitionMul(ab, amount));
    const delta = transitionSub(point, closest);
    return transitionDot(delta, delta);
  }
  const cp = transitionSub(point, c);
  const d5 = transitionDot(ab, cp);
  const d6 = transitionDot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return transitionDot(cp, cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const amount = d2 / (d2 - d6);
    const closest = transitionAdd(a, transitionMul(ac, amount));
    const delta = transitionSub(point, closest);
    return transitionDot(delta, delta);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const edge = transitionSub(c, b);
    const amount = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    const closest = transitionAdd(b, transitionMul(edge, amount));
    const delta = transitionSub(point, closest);
    return transitionDot(delta, delta);
  }
  const denominator = 1 / (va + vb + vc);
  const v = vb * denominator;
  const w = vc * denominator;
  const closest = transitionAdd(a, transitionAdd(transitionMul(ab, v), transitionMul(ac, w)));
  const delta = transitionSub(point, closest);
  return transitionDot(delta, delta);
}

function nearestTransitionBodySurfaceDistance(mesh, bindPosition) {
  let bestDistanceSquared = Number.POSITIVE_INFINITY;
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const a = mesh.vertices[mesh.indices[offset]].bindPos;
    const b = mesh.vertices[mesh.indices[offset + 1]].bindPos;
    const c = mesh.vertices[mesh.indices[offset + 2]].bindPos;
    bestDistanceSquared = Math.min(bestDistanceSquared,
      transitionPointTriangleDistanceSquared(bindPosition, a, b, c));
  }
  return Math.sqrt(bestDistanceSquared);
}

function transitionFeatureBoundary(mesh, feature) {
  if (feature.id === 'collar')
    return fittedBoundaryPoints(mesh, feature.firstRegion, feature.secondRegion,
      ([x, y]) => Math.abs(x) < 0.12 && y > 1.44);
  if (feature.id === 'waist-hem')
    return fittedBoundaryPoints(mesh, feature.firstRegion, feature.secondRegion,
      ([x, y]) => Math.abs(x) < 0.23 && y > 0.78 && y < 1.08);
  if (feature.id === 'left-sleeve-cuff')
    return fittedBoundaryPoints(mesh, feature.firstRegion, feature.secondRegion,
      ([x]) => x < -0.25);
  if (feature.id === 'right-sleeve-cuff')
    return fittedBoundaryPoints(mesh, feature.firstRegion, feature.secondRegion,
      ([x]) => x > 0.25);
  throw new Error(`Unsupported fitted-clothing transition ${feature.id}`);
}

function transitionFrame(mesh, feature, boundary) {
  if (boundary.length < feature.segments)
    throw new Error(`${feature.id} has ${boundary.length} fitted boundary points; expected at least ` +
      feature.segments);
  const points = boundary.map(({ position }) => position);
  const centre = [0, 1, 2].map((axis) =>
    points.reduce((sum, point) => sum + point[axis], 0) / points.length);
  // A median height avoids making the jersey hem follow the source anatomy's
  // jagged dominant-bone classification. The source seam still defines its
  // complete horizontal silhouette and every skin record.
  if (feature.id === 'collar' || feature.id === 'waist-hem') {
    centre[0] = 0;
    centre[1] = transitionQuantile(points.map((point) => point[1]), 0.5);
    const axis = [0, 1, 0];
    const u = [1, 0, 0];
    const v = [0, 0, -1];
    return { centre, axis, u, v };
  }

  const side = feature.id.startsWith('left') ? -1 : 1;
  const distalCandidates = mesh.vertices.filter((vertex) =>
    vertex.region === FITTED_BODY_REGIONS.skin && side * vertex.bindPos[0] > side * centre[0] + 0.025 &&
    vertex.bindPos[1] > 0.90 && vertex.bindPos[1] < 1.34);
  const distal = distalCandidates.length === 0
    ? transitionAdd(centre, [side * 0.12, -0.16, 0.18])
    : [0, 1, 2].map((axis) =>
      distalCandidates.reduce((sum, vertex) => sum + vertex.bindPos[axis], 0) /
        distalCandidates.length);
  const axis = transitionNormalize(transitionSub(distal, centre), [side, -0.5, 0.2]);
  const reference = Math.abs(transitionDot(axis, [0, 1, 0])) < 0.90 ? [0, 1, 0] : [0, 0, 1];
  const u = transitionNormalize(transitionCross(reference, axis), [0, 0, 1]);
  const v = transitionNormalize(transitionCross(axis, u), [0, 1, 0]);
  return { centre, axis, u, v };
}

function transitionBoundaryContour(boundary, frame, segments) {
  const samples = boundary.map((entry) => {
    const delta = transitionSub(entry.position, frame.centre);
    const projectedU = transitionDot(delta, frame.u);
    const projectedV = transitionDot(delta, frame.v);
    let angle = Math.atan2(projectedV, projectedU);
    if (angle < 0) angle += Math.PI * 2;
    return { angle, position: entry.position };
  }).sort((left, right) => left.angle - right.angle ||
    transitionPositionKey(left.position).localeCompare(transitionPositionKey(right.position)));
  if (samples.length < segments)
    throw new Error(`Fitted-clothing contour has ${samples.length} boundary points; expected ${segments}`);

  const contour = [];
  for (let segment = 0; segment < segments; segment++) {
    const target = Math.PI * 2 * segment / segments;
    let rightIndex = samples.findIndex(({ angle }) => angle >= target);
    if (rightIndex < 0) rightIndex = 0;
    const leftIndex = (rightIndex + samples.length - 1) % samples.length;
    const left = samples[leftIndex];
    const right = samples[rightIndex];
    let leftAngle = left.angle;
    let rightAngle = right.angle;
    if (rightIndex === 0) rightAngle += Math.PI * 2;
    let unwrappedTarget = target;
    if (unwrappedTarget < leftAngle) unwrappedTarget += Math.PI * 2;
    const span = rightAngle - leftAngle;
    const amount = span > 1e-9 ? (unwrappedTarget - leftAngle) / span : 0;
    const position = left.position.map((value, axis) =>
      value + (right.position[axis] - value) * amount);
    contour.push(position);
  }
  return contour;
}

function transitionPlanarBodyBoundary(mesh, feature, frame) {
  if (feature.id !== 'collar' && feature.id !== 'waist-hem') return null;
  const intersections = new Map();
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const triangle = mesh.indices.slice(offset, offset + 3)
      .map((index) => mesh.vertices[index].bindPos);
    for (const [leftIndex, rightIndex] of [[0, 1], [1, 2], [2, 0]]) {
      const left = triangle[leftIndex];
      const right = triangle[rightIndex];
      const leftDistance = transitionDot(transitionSub(left, frame.centre), frame.axis);
      const rightDistance = transitionDot(transitionSub(right, frame.centre), frame.axis);
      if ((leftDistance < 0 && rightDistance < 0) ||
          (leftDistance > 0 && rightDistance > 0) ||
          Math.abs(leftDistance - rightDistance) < 1e-10) continue;
      const amount = leftDistance / (leftDistance - rightDistance);
      if (amount < 0 || amount > 1) continue;
      const position = left.map((value, axis) => value + (right[axis] - value) * amount);
      const accepted = feature.id === 'collar'
        ? Math.abs(position[0]) < 0.13 && position[2] > -0.07 && position[2] < 0.11
        : Math.abs(position[0]) < 0.24 && position[2] > -0.16 && position[2] < 0.16;
      if (accepted) intersections.set(transitionPositionKey(position), { position });
    }
  }
  const values = [...intersections.values()];
  if (values.length < feature.segments)
    throw new Error(`${feature.id} body plane has ${values.length} intersections; expected at least ` +
      feature.segments);
  return values;
}

function transitionClosedManifold(indices) {
  const edges = new Map();
  for (let offset = 0; offset < indices.length; offset += 3) {
    for (const [a, b] of [
      [indices[offset], indices[offset + 1]],
      [indices[offset + 1], indices[offset + 2]],
      [indices[offset + 2], indices[offset]],
    ]) {
      const key = a < b ? `${a}/${b}` : `${b}/${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  return edges.size > 0 && [...edges.values()].every((uses) => uses === 2);
}

/**
 * Add only body-derived garment transitions, never another independently
 * skinned uniform. The closed collar, cuff and hem bands follow the actual
 * categorical body seams with millimetre-scale relief and copy one complete
 * authored VPM3 skin record per vertex. They therefore read as cloth edges,
 * not floating wire loops, without opening the shoulders, changing the
 * protected anatomy, or inventing a second deformation rig.
 */
export function buildFittedCricketClothingTransitions(
  mesh,
  policy = FITTED_CRICKET_TRANSITION_POLICY,
) {
  if (!Array.isArray(mesh?.vertices) || !Array.isArray(mesh?.indices) || mesh.indices.length % 3 !== 0)
    throw new Error('Fitted-clothing transition source mesh is malformed');
  if (!mesh.vertices.some(({ region }) => region === FITTED_BODY_REGIONS.jersey))
    throw new Error('Fitted-clothing transition source has no jersey-skinned vertices');
  const vertices = [];
  const indices = [];
  const features = [];
  let syntheticSourceIndex = 1_000_000;
  for (const feature of policy.features) {
    const boundary = transitionFeatureBoundary(mesh, feature);
    const frame = transitionFrame(mesh, feature, boundary);
    const contourBoundary = transitionPlanarBodyBoundary(mesh, feature, frame) ?? boundary;
    const contour = transitionBoundaryContour(contourBoundary, frame, feature.segments);
    const radiusU = Math.max(...contour.map((position) =>
      Math.abs(transitionDot(transitionSub(position, frame.centre), frame.u))));
    const radiusV = Math.max(...contour.map((position) =>
      Math.abs(transitionDot(transitionSub(position, frame.centre), frame.v))));
    const base = vertices.length;
    const bodySourceDistances = [];
    const bodySurfaceDistances = [];
    for (let segment = 0; segment < feature.segments; segment++) {
      const theta = Math.PI * 2 * segment / feature.segments;
      const contourPoint = contour[segment];
      const radial = transitionSub(contourPoint, frame.centre);
      const axialOffset = transitionDot(radial, frame.axis);
      const outward = transitionNormalize(
        transitionSub(radial, transitionMul(frame.axis, axialOffset)),
        transitionAdd(transitionMul(frame.u, Math.cos(theta)),
          transitionMul(frame.v, Math.sin(theta))),
      );
      const centreLine = transitionAdd(contourPoint, transitionMul(outward, feature.standOff));
      for (let crossSegment = 0; crossSegment < policy.crossSectionSegments; crossSegment++) {
        const phi = Math.PI * 2 * crossSegment / policy.crossSectionSegments;
        const cosPhi = Math.cos(phi);
        const sinPhi = Math.sin(phi);
        const bindPos = transitionAdd(centreLine, transitionAdd(
          transitionMul(outward, cosPhi * feature.relief),
          transitionMul(frame.axis, sinPhi * feature.bandHalfWidth),
        ));
        const normal = transitionNormalize(transitionAdd(
          transitionMul(outward, cosPhi), transitionMul(frame.axis, sinPhi)));
        const previous = contour[(segment + contour.length - 1) % contour.length];
        const next = contour[(segment + 1) % contour.length];
        const tangentDirection = transitionNormalize(transitionSub(next, previous));
        const body = nearestTransitionSkinSource(mesh.vertices, bindPos);
        bodySourceDistances.push(body.distance);
        bodySurfaceDistances.push(nearestTransitionBodySurfaceDistance(mesh, bindPos));
        vertices.push({
          position: [...bindPos],
          bindPos: [...bindPos],
          normal,
          tangent: [...tangentDirection, 1],
          uv: [segment / feature.segments, crossSegment / policy.crossSectionSegments],
          region: policy.shaderRegion,
          bones: [...body.vertex.bones],
          weights: [...body.vertex.weights],
          sourcePositionIndex: syntheticSourceIndex,
          sourceTexcoordIndex: syntheticSourceIndex++,
          transitionComponent: feature.id,
        });
      }
    }
    for (let segment = 0; segment < feature.segments; segment++) {
      const next = (segment + 1) % feature.segments;
      for (let crossSegment = 0; crossSegment < policy.crossSectionSegments; crossSegment++) {
        const nextCross = (crossSegment + 1) % policy.crossSectionSegments;
        const a = base + segment * policy.crossSectionSegments + crossSegment;
        const b = base + next * policy.crossSectionSegments + crossSegment;
        const c = base + next * policy.crossSectionSegments + nextCross;
        const d = base + segment * policy.crossSectionSegments + nextCross;
        indices.push(a, b, c, a, c, d);
      }
    }
    features.push({
      id: feature.id,
      boundaryPoints: boundary.length,
      contourPoints: contourBoundary.length,
      segments: feature.segments,
      crossSectionSegments: policy.crossSectionSegments,
      centre: frame.centre,
      axis: frame.axis,
      radiusU,
      radiusV,
      bandHalfWidth: feature.bandHalfWidth,
      relief: feature.relief,
      standOff: feature.standOff,
      vertexCount: feature.segments * policy.crossSectionSegments,
      triangleCount: feature.segments * policy.crossSectionSegments * 2,
      maximumBodySourceDistance: Math.max(...bodySourceDistances),
      p95BodySourceDistance: transitionQuantile(bodySourceDistances, 0.95),
      maximumBodySurfaceDistance: Math.max(...bodySurfaceDistances),
      p95BodySurfaceDistance: transitionQuantile(bodySurfaceDistances, 0.95),
      sourceBindPositions: vertices.slice(base).map((vertex) =>
        Array.from(Float32Array.from(vertex.bindPos))),
    });
  }
  if (vertices.length !== policy.expectedVertices || indices.length / 3 !== policy.expectedTriangles)
    throw new Error(`Fitted-clothing transitions emitted ${vertices.length} vertices and ` +
      `${indices.length / 3} triangles; expected ${policy.expectedVertices}/${policy.expectedTriangles}`);
  if (!transitionClosedManifold(indices))
    throw new Error('Fitted-clothing transition geometry is not a closed two-manifold');
  if (vertices.some((vertex) => vertex.region !== policy.shaderRegion ||
      vertex.weights.reduce((sum, weight) => sum + weight, 0) !== 255 ||
      vertex.position.some((value, axis) => value !== vertex.bindPos[axis])))
    throw new Error('Fitted-clothing transitions changed region, bind position or authored skin integrity');
  return {
    mesh: { vertices, indices },
    evidence: {
      policy: policy.version,
      construction: policy.construction,
      shaderRegion: policy.shaderRegion,
      vertexCount: vertices.length,
      triangleCount: indices.length / 3,
      closedTwoManifold: true,
      bodyGeometryMutated: false,
      features,
    },
  };
}

function transitionFloatPositionKey(position) {
  return Array.from(Float32Array.from(position), (value) => value.toPrecision(9)).join('/');
}

/** Verify the authored cloth-edge components survive the actual simplified and encoded mesh. */
export function assessFittedCricketTransitionSurvival(mesh, transitionMesh) {
  if (!Array.isArray(mesh?.vertices) || !Array.isArray(mesh?.indices) || mesh.indices.length % 3 !== 0)
    throw new Error('Fitted-clothing survival mesh is malformed');
  const sourceByPosition = new Map();
  for (const vertex of transitionMesh.vertices) {
    const key = transitionFloatPositionKey(vertex.bindPos);
    if (sourceByPosition.has(key))
      throw new Error(`Fitted-clothing transition position ${key} is not unique`);
    sourceByPosition.set(key, {
      component: vertex.transitionComponent,
      bindPos: Array.from(Float32Array.from(vertex.bindPos)),
    });
  }
  const outputComponents = mesh.vertices.map((vertex) =>
    sourceByPosition.get(transitionFloatPositionKey(vertex.bindPos))?.component ?? null);
  const positionsByComponent = new Map();
  for (let index = 0; index < outputComponents.length; index++) {
    const component = outputComponents[index];
    if (component == null) continue;
    const source = sourceByPosition.get(transitionFloatPositionKey(mesh.vertices[index].bindPos));
    const values = positionsByComponent.get(component) ?? [];
    values.push(source.bindPos);
    positionsByComponent.set(component, values);
  }
  const trianglesByComponent = new Map();
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const components = mesh.indices.slice(offset, offset + 3).map((index) => outputComponents[index]);
    if (components[0] == null || components.some((value) => value !== components[0])) continue;
    trianglesByComponent.set(components[0], (trianglesByComponent.get(components[0]) ?? 0) + 1);
  }
  return FITTED_CRICKET_TRANSITION_POLICY.features.map((feature) => {
    const positions = positionsByComponent.get(feature.id) ?? [];
    const bounds = [0, 1, 2].map((axis) => positions.length === 0
      ? [null, null]
      : [Math.min(...positions.map((position) => position[axis])),
        Math.max(...positions.map((position) => position[axis]))]);
    const extents = bounds.map(([minimum, maximum]) => minimum == null ? 0 : maximum - minimum);
    return {
      id: feature.id,
      sourceVertices: feature.segments * FITTED_CRICKET_TRANSITION_POLICY.crossSectionSegments,
      sourceTriangles: feature.segments * FITTED_CRICKET_TRANSITION_POLICY.crossSectionSegments * 2,
      retainedVertices: positions.length,
      retainedTriangles: trianglesByComponent.get(feature.id) ?? 0,
      bounds,
      extents,
      nonDegenerateAxes: extents.filter((extent) => extent > 0.001).length,
    };
  });
}

export function decodeVpm3(bytes) {
  const header = parseVpm3Header(bytes);
  let offset = VPM3_HEADER_BYTES;
  const readVector = (count) => {
    const value = [];
    for (let index = 0; index < count; index++, offset += 4) value.push(bytes.readFloatLE(offset));
    return value;
  };
  const vertices = [];
  for (let index = 0; index < header.vertexCount; index++) {
    const position = readVector(3);
    const normal = readVector(3);
    const tangent = readVector(4);
    const bindPos = readVector(3);
    const uv = readVector(2);
    const region = bytes.readUInt8(offset++);
    const bones = Array.from({ length: 4 }, () => bytes.readUInt8(offset++));
    const weights = Array.from({ length: 4 }, () => bytes.readUInt8(offset++));
    if (bytes.readUInt8(offset++) !== 0 || bytes.readUInt8(offset++) !== 0 || bytes.readUInt8(offset++) !== 0)
      throw new Error('VPM3 reserved vertex bytes must be zero');
    vertices.push({ position, normal, tangent, bindPos, uv, region, bones, weights });
  }
  const indices = [];
  for (let index = 0; index < header.indexCount; index++, offset += 2) indices.push(bytes.readUInt16LE(offset));
  if (offset !== bytes.length) throw new Error('VPM3 decoder length mismatch');
  return { header, vertices, indices };
}

export function combineMeshes(meshes) {
  const vertices = [];
  const indices = [];
  for (const mesh of meshes) {
    const base = vertices.length;
    for (const vertex of mesh.vertices) {
      vertices.push({
        ...vertex,
        position: [...vertex.position], normal: [...vertex.normal], tangent: [...vertex.tangent],
        bindPos: [...vertex.bindPos], uv: [...vertex.uv], bones: [...vertex.bones], weights: [...vertex.weights],
      });
    }
    for (const index of mesh.indices) indices.push(index + base);
  }
  if (vertices.length > 65_535) throw new Error(`Combined hero has ${vertices.length} vertices; UInt16 limit exceeded`);
  return { vertices, indices };
}

function selectedEntry(entries, stem, suffix) {
  const matches = [...entries.entries()].filter(([name]) =>
    name.toLowerCase().includes(stem.toLowerCase()) && name.toLowerCase().endsWith(suffix));
  matches.sort(([left], [right]) => left.length - right.length || left.localeCompare(right));
  if (matches.length === 0) throw new Error(`No ${suffix} entry exists for ${stem}`);
  return { name: matches[0][0], bytes: matches[0][1] };
}

function optionalSelectedEntry(entries, stem, suffix) {
  try { return selectedEntry(entries, stem, suffix); }
  catch (error) {
    if (error?.message === `No ${suffix} entry exists for ${stem}`) return null;
    throw error;
  }
}

function pinnedExactEntry(entries, descriptor) {
  const bytes = entries.get(descriptor.archiveEntry);
  if (bytes == null) throw new Error(`Pinned archive member ${descriptor.archiveEntry} is absent`);
  const digest = sha256(bytes);
  if (digest !== descriptor.sha256)
    throw new Error(`Pinned archive member ${descriptor.archiveEntry} SHA-256 ${digest} does not match ` +
      descriptor.sha256);
  return { name: descriptor.archiveEntry, bytes, sha256: digest };
}

function regionDistribution(mesh) {
  const result = {};
  for (const vertex of mesh.vertices) result[vertex.region] = (result[vertex.region] ?? 0) + 1;
  return result;
}

function triangleRegionDistribution(mesh) {
  const result = {};
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const regions = [...new Set(mesh.indices.slice(offset, offset + 3)
      .map((index) => mesh.vertices[index].region))].sort((left, right) => left - right);
    const key = regions.join('+');
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

function validateProtectedVertexPreservation(before, after) {
  const indices = before.protectedOutputVertexIndices ?? [];
  if (indices.length !== HERO_FACE_LOD1_POLICY.expectedLockedVertices ||
      new Set(indices).size !== indices.length)
    throw new Error(`Protected-face compact vertex count is ${indices.length}; expected ` +
      `${HERO_FACE_LOD1_POLICY.expectedLockedVertices}`);
  let maximumPositionDriftMetres = 0;
  let maximumBindPositionDriftMetres = 0;
  let maximumUvDrift = 0;
  let maximumNormalComponentDrift = 0;
  let maximumTangentComponentDrift = 0;
  const finalRecords = [];
  for (const index of indices) {
    const source = before.vertices[index];
    const output = after.vertices[index];
    if (source == null || output == null) throw new Error(`Protected-face compact vertex ${index} is absent`);
    maximumPositionDriftMetres = Math.max(maximumPositionDriftMetres,
      ...source.position.map((value, axis) => Math.abs(value - output.position[axis])));
    maximumBindPositionDriftMetres = Math.max(maximumBindPositionDriftMetres,
      ...source.bindPos.map((value, axis) => Math.abs(value - output.bindPos[axis])));
    maximumUvDrift = Math.max(maximumUvDrift,
      ...source.uv.map((value, axis) => Math.abs(value - output.uv[axis])));
    maximumNormalComponentDrift = Math.max(maximumNormalComponentDrift,
      ...source.normal.map((value, axis) => Math.abs(value - output.normal[axis])));
    maximumTangentComponentDrift = Math.max(maximumTangentComponentDrift,
      ...source.tangent.map((value, axis) => Math.abs(value - output.tangent[axis])));
    if (source.region !== output.region) throw new Error(`Protected-face compact vertex ${index} changed region`);
    if (source.bones.some((value, slot) => value !== output.bones[slot]) ||
        source.weights.some((value, slot) => value !== output.weights[slot]))
      throw new Error(`Protected-face compact vertex ${index} changed its four-slot skin record`);
    finalRecords.push({
      compactIndex: index,
      position: output.position,
      bindPos: output.bindPos,
      uv: output.uv,
      normal: output.normal,
      tangent: output.tangent,
      region: output.region,
      bones: output.bones,
      weights: output.weights,
    });
  }
  if (maximumPositionDriftMetres !== 0 || maximumBindPositionDriftMetres !== 0 || maximumUvDrift !== 0 ||
      maximumNormalComponentDrift !== 0 || maximumTangentComponentDrift !== 0)
    throw new Error('Protected-face vertex records drifted after simplification');
  const finalVertexIdentitySha256 = sha256(Buffer.from(JSON.stringify(finalRecords)));
  if (finalVertexIdentitySha256 !== HERO_FACE_LOD1_POLICY.expectedFinalVertexIdentitySha256)
    throw new Error(`Protected-face final vertex identity ${finalVertexIdentitySha256} changed from ` +
      HERO_FACE_LOD1_POLICY.expectedFinalVertexIdentitySha256);
  return {
    protectedVertices: indices.length,
    maximumPositionDriftMetres,
    maximumBindPositionDriftMetres,
    maximumUvDrift,
    maximumNormalComponentDrift,
    maximumTangentComponentDrift,
    fourSlotSkinRecordsExact: true,
    finalVertexIdentitySha256,
  };
}

export async function exportProductionHeroBundle({
  sourceDir = DEFAULT_V3_SOURCE_DIR,
  archivePath = DEFAULT_KIT_ARCHIVE,
  motionSourceDir = DEFAULT_MOTION_SOURCE_DIR,
  outputDir = DEFAULT_HERO_BUNDLE_OUTPUT_DIR,
} = {}) {
  const [bodyBytes, skeletonSourceBytes, weightsBytes, archiveBytes] = await Promise.all([
    readFile(join(sourceDir, V3_PINNED_SOURCES.mesh.localName)),
    readFile(join(sourceDir, V3_PINNED_SOURCES.skeleton.localName)),
    readFile(join(sourceDir, V3_PINNED_SOURCES.weights.localName)),
    readFile(archivePath),
  ]);
  for (const [label, bytes] of [['mesh', bodyBytes], ['skeleton', skeletonSourceBytes], ['weights', weightsBytes]]) {
    if (sha256(bytes) !== V3_PINNED_SOURCES[label].sha256)
      throw new Error(`${label} source does not match its pinned SHA-256`);
  }
  if (sha256(archiveBytes) !== SYSTEM_ASSET_ARCHIVE_SHA256)
    throw new Error('MakeHuman CC0 system asset archive does not match its pinned SHA-256');

  const body = parseObj(bodyBytes.toString('utf8'), { includeGroup: 'body' });
  const skeletonSource = JSON.parse(skeletonSourceBytes.toString('utf8'));
  const sourceWeights = JSON.parse(weightsBytes.toString('utf8'));
  const coordinateTransform = makeCoordinateTransform(body);
  const skeletonBones = mapCanonicalHipsToRoot(
    buildV3Skeleton(skeletonSource, body.positions, coordinateTransform),
  );
  const skeletonBytes = encodeVsk1(skeletonBones);
  const skeletonHeader = parseVsk1(skeletonBytes);
  const skeletonId = skeletonBytes.subarray(16, 24);

  const entries = await readSelectedZipEntries(archivePath, HERO_ARCHIVE_SELECTION);
  const eyeSources = Object.fromEntries(Object.entries(HERO_EYES.sources).map(([kind, descriptor]) =>
    [kind, pinnedExactEntry(entries, descriptor)]));
  const eyeObject = parseObj(eyeSources.object.bytes.toString('utf8'));
  const eyeMappings = parseMhcloVertexMap(eyeSources.transfer.bytes.toString('utf8'));
  if (eyeMappings.length !== HERO_EYES.vertexCount || eyeObject.positions.length !== HERO_EYES.vertexCount)
    throw new Error('Pinned hero eyes do not retain their exact 96-position topology');
  for (let index = 0; index < eyeMappings.length; index++) {
    const mapping = eyeMappings[index];
    if (mapping.indices.length !== 1 || mapping.weights.length !== 1 || mapping.weights[0] !== 1)
      throw new Error(`Pinned hero eye vertex ${index} is not a direct base-body mapping`);
    const source = body.positions[mapping.indices[0]];
    const candidate = eyeObject.positions[index];
    if (source == null || candidate.some((value, axis) => value !== source[axis]))
      throw new Error(`Pinned hero eye vertex ${index} no longer equals its mapped base-body vertex`);
  }
  const baseWeightMaps = sourceWeightMaps(sourceWeights, skeletonSource, body.positions.length);
  const eyeMesh = buildKitMesh(
    eyeObject,
    transferMappedWeights(baseWeightMaps, eyeMappings),
    coordinateTransform,
    HERO_EYES.shaderRegion,
  );
  if (eyeMesh.vertices.length !== HERO_EYES.vertexCount ||
      eyeMesh.indices.length / 3 !== HERO_EYES.triangleCount)
    throw new Error('Pinned hero eyes do not retain their protected 96-vertex/172-triangle contract');
  if (eyeMesh.vertices.some((vertex) => vertex.region !== HERO_EYES.shaderRegion ||
      vertex.bones[0] !== HERO_EYES.headBone || vertex.weights[0] !== 255 ||
      vertex.weights.slice(1).some((weight) => weight !== 0)))
    throw new Error('Pinned hero eyes are not rigidly transferred to the retained VSK1 head bone');
  const eyeBytes = encodeVpm3(eyeMesh, skeletonId);
  const eyeHeader = parseVpm3Header(eyeBytes);
  const eyeDigest = sha256(eyeBytes);
  if (eyeHeader.skeletonId !== skeletonHeader.skeletonId || eyeDigest !== HERO_EYES.meshSha256)
    throw new Error('Pinned hero-eye VPM3 identity or deterministic SHA-256 changed');
  const kitSources = [];
  for (const descriptor of HERO_RENDERED_KIT_SELECTION) {
    const object = selectedEntry(entries, descriptor.stem, '.obj');
    const transfer = selectedEntry(entries, descriptor.stem, '.mhclo');
    const material = optionalSelectedEntry(entries, descriptor.stem, '.mhmat');
    kitSources.push({
      id: descriptor.id,
      shaderRegion: descriptor.region,
      license: 'CC0-1.0',
      normalPolicy: 'area-weighted garment normals weld original OBJ position identity across UV seams and retain that identity through kit simplification',
      object: { archiveEntry: object.name, sha256: sha256(object.bytes) },
      transfer: { archiveEntry: transfer.name, sha256: sha256(transfer.bytes) },
      material: material == null
        ? null
        : { archiveEntry: material.name, sha256: sha256(material.bytes) },
      textures: [...entries.entries()]
        .filter(([name]) => name.toLowerCase().includes(descriptor.stem.toLowerCase()) &&
          /\.(png|jpe?g)$/i.test(name))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([archiveEntry, bytes]) => ({ archiveEntry, sha256: sha256(bytes) })),
    });
  }

  await MeshoptSimplifier.ready;
  const bodyHigh = buildV3HighMesh(body, skeletonSource, sourceWeights, coordinateTransform);
  const bodyLow = buildLowMesh(bodyHigh, 4_000);
  const fittedHigh = buildFittedBodyCricketKitMesh(bodyHigh);
  const fittedLow = buildFittedBodyCricketKitMesh(bodyLow);
  const fittedClothingTransitions = buildFittedCricketClothingTransitions(fittedHigh.mesh);
  const fittedClothingTransitionSummary = {
    ...fittedClothingTransitions.evidence,
    features: fittedClothingTransitions.evidence.features.map(({ sourceBindPositions: _positions, ...feature }) =>
      feature),
  };

  const workingDir = await mkdtemp(join(tmpdir(), 'vande-hero-bundle-work-'));
  try {
    const workingSkeleton = join(workingDir, 'hero-skeleton.bytes');
    const kitDir = join(workingDir, 'kit');
    const gearDir = join(workingDir, 'gear');
    const motionDir = join(workingDir, 'motion');
    await writeFile(workingSkeleton, skeletonBytes);
    const kitExport = await exportProductionKit({
      archivePath,
      sourceDir,
      outputDir: kitDir,
      skeletonPath: workingSkeleton,
      selection: HERO_RENDERED_KIT_SELECTION,
    });
    if (kitExport.source.archiveSha256 !== SYSTEM_ASSET_ARCHIVE_SHA256 ||
        kitExport.source.license !== 'CC0-1.0')
      throw new Error('Generic-kit export did not preserve the pinned CC0 source contract');
    const gearExport = await exportProductionCricketGear({
      skeletonPath: workingSkeleton,
      outputDir: gearDir,
    });
    const motionExport = await exportProductionMotion({
      sourceDir: motionSourceDir,
      outputDir: motionDir,
      clipIds: HERO_BUNDLE_MOTIONS.map(({ id }) => id),
    });

    await mkdir(outputDir, { recursive: true });
    await writeIfChanged(join(outputDir, 'hero-skeleton.bytes'), skeletonBytes);
    await writeIfChanged(join(outputDir, HERO_EYES.fileName), eyeBytes);
    const outputs = [];
    for (const profile of HERO_BUNDLE_LODS) {
      const kitMeshes = [];
      const kitTriangleCounts = {};
      for (const descriptor of HERO_RENDERED_KIT_SELECTION) {
        const decoded = decodeVpm3(await readFile(join(kitDir, `${descriptor.id}-lod${profile.kit}.bytes`)));
        if (decoded.header.skeletonId !== skeletonHeader.skeletonId)
          throw new Error(`${descriptor.id} LOD${profile.kit} skeleton identity mismatch`);
        kitMeshes.push(decoded);
        kitTriangleCounts[descriptor.id] = decoded.indices.length / 3;
      }
      const fittedBody = profile.body === 'high' ? fittedHigh : fittedLow;
      const bodyMesh = fittedBody.mesh;
      const unsimplified = combineMeshes([bodyMesh, fittedClothingTransitions.mesh, ...kitMeshes]);
      let faceProtection = null;
      if (profile.lod === 1) {
        for (const [id, expected] of Object.entries(HERO_FACE_LOD1_POLICY.expectedKitTriangles)) {
          if (kitTriangleCounts[id] !== expected)
            throw new Error(`Face-protected kit ${id} has ${kitTriangleCounts[id]} triangles; expected ${expected}`);
        }
        const combinedKitTriangles = Object.values(kitTriangleCounts).reduce((sum, value) => sum + value, 0);
        const expectedKitTriangles = Object.values(HERO_FACE_LOD1_POLICY.expectedKitTriangles)
          .reduce((sum, value) => sum + value, 0);
        if (combinedKitTriangles !== expectedKitTriangles)
          throw new Error(`Face-protected kit has ${combinedKitTriangles} triangles; expected ` +
            expectedKitTriangles);
        if (unsimplified.indices.length / 3 !== HERO_FACE_LOD1_POLICY.expectedCombinedSourceTriangles)
          throw new Error(`Face-protected combined source has ${unsimplified.indices.length / 3} triangles; ` +
            `expected ${HERO_FACE_LOD1_POLICY.expectedCombinedSourceTriangles}`);
        faceProtection = buildProtectedFaceLock(unsimplified);
        if (faceProtection.metrics.sourceTriangleIdentitySha256 !==
            HERO_FACE_LOD1_POLICY.expectedSourceTriangleIdentitySha256 ||
            faceProtection.metrics.sourceVertexIdentitySha256 !==
            HERO_FACE_LOD1_POLICY.expectedSourceVertexIdentitySha256)
          throw new Error('Face-protected source topology or immutable vertex records changed: ' +
            `triangles ${faceProtection.metrics.sourceTriangleIdentitySha256}; ` +
            `vertices ${faceProtection.metrics.sourceVertexIdentitySha256}`);
      }
      const regionSplit = splitMixedTriangleRegions(unsimplified, faceProtection);
      const geometry = profile.lod === 0
        ? regionSplit.mesh
        : simplifyCombinedHeroMesh(
          regionSplit.mesh,
          profile.maximumTriangles,
          profile.maximumRelativeError ?? LIVE_SIMPLIFICATION_ERROR_LIMIT,
          regionSplit.protection,
        );
      let combined = geometry;
      if (profile.lod === 1) {
        if (geometry.simplification.observedRelativeError !==
            HERO_FACE_LOD1_POLICY.expectedObservedRelativeError)
          throw new Error(`Face-protected LOD1 observed error ${geometry.simplification.observedRelativeError}; ` +
            `expected ${HERO_FACE_LOD1_POLICY.expectedObservedRelativeError}`);
        const vertexPreservation = validateProtectedVertexPreservation(geometry, combined);
        combined = {
          ...combined,
          simplification: {
            ...combined.simplification,
            protection: { ...combined.simplification.protection, vertexPreservation },
          },
        };
      }
      const triangleCount = combined.indices.length / 3;
      if (triangleCount > profile.maximumTriangles)
        throw new Error(`Hero LOD${profile.lod} has ${triangleCount} triangles; budget ${profile.maximumTriangles}`);
      const triangleRegions = triangleRegionDistribution(combined);
      if (profile.lod === 1) {
        if (triangleCount !== HERO_FACE_LOD1_POLICY.expectedOutputTriangles)
          throw new Error(`Face-protected LOD1 has ${triangleCount} triangles; expected ` +
            `${HERO_FACE_LOD1_POLICY.expectedOutputTriangles}`);
        if (profile.maximumTriangles !== HERO_FACE_LOD1_POLICY.maximumOutputTriangles ||
            profile.maximumTriangles - triangleCount !== HERO_FACE_LOD1_POLICY.intentionalUnusedTriangleHeadroom)
          throw new Error('Face-protected LOD1 does not preserve its intentional one-triangle headroom');
        const expectedRegions = HERO_FACE_LOD1_POLICY.expectedOutputTrianglesByRegion;
        const keys = new Set([...Object.keys(expectedRegions), ...Object.keys(triangleRegions)]);
        for (const key of keys) {
          if ((triangleRegions[key] ?? 0) !== (expectedRegions[key] ?? 0))
            throw new Error(`Face-protected LOD1 region ${key} has ${triangleRegions[key] ?? 0} triangles; ` +
              `expected ${expectedRegions[key] ?? 0}; observed distribution ` +
              `${JSON.stringify(triangleRegions)}`);
        }
      }
      const remainingCoveredBodyTriangles = 0;
      const transitionSurvival = assessFittedCricketTransitionSurvival(
        combined,
        fittedClothingTransitions.mesh,
      );
      const bytes = encodeVpm3(combined, skeletonId);
      const header = parseVpm3Header(bytes);
      const outputSha256 = sha256(bytes);
      const encodedTransitionSurvival = assessFittedCricketTransitionSurvival(
        decodeVpm3(bytes),
        fittedClothingTransitions.mesh,
      );
      if (JSON.stringify(encodedTransitionSurvival) !== JSON.stringify(transitionSurvival))
        throw new Error(`Hero LOD${profile.lod} encoded clothing-transition survival differs from source`);
      if (profile.lod === 1) {
        for (const feature of encodedTransitionSurvival) {
          const minimumVertices = Math.ceil(feature.sourceVertices *
            FITTED_CRICKET_TRANSITION_POLICY.minimumLiveRetainedVertexFraction);
          const minimumTriangles = Math.ceil(feature.sourceTriangles *
            FITTED_CRICKET_TRANSITION_POLICY.minimumLiveRetainedTriangleFraction);
          if (feature.retainedVertices < minimumVertices ||
              feature.retainedTriangles < minimumTriangles ||
              feature.nonDegenerateAxes < FITTED_CRICKET_TRANSITION_POLICY.minimumLiveNonDegenerateAxes)
            throw new Error(`Face-protected LOD1 lost fitted-clothing ${feature.id}: ` +
              `${feature.retainedVertices}/${feature.sourceVertices} vertices, ` +
              `${feature.retainedTriangles}/${feature.sourceTriangles} triangles, ` +
              `${feature.nonDegenerateAxes} non-degenerate axes`);
        }
      }
      if (profile.lod === 1 && (header.vertexCount !== HERO_FACE_LOD1_POLICY.expectedOutputVertices ||
          bytes.length !== HERO_FACE_LOD1_POLICY.expectedOutputBytes ||
          outputSha256 !== HERO_FACE_LOD1_POLICY.expectedOutputSha256))
        throw new Error(`Face-protected LOD1 binary identity changed: vertices ${header.vertexCount}, ` +
          `bytes ${bytes.length}, sha256 ${outputSha256}`);
      const fileName = `hero-lod${profile.lod}.bytes`;
      await writeIfChanged(join(outputDir, fileName), bytes);
      outputs.push({
        ...profile,
        fileName,
        bytes: bytes.length,
        sha256: outputSha256,
        vertexCount: header.vertexCount,
        triangleCount,
        regions: regionDistribution(combined),
        triangleRegions,
        regionBoundary: combined.regionBoundary ?? combined.simplification?.regionBoundary ?? null,
        kitTriangleCounts,
        simplification: combined.simplification ?? null,
        influencePolicy: {
          encodedSlots: 4,
          maximumNonZeroInfluences: 4,
          observedMaximumNonZeroInfluences: maximumNonZeroInfluences(combined),
          reduction: 'none',
        },
        fittedBodyPaint: fittedBody.fittedBodyPaint,
        fittedClothingTransitions: fittedClothingTransitionSummary,
        fittedClothingTransitionSurvival: encodedTransitionSurvival,
        removedBodyTriangles: 0,
        remainingCoveredBodyTriangles,
      });
    }

    const eyeTextureBytes = await sharp(eyeSources.albedo.bytes)
      .removeAlpha()
      .resize(256, 256, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
      .toBuffer();
    const eyeTextureMetadata = await sharp(eyeTextureBytes).metadata();
    if (eyeTextureMetadata.width !== 256 || eyeTextureMetadata.height !== 256 ||
        eyeTextureMetadata.channels !== 3 || eyeTextureMetadata.hasAlpha ||
        sha256(eyeTextureBytes) !== HERO_EYES.textureSha256)
      throw new Error('Hero-eye albedo derivative violates its deterministic 256x256 RGB contract');
    await writeIfChanged(join(outputDir, HERO_EYES.textureFileName), eyeTextureBytes);

    const skinSource = selectedEntry(entries, DARK_SKIN_STEM, '.png');
    if (sha256(skinSource.bytes) !== DARK_SKIN_SOURCE_SHA256)
      throw new Error('Pinned dark-skin source does not match its SHA-256');
    const renderSkin = (size) => sharp(skinSource.bytes)
      .resize(size, size, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
      .toBuffer();
    const [skinBytes, liveSkinBytes] = await Promise.all([renderSkin(1024), renderSkin(512)]);
    const skinMetadata = await sharp(skinBytes).metadata();
    if (skinMetadata.width !== 1024 || skinMetadata.height !== 1024)
      throw new Error('Hero skin derivative is not 1024 × 1024');
    const skinFileName = 'hero-skin-albedo-1024.png';
    await writeIfChanged(join(outputDir, skinFileName), skinBytes);
    const liveSkinMetadata = await sharp(liveSkinBytes).metadata();
    if (liveSkinMetadata.width !== 512 || liveSkinMetadata.height !== 512)
      throw new Error('Live hero skin derivative is not 512 × 512');
    const liveSkinFileName = 'hero-skin-albedo-512.png';
    await writeIfChanged(join(outputDir, liveSkinFileName), liveSkinBytes);

    // Preserve the equipment export bytes exactly. The runtime admits this complete family atomically, so a
    // VPM3/VBT1 validation or identity failure aborts before any final resource is updated.
    const equipment = [];
    for (const profile of HERO_BUNDLE_GEAR) {
      const source = gearExport.outputs.find(({ detail }) => detail === profile.detail);
      if (source == null) throw new Error(`Gear export omitted ${profile.detail}`);

      const gearBytes = await readFile(source.gear.path);
      const gearHeader = parseVpm3Header(gearBytes);
      const gearHash = sha256(gearBytes);
      if (gearHeader.skeletonId !== skeletonHeader.skeletonId)
        throw new Error(`${profile.detail} gear skeleton identity mismatch`);
      if (gearHeader.indexCount / 3 > GEAR_TRIANGLE_BUDGETS[profile.detail])
        throw new Error(`${profile.detail} gear exceeds its triangle budget`);
      if (gearHash !== source.gear.sha256)
        throw new Error(`${profile.detail} gear hash changed after export`);
      const gearFileName = `hero-gear-lod${profile.gearLod}.bytes`;
      await writeIfChanged(join(outputDir, gearFileName), gearBytes);

      const batBytes = await readFile(source.bat.path);
      const batHeader = parseVbt1Header(batBytes);
      const batHash = sha256(batBytes);
      if (batHeader.triangleCount > BAT_TRIANGLE_BUDGETS[profile.detail])
        throw new Error(`${profile.detail} bat exceeds its triangle budget`);
      if (batHash !== source.bat.sha256)
        throw new Error(`${profile.detail} bat hash changed after export`);
      const batFileName = `hero-bat-lod${profile.batLod}.bytes`;
      await writeIfChanged(join(outputDir, batFileName), batBytes);

      equipment.push({
        detail: profile.detail,
        gear: {
          fileName: gearFileName,
          format: 'VPM3',
          bytes: gearBytes.length,
          sha256: gearHash,
          sourceOutputSha256: source.gear.sha256,
          skeletonId: gearHeader.skeletonId,
          vertexCount: gearHeader.vertexCount,
          triangleCount: gearHeader.indexCount / 3,
          maximumTriangles: GEAR_TRIANGLE_BUDGETS[profile.detail],
          preservedByteIdentity: true,
        },
        bat: {
          fileName: batFileName,
          format: 'VBT1',
          bytes: batBytes.length,
          sha256: batHash,
          sourceOutputSha256: source.bat.sha256,
          vertexCount: batHeader.vertexCount,
          triangleCount: batHeader.triangleCount,
          maximumTriangles: BAT_TRIANGLE_BUDGETS[profile.detail],
          preservedByteIdentity: true,
        },
      });
    }

    const motionById = new Map(motionExport.results.map((value) => [value.id, value]));
    const motions = [];
    for (const mapping of HERO_BUNDLE_MOTIONS) {
      const source = motionById.get(mapping.id);
      const clip = CLIPS.find(({ id }) => id === mapping.id);
      if (source == null || clip == null) throw new Error(`Motion export omitted ${mapping.id}`);
      const bytes = await readFile(source.outputPath);
      const header = decodeVmaHeader(bytes);
      const digest = sha256(bytes);
      if (digest !== source.outputSha256)
        throw new Error(`${mapping.id} hash changed after export`);
      if (!header.rootLocked || header.sampleRate !== 60 || header.boneCount !== 29)
        throw new Error(`${mapping.id} violates the VMA1 runtime contract`);
      await writeIfChanged(join(outputDir, mapping.fileName), bytes);
      motions.push({
        id: mapping.id,
        role: mapping.role,
        fileName: mapping.fileName,
        format: 'VMA1',
        bytes: bytes.length,
        sha256: digest,
        sourceOutputSha256: source.outputSha256,
        sourceSkeleton: clip.skeleton,
        sourceSkeletonSha256: clip.sourceSkeletonSha256,
        sourceMotion: clip.motion,
        sourceMotionSha256: clip.sourceMotionSha256,
        sourceDescription: clip.sourceDescription,
        sampleRate: header.sampleRate,
        boneCount: header.boneCount,
        frameCount: header.frameCount,
        durationMs: header.durationMs,
        rootLocked: header.rootLocked,
        preservedByteIdentity: true,
        acceptance: 'TECHNICAL REFERENCE ONLY / CRICKET AUTHENTICITY UNPROVEN',
      });
    }

    const manifest = {
      status: 'TECHNICAL HERO FOUNDATION / NOT PLAYER-FACING ACCEPTED',
      generatedAtUtc: new Date(0).toISOString(),
      format: 'VSK1 skeleton + one combined body/kit VPM3 per LOD + one shared protected eye VPM3',
      source: {
        makeHumanVersion: '1.3.0',
        repository: UPSTREAM.repository,
        tag: UPSTREAM.tag,
        commit: UPSTREAM.commit,
        coreAssetLicense: 'CC0-1.0',
        pinnedCoreFiles: Object.fromEntries(Object.entries(V3_PINNED_SOURCES).map(([kind, descriptor]) => [kind, {
          localName: descriptor.localName,
          upstreamPath: UPSTREAM.sourceFiles[kind].upstreamPath,
          sha256: descriptor.sha256,
          rawUrl: `${UPSTREAM.repository}/raw/${UPSTREAM.commit}/${UPSTREAM.sourceFiles[kind].upstreamPath}`,
        }])),
        systemAssetPack: {
          url: SYSTEM_ASSET_PACK_URL,
          archive: basename(archivePath),
          archiveBytes: archiveBytes.length,
          archiveSha256: SYSTEM_ASSET_ARCHIVE_SHA256,
          license: 'CC0-1.0',
          officialLicensePage: 'https://www.makehumancommunity.org/about/license.html',
          selectedKitEntries: kitSources,
          notRenderedKitEntries: [
            { id: 'uniform', stem: 'male_casualsuit06', reason: 'replaced by fitted region paint on the authored anatomy surface' },
          ],
          selectedEyeEntries: Object.fromEntries(Object.entries(eyeSources).map(([kind, value]) => [kind, {
            archiveEntry: value.name,
            sha256: value.sha256,
          }])),
        },
        archivedExactTerms: [
          { path: 'docs/licenses/makehuman-v1.3.0/LICENSE.md', sha256: UPSTREAM.sourceFiles.licenseSummary.sha256 },
          { path: 'docs/licenses/makehuman-v1.3.0/LICENSE.ASSETS.md', sha256: UPSTREAM.sourceFiles.licenseAssets.sha256 },
        ],
      },
      skeleton: {
        fileName: 'hero-skeleton.bytes',
        bytes: skeletonBytes.length,
        sha256: sha256(skeletonBytes),
        skeletonId: skeletonHeader.skeletonId,
      },
      bodyCoverage: {
        deletionPolicy: 'none: retain the complete pinned anatomy surface; do not apply garment delete_verts',
        retainedBodyRegionPolicy: 'paint the complete authored body surface as skin, jersey, trousers and shoe/foot regions from its dominant four-slot deformation bone',
        coveredSourceVertexUnion: 0,
        removedBodyTriangles: 0,
        renderedExternalKitMeshes: ['hair', 'shoes'],
        excludedExternalKitMeshes: ['uniform'],
        highFittedBodyPaint: fittedHigh.fittedBodyPaint,
        lowFittedBodyPaint: fittedLow.fittedBodyPaint,
        fittedClothingTransitions: fittedClothingTransitions.evidence,
      },
      assetRegisterLivePolicy: {
        source: 'VPM3 fixed-four-slot evidence; lead-owned docs/ASSET_REGISTER.md synchronization required',
        fixedVpm3InfluenceSlots: 4,
        maximumNonZeroInfluencesLod0ThroughLod4: 4,
        balancedLiveAlbedo: '512x512',
        protectedSharedEyeTriangles: HERO_EYES.triangleCount,
        implementation: 'LOD0-LOD4 preserve every source four-slot skin record because VPM3 always encodes four slots; discarding influences saves zero bytes and damages deformation',
        unresolvedTrianglePolicy: 'Live batter aggregate remains above the register\'s Balanced <=4,000-triangle target; this exporter does not certify Balanced geometry compliance.',
      },
      liveBowlerBudget: {
        maximumCompleteVisibleTriangles: RETAINED_SPINNER_CAP.maximumCompleteBowlerTriangles,
        maximumBodyTriangles: RETAINED_SPINNER_CAP.maximumCompleteBowlerTriangles -
          RETAINED_SPINNER_CAP.triangles - HERO_EYES.triangleCount,
        heroLod2Triangles: outputs.find(({ lod }) => lod === 2).triangleCount,
        sharedEyeTriangles: HERO_EYES.triangleCount,
        retainedSpinnerCap: RETAINED_SPINNER_CAP,
        completeSpinBowlerTriangles: outputs.find(({ lod }) => lod === 2).triangleCount +
          HERO_EYES.triangleCount + RETAINED_SPINNER_CAP.triangles,
        paceBowlerTriangles: outputs.find(({ lod }) => lod === 2).triangleCount +
          HERO_EYES.triangleCount,
        worstLivePath: 'spin bowler: hero LOD2 plus shared eyes plus retained Low-detail crown and peak',
        postcondition: 'heroLod2Triangles + sharedEyeTriangles + retainedSpinnerCap.triangles <= maximumCompleteVisibleTriangles',
      },
      distantFielderBudget: {
        premiumMaximumCompleteTriangles: RETAINED_FIELDER_CAP.premiumMaximumCompleteTriangles,
        premiumMaximumBodyTriangles: RETAINED_FIELDER_CAP.premiumMaximumCompleteTriangles -
          RETAINED_FIELDER_CAP.triangles - HERO_EYES.triangleCount,
        premiumHeroLod3Triangles: outputs.find(({ lod }) => lod === 3).triangleCount,
        premiumCompleteTriangles: outputs.find(({ lod }) => lod === 3).triangleCount +
          HERO_EYES.triangleCount + RETAINED_FIELDER_CAP.triangles,
        balancedLiteMaximumCompleteTriangles: RETAINED_FIELDER_CAP.balancedLiteMaximumCompleteTriangles,
        balancedLiteMaximumBodyTriangles: RETAINED_FIELDER_CAP.balancedLiteMaximumCompleteTriangles -
          RETAINED_FIELDER_CAP.triangles - HERO_EYES.triangleCount,
        balancedLiteHeroLod4Triangles: outputs.find(({ lod }) => lod === 4).triangleCount,
        balancedLiteCompleteTriangles: outputs.find(({ lod }) => lod === 4).triangleCount +
          HERO_EYES.triangleCount + RETAINED_FIELDER_CAP.triangles,
        sharedEyeTriangles: HERO_EYES.triangleCount,
        retainedFielderCap: RETAINED_FIELDER_CAP,
        postcondition: 'LOD3/LOD4 + shared eyes + retained cap stay within 2,000/1,200 triangles; all retain exactly the VSK1 75-bone identity',
      },
      lods: outputs,
      eyes: {
        status: 'PINNED CC0 TECHNICAL ART CANDIDATE / INDEPENDENT VISUAL ACCEPTANCE UNPROVEN',
        rendererPolicy: 'one shared opaque VPM3 eye renderer reused unchanged at every hero LOD',
        fileName: HERO_EYES.fileName,
        format: 'VPM3',
        bytes: eyeBytes.length,
        sha256: eyeDigest,
        skeletonId: eyeHeader.skeletonId,
        vertexCount: eyeHeader.vertexCount,
        triangleCount: eyeHeader.indexCount / 3,
        shaderRegion: HERO_EYES.shaderRegion,
        binding: {
          boneIndex: HERO_EYES.headBone,
          boneName: V3_BONE_NAMES[HERO_EYES.headBone],
          rigidWeight: 255,
          mapping: '96 direct MHCLO base-body mappings; maximum source-coordinate difference 0',
        },
        source: {
          archiveSha256: SYSTEM_ASSET_ARCHIVE_SHA256,
          license: 'CC0-1.0',
          members: Object.fromEntries(Object.entries(eyeSources).map(([kind, value]) => [kind, {
            archiveEntry: value.name,
            bytes: value.bytes.length,
            sha256: value.sha256,
          }])),
        },
        albedo: {
          fileName: HERO_EYES.textureFileName,
          bytes: eyeTextureBytes.length,
          sha256: sha256(eyeTextureBytes),
          width: eyeTextureMetadata.width,
          height: eyeTextureMetadata.height,
          channels: eyeTextureMetadata.channels,
          alpha: eyeTextureMetadata.hasAlpha,
          source: eyeSources.albedo.name,
          sourceSha256: eyeSources.albedo.sha256,
          deterministicTransform: 'remove alpha; Lanczos3 resize to 256x256; PNG compression 9; adaptive filtering disabled; RGB non-palette',
        },
      },
      equipment: {
        source: gearExport.source,
        originalVandeAuthored: true,
        dimensions: gearExport.dimensions,
        foregroundReadabilityPolicy: gearExport.foregroundReadabilityPolicy,
        shaderRegions: gearExport.shaderRegions,
        renderedFamilies: gearExport.renderedFamilies,
        omittedUnderClothing: gearExport.omittedUnderClothing,
        outputs: equipment,
        acceptance: 'TECHNICAL ART CANDIDATE / INDEPENDENT VISUAL ACCEPTANCE UNPROVEN',
      },
      motion: {
        source: {
          name: 'Carnegie Mellon University Graphics Lab Motion Capture Database',
          indexUrl: 'https://mocap.cs.cmu.edu/search.php',
          termsUrl: 'https://mocap.cs.cmu.edu/',
          termsSummary: 'CMU permits inclusion in commercially sold products but prohibits direct resale of the motion data, including converted form; acknowledgment is requested.',
          acknowledgementRequested: 'The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217.',
        },
        authorityBoundary: 'Reference motion is presentation-only. Canonical TypeScript traces remain sole authority for release, contact, flight, score and replay.',
        outputs: motions,
        limitations: [
          'No cricket-specific CMU trial was found.',
          'Run/jog and baseball swing are weight-transfer references, not shippable cricket actions.',
          'Hands, bat grip, planted feet, release and contact alignment require authored cricket correction and IK.',
          'The technical action peak is not an authoritative release or contact marker.',
        ],
      },
      skin: {
        fileName: skinFileName,
        bytes: skinBytes.length,
        sha256: sha256(skinBytes),
        source: skinSource.name,
        sourceSha256: DARK_SKIN_SOURCE_SHA256,
        width: skinMetadata.width,
        height: skinMetadata.height,
        license: 'CC0-1.0',
        live: {
          fileName: liveSkinFileName,
          role: 'live/Balanced LOD1 through LOD4 candidate',
          bytes: liveSkinBytes.length,
          sha256: sha256(liveSkinBytes),
          source: skinSource.name,
          sourceSha256: DARK_SKIN_SOURCE_SHA256,
          width: liveSkinMetadata.width,
          height: liveSkinMetadata.height,
          license: 'CC0-1.0',
          deterministicTransform: 'direct pinned-source Lanczos3 resize to 512x512; PNG compression 9; adaptive filtering disabled; no palette',
        },
      },
      limitations: [
        'The CC0 hair, shoes and fitted body-region kit are technical foundations, not accepted cricket production art.',
        'Body-conformal low-relief collar, sleeve-cuff and jersey-hem bands add local cloth-edge thickness; the remaining torso and trouser surfaces are still region-painted anatomy and require independent visual review.',
        'Region-painted anatomical feet remain under the separate CC0 shoe shell; pose-by-pose shoe containment and clipping require independent visual review.',
        'Original cricket helmet, zoned padding/metal grille, tapered wrap pads, compact channelled gloves, straps and bat are technical candidates requiring visual and clipping review; thigh and lower-arm guards are omitted because they belong beneath clothing.',
        'The no-cull fitted-body policy removes separate shoulder/sleeve geometry seams, but every authored pose still requires independent deformation and clipping review.',
        'Four-influence skinning is preserved at every body LOD; authored-pose deformation and clipping review remains required.',
        'The retained procedural spinner cap is included only as bounded triangle headroom; its visual acceptance remains UNPROVEN.',
        'The retained procedural fielder cap and wicketkeeper cap/helmet/pads/gloves/web are role equipment only; their visual acceptance and clipping remain UNPROVEN.',
        'The pinned CC0 eye geometry and 256x256 albedo are technically integrated but require independent close/gameplay-distance visual review.',
        'Motion, WebGL/Android performance, fresh-installed size and India-weighted reach are UNPROVEN.',
        'Builders cannot certify visual acceptance; independent close/gameplay-distance review is required.',
      ],
    };
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    await writeIfChanged(join(outputDir, 'hero-bundle-provenance.json'), manifestBytes);
    return {
      ...manifest,
      outputDir,
      totalDeliveredBytes: skeletonBytes.length + eyeBytes.length + eyeTextureBytes.length +
        skinBytes.length + liveSkinBytes.length +
        outputs.reduce((sum, output) => sum + output.bytes, 0) +
        equipment.reduce((sum, value) => sum + value.gear.bytes + value.bat.bytes, 0) +
        motions.reduce((sum, value) => sum + value.bytes, 0) + manifestBytes.length,
      androidInstalledSizeDelta: 'UNPROVEN',
      indiaWeightedReach: 'UNPROVEN',
    };
  } finally {
    await rm(workingDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  exportProductionHeroBundle({
    sourceDir: process.argv[2] ?? DEFAULT_V3_SOURCE_DIR,
    archivePath: process.argv[3] ?? DEFAULT_KIT_ARCHIVE,
    outputDir: process.argv[4] ?? DEFAULT_HERO_BUNDLE_OUTPUT_DIR,
  }).then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`), (error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
