#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import {
  androidDeviceIdentitySha256,
  createAndroidDeviceIdentityReceipt,
} from './android-device-identity.mjs';
import {
  finishInstallTransaction,
  startInstallTransaction,
  writePackageAbsenceReceipt,
} from './android-gate-a-receipt.mjs';
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
} from './android-gate-a.mjs';
import {
  GATE_A_EPOCH_LIMITATION,
  GATE_A_MEASUREMENT_LIMITATION,
  gateAStateBindingSha256,
} from './android-package-data-epoch.mjs';
import { measureInstalledSize, validateFirstBallEvidence } from './android-installed-size.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const repo = resolve('.');
const buildId = execFileSync(join(repo, 'scripts/build-id.sh'), [], { encoding: 'utf8' }).trim();
const artifactSha = 'a'.repeat(64);
const identity = {
  serial: 'emulator-5584', model: 'Pixel', release: '16', api: '36', buildFingerprint: 'vendor/device/build',
  securityPatch: '2026-10-05', androidBuildId: 'ABC123', socModel: 'Tensor', boardPlatform: 'tensor',
  hardwareEgl: 'angle', hardwareVulkan: 'vulkan', openGlEsVersion: '196610', graphicsDriver0: 'driver',
  graphicsDriver1: '', primaryAbi: 'arm64-v8a', supportedAbis: 'arm64-v8a', currentUser: '0',
  cores: '8', memKb: '8192000', gpuDriverObservation: 'GLES: ANGLE',
};
const primaryStats = 'code: 43753472 bytes\ndata: 12259328 bytes\ncache: 815104 bytes\n';

const PNG_CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([typeBytes, data])) {
    crc = PNG_CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
  return chunk;
}

function pngFixture(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('sRGB', Buffer.from([0])),
    pngChunk('sBIT', Buffer.from([8, 8, 8, 8])),
    pngChunk('IDAT', deflateSync(Buffer.alloc((width * 4 + 1) * height))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function palettePngWithoutPlte(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 3;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('sRGB', Buffer.from([0])),
    pngChunk('sBIT', Buffer.from([8, 8, 8])),
    pngChunk('IDAT', deflateSync(Buffer.alloc((width + 1) * height))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunkOffset(bytes, wanted) {
  let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.subarray(offset + 4, offset + 8).toString('ascii') === wanted) return offset;
    offset += 12 + length;
  }
  throw new Error(`PNG fixture has no ${wanted} chunk`);
}

function rewritePngChunkCrc(bytes, offset) {
  const length = bytes.readUInt32BE(offset);
  let crc = 0xffffffff;
  for (let index = offset + 4; index < offset + 8 + length; index += 1) {
    crc = PNG_CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, offset + 8 + length);
}

function corruptPngIdatWithValidCrc(value) {
  const bytes = Buffer.from(value);
  let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.subarray(offset + 4, offset + 8).toString('ascii') === 'IDAT') {
      bytes[offset + 8] ^= 0xff;
      rewritePngChunkCrc(bytes, offset);
      return bytes;
    }
    offset += 12 + length;
  }
  throw new Error('PNG fixture has no IDAT chunk');
}

function rebindLiveFrameEvidence(evidence, bytes, claimedBytes = String(bytes.length)) {
  const frame = {
    path: 'live-frame.png',
    bytes: claimedBytes,
    sha256: hash(bytes),
    png: structuredClone(evidence.viewport.physicalPixels),
  };
  const capture = evidence.captureThenTap;
  const remotePath = capture.remoteCapture.path;
  const rawOutput = [
    `device-uptime-after-tap=${capture.deviceUptimeAfterTap}`,
    `bytes=${claimedBytes}`,
    `${frame.sha256}  ${remotePath}`,
    'transaction-status=0',
    GATE_A_CAPTURE_THEN_TAP_SUCCESS_MARKER,
  ].join('\n');
  const parsed = parseGateACaptureThenTapOutput(rawOutput, remotePath);
  assert.ok(parsed);
  evidence.liveFrame = frame;
  capture.liveFrame = structuredClone(frame);
  capture.remoteCapture = { ...parsed.remoteCapture, png: structuredClone(frame.png) };
  capture.transactionOutput = parsed.transactionOutput;
  capture.deviceUptimeAfterTap = parsed.deviceUptimeAfterTap;
}

function record(path) {
  const bytes = readFileSync(path);
  return { path, sha256: hash(bytes), bytes: String(bytes.length) };
}

function fixture() {
  const root = resolve(mkdtempSync(join(tmpdir(), 'vande-first-ball-binding-')));
  const write = (name, value) => {
    const path = join(root, name);
    writeFileSync(path, value);
    return path;
  };
  const pmStatus = write('preinstall-pm-path-status.txt', '1\n');
  const pmStdout = write('preinstall-pm-path.stdout.txt', '');
  const pmStderr = write('preinstall-pm-path.stderr.txt', '');
  const adbIsolationFile = write('adb-isolation.txt', [
    'host=127.0.0.1',
    'port=5038',
    `serial=${identity.serial}`,
    `inventory=${identity.serial} device`,
    `pre-playwright-inventory=${identity.serial} device`,
    '',
  ].join('\n'));
  const absenceFile = join(root, 'package-absence.json');
  writePackageAbsenceReceipt({ statusFile: pmStatus, stdoutFile: pmStdout, stderrFile: pmStderr, outputFile: absenceFile });
  const absenceReceipt = JSON.parse(readFileSync(absenceFile, 'utf8'));
  const absenceUtcMs = Date.parse(absenceReceipt.recordedUtc);
  const artifact = {
    path: join(root, 'sealed-artifact', 'vande-release.apk'), sha256: artifactSha,
    identity: { dev: '1', ino: '2', mode: '33024', nlink: '1', uid: '1', gid: '1', size: '10', mtimeNs: '3', ctimeNs: '4' },
    parentIdentity: { dev: '1', ino: '5', mode: '16704', nlink: '2', uid: '1', gid: '1', size: '64', mtimeNs: '6', ctimeNs: '7' },
  };
  const sealedArtifact = {
    path: artifact.path,
    bytes: artifact.identity.size,
    sha256: artifact.sha256,
    identity: artifact.identity,
    parentIdentity: artifact.parentIdentity,
    privateReadOnlyCopy: true,
  };
  const firstBallArtifact = {
    path: artifact.path,
    sha256: artifact.sha256,
    bytes: artifact.identity.size,
    identity: artifact.identity,
    parentIdentity: artifact.parentIdentity,
  };
  const admissionFile = write('sealed-artifact-admission.json', JSON.stringify({
    schemaVersion: 1,
    status: 'SEALED_ARTIFACT_ADMITTED_FOR_ENGINEERING_EVIDENCE',
    limitation: 'This is static admission for a PREVIEW engineering artifact; it is not Play, SIZE-50, REACH-90, physical-device or human-player evidence.',
    recordedUtc: new Date(absenceUtcMs - 2_000).toISOString(),
    sourceBuildId: buildId,
    sourceArtifact: {
      path: join(root, 'source', 'vande-release.apk'),
      sha256: artifactSha,
      identity: artifact.identity,
      stableAcrossCopy: true,
    },
    artifact: sealedArtifact,
    embeddedBuild: {
      expectedBuildId: buildId,
      discoveredBuildIds: [buildId],
      indexScripts: ['assets/public/assets/index.js'],
      chunks: [{
        entry: 'assets/public/assets/index.js', referencedByIndex: true,
        sha256: '4'.repeat(64), repositoryBuildIds: [buildId], containsExpectedBuildId: true,
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
      report: [`Signer #1 certificate SHA-256 digest: ${'8'.repeat(64)}`],
    },
    unityExportReceipt: {
      path: join(repo, 'unity/VandePractice/Builds/Android/.vande-export.properties'),
      sha256: '7'.repeat(64),
      gradleStatus: 0, gradleOutputTail: ['BUILD SUCCESSFUL'],
    },
  }));
  const admissionRecord = record(admissionFile);
  const artifactCheck = (recordedUtc) => ({
    schemaVersion: 1,
    status: 'SEALED_ARTIFACT_IDENTITY_RECHECKED',
    recordedUtc,
    admission: { path: admissionRecord.path, sha256: admissionRecord.sha256 },
    artifact,
  });
  const precheckFile = write(
    'preinstall-artifact-check.json',
    JSON.stringify(artifactCheck(absenceReceipt.recordedUtc)),
  );
  const finalCheckFile = join(root, 'install-artifact-final-check.json');
  const postCheckFile = join(root, 'install-artifact-post-check.json');
  const inventory = [{ path: '/data/app/base.apk', sha256: artifactSha }];
  const inventoryFile = join(root, 'post-install-package-inventory.json');
  const deviceFile = write('preinstall-device-identity.json', JSON.stringify(createAndroidDeviceIdentityReceipt({
    identity,
    gpuRaw: 'GLES: ANGLE',
    capturedUtc: new Date(absenceUtcMs - 1_000).toISOString(),
  })));
  const makeUnityProof = (name) => {
    const admission = {
      schemaVersion: 1,
      kind: 'VANDE_UNITY_ANDROID_PAYLOAD_BINDING_ADMISSION',
      status: 'RE_DERIVED_LOCAL_INTEGRITY_NOT_CERTIFICATION',
      limitation: 'Local build-time provenance only; not Play, installed-size, reach, physical-device, runtime, human-player, or malicious-builder-resistant evidence.',
      invocationId: '1'.repeat(32),
      sourceBuildId: buildId,
      sidecar: { path: join(root, 'vande-release-payload-binding.json'), bytes: 100, sha256: '9'.repeat(64) },
      apk: { path: artifact.path, fileName: 'vande-release.apk', bytes: 10, sha256: artifactSha, signerCertificateSha256: '8'.repeat(64) },
      receipt: { sha256: '7'.repeat(64), sourceFileCount: 1, sourceTreeSha256: '6'.repeat(64), exportFileCount: 1, exportTreeSha256: '5'.repeat(64) },
      trees: { assetsSha256: '4'.repeat(64), nativeModuleSha256: '3'.repeat(64), nativeAppSha256: '2'.repeat(64) },
    };
    const admissionFile = write(`${name}.json`, JSON.stringify(admission));
    const sourceBracket = {
      schemaVersion: 1,
      kind: 'VANDE_GATE_A_UNITY_PAYLOAD_SOURCE_BRACKET',
      status: 'SOURCE_AND_FULL_VERIFIER_BRACKETED',
      sourceBuildIdBefore: buildId,
      sourceBuildIdAfter: buildId,
      admissionPath: admissionFile,
      admissionSha256: hash(JSON.stringify(admission)),
    };
    const sourceBracketFile = write(`${name}-source-bracket.json`, JSON.stringify(sourceBracket));
    return { admission, admissionFile, sourceBracket, sourceBracketFile };
  };
  const unityInitial = makeUnityProof('unity-payload-binding-admission');
  const unityPreinstall = makeUnityProof('unity-payload-binding-preinstall-recheck');
  const unityFinal = makeUnityProof('unity-payload-binding-final-recheck');
  const startFile = join(root, 'install-transaction-start.json');
  const start = startInstallTransaction({
    outputFile: startFile, serial: identity.serial, packageId: 'in.vande.cricket', buildId,
    admissionFile, artifactCheckFile: precheckFile, absenceFile, deviceIdentityFile: deviceFile,
    unityAdmissionFile: unityInitial.admissionFile,
    unityAdmissionSourceBracketFile: unityInitial.sourceBracketFile,
    unityPreinstallRecheckFile: unityPreinstall.admissionFile,
    unityPreinstallSourceBracketFile: unityPreinstall.sourceBracketFile,
    unitySidecarPath: join(root, 'vande-release-payload-binding.json'),
    expectedUnitySidecarSha256: '9'.repeat(64),
  });
  writeFileSync(finalCheckFile, JSON.stringify(artifactCheck(start.startedUtc)));
  writeFileSync(postCheckFile, JSON.stringify(artifactCheck(start.startedUtc)));
  writeFileSync(inventoryFile, JSON.stringify({
    schemaVersion: 1,
    status: 'EXACT_INSTALLED_PACKAGE_INVENTORY_CAPTURED',
    recordedUtc: start.startedUtc,
    serial: identity.serial,
    packageId: 'in.vande.cricket',
    inventory,
    capture: {
      pmPath: { exitStatus: 0, stdout: 'package:/data/app/base.apk\n', stderr: '' },
      sha256: [{ exitStatus: 0, stdout: `${artifactSha}  /data/app/base.apk\n`, stderr: '' }],
    },
  }));
  const installStatus = write('install-status.txt', '0\n');
  const installStdout = write('install.stdout.txt', 'Success\n');
  const installStderr = write('install.stderr.txt', '');
  const transactionFile = join(root, 'install-transaction.json');
  const transaction = finishInstallTransaction({
    startFile, artifactCheckFile: finalCheckFile, postInstallArtifactCheckFile: postCheckFile, inventoryFile,
    unityFinalRecheckFile: unityFinal.admissionFile,
    unityFinalSourceBracketFile: unityFinal.sourceBracketFile,
    statusFile: installStatus,
    stdoutFile: installStdout, stderrFile: installStderr, outputFile: transactionFile,
  });
  const boundaryUtc = new Date(Math.max(Date.now(), Date.parse(transaction.finishedUtc)) + 1).toISOString();
  const savedLive = { inningsId: 'innings-1', status: 'playing', balls: 0, records: 0, overIndex: 0, ballIndex: 0, inFlight: { overIndex: 0, ballIndex: 0 }, lastSwingKind: null };
  const savedDead = { inningsId: 'innings-1', status: 'playing', balls: 1, records: 1, overIndex: 0, ballIndex: 0, inFlight: null, lastSwingKind: 'attack' };
  const viewport = {
    schemaVersion: 1,
    cssPixels: { width: 844, height: 390 },
    physicalPixels: { width: 2400, height: 1080 },
    devicePixelRatio: 2.75,
    nativeRotationDegrees: 90,
    screenOrientation: { type: 'landscape-primary', angle: 90 },
    pageEpoch: 1,
  };
  const observation = (label, phase, saved, offsetMs, hostMonotonicNs) => ({
    label, utc: new Date(Date.parse(boundaryUtc) + offsetMs).toISOString(), hostMonotonicNs,
    hostUptime: 'load averages: 1 1 1', deviceUptime: '100 200',
    deviceIdentity: identity, buildId, renderer: 'unity-native', admission: 'engineering-preview', screen: 'delivery',
    phase, deliveryId: 'delivery-1', deliveryEventType: 'unity.result', handedness: 'right', viewport, saved,
  });
  const stateBefore = {
    ...observation('live-frame-before', 'live', savedLive, -5, '1000000000'),
    deliveryEventType: 'unity.release',
  };
  const stateAfter = observation('live-frame-after', 'live', savedLive, -2, '1300000000');
  const deadState = observation('dead-ball-before-screenshot', 'dead', savedDead, -1, '1400000000');
  const stableBoundary = observation('first-playable-boundary-stable', 'dead', savedDead, 0, '1500000000');
  const timelineFile = write('state-timeline.ndjson', `${[stateBefore, stateAfter, deadState, stableBoundary].map((value) => JSON.stringify(value)).join('\n')}\n`);
  const liveFile = write('live-frame.png', pngFixture(viewport.physicalPixels.width, viewport.physicalPixels.height));
  const deadFile = write('dead-ball.png', 'dead');
  const stateSha256 = 'b'.repeat(64);
  const bridgeNonce = 'c'.repeat(64);
  const nativeEpoch = () => ({
    schemaVersion: 1,
    status: 'OK',
    limitation: GATE_A_EPOCH_LIMITATION,
    packageId: 'in.vande.cricket',
    dataDir: {
      canonicalPath: '/data/user/0/in.vande.cricket',
      dev: '253', inode: '991', mode: '16832', uid: '10123', gid: '10123',
      mtimeNs: '1790000000000000000', ctimeNs: '1790000000000000100',
    },
    process: {
      packageId: 'in.vande.cricket', uid: '10123', pid: '4312', startTicks: '998877',
      bootId: '12345678-1234-5678-9abc-123456789abc',
    },
    bridgeNonce,
    stateSha256,
    stateBindingSha256: gateAStateBindingSha256(bridgeNonce, stateSha256),
  });
  const epoch = (label, monotonic) => ({
    schemaVersion: 1,
    status: 'ATTESTED_PERSISTED_STATE_EPOCH',
    label,
    utc: boundaryUtc,
    hostMonotonicNs: String(monotonic * 1_000_000_000),
    pageEpoch: 1,
    persistedStateBytes: 512,
    stateSha256,
    savedState: structuredClone(savedDead),
    nativeEpoch: nativeEpoch(),
  });
  const measurementRecord = (path) => ({ ...record(path), path: path.split('/').at(-1) });
  const sampleRecords = [1, 2].map((index) => {
    const stdout = write(`storage-stats-sample-${index}.stdout.txt`, primaryStats);
    const stderr = write(`storage-stats-sample-${index}.stderr.txt`, '');
    const status = write(`storage-stats-sample-${index}.status.txt`, '0\n');
    return { stdout: measurementRecord(stdout), stderr: measurementRecord(stderr), statusRecord: measurementRecord(status) };
  });
  const packageInstallIdentity = { firstInstallTime: '2026-10-29 02:00:00', lastUpdateTime: '2026-10-29 02:00:00' };
  const stableBoundaryEpoch = epoch('first-playable-boundary-stable-epoch', 2);
  const bracketedStorageStats = {
    schemaVersion: 1,
    status: 'BRACKETED_FIRST_PLAYABLE_STORAGE_STATS',
    classification: 'LOCAL_ENGINEERING_MEASUREMENT',
    limitation: GATE_A_MEASUREMENT_LIMITATION,
    packageId: 'in.vande.cricket',
    serial: identity.serial,
    user: '0',
    buildId,
    artifactSha256: artifactSha,
    runId: transaction.runId,
    command: ['adb', '-s', identity.serial, 'shell', 'pm', 'get-package-storage-stats', '--user', '0', 'in.vande.cricket'],
    boundaryEpoch: epoch('storage-stats-boundary', 3),
    samples: [1, 2].map((index) => ({
      index,
      capturedUtc: boundaryUtc,
      hostUptimeBefore: 'load averages: 1 1 1',
      deviceUptimeBefore: '100 200',
      packageInstallIdentityBefore: structuredClone(packageInstallIdentity),
      epochBefore: epoch(`storage-stats-${index}-before`, index === 1 ? 4 : 6),
      ...sampleRecords[index - 1],
      exitStatus: 0,
      parsed: {
        code: '43753472', data: '12259328', cache: '815104', freshInstalledBytes: '56012800',
        optionalBreakdown: 'COMPLETE', optionalBreakdownGrammar: null,
      },
      epochAfter: epoch(`storage-stats-${index}-after`, index === 1 ? 5 : 7),
      packageInstallIdentityAfter: structuredClone(packageInstallIdentity),
    })),
    finalEpoch: epoch('storage-stats-final', 8),
    packageInstallIdentity: structuredClone(packageInstallIdentity),
    packageInstallIdentityFinal: structuredClone(packageInstallIdentity),
    assessment: {
      stableCodeAndData: true,
      footprintStatus: 'LOCAL_ENGINEERING_MEASUREMENT',
      freshInstalledBytes: '56012800',
      limitBytes: '50000000',
      localThresholdPass: false,
      cacheCountedAgain: false,
    },
  };
  const wrapperFiles = {
    adbIsolation: adbIsolationFile,
    admission: admissionFile, preinstallStdout: pmStdout, preinstallStderr: pmStderr, preinstallStatus: pmStatus,
    unityPayloadBindingAdmissionFile: unityInitial.admissionFile,
    unityPayloadBindingAdmissionSourceBracketFile: unityInitial.sourceBracketFile,
    unityPayloadBindingPreinstallRecheckFile: unityPreinstall.admissionFile,
    unityPayloadBindingPreinstallSourceBracketFile: unityPreinstall.sourceBracketFile,
    unityPayloadBindingFinalRecheckFile: unityFinal.admissionFile,
    unityPayloadBindingFinalSourceBracketFile: unityFinal.sourceBracketFile,
    packageAbsence: absenceFile, preinstallDeviceIdentity: deviceFile, preinstallArtifactCheck: precheckFile,
    installArtifactFinalCheck: finalCheckFile, installArtifactPostCheck: postCheckFile,
    postInstallPackageInventory: inventoryFile, installTransactionStart: startFile, installStdout,
    installStderr, installStatus, installTransaction: transactionFile,
  };
  const sealedWrapperEvidence = Object.fromEntries(Object.entries(wrapperFiles).map(([name, path]) => [name, record(path)]));
  Object.assign(sealedWrapperEvidence, {
    packageAbsentBeforeInstall: true,
    packageAbsencePolicy: 'ANDROID_PM_PATH_ABSENT_EXIT_1_EMPTY_STREAMS_V1',
    installOperation: transaction.operation,
    runId: transaction.runId,
    installTransactionReceipt: transaction,
    deviceIdentity: identity,
    artifactIdentity: artifact,
    unityPayloadBinding: {
      expectedSidecar: {
        path: join(root, 'vande-release-payload-binding.json'),
        sha256: '9'.repeat(64),
      },
      admission: unityInitial.admission,
      admissionSourceBracket: unityInitial.sourceBracket,
      preinstallRecheck: unityPreinstall.admission,
      preinstallSourceBracket: unityPreinstall.sourceBracket,
      finalRecheck: unityFinal.admission,
      finalSourceBracket: unityFinal.sourceBracket,
      admissionFile: record(unityInitial.admissionFile),
      admissionSourceBracketFile: record(unityInitial.sourceBracketFile),
      preinstallRecheckFile: record(unityPreinstall.admissionFile),
      preinstallSourceBracketFile: record(unityPreinstall.sourceBracketFile),
      finalRecheckFile: record(unityFinal.admissionFile),
      finalSourceBracketFile: record(unityFinal.sourceBracketFile),
    },
  });
  const liveBytes = readFileSync(liveFile);
  const liveFrame = {
    path: 'live-frame.png',
    bytes: String(liveBytes.length),
    sha256: hash(liveBytes),
    png: structuredClone(viewport.physicalPixels),
  };
  const remotePath = `/data/local/tmp/vande-gate-a-${transaction.runId}/live-frame.png`;
  const rawCaptureOutput = [
    'device-uptime-after-tap=100.12 200.12',
    `bytes=${liveFrame.bytes}`,
    `${liveFrame.sha256}  ${remotePath}`,
    'transaction-status=0',
    GATE_A_CAPTURE_THEN_TAP_SUCCESS_MARKER,
  ].join('\n');
  const parsedCaptureOutput = parseGateACaptureThenTapOutput(rawCaptureOutput, remotePath);
  assert.ok(parsedCaptureOutput);
  const evidence = {
    schemaVersion: 2, harnessFinalStatus: 'ACCEPTED', crashOrAnrLines: [], webErrorCount: 0, nativeErrorCount: 0,
    packageId: 'in.vande.cricket', serial: identity.serial, user: '0', runId: transaction.runId, buildId,
    adbServer: { host: '127.0.0.1', port: 5038 },
    deviceIdentity: identity, packageInstallIdentity,
    installTransaction: transaction, artifact: firstBallArtifact, installedPackageInventoryBefore: inventory,
    installedPackageInventoryAfter: inventory, sealedWrapperEvidence, hooksPresent: false, gameplayTapCount: 1,
    outOfBandAppDataOperations: [], lifecycleOrPerformanceModeUsed: false, secondBallStarted: false,
    stateBefore, stateAfter, deadState, stableBoundary,
    handedness: 'right', viewport,
    captureThenTap: {
      schemaVersion: 2,
      status: GATE_A_CAPTURE_THEN_TAP_STATUS,
      classification: GATE_A_CAPTURE_THEN_TAP_CLASSIFICATION,
      runId: transaction.runId,
      serial: identity.serial,
      adbEndpoint: { host: '127.0.0.1', port: 5038 },
      buildId,
      deliveryId: stateBefore.deliveryId,
      viewport: structuredClone(viewport),
      tapCoordinatePhysicalPixels: gateATapCoordinate(viewport),
      coordinateRule: GATE_A_CAPTURE_THEN_TAP_COORDINATE_RULE,
      operationOrder: [...GATE_A_CAPTURE_THEN_TAP_OPERATIONS],
      remoteShellCommand: gateACaptureThenTapCommand({
        remotePath,
        coordinate: gateATapCoordinate(viewport),
      }),
      remoteShellTransactionCount: 1,
      gameplayTapCount: 1,
      startedUtc: new Date(Date.parse(boundaryUtc) - 4).toISOString(),
      finishedUtc: new Date(Date.parse(boundaryUtc) - 3).toISOString(),
      startedHostMonotonicNs: '1100000000',
      finishedHostMonotonicNs: '1200000000',
      successMarker: GATE_A_CAPTURE_THEN_TAP_SUCCESS_MARKER,
      successMarkerObservedCount: 1,
      successDerivation: GATE_A_CAPTURE_THEN_TAP_SUCCESS_DERIVATION,
      adbShellResult: {
        exitStatus: 0,
        stderrBytes: '0',
        stderrSha256: hash(Buffer.alloc(0)),
      },
      transactionOutput: parsedCaptureOutput.transactionOutput,
      deviceUptimeAfterTap: parsedCaptureOutput.deviceUptimeAfterTap,
      remoteCapture: { ...parsedCaptureOutput.remoteCapture, png: structuredClone(viewport.physicalPixels) },
      nativeListenerRegistration: { epoch: 1, ok: true, reason: 'message_and_error_listeners_attached' },
      nativeEventDropCounts: { events: 0, registrations: 0 },
      nativeDeliveryEvents: [
        { epoch: 1, operationId: 'operation-1', type: 'unity.release', sequence: 10, deliveryId: stateBefore.deliveryId },
        { epoch: 1, operationId: 'operation-1', type: 'unity.pointer', sequence: 11, deliveryId: stateBefore.deliveryId },
        { epoch: 1, operationId: 'operation-1', type: 'unity.gesture', sequence: 12, deliveryId: stateBefore.deliveryId },
        { epoch: 1, operationId: 'operation-1', type: 'unity.dead', sequence: 13, deliveryId: stateBefore.deliveryId },
      ],
      liveFrame,
    },
    unityPayloadBinding: sealedWrapperEvidence.unityPayloadBinding,
    stableBoundaryEpoch,
    liveFrame,
    deadBallFrame: { path: 'dead-ball.png', sha256: hash(readFileSync(deadFile)) },
    timeline: { path: 'state-timeline.ndjson', sha256: hash(readFileSync(timelineFile)) },
    measuredBoundaryUtc: stableBoundary.utc,
    bracketedStorageStats,
  };
  const evidencePath = join(root, 'first-playable-ball.json');
  writeFileSync(evidencePath, JSON.stringify(evidence));
  return { root, evidence, evidencePath, transaction };
}

test('first-ball binding replays exact wrapper receipts, timeline, transition, device and install transaction', () => {
  const { evidence, evidencePath, transaction } = fixture();
  const options = {
    serial: identity.serial, user: '0', package: 'in.vande.cricket', expected_build_id: buildId,
    expected_artifact_sha256: artifactSha, first_ball_evidence: evidencePath,
  };
  const binding = validateFirstBallEvidence(options, evidence);
  assert.equal(binding.installTransaction.runId, transaction.runId);
  assert.throws(() => validateFirstBallEvidence(options, {
    ...evidence,
    packageInstallIdentity: { ...evidence.packageInstallIdentity, lastUpdateTime: '2026-10-29 03:00:00' },
  }), /install time identity/u);
  assert.throws(() => validateFirstBallEvidence(options, {
    ...evidence,
    runId: '00000000-0000-4000-8000-000000000000',
  }), /install transaction/u);
  assert.throws(() => validateFirstBallEvidence(options, {
    ...evidence,
    crashOrAnrLines: ['FATAL EXCEPTION'],
  }), /crash or ANR/u);
  assert.throws(() => validateFirstBallEvidence(options, {
    ...evidence,
    captureThenTap: {
      ...evidence.captureThenTap,
      adbEndpoint: { host: '127.0.0.1', port: 5040 },
    },
  }), /ADB endpoint/u);
});

test('installed-size binding verifies actual local live-frame bytes and decodable IDAT', () => {
  const optionsFor = (evidencePath) => ({
    serial: identity.serial, user: '0', package: 'in.vande.cricket', expected_build_id: buildId,
    expected_artifact_sha256: artifactSha, first_ball_evidence: evidencePath,
  });
  {
    const { evidence, evidencePath, root } = fixture();
    const bytes = readFileSync(join(root, evidence.liveFrame.path));
    rebindLiveFrameEvidence(evidence, bytes, String(bytes.length + 1));
    assert.throws(
      () => validateFirstBallEvidence(optionsFor(evidencePath), evidence),
      /live-frame byte length differs/u,
    );
  }
  {
    const { evidence, evidencePath, root } = fixture();
    const path = join(root, evidence.liveFrame.path);
    const corrupt = corruptPngIdatWithValidCrc(readFileSync(path));
    writeFileSync(path, corrupt);
    rebindLiveFrameEvidence(evidence, corrupt);
    assert.throws(
      () => validateFirstBallEvidence(optionsFor(evidencePath), evidence),
      /PNG is undecodable/u,
    );
  }
  for (const attack of [
    (_bytes, evidence) => palettePngWithoutPlte(
      evidence.viewport.physicalPixels.width,
      evidence.viewport.physicalPixels.height,
    ),
    (bytes) => {
      const idatOffset = pngChunkOffset(bytes, 'IDAT');
      return Buffer.concat([
        bytes.subarray(0, idatOffset),
        pngChunk('ABCD', Buffer.alloc(0)),
        bytes.subarray(idatOffset),
      ]);
    },
  ]) {
    const { evidence, evidencePath, root } = fixture();
    const path = join(root, evidence.liveFrame.path);
    const attacked = attack(readFileSync(path), evidence);
    writeFileSync(path, attacked);
    rebindLiveFrameEvidence(evidence, attacked);
    assert.throws(
      () => validateFirstBallEvidence(optionsFor(evidencePath), evidence),
      /PNG is undecodable/u,
    );
  }
});

test('first-ball binding rejects a same-summary coherent epoch replacement after the stable boundary', () => {
  const { evidence, evidencePath } = fixture();
  const options = {
    serial: identity.serial, user: '0', package: 'in.vande.cricket', expected_build_id: buildId,
    expected_artifact_sha256: artifactSha, first_ball_evidence: evidencePath,
  };
  const replacementState = 'd'.repeat(64);
  const replacementNonce = 'e'.repeat(64);
  const replace = (capture) => {
    capture.persistedStateBytes += 1;
    capture.stateSha256 = replacementState;
    capture.nativeEpoch.dataDir.inode = '992';
    capture.nativeEpoch.process.pid = '4313';
    capture.nativeEpoch.process.startTicks = '998878';
    capture.nativeEpoch.bridgeNonce = replacementNonce;
    capture.nativeEpoch.stateSha256 = replacementState;
    capture.nativeEpoch.stateBindingSha256 = gateAStateBindingSha256(replacementNonce, replacementState);
  };
  replace(evidence.bracketedStorageStats.boundaryEpoch);
  for (const sample of evidence.bracketedStorageStats.samples) {
    replace(sample.epochBefore);
    replace(sample.epochAfter);
  }
  replace(evidence.bracketedStorageStats.finalEpoch);
  assert.deepEqual(evidence.bracketedStorageStats.boundaryEpoch.savedState, evidence.stableBoundary.saved);
  assert.throws(() => validateFirstBallEvidence(options, evidence), /stable first-playable boundary/u);
});

test('first-ball binding rejects a top-level install identity mismatch with coherent sample identities', () => {
  const { evidence, evidencePath } = fixture();
  evidence.packageInstallIdentity = {
    firstInstallTime: '2026-10-29 03:00:00',
    lastUpdateTime: '2026-10-29 03:00:00',
  };
  assert.throws(() => validateFirstBallEvidence({
    serial: identity.serial, user: '0', package: 'in.vande.cricket', expected_build_id: buildId,
    expected_artifact_sha256: artifactSha, first_ball_evidence: evidencePath,
  }, evidence), /measurement package install identity changed/u);
});

test('first-ball binding rejects swapped H7 files, reduced booleans and mismatched full-object hashes', () => {
  const optionsFor = (evidencePath) => ({
    serial: identity.serial, user: '0', package: 'in.vande.cricket', expected_build_id: buildId,
    expected_artifact_sha256: artifactSha, first_ball_evidence: evidencePath,
  });
  {
    const { evidence, evidencePath } = fixture();
    const key = 'unityPayloadBindingPreinstallRecheckFile';
    const path = evidence.sealedWrapperEvidence[key].path;
    const swapped = { ...evidence.unityPayloadBinding.preinstallRecheck, invocationId: 'file-swapped' };
    writeFileSync(path, JSON.stringify(swapped));
    const updated = record(path);
    evidence.sealedWrapperEvidence[key] = updated;
    evidence.sealedWrapperEvidence.unityPayloadBinding.preinstallRecheckFile = updated;
    assert.throws(() => validateFirstBallEvidence(optionsFor(evidencePath), evidence), /evidence file differs from its embedded (?:full )?object/u);
  }
  {
    const { evidence, evidencePath } = fixture();
    evidence.unityPayloadBinding.finalRecheck = true;
    assert.throws(() => validateFirstBallEvidence(optionsFor(evidencePath), evidence), /admission rejected|verifier objects differ/u);
  }
  {
    const { evidence, evidencePath } = fixture();
    evidence.unityPayloadBinding.finalSourceBracket.admissionSha256 = '0'.repeat(64);
    assert.throws(() => validateFirstBallEvidence(optionsFor(evidencePath), evidence), /full admission SHA-256 differs/u);
  }
});

test('offline first-ball validation rejects substituted, swapped and reduced install receipts', () => {
  const optionsFor = (evidencePath) => ({
    serial: identity.serial, user: '0', package: 'in.vande.cricket', expected_build_id: buildId,
    expected_artifact_sha256: artifactSha, first_ball_evidence: evidencePath,
  });
  {
    const { evidence, evidencePath } = fixture();
    const completionPath = evidence.sealedWrapperEvidence.installTransaction.path;
    const substituted = structuredClone(evidence.installTransaction);
    substituted.buildId = `${buildId.split('+')[0]}+ffffffffffff`;
    substituted.serial = 'emulator-5590';
    substituted.artifact.sha256 = '8'.repeat(64);
    substituted.postInstallArtifact.sha256 = '8'.repeat(64);
    substituted.installedPackageInventory[0].sha256 = '8'.repeat(64);
    writeFileSync(completionPath, JSON.stringify(substituted));
    evidence.installTransaction = substituted;
    evidence.sealedWrapperEvidence.installTransaction = record(completionPath);
    assert.throws(
      () => validateFirstBallEvidence(optionsFor(evidencePath), evidence),
      /sealed-wrapper install transactions are not exactly equal|install build ID does not match/u,
    );
  }
  {
    const { evidence, evidencePath } = fixture();
    const startPath = evidence.sealedWrapperEvidence.installTransactionStart.path;
    const completionPath = evidence.sealedWrapperEvidence.installTransaction.path;
    const start = JSON.parse(readFileSync(startPath, 'utf8'));
    const completion = JSON.parse(readFileSync(completionPath, 'utf8'));
    writeFileSync(startPath, JSON.stringify(completion));
    writeFileSync(completionPath, JSON.stringify(start));
    evidence.sealedWrapperEvidence.installTransactionStart = record(startPath);
    evidence.sealedWrapperEvidence.installTransaction = record(completionPath);
    assert.throws(
      () => validateFirstBallEvidence(optionsFor(evidencePath), evidence),
      /install receipt status is invalid|schemas or statuses are invalid/u,
    );
  }
  {
    const { evidence, evidencePath } = fixture();
    const startPath = evidence.sealedWrapperEvidence.installTransactionStart.path;
    const completionPath = evidence.sealedWrapperEvidence.installTransaction.path;
    const reducedStart = JSON.parse(readFileSync(startPath, 'utf8'));
    delete reducedStart.packageId;
    writeFileSync(startPath, JSON.stringify(reducedStart));
    evidence.sealedWrapperEvidence.installTransactionStart = record(startPath);
    const completion = structuredClone(evidence.installTransaction);
    completion.evidence.start = evidence.sealedWrapperEvidence.installTransactionStart;
    writeFileSync(completionPath, JSON.stringify(completion));
    evidence.sealedWrapperEvidence.installTransaction = record(completionPath);
    evidence.sealedWrapperEvidence.installTransactionReceipt = completion;
    evidence.installTransaction = completion;
    assert.throws(
      () => validateFirstBallEvidence(optionsFor(evidencePath), evidence),
      /install-start receipt fields differ|install packageId binding is invalid/u,
    );
  }
  {
    const { evidence, evidencePath } = fixture();
    const completionPath = evidence.sealedWrapperEvidence.installTransaction.path;
    const reduced = structuredClone(evidence.installTransaction);
    delete reduced.installedPackageInventory;
    writeFileSync(completionPath, JSON.stringify(reduced));
    evidence.sealedWrapperEvidence.installTransaction = record(completionPath);
    evidence.sealedWrapperEvidence.installTransactionReceipt = reduced;
    evidence.installTransaction = reduced;
    assert.throws(
      () => validateFirstBallEvidence(optionsFor(evidencePath), evidence),
      /install-completion receipt fields differ|inventory does not exactly match/u,
    );
  }
});

test('full first-ball validation rejects coherent device substitution against captured identity', () => {
  const { evidence, evidencePath } = fixture();
  const substituted = { ...evidence.deviceIdentity, model: 'Substituted device' };
  const substitutedSha256 = androidDeviceIdentitySha256(substituted);
  const startPath = evidence.sealedWrapperEvidence.installTransactionStart.path;
  const completionPath = evidence.sealedWrapperEvidence.installTransaction.path;
  const start = JSON.parse(readFileSync(startPath, 'utf8'));
  start.deviceIdentity = substituted;
  start.deviceIdentitySha256 = substitutedSha256;
  writeFileSync(startPath, JSON.stringify(start));
  evidence.sealedWrapperEvidence.installTransactionStart = record(startPath);
  const completion = structuredClone(evidence.installTransaction);
  completion.deviceIdentity = substituted;
  completion.deviceIdentitySha256 = substitutedSha256;
  completion.evidence.start = evidence.sealedWrapperEvidence.installTransactionStart;
  writeFileSync(completionPath, JSON.stringify(completion));
  evidence.sealedWrapperEvidence.installTransaction = record(completionPath);
  evidence.sealedWrapperEvidence.installTransactionReceipt = completion;
  evidence.installTransaction = completion;
  evidence.deviceIdentity = substituted;
  evidence.sealedWrapperEvidence.deviceIdentity = substituted;
  for (const state of [evidence.stateBefore, evidence.stateAfter, evidence.deadState, evidence.stableBoundary]) {
    state.deviceIdentity = substituted;
  }
  assert.throws(() => validateFirstBallEvidence({
    serial: identity.serial,
    user: '0',
    package: 'in.vande.cricket',
    expected_build_id: buildId,
    expected_artifact_sha256: artifactSha,
    first_ball_evidence: evidencePath,
  }, evidence), /preinstall device identity evidence differs/u);
});

test('first-ball binding rejects top-level hand or viewport that differs from live/dead/stable observations', () => {
  const optionsFor = (evidencePath) => ({
    serial: identity.serial, user: '0', package: 'in.vande.cricket', expected_build_id: buildId,
    expected_artifact_sha256: artifactSha, first_ball_evidence: evidencePath,
  });
  {
    const { evidence, evidencePath } = fixture();
    evidence.handedness = 'left';
    assert.throws(() => validateFirstBallEvidence(optionsFor(evidencePath), evidence), /top-level handedness\/viewport differs/u);
  }
  {
    const { evidence, evidencePath } = fixture();
    evidence.viewport = { ...evidence.viewport, pageEpoch: 2 };
    assert.throws(() => validateFirstBallEvidence(optionsFor(evidencePath), evidence), /top-level handedness\/viewport differs/u);
  }
});

test('offline reporter uses only bracketed samples and never invokes a supplied ADB executable', () => {
  const { root, evidencePath } = fixture();
  const fakeAdb = join(root, 'fake-adb');
  const adbMarker = join(root, 'forbidden-later-adb.marker');
  writeFileSync(fakeAdb, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(adbMarker)}, 'offline reporter illegally invoked ADB\\n');
process.exitCode = 99;
`);
  const outputDir = join(root, 'installed-size-output');
  const report = measureInstalledSize({
    serial: identity.serial,
    user: '0',
    package: 'in.vande.cricket',
    expected_build_id: buildId,
    expected_artifact_sha256: artifactSha,
    first_ball_evidence: evidencePath,
    output_dir: outputDir,
    adb: fakeAdb,
  });
  assert.equal(report.measurementCapturedInsideFirstBallHarness, true);
  assert.equal(report.laterDeviceSamplingPerformed, false);
  assert.equal(report.assessment.freshInstalledBytes, '56012800');
  assert.equal(existsSync(adbMarker), false);
  assert.equal(existsSync(join(outputDir, 'installed-size.json')), true);
});

test('changed package-data epoch produces no installed-size directory or report', () => {
  const { root, evidence, evidencePath } = fixture();
  evidence.bracketedStorageStats.finalEpoch.nativeEpoch.process.startTicks = '998878';
  writeFileSync(evidencePath, JSON.stringify(evidence));
  const outputDir = join(root, 'rejected-installed-size-output');
  assert.throws(() => measureInstalledSize({
    serial: identity.serial,
    user: '0',
    package: 'in.vande.cricket',
    expected_build_id: buildId,
    expected_artifact_sha256: artifactSha,
    first_ball_evidence: evidencePath,
    output_dir: outputDir,
  }), /package-data epoch/u);
  assert.equal(existsSync(outputDir), false);
  assert.equal(existsSync(join(outputDir, 'installed-size.json')), false);
});
