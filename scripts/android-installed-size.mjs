#!/usr/bin/env node

/**
 * Offline validator/reporter for Android installed-footprint evidence captured
 * inside the sealed first-playable harness. It performs no ADB/device operation
 * and cannot replace the bound samples with a later favourable observation.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  sameAndroidDeviceIdentity,
  validateAndroidDeviceIdentity,
} from './android-device-identity.mjs';
import {
  gateAPngDimensions,
  validateGateACaptureThenTapReceipt,
  validateFirstBallTransition,
} from './android-gate-a.mjs';
import {
  validateInstallTransaction,
  validatePackageAbsenceReceipt,
} from './android-gate-a-receipt.mjs';
import { validateBracketedStorageStatsMeasurement } from './android-package-data-epoch.mjs';
import {
  validateGateAUnityEvidenceFromFirstBall,
} from './android-gate-a-unity-admission.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const LIMIT_BYTES = 50_000_000n;
const BUILD_ID = /^[0-9a-f]{7,40}(?:\+[0-9a-f]{12})?$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_ANDROID_LONG = 9_223_372_036_854_775_807n;
const MAX_BOUNDARY_AGE_MS = 30 * 60 * 1000;

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

export function parseStorageStats(stdout, { stderr = '', status = 0 } = {}) {
  const lines = String(stdout).split(/\r?\n/u);
  const rows = new Map();
  const indices = new Map();
  const diagnostics = [];
  const rowPattern = /^([a-z][a-z0-9_-]*): ([0-9]+) bytes(?: \(([0-9]+(?:\.[0-9]{2})?) (bytes|Kb|Mb|Gb|Tb)\))?$/u;
  const expectedHuman = (bytes) => {
    const units = [['Tb', 1024n ** 4n], ['Gb', 1024n ** 3n], ['Mb', 1024n ** 2n], ['Kb', 1024n]];
    for (const [unit, divisor] of units) {
      if (bytes >= divisor) return `${(Number((bytes * 100n + divisor / 2n) / divisor) / 100).toFixed(2)} ${unit}`;
    }
    return `${bytes} bytes`;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === '') continue;
    const match = line.match(rowPattern);
    if (!match) {
      diagnostics.push({ index, line });
      continue;
    }
    const value = BigInt(match[2]);
    if (value > MAX_ANDROID_LONG) throw new Error(`${match[1]} exceeds signed Android long range`);
    if (match[3] !== undefined && `${match[3]} ${match[4]}` !== expectedHuman(value)) {
      throw new Error(`${match[1]} human-readable suffix does not match its authoritative byte count`);
    }
    if (['code', 'data', 'cache'].includes(match[1])) {
      if (rows.has(match[1])) throw new Error(`duplicate ${match[1]} StorageStats row`);
      rows.set(match[1], value);
      indices.set(match[1], index);
    }
  }
  for (const name of ['code', 'data', 'cache']) {
    if (!rows.has(name)) throw new Error(`missing mandatory ${name}: N bytes StorageStats row`);
  }
  if (!(indices.get('code') < indices.get('data') && indices.get('data') < indices.get('cache'))) {
    throw new Error('mandatory StorageStats rows are not in code/data/cache order');
  }
  const code = rows.get('code');
  const data = rows.get('data');
  const cache = rows.get('cache');
  if (cache > data) throw new Error(`cache ${cache} exceeds data ${data}`);
  if (code + data > MAX_ANDROID_LONG) throw new Error('code + data exceeds signed Android long range');

  let optionalBreakdown = 'COMPLETE';
  const normalizedSecurityDetail = (value) => {
    const normalized = String(value).trim().replace(/\s+/gu, ' ');
    return /^java\.lang\.SecurityException: \S(?:.*\S)?$/u.test(normalized) ? normalized : null;
  };
  if (status !== 0 && status !== 255) {
    throw new Error(`StorageStats command exited ${status}, expected the frozen API-36 partial status 255`);
  }
  const stdoutFailureDetails = [];
  const stdoutFailureGrammars = [];
  const recognizedStdoutDiagnostics = new Set();
  for (let index = 0; index < diagnostics.length; index += 1) {
    const entry = diagnostics[index];
    const failurePrefix = 'Failure [failed to get storage stats], reason: ';
    const commandPrefix = "Exception occurred while executing 'get-package-storage-stats':";
    if (entry.line.startsWith(failurePrefix)) {
      const detail = normalizedSecurityDetail(entry.line.slice(failurePrefix.length));
      if (!detail) throw new Error(`unrecognized StorageStats diagnostic line: ${entry.line.slice(0, 160)}`);
      stdoutFailureDetails.push(detail);
      stdoutFailureGrammars.push('API36_STORAGE_FAILURE_REASON_V1');
      recognizedStdoutDiagnostics.add(index);
      continue;
    }
    if (entry.line === commandPrefix) {
      const next = diagnostics[index + 1];
      const detail = next && next.index === entry.index + 1 ? normalizedSecurityDetail(next.line) : null;
      if (!detail) throw new Error('StorageStats command failure header lacks its exact SecurityException detail record');
      stdoutFailureDetails.push(detail);
      stdoutFailureGrammars.push('API36_COMMAND_SECURITY_EXCEPTION_V1');
      recognizedStdoutDiagnostics.add(index);
      recognizedStdoutDiagnostics.add(index + 1);
      index += 1;
    }
  }
  const stderrFailureDetails = [];
  const stderrFailureGrammars = [];
  const stderrLines = String(stderr).split(/\r?\n/u).filter((line) => line !== '');
  for (const line of stderrLines) {
    const failurePrefix = 'Failed to get storage stats, reason: ';
    const detail = normalizedSecurityDetail(line.startsWith(failurePrefix) ? line.slice(failurePrefix.length) : line);
    if (!detail) throw new Error(`unrecognized StorageStats stderr line: ${line.slice(0, 160)}`);
    stderrFailureDetails.push(detail);
    stderrFailureGrammars.push(line.startsWith(failurePrefix)
      ? 'API36_STORAGE_FAILURE_REASON_V1'
      : 'API36_COMMAND_SECURITY_EXCEPTION_V1');
  }
  if (status === 0) {
    if (diagnostics.length || String(stderr).trim() !== '') {
      throw new Error('successful StorageStats output contains an exception, diagnostic or stderr text');
    }
  } else {
    if (diagnostics.some((entry) => entry.index <= indices.get('cache'))) {
      throw new Error('StorageStats diagnostic appeared before all mandatory primary rows');
    }
    if (recognizedStdoutDiagnostics.size !== diagnostics.length || stdoutFailureDetails.length === 0) {
      const unrecognized = diagnostics.find((_entry, index) => !recognizedStdoutDiagnostics.has(index));
      throw new Error(unrecognized
        ? `unrecognized StorageStats diagnostic line: ${unrecognized.line.slice(0, 160)}`
        : 'StorageStats partial failure lacks a recognized post-primary stdout failure record');
    }
    const stdoutDetails = [...new Set(stdoutFailureDetails)];
    const stderrDetails = [...new Set(stderrFailureDetails)];
    const stdoutGrammars = [...new Set(stdoutFailureGrammars)];
    const stderrGrammars = [...new Set(stderrFailureGrammars)];
    if (stdoutDetails.length !== 1 || stderrDetails.length > 1
        || stdoutGrammars.length !== 1 || stderrGrammars.length > 1) {
      throw new Error('StorageStats SecurityException details are internally inconsistent');
    }
    if (stderrDetails.length && stderrDetails[0] !== stdoutDetails[0]) {
      throw new Error('StorageStats SecurityException details do not match across stdout and stderr');
    }
    if (stderrGrammars.length && stderrGrammars[0] !== stdoutGrammars[0]) {
      throw new Error('StorageStats SecurityException record grammar does not match across stdout and stderr');
    }
    optionalBreakdown = `PARTIAL_AFTER_PRIMARY_SECURITY_EXCEPTION:${stdoutGrammars[0]}`;
  }
  const [optionalBreakdownStatus, optionalBreakdownGrammar = null] = optionalBreakdown.split(':');
  return {
    code,
    data,
    cache,
    freshInstalledBytes: code + data,
    optionalBreakdown: optionalBreakdownStatus,
    optionalBreakdownGrammar,
  };
}

export function assessStableSamples(samples) {
  if (!Array.isArray(samples) || samples.length !== 2) throw new Error('exactly two StorageStats samples are required');
  const [first, second] = samples;
  const stable = first.code === second.code && first.data === second.data;
  const freshInstalledBytes = stable ? first.freshInstalledBytes : null;
  return {
    stable,
    freshInstalledBytes,
    localThresholdPass: stable ? freshInstalledBytes <= LIMIT_BYTES : null,
    status: stable ? 'LOCAL_ENGINEERING_MEASUREMENT' : 'UNSTABLE_UNPROVEN',
  };
}

export function validateFirstPlayableTiming({ boundaryUtc, installStartedUtc, installFinishedUtc, nowMs = null }) {
  const errors = [];
  const boundary = Date.parse(boundaryUtc ?? '');
  const started = Date.parse(installStartedUtc ?? '');
  const finished = Date.parse(installFinishedUtc ?? '');
  if (!Number.isFinite(boundary) || !Number.isFinite(started) || !Number.isFinite(finished)) {
    return ['install/first-playable timestamps are invalid'];
  }
  if (finished < started) errors.push('install finished before it started');
  if (boundary < finished) errors.push('first-playable boundary precedes install completion');
  if (nowMs !== null) {
    const age = nowMs - boundary;
    if (!Number.isFinite(nowMs) || age < 0) errors.push('first-playable boundary is in the future');
    else if (age > MAX_BOUNDARY_AGE_MS) errors.push(`first-playable boundary is stale by policy (${age} ms)`);
  }
  return errors;
}

function parseArgs(argv) {
  const values = {};
  const names = new Set([
    '--serial', '--user', '--package', '--expected-build-id', '--expected-artifact-sha256',
    '--first-ball-evidence', '--output-dir',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!names.has(name)) throw new Error(`unknown option ${name}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`);
    index += 1;
    values[name.slice(2).replaceAll('-', '_')] = value;
  }
  const required = ['serial', 'user', 'package', 'expected_build_id', 'expected_artifact_sha256', 'first_ball_evidence', 'output_dir'];
  for (const name of required) if (!values[name]) throw new Error(`--${name.replaceAll('_', '-')} is required`);
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(values.serial)) throw new Error('unsafe --serial');
  if (!/^[0-9]+$/u.test(values.user)) throw new Error('--user must be a non-negative integer');
  if (!/^[A-Za-z][A-Za-z0-9_.]{2,255}$/u.test(values.package)) throw new Error('unsafe --package');
  if (!BUILD_ID.test(values.expected_build_id)) throw new Error('invalid --expected-build-id');
  if (!SHA256.test(values.expected_artifact_sha256)) throw new Error('invalid --expected-artifact-sha256');
  values.first_ball_evidence = resolve(values.first_ball_evidence);
  values.output_dir = resolve(values.output_dir);
  return values;
}

function sourceBuildId() {
  return execFileSync(join(ROOT, 'scripts/build-id.sh'), [], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
}

function exactInventory(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readBoundRawRecord(root, record, label) {
  if (!record || typeof record !== 'object' || Array.isArray(record)
      || JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(['bytes', 'path', 'sha256'])) {
    throw new Error(`${label} record is not exact`);
  }
  if (typeof record.path !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/u.test(record.path)) {
    throw new Error(`${label} path is unsafe`);
  }
  const path = resolve(root, record.path);
  if (dirname(path) !== resolve(root) || !existsSync(path)) throw new Error(`${label} file is missing or outside the evidence directory`);
  const bytes = readFileSync(path);
  if (record.bytes !== String(bytes.length) || !SHA256.test(record.sha256 ?? '') || record.sha256 !== sha256Bytes(bytes)) {
    throw new Error(`${label} bytes or SHA-256 changed`);
  }
  return bytes;
}

function validateBoundStorageStatsRaw(firstBallRoot, measurement) {
  const parsedSamples = [];
  for (const sample of measurement.samples) {
    const label = `StorageStats sample ${sample.index}`;
    if (!Number.isInteger(sample.exitStatus)) throw new Error(`${label} exit status is invalid`);
    const stdout = readBoundRawRecord(firstBallRoot, sample.stdout, `${label} stdout`);
    const stderr = readBoundRawRecord(firstBallRoot, sample.stderr, `${label} stderr`);
    const status = readBoundRawRecord(firstBallRoot, sample.statusRecord, `${label} status`);
    if (status.toString('utf8') !== `${sample.exitStatus}\n`) throw new Error(`${label} status record does not match its exit status`);
    const parsed = parseStorageStats(stdout.toString('utf8'), {
      stderr: stderr.toString('utf8'),
      status: sample.exitStatus,
    });
    const expected = {
      code: parsed.code.toString(),
      data: parsed.data.toString(),
      cache: parsed.cache.toString(),
      freshInstalledBytes: parsed.freshInstalledBytes.toString(),
      optionalBreakdown: parsed.optionalBreakdown,
      optionalBreakdownGrammar: parsed.optionalBreakdownGrammar,
    };
    if (JSON.stringify(sample.parsed) !== JSON.stringify(expected)) throw new Error(`${label} parsed summary does not match its raw streams`);
    parsedSamples.push(parsed);
  }
  const assessment = assessStableSamples(parsedSamples);
  const expectedAssessment = {
    stableCodeAndData: assessment.stable,
    footprintStatus: assessment.status,
    freshInstalledBytes: assessment.freshInstalledBytes?.toString() ?? null,
    limitBytes: LIMIT_BYTES.toString(),
    localThresholdPass: assessment.localThresholdPass,
    cacheCountedAgain: false,
  };
  if (JSON.stringify(measurement.assessment) !== JSON.stringify(expectedAssessment)) {
    throw new Error('StorageStats assessment does not match its two raw samples');
  }
  if (!assessment.stable) throw new Error('StorageStats samples are unstable; no local measurement may be reported');
  return measurement;
}

export function validateFirstBallEvidence(options, evidence) {
  const errors = [];
  if (evidence?.schemaVersion !== 2) errors.push('schemaVersion is not 2');
  if (evidence?.harnessFinalStatus !== 'ACCEPTED') errors.push('first-ball harness was not finally accepted');
  if (!Array.isArray(evidence?.crashOrAnrLines) || evidence.crashOrAnrLines.length !== 0) {
    errors.push('first-ball harness recorded a crash or ANR');
  }
  if (evidence?.webErrorCount !== 0 || evidence?.nativeErrorCount !== 0) errors.push('first-ball harness recorded a web/native error');
  if (evidence?.packageId !== options.package) errors.push('package does not match');
  if (evidence?.serial !== options.serial) errors.push('serial does not match');
  if (String(evidence?.user) !== options.user) errors.push('user does not match');
  if (evidence?.buildId !== options.expected_build_id) errors.push('build ID does not match');
  if (evidence?.artifact?.sha256 !== options.expected_artifact_sha256) errors.push('artifact SHA-256 does not match');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(evidence?.runId ?? '')) errors.push('run ID is invalid');
  if (evidence?.sealedWrapperEvidence?.packageAbsentBeforeInstall !== true) errors.push('package absence before install was not bound');
  if (evidence?.sealedWrapperEvidence?.packageAbsencePolicy !== 'ANDROID_PM_PATH_ABSENT_EXIT_1_EMPTY_STREAMS_V1') errors.push('package-absence policy is not exact');
  if (evidence?.sealedWrapperEvidence?.installOperation !== 'adb -s <explicit serial> install -r <private immutable admitted APK>') errors.push('sealed install operation is not exact');
  if (evidence?.hooksPresent !== false) errors.push('test hooks were present');
  if (!['right', 'left'].includes(evidence?.handedness)) errors.push('top-level handedness is invalid');
  if (evidence?.handedness !== evidence?.stateBefore?.handedness
      || JSON.stringify(evidence?.viewport) !== JSON.stringify(evidence?.stateBefore?.viewport)) {
    errors.push('top-level handedness/viewport differs from the authoritative live observation');
  }
  if (evidence?.gameplayTapCount !== 1) errors.push('exactly one gameplay tap was not proven');
  if (evidence?.secondBallStarted !== false) errors.push('second ball started');
  if (evidence?.lifecycleOrPerformanceModeUsed !== false) errors.push('lifecycle/performance mode was used');
  if (!Array.isArray(evidence?.outOfBandAppDataOperations) || evidence.outOfBandAppDataOperations.length !== 0) errors.push('out-of-band app-data operation is recorded');
  if (evidence?.stableBoundary?.saved?.balls !== 1 || evidence?.stableBoundary?.saved?.records !== 1 || evidence?.stableBoundary?.saved?.inFlight !== null) {
    errors.push('stable first-ball boundary is invalid');
  }
  if (!exactInventory(evidence?.installedPackageInventoryBefore, evidence?.installedPackageInventoryAfter)) errors.push('installed package inventory changed during first-ball evidence');
  if (validateAndroidDeviceIdentity(evidence?.deviceIdentity).length) errors.push('canonical Android device identity is invalid');
  if (!sameAndroidDeviceIdentity(evidence?.deviceIdentity, evidence?.sealedWrapperEvidence?.deviceIdentity)) errors.push('first-ball device identity does not match install identity');
  if (!evidence?.packageInstallIdentity?.firstInstallTime
      || evidence.packageInstallIdentity.firstInstallTime !== evidence.packageInstallIdentity.lastUpdateTime) {
    errors.push('fresh package install time identity is invalid');
  }
  const wrapperNames = [
    'adbIsolation', 'admission', 'preinstallStdout', 'preinstallStderr', 'preinstallStatus', 'packageAbsence',
    'unityPayloadBindingAdmissionFile', 'unityPayloadBindingAdmissionSourceBracketFile',
    'unityPayloadBindingPreinstallRecheckFile', 'unityPayloadBindingPreinstallSourceBracketFile',
    'unityPayloadBindingFinalRecheckFile', 'unityPayloadBindingFinalSourceBracketFile',
    'preinstallDeviceIdentity', 'preinstallArtifactCheck', 'installArtifactFinalCheck',
    'installArtifactPostCheck', 'postInstallPackageInventory',
    'installTransactionStart', 'installStdout', 'installStderr', 'installStatus', 'installTransaction',
  ];
  const firstBallRoot = dirname(options.first_ball_evidence);
  for (const name of wrapperNames) {
    const record = evidence?.sealedWrapperEvidence?.[name];
    const path = typeof record?.path === 'string' ? resolve(record.path) : null;
    if (!path || !path.startsWith(`${firstBallRoot}/`) || !SHA256.test(record.sha256 ?? '') || !existsSync(path) || sha256File(path) !== record.sha256) {
      errors.push(`sealed wrapper evidence ${name} is missing or changed`);
    }
  }
  let installTransaction = null;
  if (!errors.length) {
    const absence = JSON.parse(readFileSync(evidence.sealedWrapperEvidence.packageAbsence.path, 'utf8'));
    const absenceErrors = validatePackageAbsenceReceipt(absence);
    if (absenceErrors.length) errors.push(`package-absence receipt rejected: ${absenceErrors.join(', ')}`);
    const installStart = JSON.parse(readFileSync(evidence.sealedWrapperEvidence.installTransactionStart.path, 'utf8'));
    installTransaction = JSON.parse(readFileSync(evidence.sealedWrapperEvidence.installTransaction.path, 'utf8'));
    const installErrors = validateInstallTransaction({
      start: installStart,
      transaction: installTransaction,
      expected: {
        serial: options.serial,
        packageId: options.package,
        buildId: options.expected_build_id,
        artifactSha256: options.expected_artifact_sha256,
      },
    });
    if (installErrors.length) errors.push(`install transaction rejected: ${installErrors.join(', ')}`);
    if (!exactInventory(evidence.installedPackageInventoryBefore, installTransaction.installedPackageInventory)
        || !exactInventory(evidence.installedPackageInventoryAfter, installTransaction.installedPackageInventory)) {
      errors.push('first-ball inventory does not match the exact post-install transaction inventory');
    }
    if (evidence.runId !== installTransaction.runId
        || JSON.stringify(evidence.installTransaction) !== JSON.stringify(installTransaction)
        || JSON.stringify(evidence.sealedWrapperEvidence.installTransactionReceipt) !== JSON.stringify(installTransaction)) {
      errors.push('first-ball receipt does not embed the exact install transaction');
    }
    errors.push(...validateGateAUnityEvidenceFromFirstBall({
      receipt: evidence,
      evidenceRoot: firstBallRoot,
      expectedBuildId: options.expected_build_id,
      expectedApkSha256: options.expected_artifact_sha256,
    }));
  }
  for (const [name, record] of [['live frame', evidence?.liveFrame], ['dead-ball frame', evidence?.deadBallFrame], ['timeline', evidence?.timeline]]) {
    const path = record?.path ? resolve(firstBallRoot, record.path) : null;
    if (!path || !path.startsWith(`${firstBallRoot}/`) || !SHA256.test(record?.sha256 ?? '') || !existsSync(path) || sha256File(path) !== record.sha256) {
      errors.push(`${name} is missing, unsafe or changed`);
    }
  }
  if (!errors.length) {
    const bracketErrors = validateGateACaptureThenTapReceipt(evidence.captureThenTap, {
      before: evidence.stateBefore,
      after: evidence.stateAfter,
      dead: evidence.deadState,
      expectedBuildId: options.expected_build_id,
      expectedRunId: evidence.runId,
      expectedSerial: evidence.serial,
      expectedAdbEndpoint: evidence.adbServer,
      expectedLiveFrame: evidence.liveFrame,
    });
    const liveFramePath = resolve(firstBallRoot, evidence.liveFrame.path);
    const liveFrameBytes = readFileSync(liveFramePath);
    if (evidence.liveFrame.bytes !== String(liveFrameBytes.length)) {
      errors.push('live-frame byte length differs from the capture receipt');
    }
    const liveFramePng = gateAPngDimensions(liveFrameBytes);
    if (JSON.stringify(liveFramePng) !== JSON.stringify(evidence.liveFrame.png)) {
      errors.push('live-frame PNG is undecodable or its dimensions differ from the capture receipt');
    }
    const deadErrors = validateFirstBallTransition(evidence.stateBefore, evidence.deadState, { tapCount: evidence.gameplayTapCount });
    const stableErrors = validateFirstBallTransition(evidence.stateBefore, evidence.stableBoundary, { tapCount: evidence.gameplayTapCount });
    if (bracketErrors.length) errors.push(`capture-then-tap receipt rejected: ${bracketErrors.join(', ')}`);
    if (deadErrors.length) errors.push(`dead-ball transition rejected: ${deadErrors.join(', ')}`);
    if (stableErrors.length) errors.push(`stable transition rejected: ${stableErrors.join(', ')}`);
    if (JSON.stringify(evidence.deadState.saved) !== JSON.stringify(evidence.stableBoundary.saved)) errors.push('dead/stable saved state differs');
    if (evidence.measuredBoundaryUtc !== evidence.stableBoundary.utc) errors.push('measured boundary UTC does not match stable observation');
    const timelinePath = resolve(firstBallRoot, evidence.timeline.path);
    const timeline = readFileSync(timelinePath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const expectedTimeline = [evidence.stateBefore, evidence.stateAfter, evidence.deadState, evidence.stableBoundary];
    if (timeline.length !== expectedTimeline.length
        || timeline.some((entry, index) => JSON.stringify(entry) !== JSON.stringify(expectedTimeline[index]))) {
      errors.push('state timeline does not exactly reproduce the bracket and transition');
    }
    errors.push(...validateFirstPlayableTiming({
      boundaryUtc: evidence.measuredBoundaryUtc,
      installStartedUtc: installTransaction.startedUtc,
      installFinishedUtc: installTransaction.finishedUtc,
    }));
    try {
      validateBracketedStorageStatsMeasurement(evidence.bracketedStorageStats, {
        packageId: options.package,
        serial: options.serial,
        user: options.user,
        buildId: options.expected_build_id,
        artifactSha256: options.expected_artifact_sha256,
        runId: evidence.runId,
        stableSavedState: evidence.stableBoundary.saved,
        stableBoundaryEpoch: evidence.stableBoundaryEpoch,
        expectedPackageInstallIdentity: evidence.packageInstallIdentity,
      });
      if (BigInt(evidence.stableBoundaryEpoch.hostMonotonicNs)
          <= BigInt(evidence.stableBoundary.hostMonotonicNs)) {
        errors.push('stable package-data epoch does not follow the stable first-playable observation');
      }
      if (Date.parse(evidence.stableBoundaryEpoch.utc) < Date.parse(evidence.stableBoundary.utc)) {
        errors.push('stable package-data epoch UTC precedes the stable first-playable observation');
      }
      if (BigInt(evidence.bracketedStorageStats.boundaryEpoch.hostMonotonicNs)
          <= BigInt(evidence.stableBoundary.hostMonotonicNs)) {
        errors.push('StorageStats boundary does not follow the stable first-playable observation');
      }
      if (Date.parse(evidence.bracketedStorageStats.boundaryEpoch.utc) < Date.parse(evidence.stableBoundary.utc)) {
        errors.push('StorageStats boundary UTC precedes the stable first-playable observation');
      }
      validateBoundStorageStatsRaw(firstBallRoot, evidence.bracketedStorageStats);
    } catch (error) {
      errors.push(`bracketed StorageStats evidence rejected: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (errors.length) throw new Error(`first-playable evidence rejected: ${errors.join('; ')}`);
  return {
    inventory: evidence.installedPackageInventoryAfter,
    deviceIdentity: evidence.deviceIdentity,
    installTransaction,
    packageInstallIdentity: evidence.packageInstallIdentity,
    boundaryUtc: evidence.measuredBoundaryUtc,
    stableBoundaryEpoch: evidence.stableBoundaryEpoch,
    bracketedStorageStats: evidence.bracketedStorageStats,
    unityPayloadBinding: evidence.unityPayloadBinding,
  };
}

function writeNew(path, value) {
  writeFileSync(path, value, { flag: 'wx', mode: 0o600 });
}

export function measureInstalledSize(options) {
  if (!existsSync(options.first_ball_evidence)) throw new Error(`first-ball evidence is missing: ${options.first_ball_evidence}`);
  if (existsSync(options.output_dir)) throw new Error(`output directory already exists: ${options.output_dir}`);
  const startedUtc = new Date().toISOString();
  const hostUptime = execFileSync('uptime', [], { encoding: 'utf8' }).trim();

  const evidenceBytes = readFileSync(options.first_ball_evidence);
  const evidence = JSON.parse(evidenceBytes.toString('utf8'));
  const binding = validateFirstBallEvidence(options, evidence);
  const currentSourceId = sourceBuildId();
  if (currentSourceId !== options.expected_build_id) throw new Error(`current source ${currentSourceId} does not match expected build ${options.expected_build_id}`);
  if (sourceBuildId() !== currentSourceId) throw new Error('source identity changed while validating bracketed StorageStats evidence');
  const measurement = binding.bracketedStorageStats;

  const report = {
    schemaVersion: 1,
    classification: options.serial.startsWith('emulator-') ? 'LOCAL_ENGINEERING_ONLY' : 'DEVICE_ENGINEERING_EVIDENCE_ONLY',
    size50Status: 'UNPROVEN',
    reach90Status: 'UNPROVEN',
    limitation: 'A local code+data observation does not replace production-AAB Play splits or representative physical-device cohort evidence.',
    startedUtc,
    finishedUtc: new Date().toISOString(),
    hostUptime,
    sourceBuildId: currentSourceId,
    serial: options.serial,
    user: options.user,
    packageId: options.package,
    artifactSha256: options.expected_artifact_sha256,
    firstBallEvidence: { path: options.first_ball_evidence, sha256: sha256Bytes(evidenceBytes) },
    rawEvidenceRoot: dirname(options.first_ball_evidence),
    runId: binding.installTransaction.runId,
    installTransaction: binding.installTransaction,
    firstPlayableBoundaryUtc: binding.boundaryUtc,
    measurementCapturedInsideFirstBallHarness: true,
    laterDeviceSamplingPerformed: false,
    deviceIdentity: binding.deviceIdentity,
    installedPackageInventory: binding.inventory,
    packageInstallIdentity: binding.packageInstallIdentity,
    stableBoundaryEpoch: binding.stableBoundaryEpoch,
    unityPayloadBinding: binding.unityPayloadBinding,
    command: measurement.command,
    boundaryEpoch: measurement.boundaryEpoch,
    samples: measurement.samples,
    finalEpoch: measurement.finalEpoch,
    assessment: measurement.assessment,
  };
  mkdirSync(options.output_dir, { recursive: false, mode: 0o700 });
  writeNew(join(options.output_dir, 'installed-size.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = measureInstalledSize(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify({
      status: report.assessment.footprintStatus,
      classification: report.classification,
      freshInstalledBytes: report.assessment.freshInstalledBytes,
      localThresholdPass: report.assessment.localThresholdPass,
      size50Status: report.size50Status,
    }));
    if (!report.assessment.stableCodeAndData) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
