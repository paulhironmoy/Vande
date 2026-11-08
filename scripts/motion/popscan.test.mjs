/**
 * The pose-pop scan (scripts/motion/popscan.mjs, MOTION-SPEC section 9): it flags a one-frame jump and a hips teleport, and the
 * shipped Chase result moments are clean.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { WEB_DIR, encodePack, prepareClip } from './export.mjs';
import { scanClip, scanPack } from './popscan.mjs';
import { parsePack } from './vmp.ts';

const BONES = 17;
const quat = (deg) => [Math.sin((deg * Math.PI) / 360), 0, 0, Math.cos((deg * Math.PI) / 360)];

/** A 12-frame clip at rest, with one bone turned `deg` degrees for the one frame `at`, and the hips moved `jump` metres from `at` on. */
function clip(id, { bone = 9, deg = 0, at = 6, jump = 0 } = {}) {
  const q = [];
  const hips = [];
  for (let f = 0; f < 12; f++) {
    const row = [];
    for (let b = 0; b < BONES; b++) row.push(...(b === bone && f === at ? quat(deg) : [0, 0, 0, 1]));
    q.push(row);
    hips.push([0, 0, jump && f >= at ? jump : 0]);
  }
  return {
    format: 'VMS1',
    id,
    pack: 'test',
    role: 'any',
    skeleton: 'VC17',
    sampleRate: 60,
    loop: false,
    mirrorable: false,
    overlay: false,
    codec: 2,
    boneMask: 'all',
    markers: {},
    frames: { ground: q.map(() => [0, 0, 0]), hips, contacts: q.map(() => 0), q },
    tracks: {},
  };
}

const scan = (src) => scanClip([...parsePack(encodePack([prepareClip(src)])).clips.values()][0]);

test('a quiet clip is clean', () => {
  const r = scan(clip('quiet'));
  assert.equal(r.pass, true);
  assert.equal(r.hits.length, 0);
});

test('a one-frame arm turn of 40 degrees is a SPIKE, and 70 degrees is HUGE', () => {
  const spike = scan(clip('spike', { deg: 40 }));
  assert.equal(spike.pass, false);
  assert.ok(spike.hits.some((h) => h.kind === 'SPIKE' && h.bone === 'forearmR'));
  const huge = scan(clip('huge', { deg: 70 }));
  assert.ok(huge.hits.some((h) => h.kind === 'HUGE'));
});

test('a 10 degree turn of a forearm in one frame is not a pop; a 12 degree turn of the chest is', () => {
  assert.equal(scan(clip('slow', { deg: 10 })).pass, true);
  assert.equal(scan(clip('chest', { bone: 2, deg: 12 })).pass, false);
});

test('a hips teleport of 8 cm is a HIPSJUMP', () => {
  const r = scan(clip('jump', { jump: 0.08 }));
  assert.ok(r.hits.some((h) => h.kind === 'HIPSJUMP'));
});

test('the shipped result_moments clips have no pop', () => {
  const rows = scanPack(readFileSync(join(WEB_DIR, 'result_moments.vmp')));
  assert.ok(rows.length >= 2);
  for (const r of rows) assert.deepEqual(r.hits.filter((h) => h.kind !== 'FAST'), [], r.clip);
});
