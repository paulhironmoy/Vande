#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import test from 'node:test';
import {
  androidDeviceIdentitySha256,
  createAndroidDeviceIdentityReceipt,
} from './android-device-identity.mjs';
import { validateInstalledPackageInventoryReceipt } from './android-installed-package-inventory.mjs';
import { LOCAL_PROVENANCE_LIMITATION } from './android-unity-payload-binding.mjs';
import {
  createGateAUnityPayloadAdmission,
  validateGateAUnityPayloadAdmission,
  validateGateAUnitySourceBracket,
  validateGateAUnityEvidenceFromFirstBall,
} from './android-gate-a-unity-admission.mjs';

const buildId = '38924bd+0123456789ab';
const apkSha = 'a'.repeat(64);
const sidecarSha = 'b'.repeat(64);
const repo = resolve('.');

function frozenAdmission({ sidecarPath, apkPath, expectedSidecarSha256, currentSourceBuildId }) {
  return {
    schemaVersion: 1,
    kind: 'VANDE_UNITY_ANDROID_PAYLOAD_BINDING_ADMISSION',
    status: 'RE_DERIVED_LOCAL_INTEGRITY_NOT_CERTIFICATION',
    limitation: LOCAL_PROVENANCE_LIMITATION,
    invocationId: '1'.repeat(32),
    sourceBuildId: currentSourceBuildId,
    sidecar: { path: sidecarPath, bytes: 100, sha256: expectedSidecarSha256 },
    apk: {
      path: apkPath, fileName: basename(apkPath), bytes: 200, sha256: apkSha,
      signerCertificateSha256: 'c'.repeat(64),
    },
    receipt: {
      sha256: 'd'.repeat(64), sourceFileCount: 1, sourceTreeSha256: 'e'.repeat(64),
      exportFileCount: 2, exportTreeSha256: 'f'.repeat(64),
    },
    trees: {
      assetsSha256: '1'.repeat(64), nativeModuleSha256: '2'.repeat(64), nativeAppSha256: '3'.repeat(64),
    },
  };
}

function fixture() {
  const root = resolve(mkdtempSync(join(tmpdir(), 'vande-gate-a-h7-')));
  const options = {
    root,
    sidecarPath: join(root, 'vande-release-payload-binding.json'),
    expectedSidecarSha256: sidecarSha,
    apkPath: join(root, 'sealed-artifact', 'vande-release.apk'),
    expectedApkSha256: apkSha,
    expectedBuildId: buildId,
    receiptPath: join(root, 'unity-receipt.properties'),
    apksigner: join(root, 'apksigner'),
    outputFile: join(root, 'admission.json'),
    sourceBracketOutputFile: join(root, 'admission-source-bracket.json'),
  };
  const calls = [];
  const dependencies = {
    sourceBuildId: () => buildId,
    verify: (value) => {
      calls.push(value);
      return frozenAdmission(value);
    },
  };
  return { options, dependencies, calls };
}

test('full verifier result and hash survive deterministic Gate-A admission', () => {
  const { options, dependencies, calls } = fixture();
  const report = createGateAUnityPayloadAdmission(options, dependencies);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].expectedSidecarPath, options.sidecarPath);
  assert.equal(calls[0].expectedSidecarSha256, sidecarSha);
  assert.equal(report.admission.apk.fileName, basename(options.apkPath));
  assert.deepEqual(validateGateAUnityPayloadAdmission(report.admission, {
    sourceBuildId: buildId, sidecarPath: options.sidecarPath, sidecarSha256: sidecarSha,
    apkPath: options.apkPath, apkSha256: apkSha, apkFileName: basename(options.apkPath),
  }), []);
  assert.deepEqual(validateGateAUnitySourceBracket(report.sourceBracket, report.admission, {
    sourceBuildId: buildId, admissionPath: options.outputFile,
  }), []);
  assert.deepEqual(JSON.parse(readFileSync(options.outputFile, 'utf8')), report.admission);
  assert.deepEqual(JSON.parse(readFileSync(options.sourceBracketOutputFile, 'utf8')), report.sourceBracket);
});

test('source changes, verifier failure, sidecar swap and basename loss fail without output', () => {
  {
    const { options, dependencies } = fixture();
    let count = 0;
    dependencies.sourceBuildId = () => (++count === 1 ? buildId : '38924bd+ffffffffffff');
    assert.throws(() => createGateAUnityPayloadAdmission(options, dependencies), /source identity changed/u);
  }
  {
    const { options, dependencies } = fixture();
    dependencies.verify = () => { throw new Error('frozen verifier failure'); };
    assert.throws(() => createGateAUnityPayloadAdmission(options, dependencies), /frozen verifier failure/u);
  }
  {
    const { options, dependencies } = fixture();
    dependencies.verify = (value) => frozenAdmission({ ...value, expectedSidecarSha256: '9'.repeat(64) });
    assert.throws(() => createGateAUnityPayloadAdmission(options, dependencies), /sidecar SHA-256 differs/u);
  }
  {
    const { options, dependencies } = fixture();
    dependencies.verify = (value) => ({ ...frozenAdmission(value), apk: { ...frozenAdmission(value).apk, fileName: 'admitted.apk' } });
    assert.throws(() => createGateAUnityPayloadAdmission(options, dependencies), /basename/u);
  }
});

test('reduced boolean and a mismatched source-bracket full-object hash are rejected', () => {
  assert.ok(validateGateAUnityPayloadAdmission(true).length > 0);
  const { options, dependencies } = fixture();
  const report = createGateAUnityPayloadAdmission(options, dependencies);
  assert.match(validateGateAUnitySourceBracket({ ...report.sourceBracket, admissionSha256: '0'.repeat(64) }, report.admission).join('; '), /admission SHA-256/u);
});

test('production-shaped first-ball H7 replay binds artifact bytes and all full objects/files', () => {
  const root = resolve(mkdtempSync(join(tmpdir(), 'vande-gate-a-h7-bundle-')));
  const apkPath = join(root, 'sealed-artifact', 'vande-release.apk');
  const sidecarPath = join(root, 'vande-release-payload-binding.json');
  const admission = frozenAdmission({
    sidecarPath,
    apkPath,
    expectedSidecarSha256: sidecarSha,
    currentSourceBuildId: buildId,
  });
  const record = (path) => {
    const bytes = readFileSync(path);
    return { path, bytes: String(bytes.length), sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  const writePair = (name) => {
    const admissionFile = join(root, `${name}.json`);
    writeFileSync(admissionFile, JSON.stringify(admission));
    const sourceBracket = {
      schemaVersion: 1,
      kind: 'VANDE_GATE_A_UNITY_PAYLOAD_SOURCE_BRACKET',
      status: 'SOURCE_AND_FULL_VERIFIER_BRACKETED',
      sourceBuildIdBefore: buildId,
      sourceBuildIdAfter: buildId,
      admissionPath: admissionFile,
      admissionSha256: createHash('sha256').update(JSON.stringify(admission)).digest('hex'),
    };
    const sourceBracketFile = join(root, `${name}-source-bracket.json`);
    writeFileSync(sourceBracketFile, JSON.stringify(sourceBracket));
    return { admissionFile, sourceBracket, sourceBracketFile };
  };
  const initial = writePair('unity-payload-binding-admission');
  const preinstall = writePair('unity-payload-binding-preinstall-recheck');
  const final = writePair('unity-payload-binding-final-recheck');
  const expectedSidecar = { path: sidecarPath, sha256: sidecarSha };
  const deviceIdentity = {
    serial: 'emulator-5584', model: 'Pixel', release: '16', api: '36',
    buildFingerprint: 'vendor/device/build', securityPatch: '2026-10-05',
    androidBuildId: 'ABC123', socModel: 'Tensor', boardPlatform: 'tensor',
    hardwareEgl: 'angle', hardwareVulkan: 'vulkan', openGlEsVersion: '196610',
    graphicsDriver0: 'driver', graphicsDriver1: '', primaryAbi: 'arm64-v8a', supportedAbis: 'arm64-v8a',
    currentUser: '0', cores: '8',
    memKb: '8192000', gpuDriverObservation: 'GLES: ANGLE',
  };
  const installArtifact = {
    path: apkPath,
    bytes: '200',
    sha256: apkSha,
    identity: {
      dev: '1', ino: '2', mode: '33024', nlink: '1', uid: '1', gid: '1',
      size: '200', mtimeNs: '3', ctimeNs: '4',
    },
    parentIdentity: {
      dev: '1', ino: '5', mode: '16704', nlink: '2', uid: '1', gid: '1',
      size: '64', mtimeNs: '6', ctimeNs: '7',
    },
    privateReadOnlyCopy: true,
  };
  const artifactProjection = {
    path: installArtifact.path,
    sha256: installArtifact.sha256,
    identity: installArtifact.identity,
    parentIdentity: installArtifact.parentIdentity,
  };
  const firstBallArtifact = {
    path: installArtifact.path,
    sha256: installArtifact.sha256,
    bytes: installArtifact.identity.size,
    identity: installArtifact.identity,
    parentIdentity: installArtifact.parentIdentity,
  };
  const inventory = [{ path: '/data/app/base.apk', sha256: apkSha }];
  const inventoryReceipt = {
    schemaVersion: 1,
    status: 'EXACT_INSTALLED_PACKAGE_INVENTORY_CAPTURED',
    recordedUtc: '2026-10-29T03:00:00.500Z',
    serial: deviceIdentity.serial,
    packageId: 'in.vande.cricket',
    inventory,
    capture: {
      pmPath: { exitStatus: 0, stdout: 'package:/data/app/base.apk\n', stderr: '' },
      sha256: [{ exitStatus: 0, stdout: `${apkSha}  /data/app/base.apk\n`, stderr: '' }],
    },
  };
  const preinstallDeviceReceipt = createAndroidDeviceIdentityReceipt({
    identity: deviceIdentity,
    gpuRaw: 'GLES: ANGLE',
    capturedUtc: '2026-10-29T02:59:59.000Z',
  });
  const writeEvidence = (name, value = name) => {
    const path = join(root, name);
    writeFileSync(path, value);
    return record(path);
  };
  const sealedAdmissionReport = {
    schemaVersion: 1,
    status: 'SEALED_ARTIFACT_ADMITTED_FOR_ENGINEERING_EVIDENCE',
    limitation: 'This is static admission for a PREVIEW engineering artifact; it is not Play, SIZE-50, REACH-90, physical-device or human-player evidence.',
    recordedUtc: '2026-10-29T02:59:57.000Z',
    sourceBuildId: buildId,
    sourceArtifact: {
      path: join(root, 'source', 'vande-release.apk'),
      sha256: apkSha,
      identity: installArtifact.identity,
      stableAcrossCopy: true,
    },
    artifact: installArtifact,
    embeddedBuild: {
      expectedBuildId: buildId,
      discoveredBuildIds: [buildId],
      indexScripts: ['assets/public/assets/index.js'],
      chunks: [{
        entry: 'assets/public/assets/index.js', referencedByIndex: true,
        sha256: '4'.repeat(64), repositoryBuildIds: [buildId], containsExpectedBuildId: true,
      }, {
        entry: 'assets/public/assets/vendor.js', referencedByIndex: false,
        sha256: '6'.repeat(64), repositoryBuildIds: [], containsExpectedBuildId: false,
      }],
    },
    unityProof: { complete: true, completeAbis: ['arm64-v8a'], unityAppGuidPresent: true },
    unityPayloadProvenance: {
      status: 'UNPROVEN_PENDING_VERSIONED_APK_TO_EXPORT_MAP', mappingSchema: null, entries: [],
    },
    badging: {
      pass: true, packageId: 'in.vande.cricket', debuggable: false,
      launchable: ['in.vande.cricket.MainActivity'], errors: [],
    },
    signature: {
      tool: join(root, 'build-tools', 'apksigner'),
      report: [`Signer #1 certificate SHA-256 digest: ${admission.apk.signerCertificateSha256}`],
    },
    unityExportReceipt: {
      path: join(repo, 'unity/VandePractice/Builds/Android/.vande-export.properties'),
      sha256: admission.receipt.sha256,
      gradleStatus: 0, gradleOutputTail: ['BUILD SUCCESSFUL'],
    },
  };
  const sealedAdmissionRecord = writeEvidence(
    'sealed-artifact-admission.json',
    JSON.stringify(sealedAdmissionReport),
  );
  const preinstallStdout = writeEvidence('preinstall-pm-path.stdout.txt', '');
  const preinstallStderr = writeEvidence('preinstall-pm-path.stderr.txt', '');
  const preinstallStatus = writeEvidence('preinstall-pm-path-status.txt', '1\n');
  const packageAbsenceReport = {
    schemaVersion: 1,
    status: 'PACKAGE_ABSENCE_PROVEN',
    recordedUtc: '2026-10-29T02:59:59.000Z',
    classification: {
      absent: true,
      policy: 'ANDROID_PM_PATH_ABSENT_EXIT_1_EMPTY_STREAMS_V1',
      exitStatus: 1,
    },
    evidence: {
      status: preinstallStatus,
      stdout: preinstallStdout,
      stderr: preinstallStderr,
    },
  };
  const packageAbsenceRecord = writeEvidence('package-absence.json', JSON.stringify(packageAbsenceReport));
  const artifactCheckRecord = (name, recordedUtc, admissionRecord = sealedAdmissionRecord) => writeEvidence(
    name,
    JSON.stringify({
      schemaVersion: 1,
      status: 'SEALED_ARTIFACT_IDENTITY_RECHECKED',
      recordedUtc,
      admission: { path: admissionRecord.path, sha256: admissionRecord.sha256 },
      artifact: artifactProjection,
    }),
  );
  const preinstallArtifactCheck = artifactCheckRecord(
    'preinstall-artifact-check.json', '2026-10-29T02:59:59.500Z',
  );
  const installArtifactFinalCheck = artifactCheckRecord(
    'install-artifact-final-check.json', '2026-10-29T03:00:00.200Z',
  );
  const installArtifactPostCheck = artifactCheckRecord(
    'install-artifact-post-check.json', '2026-10-29T03:00:00.400Z',
  );
  const wrapper = {
    adbIsolation: writeEvidence('adb-isolation.txt', [
      'host=127.0.0.1',
      'port=5038',
      `serial=${deviceIdentity.serial}`,
      `inventory=${deviceIdentity.serial} device`,
      `pre-playwright-inventory=${deviceIdentity.serial} device`,
      '',
    ].join('\n')),
    admission: sealedAdmissionRecord,
    preinstallStdout,
    preinstallStderr,
    preinstallStatus,
    preinstallArtifactCheck,
    packageAbsence: packageAbsenceRecord,
    preinstallDeviceIdentity: writeEvidence('preinstall-device-identity.json', JSON.stringify(preinstallDeviceReceipt)),
    installArtifactFinalCheck,
    installArtifactPostCheck,
    postInstallPackageInventory: writeEvidence('post-install-package-inventory.json', JSON.stringify(inventoryReceipt)),
    installStatus: writeEvidence('install-status.txt', '0\n'),
    installStdout: writeEvidence('install.stdout.txt', 'Performing Streamed Install\nSuccess\n'),
    installStderr: writeEvidence('install.stderr.txt', ''),
    packageAbsentBeforeInstall: true,
    packageAbsencePolicy: 'ANDROID_PM_PATH_ABSENT_EXIT_1_EMPTY_STREAMS_V1',
    installOperation: 'adb -s <explicit serial> install -r <private immutable admitted APK>',
    runId: '12345678-1234-4123-8123-123456789abc',
    deviceIdentity,
    artifactIdentity: artifactProjection,
  };
  const start = {
    schemaVersion: 1,
    status: 'SEALED_INSTALL_STARTED',
    runId: wrapper.runId,
    startedUtc: '2026-10-29T03:00:00.000Z',
    startedHostMonotonicNs: '100',
    serial: deviceIdentity.serial,
    packageId: 'in.vande.cricket',
    buildId,
    artifact: installArtifact,
    deviceIdentity,
    deviceIdentitySha256: androidDeviceIdentitySha256(deviceIdentity),
    unityPayloadBindingAdmission: admission,
    unityPayloadBindingAdmissionSourceBracket: initial.sourceBracket,
    unityPayloadBindingPreinstallRecheck: admission,
    unityPayloadBindingPreinstallSourceBracket: preinstall.sourceBracket,
    unityPayloadBindingExpectedSidecar: expectedSidecar,
    evidence: {},
  };
  const completed = {
    schemaVersion: 2,
    status: 'SEALED_INSTALL_COMPLETED',
    runId: wrapper.runId,
    startedUtc: start.startedUtc,
    finishedUtc: '2026-10-29T03:00:01.000Z',
    startedHostMonotonicNs: start.startedHostMonotonicNs,
    finishedHostMonotonicNs: '200',
    serial: start.serial,
    packageId: start.packageId,
    buildId,
    artifact: installArtifact,
    postInstallArtifact: artifactProjection,
    installedPackageInventory: inventory,
    deviceIdentity,
    deviceIdentitySha256: start.deviceIdentitySha256,
    unityPayloadBindingAdmission: admission,
    unityPayloadBindingAdmissionSourceBracket: initial.sourceBracket,
    unityPayloadBindingPreinstallRecheck: admission,
    unityPayloadBindingPreinstallSourceBracket: preinstall.sourceBracket,
    unityPayloadBindingFinalRecheck: admission,
    unityPayloadBindingFinalSourceBracket: final.sourceBracket,
    unityPayloadBindingExpectedSidecar: expectedSidecar,
    operation: wrapper.installOperation,
    evidence: {},
  };
  const startFile = join(root, 'install-transaction-start.json');
  const completedFile = join(root, 'install-transaction.json');
  const payload = {
    expectedSidecar,
    admission,
    admissionSourceBracket: initial.sourceBracket,
    preinstallRecheck: admission,
    preinstallSourceBracket: preinstall.sourceBracket,
    finalRecheck: admission,
    finalSourceBracket: final.sourceBracket,
    admissionFile: wrapper.unityPayloadBindingAdmissionFile,
    admissionSourceBracketFile: wrapper.unityPayloadBindingAdmissionSourceBracketFile,
    preinstallRecheckFile: wrapper.unityPayloadBindingPreinstallRecheckFile,
    preinstallSourceBracketFile: wrapper.unityPayloadBindingPreinstallSourceBracketFile,
    finalRecheckFile: wrapper.unityPayloadBindingFinalRecheckFile,
    finalSourceBracketFile: wrapper.unityPayloadBindingFinalSourceBracketFile,
  };
  wrapper.unityPayloadBinding = payload;
  wrapper.installTransactionReceipt = completed;
  const receipt = {
    schemaVersion: 1,
    runId: wrapper.runId,
    serial: deviceIdentity.serial,
    packageId: start.packageId,
    buildId,
    artifact: firstBallArtifact,
    deviceIdentity,
    stateBefore: { deviceIdentity },
    stateAfter: { deviceIdentity },
    deadState: { deviceIdentity },
    stableBoundary: { deviceIdentity },
    installedPackageInventoryBefore: inventory,
    installedPackageInventoryAfter: inventory,
    unityPayloadBinding: payload,
    sealedWrapperEvidence: wrapper,
    installTransaction: completed,
  };
  const validate = () => validateGateAUnityEvidenceFromFirstBall({
    receipt,
    evidenceRoot: root,
    expectedBuildId: buildId,
    expectedApkSha256: apkSha,
  });
  const rewriteBundle = () => {
    const admissionHash = createHash('sha256').update(JSON.stringify(admission)).digest('hex');
    for (const pair of [initial, preinstall, final]) {
      pair.sourceBracket.admissionSha256 = admissionHash;
      writeFileSync(pair.admissionFile, JSON.stringify(admission));
      writeFileSync(pair.sourceBracketFile, JSON.stringify(pair.sourceBracket));
    }
    Object.assign(wrapper, {
      unityPayloadBindingAdmissionFile: record(initial.admissionFile),
      unityPayloadBindingAdmissionSourceBracketFile: record(initial.sourceBracketFile),
      unityPayloadBindingPreinstallRecheckFile: record(preinstall.admissionFile),
      unityPayloadBindingPreinstallSourceBracketFile: record(preinstall.sourceBracketFile),
      unityPayloadBindingFinalRecheckFile: record(final.admissionFile),
      unityPayloadBindingFinalSourceBracketFile: record(final.sourceBracketFile),
    });
    Object.assign(payload, {
      admissionFile: wrapper.unityPayloadBindingAdmissionFile,
      admissionSourceBracketFile: wrapper.unityPayloadBindingAdmissionSourceBracketFile,
      preinstallRecheckFile: wrapper.unityPayloadBindingPreinstallRecheckFile,
      preinstallSourceBracketFile: wrapper.unityPayloadBindingPreinstallSourceBracketFile,
      finalRecheckFile: wrapper.unityPayloadBindingFinalRecheckFile,
      finalSourceBracketFile: wrapper.unityPayloadBindingFinalSourceBracketFile,
    });
    Object.assign(start.evidence, {
      admission: wrapper.admission,
      artifactCheck: wrapper.preinstallArtifactCheck,
      absence: wrapper.packageAbsence,
      deviceIdentity: wrapper.preinstallDeviceIdentity,
      unityPayloadBindingAdmission: wrapper.unityPayloadBindingAdmissionFile,
      unityPayloadBindingAdmissionSourceBracket: wrapper.unityPayloadBindingAdmissionSourceBracketFile,
      unityPayloadBindingPreinstallRecheck: wrapper.unityPayloadBindingPreinstallRecheckFile,
      unityPayloadBindingPreinstallSourceBracket: wrapper.unityPayloadBindingPreinstallSourceBracketFile,
    });
    writeFileSync(startFile, JSON.stringify(start));
    wrapper.installTransactionStart = record(startFile);
    Object.assign(completed.evidence, {
      start: wrapper.installTransactionStart,
      immediateArtifactCheck: wrapper.installArtifactFinalCheck,
      postInstallArtifactCheck: wrapper.installArtifactPostCheck,
      installedPackageInventory: wrapper.postInstallPackageInventory,
      installStatus: wrapper.installStatus,
      installStdout: wrapper.installStdout,
      installStderr: wrapper.installStderr,
      unityPayloadBindingFinalRecheck: wrapper.unityPayloadBindingFinalRecheckFile,
      unityPayloadBindingFinalSourceBracket: wrapper.unityPayloadBindingFinalSourceBracketFile,
    });
    writeFileSync(completedFile, JSON.stringify(completed));
    wrapper.installTransaction = record(completedFile);
    wrapper.installTransactionReceipt = completed;
    receipt.installTransaction = completed;
  };
  rewriteBundle();
  assert.deepEqual(validate(), []);

  const adbIsolationPath = wrapper.adbIsolation.path;
  const validAdbIsolationLines = [
    'host=127.0.0.1',
    'port=5038',
    `serial=${deviceIdentity.serial}`,
    `inventory=${deviceIdentity.serial} device`,
    `pre-playwright-inventory=${deviceIdentity.serial} device`,
  ];
  const writeAdbIsolation = (lines, { terminalNewline = true, refreshRecord = true } = {}) => {
    writeFileSync(adbIsolationPath, `${lines.join('\n')}${terminalNewline ? '\n' : ''}`);
    if (refreshRecord) wrapper.adbIsolation = record(adbIsolationPath);
  };
  const originalAdbIsolation = wrapper.adbIsolation;
  delete wrapper.adbIsolation;
  assert.match(validate().join('; '), /sealed-wrapper evidence fields differ/u);
  wrapper.adbIsolation = originalAdbIsolation;

  writeAdbIsolation(validAdbIsolationLines, { refreshRecord: false });
  assert.deepEqual(validate(), []);
  writeAdbIsolation([...validAdbIsolationLines.slice(0, 1), 'port=5037', ...validAdbIsolationLines.slice(2)]);
  assert.match(validate().join('; '), /ADB isolation port is not a valid non-default dedicated port/u);
  writeAdbIsolation(['host=0.0.0.0', ...validAdbIsolationLines.slice(1)]);
  assert.match(validate().join('; '), /ADB isolation host is not exact loopback/u);
  writeAdbIsolation([
    ...validAdbIsolationLines.slice(0, 2),
    'serial=emulator-5556',
    ...validAdbIsolationLines.slice(3),
  ]);
  assert.match(validate().join('; '), /ADB isolation serial or exact-one-device inventories differ/u);
  writeAdbIsolation([
    ...validAdbIsolationLines.slice(0, 3),
    `inventory=${deviceIdentity.serial} device; emulator-5556 device`,
    validAdbIsolationLines[4],
  ]);
  assert.match(validate().join('; '), /ADB isolation serial or exact-one-device inventories differ/u);
  writeAdbIsolation(validAdbIsolationLines, { terminalNewline: false });
  assert.match(validate().join('; '), /exactly five newline-terminated fields/u);
  writeAdbIsolation([...validAdbIsolationLines, 'unexpected=record']);
  assert.match(validate().join('; '), /exactly five newline-terminated fields/u);
  writeAdbIsolation(validAdbIsolationLines);
  writeFileSync(adbIsolationPath, `${validAdbIsolationLines.join('\n')}\nchanged`);
  assert.match(validate().join('; '), /sealed-wrapper adbIsolation evidence bytes or SHA-256 changed/u);
  writeAdbIsolation(validAdbIsolationLines);
  assert.deepEqual(validate(), []);

  const preinstallDevicePath = wrapper.preinstallDeviceIdentity.path;
  writeFileSync(preinstallDevicePath, JSON.stringify({
    ...preinstallDeviceReceipt,
    identityPolicyId: 'vande-android-device-identity-v1',
  }));
  wrapper.preinstallDeviceIdentity = record(preinstallDevicePath);
  rewriteBundle();
  assert.match(validate().join('; '), /preinstall device identity receipt is invalid/u);
  writeFileSync(preinstallDevicePath, JSON.stringify(preinstallDeviceReceipt));
  wrapper.preinstallDeviceIdentity = record(preinstallDevicePath);
  rewriteBundle();
  assert.deepEqual(validate(), []);

  receipt.artifact = { ...firstBallArtifact, bytes: '201' };
  assert.match(validate().join('; '), /artifact does not exactly match/u);
  receipt.artifact = {
    ...firstBallArtifact,
    bytes: '201',
    identity: { ...firstBallArtifact.identity, size: '201' },
  };
  assert.match(validate().join('; '), /artifact does not exactly match/u);
  receipt.artifact = { ...firstBallArtifact, unexpected: true };
  assert.match(validate().join('; '), /first-ball artifact fields differ/u);
  const { bytes: omittedBytes, ...reducedFirstBallArtifact } = firstBallArtifact;
  assert.equal(omittedBytes, '200');
  receipt.artifact = reducedFirstBallArtifact;
  assert.match(validate().join('; '), /first-ball artifact fields differ|artifact does not exactly match/u);
  receipt.artifact = firstBallArtifact;
  assert.deepEqual(validate(), []);

  const setSealedAdmission = (report, value = report.artifact) => {
    const admissionPath = wrapper.admission.path;
    writeFileSync(admissionPath, JSON.stringify(report));
    wrapper.admission = record(admissionPath);
    const changedProjection = {
      path: value.path,
      sha256: value.sha256,
      identity: value.identity,
      parentIdentity: value.parentIdentity,
    };
    for (const [field, recordedUtc] of [
      ['preinstallArtifactCheck', '2026-10-29T02:59:59.500Z'],
      ['installArtifactFinalCheck', '2026-10-29T03:00:00.200Z'],
      ['installArtifactPostCheck', '2026-10-29T03:00:00.400Z'],
    ]) {
      const checkPath = wrapper[field].path;
      writeFileSync(checkPath, JSON.stringify({
        schemaVersion: 1,
        status: 'SEALED_ARTIFACT_IDENTITY_RECHECKED',
        recordedUtc,
        admission: { path: wrapper.admission.path, sha256: wrapper.admission.sha256 },
        artifact: changedProjection,
      }));
      wrapper[field] = record(checkPath);
    }
    start.artifact = value;
    completed.artifact = value;
    rewriteBundle();
  };
  const setSealedArtifact = (value) => setSealedAdmission({ ...sealedAdmissionReport, artifact: value }, value);
  setSealedArtifact({ ...installArtifact, privateReadOnlyCopy: false });
  assert.match(validate().join('; '), /does not exactly bind|does not exactly match/u);
  const { privateReadOnlyCopy: omittedPrivateCopy, ...reducedInstallArtifact } = installArtifact;
  assert.equal(omittedPrivateCopy, true);
  setSealedArtifact(reducedInstallArtifact);
  assert.match(validate().join('; '), /sealed (?:admission|install-start|install-completion) artifact fields differ/u);
  setSealedArtifact({ ...installArtifact, unexpected: true });
  assert.match(validate().join('; '), /sealed (?:admission|install-start|install-completion) artifact fields differ/u);
  setSealedArtifact(installArtifact);
  assert.deepEqual(validate(), []);

  const changedInventory = [{ path: '/data/app/alternate.apk', sha256: apkSha }];
  completed.installedPackageInventory = changedInventory;
  receipt.installedPackageInventoryBefore = changedInventory;
  receipt.installedPackageInventoryAfter = changedInventory;
  writeFileSync(completedFile, JSON.stringify(completed));
  wrapper.installTransaction = record(completedFile);
  wrapper.installTransactionReceipt = completed;
  receipt.installTransaction = completed;
  assert.match(validate().join('; '), /package inventory evidence differs/u);
  completed.installedPackageInventory = inventory;
  receipt.installedPackageInventoryBefore = inventory;
  receipt.installedPackageInventoryAfter = inventory;
  rewriteBundle();

  const substitutedDeviceIdentity = { ...deviceIdentity, model: 'Substituted device' };
  const substitutedDeviceSha256 = androidDeviceIdentitySha256(substitutedDeviceIdentity);
  start.deviceIdentity = substitutedDeviceIdentity;
  start.deviceIdentitySha256 = substitutedDeviceSha256;
  completed.deviceIdentity = substitutedDeviceIdentity;
  completed.deviceIdentitySha256 = substitutedDeviceSha256;
  receipt.deviceIdentity = substitutedDeviceIdentity;
  wrapper.deviceIdentity = substitutedDeviceIdentity;
  for (const state of [receipt.stateBefore, receipt.stateAfter, receipt.deadState, receipt.stableBoundary]) {
    state.deviceIdentity = substitutedDeviceIdentity;
  }
  rewriteBundle();
  assert.match(validate().join('; '), /preinstall device identity evidence differs/u);
  start.deviceIdentity = deviceIdentity;
  start.deviceIdentitySha256 = preinstallDeviceReceipt.identitySha256;
  completed.deviceIdentity = deviceIdentity;
  completed.deviceIdentitySha256 = preinstallDeviceReceipt.identitySha256;
  receipt.deviceIdentity = deviceIdentity;
  wrapper.deviceIdentity = deviceIdentity;
  for (const state of [receipt.stateBefore, receipt.stateAfter, receipt.deadState, receipt.stableBoundary]) {
    state.deviceIdentity = deviceIdentity;
  }
  rewriteBundle();
  assert.deepEqual(validate(), []);

  const substitutedCompletion = structuredClone(completed);
  substitutedCompletion.buildId = '38924bd+ffffffffffff';
  substitutedCompletion.serial = 'emulator-5590';
  substitutedCompletion.artifact.sha256 = '8'.repeat(64);
  substitutedCompletion.postInstallArtifact.sha256 = '8'.repeat(64);
  substitutedCompletion.installedPackageInventory[0].sha256 = '8'.repeat(64);
  writeFileSync(completedFile, JSON.stringify(substitutedCompletion));
  wrapper.installTransaction = record(completedFile);
  receipt.installTransaction = substitutedCompletion;
  assert.match(validate().join('; '), /parsed, first-ball and sealed-wrapper install transactions are not exactly equal/u);
  rewriteBundle();

  writeFileSync(startFile, JSON.stringify(completed));
  writeFileSync(completedFile, JSON.stringify(start));
  wrapper.installTransactionStart = record(startFile);
  wrapper.installTransaction = record(completedFile);
  assert.match(validate().join('; '), /schemas or statuses are invalid|fields differ/u);
  rewriteBundle();

  const reducedStart = structuredClone(start);
  delete reducedStart.packageId;
  writeFileSync(startFile, JSON.stringify(reducedStart));
  wrapper.installTransactionStart = record(startFile);
  const completionAfterReducedStart = structuredClone(completed);
  completionAfterReducedStart.evidence.start = wrapper.installTransactionStart;
  writeFileSync(completedFile, JSON.stringify(completionAfterReducedStart));
  wrapper.installTransaction = record(completedFile);
  wrapper.installTransactionReceipt = completionAfterReducedStart;
  receipt.installTransaction = completionAfterReducedStart;
  assert.match(validate().join('; '), /install-start receipt fields differ|package is invalid or differs/u);
  rewriteBundle();

  const reducedCompletion = structuredClone(completed);
  delete reducedCompletion.installedPackageInventory;
  writeFileSync(completedFile, JSON.stringify(reducedCompletion));
  wrapper.installTransaction = record(completedFile);
  wrapper.installTransactionReceipt = reducedCompletion;
  receipt.installTransaction = reducedCompletion;
  assert.match(validate().join('; '), /install-completion receipt fields differ|inventory does not exactly match/u);
  rewriteBundle();

  admission.sidecar.path = '/private/tmp/a/../vande-release-payload-binding.json';
  expectedSidecar.path = admission.sidecar.path;
  rewriteBundle();
  assert.match(validate().join('; '), /replay expectation is invalid/u);
  admission.sidecar.path = sidecarPath;
  expectedSidecar.path = sidecarPath;
  rewriteBundle();
  assert.deepEqual(validate(), []);

  admission.invocationId = 'not-a-canonical-invocation';
  rewriteBundle();
  assert.match(validate().join('; '), /invocation ID is invalid/u);
  admission.invocationId = '1'.repeat(32);
  for (const mutate of [
    () => { admission.sidecar.bytes = 0; },
    () => { admission.apk.bytes = 0; },
    () => { admission.receipt.sourceFileCount = 0; },
    () => { admission.receipt.exportFileCount = 0; },
  ]) {
    mutate();
    rewriteBundle();
    assert.match(validate().join('; '), /(?:byte count|receipt .* count) is invalid/u);
    admission.sidecar.bytes = 100;
    admission.apk.bytes = 200;
    admission.receipt.sourceFileCount = 1;
    admission.receipt.exportFileCount = 2;
  }
  rewriteBundle();
  assert.deepEqual(validate(), []);

  wrapper.unexpected = true;
  assert.match(validate().join('; '), /sealed-wrapper evidence fields differ/u);
  delete wrapper.unexpected;
  payload.unexpected = true;
  assert.match(validate().join('; '), /Unity payload binding fields differ/u);
  delete payload.unexpected;
  assert.deepEqual(validate(), []);

  const originalInstallStatusRecord = wrapper.installStatus;
  wrapper.installStatus = { ...originalInstallStatusRecord, unexpected: true };
  rewriteBundle();
  assert.match(validate().join('; '), /installStatus evidence record is invalid/u);
  wrapper.installStatus = {
    ...originalInstallStatusRecord,
    path: `${root}/nested/../install-status.txt`,
  };
  rewriteBundle();
  assert.match(validate().join('; '), /installStatus evidence record is invalid/u);
  wrapper.installStatus = originalInstallStatusRecord;
  rewriteBundle();
  assert.deepEqual(validate(), []);

  const renamedInstallStatus = writeEvidence('renamed-install-status.txt', '0\n');
  wrapper.installStatus = renamedInstallStatus;
  rewriteBundle();
  assert.match(validate().join('; '), /installStatus evidence must be root-level install-status\.txt/u);
  wrapper.installStatus = originalInstallStatusRecord;
  rewriteBundle();
  const originalInstallStderrRecord = wrapper.installStderr;
  wrapper.installStderr = wrapper.installStdout;
  rewriteBundle();
  assert.match(validate().join('; '), /records must have distinct paths/u);
  wrapper.installStderr = originalInstallStderrRecord;
  rewriteBundle();
  assert.deepEqual(validate(), []);

  const rewriteAbsenceStreams = (statusText, stdoutText, stderrText) => {
    writeFileSync(preinstallStatus.path, statusText);
    writeFileSync(preinstallStdout.path, stdoutText);
    writeFileSync(preinstallStderr.path, stderrText);
    wrapper.preinstallStatus = record(preinstallStatus.path);
    wrapper.preinstallStdout = record(preinstallStdout.path);
    wrapper.preinstallStderr = record(preinstallStderr.path);
    writeFileSync(packageAbsenceRecord.path, JSON.stringify({
      ...packageAbsenceReport,
      evidence: {
        status: wrapper.preinstallStatus,
        stdout: wrapper.preinstallStdout,
        stderr: wrapper.preinstallStderr,
      },
    }));
    wrapper.packageAbsence = record(packageAbsenceRecord.path);
    rewriteBundle();
  };
  for (const [statusText, stdoutText, stderrText] of [
    ['0\n', '', ''],
    ['1\n', 'package:/data/app/base.apk\n', ''],
    ['1\n', '', 'ambiguous error'],
  ]) {
    rewriteAbsenceStreams(statusText, stdoutText, stderrText);
    assert.match(validate().join('; '), /package-absence evidence is not the exact absent-package transaction/u);
  }
  rewriteAbsenceStreams('1\n', '', '');
  assert.deepEqual(validate(), []);

  const rewriteInstallStreams = (statusText, stdoutText, stderrText) => {
    writeFileSync(originalInstallStatusRecord.path, statusText);
    writeFileSync(wrapper.installStdout.path, stdoutText);
    writeFileSync(wrapper.installStderr.path, stderrText);
    wrapper.installStatus = record(originalInstallStatusRecord.path);
    wrapper.installStdout = record(wrapper.installStdout.path);
    wrapper.installStderr = record(wrapper.installStderr.path);
    rewriteBundle();
  };
  for (const [statusText, stdoutText, stderrText] of [
    ['0', 'Success\n', ''],
    ['0\n', 'Performing Streamed Install\n', ''],
    ['0\n', 'Successor\n', ''],
    ['0\n', 'Success\n', 'warning'],
  ]) {
    rewriteInstallStreams(statusText, stdoutText, stderrText);
    assert.match(validate().join('; '), /complete-Success-line/u);
  }
  rewriteInstallStreams('0\n', 'Performing Streamed Install\nSuccess\n', '');
  assert.deepEqual(validate(), []);

  setSealedAdmission({ ...sealedAdmissionReport, unexpected: true });
  assert.match(validate().join('; '), /sealed artifact admission fields differ/u);
  const reducedAdmission = structuredClone(sealedAdmissionReport);
  delete reducedAdmission.signature;
  setSealedAdmission(reducedAdmission);
  assert.match(validate().join('; '), /sealed artifact admission fields differ/u);
  setSealedAdmission({ ...sealedAdmissionReport, sourceBuildId: '38924bd+ffffffffffff' });
  assert.match(validate().join('; '), /sealed admission artifact does not exactly bind/u);
  for (const [label, mutate] of [
    ['claim limitation', (report) => { report.limitation = 'CERTIFIED'; }],
    ['source artifact stat identity', (report) => { report.sourceArtifact.identity.unexpected = 'x'; }],
    ['source artifact copied byte count', (report) => { report.sourceArtifact.identity.size = '201'; }],
    ['embedded build chunk hash', (report) => { report.embeddedBuild.chunks[0].sha256 = 'bad'; }],
    ['embedded build contains flag', (report) => { report.embeddedBuild.chunks[1].containsExpectedBuildId = true; }],
    ['embedded build conflicting ID', (report) => {
      report.embeddedBuild.chunks[1].repositoryBuildIds = ['38924bd+ffffffffffff'];
    }],
    ['embedded build duplicate index script', (report) => {
      report.embeddedBuild.indexScripts.push(report.embeddedBuild.indexScripts[0]);
    }],
    ['embedded build duplicate chunk entry', (report) => {
      report.embeddedBuild.chunks[1].entry = report.embeddedBuild.chunks[0].entry;
    }],
    ['Unity native proof', (report) => { report.unityProof.complete = false; }],
    ['Unity native proof duplicate ABI', (report) => { report.unityProof.completeAbis.push('arm64-v8a'); }],
    ['static provenance status', (report) => { report.unityPayloadProvenance.status = 'FORGED'; }],
    ['release badging', (report) => { report.badging.debuggable = true; }],
    ['signature report', (report) => { report.signature.report = []; }],
    ['signature report cap', (report) => { report.signature.report = Array(21).fill('line'); }],
    ['signature digest binding', (report) => {
      report.signature.report = [`Signer #1 certificate SHA-256 digest: ${'7'.repeat(64)}`];
    }],
    ['Unity export receipt', (report) => { report.unityExportReceipt.gradleStatus = 1; }],
    ['Unity export receipt output cap', (report) => {
      report.unityExportReceipt.gradleOutputTail = Array(41).fill('line');
    }],
    ['Unity export receipt hash binding', (report) => { report.unityExportReceipt.sha256 = '8'.repeat(64); }],
  ]) {
    const changedAdmission = structuredClone(sealedAdmissionReport);
    mutate(changedAdmission);
    setSealedAdmission(changedAdmission);
    assert.ok(validate().length > 0, `${label} substitution must be rejected`);
  }
  setSealedArtifact(installArtifact);
  assert.deepEqual(validate(), []);

  const mutateArtifactCheck = (field, mutate) => {
    const checkPath = wrapper[field].path;
    const check = JSON.parse(readFileSync(checkPath, 'utf8'));
    mutate(check);
    writeFileSync(checkPath, JSON.stringify(check));
    wrapper[field] = record(checkPath);
    rewriteBundle();
  };
  mutateArtifactCheck('preinstallArtifactCheck', (check) => { check.unexpected = true; });
  assert.match(validate().join('; '), /preinstall artifact check fields differ/u);
  setSealedArtifact(installArtifact);
  mutateArtifactCheck('installArtifactFinalCheck', (check) => { check.admission.sha256 = '8'.repeat(64); });
  assert.match(validate().join('; '), /final preinstall artifact check does not exactly bind/u);
  setSealedArtifact(installArtifact);
  const distinctFinalCheck = wrapper.installArtifactFinalCheck;
  wrapper.installArtifactFinalCheck = wrapper.preinstallArtifactCheck;
  rewriteBundle();
  assert.match(validate().join('; '), /artifact checks are not distinct/u);
  wrapper.installArtifactFinalCheck = distinctFinalCheck;
  rewriteBundle();
  assert.deepEqual(validate(), []);

  const inventoryPath = wrapper.postInstallPackageInventory.path;
  writeFileSync(inventoryPath, JSON.stringify({
    ...inventoryReceipt,
    recordedUtc: '2026-10-29T02:59:58.000Z',
  }));
  wrapper.postInstallPackageInventory = record(inventoryPath);
  rewriteBundle();
  assert.match(validate().join('; '), /post-install inventory UTC precedes/u);
  writeFileSync(inventoryPath, JSON.stringify(inventoryReceipt));
  wrapper.postInstallPackageInventory = record(inventoryPath);
  rewriteBundle();
  assert.deepEqual(validate(), []);

  receipt.artifact = {
    ...firstBallArtifact,
    identity: { ...firstBallArtifact.identity, unexpected: 'not canonical' },
  };
  assert.match(validate().join('; '), /first-ball artifact identity fields differ/u);
  receipt.artifact = firstBallArtifact;
  assert.deepEqual(validate(), []);

  writeFileSync(final.admissionFile, JSON.stringify({ ...admission, invocationId: 'swapped' }));
  wrapper.unityPayloadBindingFinalRecheckFile = record(final.admissionFile);
  payload.finalRecheckFile = wrapper.unityPayloadBindingFinalRecheckFile;
  assert.match(validate().join('; '), /evidence file differs from its embedded full object/u);
});

test('canonical installed-package inventory rejects identity and shape substitutions', () => {
  const path = '/data/app/~~token==/in.vande.cricket-token==/base.apk';
  const report = {
    schemaVersion: 1,
    status: 'EXACT_INSTALLED_PACKAGE_INVENTORY_CAPTURED',
    recordedUtc: '2026-10-29T03:00:00.000Z',
    serial: 'emulator-5584',
    packageId: 'in.vande.cricket',
    inventory: [{ path, sha256: apkSha }],
    capture: {
      pmPath: { exitStatus: 0, stdout: `package:${path}\n`, stderr: '' },
      sha256: [{ exitStatus: 0, stdout: `${apkSha}  ${path}\n`, stderr: '' }],
    },
  };
  const expected = {
    serial: report.serial,
    packageId: report.packageId,
    artifactSha256: apkSha,
  };
  assert.deepEqual(validateInstalledPackageInventoryReceipt(report, expected), []);
  for (const mutate of [
    (value) => { value.serial = 'emulator-5590'; },
    (value) => { value.packageId = 'in.vande.other'; },
    (value) => { value.inventory[0].sha256 = '8'.repeat(64); },
    (value) => { delete value.inventory[0].sha256; },
    (value) => { value.inventory[0].unexpected = true; },
    (value) => { value.unexpected = true; },
    (value) => { value.inventory.push(structuredClone(value.inventory[0])); },
    (value) => { value.recordedUtc = '2026-10-29 03:00:00'; },
    (value) => {
      value.inventory[0].path = '/data/app/../base.apk';
      value.capture.pmPath.stdout = 'package:/data/app/../base.apk\n';
      value.capture.sha256[0].stdout = `${apkSha}  /data/app/../base.apk\n`;
    },
  ]) {
    const changed = structuredClone(report);
    mutate(changed);
    assert.ok(validateInstalledPackageInventoryReceipt(changed, expected).length > 0);
  }
});
