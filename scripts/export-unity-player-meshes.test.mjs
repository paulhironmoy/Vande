import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { BONE_COUNT, HEADER_BYTES, VERTEX_BYTES, parseVpmHeader } from './export-unity-player-meshes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = join(ROOT, 'unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/Characters');

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('generated Unity player meshes satisfy VPM1 and provenance contracts', async () => {
  const manifest = JSON.parse(await readFile(join(OUTPUT_DIR, 'provenance.json'), 'utf8'));
  assert.equal(manifest.schema, 'vande-unity-player-mesh-provenance/v1');
  assert.equal(manifest.acceptance, 'UNPROVEN');
  assert.equal(manifest.binary.boneCount, BONE_COUNT);
  assert.equal(manifest.outputs.length, 4);
  assert.deepEqual(
    manifest.outputs.map(({ role, lod }) => `${role}:${lod}`),
    ['batter:0', 'batter:1', 'bowler:0', 'bowler:1'],
  );

  for (const output of manifest.outputs) {
    const bytes = await readFile(join(ROOT, output.path));
    const header = parseVpmHeader(bytes);
    assert.equal(header.vertexCount, output.vertexCount);
    assert.equal(header.indexCount, output.indexCount);
    assert.equal(bytes.length, output.bytes);
    assert.equal(digest(bytes), output.sha256);
    assert.equal(header.expectedBytes, HEADER_BYTES + output.vertexCount * VERTEX_BYTES + output.indexCount * 2);
    assert.equal(output.indexCount % 3, 0);

    let offset = HEADER_BYTES + output.vertexCount * VERTEX_BYTES;
    for (let index = 0; index < output.indexCount; index++, offset += 2) {
      assert.ok(bytes.readUInt16LE(offset) < output.vertexCount, `${output.path} index ${index} is in range`);
    }
  }
});
