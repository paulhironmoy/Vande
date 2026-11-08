import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CAMERA_FEATURES,
  CAMERA_PERMISSION,
  DEFAULT_MAX_MIN_SDK,
  DEFAULT_REQUIRED_ABIS,
  MIN_16_KB_ALIGNMENT,
  evaluateBadging,
  findOptionalPayloads,
  nativeCodeConsistency,
  nativeEntries,
  parseArgs,
  parseArchiveEntries,
  parseBadging,
  parseElfLoadAlignments,
  payloadChecks,
} from './check-android-release-compat.mjs';

const GOOD_BADGING = `package: name='in.vande.cricket' versionCode='1' versionName='1.0.0'
minSdkVersion:'28'
targetSdkVersion:'36'
feature-group: label=''
  uses-feature: name='android.hardware.faketouch'
  uses-implied-feature: name='android.hardware.faketouch' reason='default feature for all apps'
uses-feature-not-required: name='android.hardware.vulkan.level'
launchable-activity: name='in.vande.cricket.MainActivity' label='VANDE Cricket' icon=''
supports-screens: 'small' 'normal' 'large' 'xlarge'
supports-any-density: 'true'
native-code: 'arm64-v8a' 'armeabi-v7a' 'x86' 'x86_64'
`;

function elf64(loadAlignments) {
  const headerSize = 64;
  const programEntrySize = 56;
  const buffer = Buffer.alloc(headerSize + programEntrySize * loadAlignments.length);
  buffer[0] = 0x7f;
  buffer.write('ELF', 1, 'ascii');
  buffer[4] = 2;
  buffer[5] = 1;
  buffer.writeBigUInt64LE(BigInt(headerSize), 32);
  buffer.writeUInt16LE(programEntrySize, 54);
  buffer.writeUInt16LE(loadAlignments.length, 56);
  loadAlignments.forEach((alignment, index) => {
    const offset = headerSize + index * programEntrySize;
    buffer.writeUInt32LE(1, offset);
    buffer.writeBigUInt64LE(BigInt(alignment), offset + 48);
  });
  return buffer;
}

function elf32(loadAlignments) {
  const headerSize = 52;
  const programEntrySize = 32;
  const buffer = Buffer.alloc(headerSize + programEntrySize * loadAlignments.length);
  buffer[0] = 0x7f;
  buffer.write('ELF', 1, 'ascii');
  buffer[4] = 1;
  buffer[5] = 1;
  buffer.writeUInt32LE(headerSize, 28);
  buffer.writeUInt16LE(programEntrySize, 42);
  buffer.writeUInt16LE(loadAlignments.length, 44);
  loadAlignments.forEach((alignment, index) => {
    const offset = headerSize + index * programEntrySize;
    buffer.writeUInt32LE(1, offset);
    buffer.writeUInt32LE(alignment, offset + 28);
  });
  return buffer;
}

describe('Android static release compatibility policy', () => {
  it('defaults to the API 28 floor and both material ARM ABIs', () => {
    const options = parseArgs([]);
    assert.equal(options.maxMinSdk, DEFAULT_MAX_MIN_SDK);
    assert.deepEqual(options.requiredAbis, DEFAULT_REQUIRED_ABIS);
  });

  it('parses the merged artifact badging and accepts the current safe shape', () => {
    const badging = parseBadging(GOOD_BADGING);
    assert.equal(badging.packageId, 'in.vande.cricket');
    assert.equal(badging.minSdk, 28);
    assert.equal(badging.targetSdk, 36);
    assert.deepEqual(badging.requiredFeatures, ['android.hardware.faketouch']);
    assert.deepEqual(badging.impliedFeatures, ['android.hardware.faketouch']);
    assert.deepEqual(badging.optionalFeatures, ['android.hardware.vulkan.level']);
    assert.equal(evaluateBadging(badging).pass, true);
  });

  it('fails if the merged minSdk rises above 28', () => {
    const evaluation = evaluateBadging(parseBadging(GOOD_BADGING.replace("minSdkVersion:'28'", "minSdkVersion:'29'")));
    assert.equal(evaluation.pass, false);
    assert.equal(evaluation.checks.find((check) => check.id === 'min-sdk')?.pass, false);
  });

  it('fails required or permission-implied hardware filters but allows optional features', () => {
    for (const line of [
      "uses-feature: name='android.hardware.camera'",
      "uses-implied-feature: name='android.hardware.location.gps' reason='permission'",
    ]) {
      const evaluation = evaluateBadging(parseBadging(`${GOOD_BADGING}${line}\n`));
      assert.equal(evaluation.checks.find((check) => check.id === 'required-hardware-features')?.pass, false);
    }
    const optional = evaluateBadging(parseBadging(`${GOOD_BADGING}uses-feature-not-required: name='android.hardware.camera'\n`));
    assert.equal(optional.pass, true);
  });

  it('fails OpenGL or texture-format install filters', () => {
    const gl = evaluateBadging(parseBadging(`${GOOD_BADGING}uses-feature-gl-es: '0x00030000'\n`));
    const texture = evaluateBadging(parseBadging(`${GOOD_BADGING}supports-gl-texture: 'GL_COMPRESSED_RGBA_ASTC_4x4_KHR'\n`));
    assert.equal(gl.checks.find((check) => check.id === 'required-gl-version')?.pass, false);
    assert.equal(texture.checks.find((check) => check.id === 'required-texture-format')?.pass, false);
  });

  it('fails narrowed screen support and a debuggable release', () => {
    const narrowed = GOOD_BADGING.replace("supports-screens: 'small' 'normal' 'large' 'xlarge'", "supports-screens: 'normal' 'large'");
    const evaluation = evaluateBadging(parseBadging(`${narrowed}application-debuggable\n`));
    assert.equal(evaluation.checks.find((check) => check.id === 'screen-buckets')?.pass, false);
    assert.equal(evaluation.checks.find((check) => check.id === 'not-debuggable')?.pass, false);
  });

  it('requires exactly the VANDE MainActivity launcher', () => {
    const duplicate = parseBadging(`${GOOD_BADGING}launchable-activity: name='com.unity3d.player.UnityPlayerGameActivity' label='Unity' icon=''\n`);
    const duplicateEvaluation = evaluateBadging(duplicate);
    assert.deepEqual(duplicate.launchableActivities, [
      'in.vande.cricket.MainActivity',
      'com.unity3d.player.UnityPlayerGameActivity',
    ]);
    assert.equal(duplicateEvaluation.checks.find((check) => check.id === 'launchable-activity')?.pass, false);

    const wrong = evaluateBadging(parseBadging(GOOD_BADGING.replace(
      'in.vande.cricket.MainActivity',
      'com.example.OtherActivity',
    )));
    assert.equal(wrong.checks.find((check) => check.id === 'launchable-activity')?.pass, false);
  });

  it('fails maxSdk, compatible-screen and required shared-library install filters', () => {
    const evaluation = evaluateBadging(parseBadging(`${GOOD_BADGING}
maxSdkVersion:'35'
compatible-screens: 'normal/320'
uses-library:'com.example.device.only'
`));
    assert.equal(evaluation.checks.find((check) => check.id === 'max-sdk')?.pass, false);
    assert.equal(evaluation.checks.find((check) => check.id === 'compatible-screen-filter')?.pass, false);
    assert.equal(evaluation.checks.find((check) => check.id === 'required-shared-libraries')?.pass, false);
  });

  it('fails required native-library filters but allows explicitly optional native libraries', () => {
    const optional = parseBadging(`${GOOD_BADGING}
uses-native-library-not-required:'libOpenCL.so'
uses-native-library-not-required:'libOpenCL.so'
`);
    assert.deepEqual(optional.requiredNativeLibraries, []);
    assert.deepEqual(optional.optionalNativeLibraries, ['libOpenCL.so']);
    assert.equal(evaluateBadging(optional).pass, true);

    const required = parseBadging(`${GOOD_BADGING}uses-native-library:'libOpenCL.so'\n`);
    assert.deepEqual(required.requiredNativeLibraries, ['libOpenCL.so']);
    const evaluation = evaluateBadging(required);
    assert.equal(evaluation.pass, false);
    assert.equal(evaluation.checks.find((check) => check.id === 'required-native-libraries')?.pass, false);
  });

  it('accepts repeatable ABI overrides and rejects invalid policy inputs', () => {
    assert.deepEqual(parseArgs(['--require-abi', 'arm64-v8a', '--require-abi', 'arm64-v8a']).requiredAbis, ['arm64-v8a']);
    assert.throws(() => parseArgs(['--max-min-sdk', '0']), /positive integer/u);
    assert.throws(() => parseArgs(['--package', 'in.vande;bad']), /invalid Android package id/u);
    assert.throws(() => parseArgs(['--require-abi', '../arm64']), /invalid ABI/u);
  });

  it('maps native libraries in both APK and AAB layouts', () => {
    assert.deepEqual(nativeEntries([
      'lib/arm64-v8a/libgame.so',
      'base/lib/armeabi-v7a/libgame.so',
      'base/assets/not-native.so',
    ]), [
      { entry: 'lib/arm64-v8a/libgame.so', abi: 'arm64-v8a', library: 'libgame.so' },
      { entry: 'base/lib/armeabi-v7a/libgame.so', abi: 'armeabi-v7a', library: 'libgame.so' },
    ]);
    assert.equal(nativeCodeConsistency(['arm64-v8a', 'armeabi-v7a'], ['armeabi-v7a', 'arm64-v8a']).pass, true);
    assert.equal(nativeCodeConsistency(['arm64-v8a'], ['arm64-v8a', 'armeabi-v7a']).pass, false);
  });

  it('rejects duplicate and unsafe archive entries', () => {
    assert.throws(() => parseArchiveEntries('base/lib/a/libx.so\nbase/lib/a/libx.so\n'), /duplicate/u);
    assert.throws(() => parseArchiveEntries('../lib/a/libx.so\n'), /unsafe/u);
  });

  it('reads 16 KB PT_LOAD alignment from ELF64 and ELF32 files', () => {
    assert.deepEqual(parseElfLoadAlignments(elf64([MIN_16_KB_ALIGNMENT, 0x10000])), [0x4000, 0x10000]);
    assert.deepEqual(parseElfLoadAlignments(elf32([MIN_16_KB_ALIGNMENT])), [0x4000]);
  });

  it('exposes sub-16 KB ELF alignment for the release gate to reject', () => {
    const alignments = parseElfLoadAlignments(elf64([0x1000, MIN_16_KB_ALIGNMENT]));
    assert.equal(alignments.every((alignment) => alignment >= MIN_16_KB_ALIGNMENT), false);
  });

  it('rejects non-ELF and truncated program-header data', () => {
    assert.throws(() => parseElfLoadAlignments(Buffer.alloc(64)), /not an ELF/u);
    assert.throws(() => parseElfLoadAlignments(elf64([MIN_16_KB_ALIGNMENT]).subarray(0, 70)), /truncated/u);
  });
});

/**
 * Real `aapt2 dump badging` output (build-tools 37.0.0, 2026-11-08T08:28Z) of five tiny manifests with minSdk 28 and target 36
 * (release/product-sequence/stage-3-chase/ANDROID/phaseA/aapt-lab): the CAMERA permission alone, with the three camera features
 * declared not required, with only two of them, and with RECORD_AUDIO.
 */
const AAPT_CAMERA_ONLY = `package: name='in.vande.cricket' versionCode='1' versionName='1.0' platformBuildVersionName='16' platformBuildVersionCode='36' compileSdkVersion='36' compileSdkVersionCodename='16'
minSdkVersion:'28'
targetSdkVersion:'36'
uses-permission: name='android.permission.INTERNET'
uses-permission: name='android.permission.CAMERA'
application: label='x' icon=''
launchable-activity: name='in.vande.cricket.MainActivity'  label='' icon=''
feature-group: label=''
  uses-feature: name='android.hardware.camera'
  uses-implied-feature: name='android.hardware.camera' reason='requested android.permission.CAMERA permission'
  uses-feature: name='android.hardware.faketouch'
  uses-implied-feature: name='android.hardware.faketouch' reason='default feature for all apps'
main
supports-screens: 'small' 'normal' 'large' 'xlarge'
supports-any-density: 'true'
locales:
densities:
`;
const AAPT_CAMERA_OPTIONAL = `package: name='in.vande.cricket' versionCode='1' versionName='1.0' platformBuildVersionName='16' platformBuildVersionCode='36' compileSdkVersion='36' compileSdkVersionCodename='16'
minSdkVersion:'28'
targetSdkVersion:'36'
uses-permission: name='android.permission.INTERNET'
uses-permission: name='android.permission.CAMERA'
application: label='x' icon=''
launchable-activity: name='in.vande.cricket.MainActivity'  label='' icon=''
feature-group: label=''
  uses-feature-not-required: name='android.hardware.camera'
  uses-feature-not-required: name='android.hardware.camera.autofocus'
  uses-feature-not-required: name='android.hardware.camera.front'
  uses-feature: name='android.hardware.faketouch'
  uses-implied-feature: name='android.hardware.faketouch' reason='default feature for all apps'
main
supports-screens: 'small' 'normal' 'large' 'xlarge'
supports-any-density: 'true'
locales:
densities:
`;
const AAPT_CAMERA_TWO_FEATURES = `package: name='in.vande.cricket' versionCode='1' versionName='1.0' platformBuildVersionName='16' platformBuildVersionCode='36' compileSdkVersion='36' compileSdkVersionCodename='16'
minSdkVersion:'28'
targetSdkVersion:'36'
uses-permission: name='android.permission.INTERNET'
uses-permission: name='android.permission.CAMERA'
application: label='x' icon=''
launchable-activity: name='in.vande.cricket.MainActivity'  label='' icon=''
feature-group: label=''
  uses-feature-not-required: name='android.hardware.camera'
  uses-feature-not-required: name='android.hardware.camera.front'
  uses-feature: name='android.hardware.faketouch'
  uses-implied-feature: name='android.hardware.faketouch' reason='default feature for all apps'
main
supports-screens: 'small' 'normal' 'large' 'xlarge'
supports-any-density: 'true'
locales:
densities:
`;
const AAPT_AUDIO_TOO = `package: name='in.vande.cricket' versionCode='1' versionName='1.0' platformBuildVersionName='16' platformBuildVersionCode='36' compileSdkVersion='36' compileSdkVersionCodename='16'
minSdkVersion:'28'
targetSdkVersion:'36'
uses-permission: name='android.permission.CAMERA'
uses-permission: name='android.permission.RECORD_AUDIO'
application: label='x' icon=''
launchable-activity: name='in.vande.cricket.MainActivity'  label='' icon=''
feature-group: label=''
  uses-feature-not-required: name='android.hardware.camera'
  uses-feature-not-required: name='android.hardware.camera.autofocus'
  uses-feature-not-required: name='android.hardware.camera.front'
  uses-feature: name='android.hardware.faketouch'
  uses-implied-feature: name='android.hardware.faketouch' reason='default feature for all apps'
  uses-feature: name='android.hardware.microphone'
  uses-implied-feature: name='android.hardware.microphone' reason='requested android.permission.RECORD_AUDIO permission'
main
supports-screens: 'small' 'normal' 'large' 'xlarge'
supports-any-density: 'true'
locales:
densities:
`;

function failing(evaluation) {
  return evaluation.checks.filter((check) => !check.pass).map((check) => check.id);
}

describe('Android camera permission policy (optional camera batting)', () => {
  it('reads the permissions out of the merged badging', () => {
    const badging = parseBadging(AAPT_CAMERA_OPTIONAL);
    assert.ok(badging.permissions.includes(CAMERA_PERMISSION));
    assert.ok(badging.permissions.includes('android.permission.INTERNET'));
    assert.deepEqual(parseBadging(`${GOOD_BADGING}uses-permission-sdk-23: name='android.permission.CAMERA'\n`).permissions, [CAMERA_PERMISSION]);
  });

  it('fails the CAMERA permission alone: aapt2 makes the back camera a required feature (real aapt2 output)', () => {
    const badging = parseBadging(AAPT_CAMERA_ONLY);
    assert.deepEqual(badging.impliedFeatures.sort(), ['android.hardware.camera', 'android.hardware.faketouch']);
    const failedIds = failing(evaluateBadging(badging));
    assert.ok(failedIds.includes('required-hardware-features'));
    assert.ok(failedIds.includes('camera-permission-shape'));
  });

  it('passes CAMERA with the three camera features declared not required (real aapt2 output)', () => {
    const evaluation = evaluateBadging(parseBadging(AAPT_CAMERA_OPTIONAL));
    assert.deepEqual(failing(evaluation), []);
    assert.equal(evaluation.pass, true);
    assert.deepEqual(parseBadging(AAPT_CAMERA_OPTIONAL).optionalFeatures.sort(), [...CAMERA_FEATURES].sort());
  });

  it('also requires autofocus: Android says CAMERA implies it, even though aapt2 37 does not print it', () => {
    const evaluation = evaluateBadging(parseBadging(AAPT_CAMERA_TWO_FEATURES));
    assert.deepEqual(failing(evaluation), ['camera-permission-shape']);
    const shape = evaluation.checks.find((check) => check.id === 'camera-permission-shape');
    assert.deepEqual(shape?.observed, {
      cameraFeaturesNotDeclaredOptional: ['android.hardware.camera.autofocus'],
      forbiddenPermissions: [],
    });
  });

  it('fails RECORD_AUDIO: nothing records sound and it would add a required microphone', () => {
    const failedIds = failing(evaluateBadging(parseBadging(AAPT_AUDIO_TOO)));
    assert.ok(failedIds.includes('required-hardware-features'));
    assert.ok(failedIds.includes('camera-permission-shape'));
    const onlyPermission = evaluateBadging(parseBadging(`${GOOD_BADGING}uses-permission: name='android.permission.RECORD_AUDIO'\n`));
    assert.deepEqual(failing(onlyPermission), ['camera-permission-shape']);
  });

  it('does not constrain a build that declares no camera permission', () => {
    const evaluation = evaluateBadging(parseBadging(GOOD_BADGING));
    assert.equal(evaluation.checks.find((check) => check.id === 'camera-permission-shape')?.pass, true);
    assert.equal(evaluation.pass, true);
  });
});

describe('Android optional payload placement (camera pack and baked venue)', () => {
  const base = [
    'AndroidManifest.xml',
    'classes.dex',
    'assets/public/index.html',
    'assets/public/assets/index-AbC123.js',
    'assets/bin/Data/data.unity3d',
    'lib/arm64-v8a/libunity.so',
  ];
  const cameraApk = [
    'assets/public/models/pose/0.10.35-ab12cd34/engine.bin',
    'assets/public/models/pose/0.10.35-ab12cd34/MANIFEST.json',
  ];
  const venueApk = ['assets/public/assets/venue-p-Hq81xZ.glb'];

  it('finds the camera pack and venue files in both the APK and the AAB layout', () => {
    assert.deepEqual(findOptionalPayloads(base), { camera: [], venue: [] });
    assert.deepEqual(findOptionalPayloads([...base, ...cameraApk, ...venueApk]), { camera: cameraApk, venue: venueApk });
    const aab = [...cameraApk, ...venueApk].map((entry) => `base/${entry}`);
    assert.deepEqual(findOptionalPayloads(aab), {
      camera: cameraApk.map((entry) => `base/${entry}`),
      venue: venueApk.map((entry) => `base/${entry}`),
    });
  });

  it('catches the pose files under any folder or name of the web payload, but leaves Unity data alone', () => {
    const sneaky = [
      'assets/public/assets/pose_landmarker_lite.task',
      'assets/public/vision_wasm_internal.wasm',
      'assets/public/lib/vision_wasm_nosimd_internal.js',
    ];
    assert.deepEqual(findOptionalPayloads(sneaky).camera, sneaky);
    assert.deepEqual(findOptionalPayloads(['assets/bin/Data/Managed/model.task', 'assets/bin/Data/venue.glb']), { camera: [], venue: [] });
  });

  it('fails a default build that carries either payload', () => {
    const entries = [...base, ...cameraApk, ...venueApk];
    const checks = payloadChecks('apk', entries);
    assert.deepEqual(checks.map((check) => [check.id, check.pass]), [['apk-camera-payload', false], ['apk-venue-payload', false]]);
    assert.ok(payloadChecks('aab', entries.map((entry) => `base/${entry}`)).every((check) => !check.pass));
    assert.ok(payloadChecks('apk', base).every((check) => check.pass));
  });

  it('allows a payload only when that sideload payload is named, and never the other one', () => {
    const entries = [...base, ...cameraApk, ...venueApk];
    const cameraOnly = payloadChecks('apk', entries, { camera: true });
    assert.deepEqual(cameraOnly.map((check) => [check.id, check.pass]), [['apk-camera-payload', true], ['apk-venue-payload', false]]);
    assert.ok(payloadChecks('apk', entries, { camera: true, venue: true }).every((check) => check.pass));
  });

  it('takes the allow flags only from the command line and defaults to a default build', () => {
    assert.equal(parseArgs([]).allowCameraPayload, false);
    assert.equal(parseArgs([]).allowVenuePayload, false);
    const sideload = parseArgs(['--allow-camera-payload', '--allow-venue-payload']);
    assert.equal(sideload.allowCameraPayload, true);
    assert.equal(sideload.allowVenuePayload, true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// The camera permission helper (ruling R-14, DoD AND-07): three methods, no capture code, no file writes. These tests read the
// Java and manifest sources, so a later change that adds a capture path or widens the helper fails here, not in review.
// ---------------------------------------------------------------------------------------------------------------------------

const ANDROID_MAIN = fileURLToPath(new URL('../android/app/src/main/', import.meta.url));

function javaFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return javaFiles(path);
    return entry.name.endsWith('.java') ? [path] : [];
  });
}

/** The code of a Java file without its comments, so a comment may talk about what the code must not do. */
function codeOf(path) {
  return readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

const CAPTURE_APIS = [
  /\bMediaRecorder\b/u,
  /\bImageCapture\b/u,
  /\bandroidx\.camera\b/u,
  /\bCameraX\b/u,
  /\bandroid\.hardware\.camera2\b/u,
  /\bandroid\.hardware\.Camera\b/u,
  /\bImageReader\b/u,
  /\bAudioRecord\b/u,
  /\bMediaStore\.ACTION_(?:IMAGE|VIDEO)_CAPTURE\b/u,
];

describe('Android native code: the camera permission helper holds no capture path', () => {
  const helperPath = join(ANDROID_MAIN, 'java/in/vande/cricket/plugins/CameraAccessPlugin.java');

  it('uses no capture or recording API anywhere in the app code', () => {
    const offenders = javaFiles(join(ANDROID_MAIN, 'java')).flatMap((path) => {
      const code = codeOf(path);
      return CAPTURE_APIS.filter((pattern) => pattern.test(code)).map((pattern) => `${path.slice(ANDROID_MAIN.length)}: ${pattern}`);
    });
    assert.deepEqual(offenders, []);
  });

  it('has patterns that really recognise the capture APIs (so a clean scan means something)', () => {
    const samples = [
      'import android.media.MediaRecorder;',
      'ImageCapture capture;',
      'import androidx.camera.core.Camera;',
      'import android.hardware.camera2.CameraManager;',
      'android.hardware.Camera camera = Camera.open();',
      'ImageReader.newInstance(1, 1, 1, 1);',
      'new AudioRecord(1, 2, 3, 4, 5);',
      'new Intent(MediaStore.ACTION_VIDEO_CAPTURE);',
    ];
    for (const sample of samples) assert.ok(CAPTURE_APIS.some((pattern) => pattern.test(sample)), sample);
    assert.ok(!CAPTURE_APIS.some((pattern) => pattern.test('import android.provider.Settings;')));
  });

  it('exposes exactly getStatus, request and openSettings, with one permission callback', () => {
    const code = codeOf(helperPath);
    const methods = [...code.matchAll(/@PluginMethod\s+public void (\w+)\(PluginCall/gu)].map((match) => match[1]);
    assert.deepEqual(methods, ['getStatus', 'request', 'openSettings']);
    assert.deepEqual([...code.matchAll(/@PermissionCallback\s+private void (\w+)\(PluginCall/gu)].map((match) => match[1]), ['afterRequest']);
    assert.match(code, /name = "VandeCameraAccess"/u);
  });

  it('asks for the camera permission only, writes no file and keeps no state of its own', () => {
    const code = codeOf(helperPath);
    assert.deepEqual([...new Set([...code.matchAll(/Manifest\.permission\.(\w+)/gu)].map((match) => match[1]))], ['CAMERA']);
    for (const pattern of [/\bFileOutputStream\b/u, /\bFileWriter\b/u, /\bopenFileOutput\b/u, /\bgetExternalFilesDir\b/u, /\bgetFilesDir\b/u, /\bgetCacheDir\b/u, /\bSharedPreferences\b/u, /\bMediaStore\b/u]) {
      assert.doesNotMatch(code, pattern);
    }
  });

  it('is registered with the other local plugins before the bridge starts', () => {
    const activity = readFileSync(join(ANDROID_MAIN, 'java/in/vande/cricket/MainActivity.java'), 'utf8');
    const bridgeStart = activity.indexOf('super.onCreate(savedInstanceState);');
    for (const plugin of ['CameraAccessPlugin', 'SystemGesturesPlugin']) {
      const registration = activity.indexOf(`registerPlugin(${plugin}.class);`);
      assert.ok(registration > 0, `registerPlugin(${plugin}.class) is missing`);
      assert.ok(registration < bridgeStart, `${plugin} must be registered before super.onCreate`);
    }
  });

  it('keeps the gesture exclusion plugin to one method, with no capture, storage or permission', () => {
    const code = codeOf(join(ANDROID_MAIN, 'java/in/vande/cricket/plugins/SystemGesturesPlugin.java'));
    assert.deepEqual([...code.matchAll(/@PluginMethod\s+public void (\w+)\(PluginCall/gu)].map((match) => match[1]), ['setBattingExclusion']);
    assert.match(code, /name = "VandeSystemGestures"/u);
    assert.doesNotMatch(code, /Manifest\.permission|FileOutputStream|SharedPreferences|getFilesDir|getCacheDir|getExternalFilesDir/u);
  });

  it('keeps the source manifest in the shape the merged-manifest check enforces', () => {
    const manifest = readFileSync(join(ANDROID_MAIN, 'AndroidManifest.xml'), 'utf8').replace(/<!--[\s\S]*?-->/gu, '');
    assert.match(manifest, /<uses-permission android:name="android\.permission\.CAMERA" \/>/u);
    for (const feature of CAMERA_FEATURES) {
      assert.ok(manifest.includes(`<uses-feature android:name="${feature}" android:required="false" />`), `${feature} must be declared not required`);
    }
    assert.doesNotMatch(manifest, /RECORD_AUDIO|MODIFY_AUDIO_SETTINGS/u);
  });
});
