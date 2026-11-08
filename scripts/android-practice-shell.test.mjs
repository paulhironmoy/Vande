#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const wrapper = resolve('scripts/android-practice.sh');
const common = {
  ...process.env,
  ARTIFACT_MODE: 'sealed',
  UNITY: '1',
  HOOKS: '0',
  ANDROID_SERIAL: 'emulator-5584',
  ANDROID_ADB_SERVER_ADDRESS: '127.0.0.1',
  ANDROID_ADB_SERVER_PORT: '5038',
  ADB_LOCAL_TRANSPORT_MAX_PORT: '5553',
  ADB_MDNS_AUTO_CONNECT: '0',
  EXPECTED_APK_SHA256: 'a'.repeat(64),
  EXPECTED_BUILD_ID: '38924bd+0123456789ab',
  UNITY_PAYLOAD_BINDING_PATH: '/private/tmp/vande-release-payload-binding.json',
  EXPECTED_UNITY_PAYLOAD_BINDING_SHA256: 'b'.repeat(64),
};

function reject(env, pattern, args = [], out = '/private/tmp/vande-shell-guard-never-created') {
  const result = spawnSync(wrapper, [out, ...args], {
    cwd: resolve('.'),
    env: { ...common, ...env },
    encoding: 'utf8',
  });
  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, pattern);
}

test('sealed wrapper refuses boot and implicit/protected devices before ADB', () => {
  reject({ BOOT: '1', APK_PATH: '/missing.apk' }, /refuses BOOT=1/u);
  reject({ ANDROID_SERIAL: '', APK_PATH: '/missing.apk' }, /explicit ANDROID_SERIAL/u);
  reject({ ANDROID_SERIAL: 'emulator-5582', APK_PATH: '/missing.apk' }, /protected serial/u);
});

test('sealed wrapper requires a dedicated discovery-disabled ADB endpoint before artifact or device work', () => {
  reject({ ANDROID_ADB_SERVER_ADDRESS: '', APK_PATH: '/missing.apk' }, /ANDROID_ADB_SERVER_ADDRESS=127\.0\.0\.1/u);
  reject({ ANDROID_ADB_SERVER_PORT: '5037', APK_PATH: '/missing.apk' }, /non-default ANDROID_ADB_SERVER_PORT/u);
  reject({ ADB_LOCAL_TRANSPORT_MAX_PORT: '5585', APK_PATH: '/missing.apk' }, /ADB_LOCAL_TRANSPORT_MAX_PORT=5553/u);
  reject({ ADB_MDNS_AUTO_CONNECT: 'adb-tls-connect', APK_PATH: '/missing.apk' }, /ADB_MDNS_AUTO_CONNECT=0/u);
  reject({ ADB_SERVER_SOCKET: 'tcp:127.0.0.1:5037', APK_PATH: '/missing.apk' }, /ADB_SERVER_SOCKET.*unset/u);
  reject({ ADB_SERVER_SOCKET: '', APK_PATH: '/missing.apk' }, /ADB_SERVER_SOCKET.*unset/u);
});

test('sealed wrapper requires no hooks, absolute regular APK and release naming', () => {
  reject({ HOOKS: '1', APK_PATH: '/missing.apk' }, /UNITY=1 and HOOKS=0/u);
  reject({ APK_PATH: 'relative.apk' }, /absolute APK_PATH/u);
  const scratch = mkdtempSync(join(tmpdir(), 'vande-sealed-shell-'));
  const debugApk = join(scratch, 'vande-debug.apk');
  writeFileSync(debugApk, 'not-an-apk');
  reject({ APK_PATH: debugApk }, /refuses debug APK naming/u);
});

test('Gate-A flag matrix rejects before even checking a missing artifact', () => {
  const gate = ['--gate-a-first-ball', '--skip-lifecycle'];
  reject({ APK_PATH: '/missing-release.apk', REQUIRE_PACKAGE_ABSENT: '0' }, /REQUIRE_PACKAGE_ABSENT=1/u, gate);
  reject({ APK_PATH: '/missing-release.apk', REQUIRE_PACKAGE_ABSENT: '1' }, /cannot run --perf/u, [...gate, '--perf']);
  reject({ APK_PATH: '/missing-release.apk', REQUIRE_PACKAGE_ABSENT: '1' }, /cannot run --recheck/u, [...gate, '--recheck']);
  reject({ APK_PATH: '/missing-release.apk', REQUIRE_PACKAGE_ABSENT: '1' }, /refuses.*fallback/u, [...gate, '--allow-unity-fallback']);
  reject({ APK_PATH: '/missing-release.apk', REQUIRE_PACKAGE_ABSENT: '1' }, /skip-lifecycle/u, ['--gate-a-first-ball']);
});

test('sealed H7 sidecar identity rejects in pure preflight before artifact or output work', () => {
  const gate = ['--gate-a-first-ball', '--skip-lifecycle'];
  reject({ APK_PATH: '/missing-release.apk', REQUIRE_PACKAGE_ABSENT: '1', UNITY_PAYLOAD_BINDING_PATH: '' }, /UNITY_PAYLOAD_BINDING_PATH.*absolute/u, gate);
  reject({ APK_PATH: '/missing-release.apk', REQUIRE_PACKAGE_ABSENT: '1', EXPECTED_UNITY_PAYLOAD_BINDING_SHA256: '' }, /EXPECTED_UNITY_PAYLOAD_BINDING_SHA256.*64 lowercase/u, gate);
});

test('sealed evidence output rejects lexical traversal before artifact or output work', () => {
  reject(
    { APK_PATH: '/missing-release.apk', REQUIRE_PACKAGE_ABSENT: '1' },
    /output must be a canonical absolute/u,
    ['--gate-a-first-ball', '--skip-lifecycle'],
    '/private/tmp/../tmp/vande-shell-guard-never-created',
  );
});

test('sealed evidence directory and final report are fail-closed against overwrite', () => {
  const shell = readFileSync(wrapper, 'utf8');
  const harness = readFileSync(resolve('scripts/android-practice.mjs'), 'utf8');
  assert.match(shell, /ARTIFACT_MODE=sealed requires a new evidence directory/u);
  assert.match(harness, /if \(existsSync\(finalReportPath\)\) throw new Error\(`refusing to overwrite/u);
  assert.match(harness, /writeFileSync\(finalReportPath[^\n]+flag: 'wx'/u);
  assert.match(harness, /evidence-manifest\.json/u);
  assert.match(harness, /android\.devices\(\{ host: ADB_ENDPOINT\.host, port: ADB_ENDPOINT\.port \}\)/u);
  assert.match(shell, /requires its dedicated ADB server to expose exactly ANDROID_SERIAL/u);
  assert.match(shell, /refuses to start Playwright unless its dedicated ADB server still exposes exactly/u);
  assert.match(shell, /adb-isolation\.txt/u);
  assert.match(harness, /sealed wrapper did not bind Playwright to the exact one-device ADB endpoint/u);
  assert.match(harness, /sealed Playwright preflight requires exactly its selected ready device on the dedicated ADB endpoint/u);
  assert.match(harness, /results\.logcatCrashes = crashes === '' \? \[\] : crashes\.split/);
  assert.match(harness, /crashOrAnrLines: results\.logcatCrashes,/);
});

test('Gate-A prepares before release, keeps identity work outside the atomic path, and journals rejected attempts', () => {
  const harness = readFileSync(resolve('scripts/android-practice.mjs'), 'utf8');
  const preparation = harness.indexOf("const remotePreparation = runRawAdb(['shell', remotePreparationCommand]);");
  const liveRelease = harness.indexOf("const liveDigest = await toLiveDelivery('gate-a-first-ball');", preparation);
  const preObservation = harness.indexOf("const stateBefore = await gateAObservation('live-frame-before', {", liveRelease);
  const atomicTransaction = harness.indexOf("const captureTransaction = runRawAdbObserved(['shell', captureCommand]);", preObservation);
  const transactionStdoutWritten = harness.indexOf('const transactionStdoutFile = writeGateABoundedRawEvidence(', atomicTransaction);
  const transactionStderrWritten = harness.indexOf('const transactionStderrFile = writeGateABoundedRawEvidence(', transactionStdoutWritten);
  const attemptCreated = harness.indexOf('gateACaptureThenTapAttempt = createGateACaptureAttempt({', transactionStderrWritten);
  const initialWritten = harness.indexOf('const initialAttemptRecord = writeInitialGateACaptureAttempt(', attemptCreated);
  const rawPull = harness.indexOf("const pulledLiveFrame = runRawAdbObserved(['exec-out', 'cat', remoteLiveFile]);", initialWritten);
  const rawPullWritten = harness.indexOf('const rawCaptureFile = writeGateABoundedRawEvidence(', rawPull);
  const rawPullStderrWritten = harness.indexOf('const rawCaptureStderrFile = writeGateABoundedRawEvidence(', rawPullWritten);
  const decoded = harness.indexOf('const captureOutput = decodeGateACaptureThenTapOutput(', rawPullStderrWritten);
  const parsed = harness.indexOf('parseGateACaptureThenTapOutput(captureOutput, remoteLiveFile)', decoded);
  const postObservation = harness.indexOf("const stateAfter = await gateAObservation('capture-then-tap-after');", parsed);
  const rawCaptureReread = harness.indexOf('const persistedRawCaptureBytes = readFileSync(gateARawCapturePath);', postObservation);
  const pngValidated = harness.indexOf('const pulledPng = gateAPngDimensions(persistedRawCaptureBytes);', rawCaptureReread);
  const derivedLiveFrame = harness.indexOf('writeNew(liveFile, persistedRawCaptureBytes);', pngValidated);
  assert.ok(preparation >= 0 && preparation < liveRelease, 'remote path preparation must finish before live release');
  assert.ok(liveRelease < preObservation && preObservation < atomicTransaction, 'pre-observation must follow release and precede atomic transaction');
  assert.ok(atomicTransaction < transactionStdoutWritten && transactionStdoutWritten < transactionStderrWritten,
    'returned transaction bytes must be retained before interpretation');
  assert.ok(transactionStderrWritten < attemptCreated && attemptCreated < initialWritten,
    'immutable attempt must be created immediately from retained returned bytes');
  assert.ok(initialWritten < rawPull && rawPull < rawPullWritten && rawPullWritten < rawPullStderrWritten,
    'one best-effort raw pull and both returned streams must follow the immutable initial attempt');
  assert.ok(rawPullStderrWritten < decoded && decoded < parsed && parsed < postObservation,
    'strict decode/parse and fresh identity work must follow all raw persistence');
  assert.ok(postObservation < rawCaptureReread && rawCaptureReread < pngValidated && pngValidated < derivedLiveFrame,
    'PNG checks must derive from reread neutral raw bytes before live-frame.png is created');
  const criticalInterval = harness.slice(preObservation, atomicTransaction);
  assert.match(criticalInterval, /identityMode: 'preverified'/u);
  assert.doesNotMatch(criticalInterval, /collectAndroidDeviceIdentity|cat \/proc\/uptime|host\('uptime'\)/u);
  assert.match(harness, /hostUptime: identityMode === 'fresh' \? host\('uptime'\) : lightweightHostUptime\(\)/u);
  assert.match(harness, /identityMode === 'fresh'\n\s+\? await collectAndroidDeviceIdentity/u);
  assert.match(harness, /gateAPreverifiedDeviceIdentity = Object\.freeze\(structuredClone\(results\.deviceIdentityInitial\)\)/u);
  assert.match(harness, /: structuredClone\(gateAPreverifiedDeviceIdentity\);/u);
  assert.match(harness, /Android identity changed between the preverified install boundary and full post-transaction observation/u);
  assert.equal(harness.match(/runRawAdbObserved\(\['exec-out', 'cat', remoteLiveFile\]\)/gu)?.length, 1);
  assert.match(harness, /maxBuffer: GATE_A_RAW_EVIDENCE_MAX_BYTES \/ 2/u);
  assert.doesNotMatch(harness.slice(atomicTransaction, decoded), /\.toString\('utf8'\)/u);
  for (const rawPath of [
    'gateATransactionStdoutPath', 'gateATransactionStderrPath', 'gateARawCapturePath', 'gateARawCaptureStderrPath',
  ]) {
    assert.match(harness, new RegExp(`gateACaptureThenTapFinalPath,\\n\\s+${rawPath}|${rawPath},`, 'u'));
  }

  const receiptValidation = harness.indexOf('captureThenTapErrors = validateGateACaptureThenTapReceipt(', initialWritten);
  assert.ok(initialWritten < receiptValidation, 'immutable attempt must be durable before validator execution');
  assert.match(harness, /gateACaptureDirectoryPrepareCommand\(remoteLiveFile\)/u);
  assert.match(harness, /recordGateACaptureAttemptCheckpoint\(gateACaptureThenTapAttempt/u);
  assert.match(harness, /recordGateACaptureAttemptError\(gateACaptureThenTapAttempt/u);
  assert.match(harness, /finalizeGateACaptureAttempt\(gateACaptureThenTapAttempt/u);
  assert.match(harness, /writeFinalGateACaptureAttempt\(/u);
  assert.match(harness, /journal: gateAEvidenceFileRecord\(gateACaptureThenTapJournalPath\)/u);
  assert.match(harness, /results\.gateACaptureThenTapAttempt = structuredClone\(gateACaptureThenTapAttempt\)/u);
  const finalAttemptWritten = harness.indexOf('const finalAttemptRecord = writeFinalGateACaptureAttempt(');
  const reportFinished = harness.indexOf('results.finishedUtc = new Date(Math.max(', finalAttemptWritten);
  const reportWritten = harness.indexOf('writeFileSync(finalReportPath', reportFinished);
  assert.ok(finalAttemptWritten < reportFinished && reportFinished < reportWritten,
    'report finish must be recorded only after final attempt persistence');
  assert.match(harness, /finalizedAttemptUtc \+ 1/u);
  assert.match(harness, /else if \(GATE_A_FIRST_BALL\) \{\n\s+results\.gateAFirstBallEvidence = \{\n\s+harnessFinalStatus: 'REJECTED'/u);
});

test('sealed install completion follows a distinct post-install artifact check and exact package inventory', () => {
  const shell = readFileSync(wrapper, 'utf8');
  const install = shell.indexOf('install -r "$SEALED_INSTALL_APK"');
  const postCheck = shell.indexOf('--output "$OUT/install-artifact-post-check.json"');
  const inventory = shell.indexOf('capture-installed-inventory');
  const completion = shell.indexOf('finish-install');
  assert.ok(install >= 0 && install < postCheck, 'post-install artifact check must follow install');
  assert.ok(postCheck < inventory, 'inventory must follow the post-install artifact check');
  assert.ok(inventory < completion, 'completion receipt must follow both post-install proofs');
  assert.match(shell, /--post-install-artifact-check-file "\$OUT\/install-artifact-post-check\.json"/u);
  assert.match(shell, /--inventory-file "\$OUT\/post-install-package-inventory\.json"/u);
});

test('runtime inventory feeds untrimmed device output to the shared exact parsers', () => {
  const harness = readFileSync(resolve('scripts/android-practice.mjs'), 'utf8');
  assert.match(harness, /const shellRaw = \(command\) => device\.shell\(command\)\.then\(\(buffer\) => buffer\.toString\(\)\);/u);
  assert.match(harness, /const raw = await shellRaw\(`pm path \$\{PKG\}`\);/u);
  assert.match(harness, /parseExactInstalledPackagePathOutput\(raw\)/u);
  assert.match(harness, /const hashOutput = await shellRaw\(`sha256sum \$\{path\}`\);/u);
  assert.match(harness, /parseExactInstalledApkHashOutput\(hashOutput, path\)/u);
});

test('sealed wrapper preserves promoted APK basename and runs two full verifier rechecks at exact install boundaries', () => {
  const shell = readFileSync(wrapper, 'utf8');
  assert.match(shell, /SEALED_INSTALL_APK="\$OUT\/sealed-artifact\/\$\{APK_PATH##\*\/\}"/u);
  const initialCall = /verify_gate_a_unity_payload \\\n+ {4}"\$OUT\/unity-payload-binding-admission\.json" \\\n+ {4}"\$OUT\/unity-payload-binding-admission-source-bracket\.json"/u;
  const preinstallCall = /verify_gate_a_unity_payload \\\n+ {4}"\$OUT\/unity-payload-binding-preinstall-recheck\.json" \\\n+ {4}"\$OUT\/unity-payload-binding-preinstall-recheck-source-bracket\.json"\n {2}node scripts\/android-gate-a-receipt\.mjs start-install/u;
  const finalCall = /--output "\$OUT\/install-artifact-final-check\.json"\n {2}verify_gate_a_unity_payload \\\n+ {4}"\$OUT\/unity-payload-binding-final-recheck\.json" \\\n+ {4}"\$OUT\/unity-payload-binding-final-recheck-source-bracket\.json"\n {2}set \+e\n {2}"\$ADB" -s "\$DEVICE_SERIAL" install -r "\$SEALED_INSTALL_APK"/u;
  assert.match(shell, initialCall);
  assert.match(shell, preinstallCall);
  assert.match(shell, finalCall);
  const initial = shell.search(initialCall);
  const deviceSelection = shell.indexOf('select_ready_device ||');
  assert.ok(initial >= 0 && initial < deviceSelection, 'initial full H7 admission must precede ADB/device selection');
  assert.match(shell, /Initial Unity payload admission evidence changed before the install transaction/u);
});
