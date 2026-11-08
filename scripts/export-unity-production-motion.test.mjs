import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  CLIPS,
  SEMANTIC_BONES,
  VMA_HEADER_BYTES,
  convertClip,
  decodeVmaHeader,
  encodeVma,
  exportProductionMotion,
  parseAmc,
  parseAsf,
  selectMotionWindow,
} from './export-unity-production-motion.mjs';

const SYNTHETIC_ASF = `:version 1.10
:name test
:units
 length 1
 angle deg
:root
 order TX TY TZ RX RY RZ
 axis XYZ
:bonedata
${SEMANTIC_BONES.filter((bone) => bone.source !== 'root').map((bone, index) => ` begin
  id ${index + 1}
  name ${bone.source}
  direction 0 1 0
  length 1
  axis 0 0 0 XYZ
  dof rx ry rz
 end`).join('\n')}
:hierarchy
 begin
 root ${SEMANTIC_BONES.filter((bone) => bone.parent === 'root' && bone.source !== 'root').map((bone) => bone.source).join(' ')}
${SEMANTIC_BONES.filter((bone) => bone.source !== 'root' && bone.parent !== 'root').map((bone) => {
  const parent = SEMANTIC_BONES.find((candidate) => candidate.name === bone.parent);
  return ` ${parent.source} ${bone.source}`;
}).join('\n')}
 end
`;

function syntheticAmc(frameCount = 6) {
  const lines = [':FULLY-SPECIFIED', ':DEGREES'];
  for (let frame = 1; frame <= frameCount; frame += 1) {
    lines.push(String(frame));
    lines.push(`root ${frame} 0 0 0 ${frame * 2} 0`);
    for (const bone of SEMANTIC_BONES.filter((value) => value.source !== 'root'))
      lines.push(`${bone.source} ${bone.id === 8 ? frame * 12 : frame * 0.1} 0 0`);
  }
  return `${lines.join('\n')}\n`;
}

test('ASF and AMC parsing produces bounded semantic source frames', () => {
  const skeleton = parseAsf(SYNTHETIC_ASF);
  const frames = parseAmc(syntheticAmc(), skeleton);
  assert.equal(skeleton.bones.size, SEMANTIC_BONES.length - 1);
  assert.equal(frames.length, 6);
  assert.deepEqual(frames[0].channels.get('root'), [1, 0, 0, 0, 2, 0]);
});

test('parsers reject missing declarations and mismatched channels', () => {
  assert.throws(() => parseAsf(':bonedata\n:hierarchy\n'), /length unit|no bones/);
  const skeleton = parseAsf(SYNTHETIC_ASF);
  assert.throws(() => parseAmc(':FULLY-SPECIFIED\n1\nroot 0\n', skeleton), /declare degrees/);
  assert.throws(() => parseAmc(':DEGREES\n1\nroot 0\n2\nroot 0\n', skeleton), /channel count/);
});

test('motion-window selection is deterministic and includes the action peak', () => {
  const identity = [0, 0, 0, 1];
  const active = [0.2, 0, 0, Math.sqrt(0.96)];
  const poses = Array.from({ length: 240 }, (_, index) => ({
    root: [0, 0, 0],
    rotations: SEMANTIC_BONES.map(() => index >= 100 && index <= 120 ? active : identity),
  }));
  const a = selectMotionWindow(poses, 120);
  const b = selectMotionWindow(poses, 120);
  assert.deepEqual(a, b);
  assert.ok(a.start <= 100);
  assert.ok(a.end >= 120);
  assert.ok(a.sourcePeak >= a.start && a.sourcePeak <= a.end);
});

test('VMA1 encoding is byte deterministic, root locked and strictly sized', () => {
  const frames = Array.from({ length: 5 }, () => ({
    root: [0, 0, 0], rotations: SEMANTIC_BONES.map(() => [0, 0, 0, 1]),
  }));
  const input = {
    clipId: 'synthetic', frames, sampleRate: 60, sourceMotionSha256: '11'.repeat(32),
    rootLocked: true, sourcePeak: 2, sourceStart: 0, sourceEnd: 4,
  };
  const first = encodeVma(input).bytes;
  const second = encodeVma(input).bytes;
  assert.deepEqual(first, second);
  assert.equal(first.toString('ascii', 0, 4), 'VMA1');
  assert.equal(decodeVmaHeader(first).rootLocked, true);
  assert.equal(decodeVmaHeader(first).boneCount, SEMANTIC_BONES.length);
  assert.ok(first.length > VMA_HEADER_BYTES);
  assert.throws(() => decodeVmaHeader(first.subarray(0, -1)), /does not match/);
});

test('real pinned CMU candidates export deterministically when scratch sources exist', async (context) => {
  const sourceDir = '/private/tmp/vande-cmu-motion-audit';
  try { await readFile(join(sourceDir, CLIPS[0].motion)); }
  catch { context.skip('verified CMU scratch files are absent'); return; }
  const outputA = await mkdtemp(join(tmpdir(), 'vande-motion-a-'));
  const outputB = await mkdtemp(join(tmpdir(), 'vande-motion-b-'));
  const selected = [CLIPS[0].id];
  const first = await exportProductionMotion({ sourceDir, outputDir: outputA, clipIds: selected });
  const second = await exportProductionMotion({ sourceDir, outputDir: outputB, clipIds: selected });
  assert.equal(first.results[0].outputSha256, second.results[0].outputSha256);
  assert.equal(first.results[0].outputBytes, second.results[0].outputBytes);
  assert.equal(first.results[0].rootLocked, true);
  assert.match(first.manifest.acceptance, /UNPROVEN/);
  const bytes = await readFile(first.results[0].outputPath);
  assert.equal(decodeVmaHeader(bytes).sampleRate, 60);
});

test('convertClip refuses source bytes that do not match the pinned hash', async () => {
  const sourceDir = await mkdtemp(join(tmpdir(), 'vande-motion-bad-source-'));
  const outputDir = await mkdtemp(join(tmpdir(), 'vande-motion-bad-output-'));
  const spec = CLIPS[0];
  await writeFile(join(sourceDir, spec.skeleton), SYNTHETIC_ASF);
  await writeFile(join(sourceDir, spec.motion), syntheticAmc());
  await assert.rejects(() => convertClip(spec, { sourceDir, outputDir }), /skeleton hash mismatch/);
});
