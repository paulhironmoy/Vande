#!/usr/bin/env node
/**
 * Builds VMP1 motion packs from VMS1 source clips (MOTION-SPEC §4–§7), deterministically: the same sources always
 * give the same bytes. One pack per folder in assets-src/motion/<pack>/ (every *.vms.json in it). The web copy
 * (public/practice/motion/<pack>.vmp) and the Unity TextAsset copy
 * (unity/.../Presentation/Resources/Motion/<pack>.bytes) are byte-identical.
 *
 *   node scripts/motion/export.mjs                 build every pack
 *   node scripts/motion/export.mjs --pack fielder  build one pack
 *   node scripts/motion/export.mjs --check         verify the committed outputs match the sources (exit 1 if not)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  BONE_COUNT,
  CLIP_HEADER_BYTES,
  DIR_ENTRY_BYTES,
  FLAG_GROUND,
  FLAG_LOOP,
  FLAG_MIRRORABLE,
  FLAG_OVERLAY,
  FLAG_PHASE0_LEFT_STRIKE,
  FRAME_FIXED_BYTES,
  MARKER_BYTES,
  PACK_HEADER_BYTES,
  SKELETON_ID,
  TRACK_DESC_BYTES,
  TRACK_KIND_DIRECTION,
  TRACK_KIND_POSITION,
  VC17_BONES,
  crc32,
  quatBytes,
} from './vmp.ts';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SRC_DIR = join(REPO_ROOT, 'assets-src', 'motion');
export const WEB_DIR = join(REPO_ROOT, 'public', 'practice', 'motion');
export const UNITY_DIR = join(REPO_ROOT, 'unity', 'VandePractice', 'Assets', 'VandePractice', 'Runtime', 'Presentation', 'Resources', 'Motion');

/** Per-pack raw byte budgets (MOTION-SPEC §10). */
export const BUDGETS = Object.freeze({ locomotion: 40 * 1024, fielder: 72 * 1024, keeper: 40 * 1024, bowler: 72 * 1024, nonstriker: 48 * 1024, batter: 48 * 1024, batter_strokes: 48 * 1024, fielder_actions: 48 * 1024 });
export const RATES = Object.freeze([15, 20, 30, 60]);
/** Packs temporarily exempt from the naturalness gates while their owner fixes them (lead ruling, 2026-11-04). */
export const PENDING_FIX = Object.freeze([]);
const ID_RE = /^[a-z][a-z0-9_]*$/;
const NAME_RE = /^[a-z][a-zA-Z0-9_.]*$/;

const sha256 = (b) => createHash('sha256').update(b).digest('hex');

function fail(id, msg) {
  throw new Error(`VMS1 ${id}: ${msg}`);
}

function boneMaskOf(src) {
  if (src.boneMask === undefined || src.boneMask === 'all') return (1 << BONE_COUNT) - 1;
  if (!Array.isArray(src.boneMask)) fail(src.id, 'boneMask must be "all" or a list of bone names');
  let m = 0;
  for (const name of src.boneMask) {
    const i = VC17_BONES.indexOf(name);
    if (i < 0) fail(src.id, `unknown bone ${name}`);
    m |= 1 << i;
  }
  if (m === 0) fail(src.id, 'empty bone mask');
  return m >>> 0;
}

function quatAngleDeg(a, b) {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI;
}

/** Validates one VMS1 source and returns the normalised clip the encoder writes. */
export function prepareClip(src) {
  if (!src || src.format !== 'VMS1') fail(src?.id, 'not a VMS1 source');
  const id = src.id;
  if (typeof id !== 'string' || !ID_RE.test(id)) fail(id, 'id must be snake_case');
  if (src.skeleton !== 'VC17') fail(id, 'skeleton must be VC17');
  const rate = src.sampleRate;
  if (!RATES.includes(rate)) fail(id, `sampleRate must be one of ${RATES.join(', ')}`);
  const codec = src.codec ?? 2;
  quatBytes(codec);
  const loop = Boolean(src.loop);
  const fr = src.frames;
  const n = fr?.q?.length;
  if (!n || fr.ground.length !== n || fr.hips.length !== n || fr.contacts.length !== n) fail(id, 'frame arrays must have equal lengths');
  const mask = boneMaskOf(src);
  const q = fr.q.map((row, f) => {
    if (row.length !== BONE_COUNT * 4) fail(id, `frame ${f}: q needs ${BONE_COUNT * 4} numbers`);
    const out = [];
    for (let b = 0; b < BONE_COUNT; b++) {
      const v = row.slice(b * 4, b * 4 + 4);
      const l = Math.hypot(...v);
      if (!v.every(Number.isFinite) || Math.abs(l - 1) > 1e-3) fail(id, `frame ${f} bone ${VC17_BONES[b]}: not a unit quaternion`);
      out.push(v.map((x) => x / l));
    }
    return out;
  });
  let ground = fr.ground.map((g) => [g[0], g[1], g[2]]);
  let hips = fr.hips.map((h) => [h[0], h[1], h[2]]);
  let contacts = fr.contacts.map((c) => c | 0);
  let quats = q;
  const tracks = Object.entries(src.tracks ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, t]) => {
      if (!NAME_RE.test(name)) fail(id, `bad track name ${name}`);
      const kind = t.kind === 'position' ? TRACK_KIND_POSITION : t.kind === 'direction' ? TRACK_KIND_DIRECTION : fail(id, `track ${name}: unknown kind`);
      if (t.frames.length !== n) fail(id, `track ${name}: frame count`);
      return { name, kind, frames: t.frames.map((v) => [v[0], v[1], v[2]]) };
    });
  let travel;
  if (loop) {
    // A loop source carries its closing frame (frame F ≡ frame 0 + one cycle of travel); verify the seam, then drop it.
    if (n < 3) fail(id, 'a loop needs at least 3 frames including the closing frame');
    const a = 0;
    const z = n - 1;
    for (let b = 0; b < BONE_COUNT; b++) {
      const d = quatAngleDeg(quats[a][b], quats[z][b]);
      if (d > 0.5) fail(id, `loop seam: bone ${VC17_BONES[b]} differs by ${d.toFixed(2)}°`);
    }
    for (let k = 0; k < 3; k++) if (Math.abs(hips[a][k] - hips[z][k]) > 0.002) fail(id, 'loop seam: hips offset differs');
    travel = [ground[z][0] - ground[a][0], ground[z][1] - ground[a][1], ground[z][2] - ground[a][2]];
    if (contacts[a] !== contacts[z]) fail(id, 'loop seam: contacts differ');
    ground = ground.slice(0, z);
    hips = hips.slice(0, z);
    contacts = contacts.slice(0, z);
    quats = quats.slice(0, z);
    for (const t of tracks) t.frames = t.frames.slice(0, z);
  } else {
    travel = [ground[n - 1][0] - ground[0][0], ground[n - 1][1] - ground[0][1], ground[n - 1][2] - ground[0][2]];
  }
  const F = quats.length;
  if (F < 2 || F > 65535) fail(id, 'frame count out of range');
  // Yaw is stored continuous (never wrapped to +-180): readers interpolate it linearly (MOTION-SPEC v1.2.3).
  for (let f = 1; f < F; f++)
    if (Math.abs(ground[f][2] - ground[f - 1][2]) >= 90) fail(id, `ground yaw jumps ${ground[f - 1][2]} -> ${ground[f][2]} at frame ${f}: store it unwrapped`);
  if (loop && Math.abs(ground[0][2] + travel[2] - ground[F - 1][2]) >= 90) fail(id, 'ground yaw jumps across the loop seam: store it unwrapped');
  const duration = loop ? F / rate : (F - 1) / rate;
  for (const g of ground) {
    if (Math.abs(g[0]) > 32.767 || Math.abs(g[1]) > 32.767) fail(id, 'ground track beyond ±32.767 m');
    if (Math.abs(g[2]) > 327.67) fail(id, 'ground yaw beyond ±327.67°');
  }
  for (const h of hips) if (h.some((v) => Math.abs(v) > 32.767)) fail(id, 'hips offset beyond ±32.767 m');
  for (const c of contacts) if (c < 0 || c > 127) fail(id, 'contact bits out of range');
  const markers = Object.entries(src.markers ?? {})
    .map(([name, t]) => {
      if (!NAME_RE.test(name)) fail(id, `bad marker name ${name}`);
      if (!(t >= -1e-5 && t <= duration + 1e-5)) fail(id, `marker ${name} at ${t} is outside 0..${duration}`);
      return { name, t: Math.min(Math.max(t, 0), duration) };
    })
    .sort((a, b) => a.t - b.t || (a.name < b.name ? -1 : 1));
  const groundMoves = ground.some((g) => g[0] !== 0 || g[1] !== 0 || g[2] !== 0) || travel.some((v) => v !== 0);
  let flags = 0;
  if (loop) flags |= FLAG_LOOP;
  if (groundMoves) flags |= FLAG_GROUND;
  if (src.mirrorable) flags |= FLAG_MIRRORABLE;
  if (src.overlay) flags |= FLAG_OVERLAY;
  if (src.phase0LeftStrike) flags |= FLAG_PHASE0_LEFT_STRIKE;
  const aliases = Object.entries(src.mirrorAliases ?? {}).map(([alias, how]) => {
    if (how !== 'mirror') fail(id, `alias ${alias}: only "mirror" is supported`);
    if (!ID_RE.test(alias)) fail(id, `alias ${alias} must be snake_case`);
    if (!src.mirrorable) fail(id, `alias ${alias} needs a mirrorable clip`);
    return alias;
  });
  return {
    id,
    role: String(src.role ?? ''),
    rate,
    codec,
    loop,
    flags,
    mask,
    duration,
    speedMps: Number(src.speedMps ?? 0),
    cycleSteps: Number(src.cycleSteps ?? 0),
    travel,
    markers,
    tracks,
    ground,
    hips,
    contacts,
    quats,
    aliases,
  };
}

const MAX10 = 1023;
const MAX15 = 32767;

/** Smallest-three encoding (MOTION-SPEC §5.4). Returns the integer words for the codec. */
export function encodeQuat(qIn, codec) {
  const l = Math.hypot(qIn[0], qIn[1], qIn[2], qIn[3]);
  let q = qIn.map((v) => v / l);
  let i = 0;
  for (let k = 1; k < 4; k++) if (Math.abs(q[k]) > Math.abs(q[i])) i = k;
  if (q[i] < 0) q = q.map((v) => -v);
  const max = codec === 1 ? MAX10 : MAX15;
  const enc = (c) => Math.min(max, Math.max(0, Math.round(((c * Math.SQRT2 + 1) / 2) * max)));
  const rest = [];
  for (let k = 0; k < 4; k++) if (k !== i) rest.push(enc(q[k]));
  if (codec === 1) return [((i << 30) | (rest[0] << 20) | (rest[1] << 10) | rest[2]) >>> 0];
  return [((i & 1) << 15) | rest[0], ((i >> 1) << 15) | rest[1], rest[2]];
}

function i16(v, scale, what) {
  const x = Math.round(v * scale);
  if (x < -32767 || x > 32767) throw new Error(`${what} out of int16 range: ${v}`);
  return x;
}

class Writer {
  constructor(size) {
    this.u8 = new Uint8Array(size);
    this.view = new DataView(this.u8.buffer);
    this.off = 0;
  }
  tag(s) {
    for (let i = 0; i < 4; i++) this.u8[this.off + i] = s.charCodeAt(i);
    this.off += 4;
  }
  u8w(v) {
    this.view.setUint8(this.off, v);
    this.off += 1;
  }
  u16(v) {
    this.view.setUint16(this.off, v, true);
    this.off += 2;
  }
  i16w(v) {
    this.view.setInt16(this.off, v, true);
    this.off += 2;
  }
  u32(v) {
    this.view.setUint32(this.off, v >>> 0, true);
    this.off += 4;
  }
  f32(v) {
    this.view.setFloat32(this.off, v, true);
    this.off += 4;
  }
}

function clipBytes(c) {
  const bones = popcount(c.mask);
  const stride = FRAME_FIXED_BYTES + bones * quatBytes(c.codec) + c.tracks.length * 6;
  return CLIP_HEADER_BYTES + c.markers.length * MARKER_BYTES + c.tracks.length * TRACK_DESC_BYTES + c.quats.length * stride;
}

function popcount(v) {
  let n = 0;
  for (let i = 0; i < 32; i++) if ((v >>> i) & 1) n++;
  return n;
}

/** Encodes prepared clips (from `prepareClip`) into one VMP1 pack. Deterministic. */
export function encodePack(prepared) {
  const clips = [...prepared].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const strings = [''];
  const index = new Map([['', 0]]);
  const S = (s) => {
    if (!index.has(s)) {
      if (!/^[\x20-\x7e]*$/.test(s)) throw new Error(`non-ASCII string ${s}`);
      index.set(s, strings.length);
      strings.push(s);
    }
    return index.get(s);
  };
  const entries = [];
  for (const c of clips) {
    S(c.id);
    S(c.role);
    for (const m of c.markers) S(m.name);
    for (const t of c.tracks) S(t.name);
    entries.push({ name: c.id, alias: false, clip: c });
    for (const a of c.aliases) {
      S(a);
      entries.push({ name: a, alias: true, clip: c });
    }
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (let i = 1; i < entries.length; i++) if (entries[i].name === entries[i - 1].name) throw new Error(`duplicate clip id ${entries[i].name}`);
  if (entries.length > 65535 || strings.length > 65535) throw new Error('pack too large');
  const strBytes = 2 + strings.reduce((n, s) => n + 2 + s.length, 0);
  let off = PACK_HEADER_BYTES + entries.length * DIR_ENTRY_BYTES;
  const placed = new Map();
  for (const e of entries) {
    if (e.alias) continue;
    const bytes = clipBytes(e.clip);
    placed.set(e.clip.id, { off, bytes });
    off += bytes;
  }
  const strOff = off;
  const total = strOff + strBytes;
  const w = new Writer(total);
  w.tag('VMP1');
  w.u16(1);
  w.u16(PACK_HEADER_BYTES);
  w.u16(BONE_COUNT);
  w.u16(entries.length);
  w.u32(SKELETON_ID);
  w.u32(strOff);
  w.u32(strBytes);
  w.u32(total);
  w.u32(0); // CRC, patched below
  for (const e of entries) {
    const p = placed.get(e.clip.id);
    w.u16(S(e.name));
    w.u16(e.alias ? 1 : 0);
    w.u32(p.off);
    w.u32(p.bytes);
    w.u16(e.alias ? S(e.clip.id) : 0xffff);
    w.u16(0);
  }
  for (const e of entries) {
    if (e.alias) continue;
    const c = e.clip;
    const start = w.off;
    w.tag('VMC1');
    w.u16(S(c.id));
    w.u16(c.flags);
    w.u16(c.rate);
    w.u16(c.quats.length);
    w.u32(c.mask);
    w.u8w(c.codec);
    w.u8w(c.tracks.length);
    w.u16(c.markers.length);
    w.f32(c.duration);
    w.f32(c.speedMps);
    w.f32(c.travel[0]);
    w.f32(c.travel[1]);
    w.f32(c.travel[2]);
    w.f32(c.cycleSteps);
    w.u16(S(c.role));
    w.u16(0);
    for (const m of c.markers) {
      w.u16(S(m.name));
      w.u16(0);
      w.f32(m.t);
    }
    for (const t of c.tracks) {
      w.u16(S(t.name));
      w.u16(t.kind);
    }
    for (let f = 0; f < c.quats.length; f++) {
      w.i16w(i16(c.ground[f][0], 1000, `${c.id} ground x`));
      w.i16w(i16(c.ground[f][1], 1000, `${c.id} ground z`));
      w.i16w(i16(c.ground[f][2], 100, `${c.id} ground yaw`));
      for (let k = 0; k < 3; k++) w.i16w(i16(c.hips[f][k], 1000, `${c.id} hips`));
      w.u8w(c.contacts[f]);
      w.u8w(0);
      for (let b = 0; b < BONE_COUNT; b++) {
        if (!((c.mask >>> b) & 1)) continue;
        const words = encodeQuat(c.quats[f][b], c.codec);
        if (c.codec === 1) w.u32(words[0]);
        else for (const x of words) w.u16(x);
      }
      for (const t of c.tracks) {
        const s = t.kind === TRACK_KIND_POSITION ? 1000 : 32767;
        for (let k = 0; k < 3; k++) w.i16w(i16(t.frames[f][k], s, `${c.id} track ${t.name}`));
      }
    }
    if (w.off - start !== placed.get(c.id).bytes) throw new Error(`internal: ${c.id} size mismatch`);
  }
  if (w.off !== strOff) throw new Error('internal: string table offset mismatch');
  w.u16(strings.length);
  for (const s of strings) {
    w.u16(s.length);
    for (let i = 0; i < s.length; i++) w.u8w(s.charCodeAt(i));
  }
  if (w.off !== total) throw new Error('internal: total size mismatch');
  w.view.setUint32(28, crc32(w.u8, PACK_HEADER_BYTES, total), true);
  return w.u8;
}

export function listPacks(srcDir = SRC_DIR) {
  if (!existsSync(srcDir)) return [];
  return readdirSync(srcDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && readdirSync(join(srcDir, d.name)).some((f) => f.endsWith('.vms.json')))
    .map((d) => d.name)
    .sort();
}

export function loadSources(pack, srcDir = SRC_DIR) {
  const dir = join(srcDir, pack);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.vms.json'))
    .sort()
    .map((f) => {
      const src = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (src.pack !== pack) fail(src.id, `pack field "${src.pack}" does not match folder "${pack}"`);
      if (`${src.id}.vms.json` !== f) fail(src.id, `file name must be ${src.id}.vms.json`);
      return src;
    });
}

export function buildPack(pack, srcDir = SRC_DIR) {
  return encodePack(loadSources(pack, srcDir).map(prepareClip));
}

const guidOf = (key) => sha256(`vande-motion:${key}`).slice(0, 32);

export function unityMeta(pack, bytes) {
  return [
    'fileFormatVersion: 2',
    `guid: ${guidOf(pack)}`,
    'TextScriptImporter:',
    '  externalObjects: {}',
    `  userData: Original VANDE VMP1 motion pack "${pack}" (MOTION-SPEC); ${bytes.length} bytes; presentation only`,
    '  assetBundleName: ',
    '  assetBundleVariant: ',
    '',
  ].join('\n');
}

export function unityFolderMeta() {
  return ['fileFormatVersion: 2', `guid: ${guidOf('folder')}`, 'folderAsset: yes', 'DefaultImporter:', '  externalObjects: {}', '  userData: ', '  assetBundleName: ', '  assetBundleVariant: ', ''].join('\n');
}

export function describe(pack, bytes) {
  return { pack, bytes: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length, sha256: sha256(bytes), budget: BUDGETS[pack] ?? null };
}

async function main(argv) {
  const check = argv.includes('--check');
  const pi = argv.indexOf('--pack');
  const only = pi >= 0 ? argv[pi + 1] : null;
  const packs = listPacks().filter((p) => !only || p === only);
  if (only && packs.length === 0) throw new Error(`no sources for pack ${only}`);
  let bad = 0;
  const rows = [];
  for (const pack of packs) {
    const bytes = buildPack(pack);
    const d = describe(pack, bytes);
    rows.push(d);
    const web = join(WEB_DIR, `${pack}.vmp`);
    const uni = join(UNITY_DIR, `${pack}.bytes`);
    const meta = `${uni}.meta`;
    if (check) {
      for (const [path, want] of [
        [web, bytes],
        [uni, bytes],
        [meta, Buffer.from(unityMeta(pack, bytes))],
      ]) {
        if (!existsSync(path) || !Buffer.from(readFileSync(path)).equals(Buffer.from(want))) {
          console.error(`stale: ${path}`);
          bad++;
        }
      }
    } else {
      // An ungated pack never ships: refuse to write one whose clips fail the gates (MOTION-SPEC §9).
      const { measurePack } = await import('./metrics.mjs');
      const failing = measurePack(bytes).filter((r) => !r.passAll).map((r) => r.clip);
      if (failing.length && !PENDING_FIX.includes(pack)) {
        console.error(`refused: ${pack} has clips failing the gates: ${failing.join(', ')}`);
        bad++;
        continue;
      }
      if (failing.length) console.error(`WARNING: ${pack} ships under PENDING_FIX with failing clips: ${failing.join(', ')}`);
      mkdirSync(WEB_DIR, { recursive: true });
      mkdirSync(UNITY_DIR, { recursive: true });
      writeFileSync(web, bytes);
      writeFileSync(uni, bytes);
      writeFileSync(meta, unityMeta(pack, bytes));
      const folderMeta = `${UNITY_DIR}.meta`;
      if (!existsSync(folderMeta)) writeFileSync(folderMeta, unityFolderMeta());
    }
    if (d.budget !== null && d.bytes > d.budget) {
      console.error(`over budget: ${pack} ${d.bytes} B > ${d.budget} B`);
      bad++;
    }
  }
  for (const r of rows) console.log(`${r.pack.padEnd(11)} ${String(r.bytes).padStart(7)} B  gzip ${String(r.gzip).padStart(6)} B  sha256 ${r.sha256}`);
  if (bad) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
