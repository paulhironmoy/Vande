#!/usr/bin/env node

/** Pure canonical contract for one installed monolithic Android APK. */

const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_SERIAL = /^[A-Za-z0-9._:-]{1,128}$/u;
const SAFE_PACKAGE = /^[A-Za-z][A-Za-z0-9_.]{2,255}$/u;
const SAFE_DEVICE_PATH = /^\/[A-Za-z0-9._/+=~-]+$/u;
const ISO_UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;

function hasExactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

export function isCanonicalDevicePath(value) {
  return SAFE_DEVICE_PATH.test(value ?? '')
    && value.split('/').slice(1).every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

export function parseExactInstalledPackagePathOutput(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^package:(\/[A-Za-z0-9._/+=~-]+)\r?\n?$/u);
  return match && isCanonicalDevicePath(match[1]) ? match[1] : null;
}

export function parseExactInstalledApkHashOutput(value, expectedPath) {
  if (typeof value !== 'string' || !isCanonicalDevicePath(expectedPath)) return null;
  const match = value.match(/^([0-9a-f]{64})[ \t]+(\/[A-Za-z0-9._/+=~-]+)\r?\n?$/u);
  if (!match || match[2] !== expectedPath || !isCanonicalDevicePath(match[2])) return null;
  return { path: match[2], sha256: match[1] };
}

export function validateInstalledPackageInventoryReceipt(report, expected = {}) {
  const errors = [];
  if (!hasExactKeys(report, [
    'schemaVersion', 'status', 'recordedUtc', 'serial', 'packageId',
    'inventory', 'capture',
  ])) errors.push('installed-package inventory fields differ');
  if (report?.schemaVersion !== 1 || report?.status !== 'EXACT_INSTALLED_PACKAGE_INVENTORY_CAPTURED') {
    errors.push('installed-package inventory receipt header is invalid');
  }
  if (typeof report?.recordedUtc !== 'string' || !ISO_UTC.test(report.recordedUtc)
      || !Number.isFinite(Date.parse(report.recordedUtc))
      || new Date(report.recordedUtc).toISOString() !== report.recordedUtc) {
    errors.push('installed-package inventory UTC is invalid');
  }
  if (!SAFE_SERIAL.test(report?.serial ?? '')) errors.push('installed-package inventory serial is invalid');
  if (!SAFE_PACKAGE.test(report?.packageId ?? '')) errors.push('installed-package inventory package is invalid');
  if (expected.serial && report?.serial !== expected.serial) errors.push('installed-package inventory serial does not match');
  if (expected.packageId && report?.packageId !== expected.packageId) errors.push('installed-package inventory package does not match');
  if (!Array.isArray(report?.inventory) || report.inventory.length !== 1) {
    errors.push('installed-package inventory is not exactly one monolithic APK');
  } else {
    const [entry] = report.inventory;
    if (!hasExactKeys(entry, ['path', 'sha256'])) {
      errors.push('installed-package inventory entry fields differ');
    }
    if (!isCanonicalDevicePath(entry?.path) || !SHA256.test(entry?.sha256 ?? '')) {
      errors.push('installed-package inventory entry is invalid');
    }
    if (expected.artifactSha256 && entry?.sha256 !== expected.artifactSha256) {
      errors.push('installed-package inventory hash does not match admitted artifact');
    }
  }
  const capture = report?.capture;
  if (!hasExactKeys(capture, ['pmPath', 'sha256'])
      || !hasExactKeys(capture?.pmPath, ['exitStatus', 'stdout', 'stderr'])) {
    errors.push('installed-package inventory capture fields differ');
  }
  const capturedPath = parseExactInstalledPackagePathOutput(capture?.pmPath?.stdout);
  if (capture?.pmPath?.exitStatus !== 0 || capture?.pmPath?.stderr !== ''
      || !capturedPath) {
    errors.push('installed-package pm-path capture is invalid');
  }
  const hashCapture = Array.isArray(capture?.sha256) ? capture.sha256 : [];
  if (hashCapture.length !== 1
      || !hasExactKeys(hashCapture[0], ['exitStatus', 'stdout', 'stderr'])
      || hashCapture[0]?.exitStatus !== 0 || hashCapture[0]?.stderr !== '') {
    errors.push('installed-package hash capture is invalid');
  } else {
    const parsedHash = parseExactInstalledApkHashOutput(hashCapture[0].stdout, capturedPath);
    if (!parsedHash
        || report?.inventory?.[0]?.path !== parsedHash.path
        || report?.inventory?.[0]?.sha256 !== parsedHash.sha256) {
      errors.push('installed-package hash capture does not reproduce inventory');
    }
  }
  return errors;
}
