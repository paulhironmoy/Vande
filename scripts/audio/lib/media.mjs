/**
 * Sound-kit media I/O through free tools only (ffmpeg and ffprobe): probing, decoding, resampling, the shipped MP3
 * encoding, and measuring the shipped takes' format so new takes match it.
 *
 * The encoding is tools/process_takes.py's, which produced public/audio/cricket/applause-*.mp3:
 *   ffmpeg libmp3lame VBR -q:a 4, mono, 48 kHz, no metadata, Xing header, no ID3.
 * ffmpeg's Xing tag leaves LAME's quality field at 0, so -q:a 4 cannot be read back from a file. measureReference()
 * checks everything that can be read (codec, rate, channels, VBR, no ID3, the encoder tag), and every new take is
 * checked against it after encoding.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hitLoudness, integratedLufs, samplePeak } from './dsp.mjs';

function tool(name) {
  const env = process.env[`VANDE_${name.toUpperCase()}`];
  if (env) return env;
  for (const p of [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`]) if (existsSync(p)) return p;
  return name;
}
export const FFMPEG = tool('ffmpeg');
export const FFPROBE = tool('ffprobe');

/** The shipped encoder settings (tools/process_takes.py). */
export const MP3_ARGS = ['-c:a', 'libmp3lame', '-q:a', '4', '-map_metadata', '-1', '-write_xing', '1', '-id3v2_version', '0'];

function run(cmd, args, input) {
  const r = spawnSync(cmd, args, { input, maxBuffer: 1 << 30 });
  if (r.error) throw new Error(`${cmd}: ${r.error.message} (install ffmpeg, or set VANDE_${cmd.split('/').pop().toUpperCase()})`);
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${String(r.stderr).trim().split('\n').slice(-3).join(' | ')}`);
  return r.stdout;
}

export function toolVersions() {
  const first = (c) => String(run(c, ['-version'])).split('\n')[0];
  return { ffmpeg: first(FFMPEG), ffprobe: first(FFPROBE), node: process.version };
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** The first audio stream: codec, sample rate, channels, duration. */
export function probe(file) {
  const out = JSON.parse(String(run(FFPROBE, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,sample_rate,channels,duration:format=duration,format_name', '-of', 'json', file])));
  const s = out.streams?.[0];
  if (!s) throw new Error('no audio in this file');
  return { codec: s.codec_name, sampleRate: Number(s.sample_rate), channels: Number(s.channels), duration: Number(s.duration ?? out.format?.duration), format: out.format?.format_name };
}

const f32 = (buf) => new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

/** Every channel at the file's own rate (for the clipping check, which must see each channel before any mixing). */
export function decodeNative(file) {
  const p = probe(file);
  const raw = f32(run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:a:0', '-vn', '-f', 'f32le', '-c:a', 'pcm_f32le', '-']));
  const n = Math.floor(raw.length / p.channels);
  const channels = Array.from({ length: p.channels }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < p.channels; c++) channels[c][i] = raw[i * p.channels + c];
  return { ...p, channels };
}

/** The mean of the channels (mono), then resampled to `rate` by ffmpeg's default resampler when it differs. */
export function toMono(native, rate) {
  const n = native.channels[0].length;
  const mono = new Float32Array(n);
  for (const ch of native.channels) for (let i = 0; i < n; i++) mono[i] += ch[i] / native.channels.length;
  if (native.sampleRate === rate) return mono;
  return resample(mono, native.sampleRate, rate);
}

export function resample(mono, from, to) {
  const input = Buffer.from(mono.buffer, mono.byteOffset, mono.byteLength);
  return f32(run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'f32le', '-ar', String(from), '-ac', '1', '-i', '-', '-af', `aresample=${to}`, '-f', 'f32le', '-c:a', 'pcm_f32le', '-'], input));
}

/** Decodes any file to mono float at `rate` (as tools/process_takes.py does; ffmpeg trims the MP3 encoder delay). */
export function decodeMono(file, rate) {
  return f32(run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-c:a', 'pcm_f32le', '-']));
}

/** Encodes mono samples with the shipped settings; returns the bytes. */
export function encodeMp3(samples, rate, outFile) {
  const x = samples instanceof Float32Array ? samples : Float32Array.from(samples);
  const input = Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', String(rate), '-ac', '1', '-i', '-', ...MP3_ARGS, '-ar', String(rate), '-ac', '1', outFile], input);
  return readFileSync(outFile);
}

const MPEG1_RATES = [44100, 48000, 32000];

/** What the first MP3 frame says: MPEG version and layer, rate, channel mode, Xing (VBR) or Info (CBR), encoder tag. */
export function mp3Info(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const id3 = b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33;
  if (id3 || b[0] !== 0xff || (b[1] & 0xe0) !== 0xe0) return { ok: false, id3 };
  const version = (b[1] >> 3) & 3; // 3: MPEG-1
  const layer = (b[1] >> 1) & 3; // 1: Layer III
  const rate = version === 3 ? MPEG1_RATES[(b[2] >> 2) & 3] : null;
  const mode = (b[3] >> 6) & 3; // 3: mono
  const side = version === 3 ? (mode === 3 ? 17 : 32) : mode === 3 ? 9 : 17;
  const tagAt = 4 + side;
  const tag = String.fromCharCode(...b.subarray(tagAt, tagAt + 4));
  let encoder = null;
  let delay = null;
  let padding = null;
  if (tag === 'Xing' || tag === 'Info') {
    const flags = (b[tagAt + 4] << 24) | (b[tagAt + 5] << 16) | (b[tagAt + 6] << 8) | b[tagAt + 7];
    let at = tagAt + 8 + (flags & 1 ? 4 : 0) + (flags & 2 ? 4 : 0) + (flags & 4 ? 100 : 0) + (flags & 8 ? 4 : 0);
    encoder = String.fromCharCode(...b.subarray(at, at + 9)).replace(/\0+$/, '').trim();
    at += 21;
    delay = (b[at] << 4) | (b[at + 1] >> 4);
    padding = ((b[at + 1] & 0x0f) << 8) | b[at + 2];
  }
  return { ok: true, id3: false, mpeg1: version === 3, layer3: layer === 1, sampleRate: rate, mono: mode === 3, vbr: tag === 'Xing', tag, encoder, delay, padding };
}

/** The format every take must have, measured from the shipped files; throws when they disagree among themselves. */
export function measureReference(dir) {
  const files = readdirSync(dir).filter((f) => /^applause-\d+\.mp3$/.test(f)).sort();
  if (!files.length) throw new Error(`no shipped reference takes (applause-*.mp3) in ${dir}`);
  const takes = files.map((f) => {
    const bytes = readFileSync(join(dir, f));
    const info = mp3Info(bytes);
    const p = probe(join(dir, f));
    const x = decodeMono(join(dir, f), p.sampleRate);
    return { file: f, bytes: bytes.length, sha256: sha256(bytes), codec: p.codec, sampleRate: p.sampleRate, channels: p.channels, vbr: info.vbr, id3: info.id3, encoder: info.encoder, delay: info.delay, lufs: integratedLufs(x, p.sampleRate), hitLufs: hitLoudness(x, p.sampleRate), peak: samplePeak(x) };
  });
  const same = (k) => {
    const v = new Set(takes.map((t) => t[k]));
    if (v.size !== 1) throw new Error(`the shipped takes disagree on ${k}: ${[...v].join(', ')}`);
    return takes[0][k];
  };
  const lufs = takes.map((t) => t.lufs);
  return {
    dir,
    files: takes,
    codec: same('codec'),
    sampleRate: same('sampleRate'),
    channels: same('channels'),
    vbr: same('vbr'),
    id3: same('id3'),
    encoder: same('encoder'),
    lufs: lufs.reduce((s, v) => s + v, 0) / lufs.length,
    lufsRange: [Math.min(...lufs), Math.max(...lufs)],
    peakMax: Math.max(...takes.map((t) => t.peak)),
  };
}

/** Checks an encoded take against the reference format; returns the problems (empty when it matches). */
export function formatProblems(bytes, ref) {
  const i = mp3Info(bytes);
  const p = [];
  if (!i.ok) p.push(i.id3 ? 'has an ID3 tag' : 'not an MPEG audio frame');
  else {
    if (!i.mpeg1 || !i.layer3) p.push('not MPEG-1 Layer III');
    if (i.sampleRate !== ref.sampleRate) p.push(`rate ${i.sampleRate}, shipped ${ref.sampleRate}`);
    if (!i.mono !== (ref.channels !== 1)) p.push('channel count differs');
    if (i.vbr !== ref.vbr) p.push(i.vbr ? 'VBR, shipped CBR' : 'CBR, shipped VBR');
    if (i.encoder !== ref.encoder) p.push(`encoder tag ${i.encoder}, shipped ${ref.encoder} (another ffmpeg: valid, but not byte-reproducible with the shipped toolchain)`);
  }
  return p;
}

/** A mono 16-bit or 32-bit-float WAV (test signals and renders). */
export function wavBytes(channels, sr, { float = false } = {}) {
  const ch = Array.isArray(channels) ? channels : [channels];
  const n = ch[0].length;
  const bps = float ? 4 : 2;
  const b = Buffer.alloc(44 + n * ch.length * bps);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * ch.length * bps, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(float ? 3 : 1, 20);
  b.writeUInt16LE(ch.length, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * ch.length * bps, 28);
  b.writeUInt16LE(ch.length * bps, 32);
  b.writeUInt16LE(bps * 8, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * ch.length * bps, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (const c of ch) {
      if (float) b.writeFloatLE(c[i], o);
      else b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(c[i] * 32767))), o);
      o += bps;
    }
  }
  return b;
}

export function writeWav(file, channels, sr, opts) {
  writeFileSync(file, wavBytes(channels, sr, opts));
}
