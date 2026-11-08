/**
 * VMP1 motion packs: a strict decoder and a pure, deterministic sampler (MOTION-SPEC §5–§6).
 *
 * Renderer-neutral. A pack holds VMC1 clips authored on the canonical VC17 skeleton (the 17 bones of
 * src/render3d/core/skeleton.ts, in that order). Quaternions are local to the parent and relative to an identity rest,
 * so the web copies them into `bone.quaternion` (a `SampledPose.q`) and Unity into `joint.localRotation`, unchanged.
 *
 * This file is erasable TypeScript (no enums, namespaces or parameter properties), so Node runs it directly
 * (`node --test scripts/motion/*.test.mjs`) and it can be dropped into `src/` as is. No dependencies.
 */

export const VC17_BONES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'upperArmL',
  'forearmL',
  'handL',
  'upperArmR',
  'forearmR',
  'handR',
  'thighL',
  'shinL',
  'footL',
  'thighR',
  'shinR',
  'footR',
] as const;
export const BONE_COUNT = 17;

/** Left/right bone pairs by id (MOTION-SPEC §3). */
export const MIRROR_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [5, 8],
  [6, 9],
  [7, 10],
  [11, 14],
  [12, 15],
  [13, 16],
];

export const CONTACT = { footL: 1, footR: 2, handL: 4, handR: 8, kneeL: 16, kneeR: 32, body: 64 } as const;

export const FLAG_LOOP = 1;
export const FLAG_GROUND = 2;
export const FLAG_MIRRORABLE = 4;
export const FLAG_OVERLAY = 8;
export const FLAG_PHASE0_LEFT_STRIKE = 16;

export const PACK_HEADER_BYTES = 32;
export const DIR_ENTRY_BYTES = 16;
export const CLIP_HEADER_BYTES = 48;
export const MARKER_BYTES = 8;
export const TRACK_DESC_BYTES = 4;
export const FRAME_FIXED_BYTES = 14;
export const TRACK_KIND_POSITION = 1;
export const TRACK_KIND_DIRECTION = 2;

export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export const SKELETON_ID = fnv1a32(`VC17:${VC17_BONES.join(',')}`);

let crcTable: Uint32Array | null = null;
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function quatBytes(codec: number): number {
  if (codec === 1) return 4;
  if (codec === 2) return 6;
  throw new Error(`VMC1: unknown quaternion codec ${codec}`);
}

const SQRT1_2 = Math.SQRT1_2;

/** Decodes one smallest-three quaternion at `off` into out[o..o+3] as (x, y, z, w). */
export function decodeQuat(view: DataView, off: number, codec: number, out: Float32Array, o: number): void {
  let i: number;
  let a: number;
  let b: number;
  let c: number;
  let max: number;
  if (codec === 1) {
    const v = view.getUint32(off, true);
    i = v >>> 30;
    a = (v >>> 20) & 1023;
    b = (v >>> 10) & 1023;
    c = v & 1023;
    max = 1023;
  } else {
    const w0 = view.getUint16(off, true);
    const w1 = view.getUint16(off + 2, true);
    const w2 = view.getUint16(off + 4, true);
    if (w2 & 0x8000) throw new Error('VMC1: codec-2 quaternion has a stray bit');
    i = ((w0 >>> 15) & 1) | (((w1 >>> 15) & 1) << 1);
    a = w0 & 0x7fff;
    b = w1 & 0x7fff;
    c = w2;
    max = 32767;
  }
  const ca = ((a / max) * 2 - 1) * SQRT1_2;
  const cb = ((b / max) * 2 - 1) * SQRT1_2;
  const cc = ((c / max) * 2 - 1) * SQRT1_2;
  const big = Math.sqrt(Math.max(0, 1 - ca * ca - cb * cb - cc * cc));
  const rest = [ca, cb, cc];
  const q = [0, 0, 0, 0];
  let k = 0;
  for (let j = 0; j < 4; j++) {
    if (j === i) q[j] = big;
    else {
      q[j] = rest[k];
      k++;
    }
  }
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  out[o] = q[0] / l;
  out[o + 1] = q[1] / l;
  out[o + 2] = q[2] / l;
  out[o + 3] = q[3] / l;
}

export interface MotionClip {
  name: string;
  /** True for a mirror alias: samples its source through the canonical mirror. */
  mirrored: boolean;
  source: string;
  flags: number;
  loop: boolean;
  overlay: boolean;
  mirrorable: boolean;
  rate: number;
  frameCount: number;
  boneMask: number;
  codec: number;
  duration: number;
  speedMps: number;
  travel: { x: number; z: number; yawDeg: number };
  cycleSteps: number;
  role: string;
  markers: Record<string, number>;
  trackNames: string[];
  trackKinds: number[];
  /** F × 3: ground x, z (m) and yaw (deg), unmirrored source values. */
  ground: Float32Array;
  /** F × 3: hips offset x, y, z (m). */
  hips: Float32Array;
  contacts: Uint8Array;
  /** F × 17 × 4 quaternions (x, y, z, w); identity for unmasked bones. */
  quats: Float32Array;
  /** One F × 3 array per track. */
  tracks: Float32Array[];
}

export interface MotionPack {
  bytes: number;
  crc: number;
  clips: Map<string, MotionClip>;
  names: string[];
}

class Reader {
  view: DataView;
  off: number;
  constructor(view: DataView, off: number) {
    this.view = view;
    this.off = off;
  }
  need(n: number): void {
    if (n < 0 || this.off + n > this.view.byteLength) throw new Error('VMP1: truncated');
  }
  u8(): number {
    this.need(1);
    return this.view.getUint8(this.off++);
  }
  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.off, true);
    this.off += 2;
    return v;
  }
  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.off, true);
    this.off += 2;
    return v;
  }
  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.off, true);
    this.off += 4;
    return v;
  }
  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.off, true);
    this.off += 4;
    if (!Number.isFinite(v)) throw new Error('VMP1: non-finite float');
    return v;
  }
  tag(): string {
    this.need(4);
    let s = '';
    for (let i = 0; i < 4; i++) s += String.fromCharCode(this.view.getUint8(this.off + i));
    this.off += 4;
    return s;
  }
}

export function popcount(v: number): number {
  let n = 0;
  for (let i = 0; i < 32; i++) if ((v >>> i) & 1) n++;
  return n;
}

function readStrings(view: DataView, off: number, bytes: number): string[] {
  const r = new Reader(view, off);
  const count = r.u16();
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const len = r.u16();
    r.need(len);
    let s = '';
    for (let k = 0; k < len; k++) {
      const ch = view.getUint8(r.off + k);
      if (ch < 0x20 || ch > 0x7e) throw new Error('VMP1: non-ASCII string');
      s += String.fromCharCode(ch);
    }
    r.off += len;
    out.push(s);
  }
  if (r.off !== off + bytes) throw new Error('VMP1: string table length mismatch');
  if (out[0] !== '') throw new Error('VMP1: string 0 must be empty');
  return out;
}

function str(strings: string[], i: number): string {
  if (i >= strings.length) throw new Error('VMP1: string index out of range');
  return strings[i];
}

function decodeClip(view: DataView, off: number, bytes: number, strings: string[]): MotionClip {
  const r = new Reader(view, off);
  if (r.tag() !== 'VMC1') throw new Error('VMC1: bad magic');
  const name = str(strings, r.u16());
  const flags = r.u16();
  if (flags & ~31) throw new Error('VMC1: unknown flags');
  const rate = r.u16();
  if (rate !== 15 && rate !== 20 && rate !== 30 && rate !== 60) throw new Error('VMC1: unsupported sample rate');
  const frameCount = r.u16();
  if (frameCount < 2) throw new Error('VMC1: too few frames');
  const boneMask = r.u32();
  if (boneMask === 0 || boneMask >>> BONE_COUNT !== 0) throw new Error('VMC1: bad bone mask');
  const codec = r.u8();
  const qb = quatBytes(codec);
  const trackCount = r.u8();
  const markerCount = r.u16();
  const duration = r.f32();
  const speedMps = r.f32();
  const tx = r.f32();
  const tz = r.f32();
  const tyaw = r.f32();
  const cycleSteps = r.f32();
  const role = str(strings, r.u16());
  if (r.u16() !== 0) throw new Error('VMC1: reserved field set');
  const loop = (flags & FLAG_LOOP) !== 0;
  const want = loop ? frameCount / rate : (frameCount - 1) / rate;
  if (Math.abs(duration - want) > 1e-4) throw new Error('VMC1: duration disagrees with frames');
  const markers: Record<string, number> = {};
  for (let i = 0; i < markerCount; i++) {
    const mn = str(strings, r.u16());
    if (r.u16() !== 0) throw new Error('VMC1: reserved marker field set');
    const t = r.f32();
    if (t < -1e-6 || t > duration + 1e-6) throw new Error(`VMC1: marker ${mn} outside the clip`);
    markers[mn] = t;
  }
  const trackNames: string[] = [];
  const trackKinds: number[] = [];
  for (let i = 0; i < trackCount; i++) {
    trackNames.push(str(strings, r.u16()));
    const kind = r.u16();
    if (kind !== TRACK_KIND_POSITION && kind !== TRACK_KIND_DIRECTION) throw new Error('VMC1: unknown track kind');
    trackKinds.push(kind);
  }
  const bones: number[] = [];
  for (let b = 0; b < BONE_COUNT; b++) if ((boneMask >>> b) & 1) bones.push(b);
  const stride = FRAME_FIXED_BYTES + bones.length * qb + trackCount * 6;
  if (r.off - off + stride * frameCount !== bytes) throw new Error('VMC1: record length mismatch');
  r.need(stride * frameCount);
  const ground = new Float32Array(frameCount * 3);
  const hips = new Float32Array(frameCount * 3);
  const contacts = new Uint8Array(frameCount);
  const quats = new Float32Array(frameCount * BONE_COUNT * 4);
  const tracks = trackNames.map(() => new Float32Array(frameCount * 3));
  for (let f = 0; f < frameCount; f++) {
    ground[f * 3] = r.i16() / 1000;
    ground[f * 3 + 1] = r.i16() / 1000;
    ground[f * 3 + 2] = r.i16() / 100;
    hips[f * 3] = r.i16() / 1000;
    hips[f * 3 + 1] = r.i16() / 1000;
    hips[f * 3 + 2] = r.i16() / 1000;
    contacts[f] = r.u8();
    if (contacts[f] & 0x80) throw new Error('VMC1: unknown contact bit');
    if (r.u8() !== 0) throw new Error('VMC1: reserved frame byte set');
    const base = f * BONE_COUNT * 4;
    for (let b = 0; b < BONE_COUNT; b++) quats[base + b * 4 + 3] = 1;
    for (const b of bones) {
      decodeQuat(view, r.off, codec, quats, base + b * 4);
      r.off += qb;
    }
    for (let k = 0; k < trackCount; k++) {
      const s = trackKinds[k] === TRACK_KIND_POSITION ? 1000 : 32767;
      tracks[k][f * 3] = r.i16() / s;
      tracks[k][f * 3 + 1] = r.i16() / s;
      tracks[k][f * 3 + 2] = r.i16() / s;
    }
  }
  return {
    name,
    mirrored: false,
    source: name,
    flags,
    loop,
    overlay: (flags & FLAG_OVERLAY) !== 0,
    mirrorable: (flags & FLAG_MIRRORABLE) !== 0,
    rate,
    frameCount,
    boneMask,
    codec,
    duration,
    speedMps,
    travel: { x: tx, z: tz, yawDeg: tyaw },
    cycleSteps,
    role,
    markers,
    trackNames,
    trackKinds,
    ground,
    hips,
    contacts,
    quats,
    tracks,
  };
}

/** Parses and validates a whole pack. Throws on any structural error (never returns a partial pack). */
export function parsePack(input: ArrayBuffer | Uint8Array): MotionPack {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.byteLength < PACK_HEADER_BYTES) throw new Error('VMP1: truncated');
  const r = new Reader(view, 0);
  if (r.tag() !== 'VMP1') throw new Error('VMP1: bad magic');
  if (r.u16() !== 1) throw new Error('VMP1: unsupported version');
  if (r.u16() !== PACK_HEADER_BYTES) throw new Error('VMP1: unsupported header');
  if (r.u16() !== BONE_COUNT) throw new Error('VMP1: not a VC17 pack');
  const clipCount = r.u16();
  if (r.u32() !== SKELETON_ID) throw new Error('VMP1: skeleton id mismatch');
  const strOff = r.u32();
  const strBytes = r.u32();
  const total = r.u32();
  const crc = r.u32();
  if (total !== u8.byteLength) throw new Error('VMP1: length mismatch');
  if (crc32(u8, PACK_HEADER_BYTES, total) !== crc) throw new Error('VMP1: CRC mismatch');
  if (strOff + strBytes !== total) throw new Error('VMP1: string table must end the pack');
  const strings = readStrings(view, strOff, strBytes);
  const entries: Array<{ name: string; alias: boolean; off: number; bytes: number; source: string }> = [];
  for (let i = 0; i < clipCount; i++) {
    const name = str(strings, r.u16());
    const ef = r.u16();
    if (ef & ~1) throw new Error('VMP1: unknown entry flags');
    const off = r.u32();
    const bytes = r.u32();
    const src = r.u16();
    if (r.u16() !== 0) throw new Error('VMP1: reserved entry field set');
    const alias = (ef & 1) === 1;
    if (alias !== (src !== 0xffff)) throw new Error('VMP1: alias entry inconsistent');
    if (off < PACK_HEADER_BYTES + clipCount * DIR_ENTRY_BYTES || off + bytes > strOff) throw new Error('VMP1: clip out of range');
    entries.push({ name, alias, off, bytes, source: alias ? str(strings, src) : name });
  }
  const clips = new Map<string, MotionClip>();
  const decoded = new Map<number, MotionClip>();
  let expect = PACK_HEADER_BYTES + clipCount * DIR_ENTRY_BYTES;
  for (const e of entries) {
    if (e.alias) continue;
    if (e.off !== expect) throw new Error('VMP1: clip records must be contiguous');
    const c = decodeClip(view, e.off, e.bytes, strings);
    if (c.name !== e.name) throw new Error('VMP1: directory name mismatch');
    decoded.set(e.off, c);
    if (clips.has(e.name)) throw new Error(`VMP1: duplicate clip ${e.name}`);
    clips.set(e.name, c);
    expect += e.bytes;
  }
  if (expect !== strOff) throw new Error('VMP1: undeclared bytes before the string table');
  for (const e of entries) {
    if (!e.alias) continue;
    const src = decoded.get(e.off);
    if (!src || src.name !== e.source) throw new Error(`VMP1: alias ${e.name} has no source`);
    const srcEntry = entries.find((x) => !x.alias && x.name === e.source);
    if (!srcEntry || srcEntry.bytes !== e.bytes) throw new Error(`VMP1: alias ${e.name} byte count differs from its source`);
    if (!src.mirrorable) throw new Error(`VMP1: alias ${e.name} mirrors a non-mirrorable clip`);
    if (clips.has(e.name)) throw new Error(`VMP1: duplicate clip ${e.name}`);
    clips.set(e.name, {
      ...src,
      name: e.name,
      mirrored: true,
      source: src.name,
      travel: { x: -src.travel.x, z: src.travel.z, yawDeg: -src.travel.yawDeg },
    });
  }
  return { bytes: total, crc, clips, names: entries.map((e) => e.name) };
}

/** The pose shape the web consumes (structurally a `SampledPose` from src/render3d/core/clips.ts). */
export interface PoseOut {
  q: Float32Array;
  root: [number, number, number];
  aimR: [number, number] | null;
  aimL: [number, number] | null;
  /** `face` (optional, MOTION-SPEC v1.2): the blade face's outward unit normal, present only when the clip has a
   * `bat.face` track. Readers that ignore it keep today's behaviour. */
  bat: { grip: [number, number, number]; dir: [number, number, number]; face?: [number, number, number] } | null;
  twoHands: boolean;
}

export interface GroundOut {
  x: number;
  z: number;
  yawDeg: number;
}

export function createPoseOut(): PoseOut {
  const q = new Float32Array(BONE_COUNT * 4);
  for (let i = 0; i < BONE_COUNT; i++) q[i * 4 + 3] = 1;
  return { q, root: [0, 0, 0], aimR: null, aimL: null, bat: null, twoHands: true };
}

function nlerpInto(src: Float32Array, a: number, b: number, u: number, out: Float32Array, o: number): void {
  let bx = src[b];
  let by = src[b + 1];
  let bz = src[b + 2];
  let bw = src[b + 3];
  const dot = src[a] * bx + src[a + 1] * by + src[a + 2] * bz + src[a + 3] * bw;
  if (dot < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  const x = src[a] + (bx - src[a]) * u;
  const y = src[a + 1] + (by - src[a + 1]) * u;
  const z = src[a + 2] + (bz - src[a + 2]) * u;
  const w = src[a + 3] + (bw - src[a + 3]) * u;
  const l = Math.hypot(x, y, z, w) || 1;
  out[o] = x / l;
  out[o + 1] = y / l;
  out[o + 2] = z / l;
  out[o + 3] = w / l;
}

const SWAP = new Int8Array(BONE_COUNT);
for (let i = 0; i < BONE_COUNT; i++) SWAP[i] = i;
for (const [a, b] of MIRROR_PAIRS) {
  SWAP[a] = b;
  SWAP[b] = a;
}

export function mirrorContacts(c: number): number {
  return (c & 0x40) | ((c & 1) << 1) | ((c & 2) >> 1) | ((c & 4) << 1) | ((c & 8) >> 1) | ((c & 16) << 1) | ((c & 32) >> 1);
}

export interface SampleResult {
  /** Contact bits at the nearer frame (already mirrored for an alias). */
  contacts: number;
  /** The frame position used (f = t · rate, wrapped or clamped). */
  frame: number;
}

const tmpQ = new Float32Array(BONE_COUNT * 4);

/**
 * Samples `clip` at `t` seconds (MOTION-SPEC §6): a pure function of (clip, t). Loops wrap and accumulate travel in
 * the ground track; one-shots clamp. Quaternions nlerp on one hemisphere. `scale` scales the hips offset and ground
 * (body scale); rotations never scale. For an overlay clip only masked bones are written.
 */
export function sampleMotion(clip: MotionClip, t: number, out: PoseOut, ground?: GroundOut, scale = 1): SampleResult {
  if (!Number.isFinite(t)) throw new Error('sampleMotion: non-finite time');
  const F = clip.frameCount;
  let cycles = 0;
  let time = t;
  if (clip.loop) {
    cycles = Math.floor(time / clip.duration);
    time -= cycles * clip.duration;
  } else time = Math.min(Math.max(time, 0), clip.duration);
  const f = Math.min(time * clip.rate, clip.loop ? F - 1e-9 : F - 1);
  let i0 = Math.floor(f);
  if (i0 > F - 1) i0 = F - 1;
  const u = f - i0;
  let i1 = i0 + 1;
  let wrap = 0;
  if (i1 >= F) {
    if (clip.loop) {
      i1 = 0;
      wrap = 1;
    } else i1 = F - 1;
  }
  const NB = BONE_COUNT;
  const q = clip.quats;
  const dst = clip.mirrored ? tmpQ : out.q;
  for (let b = 0; b < NB; b++) {
    if (clip.overlay && !((clip.boneMask >>> b) & 1)) continue;
    nlerpInto(q, (i0 * NB + b) * 4, (i1 * NB + b) * 4, u, dst, b * 4);
  }
  const h = clip.hips;
  let hx = h[i0 * 3] + (h[i1 * 3] - h[i0 * 3]) * u;
  const hy = h[i0 * 3 + 1] + (h[i1 * 3 + 1] - h[i0 * 3 + 1]) * u;
  const hz = h[i0 * 3 + 2] + (h[i1 * 3 + 2] - h[i0 * 3 + 2]) * u;
  const g = clip.ground;
  const tr = clip.travel;
  // Unmirrored source travel (an alias stores its mirrored travel; undo that before mixing with source frames).
  const stx = clip.mirrored ? -tr.x : tr.x;
  const styaw = clip.mirrored ? -tr.yawDeg : tr.yawDeg;
  let gx = g[i0 * 3] + (g[i1 * 3] + wrap * stx - g[i0 * 3]) * u + cycles * stx;
  const gz = g[i0 * 3 + 1] + (g[i1 * 3 + 1] + wrap * tr.z - g[i0 * 3 + 1]) * u + cycles * tr.z;
  let gyaw = g[i0 * 3 + 2] + (g[i1 * 3 + 2] + wrap * styaw - g[i0 * 3 + 2]) * u + cycles * styaw;
  let contacts = clip.contacts[u < 0.5 ? i0 : i1];
  let bat: PoseOut['bat'] = null;
  const gi = clip.trackNames.indexOf('bat.grip');
  const di = clip.trackNames.indexOf('bat.dir');
  if (gi >= 0 && di >= 0) {
    const G = clip.tracks[gi];
    const D = clip.tracks[di];
    const lerp = (A: Float32Array, k: number) => A[i0 * 3 + k] + (A[i1 * 3 + k] - A[i0 * 3 + k]) * u;
    // Direction tracks are renormalised after interpolation (MOTION-SPEC v1.2.3).
    const dx = lerp(D, 0);
    const dy = lerp(D, 1);
    const dz = lerp(D, 2);
    const dl = Math.hypot(dx, dy, dz) || 1;
    bat = { grip: [lerp(G, 0) * scale, lerp(G, 1) * scale, lerp(G, 2) * scale], dir: [dx / dl, dy / dl, dz / dl] };
    const fi = clip.trackNames.indexOf('bat.face');
    if (fi >= 0) {
      const Fc = clip.tracks[fi];
      const fx = lerp(Fc, 0);
      const fy = lerp(Fc, 1);
      const fz = lerp(Fc, 2);
      const l = Math.hypot(fx, fy, fz) || 1;
      bat.face = [fx / l, fy / l, fz / l];
    }
  }
  if (clip.mirrored) {
    for (let b = 0; b < NB; b++) {
      if (clip.overlay && !((clip.boneMask >>> SWAP[b]) & 1)) continue;
      const s = SWAP[b] * 4;
      out.q[b * 4] = tmpQ[s];
      out.q[b * 4 + 1] = -tmpQ[s + 1];
      out.q[b * 4 + 2] = -tmpQ[s + 2];
      out.q[b * 4 + 3] = tmpQ[s + 3];
    }
    hx = -hx;
    gx = -gx;
    gyaw = -gyaw;
    contacts = mirrorContacts(contacts);
    if (bat) {
      const face = bat.face;
      bat = { grip: [-bat.grip[0], bat.grip[1], bat.grip[2]], dir: [-bat.dir[0], bat.dir[1], bat.dir[2]] };
      if (face) bat.face = [-face[0], face[1], face[2]];
    }
  }
  // An overlay whose mask leaves out the hips drives neither the root nor the ground (MOTION-SPEC v1.2.3).
  const drivesRoot = !clip.overlay || (clip.boneMask & 1) !== 0;
  if (drivesRoot) out.root = [hx * scale, hy * scale, hz * scale];
  out.aimR = null;
  out.aimL = null;
  out.bat = bat;
  out.twoHands = true;
  if (ground && drivesRoot) {
    ground.x = gx * scale;
    ground.z = gz * scale;
    ground.yawDeg = gyaw;
  }
  return { contacts, frame: f };
}

/** Speed-matched playback rate for a gait loop at ground speed v (m/s): MOTION-SPEC §6. */
export function gaitRate(clip: MotionClip, v: number, scale = 1): number {
  if (!(clip.speedMps > 0)) return 1;
  return v / (scale * clip.speedMps);
}
