#!/usr/bin/env node

import { existsSync, lstatSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANALYSIS_VERSION,
  assertValidAnnotationsForManifest,
  canonicalJson,
  defaultEvidenceDir,
  ensureNewDirectory,
  loadManifestEvidence,
  loadMetrics,
  manifestDigest,
  parseArgs,
  readJson,
  REPO_ROOT,
  sha256File,
  sha256Bytes,
  writeJsonNew,
  writeTextNew,
} from './lib.mjs';
import { annotationWorkflow, ceriEvidence, duplicateFrameMeasurement, measurementsFromAnnotations } from './metrics.mjs';

const APPROVED_REGISTRATION = Object.freeze({
  path: join(REPO_ROOT, 'docs', 'evaluation', 'capture-compare', 'registration.v3.json'),
  rawSha256: 'c2f08f63bfe4d3fe65ef26ec3a9a9273eb4f785fdac96bc6ff75c52895c31949',
  semanticSha256: 'c8f6d57a0471f84fd521f8e4406cdd792bbbda443eb764db8d90c9032e7fbb97',
});

const APPROVED_METHODS = Object.freeze([{
  methodId: 'vande.capture-compare.visual-defects',
  methodVersion: '1.0.0',
  path: 'docs/evaluation/capture-compare/visual-method.v1.json',
  sha256: '8a9f86be086096c8e8ed7ca1b6975d0bad1890ccc83e27b36a37d6f73135111f',
}]);

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, required) {
  return object(value) && required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key));
}

function safeRelative(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && !value.includes('\\') && !value.includes('\0') &&
    !value.startsWith('/') && value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function resolveEvidenceFile(root, path) {
  if (!safeRelative(path)) throw new Error(`Unsafe receipt path: ${path}`);
  const target = resolve(root, path);
  const rel = relative(resolve(root), target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Receipt path escapes its package: ${path}`);
  const info = lstatSync(target);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Receipt path is not a regular file: ${path}`);
  return target;
}

export function assertApprovedRegistration(registration, registrationFile = null) {
  if (!exactKeys(registration, ['schemaVersion', 'analysisVersion', 'registeredBeforeComparison', 'scenarioClasses', 'sampling', 'methodArtifacts', 'metrics', 'uncertainty', 'exclusions', 'scoring', 'deviationPolicy'])) {
    throw new Error('Registration does not use the approved exact schema');
  }
  if (registration.schemaVersion !== 3 || registration.analysisVersion !== ANALYSIS_VERSION || registration.registeredBeforeComparison !== true) {
    throw new Error('Registration version or preregistration marker is invalid');
  }
  const semanticSha256 = sha256Bytes(canonicalJson(registration));
  if (semanticSha256 !== APPROVED_REGISTRATION.semanticSha256) throw new Error(`Registration is not allowlisted for ${ANALYSIS_VERSION}`);
  if (registrationFile !== null) {
    if (resolve(registrationFile) !== resolve(APPROVED_REGISTRATION.path)) throw new Error('Custom registration paths are not accepted for this analysis version');
    if (sha256File(registrationFile) !== APPROVED_REGISTRATION.rawSha256) throw new Error('Approved registration bytes changed; create and review a new analysis version instead');
  }
  if (!Array.isArray(registration.methodArtifacts) || registration.methodArtifacts.length !== APPROVED_METHODS.length) {
    throw new Error('Registration method artifacts are incomplete');
  }
  for (const approved of APPROVED_METHODS) {
    const record = registration.methodArtifacts.find((item) => item.methodId === approved.methodId);
    if (!record || record.methodVersion !== approved.methodVersion || record.path !== approved.path || record.sha256 !== approved.sha256 ||
        sha256File(join(REPO_ROOT, approved.path)) !== approved.sha256) {
      throw new Error(`Registered method artifact is not allowlisted: ${approved.methodId}`);
    }
  }
  return registration;
}

function markdown(value) {
  return String(value ?? 'NOT AVAILABLE').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function measurementMap(metrics) {
  return new Map(metrics.measurements.map((item) => [item.id, item]));
}

function comparable(left, right) {
  if (left.status === 'not_available' || right.status === 'not_available') return { ok: false, reason: 'missing evidence' };
  if (left.status === 'not_comparable' || right.status === 'not_comparable') return { ok: false, reason: 'marked not comparable' };
  if (left.unit !== right.unit) return { ok: false, reason: `unit mismatch (${left.unit ?? 'none'} vs ${right.unit ?? 'none'})` };
  if (typeof left.value !== 'number' || typeof right.value !== 'number') return { ok: false, reason: 'non-numeric raw values' };
  return { ok: true, reason: null };
}

function sameJson(left, right) {
  return canonicalJson(left, false) === canonicalJson(right, false);
}

function compatibility(reference, candidate, left, right, registration) {
  const registeredScenarios = new Set(registration.scenarioClasses.map((item) => item.id));
  if (!registeredScenarios.has(reference.gameplay.scenario) || !registeredScenarios.has(candidate.gameplay.scenario)) return 'scenario is not a preregistered class ID';
  if (candidate.gameplay.scenario !== reference.gameplay.scenario) return 'scenario mismatch';
  if (reference.evidenceClass !== 'raw' || candidate.evidenceClass !== 'raw') return 'diagnostic or derived evidence has no directional cross-title comparison';
  if (left.status !== 'measured' || right.status !== 'measured') return 'only measured raw values receive directionality';
  if (reference.gameplay.wholeSequence !== true || candidate.gameplay.wholeSequence !== true) return 'incomplete sequence';
  if (reference.environment.platform !== candidate.environment.platform) return 'platform mismatch';
  if (reference.environment.device !== candidate.environment.device) return 'device mismatch';
  const requiredEnvironment = ['platform', 'device', 'os', 'orientation', 'refreshHz', 'qualityTier', 'thermal', 'network'];
  for (const key of requiredEnvironment) if (reference.environment[key] === null || candidate.environment[key] === null) return `missing compatibility metadata: ${key}`;
  const requiredGameplay = ['inputMethod', 'assistance', 'handedness', 'pitch', 'field'];
  for (const key of requiredGameplay) if (reference.gameplay[key] === null || candidate.gameplay[key] === null) return `missing compatibility metadata: ${key}`;
  if (reference.environment.viewport === null || candidate.environment.viewport === null || reference.capture.resolution === null || candidate.capture.resolution === null || reference.capture.frameRate === null || candidate.capture.frameRate === null || reference.capture.codec === null || candidate.capture.codec === null) return 'missing display/recording compatibility metadata';
  const controlledPair = reference.lane === 'controlled_competitor' || candidate.lane === 'controlled_competitor';
  if (controlledPair) {
    if (!String(reference.environment.platform).toLowerCase().includes('android')) return 'controlled competitor comparisons require Android';
    const lanes = new Set([reference.lane, candidate.lane]);
    if (!lanes.has('vande_engine_truth') || !lanes.has('controlled_competitor')) return 'controlled comparison must pair VANDE with one competitor';
  }
  const exactEnvironment = ['os', 'orientation', 'refreshHz', 'qualityTier', 'thermal', 'power', 'network'];
  for (const key of exactEnvironment) if (reference.environment[key] !== candidate.environment[key]) return `${key} mismatch`;
  if (!sameJson(reference.environment.viewport, candidate.environment.viewport)) return 'viewport/display mismatch';
  if (!sameJson(reference.capture.resolution, candidate.capture.resolution)) return 'capture resolution mismatch';
  if (reference.capture.frameRate !== candidate.capture.frameRate) return 'capture frame-rate mismatch';
  if (reference.capture.codec !== candidate.capture.codec) return 'capture codec mismatch';
  if (reference.capture.audio.method !== candidate.capture.audio.method || reference.capture.audio.synchronized !== candidate.capture.audio.synchronized) return 'capture audio-class mismatch';
  if (reference.capture.method !== candidate.capture.method) return 'capture method mismatch';
  if (!object(reference.capture.recorder) || !object(candidate.capture.recorder)) return 'missing structured recorder metadata';
  if (reference.capture.recorder.class !== candidate.capture.recorder.class) return 'recorder class mismatch';
  if (reference.capture.recorder.class === 'adb_screenrecord' &&
      (reference.capture.recorder.bitRateBps === null || candidate.capture.recorder.bitRateBps === null)) return 'missing recorder bit-rate metadata';
  if (reference.capture.recorder.bitRateBps !== candidate.capture.recorder.bitRateBps) return 'recorder bit-rate mismatch';
  if (!sameJson(reference.capture.perturbations, candidate.capture.perturbations)) return 'recorder perturbation/settings mismatch';
  for (const key of ['inputMethod', 'assistance', 'handedness', 'pitch', 'field', 'timeScale']) {
    if (reference.gameplay[key] !== candidate.gameplay[key]) return `${key} mismatch`;
  }
  if (!sameJson(left.uncertainty, right.uncertainty)) return 'measurement uncertainty mismatch';
  return null;
}

export function comparePackages(packages, registration) {
  assertApprovedRegistration(registration);
  const directions = new Map(registration.metrics.map((item) => [item.id, item.lowerIsBetter]));
  const ids = [...new Set(packages.flatMap((item) => item.metrics.measurements.map((metric) => metric.id)))].sort();
  const reference = packages[0];
  const referenceMap = measurementMap(reference.metrics);
  const rows = ids.map((id) => {
    const raw = packages.map((item) => measurementMap(item.metrics).get(id) ?? null);
    const comparisons = packages.map((item, index) => {
      if (index === 0) return { status: 'reference', delta: 0, direction: null, reason: null };
      const left = referenceMap.get(id);
      const right = raw[index];
      if (!left || !right) return { status: 'not_comparable', delta: null, direction: null, reason: 'metric absent' };
      const incompatibility = compatibility(reference.manifest, item.manifest, left, right, registration);
      if (incompatibility) return { status: 'not_comparable', delta: null, direction: null, reason: incompatibility };
      const check = comparable(left, right);
      if (!check.ok) return { status: 'not_comparable', delta: null, direction: null, reason: check.reason };
      const delta = right.value - left.value;
      const lower = directions.get(id);
      const direction = lower === null || lower === undefined ? null : delta === 0 ? 'equal' : (delta < 0) === lower ? 'favourable_to_candidate' : 'unfavourable_to_candidate';
      return { status: 'raw_delta_only', delta, direction, reason: 'No quality score; direction follows frozen metric registration only.' };
    });
    return { id, lowerIsBetter: directions.get(id) ?? null, raw, comparisons };
  });
  return rows;
}

function packageLabel(item) {
  const app = item.manifest.identity.application;
  return `${app.title ?? item.manifest.captureId} / ${item.manifest.identity.renderer.observed ?? 'renderer unavailable'}`;
}

function assertMetricApplicability(manifest, metrics) {
  if (metrics.lane !== manifest.lane || metrics.evidenceClass !== manifest.evidenceClass) throw new Error(`Metrics lane/class does not match ${manifest.captureId}`);
  if (metrics.integrity.status !== 'passed' || metrics.integrity.rejections.length > 0) throw new Error(`Metrics integrity is not passed for ${manifest.captureId}`);
  for (const item of metrics.measurements) {
    const declared = manifest.applicability.metrics[item.id];
    if (item.status === 'measured' && (declared !== 'eligible' || manifest.evidenceClass === 'diagnostic')) {
      throw new Error(`Measured metric ${item.id} is not eligible in ${manifest.captureId}`);
    }
    if (item.status === 'diagnostic_only' && !['eligible', 'diagnostic_only'].includes(declared)) {
      throw new Error(`Diagnostic metric ${item.id} is undeclared in ${manifest.captureId}`);
    }
  }
}

function measurementDigest(value) {
  return sha256Bytes(canonicalJson(value));
}

export function verifyMetricsReceipt({ receiptFile, manifestFile, metricsFile, manifest, mediaProbes: admittedMediaProbes = null, metrics }) {
  const absoluteReceipt = resolve(receiptFile);
  if (!existsSync(absoluteReceipt)) throw new Error(`Metrics receipt is missing: ${absoluteReceipt}`);
  const receiptRoot = dirname(absoluteReceipt);
  const receipt = readJson(absoluteReceipt);
  const freshEvidence = loadManifestEvidence(manifestFile, { verifyFiles: true, verifyMedia: true });
  if (canonicalJson(freshEvidence.manifest) !== canonicalJson(manifest)) throw new Error('Supplied manifest object does not match freshly admitted manifest bytes');
  const mediaProbes = freshEvidence.mediaProbes;
  if (admittedMediaProbes !== null && canonicalJson(admittedMediaProbes) !== canonicalJson(mediaProbes)) {
    throw new Error('Previously admitted media probe no longer matches the fresh receipt-verification probe');
  }
  const keys = ['schemaVersion', 'analysisVersion', 'captureId', 'manifest', 'media', 'mediaProbes', 'methods', 'annotations', 'selectedAnnotation', 'metrics', 'registration', 'derivation'];
  if (!exactKeys(receipt, keys) || receipt.schemaVersion !== 3 || receipt.analysisVersion !== ANALYSIS_VERSION || receipt.captureId !== manifest.captureId) {
    throw new Error(`Metrics receipt has an invalid top-level contract: ${absoluteReceipt}`);
  }
  if (!exactKeys(receipt.manifest, ['sha256']) || receipt.manifest.sha256 !== sha256File(manifestFile)) throw new Error('Receipt manifest hash mismatch');
  if (!exactKeys(receipt.metrics, ['path', 'sha256'])) throw new Error('Receipt metrics record is invalid');
  const receiptMetricsFile = resolveEvidenceFile(receiptRoot, receipt.metrics.path);
  if (resolve(receiptMetricsFile) !== resolve(metricsFile) || receipt.metrics.sha256 !== sha256File(metricsFile)) throw new Error('Receipt metrics bytes do not match the supplied metrics file');
  if (!exactKeys(receipt.registration, ['path', 'sha256', 'analysisVersion']) ||
      receipt.registration.path !== 'docs/evaluation/capture-compare/registration.v3.json' ||
      receipt.registration.sha256 !== APPROVED_REGISTRATION.rawSha256 || receipt.registration.analysisVersion !== ANALYSIS_VERSION) {
    throw new Error('Receipt registration is not the approved frozen registration');
  }
  if (!exactKeys(receipt.derivation, ['script', 'sha256', 'decodeFrames']) ||
      receipt.derivation.script !== 'scripts/eval/compare/metrics.mjs' || typeof receipt.derivation.decodeFrames !== 'boolean') {
    throw new Error('Receipt derivation record is invalid');
  }
  const currentMetricsScript = join(REPO_ROOT, receipt.derivation.script);
  if (receipt.derivation.sha256 !== sha256File(currentMetricsScript)) throw new Error('Metrics derivation script hash does not match the current verified implementation');

  const manifestMedia = manifest.files.filter((item) => item.mimeType.startsWith('video/')).map((item) => ({ path: item.path, sha256: item.sha256, bytes: item.bytes }));
  if (!Array.isArray(receipt.media) || canonicalJson(receipt.media) !== canonicalJson(manifestMedia)) throw new Error('Receipt media inventory does not exactly match the capture manifest');
  if (!Array.isArray(mediaProbes) || mediaProbes.length !== manifestMedia.length ||
      canonicalJson(receipt.mediaProbes) !== canonicalJson(mediaProbes)) {
    throw new Error('Receipt media probes do not match a fresh probe of the exact hash-bound source bytes');
  }
  if (!Array.isArray(receipt.methods) || canonicalJson(receipt.methods) !== canonicalJson(APPROVED_METHODS)) {
    throw new Error('Receipt does not bind the exact approved visual-method artifact');
  }
  const mediaHashes = new Set(manifestMedia.map((item) => item.sha256));

  if (!Array.isArray(receipt.annotations) || receipt.annotations.length === 0) throw new Error('Receipt must contain at least one annotation');
  const annotationEntries = receipt.annotations.map((item) => {
    if (!exactKeys(item, ['path', 'sha256', 'role'])) throw new Error('Receipt annotation record is invalid');
    const absolute = resolveEvidenceFile(receiptRoot, item.path);
    if (sha256File(absolute) !== item.sha256) throw new Error(`Annotation hash mismatch: ${item.path}`);
    const value = readJson(absolute);
    assertValidAnnotationsForManifest(value, manifest, { mediaProbes });
    if (value.annotator.role !== item.role) throw new Error(`Annotation role mismatch: ${item.path}`);
    if (value.source.manifestSha256 !== sha256File(manifestFile) || !mediaHashes.has(value.source.mediaSha256)) throw new Error(`Annotation source binding mismatch: ${item.path}`);
    return { absolute, value, sha256: item.sha256, path: item.path };
  });
  const workflow = annotationWorkflow(annotationEntries);
  if (workflow.rejections.length > 0 || !workflow.selected) throw new Error(`Annotation workflow rejected: ${workflow.rejections.join(' ')}`);
  if (!exactKeys(receipt.selectedAnnotation, ['path', 'sha256']) ||
      receipt.selectedAnnotation.path !== workflow.selected.path || receipt.selectedAnnotation.sha256 !== workflow.selected.sha256) {
    throw new Error('Receipt selectedAnnotation does not match the valid annotation workflow');
  }

  assertMetricApplicability(manifest, metrics);
  let derived = measurementsFromAnnotations(manifest, workflow.selected.value, workflow.selected.path);
  if (receipt.derivation.decodeFrames) {
    const video = manifest.files.find((item) => item.mimeType.startsWith('video/') && item.sha256 === workflow.selected.value.source.mediaSha256);
    if (!video) throw new Error('decodeFrames receipt has no manifest video');
    const decoded = duplicateFrameMeasurement(manifest, resolve(dirname(manifestFile), video.path), video.path);
    derived.splice(derived.findIndex((item) => item.id === decoded.id), 1, decoded);
  }
  if (measurementDigest(derived) !== measurementDigest(metrics.measurements)) throw new Error('Metrics values are not reproducible from the receipt-selected annotation/media chain');
  if (measurementDigest(ceriEvidence(derived)) !== measurementDigest(metrics.ceriEvidence)) throw new Error('CERI evidence mapping is not reproducible from verified measurements');
  const allowedSources = new Set([...annotationEntries.map((item) => item.path), ...manifestMedia.map((item) => item.path)]);
  for (const item of metrics.measurements) {
    if (['measured', 'diagnostic_only'].includes(item.status) && item.sources.some((source) => !allowedSources.has(source))) {
      throw new Error(`Metric ${item.id} cites a source outside its verified receipt/manifest chain`);
    }
  }
  return { verified: true, receipt, receiptSha256: sha256File(absoluteReceipt), annotationCount: annotationEntries.length };
}

function nextEvidenceAction(packages) {
  const priority = [
    'ball_track_continuity_percent',
    'decision_corridor_occlusion_percent',
    'contact_to_impact_audio_ms',
    'physical_event_to_score_ms',
    'result_to_next_playable_ms',
    'duplicate_frame_rate_percent',
  ];
  for (const id of priority) {
    if (packages.some((item) => measurementMap(item.metrics).get(id)?.status === 'not_available')) {
      return `Collect qualifying matched evidence for ${id}; do not impute the missing value.`;
    }
  }
  return 'Have an independent evaluator review the timecoded evidence; this tool does not award an experience score.';
}

export function buildComparison(packages, registration, evaluator) {
  if (packages.length < 2) throw new Error('At least two packages are required for comparison');
  assertApprovedRegistration(registration);
  const findings = [];
  for (const item of packages) {
    if (item.metrics.integrity.status !== 'passed') findings.push({ severity: 'Critical', package: item.manifest.captureId, finding: `metrics integrity is ${item.metrics.integrity.status}: ${item.metrics.integrity.rejections.join('; ')}` });
    if (item.manifest.evidenceClass === 'diagnostic') findings.push({ severity: 'Medium', package: item.manifest.captureId, finding: 'Diagnostic evidence cannot establish human control, pacing, preference or player experience.' });
    if (item.manifest.evaluator.authoredSubject || item.metrics.evaluator.authoredTooling) findings.push({ severity: 'High', package: item.manifest.captureId, finding: 'Builder-authored evidence requires a fresh independent evaluator before any score or gate decision.' });
    if (item.provenanceVerified !== true) findings.push({ severity: 'Critical', package: item.manifest.captureId, finding: 'Metrics receipt and complete manifest/annotation/media provenance were not verified by this report build.' });
  }
  const generatedAtUtc = packages.map((item) => item.manifest.timing.capturedAtUtc).sort().at(-1);
  const scenarioRows = packages.map((item) => ({
    captureId: item.manifest.captureId,
    scenario: item.manifest.gameplay.scenario,
    expected: item.manifest.expectedScenario,
    deviations: item.manifest.observedDeviations,
    matchToReference: item === packages[0] ? 'reference' : item.manifest.gameplay.scenario === packages[0].manifest.gameplay.scenario ? 'matched_label_only' : 'mismatch',
  }));
  const report = {
    schemaVersion: 1,
    analysisVersion: ANALYSIS_VERSION,
    generatedAtUtc,
    evaluator: {
      id: evaluator.id,
      independentOfBuilders: evaluator.independent,
      decisionAuthority: false,
      note: 'This runner reports evidence and raw comparisons; it never certifies its own tooling or awards CERI/rubric scores.',
    },
    status: 'INCOMPLETE_EVIDENCE_COMPARISON',
    packages: packages.map((item) => ({
      captureId: item.manifest.captureId,
      label: packageLabel(item),
      lane: item.manifest.lane,
      evidenceClass: item.manifest.evidenceClass,
      identity: item.manifest.identity,
      environment: item.manifest.environment,
      gameplay: item.manifest.gameplay,
      capture: item.manifest.capture,
      manifestSha256: item.metrics.manifestSha256,
      metricsSha256: item.metricsSha256,
      receiptSha256: item.receiptSha256 ?? null,
      integrity: item.metrics.integrity,
    })),
    scenarios: scenarioRows,
    metrics: comparePackages(packages, registration),
    ceriEvidence: packages.map((item) => ({ captureId: item.manifest.captureId, mapping: item.metrics.ceriEvidence, score: null })),
    humanEvidence: {
      newPlayerX: 'NOT AVAILABLE in capture/metrics packages',
      expertPlayerX: 'NOT AVAILABLE in capture/metrics packages',
      passiveVideoLimit: 'Passive video cannot establish control feel, fairness, mastery, fun, preference or repeat desire.',
    },
    findings,
    recommendedNextCorrection: nextEvidenceAction(packages),
    integrity: {
      sourceFilesVerified: packages.every((item) => item.provenanceVerified === true),
      missingValuesImputed: false,
      competitorMediaRedistributed: false,
      qualityScoreProduced: false,
    },
  };
  return report;
}

export function renderMarkdown(report) {
  const lines = [
    '# Capture comparison report',
    '',
    `- Status: **${report.status}**`,
    `- Analysis: ${report.analysisVersion}`,
    `- Evidence time: ${report.generatedAtUtc}`,
    `- Evaluator: ${report.evaluator.id}; independent of builders: ${report.evaluator.independentOfBuilders ? 'yes' : 'no'}`,
    `- Quality score: **NOT PRODUCED**`,
    '',
    'This report compares raw, provenance-bound evidence. It does not certify player experience, CERI, a locked rubric, commercial success or superiority.',
    '',
    '## Versions and environments',
    '',
    '| Capture | Lane/class | App/version | Renderer/admission/tier | Device/OS | Controls/assistance | Manifest | Metrics |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.packages.map((item) => `| ${markdown(item.captureId)} | ${markdown(`${item.lane} / ${item.evidenceClass}`)} | ${markdown(`${item.identity.application.title ?? 'unknown'} ${item.identity.application.version ?? 'version unavailable'}`)} | ${markdown(`${item.identity.renderer.observed ?? 'unavailable'} / ${item.identity.renderer.admission ?? 'unavailable'} / ${item.environment.qualityTier ?? 'tier unavailable'}`)} | ${markdown(`${item.environment.device ?? 'unknown'} / ${item.environment.os ?? 'unknown'}`)} | ${markdown(`${item.gameplay.controls ?? 'unknown'} / ${item.gameplay.assistance ?? 'unknown'}`)} | \`${item.manifestSha256}\` | \`${item.metricsSha256}\` |`),
    '',
    '## Scenario and mismatch table',
    '',
    '| Capture | Scenario | Match | Deviations |',
    '| --- | --- | --- | --- |',
    ...report.scenarios.map((row) => `| ${markdown(row.captureId)} | ${markdown(row.scenario)} | ${markdown(row.matchToReference)} | ${markdown(row.deviations.length ? row.deviations.join('; ') : 'none recorded')} |`),
    '',
    '## Raw metrics',
    '',
    `| Metric | Direction | ${report.packages.map((item) => markdown(item.captureId)).join(' | ')} |`,
    `| --- | --- | ${report.packages.map(() => '---').join(' | ')} |`,
    ...report.metrics.map((row) => {
      const cells = row.raw.map((item) => item
        ? `${item.status}: ${item.value === null ? 'NOT AVAILABLE' : `${item.value}${item.unit ? ` ${item.unit}` : ''}`} (n=${item.sampleSize}; uncertainty=${item.uncertainty ? `${item.uncertainty.value} ${item.uncertainty.unit} ${item.uncertainty.kind}` : 'not quantified'}; timecodes=${item.timecodesMs.length ? item.timecodesMs.join(',') : 'none'}; sources=${item.sources.length ? item.sources.join(',') : 'none'}; limitations=${item.limitations.length ? item.limitations.join('; ') : 'none'})`
        : 'NOT AVAILABLE');
      return `| ${markdown(row.id)} | ${row.lowerIsBetter === null ? 'descriptive' : row.lowerIsBetter ? 'lower' : 'higher'} | ${cells.map(markdown).join(' | ')} |`;
    }),
    '',
    'Missing and incomparable values are not zero and are not counted as a VANDE win. Diagnostic values remain diagnostic.',
    '',
    '## Directional observations (not quality scores)',
    '',
    ...report.metrics.flatMap((row) => row.comparisons.slice(1).map((comparison, index) => `- ${row.id}: ${report.packages[index + 1].captureId} — ${comparison.status}${comparison.direction ? ` / ${comparison.direction}` : ''}; ${comparison.reason ?? 'no additional reason'}`)),
    '',
    '## CERI evidence mapping',
    '',
    ...report.ceriEvidence.flatMap((item) => [
      `### ${item.captureId}`,
      '',
      '| Dimension | Evidence status | Measurement IDs | Score |',
      '| --- | --- | --- | --- |',
      ...item.mapping.map((row) => `| ${markdown(row.dimension)} | ${markdown(row.status)} | ${markdown(row.measurementIds.join(', ') || 'none')} | NOT SCORED |`),
      '',
    ]),
    '## Human evidence',
    '',
    `- New Player X: ${report.humanEvidence.newPlayerX}`,
    `- Expert Player X: ${report.humanEvidence.expertPlayerX}`,
    `- Limitation: ${report.humanEvidence.passiveVideoLimit}`,
    '',
    '## Findings',
    '',
    ...(report.findings.length ? report.findings.map((item) => `- **${item.severity}** — ${item.package}: ${item.finding}`) : ['- No automatic integrity finding; independent visual and human review remains required.']),
    '',
    '## Smallest next action',
    '',
    report.recommendedNextCorrection,
    '',
  ];
  return `${lines.join('\n')}\n`;
}

export async function compare(options) {
  const manifestFiles = options.manifest ?? [];
  const metricFiles = options.metrics ?? [];
  if (manifestFiles.length < 2 || manifestFiles.length !== metricFiles.length) throw new Error('Supply equal repeated --manifest and --metrics options for at least two packages');
  const registrationFile = resolve(options.registration ?? APPROVED_REGISTRATION.path);
  const registration = assertApprovedRegistration(readJson(registrationFile), registrationFile);
  const receiptFiles = options.receipt ?? metricFiles.map((file) => join(dirname(resolve(file)), 'metrics-receipt.json'));
  if (receiptFiles.length !== metricFiles.length) throw new Error('Supply one --receipt per manifest/metrics package, or keep metrics-receipt.json beside each metrics file');
  const packages = manifestFiles.map((manifestName, index) => {
    const manifestFile = resolve(manifestName);
    const metricsFile = resolve(metricFiles[index]);
    if (!existsSync(manifestFile) || !existsSync(metricsFile)) throw new Error(`Missing package file at index ${index}`);
    const { manifest, mediaProbes } = loadManifestEvidence(manifestFile, { verifyFiles: true, verifyMedia: true });
    const metrics = loadMetrics(metricsFile);
    if (metrics.captureId !== manifest.captureId) throw new Error(`Capture ID mismatch at package ${index}`);
    if (metrics.manifestSha256 !== manifestDigest(manifestFile)) throw new Error(`Manifest hash mismatch at package ${index}`);
    if (metrics.scenario !== (manifest.gameplay.scenario ?? manifest.expectedScenario)) throw new Error(`Metrics scenario does not match its manifest at package ${index}`);
    const receiptFile = resolve(receiptFiles[index]);
    const verification = verifyMetricsReceipt({ receiptFile, manifestFile, metricsFile, manifest, mediaProbes, metrics, registration });
    return {
      manifest, metrics, manifestFile, metricsFile, receiptFile,
      metricsSha256: sha256File(metricsFile), receiptSha256: verification.receiptSha256, provenanceVerified: verification.verified,
    };
  });
  const report = buildComparison(packages, registration, {
    id: options.evaluator ?? 'capture-tooling-builder',
    independent: options.independent === true,
  });
  const out = ensureNewDirectory(options.output_dir ?? defaultEvidenceDir('comparison'), { rawEvidence: true });
  const json = writeJsonNew(join(out, 'comparison.json'), report);
  const md = writeTextNew(join(out, 'comparison.md'), renderMarkdown(report));
  const index = writeJsonNew(join(out, 'evidence-index.json'), {
    schemaVersion: 1,
    analysisVersion: ANALYSIS_VERSION,
    registration: { path: registrationFile, sha256: sha256File(registrationFile) },
    inputs: packages.map((item) => ({
      captureId: item.manifest.captureId,
      manifest: { path: item.manifestFile, sha256: manifestDigest(item.manifestFile) },
      metrics: { path: item.metricsFile, sha256: item.metricsSha256 },
      receipt: { path: item.receiptFile, sha256: item.receiptSha256 },
    })),
    outputs: {
      comparisonJson: { path: basename(json), sha256: sha256File(json) },
      comparisonMarkdown: { path: basename(md), sha256: sha256File(md) },
    },
  });
  return { ok: report.findings.every((item) => item.severity !== 'Critical'), status: report.status, output: out, json, markdown: md, evidenceIndex: index };
}

async function main() {
  const options = parseArgs(process.argv.slice(2), { booleans: ['help', 'independent'], repeatable: ['manifest', 'metrics', 'receipt'] });
  if (options.help) {
    process.stdout.write('Usage: node scripts/eval/compare/compare.mjs --manifest A.json --metrics A-metrics.json [--receipt A-receipt.json] --manifest B.json --metrics B-metrics.json [--receipt B-receipt.json] [--evaluator ID] [--independent] [--output-dir DIR]\nReceipts default to metrics-receipt.json beside each metrics file. The runner emits raw comparisons and NOT COMPARABLE fields; it never awards CERI or rubric scores.\n');
    return;
  }
  const result = await compare(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`compare: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
