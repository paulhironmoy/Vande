#!/usr/bin/env node
/**
 * Prints the golden pack and the golden samples embedded in VandeMotionPackEditModeTests.cs, from the reference
 * decoder vmp.ts. The pack is tiny and synthetic, so the EditMode test does not go stale when MOTION rebuilds the
 * shipped packs. It covers a codec-2 overlay with a mirror alias and bat.grip/dir/face tracks, and a codec-1 loop with
 * turning travel.
 *
 *   node scripts/motion/unity/test/golden.mjs
 */
import { encodePack, prepareClip } from '../../export.mjs';
import { BONE_COUNT, createPoseOut, parsePack, sampleMotion } from '../../vmp.ts';

function qa(ax, ay, az, deg) {
  const h = (deg * Math.PI) / 360;
  const l = Math.hypot(ax, ay, az);
  return [(ax / l) * Math.sin(h), (ay / l) * Math.sin(h), (az / l) * Math.sin(h), Math.cos(h)];
}
const r6 = (x) => Math.round(x * 1e6) / 1e6;
function clip(id, { loop, frames, rate, codec, overlay = false, boneMask = 'all', aliases = {}, quat, ground, hips, tracks = {} }) {
  const fr = { ground: [], hips: [], contacts: [], q: [] };
  for (let f = 0; f < frames; f++) {
    const u = f / (frames - 1);
    const row = [];
    for (let b = 0; b < BONE_COUNT; b++) row.push(...quat(b, u));
    fr.q.push(row);
    fr.ground.push(ground(u).map(r6));
    fr.hips.push(hips(u).map(r6));
    fr.contacts.push(loop || u < 0.5 ? 1 | 8 : 2 | 16);
  }
  const tr = {};
  for (const [n, t] of Object.entries(tracks)) tr[n] = { kind: t.kind, frames: Array.from({ length: frames }, (_, f) => t.fn(f / (frames - 1)).map(r6)) };
  return { format: 'VMS1', id, pack: 'golden', role: 'test', skeleton: 'VC17', sampleRate: rate, loop, mirrorable: true, overlay, codec, boneMask, speedMps: loop ? 1.5 : 0, cycleSteps: loop ? 2 : 0, markers: { mark: 0.05 }, mirrorAliases: aliases, frames: fr, tracks: tr };
}
const sources = [
  clip('g_overlay_r', {
    loop: false,
    frames: 4,
    rate: 30,
    codec: 2,
    overlay: true,
    boneMask: ['chest', 'upperArmR', 'forearmR', 'thighL'],
    aliases: { g_overlay_l: 'mirror' },
    quat: (b, u) => qa(-1, 0.3 * b, 0.2, 70 + 40 * u + b),
    ground: (u) => [0.02 * u, 0.1 * u, 5 * u],
    hips: (u) => [0.01, -0.03 * u, 0.02],
    tracks: {
      'bat.grip': { kind: 'position', fn: (u) => [0.03 + 0.1 * u, 0.75, 0.2] },
      'bat.dir': { kind: 'direction', fn: (u) => [-0.2, -0.97 + 0.01 * u, 0.1] },
      'bat.face': { kind: 'direction', fn: (u) => [Math.sin(u), 0, Math.cos(u)] },
    },
  }),
  clip('g_loop', {
    loop: true,
    frames: 5,
    rate: 20,
    codec: 1,
    quat: (b, u) => qa(0.2, 1, 0.1 * b, 20 * Math.sin(2 * Math.PI * u + b)),
    ground: (u) => [0.3 * u, 0.8 * u, 30 * u],
    hips: (u) => [0.01 * Math.sin(2 * Math.PI * u), -0.02, 0],
  }),
];
const bytes = encodePack(sources.map(prepareClip));
const pack = parsePack(bytes);
const f = (x) => (Object.is(x, -0) ? '-0.0' : String(x));
const lines = [];
lines.push(`// ${bytes.length} bytes`);
lines.push(`private const string GoldenPackBase64 = "${Buffer.from(bytes).toString('base64')}";`);
lines.push('// clip, t, scale, root xyz, ground x z yaw, contacts, bones 0..16 xyzw, bat grip xyz, dir xyz, face xyz (NaN = no bat)');
lines.push('private static readonly object[][] GoldenSamples =');
lines.push('{');
for (const [name, t, s] of [
  ['g_overlay_r', 0.05, 1],
  ['g_overlay_l', 0.05, 1],
  ['g_overlay_r', 0.123, 0.93],
  ['g_overlay_l', 9, 1],
  ['g_loop', 0.11, 1],
  ['g_loop', 0.2499999, 1],
  ['g_loop', 3.7, 1.0625],
  ['g_loop', -1.234, 1],
]) {
  const c = pack.clips.get(name);
  const o = createPoseOut();
  o.q.fill(0.5);
  const g = { x: 0, z: 0, yawDeg: 0 };
  const r = sampleMotion(c, t, o, g, s);
  const bat = o.bat ? [...o.bat.grip, ...o.bat.dir, ...o.bat.face] : Array(9).fill(NaN);
  const nums = [...o.root, g.x, g.z, g.yawDeg, r.contacts, ...Array.from(o.q), ...bat].map((x) => (Number.isNaN(x) ? 'double.NaN' : f(x)));
  lines.push(`    new object[] { "${name}", ${t}, ${s}, new double[] { ${nums.join(', ')} } },`);
}
lines.push('};');
console.log(lines.join('\n'));
