#!/usr/bin/env node

/**
 * Canonical Android identity used by the Gate-A install, first-ball and size
 * receipts. Collection is read-only. Keep the command list identical for all
 * three boundaries so a serial reconnect cannot silently join two devices.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const SAFE_SERIAL = /^[A-Za-z0-9._:-]{1,128}$/u;

export const ANDROID_IDENTITY_FIELDS = Object.freeze([
  'serial',
  'model',
  'release',
  'api',
  'buildFingerprint',
  'securityPatch',
  'androidBuildId',
  'socModel',
  'boardPlatform',
  'hardwareEgl',
  'hardwareVulkan',
  'openGlEsVersion',
  'graphicsDriver0',
  'graphicsDriver1',
  'primaryAbi',
  'supportedAbis',
  'currentUser',
  'cores',
  'memKb',
  'gpuDriverObservation',
]);

export const ANDROID_IDENTITY_RECEIPT_SCHEMA_VERSION = 2;
export const ANDROID_IDENTITY_POLICY_ID = 'vande-android-stable-device-identity-v2';
export const ANDROID_IDENTITY_STATUS = 'STABLE_ANDROID_DEVICE_IDENTITY_CAPTURED';
export const ANDROID_GPU_DIAGNOSTIC_CLASSIFICATION = 'VOLATILE_SURFACEFLINGER_DIAGNOSTIC_NOT_IDENTITY';

export const ANDROID_IDENTITY_COMMANDS = Object.freeze({
  model: 'getprop ro.product.model',
  release: 'getprop ro.build.version.release',
  api: 'getprop ro.build.version.sdk',
  buildFingerprint: 'getprop ro.build.fingerprint',
  securityPatch: 'getprop ro.build.version.security_patch',
  androidBuildId: 'getprop ro.build.id',
  socModel: 'getprop ro.soc.model',
  boardPlatform: 'getprop ro.board.platform',
  hardwareEgl: 'getprop ro.hardware.egl',
  hardwareVulkan: 'getprop ro.hardware.vulkan',
  openGlEsVersion: 'getprop ro.opengles.version',
  graphicsDriver0: 'getprop ro.gfx.driver.0',
  graphicsDriver1: 'getprop ro.gfx.driver.1',
  primaryAbi: 'getprop ro.product.cpu.abi',
  supportedAbis: 'getprop ro.product.cpu.abilist',
  currentUser: 'am get-current-user',
  cores: 'nproc',
  memKb: "grep MemTotal /proc/meminfo | tr -s ' ' | cut -d' ' -f2",
  gpuRaw: "dumpsys SurfaceFlinger | grep -Ei 'GLES|OpenGL|Vulkan|GPU|driver' | head -40",
});

export const ANDROID_IDENTITY_BUNDLE_COMMAND = [
  'getprop',
  "printf '\\n__VANDE_CURRENT_USER__\\n'", 'am get-current-user',
  "printf '\\n__VANDE_CORES__\\n'", 'nproc',
  "printf '\\n__VANDE_MEM_KB__\\n'", "grep MemTotal /proc/meminfo | tr -s ' ' | cut -d' ' -f2",
  "printf '\\n__VANDE_GPU__\\n'", "dumpsys SurfaceFlinger | grep -Ei 'GLES|OpenGL|Vulkan|GPU|driver' | head -40",
  "printf '\\n__VANDE_IDENTITY_END__\\n'",
].join('; ');

function bounded(value, max = 8_192) {
  return String(value ?? '').replaceAll('\r', '').trim().slice(0, max);
}

export function canonicalGpuObservation(value) {
  const stableLine = /^(?:GLES|OpenGL(?: ES)?(?: renderer| vendor| version| driver)?|Vulkan(?: renderer| vendor| version| driver)?|GPU (?:renderer|vendor|version|driver))\s*[:=]/iu;
  return [...new Set(bounded(value, 65_536)
    .split('\n')
    .map((line) => line.trim().replace(/\s+/gu, ' '))
    .filter((line) => stableLine.test(line)))]
    .sort()
    .slice(0, 16)
    .join('\n');
}

export function androidGpuDiagnosticFromRaw(value) {
  const raw = bounded(value, 65_536);
  return {
    classification: ANDROID_GPU_DIAGNOSTIC_CLASSIFICATION,
    raw,
    sha256: createHash('sha256').update(raw).digest('hex'),
  };
}

export async function collectAndroidDeviceIdentity({ serial, shell }) {
  if (!SAFE_SERIAL.test(serial ?? '')) throw new Error('unsafe Android serial for identity collection');
  if (typeof shell !== 'function') throw new Error('Android identity collection requires a shell callback');
  return parseAndroidDeviceIdentityBundle(serial, await shell(ANDROID_IDENTITY_BUNDLE_COMMAND));
}

export async function collectAndroidDeviceIdentityEvidence({ serial, shell }) {
  if (!SAFE_SERIAL.test(serial ?? '')) throw new Error('unsafe Android serial for identity collection');
  if (typeof shell !== 'function') throw new Error('Android identity collection requires a shell callback');
  return parseAndroidDeviceIdentityEvidenceBundle(serial, await shell(ANDROID_IDENTITY_BUNDLE_COMMAND));
}

export function parseAndroidDeviceIdentityBundle(serial, raw) {
  return parseAndroidDeviceIdentityEvidenceBundle(serial, raw).identity;
}

export function parseAndroidDeviceIdentityEvidenceBundle(serial, raw) {
  const text = String(raw ?? '').replaceAll('\r', '');
  const markers = ['__VANDE_CURRENT_USER__', '__VANDE_CORES__', '__VANDE_MEM_KB__', '__VANDE_GPU__', '__VANDE_IDENTITY_END__'];
  const offsets = markers.map((marker) => text.indexOf(marker));
  if (offsets.some((offset) => offset < 0) || offsets.some((offset, index) => index > 0 && offset <= offsets[index - 1])) {
    throw new Error('Android identity bundle markers are missing or reordered');
  }
  const propertyText = text.slice(0, offsets[0]);
  const properties = new Map([...propertyText.matchAll(/^\[([^\]]+)\]: \[(.*)\]$/gmu)].map((match) => [match[1], match[2]]));
  const section = (index) => text.slice(offsets[index] + markers[index].length, offsets[index + 1]).trim();
  const gpuRaw = section(3);
  const identity = androidDeviceIdentityFromCommandOutputs(serial, {
    model: properties.get('ro.product.model') ?? '',
    release: properties.get('ro.build.version.release') ?? '',
    api: properties.get('ro.build.version.sdk') ?? '',
    buildFingerprint: properties.get('ro.build.fingerprint') ?? '',
    securityPatch: properties.get('ro.build.version.security_patch') ?? '',
    androidBuildId: properties.get('ro.build.id') ?? '',
    socModel: properties.get('ro.soc.model') ?? '',
    boardPlatform: properties.get('ro.board.platform') ?? '',
    hardwareEgl: properties.get('ro.hardware.egl') ?? '',
    hardwareVulkan: properties.get('ro.hardware.vulkan') ?? '',
    openGlEsVersion: properties.get('ro.opengles.version') ?? '',
    graphicsDriver0: properties.get('ro.gfx.driver.0') ?? '',
    graphicsDriver1: properties.get('ro.gfx.driver.1') ?? '',
    primaryAbi: properties.get('ro.product.cpu.abi') ?? '',
    supportedAbis: properties.get('ro.product.cpu.abilist') ?? '',
    currentUser: section(0),
    cores: section(1),
    memKb: section(2),
    gpuRaw,
  });
  return {
    identity,
    diagnostics: {
      gpuSurfaceFlinger: androidGpuDiagnosticFromRaw(gpuRaw),
    },
  };
}

export function androidDeviceIdentityFromCommandOutputs(serial, values) {
  if (!SAFE_SERIAL.test(serial ?? '')) throw new Error('unsafe Android serial for identity normalization');
  const normalized = Object.fromEntries(Object.entries(values ?? {}).map(([key, value]) => [
    key,
    bounded(value, key === 'gpuRaw' ? 65_536 : 8_192),
  ]));
  const identity = {
    serial,
    model: normalized.model,
    release: normalized.release,
    api: normalized.api,
    buildFingerprint: normalized.buildFingerprint,
    securityPatch: normalized.securityPatch,
    androidBuildId: normalized.androidBuildId,
    socModel: normalized.socModel,
    boardPlatform: normalized.boardPlatform,
    hardwareEgl: normalized.hardwareEgl,
    hardwareVulkan: normalized.hardwareVulkan,
    openGlEsVersion: normalized.openGlEsVersion,
    graphicsDriver0: normalized.graphicsDriver0,
    graphicsDriver1: normalized.graphicsDriver1,
    primaryAbi: normalized.primaryAbi,
    supportedAbis: normalized.supportedAbis,
    currentUser: normalized.currentUser,
    cores: normalized.cores,
    memKb: normalized.memKb,
    gpuDriverObservation: canonicalGpuObservation(normalized.gpuRaw),
  };
  const errors = validateAndroidDeviceIdentity(identity);
  if (errors.length) throw new Error(`Android device identity is incomplete: ${errors.join('; ')}`);
  return identity;
}

export function validateAndroidDeviceIdentity(identity) {
  const errors = [];
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return ['identity is missing'];
  if (JSON.stringify(Object.keys(identity).sort()) !== JSON.stringify([...ANDROID_IDENTITY_FIELDS].sort())) {
    errors.push('identity fields differ');
  }
  for (const field of ANDROID_IDENTITY_FIELDS) {
    if (typeof identity[field] !== 'string') errors.push(`${field} is not a string`);
  }
  for (const field of ['serial', 'model', 'release', 'api', 'buildFingerprint', 'securityPatch', 'androidBuildId', 'primaryAbi', 'supportedAbis', 'currentUser', 'cores', 'memKb']) {
    if (typeof identity[field] !== 'string' || identity[field].length === 0) errors.push(`${field} is empty`);
  }
  if (!identity?.socModel && !identity?.boardPlatform) errors.push('SoC and board are both empty');
  if (!identity?.gpuDriverObservation) errors.push('stable GPU renderer observation is empty');
  if (!identity?.hardwareEgl && !identity?.hardwareVulkan
      && !identity?.openGlEsVersion && !identity?.graphicsDriver0 && !identity?.graphicsDriver1) errors.push('GPU/driver properties are empty');
  if (identity?.serial && !SAFE_SERIAL.test(identity.serial)) errors.push('serial is unsafe');
  return [...new Set(errors)];
}

export function sameAndroidDeviceIdentity(left, right) {
  return validateAndroidDeviceIdentity(left).length === 0
    && validateAndroidDeviceIdentity(right).length === 0
    && ANDROID_IDENTITY_FIELDS.every((field) => left[field] === right[field]);
}

export function androidDeviceIdentitySha256(identity) {
  if (validateAndroidDeviceIdentity(identity).length) throw new Error('cannot hash an invalid Android device identity');
  const canonical = Object.fromEntries(ANDROID_IDENTITY_FIELDS.map((field) => [field, identity[field]]));
  return createHash('sha256').update(JSON.stringify({
    policyId: ANDROID_IDENTITY_POLICY_ID,
    identity: canonical,
  })).digest('hex');
}

export function validateAndroidDeviceIdentityReceipt(report) {
  const errors = [];
  const exactKeys = (value, expected, label) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${label} is not an object`);
      return;
    }
    if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) errors.push(`${label} fields differ`);
  };
  exactKeys(report, ['schemaVersion', 'identityPolicyId', 'status', 'capturedUtc', 'identity', 'identitySha256', 'diagnostics'], 'identity receipt');
  if (report?.schemaVersion !== ANDROID_IDENTITY_RECEIPT_SCHEMA_VERSION) errors.push('identity receipt schema is not V2');
  if (report?.identityPolicyId !== ANDROID_IDENTITY_POLICY_ID) errors.push('identity receipt policy differs');
  if (report?.status !== ANDROID_IDENTITY_STATUS) errors.push('identity receipt status differs');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(report?.capturedUtc ?? '')) errors.push('identity receipt UTC is invalid');
  const identityErrors = validateAndroidDeviceIdentity(report?.identity);
  errors.push(...identityErrors.map((error) => `identity ${error}`));
  if (!identityErrors.length && report?.identitySha256 !== androidDeviceIdentitySha256(report.identity)) errors.push('identity receipt hash differs');
  exactKeys(report?.diagnostics, ['gpuSurfaceFlinger'], 'identity diagnostics');
  const gpu = report?.diagnostics?.gpuSurfaceFlinger;
  exactKeys(gpu, ['classification', 'raw', 'sha256'], 'GPU diagnostic');
  if (gpu?.classification !== ANDROID_GPU_DIAGNOSTIC_CLASSIFICATION) errors.push('GPU diagnostic classification differs');
  if (typeof gpu?.raw !== 'string' || gpu.raw.length === 0 || gpu.raw.length > 65_536) errors.push('GPU diagnostic raw capture is invalid');
  if (!/^[0-9a-f]{64}$/u.test(gpu?.sha256 ?? '')
      || gpu.sha256 !== createHash('sha256').update(gpu?.raw ?? '').digest('hex')) errors.push('GPU diagnostic hash differs');
  if (!identityErrors.length && typeof gpu?.raw === 'string'
      && canonicalGpuObservation(gpu.raw) !== report.identity.gpuDriverObservation) errors.push('stable GPU identity is not derived from the diagnostic capture');
  return [...new Set(errors)];
}

export function createAndroidDeviceIdentityReceipt({ identity, gpuRaw, capturedUtc = new Date().toISOString() }) {
  const report = {
    schemaVersion: ANDROID_IDENTITY_RECEIPT_SCHEMA_VERSION,
    identityPolicyId: ANDROID_IDENTITY_POLICY_ID,
    status: ANDROID_IDENTITY_STATUS,
    capturedUtc,
    identity,
    identitySha256: androidDeviceIdentitySha256(identity),
    diagnostics: { gpuSurfaceFlinger: androidGpuDiagnosticFromRaw(gpuRaw) },
  };
  const errors = validateAndroidDeviceIdentityReceipt(report);
  if (errors.length) throw new Error(`Android device identity receipt is invalid: ${errors.join('; ')}`);
  return report;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!['--serial', '--adb', '--output'].includes(name)) throw new Error(`unknown option ${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    index += 1;
    options[name.slice(2)] = value;
  }
  if (!options.serial || !options.adb || !options.output) throw new Error('Usage: android-device-identity.mjs --serial SERIAL --adb ABSOLUTE --output NEW_JSON');
  if (!SAFE_SERIAL.test(options.serial)) throw new Error('unsafe --serial');
  options.adb = resolve(options.adb);
  options.output = resolve(options.output);
  return options;
}

function adbShell(adb, serial, command) {
  const result = spawnSync(adb, ['-s', serial, 'shell', command], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw new Error(`could not run adb: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Android identity command failed (${result.status}): ${command}`);
  return result.stdout ?? '';
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const evidence = await collectAndroidDeviceIdentityEvidence({
    serial: options.serial,
    shell: (command) => adbShell(options.adb, options.serial, command),
  });
  const report = createAndroidDeviceIdentityReceipt({
    identity: evidence.identity,
    gpuRaw: evidence.diagnostics.gpuSurfaceFlinger.raw,
  });
  writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`ANDROID_DEVICE_IDENTITY_OK ${report.identitySha256}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
