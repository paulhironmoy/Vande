#!/usr/bin/env node
/**
 * Pose-pop scan of DECODED VC17 clips (MOTION-SPEC section 9, "Pose pop (whole-delivery scan; UNITY-9)"): the one-frame
 * turns that read as a glitch rather than as fast motion. It is the same definition the Unity editor scanner
 * (`VandeHumansEvidence.Pops.cs`) applies to a whole delivery, applied here to a single clip sampled at 60 Hz with the
 * shipped reader. A builder measurement for the evaluators, not a certification.
 *
 *   SPIKE      a bone's rotation step in ONE frame at or above its floor (the smaller of 25 deg and its section 9
 *              cap per frame: arms 25, other limbs 20, hips, spine and chest 10, neck and head 12) AND at least 3 times
 *              its quiet neighbours (the second smallest of the steps two frames either side)
 *   HUGE       any bone step of 60 deg or more in one frame
 *   HIPSJUMP   the hips joint's displacement changes by more than 5 cm between consecutive frames
 *   HEADWORLD  the head's rotation speed in the world (the ground yaw added) over 720 deg/s
 *   FAST       a run of frames at or above 1.25 times the cap per frame without a spike (reported, not failed)
 *
 *   node scripts/motion/popscan.mjs <pack.vmp> [--json out.json]     exit 1 when a SPIKE, HUGE, HIPSJUMP or HEADWORLD is found
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BONE_COUNT, VC17_BONES, createPoseOut, parsePack, sampleMotion } from './vmp.ts';
import { fkPose } from './metrics.mjs';

const RATE = 60;
const DEG = 180 / Math.PI;
export const POP = Object.freeze({ floorDeg: 25, ratio: 3, hugeDeg: 60, jumpM: 0.05, headWorldDegS: 720, fastRatio: 1.25 });

/** The section 9 cap in degrees per frame at 60 Hz: the bowling or throwing arm 1,800 deg/s, other limbs 1,200, torso 600, head 720. */
export function capPerFrame(bone) {
  const name = VC17_BONES[bone];
  if (/^(upperArm|forearm|hand)/.test(name)) return 1800 / RATE;
  if (/^(thigh|shin|foot)/.test(name)) return 1200 / RATE;
  if (name === 'hips' || name === 'spine' || name === 'chest') return 600 / RATE;
  return 720 / RATE;
}

const dot4 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
const stepDeg = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(dot4(a, b)))) * DEG;

/** Samples a decoded clip at 60 Hz: local rotations, the hips joint and the head's world rotation per frame. */
function frames(clip) {
  const n = Math.floor(clip.duration * RATE + 1e-6) + 1;
  const pose = createPoseOut();
  const ground = { x: 0, z: 0, yawDeg: 0 };
  const out = [];
  for (let k = 0; k < n; k++) {
    sampleMotion(clip, k / RATE, pose, ground);
    const q = Array.from({ length: BONE_COUNT }, (_, i) => [pose.q[i * 4], pose.q[i * 4 + 1], pose.q[i * 4 + 2], pose.q[i * 4 + 3]]);
    const { P, W } = fkPose(pose.q, pose.root, ground);
    out.push({ q, hips: P[0], headW: W[VC17_BONES.indexOf('head')] });
  }
  return out;
}

/** The scan of one decoded clip: counts, the worst cases and every hit. */
export function scanClip(clip) {
  const f = frames(clip);
  const hits = [];
  const steps = Array.from({ length: BONE_COUNT }, () => new Float64Array(f.length));
  for (let k = 1; k < f.length; k++) for (let b = 0; b < BONE_COUNT; b++) steps[b][k] = stepDeg(f[k - 1].q[b], f[k].q[b]);
  let maxByBone = Array(BONE_COUNT).fill(0);
  for (let b = 0; b < BONE_COUNT; b++) {
    const cap = capPerFrame(b);
    const floor = Math.min(POP.floorDeg, cap);
    let k = 1;
    while (k < f.length) {
      const s = steps[b][k];
      maxByBone[b] = Math.max(maxByBone[b], s);
      const near = [steps[b][k - 2], steps[b][k - 1], steps[b][k + 1], steps[b][k + 2]].filter((v) => v !== undefined && Number.isFinite(v)).sort((a, c) => a - c);
      const quiet = near.length >= 2 ? near[1] : (near[0] ?? 0);
      if (s >= POP.hugeDeg) hits.push({ kind: 'HUGE', bone: VC17_BONES[b], frame: k, deg: s });
      else if (s >= floor && s >= POP.ratio * quiet) hits.push({ kind: 'SPIKE', bone: VC17_BONES[b], frame: k, deg: s, quiet });
      k++;
    }
    // FAST: a run at or above 1.25 times the cap per frame that holds no SPIKE or HUGE (reported only).
    let run = 0;
    let peak = 0;
    for (let j = 1; j <= f.length; j++) {
      const over = j < f.length && steps[b][j] >= POP.fastRatio * cap;
      if (over) {
        run++;
        peak = Math.max(peak, steps[b][j]);
      } else {
        if (run > 0 && !hits.some((h) => h.bone === VC17_BONES[b] && (h.kind === 'SPIKE' || h.kind === 'HUGE') && Math.abs(h.frame - j) <= run + 1))
          hits.push({ kind: 'FAST', bone: VC17_BONES[b], frame: j - run, deg: peak, length: run });
        run = 0;
        peak = 0;
      }
    }
  }
  let prev = null;
  let maxJump = 0;
  for (let k = 1; k < f.length; k++) {
    const d = [f[k].hips[0] - f[k - 1].hips[0], f[k].hips[1] - f[k - 1].hips[1], f[k].hips[2] - f[k - 1].hips[2]];
    if (prev) {
      const j = Math.hypot(d[0] - prev[0], d[1] - prev[1], d[2] - prev[2]);
      maxJump = Math.max(maxJump, j);
      if (j > POP.jumpM) hits.push({ kind: 'HIPSJUMP', bone: 'hips', frame: k, metres: j });
    }
    prev = d;
  }
  let maxHead = 0;
  for (let k = 1; k < f.length; k++) {
    const w = stepDeg(f[k - 1].headW, f[k].headW) * RATE;
    maxHead = Math.max(maxHead, w);
    if (w > POP.headWorldDegS) hits.push({ kind: 'HEADWORLD', bone: 'head', frame: k, degPerS: w });
  }
  const fails = hits.filter((h) => h.kind !== 'FAST');
  return {
    clip: clip.name,
    frames: f.length,
    maxStepDegByBone: Object.fromEntries(VC17_BONES.map((n, i) => [n, +maxByBone[i].toFixed(2)])),
    maxHipsJumpM: +maxJump.toFixed(4),
    maxHeadWorldDegS: +maxHead.toFixed(1),
    hits,
    pass: fails.length === 0,
  };
}

export function scanPack(bytes) {
  const pack = parsePack(bytes);
  const rows = [];
  for (const [, clip] of pack.clips) if (!clip.mirrored) rows.push(scanClip(clip));
  return rows;
}

function main(argv) {
  const ji = argv.indexOf('--json');
  const jsonOut = ji >= 0 ? argv[ji + 1] : null;
  const files = argv.filter((a, i) => !a.startsWith('--') && (ji < 0 || i !== ji + 1));
  const all = {};
  let bad = 0;
  for (const file of files) {
    const rows = scanPack(readFileSync(file));
    all[basename(file)] = rows;
    for (const r of rows) {
      const worst = Object.entries(r.maxStepDegByBone).sort((a, b) => b[1] - a[1])[0];
      console.log(`${r.clip.padEnd(22)} ${r.pass ? 'CLEAN' : 'POPS '}  worst step ${worst[1].toFixed(1)} deg (${worst[0]})  hips jump ${(r.maxHipsJumpM * 100).toFixed(2)} cm  head world ${r.maxHeadWorldDegS.toFixed(0)} deg/s  hits ${r.hits.length}`);
      for (const h of r.hits.slice(0, 8)) console.log(`    ${h.kind} ${h.bone} frame ${h.frame} ${h.deg ? h.deg.toFixed(1) + ' deg' : h.metres ? (h.metres * 100).toFixed(1) + ' cm' : h.degPerS.toFixed(0) + ' deg/s'}`);
      if (!r.pass) bad++;
    }
  }
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ definition: POP, packs: all }, null, 1) + '\n');
  if (bad) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
