/// <reference types="node" />

import { describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  canonicalJson,
  assertValidAnnotationsForManifest,
  loadManifestEvidence,
  probeMediaEvidence,
  sha256File,
  validateAnnotations,
  validateManifest,
} from '../../../scripts/eval/compare/lib.mjs';
import {
  validateAndroidIdentityEvidence,
  validateArtifactHashWindow,
  canonicalAdbCapturePerturbations,
  canonicalAndroidOs,
  extractBuildIdsFromText,
} from '../../../scripts/eval/compare/capture-android.mjs';
import {
  type RuntimeIdentityWatchStart,
  type RuntimeIdentityWatchEvidence,
  type RuntimePresentationState,
  type RuntimeUnitySurfaceEvidence,
  WEB_CAPTURE_BINDING_POLICY,
  UNITY_WEBGL_ADMISSION_VALUE,
  assertAtomicRuntimeWatchStart,
  assertCapturedKeyboardAction,
  assertRuntimePresentationContinuity,
  artifactInventory,
  artifactPathsForBinding,
  canonicalArtifactBase,
  captureWeb,
  runtimeArtifactIdentity,
  runtimeArtifactPath,
  verifyUnityHostArtifactBinding,
  verifyRuntimeArtifactResponse,
} from '../../../scripts/eval/compare/capture-web.mjs';
import { captureWebGl } from '../../../scripts/eval/compare/capture-webgl.mjs';
import { validateUnityPayloadStructure, verifyTrustedUnityExport } from '../../../scripts/eval/compare/unity-provenance.mjs';
import { annotationWorkflow, calculateMetrics, measurementsFromAnnotations } from '../../../scripts/eval/compare/metrics.mjs';
import {
  assertApprovedRegistration,
  buildComparison,
  compare,
  comparePackages,
  verifyMetricsReceipt,
} from '../../../scripts/eval/compare/compare.mjs';

const SOURCE = '38924bd+123456789abc';
const REGISTRATION_V1 = resolve('docs/evaluation/capture-compare/registration.v1.json');
const REGISTRATION_V2 = resolve('docs/evaluation/capture-compare/registration.v2.json');
const REGISTRATION_V3 = resolve('docs/evaluation/capture-compare/registration.v3.json');
const registration = JSON.parse(readFileSync(REGISTRATION_V3, 'utf8'));

function unityHostBoundaryFixture() {
  const scratch = mkdtempSync(join(tmpdir(), 'vande-unity-host-boundary-'));
  const exportRoot = join(scratch, 'export');
  const hostRoot = join(scratch, 'host');
  const exportFiles: Record<string, string> = {
    'vande-webgl-manifest.json': '{"schema":2}',
    'Build/game.loader.js': 'loader',
    'Build/game.data': 'data',
    'Build/game.framework.js': 'framework',
    'Build/game.wasm': 'wasm',
    'vande-webgl-export-receipt.json': '{"receipt":true}',
    'vande-webgl-export-receipt.sig.json': '{"signature":true}',
  };
  for (const [path, bytes] of Object.entries(exportFiles)) {
    const exportFile = join(exportRoot, path);
    const hostedFile = join(hostRoot, 'unity', path);
    mkdirSync(dirname(exportFile), { recursive: true });
    mkdirSync(dirname(hostedFile), { recursive: true });
    writeFileSync(exportFile, bytes);
    writeFileSync(hostedFile, bytes);
  }
  writeFileSync(join(hostRoot, 'index.html'), '<html>React host</html>');
  writeFileSync(join(hostRoot, 'host.js'), 'window.VANDE = true;');
  const verifiedFiles = new Map(artifactInventory(exportRoot, { requireIndex: false }).files
    .map((record) => [record.path, record.sha256]));
  return { exportRoot, hostRoot, verifiedFiles };
}

type RuntimeStateOverrides = Omit<Partial<RuntimePresentationState>, 'unitySurface'> & {
  unitySurface?: Partial<RuntimeUnitySurfaceEvidence>;
};

function unityRuntimeState(overrides: RuntimeStateOverrides = {}): RuntimePresentationState {
  const unitySurface: RuntimeUnitySurfaceEvidence = {
    present: true,
    connected: true,
    renderer: 'unity-webgl',
    visible: true,
    pointerEnabled: true,
    hitTest: true,
    inputReady: true,
    bridgeOperationActive: true,
    viewportCoverage: 1,
    opacity: '1',
    pointerEvents: 'auto',
    elementToken: 'armed-canvas-token',
  };
  const state: RuntimePresentationState = {
    screen: 'live',
    phase: 'live',
    renderer: 'unity-webgl',
    admission: UNITY_WEBGL_ADMISSION_VALUE,
    armed: false,
    reactInputArmed: false,
    inputOwner: 'unity-webgl-canvas',
    unitySurface,
    result: false,
  };
  return {
    ...state,
    ...overrides,
    unitySurface: { ...unitySurface, ...overrides.unitySurface },
  };
}

function unityResultState(overrides: RuntimeStateOverrides = {}): RuntimePresentationState {
  const { unitySurface, ...stateOverrides } = overrides;
  return unityRuntimeState({
    phase: 'dead',
    inputOwner: null,
    result: true,
    swing: 'attack',
    ...stateOverrides,
    unitySurface: {
      visible: false,
      pointerEnabled: false,
      hitTest: false,
      inputReady: false,
      opacity: '0',
      pointerEvents: 'none',
      ...unitySurface,
    },
  });
}

function stableUnityIdentityWatch(overrides: Partial<RuntimeIdentityWatchEvidence> = {}): RuntimeIdentityWatchEvidence {
  return {
    startedAtPerfMs: 100,
    finishedAtPerfMs: 200,
    baseline: { renderer: 'unity-webgl', admission: UNITY_WEBGL_ADMISSION_VALUE },
    final: { renderer: 'unity-webgl', admission: UNITY_WEBGL_ADMISSION_VALUE },
    transitions: [],
    canvas: {
      id: 'vande-unity-practice-canvas',
      elementToken: 'armed-canvas-token',
      baseline: { connected: true, unique: true, renderer: 'unity-webgl' },
      final: { connected: true, sameElement: true, unique: true, renderer: 'unity-webgl' },
      rendererTransitions: [],
      childListTransitions: [],
    },
    ...overrides,
  };
}

function baseManifest(overrides: Record<string, unknown> = {}) {
  const value = {
    schemaVersion: 1,
    captureId: 'vande-adversarial-001',
    lane: 'vande_engine_truth',
    evidenceClass: 'raw',
    status: 'captured',
    evaluator: { id: 'capture-operator', role: 'capture operator', authoredSubject: false, independent: true },
    rights: { basis: 'VANDE-owned fixture', sourceUrl: null, redistribution: 'owned', notes: [] },
    identity: {
      repositorySourceId: SOURCE,
      embeddedBuildId: SOURCE,
      artifact: { path: 'artifact.json', sha256: 'e'.repeat(64) },
      application: { title: 'VANDE Cricket', packageId: 'in.vande.cricket', version: '1', store: null },
      renderer: { claimed: 'three-webgl', observed: 'three-webgl', admission: 'retained', proof: 'bound runtime proof' },
    },
    timing: { capturedAtUtc: '2026-10-29T00:00:00.000Z', hostUptime: 'audit fixture', durationMs: 10_000 },
    environment: {
      platform: 'Android', device: 'Phone A', os: 'Android 14', soc: 'test', gpu: 'test', ramMb: 4096,
      viewport: { width: 1000, height: 500, deviceScaleFactor: 1 }, orientation: 'landscape', refreshHz: 60,
      qualityTier: 'balanced', thermal: 'nominal', battery: '80%', power: 'battery', network: 'offline', backgroundLoad: 'audit',
    },
    gameplay: {
      scenario: 'leave', seed: null, controls: 'touch', inputMethod: 'human', assistance: 'play', handedness: 'right',
      pitch: 'balanced', field: 'balanced', timeScale: 1, wholeSequence: true,
    },
    capture: {
      method: 'bounded adb screenrecord', resolution: { width: 1000, height: 500 }, frameRate: 60, codec: 'h264',
      recorder: { class: 'adb_screenrecord', bitRateBps: 12_000_000 },
      audio: { method: 'none', synchronized: false, limitations: ['no audio'] }, perturbations: [], limitations: [],
    },
    files: [
      { role: 'raw_video', path: 'raw.mp4', bytes: 5, sha256: 'a'.repeat(64), mimeType: 'video/mp4', raw: true, durationMs: 10_000 },
      { role: 'artifact_inventory', path: 'artifact.json', bytes: 2, sha256: 'e'.repeat(64), mimeType: 'application/json', raw: true, durationMs: null },
    ],
    sidecars: { events: [], physics: [], replay: [], frames: [], annotations: [] },
    transformations: [],
    applicability: { metrics: { time_to_first_playable_ball_ms: 'eligible', ball_diameter_release_px: 'eligible' }, excludedClaims: [] },
    expectedScenario: 'leave', observedDeviations: [], errors: [], tools: { node: process.version },
  };
  return { ...value, ...overrides };
}

function annotation(manifestSha256 = 'b'.repeat(64), mediaSha256 = 'a'.repeat(64), firstPlayable = 1000) {
  return {
    schemaVersion: 1,
    captureId: 'vande-adversarial-001',
    annotator: { id: 'primary-reviewer', role: 'primary', independentOfBuilder: true },
    source: { mediaSha256, manifestSha256 },
    events: [
      { id: 'launch', label: 'launch', atMs: 0, endMs: null, frame: null, confidence: 1, ambiguous: false, region: null as { x: number; y: number; width: number; height: number } | null, value: null, note: null },
      { id: 'first-playable', label: 'first_playable', atMs: firstPlayable, endMs: null, frame: null, confidence: 1, ambiguous: false, region: null as { x: number; y: number; width: number; height: number } | null, value: null, note: null },
    ],
    adjudication: null,
  };
}

function metricPackage(manifest: ReturnType<typeof baseManifest>, value = 1000, status = 'measured') {
  return {
    manifest,
    metrics: {
      schemaVersion: 1, analysisVersion: '1.2.0', captureId: manifest.captureId, manifestSha256: 'c'.repeat(64),
      generatedAtUtc: manifest.timing.capturedAtUtc, lane: manifest.lane, evidenceClass: manifest.evidenceClass,
      scenario: manifest.gameplay.scenario, evaluator: { id: 'reviewer', authoredTooling: false, independentOfSubject: true },
      integrity: { status: 'passed', rejections: [] },
      measurements: [{
        id: 'time_to_first_playable_ball_ms', status, value, unit: 'ms', sampleSize: 1,
        uncertainty: { kind: 'half_frame_interval', value: 500 / 60, unit: 'ms', confidence: null } as { kind: string; value: number; unit: string; confidence: number | null } | null,
        timecodesMs: [0, value], sources: ['annotations.json'], limitations: [],
      }],
      ceriEvidence: [],
    },
    metricsSha256: 'd'.repeat(64),
    provenanceVerified: true,
  };
}

function writePackage(root: string, id: string, lane: string, firstPlayable: number, mediaSeconds = 2) {
  mkdirSync(root, { recursive: true });
  const video = join(root, 'raw.mp4');
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=black:s=1000x500:r=60:d=${mediaSeconds}`,
    '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video,
  ], { timeout: 30_000 });
  const artifact = join(root, 'artifact.json');
  if (lane === 'vande_engine_truth') writeFileSync(artifact, '{}');
  const observed = probeMediaEvidence(video).observation;
  const videoRecord = { role: 'raw_video', path: 'raw.mp4', bytes: readFileSync(video).byteLength, sha256: sha256File(video), mimeType: 'video/mp4', raw: true, durationMs: observed.durationMs };
  const isCompetitor = lane === 'controlled_competitor';
  const manifest = baseManifest({
    captureId: id,
    lane,
    rights: isCompetitor
      ? { basis: 'lawfully installed fixture; terms reviewed', sourceUrl: null, redistribution: 'prohibited', notes: [] }
      : { basis: 'VANDE-owned fixture', sourceUrl: null, redistribution: 'owned', notes: [] },
    identity: isCompetitor
      ? {
          repositorySourceId: null, embeddedBuildId: null, artifact: null,
          application: { title: 'Competitor', packageId: 'example.competitor', version: '1', store: 'Google Play' },
          renderer: { claimed: null, observed: 'undisclosed-proprietary-runtime', admission: null, proof: 'package manager' },
        }
      : {
          ...(baseManifest().identity as object),
          artifact: { path: 'artifact.json', sha256: sha256File(artifact) },
        },
    capture: {
      ...(baseManifest().capture as object),
      resolution: { width: observed.width, height: observed.height },
      frameRate: observed.frameRate,
      codec: observed.codec,
    },
    files: isCompetitor ? [videoRecord] : [videoRecord, { role: 'artifact_inventory', path: 'artifact.json', bytes: 2, sha256: sha256File(artifact), mimeType: 'application/json', raw: true, durationMs: null }],
  });
  const manifestFile = join(root, 'manifest.json');
  writeFileSync(manifestFile, canonicalJson(manifest));
  const annotations = annotation(sha256File(manifestFile), videoRecord.sha256, firstPlayable);
  annotations.captureId = id;
  const annotationFile = join(root, 'annotations.json');
  writeFileSync(annotationFile, canonicalJson(annotations));
  return { manifestFile, annotationFile };
}

function writeSynchronizedAvPackage(root: string, id: string, audioSeconds: number) {
  mkdirSync(root, { recursive: true });
  const video = join(root, 'raw.mp4');
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=1',
    '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${audioSeconds}`,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video,
  ], { timeout: 30_000 });
  const artifact = join(root, 'artifact.json');
  writeFileSync(artifact, '{}');
  const observed = probeMediaEvidence(video).observation;
  const manifest = baseManifest({
    captureId: id,
    capture: {
      ...(baseManifest().capture as object),
      resolution: { width: observed.width, height: observed.height },
      frameRate: observed.frameRate,
      codec: observed.codec,
      audio: { method: 'embedded capture', synchronized: true, limitations: [] },
    },
    identity: { ...(baseManifest().identity as object), artifact: { path: 'artifact.json', sha256: sha256File(artifact) } },
    files: [
      { role: 'raw_video', path: 'raw.mp4', bytes: readFileSync(video).byteLength, sha256: sha256File(video), mimeType: 'video/mp4', raw: true, durationMs: observed.durationMs },
      { role: 'artifact_inventory', path: 'artifact.json', bytes: 2, sha256: sha256File(artifact), mimeType: 'application/json', raw: true, durationMs: null },
    ],
  });
  const manifestFile = join(root, 'manifest.json');
  writeFileSync(manifestFile, canonicalJson(manifest));
  return manifestFile;
}

describe('capture/compare adversarial trust boundaries', () => {
  it('rejects undeclared or missing sidecars', () => {
    const value = baseManifest({ sidecars: { events: ['ghost.json'], physics: [], replay: [], frames: [], annotations: [] } });
    expect(validateManifest(value).some((error) => error.includes('must name a hash-bound entry'))).toBe(true);
  });

  it('rejects native Unity without bound artifact, admission and live proof', () => {
    const value = baseManifest({
      identity: {
        ...(baseManifest().identity as object), artifact: null,
        renderer: { claimed: 'unity-native', observed: 'unity-native', admission: null, proof: null },
      },
    });
    const errors = validateManifest(value);
    expect(errors.some((error) => error.includes('native Unity evidence'))).toBe(true);
  });

  it('rejects caller-forged Android identity without tool-derived bindings', () => {
    const forged = {
      buildId: SOURCE, expectedBuildId: SOURCE,
      installedBuildIdentity: { observedDom: SOURCE, observedEvidenceSurface: SOURCE },
      device: { serial: 'device-1' },
      rendererEvidence: [{ renderer: 'unity-native', selectionClassification: 'unity_native', admission: 'accepted' }],
      practiceTestApiPresent: false,
    };
    expect(validateAndroidIdentityEvidence(forged, { sourceId: SOURCE, serial: 'device-1', renderer: 'unity-native' }))
      .toContain('trusted tool-derived Android identity binding is missing');
    const trusted = {
      artifactBuildId: SOURCE, artifactInventorySha256: 'f'.repeat(64), installedUnityRuntime: true,
      runtimeObservations: [
        { buildId: SOURCE, renderer: 'unity-native', admission: 'accepted', practiceTestApiPresent: false },
        { buildId: SOURCE, renderer: 'unity-native', admission: 'accepted', practiceTestApiPresent: false },
      ],
      foregroundObservations: [{ packageId: 'wrong.app', obscured: true }, { packageId: 'in.vande.cricket', obscured: false }],
    };
    expect(validateAndroidIdentityEvidence(forged, { sourceId: SOURCE, serial: 'device-1', renderer: 'unity-native', trusted })
      .some((error) => error.includes('foreground package'))).toBe(true);
  });

  it('requires and exactly compares Android fingerprint, patch and build ID while keeping lane perturbations canonical', () => {
    const device = {
      release: '14', api: '34', buildFingerprint: 'vendor/device/build:14/ABC/123:user/release-keys',
      securityPatch: '2026-10-05', buildId: 'ABC123',
    };
    const canonical = canonicalAndroidOs(device);
    expect(canonical).toContain('buildFingerprint');
    expect(canonical).toContain('securityPatch');
    expect(canonical).toContain('ABC123');
    expect(canonicalAndroidOs({ ...device, buildFingerprint: null })).toBeNull();
    expect(canonicalAndroidOs({ ...device, securityPatch: null })).toBeNull();
    expect(canonicalAndroidOs({ ...device, buildId: null })).toBeNull();
    expect(canonicalAndroidOs({ ...device, buildId: 'ABC124' })).not.toBe(canonical);
    expect(canonicalAdbCapturePerturbations()).toEqual(canonicalAdbCapturePerturbations());

    const left = metricPackage(baseManifest({ environment: { ...baseManifest().environment, os: canonical } }));
    const right = metricPackage(baseManifest({
      captureId: 'vande-adversarial-002',
      environment: { ...baseManifest().environment, os: canonicalAndroidOs({ ...device, buildId: 'ABC124' }) },
    }), 900);
    const result = comparePackages([left, right], registration).find((item) => item.id === 'time_to_first_playable_ball_ms')?.comparisons[1];
    expect(result).toMatchObject({ status: 'not_comparable', reason: 'os mismatch', direction: null });
  });

  it('extracts clean and dirty embedded build IDs without mistaking source digests for build IDs', () => {
    expect(extractBuildIdsFromText('window.__BUILD_ID__="abcdef1";')).toEqual(['abcdef1']);
    expect(extractBuildIdsFromText('window.__BUILD_ID__="0123456789abcdef0123456789abcdef01234567+abcdef123456";'))
      .toEqual(['0123456789abcdef0123456789abcdef01234567+abcdef123456']);
    expect(extractBuildIdsFromText(`sha256=${'a'.repeat(64)}`)).toEqual([]);
    expect(extractBuildIdsFromText('short=abcdef')).toEqual([]);
    expect(extractBuildIdsFromText('const colour="deadbeef";')).toEqual([]);
  });

  it('rejects changed, missing or locally mismatched APK hashes', () => {
    const path = '/data/app/base.apk';
    const before = [{ path, sha256: 'a'.repeat(64) }];
    expect(validateArtifactHashWindow(before, [{ path, sha256: 'b'.repeat(64) }], [{ remotePath: path, sha256: 'a'.repeat(64) }]).length).toBeGreaterThan(0);
    expect(validateArtifactHashWindow(before, before, [{ remotePath: path, sha256: 'c'.repeat(64) }]).length).toBeGreaterThan(0);
  });

  it('rejects an adjudicator without real reviewed hashes and decisions', () => {
    const value = { ...annotation(), annotator: { id: 'adjudicator', role: 'adjudicator', independentOfBuilder: true }, adjudication: null };
    expect(validateAnnotations(value, { durationMs: 10_000, captureId: value.captureId }).some((error) => error.includes('mandatory for an adjudicator'))).toBe(true);
  });

  it('rejects an adjudication workflow assembled from different source videos', () => {
    const primary = annotation();
    const secondary = {
      ...annotation('b'.repeat(64), 'c'.repeat(64)),
      annotator: { id: 'secondary-reviewer', role: 'secondary', independentOfBuilder: true },
    };
    const adjudicator = {
      ...annotation(),
      annotator: { id: 'adjudicator-reviewer', role: 'adjudicator', independentOfBuilder: true },
      adjudication: { reviewedFiles: ['1'.repeat(64), '2'.repeat(64)], decisions: ['Reviewed the disputed event.'] },
    };
    const workflow = annotationWorkflow([
      { value: primary, sha256: '1'.repeat(64), path: 'primary.json' },
      { value: secondary, sha256: '2'.repeat(64), path: 'secondary.json' },
      { value: adjudicator, sha256: '3'.repeat(64), path: 'adjudicator.json' },
    ] as unknown as Parameters<typeof annotationWorkflow>[0]);
    expect(workflow.rejections).toContain('Every annotation in a review workflow must bind the same manifest and source video.');
  });

  it('bounds annotation timecodes to the hash-bound video rather than capture wall time', () => {
    const manifest = baseManifest({
      timing: { ...(baseManifest().timing as object), durationMs: 20_000 },
    });
    expect(() => assertValidAnnotationsForManifest(annotation('b'.repeat(64), 'a'.repeat(64), 15_000), manifest))
      .toThrow(/outside the capture duration/);
    const missingDuration = baseManifest({
      files: baseManifest().files.map((item) => item.mimeType === 'video/mp4' ? { ...item, durationMs: null } : item),
    });
    expect(() => assertValidAnnotationsForManifest(annotation(), missingDuration))
      .toThrow(/positive probed duration/);
  });

  it('rejects a transformed child as the selected media for raw directional evidence', () => {
    const childHash = 'c'.repeat(64);
    const manifest = baseManifest({
      files: [
        ...baseManifest().files,
        { role: 'speed_changed_video', path: 'derived.mp4', bytes: 5, sha256: childHash, mimeType: 'video/mp4', raw: false, durationMs: 5_000 },
      ],
      transformations: [{ operation: 'speed_change', parameters: { rate: 2 }, parentSha256: 'a'.repeat(64), childSha256: childHash }],
    });
    expect(() => assertValidAnnotationsForManifest(annotation('b'.repeat(64), childHash, 1_000), manifest))
      .toThrow(/Raw directional evidence must select an untransformed/);
  });

  it('rejects the preserved one-second-video-as-ten-seconds evidence chain before metrics admission', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'vande-duration-forgery-'));
    const honest = writePackage(scratch, 'duration-forgery-001', 'vande_engine_truth', 900, 1);
    const forgedManifest = JSON.parse(readFileSync(honest.manifestFile, 'utf8'));
    forgedManifest.files.find((item: { mimeType: string }) => item.mimeType === 'video/mp4').durationMs = 10_000;
    const forgedManifestFile = join(scratch, 'forged-manifest.json');
    writeFileSync(forgedManifestFile, canonicalJson(forgedManifest));
    const video = forgedManifest.files.find((item: { mimeType: string }) => item.mimeType === 'video/mp4');
    const forgedAnnotation = annotation(sha256File(forgedManifestFile), video.sha256, 9_000);
    forgedAnnotation.captureId = forgedManifest.captureId;
    const forgedAnnotationFile = join(scratch, 'forged-annotations.json');
    writeFileSync(forgedAnnotationFile, canonicalJson(forgedAnnotation));
    expect(() => loadManifestEvidence(forgedManifestFile, { verifyFiles: true, verifyMedia: true }))
      .toThrow(/duration does not match ffprobe/);
    await expect(calculateMetrics({
      manifest: forgedManifestFile,
      annotations: [forgedAnnotationFile],
      output_dir: join(scratch, 'metrics'),
    })).rejects.toThrow(/duration does not match ffprobe/);
  });

  it('admits a real 30-frame VP9 WebM using bounded video-only decode progress', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'vande-webm-duration-'));
    const video = join(scratch, 'video-1s.webm');
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=1',
      '-an', '-c:v', 'libvpx-vp9', video,
    ], { timeout: 30_000 });
    expect(probeMediaEvidence(video).observation).toMatchObject({
      width: 320,
      height: 180,
      codec: 'vp9',
      audioStreamCount: 0,
      decodedAudioStreamCount: 0,
      decodedFrameCount: 30,
      durationUs: 1_000_000,
      durationMs: 1_000,
      durationSource: 'ffmpeg.decoded_video_progress',
    });
  });

  it('rejects a synchronized-audio claim when the hash-bound video has no audio stream', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'vande-false-audio-'));
    const fixture = writePackage(scratch, 'false-audio-001', 'vande_engine_truth', 900, 1);
    const manifest = JSON.parse(readFileSync(fixture.manifestFile, 'utf8'));
    manifest.capture.audio = { method: 'embedded capture', synchronized: true, limitations: [] };
    manifest.applicability.metrics.contact_to_impact_audio_ms = 'eligible';
    writeFileSync(fixture.manifestFile, canonicalJson(manifest));
    expect(() => loadManifestEvidence(fixture.manifestFile, { verifyFiles: true, verifyMedia: true }))
      .toThrow(/synchronized audio.*no embedded audio stream/);
  });

  it('requires decoded synchronized audio to cover the visual duration and admits aligned A/V', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'vande-audio-coverage-'));
    const shortAudio = writeSynchronizedAvPackage(join(scratch, 'short'), 'short-audio-001', 0.05);
    expect(() => loadManifestEvidence(shortAudio, { verifyFiles: true, verifyMedia: true }))
      .toThrow(/audio coverage does not span/);
    const aligned = writeSynchronizedAvPackage(join(scratch, 'aligned'), 'aligned-audio-001', 1);
    const alignedEvidence = loadManifestEvidence(aligned, { verifyFiles: true, verifyMedia: true });
    const media = alignedEvidence.manifest.files.find((item: { mimeType: string }) => item.mimeType === 'video/mp4');
    const audioAnnotation = annotation(sha256File(aligned), media!.sha256, 100);
    audioAnnotation.captureId = alignedEvidence.manifest.captureId;
    audioAnnotation.events.push({
      id: 'impact-audio', label: 'impact_audio', atMs: 900, endMs: null, frame: null,
      confidence: 1, ambiguous: false, region: null, value: null, note: null,
    });
    expect(() => assertValidAnnotationsForManifest(audioAnnotation, alignedEvidence.manifest, { mediaProbes: alignedEvidence.mediaProbes })).not.toThrow();
    const truncatedProbe = structuredClone(alignedEvidence.mediaProbes);
    truncatedProbe[0].observation.audioCoverage[0].endUs = 500_000;
    expect(() => assertValidAnnotationsForManifest(audioAnnotation, alignedEvidence.manifest, { mediaProbes: truncatedProbe }))
      .toThrow(/outside proven decoded audio coverage/);
  });

  it('does not let a second hash-valid video disable media and audio consistency checks', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'vande-two-video-bypass-'));
    const fixture = writePackage(scratch, 'two-video-bypass-001', 'vande_engine_truth', 900, 1);
    const second = join(scratch, 'raw-2.mp4');
    writeFileSync(second, readFileSync(join(scratch, 'raw.mp4')));
    const manifest = JSON.parse(readFileSync(fixture.manifestFile, 'utf8'));
    manifest.capture.audio = { method: 'embedded capture', synchronized: true, limitations: [] };
    manifest.files.push({
      ...manifest.files.find((item: { mimeType: string }) => item.mimeType === 'video/mp4'),
      role: 'second_video',
      path: 'raw-2.mp4',
    });
    writeFileSync(fixture.manifestFile, canonicalJson(manifest));
    expect(() => loadManifestEvidence(fixture.manifestFile, { verifyFiles: true, verifyMedia: true }))
      .toThrow(/exactly one video/);
  });

  it('never lets a ten-second audio track extend one second of visual evidence through admission, receipt or comparison', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'vande-stream-duration-forgery-'));
    const video = join(scratch, 'video-1s-audio-10s.mp4');
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=1000x500:r=30:d=1',
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=10',
      '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video,
    ], { timeout: 30_000 });
    expect(() => probeMediaEvidence(video)).toThrow(/container duration materially disagrees/);

    const artifact = join(scratch, 'artifact.json');
    writeFileSync(artifact, '{}');
    const forged = baseManifest({
      captureId: 'stream-duration-forgery-001',
      capture: { ...baseManifest().capture, resolution: { width: 1000, height: 500 }, frameRate: 30, codec: 'h264' },
      files: [
        { role: 'raw_video', path: 'video-1s-audio-10s.mp4', bytes: readFileSync(video).byteLength, sha256: sha256File(video), mimeType: 'video/mp4', raw: true, durationMs: 10_000 },
        { role: 'artifact_inventory', path: 'artifact.json', bytes: 2, sha256: sha256File(artifact), mimeType: 'application/json', raw: true, durationMs: null },
      ],
      identity: { ...(baseManifest().identity as object), artifact: { path: 'artifact.json', sha256: sha256File(artifact) } },
    });
    const manifestFile = join(scratch, 'manifest.json');
    writeFileSync(manifestFile, canonicalJson(forged));
    const forgedAnnotation = annotation(sha256File(manifestFile), sha256File(video), 9_000);
    forgedAnnotation.captureId = forged.captureId;
    const annotationFile = join(scratch, 'annotations.json');
    writeFileSync(annotationFile, canonicalJson(forgedAnnotation));
    const metricsFile = join(scratch, 'metrics.json');
    const receiptFile = join(scratch, 'metrics-receipt.json');
    writeFileSync(metricsFile, '{}');
    writeFileSync(receiptFile, '{}');

    expect(() => loadManifestEvidence(manifestFile, { verifyFiles: true, verifyMedia: true })).toThrow(/container duration materially disagrees/);
    expect(() => assertValidAnnotationsForManifest(forgedAnnotation, forged, {
      mediaProbes: [{
        path: 'video-1s-audio-10s.mp4',
        sha256: sha256File(video),
        bytes: readFileSync(video).byteLength,
        probe: { tool: 'ffprobe', version: 'regression fixture', executableSha256: 'f'.repeat(64), arguments: [] },
        decoder: { tool: 'ffmpeg', version: 'regression fixture', executableSha256: 'e'.repeat(64), arguments: [] },
        observation: {
          width: 1000, height: 500, frameRate: 30, codec: 'h264', audioStreamCount: 1, decodedAudioStreamCount: 1,
          audioCoverage: [{ index: 1, decodedFrameCount: 469, startUs: 0, durationUs: 10_000_000, endUs: 10_000_000 }],
          decodedFrameCount: 30, durationUs: 1_000_000, durationMs: 1_000,
          frameRateSource: 'stream.avg_frame_rate', durationSource: 'ffmpeg.decoded_video_progress',
        },
      }],
    })).toThrow(/outside the capture duration/);
    await expect(calculateMetrics({ manifest: manifestFile, annotations: [annotationFile], output_dir: join(scratch, 'metrics-out') }))
      .rejects.toThrow(/container duration materially disagrees/);
    expect(() => verifyMetricsReceipt({
      receiptFile, manifestFile, metricsFile, manifest: forged, metrics: metricPackage(forged).metrics, registration,
    })).toThrow(/container duration materially disagrees/);
    await expect(compare({
      manifest: [manifestFile, manifestFile], metrics: [metricsFile, metricsFile], receipt: [receiptFile, receiptFile],
      output_dir: join(scratch, 'comparison'), evaluator: 'reviewer', independent: true,
    })).rejects.toThrow(/container duration materially disagrees/);
  });

  it('keeps an observed but undeclared metric unavailable and uses arithmetic mean diameter', () => {
    const manifest = baseManifest({ applicability: { metrics: {}, excludedClaims: [] } });
    const measured = measurementsFromAnnotations(manifest, annotation());
    expect(measured.find((item) => item.id === 'time_to_first_playable_ball_ms')).toMatchObject({ status: 'not_available', value: null });
    const diameterManifest = baseManifest();
    const withBall = annotation();
    withBall.events.push({ id: 'ball-release', label: 'ball_release', atMs: 500, endMs: null, frame: null, confidence: 1, ambiguous: false, region: { x: 0, y: 0, width: 0.02, height: 0.02 }, value: null, note: null });
    expect(measurementsFromAnnotations(diameterManifest, withBall).find((item) => item.id === 'ball_diameter_release_px')?.value).toBe(15);
  });

  it('freezes every required placeholder metric with a unit, definition and direction', () => {
    const required = [
      'ball_local_luminance_contrast_ratio',
      'camera_shake_rms_px',
      'camera_roll_peak_degrees',
      'horizon_movement_rms_px',
      'bowler_motion_jerk_score',
      'bat_motion_jerk_score',
      'foot_slide_px',
      'bat_arc_discontinuity_count',
      'visible_clipping_count',
      'artifact_material_defect_count',
      'physical_event_to_camera_ms',
      'physical_event_to_result_ms',
      'touch_target_burden_count',
      'text_legibility_defect_count',
    ];
    const output = measurementsFromAnnotations(baseManifest({ applicability: { metrics: {}, excludedClaims: [] } }), annotation());
    for (const id of required) {
      const definition = registration.metrics.find((item: { id: string }) => item.id === id);
      const measurement = output.find((item) => item.id === id);
      expect(definition).toMatchObject({
        id,
        unit: expect.any(String),
        definition: expect.any(String),
        lowerIsBetter: expect.any(Boolean),
        applicability: expect.stringContaining('NOT_AVAILABLE'),
      });
      expect(registration.uncertainty.measurementRules[registration.uncertainty.metricRules[id]])
        .toEqual(expect.any(String));
      expect(measurement).toMatchObject({ id, status: 'not_available', value: null, unit: definition.unit });
    }
  });

  it('preserves historical v1/v2 and allowlists only the frozen complete v3 registration and visual method', () => {
    expect(sha256File(REGISTRATION_V1)).toBe('09d600346e28523248573b0d42d3cde1492e86dfe95da8d70cb0886d7ecabc8a');
    expect(sha256File(REGISTRATION_V2)).toBe('79d2b8e7ee9ae521a49986980676579b4bb03f43150d65be812e127040a07178');
    expect(registration).toMatchObject({ schemaVersion: 3, analysisVersion: '1.2.0', registeredBeforeComparison: true });
    expect(registration.metrics).toHaveLength(31);
    expect(new Set(registration.metrics.map((item: { id: string }) => item.id)).size).toBe(31);
    expect(registration.methodArtifacts).toContainEqual(expect.objectContaining({
      path: 'docs/evaluation/capture-compare/visual-method.v1.json',
      sha256: '8a9f86be086096c8e8ed7ca1b6975d0bad1890ccc83e27b36a37d6f73135111f',
    }));
    const visualMethod = JSON.parse(readFileSync(resolve('docs/evaluation/capture-compare/visual-method.v1.json'), 'utf8'));
    const checklistIds = new Set(visualMethod.artifactMaterialDefects.requiredChecklist.map((item: { id: string }) => item.id));
    for (const id of ['player.batter', 'player.bowler', 'player.wicketkeeper', 'player.fielders', 'player.umpires', 'artifact.ball', 'artifact.bat', 'artifact.stumps_bails', 'environment.pitch_creases', 'environment.crowd']) {
      expect(checklistIds.has(id)).toBe(true);
    }
    expect(visualMethod.textLegibilityDefects.thresholds).toMatchObject({
      normalTextMinimumContrastRatio: 4.5,
      largeTextMinimumContrastRatio: 3,
      largeTextMinimumInkHeightNormalizedPx: 24,
      minimumRenderedInkHeightNormalizedPx: 10,
    });
    expect(visualMethod.normalization.referenceShortSidePx).toBe(412);
    expect(() => assertApprovedRegistration(registration, REGISTRATION_V3)).not.toThrow();
    expect(() => assertApprovedRegistration(JSON.parse(readFileSync(REGISTRATION_V2, 'utf8')), REGISTRATION_V2))
      .toThrow(/schema|version|allowlisted/);
    expect(() => assertApprovedRegistration(JSON.parse(readFileSync(REGISTRATION_V1, 'utf8')), REGISTRATION_V1))
      .toThrow(/schema|version|allowlisted/);
  });

  it('rejects a post-result registration direction flip', () => {
    const altered = structuredClone(registration);
    altered.metrics.find((item: { id: string }) => item.id === 'time_to_first_playable_ball_ms').lowerIsBetter = false;
    expect(() => assertApprovedRegistration(altered)).toThrow(/not allowlisted/);
    expect(() => comparePackages([metricPackage(baseManifest()), metricPackage(baseManifest({ captureId: 'vande-adversarial-002' }), 900)], altered)).toThrow(/not allowlisted/);
  });

  it.each([
    ['device mismatch', { environment: { ...baseManifest().environment, device: 'Phone B' } }],
    ['platform mismatch', { environment: { ...baseManifest().environment, platform: 'unity-webgl' } }],
    ['os mismatch', { environment: { ...baseManifest().environment, os: 'Android 15' } }],
    ['incomplete sequence', { gameplay: { ...baseManifest().gameplay, wholeSequence: false } }],
    ['scenario mismatch', { gameplay: { ...baseManifest().gameplay, scenario: 'defence' } }],
    ['assistance mismatch', { gameplay: { ...baseManifest().gameplay, assistance: 'learn' } }],
  ])('returns NOT_COMPARABLE for %s', (reason, overrides) => {
    const left = metricPackage(baseManifest());
    const right = metricPackage(baseManifest({ captureId: 'vande-adversarial-002', ...overrides }), 900);
    const result = comparePackages([left, right], registration).find((item) => item.id === 'time_to_first_playable_ball_ms')?.comparisons[1];
    expect(result).toMatchObject({ status: 'not_comparable', direction: null, reason });
  });

  it.each([
    ['capture method mismatch', { method: 'external HDMI recorder' }],
    ['recorder class mismatch', { recorder: { class: 'external_capture', bitRateBps: 12_000_000 } }],
    ['recorder bit-rate mismatch', { recorder: { class: 'adb_screenrecord', bitRateBps: 6_000_000 } }],
    ['recorder perturbation/settings mismatch', { perturbations: ['adb screenrecord --bugreport'] }],
  ])('returns NOT_COMPARABLE for %s', (reason, captureOverride) => {
    const left = metricPackage(baseManifest());
    const rightManifest = baseManifest({
      captureId: 'vande-adversarial-002',
      capture: { ...baseManifest().capture, ...captureOverride },
    });
    const right = metricPackage(rightManifest, 900);
    const result = comparePackages([left, right], registration).find((item) => item.id === 'time_to_first_playable_ball_ms')?.comparisons[1];
    expect(result).toMatchObject({ status: 'not_comparable', direction: null, reason });
  });

  it('returns NOT_COMPARABLE for diagnostic/raw evidence', () => {
    const left = metricPackage(baseManifest());
    const diagnosticManifest = baseManifest({ captureId: 'vande-adversarial-002', evidenceClass: 'diagnostic' });
    const right = metricPackage(diagnosticManifest, 900, 'diagnostic_only');
    const result = comparePackages([left, right], registration).find((item) => item.id === 'time_to_first_playable_ball_ms')?.comparisons[1];
    expect(result).toMatchObject({ status: 'not_comparable', direction: null, reason: 'diagnostic or derived evidence has no directional cross-title comparison' });
  });

  it('returns NOT_COMPARABLE for incompatible uncertainty', () => {
    const left = metricPackage(baseManifest());
    const right = metricPackage(baseManifest({ captureId: 'vande-adversarial-002' }), 900);
    right.metrics.measurements[0].uncertainty = null;
    const result = comparePackages([left, right], registration).find((item) => item.id === 'time_to_first_playable_ball_ms')?.comparisons[1];
    expect(result).toMatchObject({ status: 'not_comparable', direction: null, reason: 'measurement uncertainty mismatch' });
  });

  it('never claims source files verified for direct unreceipted packages', () => {
    const left = metricPackage(baseManifest());
    const right = metricPackage(baseManifest({ captureId: 'vande-adversarial-002' }), 900);
    delete (left as Partial<typeof left>).provenanceVerified;
    delete (right as Partial<typeof right>).provenanceVerified;
    const report = buildComparison([left, right], registration, { id: 'reviewer', independent: true });
    expect(report.integrity.sourceFilesVerified).toBe(false);
    expect(report.findings.some((item) => item.severity === 'Critical' && item.finding.includes('provenance'))).toBe(true);
  });

  it('rejects fabricated metrics when the receipt is absent', () => {
    expect(() => verifyMetricsReceipt({
      receiptFile: '/definitely/missing/metrics-receipt.json', manifestFile: '/missing/manifest.json', metricsFile: '/missing/metrics.json',
      manifest: baseManifest(), metrics: metricPackage(baseManifest()).metrics, registration,
    })).toThrow(/receipt is missing/);
  });

  it('accepts a complete reproducible chain and rejects tampered annotation bytes', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'vande-compare-adversarial-'));
    const a = writePackage(join(scratch, 'vande'), 'vande-package-001', 'vande_engine_truth', 1200);
    const b = writePackage(join(scratch, 'competitor'), 'competitor-package-001', 'controlled_competitor', 900);
    const am = await calculateMetrics({ manifest: a.manifestFile, annotations: [a.annotationFile], output_dir: join(scratch, 'vande-metrics'), evaluator: 'reviewer-a', independent: true });
    const bm = await calculateMetrics({ manifest: b.manifestFile, annotations: [b.annotationFile], output_dir: join(scratch, 'competitor-metrics'), evaluator: 'reviewer-b', independent: true });
    const result = await compare({
      manifest: [a.manifestFile, b.manifestFile], metrics: [am.metrics, bm.metrics], receipt: [am.receipt, bm.receipt],
      output_dir: join(scratch, 'comparison'), evaluator: 'reviewer-c', independent: true,
    });
    const report = JSON.parse(readFileSync(result.json, 'utf8'));
    expect(report.integrity.sourceFilesVerified).toBe(true);
    const forgedReceipt = JSON.parse(readFileSync(am.receipt, 'utf8'));
    forgedReceipt.mediaProbes[0].observation.durationUs += 1_000;
    forgedReceipt.mediaProbes[0].observation.durationMs += 1;
    const forgedReceiptFile = join(am.output, 'forged-metrics-receipt.json');
    writeFileSync(forgedReceiptFile, canonicalJson(forgedReceipt));
    await expect(compare({
      manifest: [a.manifestFile, b.manifestFile], metrics: [am.metrics, bm.metrics], receipt: [forgedReceiptFile, bm.receipt],
      output_dir: join(scratch, 'forged-receipt-comparison'), evaluator: 'reviewer-c', independent: true,
    })).rejects.toThrow(/media probes/);
    const copiedAnnotation = join(am.output, 'annotations', `01-${a.annotationFile.split('/').at(-1)}`);
    appendFileSync(copiedAnnotation, ' ');
    await expect(compare({
      manifest: [a.manifestFile, b.manifestFile], metrics: [am.metrics, bm.metrics], receipt: [am.receipt, bm.receipt],
      output_dir: join(scratch, 'tampered-comparison'), evaluator: 'reviewer-c', independent: true,
    })).rejects.toThrow(/Annotation hash mismatch/);
  });

  it('fails before browser launch when a web artifact root is absent', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'vande-web-artifact-gate-'));
    await expect(captureWeb({ renderer: 'three-webgl', output_dir: join(scratch, 'capture') })).rejects.toThrow(/artifact-root is required/);
  });

  it('binds every artifact payload, including dynamic Vite and Unity runtime files', () => {
    const root = mkdtempSync(join(tmpdir(), 'vande-web-artifact-inventory-'));
    mkdirSync(join(root, 'assets'), { recursive: true });
    mkdirSync(join(root, 'Build'), { recursive: true });
    writeFileSync(join(root, 'index.html'), '<script type="module" src="assets/main.js"></script>');
    writeFileSync(join(root, 'assets', 'main.js'), 'import("./dynamic.js")');
    writeFileSync(join(root, 'assets', 'dynamic.js'), 'export default 1');
    writeFileSync(join(root, 'Build', 'game.loader.js'), 'loader');
    writeFileSync(join(root, 'Build', 'game.data'), 'data');
    writeFileSync(join(root, 'Build', 'game.framework.js'), 'framework');
    writeFileSync(join(root, 'Build', 'game.wasm'), 'wasm');

    const paths = artifactPathsForBinding(artifactInventory(root));
    expect(paths).toEqual([
      'Build/game.data',
      'Build/game.framework.js',
      'Build/game.loader.js',
      'Build/game.wasm',
      'assets/dynamic.js',
      'assets/main.js',
      'index.html',
    ]);

    const inventory = artifactInventory(root);
    expect(canonicalArtifactBase('https://capture.example/app')).toBe('https://capture.example/app/');
    expect(runtimeArtifactPath('https://capture.example/app/', 'https://capture.example/app', inventory)).toBe('index.html');
    expect(runtimeArtifactIdentity('https://capture.example/app/assets/dynamic.js', 'https://capture.example/app', inventory))
      .toEqual({ path: 'assets/dynamic.js', requestUrl: 'https://capture.example/app/assets/dynamic.js', query: '' });
    expect(() => runtimeArtifactPath('https://capture.example/app/assets/dynamic.js?v=1', 'https://capture.example/app', inventory)).toThrow(/query/);
    expect(() => runtimeArtifactPath('https://capture.example/app/assets/dynamic.js?v=2', 'https://capture.example/app', inventory)).toThrow(/query/);
    expect(runtimeArtifactPath('https://capture.example/app/Build/game.wasm', 'https://capture.example/app', inventory)).toBe('Build/game.wasm');
    expect(() => runtimeArtifactPath('https://other.example/app/assets/dynamic.js', 'https://capture.example/app', inventory)).toThrow(/outside/);
    expect(() => runtimeArtifactPath('https://capture.example/app2/assets/dynamic.js', 'https://capture.example/app', inventory)).toThrow(/escapes/);
    expect(() => runtimeArtifactPath('https://capture.example/app/assets%2Fdynamic.js', 'https://capture.example/app', inventory)).toThrow(/unsafe/);
    expect(() => runtimeArtifactPath('https://capture.example/app/assets/missing.js', 'https://capture.example/app', inventory)).toThrow(/absent/);
    expect(WEB_CAPTURE_BINDING_POLICY).toEqual({
      serviceWorkers: 'block', redirects: 'reject', partialResponses: 'reject', unboundRequests: 'reject', webSockets: 'reject',
      queries: 'reject', auxiliaryPages: 'reject', dedicatedWorkers: 'reject', downloads: 'reject',
    });
  });

  it('hash-verifies the bytes actually returned for a dynamic runtime response', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vande-web-runtime-binding-'));
    mkdirSync(join(root, 'assets'), { recursive: true });
    writeFileSync(join(root, 'index.html'), '<html></html>');
    writeFileSync(join(root, 'assets', 'dynamic.js'), 'export const bound = true;');
    const inventory = artifactInventory(root);
    const bytes = readFileSync(join(root, 'assets', 'dynamic.js'));
    const response = {
      request: () => ({ redirectedFrom: () => null, redirectedTo: () => null, url: () => 'https://capture.example/app/assets/dynamic.js' }),
      url: () => 'https://capture.example/app/assets/dynamic.js',
      status: () => 200,
      headers: () => ({}),
      body: async () => bytes,
    };
    await expect(verifyRuntimeArtifactResponse(response, 'https://capture.example/app', inventory))
      .resolves.toMatchObject({ path: 'assets/dynamic.js', sha256: sha256File(join(root, 'assets', 'dynamic.js')), bytes: bytes.byteLength });
    await expect(verifyRuntimeArtifactResponse({ ...response, body: async () => Buffer.from('tampered') }, 'https://capture.example/app', inventory))
      .rejects.toThrow(/do not match/);
    await expect(verifyRuntimeArtifactResponse({
      ...response,
      request: () => ({ redirectedFrom: () => ({}), redirectedTo: () => null, url: () => 'https://capture.example/app/assets/dynamic.js' }),
    }, 'https://capture.example/app', inventory)).rejects.toThrow(/redirect/);
  });

  it('binds a separate React host unity subtree to every verified Unity export byte', () => {
    const { exportRoot, hostRoot, verifiedFiles } = unityHostBoundaryFixture();
    const binding = verifyUnityHostArtifactBinding(artifactInventory(hostRoot), exportRoot, verifiedFiles);
    expect(binding).toMatchObject({ hostPrefix: 'unity/', fileCount: verifiedFiles.size });
    expect(binding.files.map((record) => record.hostPath)).toContain('unity/Build/game.wasm');
    expect(binding.files.map((record) => record.hostPath)).toContain('unity/vande-webgl-export-receipt.sig.json');
  });

  it('rejects treating the standalone Unity export as the React host artifact', () => {
    const { exportRoot, verifiedFiles } = unityHostBoundaryFixture();
    expect(() => verifyUnityHostArtifactBinding(
      artifactInventory(exportRoot, { requireIndex: false }), exportRoot, verifiedFiles,
    ))
      .toThrow(/must be separate directories/);
  });

  it('rejects a same-size hosted Unity runtime substitution', () => {
    const { exportRoot, hostRoot, verifiedFiles } = unityHostBoundaryFixture();
    writeFileSync(join(hostRoot, 'unity', 'Build', 'game.wasm'), 'fake');
    expect(() => verifyUnityHostArtifactBinding(artifactInventory(hostRoot), exportRoot, verifiedFiles))
      .toThrow(/differs from the verified Unity export/);
  });

  it('rejects changing both export and hosted runtime after provenance verification', () => {
    const { exportRoot, hostRoot, verifiedFiles } = unityHostBoundaryFixture();
    writeFileSync(join(exportRoot, 'Build', 'game.wasm'), 'fake');
    writeFileSync(join(hostRoot, 'unity', 'Build', 'game.wasm'), 'fake');
    expect(() => verifyUnityHostArtifactBinding(artifactInventory(hostRoot), exportRoot, verifiedFiles))
      .toThrow(/changed after provenance verification/);
  });

  it('rejects an extra payload injected into the hosted Unity subtree', () => {
    const { exportRoot, hostRoot, verifiedFiles } = unityHostBoundaryFixture();
    writeFileSync(join(hostRoot, 'unity', 'Build', 'shadow.wasm'), 'shadow');
    expect(() => verifyUnityHostArtifactBinding(artifactInventory(hostRoot), exportRoot, verifiedFiles))
      .toThrow(/does not exactly match|absent from the verified export/);
  });

  it('requires visible Unity input ownership and invariant identity through the result', () => {
    const continuity = assertRuntimePresentationContinuity(
      'unity-webgl', unityRuntimeState(), unityResultState(), stableUnityIdentityWatch(),
    );
    expect(continuity).toMatchObject({
      renderer: 'unity-webgl',
      admission: UNITY_WEBGL_ADMISSION_VALUE,
      armedInputOwner: 'unity-webgl-canvas',
      resultRenderer: 'unity-webgl',
      resultAdmission: UNITY_WEBGL_ADMISSION_VALUE,
    });
  });

  it('requires the shipped keyboard action to produce the authoritative swing it claims', () => {
    expect(assertCapturedKeyboardAction('ArrowUp', unityResultState()))
      .toEqual({ action: 'ArrowUp', expectedSwing: 'attack', observedSwing: 'attack' });
    expect(assertCapturedKeyboardAction('Space', unityResultState({ swing: 'defend' })))
      .toEqual({ action: 'Space', expectedSwing: 'defend', observedSwing: 'defend' });
    expect(() => assertCapturedKeyboardAction('ArrowUp', unityResultState({ swing: 'leave' })))
      .toThrow(/expected attack, observed leave/);
    expect(() => assertCapturedKeyboardAction('ArrowUp', unityResultState({ swing: null })))
      .toThrow(/expected attack, observed missing/);
  });

  it('rejects renderer or admission drift after Unity owned armed input', () => {
    expect(() => assertRuntimePresentationContinuity(
      'unity-webgl',
      unityRuntimeState(),
      unityResultState({ renderer: 'three-webgl' }),
      stableUnityIdentityWatch({ final: { renderer: 'three-webgl', admission: UNITY_WEBGL_ADMISSION_VALUE } }),
    )).toThrow(/Renderer drifted/);
    expect(() => assertRuntimePresentationContinuity(
      'unity-webgl',
      unityRuntimeState(),
      unityResultState({ admission: 'late-label-swap' }),
      stableUnityIdentityWatch({ final: { renderer: 'unity-webgl', admission: 'late-label-swap' } }),
    )).toThrow(/admission drifted/);
  });

  it('rejects transient renderer drift even when the armed and result labels match', () => {
    const watch = stableUnityIdentityWatch({
      transitions: [{
        atPerfMs: 150,
        attribute: 'data-vande-practice-renderer',
        oldValue: 'three-webgl',
        currentValue: 'unity-webgl',
      }],
    });
    expect(() => assertRuntimePresentationContinuity(
      'unity-webgl', unityRuntimeState(), unityResultState(), watch,
    )).toThrow(/identity mutated/);
  });

  it('rejects replacing the exact armed Unity canvas with a lookalike canvas', () => {
    const watch = stableUnityIdentityWatch({
      canvas: {
        id: 'vande-unity-practice-canvas',
        elementToken: 'armed-canvas-token',
        baseline: { connected: true, unique: true, renderer: 'unity-webgl' },
        final: { connected: false, sameElement: false, unique: true, renderer: 'unity-webgl' },
        rendererTransitions: [],
        childListTransitions: [{
          atPerfMs: 150,
          removedLatched: true,
          addedLatched: false,
          addedReplacement: true,
          currentMatchesLatched: false,
          latchedConnected: false,
        }],
      },
    });
    expect(() => assertRuntimePresentationContinuity(
      'unity-webgl', unityRuntimeState(), unityResultState(), watch,
    )).toThrow(/canvas was disconnected or replaced/);
  });

  it('rejects transient data-renderer drift on the exact armed Unity canvas', () => {
    const watch = stableUnityIdentityWatch({
      canvas: {
        id: 'vande-unity-practice-canvas',
        elementToken: 'armed-canvas-token',
        baseline: { connected: true, unique: true, renderer: 'unity-webgl' },
        final: { connected: true, sameElement: true, unique: true, renderer: 'unity-webgl' },
        rendererTransitions: [{ atPerfMs: 150, oldValue: 'three-webgl', currentValue: 'unity-webgl' }],
        childListTransitions: [],
      },
    });
    expect(() => assertRuntimePresentationContinuity(
      'unity-webgl', unityRuntimeState(), unityResultState(), watch,
    )).toThrow(/canvas data-renderer mutated/);
  });

  it('rejects a pre-latch canvas replacement between readiness polling and atomic ownership', () => {
    const armedState = unityRuntimeState();
    const racedStart: RuntimeIdentityWatchStart = {
      ownershipValidated: true,
      armedState,
      watchStart: {
        startedAtPerfMs: 100,
        baseline: { renderer: 'unity-webgl', admission: UNITY_WEBGL_ADMISSION_VALUE },
        canvas: {
          id: 'vande-unity-practice-canvas',
          elementToken: 'replacement-canvas-token',
          baseline: { connected: true, unique: true, renderer: 'unity-webgl' },
        },
      },
      error: null,
    };
    expect(() => assertAtomicRuntimeWatchStart('unity-webgl', racedStart))
      .toThrow(/snapshot differs from the exact latched canvas/);
  });

  it('rejects a late Unity label when React owned the armed input', () => {
    const retainedArmed = unityRuntimeState({
      renderer: 'three-webgl',
      admission: null,
      armed: true,
      reactInputArmed: true,
      inputOwner: 'react-gesture-surface',
      unitySurface: {
        visible: false,
        pointerEnabled: false,
        hitTest: false,
        inputReady: false,
        bridgeOperationActive: false,
        opacity: '0',
        pointerEvents: 'none',
      },
    });
    expect(() => assertRuntimePresentationContinuity(
      'unity-webgl', retainedArmed, unityResultState(), stableUnityIdentityWatch(),
    ))
      .toThrow(/Armed renderer mismatch/);
  });

  it('rejects trusted Unity payload downloads when the canvas is hidden and React owns input', () => {
    const hiddenUnity = unityRuntimeState({
      armed: true,
      reactInputArmed: true,
      inputOwner: 'react-gesture-surface',
      unitySurface: {
        visible: false,
        pointerEnabled: false,
        hitTest: false,
        inputReady: false,
        opacity: '0',
        pointerEvents: 'none',
      },
    });
    expect(() => assertRuntimePresentationContinuity(
      'unity-webgl', hiddenUnity, unityResultState(), stableUnityIdentityWatch(),
    ))
      .toThrow(/React gesture surface|visibly presented/);
  });

  it('rejects direct Unity WebGL capture without a verified Unity export before browser launch', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'vande-direct-webgl-gate-'));
    const artifactRoot = join(scratch, 'artifact');
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(join(artifactRoot, 'index.html'), '<html></html>');
    await expect(captureWeb({
      renderer: 'unity-webgl',
      artifact_root: artifactRoot,
      output_dir: join(scratch, 'capture'),
    })).rejects.toThrow(/unity-export-root/);
  });

  it('returns wrapper-level NOT_AVAILABLE before browser launch for an unqualified export', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'vande-webgl-wrapper-not-available-'));
    const exportRoot = join(scratch, 'export');
    const hostRoot = join(scratch, 'host');
    mkdirSync(exportRoot, { recursive: true });
    mkdirSync(hostRoot, { recursive: true });
    writeFileSync(join(exportRoot, 'index.html'), '<html>not a qualified Unity export</html>');
    writeFileSync(join(hostRoot, 'index.html'), '<html>React host</html>');
    const result = await captureWebGl({
      base: 'https://capture.invalid/',
      export_root: exportRoot,
      host_artifact_root: hostRoot,
      output_dir: join(scratch, 'evidence'),
      evaluator: 'adversarial-wrapper-test',
    });
    expect(result).toMatchObject({ ok: false, status: 'NOT_AVAILABLE' });
    expect(JSON.parse(readFileSync(result.manifest, 'utf8'))).toMatchObject({ status: 'not_available' });
  });

  it('rejects structurally valid self-authored Unity payloads without an independently trusted exporter receipt', () => {
    const root = mkdtempSync(join(tmpdir(), 'vande-forged-unity-export-'));
    const build = join(root, 'Build');
    mkdirSync(build, { recursive: true });
    const loader = join(build, 'forged.loader.js');
    const data = join(build, 'forged.data');
    const framework = join(build, 'forged.framework.js');
    const code = join(build, 'forged.wasm');
    writeFileSync(loader, `function createUnityInstance(){ return WebAssembly; }\n${'// forged loader\n'.repeat(30)}`);
    writeFileSync(framework, `var unityFramework = {}; var Module = {};\n${'// forged framework\n'.repeat(30)}`);
    writeFileSync(code, Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
    const pathBytes = Buffer.from('x.js');
    const headerBytes = 20 + 12 + pathBytes.length;
    const dataBytes = Buffer.alloc(headerBytes + 1);
    Buffer.from('UnityWebData1.0\0', 'ascii').copy(dataBytes, 0);
    dataBytes.writeUInt32LE(headerBytes, 16);
    dataBytes.writeUInt32LE(headerBytes, 20);
    dataBytes.writeUInt32LE(1, 24);
    dataBytes.writeUInt32LE(pathBytes.length, 28);
    pathBytes.copy(dataBytes, 32);
    dataBytes[headerBytes] = 0;
    writeFileSync(data, dataBytes);
    const manifest = {
      schema: 2,
      buildId: SOURCE,
      unitySourceSha256: 'f'.repeat(64),
      unityVersion: '6000.3.27f1',
      productVersion: '1.0',
      loader: { url: 'Build/forged.loader.js', sha256: sha256File(loader) },
      data: { url: 'Build/forged.data', sha256: sha256File(data) },
      framework: { url: 'Build/forged.framework.js', sha256: sha256File(framework) },
      code: { url: 'Build/forged.wasm', sha256: sha256File(code) },
      streamingAssetsUrl: 'StreamingAssets',
    };
    expect(() => validateUnityPayloadStructure(root, manifest)).not.toThrow();
    expect(() => verifyTrustedUnityExport(root, manifest, { expectedBuildId: SOURCE, expectedSourceSha256: 'f'.repeat(64) }))
      .toThrow(/signed exporter receipt|NOT_AVAILABLE/);
  });
});
