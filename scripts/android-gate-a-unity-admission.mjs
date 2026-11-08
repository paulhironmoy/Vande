#!/usr/bin/env node

/**
 * Deterministic Gate-A wrapper around the frozen Android/Unity payload verifier.
 *
 * The admission file is the exact complete object returned by the frozen
 * verifier, not a boolean, digest-only reduction or wrapper.  A separate source
 * bracket binds the build identity immediately before and after that verifier.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  ANDROID_IDENTITY_FIELDS,
  androidDeviceIdentitySha256,
  validateAndroidDeviceIdentity,
  validateAndroidDeviceIdentityReceipt,
} from './android-device-identity.mjs';
import { classifyPmPathAbsence } from './android-gate-a.mjs';
import { validateInstalledPackageInventoryReceipt } from './android-installed-package-inventory.mjs';
import {
  LOCAL_PROVENANCE_LIMITATION,
  parseApkSignerReport,
  verifyExistingAndroidUnityPayloadBinding,
} from './android-unity-payload-binding.mjs';

const SHA256 = /^[0-9a-f]{64}$/u;
const BUILD_ID = /^[0-9a-f]{7,40}(?:\+[0-9a-f]{12})?$/u;
const INVOCATION_ID = /^[0-9a-f]{32}$/u;
const ADMISSION_KIND = 'VANDE_UNITY_ANDROID_PAYLOAD_BINDING_ADMISSION';
const BRACKET_KIND = 'VANDE_GATE_A_UNITY_PAYLOAD_SOURCE_BRACKET';
const SAFE_SERIAL = /^[A-Za-z0-9._:-]{1,128}$/u;
const SAFE_PACKAGE = /^[A-Za-z][A-Za-z0-9_.]{2,255}$/u;
const SAFE_DEVICE_PATH = /^\/[A-Za-z0-9._/+=~-]+$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const INSTALL_OPERATION = 'adb -s <explicit serial> install -r <private immutable admitted APK>';
const SEALED_ADMISSION_LIMITATION = 'This is static admission for a PREVIEW engineering artifact; it is not Play, SIZE-50, REACH-90, physical-device or human-player evidence.';
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UNITY_EXPORT_RECEIPT_PATH = join(
  REPOSITORY_ROOT,
  'unity/VandePractice/Builds/Android/.vande-export.properties',
);
export const GATE_A_SEALED_WRAPPER_RECORD_BASENAMES = Object.freeze({
  adbIsolation: 'adb-isolation.txt',
  admission: 'sealed-artifact-admission.json',
  unityPayloadBindingAdmissionFile: 'unity-payload-binding-admission.json',
  unityPayloadBindingAdmissionSourceBracketFile: 'unity-payload-binding-admission-source-bracket.json',
  unityPayloadBindingPreinstallRecheckFile: 'unity-payload-binding-preinstall-recheck.json',
  unityPayloadBindingPreinstallSourceBracketFile: 'unity-payload-binding-preinstall-recheck-source-bracket.json',
  unityPayloadBindingFinalRecheckFile: 'unity-payload-binding-final-recheck.json',
  unityPayloadBindingFinalSourceBracketFile: 'unity-payload-binding-final-recheck-source-bracket.json',
  preinstallStdout: 'preinstall-pm-path.stdout.txt',
  preinstallStderr: 'preinstall-pm-path.stderr.txt',
  preinstallStatus: 'preinstall-pm-path-status.txt',
  packageAbsence: 'package-absence.json',
  preinstallDeviceIdentity: 'preinstall-device-identity.json',
  preinstallArtifactCheck: 'preinstall-artifact-check.json',
  installArtifactFinalCheck: 'install-artifact-final-check.json',
  installArtifactPostCheck: 'install-artifact-post-check.json',
  postInstallPackageInventory: 'post-install-package-inventory.json',
  installTransactionStart: 'install-transaction-start.json',
  installStdout: 'install.stdout.txt',
  installStderr: 'install.stderr.txt',
  installStatus: 'install-status.txt',
  installTransaction: 'install-transaction.json',
});
const WRAPPER_RECORD_BASENAMES = GATE_A_SEALED_WRAPPER_RECORD_BASENAMES;
const FILE_IDENTITY_KEYS = [
  'dev', 'ino', 'mode', 'nlink', 'uid', 'gid', 'size', 'mtimeNs', 'ctimeNs',
];
const START_KEYS = [
  'schemaVersion', 'status', 'runId', 'startedUtc', 'startedHostMonotonicNs',
  'serial', 'packageId', 'buildId', 'artifact', 'deviceIdentity', 'deviceIdentitySha256',
  'unityPayloadBindingAdmission', 'unityPayloadBindingAdmissionSourceBracket',
  'unityPayloadBindingPreinstallRecheck', 'unityPayloadBindingPreinstallSourceBracket',
  'unityPayloadBindingExpectedSidecar', 'evidence',
];
const COMPLETION_KEYS = [
  'schemaVersion', 'status', 'runId', 'startedUtc', 'finishedUtc',
  'startedHostMonotonicNs', 'finishedHostMonotonicNs', 'serial', 'packageId', 'buildId',
  'artifact', 'postInstallArtifact', 'installedPackageInventory', 'deviceIdentity',
  'deviceIdentitySha256', 'unityPayloadBindingAdmission',
  'unityPayloadBindingAdmissionSourceBracket', 'unityPayloadBindingPreinstallRecheck',
  'unityPayloadBindingPreinstallSourceBracket', 'unityPayloadBindingFinalRecheck',
  'unityPayloadBindingFinalSourceBracket', 'unityPayloadBindingExpectedSidecar',
  'operation', 'evidence',
];
const START_EVIDENCE_KEYS = [
  'admission', 'artifactCheck', 'absence', 'deviceIdentity',
  'unityPayloadBindingAdmission', 'unityPayloadBindingAdmissionSourceBracket',
  'unityPayloadBindingPreinstallRecheck', 'unityPayloadBindingPreinstallSourceBracket',
];
const COMPLETION_EVIDENCE_KEYS = [
  'start', 'immediateArtifactCheck', 'postInstallArtifactCheck',
  'installedPackageInventory', 'installStatus', 'installStdout', 'installStderr',
  'unityPayloadBindingFinalRecheck', 'unityPayloadBindingFinalSourceBracket',
];

function fail(message) {
  throw new Error(`Gate-A Unity payload admission rejected: ${message}`);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} is not an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label} fields differ`);
}

function requireAbsolute(value, label) {
  if (typeof value !== 'string' || !isAbsolute(value) || /[\0\r\n]/u.test(value)) {
    fail(`${label} must be an absolute path without control characters`);
  }
  if (resolve(value) !== value) fail(`${label} must be lexically canonical`);
  return value;
}

function requireSha(value, label) {
  if (!SHA256.test(value ?? '')) fail(`${label} must be 64 lowercase hexadecimal characters`);
  return value;
}

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sameExact(left, right) {
  return isDeepStrictEqual(left, right);
}

function appendExactKeys(errors, value, keys, label) {
  try {
    exactKeys(value, keys, label);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
}

function validUtc(value) {
  return typeof value === 'string' && ISO_UTC.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validMonotonic(value) {
  return typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(value);
}

function appendFileIdentity(errors, value, label) {
  appendExactKeys(errors, value, FILE_IDENTITY_KEYS, label);
  if (!FILE_IDENTITY_KEYS.every((field) => /^(?:0|[1-9][0-9]*)$/u.test(value?.[field] ?? ''))) {
    errors.push(`${label} contains a non-canonical stat value`);
  }
}

function canonicalAbsolutePath(value) {
  return typeof value === 'string' && isAbsolute(value) && resolve(value) === value
    && !/[\0\r\n]/u.test(value);
}

function canonicalDevicePath(value) {
  return SAFE_DEVICE_PATH.test(value ?? '')
    && value.split('/').slice(1).every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function validateAdbIsolationText(value, serial) {
  const errors = [];
  if (typeof value !== 'string') return ['ADB isolation evidence is unavailable'];
  const lines = value.split('\n');
  if (lines.length !== 6 || lines[5] !== '') {
    return ['ADB isolation evidence must contain exactly five newline-terminated fields'];
  }
  if (lines[0] !== 'host=127.0.0.1') errors.push('ADB isolation host is not exact loopback');
  const port = lines[1].match(/^port=([1-9][0-9]{0,4})$/u)?.[1] ?? null;
  if (port === null || Number(port) > 65535 || port === '5037') {
    errors.push('ADB isolation port is not a valid non-default dedicated port');
  }
  if (!SAFE_SERIAL.test(serial ?? '') || serial === 'emulator-5582') {
    errors.push('ADB isolation serial is invalid or protected');
    return errors;
  }
  const expected = [
    `serial=${serial}`,
    `inventory=${serial} device`,
    `pre-playwright-inventory=${serial} device`,
  ];
  if (JSON.stringify(lines.slice(2, 5)) !== JSON.stringify(expected)) {
    errors.push('ADB isolation serial or exact-one-device inventories differ from the first-ball receipt');
  }
  return errors;
}

function validateCanonicalInstallBinding({ receipt, start, completed, expectedBuildId, expectedApkSha256 }) {
  const errors = [];
  const wrapper = receipt?.sealedWrapperEvidence;
  appendExactKeys(errors, start, START_KEYS, 'install-start receipt');
  appendExactKeys(errors, completed, COMPLETION_KEYS, 'install-completion receipt');
  appendExactKeys(errors, start?.evidence, START_EVIDENCE_KEYS, 'install-start evidence');
  appendExactKeys(errors, completed?.evidence, COMPLETION_EVIDENCE_KEYS, 'install-completion evidence');

  if (!sameExact(completed, receipt?.installTransaction)
      || !sameExact(completed, wrapper?.installTransactionReceipt)) {
    errors.push('parsed, first-ball and sealed-wrapper install transactions are not exactly equal');
  }
  if (start?.schemaVersion !== 1 || start?.status !== 'SEALED_INSTALL_STARTED'
      || completed?.schemaVersion !== 2 || completed?.status !== 'SEALED_INSTALL_COMPLETED') {
    errors.push('install transaction schemas or statuses are invalid');
  }
  for (const field of [
    'runId', 'startedUtc', 'startedHostMonotonicNs', 'serial', 'packageId', 'buildId',
    'artifact', 'deviceIdentity', 'deviceIdentitySha256', 'unityPayloadBindingAdmission',
    'unityPayloadBindingAdmissionSourceBracket', 'unityPayloadBindingPreinstallRecheck',
    'unityPayloadBindingPreinstallSourceBracket', 'unityPayloadBindingExpectedSidecar',
  ]) {
    if (!sameExact(start?.[field], completed?.[field])) {
      errors.push(`install start/completion ${field} binding differs`);
    }
  }

  if (!UUID.test(start?.runId ?? '') || receipt?.runId !== start?.runId
      || wrapper?.runId !== start?.runId) errors.push('install run ID is invalid or differs');
  if (!SAFE_SERIAL.test(start?.serial ?? '') || receipt?.serial !== start?.serial
      || receipt?.deviceIdentity?.serial !== start?.serial) errors.push('install serial is invalid or differs');
  if (!SAFE_PACKAGE.test(start?.packageId ?? '') || receipt?.packageId !== start?.packageId) {
    errors.push('install package is invalid or differs');
  }
  if (start?.buildId !== expectedBuildId || receipt?.buildId !== expectedBuildId) {
    errors.push('install build identity differs from the expected first-ball build');
  }
  if (!validUtc(start?.startedUtc) || !validUtc(completed?.finishedUtc)
      || Date.parse(completed?.finishedUtc ?? '') < Date.parse(start?.startedUtc ?? '')) {
    errors.push('install UTC interval is invalid');
  }
  if (!validMonotonic(start?.startedHostMonotonicNs)
      || !validMonotonic(completed?.finishedHostMonotonicNs)
      || (validMonotonic(start?.startedHostMonotonicNs)
        && validMonotonic(completed?.finishedHostMonotonicNs)
        && BigInt(completed.finishedHostMonotonicNs) < BigInt(start.startedHostMonotonicNs))) {
    errors.push('install monotonic interval is invalid');
  }
  if (completed?.operation !== INSTALL_OPERATION || wrapper?.installOperation !== INSTALL_OPERATION) {
    errors.push('install operation is not exact');
  }

  appendExactKeys(errors, receipt?.artifact, ['path', 'sha256', 'bytes', 'identity', 'parentIdentity'], 'first-ball artifact');
  const artifactBytes = receipt?.artifact?.bytes;
  const artifactProjection = {
    path: receipt?.artifact?.path,
    sha256: receipt?.artifact?.sha256,
    identity: receipt?.artifact?.identity,
    parentIdentity: receipt?.artifact?.parentIdentity,
  };
  const sealedArtifact = {
    path: receipt?.artifact?.path,
    bytes: artifactBytes,
    sha256: receipt?.artifact?.sha256,
    identity: receipt?.artifact?.identity,
    parentIdentity: receipt?.artifact?.parentIdentity,
    privateReadOnlyCopy: true,
  };
  const h7ArtifactBytes = receipt?.unityPayloadBinding?.admission?.apk?.bytes;
  appendExactKeys(errors, start?.artifact, [
    'path', 'bytes', 'sha256', 'identity', 'parentIdentity', 'privateReadOnlyCopy',
  ], 'sealed install-start artifact');
  appendExactKeys(errors, completed?.artifact, [
    'path', 'bytes', 'sha256', 'identity', 'parentIdentity', 'privateReadOnlyCopy',
  ], 'sealed install-completion artifact');
  appendExactKeys(errors, wrapper?.artifactIdentity, [
    'path', 'sha256', 'identity', 'parentIdentity',
  ], 'sealed-wrapper artifact projection');
  appendExactKeys(errors, completed?.postInstallArtifact, [
    'path', 'sha256', 'identity', 'parentIdentity',
  ], 'post-install artifact projection');
  appendFileIdentity(errors, receipt?.artifact?.identity, 'first-ball artifact identity');
  appendFileIdentity(errors, receipt?.artifact?.parentIdentity, 'first-ball artifact parent identity');
  if (!canonicalAbsolutePath(receipt?.artifact?.path)
      || receipt?.artifact?.sha256 !== expectedApkSha256
      || typeof artifactBytes !== 'string' || !/^[1-9][0-9]*$/u.test(artifactBytes)
      || receipt?.artifact?.identity?.size !== artifactBytes
      || !Number.isSafeInteger(h7ArtifactBytes) || h7ArtifactBytes <= 0
      || String(h7ArtifactBytes) !== artifactBytes
      || !sameExact(start?.artifact, sealedArtifact)
      || !sameExact(wrapper?.artifactIdentity, artifactProjection)) {
    errors.push('install artifact does not exactly match the expected first-ball artifact');
  }
  if (!sameExact(completed?.postInstallArtifact, artifactProjection)) {
    errors.push('post-install artifact does not exactly match the admitted artifact');
  }

  const deviceIdentityErrors = validateAndroidDeviceIdentity(receipt?.deviceIdentity);
  const expectedDeviceIdentitySha256 = deviceIdentityErrors.length
    ? null
    : androidDeviceIdentitySha256(receipt.deviceIdentity);
  if (deviceIdentityErrors.length
      || !sameExact(start?.deviceIdentity, receipt?.deviceIdentity)
      || !sameExact(wrapper?.deviceIdentity, receipt?.deviceIdentity)
      || start?.deviceIdentitySha256 !== expectedDeviceIdentitySha256
      || completed?.deviceIdentitySha256 !== start?.deviceIdentitySha256) {
    errors.push('install device identity does not exactly match the first-ball device');
  }
  const inventory = completed?.installedPackageInventory;
  if (!Array.isArray(inventory) || inventory.length !== 1
      || Object.keys(inventory?.[0] ?? {}).sort().join(',') !== 'path,sha256'
      || !canonicalDevicePath(inventory?.[0]?.path)
      || inventory?.[0]?.sha256 !== expectedApkSha256
      || !sameExact(inventory, receipt?.installedPackageInventoryBefore)
      || !sameExact(inventory, receipt?.installedPackageInventoryAfter)) {
    errors.push('install inventory does not exactly match the first-ball package inventory');
  }

  const startRecordBindings = {
    admission: 'admission',
    artifactCheck: 'preinstallArtifactCheck',
    absence: 'packageAbsence',
    deviceIdentity: 'preinstallDeviceIdentity',
    unityPayloadBindingAdmission: 'unityPayloadBindingAdmissionFile',
    unityPayloadBindingAdmissionSourceBracket: 'unityPayloadBindingAdmissionSourceBracketFile',
    unityPayloadBindingPreinstallRecheck: 'unityPayloadBindingPreinstallRecheckFile',
    unityPayloadBindingPreinstallSourceBracket: 'unityPayloadBindingPreinstallSourceBracketFile',
  };
  const completionRecordBindings = {
    start: 'installTransactionStart',
    immediateArtifactCheck: 'installArtifactFinalCheck',
    postInstallArtifactCheck: 'installArtifactPostCheck',
    installedPackageInventory: 'postInstallPackageInventory',
    installStatus: 'installStatus',
    installStdout: 'installStdout',
    installStderr: 'installStderr',
    unityPayloadBindingFinalRecheck: 'unityPayloadBindingFinalRecheckFile',
    unityPayloadBindingFinalSourceBracket: 'unityPayloadBindingFinalSourceBracketFile',
  };
  for (const [field, wrapperField] of Object.entries(startRecordBindings)) {
    if (!sameExact(start?.evidence?.[field], wrapper?.[wrapperField])) {
      errors.push(`install-start ${field} record differs from sealed-wrapper evidence`);
    }
  }
  for (const [field, wrapperField] of Object.entries(completionRecordBindings)) {
    if (!sameExact(completed?.evidence?.[field], wrapper?.[wrapperField])) {
      errors.push(`install-completion ${field} record differs from sealed-wrapper evidence`);
    }
  }
  if (wrapper?.installTransactionStart?.path === wrapper?.installTransaction?.path) {
    errors.push('install start and completion evidence files are not distinct');
  }
  return errors;
}

export function validateGateAUnityPayloadAdmission(report, expected = {}) {
  const errors = [];
  const add = (condition, message) => { if (!condition) errors.push(message); };
  try {
    exactKeys(report, [
      'schemaVersion', 'kind', 'status', 'limitation', 'invocationId',
      'sourceBuildId', 'sidecar', 'apk', 'receipt', 'trees',
    ], 'frozen verifier admission');
    exactKeys(report.sidecar, ['path', 'bytes', 'sha256'], 'frozen verifier sidecar');
    exactKeys(report.apk, [
      'path', 'fileName', 'bytes', 'sha256', 'signerCertificateSha256',
    ], 'frozen verifier APK');
    exactKeys(report.receipt, [
      'sha256', 'sourceFileCount', 'sourceTreeSha256', 'exportFileCount', 'exportTreeSha256',
    ], 'frozen verifier receipt');
    exactKeys(report.trees, [
      'assetsSha256', 'nativeModuleSha256', 'nativeAppSha256',
    ], 'frozen verifier trees');
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return errors;
  }

  add(report.schemaVersion === 1, 'frozen verifier schemaVersion is not 1');
  add(report.kind === ADMISSION_KIND, 'frozen verifier kind is invalid');
  add(report.status === 'RE_DERIVED_LOCAL_INTEGRITY_NOT_CERTIFICATION', 'frozen verifier status is invalid');
  add(report.limitation === LOCAL_PROVENANCE_LIMITATION, 'frozen verifier limitation differs');
  add(BUILD_ID.test(report.sourceBuildId ?? ''), 'frozen verifier source identity is invalid');
  add(INVOCATION_ID.test(report.invocationId ?? ''), 'frozen verifier invocation ID is invalid');
  add(requirePositiveSafeCount(report.sidecar.bytes), 'frozen verifier sidecar byte count is invalid');
  add(requirePositiveSafeCount(report.apk.bytes), 'frozen verifier APK byte count is invalid');
  add(report.apk.fileName === basename(report.apk.path ?? ''), 'frozen verifier APK basename is inconsistent');
  for (const [label, value] of [
    ['sidecar SHA-256', report.sidecar.sha256],
    ['APK SHA-256', report.apk.sha256],
    ['APK signer SHA-256', report.apk.signerCertificateSha256],
    ['receipt SHA-256', report.receipt.sha256],
    ['receipt source tree SHA-256', report.receipt.sourceTreeSha256],
    ['receipt export tree SHA-256', report.receipt.exportTreeSha256],
    ['asset tree SHA-256', report.trees.assetsSha256],
    ['module native tree SHA-256', report.trees.nativeModuleSha256],
    ['app native tree SHA-256', report.trees.nativeAppSha256],
  ]) add(SHA256.test(value ?? ''), `${label} is invalid`);
  add(requirePositiveSafeCount(report.receipt.sourceFileCount), 'receipt source count is invalid');
  add(requirePositiveSafeCount(report.receipt.exportFileCount), 'receipt export count is invalid');

  if (expected.sourceBuildId) {
    add(report.sourceBuildId === expected.sourceBuildId, 'Gate-A admission source build differs');
  }
  if (expected.sidecarPath) add(report.sidecar.path === expected.sidecarPath, 'Gate-A admission sidecar path differs');
  if (expected.sidecarSha256) add(report.sidecar.sha256 === expected.sidecarSha256, 'Gate-A admission sidecar SHA-256 differs');
  if (expected.apkPath) add(report.apk.path === expected.apkPath, 'Gate-A admission APK path differs');
  if (expected.apkSha256) add(report.apk.sha256 === expected.apkSha256, 'Gate-A admission APK SHA-256 differs');
  if (expected.apkFileName) add(report.apk.fileName === expected.apkFileName, 'Gate-A admission APK basename differs');
  return errors;
}

export function validateGateAUnitySourceBracket(report, admission, expected = {}) {
  const errors = [];
  try {
    exactKeys(report, [
      'schemaVersion', 'kind', 'status', 'sourceBuildIdBefore', 'sourceBuildIdAfter',
      'admissionPath', 'admissionSha256',
    ], 'Gate-A Unity source bracket');
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  if (report.schemaVersion !== 1 || report.kind !== BRACKET_KIND || report.status !== 'SOURCE_AND_FULL_VERIFIER_BRACKETED') {
    errors.push('Gate-A Unity source bracket header is invalid');
  }
  if (!BUILD_ID.test(report.sourceBuildIdBefore ?? '') || report.sourceBuildIdAfter !== report.sourceBuildIdBefore) {
    errors.push('source identity changed across full verifier');
  }
  if (report.sourceBuildIdBefore !== admission?.sourceBuildId) errors.push('source bracket differs from full verifier object');
  if (expected.sourceBuildId && report.sourceBuildIdBefore !== expected.sourceBuildId) errors.push('source bracket build differs');
  if (expected.admissionPath && report.admissionPath !== expected.admissionPath) errors.push('source bracket admission path differs');
  if (!SHA256.test(report.admissionSha256 ?? '') || report.admissionSha256 !== sha256Json(admission)) {
    errors.push('source bracket full admission SHA-256 differs');
  }
  return errors;
}

/**
 * Read-only replay validator for consumers of a completed first-ball receipt.
 * It performs no ADB, build, launch, install or write operation.  Every one of
 * the three exact verifier objects and source brackets is replayed from its
 * receipt-bound file and compared to the embedded objects and install receipts.
 */
export function validateGateAUnityEvidenceFromFirstBall({
  receipt,
  evidenceRoot,
  expectedBuildId,
  expectedApkSha256,
}) {
  const errors = [];
  const root = resolve(evidenceRoot ?? '');
  if (!isAbsolute(evidenceRoot ?? '') || resolve(evidenceRoot) !== evidenceRoot) {
    return ['Gate-A Unity evidence root must be canonical absolute'];
  }
  const withinRoot = (path) => path === root || path.startsWith(`${root}${sep}`);
  const readRecordBytes = (record, label) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)
        || JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(['bytes', 'path', 'sha256'])
        || typeof record.path !== 'string' || !isAbsolute(record.path)
        || resolve(record.path) !== record.path || /[\0\r\n]/u.test(record.path)
        || !SHA256.test(record.sha256 ?? '')
        || !/^(?:0|[1-9][0-9]*)$/u.test(record.bytes ?? '')) {
      errors.push(`${label} evidence record is invalid`);
      return null;
    }
    const path = record.path;
    if (path === root || !withinRoot(path) || !existsSync(path)) {
      errors.push(`${label} evidence file is missing or outside the evidence root`);
      return null;
    }
    try {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        errors.push(`${label} evidence path is not a regular non-symbolic file`);
        return null;
      }
      const bytes = readFileSync(path);
      if (record.bytes !== String(bytes.length) || record.sha256 !== sha256Bytes(bytes)) {
        errors.push(`${label} evidence bytes or SHA-256 changed`);
        return null;
      }
      return bytes;
    } catch (error) {
      errors.push(`${label} evidence cannot be replayed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };
  const readRecord = (record, label) => {
    const bytes = readRecordBytes(record, label);
    if (!bytes) return null;
    try {
      return JSON.parse(bytes.toString('utf8'));
    } catch (error) {
      errors.push(`${label} evidence is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };
  const readTextRecord = (record, label) => readRecordBytes(record, label)?.toString('utf8') ?? null;

  const top = receipt?.unityPayloadBinding;
  const wrapper = receipt?.sealedWrapperEvidence?.unityPayloadBinding;
  const sealedWrapper = receipt?.sealedWrapperEvidence;
  const wrapperRecordNames = Object.keys(WRAPPER_RECORD_BASENAMES);
  const wrapperRecordBytes = new Map(wrapperRecordNames.map((name) => [
    name,
    readRecordBytes(sealedWrapper?.[name], `sealed-wrapper ${name}`),
  ]));
  if (!top || JSON.stringify(top) !== JSON.stringify(wrapper)) {
    return ['top-level Unity payload binding does not exactly match sealed-wrapper evidence'];
  }
  appendExactKeys(errors, sealedWrapper, [
    ...wrapperRecordNames,
    'packageAbsentBeforeInstall', 'packageAbsencePolicy', 'installOperation', 'runId',
    'installTransactionReceipt', 'deviceIdentity', 'artifactIdentity', 'unityPayloadBinding',
  ], 'sealed-wrapper evidence');
  appendExactKeys(errors, top, [
    'expectedSidecar', 'admission', 'admissionSourceBracket',
    'preinstallRecheck', 'preinstallSourceBracket', 'finalRecheck', 'finalSourceBracket',
    'admissionFile', 'admissionSourceBracketFile', 'preinstallRecheckFile',
    'preinstallSourceBracketFile', 'finalRecheckFile', 'finalSourceBracketFile',
  ], 'Unity payload binding');
  appendExactKeys(errors, top.expectedSidecar, ['path', 'sha256'], 'Unity payload expected sidecar');
  const wrapperRecordPaths = wrapperRecordNames.map((name) => sealedWrapper?.[name]?.path);
  if (wrapperRecordPaths.some((path) => typeof path !== 'string')
      || new Set(wrapperRecordPaths).size !== wrapperRecordNames.length) {
    errors.push('all sealed-wrapper evidence records must have distinct paths');
  }
  for (const [name, expectedBasename] of Object.entries(WRAPPER_RECORD_BASENAMES)) {
    const path = sealedWrapper?.[name]?.path;
    if (typeof path !== 'string' || dirname(path) !== root || basename(path) !== expectedBasename) {
      errors.push(`sealed-wrapper ${name} evidence must be root-level ${expectedBasename}`);
    }
  }
  const adbIsolationBytes = wrapperRecordBytes.get('adbIsolation');
  if (adbIsolationBytes) {
    errors.push(...validateAdbIsolationText(adbIsolationBytes.toString('utf8'), receipt?.serial));
  }
  const expected = {
    sourceBuildId: expectedBuildId,
    sidecarPath: top?.expectedSidecar?.path,
    sidecarSha256: top?.expectedSidecar?.sha256,
    apkPath: receipt?.artifact?.path,
    apkSha256: expectedApkSha256,
    apkFileName: basename(receipt?.artifact?.path ?? ''),
  };
  if (!BUILD_ID.test(expectedBuildId ?? '') || !SHA256.test(expectedApkSha256 ?? '')
      || typeof expected.sidecarPath !== 'string' || !isAbsolute(expected.sidecarPath)
      || /[\r\n\0]/u.test(expected.sidecarPath) || resolve(expected.sidecarPath) !== expected.sidecarPath
      || !SHA256.test(expected.sidecarSha256 ?? '')) {
    errors.push('Unity payload replay expectation is invalid');
  }

  const pairs = [
    ['initial', 'admission', 'admissionSourceBracket', 'admissionFile', 'admissionSourceBracketFile', 'unityPayloadBindingAdmissionFile', 'unityPayloadBindingAdmissionSourceBracketFile'],
    ['install-start recheck', 'preinstallRecheck', 'preinstallSourceBracket', 'preinstallRecheckFile', 'preinstallSourceBracketFile', 'unityPayloadBindingPreinstallRecheckFile', 'unityPayloadBindingPreinstallSourceBracketFile'],
    ['final preinstall recheck', 'finalRecheck', 'finalSourceBracket', 'finalRecheckFile', 'finalSourceBracketFile', 'unityPayloadBindingFinalRecheckFile', 'unityPayloadBindingFinalSourceBracketFile'],
  ];
  for (const [label, objectName, bracketName, nestedRecordName, nestedBracketRecordName, recordName, bracketRecordName] of pairs) {
    const admission = top?.[objectName];
    const sourceBracket = top?.[bracketName];
    const record = receipt?.sealedWrapperEvidence?.[recordName];
    const bracketRecord = receipt?.sealedWrapperEvidence?.[bracketRecordName];
    if (JSON.stringify(top?.[nestedRecordName]) !== JSON.stringify(record)
        || JSON.stringify(top?.[nestedBracketRecordName]) !== JSON.stringify(bracketRecord)) {
      errors.push(`${label} nested file records differ from sealed-wrapper records`);
    }
    const admissionErrors = validateGateAUnityPayloadAdmission(admission, expected);
    if (admissionErrors.length) errors.push(`${label} Unity admission rejected: ${admissionErrors.join(', ')}`);
    const bracketErrors = validateGateAUnitySourceBracket(sourceBracket, admission, {
      sourceBuildId: expectedBuildId,
      admissionPath: record?.path,
    });
    if (bracketErrors.length) errors.push(`${label} Unity source bracket rejected: ${bracketErrors.join(', ')}`);
    const replayedAdmission = readRecord(record, `${label} Unity admission`);
    const replayedBracket = readRecord(bracketRecord, `${label} Unity source bracket`);
    if (replayedAdmission && JSON.stringify(replayedAdmission) !== JSON.stringify(admission)) {
      errors.push(`${label} Unity admission evidence file differs from its embedded full object`);
    }
    if (replayedBracket && JSON.stringify(replayedBracket) !== JSON.stringify(sourceBracket)) {
      errors.push(`${label} Unity source-bracket evidence file differs from its embedded object`);
    }
  }
  if (JSON.stringify(top.admission) !== JSON.stringify(top.preinstallRecheck)
      || JSON.stringify(top.admission) !== JSON.stringify(top.finalRecheck)) {
    errors.push('full Unity payload verifier objects differ across both preinstall rechecks');
  }

  const start = readRecord(receipt?.sealedWrapperEvidence?.installTransactionStart, 'install-start receipt');
  const completed = readRecord(receipt?.sealedWrapperEvidence?.installTransaction, 'install-completion receipt');
  const sealedAdmission = readRecord(
    receipt?.sealedWrapperEvidence?.admission,
    'sealed artifact admission',
  );
  const packageAbsence = readRecord(
    receipt?.sealedWrapperEvidence?.packageAbsence,
    'package-absence receipt',
  );
  const artifactChecks = [
    ['preinstall', 'preinstallArtifactCheck'],
    ['final preinstall', 'installArtifactFinalCheck'],
    ['post-install', 'installArtifactPostCheck'],
  ].map(([label, name]) => [label, name, readRecord(sealedWrapper?.[name], `${label} artifact check`)]);
  if (start && completed) errors.push(...validateCanonicalInstallBinding({
    receipt,
    start,
    completed,
    expectedBuildId,
    expectedApkSha256,
  }));
  if (sealedAdmission) {
    appendExactKeys(errors, sealedAdmission, [
      'schemaVersion', 'status', 'limitation', 'recordedUtc', 'sourceBuildId',
      'sourceArtifact', 'artifact', 'embeddedBuild', 'unityProof',
      'unityPayloadProvenance', 'badging', 'signature', 'unityExportReceipt',
    ], 'sealed artifact admission');
    appendExactKeys(errors, sealedAdmission.artifact, [
      'path', 'bytes', 'sha256', 'identity', 'parentIdentity', 'privateReadOnlyCopy',
    ], 'sealed admission artifact');
    appendExactKeys(errors, sealedAdmission.sourceArtifact, [
      'path', 'sha256', 'identity', 'stableAcrossCopy',
    ], 'sealed source artifact');
    appendFileIdentity(errors, sealedAdmission.artifact?.identity, 'sealed admission artifact identity');
    appendFileIdentity(errors, sealedAdmission.artifact?.parentIdentity, 'sealed admission artifact parent identity');
    appendFileIdentity(errors, sealedAdmission.sourceArtifact?.identity, 'sealed source artifact identity');
    appendExactKeys(errors, sealedAdmission.embeddedBuild, [
      'expectedBuildId', 'discoveredBuildIds', 'indexScripts', 'chunks',
    ], 'sealed admission embedded-build proof');
    appendExactKeys(errors, sealedAdmission.unityProof, [
      'complete', 'completeAbis', 'unityAppGuidPresent',
    ], 'sealed admission Unity proof');
    appendExactKeys(errors, sealedAdmission.unityPayloadProvenance, [
      'status', 'mappingSchema', 'entries',
    ], 'sealed admission Unity provenance');
    appendExactKeys(errors, sealedAdmission.badging, [
      'pass', 'packageId', 'debuggable', 'launchable', 'errors',
    ], 'sealed admission badging');
    appendExactKeys(errors, sealedAdmission.signature, ['tool', 'report'], 'sealed admission signature');
    appendExactKeys(errors, sealedAdmission.unityExportReceipt, [
      'path', 'sha256', 'gradleStatus', 'gradleOutputTail',
    ], 'sealed admission Unity export receipt');
    const chunks = Array.isArray(sealedAdmission.embeddedBuild?.chunks)
      ? sealedAdmission.embeddedBuild.chunks : [];
    for (const [index, chunk] of chunks.entries()) {
      appendExactKeys(errors, chunk, [
        'entry', 'referencedByIndex', 'sha256', 'repositoryBuildIds', 'containsExpectedBuildId',
      ], `sealed admission embedded chunk ${index}`);
    }
    const aggregateChunkBuildIds = [...new Set(chunks.flatMap((chunk) => (
      Array.isArray(chunk?.repositoryBuildIds) ? chunk.repositoryBuildIds : []
    )))].sort();
    let sealedSignerCertificateSha256 = null;
    try {
      sealedSignerCertificateSha256 = parseApkSignerReport(
        Array.isArray(sealedAdmission.signature?.report)
          ? sealedAdmission.signature.report.join('\n')
          : '',
      );
    } catch (error) {
      errors.push(`sealed admission signature report is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (sealedAdmission.schemaVersion !== 1
        || sealedAdmission.status !== 'SEALED_ARTIFACT_ADMITTED_FOR_ENGINEERING_EVIDENCE'
        || sealedAdmission.limitation !== SEALED_ADMISSION_LIMITATION
        || !validUtc(sealedAdmission.recordedUtc)
        || sealedAdmission.sourceBuildId !== expectedBuildId
        || !canonicalAbsolutePath(sealedAdmission.sourceArtifact?.path)
        || sealedAdmission.sourceArtifact?.sha256 !== expectedApkSha256
        || sealedAdmission.sourceArtifact?.identity?.size !== receipt?.artifact?.bytes
        || basename(sealedAdmission.sourceArtifact?.path ?? '') !== basename(receipt?.artifact?.path ?? '')
        || sealedAdmission.sourceArtifact?.path === sealedAdmission.artifact?.path
        || sealedAdmission.sourceArtifact?.stableAcrossCopy !== true
        || sealedAdmission.artifact?.privateReadOnlyCopy !== true
        || !canonicalAbsolutePath(sealedAdmission.artifact?.path)
        || sealedAdmission.artifact?.bytes !== receipt?.artifact?.bytes
        || sealedAdmission.artifact?.identity?.size !== receipt?.artifact?.bytes
        || sealedAdmission.artifact?.sha256 !== expectedApkSha256
        || sealedAdmission.artifact?.path !== receipt?.artifact?.path
        || !sameExact(sealedAdmission.artifact, start?.artifact)
        || !sameExact(sealedAdmission.artifact, completed?.artifact)
        || sealedAdmission.embeddedBuild?.expectedBuildId !== expectedBuildId
        || !sameExact(sealedAdmission.embeddedBuild?.discoveredBuildIds, [expectedBuildId])
        || !Array.isArray(sealedAdmission.embeddedBuild?.indexScripts)
        || sealedAdmission.embeddedBuild.indexScripts.length === 0
        || new Set(sealedAdmission.embeddedBuild.indexScripts).size !== sealedAdmission.embeddedBuild.indexScripts.length
        || sealedAdmission.embeddedBuild.indexScripts.some((entry) => !/^assets\/public\/.*\.js$/u.test(entry))
        || chunks.length === 0
        || new Set(chunks.map((chunk) => chunk.entry)).size !== chunks.length
        || chunks.some((chunk) => !/^assets\/public\/.*\.js$/u.test(chunk.entry ?? '')
          || typeof chunk.referencedByIndex !== 'boolean'
          || chunk.referencedByIndex !== sealedAdmission.embeddedBuild.indexScripts.includes(chunk.entry)
          || !SHA256.test(chunk.sha256 ?? '')
          || !Array.isArray(chunk.repositoryBuildIds)
          || chunk.repositoryBuildIds.some((id) => !BUILD_ID.test(id))
          || !sameExact(chunk.repositoryBuildIds, [...new Set(chunk.repositoryBuildIds)].sort())
          || chunk.containsExpectedBuildId !== chunk.repositoryBuildIds.includes(expectedBuildId))
        || !sameExact(aggregateChunkBuildIds, sealedAdmission.embeddedBuild.discoveredBuildIds)
        || !chunks.some((chunk) => chunk.containsExpectedBuildId === true)
        || sealedAdmission.embeddedBuild.indexScripts.some((entry) => !chunks.some(
          (chunk) => chunk.entry === entry && chunk.referencedByIndex === true,
        ))
        || sealedAdmission.unityProof?.complete !== true
        || sealedAdmission.unityProof?.unityAppGuidPresent !== true
        || !Array.isArray(sealedAdmission.unityProof?.completeAbis)
        || sealedAdmission.unityProof.completeAbis.length === 0
        || new Set(sealedAdmission.unityProof.completeAbis).size !== sealedAdmission.unityProof.completeAbis.length
        || sealedAdmission.unityProof.completeAbis.some((abi) => !/^[A-Za-z0-9_.-]+$/u.test(abi))
        || !sealedAdmission.unityProof.completeAbis.includes('arm64-v8a')
        || sealedAdmission.unityPayloadProvenance?.status !== 'UNPROVEN_PENDING_VERSIONED_APK_TO_EXPORT_MAP'
        || sealedAdmission.unityPayloadProvenance?.mappingSchema !== null
        || !sameExact(sealedAdmission.unityPayloadProvenance?.entries, [])
        || sealedAdmission.badging?.pass !== true
        || sealedAdmission.badging?.packageId !== receipt?.packageId
        || sealedAdmission.badging?.debuggable !== false
        || !sameExact(sealedAdmission.badging?.launchable, [`${receipt?.packageId}.MainActivity`])
        || !sameExact(sealedAdmission.badging?.errors, [])
        || !canonicalAbsolutePath(sealedAdmission.signature?.tool)
        || basename(sealedAdmission.signature?.tool ?? '') !== 'apksigner'
        || !Array.isArray(sealedAdmission.signature?.report)
        || sealedAdmission.signature.report.length === 0
        || sealedAdmission.signature.report.length > 20
        || sealedAdmission.signature.report.some((line) => typeof line !== 'string' || /[\r\n]/u.test(line))
        || sealedSignerCertificateSha256 !== top?.admission?.apk?.signerCertificateSha256
        || !canonicalAbsolutePath(sealedAdmission.unityExportReceipt?.path)
        || sealedAdmission.unityExportReceipt?.path !== UNITY_EXPORT_RECEIPT_PATH
        || !SHA256.test(sealedAdmission.unityExportReceipt?.sha256 ?? '')
        || sealedAdmission.unityExportReceipt?.sha256 !== top?.admission?.receipt?.sha256
        || sealedAdmission.unityExportReceipt?.gradleStatus !== 0
        || !Array.isArray(sealedAdmission.unityExportReceipt?.gradleOutputTail)
        || sealedAdmission.unityExportReceipt.gradleOutputTail.length > 40
        || sealedAdmission.unityExportReceipt.gradleOutputTail.some(
          (line) => typeof line !== 'string' || /[\r\n]/u.test(line),
        )) {
      errors.push('sealed admission artifact does not exactly bind the install transaction');
    }
  }
  const artifactProjection = {
    path: receipt?.artifact?.path,
    sha256: receipt?.artifact?.sha256,
    identity: receipt?.artifact?.identity,
    parentIdentity: receipt?.artifact?.parentIdentity,
  };
  const artifactCheckPaths = [];
  for (const [label, name, check] of artifactChecks) {
    if (!check) continue;
    appendExactKeys(errors, check, [
      'schemaVersion', 'status', 'recordedUtc', 'admission', 'artifact',
    ], `${label} artifact check`);
    appendExactKeys(errors, check.admission, ['path', 'sha256'], `${label} artifact admission reference`);
    appendExactKeys(errors, check.artifact, [
      'path', 'sha256', 'identity', 'parentIdentity',
    ], `${label} artifact projection`);
    artifactCheckPaths.push(sealedWrapper?.[name]?.path);
    if (check.schemaVersion !== 1 || check.status !== 'SEALED_ARTIFACT_IDENTITY_RECHECKED'
        || !validUtc(check.recordedUtc)
        || !sameExact(check.admission, {
          path: sealedWrapper?.admission?.path,
          sha256: sealedWrapper?.admission?.sha256,
        })
        || !sameExact(check.artifact, artifactProjection)) {
      errors.push(`${label} artifact check does not exactly bind the sealed admission`);
    }
  }
  if (artifactCheckPaths.length !== 3 || new Set(artifactCheckPaths).size !== 3) {
    errors.push('preinstall, final and post-install artifact checks are not distinct evidence files');
  }
  const preinstallStatusText = wrapperRecordBytes.get('preinstallStatus')?.toString('utf8') ?? null;
  const preinstallStdoutText = wrapperRecordBytes.get('preinstallStdout')?.toString('utf8') ?? null;
  const preinstallStderrText = wrapperRecordBytes.get('preinstallStderr')?.toString('utf8') ?? null;
  if (packageAbsence) {
    appendExactKeys(errors, packageAbsence, [
      'schemaVersion', 'status', 'recordedUtc', 'classification', 'evidence',
    ], 'package-absence receipt');
    appendExactKeys(errors, packageAbsence.classification, [
      'absent', 'policy', 'exitStatus',
    ], 'package-absence classification');
    appendExactKeys(errors, packageAbsence.evidence, [
      'status', 'stdout', 'stderr',
    ], 'package-absence evidence');
    const expectedClassification = classifyPmPathAbsence({
      status: preinstallStatusText === null ? Number.NaN : Number(preinstallStatusText.trim()),
      stdout: preinstallStdoutText ?? '',
      stderr: preinstallStderrText ?? '',
    });
    if (packageAbsence.schemaVersion !== 1 || packageAbsence.status !== 'PACKAGE_ABSENCE_PROVEN'
        || !validUtc(packageAbsence.recordedUtc)
        || preinstallStatusText !== '1\n' || preinstallStdoutText !== '' || preinstallStderrText !== ''
        || !sameExact(packageAbsence.classification, expectedClassification)
        || expectedClassification.absent !== true
        || !sameExact(packageAbsence.evidence?.status, sealedWrapper?.preinstallStatus)
        || !sameExact(packageAbsence.evidence?.stdout, sealedWrapper?.preinstallStdout)
        || !sameExact(packageAbsence.evidence?.stderr, sealedWrapper?.preinstallStderr)
        || sealedWrapper?.packageAbsentBeforeInstall !== true
        || sealedWrapper?.packageAbsencePolicy !== expectedClassification.policy) {
      errors.push('package-absence evidence is not the exact absent-package transaction');
    }
  }
  const installStatusText = wrapperRecordBytes.get('installStatus')?.toString('utf8') ?? null;
  const installStdoutText = wrapperRecordBytes.get('installStdout')?.toString('utf8') ?? null;
  const installStderrText = wrapperRecordBytes.get('installStderr')?.toString('utf8') ?? null;
  if (installStatusText !== '0\n'
      || typeof installStdoutText !== 'string'
      || !/(?:^|\n)Success(?:\n|$)/u.test(installStdoutText)
      || installStderrText !== '') {
    errors.push('install result is not exact status-0/complete-Success-line/empty-stderr evidence');
  }
  const installedInventoryReceipt = readRecord(
    receipt?.sealedWrapperEvidence?.postInstallPackageInventory,
    'post-install package inventory',
  );
  if (installedInventoryReceipt) {
    const inventoryErrors = validateInstalledPackageInventoryReceipt(installedInventoryReceipt, {
      serial: receipt?.serial,
      packageId: receipt?.packageId,
      artifactSha256: expectedApkSha256,
    });
    if (inventoryErrors.length) {
      errors.push(`post-install package inventory rejected: ${inventoryErrors.join(', ')}`);
    }
    for (const [label, embedded] of [
      ['parsed completion', completed?.installedPackageInventory],
      ['first-ball before', receipt?.installedPackageInventoryBefore],
      ['first-ball after', receipt?.installedPackageInventoryAfter],
      ['sealed-wrapper transaction', receipt?.sealedWrapperEvidence?.installTransactionReceipt?.installedPackageInventory],
    ]) {
      if (!sameExact(installedInventoryReceipt.inventory, embedded)) {
        errors.push(`post-install package inventory evidence differs from ${label} inventory`);
      }
    }
  }
  const preinstallDeviceReceipt = readRecord(
    receipt?.sealedWrapperEvidence?.preinstallDeviceIdentity,
    'preinstall device identity',
  );
  if (preinstallDeviceReceipt) {
    appendExactKeys(errors, preinstallDeviceReceipt, [
      'schemaVersion', 'identityPolicyId', 'status', 'capturedUtc', 'identity', 'identitySha256', 'diagnostics',
    ], 'preinstall device identity receipt');
    appendExactKeys(
      errors,
      preinstallDeviceReceipt.identity,
      ANDROID_IDENTITY_FIELDS,
      'preinstall device identity',
    );
    const deviceErrors = validateAndroidDeviceIdentity(preinstallDeviceReceipt.identity);
    const receiptErrors = validateAndroidDeviceIdentityReceipt(preinstallDeviceReceipt);
    const deviceSha256 = deviceErrors.length
      ? null
      : androidDeviceIdentitySha256(preinstallDeviceReceipt.identity);
    if (receiptErrors.length
        || deviceErrors.length
        || preinstallDeviceReceipt.identity?.serial !== receipt?.serial
        || preinstallDeviceReceipt.identitySha256 !== deviceSha256) {
      errors.push('preinstall device identity receipt is invalid');
    }
    for (const [label, identity, identitySha256] of [
      ['install start', start?.deviceIdentity, start?.deviceIdentitySha256],
      ['install completion', completed?.deviceIdentity, completed?.deviceIdentitySha256],
      ['first-ball top level', receipt?.deviceIdentity, deviceSha256],
      ['sealed wrapper', receipt?.sealedWrapperEvidence?.deviceIdentity, deviceSha256],
      ['live before', receipt?.stateBefore?.deviceIdentity, deviceSha256],
      ['live after', receipt?.stateAfter?.deviceIdentity, deviceSha256],
      ['dead ball', receipt?.deadState?.deviceIdentity, deviceSha256],
      ['stable boundary', receipt?.stableBoundary?.deviceIdentity, deviceSha256],
    ]) {
      if (!sameExact(preinstallDeviceReceipt.identity, identity)
          || identitySha256 !== preinstallDeviceReceipt.identitySha256) {
        errors.push(`preinstall device identity evidence differs from ${label}`);
      }
    }
  }
  const utcSequence = [
    ['sealed admission', sealedAdmission?.recordedUtc],
    ['preinstall device identity', preinstallDeviceReceipt?.capturedUtc],
    ['package absence', packageAbsence?.recordedUtc],
    ['preinstall artifact check', artifactChecks[0]?.[2]?.recordedUtc],
    ['install start', start?.startedUtc],
    ['final preinstall artifact check', artifactChecks[1]?.[2]?.recordedUtc],
    ['post-install artifact check', artifactChecks[2]?.[2]?.recordedUtc],
    ['post-install inventory', installedInventoryReceipt?.recordedUtc],
    ['install completion', completed?.finishedUtc],
  ];
  for (let index = 0; index < utcSequence.length; index += 1) {
    const [label, utc] = utcSequence[index];
    if (!validUtc(utc)) {
      errors.push(`${label} UTC is invalid or missing`);
      continue;
    }
    if (index > 0) {
      const [previousLabel, previousUtc] = utcSequence[index - 1];
      if (validUtc(previousUtc) && Date.parse(utc) < Date.parse(previousUtc)) {
        errors.push(`${label} UTC precedes ${previousLabel}`);
      }
    }
  }
  if (start) {
    if (JSON.stringify(start.unityPayloadBindingAdmission) !== JSON.stringify(top.admission)
        || JSON.stringify(start.unityPayloadBindingPreinstallRecheck) !== JSON.stringify(top.preinstallRecheck)
        || JSON.stringify(start.unityPayloadBindingExpectedSidecar) !== JSON.stringify(top.expectedSidecar)) {
      errors.push('install-start receipt differs from embedded Unity payload evidence');
    }
  }
  if (completed) {
    if (JSON.stringify(completed.unityPayloadBindingAdmission) !== JSON.stringify(top.admission)
        || JSON.stringify(completed.unityPayloadBindingPreinstallRecheck) !== JSON.stringify(top.preinstallRecheck)
        || JSON.stringify(completed.unityPayloadBindingFinalRecheck) !== JSON.stringify(top.finalRecheck)
        || JSON.stringify(completed.unityPayloadBindingExpectedSidecar) !== JSON.stringify(top.expectedSidecar)) {
      errors.push('install-completion receipt differs from embedded Unity payload evidence');
    }
  }
  return errors;
}

function requirePositiveSafeCount(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function readSourceBuildId(root) {
  return execFileSync(join(root, 'release/player-experience/tools/build-id.sh'), [], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
}

export function createGateAUnityPayloadAdmission(options, dependencies = {}) {
  const root = requireAbsolute(options.root, 'repository root');
  const sidecarPath = requireAbsolute(options.sidecarPath, 'payload-binding sidecar');
  const apkPath = requireAbsolute(options.apkPath, 'private admitted APK');
  const receiptPath = requireAbsolute(options.receiptPath, 'Unity receipt');
  const apksigner = requireAbsolute(options.apksigner, 'apksigner');
  const outputFile = requireAbsolute(options.outputFile, 'output file');
  const sourceBracketOutputFile = requireAbsolute(options.sourceBracketOutputFile, 'source bracket output file');
  requireSha(options.expectedSidecarSha256, 'expected sidecar SHA-256');
  requireSha(options.expectedApkSha256, 'expected APK SHA-256');
  if (!BUILD_ID.test(options.expectedBuildId ?? '')) fail('expected build identity is invalid');
  if (existsSync(outputFile)) fail(`refusing to overwrite ${outputFile}`);
  if (existsSync(sourceBracketOutputFile)) fail(`refusing to overwrite ${sourceBracketOutputFile}`);

  const sourceBuildId = dependencies.sourceBuildId ?? (() => readSourceBuildId(root));
  const verify = dependencies.verify ?? verifyExistingAndroidUnityPayloadBinding;
  const sourceBuildIdBefore = sourceBuildId();
  if (sourceBuildIdBefore !== options.expectedBuildId) fail('source identity before verifier differs from sealed build');
  const verifierAdmission = verify({
    root,
    sidecarPath,
    expectedSidecarPath: sidecarPath,
    expectedSidecarSha256: options.expectedSidecarSha256,
    apkPath,
    currentSourceBuildId: sourceBuildIdBefore,
    receiptPath,
    apksigner,
  });
  const sourceBuildIdAfter = sourceBuildId();
  const report = {
    schemaVersion: 1,
    kind: BRACKET_KIND,
    status: 'SOURCE_AND_FULL_VERIFIER_BRACKETED',
    sourceBuildIdBefore,
    sourceBuildIdAfter,
    admissionPath: outputFile,
    admissionSha256: sha256Json(verifierAdmission),
  };
  const admissionErrors = validateGateAUnityPayloadAdmission(verifierAdmission, {
    sourceBuildId: options.expectedBuildId,
    sidecarPath,
    sidecarSha256: options.expectedSidecarSha256,
    apkPath,
    apkSha256: options.expectedApkSha256,
    apkFileName: basename(apkPath),
  });
  if (admissionErrors.length) fail(admissionErrors.join('; '));
  const bracketErrors = validateGateAUnitySourceBracket(report, verifierAdmission, {
    sourceBuildId: options.expectedBuildId,
    admissionPath: outputFile,
  });
  if (bracketErrors.length) fail(bracketErrors.join('; '));
  writeFileSync(outputFile, `${JSON.stringify(verifierAdmission, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  writeFileSync(sourceBracketOutputFile, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return { admission: verifierAdmission, sourceBracket: report };
}

function parseArgs(argv) {
  const allowed = new Set([
    '--root', '--sidecar', '--expected-sidecar-sha256', '--apk', '--expected-apk-sha256',
    '--expected-build-id', '--receipt', '--apksigner', '--output', '--source-bracket-output',
  ]);
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name)) fail(`unknown option ${name ?? 'missing'}`);
    if (!value || value.startsWith('--')) fail(`${name} requires a value`);
    if (values[name] !== undefined) fail(`duplicate option ${name}`);
    values[name] = value;
  }
  for (const name of allowed) if (values[name] === undefined) fail(`${name} is required`);
  return {
    root: values['--root'],
    sidecarPath: values['--sidecar'],
    expectedSidecarSha256: values['--expected-sidecar-sha256'],
    apkPath: values['--apk'],
    expectedApkSha256: values['--expected-apk-sha256'],
    expectedBuildId: values['--expected-build-id'],
    receiptPath: values['--receipt'],
    apksigner: values['--apksigner'],
    outputFile: values['--output'],
    sourceBracketOutputFile: values['--source-bracket-output'],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = createGateAUnityPayloadAdmission(parseArgs(process.argv.slice(2)));
    console.log(`${report.admission.status} ${report.admission.invocationId}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
