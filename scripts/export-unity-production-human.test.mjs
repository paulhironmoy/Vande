import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { encodeVpm, parseVpmHeader } from './export-unity-player-meshes.mjs';
import {
  FICTIONAL_IDENTITY,
  PRODUCTION_HEADER_BYTES,
  PRODUCTION_VERTEX_BYTES,
  UPSTREAM,
  applyFictionalIdentity,
  encodeProductionVpm,
  makeBoneJointResolver,
  parseObj,
  parseProductionVpmHeader,
} from './export-unity-production-human.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = join(
  ROOT,
  'unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters',
);
const MANIFEST_PATH = join(
  ROOT,
  'docs/licenses/makehuman-v1.3.0/production-human-provenance.json',
);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function topologyFromVpm(bytes) {
  const header = parseProductionVpmHeader(bytes);
  const positions = Array.from({ length: header.vertexCount }, (_, vertex) => {
    const offset = PRODUCTION_HEADER_BYTES + vertex * PRODUCTION_VERTEX_BYTES;
    return [bytes.readFloatLE(offset), bytes.readFloatLE(offset + 4), bytes.readFloatLE(offset + 8)];
  });
  const geometricIds = [];
  const geometricIdByPosition = new Map();
  for (let vertex = 0; vertex < header.vertexCount; vertex++) {
    const offset = PRODUCTION_HEADER_BYTES + vertex * PRODUCTION_VERTEX_BYTES;
    const key = bytes.subarray(offset, offset + 12).toString('hex');
    if (!geometricIdByPosition.has(key)) geometricIdByPosition.set(key, geometricIdByPosition.size);
    geometricIds.push(geometricIdByPosition.get(key));
  }
  const indexOffset = PRODUCTION_HEADER_BYTES + header.vertexCount * PRODUCTION_VERTEX_BYTES;
  const used = new Uint8Array(header.vertexCount);
  const edges = new Map();
  let degenerateTriangles = 0;
  for (let offset = 0; offset < header.indexCount; offset += 3) {
    const triangle = [0, 1, 2].map((corner) => bytes.readUInt16LE(indexOffset + (offset + corner) * 2));
    const [a, b, c] = triangle;
    const [ga, gb, gc] = triangle.map((index) => geometricIds[index]);
    used[a] = 1;
    used[b] = 1;
    used[c] = 1;
    const ab = positions[b].map((value, axis) => value - positions[a][axis]);
    const ac = positions[c].map((value, axis) => value - positions[a][axis]);
    const area = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    if (ga === gb || gb === gc || gc === ga || Math.hypot(...area) <= 1e-10) degenerateTriangles++;
    for (const [left, right] of [[ga, gb], [gb, gc], [gc, ga]]) {
      const key = left < right ? `${left}/${right}` : `${right}/${left}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  const valences = [...edges.values()];
  return {
    vertices: header.vertexCount,
    geometricVertices: geometricIdByPosition.size,
    triangles: header.indexCount / 3,
    unusedVertices: used.reduce((sum, value) => sum + (value === 0 ? 1 : 0), 0),
    degenerateTriangles,
    undirectedEdges: edges.size,
    boundaryEdges: valences.filter((value) => value === 1).length,
    nonManifoldEdges: valences.filter((value) => value !== 2).length,
    maximumEdgeValence: Math.max(...valences),
  };
}

test('OBJ parser triangulates and reverses a quad deterministically', () => {
  const mesh = parseObj('v -1 0 0\nv 1 0 0\nv 1 1 0\nv -1 1 0\nf 1 2 3 4\n');
  assert.deepEqual(mesh.positions, [[-1, 0, 0], [1, 0, 0], [1, 1, 0], [-1, 1, 0]]);
  assert.deepEqual(mesh.triangles, [0, 2, 1, 0, 3, 2]);
  assert.deepEqual(mesh.triangleTexcoords, [null, null, null, null, null, null]);
});

test('OBJ parser preserves independent UV corners and seam identities', () => {
  const mesh = parseObj([
    'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0',
    'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1', 'vt 0.5 0.5',
    'f 1/1 2/2 3/3',
    'f 1/5 3/3 4/4',
    '',
  ].join('\n'));
  assert.deepEqual(mesh.texcoords, [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]]);
  assert.deepEqual(mesh.triangles, [0, 2, 1, 0, 3, 2]);
  assert.deepEqual(mesh.triangleTexcoords, [0, 2, 1, 4, 3, 2]);
  assert.notEqual(mesh.triangleTexcoords[0], mesh.triangleTexcoords[3],
    'the same source position may retain two UV seam corners');
});

test('VPM2 encoder records UV0 while retained VPM1 remains independently readable', () => {
  const triangle = {
    vertices: [
      { position: [0, 0, 0], normal: [0, 0, 1], bindPos: [0, 0, 0], uv: [0, 0], region: 0, bone0: 0, bone1: 0, weight0: 0xffff, weight1: 0 },
      { position: [1, 0, 0], normal: [0, 0, 1], bindPos: [1, 0, 0], uv: [1, 0], region: 1, bone0: 1, bone1: 0, weight0: 0xffff, weight1: 0 },
      { position: [0, 1, 0], normal: [0, 0, 1], bindPos: [0, 1, 0], uv: [0, 1], region: 2, bone0: 2, bone1: 0, weight0: 0xffff, weight1: 0 },
    ],
    indices: [0, 1, 2],
  };
  const vpm2 = encodeProductionVpm(triangle);
  const vpm2Header = parseProductionVpmHeader(vpm2);
  assert.deepEqual({ magic: vpm2Header.magic, version: vpm2Header.version, vertexBytes: vpm2Header.vertexBytes },
    { magic: 'VPM2', version: 2, vertexBytes: 52 });
  assert.equal(vpm2.readFloatLE(PRODUCTION_HEADER_BYTES + 36), 0);
  assert.equal(vpm2.readFloatLE(PRODUCTION_HEADER_BYTES + 40), 0);
  assert.equal(vpm2.readFloatLE(PRODUCTION_HEADER_BYTES + PRODUCTION_VERTEX_BYTES + 36), 1);
  assert.equal(vpm2.readFloatLE(PRODUCTION_HEADER_BYTES + PRODUCTION_VERTEX_BYTES + 40), 0);
  assert.throws(() => parseVpmHeader(vpm2), /Unexpected VPM1 magic/);

  const retained = encodeVpm({
    vertices: triangle.vertices.map(({ uv: _uv, ...vertex }) => vertex),
    indices: triangle.indices,
  });
  const retainedHeader = parseVpmHeader(retained);
  assert.equal(retainedHeader.magic, 'VPM1');
  assert.equal(retainedHeader.version, 1);
  assert.throws(() => parseProductionVpmHeader(retained), /Unexpected VPM2 magic/);
});

test('OBJ parser admits only body faces and excludes joint/helper geometry', () => {
  const mesh = parseObj([
    'v -1 0 0', 'v 1 0 0', 'v 1 1 0', 'v -1 1 0',
    'g body', 'f 1 2 3 4',
    'g helper-genital', 'f 1 2 3',
    'g joint-head', 'f 1 3 4',
    '',
  ].join('\n'), { includeGroup: 'body' });
  assert.deepEqual(mesh.triangles, [0, 2, 1, 0, 3, 2]);
  assert.equal(mesh.faceCountsByGroup.body, 2);
  assert.equal(mesh.faceCountsByGroup['helper-genital'], 1);
  assert.equal(mesh.faceCountsByGroup['joint-head'], 1);
});

test('bone resolver collapses descendants to the nearest VANDE joint', () => {
  const skeleton = {
    bones: {
      root: { parent: null },
      spine05: { parent: 'root' },
      spine04: { parent: 'spine05' },
      spine03: { parent: 'spine04' },
      spine02: { parent: 'spine03' },
      spine01: { parent: 'spine02' },
      neck01: { parent: 'spine01' },
      neck02: { parent: 'neck01' },
      neck03: { parent: 'neck02' },
      head: { parent: 'neck03' },
      jaw: { parent: 'head' },
      clavicle: { parent: 'spine01' },
    },
  };
  const resolveBone = makeBoneJointResolver(skeleton);
  assert.equal(resolveBone('jaw'), 4);
  assert.equal(resolveBone('clavicle'), 2);
  assert.equal(resolveBone('spine04'), 1);
});

test('fictional identity warp is symmetric and finite', () => {
  const left = applyFictionalIdentity([0.16, 1.66, 0.10]);
  const right = applyFictionalIdentity([-0.16, 1.66, 0.10]);
  assert.equal(left[0], -right[0]);
  assert.equal(left[1], right[1]);
  assert.equal(left[2], right[2]);
  assert.ok(left.every(Number.isFinite));
  assert.equal(FICTIONAL_IDENTITY.sourceReference, 'none');
  assert.equal(FICTIONAL_IDENTITY.symmetry, 'bilateral');
  const samples = [
    [0.22, 1.40, 0.05],
    [0.14, 1.03, -0.03],
    [0.08, 0.32, 0.02],
    [0.10, 1.72, 0.10],
  ];
  for (const point of samples) {
    const warped = applyFictionalIdentity(point);
    assert.ok(Math.hypot(...warped.map((value, axis) => value - point[axis])) <= 0.012,
      `identity warp remains subtle at ${point}`);
  }
});

test('pinned upstream descriptors use exact stable hashes', () => {
  assert.equal(UPSTREAM.commit, '1f508f6083b2f823dab15de924b3bde72e08d77c');
  assert.equal(UPSTREAM.license, 'CC0-1.0');
  for (const source of Object.values(UPSTREAM.sourceFiles))
    assert.match(source.sha256, /^[0-9a-f]{64}$/);
});

test('repository archives the exact checksum-bound upstream licence terms', async () => {
  for (const kind of ['licenseSummary', 'licenseAssets']) {
    const source = UPSTREAM.sourceFiles[kind];
    const bytes = await readFile(join(ROOT, 'docs/licenses/makehuman-v1.3.0', source.localName));
    assert.equal(digest(bytes), source.sha256);
  }
  const installedToolLicense = await readFile(join(ROOT, 'node_modules/meshoptimizer/LICENSE.md'));
  const archivedToolLicense = await readFile(join(ROOT, 'docs/licenses/meshoptimizer-1.1.1/LICENSE.md'));
  assert.equal(digest(installedToolLicense), 'f03037ca7bad1e3eb7f4a63fa6084a8baabd5ba30d3c239a9a7f35705d873e26');
  assert.deepEqual(archivedToolLicense, installedToolLicense);
  const skinSnapshot = await readFile(
    join(ROOT, 'docs/licenses/makehuman-v1.3.0/SYSTEM-ASSET-SKIN-SNAPSHOT.md'));
  assert.equal(digest(skinSnapshot),
    'e932cbb0e6222fdea072cd24c4d6576e68d991e8b5819b3a4eadf44252cccfdf');
});

test('generated candidate meshes satisfy VPM2 UV, LOD and provenance bounds', async () => {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  assert.equal(manifest.schema, 'vande-production-human-provenance/v1');
  assert.equal(manifest.status,
    'TECHNICAL COMPONENT CANDIDATE / CURRENT PRESENTATION REJECTED');
  assert.equal(manifest.license, 'CC0-1.0');
  assert.match(manifest.creationAcquisition.sourceAcquiredAtUtc,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.match(manifest.creationAcquisition.derivativeCreatedAtUtc,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(manifest.reviewerStatus.independentReviewer, '/root/production_art_independent_audit');
  assert.equal(manifest.reviewerStatus.readinessStatus,
    'TECHNICAL COMPONENT CANDIDATE / CURRENT PRESENTATION REJECTED');
  assert.match(manifest.reviewerStatus.recordedAtUtc,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.match(manifest.reviewerStatus.independentDecision, /^REJECT \/ REWORK/);
  assert.equal(manifest.evidence.independentVisual.status, 'REJECT / REWORK');
  assert.equal(manifest.evidence.independentVisual.buildId, '38924bd+efc5ca4ae735');
  assert.match(manifest.evidence.independentVisual.evidence,
    /unity-webgl-diagnostic-efc5ca4ae735-20261030T060700Z\/live-frame\.png$/);
  assert.match(manifest.acceptance.independentVisual, /^REJECT \/ REWORK/);
  assert.match(manifest.acceptance.clipping, /^VISUAL LAYERING REJECTED IN CAPTURE/);
  assert.equal(manifest.buildExposure.stage, 'Stage 1 Practice only');
  assert.ok(manifest.buildExposure.roles.includes('fielder'));
  assert.match(manifest.buildExposure.qualityTiers.LOD0, /26,756 triangles; near Premium hero only/);
  assert.match(manifest.buildExposure.qualityTiers.LOD1, /every fielder below 30 m/);
  assert.match(manifest.buildExposure.qualityTiers.LOD1, /pace\/spin bowler at or beyond 12 m/);
  assert.match(manifest.buildExposure.qualityTiers.LOD2, /fielder at or beyond 30 m in High\/Premium/);
  assert.match(manifest.buildExposure.qualityTiers.LOD3, /fielder at or beyond 30 m in Balanced\/Medium or Lite\/Low/);
  assert.equal(manifest.buildExposure.distancePolicy.boundaryMetres, 30);
  assert.equal(manifest.buildExposure.distancePolicy.measure,
    'actual planar distance from the striker presentation reference');
  assert.equal(manifest.buildExposure.loadingPolicy.runtimeClustering, 'none');
  assert.match(manifest.buildExposure.loadingPolicy.farMeshes, /^lazy-decode/);
  assert.equal(manifest.buildExposure.loadingPolicy.dynamicBowlerOwner, 'loads LOD0 and LOD1 only');
  assert.deepEqual(manifest.buildExposure.fallbackOrderByRole.Wicketkeeper,
    ['licensed anatomy candidate', 'procedural emergency geometry']);
  assert.deepEqual(manifest.buildExposure.fallbackOrderByRole.Fielder,
    ['licensed anatomy candidate', 'procedural emergency geometry']);
  assert.deepEqual(manifest.buildExposure.fallbackOrderByRole.Batter,
    ['licensed anatomy candidate', 'retained VANDE VPM1 batter mesh', 'procedural emergency geometry']);
  assert.equal(manifest.repositoryPaths.manifest,
    'docs/licenses/makehuman-v1.3.0/production-human-provenance.json');
  assert.equal(manifest.technicalBudget.editorRuntimeFootprint.resourcePayloadBytes, 951_184);
  assert.equal(manifest.technicalBudget.editorRuntimeFootprint.sharedTeamMeshObjectsBytes, 2_864_016);
  assert.equal(manifest.technicalBudget.editorRuntimeFootprint.dynamicBowlerMeshObjectsBytes, 2_589_360);
  assert.equal(manifest.technicalBudget.editorRuntimeFootprint.combinedMeshObjectsBytes, 5_453_376);
  assert.equal(manifest.technicalBudget.editorRuntimeFootprint.rendererCount, 619);
  assert.equal(manifest.technicalBudget.editorRuntimeFootprint.materialCount, 30);
  assert.match(manifest.technicalBudget.editorRuntimeFootprint.status,
    /^PRE-VPM2 HISTORICAL EDITOR-ONLY \/ NON-CURRENT/);
  assert.match(manifest.technicalBudget.editorLoadCost.status, /^INDICATIVE ONLY/);
  assert.equal(manifest.technicalBudget.androidRuntimeMemory, 'UNPROVEN');
  assert.match(manifest.technicalBudget.androidInstalledSizeDelta, /^UNPROVEN/);
  assert.equal(manifest.technicalBudget.indiaWeightedReach, 'UNPROVEN');
  assert.equal(manifest.technicalBudget.physicalDeviceLoadCost, 'UNPROVEN');
  assert.equal(manifest.evidence.physicalDevice, 'NOT RUN');
  assert.equal(manifest.evidence.androidInstalledSize, 'UNPROVEN');
  assert.equal(manifest.evidence.automatedResults.at(-1).observed, '272 pass / 0 fail');
  assert.match(manifest.evidence.testDevice, /MacBookPro18,1/);
  assert.ok(manifest.evidence.rightsAndSource.every((path) => typeof path === 'string' && path.length > 0));
  assert.equal(manifest.outputs.length, 4);
  assert.deepEqual(manifest.textureOutput, {
    path: 'unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters/human-skin-albedo-1024.png',
    bytes: 1_065_858,
    sha256: 'a7700f7a538fa723647296416b77713aefda9e6ad3ba037f30bf4c9eab6ad0d0',
    width: 1024,
    height: 1024,
    colourSpace: 'sRGB',
    mipmaps: true,
    sourceAIStatus: 'not AI-generated; exact MakeHuman system-asset derivative',
  });
  assert.match(manifest.aiStatus, /^no generative-AI image/);
  assert.equal(manifest.upstream.systemAssets.officialIndexCommit,
    '09ec378f9aff822a1c95d55bac19e6367ff92e12');
  assert.equal(manifest.upstream.systemAssets.archiveSha256,
    'b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107');
  assert.match(manifest.upstream.systemAssets.repositoryLimitation,
    /no longer publicly addressable/);
  assert.deepEqual(manifest.outputs.map((output) => output.path.split('/').at(-1)),
    ['human-lod0.bytes', 'human-lod1.bytes', 'human-lod2.bytes', 'human-lod3.bytes']);
  assert.deepEqual(manifest.outputs.map(({ vertexCount, triangleCount, bytes, sha256 }) => ({
    vertexCount, triangleCount, bytes, sha256,
  })), [
    {
      vertexCount: 14_517,
      triangleCount: 26_756,
      bytes: 915_436,
      sha256: '1434513f204f06980e4d7e4b81a07052fc967c534c56d668ca84af1157071e0d',
    },
    {
      vertexCount: 2_332,
      triangleCount: 4_000,
      bytes: 145_280,
      sha256: '479f641cf20358a8b426b7e8825718f3acf7a6752a35ea05d7a6cf6d288e139f',
    },
    {
      vertexCount: 1_229,
      triangleCount: 2_000,
      bytes: 75_924,
      sha256: 'c5de2b10e4cab76bcc9dedbd5662c0cf7c7b9b38d7d297d9eb2cadf151ee1d3d',
    },
    {
      vertexCount: 774,
      triangleCount: 1_200,
      bytes: 47_464,
      sha256: '976edf587f052b1d0517ae6c16ed133ca7ee78d07c4f92fb71a988b13b12d9da',
    },
  ], 'the declared bake baseline is byte-deterministic');
  assert.equal(manifest.modifications.fictionalIdentity.sourceReference, 'none');
  assert.deepEqual(manifest.upstream.sourceCopyrightNoticesByFile, {
    mesh: [
      'Copyright (C) 2020 Data Collection AB, https://www.datacollection.se',
      'Copyright (C) 2020 Joel Palmius',
      'Copyright (C) 2020 Jonas Hauquier',
    ],
    skeleton: '(c) 2020 Data Collection AB, Joel Palmius, Jonas Hauquier',
    weights: '(c) 2021 Data Collection AB, Joel Palmius, Jonas Hauquier',
    skin: 'official MakeHuman system asset; exact index identifies makehuman_system as author/source and CC0 as licence',
  });
  assert.ok(manifest.upstream.sourceCopyrightNotice.includes(
    '(c) 2021 Data Collection AB, Joel Palmius, Jonas Hauquier'));
  assert.equal(manifest.modifications.sourceGeometryPolicy.admittedFaceGroup, 'body');
  assert.ok(manifest.modifications.sourceGeometryPolicy.admittedSourceTriangles > 0);
  assert.ok(manifest.modifications.sourceGeometryPolicy.excludedSourceTriangles > 0);
  assert.equal(manifest.modifications.sourceGeometryPolicy.admittedRenderVerticesAfterUvSeams,
    manifest.outputs[0].vertexCount);
  assert.ok(manifest.modifications.sourceGeometryPolicy.uvSeamDuplicateVertices > 0);
  assert.equal(manifest.modifications.sourceGeometryPolicy.admittedSourceTriangles,
    manifest.outputs[0].triangleCount);
  assert.ok(manifest.modifications.sourceGeometryPolicy.excludedUnreferencedVertices > 0);
  assert.equal(
    Object.keys(manifest.modifications.sourceGeometryPolicy.sourceTriangleGroups)
      .filter((group) => group.startsWith('helper-') || group.startsWith('joint-'))
      .some((group) => group === 'body'),
    false,
  );
  assert.equal(manifest.acceptance.physicalDevice, 'NOT RUN');
  assert.equal(manifest.acceptance.androidInstalledDelta, 'UNPROVEN');

  const toolchainPaths = manifest.modifications.toolchain.map(({ path }) => path);
  assert.deepEqual(toolchainPaths, [
    'scripts/export-unity-production-human.mjs',
    'package.json',
    'package-lock.json',
    'node_modules/meshoptimizer/package.json',
    'node_modules/meshoptimizer/meshopt_simplifier.js',
    'node_modules/meshoptimizer/LICENSE.md',
    'docs/licenses/meshoptimizer-1.1.1/LICENSE.md',
  ]);
  for (const record of manifest.modifications.toolchain) {
    const bytes = await readFile(join(ROOT, record.path));
    assert.equal(bytes.length, record.bytes);
    assert.equal(digest(bytes), record.sha256, `${record.path} is checksum-bound`);
  }
  assert.equal(manifest.modifications.toolSha256,
    manifest.modifications.toolchain.find(({ path }) => path === manifest.modifications.tool).sha256);
  assert.deepEqual({
    node: manifest.modifications.bakeRuntime.node,
    v8: manifest.modifications.bakeRuntime.v8,
    platform: manifest.modifications.bakeRuntime.platform,
    architecture: manifest.modifications.bakeRuntime.architecture,
  }, {
    node: 'v26.0.0',
    v8: '14.6.202.33-node.19',
    platform: 'darwin',
    architecture: 'arm64',
  });
  assert.match(manifest.modifications.bakeRuntime.sameRuntimeRepeatability, /^PASS/);
  assert.match(manifest.modifications.bakeRuntime.crossRuntimePlatformDeterminism, /^UNPROVEN/);
  assert.equal(manifest.modifications.simplifier.package, 'meshoptimizer');
  assert.equal(manifest.modifications.simplifier.version, '1.1.1');
  assert.equal(manifest.modifications.simplifier.license, 'MIT');
  assert.equal(manifest.modifications.simplifier.flags.length, 0);
  assert.match(manifest.modifications.simplifier.crossRuntimePlatformDeterminism, /^UNPROVEN/);

  for (const output of manifest.outputs) {
    const bytes = await readFile(join(ROOT, output.path));
    const header = parseProductionVpmHeader(bytes);
    assert.equal(header.vertexCount, output.vertexCount);
    assert.equal(header.indexCount, output.indexCount);
    assert.equal(bytes.length, output.bytes);
    assert.equal(digest(bytes), output.sha256);
    const topology = topologyFromVpm(bytes);
    assert.deepEqual(output.topology, topology, `LOD${output.lod} topology evidence matches encoded bytes`);
    assert.equal(topology.unusedVertices, 0, `LOD${output.lod} uses every encoded vertex`);
    assert.equal(topology.degenerateTriangles, 0, `LOD${output.lod} has no degenerate triangle`);
    assert.equal(topology.boundaryEdges, 0, `LOD${output.lod} is watertight`);
    assert.equal(topology.nonManifoldEdges, 0, `LOD${output.lod} is two-manifold`);
    assert.equal(topology.maximumEdgeValence, 2, `LOD${output.lod} has exactly two faces per edge`);
    assert.equal(output.uv.edgesOverLimit, 0, `LOD${output.lod} has no cross-atlas UV edge`);
    assert.ok(output.uv.maximumEdgeLength <= output.uv.maximumAllowedEdgeLength,
      `LOD${output.lod} maximum UV edge ${output.uv.maximumEdgeLength}`);
    assert.ok(output.uv.minimum.every((value) => value >= 0));
    assert.ok(output.uv.maximum.every((value) => value <= 1));
    assert.equal(output.indexCount % 3, 0);
    assert.ok(output.bounds.size[1] >= 1.65 && output.bounds.size[1] <= 1.95,
      `LOD${output.lod} adult height ${output.bounds.size[1]}`);
    assert.ok(Math.abs(output.bounds.centre[0]) <= 0.002,
      `LOD${output.lod} bilateral centre ${output.bounds.centre[0]}`);
    for (let vertex = 0; vertex < header.vertexCount; vertex++) {
      const offset = PRODUCTION_HEADER_BYTES + vertex * PRODUCTION_VERTEX_BYTES;
      const normal = [12, 16, 20].map((relative) => bytes.readFloatLE(offset + relative));
      const uv = [36, 40].map((relative) => bytes.readFloatLE(offset + relative));
      assert.ok(normal.every(Number.isFinite));
      assert.ok(Math.hypot(...normal) >= 0.99 && Math.hypot(...normal) <= 1.01);
      assert.ok(uv.every(Number.isFinite));
      assert.ok(bytes.readUInt8(offset + 44) <= 3, 'shader region fits the four-region Unity material contract');
      assert.ok(bytes.readUInt8(offset + 45) < 17, 'first bone fits the canonical rig');
      assert.ok(bytes.readUInt8(offset + 46) < 17, 'second bone fits the canonical rig');
      assert.equal(bytes.readUInt8(offset + 47), 0, 'reserved vertex byte remains zero');
      assert.equal(bytes.readUInt16LE(offset + 48) + bytes.readUInt16LE(offset + 50), 0xffff,
        'quantized skin weights remain normalized');
    }
  }
  assert.ok(manifest.outputs[0].triangleCount <= 40_000);
  assert.ok(manifest.outputs[1].triangleCount <= 4_000);
  assert.ok(manifest.outputs[2].triangleCount <= 2_000);
  assert.ok(manifest.outputs[3].triangleCount <= 1_200);
  assert.ok(manifest.outputs[1].triangleCount < manifest.outputs[0].triangleCount);
  assert.ok(manifest.outputs[2].triangleCount < manifest.outputs[1].triangleCount);
  assert.ok(manifest.outputs[3].triangleCount < manifest.outputs[2].triangleCount);
  for (let lod = 1; lod < manifest.outputs.length; lod++) {
    assert.ok(manifest.outputs[lod].bytes < manifest.outputs[lod - 1].bytes);
    assert.equal(manifest.outputs[lod].simplification.flags.length, 0);
    assert.deepEqual(manifest.outputs[lod].simplification.attributeWeights, { uv: 10 });
    assert.equal(manifest.outputs[lod].simplification.vertexLock, null);
    assert.equal(manifest.outputs[lod].simplification.achievedTriangles,
      manifest.outputs[lod].triangleCount);
    assert.ok(manifest.outputs[lod].simplification.observedRelativeError <=
      manifest.outputs[lod].simplification.maximumRelativeError);
  }
  assert.equal(manifest.technicalBudget.rawMeshDerivativeBytes,
    manifest.outputs.reduce((sum, output) => sum + output.bytes, 0));
  assert.equal(manifest.technicalBudget.rawDerivativeBytes,
    manifest.outputs.reduce((sum, output) => sum + output.bytes, 0) + manifest.textureOutput.bytes);
  assert.deepEqual(manifest.technicalBudget.deltaFromPreUvCandidate, {
    previousVpm1MeshBytes: 951_184,
    currentVpm2MeshBytes: 1_184_104,
    meshBytesDelta: 232_920,
    texturePngBytesDelta: 1_065_858,
    totalRepositoryPayloadBytesDelta: 1_298_778,
    installedPlaySplitDelta: 'UNPROVEN',
    runtimeCpuGpuMemoryDelta: 'UNPROVEN',
  });
  const texture = await readFile(join(ROOT, manifest.textureOutput.path));
  assert.equal(texture.length, manifest.textureOutput.bytes);
  assert.equal(digest(texture), manifest.textureOutput.sha256);
});
