#!/usr/bin/env node

// Independent, read-only adversarial replay for the capture/compare v3
// subsystem. All generated media and browser output stays in a temporary
// directory. The script never edits a capture/compare implementation file.

import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  assertValidAnnotationsForManifest,
  canonicalJson,
  loadManifestEvidence,
  probeMediaEvidence,
  sha256File,
  sourceBuildId,
} from '../../../../../scripts/eval/compare/lib.mjs';
import {
  canonicalAdbCapturePerturbations,
  canonicalAndroidOs,
} from '../../../../../scripts/eval/compare/capture-android.mjs';
import {
  WEB_CAPTURE_BINDING_POLICY,
  artifactInventory,
  captureWeb,
  runtimeArtifactPath,
  verifyRuntimeArtifactResponse,
} from '../../../../../scripts/eval/compare/capture-web.mjs';
import {
  assertApprovedRegistration,
  comparePackages,
} from '../../../../../scripts/eval/compare/compare.mjs';
import {
  validateUnityPayloadStructure,
  verifyTrustedUnityExport,
} from '../../../../../scripts/eval/compare/unity-provenance.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const SOURCE = '38924bd+123456789abc';
const results = [];

function check(id, expected, observed, passed, severity = 'High') {
  results.push({ id, severity, expected, observed, passed: Boolean(passed) });
}

function observedError(action) {
  try {
    const value = action();
    if (value && typeof value.then === 'function') {
      return value.then(
        () => null,
        (error) => error instanceof Error ? error.message : String(error),
      );
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function fileRecord(file, root, role, mimeType, durationMs = null, raw = true) {
  return {
    role,
    path: relative(root, file).split(sep).join('/'),
    bytes: statSync(file).size,
    sha256: sha256File(file),
    mimeType,
    raw,
    durationMs,
  };
}

function baseManifest(overrides = {}) {
  const os = canonicalAndroidOs({
    release: '14',
    api: '34',
    buildFingerprint: 'vendor/device/build:14/ABC/123:user/release-keys',
    securityPatch: '2026-10-05',
    buildId: 'ABC123',
  });
  const value = {
    schemaVersion: 1,
    captureId: 'independent-v3-001',
    lane: 'vande_engine_truth',
    evidenceClass: 'raw',
    status: 'captured',
    evaluator: { id: 'independent-auditor', role: 'capture operator', authoredSubject: false, independent: true },
    rights: { basis: 'VANDE-owned independent fixture', sourceUrl: null, redistribution: 'owned', notes: [] },
    identity: {
      repositorySourceId: SOURCE,
      embeddedBuildId: SOURCE,
      artifact: { path: 'artifact.json', sha256: 'e'.repeat(64) },
      application: { title: 'VANDE Cricket', packageId: 'in.vande.cricket', version: '1', store: null },
      renderer: { claimed: 'unity-native', observed: 'unity-native', admission: 'accepted', proof: 'independent fixture' },
    },
    timing: { capturedAtUtc: '2026-10-29T00:00:00.000Z', hostUptime: 'independent audit fixture', durationMs: 1_000 },
    environment: {
      platform: 'Android', device: 'Phone A / adb:device-1', os, soc: 'fixture', gpu: 'fixture', ramMb: 4096,
      viewport: { width: 320, height: 180, deviceScaleFactor: 1 }, orientation: 'landscape', refreshHz: 60,
      qualityTier: 'balanced', thermal: 'nominal', battery: '80%', power: 'battery', network: 'offline',
      backgroundLoad: 'independent fixture',
    },
    gameplay: {
      scenario: 'leave', seed: null, controls: 'touch', inputMethod: 'human', assistance: 'play', handedness: 'right',
      pitch: 'balanced', field: 'balanced', timeScale: 1, wholeSequence: true,
    },
    capture: {
      method: 'bounded adb screenrecord of an already-open installed application; no launch, install, uninstall or data clear',
      recorder: { class: 'adb_screenrecord', bitRateBps: 12_000_000 },
      resolution: { width: 320, height: 180 }, frameRate: 30, codec: 'h264',
      audio: { method: 'none', synchronized: false, limitations: ['no audio'] },
      perturbations: canonicalAdbCapturePerturbations(), limitations: [],
    },
    files: [],
    sidecars: { events: [], physics: [], replay: [], frames: [], annotations: [] },
    transformations: [],
    applicability: { metrics: { time_to_first_playable_ball_ms: 'eligible' }, excludedClaims: [] },
    expectedScenario: 'leave', observedDeviations: [], errors: [], tools: { node: process.version },
  };
  return { ...value, ...overrides };
}

function annotation(mediaSha256, manifestSha256 = 'b'.repeat(64), atMs = 900) {
  return {
    schemaVersion: 1,
    captureId: 'independent-v3-001',
    annotator: { id: 'independent-primary', role: 'primary', independentOfBuilder: true },
    source: { mediaSha256, manifestSha256 },
    events: [{
      id: 'first-playable', label: 'first_playable', atMs, endMs: null, frame: null, confidence: 1,
      ambiguous: false, region: null, value: null, note: null,
    }],
    adjudication: null,
  };
}

function metricPackage(manifest, value) {
  return {
    manifest,
    metrics: {
      measurements: [{
        id: 'time_to_first_playable_ball_ms', status: 'measured', value, unit: 'ms', sampleSize: 1,
        uncertainty: { kind: 'half_frame_interval', value: 500 / 30, unit: 'ms', confidence: null },
        timecodesMs: [0, value], sources: ['annotations.json'], limitations: [],
      }],
    },
  };
}

function encodeVideo(file, { audioSeconds = null, videoSeconds = 1, webm = false } = {}) {
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=black:s=320x180:r=30:d=${videoSeconds}`,
  ];
  if (audioSeconds !== null) args.push('-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${audioSeconds}`);
  args.push('-map', '0:v:0');
  if (audioSeconds === null) args.push('-an');
  else args.push('-map', '1:a:0');
  if (webm) args.push('-c:v', 'libvpx-vp9');
  else args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p');
  if (audioSeconds !== null) args.push('-c:a', 'aac');
  args.push(file);
  execFileSync('ffmpeg', args, { timeout: 30_000 });
}

function writeMediaManifest(root, id, video, audio) {
  mkdirSync(root, { recursive: true });
  const artifact = join(root, 'artifact.json');
  writeFileSync(artifact, '{}');
  const observed = probeMediaEvidence(video).observation;
  const manifest = baseManifest({
    captureId: id,
    identity: {
      ...baseManifest().identity,
      artifact: { path: 'artifact.json', sha256: sha256File(artifact) },
    },
    capture: {
      ...baseManifest().capture,
      resolution: { width: observed.width, height: observed.height },
      frameRate: observed.frameRate,
      codec: observed.codec,
      audio,
    },
    files: [
      fileRecord(video, root, 'raw_video', video.endsWith('.webm') ? 'video/webm' : 'video/mp4', observed.durationMs),
      fileRecord(artifact, root, 'artifact_inventory', 'application/json'),
    ],
  });
  const manifestFile = join(root, 'manifest.json');
  writeFileSync(manifestFile, canonicalJson(manifest));
  return { manifest, manifestFile, observed };
}

function exportTree(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory)) {
      const absolute = join(directory, entry);
      const info = statSync(absolute);
      if (info.isDirectory()) visit(absolute);
      else if (!['vande-webgl-export-receipt.json', 'vande-webgl-export-receipt.sig.json'].includes(relative(root, absolute).split(sep).join('/'))) {
        files.push({ path: relative(root, absolute).split(sep).join('/'), bytes: info.size, sha256: sha256File(absolute) });
      }
    }
  };
  visit(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function withServer(root, action) {
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const rel = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
      if (!rel || rel.includes('..') || rel.includes('\\')) {
        response.writeHead(400).end('bad path');
        return;
      }
      const file = join(root, rel);
      const bytes = readFileSync(file);
      const type = rel.endsWith('.html') ? 'text/html' : 'text/javascript';
      response.writeHead(200, { 'content-type': type, 'content-length': bytes.length, 'cache-control': 'no-store' });
      response.end(bytes);
    } catch {
      response.writeHead(404).end('missing');
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}/`;
  try {
    return await action(base);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'vande-capture-independent-v3-'));

  const registrationFile = resolve(REPO, 'docs/evaluation/capture-compare/registration.v3.json');
  const registration = JSON.parse(readFileSync(registrationFile, 'utf8'));
  const frozen = {
    'registration.v1.json': '09d600346e28523248573b0d42d3cde1492e86dfe95da8d70cb0886d7ecabc8a',
    'registration.v2.json': '79d2b8e7ee9ae521a49986980676579b4bb03f43150d65be812e127040a07178',
    'registration.v3.json': 'c2f08f63bfe4d3fe65ef26ec3a9a9273eb4f785fdac96bc6ff75c52895c31949',
    'visual-method.v1.json': '8a9f86be086096c8e8ed7ca1b6975d0bad1890ccc83e27b36a37d6f73135111f',
    'unity-export-trust.v1.json': 'ff6d17b9ba4eefd63cb3773f5116e1849ff717f0c64b445c5668bbc3f94886dc',
  };
  for (const [name, expected] of Object.entries(frozen)) {
    const observed = sha256File(resolve(REPO, 'docs/evaluation/capture-compare', name));
    check(`FROZEN-${name}`, expected, observed, observed === expected, 'Critical');
  }
  check('REGISTRATION-approved-v3', 'exact v3 accepted', observedError(() => assertApprovedRegistration(registration, registrationFile)) ?? 'accepted', (() => {
    try { assertApprovedRegistration(registration, registrationFile); return true; } catch { return false; }
  })(), 'Critical');
  const flipped = structuredClone(registration);
  flipped.metrics[0].lowerIsBetter = !flipped.metrics[0].lowerIsBetter;
  const flipError = observedError(() => assertApprovedRegistration(flipped));
  check('REGISTRATION-direction-tamper', 'rejected', flipError, /not allowlisted/.test(flipError ?? ''), 'Critical');
  const methodTamper = structuredClone(registration);
  methodTamper.methodArtifacts[0].sha256 = '0'.repeat(64);
  const methodTamperError = observedError(() => assertApprovedRegistration(methodTamper));
  check('REGISTRATION-visual-method-tamper', 'rejected', methodTamperError,
    /not allowlisted|method artifact/.test(methodTamperError ?? ''), 'Critical');

  const visual = JSON.parse(readFileSync(resolve(REPO, 'docs/evaluation/capture-compare/visual-method.v1.json'), 'utf8'));
  const checklist = new Set(visual.artifactMaterialDefects.requiredChecklist.map((item) => item.id));
  const requiredChecklist = [
    'player.batter', 'player.bowler', 'player.wicketkeeper', 'player.fielders', 'player.umpires',
    'artifact.ball', 'artifact.bat', 'artifact.stumps_bails', 'environment.pitch_creases', 'environment.crowd',
  ];
  check('VISUAL-complete-checklist', requiredChecklist, [...checklist].filter((id) => requiredChecklist.includes(id)), requiredChecklist.every((id) => checklist.has(id)), 'High');
  check('VISUAL-fixed-thresholds', { shortSide: 412, normal: 4.5, large: 3, ink: 10 }, {
    shortSide: visual.normalization.referenceShortSidePx,
    normal: visual.textLegibilityDefects.thresholds.normalTextMinimumContrastRatio,
    large: visual.textLegibilityDefects.thresholds.largeTextMinimumContrastRatio,
    ink: visual.textLegibilityDefects.thresholds.minimumRenderedInkHeightNormalizedPx,
  }, visual.normalization.referenceShortSidePx === 412 &&
    visual.textLegibilityDefects.thresholds.normalTextMinimumContrastRatio === 4.5 &&
    visual.textLegibilityDefects.thresholds.largeTextMinimumContrastRatio === 3 &&
    visual.textLegibilityDefects.thresholds.minimumRenderedInkHeightNormalizedPx === 10, 'High');

  const device = {
    release: '14', api: '34', buildFingerprint: 'vendor/device/build:14/ABC/123:user/release-keys',
    securityPatch: '2026-10-05', buildId: 'ABC123',
  };
  const exactOs = canonicalAndroidOs(device);
  check('ANDROID-exact-os-present', 'non-null canonical OS', exactOs, typeof exactOs === 'string' && exactOs.includes('buildFingerprint') && exactOs.includes('securityPatch') && exactOs.includes('ABC123'), 'High');
  for (const key of ['buildFingerprint', 'securityPatch', 'buildId']) {
    const observed = canonicalAndroidOs({ ...device, [key]: null });
    check(`ANDROID-missing-${key}`, null, observed, observed === null, 'High');
  }
  check('ANDROID-build-id-difference', 'different canonical OS', canonicalAndroidOs({ ...device, buildId: 'ABC124' }), canonicalAndroidOs({ ...device, buildId: 'ABC124' }) !== exactOs, 'High');

  const leftManifest = baseManifest({ environment: { ...baseManifest().environment, os: exactOs } });
  const rightManifest = baseManifest({ captureId: 'independent-v3-002', environment: { ...baseManifest().environment, os: exactOs } });
  const matched = comparePackages([metricPackage(leftManifest, 1_000), metricPackage(rightManifest, 900)], registration)
    .find((item) => item.id === 'time_to_first_playable_ball_ms')?.comparisons[1];
  check('MATCHED-canonical-perturbation-direction', 'raw_delta_only/favourable_to_candidate', matched, matched?.status === 'raw_delta_only' && matched.direction === 'favourable_to_candidate', 'High');
  const perturbMismatch = comparePackages([
    metricPackage(leftManifest, 1_000),
    metricPackage({ ...rightManifest, capture: { ...rightManifest.capture, perturbations: ['different recorder load'] } }, 900),
  ], registration).find((item) => item.id === 'time_to_first_playable_ball_ms')?.comparisons[1];
  check('MATCHED-perturbation-mismatch', 'not_comparable', perturbMismatch, perturbMismatch?.status === 'not_comparable' && perturbMismatch.reason === 'recorder perturbation/settings mismatch', 'High');
  const osMismatch = comparePackages([
    metricPackage(leftManifest, 1_000),
    metricPackage({ ...rightManifest, environment: { ...rightManifest.environment, os: canonicalAndroidOs({ ...device, buildId: 'ABC124' }) } }, 900),
  ], registration).find((item) => item.id === 'time_to_first_playable_ball_ms')?.comparisons[1];
  check('MATCHED-os-mismatch', 'not_comparable', osMismatch, osMismatch?.status === 'not_comparable' && osMismatch.reason === 'os mismatch', 'High');

  const rawHash = 'a'.repeat(64);
  const childHash = 'c'.repeat(64);
  const transformed = baseManifest({
    files: [
      { role: 'raw_video', path: 'raw.mp4', bytes: 1, sha256: rawHash, mimeType: 'video/mp4', raw: true, durationMs: 1_000 },
      { role: 'derived_video', path: 'derived.mp4', bytes: 1, sha256: childHash, mimeType: 'video/mp4', raw: false, durationMs: 500 },
    ],
    transformations: [{ operation: 'speed_change', parameters: { rate: 2 }, parentSha256: rawHash, childSha256: childHash }],
  });
  const transformedError = observedError(() => assertValidAnnotationsForManifest(annotation(childHash), transformed));
  check('MEDIA-transformed-child-raw', 'rejected', transformedError, /untransformed/.test(transformedError ?? ''), 'Critical');

  const honestRoot = join(scratch, 'honest-webm');
  mkdirSync(honestRoot, { recursive: true });
  const webm = join(honestRoot, 'video.webm');
  encodeVideo(webm, { webm: true });
  const webmObservation = probeMediaEvidence(webm).observation;
  check('MEDIA-webm-admitted', { frames: 30, durationMs: 1_000, codec: 'vp9' }, webmObservation,
    webmObservation.decodedFrameCount === 30 && webmObservation.durationMs === 1_000 && webmObservation.codec === 'vp9', 'Critical');

  const silentRoot = join(scratch, 'silent');
  mkdirSync(silentRoot, { recursive: true });
  const silent = join(silentRoot, 'video.mp4');
  encodeVideo(silent);
  const silentPackage = writeMediaManifest(silentRoot, 'duration-forgery-v3', silent, { method: 'none', synchronized: false, limitations: [] });
  const forgedManifest = JSON.parse(readFileSync(silentPackage.manifestFile, 'utf8'));
  forgedManifest.files.find((item) => item.mimeType === 'video/mp4').durationMs = 10_000;
  const forgedManifestFile = join(silentRoot, 'forged-manifest.json');
  writeFileSync(forgedManifestFile, canonicalJson(forgedManifest));
  const durationError = observedError(() => loadManifestEvidence(forgedManifestFile, { verifyFiles: true, verifyMedia: true }));
  check('MEDIA-false-duration', 'rejected', durationError, /duration does not match/.test(durationError ?? ''), 'Critical');

  const extendedRoot = join(scratch, 'audio-extended');
  mkdirSync(extendedRoot, { recursive: true });
  const extended = join(extendedRoot, 'video.mp4');
  encodeVideo(extended, { audioSeconds: 10 });
  const extendedError = observedError(() => probeMediaEvidence(extended));
  check('MEDIA-audio-extended-duration', 'rejected', extendedError, /container duration materially disagrees/.test(extendedError ?? ''), 'Critical');

  const shortRoot = join(scratch, 'audio-short');
  mkdirSync(shortRoot, { recursive: true });
  const short = join(shortRoot, 'video.mp4');
  encodeVideo(short, { audioSeconds: 0.05 });
  const shortPackage = writeMediaManifest(shortRoot, 'short-audio-v3', short, { method: 'embedded', synchronized: true, limitations: [] });
  const shortError = observedError(() => loadManifestEvidence(shortPackage.manifestFile, { verifyFiles: true, verifyMedia: true }));
  check('MEDIA-short-synchronized-audio', 'rejected', shortError, /audio coverage does not span/.test(shortError ?? ''), 'Critical');

  const alignedRoot = join(scratch, 'audio-aligned');
  mkdirSync(alignedRoot, { recursive: true });
  const aligned = join(alignedRoot, 'video.mp4');
  encodeVideo(aligned, { audioSeconds: 1 });
  const alignedPackage = writeMediaManifest(alignedRoot, 'aligned-audio-v3', aligned, { method: 'embedded', synchronized: true, limitations: [] });
  const alignedError = observedError(() => loadManifestEvidence(alignedPackage.manifestFile, { verifyFiles: true, verifyMedia: true }));
  check('MEDIA-aligned-synchronized-audio', 'accepted', alignedError ?? 'accepted', alignedError === null, 'Critical');

  const falseNone = JSON.parse(readFileSync(alignedPackage.manifestFile, 'utf8'));
  falseNone.capture.audio = { method: 'none', synchronized: false, limitations: [] };
  const falseNoneFile = join(alignedRoot, 'false-none-manifest.json');
  writeFileSync(falseNoneFile, canonicalJson(falseNone));
  const falseNoneError = observedError(() => loadManifestEvidence(falseNoneFile, { verifyFiles: true, verifyMedia: true }));
  check('MEDIA-audio-declared-none', 'rejected', falseNoneError, /declares no audio/.test(falseNoneError ?? ''), 'High');

  const twoVideo = JSON.parse(readFileSync(silentPackage.manifestFile, 'utf8'));
  const secondVideo = join(silentRoot, 'second.mp4');
  writeFileSync(secondVideo, readFileSync(silent));
  twoVideo.files.push(fileRecord(secondVideo, silentRoot, 'second_video', 'video/mp4', silentPackage.observed.durationMs));
  const twoVideoFile = join(silentRoot, 'two-video-manifest.json');
  writeFileSync(twoVideoFile, canonicalJson(twoVideo));
  const twoVideoError = observedError(() => loadManifestEvidence(twoVideoFile, { verifyFiles: true, verifyMedia: true }));
  check('MEDIA-two-video-bypass', 'rejected', twoVideoError, /exactly one video/.test(twoVideoError ?? ''), 'Critical');

  const webRoot = join(scratch, 'web-artifact');
  mkdirSync(join(webRoot, 'assets'), { recursive: true });
  writeFileSync(join(webRoot, 'index.html'), '<html></html>');
  writeFileSync(join(webRoot, 'assets', 'dynamic.js'), 'export const bound = true;');
  const inventory = artifactInventory(webRoot);
  const queryError = observedError(() => runtimeArtifactPath('https://capture.example/app/assets/dynamic.js?v=1', 'https://capture.example/app', inventory));
  check('WEB-query-identity', 'rejected', queryError, /query/.test(queryError ?? ''), 'High');
  const crossOriginError = observedError(() => runtimeArtifactPath('https://other.example/app/assets/dynamic.js', 'https://capture.example/app', inventory));
  check('WEB-cross-origin-identity', 'rejected', crossOriginError, /outside/.test(crossOriginError ?? ''), 'High');
  const missingError = observedError(() => runtimeArtifactPath('https://capture.example/app/assets/missing.js', 'https://capture.example/app', inventory));
  check('WEB-missing-payload', 'rejected', missingError, /absent/.test(missingError ?? ''), 'High');
  const expectedBytes = readFileSync(join(webRoot, 'assets', 'dynamic.js'));
  const response = {
    request: () => ({ redirectedFrom: () => null, redirectedTo: () => null, url: () => 'https://capture.example/app/assets/dynamic.js' }),
    url: () => 'https://capture.example/app/assets/dynamic.js', status: () => 200, headers: () => ({}),
    body: async () => Buffer.from('tampered'),
  };
  const responseError = await observedError(() => verifyRuntimeArtifactResponse(response, 'https://capture.example/app', inventory));
  check('WEB-response-byte-tamper', 'rejected', responseError, /do not match/.test(responseError ?? ''), 'Critical');
  check('WEB-context-policy-declaration', {
    queries: 'reject', auxiliaryPages: 'reject', dedicatedWorkers: 'reject', serviceWorkers: 'block',
  }, WEB_CAPTURE_BINDING_POLICY,
  WEB_CAPTURE_BINDING_POLICY.queries === 'reject' && WEB_CAPTURE_BINDING_POLICY.auxiliaryPages === 'reject' &&
    WEB_CAPTURE_BINDING_POLICY.dedicatedWorkers === 'reject' && WEB_CAPTURE_BINDING_POLICY.serviceWorkers === 'block', 'High');
  check('WEB-control-response-bytes', sha256File(join(webRoot, 'assets', 'dynamic.js')), createHash('sha256').update(expectedBytes).digest('hex'),
    sha256File(join(webRoot, 'assets', 'dynamic.js')) === createHash('sha256').update(expectedBytes).digest('hex'), 'Low');

  const unityRoot = join(scratch, 'forged-unity');
  const unityBuild = join(unityRoot, 'Build');
  mkdirSync(unityBuild, { recursive: true });
  const loader = join(unityBuild, 'forged.loader.js');
  const data = join(unityBuild, 'forged.data');
  const framework = join(unityBuild, 'forged.framework.js');
  const code = join(unityBuild, 'forged.wasm');
  writeFileSync(loader, `function createUnityInstance(){ return WebAssembly; }\n${'// loader\n'.repeat(40)}`);
  writeFileSync(framework, `var unityFramework = {}; var Module = {};\n${'// framework\n'.repeat(40)}`);
  writeFileSync(code, Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  const entryPath = Buffer.from('x.js');
  const headerBytes = 20 + 12 + entryPath.length;
  const dataBytes = Buffer.alloc(headerBytes + 1);
  Buffer.from('UnityWebData1.0\0', 'ascii').copy(dataBytes, 0);
  dataBytes.writeUInt32LE(headerBytes, 16);
  dataBytes.writeUInt32LE(headerBytes, 20);
  dataBytes.writeUInt32LE(1, 24);
  dataBytes.writeUInt32LE(entryPath.length, 28);
  entryPath.copy(dataBytes, 32);
  dataBytes[headerBytes] = 0;
  writeFileSync(data, dataBytes);
  writeFileSync(join(unityRoot, 'index.html'), `loaderUrl='Build/forged.loader.js';dataUrl='Build/forged.data';frameworkUrl='Build/forged.framework.js';codeUrl='Build/forged.wasm';streamingAssetsUrl='StreamingAssets';createUnityInstance();`);
  const unityManifest = {
    schema: 2, buildId: SOURCE, unitySourceSha256: 'f'.repeat(64), unityVersion: '6000.3.27f1', productVersion: '1.0',
    loader: { url: 'Build/forged.loader.js', sha256: sha256File(loader) },
    data: { url: 'Build/forged.data', sha256: sha256File(data) },
    framework: { url: 'Build/forged.framework.js', sha256: sha256File(framework) },
    code: { url: 'Build/forged.wasm', sha256: sha256File(code) }, streamingAssetsUrl: 'StreamingAssets',
  };
  const structureError = observedError(() => validateUnityPayloadStructure(unityRoot, unityManifest));
  check('UNITY-structural-control', 'accepted as structure only', structureError ?? 'accepted', structureError === null, 'Low');
  const unsignedError = observedError(() => verifyTrustedUnityExport(unityRoot, unityManifest, { expectedBuildId: SOURCE, expectedSourceSha256: 'f'.repeat(64) }));
  check('UNITY-unsigned-export', 'rejected', unsignedError, /signed exporter receipt|NOT_AVAILABLE/.test(unsignedError ?? ''), 'Critical');

  const exporterFile = resolve(REPO, 'unity/VandePractice/Assets/VandePractice/Editor/VandeWebGLExporter.cs');
  const receipt = {
    schemaVersion: 1,
    policyId: 'vande-unity-webgl-export-ed25519-v1',
    build: {
      buildId: unityManifest.buildId, unitySourceSha256: unityManifest.unitySourceSha256,
      unityVersion: unityManifest.unityVersion, productVersion: unityManifest.productVersion,
      builtAtUtc: '2026-10-29T00:00:00.000Z', buildMethod: 'BuildPipeline.BuildPlayer(WebGL)', result: 'Succeeded',
    },
    exporter: {
      path: relative(REPO, exporterFile).split(sep).join('/'), sha256: sha256File(exporterFile),
    },
    config: {
      loaderUrl: unityManifest.loader.url, dataUrl: unityManifest.data.url,
      frameworkUrl: unityManifest.framework.url, codeUrl: unityManifest.code.url,
      streamingAssetsUrl: unityManifest.streamingAssetsUrl,
    },
    tree: exportTree(unityRoot),
  };
  const receiptFile = join(unityRoot, 'vande-webgl-export-receipt.json');
  writeFileSync(receiptFile, canonicalJson(receipt));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const keyId = createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
  const receiptBytes = readFileSync(receiptFile);
  writeFileSync(join(unityRoot, 'vande-webgl-export-receipt.sig.json'), canonicalJson({
    schemaVersion: 1, policyId: receipt.policyId, keyId, algorithm: 'Ed25519',
    receiptSha256: createHash('sha256').update(receiptBytes).digest('hex'),
    signatureBase64: sign(null, receiptBytes, privateKey).toString('base64'),
  }));
  const unapprovedError = observedError(() => verifyTrustedUnityExport(unityRoot, unityManifest, { expectedBuildId: SOURCE, expectedSourceSha256: 'f'.repeat(64) }));
  check('UNITY-unapproved-signer', 'rejected', unapprovedError, /not independently approved/.test(unapprovedError ?? ''), 'Critical');
  const trust = JSON.parse(readFileSync(resolve(REPO, 'docs/evaluation/capture-compare/unity-export-trust.v1.json'), 'utf8'));
  check('UNITY-no-builder-trust-key', 0, trust.approvedKeys.length, trust.approvedKeys.length === 0 && trust.status === 'NO_TRUSTED_EXPORTER_KEY_PROVISIONED', 'Critical');

  if (process.argv.includes('--browser')) {
    const browserRoot = join(scratch, 'browser-artifact');
    mkdirSync(browserRoot, { recursive: true });
    const buildId = sourceBuildId();
    writeFileSync(join(browserRoot, 'worker.js'), 'self.onmessage = () => undefined;');
    writeFileSync(join(browserRoot, 'popup.html'), '<!doctype html><title>auxiliary</title>');
    writeFileSync(join(browserRoot, 'index.html'), `<!doctype html>
      <html data-vande-build-id="${buildId}" data-vande-practice-renderer="three-webgl"><body>
      <button data-testid="practice-random">Random</button>
      <button data-testid="practice-play-start">Play</button>
      <script>
        new Worker('worker.js');
        fetch('worker.js?v=unbound').catch(() => undefined);
        document.querySelector('[data-testid="practice-random"]').addEventListener('click', () => window.open('popup.html'));
        document.querySelector('[data-testid="practice-play-start"]').addEventListener('click', () => {
          const root = document.createElement('div'); root.dataset.testid = 'practice-play'; root.dataset.phase = 'live';
          const app = document.createElement('div'); app.setAttribute('role', 'application'); app.dataset.armed = 'true';
          document.body.append(root, app);
        });
        addEventListener('keydown', () => {
          document.querySelector('[data-testid="practice-play"]').dataset.phase = 'dead';
          const result = document.createElement('div'); result.dataset.testid = 'practice-result'; result.dataset.outcome = 'dot';
          document.body.append(result);
        });
      </script></body></html>`);
    const browserResult = await withServer(browserRoot, (base) => captureWeb({
      renderer: 'three-webgl', artifact_root: browserRoot, base,
      output_dir: join(scratch, 'browser-capture'), expected_build_id: buildId,
      timeout_ms: '30000', evaluator: 'independent-browser-auditor',
    }));
    check('WEB-context-worker-event', 'rejected', browserResult.errors,
      browserResult.errors.some((item) => item.includes('unbound dedicated worker')), 'Critical');
    check('WEB-context-query-event', 'rejected', browserResult.errors,
      browserResult.errors.some((item) => item.includes('query/fragment')), 'Critical');
    check('WEB-context-popup-event', 'rejected', browserResult.errors,
      browserResult.errors.some((item) => item.includes('unbound popup') || item.includes('unbound auxiliary page')), 'Critical');
    check('WEB-context-attack-status', 'FAILED', browserResult.status, browserResult.ok === false && browserResult.status === 'FAILED', 'Critical');
  }

  const passed = results.filter((item) => item.passed).length;
  const failed = results.length - passed;
  const report = {
    schemaVersion: 1,
    evaluator: 'capture_tool_reaudit_v3',
    generatedAtUtc: new Date().toISOString(),
    sourceBuildIdAtReplay: sourceBuildId(),
    browserContextRun: process.argv.includes('--browser'),
    scratch,
    counts: { total: results.length, passed, failed },
    results,
    ok: failed === 0,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`independent-retest-v3: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
