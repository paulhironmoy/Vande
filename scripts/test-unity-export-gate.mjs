#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const wrapper = path.join(repoRoot, 'android', 'gradlew');
const projectVersionText = readFileSync(
  path.join(repoRoot, 'unity', 'VandePractice', 'ProjectSettings', 'ProjectVersion.txt'),
  'utf8',
);
const editorVersionMatch = projectVersionText.match(/^m_EditorVersion:\s*(\S+)\s*$/m);
if (!editorVersionMatch) throw new Error('Cannot read the approved Unity editor version');
const approvedEditorVersion = editorVersionMatch[1];
const approvedEditorRoot = path.join('/Applications/Unity/Hub/Editor', approvedEditorVersion);
const approvedAndroidSdk = path.join(approvedEditorRoot, 'PlaybackEngines', 'AndroidPlayer', 'SDK');
const scratch = mkdtempSync(path.join(tmpdir(), 'vande-unity-export-gate-'));
const androidRoot = path.join(scratch, 'android');
const unityProject = path.join(scratch, 'unity', 'VandePractice');
const exportRoot = path.join(unityProject, 'Builds', 'Android');
const libraryRoot = path.join(exportRoot, 'unityLibrary');
const receiptPath = path.join(exportRoot, '.vande-export.properties');
const importRoot = path.join(androidRoot, '.vande-unity-import');
const importedExportRoot = path.join(importRoot, 'Android');
const importedLibraryRoot = path.join(importedExportRoot, 'unityLibrary');
let modeChecksSupported = false;

function write(relative, contents) {
  const destination = path.join(scratch, relative);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, contents);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function regularFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const child of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, child.name);
      if (child.isSymbolicLink()) throw new Error(`fixture generator refuses symbolic link: ${absolute}`);
      if (child.isDirectory()) pending.push(absolute);
      else if (child.isFile()) files.push(absolute);
      else throw new Error(`fixture generator refuses non-regular entry: ${absolute}`);
    }
  }
  return files;
}

function manifest(base, files) {
  const entries = files
    .map((absolute) => {
      const relative = path.relative(base, absolute).split(path.sep).join('/');
      return {
        relative,
        encoded: Buffer.from(relative, 'utf8').toString('base64url'),
        executable: (statSync(absolute).mode & 0o111) === 0 ? '0' : '1',
        digest: sha256(readFileSync(absolute)),
      };
    })
    .sort((left, right) => (left.relative < right.relative ? -1 : left.relative > right.relative ? 1 : 0));
  const canonical = entries
    .map(
      (entry, index) =>
        `${String(index).padStart(6, '0')}\t${entry.executable}\t${entry.digest}\t${entry.encoded}\n`,
    )
    .join('');
  return { entries, digest: sha256(Buffer.from(canonical, 'utf8')) };
}

function exportFiles() {
  return regularFiles(exportRoot).filter(
    (absolute) => path.relative(exportRoot, absolute).split(path.sep).join('/') !== '.vande-export.properties',
  );
}

function createFixture() {
  rmSync(path.join(scratch, 'unity'), { recursive: true, force: true });
  write('unity/VandePractice/Assets/VandePractice/source.asset', 'practice-source\n');
  write('unity/VandePractice/Assets/Shared Content/sibling asset.asset', 'shared-source\n');
  write('unity/VandePractice/Packages/manifest.json', '{"dependencies":{}}\n');
  write(
    'unity/VandePractice/ProjectSettings/ProjectVersion.txt',
    `m_EditorVersion: ${approvedEditorVersion}\n`,
  );
  write(
    'unity/VandePractice/Builds/Android/unityLibrary/build.gradle',
    [
      "apply plugin: 'com.android.library'",
      "apply from: '../shared/common.gradle'",
      '',
      'android {',
      '    namespace "in.vande.receiptgate"',
      '    compileSdk 36',
      '    ndkPath getProperty("unity.androidNdkPath")',
      '    ndkVersion "27.2.12479018"',
      '    defaultConfig {',
      '        minSdk 28',
      '        ndk { abiFilters "arm64-v8a" }',
      '    }',
      '    externalNativeBuild {',
      '        cmake {',
      '            version "3.22.1"',
      '            path "src/main/cpp/CMakeLists.txt"',
      '        }',
      '    }',
      '}',
      '',
      "tasks.register('writeReceiptGateProof') {",
      "    def proof = layout.buildDirectory.file('receipt-gate-proof.txt')",
      '    outputs.file(proof)',
      '    doLast { proof.get().asFile.text = \'proof\\n\' }',
      '}',
      '',
      "tasks.register('holdReceiptGateLock') {",
      '    doLast {',
      '        println "VANDE_RECEIPT_GATE_LOCK_HELD"',
      '        Thread.sleep(10000)',
      '    }',
      '}',
      '',
      "tasks.register('simulateGeneratedUnityMutation') {",
      '    doLast {',
      '        [',
      '            "src/main/jniLibs/arm64-v8a/libil2cpp.so": "rebuilt-native\\n",',
      '            "symbols/arm64-v8a/libil2cpp.so": "generated-symbols\\n",',
      '            "build/il2cpp_arm64-v8a_Release/cache.bin": "generated-cache\\n",',
      '            "src/main/Il2CppOutputProject/Source/il2cppOutput/compile-data.json": "{}\\n"',
      '        ].each { relative, contents ->',
      '            def output = file(relative)',
      '            output.parentFile.mkdirs()',
      '            output.text = contents',
      '        }',
      '    }',
      '}',
      '',
      "tasks.register('simulateExportEscape') {",
      '    doLast {',
      `        file(${JSON.stringify(path.join(libraryRoot, 'escaped-output.bin'))}).text = "escaped\\n"`,
      '    }',
      '}',
      '',
      "tasks.register('simulateReceiptMutation') {",
      '    doLast {',
      `        file(${JSON.stringify(receiptPath)}).append("mutated=1\\n")`,
      '    }',
      '}',
      '',
    ].join('\n'),
  );
  write(
    'unity/VandePractice/Builds/Android/unityLibrary/src/main/AndroidManifest.xml',
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" />\n',
  );
  write(
    'unity/VandePractice/Builds/Android/unityLibrary/src/main/cpp/CMakeLists.txt',
    [
      'cmake_minimum_required(VERSION 3.22.1)',
      'project(vande_receipt_gate LANGUAGES C)',
      'add_library(vande_receipt_gate SHARED receipt_gate.c)',
      '',
    ].join('\n'),
  );
  write(
    'unity/VandePractice/Builds/Android/unityLibrary/src/main/cpp/receipt_gate.c',
    'int vande_receipt_gate(void) { return 1; }\n',
  );
  write('unity/VandePractice/Builds/Android/unityLibrary/src/main/jniLibs/arm64-v8a/libil2cpp.so', 'native\n');
  write('unity/VandePractice/Builds/Android/shared/common.gradle', 'ext.vandeReceiptGateShared = true\n');
  write('unity/VandePractice/Builds/Android/shared/tool script.sh', '#!/bin/sh\nexit 0\n');
  chmodSync(path.join(exportRoot, 'shared', 'tool script.sh'), 0o755);
  modeChecksSupported = (statSync(path.join(exportRoot, 'shared', 'tool script.sh')).mode & 0o111) !== 0;
  write('unity/VandePractice/Builds/Android/settings.gradle', '// generated root settings\n');
  write('unity/VandePractice/Builds/Android/gradle.properties', 'org.gradle.jvmargs=-Xmx512m\n');
  write('unity/VandePractice/Builds/Android/launcher/README.txt', 'not linked by the host\n');

  const sourceRoots = [
    path.join(unityProject, 'Assets'),
    path.join(unityProject, 'Packages'),
    path.join(unityProject, 'ProjectSettings'),
  ];
  const sourceManifest = manifest(unityProject, sourceRoots.flatMap(regularFiles));
  const exportManifest = manifest(exportRoot, exportFiles());
  const lines = [
    'schema=3',
    `editorVersion=${approvedEditorVersion}`,
    'target=Android',
    'scriptingBackend=IL2CPP',
    'architectures=ARM64',
    'minSdk=28',
    `sourceFileCount=${sourceManifest.entries.length}`,
    `sourceTreeSha256=${sourceManifest.digest}`,
    ...sourceManifest.entries.map(
      (entry, index) =>
        `sourceFile${String(index).padStart(6, '0')}=${entry.executable}:${entry.digest}:${entry.encoded}`,
    ),
    `exportFileCount=${exportManifest.entries.length}`,
    `exportTreeSha256=${exportManifest.digest}`,
    ...exportManifest.entries.map(
      (entry, index) =>
        `exportFile${String(index).padStart(6, '0')}=${entry.executable}:${entry.digest}:${entry.encoded}`,
    ),
  ];
  writeFileSync(receiptPath, `${lines.join('\n')}\n`);
}

function gateArgs(task = 'help') {
  const tasks = Array.isArray(task) ? task : [task];
  return [
    '--offline',
    '--no-daemon',
    '--console=plain',
    '--max-workers=2',
    '-p',
    androidRoot,
    '-PvandeUnity=1',
    ...tasks,
  ];
}

function runGate(task = 'help') {
  return spawnSync(
    wrapper,
    gateArgs(task),
    {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
}

async function expectExclusiveBuildLock() {
  const holder = spawn(wrapper, gateArgs(':unityLibrary:holdReceiptGateLock'), {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let markerSeen = false;
  let resolveMarker;
  let rejectMarker;
  const marker = new Promise((resolve, reject) => {
    resolveMarker = resolve;
    rejectMarker = reject;
  });
  const append = (chunk) => {
    output += chunk.toString();
    if (!markerSeen && output.includes('VANDE_RECEIPT_GATE_LOCK_HELD')) {
      markerSeen = true;
      resolveMarker();
    }
  };
  holder.stdout.on('data', append);
  holder.stderr.on('data', append);
  holder.on('error', (error) => rejectMarker(error));
  const exit = new Promise((resolve) => {
    holder.on('close', (status, signal) => resolve({ status, signal }));
  });
  holder.on('close', (status, signal) => {
    if (!markerSeen) {
      rejectMarker(
        new Error(`lock holder exited before marker (status=${status}, signal=${signal})\n${output}`),
      );
    }
  });

  let timer;
  try {
    await Promise.race([
      marker,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out waiting for lock holder\n${output}`)), 30_000);
      }),
    ]);
  } catch (error) {
    const holderResult = await exit;
    throw new Error(`${error.message}\nlock holder result=${JSON.stringify(holderResult)}`, { cause: error });
  } finally {
    clearTimeout(timer);
  }

  const contender = runGate('help');
  const contenderOutput = `${contender.stdout ?? ''}\n${contender.stderr ?? ''}`;
  const holderResult = await exit;
  if (holderResult.status !== 0) {
    throw new Error(`lock holder failed: ${JSON.stringify(holderResult)}\n${output}`);
  }
  if (contender.error) throw contender.error;
  if (
    contender.status === 0 ||
    !/already using the shared staged\/native build roots/.test(contenderOutput)
  ) {
    throw new Error(
      `concurrent Gradle invocation was not rejected (status=${contender.status})\n${contenderOutput}`,
    );
  }
  process.stdout.write('PASS concurrent Gradle invocation is rejected by the exclusive build lock\n');
}

function expectGate(label, expectedSuccess, pattern, task = 'help') {
  const result = runGate(task);
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (result.error) throw result.error;
  if ((result.status === 0) !== expectedSuccess) {
    throw new Error(`${label}: unexpected Gradle status ${result.status}\n${output}`);
  }
  if (pattern && !pattern.test(output)) {
    throw new Error(`${label}: output did not match ${pattern}\n${output}`);
  }
  process.stdout.write(`PASS ${label}\n`);
}

try {
  mkdirSync(androidRoot, { recursive: true });
  cpSync(path.join(repoRoot, 'android', 'settings.gradle'), path.join(androidRoot, 'settings.gradle'));
  write(
    'android/build.gradle',
    [
      'buildscript {',
      '    repositories { google(); mavenCentral() }',
      '    dependencies { classpath "com.android.tools.build:gradle:8.13.0" }',
      '}',
      'tasks.register("clean", Delete) {',
      '    delete rootProject.layout.buildDirectory',
      '}',
      '',
    ].join('\n'),
  );
  write('android/local.properties', `sdk.dir=${approvedAndroidSdk}\n`);
  write('android/capacitor.settings.gradle', '// intentionally empty fixture include list\n');
  mkdirSync(path.join(androidRoot, 'app'), { recursive: true });
  mkdirSync(path.join(androidRoot, 'capacitor-cordova-android-plugins'), { recursive: true });

  createFixture();
  const immutableExportBefore = manifest(exportRoot, exportFiles());
  expectGate(
    'root clean preserves the staged project and the module still runs',
    true,
    undefined,
    ['clean', ':unityLibrary:writeReceiptGateProof'],
  );
  if (existsSync(path.join(libraryRoot, 'build'))) {
    throw new Error('Unity module intermediates were written into the receipt-covered export');
  }
  if (!existsSync(path.join(androidRoot, 'build', 'unityLibrary', 'receipt-gate-proof.txt'))) {
    throw new Error('Unity module intermediates were not redirected to android/build/unityLibrary');
  }
  if (!existsSync(path.join(importedExportRoot, 'shared', 'common.gradle'))) {
    throw new Error('The complete Unity export siblings were not copied into the staged import');
  }
  for (const stagedRelative of [
    'settings.gradle',
    'gradle.properties',
    'launcher/README.txt',
    'shared/tool script.sh',
  ]) {
    if (!existsSync(path.join(importedExportRoot, stagedRelative))) {
      throw new Error(`Complete export entry was not staged: ${stagedRelative}`);
    }
  }
  if (existsSync(path.join(importedExportRoot, '.vande-export.properties'))) {
    throw new Error('The self-referential export receipt must not be copied into the staged import');
  }
  if (!existsSync(path.join(importRoot, '.build.lock'))) {
    throw new Error('The exclusive Unity build lock was not created in the staging ancestor');
  }
  if (existsSync(path.join(importedExportRoot, '.build.lock'))) {
    throw new Error('The exclusive Unity build lock must not be inside the staged Android subtree');
  }
  if (
    modeChecksSupported &&
    (statSync(path.join(importedExportRoot, 'shared', 'tool script.sh')).mode & 0o111) === 0
  ) {
    throw new Error('Executable attributes were not preserved in the staged import');
  }
  await expectExclusiveBuildLock();
  expectGate(
    'native debug and release intermediates are redirected',
    true,
    undefined,
    [':unityLibrary:externalNativeBuildDebug', ':unityLibrary:externalNativeBuildRelease'],
  );
  if (existsSync(path.join(libraryRoot, '.cxx'))) {
    throw new Error('AGP native intermediates were written into the receipt-covered export');
  }
  const nativeBuildRoot = path.join(androidRoot, 'build', 'vande-unity-native', 'cxx');
  if (!existsSync(nativeBuildRoot) || regularFiles(nativeBuildRoot).length === 0) {
    throw new Error('AGP native intermediates were not redirected to android/build/vande-unity-native/cxx');
  }
  expectGate(
    'projectDir mutations are confined to the staged import',
    true,
    undefined,
    ':unityLibrary:simulateGeneratedUnityMutation',
  );
  if (readFileSync(path.join(libraryRoot, 'src/main/jniLibs/arm64-v8a/libil2cpp.so'), 'utf8') !== 'native\n') {
    throw new Error('The immutable export native library was overwritten');
  }
  if (
    readFileSync(
      path.join(importedLibraryRoot, 'src/main/jniLibs/arm64-v8a/libil2cpp.so'),
      'utf8',
    ) !== 'rebuilt-native\n'
  ) {
    throw new Error('The simulated Unity native output did not land in the staged import');
  }
  for (const generated of [
    'symbols/arm64-v8a/libil2cpp.so',
    'build/il2cpp_arm64-v8a_Release/cache.bin',
    'src/main/Il2CppOutputProject/Source/il2cppOutput/compile-data.json',
  ]) {
    if (!existsSync(path.join(importedLibraryRoot, generated))) {
      throw new Error(`Expected staged Unity mutation is missing: ${generated}`);
    }
    if (existsSync(path.join(libraryRoot, generated))) {
      throw new Error(`Generated Unity output escaped into the immutable export: ${generated}`);
    }
  }
  const immutableExportAfter = manifest(exportRoot, exportFiles());
  if (immutableExportAfter.digest !== immutableExportBefore.digest) {
    throw new Error('A module build changed the immutable Unity export tree');
  }
  expectGate('receipt remains valid after a module build', true);
  const refreshedImport = manifest(importedExportRoot, regularFiles(importedExportRoot));
  if (refreshedImport.digest !== immutableExportBefore.digest) {
    throw new Error('The next gate did not refresh the staged import from the immutable export');
  }

  createFixture();
  expectGate(
    'post-build export mutation is rejected immediately',
    false,
    /mutated receipt-covered Unity input/,
    ':unityLibrary:simulateExportEscape',
  );

  createFixture();
  expectGate(
    'post-build receipt mutation is rejected immediately',
    false,
    /mutated the immutable Unity export receipt/,
    ':unityLibrary:simulateReceiptMutation',
  );

  createFixture();
  write('unity/VandePractice/Builds/Android/unexpected root.bin', 'unexpected\n');
  expectGate('unexpected export file is rejected', false, /unexpected=.*unexpected root\.bin/);

  createFixture();
  unlinkSync(path.join(exportRoot, 'launcher', 'README.txt'));
  expectGate('missing export sibling is rejected', false, /missing=.*launcher\/README\.txt/);

  createFixture();
  write('unity/VandePractice/Builds/Android/unityLibrary/src/main/jniLibs/arm64-v8a/libil2cpp.so', 'changed\n');
  expectGate('modified export content is rejected', false, /contains modified files/);

  createFixture();
  write('unity/VandePractice/Assets/Shared Content/sibling asset.asset', 'tampered-source\n');
  expectGate('asset sibling tamper is rejected', false, /source contains modified files/);

  createFixture();
  write('unity/VandePractice/Packages/unexpected package.json', '{}\n');
  expectGate('unexpected source file is rejected', false, /source file set changed.*unexpected=/s);

  createFixture();
  unlinkSync(path.join(unityProject, 'Assets', 'Shared Content', 'sibling asset.asset'));
  expectGate('missing source file is rejected', false, /source file set changed.*missing=/s);

  if (modeChecksSupported) {
    createFixture();
    chmodSync(path.join(exportRoot, 'shared', 'tool script.sh'), 0o644);
    expectGate('changed executable flag is rejected', false, /modified executable flags/);
  } else {
    process.stdout.write('SKIP executable flag mutation (filesystem has no executable-mode support)\n');
  }

  createFixture();
  const absoluteEncoded = Buffer.from('/tmp/receipt-escape', 'utf8').toString('base64url');
  const absoluteReceipt = readFileSync(receiptPath, 'utf8').replace(
    /^(exportFile\d{6}=([01]):([0-9a-f]{64}):)[A-Za-z0-9_-]+$/m,
    `$1${absoluteEncoded}`,
  );
  writeFileSync(receiptPath, absoluteReceipt);
  expectGate('absolute receipt path is rejected', false, /non-canonical relative path/);

  createFixture();
  const c1ControlEncoded = Buffer.from('launcher/\u0085escape', 'utf8').toString('base64url');
  const c1ControlReceipt = readFileSync(receiptPath, 'utf8').replace(
    /^(exportFile\d{6}=([01]):([0-9a-f]{64}):)[A-Za-z0-9_-]+$/m,
    `$1${c1ControlEncoded}`,
  );
  writeFileSync(receiptPath, c1ControlReceipt);
  expectGate('C1 control in receipt path is rejected', false, /non-canonical relative path/);

  createFixture();
  symlinkSync(
    path.join(unityProject, 'Packages', 'manifest.json'),
    path.join(unityProject, 'Assets', 'VandePractice', 'linked-source.json'),
  );
  expectGate('source-tree symbolic link is rejected', false, /rejects symbolic links/);

  createFixture();
  symlinkSync(libraryRoot, path.join(exportRoot, 'linked-launcher'), 'dir');
  expectGate('export-tree symbolic link is rejected', false, /rejects symbolic links/);

  createFixture();
  const fifoPath = path.join(exportRoot, 'launcher', 'special.pipe');
  const fifo = spawnSync('mkfifo', [fifoPath], { encoding: 'utf8' });
  if (fifo.status === 0) {
    expectGate('export-tree special file is rejected', false, /rejects non-regular filesystem entries/);
  } else {
    process.stdout.write('SKIP special-file rejection (mkfifo unavailable)\n');
  }

  createFixture();
  rmSync(importRoot, { recursive: true, force: true });
  write('outside-staging-ancestor/marker.txt', 'do-not-touch\n');
  const outsideAncestor = path.join(scratch, 'outside-staging-ancestor');
  symlinkSync(outsideAncestor, importRoot, 'dir');
  expectGate(
    'symlinked staging ancestor is rejected without traversal',
    false,
    /Refusing symbolic link in Unity staging ancestor/,
  );
  if (readFileSync(path.join(outsideAncestor, 'marker.txt'), 'utf8') !== 'do-not-touch\n') {
    throw new Error('Rejected staging-ancestor link modified its external target');
  }
  unlinkSync(importRoot);

  createFixture();
  mkdirSync(importRoot, { recursive: false });
  write('outside-staging-root/marker.txt', 'do-not-touch\n');
  const outsideRoot = path.join(scratch, 'outside-staging-root');
  symlinkSync(outsideRoot, importedExportRoot, 'dir');
  expectGate(
    'symlinked staging root is rejected without traversal',
    false,
    /Refusing symbolic link in Unity staging root/,
  );
  if (readFileSync(path.join(outsideRoot, 'marker.txt'), 'utf8') !== 'do-not-touch\n') {
    throw new Error('Rejected staging-root link modified its external target');
  }
  unlinkSync(importedExportRoot);

  rmSync(importRoot, { recursive: true, force: true });
  writeFileSync(importRoot, 'not-a-directory\n');
  expectGate(
    'non-directory staging ancestor is rejected',
    false,
    /Refusing non-directory entry in Unity staging ancestor/,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
