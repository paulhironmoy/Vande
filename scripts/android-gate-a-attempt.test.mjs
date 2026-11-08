#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createGateACaptureAttempt,
  createGateACaptureReceiptCandidate,
  finalizeGateACaptureAttempt,
  GATE_A_RAW_EVIDENCE_MAX_BYTES,
  gateAEvidenceFileRecord,
  recordGateACaptureAttemptCheckpoint,
  recordGateACaptureAttemptError,
  writeFinalGateACaptureAttempt,
  writeGateABoundedRawEvidence,
  writeInitialGateACaptureAttempt,
} from './android-gate-a-attempt.mjs';
import {
  decodeGateACaptureThenTapOutput,
  GATE_A_CAPTURE_THEN_TAP_CLASSIFICATION,
  GATE_A_CAPTURE_THEN_TAP_OPERATIONS,
  GATE_A_CAPTURE_THEN_TAP_STATUS,
  GATE_A_CAPTURE_THEN_TAP_SUCCESS_DERIVATION,
  GATE_A_CAPTURE_THEN_TAP_SUCCESS_MARKER,
  parseGateACaptureThenTapOutput,
} from './android-gate-a.mjs';

const runId = '123e4567-e89b-42d3-a456-426614174000';
const serial = '127.0.0.1:5595';
const buildId = '38924bd+0123456789ab';
const remotePath = `/data/local/tmp/vande-gate-a-${runId}/live-frame.png`;
const remoteHash = 'a'.repeat(64);
const validTransactionText = [
  'device-uptime-after-tap=100.12 200.12',
  'bytes=4096',
  `${remoteHash}  ${remotePath}`,
  'transaction-status=0',
  GATE_A_CAPTURE_THEN_TAP_SUCCESS_MARKER,
].join('\n');
const validTransactionBytes = Buffer.from(validTransactionText);

const failureCases = [
  { name: 'outer nonzero', stage: 'ATOMIC_OUTER_NONZERO', txStatus: 1 },
  { name: 'nonempty transaction stderr', stage: 'ATOMIC_STDERR', txStderr: Buffer.from('shell failure\n') },
  {
    name: 'malformed marker', stage: 'ATOMIC_MARKER',
    txStdout: Buffer.from(validTransactionText.replace(GATE_A_CAPTURE_THEN_TAP_SUCCESS_MARKER, 'WRONG_MARKER')),
  },
  { name: 'invalid UTF-8', stage: 'ATOMIC_UTF8', txStdout: Buffer.from([0xc3, 0x28]) },
  { name: 'NUL transaction output', stage: 'ATOMIC_NUL', txStdout: Buffer.from(`prefix\0${validTransactionText}`) },
  { name: 'oversize transaction output', stage: 'ATOMIC_OVERSIZE', txStdout: Buffer.alloc(1_025, 0x61) },
  { name: 'malformed PNG', stage: 'PNG_MALFORMED', terminalProven: true, pullStdout: Buffer.from('not-a-png') },
  { name: 'mismatched PNG', stage: 'PNG_MISMATCH', terminalProven: true, pullStdout: Buffer.from('different-capture') },
  { name: 'empty PNG', stage: 'PNG_EMPTY', terminalProven: true, pullStdout: Buffer.alloc(0) },
  { name: 'pull nonzero', stage: 'PNG_PULL_NONZERO', terminalProven: true, pullStatus: 1 },
  {
    name: 'pull stderr', stage: 'PNG_PULL_STDERR', terminalProven: true,
    pullStderr: Buffer.from('remote read failed\n'),
  },
  {
    name: 'pull ENOBUFS partial output', stage: 'PNG_PULL_TRUNCATED', terminalProven: true,
    pullStdout: Buffer.alloc(8 * 1024 * 1024 + 65_536, 0x5a),
    pullError: { name: 'Error', message: 'spawnSync adb ENOBUFS', code: 'ENOBUFS' },
  },
  { name: 'identity mismatch', stage: 'POST_TRANSACTION_IDENTITY', terminalProven: true },
  { name: 'resolution timeout', stage: 'SAVED_RESOLUTION', terminalProven: true },
  { name: 'dead timeout', stage: 'DEAD_PHASE', terminalProven: true },
  { name: 'missing native events', stage: 'NATIVE_EVENTS', terminalProven: true },
  { name: 'validator exception', stage: 'INITIAL_VALIDATION', terminalProven: true },
];

function initialReceipt({ txStatus, txStdoutFile, txStderrFile }) {
  return {
    schemaVersion: 2,
    status: null,
    classification: null,
    runId,
    serial,
    adbEndpoint: { host: '127.0.0.1', port: 5040 },
    buildId,
    deliveryId: 'delivery-1',
    viewport: { pageEpoch: 1, physicalPixels: { width: 844, height: 390 } },
    tapCoordinatePhysicalPixels: { x: 422, y: 320 },
    coordinateRule: 'x=round(width*0.5);y=round(height*0.82)',
    operationOrder: null,
    remoteShellCommand: `screencap -p ${remotePath} && input touchscreen tap 422 320`,
    remoteShellTransactionCount: 1,
    gameplayTapCount: null,
    startedUtc: '2026-10-29T10:00:00.000Z',
    finishedUtc: '2026-10-29T10:00:00.125Z',
    startedHostMonotonicNs: '1000000000',
    finishedHostMonotonicNs: '1125000000',
    successMarker: null,
    successMarkerObservedCount: null,
    successDerivation: null,
    adbShellResult: {
      exitStatus: txStatus,
      stderrBytes: txStderrFile.bytes,
      stderrSha256: txStderrFile.sha256,
    },
    transactionOutput: { utf8: null, bytes: txStdoutFile.bytes, sha256: txStdoutFile.sha256 },
    deviceUptimeAfterTap: null,
    remoteCapture: { path: null, bytes: null, sha256: null, png: null },
    nativeListenerRegistration: null,
    nativeEventDropCounts: { events: null, registrations: null },
    nativeDeliveryEvents: [],
    liveFrame: null,
  };
}

function replayRecord(directory, record) {
  return gateAEvidenceFileRecord(join(directory, record.path), record.path);
}

for (const injected of failureCases) {
  test(`raw Gate-A evidence remains complete and rejected after ${injected.name}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'vande-gate-a-attempt-'));
    const paths = {
      initial: join(directory, 'capture-then-tap-attempt.json'),
      journal: join(directory, 'capture-then-tap-attempt-journal.ndjson'),
      final: join(directory, 'capture-then-tap-attempt-final.json'),
      txStdout: join(directory, 'capture-then-tap-transaction.stdout.bin'),
      txStderr: join(directory, 'capture-then-tap-transaction.stderr.bin'),
      pullStdout: join(directory, 'capture-then-tap-remote-capture.bin'),
      pullStderr: join(directory, 'capture-then-tap-remote-capture.stderr.bin'),
      report: join(directory, 'android-gate-a-test.json'),
      manifest: join(directory, 'evidence-manifest.json'),
    };
    const txStdout = injected.txStdout ?? validTransactionBytes;
    const txStderr = injected.txStderr ?? Buffer.alloc(0);
    const txStatus = injected.txStatus ?? 0;
    const txStdoutFile = writeGateABoundedRawEvidence(paths.txStdout, txStdout);
    const txStderrFile = writeGateABoundedRawEvidence(paths.txStderr, txStderr);
    const rawTransaction = {
      schemaVersion: 1,
      status: 'ADB_SHELL_TRANSACTION_RETURNED_RAW_RETAINED',
      remoteShellCommand: `screencap -p ${remotePath} && input touchscreen tap 422 320`,
      tapCoordinatePhysicalPixels: { x: 422, y: 320 },
      intendedOperationOrder: ['screencap-png', 'input-touchscreen-tap'],
      remoteShellTransactionCount: 1,
      startedUtc: '2026-10-29T10:00:00.000Z',
      finishedUtc: '2026-10-29T10:00:00.125Z',
      startedHostMonotonicNs: '1000000000',
      finishedHostMonotonicNs: '1125000000',
      outerProcess: {
        exitStatus: txStatus, signal: null, error: null, timedOut: false,
        maxBufferExceeded: false, processComplete: true,
      },
      stdoutFile: txStdoutFile,
      stderrFile: txStderrFile,
    };
    let candidate = createGateACaptureReceiptCandidate({
      receipt: initialReceipt({ txStatus, txStdoutFile, txStderrFile }),
      rawTransaction,
    });
    const envelope = createGateACaptureAttempt({
      runId,
      serial,
      buildId,
      atomicTransaction: rawTransaction,
      stateBefore: { phase: 'live', deliveryId: 'delivery-1', viewport: { pageEpoch: 1 } },
      captureThenTapCandidate: candidate,
      recordedUtc: '2026-10-29T10:00:00.126Z',
    });
    const initialRecord = writeInitialGateACaptureAttempt(paths.initial, envelope);
    const immutableInitial = readFileSync(paths.initial);

    const pullStdout = injected.pullStdout ?? Buffer.from('raw-capture-bytes');
    const pullStderr = injected.pullStderr ?? Buffer.alloc(0);
    const pullStdoutFile = writeGateABoundedRawEvidence(paths.pullStdout, pullStdout);
    const pullStderrFile = writeGateABoundedRawEvidence(paths.pullStderr, pullStderr);
    const rawCaptureBinding = {
      schemaVersion: 1,
      status: 'RAW_REMOTE_CAPTURE_PULL_RETURNED_AND_RETAINED',
      exitStatus: injected.pullStatus ?? 0,
      signal: null,
      error: injected.pullError ?? null,
      timedOut: false,
      maxBufferExceeded: injected.pullError?.code === 'ENOBUFS',
      processComplete: injected.pullError == null,
      stdoutFile: pullStdoutFile,
      stderrFile: pullStderrFile,
    };
    candidate.rawCaptureBinding = structuredClone(rawCaptureBinding);
    if (injected.terminalProven) {
      const decoded = decodeGateACaptureThenTapOutput(txStdout);
      const parsed = parseGateACaptureThenTapOutput(decoded, remotePath);
      assert.ok(parsed, injected.name);
      Object.assign(candidate.receipt, {
        status: GATE_A_CAPTURE_THEN_TAP_STATUS,
        classification: GATE_A_CAPTURE_THEN_TAP_CLASSIFICATION,
        operationOrder: [...GATE_A_CAPTURE_THEN_TAP_OPERATIONS],
        gameplayTapCount: 1,
        successMarker: GATE_A_CAPTURE_THEN_TAP_SUCCESS_MARKER,
        successMarkerObservedCount: 1,
        successDerivation: GATE_A_CAPTURE_THEN_TAP_SUCCESS_DERIVATION,
        transactionOutput: parsed.transactionOutput,
        deviceUptimeAfterTap: parsed.deviceUptimeAfterTap,
        remoteCapture: { ...parsed.remoteCapture, png: null },
      });
    }
    recordGateACaptureAttemptCheckpoint(envelope, paths.journal, {
      stage: 'RAW_REMOTE_CAPTURE_RETAINED',
      patch: { rawCapturePull: rawCaptureBinding, captureThenTapCandidate: candidate },
      utc: '2026-10-29T10:00:00.200Z',
    });
    recordGateACaptureAttemptError(envelope, paths.journal, {
      stage: injected.stage,
      error: new Error(`injected ${injected.name}`),
      utc: '2026-10-29T10:00:00.300Z',
    });
    candidate = structuredClone(envelope.captureThenTapCandidate);
    candidate.status = 'REJECTED';
    candidate.finalDrain = {
      recordedUtc: '2026-10-29T10:00:00.350Z',
      nativeDeliveryEvents: [],
      nativeListenerRegistration: null,
      nativeEventDropCounts: { events: 0, registrations: 0 },
      nativeErrors: [],
      webErrors: [],
    };
    candidate.receipt.nativeDeliveryEvents = [];
    candidate.receipt.nativeEventDropCounts = { events: 0, registrations: 0 };
    candidate.validatorErrors.push(`rejected ${injected.name}`);
    recordGateACaptureAttemptCheckpoint(envelope, paths.journal, {
      stage: 'FINAL_DRAIN_COMPLETE',
      patch: {
        captureThenTapCandidate: candidate,
        finalCaptureThenTap: structuredClone(candidate.receipt),
        finalValidationStatus: 'REJECTED',
        finalValidationErrors: [...candidate.validatorErrors],
      },
      utc: '2026-10-29T10:00:00.350Z',
    });
    finalizeGateACaptureAttempt(envelope, paths.journal, {
      status: 'REJECTED',
      failure: `injected ${injected.name}`,
      utc: '2026-10-29T10:00:00.400Z',
    });
    const finalRecord = writeFinalGateACaptureAttempt(paths.final, envelope);
    assert.deepEqual(readFileSync(paths.initial), immutableInitial, `${injected.name}: immutable initial changed`);

    const journalRecord = gateAEvidenceFileRecord(paths.journal);
    const report = {
      schemaVersion: 1,
      finishedUtc: '2026-10-29T10:00:00.401Z',
      gateAFirstBallEvidence: { harnessFinalStatus: 'REJECTED' },
      gateACaptureThenTapAttempt: envelope,
      gateACaptureThenTapAttemptFiles: {
        initial: initialRecord,
        transactionStdout: txStdoutFile,
        transactionStderr: txStderrFile,
        rawCapture: pullStdoutFile,
        rawCaptureStderr: pullStderrFile,
        journal: journalRecord,
        final: finalRecord,
      },
    };
    writeFileSync(paths.report, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    const reportRecord = gateAEvidenceFileRecord(paths.report);
    const manifest = {
      schemaVersion: 1,
      status: 'GATE_A_EVIDENCE_MANIFEST_COMPLETE',
      files: [initialRecord, txStdoutFile, txStderrFile, pullStdoutFile, pullStderrFile, journalRecord, finalRecord, reportRecord],
    };
    writeFileSync(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });

    const initial = JSON.parse(readFileSync(paths.initial, 'utf8'));
    const final = JSON.parse(readFileSync(paths.final, 'utf8'));
    const replayedManifest = JSON.parse(readFileSync(paths.manifest, 'utf8'));
    assert.equal(initial.status, 'CAPTURE_THEN_TAP_TRANSACTION_RETURNED_RAW_RETAINED');
    assert.equal(initial.captureThenTapCandidate.schemaVersion, 2);
    assert.equal(final.harnessFinalStatus, 'REJECTED');
    assert.equal(final.captureThenTapCandidate.status, 'REJECTED');
    assert.equal(final.captureThenTapCandidate.schemaVersion, 2);
    assert.equal(final.captureThenTapCandidate.rawCaptureBinding.status, 'RAW_REMOTE_CAPTURE_PULL_RETURNED_AND_RETAINED');
    assert.equal(final.finalCaptureThenTap.schemaVersion, 2);
    assert.deepEqual(readFileSync(paths.txStdout), txStdout, `${injected.name}: transaction stdout not reversible`);
    assert.deepEqual(readFileSync(paths.txStderr), txStderr, `${injected.name}: transaction stderr not reversible`);
    assert.deepEqual(readFileSync(paths.pullStdout), pullStdout, `${injected.name}: pull stdout not reversible`);
    assert.deepEqual(readFileSync(paths.pullStderr), pullStderr, `${injected.name}: pull stderr not reversible`);
    for (const path of [paths.txStdout, paths.txStderr, paths.pullStdout, paths.pullStderr]) {
      assert.equal(statSync(path).mode & 0o777, 0o600, `${injected.name}: raw mode`);
    }
    if (!injected.terminalProven) {
      assert.equal(final.finalCaptureThenTap.status, null);
      assert.equal(final.finalCaptureThenTap.gameplayTapCount, null);
      assert.equal(final.finalCaptureThenTap.successMarker, null);
      assert.equal(final.finalCaptureThenTap.successMarkerObservedCount, null);
      assert.equal(final.finalCaptureThenTap.successDerivation, null);
      assert.equal(final.finalCaptureThenTap.deviceUptimeAfterTap, null);
      assert.deepEqual(final.finalCaptureThenTap.remoteCapture, { path: null, bytes: null, sha256: null, png: null });
    }
    const journal = readFileSync(paths.journal, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(journal.map((entry) => entry.sequence), [0, 1, 2, 3]);
    assert.ok(journal.every((entry, index) => index === 0 || Date.parse(entry.utc) >= Date.parse(journal[index - 1].utc)));
    assert.ok(Date.parse(journal.at(-1).utc) > Date.parse(journal.at(-2).utc));
    assert.ok(Date.parse(report.finishedUtc) > Date.parse(final.finalizedUtc));
    for (const record of replayedManifest.files) assert.deepEqual(replayRecord(directory, record), record);
    assert.throws(() => writeGateABoundedRawEvidence(paths.pullStdout, Buffer.from('overwrite')), /EEXIST/u);
  });
}

test('exact successful final drain preserves raw evidence and can be accepted once', () => {
  const directory = mkdtempSync(join(tmpdir(), 'vande-gate-a-success-'));
  const paths = {
    initial: join(directory, 'capture-then-tap-attempt.json'),
    journal: join(directory, 'capture-then-tap-attempt-journal.ndjson'),
    final: join(directory, 'capture-then-tap-attempt-final.json'),
    txStdout: join(directory, 'capture-then-tap-transaction.stdout.bin'),
    txStderr: join(directory, 'capture-then-tap-transaction.stderr.bin'),
    pullStdout: join(directory, 'capture-then-tap-remote-capture.bin'),
    pullStderr: join(directory, 'capture-then-tap-remote-capture.stderr.bin'),
  };
  const rawPng = Buffer.from('exact-validated-png-bytes');
  const txStdoutFile = writeGateABoundedRawEvidence(paths.txStdout, validTransactionBytes);
  const txStderrFile = writeGateABoundedRawEvidence(paths.txStderr, Buffer.alloc(0));
  const rawTransaction = {
    schemaVersion: 1,
    status: 'ADB_SHELL_TRANSACTION_RETURNED_RAW_RETAINED',
    remoteShellCommand: `screencap -p ${remotePath} && input touchscreen tap 422 320`,
    tapCoordinatePhysicalPixels: { x: 422, y: 320 },
    intendedOperationOrder: ['screencap-png', 'input-touchscreen-tap'],
    remoteShellTransactionCount: 1,
    startedUtc: '2026-10-29T10:00:00.000Z',
    finishedUtc: '2026-10-29T10:00:00.125Z',
    startedHostMonotonicNs: '1000000000',
    finishedHostMonotonicNs: '1125000000',
    outerProcess: {
      exitStatus: 0, signal: null, error: null, timedOut: false,
      maxBufferExceeded: false, processComplete: true,
    },
    stdoutFile: txStdoutFile,
    stderrFile: txStderrFile,
  };
  let candidate = createGateACaptureReceiptCandidate({
    receipt: initialReceipt({ txStatus: 0, txStdoutFile, txStderrFile }),
    rawTransaction,
  });
  const envelope = createGateACaptureAttempt({
    runId,
    serial,
    buildId,
    atomicTransaction: rawTransaction,
    stateBefore: { phase: 'live', deliveryId: 'delivery-1', viewport: { pageEpoch: 1 } },
    captureThenTapCandidate: candidate,
    recordedUtc: '2026-10-29T10:00:00.126Z',
  });
  writeInitialGateACaptureAttempt(paths.initial, envelope);
  const immutableInitial = readFileSync(paths.initial);

  const rawCaptureFile = writeGateABoundedRawEvidence(paths.pullStdout, rawPng);
  const rawCaptureStderrFile = writeGateABoundedRawEvidence(paths.pullStderr, Buffer.alloc(0));
  const rawCaptureBinding = {
    schemaVersion: 1,
    status: 'RAW_REMOTE_CAPTURE_PULL_RETURNED_AND_RETAINED',
    exitStatus: 0,
    signal: null,
    error: null,
    timedOut: false,
    maxBufferExceeded: false,
    processComplete: true,
    stdoutFile: rawCaptureFile,
    stderrFile: rawCaptureStderrFile,
  };
  candidate.rawCaptureBinding = structuredClone(rawCaptureBinding);
  recordGateACaptureAttemptCheckpoint(envelope, paths.journal, {
    stage: 'RAW_REMOTE_CAPTURE_RETAINED',
    patch: { rawCapturePull: rawCaptureBinding, captureThenTapCandidate: candidate },
    utc: '2026-10-29T10:00:00.200Z',
  });

  const parsed = parseGateACaptureThenTapOutput(
    decodeGateACaptureThenTapOutput(readFileSync(paths.txStdout)),
    remotePath,
  );
  Object.assign(candidate.receipt, {
    status: GATE_A_CAPTURE_THEN_TAP_STATUS,
    classification: GATE_A_CAPTURE_THEN_TAP_CLASSIFICATION,
    operationOrder: [...GATE_A_CAPTURE_THEN_TAP_OPERATIONS],
    gameplayTapCount: 1,
    successMarker: GATE_A_CAPTURE_THEN_TAP_SUCCESS_MARKER,
    successMarkerObservedCount: 1,
    successDerivation: GATE_A_CAPTURE_THEN_TAP_SUCCESS_DERIVATION,
    transactionOutput: parsed.transactionOutput,
    deviceUptimeAfterTap: parsed.deviceUptimeAfterTap,
    remoteCapture: { ...parsed.remoteCapture, png: { width: 844, height: 390 } },
    nativeListenerRegistration: { epoch: 1, listenerId: 'listener-1' },
    nativeEventDropCounts: { events: 0, registrations: 0 },
    nativeDeliveryEvents: [
      { epoch: 1, operationId: 'op-1', type: 'unity.release', sequence: 1, deliveryId: 'delivery-1' },
      { epoch: 1, operationId: 'op-1', type: 'unity.pointer', sequence: 2, deliveryId: 'delivery-1' },
      { epoch: 1, operationId: 'op-1', type: 'unity.gesture', sequence: 3, deliveryId: 'delivery-1' },
      { epoch: 1, operationId: 'op-1', type: 'unity.dead', sequence: 4, deliveryId: 'delivery-1' },
    ],
    liveFrame: {
      path: 'live-frame.png', bytes: String(rawPng.length),
      sha256: rawCaptureFile.sha256, png: { width: 844, height: 390 },
    },
  });
  candidate.status = 'ACCEPTED_PENDING_GATE_RESOLUTION';
  candidate.validatorErrors = [];
  candidate.finalDrain = {
    recordedUtc: '2026-10-29T10:00:00.300Z',
    nativeDeliveryEvents: structuredClone(candidate.receipt.nativeDeliveryEvents),
    nativeListenerRegistration: structuredClone(candidate.receipt.nativeListenerRegistration),
    nativeEventDropCounts: structuredClone(candidate.receipt.nativeEventDropCounts),
    nativeErrors: [],
    webErrors: [],
  };
  recordGateACaptureAttemptCheckpoint(envelope, paths.journal, {
    stage: 'FINAL_DRAIN_COMPLETE',
    patch: {
      captureThenTapCandidate: candidate,
      finalCaptureThenTap: structuredClone(candidate.receipt),
      finalValidationStatus: 'ACCEPTED',
      finalValidationErrors: [],
    },
    utc: '2026-10-29T10:00:00.300Z',
  });
  finalizeGateACaptureAttempt(envelope, paths.journal, {
    status: 'ACCEPTED',
    utc: '2026-10-29T10:00:00.301Z',
  });
  writeFinalGateACaptureAttempt(paths.final, envelope);

  const initial = JSON.parse(readFileSync(paths.initial, 'utf8'));
  const final = JSON.parse(readFileSync(paths.final, 'utf8'));
  assert.deepEqual(readFileSync(paths.initial), immutableInitial);
  assert.equal(initial.captureThenTapCandidate.receipt.gameplayTapCount, null);
  assert.equal(initial.captureThenTapCandidate.receipt.successMarker, null);
  assert.equal(final.harnessFinalStatus, 'ACCEPTED');
  assert.equal(final.captureThenTapCandidate.status, 'ACCEPTED');
  assert.equal(final.finalValidationStatus, 'ACCEPTED');
  assert.deepEqual(final.finalValidationErrors, []);
  assert.deepEqual(final.finalCaptureThenTap, candidate.receipt);
  assert.deepEqual(readFileSync(paths.txStdout), validTransactionBytes);
  assert.deepEqual(readFileSync(paths.pullStdout), rawPng);
  for (const record of [txStdoutFile, txStderrFile, rawCaptureFile, rawCaptureStderrFile]) {
    assert.deepEqual(replayRecord(directory, record), record);
  }
  const journal = readFileSync(paths.journal, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(journal.map((entry) => entry.type), ['CHECKPOINT', 'CHECKPOINT', 'FINAL']);
  assert.ok(Date.parse(final.finalizedUtc) > Date.parse(journal.at(-2).utc));
  assert.throws(
    () => finalizeGateACaptureAttempt(envelope, paths.journal, { status: 'ACCEPTED' }),
    /already finalized/u,
  );
});

test('attempt controls, raw cap, monotonic journal and exclusive finality fail closed', () => {
  const directory = mkdtempSync(join(tmpdir(), 'vande-gate-a-controls-'));
  const oversized = join(directory, 'oversized.bin');
  assert.throws(
    () => writeGateABoundedRawEvidence(oversized, Buffer.alloc(GATE_A_RAW_EVIDENCE_MAX_BYTES + 1)),
    /exceeds/u,
  );
  const stdoutFile = writeGateABoundedRawEvidence(join(directory, 'stdout.bin'), validTransactionBytes);
  const stderrFile = writeGateABoundedRawEvidence(join(directory, 'stderr.bin'), Buffer.alloc(0));
  const transaction = {
    status: 'ADB_SHELL_TRANSACTION_RETURNED_RAW_RETAINED',
    finishedUtc: '2026-10-29T10:00:00.125Z',
    stdoutFile,
    stderrFile,
  };
  const candidate = createGateACaptureReceiptCandidate({
    receipt: initialReceipt({ txStatus: 0, txStdoutFile: stdoutFile, txStderrFile: stderrFile }),
    rawTransaction: transaction,
  });
  const envelope = createGateACaptureAttempt({
    runId, serial, buildId, atomicTransaction: transaction,
    stateBefore: { phase: 'live' }, captureThenTapCandidate: candidate,
    recordedUtc: '2026-10-29T10:00:00.126Z',
  });
  const journal = join(directory, 'journal.ndjson');
  for (const forbidden of ['currentStage', 'harnessFinalStatus', 'harnessFailure', 'checkpoints', 'errors', 'finalizedUtc']) {
    assert.throws(() => recordGateACaptureAttemptCheckpoint(envelope, journal, {
      stage: 'FORGERY_REJECTED', patch: { [forbidden]: 'forged' }, utc: '2026-10-29T10:00:00.200Z',
    }), /cannot replace immutable/u, forbidden);
  }
  recordGateACaptureAttemptCheckpoint(envelope, journal, {
    stage: 'VALID_CHECKPOINT', patch: {}, utc: '2026-10-29T10:00:00.200Z',
  });
  assert.throws(() => finalizeGateACaptureAttempt(envelope, journal, {
    status: 'ACCEPTED', utc: '2026-10-29T10:00:00.201Z',
  }), /exact successful final drain candidate/u);
  assert.throws(() => recordGateACaptureAttemptError(envelope, journal, {
    stage: 'TIME_REVERSAL', error: new Error('earlier'), utc: '2026-10-29T10:00:00.199Z',
  }), /not at or after prior evidence/u);
  assert.throws(() => finalizeGateACaptureAttempt(envelope, journal, {
    status: 'REJECTED', utc: '2026-10-29T10:00:00.200Z',
  }), /not later than prior evidence/u);
});
