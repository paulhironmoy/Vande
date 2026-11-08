#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {
  androidDeviceIdentitySha256,
  createAndroidDeviceIdentityReceipt,
} from '../../android-device-identity.mjs';
import {
  GATE_A_CAPTURE_THEN_TAP_CLASSIFICATION,
  GATE_A_CAPTURE_THEN_TAP_COORDINATE_RULE,
  GATE_A_CAPTURE_THEN_TAP_OPERATIONS,
  GATE_A_CAPTURE_THEN_TAP_STATUS,
  GATE_A_CAPTURE_THEN_TAP_SUCCESS_DERIVATION,
  GATE_A_CAPTURE_THEN_TAP_SUCCESS_MARKER,
  gateACaptureThenTapCommand,
  gateATapCoordinate,
  parseGateACaptureThenTapOutput,
} from '../../android-gate-a.mjs';
import { validateGateAUnityEvidenceFromFirstBall } from '../../android-gate-a-unity-admission.mjs';
import { LOCAL_PROVENANCE_LIMITATION } from '../../android-unity-payload-binding.mjs';
import { createGateAStillComparison } from './gate-a-still.mjs';

const BUILD_ID = '38924bd+0123456789ab';
const ADMISSION = 'engineering-preview-unqualified';
const DEVICE = Object.freeze({
  serial: 'emulator-5584', model: 'Pixel', release: '16', api: '36',
  buildFingerprint: 'vendor/device/build', securityPatch: '2026-10-05', androidBuildId: 'ABC123',
  socModel: 'Tensor', boardPlatform: 'tensor', hardwareEgl: 'angle', hardwareVulkan: 'vulkan',
  openGlEsVersion: '196610', graphicsDriver0: 'driver', graphicsDriver1: '',
  primaryAbi: 'arm64-v8a', supportedAbis: 'arm64-v8a', currentUser: '0',
  cores: '8', memKb: '8192000', gpuDriverObservation: 'GLES: ANGLE',
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function viewport(width, height) {
  return {
    schemaVersion: 1,
    cssPixels: { width, height },
    physicalPixels: { width, height },
    devicePixelRatio: 1,
    nativeRotationDegrees: 90,
    screenOrientation: { type: 'landscape-primary', angle: 90 },
    pageEpoch: 1,
  };
}

function liveState(width, height) {
  return {
    phase: 'live', screen: 'live', renderer: 'unity-native', buildId: BUILD_ID, admission: ADMISSION,
    utc: '2026-10-29T03:59:59.900Z', hostMonotonicNs: '900000000',
    deliveryId: 'session-1:delivery:1', deliveryEventType: 'unity.release',
    handedness: 'right', deviceIdentity: structuredClone(DEVICE),
    viewport: viewport(width, height),
    saved: {
      inningsId: 'innings-1', balls: 0, records: 0, overIndex: 0, ballIndex: 0,
      inFlight: { overIndex: 0, ballIndex: 0 }, lastSwingKind: null,
    },
  };
}

function deadState(width, height) {
  const value = liveState(width, height);
  value.phase = 'dead';
  value.deliveryEventType = 'unity.dead';
  value.utc = '2026-10-29T04:00:00.500Z';
  value.hostMonotonicNs = '1500000000';
  value.saved = {
    ...value.saved,
    balls: 1,
    records: 1,
    inFlight: null,
    lastSwingKind: 'defend',
  };
  return value;
}

function record(path) {
  const bytes = readFileSync(path);
  return { path, bytes: String(bytes.length), sha256: sha256(bytes) };
}

function h7Admission({ artifactPath, artifactSha256, artifactBytes, sidecarPath }) {
  return {
    schemaVersion: 1,
    kind: 'VANDE_UNITY_ANDROID_PAYLOAD_BINDING_ADMISSION',
    status: 'RE_DERIVED_LOCAL_INTEGRITY_NOT_CERTIFICATION',
    limitation: LOCAL_PROVENANCE_LIMITATION,
    invocationId: '1'.repeat(32),
    sourceBuildId: BUILD_ID,
    sidecar: { path: sidecarPath, bytes: 100, sha256: 'b'.repeat(64) },
    apk: {
      path: artifactPath,
      fileName: basename(artifactPath),
      bytes: artifactBytes.length,
      sha256: artifactSha256,
      signerCertificateSha256: 'c'.repeat(64),
    },
    receipt: {
      sha256: 'd'.repeat(64),
      sourceFileCount: 1,
      sourceTreeSha256: 'e'.repeat(64),
      exportFileCount: 2,
      exportTreeSha256: 'f'.repeat(64),
    },
    trees: {
      assetsSha256: '1'.repeat(64),
      nativeModuleSha256: '2'.repeat(64),
      nativeAppSha256: '3'.repeat(64),
    },
  };
}

async function fixture(t, {
  currentWidth = 640,
  currentHeight = 360,
  targetWidth = currentWidth,
  targetHeight = currentHeight,
} = {}) {
  const root = resolve(mkdtempSync(join(tmpdir(), 'vande-gate-a-still.')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const currentPath = join(root, 'live-frame.png');
  const targetPath = join(root, 'target.png');
  const receiptPath = join(root, 'first-playable-ball.json');
  const artifactPath = join(root, 'sealed-artifact', 'sealed.apk');
  mkdirSync(join(root, 'sealed-artifact'));
  const currentBytes = await sharp({
    create: { width: currentWidth, height: currentHeight, channels: 4, background: '#145a75' },
  }).png().toBuffer();
  const targetBytes = await sharp({
    create: { width: targetWidth, height: targetHeight, channels: 4, background: '#8d5f16' },
  }).png().toBuffer();
  const artifactBytes = Buffer.from('sealed-unity-apk-fixture');
  writeFileSync(currentPath, currentBytes);
  writeFileSync(targetPath, targetBytes);
  writeFileSync(artifactPath, artifactBytes);
  const artifactSha256 = sha256(artifactBytes);
  const installedPath = '/data/app/~~token==/in.vande.cricket-token==/base.apk';
  const installedInventory = [{ path: installedPath, sha256: artifactSha256 }];
  const artifactIdentity = {
    dev: '1', ino: '2', mode: '33024', nlink: '1', uid: '501', gid: '20',
    size: String(artifactBytes.length), mtimeNs: '3', ctimeNs: '4',
  };
  const parentIdentity = {
    dev: '1', ino: '3', mode: '16704', nlink: '2', uid: '501', gid: '20',
    size: '64', mtimeNs: '5', ctimeNs: '6',
  };
  const sealedArtifact = {
    path: artifactPath,
    bytes: String(artifactBytes.length),
    sha256: artifactSha256,
    identity: artifactIdentity,
    parentIdentity,
    privateReadOnlyCopy: true,
  };
  const artifactProjection = {
    path: artifactPath,
    sha256: artifactSha256,
    identity: artifactIdentity,
    parentIdentity,
  };
  const sidecarPath = join(root, 'vande-release-payload-binding.json');
  const admission = h7Admission({ artifactPath, artifactSha256, artifactBytes, sidecarPath });
  const writeH7Pair = (admissionName, bracketName) => {
    const admissionFile = join(root, admissionName);
    writeFileSync(admissionFile, JSON.stringify(admission));
    const sourceBracket = {
      schemaVersion: 1,
      kind: 'VANDE_GATE_A_UNITY_PAYLOAD_SOURCE_BRACKET',
      status: 'SOURCE_AND_FULL_VERIFIER_BRACKETED',
      sourceBuildIdBefore: BUILD_ID,
      sourceBuildIdAfter: BUILD_ID,
      admissionPath: admissionFile,
      admissionSha256: sha256(JSON.stringify(admission)),
    };
    const sourceBracketFile = join(root, bracketName);
    writeFileSync(sourceBracketFile, JSON.stringify(sourceBracket));
    return { admissionFile, sourceBracket, sourceBracketFile };
  };
  const initial = writeH7Pair(
    'unity-payload-binding-admission.json',
    'unity-payload-binding-admission-source-bracket.json',
  );
  const preinstall = writeH7Pair(
    'unity-payload-binding-preinstall-recheck.json',
    'unity-payload-binding-preinstall-recheck-source-bracket.json',
  );
  const final = writeH7Pair(
    'unity-payload-binding-final-recheck.json',
    'unity-payload-binding-final-recheck-source-bracket.json',
  );
  const expectedSidecar = { path: sidecarPath, sha256: admission.sidecar.sha256 };
  const writeEvidence = (name, value) => {
    const path = join(root, name);
    writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
    return record(path);
  };
  const sealedAdmission = {
    schemaVersion: 1,
    status: 'SEALED_ARTIFACT_ADMITTED_FOR_ENGINEERING_EVIDENCE',
    limitation: 'This is static admission for a PREVIEW engineering artifact; it is not Play, SIZE-50, REACH-90, physical-device or human-player evidence.',
    recordedUtc: '2026-10-29T02:59:57.000Z',
    sourceBuildId: BUILD_ID,
    sourceArtifact: {
      path: join(root, 'source', 'sealed.apk'),
      sha256: artifactSha256,
      identity: artifactIdentity,
      stableAcrossCopy: true,
    },
    artifact: sealedArtifact,
    embeddedBuild: {
      expectedBuildId: BUILD_ID,
      discoveredBuildIds: [BUILD_ID],
      indexScripts: ['assets/public/assets/index.js'],
      chunks: [{
        entry: 'assets/public/assets/index.js', referencedByIndex: true,
        sha256: '4'.repeat(64), repositoryBuildIds: [BUILD_ID], containsExpectedBuildId: true,
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
      path: resolve('unity/VandePractice/Builds/Android/.vande-export.properties'),
      sha256: admission.receipt.sha256,
      gradleStatus: 0,
      gradleOutputTail: ['BUILD SUCCESSFUL'],
    },
  };
  const adbIsolation = writeEvidence('adb-isolation.txt', [
    'host=127.0.0.1',
    'port=5038',
    `serial=${DEVICE.serial}`,
    `inventory=${DEVICE.serial} device`,
    `pre-playwright-inventory=${DEVICE.serial} device`,
    '',
  ].join('\n'));
  const admissionRecord = writeEvidence('sealed-artifact-admission.json', sealedAdmission);
  const preinstallStdout = writeEvidence('preinstall-pm-path.stdout.txt', '');
  const preinstallStderr = writeEvidence('preinstall-pm-path.stderr.txt', '');
  const preinstallStatus = writeEvidence('preinstall-pm-path-status.txt', '1\n');
  const packageAbsence = {
    schemaVersion: 1,
    status: 'PACKAGE_ABSENCE_PROVEN',
    recordedUtc: '2026-10-29T02:59:59.000Z',
    classification: {
      absent: true,
      policy: 'ANDROID_PM_PATH_ABSENT_EXIT_1_EMPTY_STREAMS_V1',
      exitStatus: 1,
    },
    evidence: { status: preinstallStatus, stdout: preinstallStdout, stderr: preinstallStderr },
  };
  const packageAbsenceRecord = writeEvidence('package-absence.json', packageAbsence);
  const deviceReceipt = createAndroidDeviceIdentityReceipt({
    identity: structuredClone(DEVICE),
    gpuRaw: 'GLES: ANGLE',
    capturedUtc: '2026-10-29T02:59:58.000Z',
  });
  const deviceRecord = writeEvidence('preinstall-device-identity.json', deviceReceipt);
  const artifactCheck = (name, recordedUtc) => writeEvidence(name, {
    schemaVersion: 1,
    status: 'SEALED_ARTIFACT_IDENTITY_RECHECKED',
    recordedUtc,
    admission: { path: admissionRecord.path, sha256: admissionRecord.sha256 },
    artifact: artifactProjection,
  });
  const preinstallArtifactCheck = artifactCheck(
    'preinstall-artifact-check.json', '2026-10-29T02:59:59.500Z',
  );
  const installArtifactFinalCheck = artifactCheck(
    'install-artifact-final-check.json', '2026-10-29T03:00:00.200Z',
  );
  const installArtifactPostCheck = artifactCheck(
    'install-artifact-post-check.json', '2026-10-29T03:00:00.400Z',
  );
  const inventoryReceipt = {
    schemaVersion: 1,
    status: 'EXACT_INSTALLED_PACKAGE_INVENTORY_CAPTURED',
    recordedUtc: '2026-10-29T03:00:00.500Z',
    serial: DEVICE.serial,
    packageId: 'in.vande.cricket',
    inventory: installedInventory,
    capture: {
      pmPath: { exitStatus: 0, stdout: `package:${installedPath}\n`, stderr: '' },
      sha256: [{ exitStatus: 0, stdout: `${artifactSha256}  ${installedPath}\n`, stderr: '' }],
    },
  };
  const inventoryRecord = writeEvidence('post-install-package-inventory.json', inventoryReceipt);
  const installStatus = writeEvidence('install-status.txt', '0\n');
  const installStdout = writeEvidence('install.stdout.txt', 'Performing Streamed Install\nSuccess\n');
  const installStderr = writeEvidence('install.stderr.txt', '');
  const h7Records = {
    unityPayloadBindingAdmissionFile: record(initial.admissionFile),
    unityPayloadBindingAdmissionSourceBracketFile: record(initial.sourceBracketFile),
    unityPayloadBindingPreinstallRecheckFile: record(preinstall.admissionFile),
    unityPayloadBindingPreinstallSourceBracketFile: record(preinstall.sourceBracketFile),
    unityPayloadBindingFinalRecheckFile: record(final.admissionFile),
    unityPayloadBindingFinalSourceBracketFile: record(final.sourceBracketFile),
  };
  const runId = '12345678-1234-4123-8123-123456789abc';
  const installStart = {
    schemaVersion: 1,
    status: 'SEALED_INSTALL_STARTED',
    runId,
    startedUtc: '2026-10-29T03:00:00.000Z',
    startedHostMonotonicNs: '100',
    serial: DEVICE.serial,
    packageId: 'in.vande.cricket',
    buildId: BUILD_ID,
    artifact: sealedArtifact,
    deviceIdentity: structuredClone(DEVICE),
    deviceIdentitySha256: deviceReceipt.identitySha256,
    unityPayloadBindingAdmission: admission,
    unityPayloadBindingAdmissionSourceBracket: initial.sourceBracket,
    unityPayloadBindingPreinstallRecheck: admission,
    unityPayloadBindingPreinstallSourceBracket: preinstall.sourceBracket,
    unityPayloadBindingExpectedSidecar: expectedSidecar,
    evidence: {
      admission: admissionRecord,
      artifactCheck: preinstallArtifactCheck,
      absence: packageAbsenceRecord,
      deviceIdentity: deviceRecord,
      unityPayloadBindingAdmission: h7Records.unityPayloadBindingAdmissionFile,
      unityPayloadBindingAdmissionSourceBracket: h7Records.unityPayloadBindingAdmissionSourceBracketFile,
      unityPayloadBindingPreinstallRecheck: h7Records.unityPayloadBindingPreinstallRecheckFile,
      unityPayloadBindingPreinstallSourceBracket: h7Records.unityPayloadBindingPreinstallSourceBracketFile,
    },
  };
  const installStartFile = join(root, 'install-transaction-start.json');
  writeFileSync(installStartFile, JSON.stringify(installStart));
  const installStartRecord = record(installStartFile);
  const installCompleted = {
    schemaVersion: 2,
    status: 'SEALED_INSTALL_COMPLETED',
    runId,
    startedUtc: installStart.startedUtc,
    finishedUtc: '2026-10-29T03:00:01.000Z',
    startedHostMonotonicNs: installStart.startedHostMonotonicNs,
    finishedHostMonotonicNs: '200',
    serial: DEVICE.serial,
    packageId: 'in.vande.cricket',
    buildId: BUILD_ID,
    artifact: sealedArtifact,
    postInstallArtifact: artifactProjection,
    installedPackageInventory: installedInventory,
    deviceIdentity: structuredClone(DEVICE),
    deviceIdentitySha256: deviceReceipt.identitySha256,
    unityPayloadBindingAdmission: admission,
    unityPayloadBindingAdmissionSourceBracket: initial.sourceBracket,
    unityPayloadBindingPreinstallRecheck: admission,
    unityPayloadBindingPreinstallSourceBracket: preinstall.sourceBracket,
    unityPayloadBindingFinalRecheck: admission,
    unityPayloadBindingFinalSourceBracket: final.sourceBracket,
    unityPayloadBindingExpectedSidecar: expectedSidecar,
    operation: 'adb -s <explicit serial> install -r <private immutable admitted APK>',
    evidence: {
      start: installStartRecord,
      immediateArtifactCheck: installArtifactFinalCheck,
      postInstallArtifactCheck: installArtifactPostCheck,
      installedPackageInventory: inventoryRecord,
      installStatus,
      installStdout,
      installStderr,
      unityPayloadBindingFinalRecheck: h7Records.unityPayloadBindingFinalRecheckFile,
      unityPayloadBindingFinalSourceBracket: h7Records.unityPayloadBindingFinalSourceBracketFile,
    },
  };
  const installCompletedFile = join(root, 'install-transaction.json');
  writeFileSync(installCompletedFile, JSON.stringify(installCompleted));
  const installCompletedRecord = record(installCompletedFile);
  const unityPayloadBinding = {
    expectedSidecar,
    admission,
    admissionSourceBracket: initial.sourceBracket,
    preinstallRecheck: admission,
    preinstallSourceBracket: preinstall.sourceBracket,
    finalRecheck: admission,
    finalSourceBracket: final.sourceBracket,
    admissionFile: h7Records.unityPayloadBindingAdmissionFile,
    admissionSourceBracketFile: h7Records.unityPayloadBindingAdmissionSourceBracketFile,
    preinstallRecheckFile: h7Records.unityPayloadBindingPreinstallRecheckFile,
    preinstallSourceBracketFile: h7Records.unityPayloadBindingPreinstallSourceBracketFile,
    finalRecheckFile: h7Records.unityPayloadBindingFinalRecheckFile,
    finalSourceBracketFile: h7Records.unityPayloadBindingFinalSourceBracketFile,
  };
  const before = liveState(currentWidth, currentHeight);
  const after = {
    ...structuredClone(before),
    utc: '2026-10-29T04:00:00.250Z',
    hostMonotonicNs: '1250000000',
  };
  const dead = deadState(currentWidth, currentHeight);
  const liveFrame = {
    path: 'live-frame.png',
    bytes: String(currentBytes.length),
    sha256: sha256(currentBytes),
    png: { width: currentWidth, height: currentHeight },
  };
  const remotePath = `/data/local/tmp/vande-gate-a-${runId}/live-frame.png`;
  const rawCaptureOutput = [
    'device-uptime-after-tap=100.12 200.12',
    `bytes=${liveFrame.bytes}`,
    `${liveFrame.sha256}  ${remotePath}`,
    'transaction-status=0',
    GATE_A_CAPTURE_THEN_TAP_SUCCESS_MARKER,
  ].join('\n');
  const parsedCaptureOutput = parseGateACaptureThenTapOutput(rawCaptureOutput, remotePath);
  assert.ok(parsedCaptureOutput);
  const receipt = {
    schemaVersion: 2,
    runId,
    packageId: 'in.vande.cricket',
    classification: 'LOCAL_ENGINEERING_ONLY',
    harnessFinalStatus: 'ACCEPTED',
    buildId: BUILD_ID,
    renderer: 'unity-native',
    admission: ADMISSION,
    handedness: 'right',
    viewport: viewport(currentWidth, currentHeight),
    serial: DEVICE.serial,
    user: DEVICE.currentUser,
    adbServer: { host: '127.0.0.1', port: 5038 },
    deviceIdentity: structuredClone(DEVICE),
    crashOrAnrLines: [],
    webErrorCount: 0,
    nativeErrorCount: 0,
    hooksPresent: false,
    gameplayTapCount: 1,
    lifecycleOrPerformanceModeUsed: false,
    secondBallStarted: false,
    outOfBandAppDataOperations: [],
    stateBefore: before,
    stateAfter: after,
    deadState: dead,
    stableBoundary: structuredClone(dead),
    artifact: {
      path: artifactPath,
      sha256: artifactSha256,
      bytes: String(artifactBytes.length),
      identity: artifactIdentity,
      parentIdentity,
    },
    installedPackageInventoryBefore: structuredClone(installedInventory),
    installedPackageInventoryAfter: structuredClone(installedInventory),
    installTransaction: installCompleted,
    unityPayloadBinding,
    sealedWrapperEvidence: {
      adbIsolation,
      admission: admissionRecord,
      ...h7Records,
      preinstallStdout,
      preinstallStderr,
      preinstallStatus,
      packageAbsence: packageAbsenceRecord,
      preinstallDeviceIdentity: deviceRecord,
      preinstallArtifactCheck,
      installArtifactFinalCheck,
      installArtifactPostCheck,
      postInstallPackageInventory: inventoryRecord,
      installTransactionStart: installStartRecord,
      installStdout,
      installStderr,
      installStatus,
      installTransaction: installCompletedRecord,
      packageAbsentBeforeInstall: true,
      packageAbsencePolicy: 'ANDROID_PM_PATH_ABSENT_EXIT_1_EMPTY_STREAMS_V1',
      installOperation: 'adb -s <explicit serial> install -r <private immutable admitted APK>',
      runId,
      installTransactionReceipt: structuredClone(installCompleted),
      deviceIdentity: structuredClone(DEVICE),
      artifactIdentity: artifactProjection,
      unityPayloadBinding: structuredClone(unityPayloadBinding),
    },
    captureThenTap: {
      schemaVersion: 2,
      status: GATE_A_CAPTURE_THEN_TAP_STATUS,
      classification: GATE_A_CAPTURE_THEN_TAP_CLASSIFICATION,
      runId,
      serial: DEVICE.serial,
      adbEndpoint: { host: '127.0.0.1', port: 5038 },
      buildId: BUILD_ID,
      deliveryId: before.deliveryId,
      viewport: structuredClone(before.viewport),
      tapCoordinatePhysicalPixels: gateATapCoordinate(before.viewport),
      coordinateRule: GATE_A_CAPTURE_THEN_TAP_COORDINATE_RULE,
      operationOrder: [...GATE_A_CAPTURE_THEN_TAP_OPERATIONS],
      remoteShellCommand: gateACaptureThenTapCommand({
        remotePath,
        coordinate: gateATapCoordinate(before.viewport),
      }),
      remoteShellTransactionCount: 1,
      gameplayTapCount: 1,
      startedUtc: '2026-10-29T04:00:00.000Z',
      finishedUtc: '2026-10-29T04:00:00.125Z',
      startedHostMonotonicNs: '1000000000',
      finishedHostMonotonicNs: '1125000000',
      successMarker: GATE_A_CAPTURE_THEN_TAP_SUCCESS_MARKER,
      successMarkerObservedCount: 1,
      successDerivation: GATE_A_CAPTURE_THEN_TAP_SUCCESS_DERIVATION,
      adbShellResult: {
        exitStatus: 0,
        stderrBytes: '0',
        stderrSha256: sha256(Buffer.alloc(0)),
      },
      transactionOutput: parsedCaptureOutput.transactionOutput,
      deviceUptimeAfterTap: parsedCaptureOutput.deviceUptimeAfterTap,
      remoteCapture: {
        ...parsedCaptureOutput.remoteCapture,
        png: { width: currentWidth, height: currentHeight },
      },
      nativeListenerRegistration: { epoch: 1, ok: true, reason: 'message_and_error_listeners_attached' },
      nativeEventDropCounts: { events: 0, registrations: 0 },
      nativeDeliveryEvents: [
        { epoch: 1, operationId: 'operation-1', type: 'unity.release', sequence: 10, deliveryId: before.deliveryId },
        { epoch: 1, operationId: 'operation-1', type: 'unity.pointer', sequence: 11, deliveryId: before.deliveryId },
        { epoch: 1, operationId: 'operation-1', type: 'unity.gesture', sequence: 12, deliveryId: before.deliveryId },
        { epoch: 1, operationId: 'operation-1', type: 'unity.dead', sequence: 13, deliveryId: before.deliveryId },
      ],
      liveFrame,
    },
    liveFrame,
  };
  const rewriteWrapperRecord = (field, value) => {
    const path = receipt.sealedWrapperEvidence[field].path;
    writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
    receipt.sealedWrapperEvidence[field] = record(path);
  };
  const syncArtifactChecks = () => {
    for (const [field, recordedUtc] of [
      ['preinstallArtifactCheck', '2026-10-29T02:59:59.500Z'],
      ['installArtifactFinalCheck', '2026-10-29T03:00:00.200Z'],
      ['installArtifactPostCheck', '2026-10-29T03:00:00.400Z'],
    ]) rewriteWrapperRecord(field, {
      schemaVersion: 1,
      status: 'SEALED_ARTIFACT_IDENTITY_RECHECKED',
      recordedUtc,
      admission: {
        path: receipt.sealedWrapperEvidence.admission.path,
        sha256: receipt.sealedWrapperEvidence.admission.sha256,
      },
      artifact: artifactProjection,
    });
  };
  const syncTransactions = () => {
    const wrapper = receipt.sealedWrapperEvidence;
    Object.assign(installStart.evidence, {
      admission: wrapper.admission,
      artifactCheck: wrapper.preinstallArtifactCheck,
      absence: wrapper.packageAbsence,
      deviceIdentity: wrapper.preinstallDeviceIdentity,
      unityPayloadBindingAdmission: wrapper.unityPayloadBindingAdmissionFile,
      unityPayloadBindingAdmissionSourceBracket: wrapper.unityPayloadBindingAdmissionSourceBracketFile,
      unityPayloadBindingPreinstallRecheck: wrapper.unityPayloadBindingPreinstallRecheckFile,
      unityPayloadBindingPreinstallSourceBracket: wrapper.unityPayloadBindingPreinstallSourceBracketFile,
    });
    writeFileSync(installStartFile, JSON.stringify(installStart));
    wrapper.installTransactionStart = record(installStartFile);
    Object.assign(installCompleted.evidence, {
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
    writeFileSync(installCompletedFile, JSON.stringify(installCompleted));
    wrapper.installTransaction = record(installCompletedFile);
    wrapper.installTransactionReceipt = structuredClone(installCompleted);
    receipt.installTransaction = structuredClone(installCompleted);
  };
  writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
  return {
    root,
    currentPath,
    targetPath,
    receiptPath,
    targetSha256: sha256(targetBytes),
    receipt,
    h7: {
      admission,
      initial,
      preinstall,
      final,
      installStart,
      installCompleted,
      installStartFile,
      installCompletedFile,
    },
    evidence: {
      admissionRecord,
      packageAbsenceRecord,
      deviceRecord,
      preinstallArtifactCheck,
      installArtifactFinalCheck,
      installArtifactPostCheck,
      inventoryRecord,
      installStatus,
      installStdout,
      installStderr,
    },
    reports: { sealedAdmission, packageAbsence, deviceReceipt, inventoryReceipt },
    rewriteWrapperRecord,
    syncArtifactChecks,
    syncTransactions,
  };
}

function args(value, outputName = 'out') {
  return {
    currentImage: value.currentPath,
    currentEvidence: value.receiptPath,
    targetImage: value.targetPath,
    expectedTargetSha256: value.targetSha256,
    expectedBuildId: BUILD_ID,
    outputDir: join(value.root, outputName),
    panelWidth: 320,
    panelHeight: 180,
    recordedUtc: '2026-10-29T00:00:00.000Z',
  };
}

function saveReceipt(value) {
  writeFileSync(value.receiptPath, `${JSON.stringify(value.receipt)}\n`);
}

function setResolvedStateAfter(value, phase) {
  value.receipt.stateAfter = structuredClone(value.receipt.deadState);
  value.receipt.stateAfter.phase = phase;
  value.receipt.stateAfter.utc = '2026-10-29T04:00:00.250Z';
  value.receipt.stateAfter.hostMonotonicNs = '1250000000';
}

function synchronizeCaptureViewport(receipt) {
  const physicalPixels = structuredClone(receipt.viewport.physicalPixels);
  receipt.captureThenTap.viewport = structuredClone(receipt.viewport);
  receipt.captureThenTap.tapCoordinatePhysicalPixels = gateATapCoordinate(receipt.viewport);
  receipt.captureThenTap.remoteShellCommand = gateACaptureThenTapCommand({
    remotePath: receipt.captureThenTap.remoteCapture.path,
    coordinate: receipt.captureThenTap.tapCoordinatePhysicalPixels,
  });
  receipt.liveFrame.png = structuredClone(physicalPixels);
  receipt.captureThenTap.liveFrame = structuredClone(receipt.liveFrame);
  receipt.captureThenTap.remoteCapture.png = structuredClone(physicalPixels);
}

function rebindCaptureFrame(receipt, bytes, claimedBytes = String(bytes.length)) {
  const frame = {
    path: 'live-frame.png',
    bytes: claimedBytes,
    sha256: sha256(bytes),
    png: structuredClone(receipt.viewport.physicalPixels),
  };
  const remotePath = receipt.captureThenTap.remoteCapture.path;
  const rawOutput = [
    `device-uptime-after-tap=${receipt.captureThenTap.deviceUptimeAfterTap}`,
    `bytes=${frame.bytes}`,
    `${frame.sha256}  ${remotePath}`,
    'transaction-status=0',
    GATE_A_CAPTURE_THEN_TAP_SUCCESS_MARKER,
  ].join('\n');
  const parsed = parseGateACaptureThenTapOutput(rawOutput, remotePath);
  assert.ok(parsed);
  receipt.liveFrame = frame;
  receipt.captureThenTap.liveFrame = structuredClone(frame);
  receipt.captureThenTap.remoteCapture = {
    ...parsed.remoteCapture,
    png: structuredClone(frame.png),
  };
  receipt.captureThenTap.transactionOutput = parsed.transactionOutput;
}

async function rejectsWithoutOutput(value, pattern, patch = {}) {
  const options = { ...args(value, 'rejected'), ...patch };
  await assert.rejects(createGateAStillComparison(options), pattern);
  assert.equal(existsSync(options.outputDir), false);
}

test('creates a ready comparison only for exact viewport and attested matching handedness', async (t) => {
  const value = await fixture(t);
  assert.deepEqual(validateGateAUnityEvidenceFromFirstBall({
    receipt: value.receipt,
    evidenceRoot: value.root,
    expectedBuildId: BUILD_ID,
    expectedApkSha256: value.receipt.artifact.sha256,
  }), []);
  const outputDir = join(value.root, 'out');
  const manifest = await createGateAStillComparison({ ...args(value), outputDir });
  assert.equal(manifest.status, 'DIRECTIONAL_COMPARISON_READY_NOT_GATE_PASS');
  assert.equal(manifest.comparability.status, 'COMPARABLE');
  assert.equal(manifest.comparability.viewport.status, 'EXACT_MATCH');
  assert.equal(manifest.comparability.handedness.status, 'EXACT_MATCH');
  assert.equal(manifest.current.renderer, 'unity-native');
  assert.equal(manifest.current.admission, ADMISSION);
  assert.equal(manifest.current.unityPayloadBinding.status, 'FULL_H7_RECEIPT_REPLAY_ACCEPTED');
  assert.deepEqual(manifest.comparability.viewport.attestedCurrent, { width: 640, height: 360 });
  assert.deepEqual(manifest.comparability.viewport.logicalCurrent, { width: 640, height: 360 });
  assert.deepEqual(manifest.comparability.viewport.devicePixelRatio, {
    current: 1, target: 1, status: 'EXACT_MATCH',
  });
  assert.equal(manifest.target.classification, 'STATIC_GOLDEN_DIRECTION_NOT_RUNTIME');
  assert.deepEqual(manifest.outputs.native.panel, { width: 640, height: 360 });
  assert.deepEqual(manifest.outputs.normalized.panel, { width: 320, height: 180 });
  for (const output of Object.values(manifest.outputs)) {
    assert.equal(sha256(readFileSync(join(outputDir, output.path))), output.sha256);
  }
  assert.deepEqual(JSON.parse(readFileSync(join(outputDir, 'manifest.json'), 'utf8')), manifest);
});

test('accepts only the two harness-valid playing forms and preserves live/dead acceptance', async (t) => {
  await t.test('unchanged in-flight playing observation', async (child) => {
    const value = await fixture(child);
    value.receipt.stateAfter.phase = 'playing';
    value.receipt.stateAfter.deliveryEventType = 'unity.gesture';
    saveReceipt(value);
    const manifest = await createGateAStillComparison(args(value));
    assert.equal(manifest.status, 'DIRECTIONAL_COMPARISON_READY_NOT_GATE_PASS');
  });

  await t.test('exact authoritative resolved playing observation', async (child) => {
    const value = await fixture(child);
    setResolvedStateAfter(value, 'playing');
    saveReceipt(value);
    const manifest = await createGateAStillComparison(args(value));
    assert.equal(manifest.status, 'DIRECTIONAL_COMPARISON_READY_NOT_GATE_PASS');
  });

  await t.test('dead post-observation remains accepted', async (child) => {
    const value = await fixture(child);
    setResolvedStateAfter(value, 'dead');
    saveReceipt(value);
    const manifest = await createGateAStillComparison(args(value));
    assert.equal(manifest.status, 'DIRECTIONAL_COMPARISON_READY_NOT_GATE_PASS');
  });
});

test('active 844x390 DPR1 right-hand target accepts both legitimate playing forms', async (t) => {
  for (const [name, configure] of [
    ['unchanged in-flight', (value) => {
      value.receipt.stateAfter.phase = 'playing';
      value.receipt.stateAfter.deliveryEventType = 'unity.gesture';
    }],
    ['resolved saved state with interim gesture', (value) => {
      setResolvedStateAfter(value, 'playing');
      value.receipt.stateAfter.deliveryEventType = 'unity.gesture';
    }],
  ]) {
    await t.test(name, async (child) => {
      const value = await fixture(child, {
        currentWidth: 844,
        currentHeight: 390,
        targetWidth: 844,
        targetHeight: 390,
      });
      configure(value);
      saveReceipt(value);
      const manifest = await createGateAStillComparison(args(value));
      assert.equal(manifest.status, 'DIRECTIONAL_COMPARISON_READY_NOT_GATE_PASS');
      assert.equal(manifest.comparability.status, 'COMPARABLE');
      assert.deepEqual(manifest.comparability.viewport.current, { width: 844, height: 390 });
      assert.deepEqual(manifest.comparability.viewport.logicalCurrent, { width: 844, height: 390 });
      assert.deepEqual(manifest.comparability.viewport.devicePixelRatio, {
        current: 1, target: 1, status: 'EXACT_MATCH',
      });
      assert.deepEqual(manifest.comparability.handedness, {
        status: 'EXACT_MATCH',
        current: 'right',
        target: 'right',
        basis: 'authoritative current first-playable receipt versus documented static golden direction',
      });
    });
  }
});

test('rejects invalid saved, identity, delivery, or final-event mutations around resolved playing state', async (t) => {
  await t.test('partially resolved saved state', async (child) => {
    const value = await fixture(child);
    value.receipt.stateAfter.phase = 'playing';
    value.receipt.stateAfter.deliveryEventType = 'unity.gesture';
    value.receipt.stateAfter.saved = {
      ...value.receipt.stateAfter.saved,
      balls: 1,
      records: 0,
      inFlight: null,
      lastSwingKind: 'defend',
    };
    saveReceipt(value);
    await rejectsWithoutOutput(value, /playing post-observation.*neither unchanged in-flight state nor the exact authoritative resolved/u);
  });

  await t.test('resolved state contradicts authoritative dead state', async (child) => {
    const value = await fixture(child);
    setResolvedStateAfter(value, 'playing');
    value.receipt.stateAfter.saved.lastSwingKind = 'attack';
    saveReceipt(value);
    await rejectsWithoutOutput(value, /playing post-observation.*neither unchanged in-flight state nor the exact authoritative resolved/u);
  });

  await t.test('resolved state has no accepted gameplay swing', async (child) => {
    const value = await fixture(child);
    setResolvedStateAfter(value, 'playing');
    value.receipt.stateAfter.saved.lastSwingKind = null;
    value.receipt.deadState.saved.lastSwingKind = null;
    value.receipt.stableBoundary.saved.lastSwingKind = null;
    saveReceipt(value);
    await rejectsWithoutOutput(value, /accepted gameplay swing kind/u);
  });

  await t.test('resolved state delivery differs', async (child) => {
    const value = await fixture(child);
    setResolvedStateAfter(value, 'playing');
    value.receipt.stateAfter.deliveryEventType = 'unity.gesture';
    value.receipt.stateAfter.deliveryId = 'session-2:delivery:1';
    saveReceipt(value);
    await rejectsWithoutOutput(value, /delivery ID does not bind|delivery identity differs|native delivery identity changed/u);
  });

  await t.test('resolved state device identity differs', async (child) => {
    const value = await fixture(child);
    setResolvedStateAfter(value, 'playing');
    value.receipt.stateAfter.deliveryEventType = 'unity.gesture';
    value.receipt.stateAfter.deviceIdentity.model = 'Other';
    saveReceipt(value);
    await rejectsWithoutOutput(value, /device identity/u);
  });

  await t.test('later native dead event is missing', async (child) => {
    const value = await fixture(child);
    setResolvedStateAfter(value, 'playing');
    value.receipt.stateAfter.deliveryEventType = 'unity.gesture';
    value.receipt.captureThenTap.nativeDeliveryEvents.pop();
    saveReceipt(value);
    await rejectsWithoutOutput(value, /exactly release, pointer, gesture then dead/u);
  });

  await t.test('later native dead event is out of order', async (child) => {
    const value = await fixture(child);
    setResolvedStateAfter(value, 'playing');
    value.receipt.stateAfter.deliveryEventType = 'unity.gesture';
    const events = value.receipt.captureThenTap.nativeDeliveryEvents;
    [events[2], events[3]] = [events[3], events[2]];
    saveReceipt(value);
    await rejectsWithoutOutput(value, /out of release-pointer-gesture-dead order/u);
  });
});

test('rejects fail-open receipt states before writing output', async (t) => {
  const cases = [
    ['rejected harness', (receipt) => { receipt.harnessFinalStatus = 'REJECTED'; }, /final status is not ACCEPTED/u],
    ['missing top admission', (receipt) => { delete receipt.admission; }, /admission is not exact/u],
    ['missing state admission', (receipt) => { delete receipt.stateAfter.admission; }, /admission/u],
    ['arbitrary admission', (receipt) => {
      receipt.admission = 'accepted';
      for (const state of [receipt.stateBefore, receipt.stateAfter, receipt.deadState, receipt.stableBoundary]) state.admission = 'accepted';
    }, /admission is not exact/u],
    ['missing saved state', (receipt) => { delete receipt.stateBefore.saved; }, /saved state|saved delivery/u],
    ['missing capture-then-tap receipt', (receipt) => { delete receipt.captureThenTap; }, /capture-then-tap receipt/u],
    ['capture tap coordinate mismatch', (receipt) => {
      receipt.captureThenTap.tapCoordinatePhysicalPixels.x += 1;
    }, /capture-then-tap.*coordinate/u],
    ['duplicate native pointer evidence', (receipt) => {
      receipt.captureThenTap.nativeDeliveryEvents.splice(1, 0, structuredClone(receipt.captureThenTap.nativeDeliveryEvents[1]));
    }, /capture-then-tap.*exactly release, pointer, gesture then dead/u],
    ['arbitrary delivery', (receipt) => {
      for (const state of [receipt.stateBefore, receipt.stateAfter, receipt.deadState, receipt.stableBoundary]) {
        state.deliveryId = 'arbitrary:delivery:8';
      }
    }, /exact first Unity delivery/u],
    ['device mismatch', (receipt) => { receipt.deadState.deviceIdentity.model = 'Other'; }, /device identity/u],
    ['invalid artifact hash', (receipt) => { receipt.artifact.sha256 = 'not-a-sha'; }, /artifact identity is invalid/u],
    ['dead/stable mismatch', (receipt) => { receipt.stableBoundary.saved.lastSwingKind = 'attack'; }, /dead and stable first-ball state differ/u],
    ['crash evidence', (receipt) => { receipt.crashOrAnrLines.push('FATAL EXCEPTION'); }, /crash\/ANR evidence/u],
    ['web error', (receipt) => { receipt.webErrorCount = 1; }, /WebView error count/u],
    ['native error', (receipt) => { receipt.nativeErrorCount = 1; }, /native Unity error count/u],
  ];
  for (const [name, mutate, pattern] of cases) {
    await t.test(name, async (child) => {
      const value = await fixture(child);
      mutate(value.receipt);
      saveReceipt(value);
      await rejectsWithoutOutput(value, pattern);
    });
  }
});

test('rejects a 1x1 image, renderer/bracket/hash mismatch, and bad target before output', async (t) => {
  await t.test('receipt byte length differs from the actual current PNG', async (child) => {
    const value = await fixture(child);
    const bytes = readFileSync(value.currentPath);
    rebindCaptureFrame(value.receipt, bytes, String(bytes.length + 1));
    saveReceipt(value);
    await rejectsWithoutOutput(value, /byte length differs/u);
  });
  await t.test('1x1 current image', async (child) => {
    const value = await fixture(child);
    const bytes = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#000' } }).png().toBuffer();
    writeFileSync(value.currentPath, bytes);
    value.receipt.viewport.physicalPixels = { width: 1, height: 1 };
    for (const state of [
      value.receipt.stateBefore,
      value.receipt.stateAfter,
      value.receipt.deadState,
      value.receipt.stableBoundary,
    ]) state.viewport = structuredClone(value.receipt.viewport);
    synchronizeCaptureViewport(value.receipt);
    rebindCaptureFrame(value.receipt, bytes);
    saveReceipt(value);
    await rejectsWithoutOutput(value, /dimensions 1x1/u);
  });
  for (const [name, mutate, patch, pattern] of [
    ['renderer', (receipt) => {
      receipt.renderer = 'three-webgl';
      for (const state of [receipt.stateBefore, receipt.stateAfter, receipt.deadState, receipt.stableBoundary]) state.renderer = 'three-webgl';
    }, {}, /not unity-native/u],
    ['bracket', (receipt) => { receipt.stateAfter.deliveryId = 'session-2:delivery:1'; }, {}, /changed|differs/u],
    ['current hash', (receipt) => { receipt.liveFrame.sha256 = 'c'.repeat(64); }, {}, /live-frame SHA-256 differs/u],
    ['target hash', () => {}, { expectedTargetSha256: 'd'.repeat(64) }, /target SHA-256 differs/u],
  ]) {
    await t.test(name, async (child) => {
      const value = await fixture(child);
      mutate(value.receipt);
      saveReceipt(value);
      await rejectsWithoutOutput(value, pattern, patch);
    });
  }
});

test('viewport mismatch emits explicit NOT_COMPARABLE and never READY', async (t) => {
  const value = await fixture(t, { currentWidth: 640, currentHeight: 360, targetWidth: 800, targetHeight: 450 });
  const manifest = await createGateAStillComparison(args(value));
  assert.equal(manifest.status, 'DIRECTIONAL_COMPARISON_NOT_COMPARABLE_NOT_GATE_PASS');
  assert.equal(manifest.comparability.status, 'NOT_COMPARABLE');
  assert.equal(manifest.comparability.viewport.status, 'MISMATCH');
  assert.deepEqual(manifest.comparability.reasons, [
    'EXACT_VIEWPORT_MISMATCH',
    'EXACT_LOGICAL_VIEWPORT_MISMATCH',
  ]);
});

test('logical viewport and DPR mismatch are explicitly NOT_COMPARABLE', async (t) => {
  for (const [name, mutate, expectedReasons] of [
    ['logical CSS viewport', (viewportValue) => { viewportValue.cssPixels.width -= 1; }, [
      'EXACT_LOGICAL_VIEWPORT_MISMATCH',
    ]],
    ['device pixel ratio', (viewportValue) => { viewportValue.devicePixelRatio = 2; }, [
      'DEVICE_PIXEL_RATIO_MISMATCH',
    ]],
  ]) {
    await t.test(name, async (child) => {
      const value = await fixture(child);
      mutate(value.receipt.viewport);
      for (const state of [
        value.receipt.stateBefore,
        value.receipt.stateAfter,
        value.receipt.deadState,
        value.receipt.stableBoundary,
      ]) state.viewport = structuredClone(value.receipt.viewport);
      synchronizeCaptureViewport(value.receipt);
      saveReceipt(value);
      const manifest = await createGateAStillComparison(args(value));
      assert.equal(manifest.status, 'DIRECTIONAL_COMPARISON_NOT_COMPARABLE_NOT_GATE_PASS');
      assert.equal(manifest.comparability.viewport.status, 'MISMATCH');
      assert.deepEqual(manifest.comparability.reasons, expectedReasons);
    });
  }
});

test('missing or contradictory authoritative viewport/native geometry rejects', async (t) => {
  for (const [name, mutate, pattern] of [
    ['missing top viewport', (receipt) => { delete receipt.viewport; }, /viewport/u],
    ['missing state viewport', (receipt) => { delete receipt.stateAfter.viewport; }, /viewport/u],
    ['top/state viewport mismatch', (receipt) => { receipt.viewport.physicalPixels.width += 1; }, /viewport differs/u],
    ['image/native geometry mismatch', (receipt) => {
      receipt.viewport.physicalPixels.width = 800;
      for (const state of [receipt.stateBefore, receipt.stateAfter, receipt.deadState, receipt.stableBoundary]) {
        state.viewport.physicalPixels.width = 800;
      }
      synchronizeCaptureViewport(receipt);
    }, /image dimensions differ from authoritative native geometry/u],
  ]) {
    await t.test(name, async (child) => {
      const value = await fixture(child);
      mutate(value.receipt);
      saveReceipt(value);
      await rejectsWithoutOutput(value, pattern);
    });
  }
});

test('matching authoritative hand is mandatory; target mismatch is explicitly NOT_COMPARABLE', async (t) => {
  await t.test('mismatch', async (child) => {
    const value = await fixture(child);
    value.receipt.handedness = 'left';
    for (const state of [value.receipt.stateBefore, value.receipt.stateAfter, value.receipt.deadState, value.receipt.stableBoundary]) {
      state.handedness = 'left';
    }
    saveReceipt(value);
    const manifest = await createGateAStillComparison(args(value));
    assert.equal(manifest.status, 'DIRECTIONAL_COMPARISON_NOT_COMPARABLE_NOT_GATE_PASS');
    assert.equal(manifest.comparability.handedness.status, 'MISMATCH');
    assert.deepEqual(manifest.comparability.reasons, ['HANDEDNESS_MISMATCH']);
  });
  await t.test('missing authoritative hand rejects', async (child) => {
    const value = await fixture(child);
    delete value.receipt.handedness;
    for (const state of [value.receipt.stateBefore, value.receipt.stateAfter, value.receipt.deadState, value.receipt.stableBoundary]) {
      delete state.handedness;
    }
    saveReceipt(value);
    await rejectsWithoutOutput(value, /handedness/u);
  });
  await t.test('contradictory state attestation rejects', async (child) => {
    const value = await fixture(child);
    value.receipt.stateAfter.handedness = 'left';
    saveReceipt(value);
    await rejectsWithoutOutput(value, /handedness differs/u);
  });
});

test('full H7 replay rejects changed, swapped, reduced, or divergent evidence', async (t) => {
  await t.test('changed H7 file bytes', async (child) => {
    const value = await fixture(child);
    writeFileSync(value.h7.final.admissionFile, JSON.stringify({ ...value.h7.admission, invocationId: 'changed' }));
    await rejectsWithoutOutput(value, /H7 Unity payload replay.*bytes or SHA-256 changed/u);
  });
  await t.test('swapped H7 file with a freshly matching file record', async (child) => {
    const value = await fixture(child);
    writeFileSync(value.h7.final.admissionFile, JSON.stringify({ ...value.h7.admission, invocationId: 'swapped' }));
    const swapped = record(value.h7.final.admissionFile);
    value.receipt.sealedWrapperEvidence.unityPayloadBindingFinalRecheckFile = swapped;
    value.receipt.unityPayloadBinding.finalRecheckFile = swapped;
    value.receipt.sealedWrapperEvidence.unityPayloadBinding.finalRecheckFile = swapped;
    saveReceipt(value);
    await rejectsWithoutOutput(value, /H7 Unity payload replay.*file differs from its embedded full object/u);
  });
  await t.test('reduced embedded H7 object', async (child) => {
    const value = await fixture(child);
    value.receipt.unityPayloadBinding.finalRecheck = true;
    value.receipt.sealedWrapperEvidence.unityPayloadBinding.finalRecheck = true;
    saveReceipt(value);
    await rejectsWithoutOutput(value, /H7 Unity payload replay.*frozen verifier admission is not an object/u);
  });
  await t.test('changed embedded H7 object with unchanged file', async (child) => {
    const value = await fixture(child);
    value.receipt.unityPayloadBinding.finalRecheck = {
      ...value.receipt.unityPayloadBinding.finalRecheck,
      invocationId: 'different-invocation',
    };
    value.receipt.sealedWrapperEvidence.unityPayloadBinding.finalRecheck = structuredClone(
      value.receipt.unityPayloadBinding.finalRecheck,
    );
    saveReceipt(value);
    await rejectsWithoutOutput(value, /H7 Unity payload replay.*differs/u);
  });
  await t.test('changed source bracket object', async (child) => {
    const value = await fixture(child);
    value.receipt.unityPayloadBinding.preinstallSourceBracket = {
      ...value.receipt.unityPayloadBinding.preinstallSourceBracket,
      admissionSha256: '0'.repeat(64),
    };
    value.receipt.sealedWrapperEvidence.unityPayloadBinding.preinstallSourceBracket = structuredClone(
      value.receipt.unityPayloadBinding.preinstallSourceBracket,
    );
    saveReceipt(value);
    await rejectsWithoutOutput(value, /H7 Unity payload replay.*source bracket rejected/u);
  });
});

test('full production replay rejects coherent substitutions across every evidence class', async (t) => {
  await t.test('sealed admission nested proof plus all dependent record hashes', async (child) => {
    const value = await fixture(child);
    const changed = structuredClone(value.reports.sealedAdmission);
    changed.limitation = 'CERTIFIED';
    value.rewriteWrapperRecord('admission', changed);
    value.syncArtifactChecks();
    value.syncTransactions();
    saveReceipt(value);
    await rejectsWithoutOutput(value, /sealed admission artifact does not exactly bind/u);
  });

  await t.test('package-absence stream, receipt, start, and completion records', async (child) => {
    const value = await fixture(child);
    value.rewriteWrapperRecord('preinstallStatus', '0\n');
    const changed = structuredClone(value.reports.packageAbsence);
    changed.evidence.status = value.receipt.sealedWrapperEvidence.preinstallStatus;
    value.rewriteWrapperRecord('packageAbsence', changed);
    value.syncTransactions();
    saveReceipt(value);
    await rejectsWithoutOutput(value, /exact absent-package transaction/u);
  });

  await t.test('install stdout, completion evidence, and completion record', async (child) => {
    const value = await fixture(child);
    value.rewriteWrapperRecord('installStdout', 'Performing Streamed Install\n');
    value.syncTransactions();
    saveReceipt(value);
    await rejectsWithoutOutput(value, /complete-Success-line/u);
  });

  await t.test('inventory objects coherently diverge from captured inventory file', async (child) => {
    const value = await fixture(child);
    const changed = [{
      path: '/data/app/~~other==/in.vande.cricket-other==/base.apk',
      sha256: value.receipt.artifact.sha256,
    }];
    value.h7.installCompleted.installedPackageInventory = changed;
    value.receipt.installedPackageInventoryBefore = structuredClone(changed);
    value.receipt.installedPackageInventoryAfter = structuredClone(changed);
    value.syncTransactions();
    saveReceipt(value);
    await rejectsWithoutOutput(value, /package inventory evidence differs/u);
  });

  await t.test('device objects coherently diverge from captured device file', async (child) => {
    const value = await fixture(child);
    const changed = { ...DEVICE, model: 'Substituted Pixel' };
    const changedSha256 = androidDeviceIdentitySha256(changed);
    value.h7.installStart.deviceIdentity = structuredClone(changed);
    value.h7.installStart.deviceIdentitySha256 = changedSha256;
    value.h7.installCompleted.deviceIdentity = structuredClone(changed);
    value.h7.installCompleted.deviceIdentitySha256 = changedSha256;
    value.receipt.deviceIdentity = structuredClone(changed);
    value.receipt.sealedWrapperEvidence.deviceIdentity = structuredClone(changed);
    for (const state of [
      value.receipt.stateBefore,
      value.receipt.stateAfter,
      value.receipt.deadState,
      value.receipt.stableBoundary,
    ]) state.deviceIdentity = structuredClone(changed);
    value.syncTransactions();
    saveReceipt(value);
    await rejectsWithoutOutput(value, /preinstall device identity evidence differs/u);
  });

  await t.test('artifact check and install records diverge from admitted artifact', async (child) => {
    const value = await fixture(child);
    const path = value.receipt.sealedWrapperEvidence.installArtifactFinalCheck.path;
    const changed = JSON.parse(readFileSync(path, 'utf8'));
    changed.artifact.sha256 = '8'.repeat(64);
    value.rewriteWrapperRecord('installArtifactFinalCheck', changed);
    value.syncTransactions();
    saveReceipt(value);
    await rejectsWithoutOutput(value, /final preinstall artifact check does not exactly bind/u);
  });

  await t.test('reduced start receipt propagated through completion', async (child) => {
    const value = await fixture(child);
    delete value.h7.installStart.packageId;
    value.syncTransactions();
    saveReceipt(value);
    await rejectsWithoutOutput(value, /install-start receipt fields differ|package is invalid or differs/u);
  });

  await t.test('duplicate root record propagated into completion evidence', async (child) => {
    const value = await fixture(child);
    value.receipt.sealedWrapperEvidence.installStderr = structuredClone(
      value.receipt.sealedWrapperEvidence.installStdout,
    );
    value.syncTransactions();
    saveReceipt(value);
    await rejectsWithoutOutput(value, /records must have distinct paths|root-level install\.stderr\.txt/u);
  });

  await t.test('wrapper record reduction or expansion cannot be propagated', async (child) => {
    const value = await fixture(child);
    value.receipt.sealedWrapperEvidence.installStatus = {
      ...value.receipt.sealedWrapperEvidence.installStatus,
      unexpected: true,
    };
    value.syncTransactions();
    saveReceipt(value);
    await rejectsWithoutOutput(value, /installStatus evidence record is invalid/u);
  });

  await t.test('first-ball artifact shape cannot diverge from sealed 6/4-key projections', async (child) => {
    const value = await fixture(child);
    value.receipt.artifact.unexpected = true;
    saveReceipt(value);
    await rejectsWithoutOutput(value, /first-ball artifact fields differ/u);
  });

  await t.test('completion substitution cannot be propagated past the immutable start', async (child) => {
    const value = await fixture(child);
    value.h7.installCompleted.buildId = '38924bd+ffffffffffff';
    value.syncTransactions();
    saveReceipt(value);
    await rejectsWithoutOutput(value, /install start\/completion buildId binding differs|install build identity differs/u);
  });

  await t.test('inventory receipt UTC inversion with refreshed hashes', async (child) => {
    const value = await fixture(child);
    const changed = structuredClone(value.reports.inventoryReceipt);
    changed.recordedUtc = '2026-10-29T03:00:00.100Z';
    value.rewriteWrapperRecord('postInstallPackageInventory', changed);
    value.syncTransactions();
    saveReceipt(value);
    await rejectsWithoutOutput(value, /post-install inventory UTC precedes/u);
  });
});

test('never overwrites an existing comparison directory', async (t) => {
  const value = await fixture(t);
  const options = args(value);
  await createGateAStillComparison(options);
  await assert.rejects(createGateAStillComparison(options), /already exists/u);
});
