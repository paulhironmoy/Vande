import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

import { encodeVpm3, parseVpm3Header } from './export-unity-production-character-v3.mjs';
import {
  DEFAULT_KIT_ARCHIVE,
  DEFAULT_KIT_SELECTION,
  KIT_MOBILE_PROFILES,
  allocateKitTriangleBudgets,
  buildKitMesh,
  exportProductionKit,
  parseMhcloVertexMap,
  readSelectedZipEntries,
  simplifyKitMesh,
  transferMappedWeights,
} from './export-unity-production-kit.mjs';

const countedMesh = (triangles) => ({ indices: new Array(triangles * 3).fill(0) });

test('default kit regions match the production character shader contract', () => {
  assert.deepEqual(
    DEFAULT_KIT_SELECTION.map(({ id, region }) => [id, region]),
    [['uniform', 1], ['hair', 11], ['shoes', 3]],
  );
});

test('MHCLO parser accepts direct and barycentric transfer records', () => {
  const value = parseMhcloVertexMap(`
    # synthetic CC0-style fixture
    name fixture
    verts 0
    7
    1 2 3 0.25 0.50 0.25 0 0 0
    delete_verts
  `);
  assert.deepEqual(value, [
    { indices: [7], weights: [1] },
    { indices: [1, 2, 3], weights: [0.25, 0.5, 0.25] },
  ]);
});

test('MHCLO parser rejects a hole between destination sections', () => {
  assert.throws(
    () => parseMhcloVertexMap('verts 0\n1\nverts 2\n2\n'),
    /unmapped garment vertex/,
  );
});

test('base-body weights transfer deterministically through garment mappings', () => {
  const base = [
    new Map([[1, 1]]),
    new Map([[2, 1]]),
    new Map([[1, 0.5], [2, 0.5]]),
  ];
  const result = transferMappedWeights(base, [
    { indices: [0], weights: [1] },
    { indices: [0, 1, 2], weights: [0.25, 0.5, 0.25] },
  ]);
  assert.deepEqual(result[0], [[1, 1]]);
  assert.deepEqual([...result[1]].sort(([a], [b]) => a - b), [[1, 0.375], [2, 0.625]]);
});

test('generic kit mesh is VPM3-compatible and deterministic', () => {
  const obj = {
    positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
    texcoords: [[0, 0], [1, 0], [0, 1]],
    triangles: [0, 1, 2],
    triangleTexcoords: [0, 1, 2],
  };
  const weights = [[[1, 1]], [[1, 1]], [[2, 1]]];
  const mesh = buildKitMesh(obj, weights, (position) => [...position], 4);
  const skeletonId = Buffer.from('0011223344556677', 'hex');
  const first = encodeVpm3(mesh, skeletonId);
  const second = encodeVpm3(mesh, skeletonId);
  assert.deepEqual(first, second);
  const header = parseVpm3Header(first);
  assert.equal(header.vertexCount, 3);
  assert.equal(header.indexCount, 3);
  assert.equal(header.skeletonId, skeletonId.toString('hex'));
});

test('generic kit normals weld source positions across UV seams', () => {
  const obj = {
    positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]],
    texcoords: [[0, 0], [1, 0], [0, 1], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9]],
    triangles: [0, 1, 2, 0, 3, 1],
    triangleTexcoords: [0, 1, 2, 3, 4, 5],
  };
  const weights = obj.positions.map(() => [[1, 1]]);
  const mesh = buildKitMesh(obj, weights, (position) => [...position], 1);
  assert.equal(mesh.vertices.length, 6, 'each face retains its independent UV seam corners');
  const shared = mesh.vertices.filter(({ sourcePositionIndex }) => sourcePositionIndex === 0);
  assert.equal(shared.length, 2);
  assert.deepEqual(shared[0].normal, shared[1].normal,
    'one cloth position cannot acquire a hard normal merely because its UV is split');
  const expected = 1 / Math.sqrt(2);
  assert.ok(Math.abs(shared[0].normal[1] - expected) < 1e-9);
  assert.ok(Math.abs(shared[0].normal[2] - expected) < 1e-9);
});

test('mobile profile allocation is deterministic and exactly bounded', () => {
  const meshes = [countedMesh(7168), countedMesh(1050), countedMesh(4128)];
  const hero = allocateKitTriangleBudgets(meshes, 6000);
  const live = allocateKitTriangleBudgets(meshes, 4000);
  const faceProtected = allocateKitTriangleBudgets(meshes, 2490);
  assert.deepEqual(hero, [3484, 510, 2006]);
  assert.deepEqual(live, [2322, 340, 1338]);
  assert.deepEqual(faceProtected, [1446, 212, 832]);
  assert.equal(hero.reduce((sum, value) => sum + value, 0), 6000);
  assert.equal(live.reduce((sum, value) => sum + value, 0), 4000);
  assert.equal(faceProtected.reduce((sum, value) => sum + value, 0), 2490);
  assert.deepEqual(KIT_MOBILE_PROFILES.map(({ lod, maximumCombinedTriangles }) =>
    [lod, maximumCombinedTriangles]), [[1, 6000], [2, 4000], [3, 2490]]);
});

test('mobile simplifier preserves VPM3 skin records within its target', async () => {
  await MeshoptSimplifier.ready;
  const positions = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ];
  const indices = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6,
    0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
  ];
  const high = {
    vertices: positions.map((position) => ({
      position, bindPos: [...position], normal: [0, 1, 0], tangent: [1, 0, 0, 1],
      uv: [(position[0] + 1) / 2, (position[1] + 1) / 2],
      region: 1, bones: [1, 0, 0, 0], weights: [255, 0, 0, 0],
    })),
    indices,
  };
  const low = simplifyKitMesh(high, 8);
  assert.ok(low.indices.length / 3 <= 8);
  assert.ok(low.indices.length >= 12);
  assert.ok(low.vertices.every((vertex) => vertex.weights.reduce((sum, value) => sum + value, 0) === 255));
});

test('ZIP reader inflates only selected asset stems', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vande-kit-test-'));
  const archive = join(directory, 'assets.zip');
  try {
    await writeFile(archive, Buffer.from(zipSync({
      'assets/kit/hero.obj': strToU8('v 0 0 0\n'),
      'assets/kit/hero.mhclo': strToU8('verts 1\n0\n'),
      'assets/unrelated/large.bin': new Uint8Array(1024),
    })));
    const entries = await readSelectedZipEntries(archive, [
      { id: 'fixture', stem: 'hero', region: 1, required: true },
    ]);
    assert.deepEqual([...entries.keys()].sort(), [
      'assets/kit/hero.mhclo',
      'assets/kit/hero.obj',
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('pinned CC0 kit exports deterministic 2,490-triangle protected-face LOD3', async (context) => {
  try { await readFile(DEFAULT_KIT_ARCHIVE); }
  catch { context.skip('verified MakeHuman CC0 scratch archive is absent'); return; }
  const firstDir = await mkdtemp(join(tmpdir(), 'vande-kit-face-a-'));
  const secondDir = await mkdtemp(join(tmpdir(), 'vande-kit-face-b-'));
  try {
    const first = await exportProductionKit({ outputDir: firstDir });
    const second = await exportProductionKit({ outputDir: secondDir });
    assert.equal(first.source.license, 'CC0-1.0');
    assert.equal(first.source.archiveSha256, second.source.archiveSha256);
    const profile = first.mobileProfiles.find(({ lod }) => lod === 3);
    assert.deepEqual(
      { usage: profile.usage, maximum: profile.maximumCombinedTriangles, achieved: profile.achievedCombinedTriangles },
      { usage: 'face-protected-live-batter', maximum: 2490, achieved: 2490 },
    );
    const expected = new Map([['uniform', 1446], ['hair', 212], ['shoes', 832]]);
    for (const asset of first.assets) {
      const lod = asset.lods.find(({ lod: value }) => value === 3);
      assert.equal(lod.triangleCount, expected.get(asset.id));
      assert.deepEqual(
        await readFile(join(firstDir, `${asset.id}-lod3.bytes`)),
        await readFile(join(secondDir, `${asset.id}-lod3.bytes`)),
      );
    }
    const normalizedProvenance = (bytes) => JSON.parse(bytes, (key, value) =>
      key === 'outputPath' && typeof value === 'string'
        ? value.slice(value.lastIndexOf('/') + 1)
        : value);
    assert.deepEqual(
      normalizedProvenance(await readFile(join(firstDir, 'generic-kit-provenance.json'))),
      normalizedProvenance(await readFile(join(secondDir, 'generic-kit-provenance.json'))),
    );
  } finally {
    await rm(firstDir, { recursive: true, force: true });
    await rm(secondDir, { recursive: true, force: true });
  }
});
