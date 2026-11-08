#!/usr/bin/env node

/**
 * Produce a provenance-bound Gate-A current/target still comparison.
 *
 * The Android image must be the exact live frame referenced by an accepted
 * first-playable-ball receipt. The target remains a static visual direction;
 * this tool never promotes it to runtime, player, performance or CERI evidence.
 */

import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  gateAStateKey,
  validateGateACaptureThenTapReceipt,
  validateFirstBallTransition,
} from '../../android-gate-a.mjs';
import { validateGateAUnityEvidenceFromFirstBall } from '../../android-gate-a-unity-admission.mjs';
import {
  androidDeviceIdentitySha256,
  sameAndroidDeviceIdentity,
  validateAndroidDeviceIdentity,
} from '../../android-device-identity.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SHA256 = /^[0-9a-f]{64}$/u;
const BUILD_ID = /^[0-9a-f]{7,40}(?:\+[0-9a-f]{12})?$/u;
const FIRST_DELIVERY_ID = /^[A-Za-z0-9._+-]{1,96}:delivery:1$/u;
// This exact value is the current source contract in
// src/practice/unity/engineeringPreview.ts. No stronger production admission
// contract exists yet, so accepting an arbitrary non-empty string is unsafe.
const CURRENT_ADMISSION = 'engineering-preview-unqualified';
const TARGET_HANDEDNESS = 'right';
const DEFAULT_PANEL = Object.freeze({ width: 915, height: 412 });
const MIN_STILL = Object.freeze({ width: 320, height: 180 });
const MAX_STILL = Object.freeze({ width: 8192, height: 4320 });
const GAP = 16;
const HEADER = 44;
const BACKGROUND = Object.freeze({ r: 9, g: 14, b: 22, alpha: 1 });

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readRegularFile(path, label) {
  const resolved = resolve(path);
  const stat = lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  return { path: resolved, bytes: readFileSync(resolved) };
}

function writeNew(path, bytes) {
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
}

function exactJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function within(parent, child) {
  const value = relative(parent, child);
  return value !== '' && value !== '..' && !value.startsWith(`..${sep}`) && !value.startsWith(sep);
}

function appendErrors(errors, prefix, values) {
  for (const value of values) errors.push(`${prefix}: ${value}`);
}

function validateInventory(inventory, artifactSha256, label, errors) {
  if (!Array.isArray(inventory) || inventory.length !== 1) {
    errors.push(`${label} is not exactly one installed APK`);
    return;
  }
  const [entry] = inventory;
  if (typeof entry?.path !== 'string' || !entry.path.startsWith('/') || !SHA256.test(entry?.sha256 ?? '')) {
    errors.push(`${label} entry is invalid`);
  } else if (entry.sha256 !== artifactSha256) {
    errors.push(`${label} artifact SHA-256 differs`);
  }
}

function validateArtifactBinding(receipt, errors) {
  const artifact = receipt?.artifact;
  if (!artifact || typeof artifact.path !== 'string' || !isAbsolute(artifact.path)
      || !SHA256.test(artifact.sha256 ?? '') || !/^(?:0|[1-9][0-9]*)$/u.test(artifact.bytes ?? '')) {
    errors.push('sealed artifact identity is invalid');
    return null;
  }

  let currentArtifact;
  try {
    currentArtifact = readRegularFile(artifact.path, 'sealed artifact');
  } catch (error) {
    errors.push(`sealed artifact cannot be read: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  if (sha256Bytes(currentArtifact.bytes) !== artifact.sha256) errors.push('sealed artifact file SHA-256 differs');
  if (String(currentArtifact.bytes.length) !== artifact.bytes) errors.push('sealed artifact file byte count differs');

  validateInventory(receipt.installedPackageInventoryBefore, artifact.sha256, 'pre-capture installed-package inventory', errors);
  validateInventory(receipt.installedPackageInventoryAfter, artifact.sha256, 'post-capture installed-package inventory', errors);
  if (!exactJson(receipt.installedPackageInventoryBefore, receipt.installedPackageInventoryAfter)) {
    errors.push('installed-package inventory changed across first-ball capture');
  }

  const wrapper = receipt?.sealedWrapperEvidence;
  const transaction = wrapper?.installTransactionReceipt;
  if (wrapper?.artifactIdentity?.path !== artifact.path
      || wrapper?.artifactIdentity?.sha256 !== artifact.sha256
      || !exactJson(wrapper?.artifactIdentity?.identity, artifact.identity)
      || !exactJson(wrapper?.artifactIdentity?.parentIdentity, artifact.parentIdentity)) {
    errors.push('sealed-wrapper artifact identity differs');
  }
  if (transaction?.status !== 'SEALED_INSTALL_COMPLETED'
      || transaction?.buildId !== receipt.buildId
      || transaction?.serial !== receipt.serial
      || transaction?.artifact?.path !== artifact.path
      || transaction?.artifact?.sha256 !== artifact.sha256
      || transaction?.postInstallArtifact?.path !== artifact.path
      || transaction?.postInstallArtifact?.sha256 !== artifact.sha256
      || !exactJson(transaction?.installedPackageInventory, receipt.installedPackageInventoryBefore)) {
    errors.push('sealed install transaction does not bind the same build/device/artifact/inventory');
  }
  return currentArtifact;
}

function resolvedObservationKey(observation, phase = observation?.phase ?? null) {
  return {
    screen: observation?.screen ?? null,
    phase,
    buildId: observation?.buildId ?? null,
    renderer: observation?.renderer ?? null,
    admission: observation?.admission ?? null,
    deliveryId: observation?.deliveryId ?? null,
    deviceIdentity: observation?.deviceIdentity ?? null,
    handedness: observation?.handedness ?? null,
    viewport: observation?.viewport ?? null,
    saved: observation?.saved ?? null,
  };
}

function validatePlayingPostObservation(before, after, dead, { tapCount }) {
  if (after?.phase !== 'playing') return [];

  const unchangedInFlight = exactJson(gateAStateKey(before), gateAStateKey(after))
    && exactJson(before?.saved, after?.saved);
  const normalizedResolvedAfter = { ...after, phase: 'dead' };
  const resolvedTransitionErrors = validateFirstBallTransition(before, normalizedResolvedAfter, {
    tapCount,
  });
  const exactAuthoritativeResolvedState = resolvedTransitionErrors.length === 0
    && exactJson(
      resolvedObservationKey(normalizedResolvedAfter),
      resolvedObservationKey(dead),
    );

  if (unchangedInFlight || exactAuthoritativeResolvedState) return [];
  return [
    'playing post-observation is neither unchanged in-flight state nor the exact authoritative resolved dead state',
    ...resolvedTransitionErrors.map((error) => `resolved playing transition: ${error}`),
  ];
}

function validateLiveReceipt(receipt, {
  receiptPath,
  currentImagePath,
  currentImageSha256,
  currentImageBytes,
  expectedBuildId,
}) {
  const errors = [];
  if (receipt?.schemaVersion !== 2) errors.push('first-playable receipt schemaVersion is not 2');
  if (receipt?.classification !== 'LOCAL_ENGINEERING_ONLY') errors.push('first-playable receipt classification is not exact');
  if (receipt?.harnessFinalStatus !== 'ACCEPTED') errors.push('first-playable harness final status is not ACCEPTED');
  if (receipt?.buildId !== expectedBuildId) errors.push('first-playable build ID differs');
  if (receipt?.renderer !== 'unity-native') errors.push('current renderer is not unity-native');
  if (receipt?.admission !== CURRENT_ADMISSION) errors.push(`Unity admission is not exact ${CURRENT_ADMISSION}`);
  if (!Array.isArray(receipt?.crashOrAnrLines) || receipt.crashOrAnrLines.length !== 0) {
    errors.push('crash/ANR evidence is not exactly empty');
  }
  if (receipt?.webErrorCount !== 0) errors.push('WebView error count is not zero');
  if (receipt?.nativeErrorCount !== 0) errors.push('native Unity error count is not zero');
  if (receipt?.hooksPresent !== false) errors.push('test hooks were present');
  if (receipt?.gameplayTapCount !== 1) {
    errors.push('first-playable receipt does not bind one ADB-injected touchscreen tap');
  }
  if (receipt?.lifecycleOrPerformanceModeUsed !== false) errors.push('lifecycle/performance mode contaminated the first-ball run');
  if (receipt?.secondBallStarted !== false) errors.push('a second ball started');
  if (!Array.isArray(receipt?.outOfBandAppDataOperations) || receipt.outOfBandAppDataOperations.length !== 0) {
    errors.push('out-of-band app-data operations are not exactly empty');
  }

  const identityErrors = validateAndroidDeviceIdentity(receipt?.deviceIdentity);
  appendErrors(errors, 'top-level Android device identity is invalid', identityErrors);
  if (receipt?.serial !== receipt?.deviceIdentity?.serial
      || String(receipt?.user ?? '') !== receipt?.deviceIdentity?.currentUser) {
    errors.push('receipt serial/user does not match the exact Android device identity');
  }
  if (!sameAndroidDeviceIdentity(receipt?.deviceIdentity, receipt?.sealedWrapperEvidence?.deviceIdentity)
      || !sameAndroidDeviceIdentity(receipt?.deviceIdentity, receipt?.sealedWrapperEvidence?.installTransactionReceipt?.deviceIdentity)) {
    errors.push('top-level device identity differs from sealed install evidence');
  }

  const before = receipt?.stateBefore;
  const after = receipt?.stateAfter;
  const dead = receipt?.deadState;
  const stable = receipt?.stableBoundary;
  appendErrors(errors, 'capture-then-tap receipt', validateGateACaptureThenTapReceipt(receipt?.captureThenTap, {
    before,
    after,
    dead,
    expectedBuildId,
    expectedRunId: receipt?.runId,
    expectedSerial: receipt?.serial,
    expectedAdbEndpoint: receipt?.adbServer,
    expectedLiveFrame: receipt?.liveFrame,
  }));
  appendErrors(errors, 'dead first-ball transition', validateFirstBallTransition(before, dead, {
    tapCount: receipt?.gameplayTapCount,
  }));
  appendErrors(errors, 'stable first-ball transition', validateFirstBallTransition(before, stable, {
    tapCount: receipt?.gameplayTapCount,
  }));
  for (const [label, state, phases] of [
    ['before', before, ['live']],
    ['after', after, ['live', 'playing', 'dead']],
    ['dead', dead, ['dead']],
    ['stable', stable, ['dead']],
  ]) {
    if (!phases.includes(state?.phase)) errors.push(`${label} phase is not ${phases.join(' or ')}`);
    if (state?.screen !== 'live') errors.push(`${label} screen is not the live Practice screen`);
    if (state?.renderer !== 'unity-native') errors.push(`${label} renderer is not unity-native`);
    if (state?.buildId !== expectedBuildId) errors.push(`${label} build ID differs`);
    if (state?.admission !== CURRENT_ADMISSION) errors.push(`${label} admission is not exact ${CURRENT_ADMISSION}`);
    if (state?.deliveryId !== before?.deliveryId) errors.push(`${label} delivery identity differs`);
    if (state?.handedness !== receipt?.handedness) errors.push(`${label} handedness differs from the top-level receipt`);
    if (!exactJson(state?.viewport, receipt?.viewport)) errors.push(`${label} viewport differs from the top-level receipt`);
  }
  if (!['right', 'left'].includes(receipt?.handedness)) errors.push('top-level handedness is not exact right or left');
  if (!receipt?.viewport || typeof receipt.viewport !== 'object') errors.push('top-level viewport attestation is missing');
  if (!FIRST_DELIVERY_ID.test(before?.deliveryId ?? '')) {
    errors.push('native delivery identity is not the exact first Unity delivery');
  }
  if (after?.phase === 'live' && !exactJson(before?.saved, after?.saved)) {
    errors.push('saved state changed before the authoritative ball resolved');
  }
  appendErrors(errors, 'playing post-observation', validatePlayingPostObservation(before, after, dead, {
    tapCount: receipt?.gameplayTapCount,
  }));
  if (!exactJson(gateAStateKey(dead), gateAStateKey(stable))
      || !exactJson(dead?.saved, stable?.saved)) {
    errors.push('dead and stable first-ball state differ');
  }
  if (receipt?.renderer !== before?.renderer || receipt?.admission !== before?.admission
      || receipt?.buildId !== before?.buildId) {
    errors.push('top-level build/renderer/admission differs from the live state');
  }

  validateArtifactBinding(receipt, errors);
  appendErrors(errors, 'full H7 Unity payload replay', validateGateAUnityEvidenceFromFirstBall({
    receipt,
    evidenceRoot: dirname(receiptPath),
    expectedBuildId,
    expectedApkSha256: receipt?.artifact?.sha256,
  }));
  if (!SHA256.test(receipt?.liveFrame?.sha256 ?? '')) errors.push('live-frame receipt SHA-256 is invalid');
  if (receipt?.liveFrame?.bytes !== String(currentImageBytes)) {
    errors.push('current live-frame byte length differs from the receipt');
  }
  const boundImage = resolve(dirname(receiptPath), receipt?.liveFrame?.path ?? '');
  if (!within(dirname(receiptPath), boundImage) || boundImage !== currentImagePath) {
    errors.push('current image is not the receipt-bound live frame');
  }
  if (receipt?.liveFrame?.sha256 !== currentImageSha256) errors.push('current live-frame SHA-256 differs');
  if (errors.length) throw new Error(`Gate-A current still rejected: ${errors.join('; ')}`);
}

function headerSvg(width, leftWidth, rightStart) {
  const escape = (value) => value.replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]);
  const left = escape('EXACT CURRENT ANDROID · UNITY-NATIVE');
  const right = escape('STATIC GOLDEN DIRECTION · NOT RUNTIME');
  return Buffer.from(`
    <svg width="${width}" height="${HEADER}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#09101a"/>
      <rect x="0" y="${HEADER - 4}" width="${leftWidth}" height="4" fill="#4ec9b0"/>
      <rect x="${rightStart}" y="${HEADER - 4}" width="${width - rightStart}" height="4" fill="#f5b033"/>
      <text x="12" y="28" fill="#e8f1f7" font-size="15" font-family="sans-serif" font-weight="700">${left}</text>
      <text x="${rightStart + 12}" y="28" fill="#e8f1f7" font-size="15" font-family="sans-serif" font-weight="700">${right}</text>
    </svg>`);
}

async function metadataFor(bytes, label) {
  const metadata = await sharp(bytes, { failOn: 'error' }).metadata();
  if (metadata.format !== 'png' || !metadata.width || !metadata.height) {
    throw new Error(`${label} must be a decodable PNG with dimensions`);
  }
  if (metadata.width < MIN_STILL.width || metadata.height < MIN_STILL.height
      || metadata.width > MAX_STILL.width || metadata.height > MAX_STILL.height
      || metadata.width < metadata.height) {
    throw new Error(`${label} dimensions ${metadata.width}x${metadata.height} are not a bounded landscape gameplay still`);
  }
  if ((metadata.pages ?? 1) !== 1) throw new Error(`${label} must be one static PNG frame`);
  return { width: metadata.width, height: metadata.height, format: metadata.format };
}

async function normalizedPanel(bytes, panel) {
  return sharp(bytes, { failOn: 'error' })
    .resize(panel.width, panel.height, {
      fit: 'contain',
      position: 'centre',
      background: BACKGROUND,
      kernel: sharp.kernel.lanczos3,
    })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}

async function composePair({ left, right, panelWidth, panelHeight, preservePixels }) {
  const leftMeta = await metadataFor(left, 'current image');
  const rightMeta = await metadataFor(right, 'target image');
  const panel = preservePixels
    ? { width: Math.max(leftMeta.width, rightMeta.width), height: Math.max(leftMeta.height, rightMeta.height) }
    : { width: panelWidth, height: panelHeight };
  const leftBuffer = preservePixels ? left : await normalizedPanel(left, panel);
  const rightBuffer = preservePixels ? right : await normalizedPanel(right, panel);
  const leftRendered = await metadataFor(leftBuffer, 'rendered current image');
  const rightRendered = await metadataFor(rightBuffer, 'rendered target image');
  const width = panel.width * 2 + GAP;
  const height = panel.height + HEADER;
  const rightStart = panel.width + GAP;
  const composites = [
    { input: headerSvg(width, panel.width, rightStart), left: 0, top: 0 },
    {
      input: leftBuffer,
      left: Math.floor((panel.width - leftRendered.width) / 2),
      top: HEADER + Math.floor((panel.height - leftRendered.height) / 2),
    },
    {
      input: rightBuffer,
      left: rightStart + Math.floor((panel.width - rightRendered.width) / 2),
      top: HEADER + Math.floor((panel.height - rightRendered.height) / 2),
    },
  ];
  const bytes = await sharp({ create: { width, height, channels: 4, background: BACKGROUND } })
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
  return {
    bytes,
    canvas: { width, height },
    panel,
    source: { current: leftMeta, target: rightMeta },
    transform: preservePixels
      ? { current: 'none', target: 'none', placement: 'centred without source-pixel transformation' }
      : { current: 'sharp fit=contain lanczos3', target: 'sharp fit=contain lanczos3', placement: 'centred with opaque letterbox' },
  };
}

function comparisonIdentity(receipt, source) {
  const attestedViewport = receipt?.viewport?.physicalPixels;
  const attestedLogicalViewport = receipt?.viewport?.cssPixels;
  const attestedDevicePixelRatio = receipt?.viewport?.devicePixelRatio;
  if (source.current.width !== attestedViewport?.width
      || source.current.height !== attestedViewport?.height) {
    throw new Error('Gate-A current still rejected: receipt-bound image dimensions differ from authoritative native geometry');
  }
  const physicalViewportMatch = source.current.width === source.target.width
    && source.current.height === source.target.height;
  const logicalViewportMatch = attestedLogicalViewport?.width === source.target.width
    && attestedLogicalViewport?.height === source.target.height;
  const devicePixelRatioMatch = attestedDevicePixelRatio === 1;
  const attestedHandedness = receipt?.handedness;
  if (!['right', 'left'].includes(attestedHandedness)) {
    throw new Error('Gate-A current still rejected: current handedness attestation is invalid');
  }
  for (const [label, state] of [
    ['before', receipt?.stateBefore],
    ['after', receipt?.stateAfter],
    ['dead', receipt?.deadState],
    ['stable', receipt?.stableBoundary],
  ]) {
    if (!['right', 'left'].includes(state?.handedness)) {
      throw new Error(`Gate-A current still rejected: ${label} handedness attestation is invalid`);
    }
    if (state.handedness !== attestedHandedness) {
      throw new Error(`Gate-A current still rejected: ${label} handedness differs from the current receipt`);
    }
  }

  const handednessStatus = attestedHandedness === TARGET_HANDEDNESS ? 'EXACT_MATCH' : 'MISMATCH';
  const reasons = [];
  if (!physicalViewportMatch) reasons.push('EXACT_VIEWPORT_MISMATCH');
  if (!logicalViewportMatch) reasons.push('EXACT_LOGICAL_VIEWPORT_MISMATCH');
  if (!devicePixelRatioMatch) reasons.push('DEVICE_PIXEL_RATIO_MISMATCH');
  if (handednessStatus === 'MISMATCH') reasons.push('HANDEDNESS_MISMATCH');
  return {
    status: reasons.length === 0 ? 'COMPARABLE' : 'NOT_COMPARABLE',
    reasons,
    viewport: {
      status: physicalViewportMatch && logicalViewportMatch && devicePixelRatioMatch
        ? 'EXACT_MATCH' : 'MISMATCH',
      basis: 'receipt-bound source PNG physical pixels plus exact logical CSS viewport and devicePixelRatio=1 for the static target',
      current: { width: source.current.width, height: source.current.height },
      target: { width: source.target.width, height: source.target.height },
      attestedCurrent: { width: attestedViewport.width, height: attestedViewport.height },
      logicalCurrent: {
        width: attestedLogicalViewport?.width ?? null,
        height: attestedLogicalViewport?.height ?? null,
      },
      targetLogical: { width: source.target.width, height: source.target.height },
      devicePixelRatio: {
        current: attestedDevicePixelRatio,
        target: 1,
        status: devicePixelRatioMatch ? 'EXACT_MATCH' : 'MISMATCH',
      },
    },
    handedness: {
      status: handednessStatus,
      current: attestedHandedness,
      target: TARGET_HANDEDNESS,
      basis: 'authoritative current first-playable receipt versus documented static golden direction',
    },
  };
}

export async function createGateAStillComparison({
  currentImage,
  currentEvidence,
  targetImage,
  expectedTargetSha256,
  expectedBuildId,
  outputDir,
  panelWidth = DEFAULT_PANEL.width,
  panelHeight = DEFAULT_PANEL.height,
  recordedUtc = new Date().toISOString(),
}) {
  if (!BUILD_ID.test(expectedBuildId ?? '')) throw new Error('expected build ID is invalid');
  if (!SHA256.test(expectedTargetSha256 ?? '')) throw new Error('expected target SHA-256 is invalid');
  if (!Number.isSafeInteger(panelWidth) || !Number.isSafeInteger(panelHeight)
      || panelWidth < 320 || panelWidth > 3840 || panelHeight < 180 || panelHeight > 2160) {
    throw new Error('comparison panel dimensions are outside the bounded range');
  }
  const out = resolve(outputDir);
  if (existsSync(out)) throw new Error(`comparison output already exists: ${out}`);
  const current = readRegularFile(currentImage, 'current image');
  const evidence = readRegularFile(currentEvidence, 'current evidence');
  const target = readRegularFile(targetImage, 'target image');
  const currentSha256 = sha256Bytes(current.bytes);
  const evidenceSha256 = sha256Bytes(evidence.bytes);
  const targetSha256 = sha256Bytes(target.bytes);
  if (targetSha256 !== expectedTargetSha256) throw new Error('target SHA-256 differs from the pinned golden direction');
  const receipt = JSON.parse(evidence.bytes.toString('utf8'));
  validateLiveReceipt(receipt, {
    receiptPath: evidence.path,
    currentImagePath: current.path,
    currentImageSha256: currentSha256,
    currentImageBytes: current.bytes.length,
    expectedBuildId,
  });

  const [nativePair, normalizedPair] = await Promise.all([
    composePair({ left: current.bytes, right: target.bytes, preservePixels: true }),
    composePair({
      left: current.bytes,
      right: target.bytes,
      panelWidth,
      panelHeight,
      preservePixels: false,
    }),
  ]);
  const comparability = comparisonIdentity(receipt, nativePair.source);
  mkdirSync(out, { recursive: false, mode: 0o700 });
  chmodSync(out, 0o700);
  const nativeName = 'current-target-native.png';
  const normalizedName = 'current-target-normalized.png';
  writeNew(resolve(out, nativeName), nativePair.bytes);
  writeNew(resolve(out, normalizedName), normalizedPair.bytes);
  const scriptBytes = readFileSync(SCRIPT_PATH);
  const manifest = {
    schemaVersion: 1,
    kind: 'VANDE_GATE_A_CURRENT_TARGET_STILL_COMPARISON',
    status: comparability.status === 'COMPARABLE'
      ? 'DIRECTIONAL_COMPARISON_READY_NOT_GATE_PASS'
      : 'DIRECTIONAL_COMPARISON_NOT_COMPARABLE_NOT_GATE_PASS',
    classification: 'EXACT_CURRENT_ANDROID_VS_STATIC_DIRECTION',
    limitation: 'The current frame is local Android engineering evidence. The target is a static direction, not Unity runtime, motion, asset-feasibility, player, performance, size, reach, CERI or release evidence.',
    recordedUtc,
    expectedBuildId,
    comparability,
    tool: {
      path: relative(resolve(dirname(SCRIPT_PATH), '../../..'), SCRIPT_PATH).split(sep).join('/'),
      sha256: sha256Bytes(scriptBytes),
      sharpVersion: sharp.versions?.sharp ?? null,
    },
    current: {
      path: current.path,
      bytes: current.bytes.length,
      sha256: currentSha256,
      dimensions: nativePair.source.current,
      evidence: { path: evidence.path, bytes: evidence.bytes.length, sha256: evidenceSha256 },
      renderer: receipt.renderer,
      admission: receipt.admission,
      deliveryId: receipt.stateBefore.deliveryId,
      phase: 'live',
      artifactSha256: receipt.artifact.sha256,
      deviceIdentitySha256: androidDeviceIdentitySha256(receipt.deviceIdentity),
      handedness: receipt.handedness,
      viewport: receipt.viewport,
      unityPayloadBinding: {
        status: 'FULL_H7_RECEIPT_REPLAY_ACCEPTED',
        sidecarSha256: receipt.unityPayloadBinding.expectedSidecar.sha256,
        verifierStatus: receipt.unityPayloadBinding.admission.status,
      },
    },
    target: {
      path: target.path,
      bytes: target.bytes.length,
      sha256: targetSha256,
      dimensions: nativePair.source.target,
      renderer: null,
      handedness: TARGET_HANDEDNESS,
      classification: 'STATIC_GOLDEN_DIRECTION_NOT_RUNTIME',
    },
    outputs: {
      native: {
        path: nativeName,
        bytes: nativePair.bytes.length,
        sha256: sha256Bytes(nativePair.bytes),
        canvas: nativePair.canvas,
        panel: nativePair.panel,
        transform: nativePair.transform,
      },
      normalized: {
        path: normalizedName,
        bytes: normalizedPair.bytes.length,
        sha256: sha256Bytes(normalizedPair.bytes),
        canvas: normalizedPair.canvas,
        panel: normalizedPair.panel,
        transform: normalizedPair.transform,
      },
    },
  };
  writeNew(resolve(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function parseArgs(argv) {
  const options = {};
  const names = new Set([
    '--current-image', '--current-evidence', '--target-image', '--expected-target-sha256',
    '--expected-build-id', '--output-dir', '--panel-width', '--panel-height',
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!names.has(name)) throw new Error(`unknown option ${name ?? '<missing>'}`);
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    if (Object.hasOwn(options, name)) throw new Error(`duplicate option ${name}`);
    options[name] = value;
  }
  for (const name of [
    '--current-image', '--current-evidence', '--target-image', '--expected-target-sha256',
    '--expected-build-id', '--output-dir',
  ]) {
    if (!options[name]) throw new Error(`missing ${name}`);
  }
  return {
    currentImage: options['--current-image'],
    currentEvidence: options['--current-evidence'],
    targetImage: options['--target-image'],
    expectedTargetSha256: options['--expected-target-sha256'],
    expectedBuildId: options['--expected-build-id'],
    outputDir: options['--output-dir'],
    panelWidth: options['--panel-width'] === undefined ? undefined : Number(options['--panel-width']),
    panelHeight: options['--panel-height'] === undefined ? undefined : Number(options['--panel-height']),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  createGateAStillComparison(parseArgs(process.argv.slice(2)))
    .then((manifest) => {
      process.stdout.write(`${JSON.stringify({
        status: manifest.status,
        currentSha256: manifest.current.sha256,
        targetSha256: manifest.target.sha256,
        output: resolve(process.argv[process.argv.indexOf('--output-dir') + 1]),
      })}\n`);
    })
    .catch((error) => {
      process.stderr.write(`GATE_A_STILL_COMPARISON_REJECTED ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
