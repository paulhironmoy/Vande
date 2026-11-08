#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  GATE_A_EPOCH_LIMITATION,
  GATE_A_MEASUREMENT_LIMITATION,
  gateAStateBindingSha256,
  validateBracketedStorageStatsMeasurement,
  validateNativePackageDataEpoch,
  validatePackageDataEpochCapture,
} from './android-package-data-epoch.mjs';

const packageId = 'in.vande.cricket';
const stateSha256 = 'a'.repeat(64);
const bridgeNonce = 'b'.repeat(64);
const savedState = {
  inningsId: 'innings-1', status: 'playing', balls: 1, records: 1,
  overIndex: 0, ballIndex: 0, inFlight: null, lastSwingKind: 'attack',
};
const installIdentity = { firstInstallTime: '2026-10-29 02:00:00', lastUpdateTime: '2026-10-29 02:00:00' };

const nativeEpoch = () => ({
  schemaVersion: 1,
  status: 'OK',
  limitation: GATE_A_EPOCH_LIMITATION,
  packageId,
  dataDir: {
    canonicalPath: `/data/user/0/${packageId}`,
    dev: '253', inode: '991', mode: '16832', uid: '10123', gid: '10123',
    mtimeNs: '1790000000000000000', ctimeNs: '1790000000000000100',
  },
  process: {
    packageId, uid: '10123', pid: '4312', startTicks: '998877',
    bootId: '12345678-1234-5678-9abc-123456789abc',
  },
  bridgeNonce,
  stateSha256,
  stateBindingSha256: gateAStateBindingSha256(bridgeNonce, stateSha256),
});

const capture = (label, hostMonotonicNs) => ({
  schemaVersion: 1,
  status: 'ATTESTED_PERSISTED_STATE_EPOCH',
  label,
  utc: '2026-10-29T03:00:00.000Z',
  hostMonotonicNs: String(hostMonotonicNs),
  pageEpoch: 1,
  persistedStateBytes: 512,
  stateSha256,
  savedState: structuredClone(savedState),
  nativeEpoch: nativeEpoch(),
});

const rawRecord = (name, hash = 'c'.repeat(64)) => ({ path: name, sha256: hash, bytes: '1' });

const measurement = () => ({
  schemaVersion: 1,
  status: 'BRACKETED_FIRST_PLAYABLE_STORAGE_STATS',
  classification: 'LOCAL_ENGINEERING_MEASUREMENT',
  limitation: GATE_A_MEASUREMENT_LIMITATION,
  packageId,
  serial: 'emulator-5584',
  user: '0',
  buildId: '1234567',
  artifactSha256: 'd'.repeat(64),
  runId: '12345678-1234-4678-9abc-123456789abc',
  command: ['adb', '-s', 'emulator-5584', 'shell', 'pm', 'get-package-storage-stats', '--user', '0', packageId],
  boundaryEpoch: capture('storage-stats-boundary', 100),
  samples: [1, 2].map((index) => ({
    index,
    capturedUtc: '2026-10-29T03:00:00.000Z',
    hostUptimeBefore: 'load averages: 1.0 1.0 1.0',
    deviceUptimeBefore: '1000.00 2000.00',
    packageInstallIdentityBefore: structuredClone(installIdentity),
    epochBefore: capture(`storage-stats-${index}-before`, index === 1 ? 110 : 130),
    stdout: rawRecord(`storage-stats-sample-${index}.stdout.txt`),
    stderr: rawRecord(`storage-stats-sample-${index}.stderr.txt`),
    exitStatus: 0,
    statusRecord: rawRecord(`storage-stats-sample-${index}.status.txt`),
    parsed: {
      code: '30000000', data: '10000000', cache: '100', freshInstalledBytes: '40000000',
      optionalBreakdown: 'COMPLETE', optionalBreakdownGrammar: null,
    },
    epochAfter: capture(`storage-stats-${index}-after`, index === 1 ? 120 : 140),
    packageInstallIdentityAfter: structuredClone(installIdentity),
  })),
  finalEpoch: capture('storage-stats-final', 150),
  packageInstallIdentity: structuredClone(installIdentity),
  packageInstallIdentityFinal: structuredClone(installIdentity),
  assessment: {
    stableCodeAndData: true,
    footprintStatus: 'LOCAL_ENGINEERING_MEASUREMENT',
    freshInstalledBytes: '40000000',
    limitBytes: '50000000',
    localThresholdPass: true,
    cacheCountedAgain: false,
  },
});

const validate = (value) => validateBracketedStorageStatsMeasurement(value, {
  packageId,
  serial: 'emulator-5584',
  user: '0',
  buildId: '1234567',
  artifactSha256: 'd'.repeat(64),
  runId: '12345678-1234-4678-9abc-123456789abc',
  stableSavedState: savedState,
  stableBoundaryEpoch: capture('first-playable-boundary-stable-epoch', 90),
  expectedPackageInstallIdentity: installIdentity,
});

test('stable same-process package-data epoch brackets both samples and final boundary', () => {
  assert.equal(validate(measurement()).status, 'BRACKETED_FIRST_PLAYABLE_STORAGE_STATS');
});

test('ordinary reset before, during, between or after samples changes the epoch and rejects', () => {
  const mutations = [
    (value) => { value.samples[0].epochBefore.nativeEpoch.dataDir.inode = '992'; },
    (value) => { value.samples[0].epochAfter.nativeEpoch.dataDir.inode = '992'; },
    (value) => { value.samples[1].epochBefore.nativeEpoch.dataDir.inode = '992'; value.samples[1].epochAfter.nativeEpoch.dataDir.inode = '992'; },
    (value) => { value.samples[1].epochAfter.nativeEpoch.dataDir.inode = '992'; },
    (value) => { value.finalEpoch.nativeEpoch.dataDir.inode = '992'; },
  ];
  for (const mutate of mutations) {
    const value = measurement();
    mutate(value);
    assert.throws(() => validate(value), /epoch/u);
  }
});

test('same-summary raw state and coherent process/data/bridge replacement cannot become the sampling baseline', () => {
  const value = measurement();
  const replacementState = 'e'.repeat(64);
  const replacementNonce = 'f'.repeat(64);
  const replace = (epochCapture) => {
    epochCapture.persistedStateBytes += 1;
    epochCapture.stateSha256 = replacementState;
    epochCapture.nativeEpoch.dataDir.inode = '992';
    epochCapture.nativeEpoch.process.pid = '4313';
    epochCapture.nativeEpoch.process.startTicks = '998878';
    epochCapture.nativeEpoch.bridgeNonce = replacementNonce;
    epochCapture.nativeEpoch.stateSha256 = replacementState;
    epochCapture.nativeEpoch.stateBindingSha256 = gateAStateBindingSha256(replacementNonce, replacementState);
  };
  replace(value.boundaryEpoch);
  for (const sample of value.samples) {
    replace(sample.epochBefore);
    replace(sample.epochAfter);
  }
  replace(value.finalEpoch);
  assert.deepEqual(value.boundaryEpoch.savedState, savedState);
  assert.throws(() => validate(value), /stable first-playable boundary/u);
});

test('reset before the boundary is exposed by saved-state binding and state loss', () => {
  const changed = measurement();
  changed.boundaryEpoch.savedState.inningsId = 'reset-innings';
  assert.throws(() => validate(changed), /saved state/u);

  const missing = measurement();
  missing.boundaryEpoch.persistedStateBytes = 0;
  assert.throws(() => validate(missing), /byte count/u);
});

test('same PID with new start ticks and a different PID both reject', () => {
  const reusedPid = measurement();
  reusedPid.samples[1].epochBefore.nativeEpoch.process.startTicks = '998878';
  reusedPid.samples[1].epochAfter.nativeEpoch.process.startTicks = '998878';
  assert.throws(() => validate(reusedPid), /epoch/u);

  const differentPid = measurement();
  differentPid.samples[1].epochBefore.nativeEpoch.process.pid = '4313';
  differentPid.samples[1].epochAfter.nativeEpoch.process.pid = '4313';
  assert.throws(() => validate(differentPid), /epoch/u);
});

test('every data-directory identity field, including nanosecond timestamps, is immutable', () => {
  for (const [field, replacement] of Object.entries({
    canonicalPath: `/data/user/10/${packageId}`,
    dev: '254', inode: '992', mode: '16877', uid: '10124', gid: '10124',
    mtimeNs: '1790000000000000001', ctimeNs: '1790000000000000101',
  })) {
    const value = measurement();
    value.finalEpoch.nativeEpoch.dataDir[field] = replacement;
    assert.throws(() => validate(value), /epoch|uid/u, field);
  }
  for (const field of ['mtimeNs', 'ctimeNs']) {
    const value = measurement();
    delete value.samples[0].epochBefore.nativeEpoch.dataDir[field];
    assert.throws(() => validate(value), /keys/u, field);
  }
});

test('missing bridge, process, data or persisted state fails closed', () => {
  for (const field of ['nativeEpoch', 'savedState']) {
    const value = measurement();
    delete value.samples[0].epochBefore[field];
    assert.throws(() => validate(value), /keys|object/u, field);
  }
  for (const field of ['process', 'dataDir', 'bridgeNonce']) {
    const value = measurement();
    delete value.samples[0].epochBefore.nativeEpoch[field];
    assert.throws(() => validate(value), /keys/u, field);
  }
});

test('noncanonical package data path, mismatched uid and invalid state binding reject', () => {
  const noncanonical = nativeEpoch();
  noncanonical.dataDir.canonicalPath = `/data/user/0/../0/${packageId}`;
  assert.throws(() => validateNativePackageDataEpoch(noncanonical, { packageId, stateSha256 }), /canonical/u);

  const uid = nativeEpoch();
  uid.process.uid = '10124';
  assert.throws(() => validateNativePackageDataEpoch(uid, { packageId, stateSha256 }), /uid/u);

  const binding = nativeEpoch();
  binding.stateBindingSha256 = 'e'.repeat(64);
  assert.throws(() => validateNativePackageDataEpoch(binding, { packageId, stateSha256 }), /binding/u);
});

test('install identity changes in any sample bracket reject', () => {
  for (const [sample, side] of [[0, 'Before'], [0, 'After'], [1, 'Before'], [1, 'After']]) {
    const value = measurement();
    value.samples[sample][`packageInstallIdentity${side}`].lastUpdateTime = '2026-10-29 04:00:00';
    assert.throws(() => validate(value), /install identity.*changed/u);
  }
});

test('coherently replaced measurement install identity cannot differ from the top-level receipt', () => {
  const value = measurement();
  const replacement = { firstInstallTime: '2026-10-29 04:00:00', lastUpdateTime: '2026-10-29 04:00:00' };
  value.packageInstallIdentity = structuredClone(replacement);
  value.packageInstallIdentityFinal = structuredClone(replacement);
  for (const sample of value.samples) {
    sample.packageInstallIdentityBefore = structuredClone(replacement);
    sample.packageInstallIdentityAfter = structuredClone(replacement);
  }
  assert.throws(() => validate(value), /measurement package install identity changed/u);
});

test('capture validation rejects absent WebView epoch and non-first-ball state', () => {
  const noPage = capture('storage-stats-boundary', 100);
  noPage.pageEpoch = 0;
  assert.throws(() => validatePackageDataEpochCapture(noPage, { packageId }), /pageEpoch/u);
  const stateLost = capture('storage-stats-boundary', 100);
  stateLost.savedState = null;
  assert.throws(() => validatePackageDataEpochCapture(stateLost, { packageId }), /object/u);
});

test('sealed harness owns sampling and offline reporter has no later ADB/device path', () => {
  const harness = readFileSync(new URL('./android-practice.mjs', import.meta.url), 'utf8');
  const reporter = readFileSync(new URL('./android-installed-size.mjs', import.meta.url), 'utf8');
  assert.match(harness, /GateAEvidencePlugin\.getEpoch\(\{ stateSha256 \}\)/u);
  assert.match(
    harness,
    /spawnSync\(ADB_PATH, \[\s*'-H', ADB_ENDPOINT\.host,\s*'-P', String\(ADB_ENDPOINT\.port\),\s*'-s', device\.serial\(\),\s*\.\.\.args,\s*\]/u,
  );
  assert.match(harness, /capturePackageDataEpoch\(`storage-stats-\$\{index\}-before`\)[\s\S]*get-package-storage-stats[\s\S]*capturePackageDataEpoch\(`storage-stats-\$\{index\}-after`\)/u);
  assert.ok(harness.indexOf('await finalizeGateAStorageStats();') < harness.indexOf('for (const candidate of connected)'));
  assert.doesNotMatch(reporter, /spawnSync|function adb|captureDeviceIdentity|shell pm get-package-storage-stats/u);
  assert.match(reporter, /measurementCapturedInsideFirstBallHarness: true/u);
  assert.match(reporter, /laterDeviceSamplingPerformed: false/u);
});
