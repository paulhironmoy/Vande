#!/usr/bin/env node

/**
 * Static Android release compatibility preflight.
 *
 * This catches artifact regressions that would obviously narrow installability:
 * an elevated SDK floor, required hardware/graphics/native-library filters,
 * lost ARM ABIs, restricted screen support, or native libraries that are not
 * 16 KB-page safe.
 * It never claims India-weighted working reach; that requires current market
 * weights, Play-generated splits and representative physical-device evidence.
 */

import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readSync,
  rmSync,
  statSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PACKAGE = 'in.vande.cricket';
export const DEFAULT_MAX_MIN_SDK = 28;
export const DEFAULT_REQUIRED_ABIS = Object.freeze(['arm64-v8a', 'armeabi-v7a']);
export const MIN_16_KB_ALIGNMENT = 0x4000;

const DEFAULT_APK = 'android/app/build/outputs/apk/release/app-release.apk';
const DEFAULT_AAB = 'android/app/build/outputs/bundle/release/app-release.aab';
const ALLOWED_REQUIRED_FEATURES = new Set(['android.hardware.faketouch']);
const REQUIRED_SCREEN_BUCKETS = Object.freeze(['small', 'normal', 'large', 'xlarge']);

/**
 * Optional camera batting. aapt2 turns the CAMERA permission alone into a required back-camera feature (and Android's
 * documentation says it implies a required autofocus), which would hide the app from phones without one. So when the
 * permission is declared, all three camera features must be declared and not required. Nothing records sound: RECORD_AUDIO
 * would add a required microphone feature and is refused outright.
 */
export const CAMERA_PERMISSION = 'android.permission.CAMERA';
export const CAMERA_FEATURES = Object.freeze([
  'android.hardware.camera',
  'android.hardware.camera.front',
  'android.hardware.camera.autofocus',
]);
export const FORBIDDEN_CAPTURE_PERMISSIONS = Object.freeze(['android.permission.RECORD_AUDIO']);

/**
 * Optional payloads that only the owner's sideload "everything" build may carry (docs/ANDROID_RELEASE.md, scripts/build-android.sh
 * --everything): the camera pack (pose engine, worker and model, downloaded on demand in a store build) and the baked venue's GLB
 * files. They live in the web payload under assets/public (APK) or base/assets/public (AAB). A default build must carry none, so
 * the first-ball install stays free of them.
 */
export const OPTIONAL_PAYLOADS = Object.freeze({
  camera: /^(?:base\/)?assets\/public\/(?:.*\/)?(?:models\/pose\/|vision_wasm[^/]*$|[^/]+\.task$)/u,
  venue: /^(?:base\/)?assets\/public\/(?:.*\/)?[^/]+\.glb$/u,
});

/** The entries of an archive that belong to each optional payload (empty arrays for a default build). */
export function findOptionalPayloads(entries) {
  return Object.fromEntries(Object.entries(OPTIONAL_PAYLOADS).map(([name, pattern]) => [
    name,
    entries.filter((entry) => pattern.test(entry)),
  ]));
}

function usage() {
  return `Usage: node scripts/check-android-release-compat.mjs [options]

Options:
  --apk PATH              release APK (default: ${DEFAULT_APK})
  --aab PATH              release AAB (default: ${DEFAULT_AAB})
  --package ID            expected application id (default: ${DEFAULT_PACKAGE})
  --max-min-sdk NUMBER    highest permitted minSdk (default: ${DEFAULT_MAX_MIN_SDK})
  --require-abi ABI       required ABI; repeatable (defaults: ${DEFAULT_REQUIRED_ABIS.join(', ')})
  --aapt2 PATH            Android aapt2 executable
  --zipalign PATH         Android zipalign executable
  --unzip PATH            unzip executable (default: unzip on PATH)
  --allow-camera-payload  the artifact may carry the camera pack (only the sideload --everything build passes this)
  --allow-venue-payload   the artifact may carry the baked venue GLB files (only the sideload --everything build passes this)
  --json                  emit machine-readable JSON
  --help                  show this help

A passing result is only a static preflight. REACH-90, SIZE-50 and 16 KB runtime
compatibility remain UNPROVEN until the evidence in docs/ANDROID_SIZE_AND_REACH.md exists.`;
}

function positiveInteger(value, option) {
  if (!/^[1-9][0-9]*$/u.test(value)) throw new Error(`${option} must be a positive integer, received '${value}'`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${option} is outside the safe integer range`);
  return parsed;
}

export function parseArgs(argv) {
  const options = {
    apk: DEFAULT_APK,
    aab: DEFAULT_AAB,
    packageId: DEFAULT_PACKAGE,
    maxMinSdk: DEFAULT_MAX_MIN_SDK,
    requiredAbis: [],
    aapt2: undefined,
    zipalign: undefined,
    unzip: 'unzip',
    allowCameraPayload: false,
    allowVenuePayload: false,
    json: false,
    help: false,
  };
  let customAbis = false;
  const valueOptions = new Set([
    '--apk', '--aab', '--package', '--max-min-sdk', '--require-abi', '--aapt2', '--zipalign', '--unzip',
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (valueOptions.has(argument)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === '--apk') options.apk = value;
      else if (argument === '--aab') options.aab = value;
      else if (argument === '--package') options.packageId = value;
      else if (argument === '--max-min-sdk') options.maxMinSdk = positiveInteger(value, argument);
      else if (argument === '--require-abi') {
        if (!customAbis) {
          options.requiredAbis = [];
          customAbis = true;
        }
        options.requiredAbis.push(value);
      } else if (argument === '--aapt2') options.aapt2 = value;
      else if (argument === '--zipalign') options.zipalign = value;
      else options.unzip = value;
      continue;
    }
    if (argument === '--json') options.json = true;
    else if (argument === '--allow-camera-payload') options.allowCameraPayload = true;
    else if (argument === '--allow-venue-payload') options.allowVenuePayload = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`unknown option '${argument}'`);
  }

  if (!customAbis) options.requiredAbis = [...DEFAULT_REQUIRED_ABIS];
  if (!/^[A-Za-z][A-Za-z0-9_.]*$/u.test(options.packageId)) {
    throw new Error(`invalid Android package id '${options.packageId}'`);
  }
  if (options.requiredAbis.length === 0) throw new Error('at least one --require-abi value is required');
  for (const abi of options.requiredAbis) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(abi)) throw new Error(`invalid ABI '${abi}'`);
  }
  options.requiredAbis = [...new Set(options.requiredAbis)];
  return options;
}

function quotedValues(line) {
  return [...line.matchAll(/'([^']*)'/gu)].map((match) => match[1]);
}

export function parseBadging(stdout) {
  const result = {
    packageId: null,
    minSdk: null,
    maxSdk: null,
    targetSdk: null,
    permissions: [],
    requiredFeatures: [],
    impliedFeatures: [],
    optionalFeatures: [],
    glRequirements: [],
    textureRequirements: [],
    screenBuckets: [],
    compatibleScreens: [],
    anyDensity: null,
    nativeCode: [],
    requiredSharedLibraries: [],
    requiredNativeLibraries: [],
    optionalNativeLibraries: [],
    launchableActivities: [],
    launchableActivity: null,
    debuggable: false,
  };

  for (const rawLine of stdout.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.startsWith('package:')) result.packageId = line.match(/\bname='([^']+)'/u)?.[1] ?? null;
    else if (line.startsWith('uses-permission:') || line.startsWith('uses-permission-sdk-23:')) {
      const name = line.match(/\bname='([^']+)'/u)?.[1];
      if (name) result.permissions.push(name);
    } else if (line.startsWith('minSdkVersion:')) result.minSdk = Number(quotedValues(line)[0]);
    else if (line.startsWith('maxSdkVersion:')) result.maxSdk = Number(quotedValues(line)[0]);
    else if (line.startsWith('targetSdkVersion:')) result.targetSdk = Number(quotedValues(line)[0]);
    else if (line.startsWith('uses-feature:')) {
      const name = line.match(/\bname='([^']+)'/u)?.[1];
      if (name) result.requiredFeatures.push(name);
    } else if (line.startsWith('uses-implied-feature:')) {
      const name = line.match(/\bname='([^']+)'/u)?.[1];
      if (name) result.impliedFeatures.push(name);
    } else if (line.startsWith('uses-feature-not-required:')) {
      const name = line.match(/\bname='([^']+)'/u)?.[1];
      if (name) result.optionalFeatures.push(name);
    } else if (line.startsWith('uses-feature-gl-es:') || line.startsWith('uses-gl-es:')) {
      result.glRequirements.push(...quotedValues(line));
    } else if (line.startsWith('supports-gl-texture:')) {
      result.textureRequirements.push(...quotedValues(line));
    } else if (line.startsWith('supports-screens:')) {
      result.screenBuckets.push(...quotedValues(line));
    } else if (line.startsWith('compatible-screens:')) {
      result.compatibleScreens.push(...quotedValues(line));
    } else if (line.startsWith('supports-any-density:')) {
      result.anyDensity = quotedValues(line)[0] ?? null;
    } else if (line.startsWith('native-code:')) {
      result.nativeCode.push(...quotedValues(line));
    } else if (line.startsWith('uses-library:') || line.startsWith('uses-static-library:')) {
      result.requiredSharedLibraries.push(...quotedValues(line).slice(0, 1));
    } else if (line.startsWith('uses-native-library-not-required:')) {
      result.optionalNativeLibraries.push(...quotedValues(line).slice(0, 1));
    } else if (line.startsWith('uses-native-library:')) {
      result.requiredNativeLibraries.push(...quotedValues(line).slice(0, 1));
    } else if (line.startsWith('launchable-activity:')) {
      const name = line.match(/\bname='([^']+)'/u)?.[1];
      if (name) result.launchableActivities.push(name);
    } else if (line === 'application-debuggable') {
      result.debuggable = true;
    }
  }

  for (const key of ['permissions', 'requiredFeatures', 'impliedFeatures', 'optionalFeatures', 'glRequirements',
    'textureRequirements', 'screenBuckets', 'compatibleScreens', 'nativeCode', 'requiredSharedLibraries',
    'requiredNativeLibraries', 'optionalNativeLibraries', 'launchableActivities']) {
    result[key] = [...new Set(result[key])];
  }
  result.launchableActivity = result.launchableActivities[0] ?? null;
  return result;
}

function makeCheck(id, pass, expected, observed) {
  return { id, pass, expected, observed };
}

export function evaluateBadging(badging, policy = {}) {
  const packageId = policy.packageId ?? DEFAULT_PACKAGE;
  const maxMinSdk = policy.maxMinSdk ?? DEFAULT_MAX_MIN_SDK;
  const unexpectedFeatures = [...new Set([...badging.requiredFeatures, ...badging.impliedFeatures])]
    .filter((feature) => !ALLOWED_REQUIRED_FEATURES.has(feature));
  const missingScreens = REQUIRED_SCREEN_BUCKETS.filter((bucket) => !badging.screenBuckets.includes(bucket));
  const sdkValuesValid = Number.isInteger(badging.minSdk) && Number.isInteger(badging.targetSdk);
  const expectedLauncher = `${packageId}.MainActivity`;
  const declaresCamera = badging.permissions.includes(CAMERA_PERMISSION);
  const cameraFeaturesNotOptional = declaresCamera
    ? CAMERA_FEATURES.filter((feature) => !badging.optionalFeatures.includes(feature))
    : [];
  const forbiddenCapture = badging.permissions.filter((permission) => FORBIDDEN_CAPTURE_PERMISSIONS.includes(permission));

  const checks = [
    makeCheck('package-id', badging.packageId === packageId, packageId, badging.packageId ?? 'missing'),
    makeCheck('min-sdk', Number.isInteger(badging.minSdk) && badging.minSdk <= maxMinSdk,
      `integer <= ${maxMinSdk}`, badging.minSdk ?? 'missing'),
    makeCheck('max-sdk', badging.maxSdk === null, 'not declared', badging.maxSdk ?? 'not declared'),
    makeCheck('target-sdk', sdkValuesValid && badging.targetSdk >= badging.minSdk,
      'integer >= minSdk', badging.targetSdk ?? 'missing'),
    makeCheck('required-hardware-features', unexpectedFeatures.length === 0,
      'none except Android-implied faketouch', unexpectedFeatures.length ? unexpectedFeatures : 'none'),
    makeCheck('required-gl-version', badging.glRequirements.length === 0,
      'no manifest install filter', badging.glRequirements.length ? badging.glRequirements : 'none'),
    makeCheck('required-texture-format', badging.textureRequirements.length === 0,
      'no manifest install filter', badging.textureRequirements.length ? badging.textureRequirements : 'none'),
    makeCheck('screen-buckets', missingScreens.length === 0,
      REQUIRED_SCREEN_BUCKETS, missingScreens.length ? { missing: missingScreens } : badging.screenBuckets),
    makeCheck('compatible-screen-filter', badging.compatibleScreens.length === 0,
      'not declared', badging.compatibleScreens.length ? badging.compatibleScreens : 'not declared'),
    makeCheck('any-density', badging.anyDensity === 'true', 'true', badging.anyDensity ?? 'missing'),
    makeCheck('required-shared-libraries', badging.requiredSharedLibraries.length === 0,
      'none', badging.requiredSharedLibraries.length ? badging.requiredSharedLibraries : 'none'),
    makeCheck('required-native-libraries', badging.requiredNativeLibraries.length === 0,
      'none; native libraries must be explicitly not required',
      badging.requiredNativeLibraries.length ? badging.requiredNativeLibraries : 'none'),
    makeCheck('launchable-activity', badging.launchableActivities.length === 1 &&
      badging.launchableActivities[0] === expectedLauncher,
    `exactly one: ${expectedLauncher}`,
    badging.launchableActivities.length ? badging.launchableActivities : 'missing'),
    makeCheck('not-debuggable', !badging.debuggable, false, badging.debuggable),
    makeCheck('camera-permission-shape', cameraFeaturesNotOptional.length === 0 && forbiddenCapture.length === 0,
      'CAMERA only with camera, camera.front and camera.autofocus declared not required; no RECORD_AUDIO',
      cameraFeaturesNotOptional.length === 0 && forbiddenCapture.length === 0
        ? (declaresCamera ? 'CAMERA declared; the three camera features are not required' : 'no CAMERA permission')
        : { cameraFeaturesNotDeclaredOptional: cameraFeaturesNotOptional, forbiddenPermissions: forbiddenCapture }),
  ];
  return { pass: checks.every((check) => check.pass), checks };
}

function runTool(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw new Error(`could not run ${command}: ${result.error.message}`);
  return result;
}

function sdkRoots() {
  return [...new Set([
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    join(homedir(), 'Library', 'Android', 'sdk'),
  ].filter(Boolean).map((candidate) => resolve(candidate)))];
}

export function discoverBuildTool(name) {
  for (const sdkRoot of sdkRoots()) {
    const root = join(sdkRoot, 'build-tools');
    if (!existsSync(root)) continue;
    const versions = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
    for (const version of versions) {
      const candidate = join(root, version, name);
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
  }
  return name;
}

function assertArtifact(path, label) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) throw new Error(`${label} does not exist: ${absolute}`);
  if (!statSync(absolute).isFile()) throw new Error(`${label} is not a regular file: ${absolute}`);
  return absolute;
}

export function parseArchiveEntries(stdout) {
  const entries = stdout.split(/\r?\n/u).filter(Boolean);
  if (entries.length === 0) throw new Error('archive contains no entries');
  const seen = new Set();
  for (const entry of entries) {
    // eslint-disable-next-line no-control-regex -- the control characters are exactly what this check rejects or strips
    if (/^[/-]/u.test(entry) || entry.includes('\\') || entry.split('/').includes('..') || /[\u0000-\u001f\u007f]/u.test(entry)) {
      throw new Error(`archive contains an unsafe entry name: ${JSON.stringify(entry)}`);
    }
    if (seen.has(entry)) throw new Error(`archive contains a duplicate entry: ${entry}`);
    seen.add(entry);
  }
  return entries;
}

export function nativeEntries(entries) {
  return entries.flatMap((entry) => {
    const match = entry.match(/(?:^|\/)lib\/([^/]+)\/([^/]+\.so)$/u);
    return match ? [{ entry, abi: match[1], library: match[2] }] : [];
  });
}

function readUnsigned(buffer, offset, bytes, littleEndian) {
  if (offset < 0 || offset + bytes > buffer.length) throw new Error('ELF field lies outside the available data');
  if (bytes === 2) return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
  if (bytes === 4) return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
  if (bytes === 8) {
    const value = littleEndian ? buffer.readBigUInt64LE(offset) : buffer.readBigUInt64BE(offset);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('ELF offset is outside the safe integer range');
    return Number(value);
  }
  throw new Error(`unsupported ELF integer width ${bytes}`);
}

function parseElfHeader(header) {
  if (header.length < 52 || header[0] !== 0x7f || header.toString('ascii', 1, 4) !== 'ELF') {
    throw new Error('native archive entry is not an ELF file');
  }
  const elfClass = header[4];
  const data = header[5];
  if (elfClass !== 1 && elfClass !== 2) throw new Error(`unsupported ELF class ${elfClass}`);
  if (data !== 1 && data !== 2) throw new Error(`unsupported ELF byte order ${data}`);
  const littleEndian = data === 1;
  const is64 = elfClass === 2;
  const minimumHeader = is64 ? 64 : 52;
  if (header.length < minimumHeader) throw new Error(`truncated ELF${is64 ? '64' : '32'} header`);
  const programOffset = readUnsigned(header, is64 ? 32 : 28, is64 ? 8 : 4, littleEndian);
  const programEntrySize = readUnsigned(header, is64 ? 54 : 42, 2, littleEndian);
  const programCount = readUnsigned(header, is64 ? 56 : 44, 2, littleEndian);
  const minimumEntrySize = is64 ? 56 : 32;
  if (programCount === 0 || programCount === 0xffff) throw new Error('ELF has no directly inspectable program-header table');
  if (programEntrySize < minimumEntrySize) throw new Error(`ELF program-header entries are too short: ${programEntrySize}`);
  const tableBytes = programEntrySize * programCount;
  if (!Number.isSafeInteger(tableBytes) || tableBytes > 16 * 1024 * 1024) {
    throw new Error(`ELF program-header table is unreasonably large: ${tableBytes} bytes`);
  }
  return { is64, littleEndian, programOffset, programEntrySize, programCount, tableBytes };
}

function loadAlignmentsFromTable(table, header) {
  if (table.length < header.tableBytes) throw new Error('truncated ELF program-header table');
  const alignments = [];
  for (let index = 0; index < header.programCount; index += 1) {
    const offset = index * header.programEntrySize;
    const type = readUnsigned(table, offset, 4, header.littleEndian);
    if (type !== 1) continue;
    alignments.push(readUnsigned(table, offset + (header.is64 ? 48 : 28), header.is64 ? 8 : 4, header.littleEndian));
  }
  if (alignments.length === 0) throw new Error('ELF has no PT_LOAD segments');
  return alignments;
}

export function parseElfLoadAlignments(buffer) {
  const header = parseElfHeader(buffer.subarray(0, Math.min(buffer.length, 64)));
  const end = header.programOffset + header.tableBytes;
  if (!Number.isSafeInteger(end) || end > buffer.length) throw new Error('truncated ELF program-header table');
  return loadAlignmentsFromTable(buffer.subarray(header.programOffset, end), header);
}

function inspectElfFile(path) {
  const descriptor = openSync(path, 'r');
  try {
    const fileSize = statSync(path).size;
    const first = Buffer.alloc(Math.min(64, fileSize));
    const headerBytes = readSync(descriptor, first, 0, first.length, 0);
    const header = parseElfHeader(first.subarray(0, headerBytes));
    const end = header.programOffset + header.tableBytes;
    if (!Number.isSafeInteger(end) || end > fileSize) throw new Error('truncated ELF program-header table');
    const table = Buffer.alloc(header.tableBytes);
    const tableBytes = readSync(descriptor, table, 0, table.length, header.programOffset);
    if (tableBytes !== table.length) throw new Error('could not read the complete ELF program-header table');
    return loadAlignmentsFromTable(table, header);
  } finally {
    closeSync(descriptor);
  }
}

function listArchive(unzip, archive) {
  const result = runTool(unzip, ['-Z1', archive]);
  if (result.status !== 0) {
    throw new Error(`could not list ${archive}: ${(result.stderr || result.stdout || '').trim() || `exit ${result.status}`}`);
  }
  return parseArchiveEntries(result.stdout);
}

function extractEntry(unzip, archive, entry, destination) {
  const descriptor = openSync(destination, 'wx');
  let result;
  try {
    result = runTool(unzip, ['-p', archive, entry], {
      encoding: undefined,
      stdio: ['ignore', descriptor, 'pipe'],
    });
  } finally {
    closeSync(descriptor);
  }
  if (result.status !== 0) {
    const detail = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : result.stderr;
    throw new Error(`could not extract ${entry}: ${(detail || '').trim() || `exit ${result.status}`}`);
  }
}

function archiveAbiChecks(label, natives, requiredAbis) {
  if (natives.length === 0) {
    return [makeCheck(`${label}-abi-coverage`, true, requiredAbis, 'no native code; ABI-unrestricted')];
  }
  const present = [...new Set(natives.map((entry) => entry.abi))].sort();
  const missing = requiredAbis.filter((abi) => !present.includes(abi));
  return [makeCheck(`${label}-abi-coverage`, missing.length === 0, requiredAbis,
    missing.length ? { present, missing } : present)];
}

function partialLibraryCoverage(natives, requiredAbis) {
  const byLibrary = new Map();
  for (const item of natives) {
    const abis = byLibrary.get(item.library) ?? new Set();
    abis.add(item.abi);
    byLibrary.set(item.library, abis);
  }
  return [...byLibrary.entries()].flatMap(([library, abis]) => {
    const presentRequired = requiredAbis.filter((abi) => abis.has(abi));
    return presentRequired.length > 0 && presentRequired.length < requiredAbis.length
      ? [{ library, present: [...abis].sort(), missing: requiredAbis.filter((abi) => !abis.has(abi)) }]
      : [];
  });
}

export function nativeCodeConsistency(badgingNativeCode, archiveAbis) {
  const badging = [...new Set(badgingNativeCode)].sort();
  const archive = [...new Set(archiveAbis)].sort();
  const onlyBadging = badging.filter((abi) => !archive.includes(abi));
  const onlyArchive = archive.filter((abi) => !badging.includes(abi));
  return makeCheck('apk-badging-native-consistency', onlyBadging.length === 0 && onlyArchive.length === 0,
    'aapt2 native-code matches packaged lib ABIs', { onlyBadging, onlyArchive });
}

/** One check per optional payload: a default build carries none; the sideload build may, when it says so. */
export function payloadChecks(label, entries, allowed = {}) {
  const found = findOptionalPayloads(entries);
  return Object.entries(found).map(([name, matches]) => {
    const permitted = Boolean(allowed[name]);
    const observed = matches.length === 0
      ? 'none'
      : `${matches.length} file${matches.length === 1 ? '' : 's'}${permitted ? ' (allowed: sideload build)' : ''}: ${matches.slice(0, 3).join(', ')}${matches.length > 3 ? ', ...' : ''}`;
    return makeCheck(`${label}-${name}-payload`, matches.length === 0 || permitted,
      permitted ? `${name} payload allowed for this sideload build` : `no ${name} payload in a default build`, observed);
  });
}

function inspectArchive(label, archive, unzip, requiredAbis, allowedPayloads = {}) {
  const entries = listArchive(unzip, archive);
  const natives = nativeEntries(entries);
  const scratch = mkdtempSync(join(tmpdir(), 'vande-android-compat-'));
  const libraries = [];
  try {
    for (let index = 0; index < natives.length; index += 1) {
      const item = natives[index];
      const destination = join(scratch, `${String(index).padStart(5, '0')}.so`);
      extractEntry(unzip, archive, item.entry, destination);
      const alignments = inspectElfFile(destination);
      libraries.push({
        ...item,
        loadAlignments: alignments,
        pass: alignments.every((alignment) => alignment >= MIN_16_KB_ALIGNMENT),
      });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const abiChecks = archiveAbiChecks(label, natives, requiredAbis);
  const alignmentCheck = makeCheck(`${label}-elf-16kb`, libraries.every((library) => library.pass),
    `every PT_LOAD p_align >= 0x${MIN_16_KB_ALIGNMENT.toString(16)}`,
    libraries.length === 0 ? 'no native code' : `${libraries.filter((library) => library.pass).length}/${libraries.length} libraries`);
  return {
    label,
    path: archive,
    entryCount: entries.length,
    nativeLibraryCount: natives.length,
    abis: [...new Set(natives.map((item) => item.abi))].sort(),
    partialLibraryCoverage: partialLibraryCoverage(natives, requiredAbis),
    libraries,
    checks: [...abiChecks, alignmentCheck, ...payloadChecks(label, entries, allowedPayloads)],
  };
}

function badgingFor(aapt2, apk) {
  const result = runTool(aapt2, ['dump', 'badging', apk]);
  if (result.status !== 0) {
    throw new Error(`aapt2 could not inspect ${apk}: ${(result.stderr || result.stdout || '').trim() || `exit ${result.status}`}`);
  }
  return parseBadging(result.stdout);
}

function zipAlignmentFor(zipalign, apk) {
  const result = runTool(zipalign, ['-c', '-P', '16', '-v', '4', apk]);
  const detail = (result.stderr || result.stdout || '').trim();
  return makeCheck('apk-zipalign-16kb', result.status === 0,
    'zipalign -c -P 16 -v 4 exits 0', result.status === 0 ? 'pass' : (detail || `exit ${result.status}`));
}

export function summarizeChecks(report) {
  return [
    ...report.manifest.checks,
    report.zipAlignment,
    ...report.archives.flatMap((archive) => archive.checks),
    report.badgingNativeConsistency,
    report.archiveConsistency,
  ];
}

export function run(argv) {
  const options = parseArgs(argv);
  if (options.help) return { help: true, exitCode: 0 };
  const apk = assertArtifact(options.apk, 'APK');
  const aab = assertArtifact(options.aab, 'AAB');
  const aapt2 = options.aapt2 ?? discoverBuildTool('aapt2');
  const zipalign = options.zipalign ?? discoverBuildTool('zipalign');
  const badging = badgingFor(aapt2, apk);
  const manifestEvaluation = evaluateBadging(badging, options);
  const allowedPayloads = { camera: options.allowCameraPayload, venue: options.allowVenuePayload };
  const archives = [
    inspectArchive('apk', apk, options.unzip, options.requiredAbis, allowedPayloads),
    inspectArchive('aab', aab, options.unzip, options.requiredAbis, allowedPayloads),
  ];
  const apkNativeShape = new Set(archives[0].libraries.map((item) => `${item.abi}/${item.library}`));
  const aabNativeShape = new Set(archives[1].libraries.map((item) => `${item.abi}/${item.library}`));
  const onlyApk = [...apkNativeShape].filter((entry) => !aabNativeShape.has(entry));
  const onlyAab = [...aabNativeShape].filter((entry) => !apkNativeShape.has(entry));
  const report = {
    schema: 1,
    policy: {
      packageId: options.packageId,
      maxMinSdk: options.maxMinSdk,
      requiredAbis: options.requiredAbis,
      allowedRequiredFeatures: [...ALLOWED_REQUIRED_FEATURES],
      allowedOptionalPayloads: Object.entries(allowedPayloads).filter(([, allowed]) => allowed).map(([name]) => name),
      minimumElfLoadAlignment: MIN_16_KB_ALIGNMENT,
    },
    tools: { aapt2, zipalign, unzip: options.unzip },
    artifacts: { apk, aab },
    manifest: { ...badging, ...manifestEvaluation },
    zipAlignment: zipAlignmentFor(zipalign, apk),
    archives,
    badgingNativeConsistency: nativeCodeConsistency(badging.nativeCode, archives[0].abis),
    archiveConsistency: makeCheck('apk-aab-native-consistency', onlyApk.length === 0 && onlyAab.length === 0,
      'same ABI/library pairs', { onlyApk, onlyAab }),
    certifications: {
      installedSize50: 'UNPROVEN: requires complete fresh post-first-ball on-device/Play installed-size evidence.',
      indiaWeightedReach90: 'UNPROVEN: requires a current India-weighted denominator and physical cohort results.',
      pageSize16KbRuntime: 'UNPROVEN: requires a 16 KB-page device run and Play Console inspection.',
      playGeneratedSplits: 'UNPROVEN: requires bundletool/Play-equivalent split inspection for selected device specifications.',
    },
  };
  const checks = summarizeChecks(report);
  report.staticPass = checks.every((check) => check.pass);
  report.failures = checks.filter((check) => !check.pass);
  report.warnings = archives.flatMap((archive) => archive.partialLibraryCoverage.map((item) => ({
    id: `${archive.label}-partial-library-abi-coverage`,
    message: `${item.library} is absent from ${item.missing.join(', ')}; retained fallback must be proven before this ABI contributes to reach.`,
    ...item,
  })));
  return { help: false, exitCode: report.staticPass ? 0 : 1, report, json: options.json };
}

function printable(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function printReport(result) {
  if (result.help) {
    console.log(usage());
    return;
  }
  if (result.json) {
    console.log(JSON.stringify(result.report, null, 2));
    return;
  }
  const report = result.report;
  console.log('Android release compatibility preflight (static evidence only):');
  for (const check of summarizeChecks(report)) {
    console.log(`  ${check.pass ? 'PASS' : 'FAIL'}  ${check.id}: ${printable(check.observed)}`);
  }
  for (const warning of report.warnings) console.log(`  REVIEW ${warning.message}`);
  for (const archive of report.archives) {
    console.log(`  ${archive.label.toUpperCase()} native inventory: ${archive.nativeLibraryCount} libraries; ABIs ${archive.abis.join(', ') || 'none'}`);
  }
  console.log(`SIZE-50: ${report.certifications.installedSize50}`);
  console.log(`REACH-90: ${report.certifications.indiaWeightedReach90}`);
  console.log(`16 KB runtime: ${report.certifications.pageSize16KbRuntime}`);
  console.log(report.staticPass
    ? 'PASS: static compatibility preflight only; no reach or installed-size certification is implied.'
    : 'FAIL: static artifact compatibility regression detected.');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = run(process.argv.slice(2));
    printReport(result);
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(`Android compatibility check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
