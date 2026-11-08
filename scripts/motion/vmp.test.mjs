/**
 * VMP1 encoder/decoder round trip, determinism, strictness and mirror semantics (MOTION-SPEC §3, §5, §6).
 * Synthetic clips only, so this runs without any authored source.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodePack, encodeQuat, prepareClip } from './export.mjs';
import { BONE_COUNT, CONTACT, createPoseOut, decodeQuat, mirrorContacts, parsePack, sampleMotion, SKELETON_ID, fnv1a32 } from './vmp.ts';

function quatAxisAngle(ax, ay, az, deg) {
  const h = (deg * Math.PI) / 360;
  const l = Math.hypot(ax, ay, az);
  return [(ax / l) * Math.sin(h), (ay / l) * Math.sin(h), (az / l) * Math.sin(h), Math.cos(h)];
}

function synthetic({ id = 'test_clip', loop = false, frames = 31, rate = 30, codec = 2, mirrorable = true, aliases = {}, tracks } = {}) {
  const q = [];
  const ground = [];
  const hips = [];
  const contacts = [];
  for (let f = 0; f < frames; f++) {
    const u = f / (frames - 1);
    const row = [];
    for (let b = 0; b < BONE_COUNT; b++) row.push(...quatAxisAngle(1, 0.3 * b, 0.1, loop ? 20 * Math.sin(2 * Math.PI * u + b) : 40 * u + b));
    q.push(row);
    ground.push([0.1 * u, 1.5 * u, loop ? 0 : 10 * u]);
    hips.push([0.01, loop ? 0.02 * Math.cos(2 * Math.PI * u) : -0.05 * u, 0]);
    contacts.push(u < 0.5 ? CONTACT.footL | CONTACT.handR : CONTACT.footR);
  }
  if (loop) {
    contacts[frames - 1] = contacts[0];
  }
  return {
    format: 'VMS1',
    id,
    pack: 'test',
    role: 'fielder',
    skeleton: 'VC17',
    sampleRate: rate,
    loop,
    mirrorable,
    codec,
    speedMps: loop ? 1.5 * (rate / (frames - 1)) : 0,
    cycleSteps: loop ? 2 : 0,
    markers: { collect: 0.3 },
    mirrorAliases: aliases,
    frames: { ground, hips, contacts, q },
    ...(tracks ? { tracks } : {}),
  };
}

test('skeleton id is FNV-1a of the VC17 string', () => {
  assert.equal(SKELETON_ID, fnv1a32('VC17:hips,spine,chest,neck,head,upperArmL,forearmL,handL,upperArmR,forearmR,handR,thighL,shinL,footL,thighR,shinR,footR'));
});

test('smallest-three codecs round trip within their stated error', () => {
  const view = (words, codec) => {
    const b = new DataView(new ArrayBuffer(8));
    if (codec === 1) b.setUint32(0, words[0], true);
    else words.forEach((w, i) => b.setUint16(i * 2, w, true));
    return b;
  };
  const out = new Float32Array(4);
  let worst1 = 0;
  let worst2 = 0;
  for (let k = 0; k < 2000; k++) {
    const s = Math.sin(k * 12.9898) * 43758.5453;
    const q = quatAxisAngle(Math.sin(s), Math.cos(s * 1.3), Math.sin(s * 0.7 + 1), ((k * 37) % 360) - 180);
    for (const codec of [1, 2]) {
      decodeQuat(view(encodeQuat(q, codec), codec), 0, codec, out, 0);
      // Angle of conj(q)·out from its vector part (acos near 1 would add float32 noise).
      const [ax, ay, az, aw] = q;
      const [bx, by, bz, bw] = out;
      const vx = aw * bx - ax * bw - ay * bz + az * by;
      const vy = aw * by + ax * bz - ay * bw - az * bx;
      const vz = aw * bz - ax * by + ay * bx - az * bw;
      const deg = (2 * Math.asin(Math.min(1, Math.hypot(vx, vy, vz))) * 180) / Math.PI;
      if (codec === 1) worst1 = Math.max(worst1, deg);
      else worst2 = Math.max(worst2, deg);
    }
  }
  assert.ok(worst1 < 0.25, `codec 1 worst ${worst1}°`);
  console.log(`codec 1 worst ${worst1.toFixed(4)}°, codec 2 worst ${worst2.toFixed(5)}°`);
  assert.ok(worst2 < 0.01, `codec 2 worst ${worst2}°`);
});

test('encode → parse round trip, deterministic bytes, aliases and markers', () => {
  const a = prepareClip(synthetic({ aliases: { test_clip_l: 'mirror' } }));
  const b = prepareClip(synthetic({ id: 'loop_clip', loop: true, frames: 21, codec: 1 }));
  const bytes1 = encodePack([a, b]);
  const bytes2 = encodePack([b, a]);
  assert.deepEqual(Buffer.from(bytes1), Buffer.from(bytes2));
  const pack = parsePack(bytes1);
  assert.deepEqual([...pack.clips.keys()].sort(), ['loop_clip', 'test_clip', 'test_clip_l']);
  const c = pack.clips.get('test_clip');
  assert.equal(c.frameCount, 31);
  assert.ok(Math.abs(c.duration - 1) < 1e-6);
  assert.equal(c.markers.collect.toFixed(4), '0.3000');
  const loop = pack.clips.get('loop_clip');
  assert.equal(loop.frameCount, 20, 'closing frame dropped');
  assert.ok(Math.abs(loop.duration - 20 / 30) < 1e-6);
  assert.ok(Math.abs(loop.travel.z - 1.5) < 1e-6);
});

test('sampling: frame-exact values, loop travel accumulates, one-shots clamp', () => {
  const pack = parsePack(encodePack([prepareClip(synthetic({ id: 'loop_clip', loop: true, frames: 21 }))]));
  const c = pack.clips.get('loop_clip');
  const pose = createPoseOut();
  const g = { x: 0, z: 0, yawDeg: 0 };
  sampleMotion(c, 0, pose, g);
  const z0 = g.z;
  sampleMotion(c, c.duration * 2, pose, g);
  assert.ok(Math.abs(g.z - z0 - 3) < 2e-3, `two cycles travel 3 m (got ${g.z - z0})`);
  sampleMotion(c, c.duration * 0.999, pose, g);
  assert.ok(Math.abs(g.z - 1.5 * 0.999) < 0.01);
  const one = parsePack(encodePack([prepareClip(synthetic())])).clips.get('test_clip');
  const r = sampleMotion(one, 99, pose, g);
  assert.equal(r.frame, one.frameCount - 1);
  // Determinism: same t, same output, at any call cadence.
  const p1 = createPoseOut();
  const p2 = createPoseOut();
  sampleMotion(one, 0.4567, p1);
  for (let t = 0; t < 0.4567; t += 1 / 120) sampleMotion(one, t, p2);
  sampleMotion(one, 0.4567, p2);
  assert.deepEqual([...p1.q], [...p2.q]);
});

test('a mirror alias equals the canonical mirror of its source', () => {
  const pack = parsePack(encodePack([prepareClip(synthetic({ aliases: { test_clip_l: 'mirror' } }))]));
  const src = pack.clips.get('test_clip');
  const alias = pack.clips.get('test_clip_l');
  const a = createPoseOut();
  const b = createPoseOut();
  const ga = { x: 0, z: 0, yawDeg: 0 };
  const gb = { x: 0, z: 0, yawDeg: 0 };
  const ra = sampleMotion(src, 0.37, a, ga);
  const rb = sampleMotion(alias, 0.37, b, gb);
  const swap = [0, 1, 2, 3, 4, 8, 9, 10, 5, 6, 7, 14, 15, 16, 11, 12, 13];
  for (let i = 0; i < BONE_COUNT; i++) {
    const s = swap[i];
    assert.ok(Math.abs(b.q[i * 4] - a.q[s * 4]) < 1e-6);
    assert.ok(Math.abs(b.q[i * 4 + 1] + a.q[s * 4 + 1]) < 1e-6);
    assert.ok(Math.abs(b.q[i * 4 + 2] + a.q[s * 4 + 2]) < 1e-6);
    assert.ok(Math.abs(b.q[i * 4 + 3] - a.q[s * 4 + 3]) < 1e-6);
  }
  assert.ok(Math.abs(b.root[0] + a.root[0]) < 1e-9);
  assert.ok(Math.abs(gb.x + ga.x) < 1e-9 && Math.abs(gb.yawDeg + ga.yawDeg) < 1e-9);
  assert.equal(rb.contacts, mirrorContacts(ra.contacts));
  assert.equal(mirrorContacts(CONTACT.footL | CONTACT.handR | CONTACT.body), CONTACT.footR | CONTACT.handL | CONTACT.body);
});

test('bat tracks sample into SampledPose.bat (lower-hand grip) and mirror sideways', () => {
  const frames = 31;
  const grip = Array.from({ length: frames }, (_, f) => [0.02 + f * 0.001, 0.78, 0.25]);
  const dir = Array.from({ length: frames }, () => [-0.17, -0.98, 0.09]);
  const src = synthetic({ id: 'bat_test', aliases: { bat_test_l: 'mirror' }, tracks: { 'bat.grip': { kind: 'position', frames: grip }, 'bat.dir': { kind: 'direction', frames: dir } } });
  const pack = parsePack(encodePack([prepareClip(src)]));
  const p = createPoseOut();
  sampleMotion(pack.clips.get('bat_test'), 0, p);
  const n = Math.hypot(-0.17, -0.98, 0.09);
  assert.ok(p.bat && Math.abs(p.bat.grip[0] - 0.02) < 1e-3 && Math.abs(p.bat.dir[1] + 0.98 / n) < 1e-3);
  assert.ok(Math.abs(Math.hypot(...p.bat.dir) - 1) < 1e-6, 'direction tracks are renormalised');
  sampleMotion(pack.clips.get('bat_test_l'), 0, p);
  assert.ok(p.bat && Math.abs(p.bat.grip[0] + 0.02) < 1e-3 && Math.abs(p.bat.dir[0] - 0.17 / n) < 1e-3);
  assert.equal(p.bat.face, undefined, 'no bat.face track: readers behave as before');
});

test('an optional bat.face track samples as a unit normal and mirrors sideways (v1.2)', () => {
  const frames = 31;
  const grip = Array.from({ length: frames }, () => [0.02, 0.78, 0.25]);
  const dir = Array.from({ length: frames }, () => [-0.17, -0.98, 0.09]);
  const face = Array.from({ length: frames }, (_, f) => {
    const a = (f / (frames - 1)) * 1.2;
    return [Math.sin(a), 0, Math.cos(a)];
  });
  const src = synthetic({ id: 'face_test', aliases: { face_test_l: 'mirror' }, tracks: { 'bat.grip': { kind: 'position', frames: grip }, 'bat.dir': { kind: 'direction', frames: dir }, 'bat.face': { kind: 'direction', frames: face } } });
  const without = encodePack([prepareClip(synthetic({ id: 'face_test', aliases: { face_test_l: 'mirror' }, tracks: { 'bat.grip': { kind: 'position', frames: grip }, 'bat.dir': { kind: 'direction', frames: dir } } }))]);
  const bytes = encodePack([prepareClip(src)]);
  assert.equal(bytes.length - without.length, 4 + 6 * frames + 'bat.face'.length + 2, 'cost: a 4-byte descriptor, 6 bytes per frame and the name');
  const pack = parsePack(bytes);
  const p = createPoseOut();
  sampleMotion(pack.clips.get('face_test'), 0.5, p);
  assert.ok(p.bat?.face && Math.abs(Math.hypot(...p.bat.face) - 1) < 1e-6);
  assert.ok(Math.abs(p.bat.face[0] - Math.sin(0.6)) < 2e-3);
  sampleMotion(pack.clips.get('face_test_l'), 0.5, p);
  assert.ok(Math.abs(p.bat.face[0] + Math.sin(0.6)) < 2e-3);
});

test('the decoder rejects corruption, truncation and trailing bytes', () => {
  const bytes = encodePack([prepareClip(synthetic())]);
  const flipped = Uint8Array.from(bytes);
  flipped[100] ^= 1;
  assert.throws(() => parsePack(flipped), /CRC/);
  assert.throws(() => parsePack(bytes.slice(0, bytes.length - 1)), /length|truncated/);
  const longer = new Uint8Array(bytes.length + 1);
  longer.set(bytes);
  assert.throws(() => parsePack(longer), /length/);
  const magic = Uint8Array.from(bytes);
  magic[0] = 0x58;
  assert.throws(() => parsePack(magic), /magic/);
});

test('v1.2.3: overlays without hips leave root and ground alone; wrapped yaw is rejected', () => {
  const src = synthetic({ id: 'ov' });
  src.overlay = true;
  src.boneMask = ['spine', 'chest'];
  const c = parsePack(encodePack([prepareClip(src)])).clips.get('ov');
  const p = createPoseOut();
  p.root = [9, 9, 9];
  const g = { x: 7, z: 7, yawDeg: 7 };
  sampleMotion(c, 0.5, p, g);
  assert.deepEqual(p.root, [9, 9, 9]);
  assert.deepEqual(g, { x: 7, z: 7, yawDeg: 7 });
  const w = synthetic({ id: 'wrap' });
  w.frames.ground = w.frames.ground.map((gr, f) => [0, 0, f < 15 ? 170 : -175]);
  assert.throws(() => prepareClip(w), /unwrapped/);
});

test('the exporter rejects bad sources', () => {
  assert.throws(() => prepareClip({ ...synthetic(), skeleton: 'X' }), /VC17/);
  assert.throws(() => prepareClip({ ...synthetic(), sampleRate: 24 }), /sampleRate/);
  const s = synthetic({ loop: true, frames: 21 });
  s.frames.q[20] = s.frames.q[10];
  assert.throws(() => prepareClip(s), /seam/);
  const m = synthetic();
  m.markers = { late: 5 };
  assert.throws(() => prepareClip(m), /outside/);
  assert.throws(() => prepareClip(synthetic({ mirrorable: false, aliases: { x_l: 'mirror' } })), /mirrorable/);
});
