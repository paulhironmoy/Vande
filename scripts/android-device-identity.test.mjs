#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANDROID_IDENTITY_POLICY_ID,
  ANDROID_IDENTITY_RECEIPT_SCHEMA_VERSION,
  ANDROID_IDENTITY_STATUS,
  ANDROID_IDENTITY_COMMANDS,
  androidDeviceIdentitySha256,
  androidDeviceIdentityFromCommandOutputs,
  androidGpuDiagnosticFromRaw,
  canonicalGpuObservation,
  createAndroidDeviceIdentityReceipt,
  parseAndroidDeviceIdentityBundle,
  sameAndroidDeviceIdentity,
  validateAndroidDeviceIdentity,
  validateAndroidDeviceIdentityReceipt,
} from './android-device-identity.mjs';

const outputs = Object.fromEntries(Object.keys(ANDROID_IDENTITY_COMMANDS).map((key) => [key, `${key}-value\r\n`]));
outputs.currentUser = '0\n';
outputs.api = '36\n';
outputs.cores = '8\n';
outputs.memKb = '8192000\n';
outputs.primaryAbi = 'arm64-v8a\n';
outputs.supportedAbis = 'arm64-v8a\n';
outputs.gpuRaw = 'GLES: Google, Android Emulator OpenGL ES Translator, OpenGL ES 3.0\n';

test('canonical Android identity is exact and rejects a reused serial with changed fingerprint/GPU', () => {
  const first = androidDeviceIdentityFromCommandOutputs('emulator-5584', outputs);
  assert.deepEqual(validateAndroidDeviceIdentity(first), []);
  assert.equal(sameAndroidDeviceIdentity(first, { ...first }), true);
  assert.equal(sameAndroidDeviceIdentity(first, { ...first, buildFingerprint: 'other' }), false);
  assert.equal(sameAndroidDeviceIdentity(first, { ...first, gpuDriverObservation: 'other' }), false);
});

test('identity requires OS, SoC/board and GPU facts rather than serial alone', () => {
  const valid = androidDeviceIdentityFromCommandOutputs('emulator-5584', outputs);
  assert.match(validateAndroidDeviceIdentity({ ...valid, securityPatch: '' }).join('; '), /securityPatch/u);
  assert.match(validateAndroidDeviceIdentity({ ...valid, socModel: '', boardPlatform: '' }).join('; '), /SoC/u);
  assert.match(validateAndroidDeviceIdentity({
    ...valid, gpuDriverObservation: '',
  }).join('; '), /stable GPU/u);
  assert.match(validateAndroidDeviceIdentity({ ...valid, primaryAbi: '' }).join('; '), /primaryAbi/u);
  assert.match(validateAndroidDeviceIdentity({ ...valid, supportedAbis: '' }).join('; '), /supportedAbis/u);
  assert.match(validateAndroidDeviceIdentity({
    ...valid, hardwareEgl: '', hardwareVulkan: '', openGlEsVersion: '', graphicsDriver0: '', graphicsDriver1: '',
  }).join('; '), /properties/u);
});

test('stable GPU projection ignores the failed-v4 runtime ordering and cache telemetry', () => {
  const stable = 'GLES: Google (Apple), Android Emulator OpenGL ES Translator (Apple M4), OpenGL ES 3.0';
  const beforeRaw = `${stable}
GPU missed frame count: 9
skia/gpu_resources/resource_5607: 1.69 KB
skia/gpu_resources/resource_272: 9.89 MB`;
  const afterRaw = `${stable}
GPU missed frame count: 31
skia/gpu_resources/resource_272: 4.50 MB
skia/gpu_resources/resource_9001: 2.00 KB`;
  assert.equal(canonicalGpuObservation(beforeRaw), stable);
  assert.equal(canonicalGpuObservation(afterRaw), stable);
  const before = androidDeviceIdentityFromCommandOutputs('127.0.0.1:5585', { ...outputs, gpuRaw: beforeRaw });
  const after = androidDeviceIdentityFromCommandOutputs('127.0.0.1:5585', { ...outputs, gpuRaw: afterRaw });
  assert.equal(sameAndroidDeviceIdentity(before, after), true);
  assert.equal(androidDeviceIdentitySha256(before), androidDeviceIdentitySha256(after));
  assert.notEqual(androidGpuDiagnosticFromRaw(beforeRaw).sha256, androidGpuDiagnosticFromRaw(afterRaw).sha256);
});

test('stable identity rejects ABI, renderer and stable property substitutions', () => {
  const first = androidDeviceIdentityFromCommandOutputs('emulator-5584', outputs);
  const changedRenderer = androidDeviceIdentityFromCommandOutputs('emulator-5584', {
    ...outputs, gpuRaw: 'GLES: Different vendor, Different renderer, OpenGL ES 3.0',
  });
  assert.equal(sameAndroidDeviceIdentity(first, changedRenderer), false);
  assert.equal(sameAndroidDeviceIdentity(first, { ...first, serial: 'emulator-5590' }), false);
  assert.equal(sameAndroidDeviceIdentity(first, { ...first, api: '35' }), false);
  assert.equal(sameAndroidDeviceIdentity(first, { ...first, buildFingerprint: 'other/build' }), false);
  assert.equal(sameAndroidDeviceIdentity(first, { ...first, securityPatch: '2026-09-05' }), false);
  assert.equal(sameAndroidDeviceIdentity(first, { ...first, primaryAbi: 'x86_64' }), false);
  assert.equal(sameAndroidDeviceIdentity(first, { ...first, supportedAbis: 'x86_64' }), false);
  assert.equal(sameAndroidDeviceIdentity(first, { ...first, hardwareEgl: 'substituted' }), false);
  assert.match(validateAndroidDeviceIdentity({ ...first, unexpected: 'ignored-by-old-hash' }).join('; '), /fields differ/u);
  assert.equal(androidDeviceIdentitySha256(first), androidDeviceIdentitySha256(Object.fromEntries(
    Object.entries(first).reverse(),
  )));
});

test('stable GPU signature sorting is deterministic and occurs before diagnostic truncation', () => {
  const raw = `${'GPU missed frame count: 1\n'.repeat(400)}Vulkan renderer: Zeta\nGLES: Alpha`;
  assert.equal(canonicalGpuObservation(raw), 'GLES: Alpha\nVulkan renderer: Zeta');
  const identity = androidDeviceIdentityFromCommandOutputs('emulator-5584', { ...outputs, gpuRaw: raw });
  assert.equal(identity.gpuDriverObservation, 'GLES: Alpha\nVulkan renderer: Zeta');
  const receipt = createAndroidDeviceIdentityReceipt({
    identity, gpuRaw: raw, capturedUtc: '2026-10-29T09:00:00.000Z',
  });
  assert.deepEqual(validateAndroidDeviceIdentityReceipt(receipt), []);
});

test('V2 receipt binds policy, stable identity and separate volatile diagnostics', () => {
  const identity = androidDeviceIdentityFromCommandOutputs('emulator-5584', outputs);
  const report = {
    schemaVersion: ANDROID_IDENTITY_RECEIPT_SCHEMA_VERSION,
    identityPolicyId: ANDROID_IDENTITY_POLICY_ID,
    status: ANDROID_IDENTITY_STATUS,
    capturedUtc: '2026-10-29T09:00:00.000Z',
    identity,
    identitySha256: androidDeviceIdentitySha256(identity),
    diagnostics: { gpuSurfaceFlinger: androidGpuDiagnosticFromRaw(outputs.gpuRaw) },
  };
  assert.deepEqual(validateAndroidDeviceIdentityReceipt(report), []);
  assert.match(validateAndroidDeviceIdentityReceipt({ ...report, schemaVersion: 1 }).join('; '), /schema/u);
  assert.match(validateAndroidDeviceIdentityReceipt({ ...report, identityPolicyId: 'v1' }).join('; '), /policy/u);
  assert.match(validateAndroidDeviceIdentityReceipt({
    ...report,
    diagnostics: { gpuSurfaceFlinger: { ...report.diagnostics.gpuSurfaceFlinger, raw: `${outputs.gpuRaw}changed` } },
  }).join('; '), /hash|derived/u);
});

test('one bounded shell bundle yields the same complete canonical identity shape', () => {
  const properties = [
    ['ro.product.model', 'Pixel'], ['ro.build.version.release', '16'], ['ro.build.version.sdk', '36'],
    ['ro.build.fingerprint', 'vendor/device/build'], ['ro.build.version.security_patch', '2026-10-05'],
    ['ro.build.id', 'ABC123'], ['ro.soc.model', 'Tensor'], ['ro.board.platform', 'tensor'],
    ['ro.hardware.egl', 'angle'], ['ro.hardware.vulkan', 'vulkan'], ['ro.opengles.version', '196610'],
    ['ro.gfx.driver.0', 'driver'], ['ro.gfx.driver.1', ''],
    ['ro.product.cpu.abi', 'arm64-v8a'], ['ro.product.cpu.abilist', 'arm64-v8a'],
  ].map(([key, value]) => `[${key}]: [${value}]`).join('\n');
  const parsed = parseAndroidDeviceIdentityBundle('emulator-5584', `${properties}
__VANDE_CURRENT_USER__
0
__VANDE_CORES__
8
__VANDE_MEM_KB__
8192000
__VANDE_GPU__
GLES: ANGLE
__VANDE_IDENTITY_END__
`);
  assert.deepEqual(validateAndroidDeviceIdentity(parsed), []);
  assert.equal(parsed.androidBuildId, 'ABC123');
  assert.equal(parsed.gpuDriverObservation, 'GLES: ANGLE');
});
