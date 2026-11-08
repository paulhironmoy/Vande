#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename } from 'node:path';

const STAGE = /^[A-Z][A-Z0-9_]{2,95}$/u;
const FINAL_STATUSES = new Set(['ACCEPTED', 'REJECTED']);
export const GATE_A_RAW_EVIDENCE_MAX_BYTES = 16 * 1024 * 1024;
const IMMUTABLE_FIELDS = new Set([
  'schemaVersion', 'classification', 'runId', 'serial', 'buildId', 'recordedUtc',
  'atomicTransaction', 'stateBefore', 'currentStage', 'harnessFinalStatus', 'harnessFailure',
  'checkpoints', 'errors', 'finalizedUtc',
]);

const clone = (value) => structuredClone(value);
const utcNow = () => new Date().toISOString();

function validUtc(value) {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function latestAttemptUtc(envelope) {
  return [
    envelope.recordedUtc,
    ...envelope.checkpoints.map((entry) => entry.utc),
    ...envelope.errors.map((entry) => entry.utc),
  ].reduce((latest, value) => Math.max(latest, Date.parse(value)), Number.NEGATIVE_INFINITY);
}

function requireJournalUtc(envelope, utc, { strictlyLater = false } = {}) {
  if (!validUtc(utc)) throw new Error(`invalid Gate-A attempt UTC ${utc ?? 'missing'}`);
  const observed = Date.parse(utc);
  const latest = latestAttemptUtc(envelope);
  if (observed < latest || (strictlyLater && observed <= latest)) {
    throw new Error(`Gate-A attempt UTC ${utc} is not ${strictlyLater ? 'later than' : 'at or after'} prior evidence`);
  }
}

function safeRecordedPath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 255
    && !value.startsWith('/') && !value.includes('\\')
    && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function requireStage(stage) {
  if (typeof stage !== 'string' || !STAGE.test(stage)) throw new Error(`invalid Gate-A attempt stage ${stage ?? 'missing'}`);
}

function durableExclusiveWrite(path, payload) {
  const descriptor = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(descriptor, payload, typeof payload === 'string' ? { encoding: 'utf8' } : undefined);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function durableAppend(path, payload, { first = false } = {}) {
  const descriptor = openSync(path, first ? 'ax' : 'a', 0o600);
  try {
    appendFileSync(descriptor, payload, { encoding: 'utf8' });
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function gateAEvidenceFileRecord(path, recordedPath = basename(path)) {
  if (!safeRecordedPath(recordedPath)) throw new Error(`unsafe Gate-A evidence path ${recordedPath ?? 'missing'}`);
  const identity = lstatSync(path);
  if (!identity.isFile() || identity.isSymbolicLink()) throw new Error(`Gate-A evidence is not a regular non-symlink file: ${path}`);
  const bytes = readFileSync(path);
  return {
    path: recordedPath,
    bytes: String(identity.size),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export function writeGateABoundedRawEvidence(path, value, recordedPath = basename(path)) {
  if (!Buffer.isBuffer(value)) throw new Error('Gate-A raw evidence must be a Buffer');
  if (value.length > GATE_A_RAW_EVIDENCE_MAX_BYTES) {
    throw new Error(`Gate-A raw evidence exceeds ${GATE_A_RAW_EVIDENCE_MAX_BYTES} bytes`);
  }
  durableExclusiveWrite(path, value);
  return gateAEvidenceFileRecord(path, recordedPath);
}

export function createGateACaptureReceiptCandidate({ receipt, rawTransaction }) {
  if (receipt?.schemaVersion !== 2 || !rawTransaction || typeof rawTransaction !== 'object') {
    throw new Error('Gate-A schema-2 receipt candidate requires raw transaction evidence');
  }
  return {
    schemaVersion: 2,
    status: 'REJECTED_UNVALIDATED',
    receipt: clone(receipt),
    rawTransaction: clone(rawTransaction),
    rawCaptureBinding: null,
    validatorErrors: [],
    finalDrain: null,
  };
}

export function gateANextAttemptUtc(envelope) {
  const next = Math.max(Date.now(), latestAttemptUtc(envelope) + 1);
  return new Date(next).toISOString();
}

export function createGateACaptureAttempt({
  runId,
  serial,
  buildId,
  atomicTransaction,
  stateBefore,
  captureThenTapCandidate,
  recordedUtc = utcNow(),
}) {
  if (typeof runId !== 'string' || runId.length === 0
      || typeof serial !== 'string' || serial.length === 0
      || typeof buildId !== 'string' || buildId.length === 0
      || !atomicTransaction || typeof atomicTransaction !== 'object'
      || !stateBefore || typeof stateBefore !== 'object'
      || captureThenTapCandidate?.schemaVersion !== 2) {
    throw new Error('Gate-A attempt immutable transaction identity is incomplete');
  }
  if (!validUtc(recordedUtc) || !validUtc(atomicTransaction.finishedUtc)
      || Date.parse(recordedUtc) < Date.parse(atomicTransaction.finishedUtc)) {
    throw new Error('Gate-A attempt recordedUtc is invalid or predates the returned transaction');
  }
  return {
    schemaVersion: 2,
    classification: 'LOCAL_GATE_A_CAPTURE_THEN_TAP_ATTEMPT_APPEND_ONLY_V2',
    runId,
    serial,
    buildId,
    recordedUtc,
    currentStage: 'ATOMIC_TRANSACTION_RETURNED_RAW_RETAINED',
    harnessFinalStatus: 'PENDING',
    harnessFailure: null,
    atomicTransaction: clone(atomicTransaction),
    stateBefore: clone(stateBefore),
    captureThenTapCandidate: clone(captureThenTapCandidate),
    stateAfter: null,
    rawCapturePull: null,
    pngPull: null,
    liveFrame: null,
    resolvedSavedState: null,
    deadState: null,
    captureThenTap: null,
    initialValidationStatus: 'NOT_REACHED',
    initialValidationErrors: null,
    finalCaptureThenTap: null,
    finalValidationStatus: 'NOT_REACHED',
    finalValidationErrors: null,
    checkpoints: [],
    errors: [],
    finalizedUtc: null,
  };
}

export function initialGateACaptureAttemptRecord(envelope) {
  return {
    schemaVersion: envelope.schemaVersion,
    status: 'CAPTURE_THEN_TAP_TRANSACTION_RETURNED_RAW_RETAINED',
    classification: envelope.classification,
    harnessFinalStatus: 'PENDING',
    runId: envelope.runId,
    serial: envelope.serial,
    buildId: envelope.buildId,
    recordedUtc: envelope.recordedUtc,
    atomicTransaction: clone(envelope.atomicTransaction),
    stateBefore: clone(envelope.stateBefore),
    captureThenTapCandidate: clone(envelope.captureThenTapCandidate),
  };
}

export function writeInitialGateACaptureAttempt(path, envelope) {
  const record = initialGateACaptureAttemptRecord(envelope);
  durableExclusiveWrite(path, `${JSON.stringify(record, null, 2)}\n`);
  return gateAEvidenceFileRecord(path);
}

export function recordGateACaptureAttemptCheckpoint(envelope, journalPath, {
  stage,
  patch = {},
  utc = null,
}) {
  requireStage(stage);
  if (envelope.finalizedUtc !== null || envelope.currentStage === 'FINALIZED') {
    throw new Error('Gate-A attempt is already finalized');
  }
  for (const key of Object.keys(patch)) {
    if (IMMUTABLE_FIELDS.has(key)) throw new Error(`Gate-A attempt checkpoint cannot replace immutable ${key}`);
  }
  const journalUtc = utc ?? new Date(Math.max(Date.now(), latestAttemptUtc(envelope))).toISOString();
  requireJournalUtc(envelope, journalUtc);
  const entry = {
    schemaVersion: 1,
    type: 'CHECKPOINT',
    sequence: envelope.checkpoints.length + envelope.errors.length,
    stage,
    utc: journalUtc,
    patch: clone(patch),
  };
  durableAppend(journalPath, `${JSON.stringify(entry)}\n`, { first: entry.sequence === 0 });
  Object.assign(envelope, clone(patch));
  envelope.currentStage = stage;
  envelope.checkpoints.push(clone(entry));
  return entry;
}

export function recordGateACaptureAttemptError(envelope, journalPath, {
  stage = envelope.currentStage,
  error,
  utc = null,
}) {
  requireStage(stage);
  if (envelope.finalizedUtc !== null || envelope.currentStage === 'FINALIZED') {
    throw new Error('Gate-A attempt is already finalized');
  }
  const journalUtc = utc ?? new Date(Math.max(Date.now(), latestAttemptUtc(envelope))).toISOString();
  requireJournalUtc(envelope, journalUtc);
  const message = error?.message ?? String(error);
  const stack = typeof error?.stack === 'string' ? error.stack : '';
  const record = {
    schemaVersion: 1,
    type: 'ERROR',
    sequence: envelope.checkpoints.length + envelope.errors.length,
    stage,
    utc: journalUtc,
    message,
    stack,
    candidateStatus: 'REJECTED',
  };
  durableAppend(journalPath, `${JSON.stringify(record)}\n`, { first: record.sequence === 0 });
  envelope.currentStage = stage;
  envelope.harnessFinalStatus = 'REJECTED';
  envelope.harnessFailure ??= message;
  if (envelope.captureThenTapCandidate?.schemaVersion === 2) {
    envelope.captureThenTapCandidate.status = 'REJECTED';
    envelope.captureThenTapCandidate.validatorErrors = [
      ...envelope.captureThenTapCandidate.validatorErrors,
      `harness error at ${stage}: ${message}`,
    ];
  }
  envelope.errors.push(clone(record));
  return record;
}

export function finalizeGateACaptureAttempt(envelope, journalPath, {
  status,
  failure = null,
  utc = null,
}) {
  if (envelope.finalizedUtc !== null || envelope.currentStage === 'FINALIZED') {
    throw new Error('Gate-A attempt is already finalized');
  }
  if (!FINAL_STATUSES.has(status)) throw new Error(`invalid Gate-A attempt final status ${status ?? 'missing'}`);
  if (status === 'ACCEPTED' && envelope.errors.length > 0) {
    throw new Error('Gate-A attempt with retained errors cannot be accepted');
  }
  if (status === 'ACCEPTED'
      && (envelope.finalValidationStatus !== 'ACCEPTED'
        || envelope.finalValidationErrors?.length !== 0
        || envelope.finalCaptureThenTap?.schemaVersion !== 2
        || envelope.captureThenTapCandidate?.status !== 'ACCEPTED_PENDING_GATE_RESOLUTION')) {
    throw new Error('Gate-A attempt cannot be accepted without an exact successful final drain candidate');
  }
  const journalUtc = utc ?? gateANextAttemptUtc(envelope);
  requireJournalUtc(envelope, journalUtc, { strictlyLater: true });
  const harnessFailure = failure ?? envelope.harnessFailure;
  const entry = {
    schemaVersion: 1,
    type: 'FINAL',
    sequence: envelope.checkpoints.length + envelope.errors.length,
    stage: 'FINALIZED',
    utc: journalUtc,
    harnessFinalStatus: status,
    harnessFailure,
  };
  durableAppend(journalPath, `${JSON.stringify(entry)}\n`, { first: entry.sequence === 0 });
  envelope.harnessFinalStatus = status;
  envelope.harnessFailure = harnessFailure;
  if (envelope.captureThenTapCandidate?.schemaVersion === 2) {
    envelope.captureThenTapCandidate.status = status;
  }
  envelope.finalizedUtc = journalUtc;
  envelope.currentStage = 'FINALIZED';
  return entry;
}

export function writeFinalGateACaptureAttempt(path, envelope) {
  if (!FINAL_STATUSES.has(envelope.harnessFinalStatus) || envelope.finalizedUtc === null) {
    throw new Error('Gate-A final attempt snapshot requires one exact final status');
  }
  durableExclusiveWrite(path, `${JSON.stringify({
    ...clone(envelope),
    status: 'CAPTURE_THEN_TAP_ATTEMPT_FINAL',
  }, null, 2)}\n`);
  return gateAEvidenceFileRecord(path);
}
