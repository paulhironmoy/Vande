#!/usr/bin/env node

/** Immutable sidecar receipts for the sealed Gate-A install transaction. */

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classifyPmPathAbsence } from './android-gate-a.mjs';
import {
  androidDeviceIdentitySha256,
  validateAndroidDeviceIdentity,
  validateAndroidDeviceIdentityReceipt,
} from './android-device-identity.mjs';
import {
  validateGateAUnityPayloadAdmission,
  validateGateAUnitySourceBracket,
} from './android-gate-a-unity-admission.mjs';
import {
  parseExactInstalledApkHashOutput,
  parseExactInstalledPackagePathOutput,
  validateInstalledPackageInventoryReceipt,
} from './android-installed-package-inventory.mjs';

export { validateInstalledPackageInventoryReceipt } from './android-installed-package-inventory.mjs';

const SHA256 = /^[0-9a-f]{64}$/u;
const BUILD_ID = /^[0-9a-f]{7,40}(?:\+[0-9a-f]{12})?$/u;
const SAFE_SERIAL = /^[A-Za-z0-9._:-]{1,128}$/u;
const SAFE_PACKAGE = /^[A-Za-z][A-Za-z0-9_.]{2,255}$/u;
function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fileRecord(path) {
  const bytes = readFileSync(path);
  return { path: resolve(path), sha256: sha256Bytes(bytes), bytes: String(bytes.length) };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readUnityPayloadProof(admissionFile, sourceBracketFile, expected) {
  const admission = readJson(admissionFile);
  const sourceBracket = readJson(sourceBracketFile);
  const admissionErrors = validateGateAUnityPayloadAdmission(admission, expected);
  if (admissionErrors.length) throw new Error(`Unity payload admission rejected: ${admissionErrors.join('; ')}`);
  const bracketErrors = validateGateAUnitySourceBracket(sourceBracket, admission, {
    sourceBuildId: expected.sourceBuildId,
    admissionPath: resolve(admissionFile),
  });
  if (bracketErrors.length) throw new Error(`Unity payload source bracket rejected: ${bracketErrors.join('; ')}`);
  return {
    admission,
    admissionFile: fileRecord(admissionFile),
    sourceBracket,
    sourceBracketFile: fileRecord(sourceBracketFile),
  };
}

function requireNew(path) {
  if (existsSync(path)) throw new Error(`refusing to overwrite Gate-A receipt ${path}`);
}

function writeNew(path, value) {
  requireNew(path);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}

export function writePackageAbsenceReceipt({ statusFile, stdoutFile, stderrFile, outputFile }) {
  requireNew(outputFile);
  const statusText = readFileSync(statusFile, 'utf8');
  if (!/^[0-9]+\n?$/u.test(statusText)) throw new Error('pm path status evidence is malformed');
  const stdout = readFileSync(stdoutFile, 'utf8');
  const stderr = readFileSync(stderrFile, 'utf8');
  const classification = classifyPmPathAbsence({ status: Number(statusText.trim()), stdout, stderr });
  if (!classification.absent) throw new Error(`package absence was not proven: ${classification.reason}`);
  const report = {
    schemaVersion: 1,
    status: 'PACKAGE_ABSENCE_PROVEN',
    recordedUtc: new Date().toISOString(),
    classification,
    evidence: {
      status: fileRecord(statusFile),
      stdout: fileRecord(stdoutFile),
      stderr: fileRecord(stderrFile),
    },
  };
  writeNew(outputFile, report);
  return report;
}

export function validatePackageAbsenceReceipt(report) {
  const errors = [];
  if (report?.schemaVersion !== 1 || report?.status !== 'PACKAGE_ABSENCE_PROVEN') errors.push('package-absence receipt header is invalid');
  const records = report?.evidence ?? {};
  for (const name of ['status', 'stdout', 'stderr']) {
    const record = records[name];
    if (!record || typeof record.path !== 'string' || !SHA256.test(record.sha256 ?? '') || !existsSync(record.path)) {
      errors.push(`${name} evidence is missing`);
    } else if (fileRecord(record.path).sha256 !== record.sha256) {
      errors.push(`${name} evidence changed`);
    }
  }
  if (!errors.length) {
    const statusText = readFileSync(records.status.path, 'utf8');
    const classification = classifyPmPathAbsence({
      status: Number(statusText.trim()),
      stdout: readFileSync(records.stdout.path, 'utf8'),
      stderr: readFileSync(records.stderr.path, 'utf8'),
    });
    if (!classification.absent || classification.policy !== report.classification?.policy) errors.push('package-absence classification is not reproducible');
  }
  return errors;
}

function runAdb(adb, serial, args) {
  if (typeof adb !== 'string' || !adb.startsWith('/')) throw new Error('ADB path must be absolute');
  const result = spawnSync(adb, ['-s', serial, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw new Error(`could not run ADB inventory command: ${result.error.message}`);
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export function captureInstalledPackageInventory({ adb, serial, packageId, expectedArtifactSha256, outputFile }) {
  requireNew(outputFile);
  if (!SAFE_SERIAL.test(serial)) throw new Error('unsafe inventory serial');
  if (!SAFE_PACKAGE.test(packageId)) throw new Error('unsafe inventory package');
  if (!SHA256.test(expectedArtifactSha256 ?? '')) throw new Error('invalid expected inventory artifact SHA-256');
  const pmPath = runAdb(adb, serial, ['shell', 'pm', 'path', packageId]);
  const path = parseExactInstalledPackagePathOutput(pmPath.stdout);
  if (pmPath.status !== 0 || pmPath.stderr !== '' || !path) {
    throw new Error('installed package inventory is not one exact safe APK path');
  }
  const hashResult = runAdb(adb, serial, ['shell', 'sha256sum', path]);
  const hash = parseExactInstalledApkHashOutput(hashResult.stdout, path);
  if (hashResult.status !== 0 || hashResult.stderr !== '' || !hash) {
    throw new Error(`installed APK hash capture is invalid for ${path}`);
  }
  const hashes = [hashResult];
  const inventory = [hash];
  if (inventory[0].sha256 !== expectedArtifactSha256) {
    throw new Error('installed monolithic APK hash does not match admitted artifact');
  }
  const report = {
    schemaVersion: 1,
    status: 'EXACT_INSTALLED_PACKAGE_INVENTORY_CAPTURED',
    recordedUtc: new Date().toISOString(),
    serial,
    packageId,
    inventory,
    capture: {
      pmPath: { exitStatus: pmPath.status, stdout: pmPath.stdout, stderr: pmPath.stderr },
      sha256: hashes.map((result) => ({ exitStatus: result.status, stdout: result.stdout, stderr: result.stderr })),
    },
  };
  const errors = validateInstalledPackageInventoryReceipt(report, { serial, packageId, artifactSha256: expectedArtifactSha256 });
  if (errors.length) throw new Error(`installed-package inventory capture rejected: ${errors.join('; ')}`);
  writeNew(outputFile, report);
  return report;
}

export function startInstallTransaction({
  outputFile,
  serial,
  packageId,
  buildId,
  admissionFile,
  artifactCheckFile,
  unityAdmissionFile,
  unityAdmissionSourceBracketFile,
  unityPreinstallRecheckFile,
  unityPreinstallSourceBracketFile,
  unitySidecarPath,
  expectedUnitySidecarSha256,
  absenceFile,
  deviceIdentityFile,
}) {
  requireNew(outputFile);
  if (!SAFE_SERIAL.test(serial)) throw new Error('unsafe install serial');
  if (!SAFE_PACKAGE.test(packageId)) throw new Error('unsafe install package');
  if (!BUILD_ID.test(buildId)) throw new Error('invalid install build ID');
  const admission = readJson(admissionFile);
  const artifactCheck = readJson(artifactCheckFile);
  const absence = readJson(absenceFile);
  const deviceReport = readJson(deviceIdentityFile);
  const absenceErrors = validatePackageAbsenceReceipt(absence);
  if (absenceErrors.length) throw new Error(`package-absence receipt rejected: ${absenceErrors.join('; ')}`);
  if (admission?.status !== 'SEALED_ARTIFACT_ADMITTED_FOR_ENGINEERING_EVIDENCE'
      || admission?.sourceBuildId !== buildId || !SHA256.test(admission?.artifact?.sha256 ?? '')) {
    throw new Error('sealed admission is invalid for install start');
  }
  if (artifactCheck?.status !== 'SEALED_ARTIFACT_IDENTITY_RECHECKED'
      || artifactCheck?.artifact?.sha256 !== admission.artifact.sha256
      || JSON.stringify(artifactCheck?.artifact?.identity) !== JSON.stringify(admission?.artifact?.identity)) {
    throw new Error('preinstall artifact check does not match admission');
  }
  if (!unitySidecarPath?.startsWith('/') || !SHA256.test(expectedUnitySidecarSha256 ?? '')) {
    throw new Error('sealed Unity payload sidecar expectation is invalid');
  }
  const unityExpected = {
    sourceBuildId: buildId,
    sidecarPath: resolve(unitySidecarPath),
    sidecarSha256: expectedUnitySidecarSha256,
    apkPath: admission.artifact.path,
    apkSha256: admission.artifact.sha256,
    apkFileName: admission.artifact.path.split('/').at(-1),
  };
  const unityAdmission = readUnityPayloadProof(
    unityAdmissionFile, unityAdmissionSourceBracketFile, unityExpected,
  );
  const unityPreinstallRecheck = readUnityPayloadProof(
    unityPreinstallRecheckFile, unityPreinstallSourceBracketFile, unityExpected,
  );
  if (!sameJson(unityAdmission.admission, unityPreinstallRecheck.admission)) {
    throw new Error('full Unity payload verifier object changed before install start');
  }
  if (validateAndroidDeviceIdentityReceipt(deviceReport).length
      || deviceReport.identity.serial !== serial) {
    throw new Error('preinstall Android device identity is invalid');
  }
  const report = {
    schemaVersion: 1,
    status: 'SEALED_INSTALL_STARTED',
    runId: randomUUID(),
    startedUtc: new Date().toISOString(),
    startedHostMonotonicNs: process.hrtime.bigint().toString(),
    serial,
    packageId,
    buildId,
    artifact: admission.artifact,
    deviceIdentity: deviceReport.identity,
    deviceIdentitySha256: deviceReport.identitySha256,
    unityPayloadBindingAdmission: unityAdmission.admission,
    unityPayloadBindingAdmissionSourceBracket: unityAdmission.sourceBracket,
    unityPayloadBindingPreinstallRecheck: unityPreinstallRecheck.admission,
    unityPayloadBindingPreinstallSourceBracket: unityPreinstallRecheck.sourceBracket,
    unityPayloadBindingExpectedSidecar: {
      path: resolve(unitySidecarPath),
      sha256: expectedUnitySidecarSha256,
    },
    evidence: {
      admission: fileRecord(admissionFile),
      artifactCheck: fileRecord(artifactCheckFile),
      absence: fileRecord(absenceFile),
      deviceIdentity: fileRecord(deviceIdentityFile),
      unityPayloadBindingAdmission: unityAdmission.admissionFile,
      unityPayloadBindingAdmissionSourceBracket: unityAdmission.sourceBracketFile,
      unityPayloadBindingPreinstallRecheck: unityPreinstallRecheck.admissionFile,
      unityPayloadBindingPreinstallSourceBracket: unityPreinstallRecheck.sourceBracketFile,
    },
  };
  writeNew(outputFile, report);
  return report;
}

export function finishInstallTransaction({
  startFile,
  artifactCheckFile,
  unityFinalRecheckFile,
  unityFinalSourceBracketFile,
  postInstallArtifactCheckFile,
  inventoryFile,
  statusFile,
  stdoutFile,
  stderrFile,
  outputFile,
}) {
  requireNew(outputFile);
  if (resolve(artifactCheckFile) === resolve(postInstallArtifactCheckFile)) {
    throw new Error('post-install artifact check must be a new snapshot distinct from the pre-install check');
  }
  const start = readJson(startFile);
  const statusText = readFileSync(statusFile, 'utf8');
  const stdout = readFileSync(stdoutFile, 'utf8');
  const stderr = readFileSync(stderrFile, 'utf8');
  const artifactCheck = readJson(artifactCheckFile);
  const postInstallArtifactCheck = readJson(postInstallArtifactCheckFile);
  const installedPackageInventory = readJson(inventoryFile);
  if (start?.status !== 'SEALED_INSTALL_STARTED' || typeof start?.runId !== 'string') throw new Error('install-start receipt is invalid');
  if (statusText !== '0\n' || !/(?:^|\n)Success(?:\n|$)/u.test(stdout) || stderr.length !== 0) {
    throw new Error('adb install result is not the exact successful Gate-A shape');
  }
  const exactArtifactIdentity = {
    path: start.artifact.path,
    sha256: start.artifact.sha256,
    identity: start.artifact.identity,
    parentIdentity: start.artifact.parentIdentity,
  };
  if (artifactCheck?.status !== 'SEALED_ARTIFACT_IDENTITY_RECHECKED'
      || !sameJson(artifactCheck?.artifact, exactArtifactIdentity)) {
    throw new Error('final immediate artifact recheck does not match install start');
  }
  if (postInstallArtifactCheck?.status !== 'SEALED_ARTIFACT_IDENTITY_RECHECKED'
      || !sameJson(postInstallArtifactCheck?.artifact, exactArtifactIdentity)) {
    throw new Error('post-install artifact recheck does not match install start');
  }
  const unityFinalRecheck = readUnityPayloadProof(unityFinalRecheckFile, unityFinalSourceBracketFile, {
    sourceBuildId: start.buildId,
    sidecarPath: start.unityPayloadBindingExpectedSidecar?.path,
    sidecarSha256: start.unityPayloadBindingExpectedSidecar?.sha256,
    apkPath: start.artifact.path,
    apkSha256: start.artifact.sha256,
    apkFileName: start.artifact.path.split('/').at(-1),
  });
  if (!sameJson(start.unityPayloadBindingAdmission, start.unityPayloadBindingPreinstallRecheck)
      || !sameJson(start.unityPayloadBindingAdmission, unityFinalRecheck.admission)) {
    throw new Error('full Unity payload verifier objects are not exactly equal across both preinstall rechecks');
  }
  const inventoryErrors = validateInstalledPackageInventoryReceipt(installedPackageInventory, {
    serial: start.serial,
    packageId: start.packageId,
    artifactSha256: start.artifact.sha256,
  });
  if (inventoryErrors.length) throw new Error(`post-install package inventory rejected: ${inventoryErrors.join('; ')}`);
  const report = {
    schemaVersion: 2,
    status: 'SEALED_INSTALL_COMPLETED',
    runId: start.runId,
    startedUtc: start.startedUtc,
    finishedUtc: new Date().toISOString(),
    startedHostMonotonicNs: start.startedHostMonotonicNs,
    finishedHostMonotonicNs: process.hrtime.bigint().toString(),
    serial: start.serial,
    packageId: start.packageId,
    buildId: start.buildId,
    artifact: start.artifact,
    postInstallArtifact: postInstallArtifactCheck.artifact,
    installedPackageInventory: installedPackageInventory.inventory,
    deviceIdentity: start.deviceIdentity,
    deviceIdentitySha256: start.deviceIdentitySha256,
    unityPayloadBindingAdmission: start.unityPayloadBindingAdmission,
    unityPayloadBindingAdmissionSourceBracket: start.unityPayloadBindingAdmissionSourceBracket,
    unityPayloadBindingPreinstallRecheck: start.unityPayloadBindingPreinstallRecheck,
    unityPayloadBindingPreinstallSourceBracket: start.unityPayloadBindingPreinstallSourceBracket,
    unityPayloadBindingFinalRecheck: unityFinalRecheck.admission,
    unityPayloadBindingFinalSourceBracket: unityFinalRecheck.sourceBracket,
    unityPayloadBindingExpectedSidecar: start.unityPayloadBindingExpectedSidecar,
    operation: 'adb -s <explicit serial> install -r <private immutable admitted APK>',
    evidence: {
      start: fileRecord(startFile),
      immediateArtifactCheck: fileRecord(artifactCheckFile),
      postInstallArtifactCheck: fileRecord(postInstallArtifactCheckFile),
      installedPackageInventory: fileRecord(inventoryFile),
      installStatus: fileRecord(statusFile),
      installStdout: fileRecord(stdoutFile),
      installStderr: fileRecord(stderrFile),
      unityPayloadBindingFinalRecheck: unityFinalRecheck.admissionFile,
      unityPayloadBindingFinalSourceBracket: unityFinalRecheck.sourceBracketFile,
    },
  };
  if (!(Date.parse(report.startedUtc) <= Date.parse(report.finishedUtc))) throw new Error('install transaction timestamps are invalid');
  writeNew(outputFile, report);
  return report;
}

export function validateInstallTransaction({ start, transaction, expected = {} }) {
  const errors = [];
  if (start?.status !== 'SEALED_INSTALL_STARTED' || transaction?.schemaVersion !== 2
      || transaction?.status !== 'SEALED_INSTALL_COMPLETED') errors.push('install receipt status is invalid');
  for (const field of ['runId', 'serial', 'packageId', 'buildId', 'deviceIdentitySha256']) {
    if (!start?.[field] || transaction?.[field] !== start[field]) errors.push(`install ${field} binding is invalid`);
  }
  if (expected.serial && transaction?.serial !== expected.serial) errors.push('install serial does not match');
  if (expected.packageId && transaction?.packageId !== expected.packageId) errors.push('install package does not match');
  if (expected.buildId && transaction?.buildId !== expected.buildId) errors.push('install build ID does not match');
  if (expected.artifactSha256 && transaction?.artifact?.sha256 !== expected.artifactSha256) errors.push('install artifact SHA-256 does not match');
  if (transaction?.operation !== 'adb -s <explicit serial> install -r <private immutable admitted APK>') errors.push('install operation is not exact');
  if (!sameJson(start?.artifact, transaction?.artifact)) errors.push('install artifact identity changed');
  if (!sameJson(transaction?.postInstallArtifact, {
    path: start?.artifact?.path,
    sha256: start?.artifact?.sha256,
    identity: start?.artifact?.identity,
    parentIdentity: start?.artifact?.parentIdentity,
  })) errors.push('post-install artifact identity changed');
  if (!sameJson(start?.deviceIdentity, transaction?.deviceIdentity)
      || validateAndroidDeviceIdentity(transaction?.deviceIdentity).length
      || transaction?.deviceIdentitySha256 !== androidDeviceIdentitySha256(transaction.deviceIdentity)) {
    errors.push('install device identity is invalid');
  }
  for (const [label, admission, sourceBracket, record, bracketRecord] of [
    [
      'initial', start?.unityPayloadBindingAdmission, start?.unityPayloadBindingAdmissionSourceBracket,
      start?.evidence?.unityPayloadBindingAdmission, start?.evidence?.unityPayloadBindingAdmissionSourceBracket,
    ],
    [
      'install-start recheck', start?.unityPayloadBindingPreinstallRecheck, start?.unityPayloadBindingPreinstallSourceBracket,
      start?.evidence?.unityPayloadBindingPreinstallRecheck, start?.evidence?.unityPayloadBindingPreinstallSourceBracket,
    ],
    [
      'final preinstall recheck', transaction?.unityPayloadBindingFinalRecheck, transaction?.unityPayloadBindingFinalSourceBracket,
      transaction?.evidence?.unityPayloadBindingFinalRecheck, transaction?.evidence?.unityPayloadBindingFinalSourceBracket,
    ],
  ]) {
    const admissionErrors = validateGateAUnityPayloadAdmission(admission, {
      sourceBuildId: start?.buildId,
      sidecarPath: start?.unityPayloadBindingExpectedSidecar?.path,
      sidecarSha256: start?.unityPayloadBindingExpectedSidecar?.sha256,
      apkPath: start?.artifact?.path,
      apkSha256: start?.artifact?.sha256,
      apkFileName: start?.artifact?.path?.split('/').at(-1),
    });
    if (admissionErrors.length) errors.push(`${label} Unity payload admission rejected: ${admissionErrors.join(', ')}`);
    const bracketErrors = validateGateAUnitySourceBracket(sourceBracket, admission, {
      sourceBuildId: start?.buildId,
      admissionPath: record?.path,
    });
    if (bracketErrors.length) errors.push(`${label} Unity source bracket rejected: ${bracketErrors.join(', ')}`);
    if (!record || !bracketRecord) errors.push(`${label} Unity evidence records are missing`);
    if (record?.path && existsSync(record.path)) {
      try {
        if (!sameJson(readJson(record.path), admission)) {
          errors.push(`${label} Unity admission evidence file differs from its embedded full object`);
        }
      } catch (error) {
        errors.push(`${label} Unity admission evidence cannot be replayed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (bracketRecord?.path && existsSync(bracketRecord.path)) {
      try {
        if (!sameJson(readJson(bracketRecord.path), sourceBracket)) {
          errors.push(`${label} Unity source-bracket evidence file differs from its embedded object`);
        }
      } catch (error) {
        errors.push(`${label} Unity source-bracket evidence cannot be replayed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (!sameJson(start?.unityPayloadBindingAdmission, start?.unityPayloadBindingPreinstallRecheck)
      || !sameJson(start?.unityPayloadBindingAdmission, transaction?.unityPayloadBindingAdmission)
      || !sameJson(start?.unityPayloadBindingAdmission, transaction?.unityPayloadBindingPreinstallRecheck)
      || !sameJson(start?.unityPayloadBindingAdmission, transaction?.unityPayloadBindingFinalRecheck)) {
    errors.push('full Unity payload verifier objects differ across the install transaction');
  }
  if (!sameJson(start?.unityPayloadBindingAdmissionSourceBracket, transaction?.unityPayloadBindingAdmissionSourceBracket)
      || !sameJson(start?.unityPayloadBindingPreinstallSourceBracket, transaction?.unityPayloadBindingPreinstallSourceBracket)) {
    errors.push('Unity payload source-bracket objects changed across the install transaction');
  }
  if (!SHA256.test(start?.unityPayloadBindingExpectedSidecar?.sha256 ?? '')
      || typeof start?.unityPayloadBindingExpectedSidecar?.path !== 'string'
      || !start.unityPayloadBindingExpectedSidecar.path.startsWith('/')
      || !sameJson(start.unityPayloadBindingExpectedSidecar, transaction?.unityPayloadBindingExpectedSidecar)) {
    errors.push('Unity payload expected sidecar identity is invalid or changed');
  }
  const started = Date.parse(transaction?.startedUtc ?? '');
  const finished = Date.parse(transaction?.finishedUtc ?? '');
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) errors.push('install time interval is invalid');
  for (const [owner, records, names] of [
    ['install start', start?.evidence, [
      'admission', 'artifactCheck', 'absence', 'deviceIdentity',
      'unityPayloadBindingAdmission', 'unityPayloadBindingAdmissionSourceBracket',
      'unityPayloadBindingPreinstallRecheck', 'unityPayloadBindingPreinstallSourceBracket',
    ]],
    ['install completion', transaction?.evidence, [
      'start', 'immediateArtifactCheck', 'postInstallArtifactCheck', 'installedPackageInventory',
      'installStatus', 'installStdout', 'installStderr',
      'unityPayloadBindingFinalRecheck', 'unityPayloadBindingFinalSourceBracket',
    ]],
  ]) {
    for (const name of names) {
      const record = records?.[name];
      if (!record || typeof record.path !== 'string' || !SHA256.test(record.sha256 ?? '') || !existsSync(record.path)) {
        errors.push(`${owner} ${name} evidence is missing`);
      } else if (fileRecord(record.path).sha256 !== record.sha256) {
        errors.push(`${owner} ${name} evidence changed`);
      }
    }
  }
  const immediateRecord = transaction?.evidence?.immediateArtifactCheck;
  const postRecord = transaction?.evidence?.postInstallArtifactCheck;
  if (immediateRecord?.path && postRecord?.path && resolve(immediateRecord.path) === resolve(postRecord.path)) {
    errors.push('install pre/post artifact checks are not distinct evidence');
  }
  for (const [label, record, embedded] of [
    ['pre-install', immediateRecord, {
      path: start?.artifact?.path,
      sha256: start?.artifact?.sha256,
      identity: start?.artifact?.identity,
      parentIdentity: start?.artifact?.parentIdentity,
    }],
    ['post-install', postRecord, transaction?.postInstallArtifact],
  ]) {
    if (record?.path && existsSync(record.path)) {
      try {
        const check = readJson(record.path);
        if (check?.status !== 'SEALED_ARTIFACT_IDENTITY_RECHECKED' || !sameJson(check?.artifact, embedded)) {
          errors.push(`${label} artifact check does not reproduce the transaction`);
        }
      } catch (error) {
        errors.push(`${label} artifact check cannot be read: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  const inventoryRecord = transaction?.evidence?.installedPackageInventory;
  if (inventoryRecord?.path && existsSync(inventoryRecord.path)) {
    try {
      const inventory = readJson(inventoryRecord.path);
      const inventoryErrors = validateInstalledPackageInventoryReceipt(inventory, {
        serial: transaction.serial,
        packageId: transaction.packageId,
        artifactSha256: transaction.artifact?.sha256,
      });
      if (inventoryErrors.length) errors.push(`install inventory receipt rejected: ${inventoryErrors.join('; ')}`);
      if (!sameJson(transaction.installedPackageInventory, inventory.inventory)) errors.push('install inventory embedding changed');
    } catch (error) {
      errors.push(`install inventory receipt cannot be read: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return errors;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseOptions(argv, allowed) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!allowed.includes(name)) throw new Error(`unknown option ${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    index += 1;
    options[name.slice(2).replaceAll('-', '_')] = value;
  }
  for (const name of allowed) if (!options[name.slice(2).replaceAll('-', '_')]) throw new Error(`${name} is required`);
  if (options.output) options.output = resolve(options.output);
  return options;
}

function main(argv) {
  const mode = argv[0];
  if (mode === 'package-absence') {
    const value = parseOptions(argv.slice(1), ['--status-file', '--stdout-file', '--stderr-file', '--output']);
    return writePackageAbsenceReceipt({
      statusFile: value.status_file,
      stdoutFile: value.stdout_file,
      stderrFile: value.stderr_file,
      outputFile: value.output,
    });
  }
  if (mode === 'start-install') {
    const value = parseOptions(argv.slice(1), [
      '--output', '--serial', '--package-id', '--build-id', '--admission-file', '--artifact-check-file',
      '--unity-admission-file', '--unity-admission-source-bracket-file',
      '--unity-preinstall-recheck-file', '--unity-preinstall-source-bracket-file',
      '--unity-sidecar-path', '--expected-unity-sidecar-sha256',
      '--absence-file', '--device-identity-file',
    ]);
    return startInstallTransaction({
      outputFile: value.output,
      serial: value.serial,
      packageId: value.package_id,
      buildId: value.build_id,
      admissionFile: value.admission_file,
      artifactCheckFile: value.artifact_check_file,
      unityAdmissionFile: value.unity_admission_file,
      unityAdmissionSourceBracketFile: value.unity_admission_source_bracket_file,
      unityPreinstallRecheckFile: value.unity_preinstall_recheck_file,
      unityPreinstallSourceBracketFile: value.unity_preinstall_source_bracket_file,
      unitySidecarPath: value.unity_sidecar_path,
      expectedUnitySidecarSha256: value.expected_unity_sidecar_sha256,
      absenceFile: value.absence_file,
      deviceIdentityFile: value.device_identity_file,
    });
  }
  if (mode === 'capture-installed-inventory') {
    const value = parseOptions(argv.slice(1), [
      '--adb', '--serial', '--package-id', '--expected-artifact-sha256', '--output',
    ]);
    return captureInstalledPackageInventory({
      adb: value.adb,
      serial: value.serial,
      packageId: value.package_id,
      expectedArtifactSha256: value.expected_artifact_sha256,
      outputFile: value.output,
    });
  }
  if (mode === 'finish-install') {
    const value = parseOptions(argv.slice(1), [
      '--start-file', '--artifact-check-file', '--post-install-artifact-check-file', '--inventory-file',
      '--unity-final-recheck-file', '--unity-final-source-bracket-file',
      '--status-file', '--stdout-file', '--stderr-file', '--output',
    ]);
    return finishInstallTransaction({
      startFile: value.start_file,
      artifactCheckFile: value.artifact_check_file,
      unityFinalRecheckFile: value.unity_final_recheck_file,
      unityFinalSourceBracketFile: value.unity_final_source_bracket_file,
      postInstallArtifactCheckFile: value.post_install_artifact_check_file,
      inventoryFile: value.inventory_file,
      statusFile: value.status_file,
      stdoutFile: value.stdout_file,
      stderrFile: value.stderr_file,
      outputFile: value.output,
    });
  }
  throw new Error('mode must be package-absence, start-install, capture-installed-inventory or finish-install');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = main(process.argv.slice(2));
    console.log(`${report.status} ${report.runId ?? report.classification?.policy ?? ''}`.trim());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
