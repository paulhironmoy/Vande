#!/usr/bin/env node

/**
 * Pure validation helpers for the Android Gate-A one-ball evidence path.
 *
 * Keep these functions free of ADB, Playwright and filesystem effects so the
 * evidence rules can be exercised without a device.
 */

import {
  sameAndroidDeviceIdentity,
  validateAndroidDeviceIdentity,
} from './android-device-identity.mjs';
import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const BUILD_ID = /^[0-9a-f]{7,40}(?:\+[0-9a-f]{12})?$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const HOST_MONOTONIC_NS = /^(?:0|[1-9][0-9]*)$/u;
const REMOTE_CAPTURE_PATH = /^\/data\/local\/tmp\/vande-gate-a-([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/live-frame\.png$/iu;
const EMPTY_SHA256 = createHash('sha256').update(Buffer.alloc(0)).digest('hex');
const MAX_CAPTURE_TRANSACTION_OUTPUT_BYTES = 1_024;
const MAX_PNG_DECODE_BYTES = 64 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_CRC_TABLE = Object.freeze(Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
}));

export const GATE_A_CAPTURE_THEN_TAP_SUCCESS_MARKER = 'VANDE_GATE_A_CAPTURE_THEN_TAP_OK_V2';
export const GATE_A_CAPTURE_THEN_TAP_STATUS = 'ON_DEVICE_LIVE_FRAME_THEN_SINGLE_TAP_ACCEPTED';
export const GATE_A_CAPTURE_THEN_TAP_CLASSIFICATION = 'BOUNDED_ENGINEERING_METADATA_NO_RAW_GESTURE_SAMPLES';
export const GATE_A_CAPTURE_THEN_TAP_SUCCESS_DERIVATION = 'ATOMIC_SCREENSHOT_THEN_SINGLE_TAP_AND_CHAIN_TERMINAL_MARKER_OBSERVED';
export const GATE_A_CAPTURE_THEN_TAP_OPERATIONS = Object.freeze(['screencap-png', 'input-touchscreen-tap']);
export const GATE_A_CAPTURE_THEN_TAP_COORDINATE_RULE = 'x=round(width*0.5);y=round(height*0.82)';

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function validUtc(value) {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function validRemoteCapturePath(value) {
  return REMOTE_CAPTURE_PATH.test(value ?? '');
}

function remoteCaptureDirectory(remotePath) {
  return remotePath.slice(0, remotePath.length - '/live-frame.png'.length);
}

export function gateATapCoordinate(viewport) {
  const width = viewport?.physicalPixels?.width;
  const height = viewport?.physicalPixels?.height;
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) return null;
  return { x: Math.round(width * 0.5), y: Math.round(height * 0.82) };
}

export function gateACaptureThenTapCommand({ remotePath, coordinate }) {
  if (!validRemoteCapturePath(remotePath)) throw new Error('Gate-A remote live-frame path is unsafe');
  if (!exactKeys(coordinate, ['x', 'y'])
      || !Number.isSafeInteger(coordinate.x) || coordinate.x < 0
      || !Number.isSafeInteger(coordinate.y) || coordinate.y < 0) {
    throw new Error('Gate-A tap coordinate is invalid');
  }
  return `screencap -p ${remotePath} && input touchscreen tap ${coordinate.x} ${coordinate.y} && printf device-uptime-after-tap= && cat /proc/uptime && printf bytes= && stat -c %s ${remotePath} && sha256sum ${remotePath} && printf 'transaction-status=0\\n${GATE_A_CAPTURE_THEN_TAP_SUCCESS_MARKER}'`;
}

export function gateACaptureDirectoryPrepareCommand(remotePath) {
  if (!validRemoteCapturePath(remotePath)) throw new Error('Gate-A remote live-frame path is unsafe');
  const remoteDirectory = remoteCaptureDirectory(remotePath);
  return `mkdir ${remoteDirectory} && test -d ${remoteDirectory} && test ! -e ${remotePath}`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function parseGateACaptureThenTapOutput(value, remotePath) {
  if (!validRemoteCapturePath(remotePath) || typeof value !== 'string'
      || Buffer.byteLength(value) > MAX_CAPTURE_TRANSACTION_OUTPUT_BYTES || value.includes('\0')) return null;
  const pattern = new RegExp(
    `^device-uptime-after-tap=([0-9]+(?:\\.[0-9]+)? [0-9]+(?:\\.[0-9]+)?)\\n`
      + `bytes=([1-9][0-9]*)\\n([0-9a-f]{64})  ${escapeRegex(remotePath)}\\n`
      + `transaction-status=0\\n${GATE_A_CAPTURE_THEN_TAP_SUCCESS_MARKER}$`,
    'u',
  );
  const match = value.match(pattern);
  if (!match) return null;
  const afterTapSeconds = Number(match[1].split(' ')[0]);
  const bytes = Number(match[2]);
  if (!Number.isFinite(afterTapSeconds)
      || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 16 * 1024 * 1024) return null;
  return {
    deviceUptimeAfterTap: match[1],
    remoteCapture: { path: remotePath, bytes: String(bytes), sha256: match[3] },
    transactionOutput: {
      utf8: value,
      bytes: String(Buffer.byteLength(value)),
      sha256: createHash('sha256').update(value).digest('hex'),
    },
  };
}

export function decodeGateACaptureThenTapOutput(value) {
  if (!Buffer.isBuffer(value) || value.length > MAX_CAPTURE_TRANSACTION_OUTPUT_BYTES || value.includes(0)) return null;
  let decoded;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value);
  } catch {
    return null;
  }
  return Buffer.from(decoded, 'utf8').equals(value) ? decoded : null;
}

export function gateAPngDimensions(value) {
  if (!Buffer.isBuffer(value) || value.length < 57 || value.length > 16 * 1024 * 1024
      || !value.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null;
  let offset = PNG_SIGNATURE.length;
  let dimensions = null;
  let scanlineBytes = null;
  let sawIdat = false;
  let sawSrgb = false;
  let sawSbit = false;
  let idatEnded = false;
  let compressedBytes = 0;
  const idatChunks = [];
  let chunkIndex = 0;
  while (offset < value.length) {
    if (value.length - offset < 12) return null;
    const length = value.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = typeStart + 4;
    const crcOffset = dataStart + length;
    const nextOffset = crcOffset + 4;
    if (length > 16 * 1024 * 1024 || nextOffset > value.length) return null;
    const type = value.subarray(typeStart, dataStart).toString('ascii');
    if (!/^[A-Za-z]{4}$/u.test(type)) return null;
    let crc = 0xffffffff;
    for (let index = typeStart; index < crcOffset; index += 1) {
      crc = PNG_CRC_TABLE[(crc ^ value[index]) & 0xff] ^ (crc >>> 8);
    }
    if (((crc ^ 0xffffffff) >>> 0) !== value.readUInt32BE(crcOffset)) return null;
    if (chunkIndex === 0) {
      if (type !== 'IHDR' || length !== 13) return null;
      const width = value.readUInt32BE(dataStart);
      const height = value.readUInt32BE(dataStart + 4);
      const bitDepth = value[dataStart + 8];
      const colorType = value[dataStart + 9];
      // Gate-A accepts only the exact V7 Android screencap format: 8-bit RGBA, standard compression/filtering,
      // and non-interlaced scanlines. This intentionally excludes palette/PLTE semantics and other legal PNG
      // variants that the evidence path has neither produced nor independently decoded.
      const rowBytes = width * 4;
      const decodedBytes = (rowBytes + 1) * height;
      if (width < 1 || height < 1 || width > 100_000 || height > 100_000
          || bitDepth !== 8 || colorType !== 6
          || value[dataStart + 10] !== 0 || value[dataStart + 11] !== 0
          || value[dataStart + 12] !== 0
          || !Number.isSafeInteger(decodedBytes) || decodedBytes > MAX_PNG_DECODE_BYTES) return null;
      dimensions = { width, height };
      scanlineBytes = { rowBytes, decodedBytes };
    } else if (type === 'IHDR') return null;
    // The preserved V7 capture has only the two standard pre-IDAT metadata chunks below. Validate their exact
    // RGBA8 shapes and reject duplicates, late metadata, palettes, other ancillary chunks, and unknown critical
    // chunks instead of pretending to decode a broader PNG grammar.
    if (type === 'sRGB') {
      if (chunkIndex !== 1 || sawIdat || sawSrgb || sawSbit || length !== 1 || value[dataStart] !== 0) return null;
      sawSrgb = true;
    } else if (type === 'sBIT') {
      const significantBits = value.subarray(dataStart, crcOffset);
      if (!sawSrgb || sawIdat || sawSbit || length !== 4
          || !significantBits.equals(Buffer.from([8, 8, 8, 8]))) return null;
      sawSbit = true;
    } else if (!['IHDR', 'IDAT', 'IEND'].includes(type)) return null;
    if (type === 'IDAT') {
      if (!sawSrgb || !sawSbit || idatEnded) return null;
      sawIdat = true;
      compressedBytes += length;
      if (compressedBytes > 16 * 1024 * 1024) return null;
      idatChunks.push(value.subarray(dataStart, crcOffset));
    } else if (sawIdat && type !== 'IEND') idatEnded = true;
    if (type === 'IEND') {
      if (length !== 0 || !sawSrgb || !sawSbit || !sawIdat || compressedBytes === 0
          || nextOffset !== value.length) return null;
      let inflated;
      try {
        inflated = inflateSync(Buffer.concat(idatChunks, compressedBytes), {
          info: true,
          maxOutputLength: scanlineBytes.decodedBytes,
        });
      } catch {
        return null;
      }
      if (inflated.engine.bytesWritten !== compressedBytes) return null;
      const decoded = inflated.buffer;
      if (decoded.length !== scanlineBytes.decodedBytes) return null;
      for (let row = 0; row < dimensions.height; row += 1) {
        if (decoded[row * (scanlineBytes.rowBytes + 1)] > 4) return null;
      }
      return dimensions;
    }
    offset = nextOffset;
    chunkIndex += 1;
  }
  return null;
}

export function gateANativeListenerRegistration(registrations, epoch) {
  if (!Array.isArray(registrations) || !Number.isSafeInteger(epoch) || epoch < 1) return null;
  const matches = registrations.filter((entry) => entry?.epoch === epoch);
  if (matches.length !== 1) return null;
  const [entry] = matches;
  return { epoch: entry.epoch, ok: entry.ok, reason: entry.reason };
}

export function validateGateAFirstBallConfiguration({
  enabled,
  hooks,
  unityRequested,
  allowUnityFallback,
  skipLifecycle,
  perf,
  recheck,
  artifactMode,
  requirePackageAbsent,
  apkPath,
  expectedApkSha256,
  expectedBuildId,
  unityPayloadBindingPath,
  expectedUnityPayloadBindingSha256,
}) {
  if (!enabled) return [];
  const errors = [];
  if (hooks) errors.push('--gate-a-first-ball requires HOOKS=0');
  if (!unityRequested) errors.push('--gate-a-first-ball requires UNITY=1');
  if (allowUnityFallback) errors.push('--gate-a-first-ball refuses a retained-renderer fallback');
  if (!skipLifecycle) errors.push('--gate-a-first-ball requires --skip-lifecycle');
  if (perf) errors.push('--gate-a-first-ball cannot run --perf');
  if (recheck) errors.push('--gate-a-first-ball cannot run --recheck');
  if (artifactMode !== 'sealed') errors.push('--gate-a-first-ball requires ARTIFACT_MODE=sealed');
  if (!requirePackageAbsent) errors.push('--gate-a-first-ball requires REQUIRE_PACKAGE_ABSENT=1');
  if (typeof apkPath !== 'string' || !apkPath.startsWith('/')) errors.push('sealed APK path must be absolute');
  if (!SHA256.test(expectedApkSha256 ?? '')) errors.push('sealed APK SHA-256 must be 64 lowercase hexadecimal characters');
  if (!BUILD_ID.test(expectedBuildId ?? '')) errors.push('sealed build ID is invalid');
  if (typeof unityPayloadBindingPath !== 'string' || !isAbsolute(unityPayloadBindingPath)
      || /[\r\n\0]/u.test(unityPayloadBindingPath)
      || resolve(unityPayloadBindingPath) !== unityPayloadBindingPath) {
    errors.push('UNITY_PAYLOAD_BINDING_PATH must be canonical absolute and control-free');
  }
  if (!SHA256.test(expectedUnityPayloadBindingSha256 ?? '')) {
    errors.push('EXPECTED_UNITY_PAYLOAD_BINDING_SHA256 must be 64 lowercase hexadecimal characters');
  }
  return errors;
}

export function assertGateAFirstBallConfiguration(options) {
  const errors = validateGateAFirstBallConfiguration(options);
  if (errors.length) throw new Error(errors.join('; '));
}

function stateKey(observation) {
  return {
    buildId: observation?.buildId ?? null,
    renderer: observation?.renderer ?? null,
    admission: observation?.admission ?? null,
    deliveryId: observation?.deliveryId ?? null,
    inningsId: observation?.saved?.inningsId ?? null,
    overIndex: observation?.saved?.overIndex ?? null,
    ballIndex: observation?.saved?.ballIndex ?? null,
    balls: observation?.saved?.balls ?? null,
    records: observation?.saved?.records ?? null,
    inFlight: observation?.saved?.inFlight ?? null,
    deviceIdentity: observation?.deviceIdentity ?? null,
    handedness: observation?.handedness ?? null,
    viewport: observation?.viewport ?? null,
  };
}

function validatePresentationAttestation(observation, name) {
  const errors = [];
  if (!['right', 'left'].includes(observation?.handedness)) {
    errors.push(`${name} handedness is not exact right or left`);
  }
  const viewport = observation?.viewport;
  const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
  if (viewport?.schemaVersion !== 1
      || !positiveInteger(viewport?.cssPixels?.width)
      || !positiveInteger(viewport?.cssPixels?.height)
      || !positiveInteger(viewport?.physicalPixels?.width)
      || !positiveInteger(viewport?.physicalPixels?.height)
      || !Number.isFinite(viewport?.devicePixelRatio) || viewport.devicePixelRatio <= 0
      || ![90, 270].includes(viewport?.nativeRotationDegrees)
      || !positiveInteger(viewport?.pageEpoch)
      || !(viewport?.screenOrientation?.type === null
        || (typeof viewport?.screenOrientation?.type === 'string'
          && viewport.screenOrientation.type.startsWith('landscape')))
      || !(viewport?.screenOrientation?.angle === null
        || Number.isSafeInteger(viewport?.screenOrientation?.angle))) {
    errors.push(`${name} viewport attestation is invalid`);
  } else if (viewport.cssPixels.width < viewport.cssPixels.height
      || viewport.physicalPixels.width < viewport.physicalPixels.height) {
    errors.push(`${name} viewport attestation is not landscape`);
  }
  return errors;
}

export function classifyPmPathAbsence({ status, stdout, stderr }) {
  const exactStatus = Number.isSafeInteger(status) ? status : Number(String(status).trim());
  const exactStdout = typeof stdout === 'string' ? stdout : '';
  const exactStderr = typeof stderr === 'string' ? stderr : '';
  if (exactStatus === 1 && exactStdout.length === 0 && exactStderr.length === 0) {
    return {
      absent: true,
      policy: 'ANDROID_PM_PATH_ABSENT_EXIT_1_EMPTY_STREAMS_V1',
      exitStatus: 1,
    };
  }
  const reason = exactStatus !== 1
    ? `exit status is ${Number.isFinite(exactStatus) ? exactStatus : 'invalid'}, expected exactly 1`
    : exactStdout.length > 0
      ? 'stdout is not exactly empty'
      : 'stderr is not exactly empty';
  return { absent: false, policy: 'REJECTED', exitStatus: exactStatus, reason };
}

export function validateLiveFrameBracket(before, after, expected = {}) {
  const errors = [];
  for (const [name, observation] of [['before', before], ['after', after]]) {
    if (!observation || typeof observation !== 'object') {
      errors.push(`${name} observation is missing`);
      continue;
    }
    if (observation.phase !== 'live') errors.push(`${name} phase is ${observation.phase ?? 'missing'}, not live`);
    if (observation.renderer !== 'unity-native') errors.push(`${name} renderer is ${observation.renderer ?? 'missing'}, not unity-native`);
    if (typeof observation.admission !== 'string' || observation.admission.length === 0) errors.push(`${name} Unity admission is missing`);
    if (typeof observation.deliveryId !== 'string' || observation.deliveryId.length === 0) errors.push(`${name} delivery ID is missing`);
    if (expected.buildId && observation.buildId !== expected.buildId) errors.push(`${name} build ID does not match the sealed build`);
    const identityErrors = validateAndroidDeviceIdentity(observation.deviceIdentity);
    if (identityErrors.length) errors.push(`${name} device identity is invalid: ${identityErrors.join(', ')}`);
    if (expected.deviceIdentity && !sameAndroidDeviceIdentity(observation.deviceIdentity, expected.deviceIdentity)) {
      errors.push(`${name} device identity does not match the install boundary`);
    }
    if (observation.saved?.inFlight === null || observation.saved?.inFlight === undefined) errors.push(`${name} saved delivery is not in flight`);
    errors.push(...validatePresentationAttestation(observation, name));
    if (observation.saved?.overIndex !== 0 || observation.saved?.ballIndex !== 0
        || observation.saved?.inFlight?.overIndex !== 0 || observation.saved?.inFlight?.ballIndex !== 0) {
      errors.push(`${name} is not the exact first saved delivery coordinate 0:0`);
    }
  }
  if (!same(stateKey(before), stateKey(after))) errors.push('live-frame state changed across the OS screenshot');
  return errors;
}

export function validateGateACaptureThenTapReceipt(receipt, {
  before,
  after,
  dead,
  expectedBuildId = null,
  expectedRunId = null,
  expectedSerial = null,
  expectedAdbEndpoint = null,
  expectedLiveFrame = null,
} = {}) {
  const errors = [];
  const receiptKeys = [
    'schemaVersion', 'status', 'classification', 'runId', 'serial', 'adbEndpoint',
    'buildId', 'deliveryId', 'viewport',
    'tapCoordinatePhysicalPixels', 'coordinateRule', 'operationOrder',
    'remoteShellCommand', 'remoteShellTransactionCount', 'gameplayTapCount', 'startedUtc', 'finishedUtc',
    'startedHostMonotonicNs', 'finishedHostMonotonicNs', 'successMarker',
    'successMarkerObservedCount', 'successDerivation', 'adbShellResult', 'transactionOutput', 'deviceUptimeAfterTap',
    'remoteCapture', 'nativeListenerRegistration', 'nativeEventDropCounts',
    'nativeDeliveryEvents', 'liveFrame',
  ];
  if (!exactKeys(receipt, receiptKeys)) {
    return ['capture-then-tap receipt keys are not exact'];
  }
  if (receipt.schemaVersion !== 2) errors.push('capture-then-tap receipt schemaVersion is not 2');
  if (receipt.status !== GATE_A_CAPTURE_THEN_TAP_STATUS) errors.push('capture-then-tap receipt status is not exact');
  if (receipt.classification !== GATE_A_CAPTURE_THEN_TAP_CLASSIFICATION) {
    errors.push('capture-then-tap receipt classification is not exact');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(receipt.runId ?? '')
      || (expectedRunId !== null && receipt.runId !== expectedRunId)) {
    errors.push('capture-then-tap run ID is invalid or differs');
  }
  if (typeof receipt.serial !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(receipt.serial)
      || (expectedSerial !== null && receipt.serial !== expectedSerial)) {
    errors.push('capture-then-tap Android serial is invalid or differs');
  }
  if (!exactKeys(receipt.adbEndpoint, ['host', 'port'])
      || receipt.adbEndpoint.host !== '127.0.0.1'
      || !Number.isSafeInteger(receipt.adbEndpoint.port) || receipt.adbEndpoint.port < 1
      || receipt.adbEndpoint.port > 65_535 || receipt.adbEndpoint.port === 5_037
      || (expectedAdbEndpoint !== null && !same(receipt.adbEndpoint, expectedAdbEndpoint))) {
    errors.push('capture-then-tap dedicated ADB endpoint is invalid or differs');
  }
  if (!BUILD_ID.test(receipt.buildId ?? '')
      || (expectedBuildId !== null && receipt.buildId !== expectedBuildId)
      || receipt.buildId !== before?.buildId
      || receipt.buildId !== after?.buildId) {
    errors.push('capture-then-tap build ID does not bind both observations');
  }
  if (typeof receipt.deliveryId !== 'string' || receipt.deliveryId.length === 0
      || receipt.deliveryId !== before?.deliveryId || receipt.deliveryId !== after?.deliveryId) {
    errors.push('capture-then-tap delivery ID does not bind both observations');
  }
  if (!same(receipt.viewport, before?.viewport) || !same(receipt.viewport, after?.viewport)) {
    errors.push('capture-then-tap viewport does not bind both observations');
  }
  const expectedCoordinate = gateATapCoordinate(receipt.viewport);
  if (!expectedCoordinate || !exactKeys(receipt.tapCoordinatePhysicalPixels, ['x', 'y'])
      || !same(receipt.tapCoordinatePhysicalPixels, expectedCoordinate)) {
    errors.push('capture-then-tap coordinate does not match the exact physical viewport calculation');
  }
  if (receipt.coordinateRule !== GATE_A_CAPTURE_THEN_TAP_COORDINATE_RULE) {
    errors.push('capture-then-tap coordinate rule is not exact');
  }
  if (!same(receipt.operationOrder, GATE_A_CAPTURE_THEN_TAP_OPERATIONS)) {
    errors.push('capture-then-tap operation order is not screenshot before tap');
  }
  let expectedRemoteShellCommand = null;
  try {
    expectedRemoteShellCommand = gateACaptureThenTapCommand({
      remotePath: receipt.remoteCapture?.path,
      coordinate: receipt.tapCoordinatePhysicalPixels,
    });
  } catch {
    // The dedicated remote-capture validation below reports the malformed path.
  }
  if (receipt.remoteShellCommand !== expectedRemoteShellCommand) {
    errors.push('capture-then-tap remote shell command does not bind the exact screenshot-then-tap operation');
  }
  if (receipt.remoteShellTransactionCount !== 1) {
    errors.push('capture-then-tap remote-shell transaction count is not exactly 1');
  }
  if (receipt.gameplayTapCount !== 1) errors.push('capture-then-tap ADB-injected touchscreen tap count is not exactly 1');
  const receiptUtcValid = validUtc(receipt.startedUtc) && validUtc(receipt.finishedUtc);
  if (!receiptUtcValid || Date.parse(receipt.finishedUtc) <= Date.parse(receipt.startedUtc)) {
    errors.push('capture-then-tap UTC bracket is invalid or reversed');
  }
  const receiptMonotonicValid = HOST_MONOTONIC_NS.test(receipt.startedHostMonotonicNs ?? '')
    && HOST_MONOTONIC_NS.test(receipt.finishedHostMonotonicNs ?? '');
  if (!receiptMonotonicValid
      || (receiptMonotonicValid
        && BigInt(receipt.finishedHostMonotonicNs) <= BigInt(receipt.startedHostMonotonicNs))) {
    errors.push('capture-then-tap host monotonic bracket is invalid or not increasing');
  }
  const observationsHaveTime = validUtc(before?.utc) && validUtc(after?.utc)
    && HOST_MONOTONIC_NS.test(before?.hostMonotonicNs ?? '')
    && HOST_MONOTONIC_NS.test(after?.hostMonotonicNs ?? '');
  if (!receiptUtcValid || !receiptMonotonicValid || !observationsHaveTime
      || (receiptUtcValid && (Date.parse(receipt.startedUtc) < Date.parse(before?.utc ?? '')
        || Date.parse(receipt.finishedUtc) > Date.parse(after?.utc ?? '')))
      || (receiptMonotonicValid && observationsHaveTime
        && (BigInt(before.hostMonotonicNs) >= BigInt(receipt.startedHostMonotonicNs)
          || BigInt(receipt.finishedHostMonotonicNs) >= BigInt(after.hostMonotonicNs)))) {
    errors.push('capture-then-tap transaction is not strictly bracketed by the pre/post observation times');
  }
  if (receipt.successMarker !== GATE_A_CAPTURE_THEN_TAP_SUCCESS_MARKER
      || receipt.successMarkerObservedCount !== 1) {
    errors.push('capture-then-tap exact success marker was not observed once');
  }
  if (receipt.successDerivation !== GATE_A_CAPTURE_THEN_TAP_SUCCESS_DERIVATION) {
    errors.push('capture-then-tap success derivation is not the exact shell AND-chain terminal-marker contract');
  }
  if (!exactKeys(receipt.adbShellResult, ['exitStatus', 'stderrBytes', 'stderrSha256'])
      || receipt.adbShellResult.exitStatus !== 0
      || receipt.adbShellResult.stderrBytes !== '0'
      || receipt.adbShellResult.stderrSha256 !== EMPTY_SHA256) {
    errors.push('capture-then-tap outer ADB shell result is not exact exit 0 with byte-empty stderr');
  }
  const replayedOutput = parseGateACaptureThenTapOutput(
    receipt.transactionOutput?.utf8,
    receipt.remoteCapture?.path,
  );
  if (!exactKeys(receipt.transactionOutput, ['utf8', 'bytes', 'sha256'])
      || replayedOutput === null
      || !same(receipt.transactionOutput, replayedOutput?.transactionOutput)) {
    errors.push('capture-then-tap bounded raw transaction output is invalid or changed');
  }
  if (typeof receipt.deviceUptimeAfterTap !== 'string'
      || receipt.deviceUptimeAfterTap !== replayedOutput?.deviceUptimeAfterTap) {
    errors.push('capture-then-tap post-tap device uptime differs from raw transaction output');
  }
  if (!exactKeys(receipt.remoteCapture, ['path', 'bytes', 'sha256', 'png'])
      || !exactKeys(receipt.remoteCapture?.png, ['width', 'height'])
      || receipt.remoteCapture.path !== `/data/local/tmp/vande-gate-a-${receipt.runId}/live-frame.png`
      || receipt.remoteCapture.path !== replayedOutput?.remoteCapture?.path
      || receipt.remoteCapture.bytes !== replayedOutput?.remoteCapture?.bytes
      || receipt.remoteCapture.sha256 !== replayedOutput?.remoteCapture?.sha256) {
    errors.push('capture-then-tap remote capture identity differs from raw transaction output');
  }
  if (!exactKeys(receipt.liveFrame, ['path', 'bytes', 'sha256', 'png'])
      || !exactKeys(receipt.liveFrame?.png, ['width', 'height'])
      || receipt.liveFrame.path !== 'live-frame.png'
      || !/^[1-9][0-9]*$/u.test(receipt.liveFrame.bytes ?? '')
      || !SHA256.test(receipt.liveFrame.sha256 ?? '')
      || (expectedLiveFrame !== null && !same(receipt.liveFrame, expectedLiveFrame))) {
    errors.push('capture-then-tap live-frame binding is invalid or differs');
  }
  if (receipt.remoteCapture?.bytes !== receipt.liveFrame?.bytes
      || receipt.remoteCapture?.sha256 !== receipt.liveFrame?.sha256
      || !same(receipt.remoteCapture?.png, receipt.liveFrame?.png)
      || !same(receipt.liveFrame?.png, receipt.viewport?.physicalPixels)) {
    errors.push('capture-then-tap remote/local PNG bytes, hash or exact viewport geometry differ');
  }
  if (!exactKeys(receipt.nativeListenerRegistration, ['epoch', 'ok', 'reason'])
      || receipt.nativeListenerRegistration.epoch !== receipt.viewport?.pageEpoch
      || receipt.nativeListenerRegistration.ok !== true
      || receipt.nativeListenerRegistration.reason !== 'message_and_error_listeners_attached') {
    errors.push('capture-then-tap native listener was not registered successfully in the same page epoch');
  }
  if (!exactKeys(receipt.nativeEventDropCounts, ['events', 'registrations'])
      || receipt.nativeEventDropCounts.events !== 0 || receipt.nativeEventDropCounts.registrations !== 0) {
    errors.push('capture-then-tap native event evidence was dropped');
  }

  const events = receipt.nativeDeliveryEvents;
  if (!Array.isArray(events) || events.length !== 4) {
    errors.push('capture-then-tap native delivery evidence must contain exactly release, pointer, gesture then dead');
  } else {
    const [release, pointer, gesture, dead] = events;
    const operationId = release?.operationId;
    for (const [name, event] of [['release', release], ['pointer', pointer], ['gesture', gesture], ['dead', dead]]) {
      if (!exactKeys(event, ['epoch', 'operationId', 'type', 'sequence', 'deliveryId'])
          || !Number.isSafeInteger(event?.epoch) || event.epoch < 1
          || event.epoch !== receipt.viewport?.pageEpoch
          || typeof event?.operationId !== 'string' || !/^[A-Za-z0-9._:+-]{1,128}$/u.test(event.operationId)
          || event.operationId !== operationId
          || !Number.isSafeInteger(event?.sequence) || event.sequence < 0
          || event?.deliveryId !== receipt.deliveryId) {
        errors.push(`capture-then-tap native ${name} evidence is invalid or belongs to another delivery`);
      }
    }
    if (release?.type !== 'unity.release' || pointer?.type !== 'unity.pointer'
        || gesture?.type !== 'unity.gesture' || dead?.type !== 'unity.dead'
        || !(release?.sequence < pointer?.sequence
          && pointer?.sequence < gesture?.sequence
          && gesture?.sequence < dead?.sequence)) {
      errors.push('capture-then-tap native delivery evidence is missing, duplicated or out of release-pointer-gesture-dead order');
    }
  }

  if (before?.phase !== 'live') errors.push('capture-then-tap pre-observation is not live');
  if (before?.deliveryEventType !== 'unity.release') {
    errors.push('capture-then-tap pre-observation is not bound to native unity.release');
  }
  if (!['live', 'playing', 'dead'].includes(after?.phase)) {
    errors.push('capture-then-tap post-observation is neither live, playing nor dead');
  }
  if (before?.renderer !== 'unity-native' || after?.renderer !== 'unity-native'
      || before?.admission !== after?.admission
      || before?.handedness !== after?.handedness
      || !sameAndroidDeviceIdentity(before?.deviceIdentity, after?.deviceIdentity)) {
    errors.push('capture-then-tap renderer, admission, handedness or device identity changed');
  }
  errors.push(...validatePresentationAttestation(before, 'capture-then-tap before'));
  errors.push(...validatePresentationAttestation(after, 'capture-then-tap after'));
  if (after?.phase === 'live'
      && (!same(stateKey(before), stateKey(after)) || !same(before?.saved, after?.saved))) {
    errors.push('capture-then-tap live post-observation changed before the authoritative ball resolved');
  }
  if (after?.phase === 'playing') {
    const unchangedInFlight = same(stateKey(before), stateKey(after)) && same(before?.saved, after?.saved);
    const resolvedPlayingErrors = validateFirstBallTransition(before, { ...after, phase: 'dead' }, {
      tapCount: receipt.gameplayTapCount,
    });
    const exactAuthoritativeResolvedState = same(after?.saved, dead?.saved) && resolvedPlayingErrors.length === 0;
    if (!unchangedInFlight && !exactAuthoritativeResolvedState) {
      errors.push('capture-then-tap playing post-observation is neither unchanged in-flight state nor the exact authoritative resolved state');
    }
  }
  if (after?.phase === 'dead') {
    errors.push(...validateFirstBallTransition(before, after, { tapCount: receipt.gameplayTapCount }));
    const resolvedAfter = {
      screen: after.screen,
      phase: after.phase,
      buildId: after.buildId,
      renderer: after.renderer,
      admission: after.admission,
      deliveryId: after.deliveryId,
      deliveryEventType: after.deliveryEventType,
      deviceIdentity: after.deviceIdentity,
      handedness: after.handedness,
      viewport: after.viewport,
      saved: after.saved,
    };
    const resolvedDead = {
      screen: dead?.screen,
      phase: dead?.phase,
      buildId: dead?.buildId,
      renderer: dead?.renderer,
      admission: dead?.admission,
      deliveryId: dead?.deliveryId,
      deliveryEventType: dead?.deliveryEventType,
      deviceIdentity: dead?.deviceIdentity,
      handedness: dead?.handedness,
      viewport: dead?.viewport,
      saved: dead?.saved,
    };
    if (after.deliveryEventType !== 'unity.dead' || !same(resolvedAfter, resolvedDead)) {
      errors.push('capture-then-tap dead post-observation is not identical to the authoritative dead state');
    }
  }
  if (dead?.deliveryId !== receipt.deliveryId || dead?.viewport?.pageEpoch !== receipt.viewport?.pageEpoch) {
    errors.push('capture-then-tap dead observation does not bind the same epoch and delivery');
  } else {
    errors.push(...validateFirstBallTransition(before, dead, { tapCount: receipt.gameplayTapCount }));
  }
  return errors;
}

export function validateFirstBallTransition(before, after, { tapCount = 0 } = {}) {
  const errors = [];
  if (!before?.saved || !after?.saved) return ['first-ball observations are missing saved state'];
  if (tapCount !== 1) errors.push(`ADB-injected touchscreen tap count is ${tapCount}, expected exactly 1`);
  if (!before.saved.inningsId || after.saved.inningsId !== before.saved.inningsId) errors.push('innings identity changed across the first ball');
  if (before.saved.balls !== 0 || before.saved.records !== 0) errors.push('the sealed fresh-profile run did not start before the first saved ball');
  if (after.saved.balls !== 1 || after.saved.records !== 1) errors.push('the first ball did not produce exactly one saved record');
  if (after.saved.inFlight !== null) errors.push('a second delivery is already in flight');
  if (after.phase !== 'dead') errors.push(`post-ball phase is ${after.phase ?? 'missing'}, not dead`);
  if (typeof before.deliveryId !== 'string' || before.deliveryId.length === 0 || after.deliveryId !== before.deliveryId) {
    errors.push('native delivery identity changed across the first ball');
  }
  if (before.saved.overIndex !== 0 || before.saved.ballIndex !== 0
      || before.saved.inFlight?.overIndex !== 0 || before.saved.inFlight?.ballIndex !== 0) {
    errors.push('live saved delivery is not exact coordinate 0:0');
  }
  if (after.saved.overIndex !== 0 || after.saved.ballIndex !== 0) {
    errors.push('resolved saved record is not exact coordinate 0:0');
  }
  if (after.buildId !== before.buildId || after.renderer !== before.renderer || after.admission !== before.admission) {
    errors.push('build, renderer or admission changed across the first ball');
  }
  if (!sameAndroidDeviceIdentity(before.deviceIdentity, after.deviceIdentity)) {
    errors.push('Android device identity changed across the first ball');
  }
  errors.push(...validatePresentationAttestation(before, 'before'));
  errors.push(...validatePresentationAttestation(after, 'after'));
  if (before.handedness !== after.handedness || !same(before.viewport, after.viewport)) {
    errors.push('handedness or viewport changed across the first ball');
  }
  if (!['defend', 'attack'].includes(after.saved.lastSwingKind)) {
    errors.push('saved record does not contain an accepted gameplay swing kind (defend/attack)');
  }
  return errors;
}

export function gateAStateKey(observation) {
  return stateKey(observation);
}
