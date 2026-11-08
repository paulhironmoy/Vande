#!/usr/bin/env node
/**
 * Cross-check dumper for the C# VMP1 decoder (scripts/motion/unity/VandeMotionPack.cs).
 *
 * The reference decoder scripts/motion/vmp.ts decodes and samples every pack. This script writes the results to JSON,
 * and the C# harness (CrossCheck.cs) decodes the same bytes and compares.
 *
 *   node scripts/motion/unity/test/dump.mjs <outDir>
 *
 * Packs:
 * - shipped: every public/practice/motion/*.vmp. The script also checks that the Unity Resources/Motion copy is
 *   byte-identical.
 * - scratch: packs built in memory, with export.mjs buildPack, from assets-src/motion/<pack> sources that have no
 *   shipped pack yet. They are written only to <outDir>, never to the repo.
 * - synthetic: clips covering the format corners the shipped packs do not reach yet: an overlay and its mirrored
 *   alias, codec-1 loops with turning travel, hemisphere flips, bat.face, extra tracks, F = 2, and an empty pack.
 *
 * Per clip, the dump holds the decoded raw frames and samples at frame times, mid-frames, odd fractions, past both
 * ends, across loop wraps and at pseudo-random times, at body scales 1, 0.93 and 1.0625. Each sample starts from a
 * fresh pose (root and ground zero) whose rotations are prefilled with SENTINEL. That shows what an overlay leaves
 * alone, and an overlay without the hips leaves the root and ground too (MOTION-SPEC v1.2.3).
 *
 * Fuzz: deterministic corruptions (truncation, trailing bytes, flips and field edits, mostly with the total and CRC
 * re-fixed so the structural checks run), each with vmp.ts's outcome.
 *
 * This script reads only. It never writes outside <outDir>.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildPack, encodePack, listPacks, prepareClip, REPO_ROOT, UNITY_DIR, WEB_DIR } from '../../export.mjs';
import { BONE_COUNT, CONTACT, createPoseOut, crc32, parsePack, sampleMotion } from '../../vmp.ts';

const outDir = resolve(process.argv[2] ?? '');
if (!process.argv[2]) {
  console.error('usage: node scripts/motion/unity/test/dump.mjs <outDir>');
  process.exit(2);
}
mkdirSync(join(outDir, 'packs'), { recursive: true });
mkdirSync(join(outDir, 'dump'), { recursive: true });

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const SENTINEL = 0.5; // pose.q is prefilled with this before every sample (shows what an overlay leaves alone)

// Deterministic PRNG (mulberry32).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Synthetic sources (VMS1) ----------------------------------------------------------------------------------

function qa(ax, ay, az, deg) {
  const h = (deg * Math.PI) / 360;
  const l = Math.hypot(ax, ay, az);
  return [(ax / l) * Math.sin(h), (ay / l) * Math.sin(h), (az / l) * Math.sin(h), Math.cos(h)];
}
const unit = (v) => {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
};
const r6 = (x) => Math.round(x * 1e6) / 1e6;

function source({ id, loop = false, frames, rate, codec = 2, mirrorable = false, overlay = false, boneMask = 'all', aliases = {}, markers = {}, speedMps = 0, cycleSteps = 0, phase0LeftStrike = false, quat, ground, hips, contacts, tracks = {} }) {
  const fr = { ground: [], hips: [], contacts: [], q: [] };
  for (let f = 0; f < frames; f++) {
    const u = f / (frames - 1);
    const row = [];
    for (let b = 0; b < BONE_COUNT; b++) row.push(...quat(b, u, f));
    fr.q.push(row);
    fr.ground.push(ground(u).map(r6));
    fr.hips.push(hips(u).map(r6));
    fr.contacts.push(contacts(u, f));
  }
  if (loop) fr.contacts[frames - 1] = fr.contacts[0];
  const tr = {};
  for (const [name, t] of Object.entries(tracks)) {
    tr[name] = { kind: t.kind, frames: Array.from({ length: frames }, (_, f) => t.fn(f / (frames - 1)).map(r6)) };
  }
  return {
    format: 'VMS1',
    id,
    pack: 'synthetic',
    role: 'test',
    skeleton: 'VC17',
    sampleRate: rate,
    loop,
    mirrorable,
    overlay,
    codec,
    boneMask,
    speedMps,
    cycleSteps,
    phase0LeftStrike,
    markers,
    mirrorAliases: aliases,
    frames: fr,
    tracks: tr,
  };
}

const TAU = 2 * Math.PI;
function syntheticSources() {
  return [
    // An upper-body overlay with an asymmetric mask (its mirror alias drives the other side), every track kind,
    // bat.face, an unknown extra direction track that is deliberately not unit length, and a repeated marker time.
    source({
      id: 'syn_overlay_r',
      frames: 25,
      rate: 30,
      codec: 2,
      mirrorable: true,
      overlay: true,
      boneMask: ['spine', 'chest', 'neck', 'upperArmR', 'forearmR', 'handR', 'thighL'],
      aliases: { syn_overlay_l: 'mirror' },
      markers: { top: 0, release: 0.4, reach: 0.4, end: 0.8 },
      quat: (b, u) => qa(1, 0.3 * b, 0.1 + 0.05 * b, 40 * u + 3 * b),
      ground: (u) => [0.05 * u, 0.3 * u, 12 * u],
      hips: (u) => [0.01, -0.05 * u, 0.02 * u],
      contacts: (u) => (u < 0.5 ? CONTACT.footL | CONTACT.handR : CONTACT.footR | CONTACT.kneeL),
      tracks: {
        'bat.grip': { kind: 'position', fn: (u) => [0.02 + 0.1 * u, 0.78 - 0.2 * u, 0.25] },
        'bat.dir': { kind: 'direction', fn: (u) => unit([-0.17 * Math.cos(1.4 * u), -0.98, 0.09 + 0.3 * Math.sin(1.4 * u)]) },
        'bat.face': { kind: 'direction', fn: (u) => [Math.sin(1.2 * u), 0, Math.cos(1.2 * u)] },
        'ball.hand': { kind: 'position', fn: (u) => [0.3, 1.5 + 0.2 * u, -0.1 * u] },
        'zz.extra': { kind: 'direction', fn: (u) => [0.5, 0.5 - 0.3 * u, 0.5] },
      },
    }),
    // A turning codec-1 gait loop with travel (x, z, yaw) and its mirror alias.
    source({
      id: 'syn_turn_loop',
      loop: true,
      frames: 17,
      rate: 20,
      codec: 1,
      mirrorable: true,
      aliases: { syn_turn_loop_l: 'mirror' },
      markers: { strike: 0, strike2: 0.4 },
      speedMps: 1.17,
      cycleSteps: 2,
      phase0LeftStrike: true,
      quat: (b, u) => qa(0.2 + 0.1 * b, 1, 0.3, 25 * Math.sin(TAU * u + b)),
      ground: (u) => [0.4 * u, 1.1 * u, 35 * u],
      hips: (u) => [0.015 * Math.sin(TAU * u), 0.02 * Math.cos(TAU * u) - 0.02, 0.01 * Math.sin(2 * TAU * u)],
      contacts: (u) => (u < 0.5 ? CONTACT.footL : CONTACT.footR),
    }),
    // A one-shot whose smallest-three largest component changes sign between frames (consecutive stored quaternions
    // on opposite hemispheres), with yaw running from −170° to +310° and every contact bit used.
    source({
      id: 'syn_spin_oneshot',
      frames: 20,
      rate: 15,
      codec: 2,
      markers: { release: 0.5 },
      quat: (b, u) => qa(-1, -0.2 * b, 0.1, 70 + 40 * u),
      ground: (u) => [-0.3 * u, 0.8 * u, -170 + 480 * u],
      hips: (u) => [0.02 * u, -0.1 * u, 0.03],
      contacts: (u, f) => [0, 1, 2, 3, 4, 8, 16, 32, 64, 127, 85, 42][f % 12],
      tracks: { 'ball.hand': { kind: 'position', fn: (u) => [0.3 - u, 1.5, 0.2 * u] } },
    }),
    // The smallest clip: two frames, one stored bone (the rest identity), no ground, codec 1.
    source({
      id: 'syn_min',
      frames: 2,
      rate: 60,
      codec: 1,
      boneMask: ['hips'],
      quat: (b, u) => (b === 0 ? qa(0, 1, 0, 10 * u) : [0, 0, 0, 1]),
      ground: () => [0, 0, 0],
      hips: () => [0, 0, 0],
      contacts: () => 0,
    }),
    // A loop with a full 360° turn per cycle (40° per frame): the stored quaternion returns as −q at the seam.
    source({
      id: 'syn_flip_loop',
      loop: true,
      frames: 10,
      rate: 60,
      codec: 2,
      mirrorable: true,
      quat: (b, u) => qa(-1, 0.3, -0.2 * b, 360 * u + 10 * b),
      ground: () => [0, 0, 0],
      hips: () => [0, 0, 0],
      contacts: () => CONTACT.footL | CONTACT.footR,
    }),
  ];
}

// ---- Packs ----------------------------------------------------------------------------------------------------

const packs = [];
const shippedNames = new Set();
if (existsSync(WEB_DIR)) {
  for (const f of readdirSync(WEB_DIR).filter((x) => x.endsWith('.vmp')).sort()) {
    const name = f.replace(/\.vmp$/, '');
    shippedNames.add(name);
    const path = join(WEB_DIR, f);
    const bytes = new Uint8Array(readFileSync(path));
    const uni = join(UNITY_DIR, `${name}.bytes`);
    const unityCopy = existsSync(uni) ? (Buffer.from(readFileSync(uni)).equals(Buffer.from(bytes)) ? 'identical' : 'DIFFERENT') : 'missing';
    packs.push({ label: name, kind: 'shipped', path, bytes, unityCopy });
  }
}
const scratchErrors = [];
for (const name of listPacks()) {
  if (shippedNames.has(name)) continue;
  try {
    const bytes = buildPack(name);
    const path = join(outDir, 'packs', `scratch-${name}.vmp`);
    writeFileSync(path, bytes);
    packs.push({ label: `scratch-${name}`, kind: 'scratch', path, bytes });
  } catch (e) {
    scratchErrors.push({ pack: name, error: String(e.message ?? e) });
  }
}
{
  const bytes = encodePack(syntheticSources().map(prepareClip));
  const path = join(outDir, 'packs', 'synthetic.vmp');
  writeFileSync(path, bytes);
  packs.push({ label: 'synthetic', kind: 'synthetic', path, bytes });
  const empty = encodePack([]);
  const epath = join(outDir, 'packs', 'synthetic-empty.vmp');
  writeFileSync(epath, empty);
  packs.push({ label: 'synthetic-empty', kind: 'synthetic', path: epath, bytes: empty });
}

// ---- Sampling -------------------------------------------------------------------------------------------------

function sampleTimes(c, rand) {
  const d = c.duration;
  const r = c.rate;
  const F = c.frameCount;
  const ts = [];
  for (let f = 0; f <= F; f++) ts.push(f / r); // frame times; f = F is the end (one-shot) or the wrap (loop)
  for (let f = 0; f < F; f++) ts.push((f + 0.5) / r); // mid-frames
  for (let f = 0; f < F; f += 3) ts.push((f + 0.173) / r, (f + 0.5 + 1e-7) / r, (f + 0.5 - 1e-7) / r);
  ts.push(-3.5, -1, -0.25, -1e-7, 0, 1e-7, d - 1e-7, d, d + 1e-7, d + 0.5, 3.7 * d, 1000.123); // past the ends
  if (c.loop) for (const k of [1, 2, 3, 7, 40, -1, -2, -9]) ts.push(k * d - 0.5 / r, k * d - 1e-9, k * d, k * d + 1e-9, k * d + 0.25 / r);
  for (let i = 0; i < 40; i++) ts.push(-2 * d + rand() * 7 * d);
  return ts;
}

function refTracks(c, frame, scale) {
  // vmp.ts samples only the bat.* tracks; this extends its exact arithmetic to every track (positions × scale,
  // directions renormalised and unscaled, x negated for an alias), and is checked against vmp.ts's bat output below.
  const F = c.frameCount;
  let i0 = Math.floor(frame);
  if (i0 > F - 1) i0 = F - 1;
  const u = frame - i0;
  let i1 = i0 + 1;
  if (i1 >= F) i1 = c.loop ? 0 : F - 1;
  return c.tracks.map((A, k) => {
    let v = [0, 1, 2].map((e) => A[i0 * 3 + e] + (A[i1 * 3 + e] - A[i0 * 3 + e]) * u);
    if (c.trackKinds[k] === 1) v = v.map((x) => x * scale);
    else {
      // MOTION-SPEC v1.2.3: every direction track is renormalised after interpolation (a zero vector stays zero).
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      v = [v[0] / l, v[1] / l, v[2] / l];
    }
    if (c.mirrored) v[0] = -v[0];
    return v;
  });
}

let sampleTotal = 0;
let batRefChecks = 0;
function dumpPack(p) {
  const pack = parsePack(p.bytes);
  const rand = rng(0x5eed ^ p.bytes.length);
  const clips = [];
  for (const name of pack.names) {
    const c = pack.clips.get(name);
    const samples = [];
    const times = sampleTimes(c, rand);
    times.forEach((t, i) => {
      const scale = i % 5 === 3 ? 0.93 : i % 5 === 4 ? 1.0625 : 1;
      const out = createPoseOut();
      out.q.fill(SENTINEL);
      const g = { x: 0, z: 0, yawDeg: 0 };
      const r = sampleMotion(c, t, out, g, scale);
      const tracks = refTracks(c, r.frame, scale);
      if (out.bat) {
        const gi = c.trackNames.indexOf('bat.grip');
        const di = c.trackNames.indexOf('bat.dir');
        const fi = c.trackNames.indexOf('bat.face');
        for (let e = 0; e < 3; e++) {
          if (out.bat.grip[e] !== tracks[gi][e] || out.bat.dir[e] !== tracks[di][e]) throw new Error(`generic track reference disagrees with vmp.ts bat at ${name} t=${t}`);
          if (fi >= 0 && out.bat.face[e] !== tracks[fi][e]) throw new Error(`generic track reference disagrees with vmp.ts bat.face at ${name} t=${t}`);
        }
        batRefChecks++;
      }
      samples.push({
        t,
        s: scale,
        q: Array.from(out.q),
        root: out.root,
        ground: [g.x, g.z, g.yawDeg],
        contacts: r.contacts,
        frame: r.frame,
        tracks,
        bat: out.bat ? { grip: out.bat.grip, dir: out.bat.dir, ...(out.bat.face ? { face: out.bat.face } : {}) } : null,
      });
    });
    sampleTotal += samples.length;
    clips.push({
      name: c.name,
      mirrored: c.mirrored,
      source: c.source,
      flags: c.flags,
      rate: c.rate,
      frameCount: c.frameCount,
      boneMask: c.boneMask,
      codec: c.codec,
      duration: c.duration,
      speedMps: c.speedMps,
      travel: [c.travel.x, c.travel.z, c.travel.yawDeg],
      cycleSteps: c.cycleSteps,
      role: c.role,
      markers: Object.entries(c.markers),
      trackNames: c.trackNames,
      trackKinds: c.trackKinds,
      gaitRate: [0.8, 1.5, 3.3, 7.8].map((v) => [v, 0.95, gaitRateRef(c, v, 0.95)]),
      ground: Array.from(c.ground),
      hips: Array.from(c.hips),
      contactsRaw: Array.from(c.contacts),
      quats: Array.from(c.quats),
      tracksRaw: c.tracks.map((a) => Array.from(a)),
      samples,
    });
  }
  return { label: p.label, kind: p.kind, bytes: pack.bytes, crc: pack.crc, names: pack.names, clips };
}

function gaitRateRef(c, v, scale) {
  if (!(c.speedMps > 0)) return 1;
  return v / (scale * c.speedMps);
}

// ---- Fuzz -----------------------------------------------------------------------------------------------------

function applyOps(src, ops) {
  let b = Uint8Array.from(src);
  let fix = false;
  for (const op of ops) {
    if (op[0] === 't') b = b.slice(0, op[1]);
    else if (op[0] === 'a') {
      const n = new Uint8Array(b.length + op[1]);
      n.set(b);
      b = n;
    } else if (op[0] === 'x') b[op[1]] ^= op[2];
    else if (op[0] === 's') b[op[1]] = op[2];
    else if (op[0] === 'fix') fix = true;
    else throw new Error(`bad op ${op[0]}`);
  }
  if (fix) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (b.length >= 28) v.setUint32(24, b.length, true);
    if (b.length >= 32) v.setUint32(28, crc32(b, 32, b.length), true);
  }
  return b;
}

function outcome(bytes) {
  try {
    const pack = parsePack(bytes);
    // A small digest of an accepted (mutated) pack: names, and the sum of one sample per clip.
    let sum = 0;
    for (const name of pack.names) {
      const c = pack.clips.get(name);
      const out = createPoseOut();
      const g = { x: 0, z: 0, yawDeg: 0 };
      const r = sampleMotion(c, 0.37 * c.duration, out, g, 1);
      for (let i = 0; i < out.q.length; i++) sum += out.q[i];
      sum += out.root[0] + out.root[1] + out.root[2] + g.x + g.z + g.yawDeg + r.contacts;
    }
    return { ok: true, names: pack.names, sum };
  } catch (e) {
    if (!(e instanceof Error)) throw e;
    return { ok: false, error: e.message };
  }
}

function fuzzCases(p) {
  const src = p.bytes;
  const n = src.length;
  const rand = rng(0xf022 ^ n);
  const cases = [];
  const add = (ops) => cases.push({ ops, expect: outcome(applyOps(src, ops)) });
  // Truncation and trailing bytes, raw and with the header re-fixed.
  const lens = new Set();
  for (let L = 0; L <= Math.min(n - 1, 80); L++) lens.add(L);
  for (let L = Math.max(0, n - 40); L < n; L++) lens.add(L);
  for (let L = 0; L < n; L += 97) lens.add(L);
  for (const L of [...lens].sort((a, b) => a - b)) {
    add([['t', L]]);
    if (L >= 32) add([['t', L], ['fix']]);
  }
  add([['a', 1]]);
  add([['a', 7]]);
  add([['a', 1], ['fix']]);
  add([['a', 16], ['fix']]);
  // Every header byte (not covered by the CRC except its own field).
  for (let i = 0; i < Math.min(32, n); i++) for (const [k, v] of [['x', 1], ['x', 0x80], ['s', 0], ['s', 0xff]]) add([[k, i, v]]);
  // Structural bytes with the CRC re-fixed: the directory, every record's header, markers, descriptors and first
  // frames, and the string table.
  const pos = new Set();
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  if (n >= 32) {
    const count = view.getUint16(10, true);
    const strOff = view.getUint32(16, true);
    for (let i = 32; i < Math.min(n, 32 + count * 16); i++) pos.add(i);
    for (let e = 0; e < count; e++) {
      const at = 32 + e * 16;
      if (at + 16 > n || (view.getUint16(at + 2, true) & 1) === 1) continue;
      const off = view.getUint32(at + 4, true);
      if (off + 48 > n) continue;
      const markers = view.getUint16(off + 18, true);
      const tracks = view.getUint8(off + 17);
      const mask = view.getUint32(off + 12, true);
      let bones = 0;
      for (let b = 0; b < 17; b++) if ((mask >>> b) & 1) bones++;
      const stride = 14 + bones * (view.getUint8(off + 16) === 1 ? 4 : 6) + tracks * 6;
      const head = 48 + markers * 8 + tracks * 4;
      for (let i = off; i < Math.min(n, off + head + 2 * stride); i++) pos.add(i);
    }
    for (let i = strOff; i < n; i++) pos.add(i);
  }
  for (let k = 0; k < 400; k++) pos.add(32 + Math.floor(rand() * Math.max(1, n - 32)));
  for (const i of [...pos].sort((a, b) => a - b)) {
    if (i < 32 || i >= n) continue;
    for (const [k, v] of [['x', 1], ['x', 0x80], ['s', 0], ['s', 0xff]]) add([[k, i, v], ['fix']]);
  }
  // Without the CRC fix (must all fail the CRC), and multi-byte random edits with it.
  for (let k = 0; k < 60 && n > 32; k++) add([['x', 32 + Math.floor(rand() * (n - 32)), 1 + Math.floor(rand() * 255)]]);
  for (let k = 0; k < 200 && n > 32; k++) {
    const ops = [];
    for (let j = 0; j < 3; j++) ops.push(['s', 32 + Math.floor(rand() * (n - 32)), Math.floor(rand() * 256)]);
    ops.push(['fix']);
    add(ops);
  }
  return cases;
}

// ---- Write ----------------------------------------------------------------------------------------------------

const manifest = { generated: new Date().toISOString(), repo: REPO_ROOT, node: process.version, sentinel: SENTINEL, scratchErrors, packs: [] };
let fuzzTotal = 0;
for (const p of packs) {
  const dump = dumpPack(p);
  const dumpPath = join(outDir, 'dump', `${p.label}.json`);
  writeFileSync(dumpPath, JSON.stringify(dump));
  const cases = fuzzCases(p);
  fuzzTotal += cases.length;
  const fuzzPath = join(outDir, 'dump', `${p.label}.fuzz.json`);
  writeFileSync(fuzzPath, JSON.stringify({ label: p.label, cases }));
  manifest.packs.push({
    label: p.label,
    kind: p.kind,
    path: p.path,
    bytes: p.bytes.length,
    sha256: sha256(p.bytes),
    unityCopy: p.unityCopy ?? null,
    clips: dump.names.length,
    aliases: dump.clips.filter((c) => c.mirrored).length,
    samples: dump.clips.reduce((s, c) => s + c.samples.length, 0),
    fuzzCases: cases.length,
    fuzzRejected: cases.filter((c) => !c.expect.ok).length,
    dump: dumpPath,
    fuzz: fuzzPath,
  });
}
manifest.totals = { packs: packs.length, samples: sampleTotal, batRefChecks, fuzzCases: fuzzTotal };
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
for (const m of manifest.packs) console.log(`${m.label.padEnd(22)} ${m.kind.padEnd(9)} ${String(m.bytes).padStart(7)} B  clips ${String(m.clips).padStart(3)} (aliases ${m.aliases})  samples ${String(m.samples).padStart(5)}  fuzz ${m.fuzzCases} (${m.fuzzRejected} rejected)${m.unityCopy ? `  unity copy ${m.unityCopy}` : ''}`);
for (const e of scratchErrors) console.log(`scratch build skipped: ${e.pack}: ${e.error}`);
console.log(`total samples ${sampleTotal}, bat reference checks ${batRefChecks}, fuzz cases ${fuzzTotal}`);
