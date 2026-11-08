#!/usr/bin/env node

import { constants, copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _android as android } from 'playwright-core';
import {
  assertValidManifest,
  defaultEvidenceDir,
  ensureNewDirectory,
  fileRecord,
  hostUptime,
  integerOption,
  numberOption,
  parseArgs,
  probeMediaEvidence,
  readJson,
  runBounded,
  safeId,
  sha256File,
  sourceBuildId,
  toolVersions,
  utcNow,
  writeJsonNew,
} from './lib.mjs';

const PACKAGE = 'in.vande.cricket';
const RENDERERS = new Set(['unity-native', 'three-webgl', 'classic']);
const SCENARIOS = new Set(['leave', 'defence', 'grounded_drive', 'square_response', 'lofted_attack', 'mistime_or_miss']);
const ADB_CAPTURE_METHOD = 'bounded adb screenrecord of an already-open installed application; no launch, install, uninstall or data clear';
const ADB_CAPTURE_PERTURBATIONS = Object.freeze([
  'ADB screenrecord can perturb device performance; recorder-on/off control is required for performance claims.',
]);

export function canonicalAdbCapturePerturbations() {
  return [...ADB_CAPTURE_PERTURBATIONS];
}

function validateToken(value, name, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`${name} contains unsafe characters`);
  return value;
}


export function validateAndroidIdentityEvidence(value, { sourceId, serial, renderer, trusted = null }) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['identity evidence is not an object'];
  if (value.buildId !== sourceId) errors.push(`buildId ${value.buildId ?? 'missing'} != current source ${sourceId}`);
  if (value.expectedBuildId !== sourceId) errors.push(`expectedBuildId ${value.expectedBuildId ?? 'missing'} != current source ${sourceId}`);
  const installed = value.installedBuildIdentity;
  if (!installed || installed.observedDom !== sourceId || installed.observedEvidenceSurface !== sourceId) {
    errors.push('installed DOM/evidence-surface identity does not exactly match current source');
  }
  if (value.device?.serial !== serial) errors.push(`identity-evidence serial ${value.device?.serial ?? 'missing'} != requested ${serial}`);
  const rendererRows = Array.isArray(value.rendererEvidence) ? value.rendererEvidence : [];
  const matchingRenderer = rendererRows.find((row) => row?.renderer === renderer);
  if (!matchingRenderer) errors.push(`identity evidence does not contain renderer ${renderer}`);
  if (renderer === 'unity-native' && matchingRenderer?.selectionClassification !== 'unity_native') {
    errors.push('Unity renderer row is not classified as unity_native');
  }
  if (value.practiceTestApiPresent !== false) errors.push('identity evidence does not prove the Practice test API absent');
  if (!trusted || typeof trusted !== 'object') return [...errors, 'trusted tool-derived Android identity binding is missing'];
  if (trusted.artifactBuildId !== sourceId) errors.push(`installed APK embedded build ${trusted.artifactBuildId ?? 'missing'} != current source ${sourceId}`);
  if (!/^[0-9a-f]{64}$/.test(trusted.artifactInventorySha256 ?? '')) errors.push('installed artifact inventory hash is missing');
  const runtime = Array.isArray(trusted.runtimeObservations) ? trusted.runtimeObservations : [];
  if (runtime.length < 2) errors.push('live runtime must be observed before and after recording');
  for (const [index, observation] of runtime.entries()) {
    if (observation?.buildId !== sourceId) errors.push(`runtime observation ${index} build ID does not match current source`);
    if (observation?.renderer !== renderer) errors.push(`runtime observation ${index} renderer does not match ${renderer}`);
    if (observation?.practiceTestApiPresent !== false) errors.push(`runtime observation ${index} does not prove the Practice test API absent`);
    if (renderer === 'unity-native' && (typeof observation?.admission !== 'string' || observation.admission.length === 0)) errors.push(`runtime observation ${index} lacks Unity admission proof`);
  }
  const foreground = Array.isArray(trusted.foregroundObservations) ? trusted.foregroundObservations : [];
  if (foreground.length < 2 || foreground.some((item) => item?.packageId !== PACKAGE || item?.obscured === true)) errors.push('foreground package was not continuously bounded to VANDE before/after recording');
  if (renderer === 'unity-native' && trusted.installedUnityRuntime !== true) errors.push('installed APK bytes do not contain the native Unity runtime proof set');
  return errors;
}

function adb(serial, args, options = {}) {
  return runBounded('adb', ['-s', serial, ...args], options);
}

function parsePackage(dumpsys) {
  const versionName = dumpsys.match(/\bversionName=([^\s]+)/)?.[1] ?? null;
  const versionCode = dumpsys.match(/\bversionCode=(\d+)/)?.[1] ?? null;
  return { versionName, versionCode };
}

function parseWmSize(text) {
  const observed = [...text.matchAll(/(?:Override|Physical) size:\s*(\d+)x(\d+)/g)];
  const last = observed.at(-1);
  return last ? { width: Number(last[1]), height: Number(last[2]) } : null;
}

const EMBEDDED_BUILD_ID_PATTERN = /(?<![0-9a-f])([0-9a-f]{7,40}(?:\+[0-9a-f]{12})?)(?![0-9a-f])/g;

export function extractBuildIdsFromText(text) {
  if (typeof text !== 'string') return [];
  const ids = [];
  for (const match of text.matchAll(EMBEDDED_BUILD_ID_PATTERN)) {
    const candidate = match[1];
    const offset = match.index ?? 0;
    const context = text.slice(Math.max(0, offset - 256), Math.min(text.length, offset + candidate.length + 256));
    // Dirty IDs carry a repository-specific suffix. Clean commit IDs are
    // ambiguous hex, so admit them only beside a shipped build-identity key.
    if (candidate.includes('+') || /data-vande-build-id|__BUILD_ID__|["']buildId["']/.test(context)) ids.push(candidate);
  }
  return [...new Set(ids)].sort();
}

function foregroundPackage(serial, expectedPackage) {
  const activities = adb(serial, ['shell', 'dumpsys', 'activity', 'activities'], { timeoutMs: 15_000 }).stdout;
  const windows = adb(serial, ['shell', 'dumpsys', 'window', 'windows'], { timeoutMs: 15_000 }).stdout;
  const componentPackage = (line) => line?.match(/\b([A-Za-z0-9._]+)\/[A-Za-z0-9.$_]+/)?.[1] ?? null;
  const resumedLine = activities.split(/\r?\n/).find((line) => /(?:topResumedActivity|mResumedActivity)/.test(line)) ?? null;
  const focusLine = windows.split(/\r?\n/).find((line) => /mCurrentFocus/.test(line)) ?? null;
  const resumedPackage = componentPackage(resumedLine);
  const focusPackage = componentPackage(focusLine);
  return {
    checkedAtUtc: utcNow(),
    packageId: resumedPackage === expectedPackage && focusPackage === expectedPackage ? expectedPackage : null,
    resumedPackage,
    focusPackage,
    obscured: resumedPackage !== expectedPackage || focusPackage !== expectedPackage,
  };
}

function deriveInstalledArtifactIdentity(apkFiles) {
  const ids = new Set();
  const proof = [];
  let installedUnityRuntime = false;
  for (const apk of apkFiles) {
    const entriesResult = runBounded('unzip', ['-Z1', apk], { timeoutMs: 30_000, allowFailure: true });
    if (entriesResult.status !== 0) continue;
    const entries = entriesResult.stdout.split(/\r?\n/).filter(Boolean);
    if (entries.some((entry) => /^lib\/[^/]+\/libunity\.so$/.test(entry)) && entries.includes('assets/bin/Data/unity_app_guid')) installedUnityRuntime = true;
    if (!entries.includes('assets/public/index.html')) continue;
    const html = runBounded('unzip', ['-p', apk, 'assets/public/index.html'], { timeoutMs: 20_000 }).stdout;
    const scriptPaths = [...html.matchAll(/<script\b[^>]*\bsrc=["']\/?([^"']+\.js)["']/gi)].map((match) => `assets/public/${match[1].replace(/^assets\//, 'assets/')}`);
    for (const entry of scriptPaths) {
      if (!entries.includes(entry)) continue;
      const script = runBounded('unzip', ['-p', apk, entry], { timeoutMs: 30_000 }).stdout;
      const found = extractBuildIdsFromText(script);
      for (const id of found) ids.add(id);
      proof.push({ apkSha256: sha256File(apk), indexEntry: 'assets/public/index.html', scriptEntry: entry, observedBuildIds: [...new Set(found)] });
    }
  }
  return { buildId: ids.size === 1 ? [...ids][0] : null, observedBuildIds: [...ids].sort(), installedUnityRuntime, proof };
}

async function observeInstalledRuntime(serial, packageId) {
  const connected = await android.devices();
  try {
    const device = connected.find((candidate) => candidate.serial() === serial);
    if (!device) throw new Error(`Playwright Android cannot observe ${serial}`);
    const webview = await device.webView({ pkg: packageId }, { timeout: 30_000 });
    const page = await webview.page();
    return await page.evaluate(() => ({
      checkedAtUtc: new Date().toISOString(),
      buildId: document.documentElement.getAttribute('data-vande-build-id'),
      renderer: document.documentElement.getAttribute('data-vande-practice-renderer'),
      admission: document.documentElement.getAttribute('data-vande-unity-practice'),
      practiceTestApiPresent: Boolean(window.__vandePractice),
      url: location.href,
    }));
  } finally {
    for (const device of connected) await device.close().catch(() => undefined);
  }
}

function remoteArtifactHashes(serial, packagePaths) {
  return packagePaths.map((path) => {
    const result = adb(serial, ['shell', 'sha256sum', path], { timeoutMs: 30_000, allowFailure: true });
    const sha256 = result.status === 0 ? result.stdout.trim().match(/^([0-9a-f]{64})\b/)?.[1] ?? null : null;
    return { path, sha256 };
  });
}

export function validateArtifactHashWindow(before, after, localInventory) {
  const errors = [];
  if (!Array.isArray(before) || !Array.isArray(after) || before.length === 0 || before.length !== after.length) return ['installed APK hash windows are missing or have different lengths'];
  const local = new Map((localInventory ?? []).map((item) => [item.remotePath, item.sha256]));
  for (let index = 0; index < before.length; index += 1) {
    const first = before[index];
    const last = after[index];
    if (first?.path !== last?.path) errors.push(`installed APK path changed at index ${index}`);
    if (!/^[0-9a-f]{64}$/.test(first?.sha256 ?? '') || !/^[0-9a-f]{64}$/.test(last?.sha256 ?? '')) errors.push(`installed APK hash is unavailable at index ${index}`);
    if (first?.sha256 !== last?.sha256) errors.push(`installed APK bytes changed during recording: ${first?.path ?? index}`);
    if (local.get(first?.path) !== first?.sha256) errors.push(`pulled APK bytes differ from installed bytes: ${first?.path ?? index}`);
  }
  return errors;
}

function recordAndroidScreen({ serial, captureId, durationSeconds, bitRate, raw, errors }) {
  const remote = `/sdcard/${captureId.replaceAll(/[^a-z0-9._-]/g, '-')}.mp4`;
  const videoFile = join(raw, 'capture.mp4');
  try {
    const record = runBounded('nice', [
      '-n', '15', 'adb', '-s', serial, 'shell', 'screenrecord',
      '--bit-rate', String(bitRate), '--time-limit', String(durationSeconds), remote,
    ], { timeoutMs: (durationSeconds + 20) * 1000, allowFailure: true });
    if (record.status !== 0) errors.push(`adb screenrecord exited ${record.status}: ${String(record.stderr || '').trim().slice(0, 1000)}`);
    adb(serial, ['pull', remote, videoFile], { timeoutMs: 120_000 });
    return existsSync(videoFile) ? videoFile : null;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return null;
  } finally {
    // Remove only the explicit temporary recording this script created; never alter application data.
    adb(serial, ['shell', 'rm', '-f', remote], { allowFailure: true, timeoutMs: 10_000 });
  }
}

function androidDevice(serial) {
  const get = (key) => adb(serial, ['shell', 'getprop', key], { timeoutMs: 10_000, allowFailure: true }).stdout.trim() || null;
  const mem = adb(serial, ['shell', 'cat', '/proc/meminfo'], { timeoutMs: 10_000, allowFailure: true }).stdout.match(/^MemTotal:\s*(\d+)\s*kB/m)?.[1] ?? null;
  return {
    serial,
    model: get('ro.product.model'),
    release: get('ro.build.version.release'),
    api: get('ro.build.version.sdk'),
    buildFingerprint: get('ro.build.fingerprint'),
    securityPatch: get('ro.build.version.security_patch'),
    buildId: get('ro.build.id'),
    soc: get('ro.soc.model') ?? get('ro.board.platform'),
    memKb: mem,
  };
}

export function canonicalAndroidOs(device) {
  const exact = (value) => typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  const release = exact(device?.release);
  const api = exact(device?.api);
  const buildFingerprint = exact(device?.buildFingerprint);
  const securityPatch = exact(device?.securityPatch);
  const buildId = exact(device?.buildId);
  if (!release || !api || !buildFingerprint || !securityPatch || !buildId) return null;
  const serialized = `Android ${JSON.stringify({
    release,
    api,
    buildFingerprint,
    securityPatch,
    buildId,
  })}`;
  return serialized.length <= 512 ? serialized : null;
}

function requireCanonicalAndroidOs(device, errors) {
  const os = canonicalAndroidOs(device);
  if (!os) {
    errors.push('Exact Android OS build identity is unavailable; release, API, build fingerprint, security patch and build ID are mandatory and the canonical value must fit the manifest contract');
  }
  return os;
}

function androidDeviceIdentity(device) {
  if (!device?.serial) return device?.model ?? null;
  return `${device.model ?? 'unknown Android device'} / adb:${device.serial}`.slice(0, 256);
}

function probeVideo(file) {
  if (!file) return null;
  try {
    const observation = probeMediaEvidence(file).observation;
    return {
      resolution: { width: observation.width, height: observation.height },
      frameRate: observation.frameRate,
      codec: observation.codec,
      durationMs: observation.durationMs,
    };
  } catch {
    return null;
  }
}

export async function captureControlledCompetitor(options) {
  const serial = validateToken(options.serial, '--serial', /^[A-Za-z0-9._:-]{1,128}$/);
  const packageId = validateToken(options.package_id, '--package-id', /^[A-Za-z0-9._]{3,256}$/);
  if (!options.title || !options.store) throw new Error('--title and --store are required for controlled competitor capture');
  if (!options.terms_reviewed) throw new Error('--terms-reviewed is required; do not record a competitor before reviewing the applicable terms');
  if (!options.human_input_confirmed) throw new Error('--human-input-confirmed is required; competitor automation/instrumentation is prohibited');
  if (options.scenario && !SCENARIOS.has(options.scenario)) throw new Error('--scenario must be a preregistered six-intent class ID');
  const durationSeconds = integerOption(options.duration_seconds, '--duration-seconds', { min: 5, max: 180, fallback: 30 });
  const bitRate = integerOption(options.bit_rate, '--bit-rate', { min: 1_000_000, max: 100_000_000, fallback: 12_000_000 });
  const out = ensureNewDirectory(options.output_dir ?? defaultEvidenceDir('controlled-competitor'), { rawEvidence: true });
  const raw = join(out, 'raw');
  mkdirSync(raw, { recursive: true, mode: 0o700 });
  const capturedAtUtc = utcNow();
  const captureId = options.capture_id ?? safeId(`controlled-${String(options.title).toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`, capturedAtUtc);
  const evaluator = options.evaluator ?? 'capture-operator';
  const errors = [];
  const started = Date.now();

  const devices = adb(serial, ['devices'], { timeoutMs: 10_000 }).stdout;
  if (!devices.split(/\r?\n/).some((line) => line.startsWith(`${serial}\tdevice`))) throw new Error(`ADB device ${serial} is not in device state`);
  const dumpsys = adb(serial, ['shell', 'dumpsys', 'package', packageId], { timeoutMs: 20_000 }).stdout;
  if (!dumpsys.includes(`Package [${packageId}]`)) throw new Error(`${packageId} is not lawfully installed on ${serial}`);
  const pkg = parsePackage(dumpsys);
  const version = pkg.versionName ? `${pkg.versionName}${pkg.versionCode ? ` (${pkg.versionCode})` : ''}` : pkg.versionCode;
  if (!version) throw new Error(`Cannot derive installed version for ${packageId}`);
  const device = androidDevice(serial);
  const androidOs = requireCanonicalAndroidOs(device, errors);
  const viewport = parseWmSize(adb(serial, ['shell', 'wm', 'size'], { timeoutMs: 10_000 }).stdout);
  const foregroundBefore = foregroundPackage(serial, packageId);
  if (foregroundBefore.obscured) errors.push(`Expected ${packageId} foreground before recording; resumed=${foregroundBefore.resumedPackage ?? 'missing'}, focus=${foregroundBefore.focusPackage ?? 'missing'}`);
  const videoFile = recordAndroidScreen({ serial, captureId, durationSeconds, bitRate, raw, errors });
  const deviceAfter = androidDevice(serial);
  if (canonicalAndroidOs(deviceAfter) !== androidOs) errors.push('Exact Android OS build identity changed or became unavailable during recording');
  const foregroundAfter = foregroundPackage(serial, packageId);
  if (foregroundAfter.obscured) errors.push(`Expected ${packageId} foreground after recording; resumed=${foregroundAfter.resumedPackage ?? 'missing'}, focus=${foregroundAfter.focusPackage ?? 'missing'}`);
  const packageAfter = parsePackage(adb(serial, ['shell', 'dumpsys', 'package', packageId], { timeoutMs: 20_000 }).stdout);
  if (packageAfter.versionName !== pkg.versionName || packageAfter.versionCode !== pkg.versionCode) errors.push(`${packageId} version changed during recording`);
  const video = probeVideo(videoFile);
  if (videoFile && !(typeof video?.durationMs === 'number' && video.durationMs > 0)) errors.push('Recorded video duration could not be verified with ffprobe');
  const bindingFile = join(out, 'foreground-binding.json');
  writeJsonNew(bindingFile, { schemaVersion: 1, packageId, serial, deviceBefore: device, deviceAfter, androidOs, versionBefore: pkg, versionAfter: packageAfter, observations: [foregroundBefore, foregroundAfter] });
  const files = [fileRecord(bindingFile, out, 'foreground_binding', { mimeType: 'application/json', raw: true })];
  if (videoFile) files.unshift(fileRecord(videoFile, out, 'raw_video', { mimeType: 'video/mp4', raw: true, durationMs: video?.durationMs ?? null }));
  const manifest = {
    schemaVersion: 1,
    captureId,
    lane: 'controlled_competitor',
    evidenceClass: 'raw',
    status: errors.length === 0 && videoFile ? 'captured' : 'failed',
    evaluator: { id: evaluator, role: 'capture operator', authoredSubject: false, independent: true },
    rights: {
      basis: 'Lawfully installed title on an owned comparison device; applicable terms reviewed by the operator; internal evaluation only',
      sourceUrl: null,
      redistribution: 'prohibited',
      notes: ['Do not commit, publish or redistribute this media.', 'No competitor instrumentation, modification, automation injection or protection bypass was used.'],
    },
    identity: {
      repositorySourceId: null,
      embeddedBuildId: null,
      artifact: null,
      application: { title: String(options.title), packageId, version, store: String(options.store) },
      renderer: { claimed: null, observed: 'undisclosed-proprietary-runtime', admission: null, proof: 'No renderer internals claimed; package/version derived from Android package manager.' },
    },
    timing: { capturedAtUtc, hostUptime: hostUptime(), durationMs: Date.now() - started },
    environment: {
      platform: 'Android',
      device: androidDeviceIdentity(device),
      os: androidOs,
      soc: device.soc,
      gpu: null,
      ramMb: device.memKb ? Number(device.memKb) / 1024 : null,
      viewport: (video?.resolution ?? viewport) ? { width: (video?.resolution ?? viewport).width, height: (video?.resolution ?? viewport).height, deviceScaleFactor: 1 } : null,
      orientation: (video?.resolution ?? viewport) ? ((video?.resolution ?? viewport).width >= (video?.resolution ?? viewport).height ? 'landscape' : 'portrait') : null,
      refreshHz: options.refresh_hz === undefined ? null : numberOption(options.refresh_hz, '--refresh-hz', { min: 1, max: 1000 }),
      qualityTier: options.quality_tier ?? null,
      thermal: options.thermal ?? null,
      battery: null,
      power: null,
      network: options.network ?? null,
      backgroundLoad: hostUptime(),
    },
    gameplay: {
      scenario: options.scenario ?? 'operator-selected matched six-intent comparison sequence',
      seed: null,
      controls: 'physical human touch; no automation or instrumentation',
      inputMethod: 'human',
      assistance: options.assistance ?? null,
      handedness: options.handedness ?? null,
      pitch: options.pitch ?? null,
      field: options.field ?? null,
      timeScale: 1,
      wholeSequence: options.whole_sequence_confirmed === true,
    },
    capture: {
      method: ADB_CAPTURE_METHOD,
      recorder: { class: 'adb_screenrecord', bitRateBps: bitRate },
      resolution: video?.resolution ?? null,
      frameRate: video?.frameRate ?? null,
      codec: video?.codec ?? 'Android screenrecord MP4; codec not probed',
      audio: { method: 'none', synchronized: false, limitations: ['ADB screenrecord contains no game audio.'] },
      perturbations: canonicalAdbCapturePerturbations(),
      limitations: [
        'No hidden engine telemetry, FPS, latency, physics or control correctness is inferred.',
        'Human operation during capture is not a blinded player study or preference result.',
        'Later annotation must disclose scenario mismatch, settings and whether the full sequence was retained.',
      ],
    },
    files,
    sidecars: { events: [basename(bindingFile)], physics: [], replay: [], frames: [], annotations: [] },
    transformations: [],
    applicability: {
      metrics: {
        time_to_first_playable_ball_ms: 'eligible',
        ball_diameter_release_px: 'eligible',
        ball_diameter_bounce_px: 'eligible',
        ball_diameter_contact_px: 'eligible',
        ball_track_continuity_percent: 'eligible',
        decision_corridor_occlusion_percent: 'eligible',
        camera_cut_count: 'eligible',
        contact_to_impact_audio_ms: 'not_available',
        physical_event_to_score_ms: 'eligible',
        physical_event_to_crowd_ms: 'eligible',
        result_to_next_playable_ms: 'eligible',
        dead_time_ratio_percent: 'eligible',
        hud_occupancy_percent: 'eligible',
        persistent_control_count: 'eligible',
        duplicate_frame_rate_percent: 'eligible',
        outcome_replay_contradiction_count: 'eligible',
      },
      excludedClaims: [
        'engine FPS, input latency, physics correctness or hidden control recognition',
        'audio timing',
        'human preference, fun, fairness, mastery or repeat desire',
        'quality superiority from video alone',
      ],
    },
    expectedScenario: options.expected_scenario ?? 'Closest lawful match to one preregistered six-intent scenario on the matched comparison phone.',
    observedDeviations: options.deviation ? [String(options.deviation)] : [],
    errors,
    tools: toolVersions({ adb: runBounded('adb', ['version'], { allowFailure: true, timeoutMs: 5_000 }).stdout?.trim() ?? null }),
  };
  assertValidManifest(manifest, { root: out, verifyFiles: true });
  const manifestPath = writeJsonNew(join(out, 'manifest.json'), manifest);
  return { ok: manifest.status === 'captured', status: manifest.status === 'captured' ? 'CAPTURED_CONTROLLED_COMPETITOR' : 'FAILED', output: out, manifest: manifestPath, errors };
}

function baseManifest({
  captureId,
  sourceId,
  renderer,
  embeddedBuildId,
  observedRenderer,
  admission,
  rendererProof,
  artifact,
  applicationVersion,
  capturedAtUtc,
  durationMs,
  device,
  viewport,
  media,
  qualityTier,
  refreshHz,
  thermal,
  network,
  scenario,
  assistance,
  handedness,
  pitch,
  field,
  wholeSequence,
  files,
  identityEvidencePath,
  inventoryPath,
  bindingPath,
  humanInput,
  errors,
  evaluator,
  bitRate,
}) {
  const captured = errors.length === 0 && files.some((item) => item.role === 'raw_video');
  return {
    schemaVersion: 1,
    captureId,
    lane: 'vande_engine_truth',
    evidenceClass: humanInput ? 'raw' : 'diagnostic',
    status: captured ? 'captured' : 'failed',
    evaluator: { id: evaluator, role: 'capture operator', authoredSubject: false, independent: false },
    rights: {
      basis: 'VANDE-owned installed application captured on an authorized Android device',
      sourceUrl: null,
      redistribution: 'owned',
      notes: ['Installed APK splits are pulled read-only to bind the capture to device bytes.'],
    },
    identity: {
      repositorySourceId: sourceId,
      embeddedBuildId,
      artifact,
      application: { title: 'VANDE Cricket', packageId: PACKAGE, version: applicationVersion, store: null },
      renderer: {
        claimed: renderer,
        observed: observedRenderer,
        admission,
        proof: rendererProof,
      },
    },
    timing: { capturedAtUtc, hostUptime: hostUptime(), durationMs },
    environment: {
      platform: 'Android',
      device: androidDeviceIdentity(device),
      os: canonicalAndroidOs(device),
      soc: null,
      gpu: null,
      ramMb: device?.memKb ? Number(device.memKb) / 1024 : null,
      viewport: (media?.resolution ?? viewport) ? { width: (media?.resolution ?? viewport).width, height: (media?.resolution ?? viewport).height, deviceScaleFactor: 1 } : null,
      orientation: (media?.resolution ?? viewport) ? ((media?.resolution ?? viewport).width >= (media?.resolution ?? viewport).height ? 'landscape' : 'portrait') : null,
      refreshHz,
      qualityTier,
      thermal,
      battery: null,
      power: null,
      network,
      backgroundLoad: hostUptime(),
    },
    gameplay: {
      scenario,
      seed: null,
      controls: humanInput ? 'physical touch, operator attested' : 'unverified input during capture',
      inputMethod: humanInput ? 'human' : 'unknown',
      assistance,
      handedness,
      pitch,
      field,
      timeScale: 1,
      wholeSequence,
    },
    capture: {
      method: ADB_CAPTURE_METHOD,
      recorder: { class: 'adb_screenrecord', bitRateBps: bitRate },
      resolution: media?.resolution ?? null,
      frameRate: media?.frameRate ?? null,
      codec: media?.codec ?? 'Android screenrecord MP4; codec not probed',
      audio: {
        method: 'none',
        synchronized: false,
        limitations: ['ADB screenrecord contains no game audio.'],
      },
      perturbations: canonicalAdbCapturePerturbations(),
      limitations: [
        'This lane cannot prove input-to-photon latency or contact-to-audio timing.',
        'Human input attestation identifies the operator method; it is not a player-study result.',
        'The capture tool does not launch, install, uninstall, clear or alter VANDE application data.',
      ],
    },
    files,
    sidecars: { events: [identityEvidencePath, inventoryPath, bindingPath], physics: [], replay: [], frames: [], annotations: [] },
    transformations: [],
    applicability: {
      metrics: {
        time_to_first_playable_ball_ms: humanInput ? 'eligible' : 'diagnostic_only',
        taps_to_first_playable_ball: 'not_available',
        result_to_next_playable_ms: humanInput ? 'eligible' : 'diagnostic_only',
        duplicate_frame_rate_percent: 'eligible',
        contact_to_impact_audio_ms: 'not_available',
      },
      excludedClaims: [
        'contact-to-audio timing',
        'input-to-photon latency',
        'engine FPS from encoded video',
        'human preference, skill, fun, desire or mastery',
        'release performance without a recorder-off control',
      ],
    },
    expectedScenario: 'Record the already-installed exact-build Practice experience without changing application state or disguising ADB limitations.',
    observedDeviations: ['The script cannot establish a complete setup-to-dead-ball sequence without later annotation.'],
    errors,
    tools: toolVersions({ adb: runBounded('adb', ['version'], { allowFailure: true, timeoutMs: 5_000 }).stdout?.trim() ?? null }),
  };
}

export async function captureAndroid(options) {
  const serial = validateToken(options.serial, '--serial', /^[A-Za-z0-9._:-]{1,128}$/);
  const renderer = options.renderer;
  if (!RENDERERS.has(renderer)) throw new Error(`--renderer must be one of ${[...RENDERERS].join(', ')}`);
  if (options.scenario && !SCENARIOS.has(options.scenario)) throw new Error('--scenario must be a preregistered six-intent class ID');
  const identityFile = resolve(options.identity_evidence ?? '');
  if (!options.identity_evidence || !existsSync(identityFile)) throw new Error('--identity-evidence must name a current Android harness JSON file');
  const durationSeconds = integerOption(options.duration_seconds, '--duration-seconds', { min: 5, max: 180, fallback: 30 });
  const bitRate = integerOption(options.bit_rate, '--bit-rate', { min: 1_000_000, max: 100_000_000, fallback: 12_000_000 });
  const sourceId = sourceBuildId();
  if (options.expected_build_id && options.expected_build_id !== sourceId) {
    throw new Error(`Expected build ID ${options.expected_build_id} does not match derived current source ${sourceId}`);
  }
  const identity = readJson(identityFile);

  const out = ensureNewDirectory(options.output_dir ?? defaultEvidenceDir('android'), { rawEvidence: true });
  const raw = join(out, 'raw');
  const artifacts = join(out, 'installed-artifacts');
  mkdirSync(raw, { recursive: true, mode: 0o700 });
  mkdirSync(artifacts, { recursive: true, mode: 0o700 });
  const capturedAtUtc = utcNow();
  const captureId = options.capture_id ?? safeId(`vande-android-${renderer}`, capturedAtUtc);
  const evaluator = options.evaluator ?? 'capture-tooling-builder';
  const humanInput = options.human_input_confirmed === true;
  const errors = [];
  const files = [];
  const started = Date.now();

  const devices = adb(serial, ['devices'], { timeoutMs: 10_000 }).stdout;
  if (!devices.split(/\r?\n/).some((line) => line.startsWith(`${serial}\tdevice`))) throw new Error(`ADB device ${serial} is not in device state`);
  const dumpsys = adb(serial, ['shell', 'dumpsys', 'package', PACKAGE], { timeoutMs: 20_000 }).stdout;
  if (!dumpsys.includes(`Package [${PACKAGE}]`)) throw new Error(`${PACKAGE} is not installed on ${serial}`);
  const pkg = parsePackage(dumpsys);
  const wm = parseWmSize(adb(serial, ['shell', 'wm', 'size'], { timeoutMs: 10_000 }).stdout);
  const observedDevice = androidDevice(serial);
  requireCanonicalAndroidOs(observedDevice, errors);

  const packagePaths = adb(serial, ['shell', 'pm', 'path', PACKAGE], { timeoutMs: 20_000 }).stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('package:'))
    .map((line) => line.slice('package:'.length));
  if (packagePaths.length === 0) throw new Error(`Cannot enumerate installed APK splits for ${PACKAGE}`);
  const remoteHashesBefore = remoteArtifactHashes(serial, packagePaths);
  const inventory = [];
  const localApks = [];
  for (let index = 0; index < packagePaths.length; index += 1) {
    const remoteApk = packagePaths[index];
    const localApk = join(artifacts, `${String(index).padStart(2, '0')}-${basename(remoteApk)}`);
    adb(serial, ['pull', remoteApk, localApk], { timeoutMs: 120_000 });
    localApks.push(localApk);
    inventory.push({ remotePath: remoteApk, localPath: `installed-artifacts/${basename(localApk)}`, bytes: statSync(localApk).size, sha256: sha256File(localApk) });
    files.push(fileRecord(localApk, out, 'installed_apk_split', { mimeType: 'application/vnd.android.package-archive', raw: true }));
  }
  const inventoryFile = join(out, 'artifact-inventory.json');
  writeJsonNew(inventoryFile, { schemaVersion: 1, packageId: PACKAGE, sourceBuildId: sourceId, serial, splits: inventory });
  files.push(fileRecord(inventoryFile, out, 'artifact_inventory', { mimeType: 'application/json', raw: true }));
  const identityCopy = join(out, 'android-identity-evidence.json');
  copyFileSync(identityFile, identityCopy, constants.COPYFILE_EXCL);
  files.push(fileRecord(identityCopy, out, 'runtime_identity', { mimeType: 'application/json', raw: true }));

  const artifactIdentity = deriveInstalledArtifactIdentity(localApks);
  const foregroundBefore = foregroundPackage(serial, PACKAGE);
  if (foregroundBefore.obscured) errors.push(`Expected ${PACKAGE} foreground before recording; resumed=${foregroundBefore.resumedPackage ?? 'missing'}, focus=${foregroundBefore.focusPackage ?? 'missing'}`);
  let runtimeBefore = null;
  try {
    runtimeBefore = await observeInstalledRuntime(serial, PACKAGE);
  } catch (error) {
    errors.push(`Live runtime observation before recording failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const recordedVideo = recordAndroidScreen({ serial, captureId, durationSeconds, bitRate, raw, errors });
  const observedDeviceAfter = androidDevice(serial);
  if (canonicalAndroidOs(observedDeviceAfter) !== canonicalAndroidOs(observedDevice)) errors.push('Exact Android OS build identity changed or became unavailable during recording');
  const foregroundAfter = foregroundPackage(serial, PACKAGE);
  if (foregroundAfter.obscured) errors.push(`Expected ${PACKAGE} foreground after recording; resumed=${foregroundAfter.resumedPackage ?? 'missing'}, focus=${foregroundAfter.focusPackage ?? 'missing'}`);
  let runtimeAfter = null;
  try {
    runtimeAfter = await observeInstalledRuntime(serial, PACKAGE);
  } catch (error) {
    errors.push(`Live runtime observation after recording failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const remoteHashesAfter = remoteArtifactHashes(serial, packagePaths);
  errors.push(...validateArtifactHashWindow(remoteHashesBefore, remoteHashesAfter, inventory));
  const sourceAfter = sourceBuildId();
  if (sourceAfter !== sourceId) errors.push(`Repository source changed during Android capture: ${sourceId} -> ${sourceAfter}`);
  const media = probeVideo(recordedVideo);
  if (recordedVideo && !(typeof media?.durationMs === 'number' && media.durationMs > 0)) errors.push('Recorded video duration could not be verified with ffprobe');
  if (recordedVideo) files.push(fileRecord(recordedVideo, out, 'raw_video', { mimeType: 'video/mp4', raw: true, durationMs: media?.durationMs ?? null }));

  const trusted = {
    artifactBuildId: artifactIdentity.buildId,
    artifactInventorySha256: sha256File(inventoryFile),
    installedUnityRuntime: artifactIdentity.installedUnityRuntime,
    runtimeObservations: [runtimeBefore, runtimeAfter],
    foregroundObservations: [foregroundBefore, foregroundAfter],
  };
  const identityErrors = validateAndroidIdentityEvidence(identity, { sourceId, serial, renderer, trusted });
  errors.push(...identityErrors.map((error) => `Android identity binding: ${error}`));
  const bindingFile = join(out, 'runtime-artifact-binding.json');
  writeJsonNew(bindingFile, {
    schemaVersion: 1,
    packageId: PACKAGE,
    serial,
    sourceBefore: sourceId,
    sourceAfter,
    deviceBefore: observedDevice,
    deviceAfter: observedDeviceAfter,
    androidOs: canonicalAndroidOs(observedDevice),
    artifactIdentity,
    artifactInventorySha256: sha256File(inventoryFile),
    remoteHashesBefore,
    remoteHashesAfter,
    foregroundObservations: [foregroundBefore, foregroundAfter],
    runtimeObservations: [runtimeBefore, runtimeAfter],
    supportingIdentityEvidenceSha256: sha256File(identityCopy),
  });
  files.push(fileRecord(bindingFile, out, 'runtime_artifact_binding', { mimeType: 'application/json', raw: true }));

  const manifest = baseManifest({
    captureId,
    sourceId,
    renderer,
    embeddedBuildId: artifactIdentity.buildId,
    observedRenderer: runtimeAfter?.renderer ?? runtimeBefore?.renderer ?? null,
    admission: runtimeAfter?.admission ?? runtimeBefore?.admission ?? null,
    rendererProof: `tool-derived runtime/artifact binding ${basename(bindingFile)} sha256=${sha256File(bindingFile)}`,
    artifact: { path: basename(inventoryFile), sha256: sha256File(inventoryFile) },
    applicationVersion: pkg.versionName ? `${pkg.versionName}${pkg.versionCode ? ` (${pkg.versionCode})` : ''}` : pkg.versionCode,
    capturedAtUtc,
    durationMs: Date.now() - started,
    device: observedDevice,
    viewport: wm,
    media,
    qualityTier: options.quality_tier ?? null,
    refreshHz: options.refresh_hz === undefined ? null : numberOption(options.refresh_hz, '--refresh-hz', { min: 1, max: 1000 }),
    thermal: options.thermal ?? null,
    network: options.network ?? null,
    scenario: options.scenario ?? 'unregistered operator-selected Stage 1 Practice sequence',
    assistance: options.assistance ?? null,
    handedness: options.handedness ?? null,
    pitch: options.pitch ?? null,
    field: options.field ?? null,
    wholeSequence: options.whole_sequence_confirmed === true,
    files,
    identityEvidencePath: basename(identityCopy),
    inventoryPath: basename(inventoryFile),
    bindingPath: basename(bindingFile),
    humanInput,
    errors,
    evaluator,
    bitRate,
  });
  assertValidManifest(manifest, { root: out, verifyFiles: true });
  const manifestPath = writeJsonNew(join(out, 'manifest.json'), manifest);
  return { ok: manifest.status === 'captured', status: manifest.status === 'captured' ? 'CAPTURED' : 'FAILED', output: out, manifest: manifestPath, errors };
}

async function main() {
  const options = parseArgs(process.argv.slice(2), { booleans: ['help', 'human_input_confirmed', 'competitor', 'terms_reviewed', 'whole_sequence_confirmed'] });
  if (options.help) {
    process.stdout.write('VANDE: node scripts/eval/compare/capture-android.mjs --serial SERIAL --renderer unity-native|three-webgl|classic --identity-evidence HARNESS.json [--scenario leave|defence|grounded_drive|square_response|lofted_attack|mistime_or_miss] [--quality-tier TIER] [--refresh-hz HZ] [--thermal STATE] [--network CLASS] [--assistance MODE] [--handedness SIDE] [--pitch PRESET] [--field PRESET] [--whole-sequence-confirmed] [--duration-seconds 30] [--human-input-confirmed] [--output-dir DIR]\nCompetitor: node scripts/eval/compare/capture-android.mjs --competitor --serial SERIAL --package-id ID --title TITLE --store STORE --terms-reviewed --human-input-confirmed [same matched-setting options] [--whole-sequence-confirmed] [--output-dir DIR]\nThe tool never installs, launches, uninstalls or clears an app. ADB screenrecord has no audio and can perturb performance.\n');
    return;
  }
  const result = options.competitor ? await captureControlledCompetitor(options) : await captureAndroid(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`capture-android: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
