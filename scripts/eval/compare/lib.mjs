import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { loadavg, platform, release, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(THIS_DIR, '..', '..', '..');
export const MANIFEST_SCHEMA_VERSION = 1;
export const METRICS_SCHEMA_VERSION = 1;
export const ANALYSIS_VERSION = '1.2.0';
export const BUILD_ID_PATTERN = /^[0-9a-f]{7,40}(?:\+[0-9a-f]{12})?$/;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
export const CAPTURE_LANES = new Set(['vande_engine_truth', 'controlled_competitor', 'public_reference']);
export const EVIDENCE_CLASSES = new Set(['raw', 'diagnostic', 'derived']);
export const CAPTURE_STATUSES = new Set(['captured', 'not_available', 'failed']);
export const MEASUREMENT_STATUSES = new Set(['measured', 'diagnostic_only', 'not_available', 'not_comparable']);

export function parseArgs(argv, { booleans = [], repeatable = [] } = {}) {
  const booleanSet = new Set(booleans);
  const repeatableSet = new Set(repeatable);
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') {
      result._.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith('--')) {
      result._.push(token);
      continue;
    }
    const match = token.match(/^--([^=]+)(?:=(.*))?$/s);
    if (!match) throw new Error(`Invalid option: ${token}`);
    const key = match[1].replaceAll('-', '_');
    let value = match[2];
    if (booleanSet.has(key)) value = value === undefined ? true : !['0', 'false', 'no'].includes(value.toLowerCase());
    else if (value === undefined) {
      index += 1;
      if (index >= argv.length || argv[index].startsWith('--')) throw new Error(`${token} requires a value`);
      value = argv[index];
    }
    if (repeatableSet.has(key)) (result[key] ??= []).push(value);
    else if (Object.hasOwn(result, key)) throw new Error(`Option supplied more than once: --${match[1]}`);
    else result[key] = value;
  }
  return result;
}

export function requireOption(options, key, display = `--${key.replaceAll('_', '-')}`) {
  const value = options[key];
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${display} is required`);
  return value;
}

export function integerOption(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback } = {}) {
  if (value === undefined && fallback !== undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

export function numberOption(value, name, { min = -Infinity, max = Infinity, fallback } = {}) {
  if (value === undefined && fallback !== undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be a finite number from ${min} to ${max}`);
  }
  return parsed;
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value, pretty = true) {
  return `${JSON.stringify(canonicalize(value), null, pretty ? 2 : 0)}\n`;
}

export function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read JSON ${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

export function writeJsonNew(file, value) {
  const absolute = resolve(file);
  if (existsSync(absolute)) throw new Error(`Refusing to overwrite existing evidence: ${absolute}`);
  mkdirSync(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(temporary, canonicalJson(value), { flag: 'wx', mode: 0o600 });
    renameSync(temporary, absolute);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
  return absolute;
}

export function writeTextNew(file, value) {
  const absolute = resolve(file);
  if (existsSync(absolute)) throw new Error(`Refusing to overwrite existing evidence: ${absolute}`);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, value, { flag: 'wx', mode: 0o600 });
  return absolute;
}

export function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256File(file) {
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Evidence must be a regular non-symlink file: ${file}`);
  return sha256Bytes(readFileSync(file));
}

export function fileRecord(file, root, role, { mimeType = 'application/octet-stream', raw = true, durationMs = null } = {}) {
  const absolute = realpathSync(file);
  const base = realpathSync(root);
  const rel = relative(base, absolute).split(sep).join('/');
  if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) {
    throw new Error(`Evidence file is outside its manifest directory: ${file}`);
  }
  const info = statSync(absolute);
  return { role, path: rel, bytes: info.size, sha256: sha256File(absolute), mimeType, raw, durationMs };
}

export function sourceBuildId() {
  const script = join(REPO_ROOT, 'scripts', 'build-id.sh');
  let value;
  try {
    value = execFileSync(script, [], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30_000 }).trim();
  } catch (error) {
    throw new Error(`Cannot derive repository source identity: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (!BUILD_ID_PATTERN.test(value)) throw new Error(`Repository source identity has an invalid form: ${value}`);
  return value;
}

export function hostUptime() {
  try {
    return execFileSync('uptime', [], { encoding: 'utf8', timeout: 5_000 }).trim();
  } catch {
    return `loadavg ${loadavg().map((item) => item.toFixed(2)).join(' ')}`;
  }
}

export function utcNow() {
  return new Date().toISOString();
}

export function defaultEvidenceDir(name = 'capture') {
  return join(tmpdir(), 'vande-capture-compare', `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${name}`);
}

export function assertRawEvidenceLocation(path) {
  const absolute = resolve(path);
  const repo = realpathSync(REPO_ROOT);
  const rel = relative(repo, absolute);
  if (rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) {
    const releaseRoot = join(repo, 'release');
    const releaseRel = relative(releaseRoot, absolute);
    if (releaseRel === '..' || releaseRel.startsWith(`..${sep}`) || isAbsolute(releaseRel)) {
      throw new Error(`Raw evidence inside the repository must stay under gitignored release/: ${absolute}`);
    }
  }
  return absolute;
}

export function ensureNewDirectory(path, { rawEvidence = false } = {}) {
  const absolute = rawEvidence ? assertRawEvidenceLocation(path) : resolve(path);
  if (existsSync(absolute)) {
    const entries = lstatSync(absolute);
    if (!entries.isDirectory() || entries.isSymbolicLink()) throw new Error(`Output is not a real directory: ${absolute}`);
    throw new Error(`Refusing to reuse an evidence directory: ${absolute}`);
  }
  mkdirSync(absolute, { recursive: true, mode: 0o700 });
  return absolute;
}

export function runBounded(command, args, {
  cwd = REPO_ROOT,
  timeoutMs = 60_000,
  encoding = 'utf8',
  allowFailure = false,
  env = process.env,
  maxBuffer = 4 * 1024 * 1024,
} = {}) {
  const result = spawnSync(command, args, { cwd, timeout: timeoutMs, encoding, env, maxBuffer, windowsHide: true });
  if (result.error) throw new Error(`${command} failed to start: ${result.error.message}`);
  if (result.signal) throw new Error(`${command} was stopped by ${result.signal} after a ${timeoutMs} ms bound`);
  if (!allowFailure && result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().slice(0, 2000);
    throw new Error(`${command} exited ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

export function commandAvailable(command) {
  const result = spawnSync(command, ['-version'], { encoding: 'utf8', timeout: 5_000, windowsHide: true });
  return !result.error && result.status === 0;
}

export function toolVersions(extra = {}) {
  return {
    node: process.version,
    host: `${platform()} ${release()}`,
    ...extra,
  };
}

const MEDIA_PROBE_ARGUMENTS = Object.freeze([
  '-v', 'error',
  '-count_frames',
  '-show_entries', 'stream=index,codec_type,width,height,avg_frame_rate,r_frame_rate,codec_name,start_time,start_pts,duration,duration_ts,time_base,nb_read_frames:format=duration',
  '-of', 'json',
]);
const MEDIA_DECODE_ARGUMENTS = Object.freeze([
  '-hide_banner', '-loglevel', 'error', '-nostdin',
  '-i', '$MEDIA',
  '-map', '0:v:0', '-an',
  '-f', 'null', '-',
  '-progress', 'pipe:1', '-nostats',
]);

function finiteProbeNumber(value) {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveProbeFrameRate(value) {
  if (typeof value === 'string' && value.includes('/')) {
    const parts = value.split('/');
    if (parts.length !== 2) return null;
    const numerator = finiteProbeNumber(parts[0]);
    const denominator = finiteProbeNumber(parts[1]);
    if (numerator === null || denominator === null || numerator <= 0 || denominator <= 0) return null;
    const rate = numerator / denominator;
    return rate >= 0.1 && rate <= 1_000 ? rate : null;
  }
  const rate = finiteProbeNumber(value);
  return rate !== null && rate >= 0.1 && rate <= 1_000 ? rate : null;
}

function positiveProbeRational(value) {
  if (typeof value === 'string' && value.includes('/')) {
    const parts = value.split('/');
    if (parts.length !== 2) return null;
    const numerator = finiteProbeNumber(parts[0]);
    const denominator = finiteProbeNumber(parts[1]);
    if (numerator === null || denominator === null || numerator <= 0 || denominator <= 0) return null;
    return numerator / denominator;
  }
  const parsed = finiteProbeNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

export function parseDecodedVideoProgress(stdout) {
  if (typeof stdout !== 'string' || !/(?:^|\n)progress=end(?:\r?\n|$)/.test(stdout)) {
    throw new Error('ffmpeg video-only decode did not reach progress=end');
  }
  const values = new Map();
  for (const line of stdout.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator > 0) values.set(line.slice(0, separator), line.slice(separator + 1).trim());
  }
  const frameCount = finiteProbeNumber(values.get('frame'));
  const durationUs = finiteProbeNumber(values.get('out_time_us'));
  if (!Number.isSafeInteger(frameCount) || frameCount < 1) throw new Error('ffmpeg video-only decode reported no frames');
  if (!Number.isSafeInteger(durationUs) || durationUs < 1 || durationUs > 3_600_000_000) {
    throw new Error('ffmpeg video-only decode reported an invalid visual duration');
  }
  return { frameCount, durationUs };
}

export function parseMediaProbeObservation(stdout, decodedVideo) {
  let probe;
  try {
    probe = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`ffprobe returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (!probe || typeof probe !== 'object' || !Array.isArray(probe.streams)) {
    throw new Error('ffprobe output must contain a stream inventory');
  }
  const videoStreams = probe.streams.filter((item) => item?.codec_type === 'video');
  if (videoStreams.length !== 1) throw new Error('ffprobe must report exactly one video stream');
  const audioStreams = probe.streams.filter((item) => item?.codec_type === 'audio');
  const audioStreamCount = audioStreams.length;
  const decodedAudioStreamCount = audioStreams.filter((item) => {
    const count = finiteProbeNumber(item?.nb_read_frames);
    return Number.isSafeInteger(count) && count > 0;
  }).length;
  if (decodedAudioStreamCount !== audioStreamCount) throw new Error('ffprobe could not decode every declared audio stream');
  const audioCoverage = audioStreams.map((audio, index) => {
    const timeBase = positiveProbeRational(audio.time_base);
    const startTime = finiteProbeNumber(audio.start_time);
    const startPts = finiteProbeNumber(audio.start_pts);
    const duration = finiteProbeNumber(audio.duration);
    const durationTs = finiteProbeNumber(audio.duration_ts);
    const startSeconds = startTime !== null ? startTime : startPts !== null && timeBase !== null ? startPts * timeBase : null;
    const timestampDuration = durationTs !== null && durationTs > 0 && timeBase !== null ? durationTs * timeBase : null;
    const durationSeconds = timestampDuration !== null && timestampDuration > 0
      ? timestampDuration
      : duration !== null && duration > 0 ? duration : null;
    const frameCount = finiteProbeNumber(audio.nb_read_frames);
    if (duration !== null && duration > 0 && timestampDuration !== null && timestampDuration > 0 && Math.abs(duration - timestampDuration) > 0.05) {
      throw new Error(`ffprobe audio stream ${index} duration disagrees with its timestamp/time-base duration`);
    }
    const startUs = startSeconds === null ? null : Math.round(startSeconds * 1_000_000);
    const durationUs = durationSeconds === null ? null : Math.round(durationSeconds * 1_000_000);
    return {
      index: Number.isSafeInteger(audio.index) ? audio.index : index,
      decodedFrameCount: Number.isSafeInteger(frameCount) ? frameCount : 0,
      startUs,
      durationUs,
      endUs: startUs === null || durationUs === null ? null : startUs + durationUs,
    };
  });
  const stream = videoStreams[0];
  if (!stream || typeof stream !== 'object' || Array.isArray(stream)) throw new Error('ffprobe video stream is invalid');
  const width = finiteProbeNumber(stream.width);
  const height = finiteProbeNumber(stream.height);
  const averageRate = positiveProbeFrameRate(stream.avg_frame_rate);
  const nominalRate = positiveProbeFrameRate(stream.r_frame_rate);
  const frameRate = averageRate ?? nominalRate;
  const streamDuration = finiteProbeNumber(stream.duration);
  const durationTs = finiteProbeNumber(stream.duration_ts);
  const timeBase = positiveProbeRational(stream.time_base);
  const timestampDuration = durationTs !== null && durationTs > 0 && timeBase !== null ? durationTs * timeBase : null;
  const probedFrameCount = finiteProbeNumber(stream.nb_read_frames);
  const decodedFrameCount = decodedVideo?.frameCount;
  const durationUs = decodedVideo?.durationUs;
  const durationSeconds = Number.isSafeInteger(durationUs) ? durationUs / 1_000_000 : null;
  const formatDuration = finiteProbeNumber(probe.format?.duration);
  const codec = typeof stream.codec_name === 'string' ? stream.codec_name.trim() : '';
  if (!Number.isSafeInteger(width) || width < 1 || width > 20_000) throw new Error('ffprobe has an invalid video width');
  if (!Number.isSafeInteger(height) || height < 1 || height > 20_000) throw new Error('ffprobe has an invalid video height');
  if (frameRate === null) throw new Error('ffprobe did not report a valid video frame rate');
  if (!codec || codec.length > 128 || !/^[a-zA-Z0-9._-]+$/.test(codec)) throw new Error('ffprobe has an invalid video codec');
  if (!Number.isSafeInteger(probedFrameCount) || probedFrameCount < 1) throw new Error('ffprobe did not decode any selected video frames');
  if (!Number.isSafeInteger(decodedFrameCount) || decodedFrameCount < 1 || decodedFrameCount !== probedFrameCount) {
    throw new Error('ffmpeg video-only decode frame count disagrees with ffprobe');
  }
  if (durationSeconds === null || durationSeconds <= 0 || durationSeconds > 3_600) throw new Error('ffprobe did not report a valid media duration');
  const frameToleranceSeconds = Math.max(0.002, (1 / frameRate) + 0.001);
  for (const [label, corroboratingDuration] of [['stream duration', streamDuration], ['timestamp/time-base duration', timestampDuration]]) {
    if (corroboratingDuration !== null && corroboratingDuration > 0 && Math.abs(corroboratingDuration - durationSeconds) > frameToleranceSeconds) {
      throw new Error(`ffmpeg decoded-video duration materially disagrees with the selected-video ${label}`);
    }
  }
  if (formatDuration !== null && formatDuration > 0 && Math.abs(formatDuration - durationSeconds) > frameToleranceSeconds) {
    throw new Error('ffprobe container duration materially disagrees with the selected video evidence duration');
  }
  return {
    width,
    height,
    frameRate,
    codec,
    audioStreamCount,
    decodedAudioStreamCount,
    audioCoverage,
    decodedFrameCount,
    durationUs,
    durationMs: durationUs / 1_000,
    frameRateSource: averageRate !== null ? 'stream.avg_frame_rate' : 'stream.r_frame_rate',
    durationSource: 'ffmpeg.decoded_video_progress',
  };
}

function mediaToolIdentity(tool, run = runBounded) {
  const locator = run('which', [tool], { timeoutMs: 5_000 });
  const located = String(locator.stdout ?? '').trim().split(/\r?\n/)[0];
  if (!located) throw new Error(`${tool} is required to admit video evidence and was not found`);
  const executable = realpathSync(located);
  const version = run(executable, ['-version'], { timeoutMs: 5_000 }).stdout.split(/\r?\n/)[0]?.trim();
  if (!version) throw new Error(`${tool} did not report its version`);
  return { executable, tool, version, executableSha256: sha256File(executable) };
}

export function probeMediaEvidence(file, { run = runBounded, identity = null, decoderIdentity = null } = {}) {
  const absolute = realpathSync(file);
  const before = { sha256: sha256File(absolute), bytes: statSync(absolute).size };
  const probeIdentity = identity ?? mediaToolIdentity('ffprobe', run);
  if (!probeIdentity || probeIdentity.tool !== 'ffprobe' || !SHA256_PATTERN.test(probeIdentity.executableSha256 ?? '') ||
      typeof probeIdentity.version !== 'string' || probeIdentity.version.length === 0) {
    throw new Error('ffprobe identity is incomplete');
  }
  const executable = probeIdentity.executable ?? 'ffprobe';
  // `-count_frames` decodes the selected stream but emits one compact stream
  // record, avoiding output growth proportional to capture duration.
  const result = run(executable, [...MEDIA_PROBE_ARGUMENTS, absolute], {
    timeoutMs: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const decodeIdentity = decoderIdentity ?? mediaToolIdentity('ffmpeg', run);
  if (!decodeIdentity || decodeIdentity.tool !== 'ffmpeg' || !SHA256_PATTERN.test(decodeIdentity.executableSha256 ?? '') ||
      typeof decodeIdentity.version !== 'string' || decodeIdentity.version.length === 0) {
    throw new Error('ffmpeg decoder identity is incomplete');
  }
  const decoderExecutable = decodeIdentity.executable ?? 'ffmpeg';
  const decodeArguments = MEDIA_DECODE_ARGUMENTS.map((item) => item === '$MEDIA' ? absolute : item);
  const decodeResult = run(decoderExecutable, decodeArguments, { timeoutMs: 60_000, maxBuffer: 4 * 1024 * 1024 });
  const decodedVideo = parseDecodedVideoProgress(decodeResult.stdout);
  const observation = parseMediaProbeObservation(result.stdout, decodedVideo);
  const after = { sha256: sha256File(absolute), bytes: statSync(absolute).size };
  if (before.sha256 !== after.sha256 || before.bytes !== after.bytes) throw new Error('Media bytes changed during ffprobe admission');
  return {
    sha256: before.sha256,
    bytes: before.bytes,
    probe: {
      tool: 'ffprobe',
      version: probeIdentity.version,
      executableSha256: probeIdentity.executableSha256,
      arguments: [...MEDIA_PROBE_ARGUMENTS, '$MEDIA'],
    },
    decoder: {
      tool: 'ffmpeg',
      version: decodeIdentity.version,
      executableSha256: decodeIdentity.executableSha256,
      arguments: [...MEDIA_DECODE_ARGUMENTS],
    },
    observation,
  };
}

export function verifyManifestMedia(manifest, root, dependencies = {}) {
  const videos = Array.isArray(manifest?.files)
    ? manifest.files.filter((item) => item?.mimeType?.startsWith('video/'))
    : [];
  if (manifest?.status === 'captured' && manifest?.lane !== 'public_reference' && videos.length !== 1) {
    throw new Error('Captured non-public evidence must bind exactly one video; split raw and derived media into separate manifests');
  }
  const probes = videos.map((file) => {
    if (!safeRelative(file.path)) throw new Error(`Unsafe manifest media path: ${file.path}`);
    const absolute = resolve(root, file.path);
    const rel = relative(resolve(root), absolute);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Manifest media path escapes its package: ${file.path}`);
    const info = lstatSync(absolute);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Manifest media path is not a regular file: ${file.path}`);
    const result = probeMediaEvidence(absolute, dependencies);
    if (result.sha256 !== file.sha256 || result.bytes !== file.bytes) throw new Error(`Media probe binding mismatch: ${file.path}`);
    if (file.durationMs !== null && Math.abs(file.durationMs - result.observation.durationMs) > 0.001) {
      throw new Error(`Declared video duration does not match ffprobe for ${file.path}: declared ${file.durationMs} ms, observed ${result.observation.durationMs} ms`);
    }
    if (manifest.status === 'captured' && !(typeof file.durationMs === 'number' && file.durationMs > 0)) {
      throw new Error(`Captured video lacks a positive declared ffprobe duration: ${file.path}`);
    }
    return { path: file.path, ...result };
  });
  if (manifest.status === 'captured' && probes.length === 1) {
    const observed = probes[0].observation;
    const resolution = manifest.capture?.resolution;
    if (!resolution || resolution.width !== observed.width || resolution.height !== observed.height) {
      throw new Error('Capture resolution does not match the exact hash-bound video probe');
    }
    if (typeof manifest.capture?.frameRate !== 'number' || Math.abs(manifest.capture.frameRate - observed.frameRate) > 0.000001) {
      throw new Error('Capture frame rate does not match the exact hash-bound video probe');
    }
    if (manifest.capture?.codec !== observed.codec) throw new Error('Capture codec does not match the exact hash-bound video probe');
    if (manifest.capture?.audio?.method === 'none' && observed.audioStreamCount !== 0) {
      throw new Error('Capture declares no audio but the exact hash-bound media contains an audio stream');
    }
    if (manifest.capture?.audio?.synchronized === true && observed.decodedAudioStreamCount < 1) {
      throw new Error('Capture declares synchronized audio but the exact hash-bound media has no embedded audio stream');
    }
    if (manifest.capture?.audio?.synchronized === true) {
      const toleranceUs = Math.ceil(1_000_000 / observed.frameRate) + 1_000;
      const completeCoverage = observed.audioCoverage.length === observed.audioStreamCount && observed.audioCoverage.every((item) =>
        Number.isSafeInteger(item.startUs) && Number.isSafeInteger(item.endUs) &&
        item.startUs <= toleranceUs && item.endUs + toleranceUs >= observed.durationUs);
      if (!completeCoverage) {
        throw new Error('Capture declares synchronized audio but decoded audio coverage does not span the visual evidence duration');
      }
    }
  }
  return probes;
}

function object(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function string(value, min = 1, max = 2048) {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

function nullableString(value, max = 2048) {
  return value === null || string(value, 1, max);
}

function finite(value, min = -Infinity, max = Infinity) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function integer(value, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function isoUtc(value) {
  return string(value, 20, 40) && !Number.isNaN(Date.parse(value)) && /Z$/.test(value);
}

function exactKeys(value, required, optional = []) {
  if (!object(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}

function safeRelative(value) {
  return string(value, 1, 512) && !value.includes('\\') && !value.includes('\0') && !value.startsWith('/') &&
    value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function push(errors, condition, path, message) {
  if (!condition) errors.push(`${path}: ${message}`);
}

export function validateManifest(value, { root = null, verifyFiles = false } = {}) {
  const errors = [];
  const topRequired = [
    'schemaVersion', 'captureId', 'lane', 'evidenceClass', 'status', 'evaluator', 'rights', 'identity', 'timing',
    'environment', 'gameplay', 'capture', 'files', 'sidecars', 'transformations', 'applicability',
    'expectedScenario', 'observedDeviations', 'errors', 'tools',
  ];
  push(errors, exactKeys(value, topRequired), '$', 'must be an exact capture-manifest object');
  if (!object(value)) return errors;
  push(errors, value.schemaVersion === MANIFEST_SCHEMA_VERSION, '$.schemaVersion', `must equal ${MANIFEST_SCHEMA_VERSION}`);
  push(errors, string(value.captureId, 8, 128) && /^[a-z0-9][a-z0-9._-]+$/.test(value.captureId), '$.captureId', 'must be a stable lowercase identifier');
  push(errors, CAPTURE_LANES.has(value.lane), '$.lane', 'is not a supported evidence lane');
  push(errors, EVIDENCE_CLASSES.has(value.evidenceClass), '$.evidenceClass', 'is not raw, diagnostic or derived');
  push(errors, CAPTURE_STATUSES.has(value.status), '$.status', 'is not captured, not_available or failed');

  push(errors, exactKeys(value.evaluator, ['id', 'role', 'authoredSubject', 'independent']), '$.evaluator', 'must use the exact evaluator shape');
  if (object(value.evaluator)) {
    push(errors, string(value.evaluator.id, 2, 128), '$.evaluator.id', 'is required');
    push(errors, string(value.evaluator.role, 2, 128), '$.evaluator.role', 'is required');
    push(errors, typeof value.evaluator.authoredSubject === 'boolean', '$.evaluator.authoredSubject', 'must be boolean');
    push(errors, typeof value.evaluator.independent === 'boolean', '$.evaluator.independent', 'must be boolean');
    if (value.evaluator.authoredSubject === true) {
      push(errors, value.evaluator.independent === false, '$.evaluator.independent', 'cannot be true when the evaluator authored the subject');
    }
  }

  push(errors, exactKeys(value.rights, ['basis', 'sourceUrl', 'redistribution', 'notes']), '$.rights', 'must use the exact rights shape');
  if (object(value.rights)) {
    push(errors, string(value.rights.basis, 2, 512), '$.rights.basis', 'is required');
    push(errors, nullableString(value.rights.sourceUrl), '$.rights.sourceUrl', 'must be null or a URL string');
    push(errors, ['owned', 'internal_only', 'prohibited'].includes(value.rights.redistribution), '$.rights.redistribution', 'is invalid');
    push(errors, Array.isArray(value.rights.notes) && value.rights.notes.every((item) => string(item, 1, 1024)), '$.rights.notes', 'must be a string array');
  }

  push(errors, exactKeys(value.identity, ['repositorySourceId', 'embeddedBuildId', 'artifact', 'application', 'renderer']), '$.identity', 'must use the exact identity shape');
  if (object(value.identity)) {
    const source = value.identity.repositorySourceId;
    const embedded = value.identity.embeddedBuildId;
    push(errors, source === null || (typeof source === 'string' && BUILD_ID_PATTERN.test(source)), '$.identity.repositorySourceId', 'must be null or a derived build ID');
    push(errors, embedded === null || (typeof embedded === 'string' && BUILD_ID_PATTERN.test(embedded)), '$.identity.embeddedBuildId', 'must be null or a runtime build ID');
    if (value.lane === 'vande_engine_truth' && value.status === 'captured') {
      push(errors, BUILD_ID_PATTERN.test(source ?? ''), '$.identity.repositorySourceId', 'is mandatory for a captured VANDE run');
      push(errors, source === embedded, '$.identity.embeddedBuildId', 'must exactly match repositorySourceId');
      push(errors, object(value.identity.artifact), '$.identity.artifact', 'is mandatory for captured VANDE evidence');
    }
    push(errors, value.identity.artifact === null || exactKeys(value.identity.artifact, ['path', 'sha256']), '$.identity.artifact', 'must be null or {path,sha256}');
    if (object(value.identity.artifact)) {
      push(errors, safeRelative(value.identity.artifact.path), '$.identity.artifact.path', 'must be a safe relative path');
      push(errors, SHA256_PATTERN.test(value.identity.artifact.sha256), '$.identity.artifact.sha256', 'must be SHA-256');
    }
    push(errors, exactKeys(value.identity.application, ['title', 'packageId', 'version', 'store']), '$.identity.application', 'must use the exact application shape');
    if (object(value.identity.application)) {
      for (const key of ['title', 'packageId', 'version', 'store']) push(errors, nullableString(value.identity.application[key], 256), `$.identity.application.${key}`, 'must be null or a string');
      if (value.lane === 'controlled_competitor' && value.status === 'captured') {
        for (const key of ['title', 'packageId', 'version', 'store']) push(errors, string(value.identity.application[key], 1, 256), `$.identity.application.${key}`, 'is mandatory for controlled competitor evidence');
      }
    }
    push(errors, exactKeys(value.identity.renderer, ['claimed', 'observed', 'admission', 'proof']), '$.identity.renderer', 'must use the exact renderer shape');
    if (object(value.identity.renderer)) {
      for (const key of ['claimed', 'observed', 'admission', 'proof']) push(errors, nullableString(value.identity.renderer[key], 512), `$.identity.renderer.${key}`, 'must be null or a string');
      if (value.status === 'captured') push(errors, string(value.identity.renderer.observed, 1, 128), '$.identity.renderer.observed', 'is mandatory for a captured run');
      if (value.identity.renderer.claimed === 'unity-webgl' && value.status === 'captured') {
        push(errors, value.identity.renderer.observed === 'unity-webgl', '$.identity.renderer.observed', 'must prove unity-webgl; a fallback cannot be relabelled');
        push(errors, string(value.identity.renderer.proof, 1, 512), '$.identity.renderer.proof', 'is mandatory for Unity evidence');
      }
      if (value.identity.renderer.claimed === 'unity-native' && value.status === 'captured') {
        push(errors, value.identity.renderer.observed === 'unity-native', '$.identity.renderer.observed', 'must prove unity-native at live runtime');
        push(errors, string(value.identity.renderer.admission, 1, 512), '$.identity.renderer.admission', 'is mandatory for native Unity evidence');
        push(errors, string(value.identity.renderer.proof, 1, 512), '$.identity.renderer.proof', 'is mandatory for native Unity evidence');
        push(errors, object(value.identity.artifact), '$.identity.artifact', 'is mandatory for native Unity evidence');
      }
    }
  }

  push(errors, exactKeys(value.timing, ['capturedAtUtc', 'hostUptime', 'durationMs']), '$.timing', 'must use the exact timing shape');
  if (object(value.timing)) {
    push(errors, isoUtc(value.timing.capturedAtUtc), '$.timing.capturedAtUtc', 'must be a UTC ISO timestamp');
    push(errors, string(value.timing.hostUptime, 1, 1024), '$.timing.hostUptime', 'is required');
    push(errors, value.timing.durationMs === null || finite(value.timing.durationMs, 0, 3_600_000), '$.timing.durationMs', 'must be null or bounded milliseconds');
  }

  const environmentKeys = ['platform', 'device', 'os', 'soc', 'gpu', 'ramMb', 'viewport', 'orientation', 'refreshHz', 'qualityTier', 'thermal', 'battery', 'power', 'network', 'backgroundLoad'];
  push(errors, exactKeys(value.environment, environmentKeys), '$.environment', 'must use the exact environment shape');
  if (object(value.environment)) {
    for (const key of ['platform', 'device', 'os', 'soc', 'gpu', 'orientation', 'qualityTier', 'thermal', 'battery', 'power', 'network', 'backgroundLoad']) {
      push(errors, nullableString(value.environment[key], 512), `$.environment.${key}`, 'must be null or a string');
    }
    push(errors, value.environment.ramMb === null || finite(value.environment.ramMb, 1, 1_000_000), '$.environment.ramMb', 'must be null or positive MiB');
    push(errors, value.environment.refreshHz === null || finite(value.environment.refreshHz, 1, 1000), '$.environment.refreshHz', 'must be null or positive Hz');
    push(errors, value.environment.viewport === null || exactKeys(value.environment.viewport, ['width', 'height', 'deviceScaleFactor']), '$.environment.viewport', 'must be null or exact viewport');
    if (object(value.environment.viewport)) {
      push(errors, integer(value.environment.viewport.width, 1, 20_000), '$.environment.viewport.width', 'must be positive pixels');
      push(errors, integer(value.environment.viewport.height, 1, 20_000), '$.environment.viewport.height', 'must be positive pixels');
      push(errors, finite(value.environment.viewport.deviceScaleFactor, 0.1, 10), '$.environment.viewport.deviceScaleFactor', 'must be from 0.1 to 10');
    }
  }

  const gameplayKeys = ['scenario', 'seed', 'controls', 'inputMethod', 'assistance', 'handedness', 'pitch', 'field', 'timeScale', 'wholeSequence'];
  push(errors, exactKeys(value.gameplay, gameplayKeys), '$.gameplay', 'must use the exact gameplay shape');
  if (object(value.gameplay)) {
    for (const key of ['scenario', 'seed', 'controls', 'inputMethod', 'assistance', 'handedness', 'pitch', 'field']) push(errors, nullableString(value.gameplay[key], 512), `$.gameplay.${key}`, 'must be null or a string');
    push(errors, value.gameplay.timeScale === null || finite(value.gameplay.timeScale, 0.01, 16), '$.gameplay.timeScale', 'must be null or from 0.01 to 16');
    push(errors, typeof value.gameplay.wholeSequence === 'boolean', '$.gameplay.wholeSequence', 'must be boolean');
    if (value.evidenceClass !== 'diagnostic' && value.lane !== 'public_reference') {
      push(errors, value.gameplay.timeScale === 1, '$.gameplay.timeScale', 'must equal 1 outside diagnostic evidence');
    }
  }

  const captureKeys = ['method', 'resolution', 'frameRate', 'codec', 'audio', 'perturbations', 'limitations'];
  push(errors, exactKeys(value.capture, captureKeys, ['recorder']), '$.capture', 'must use the exact capture shape');
  if (object(value.capture)) {
    push(errors, string(value.capture.method, 2, 512), '$.capture.method', 'is required');
    push(errors, value.capture.resolution === null || exactKeys(value.capture.resolution, ['width', 'height']), '$.capture.resolution', 'must be null or exact dimensions');
    if (object(value.capture.resolution)) {
      push(errors, integer(value.capture.resolution.width, 1, 20_000), '$.capture.resolution.width', 'must be positive pixels');
      push(errors, integer(value.capture.resolution.height, 1, 20_000), '$.capture.resolution.height', 'must be positive pixels');
    }
    push(errors, value.capture.frameRate === null || finite(value.capture.frameRate, 0.1, 1000), '$.capture.frameRate', 'must be null or positive fps');
    push(errors, nullableString(value.capture.codec, 128), '$.capture.codec', 'must be null or a codec');
    push(errors, exactKeys(value.capture.audio, ['method', 'synchronized', 'limitations']), '$.capture.audio', 'must use the exact audio shape');
    if (object(value.capture.audio)) {
      push(errors, string(value.capture.audio.method, 1, 256), '$.capture.audio.method', 'is required');
      push(errors, typeof value.capture.audio.synchronized === 'boolean', '$.capture.audio.synchronized', 'must be boolean');
      push(errors, Array.isArray(value.capture.audio.limitations) && value.capture.audio.limitations.every((item) => string(item, 1, 1024)), '$.capture.audio.limitations', 'must be a string array');
    }
    for (const key of ['perturbations', 'limitations']) push(errors, Array.isArray(value.capture[key]) && value.capture[key].every((item) => string(item, 1, 1024)), `$.capture.${key}`, 'must be a string array');
    if (Object.hasOwn(value.capture, 'recorder')) {
      push(errors, exactKeys(value.capture.recorder, ['class', 'bitRateBps']), '$.capture.recorder', 'must use the exact recorder shape');
      if (object(value.capture.recorder)) {
        push(errors, string(value.capture.recorder.class, 1, 128), '$.capture.recorder.class', 'is required');
        push(errors, value.capture.recorder.bitRateBps === null || integer(value.capture.recorder.bitRateBps, 1, 1_000_000_000), '$.capture.recorder.bitRateBps', 'must be null or a positive integer');
      }
    }
  }

  push(errors, Array.isArray(value.files), '$.files', 'must be an array');
  if (Array.isArray(value.files)) {
    if (value.status === 'captured' && value.lane !== 'public_reference') push(errors, value.files.length > 0, '$.files', 'must include at least one captured file');
    const paths = new Set();
    value.files.forEach((file, index) => {
      const path = `$.files[${index}]`;
      push(errors, exactKeys(file, ['role', 'path', 'bytes', 'sha256', 'mimeType', 'raw', 'durationMs']), path, 'must use the exact file shape');
      if (!object(file)) return;
      push(errors, string(file.role, 1, 128), `${path}.role`, 'is required');
      push(errors, safeRelative(file.path), `${path}.path`, 'must be a safe relative path');
      push(errors, integer(file.bytes, 0), `${path}.bytes`, 'must be a non-negative byte count');
      push(errors, SHA256_PATTERN.test(file.sha256), `${path}.sha256`, 'must be SHA-256');
      push(errors, string(file.mimeType, 1, 128), `${path}.mimeType`, 'is required');
      push(errors, typeof file.raw === 'boolean', `${path}.raw`, 'must be boolean');
      push(errors, file.durationMs === null || finite(file.durationMs, 0, 3_600_000), `${path}.durationMs`, 'must be null or bounded milliseconds');
      push(errors, !paths.has(file.path), `${path}.path`, 'must be unique');
      paths.add(file.path);
      if (verifyFiles && root && safeRelative(file.path)) {
        try {
          const target = resolve(root, file.path);
          const rel = relative(resolve(root), target);
          if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('path escape');
          const info = lstatSync(target);
          push(errors, info.isFile() && !info.isSymbolicLink(), `${path}.path`, 'does not name a regular file');
          push(errors, info.size === file.bytes, `${path}.bytes`, `does not match observed ${info.size}`);
          push(errors, sha256File(target) === file.sha256, `${path}.sha256`, 'does not match file bytes');
        } catch (error) {
          errors.push(`${path}: cannot verify file (${error instanceof Error ? error.message : String(error)})`);
        }
      }
    });
  }

  if (object(value.identity?.artifact) && Array.isArray(value.files)) {
    const artifactFile = value.files.find((file) => object(file) && file.path === value.identity.artifact.path);
    push(errors, Boolean(artifactFile), '$.identity.artifact.path', 'must name a file declared in $.files');
    if (artifactFile) {
      push(errors, artifactFile.sha256 === value.identity.artifact.sha256, '$.identity.artifact.sha256', 'must match the declared artifact file hash');
    }
  }

  push(errors, exactKeys(value.sidecars, ['events', 'physics', 'replay', 'frames', 'annotations']), '$.sidecars', 'must use the exact sidecar shape');
  if (object(value.sidecars)) {
    const declaredFilePaths = new Set(Array.isArray(value.files) ? value.files.filter(object).map((item) => item.path) : []);
    const declaredSidecarPaths = new Set();
    for (const key of ['events', 'physics', 'replay', 'frames', 'annotations']) {
      push(errors, Array.isArray(value.sidecars[key]) && value.sidecars[key].every((item) => safeRelative(item)), `$.sidecars.${key}`, 'must be a safe-relative-path array');
      if (!Array.isArray(value.sidecars[key])) continue;
      value.sidecars[key].forEach((item, index) => {
        const path = `$.sidecars.${key}[${index}]`;
        push(errors, !declaredSidecarPaths.has(item), path, 'must be unique across all sidecar categories');
        declaredSidecarPaths.add(item);
        push(errors, declaredFilePaths.has(item), path, 'must name a hash-bound entry in $.files');
      });
    }
  }
  push(errors, Array.isArray(value.transformations), '$.transformations', 'must be an array');
  if (Array.isArray(value.transformations)) {
    value.transformations.forEach((item, index) => {
      const path = `$.transformations[${index}]`;
      push(errors, exactKeys(item, ['operation', 'parameters', 'parentSha256', 'childSha256']), path, 'must use the exact transformation shape');
      if (!object(item)) return;
      push(errors, string(item.operation, 1, 128), `${path}.operation`, 'is required');
      push(errors, object(item.parameters), `${path}.parameters`, 'must be an object');
      push(errors, SHA256_PATTERN.test(item.parentSha256), `${path}.parentSha256`, 'must be SHA-256');
      push(errors, SHA256_PATTERN.test(item.childSha256), `${path}.childSha256`, 'must be SHA-256');
    });
  }
  if (value.evidenceClass === 'derived' && value.status === 'captured') push(errors, value.transformations.length > 0, '$.transformations', 'derived evidence must declare its transforms');

  push(errors, exactKeys(value.applicability, ['metrics', 'excludedClaims']), '$.applicability', 'must use the exact applicability shape');
  if (object(value.applicability)) {
    push(errors, object(value.applicability.metrics) && Object.values(value.applicability.metrics).every((item) => ['eligible', 'diagnostic_only', 'not_available'].includes(item)), '$.applicability.metrics', 'must map metric IDs to eligible, diagnostic_only or not_available');
    push(errors, Array.isArray(value.applicability.excludedClaims) && value.applicability.excludedClaims.every((item) => string(item, 1, 1024)), '$.applicability.excludedClaims', 'must be a string array');
  }
  push(errors, string(value.expectedScenario, 1, 1024), '$.expectedScenario', 'is required');
  for (const key of ['observedDeviations', 'errors']) push(errors, Array.isArray(value[key]) && value[key].every((item) => string(item, 1, 2048)), `$.${key}`, 'must be a string array');
  push(errors, object(value.tools) && Object.values(value.tools).every((item) => nullableString(item, 512)), '$.tools', 'must be a string/null map');

  if (value.lane === 'public_reference') {
    push(errors, value.files.length === 0, '$.files', 'public-reference records must not redistribute media');
  }
  if (value.lane === 'controlled_competitor' && value.status === 'captured') {
    push(errors, value.rights.redistribution !== 'owned', '$.rights.redistribution', 'competitor media cannot be marked owned');
    push(errors, value.gameplay.inputMethod === 'human', '$.gameplay.inputMethod', 'must be human without competitor instrumentation');
  }
  return errors;
}

export function assertValidManifest(value, options = {}) {
  const errors = validateManifest(value, options);
  if (errors.length > 0) throw new Error(`Capture manifest validation failed:\n- ${errors.join('\n- ')}`);
  if (options.verifyMedia === true || (options.verifyMedia !== false && options.verifyFiles === true)) {
    if (!options.root) throw new Error('Media verification requires the manifest root');
    verifyManifestMedia(value, options.root, options.mediaProbeDependencies ?? {});
  }
  return value;
}

export function loadManifestEvidence(file, { verifyFiles = true, verifyMedia = verifyFiles, mediaProbeDependencies = {} } = {}) {
  const absolute = resolve(file);
  const value = readJson(absolute);
  assertValidManifest(value, { root: dirname(absolute), verifyFiles, verifyMedia: false });
  const mediaProbes = verifyMedia ? verifyManifestMedia(value, dirname(absolute), mediaProbeDependencies) : [];
  return { manifest: value, mediaProbes };
}

export function loadManifest(file, options = {}) {
  return loadManifestEvidence(file, options).manifest;
}

export function validateAnnotations(value, { durationMs = null, captureId = null } = {}) {
  const errors = [];
  push(errors, exactKeys(value, ['schemaVersion', 'captureId', 'annotator', 'source', 'events', 'adjudication']), '$', 'must be an exact annotation object');
  if (!object(value)) return errors;
  push(errors, value.schemaVersion === 1, '$.schemaVersion', 'must equal 1');
  push(errors, string(value.captureId, 8, 128), '$.captureId', 'is required');
  if (captureId !== null) push(errors, value.captureId === captureId, '$.captureId', `must equal ${captureId}`);
  push(errors, exactKeys(value.annotator, ['id', 'role', 'independentOfBuilder']), '$.annotator', 'must use the exact annotator shape');
  if (object(value.annotator)) {
    push(errors, string(value.annotator.id, 2, 128), '$.annotator.id', 'is required');
    push(errors, ['primary', 'secondary', 'adjudicator'].includes(value.annotator.role), '$.annotator.role', 'is invalid');
    push(errors, typeof value.annotator.independentOfBuilder === 'boolean', '$.annotator.independentOfBuilder', 'must be boolean');
  }
  push(errors, exactKeys(value.source, ['mediaSha256', 'manifestSha256']), '$.source', 'must use the exact source shape');
  if (object(value.source)) {
    push(errors, SHA256_PATTERN.test(value.source.mediaSha256), '$.source.mediaSha256', 'must be SHA-256');
    push(errors, SHA256_PATTERN.test(value.source.manifestSha256), '$.source.manifestSha256', 'must be SHA-256');
  }
  push(errors, Array.isArray(value.events), '$.events', 'must be an array');
  const eventIds = new Set();
  if (Array.isArray(value.events)) value.events.forEach((event, index) => {
    const path = `$.events[${index}]`;
    push(errors, exactKeys(event, ['id', 'label', 'atMs', 'endMs', 'frame', 'confidence', 'ambiguous', 'region', 'value', 'note']), path, 'must use the exact event shape');
    if (!object(event)) return;
    push(errors, string(event.id, 1, 128) && /^[a-z0-9][a-z0-9._-]+$/.test(event.id), `${path}.id`, 'must be a stable lowercase identifier');
    push(errors, !eventIds.has(event.id), `${path}.id`, 'must be unique');
    eventIds.add(event.id);
    push(errors, string(event.label, 1, 128), `${path}.label`, 'is required');
    push(errors, finite(event.atMs, 0, durationMs ?? 3_600_000), `${path}.atMs`, 'is outside the capture duration');
    push(errors, event.endMs === null || finite(event.endMs, event.atMs, durationMs ?? 3_600_000), `${path}.endMs`, 'must be null or at/after atMs within duration');
    push(errors, event.frame === null || integer(event.frame, 0), `${path}.frame`, 'must be null or a non-negative frame');
    push(errors, finite(event.confidence, 0, 1), `${path}.confidence`, 'must be from 0 to 1');
    push(errors, typeof event.ambiguous === 'boolean', `${path}.ambiguous`, 'must be boolean');
    push(errors, event.region === null || exactKeys(event.region, ['x', 'y', 'width', 'height']), `${path}.region`, 'must be null or a normalized rectangle');
    if (object(event.region)) {
      for (const key of ['x', 'y', 'width', 'height']) push(errors, finite(event.region[key], 0, 1), `${path}.region.${key}`, 'must be from 0 to 1');
      push(errors, event.region.x + event.region.width <= 1 + Number.EPSILON, `${path}.region`, 'extends beyond the right edge');
      push(errors, event.region.y + event.region.height <= 1 + Number.EPSILON, `${path}.region`, 'extends beyond the bottom edge');
    }
    push(errors, event.value === null || typeof event.value === 'string' || typeof event.value === 'boolean' || finite(event.value), `${path}.value`, 'must be null, a finite number, string or boolean');
    push(errors, event.note === null || string(event.note, 1, 2048), `${path}.note`, 'must be null or a note');
  });
  push(errors, value.adjudication === null || exactKeys(value.adjudication, ['reviewedFiles', 'decisions']), '$.adjudication', 'must be null or an adjudication object');
  if (object(value.adjudication)) {
    push(errors, Array.isArray(value.adjudication.reviewedFiles) && value.adjudication.reviewedFiles.every((item) => SHA256_PATTERN.test(item)), '$.adjudication.reviewedFiles', 'must list annotation hashes');
    push(errors, Array.isArray(value.adjudication.decisions) && value.adjudication.decisions.every((item) => string(item, 1, 2048)), '$.adjudication.decisions', 'must be a string array');
    if (Array.isArray(value.adjudication.reviewedFiles)) {
      push(errors, value.adjudication.reviewedFiles.length >= 2, '$.adjudication.reviewedFiles', 'must include at least independent primary and secondary annotation hashes');
      push(errors, new Set(value.adjudication.reviewedFiles).size === value.adjudication.reviewedFiles.length, '$.adjudication.reviewedFiles', 'must not contain duplicate hashes');
    }
    if (Array.isArray(value.adjudication.decisions)) push(errors, value.adjudication.decisions.length > 0, '$.adjudication.decisions', 'must record at least one adjudication decision');
  }
  if (object(value.annotator)) {
    if (value.annotator.role === 'adjudicator') push(errors, object(value.adjudication), '$.adjudication', 'is mandatory for an adjudicator');
    else push(errors, value.adjudication === null, '$.adjudication', 'must be null for primary and secondary annotations');
  }
  return errors;
}

export function assertValidAnnotations(value, options = {}) {
  const errors = validateAnnotations(value, options);
  if (errors.length > 0) throw new Error(`Annotation validation failed:\n- ${errors.join('\n- ')}`);
  return value;
}

export function assertValidAnnotationsForManifest(value, manifest, { mediaProbes = null } = {}) {
  assertValidAnnotations(value, { captureId: manifest?.captureId ?? null });
  const mediaHash = value?.source?.mediaSha256;
  const matches = Array.isArray(manifest?.files)
    ? manifest.files.filter((item) => item?.mimeType?.startsWith('video/') && item.sha256 === mediaHash)
    : [];
  if (matches.length !== 1) throw new Error('Annotation source must resolve to exactly one hash-bound manifest video');
  const selected = matches[0];
  const transformationChildren = new Set(Array.isArray(manifest?.transformations)
    ? manifest.transformations.map((item) => item?.childSha256).filter((item) => typeof item === 'string')
    : []);
  if (manifest?.evidenceClass === 'raw' && (selected.raw !== true || transformationChildren.has(selected.sha256))) {
    throw new Error('Raw directional evidence must select an untransformed manifest video with raw=true');
  }
  let durationMs = selected.durationMs;
  let selectedProbe = null;
  if (mediaProbes !== null) {
    const probes = mediaProbes.filter((item) => item.sha256 === mediaHash && item.path === selected.path);
    if (probes.length !== 1) throw new Error('Annotation source must resolve to exactly one fresh hash-bound media probe');
    [selectedProbe] = probes;
    durationMs = selectedProbe.observation?.durationMs;
  }
  if (Array.isArray(value.events) && value.events.length > 0 && !(typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0)) {
    throw new Error('Timecoded annotations require a positive probed duration on the hash-bound source video');
  }
  const validated = assertValidAnnotations(value, { durationMs: durationMs ?? null, captureId: manifest.captureId });
  const audioEvents = Array.isArray(value.events) ? value.events.filter((item) => item?.label === 'impact_audio') : [];
  if (audioEvents.length > 0) {
    if (manifest?.capture?.audio?.synchronized !== true) throw new Error('impact_audio annotations require a synchronized-audio capture claim');
    if (!selectedProbe) throw new Error('impact_audio annotations require a fresh hash-bound audio-coverage probe');
    const coverage = selectedProbe.observation?.audioCoverage;
    for (const event of audioEvents) {
      const atUs = Math.round(event.atMs * 1_000);
      if (!Array.isArray(coverage) || !coverage.some((item) => Number.isSafeInteger(item.startUs) && Number.isSafeInteger(item.endUs) && item.startUs <= atUs && atUs <= item.endUs)) {
        throw new Error(`impact_audio annotation ${event.id} lies outside proven decoded audio coverage`);
      }
    }
  }
  return validated;
}

export function validateMetrics(value) {
  const errors = [];
  const required = ['schemaVersion', 'analysisVersion', 'captureId', 'manifestSha256', 'generatedAtUtc', 'lane', 'evidenceClass', 'scenario', 'evaluator', 'integrity', 'measurements', 'ceriEvidence'];
  push(errors, exactKeys(value, required), '$', 'must be an exact metrics object');
  if (!object(value)) return errors;
  push(errors, value.schemaVersion === METRICS_SCHEMA_VERSION, '$.schemaVersion', `must equal ${METRICS_SCHEMA_VERSION}`);
  push(errors, value.analysisVersion === ANALYSIS_VERSION, '$.analysisVersion', `must equal ${ANALYSIS_VERSION}`);
  push(errors, string(value.captureId, 8, 128), '$.captureId', 'is required');
  push(errors, SHA256_PATTERN.test(value.manifestSha256), '$.manifestSha256', 'must be SHA-256');
  push(errors, isoUtc(value.generatedAtUtc), '$.generatedAtUtc', 'must be UTC ISO');
  push(errors, CAPTURE_LANES.has(value.lane), '$.lane', 'is invalid');
  push(errors, EVIDENCE_CLASSES.has(value.evidenceClass), '$.evidenceClass', 'is invalid');
  push(errors, string(value.scenario, 1, 1024), '$.scenario', 'is required');
  push(errors, exactKeys(value.evaluator, ['id', 'authoredTooling', 'independentOfSubject']), '$.evaluator', 'must use the exact evaluator shape');
  if (object(value.evaluator)) {
    push(errors, string(value.evaluator.id, 2, 128), '$.evaluator.id', 'is required');
    push(errors, typeof value.evaluator.authoredTooling === 'boolean', '$.evaluator.authoredTooling', 'must be boolean');
    push(errors, typeof value.evaluator.independentOfSubject === 'boolean', '$.evaluator.independentOfSubject', 'must be boolean');
    if (value.evaluator.authoredTooling === true) push(errors, value.evaluator.independentOfSubject === false, '$.evaluator.independentOfSubject', 'cannot be true when the evaluator authored the tooling');
  }
  push(errors, exactKeys(value.integrity, ['status', 'rejections']), '$.integrity', 'must use the exact integrity shape');
  if (object(value.integrity)) {
    push(errors, ['passed', 'rejected', 'incomplete'].includes(value.integrity.status), '$.integrity.status', 'is invalid');
    push(errors, Array.isArray(value.integrity.rejections) && value.integrity.rejections.every((item) => string(item, 1, 2048)), '$.integrity.rejections', 'must be a string array');
  }
  push(errors, Array.isArray(value.measurements), '$.measurements', 'must be an array');
  const ids = new Set();
  if (Array.isArray(value.measurements)) value.measurements.forEach((measurement, index) => {
    const path = `$.measurements[${index}]`;
    push(errors, exactKeys(measurement, ['id', 'status', 'value', 'unit', 'sampleSize', 'uncertainty', 'timecodesMs', 'sources', 'limitations']), path, 'must use the exact measurement shape');
    if (!object(measurement)) return;
    push(errors, string(measurement.id, 1, 128) && /^[a-z][a-z0-9._-]+$/.test(measurement.id), `${path}.id`, 'is invalid');
    push(errors, !ids.has(measurement.id), `${path}.id`, 'must be unique');
    ids.add(measurement.id);
    push(errors, MEASUREMENT_STATUSES.has(measurement.status), `${path}.status`, 'is invalid');
    if (measurement.status === 'measured' || measurement.status === 'diagnostic_only') push(errors, finite(measurement.value) || typeof measurement.value === 'string' || typeof measurement.value === 'boolean', `${path}.value`, 'must hold a finite measured value');
    else push(errors, measurement.value === null, `${path}.value`, 'must be null when unavailable/not comparable');
    push(errors, measurement.unit === null || string(measurement.unit, 1, 64), `${path}.unit`, 'must be null or a unit');
    push(errors, integer(measurement.sampleSize, 0), `${path}.sampleSize`, 'must be a non-negative integer');
    push(errors, measurement.uncertainty === null || exactKeys(measurement.uncertainty, ['kind', 'value', 'unit', 'confidence']), `${path}.uncertainty`, 'must be null or exact uncertainty');
    if (object(measurement.uncertainty)) {
      push(errors, string(measurement.uncertainty.kind, 1, 128), `${path}.uncertainty.kind`, 'is required');
      push(errors, finite(measurement.uncertainty.value, 0), `${path}.uncertainty.value`, 'must be non-negative');
      push(errors, string(measurement.uncertainty.unit, 1, 64), `${path}.uncertainty.unit`, 'is required');
      push(errors, measurement.uncertainty.confidence === null || finite(measurement.uncertainty.confidence, 0, 1), `${path}.uncertainty.confidence`, 'must be null or from 0 to 1');
    }
    push(errors, Array.isArray(measurement.timecodesMs) && measurement.timecodesMs.every((item) => finite(item, 0)), `${path}.timecodesMs`, 'must be non-negative milliseconds');
    push(errors, Array.isArray(measurement.sources) && measurement.sources.every((item) => safeRelative(item)), `${path}.sources`, 'must be safe relative paths');
    if (measurement.status === 'measured' || measurement.status === 'diagnostic_only') push(errors, Array.isArray(measurement.sources) && measurement.sources.length > 0, `${path}.sources`, 'must identify at least one provenance source for an observed value');
    push(errors, Array.isArray(measurement.limitations) && measurement.limitations.every((item) => string(item, 1, 1024)), `${path}.limitations`, 'must be a string array');
  });
  push(errors, Array.isArray(value.ceriEvidence), '$.ceriEvidence', 'must be an array');
  if (Array.isArray(value.ceriEvidence)) value.ceriEvidence.forEach((entry, index) => {
    const path = `$.ceriEvidence[${index}]`;
    push(errors, exactKeys(entry, ['dimension', 'status', 'measurementIds', 'humanRequired', 'notes']), path, 'must use the exact CERI mapping shape');
    if (!object(entry)) return;
    push(errors, string(entry.dimension, 1, 128), `${path}.dimension`, 'is required');
    push(errors, ['evidence_available', 'partial', 'not_available'].includes(entry.status), `${path}.status`, 'is invalid');
    push(errors, Array.isArray(entry.measurementIds) && entry.measurementIds.every((item) => ids.has(item)), `${path}.measurementIds`, 'must refer to known measurements');
    push(errors, typeof entry.humanRequired === 'boolean', `${path}.humanRequired`, 'must be boolean');
    push(errors, Array.isArray(entry.notes) && entry.notes.every((item) => string(item, 1, 1024)), `${path}.notes`, 'must be a string array');
  });
  return errors;
}

export function assertValidMetrics(value) {
  const errors = validateMetrics(value);
  if (errors.length > 0) throw new Error(`Metrics validation failed:\n- ${errors.join('\n- ')}`);
  return value;
}

export function loadMetrics(file) {
  return assertValidMetrics(readJson(resolve(file)));
}

export function measurement(id, status, {
  value = null,
  unit = null,
  sampleSize = 0,
  uncertainty = null,
  timecodesMs = [],
  sources = [],
  limitations = [],
} = {}) {
  return { id, status, value, unit, sampleSize, uncertainty, timecodesMs, sources, limitations };
}

export function manifestDigest(file) {
  return sha256File(resolve(file));
}

export function relativeEvidencePath(fromFile, target) {
  const rel = relative(dirname(resolve(fromFile)), resolve(target)).split(sep).join('/');
  if (!safeRelative(rel)) throw new Error(`Evidence path cannot be represented safely: ${target}`);
  return rel;
}

export function safeId(prefix, utc = utcNow()) {
  return `${prefix}-${utc.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

export function mainGuard(main, label) {
  Promise.resolve()
    .then(main)
    .catch((error) => {
      process.stderr.write(`${label}: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
