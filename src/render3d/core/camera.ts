/**
 * Camera director. Each CameraShot is a pure function of scene time and the script (actor and ball positions),
 * so cuts, follows and orbits are deterministic. Engine-provided cues are used when present; otherwise a default
 * broadcast-style plan is derived from the ball's fate. FOV is specified horizontally and converted for the
 * viewport aspect so portrait phones keep the subject framed.
 */
import type { CameraCue, CameraShot } from '@/contracts';
import { evaluateActor } from './actors';
import { type BallScript, sampleBall } from './choreo';
import { BOUNDARY_R, CONTACT_Z, PITCH_HALF, POPPING, STRIKER_POS } from './ground';
import { type Vec3, DEG, add, clamp, lerp, lerpV, smoothstep, v3 } from './math';
import { ballAt } from '../practice/frame';

export interface CameraPose {
  pos: Vec3;
  target: Vec3;
  /** Vertical FOV in degrees for the current aspect. */
  fov: number;
}

/**
 * Director-only shots on top of the engine's: the batter's view, the push-in of the held breath before a result,
 * and Practice's first-person batter's eye, its broken-wicket view and its fixed replay cameras.
 */
export type DirectorShot = CameraShot | 'batting_pov' | 'result_push' | 'batter_eye' | 'practice_stumps' | 'replay_side' | 'replay_behind' | 'replay_top';

export interface DirectorCue {
  shot: DirectorShot;
  atMs: number;
  durationMs: number;
}

/** Default shot list for a script when the engine supplied no cameras. */
export function defaultPlan(script: BallScript, reducedMotion: boolean): DirectorCue[] {
  const { release, contact, decisive, end } = script.times;
  const cues: DirectorCue[] = [];
  const push = (shot: DirectorShot, a: number, b: number) => {
    if (b - a > 40) cues.push({ shot, atMs: a, durationMs: b - a });
  };
  if (script.kind === 'live') {
    push('batting_pov', 0, end);
    return cues;
  }
  if (script.kind === 'ambient') {
    if (script.camera) {
      push(script.camera, 0, end);
      return cues;
    }
    // A result opens with the held breath (a slow push-in on the pitch), then the ground and the celebration.
    const beat = script.beat ?? 0;
    if (beat > 0) push('result_push', 0, beat);
    if (script.celebration === 'milestone') {
      const split = beat + (end - beat) * 0.35;
      push('aerial', beat, split);
      push(reducedMotion ? 'crowd' : 'celebration', split, end);
    } else push('aerial', beat, end);
    return cues;
  }
  const pre = release - 700;
  push(reducedMotion ? 'broadcast_end' : 'bowler_follow', 0, pre);
  const fate = script.fate;
  const after = contact + 450;
  switch (fate.kind) {
    case 'dot_block':
    case 'dot_beaten':
      push('broadcast_end', pre, after);
      push('batter_close', after, end);
      break;
    case 'dot_fielded':
    case 'runs':
      push('broadcast_end', pre, after);
      push('fielder_follow', after, end);
      break;
    case 'four':
      push('broadcast_end', pre, after);
      push('fielder_follow', after, decisive + 500);
      push(script.times.celebrate ? 'celebration' : 'crowd', decisive + 500, end);
      break;
    case 'six': {
      const land = script.events.find((e) => e.kind === 'six')?.t ?? contact + 3000;
      push('broadcast_end', pre, contact + (script.slowMo ? 700 : 300));
      push('fielder_follow', contact + (script.slowMo ? 700 : 300), land + 500);
      push('crowd', land + 500, script.times.celebrate ? land + 1400 : end);
      if (script.times.celebrate) push('celebration', land + 1400, end);
      break;
    }
    case 'wicket': {
      if (fate.wicket === 'caught') {
        const far = decisive - contact > 1500;
        push('broadcast_end', pre, after);
        push(far ? 'fielder_follow' : 'side_on', after, decisive + 700);
      } else if (fate.wicket === 'bowled') {
        push('broadcast_end', pre, decisive - 260);
        push('stump_cam', decisive - 260, decisive + 900);
      } else if (fate.wicket === 'run_out') {
        push('broadcast_end', pre, after);
        push('fielder_follow', after, decisive - 450);
        push('side_on', decisive - 450, decisive + 800);
      } else {
        push('broadcast_end', pre, contact - 220);
        push('side_on', contact - 220, decisive + 700);
      }
      push('celebration', fate.wicket === 'caught' ? decisive + 700 : fate.wicket === 'bowled' ? decisive + 900 : decisive + 800, end);
      break;
    }
    default:
      push('broadcast_end', pre, end);
  }
  return cues;
}

export function cueAt(cues: readonly DirectorCue[], t: number): DirectorCue | null {
  let hit: DirectorCue | null = null;
  for (const c of cues) if (t >= c.atMs && t < c.atMs + c.durationMs) hit = c;
  if (!hit && cues.length) {
    // Before the first cue: the first one; after the last: the last one.
    hit = t < cues[0].atMs ? cues[0] : cues[cues.length - 1];
  }
  return hit;
}

export function planFor(script: BallScript, reducedMotion: boolean): DirectorCue[] {
  if (script.practice) return practicePlan(script, reducedMotion);
  const cues: DirectorCue[] | null = script.cameras ? script.cameras.map((c: CameraCue) => ({ ...c })) : null;
  if (!cues || cues.length === 0) return defaultPlan(script, reducedMotion);
  if (!reducedMotion) return cues;
  // Reduced motion: no tracking orbits or follow-cams.
  return cues.map((c) => ({ ...c, shot: c.shot === 'bowler_follow' || c.shot === 'aerial' ? 'broadcast_end' : c.shot === 'celebration' ? 'crowd' : c.shot }));
}

function vfov(fovH: number, aspect: number, minV: number, maxV: number): number {
  const v = 2 * Math.atan(Math.tan((fovH * DEG) / 2) / Math.max(0.2, aspect)) / DEG;
  return clamp(v, minV, maxV);
}

export interface DirectorContext {
  aspect: number;
  reducedMotion: boolean;
}

const actorPos = (script: BallScript, id: string, t: number): Vec3 => {
  const a = script.actors.find((x) => x.id === id);
  return a ? evaluateActor(a, t).pos : v3();
};

/** Ball position smoothed over a short window so follow-cams glide instead of jittering on bounces. */
function smoothBall(script: BallScript, t: number): Vec3 {
  const a = sampleBall(script, t - 90).pos;
  const b = sampleBall(script, t).pos;
  const c = sampleBall(script, t - 180).pos;
  return v3((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3);
}

/** Pose for one shot at scene time t (cue-local time drives pans and orbits). */
export function shotPose(shot: DirectorShot, script: BallScript, t: number, cueStart: number, ctx: DirectorContext): CameraPose {
  const local = t - cueStart;
  const aspect = ctx.aspect;
  const portrait = aspect < 0.9;
  switch (shot) {
    case 'batter_eye':
      return batterEyePose(script, t, ctx);
    case 'practice_stumps':
    case 'replay_side':
    case 'replay_behind':
    case 'replay_top':
      return practiceFixedPose(shot, script, ctx);
    case 'batting_pov': {
      const push = ctx.reducedMotion ? 0 : smoothstep(0, script.times.release, t) * 0.8;
      // Portrait phones: a step closer and narrower, so the bowler and the pitch fill the frame instead of the sky.
      if (portrait) return { pos: v3(-0.7, 2.25, PITCH_HALF + 4.6 - push), target: v3(0.05, 0.95, -8), fov: vfov(39, aspect, 32, 58) };
      return { pos: v3(-0.75, 2.45, PITCH_HALF + 5.6 - push), target: v3(0.05, 0.85, -7), fov: vfov(40, aspect, 34, 66) };
    }
    case 'broadcast_end': {
      const ball = sampleBall(script, t).pos;
      const follow = clamp(ball.x * 0.25, -0.6, 0.6);
      const pos = portrait ? v3(0.7 + follow, 10.5, -36) : v3(0.6 + follow, 6.2, -38);
      return { pos, target: v3(follow * 0.5, portrait ? 0.2 : 0.9, portrait ? 3.2 : 6.5), fov: vfov(portrait ? 14.5 : 12.5, aspect, 7, 40) };
    }
    case 'bowler_follow': {
      const b = actorPos(script, 'bowler', t);
      const pos = add(b, portrait ? v3(0.9, 2.2, -4.8) : v3(1.1, 2.5, -6.2));
      const target = add(b, v3(-0.4, 1.0, 9));
      return { pos, target, fov: vfov(portrait ? 34 : 34, aspect, 24, 58) };
    }
    case 'batter_close': {
      const s = actorPos(script, 'striker', t);
      const drift = ctx.reducedMotion ? 0 : local * 0.00012;
      if (portrait) return { pos: add(s, v3(2.6 - drift, 1.6, -4.3)), target: add(s, v3(0.2, 1.1, 0)), fov: vfov(28, aspect, 20, 54) };
      return { pos: add(s, v3(2.4 - drift, 1.45, -4.1)), target: add(s, v3(0.2, 1.0, 0)), fov: vfov(30, aspect, 20, 60) };
    }
    case 'side_on': {
      const runOut = script.fate.kind === 'wicket' && script.fate.wicket === 'run_out';
      if (portrait) {
        // Portrait: a raised three-quarter view in front of the action (the striker where they actually are, or the
        // non-striker's end for a run out), the players filling the middle of the frame and the camera leaning a
        // little towards the ball while it is near. No wide side-on with half the frame grass.
        const s = actorPos(script, 'striker', t);
        const focus = runOut ? v3(0, 0, -PITCH_HALF + 2) : v3(s.x, 0, s.z);
        const ball = smoothBall(script, t);
        const near = Math.hypot(ball.x - focus.x, ball.z - focus.z) < 6 ? 0.2 : 0;
        const target = add(lerpV(focus, v3(ball.x, 0, ball.z), near), v3(0, 1.05, 0));
        return { pos: add(focus, v3(4.6, 2.6, -6.2)), target, fov: vfov(26, aspect, 18, 48) };
      }
      const z = runOut ? -PITCH_HALF + 2 : CONTACT_Z - 7;
      return { pos: v3(21, 1.5, z), target: v3(0, 0.75, z), fov: vfov(48, aspect, 22, 72) };
    }
    case 'stump_cam': {
      return { pos: v3(0.32, 0.42, PITCH_HALF + 1.6), target: v3(-0.05, 0.75, -6), fov: vfov(portrait ? 58 : 54, aspect, 36, 80) };
    }
    case 'aerial': {
      const a = 0.7 + (ctx.reducedMotion ? 0 : t * 0.00009);
      // Portrait: lower and closer, the square and the players rather than the whole bowl.
      const r = portrait ? 40 : 74;
      return { pos: v3(Math.cos(a) * r, portrait ? 30 : 44, Math.sin(a) * r), target: v3(0, 0, 1), fov: vfov(portrait ? 44 : 56, aspect, 30, 70) };
    }
    case 'fielder_follow': {
      const ball = smoothBall(script, t);
      const from = v3(0, 0, CONTACT_Z);
      const dir = v3(ball.x - from.x, 0, ball.z - from.z);
      const dl = Math.hypot(dir.x, dir.z) || 1;
      const ux = dir.x / dl;
      const uz = dir.z / dl;
      // Chase camera: behind the ball's direction of travel, rising as the ball goes deep. Portrait sits closer and
      // narrower, so the ball and the chasing fielder fill the frame.
      const back = portrait ? 15 + dl * 0.2 : 22 + dl * 0.25;
      const side = portrait ? 2.5 : 4;
      const pos = v3(from.x - ux * back + uz * side, (portrait ? 8 : 11) + dl * (portrait ? 0.12 : 0.16), from.z - uz * back - ux * side);
      const target = lerpV(ball, v3(ball.x, 0.5, ball.z), 0.4);
      const fovH = clamp(46 - dl * 0.32, 22, 46);
      return { pos, target, fov: vfov(portrait ? fovH - 6 : fovH, aspect, 16, 58) };
    }
    case 'crowd': {
      if (portrait) {
        // A tall frame shows the crowd's flat figures, the sky above and an empty foreground. Portrait cuts to the
        // player at the heart of the moment instead: a medium shot from the front, easing in (still with reduced motion).
        // Facing the player as they stood when the cut began (steady even if they turn), a three-quarter front view.
        const actor = script.actors.find((x) => x.id === (script.heroes[0] ?? 'striker'));
        const h = actor ? evaluateActor(actor, t).pos : v3();
        const facing = (actor ? evaluateActor(actor, cueStart).heading : 0) + 0.6;
        const ease = ctx.reducedMotion ? 0 : Math.min(1, local / 4000);
        const r = 6.2 - ease * 0.9;
        const a = facing + ease * 0.12;
        return { pos: add(h, v3(Math.sin(a) * r, 1.8, Math.cos(a) * r)), target: add(h, v3(0, 1.1, 0)), fov: vfov(30, aspect, 20, 56) };
      }
      const bearing = (script.shotBearing ?? 30) * DEG;
      const pan = ctx.reducedMotion ? 0 : (local * 0.00003) % 0.3;
      const b = bearing + pan - 0.1;
      const dir = v3(Math.sin(b), 0, -Math.cos(b));
      const pos = v3(dir.x * (BOUNDARY_R - 12), 2.4, CONTACT_Z + dir.z * (BOUNDARY_R - 12));
      const target = v3(dir.x * (BOUNDARY_R + 18), 9, CONTACT_Z + dir.z * (BOUNDARY_R + 18));
      return { pos, target, fov: vfov(portrait ? 44 : 40, aspect, 26, 66) };
    }
    case 'result_push': {
      // From high behind the bowler's arm down towards the batter's end, the frame tightening as the breath is held.
      // Reduced motion: one still frame partway in.
      const beat = Math.max(1, script.beat ?? 1400);
      const u = ctx.reducedMotion ? 0.6 : smoothstep(0, beat, t);
      const from = portrait ? v3(0.9, 13, -34) : v3(0.9, 10, -32);
      const to = portrait ? v3(0.5, 5.6, -16) : v3(0.5, 4.4, -17);
      const target = lerpV(v3(0, 0.6, 3), v3(0, 1.0, PITCH_HALF - 1.5), u);
      return { pos: lerpV(from, to, u), target, fov: vfov(lerp(portrait ? 30 : 26, portrait ? 22 : 18, u), aspect, 12, 56) };
    }
    case 'celebration': {
      const hero = script.heroes[0] ?? 'bowler';
      const h = actorPos(script, hero, t);
      const a = (ctx.reducedMotion ? 0.8 : 0.8 + local * 0.00026) + (hero === 'striker' ? Math.PI : 0);
      const r = (hero === 'bowler' ? 8.5 : 5.2) * (portrait ? 0.8 : 1);
      return { pos: add(h, v3(Math.cos(a) * r, hero === 'bowler' ? 3.1 : 1.9, Math.sin(a) * r)), target: add(h, v3(0, 1.05, 0)), fov: vfov(portrait ? 38 : 38, aspect, 26, 60) };
    }
  }
}

/** Small deterministic shake after impacts (disabled with reduced motion). */
function shake(script: BallScript, t: number): Vec3 {
  let x = 0;
  let y = 0;
  for (const e of script.events) {
    if (e.kind !== 'stumps' && e.kind !== 'six' && e.kind !== 'bat') continue;
    const dt = t - e.t;
    if (dt < 0 || dt > 320) continue;
    const k = (1 - dt / 320) * (e.kind === 'stumps' ? 0.05 : e.kind === 'six' ? 0.035 : 0.012) * e.intensity;
    x += Math.sin(dt * 0.11) * k;
    y += Math.cos(dt * 0.13) * k;
  }
  return v3(x, y, 0);
}

export function cameraAt(script: BallScript, t: number, cues: readonly DirectorCue[], ctx: DirectorContext): CameraPose & { shot: DirectorShot } {
  const cue = cueAt(cues, t) ?? { shot: 'broadcast_end' as DirectorShot, atMs: 0, durationMs: script.duration };
  const pose = shotPose(cue.shot, script, t, cue.atMs, ctx);
  // Practice keeps a stable camera: no impact shake (the contact is felt through sound and haptics).
  if (!ctx.reducedMotion && !script.practice) {
    const s = shake(script, t);
    pose.pos = add(pose.pos, s);
  }
  return { ...pose, shot: cue.shot };
}

/** Linear blend of two camera poses (used for the brief settle after a cut in standard quality). */
export function blendPose(a: CameraPose, b: CameraPose, u: number): CameraPose {
  return { pos: lerpV(a.pos, b.pos, u), target: lerpV(a.target, b.target, u), fov: lerp(a.fov, b.fov, u) };
}

export { STRIKER_POS };

// ---------------------------------------------------------------------------------------------------------------
// Practice: the first-person batter's eye, the broken-wicket view and the replay cameras
// ---------------------------------------------------------------------------------------------------------------

/**
 * The batter's eye in the striker's own (right-handed) frame when no physics head is given: 1.68 m above the crease
 * and 0.2 m to the leg side, 1.2 m in front of the stumps. Practice scripts carry the eye from the physics stance head
 * (src/physics/bat.ts batterBody: the head centre at 1.62 m, radius 0.12; the eye 6 cm above it), always within the
 * brief's 1.65–1.75 m. A left-hander's eye is the mirror image. The camera stays there for the whole delivery
 * whatever the footwork (a stable view: no bob, no lunge).
 */
export const BATTER_EYE = { height: 1.68, lateral: 0.2, z: PITCH_HALF - 1.2 } as const;

/**
 * The batter's view never zooms: a constant 54° vertical field of view in landscape. A narrower screen widens it
 * so the horizontal view stays at least 70° (capped at 75° vertical).
 */
export const BATTER_FOV = { vertical: 54, minHorizontal: 70, maxVertical: 75 } as const;

/**
 * Where the batter looks. Before release the bowler's release point sits `releaseAboveDeg` above the centre of the
 * view (run-up, action and hand readable, the pitch below). After release the eyes follow the ball as it was
 * `lagMs` ago, part of the way (`trackGain`), more as it comes closer (the weight ramps by the ball's distance from
 * the eye, `rampFarM` → `rampNearM`, never by time, so the gaze holds no timing cue), and no faster than smooth
 * pursuit allows (`maxRateDegS`): the ball stays readable into the hitting area without the view swooping. After
 * contact the head follows the ball (`followGain`) until the fielding camera takes over. The gaze is integrated on
 * a fixed 4 ms grid from the release, so it is a pure function of the script: live and replay frames match.
 */
export const GAZE = {
  releaseAboveDeg: 14,
  trackGain: 0.72,
  trackGainReduced: 0.35,
  lagMs: 35,
  rampFarM: 19,
  rampNearM: 9,
  maxRateDegS: 150,
  followGain: 0.8,
  followRampMs: 140,
  maxDownDeg: 52,
  maxYawDeg: 60,
  stepMs: 4,
} as const;

/** The batter's eye in the world, from the script when it carries the physics head (Practice), else the default. */
export function batterEyeWorld(mirror: boolean): Vec3 {
  return v3(mirror ? BATTER_EYE.lateral : -BATTER_EYE.lateral, BATTER_EYE.height, BATTER_EYE.z);
}

/** Vertical field of view (degrees) of the batter's view for an aspect ratio. */
export function batterFov(aspect: number): number {
  const minV = (2 * Math.atan(Math.tan((BATTER_FOV.minHorizontal * DEG) / 2) / Math.max(0.2, aspect))) / DEG;
  return clamp(Math.max(BATTER_FOV.vertical, minV), BATTER_FOV.vertical, BATTER_FOV.maxVertical);
}

const unit = (x: number, y: number, z: number): Vec3 => {
  const l = Math.hypot(x, y, z) || 1;
  return v3(x / l, y / l, z / l);
};
const yawPitchOf = (d: Vec3) => ({ yaw: Math.atan2(d.x, -d.z), pitch: Math.asin(clamp(d.y, -1, 1)) });
const fromYawPitch = (yaw: number, pitch: number): Vec3 => v3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
const wrap = (a: number) => {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** Ball position as the eyes have it: lagged and lightly smoothed (bounces do not jerk the head). */
function seenBall(script: BallScript, t: number): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let k = 0; k < 3; k++) {
    const p = sampleBall(script, t - GAZE.lagMs - k * 12).pos;
    x += p.x;
    y += p.y;
    z += p.z;
  }
  return v3(x / 3, y / 3, z / 3);
}

interface GazeTable {
  from: number;
  yaw: Float32Array;
  pitch: Float32Array;
  base: { yaw: number; pitch: number };
}
const gazeTables = new WeakMap<BallScript, { normal?: GazeTable; reduced?: GazeTable }>();

function practiceEye(script: BallScript): Vec3 {
  const p = script.practice!;
  return p.eye ?? batterEyeWorld(p.mirror);
}

function buildGaze(script: BallScript, reducedMotion: boolean): GazeTable {
  const p = script.practice!;
  const eye = practiceEye(script);
  const rel = p.releaseWorld;
  const toRelease = yawPitchOf(unit(rel.x - eye.x, rel.y - eye.y, rel.z - eye.z));
  const base = { yaw: toRelease.yaw, pitch: toRelease.pitch - GAZE.releaseAboveDeg * DEG };
  const from = p.releaseScene;
  const until = Math.min(script.duration, from + 9000);
  const n = Math.max(2, Math.ceil((until - from) / GAZE.stepMs) + 1);
  const yaws = new Float32Array(n);
  const pitches = new Float32Array(n);
  const gain = reducedMotion ? GAZE.trackGainReduced : GAZE.trackGain;
  const follow = reducedMotion ? GAZE.trackGainReduced : GAZE.followGain;
  const maxStep = GAZE.maxRateDegS * DEG * (GAZE.stepMs / 1000);
  let yaw = base.yaw;
  let pitch = base.pitch;
  for (let i = 0; i < n; i++) {
    const t = from + i * GAZE.stepMs;
    const b = seenBall(script, t);
    const dist = Math.hypot(b.x - eye.x, b.y - eye.y, b.z - eye.z);
    let w = p.flight ? gain * smoothstep(GAZE.rampFarM, GAZE.rampNearM, dist) : 0;
    if (p.contactScene !== null && t > p.contactScene) w = lerp(w, follow, smoothstep(p.contactScene, p.contactScene + GAZE.followRampMs, t));
    const to = yawPitchOf(unit(b.x - eye.x, b.y - eye.y, b.z - eye.z));
    const wantYaw = base.yaw + clamp(wrap(to.yaw - base.yaw) * w, -GAZE.maxYawDeg * DEG, GAZE.maxYawDeg * DEG);
    const wantPitch = clamp(base.pitch + (to.pitch - base.pitch) * w, -GAZE.maxDownDeg * DEG, 30 * DEG);
    yaw += clamp(wrap(wantYaw - yaw), -maxStep, maxStep);
    pitch += clamp(wantPitch - pitch, -maxStep, maxStep);
    yaws[i] = yaw;
    pitches[i] = pitch;
  }
  return { from, yaw: yaws, pitch: pitches, base };
}

/** The first-person gaze direction (unit) at scene time t: a pure function of the script, so replays match live. */
export function practiceGaze(script: BallScript, t: number, reducedMotion: boolean): Vec3 {
  let cache = gazeTables.get(script);
  if (!cache) {
    cache = {};
    gazeTables.set(script, cache);
  }
  const key = reducedMotion ? 'reduced' : 'normal';
  const table = (cache[key] ??= buildGaze(script, reducedMotion));
  const x = (t - table.from) / GAZE.stepMs;
  if (x <= 0) return fromYawPitch(table.base.yaw, table.base.pitch);
  const i = Math.min(table.yaw.length - 2, Math.floor(x));
  const u = Math.min(1, x - i);
  const yaw = table.yaw[i] + wrap(table.yaw[i + 1] - table.yaw[i]) * u;
  const pitch = table.pitch[i] + (table.pitch[i + 1] - table.pitch[i]) * u;
  return fromYawPitch(yaw, pitch);
}

function batterEyePose(script: BallScript, t: number, ctx: DirectorContext): CameraPose {
  const p = script.practice;
  const eye = p ? practiceEye(script) : batterEyeWorld(false);
  const dir = p ? practiceGaze(script, t, ctx.reducedMotion) : v3(0, -0.17, -1);
  return { pos: eye, target: v3(eye.x + dir.x * 10, eye.y + dir.y * 10, eye.z + dir.z * 10), fov: batterFov(ctx.aspect) };
}

/** Fixed cameras: the broken wicket after a bowled, and the three external replay views. */
function practiceFixedPose(shot: 'practice_stumps' | 'replay_side' | 'replay_behind' | 'replay_top', script: BallScript, ctx: DirectorContext): CameraPose {
  const p = script.practice;
  const m = p?.mirror ? -1 : 1;
  const crease = PITCH_HALF - POPPING;
  const r = p?.result ?? null;
  const contact = r?.contact.point ?? (p?.flight ? ballAt(p.flight.samples, p.flight.idealContactT) : null) ?? v3(0, 0.5, crease - 0.6);
  const focus = v3(contact.x * m, clamp(contact.y, 0.2, 1.4), contact.z);
  const vertical = (deg: number) => clamp(deg, 10, 80);
  const portrait = ctx.aspect < 1;
  switch (shot) {
    case 'practice_stumps':
      // Low and square of the wicket on the batter's off side: the stumps and the bails fill the middle of the frame,
      // the ball arrives across it, and nobody stands between the camera and the wicket (the keeper is behind it,
      // the batter in front of it and on the leg side).
      // A little in front of the wicket, so the keeper (behind it) and the batter (in front, leg side) stand clear
      // to either side of the broken stumps instead of across them.
      return { pos: v3(3.3 * m, 1.0, PITCH_HALF - 1.5), target: v3(0, 0.38, PITCH_HALF + 0.1), fov: vertical(portrait ? 44 : 28) };
    case 'replay_side':
      return { pos: v3(3.4 * m, 1.3, crease - 2.7), target: focus, fov: vertical(portrait ? 56 : 36) };
    case 'replay_behind':
      return { pos: v3(0.5 * m, 2.5, -17.5), target: v3(focus.x * 0.6, 0.75, crease - 0.6), fov: vertical(portrait ? 26 : 15) };
    case 'replay_top':
      return { pos: v3(1.0 * m, 8.5, crease - 4.2), target: v3(focus.x * 0.5, 0, crease - 1.8), fov: vertical(portrait ? 70 : 58) };
  }
}

/**
 * Practice's live plan: the batter's eye from the start of the run-up, with no cut until after contact or a miss.
 * After a bat contact the head follows the ball, then the fielding camera; after a bowled, the broken wicket; a
 * leave, a miss or a pad stays in first person to the end.
 */
export function practicePlan(script: BallScript, reducedMotion: boolean): DirectorCue[] {
  const p = script.practice!;
  const end = Math.max(1, script.duration);
  if (!Number.isFinite(p.firstPersonUntil) || p.external === 'none') return [{ shot: 'batter_eye', atMs: 0, durationMs: end }];
  const fp = clamp(p.firstPersonUntil, 1, end - 1);
  const after: DirectorShot = p.external === 'stumps' ? 'practice_stumps' : reducedMotion ? 'broadcast_end' : 'fielder_follow';
  return [
    { shot: 'batter_eye', atMs: 0, durationMs: fp },
    { shot: after, atMs: fp, durationMs: end - fp },
  ];
}

/** One fixed (or first-person) camera for a whole replay. */
export function replayShot(camera: 'batter' | 'side' | 'behind' | 'top'): DirectorShot {
  return camera === 'batter' ? 'batter_eye' : camera === 'side' ? 'replay_side' : camera === 'behind' ? 'replay_behind' : 'replay_top';
}

/** A standing player as the camera checks it: a vertical capsule around the actor (metres). */
export const ACTOR_CAPSULE = { radius: 0.38, bottom: 0.05, top: 1.9 } as const;

/**
 * Actors whose body comes within `near` metres of the camera inside its view: they would fill the foreground of an
 * external shot. Pure; the stage hides them, and the director's own dismissal shots are tested to have none.
 */
export function occludingActors(script: BallScript, t: number, pose: CameraPose, near = 1.5, skip: ReadonlySet<string> = new Set()): string[] {
  const f = unit(pose.target.x - pose.pos.x, pose.target.y - pose.pos.y, pose.target.z - pose.pos.z);
  const out: string[] = [];
  for (const a of script.actors) {
    if (skip.has(a.id)) continue;
    const p = evaluateActor(a, t).pos;
    // Closest point of the actor's vertical segment to the camera.
    const y = clamp(pose.pos.y, ACTOR_CAPSULE.bottom, ACTOR_CAPSULE.top);
    const dx = p.x - pose.pos.x;
    const dy = y - pose.pos.y;
    const dz = p.z - pose.pos.z;
    const d = Math.hypot(dx, dy, dz) - ACTOR_CAPSULE.radius;
    if (d > near) continue;
    // In front of the camera (any part of the capsule ahead of the lens).
    if (dx * f.x + dy * f.y + dz * f.z > -ACTOR_CAPSULE.radius) out.push(a.id);
  }
  return out;
}
