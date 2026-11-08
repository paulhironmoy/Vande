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
import { ballAt, simToScene } from '../practice/frame';

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
export type DirectorShot =
  | CameraShot
  | 'batting_pov'
  | 'result_push'
  | 'batter_eye'
  | 'practice_stumps'
  | 'replay_side'
  | 'replay_behind'
  | 'replay_top'
  | 'demo_side'
  | 'field_view'
  | 'ball_close';

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
      push(
        'celebration',
        fate.wicket === 'caught' ? decisive + 700 : fate.wicket === 'bowled' ? decisive + 900 : decisive + 800,
        end,
      );
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
  return cues.map((c) => ({
    ...c,
    shot:
      c.shot === 'bowler_follow' || c.shot === 'aerial' ? 'broadcast_end' : c.shot === 'celebration' ? 'crowd' : c.shot,
  }));
}

function vfov(fovH: number, aspect: number, minV: number, maxV: number): number {
  const v = (2 * Math.atan(Math.tan((fovH * DEG) / 2) / Math.max(0.2, aspect))) / DEG;
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
export function shotPose(
  shot: DirectorShot,
  script: BallScript,
  t: number,
  cueStart: number,
  ctx: DirectorContext,
): CameraPose {
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
    case 'demo_side':
      return practiceFixedPose(shot, script, ctx);
    case 'field_view':
      return fieldViewPose(script, ctx);
    case 'ball_close':
      return ballClosePose(script, t, ctx);
    case 'batting_pov': {
      const push = ctx.reducedMotion ? 0 : smoothstep(0, script.times.release, t) * 0.8;
      // Portrait phones: a step closer and narrower, so the bowler and the pitch fill the frame instead of the sky.
      if (portrait)
        return {
          pos: v3(-0.7, 2.25, PITCH_HALF + 4.6 - push),
          target: v3(0.05, 0.95, -8),
          fov: vfov(39, aspect, 32, 58),
        };
      return {
        pos: v3(-0.75, 2.45, PITCH_HALF + 5.6 - push),
        target: v3(0.05, 0.85, -7),
        fov: vfov(40, aspect, 34, 66),
      };
    }
    case 'broadcast_end': {
      const ball = sampleBall(script, t).pos;
      const follow = clamp(ball.x * 0.25, -0.6, 0.6);
      const pos = portrait ? v3(0.7 + follow, 10.5, -36) : v3(0.6 + follow, 6.2, -38);
      return {
        pos,
        target: v3(follow * 0.5, portrait ? 0.2 : 0.9, portrait ? 3.2 : 6.5),
        fov: vfov(portrait ? 14.5 : 12.5, aspect, 7, 40),
      };
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
      if (portrait)
        return {
          pos: add(s, v3(2.6 - drift, 1.6, -4.3)),
          target: add(s, v3(0.2, 1.1, 0)),
          fov: vfov(28, aspect, 20, 54),
        };
      return {
        pos: add(s, v3(2.4 - drift, 1.45, -4.1)),
        target: add(s, v3(0.2, 1.0, 0)),
        fov: vfov(30, aspect, 20, 60),
      };
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
      return {
        pos: v3(0.32, 0.42, PITCH_HALF + 1.6),
        target: v3(-0.05, 0.75, -6),
        fov: vfov(portrait ? 58 : 54, aspect, 36, 80),
      };
    }
    case 'aerial': {
      const a = 0.7 + (ctx.reducedMotion ? 0 : t * 0.00009);
      // Portrait: lower and closer, the square and the players rather than the whole bowl.
      const r = portrait ? 40 : 74;
      return {
        pos: v3(Math.cos(a) * r, portrait ? 30 : 44, Math.sin(a) * r),
        target: v3(0, 0, 1),
        fov: vfov(portrait ? 44 : 56, aspect, 30, 70),
      };
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
      const pos = v3(
        from.x - ux * back + uz * side,
        (portrait ? 8 : 11) + dl * (portrait ? 0.12 : 0.16),
        from.z - uz * back - ux * side,
      );
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
        return {
          pos: add(h, v3(Math.sin(a) * r, 1.8, Math.cos(a) * r)),
          target: add(h, v3(0, 1.1, 0)),
          fov: vfov(30, aspect, 20, 56),
        };
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
      return {
        pos: lerpV(from, to, u),
        target,
        fov: vfov(lerp(portrait ? 30 : 26, portrait ? 22 : 18, u), aspect, 12, 56),
      };
    }
    case 'celebration': {
      const hero = script.heroes[0] ?? 'bowler';
      const h = actorPos(script, hero, t);
      const a = (ctx.reducedMotion ? 0.8 : 0.8 + local * 0.00026) + (hero === 'striker' ? Math.PI : 0);
      const r = (hero === 'bowler' ? 8.5 : 5.2) * (portrait ? 0.8 : 1);
      return {
        pos: add(h, v3(Math.cos(a) * r, hero === 'bowler' ? 3.1 : 1.9, Math.sin(a) * r)),
        target: add(h, v3(0, 1.05, 0)),
        fov: vfov(portrait ? 38 : 38, aspect, 26, 60),
      };
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

export function cameraAt(
  script: BallScript,
  t: number,
  cues: readonly DirectorCue[],
  ctx: DirectorContext,
): CameraPose & { shot: DirectorShot } {
  const cue = cueAt(cues, t) ?? { shot: 'broadcast_end' as DirectorShot, atMs: 0, durationMs: script.duration };
  const pose = shotPose(cue.shot, script, t, cue.atMs, ctx);
  // Practice keeps a stable camera: no impact shake (the contact is felt through sound and haptics).
  if (!ctx.reducedMotion && !script.practice) {
    const s = shake(script, t);
    pose.pos = add(pose.pos, s);
  }
  return { ...pose, shot: cue.shot };
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
 * whatever the footwork (a stable view: no bob, no lunge): when the result arrives mid-flight the view does not jump
 * and the eye already on screen stays there (EMB4: `GAZE.eyeEaseMs` is 0); a replay, built from the result, uses the
 * planted stance throughout.
 */
export const BATTER_EYE = { height: 1.68, lateral: 0.2, z: PITCH_HALF - 1.2 } as const;

/**
 * The batter's view never zooms, and its horizontal field of view stays inside EMB1's 55–75° (F-024): at most 75°
 * across, so a wide phone (2.2:1) gets a 38° vertical view instead of 54° and everything down the pitch, the ball above
 * all, is 1.48× larger than with a fixed 54° vertical (97° across). A screen narrow enough for 54° vertical to fit
 * inside 75° across (up to about 1.5:1) keeps 54° vertical, widened if needed so the horizontal view stays at least 70°
 * (never past 75° vertical, the portrait limit).
 */
export const BATTER_FOV = { vertical: 54, minHorizontal: 70, maxHorizontal: 75, maxVertical: 75 } as const;

/**
 * Where the batter looks. Before release the bowler's release point sits `releaseAboveDeg` above the centre of the
 * view (run-up, action and hand readable, the pitch below). After release the eyes follow the ball as it was
 * `lagMs` ago (never where it will be), most of the way (`trackGain`), more as it comes closer (the weight ramps by
 * the ball's distance from the eye, `rampFarM` → `rampNearM`, never by time, so the gaze holds no timing cue), and no
 * faster than `maxRateDegS`. With the 75° horizontal cap (F-024) the view is narrower than it was, so the eyes stay
 * with the ball more closely (0.9 of the way, 10 ms behind it, up to 300°/s in yaw and in pitch as it arrives) to keep
 * it in the frame into the hitting area (F-012); the pitch point sits at most about three quarters of the way down.
 *
 * The last metres (owner decision 2026-11-03, F-012 option A3): as the ball comes from `closeFarM` to `closeNearM` of
 * the eye, the share of the way the eyes go rises from `trackGain` to `closeGain` (all the way), by the ball's distance,
 * never by time (`gazeTrackWeight`). The owner's condition is that this never turns the view faster, or changes its
 * turning more sharply, than the view without it, as the screen shows it. The view is judged the way EVAL-WORLD
 * measures it: 4 ms steps, and frames at each `comfortFrameMs` (at `comfortPhases` phases, and at `comfortPhasesFine`
 * for a live result's table), over the windows from the release that end by the ideal contact, that start before it,
 * that end within the first-person view, and the whole gaze (`gazePeaks`).
 *
 * Where A3 applies follows from that condition. Before its result a live script shows the rule as it is: the result can
 * take over at any moment, and up to that moment shipped showed this rule, so anything faster would be faster than
 * shipped whenever the result came early (D-1). Once a live result takes over (`gazeFrom`), the view goes on from what
 * was on screen, from the same eye, with A3 (`resultSeenNow` off: the ball as it was), and every frame stays inside what
 * shipped showed: the earlier script until the hand-over, then the result's own rule from its planted stance (shipped
 * moved the eye there and jumped; this view does neither). Each frame is held to its own budget (what it has turned so
 * far, and what its later steps must still turn while slowing down), so the view may brake as hard as shipped did. A
 * replay (a result alone) shows A3 against its own rule. A ball sample that is not a number holds the gaze where it is.
 *
 * After contact the head follows the ball (`followGain`) until the fielding camera takes over.
 *
 * Reduced motion follows less (`trackGainReduced`): only what keeps the ball readable. A3 does not apply to a script's
 * own gaze there (`closeGainReduced` equals `trackGainReduced`), so live and replay tables are shipped's exactly; after
 * a live result takes over, the share near the eye is `resultGainReduced`.
 *
 * The gaze is integrated on a fixed 4 ms grid from the release, so it is a pure function of the script: live and
 * replay frames match. The stage builds each table when it builds the script (`prewarmPracticeGaze`), not in a frame.
 * A live result's is built only as far as its first frames need: the rest, and the peaks it is held inside, are
 * measured by a scan that goes on as the table is read and in the spare time of the frames that follow
 * (`advanceGaze`); whoever does the measuring, the table is the same, bit for bit.
 */
export const GAZE = {
  releaseAboveDeg: 14,
  trackGain: 0.9,
  trackGainReduced: 0.65,
  closeGain: 1.0,
  /** Equal to trackGainReduced: A3 is not applied under Reduced Motion. */
  closeGainReduced: 0.65,
  closeFarM: 8,
  closeNearM: 2,
  comfortFrameMs: [1000 / 60, 1000 / 30],
  comfortPhases: 4,
  comfortPhasesFine: 16,
  /**
   * The eye stays where it is through the first-person view: a live result keeps the eye on screen (EMB4, head motion
   * during the delivery at most 2 cm). Were this set above 0, the eye would ease to the planted stance over this long,
   * and only once the ball had reached the batter (the ideal contact, or the contact when later). Never under Reduced
   * Motion.
   */
  eyeEaseMs: 0,
  /**
   * After a live result has taken over, whether the eyes follow the ball as it is (no lag, no smoothing). Off: offline
   * on EVAL-WORLD's 476 balls it kept the ball in view less often than the lagged ball (31 balls worse than shipped by
   * more than 1 ms against 24, 2026-11-04).
   */
  resultSeenNow: false,
  /** Reduced Motion's share after a live result has taken over, from `closeFarM` to `closeNearM` of the eye. */
  resultGainReduced: 0.65,
  lagMs: 10,
  rampFarM: 24,
  rampNearM: 12,
  maxRateDegS: 300,
  followGain: 0.9,
  followRampMs: 140,
  maxDownDeg: 65,
  maxYawDeg: 60,
  stepMs: 4,
} as const;

/** The batter's eye in the world, from the script when it carries the physics head (Practice), else the default. */
function batterEyeWorld(mirror: boolean): Vec3 {
  return v3(mirror ? BATTER_EYE.lateral : -BATTER_EYE.lateral, BATTER_EYE.height, BATTER_EYE.z);
}

/** Vertical field of view (degrees) for a horizontal one at an aspect ratio. */
function verticalFor(horizontalDeg: number, aspect: number): number {
  return (2 * Math.atan(Math.tan((horizontalDeg * DEG) / 2) / Math.max(0.2, aspect))) / DEG;
}

/** Vertical field of view (degrees) of the batter's view for an aspect ratio (BATTER_FOV). */
export function batterFov(aspect: number): number {
  const widest = verticalFor(BATTER_FOV.maxHorizontal, aspect);
  const narrowest = verticalFor(BATTER_FOV.minHorizontal, aspect);
  return Math.min(BATTER_FOV.maxVertical, clamp(BATTER_FOV.vertical, narrowest, widest));
}

const unit = (x: number, y: number, z: number): Vec3 => {
  const l = Math.hypot(x, y, z) || 1;
  return v3(x / l, y / l, z / l);
};
const yawPitchOf = (d: Vec3) => ({ yaw: Math.atan2(d.x, -d.z), pitch: Math.asin(clamp(d.y, -1, 1)) });
const fromYawPitch = (yaw: number, pitch: number): Vec3 =>
  v3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
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
  /** A live result's table: where it takes over inside a grid cell (see Knot). */
  knot?: Knot;
  /** A table integrated as it is read (`integrateGaze` lazily): computes its entries up to k. */
  fill?: (k: number) => void;
}
/**
 * A live result's gaze takes over at the hand-over itself, inside a grid cell: until `t` the cell is the earlier
 * script's (from entry index - 1 towards its entry index, `nextYaw`/`nextPitch`), exactly as that script showed it;
 * from `t` (where it showed `yaw`/`pitch`) the cell runs to this table's own entry `index`.
 */
interface Knot {
  t: number;
  index: number;
  yaw: number;
  pitch: number;
  nextYaw: number;
  nextPitch: number;
}
/** A script's gaze and the rule without A3 (its comfort reference; the same table when A3 does not apply). */
interface GazePair {
  table: GazeTable;
  ref: GazeTable;
  /** A live result's gaze: the peaks it is held inside are scanned as far as the table has asked, and the rest as spare time allows. */
  scan?: PeakScan;
}
const gazeTables = new WeakMap<BallScript, { normal?: GazePair; reduced?: GazePair }>();

function practiceEye(script: BallScript): Vec3 {
  const p = script.practice!;
  return p.eye ?? batterEyeWorld(p.mirror);
}

/**
 * The share of the way the eyes go towards the ball `distM` from the eye, before contact. Far away it is nothing (the
 * ramp `rampFarM` → `rampNearM`); then `trackGain`, rising to `closeGain` as the ball comes from `closeFarM` to
 * `closeNearM` (A3). Under Reduced Motion it is `trackGainReduced` throughout, because `closeGainReduced` is the same.
 */
export function gazeTrackWeight(distM: number, reducedMotion: boolean): number {
  const far = reducedMotion ? GAZE.trackGainReduced : GAZE.trackGain;
  const close = reducedMotion ? GAZE.closeGainReduced : GAZE.closeGain;
  return weightWith(far, close, distM);
}
function weightWith(far: number, close: number, distM: number): number {
  return (
    (far + (close - far) * smoothstep(GAZE.closeFarM, GAZE.closeNearM, distM)) *
    smoothstep(GAZE.rampFarM, GAZE.rampNearM, distM)
  );
}

// Rotation vectors (axis × angle, radians) between unit directions, for the comfort limits.
const cross3 = (a: Vec3, b: Vec3): Vec3 => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const len3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const scale3 = (a: Vec3, k: number): Vec3 => v3(a.x * k, a.y * k, a.z * k);
/** The rotation (axis × angle) that takes unit direction a to unit direction b. */
function turnBetween(a: Vec3, b: Vec3): Vec3 {
  const c = cross3(a, b);
  const s = len3(c);
  return s > 1e-15 ? scale3(c, Math.atan2(s, dot3(a, b)) / s) : v3(0, 0, 0);
}
/** Unit direction a turned by the rotation r (Rodrigues). */
function turned(a: Vec3, r: Vec3): Vec3 {
  const th = len3(r);
  if (th < 1e-15) return a;
  const k = scale3(r, 1 / th);
  const c = Math.cos(th);
  const s = Math.sin(th);
  const kxa = cross3(k, a);
  const kd = dot3(k, a) * (1 - c);
  return v3(a.x * c + kxa.x * s + k.x * kd, a.y * c + kxa.y * s + k.y * kd, a.z * c + kxa.z * s + k.z * kd);
}

/** Per 4 ms step: the largest turn (rad), yaw-and-pitch step (rad) and change of turn (rad per step). */
interface GazeLimit {
  turn: number;
  yawPitch: number;
  change: number;
}

/**
 * The windows the view is judged over, from the release: 0 the steps and frames that end by the ideal contact, 1 those
 * that start before it (the one showing the contact too), 2 those that end within the first-person view, 3 the whole
 * table (a replay from the batter's eye shows all of it).
 */
interface GazePeaks {
  from: number;
  ideal: number;
  fp: number;
  /** Per window (rad per 4 ms step): turn, yaw-and-pitch step, change of turn. */
  gridTurn: number[];
  yawPitch: number[];
  gridChange: number[];
  /** Per comfort frame rate (GAZE.comfortFrameMs order), per window (rad per frame): turn and change of turn. */
  frameTurn: number[][];
  frameChange: number[][];
  /** The same at every one of `comfortPhasesFine` phases (frameTurn and frameChange hold the `comfortPhases` subset). */
  frameTurnAll: number[][];
  frameChangeAll: number[][];
  /**
   * Set when the peaks are scanned as they are asked for (a live result's): `capOf` and `frameCap` first have the scan
   * complete every window they read (`PeakScan.require`), so what they return is what a whole scan would give.
   */
  scan?: PeakScan;
}
/** The limits sit this fraction inside the reference peaks, so the stored (Float32) table never touches them. */
const LIMIT_MARGIN = 1e-3;

function tableDir(table: GazeTable, i: number): Vec3 {
  return fromYawPitch(table.yaw[i], table.pitch[i]);
}

/** The table's gaze at scene time t (linear between grid entries; the base before the release). */
function gazeOf(table: GazeTable, t: number): Vec3 {
  const x = (t - table.from) / GAZE.stepMs;
  if (x <= 0) return fromYawPitch(table.base.yaw, table.base.pitch);
  const i = Math.min(table.yaw.length - 2, Math.floor(x));
  if (table.fill) table.fill(i + 1);
  const u = Math.min(1, x - i);
  const k = table.knot;
  if (k && i === k.index - 1) {
    if (t < k.t)
      return fromYawPitch(
        table.yaw[i] + wrap(k.nextYaw - table.yaw[i]) * u,
        table.pitch[i] + (k.nextPitch - table.pitch[i]) * u,
      );
    const v = Math.min(1, (t - k.t) / (table.from + k.index * GAZE.stepMs - k.t));
    return fromYawPitch(k.yaw + wrap(table.yaw[k.index] - k.yaw) * v, k.pitch + (table.pitch[k.index] - k.pitch) * v);
  }
  const yaw = table.yaw[i] + wrap(table.yaw[i + 1] - table.yaw[i]) * u;
  const pitch = table.pitch[i] + (table.pitch[i + 1] - table.pitch[i]) * u;
  return fromYawPitch(yaw, pitch);
}

/** The knot of a table taking over from `table` at scene time t (in the cell before grid entry `index`). */
function knotOf(table: GazeTable, index: number, t: number): Knot {
  const i = index - 1;
  const u = Math.min(1, (t - table.from) / GAZE.stepMs - i);
  return {
    t,
    index,
    yaw: table.yaw[i] + wrap(table.yaw[index] - table.yaw[i]) * u,
    pitch: table.pitch[i] + (table.pitch[index] - table.pitch[i]) * u,
    nextYaw: table.yaw[index],
    nextPitch: table.pitch[index],
  };
}

/** Records a value for an interval [a, b] in every window it belongs to. */
function putPeak(vals: number[], v: number, a: number, b: number, ideal: number, fp: number): void {
  vals[3] = Math.max(vals[3], v);
  if (b <= fp) vals[2] = Math.max(vals[2], v);
  if (a < ideal) vals[1] = Math.max(vals[1], v);
  if (b <= ideal) vals[0] = Math.max(vals[0], v);
}

/** The reference gaze a scan measures: its grid entries and the gaze between them (`sample`, across a hand-over not the table's own). */
interface PeakSource {
  from: number;
  n: number;
  yaw: (i: number) => number;
  pitch: (i: number) => number;
  sample: (t: number) => Vec3;
}

/** One frame chain of a scan: a comfort frame rate at one phase, walking forward a frame at a time. */
interface FrameChain {
  ri: number;
  F: number;
  /** Counted in the comfortPhases peaks as well as the all-phase ones. */
  main: boolean;
  t: number;
  end: number;
  prevDir: Vec3 | null;
  prevTurn: Vec3 | null;
}

/**
 * A reference gaze's peaks, measured the way the screen is judged: steps of the 4 ms grid from the second (the first
 * starts at the release itself), changes of turn from the second pair, and frames at every comfort frame rate (the
 * first frame 1 ms after the release). `sample` gives the reference between grid points when that is not the table's
 * interpolation (what the screen showed across a hand-over). With `fine`, frames are taken at `comfortPhasesFine`
 * phases (the `comfortPhases` ones kept apart) and only over the first-person view, for a table held to frame budgets.
 *
 * The scan walks forward in time and can stop and go on: `coverTo(T)` has measured every step and frame that ends by T,
 * whatever came before, so measuring in pieces gives the peaks measuring all at once gives, bit for bit (a peak is the
 * largest of what was measured, and each chain keeps its own place).
 */
class PeakScan {
  readonly pk: GazePeaks;
  /** Grid steps and frames measured so far: how callers that pay for the scan a bit at a time count it. */
  units = 0;
  /** Set once someone is giving the scan spare time (`advanceGaze`): reading the gaze then pays for much less of it. */
  driven = false;
  private covered = Number.NEGATIVE_INFINITY;
  private gi = 1;
  private gPrev: Vec3 | null = null;
  private gPrevDir: Vec3;
  private readonly chains: FrameChain[] = [];
  private readonly dt = GAZE.stepMs;
  private readonly maxF = Math.max(...GAZE.comfortFrameMs);

  constructor(
    script: BallScript,
    private readonly src: PeakSource,
    fine: boolean,
  ) {
    const p = script.practice!;
    const { from, n } = src;
    const tableEnd = from + (n - 1) * this.dt;
    const ideal = Math.min(tableEnd, p.flight ? simToScene(p, p.flight.idealContactT) : p.releaseScene);
    const fp = Math.min(
      tableEnd,
      Number.isFinite(p.firstPersonUntil) ? Math.min(p.firstPersonUntil, script.duration) : script.duration,
    );
    const zero = () => [0, 0, 0, 0];
    this.pk = {
      from,
      ideal,
      fp,
      gridTurn: zero(),
      yawPitch: zero(),
      gridChange: zero(),
      frameTurn: GAZE.comfortFrameMs.map(zero),
      frameChange: GAZE.comfortFrameMs.map(zero),
      frameTurnAll: GAZE.comfortFrameMs.map(zero),
      frameChangeAll: GAZE.comfortFrameMs.map(zero),
    };
    this.gPrevDir = fromYawPitch(src.yaw(0), src.pitch(0));
    GAZE.comfortFrameMs.forEach((F, ri) => {
      const phases = fine ? GAZE.comfortPhasesFine : GAZE.comfortPhases;
      const per = phases / GAZE.comfortPhases;
      const end = fine ? Math.min(tableEnd, fp + 2 * F) : tableEnd;
      for (let k = 0; k < phases; k++)
        this.chains.push({
          ri,
          F,
          main: k % per === 0,
          t: from + 1 + (k * F) / phases,
          end,
          prevDir: null,
          prevTurn: null,
        });
    });
  }

  /** Whether every step and frame is measured. */
  get complete(): boolean {
    return this.gi >= this.src.n && this.chains.every((c) => c.t > c.end);
  }

  /** Measures every grid step and frame that ends by scene time T (before anything later). */
  coverTo(T: number): void {
    if (T <= this.covered) return;
    const { from, n } = this.src;
    while (this.gi < n && from + this.gi * this.dt <= T) this.gridStep(this.gi++);
    for (const c of this.chains) while (c.t <= c.end && c.t <= T) this.frame(c);
    this.covered = T;
  }

  /**
   * Has measured what the windows read at `level` need: 0 the steps and frames that end by the ideal contact, 1 those
   * that start before it, 2 those that end within the first-person view, 3 all of them (`capOf` and `frameCap` say which).
   */
  require(level: 0 | 1 | 2 | 3): void {
    const pk = this.pk;
    this.coverTo(
      level === 0
        ? pk.ideal
        : level === 1
          ? pk.ideal + 2 * this.maxF + 2 * this.dt
          : level === 2
            ? pk.fp
            : Number.POSITIVE_INFINITY,
    );
  }

  /** Goes on measuring, a short stretch of time at a time, until about `units` more are done or nothing is left. True while some is left. */
  step(units: number): boolean {
    const until = this.units + units;
    while (this.units < until && !this.complete)
      this.coverTo((Number.isFinite(this.covered) ? this.covered : this.src.from) + SCAN_CHUNK_MS);
    return !this.complete;
  }

  private gridStep(i: number): void {
    const { src, pk, dt } = this;
    const { from } = src;
    const dir = fromYawPitch(src.yaw(i), src.pitch(i));
    const r = turnBetween(this.gPrevDir, dir);
    this.gPrevDir = dir;
    const t0 = from + (i - 1) * dt;
    const t1 = from + i * dt;
    if (i >= 2) {
      const turn = len3(r);
      const yp = Math.hypot(wrap(src.yaw(i) - src.yaw(i - 1)), src.pitch(i) - src.pitch(i - 1));
      putPeak(pk.gridTurn, turn, t0, t1, pk.ideal, pk.fp);
      putPeak(pk.yawPitch, yp, t0, t1, pk.ideal, pk.fp);
    }
    const prev = this.gPrev;
    if (i >= 3 && prev)
      putPeak(pk.gridChange, Math.hypot(r.x - prev.x, r.y - prev.y, r.z - prev.z), t0 - dt, t1, pk.ideal, pk.fp);
    this.gPrev = r;
    this.units++;
  }

  /** The chain's frame at its time t, then on to the next. */
  private frame(c: FrameChain): void {
    const { pk } = this;
    const { t, F, ri } = c;
    const d = this.src.sample(t);
    if (c.prevDir) {
      const r = turnBetween(c.prevDir, d);
      const l = len3(r);
      putPeak(pk.frameTurnAll[ri], l, t - F, t, pk.ideal, pk.fp);
      if (c.main) putPeak(pk.frameTurn[ri], l, t - F, t, pk.ideal, pk.fp);
      if (c.prevTurn) {
        const ch = Math.hypot(r.x - c.prevTurn.x, r.y - c.prevTurn.y, r.z - c.prevTurn.z);
        putPeak(pk.frameChangeAll[ri], ch, t - 2 * F, t, pk.ideal, pk.fp);
        if (c.main) putPeak(pk.frameChange[ri], ch, t - 2 * F, t, pk.ideal, pk.fp);
      }
      c.prevTurn = r;
    }
    c.prevDir = d;
    c.t += F;
    this.units++;
  }
}

/** A scan goes on in stretches of this much scene time (about six grid steps and the frames of every chain in it). */
const SCAN_CHUNK_MS = 24;

/** The peaks of a table, measured whole (`sample` when it is not the table's own interpolation). */
function gazePeaks(
  script: BallScript,
  ref: GazeTable,
  sample: (t: number) => Vec3 = (t) => gazeOf(ref, t),
  fine = false,
): GazePeaks {
  const scan = new PeakScan(
    script,
    { from: ref.from, n: ref.yaw.length, yaw: (i) => ref.yaw[i], pitch: (i) => ref.pitch[i], sample },
    fine,
  );
  scan.coverTo(Number.POSITIVE_INFINITY);
  return scan.pk;
}

/**
 * The smallest peak over the windows that any step or frame touching [t0, …] can belong to: `span` is how far back
 * from t0 such an interval can start (one step, a frame, or two of either for a change of turn).
 */
function capOf(pk: GazePeaks, vals: readonly number[], t0: number, span: number): number {
  pk.scan?.require(t0 < pk.ideal ? 0 : t0 < pk.ideal + span ? 1 : t0 < pk.fp ? 2 : 3);
  let c = vals[3];
  if (t0 < pk.fp) c = Math.min(c, vals[2]);
  if (t0 < pk.ideal + span) c = Math.min(c, vals[1]);
  if (t0 < pk.ideal) c = Math.min(c, vals[0]);
  return c;
}

/**
 * The limit for grid step i (from entry i - 1 to entry i): every grid step and every frame (at each comfort rate and
 * any phase) that holds part of it stays inside the reference's peak over each window it can belong to. A frame turns
 * no more than its steps' turns together, so a step stays within the frame peak's share; a frame's change of turn
 * spans up to ceil(frameMs / stepMs) step boundaries, so the per-step change is kept that much lower.
 */
function stepLimit(pk: GazePeaks, i: number, budgets = false): GazeLimit {
  const dt = GAZE.stepMs;
  const t0 = pk.from + (i - 1) * dt;
  let turn = capOf(pk, pk.gridTurn, t0, dt);
  const yawPitch = capOf(pk, pk.yawPitch, t0, dt);
  let change = capOf(pk, pk.gridChange, t0, 2 * dt);
  if (!budgets)
    GAZE.comfortFrameMs.forEach((F, ri) => {
      const k = dt / F;
      const m = F / dt;
      const spread = m / Math.ceil(m - 1e-9);
      turn = Math.min(turn, capOf(pk, pk.frameTurn[ri], t0, F) * k);
      change = Math.min(change, capOf(pk, pk.frameChange[ri], t0, 2 * F) * k * k * spread);
    });
  return { turn, yawPitch, change };
}

/** The peak a whole frame [a, b] at comfort rate ri may reach (its change of turn: the pair ending at b). */
function frameCap(pk: GazePeaks, ri: number, a: number, b: number, change: boolean, main = true): number {
  // A frame at one of the comfortPhases phases is judged against those phases' peaks, any other against all phases'.
  const vals = main
    ? change
      ? pk.frameChange[ri]
      : pk.frameTurn[ri]
    : change
      ? pk.frameChangeAll[ri]
      : pk.frameTurnAll[ri];
  const start = change ? a - GAZE.comfortFrameMs[ri] : a;
  pk.scan?.require(b <= pk.ideal ? 0 : start < pk.ideal ? 1 : b <= pk.fp ? 2 : 3);
  let c = vals[3];
  if (b <= pk.fp) c = Math.min(c, vals[2]);
  if (start < pk.ideal) c = Math.min(c, vals[1]);
  if (b <= pk.ideal) c = Math.min(c, vals[0]);
  return c;
}

/** One step held inside a limit: first the yaw-and-pitch step, then the turn, then its change from the last turn. */
/** A ball in rotation-vector space (rad per step) the step must stay inside. */
interface StepBall {
  c: Vec3;
  r: number;
}

function withinLimit(
  yaw: number,
  pitch: number,
  from: Vec3,
  nextYaw: number,
  nextPitch: number,
  last: Vec3 | null,
  lim: GazeLimit,
  extra: readonly StepBall[] = [],
  span = 1,
): [number, number] {
  // A step shorter than the grid (`span` of it, from a hand-over) is judged by its rate: rotations per full step.
  const keep = 1 - LIMIT_MARGIN;
  const yawPitchCap = (y: number, q: number): [number, number] => {
    const dy = wrap(y - yaw);
    const dp = q - pitch;
    const h = Math.hypot(dy, dp);
    const m = lim.yawPitch * keep * span;
    return h > m ? [yaw + (dy * m) / h, pitch + (dp * m) / h] : [y, q];
  };
  [nextYaw, nextPitch] = yawPitchCap(nextYaw, nextPitch);
  let r = scale3(turnBetween(from, fromYawPitch(nextYaw, nextPitch)), 1 / span);
  // The frame budgets first and the step's own caps last, so a step that cannot meet every frame budget still keeps
  // the step caps.
  const balls: StepBall[] = [
    ...extra,
    { c: v3(0, 0, 0), r: lim.turn * keep },
    ...(last ? [{ c: last, r: lim.change * keep }] : []),
  ];
  const into = (b: StepBall) => {
    const d = v3(r.x - b.c.x, r.y - b.c.y, r.z - b.c.z);
    const dl = len3(d);
    if (dl > b.r) r = v3(b.c.x + (d.x * b.r) / dl, b.c.y + (d.y * b.r) / dl, b.c.z + (d.z * b.r) / dl);
  };
  const inside = (b: StepBall) => Math.hypot(r.x - b.c.x, r.y - b.c.y, r.z - b.c.z) <= b.r * (1 + 1e-9);
  // Alternating projections onto every constraint: the balls (convex) and the yaw-and-pitch step, until all hold. A
  // step no constraint binds comes out of the first pass unchanged.
  let out: [number, number] = [nextYaw, nextPitch];
  for (let it = 0; it < 24; it++) {
    for (const b of balls) into(b);
    const o = yawPitchOf(turned(from, scale3(r, span)));
    const y0 = yaw + wrap(o.yaw - yaw);
    out = yawPitchCap(y0, o.pitch);
    const yawPitchHolds = out[0] === y0 && out[1] === o.pitch;
    if (!yawPitchHolds) r = scale3(turnBetween(from, fromYawPitch(out[0], out[1])), 1 / span);
    if (yawPitchHolds && (extra.length === 0 || balls.every(inside))) break;
    if (!yawPitchHolds && balls.every(inside)) break;
  }
  return out;
}

/** The ball as the eyes have it on each grid step (lagged and smoothed; the same for every eye), shared by the passes. */
interface BallTrack {
  /** Grid entries 0…upTo-1 are worked out; the passes that share the track fill it in order, each as far as it goes. */
  upTo: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
}

/** Grid entries 0…index taken as they are from another table (the gaze already shown), the rest integrated after. */
interface GazeStart {
  index: number;
  table: GazeTable;
  /** Scene ms of the hand-over inside the cell before `index` (the knot); otherwise entry `index` is copied too. */
  at?: number;
}

/** The turn of grid step k (from entry k - 1 to entry k) of a table being built (k ≥ 1, entries known). */
function stepTurnOf(table: GazeTable, k: number): Vec3 {
  return turnBetween(tableDir(table, k - 1), tableDir(table, k));
}

/**
 * The largest x ≥ 0 with s0·x + Σ s·max(0, x + d) ≤ room (each later step of a frame adds its share, offset by d):
 * piecewise linear and increasing in x, solved breakpoint by breakpoint.
 */
function budgetRadius(room: number, s0: number, later: ReadonlyArray<readonly [number, number]>): number {
  if (room <= 0) return 0;
  const items = later
    .filter(([sk]) => sk > 1e-12)
    .slice()
    .sort((a, b) => b[1] - a[1]);
  let slope = s0;
  let off = 0; // Σ s·d over the active items
  let k = 0;
  // Items with d ≥ 0 are active from x = 0.
  while (k < items.length && items[k][1] >= 0) {
    slope += items[k][0];
    off += items[k][0] * items[k][1];
    k++;
  }
  if (off >= room) return 0;
  for (;;) {
    const x = (room - off) / slope;
    if (k >= items.length || x <= -items[k][1]) return Math.max(0, x);
    slope += items[k][0];
    off += items[k][0] * items[k][1];
    k++;
  }
}

/**
 * The largest turn (rad per step) step i may take inside a frame with `room` (rad) left, when the frame's later steps
 * can each turn at most `brake` (rad per step) less than the step before: the step, and what the frame must still turn
 * while slowing down, fit in the room.
 */
function brakingTurn(room: number, share: number, t1: number, b: number, brake: number): number {
  const dt = GAZE.stepMs;
  const later: Array<[number, number]> = [];
  for (let k = 1; t1 + (k - 1) * dt < b - 1e-9; k++)
    later.push([Math.min(1, (b - (t1 + (k - 1) * dt)) / dt), -k * brake]);
  return budgetRadius(room, share, later);
}

/**
 * Budgets for step i from the frames (every comfort frame rate, at `GAZE.comfortPhasesFine` phases) that began before the
 * first limited step and so hold steps the per-step caps never saw. Turn: what the frame has turned so far plus this
 * step's share stays within the frame's peak (triangle inequality). Change of turn: the integral of |ω(s) − ω(s − frame)|
 * over the frame, which bounds the change between it and the frame before, stays within that peak (a ball around the
 * step one frame earlier).
 */
function straddleBalls(
  table: GazeTable,
  pk: GazePeaks,
  i: number,
  firstLimited: number,
  all = false,
  turns: Float64Array | null = null,
  brake = 0,
  knotTurn: Vec3 | null = null,
): StepBall[] {
  const dt = GAZE.stepMs;
  const from = table.from;
  const knot = table.knot && knotTurn ? table.knot : null;
  // A step from a hand-over knot starts at the hand-over.
  const t0 = knot && i === knot.index ? knot.t : from + (i - 1) * dt;
  const t1 = from + i * dt;
  const tL = from + (firstLimited - 1) * dt;
  const keep = 1 - LIMIT_MARGIN;
  const out: StepBall[] = [];
  const turnOf = (k: number): Vec3 =>
    turns ? v3(turns[3 * k], turns[3 * k + 1], turns[3 * k + 2]) : stepTurnOf(table, k);
  // The step whose interval starts at or before tt and ends after it (never past the last entry built, i - 1).
  const stepAfter = (tt: number) => Math.min(i - 1, Math.max(1, Math.floor((tt - from) / dt + 1e-7) + 1));
  // The view's rotation rate at s (per full step): constant per step, and in a knot's cell the earlier script's
  // before the hand-over.
  const inKnotBefore = (s: number) => knot !== null && s >= from + (knot.index - 1) * dt && s < knot.t;
  const velAt = (s: number): Vec3 => (inKnotBefore(s) ? knotTurn! : turnOf(stepAfter(s)));
  // Where the rate at s next changes.
  const nextBreak = (s: number) => (inKnotBefore(s) ? knot!.t : from + stepAfter(s) * dt);
  // ∫ |ω(s) − ω(s − F)| ds over [p0, p1] (all earlier than t0), in radians.
  const diffIntegral = (p0: number, p1: number, F: number) => {
    let sum = 0;
    for (let s0 = p0; s0 < p1 - 1e-9;) {
      const q0 = s0 - F;
      // Each pass crosses a change of rate of either the frame or the frame before it (at least 1e-6 ms forward).
      const e = Math.max(s0 + 1e-6, Math.min(p1, nextBreak(s0), nextBreak(q0) + F));
      const rk = velAt(s0);
      const rj = velAt(q0);
      sum += ((e - s0) / dt) * Math.hypot(rk.x - rj.x, rk.y - rj.y, rk.z - rj.z);
      s0 = e;
    }
    return sum;
  };
  if (knot && i === knot.index) {
    // The grid's own intervals that hold the hand-over (EVAL-WORLD's 1 ms grid and its 4 ms grid 0.001 ms on): the
    // earlier script's part and this step's share stay within the grid turn peak.
    const cap = stepLimit(pk, i, true).turn * keep;
    for (const [a, len] of [
      [from + Math.floor(knot.t - from), 1],
      [from + (i - 1) * dt + 0.001, dt],
    ] as const) {
      const b = a + len;
      if (b <= knot.t) continue;
      const before = Math.acos(clamp(dot3(gazeOf(table, a), gazeOf(table, knot.t)), -1, 1));
      const share = (Math.min(b, t1) - knot.t) / dt;
      if (share > 1e-9) out.push({ c: v3(0, 0, 0), r: Math.max(0, ((cap * len) / dt - before) / share) });
    }
  }
  GAZE.comfortFrameMs.forEach((F, ri) => {
    for (let ph = 0; ph < GAZE.comfortPhasesFine; ph++) {
      const off = from + 1 + (ph * F) / GAZE.comfortPhasesFine;
      for (let fn = Math.max(0, Math.floor((t0 - off) / F)); off + fn * F < t1; fn++) {
        const a = off + fn * F;
        const b = a + F;
        if (b <= t0) continue;
        const share = (Math.min(b, t1) - Math.max(a, t0)) / dt;
        if (share <= 1e-9) continue;
        if ((all || a < tL) && a < t0) {
          const before = Math.acos(
            clamp(
              dot3(gazeOf(table, a), knot && i === knot.index ? gazeOf(table, knot.t) : tableDir(table, i - 1)),
              -1,
              1,
            ),
          );
          const room =
            frameCap(pk, ri, a, b, false, ph % (GAZE.comfortPhasesFine / GAZE.comfortPhases) === 0) * keep - before;
          out.push({ c: v3(0, 0, 0), r: all ? brakingTurn(room, share, t1, b, brake) : Math.max(0, room / share) });
        }
        if (fn >= 1 && (all || a - F < tL) && a - F >= from + 1) {
          const done = a < t0 ? diffIntegral(a, t0, F) : 0;
          // This step's share, shifted one frame back, lies over one or more earlier rates: one ball around the first.
          const q0 = Math.max(a, t0) - F;
          const q1 = Math.min(b, t1) - F;
          const r1 = velAt(q0);
          const split = Math.min(q1, nextBreak(q0));
          const len1 = (split - q0) / dt;
          const len2 = (q1 - split) / dt;
          let extra = 0;
          for (let s0 = split; s0 < q1 - 1e-9;) {
            const e = Math.max(s0 + 1e-6, Math.min(q1, nextBreak(s0)));
            const r2 = velAt(s0);
            extra += ((e - s0) / dt) * Math.hypot(r1.x - r2.x, r1.y - r2.y, r1.z - r2.z);
            s0 = e;
          }
          const room =
            frameCap(pk, ri, a, b, true, ph % (GAZE.comfortPhasesFine / GAZE.comfortPhases) === 0) * keep -
            done -
            extra;
          if (!all) {
            out.push({ c: r1, r: Math.max(0, room / (len1 + len2)) });
            continue;
          }
          // The frame's later steps must still meet their counterparts one frame back, moving at most `brake` a step.
          const later: Array<[number, number]> = [];
          for (let k = 1; t1 + (k - 1) * dt < b - 1e-9; k++) {
            const sk = Math.min(1, (b - (t1 + (k - 1) * dt)) / dt);
            const pk2 = velAt(t1 + (k - 0.5) * dt - F);
            later.push([sk, Math.hypot(r1.x - pk2.x, r1.y - pk2.y, r1.z - pk2.z) - k * brake]);
          }
          out.push({ c: r1, r: budgetRadius(room, len1 + len2, later) });
        }
      }
    }
  });
  return out;
}

/**
 * When the eye starts towards the planted stance after a live result's hand-over: not before the ball has reached the
 * batter (the ideal contact, or the contact itself when later), so the head stays still through the delivery (EMB4).
 */
function eyeEaseFrom(script: BallScript): number {
  const p = script.practice!;
  const at = p.gazeFrom?.atScene ?? Number.NEGATIVE_INFINITY;
  const ideal = p.flight ? simToScene(p, p.flight.idealContactT) : Number.NEGATIVE_INFINITY;
  return Math.max(at, ideal, p.contactScene ?? Number.NEGATIVE_INFINITY);
}

/**
 * Where the eye is at scene time t. A live result keeps the eye on screen at the hand-over and, with `eyeEaseMs`, once
 * the ball has reached the batter moves it smoothly (no jump, zero speed at both ends) to the result's planted stance;
 * otherwise it stays.
 */
function eyeAt(script: BallScript, t: number, reducedMotion: boolean): Vec3 {
  const p = script.practice!;
  const eye = practiceEye(script);
  const to = p.stanceEye;
  const h = p.gazeFrom;
  if (reducedMotion || !to || !h || GAZE.eyeEaseMs <= 0) return eye;
  const s = eyeEaseFrom(script);
  if (t <= s) return eye;
  const u = smoothstep(s, s + GAZE.eyeEaseMs, t);
  return u >= 1 ? to : lerpV(eye, to, u);
}

/**
 * The gaze over the delivery with the near-eye share `close` (the reference rule when it equals the far share) and,
 * given peaks, every step from the first moment the ball is within `closeFarM` (or from a hand-over) held inside
 * them. Frames that began before that first limited step also get a budget (`straddleBalls`), so no frame mixing
 * earlier steps with limited ones can exceed the peaks either. `track` is filled by the first pass and read by the
 * others (the same seen ball, computed once). With `start`, the entries up to `start.index` are the given table's and
 * the eyes continue from there. `eye` fixes the eye (otherwise the script's eye, eased after a hand-over). `lazy`
 * returns the table with the entries already on screen and integrates the rest as it is read (`fill`), step by step in
 * the same order, so the table is the same, bit for bit, however it is read; `onFill` is called after each read of it.
 */
function integrateGaze(
  script: BallScript,
  reducedMotion: boolean,
  close: number,
  peaks: GazePeaks | null,
  track: BallTrack | null = null,
  start: GazeStart | null = null,
  eye: Vec3 | null = null,
  lazy = false,
  onFill: (() => void) | null = null,
): GazeTable {
  const p = script.practice!;
  const eye0 = eye ?? practiceEye(script);
  const moving = eye === null && !reducedMotion && Boolean(p.gazeFrom && p.stanceEye) && GAZE.eyeEaseMs > 0;
  const rel = p.releaseWorld;
  const toRelease = yawPitchOf(unit(rel.x - eye0.x, rel.y - eye0.y, rel.z - eye0.z));
  const base = { yaw: toRelease.yaw, pitch: toRelease.pitch - GAZE.releaseAboveDeg * DEG };
  const from = p.releaseScene;
  const until = Math.min(script.duration, from + 9000);
  const n = Math.max(2, Math.ceil((until - from) / GAZE.stepMs) + 1);
  const yaws = new Float32Array(n);
  const pitches = new Float32Array(n);
  const far = reducedMotion ? GAZE.trackGainReduced : GAZE.trackGain;
  const follow = reducedMotion ? GAZE.trackGainReduced : GAZE.followGain;
  const maxStep = GAZE.maxRateDegS * DEG * (GAZE.stepMs / 1000);
  let yaw = base.yaw;
  let pitch = base.pitch;
  let last: Vec3 | null = null;
  let here = peaks ? fromYawPitch(yaw, pitch) : null;
  let near = false;
  // A live result takes over at the hand-over itself (a knot inside its grid cell), unless that falls on the cell's end.
  const knotAt = start?.at;
  const knot =
    start &&
    knotAt !== undefined &&
    Number.isFinite(knotAt) &&
    start.index >= 1 &&
    from + start.index * GAZE.stepMs - knotAt >= 1e-3 * GAZE.stepMs
      ? knotOf(start.table, start.index, knotAt)
      : null;
  /** The earlier script's rate (per full step) in the knot's cell. */
  const knotTurn = knot
    ? turnBetween(tableDir(start!.table, knot.index - 1), tableDir(start!.table, knot.index))
    : null;
  const copyTo = start ? (knot ? start.index - 1 : start.index) : -1;
  /** The first limited step (its interval starts at from + (firstLimited - 1) * stepMs, or at the knot). */
  let firstLimited = start ? copyTo + 1 : Number.POSITIVE_INFINITY;
  const partial: GazeTable = { from, yaw: yaws, pitch: pitches, base, ...(knot ? { knot } : {}) };
  // A live result's table holds every frame to its budget (exact), up to the end of the first-person view.
  const budgets = start !== null && eye === null && peaks !== null;
  const turns = budgets ? new Float64Array(3 * n) : null;
  const budgetEnd = peaks ? peaks.fp + 2 * Math.max(...GAZE.comfortFrameMs) : 0;
  let prevStored: Vec3 | null = null;
  // Frame budgets are needed only where a step of the last two frames went past the per-step share of the frame peaks
  // (which alone keeps every frame inside them); elsewhere the step caps suffice.
  const horizon = Math.ceil((2 * Math.max(...GAZE.comfortFrameMs)) / GAZE.stepMs) + 2;
  let lastUnsafe = firstLimited - 1;
  const keepIn = 1 - LIMIT_MARGIN;
  const store = (k: number) => {
    if (!turns) return;
    const d = fromYawPitch(yaws[k], pitches[k]);
    if (knot && k === knot.index) prevStored = fromYawPitch(knot.yaw, knot.pitch);
    if (prevStored && k >= 1) {
      const r =
        knot && k === knot.index
          ? scale3(turnBetween(prevStored, d), GAZE.stepMs / (from + k * GAZE.stepMs - knot.t))
          : turnBetween(prevStored, d);
      turns[3 * k] = r.x;
      turns[3 * k + 1] = r.y;
      turns[3 * k + 2] = r.z;
    }
    prevStored = d;
  };
  const shared = track !== null && track.x.length === n ? track : null;
  let next = 0;
  // One grid step after another, up to entry `to`.
  const advance = (to: number) => {
    for (; next <= Math.min(to, n - 1); next++) {
      const i = next;
      const t = from + i * GAZE.stepMs;
      let b: Vec3;
      // After a live result has taken over the swing is made: the eyes may follow the ball as it is (resultSeenNow).
      if (GAZE.resultSeenNow && budgets && i > start!.index) b = sampleBall(script, t).pos;
      else if (shared && i < shared.upTo) b = v3(shared.x[i], shared.y[i], shared.z[i]);
      else {
        b = seenBall(script, t);
        if (shared) {
          shared.x[i] = b.x;
          shared.y[i] = b.y;
          shared.z[i] = b.z;
          if (i === shared.upTo) shared.upTo = i + 1;
        }
      }
      if (start && i <= copyTo) {
        // Already on screen: the eyes were here.
        yaw = start.table.yaw[i];
        pitch = start.table.pitch[i];
        yaws[i] = yaw;
        pitches[i] = pitch;
        store(i);
        if (here) {
          const there = fromYawPitch(yaw, pitch);
          if (i >= 1) last = turnBetween(here, there);
          here = there;
        }
        continue;
      }
      // The step from the knot: the eyes are where the earlier script showed them at the hand-over, turning as it did.
      let span = 1;
      if (knot && i === knot.index) {
        yaw = knot.yaw;
        pitch = knot.pitch;
        if (here) {
          here = fromYawPitch(yaw, pitch);
          last = knotTurn;
        }
        span = (t - knot.t) / GAZE.stepMs;
      }
      const e = moving ? eyeAt(script, t, reducedMotion) : eye0;
      const dist = Math.hypot(b.x - e.x, b.y - e.y, b.z - e.z);
      if (!Number.isFinite(dist)) {
        // A ball sample that is not a number (bad input): the eyes hold where they are instead of turning undefined.
        yaws[i] = yaw;
        pitches[i] = pitch;
        store(i);
        if (here && i >= 1) last = v3(0, 0, 0);
        continue;
      }
      const to = yawPitchOf(unit(b.x - e.x, b.y - e.y, b.z - e.z));
      let w = p.flight ? weightWith(far, close, dist) : 0;
      if (p.contactScene !== null && t > p.contactScene)
        w = lerp(w, follow, smoothstep(p.contactScene, p.contactScene + GAZE.followRampMs, t));
      const wantYaw = base.yaw + clamp(wrap(to.yaw - base.yaw) * w, -GAZE.maxYawDeg * DEG, GAZE.maxYawDeg * DEG);
      const wantPitch = clamp(base.pitch + (to.pitch - base.pitch) * w, -GAZE.maxDownDeg * DEG, 30 * DEG);
      let nextYaw = yaw + clamp(wrap(wantYaw - yaw), -maxStep * span, maxStep * span);
      let nextPitch = pitch + clamp(wantPitch - pitch, -maxStep * span, maxStep * span);
      if (peaks && !near && dist < GAZE.closeFarM) {
        near = true;
        if (!start) firstLimited = Math.max(1, i);
      }
      const lim =
        peaks && i >= firstLimited && (!budgets || t - GAZE.stepMs <= budgetEnd) ? stepLimit(peaks, i, budgets) : null;
      // Only frames that began before the first limited step need a budget; they end within two frames of it.
      const straddling =
        budgets || i <= firstLimited + Math.ceil((2 * Math.max(...GAZE.comfortFrameMs)) / GAZE.stepMs) + 2;
      if (lim && budgets) {
        const safe = stepLimit(peaks!, i, false);
        const fits = (y: number, q: number) => {
          const r = scale3(turnBetween(here!, fromYawPitch(y, q)), 1 / span);
          return (
            len3(r) <= safe.turn * keepIn &&
            (!last || Math.hypot(r.x - last.x, r.y - last.y, r.z - last.z) <= safe.change * keepIn) &&
            Math.hypot(wrap(y - yaw), q - pitch) <= safe.yawPitch * keepIn * span
          );
        };
        if (i - lastUnsafe <= horizon || !fits(nextYaw, nextPitch)) {
          // How fast a frame's later steps can be assumed to slow down: by the step's own change cap; under Reduced
          // Motion by the geometric mean of that and the per-step share of the frame peaks, so frames keep room and the
          // view seldom has to brake (EVAL-WORLD's 476 balls, 2026-11-04: Reduced Motion above shipped on 11 balls, not
          // 25, with the ball in view as long; in Normal the same costs view on 5 balls, so not there).
          const brake = reducedMotion ? Math.min(lim.change, Math.sqrt(lim.change * safe.change)) : lim.change;
          [nextYaw, nextPitch] = withinLimit(
            yaw,
            pitch,
            here!,
            nextYaw,
            nextPitch,
            last,
            lim,
            straddleBalls(partial, peaks!, i, firstLimited, true, turns, brake * keepIn, knotTurn),
            span,
          );
          if (!fits(nextYaw, nextPitch)) lastUnsafe = i;
        }
      } else if (lim)
        [nextYaw, nextPitch] = withinLimit(
          yaw,
          pitch,
          here!,
          nextYaw,
          nextPitch,
          last,
          lim,
          straddling
            ? straddleBalls(partial, peaks!, i, firstLimited, budgets, turns, lim.change * (1 - LIMIT_MARGIN))
            : [],
        );
      if (here) {
        const there = fromYawPitch(nextYaw, nextPitch);
        if (i >= 1) last = scale3(turnBetween(here, there), 1 / span);
        here = there;
      }
      yaw = nextYaw;
      pitch = nextPitch;
      yaws[i] = yaw;
      pitches[i] = pitch;
      store(i);
    }
  };
  const table: GazeTable = { from, yaw: yaws, pitch: pitches, base, ...(knot ? { knot } : {}) };
  if (!lazy) {
    advance(n - 1);
    return table;
  }
  advance(copyTo);
  table.fill = (k: number) => {
    if (k >= next) advance(k);
    if (next >= n) delete table.fill;
    onFill?.();
  };
  return table;
}

/**
 * Where a live result script's gaze takes over from the script shown before it (`gazeFrom`): the grid entry after the
 * hand-over (`index`). The grid entries before it are the earlier script's, and the result takes over at the hand-over
 * itself, inside that cell, from where the earlier script was (`Knot`), so the view does not jump.
 */
function handoverOf(script: BallScript, reducedMotion: boolean): { index: number; pair: GazePair } | null {
  const p = script.practice!;
  const h = p.gazeFrom;
  if (
    !h ||
    h.script === script ||
    !h.script.practice ||
    h.script.practice.releaseScene !== p.releaseScene ||
    !Number.isFinite(h.atScene)
  )
    return null;
  const pair = gazePair(h.script, reducedMotion);
  const index = Math.min(
    pair.table.yaw.length - 1,
    Math.max(0, Math.floor((h.atScene - pair.table.from) / GAZE.stepMs) + 1),
  );
  return { index, pair };
}

function buildGaze(script: BallScript, reducedMotion: boolean): GazePair {
  const far = reducedMotion ? GAZE.trackGainReduced : GAZE.trackGain;
  const close = reducedMotion ? GAZE.closeGainReduced : GAZE.closeGain;
  const p = script.practice!;
  const prev = handoverOf(script, reducedMotion);
  const a3 = close !== far && Boolean(p.flight);
  const n = Math.max(
    2,
    Math.ceil((Math.min(script.duration, p.releaseScene + 9000) - p.releaseScene) / GAZE.stepMs) + 1,
  );
  const track: BallTrack | null =
    a3 || prev ? { upTo: 0, x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n) } : null;
  if (!prev) {
    // The rule without A3: the gaze itself when A3 does not apply, otherwise the comfort reference for A3.
    const ref = integrateGaze(script, reducedMotion, far, null, track);
    if (!a3) return { table: ref, ref };
    // A live script before its result shows the rule as it is: the result can take over at any moment, and what the
    // screen shows up to then is judged against what shipped showed up to then, which is this rule.
    if (!p.result) return { table: ref, ref };
    return { table: integrateGaze(script, reducedMotion, close, gazePeaks(script, ref), track), ref };
  }
  // A live result taking over: the gaze continues from what was on screen, from the eye on screen. Every step after
  // the hand-over stays inside the peaks of what the screen showed before the eye was kept (the earlier script's
  // rule until the hand-over, then the result's own rule from its planted stance), window by window.
  const index = Math.min(prev.index, n - 1);
  const stance = p.stanceEye ?? practiceEye(script);
  const at = p.gazeFrom!.atScene;
  const head = prev.pair.ref;
  // The result's own rule is integrated only as far as the peaks ask: of its whole table (nine seconds, half of it with the
  // ball in a fielder's hands) the first-person view shows the first second or so. What the screen showed is `head`'s until
  // the hand-over, then `own`'s.
  const own = integrateGaze(script, reducedMotion, far, null, track, null, stance, true);
  const shown = (k: number): GazeTable => {
    if (k < index && k < head.yaw.length) return head;
    own.fill?.(k);
    return own;
  };
  const peaks = lazyPeaks(
    script,
    {
      from: own.from,
      n: own.yaw.length,
      yaw: (k) => shown(k).yaw[k],
      pitch: (k) => shown(k).pitch[k],
      sample: (t) => (t < at ? gazeOf(head, t) : gazeOf(own, t)),
    },
    at,
  );
  const gain = reducedMotion ? GAZE.resultGainReduced : close;
  // Integrated as frames read it (play() pays only for what comes before; each frame for its own few steps, and a few
  // more of the scan the peaks are still being measured by: the stage gives it the spare time of frames as well).
  const scan = peaks.scan;
  const table = integrateGaze(
    script,
    reducedMotion,
    gain,
    peaks,
    track,
    { index, table: prev.pair.table, at },
    null,
    true,
    scan ? () => void scan.step(scan.driven ? PAY_DRIVEN_UNITS : PAY_UNITS) : null,
  );
  return { table, ref: table, ...(scan ? { scan } : {}) };
}

/**
 * What reading a lazily built gaze pays for the scan it waits on, in scan units (a grid step or a frame: a microsecond or
 * so each): with no one else working on it, enough to be done before the windows beyond the ideal contact are read; with
 * the stage's spare time on it (`advanceGaze`), a little, so that it goes on even when the frames have no spare time.
 */
const PAY_UNITS = 800;
const PAY_DRIVEN_UNITS = 100;

/**
 * The peaks of a live result's reference gaze, measured as they are asked for. The windows nest (those that end by the
 * ideal contact lie inside those that start before it and inside the first-person view, which lies inside all of it) when
 * the first-person view outlasts the ideal contact by the span of a change of turn; then a step or a frame reads only
 * the windows up to its own, and `capOf` and `frameCap` have the scan complete exactly those first. What the table's
 * first step reads is measured now (the windows to the ideal contact when the result takes over before it, as a swing's
 * does; all of it when the hand-over is already past them, as a leave's is, as it always was). Where the windows do not
 * nest, everything is measured now, as it always was.
 */
function lazyPeaks(script: BallScript, src: PeakSource, handoverAt: number): GazePeaks {
  const scan = new PeakScan(script, src, true);
  const pk = scan.pk;
  const maxF = Math.max(...GAZE.comfortFrameMs);
  if (pk.ideal <= pk.fp && pk.fp >= pk.ideal + 2 * maxF + 2 * GAZE.stepMs) {
    pk.scan = scan;
    scan.require(handoverAt - 2 * maxF < pk.ideal ? 0 : handoverAt - 2 * maxF < pk.ideal + 2 * maxF ? 1 : 3);
  } else scan.coverTo(Number.POSITIVE_INFINITY);
  return pk;
}

function gazePair(script: BallScript, reducedMotion: boolean): GazePair {
  let cache = gazeTables.get(script);
  if (!cache) {
    cache = {};
    gazeTables.set(script, cache);
  }
  const key = reducedMotion ? 'reduced' : 'normal';
  return (cache[key] ??= buildGaze(script, reducedMotion));
}

/** The first-person gaze direction (unit) at scene time t: a pure function of the script, so replays match live. */
export function practiceGaze(script: BallScript, t: number, reducedMotion: boolean): Vec3 {
  return gazeOf(gazePair(script, reducedMotion).table, t);
}

/**
 * Builds a script's gaze now, so that no animation frame pays for it (the stage calls this when it builds a script,
 * outside its frame callback). Frames then only read the table. Idempotent.
 */
export function prewarmPracticeGaze(script: BallScript, reducedMotion: boolean): void {
  if (script.practice) gazePair(script, reducedMotion);
}

/**
 * Takes a live result's gaze on by about `units` of what its peaks still have to be measured for (a grid step or a frame
 * each), so no frame has to: the stage calls this with the spare time of frames. True while some is left; false for any
 * gaze that has nothing left (every other script's).
 */
export function advanceGaze(script: BallScript, reducedMotion: boolean, units: number): boolean {
  const scan = gazeTables.get(script)?.[reducedMotion ? 'reduced' : 'normal']?.scan;
  if (!scan) return false;
  scan.driven = true;
  return scan.step(units);
}

/** Whether a script's gaze is already built for this motion setting (the next frame will not build it). */
export function practiceGazeReady(script: BallScript, reducedMotion: boolean): boolean {
  return Boolean(gazeTables.get(script)?.[reducedMotion ? 'reduced' : 'normal']);
}

function batterEyePose(script: BallScript, t: number, ctx: DirectorContext): CameraPose {
  const p = script.practice;
  const eye = p ? eyeAt(script, t, ctx.reducedMotion) : batterEyeWorld(false);
  const dir = p ? practiceGaze(script, t, ctx.reducedMotion) : v3(0, -0.17, -1);
  return {
    pos: eye,
    target: v3(eye.x + dir.x * 10, eye.y + dir.y * 10, eye.z + dir.z * 10),
    fov: batterFov(ctx.aspect),
  };
}

/**
 * How high (m above the turf) the side replay looks in landscape, whatever the contact's height. It used to look at the
 * contact (0.2 to 1.4 m): a low one, which is every full ball, miss and bowled ball, pitched the camera down by 10 to 16°
 * and, in a 36° view, stood the batter in the top half of the picture with the top of his helmet above the edge for much
 * of the replay (F6, the motion reel, 2026-11-07). At about his belt, from the same place and with the same field of
 * view, his whole figure is in the picture (tests/unit/render3d/camera-side-headroom.test.ts) and the contact, which the
 * camera still faces, is 56% to 86% of the way down it. Portrait keeps looking at the contact: its 56° view holds the
 * batter at any aim from 0.2 to 1.4 m.
 */
export const REPLAY_SIDE_AIM_Y = 0.95;

/** Fixed cameras: the broken wicket after a bowled, and the three external replay views. */
function practiceFixedPose(
  shot: 'practice_stumps' | 'replay_side' | 'replay_behind' | 'replay_top' | 'demo_side',
  script: BallScript,
  ctx: DirectorContext,
): CameraPose {
  const p = script.practice;
  const m = p?.mirror ? -1 : 1;
  const crease = PITCH_HALF - POPPING;
  const r = p?.result ?? null;
  const contact =
    r?.contact.point ??
    (p?.flight ? ballAt(p.flight.samples, p.flight.idealContactT) : null) ??
    v3(0, 0.5, crease - 0.6);
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
      return {
        pos: v3(3.3 * m, 1.0, PITCH_HALF - 1.5),
        target: v3(0, 0.38, PITCH_HALF + 0.1),
        fov: vertical(portrait ? 44 : 28),
      };
    case 'replay_side':
      return {
        pos: v3(3.4 * m, 1.3, crease - 2.7),
        target: portrait ? focus : v3(focus.x, REPLAY_SIDE_AIM_Y, focus.z),
        fov: vertical(portrait ? 56 : 36),
      };
    case 'replay_behind':
      return {
        pos: v3(0.5 * m, 2.5, -17.5),
        target: v3(focus.x * 0.6, 0.75, crease - 0.6),
        fov: vertical(portrait ? 26 : 15),
      };
    case 'replay_top':
      return {
        pos: v3(1.0 * m, 8.5, crease - 4.2),
        target: v3(focus.x * 0.5, 0, crease - 1.8),
        fov: vertical(portrait ? 70 : 58),
      };
    case 'demo_side':
      // Coach Mode's demonstration: square of the batter on the off side and a little in front, wide enough for the
      // stride, the whole bat path and the ball arriving, at the batter's own height.
      return {
        pos: v3(3.6 * m, 1.35, crease - 2.4),
        target: v3(focus.x * 0.4 - 0.15 * m, 0.8, crease - 0.25),
        fov: vertical(portrait ? 62 : 40),
      };
  }
}

/**
 * The consequence after a hit (dead ball and replays): high behind the striker, looking along the ball's path, framing
 * the striker's end and where the ball finished (or was caught or fielded), so the path over the ground and the
 * fielders it beat or met read at a glance. A pure function of the result.
 */
function fieldViewPose(script: BallScript, ctx: DirectorContext): CameraPose {
  const p = script.practice;
  const m = p?.mirror ? -1 : 1;
  const r = p?.result ?? null;
  const striker = v3(0, 0, CONTACT_Z);
  let end = v3(0, 0, CONTACT_Z - 30);
  if (r) {
    const e = r.events.find((x) => x.kind === 'catch' || x.kind === 'field' || x.kind === 'boundary');
    const last = r.ball[r.ball.length - 1]?.p;
    const at = e && 'p' in e ? e.p : last;
    if (at) end = v3(at.x * m, 0, at.z);
  }
  const dx = end.x - striker.x;
  const dz = end.z - striker.z;
  const d = Math.max(8, Math.hypot(dx, dz));
  const ux = dx / d;
  const uz = dz / d;
  const mid = v3(striker.x + dx * 0.55, 0, striker.z + dz * 0.55);
  const back = clamp(d * 0.42, 9, 30);
  const height = clamp(d * 0.55, 10, 34);
  const pos = v3(striker.x - ux * back, height, striker.z - uz * back);
  const span = Math.hypot(mid.x - pos.x, height, mid.z - pos.z);
  const fov = clamp((2 * Math.atan((d * 0.62) / span)) / DEG, 34, ctx.aspect < 1 ? 78 : 64);
  return { pos, target: mid, fov };
}

/** The training close-up: the ball, large, seen from the batter's side, in the hand and then leaving it. */
const BALL_CLOSE = { back: 0.55, side: 0.12, below: 0.04, fov: 24 } as const;
function ballClosePose(script: BallScript, t: number, ctx: DirectorContext): CameraPose {
  const p = script.practice;
  const rel = p ? p.releaseScene : script.times.release;
  const focus = t < rel && p ? p.releaseWorld : sampleBall(script, t).pos;
  const m = p?.mirror ? -1 : 1;
  const pos = v3(focus.x - BALL_CLOSE.side * m, focus.y - BALL_CLOSE.below, focus.z + BALL_CLOSE.back);
  return {
    pos,
    target: focus,
    fov: clamp(BALL_CLOSE.fov / Math.min(1, Math.max(0.55, ctx.aspect / 1.6)), BALL_CLOSE.fov, 40),
  };
}

/**
 * Practice's live plan: the batter's eye from the start of the run-up, with no cut until after contact or a miss.
 * After a bat contact the head follows the ball, then the fielding camera; after a bowled, the broken wicket; a
 * leave, a miss or a pad stays in first person to the end.
 */
export function practicePlan(script: BallScript, reducedMotion: boolean): DirectorCue[] {
  const p = script.practice!;
  const end = Math.max(1, script.duration);
  if (!Number.isFinite(p.firstPersonUntil) || p.external === 'none')
    return [{ shot: 'batter_eye', atMs: 0, durationMs: end }];
  const fp = clamp(p.firstPersonUntil, 1, end - 1);
  const after: DirectorShot =
    p.external === 'stumps' ? 'practice_stumps' : reducedMotion ? 'broadcast_end' : 'fielder_follow';
  return [
    { shot: 'batter_eye', atMs: 0, durationMs: fp },
    { shot: after, atMs: fp, durationMs: end - fp },
  ];
}

/** One fixed (or first-person) camera for a whole replay. */
export function replayShot(camera: 'batter' | 'side' | 'behind' | 'top'): DirectorShot {
  return camera === 'batter'
    ? 'batter_eye'
    : camera === 'side'
      ? 'replay_side'
      : camera === 'behind'
        ? 'replay_behind'
        : 'replay_top';
}

/** A standing player as the camera checks it: a vertical capsule around the actor (metres). */
const ACTOR_CAPSULE = { radius: 0.38, bottom: 0.05, top: 1.9 } as const;

/**
 * Actors whose body comes within `near` metres of the camera inside its view: they would fill the foreground of an
 * external shot. Pure; the stage hides them, and the director's own dismissal shots are tested to have none.
 */
export function occludingActors(
  script: BallScript,
  t: number,
  pose: CameraPose,
  near = 1.5,
  skip: ReadonlySet<string> = new Set(),
): string[] {
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
