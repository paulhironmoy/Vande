/// <reference types="node" />

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertValidManifest,
  assertValidMetrics,
  canonicalJson,
  sha256Bytes,
  validateAnnotations,
  validateManifest,
} from '../../../scripts/eval/compare/lib.mjs';
import { validateAndroidIdentityEvidence } from '../../../scripts/eval/compare/capture-android.mjs';
import { normalizeManifest, normalizePlan } from '../../../scripts/eval/compare/normalize.mjs';
import { measurementsFromAnnotations, rectangleUnionArea } from '../../../scripts/eval/compare/metrics.mjs';
import { buildComparison, renderMarkdown } from '../../../scripts/eval/compare/compare.mjs';

const SOURCE = '38924bd+123456789abc';
const HASH = 'a'.repeat(64);

function manifest(overrides: Record<string, unknown> = {}) {
  const base = {
    schemaVersion: 1,
    captureId: 'vande-capture-001',
    lane: 'vande_engine_truth',
    evidenceClass: 'diagnostic',
    status: 'captured',
    evaluator: { id: 'builder-agent', role: 'capture operator', authoredSubject: false, independent: false },
    rights: { basis: 'VANDE-owned product', sourceUrl: null, redistribution: 'owned', notes: [] },
    identity: {
      repositorySourceId: SOURCE,
      embeddedBuildId: SOURCE,
      artifact: { path: 'artifact.json', sha256: 'e'.repeat(64) },
      application: { title: 'VANDE Cricket', packageId: 'in.vande.cricket', version: '1.0.0', store: null },
      renderer: {
        claimed: 'three-webgl',
        observed: 'three-webgl',
        admission: 'retained',
        proof: 'DOM renderer marker',
      },
    },
    timing: {
      capturedAtUtc: '2026-10-29T00:00:00.000Z',
      hostUptime: 'up 1 day, load averages: 1 1 1',
      durationMs: 10_000,
    },
    environment: {
      platform: 'production-web',
      device: 'Chromium',
      os: 'test',
      soc: null,
      gpu: null,
      ramMb: null,
      viewport: { width: 1000, height: 500, deviceScaleFactor: 1 },
      orientation: 'landscape',
      refreshHz: 60,
      qualityTier: 'balanced',
      thermal: null,
      battery: null,
      power: null,
      network: 'offline',
      backgroundLoad: 'load 1',
    },
    gameplay: {
      scenario: 'leave',
      seed: null,
      controls: 'keyboard',
      inputMethod: 'machine_keyboard',
      assistance: 'play',
      handedness: 'right',
      pitch: 'balanced',
      field: 'balanced',
      timeScale: 1,
      wholeSequence: true,
    },
    capture: {
      method: 'test capture',
      resolution: { width: 1000, height: 500 },
      frameRate: 50,
      codec: 'test',
      recorder: { class: 'test_recorder', bitRateBps: null },
      audio: { method: 'none', synchronized: false, limitations: ['no audio'] },
      perturbations: [],
      limitations: [],
    },
    files: [
      {
        role: 'raw_video',
        path: 'raw/capture.webm',
        bytes: 12,
        sha256: HASH,
        mimeType: 'video/webm',
        raw: true,
        durationMs: 10_000,
      },
      {
        role: 'artifact_inventory',
        path: 'artifact.json',
        bytes: 20,
        sha256: 'e'.repeat(64),
        mimeType: 'application/json',
        raw: true,
        durationMs: null,
      },
    ],
    sidecars: { events: [], physics: [], replay: [], frames: [], annotations: [] },
    transformations: [],
    applicability: {
      metrics: {
        time_to_first_playable_ball_ms: 'diagnostic_only',
        ball_diameter_release_px: 'diagnostic_only',
        decision_corridor_occlusion_percent: 'diagnostic_only',
        result_to_next_playable_ms: 'diagnostic_only',
        camera_cut_count: 'diagnostic_only',
        outcome_replay_contradiction_count: 'diagnostic_only',
      },
      excludedClaims: ['human preference'],
    },
    expectedScenario: 'one normal-speed ball',
    observedDeviations: [],
    errors: [],
    tools: { node: 'test' },
  };
  return { ...base, ...overrides };
}

function annotations(events: Array<Record<string, unknown>>) {
  return {
    schemaVersion: 1,
    captureId: 'vande-capture-001',
    annotator: { id: 'reviewer', role: 'primary', independentOfBuilder: true },
    source: { mediaSha256: HASH, manifestSha256: 'b'.repeat(64) },
    events: events.map((event, index) => ({
      id: `event-${index + 1}`,
      label: 'unknown',
      atMs: index * 100,
      endMs: null,
      frame: null,
      confidence: 1,
      ambiguous: false,
      region: null,
      value: null,
      note: null,
      ...event,
    })),
    adjudication: null,
  };
}

function metricsDoc(
  captureId: string,
  scenario: string,
  value: number | null,
  status = value === null ? 'not_available' : 'diagnostic_only',
) {
  const valueMeasurement = {
    id: 'time_to_first_playable_ball_ms',
    status,
    value,
    unit: value === null ? null : 'ms',
    sampleSize: value === null ? 0 : 1,
    uncertainty: null,
    timecodesMs: [],
    sources: value === null ? [] : ['annotations.json'],
    limitations: value === null ? ['missing'] : [],
  };
  const doc = {
    schemaVersion: 1,
    analysisVersion: '1.2.0',
    captureId,
    manifestSha256: 'c'.repeat(64),
    generatedAtUtc: '2026-10-29T00:00:00.000Z',
    lane: 'vande_engine_truth',
    evidenceClass: 'diagnostic',
    scenario,
    evaluator: { id: 'reviewer', authoredTooling: false, independentOfSubject: true },
    integrity: { status: 'passed', rejections: [] },
    measurements: [valueMeasurement],
    ceriEvidence: [
      {
        dimension: 'pacing',
        status: value === null ? 'not_available' : 'partial',
        measurementIds: value === null ? [] : [valueMeasurement.id],
        humanRequired: true,
        notes: ['not scored'],
      },
    ],
  };
  assertValidMetrics(doc);
  return doc;
}

describe('capture/compare evidence contract', () => {
  it('accepts an exact provenance-complete VANDE manifest', () => {
    expect(validateManifest(manifest())).toEqual([]);
    expect(assertValidManifest(manifest()).captureId).toBe('vande-capture-001');
  });

  it('rejects a runtime build mismatch instead of trusting a caller label', () => {
    const value = manifest({
      identity: {
        ...(manifest().identity as object),
        embeddedBuildId: '38924bd+ffffffffffff',
      },
    });
    expect(validateManifest(value)).toContain('$.identity.embeddedBuildId: must exactly match repositorySourceId');
  });

  it('never allows a retained renderer to be relabelled Unity WebGL', () => {
    const value = manifest({
      identity: {
        ...(manifest().identity as object),
        renderer: { claimed: 'unity-webgl', observed: 'three-webgl', admission: null, proof: null },
      },
    });
    const errors = validateManifest(value);
    expect(errors.some((error) => error.includes('a fallback cannot be relabelled'))).toBe(true);
    expect(errors.some((error) => error.includes('mandatory for Unity evidence'))).toBe(true);
  });

  it('allows an explicit Unity WebGL NOT AVAILABLE record without fake runtime proof', () => {
    const value = manifest({
      status: 'not_available',
      files: [],
      identity: {
        ...(manifest().identity as object),
        embeddedBuildId: null,
        artifact: null,
        renderer: { claimed: 'unity-webgl', observed: null, admission: null, proof: null },
      },
    });
    expect(validateManifest(value)).toEqual([]);
  });

  it('forbids local media in public-reference records', () => {
    const value = manifest({ lane: 'public_reference' });
    expect(validateManifest(value)).toContain('$.files: public-reference records must not redistribute media');
  });

  it('accepts controlled competitor evidence only with exact app identity, human input and prohibited redistribution', () => {
    const value = manifest({
      lane: 'controlled_competitor',
      evidenceClass: 'raw',
      evaluator: { id: 'operator', role: 'capture operator', authoredSubject: false, independent: true },
      rights: {
        basis: 'lawfully installed on owned phone; terms reviewed',
        sourceUrl: null,
        redistribution: 'prohibited',
        notes: [],
      },
      identity: {
        repositorySourceId: null,
        embeddedBuildId: null,
        artifact: null,
        application: { title: 'Comparison Game', packageId: 'example.game', version: '1.2.3', store: 'Google Play' },
        renderer: {
          claimed: null,
          observed: 'undisclosed-proprietary-runtime',
          admission: null,
          proof: 'package manager version only',
        },
      },
      gameplay: { ...(manifest().gameplay as object), inputMethod: 'human' },
    });
    expect(validateManifest(value)).toEqual([]);
    const automated = { ...value, gameplay: { ...value.gameplay, inputMethod: 'adb input' } };
    expect(validateManifest(automated)).toContain(
      '$.gameplay.inputMethod: must be human without competitor instrumentation',
    );
  });

  it('rejects annotation rectangles and timecodes outside the source bounds', () => {
    const value = annotations([
      { id: 'ball-release', label: 'ball_release', atMs: 10_001, region: { x: 0.9, y: 0, width: 0.2, height: 0.1 } },
    ]);
    const errors = validateAnnotations(value, { durationMs: 10_000, captureId: 'vande-capture-001' });
    expect(errors.some((error) => error.includes('outside the capture duration'))).toBe(true);
    expect(errors.some((error) => error.includes('right edge'))).toBe(true);
  });

  it('computes rectangle unions without double-counting overlapping HUD or occlusion regions', () => {
    expect(
      rectangleUnionArea([
        { x: 0, y: 0, width: 0.5, height: 1 },
        { x: 0.25, y: 0, width: 0.5, height: 1 },
      ]),
    ).toBeCloseTo(0.75, 10);
  });

  it('keeps missing observations unavailable rather than turning them into zero', () => {
    const value = annotations([
      { id: 'launch', label: 'launch', atMs: 0 },
      { id: 'first-playable', label: 'first_playable', atMs: 1500 },
      { id: 'ball-release', label: 'ball_release', atMs: 2000, region: { x: 0.49, y: 0.3, width: 0.01, height: 0.02 } },
    ]);
    expect(validateAnnotations(value, { durationMs: 10_000, captureId: 'vande-capture-001' })).toEqual([]);
    const result = measurementsFromAnnotations(manifest(), value);
    expect(result.find((item) => item.id === 'time_to_first_playable_ball_ms')).toMatchObject({
      status: 'diagnostic_only',
      value: 1500,
    });
    expect(result.find((item) => item.id === 'taps_to_first_playable_ball')).toMatchObject({
      status: 'not_available',
      value: null,
    });
    expect(result.find((item) => item.id === 'camera_cut_count')).toMatchObject({
      status: 'not_available',
      value: null,
    });
    expect(result.find((item) => item.id === 'outcome_replay_contradiction_count')).toMatchObject({
      status: 'not_available',
      value: null,
    });
  });

  it('accepts zero only when an annotator explicitly records a reviewed count', () => {
    const value = annotations([
      { id: 'camera-cut-reviewed-count', label: 'camera_cut_reviewed_count', atMs: 5000, value: 0 },
      {
        id: 'contradiction-reviewed-count',
        label: 'outcome_replay_contradiction_reviewed_count',
        atMs: 9000,
        value: 0,
      },
    ]);
    const result = measurementsFromAnnotations(manifest(), value);
    expect(result.find((item) => item.id === 'camera_cut_count')).toMatchObject({
      status: 'diagnostic_only',
      value: 0,
    });
    expect(result.find((item) => item.id === 'outcome_replay_contradiction_count')).toMatchObject({
      status: 'diagnostic_only',
      value: 0,
    });
  });

  it('records every normalization parameter and preserves the parent hash', () => {
    const plan = normalizePlan({ width: '1280', fps: '30', codec: 'libx264', crf: '18' }, { sha256: HASH });
    expect(plan).toMatchObject({ inputSha256: HASH, width: 1280, height: null, fps: 30, codec: 'libx264', crf: 18 });
    expect(plan.ffmpegArgs).toContain('{INPUT}');
    expect(plan.ffmpegArgs).toContain('{OUTPUT}');
  });

  it('re-homes a normalized capture artifact instead of leaving a dangling parent path', () => {
    const parent = manifest({
      identity: {
        ...(manifest().identity as object),
        artifact: { path: 'artifact-inventory.json', sha256: 'e'.repeat(64) },
      },
      files: [
        ...(manifest().files as Array<Record<string, unknown>>),
        {
          role: 'artifact_inventory',
          path: 'artifact-inventory.json',
          bytes: 42,
          sha256: 'e'.repeat(64),
          mimeType: 'application/json',
          raw: true,
          durationMs: null,
        },
      ],
    });
    const plan = normalizePlan({ codec: 'libx264' }, { sha256: HASH });
    const identityArtifactRecord = {
      role: 'identity_artifact',
      path: 'identity-artifact-artifact-inventory.json',
      bytes: 42,
      sha256: 'e'.repeat(64),
      mimeType: 'application/octet-stream',
      raw: true,
      durationMs: null,
    };
    const derived = normalizeManifest(parent, {
      parentManifestName: 'parent-manifest.json',
      parentManifestSha256: 'f'.repeat(64),
      parentManifestBytes: 200,
      outputRecord: {
        role: 'normalized_video',
        path: 'normalized.mp4',
        bytes: 100,
        sha256: '1'.repeat(64),
        mimeType: 'video/mp4',
        raw: false,
        durationMs: 10_000,
      },
      identityArtifactRecord,
      plan,
      evaluator: 'normalizer',
      observedOutput: {
        width: 1000,
        height: 500,
        frameRate: 50,
        codec: 'h264',
        durationMs: 10_000,
        frameRateSource: 'stream.avg_frame_rate',
        durationSource: 'format.duration',
      },
    });
    expect(derived.identity.artifact).toEqual({
      path: identityArtifactRecord.path,
      sha256: identityArtifactRecord.sha256,
    });
    expect(validateManifest(derived)).toEqual([]);
  });

  it('rejects stale Android harness identity and missing renderer proof', () => {
    const errors = validateAndroidIdentityEvidence(
      {
        buildId: '38924bd+ffffffffffff',
        expectedBuildId: '38924bd+ffffffffffff',
        installedBuildIdentity: {
          observedDom: '38924bd+ffffffffffff',
          observedEvidenceSurface: '38924bd+ffffffffffff',
        },
        device: { serial: 'other' },
        rendererEvidence: [],
        practiceTestApiPresent: true,
      },
      { sourceId: SOURCE, serial: 'device-1', renderer: 'unity-native' },
    );
    expect(errors.length).toBeGreaterThanOrEqual(5);
  });

  it('marks scenario mismatches and missing values not comparable', () => {
    const registration = JSON.parse(
      readFileSync(resolve('docs/evaluation/capture-compare/registration.v3.json'), 'utf8'),
    );
    const leftManifest = manifest();
    const rightManifest = {
      ...manifest(),
      captureId: 'competitor-capture-01',
      gameplay: { ...(manifest().gameplay as object), scenario: 'defence' },
    };
    const report = buildComparison(
      [
        { manifest: leftManifest, metrics: metricsDoc('vande-capture-001', 'leave', 1000), metricsSha256: HASH },
        {
          manifest: rightManifest,
          metrics: metricsDoc('competitor-capture-01', 'defence', null),
          metricsSha256: 'd'.repeat(64),
        },
      ],
      registration,
      { id: 'reviewer', independent: true },
    );
    expect(report.metrics[0].comparisons[1]).toMatchObject({
      status: 'not_comparable',
      delta: null,
      reason: 'scenario mismatch',
    });
    expect(report.status).toBe('INCOMPLETE_EVIDENCE_COMPARISON');
  });

  it('renders deterministic reports without a hidden wall-clock value or quality score', () => {
    const registration = JSON.parse(
      readFileSync(resolve('docs/evaluation/capture-compare/registration.v3.json'), 'utf8'),
    );
    const left = { manifest: manifest(), metrics: metricsDoc('vande-capture-001', 'leave', 1000), metricsSha256: HASH };
    const rightManifest = { ...manifest(), captureId: 'vande-capture-002' };
    const right = {
      manifest: rightManifest,
      metrics: metricsDoc('vande-capture-002', 'leave', 1200),
      metricsSha256: 'd'.repeat(64),
    };
    const first = buildComparison([left, right], registration, { id: 'reviewer', independent: true });
    const second = buildComparison([left, right], registration, { id: 'reviewer', independent: true });
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(renderMarkdown(first)).toContain('Quality score: **NOT PRODUCED**');
    expect(renderMarkdown(first)).not.toContain('PASS');
    expect(sha256Bytes(renderMarkdown(first))).toBe(sha256Bytes(renderMarkdown(second)));
  });

  it('keeps both checked-in JSON schemas parseable', () => {
    for (const file of ['manifest.schema.json', 'metrics.schema.json', 'metrics-receipt.schema.json']) {
      expect(() => JSON.parse(readFileSync(resolve('docs/evaluation/capture-compare', file), 'utf8'))).not.toThrow();
    }
  });
});
