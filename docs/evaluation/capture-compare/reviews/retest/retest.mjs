#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
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
import { captureWeb } from '../../../../../scripts/eval/compare/capture-web.mjs';
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
import {
  normalize,
  parseFfprobeObservation,
} from '../../../../../scripts/eval/compare/normalize.mjs';

const REPO = resolve(import.meta.dirname, '../../../../..');
const SOURCE = '38924bd+123456789abc';
const REGISTRATION_FILE = resolve(REPO, 'docs/evaluation/capture-compare/registration.v1.json');
const registration = JSON.parse(readFileSync(REGISTRATION_FILE, 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'vande-capture-retest-'));
const checks = [];
const residuals = [];

function check(id, expected, observed, pass, detail = null) {
  checks.push({ id, expected, observed, pass: Boolean(pass), detail });
}

async function rejects(id, expectedPattern, action) {
  try {
    await action();
    check(id, `reject matching ${String(expectedPattern)}`, 'accepted', false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(id, `reject matching ${String(expectedPattern)}`, message, expectedPattern.test(message));
  }
}

function fileRecord(file, root, role, mimeType, durationMs = null) {
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

function baseManifest({
  captureId = 'vande-retest-001',
  lane = 'vande_engine_truth',
  root = null,
  mediaRecord = null,
  artifactRecord = null,
} = {}) {
  const competitor = lane === 'controlled_competitor';
  const files = mediaRecord ? [mediaRecord, ...(artifactRecord ? [artifactRecord] : [])] : [
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
    evaluator: { id: 'independent-retest', role: 'capture operator', authoredSubject: false, independent: true },
    rights: competitor
      ? { basis: 'lawfully installed fixture; terms reviewed', sourceUrl: null, redistribution: 'prohibited', notes: [] }
      : { basis: 'VANDE-owned fixture', sourceUrl: null, redistribution: 'owned', notes: [] },
    identity: competitor
      ? {
          repositorySourceId: null,
          embeddedBuildId: null,
          artifact: null,
          application: { title: 'Competitor fixture', packageId: 'example.competitor', version: '1', store: 'Google Play' },
          renderer: { claimed: null, observed: 'undisclosed-proprietary-runtime', admission: null, proof: 'package manager fixture' },
        }
      : {
          repositorySourceId: SOURCE,
          embeddedBuildId: SOURCE,
          artifact,
          application: { title: 'VANDE Cricket', packageId: 'in.vande.cricket', version: '1', store: null },
          renderer: { claimed: 'three-webgl', observed: 'three-webgl', admission: 'retained', proof: 'fixture proof' },
        },
    timing: { capturedAtUtc: '2026-10-29T01:00:00.000Z', hostUptime: 'retest fixture', durationMs: 10_000 },
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
      resolution: { width: 1000, height: 500 },
      frameRate: 60,
      codec: 'h264',
      audio: { method: 'none', synchronized: false, limitations: ['no audio'] },
      perturbations: ['adb screenrecord'],
      limitations: [],
    },
    files,
    sidecars: { events: [], physics: [], replay: [], frames: [], annotations: [] },
    transformations: [],
    applicability: {
      metrics: {
        time_to_first_playable_ball_ms: 'eligible',
        ball_diameter_release_px: 'eligible',
      },
      excludedClaims: [],
    },
    expectedScenario: 'leave',
    observedDeviations: [],
    errors: [],
    tools: { node: process.version },
  };
}

function annotation(captureId = 'vande-retest-001', manifestSha256 = 'b'.repeat(64), mediaSha256 = 'a'.repeat(64), firstPlayable = 1000) {
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
      analysisVersion: '1.0.0',
      captureId: manifest.captureId,
      manifestSha256: 'c'.repeat(64),
      generatedAtUtc: manifest.timing.capturedAtUtc,
      lane: manifest.lane,
      evidenceClass: manifest.evidenceClass,
      scenario: manifest.gameplay.scenario,
      evaluator: { id: 'independent-retest', authoredTooling: false, independentOfSubject: true },
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
  const mediaRecord = fileRecord(video, root, 'raw_video', 'video/mp4', 10_000);
  const artifactRecord = lane === 'vande_engine_truth' ? fileRecord(artifact, root, 'artifact_inventory', 'application/json') : null;
  const manifest = baseManifest({ captureId, lane, root, mediaRecord, artifactRecord });
  const manifestFile = join(root, 'manifest.json');
  writeFileSync(manifestFile, canonicalJson(manifest));
  const annotations = annotation(captureId, sha256File(manifestFile), mediaRecord.sha256, firstPlayable);
  const annotationFile = join(root, 'annotations.json');
  writeFileSync(annotationFile, canonicalJson(annotations));
  return { root, video, manifest, manifestFile, annotationFile };
}

// AUD-C01/C02: Android artifact, renderer and foreground trust boundaries.
const callerEvidence = {
  buildId: SOURCE,
  expectedBuildId: SOURCE,
  installedBuildIdentity: { observedDom: SOURCE, observedEvidenceSurface: SOURCE },
  device: { serial: 'device-1' },
  rendererEvidence: [{ renderer: 'unity-native', selectionClassification: 'unity_native', admission: 'accepted' }],
  practiceTestApiPresent: false,
};
const noTrusted = validateAndroidIdentityEvidence(callerEvidence, { sourceId: SOURCE, serial: 'device-1', renderer: 'unity-native' });
check('AUD-C01-caller-only-identity', 'rejected without tool-derived binding', noTrusted, noTrusted.some((item) => item.includes('trusted tool-derived')));

const trustedBase = {
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
const wrongEmbedded = validateAndroidIdentityEvidence(callerEvidence, {
  sourceId: SOURCE,
  serial: 'device-1',
  renderer: 'unity-native',
  trusted: { ...trustedBase, artifactBuildId: '38924bd+ffffffffffff' },
});
check('AUD-C01-apk-derived-build', 'reject wrong APK-derived embedded build', wrongEmbedded, wrongEmbedded.some((item) => item.includes('installed APK embedded build')));
const missingRendererProof = validateAndroidIdentityEvidence(callerEvidence, {
  sourceId: SOURCE,
  serial: 'device-1',
  renderer: 'unity-native',
  trusted: {
    ...trustedBase,
    runtimeObservations: trustedBase.runtimeObservations.map((item) => ({ ...item, admission: null })),
    installedUnityRuntime: false,
  },
});
check('AUD-C01-renderer-proof', 'reject missing live admission/native runtime proof', missingRendererProof, missingRendererProof.some((item) => item.includes('admission proof')) && missingRendererProof.some((item) => item.includes('native Unity runtime')));
const wrongForeground = validateAndroidIdentityEvidence(callerEvidence, {
  sourceId: SOURCE,
  serial: 'device-1',
  renderer: 'unity-native',
  trusted: { ...trustedBase, foregroundObservations: [{ packageId: 'other.app', obscured: true }, trustedBase.foregroundObservations[1]] },
});
check('AUD-C02-foreground-binding', 'reject wrong/obscured foreground package', wrongForeground, wrongForeground.some((item) => item.includes('foreground package')));
const changedApk = validateArtifactHashWindow(
  [{ path: '/data/app/base.apk', sha256: 'a'.repeat(64) }],
  [{ path: '/data/app/base.apk', sha256: 'b'.repeat(64) }],
  [{ remotePath: '/data/app/base.apk', sha256: 'a'.repeat(64) }],
);
check('AUD-C01-apk-window', 'reject changed APK split', changedApk, changedApk.some((item) => item.includes('changed during recording')));

const androidSource = readFileSync(resolve(REPO, 'scripts/eval/compare/capture-android.mjs'), 'utf8');
const androidStaticProofs = [
  'deriveInstalledArtifactIdentity(localApks)',
  'remoteHashesBefore',
  'remoteHashesAfter',
  'foregroundBefore',
  'foregroundAfter',
  'runtimeBefore',
  'runtimeAfter',
  'const sourceAfter = sourceBuildId()',
];
check('AUD-C01-C02-H06-static-flow', 'all derivation/before-after checks present', androidStaticProofs.filter((item) => androidSource.includes(item)), androidStaticProofs.every((item) => androidSource.includes(item)));

// AUD-H02/H03/H04/M02 and annotation video-duration bounds.
const missingSidecar = baseManifest();
missingSidecar.sidecars.events = ['ghost-event-sidecar.json'];
const missingSidecarErrors = validateManifest(missingSidecar);
check('AUD-H02-sidecars', 'reject undeclared sidecar', missingSidecarErrors, missingSidecarErrors.some((item) => item.includes('hash-bound entry')));

const invalidAdjudicator = {
  ...annotation(),
  annotator: { id: 'adjudicator', role: 'adjudicator', independentOfBuilder: true },
  adjudication: null,
};
const adjudicatorErrors = validateAnnotations(invalidAdjudicator, { durationMs: 10_000, captureId: invalidAdjudicator.captureId });
check('AUD-H03-adjudicator-shape', 'reject missing reviewed hashes/decisions', adjudicatorErrors, adjudicatorErrors.some((item) => item.includes('mandatory for an adjudicator')));

const primary = annotation();
const secondary = { ...annotation(), annotator: { id: 'secondary', role: 'secondary', independentOfBuilder: true } };
const adjudicator = {
  ...annotation(),
  annotator: { id: 'adjudicator', role: 'adjudicator', independentOfBuilder: true },
  adjudication: { reviewedFiles: ['4'.repeat(64), '5'.repeat(64)], decisions: ['Reviewed ambiguity.'] },
};
const workflow = annotationWorkflow([
  { value: primary, sha256: '1'.repeat(64), path: 'primary.json' },
  { value: secondary, sha256: '2'.repeat(64), path: 'secondary.json' },
  { value: adjudicator, sha256: '3'.repeat(64), path: 'adjudicator.json' },
]);
check('AUD-H03-adjudication-binding', 'reject unknown reviewed hashes', workflow.rejections, workflow.rejections.some((item) => item.includes('exactly match')));

const undeclaredManifest = baseManifest();
undeclaredManifest.applicability.metrics = {};
const undeclaredMeasurement = measurementsFromAnnotations(undeclaredManifest, annotation()).find((item) => item.id === 'time_to_first_playable_ball_ms');
check('AUD-H04-applicability', 'not_available', undeclaredMeasurement, undeclaredMeasurement?.status === 'not_available' && undeclaredMeasurement.value === null);

const diameterAnnotation = annotation();
diameterAnnotation.events.push({
  id: 'ball-release', label: 'ball_release', atMs: 500, endMs: null, frame: null,
  confidence: 1, ambiguous: false, region: { x: 0, y: 0, width: 0.02, height: 0.02 }, value: null, note: null,
});
const diameter = measurementsFromAnnotations(baseManifest(), diameterAnnotation).find((item) => item.id === 'ball_diameter_release_px');
check('AUD-M02-arithmetic-diameter', 15, diameter?.value, diameter?.value === 15);

const longAnnotation = annotation('vande-retest-001', 'b'.repeat(64), 'a'.repeat(64), 15_000);
let timeBoundMessage = null;
try {
  assertValidAnnotationsForManifest(longAnnotation, baseManifest());
} catch (error) {
  timeBoundMessage = error instanceof Error ? error.message : String(error);
}
check('annotation-time-bounds', 'reject 15s event against 10s video', timeBoundMessage, /outside the capture duration/.test(timeBoundMessage ?? ''));
const missingDurationManifest = baseManifest();
missingDurationManifest.files = missingDurationManifest.files.map((item) => item.mimeType === 'video/mp4' ? { ...item, durationMs: null } : item);
let durationBoundMessage = null;
try {
  assertValidAnnotationsForManifest(annotation(), missingDurationManifest);
} catch (error) {
  durationBoundMessage = error instanceof Error ? error.message : String(error);
}
check('annotation-probed-duration-required', 'reject timecodes without positive video duration', durationBoundMessage, /positive probed duration/.test(durationBoundMessage ?? ''));

// AUD-C04: registration allowlist.
const alteredRegistration = structuredClone(registration);
alteredRegistration.metrics.find((item) => item.id === 'time_to_first_playable_ball_ms').lowerIsBetter = false;
let registrationMessage = null;
try {
  assertApprovedRegistration(alteredRegistration);
} catch (error) {
  registrationMessage = error instanceof Error ? error.message : String(error);
}
check('AUD-C04-registration-allowlist', 'reject direction flip', registrationMessage, /not allowlisted/.test(registrationMessage ?? ''));
let approvedRegistration = false;
try {
  assertApprovedRegistration(registration, REGISTRATION_FILE);
  approvedRegistration = true;
} catch {
  approvedRegistration = false;
}
check('registration-approved-bytes', true, approvedRegistration, approvedRegistration);

// AUD-H01: no direction for incompatible platform/device/class/settings/uncertainty.
const referenceManifest = baseManifest({ captureId: 'vande-reference-001' });
const candidateBase = baseManifest({ captureId: 'competitor-reference-001', lane: 'controlled_competitor' });
const referencePackage = metricPackage(referenceManifest, 1200);
function comparisonFor(overrides, status = 'measured') {
  const candidate = {
    ...candidateBase,
    ...overrides,
    environment: { ...candidateBase.environment, ...(overrides.environment ?? {}) },
    gameplay: { ...candidateBase.gameplay, ...(overrides.gameplay ?? {}) },
    capture: { ...candidateBase.capture, ...(overrides.capture ?? {}) },
  };
  return comparePackages([referencePackage, metricPackage(candidate, 900, status)], registration)
    .find((item) => item.id === 'time_to_first_playable_ball_ms').comparisons[1];
}
for (const [id, overrides, expectedReason, status] of [
  ['AUD-H01-device', { environment: { device: 'Phone B' } }, 'device mismatch', 'measured'],
  ['AUD-H01-platform', { environment: { platform: 'unity-webgl' } }, 'platform mismatch', 'measured'],
  ['AUD-H01-whole-sequence', { gameplay: { wholeSequence: false } }, 'incomplete sequence', 'measured'],
  ['AUD-H01-settings', { gameplay: { assistance: 'learn' } }, 'assistance mismatch', 'measured'],
  ['AUD-H01-diagnostic', { evidenceClass: 'diagnostic' }, 'diagnostic or derived evidence has no directional cross-title comparison', 'diagnostic_only'],
]) {
  const result = comparisonFor(overrides, status);
  check(id, `not_comparable: ${expectedReason}`, result, result.status === 'not_comparable' && result.reason === expectedReason && result.direction === null);
}
const uncertaintyCandidate = metricPackage(candidateBase, 900);
uncertaintyCandidate.metrics.measurements[0].uncertainty = null;
const uncertaintyResult = comparePackages([referencePackage, uncertaintyCandidate], registration)
  .find((item) => item.id === 'time_to_first_playable_ball_ms').comparisons[1];
check('AUD-H01-uncertainty', 'not_comparable: measurement uncertainty mismatch', uncertaintyResult, uncertaintyResult.status === 'not_comparable' && uncertaintyResult.reason === 'measurement uncertainty mismatch');

const osMismatchResult = comparisonFor({ environment: { os: 'Android 15' } });
if (osMismatchResult.status !== 'not_comparable') {
  residuals.push({
    id: 'RET-H01-OS',
    severity: 'High',
    finding: 'Controlled comparison remains directional when the same device label reports a different Android OS.',
    observed: osMismatchResult,
  });
}
check('comparability-os-version', 'not_comparable', osMismatchResult, osMismatchResult.status === 'not_comparable');

const recorderMismatchResult = comparisonFor({
  capture: { perturbations: ['adb screenrecord --bit-rate 6000000'] },
});
if (recorderMismatchResult.status !== 'not_comparable') {
  residuals.push({
    id: 'RET-H01-RECORDER',
    severity: 'High',
    finding: 'Controlled comparison remains directional for different declared recorder settings; Android bit rate is not stored as a structured compatibility field.',
    observed: recorderMismatchResult,
  });
}
check('comparability-recorder-settings', 'not_comparable', recorderMismatchResult, recorderMismatchResult.status === 'not_comparable');

// AUD-C03: complete receipt chain, tampering, reproducibility, sourceFilesVerified truth.
const packagesRoot = join(scratch, 'packages');
const packageA = makePackage(join(packagesRoot, 'vande'), 'vande-package-001', 'vande_engine_truth', 1200);
const packageB = makePackage(join(packagesRoot, 'competitor'), 'competitor-package-001', 'controlled_competitor', 900);
const metricsA = await calculateMetrics({
  manifest: packageA.manifestFile,
  annotations: [packageA.annotationFile],
  output_dir: join(scratch, 'metrics-a'),
  evaluator: 'independent-retest-a',
  independent: true,
});
const metricsB = await calculateMetrics({
  manifest: packageB.manifestFile,
  annotations: [packageB.annotationFile],
  output_dir: join(scratch, 'metrics-b'),
  evaluator: 'independent-retest-b',
  independent: true,
});
const comparison = await compare({
  manifest: [packageA.manifestFile, packageB.manifestFile],
  metrics: [metricsA.metrics, metricsB.metrics],
  receipt: [metricsA.receipt, metricsB.receipt],
  output_dir: join(scratch, 'comparison-good'),
  evaluator: 'independent-retest-c',
  independent: true,
});
const comparisonReport = JSON.parse(readFileSync(comparison.json, 'utf8'));
check('AUD-C03-complete-chain', true, comparisonReport.integrity.sourceFilesVerified, comparisonReport.integrity.sourceFilesVerified === true);

const noProvenanceReport = buildComparison([
  { ...referencePackage, provenanceVerified: undefined },
  { ...metricPackage(candidateBase, 900), provenanceVerified: undefined },
], registration, { id: 'independent-retest', independent: true });
check('sourceFilesVerified-not-hardcoded', false, noProvenanceReport.integrity.sourceFilesVerified, noProvenanceReport.integrity.sourceFilesVerified === false && noProvenanceReport.findings.some((item) => item.severity === 'Critical'));

await rejects('AUD-C03-receipt-required', /receipt is missing/i, () => compare({
  manifest: [packageA.manifestFile, packageB.manifestFile],
  metrics: [metricsA.metrics, metricsB.metrics],
  receipt: [join(scratch, 'missing-receipt.json'), metricsB.receipt],
  output_dir: join(scratch, 'comparison-no-receipt'),
  evaluator: 'independent-retest',
  independent: true,
}));

const mediaOriginal = readFileSync(packageA.video);
appendFileSync(packageA.video, 'tamper');
await rejects('AUD-C03-media-tamper', /does not match file bytes|does not match observed/i, () => compare({
  manifest: [packageA.manifestFile, packageB.manifestFile],
  metrics: [metricsA.metrics, metricsB.metrics],
  receipt: [metricsA.receipt, metricsB.receipt],
  output_dir: join(scratch, 'comparison-media-tamper'),
  evaluator: 'independent-retest',
  independent: true,
}));
writeFileSync(packageA.video, mediaOriginal);

const copiedAnnotation = join(metricsA.output, 'annotations', `01-${basename(packageA.annotationFile)}`);
const copiedAnnotationOriginal = readFileSync(copiedAnnotation);
appendFileSync(copiedAnnotation, ' ');
await rejects('AUD-C03-annotation-tamper', /Annotation hash mismatch/i, () => compare({
  manifest: [packageA.manifestFile, packageB.manifestFile],
  metrics: [metricsA.metrics, metricsB.metrics],
  receipt: [metricsA.receipt, metricsB.receipt],
  output_dir: join(scratch, 'comparison-annotation-tamper'),
  evaluator: 'independent-retest',
  independent: true,
}));
writeFileSync(copiedAnnotation, copiedAnnotationOriginal);

const alteredMetrics = JSON.parse(readFileSync(metricsA.metrics, 'utf8'));
alteredMetrics.measurements.find((item) => item.id === 'time_to_first_playable_ball_ms').value = 1;
writeFileSync(metricsA.metrics, canonicalJson(alteredMetrics));
const alteredReceipt = JSON.parse(readFileSync(metricsA.receipt, 'utf8'));
alteredReceipt.metrics.sha256 = sha256File(metricsA.metrics);
writeFileSync(metricsA.receipt, canonicalJson(alteredReceipt));
await rejects('AUD-C03-metric-rederivation', /not reproducible/i, () => compare({
  manifest: [packageA.manifestFile, packageB.manifestFile],
  metrics: [metricsA.metrics, metricsB.metrics],
  receipt: [metricsA.receipt, metricsB.receipt],
  output_dir: join(scratch, 'comparison-metric-tamper'),
  evaluator: 'independent-retest',
  independent: true,
}));

// AUD-H05: structural Web/WebGL artifact binding review without launching a browser.
await rejects('AUD-H05-artifact-root-required', /artifact-root is required/i, () => captureWeb({
  renderer: 'three-webgl',
  output_dir: join(scratch, 'web-missing-artifact'),
}));
const captureWebSource = readFileSync(resolve(REPO, 'scripts/eval/compare/capture-web.mjs'), 'utf8');
const captureWebGlSource = readFileSync(resolve(REPO, 'scripts/eval/compare/capture-webgl.mjs'), 'utf8');
const directUnityAllowed = /SUPPORTED_RENDERERS[^\n]+unity-webgl/.test(captureWebSource);
const directUnityVerifiesExport = captureWebSource.includes('verifyUnityWebGlRoot');
check('AUD-H05-webgl-wrapper-provenance', 'all Unity WebGL capture paths verify export provenance', { directUnityAllowed, directUnityVerifiesExport, wrapperVerifiesExport: captureWebGlSource.includes('verifyUnityWebGlRoot') }, !directUnityAllowed || directUnityVerifiesExport);
if (directUnityAllowed && !directUnityVerifiesExport) {
  residuals.push({
    id: 'RET-H05-DIRECT-WEBGL',
    severity: 'High',
    finding: 'capture-web.mjs accepts renderer=unity-webgl directly but does not run verifyUnityWebGlRoot; callers can bypass the provenance wrapper.',
  });
}
const htmlOnlyDependencyBinding = captureWebSource.includes('html.matchAll') && !captureWebSource.includes('javascriptImport') && !captureWebSource.includes('verifyUnityWebGlRoot');
check('AUD-H05-runtime-payload-binding', 'served binding covers runtime-loaded payloads, not only index references', { htmlOnlyDependencyBinding }, !htmlOnlyDependencyBinding);
if (htmlOnlyDependencyBinding) {
  residuals.push({
    id: 'RET-H05-DYNAMIC-PAYLOAD',
    severity: 'High',
    finding: 'Served-byte binding walks only script/link references in index.html; dynamic chunks and Unity loader data/framework/WASM are not re-fetched and hash-checked.',
  });
}

// AUD-H07: required §9.5 inventory must be frozen or explicit NOT AVAILABLE.
const requiredMetricIds = [
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
const outputIds = new Set(measurementsFromAnnotations(undeclaredManifest, annotation()).map((item) => item.id));
const registeredIds = new Set(registration.metrics.map((item) => item.id));
const missingFromOutput = requiredMetricIds.filter((id) => !outputIds.has(id));
const missingFromRegistration = requiredMetricIds.filter((id) => !registeredIds.has(id));
check('AUD-H07-explicit-output-inventory', 'all required measures emitted, at least as NOT AVAILABLE', missingFromOutput, missingFromOutput.length === 0);
check('AUD-H07-preregistration-inventory', 'all required measures frozen with definitions', missingFromRegistration, missingFromRegistration.length === 0);
if (missingFromRegistration.length > 0) {
  residuals.push({
    id: 'RET-H07-REGISTRATION',
    severity: 'High',
    finding: 'Fourteen required §9.5 measures are emitted as placeholders but remain absent from the frozen registration, so their definitions, units, directionality and uncertainty are not preregistered.',
    missingMetricIds: missingFromRegistration,
  });
}

// AUD-M01: real one-axis normalization must use observed ffprobe dimensions/duration.
let normalization = { available: false, reason: null };
const ffmpegVersion = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', timeout: 5_000 });
const ffprobeVersion = spawnSync('ffprobe', ['-version'], { encoding: 'utf8', timeout: 5_000 });
if (ffmpegVersion.status === 0 && ffprobeVersion.status === 0) {
  const normalizeRoot = join(scratch, 'normalize-input');
  mkdirSync(normalizeRoot, { recursive: true });
  const inputVideo = join(normalizeRoot, 'raw.mp4');
  const generated = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=24:d=1',
    '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', inputVideo,
  ], { encoding: 'utf8', timeout: 60_000 });
  if (generated.status !== 0) throw new Error(`Normalization fixture generation failed: ${generated.stderr}`);
  const probe = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,avg_frame_rate,r_frame_rate,codec_name,duration:format=duration',
    '-of', 'json', inputVideo,
  ], { encoding: 'utf8', timeout: 30_000 });
  const observed = parseFfprobeObservation(probe);
  const mediaRecord = fileRecord(inputVideo, normalizeRoot, 'raw_video', 'video/mp4', observed.durationMs);
  const normalizeManifest = baseManifest({ captureId: 'competitor-normalize-001', lane: 'controlled_competitor', root: normalizeRoot, mediaRecord });
  normalizeManifest.capture.resolution = { width: observed.width, height: observed.height };
  normalizeManifest.capture.frameRate = observed.frameRate;
  normalizeManifest.capture.codec = observed.codec;
  normalizeManifest.timing.durationMs = observed.durationMs;
  const normalizeManifestFile = join(normalizeRoot, 'manifest.json');
  writeFileSync(normalizeManifestFile, canonicalJson(normalizeManifest));
  const normalized = await normalize({
    manifest: normalizeManifestFile,
    role: 'raw_video',
    width: '160',
    codec: 'libx264',
    output_dir: join(scratch, 'normalize-output'),
    evaluator: 'independent-retest',
  });
  const derived = JSON.parse(readFileSync(normalized.manifest, 'utf8'));
  const outputRecord = derived.files.find((item) => item.role === 'normalized_video');
  normalization = {
    available: true,
    resolution: derived.capture.resolution,
    frameRate: derived.capture.frameRate,
    codec: derived.capture.codec,
    manifestDurationMs: derived.timing.durationMs,
    fileDurationMs: outputRecord.durationMs,
    transformObservedOutput: derived.transformations.at(-1).parameters.observedOutput,
  };
  check('AUD-M01-one-axis-ffprobe', '160x90 with duration derived from ffprobe', normalization, normalization.resolution.width === 160 && normalization.resolution.height === 90 && normalization.manifestDurationMs === normalization.fileDurationMs && normalization.transformObservedOutput.durationMs === normalization.fileDurationMs);
} else {
  normalization = { available: false, reason: 'ffmpeg or ffprobe unavailable' };
  check('AUD-M01-one-axis-ffprobe', 'executed', normalization, false);
}

const failedChecks = checks.filter((item) => !item.pass).map((item) => item.id);
const blockingResiduals = residuals.filter((item) => ['Critical', 'High'].includes(item.severity));
const result = {
  schemaVersion: 1,
  audit: 'capture-compare hardened independent retest',
  generatedAtUtc: new Date().toISOString(),
  sourceBuildIdAtEnd: execFileSync(resolve(REPO, 'release/player-experience/tools/build-id.sh'), [], { cwd: REPO, encoding: 'utf8', timeout: 30_000 }).trim(),
  scratch,
  constraints: {
    browserLaunched: false,
    androidDeviceUsed: false,
    sharedBuildRun: false,
    timingClaimsMade: false,
  },
  checks,
  summary: {
    total: checks.length,
    passed: checks.length - failedChecks.length,
    failed: failedChecks.length,
    failedChecks,
    residualCount: residuals.length,
    criticalOrHighResidualCount: blockingResiduals.length,
  },
  residuals,
  verdict: blockingResiduals.length === 0 && failedChecks.length === 0 ? 'PASS' : 'NOT PASSED',
  limitations: [
    'Android derivation and foreground/runtime sampling were re-audited through exported validators and source flow; no device was used.',
    'Web/WebGL artifact binding was re-audited structurally and through pre-browser failure gates; no browser was launched.',
    'The high host load makes elapsed test durations indicative only; this report makes no timing or performance claim.',
  ],
};

process.stdout.write(canonicalJson(result));
