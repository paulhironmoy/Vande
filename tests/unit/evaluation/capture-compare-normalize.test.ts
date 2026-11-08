import { describe, expect, it } from 'vitest';

import {
  normalizeManifest,
  normalizePlan,
  parseFfprobeObservation,
  probeNormalizedMedia,
} from '../../../scripts/eval/compare/normalize.mjs';

const INPUT_HASH = 'b'.repeat(64);
const OUTPUT_HASH = 'd'.repeat(64);

function probeJson(overrides: Record<string, unknown> = {}) {
  const {
    stream: streamOverrides = {},
    format: formatOverrides = {},
    ...rootOverrides
  } = overrides;
  const stream = {
    width: 1280,
    height: 720,
    avg_frame_rate: '30000/1001',
    r_frame_rate: '30/1',
    codec_name: 'h264',
    duration: '12.500000',
    ...(streamOverrides as Record<string, unknown>),
  };
  const format = {
    duration: '12.512345',
    ...(formatOverrides as Record<string, unknown>),
  };
  return JSON.stringify({ ...rootOverrides, streams: [stream], format });
}

function parentManifest() {
  return {
    captureId: 'vande-capture-001',
    identity: { artifact: null },
    timing: {
      capturedAtUtc: '2026-10-29T00:00:00.000Z',
      hostUptime: 'up 1 day, load averages: 1 1 1',
      durationMs: 15_000,
    },
    capture: {
      method: 'raw capture',
      resolution: { width: 1920, height: 1080 },
      frameRate: 60,
      codec: 'vp9',
      audio: { method: 'capture', synchronized: true, limitations: [] },
      perturbations: [],
      limitations: [],
    },
    transformations: [{
      operation: 'prior_crop',
      parameters: { crop: '1920:1080' },
      parentSha256: 'a'.repeat(64),
      childSha256: INPUT_HASH,
    }],
    observedDeviations: [],
    tools: { originalCapture: '1.0.0' },
  };
}

describe('capture comparison media normalization', () => {
  it('parses ffprobe-observed width, height, average FPS, codec, and container duration', () => {
    const observed = parseFfprobeObservation(probeJson());

    expect(observed).toMatchObject({
      width: 1280,
      height: 720,
      codec: 'h264',
      durationMs: 12_512.345,
      frameRateSource: 'stream.avg_frame_rate',
      durationSource: 'format.duration',
    });
    expect(observed.frameRate).toBeCloseTo(30_000 / 1_001, 10);
  });

  it('uses ffprobe nominal FPS and stream duration only when preferred observations are unavailable', () => {
    const observed = parseFfprobeObservation(probeJson({
      stream: { avg_frame_rate: '0/0', r_frame_rate: '25/1', duration: '8.250000' },
      format: { duration: 'N/A' },
    }));

    expect(observed).toMatchObject({
      frameRate: 25,
      durationMs: 8_250,
      frameRateSource: 'stream.r_frame_rate',
      durationSource: 'stream.duration',
    });
  });

  it.each([
    ['non-JSON output', 'not json'],
    ['no selected video stream', JSON.stringify({ streams: [], format: { duration: '1' } })],
    ['invalid dimensions', probeJson({ stream: { width: 0 } })],
    ['invalid frame rate', probeJson({ stream: { avg_frame_rate: '0/0', r_frame_rate: '0/0' } })],
    ['missing codec', probeJson({ stream: { codec_name: '' } })],
    ['missing duration', probeJson({ stream: { duration: 'N/A' }, format: { duration: 'N/A' } })],
  ])('fails closed for %s', (_label, output) => {
    expect(() => parseFfprobeObservation(output)).toThrow();
  });

  it('fails before probing when ffprobe is unavailable', () => {
    let invoked = false;
    expect(() => probeNormalizedMedia('/tmp/normalized.mp4', {
      available: () => false,
      run: () => {
        invoked = true;
        return { stdout: probeJson() } as never;
      },
    })).toThrow(/ffprobe is required/);
    expect(invoked).toBe(false);
  });

  it('records observed one-axis output metadata and appends the complete transform lineage', () => {
    const parent = parentManifest();
    const plan = normalizePlan({ width: '1280', codec: 'libx264' }, { sha256: INPUT_HASH });
    const derived = normalizeManifest(parent, {
      parentManifestName: 'parent-manifest.json',
      parentManifestSha256: 'c'.repeat(64),
      parentManifestBytes: 1_024,
      outputRecord: {
        role: 'normalized_video',
        path: 'normalized.mp4',
        bytes: 1_000,
        sha256: OUTPUT_HASH,
        mimeType: 'video/mp4',
        raw: false,
        durationMs: 12_512.345,
      },
      plan,
      evaluator: 'normalizer-test',
      observedOutput: {
        width: 1280,
        height: 720,
        frameRate: 30_000 / 1_001,
        codec: 'h264',
        durationMs: 12_512.345,
        frameRateSource: 'stream.avg_frame_rate',
        durationSource: 'format.duration',
      },
    });

    expect(derived.capture.resolution).toEqual({ width: 1280, height: 720 });
    expect(derived.capture.frameRate).toBeCloseTo(30_000 / 1_001, 10);
    expect(derived.capture.codec).toBe('h264');
    expect(derived.timing.durationMs).toBe(12_512.345);
    expect(derived.transformations).toHaveLength(2);
    expect(derived.transformations[0]).toEqual(parent.transformations[0]);
    expect(derived.transformations[1]).toMatchObject({
      operation: 'ffmpeg_normalize',
      parameters: {
        width: 1280,
        height: null,
        codec: 'libx264',
        observedOutput: {
          width: 1280,
          height: 720,
          frameRate: 30_000 / 1_001,
          codec: 'h264',
          durationMs: 12_512.345,
          frameRateSource: 'stream.avg_frame_rate',
          durationSource: 'format.duration',
        },
      },
      parentSha256: INPUT_HASH,
      childSha256: OUTPUT_HASH,
    });
    expect(parent.transformations).toHaveLength(1);
  });

  it('rejects an incomplete supplied probe observation instead of writing guessed metadata', () => {
    const parent = parentManifest();
    const plan = normalizePlan({ width: '1280', codec: 'libx264' }, { sha256: INPUT_HASH });

    expect(() => normalizeManifest(parent, {
      parentManifestName: 'parent-manifest.json',
      parentManifestSha256: 'c'.repeat(64),
      outputRecord: {
        role: 'normalized_video', path: 'normalized.mp4', bytes: 1_000,
        sha256: OUTPUT_HASH, mimeType: 'video/mp4', raw: false, durationMs: 12_512.345,
      },
      plan,
      evaluator: 'normalizer-test',
      observedOutput: { width: 1280, height: 720, frameRate: 30, codec: 'h264' },
    })).toThrow(/invalid media duration/);
  });

  it('rejects a normalized file record whose duration contradicts ffprobe', () => {
    const parent = parentManifest();
    const plan = normalizePlan({ width: '1280', codec: 'libx264' }, { sha256: INPUT_HASH });

    expect(() => normalizeManifest(parent, {
      parentManifestName: 'parent-manifest.json',
      parentManifestSha256: 'c'.repeat(64),
      outputRecord: {
        role: 'normalized_video', path: 'normalized.mp4', bytes: 1_000,
        sha256: OUTPUT_HASH, mimeType: 'video/mp4', raw: false, durationMs: 1,
      },
      plan,
      evaluator: 'normalizer-test',
      observedOutput: {
        width: 1280,
        height: 720,
        frameRate: 30,
        codec: 'h264',
        durationMs: 12_512.345,
        frameRateSource: 'stream.avg_frame_rate',
        durationSource: 'format.duration',
      },
    })).toThrow(/file duration does not match/);
  });

  it('rejects a missing probe observation instead of falling back to parent metadata', () => {
    const parent = parentManifest();
    const plan = normalizePlan({ width: '1280', codec: 'libx264' }, { sha256: INPUT_HASH });

    expect(() => normalizeManifest(parent, {
      parentManifestName: 'parent-manifest.json',
      parentManifestSha256: 'c'.repeat(64),
      outputRecord: {
        role: 'normalized_video', path: 'normalized.mp4', bytes: 1_000,
        sha256: OUTPUT_HASH, mimeType: 'video/mp4', raw: false, durationMs: 12_512.345,
      },
      plan,
      evaluator: 'normalizer-test',
    })).toThrow(/complete ffprobe observation is required/);
  });
});
