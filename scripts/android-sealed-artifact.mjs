#!/usr/bin/env node

/**
 * Fail-closed host-side admission for an already-built Unity Android APK.
 * This module never connects to ADB and never builds or rewrites Android/web
 * output. The Gradle `help` invocation verifies the immutable Unity export
 * receipt through the same settings gate used by the release build.
 */

import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const BUILD_ID_PATTERN = /^[0-9a-f]{7,40}(?:\+[0-9a-f]{12})?$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function statIdentity(stat) {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    mode: String(stat.mode),
    nlink: String(stat.nlink),
    uid: String(stat.uid),
    gid: String(stat.gid),
    size: String(stat.size),
    mtimeNs: String(stat.mtimeNs),
    ctimeNs: String(stat.ctimeNs),
  };
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function snapshotArtifactIdentity(apkPath) {
  if (!existsSync(apkPath)) throw new Error(`sealed APK does not exist: ${apkPath}`);
  const pathStat = lstatSync(apkPath, { bigint: true });
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) throw new Error('sealed APK must be a regular, non-symbolic-link file');
  if (resolve(apkPath) !== apkPath || realpathSync(apkPath) !== apkPath) throw new Error('sealed APK path is not canonical absolute form');
  const parentPath = dirname(apkPath);
  if (realpathSync(parentPath) !== parentPath) throw new Error('sealed APK parent path is not canonical');
  const parentBefore = lstatSync(parentPath, { bigint: true });
  if (!parentBefore.isDirectory() || parentBefore.isSymbolicLink()) throw new Error('sealed APK parent must be a real directory');
  let descriptor;
  try {
    descriptor = openSync(apkPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const openedBefore = fstatSync(descriptor, { bigint: true });
    if (!openedBefore.isFile() || openedBefore.dev !== pathStat.dev || openedBefore.ino !== pathStat.ino) {
      throw new Error('sealed APK changed while opening');
    }
    const bytes = readFileSync(descriptor);
    const openedAfter = fstatSync(descriptor, { bigint: true });
    const pathAfter = lstatSync(apkPath, { bigint: true });
    const parentAfter = lstatSync(parentPath, { bigint: true });
    if (!same(statIdentity(openedBefore), statIdentity(openedAfter))
        || !same(statIdentity(pathStat), statIdentity(pathAfter))
        || !same(statIdentity(parentBefore), statIdentity(parentAfter))) {
      throw new Error('sealed APK or its directory changed while hashing');
    }
    return {
      path: apkPath,
      sha256: sha256Bytes(bytes),
      identity: statIdentity(openedAfter),
      parentIdentity: statIdentity(parentAfter),
    };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function assertArtifactIdentityStable(apkPath, expected, label = 'artifact identity recheck') {
  const observed = snapshotArtifactIdentity(apkPath);
  if (!same(observed, expected)) throw new Error(`${label}: sealed APK identity/hash/directory changed`);
  return observed;
}

export function copyPrivateSealedArtifact({ sourceApkPath, privateApkPath, expectedSha256 }) {
  if (existsSync(privateApkPath) || existsSync(dirname(privateApkPath))) {
    throw new Error(`private sealed-artifact path already exists: ${dirname(privateApkPath)}`);
  }
  const sourceBefore = snapshotArtifactIdentity(sourceApkPath);
  if (sourceBefore.sha256 !== expectedSha256) throw new Error(`source sealed APK SHA-256 mismatch: ${sourceBefore.sha256}`);
  const bytes = readFileSync(sourceApkPath);
  const sourceAfter = snapshotArtifactIdentity(sourceApkPath);
  if (!same(sourceBefore, sourceAfter) || sha256Bytes(bytes) !== expectedSha256) {
    throw new Error('source sealed APK changed while creating the private copy');
  }
  mkdirSync(dirname(privateApkPath), { recursive: false, mode: 0o700 });
  writeFileSync(privateApkPath, bytes, { flag: 'wx', mode: 0o400 });
  chmodSync(privateApkPath, 0o400);
  chmodSync(dirname(privateApkPath), 0o500);
  const artifact = snapshotArtifactIdentity(privateApkPath);
  if (artifact.sha256 !== expectedSha256) throw new Error('private sealed APK copy hash mismatch');
  return { sourceBefore, sourceAfter, artifact };
}

export function validateSealedArtifactInputs({ apkPath, expectedSha256, expectedBuildId }) {
  const errors = [];
  if (typeof apkPath !== 'string' || !apkPath.startsWith('/')) errors.push('APK_PATH must be an absolute path');
  if (typeof apkPath === 'string' && /[\r\n\0]/u.test(apkPath)) errors.push('APK_PATH contains a forbidden control character');
  if (typeof apkPath === 'string' && /debug/iu.test(basename(apkPath))) errors.push('debug APK naming is forbidden in sealed mode');
  if (!SHA256_PATTERN.test(expectedSha256 ?? '')) errors.push('EXPECTED_APK_SHA256 must be 64 lowercase hexadecimal characters');
  if (!BUILD_ID_PATTERN.test(expectedBuildId ?? '')) errors.push('EXPECTED_BUILD_ID is not a valid repository identity');
  return errors;
}

export function unityProofFromEntries(entries) {
  const set = new Set(entries);
  const abis = entries
    .map((entry) => entry.match(/^lib\/([^/]+)\/libunity\.so$/u)?.[1] ?? null)
    .filter(Boolean);
  const completeAbis = [...new Set(abis)].filter((abi) => (
    set.has(`lib/${abi}/libunity.so`)
    && set.has(`lib/${abi}/libmain.so`)
    && set.has(`lib/${abi}/libil2cpp.so`)
  ));
  return {
    complete: set.has('assets/bin/Data/unity_app_guid') && completeAbis.length > 0,
    completeAbis,
    unityAppGuidPresent: set.has('assets/bin/Data/unity_app_guid'),
  };
}

export function evaluateReleaseBadging(text, expectedPackage = 'in.vande.cricket') {
  const packageId = text.match(/^package:\s+name='([^']+)'/mu)?.[1] ?? null;
  const launchable = [...text.matchAll(/^launchable-activity:\s+name='([^']+)'/gmu)].map((match) => match[1]);
  const debuggable = /^application-debuggable\s*$/mu.test(text);
  const expectedActivity = `${expectedPackage}.MainActivity`;
  const errors = [];
  if (packageId !== expectedPackage) errors.push(`package is ${packageId ?? 'missing'}, expected ${expectedPackage}`);
  if (debuggable) errors.push('APK is application-debuggable');
  if (launchable.length !== 1 || launchable[0] !== expectedActivity) errors.push(`launchable activity is ${launchable.join(', ') || 'missing'}`);
  return { pass: errors.length === 0, packageId, debuggable, launchable, errors };
}

function run(command, args, { cwd = ROOT, maxBuffer = 64 * 1024 * 1024 } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer });
  if (result.error) throw new Error(`could not run ${command}: ${result.error.message}`);
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function requireSuccess(label, command, args, options) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    throw new Error(`${label} failed (${result.status}): ${(result.stderr || result.stdout).trim().slice(0, 2000)}`);
  }
  return result;
}

function latestBuildTools(sdk) {
  const root = join(sdk, 'build-tools');
  if (!existsSync(root)) throw new Error(`Android build-tools directory is missing: ${root}`);
  const versions = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const selected = versions.at(-1);
  if (!selected) throw new Error(`no Android build-tools installation exists under ${root}`);
  return join(root, selected);
}

const EMBEDDED_BUILD_ID_PATTERN = /(?<![0-9a-f])([0-9a-f]{7,40}(?:\+[0-9a-f]{12})?)(?![0-9a-f])/gu;

export function extractRepositoryBuildIds(text) {
  const ids = [];
  for (const match of String(text).matchAll(EMBEDDED_BUILD_ID_PATTERN)) {
    const candidate = match[1];
    const offset = match.index ?? 0;
    const context = String(text).slice(Math.max(0, offset - 256), offset + candidate.length + 256);
    if (candidate.includes('+') || /data-vande-build-id|__BUILD_ID__|["']buildId["']/u.test(context)) ids.push(candidate);
  }
  return [...new Set(ids)].sort();
}

function embeddedBuildProof(apkPath, entries, expectedBuildId, verifiedRun) {
  if (!entries.includes('assets/public/index.html')) throw new Error('APK lacks assets/public/index.html');
  const html = verifiedRun('embedded index extraction', 'unzip', ['-p', apkPath, 'assets/public/index.html']).stdout;
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js(?:\?[^"']*)?)["']/giu)]
    .map((match) => match[1].split('?')[0])
    .map((source) => `assets/public/${source.replace(/^\/+/, '')}`)
    .filter((entry, index, all) => all.indexOf(entry) === index);
  if (scripts.length === 0) throw new Error('embedded index references no JavaScript bundle');
  const allJavascript = entries.filter((entry) => /^assets\/public\/.*\.js$/u.test(entry)).sort();
  if (allJavascript.length === 0) throw new Error('APK web payload has no JavaScript chunks');
  const observations = [];
  for (const script of scripts) if (!entries.includes(script)) throw new Error(`embedded index references missing APK entry ${script}`);
  for (const script of allJavascript) {
    const bytes = verifiedRun('embedded bundle extraction', 'unzip', ['-p', apkPath, script], { maxBuffer: 128 * 1024 * 1024 }).stdout;
    const repositoryBuildIds = extractRepositoryBuildIds(bytes);
    observations.push({
      entry: script,
      referencedByIndex: scripts.includes(script),
      sha256: sha256Bytes(Buffer.from(bytes)),
      repositoryBuildIds,
      containsExpectedBuildId: repositoryBuildIds.includes(expectedBuildId),
    });
  }
  const allIds = [...new Set(observations.flatMap((observation) => observation.repositoryBuildIds))].sort();
  if (!allIds.includes(expectedBuildId)) {
    throw new Error(`APK web payload does not contain exact expected build ID ${expectedBuildId}`);
  }
  const conflicts = allIds.filter((value) => value !== expectedBuildId);
  if (conflicts.length) throw new Error(`APK web payload contains conflicting repository build IDs: ${conflicts.join(', ')}`);
  return { expectedBuildId, discoveredBuildIds: allIds, indexScripts: scripts, chunks: observations };
}

function sourceBuildId() {
  return requireSuccess('source identity', join(ROOT, 'scripts/build-id.sh'), []).stdout.trim();
}

export function verifySealedArtifact({ apkPath, expectedSha256, expectedBuildId, outputFile, sourceArtifact = null }) {
  const inputErrors = validateSealedArtifactInputs({ apkPath, expectedSha256, expectedBuildId });
  if (inputErrors.length) throw new Error(inputErrors.join('; '));
  if (existsSync(outputFile)) throw new Error(`sealed admission output already exists: ${outputFile}`);

  const initialArtifact = snapshotArtifactIdentity(apkPath);
  if (initialArtifact.sha256 !== expectedSha256) throw new Error(`sealed APK SHA-256 mismatch: ${initialArtifact.sha256}`);
  const stable = (label) => assertArtifactIdentityStable(apkPath, initialArtifact, label);
  const verifiedRun = (label, command, args, options) => {
    stable(`${label} before verifier`);
    const result = requireSuccess(label, command, args, options);
    stable(`${label} after verifier`);
    return result;
  };

  stable('source identity before verifier');
  const sourceBefore = sourceBuildId();
  stable('source identity after verifier');
  if (sourceBefore !== expectedBuildId) throw new Error(`current source ID ${sourceBefore} does not match sealed expected ID ${expectedBuildId}`);

  const entryResult = verifiedRun('APK inventory', 'unzip', ['-Z1', apkPath]);
  const entries = entryResult.stdout.split(/\r?\n/u).filter(Boolean);
  const unityProof = unityProofFromEntries(entries);
  if (!unityProof.complete) throw new Error('APK lacks the complete native Unity proof set (GUID + same-ABI libunity/libmain/libil2cpp)');
  const embeddedBuild = embeddedBuildProof(apkPath, entries, expectedBuildId, verifiedRun);

  const sdk = resolve(process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || join(homedir(), 'Library/Android/sdk'));
  const buildTools = latestBuildTools(sdk);
  const badgingResult = verifiedRun('APK badging', join(buildTools, 'aapt2'), ['dump', 'badging', apkPath]);
  const badging = evaluateReleaseBadging(badgingResult.stdout);
  if (!badging.pass) throw new Error(`sealed APK release badging failed: ${badging.errors.join('; ')}`);
  const signature = verifiedRun('APK signature verification', join(buildTools, 'apksigner'), ['verify', '--print-certs', apkPath]);

  const receiptPath = join(ROOT, 'unity/VandePractice/Builds/Android/.vande-export.properties');
  if (!existsSync(receiptPath) || !lstatSync(receiptPath).isFile() || lstatSync(receiptPath).isSymbolicLink()) {
    throw new Error('verified Unity Android export receipt is missing or not a regular file');
  }
  const receiptBytes = readFileSync(receiptPath);
  const receiptText = receiptBytes.toString('utf8');
  for (const required of ['schema=3', 'target=Android', 'scriptingBackend=IL2CPP', 'architectures=ARM64', 'minSdk=28']) {
    if (!receiptText.split(/\r?\n/u).includes(required)) throw new Error(`Unity receipt lacks exact ${required}`);
  }
  const gradle = verifiedRun(
    'immutable Unity export receipt verification',
    'nice',
    ['-n', '15', './gradlew', '--offline', '--no-daemon', '--console=plain', '--max-workers=2', '-PvandeUnity=1', 'help'],
    { cwd: join(ROOT, 'android'), maxBuffer: 32 * 1024 * 1024 },
  );
  stable('source identity final precheck');
  const sourceAfter = sourceBuildId();
  const finalArtifact = stable('final artifact identity');
  if (sourceAfter !== sourceBefore) throw new Error(`source ID changed during sealed artifact admission (${sourceBefore} -> ${sourceAfter})`);

  const report = {
    schemaVersion: 1,
    status: 'SEALED_ARTIFACT_ADMITTED_FOR_ENGINEERING_EVIDENCE',
    limitation: 'This is static admission for a PREVIEW engineering artifact; it is not Play, SIZE-50, REACH-90, physical-device or human-player evidence.',
    recordedUtc: new Date().toISOString(),
    sourceBuildId: sourceAfter,
    sourceArtifact,
    artifact: {
      path: apkPath,
      bytes: finalArtifact.identity.size,
      sha256: finalArtifact.sha256,
      identity: finalArtifact.identity,
      parentIdentity: finalArtifact.parentIdentity,
      privateReadOnlyCopy: sourceArtifact !== null,
    },
    embeddedBuild,
    unityProof,
    unityPayloadProvenance: {
      status: 'UNPROVEN_PENDING_VERSIONED_APK_TO_EXPORT_MAP',
      mappingSchema: null,
      entries: [],
    },
    badging,
    signature: {
      tool: join(buildTools, 'apksigner'),
      report: signature.stdout.trim().split(/\r?\n/u).slice(0, 20),
    },
    unityExportReceipt: {
      path: receiptPath,
      sha256: sha256Bytes(receiptBytes),
      gradleStatus: gradle.status,
      gradleOutputTail: `${gradle.stdout}\n${gradle.stderr}`.trim().split(/\r?\n/u).slice(-40),
    },
  };
  writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return report;
}

export function prepareAndVerifyPrivateSealedArtifact({
  sourceApkPath,
  privateApkPath,
  expectedSha256,
  expectedBuildId,
  outputFile,
}) {
  const inputErrors = validateSealedArtifactInputs({ apkPath: sourceApkPath, expectedSha256, expectedBuildId });
  if (inputErrors.length) throw new Error(inputErrors.join('; '));
  const copied = copyPrivateSealedArtifact({ sourceApkPath, privateApkPath, expectedSha256 });
  return verifySealedArtifact({
    apkPath: privateApkPath,
    expectedSha256,
    expectedBuildId,
    outputFile,
    sourceArtifact: {
      path: sourceApkPath,
      sha256: copied.sourceAfter.sha256,
      identity: copied.sourceAfter.identity,
      stableAcrossCopy: same(copied.sourceBefore, copied.sourceAfter),
    },
  });
}

export function recheckAdmittedArtifact({ admissionFile, outputFile }) {
  if (existsSync(outputFile)) throw new Error(`artifact recheck output already exists: ${outputFile}`);
  const admissionBytes = readFileSync(admissionFile);
  const admission = JSON.parse(admissionBytes.toString('utf8'));
  if (admission?.status !== 'SEALED_ARTIFACT_ADMITTED_FOR_ENGINEERING_EVIDENCE'
      || typeof admission?.artifact?.path !== 'string'
      || !SHA256_PATTERN.test(admission?.artifact?.sha256 ?? '')
      || !admission?.artifact?.identity || !admission?.artifact?.parentIdentity) {
    throw new Error('sealed admission report is invalid for artifact recheck');
  }
  const expected = {
    path: admission.artifact.path,
    sha256: admission.artifact.sha256,
    identity: admission.artifact.identity,
    parentIdentity: admission.artifact.parentIdentity,
  };
  const artifact = assertArtifactIdentityStable(admission.artifact.path, expected, 'immediate preinstall artifact recheck');
  const report = {
    schemaVersion: 1,
    status: 'SEALED_ARTIFACT_IDENTITY_RECHECKED',
    recordedUtc: new Date().toISOString(),
    admission: { path: admissionFile, sha256: sha256Bytes(admissionBytes) },
    artifact,
  };
  writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return report;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!['--apk', '--source-apk', '--private-apk', '--expected-sha256', '--expected-build-id', '--admission', '--output'].includes(name)) throw new Error(`unknown option ${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    index += 1;
    if (name === '--apk') options.apkPath = value;
    else if (name === '--source-apk') options.sourceApkPath = value;
    else if (name === '--private-apk') options.privateApkPath = value;
    else if (name === '--expected-sha256') options.expectedSha256 = value;
    else if (name === '--expected-build-id') options.expectedBuildId = value;
    else if (name === '--admission') options.admissionFile = value;
    else options.outputFile = value;
  }
  if (options.outputFile && !options.outputFile.startsWith('/')) options.outputFile = resolve(options.outputFile);
  if (options.admissionFile && !options.admissionFile.startsWith('/')) options.admissionFile = resolve(options.admissionFile);
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    let report;
    if (options.admissionFile) {
      if (!options.outputFile || Object.keys(options).some((key) => !['admissionFile', 'outputFile'].includes(key))) {
        throw new Error('Artifact recheck requires only --admission and --output');
      }
      report = recheckAdmittedArtifact(options);
    } else if (options.sourceApkPath || options.privateApkPath) {
      if (!options.sourceApkPath || !options.privateApkPath || !options.expectedSha256 || !options.expectedBuildId || !options.outputFile || options.apkPath) {
        throw new Error('Private admission requires --source-apk, --private-apk, --expected-sha256, --expected-build-id and --output');
      }
      report = prepareAndVerifyPrivateSealedArtifact(options);
    } else {
      if (!options.apkPath || !options.expectedSha256 || !options.expectedBuildId || !options.outputFile) {
        throw new Error('Admission requires --apk, --expected-sha256, --expected-build-id and --output');
      }
      report = verifySealedArtifact(options);
    }
    console.log(`SEALED_ARTIFACT_OK ${report.artifact.sha256} ${report.sourceBuildId ?? 'RECHECK'}`);
  } catch (error) {
    console.error(`SEALED_ARTIFACT_REJECTED ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
