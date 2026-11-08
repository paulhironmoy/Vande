#!/usr/bin/env node

/**
 * Build-time provenance for a Unity-linked Android candidate.
 *
 * `create-invocation` writes the exact, secret-free build-input contract that
 * Gradle embeds in the signed APK. `bind` verifies the same-invocation Gradle
 * transform manifest against the signed APK/AAB and writes the promoted
 * payload-binding sidecar. This module never builds, installs, launches, or
 * connects to a device.
 */

import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..');
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const BUILD_ID_PATTERN = /^[0-9a-f]{7,40}(?:\+[0-9a-f]{12})?$/u;
const INVOCATION_ID_PATTERN = /^[0-9a-f]{32}$/u;
const SAFE_ABI_PATTERN = /^(?:arm64-v8a|armeabi-v7a|x86|x86_64)$/u;
const CORE_UNITY_LIBRARIES = new Set(['libunity.so', 'libmain.so', 'libil2cpp.so']);
const KNOWN_UNITY_LIBRARIES = new Set([
  'libc++_shared.so', 'libgame.so', 'libil2cpp.so', 'libmain.so', 'libswappywrapper.so', 'libunity.so',
]);
const KNOWN_NON_UNITY_APP_LIBRARIES = new Set(['libdatastore_shared_counter.so']);
const INPUT_ATTESTATION_ENTRY = 'assets/vande/unity-build-input.json';
const AAB_INPUT_ATTESTATION_ENTRY = 'base/assets/vande/unity-build-input.json';
const NATIVE_PROVENANCE_ENTRY = 'assets/vande/unity-native-provenance.json';
const AAB_NATIVE_PROVENANCE_ENTRY = 'base/assets/vande/unity-native-provenance.json';
const ARCHIVE_READER = Object.freeze({
  kind: 'VANDE_IN_PROCESS_ZIP_READER',
  version: 1,
  implementation: 'scripts/android-unity-payload-binding.mjs',
});
const FORBIDDEN_GRADLE_ENVIRONMENT = Object.freeze([
  'GRADLE_OPTS', 'GRADLE_USER_HOME', 'JAVA_OPTS', 'JAVA_TOOL_OPTIONS',
  'JDK_JAVA_OPTIONS', '_JAVA_OPTIONS',
]);
const GAME_ACTIVITY_GENERATED_NATIVE_NAMES = Object.freeze([
  'libc++_shared.so', 'libgame.so', 'libil2cpp.so', 'libswappywrapper.so',
]);
const UNITY_PLAYER_ACTIVITY_GENERATED_NATIVE_NAMES = Object.freeze([
  'libc++_shared.so', 'libil2cpp.so',
]);
const ACTIVITY_CMAKE_NOT_APPLICABLE = 'NOT_APPLICABLE_UNITY_PLAYER_ACTIVITY_ENTRY_1_SWAPPY_0';
export const PAYLOAD_BINDING_STATUS = 'BUILD_TIME_BINDING_RECORDED_NOT_CERTIFICATION';
export const LOCAL_PROVENANCE_LIMITATION = 'Local build-time provenance only; not Play, installed-size, reach, physical-device, runtime, human-player, or malicious-builder-resistant evidence.';
export const ANDROID_UNITY_CRITICAL_INPUT_PATHS = Object.freeze([
  'android/app/build.gradle',
  'android/build.gradle',
  'android/gradle/wrapper/gradle-wrapper.properties',
  'android/settings.gradle',
  'scripts/android-exclusive-promote.mjs',
  'scripts/android-unity-payload-binding.mjs',
  'scripts/build-android.sh',
  'unity/VandePractice/Assets/VandePractice/Editor/VandeAndroidLibraryExporter.cs',
  'unity/VandePractice/Builds/Android/.vande-export.properties',
  'unity/VandePractice/Builds/Android/unityLibrary/build.gradle',
  'unity/VandePractice/ProjectSettings/ProjectSettings.asset',
]);
const TRANSFORM_TASK_OUTPUTS = Object.freeze([
  ':unityLibrary:mergeReleaseAssets',
  ':unityLibrary:mergeReleaseNativeLibs',
  ':app:mergeReleaseAssets',
  ':app:stripReleaseDebugSymbols',
]);
const GRADLE_REQUESTED_TASKS = Object.freeze([
  'assembleRelease', 'bundleRelease', ':app:writeVandeUnityPayloadTransformManifest',
]);
const GRADLE_FIXED_ARGUMENTS = Object.freeze([
  '--no-daemon', '--console=plain', '--max-workers=2',
]);
const GRADLE_FIXED_SYSTEM_ARGUMENTS = Object.freeze([
  '-Dfile.encoding=UTF-8',
  '-Duser.country=US',
  '-Duser.language=en',
  '-Duser.variant=',
]);
// Gradle 8.14.3 seeds StartParameter.systemPropertiesArgs with these immutable
// JVM properties before parsing the caller's argument vector. Bind their exact
// release-build values so settings.gradle can retain an equality check over the
// complete observed map; every missing, duplicate, altered, or additional -D
// argument remains forbidden below.
const GRADLE_INTRINSIC_SYSTEM_PROPERTIES = Object.freeze({
  'file.encoding': 'UTF-8',
  'user.country': 'US',
  'user.language': 'en',
  'user.variant': '',
});

function fail(message) {
  throw new Error(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function requireObject(value, label) {
  if (!isPlainObject(value)) fail(`${label} must be a plain object`);
  return value;
}

function requireExactKeys(value, expected, label) {
  const actual = Object.keys(requireObject(value, label)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} keys differ (expected=${wanted.join(',')}; actual=${actual.join(',')})`);
  }
}

function requireString(value, label, pattern = null) {
  if (typeof value !== 'string' || value.length === 0 || /[\0\r\n]/u.test(value)) {
    fail(`${label} must be a non-empty single-line string`);
  }
  if (pattern && !pattern.test(value)) fail(`${label} is invalid`);
  return value;
}

function requireCmakeVersionOrActivity(value, label) {
  requireString(value, label);
  if (value !== ACTIVITY_CMAKE_NOT_APPLICABLE
      && !/^[0-9]+(?:\.[0-9]+){1,3}(?:[-+._A-Za-z0-9]*)?$/u.test(value)) {
    fail(`${label} is neither a CMake version nor the exact Activity-mode marker`);
  }
  return value;
}

function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) fail(`${label} must be a non-empty string array`);
  return value.map((item, index) => requireString(item, `${label}[${index}]`));
}

function requireSafeRelativePath(value, label) {
  requireString(value, label);
  const segments = value.split('/');
  if (value.startsWith('/') || value.includes('\\')
      || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
      || [...value].some((character) => /\p{Cc}/u.test(character))) {
    fail(`${label} is not a canonical safe relative path`);
  }
  return value;
}

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

function statIdentity(info) {
  return {
    dev: info.dev.toString(),
    ino: info.ino.toString(),
    mode: info.mode.toString(),
    uid: info.uid.toString(),
    gid: info.gid.toString(),
    size: info.size.toString(),
    mtimeNs: info.mtimeNs.toString(),
    ctimeNs: info.ctimeNs.toString(),
  };
}

function sameIdentity(left, right) {
  return stableStringify(left) === stableStringify(right);
}

/** Read one canonical regular file through a no-follow descriptor and bind its
 * bytes to the path identity before/after the read. The returned record can be
 * rechecked after every external verifier and at transaction completion. */
export function snapshotRegularFile(path, label) {
  path = canonicalPath(path, label);
  const pathBefore = statIdentity(lstatSync(path, { bigint: true }));
  const descriptor = openSync(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  let descriptorBefore;
  let descriptorAfter;
  let bytes;
  try {
    descriptorBefore = statIdentity(fstatSync(descriptor, { bigint: true }));
    if (!sameIdentity(pathBefore, descriptorBefore)) fail(`${label} identity changed before snapshot`);
    bytes = readFileSync(descriptor);
    descriptorAfter = statIdentity(fstatSync(descriptor, { bigint: true }));
  } finally {
    closeSync(descriptor);
  }
  const pathAfter = statIdentity(lstatSync(path, { bigint: true }));
  if (!sameIdentity(descriptorBefore, descriptorAfter)
      || !sameIdentity(descriptorBefore, pathAfter)
      || Number(descriptorAfter.size) !== bytes.length) {
    fail(`${label} changed while it was snapshotted`);
  }
  return {
    path,
    bytes,
    identity: descriptorAfter,
    size: bytes.length,
    sha256: sha256Bytes(bytes),
  };
}

export function assertSnapshotUnchanged(snapshot, label) {
  const current = snapshotRegularFile(snapshot.path, label);
  if (!sameIdentity(current.identity, snapshot.identity)
      || current.size !== snapshot.size
      || current.sha256 !== snapshot.sha256) {
    fail(`${label} changed after its bound snapshot`);
  }
  return current;
}

function toolRecord(snapshot) {
  return {
    path: snapshot.path,
    fileName: basename(snapshot.path),
    bytes: snapshot.size,
    sha256: snapshot.sha256,
  };
}

function canonicalPath(path, label, { mustExist = true } = {}) {
  if (typeof path !== 'string' || !path.startsWith('/') || /[\0\r\n]/u.test(path)) {
    fail(`${label} must be a canonical absolute path`);
  }
  const normalized = resolve(path);
  if (normalized !== path) fail(`${label} is not normalized`);
  if (!mustExist) return normalized;
  if (!existsSync(normalized)) fail(`${label} is missing: ${normalized}`);
  const info = lstatSync(normalized);
  if (!info.isFile() || info.isSymbolicLink()) fail(`${label} must be a regular non-symbolic-link file`);
  if (realpathSync(normalized) !== normalized) fail(`${label} does not resolve to itself`);
  return normalized;
}

export function stableStringify(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) fail('canonical JSON accepts only safe integers');
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  fail(`unsupported canonical JSON value type: ${typeof value}`);
}

function canonicalJsonBytes(value) {
  return Buffer.from(`${stableStringify(value)}\n`, 'utf8');
}

function parseJsonBytes(bytes, label) {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) fail(`${label} is not canonical UTF-8`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
  return requireObject(parsed, label);
}

function parseCanonicalJsonBytes(bytes, label) {
  const value = parseJsonBytes(bytes, label);
  if (!canonicalJsonBytes(value).equals(bytes)) fail(`${label} is not canonical JSON`);
  return value;
}

function canonicalDirectory(path, label) {
  if (typeof path !== 'string' || !path.startsWith('/') || /[\0\r\n]/u.test(path)) {
    fail(`${label} must be a canonical absolute path`);
  }
  const normalized = resolve(path);
  if (normalized !== path || !existsSync(normalized)) fail(`${label} is missing or not normalized`);
  const info = lstatSync(normalized);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(normalized) !== normalized) {
    fail(`${label} must be a canonical non-symbolic-link directory`);
  }
  return normalized;
}

function decodeReceiptPath(encoded, label) {
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) fail(`${label} has an invalid encoded path`);
  const decoded = Buffer.from(encoded, 'base64url');
  const path = decoded.toString('utf8');
  if (!Buffer.from(path, 'utf8').equals(decoded) || Buffer.from(path, 'utf8').toString('base64url') !== encoded) {
    fail(`${label} path is not canonical UTF-8/base64url`);
  }
  return requireSafeRelativePath(path, `${label} path`);
}

function receiptManifestDigest(entries) {
  const canonical = entries.map((entry, index) => (
    `${String(index).padStart(6, '0')}\t${entry.executable}\t${entry.sha256}\t${entry.encodedPath}\n`
  )).join('');
  return sha256Bytes(Buffer.from(canonical, 'utf8'));
}

export function parseUnityExportReceipt(bytes) {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) fail('Unity receipt is not canonical UTF-8');
  if (!text.endsWith('\n') || text.includes('\r') || text.includes('\0')) {
    fail('Unity receipt must use LF-terminated single-line records');
  }
  const values = new Map();
  for (const [index, line] of text.slice(0, -1).split('\n').entries()) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9]*)=(\S+)$/u);
    if (!match) fail(`malformed Unity receipt line ${index + 1}`);
    if (values.has(match[1])) fail(`duplicate Unity receipt key ${match[1]}`);
    values.set(match[1], match[2]);
  }
  const fixedKeys = [
    'schema', 'editorVersion', 'target', 'scriptingBackend', 'architectures', 'minSdk',
    'sourceFileCount', 'sourceTreeSha256', 'exportFileCount', 'exportTreeSha256',
  ];
  for (const key of fixedKeys) if (!values.has(key)) fail(`Unity receipt is missing ${key}`);
  const requiredValues = {
    schema: '3', target: 'Android', scriptingBackend: 'IL2CPP', architectures: 'ARM64', minSdk: '28',
  };
  for (const [key, expected] of Object.entries(requiredValues)) {
    if (values.get(key) !== expected) fail(`Unity receipt ${key} must equal ${expected}`);
  }
  requireString(values.get('editorVersion'), 'Unity editorVersion', /^6000\.3\.\d+f\d+$/u);
  const parseCount = (key) => {
    const raw = values.get(key);
    if (!/^[1-9][0-9]{0,5}$/u.test(raw)) fail(`Unity receipt ${key} is invalid`);
    const count = Number(raw);
    if (count > 100_000) fail(`Unity receipt ${key} exceeds 100000`);
    return count;
  };
  const sourceCount = parseCount('sourceFileCount');
  const exportCount = parseCount('exportFileCount');
  const expectedKeys = new Set(fixedKeys);
  const parseEntries = (prefix, count, expectedTree) => {
    requireString(expectedTree, `${prefix} tree SHA-256`, SHA256_PATTERN);
    const entries = [];
    let previous = null;
    for (let index = 0; index < count; index += 1) {
      const key = `${prefix}File${String(index).padStart(6, '0')}`;
      expectedKeys.add(key);
      const raw = values.get(key);
      if (raw === undefined) fail(`Unity receipt is missing ${key}`);
      const match = raw.match(/^([01]):([0-9a-f]{64}):([A-Za-z0-9_-]+)$/u);
      if (!match) fail(`Unity receipt ${key} is malformed`);
      const path = decodeReceiptPath(match[3], key);
      if (previous !== null && previous >= path) fail(`${prefix} receipt paths are not unique and ordinally sorted`);
      previous = path;
      entries.push({ path, executable: match[1], sha256: match[2], encodedPath: match[3] });
    }
    if (receiptManifestDigest(entries) !== expectedTree) fail(`${prefix} receipt tree digest is invalid`);
    return entries;
  };
  const sourceEntries = parseEntries('source', sourceCount, values.get('sourceTreeSha256'));
  const exportEntries = parseEntries('export', exportCount, values.get('exportTreeSha256'));
  const actualKeys = [...values.keys()].sort();
  const wantedKeys = [...expectedKeys].sort();
  if (actualKeys.length !== wantedKeys.length || actualKeys.some((key, index) => key !== wantedKeys[index])) {
    fail('Unity receipt contains missing or unknown keys');
  }
  return {
    schema: 3,
    editorVersion: values.get('editorVersion'),
    target: 'Android',
    scriptingBackend: 'IL2CPP',
    architectures: 'ARM64',
    minSdk: 28,
    sourceFileCount: sourceCount,
    sourceTreeSha256: values.get('sourceTreeSha256'),
    exportFileCount: exportCount,
    exportTreeSha256: values.get('exportTreeSha256'),
    sourceEntries,
    exportEntries,
  };
}

export function canonicalMaterialTree(entries) {
  if (!Array.isArray(entries) || entries.length === 0) fail('material tree must contain at least one entry');
  const sorted = entries.map((entry, index) => {
    requireExactKeys(entry, ['path', 'bytes', 'sha256'], `material tree entry ${index}`);
    const path = requireSafeRelativePath(entry.path, `material tree entry ${index} path`);
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0) fail(`material tree entry ${path} bytes is invalid`);
    requireString(entry.sha256, `material tree entry ${path} SHA-256`, SHA256_PATTERN);
    return { path, bytes: entry.bytes, sha256: entry.sha256 };
  }).sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1].path === sorted[index].path) fail(`duplicate material path ${sorted[index].path}`);
  }
  const canonical = sorted.map((entry, index) => (
    `${String(index).padStart(6, '0')}\t${entry.bytes}\t${entry.sha256}\t${Buffer.from(entry.path, 'utf8').toString('base64url')}\n`
  )).join('');
  return { entries: sorted, sha256: sha256Bytes(Buffer.from(canonical, 'utf8')) };
}

function validateStep(step, label, { environment = false } = {}) {
  requireExactKeys(step, environment ? ['args', 'cwd', 'environment', 'launcher'] : ['args', 'cwd', 'launcher'], label);
  requireString(step.cwd, `${label}.cwd`);
  requireStringArray(step.launcher, `${label}.launcher`);
  requireStringArray(step.args, `${label}.args`);
  if (environment) {
    const variables = requireObject(step.environment, `${label}.environment`);
    for (const [key, value] of Object.entries(variables)) {
      if (!/^[A-Z][A-Z0-9_]*$/u.test(key)) fail(`${label}.environment has invalid key ${key}`);
      if (typeof value !== 'string' || /[\0\r\n]/u.test(value)) fail(`${label}.environment.${key} is invalid`);
    }
  }
}

function parseGradleSeal(gradleArgs, gradleUserHome) {
  if (typeof gradleUserHome !== 'string' || !gradleUserHome.startsWith('/')
      || resolve(gradleUserHome) !== gradleUserHome || /[\0\r\n]/u.test(gradleUserHome)) {
    fail('isolated GRADLE_USER_HOME must be a normalized absolute path');
  }
  const projectProperties = {};
  const projectArguments = [];
  const systemProperties = {};
  const systemArguments = [];
  const requestedTaskNames = [];
  const fixedArguments = [];
  for (const argument of gradleArgs) {
    requireString(argument, 'Gradle argument');
    if (argument.startsWith('-P')) {
      const separator = argument.indexOf('=');
      if (separator <= 2) fail(`Gradle project property must use -Pname=value: ${argument}`);
      const name = argument.slice(2, separator);
      if (!/^[A-Za-z][A-Za-z0-9_.-]*$/u.test(name) || Object.hasOwn(projectProperties, name)) {
        fail(`Gradle project property is invalid or duplicated: ${name}`);
      }
      projectProperties[name] = argument.slice(separator + 1);
      projectArguments.push(argument);
    } else if (argument.startsWith('-D')) {
      const separator = argument.indexOf('=');
      if (separator <= 2 || !GRADLE_FIXED_SYSTEM_ARGUMENTS.includes(argument)) {
        fail(`Gradle system property is not in the sealed allowlist: ${argument}`);
      }
      const name = argument.slice(2, separator);
      if (Object.hasOwn(systemProperties, name)) {
        fail(`Gradle system property is duplicated: ${name}`);
      }
      systemProperties[name] = argument.slice(separator + 1);
      systemArguments.push(argument);
    } else if (!argument.startsWith('-')) {
      requestedTaskNames.push(argument);
    } else {
      if (!GRADLE_FIXED_ARGUMENTS.includes(argument)) {
        fail(`Gradle argument is not in the sealed allowlist: ${argument}`);
      }
      fixedArguments.push(argument);
    }
  }
  requireExactJson(fixedArguments, GRADLE_FIXED_ARGUMENTS, 'Gradle fixed argument vector');
  const canonicalProjectArguments = Object.entries(projectProperties)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, value]) => `-P${name}=${value}`);
  requireExactJson(
    projectArguments,
    canonicalProjectArguments,
    'Gradle project-property argument vector',
  );
  requireExactJson(
    systemArguments,
    GRADLE_FIXED_SYSTEM_ARGUMENTS,
    'Gradle fixed system-property argument vector',
  );
  requireExactJson(
    systemProperties,
    GRADLE_INTRINSIC_SYSTEM_PROPERTIES,
    'Gradle intrinsic system properties',
  );
  if (stableStringify(requestedTaskNames) !== stableStringify(GRADLE_REQUESTED_TASKS)) {
    fail('Gradle requested task names differ from the sealed release task vector');
  }
  return {
    gradleUserHome,
    requestedTaskNames,
    projectProperties,
    systemProperties,
    initScripts: [],
    rejectedEnvironment: [...FORBIDDEN_GRADLE_ENVIRONMENT],
    rejectOrgGradleProjectEnvironment: true,
  };
}

export function assertSealedGradleEnvironment(environment, gradleUserHome) {
  requireObject(environment, 'Gradle environment');
  for (const name of FORBIDDEN_GRADLE_ENVIRONMENT) {
    if (name === 'GRADLE_USER_HOME') continue;
    if (typeof environment[name] === 'string' && environment[name].length > 0) {
      fail(`sealed Gradle invocation rejects ${name}`);
    }
  }
  if (environment.GRADLE_USER_HOME !== gradleUserHome) {
    fail('sealed Gradle invocation requires the exact isolated GRADLE_USER_HOME');
  }
  for (const name of Object.keys(environment)) {
    if (name.startsWith('ORG_GRADLE_PROJECT_')) fail(`sealed Gradle invocation rejects ${name}`);
  }
}

function validateToolRecord(record, expectedName, label) {
  requireExactKeys(record, ['bytes', 'fileName', 'path', 'sha256'], label);
  requireString(record.path, `${label}.path`);
  if (record.fileName !== expectedName) fail(`${label}.fileName must equal ${expectedName}`);
  if (!Number.isSafeInteger(record.bytes) || record.bytes < 1) fail(`${label}.bytes is invalid`);
  requireString(record.sha256, `${label}.sha256`, SHA256_PATTERN);
}

function nativeProvenancePolicy(receipt, toolchain) {
  const direct = receipt.exportEntries
    .filter((entry) => entry.path.startsWith('unityLibrary/src/main/jniLibs/'))
    .map((entry) => ({
      path: entry.path.slice('unityLibrary/src/main/jniLibs/'.length),
      receiptExportPath: entry.path,
      receiptSha256: entry.sha256,
    }))
    .sort((left, right) => left.path.localeCompare(right.path, 'en'));
  return {
    producerTask: ':unityLibrary:mergeReleaseNativeLibs',
    direct,
    generatedNames: [...(toolchain.cmakeVersion === ACTIVITY_CMAKE_NOT_APPLICABLE
      ? UNITY_PLAYER_ACTIVITY_GENERATED_NATIVE_NAMES
      : GAME_ACTIVITY_GENERATED_NATIVE_NAMES)],
    generatedInputs: {
      receiptSha256: toolchain.receiptSha256,
      sourceTreeSha256: receipt.sourceTreeSha256,
      exportTreeSha256: receipt.exportTreeSha256,
    },
    generatedTools: {
      unityEditorVersion: toolchain.unityEditorVersion,
      ndkVersion: toolchain.ndkVersion,
      cmakeVersion: toolchain.cmakeVersion,
    },
  };
}

function validateGradleSeal(seal, contract) {
  requireExactKeys(seal, [
    'gradleUserHome', 'initScripts', 'projectProperties', 'rejectOrgGradleProjectEnvironment',
    'rejectedEnvironment', 'requestedTaskNames', 'systemProperties',
  ], 'invocation gradleSeal');
  requireString(seal.gradleUserHome, 'invocation gradleSeal.gradleUserHome');
  requireExactJson(seal.requestedTaskNames, GRADLE_REQUESTED_TASKS, 'invocation requestedTaskNames');
  if (!Array.isArray(seal.initScripts) || seal.initScripts.length !== 0) fail('invocation initScripts must be empty');
  if (seal.rejectOrgGradleProjectEnvironment !== true) fail('invocation must reject ORG_GRADLE_PROJECT_*');
  requireExactJson(
    seal.rejectedEnvironment,
    FORBIDDEN_GRADLE_ENVIRONMENT,
    'invocation rejected Gradle environment',
  );
  requireObject(seal.projectProperties, 'invocation projectProperties');
  requireObject(seal.systemProperties, 'invocation systemProperties');
  const derived = parseGradleSeal(contract.pipeline.gradle.args, seal.gradleUserHome);
  requireExactJson(seal, derived, 'invocation Gradle seal');
}

function validateNativePolicy(policy, receipt, contract) {
  requireExactKeys(policy, [
    'direct', 'generatedInputs', 'generatedNames', 'generatedTools', 'producerTask',
  ], 'invocation nativeProvenancePolicy');
  const expected = nativeProvenancePolicy(receipt, {
    ...contract.toolchain,
    receiptSha256: contract.receipt.sha256,
  });
  requireExactJson(policy, expected, 'invocation native provenance policy');
}

export function validateInvocationContract(contract) {
  requireExactKeys(contract, [
    'archiveReader', 'createdUtc', 'criticalInputs', 'gradleSeal', 'invocationId', 'kind',
    'mode', 'nativeProvenancePolicy', 'pipeline', 'receipt', 'schemaVersion',
    'sourceBuildId', 'toolchain', 'unity', 'verificationTools',
  ], 'invocation contract');
  if (contract.schemaVersion !== 2 || contract.kind !== 'VANDE_UNITY_ANDROID_BUILD_INPUT') {
    fail('invocation contract schema/kind is unsupported');
  }
  requireString(contract.invocationId, 'invocationId', INVOCATION_ID_PATTERN);
  requireString(contract.sourceBuildId, 'sourceBuildId', BUILD_ID_PATTERN);
  if (!['preview', 'release'].includes(contract.mode)) fail('invocation mode must be preview or release');
  if (contract.unity !== true) fail('invocation contract must require Unity');
  if (!Number.isFinite(Date.parse(contract.createdUtc))) fail('invocation createdUtc is invalid');
  requireExactKeys(contract.receipt, [
    'editorVersion', 'exportFileCount', 'exportTreeSha256', 'path', 'sha256', 'sourceFileCount', 'sourceTreeSha256',
  ], 'invocation receipt');
  requireString(contract.receipt.path, 'invocation receipt path');
  for (const key of ['sha256', 'sourceTreeSha256', 'exportTreeSha256']) {
    requireString(contract.receipt[key], `invocation receipt ${key}`, SHA256_PATTERN);
  }
  for (const key of ['sourceFileCount', 'exportFileCount']) {
    if (!Number.isSafeInteger(contract.receipt[key]) || contract.receipt[key] < 1) fail(`invocation receipt ${key} is invalid`);
  }
  requireString(contract.receipt.editorVersion, 'invocation receipt editorVersion');
  requireExactKeys(contract.pipeline, ['capacitorSync', 'gradle', 'unityPreflight', 'webBuild'], 'invocation pipeline');
  validateStep(contract.pipeline.unityPreflight, 'unityPreflight');
  validateStep(contract.pipeline.webBuild, 'webBuild', { environment: true });
  validateStep(contract.pipeline.capacitorSync, 'capacitorSync');
  validateStep(contract.pipeline.gradle, 'gradle');
  validateGradleSeal(contract.gradleSeal, contract);
  requireExactKeys(contract.toolchain, [
    'agpVersion', 'androidHome', 'cmakeVersion', 'gradleDistributionUrl', 'javaHome', 'ndkVersion', 'unityEditorVersion',
  ], 'invocation toolchain');
  for (const [key, value] of Object.entries(contract.toolchain)) requireString(value, `toolchain.${key}`);
  requireCmakeVersionOrActivity(contract.toolchain.cmakeVersion, 'toolchain.cmakeVersion');
  requireExactJson(contract.archiveReader, ARCHIVE_READER, 'invocation archiveReader');
  requireExactKeys(contract.verificationTools, ['apksigner', 'jarsigner', 'keytool'], 'verificationTools');
  validateToolRecord(contract.verificationTools.apksigner, 'apksigner', 'verificationTools.apksigner');
  validateToolRecord(contract.verificationTools.jarsigner, 'jarsigner', 'verificationTools.jarsigner');
  validateToolRecord(contract.verificationTools.keytool, 'keytool', 'verificationTools.keytool');
  if (!Array.isArray(contract.criticalInputs) || contract.criticalInputs.length === 0) {
    fail('criticalInputs must be a non-empty array');
  }
  let previous = null;
  for (const [index, input] of contract.criticalInputs.entries()) {
    requireExactKeys(input, ['bytes', 'path', 'sha256'], `criticalInputs[${index}]`);
    requireSafeRelativePath(input.path, `criticalInputs[${index}].path`);
    if (previous !== null && previous >= input.path) fail('criticalInputs must be unique and ordinally sorted');
    previous = input.path;
    if (!Number.isSafeInteger(input.bytes) || input.bytes < 1) fail(`critical input ${input.path} bytes is invalid`);
    requireString(input.sha256, `critical input ${input.path} SHA-256`, SHA256_PATTERN);
  }
  return contract;
}

function criticalInput(root, path) {
  const absolute = canonicalPath(join(root, path), `critical input ${path}`);
  return { path, bytes: statSync(absolute).size, sha256: sha256File(absolute) };
}

function matchFile(text, pattern, label) {
  const match = text.match(pattern);
  if (!match) fail(`cannot read ${label}`);
  return match[1];
}

function assertReceiptBoundFile(entries, receiptPath, absolutePath, label) {
  const entry = entries.find((candidate) => candidate.path === receiptPath);
  if (!entry) fail(`${label} is missing from the exhaustive Unity receipt`);
  const current = snapshotRegularFile(absolutePath, label);
  if (current.sha256 !== entry.sha256) fail(`${label} differs from the exhaustive Unity receipt`);
  return entry;
}

function unityAndroidNativeBuild(root, receipt, unityBuild) {
  const projectSettingsPath = join(
    root,
    'unity/VandePractice/ProjectSettings/ProjectSettings.asset',
  );
  assertReceiptBoundFile(
    receipt.sourceEntries,
    'ProjectSettings/ProjectSettings.asset',
    projectSettingsPath,
    'Unity ProjectSettings.asset',
  );
  const unityBuildPath = join(
    root,
    'unity/VandePractice/Builds/Android/unityLibrary/build.gradle',
  );
  assertReceiptBoundFile(
    receipt.exportEntries,
    'unityLibrary/build.gradle',
    unityBuildPath,
    'Unity exported unityLibrary/build.gradle',
  );
  const projectSettings = readFileSync(projectSettingsPath, 'utf8');
  const applicationEntry = Number(matchFile(
    projectSettings,
    /^\s*androidApplicationEntry:\s*([0-9]+)\s*$/mu,
    'Unity androidApplicationEntry',
  ));
  const useSwappy = Number(matchFile(
    projectSettings,
    /^\s*androidUseSwappy:\s*([01])\s*$/mu,
    'Unity androidUseSwappy',
  ));
  const cmakeBlock = unityBuild.match(/cmake\s*\{([\s\S]*?)\}/u)?.[1] ?? null;
  const cmakeVersion = cmakeBlock?.match(/version\s+["']([^"']+)["']/u)?.[1] ?? null;
  const cmakePath = cmakeBlock?.match(/path\s+["']([^"']+)["']/u)?.[1] ?? null;
  const exportPaths = new Set(receipt.exportEntries.map((entry) => entry.path));
  const unityPlayerActivityPath = 'unityLibrary/src/main/java/com/unity3d/player/UnityPlayerActivity.java';
  const unityPlayerGameActivityPath = 'unityLibrary/src/main/java/com/unity3d/player/UnityPlayerGameActivity.java';
  const gameActivityCmakePath = 'unityLibrary/src/main/cpp/CMakeLists.txt';
  const hasUnityPlayerActivity = exportPaths.has(unityPlayerActivityPath);
  const hasUnityPlayerGameActivity = exportPaths.has(unityPlayerGameActivityPath);
  const hasGameActivityCmake = exportPaths.has(gameActivityCmakePath);
  const hasGameActivityNative = [...exportPaths].some((path) => (
    /\/lib(?:game|swappywrapper)\.so$/u.test(path)
  ));

  if (applicationEntry === 1 && useSwappy === 0) {
    if (!hasUnityPlayerActivity) {
      fail(`Activity-mode Unity export omits ${unityPlayerActivityPath}`);
    }
    assertReceiptBoundFile(
      receipt.exportEntries,
      unityPlayerActivityPath,
      join(root, 'unity/VandePractice/Builds/Android', unityPlayerActivityPath),
      'UnityPlayerActivity export',
    );
    if (cmakeBlock !== null || /externalNativeBuild|src\/main\/cpp\/CMakeLists\.txt/u.test(unityBuild)
        || hasUnityPlayerGameActivity || hasGameActivityCmake || hasGameActivityNative) {
      fail('Activity-mode Unity export must not declare CMake, GameActivity, libgame, or libswappywrapper');
    }
    return { cmakeVersion: ACTIVITY_CMAKE_NOT_APPLICABLE };
  }

  if (applicationEntry === 2) {
    if (cmakeBlock === null || cmakeVersion === null
        || cmakePath !== 'src/main/cpp/CMakeLists.txt') {
      fail('cannot read GameActivity CMake version/path');
    }
    if (!hasUnityPlayerGameActivity || !hasGameActivityCmake) {
      fail('GameActivity Unity export omits its CMake/GameActivity receipt entries');
    }
    assertReceiptBoundFile(
      receipt.exportEntries,
      unityPlayerGameActivityPath,
      join(root, 'unity/VandePractice/Builds/Android', unityPlayerGameActivityPath),
      'UnityPlayerGameActivity export',
    );
    assertReceiptBoundFile(
      receipt.exportEntries,
      gameActivityCmakePath,
      join(root, 'unity/VandePractice/Builds/Android', gameActivityCmakePath),
      'GameActivity CMake export',
    );
    return { cmakeVersion };
  }

  fail(`unsupported Unity Android application entry ${applicationEntry} with androidUseSwappy=${useSwappy}`);
}

export function createInvocationContract({
  root,
  invocationId,
  sourceBuildId,
  mode,
  receiptPath,
  preflightArgs,
  webArgs,
  webEnvironment,
  syncArgs,
  gradleArgs,
  javaHome,
  androidHome,
  gradleUserHome,
  apksigner,
  jarsigner,
  keytool,
  environment = process.env,
  createdUtc = new Date().toISOString(),
}) {
  root = resolve(root);
  requireString(invocationId, 'invocationId', INVOCATION_ID_PATTERN);
  requireString(sourceBuildId, 'sourceBuildId', BUILD_ID_PATTERN);
  if (!['preview', 'release'].includes(mode)) fail('mode must be preview or release');
  receiptPath = canonicalPath(receiptPath, 'Unity receipt');
  gradleUserHome = canonicalDirectory(gradleUserHome, 'isolated GRADLE_USER_HOME');
  const verifierSnapshots = {
    apksigner: snapshotRegularFile(apksigner, 'apksigner'),
    jarsigner: snapshotRegularFile(jarsigner, 'jarsigner'),
    keytool: snapshotRegularFile(keytool, 'keytool'),
  };
  // Node exposes `process.env` through a host object whose prototype is not
  // `Object.prototype`. Snapshot its own enumerable entries into a plain
  // object before applying the strict environment policy; this preserves the
  // exact values while keeping inherited properties and host-object behavior
  // outside the validator.
  assertSealedGradleEnvironment({ ...environment }, gradleUserHome);
  const receiptBytes = readFileSync(receiptPath);
  const receipt = parseUnityExportReceipt(receiptBytes);
  const androidBuild = readFileSync(join(root, 'android/build.gradle'), 'utf8');
  const wrapperProperties = readFileSync(join(root, 'android/gradle/wrapper/gradle-wrapper.properties'), 'utf8');
  const unityBuild = readFileSync(join(root, 'unity/VandePractice/Builds/Android/unityLibrary/build.gradle'), 'utf8');
  const nativeBuild = unityAndroidNativeBuild(root, receipt, unityBuild);
  const toolchain = {
    unityEditorVersion: receipt.editorVersion,
    agpVersion: matchFile(androidBuild, /com\.android\.tools\.build:gradle:([^'"\s]+)/u, 'AGP version'),
    gradleDistributionUrl: matchFile(wrapperProperties, /^distributionUrl=(\S+)$/mu, 'Gradle distribution URL'),
    ndkVersion: matchFile(unityBuild, /ndkVersion\s+["']([^"']+)["']/u, 'NDK version'),
    cmakeVersion: nativeBuild.cmakeVersion,
    javaHome: canonicalDirectory(javaHome, 'JAVA_HOME'),
    androidHome: canonicalDirectory(androidHome, 'ANDROID_HOME'),
  };
  const contract = {
    schemaVersion: 2,
    kind: 'VANDE_UNITY_ANDROID_BUILD_INPUT',
    invocationId,
    sourceBuildId,
    mode,
    unity: true,
    createdUtc,
    receipt: {
      path: relative(root, receiptPath).split(sep).join('/'),
      sha256: sha256Bytes(receiptBytes),
      editorVersion: receipt.editorVersion,
      sourceFileCount: receipt.sourceFileCount,
      sourceTreeSha256: receipt.sourceTreeSha256,
      exportFileCount: receipt.exportFileCount,
      exportTreeSha256: receipt.exportTreeSha256,
    },
    archiveReader: ARCHIVE_READER,
    verificationTools: {
      apksigner: toolRecord(verifierSnapshots.apksigner),
      jarsigner: toolRecord(verifierSnapshots.jarsigner),
      keytool: toolRecord(verifierSnapshots.keytool),
    },
    pipeline: {
      unityPreflight: { cwd: 'android', launcher: ['nice', '-n', '15', './gradlew'], args: [...preflightArgs] },
      webBuild: { cwd: '.', launcher: [webArgs[0]], args: webArgs.slice(1), environment: { ...webEnvironment } },
      capacitorSync: { cwd: '.', launcher: [syncArgs[0]], args: syncArgs.slice(1) },
      gradle: { cwd: 'android', launcher: ['nice', '-n', '15', './gradlew'], args: [...gradleArgs] },
    },
    toolchain,
    gradleSeal: parseGradleSeal(gradleArgs, gradleUserHome),
    nativeProvenancePolicy: nativeProvenancePolicy(receipt, {
      ...toolchain,
      receiptSha256: sha256Bytes(receiptBytes),
    }),
    criticalInputs: ANDROID_UNITY_CRITICAL_INPUT_PATHS.map((path) => criticalInput(root, path))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };
  for (const [name, snapshot] of Object.entries(verifierSnapshots)) {
    assertSnapshotUnchanged(snapshot, `${name} after invocation-contract creation`);
  }
  return validateInvocationContract(contract);
}

function validateDigestRecord(record, label) {
  requireExactKeys(record, ['bytes', 'sha256'], label);
  if (!Number.isSafeInteger(record.bytes) || record.bytes < 0) fail(`${label}.bytes is invalid`);
  requireString(record.sha256, `${label}.sha256`, SHA256_PATTERN);
}

export function validateNativeProvenance(provenance, receipt, contract, contractSha256) {
  requireExactKeys(provenance, [
    'contractSha256', 'invocationId', 'kind', 'natives', 'receipt', 'schemaVersion',
    'sourceBuildId', 'treeSha256',
  ], 'signed native provenance');
  if (provenance.schemaVersion !== 1 || provenance.kind !== 'VANDE_UNITY_ANDROID_NATIVE_PROVENANCE') {
    fail('signed native provenance schema/kind is unsupported');
  }
  if (provenance.invocationId !== contract.invocationId
      || provenance.sourceBuildId !== contract.sourceBuildId
      || provenance.contractSha256 !== contractSha256) {
    fail('signed native provenance identity differs from invocation contract');
  }
  requireExactKeys(
    provenance.receipt,
    ['exportTreeSha256', 'sha256', 'sourceTreeSha256'],
    'signed native provenance receipt',
  );
  requireExactJson(provenance.receipt, {
    sha256: contract.receipt.sha256,
    sourceTreeSha256: receipt.sourceTreeSha256,
    exportTreeSha256: receipt.exportTreeSha256,
  }, 'signed native provenance receipt');
  validateNativePolicy(contract.nativeProvenancePolicy, receipt, contract);
  if (!Array.isArray(provenance.natives) || provenance.natives.length === 0) {
    fail('signed native provenance declares no native output');
  }
  const directOrigins = new Map(contract.nativeProvenancePolicy.direct.map((entry) => [entry.path, entry]));
  const generatedNames = new Set(contract.nativeProvenancePolicy.generatedNames);
  const seen = new Set();
  const tree = [];
  for (const [index, record] of provenance.natives.entries()) {
    requireExactKeys(record, ['module', 'origin', 'path'], `signed native provenance natives[${index}]`);
    const path = requireSafeRelativePath(record.path, `signed native provenance natives[${index}].path`);
    const parts = path.split('/');
    if (parts.length !== 2 || !SAFE_ABI_PATTERN.test(parts[0]) || parts[0] !== 'arm64-v8a'
        || !/^lib[^/]+\.so$/u.test(parts[1])) {
      fail(`signed native provenance path is invalid: ${path}`);
    }
    if (seen.has(path)) fail(`signed native provenance duplicates ${path}`);
    seen.add(path);
    validateDigestRecord(record.module, `signed native provenance natives[${index}].module`);
    const direct = directOrigins.get(path);
    if (direct) {
      requireExactJson(record.origin, {
        kind: 'receipt', receiptExportPath: direct.receiptExportPath, receiptSha256: direct.receiptSha256,
      }, `signed native provenance natives[${index}].origin`);
      if (record.module.sha256 !== direct.receiptSha256) {
        fail(`signed direct native mutated exhaustive receipt entry ${path}`);
      }
    } else {
      if (!generatedNames.has(parts[1])) fail(`signed native ${path} has no provenance policy`);
      requireExactJson(record.origin, {
        kind: 'generated',
        producerTask: contract.nativeProvenancePolicy.producerTask,
        inputs: contract.nativeProvenancePolicy.generatedInputs,
        tools: contract.nativeProvenancePolicy.generatedTools,
      }, `signed native provenance natives[${index}].origin`);
    }
    tree.push({ path, ...record.module });
  }
  for (const path of directOrigins.keys()) if (!seen.has(path)) fail(`signed provenance omits direct native ${path}`);
  for (const library of CORE_UNITY_LIBRARIES) {
    if (!seen.has(`arm64-v8a/${library}`)) fail(`signed provenance omits core native arm64-v8a/${library}`);
  }
  const materialTree = canonicalMaterialTree(tree);
  if (provenance.treeSha256 !== materialTree.sha256) fail('signed native provenance tree digest differs');
  return materialTree;
}

export function validateTransformManifest(manifest, receipt, contract, contractSha256, nativeProvenanceBytes) {
  requireExactKeys(manifest, [
    'assets', 'contractSha256', 'generatedUtc', 'invocationId', 'kind', 'nativeProvenance',
    'natives', 'receipt', 'schemaVersion', 'sourceBuildId', 'taskOutputs', 'trees', 'variant',
  ], 'transform manifest');
  if (manifest.schemaVersion !== 1 || manifest.kind !== 'VANDE_UNITY_ANDROID_TRANSFORM') {
    fail('transform manifest schema/kind is unsupported');
  }
  if (manifest.invocationId !== contract.invocationId) fail('transform invocationId does not match signed contract');
  if (manifest.sourceBuildId !== contract.sourceBuildId) fail('transform sourceBuildId does not match signed contract');
  if (manifest.contractSha256 !== contractSha256) fail('transform contract SHA-256 does not match signed contract');
  if (manifest.variant !== 'release') fail('transform variant must be release');
  if (!Number.isFinite(Date.parse(manifest.generatedUtc))) fail('transform generatedUtc is invalid');
  requireExactKeys(manifest.receipt, ['exportTreeSha256', 'sha256', 'sourceTreeSha256'], 'transform receipt');
  if (manifest.receipt.sha256 !== contract.receipt.sha256
      || manifest.receipt.sourceTreeSha256 !== receipt.sourceTreeSha256
      || manifest.receipt.exportTreeSha256 !== receipt.exportTreeSha256) {
    fail('transform receipt identity does not match current receipt/signed contract');
  }
  if (!Buffer.isBuffer(nativeProvenanceBytes)) fail('signed native provenance bytes are required');
  const nativeProvenance = parseJsonBytes(nativeProvenanceBytes, 'signed native provenance');
  validateNativePolicy(contract.nativeProvenancePolicy, receipt, contract);
  const signedNativeTree = validateNativeProvenance(
    nativeProvenance, receipt, contract, contractSha256,
  );
  requireExactKeys(manifest.nativeProvenance, ['bytes', 'entry', 'sha256'], 'transform nativeProvenance');
  if (manifest.nativeProvenance.entry !== NATIVE_PROVENANCE_ENTRY
      || !Number.isSafeInteger(manifest.nativeProvenance.bytes)
      || manifest.nativeProvenance.bytes < 1) {
    fail('transform nativeProvenance entry/bytes are invalid');
  }
  requireString(manifest.nativeProvenance.sha256, 'transform nativeProvenance SHA-256', SHA256_PATTERN);
  if (manifest.nativeProvenance.bytes !== nativeProvenanceBytes.length
      || manifest.nativeProvenance.sha256 !== sha256Bytes(nativeProvenanceBytes)) {
    fail('transform nativeProvenance digest differs from signed archive bytes');
  }
  const expectedAssets = new Map(receipt.exportEntries
    .filter((entry) => entry.path.startsWith('unityLibrary/src/main/assets/'))
    .map((entry) => [entry.path.slice('unityLibrary/src/main/assets/'.length), entry]));
  if (expectedAssets.size === 0) fail('receipt declares no Unity Android assets');
  if (!Array.isArray(manifest.assets) || manifest.assets.length !== expectedAssets.size) {
    fail('transform asset set is not exhaustive');
  }
  const assetTree = [];
  const seenAssets = new Set();
  for (const [index, record] of manifest.assets.entries()) {
    requireExactKeys(record, ['app', 'module', 'path', 'receiptExportPath', 'receiptSha256'], `assets[${index}]`);
    const path = requireSafeRelativePath(record.path, `assets[${index}].path`);
    if (seenAssets.has(path)) fail(`duplicate transform asset ${path}`);
    seenAssets.add(path);
    const expected = expectedAssets.get(path);
    if (!expected || record.receiptExportPath !== expected.path || record.receiptSha256 !== expected.sha256) {
      fail(`transform asset ${path} is not bound to the exhaustive receipt`);
    }
    validateDigestRecord(record.module, `assets[${index}].module`);
    validateDigestRecord(record.app, `assets[${index}].app`);
    if (record.module.sha256 !== expected.sha256) fail(`Unity module mutated receipt asset ${path}`);
    if (record.app.sha256 !== record.module.sha256 || record.app.bytes !== record.module.bytes) {
      fail(`unrecognized Android asset mutation for ${path}`);
    }
    assetTree.push({ path, bytes: record.app.bytes, sha256: record.app.sha256 });
  }
  if ([...expectedAssets.keys()].some((path) => !seenAssets.has(path))) fail('transform omits a receipt asset');
  if (!Array.isArray(manifest.natives) || manifest.natives.length === 0) fail('transform declares no Unity native output');
  const nativeTree = [];
  const moduleNativeTree = [];
  const seenNatives = new Set();
  const directOrigins = new Map(contract.nativeProvenancePolicy.direct.map((entry) => [entry.path, entry]));
  const generatedNames = new Set(contract.nativeProvenancePolicy.generatedNames);
  for (const [index, record] of manifest.natives.entries()) {
    requireExactKeys(record, ['app', 'module', 'origin', 'path'], `natives[${index}]`);
    const path = requireSafeRelativePath(record.path, `natives[${index}].path`);
    const parts = path.split('/');
    if (parts.length !== 2 || !SAFE_ABI_PATTERN.test(parts[0]) || parts[0] !== 'arm64-v8a'
        || !/^lib[^/]+\.so$/u.test(parts[1])) {
      fail(`native path is invalid: ${path}`);
    }
    if (seenNatives.has(path)) fail(`duplicate transform native ${path}`);
    seenNatives.add(path);
    validateDigestRecord(record.module, `natives[${index}].module`);
    validateDigestRecord(record.app, `natives[${index}].app`);
    const direct = directOrigins.get(path);
    if (direct) {
      requireExactJson(record.origin, {
        kind: 'receipt',
        receiptExportPath: direct.receiptExportPath,
        receiptSha256: direct.receiptSha256,
      }, `natives[${index}].origin`);
      if (record.module.sha256 !== direct.receiptSha256) {
        fail(`Unity direct native mutated exhaustive receipt entry ${path}`);
      }
    } else {
      if (!generatedNames.has(parts[1])) fail(`native ${path} has no signed provenance policy`);
      requireExactJson(record.origin, {
        kind: 'generated',
        producerTask: contract.nativeProvenancePolicy.producerTask,
        inputs: contract.nativeProvenancePolicy.generatedInputs,
        tools: contract.nativeProvenancePolicy.generatedTools,
      }, `natives[${index}].origin`);
    }
    const signed = nativeProvenance.natives.find((candidate) => candidate.path === path);
    if (!signed || stableStringify({ module: record.module, origin: record.origin, path }) !== stableStringify(signed)) {
      fail(`transform native ${path} differs from signed native provenance`);
    }
    moduleNativeTree.push({ path, bytes: record.module.bytes, sha256: record.module.sha256 });
    nativeTree.push({ path, bytes: record.app.bytes, sha256: record.app.sha256 });
  }
  for (const library of CORE_UNITY_LIBRARIES) {
    if (!seenNatives.has(`arm64-v8a/${library}`)) fail(`transform omits core Unity native arm64-v8a/${library}`);
  }
  for (const path of directOrigins.keys()) {
    if (!seenNatives.has(path)) fail(`transform omits receipt-declared direct native ${path}`);
  }
  requireExactKeys(manifest.trees, ['assetAppSha256', 'nativeAppSha256', 'nativeModuleSha256'], 'transform trees');
  const computedAssetTree = canonicalMaterialTree(assetTree);
  const computedModuleNativeTree = canonicalMaterialTree(moduleNativeTree);
  const computedNativeTree = canonicalMaterialTree(nativeTree);
  if (manifest.trees.assetAppSha256 !== computedAssetTree.sha256
      || manifest.trees.nativeModuleSha256 !== computedModuleNativeTree.sha256
      || manifest.trees.nativeModuleSha256 !== signedNativeTree.sha256
      || manifest.trees.nativeAppSha256 !== computedNativeTree.sha256) {
    fail('transform canonical tree digest does not match its records');
  }
  requireExactJson(manifest.taskOutputs, TRANSFORM_TASK_OUTPUTS, 'transform taskOutputs');
  return { assetTree: computedAssetTree, moduleNativeTree: computedModuleNativeTree, nativeTree: computedNativeTree };
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/** Fixed, in-process ZIP reader. It deliberately rejects ZIP64, encryption,
 * unsafe/duplicate names and unsupported methods. Gate-A artifacts are below
 * 50 MB, so ZIP64 is neither needed nor silently accepted. */
export function openZipArchive(bytes, label = 'archive') {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22) fail(`${label} is not a ZIP archive`);
  const minimum = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) fail(`${label} has no ZIP end-of-central-directory record`);
  const commentLength = bytes.readUInt16LE(eocd + 20);
  if (eocd + 22 + commentLength !== bytes.length) fail(`${label} has trailing or malformed ZIP bytes`);
  const disk = bytes.readUInt16LE(eocd + 4);
  const centralDisk = bytes.readUInt16LE(eocd + 6);
  const diskEntries = bytes.readUInt16LE(eocd + 8);
  const totalEntries = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) fail(`${label} is a multi-disk ZIP`);
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    fail(`${label} uses unsupported ZIP64 metadata`);
  }
  if (centralOffset + centralSize !== eocd) fail(`${label} central directory bounds are invalid`);
  const entries = new Map();
  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > eocd || bytes.readUInt32LE(offset) !== 0x02014b50) {
      fail(`${label} central entry ${index} is malformed`);
    }
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const checksum = bytes.readUInt32LE(offset + 16);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const entryCommentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const end = offset + 46 + nameLength + extraLength + entryCommentLength;
    if (end > eocd || [compressedSize, uncompressedSize, localOffset].includes(0xffffffff)) {
      fail(`${label} entry ${index} uses malformed or ZIP64 metadata`);
    }
    if ((flags & 0x1) !== 0 || ![0, 8].includes(method)) fail(`${label} entry ${index} is encrypted or unsupported`);
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const name = nameBytes.toString('utf8');
    if (!Buffer.from(name, 'utf8').equals(nameBytes)) fail(`${label} entry ${index} name is not UTF-8`);
    const canonicalName = name.endsWith('/') ? name.slice(0, -1) : name;
    requireSafeRelativePath(canonicalName, `${label} entry ${index}`);
    if (entries.has(name)) fail(`${label} contains duplicate entry ${name}`);
    totalUncompressed += uncompressedSize;
    if (uncompressedSize > 512 * 1024 * 1024 || totalUncompressed > 2 * 1024 * 1024 * 1024) {
      fail(`${label} exceeds the bounded uncompressed-size policy`);
    }
    entries.set(name, { name, nameBytes, flags, method, checksum, compressedSize, uncompressedSize, localOffset });
    offset = end;
  }
  if (offset !== eocd) fail(`${label} central directory has unparsed bytes`);
  const extract = (name) => {
    const entry = entries.get(name);
    if (!entry) fail(`${label} is missing ${name}`);
    const local = entry.localOffset;
    if (local + 30 > centralOffset || bytes.readUInt32LE(local) !== 0x04034b50) fail(`${label} local header is invalid: ${name}`);
    const localFlags = bytes.readUInt16LE(local + 6);
    const localMethod = bytes.readUInt16LE(local + 8);
    const localNameLength = bytes.readUInt16LE(local + 26);
    const localExtraLength = bytes.readUInt16LE(local + 28);
    const localName = bytes.subarray(local + 30, local + 30 + localNameLength);
    if (localFlags !== entry.flags || localMethod !== entry.method || !localName.equals(entry.nameBytes)) {
      fail(`${label} central/local entry metadata differs: ${name}`);
    }
    const start = local + 30 + localNameLength + localExtraLength;
    const end = start + entry.compressedSize;
    if (end > centralOffset) fail(`${label} compressed entry exceeds local-data bounds: ${name}`);
    const compressed = bytes.subarray(start, end);
    let output;
    try {
      output = entry.method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize });
    } catch (error) {
      fail(`${label} cannot inflate ${name}: ${error.message}`);
    }
    if (output.length !== entry.uncompressedSize || crc32(output) !== entry.checksum) {
      fail(`${label} entry size/CRC differs: ${name}`);
    }
    return output;
  };
  return { names: [...entries.keys()], extract };
}

function verifyArchivePayload({ label, archiveBytes, contractBytes, nativeProvenanceBytes, transform, prefixes }) {
  const archive = openZipArchive(archiveBytes, label);
  const entries = archive.names;
  const attestation = archive.extract(prefixes.attestation);
  if (!attestation.equals(contractBytes)) fail(`${label} signed input attestation differs from invocation contract`);
  const nativeProvenance = archive.extract(prefixes.nativeProvenance);
  if (!nativeProvenance.equals(nativeProvenanceBytes)) {
    fail(`${label} signed native provenance differs from the bound original bytes`);
  }
  const assets = [];
  for (const record of transform.assets) {
    const entry = `${prefixes.asset}${record.path}`;
    const bytes = archive.extract(entry);
    const sha256 = sha256Bytes(bytes);
    if (bytes.length !== record.app.bytes || sha256 !== record.app.sha256) {
      fail(`${label} Unity asset differs from same-invocation app transform: ${record.path}`);
    }
    assets.push({ path: record.path, bytes: bytes.length, sha256 });
  }
  const natives = [];
  for (const record of transform.natives) {
    const entry = `${prefixes.native}${record.path}`;
    const bytes = archive.extract(entry);
    const sha256 = sha256Bytes(bytes);
    if (bytes.length !== record.app.bytes || sha256 !== record.app.sha256) {
      fail(`${label} Unity native differs from same-invocation final transform: ${record.path}`);
    }
    natives.push({ path: record.path, bytes: bytes.length, sha256 });
  }
  const expectedData = new Set(transform.assets
    .filter((record) => record.path.startsWith('bin/Data/'))
    .map((record) => `${prefixes.asset}${record.path}`));
  const actualData = entries.filter((entry) => entry.startsWith(`${prefixes.asset}bin/Data/`) && !entry.endsWith('/'));
  if (actualData.some((entry) => !expectedData.has(entry)) || [...expectedData].some((entry) => !actualData.includes(entry))) {
    fail(`${label} Unity Data inventory differs from exhaustive receipt mapping`);
  }
  for (const entry of entries.filter((candidate) => candidate.startsWith(prefixes.native) && candidate.endsWith('.so'))) {
    const relativeNative = entry.slice(prefixes.native.length);
    const parts = relativeNative.split('/');
    if (parts.length !== 2 || !SAFE_ABI_PATTERN.test(parts[0]) || !/^lib[^/]+\.so$/u.test(parts[1])) {
      fail(`${label} native path is invalid: ${entry}`);
    }
    const file = parts[1];
    const isBound = transform.natives.some((record) => record.path === relativeNative);
    if (KNOWN_UNITY_LIBRARIES.has(file) && !isBound) {
      fail(`${label} contains an unbound Unity native ${entry}`);
    }
    if (!isBound && !KNOWN_NON_UNITY_APP_LIBRARIES.has(file)) {
      fail(`${label} contains an unbound native ${entry}`);
    }
  }
  return { assets: canonicalMaterialTree(assets), natives: canonicalMaterialTree(natives) };
}

function runBoundVerifier(tool, target, args, label, environment = process.env) {
  assertSnapshotUnchanged(tool, `${label} tool before verification`);
  assertSnapshotUnchanged(target, `${label} target before verification`);
  const result = spawnSync(tool.path, args, {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    env: environment,
  });
  assertSnapshotUnchanged(target, `${label} target after verification`);
  assertSnapshotUnchanged(tool, `${label} tool after verification`);
  if (result.error) fail(`${label} could not execute: ${result.error.message}`);
  return {
    result,
    record: {
      tool: toolRecord(tool),
      args: [...args.slice(0, -1), `<${basename(target.path)}>`],
      exitStatus: result.status,
      signal: result.signal ?? null,
      stdoutSha256: sha256Bytes(Buffer.from(result.stdout ?? '', 'utf8')),
      stderrSha256: sha256Bytes(Buffer.from(result.stderr ?? '', 'utf8')),
      targetSha256: target.sha256,
    },
  };
}

export function parseApkSignerReport(report) {
  if (typeof report !== 'string' || report.length === 0) fail('apksigner report is empty');
  const labels = new Set();
  const digests = [];
  let grammar = null;
  for (const line of report.split(/\r?\n/u)) {
    const numbered = line.match(/^Signer #(\d+) certificate SHA-256 digest:\s*([0-9a-fA-F]{64})\s*$/u);
    const scheme = line.match(/^(V[1-4]) Signer: certificate SHA-256 digest:\s*([0-9a-fA-F]{64})\s*$/u);
    if (!numbered && !scheme) {
      if (line.includes('certificate SHA-256 digest:')) {
        fail('apksigner emitted an unsupported certificate-digest grammar');
      }
      continue;
    }
    const currentGrammar = numbered ? 'NUMBERED_SIGNER' : 'SCHEME_SIGNER';
    if (grammar && grammar !== currentGrammar) fail('apksigner mixed signer-report grammars');
    grammar = currentGrammar;
    const label = numbered ? `Signer #${numbered[1]}` : scheme[1];
    if (numbered && numbered[1] !== '1') fail('APK exposes multiple numbered signers');
    if (labels.has(label)) fail(`apksigner duplicates certificate digest for ${label}`);
    labels.add(label);
    digests.push((numbered?.[2] ?? scheme[2]).toLowerCase());
  }
  if (digests.length === 0) fail('APK exposes no supported signer certificate SHA-256 digest');
  const uniqueDigests = new Set(digests);
  if (uniqueDigests.size !== 1) fail('APK signer certificate SHA-256 digests conflict across schemes');
  return [...uniqueDigests][0];
}

function signerReport(apksigner, apk) {
  const { result, record } = runBoundVerifier(
    apksigner, apk, ['verify', '--print-certs', apk.path], 'apksigner',
  );
  if (result.status !== 0) fail(`apksigner rejected APK: ${result.stderr}`);
  return {
    certificateSha256: parseApkSignerReport(result.stdout),
    verification: {
      ...record,
      accepted: true,
      policy: 'APKSIGNER_VERIFY_PRINT_CERTS_ONE_CONSISTENT_CERTIFICATE_V2',
    },
  };
}

export function parseAabSignerReport(report) {
  if (typeof report !== 'string' || report.length === 0) fail('keytool AAB signer report is empty');
  const signers = [...report.matchAll(/^Signer #(\d+):\s*$/gmu)];
  if (signers.length !== 1 || signers[0][1] !== '1') fail('AAB must expose exactly one signer');
  const certificateStart = report.indexOf('Certificate #1:', signers[0].index);
  if (certificateStart < 0) fail('AAB signer report omits Certificate #1');
  const nextCertificate = report.indexOf('\nCertificate #2:', certificateStart);
  const certificate = report.slice(
    certificateStart,
    nextCertificate < 0 ? report.length : nextCertificate,
  );
  const fingerprint = certificate.match(/^\s*SHA256:\s*([0-9A-Fa-f:]+)\s*$/mu)?.[1]
    ?.replaceAll(':', '').toLowerCase();
  if (!fingerprint || !SHA256_PATTERN.test(fingerprint)) fail('AAB signer SHA-256 fingerprint is invalid');
  return fingerprint;
}

function isJarSignatureMetadata(path) {
  // MANIFEST.MF is signed content in a JAR/AAB and must be proven with the
  // same `s` flag as every payload entry. Only the detached signature block
  // metadata itself is excluded from the content-entry inventory.
  return /^META-INF\/[^/]+\.(?:SF|RSA|DSA|EC)$/iu.test(path);
}

export function classifyJarsignerVerification(report, status, requiredEntries) {
  if (typeof report !== 'string' || !Array.isArray(requiredEntries) || requiredEntries.length === 0) {
    fail('strict jarsigner classification requires a report and content-entry set');
  }
  const lines = report.split(/\r?\n/u);
  const plainMarkers = lines.filter((line) => line.trim() === 'jar verified.');
  const signerErrorMarkers = lines.filter(
    (line) => line.trim() === 'jar verified, with signer errors.',
  );
  if ((status === 0 && (plainMarkers.length !== 1 || signerErrorMarkers.length !== 0))
      || (status === 4 && (plainMarkers.length !== 0 || signerErrorMarkers.length !== 1))
      || ![0, 4].includes(status)) {
    fail(`strict jarsigner rejected AAB (status=${status})`);
  }

  const signedEntries = new Map();
  const verboseEntry = /^\s*([a-z?]+)\s+([0-9]+)\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+)$/u;
  for (const line of lines) {
    const match = line.match(verboseEntry);
    if (!match) continue;
    const path = match[3];
    if (signedEntries.has(path)) fail(`strict jarsigner report duplicates entry ${path}`);
    signedEntries.set(path, { flags: match[1], bytes: Number(match[2]) });
  }
  const required = [...new Set(requiredEntries)];
  if (required.length !== requiredEntries.length) fail('strict jarsigner required-entry set contains duplicates');
  for (const path of required) {
    requireSafeRelativePath(path, 'strict jarsigner required entry');
    const record = signedEntries.get(path);
    if (!record || !record.flags.includes('s')) {
      fail(`strict jarsigner did not prove signed content entry ${path}`);
    }
  }

  const inconsistencyHeader = 'This JAR file contains internal inconsistencies that may result in different contents when reading via JarFile and JarInputStream:';
  const inconsistencyEntries = [];
  for (const line of lines.filter((candidate) => candidate.includes('not signed in JarInputStream'))) {
    const match = line.match(/^- Entry (.+) is signed in JarFile but is not signed in JarInputStream$/u);
    if (!match || !required.includes(match[1])) {
      fail('strict jarsigner emitted an unbound JarFile/JarInputStream inconsistency');
    }
    inconsistencyEntries.push(match[1]);
  }
  if (inconsistencyEntries.length > 0 && !lines.includes(inconsistencyHeader)) {
    fail('strict jarsigner inconsistency entries lack their exact diagnostic header');
  }

  const chainWarning = 'This jar contains entries whose certificate chain is invalid. Reason: '
    + 'PKIX path building failed: sun.security.provider.certpath.SunCertPathBuilderException: '
    + 'unable to find valid certification path to requested target';
  const selfSignedWarning = 'This jar contains entries whose signer certificate is self-signed.';
  const entryCertificateWarnings = lines.filter((line) => line.startsWith('This jar contains entries whose'));
  const exactSelfSignedChainProfile = entryCertificateWarnings.length === 2
    && entryCertificateWarnings.filter((line) => line === chainWarning).length === 1
    && entryCertificateWarnings.filter((line) => line === selfSignedWarning).length === 1;
  const dangerousWarnings = lines.filter((line) => (
    /expired|not yet valid|unsigned entr|not signed by|disabled algorithm/iu.test(line)
    && !line.endsWith('is signed in JarFile but is not signed in JarInputStream')
  ));
  if (dangerousWarnings.length > 0) fail('strict jarsigner emitted a disallowed signature warning');
  if (status === 4 && !exactSelfSignedChainProfile) {
    fail('strict jarsigner status 4 is not the exact self-signed/invalid-chain profile');
  }
  if (status === 4
      && (lines.filter((line) => line.trim() === 'Error:').length !== 1
        || lines.filter((line) => line.trim() === 'Warning:').length !== 1)) {
    fail('strict jarsigner status 4 lacks the exact error/warning structure');
  }
  if (status === 0 && entryCertificateWarnings.length > 0) {
    fail('strict jarsigner status 0 contains signer-certificate errors');
  }
  return {
    classification: status === 0
      ? 'VERIFIED_STRICT_STATUS_0_ALL_CONTENT_SIGNED'
      : 'VERIFIED_STRICT_STATUS_4_SELF_SIGNED_INVALID_CHAIN_ALL_CONTENT_SIGNED',
    verifiedMarker: true,
    requiredSignedEntryCount: required.length,
    reportedSignedEntryCount: [...signedEntries.values()].filter((entry) => entry.flags.includes('s')).length,
    jarFileStreamInconsistencyCount: inconsistencyEntries.length,
  };
}

function aabSignerReport(keytool, jarsigner, aab, requiredEntries) {
  const environment = { ...process.env, LC_ALL: 'C', LANG: 'C' };
  const strict = runBoundVerifier(
    jarsigner,
    aab,
    ['-verify', '-strict', '-verbose', '-certs', aab.path],
    'strict jarsigner',
    environment,
  );
  const strictText = `${strict.result.stdout ?? ''}\n${strict.result.stderr ?? ''}`;
  const classification = classifyJarsignerVerification(
    strictText, strict.result.status, requiredEntries,
  );
  const checked = runBoundVerifier(
    keytool, aab, ['-printcert', '-jarfile', aab.path], 'keytool AAB signer', environment,
  );
  if (checked.result.status !== 0) fail(`keytool rejected AAB: ${checked.result.stderr}`);
  return {
    certificateSha256: parseAabSignerReport(checked.result.stdout),
    verification: {
      strictJarsigner: {
        ...strict.record,
        accepted: true,
        ...classification,
        policy: 'JARSIGNER_STRICT_ALL_CONTENT_STATUS_0_OR_EXACT_SELF_SIGNED_CHAIN_STATUS_4_V3',
      },
      signerCertificate: {
        ...checked.record,
        accepted: true,
        policy: 'KEYTOOL_SINGLE_JAR_SIGNER_CERTIFICATE_V1',
      },
    },
  };
}

export function buildPayloadBinding({
  apkPath,
  aabPath,
  contractPath,
  transformPath,
  receiptPath,
  sourceBuildId,
  apksigner,
  jarsigner,
  keytool,
  recordedUtc = new Date().toISOString(),
}) {
  const originals = {
    apk: snapshotRegularFile(apkPath, 'APK'),
    aab: snapshotRegularFile(aabPath, 'AAB'),
    contract: snapshotRegularFile(contractPath, 'invocation contract'),
    transform: snapshotRegularFile(transformPath, 'transform manifest'),
    receipt: snapshotRegularFile(receiptPath, 'Unity receipt'),
  };
  const tools = {
    apksigner: snapshotRegularFile(apksigner, 'apksigner'),
    jarsigner: snapshotRegularFile(jarsigner, 'jarsigner'),
    keytool: snapshotRegularFile(keytool, 'keytool'),
  };
  const contractBytes = originals.contract.bytes;
  const transformBytes = originals.transform.bytes;
  const receiptBytes = originals.receipt.bytes;
  const contract = validateInvocationContract(parseJsonBytes(contractBytes, 'invocation contract'));
  if (contract.sourceBuildId !== sourceBuildId) fail('current sourceBuildId differs from invocation contract');
  requireExactJson(contract.archiveReader, ARCHIVE_READER, 'signed archive reader policy');
  for (const [name, snapshot] of Object.entries(tools)) {
    requireExactJson(toolRecord(snapshot), contract.verificationTools[name], `signed ${name} identity`);
  }
  const receipt = parseUnityExportReceipt(receiptBytes);
  const receiptSha256 = sha256Bytes(receiptBytes);
  if (contract.receipt.sha256 !== receiptSha256
      || contract.receipt.sourceTreeSha256 !== receipt.sourceTreeSha256
      || contract.receipt.exportTreeSha256 !== receipt.exportTreeSha256) {
    fail('current exhaustive Unity receipt differs from signed invocation contract');
  }
  const contractSha256 = sha256Bytes(contractBytes);
  const transform = parseJsonBytes(transformBytes, 'transform manifest');
  const apkArchive = openZipArchive(originals.apk.bytes, 'APK');
  const aabArchive = openZipArchive(originals.aab.bytes, 'AAB');
  const nativeProvenanceBytes = apkArchive.extract(NATIVE_PROVENANCE_ENTRY);
  const aabNativeProvenanceBytes = aabArchive.extract(AAB_NATIVE_PROVENANCE_ENTRY);
  if (!nativeProvenanceBytes.equals(aabNativeProvenanceBytes)) {
    fail('APK and AAB signed native provenance bytes differ');
  }
  const trees = validateTransformManifest(
    transform, receipt, contract, contractSha256, nativeProvenanceBytes,
  );
  const apkPayload = verifyArchivePayload({
    label: 'APK', archiveBytes: originals.apk.bytes, contractBytes, nativeProvenanceBytes, transform,
    prefixes: {
      attestation: INPUT_ATTESTATION_ENTRY, nativeProvenance: NATIVE_PROVENANCE_ENTRY,
      asset: 'assets/', native: 'lib/',
    },
  });
  const aabPayload = verifyArchivePayload({
    label: 'AAB', archiveBytes: originals.aab.bytes, contractBytes, nativeProvenanceBytes, transform,
    prefixes: {
      attestation: AAB_INPUT_ATTESTATION_ENTRY, nativeProvenance: AAB_NATIVE_PROVENANCE_ENTRY,
      asset: 'base/assets/', native: 'base/lib/',
    },
  });
  if (apkPayload.assets.sha256 !== aabPayload.assets.sha256
      || apkPayload.natives.sha256 !== aabPayload.natives.sha256) {
    fail('APK and AAB Unity material trees differ');
  }
  const requiredSignedAabEntries = aabArchive.names.filter((entry) => (
    !entry.endsWith('/') && !isJarSignatureMetadata(entry)
  ));
  let scratch = mkdtempSync(join(tmpdir(), 'vande-unity-verification.'));
  scratch = realpathSync(scratch);
  let signature;
  let aabSignature;
  try {
    const apkSnapshotPath = join(scratch, 'candidate.apk');
    const aabSnapshotPath = join(scratch, 'candidate.aab');
    writeFileSync(apkSnapshotPath, originals.apk.bytes, { flag: 'wx', mode: 0o400 });
    writeFileSync(aabSnapshotPath, originals.aab.bytes, { flag: 'wx', mode: 0o400 });
    const verifierArtifacts = {
      apk: snapshotRegularFile(apkSnapshotPath, 'immutable APK verifier snapshot'),
      aab: snapshotRegularFile(aabSnapshotPath, 'immutable AAB verifier snapshot'),
    };
    signature = signerReport(tools.apksigner, verifierArtifacts.apk);
    aabSignature = aabSignerReport(
      tools.keytool, tools.jarsigner, verifierArtifacts.aab, requiredSignedAabEntries,
    );
    assertSnapshotUnchanged(verifierArtifacts.apk, 'immutable APK verifier snapshot final');
    assertSnapshotUnchanged(verifierArtifacts.aab, 'immutable AAB verifier snapshot final');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (signature.certificateSha256 !== aabSignature.certificateSha256) {
    fail('APK and AAB signer certificate SHA-256 digests differ');
  }
  for (const [name, snapshot] of Object.entries({ ...originals, ...tools })) {
    assertSnapshotUnchanged(snapshot, `${name} final transaction identity`);
  }
  const sidecar = {
    schemaVersion: 2,
    kind: 'VANDE_UNITY_ANDROID_PAYLOAD_BINDING',
    status: 'BUILD_TIME_BINDING_RECORDED_NOT_CERTIFICATION',
    limitation: 'Local build-time provenance only; not Play, installed-size, reach, physical-device, runtime, human-player, or malicious-builder-resistant evidence.',
    recordedUtc,
    invocationId: contract.invocationId,
    sourceBuildId,
    invocationContract: {
      entry: INPUT_ATTESTATION_ENTRY,
      bytes: contractBytes.length,
      sha256: contractSha256,
      mode: contract.mode,
      createdUtc: contract.createdUtc,
      pipeline: contract.pipeline,
    },
    unityReceipt: {
      sha256: receiptSha256,
      sourceFileCount: receipt.sourceFileCount,
      sourceTreeSha256: receipt.sourceTreeSha256,
      exportFileCount: receipt.exportFileCount,
      exportTreeSha256: receipt.exportTreeSha256,
    },
    transformManifest: {
      bytes: transformBytes.length,
      sha256: sha256Bytes(transformBytes),
      canonicalBase64: transformBytes.toString('base64'),
      taskOutputs: transform.taskOutputs,
      trees: transform.trees,
    },
    archiveReader: ARCHIVE_READER,
    apk: {
      fileName: basename(apkPath),
      bytes: originals.apk.size,
      sha256: originals.apk.sha256,
      signerCertificateSha256: signature.certificateSha256,
      signatureVerification: signature.verification,
      assetTreeSha256: apkPayload.assets.sha256,
      nativeTreeSha256: apkPayload.natives.sha256,
    },
    aab: {
      fileName: basename(aabPath),
      bytes: originals.aab.size,
      sha256: originals.aab.sha256,
      signerCertificateSha256: aabSignature.certificateSha256,
      signatureVerification: aabSignature.verification,
      assetTreeSha256: aabPayload.assets.sha256,
      nativeTreeSha256: aabPayload.natives.sha256,
    },
    material: {
      assets: transform.assets.map((record) => ({
        path: record.path,
        receiptExportPath: record.receiptExportPath,
        receiptSha256: record.receiptSha256,
        module: record.module,
        app: record.app,
      })),
      natives: transform.natives.map((record) => ({
        path: record.path, module: record.module, app: record.app, origin: record.origin,
      })),
      assetTreeSha256: trees.assetTree.sha256,
      nativeModuleTreeSha256: trees.moduleNativeTree.sha256,
      nativeAppTreeSha256: trees.nativeTree.sha256,
    },
    toolchain: contract.toolchain,
    criticalInputs: contract.criticalInputs,
  };
  validatePayloadBindingSidecar(sidecar);
  return sidecar;
}

function requireCanonicalIso(value, label) {
  requireString(value, label);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail(`${label} must be a canonical UTC timestamp`);
  }
}

function requireArtifactFileName(value, extension, label) {
  requireSafeRelativePath(value, label);
  if (basename(value) !== value || !value.endsWith(extension)) {
    fail(`${label} must be a basename ending in ${extension}`);
  }
}

function validateVerifierResult(value, expectedTool, label, extraKeys = []) {
  requireExactKeys(value, [
    'accepted', 'args', 'exitStatus', 'policy', 'signal', 'stderrSha256',
    'stdoutSha256', 'targetSha256', 'tool', ...extraKeys,
  ], label);
  if (value.accepted !== true) fail(`${label}.accepted must be true`);
  requireStringArray(value.args, `${label}.args`);
  if (!Number.isSafeInteger(value.exitStatus)) fail(`${label}.exitStatus is invalid`);
  if (value.signal !== null) fail(`${label}.signal must be null`);
  for (const key of ['stderrSha256', 'stdoutSha256', 'targetSha256']) {
    requireString(value[key], `${label}.${key}`, SHA256_PATTERN);
  }
  requireString(value.policy, `${label}.policy`);
  validateToolRecord(value.tool, expectedTool, `${label}.tool`);
}

function validateBoundArtifact(value, extension, artifactKind, label) {
  requireExactKeys(value, [
    'assetTreeSha256', 'bytes', 'fileName', 'nativeTreeSha256', 'sha256',
    'signatureVerification', 'signerCertificateSha256',
  ], label);
  requireArtifactFileName(value.fileName, extension, `${label}.fileName`);
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 1) fail(`${label}.bytes is invalid`);
  for (const key of ['sha256', 'signerCertificateSha256', 'assetTreeSha256', 'nativeTreeSha256']) {
    requireString(value[key], `${label}.${key}`, SHA256_PATTERN);
  }
  if (artifactKind === 'apk') {
    validateVerifierResult(value.signatureVerification, 'apksigner', `${label}.signatureVerification`);
    if (value.signatureVerification.exitStatus !== 0
        || value.signatureVerification.policy
          !== 'APKSIGNER_VERIFY_PRINT_CERTS_ONE_CONSISTENT_CERTIFICATE_V2'
        || value.signatureVerification.targetSha256 !== value.sha256) {
      fail(`${label} apksigner result does not bind the artifact`);
    }
  } else {
    requireExactKeys(
      value.signatureVerification,
      ['signerCertificate', 'strictJarsigner'],
      `${label}.signatureVerification`,
    );
    validateVerifierResult(
      value.signatureVerification.strictJarsigner,
      'jarsigner',
      `${label}.signatureVerification.strictJarsigner`,
      [
        'classification', 'jarFileStreamInconsistencyCount', 'reportedSignedEntryCount',
        'requiredSignedEntryCount', 'verifiedMarker',
      ],
    );
    const strict = value.signatureVerification.strictJarsigner;
    const expectedClassification = strict.exitStatus === 0
      ? 'VERIFIED_STRICT_STATUS_0_ALL_CONTENT_SIGNED'
      : strict.exitStatus === 4
        ? 'VERIFIED_STRICT_STATUS_4_SELF_SIGNED_INVALID_CHAIN_ALL_CONTENT_SIGNED'
        : null;
    if (strict.verifiedMarker !== true
        || strict.classification !== expectedClassification
        || strict.policy !== 'JARSIGNER_STRICT_ALL_CONTENT_STATUS_0_OR_EXACT_SELF_SIGNED_CHAIN_STATUS_4_V3'
        || !Number.isSafeInteger(strict.requiredSignedEntryCount)
        || strict.requiredSignedEntryCount < 1
        || !Number.isSafeInteger(strict.reportedSignedEntryCount)
        || strict.reportedSignedEntryCount < strict.requiredSignedEntryCount
        || !Number.isSafeInteger(strict.jarFileStreamInconsistencyCount)
        || strict.jarFileStreamInconsistencyCount < 0) {
      fail(`${label} strict jarsigner result is not accepted`);
    }
    validateVerifierResult(
      value.signatureVerification.signerCertificate,
      'keytool',
      `${label}.signatureVerification.signerCertificate`,
    );
    if (value.signatureVerification.signerCertificate.exitStatus !== 0) {
      fail(`${label} keytool result is not accepted`);
    }
    for (const result of Object.values(value.signatureVerification)) {
      if (result.targetSha256 !== value.sha256) fail(`${label} verifier result does not bind the final AAB`);
    }
  }
}

function validateCriticalInputList(value, label) {
  if (!Array.isArray(value) || value.length === 0) fail(`${label} must be a non-empty array`);
  let previous = null;
  for (const [index, input] of value.entries()) {
    requireExactKeys(input, ['bytes', 'path', 'sha256'], `${label}[${index}]`);
    requireSafeRelativePath(input.path, `${label}[${index}].path`);
    if (previous !== null && previous >= input.path) fail(`${label} must be unique and ordinally sorted`);
    previous = input.path;
    if (!Number.isSafeInteger(input.bytes) || input.bytes < 1) fail(`${label}[${index}].bytes is invalid`);
    requireString(input.sha256, `${label}[${index}].sha256`, SHA256_PATTERN);
  }
}

function validateToolchain(value, label) {
  requireExactKeys(value, [
    'agpVersion', 'androidHome', 'cmakeVersion', 'gradleDistributionUrl', 'javaHome', 'ndkVersion', 'unityEditorVersion',
  ], label);
  for (const [key, item] of Object.entries(value)) requireString(item, `${label}.${key}`);
  requireCmakeVersionOrActivity(value.cmakeVersion, `${label}.cmakeVersion`);
}

function requireExactJson(actual, expected, label) {
  if (stableStringify(actual) !== stableStringify(expected)) fail(`${label} differs`);
}

export function validatePayloadBindingSidecar(sidecar) {
  requireExactKeys(sidecar, [
    'aab', 'apk', 'archiveReader', 'criticalInputs', 'invocationContract', 'invocationId',
    'kind', 'limitation', 'material', 'recordedUtc', 'schemaVersion', 'sourceBuildId',
    'status', 'toolchain', 'transformManifest', 'unityReceipt',
  ], 'payload-binding sidecar');
  if (sidecar.schemaVersion !== 2 || sidecar.kind !== 'VANDE_UNITY_ANDROID_PAYLOAD_BINDING') {
    fail('payload-binding sidecar schema/kind is unsupported');
  }
  if (sidecar.status !== PAYLOAD_BINDING_STATUS) fail('payload-binding sidecar status is unsupported');
  if (sidecar.limitation !== LOCAL_PROVENANCE_LIMITATION) fail('payload-binding limitation disclosure differs');
  requireCanonicalIso(sidecar.recordedUtc, 'payload-binding recordedUtc');
  requireString(sidecar.invocationId, 'payload-binding invocationId', INVOCATION_ID_PATTERN);
  requireString(sidecar.sourceBuildId, 'payload-binding sourceBuildId', BUILD_ID_PATTERN);
  requireExactJson(sidecar.archiveReader, ARCHIVE_READER, 'payload-binding archiveReader');

  requireExactKeys(sidecar.invocationContract, [
    'bytes', 'createdUtc', 'entry', 'mode', 'pipeline', 'sha256',
  ], 'payload-binding invocationContract');
  if (sidecar.invocationContract.entry !== INPUT_ATTESTATION_ENTRY) {
    fail(`payload-binding invocation contract entry must equal ${INPUT_ATTESTATION_ENTRY}`);
  }
  if (!Number.isSafeInteger(sidecar.invocationContract.bytes) || sidecar.invocationContract.bytes < 1) {
    fail('payload-binding invocationContract.bytes is invalid');
  }
  requireString(sidecar.invocationContract.sha256, 'payload-binding invocationContract.sha256', SHA256_PATTERN);
  if (!['preview', 'release'].includes(sidecar.invocationContract.mode)) {
    fail('payload-binding invocationContract.mode is invalid');
  }
  requireCanonicalIso(sidecar.invocationContract.createdUtc, 'payload-binding invocationContract.createdUtc');
  requireExactKeys(
    sidecar.invocationContract.pipeline,
    ['capacitorSync', 'gradle', 'unityPreflight', 'webBuild'],
    'payload-binding invocationContract.pipeline',
  );
  validateStep(sidecar.invocationContract.pipeline.unityPreflight, 'payload-binding unityPreflight');
  validateStep(sidecar.invocationContract.pipeline.webBuild, 'payload-binding webBuild', { environment: true });
  validateStep(sidecar.invocationContract.pipeline.capacitorSync, 'payload-binding capacitorSync');
  validateStep(sidecar.invocationContract.pipeline.gradle, 'payload-binding gradle');

  requireExactKeys(sidecar.unityReceipt, [
    'exportFileCount', 'exportTreeSha256', 'sha256', 'sourceFileCount', 'sourceTreeSha256',
  ], 'payload-binding unityReceipt');
  for (const key of ['sourceFileCount', 'exportFileCount']) {
    if (!Number.isSafeInteger(sidecar.unityReceipt[key]) || sidecar.unityReceipt[key] < 1) {
      fail(`payload-binding unityReceipt.${key} is invalid`);
    }
  }
  for (const key of ['sha256', 'sourceTreeSha256', 'exportTreeSha256']) {
    requireString(sidecar.unityReceipt[key], `payload-binding unityReceipt.${key}`, SHA256_PATTERN);
  }

  requireExactKeys(
    sidecar.transformManifest,
    ['bytes', 'canonicalBase64', 'sha256', 'taskOutputs', 'trees'],
    'payload-binding transformManifest',
  );
  if (!Number.isSafeInteger(sidecar.transformManifest.bytes) || sidecar.transformManifest.bytes < 1) {
    fail('payload-binding transformManifest.bytes is invalid');
  }
  requireString(sidecar.transformManifest.sha256, 'payload-binding transformManifest.sha256', SHA256_PATTERN);
  requireString(sidecar.transformManifest.canonicalBase64, 'payload-binding transformManifest.canonicalBase64');
  let transformBytes;
  try {
    transformBytes = Buffer.from(sidecar.transformManifest.canonicalBase64, 'base64');
  } catch {
    fail('payload-binding transform manifest base64 is invalid');
  }
  if (transformBytes.toString('base64') !== sidecar.transformManifest.canonicalBase64
      || transformBytes.length !== sidecar.transformManifest.bytes
      || sha256Bytes(transformBytes) !== sidecar.transformManifest.sha256) {
    fail('payload-binding exact transform manifest bytes differ from its digest');
  }
  requireExactJson(sidecar.transformManifest.taskOutputs, TRANSFORM_TASK_OUTPUTS, 'payload-binding taskOutputs');
  requireExactKeys(
    sidecar.transformManifest.trees,
    ['assetAppSha256', 'nativeAppSha256', 'nativeModuleSha256'],
    'payload-binding transformManifest.trees',
  );
  for (const [key, value] of Object.entries(sidecar.transformManifest.trees)) {
    requireString(value, `payload-binding transformManifest.trees.${key}`, SHA256_PATTERN);
  }

  validateBoundArtifact(sidecar.apk, '.apk', 'apk', 'payload-binding apk');
  validateBoundArtifact(sidecar.aab, '.aab', 'aab', 'payload-binding aab');
  if (sidecar.apk.signerCertificateSha256 !== sidecar.aab.signerCertificateSha256) {
    fail('payload-binding APK/AAB signer digests differ');
  }

  requireExactKeys(sidecar.material, [
    'assetTreeSha256', 'assets', 'nativeAppTreeSha256', 'nativeModuleTreeSha256', 'natives',
  ], 'payload-binding material');
  for (const key of ['assetTreeSha256', 'nativeAppTreeSha256', 'nativeModuleTreeSha256']) {
    requireString(sidecar.material[key], `payload-binding material.${key}`, SHA256_PATTERN);
  }
  if (!Array.isArray(sidecar.material.assets) || sidecar.material.assets.length === 0) {
    fail('payload-binding material.assets must be non-empty');
  }
  for (const [index, record] of sidecar.material.assets.entries()) {
    requireExactKeys(
      record, ['app', 'module', 'path', 'receiptExportPath', 'receiptSha256'],
      `payload-binding material.assets[${index}]`,
    );
    requireSafeRelativePath(record.path, `payload-binding material.assets[${index}].path`);
    requireSafeRelativePath(record.receiptExportPath, `payload-binding material.assets[${index}].receiptExportPath`);
    requireString(record.receiptSha256, `payload-binding material.assets[${index}].receiptSha256`, SHA256_PATTERN);
    validateDigestRecord(record.module, `payload-binding material.assets[${index}].module`);
    validateDigestRecord(record.app, `payload-binding material.assets[${index}].app`);
  }
  if (!Array.isArray(sidecar.material.natives) || sidecar.material.natives.length === 0) {
    fail('payload-binding material.natives must be non-empty');
  }
  for (const [index, record] of sidecar.material.natives.entries()) {
    requireExactKeys(record, ['app', 'module', 'origin', 'path'], `payload-binding material.natives[${index}]`);
    requireSafeRelativePath(record.path, `payload-binding material.natives[${index}].path`);
    validateDigestRecord(record.module, `payload-binding material.natives[${index}].module`);
    validateDigestRecord(record.app, `payload-binding material.natives[${index}].app`);
    requireObject(record.origin, `payload-binding material.natives[${index}].origin`);
  }
  validateToolchain(sidecar.toolchain, 'payload-binding toolchain');
  validateCriticalInputList(sidecar.criticalInputs, 'payload-binding criticalInputs');
  return sidecar;
}

export function verifyExistingAndroidUnityPayloadBinding({
  root,
  sidecarPath,
  expectedSidecarPath,
  expectedSidecarSha256,
  apkPath,
  currentSourceBuildId,
  receiptPath,
  apksigner,
}) {
  root = canonicalDirectory(root, 'repository root');
  sidecarPath = canonicalPath(sidecarPath, 'payload-binding sidecar');
  expectedSidecarPath = canonicalPath(expectedSidecarPath, 'expected payload-binding sidecar');
  if (sidecarPath !== expectedSidecarPath) fail('payload-binding sidecar path differs from sealed expectation');
  requireString(expectedSidecarSha256, 'expected payload-binding sidecar SHA-256', SHA256_PATTERN);
  const sidecarSnapshot = snapshotRegularFile(sidecarPath, 'payload-binding sidecar');
  const sidecarBytes = sidecarSnapshot.bytes;
  if (sidecarSnapshot.sha256 !== expectedSidecarSha256) {
    fail('payload-binding sidecar SHA-256 differs from sealed expectation');
  }
  const sidecar = validatePayloadBindingSidecar(
    parseCanonicalJsonBytes(sidecarBytes, 'payload-binding sidecar'),
  );
  requireString(currentSourceBuildId, 'current sourceBuildId', BUILD_ID_PATTERN);
  if (sidecar.sourceBuildId !== currentSourceBuildId) fail('payload-binding sourceBuildId is stale');

  apkPath = canonicalPath(apkPath, 'signed APK');
  if (basename(apkPath) !== sidecar.apk.fileName) fail('signed APK filename differs from payload binding');
  const apkSnapshot = snapshotRegularFile(apkPath, 'signed APK');
  const apkBytes = apkSnapshot.size;
  if (apkBytes !== sidecar.apk.bytes || apkSnapshot.sha256 !== sidecar.apk.sha256) {
    fail('signed APK bytes/size differ from payload binding');
  }
  const apksignerSnapshot = snapshotRegularFile(apksigner, 'apksigner');
  let verifierScratch = mkdtempSync(join(tmpdir(), 'vande-unity-admission.'));
  verifierScratch = realpathSync(verifierScratch);
  let signature;
  try {
    const verifierApkPath = join(verifierScratch, 'candidate.apk');
    writeFileSync(verifierApkPath, apkSnapshot.bytes, { flag: 'wx', mode: 0o400 });
    signature = signerReport(
      apksignerSnapshot,
      snapshotRegularFile(verifierApkPath, 'immutable admission APK snapshot'),
    );
  } finally {
    rmSync(verifierScratch, { recursive: true, force: true });
  }
  if (signature.certificateSha256 !== sidecar.apk.signerCertificateSha256) {
    fail('signed APK signer certificate differs from payload binding');
  }
  requireExactJson(
    signature.verification,
    sidecar.apk.signatureVerification,
    'APK signature verification result',
  );

  const archive = openZipArchive(apkSnapshot.bytes, 'APK');
  const contractBytes = archive.extract(INPUT_ATTESTATION_ENTRY);
  const contract = validateInvocationContract(
    parseCanonicalJsonBytes(contractBytes, 'signed APK invocation contract'),
  );
  const contractSha256 = sha256Bytes(contractBytes);
  if (contractBytes.length !== sidecar.invocationContract.bytes
      || contractSha256 !== sidecar.invocationContract.sha256) {
    fail('signed APK invocation contract bytes differ from payload binding');
  }
  if (contract.invocationId !== sidecar.invocationId
      || contract.sourceBuildId !== sidecar.sourceBuildId
      || contract.sourceBuildId !== currentSourceBuildId
      || contract.mode !== sidecar.invocationContract.mode
      || contract.createdUtc !== sidecar.invocationContract.createdUtc) {
    fail('signed APK invocation identity differs from payload binding/current source');
  }
  requireExactJson(contract.pipeline, sidecar.invocationContract.pipeline, 'signed APK invocation pipeline');
  requireExactJson(contract.toolchain, sidecar.toolchain, 'signed APK toolchain');
  requireExactJson(contract.criticalInputs, sidecar.criticalInputs, 'signed APK critical inputs');
  requireExactJson(contract.archiveReader, sidecar.archiveReader, 'signed APK archive reader');
  requireExactJson(
    contract.verificationTools.apksigner,
    toolRecord(apksignerSnapshot),
    'signed APK apksigner identity',
  );
  requireExactJson(
    sidecar.apk.signatureVerification.tool,
    contract.verificationTools.apksigner,
    'payload-binding APK verifier identity',
  );
  requireExactJson(
    sidecar.aab.signatureVerification.strictJarsigner.tool,
    contract.verificationTools.jarsigner,
    'payload-binding AAB jarsigner identity',
  );
  requireExactJson(
    sidecar.aab.signatureVerification.signerCertificate.tool,
    contract.verificationTools.keytool,
    'payload-binding AAB keytool identity',
  );

  receiptPath = canonicalPath(receiptPath, 'current exhaustive Unity receipt');
  const expectedReceiptPath = resolve(
    root, 'unity/VandePractice/Builds/Android/.vande-export.properties',
  );
  if (receiptPath !== expectedReceiptPath || contract.receipt.path !== relative(root, receiptPath).split(sep).join('/')) {
    fail('current Unity receipt path differs from the invocation contract');
  }
  const receiptSnapshot = snapshotRegularFile(receiptPath, 'current exhaustive Unity receipt');
  const receiptBytes = receiptSnapshot.bytes;
  const receipt = parseUnityExportReceipt(receiptBytes);
  const receiptSha256 = sha256Bytes(receiptBytes);
  const expectedReceipt = {
    sha256: receiptSha256,
    sourceFileCount: receipt.sourceFileCount,
    sourceTreeSha256: receipt.sourceTreeSha256,
    exportFileCount: receipt.exportFileCount,
    exportTreeSha256: receipt.exportTreeSha256,
  };
  requireExactJson(sidecar.unityReceipt, expectedReceipt, 'current receipt sidecar identity');
  if (contract.receipt.sha256 !== receiptSha256
      || contract.receipt.editorVersion !== receipt.editorVersion
      || contract.receipt.sourceFileCount !== receipt.sourceFileCount
      || contract.receipt.sourceTreeSha256 !== receipt.sourceTreeSha256
      || contract.receipt.exportFileCount !== receipt.exportFileCount
      || contract.receipt.exportTreeSha256 !== receipt.exportTreeSha256) {
    fail('current exhaustive Unity receipt differs from signed APK invocation contract');
  }
  if (contract.toolchain.unityEditorVersion !== receipt.editorVersion) {
    fail('signed APK Unity toolchain version differs from current receipt');
  }

  const expectedCriticalPaths = [...ANDROID_UNITY_CRITICAL_INPUT_PATHS];
  const contractCriticalPaths = contract.criticalInputs.map((input) => input.path);
  if (stableStringify(contractCriticalPaths) !== stableStringify(expectedCriticalPaths)) {
    fail('signed APK invocation contract does not exhaustively name critical inputs');
  }
  const currentCriticalInputs = expectedCriticalPaths.map((path) => criticalInput(root, path));
  requireExactJson(contract.criticalInputs, currentCriticalInputs, 'current critical inputs');

  requireExactJson(
    sidecar.transformManifest.trees,
    {
      assetAppSha256: sidecar.material.assetTreeSha256,
      nativeModuleSha256: sidecar.material.nativeModuleTreeSha256,
      nativeAppSha256: sidecar.material.nativeAppTreeSha256,
    },
    'payload-binding transform/material trees',
  );
  const transformBytes = Buffer.from(sidecar.transformManifest.canonicalBase64, 'base64');
  const exactTransform = parseJsonBytes(transformBytes, 'exact payload-binding transform manifest');
  const nativeProvenanceBytes = archive.extract(NATIVE_PROVENANCE_ENTRY);
  requireExactJson(exactTransform.assets, sidecar.material.assets, 'exact transform assets');
  requireExactJson(exactTransform.natives, sidecar.material.natives, 'exact transform natives');
  requireExactJson(exactTransform.trees, sidecar.transformManifest.trees, 'exact transform trees');
  requireExactJson(exactTransform.taskOutputs, sidecar.transformManifest.taskOutputs, 'exact transform task outputs');
  const materialTrees = validateTransformManifest(
    exactTransform, receipt, contract, contractSha256, nativeProvenanceBytes,
  );
  const apkPayload = verifyArchivePayload({
    label: 'APK', archiveBytes: apkSnapshot.bytes, contractBytes, nativeProvenanceBytes,
    transform: exactTransform,
    prefixes: {
      attestation: INPUT_ATTESTATION_ENTRY, nativeProvenance: NATIVE_PROVENANCE_ENTRY,
      asset: 'assets/', native: 'lib/',
    },
  });
  if (apkPayload.assets.sha256 !== materialTrees.assetTree.sha256
      || apkPayload.natives.sha256 !== materialTrees.nativeTree.sha256
      || sidecar.apk.assetTreeSha256 !== materialTrees.assetTree.sha256
      || sidecar.apk.nativeTreeSha256 !== materialTrees.nativeTree.sha256
      || sidecar.aab.assetTreeSha256 !== materialTrees.assetTree.sha256
      || sidecar.aab.nativeTreeSha256 !== materialTrees.nativeTree.sha256) {
    fail('re-derived APK material trees differ from payload binding');
  }

  assertSnapshotUnchanged(apkSnapshot, 'signed APK final admission identity');
  assertSnapshotUnchanged(sidecarSnapshot, 'payload-binding sidecar final admission identity');
  assertSnapshotUnchanged(receiptSnapshot, 'Unity receipt final admission identity');
  assertSnapshotUnchanged(apksignerSnapshot, 'apksigner final admission identity');
  return {
    schemaVersion: 1,
    kind: 'VANDE_UNITY_ANDROID_PAYLOAD_BINDING_ADMISSION',
    status: 'RE_DERIVED_LOCAL_INTEGRITY_NOT_CERTIFICATION',
    limitation: LOCAL_PROVENANCE_LIMITATION,
    invocationId: contract.invocationId,
    sourceBuildId: currentSourceBuildId,
    sidecar: { path: sidecarPath, bytes: sidecarBytes.length, sha256: expectedSidecarSha256 },
    apk: {
      path: apkPath,
      fileName: basename(apkPath),
      bytes: apkBytes,
      sha256: sidecar.apk.sha256,
      signerCertificateSha256: signature.certificateSha256,
    },
    receipt: expectedReceipt,
    trees: {
      assetsSha256: materialTrees.assetTree.sha256,
      nativeModuleSha256: materialTrees.moduleNativeTree.sha256,
      nativeAppSha256: materialTrees.nativeTree.sha256,
    },
  };
}

export function parseCli(argv) {
  const action = argv[0];
  if (!['create-invocation', 'bind'].includes(action)) fail('first argument must be create-invocation or bind');
  const repeatable = new Set([
    '--preflight-arg', '--web-arg', '--web-env', '--sync-arg', '--gradle-arg',
  ]);
  const allowed = action === 'create-invocation'
    ? new Set([
      '--root', '--invocation-id', '--source-build-id', '--mode', '--receipt', '--output',
      '--preflight-arg', '--web-arg', '--web-env', '--sync-arg', '--gradle-arg',
      '--java-home', '--android-home', '--gradle-user-home', '--apksigner', '--jarsigner', '--keytool',
    ])
    : new Set([
      '--apk', '--aab', '--contract', '--transform-manifest', '--receipt', '--source-build-id',
      '--apksigner', '--jarsigner', '--keytool', '--output',
    ]);
  const values = new Map();
  for (let index = 1; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name)) fail(`unknown ${action} option ${name ?? '<missing>'}`);
    if (value === undefined) fail(`${name} requires a value`);
    if (repeatable.has(name)) {
      const list = values.get(name) ?? [];
      list.push(value);
      values.set(name, list);
    } else {
      if (values.has(name)) fail(`duplicate option ${name}`);
      values.set(name, value);
    }
  }
  return { action, values };
}

function requireOption(values, name) {
  const value = values.get(name);
  if (typeof value !== 'string' || value.length === 0) fail(`missing ${name}`);
  return value;
}

function repeated(values, name) {
  const value = values.get(name);
  if (!Array.isArray(value) || value.length === 0) fail(`missing ${name}`);
  return value;
}

function writeNewJson(path, value) {
  path = canonicalPath(path, 'output', { mustExist: false });
  if (existsSync(path)) fail(`output already exists: ${path}`);
  writeFileSync(path, canonicalJsonBytes(value), { flag: 'wx', mode: 0o600 });
}

function cliCreate(values) {
  const root = resolve(values.get('--root') ?? DEFAULT_ROOT);
  const webEnvironment = {};
  for (const assignment of repeated(values, '--web-env')) {
    const separator = assignment.indexOf('=');
    if (separator < 1) fail(`invalid --web-env ${assignment}`);
    const key = assignment.slice(0, separator);
    if (Object.hasOwn(webEnvironment, key)) fail(`duplicate --web-env ${key}`);
    webEnvironment[key] = assignment.slice(separator + 1);
  }
  const contract = createInvocationContract({
    root,
    invocationId: requireOption(values, '--invocation-id'),
    sourceBuildId: requireOption(values, '--source-build-id'),
    mode: requireOption(values, '--mode'),
    receiptPath: requireOption(values, '--receipt'),
    preflightArgs: repeated(values, '--preflight-arg'),
    webArgs: repeated(values, '--web-arg'),
    webEnvironment,
    syncArgs: repeated(values, '--sync-arg'),
    gradleArgs: repeated(values, '--gradle-arg'),
    javaHome: requireOption(values, '--java-home'),
    androidHome: requireOption(values, '--android-home'),
    gradleUserHome: requireOption(values, '--gradle-user-home'),
    apksigner: requireOption(values, '--apksigner'),
    jarsigner: requireOption(values, '--jarsigner'),
    keytool: requireOption(values, '--keytool'),
  });
  writeNewJson(requireOption(values, '--output'), contract);
  process.stdout.write(`UNITY_INVOCATION_CONTRACT_OK ${contract.invocationId} ${sha256Bytes(canonicalJsonBytes(contract))}\n`);
}

function cliBind(values) {
  const apkPath = canonicalPath(requireOption(values, '--apk'), 'APK');
  const aabPath = canonicalPath(requireOption(values, '--aab'), 'AAB');
  const contractPath = canonicalPath(requireOption(values, '--contract'), 'invocation contract');
  const transformPath = canonicalPath(requireOption(values, '--transform-manifest'), 'transform manifest');
  const receiptPath = canonicalPath(requireOption(values, '--receipt'), 'Unity receipt');
  const apksigner = canonicalPath(requireOption(values, '--apksigner'), 'apksigner');
  const keytool = canonicalPath(requireOption(values, '--keytool'), 'keytool');
  const binding = buildPayloadBinding({
    apkPath,
    aabPath,
    contractPath,
    transformPath,
    receiptPath,
    sourceBuildId: requireOption(values, '--source-build-id'),
    apksigner,
    jarsigner: canonicalPath(requireOption(values, '--jarsigner'), 'jarsigner'),
    keytool,
  });
  // Validate the exact canonical bytes again before the exclusive write. A
  // producer bug or post-build object mutation cannot create an unchecked
  // sidecar.
  const canonical = canonicalJsonBytes(binding);
  validatePayloadBindingSidecar(parseCanonicalJsonBytes(canonical, 'new payload-binding sidecar'));
  writeNewJson(requireOption(values, '--output'), binding);
  process.stdout.write(`UNITY_PAYLOAD_BINDING_OK ${binding.apk.sha256} ${binding.invocationId}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { action, values } = parseCli(process.argv.slice(2));
    if (action === 'create-invocation') cliCreate(values);
    else cliBind(values);
  } catch (error) {
    process.stderr.write(`UNITY_PAYLOAD_BINDING_REJECTED ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
