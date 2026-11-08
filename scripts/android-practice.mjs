// Android Practice smoke, lifecycle and optional performance diagnostics. Run through android-practice.sh.
// The default Stage 0 path is production-like: no Practice test API, no seeded storage, no forced outcomes, and
// no app-data clearing. Existing innings are resumed and completed rather than overwritten.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir, loadavg, uptime as osUptime } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { _android as android } from 'playwright-core';
import { resolveAndroidAdbEndpoint } from './android-adb-endpoint.mjs';
import { parseRotation, parseWmSize } from './android-device.mjs';
import {
  assessUnityRenderer,
  immersiveConfirmationAction,
  inspectUnityAdmissionSource,
  normalizeNativeAvailability,
  retainUnityNativeEvidenceEvent,
  retainUnityNativeListenerRegistration,
  validBuildId,
} from './android-evidence.mjs';
import {
  assertGateAFirstBallConfiguration,
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
} from './android-gate-a.mjs';
import {
  createGateACaptureAttempt,
  createGateACaptureReceiptCandidate,
  finalizeGateACaptureAttempt,
  GATE_A_RAW_EVIDENCE_MAX_BYTES,
  gateAEvidenceFileRecord,
  gateANextAttemptUtc,
  recordGateACaptureAttemptCheckpoint,
  recordGateACaptureAttemptError,
  writeGateABoundedRawEvidence,
  writeFinalGateACaptureAttempt,
  writeInitialGateACaptureAttempt,
} from './android-gate-a-attempt.mjs';
import {
  collectAndroidDeviceIdentity,
  sameAndroidDeviceIdentity,
  validateAndroidDeviceIdentity,
  validateAndroidDeviceIdentityReceipt,
} from './android-device-identity.mjs';
import {
  validateInstallTransaction,
  validatePackageAbsenceReceipt,
} from './android-gate-a-receipt.mjs';
import { snapshotArtifactIdentity } from './android-sealed-artifact.mjs';
import {
  GATE_A_SEALED_WRAPPER_RECORD_BASENAMES,
  validateGateAUnityPayloadAdmission,
  validateGateAUnitySourceBracket,
} from './android-gate-a-unity-admission.mjs';
import {
  GATE_A_MEASUREMENT_LIMITATION,
  assertSamePackageDataEpoch,
  validateBracketedStorageStatsMeasurement,
  validatePackageDataEpochCapture,
} from './android-package-data-epoch.mjs';
import { assessStableSamples, parseStorageStats } from './android-installed-size.mjs';
import {
  parseExactInstalledApkHashOutput,
  parseExactInstalledPackagePathOutput,
} from './android-installed-package-inventory.mjs';
import { externalRequests, inningsKey, installObserver, playMeasured, summarise } from './perf/android-frames.mjs';

const OUT = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'release/practice-android';
const flag = (name) => process.argv.includes(`--${name}`);
const val = (name, fallback) => process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback;
const PERF = flag('perf');
const PATIENCE_MS = Number(val('patience', 90)) * 1000;
const N = Number(val('deliveries', 6));
const LABEL = val('label', 'default');
const PKG = 'in.vande.cricket';
const HOOKS = process.env.HOOKS === '1';
const UNITY_REQUESTED = process.env.UNITY === '1';
const ALLOW_UNITY_FALLBACK = flag('allow-unity-fallback');
const EXPECTED_BUILD_ID = process.env.EXPECTED_BUILD_ID ?? '';
const SKIPPED_BUILD = process.env.SKIP_BUILD === '1';
const GATE_A_FIRST_BALL = flag('gate-a-first-ball');
const ARTIFACT_MODE = process.env.ARTIFACT_MODE ?? 'debug';
const ADB_ENDPOINT = resolveAndroidAdbEndpoint(process.env, { sealed: ARTIFACT_MODE === 'sealed' });
const REQUIRE_PACKAGE_ABSENT = process.env.REQUIRE_PACKAGE_ABSENT === '1';
const SEALED_APK_PATH = process.env.SEALED_APK_PATH ?? '';
const EXPECTED_APK_SHA256 = process.env.EXPECTED_APK_SHA256 ?? '';
const UNITY_PAYLOAD_BINDING_PATH = process.env.UNITY_PAYLOAD_BINDING_PATH ?? '';
const EXPECTED_UNITY_PAYLOAD_BINDING_SHA256 = process.env.EXPECTED_UNITY_PAYLOAD_BINDING_SHA256 ?? '';
const GATE_A_SIZE_LIMIT_BYTES = 50_000_000n;
const ADB_PATH = resolve(
  process.env.ANDROID_HOME
    || process.env.ANDROID_SDK_ROOT
    || join(homedir(), 'Library/Android/sdk'),
  'platform-tools/adb',
);
const UNITY_EVENT_LIMIT = 256;
const UNITY_EVENT_REGISTRATION_LIMIT = 16;
const UNITY_EVENT_STRING_LIMITS = Object.freeze({ operationId: 128, type: 64, deliveryId: 128, code: 64, detail: 256 });
const UNITY_LOGCAT_LINE_LIMIT = 128;
const UNITY_LOGCAT_CHAR_LIMIT = 512;
const log = (...args) => console.log(new Date().toISOString().slice(11, 19), ...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const host = (command, args = []) => {
  try { return execFileSync(command, args, { encoding: 'utf8' }).trim(); } catch { return ''; }
};
if (!validBuildId(EXPECTED_BUILD_ID)) {
  throw new Error('EXPECTED_BUILD_ID must be the exact repository identity embedded in the installed Android bundle. Run this harness through scripts/android-practice.sh.');
}
assertGateAFirstBallConfiguration({
  enabled: GATE_A_FIRST_BALL,
  hooks: HOOKS,
  unityRequested: UNITY_REQUESTED,
  allowUnityFallback: ALLOW_UNITY_FALLBACK,
  skipLifecycle: flag('skip-lifecycle'),
  perf: PERF,
  recheck: flag('recheck'),
  artifactMode: ARTIFACT_MODE,
  requirePackageAbsent: REQUIRE_PACKAGE_ABSENT,
  apkPath: SEALED_APK_PATH,
  expectedApkSha256: EXPECTED_APK_SHA256,
  expectedBuildId: EXPECTED_BUILD_ID,
  unityPayloadBindingPath: UNITY_PAYLOAD_BINDING_PATH,
  expectedUnityPayloadBindingSha256: EXPECTED_UNITY_PAYLOAD_BINDING_SHA256,
});
const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const sha256Bytes = (value) => createHash('sha256').update(value).digest('hex');
const lightweightHostUptime = () => `node:os uptime ${osUptime().toFixed(3)}s, load averages: ${loadavg().map((value) => value.toFixed(2)).join(' ')}`;
const writeNew = (path, value) => writeFileSync(path, value, { flag: 'wx', mode: 0o600 });
const writeGateAEvidenceManifest = (directory, unityPayloadBinding) => {
  const root = resolve(directory);
  const output = join(root, 'evidence-manifest.json');
  if (existsSync(output)) throw new Error(`refusing to overwrite Gate-A evidence manifest ${output}`);
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Gate-A evidence tree contains a symbolic link: ${path}`);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        const record = {
          path: relative(root, path),
          bytes: String(statSync(path).size),
          sha256: sha256File(path),
        };
        files.push(record);
      } else throw new Error(`Gate-A evidence tree contains an unsupported entry: ${path}`);
    }
  };
  walk(root);
  files.sort((left, right) => left.path.localeCompare(right.path));
  writeFileSync(output, `${JSON.stringify({
    schemaVersion: 1,
    status: 'GATE_A_EVIDENCE_MANIFEST_COMPLETE',
    recordedUtc: new Date().toISOString(),
    unityPayloadBinding,
    files,
  }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
};
if (GATE_A_FIRST_BALL) {
  if (!SKIPPED_BUILD) throw new Error('--gate-a-first-ball requires the wrapper sealed skip-build path');
  if (!existsSync(SEALED_APK_PATH) || !statSync(SEALED_APK_PATH).isFile()) throw new Error('sealed APK is unavailable to the harness');
  if (sha256File(SEALED_APK_PATH) !== EXPECTED_APK_SHA256) throw new Error('sealed APK changed after host-side admission');
}

mkdirSync(OUT, { recursive: true });
const finalReportPath = `${OUT}/android-${LABEL}.json`;
const gateACaptureThenTapAttemptPath = `${OUT}/capture-then-tap-attempt.json`;
const gateACaptureThenTapJournalPath = `${OUT}/capture-then-tap-attempt-journal.ndjson`;
const gateACaptureThenTapFinalPath = `${OUT}/capture-then-tap-attempt-final.json`;
const gateATransactionStdoutPath = `${OUT}/capture-then-tap-transaction.stdout.bin`;
const gateATransactionStderrPath = `${OUT}/capture-then-tap-transaction.stderr.bin`;
const gateARawCapturePath = `${OUT}/capture-then-tap-remote-capture.bin`;
const gateARawCaptureStderrPath = `${OUT}/capture-then-tap-remote-capture.stderr.bin`;
if (existsSync(finalReportPath)) throw new Error(`refusing to overwrite Android evidence report ${finalReportPath}`);
const sourceBuildIdAtStart = host('scripts/build-id.sh');
if (GATE_A_FIRST_BALL && sourceBuildIdAtStart !== EXPECTED_BUILD_ID) {
  throw new Error(`current source ${sourceBuildIdAtStart || 'missing'} changed after sealed admission; expected ${EXPECTED_BUILD_ID}`);
}
const admissionSource = inspectUnityAdmissionSource(readFileSync(
  'android/app/src/main/java/in/vande/cricket/unity/UnityPracticeHost.java',
  'utf8',
));
const results = {
  label: LABEL,
  buildId: EXPECTED_BUILD_ID,
  expectedBuildId: EXPECTED_BUILD_ID,
  sourceBuildIdAtHarnessStart: sourceBuildIdAtStart,
  skippedBuild: SKIPPED_BUILD,
  startedUtc: new Date().toISOString(),
  hostUptime: host('uptime'),
  adbServer: {
    host: ADB_ENDPOINT.host,
    port: ADB_ENDPOINT.port,
    classification: ARTIFACT_MODE === 'sealed' ? 'DEDICATED_LOOPBACK_ENDPOINT' : 'LOCAL_ENDPOINT',
  },
  method: 'installed Android WebView; visible UI setup; adb input taps for deliveries',
  hooksRequested: HOOKS,
  unityRequested: UNITY_REQUESTED,
  unityFallbackAllowed: ALLOW_UNITY_FALLBACK,
  gateAFirstBall: GATE_A_FIRST_BALL,
  artifactMode: ARTIFACT_MODE,
  sealedArtifact: GATE_A_FIRST_BALL ? {
    path: SEALED_APK_PATH,
    sha256: EXPECTED_APK_SHA256,
  } : null,
  checks: [],
  webErrors: [],
  unityNativeEvents: {
    classification: 'UNVERIFIED_BOUNDED_DIAGNOSTIC_METADATA',
    scope: 'Independent Capacitor listener metadata only; packet bodies, message ids, payloads and gesture coordinates are never retained.',
    maxEvents: UNITY_EVENT_LIMIT,
    stringLimits: UNITY_EVENT_STRING_LIMITS,
    events: [],
    droppedEvents: 0,
    registrations: [],
    droppedRegistrations: 0,
  },
  nativeAdmissionOrdering: {
    classification: 'STATIC_SOURCE_ONLY',
    sourceBuildId: sourceBuildIdAtStart,
    appliesToInstalledIdentity: sourceBuildIdAtStart === EXPECTED_BUILD_ID,
    ordered: admissionSource.ordered,
    positions: admissionSource.positions,
    scope: 'Written source order of linked/ABI/graphics/memory gates before reflective verification. This is not runtime or physical proof that Class.forName or native loading did not occur.',
  },
};
if (GATE_A_FIRST_BALL) {
  const wrapperFiles = Object.fromEntries(
    Object.entries(GATE_A_SEALED_WRAPPER_RECORD_BASENAMES)
      .map(([name, basename]) => [name, `${OUT}/${basename}`]),
  );
  for (const [name, path] of Object.entries(wrapperFiles)) {
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`sealed wrapper evidence ${name} is missing`);
  }
  const expectedAdbIsolation = [
    `host=${ADB_ENDPOINT.host}`,
    `port=${ADB_ENDPOINT.port}`,
    `serial=${process.env.ANDROID_SERIAL}`,
    `inventory=${process.env.ANDROID_SERIAL} device`,
    `pre-playwright-inventory=${process.env.ANDROID_SERIAL} device`,
    '',
  ].join('\n');
  if (readFileSync(wrapperFiles.adbIsolation, 'utf8') !== expectedAdbIsolation) {
    throw new Error('sealed wrapper did not bind Playwright to the exact one-device ADB endpoint');
  }
  results.adbServer.isolationReceipt = wrapperFiles.adbIsolation;
  const admission = JSON.parse(readFileSync(wrapperFiles.admission, 'utf8'));
  const preinstallStdout = readFileSync(wrapperFiles.preinstallStdout, 'utf8');
  const preinstallStderr = readFileSync(wrapperFiles.preinstallStderr, 'utf8');
  const preinstallStatus = readFileSync(wrapperFiles.preinstallStatus, 'utf8').trim();
  const installStdout = readFileSync(wrapperFiles.installStdout, 'utf8');
  const installStderr = readFileSync(wrapperFiles.installStderr, 'utf8');
  const installStatus = readFileSync(wrapperFiles.installStatus, 'utf8').trim();
  if (admission?.status !== 'SEALED_ARTIFACT_ADMITTED_FOR_ENGINEERING_EVIDENCE'
      || admission?.sourceBuildId !== EXPECTED_BUILD_ID
      || admission?.artifact?.path !== SEALED_APK_PATH
      || admission?.artifact?.sha256 !== EXPECTED_APK_SHA256) {
    throw new Error('sealed wrapper admission report does not bind the same artifact/build/path');
  }
  const absenceClassification = classifyPmPathAbsence({
    status: Number(preinstallStatus),
    stdout: preinstallStdout,
    stderr: preinstallStderr,
  });
  const absenceReceipt = JSON.parse(readFileSync(wrapperFiles.packageAbsence, 'utf8'));
  const absenceErrors = validatePackageAbsenceReceipt(absenceReceipt);
  if (!absenceClassification.absent || absenceErrors.length) {
    throw new Error(`sealed wrapper did not prove exact package absence: ${absenceClassification.reason ?? absenceErrors.join('; ')}`);
  }
  if (installStatus !== '0' || !/(?:^|\n)Success(?:\n|$)/u.test(installStdout) || installStderr !== '') {
    throw new Error('sealed wrapper install evidence did not record one successful adb install -r');
  }
  const installStart = JSON.parse(readFileSync(wrapperFiles.installTransactionStart, 'utf8'));
  const installTransaction = JSON.parse(readFileSync(wrapperFiles.installTransaction, 'utf8'));
  const unityPayloadBindingAdmission = JSON.parse(readFileSync(wrapperFiles.unityPayloadBindingAdmissionFile, 'utf8'));
  const unityPayloadBindingAdmissionSourceBracket = JSON.parse(readFileSync(wrapperFiles.unityPayloadBindingAdmissionSourceBracketFile, 'utf8'));
  const unityPayloadBindingPreinstallRecheck = JSON.parse(readFileSync(wrapperFiles.unityPayloadBindingPreinstallRecheckFile, 'utf8'));
  const unityPayloadBindingPreinstallSourceBracket = JSON.parse(readFileSync(wrapperFiles.unityPayloadBindingPreinstallSourceBracketFile, 'utf8'));
  const unityPayloadBindingFinalRecheck = JSON.parse(readFileSync(wrapperFiles.unityPayloadBindingFinalRecheckFile, 'utf8'));
  const unityPayloadBindingFinalSourceBracket = JSON.parse(readFileSync(wrapperFiles.unityPayloadBindingFinalSourceBracketFile, 'utf8'));
  const unityExpected = {
    sourceBuildId: EXPECTED_BUILD_ID,
    sidecarPath: UNITY_PAYLOAD_BINDING_PATH,
    sidecarSha256: EXPECTED_UNITY_PAYLOAD_BINDING_SHA256,
    apkPath: SEALED_APK_PATH,
    apkSha256: EXPECTED_APK_SHA256,
    apkFileName: SEALED_APK_PATH.split('/').at(-1),
  };
  for (const [label, payload, sourceBracket, admissionPath] of [
    [
      'initial', unityPayloadBindingAdmission, unityPayloadBindingAdmissionSourceBracket,
      wrapperFiles.unityPayloadBindingAdmissionFile,
    ],
    [
      'install-start recheck', unityPayloadBindingPreinstallRecheck, unityPayloadBindingPreinstallSourceBracket,
      wrapperFiles.unityPayloadBindingPreinstallRecheckFile,
    ],
    [
      'final preinstall recheck', unityPayloadBindingFinalRecheck, unityPayloadBindingFinalSourceBracket,
      wrapperFiles.unityPayloadBindingFinalRecheckFile,
    ],
  ]) {
    const payloadErrors = validateGateAUnityPayloadAdmission(payload, unityExpected);
    if (payloadErrors.length) throw new Error(`${label} Unity payload admission rejected: ${payloadErrors.join('; ')}`);
    const bracketErrors = validateGateAUnitySourceBracket(sourceBracket, payload, {
      sourceBuildId: EXPECTED_BUILD_ID,
      admissionPath: resolve(admissionPath),
    });
    if (bracketErrors.length) throw new Error(`${label} Unity payload source bracket rejected: ${bracketErrors.join('; ')}`);
  }
  if (JSON.stringify(unityPayloadBindingAdmission) !== JSON.stringify(unityPayloadBindingPreinstallRecheck)
      || JSON.stringify(unityPayloadBindingAdmission) !== JSON.stringify(unityPayloadBindingFinalRecheck)) {
    throw new Error('full Unity payload verifier objects differ across sealed admission and both preinstall rechecks');
  }
  const installErrors = validateInstallTransaction({
    start: installStart,
    transaction: installTransaction,
    expected: {
      serial: process.env.ANDROID_SERIAL,
      packageId: PKG,
      buildId: EXPECTED_BUILD_ID,
      artifactSha256: EXPECTED_APK_SHA256,
    },
  });
  if (installErrors.length) throw new Error(`sealed install transaction rejected: ${installErrors.join('; ')}`);
  const currentArtifact = snapshotArtifactIdentity(SEALED_APK_PATH);
  const admittedArtifact = {
    path: admission.artifact.path,
    sha256: admission.artifact.sha256,
    identity: admission.artifact.identity,
    parentIdentity: admission.artifact.parentIdentity,
  };
  if (JSON.stringify(currentArtifact) !== JSON.stringify(admittedArtifact)) throw new Error('private admitted artifact identity changed after install');
  const preinstallDeviceReport = JSON.parse(readFileSync(wrapperFiles.preinstallDeviceIdentity, 'utf8'));
  if (validateAndroidDeviceIdentityReceipt(preinstallDeviceReport).length
      || validateAndroidDeviceIdentity(preinstallDeviceReport?.identity).length
      || !sameAndroidDeviceIdentity(preinstallDeviceReport.identity, installTransaction.deviceIdentity)) {
    throw new Error('preinstall device identity is invalid or not bound to the install transaction');
  }
  results.sealedWrapperEvidence = Object.fromEntries(Object.entries(wrapperFiles).map(([name, path]) => [name, {
    path,
    sha256: sha256File(path),
    bytes: String(statSync(path).size),
  }]));
  results.sealedWrapperEvidence.packageAbsentBeforeInstall = true;
  results.sealedWrapperEvidence.packageAbsencePolicy = absenceClassification.policy;
  results.sealedWrapperEvidence.installOperation = installTransaction.operation;
  results.sealedWrapperEvidence.runId = installTransaction.runId;
  results.sealedWrapperEvidence.installTransactionReceipt = installTransaction;
  results.sealedWrapperEvidence.deviceIdentity = installTransaction.deviceIdentity;
  results.sealedWrapperEvidence.artifactIdentity = admittedArtifact;
  results.sealedWrapperEvidence.unityPayloadBinding = {
    expectedSidecar: {
      path: UNITY_PAYLOAD_BINDING_PATH,
      sha256: EXPECTED_UNITY_PAYLOAD_BINDING_SHA256,
    },
    admission: unityPayloadBindingAdmission,
    admissionSourceBracket: unityPayloadBindingAdmissionSourceBracket,
    preinstallRecheck: unityPayloadBindingPreinstallRecheck,
    preinstallSourceBracket: unityPayloadBindingPreinstallSourceBracket,
    finalRecheck: unityPayloadBindingFinalRecheck,
    finalSourceBracket: unityPayloadBindingFinalSourceBracket,
    admissionFile: results.sealedWrapperEvidence.unityPayloadBindingAdmissionFile,
    admissionSourceBracketFile: results.sealedWrapperEvidence.unityPayloadBindingAdmissionSourceBracketFile,
    preinstallRecheckFile: results.sealedWrapperEvidence.unityPayloadBindingPreinstallRecheckFile,
    preinstallSourceBracketFile: results.sealedWrapperEvidence.unityPayloadBindingPreinstallSourceBracketFile,
    finalRecheckFile: results.sealedWrapperEvidence.unityPayloadBindingFinalRecheckFile,
    finalSourceBracketFile: results.sealedWrapperEvidence.unityPayloadBindingFinalSourceBracketFile,
  };
}
const connected = [];
let device;
let page;
let logcatSince = '';
let airplaneEnabled = false;
let fatal;
let pageEpoch = 0;
let intentionalStopEpoch = null;
let battingGeometry = null;
let unityRendererChecked = false;
let immersiveConfirmationHandled = false;
let gateAFirstBallPending = null;
let gateACaptureThenTapAttempt = null;
let gateAPreverifiedDeviceIdentity = null;
let finalizeGateAStorageStats = null;
let recordAppProcess = async () => null;

const check = (name, ok, expected = '', observed = '') => {
  results.checks.push({ name, ok, expected, observed });
  log(ok ? '✓' : '✗', name, observed);
  return ok;
};

const boundedString = (value, max, nullable = false) => {
  if (typeof value !== 'string' || value.length === 0) return nullable ? null : '';
  return value.slice(0, max);
};

/** Copy only the documented, bounded metadata fields from an untrusted page binding. Never retain a packet/payload. */
const recordUnityNativeEvent = (epoch, value) => {
  retainUnityNativeEvidenceEvent(results.unityNativeEvents, {
    epoch,
    value,
    limits: UNITY_EVENT_STRING_LIMITS,
    capturedUtc: new Date().toISOString(),
    maxEvents: UNITY_EVENT_LIMIT,
  });
};

const recordUnityListenerRegistration = (entry) => {
  retainUnityNativeListenerRegistration(
    results.unityNativeEvents,
    entry,
    UNITY_EVENT_REGISTRATION_LIMIT,
  );
};

try {
  if (ARTIFACT_MODE === 'sealed') {
    const wanted = process.env.ANDROID_SERIAL;
    const inventory = spawnSync(ADB_PATH, ['devices'], { encoding: 'utf8', env: process.env });
    const attached = inventory.stdout
      .split(/\r?\n/u)
      .slice(1)
      .filter((line) => line.trim() !== '');
    if (inventory.status !== 0 || inventory.stderr !== '' || attached.length !== 1 || attached[0] !== `${wanted}\tdevice`) {
      throw new Error('sealed Playwright preflight requires exactly its selected ready device on the dedicated ADB endpoint');
    }
    results.adbServer.prePlaywrightInventory = attached[0];
  }
  connected.push(...await android.devices({ host: ADB_ENDPOINT.host, port: ADB_ENDPOINT.port }));
  const wanted = process.env.ANDROID_SERIAL;
  if (wanted) device = connected.find((candidate) => candidate.serial() === wanted);
  else if (connected.length === 1) [device] = connected;
  if (!device) {
    const found = connected.map((candidate) => candidate.serial()).join(', ') || 'none';
    throw new Error(wanted
      ? `ANDROID_SERIAL=${wanted} is not available to Playwright (found: ${found})`
      : `exactly one Android device is required; set ANDROID_SERIAL when several are attached (found: ${found})`);
  }

  const shellRaw = (command) => device.shell(command).then((buffer) => buffer.toString());
  const shell = (command) => shellRaw(command).then((output) => output.trim());
  recordAppProcess = async (label) => {
    const raw = await shell(`pidof ${PKG}`).catch(() => '');
    const pids = raw.split(/\s+/u).filter((value) => /^[1-9][0-9]*$/u.test(value)).slice(0, 4);
    const observation = { label: boundedString(label, 96), pids, utc: new Date().toISOString() };
    (results.appProcessTimeline ??= []).push(observation);
    return observation;
  };
  const readPackageInstallIdentity = async () => {
    const packageDump = await shell(`dumpsys package ${PKG}`);
    const firstInstallTime = packageDump.match(/^\s*firstInstallTime=(.+)$/mu)?.[1]?.trim() ?? null;
    const lastUpdateTime = packageDump.match(/^\s*lastUpdateTime=(.+)$/mu)?.[1]?.trim() ?? null;
    if (!firstInstallTime || !lastUpdateTime) throw new Error('package firstInstallTime or lastUpdateTime is unavailable');
    return { firstInstallTime, lastUpdateTime };
  };
  const assertPackageInstallIdentity = (observed, label) => {
    if (JSON.stringify(observed) !== JSON.stringify(results.packageInstallIdentity)) {
      throw new Error(`package install/update identity changed ${label}`);
    }
  };
  logcatSince = await shell("date '+%m-%d %H:%M:%S.000'");
  results.logcatSince = logcatSince;
  results.deviceIdentityInitial = await collectAndroidDeviceIdentity({ serial: device.serial(), shell });
  results.device = {
    ...results.deviceIdentityInitial,
    // Retain the historical report key while the canonical identity uses an
    // unambiguous name that cannot be confused with the VANDE build ID.
    buildId: results.deviceIdentityInitial.androidBuildId,
  };
  if (GATE_A_FIRST_BALL) {
    const initialIdentityErrors = validateAndroidDeviceIdentity(results.deviceIdentityInitial);
    if (initialIdentityErrors.length) {
      throw new Error(`initial Android identity is invalid: ${initialIdentityErrors.join('; ')}`);
    }
    if (!sameAndroidDeviceIdentity(results.deviceIdentityInitial, results.sealedWrapperEvidence.deviceIdentity)) {
      throw new Error('Android identity changed between the install transaction and harness connection');
    }
    gateAPreverifiedDeviceIdentity = Object.freeze(structuredClone(results.deviceIdentityInitial));
    const { firstInstallTime, lastUpdateTime } = await readPackageInstallIdentity();
    if (!firstInstallTime || !lastUpdateTime || firstInstallTime !== lastUpdateTime) {
      throw new Error('fresh absent-package install does not have one exact firstInstallTime/lastUpdateTime');
    }
    results.packageInstallIdentity = { firstInstallTime, lastUpdateTime };
  }
  log('device', results.device);

  const shot = async (name) => {
    await device.screenshot({ path: `${OUT}/${name}.png` });
    log('shot', name);
  };
  const attachPageEvidence = (candidate, epoch) => {
    candidate.on('console', (message) => {
      if (message.type() === 'error') results.webErrors.push({ kind: 'console', text: message.text(), utc: new Date().toISOString() });
    });
    candidate.on('pageerror', (error) => results.webErrors.push({ kind: 'pageerror', text: String(error), utc: new Date().toISOString() }));
    candidate.on('crash', () => {
      if (intentionalStopEpoch !== epoch) results.webErrors.push({ kind: 'crash', text: 'WebView page crashed', utc: new Date().toISOString() });
    });
  };
  const attachUnityNativeEventEvidence = async (candidate, epoch) => {
    if (!UNITY_REQUESTED) return;
    const bindingName = `vandeUnityNativeEvidenceEpoch${epoch}`;
    await candidate.exposeBinding(bindingName, (_source, value) => recordUnityNativeEvent(epoch, value));
    let registration;
    try {
      registration = await candidate.evaluate(async ({ bindingName: exposedName, epoch: pageEpochNumber, stringLimits }) => {
        const deadline = Date.now() + 10_000;
        let availabilityProbeStarted = false;
        let plugin = null;
        while (Date.now() < deadline) {
          const capacitor = window.Capacitor;
          if (capacitor?.isNativePlatform?.() && capacitor.isPluginAvailable?.('VandeUnityPractice')) {
            plugin = capacitor.Plugins?.VandeUnityPractice ?? null;
            if (plugin) break;
            // Force the product's own lazy plugin registration. Do not await the availability call: poll the
            // shared Capacitor registry and install this independent listener as soon as its proxy exists.
            if (!availabilityProbeStarted && window.__vandeAndroidEvidence?.unityAvailability) {
              availabilityProbeStarted = true;
              void window.__vandeAndroidEvidence.unityAvailability().catch(() => undefined);
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        if (!plugin) return { ok: false, reason: 'plugin_proxy_unavailable' };

        const report = window[exposedName];
        if (typeof report !== 'function') return { ok: false, reason: 'page_binding_unavailable' };
        // Preserve one character beyond each identity bound so an overlength native identity remains invalid when
        // it reaches the strict host normalizer. Truncating to exactly `max` would silently turn two different
        // rejected identities with the same prefix into one accepted identity. Diagnostic detail is not identity
        // and remains bounded to its declared retention limit.
        const identityText = (value, max) => typeof value === 'string' && value.length > 0
          ? value.slice(0, max + 1)
          : null;
        const diagnosticText = (value, max) => typeof value === 'string' && value.length > 0
          ? value.slice(0, max)
          : null;
        const send = (metadata) => { void Promise.resolve(report(metadata)).catch(() => undefined); };
        const onMessage = (nativeEvent) => {
          try {
            let body = null;
            // Parsing is local and transient. The packet/body/payload never crosses the Playwright binding.
            if (typeof nativeEvent?.packet === 'string' && nativeEvent.packet.length <= 2_105_344) {
              const packet = JSON.parse(nativeEvent.packet);
              if (typeof packet?.body === 'string' && packet.body.length <= 1_052_672) body = JSON.parse(packet.body);
            }
            send({
              event: 'message',
              operationId: identityText(nativeEvent?.operationId, stringLimits.operationId),
              type: identityText(body?.type, stringLimits.type),
              sequence: Number.isSafeInteger(body?.sequence) && body.sequence >= 0 ? body.sequence : null,
              deliveryId: identityText(body?.deliveryId, stringLimits.deliveryId),
            });
          } catch {
            send({
              event: 'message',
              operationId: identityText(nativeEvent?.operationId, stringLimits.operationId),
              type: null,
              sequence: null,
              deliveryId: null,
            });
          }
        };
        const onError = (nativeEvent) => send({
          event: 'error',
          operationId: identityText(nativeEvent?.operationId, stringLimits.operationId),
          code: identityText(nativeEvent?.code, stringLimits.code),
          detail: diagnosticText(nativeEvent?.detail, stringLimits.detail),
        });
        const settled = await Promise.allSettled([
          plugin.addListener('message', onMessage),
          plugin.addListener('error', onError),
        ]);
        const handles = settled.flatMap((entry) => entry.status === 'fulfilled' ? [entry.value] : []);
        if (handles.length !== 2) {
          await Promise.all(handles.map((handle) => handle?.remove?.().catch(() => undefined)));
          return { ok: false, reason: 'listener_registration_failed' };
        }
        Object.defineProperty(window, `__vandeUnityNativeEvidenceHandles${pageEpochNumber}`, {
          configurable: true,
          enumerable: false,
          value: handles,
        });
        return { ok: true, reason: 'message_and_error_listeners_attached' };
      }, { bindingName, epoch, stringLimits: UNITY_EVENT_STRING_LIMITS });
    } catch (error) {
      registration = {
        ok: false,
        reason: boundedString(error?.message ?? String(error), 160) || 'listener_attachment_failed',
      };
    }
    const recorded = {
      epoch,
      utc: new Date().toISOString(),
      ok: registration?.ok === true,
      reason: boundedString(registration?.reason, 160) || 'unspecified',
    };
    recordUnityListenerRegistration(recorded);
    log(recorded.ok ? '✓' : '✗', `Unity native metadata listener epoch ${epoch}`, recorded.reason);
    if (!recorded.ok) throw new Error(`Unity native metadata listener could not attach for page epoch ${epoch}: ${recorded.reason}`);
  };
  const installedPackageInventory = async () => {
    const raw = await shellRaw(`pm path ${PKG}`);
    const path = parseExactInstalledPackagePathOutput(raw);
    if (!path) {
      throw new Error(`installed package inventory is missing or unsafe: ${raw.slice(0, 500)}`);
    }
    const hashOutput = await shellRaw(`sha256sum ${path}`);
    const hash = parseExactInstalledApkHashOutput(hashOutput, path);
    if (!hash) throw new Error(`installed APK hash is unavailable or mismatched for ${path}`);
    return [hash];
  };
  const launch = async () => {
    await shell(`am start -W -n ${PKG}/.MainActivity`);
    const webview = await device.webView({ pkg: PKG }, { timeout: 60_000 });
    const candidate = await webview.page();
    const epoch = pageEpoch + 1;
    attachPageEvidence(candidate, epoch);
    pageEpoch = epoch;
    battingGeometry = null;
    // The installed identity remains the first app assertion/native boundary. The build marker is set before React
    // renders, so this also lets the independent listener attach before any harness gameplay on every page epoch.
    await candidate.waitForFunction(() => document.documentElement.hasAttribute('data-vande-build-id'), undefined, { timeout: 30_000 });
    const epochIdentity = await candidate.evaluate(() => document.documentElement.getAttribute('data-vande-build-id'));
    if (epochIdentity !== EXPECTED_BUILD_ID) {
      throw new Error(`page epoch ${epoch} bundle identity mismatch before native listener attachment: expected ${EXPECTED_BUILD_ID}, observed ${epochIdentity ?? 'missing'}`);
    }
    await attachUnityNativeEventEvidence(candidate, epoch);
    return candidate;
  };
  if (GATE_A_FIRST_BALL) {
    results.installedPackageInventoryBefore = await installedPackageInventory();
    if (results.installedPackageInventoryBefore.length !== 1 || results.installedPackageInventoryBefore[0].sha256 !== EXPECTED_APK_SHA256) {
      throw new Error(`installed APK inventory does not match the admitted monolithic artifact: ${JSON.stringify(results.installedPackageInventoryBefore)}`);
    }
    if (JSON.stringify(results.installedPackageInventoryBefore) !== JSON.stringify(results.sealedWrapperEvidence.installTransactionReceipt.installedPackageInventory)) {
      throw new Error('installed APK inventory no longer matches the post-install transaction receipt');
    }
  }
  page = await launch();
  await recordAppProcess('after-main-activity-launch');

  // Identity is the first assertion against the installed app. Do not infer it from the checkout: SKIP_BUILD may
  // intentionally point at an older APK, and an install can silently retain stale web assets.
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-vande-build-id'), undefined, { timeout: 30_000 });
  const installedIdentity = await page.evaluate(() => ({
    dom: document.documentElement.getAttribute('data-vande-build-id'),
    surface: window.__vandeAndroidEvidence?.buildId ?? null,
  }));
  results.installedBuildIdentity = {
    expected: EXPECTED_BUILD_ID,
    observedDom: installedIdentity.dom,
    observedEvidenceSurface: installedIdentity.surface,
    checkedUtc: new Date().toISOString(),
  };
  if (!check(
    'installed Android bundle identity matches the expected build before gameplay',
    installedIdentity.dom === EXPECTED_BUILD_ID && installedIdentity.surface === EXPECTED_BUILD_ID,
    EXPECTED_BUILD_ID,
    JSON.stringify(installedIdentity),
  )) {
    throw new Error(`installed bundle identity mismatch: expected ${EXPECTED_BUILD_ID}, DOM=${installedIdentity.dom ?? 'missing'}, surface=${installedIdentity.surface ?? 'missing'}`);
  }

  let availabilityProbe;
  try {
    availabilityProbe = await page.evaluate(async () => {
      const surface = window.__vandeAndroidEvidence;
      if (!surface) throw new Error('Android evidence surface is missing');
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('native availability evidence timed out')), 10_000));
      return Promise.race([surface.unityAvailability(), timeout]);
    });
  } catch (error) {
    availabilityProbe = { error: error?.message ?? String(error) };
  }
  const nativeAvailability = normalizeNativeAvailability(availabilityProbe);
  results.nativeUnityAvailability = {
    result: nativeAvailability,
    raw: nativeAvailability ? undefined : availabilityProbe,
    checkedUtc: new Date().toISOString(),
    scope: 'Runtime plugin availability result only. It does not prove pre-Class.forName ordering or the absence of native-library loading; static source ordering is recorded separately.',
  };
  if (!check(
    'native Unity availability reason and available result are recorded before gameplay',
    nativeAvailability !== null,
    'exact {available, reason, unityVersion} result',
    JSON.stringify(availabilityProbe),
  )) {
    throw new Error('native Unity availability could not be recorded from the installed app');
  }
  if (UNITY_REQUESTED && !ALLOW_UNITY_FALLBACK && !nativeAvailability.available) {
    check(
      'Unity-requested native admission is available',
      false,
      'available=true before a native-Unity evidence run',
      JSON.stringify(nativeAvailability),
    );
    throw new Error(`native Unity is unavailable (${nativeAvailability.reason})`);
  }

  await page.waitForFunction(() => ['practice-menu', 'practice-play'].some((id) => {
    const element = document.querySelector(`[data-testid="${id}"]`);
    return element && element.getClientRects().length > 0;
  }), undefined, { timeout: 60_000 });

  const playAttr = (name) => page.evaluate((attribute) => document.querySelector('[data-testid=practice-play]')?.getAttribute(attribute) ?? null, name).catch(() => null);
  const visible = (id) => page.getByTestId(id).isVisible().catch(() => false);
  const innings = () => page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('vc:practice:innings') ?? 'null')?.state ?? null; }
    catch { return null; }
  }).catch(() => null);
  const records = (state) => [
    ...(state?.overs ?? []).flatMap((over) => over.deliveries ?? []),
    ...(state?.current?.deliveries ?? []),
  ];
  const digest = (state) => {
    const all = records(state);
    const last = all.at(-1) ?? null;
    return {
      id: state?.id ?? null,
      status: state?.status ?? null,
      balls: Number(state?.balls ?? all.length),
      overs: state?.overs?.length ?? 0,
      currentBalls: state?.current?.deliveries?.length ?? 0,
      inFlight: state?.inFlight ?? null,
      records: all,
      last,
      handedness: state?.handedness ?? null,
    };
  };
  const currentDigest = async () => digest(await innings());
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const compactSavedState = (saved) => {
    const coordinates = saved.inFlight ?? (saved.last ? {
      overIndex: saved.last.overIndex ?? null,
      ballIndex: saved.last.ballIndex ?? null,
    } : null);
    return {
      inningsId: saved.id,
      status: saved.status,
      balls: saved.balls,
      records: saved.records.length,
      overIndex: coordinates?.overIndex ?? null,
      ballIndex: coordinates?.ballIndex ?? null,
      inFlight: saved.inFlight,
      lastSwingKind: saved.last?.swing?.kind ?? null,
    };
  };
  const summary = (value) => JSON.stringify({
    id: value.id,
    status: value.status,
    balls: value.balls,
    overs: value.overs,
    currentBalls: value.currentBalls,
    inFlight: value.inFlight,
    recordCount: value.records.length,
    last: value.last && { overIndex: value.last.overIndex, ballIndex: value.last.ballIndex, swing: value.last.swing?.kind ?? null },
  });
  const gateATimelinePath = `${OUT}/state-timeline.ndjson`;
  if (GATE_A_FIRST_BALL) {
    if (existsSync(gateATimelinePath)) throw new Error(`refusing to overwrite Gate-A timeline ${gateATimelinePath}`);
    writeFileSync(gateATimelinePath, '', { flag: 'wx', mode: 0o600 });
  }
  const appendGateATimeline = (observation) => {
    if (!GATE_A_FIRST_BALL) return;
    appendFileSync(gateATimelinePath, `${JSON.stringify(observation)}\n`, { encoding: 'utf8' });
  };
  const gateAObservation = async (label, { append = true, identityMode = 'fresh' } = {}) => {
    if (!['fresh', 'preverified'].includes(identityMode)) {
      throw new Error(`${label}: unsupported Gate-A identity observation mode ${identityMode}`);
    }
    const saved = await currentDigest();
    const ui = await page.evaluate(() => {
      const play = document.querySelector('[data-testid="practice-play"]');
      return {
        buildId: document.documentElement.getAttribute('data-vande-build-id'),
        renderer: document.documentElement.getAttribute('data-vande-practice-renderer'),
        admission: document.documentElement.getAttribute('data-vande-unity-practice'),
        screen: play?.getAttribute('data-screen') ?? null,
        phase: play?.getAttribute('data-phase') ?? null,
        viewport: {
          cssWidth: window.innerWidth,
          cssHeight: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
          orientationType: screen.orientation?.type ?? null,
          orientationAngle: typeof screen.orientation?.angle === 'number' ? screen.orientation.angle : null,
        },
      };
    });
    const deliveryEvent = [...results.unityNativeEvents.events]
      .reverse()
      .find((event) => typeof event.deliveryId === 'string' && event.deliveryId.length > 0) ?? null;
    const preverifiedIdentityErrors = identityMode === 'preverified'
      ? validateAndroidDeviceIdentity(gateAPreverifiedDeviceIdentity)
      : [];
    if (preverifiedIdentityErrors.length) {
      throw new Error(`${label}: preverified Android identity is invalid: ${preverifiedIdentityErrors.join('; ')}`);
    }
    // The pre-transaction observation is on the release-to-tap critical path. Reuse the immutable identity that was
    // fully collected and bound to the sealed install before gameplay, then perform a fresh full collection after
    // the atomic screenshot/tap transaction. This preserves both identity endpoints without delaying the tap.
    const deviceUptime = identityMode === 'fresh' ? await shell('cat /proc/uptime') : null;
    const deviceIdentity = identityMode === 'fresh'
      ? await collectAndroidDeviceIdentity({ serial: device.serial(), shell })
      : structuredClone(gateAPreverifiedDeviceIdentity);
    if (!battingGeometry || battingGeometry.pageEpoch !== pageEpoch) {
      throw new Error(`${label}: authoritative native batting geometry is unavailable`);
    }
    const observation = {
      label,
      utc: new Date().toISOString(),
      hostMonotonicNs: process.hrtime.bigint().toString(),
      hostUptime: identityMode === 'fresh' ? host('uptime') : lightweightHostUptime(),
      deviceUptime: deviceUptime?.slice(0, 128) ?? null,
      identityObservation: identityMode === 'fresh'
        ? {
          mode: 'FRESH_FULL_POST_CRITICAL_OBSERVATION',
          source: 'collectAndroidDeviceIdentity',
        }
        : {
          mode: 'PREVERIFIED_IMMUTABLE_INSTALL_BOUNDARY',
          source: 'gateAPreverifiedDeviceIdentity',
          hostUptimeSource: 'node:os in-process sample',
          deviceUptimeSource: 'omitted-to-protect-release-screencap-tap-critical-path',
        },
      deviceIdentity,
      buildId: ui.buildId,
      renderer: ui.renderer,
      admission: ui.admission,
      screen: ui.screen,
      phase: ui.phase,
      deliveryId: deliveryEvent?.deliveryId ?? null,
      deliveryEventType: deliveryEvent?.type ?? null,
      handedness: saved.handedness,
      viewport: {
        schemaVersion: 1,
        cssPixels: { width: ui.viewport.cssWidth, height: ui.viewport.cssHeight },
        physicalPixels: { width: battingGeometry.width, height: battingGeometry.height },
        devicePixelRatio: ui.viewport.devicePixelRatio,
        nativeRotationDegrees: battingGeometry.rotation,
        screenOrientation: { type: ui.viewport.orientationType, angle: ui.viewport.orientationAngle },
        pageEpoch,
      },
      saved: compactSavedState(saved),
    };
    if (append) appendGateATimeline(observation);
    return observation;
  };
  const capturePackageDataEpoch = async (label) => {
    if (!GATE_A_FIRST_BALL || !page || page.isClosed()) throw new Error(`${label}: live Gate-A WebView is unavailable`);
    const expectedPageEpoch = pageEpoch;
    const observed = await page.evaluate(async () => {
      const rawBefore = localStorage.getItem('vc:practice:innings');
      if (typeof rawBefore !== 'string' || rawBefore.length === 0) throw new Error('persisted first-ball state is missing');
      const digestBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawBefore));
      const stateSha256 = [...new Uint8Array(digestBytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
      const capacitor = window.Capacitor;
      if (!capacitor?.isNativePlatform?.()
          || !capacitor.isPluginAvailable?.('GateAEvidencePlugin')
          || typeof capacitor.Plugins?.GateAEvidencePlugin?.getEpoch !== 'function') {
        throw new Error('read-only GateAEvidencePlugin bridge is unavailable');
      }
      const nativeEpoch = await capacitor.Plugins.GateAEvidencePlugin.getEpoch({ stateSha256 });
      const rawAfter = localStorage.getItem('vc:practice:innings');
      return { rawBefore, rawAfter, stateSha256, nativeEpoch };
    });
    if (pageEpoch !== expectedPageEpoch || page.isClosed()) throw new Error(`${label}: WebView changed during native epoch capture`);
    if (observed.rawBefore !== observed.rawAfter) throw new Error(`${label}: persisted first-ball state changed during native epoch capture`);
    if (sha256Bytes(observed.rawBefore) !== observed.stateSha256) throw new Error(`${label}: browser and host state digests differ`);
    let state;
    try {
      state = JSON.parse(observed.rawBefore)?.state ?? null;
    } catch {
      throw new Error(`${label}: persisted first-ball state is not valid JSON`);
    }
    const savedState = compactSavedState(digest(state));
    const capture = {
      schemaVersion: 1,
      status: 'ATTESTED_PERSISTED_STATE_EPOCH',
      label,
      utc: new Date().toISOString(),
      hostMonotonicNs: process.hrtime.bigint().toString(),
      pageEpoch: expectedPageEpoch,
      persistedStateBytes: Buffer.byteLength(observed.rawBefore),
      stateSha256: observed.stateSha256,
      savedState,
      nativeEpoch: observed.nativeEpoch,
    };
    validatePackageDataEpochCapture(capture, { packageId: PKG, label });
    return capture;
  };
  const runRawAdbObserved = (args) => {
    const result = spawnSync(ADB_PATH, [
      '-H', ADB_ENDPOINT.host,
      '-P', String(ADB_ENDPOINT.port),
      '-s', device.serial(),
      ...args,
    ], {
      cwd: resolve('.'),
      encoding: null,
      // Node may return a partial chunk beyond maxBuffer with ENOBUFS. Half of the immutable raw-file cap leaves
      // ample headroom so even that returned partial output remains exactly retainable before rejection.
      maxBuffer: GATE_A_RAW_EVIDENCE_MAX_BYTES / 2,
      timeout: 30_000,
    });
    const error = result.error ? {
      name: boundedString(result.error.name, 64),
      message: boundedString(result.error.message, 512),
      code: boundedString(result.error.code, 64, true),
      errno: boundedString(String(result.error.errno ?? ''), 64, true),
      syscall: boundedString(result.error.syscall, 128, true),
    } : null;
    const signal = typeof result.signal === 'string' ? boundedString(result.signal, 32) : null;
    const status = Number.isInteger(result.status) ? result.status : null;
    return {
      status,
      signal,
      error,
      timedOut: error?.code === 'ETIMEDOUT',
      maxBufferExceeded: error?.code === 'ENOBUFS',
      processComplete: error === null && signal === null && status !== null,
      stdout: result.stdout ?? Buffer.alloc(0),
      stderr: result.stderr ?? Buffer.alloc(0),
    };
  };
  const runRawAdb = (args) => {
    const result = runRawAdbObserved(args);
    if (result.error) throw new Error(`could not run explicit-serial adb: ${result.error.message}`);
    if (!result.processComplete) throw new Error(`explicit-serial adb did not return an exit status (${result.signal ?? 'unknown'})`);
    return result;
  };
  const rawEvidenceRecord = (path, bytes) => ({
    path: relative(resolve(OUT), resolve(path)),
    sha256: sha256Bytes(bytes),
    bytes: String(bytes.length),
  });
  const captureStorageStatsSamples = async (stableBoundary, stableBoundaryEpoch) => {
    const filenames = [1, 2].flatMap((index) => [
      `storage-stats-sample-${index}.stdout.txt`,
      `storage-stats-sample-${index}.stderr.txt`,
      `storage-stats-sample-${index}.status.txt`,
    ]);
    for (const filename of filenames) {
      if (existsSync(join(OUT, filename))) throw new Error(`refusing to overwrite Gate-A StorageStats evidence ${join(OUT, filename)}`);
    }
    const boundaryEpoch = await capturePackageDataEpoch('storage-stats-boundary');
    if (JSON.stringify(boundaryEpoch.savedState) !== JSON.stringify(stableBoundary.saved)) {
      throw new Error('package-data epoch boundary does not bind the stable first-ball saved state');
    }
    assertSamePackageDataEpoch(
      stableBoundaryEpoch,
      boundaryEpoch,
      'package-data epoch from stable first-playable boundary to StorageStats boundary',
    );
    const command = [
      'adb', '-H', ADB_ENDPOINT.host, '-P', String(ADB_ENDPOINT.port), '-s', device.serial(),
      'shell', 'pm', 'get-package-storage-stats',
      '--user', String(results.device.currentUser), PKG,
    ];
    const parsedSamples = [];
    const samples = [];
    for (let index = 1; index <= 2; index += 1) {
      const packageInstallIdentityBefore = await readPackageInstallIdentity();
      assertPackageInstallIdentity(packageInstallIdentityBefore, `before StorageStats sample ${index}`);
      const epochBefore = await capturePackageDataEpoch(`storage-stats-${index}-before`);
      const hostUptimeBefore = host('uptime');
      const deviceUptimeBefore = await shell('cat /proc/uptime');
      const capturedUtc = new Date().toISOString();
      const raw = runRawAdb([
        'shell', 'pm', 'get-package-storage-stats', '--user', String(results.device.currentUser), PKG,
      ]);
      const stdoutPath = join(OUT, `storage-stats-sample-${index}.stdout.txt`);
      const stderrPath = join(OUT, `storage-stats-sample-${index}.stderr.txt`);
      const statusPath = join(OUT, `storage-stats-sample-${index}.status.txt`);
      const statusBytes = Buffer.from(`${raw.status}\n`, 'utf8');
      writeNew(stdoutPath, raw.stdout);
      writeNew(stderrPath, raw.stderr);
      writeNew(statusPath, statusBytes);
      const parsed = parseStorageStats(raw.stdout.toString('utf8'), {
        stderr: raw.stderr.toString('utf8'),
        status: raw.status,
      });
      const epochAfter = await capturePackageDataEpoch(`storage-stats-${index}-after`);
      const packageInstallIdentityAfter = await readPackageInstallIdentity();
      assertPackageInstallIdentity(packageInstallIdentityAfter, `during StorageStats sample ${index}`);
      parsedSamples.push(parsed);
      samples.push({
        index,
        capturedUtc,
        hostUptimeBefore,
        deviceUptimeBefore,
        packageInstallIdentityBefore,
        epochBefore,
        stdout: rawEvidenceRecord(stdoutPath, raw.stdout),
        stderr: rawEvidenceRecord(stderrPath, raw.stderr),
        exitStatus: raw.status,
        statusRecord: rawEvidenceRecord(statusPath, statusBytes),
        parsed: {
          code: parsed.code.toString(),
          data: parsed.data.toString(),
          cache: parsed.cache.toString(),
          freshInstalledBytes: parsed.freshInstalledBytes.toString(),
          optionalBreakdown: parsed.optionalBreakdown,
          optionalBreakdownGrammar: parsed.optionalBreakdownGrammar,
        },
        epochAfter,
        packageInstallIdentityAfter,
      });
    }
    const assessment = assessStableSamples(parsedSamples);
    if (!assessment.stable || assessment.freshInstalledBytes === null) {
      throw new Error('two in-process StorageStats samples are not stable; local installed size remains UNPROVEN');
    }
    return {
      schemaVersion: 1,
      status: 'BRACKETED_FIRST_PLAYABLE_STORAGE_STATS',
      classification: 'LOCAL_ENGINEERING_MEASUREMENT',
      limitation: GATE_A_MEASUREMENT_LIMITATION,
      packageId: PKG,
      serial: device.serial(),
      user: String(results.device.currentUser),
      buildId: EXPECTED_BUILD_ID,
      artifactSha256: EXPECTED_APK_SHA256,
      runId: results.sealedWrapperEvidence.runId,
      command,
      boundaryEpoch,
      samples,
      finalEpoch: null,
      packageInstallIdentity: results.packageInstallIdentity,
      packageInstallIdentityFinal: null,
      assessment: {
        stableCodeAndData: true,
        footprintStatus: assessment.status,
        freshInstalledBytes: assessment.freshInstalledBytes.toString(),
        limitBytes: GATE_A_SIZE_LIMIT_BYTES.toString(),
        localThresholdPass: assessment.localThresholdPass,
        cacheCountedAgain: false,
      },
    };
  };
  const unchanged = (before, after, label) => {
    if (before.id !== after.id || before.balls !== after.balls || !same(before.records, after.records)) {
      throw new Error(`${label}: persisted innings changed (${summary(before)} -> ${summary(after)})`);
    }
  };
  const resolvedTransition = (before, after, label) => {
    if (!before.id || after.id !== before.id) throw new Error(`${label}: innings identity changed (${before.id ?? 'none'} -> ${after.id ?? 'none'})`);
    if (after.balls !== before.balls + 1) throw new Error(`${label}: saved ball count changed ${before.balls} -> ${after.balls}, expected exactly +1`);
    if (after.inFlight) throw new Error(`${label}: persisted delivery remained in flight`);
    if (after.records.length !== before.records.length + 1) {
      throw new Error(`${label}: persisted record count changed ${before.records.length} -> ${after.records.length}, expected exactly +1`);
    }
    if (!same(after.records.slice(0, before.records.length), before.records)) throw new Error(`${label}: an earlier persisted delivery record changed`);
    if (!same(after.last, after.records.at(-1))) throw new Error(`${label}: final persisted record does not match the digest tail`);
    return after;
  };
  const forward = [
    'practice-intro-skip', 'practice-resume', 'practice-continue', 'practice-random', 'practice-play-start',
    'practice-next-ball', 'practice-next-over', 'practice-new-innings', 'practice-turn-continue',
  ];

  const sizeOutput = await shell('wm size');
  const displaySize = parseWmSize(sizeOutput);
  if (!check('effective Android display size is available', displaySize !== null, 'positive wm size (Override preferred)', sizeOutput.slice(0, 300))) {
    throw new Error('Android effective display size could not be parsed; refusing guessed touch coordinates');
  }
  const viewportOrientation = () => page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    type: screen.orientation?.type ?? null,
    angle: typeof screen.orientation?.angle === 'number' ? screen.orientation.angle : null,
  }));
  const isViewportLandscape = (view) => view.width >= view.height && (view.type === null || view.type.startsWith('landscape'));
  async function captureBattingGeometry(label) {
    const epoch = pageEpoch;
    const until = Date.now() + Math.min(PATIENCE_MS, 15_000);
    while (Date.now() < until) {
      if (epoch !== pageEpoch) throw new Error(`${label}: WebView changed while confirming native landscape`);
      const phaseBefore = await playAttr('data-phase');
      if (phaseBefore === 'live') throw new Error(`${label}: live input opened before Android landscape geometry was confirmed`);
      const view = await viewportOrientation();
      if (isViewportLandscape(view)) {
        const [windowDump, inputDump] = await Promise.all([
          shell('dumpsys window displays'),
          shell('dumpsys input'),
        ]);
        const phaseAfter = await playAttr('data-phase');
        if (phaseAfter === 'live') throw new Error(`${label}: live input opened while Android landscape geometry was being confirmed`);
        const rotation = parseRotation(`${windowDump}\n${inputDump}`);
        if (rotation === 90 || rotation === 270) {
          const [width, height] = [Math.max(displaySize.width, displaySize.height), Math.min(displaySize.width, displaySize.height)];
          battingGeometry = { width, height, rotation, pageEpoch: epoch };
          results.orientation = { degrees: rotation, size: displaySize, viewport: view, confirmedAt: label };
          check('Practice runs in native landscape after Play', true, 'visible Play gesture then 90 or 270 degrees', `${rotation} degrees; ${view.width}x${view.height}`);
          return battingGeometry;
        }
      }
      await sleep(25);
    }
    const view = await viewportOrientation().catch(() => null);
    check('Practice runs in native landscape after Play', false, 'visible Play gesture then 90 or 270 degrees', view ? JSON.stringify(view) : 'viewport unavailable');
    throw new Error(`${label}: Android landscape could not be confirmed before the live input window`);
  }
  async function requireBattingGeometry(label) {
    if (!battingGeometry || battingGeometry.pageEpoch !== pageEpoch) throw new Error(`${label}: no current pre-input Android landscape geometry`);
    const view = await viewportOrientation();
    if (!isViewportLandscape(view)) throw new Error(`${label}: Android left landscape before batting input (${JSON.stringify(view)})`);
    const normalizedAngle = view.angle === null ? null : ((view.angle % 360) + 360) % 360;
    if (normalizedAngle !== null && normalizedAngle !== battingGeometry.rotation) {
      throw new Error(`${label}: Android rotation changed after geometry validation (${battingGeometry.rotation} -> ${normalizedAngle})`);
    }
    return battingGeometry;
  }
  const tap = async (label) => {
    const geometry = await requireBattingGeometry(label);
    return shell(`input tap ${Math.round(geometry.width * 0.5)} ${Math.round(geometry.height * 0.82)}`);
  };

  /** Android may cover the first immersive session with a SystemUI education dialog. Dismiss only that exact
   * SystemUI surface, by bounds read from accessibility XML, before the first delivery can start. */
  async function dismissImmersiveConfirmation(label) {
    const until = Date.now() + 30_000;
    while (Date.now() < until) {
      const dump = await shell('uiautomator dump /data/local/tmp/vande-immersive-window.xml').catch(() => '');
      if (!dump.includes('/data/local/tmp/vande-immersive-window.xml')) {
        await sleep(75);
        continue;
      }
      const xml = await shell('cat /data/local/tmp/vande-immersive-window.xml').catch(() => '');
      const action = immersiveConfirmationAction(xml);
      if (action) {
        await shell(`input tap ${action.x} ${action.y}`);
        (results.systemUiActions ??= []).push({
          label,
          action: 'dismiss-immersive-confirmation',
          bounds: action.bounds,
          utc: new Date().toISOString(),
        });
        log(label, 'dismissed Android fullscreen education');
        return true;
      }
      const nativeReady = results.unityNativeEvents.events.some((event) => event.type === 'unity.ready');
      const phase = await playAttr('data-phase');
      if (nativeReady || phase === 'live') {
        (results.systemUiActions ??= []).push({
          label,
          action: 'immersive-confirmation-not-present',
          reason: nativeReady ? 'native-ready' : 'live-delivery',
          utc: new Date().toISOString(),
        });
        return false;
      }
      await sleep(75);
    }
    (results.systemUiActions ??= []).push({
      label,
      action: 'immersive-confirmation-not-present',
      reason: 'native-launch-deadline',
      utc: new Date().toISOString(),
    });
    return false;
  }

  async function toLiveDelivery(label) {
    const until = Date.now() + PATIENCE_MS;
    const started = Date.now();
    let guarded = await currentDigest();
    let mayCreateInnings = !guarded.id;
    const pressed = new Set();
    while (Date.now() < until) {
      if (await visible('practice-error')) throw new Error(`${label}: Practice showed its error screen`);
      const now = await currentDigest();
      if (now.id !== guarded.id) {
        if (!guarded.id && now.id && mayCreateInnings) {
          if (now.balls !== 0 || now.records.length !== 0) throw new Error(`${label}: first or explicit innings creation already contained resolved deliveries`);
          const expectedInFlight = { overIndex: now.overs, ballIndex: 0 };
          if (now.inFlight !== null && !same(now.inFlight, expectedInFlight)) {
            throw new Error(`${label}: first or explicit innings creation had unexpected in-flight coordinates ${JSON.stringify(now.inFlight)}`);
          }
          (results.inningsIdentityTransitions ??= []).push({ label, kind: 'first-or-explicit-creation', from: null, to: now.id, utc: new Date().toISOString() });
          guarded = now;
          mayCreateInnings = false;
        } else {
          throw new Error(`${label}: unrequested innings identity change before live input (${guarded.id ?? 'none'} -> ${now.id ?? 'none'})`);
        }
      } else if (now.balls !== guarded.balls || !same(now.records, guarded.records)) {
        throw new Error(`${label}: persisted deliveries changed before the live input window (${summary(guarded)} -> ${summary(now)})`);
      }
      const phase = await playAttr('data-phase');
      if (phase === 'live') {
        await requireBattingGeometry(label);
        const renderer = await page.evaluate(() => ({
          renderer: document.documentElement.getAttribute('data-vande-practice-renderer'),
          admission: document.documentElement.getAttribute('data-vande-unity-practice'),
          admissionReason: document.getElementById('vande-unity-engineering-preview')?.getAttribute('data-reason') ?? null,
        }));
        const rendererDecision = assessUnityRenderer({
          requested: UNITY_REQUESTED,
          allowFallback: ALLOW_UNITY_FALLBACK,
          renderer: renderer.renderer,
        });
        (results.rendererEvidence ??= []).push({
          label,
          ...renderer,
          selectionClassification: rendererDecision.classification,
          fallbackAccepted: rendererDecision.classification === 'retained_fallback_explicitly_allowed',
          utc: new Date().toISOString(),
        });
        if (UNITY_REQUESTED && !unityRendererChecked) {
          unityRendererChecked = true;
          results.unityRendererSelection = {
            requested: true,
            fallbackAllowed: ALLOW_UNITY_FALLBACK,
            renderer: renderer.renderer,
            classification: rendererDecision.classification,
            nativeUnityCertifiedByThisSelection: rendererDecision.classification === 'unity_native',
          };
          const selectionName = ALLOW_UNITY_FALLBACK
            ? 'Unity-linked cohort selected native Unity or an explicitly allowed retained fallback'
            : 'Unity request selected the actual native Unity renderer';
          if (!check(selectionName, rendererDecision.ok, rendererDecision.expected, JSON.stringify({ ...renderer, classification: rendererDecision.classification }))) {
            throw new Error(`${label}: renderer ${renderer.renderer ?? 'missing'} is not admissible for this Unity evidence run`);
          }
        } else if (UNITY_REQUESTED && !rendererDecision.ok) {
          throw new Error(`${label}: renderer ${renderer.renderer ?? 'missing'} became inadmissible for this Unity evidence run`);
        }
        (results.toDelivery ??= []).push({ label, ms: Date.now() - started });
        if (GATE_A_FIRST_BALL && !(results.appProcessTimeline ?? []).some((entry) => entry.label === 'first-live-delivery')) {
          await recordAppProcess('first-live-delivery');
        }
        return now;
      }
      // During run-up there is deliberately no player control to press. Poll tightly enough to acquire the short
      // live window; never scan the dead-ball controls and accidentally start another delivery.
      if (phase === 'runup' || phase === 'ready' || phase === 'loading' || phase === 'playing') {
        await sleep(20);
        continue;
      }
      for (const id of forward) {
        if (!pressed.has(id) && await visible(id)) {
          log(label, 'tap', id);
          const beforeView = id === 'practice-play-start' ? await viewportOrientation() : null;
          if (beforeView && !isViewportLandscape(beforeView)) battingGeometry = null;
          if (id === 'practice-play-start') await recordAppProcess('before-practice-play-start');
          await page.getByTestId(id).click({ timeout: 5_000 });
          pressed.add(id);
          if (id === 'practice-new-innings') {
            if (now.status !== 'out' && now.status !== 'complete') throw new Error(`${label}: new innings was requested from unexpected status ${now.status ?? 'none'}`);
            const cleared = await currentDigest();
            if (cleared.id || cleared.records.length) throw new Error(`${label}: explicit new innings did not clear the finished innings`);
            guarded = cleared;
            mayCreateInnings = true;
            (results.inningsIdentityTransitions ??= []).push({ label, kind: 'explicit-clear', from: now.id, to: null, utc: new Date().toISOString() });
          }
          if (id === 'practice-play-start') {
            // Unity can request immersive mode while its late-attached player is still starting. Begin the narrowly
            // validated SystemUI education dismissal before any WebView geometry wait: that overlay removes Activity
            // focus, and waiting on the page first can deadlock Unity readiness behind the very dialog we must dismiss.
            const immersiveConfirmation = !immersiveConfirmationHandled
              ? dismissImmersiveConfirmation(`${label}: Play`)
              : Promise.resolve(false);
            if (battingGeometry) await requireBattingGeometry(`${label}: Play`);
            else await captureBattingGeometry(`${label}: Play`);
            if (!immersiveConfirmationHandled) {
              await immersiveConfirmation;
              immersiveConfirmationHandled = true;
            }
            await recordAppProcess('after-practice-play-start');
          }
          await sleep(20);
          break;
        }
      }
      await sleep(20);
    }
    throw new Error(`${label}: no live delivery within ${PATIENCE_MS / 1000}s (screen=${await playAttr('data-screen')}, phase=${await playAttr('data-phase')})`);
  }

  const apiPresent = await page.evaluate(() => Boolean(window.__vandePractice));
  results.practiceTestApiPresent = apiPresent;
  check(
    'production-like run has no Practice test API',
    HOOKS || !apiPresent,
    HOOKS ? 'optional diagnostic mode may expose the API' : 'window.__vandePractice absent',
    apiPresent ? 'present' : 'absent',
  );
  check('Practice-first launch is visible', await visible('practice-menu') || await visible('practice-play'), 'Practice menu or resumed play', `screen=${await playAttr('data-screen') ?? 'menu'}`);
  await shot(`01-practice-first-${LABEL}`);

  const perfCache = await page.evaluate(() => localStorage.getItem('vc:practice:perf'));
  results.assessment = perfCache ? JSON.parse(perfCache).assessment : null;

  async function waitForOneResolvedBall(before, label) {
    const until = Date.now() + PATIENCE_MS;
    while (Date.now() < until) {
      const after = await currentDigest();
      if (after.id !== before.id) throw new Error(`${label}: innings identity changed while resolving (${before.id ?? 'none'} -> ${after.id ?? 'none'})`);
      if (after.balls < before.balls || after.records.length < before.records.length) throw new Error(`${label}: persisted innings moved backwards`);
      if (after.balls > before.balls + 1 || after.records.length > before.records.length + 1) throw new Error(`${label}: persisted innings advanced by more than one delivery`);
      if (!same(after.records.slice(0, before.records.length), before.records)) throw new Error(`${label}: persisted record prefix changed while resolving`);
      if ((after.balls - before.balls) !== (after.records.length - before.records.length)) throw new Error(`${label}: saved ball and record counts advanced inconsistently`);
      if (after.balls === before.balls + 1 && !after.inFlight) return resolvedTransition(before, after, label);
      await sleep(200);
    }
    throw new Error(`${label}: saved ball count did not advance from ${before.balls}`);
  }

  async function playTouchedBall(label) {
    const before = await toLiveDelivery(label);
    if (!before.id) throw new Error(`${label}: no saved innings before delivery`);
    // The renderer/landscape checks performed by toLiveDelivery already consume
    // part of a fast ball's real-world flight. Dispatch at the first verified
    // live frame: this harness proves the Android input path, not the driver's
    // simulated reaction-time skill.
    await tap(label);
    const after = await waitForOneResolvedBall(before, label);
    return { before, after };
  }

  async function runGateAFirstBall() {
    const initial = await currentDigest();
    if (initial.id || initial.balls !== 0 || initial.records.length !== 0 || initial.inFlight !== null) {
      throw new Error(`Gate-A requires a fresh absent-package profile with no saved innings: ${summary(initial)}`);
    }
    const liveFile = `${OUT}/live-frame.png`;
    const deadFile = `${OUT}/dead-ball.png`;
    const boundaryFile = `${OUT}/first-playable-ball.json`;
    for (const path of [
      liveFile,
      deadFile,
      boundaryFile,
      gateACaptureThenTapAttemptPath,
      gateACaptureThenTapJournalPath,
      gateACaptureThenTapFinalPath,
      gateATransactionStdoutPath,
      gateATransactionStderrPath,
      gateARawCapturePath,
      gateARawCaptureStderrPath,
    ]) {
      if (existsSync(path)) throw new Error(`refusing to overwrite Gate-A evidence ${path}`);
    }
    const remoteLiveFile = `/data/local/tmp/vande-gate-a-${results.sealedWrapperEvidence.runId}/live-frame.png`;
    const remotePreparationCommand = gateACaptureDirectoryPrepareCommand(remoteLiveFile);
    const remotePreparation = runRawAdb(['shell', remotePreparationCommand]);
    results.gateARemoteCapturePreparation = {
      command: remotePreparationCommand,
      finishedUtc: new Date().toISOString(),
      exitStatus: remotePreparation.status,
      stdoutBytes: String(remotePreparation.stdout.length),
      stderrBytes: String(remotePreparation.stderr.length),
    };
    if (remotePreparation.status !== 0
        || remotePreparation.stdout.length !== 0
        || remotePreparation.stderr.length !== 0) {
      throw new Error('Gate-A remote capture directory could not be exclusively prepared before live release');
    }
    const liveDigest = await toLiveDelivery('gate-a-first-ball');
    if (!liveDigest.id || liveDigest.balls !== 0 || liveDigest.records.length !== 0) {
      throw new Error(`Gate-A did not reach the first delivery of a fresh innings: ${summary(liveDigest)}`);
    }

    const stateBefore = await gateAObservation('live-frame-before', {
      append: false,
      identityMode: 'preverified',
    });
    const tapCoordinate = gateATapCoordinate(stateBefore.viewport);
    if (!tapCoordinate) throw new Error('Gate-A could not calculate the physical screenshot/tap coordinate');
    const captureStartedUtc = new Date().toISOString();
    const captureStartedHostMonotonicNs = process.hrtime.bigint().toString();
    const captureCommand = gateACaptureThenTapCommand({
      remotePath: remoteLiveFile,
      coordinate: tapCoordinate,
    });
    const captureTransaction = runRawAdbObserved(['shell', captureCommand]);
    const captureFinishedHostMonotonicNs = process.hrtime.bigint().toString();
    const captureFinishedUtc = new Date().toISOString();
    const transactionStdoutFile = writeGateABoundedRawEvidence(
      gateATransactionStdoutPath,
      captureTransaction.stdout,
    );
    const transactionStderrFile = writeGateABoundedRawEvidence(
      gateATransactionStderrPath,
      captureTransaction.stderr,
    );
    const atomicTransaction = {
      schemaVersion: 1,
      status: 'ADB_SHELL_TRANSACTION_RETURNED_RAW_RETAINED',
      remoteShellCommand: captureCommand,
      tapCoordinatePhysicalPixels: structuredClone(tapCoordinate),
      coordinateRule: GATE_A_CAPTURE_THEN_TAP_COORDINATE_RULE,
      intendedOperationOrder: [...GATE_A_CAPTURE_THEN_TAP_OPERATIONS],
      remoteShellTransactionCount: 1,
      startedUtc: captureStartedUtc,
      finishedUtc: captureFinishedUtc,
      startedHostMonotonicNs: captureStartedHostMonotonicNs,
      finishedHostMonotonicNs: captureFinishedHostMonotonicNs,
      adbInvocation: {
        host: ADB_ENDPOINT.host,
        port: ADB_ENDPOINT.port,
        serial: device.serial(),
        args: ['shell', captureCommand],
      },
      outerProcess: {
        exitStatus: captureTransaction.status,
        signal: captureTransaction.signal,
        error: captureTransaction.error,
        timedOut: captureTransaction.timedOut,
        maxBufferExceeded: captureTransaction.maxBufferExceeded,
        processComplete: captureTransaction.processComplete,
      },
      stdoutFile: transactionStdoutFile,
      stderrFile: transactionStderrFile,
    };
    const initialReceiptCandidate = {
      schemaVersion: 2,
      status: null,
      classification: null,
      runId: results.sealedWrapperEvidence.runId,
      serial: device.serial(),
      adbEndpoint: { host: ADB_ENDPOINT.host, port: ADB_ENDPOINT.port },
      buildId: EXPECTED_BUILD_ID,
      deliveryId: stateBefore.deliveryId,
      viewport: structuredClone(stateBefore.viewport),
      tapCoordinatePhysicalPixels: structuredClone(tapCoordinate),
      coordinateRule: GATE_A_CAPTURE_THEN_TAP_COORDINATE_RULE,
      operationOrder: null,
      remoteShellCommand: captureCommand,
      remoteShellTransactionCount: 1,
      gameplayTapCount: null,
      startedUtc: captureStartedUtc,
      finishedUtc: captureFinishedUtc,
      startedHostMonotonicNs: captureStartedHostMonotonicNs,
      finishedHostMonotonicNs: captureFinishedHostMonotonicNs,
      successMarker: null,
      successMarkerObservedCount: null,
      successDerivation: null,
      adbShellResult: {
        exitStatus: captureTransaction.status,
        stderrBytes: transactionStderrFile.bytes,
        stderrSha256: transactionStderrFile.sha256,
      },
      transactionOutput: {
        utf8: null,
        bytes: transactionStdoutFile.bytes,
        sha256: transactionStdoutFile.sha256,
      },
      deviceUptimeAfterTap: null,
      remoteCapture: { path: null, bytes: null, sha256: null, png: null },
      nativeListenerRegistration: null,
      nativeEventDropCounts: { events: null, registrations: null },
      nativeDeliveryEvents: [],
      liveFrame: null,
    };
    let captureCandidate = createGateACaptureReceiptCandidate({
      receipt: initialReceiptCandidate,
      rawTransaction: atomicTransaction,
    });
    gateACaptureThenTapAttempt = createGateACaptureAttempt({
      runId: results.sealedWrapperEvidence.runId,
      serial: device.serial(),
      buildId: EXPECTED_BUILD_ID,
      atomicTransaction,
      stateBefore,
      captureThenTapCandidate: captureCandidate,
      recordedUtc: new Date().toISOString(),
    });
    const initialAttemptRecord = writeInitialGateACaptureAttempt(
      gateACaptureThenTapAttemptPath,
      gateACaptureThenTapAttempt,
    );
    results.gateACaptureThenTapAttemptFiles = {
      initial: initialAttemptRecord,
      transactionStdout: transactionStdoutFile,
      transactionStderr: transactionStderrFile,
    };
    const rawPullStartedUtc = new Date().toISOString();
    const rawPullStartedHostMonotonicNs = process.hrtime.bigint().toString();
    const pulledLiveFrame = runRawAdbObserved(['exec-out', 'cat', remoteLiveFile]);
    const rawPullFinishedHostMonotonicNs = process.hrtime.bigint().toString();
    const rawPullFinishedUtc = new Date().toISOString();
    const rawCaptureFile = writeGateABoundedRawEvidence(gateARawCapturePath, pulledLiveFrame.stdout);
    const rawCaptureStderrFile = writeGateABoundedRawEvidence(
      gateARawCaptureStderrPath,
      pulledLiveFrame.stderr,
    );
    const rawCapturePull = {
      schemaVersion: 1,
      status: 'RAW_REMOTE_CAPTURE_PULL_RETURNED_AND_RETAINED',
      adbInvocation: {
        host: ADB_ENDPOINT.host,
        port: ADB_ENDPOINT.port,
        serial: device.serial(),
        args: ['exec-out', 'cat', remoteLiveFile],
      },
      startedUtc: rawPullStartedUtc,
      finishedUtc: rawPullFinishedUtc,
      startedHostMonotonicNs: rawPullStartedHostMonotonicNs,
      finishedHostMonotonicNs: rawPullFinishedHostMonotonicNs,
      exitStatus: pulledLiveFrame.status,
      signal: pulledLiveFrame.signal,
      error: pulledLiveFrame.error,
      timedOut: pulledLiveFrame.timedOut,
      maxBufferExceeded: pulledLiveFrame.maxBufferExceeded,
      processComplete: pulledLiveFrame.processComplete,
      stdoutFile: rawCaptureFile,
      stderrFile: rawCaptureStderrFile,
    };
    captureCandidate.rawCaptureBinding = structuredClone(rawCapturePull);
    results.gateACaptureThenTapAttemptFiles.rawCapture = rawCaptureFile;
    results.gateACaptureThenTapAttemptFiles.rawCaptureStderr = rawCaptureStderrFile;
    recordGateACaptureAttemptCheckpoint(gateACaptureThenTapAttempt, gateACaptureThenTapJournalPath, {
      stage: 'RAW_REMOTE_CAPTURE_RETAINED',
      patch: {
        rawCapturePull: structuredClone(rawCapturePull),
        captureThenTapCandidate: structuredClone(captureCandidate),
      },
    });
    if (!captureTransaction.processComplete
        || captureTransaction.status !== 0
        || captureTransaction.stderr.length !== 0) {
      throw new Error('Gate-A screenshot-then-tap remote shell transaction was incomplete, nonzero, or emitted stderr');
    }
    const persistedTransactionStdout = readFileSync(gateATransactionStdoutPath);
    const captureOutput = decodeGateACaptureThenTapOutput(persistedTransactionStdout);
    if (captureOutput !== null) captureCandidate.receipt.transactionOutput.utf8 = captureOutput;
    const parsedCaptureOutput = captureOutput === null
      ? null
      : parseGateACaptureThenTapOutput(captureOutput, remoteLiveFile);
    if (!parsedCaptureOutput) {
      captureCandidate.status = 'REJECTED';
      captureCandidate.validatorErrors.push('transaction stdout is not exact bounded UTF-8 terminal evidence');
      recordGateACaptureAttemptCheckpoint(gateACaptureThenTapAttempt, gateACaptureThenTapJournalPath, {
        stage: 'ATOMIC_TRANSACTION_PARSE_REJECTED',
        patch: { captureThenTapCandidate: structuredClone(captureCandidate) },
      });
      throw new Error('Gate-A screenshot-then-tap transaction output is not exact bounded UTF-8');
    }
    const gameplayTapCount = 1;
    Object.assign(captureCandidate.receipt, {
      status: GATE_A_CAPTURE_THEN_TAP_STATUS,
      classification: GATE_A_CAPTURE_THEN_TAP_CLASSIFICATION,
      operationOrder: [...GATE_A_CAPTURE_THEN_TAP_OPERATIONS],
      gameplayTapCount,
      successMarker: GATE_A_CAPTURE_THEN_TAP_SUCCESS_MARKER,
      successMarkerObservedCount: 1,
      successDerivation: GATE_A_CAPTURE_THEN_TAP_SUCCESS_DERIVATION,
      transactionOutput: structuredClone(parsedCaptureOutput.transactionOutput),
      deviceUptimeAfterTap: parsedCaptureOutput.deviceUptimeAfterTap,
      remoteCapture: { ...structuredClone(parsedCaptureOutput.remoteCapture), png: null },
    });
    captureCandidate.status = 'PARSED_PENDING_VALIDATION';
    recordGateACaptureAttemptCheckpoint(gateACaptureThenTapAttempt, gateACaptureThenTapJournalPath, {
      stage: 'ATOMIC_TRANSACTION_PARSED',
      patch: { captureThenTapCandidate: structuredClone(captureCandidate) },
    });
    if (!pulledLiveFrame.processComplete
        || pulledLiveFrame.status !== 0
        || pulledLiveFrame.stderr.length !== 0) {
      throw new Error('Gate-A raw remote-capture pull was incomplete, nonzero, or emitted stderr');
    }
    appendGateATimeline(stateBefore);
    recordGateACaptureAttemptCheckpoint(gateACaptureThenTapAttempt, gateACaptureThenTapJournalPath, {
      stage: 'POST_TRANSACTION_IDENTITY_PENDING',
      patch: {},
    });
    const stateAfter = await gateAObservation('capture-then-tap-after');
    recordGateACaptureAttemptCheckpoint(gateACaptureThenTapAttempt, gateACaptureThenTapJournalPath, {
      stage: 'POST_TRANSACTION_IDENTITY_OBSERVED',
      patch: { stateAfter: structuredClone(stateAfter) },
    });
    if (!sameAndroidDeviceIdentity(stateAfter.deviceIdentity, gateAPreverifiedDeviceIdentity)) {
      throw new Error('Android identity changed between the preverified install boundary and full post-transaction observation');
    }
    const persistedRawCaptureBytes = readFileSync(gateARawCapturePath);
    const pulledPng = gateAPngDimensions(persistedRawCaptureBytes);
    const pulledSha256 = sha256Bytes(persistedRawCaptureBytes);
    const pngPull = {
      exitStatus: pulledLiveFrame.status,
      stderrFile: rawCaptureStderrFile,
      stdoutFile: rawCaptureFile,
      stdoutBytes: String(persistedRawCaptureBytes.length),
      stdoutSha256: pulledSha256,
      png: pulledPng,
    };
    recordGateACaptureAttemptCheckpoint(gateACaptureThenTapAttempt, gateACaptureThenTapJournalPath, {
      stage: 'PNG_PULL_OBSERVED',
      patch: { pngPull },
    });
    if (pulledPng === null
        || persistedRawCaptureBytes.length !== Number(parsedCaptureOutput.remoteCapture.bytes)
        || pulledSha256 !== parsedCaptureOutput.remoteCapture.sha256
        || pulledPng.width !== stateBefore.viewport.physicalPixels.width
        || pulledPng.height !== stateBefore.viewport.physicalPixels.height) {
      throw new Error('Gate-A could not pull the already captured on-device PNG without mutation');
    }
    writeNew(liveFile, persistedRawCaptureBytes);
    const persistedLiveFrameBytes = readFileSync(liveFile);
    const persistedLiveFrameStat = statSync(liveFile);
    const persistedLiveFramePng = gateAPngDimensions(persistedLiveFrameBytes);
    if (persistedLiveFrameStat.size !== persistedRawCaptureBytes.length
        || persistedLiveFrameBytes.length !== persistedRawCaptureBytes.length
        || sha256Bytes(persistedLiveFrameBytes) !== pulledSha256
        || JSON.stringify(persistedLiveFramePng) !== JSON.stringify(pulledPng)) {
      throw new Error('Gate-A persisted live-frame PNG differs from the pulled on-device capture');
    }

    const liveFrame = {
      path: 'live-frame.png',
      bytes: String(persistedLiveFrameStat.size),
      sha256: sha256Bytes(persistedLiveFrameBytes),
      png: persistedLiveFramePng,
    };
    captureCandidate.receipt.remoteCapture.png = structuredClone(persistedLiveFramePng);
    captureCandidate.receipt.liveFrame = structuredClone(liveFrame);
    recordGateACaptureAttemptCheckpoint(gateACaptureThenTapAttempt, gateACaptureThenTapJournalPath, {
      stage: 'PNG_PERSISTED',
      patch: {
        liveFrame: structuredClone(liveFrame),
        captureThenTapCandidate: structuredClone(captureCandidate),
      },
    });
    recordGateACaptureAttemptCheckpoint(gateACaptureThenTapAttempt, gateACaptureThenTapJournalPath, {
      stage: 'SAVED_RESOLUTION_PENDING',
      patch: {},
    });
    const resolvedDigest = await waitForOneResolvedBall(liveDigest, 'gate-a-first-ball');
    recordGateACaptureAttemptCheckpoint(gateACaptureThenTapAttempt, gateACaptureThenTapJournalPath, {
      stage: 'SAVED_RESOLUTION_OBSERVED',
      patch: { resolvedSavedState: compactSavedState(resolvedDigest) },
    });
    recordGateACaptureAttemptCheckpoint(gateACaptureThenTapAttempt, gateACaptureThenTapJournalPath, {
      stage: 'DEAD_PHASE_PENDING',
      patch: {},
    });
    const deadDeadline = Date.now() + Math.min(PATIENCE_MS, 15_000);
    let deadPhase = await playAttr('data-phase');
    while (deadPhase !== 'dead' && Date.now() < deadDeadline) {
      await sleep(25);
      deadPhase = await playAttr('data-phase');
    }
    if (deadPhase !== 'dead') throw new Error(`first ball did not reach dead phase (observed ${deadPhase ?? 'missing'})`);
    const deadState = await gateAObservation('dead-ball-before-screenshot');
    recordGateACaptureAttemptCheckpoint(gateACaptureThenTapAttempt, gateACaptureThenTapJournalPath, {
      stage: 'DEAD_PHASE_OBSERVED',
      patch: { deadState: structuredClone(deadState) },
    });
    recordGateACaptureAttemptCheckpoint(gateACaptureThenTapAttempt, gateACaptureThenTapJournalPath, {
      stage: 'NATIVE_EVENTS_PENDING',
      patch: {},
    });
    const nativeInputDeadline = Date.now() + Math.min(PATIENCE_MS, 5_000);
    let nativeDeliveryEvents;
    while (Date.now() < nativeInputDeadline) {
      nativeDeliveryEvents = results.unityNativeEvents.events
        .filter((event) => event.event === 'message'
          && event.deliveryId === stateBefore.deliveryId
          && ['unity.release', 'unity.pointer', 'unity.gesture', 'unity.dead'].includes(event.type))
        .map((event) => ({
          epoch: event.epoch,
          operationId: event.operationId,
          type: event.type,
          sequence: event.sequence,
          deliveryId: event.deliveryId,
        }));
      if (nativeDeliveryEvents.some((event) => event.type === 'unity.release')
          && nativeDeliveryEvents.some((event) => event.type === 'unity.pointer')
          && nativeDeliveryEvents.some((event) => event.type === 'unity.gesture')
          && nativeDeliveryEvents.some((event) => event.type === 'unity.dead')) break;
      await sleep(10);
    }
    await sleep(50);
    nativeDeliveryEvents = results.unityNativeEvents.events
      .filter((event) => event.event === 'message'
        && event.deliveryId === stateBefore.deliveryId
        && ['unity.release', 'unity.pointer', 'unity.gesture', 'unity.dead'].includes(event.type))
      .map((event) => ({
        epoch: event.epoch,
        operationId: event.operationId,
        type: event.type,
        sequence: event.sequence,
        deliveryId: event.deliveryId,
      }));
    recordGateACaptureAttemptCheckpoint(gateACaptureThenTapAttempt, gateACaptureThenTapJournalPath, {
      stage: 'NATIVE_EVENTS_OBSERVED',
      patch: { nativeDeliveryEvents: structuredClone(nativeDeliveryEvents) },
    });
    const nativeListenerRegistration = gateANativeListenerRegistration(
      results.unityNativeEvents.registrations,
      stateBefore.viewport.pageEpoch,
    );
    const captureThenTap = {
      schemaVersion: 2,
      status: GATE_A_CAPTURE_THEN_TAP_STATUS,
      classification: GATE_A_CAPTURE_THEN_TAP_CLASSIFICATION,
      runId: results.sealedWrapperEvidence.runId,
      serial: device.serial(),
      adbEndpoint: { host: ADB_ENDPOINT.host, port: ADB_ENDPOINT.port },
      buildId: EXPECTED_BUILD_ID,
      deliveryId: stateBefore.deliveryId,
      viewport: structuredClone(stateBefore.viewport),
      tapCoordinatePhysicalPixels: tapCoordinate,
      coordinateRule: GATE_A_CAPTURE_THEN_TAP_COORDINATE_RULE,
      operationOrder: [...GATE_A_CAPTURE_THEN_TAP_OPERATIONS],
      remoteShellCommand: captureCommand,
      remoteShellTransactionCount: 1,
      gameplayTapCount,
      startedUtc: captureStartedUtc,
      finishedUtc: captureFinishedUtc,
      startedHostMonotonicNs: captureStartedHostMonotonicNs,
      finishedHostMonotonicNs: captureFinishedHostMonotonicNs,
      successMarker: GATE_A_CAPTURE_THEN_TAP_SUCCESS_MARKER,
      successMarkerObservedCount: 1,
      successDerivation: GATE_A_CAPTURE_THEN_TAP_SUCCESS_DERIVATION,
      adbShellResult: {
        exitStatus: captureTransaction.status,
        stderrBytes: String(captureTransaction.stderr.length),
        stderrSha256: sha256Bytes(captureTransaction.stderr),
      },
      transactionOutput: parsedCaptureOutput.transactionOutput,
      deviceUptimeAfterTap: parsedCaptureOutput.deviceUptimeAfterTap,
      remoteCapture: { ...parsedCaptureOutput.remoteCapture, png: pulledPng },
      nativeListenerRegistration,
      nativeEventDropCounts: {
        events: results.unityNativeEvents.droppedEvents,
        registrations: results.unityNativeEvents.droppedRegistrations,
      },
      nativeDeliveryEvents,
      liveFrame,
    };
    captureCandidate.receipt = structuredClone(captureThenTap);
    captureCandidate.status = 'VALIDATION_PENDING';
    recordGateACaptureAttemptCheckpoint(gateACaptureThenTapAttempt, gateACaptureThenTapJournalPath, {
      stage: 'INITIAL_VALIDATION_PENDING',
      patch: {
        captureThenTap: structuredClone(captureThenTap),
        captureThenTapCandidate: structuredClone(captureCandidate),
        initialValidationStatus: 'VALIDATION_PENDING',
      },
    });
    let captureThenTapErrors;
    try {
      captureThenTapErrors = validateGateACaptureThenTapReceipt(captureThenTap, {
        before: stateBefore,
        after: stateAfter,
        dead: deadState,
        expectedBuildId: EXPECTED_BUILD_ID,
        expectedRunId: results.sealedWrapperEvidence.runId,
        expectedSerial: device.serial(),
        expectedAdbEndpoint: { host: ADB_ENDPOINT.host, port: ADB_ENDPOINT.port },
        expectedLiveFrame: liveFrame,
      });
      captureCandidate.status = captureThenTapErrors.length === 0
        ? 'ACCEPTED_PENDING_FINAL_DRAIN'
        : 'REJECTED';
      captureCandidate.validatorErrors = [...captureThenTapErrors];
      recordGateACaptureAttemptCheckpoint(gateACaptureThenTapAttempt, gateACaptureThenTapJournalPath, {
        stage: 'INITIAL_VALIDATION_COMPLETE',
        patch: {
          initialValidationStatus: captureThenTapErrors.length === 0
            ? 'ACCEPTED_PENDING_FINAL_DRAIN'
            : 'REJECTED',
          initialValidationErrors: [...captureThenTapErrors],
          captureThenTapCandidate: structuredClone(captureCandidate),
        },
      });
    } catch (error) {
      captureCandidate.status = 'REJECTED';
      captureCandidate.validatorErrors = [`validator exception: ${error?.message ?? String(error)}`];
      recordGateACaptureAttemptCheckpoint(gateACaptureThenTapAttempt, gateACaptureThenTapJournalPath, {
        stage: 'INITIAL_VALIDATION_EXCEPTION',
        patch: {
          initialValidationStatus: 'REJECTED_VALIDATOR_EXCEPTION',
          initialValidationErrors: [error?.message ?? String(error)],
          captureThenTapCandidate: structuredClone(captureCandidate),
        },
      });
      throw error;
    }
    check(
      'one on-device live PNG then one ADB-injected touchscreen tap has matching native delivery evidence',
      captureThenTapErrors.length === 0,
      'one ordered remote shell transaction; screenshot before touchscreen tap; same epoch/operation/delivery release then pointer then gesture then dead',
      captureThenTapErrors.length ? captureThenTapErrors.join('; ') : JSON.stringify(tapCoordinate),
    );
    if (captureThenTapErrors.length) {
      throw new Error(`capture-then-tap receipt rejected: ${captureThenTapErrors.join('; ')}`);
    }
    const transitionErrors = validateFirstBallTransition(stateBefore, deadState, { tapCount: gameplayTapCount });
    check(
      'one ADB-injected touchscreen tap resolves exactly the first authoritative saved ball',
      transitionErrors.length === 0,
      'one tap; one record; dead phase; no second in-flight ball',
      transitionErrors.length ? transitionErrors.join('; ') : JSON.stringify(deadState.saved),
    );
    if (transitionErrors.length) throw new Error(`first-ball transition rejected: ${transitionErrors.join('; ')}`);
    await device.screenshot({ path: deadFile });
    await sleep(200);
    const stableState = await gateAObservation('first-playable-boundary-stable');
    const stableErrors = validateFirstBallTransition(stateBefore, stableState, { tapCount: gameplayTapCount });
    if (stableErrors.length || JSON.stringify(stableState.saved) !== JSON.stringify(deadState.saved)) {
      throw new Error(`post-first-ball boundary was not stable: ${stableErrors.join('; ') || 'saved state changed'}`);
    }

    const stableBoundaryEpoch = await capturePackageDataEpoch('first-playable-boundary-stable-epoch');
    const bracketedStorageStats = await captureStorageStatsSamples(stableState, stableBoundaryEpoch);

    results.installedPackageInventoryAfter = await installedPackageInventory();
    if (JSON.stringify(results.installedPackageInventoryAfter) !== JSON.stringify(results.installedPackageInventoryBefore)) {
      throw new Error('installed APK path or hash changed during the Gate-A first-ball run');
    }
    const installFinishedMs = Date.parse(results.sealedWrapperEvidence.installTransactionReceipt.finishedUtc);
    const boundaryMs = Date.parse(stableState.utc);
    if (!Number.isFinite(installFinishedMs) || !Number.isFinite(boundaryMs) || boundaryMs < installFinishedMs) {
      throw new Error('first-playable boundary does not follow the exact sealed install transaction');
    }
    const firstPlayable = {
      schemaVersion: 2,
      classification: 'LOCAL_ENGINEERING_ONLY',
      limitations: ['emulator evidence only', 'SIZE-50 UNPROVEN', 'REACH-90 UNPROVEN', 'not human-player evidence'],
      packageId: PKG,
      serial: results.device.serial,
      user: results.device.currentUser,
      adbServer: { host: ADB_ENDPOINT.host, port: ADB_ENDPOINT.port },
      runId: results.sealedWrapperEvidence.runId,
      buildId: EXPECTED_BUILD_ID,
      deviceIdentity: results.deviceIdentityInitial,
      packageInstallIdentity: results.packageInstallIdentity,
      installTransaction: results.sealedWrapperEvidence.installTransactionReceipt,
      renderer: stateBefore.renderer,
      admission: stateBefore.admission,
      handedness: stateBefore.handedness,
      viewport: stateBefore.viewport,
      artifact: {
        path: SEALED_APK_PATH,
        sha256: EXPECTED_APK_SHA256,
        bytes: String(statSync(SEALED_APK_PATH).size),
        identity: results.sealedWrapperEvidence.artifactIdentity.identity,
        parentIdentity: results.sealedWrapperEvidence.artifactIdentity.parentIdentity,
      },
      installedPackageInventoryBefore: results.installedPackageInventoryBefore,
      installedPackageInventoryAfter: results.installedPackageInventoryAfter,
      sealedWrapperEvidence: results.sealedWrapperEvidence,
      unityPayloadBinding: results.sealedWrapperEvidence.unityPayloadBinding,
      hooksPresent: results.practiceTestApiPresent,
      gameplayTapCount,
      outOfBandAppDataOperations: [],
      lifecycleOrPerformanceModeUsed: false,
      secondBallStarted: stableState.saved.inFlight !== null || stableState.saved.balls !== 1 || stableState.saved.records !== 1,
      stateBefore,
      stateAfter,
      deadState,
      stableBoundary: stableState,
      stableBoundaryEpoch,
      captureThenTap,
      liveFrame,
      deadBallFrame: { path: 'dead-ball.png', sha256: sha256File(deadFile) },
      timeline: { path: 'state-timeline.ndjson', sha256: sha256File(gateATimelinePath) },
      measuredBoundaryUtc: stableState.utc,
      measuredBoundaryHostMonotonicNs: stableState.hostMonotonicNs,
      measuredBoundaryDeviceUptime: stableState.deviceUptime,
      bracketedStorageStats,
    };
    if (firstPlayable.hooksPresent || firstPlayable.secondBallStarted) {
      throw new Error('first-playable boundary contradicts the no-hook/no-second-ball contract');
    }
    gateAFirstBallPending = { boundaryFile, evidence: firstPlayable };
    finalizeGateAStorageStats = async () => {
      if (!gateAFirstBallPending) throw new Error('Gate-A first-ball evidence disappeared before final package-data epoch capture');
      const finalEpoch = await capturePackageDataEpoch('storage-stats-final');
      const packageInstallIdentityFinal = await readPackageInstallIdentity();
      assertPackageInstallIdentity(packageInstallIdentityFinal, 'after StorageStats sampling');
      const completed = {
        ...gateAFirstBallPending.evidence.bracketedStorageStats,
        finalEpoch,
        packageInstallIdentityFinal,
      };
      validateBracketedStorageStatsMeasurement(completed, {
        packageId: PKG,
        serial: device.serial(),
        user: String(results.device.currentUser),
        buildId: EXPECTED_BUILD_ID,
        artifactSha256: EXPECTED_APK_SHA256,
        runId: results.sealedWrapperEvidence.runId,
        stableSavedState: stableState.saved,
        stableBoundaryEpoch: gateAFirstBallPending.evidence.stableBoundaryEpoch,
        expectedPackageInstallIdentity: results.packageInstallIdentity,
      });
      gateAFirstBallPending.evidence.bracketedStorageStats = completed;
      results.bracketedStorageStats = completed;
      finalizeGateAStorageStats = null;
    };
  }

  if (GATE_A_FIRST_BALL) {
    await runGateAFirstBall();
  } else {
    if (!flag('skip-lifecycle')) {
    const first = await playTouchedBall('lifecycle-touch');
    check('real touch resolves exactly one saved ball', first.after.balls === first.before.balls + 1 && ['defend', 'attack'].includes(first.after.last?.swing?.kind),
      'same innings, +1 ball, recorded swing', JSON.stringify({ before: first.before, after: first.after }));
    await shot(`02-after-first-ball-${LABEL}`);

    const beforeHome = await toLiveDelivery('lifecycle-home');
    await sleep(150);
    await shell('input keyevent KEYCODE_HOME');
    await sleep(3_000);
    await shot(`03-home-screen-${LABEL}`);
    await shell(`am start -W -n ${PKG}/.MainActivity`);
    const afterHome = await waitForOneResolvedBall(beforeHome, 'HOME interruption');
    check('HOME mid-delivery records exactly one leave', afterHome.id === beforeHome.id && afterHome.balls === beforeHome.balls + 1 && afterHome.last?.swing === null,
      'same innings, +1 ball, no swing, no in-flight ball', JSON.stringify({ before: beforeHome, after: afterHome }));
    await shot(`04-back-in-app-${LABEL}`);

    const beforeKill = await toLiveDelivery('lifecycle-reclaim');
    await sleep(120);
    await shell('input keyevent KEYCODE_HOME');
    await sleep(800);
    const stoppedEpoch = pageEpoch;
    const oldPid = await shell(`pidof ${PKG}`).catch(() => '');
    if (!oldPid) throw new Error('process reclaim: app process was not running before the stop');
    intentionalStopEpoch = stoppedEpoch;
    // `am kill` is advisory and can leave a cached activity alive. Force-stop only this app on this disposable AVD;
    // it preserves app data while making the process-reclaim premise observable and deterministic.
    await shell(`am force-stop --user current ${PKG}`);
    const stopDeadline = Date.now() + 10_000;
    let pidAfterStop = await shell(`pidof ${PKG}`).catch(() => '');
    while (pidAfterStop && Date.now() < stopDeadline) {
      await sleep(100);
      pidAfterStop = await shell(`pidof ${PKG}`).catch(() => '');
    }
    if (pidAfterStop) throw new Error(`process reclaim: old app process survived force-stop (${pidAfterStop})`);
    page = await launch();
    const newPid = await shell(`pidof ${PKG}`).catch(() => '');
    if (!newPid || newPid === oldPid) throw new Error(`process reclaim: relaunch did not produce a distinct app process (${oldPid} -> ${newPid || 'none'})`);
    results.processReclaim = {
      method: 'HOME then am force-stop on the isolated test package; app data preserved',
      oldPid,
      pidAfterStop: pidAfterStop || null,
      newPid,
      oldPageEpoch: stoppedEpoch,
      newPageEpoch: pageEpoch,
      utc: new Date().toISOString(),
    };
    check('process reclaim used a proven fresh app process', pageEpoch === stoppedEpoch + 1 && !pidAfterStop && newPid !== oldPid,
      'old process absent before relaunch; new process and WebView epoch after relaunch', JSON.stringify(results.processReclaim));
    await page.waitForFunction(() => [
      'practice-menu', 'practice-play', 'practice-over-summary', 'practice-out-summary', 'practice-innings-summary',
    ].some((id) => {
      const element = document.querySelector(`[data-testid="${id}"]`);
      return element && element.getClientRects().length > 0;
    }), undefined, { timeout: 60_000 });
    const afterKill = await waitForOneResolvedBall(beforeKill, 'process reclaim');
    const reclaimDestination = afterKill.status === 'out'
      ? 'practice-out-summary'
      : afterKill.status === 'complete'
        ? 'practice-innings-summary'
        : afterKill.status === 'batting' || afterKill.status === 'over_complete'
          ? 'practice-menu'
          : null;
    if (!reclaimDestination) throw new Error(`process reclaim: unexpected persisted status ${afterKill.status ?? 'none'}`);
    await page.getByTestId(reclaimDestination).waitFor({ timeout: 60_000 });
    const atReclaimDestination = await currentDigest();
    unchanged(afterKill, atReclaimDestination, `process reclaim: showing ${reclaimDestination}`);
    if (atReclaimDestination.status !== afterKill.status || atReclaimDestination.inFlight !== null) {
      throw new Error(`process reclaim: destination had unexpected persisted state ${summary(atReclaimDestination)}`);
    }
    results.reclaimDestination = { status: afterKill.status, testId: reclaimDestination, snapshot: summary(atReclaimDestination), utc: new Date().toISOString() };
    log('process reclaim visible destination', `${afterKill.status}:${reclaimDestination}`, summary(atReclaimDestination));
    check('process reclaim mid-delivery persists exactly one leave', afterKill.id === beforeKill.id && afterKill.balls === beforeKill.balls + 1 && !afterKill.inFlight && afterKill.last?.swing === null,
      'same innings, +1 ball, no swing, no in-flight ball', JSON.stringify({ before: beforeKill, after: afterKill }));
    await shot(`05-relaunched-${LABEL}`);
    }

  // Preserve any unfinished user over. Finish it once through normal play, then use the next naturally available over.
  results.continuity = { preparation: [], attempts: [] };
  let state = await innings();
  while (state?.status === 'batting' && (state.current?.deliveries?.length ?? 0) > 0) {
    const transition = await playTouchedBall(`preserve-existing-${state.current.deliveries.length + 1}`);
    results.continuity.preparation.push(transition);
    state = await innings();
  }

  async function showResolvedDestination(status, label) {
    const summaryId = status === 'over_complete'
      ? 'practice-over-summary'
      : status === 'out'
        ? 'practice-out-summary'
        : 'practice-innings-summary';
    const before = await currentDigest();
    const until = Date.now() + PATIENCE_MS;
    let advanced = false;
    while (Date.now() < until && !await visible(summaryId)) {
      const during = await currentDigest();
      unchanged(before, during, `${label}: waiting for ${summaryId}`);
      if (!advanced && await visible('practice-next-ball')) {
        await page.getByTestId('practice-next-ball').click();
        advanced = true;
      } else if (!advanced && status === 'over_complete' && await visible('practice-continue')) {
        await page.getByTestId('practice-continue').click();
        advanced = true;
      }
      await sleep(25);
    }
    await page.getByTestId(summaryId).waitFor({ timeout: 1_000 });
    const after = await currentDigest();
    unchanged(before, after, `${label}: showing ${summaryId}`);
  }

  async function reachFreshOverChoice() {
    state = await innings();
    if (!state || state.status === 'choosing_over') return true;
    if (state.status === 'out' || state.status === 'complete') {
      await showResolvedDestination(state.status, 'finished innings');
      if (await visible('practice-new-innings')) {
        const finished = await currentDigest();
        if (finished.status !== 'out' && finished.status !== 'complete') throw new Error(`new innings was requested from unexpected status ${finished.status ?? 'none'}`);
        await page.getByTestId('practice-new-innings').click();
        const cleared = await currentDigest();
        if (cleared.id || cleared.records.length) throw new Error('explicit new innings did not clear the finished persisted innings');
        (results.inningsIdentityTransitions ??= []).push({ label: 'finished innings', kind: 'explicit-clear', from: finished.id, to: null, utc: new Date().toISOString() });
      }
      await page.getByTestId('practice-menu').waitFor({ timeout: 30_000 });
      return true;
    }
    if (state.status === 'over_complete') {
      const completed = await currentDigest();
      if (await visible('practice-menu') && await visible('practice-predefined')) {
        const atChoice = await currentDigest();
        unchanged(completed, atChoice, 'completed existing over: already at fresh over choice');
        if (atChoice.status !== 'over_complete' || atChoice.inFlight !== null) {
          throw new Error(`completed existing over: fresh choice had unexpected persisted state ${summary(atChoice)}`);
        }
        results.continuity.destination = {
          route: 'already-next-over-home',
          snapshot: summary(atChoice),
          utc: new Date().toISOString(),
        };
        log('completed existing over already at fresh-over choice', summary(atChoice));
        return true;
      }
      await showResolvedDestination(state.status, 'completed existing over');
      if (await visible('practice-summary-more-toggle')) await page.getByTestId('practice-summary-more-toggle').click();
      await page.getByTestId('practice-choose-over').click({ timeout: 10_000 });
      await page.getByTestId('practice-menu').waitFor({ timeout: 30_000 });
      return true;
    }
    return false;
  }

  let continuitySource = 'existing-preserved';
  const choosingFreshOver = await reachFreshOverChoice();
  const continuityPrerequisite = await currentDigest();
  if (choosingFreshOver) {
    continuitySource = 'visible-predefined-builder';
    await page.getByTestId('practice-predefined').click({ timeout: 30_000 });
    await page.getByTestId('practice-build-mode-own').click();
    await page.getByTestId('practice-build-family-pace').click();
    await page.getByTestId('practice-build-order-exact').click();
    for (let index = 1; index <= 6; index += 1) {
      await page.getByTestId(`practice-slot-${index}`).click();
      const toggle = page.getByTestId('practice-build-delivery-toggle');
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
      await page.getByTestId('practice-build-variation-stock').click();
      const box = await page.getByTestId('practice-pitch-map').boundingBox();
      if (!box) throw new Error(`predefined over: pitch map unavailable for ball ${index}`);
      await page.getByTestId('practice-pitch-map').click({ position: {
        x: box.width * (0.45 + 0.6) / 1.4,
        y: box.height * (1 - 5.5 / 11),
      } });
    }
    await page.getByTestId('practice-build-start').click();
    await page.getByTestId('practice-setup').waitFor({ timeout: 30_000 });
    const beforeView = await viewportOrientation();
    if (!isViewportLandscape(beforeView)) battingGeometry = null;
    await page.getByTestId('practice-play-start').click();
    if (battingGeometry) await requireBattingGeometry('continuity setup: Play');
    else await captureBattingGeometry('continuity setup: Play');
  }

  async function waitForFreshOver(prerequisite, label) {
    const until = Date.now() + PATIENCE_MS;
    while (Date.now() < until) {
      const candidate = await currentDigest();
      if (prerequisite.id && candidate.id !== prerequisite.id) {
        throw new Error(`${label}: innings identity changed (${prerequisite.id} -> ${candidate.id ?? 'none'})`);
      }
      if (prerequisite.id && !same(candidate.records.slice(0, prerequisite.records.length), prerequisite.records)) {
        throw new Error(`${label}: persisted record prefix changed while preparing the over`);
      }
      if (candidate.balls !== prerequisite.balls || candidate.records.length !== prerequisite.records.length) {
        throw new Error(`${label}: a delivery resolved before the fresh-over baseline was captured`);
      }
      if (candidate.id && candidate.status === 'batting' && candidate.currentBalls === 0) {
        if (!same(candidate.records, prerequisite.records)) throw new Error(`${label}: the fresh over did not preserve the exact record prefix`);
        const expectedInFlight = { overIndex: candidate.overs, ballIndex: 0 };
        if (candidate.inFlight !== null && !same(candidate.inFlight, expectedInFlight)) {
          throw new Error(`${label}: unexpected first in-flight coordinates ${JSON.stringify(candidate.inFlight)}`);
        }
        return candidate;
      }
      await sleep(25);
    }
    throw new Error(`${label}: no fresh saved over became available`);
  }

  const attempt = { source: continuitySource, expectedBalls: 6, startedUtc: new Date().toISOString(), balls: [] };
  results.continuity.attempts.push(attempt);
  const beforeOver = await waitForFreshOver(continuityPrerequisite, 'continuity over');
  const continuityId = beforeOver.id;
  const continuityOverIndex = beforeOver.overs;
  const continuityPrefix = beforeOver.records;
  let previousContinuity = beforeOver;
  for (let index = 0; index < 6; index += 1) {
    const transition = await playTouchedBall(`continuity-${index + 1}`);
    attempt.balls.push(transition);
    if (transition.before.id !== continuityId || transition.after.id !== continuityId) throw new Error(`continuity ball ${index + 1}: innings identity changed`);
    if (transition.before.balls !== previousContinuity.balls || !same(transition.before.records, previousContinuity.records)) {
      throw new Error(`continuity ball ${index + 1}: persisted records changed between consecutive delivery snapshots`);
    }
    if (transition.before.records.length !== continuityPrefix.length + index || !same(transition.before.records.slice(0, continuityPrefix.length), continuityPrefix)) {
      throw new Error(`continuity ball ${index + 1}: the common persisted prefix or sequence length changed`);
    }
    const record = transition.after.records.at(-1);
    if (record?.overIndex !== continuityOverIndex || record?.ballIndex !== index || !['defend', 'attack'].includes(record?.swing?.kind)) {
      throw new Error(`continuity ball ${index + 1}: expected overIndex ${continuityOverIndex}, ballIndex ${index}, and a real defend/attack swing`);
    }
    if (transition.after.status === 'out' || (transition.after.status === 'complete' && index < 5)) {
      throw new Error(`continuity over ended after ${index + 1}/6 balls; no retry was attempted`);
    }
    previousContinuity = transition.after;
  }
  const afterOver = await currentDigest();
  if (afterOver.balls !== previousContinuity.balls || !same(afterOver.records, previousContinuity.records)) {
    throw new Error('continuity over: final persisted records changed after the sixth resolved transition');
  }
  attempt.finishedUtc = new Date().toISOString();
  attempt.observedBalls = afterOver.balls - beforeOver.balls;
  attempt.status = afterOver.status;
  const attemptRecords = afterOver.records.slice(continuityPrefix.length);
  check('one uninterrupted over resolves six consecutive balls',
    afterOver.id === continuityId && attempt.observedBalls === 6 && !afterOver.inFlight && afterOver.records.length === continuityPrefix.length + 6
      && same(afterOver.records.slice(0, continuityPrefix.length), continuityPrefix)
      && attemptRecords.every((record, index) => record?.overIndex === continuityOverIndex && record?.ballIndex === index && ['defend', 'attack'].includes(record?.swing?.kind))
      && ['over_complete', 'complete'].includes(afterOver.status),
    'one innings/over; immutable prefix; +6 balls and records; defend/attack swings; ballIndex 0..5; no in-flight; completed over',
    JSON.stringify({ source: continuitySource, continuityId, continuityOverIndex, before: summary(beforeOver), after: summary(afterOver), attemptRecords }));
  await showResolvedDestination(afterOver.status, 'continuity over');
  await shot(`06-uninterrupted-over-${LABEL}`);

    if (PERF) {
    const perfGeometry = await requireBattingGeometry('performance diagnostics');
    if (flag('recheck')) {
      await page.evaluate(() => localStorage.removeItem('vc:practice:perf'));
      log('device assessment cache cleared by the explicitly requested optional diagnostic');
    }
    await installObserver(page);
    const measuredForward = (label) => toLiveDelivery(label);
    const metrics = await playMeasured(page, { shell, pkg: PKG, n: N, forward: measuredForward, screen: { w: perfGeometry.width, h: perfGeometry.height }, log });
    for (const line of summarise(metrics)) log(line);
    results.frames = metrics;
    const assessmentAfter = await page.evaluate(() => localStorage.getItem('vc:practice:perf'));
    results.assessmentAfter = assessmentAfter ? JSON.parse(assessmentAfter).assessment : null;
    check(`${N} deliveries measured in the WebView`, metrics.windows.length >= Math.min(N, 3), `at least ${Math.min(N, 3)} windows`, `${metrics.windows.length} windows`);
    check('no shader program linked during a delivery', metrics.windows.every((window) => window.links === 0), 'all link counts 0', metrics.windows.map((window) => window.links).join(','));

    const beforeBackground = await inningsKey(page);
    await shell('input keyevent KEYCODE_HOME');
    await sleep(5_000);
    await shell(`am start -W -n ${PKG}/.MainActivity`);
    await sleep(2_500);
    const afterBackground = await inningsKey(page);
    await shot(`08-back-mid-over-${LABEL}`);
    check('HOME between balls leaves innings unchanged', JSON.stringify(beforeBackground) === JSON.stringify(afterBackground), JSON.stringify(beforeBackground), JSON.stringify(afterBackground));
    if (await visible('practice-resume')) await page.getByTestId('practice-resume').click();
    const resumed = await playMeasured(page, { shell, pkg: PKG, n: 1, forward: measuredForward, screen: { w: perfGeometry.width, h: perfGeometry.height }, log }).catch((error) => ({ error: String(error) }));
    check('the next ball after returning resolves', !resumed.error && resumed.balls?.[0]?.dead !== null, 'one resolved ball', resumed.error ?? String(resumed.balls?.[0]?.dead));

    await shell('cmd connectivity airplane-mode enable');
    airplaneEnabled = true;
    await sleep(1_500);
    const since = await page.evaluate(() => performance.now());
    const offline = await playMeasured(page, { shell, pkg: PKG, n: 3, forward: measuredForward, screen: { w: perfGeometry.width, h: perfGeometry.height }, log }).catch((error) => ({ error: String(error) }));
    const external = await externalRequests(page, since);
    results.offline = { balls: offline.balls?.length ?? 0, external, error: offline.error ?? null };
    check('airplane mode resolves three balls', !offline.error && offline.balls?.length === 3 && offline.balls.every((ball) => ball.dead !== null), '3 resolved balls', offline.error ?? `${offline.balls?.length ?? 0} balls`);
    check('airplane mode sends no external request', external.length === 0, '0 external requests', external.slice(0, 3).join(' '));
    await shell('cmd connectivity airplane-mode disable');
    airplaneEnabled = false;
    }
  }

  results.webviewVersion = await shell('dumpsys package com.google.android.webview | grep -m1 versionName').catch(() => '');
} catch (error) {
  fatal = error;
  if (gateACaptureThenTapAttempt) {
    try {
      recordGateACaptureAttemptError(gateACaptureThenTapAttempt, gateACaptureThenTapJournalPath, {
        stage: gateACaptureThenTapAttempt.currentStage,
        error,
      });
    } catch (journalError) {
      results.gateACaptureThenTapJournalFailure = {
        message: journalError?.message ?? String(journalError),
        stack: journalError?.stack ?? '',
      };
    }
  }
  results.failure = { message: error?.message ?? String(error), stack: error?.stack ?? '' };
  log('✗', results.failure.message);
  if (device) await device.screenshot({ path: `${OUT}/failure-${LABEL}.png` }).catch(() => {});
} finally {
  if (device) {
    const shell = (command) => device.shell(command).then((buffer) => buffer.toString().trim());
    await recordAppProcess('harness-finally').catch(() => null);
    if (airplaneEnabled) await shell('cmd connectivity airplane-mode disable').catch(() => {});
    const crashes = logcatSince
      ? await shell(`logcat -d -T '${logcatSince}' | grep -E "FATAL EXCEPTION|ANR in ${PKG}" | head -20`).catch((error) => `logcat collection failed: ${error}`)
      : 'logcat start timestamp unavailable';
    results.logcatCrashes = crashes === '' ? [] : crashes.split(/\r?\n/u).filter(Boolean).slice(0, 20);
    check(
      'no crash or ANR since this run began',
      results.logcatCrashes.length === 0,
      'no matching lines',
      JSON.stringify(results.logcatCrashes),
    );
    const unityDiagnosticOutput = logcatSince
      ? await shell(`logcat -d -T '${logcatSince}' -v threadtime | grep -E 'VANDE Unity|UnityPracticeHost|UnityPracticePlugin|VandeUnityPractice' | tail -${UNITY_LOGCAT_LINE_LIMIT + 1} | cut -c1-${UNITY_LOGCAT_CHAR_LIMIT + 1}`).catch(() => '')
      : '';
    const diagnosticCandidates = unityDiagnosticOutput ? unityDiagnosticOutput.split(/\r?\n/) : [];
    let redactedDiagnosticLines = 0;
    const diagnosticLines = diagnosticCandidates.slice(-UNITY_LOGCAT_LINE_LIMIT).map((line) => {
      const bounded = line.slice(0, UNITY_LOGCAT_CHAR_LIMIT);
      if (/(?:\{\s*"|"(?:body|payload|packet)"\s*:|gesture(?:trace|coordinates)?\s*[=:])/i.test(bounded)) {
        redactedDiagnosticLines += 1;
        return '[redacted VANDE Unity diagnostic line containing packet, payload or gesture data]';
      }
      return bounded;
    });
    results.unityNativeLogcat = {
      classification: 'BOUNDED_FILTERED_DIAGNOSTIC',
      filter: 'VANDE Unity|UnityPracticeHost|UnityPracticePlugin|VandeUnityPractice',
      maxLines: UNITY_LOGCAT_LINE_LIMIT,
      maxCharsPerLine: UNITY_LOGCAT_CHAR_LIMIT,
      redactedLines: redactedDiagnosticLines,
      truncated: diagnosticCandidates.length > UNITY_LOGCAT_LINE_LIMIT
        || diagnosticCandidates.some((line) => line.length > UNITY_LOGCAT_CHAR_LIMIT),
      lines: diagnosticLines,
    };
    const processDiagnosticOutput = logcatSince
      ? await shell(`logcat -d -T '${logcatSince}' -v threadtime | grep -E 'Unity.*(Queue Destroy|Quitting process)|ActivityManager.*in\\.vande\\.cricket|am_(kill|proc_died).*in\\.vande\\.cricket|onUnityPlayer(Unloaded|Quitted)|UnityPracticeHost' | tail -${UNITY_LOGCAT_LINE_LIMIT + 1} | cut -c1-${UNITY_LOGCAT_CHAR_LIMIT + 1}`).catch(() => '')
      : '';
    const processDiagnosticCandidates = processDiagnosticOutput ? processDiagnosticOutput.split(/\r?\n/) : [];
    results.unityProcessLogcat = {
      classification: 'BOUNDED_FILTERED_PROCESS_DIAGNOSTIC',
      filter: 'Unity Queue Destroy/Quitting process; ActivityManager package kill/death; Unity lifecycle callback; UnityPracticeHost',
      maxLines: UNITY_LOGCAT_LINE_LIMIT,
      maxCharsPerLine: UNITY_LOGCAT_CHAR_LIMIT,
      truncated: processDiagnosticCandidates.length > UNITY_LOGCAT_LINE_LIMIT
        || processDiagnosticCandidates.some((line) => line.length > UNITY_LOGCAT_CHAR_LIMIT),
      lines: processDiagnosticCandidates.slice(-UNITY_LOGCAT_LINE_LIMIT).map((line) => line.slice(0, UNITY_LOGCAT_CHAR_LIMIT)),
    };
    if (GATE_A_FIRST_BALL && UNITY_REQUESTED) {
      const forbiddenQuitLines = results.unityProcessLogcat.lines.filter((line) => /onUnityPlayerQuitted|Quitting process/u.test(line));
      check(
        'Gate-A native Unity emitted no quit/process-termination signal',
        forbiddenQuitLines.length === 0,
        'no onUnityPlayerQuitted or Unity Quitting process lines',
        JSON.stringify(forbiddenQuitLines.slice(0, 8)),
      );
      const requiredLabels = ['after-main-activity-launch', 'before-practice-play-start', 'after-practice-play-start', 'first-live-delivery'];
      const required = requiredLabels.map((label) => (results.appProcessTimeline ?? []).find((entry) => entry.label === label));
      const observedPids = required.flatMap((entry) => entry?.pids ?? []);
      check(
        'Gate-A app PID remained stable across native Unity launch',
        required.every((entry) => entry?.pids?.length === 1) && new Set(observedPids).size === 1,
        `one identical PID at ${requiredLabels.join(', ')}`,
        JSON.stringify(required),
      );
    }
  }
  if (finalizeGateAStorageStats) {
    try {
      await finalizeGateAStorageStats();
    } catch (error) {
      const finalizationError = error instanceof Error ? error : new Error(String(error));
      fatal ??= finalizationError;
      results.gateAStorageStatsFinalizationFailure = {
        message: finalizationError.message,
        stack: finalizationError.stack ?? '',
      };
      results.failure ??= results.gateAStorageStatsFinalizationFailure;
      log('✗', `Gate-A StorageStats final epoch rejected: ${finalizationError.message}`);
    }
  }
  for (const candidate of connected) {
    await candidate.close().catch((error) => results.webErrors.push({ kind: 'connection-close', text: String(error), utc: new Date().toISOString() }));
  }
  // Closing the Playwright device drains page/console events. Evaluate this gate only after that boundary so a late
  // WebView error cannot arrive after the evidence JSON and exit status were decided.
  const nativeErrors = results.unityNativeEvents.events.filter((event) => event.event === 'error');
  if (UNITY_REQUESTED && !ALLOW_UNITY_FALLBACK) {
    check(
      'strict native Unity run emitted no native error event',
      nativeErrors.length === 0,
      '0 native error events',
      JSON.stringify(nativeErrors.slice(0, 3)),
    );
  }
  check('no WebView console/page errors', results.webErrors.length === 0, '0 errors', JSON.stringify(results.webErrors.slice(0, 3)));
  results.sourceBuildIdAtHarnessEnd = host('scripts/build-id.sh');
  if (GATE_A_FIRST_BALL) {
    check(
      'source identity remained equal to the admitted sealed build',
      results.sourceBuildIdAtHarnessEnd === EXPECTED_BUILD_ID,
      EXPECTED_BUILD_ID,
      results.sourceBuildIdAtHarnessEnd || 'missing',
    );
  }
  if (gateACaptureThenTapAttempt) {
    const attempt = gateACaptureThenTapAttempt;
    const finalCandidate = structuredClone(attempt.captureThenTapCandidate);
    const finalCaptureThenTap = structuredClone(finalCandidate.receipt);
    const finalNativeDeliveryEvents = results.unityNativeEvents.events
      .filter((event) => event.event === 'message'
        && event.deliveryId === attempt.stateBefore.deliveryId
        && ['unity.release', 'unity.pointer', 'unity.gesture', 'unity.dead'].includes(event.type))
      .map((event) => ({
        epoch: event.epoch,
        operationId: event.operationId,
        type: event.type,
        sequence: event.sequence,
        deliveryId: event.deliveryId,
      }));
    finalCaptureThenTap.nativeDeliveryEvents = finalNativeDeliveryEvents;
    finalCaptureThenTap.nativeListenerRegistration = gateANativeListenerRegistration(
      results.unityNativeEvents.registrations,
      attempt.stateBefore.viewport.pageEpoch,
    );
    finalCaptureThenTap.nativeEventDropCounts = {
      events: results.unityNativeEvents.droppedEvents,
      registrations: results.unityNativeEvents.droppedRegistrations,
    };
    let drainedValidatorErrors;
    try {
      drainedValidatorErrors = validateGateACaptureThenTapReceipt(finalCaptureThenTap, {
        before: attempt.stateBefore,
        after: attempt.stateAfter,
        dead: attempt.deadState,
        expectedBuildId: EXPECTED_BUILD_ID,
        expectedRunId: results.sealedWrapperEvidence.runId,
        expectedSerial: gateAPreverifiedDeviceIdentity.serial,
        expectedAdbEndpoint: { host: ADB_ENDPOINT.host, port: ADB_ENDPOINT.port },
        expectedLiveFrame: attempt.liveFrame,
      });
    } catch (error) {
      drainedValidatorErrors = [`validator exception: ${error?.message ?? String(error)}`];
    }
    if (!attempt.stateAfter || !attempt.deadState || !attempt.liveFrame) {
      drainedValidatorErrors.push('schema-2 receipt remained incomplete after the post-transaction failure');
    }
    const finalCaptureErrors = [...new Set([
      ...finalCandidate.validatorErrors,
      ...attempt.errors.map((entry) => `retained ${entry.stage} error: ${entry.message}`),
      ...drainedValidatorErrors,
    ])];
    finalCandidate.receipt = structuredClone(finalCaptureThenTap);
    finalCandidate.status = finalCaptureErrors.length === 0 ? 'ACCEPTED_PENDING_GATE_RESOLUTION' : 'REJECTED';
    finalCandidate.validatorErrors = [...finalCaptureErrors];
    finalCandidate.finalDrain = {
      recordedUtc: new Date().toISOString(),
      nativeDeliveryEvents: structuredClone(finalNativeDeliveryEvents),
      nativeListenerRegistration: structuredClone(finalCaptureThenTap.nativeListenerRegistration),
      nativeEventDropCounts: structuredClone(finalCaptureThenTap.nativeEventDropCounts),
      nativeErrors: structuredClone(nativeErrors),
      webErrors: structuredClone(results.webErrors),
    };
    recordGateACaptureAttemptCheckpoint(attempt, gateACaptureThenTapJournalPath, {
      stage: 'FINAL_DRAIN_COMPLETE',
      patch: {
        finalCaptureThenTap,
        captureThenTapCandidate: finalCandidate,
        finalValidationStatus: finalCaptureErrors.length === 0 ? 'ACCEPTED' : 'REJECTED',
        finalValidationErrors: [...finalCaptureErrors],
      },
    });
    check(
      'final drained native capture/input evidence remains exact',
      finalCaptureErrors.length === 0,
      'no rejected, dropped, duplicate or late delivery/listener metadata after the final listener drain',
      finalCaptureErrors.join('; '),
    );
    if (gateAFirstBallPending && finalCaptureThenTap) {
      gateAFirstBallPending.evidence.captureThenTap = structuredClone(finalCaptureThenTap);
    }
  } else if (gateAFirstBallPending) {
    check(
      'final drained native capture/input evidence remains exact',
      false,
      'a preserved schema-2 capture-then-tap validation attempt',
      'capture-then-tap attempt is missing',
    );
  }
  const gateResolutionUtc = new Date().toISOString();
  if (gateAFirstBallPending) {
    const failedChecks = results.checks.filter((entry) => !entry.ok);
    const storageStatsFinalized = gateAFirstBallPending.evidence.bracketedStorageStats?.finalEpoch != null
      && gateAFirstBallPending.evidence.bracketedStorageStats?.packageInstallIdentityFinal != null;
    if (!fatal && failedChecks.length === 0 && storageStatsFinalized) {
      const accepted = {
        ...gateAFirstBallPending.evidence,
        harnessFinalStatus: 'ACCEPTED',
        harnessFinishedUtc: gateResolutionUtc,
        crashOrAnrLines: results.logcatCrashes,
        webErrorCount: results.webErrors.length,
        nativeErrorCount: nativeErrors.length,
      };
      writeFileSync(gateAFirstBallPending.boundaryFile, `${JSON.stringify(accepted, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      results.gateAFirstBallEvidence = accepted;
    } else {
      results.gateAFirstBallEvidence = {
        harnessFinalStatus: 'REJECTED',
        firstPlayableBallFileWritten: false,
        failedChecks,
        fatal: fatal?.message ?? null,
        storageStatsFinalized,
      };
    }
  } else if (GATE_A_FIRST_BALL) {
    results.gateAFirstBallEvidence = {
      harnessFinalStatus: 'REJECTED',
      firstPlayableBallFileWritten: false,
      failedChecks: results.checks.filter((entry) => !entry.ok),
      fatal: fatal?.message ?? 'first-playable evidence was not completed',
      storageStatsFinalized: false,
    };
  }
  if (gateACaptureThenTapAttempt) {
    const attemptFinalStatus = results.gateAFirstBallEvidence?.harnessFinalStatus === 'ACCEPTED'
      ? 'ACCEPTED'
      : 'REJECTED';
    finalizeGateACaptureAttempt(gateACaptureThenTapAttempt, gateACaptureThenTapJournalPath, {
      status: attemptFinalStatus,
      failure: fatal?.message ?? (attemptFinalStatus === 'REJECTED' ? 'one or more Gate-A checks failed' : null),
      utc: gateANextAttemptUtc(gateACaptureThenTapAttempt),
    });
    const finalAttemptRecord = writeFinalGateACaptureAttempt(
      gateACaptureThenTapFinalPath,
      gateACaptureThenTapAttempt,
    );
    results.gateACaptureThenTapAttempt = structuredClone(gateACaptureThenTapAttempt);
    results.gateACaptureThenTapAttemptFiles = {
      ...results.gateACaptureThenTapAttemptFiles,
      journal: gateAEvidenceFileRecord(gateACaptureThenTapJournalPath),
      final: finalAttemptRecord,
    };
  }
  const finalizedAttemptUtc = gateACaptureThenTapAttempt?.finalizedUtc
    ? Date.parse(gateACaptureThenTapAttempt.finalizedUtc)
    : Number.NEGATIVE_INFINITY;
  results.finishedUtc = new Date(Math.max(
    Date.now(),
    finalizedAttemptUtc + 1,
    Date.parse(gateResolutionUtc) + 1,
  )).toISOString();
  results.hostUptimeEnd = host('uptime');
  writeFileSync(finalReportPath, JSON.stringify(results, null, 2), { flag: 'wx', mode: 0o600 });
  if (GATE_A_FIRST_BALL) writeGateAEvidenceManifest(OUT, results.sealedWrapperEvidence?.unityPayloadBinding ?? null);
}

console.log('RESULT', JSON.stringify({ label: LABEL, checks: results.checks, failure: results.failure ?? null }));
process.exit(fatal || results.checks.some((entry) => !entry.ok) ? 1 : 0);
