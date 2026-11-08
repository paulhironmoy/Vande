#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createAndroidDeviceIdentityReceipt,
} from './android-device-identity.mjs';
import {
  captureInstalledPackageInventory,
  finishInstallTransaction,
  startInstallTransaction,
  validateInstallTransaction,
  writePackageAbsenceReceipt,
} from './android-gate-a-receipt.mjs';
import {
  recheckAdmittedArtifact,
  snapshotArtifactIdentity,
} from './android-sealed-artifact.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const buildId = '38924bd+0123456789ab';
const artifactSha = 'a'.repeat(64);
const identity = {
  serial: 'emulator-5584', model: 'Pixel', release: '16', api: '36', buildFingerprint: 'vendor/device/build',
  securityPatch: '2026-10-05', androidBuildId: 'ABC123', socModel: 'Tensor', boardPlatform: 'tensor',
  hardwareEgl: 'angle', hardwareVulkan: 'vulkan', openGlEsVersion: '196610', graphicsDriver0: 'driver',
  graphicsDriver1: '', primaryAbi: 'arm64-v8a', supportedAbis: 'arm64-v8a', currentUser: '0',
  cores: '8', memKb: '8192000', gpuDriverObservation: 'GLES: ANGLE',
};

function unityAdmission(apkPath, apkSha = artifactSha) {
  return {
    schemaVersion: 1,
    kind: 'VANDE_UNITY_ANDROID_PAYLOAD_BINDING_ADMISSION',
    status: 'RE_DERIVED_LOCAL_INTEGRITY_NOT_CERTIFICATION',
    limitation: 'Local build-time provenance only; not Play, installed-size, reach, physical-device, runtime, human-player, or malicious-builder-resistant evidence.',
    invocationId: '1'.repeat(32),
    sourceBuildId: buildId,
    sidecar: { path: '/private/tmp/vande-payload-binding.json', bytes: 100, sha256: 'b'.repeat(64) },
    apk: { path: apkPath, fileName: apkPath.split('/').at(-1), bytes: 10, sha256: apkSha, signerCertificateSha256: 'c'.repeat(64) },
    receipt: { sha256: 'd'.repeat(64), sourceFileCount: 1, sourceTreeSha256: 'e'.repeat(64), exportFileCount: 1, exportTreeSha256: 'f'.repeat(64) },
    trees: { assetsSha256: '1'.repeat(64), nativeModuleSha256: '2'.repeat(64), nativeAppSha256: '3'.repeat(64) },
  };
}

function writeUnityProof(scratch, name, apkPath, apkSha = artifactSha) {
  const admission = unityAdmission(apkPath, apkSha);
  const admissionFile = join(scratch, `${name}.json`);
  writeFileSync(admissionFile, JSON.stringify(admission));
  const sourceBracket = {
    schemaVersion: 1,
    kind: 'VANDE_GATE_A_UNITY_PAYLOAD_SOURCE_BRACKET',
    status: 'SOURCE_AND_FULL_VERIFIER_BRACKETED',
    sourceBuildIdBefore: buildId,
    sourceBuildIdAfter: buildId,
    admissionPath: admissionFile,
    admissionSha256: sha(JSON.stringify(admission)),
  };
  const sourceBracketFile = join(scratch, `${name}-source-bracket.json`);
  writeFileSync(sourceBracketFile, JSON.stringify(sourceBracket));
  return { admission, admissionFile, sourceBracket, sourceBracketFile };
}

test('post-install inventory capture binds one exact installed APK path and hash', () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'vande-install-inventory-')));
  const fakeAdb = join(scratch, 'fake-adb');
  writeFileSync(fakeAdb, `#!/usr/bin/env node
const command = process.argv.slice(2).join(' ');
if (command === '-s ${identity.serial} shell pm path in.vande.cricket') {
  process.stdout.write('package:/data/app/base.apk\\n');
} else if (command === '-s ${identity.serial} shell sha256sum /data/app/base.apk') {
  process.stdout.write('${artifactSha}  /data/app/base.apk\\n');
} else {
  process.stderr.write('unexpected command: ' + command + '\\n');
  process.exitCode = 2;
}
`, { mode: 0o700 });
  chmodSync(fakeAdb, 0o700);
  const outputFile = join(scratch, 'inventory.json');
  const report = captureInstalledPackageInventory({
    adb: fakeAdb,
    serial: identity.serial,
    packageId: 'in.vande.cricket',
    expectedArtifactSha256: artifactSha,
    outputFile,
  });
  assert.deepEqual(report.inventory, inventoryReceipt().inventory);
  assert.deepEqual(JSON.parse(readFileSync(outputFile, 'utf8')).inventory, report.inventory);
});

function inventoryReceipt() {
  const path = '/data/app/base.apk';
  return {
    schemaVersion: 1,
    status: 'EXACT_INSTALLED_PACKAGE_INVENTORY_CAPTURED',
    recordedUtc: new Date().toISOString(),
    serial: identity.serial,
    packageId: 'in.vande.cricket',
    inventory: [{ path, sha256: artifactSha }],
    capture: {
      pmPath: { exitStatus: 0, stdout: `package:${path}\n`, stderr: '' },
      sha256: [{ exitStatus: 0, stdout: `${artifactSha}  ${path}\n`, stderr: '' }],
    },
  };
}

test('absence and install receipts bind one exact immutable run/device/artifact transaction', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'vande-install-receipt-'));
  const status = join(scratch, 'pm-status.txt');
  const stdout = join(scratch, 'pm-stdout.txt');
  const stderr = join(scratch, 'pm-stderr.txt');
  writeFileSync(status, '1\n');
  writeFileSync(stdout, '');
  writeFileSync(stderr, '');
  const absenceFile = join(scratch, 'absence.json');
  writePackageAbsenceReceipt({ statusFile: status, stdoutFile: stdout, stderrFile: stderr, outputFile: absenceFile });

  const artifact = {
    path: join(scratch, 'private', 'admitted.apk'), sha256: artifactSha,
    identity: { dev: '1', ino: '2', mode: '33024', nlink: '1', uid: '1', gid: '1', size: '10', mtimeNs: '3', ctimeNs: '4' },
    parentIdentity: { dev: '1', ino: '5', mode: '16704', nlink: '2', uid: '1', gid: '1', size: '64', mtimeNs: '6', ctimeNs: '7' },
  };
  const admissionFile = join(scratch, 'admission.json');
  writeFileSync(admissionFile, JSON.stringify({
    status: 'SEALED_ARTIFACT_ADMITTED_FOR_ENGINEERING_EVIDENCE', sourceBuildId: buildId, artifact,
  }));
  const artifactCheckFile = join(scratch, 'artifact-check.json');
  writeFileSync(artifactCheckFile, JSON.stringify({ status: 'SEALED_ARTIFACT_IDENTITY_RECHECKED', artifact }));
  const postInstallArtifactCheckFile = join(scratch, 'post-install-artifact-check.json');
  writeFileSync(postInstallArtifactCheckFile, JSON.stringify({ status: 'SEALED_ARTIFACT_IDENTITY_RECHECKED', artifact }));
  const inventoryFile = join(scratch, 'post-install-package-inventory.json');
  writeFileSync(inventoryFile, JSON.stringify(inventoryReceipt()));
  const deviceFile = join(scratch, 'device.json');
  writeFileSync(deviceFile, JSON.stringify(createAndroidDeviceIdentityReceipt({
    identity, gpuRaw: 'GLES: ANGLE', capturedUtc: '2026-10-29T02:59:58.000Z',
  })));
  const unityInitial = writeUnityProof(scratch, 'unity-initial', artifact.path, artifact.sha256);
  const unityPreinstall = writeUnityProof(scratch, 'unity-preinstall', artifact.path, artifact.sha256);
  const unityFinal = writeUnityProof(scratch, 'unity-final', artifact.path, artifact.sha256);
  const startFile = join(scratch, 'start.json');
  const start = startInstallTransaction({
    outputFile: startFile, serial: identity.serial, packageId: 'in.vande.cricket', buildId,
    admissionFile, artifactCheckFile, absenceFile, deviceIdentityFile: deviceFile,
    unityAdmissionFile: unityInitial.admissionFile,
    unityAdmissionSourceBracketFile: unityInitial.sourceBracketFile,
    unityPreinstallRecheckFile: unityPreinstall.admissionFile,
    unityPreinstallSourceBracketFile: unityPreinstall.sourceBracketFile,
    unitySidecarPath: '/private/tmp/vande-payload-binding.json',
    expectedUnitySidecarSha256: 'b'.repeat(64),
  });
  const installStatus = join(scratch, 'install-status.txt');
  const installStdout = join(scratch, 'install-stdout.txt');
  const installStderr = join(scratch, 'install-stderr.txt');
  writeFileSync(installStatus, '0\n');
  writeFileSync(installStdout, 'Success\n');
  writeFileSync(installStderr, '');
  const transactionFile = join(scratch, 'transaction.json');
  const transaction = finishInstallTransaction({
    startFile, artifactCheckFile, postInstallArtifactCheckFile, inventoryFile,
    unityFinalRecheckFile: unityFinal.admissionFile,
    unityFinalSourceBracketFile: unityFinal.sourceBracketFile,
    statusFile: installStatus, stdoutFile: installStdout,
    stderrFile: installStderr, outputFile: transactionFile,
  });
  assert.deepEqual(validateInstallTransaction({
    start,
    transaction,
    expected: { serial: identity.serial, packageId: 'in.vande.cricket', buildId, artifactSha256: artifactSha },
  }), []);
  assert.equal(JSON.parse(readFileSync(transactionFile, 'utf8')).runId, start.runId);
  assert.deepEqual(transaction.installedPackageInventory, inventoryReceipt().inventory);
  assert.deepEqual(transaction.unityPayloadBindingAdmission, unityInitial.admission);
  assert.deepEqual(transaction.unityPayloadBindingFinalRecheck, unityFinal.admission);
  assert.notEqual(sha(readFileSync(startFile)), sha(readFileSync(transactionFile)));
  assert.match(validateInstallTransaction({ start, transaction: { ...transaction, runId: 'other' } }).join('; '), /runId/u);
  assert.match(validateInstallTransaction({
    start,
    transaction: {
      ...transaction,
      unityPayloadBindingFinalRecheck: { ...transaction.unityPayloadBindingFinalRecheck, invocationId: 'swapped' },
    },
  }).join('; '), /verifier objects differ|admission rejected/u);
  assert.match(validateInstallTransaction({
    start,
    transaction: { ...transaction, unityPayloadBindingFinalRecheck: true },
  }).join('; '), /admission rejected|verifier objects differ/u);
  assert.match(validateInstallTransaction({
    start,
    transaction: { ...transaction, postInstallArtifact: { ...transaction.postInstallArtifact, sha256: 'b'.repeat(64) } },
  }).join('; '), /post-install artifact/u);
  assert.match(validateInstallTransaction({
    start,
    transaction: { ...transaction, deviceIdentity: { ...identity, buildFingerprint: 'other' } },
  }).join('; '), /device identity/u);
  const swappedAdmission = { ...unityPreinstall.admission, invocationId: 'file-swapped' };
  writeFileSync(unityPreinstall.admissionFile, JSON.stringify(swappedAdmission));
  const swappedBytes = readFileSync(unityPreinstall.admissionFile);
  const swappedStart = structuredClone(start);
  swappedStart.evidence.unityPayloadBindingPreinstallRecheck = {
    path: unityPreinstall.admissionFile,
    sha256: sha(swappedBytes),
    bytes: String(swappedBytes.length),
  };
  assert.match(validateInstallTransaction({ start: swappedStart, transaction }).join('; '), /evidence file differs from its embedded full object/u);
});

test('mutate/read/restore across install cannot produce a completion receipt', () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'vande-install-mut-rest-')));
  const artifactDir = join(scratch, 'sealed-artifact');
  mkdirSync(artifactDir);
  const apk = join(artifactDir, 'admitted.apk');
  const original = Buffer.from('ORIGINAL-SEALED-APK');
  const mutated = Buffer.alloc(original.length, 0x4d);
  writeFileSync(apk, original, { mode: 0o400 });
  const artifact = snapshotArtifactIdentity(apk);

  const pmStatus = join(scratch, 'pm-status.txt');
  const pmStdout = join(scratch, 'pm-stdout.txt');
  const pmStderr = join(scratch, 'pm-stderr.txt');
  writeFileSync(pmStatus, '1\n');
  writeFileSync(pmStdout, '');
  writeFileSync(pmStderr, '');
  const absenceFile = join(scratch, 'absence.json');
  writePackageAbsenceReceipt({ statusFile: pmStatus, stdoutFile: pmStdout, stderrFile: pmStderr, outputFile: absenceFile });
  const admissionFile = join(scratch, 'admission.json');
  writeFileSync(admissionFile, JSON.stringify({
    status: 'SEALED_ARTIFACT_ADMITTED_FOR_ENGINEERING_EVIDENCE', sourceBuildId: buildId, artifact,
  }));
  const precheckFile = join(scratch, 'precheck.json');
  writeFileSync(precheckFile, JSON.stringify({ status: 'SEALED_ARTIFACT_IDENTITY_RECHECKED', artifact }));
  const deviceFile = join(scratch, 'device.json');
  writeFileSync(deviceFile, JSON.stringify(createAndroidDeviceIdentityReceipt({
    identity, gpuRaw: 'GLES: ANGLE', capturedUtc: '2026-10-29T02:59:58.000Z',
  })));
  const unityInitial = writeUnityProof(scratch, 'unity-initial', artifact.path, artifact.sha256);
  const unityPreinstall = writeUnityProof(scratch, 'unity-preinstall', artifact.path, artifact.sha256);
  const unityFinal = writeUnityProof(scratch, 'unity-final', artifact.path, artifact.sha256);
  const startFile = join(scratch, 'start.json');
  startInstallTransaction({
    outputFile: startFile, serial: identity.serial, packageId: 'in.vande.cricket', buildId,
    admissionFile, artifactCheckFile: precheckFile, absenceFile, deviceIdentityFile: deviceFile,
    unityAdmissionFile: unityInitial.admissionFile,
    unityAdmissionSourceBracketFile: unityInitial.sourceBracketFile,
    unityPreinstallRecheckFile: unityPreinstall.admissionFile,
    unityPreinstallSourceBracketFile: unityPreinstall.sourceBracketFile,
    unitySidecarPath: '/private/tmp/vande-payload-binding.json',
    expectedUnitySidecarSha256: 'b'.repeat(64),
  });

  chmodSync(apk, 0o600);
  writeFileSync(apk, mutated);
  assert.notDeepEqual(readFileSync(apk), original);
  writeFileSync(apk, original);
  chmodSync(apk, 0o400);
  const postCheckFile = join(scratch, 'postcheck.json');
  assert.throws(() => recheckAdmittedArtifact({ admissionFile, outputFile: postCheckFile }), /changed/u);
  assert.equal(existsSync(postCheckFile), false);

  const installStatus = join(scratch, 'install-status.txt');
  const installStdout = join(scratch, 'install-stdout.txt');
  const installStderr = join(scratch, 'install-stderr.txt');
  const inventoryFile = join(scratch, 'inventory.json');
  writeFileSync(installStatus, '0\n');
  writeFileSync(installStdout, 'Success\n');
  writeFileSync(installStderr, '');
  writeFileSync(inventoryFile, JSON.stringify(inventoryReceipt()));
  const transactionFile = join(scratch, 'transaction.json');
  assert.throws(() => finishInstallTransaction({
    startFile,
    artifactCheckFile: precheckFile,
    unityFinalRecheckFile: unityFinal.admissionFile,
    unityFinalSourceBracketFile: unityFinal.sourceBracketFile,
    postInstallArtifactCheckFile: postCheckFile,
    inventoryFile,
    statusFile: installStatus,
    stdoutFile: installStdout,
    stderrFile: installStderr,
    outputFile: transactionFile,
  }));
  assert.equal(existsSync(transactionFile), false);
});
