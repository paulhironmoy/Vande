#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import {
  classifyPmPathAbsence,
  GATE_A_CAPTURE_THEN_TAP_CLASSIFICATION,
  GATE_A_CAPTURE_THEN_TAP_COORDINATE_RULE,
  GATE_A_CAPTURE_THEN_TAP_OPERATIONS,
  GATE_A_CAPTURE_THEN_TAP_STATUS,
  GATE_A_CAPTURE_THEN_TAP_SUCCESS_DERIVATION,
  GATE_A_CAPTURE_THEN_TAP_SUCCESS_MARKER,
  decodeGateACaptureThenTapOutput,
  gateACaptureDirectoryPrepareCommand,
  gateACaptureThenTapCommand,
  gateANativeListenerRegistration,
  gateAPngDimensions,
  gateATapCoordinate,
  parseGateACaptureThenTapOutput,
  validateGateACaptureThenTapReceipt,
  validateFirstBallTransition,
  validateGateAFirstBallConfiguration,
  validateLiveFrameBracket,
} from './android-gate-a.mjs';

const buildId = '38924bd+0123456789ab';
const sha256 = 'a'.repeat(64);
const emptySha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngCrcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
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
    crc = pngCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
  return chunk;
}

function rgbaPng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    pngSignature,
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
    pngSignature,
    pngChunk('IHDR', header),
    pngChunk('sRGB', Buffer.from([0])),
    pngChunk('sBIT', Buffer.from([8, 8, 8])),
    pngChunk('IDAT', deflateSync(Buffer.alloc((width + 1) * height))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunkOffset(bytes, wanted) {
  let offset = pngSignature.length;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.subarray(offset + 4, offset + 8).toString('ascii') === wanted) return offset;
    offset += 12 + length;
  }
  throw new Error(`PNG fixture has no ${wanted} chunk`);
}
const deviceIdentity = {
  serial: 'emulator-5584', model: 'Pixel', release: '16', api: '36',
  buildFingerprint: 'vendor/device/build', securityPatch: '2026-10-05', androidBuildId: 'ABC123',
  socModel: 'Tensor', boardPlatform: 'tensor', hardwareEgl: 'angle', hardwareVulkan: 'vulkan',
  openGlEsVersion: '196610', graphicsDriver0: 'driver', graphicsDriver1: '',
  primaryAbi: 'arm64-v8a', supportedAbis: 'arm64-v8a', currentUser: '0',
  cores: '8', memKb: '8192000', gpuDriverObservation: 'GLES: ANGLE',
};
const viewport = {
  schemaVersion: 1,
  cssPixels: { width: 844, height: 390 },
  physicalPixels: { width: 2400, height: 1080 },
  devicePixelRatio: 2.75,
  nativeRotationDegrees: 90,
  screenOrientation: { type: 'landscape-primary', angle: 90 },
  pageEpoch: 1,
};

test('Gate-A mode accepts only the sealed no-hook one-ball configuration', () => {
  assert.deepEqual(validateGateAFirstBallConfiguration({
    enabled: true,
    hooks: false,
    unityRequested: true,
    allowUnityFallback: false,
    skipLifecycle: true,
    perf: false,
    recheck: false,
    artifactMode: 'sealed',
    requirePackageAbsent: true,
    apkPath: '/tmp/vande-PREVIEW-UNITY-release.apk',
    expectedApkSha256: sha256,
    expectedBuildId: buildId,
    unityPayloadBindingPath: '/tmp/vande-payload-binding.json',
    expectedUnityPayloadBindingSha256: 'b'.repeat(64),
  }), []);
});

test('Gate-A mode fails closed on hooks, fallback, lifecycle, stale metadata and a non-fresh package', () => {
  const errors = validateGateAFirstBallConfiguration({
    enabled: true,
    hooks: true,
    unityRequested: false,
    allowUnityFallback: true,
    skipLifecycle: false,
    perf: true,
    recheck: true,
    artifactMode: 'debug',
    requirePackageAbsent: false,
    apkPath: 'relative.apk',
    expectedApkSha256: 'ABC',
    expectedBuildId: 'stale',
    unityPayloadBindingPath: 'relative.json',
    expectedUnityPayloadBindingSha256: 'ABC',
  });
  assert.match(errors.join('; '), /HOOKS=0/u);
  assert.match(errors.join('; '), /UNITY=1/u);
  assert.match(errors.join('; '), /canonical absolute/u);
  assert.match(errors.join('; '), /EXPECTED_UNITY_PAYLOAD_BINDING_SHA256/u);
  assert.match(validateGateAFirstBallConfiguration({
    enabled: true,
    hooks: false,
    unityRequested: true,
    allowUnityFallback: false,
    skipLifecycle: true,
    perf: false,
    recheck: false,
    artifactMode: 'sealed',
    requirePackageAbsent: true,
    apkPath: '/tmp/vande-release.apk',
    expectedApkSha256: sha256,
    expectedBuildId: buildId,
    unityPayloadBindingPath: '/tmp/a/../binding.json',
    expectedUnityPayloadBindingSha256: 'b'.repeat(64),
  }).join('; '), /canonical absolute/u);
});

function live(overrides = {}) {
  return {
    buildId,
    renderer: 'unity-native',
    admission: 'engineering-preview',
    screen: 'live',
    phase: 'live',
    utc: '2026-10-29T09:59:59.900Z',
    hostMonotonicNs: '900000000',
    deliveryId: 'session:delivery:1',
    deliveryEventType: 'unity.release',
    deviceIdentity,
    handedness: 'right',
    viewport,
    saved: {
      inningsId: 'innings-1',
      balls: 0,
      records: 0,
      overIndex: 0,
      ballIndex: 0,
      inFlight: { overIndex: 0, ballIndex: 0 },
      lastSwingKind: null,
    },
    ...overrides,
  };
}

function liveAfterCapture() {
  return live({
    utc: '2026-10-29T10:00:00.250Z',
    hostMonotonicNs: '1250000000',
  });
}

function deadAfterCapture() {
  const before = liveAfterCapture();
  return {
    ...before,
    phase: 'dead',
    deliveryEventType: 'unity.dead',
    saved: {
      ...before.saved,
      balls: 1,
      records: 1,
      inFlight: null,
      lastSwingKind: 'defend',
    },
  };
}

test('live screenshot bracket requires immutable live Unity state', () => {
  assert.deepEqual(validateLiveFrameBracket(live(), live(), { buildId, deviceIdentity }), []);
  assert.match(
    validateLiveFrameBracket(live(), live({ phase: 'dead' }), { buildId }).join('; '),
    /not live|changed/u,
  );
  assert.match(
    validateLiveFrameBracket(live(), live({ deliveryId: 'session:delivery:2' }), { buildId }).join('; '),
    /changed/u,
  );
  assert.match(
    validateLiveFrameBracket(live(), live({ deviceIdentity: { ...deviceIdentity, buildFingerprint: 'other' } }), { buildId, deviceIdentity }).join('; '),
    /device identity|changed/u,
  );
  assert.match(
    validateLiveFrameBracket(live(), live({ handedness: 'left' }), { buildId, deviceIdentity }).join('; '),
    /handedness|changed/u,
  );
  assert.match(
    validateLiveFrameBracket(live(), live({ viewport: { ...viewport, pageEpoch: 2 } }), { buildId, deviceIdentity }).join('; '),
    /viewport|changed/u,
  );
});

function captureThenTap(before = live(), _after = live(), overrides = {}) {
  const remotePath = '/data/local/tmp/vande-gate-a-123e4567-e89b-42d3-a456-426614174000/live-frame.png';
  const rawOutput = [
    'device-uptime-after-tap=100.12 200.12',
    'bytes=4096',
    `${sha256}  ${remotePath}`,
    'transaction-status=0',
    GATE_A_CAPTURE_THEN_TAP_SUCCESS_MARKER,
  ].join('\n');
  const parsedOutput = parseGateACaptureThenTapOutput(rawOutput, remotePath);
  assert.ok(parsedOutput);
  const png = structuredClone(before.viewport.physicalPixels);
  const liveFrame = { path: 'live-frame.png', bytes: '4096', sha256, png };
  return {
    schemaVersion: 2,
    status: GATE_A_CAPTURE_THEN_TAP_STATUS,
    classification: GATE_A_CAPTURE_THEN_TAP_CLASSIFICATION,
    runId: '123e4567-e89b-42d3-a456-426614174000',
    serial: deviceIdentity.serial,
    adbEndpoint: { host: '127.0.0.1', port: 5040 },
    buildId,
    deliveryId: before.deliveryId,
    viewport: structuredClone(before.viewport),
    tapCoordinatePhysicalPixels: gateATapCoordinate(before.viewport),
    coordinateRule: GATE_A_CAPTURE_THEN_TAP_COORDINATE_RULE,
    operationOrder: [...GATE_A_CAPTURE_THEN_TAP_OPERATIONS],
    remoteShellCommand: gateACaptureThenTapCommand({ remotePath, coordinate: gateATapCoordinate(before.viewport) }),
    remoteShellTransactionCount: 1,
    gameplayTapCount: 1,
    startedUtc: '2026-10-29T10:00:00.000Z',
    finishedUtc: '2026-10-29T10:00:00.125Z',
    startedHostMonotonicNs: '1000000000',
    finishedHostMonotonicNs: '1125000000',
    successMarker: GATE_A_CAPTURE_THEN_TAP_SUCCESS_MARKER,
    successMarkerObservedCount: 1,
    successDerivation: GATE_A_CAPTURE_THEN_TAP_SUCCESS_DERIVATION,
    adbShellResult: { exitStatus: 0, stderrBytes: '0', stderrSha256: emptySha256 },
    transactionOutput: parsedOutput.transactionOutput,
    deviceUptimeAfterTap: parsedOutput.deviceUptimeAfterTap,
    remoteCapture: { ...parsedOutput.remoteCapture, png },
    nativeListenerRegistration: { epoch: 1, ok: true, reason: 'message_and_error_listeners_attached' },
    nativeEventDropCounts: { events: 0, registrations: 0 },
    nativeDeliveryEvents: [
      { epoch: 1, operationId: 'operation-1', type: 'unity.release', sequence: 10, deliveryId: before.deliveryId },
      { epoch: 1, operationId: 'operation-1', type: 'unity.pointer', sequence: 11, deliveryId: before.deliveryId },
      { epoch: 1, operationId: 'operation-1', type: 'unity.gesture', sequence: 12, deliveryId: before.deliveryId },
      { epoch: 1, operationId: 'operation-1', type: 'unity.dead', sequence: 13, deliveryId: before.deliveryId },
    ],
    liveFrame,
    ...overrides,
  };
}

test('capture-then-tap command binds 844x390 to (422,320) and one ordered ADB-injected touchscreen tap', () => {
  const exactViewport = {
    ...viewport,
    physicalPixels: { width: 844, height: 390 },
  };
  const coordinate = gateATapCoordinate(exactViewport);
  assert.deepEqual(coordinate, { x: 422, y: 320 });
  const command = gateACaptureThenTapCommand({
    remotePath: '/data/local/tmp/vande-gate-a-123e4567-e89b-42d3-a456-426614174000/live-frame.png',
    coordinate,
  });
  assert.equal(
    command,
    `screencap -p /data/local/tmp/vande-gate-a-123e4567-e89b-42d3-a456-426614174000/live-frame.png && input touchscreen tap 422 320 && printf device-uptime-after-tap= && cat /proc/uptime && printf bytes= && stat -c %s /data/local/tmp/vande-gate-a-123e4567-e89b-42d3-a456-426614174000/live-frame.png && sha256sum /data/local/tmp/vande-gate-a-123e4567-e89b-42d3-a456-426614174000/live-frame.png && printf 'transaction-status=0\\n${GATE_A_CAPTURE_THEN_TAP_SUCCESS_MARKER}'`,
  );
  assert.ok(command.startsWith('screencap -p '));
  assert.equal(command.match(/input touchscreen tap/gu)?.length, 1);
  assert.ok(command.indexOf('screencap -p') < command.indexOf('input touchscreen tap'));
  assert.equal(command.match(/mkdir|device-uptime-start/gu), null);
  assert.ok(command.indexOf('input touchscreen tap') < command.indexOf('cat /proc/uptime'));
  assert.equal(
    gateACaptureDirectoryPrepareCommand('/data/local/tmp/vande-gate-a-123e4567-e89b-42d3-a456-426614174000/live-frame.png'),
    'mkdir /data/local/tmp/vande-gate-a-123e4567-e89b-42d3-a456-426614174000 && test -d /data/local/tmp/vande-gate-a-123e4567-e89b-42d3-a456-426614174000 && test ! -e /data/local/tmp/vande-gate-a-123e4567-e89b-42d3-a456-426614174000/live-frame.png',
  );
  for (const remotePath of ['/data/local/tmp/.', '/data/local/tmp/..', '/sdcard/live-frame.png']) {
    assert.throws(() => gateACaptureThenTapCommand({ remotePath, coordinate }), /unsafe/u);
  }
});

test('capture-then-tap output parser rejects non-exact, unbounded and replayed terminal receipts', () => {
  const remotePath = '/data/local/tmp/vande-gate-a-123e4567-e89b-42d3-a456-426614174000/live-frame.png';
  const valid = [
    'device-uptime-after-tap=100.12 200.12',
    'bytes=4096',
    `${sha256}  ${remotePath}`,
    'transaction-status=0',
    GATE_A_CAPTURE_THEN_TAP_SUCCESS_MARKER,
  ].join('\n');
  assert.equal(decodeGateACaptureThenTapOutput(Buffer.from(valid)), valid);
  assert.equal(decodeGateACaptureThenTapOutput(Buffer.from([0xc3, 0x28])), null);
  assert.equal(decodeGateACaptureThenTapOutput(Buffer.from(`prefix\0${valid}`)), null);
  assert.equal(decodeGateACaptureThenTapOutput(Buffer.alloc(1_025, 0x61)), null);
  assert.ok(parseGateACaptureThenTapOutput(valid, remotePath));
  const attacks = [
    valid.replace('device-uptime-after-tap=100.12 200.12\n', ''),
    `${valid}\n`,
    `${valid}\n${GATE_A_CAPTURE_THEN_TAP_SUCCESS_MARKER}`,
    valid.replace(`${sha256}  `, `${sha256.toUpperCase()}  `),
    valid.replace('bytes=4096', 'bytes=0'),
    valid.replace('bytes=4096', `bytes=${16 * 1024 * 1024 + 1}`),
    valid.replace('device-uptime-after-tap=100.12 200.12', 'device-uptime-after-tap=invalid'),
    valid.replace('bytes=4096\n', `${sha256}  ${remotePath}\nbytes=4096\n`),
    valid.replace(GATE_A_CAPTURE_THEN_TAP_SUCCESS_MARKER, ''),
    `${valid}\0`,
    `${valid}${'x'.repeat(1_024)}`,
  ];
  for (const attacked of attacks) assert.equal(parseGateACaptureThenTapOutput(attacked, remotePath), null);
  assert.equal(parseGateACaptureThenTapOutput(valid, `${remotePath}.other`), null);
});

test('PNG geometry parser requires a complete CRC-valid PNG, not a truncated IHDR claim', () => {
  const png = rgbaPng(1, 1);
  assert.deepEqual(gateAPngDimensions(png), { width: 1, height: 1 });
  assert.equal(gateAPngDimensions(png.subarray(0, 24)), null);
  const badCrc = Buffer.from(png);
  badCrc[29] ^= 1;
  assert.equal(gateAPngDimensions(badCrc), null);
  const rewriteChunkCrc = (bytes, offset) => {
    const length = bytes.readUInt32BE(offset);
    let crc = 0xffffffff;
    for (let index = offset + 4; index < offset + 8 + length; index += 1) {
      crc = pngCrcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    }
    bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, offset + 8 + length);
  };
  const idatOffset = chunkOffset(png, 'IDAT');
  const crcValidCorruptIdat = Buffer.from(png);
  crcValidCorruptIdat[idatOffset + 8] ^= 0xff;
  rewriteChunkCrc(crcValidCorruptIdat, idatOffset);
  assert.equal(gateAPngDimensions(crcValidCorruptIdat), null);
  const idatLength = png.readUInt32BE(idatOffset);
  const idatData = png.subarray(idatOffset + 8, idatOffset + 8 + idatLength);
  const splitAt = Math.max(1, Math.floor(idatData.length / 2));
  const splitIdatPng = Buffer.concat([
    png.subarray(0, idatOffset),
    pngChunk('IDAT', idatData.subarray(0, splitAt)),
    pngChunk('IDAT', idatData.subarray(splitAt)),
    png.subarray(idatOffset + 12 + idatLength),
  ]);
  assert.deepEqual(gateAPngDimensions(splitIdatPng), { width: 1, height: 1 });
  assert.equal(gateAPngDimensions(Buffer.concat([
    png.subarray(0, idatOffset),
    pngChunk('IDAT', idatData.subarray(0, splitAt)),
    pngChunk('sRGB', Buffer.from([0])),
    pngChunk('IDAT', idatData.subarray(splitAt)),
    png.subarray(idatOffset + 12 + idatLength),
  ])), null);
  const duplicatedLength = Buffer.alloc(4);
  duplicatedLength.writeUInt32BE(idatLength * 2);
  const duplicateZlibStream = Buffer.concat([
    png.subarray(0, idatOffset),
    duplicatedLength,
    png.subarray(idatOffset + 4, idatOffset + 8),
    png.subarray(idatOffset + 8, idatOffset + 8 + idatLength),
    png.subarray(idatOffset + 8, idatOffset + 8 + idatLength),
    Buffer.alloc(4),
    png.subarray(idatOffset + 12 + idatLength),
  ]);
  rewriteChunkCrc(duplicateZlibStream, idatOffset);
  assert.equal(gateAPngDimensions(duplicateZlibStream), null);
  const interlaced = Buffer.from(png);
  interlaced[28] = 1;
  rewriteChunkCrc(interlaced, 8);
  assert.equal(gateAPngDimensions(interlaced), null);
  assert.equal(gateAPngDimensions(palettePngWithoutPlte(1, 1)), null);
  assert.equal(gateAPngDimensions(Buffer.concat([
    png.subarray(0, idatOffset),
    pngChunk('ABCD', Buffer.alloc(0)),
    png.subarray(idatOffset),
  ])), null);
  const srgbOffset = chunkOffset(png, 'sRGB');
  const sbitOffset = chunkOffset(png, 'sBIT');
  assert.equal(gateAPngDimensions(Buffer.concat([
    png.subarray(0, srgbOffset),
    png.subarray(8, srgbOffset),
    png.subarray(srgbOffset),
  ])), null);
  assert.equal(gateAPngDimensions(Buffer.concat([
    png.subarray(0, srgbOffset),
    png.subarray(sbitOffset, idatOffset),
    png.subarray(srgbOffset, sbitOffset),
    png.subarray(idatOffset),
  ])), null);
  assert.equal(gateAPngDimensions(Buffer.concat([
    png.subarray(0, sbitOffset),
    png.subarray(srgbOffset, sbitOffset),
    png.subarray(sbitOffset),
  ])), null);
  assert.equal(gateAPngDimensions(Buffer.concat([png, Buffer.from([0])])), null);
});

test('capture-then-tap receipt binds live frame, tap and same-delivery native pointer then gesture', () => {
  const before = live();
  const after = liveAfterCapture();
  const dead = deadAfterCapture();
  const receipt = captureThenTap(before, after);
  assert.deepEqual(validateGateACaptureThenTapReceipt(receipt, {
    before,
    after,
    dead,
    expectedBuildId: buildId,
    expectedRunId: receipt.runId,
    expectedSerial: deviceIdentity.serial,
    expectedAdbEndpoint: { host: '127.0.0.1', port: 5040 },
    expectedLiveFrame: receipt.liveFrame,
  }), []);
});

test('capture-then-tap permits playing only as unchanged in-flight or exact authoritative resolved state', () => {
  const before = live();
  const playing = liveAfterCapture();
  playing.phase = 'playing';
  playing.deliveryEventType = 'unity.gesture';
  const dead = deadAfterCapture();
  const receipt = captureThenTap(before, playing);
  assert.deepEqual(validateGateACaptureThenTapReceipt(receipt, {
    before,
    after: playing,
    dead,
    expectedBuildId: buildId,
    expectedLiveFrame: receipt.liveFrame,
  }), []);

  const resolvedWhilePlaying = structuredClone(playing);
  resolvedWhilePlaying.saved = structuredClone(dead.saved);
  assert.deepEqual(validateGateACaptureThenTapReceipt(receipt, {
    before,
    after: resolvedWhilePlaying,
    dead,
    expectedBuildId: buildId,
    expectedLiveFrame: receipt.liveFrame,
  }), []);

  const contradictoryResolution = structuredClone(playing);
  contradictoryResolution.saved = {
    ...dead.saved,
    records: 0,
    inFlight: { overIndex: 0, ballIndex: 0 },
  };
  assert.match(validateGateACaptureThenTapReceipt(receipt, {
    before,
    after: contradictoryResolution,
    dead,
    expectedBuildId: buildId,
    expectedLiveFrame: receipt.liveFrame,
  }).join('; '), /neither unchanged in-flight state nor the exact authoritative resolved state/u);

  const noAcceptedSwingDead = structuredClone(dead);
  noAcceptedSwingDead.saved.lastSwingKind = null;
  const noAcceptedSwingPlaying = structuredClone(playing);
  noAcceptedSwingPlaying.saved = structuredClone(noAcceptedSwingDead.saved);
  assert.match(validateGateACaptureThenTapReceipt(receipt, {
    before,
    after: noAcceptedSwingPlaying,
    dead: noAcceptedSwingDead,
    expectedBuildId: buildId,
    expectedLiveFrame: receipt.liveFrame,
  }).join('; '), /accepted gameplay swing kind|neither unchanged in-flight state nor the exact authoritative resolved state/u);

  const latentSavedMutation = structuredClone(playing);
  latentSavedMutation.saved.lastSwingKind = 'attack';
  assert.match(validateGateACaptureThenTapReceipt(receipt, {
    before,
    after: latentSavedMutation,
    dead,
    expectedBuildId: buildId,
    expectedLiveFrame: receipt.liveFrame,
  }).join('; '), /neither unchanged in-flight state nor the exact authoritative resolved state/u);
});

test('native listener receipt projects the bounded producer registration and rejects ambiguity', () => {
  const producerRegistration = {
    epoch: 1,
    utc: '2026-10-29T10:00:00.000Z',
    ok: true,
    reason: 'message_and_error_listeners_attached',
  };
  assert.deepEqual(gateANativeListenerRegistration([producerRegistration], 1), {
    epoch: 1,
    ok: true,
    reason: 'message_and_error_listeners_attached',
  });
  assert.equal(gateANativeListenerRegistration([producerRegistration, producerRegistration], 1), null);
});

test('dead post-observation must exactly bind the authoritative dead state', () => {
  const before = live();
  const after = deadAfterCapture();
  const receipt = captureThenTap(before, after);
  assert.deepEqual(validateGateACaptureThenTapReceipt(receipt, {
    before,
    after,
    dead: structuredClone(after),
    expectedBuildId: buildId,
    expectedLiveFrame: receipt.liveFrame,
  }), []);
  const differentDead = structuredClone(after);
  differentDead.saved.lastSwingKind = 'attack';
  assert.match(validateGateACaptureThenTapReceipt(receipt, {
    before,
    after,
    dead: differentDead,
    expectedBuildId: buildId,
    expectedLiveFrame: receipt.liveFrame,
  }).join('; '), /not identical to the authoritative dead state/u);
});

test('capture-then-tap receipt rejects missing, duplicate and out-of-order native evidence', () => {
  const before = live();
  const after = liveAfterCapture();
  const dead = deadAfterCapture();
  const cases = [
    ['missing', [
      { epoch: 1, operationId: 'operation-1', type: 'unity.release', sequence: 10, deliveryId: before.deliveryId },
      { epoch: 1, operationId: 'operation-1', type: 'unity.pointer', sequence: 11, deliveryId: before.deliveryId },
      { epoch: 1, operationId: 'operation-1', type: 'unity.gesture', sequence: 12, deliveryId: before.deliveryId },
    ]],
    ['duplicate', [
      { epoch: 1, operationId: 'operation-1', type: 'unity.release', sequence: 10, deliveryId: before.deliveryId },
      { epoch: 1, operationId: 'operation-1', type: 'unity.pointer', sequence: 11, deliveryId: before.deliveryId },
      { epoch: 1, operationId: 'operation-1', type: 'unity.pointer', sequence: 12, deliveryId: before.deliveryId },
      { epoch: 1, operationId: 'operation-1', type: 'unity.gesture', sequence: 13, deliveryId: before.deliveryId },
      { epoch: 1, operationId: 'operation-1', type: 'unity.dead', sequence: 14, deliveryId: before.deliveryId },
    ]],
    ['out-of-order type', [
      { epoch: 1, operationId: 'operation-1', type: 'unity.release', sequence: 10, deliveryId: before.deliveryId },
      { epoch: 1, operationId: 'operation-1', type: 'unity.gesture', sequence: 11, deliveryId: before.deliveryId },
      { epoch: 1, operationId: 'operation-1', type: 'unity.pointer', sequence: 12, deliveryId: before.deliveryId },
      { epoch: 1, operationId: 'operation-1', type: 'unity.dead', sequence: 13, deliveryId: before.deliveryId },
    ]],
    ['out-of-order sequence', [
      { epoch: 1, operationId: 'operation-1', type: 'unity.release', sequence: 10, deliveryId: before.deliveryId },
      { epoch: 1, operationId: 'operation-1', type: 'unity.pointer', sequence: 12, deliveryId: before.deliveryId },
      { epoch: 1, operationId: 'operation-1', type: 'unity.gesture', sequence: 11, deliveryId: before.deliveryId },
      { epoch: 1, operationId: 'operation-1', type: 'unity.dead', sequence: 13, deliveryId: before.deliveryId },
    ]],
  ];
  for (const [name, nativeDeliveryEvents] of cases) {
    assert.match(
      validateGateACaptureThenTapReceipt(captureThenTap(before, after, { nativeDeliveryEvents }), {
        before,
        after,
        dead,
        expectedBuildId: buildId,
        expectedLiveFrame: captureThenTap(before, after).liveFrame,
      }).join('; '),
      /exactly release, pointer, gesture then dead|missing, duplicated or out of release-pointer-gesture-dead order/u,
      name,
    );
  }
});

test('capture-then-tap receipt rejects wrong coordinate, order, delivery, build and viewport', () => {
  const before = live();
  const after = liveAfterCapture();
  const dead = deadAfterCapture();
  const cases = [
    ['coordinate', { tapCoordinatePhysicalPixels: { x: 421, y: 320 } }, /coordinate/u],
    ['order', { operationOrder: ['input-tap', 'screencap-png'] }, /operation order/u],
    ['delivery', { deliveryId: 'other-delivery' }, /delivery ID|another delivery/u],
    ['build', { buildId: '38924bd+ffffffffffff' }, /build ID/u],
    ['viewport', { viewport: { ...viewport, physicalPixels: { width: 844, height: 390 } } }, /viewport/u],
  ];
  for (const [name, overrides, pattern] of cases) {
    assert.match(
      validateGateACaptureThenTapReceipt(captureThenTap(before, after, overrides), {
        before,
        after,
        dead,
        expectedBuildId: buildId,
        expectedLiveFrame: captureThenTap(before, after, overrides).liveFrame,
      }).join('; '),
      pattern,
      name,
    );
  }
});

test('capture-then-tap receipt rejects endpoint, raw-output, PNG, listener, drop and time attacks', () => {
  const before = live();
  const after = liveAfterCapture();
  const dead = deadAfterCapture();
  const base = captureThenTap(before, after);
  const cases = [
    ['default ADB endpoint', (value) => { value.adbEndpoint.port = 5037; }, /ADB endpoint/u],
    ['schema downgrade', (value) => { value.schemaVersion = 1; }, /schemaVersion/u],
    ['extra receipt key', (value) => { value.unbounded = true; }, /keys are not exact/u],
    ['run mismatch', (value) => { value.runId = '223e4567-e89b-42d3-a456-426614174000'; }, /run ID|remote shell command|remote capture identity/u],
    ['serial mismatch', (value) => { value.serial = 'emulator-5590'; }, /serial/u],
    ['command mismatch', (value) => { value.remoteShellCommand += ' '; }, /remote shell command/u],
    ['non-atomic preexistence check', (value) => {
      value.remoteShellCommand = `[ ! -e stale-path ] && ${value.remoteShellCommand}`;
    }, /remote shell command/u],
    ['outer ADB nonzero', (value) => { value.adbShellResult.exitStatus = 1; }, /outer ADB shell result/u],
    ['outer ADB stderr', (value) => {
      value.adbShellResult.stderrBytes = '4';
      value.adbShellResult.stderrSha256 = 'b'.repeat(64);
    }, /outer ADB shell result/u],
    ['altered raw output', (value) => { value.transactionOutput.utf8 += '\n'; }, /raw transaction output/u],
    ['remote hash', (value) => { value.remoteCapture.sha256 = 'b'.repeat(64); }, /remote capture identity/u],
    ['PNG geometry', (value) => { value.liveFrame.png.width -= 1; }, /PNG bytes, hash or exact viewport geometry/u],
    ['listener epoch', (value) => { value.nativeListenerRegistration.epoch = 2; }, /listener.*same page epoch/u],
    ['listener extra key', (value) => { value.nativeListenerRegistration.utc = before.utc; }, /listener.*same page epoch/u],
    ['dropped event', (value) => { value.nativeEventDropCounts.events = 1; }, /event evidence was dropped/u],
    ['dropped registration', (value) => { value.nativeEventDropCounts.registrations = 1; }, /event evidence was dropped/u],
    ['host bracket', (value) => { value.startedHostMonotonicNs = before.hostMonotonicNs; }, /strictly bracketed/u],
    ['event epoch', (value) => { value.nativeDeliveryEvents[1].epoch = 2; }, /native pointer evidence/u],
    ['event operation', (value) => { value.nativeDeliveryEvents[2].operationId = 'operation-2'; }, /native gesture evidence/u],
  ];
  for (const [name, mutate, pattern] of cases) {
    const attacked = structuredClone(base);
    mutate(attacked);
    assert.match(validateGateACaptureThenTapReceipt(attacked, {
      before,
      after,
      dead,
      expectedBuildId: buildId,
      expectedRunId: base.runId,
      expectedSerial: deviceIdentity.serial,
      expectedAdbEndpoint: { host: '127.0.0.1', port: 5040 },
      expectedLiveFrame: base.liveFrame,
    }).join('; '), pattern, name);
  }
});

test('first-ball transition requires one tap, one authoritative record and no second ball', () => {
  const before = live();
  const after = live({
    phase: 'dead',
    saved: {
      ...before.saved,
      balls: 1,
      records: 1,
      inFlight: null,
      lastSwingKind: 'defend',
    },
  });
  assert.deepEqual(validateFirstBallTransition(before, after, { tapCount: 1 }), []);
  assert.deepEqual(validateFirstBallTransition(before, {
    ...after,
    saved: { ...after.saved, lastSwingKind: 'attack' },
  }, { tapCount: 1 }), []);
  assert.match(
    validateFirstBallTransition(before, {
      ...after,
      saved: { ...after.saved, lastSwingKind: null },
    }, { tapCount: 1 }).join('; '),
    /accepted gameplay swing kind/u,
  );
  assert.match(
    validateFirstBallTransition(before, {
      ...after,
      saved: { ...after.saved, lastSwingKind: 'leave' },
    }, { tapCount: 1 }).join('; '),
    /accepted gameplay swing kind/u,
  );
  assert.match(
    validateFirstBallTransition(before, { ...after, saved: { ...after.saved, balls: 2, records: 2 } }, { tapCount: 2 }).join('; '),
    /tap count|exactly one/u,
  );
  assert.match(
    validateFirstBallTransition(before, { ...after, deliveryId: 'other' }, { tapCount: 1 }).join('; '),
    /delivery identity/u,
  );
  assert.match(
    validateFirstBallTransition(before, { ...after, saved: { ...after.saved, overIndex: 9, ballIndex: 5 } }, { tapCount: 1 }).join('; '),
    /coordinate 0:0/u,
  );
  const presentationAttacks = [
    { ...after, handedness: 'left' },
    { ...after, handedness: undefined },
    { ...after, viewport: undefined },
    { ...after, viewport: { ...viewport, cssPixels: { ...viewport.cssPixels, width: 843 } } },
    { ...after, viewport: { ...viewport, devicePixelRatio: 3 } },
    { ...after, viewport: { ...viewport, nativeRotationDegrees: 270 } },
    { ...after, viewport: { ...viewport, pageEpoch: 2 } },
  ];
  for (const attacked of presentationAttacks) {
    assert.match(
      validateFirstBallTransition(before, attacked, { tapCount: 1 }).join('; '),
      /handedness|viewport/u,
    );
  }
});

test('package absence accepts only API-36 pm-path exit 1 with byte-empty streams', () => {
  assert.deepEqual(classifyPmPathAbsence({ status: 1, stdout: '', stderr: '' }), {
    absent: true,
    policy: 'ANDROID_PM_PATH_ABSENT_EXIT_1_EMPTY_STREAMS_V1',
    exitStatus: 1,
  });
  for (const value of [
    { status: 0, stdout: '', stderr: '' },
    { status: 1, stdout: '\n', stderr: '' },
    { status: 1, stdout: 'package:/data/app/base.apk\n', stderr: '' },
    { status: 1, stdout: '', stderr: 'device offline\n' },
    { status: 2, stdout: '', stderr: '' },
  ]) assert.equal(classifyPmPathAbsence(value).absent, false, JSON.stringify(value));
});
