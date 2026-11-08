import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  ANDROID_UNITY_CRITICAL_INPUT_PATHS,
  assertSealedGradleEnvironment,
  buildPayloadBinding,
  canonicalMaterialTree,
  createInvocationContract,
  LOCAL_PROVENANCE_LIMITATION,
  openZipArchive,
  parseAabSignerReport,
  parseApkSignerReport,
  parseCli,
  parseUnityExportReceipt,
  PAYLOAD_BINDING_STATUS,
  sha256Bytes,
  stableStringify,
  validateInvocationContract,
  validatePayloadBindingSidecar,
  validateTransformManifest,
  verifyExistingAndroidUnityPayloadBinding,
} from './android-unity-payload-binding.mjs';
import { promoteBoundUnitySet } from './android-exclusive-promote.mjs';

const require = createRequire(import.meta.url);
const { zipSync } = require('fflate');
const digest = (value) => createHash('sha256').update(value).digest('hex');
const encode = (value) => Buffer.from(value, 'utf8').toString('base64url');
const TASKS = [
  ':unityLibrary:mergeReleaseAssets',
  ':unityLibrary:mergeReleaseNativeLibs',
  ':app:mergeReleaseAssets',
  ':app:stripReleaseDebugSymbols',
];
const GENERATED = ['libc++_shared.so', 'libgame.so', 'libil2cpp.so', 'libswappywrapper.so'];
const ACTIVITY_GENERATED = ['libc++_shared.so', 'libil2cpp.so'];
const ACTIVITY_CMAKE_MARKER = 'NOT_APPLICABLE_UNITY_PLAYER_ACTIVITY_ENTRY_1_SWAPPY_0';
const FIXTURE_AAB_CONTENT_ENTRIES = [
  'META-INF/MANIFEST.MF',
  'base/assets/vande/unity-build-input.json',
  'base/assets/vande/unity-native-provenance.json',
  'base/assets/bin/Data/a',
  'base/assets/bin/Data/b',
  ...[...GENERATED, 'libmain.so', 'libunity.so']
    .sort()
    .map((name) => `base/lib/arm64-v8a/${name}`),
  'base/lib/armeabi-v7a/libdatastore_shared_counter.so',
];

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function shellPrint(value, status = 0) {
  return `printf '%s' ${shellQuote(value)}${status === 0 ? '' : `\nexit ${status}`}`;
}

function jarsignerFixtureReport({
  marker = 'jar verified.',
  status4Profile = false,
  unsignedEntry = null,
} = {}) {
  const entries = FIXTURE_AAB_CONTENT_ENTRIES.map((path) => {
    const flags = path === unsignedEntry ? 'm' : 'sm';
    return `${flags} 1 Thu Jan 01 00:00:00 UTC 2026 ${path}`;
  });
  const tail = [marker];
  if (status4Profile) {
    tail.push(
      'Error:',
      'This jar contains entries whose certificate chain is invalid. Reason: PKIX path building failed: sun.security.provider.certpath.SunCertPathBuilderException: unable to find valid certification path to requested target',
      'This jar contains entries whose signer certificate is self-signed.',
      'Warning:',
      'This jar contains signatures that do not include a timestamp. Without a timestamp, validation may later fail.',
      'POSIX file permission and/or symlink attributes detected. These attributes are ignored when signing and are not protected by the signature.',
      'This JAR file contains internal inconsistencies that may result in different contents when reading via JarFile and JarInputStream:',
      '- Manifest is missing when reading via JarInputStream',
      '- Entry META-INF/MANIFEST.MF is signed in JarFile but is not signed in JarInputStream',
      `- Entry ${FIXTURE_AAB_CONTENT_ENTRIES[0]} is signed in JarFile but is not signed in JarInputStream`,
    );
  }
  return `${entries.join('\n')}\n${tail.join('\n')}\n`;
}

function receiptTree(entries) {
  return digest(entries.map((entry, index) => (
    `${String(index).padStart(6, '0')}\t${entry.executable}\t${entry.sha256}\t${encode(entry.path)}\n`
  )).join(''));
}

function receiptFixture(suffix = '', androidRuntime = 'game-activity') {
  const isActivity = androidRuntime.startsWith('activity');
  const includesCmake = androidRuntime === 'game-activity'
    || androidRuntime === 'activity-with-cmake';
  const projectSettings = isActivity
    ? 'androidUseSwappy: 0\nandroidApplicationEntry: 1\n'
    : 'androidUseSwappy: 1\nandroidApplicationEntry: 2\n';
  const unityBuild = includesCmake
    ? "ndkVersion '27.2.12479018'\nexternalNativeBuild { cmake { version '3.22.1'; path 'src/main/cpp/CMakeLists.txt' } }\n"
    : "ndkVersion '27.2.12479018'\n";
  const source = [
    { path: 'Assets/Game.cs', executable: '0', content: Buffer.from(`source${suffix}`) },
    {
      path: 'ProjectSettings/ProjectSettings.asset',
      executable: '0',
      content: Buffer.from(projectSettings),
    },
  ];
  source.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  const exports = [
    { path: 'unityLibrary/src/main/assets/bin/Data/a', executable: '0', content: Buffer.from(`asset-a${suffix}`) },
    { path: 'unityLibrary/src/main/assets/bin/Data/b', executable: '0', content: Buffer.from(`asset-b${suffix}`) },
    { path: 'unityLibrary/src/main/jniLibs/arm64-v8a/libmain.so', executable: '0', content: Buffer.from(`module-libmain.so${suffix}`) },
    { path: 'unityLibrary/src/main/jniLibs/arm64-v8a/libunity.so', executable: '0', content: Buffer.from(`module-libunity.so${suffix}`) },
    { path: 'unityLibrary/build.gradle', executable: '0', content: Buffer.from(unityBuild) },
    ...(isActivity && androidRuntime !== 'activity-missing-entry' ? [
      {
        path: 'unityLibrary/src/main/java/com/unity3d/player/UnityPlayerActivity.java',
        executable: '0',
        content: Buffer.from(`activity${suffix}`),
      },
      ...(includesCmake ? [{
        path: 'unityLibrary/src/main/cpp/CMakeLists.txt',
        executable: '0',
        content: Buffer.from(`cmake${suffix}`),
      }] : []),
    ] : !isActivity ? [
      ...(includesCmake ? [{
        path: 'unityLibrary/src/main/cpp/CMakeLists.txt',
        executable: '0',
        content: Buffer.from(`cmake${suffix}`),
      }] : []),
      {
        path: 'unityLibrary/src/main/java/com/unity3d/player/UnityPlayerGameActivity.java',
        executable: '0',
        content: Buffer.from(`game-activity${suffix}`),
      },
    ] : []),
  ];
  exports.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  for (const entry of [...source, ...exports]) entry.sha256 = sha256Bytes(entry.content);
  const text = [
    'schema=3',
    'editorVersion=6000.3.27f1',
    'target=Android',
    'scriptingBackend=IL2CPP',
    'architectures=ARM64',
    'minSdk=28',
    `sourceFileCount=${source.length}`,
    `sourceTreeSha256=${receiptTree(source)}`,
    ...source.map((entry, index) => `sourceFile${String(index).padStart(6, '0')}=${entry.executable}:${entry.sha256}:${encode(entry.path)}`),
    `exportFileCount=${exports.length}`,
    `exportTreeSha256=${receiptTree(exports)}`,
    ...exports.map((entry, index) => `exportFile${String(index).padStart(6, '0')}=${entry.executable}:${entry.sha256}:${encode(entry.path)}`),
    '',
  ].join('\n');
  return { bytes: Buffer.from(text), source, exports };
}

function writeCanonicalJson(path, value) {
  writeFileSync(path, `${stableStringify(value)}\n`, { flag: 'w', mode: 0o600 });
}

function toolRecord(path) {
  const bytes = readFileSync(path);
  return { path, fileName: basename(path), bytes: bytes.length, sha256: sha256Bytes(bytes) };
}

function writeTool(path, body) {
  writeFileSync(path, `#!/bin/sh\nset -eu\n${body}\n`, { mode: 0o755 });
  chmodSync(path, 0o755);
}

function zipBytes(entries) {
  const normalized = {};
  for (const [name, bytes] of Object.entries(entries)) normalized[name] = new Uint8Array(bytes);
  return Buffer.from(zipSync(normalized, { level: 6 }));
}

function makeFixture(t, options = {}) {
  let root = mkdtempSync(join(tmpdir(), 'vande-h7-binding-'));
  root = realpathSync(root);
  t?.after(() => rmSync(root, { force: true, recursive: true }));
  const androidRuntime = options.androidRuntime ?? 'game-activity';
  const isActivity = androidRuntime.startsWith('activity');
  const receiptData = receiptFixture('', androidRuntime);
  const receipt = parseUnityExportReceipt(receiptData.bytes);
  const receiptPath = join(root, 'unity/VandePractice/Builds/Android/.vande-export.properties');
  for (const path of ANDROID_UNITY_CRITICAL_INPUT_PATHS) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, path.endsWith('.vande-export.properties') ? receiptData.bytes : `critical:${path}\n`);
  }
  const projectSettingsPath = join(
    root,
    'unity/VandePractice/ProjectSettings/ProjectSettings.asset',
  );
  mkdirSync(dirname(projectSettingsPath), { recursive: true });
  const projectSettingsEntry = receiptData.source.find(
    (entry) => entry.path === 'ProjectSettings/ProjectSettings.asset',
  );
  writeFileSync(projectSettingsPath, projectSettingsEntry.content);
  for (const entry of receiptData.exports.filter((candidate) => (
    candidate.path === 'unityLibrary/src/main/java/com/unity3d/player/UnityPlayerActivity.java'
      || candidate.path === 'unityLibrary/src/main/java/com/unity3d/player/UnityPlayerGameActivity.java'
      || candidate.path === 'unityLibrary/src/main/cpp/CMakeLists.txt'
  ))) {
    const absolute = join(root, 'unity/VandePractice/Builds/Android', entry.path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, entry.content);
  }
  const criticalInputs = ANDROID_UNITY_CRITICAL_INPUT_PATHS.map((path) => {
    const bytes = readFileSync(join(root, path));
    return { path, bytes: bytes.length, sha256: sha256Bytes(bytes) };
  });
  const apkPath = join(root, 'candidate.apk');
  const aabPath = join(root, 'candidate.aab');
  const contractPath = join(root, 'invocation.json');
  const transformPath = join(root, 'transform.json');
  const sidecarPath = join(root, 'payload-binding.json');
  const gradleHome = join(root, 'gradle-home');
  mkdirSync(gradleHome);
  const signerDigest = digest('fixture-signer');
  const apksigner = join(root, 'apksigner');
  const jarsigner = join(root, 'jarsigner');
  const keytool = join(root, 'keytool');
  writeTool(apksigner, options.apksignerBody ?? `printf 'V2 Signer: certificate SHA-256 digest: ${signerDigest}\\n'`);
  writeTool(jarsigner, options.jarsignerBody ?? shellPrint(jarsignerFixtureReport()));
  writeTool(keytool, options.keytoolBody ?? `printf 'Signer #1:\\n\\nCertificate #1:\\nCertificate fingerprints:\\n SHA256: ${signerDigest.match(/../gu).join(':')}\\n'`);

  const gradleProperties = {
    previewRelease: 'true',
    vandeUnity: '1',
    vandeUnityBinding: '1',
    vandeUnityInvocationContract: contractPath,
    vandeUnityInvocationId: '0123456789abcdef0123456789abcdef',
    vandeUnitySourceBuildId: '0123456789abcdef0123456789abcdef01234567',
  };
  const gradleArgs = [
    '--no-daemon', '--console=plain', '--max-workers=2',
    '-Dfile.encoding=UTF-8',
    '-Duser.country=US',
    '-Duser.language=en',
    '-Duser.variant=',
    ...Object.entries(gradleProperties).map(([key, value]) => `-P${key}=${value}`),
    'assembleRelease', 'bundleRelease', ':app:writeVandeUnityPayloadTransformManifest',
  ];
  const toolchain = {
    unityEditorVersion: '6000.3.27f1',
    agpVersion: '8.7.2',
    gradleDistributionUrl: 'https\\://services.gradle.org/distributions/gradle-8.11.1-bin.zip',
    ndkVersion: '27.2.12479018',
    cmakeVersion: isActivity ? ACTIVITY_CMAKE_MARKER : '3.22.1',
    javaHome: '/java',
    androidHome: '/android',
  };
  const direct = receipt.exportEntries.filter((entry) => entry.path.includes('/jniLibs/')).map((entry) => ({
    path: entry.path.slice('unityLibrary/src/main/jniLibs/'.length),
    receiptExportPath: entry.path,
    receiptSha256: entry.sha256,
  }));
  const contract = {
    schemaVersion: 2,
    kind: 'VANDE_UNITY_ANDROID_BUILD_INPUT',
    invocationId: gradleProperties.vandeUnityInvocationId,
    sourceBuildId: gradleProperties.vandeUnitySourceBuildId,
    mode: 'preview',
    unity: true,
    createdUtc: '2026-10-28T12:34:56.000Z',
    receipt: {
      path: 'unity/VandePractice/Builds/Android/.vande-export.properties',
      sha256: sha256Bytes(receiptData.bytes),
      editorVersion: receipt.editorVersion,
      sourceFileCount: receipt.sourceFileCount,
      sourceTreeSha256: receipt.sourceTreeSha256,
      exportFileCount: receipt.exportFileCount,
      exportTreeSha256: receipt.exportTreeSha256,
    },
    archiveReader: {
      kind: 'VANDE_IN_PROCESS_ZIP_READER', version: 1,
      implementation: 'scripts/android-unity-payload-binding.mjs',
    },
    verificationTools: {
      apksigner: toolRecord(apksigner), jarsigner: toolRecord(jarsigner), keytool: toolRecord(keytool),
    },
    pipeline: {
      unityPreflight: { cwd: 'android', launcher: ['nice', '-n', '15', './gradlew'], args: ['help'] },
      webBuild: { cwd: '.', launcher: ['npm'], args: ['run', 'build'], environment: { VITE_BUILD_TARGET: 'android' } },
      capacitorSync: { cwd: '.', launcher: ['npx'], args: ['cap', 'sync', 'android'] },
      gradle: { cwd: 'android', launcher: ['nice', '-n', '15', './gradlew'], args: gradleArgs },
    },
    gradleSeal: {
      gradleUserHome: gradleHome,
      requestedTaskNames: ['assembleRelease', 'bundleRelease', ':app:writeVandeUnityPayloadTransformManifest'],
      projectProperties: gradleProperties,
      systemProperties: {
        'file.encoding': 'UTF-8',
        'user.country': 'US',
        'user.language': 'en',
        'user.variant': '',
      },
      initScripts: [],
      rejectedEnvironment: ['GRADLE_OPTS', 'GRADLE_USER_HOME', 'JAVA_OPTS', 'JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS', '_JAVA_OPTIONS'],
      rejectOrgGradleProjectEnvironment: true,
    },
    nativeProvenancePolicy: {
      producerTask: ':unityLibrary:mergeReleaseNativeLibs',
      direct,
      generatedNames: isActivity ? ACTIVITY_GENERATED : GENERATED,
      generatedInputs: {
        receiptSha256: sha256Bytes(receiptData.bytes),
        sourceTreeSha256: receipt.sourceTreeSha256,
        exportTreeSha256: receipt.exportTreeSha256,
      },
      generatedTools: {
        unityEditorVersion: toolchain.unityEditorVersion,
        ndkVersion: toolchain.ndkVersion,
        cmakeVersion: toolchain.cmakeVersion,
      },
    },
    toolchain,
    criticalInputs,
  };
  writeCanonicalJson(contractPath, contract);
  let contractBytes = readFileSync(contractPath);
  const assets = receiptData.exports.filter((entry) => entry.path.includes('/assets/')).map((entry) => ({
    path: entry.path.slice('unityLibrary/src/main/assets/'.length),
    receiptExportPath: entry.path,
    receiptSha256: entry.sha256,
    module: { bytes: entry.content.length, sha256: entry.sha256 },
    app: { bytes: entry.content.length, sha256: entry.sha256 },
    content: entry.content,
  }));
  const nativeNames = [
    ...(isActivity ? ACTIVITY_GENERATED : GENERATED),
    'libmain.so',
    'libunity.so',
  ].sort();
  const natives = nativeNames.map((name) => {
    const directEntry = receiptData.exports.find((entry) => entry.path.endsWith(`/${name}`));
    const module = directEntry?.content ?? Buffer.from(`module-${name}`);
    const app = Buffer.from(`stripped-${name}`);
    return {
      path: `arm64-v8a/${name}`,
      module: { bytes: module.length, sha256: sha256Bytes(module) },
      app: { bytes: app.length, sha256: sha256Bytes(app) },
      origin: directEntry ? {
        kind: 'receipt', receiptExportPath: directEntry.path, receiptSha256: directEntry.sha256,
      } : {
        kind: 'generated', producerTask: contract.nativeProvenancePolicy.producerTask,
        inputs: contract.nativeProvenancePolicy.generatedInputs,
        tools: contract.nativeProvenancePolicy.generatedTools,
      },
      content: app,
    };
  });
  const cleanAssets = assets.map(({ content: _content, ...record }) => record);
  const cleanNatives = natives.map(({ content: _content, ...record }) => record);
  const nativeProvenance = {
    schemaVersion: 1,
    kind: 'VANDE_UNITY_ANDROID_NATIVE_PROVENANCE',
    invocationId: contract.invocationId,
    sourceBuildId: contract.sourceBuildId,
    contractSha256: sha256Bytes(contractBytes),
    receipt: {
      sha256: contract.receipt.sha256,
      sourceTreeSha256: receipt.sourceTreeSha256,
      exportTreeSha256: receipt.exportTreeSha256,
    },
    natives: cleanNatives.map(({ path, module, origin }) => ({ path, module, origin })),
    treeSha256: canonicalMaterialTree(cleanNatives.map(({ path, module }) => ({ path, ...module }))).sha256,
  };
  let nativeProvenanceBytes = Buffer.from(`${stableStringify(nativeProvenance)}\n`);
  const transform = {
    schemaVersion: 1,
    kind: 'VANDE_UNITY_ANDROID_TRANSFORM',
    invocationId: contract.invocationId,
    sourceBuildId: contract.sourceBuildId,
    contractSha256: sha256Bytes(contractBytes),
    variant: 'release',
    generatedUtc: '2026-10-28T12:35:56.000Z',
    receipt: {
      sha256: contract.receipt.sha256,
      sourceTreeSha256: receipt.sourceTreeSha256,
      exportTreeSha256: receipt.exportTreeSha256,
    },
    nativeProvenance: {
      entry: 'assets/vande/unity-native-provenance.json',
      bytes: nativeProvenanceBytes.length,
      sha256: sha256Bytes(nativeProvenanceBytes),
    },
    taskOutputs: TASKS,
    assets: cleanAssets,
    natives: cleanNatives,
    trees: {
      assetAppSha256: canonicalMaterialTree(cleanAssets.map(({ path, app }) => ({ path, ...app }))).sha256,
      nativeModuleSha256: canonicalMaterialTree(cleanNatives.map(({ path, module }) => ({ path, ...module }))).sha256,
      nativeAppSha256: canonicalMaterialTree(cleanNatives.map(({ path, app }) => ({ path, ...app }))).sha256,
    },
  };
  writeCanonicalJson(transformPath, transform);

  const writeArchives = ({ apkExtras = {}, aabExtras = {} } = {}) => {
    contractBytes = readFileSync(contractPath);
    const apk = {
      'assets/vande/unity-build-input.json': contractBytes,
      'assets/vande/unity-native-provenance.json': nativeProvenanceBytes,
    };
    const aab = {
      'META-INF/MANIFEST.MF': Buffer.from('Manifest-Version: 1.0\n\n'),
      'base/assets/vande/unity-build-input.json': contractBytes,
      'base/assets/vande/unity-native-provenance.json': nativeProvenanceBytes,
    };
    for (const record of assets) {
      apk[`assets/${record.path}`] = record.content;
      aab[`base/assets/${record.path}`] = record.content;
    }
    for (const record of natives) {
      apk[`lib/${record.path}`] = record.content;
      aab[`base/lib/${record.path}`] = record.content;
    }
    apk['lib/armeabi-v7a/libdatastore_shared_counter.so'] = Buffer.from('host-native');
    aab['base/lib/armeabi-v7a/libdatastore_shared_counter.so'] = Buffer.from('host-native');
    Object.assign(apk, apkExtras);
    Object.assign(aab, aabExtras);
    writeFileSync(apkPath, zipBytes(apk));
    writeFileSync(aabPath, zipBytes(aab));
  };
  const rebindContract = () => {
    contractBytes = readFileSync(contractPath);
    nativeProvenance.contractSha256 = sha256Bytes(contractBytes);
    nativeProvenanceBytes = Buffer.from(`${stableStringify(nativeProvenance)}\n`);
    transform.contractSha256 = sha256Bytes(contractBytes);
    transform.nativeProvenance.bytes = nativeProvenanceBytes.length;
    transform.nativeProvenance.sha256 = sha256Bytes(nativeProvenanceBytes);
    writeCanonicalJson(transformPath, transform);
    writeArchives();
  };
  writeArchives();
  const args = () => ({
    apkPath, aabPath, contractPath, transformPath, receiptPath,
    sourceBuildId: contract.sourceBuildId, apksigner, jarsigner, keytool,
    recordedUtc: '2026-10-28T12:36:56.000Z',
  });
  const build = () => buildPayloadBinding(args());
  const writeSidecar = (sidecar) => {
    writeCanonicalJson(sidecarPath, sidecar);
    return sha256Bytes(readFileSync(sidecarPath));
  };
  const admissionArgs = (sidecarSha256) => ({
    root, sidecarPath, expectedSidecarPath: sidecarPath,
    expectedSidecarSha256: sidecarSha256, apkPath,
    currentSourceBuildId: contract.sourceBuildId, receiptPath, apksigner,
  });
  return {
    root, receiptData, receipt, receiptPath, contract, contractPath,
    get contractBytes() { return contractBytes; },
    transform, transformPath, nativeProvenance,
    get nativeProvenanceBytes() { return nativeProvenanceBytes; },
    assets, natives, apkPath, aabPath, sidecarPath,
    apksigner, jarsigner, keytool, signerDigest, args, build, writeArchives,
    writeSidecar, admissionArgs, rebindContract,
  };
}

test('receipt parser accepts exhaustive assets and direct native entries', () => {
  const fixture = receiptFixture();
  const receipt = parseUnityExportReceipt(fixture.bytes);
  assert.equal(receipt.exportFileCount, 7);
  assert.equal(receipt.exportEntries.filter((entry) => entry.path.includes('/jniLibs/')).length, 2);
});

test('receipt parser rejects duplicate keys and forged tree digests', () => {
  const fixture = receiptFixture();
  assert.throws(() => parseUnityExportReceipt(Buffer.from(`schema=3\n${fixture.bytes}`)), /duplicate Unity receipt key/u);
  const forged = Buffer.from(fixture.bytes.toString().replace(/^exportTreeSha256=[0-9a-f]{64}$/mu, `exportTreeSha256=${'0'.repeat(64)}`));
  assert.throws(() => parseUnityExportReceipt(forged), /export receipt tree digest is invalid/u);
});

test('in-process ZIP reader extracts real deflate data and rejects non-ZIP forgery', () => {
  const archive = openZipArchive(zipBytes({ 'safe/file': Buffer.from('evidence') }), 'fixture');
  assert.equal(archive.extract('safe/file').toString(), 'evidence');
  assert.throws(() => openZipArchive(Buffer.from('{"fake":true}'), 'forgery'), /not a ZIP|no ZIP/u);
});

test('CLI has no caller-selected archive-reader option', () => {
  assert.throws(() => parseCli(['bind', '--unzip', '/tmp/fake']), /unknown bind option --unzip/u);
});

test('sealed Gradle environment rejects every ambient injection family', () => {
  const home = '/private/tmp/sealed-home';
  assert.doesNotThrow(() => assertSealedGradleEnvironment({ GRADLE_USER_HOME: home }, home));
  for (const name of ['GRADLE_OPTS', 'JAVA_OPTS', 'JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS', '_JAVA_OPTIONS', 'ORG_GRADLE_PROJECT_attack']) {
    assert.throws(
      () => assertSealedGradleEnvironment({ GRADLE_USER_HOME: home, [name]: 'attack' }, home),
      /rejects/u,
    );
  }
});

test('invocation contract rejects changed task names, project properties and unknown fields', (t) => {
  const fixture = makeFixture(t);
  assert.equal(validateInvocationContract(fixture.contract), fixture.contract);
  const task = structuredClone(fixture.contract);
  task.gradleSeal.requestedTaskNames[0] = 'assembleDebug';
  assert.throws(() => validateInvocationContract(task), /requestedTaskNames differs/u);
  const property = structuredClone(fixture.contract);
  property.gradleSeal.projectProperties.attack = '1';
  assert.throws(() => validateInvocationContract(property), /Gradle seal differs/u);
  const reorderedProjectProperties = structuredClone(fixture.contract);
  const contractIndex = reorderedProjectProperties.pipeline.gradle.args.findIndex(
    (argument) => argument.startsWith('-PvandeUnityInvocationContract='),
  );
  const idIndex = reorderedProjectProperties.pipeline.gradle.args.findIndex(
    (argument) => argument.startsWith('-PvandeUnityInvocationId='),
  );
  [
    reorderedProjectProperties.pipeline.gradle.args[contractIndex],
    reorderedProjectProperties.pipeline.gradle.args[idIndex],
  ] = [
    reorderedProjectProperties.pipeline.gradle.args[idIndex],
    reorderedProjectProperties.pipeline.gradle.args[contractIndex],
  ];
  assert.throws(
    () => validateInvocationContract(reorderedProjectProperties),
    /project-property argument vector differs/u,
  );
  const initScript = structuredClone(fixture.contract);
  initScript.pipeline.gradle.args.splice(3, 0, '--init-script=/tmp/attack.gradle');
  assert.throws(() => validateInvocationContract(initScript), /sealed allowlist/u);
  const systemProperty = structuredClone(fixture.contract);
  systemProperty.pipeline.gradle.args.splice(3, 0, '-Dorg.gradle.jvmargs=-javaagent:attack.jar');
  assert.throws(() => validateInvocationContract(systemProperty), /system property is not in the sealed allowlist/u);
  const fixedSystemArguments = [
    '-Dfile.encoding=UTF-8',
    '-Duser.country=US',
    '-Duser.language=en',
    '-Duser.variant=',
  ];
  for (const argument of fixedSystemArguments) {
    const wrongIntrinsic = structuredClone(fixture.contract);
    const wrongIndex = wrongIntrinsic.pipeline.gradle.args.indexOf(argument);
    wrongIntrinsic.pipeline.gradle.args[wrongIndex] = `${argument}altered`;
    assert.throws(
      () => validateInvocationContract(wrongIntrinsic),
      /system property is not in the sealed allowlist/u,
    );

    const missingIntrinsic = structuredClone(fixture.contract);
    missingIntrinsic.pipeline.gradle.args.splice(
      missingIntrinsic.pipeline.gradle.args.indexOf(argument),
      1,
    );
    assert.throws(
      () => validateInvocationContract(missingIntrinsic),
      /fixed system-property argument vector/u,
    );

    const duplicateIntrinsic = structuredClone(fixture.contract);
    duplicateIntrinsic.pipeline.gradle.args.splice(7, 0, argument);
    assert.throws(
      () => validateInvocationContract(duplicateIntrinsic),
      /system property is duplicated/u,
    );
  }
  const wrapperProperty = structuredClone(fixture.contract);
  wrapperProperty.pipeline.gradle.args.splice(3, 0, '-Dorg.gradle.appname=gradlew');
  assert.throws(
    () => validateInvocationContract(wrapperProperty),
    /system property is not in the sealed allowlist/u,
  );
  assert.throws(() => validateInvocationContract({ ...fixture.contract, injected: true }), /keys differ/u);
});

test('sealed Gradle contract binds only Gradle 8.14.3 intrinsic system properties', (t) => {
  const fixture = makeFixture(t);
  assert.deepEqual(fixture.contract.gradleSeal.systemProperties, {
    'file.encoding': 'UTF-8',
    'user.country': 'US',
    'user.language': 'en',
    'user.variant': '',
  });
  const missingWrapperProperty = structuredClone(fixture.contract);
  missingWrapperProperty.gradleSeal.systemProperties = {};
  assert.throws(
    () => validateInvocationContract(missingWrapperProperty),
    /Gradle seal differs/u,
  );
  const extraSystemProperty = structuredClone(fixture.contract);
  extraSystemProperty.gradleSeal.systemProperties.attack = '1';
  assert.throws(
    () => validateInvocationContract(extraSystemProperty),
    /Gradle seal differs/u,
  );
});

test('createInvocationContract happy path seals exact tools, Gradle home and task vector', (t) => {
  const fixture = makeFixture(t);
  writeFileSync(join(fixture.root, 'android/build.gradle'), "classpath 'com.android.tools.build:gradle:8.7.2'\n");
  writeFileSync(
    join(fixture.root, 'android/gradle/wrapper/gradle-wrapper.properties'),
    'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.11.1-bin.zip\n',
  );
  writeFileSync(
    join(fixture.root, 'unity/VandePractice/Builds/Android/unityLibrary/build.gradle'),
    "ndkVersion '27.2.12479018'\nexternalNativeBuild { cmake { version '3.22.1'; path 'src/main/cpp/CMakeLists.txt' } }\n",
  );
  const javaHome = join(fixture.root, 'java-home');
  const androidHome = join(fixture.root, 'android-home');
  mkdirSync(javaHome);
  mkdirSync(androidHome);
  const gradleHome = fixture.contract.gradleSeal.gradleUserHome;
  const contract = createInvocationContract({
    root: fixture.root,
    invocationId: fixture.contract.invocationId,
    sourceBuildId: fixture.contract.sourceBuildId,
    mode: 'preview',
    receiptPath: fixture.receiptPath,
    preflightArgs: ['--offline', 'help'],
    webArgs: ['npm', 'run', 'build'],
    webEnvironment: { BUILD_ID: fixture.contract.sourceBuildId, VITE_BUILD_TARGET: 'android' },
    syncArgs: ['npx', 'cap', 'sync', 'android'],
    gradleArgs: fixture.contract.pipeline.gradle.args,
    javaHome,
    androidHome,
    gradleUserHome: gradleHome,
    apksigner: fixture.apksigner,
    jarsigner: fixture.jarsigner,
    keytool: fixture.keytool,
    // Reproduce Node's process.env host-object shape rather than testing only
    // an ordinary object literal.
    environment: Object.assign(Object.create(null), { GRADLE_USER_HOME: gradleHome }),
    createdUtc: '2026-10-28T12:34:56.000Z',
  });
  assert.equal(validateInvocationContract(contract), contract);
  assert.equal(contract.toolchain.cmakeVersion, '3.22.1');
  assert.deepEqual(contract.nativeProvenancePolicy.generatedNames, GENERATED);
  assert.equal(contract.verificationTools.apksigner.sha256, toolRecord(fixture.apksigner).sha256);
  assert.deepEqual(contract.gradleSeal.requestedTaskNames, fixture.contract.gradleSeal.requestedTaskNames);
  assert.throws(() => createInvocationContract({
    root: fixture.root,
    invocationId: fixture.contract.invocationId,
    sourceBuildId: fixture.contract.sourceBuildId,
    mode: 'preview',
    receiptPath: fixture.receiptPath,
    preflightArgs: ['--offline', 'help'],
    webArgs: ['npm', 'run', 'build'],
    webEnvironment: { BUILD_ID: fixture.contract.sourceBuildId, VITE_BUILD_TARGET: 'android' },
    syncArgs: ['npx', 'cap', 'sync', 'android'],
    gradleArgs: fixture.contract.pipeline.gradle.args,
    javaHome,
    androidHome,
    gradleUserHome: gradleHome,
    apksigner: fixture.apksigner,
    jarsigner: fixture.jarsigner,
    keytool: fixture.keytool,
    environment: Object.assign(Object.create(null), {
      GRADLE_USER_HOME: gradleHome,
      JAVA_TOOL_OPTIONS: 'attack',
    }),
    createdUtc: '2026-10-28T12:34:56.000Z',
  }), /rejects JAVA_TOOL_OPTIONS/u);
});

test('createInvocationContract accepts Activity entry 1 without CMake or Swappy', (t) => {
  const fixture = makeFixture(t, { androidRuntime: 'activity' });
  writeFileSync(join(fixture.root, 'android/build.gradle'), "classpath 'com.android.tools.build:gradle:8.7.2'\n");
  writeFileSync(
    join(fixture.root, 'android/gradle/wrapper/gradle-wrapper.properties'),
    'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.11.1-bin.zip\n',
  );
  writeFileSync(
    join(fixture.root, 'unity/VandePractice/Builds/Android/unityLibrary/build.gradle'),
    "ndkVersion '27.2.12479018'\n",
  );
  const javaHome = join(fixture.root, 'java-home');
  const androidHome = join(fixture.root, 'android-home');
  mkdirSync(javaHome);
  mkdirSync(androidHome);
  const contract = createInvocationContract({
    root: fixture.root,
    invocationId: fixture.contract.invocationId,
    sourceBuildId: fixture.contract.sourceBuildId,
    mode: 'preview',
    receiptPath: fixture.receiptPath,
    preflightArgs: ['--offline', 'help'],
    webArgs: ['npm', 'run', 'build'],
    webEnvironment: { BUILD_ID: fixture.contract.sourceBuildId, VITE_BUILD_TARGET: 'android' },
    syncArgs: ['npx', 'cap', 'sync', 'android'],
    gradleArgs: fixture.contract.pipeline.gradle.args,
    javaHome,
    androidHome,
    gradleUserHome: fixture.contract.gradleSeal.gradleUserHome,
    apksigner: fixture.apksigner,
    jarsigner: fixture.jarsigner,
    keytool: fixture.keytool,
    environment: { GRADLE_USER_HOME: fixture.contract.gradleSeal.gradleUserHome },
    createdUtc: '2026-10-28T12:34:56.000Z',
  });
  assert.equal(validateInvocationContract(contract), contract);
  assert.equal(contract.toolchain.cmakeVersion, ACTIVITY_CMAKE_MARKER);
  assert.deepEqual(contract.nativeProvenancePolicy.generatedNames, ACTIVITY_GENERATED);
  assert.ok(!contract.nativeProvenancePolicy.generatedNames.includes('libgame.so'));
  assert.ok(!contract.nativeProvenancePolicy.generatedNames.includes('libswappywrapper.so'));
});

test('createInvocationContract rejects contradictory Activity and GameActivity evidence', (t) => {
  const fixture = makeFixture(t, { androidRuntime: 'activity' });
  writeFileSync(join(fixture.root, 'android/build.gradle'), "classpath 'com.android.tools.build:gradle:8.7.2'\n");
  writeFileSync(
    join(fixture.root, 'android/gradle/wrapper/gradle-wrapper.properties'),
    'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.11.1-bin.zip\n',
  );
  const unityBuildPath = join(
    fixture.root,
    'unity/VandePractice/Builds/Android/unityLibrary/build.gradle',
  );
  const projectSettingsPath = join(
    fixture.root,
    'unity/VandePractice/ProjectSettings/ProjectSettings.asset',
  );
  const javaHome = join(fixture.root, 'java-home');
  const androidHome = join(fixture.root, 'android-home');
  mkdirSync(javaHome);
  mkdirSync(androidHome);
  const invoke = () => createInvocationContract({
    root: fixture.root,
    invocationId: fixture.contract.invocationId,
    sourceBuildId: fixture.contract.sourceBuildId,
    mode: 'preview',
    receiptPath: fixture.receiptPath,
    preflightArgs: ['--offline', 'help'],
    webArgs: ['npm', 'run', 'build'],
    webEnvironment: { BUILD_ID: fixture.contract.sourceBuildId, VITE_BUILD_TARGET: 'android' },
    syncArgs: ['npx', 'cap', 'sync', 'android'],
    gradleArgs: fixture.contract.pipeline.gradle.args,
    javaHome,
    androidHome,
    gradleUserHome: fixture.contract.gradleSeal.gradleUserHome,
    apksigner: fixture.apksigner,
    jarsigner: fixture.jarsigner,
    keytool: fixture.keytool,
    environment: { GRADLE_USER_HOME: fixture.contract.gradleSeal.gradleUserHome },
    createdUtc: '2026-10-28T12:34:56.000Z',
  });

  writeFileSync(
    unityBuildPath,
    "ndkVersion '27.2.12479018'\nexternalNativeBuild { cmake { version '3.22.1'; path 'src/main/cpp/CMakeLists.txt' } }\n",
  );
  assert.throws(
    invoke,
    /Unity exported unityLibrary\/build\.gradle differs from the exhaustive Unity receipt/u,
  );

  writeFileSync(unityBuildPath, "ndkVersion '27.2.12479018'\n");
  writeFileSync(projectSettingsPath, 'androidUseSwappy: 0\nandroidApplicationEntry: 2\n');
  assert.throws(invoke, /Unity ProjectSettings\.asset differs from the exhaustive Unity receipt/u);

  writeFileSync(projectSettingsPath, 'androidUseSwappy: 0\nandroidApplicationEntry: 1\n');
  writeFileSync(
    join(
      fixture.root,
      'unity/VandePractice/Builds/Android/unityLibrary/src/main/java/com/unity3d/player/UnityPlayerActivity.java',
    ),
    'changed after receipt\n',
  );
  assert.throws(invoke, /UnityPlayerActivity export differs from the exhaustive Unity receipt/u);
});

test('createInvocationContract rejects receipt-bound missing or contradictory runtime shapes', (t) => {
  const cases = [
    {
      androidRuntime: 'activity-with-cmake',
      expected: /Activity-mode Unity export must not declare CMake/u,
    },
    {
      androidRuntime: 'activity-missing-entry',
      expected: /Activity-mode Unity export omits unityLibrary\/src\/main\/java\/com\/unity3d\/player\/UnityPlayerActivity\.java/u,
    },
    {
      androidRuntime: 'game-activity-missing-cmake',
      expected: /cannot read GameActivity CMake version\/path/u,
    },
  ];
  for (const { androidRuntime, expected } of cases) {
    const fixture = makeFixture(t, { androidRuntime });
    writeFileSync(join(fixture.root, 'android/build.gradle'), "classpath 'com.android.tools.build:gradle:8.7.2'\n");
    writeFileSync(
      join(fixture.root, 'android/gradle/wrapper/gradle-wrapper.properties'),
      'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.11.1-bin.zip\n',
    );
    const unityBuildEntry = fixture.receiptData.exports.find(
      (entry) => entry.path === 'unityLibrary/build.gradle',
    );
    writeFileSync(
      join(fixture.root, 'unity/VandePractice/Builds/Android/unityLibrary/build.gradle'),
      unityBuildEntry.content,
    );
    const javaHome = join(fixture.root, 'java-home');
    const androidHome = join(fixture.root, 'android-home');
    mkdirSync(javaHome);
    mkdirSync(androidHome);
    assert.throws(() => createInvocationContract({
      root: fixture.root,
      invocationId: fixture.contract.invocationId,
      sourceBuildId: fixture.contract.sourceBuildId,
      mode: 'preview',
      receiptPath: fixture.receiptPath,
      preflightArgs: ['--offline', 'help'],
      webArgs: ['npm', 'run', 'build'],
      webEnvironment: { BUILD_ID: fixture.contract.sourceBuildId, VITE_BUILD_TARGET: 'android' },
      syncArgs: ['npx', 'cap', 'sync', 'android'],
      gradleArgs: fixture.contract.pipeline.gradle.args,
      javaHome,
      androidHome,
      gradleUserHome: fixture.contract.gradleSeal.gradleUserHome,
      apksigner: fixture.apksigner,
      jarsigner: fixture.jarsigner,
      keytool: fixture.keytool,
      environment: { GRADLE_USER_HOME: fixture.contract.gradleSeal.gradleUserHome },
      createdUtc: '2026-10-28T12:34:56.000Z',
    }), expected);
  }
});

test('Gradle settings binds every observable sealed invocation semantic', () => {
  const settings = readFileSync(new URL('../android/settings.gradle', import.meta.url), 'utf8');
  assert.match(settings, /gradle\.startParameter\.taskNames != exactRequestedTasks/u);
  assert.match(settings, /actualProjectProperties != sealedProjectProperties/u);
  assert.match(settings, /actualSystemProperties != sealedSystemProperties/u);
  assert.match(
    settings,
    /sealedSystemProperties\.collect \{ key, value -> "-D\$\{key\}=\$\{value\}" \}/u,
  );
  assert.match(settings, /exactGradleArgs != expectedGradleArgs/u);
  assert.doesNotMatch(settings, /exactGradleArgs\.containsAll\(expectedGradleArgs\)/u);
  assert.match(settings, /gradle\.startParameter\.maxWorkerCount != 2/u);
  assert.match(settings, /!actualInitScripts\.isEmpty\(\)/u);
  assert.match(settings, /actualJavaHome != sealedJavaHome/u);
  assert.match(settings, /actualAndroidHome != sealedAndroidHome/u);
  assert.match(settings, /ANDROID_SDK_ROOT/u);
  assert.match(settings, /FileChannel\.open\([\s\S]*localPropertiesPath,[\s\S]*LinkOption\.NOFOLLOW_LINKS/u);
  assert.match(settings, /localProperties\.stringPropertyNames\(\) != \(\['sdk\.dir'\] as Set\)/u);
  assert.match(settings, /localPropertiesAndroidHome != sealedAndroidHome/u);
});

test('Gradle native provenance uses Java String keys for exact map containment', () => {
  const build = readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
  assert.match(build, /String key = "\$\{abi\}\/\$\{name\}"/u);
  assert.match(build, /String requiredPath = "arm64-v8a\/\$\{required\}"/u);
  assert.match(build, /records\.containsKey\(key\)/u);
  assert.match(build, /unityNatives\.containsKey\(requiredPath\)/u);
  assert.doesNotMatch(build, /containsKey\("[^"\n]*\$\{/u);
});

test('Gradle keeps Unity ARM64-only while inventorying the exact safe app ABI envelope', () => {
  const build = readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
  assert.match(build, /def unityNativeAbis = \['arm64-v8a'\]\.asImmutable\(\)/u);
  const appAbis = build.match(/def appNativeAbis = \[([\s\S]*?)\]\.asImmutable\(\)/u);
  assert.ok(appAbis, 'missing immutable app native ABI allowlist');
  assert.deepEqual(
    [...appAbis[1].matchAll(/'([^']+)'/gu)].map((match) => match[1]),
    ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'],
  );
  assert.match(
    build,
    /def nativeOutputs = \{ List files, String label, List<String> allowedAbis ->/u,
  );
  assert.match(build, /!allowedAbis\.contains\(abi\)/u);
  assert.match(
    build,
    /collectTaskOutputFiles\(unityNativeTask, unityNativeTask\.path\),\n\s+unityNativeTask\.path,\n\s+unityNativeAbis\)/u,
  );
  assert.match(
    build,
    /collectTaskOutputFiles\(appNativeTask, appNativeTask\.path\),\n\s+appNativeTask\.path,\n\s+appNativeAbis\)/u,
  );
});

test('every exact release lint asset consumer depends on both generated Unity attestations', () => {
  const build = readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
  const consumerNames = build.match(
    /def releaseLintAssetConsumerNames = \[([\s\S]*?)\]\.asImmutable\(\)/u,
  );
  assert.ok(consumerNames, 'missing immutable release lint asset-consumer allowlist');
  assert.deepEqual(
    [...consumerNames[1].matchAll(/'([^']+)'/gu)].map((match) => match[1]),
    [
      'generateReleaseLintModel',
      'generateReleaseLintReportModel',
      'generateReleaseLintVitalReportModel',
      'lintAnalyzeRelease',
      'lintVitalAnalyzeRelease',
    ],
  );
  assert.match(
    build,
    /tasks\.matching \{ releaseLintAssetConsumerNames\.contains\(it\.name\) \}\.configureEach \{\n\s+dependsOn generateAttestation\n\s+dependsOn generateNativeProvenance\n\s+\}/u,
  );
});

test('sealed build preflight can populate its fresh isolated Gradle cache', () => {
  const script = readFileSync(new URL('./build-android.sh', import.meta.url), 'utf8');
  assert.match(
    script,
    /PREFLIGHT_ARGS=\(--no-daemon --console=plain --max-workers=2 -PvandeUnity=1 help\)/u,
  );
  assert.doesNotMatch(script, /PREFLIGHT_ARGS=\([^\n]*--offline/u);
  assert.match(script, /GRADLE_USER_HOME_SEALED="\$INVOCATION_DIR\/gradle-user-home"/u);
  assert.match(script, /export GRADLE_USER_HOME="\$GRADLE_USER_HOME_SEALED"/u);
  assert.match(
    script,
    /GRADLE_SEALED_SYSTEM_PROPS=\(\n\s+-Dfile\.encoding=UTF-8\n\s+-Duser\.country=US\n\s+-Duser\.language=en\n\s+-Duser\.variant=\n\)/u,
  );
  assert.match(
    script,
    /GRADLE_ARGS=\(\n\s+--no-daemon --console=plain --max-workers=2\n\s+"\$\{GRADLE_SEALED_SYSTEM_PROPS\[@\]\}"/u,
  );
  assert.match(
    script,
    /GRADLE_PROPS\+=\("-PappLinksBasePath=\$\{APP_LINKS_BASE_PATH:-\}" "-PappLinksHost=\$APP_LINKS_HOST"\)/u,
  );
  assert.match(
    script,
    /GRADLE_PROPS\+=\(\n\s+"-PvandeUnityBinding=1"\n\s+"-PvandeUnityInvocationContract=\$INVOCATION_CONTRACT"\n\s+"-PvandeUnityInvocationId=\$INVOCATION_ID"\n\s+"-PvandeUnitySourceBuildId=\$BUILD_ID_START"\n\s+\)/u,
  );
  for (const argument of [
    '-Dfile.encoding=UTF-8',
    '-Duser.country=US',
    '-Duser.language=en',
    '-Duser.variant=',
  ]) {
    assert.equal(script.split(argument).length - 1, 1, `${argument} must occur exactly once`);
  }
});

test('transform enforces frozen task outputs and receipt-derived native origins', (t) => {
  const fixture = makeFixture(t);
  assert.doesNotThrow(() => validateTransformManifest(
    fixture.transform, fixture.receipt, fixture.contract, fixture.transform.contractSha256,
    fixture.nativeProvenanceBytes,
  ));
  const tasks = structuredClone(fixture.transform);
  tasks.taskOutputs = [':evil:a', ':evil:b', ':evil:c', ':evil:d'];
  assert.throws(() => validateTransformManifest(
    tasks, fixture.receipt, fixture.contract, tasks.contractSha256, fixture.nativeProvenanceBytes,
  ), /taskOutputs differs/u);
  const direct = structuredClone(fixture.transform);
  direct.natives.find((entry) => entry.path.endsWith('/libmain.so')).module.sha256 = digest('forged-direct-native');
  assert.throws(() => validateTransformManifest(
    direct, fixture.receipt, fixture.contract, direct.contractSha256, fixture.nativeProvenanceBytes,
  ), /mutated exhaustive receipt|differs from signed native provenance/u);
  const generated = structuredClone(fixture.transform);
  generated.natives.find((entry) => entry.path.endsWith('/libil2cpp.so')).origin.producerTask = ':evil:forge';
  assert.throws(() => validateTransformManifest(
    generated, fixture.receipt, fixture.contract, generated.contractSha256, fixture.nativeProvenanceBytes,
  ), /origin differs|differs from signed native provenance/u);
  const wrongAbi = structuredClone(fixture.transform);
  wrongAbi.natives[0].path = wrongAbi.natives[0].path.replace('arm64-v8a/', 'x86_64/');
  assert.throws(() => validateTransformManifest(
    wrongAbi, fixture.receipt, fixture.contract, wrongAbi.contractSha256, fixture.nativeProvenanceBytes,
  ), /native path is invalid/u);
});

test('buildPayloadBinding happy path binds both artifacts and strict verifier receipts', (t) => {
  const fixture = makeFixture(t);
  const sidecar = fixture.build();
  assert.equal(validatePayloadBindingSidecar(sidecar), sidecar);
  assert.equal(sidecar.schemaVersion, 2);
  assert.equal(sidecar.aab.signatureVerification.strictJarsigner.verifiedMarker, true);
  assert.equal(sidecar.aab.signatureVerification.strictJarsigner.targetSha256, sidecar.aab.sha256);
  assert.equal(sidecar.apk.signatureVerification.targetSha256, sidecar.apk.sha256);
});

test('archive binding accepts the known app native only under every safe ABI', (t) => {
  const fixture = makeFixture(t);
  fixture.writeArchives({
    apkExtras: Object.fromEntries(
      ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'].map((abi) => [
        `lib/${abi}/libdatastore_shared_counter.so`,
        Buffer.from(`host-native-${abi}`),
      ]),
    ),
  });
  assert.equal(validatePayloadBindingSidecar(fixture.build()).schemaVersion, 2);
});

test('archive binding rejects malformed, unsupported and unbound native inventory', async (t) => {
  const cases = [
    ['unsupported ABI', 'lib/mips/libdatastore_shared_counter.so', /native path is invalid/u],
    ['nested path', 'lib/arm64-v8a/nested/libdatastore_shared_counter.so', /native path is invalid/u],
    ['malformed library name', 'lib/arm64-v8a/notlib.so', /native path is invalid/u],
    ['unknown app library', 'lib/armeabi-v7a/libunknown.so', /unbound native/u],
    ['unbound Unity library', 'lib/armeabi-v7a/libunity.so', /unbound Unity native/u],
  ];
  for (const [label, path, expected] of cases) {
    await t.test(label, (child) => {
      const fixture = makeFixture(child);
      fixture.writeArchives({ apkExtras: { [path]: Buffer.from(label) } });
      assert.throws(() => fixture.build(), expected);
    });
  }
});

test('CLI bind happy path validates before exclusively writing a sidecar', (t) => {
  const fixture = makeFixture(t);
  const script = resolve('scripts/android-unity-payload-binding.mjs');
  const argv = [
    script, 'bind', '--apk', fixture.apkPath, '--aab', fixture.aabPath,
    '--contract', fixture.contractPath, '--transform-manifest', fixture.transformPath,
    '--receipt', fixture.receiptPath, '--source-build-id', fixture.contract.sourceBuildId,
    '--apksigner', fixture.apksigner, '--jarsigner', fixture.jarsigner,
    '--keytool', fixture.keytool, '--output', fixture.sidecarPath,
  ];
  const result = spawnSync(process.execPath, argv, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^UNITY_PAYLOAD_BINDING_OK/u);
  assert.equal(validatePayloadBindingSidecar(JSON.parse(readFileSync(fixture.sidecarPath, 'utf8'))).schemaVersion, 2);
  const again = spawnSync(process.execPath, argv, { encoding: 'utf8' });
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /output already exists/u);
});

test('bound Unity promotion rechecks the sidecar, APK, AAB and checksum as one set', async (t) => {
  await t.test('happy path', (child) => {
    const fixture = makeFixture(child);
    const sidecar = fixture.build();
    fixture.writeSidecar(sidecar);
    const checksumPath = join(fixture.root, 'SHA256SUMS-test.txt');
    writeFileSync(
      checksumPath,
      `${sidecar.apk.sha256}  ${sidecar.apk.fileName}\n`
        + `${sidecar.aab.sha256}  ${sidecar.aab.fileName}\n`
        + `${sha256Bytes(readFileSync(fixture.sidecarPath))}  ${basename(fixture.sidecarPath)}\n`,
    );
    const release = join(fixture.root, 'release');
    mkdirSync(release);
    const pairs = [fixture.apkPath, fixture.aabPath, fixture.sidecarPath, checksumPath]
      .map((source) => ({ source, target: join(release, basename(source)) }));
    assert.equal(promoteBoundUnitySet(pairs, fixture.sidecarPath).length, 4);
    assert.equal(readFileSync(join(release, sidecar.aab.fileName)).equals(readFileSync(fixture.aabPath)), true);
  });
  await t.test('AAB changed after sidecar creation', (child) => {
    const fixture = makeFixture(child);
    const sidecar = fixture.build();
    fixture.writeSidecar(sidecar);
    const checksumPath = join(fixture.root, 'SHA256SUMS-test.txt');
    writeFileSync(
      checksumPath,
      `${sidecar.apk.sha256}  ${sidecar.apk.fileName}\n`
        + `${sidecar.aab.sha256}  ${sidecar.aab.fileName}\n`
        + `${sha256Bytes(readFileSync(fixture.sidecarPath))}  ${basename(fixture.sidecarPath)}\n`,
    );
    const release = join(fixture.root, 'release');
    mkdirSync(release);
    const pairs = [fixture.apkPath, fixture.aabPath, fixture.sidecarPath, checksumPath]
      .map((source) => ({ source, target: join(release, basename(source)) }));
    assert.throws(
      () => promoteBoundUnitySet(pairs, fixture.sidecarPath, {
        beforePromotion: () => writeFileSync(fixture.aabPath, 'changed-after-bind'),
      }),
      /bound release-set identity/u,
    );
    for (const pair of pairs) assert.throws(() => readFileSync(pair.target), /ENOENT/u);
  });
});

test('build rejects a verifier swapped after contract creation', (t) => {
  const fixture = makeFixture(t);
  writeTool(fixture.apksigner, `printf 'Signer #1 certificate SHA-256 digest: ${fixture.signerDigest}\\n'\n# swapped`);
  assert.throws(() => fixture.build(), /signed apksigner identity differs/u);
});

test('apksigner parser accepts the SDK 37 scheme grammar and rejects ambiguity', () => {
  const first = digest('first signer');
  const second = digest('second signer');
  assert.equal(
    parseApkSignerReport(`V2 Signer: certificate SHA-256 digest: ${first}\n`),
    first,
  );
  assert.equal(
    parseApkSignerReport(
      `V2 Signer: certificate SHA-256 digest: ${first}\nV3 Signer: certificate SHA-256 digest: ${first}\n`,
    ),
    first,
  );
  assert.throws(
    () => parseApkSignerReport(
      `V2 Signer: certificate SHA-256 digest: ${first}\nV3 Signer: certificate SHA-256 digest: ${second}\n`,
    ),
    /conflict across schemes/u,
  );
  assert.throws(
    () => parseApkSignerReport(
      `V2 Signer: certificate SHA-256 digest: ${first}\nV2 Signer: certificate SHA-256 digest: ${first}\n`,
    ),
    /duplicates certificate digest/u,
  );
});

test('build detects an artifact replaced during external verification', (t) => {
  const fixture = makeFixture(t);
  writeTool(fixture.apksigner, `printf 'Signer #1 certificate SHA-256 digest: ${fixture.signerDigest}\\n'\nprintf 'mutated' > '${fixture.apkPath}'`);
  fixture.contract.verificationTools.apksigner = toolRecord(fixture.apksigner);
  writeCanonicalJson(fixture.contractPath, fixture.contract);
  fixture.rebindContract();
  assert.throws(() => fixture.build(), /apk final transaction identity changed|changed after its bound snapshot/u);
});

test('build detects AAB and receipt replacement during external verification', async (t) => {
  await t.test('AAB', (child) => {
    const fixture = makeFixture(child);
    writeTool(
      fixture.jarsigner,
      `${shellPrint(jarsignerFixtureReport())}\nprintf 'mutated-aab' > '${fixture.aabPath}'`,
    );
    fixture.contract.verificationTools.jarsigner = toolRecord(fixture.jarsigner);
    writeCanonicalJson(fixture.contractPath, fixture.contract);
    fixture.rebindContract();
    assert.throws(() => fixture.build(), /aab final transaction identity changed|changed after its bound snapshot/u);
  });
  await t.test('receipt', (child) => {
    const fixture = makeFixture(child);
    writeTool(
      fixture.apksigner,
      `printf 'Signer #1 certificate SHA-256 digest: ${fixture.signerDigest}\\n'\nprintf 'mutated-receipt' > '${fixture.receiptPath}'`,
    );
    fixture.contract.verificationTools.apksigner = toolRecord(fixture.apksigner);
    writeCanonicalJson(fixture.contractPath, fixture.contract);
    fixture.rebindContract();
    assert.throws(() => fixture.build(), /receipt final transaction identity changed|changed after its bound snapshot/u);
  });
});

test('build detects a verifier executable replaced during its own run', (t) => {
  const fixture = makeFixture(t);
  writeTool(fixture.apksigner, `printf 'Signer #1 certificate SHA-256 digest: ${fixture.signerDigest}\\n'\nprintf '#!/bin/sh\\nexit 9\\n' > "$0"`);
  fixture.contract.verificationTools.apksigner = toolRecord(fixture.apksigner);
  writeCanonicalJson(fixture.contractPath, fixture.contract);
  fixture.rebindContract();
  assert.throws(() => fixture.build(), /tool changed|changed after its bound snapshot/u);
});

test('build rejects forged AAB verification output and non-bound jarsigner binaries', async (t) => {
  await t.test('missing strict verified marker', (child) => {
    const fixture = makeFixture(child, { jarsignerBody: "printf 'forged report\\n'" });
    assert.throws(() => fixture.build(), /strict jarsigner/u);
  });
  await t.test('jarsigner swapped after contract', (child) => {
    const fixture = makeFixture(child);
    writeTool(fixture.jarsigner, "printf 'jar verified.\\n'\n# replacement");
    assert.throws(() => fixture.build(), /signed jarsigner identity differs/u);
  });
  await t.test('status 4 without explicit self-signed cause', (child) => {
    const fixture = makeFixture(child, {
      jarsignerBody: shellPrint(jarsignerFixtureReport({
        marker: 'jar verified, with signer errors.',
      }), 4),
    });
    assert.throws(() => fixture.build(), /strict jarsigner/u);
  });
  await t.test('status 4 with an additional expired-certificate warning', (child) => {
    const fixture = makeFixture(child, {
      jarsignerBody: shellPrint(
        `${jarsignerFixtureReport({
          marker: 'jar verified, with signer errors.', status4Profile: true,
        })}This jar contains entries whose signer certificate is expired.\n`,
        4,
      ),
    });
    assert.throws(() => fixture.build(), /strict jarsigner/u);
  });
  await t.test('sanitized real status-4 self-signed/invalid-chain output is bound', (child) => {
    const fixture = makeFixture(child, {
      jarsignerBody: shellPrint(jarsignerFixtureReport({
        marker: 'jar verified, with signer errors.', status4Profile: true,
      }), 4),
    });
    const sidecar = fixture.build();
    assert.equal(
      sidecar.aab.signatureVerification.strictJarsigner.classification,
      'VERIFIED_STRICT_STATUS_4_SELF_SIGNED_INVALID_CHAIN_ALL_CONTENT_SIGNED',
    );
    assert.equal(
      sidecar.aab.signatureVerification.strictJarsigner.requiredSignedEntryCount,
      FIXTURE_AAB_CONTENT_ENTRIES.length,
    );
  });
  await t.test('unsigned payload entry is rejected even with a verified marker', (child) => {
    const fixture = makeFixture(child, {
      jarsignerBody: shellPrint(jarsignerFixtureReport({
        unsignedEntry: 'base/assets/bin/Data/a',
      })),
    });
    assert.throws(() => fixture.build(), /did not prove signed content entry base\/assets\/bin\/Data\/a/u);
  });
  await t.test('keytool swapped after contract', (child) => {
    const fixture = makeFixture(child);
    writeTool(fixture.keytool, `${readFileSync(fixture.keytool, 'utf8')}\n# replacement`);
    assert.throws(() => fixture.build(), /signed keytool identity differs/u);
  });
});

test('sealed admission re-derives exact transform bytes and artifact payload', (t) => {
  const fixture = makeFixture(t);
  const sidecar = fixture.build();
  const sha = fixture.writeSidecar(sidecar);
  const admission = verifyExistingAndroidUnityPayloadBinding(fixture.admissionArgs(sha));
  assert.equal(admission.status, 'RE_DERIVED_LOCAL_INTEGRITY_NOT_CERTIFICATION');
  assert.equal(admission.apk.sha256, sidecar.apk.sha256);
});

test('sealed admission rejects a self-consistent native-origin sidecar forgery', (t) => {
  const fixture = makeFixture(t);
  const sidecar = fixture.build();
  const transform = JSON.parse(Buffer.from(sidecar.transformManifest.canonicalBase64, 'base64'));
  transform.natives.find((entry) => entry.path.endsWith('/libil2cpp.so')).origin.producerTask = ':forged:producer';
  const bytes = Buffer.from(`${stableStringify(transform)}\n`);
  sidecar.transformManifest.canonicalBase64 = bytes.toString('base64');
  sidecar.transformManifest.bytes = bytes.length;
  sidecar.transformManifest.sha256 = sha256Bytes(bytes);
  sidecar.material.natives = transform.natives;
  const sha = fixture.writeSidecar(sidecar);
  assert.throws(
    () => verifyExistingAndroidUnityPayloadBinding(fixture.admissionArgs(sha)),
    /origin differs|differs from signed native provenance/u,
  );
});

test('sealed admission rejects APK, sidecar, receipt and apksigner replacement', async (t) => {
  for (const kind of ['apk', 'sidecar', 'receipt', 'apksigner']) {
    await t.test(kind, (child) => {
      const fixture = makeFixture(child);
      const sidecar = fixture.build();
      const sha = fixture.writeSidecar(sidecar);
      if (kind === 'apk') writeFileSync(fixture.apkPath, 'changed');
      if (kind === 'sidecar') writeFileSync(fixture.sidecarPath, '{}\n');
      if (kind === 'receipt') writeFileSync(fixture.receiptPath, receiptFixture('-changed').bytes);
      if (kind === 'apksigner') writeTool(fixture.apksigner, 'exit 1');
      assert.throws(() => verifyExistingAndroidUnityPayloadBinding(fixture.admissionArgs(sha)));
    });
  }
});

test('sealed admission catches a sidecar mutated by the verifier during admission', (t) => {
  const fixture = makeFixture(t);
  writeTool(
    fixture.apksigner,
    `printf 'Signer #1 certificate SHA-256 digest: ${fixture.signerDigest}\\n'\n`
      + `if [ -f '${fixture.sidecarPath}' ]; then printf '{}\\n' > '${fixture.sidecarPath}'; fi`,
  );
  fixture.contract.verificationTools.apksigner = toolRecord(fixture.apksigner);
  writeCanonicalJson(fixture.contractPath, fixture.contract);
  fixture.rebindContract();
  const sidecar = fixture.build();
  const sha = fixture.writeSidecar(sidecar);
  assert.throws(
    () => verifyExistingAndroidUnityPayloadBinding(fixture.admissionArgs(sha)),
    /sidecar final admission identity changed|changed after its bound snapshot/u,
  );
});

test('payload binding remains explicitly local integrity, never certification', (t) => {
  const sidecar = makeFixture(t).build();
  assert.equal(sidecar.status, PAYLOAD_BINDING_STATUS);
  assert.equal(sidecar.limitation, LOCAL_PROVENANCE_LIMITATION);
});

test('AAB signer parser permits one signer only', () => {
  const fingerprint = '26:B1:3E:5A:0C:4D:2F:CB:05:5B:CD:FE:2B:D4:10:45:82:EA:1B:11:A3:9A:27:48:0E:16:98:2F:66:7B:85:A0';
  const report = `Signer #1:\n\nCertificate #1:\n SHA256: ${fingerprint}\n`;
  assert.equal(parseAabSignerReport(report), fingerprint.replaceAll(':', '').toLowerCase());
  assert.throws(() => parseAabSignerReport(`${report}Signer #2:\nCertificate #1:\n SHA256: ${fingerprint}\n`), /exactly one signer/u);
});
