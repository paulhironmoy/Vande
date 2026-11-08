#!/usr/bin/env node
/**
 * Naturalness metrics for VC17 motion (MOTION-SPEC §9), measured on DECODED pack bytes (after quantisation): forward
 * kinematics on the canonical skeleton, the ground track applied (travel mode), sampled at 60 Hz with the shipped
 * sampler. These are measurements for the evaluators, not a certification.
 *
 *   node scripts/motion/metrics.mjs [pack.vmp ...] [--json out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { BONE_COUNT, CONTACT, VC17_BONES, createPoseOut, parsePack, sampleMotion } from './vmp.ts';

export const PARENT = [-1, 0, 1, 2, 3, 2, 5, 6, 2, 8, 9, 0, 11, 12, 0, 14, 15];
export const OFFSET = [
  [0, 0.98, 0],
  [0, 0.11, 0],
  [0, 0.2, 0],
  [0, 0.235, 0],
  [0, 0.085, 0.012],
  [0.205, 0.182, -0.012],
  [0, -0.285, 0],
  [0, -0.255, 0],
  [-0.205, 0.182, -0.012],
  [0, -0.285, 0],
  [0, -0.255, 0],
  [0.095, -0.065, 0],
  [0, -0.43, 0],
  [0, -0.42, 0],
  [-0.095, -0.065, 0],
  [0, -0.43, 0],
  [0, -0.42, 0],
];
export const B = Object.fromEntries(VC17_BONES.map((n, i) => [n, i]));
export const ANKLE_REST_H = 0.065;
/** Foot points in the foot frame: heel, ball, sole tip (as authored in scripts/blender/motion/vc17.py). */
export const FOOT_POINTS = { heel: [0, -0.065, -0.05], ball: [0, -0.065, 0.135], toe: [0, -0.065, 0.2] };
export const TOUCH_M = 0.012;

export const CAPS = Object.freeze({
  slideM: 0.02,
  penetrationM: -0.01,
  floatM: 0.025,
  /** Angular speed caps, deg/s. */
  speedThrowArm: 1800,
  speedLimb: 1200,
  speedTorso: 600,
  speedHead: 720,
  /** Change of angular velocity per 60 Hz frame, deg/s. */
  accelPerFrame: 300,
  accelPerFrameFastLegs: 650,
  groundSpeedStep: 0.15,
  hipsSpeedStep: 0.3,
  wristTorsoM: 0.09,
});

const DEG = 180 / Math.PI;

function qmul(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}
function qrot(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
const qyaw = (deg) => [0, Math.sin((deg / DEG) * 0.5), 0, Math.cos((deg / DEG) * 0.5)];
const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];

/** World positions (17×3) and rotations (17×4) of a sampled pose. */
export function fkPose(q, root, ground) {
  const gq = qyaw(ground.yawDeg);
  const P = [];
  const W = [];
  for (let i = 0; i < BONE_COUNT; i++) {
    const lq = [q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3]];
    const p = PARENT[i];
    if (p < 0) {
      const o = qrot(gq, [OFFSET[0][0] + root[0], OFFSET[0][1] + root[1], OFFSET[0][2] + root[2]]);
      P.push([ground.x + o[0], o[1], ground.z + o[2]]);
      W.push(qmul(gq, lq));
    } else {
      const o = qrot(W[p], OFFSET[i]);
      P.push([P[p][0] + o[0], P[p][1] + o[1], P[p][2] + o[2]]);
      W.push(qmul(W[p], lq));
    }
  }
  return { P, W };
}

/** Euler XYZ (three.js) of a quaternion, degrees. */
export function eulerXYZ(q) {
  const [x, y, z, w] = q;
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - w * z);
  const m13 = 2 * (x * z + w * y);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - w * x);
  const m32 = 2 * (y * z + w * x);
  const m33 = 1 - 2 * (x * x + y * y);
  const ey = Math.asin(Math.max(-1, Math.min(1, m13)));
  if (Math.abs(m13) < 0.9999999) return [Math.atan2(-m23, m33) * DEG, ey * DEG, Math.atan2(-m12, m11) * DEG];
  return [Math.atan2(m32, m22) * DEG, ey * DEG, 0];
}

/** Swing (deg, of the bone axis Y) and twist (deg, about Y). */
export function swingTwist(q) {
  const [, y, , w] = q;
  const l = Math.hypot(y, w) || 1;
  const twist = 2 * Math.atan2(y / l, w / l) * DEG;
  const t = [0, y / l, 0, w / l];
  const s = qmul(q, qconj(t));
  const swing = 2 * Math.acos(Math.min(1, Math.abs(s[3]))) * DEG;
  return { swing, twist: ((twist + 540) % 360) - 180 };
}

const angleDeg = (q) => 2 * Math.acos(Math.min(1, Math.abs(q[3]))) * DEG;

/** Angular velocity vector (deg/s) taking local quaternion a to b over dt. */
function angVel(a, b, dt) {
  let d = qmul(qconj(a), b);
  if (d[3] < 0) d = d.map((v) => -v);
  const s = Math.hypot(d[0], d[1], d[2]);
  if (s < 1e-12) return [0, 0, 0];
  const ang = 2 * Math.atan2(s, d[3]);
  const k = (ang / s / dt) * DEG;
  return [d[0] * k, d[1] * k, d[2] * k];
}

const THROW_ARM = new Set([5, 6, 7, 8, 9, 10]);
const TORSO = new Set([0, 1, 2]);
const HEAD = new Set([3, 4]);

function speedCap(i, clip) {
  if (THROW_ARM.has(i) && /throw|flick|bowl|stump|dive|celebr|catch/.test(clip.name)) return CAPS.speedThrowArm;
  if (TORSO.has(i)) return /dive|getup/.test(clip.name) ? CAPS.speedLimb : CAPS.speedTorso;
  if (HEAD.has(i)) return CAPS.speedHead;
  return CAPS.speedLimb;
}

const LEGS = new Set([11, 12, 13, 14, 15, 16]);
const ARMS = new Set([5, 6, 7, 8, 9, 10]);

/**
 * The explosive class (MOTION-SPEC §9, lead-approved): the ONLY clips whose listed limbs may change angular velocity
 * by up to 650 deg/s per frame instead of 300. Stated engineering cap, not human-validated. Membership is explicit
 * per clip id with its reason; no pattern matching. Any change needs a lead ruling first.
 */
export const EXPLOSIVE = Object.freeze({
  loco_run: { limbs: 'legs', reason: 'running at 5.6 m/s: foot strike and late-swing knee check' },
  loco_sprint: { limbs: 'legs', reason: 'sprinting at 7.8 m/s: foot strike and late-swing knee check' },
  loco_start: { limbs: 'legs', reason: 'explosive start from standing' },
  fld_sprint_start: { limbs: 'legs', reason: 'explosive start from the ready stance' },
  fld_turn_run_r: { limbs: 'legs', reason: 'explosive drop-step turn and sprint away' },
  fld_turn_run_l: { limbs: 'legs', reason: 'mirror of fld_turn_run_r' },
  kp_dive_r: { limbs: 'legs+arms', reason: 'ballistic full-length dive, in place (MOTION-SPEC §6), recovery within DIVE.recoverS' },
  kp_dive_l: { limbs: 'legs+arms', reason: 'mirror of kp_dive_r' },
  fld_dive_r: { limbs: 'legs+arms', reason: 'ballistic full-length dive, in place (MOTION-SPEC §6), recovery within DIVE.recoverS' },
  fld_dive_l: { limbs: 'legs+arms', reason: 'mirror of fld_dive_r' },
  bowl_run: { limbs: 'legs', reason: 'running at >= 4.5 m/s (lead ruling 2026-11-04): 5.0 m/s' },
  bowl_stride: { limbs: 'legs', reason: 'running at >= 4.5 m/s (lead ruling 2026-11-04): 6.2 m/s' },
  bowl_pace: { limbs: 'legs', reason: 'running at >= 4.5 m/s (lead ruling 2026-11-04): last-stride bound and front-foot block at 6.2 m/s' },
  ns_run: { limbs: 'legs', reason: 'running at >= 4.5 m/s (lead ruling 2026-11-04): 5.2 m/s' },
  fld_dive_fast_r: { limbs: 'legs+arms', reason: 'ballistic dive and scramble within DIVE.recoverS (lead ruling 2026-11-04)' },
  fld_dive_fast_l: { limbs: 'legs+arms', reason: 'mirror of fld_dive_fast_r' },
  fld_dive_scramble_r: { limbs: 'legs+arms', reason: 'ballistic dive and scramble within DIVE.recoverS (lead ruling 2026-11-04)' },
  fld_dive_scramble_l: { limbs: 'legs+arms', reason: 'mirror of fld_dive_scramble_r' },
  bowl_pace_bouncer: { limbs: 'legs', reason: 'the bouncer variant of bowl_pace: same run-in, bound, front-foot block and release (lead ruling 2026-11-04: same gates as bowl_pace)' },
  ns_turn: { limbs: 'legs', reason: '180-degree turn and push-off from standing to run speed, an explosive start like loco_start and fld_turn_run (lead ruling 2026-11-04)' },
});

/**
 * Clips whose ground-track speed step is measured and printed but not gated (MOTION-SPEC §9, lead-approved). Explicit
 * per clip id with its reason; aliases are listed too. Every other gate still gates. Changes need a lead ruling.
 */
export const GROUND_STEP_REPORT_ONLY = Object.freeze({
  ns_turn: 'in-place clip; runtime root is sprintProfile at 10 m/s² braking, forced by the physics running-model limitation (no braking; PRACTICE_PHYSICS Named limitations); revisit when running gains braking (lead ruling 2026-11-04)',
  ns_turn_r: 'mirror alias of ns_turn (inherits its ruling)',
});

export function accelCap(i, clip) {
  const e = EXPLOSIVE[clip.name];
  if (e && (LEGS.has(i) || (e.limbs === 'legs+arms' && ARMS.has(i)))) return CAPS.accelPerFrameFastLegs;
  return CAPS.accelPerFrame;
}

/** Joint-limit check of one local quaternion; returns a violation string or null. */
export function jointViolation(i, q) {
  const name = VC17_BONES[i];
  const e = eulerXYZ(q);
  const st = swingTwist(q);
  if (name.startsWith('shin')) {
    if (e[0] < -5 || e[0] > 155 || Math.abs(e[2]) > 10) return `${name} X ${e[0].toFixed(1)} Z ${e[2].toFixed(1)}`;
  } else if (name.startsWith('forearm')) {
    if (e[0] < -150 || e[0] > 5 || Math.abs(e[2]) > 12) return `${name} X ${e[0].toFixed(1)} Z ${e[2].toFixed(1)}`;
  } else if (name.startsWith('foot')) {
    if (e[0] < -40 || e[0] > 60) return `${name} X ${e[0].toFixed(1)}`;
  } else if (name.startsWith('thigh')) {
    if (st.swing > 135 || Math.abs(st.twist) > 50) return `${name} swing ${st.swing.toFixed(1)} twist ${st.twist.toFixed(1)}`;
  } else if (name.startsWith('upperArm')) {
    if (st.swing > 185 || Math.abs(st.twist) > 110) return `${name} swing ${st.swing.toFixed(1)} twist ${st.twist.toFixed(1)}`;
  } else if (name.startsWith('hand')) {
    if (st.swing > 85) return `${name} swing ${st.swing.toFixed(1)}`;
  } else if (name === 'spine' || name === 'chest') {
    if (angleDeg(q) > 75) return `${name} ${angleDeg(q).toFixed(1)}`;
  } else if (name === 'neck' || name === 'head') {
    if (angleDeg(q) > 80) return `${name} ${angleDeg(q).toFixed(1)}`;
  }
  return null;
}

function distToSegment(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
}

/** Every metric for one clip (mirror aliases measure the same as their source, so callers usually skip them). */
export function measureClip(clip) {
  const rate = 60;
  const dt = 1 / rate;
  const n = Math.floor(clip.duration * rate + 1e-6) + (clip.loop ? 3 : 1);
  const pose = createPoseOut();
  const ground = { x: 0, z: 0, yawDeg: 0 };
  const frames = [];
  for (let k = 0; k < n; k++) {
    const r = sampleMotion(clip, k * dt, pose, ground);
    const q = Array.from({ length: BONE_COUNT }, (_, i) => [pose.q[i * 4], pose.q[i * 4 + 1], pose.q[i * 4 + 2], pose.q[i * 4 + 3]]);
    const fkr = fkPose(pose.q, pose.root, ground);
    frames.push({ t: k * dt, q, root: [...pose.root], ground: { ...ground }, contacts: r.contacts, ...fkr });
  }
  const out = { clip: clip.name, frames: n, duration: clip.duration, loop: clip.loop };
  // Foot plants: each foot point that is touching (contact bit set and within TOUCH_M of the ground) must stay put.
  let slide = 0;
  let slideAt = '';
  let pen = Infinity;
  let floatMax = 0;
  let ankleSlide = 0;
  for (const [side, bone, bit] of [
    ['L', B.footL, CONTACT.footL],
    ['R', B.footR, CONTACT.footR],
  ]) {
    const pts = Object.entries(FOOT_POINTS);
    const runs = Object.fromEntries(pts.map(([k]) => [k, null]));
    let ankleRun = null;
    for (const f of frames) {
      const heights = [];
      for (const [k, local] of pts) {
        const w = qrot(f.W[bone], local);
        const p = [f.P[bone][0] + w[0], f.P[bone][1] + w[1], f.P[bone][2] + w[2]];
        heights.push(p[1]);
        pen = Math.min(pen, p[1]);
        const touching = (f.contacts & bit) !== 0 && p[1] < TOUCH_M;
        if (touching) {
          if (!runs[k]) runs[k] = p;
          const d = Math.hypot(p[0] - runs[k][0], p[2] - runs[k][2]);
          if (d > slide) {
            slide = d;
            slideAt = `foot${side}.${k} t=${f.t.toFixed(3)}`;
          }
        } else runs[k] = null;
      }
      if (f.contacts & bit) {
        floatMax = Math.max(floatMax, Math.min(...heights));
        const a = f.P[bone];
        if (Math.min(...heights) < TOUCH_M && Math.abs(heights[0] - heights[1]) < 0.004) {
          if (!ankleRun) ankleRun = a;
          ankleSlide = Math.max(ankleSlide, Math.hypot(a[0] - ankleRun[0], a[2] - ankleRun[2]));
        } else ankleRun = null;
      } else ankleRun = null;
    }
  }
  out.footSlideM = slide;
  out.footSlideAt = slideAt;
  out.ankleFlatSlideM = ankleSlide;
  out.footMinHeightM = pen;
  out.contactFloatM = floatMax;
  // Angular speed and its change per frame.
  let worstSpeed = 0;
  let worstSpeedAt = '';
  let worstRatio = 0;
  let worstAcc = 0;
  let worstAccRatio = 0;
  let worstAccAt = '';
  const prevW = new Array(BONE_COUNT).fill(null);
  for (let k = 1; k < n; k++) {
    for (let i = 0; i < BONE_COUNT; i++) {
      const w = angVel(frames[k - 1].q[i], frames[k].q[i], dt);
      const s = Math.hypot(...w);
      const ratio = s / speedCap(i, clip);
      if (ratio > worstRatio) {
        worstRatio = ratio;
        worstSpeed = s;
        worstSpeedAt = `${VC17_BONES[i]} t=${frames[k].t.toFixed(3)}`;
      }
      if (prevW[i]) {
        const a = Math.hypot(w[0] - prevW[i][0], w[1] - prevW[i][1], w[2] - prevW[i][2]);
        const r = a / accelCap(i, clip);
        if (r > worstAccRatio) {
          worstAccRatio = r;
          worstAcc = a;
          worstAccAt = `${VC17_BONES[i]} t=${frames[k].t.toFixed(3)}`;
        }
      }
      prevW[i] = w;
    }
  }
  out.maxAngularSpeedDegS = worstSpeed;
  out.maxAngularSpeedAt = worstSpeedAt;
  out.angularSpeedCapRatio = worstRatio;
  out.maxAngularAccelDegSPerFrame = worstAcc;
  out.maxAngularAccelAt = worstAccAt;
  out.angularAccelCapRatio = worstAccRatio;
  // Root speed smoothness.
  let gStep = 0;
  let hStep = 0;
  let prevG = null;
  let prevH = null;
  let hipsMin = Infinity;
  let hipsMax = -Infinity;
  // Speeds over 1/30 s central windows: the ground and hips tracks are stored to 1 mm, which alone would read as
  // ±0.06 m/s of frame-to-frame speed noise at 60 Hz.
  for (let k = 2; k < n - 1; k++) {
    const a = frames[k - 2];
    const b = frames[k];
    const gs = Math.hypot(b.ground.x - a.ground.x, b.ground.z - a.ground.z) / (2 * dt);
    const hs = Math.hypot(b.P[0][0] - a.P[0][0], b.P[0][2] - a.P[0][2]) / (2 * dt);
    if (prevG !== null) gStep = Math.max(gStep, Math.abs(gs - prevG));
    if (prevH !== null) hStep = Math.max(hStep, Math.abs(hs - prevH));
    prevG = gs;
    prevH = hs;
  }
  for (const f of frames) {
    hipsMin = Math.min(hipsMin, f.P[0][1]);
    hipsMax = Math.max(hipsMax, f.P[0][1]);
  }
  out.groundSpeedStepMps = gStep;
  out.groundStepReportOnly = clip.name in GROUND_STEP_REPORT_ONLY || clip.source in GROUND_STEP_REPORT_ONLY;
  out.hipsSpeedStepMps = hStep;
  out.hipsHeightM = [hipsMin, hipsMax];
  // Stride and cadence (gait loops).
  if (clip.loop && clip.cycleSteps > 0 && clip.speedMps > 0) {
    out.cadenceSpm = (clip.cycleSteps / clip.duration) * 60;
    out.stepLengthM = clip.speedMps / (out.cadenceSpm / 60);
    out.stepPerLeg = out.stepLengthM / 0.915;
  }
  // Joint limits.
  const viol = [];
  for (const f of frames)
    for (let i = 0; i < BONE_COUNT; i++) {
      const v = jointViolation(i, f.q[i]);
      if (v) viol.push(`${v} t=${f.t.toFixed(3)}`);
    }
  out.jointViolations = viol.length;
  out.jointViolationFirst = viol[0] ?? null;
  // Wrists clear of the torso (not while that hand is on the ground or the ball).
  let wrist = Infinity;
  for (const f of frames) {
    for (const [bone, bit] of [
      [B.handL, CONTACT.handL],
      [B.handR, CONTACT.handR],
    ]) {
      if (f.contacts & bit) continue;
      wrist = Math.min(wrist, distToSegment(f.P[bone], f.P[B.hips], f.P[B.neck]));
    }
  }
  out.wristTorsoMinM = wrist;
  out.pass = {
    slide: slide < CAPS.slideM,
    penetration: pen >= CAPS.penetrationM,
    float: floatMax <= CAPS.floatM,
    angularSpeed: worstRatio <= 1,
    angularAccel: worstAccRatio <= 1,
    groundSmooth: gStep <= CAPS.groundSpeedStep || clip.name in GROUND_STEP_REPORT_ONLY || clip.source in GROUND_STEP_REPORT_ONLY,
    hipsSmooth: hStep <= CAPS.hipsSpeedStep,
    joints: viol.length === 0,
    wristClear: wrist >= CAPS.wristTorsoM,
  };
  if (out.cadenceSpm) {
    out.lateral = Math.abs(clip.travel.x) > Math.abs(clip.travel.z);
    out.pass.cadence = out.lateral ? lateralCadenceOk(clip.speedMps, out.cadenceSpm, out.stepPerLeg) : cadenceOk(clip.speedMps, out.cadenceSpm, out.stepPerLeg);
  }
  out.passAll = Object.values(out.pass).every(Boolean);
  return out;
}

export function cadenceOk(v, spm, perLeg) {
  const bands = [
    [1.3, 1.7, 100, 125],
    [2.8, 3.8, 150, 175],
    [5.0, 6.5, 165, 190],
    [7.2, 8.2, 190, 240],
  ];
  const inBand = bands.some(([v0, v1, c0, c1]) => v >= v0 - 1e-3 && v <= v1 + 1e-3 && spm >= c0 && spm <= c1);
  return inBand && perLeg >= 0.7 && perLeg <= 2.4;
}

/**
 * MOTION-SPEC v1.2.2: a sideways step-close shuffle (a loop that travels more along x than z) is not a forward gait.
 * Stated engineering band, not human-validated: 0.8-2.5 m/s at 180-340 steps/min, step/leg >= 0.2.
 */
export function lateralCadenceOk(v, spm, perLeg) {
  return v >= 0.8 - 1e-3 && v <= 2.5 + 1e-3 && spm >= 180 && spm <= 340 && perLeg >= 0.2 && perLeg <= 1.2;
}

export function measurePack(bytes, { includeAliases = false } = {}) {
  const pack = parsePack(bytes);
  const rows = [];
  for (const [, clip] of pack.clips) if (includeAliases || !clip.mirrored) rows.push(measureClip(clip));
  return rows;
}

function fmt(r) {
  const p = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
  const fails = Object.entries(r.pass)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  return `${r.clip.padEnd(18)} slide ${p(r.footSlideM * 100, 2)} cm  minH ${p(r.footMinHeightM * 100, 1)} cm  float ${p(r.contactFloatM * 100, 1)} cm  ω ${p(r.maxAngularSpeedDegS, 0)}°/s (${r.maxAngularSpeedAt})  Δω ${p(r.maxAngularAccelDegSPerFrame, 0)} (${r.maxAngularAccelAt})  Δv g ${p(r.groundSpeedStepMps)} h ${p(r.hipsSpeedStepMps)}  hips ${p(r.hipsHeightM[0])}–${p(r.hipsHeightM[1])}${r.cadenceSpm ? `  ${p(r.cadenceSpm, 1)} spm step ${p(r.stepLengthM, 2)} m` : ''}  joints ${r.jointViolations}${r.jointViolationFirst ? ` (${r.jointViolationFirst})` : ''}  wrist ${p(r.wristTorsoMinM)}  ${r.passAll ? 'PASS' : `FAIL ${fails.join(',')}`}`;
}

function main(argv) {
  const ji = argv.indexOf('--json');
  const jsonOut = ji >= 0 ? argv[ji + 1] : null;
  const files = argv.filter((a, i) => !a.startsWith('--') && (ji < 0 || i !== ji + 1));
  const all = {};
  for (const f of files) {
    const rows = measurePack(readFileSync(f));
    all[basename(f)] = rows;
    for (const r of rows) console.log(fmt(r));
  }
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ caps: CAPS, packs: all }, null, 1) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
