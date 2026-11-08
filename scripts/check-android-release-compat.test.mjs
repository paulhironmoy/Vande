import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_MAX_MIN_SDK,
  DEFAULT_REQUIRED_ABIS,
  MIN_16_KB_ALIGNMENT,
  evaluateBadging,
  nativeCodeConsistency,
  nativeEntries,
  parseArgs,
  parseArchiveEntries,
  parseBadging,
  parseElfLoadAlignments,
} from './check-android-release-compat.mjs';

const GOOD_BADGING = `package: name='in.vande.cricket' versionCode='1' versionName='1.0.0'
minSdkVersion:'28'
targetSdkVersion:'36'
feature-group: label=''
  uses-feature: name='android.hardware.faketouch'
  uses-implied-feature: name='android.hardware.faketouch' reason='default feature for all apps'
uses-feature-not-required: name='android.hardware.vulkan.level'
launchable-activity: name='in.vande.cricket.MainActivity' label='VANDE Cricket' icon=''
supports-screens: 'small' 'normal' 'large' 'xlarge'
supports-any-density: 'true'
native-code: 'arm64-v8a' 'armeabi-v7a' 'x86' 'x86_64'
`;

function elf64(loadAlignments) {
  const headerSize = 64;
  const programEntrySize = 56;
  const buffer = Buffer.alloc(headerSize + programEntrySize * loadAlignments.length);
  buffer[0] = 0x7f;
  buffer.write('ELF', 1, 'ascii');
  buffer[4] = 2;
  buffer[5] = 1;
  buffer.writeBigUInt64LE(BigInt(headerSize), 32);
  buffer.writeUInt16LE(programEntrySize, 54);
  buffer.writeUInt16LE(loadAlignments.length, 56);
  loadAlignments.forEach((alignment, index) => {
    const offset = headerSize + index * programEntrySize;
    buffer.writeUInt32LE(1, offset);
    buffer.writeBigUInt64LE(BigInt(alignment), offset + 48);
  });
  return buffer;
}

function elf32(loadAlignments) {
  const headerSize = 52;
  const programEntrySize = 32;
  const buffer = Buffer.alloc(headerSize + programEntrySize * loadAlignments.length);
  buffer[0] = 0x7f;
  buffer.write('ELF', 1, 'ascii');
  buffer[4] = 1;
  buffer[5] = 1;
  buffer.writeUInt32LE(headerSize, 28);
  buffer.writeUInt16LE(programEntrySize, 42);
  buffer.writeUInt16LE(loadAlignments.length, 44);
  loadAlignments.forEach((alignment, index) => {
    const offset = headerSize + index * programEntrySize;
    buffer.writeUInt32LE(1, offset);
    buffer.writeUInt32LE(alignment, offset + 28);
  });
  return buffer;
}

describe('Android static release compatibility policy', () => {
  it('defaults to the API 28 floor and both material ARM ABIs', () => {
    const options = parseArgs([]);
    assert.equal(options.maxMinSdk, DEFAULT_MAX_MIN_SDK);
    assert.deepEqual(options.requiredAbis, DEFAULT_REQUIRED_ABIS);
  });

  it('parses the merged artifact badging and accepts the current safe shape', () => {
    const badging = parseBadging(GOOD_BADGING);
    assert.equal(badging.packageId, 'in.vande.cricket');
    assert.equal(badging.minSdk, 28);
    assert.equal(badging.targetSdk, 36);
    assert.deepEqual(badging.requiredFeatures, ['android.hardware.faketouch']);
    assert.deepEqual(badging.impliedFeatures, ['android.hardware.faketouch']);
    assert.deepEqual(badging.optionalFeatures, ['android.hardware.vulkan.level']);
    assert.equal(evaluateBadging(badging).pass, true);
  });

  it('fails if the merged minSdk rises above 28', () => {
    const evaluation = evaluateBadging(parseBadging(GOOD_BADGING.replace("minSdkVersion:'28'", "minSdkVersion:'29'")));
    assert.equal(evaluation.pass, false);
    assert.equal(evaluation.checks.find((check) => check.id === 'min-sdk')?.pass, false);
  });

  it('fails required or permission-implied hardware filters but allows optional features', () => {
    for (const line of [
      "uses-feature: name='android.hardware.camera'",
      "uses-implied-feature: name='android.hardware.location.gps' reason='permission'",
    ]) {
      const evaluation = evaluateBadging(parseBadging(`${GOOD_BADGING}${line}\n`));
      assert.equal(evaluation.checks.find((check) => check.id === 'required-hardware-features')?.pass, false);
    }
    const optional = evaluateBadging(parseBadging(`${GOOD_BADGING}uses-feature-not-required: name='android.hardware.camera'\n`));
    assert.equal(optional.pass, true);
  });

  it('fails OpenGL or texture-format install filters', () => {
    const gl = evaluateBadging(parseBadging(`${GOOD_BADGING}uses-feature-gl-es: '0x00030000'\n`));
    const texture = evaluateBadging(parseBadging(`${GOOD_BADGING}supports-gl-texture: 'GL_COMPRESSED_RGBA_ASTC_4x4_KHR'\n`));
    assert.equal(gl.checks.find((check) => check.id === 'required-gl-version')?.pass, false);
    assert.equal(texture.checks.find((check) => check.id === 'required-texture-format')?.pass, false);
  });

  it('fails narrowed screen support and a debuggable release', () => {
    const narrowed = GOOD_BADGING.replace("supports-screens: 'small' 'normal' 'large' 'xlarge'", "supports-screens: 'normal' 'large'");
    const evaluation = evaluateBadging(parseBadging(`${narrowed}application-debuggable\n`));
    assert.equal(evaluation.checks.find((check) => check.id === 'screen-buckets')?.pass, false);
    assert.equal(evaluation.checks.find((check) => check.id === 'not-debuggable')?.pass, false);
  });

  it('requires exactly the VANDE MainActivity launcher', () => {
    const duplicate = parseBadging(`${GOOD_BADGING}launchable-activity: name='com.unity3d.player.UnityPlayerGameActivity' label='Unity' icon=''\n`);
    const duplicateEvaluation = evaluateBadging(duplicate);
    assert.deepEqual(duplicate.launchableActivities, [
      'in.vande.cricket.MainActivity',
      'com.unity3d.player.UnityPlayerGameActivity',
    ]);
    assert.equal(duplicateEvaluation.checks.find((check) => check.id === 'launchable-activity')?.pass, false);

    const wrong = evaluateBadging(parseBadging(GOOD_BADGING.replace(
      'in.vande.cricket.MainActivity',
      'com.example.OtherActivity',
    )));
    assert.equal(wrong.checks.find((check) => check.id === 'launchable-activity')?.pass, false);
  });

  it('fails maxSdk, compatible-screen and required shared-library install filters', () => {
    const evaluation = evaluateBadging(parseBadging(`${GOOD_BADGING}
maxSdkVersion:'35'
compatible-screens: 'normal/320'
uses-library:'com.example.device.only'
`));
    assert.equal(evaluation.checks.find((check) => check.id === 'max-sdk')?.pass, false);
    assert.equal(evaluation.checks.find((check) => check.id === 'compatible-screen-filter')?.pass, false);
    assert.equal(evaluation.checks.find((check) => check.id === 'required-shared-libraries')?.pass, false);
  });

  it('fails required native-library filters but allows explicitly optional native libraries', () => {
    const optional = parseBadging(`${GOOD_BADGING}
uses-native-library-not-required:'libOpenCL.so'
uses-native-library-not-required:'libOpenCL.so'
`);
    assert.deepEqual(optional.requiredNativeLibraries, []);
    assert.deepEqual(optional.optionalNativeLibraries, ['libOpenCL.so']);
    assert.equal(evaluateBadging(optional).pass, true);

    const required = parseBadging(`${GOOD_BADGING}uses-native-library:'libOpenCL.so'\n`);
    assert.deepEqual(required.requiredNativeLibraries, ['libOpenCL.so']);
    const evaluation = evaluateBadging(required);
    assert.equal(evaluation.pass, false);
    assert.equal(evaluation.checks.find((check) => check.id === 'required-native-libraries')?.pass, false);
  });

  it('accepts repeatable ABI overrides and rejects invalid policy inputs', () => {
    assert.deepEqual(parseArgs(['--require-abi', 'arm64-v8a', '--require-abi', 'arm64-v8a']).requiredAbis, ['arm64-v8a']);
    assert.throws(() => parseArgs(['--max-min-sdk', '0']), /positive integer/u);
    assert.throws(() => parseArgs(['--package', 'in.vande;bad']), /invalid Android package id/u);
    assert.throws(() => parseArgs(['--require-abi', '../arm64']), /invalid ABI/u);
  });

  it('maps native libraries in both APK and AAB layouts', () => {
    assert.deepEqual(nativeEntries([
      'lib/arm64-v8a/libgame.so',
      'base/lib/armeabi-v7a/libgame.so',
      'base/assets/not-native.so',
    ]), [
      { entry: 'lib/arm64-v8a/libgame.so', abi: 'arm64-v8a', library: 'libgame.so' },
      { entry: 'base/lib/armeabi-v7a/libgame.so', abi: 'armeabi-v7a', library: 'libgame.so' },
    ]);
    assert.equal(nativeCodeConsistency(['arm64-v8a', 'armeabi-v7a'], ['armeabi-v7a', 'arm64-v8a']).pass, true);
    assert.equal(nativeCodeConsistency(['arm64-v8a'], ['arm64-v8a', 'armeabi-v7a']).pass, false);
  });

  it('rejects duplicate and unsafe archive entries', () => {
    assert.throws(() => parseArchiveEntries('base/lib/a/libx.so\nbase/lib/a/libx.so\n'), /duplicate/u);
    assert.throws(() => parseArchiveEntries('../lib/a/libx.so\n'), /unsafe/u);
  });

  it('reads 16 KB PT_LOAD alignment from ELF64 and ELF32 files', () => {
    assert.deepEqual(parseElfLoadAlignments(elf64([MIN_16_KB_ALIGNMENT, 0x10000])), [0x4000, 0x10000]);
    assert.deepEqual(parseElfLoadAlignments(elf32([MIN_16_KB_ALIGNMENT])), [0x4000]);
  });

  it('exposes sub-16 KB ELF alignment for the release gate to reject', () => {
    const alignments = parseElfLoadAlignments(elf64([0x1000, MIN_16_KB_ALIGNMENT]));
    assert.equal(alignments.every((alignment) => alignment >= MIN_16_KB_ALIGNMENT), false);
  });

  it('rejects non-ELF and truncated program-header data', () => {
    assert.throws(() => parseElfLoadAlignments(Buffer.alloc(64)), /not an ELF/u);
    assert.throws(() => parseElfLoadAlignments(elf64([MIN_16_KB_ALIGNMENT]).subarray(0, 70)), /truncated/u);
  });
});
