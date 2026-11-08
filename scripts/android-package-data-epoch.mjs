import { createHash } from 'node:crypto';

export const GATE_A_EPOCH_LIMITATION =
  'LOCAL_NON_ROOT_ENGINEERING_EPOCH_NOT_PROOF_AGAINST_ROOT_KERNEL_HOST_OR_MALICIOUS_APP';
export const GATE_A_MEASUREMENT_LIMITATION =
  'Local non-root engineering evidence detects ordinary package-data reset, reinstall and process replacement; it is not proof against a malicious or rooted app, kernel, host or evidence bridge.';

const SHA256 = /^[0-9a-f]{64}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const BOOT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PACKAGE_ID = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/u;
const MAX_U64 = 18_446_744_073_709_551_615n;

const exactKeys = (value, expected, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is not an object`);
  const observed = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(observed) !== JSON.stringify(wanted)) {
    throw new Error(`${label} keys are not exact (expected ${wanted.join(',')}; observed ${observed.join(',')})`);
  }
};

const decimal = (value, label, { positive = false } = {}) => {
  if (typeof value !== 'string' || !DECIMAL.test(value)) throw new Error(`${label} is not a canonical decimal string`);
  const parsed = BigInt(value);
  if (parsed > MAX_U64 || (positive && parsed === 0n)) throw new Error(`${label} is outside its accepted range`);
  return parsed;
};

const sha256Text = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

export function gateAStateBindingSha256(bridgeNonce, stateSha256) {
  if (!SHA256.test(bridgeNonce ?? '') || !SHA256.test(stateSha256 ?? '')) {
    throw new Error('state binding requires lowercase SHA-256 nonce and state digest');
  }
  return sha256Text(`VANDE_GATE_A_STATE_V1\0${bridgeNonce}\0${stateSha256}`);
}

function validateCanonicalDataDir(path, packageId) {
  if (typeof path !== 'string' || path.length > 512 || path.includes('//') || path.includes('/./') || path.includes('/../')) {
    throw new Error('dataDir.canonicalPath is not a canonical absolute path');
  }
  const escaped = packageId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  if (!new RegExp(`^(?:/data/user(?:_de)?/[0-9]+|/data/data)/${escaped}$`, 'u').test(path)) {
    throw new Error('dataDir.canonicalPath is not the exact canonical package data directory');
  }
}

export function validateNativePackageDataEpoch(value, { packageId, stateSha256 }) {
  exactKeys(value, [
    'schemaVersion', 'status', 'limitation', 'packageId', 'dataDir', 'process',
    'bridgeNonce', 'stateSha256', 'stateBindingSha256',
  ], 'native package-data epoch');
  if (value.schemaVersion !== 1 || value.status !== 'OK' || value.limitation !== GATE_A_EPOCH_LIMITATION) {
    throw new Error('native package-data epoch header is invalid');
  }
  if (!PACKAGE_ID.test(packageId ?? '') || value.packageId !== packageId) throw new Error('native package ID does not match');
  if (!SHA256.test(stateSha256 ?? '') || value.stateSha256 !== stateSha256) throw new Error('native state digest does not match persisted state');
  if (!SHA256.test(value.bridgeNonce ?? '')) throw new Error('native bridge nonce is invalid');
  if (value.stateBindingSha256 !== gateAStateBindingSha256(value.bridgeNonce, value.stateSha256)) {
    throw new Error('native state binding digest is invalid');
  }

  exactKeys(value.dataDir, ['canonicalPath', 'dev', 'inode', 'mode', 'uid', 'gid', 'mtimeNs', 'ctimeNs'], 'dataDir');
  validateCanonicalDataDir(value.dataDir.canonicalPath, packageId);
  decimal(value.dataDir.dev, 'dataDir.dev');
  decimal(value.dataDir.inode, 'dataDir.inode', { positive: true });
  const mode = decimal(value.dataDir.mode, 'dataDir.mode');
  if ((mode & 0o170000n) !== 0o040000n) throw new Error('dataDir.mode is not a directory');
  const dataUid = decimal(value.dataDir.uid, 'dataDir.uid', { positive: true });
  decimal(value.dataDir.gid, 'dataDir.gid');
  decimal(value.dataDir.mtimeNs, 'dataDir.mtimeNs', { positive: true });
  decimal(value.dataDir.ctimeNs, 'dataDir.ctimeNs', { positive: true });

  exactKeys(value.process, ['packageId', 'uid', 'pid', 'startTicks', 'bootId'], 'process epoch');
  if (value.process.packageId !== packageId) throw new Error('process package ID does not match');
  const processUid = decimal(value.process.uid, 'process.uid', { positive: true });
  decimal(value.process.pid, 'process.pid', { positive: true });
  decimal(value.process.startTicks, 'process.startTicks', { positive: true });
  if (!BOOT_ID.test(value.process.bootId ?? '')) throw new Error('process.bootId is not a lowercase boot UUID');
  if (dataUid !== processUid) throw new Error('dataDir uid does not match process uid');
  return value;
}

export function validatePackageDataEpochCapture(value, { packageId, label = null } = {}) {
  exactKeys(value, [
    'schemaVersion', 'status', 'label', 'utc', 'hostMonotonicNs', 'pageEpoch',
    'persistedStateBytes', 'stateSha256', 'savedState', 'nativeEpoch',
  ], 'package-data epoch capture');
  if (value.schemaVersion !== 1 || value.status !== 'ATTESTED_PERSISTED_STATE_EPOCH') {
    throw new Error('package-data epoch capture header is invalid');
  }
  if (label !== null && value.label !== label) throw new Error(`package-data epoch capture label is not ${label}`);
  if (!Number.isFinite(Date.parse(value.utc ?? ''))) throw new Error('package-data epoch capture UTC is invalid');
  decimal(value.hostMonotonicNs, 'package-data epoch hostMonotonicNs');
  if (!Number.isSafeInteger(value.pageEpoch) || value.pageEpoch < 1) throw new Error('package-data epoch pageEpoch is invalid');
  if (!Number.isSafeInteger(value.persistedStateBytes) || value.persistedStateBytes <= 0) throw new Error('persisted state byte count is invalid');
  if (!SHA256.test(value.stateSha256 ?? '')) throw new Error('persisted state SHA-256 is invalid');
  exactKeys(value.savedState, [
    'inningsId', 'status', 'balls', 'records', 'overIndex', 'ballIndex', 'inFlight', 'lastSwingKind',
  ], 'saved first-ball state');
  if (typeof value.savedState.inningsId !== 'string' || value.savedState.inningsId.length === 0
      || value.savedState.balls !== 1 || value.savedState.records !== 1 || value.savedState.inFlight !== null) {
    throw new Error('persisted state is not the stable first-playable ball');
  }
  validateNativePackageDataEpoch(value.nativeEpoch, { packageId, stateSha256: value.stateSha256 });
  return value;
}

const captureIdentity = (capture) => JSON.stringify({
  pageEpoch: capture.pageEpoch,
  persistedStateBytes: capture.persistedStateBytes,
  stateSha256: capture.stateSha256,
  savedState: capture.savedState,
  nativeEpoch: capture.nativeEpoch,
});

export function assertSamePackageDataEpoch(expected, observed, label = 'package-data epoch') {
  if (captureIdentity(expected) !== captureIdentity(observed)) throw new Error(`${label} changed`);
}

const installIdentity = (value, label) => {
  exactKeys(value, ['firstInstallTime', 'lastUpdateTime'], label);
  if (typeof value.firstInstallTime !== 'string' || value.firstInstallTime.length === 0
      || typeof value.lastUpdateTime !== 'string' || value.lastUpdateTime.length === 0) {
    throw new Error(`${label} is incomplete`);
  }
  return value;
};

const sameInstallIdentity = (expected, observed, label) => {
  installIdentity(observed, label);
  if (expected.firstInstallTime !== observed.firstInstallTime
      || expected.lastUpdateTime !== observed.lastUpdateTime) throw new Error(`${label} changed`);
};

export function validateBracketedStorageStatsMeasurement(value, {
  packageId,
  serial,
  user,
  buildId,
  artifactSha256,
  runId,
  stableSavedState,
  stableBoundaryEpoch,
  expectedPackageInstallIdentity,
} = {}) {
  exactKeys(value, [
    'schemaVersion', 'status', 'classification', 'limitation', 'packageId', 'serial', 'user',
    'buildId', 'artifactSha256', 'runId', 'command', 'boundaryEpoch', 'samples', 'finalEpoch',
    'packageInstallIdentity', 'packageInstallIdentityFinal', 'assessment',
  ], 'bracketed StorageStats measurement');
  if (value.schemaVersion !== 1 || value.status !== 'BRACKETED_FIRST_PLAYABLE_STORAGE_STATS'
      || value.classification !== 'LOCAL_ENGINEERING_MEASUREMENT'
      || value.limitation !== GATE_A_MEASUREMENT_LIMITATION) {
    throw new Error('bracketed StorageStats measurement header is invalid');
  }
  for (const [name, observed, expected] of [
    ['packageId', value.packageId, packageId], ['serial', value.serial, serial], ['user', String(value.user), String(user)],
    ['buildId', value.buildId, buildId], ['artifactSha256', value.artifactSha256, artifactSha256], ['runId', value.runId, runId],
  ]) if (observed !== expected) throw new Error(`measurement ${name} does not match`);
  if (!Array.isArray(value.command) || JSON.stringify(value.command) !== JSON.stringify([
    'adb', '-s', serial, 'shell', 'pm', 'get-package-storage-stats', '--user', String(user), packageId,
  ])) throw new Error('measurement command is not exact');

  const continuityAnchor = validatePackageDataEpochCapture(stableBoundaryEpoch, {
    packageId,
    label: 'first-playable-boundary-stable-epoch',
  });
  if (JSON.stringify(continuityAnchor.savedState) !== JSON.stringify(stableSavedState)) {
    throw new Error('stable package-data epoch saved state does not match the first-playable boundary');
  }
  const expectedInstall = installIdentity(expectedPackageInstallIdentity, 'top-level package install identity');
  sameInstallIdentity(expectedInstall, value.packageInstallIdentity, 'measurement package install identity');
  const boundary = validatePackageDataEpochCapture(value.boundaryEpoch, { packageId, label: 'storage-stats-boundary' });
  if (JSON.stringify(boundary.savedState) !== JSON.stringify(stableSavedState)) {
    throw new Error('measurement boundary saved state does not match the first-playable boundary');
  }
  assertSamePackageDataEpoch(continuityAnchor, boundary, 'package-data epoch from stable first-playable boundary');
  if (BigInt(boundary.hostMonotonicNs) <= BigInt(continuityAnchor.hostMonotonicNs)) {
    throw new Error('StorageStats boundary does not follow the stable package-data epoch');
  }
  if (!Array.isArray(value.samples) || value.samples.length !== 2) throw new Error('measurement requires exactly two samples');
  let previous = boundary;
  let previousMonotonic = BigInt(boundary.hostMonotonicNs);
  for (let index = 0; index < value.samples.length; index += 1) {
    const sample = value.samples[index];
    const number = index + 1;
    exactKeys(sample, [
      'index', 'capturedUtc', 'hostUptimeBefore', 'deviceUptimeBefore',
      'packageInstallIdentityBefore', 'epochBefore', 'stdout', 'stderr', 'exitStatus', 'statusRecord',
      'parsed', 'epochAfter', 'packageInstallIdentityAfter',
    ], `StorageStats sample ${number}`);
    if (sample.index !== number || !Number.isFinite(Date.parse(sample.capturedUtc ?? ''))
        || typeof sample.hostUptimeBefore !== 'string' || sample.hostUptimeBefore.length === 0
        || typeof sample.deviceUptimeBefore !== 'string' || sample.deviceUptimeBefore.length === 0) {
      throw new Error(`StorageStats sample ${number} metadata is invalid`);
    }
    sameInstallIdentity(expectedInstall, sample.packageInstallIdentityBefore, `sample ${number} pre-install identity`);
    sameInstallIdentity(expectedInstall, sample.packageInstallIdentityAfter, `sample ${number} post-install identity`);
    const before = validatePackageDataEpochCapture(sample.epochBefore, { packageId, label: `storage-stats-${number}-before` });
    const after = validatePackageDataEpochCapture(sample.epochAfter, { packageId, label: `storage-stats-${number}-after` });
    assertSamePackageDataEpoch(previous, before, `package-data epoch before sample ${number}`);
    assertSamePackageDataEpoch(before, after, `package-data epoch during sample ${number}`);
    const beforeNs = BigInt(before.hostMonotonicNs);
    const afterNs = BigInt(after.hostMonotonicNs);
    if (beforeNs <= previousMonotonic || afterNs <= beforeNs) throw new Error(`sample ${number} epoch monotonic order is invalid`);
    previousMonotonic = afterNs;
    previous = after;
  }
  const finalEpoch = validatePackageDataEpochCapture(value.finalEpoch, { packageId, label: 'storage-stats-final' });
  assertSamePackageDataEpoch(previous, finalEpoch, 'package-data epoch after StorageStats samples');
  if (BigInt(finalEpoch.hostMonotonicNs) <= previousMonotonic) throw new Error('final epoch monotonic order is invalid');
  sameInstallIdentity(expectedInstall, value.packageInstallIdentityFinal, 'final package install identity');
  exactKeys(value.assessment, [
    'stableCodeAndData', 'footprintStatus', 'freshInstalledBytes', 'limitBytes', 'localThresholdPass', 'cacheCountedAgain',
  ], 'measurement assessment');
  if (value.assessment.stableCodeAndData !== true
      || value.assessment.footprintStatus !== 'LOCAL_ENGINEERING_MEASUREMENT'
      || !DECIMAL.test(value.assessment.freshInstalledBytes ?? '')
      || value.assessment.limitBytes !== '50000000'
      || typeof value.assessment.localThresholdPass !== 'boolean'
      || value.assessment.cacheCountedAgain !== false) {
    throw new Error('measurement assessment is not one stable local engineering measurement');
  }
  if (value.assessment.localThresholdPass !== (BigInt(value.assessment.freshInstalledBytes) <= 50_000_000n)) {
    throw new Error('measurement local threshold result does not match its authoritative byte count');
  }
  return value;
}
