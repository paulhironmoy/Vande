import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  DEFAULT_V3_SOURCE_DIR,
  V3_BONE_COUNT,
  V3_BONE_NAMES,
  VPM3_HEADER_BYTES,
  VPM3_VERTEX_BYTES,
  VSK1_BONE_BYTES,
  VSK1_HEADER_BYTES,
  exportProductionCharacterV3,
  parseVpm3Header,
  parseVsk1,
  quantizeV3Weights,
} from './export-unity-production-character-v3.mjs';

// The pinned MakeHuman files are fetched separately and are not in the repository. Without them the three tests that bake
// from the source are skipped (the reason is printed in the report) and the other two still run.
const SOURCE_FILES = ['base.obj', 'default.mhskel', 'default_weights.mhw'];
const needsSource = SOURCE_FILES.every((name) => existsSync(join(DEFAULT_V3_SOURCE_DIR, name)))
  ? {}
  : {
      skip: `the pinned MakeHuman source (${SOURCE_FILES.join(', ')}) is not in ${DEFAULT_V3_SOURCE_DIR}; ` +
        'docs/licenses/makehuman-v1.3.0/README.md lists the pinned checksums',
    };

async function withScratch(prefix, callback) {
  const path = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await callback(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}

test('compact production skeleton declaration is stable and bounded', () => {
  assert.equal(V3_BONE_NAMES.length, 75);
  assert.equal(V3_BONE_COUNT, 75);
  assert.equal(new Set(V3_BONE_NAMES).size, 75);
  assert.equal(V3_BONE_NAMES[0], 'root');
  assert.ok(V3_BONE_NAMES.includes('spine05'));
  assert.ok(V3_BONE_NAMES.includes('finger5-3.R'));
  assert.ok(V3_BONE_NAMES.includes('foot.L'));
});

test('four-weight quantization is deterministic, bounded and sums to 255', () => {
  const entries = [[7, 0.13], [3, 0.31], [2, 0.31], [1, 0.19], [8, 0.06]];
  const first = quantizeV3Weights(entries);
  const second = quantizeV3Weights([...entries].reverse());
  assert.deepEqual(first, second);
  assert.deepEqual(first.bones, [2, 3, 1, 7]);
  assert.equal(first.weights.reduce((sum, value) => sum + value, 0), 255);
  assert.ok(first.weights.every((value) => value >= 0 && value <= 255));
});

test('pinned MakeHuman source produces byte-identical VSK1 and VPM3 hero LODs', needsSource, async () => {
  await withScratch('vande-vpm3-a-', async (firstDir) => {
    await withScratch('vande-vpm3-b-', async (secondDir) => {
      const first = await exportProductionCharacterV3({ outputDir: firstDir });
      const second = await exportProductionCharacterV3({ outputDir: secondDir });
      assert.equal(first.status, 'TECHNICAL FOUNDATION ONLY / NOT PLAYER-FACING ACCEPTED');
      assert.equal(first.androidInstalledSizeDelta, 'UNPROVEN');
      assert.equal(first.indiaWeightedReach, 'UNPROVEN');
      assert.equal(first.skeleton.bytes, VSK1_HEADER_BYTES + V3_BONE_COUNT * VSK1_BONE_BYTES);
      assert.equal(first.meshes.length, 2);
      assert.deepEqual(first.meshes.map(({ triangleCount }) => triangleCount), [26_756, 4_000]);

      const pairs = [
        [first.skeleton.path, second.skeleton.path],
        ...first.meshes.map((mesh, index) => [mesh.path, second.meshes[index].path]),
      ];
      for (const [left, right] of pairs)
        assert.deepEqual(await readFile(left), await readFile(right));

      const skeletonBytes = await readFile(first.skeleton.path);
      const skeleton = parseVsk1(skeletonBytes);
      const semanticCounts = new Uint8Array(17);
      for (let index = 0; index < skeleton.boneCount; index++) {
        const record = VSK1_HEADER_BYTES + index * VSK1_BONE_BYTES;
        const parent = skeletonBytes.readInt16LE(record);
        const semantic = skeletonBytes.readUInt16LE(record + 2);
        assert.ok(parent >= -1 && parent < index);
        if (semantic !== 0xffff) semanticCounts[semantic]++;
      }
      assert.deepEqual([...semanticCounts], new Array(17).fill(1));

      for (const meshRecord of first.meshes) {
        const bytes = await readFile(meshRecord.path);
        const header = parseVpm3Header(bytes);
        assert.equal(header.skeletonId, skeleton.skeletonId);
        assert.equal(header.vertexBytes, VPM3_VERTEX_BYTES);
        for (let index = 0; index < header.vertexCount; index++) {
          const vertex = VPM3_HEADER_BYTES + index * VPM3_VERTEX_BYTES;
          const boneOffset = vertex + 61;
          const weightOffset = vertex + 65;
          for (let influence = 0; influence < 4; influence++)
            assert.ok(bytes.readUInt8(boneOffset + influence) < V3_BONE_COUNT);
          let total = 0;
          for (let influence = 0; influence < 4; influence++)
            total += bytes.readUInt8(weightOffset + influence);
          assert.equal(total, 255);
        }
      }
    });
  });
});

test('VSK1 and VPM3 reject corrupted or trailing bytes', needsSource, async () => {
  await withScratch('vande-vpm3-corrupt-', async (outputDir) => {
    const result = await exportProductionCharacterV3({ outputDir });
    const skeleton = await readFile(result.skeleton.path);
    const corruptSkeleton = Buffer.from(skeleton);
    corruptSkeleton[VSK1_HEADER_BYTES + 10] ^= 0x01;
    assert.throws(() => parseVsk1(corruptSkeleton), /skeleton ID/);
    assert.throws(() => parseVsk1(Buffer.concat([skeleton, Buffer.from([0])])), /header or byte length/);

    const mesh = await readFile(result.meshes[0].path);
    assert.throws(() => parseVpm3Header(Buffer.concat([mesh, Buffer.from([0])])), /header or byte length/);
  });
});

test('source checksum verification rejects a modified pinned asset', needsSource, async () => {
  await withScratch('vande-vpm3-source-', async (sourceDir) => {
    for (const name of ['base.obj', 'default.mhskel', 'default_weights.mhw'])
      await copyFile(join(DEFAULT_V3_SOURCE_DIR, name), join(sourceDir, name));
    const meshPath = join(sourceDir, 'base.obj');
    const mesh = await readFile(meshPath);
    mesh[mesh.length - 1] ^= 0x01;
    await writeFile(meshPath, mesh);
    await assert.rejects(
      exportProductionCharacterV3({ sourceDir, outputDir: join(sourceDir, 'out') }),
      /SHA-256 .* does not match pinned/,
    );
  });
});
