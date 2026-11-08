import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

import {
  V3_BONE_NAMES,
  VSK1_BONE_BYTES,
  VSK1_HEADER_BYTES,
  parseVpm3Header,
  parseVsk1,
} from './export-unity-production-character-v3.mjs';
import { BAT_TRIANGLE_BUDGETS, GEAR_TRIANGLE_BUDGETS, parseVbt1Header } from './export-unity-production-cricket-gear.mjs';
import { decodeVmaHeader } from './export-unity-production-motion.mjs';
import {
  HERO_BUNDLE_GEAR,
  HERO_BUNDLE_LODS,
  HERO_BUNDLE_MOTIONS,
  HERO_EYES,
  HERO_FACE_LOD1_POLICY,
  HERO_RENDERED_KIT_SELECTION,
  FITTED_CRICKET_TRANSITION_POLICY,
  RETAINED_FIELDER_CAP,
  RETAINED_SPINNER_CAP,
  assessFittedCricketTransitionSurvival,
  buildProtectedFaceLock,
  buildFittedBodyCricketKitMesh,
  classifyFittedBodyVertexRegion,
  combineMeshes,
  decodeVpm3,
  exportProductionHeroBundle,
  mapCanonicalHipsToRoot,
  simplifyCombinedHeroMesh,
  splitMixedTriangleRegions,
} from './export-unity-production-hero-bundle.mjs';

const vertex = (sourcePositionIndex, region = 0) => ({
  position: [sourcePositionIndex, 0, 0], normal: [0, 1, 0], tangent: [1, 0, 0, 1],
  bindPos: [sourcePositionIndex, 0, 0], uv: [0, 0], region,
  bones: [0, 0, 0, 0], weights: [255, 0, 0, 0], sourcePositionIndex,
});

const EXPECTED_REGION_SAFE_LOD_IDENTITIES = Object.freeze({
  0: Object.freeze({ triangles: 32_222, vertices: 18_507, bytes: 1_525_868,
    sha256: 'c63e8f8c99512686f1e3a43e05232f573a4d2a2c6091192f9ceff8c183eb173a' }),
  1: Object.freeze({ triangles: 4_999, vertices: 3_325, bytes: 269_426,
    sha256: 'd4b7423361caf85d62e5cdeef639614990ff392c5870ef474f488ced0abffaef' }),
  2: Object.freeze({ triangles: 3_768, vertices: 2_665, bytes: 214_520,
    sha256: '083e6bc9a57f1a60ba469247e47da1fd6a8e29f18a51b04d8e3e83a9708adada' }),
  3: Object.freeze({ triangles: 1_756, vertices: 1_412, bytes: 112_232,
    sha256: 'db96ae02b7e7af644deb8397277395fea6fe37cda17d9838df30a71359bdd8d3' }),
  4: Object.freeze({ triangles: 948, vertices: 902, bytes: 70_664,
    sha256: '08b5b2e4ee9024dccf99ac66ed3a0926e729108fc033065fcae3e9083e687330' }),
});

const PRODUCTION_CHARACTER_SHADER_PATH = join(
  'unity', 'VandePractice', 'Assets', 'VandePractice', 'Runtime', 'Presentation',
  'Resources', 'VandeProductionCharacter.shader');
const PRODUCTION_HERO_LIVE_PATH = join(
  'unity', 'VandePractice', 'Assets', 'VandePractice', 'Runtime', 'Presentation',
  'Resources', 'ProductionCharacters', 'hero-lod1.bytes');

const smoothStep = (minimum, maximum, value) => {
  const amount = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  return amount * amount * (3 - 2 * amount);
};

const compressionSleeveMask = (position) => {
  const side = smoothStep(0.27, 0.32, Math.abs(position[0])) *
    (1 - smoothStep(0.415, 0.445, Math.abs(position[0])));
  const height = smoothStep(1.08, 1.13, position[1]) *
    (1 - smoothStep(1.30, 1.34, position[1]));
  const depth = 1 - smoothStep(0.185, 0.215, position[2]);
  return side * height * depth;
};

test('runtime compression undersleeve covers both shipped forearms without repainting hands', async () => {
  const shader = await readFile(PRODUCTION_CHARACTER_SHADER_PATH, 'utf8');
  assert.match(shader,
    /smoothstep\(0\.415h, 0\.445h, abs\(p\.x\)\)/,
    'shader outer bound must stop before the bind-pose hand envelope');
  assert.match(shader,
    /smoothstep\(0\.185h, 0\.215h, p\.z\)/,
    'shader depth bound must reject the forward hand/finger envelope');

  const live = decodeVpm3(await readFile(PRODUCTION_HERO_LIVE_PATH));
  const stronglyCovered = live.vertices.filter(({ region, bindPos }) =>
    region === 0 && compressionSleeveMask(bindPos) >= 0.25);
  assert.ok(stronglyCovered.length >= 60,
    'the undersleeve must materially cover the low-byte live forearm surface');
  const dominantBoneName = ({ bones, weights }) => {
    const strongestSlot = weights.indexOf(Math.max(...weights));
    return V3_BONE_NAMES[bones[strongestSlot]];
  };
  const names = stronglyCovered.map(dominantBoneName);
  assert.ok(names.every((name) => /^(?:lowerarm0[12]|upperarm02)\.[LR]$/.test(name)),
    `strong sleeve coverage escaped onto a hand, wrist or finger: ${JSON.stringify([...new Set(names)])}`);
  assert.ok(names.filter((name) => name.endsWith('.L')).length >= 25);
  assert.ok(names.filter((name) => name.endsWith('.R')).length >= 25);
});

test('fitted cricket paint follows authored body skinning and disconnects only material ids', () => {
  const skinned = (sourcePositionIndex, bone, region = 9) => ({
    ...vertex(sourcePositionIndex, region),
    bones: [bone, 0, 0, 0],
    weights: [255, 0, 0, 0],
    uv: [sourcePositionIndex / 8, sourcePositionIndex / 9],
  });
  assert.equal(classifyFittedBodyVertexRegion(skinned(0, V3_BONE_NAMES.indexOf('head'))), 0);
  assert.equal(classifyFittedBodyVertexRegion(skinned(1, V3_BONE_NAMES.indexOf('spine03'))), 1);
  assert.equal(classifyFittedBodyVertexRegion(skinned(2, V3_BONE_NAMES.indexOf('upperarm01.L'))), 1);
  assert.equal(classifyFittedBodyVertexRegion(skinned(3, V3_BONE_NAMES.indexOf('lowerarm01.L'))), 0);
  assert.equal(classifyFittedBodyVertexRegion(skinned(4, V3_BONE_NAMES.indexOf('upperleg01.R'))), 2);
  assert.equal(classifyFittedBodyVertexRegion(skinned(5, V3_BONE_NAMES.indexOf('foot.R'))), 3);
  const tie = skinned(6, V3_BONE_NAMES.indexOf('spine03'));
  tie.bones = [V3_BONE_NAMES.indexOf('spine03'), V3_BONE_NAMES.indexOf('head'), 0, 0];
  tie.weights = [127, 127, 1, 0];
  assert.equal(classifyFittedBodyVertexRegion(tie), 1,
    'equal weights choose the lower VSK1 bone index deterministically');

  const source = {
    vertices: [
      skinned(0, V3_BONE_NAMES.indexOf('head')),
      skinned(1, V3_BONE_NAMES.indexOf('spine03')),
      skinned(2, V3_BONE_NAMES.indexOf('upperarm01.L')),
      skinned(3, V3_BONE_NAMES.indexOf('upperleg01.R')),
    ],
    indices: [0, 1, 2, 0, 2, 3],
  };
  const result = buildFittedBodyCricketKitMesh(source);
  assert.equal(result.fittedBodyPaint.sourceSkinRecordSha256,
    result.fittedBodyPaint.paintedSkinRecordSha256);
  assert.equal(result.fittedBodyPaint.fourSlotSkinRecordsPreservedExactly, true);
  assert.equal(result.fittedBodyPaint.mixedRegionSafety.mixedSourceTriangles, 2);
  assert.equal(result.fittedBodyPaint.mixedRegionSafety.mixedOutputTriangles, 0);
  assert.ok(Object.keys(result.fittedBodyPaint.outputTriangleRegions).every((key) => !key.includes('+')));
  for (const output of result.mesh.vertices) {
    const authored = source.vertices.find(({ sourcePositionIndex }) =>
      sourcePositionIndex === output.sourcePositionIndex);
    assert.deepEqual(output.position, authored.position);
    assert.deepEqual(output.bindPos, authored.bindPos);
    assert.deepEqual(output.bones, authored.bones);
    assert.deepEqual(output.weights, authored.weights);
  }
  assert.deepEqual(source.vertices.map(({ region }) => region), [9, 9, 9, 9],
    'source remains immutable');
});

test('mesh combination preserves material regions and offsets indices', () => {
  const first = { vertices: [vertex(0, 0), vertex(1, 0), vertex(2, 0)], indices: [0, 1, 2] };
  const second = { vertices: [vertex(3, 11), vertex(4, 11), vertex(5, 11)], indices: [0, 1, 2] };
  const combined = combineMeshes([first, second]);
  assert.deepEqual(combined.indices, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(combined.vertices.map(({ region }) => region), [0, 0, 0, 11, 11, 11]);
});

test('canonical Hips semantic is reassigned to the one skeleton root', () => {
  const input = [
    { parent: -1, semantic: 0xffff, localPosition: [0, 0, 0], localRotation: [0, 0, 0, 1] },
    { parent: 0, semantic: 0, localPosition: [0, 1, 0], localRotation: [0, 0, 0, 1] },
  ];
  const mapped = mapCanonicalHipsToRoot(input);
  assert.equal(mapped[0].semantic, 0);
  assert.equal(mapped[1].semantic, 0xffff);
  assert.equal(input[0].semantic, 0xffff, 'input remains immutable');
  assert.throws(() => mapCanonicalHipsToRoot([
    { parent: 1, semantic: 0, localPosition: [0, 0, 0], localRotation: [0, 0, 0, 1] },
    { parent: -1, semantic: 0xffff, localPosition: [0, 0, 0], localRotation: [0, 0, 0, 1] },
  ]), /root must be bone 0/);
  assert.throws(() => mapCanonicalHipsToRoot([
    { parent: -1, semantic: 1, localPosition: [0, 0, 0], localRotation: [0, 0, 0, 1] },
    { parent: 0, semantic: 0, localPosition: [0, 0, 0], localRotation: [0, 0, 0, 1] },
  ]), /unexpected semantic/);
});

test('mixed shader-region triangles become disconnected categorical components without shading drift', () => {
  const source = {
    vertices: [
      { ...vertex(0, 0), normal: [0.1, 0.2, 0.3], tangent: [0.4, 0.5, 0.6, -1] },
      { ...vertex(1, 0), normal: [0.2, 0.3, 0.4], tangent: [0.5, 0.6, 0.7, 1] },
      { ...vertex(2, 1), normal: [0.3, 0.4, 0.5], tangent: [0.6, 0.7, 0.8, -1] },
      { ...vertex(3, 1), normal: [0.4, 0.5, 0.6], tangent: [0.7, 0.8, 0.9, 1] },
    ],
    indices: [0, 1, 2, 1, 3, 2],
  };
  const result = splitMixedTriangleRegions(source);
  assert.equal(result.mesh.regionBoundary.mixedSourceTriangles, 2);
  assert.equal(result.mesh.regionBoundary.mixedOutputTriangles, 0);
  assert.equal(result.mesh.regionBoundary.duplicatedVertices, 2);
  assert.equal(result.mesh.regionBoundary.reassignedCorners, 2);
  for (let offset = 0; offset < result.mesh.indices.length; offset += 3) {
    const regions = new Set(result.mesh.indices.slice(offset, offset + 3)
      .map((index) => result.mesh.vertices[index].region));
    assert.equal(regions.size, 1);
  }
  for (const output of result.mesh.vertices.slice(source.vertices.length)) {
    const authored = source.vertices.find(({ position }) => position[0] === output.position[0]);
    assert.deepEqual(output.normal, authored.normal);
    assert.deepEqual(output.tangent, authored.tangent);
    assert.deepEqual(output.bones, authored.bones);
    assert.deepEqual(output.weights, authored.weights);
  }
  assert.deepEqual(source.indices, [0, 1, 2, 1, 3, 2], 'input remains immutable');
  assert.deepEqual(source.vertices.map(({ region }) => region), [0, 0, 1, 1], 'source regions remain immutable');
});

test('mesh simplification transfers authored normals and tangents instead of recomputing them', async () => {
  await MeshoptSimplifier.ready;
  const side = 4;
  const positions = Array.from({ length: side * side }, (_, index) =>
    [index % side, Math.floor(index / side), 0]);
  const indices = [];
  for (let y = 0; y < side - 1; y++) {
    for (let x = 0; x < side - 1; x++) {
      const a = y * side + x;
      indices.push(a, a + 1, a + side + 1, a, a + side + 1, a + side);
    }
  }
  const source = {
    vertices: positions.map((position, index) => ({
      ...vertex(index, 0),
      position,
      bindPos: [...position],
      uv: [(index % side) / (side - 1), Math.floor(index / side) / (side - 1)],
      normal: [1, 0, 0],
      tangent: [0, 1, 0, -1],
    })),
    indices,
  };
  const simplified = simplifyCombinedHeroMesh(source, 9, 1);
  assert.ok(simplified.indices.length / 3 <= 9);
  assert.equal(simplified.simplification.maximumRetainedNormalComponentDrift, 0);
  assert.equal(simplified.simplification.maximumRetainedTangentComponentDrift, 0);
  for (const output of simplified.vertices) {
    const authored = source.vertices.find(({ position }) =>
      position.every((value, axis) => value === output.position[axis]));
    assert.ok(authored, 'simplifier output must be a retained source vertex');
    assert.deepEqual(output.normal, authored.normal);
    assert.deepEqual(output.tangent, authored.tangent);
  }
});

test('pinned CC0 sources export deterministic body LODs and one protected shared eye renderer', async (context) => {
  try { await readFile('/private/tmp/vande-realistic-player-source/makehuman_system_assets_cc0.zip'); }
  catch { context.skip('verified MakeHuman CC0 scratch archive is absent'); return; }
  const firstDir = await mkdtemp(join(tmpdir(), 'vande-hero-bundle-a-'));
  const secondDir = await mkdtemp(join(tmpdir(), 'vande-hero-bundle-b-'));
  try {
    const first = await exportProductionHeroBundle({ outputDir: firstDir });
    await exportProductionHeroBundle({ outputDir: secondDir });
    assert.equal(first.status, 'TECHNICAL HERO FOUNDATION / NOT PLAYER-FACING ACCEPTED');
    assert.equal(first.androidInstalledSizeDelta, 'UNPROVEN');
    assert.equal(first.indiaWeightedReach, 'UNPROVEN');
    assert.equal(first.bodyCoverage.coveredSourceVertexUnion, 0);
    assert.equal(first.bodyCoverage.removedBodyTriangles, 0);
    assert.deepEqual(first.bodyCoverage.renderedExternalKitMeshes, ['hair', 'shoes']);
    assert.deepEqual(first.bodyCoverage.excludedExternalKitMeshes, ['uniform']);
    for (const paint of [first.bodyCoverage.highFittedBodyPaint, first.bodyCoverage.lowFittedBodyPaint]) {
      assert.equal(paint.sourceSkinRecordSha256, paint.paintedSkinRecordSha256);
      assert.equal(paint.fourSlotSkinRecordsPreservedExactly, true);
      assert.equal(paint.mixedRegionSafety.mixedOutputTriangles, 0);
      assert.equal(paint.mixedRegionSafety.fourSlotSkinRecordsPreservedExactly, true);
    }
    assert.equal(first.lods.length, HERO_BUNDLE_LODS.length);
    const liveProfile = HERO_BUNDLE_LODS.find(({ lod }) => lod === 1);
    assert.deepEqual(
      { body: liveProfile.body, kit: liveProfile.kit, maximumTriangles: liveProfile.maximumTriangles,
        faceProtectionPolicy: liveProfile.faceProtectionPolicy },
      { body: 'high', kit: 3, maximumTriangles: 5000,
        faceProtectionPolicy: HERO_FACE_LOD1_POLICY.version },
    );

    const skeletonA = await readFile(join(firstDir, 'hero-skeleton.bytes'));
    const skeletonB = await readFile(join(secondDir, 'hero-skeleton.bytes'));
    assert.deepEqual(skeletonA, skeletonB);
    const skeleton = parseVsk1(skeletonA);
    const eyesA = await readFile(join(firstDir, HERO_EYES.fileName));
    const eyesB = await readFile(join(secondDir, HERO_EYES.fileName));
    assert.deepEqual(eyesA, eyesB);
    assert.equal(createHash('sha256').update(eyesA).digest('hex'), HERO_EYES.meshSha256);
    const eyeHeader = parseVpm3Header(eyesA);
    assert.equal(eyeHeader.skeletonId, skeleton.skeletonId);
    assert.equal(eyeHeader.vertexCount, HERO_EYES.vertexCount);
    assert.equal(eyeHeader.indexCount / 3, HERO_EYES.triangleCount);
    const eyes = decodeVpm3(eyesA);
    assert.ok(eyes.vertices.every(({ region, bones, weights }) =>
      region === HERO_EYES.shaderRegion && bones[0] === HERO_EYES.headBone &&
      weights[0] === 255 && weights.slice(1).every((weight) => weight === 0)));
    const skeletonRecords = V3_BONE_NAMES.map((name, index) => {
      const offset = VSK1_HEADER_BYTES + index * VSK1_BONE_BYTES;
      return { name, parent: skeletonA.readInt16LE(offset), semantic: skeletonA.readUInt16LE(offset + 2) };
    });
    assert.equal(skeletonRecords[0].name, 'root');
    assert.equal(skeletonRecords[0].parent, -1);
    assert.equal(skeletonRecords[0].semantic, 0);
    assert.equal(skeletonRecords.filter(({ semantic }) => semantic === 0).length, 1);
    assert.equal(skeletonRecords.find(({ name }) => name === 'spine05').semantic, 0xffff);
    const isDescendantOfRoot = (name) => {
      let index = V3_BONE_NAMES.indexOf(name);
      const visited = new Set();
      while (index !== -1 && !visited.has(index)) {
        if (index === 0) return true;
        visited.add(index);
        index = skeletonRecords[index].parent;
      }
      return false;
    };
    for (const name of ['pelvis.L', 'upperleg01.L', 'pelvis.R', 'upperleg01.R', 'spine05', 'head'])
      assert.equal(isDescendantOfRoot(name), true, `${name} must descend from canonical Hips/root`);
    for (const profile of HERO_BUNDLE_LODS) {
      const left = await readFile(join(firstDir, `hero-lod${profile.lod}.bytes`));
      const right = await readFile(join(secondDir, `hero-lod${profile.lod}.bytes`));
      assert.deepEqual(left, right);
      const header = parseVpm3Header(left);
      assert.equal(header.skeletonId, skeleton.skeletonId);
      assert.ok(header.indexCount / 3 <= profile.maximumTriangles);
      const decoded = decodeVpm3(left);
      assert.deepEqual({
        triangles: header.indexCount / 3,
        vertices: header.vertexCount,
        bytes: left.length,
        sha256: createHash('sha256').update(left).digest('hex'),
      }, EXPECTED_REGION_SAFE_LOD_IDENTITIES[profile.lod]);
      const regions = new Set(decoded.vertices.map(({ region }) => region));
      for (const required of [0, 1, 2, 3, 11]) assert.ok(regions.has(required), `missing region ${required}`);
      assert.ok(decoded.vertices.every(({ weights }) => weights.reduce((sum, value) => sum + value, 0) === 255));
      const activeInfluences = decoded.vertices.map(({ weights }) => weights.filter((weight) => weight > 0).length);
      assert.ok(activeInfluences.some((count) => count === 4),
        `LOD${profile.lod} must retain at least one authored four-influence record`);
      assert.equal(first.lods[profile.lod].influencePolicy.observedMaximumNonZeroInfluences,
        Math.max(...activeInfluences));
      assert.equal(first.lods[profile.lod].influencePolicy.maximumNonZeroInfluences, 4);
      assert.equal(first.lods[profile.lod].influencePolicy.reduction, 'none');
      assert.equal(first.lods[profile.lod].remainingCoveredBodyTriangles, 0);
      assert.ok(Object.keys(first.lods[profile.lod].triangleRegions).every((key) => !key.includes('+')),
        `LOD${profile.lod} must not contain a mixed shader-region triangle`);
      assert.equal(first.lods[profile.lod].regionBoundary.mixedOutputTriangles, 0);
      assert.equal(first.lods[profile.lod].regionBoundary.mixedSourceTriangles, 0);
      assert.equal(first.lods[profile.lod].regionBoundary.authoredVertexAttributesPreserved, true);
      assert.equal(first.lods[profile.lod].regionBoundary.maximumPositionDriftMetres, 0);
      assert.equal(first.lods[profile.lod].regionBoundary.maximumBindPositionDriftMetres, 0);
      assert.equal(first.lods[profile.lod].regionBoundary.maximumUvDrift, 0);
      assert.equal(first.lods[profile.lod].regionBoundary.maximumNormalComponentDrift, 0);
      assert.equal(first.lods[profile.lod].regionBoundary.maximumTangentComponentDrift, 0);
      assert.equal(first.lods[profile.lod].regionBoundary.fourSlotSkinRecordsPreservedExactly, true);
      if (profile.lod > 0) {
        assert.equal(first.lods[profile.lod].simplification.maximumRetainedNormalComponentDrift, 0);
        assert.equal(first.lods[profile.lod].simplification.maximumRetainedTangentComponentDrift, 0);
      }
      if (profile.lod === 0) {
        const protection = buildProtectedFaceLock(decoded);
        assert.equal(protection.metrics.sourceTriangles, HERO_FACE_LOD1_POLICY.expectedSourceTriangles);
        assert.equal(protection.metrics.lockedVertices, HERO_FACE_LOD1_POLICY.expectedLockedVertices);
        assert.ok(protection.metrics.landmarks.every(({ qualifyingVertices, intersectingProtectedTriangles,
          meanBindZ }) => qualifyingVertices > 0 && intersectingProtectedTriangles > 0 &&
          meanBindZ >= HERO_FACE_LOD1_POLICY.minimumLandmarkMeanBindZ));
      }
      if (profile.lod === 1) {
        const output = first.lods[1];
        assert.equal(output.triangleCount, HERO_FACE_LOD1_POLICY.expectedOutputTriangles);
        assert.equal(output.vertexCount, HERO_FACE_LOD1_POLICY.expectedOutputVertices);
        assert.equal(output.bytes, HERO_FACE_LOD1_POLICY.expectedOutputBytes);
        assert.equal(output.sha256, HERO_FACE_LOD1_POLICY.expectedOutputSha256);
        assert.ok(output.triangleCount <= profile.maximumTriangles);
        assert.equal(profile.maximumTriangles - output.triangleCount,
          HERO_FACE_LOD1_POLICY.intentionalUnusedTriangleHeadroom);
        assert.deepEqual(output.kitTriangleCounts, { hair: 505, shoes: 1984 });
        assert.deepEqual(output.triangleRegions, HERO_FACE_LOD1_POLICY.expectedOutputTrianglesByRegion);
        assert.ok(Object.keys(output.triangleRegions).every((key) => !key.includes('+')),
          'LOD1 must not contain a mixed shader-region triangle');
        assert.equal(output.simplification.sourceTriangles, 29533);
        assert.equal(output.simplification.targetTriangles, 5000);
        assert.equal(output.simplification.achievedTriangles,
          HERO_FACE_LOD1_POLICY.expectedOutputTriangles);
        assert.equal(output.simplification.internalRequestedTriangles, 5004);
        assert.equal(output.simplification.observedRelativeError,
          HERO_FACE_LOD1_POLICY.expectedObservedRelativeError);
        assert.ok(output.simplification.observedRelativeError <= 0.05);
        const protection = output.simplification.protection;
        assert.equal(protection.policyVersion, HERO_FACE_LOD1_POLICY.version);
        assert.equal(protection.anatomicalFrontAxis, '+Z');
        assert.equal(protection.sourceTriangles, 969);
        assert.equal(protection.retainedTriangles, 969);
        assert.equal(protection.lockedVertices, 611);
        assert.equal(protection.retainedLockedVertices, 611);
        assert.equal(protection.maximumOutputTriangles, 5000);
        assert.equal(protection.expectedOutputTriangles, HERO_FACE_LOD1_POLICY.expectedOutputTriangles);
        assert.equal(protection.intentionalUnusedTriangleHeadroom,
          HERO_FACE_LOD1_POLICY.intentionalUnusedTriangleHeadroom);
        assert.match(protection.headroomRationale, /no padding or protected-identity weakening/);
        assert.equal(protection.maximumPositionDriftMetres, 0);
        assert.equal(protection.maximumBindPositionDriftMetres, 0);
        assert.equal(protection.maximumUvDrift, 0);
        assert.equal(protection.maximumNormalComponentDrift, 0);
        assert.equal(protection.maximumTangentComponentDrift, 0);
        assert.equal(protection.fourSlotSkinRecordsPreservedExactly, true);
        assert.equal(output.simplification.maximumRetainedNormalComponentDrift, 0);
        assert.equal(output.simplification.maximumRetainedTangentComponentDrift, 0);
        assert.deepEqual(output.simplification.regionBoundary, {
          policy: 'disconnect mixed source triangles by deterministic majority region; tie uses lower region id',
          mixedSourceTriangles: 0,
          mixedOutputTriangles: 0,
          duplicatedVertices: 0,
          reassignedCorners: 0,
          triangleRegions: { 0: 15990, 1: 4342, 2: 2436, 3: 6260, 11: 505 },
          authoredVertexAttributesPreserved: true,
          maximumPositionDriftMetres: 0,
          maximumBindPositionDriftMetres: 0,
          maximumUvDrift: 0,
          maximumNormalComponentDrift: 0,
          maximumTangentComponentDrift: 0,
          fourSlotSkinRecordsPreservedExactly: true,
        });
        assert.equal(protection.sourceTriangleIdentitySha256,
          HERO_FACE_LOD1_POLICY.expectedSourceTriangleIdentitySha256);
        assert.equal(protection.retainedTriangleIdentitySha256,
          protection.sourceTriangleIdentitySha256);
        assert.equal(protection.sourceVertexIdentitySha256,
          HERO_FACE_LOD1_POLICY.expectedSourceVertexIdentitySha256);
        assert.equal(protection.retainedSourceVertexIdentitySha256,
          protection.sourceVertexIdentitySha256);
        assert.ok(protection.landmarks.every(({ qualifyingVertices, intersectingProtectedTriangles,
          meanBindZ }) => qualifyingVertices > 0 && intersectingProtectedTriangles > 0 &&
          meanBindZ >= HERO_FACE_LOD1_POLICY.minimumLandmarkMeanBindZ));
        assert.deepEqual(
          protection.vertexPreservation,
          {
            protectedVertices: 611,
            maximumPositionDriftMetres: 0,
            maximumBindPositionDriftMetres: 0,
            maximumUvDrift: 0,
            maximumNormalComponentDrift: 0,
            maximumTangentComponentDrift: 0,
            fourSlotSkinRecordsExact: true,
            finalVertexIdentitySha256: protection.vertexPreservation.finalVertexIdentitySha256,
          },
        );
        assert.equal(protection.vertexPreservation.finalVertexIdentitySha256,
          HERO_FACE_LOD1_POLICY.expectedFinalVertexIdentitySha256);
      }
    }
    const transitionEvidence = first.bodyCoverage.fittedClothingTransitions;
    assert.equal(transitionEvidence.policy, FITTED_CRICKET_TRANSITION_POLICY.version);
    assert.equal(transitionEvidence.vertexCount, FITTED_CRICKET_TRANSITION_POLICY.expectedVertices);
    assert.equal(transitionEvidence.triangleCount, FITTED_CRICKET_TRANSITION_POLICY.expectedTriangles);
    assert.equal(transitionEvidence.closedTwoManifold, true);
    assert.equal(transitionEvidence.bodyGeometryMutated, false);
    assert.deepEqual(transitionEvidence.features.map(({ id, vertexCount, triangleCount }) =>
      [id, vertexCount, triangleCount]), [
      ['collar', 48, 96],
      ['waist-hem', 48, 96],
      ['left-sleeve-cuff', 24, 48],
      ['right-sleeve-cuff', 24, 48],
    ]);
    assert.deepEqual(transitionEvidence.features.map(({ id, bandHalfWidth, relief, standOff }) =>
      [id, bandHalfWidth, relief, standOff]), [
      ['collar', 0.004, 0.0013, 0.0005],
      ['waist-hem', 0.0045, 0.0013, 0.0005],
      ['left-sleeve-cuff', 0.0035, 0.0011, 0.0005],
      ['right-sleeve-cuff', 0.0035, 0.0011, 0.0005],
    ], 'cloth edges must be broad, low-relief fitted bands rather than circular wire loops');
    assert.ok(transitionEvidence.features.every(({ bandHalfWidth, relief, maximumBodySourceDistance,
      maximumBodySurfaceDistance, p95BodySurfaceDistance, sourceBindPositions, vertexCount }) =>
      bandHalfWidth / relief >= 2.6 && maximumBodySourceDistance <= 0.015 &&
      maximumBodySurfaceDistance <= 0.004 && p95BodySurfaceDistance <= 0.0035 &&
      sourceBindPositions.length === vertexCount),
    'every fitted band must stay within four millimetres of the authored body surface');
    const transitionSource = {
      vertices: transitionEvidence.features.flatMap((feature) => feature.sourceBindPositions.map((bindPos) => ({
        bindPos,
        transitionComponent: feature.id,
      }))),
    };
    const decodedLive = decodeVpm3(await readFile(join(firstDir, 'hero-lod1.bytes')));
    const measuredLiveSurvival = assessFittedCricketTransitionSurvival(decodedLive, transitionSource);
    assert.deepEqual(measuredLiveSurvival, first.lods[1].fittedClothingTransitionSurvival,
      'the contract is remeasured from the encoded/decoded shipped LOD1');
    for (const feature of measuredLiveSurvival) {
      assert.ok(feature.retainedVertices >= Math.ceil(feature.sourceVertices *
        FITTED_CRICKET_TRANSITION_POLICY.minimumLiveRetainedVertexFraction));
      assert.ok(feature.retainedTriangles >= Math.ceil(feature.sourceTriangles *
        FITTED_CRICKET_TRANSITION_POLICY.minimumLiveRetainedTriangleFraction));
      assert.equal(feature.nonDegenerateAxes,
        FITTED_CRICKET_TRANSITION_POLICY.minimumLiveNonDegenerateAxes);
    }

    const live = first.equipment.outputs.find(({ detail }) => detail === 'live');
    const high = first.equipment.outputs.find(({ detail }) => detail === 'high');
    assert.equal(first.lods[1].triangleCount + HERO_EYES.triangleCount +
      live.gear.triangleCount + live.bat.triangleCount, 7_639);
    assert.ok(first.lods[1].triangleCount + HERO_EYES.triangleCount +
      live.gear.triangleCount + live.bat.triangleCount <= 8_000);
    assert.equal(first.lods[0].triangleCount + HERO_EYES.triangleCount +
      high.gear.triangleCount + high.bat.triangleCount, 39_454);
    assert.ok(first.lods[0].triangleCount + HERO_EYES.triangleCount +
      high.gear.triangleCount + high.bat.triangleCount <= 40_000);
    assert.equal(RETAINED_SPINNER_CAP.crown.triangles,
      RETAINED_SPINNER_CAP.crown.segments * RETAINED_SPINNER_CAP.crown.rings * 2);
    assert.equal(RETAINED_SPINNER_CAP.peak.triangles, 12);
    assert.equal(RETAINED_SPINNER_CAP.triangles, 60);
    assert.ok(first.lods[2].triangleCount <=
      4_000 - RETAINED_SPINNER_CAP.triangles - HERO_EYES.triangleCount);
    assert.ok(first.lods[2].triangleCount + HERO_EYES.triangleCount +
      RETAINED_SPINNER_CAP.triangles <= 4_000);
    assert.ok(first.lods[3].triangleCount <=
      2_000 - RETAINED_FIELDER_CAP.triangles - HERO_EYES.triangleCount);
    assert.ok(first.lods[4].triangleCount <=
      1_200 - RETAINED_FIELDER_CAP.triangles - HERO_EYES.triangleCount);
    assert.ok(first.lods[3].triangleCount + HERO_EYES.triangleCount +
      RETAINED_FIELDER_CAP.triangles <= 2_000);
    assert.ok(first.lods[4].triangleCount + HERO_EYES.triangleCount +
      RETAINED_FIELDER_CAP.triangles <= 1_200);

    const skinA = await readFile(join(firstDir, 'hero-skin-albedo-1024.png'));
    const skinB = await readFile(join(secondDir, 'hero-skin-albedo-1024.png'));
    assert.deepEqual(skinA, skinB);
    const metadata = await sharp(skinA).metadata();
    assert.deepEqual([metadata.width, metadata.height], [1024, 1024]);
    const liveSkinA = await readFile(join(firstDir, 'hero-skin-albedo-512.png'));
    const liveSkinB = await readFile(join(secondDir, 'hero-skin-albedo-512.png'));
    assert.deepEqual(liveSkinA, liveSkinB);
    const liveSkinMetadata = await sharp(liveSkinA).metadata();
    assert.deepEqual([liveSkinMetadata.width, liveSkinMetadata.height], [512, 512]);
    const eyeTextureA = await readFile(join(firstDir, HERO_EYES.textureFileName));
    const eyeTextureB = await readFile(join(secondDir, HERO_EYES.textureFileName));
    assert.deepEqual(eyeTextureA, eyeTextureB);
    assert.equal(createHash('sha256').update(eyeTextureA).digest('hex'), HERO_EYES.textureSha256);
    const eyeTextureMetadata = await sharp(eyeTextureA).metadata();
    assert.deepEqual(
      [eyeTextureMetadata.width, eyeTextureMetadata.height, eyeTextureMetadata.channels,
        eyeTextureMetadata.hasAlpha],
      [256, 256, 3, false],
    );

    for (const profile of HERO_BUNDLE_GEAR) {
      const gearName = `hero-gear-lod${profile.gearLod}.bytes`;
      const gearA = await readFile(join(firstDir, gearName));
      const gearB = await readFile(join(secondDir, gearName));
      assert.deepEqual(gearA, gearB);
      const gear = parseVpm3Header(gearA);
      assert.equal(gear.skeletonId, skeleton.skeletonId);
      assert.ok(gear.indexCount / 3 <= GEAR_TRIANGLE_BUDGETS[profile.detail]);
      if (profile.detail === 'live') {
        const liveGear = decodeVpm3(gearA);
        assert.ok(liveGear.vertices.every(({ weights }) => weights.filter((weight) => weight > 0).length <= 2));
      }

      const batName = `hero-bat-lod${profile.batLod}.bytes`;
      const batA = await readFile(join(firstDir, batName));
      const batB = await readFile(join(secondDir, batName));
      assert.deepEqual(batA, batB);
      assert.ok(parseVbt1Header(batA).triangleCount <= BAT_TRIANGLE_BUDGETS[profile.detail]);
    }

    for (const mapping of HERO_BUNDLE_MOTIONS) {
      const motionA = await readFile(join(firstDir, mapping.fileName));
      const motionB = await readFile(join(secondDir, mapping.fileName));
      assert.deepEqual(motionA, motionB);
      const motion = decodeVmaHeader(motionA);
      assert.equal(motion.rootLocked, true);
      assert.equal(motion.sampleRate, 60);
      assert.equal(motion.boneCount, 29);
    }

    const expectedAtomicFiles = [
      'hero-skeleton.bytes',
      HERO_EYES.fileName,
      ...HERO_BUNDLE_LODS.map(({ lod }) => `hero-lod${lod}.bytes`),
      ...HERO_BUNDLE_GEAR.flatMap(({ gearLod, batLod }) =>
        [`hero-gear-lod${gearLod}.bytes`, `hero-bat-lod${batLod}.bytes`]),
      'hero-skin-albedo-1024.png',
      'hero-skin-albedo-512.png',
      HERO_EYES.textureFileName,
      ...HERO_BUNDLE_MOTIONS.map(({ fileName }) => fileName),
      'hero-bundle-provenance.json',
    ].sort();
    const { readdir } = await import('node:fs/promises');
    assert.deepEqual((await readdir(firstDir)).sort(), expectedAtomicFiles);

    const manifestA = await readFile(join(firstDir, 'hero-bundle-provenance.json'));
    const manifestB = await readFile(join(secondDir, 'hero-bundle-provenance.json'));
    assert.deepEqual(manifestA, manifestB);
    const manifest = JSON.parse(manifestA);
    assert.equal(manifest.source.coreAssetLicense, 'CC0-1.0');
    assert.equal(manifest.assetRegisterLivePolicy.fixedVpm3InfluenceSlots, 4);
    assert.equal(manifest.assetRegisterLivePolicy.maximumNonZeroInfluencesLod0ThroughLod4, 4);
    assert.match(manifest.assetRegisterLivePolicy.unresolvedTrianglePolicy, /does not certify/);
    assert.equal(manifest.liveBowlerBudget.retainedSpinnerCap.triangles, 60);
    assert.equal(manifest.liveBowlerBudget.heroLod2Triangles +
      manifest.liveBowlerBudget.sharedEyeTriangles +
      manifest.liveBowlerBudget.retainedSpinnerCap.triangles,
    manifest.liveBowlerBudget.completeSpinBowlerTriangles);
    assert.ok(manifest.liveBowlerBudget.completeSpinBowlerTriangles <=
      manifest.liveBowlerBudget.maximumCompleteVisibleTriangles);
    assert.ok(manifest.distantFielderBudget.premiumHeroLod3Triangles <=
      manifest.distantFielderBudget.premiumMaximumBodyTriangles);
    assert.ok(manifest.distantFielderBudget.premiumCompleteTriangles <=
      manifest.distantFielderBudget.premiumMaximumCompleteTriangles);
    assert.ok(manifest.distantFielderBudget.balancedLiteHeroLod4Triangles <=
      manifest.distantFielderBudget.balancedLiteMaximumBodyTriangles);
    assert.ok(manifest.distantFielderBudget.balancedLiteCompleteTriangles <=
      manifest.distantFielderBudget.balancedLiteMaximumCompleteTriangles);
    assert.equal(manifest.source.systemAssetPack.license, 'CC0-1.0');
    assert.match(manifest.source.systemAssetPack.archiveSha256, /^[0-9a-f]{64}$/);
    for (const source of Object.values(manifest.source.pinnedCoreFiles))
      assert.match(source.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(
      manifest.source.systemAssetPack.selectedKitEntries.map(({ id, shaderRegion }) => [id, shaderRegion]),
      [['hair', 11], ['shoes', 3]],
    );
    assert.deepEqual(HERO_RENDERED_KIT_SELECTION.map(({ id, region }) => [id, region]),
      [['hair', 11], ['shoes', 3]]);
    assert.deepEqual(manifest.source.systemAssetPack.notRenderedKitEntries.map(({ id, stem }) => [id, stem]),
      [['uniform', 'male_casualsuit06']]);
    assert.equal(manifest.bodyCoverage.highFittedBodyPaint.classificationSha256,
      '9f3c05c3d7a5c70c7eba6c97059a54ff720f70d1cbc1539f982a6b1fd46401a5');
    assert.equal(manifest.bodyCoverage.highFittedBodyPaint.sourceSkinRecordSha256,
      '882aeb927f9bde0492c67fcaac693d57614925a3aba8c3c21bc1a5edb2ce0f17');
    assert.equal(manifest.skin.live.fileName, 'hero-skin-albedo-512.png');
    assert.equal(manifest.skin.live.width, 512);
    assert.equal(manifest.skin.live.height, 512);
    assert.equal(manifest.skin.live.sha256, createHash('sha256').update(liveSkinA).digest('hex'));
    assert.equal(manifest.eyes.fileName, HERO_EYES.fileName);
    assert.equal(manifest.eyes.sha256, HERO_EYES.meshSha256);
    assert.equal(manifest.eyes.vertexCount, 96);
    assert.equal(manifest.eyes.triangleCount, 172);
    assert.equal(manifest.eyes.shaderRegion, 16);
    assert.equal(manifest.eyes.binding.boneIndex, 11);
    assert.equal(manifest.eyes.binding.boneName, 'head');
    assert.equal(manifest.eyes.albedo.fileName, HERO_EYES.textureFileName);
    assert.equal(manifest.eyes.albedo.sha256, HERO_EYES.textureSha256);
    for (const [kind, descriptor] of Object.entries(HERO_EYES.sources)) {
      assert.equal(manifest.eyes.source.members[kind].archiveEntry, descriptor.archiveEntry);
      assert.equal(manifest.eyes.source.members[kind].sha256, descriptor.sha256);
      assert.equal(manifest.source.systemAssetPack.selectedEyeEntries[kind].sha256,
        descriptor.sha256);
    }
    for (const output of manifest.equipment.outputs) {
      assert.equal(output.gear.sha256, output.gear.sourceOutputSha256);
      assert.equal(output.gear.preservedByteIdentity, true);
      assert.equal(output.bat.sha256, output.bat.sourceOutputSha256);
      assert.equal(output.bat.preservedByteIdentity, true);
    }
    assert.deepEqual(manifest.equipment.renderedFamilies,
      ['helmet', 'pads', 'gloves']);
    assert.deepEqual(manifest.equipment.omittedUnderClothing,
      ['thigh-guard', 'lower-arm-guard']);
    for (const output of manifest.motion.outputs) {
      assert.equal(output.sha256, output.sourceOutputSha256);
      assert.equal(output.preservedByteIdentity, true);
      assert.match(output.sourceSkeletonSha256, /^[0-9a-f]{64}$/);
      assert.match(output.sourceMotionSha256, /^[0-9a-f]{64}$/);
    }
  } finally {
    await rm(firstDir, { recursive: true, force: true });
    await rm(secondDir, { recursive: true, force: true });
  }
});
