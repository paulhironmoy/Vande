#!/usr/bin/env node

import { constants, copyFileSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertValidManifest,
  commandAvailable,
  defaultEvidenceDir,
  ensureNewDirectory,
  fileRecord,
  integerOption,
  loadManifest,
  parseArgs,
  runBounded,
  sha256File,
  toolVersions,
  utcNow,
  writeJsonNew,
} from './lib.mjs';

function pickVideo(manifest, role) {
  const candidates = manifest.files.filter((item) => item.mimeType.startsWith('video/'));
  if (role) return candidates.find((item) => item.role === role) ?? null;
  if (candidates.length !== 1) {
    throw new Error(`Manifest has ${candidates.length} videos; use --role to choose exactly one`);
  }
  return candidates[0];
}

function finiteNumber(value) {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveFrameRate(value) {
  if (typeof value === 'string' && value.includes('/')) {
    const parts = value.split('/');
    if (parts.length !== 2) return null;
    const numerator = finiteNumber(parts[0]);
    const denominator = finiteNumber(parts[1]);
    if (numerator === null || denominator === null || numerator <= 0 || denominator <= 0) return null;
    const rate = numerator / denominator;
    return rate >= 0.1 && rate <= 1_000 ? rate : null;
  }
  const rate = finiteNumber(value);
  return rate !== null && rate >= 0.1 && rate <= 1_000 ? rate : null;
}

function observedOutput(value, context = 'ffprobe output') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} is not an object`);
  }
  const width = finiteNumber(value.width);
  const height = finiteNumber(value.height);
  const frameRate = finiteNumber(value.frameRate);
  const durationMs = finiteNumber(value.durationMs);
  const codec = typeof value.codec === 'string' ? value.codec.trim() : '';
  const frameRateSource = typeof value.frameRateSource === 'string' ? value.frameRateSource : '';
  const durationSource = typeof value.durationSource === 'string' ? value.durationSource : '';
  if (!Number.isSafeInteger(width) || width < 1 || width > 20_000) throw new Error(`${context} has an invalid video width`);
  if (!Number.isSafeInteger(height) || height < 1 || height > 20_000) throw new Error(`${context} has an invalid video height`);
  if (frameRate === null || frameRate < 0.1 || frameRate > 1_000) throw new Error(`${context} has an invalid video frame rate`);
  if (!codec || codec.length > 128 || !/^[a-zA-Z0-9._-]+$/.test(codec)) throw new Error(`${context} has an invalid video codec`);
  if (durationMs === null || durationMs <= 0 || durationMs > 3_600_000) throw new Error(`${context} has an invalid media duration`);
  if (!['stream.avg_frame_rate', 'stream.r_frame_rate'].includes(frameRateSource)) {
    throw new Error(`${context} has an invalid frame-rate source`);
  }
  if (!['format.duration', 'stream.duration'].includes(durationSource)) {
    throw new Error(`${context} has an invalid duration source`);
  }
  return {
    width,
    height,
    frameRate,
    codec,
    durationMs,
    frameRateSource,
    durationSource,
  };
}

export function parseFfprobeObservation(stdout) {
  let probe;
  try {
    probe = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`ffprobe returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!probe || typeof probe !== 'object' || !Array.isArray(probe.streams) || probe.streams.length !== 1) {
    throw new Error('ffprobe must report exactly one selected video stream');
  }
  const stream = probe.streams[0];
  if (!stream || typeof stream !== 'object' || Array.isArray(stream)) throw new Error('ffprobe video stream is invalid');

  const averageRate = positiveFrameRate(stream.avg_frame_rate);
  const nominalRate = positiveFrameRate(stream.r_frame_rate);
  const frameRate = averageRate ?? nominalRate;
  if (frameRate === null) throw new Error('ffprobe did not report a valid video frame rate');

  const formatDuration = finiteNumber(probe.format?.duration);
  const streamDuration = finiteNumber(stream.duration);
  const durationSeconds = formatDuration !== null && formatDuration > 0 ? formatDuration : streamDuration;
  if (durationSeconds === null || durationSeconds <= 0) throw new Error('ffprobe did not report a valid media duration');

  return observedOutput({
    width: stream.width,
    height: stream.height,
    frameRate,
    codec: stream.codec_name,
    durationMs: Math.round(durationSeconds * 1_000_000) / 1_000,
    frameRateSource: averageRate !== null ? 'stream.avg_frame_rate' : 'stream.r_frame_rate',
    durationSource: formatDuration !== null && formatDuration > 0 ? 'format.duration' : 'stream.duration',
  });
}

export function probeNormalizedMedia(file, { available = commandAvailable, run = runBounded } = {}) {
  if (!available('ffprobe')) throw new Error('ffprobe is required to verify normalized media and was not found');
  const result = run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,avg_frame_rate,r_frame_rate,codec_name,duration:format=duration',
    '-of', 'json',
    resolve(file),
  ], { timeoutMs: 30_000 });
  return parseFfprobeObservation(result.stdout);
}

export function normalizePlan(options, inputRecord) {
  const width = options.width === undefined ? null : integerOption(options.width, '--width', { min: 64, max: 7680 });
  const height = options.height === undefined ? null : integerOption(options.height, '--height', { min: 64, max: 4320 });
  const fps = options.fps === undefined ? null : integerOption(options.fps, '--fps', { min: 1, max: 240 });
  const codec = options.codec ?? 'libx264';
  if (!['libx264', 'libvpx-vp9'].includes(codec)) throw new Error('--codec must be libx264 or libvpx-vp9');
  const crf = integerOption(options.crf, '--crf', { min: 0, max: 63, fallback: codec === 'libx264' ? 18 : 24 });
  const filters = [];
  if (width !== null || height !== null) filters.push(`scale=${width ?? -2}:${height ?? -2}:flags=lanczos`);
  if (fps !== null) filters.push(`fps=${fps}`);
  const extension = codec === 'libx264' ? '.mp4' : '.webm';
  return {
    inputSha256: inputRecord.sha256,
    width,
    height,
    fps,
    codec,
    crf,
    filters,
    extension,
    ffmpegArgs: [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-n',
      '-i', '{INPUT}',
      '-map', '0:v:0', '-map', '0:a?',
      ...(filters.length ? ['-vf', filters.join(',')] : []),
      '-c:v', codec, '-crf', String(crf),
      ...(codec === 'libx264' ? ['-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'] : ['-b:v', '0', '-row-mt', '1']),
      '-c:a', codec === 'libx264' ? 'aac' : 'libopus',
      '{OUTPUT}',
    ],
  };
}

export function normalizeManifest(parent, {
  parentManifestName,
  parentManifestSha256,
  parentManifestBytes,
  outputRecord,
  identityArtifactRecord = null,
  plan,
  evaluator,
  observedOutput: probedOutput,
}) {
  if (probedOutput === undefined || probedOutput === null) {
    throw new Error('A complete ffprobe observation is required to create a normalized manifest');
  }
  const output = observedOutput(probedOutput, 'ffprobe observation');
  if (outputRecord?.durationMs !== output.durationMs) {
    throw new Error('Normalized video file duration does not match the verified ffprobe duration');
  }
  if (!Number.isSafeInteger(parentManifestBytes) || parentManifestBytes < 0) {
    throw new Error('Parent manifest byte count must be supplied from the copied file record');
  }
  return {
    ...parent,
    captureId: `${parent.captureId}-normalized`,
    evidenceClass: 'derived',
    evaluator: { id: evaluator, role: 'media normalizer', authoredSubject: false, independent: false },
    identity: {
      ...parent.identity,
      artifact: identityArtifactRecord
        ? { path: identityArtifactRecord.path, sha256: identityArtifactRecord.sha256 }
        : null,
    },
    timing: { ...parent.timing, capturedAtUtc: utcNow(), durationMs: output.durationMs },
    capture: {
      ...parent.capture,
      method: `${parent.capture.method}; normalized by ffmpeg and output-verified by ffprobe`,
      resolution: { width: output.width, height: output.height },
      frameRate: output.frameRate,
      codec: output.codec,
      perturbations: [...parent.capture.perturbations, 'Derived transcode; use raw parent for source-integrity review.'],
    },
    files: [
      outputRecord,
      {
        role: 'parent_manifest',
        path: parentManifestName,
        bytes: parentManifestBytes,
        sha256: parentManifestSha256,
        mimeType: 'application/json',
        raw: true,
        durationMs: null,
      },
      ...(identityArtifactRecord ? [identityArtifactRecord] : []),
    ],
    sidecars: { events: [], physics: [], replay: [], frames: [], annotations: [] },
    transformations: [
      ...parent.transformations,
      {
        operation: 'ffmpeg_normalize',
        parameters: {
          width: plan.width,
          height: plan.height,
          fps: plan.fps,
          codec: plan.codec,
          crf: plan.crf,
          filters: plan.filters,
          observedOutput: {
            width: output.width,
            height: output.height,
            frameRate: output.frameRate,
            codec: output.codec,
            durationMs: output.durationMs,
            frameRateSource: output.frameRateSource,
            durationSource: output.durationSource,
          },
        },
        parentSha256: plan.inputSha256,
        childSha256: outputRecord.sha256,
      },
    ],
    observedDeviations: [...parent.observedDeviations],
    errors: [],
    tools: {
      ...parent.tools,
      ...toolVersions({
        ffmpeg: 'command recorded in transformation parameters; exact binary version in run output',
        ffprobe: 'output metadata probe; exact binary version in run output',
      }),
    },
  };
}

export async function normalize(options) {
  const manifestPath = resolve(options.manifest ?? '');
  if (!options.manifest || !existsSync(manifestPath)) throw new Error('--manifest must name a capture manifest');
  if (!commandAvailable('ffmpeg')) throw new Error('ffmpeg is required for normalization and was not found');
  if (!commandAvailable('ffprobe')) throw new Error('ffprobe is required to verify normalized media and was not found');
  const parent = loadManifest(manifestPath, { verifyFiles: true });
  if (parent.status !== 'captured') throw new Error(`Cannot normalize a ${parent.status} capture`);
  const video = pickVideo(parent, options.role);
  if (!video) throw new Error(`No video with role ${options.role ?? '(only video)'} exists`);
  const input = resolve(dirname(manifestPath), video.path);
  const out = ensureNewDirectory(options.output_dir ?? defaultEvidenceDir('normalized'), { rawEvidence: true });
  const plan = normalizePlan(options, video);
  const output = join(out, `normalized${plan.extension}`);
  const args = plan.ffmpegArgs.map((item) => item === '{INPUT}' ? input : item === '{OUTPUT}' ? output : item);
  const version = runBounded('ffmpeg', ['-version'], { timeoutMs: 5_000 }).stdout.split(/\r?\n/)[0];
  const probeVersion = runBounded('ffprobe', ['-version'], { timeoutMs: 5_000 }).stdout.split(/\r?\n/)[0];
  runBounded('nice', ['-n', '15', 'ffmpeg', ...args], { timeoutMs: 10 * 60_000 });
  if (!existsSync(output)) throw new Error('ffmpeg exited without producing normalized media');
  const outputObservation = probeNormalizedMedia(output);

  const parentCopy = join(out, 'parent-manifest.json');
  copyFileSync(manifestPath, parentCopy, constants.COPYFILE_EXCL);
  const outputRecord = fileRecord(output, out, 'normalized_video', {
    mimeType: plan.extension === '.mp4' ? 'video/mp4' : 'video/webm',
    raw: false,
    durationMs: outputObservation.durationMs,
  });
  const parentRecord = fileRecord(parentCopy, out, 'parent_manifest', { mimeType: 'application/json', raw: true });
  let identityArtifactRecord = null;
  if (parent.identity.artifact) {
    const sourceArtifact = resolve(dirname(manifestPath), parent.identity.artifact.path);
    const artifactCopy = join(out, `identity-artifact-${basename(parent.identity.artifact.path)}`);
    copyFileSync(sourceArtifact, artifactCopy, constants.COPYFILE_EXCL);
    identityArtifactRecord = fileRecord(artifactCopy, out, 'identity_artifact', { mimeType: 'application/octet-stream', raw: true });
    if (identityArtifactRecord.sha256 !== parent.identity.artifact.sha256) {
      throw new Error('Copied identity artifact does not match the parent manifest hash');
    }
  }
  const derived = normalizeManifest(parent, {
    parentManifestName: basename(parentCopy),
    parentManifestSha256: parentRecord.sha256,
    parentManifestBytes: parentRecord.bytes,
    outputRecord,
    identityArtifactRecord,
    plan,
    evaluator: options.evaluator ?? 'capture-tooling-builder',
    observedOutput: outputObservation,
  });
  derived.tools.ffmpeg = version;
  derived.tools.ffprobe = probeVersion;
  assertValidManifest(derived, { root: out, verifyFiles: true });
  const result = writeJsonNew(join(out, 'manifest.json'), derived);
  return { ok: true, output: out, manifest: result, parentPreserved: manifestPath, normalizedSha256: sha256File(output) };
}

async function main() {
  const options = parseArgs(process.argv.slice(2), { booleans: ['help'] });
  if (options.help) {
    process.stdout.write('Usage: node scripts/eval/compare/normalize.mjs --manifest FILE [--role raw_video] [--width PX] [--height PX] [--fps N] [--codec libx264|libvpx-vp9] [--output-dir DIR]\nOriginal media is never changed or overwritten.\n');
    return;
  }
  const result = await normalize(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`normalize: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
