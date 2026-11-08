#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  assertValidAnnotationsForManifest,
  canonicalJson,
  sha256File,
  validateAnnotations,
  validateManifest,
} from '../../../../../scripts/eval/compare/lib.mjs';
import {
  validateAndroidIdentityEvidence,
  validateArtifactHashWindow,
} from '../../../../../scripts/eval/compare/capture-android.mjs';
import {
  artifactInventory,
  artifactPathsForBinding,
  captureWeb,
  runtimeArtifactPath,
  verifyRuntimeArtifactResponse,
} from '../../../../../scripts/eval/compare/capture-web.mjs';
import {
  annotationWorkflow,
  calculateMetrics,
  measurementsFromAnnotations,
} from '../../../../../scripts/eval/compare/metrics.mjs';
import {
  assertApprovedRegistration,
  buildComparison,
  compare,
  comparePackages,
} from '../../../../../scripts/eval/compare/compare.mjs';
import { normalize, parseFfprobeObservation } from '../../../../../scripts/eval/compare/normalize.mjs';

const REPO = resolve(import.meta.dirname, '../../../../..');
const SOURCE = '38924bd+123456789abc';
const V1_FILE = resolve(REPO, 'docs/evaluation/capture-compare/registration.v1.json');
const V2_FILE = resolve(REPO, 'docs/evaluation/capture-compare/registration.v2.json');
const v1 = JSON.parse(readFileSync(V1_FILE, 'utf8'));
const v2 = JSON.parse(readFileSync(V2_FILE, 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'vande-capture-retest-v2-'));
const checks = [];

function record(id, expected, observed, pass, severity = 'High') {
  checks.push({ id, severity, expected, observed, pass: Boolean(pass) });
}

async function rejects(id, pattern, action, severity = 'High') {
  try {
    await action();
    record(id, `reject matching ${String(pattern)}`, 'accepted', false, severity);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record(id, `reject matching ${String(pattern)}`, message, pattern.test(message), severity);
  }
}

function evidenceRecord(file, root, role, mimeType, durationMs = null) {
  return {
    role,
    path: file.slice(root.length + 1),
    bytes: statSync(file).size,
    sha256: sha256File(file),
    mimeType,
    raw: true,
    durationMs,
  };
}

function baseManifest({ captureId = 'vande-retest-v2-001', lane = 'vande_engine_truth', mediaRecord = null, artifactRecord = null } = {}) {
  const competitor = lane === 'controlled_competitor';
  const files = mediaRecord
    ? [mediaRecord, ...(artifactRecord ? [artifactRecord] : [])]
    : [
        { role: 'raw_video', path: 'raw.mp4', bytes: 5, sha256: 'a'.repeat(64), mimeType: 'video/mp4', raw: true, durationMs: 10_000 },
        ...(competitor ? [] : [{ role: 'artifact_inventory', path: 'artifact.json', bytes: 2, sha256: 'e'.repeat(64), mimeType: 'application/json', raw: true, durationMs: null }]),
      ];
  const artifact = competitor ? null : {
    path: artifactRecord?.path ?? 'artifact.json',
    sha256: artifactRecord?.sha256 ?? 'e'.repeat(64),
  };
  return {
    schemaVersion: 1,
    captureId,
    lane,
    evidenceClass: 'raw',
    status: 'captured',
    evaluator: { id: 'independent-retest-v2', role: 'capture operator', authoredSubject: false, independent: true },
    rights: competitor
      ? { basis: 'lawfully installed fixture; terms reviewed', sourceUrl: null, redistribution: 'prohibited', notes: [] }
      : { basis: 'VANDE-owned fixture', sourceUrl: null, redistribution: 'owned', notes: [] },
    identity: competitor
      ? {
          repositorySourceId: null,
          embeddedBuildId: null,
          artifact: null,
          application: { title: 'Competitor fixture', packageId: 'example.competitor', version: '1', store: 'Google Play' },
          renderer: { claimed: null, observed: 'undisclosed-proprietary-runtime', admission: null, proof: 'package-manager fixture' },
        }
      : {
          repositorySourceId: SOURCE,
          embeddedBuildId: SOURCE,
          artifact,
          application: { title: 'VANDE Cricket', packageId: 'in.vande.cricket', version: '1', store: null },
          renderer: { claimed: 'three-webgl', observed: 'three-webgl', admission: 'retained', proof: 'fixture proof' },
        },
    timing: { capturedAtUtc: '2026-10-29T02:00:00.000Z', hostUptime: 'independent fixture', durationMs: 10_000 },
    environment: {
      platform: 'Android',
      device: 'Phone A / adb:fixture',
      os: 'Android 14',
      soc: 'fixture-soc',
      gpu: 'fixture-gpu',
      ramMb: 4096,
      viewport: { width: 1000, height: 500, deviceScaleFactor: 1 },
      orientation: 'landscape',
      refreshHz: 60,
      qualityTier: 'balanced',
      thermal: 'nominal',
      battery: '80%',
      power: 'battery',
      network: 'offline',
      backgroundLoad: 'matched fixture method',
    },
    gameplay: {
      scenario: 'leave',
      seed: null,
      controls: 'physical touch',
      inputMethod: 'human',
      assistance: 'play',
      handedness: 'right',
      pitch: 'balanced',
      field: 'balanced',
      timeScale: 1,
      wholeSequence: true,
    },
    capture: {
      method: 'bounded adb screenrecord',
      recorder: { class: 'adb_screenrecord', bitRateBps: 12_000_000 },
      resolution: { width: 1000, height: 500 },
      frameRate: 60,
      codec: 'h264',
      audio: { method: 'none', synchronized: false, limitations: ['no audio'] },
      perturbations: ['adb screenrecord can perturb performance'],
      limitations: [],
    },
    files,
    sidecars: { events: [], physics: [], replay: [], frames: [], annotations: [] },
    transformations: [],
    applicability: {
      metrics: { time_to_first_playable_ball_ms: 'eligible', ball_diameter_release_px: 'eligible' },
      excludedClaims: [],
    },
    expectedScenario: 'leave',
    observedDeviations: [],
    errors: [],
    tools: { node: process.version },
  };
}

function annotation(captureId = 'vande-retest-v2-001', manifestSha256 = 'b'.repeat(64), mediaSha256 = 'a'.repeat(64), firstPlayable = 1000) {
  return {
    schemaVersion: 1,
    captureId,
    annotator: { id: 'primary-reviewer', role: 'primary', independentOfBuilder: true },
    source: { mediaSha256, manifestSha256 },
    events: [
      { id: 'launch', label: 'launch', atMs: 0, endMs: null, frame: null, confidence: 1, ambiguous: false, region: null, value: null, note: null },
      { id: 'first-playable', label: 'first_playable', atMs: firstPlayable, endMs: null, frame: null, confidence: 1, ambiguous: false, region: null, value: null, note: null },
    ],
    adjudication: null,
  };
}

function metricPackage(manifest, value = 1000, status = 'measured') {
  return {
    manifest,
    metrics: {
      schemaVersion: 1,
      analysisVersion: '1.1.0',
      captureId: manifest.captureId,
      manifestSha256: 'c'.repeat(64),
      generatedAtUtc: manifest.timing.capturedAtUtc,
      lane: manifest.lane,
      evidenceClass: manifest.evidenceClass,
      scenario: manifest.gameplay.scenario,
      evaluator: { id: 'independent-retest-v2', authoredTooling: false, independentOfSubject: true },
      integrity: { status: 'passed', rejections: [] },
      measurements: [{
        id: 'time_to_first_playable_ball_ms',
        status,
        value,
        unit: 'ms',
        sampleSize: 1,
        uncertainty: { kind: 'half_frame_interval', value: 500 / 60, unit: 'ms', confidence: null },
        timecodesMs: [0, value],
        sources: ['annotations.json'],
        limitations: [],
      }],
      ceriEvidence: [],
    },
    metricsSha256: 'd'.repeat(64),
    provenanceVerified: true,
  };
}

function makePackage(root, captureId, lane, firstPlayable) {
  mkdirSync(root, { recursive: true });
  const video = join(root, 'raw.mp4');
  writeFileSync(video, `video-${captureId}`);
  const artifact = join(root, 'artifact.json');
  if (lane === 'vande_engine_truth') writeFileSync(artifact, '{}');
  const mediaRecord = evidenceRecord(video, root, 'raw_video', 'video/mp4', 10_000);
  const artifactRecord = lane === 'vande_engine_truth' ? evidenceRecord(artifact, root, 'artifact_inventory', 'application/json') : null;
  const manifest = baseManifest({ captureId, lane, mediaRecord, artifactRecord });
  const manifestFile = join(root, 'manifest.json');
  writeFileSync(manifestFile, canonicalJson(manifest));
  const annotations = annotation(captureId, sha256File(manifestFile), mediaRecord.sha256, firstPlayable);
  const annotationFile = join(root, 'annotations.json');
  writeFileSync(annotationFile, canonicalJson(annotations));
  return { video, manifest, manifestFile, annotationFile };
}

// AUD-C01/C02/H06: Android artifact, runtime, source and foreground trust boundaries.
const callerEvidence = {
  buildId: SOURCE,
  expectedBuildId: SOURCE,
  installedBuildIdentity: { observedDom: SOURCE, observedEvidenceSurface: SOURCE },
  device: { serial: 'device-1' },
  rendererEvidence: [{ renderer: 'unity-native', selectionClassification: 'unity_native', admission: 'accepted' }],
  practiceTestApiPresent: false,
};
const trusted = {
  artifactBuildId: SOURCE,
  artifactInventorySha256: 'f'.repeat(64),
  installedUnityRuntime: true,
  runtimeObservations: [
    { buildId: SOURCE, renderer: 'unity-native', admission: 'accepted', practiceTestApiPresent: false },
    { buildId: SOURCE, renderer: 'unity-native', admission: 'accepted', practiceTestApiPresent: false },
  ],
  foregroundObservations: [
    { packageId: 'in.vande.cricket', obscured: false },
    { packageId: 'in.vande.cricket', obscured: false },
  ],
};
const callerOnly = validateAndroidIdentityEvidence(callerEvidence, { sourceId: SOURCE, serial: 'device-1', renderer: 'unity-native' });
record('AUD-C01-caller-only', 'reject caller-only identity', callerOnly, callerOnly.some((item) => item.includes('trusted tool-derived')), 'Critical');
const wrongApkIdentity = validateAndroidIdentityEvidence(callerEvidence, { sourceId: SOURCE, serial: 'device-1', renderer: 'unity-native', trusted: { ...trusted, artifactBuildId: '38924bd+ffffffffffff' } });
record('AUD-C01-apk-derived-build', 'reject wrong APK-derived build', wrongApkIdentity, wrongApkIdentity.some((item) => item.includes('installed APK embedded build')), 'Critical');
const missingRuntime = validateAndroidIdentityEvidence(callerEvidence, { sourceId: SOURCE, serial: 'device-1', renderer: 'unity-native', trusted: { ...trusted, installedUnityRuntime: false, runtimeObservations: trusted.runtimeObservations.map((item) => ({ ...item, admission: null })) } });
record('AUD-C01-runtime-proof', 'reject missing live/native Unity proof', missingRuntime, missingRuntime.some((item) => item.includes('admission proof')) && missingRuntime.some((item) => item.includes('native Unity runtime')), 'Critical');
const wrongForeground = validateAndroidIdentityEvidence(callerEvidence, { sourceId: SOURCE, serial: 'device-1', renderer: 'unity-native', trusted: { ...trusted, foregroundObservations: [{ packageId: 'other.app', obscured: true }, trusted.foregroundObservations[1]] } });
record('AUD-C02-foreground', 'reject wrong/obscured package', wrongForeground, wrongForeground.some((item) => item.includes('foreground package')), 'Critical');
const changedApk = validateArtifactHashWindow(
  [{ path: '/data/app/base.apk', sha256: 'a'.repeat(64) }],
  [{ path: '/data/app/base.apk', sha256: 'b'.repeat(64) }],
  [{ remotePath: '/data/app/base.apk', sha256: 'a'.repeat(64) }],
);
record('AUD-C01-apk-window', 'reject changed split', changedApk, changedApk.some((item) => item.includes('changed during recording')), 'Critical');
const localMismatch = validateArtifactHashWindow(
  [{ path: '/data/app/base.apk', sha256: 'a'.repeat(64) }],
  [{ path: '/data/app/base.apk', sha256: 'a'.repeat(64) }],
  [{ remotePath: '/data/app/base.apk', sha256: 'c'.repeat(64) }],
);
record('AUD-C01-local-apk-mismatch', 'reject pulled/installed mismatch', localMismatch, localMismatch.some((item) => item.includes('pulled APK bytes differ')), 'Critical');
const androidSource = readFileSync(resolve(REPO, 'scripts/eval/compare/capture-android.mjs'), 'utf8');
const androidFlow = ['deriveInstalledArtifactIdentity(localApks)', 'remoteHashesBefore', 'remoteHashesAfter', 'foregroundBefore', 'foregroundAfter', 'runtimeBefore', 'runtimeAfter', 'const sourceAfter = sourceBuildId()'];
record('AUD-C01-C02-H06-source-flow', 'all before/after derivations present', androidFlow.filter((needle) => androidSource.includes(needle)), androidFlow.every((needle) => androidSource.includes(needle)), 'Critical');

// AUD-H02/H03/H04 plus duration and M02 fixes.
const sidecarManifest = baseManifest();
sidecarManifest.sidecars.events = ['ghost.json'];
const sidecarErrors = validateManifest(sidecarManifest);
record('AUD-H02-sidecar', 'reject undeclared sidecar', sidecarErrors, sidecarErrors.some((item) => item.includes('hash-bound entry')));
const invalidAdjudicator = { ...annotation(), annotator: { id: 'adjudicator', role: 'adjudicator', independentOfBuilder: true }, adjudication: null };
const invalidAdjudicatorErrors = validateAnnotations(invalidAdjudicator, { durationMs: 10_000, captureId: invalidAdjudicator.captureId });
record('AUD-H03-adjudicator-shape', 'reject missing review/decision', invalidAdjudicatorErrors, invalidAdjudicatorErrors.some((item) => item.includes('mandatory for an adjudicator')));
const primary = annotation();
const secondary = { ...annotation(), annotator: { id: 'secondary', role: 'secondary', independentOfBuilder: true } };
const adjudicator = { ...annotation(), annotator: { id: 'adjudicator', role: 'adjudicator', independentOfBuilder: true }, adjudication: { reviewedFiles: ['4'.repeat(64), '5'.repeat(64)], decisions: ['Reviewed disagreement.'] } };
const badWorkflow = annotationWorkflow([
  { value: primary, sha256: '1'.repeat(64), path: 'primary.json' },
  { value: secondary, sha256: '2'.repeat(64), path: 'secondary.json' },
  { value: adjudicator, sha256: '3'.repeat(64), path: 'adjudicator.json' },
]);
record('AUD-H03-adjudication-hashes', 'reject unknown reviewed hashes', badWorkflow.rejections, badWorkflow.rejections.some((item) => item.includes('exactly match')));
const differentSourceSecondary = { ...secondary, source: { ...secondary.source, mediaSha256: 'c'.repeat(64) } };
const mixedWorkflow = annotationWorkflow([
  { value: primary, sha256: '1'.repeat(64), path: 'primary.json' },
  { value: differentSourceSecondary, sha256: '2'.repeat(64), path: 'secondary.json' },
  { value: { ...adjudicator, adjudication: { reviewedFiles: ['1'.repeat(64), '2'.repeat(64)], decisions: ['Reviewed disagreement.'] } }, sha256: '3'.repeat(64), path: 'adjudicator.json' },
]);
record('AUD-H03-adjudication-source', 'reject mixed media', mixedWorkflow.rejections, mixedWorkflow.rejections.some((item) => item.includes('same manifest and source video')));
const undeclaredManifest = baseManifest();
undeclaredManifest.applicability.metrics = {};
const undeclaredMetric = measurementsFromAnnotations(undeclaredManifest, annotation()).find((item) => item.id === 'time_to_first_playable_ball_ms');
record('AUD-H04-applicability', 'NOT_AVAILABLE', undeclaredMetric, undeclaredMetric?.status === 'not_available' && undeclaredMetric.value === null);
const overrun = annotation('vande-retest-v2-001', 'b'.repeat(64), 'a'.repeat(64), 15_000);
let overrunError = '';
try { assertValidAnnotationsForManifest(overrun, baseManifest()); } catch (error) { overrunError = String(error); }
record('DURATION-video-bound', 'reject 15 s event against 10 s video', overrunError, /outside the capture duration/.test(overrunError));
const noDurationManifest = baseManifest();
noDurationManifest.files = noDurationManifest.files.map((item) => item.mimeType === 'video/mp4' ? { ...item, durationMs: null } : item);
let noDurationError = '';
try { assertValidAnnotationsForManifest(annotation(), noDurationManifest); } catch (error) { noDurationError = String(error); }
record('DURATION-positive-probe-required', 'reject timecodes without probed video duration', noDurationError, /positive probed duration/.test(noDurationError));
const diameterAnnotation = annotation();
diameterAnnotation.events.push({ id: 'ball-release', label: 'ball_release', atMs: 500, endMs: null, frame: null, confidence: 1, ambiguous: false, region: { x: 0, y: 0, width: 0.02, height: 0.02 }, value: null, note: null });
const diameter = measurementsFromAnnotations(baseManifest(), diameterAnnotation).find((item) => item.id === 'ball_diameter_release_px');
record('AUD-M02-arithmetic-diameter', 15, diameter?.value, diameter?.value === 15, 'Medium');

// AUD-C04 and RET-H07: immutable historical v1, allowlisted v2 and all frozen measures.
record('AUD-C04-v1-hash', '09d600346e28523248573b0d42d3cde1492e86dfe95da8d70cb0886d7ecabc8a', sha256File(V1_FILE), sha256File(V1_FILE) === '09d600346e28523248573b0d42d3cde1492e86dfe95da8d70cb0886d7ecabc8a', 'Critical');
let v2Accepted = false;
try { assertApprovedRegistration(v2, V2_FILE); v2Accepted = true; } catch { v2Accepted = false; }
record('AUD-C04-v2-allowlist', true, v2Accepted, v2Accepted, 'Critical');
await rejects('AUD-C04-v1-not-active', /version|allowlisted/i, () => assertApprovedRegistration(v1, V1_FILE), 'Critical');
const directionFlip = structuredClone(v2);
directionFlip.metrics.find((item) => item.id === 'time_to_first_playable_ball_ms').lowerIsBetter = false;
await rejects('AUD-C04-direction-flip', /not allowlisted/i, () => assertApprovedRegistration(directionFlip), 'Critical');
const firstSeventeenUnchanged = v1.metrics.every((item, index) => canonicalJson(item) === canonicalJson(v2.metrics[index]));
record('AUD-C04-v1-semantics-preserved', true, firstSeventeenUnchanged, firstSeventeenUnchanged, 'Critical');
const required14 = [
  'ball_local_luminance_contrast_ratio', 'camera_shake_rms_px', 'camera_roll_peak_degrees', 'horizon_movement_rms_px',
  'bowler_motion_jerk_score', 'bat_motion_jerk_score', 'foot_slide_px', 'bat_arc_discontinuity_count',
  'visible_clipping_count', 'artifact_material_defect_count', 'physical_event_to_camera_ms',
  'physical_event_to_result_ms', 'touch_target_burden_count', 'text_legibility_defect_count',
];
const ids = v2.metrics.map((item) => item.id);
record('RET-H07-31-unique-ids', '31 unique metrics', { count: ids.length, unique: new Set(ids).size }, ids.length === 31 && new Set(ids).size === 31);
const defined14 = required14.filter((id) => {
  const item = v2.metrics.find((metric) => metric.id === id);
  return item && typeof item.unit === 'string' && item.unit.length > 0 && typeof item.definition === 'string' && item.definition.length > 20 && typeof item.lowerIsBetter === 'boolean' && typeof item.applicability === 'string' && item.applicability.length > 20 && typeof v2.uncertainty.metricRules?.[id] === 'string';
});
record('RET-H07-14-definitions', required14, defined14, defined14.length === required14.length);
const placeholderIds = new Set(measurementsFromAnnotations(undeclaredManifest, annotation()).map((item) => item.id));
record('RET-H07-31-output-ids', 'all 31 emitted', { count: placeholderIds.size, missing: ids.filter((id) => !placeholderIds.has(id)) }, placeholderIds.size === 31 && ids.every((id) => placeholderIds.has(id)));

// AUD-H01 plus RET-H01 OS/recorder compatibility.
const referenceManifest = baseManifest({ captureId: 'vande-reference-v2-001' });
const candidateBase = baseManifest({ captureId: 'competitor-reference-v2-001', lane: 'controlled_competitor' });
const referencePackage = metricPackage(referenceManifest, 1200);
function comparisonFor(overrides, status = 'measured') {
  const candidate = {
    ...candidateBase,
    ...overrides,
    environment: { ...candidateBase.environment, ...(overrides.environment ?? {}) },
    gameplay: { ...candidateBase.gameplay, ...(overrides.gameplay ?? {}) },
    capture: { ...candidateBase.capture, ...(overrides.capture ?? {}) },
  };
  return comparePackages([referencePackage, metricPackage(candidate, 900, status)], v2)
    .find((item) => item.id === 'time_to_first_playable_ball_ms').comparisons[1];
}
const compatibilityCases = [
  ['AUD-H01-device', { environment: { device: 'Phone B / adb:fixture' } }, 'device mismatch', 'measured'],
  ['AUD-H01-platform', { environment: { platform: 'unity-webgl' } }, 'platform mismatch', 'measured'],
  ['RET-H01-OS', { environment: { os: 'Android 15' } }, 'os mismatch', 'measured'],
  ['AUD-H01-sequence', { gameplay: { wholeSequence: false } }, 'incomplete sequence', 'measured'],
  ['AUD-H01-assistance', { gameplay: { assistance: 'learn' } }, 'assistance mismatch', 'measured'],
  ['RET-H01-method', { capture: { method: 'external capture card' } }, 'capture method mismatch', 'measured'],
  ['RET-H01-recorder-class', { capture: { recorder: { class: 'external_capture', bitRateBps: 12_000_000 } } }, 'recorder class mismatch', 'measured'],
  ['RET-H01-bitrate', { capture: { recorder: { class: 'adb_screenrecord', bitRateBps: 6_000_000 } } }, 'recorder bit-rate mismatch', 'measured'],
  ['RET-H01-perturbations', { capture: { perturbations: ['different recorder load'] } }, 'recorder perturbation/settings mismatch', 'measured'],
  ['AUD-H01-diagnostic', { evidenceClass: 'diagnostic' }, 'diagnostic or derived evidence has no directional cross-title comparison', 'diagnostic_only'],
];
for (const [id, overrides, reason, status] of compatibilityCases) {
  const observed = comparisonFor(overrides, status);
  record(id, `not_comparable: ${reason}`, observed, observed.status === 'not_comparable' && observed.reason === reason && observed.direction === null);
}
const noRecorder = comparisonFor({ capture: { recorder: undefined } });
record('RET-H01-recorder-required-for-direction', 'not_comparable: missing structured recorder metadata', noRecorder, noRecorder.status === 'not_comparable' && noRecorder.reason === 'missing structured recorder metadata');
const uncertaintyCandidate = metricPackage(candidateBase, 900);
uncertaintyCandidate.metrics.measurements[0].uncertainty = null;
const uncertainty = comparePackages([referencePackage, uncertaintyCandidate], v2).find((item) => item.id === 'time_to_first_playable_ball_ms').comparisons[1];
record('AUD-H01-uncertainty', 'not_comparable: measurement uncertainty mismatch', uncertainty, uncertainty.status === 'not_comparable' && uncertainty.reason === 'measurement uncertainty mismatch');

// AUD-C03: integrated receipt/manifest/media/annotation/registration/derivation chain.
const packagesRoot = join(scratch, 'packages');
const packageA = makePackage(join(packagesRoot, 'vande'), 'vande-package-v2-001', 'vande_engine_truth', 1200);
const packageB = makePackage(join(packagesRoot, 'competitor'), 'competitor-package-v2-001', 'controlled_competitor', 900);
const metricsA = await calculateMetrics({ manifest: packageA.manifestFile, annotations: [packageA.annotationFile], output_dir: join(scratch, 'metrics-a'), evaluator: 'independent-retest-v2-a', independent: true });
const metricsB = await calculateMetrics({ manifest: packageB.manifestFile, annotations: [packageB.annotationFile], output_dir: join(scratch, 'metrics-b'), evaluator: 'independent-retest-v2-b', independent: true });
const goodComparison = await compare({ manifest: [packageA.manifestFile, packageB.manifestFile], metrics: [metricsA.metrics, metricsB.metrics], receipt: [metricsA.receipt, metricsB.receipt], output_dir: join(scratch, 'comparison-good'), evaluator: 'independent-retest-v2-c', independent: true });
const goodReport = JSON.parse(readFileSync(goodComparison.json, 'utf8'));
record('AUD-C03-complete-receipt-chain', true, goodReport.integrity.sourceFilesVerified, goodReport.integrity.sourceFilesVerified === true, 'Critical');
const unverifiedReport = buildComparison([{ ...referencePackage, provenanceVerified: undefined }, { ...metricPackage(candidateBase, 900), provenanceVerified: undefined }], v2, { id: 'independent-retest-v2', independent: true });
record('AUD-C03-not-hardcoded', false, unverifiedReport.integrity.sourceFilesVerified, unverifiedReport.integrity.sourceFilesVerified === false && unverifiedReport.findings.some((item) => item.severity === 'Critical'), 'Critical');
await rejects('AUD-C03-receipt-required', /receipt is missing/i, () => compare({ manifest: [packageA.manifestFile, packageB.manifestFile], metrics: [metricsA.metrics, metricsB.metrics], receipt: [join(scratch, 'missing-receipt.json'), metricsB.receipt], output_dir: join(scratch, 'comparison-missing-receipt') }), 'Critical');
const originalMedia = readFileSync(packageA.video);
appendFileSync(packageA.video, 'tamper');
await rejects('AUD-C03-media-tamper', /does not match file bytes|does not match observed/i, () => compare({ manifest: [packageA.manifestFile, packageB.manifestFile], metrics: [metricsA.metrics, metricsB.metrics], receipt: [metricsA.receipt, metricsB.receipt], output_dir: join(scratch, 'comparison-media-tamper') }), 'Critical');
writeFileSync(packageA.video, originalMedia);
const metricsOriginal = readFileSync(metricsA.metrics);
const receiptOriginal = readFileSync(metricsA.receipt);
const alteredMetrics = JSON.parse(metricsOriginal.toString('utf8'));
alteredMetrics.measurements.find((item) => item.id === 'time_to_first_playable_ball_ms').value = 1;
writeFileSync(metricsA.metrics, canonicalJson(alteredMetrics));
const alteredReceipt = JSON.parse(receiptOriginal.toString('utf8'));
alteredReceipt.metrics.sha256 = sha256File(metricsA.metrics);
writeFileSync(metricsA.receipt, canonicalJson(alteredReceipt));
await rejects('AUD-C03-metric-rederivation', /not reproducible/i, () => compare({ manifest: [packageA.manifestFile, packageB.manifestFile], metrics: [metricsA.metrics, metricsB.metrics], receipt: [metricsA.receipt, metricsB.receipt], output_dir: join(scratch, 'comparison-metric-tamper') }), 'Critical');
writeFileSync(metricsA.metrics, metricsOriginal);
writeFileSync(metricsA.receipt, receiptOriginal);
const annotationCopy = join(metricsA.output, 'annotations', '01-annotations.json');
const annotationOriginal = readFileSync(annotationCopy);
appendFileSync(annotationCopy, ' ');
await rejects('AUD-C03-annotation-tamper', /Annotation hash mismatch/i, () => compare({ manifest: [packageA.manifestFile, packageB.manifestFile], metrics: [metricsA.metrics, metricsB.metrics], receipt: [metricsA.receipt, metricsB.receipt], output_dir: join(scratch, 'comparison-annotation-tamper') }), 'Critical');
writeFileSync(annotationCopy, annotationOriginal);

// AUD-H05 plus RET-H05 direct verifier and complete dynamic/Unity payload binding primitives.
const webRoot = join(scratch, 'web-artifact');
mkdirSync(join(webRoot, 'assets'), { recursive: true });
mkdirSync(join(webRoot, 'Build'), { recursive: true });
writeFileSync(join(webRoot, 'index.html'), '<script type="module" src="assets/main.js"></script>');
writeFileSync(join(webRoot, 'assets', 'main.js'), 'import("./dynamic.js")');
writeFileSync(join(webRoot, 'assets', 'dynamic.js'), 'export default 1');
writeFileSync(join(webRoot, 'Build', 'game.loader.js'), 'loader');
writeFileSync(join(webRoot, 'Build', 'game.data'), 'data');
writeFileSync(join(webRoot, 'Build', 'game.framework.js'), 'framework');
writeFileSync(join(webRoot, 'Build', 'game.wasm'), 'wasm');
const inventory = artifactInventory(webRoot);
const boundPaths = artifactPathsForBinding(inventory);
const expectedPaths = ['Build/game.data', 'Build/game.framework.js', 'Build/game.loader.js', 'Build/game.wasm', 'assets/dynamic.js', 'assets/main.js', 'index.html'];
record('RET-H05-complete-inventory', expectedPaths, boundPaths, canonicalJson(boundPaths) === canonicalJson(expectedPaths));
record('RET-H05-dynamic-path', 'assets/dynamic.js', runtimeArtifactPath('https://capture.example/app/assets/dynamic.js?v=1', 'https://capture.example/app', inventory), runtimeArtifactPath('https://capture.example/app/assets/dynamic.js?v=1', 'https://capture.example/app', inventory) === 'assets/dynamic.js');
record('RET-H05-unity-wasm-path', 'Build/game.wasm', runtimeArtifactPath('https://capture.example/app/Build/game.wasm', 'https://capture.example/app', inventory), runtimeArtifactPath('https://capture.example/app/Build/game.wasm', 'https://capture.example/app', inventory) === 'Build/game.wasm');
const dynamicBytes = readFileSync(join(webRoot, 'assets', 'dynamic.js'));
const response = {
  request: () => ({ redirectedFrom: () => null, redirectedTo: () => null }),
  url: () => 'https://capture.example/app/assets/dynamic.js',
  status: () => 200,
  headers: () => ({}),
  body: async () => dynamicBytes,
};
const verifiedResponse = await verifyRuntimeArtifactResponse(response, 'https://capture.example/app', inventory);
record('RET-H05-runtime-bytes', sha256File(join(webRoot, 'assets', 'dynamic.js')), verifiedResponse.sha256, verifiedResponse.sha256 === sha256File(join(webRoot, 'assets', 'dynamic.js')));
await rejects('RET-H05-runtime-tamper', /do not match/i, () => verifyRuntimeArtifactResponse({ ...response, body: async () => Buffer.from('tampered') }, 'https://capture.example/app', inventory));
await rejects('RET-H05-runtime-redirect', /redirect/i, () => verifyRuntimeArtifactResponse({ ...response, request: () => ({ redirectedFrom: () => ({}), redirectedTo: () => null }) }, 'https://capture.example/app', inventory));
await rejects('RET-H05-runtime-partial', /complete 200/i, () => verifyRuntimeArtifactResponse({ ...response, status: () => 206, headers: () => ({ 'content-range': 'bytes 0-1/2' }) }, 'https://capture.example/app', inventory));
await rejects('RET-H05-runtime-outside', /outside/i, () => runtimeArtifactPath('https://other.example/app/assets/dynamic.js', 'https://capture.example/app', inventory));
const fakeUnityRoot = join(scratch, 'fake-unity-root');
mkdirSync(fakeUnityRoot, { recursive: true });
writeFileSync(join(fakeUnityRoot, 'index.html'), '<html></html>');
await rejects('RET-H05-direct-webgl-verifier', /Unity WebGL|provenance|manifest|export/i, () => captureWeb({ renderer: 'unity-webgl', artifact_root: fakeUnityRoot, output_dir: join(scratch, 'fake-unity-capture') }));
const webSource = readFileSync(resolve(REPO, 'scripts/eval/compare/capture-web.mjs'), 'utf8');
const webStatic = ['verifyUnityWebGlRoot(artifactRoot', 'artifactInventory(artifactRoot)', 'bindServedArtifact(base, builtArtifact)', 'verifyRuntimeArtifactResponse(response, base, builtArtifact)', "['loader', 'data', 'framework', 'code']"];
record('RET-H05-static-runtime-flow', webStatic, webStatic.filter((needle) => webSource.includes(needle)), webStatic.every((needle) => webSource.includes(needle)));

// AUD-M01: real one-axis normalization records probed dimensions and duration.
let normalization = { available: false };
if (spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', timeout: 5_000 }).status === 0 && spawnSync('ffprobe', ['-version'], { encoding: 'utf8', timeout: 5_000 }).status === 0) {
  const normalizeRoot = join(scratch, 'normalize-input');
  mkdirSync(normalizeRoot, { recursive: true });
  const inputVideo = join(normalizeRoot, 'raw.mp4');
  const generated = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=24:d=1', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', inputVideo], { encoding: 'utf8', timeout: 60_000 });
  if (generated.status !== 0) throw new Error(`fixture generation failed: ${generated.stderr}`);
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,avg_frame_rate,r_frame_rate,codec_name,duration:format=duration', '-of', 'json', inputVideo], { encoding: 'utf8', timeout: 30_000 });
  const observed = parseFfprobeObservation(probe);
  const mediaRecord = evidenceRecord(inputVideo, normalizeRoot, 'raw_video', 'video/mp4', observed.durationMs);
  const inputManifest = baseManifest({ captureId: 'competitor-normalize-v2-001', lane: 'controlled_competitor', mediaRecord });
  inputManifest.capture.resolution = { width: observed.width, height: observed.height };
  inputManifest.capture.frameRate = observed.frameRate;
  inputManifest.capture.codec = observed.codec;
  inputManifest.timing.durationMs = observed.durationMs;
  const inputManifestFile = join(normalizeRoot, 'manifest.json');
  writeFileSync(inputManifestFile, canonicalJson(inputManifest));
  const normalized = await normalize({ manifest: inputManifestFile, role: 'raw_video', width: '160', codec: 'libx264', output_dir: join(scratch, 'normalize-output'), evaluator: 'independent-retest-v2' });
  const derived = JSON.parse(readFileSync(normalized.manifest, 'utf8'));
  const outputRecord = derived.files.find((item) => item.role === 'normalized_video');
  normalization = { resolution: derived.capture.resolution, manifestDurationMs: derived.timing.durationMs, fileDurationMs: outputRecord.durationMs };
  record('AUD-M01-normalization', '160x90 and matching probed duration', normalization, normalization.resolution.width === 160 && normalization.resolution.height === 90 && normalization.manifestDurationMs === normalization.fileDurationMs, 'Medium');
} else {
  record('AUD-M01-normalization', 'ffmpeg/ffprobe available', normalization, false, 'Medium');
}

const failed = checks.filter((item) => !item.pass);
const result = {
  schemaVersion: 1,
  audit: 'capture-compare independent retest v2',
  generatedAtUtc: new Date().toISOString(),
  sourceBuildIdAtEnd: execFileSync(resolve(REPO, 'release/player-experience/tools/build-id.sh'), [], { cwd: REPO, encoding: 'utf8', timeout: 30_000 }).trim(),
  implementationHashes: {
    registrationV1: sha256File(V1_FILE),
    registrationV2: sha256File(V2_FILE),
    captureAndroid: sha256File(resolve(REPO, 'scripts/eval/compare/capture-android.mjs')),
    captureWeb: sha256File(resolve(REPO, 'scripts/eval/compare/capture-web.mjs')),
    captureWebGl: sha256File(resolve(REPO, 'scripts/eval/compare/capture-webgl.mjs')),
    compare: sha256File(resolve(REPO, 'scripts/eval/compare/compare.mjs')),
    lib: sha256File(resolve(REPO, 'scripts/eval/compare/lib.mjs')),
    metrics: sha256File(resolve(REPO, 'scripts/eval/compare/metrics.mjs')),
  },
  scratch,
  constraints: { browserLaunched: false, androidDeviceUsed: false, sharedBuildRun: false, competitorMediaUsed: false, timingClaimsMade: false },
  checks,
  summary: { total: checks.length, passed: checks.length - failed.length, failed: failed.length, failedChecks: failed.map((item) => item.id) },
  verdict: failed.some((item) => ['Critical', 'High'].includes(item.severity)) ? 'NOT PASSED' : 'PASS',
  limitations: [
    'Android device execution was not run; validators and source flows were adversarially audited with synthetic evidence only.',
    'No browser was launched; Web/WebGL binding primitives and pre-browser provenance rejection were audited synthetically.',
    'The fourteen newly registered measures are emitted fail-closed as NOT_AVAILABLE until qualifying evidence and an implementation for their registered calculations exist.',
    'Host load was above the repository timing ceiling; elapsed durations are not used for a performance claim.',
  ],
};

process.stdout.write(canonicalJson(result));
