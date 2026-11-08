#!/usr/bin/env node

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  canonicalJson,
  sha256File,
  validateAnnotations,
  validateManifest,
} from '../../../../scripts/eval/compare/lib.mjs';
import { validateAndroidIdentityEvidence } from '../../../../scripts/eval/compare/capture-android.mjs';
import { measurementsFromAnnotations } from '../../../../scripts/eval/compare/metrics.mjs';
import { compare, comparePackages } from '../../../../scripts/eval/compare/compare.mjs';

const SOURCE = '38924bd+123456789abc';

function file(path, value) {
  writeFileSync(path, value, { flag: 'wx' });
  return {
    role: 'raw_video',
    path: 'raw.bin',
    bytes: Buffer.byteLength(value),
    sha256: sha256File(path),
    mimeType: 'video/mp4',
    raw: true,
  };
}

function baseManifest(fileRecord, overrides = {}) {
  const result = {
    schemaVersion: 1,
    captureId: 'vande-audit-capture',
    lane: 'vande_engine_truth',
    evidenceClass: 'raw',
    status: 'captured',
    evaluator: { id: 'operator', role: 'capture operator', authoredSubject: false, independent: true },
    rights: { basis: 'VANDE-owned fixture', sourceUrl: null, redistribution: 'owned', notes: [] },
    identity: {
      repositorySourceId: SOURCE,
      embeddedBuildId: SOURCE,
      artifact: null,
      application: { title: 'VANDE Cricket', packageId: 'in.vande.cricket', version: 'audit', store: null },
      renderer: { claimed: 'unity-native', observed: 'unity-native', admission: null, proof: null },
    },
    timing: { capturedAtUtc: '2026-10-29T00:00:00.000Z', hostUptime: 'audit fixture', durationMs: 10_000 },
    environment: {
      platform: 'Android', device: 'Phone A', os: 'Android audit', soc: null, gpu: null, ramMb: null,
      viewport: { width: 1000, height: 500, deviceScaleFactor: 1 }, orientation: 'landscape', refreshHz: 60,
      qualityTier: 'balanced', thermal: 'nominal', battery: 'unknown', power: 'battery', network: 'offline', backgroundLoad: 'audit fixture',
    },
    gameplay: {
      scenario: 'leave', seed: null, controls: 'touch', inputMethod: 'human', assistance: 'play', handedness: 'right',
      pitch: 'balanced', field: 'balanced', timeScale: 1, wholeSequence: false,
    },
    capture: {
      method: 'audit fixture', resolution: { width: 1000, height: 500 }, frameRate: 60, codec: 'h264',
      audio: { method: 'none', synchronized: false, limitations: ['none captured'] }, perturbations: [], limitations: [],
    },
    files: [fileRecord],
    sidecars: { events: [], physics: [], replay: [], frames: [], annotations: [] },
    transformations: [],
    applicability: { metrics: {}, excludedClaims: [] },
    expectedScenario: 'leave',
    observedDeviations: [],
    errors: [],
    tools: { node: process.version },
  };
  return { ...result, ...overrides };
}

function annotation(role = 'primary', adjudication = null) {
  return {
    schemaVersion: 1,
    captureId: 'vande-audit-capture',
    annotator: { id: 'reviewer', role, independentOfBuilder: true },
    source: { mediaSha256: 'a'.repeat(64), manifestSha256: 'b'.repeat(64) },
    events: [
      { id: 'launch', label: 'launch', atMs: 0, endMs: null, frame: null, confidence: 1, ambiguous: false, region: null, value: null, note: null },
      { id: 'first-playable', label: 'first_playable', atMs: 1000, endMs: null, frame: null, confidence: 1, ambiguous: false, region: null, value: null, note: null },
    ],
    adjudication,
  };
}

function metrics(captureId, manifestSha256, value) {
  return {
    schemaVersion: 1,
    analysisVersion: '1.0.0',
    captureId,
    manifestSha256,
    generatedAtUtc: '2026-10-29T00:00:00.000Z',
    lane: captureId.startsWith('competitor') ? 'controlled_competitor' : 'vande_engine_truth',
    evidenceClass: 'raw',
    scenario: 'leave',
    evaluator: { id: 'claimed-independent', authoredTooling: false, independentOfSubject: true },
    integrity: { status: 'passed', rejections: [] },
    measurements: [{
      id: 'time_to_first_playable_ball_ms', status: 'measured', value, unit: 'ms', sampleSize: 1,
      uncertainty: null, timecodesMs: [], sources: [], limitations: [],
    }],
    ceriEvidence: [{
      dimension: 'pacing', status: 'partial', measurementIds: ['time_to_first_playable_ball_ms'],
      humanRequired: true, notes: ['fabricated audit fixture with no annotation receipt'],
    }],
  };
}

const scratch = mkdtempSync(join(tmpdir(), 'vande-capture-audit-'));
const fixtureRoot = join(scratch, 'validator-fixture');
mkdirSync(fixtureRoot);
const rawRecord = file(join(fixtureRoot, 'raw.bin'), 'audit-media');

const missingSidecar = baseManifest(rawRecord, {
  sidecars: { events: ['ghost-event-sidecar.json'], physics: [], replay: [], frames: [], annotations: [] },
});
const missingSidecarErrors = validateManifest(missingSidecar, { root: fixtureRoot, verifyFiles: true });

const forgedIdentityErrors = validateAndroidIdentityEvidence({
  buildId: SOURCE,
  expectedBuildId: SOURCE,
  installedBuildIdentity: { observedDom: SOURCE, observedEvidenceSurface: SOURCE },
  device: { serial: 'device-1' },
  rendererEvidence: [{ renderer: 'unity-native', selectionClassification: 'unity_native', admission: 'accepted' }],
  practiceTestApiPresent: false,
}, { sourceId: SOURCE, serial: 'device-1', renderer: 'unity-native' });

const unityWithoutProofErrors = validateManifest(baseManifest(rawRecord), { root: fixtureRoot, verifyFiles: true });
const invalidAdjudicatorErrors = validateAnnotations(annotation('adjudicator', null), {
  durationMs: 10_000,
  captureId: 'vande-audit-capture',
});
const applicabilityBypass = measurementsFromAnnotations(baseManifest(rawRecord), annotation())
  .find((entry) => entry.id === 'time_to_first_playable_ball_ms');

const comparisonFixture = [];
for (const [captureId, lane, device, value] of [
  ['vande-package-001', 'vande_engine_truth', 'Phone A', 1200],
  ['competitor-package-001', 'controlled_competitor', 'Phone B', 900],
]) {
  const dir = join(scratch, captureId);
  mkdirSync(dir);
  const record = file(join(dir, 'raw.bin'), `${captureId}-media`);
  const isCompetitor = lane === 'controlled_competitor';
  const manifest = baseManifest(record, {
    captureId,
    lane,
    rights: isCompetitor
      ? { basis: 'claimed lawful fixture', sourceUrl: null, redistribution: 'prohibited', notes: [] }
      : { basis: 'VANDE-owned fixture', sourceUrl: null, redistribution: 'owned', notes: [] },
    identity: isCompetitor
      ? {
          repositorySourceId: null,
          embeddedBuildId: null,
          artifact: null,
          application: { title: 'Competitor', packageId: 'example.competitor', version: '1', store: 'Google Play' },
          renderer: { claimed: null, observed: 'undisclosed-proprietary-runtime', admission: null, proof: 'claim only' },
        }
      : baseManifest(record).identity,
    environment: { ...baseManifest(record).environment, device },
  });
  const manifestFile = join(dir, 'manifest.json');
  writeFileSync(manifestFile, canonicalJson(manifest), { flag: 'wx' });
  const metricsFile = join(dir, 'metrics.json');
  writeFileSync(metricsFile, canonicalJson(metrics(captureId, sha256File(manifestFile), value)), { flag: 'wx' });
  comparisonFixture.push({ manifest, metrics: metrics(captureId, sha256File(manifestFile), value), metricsSha256: sha256File(metricsFile) });
}

const registration = JSON.parse(readFileSync(resolve('docs/evaluation/capture-compare/registration.v1.json'), 'utf8'));
const crossPlatformRows = comparePackages(comparisonFixture, registration);
const arbitraryRegistration = structuredClone(registration);
arbitraryRegistration.metrics.find((entry) => entry.id === 'time_to_first_playable_ball_ms').lowerIsBetter = false;
const invertedRows = comparePackages(comparisonFixture, arbitraryRegistration);

const registrationFile = join(scratch, 'arbitrary-registration.json');
writeFileSync(registrationFile, canonicalJson(arbitraryRegistration), { flag: 'wx' });
const integrated = await compare({
  manifest: comparisonFixture.map((entry) => join(scratch, entry.manifest.captureId, 'manifest.json')),
  metrics: comparisonFixture.map((entry) => join(scratch, entry.manifest.captureId, 'metrics.json')),
  registration: registrationFile,
  output_dir: join(scratch, 'comparison-output'),
  evaluator: 'claimed-independent',
  independent: true,
});
const integratedReport = JSON.parse(readFileSync(integrated.json, 'utf8'));

process.stdout.write(canonicalJson({
  scratch,
  results: {
    missingDeclaredSidecarAccepted: missingSidecarErrors.length === 0,
    missingDeclaredSidecarErrors: missingSidecarErrors,
    callerForgedAndroidIdentityAccepted: forgedIdentityErrors.length === 0,
    callerForgedAndroidIdentityErrors: forgedIdentityErrors,
    unityNativeWithoutProofAccepted: unityWithoutProofErrors.length === 0,
    unityNativeWithoutProofErrors: unityWithoutProofErrors,
    adjudicatorWithoutAdjudicationAccepted: invalidAdjudicatorErrors.length === 0,
    adjudicatorWithoutAdjudicationErrors: invalidAdjudicatorErrors,
    undeclaredMetricApplicabilityStatus: applicabilityBypass?.status ?? null,
    crossPlatformDifferentDeviceComparison: crossPlatformRows.find((entry) => entry.id === 'time_to_first_playable_ball_ms')?.comparisons[1] ?? null,
    arbitraryRegistrationInvertsDirection: {
      checkedIn: crossPlatformRows.find((entry) => entry.id === 'time_to_first_playable_ball_ms')?.comparisons[1]?.direction ?? null,
      supplied: invertedRows.find((entry) => entry.id === 'time_to_first_playable_ball_ms')?.comparisons[1]?.direction ?? null,
    },
    fabricatedMetricsWithoutAnnotationReceiptAccepted: integrated.ok,
    integratedSourceFilesVerifiedClaim: integratedReport.integrity.sourceFilesVerified,
    integratedFindings: integratedReport.findings,
  },
}));
