#!/usr/bin/env node

import { constants, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANALYSIS_VERSION,
  assertValidAnnotationsForManifest,
  assertValidMetrics,
  commandAvailable,
  defaultEvidenceDir,
  ensureNewDirectory,
  loadManifestEvidence,
  manifestDigest,
  measurement,
  parseArgs,
  readJson,
  REPO_ROOT,
  runBounded,
  sha256File,
  writeJsonNew,
} from './lib.mjs';

const METRIC_IDS = [
  'time_to_first_playable_ball_ms',
  'taps_to_first_playable_ball',
  'ball_diameter_release_px',
  'ball_diameter_bounce_px',
  'ball_diameter_contact_px',
  'ball_track_continuity_percent',
  'decision_corridor_occlusion_percent',
  'camera_cut_count',
  'contact_to_impact_audio_ms',
  'physical_event_to_score_ms',
  'physical_event_to_crowd_ms',
  'result_to_next_playable_ms',
  'dead_time_ratio_percent',
  'hud_occupancy_percent',
  'persistent_control_count',
  'duplicate_frame_rate_percent',
  'outcome_replay_contradiction_count',
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

const METRIC_UNITS = Object.freeze({
  time_to_first_playable_ball_ms: 'ms',
  taps_to_first_playable_ball: 'count',
  ball_diameter_release_px: 'px',
  ball_diameter_bounce_px: 'px',
  ball_diameter_contact_px: 'px',
  ball_track_continuity_percent: 'percent',
  decision_corridor_occlusion_percent: 'percent',
  camera_cut_count: 'count',
  contact_to_impact_audio_ms: 'ms',
  physical_event_to_score_ms: 'ms',
  physical_event_to_crowd_ms: 'ms',
  result_to_next_playable_ms: 'ms',
  dead_time_ratio_percent: 'percent',
  hud_occupancy_percent: 'percent',
  persistent_control_count: 'count',
  duplicate_frame_rate_percent: 'percent',
  outcome_replay_contradiction_count: 'count',
  ball_local_luminance_contrast_ratio: 'ratio',
  camera_shake_rms_px: 'px',
  camera_roll_peak_degrees: 'degrees',
  horizon_movement_rms_px: 'px',
  bowler_motion_jerk_score: 'body_heights_per_s3',
  bat_motion_jerk_score: 'bat_lengths_per_s3',
  foot_slide_px: 'px',
  bat_arc_discontinuity_count: 'count',
  visible_clipping_count: 'count',
  artifact_material_defect_count: 'count',
  physical_event_to_camera_ms: 'ms',
  physical_event_to_result_ms: 'ms',
  touch_target_burden_count: 'count',
  text_legibility_defect_count: 'count',
});

const CERI_DIMENSIONS = [
  'delivery_readability',
  'intent_fidelity',
  'cricket_causality_and_trust',
  'mastery_depth',
  'embodiment_authenticity',
  'emotional_proportionality',
  'pacing',
  'performance_and_device_reach',
  'stability_and_progress_integrity',
  'interruption_burden',
];

function eventByLabel(events, label) {
  return events.find((event) => event.label === label || event.id === label) ?? null;
}

function eventsByLabel(events, label) {
  return events.filter((event) => event.label === label || event.id.startsWith(`${label}-`) || event.id === label);
}

function reviewedCount(events, itemLabel) {
  const items = eventsByLabel(events, itemLabel);
  const marker = eventByLabel(events, `${itemLabel}_reviewed_count`);
  if (marker) {
    if (!Number.isSafeInteger(marker.value) || marker.value < 0) return { available: false, reason: `${itemLabel}_reviewed_count needs a non-negative integer value.` };
    if (items.length > 0 && marker.value !== items.length) return { available: false, reason: `${itemLabel} events disagree with the explicit reviewed count.` };
    return { available: true, count: marker.value, items, marker };
  }
  if (items.length > 0) return { available: true, count: items.length, items, marker: null };
  return { available: false, reason: `${itemLabel} events or an explicit ${itemLabel}_reviewed_count marker are required.` };
}

function statusFor(manifest, metricId, observed) {
  if (!observed) return 'not_available';
  const declared = manifest.applicability.metrics[metricId];
  if (!['eligible', 'diagnostic_only'].includes(declared)) return 'not_available';
  if (manifest.evidenceClass === 'diagnostic' || declared === 'diagnostic_only') return 'diagnostic_only';
  return 'measured';
}

function frameUncertainty(manifest) {
  const fps = manifest.capture.frameRate;
  return fps ? { kind: 'half_frame_interval', value: 500 / fps, unit: 'ms', confidence: null } : null;
}

function interval(events, from, to) {
  const start = eventByLabel(events, from);
  const end = eventByLabel(events, to);
  if (!start || !end || end.atMs < start.atMs) return null;
  return { value: end.atMs - start.atMs, timecodes: [start.atMs, end.atMs] };
}

function pixelDiameter(event, resolution) {
  if (!event?.region || !resolution) return null;
  const widthPx = event.region.width * resolution.width;
  const heightPx = event.region.height * resolution.height;
  return (widthPx + heightPx) / 2;
}

export function annotationWorkflow(entries) {
  const rejections = [];
  const hashes = entries.map((entry) => entry.sha256 ?? sha256File(entry.absolute));
  if (new Set(hashes).size !== hashes.length) rejections.push('Duplicate annotation bytes were supplied under multiple paths.');
  const sourceBindings = new Set(entries.map((entry) => `${entry.value.source.manifestSha256}:${entry.value.source.mediaSha256}`));
  if (sourceBindings.size !== 1) rejections.push('Every annotation in a review workflow must bind the same manifest and source video.');
  const byRole = (role) => entries.filter((entry) => entry.value.annotator.role === role);
  const primary = byRole('primary');
  const secondary = byRole('secondary');
  const adjudicators = byRole('adjudicator');
  let selected = null;

  if (entries.length === 1) {
    if (primary.length !== 1) rejections.push('A single-annotation package must contain exactly one primary annotation.');
    else selected = primary[0];
    if (primary[0]?.value.annotator.independentOfBuilder !== true) rejections.push('The primary annotator is not independent of the builder.');
    if (primary[0]?.value.events.some((event) => event.ambiguous === true)) rejections.push('Ambiguous primary events require independent secondary review and adjudication.');
  } else {
    if (primary.length !== 1 || secondary.length !== 1 || adjudicators.length !== 1 || entries.length !== 3) {
      rejections.push('A reviewed package must contain exactly one primary, one secondary and one adjudicator annotation.');
    } else {
      const reviewers = [primary[0], secondary[0], adjudicators[0]];
      if (reviewers.some((entry) => entry.value.annotator.independentOfBuilder !== true)) rejections.push('Every reviewer in an adjudicated package must be independent of the builder.');
      if (new Set(reviewers.map((entry) => entry.value.annotator.id)).size !== reviewers.length) rejections.push('Primary, secondary and adjudicator IDs must be distinct.');
      const expected = new Set([primary[0].sha256 ?? sha256File(primary[0].absolute), secondary[0].sha256 ?? sha256File(secondary[0].absolute)]);
      const reviewed = new Set(adjudicators[0].value.adjudication?.reviewedFiles ?? []);
      if (reviewed.size !== expected.size || [...reviewed].some((hash) => !expected.has(hash))) {
        rejections.push('Adjudication reviewedFiles must exactly match the supplied primary and secondary annotation hashes.');
      }
      selected = adjudicators[0];
    }
  }
  return { selected, rejections, hashes };
}

function clip(rect, bounds) {
  const x1 = Math.max(rect.x, bounds.x);
  const y1 = Math.max(rect.y, bounds.y);
  const x2 = Math.min(rect.x + rect.width, bounds.x + bounds.width);
  const y2 = Math.min(rect.y + rect.height, bounds.y + bounds.height);
  return x2 > x1 && y2 > y1 ? { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } : null;
}

export function rectangleUnionArea(rectangles) {
  if (rectangles.length === 0) return 0;
  const xs = [...new Set(rectangles.flatMap((rect) => [rect.x, rect.x + rect.width]))].sort((a, b) => a - b);
  let area = 0;
  for (let index = 0; index < xs.length - 1; index += 1) {
    const x1 = xs[index];
    const x2 = xs[index + 1];
    if (x2 <= x1) continue;
    const intervals = rectangles
      .filter((rect) => rect.x < x2 && rect.x + rect.width > x1)
      .map((rect) => [rect.y, rect.y + rect.height])
      .sort((left, right) => left[0] - right[0]);
    let covered = 0;
    let current = null;
    for (const pair of intervals) {
      if (!current) current = [...pair];
      else if (pair[0] <= current[1]) current[1] = Math.max(current[1], pair[1]);
      else {
        covered += current[1] - current[0];
        current = [...pair];
      }
    }
    if (current) covered += current[1] - current[0];
    area += (x2 - x1) * covered;
  }
  return area;
}

function measured(id, manifest, observed, { value, unit, sampleSize = 1, uncertainty = null, timecodesMs = [], sources = [], limitations = [] } = {}) {
  const status = statusFor(manifest, id, observed);
  if (status === 'not_available') return measurement(id, status, { unit: unit ?? METRIC_UNITS[id] ?? null, limitations: limitations.length ? limitations : ['Required source event or eligible evidence is unavailable.'] });
  return measurement(id, status, { value, unit, sampleSize, uncertainty, timecodesMs, sources, limitations });
}

function notAvailable(id, reason) {
  return measurement(id, 'not_available', { unit: METRIC_UNITS[id] ?? null, limitations: [reason] });
}

export function measurementsFromAnnotations(manifest, annotation, sourcePath = 'annotations.json') {
  const events = annotation.events;
  const frame = frameUncertainty(manifest);
  const values = new Map();
  const firstPlayable = interval(events, 'launch', 'first_playable');
  values.set('time_to_first_playable_ball_ms', firstPlayable
    ? measured('time_to_first_playable_ball_ms', manifest, true, { value: firstPlayable.value, unit: 'ms', uncertainty: frame, timecodesMs: firstPlayable.timecodes, sources: [sourcePath] })
    : notAvailable('time_to_first_playable_ball_ms', 'launch and first_playable annotations are required.'));

  const taps = reviewedCount(events, 'tap_before_first_playable');
  values.set('taps_to_first_playable_ball', taps.available
    ? measured('taps_to_first_playable_ball', manifest, true, { value: taps.count, unit: 'count', sampleSize: taps.items.length || 1, timecodesMs: [...taps.items, ...(taps.marker ? [taps.marker] : [])].map((item) => item.atMs), sources: [sourcePath] })
    : notAvailable('taps_to_first_playable_ball', taps.reason));

  for (const [id, label] of [
    ['ball_diameter_release_px', 'ball_release'],
    ['ball_diameter_bounce_px', 'ball_bounce'],
    ['ball_diameter_contact_px', 'ball_contact'],
  ]) {
    const event = eventByLabel(events, label);
    const diameter = pixelDiameter(event, manifest.capture.resolution);
    values.set(id, diameter === null
      ? notAvailable(id, `${label} needs a normalized ball bounding box and capture resolution.`)
      : measured(id, manifest, true, { value: diameter, unit: 'px', uncertainty: null, timecodesMs: [event.atMs], sources: [sourcePath], limitations: ['Manual region precision is represented by annotator confidence, not an invented pixel error.'] }));
  }

  const visible = eventsByLabel(events, 'ball_track_sample_visible');
  const hidden = eventsByLabel(events, 'ball_track_sample_hidden');
  const trackTotal = visible.length + hidden.length;
  values.set('ball_track_continuity_percent', trackTotal
    ? measured('ball_track_continuity_percent', manifest, true, { value: 100 * visible.length / trackTotal, unit: 'percent', sampleSize: trackTotal, timecodesMs: [...visible, ...hidden].map((item) => item.atMs).sort((a, b) => a - b), sources: [sourcePath] })
    : notAvailable('ball_track_continuity_percent', 'Visible and hidden ball tracking samples are required.'));

  const corridor = eventByLabel(events, 'decision_corridor')?.region ?? null;
  const occlusions = eventsByLabel(events, 'decision_corridor_occlusion').map((item) => item.region).filter(Boolean);
  if (corridor && occlusions.length) {
    const clipped = occlusions.map((item) => clip(item, corridor)).filter(Boolean);
    const percent = corridor.width * corridor.height > 0 ? 100 * rectangleUnionArea(clipped) / (corridor.width * corridor.height) : null;
    values.set('decision_corridor_occlusion_percent', percent === null
      ? notAvailable('decision_corridor_occlusion_percent', 'Decision corridor has zero area.')
      : measured('decision_corridor_occlusion_percent', manifest, true, { value: percent, unit: 'percent', sampleSize: clipped.length, sources: [sourcePath] }));
  } else values.set('decision_corridor_occlusion_percent', notAvailable('decision_corridor_occlusion_percent', 'Decision corridor and occlusion regions are required.'));

  const cuts = reviewedCount(events, 'camera_cut');
  values.set('camera_cut_count', cuts.available
    ? measured('camera_cut_count', manifest, true, { value: cuts.count, unit: 'count', sampleSize: cuts.items.length || 1, timecodesMs: [...cuts.items, ...(cuts.marker ? [cuts.marker] : [])].map((item) => item.atMs), sources: [sourcePath] })
    : notAvailable('camera_cut_count', cuts.reason));

  for (const [id, from, to] of [
    ['contact_to_impact_audio_ms', 'contact', 'impact_audio'],
    ['physical_event_to_score_ms', 'physical_result', 'score_response'],
    ['physical_event_to_crowd_ms', 'physical_result', 'crowd_response'],
    ['result_to_next_playable_ms', 'result_visible', 'next_playable'],
  ]) {
    const result = interval(events, from, to);
    const audioUnavailable = id === 'contact_to_impact_audio_ms' && !manifest.capture.audio.synchronized;
    values.set(id, result && !audioUnavailable
      ? measured(id, manifest, true, { value: result.value, unit: 'ms', uncertainty: frame, timecodesMs: result.timecodes, sources: [sourcePath] })
      : notAvailable(id, audioUnavailable ? 'Synchronized audio is absent.' : `${from} and ${to} annotations are required.`));
  }

  const dead = interval(events, 'dead_start', 'dead_end');
  const window = interval(events, 'setup_start', 'next_playable');
  values.set('dead_time_ratio_percent', dead && window && window.value > 0
    ? measured('dead_time_ratio_percent', manifest, true, { value: 100 * dead.value / window.value, unit: 'percent', uncertainty: frame, timecodesMs: [...dead.timecodes, ...window.timecodes], sources: [sourcePath] })
    : notAvailable('dead_time_ratio_percent', 'dead_start/dead_end and setup_start/next_playable annotations are required.'));

  const hud = eventsByLabel(events, 'hud_region').map((item) => item.region).filter(Boolean);
  values.set('hud_occupancy_percent', hud.length
    ? measured('hud_occupancy_percent', manifest, true, { value: 100 * rectangleUnionArea(hud), unit: 'percent', sampleSize: hud.length, sources: [sourcePath] })
    : notAvailable('hud_occupancy_percent', 'Reviewed HUD regions are required; absence is not treated as zero.'));

  const controls = reviewedCount(events, 'persistent_control');
  values.set('persistent_control_count', controls.available
    ? measured('persistent_control_count', manifest, true, { value: controls.count, unit: 'count', sampleSize: controls.items.length || 1, sources: [sourcePath] })
    : notAvailable('persistent_control_count', controls.reason));

  values.set('duplicate_frame_rate_percent', notAvailable('duplicate_frame_rate_percent', 'Run with --decode-frames to measure the recording property.'));
  const contradictions = reviewedCount(events, 'outcome_replay_contradiction');
  values.set('outcome_replay_contradiction_count', contradictions.available
    ? measured('outcome_replay_contradiction_count', manifest, true, { value: contradictions.count, unit: 'count', sampleSize: contradictions.items.length || 1, timecodesMs: [...contradictions.items, ...(contradictions.marker ? [contradictions.marker] : [])].map((item) => item.atMs), sources: [sourcePath] })
    : notAvailable('outcome_replay_contradiction_count', contradictions.reason));
  return METRIC_IDS.map((id) => values.get(id) ?? notAvailable(id, 'Metric is not implemented for this evidence package.'));
}

export function duplicateFrameMeasurement(manifest, videoPath, sourcePath) {
  if (!commandAvailable('ffmpeg')) return notAvailable('duplicate_frame_rate_percent', 'ffmpeg is unavailable for decoded frame hashing.');
  const result = runBounded('nice', ['-n', '15', 'ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-i', videoPath, '-map', '0:v:0', '-f', 'framemd5', '-'], { timeoutMs: 10 * 60_000 });
  const hashes = result.stdout.split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(',').at(-1)?.trim())
    .filter(Boolean);
  if (hashes.length < 2) return notAvailable('duplicate_frame_rate_percent', 'Fewer than two decoded frames were available.');
  let duplicates = 0;
  for (let index = 1; index < hashes.length; index += 1) if (hashes[index] === hashes[index - 1]) duplicates += 1;
  return measured('duplicate_frame_rate_percent', manifest, true, {
    value: 100 * duplicates / (hashes.length - 1),
    unit: 'percent',
    sampleSize: hashes.length - 1,
    sources: [sourcePath],
    limitations: ['This is a property of decoded recording frames, never engine FPS.'],
  });
}

export function ceriEvidence(measurements) {
  const observed = new Set(measurements.filter((item) => ['measured', 'diagnostic_only'].includes(item.status)).map((item) => item.id));
  const mapping = {
    delivery_readability: ['ball_diameter_release_px', 'ball_diameter_bounce_px', 'ball_diameter_contact_px', 'ball_track_continuity_percent', 'decision_corridor_occlusion_percent'],
    intent_fidelity: [],
    cricket_causality_and_trust: ['contact_to_impact_audio_ms', 'physical_event_to_score_ms', 'physical_event_to_crowd_ms', 'outcome_replay_contradiction_count'],
    mastery_depth: [],
    embodiment_authenticity: [],
    emotional_proportionality: ['physical_event_to_crowd_ms'],
    pacing: ['time_to_first_playable_ball_ms', 'taps_to_first_playable_ball', 'result_to_next_playable_ms', 'dead_time_ratio_percent'],
    performance_and_device_reach: [],
    stability_and_progress_integrity: ['outcome_replay_contradiction_count'],
    interruption_burden: [],
  };
  return CERI_DIMENSIONS.map((dimension) => {
    const ids = mapping[dimension].filter((id) => observed.has(id));
    return {
      dimension,
      status: ids.length === 0 ? 'not_available' : 'partial',
      measurementIds: ids,
      humanRequired: ['delivery_readability', 'intent_fidelity', 'mastery_depth', 'embodiment_authenticity', 'emotional_proportionality', 'pacing'].includes(dimension),
      notes: ids.length === 0
        ? ['No qualifying measurement in this package; no CERI score is imputed.']
        : ['Evidence mapping only; a dimension score requires the full CERI evidence contract and independent evaluation.'],
    };
  });
}

export async function calculateMetrics(options) {
  const manifestFile = resolve(options.manifest ?? '');
  if (!options.manifest || !existsSync(manifestFile)) throw new Error('--manifest must name a capture manifest');
  const { manifest, mediaProbes } = loadManifestEvidence(manifestFile, { verifyFiles: true, verifyMedia: true });
  if (manifest.status !== 'captured') throw new Error(`Cannot calculate metrics for a ${manifest.status} capture`);
  const annotationFiles = options.annotations ?? [];
  if (annotationFiles.length === 0) throw new Error('At least one --annotations file is required');
  const annotations = annotationFiles.map((file) => {
    const absolute = resolve(file);
    if (!existsSync(absolute)) throw new Error(`Annotation file does not exist: ${absolute}`);
    const value = readJson(absolute);
    assertValidAnnotationsForManifest(value, manifest, { mediaProbes });
    if (value.source.manifestSha256 !== manifestDigest(manifestFile)) throw new Error(`Annotation manifest hash mismatch: ${absolute}`);
    const mediaHashes = new Set(manifest.files.filter((item) => item.mimeType.startsWith('video/')).map((item) => item.sha256));
    if (!mediaHashes.has(value.source.mediaSha256)) throw new Error(`Annotation media hash is absent from manifest: ${absolute}`);
    return { absolute, value };
  });
  for (const item of annotations) item.sha256 = sha256File(item.absolute);
  const workflow = annotationWorkflow(annotations);
  const selected = workflow.selected ?? annotations.find((item) => item.value.annotator.role === 'primary') ?? annotations[0];
  const integrityRejections = [...workflow.rejections];
  const out = ensureNewDirectory(options.output_dir ?? defaultEvidenceDir('metrics'), { rawEvidence: true });
  const annotationsDir = join(out, 'annotations');
  mkdirSync(annotationsDir, { recursive: true, mode: 0o700 });
  const copiedPaths = new Map();
  for (let index = 0; index < annotations.length; index += 1) {
    const target = join(annotationsDir, `${String(index + 1).padStart(2, '0')}-${basename(annotations[index].absolute)}`);
    copyFileSync(annotations[index].absolute, target, constants.COPYFILE_EXCL);
    copiedPaths.set(annotations[index].absolute, `annotations/${basename(target)}`);
  }
  const sourcePath = copiedPaths.get(selected.absolute);
  let measurements = measurementsFromAnnotations(manifest, selected.value, sourcePath);
  if (options.decode_frames) {
    const video = manifest.files.find((item) => item.mimeType.startsWith('video/') && item.sha256 === selected.value.source.mediaSha256);
    if (video) {
      const decoded = duplicateFrameMeasurement(manifest, resolve(dirname(manifestFile), video.path), video.path);
      measurements.splice(measurements.findIndex((item) => item.id === decoded.id), 1, decoded);
    }
  }
  if (integrityRejections.length > 0) {
    measurements = measurements.map((item) => ['measured', 'diagnostic_only'].includes(item.status)
      ? notAvailable(item.id, `Annotation workflow is incomplete: ${integrityRejections.join(' ')}`)
      : item);
  }
  const metrics = {
    schemaVersion: 1,
    analysisVersion: ANALYSIS_VERSION,
    captureId: manifest.captureId,
    manifestSha256: manifestDigest(manifestFile),
    generatedAtUtc: manifest.timing.capturedAtUtc,
    lane: manifest.lane,
    evidenceClass: manifest.evidenceClass,
    scenario: manifest.gameplay.scenario ?? manifest.expectedScenario,
    evaluator: {
      id: options.evaluator ?? 'capture-tooling-builder',
      authoredTooling: options.authored_tooling === true,
      independentOfSubject: options.independent === true,
    },
    integrity: {
      status: integrityRejections.length ? 'incomplete' : 'passed',
      rejections: integrityRejections,
    },
    measurements,
    ceriEvidence: ceriEvidence(measurements),
  };
  assertValidMetrics(metrics);
  const metricsFile = writeJsonNew(join(out, 'metrics.json'), metrics);
  const registrationFile = join(REPO_ROOT, 'docs', 'evaluation', 'capture-compare', 'registration.v3.json');
  const visualMethodFile = join(REPO_ROOT, 'docs', 'evaluation', 'capture-compare', 'visual-method.v1.json');
  const scriptFile = fileURLToPath(import.meta.url);
  const receipt = writeJsonNew(join(out, 'metrics-receipt.json'), {
    schemaVersion: 3,
    analysisVersion: ANALYSIS_VERSION,
    captureId: manifest.captureId,
    manifest: { sha256: manifestDigest(manifestFile) },
    media: manifest.files.filter((item) => item.mimeType.startsWith('video/')).map((item) => ({ path: item.path, sha256: item.sha256, bytes: item.bytes })),
    mediaProbes,
    methods: [{
      methodId: 'vande.capture-compare.visual-defects',
      methodVersion: '1.0.0',
      path: 'docs/evaluation/capture-compare/visual-method.v1.json',
      sha256: sha256File(visualMethodFile),
    }],
    annotations: annotations.map((item) => ({ path: copiedPaths.get(item.absolute), sha256: item.sha256, role: item.value.annotator.role })),
    selectedAnnotation: { path: sourcePath, sha256: selected.sha256 },
    metrics: { path: basename(metricsFile), sha256: sha256File(metricsFile) },
    registration: { path: 'docs/evaluation/capture-compare/registration.v3.json', sha256: sha256File(registrationFile), analysisVersion: ANALYSIS_VERSION },
    derivation: { script: 'scripts/eval/compare/metrics.mjs', sha256: sha256File(scriptFile), decodeFrames: options.decode_frames === true },
  });
  return { ok: integrityRejections.length === 0, output: out, metrics: metricsFile, receipt, status: metrics.integrity.status };
}

async function main() {
  const options = parseArgs(process.argv.slice(2), { booleans: ['help', 'decode_frames', 'authored_tooling', 'independent'], repeatable: ['annotations'] });
  if (options.help) {
    process.stdout.write('Usage: node scripts/eval/compare/metrics.mjs --manifest FILE --annotations FILE [--annotations FILE] [--decode-frames] [--evaluator ID] [--independent] [--output-dir DIR]\nMissing evidence remains NOT_AVAILABLE; annotation absence is never interpreted as zero.\n');
    return;
  }
  const result = await calculateMetrics(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`metrics: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
