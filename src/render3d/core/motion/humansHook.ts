/**
 * The pose hook for the bowler and the two batters (StageScene `poseHook`, composed after the bowler's release cue and
 * the field hook): their feet planted on the turf (WEB-FIELD's planted-foot plan, core/locomotion.ts FootPlan and
 * plantFeet, applied to these tracks too) — a stance foot stays where it landed through the bowler's run-up and the
 * batters' running, so the body no longer skates over the grass, and the hips drop a little rather than over-stretch
 * a leg. Presentation only: the root is always the track's (physics or layout) position; nothing here moves an actor.
 *
 * Pure in (track, t): each track's plan is built forward from a fixed anchor and cached per script (create one hook
 * per script with `humansPoseHookFor`). Mirrored tracks (a left-handed batter, a left-arm bowler) are planted in their
 * drawn (mirrored) form: the pose is mirrored for the solve and back, so the stage's own mirror then shows it.
 */
import { evaluateActor, lookScale, type ActorTrack, type PhysicsBodyPlan } from '../actors';
import type { BallScript } from '../choreo';
import { clipDuration, createPose, mirrorSampledPose, motionSource, samplePresented, type ClipId, type SampledPose } from '../clips';
import type { PoseHook } from '../fieldClips';
import { FootPlan, createJoints, forwardKinematics, jointWorld, localToWorld, plantFeet, twoBoneIK, worldToLocal, type Joints } from '../locomotion';
import { type Vec3, smoothstep } from '../math';
import { BONE_INDEX, type BoneName } from '../skeleton';

/** The actors this hook plants. */
const HUMAN_TRACKS: ReadonlySet<string> = new Set(['bowler', 'striker', 'nonStriker', 'bowler:measure']);
/** Stepping cycles: the gait loops these actors run and walk with (their phase drives the stance windows). */
const GAIT_LOOPS: ReadonlySet<string> = new Set(['bowl_runup', 'bowl_approach_spin', 'bat_run', 'walk', 'jog', 'run', 'run_drive', 'vmp:loco_walk', 'vmp:loco_jog', 'vmp:loco_run', 'vmp:loco_sprint']);
/** The plan fades in over this long from its anchor (no step where it starts). */
const FADE_IN_MS = 300;

export interface HumansHookOptions {
  /** A hook the stage applies before this one (the bowler's release cue and rise): the plan must see its result. */
  prior?: PoseHook;
  /**
   * The bat the stage will put in an actor's hands at t (world: cap and toe), or null: the striker's trunk then turns
   * (and, at the last, his hips shift over planted feet) until both shoulders can reach their grip points, so the arm IK
   * after the pose always closes the gloves round the handle (round 3: hands on the bat). The bat is never moved.
   */
  batOf?: (track: ActorTrack, t: number) => { grip: Vec3; toe: Vec3 } | null;
}

/**
 * A pose hook that can build its slow plans ahead of the frame that needs them (see `warmHumans`). `legs` is the hook
 * without the reach of the bat (what the stride decision, script.ts strideGovernedSteps, asks of the legs); `forget` drops
 * every plan the hook holds for a track whose moves or physics body are no longer what the plans were made from.
 */
export type WarmablePoseHook = PoseHook & {
  warm?: (track: ActorTrack, budgetMs: number, from?: number) => boolean;
  legs?: PoseHook;
  forget?: (track: ActorTrack) => void;
};

const HOOKS = new WeakMap<BallScript, WarmablePoseHook>();

/**
 * Builds the script's striker plans for `track` ahead of the frame that first poses him (the first frame after a camera
 * cut to him: the reach plan is about 15 ms at 1x, 60 ms and more on a phone): at most `budgetMs` of wall time per call,
 * resumable, the reach of the bat from scene time `from` on first (default: from the start of the stroke). True once
 * nothing is left to build. The plans are the same bit for bit as when built in the frame that needs them.
 */
export function warmHumans(script: BallScript, track: ActorTrack, budgetMs: number, from?: number): boolean {
  return HOOKS.get(script)?.warm?.(track, budgetMs, from) ?? true;
}

/** The hook for a script, created once per script and reused every frame (its plans are built as the script plays). */
export function humansPoseHookFor(script: BallScript, opts: HumansHookOptions = {}): WarmablePoseHook {
  const hit = HOOKS.get(script);
  if (hit) return hit;
  const hook = humansPoseHook(script, opts);
  HOOKS.set(script, hook);
  return hook;
}

/** Swaps the left and right foot contact bits (the canonical mirror, MOTION-SPEC §3). */
const mirrorFeet = (c: number) => (c & ~3) | ((c & 1) << 1) | ((c & 2) >> 1);

interface Scratch {
  a: SampledPose;
  b: SampledPose;
  lower: SampledPose;
}

export function humansPoseHook(script: BallScript, opts: HumansHookOptions = {}): WarmablePoseHook {
  void script;
  const anchor = 0;
  interface State {
    track: ActorTrack;
    scale: number;
    plan: FootPlan;
    joints: Joints;
    targets: Float32Array;
  }
  const states = new Map<string, State>();

  /** The pose the stage draws before this hook (in its drawn, mirrored form), and the gait it steps in. */
  const base = (track: ActorTrack, t: number, s: Scratch) => {
    const st = evaluateActor(track, t);
    const pose = samplePresented(st, s.a, s.b, s.lower);
    opts.prior?.(track, pose, t);
    const mirror = Boolean(track.mirror);
    if (mirror) mirrorSampledPose(pose);
    // The legs' clip: the footwork layer when there is one, else the clip itself.
    const legs: { clip: ClipId; time: number } = st.current.lower ? { clip: st.current.lower, time: st.current.lowerTime ?? 0 } : st.current;
    const src = motionSource(legs.clip);
    let contacts: number | undefined;
    if (src?.contacts) {
      contacts = src.contacts(legs.time);
      if (mirror) contacts = mirrorFeet(contacts);
    }
    let gait: { phase: number; v: number } | null = null;
    if (GAIT_LOOPS.has(legs.clip) && contacts === undefined) {
      const t0 = Math.max(0, t - 50);
      const a = evaluateActor(track, t0).pos;
      const b = evaluateActor(track, t0 + 100).pos;
      const v = Math.hypot(b.x - a.x, b.z - a.z) / 0.1 / (lookScale(track.look) || 1);
      const phase = (((legs.time / clipDuration(legs.clip)) % 1) + 1) % 1;
      gait = { phase: mirror ? (phase + 0.5) % 1 : phase, v };
    }
    return { pose, st, gait, ...(contacts !== undefined ? { contacts } : {}) };
  };

  const stateOf = (track: ActorTrack): State => {
    let s = states.get(track.id);
    if (s && s.track === track) return s;
    const scale = lookScale(track.look);
    const scratch: Scratch = { a: createPose(), b: createPose(), lower: createPose() };
    const plan = new FootPlan(track, anchor, scale, (t) => base(track, t, scratch));
    s = { track, scale, plan, joints: createJoints(), targets: new Float32Array(8) };
    states.set(track.id, s);
    return s;
  };

  /** The planted-foot targets at t (faded in from the anchor), or null before the plan starts. */
  const plannedAt = (s: State, t: number, out: Float32Array): Float32Array | null => {
    const targets = s.plan.at(t, out);
    if (!targets) return null;
    const k = smoothstep(anchor, anchor + FADE_IN_MS, t);
    if (k < 1) for (let f = 0; f < 2; f++) targets[f * 4 + 3] *= k;
    return targets;
  };

  const fits = new WeakMap<ActorTrack, StrikerFit>();
  const fitScratch: Scratch = { a: createPose(), b: createPose(), lower: createPose() };
  const fitTargets = new Float32Array(8);
  const fitJoints = createJoints();

  /** The striker's fit to the physics body (solved once per track at its reference frames; see PhysicsBodyPlan). */
  const fitOf = (track: ActorTrack, s: State, body: PhysicsBodyPlan): StrikerFit => {
    const hit = fits.get(track);
    if (hit) return hit;
    const legOf = (front: boolean): 0 | 1 => ((body.frontLeg === 'L') === front ? 0 : 1);
    /** The pads by drawn leg [L, R] and the heights the shins must cross them at. */
    const byLeg = (pads: [Vec3, Vec3], h: [number, number]) => {
      const out: { pads: [Vec3, Vec3]; h: [number, number] } = { pads: [pads[0], pads[1]], h: [h[0], h[1]] };
      out.pads[legOf(true)] = pads[0];
      out.pads[legOf(false)] = pads[1];
      out.h[legOf(true)] = h[0];
      out.h[legOf(false)] = h[1];
      return out;
    };
    /**
     * The ankle offsets [L, R] and the hips' (index 2) that put the shins across their pads' axes at the wanted heights,
     * with the hips on `hipsAt` (world x/z) when given, else half way with the feet.
     */
    const solve = (t: number, want: { pads: [Vec3, Vec3]; h: [number, number] }, on: ActorTrack = track, os: State = s, hipsAt: Vec3 | null = null, hit: { leg: 0 | 1; ball: Vec3; axis: Vec3 } | null = null): Fit3 => {
      const d: Fit3 = [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }];
      const st = evaluateActor(on, t);
      const root = { x: st.pos.x + (st.body?.x ?? 0), y: 0, z: st.pos.z + (st.body?.z ?? 0) };
      if (hipsAt) {
        forwardKinematics(base(on, t, fitScratch).pose, fitJoints);
        const h = jointWorld(fitJoints, 'hips', root, st.heading, s.scale);
        d[2] = { x: hipsAt.x - h.x, z: hipsAt.z - h.z };
      }
      for (let it = 0; it < 8; it++) {
        if (!hipsAt) d[2] = hipsOf(d[0], d[1]);
        const planned = plannedAt(os, t, fitTargets);
        const pose = base(on, t, fitScratch).pose;
        legsOnPads(pose, fitJoints, planned, d[0], d[1], d[2], root, st.heading, s.scale);
        for (let f = 0; f < 2; f++) {
          const side = f === 0 ? 'L' : 'R';
          const a = jointWorld(fitJoints, `foot${side}`, root, st.heading, s.scale);
          const k = jointWorld(fitJoints, `shin${side}`, root, st.heading, s.scale);
          if (hit && hit.leg === f && it === 0) {
            // The drawn pad's surface on the ball: the shin's axis stands off the ball by how far the drawn pad stands
            // proud of the physics capsule at the ball's height (PAD_PROUD_M, measured on the drawn mesh; a pass that
            // fitted the pad's own geometry, drawnPadDepth, measured worse: zz-pad 05:5xZ p95 4.0, max 6.0 cm).
            const dx = hit.ball.x - hit.axis.x;
            const dz = hit.ball.z - hit.axis.z;
            const l = Math.hypot(dx, dz) || 1;
            const y = hit.ball.y;
            const bias = PAD_PROUD_M.shoe + (PAD_PROUD_M.shin - PAD_PROUD_M.shoe) * smoothstep(0.1, 0.35, y) + PAD_PROUD_M.knee * smoothstep(0.42, 0.52, y);
            want.pads[f] = { x: hit.axis.x - (dx / l) * bias, y: 0, z: hit.axis.z - (dz / l) * bias };
          }
          const u = (want.h[f] - a.y) / Math.max(1e-3, k.y - a.y);
          d[f].x += want.pads[f].x - (a.x + (k.x - a.x) * u);
          d[f].z += want.pads[f].z - (a.z + (k.z - a.z) * u);
        }
      }
      if (!hipsAt) d[2] = hipsOf(d[0], d[1]);
      return d;
    };
    const stance = solve(body.stanceRefAt, byLeg(body.stance, [STANCE_FIT.heightM, STANCE_FIT.heightM]));
    // The ready hold, measured on the waiting moves alone (identical before and after the result).
    let ready: Fit3 | null = null;
    if (body.ready) {
      const waiting: ActorTrack = { ...track, id: `${track.id}:ready`, moves: body.ready.moves, physicsBody: undefined };
      ready = solve(body.ready.refAt, byLeg(body.stance, [STANCE_FIT.heightM, STANCE_FIT.heightM]), waiting, stateOf(waiting));
    }
    let stroke: StrikerFit['stroke'] = null;
    const before0 = (): Fit3 => (body.ready && ready ? ready : stance);
    /** The hips' move from the stance to the stroke's place: over the stride, or longer when its size asks (§9). */
    const hipsWindow = (b: NonNullable<PhysicsBodyPlan['stroke']>, from: Fit3, to: Fit3): number => {
      const D = Math.hypot(to[2].x - from[2].x, to[2].z - from[2].z);
      return Math.max(b.plantAt - b.strideAt, Math.sqrt((6 * D) / HIPS_ACCEL_MAX) * 1000);
    };
    /** Each foot's drawn ankle at t with these offsets (world). */
    const anklesAt = (t: number, d: Fit3): [Vec3, Vec3] => {
      const st0 = evaluateActor(track, t);
      const root0 = { x: st0.pos.x + (st0.body?.x ?? 0), y: 0, z: st0.pos.z + (st0.body?.z ?? 0) };
      const pose0 = base(track, t, fitScratch).pose;
      legsOnPads(pose0, fitJoints, plannedAt(s, t, fitTargets), d[0], d[1], d[2], root0, st0.heading, s.scale);
      return [jointWorld(fitJoints, 'footL', root0, st0.heading, s.scale), jointWorld(fitJoints, 'footR', root0, st0.heading, s.scale)];
    };
    /**
     * Each foot from where it stands as the stride starts to where it lands, by a step of its own (lifted, in the
     * window from the input to the plant), the one going further first; one moving at most PLANTED_TRAVEL_M stays down.
     */
    const stepsFor = (b: NonNullable<PhysicsBodyPlan['stroke']>, before: Fit3, after: Fit3): StrikerFit['pins'] => {
      const a0 = anklesAt(b.strideAt, before);
      const a1 = anklesAt(b.refAt, after);
      const travel = [0, 1].map((f) => Math.hypot(a1[f].x - a0[f].x, a1[f].z - a0[f].z));
      const first = travel[0] >= travel[1] ? 0 : 1;
      const both = travel[0] > PLANTED_TRAVEL_M && travel[1] > PLANTED_TRAVEL_M;
      const W = b.plantAt - b.strideAt;
      return [0, 1].map((f) => {
        const steps = travel[f] > PLANTED_TRAVEL_M;
        const [u0, u1] = !both ? [0, 1] : f === first ? [0, 0.7] : [0.3, 1];
        return { from: a0[f], to: a1[f], t0: b.strideAt + u0 * W, t1: b.strideAt + u1 * W, lift: steps ? Math.min(STEP_LIFT_M, 0.02 + 0.3 * travel[f]) : 0 };
      }) as StrikerFit['pins'];
    };
    if (body.stroke && !body.stroke.governed) {
      // Not governed: the feet stay as the clip places them (the stance offsets carried on), the hips with them, and
      // the trunk leans at most TRUNK_NATURAL_DEG onto the physics torso top and head.
      const b = body.stroke;
      const legs = ready ?? stance;
      const st = evaluateActor(track, b.refAt);
      const root = { x: st.pos.x + (st.body?.x ?? 0), y: 0, z: st.pos.z + (st.body?.z ?? 0) };
      const pose = base(track, b.refAt, fitScratch).pose;
      legsOnPads(pose, fitJoints, plannedAt(s, b.refAt, fitTargets), legs[0], legs[1], legs[2], root, st.heading, s.scale);
      const trunk = trunkFit(pose, fitJoints, worldToLocal(b.torsoTop, root, st.heading, s.scale), worldToLocal(b.head, root, st.heading, s.scale), TRUNK_NATURAL_DEG);
      // The feet step to where the clip (an authored overlay or the procedural stride) lands them, a planted foot held
      // down: no drift with the clip's hips (round 2: the overlay's own foot paths slid 10–14 cm while down, probe zz-stride).
      stroke = { legs, trunk, pins: stepsFor(b, legs, legs), recover: null, restEnd: Infinity, hipsMs: hipsWindow(b, before0(), legs) };
    } else if (body.stroke) {
      const b = body.stroke;
      // The pad the ball hits: its drawn surface on the ball (drawnPadDepth), refitted at every pass of the solve.
      const pads: [Vec3, Vec3] = [b.pads[0], b.pads[1]];
      let hit: { leg: 0 | 1; ball: Vec3; axis: Vec3 } | null = null;
      if (b.hitBall) {
        const i = Math.hypot(b.hitBall.x - pads[0].x, b.hitBall.z - pads[0].z) <= Math.hypot(b.hitBall.x - pads[1].x, b.hitBall.z - pads[1].z) ? 0 : 1;
        hit = { leg: legOf(i === 0), ball: b.hitBall, axis: pads[i] };
      }
      const legs = solve(b.refAt, byLeg(pads, b.hitH), track, s, b.torsoBase, hit);
      // Each foot from the stance pads to the stroke's, never carried by the clip's own drift.
      const before = body.ready && ready ? ready : stance;
      const pins = stepsFor(b, before, legs);
      // The trunk at the reference frame, on the fitted legs: chest and spine lean the neck over the physics torso
      // top, then the neck turns the head onto the physics head (each a constant rotation in the actor frame).
      const st = evaluateActor(track, b.refAt);
      const root = { x: st.pos.x + (st.body?.x ?? 0), y: 0, z: st.pos.z + (st.body?.z ?? 0) };
      const planned = plannedAt(s, b.refAt, fitTargets);
      const pose = base(track, b.refAt, fitScratch).pose;
      legsOnPads(pose, fitJoints, planned, legs[0], legs[1], legs[2], root, st.heading, s.scale);
      const top = worldToLocal(b.torsoTop, root, st.heading, s.scale);
      const head = worldToLocal(b.head, root, st.heading, s.scale);
      const trunk = trunkFit(pose, fitJoints, top, head);
      stroke = { legs, trunk, pins, recover: null, restEnd: Infinity, hipsMs: hipsWindow(b, before, legs) };
    }
    // Where the rest pose puts each foot as the fade ends (no offsets): the feet step there, never slide (round 3).
    if (stroke && body.stroke && Number.isFinite(body.releaseAt)) {
      const next = track.moves.find((m) => m.t0 <= body.releaseAt && body.releaseAt < m.t1);
      if (next && next.clip === 'bat_rest') {
        const zero: Fit3 = [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }];
        stroke.recover = anklesAt(Math.min(next.t1, body.releaseAt + FADE_AFTER_REST_MS + body.fadeMs + RECOVER_SETTLE_MS), zero);
        stroke.restEnd = next.t1;
      }
    }
    const fit: StrikerFit = { stance, ready, stroke };
    fits.set(track, fit);
    return fit;
  };

  /**
   * The batters' first steps into a run (round 7; see FirstLeg), planned once per track from the run's set-off (its
   * first `bat_run` move): the run's legs sampled at 120 Hz for their contacts and ankles, each foot held exactly where
   * it stands until the run lifts it, then carried in the air along the run's own swing onto where the run puts it
   * down, and held there; the swing that starts FIRST_LEG_MS in hands the foot back to the planted-foot plan.
   */
  const firstLegs = new WeakMap<ActorTrack, FirstLeg | null>();
  const legScratch: Scratch = { a: createPose(), b: createPose(), lower: createPose() };
  const legJoints = createJoints();
  const legTargets = new Float32Array(8);
  const firstLegOf = (track: ActorTrack, s: State): FirstLeg | null => {
    if (firstLegs.has(track)) return firstLegs.get(track)!;
    firstLegs.set(track, null);
    const runMove = track.moves.find((m) => m.clip === 'bat_run' && m.t0 > 0);
    if (!runMove) return null;
    const at = runMove.t0;
    const dt = 1000 / 120;
    const n = Math.ceil(FIRST_LEG_SCAN_MS / dt) + 1;
    const ank: [Vec3[], Vec3[]] = [[], []];
    const down: [boolean[], boolean[]] = [[], []];
    const sole: [Vec3[][], Vec3[][]] = [[], []];
    for (let i = 0; i < n; i++) {
      const b = base(track, at + i * dt, legScratch);
      if (b.contacts === undefined) return null;
      forwardKinematics(b.pose, legJoints);
      const root = { x: b.st.pos.x + (b.st.body?.x ?? 0), y: 0, z: b.st.pos.z + (b.st.body?.z ?? 0) };
      for (let f = 0; f < 2; f++) {
        ank[f].push(jointWorld(legJoints, f === 0 ? 'footL' : 'footR', root, b.st.heading, s.scale));
        down[f].push((b.contacts & (f === 0 ? 1 : 2)) !== 0);
        sole[f].push(soleOffsets(legJoints, f === 0 ? 'footL' : 'footR', b.st.heading, s.scale));
      }
    }
    // Where each foot stands as the run sets off: the striker's on the stroke's footing (its pins), the non-striker's
    // where the planted-foot plan holds it (else where his legs have it).
    const body = track.physicsBody;
    const pins = body ? fitOf(track, s, body).stroke?.pins : undefined;
    const planned = body ? null : plannedAt(s, at, legTargets);
    const initial = (f: number): Vec3 => {
      if (pins) return pins[f].to;
      if (planned && planned[f * 4 + 3] >= 0.5) return { x: planned[f * 4], y: planned[f * 4 + 1], z: planned[f * 4 + 2] };
      return ank[f][0];
    };
    const feet = ([0, 1] as const).map((f) => {
      const segs: FirstLegSeg[] = [];
      let prev: { A: Vec3; i: number } | null = down[f][0] ? null : { A: initial(f), i: 0 };
      let stance: { A: Vec3; i: number } | null = down[f][0] ? { A: initial(f), i: 0 } : null;
      for (let i = 1; i < n; i++) {
        if (stance && !down[f][i]) {
          // Lift-off: the stance rolls on over the toes until the foot has left the turf, then a swing from where it has the ankle.
          const end = stanceEnd(i, ank[f], sole[f], down[f]);
          const hold = rollingStance(stance.A, stance.i, end, sole[f], ank[f], i);
          segs.push({ k: 'stance', i0: stance.i, i1: end, A: stance.A, hold });
          prev = { A: hold[hold.length - 1], i: end };
          stance = null;
          if (i * dt >= FIRST_LEG_MS) break;
        } else if (!stance && down[f][i] && prev) {
          segs.push({ k: 'swing', i0: prev.i, i1: i, A: prev.A, B: ank[f][i] });
          stance = { A: ank[f][i], i };
          prev = null;
        }
      }
      // The swing that hands the foot back (or the stance still held at the end of the scan).
      if (prev) {
        // Over the swing to the next landing (never past it: down, the planted-foot plan has the foot).
        let land = prev.i + 1;
        while (land < n - 1 && !down[f][land] && land < prev.i + Math.round(FIRST_LEG_BACK_MS / dt)) land++;
        segs.push({ k: 'back', i0: prev.i, i1: land, A: prev.A });
      }
      else if (stance) segs.push({ k: 'stance', i0: stance.i, i1: n - 1, A: stance.A, hold: rollingStance(stance.A, stance.i, n - 1, sole[f], ank[f], n - 1) });
      return segs;
    }) as [FirstLegSeg[], FirstLegSeg[]];
    const leg: FirstLeg = { at, dt, ank, sole, feet };
    firstLegs.set(track, leg);
    return leg;
  };

  /** The striker's legs and trunk on the physics body at t (drawn form; before the reach of the bat). */
  const strikerBody = (_track: ActorTrack, s: State, fit: StrikerFit, body: PhysicsBodyPlan, pose: SampledPose, t: number, root: Vec3, heading: number, targets: Float32Array | null) => {
    const st = { heading };
      // Round 4 (§9): the fit fades only once the rest's crossfade has settled (staggered after the clip's end), and
      // the hips and the trunk lean move over windows long enough for their size (HIPS_ACCEL_MAX, TRUNK_RAMP_MIN_MS).
      const fadeAt = body.releaseAt + FADE_AFTER_REST_MS;
      const fade = 1 - smoothstep(fadeAt, fadeAt + body.fadeMs, t);
      // Into a run the first-leg plan holds the feet (round 7): their offsets go under it, not at a set time.
      const leg = firstLegOf(_track, s);
      const feetFade = leg && t >= leg.at ? Math.min(fade, 1 - smoothstep(leg.at, leg.at + FIRST_LEG_OFFSETS_OUT_MS, t)) : fade;
      const u = body.stroke && fit.stroke ? smoothstep(body.stroke.strideAt, body.stroke.plantAt, t) : 0;
      const uh = body.stroke && fit.stroke ? smoothstep(body.stroke.strideAt, body.stroke.strideAt + fit.stroke.hipsMs, t) : 0;
      const r = body.ready && fit.ready ? smoothstep(body.ready.from, body.ready.to, t) : 0;
      const d = [0, 1, 2].map((f) => {
        const a0 = fit.stance[f];
        const a1 = fit.ready ? fit.ready[f] : a0;
        const a = { x: a0.x + (a1.x - a0.x) * r, z: a0.z + (a1.z - a0.z) * r };
        const b = fit.stroke ? fit.stroke.legs[f] : a;
        const w = f === 2 ? uh : u;
        const k = f === 2 ? fade : feetFade;
        return { x: (a.x + (b.x - a.x) * w) * k, z: (a.z + (b.z - a.z) * w) * k };
      }) as Fit3;
      let pins: [Pin | null, Pin | null] | null = null;
      if (fit.stroke?.pins && body.stroke && t >= body.stroke.strideAt) {
        const rec = fit.stroke.recover;
        const far = rec ? (Math.hypot(rec[0].x - fit.stroke.pins[0].to.x, rec[0].z - fit.stroke.pins[0].to.z) >= Math.hypot(rec[1].x - fit.stroke.pins[1].to.x, rec[1].z - fit.stroke.pins[1].to.z) ? 0 : 1) : 0;
        pins = fit.stroke.pins.map((q, f) => {
          const span = Math.max(1, q.t1 - q.t0);
          const v = smoothstep(q.t0, q.t1, t);
          const up = q.lift * Math.sin(Math.PI * Math.min(1, Math.max(0, (t - q.t0) / span)));
          const p = { x: q.from.x + (q.to.x - q.from.x) * v, y: q.from.y + (q.to.y - q.from.y) * v + up, z: q.from.z + (q.to.z - q.from.z) * v };
          if (!rec || t < body.releaseAt + FADE_AFTER_REST_MS) return { p, w: fade };
          // Into the rest: held, then lifted and put down where the rest pose has it, one foot after the other.
          const r = rec[f];
          const a0 = body.releaseAt + FADE_AFTER_REST_MS + (f === far ? 0 : RECOVER_SPAN[1] * body.fadeMs);
          const a1 = a0 + RECOVER_SPAN[0] * body.fadeMs;
          const k = smoothstep(a0, a1, t);
          const travel = Math.hypot(r.x - q.to.x, r.z - q.to.z);
          const lift = travel > PLANTED_TRAVEL_M ? Math.min(STEP_LIFT_M, 0.02 + 0.3 * travel) * Math.sin(Math.PI * Math.min(1, Math.max(0, (t - a0) / (a1 - a0)))) : 0;
          // Then held there while he stands at rest (the foot plan, which planted the clip's own feet, never takes them
          // back across the ground), let go as a run sets off (its own first steps lift them).
          const go = 1 - smoothstep(fit.stroke!.restEnd, fit.stroke!.restEnd + 150, t);
          return { p: { x: q.to.x + (r.x - q.to.x) * k, y: q.to.y + (r.y - q.to.y) * k + lift, z: q.to.z + (r.z - q.to.z) * k }, w: go };
        }) as [Pin | null, Pin | null];
      }
      // The run's first steps (round 7): its own plan, planted exactly, over whatever held the feet before.
      if (leg && t >= leg.at) {
        const own = [firstLegAt(leg, 0, t), firstLegAt(leg, 1, t)];
        if (own[0] || own[1]) pins = [own[0] ?? pins?.[0] ?? null, own[1] ?? pins?.[1] ?? null];
      }
      legsOnPads(pose, s.joints, targets, d[0], d[1], d[2], root, st.heading, s.scale, pins);
      const ut = body.stroke && fit.stroke ? smoothstep(body.stroke.strideAt, body.stroke.strideAt + Math.max(TRUNK_RAMP_MIN_MS, body.stroke.plantAt - body.stroke.strideAt), t) : 0;
      if (fit.stroke && ut * fade > 1e-3) applyTrunk(pose, s.joints, fit.stroke.trunk, ut * fade);
  };

  /** The reach the bat asks for over the stroke, smoothed (per track; null without a stroke or a bat). */
  const reachPlans = new WeakMap<ActorTrack, ReachPlan | null>();
  const reachScratch: Scratch = { a: createPose(), b: createPose(), lower: createPose() };
  const reachJoints = createJoints();
  const reachTargets = new Float32Array(8);
  /**
   * The track's reach plan, worked out on demand (null without a stroke or a bat). A sample of what the bat asks for is a
   * pure function of (track, its index), and a correction is the smoothing of the samples within REACH_HIPS_SMOOTH_MS of
   * it, so a frame at t makes only the samples about t (a camera cut to the striker no longer builds the whole stroke in
   * one frame) and `warm` makes them ahead of the frame that needs them. However they are made, in whatever order, the
   * corrections are the same bit for bit.
   */
  const reachPlanOf = (track: ActorTrack, s: State, fit: StrikerFit, body: PhysicsBodyPlan, mirror: boolean): ReachPlan | null => {
    const hit = reachPlans.get(track);
    if (hit !== undefined) return hit;
    if (!(body.stroke && opts.batOf)) {
      reachPlans.set(track, null);
      return null;
    }
    const batOf = opts.batOf;
    const t0 = body.stroke.strideAt - 250 - REACH_HIPS_SMOOTH_MS;
    const t1 = (Number.isFinite(body.releaseAt) ? body.releaseAt : body.stroke.refAt) + FADE_AFTER_REST_MS + body.fadeMs + 900 + REACH_HIPS_SMOOTH_MS;
    const dt = 1000 / 60;
    const n = Math.max(2, Math.ceil((t1 - t0) / dt) + 1);
    const w = Math.round(REACH_SMOOTH_MS / dt);
    const wh = Math.round(REACH_HIPS_SMOOTH_MS / dt);
    const need: Array<ReachCorrection | undefined> = [];
    const halfVec: Array<number[] | undefined> = [];
    const pelvisVec: Array<number[] | undefined> = [];
    const made: Array<ReachCorrection | undefined> = [];
    /** What the bat asks of the body at sample i. */
    const needAt = (i: number): ReachCorrection => {
      const hit = need[i];
      if (hit) return hit;
      const t = t0 + i * dt;
      const bat = batOf(track, t);
      const c: ReachCorrection = { pelvis: [0, 0, 0, 1], half: [0, 0, 0, 1], hx: 0, hz: 0 };
      if (bat) {
        const st = evaluateActor(track, t);
        const root = { x: st.pos.x + (st.body?.x ?? 0), y: 0, z: st.pos.z + (st.body?.z ?? 0) };
        const pose = base(track, t, reachScratch).pose;
        const planned = plannedAt(s, t, reachTargets);
        strikerBody(track, s, fit, body, pose, t, root, st.heading, planned);
        reachTheBat(pose, reachJoints, bat, mirror, root, st.heading, s.scale, REACH_TRUNK_MAX_DEG, REACH_HIPS_MAX_M, c);
      }
      need[i] = c;
      return c;
    };
    const halfVecAt = (i: number): number[] => (halfVec[i] ??= rotationVector(needAt(i).half));
    const pelvisVecAt = (i: number): number[] => (pelvisVec[i] ??= rotationVector(needAt(i).pelvis));
    /** The planned correction at sample i: the smoothed needs about it, into and out of the plan by a raised cosine over its first and last REACH_HIPS_SMOOTH_MS (no step at its ends). */
    const correctionAt = (i: number): ReachCorrection => {
      const hit = made[i];
      if (hit) return hit;
      let c = smoothReachAt(n, i, w, wh, needAt, halfVecAt, pelvisVecAt);
      const e = Math.min(1, i / wh, (n - 1 - i) / wh);
      const k = 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, e));
      if (k < 1) c = { pelvis: slerpQ([0, 0, 0, 1], c.pelvis, k), half: slerpQ([0, 0, 0, 1], c.half, k), hx: c.hx * k, hz: c.hz * k };
      made[i] = c;
      return c;
    };
    if (REACH_STATS.on) {
      let deg = 0;
      let pelvis = 0;
      let hips = 0;
      for (let i = 0; i < n; i++) {
        const c = needAt(i);
        deg = Math.max(deg, (4 * Math.acos(Math.min(1, Math.abs(c.half[3]))) * 180) / Math.PI);
        pelvis = Math.max(pelvis, (2 * Math.acos(Math.min(1, Math.abs(c.pelvis[3]))) * 180) / Math.PI);
        hips = Math.max(hips, Math.hypot(c.hx, c.hz));
      }
      REACH_STATS.byTrack.set(track, { deg, pelvis, hips });
    }
    let next = -1;
    const plan: ReachPlan = {
      at(t) {
        const f = (t - t0) / dt;
        if (f < 0 || f > n - 1) return null;
        const i = Math.min(n - 2, Math.floor(f));
        const u = f - i;
        const a = correctionAt(i);
        const b = correctionAt(i + 1);
        return { pelvis: slerpQ(a.pelvis, b.pelvis, u), half: slerpQ(a.half, b.half, u), hx: a.hx + (b.hx - a.hx) * u, hz: a.hz + (b.hz - a.hz) * u };
      },
      warm(from, budgetMs) {
        // The samples a correction at `from` is smoothed from first, then on in time order to the end of the plan.
        if (next < 0) next = Math.max(0, Math.min(n - 1, Math.floor((from - t0) / dt) - wh));
        const until = Number.isFinite(budgetMs) ? performance.now() + budgetMs : Number.POSITIVE_INFINITY;
        while (next < n) {
          needAt(next++);
          if (next < n && performance.now() >= until) return false;
        }
        return true;
      },
    };
    reachPlans.set(track, plan);
    return plan;
  };

  /** The hook; `reach` false leaves out the reach of the bat (the legs, the trunk and the head on the physics body only). */
  const run = (track: ActorTrack, pose: SampledPose, t: number, reach: boolean): void => {
    if (!HUMAN_TRACKS.has(track.id)) return;
    // First: a striker whose stride decision is still to be made (script.ts StrideDecision) has it made by this read, before
    // any plan of his is looked up.
    const body = track.physicsBody;
    // The batters' arms carry their elbows from the frame before (players.holdBat reads and clears the stamp).
    if (track.id === 'striker' || track.id === 'nonStriker') pose.stamp = t;
    // First person never draws the striker; the hook is only reached for a posed actor.
    const s = stateOf(track);
    const st = evaluateActor(track, t);
    const root = { x: st.pos.x + (st.body?.x ?? 0), y: 0, z: st.pos.z + (st.body?.z ?? 0) };
    const targets = plannedAt(s, t, s.targets);
    if (!targets && !body) return;
    const mirror = Boolean(track.mirror);
    if (mirror) mirrorSampledPose(pose);
    if (body) {
      // The striker on the physics body (legs on the pads, trunk and head on the torso; PhysicsBodyPlan).
      const fit = fitOf(track, s, body);
      strikerBody(track, s, fit, body, pose, t, root, st.heading, targets);
      // The reach of the bat (round 3): the planned, smoothed trunk turn and hips shift, then a small residual.
      const bat = (reach ? opts.batOf?.(track, t) : null) ?? null;
      // Round 7: the plan is applied for as long as it lasts, the bat in the hands or not. It needs nothing where the
      // bat has gone (the run's hand-over), so it eases out over REACH_SMOOTH_MS after the last held frame; it was
      // dropped in one frame there before (spine, chest and hips at 900–1900°/s, probe zz-chestdbg).
      const plan = reach && opts.batOf ? reachPlanOf(track, s, fit, body, mirror) : null;
      const c = plan ? plan.at(t) : null;
      // The planned pelvis is out before the overlay's own follow-through hip turn (round 7: the two never add).
      if (c && body.stroke?.followAt != null) c.pelvis = partial(c.pelvis, pelvisShareAt(body.stroke.followAt, t));
      if (c) applyReach(pose, s.joints, c, root, st.heading, s.scale);
      if (bat) reachTheBat(pose, s.joints, bat, mirror, root, st.heading, s.scale, plan ? REACH_RESIDUAL.deg : REACH_TRUNK_MAX_DEG, plan ? REACH_RESIDUAL.hipsM : REACH_HIPS_MAX_M);
      // Round 7 (§9 ankle): a shin leaning on over a flat foot lifts its heel, the ball of the foot kept where it is.
      heelsUp(pose, s.joints);
    } else if (targets) {
      // The non-striker's first steps into a run (round 7): the first-leg plan over the planted-foot plan.
      const leg = firstLegOf(track, s);
      if (leg && t >= leg.at) {
        forwardKinematics(pose, s.joints);
        for (let f = 0; f < 2; f++) {
          const own = firstLegAt(leg, f, t);
          if (!own) continue;
          const w0 = targets[f * 4 + 3];
          const a = w0 > 1e-3 ? { x: targets[f * 4], y: targets[f * 4 + 1], z: targets[f * 4 + 2] } : jointWorld(s.joints, f === 0 ? 'footL' : 'footR', root, st.heading, s.scale);
          targets[f * 4] = a.x + (own.p.x - a.x) * own.w;
          targets[f * 4 + 1] = a.y + (own.p.y - a.y) * own.w;
          targets[f * 4 + 2] = a.z + (own.p.z - a.z) * own.w;
          targets[f * 4 + 3] = w0 + (1 - w0) * own.w;
        }
      }
      plantFeet(pose, s.joints, targets, root, st.heading, s.scale);
    }
    if (mirror) mirrorSampledPose(pose);
  };
  const hook: WarmablePoseHook = (track, pose, t) => run(track, pose, t, true);
  hook.legs = (track, pose, t) => run(track, pose, t, false);
  hook.forget = (track) => {
    const hit = states.get(track.id);
    if (hit && hit.track === track) states.delete(track.id);
    fits.delete(track);
    firstLegs.delete(track);
    reachPlans.delete(track);
  };
  hook.warm = (track, budgetMs, from = Number.NEGATIVE_INFINITY) => {
    const body = track.physicsBody;
    if (!HUMAN_TRACKS.has(track.id) || !body || !opts.batOf) return true;
    const s = stateOf(track);
    const plan = reachPlanOf(track, s, fitOf(track, s, body), body, Boolean(track.mirror));
    return plan ? plan.warm(from, budgetMs) : true;
  };
  return hook;
}

// ---------------------------------------------------------------------------------------------------------------
// The striker on the physics body
// ---------------------------------------------------------------------------------------------------------------

/** A horizontal offset (world m). */
interface Off {
  x: number;
  z: number;
}
type Quat = [number, number, number, number];

/** Ankle offsets by drawn leg [L, R], then the hips' offset. */
type Fit3 = [Off, Off, Off];

interface StrikerFit {
  /** The offsets that put the shins on the stance pads (in the stance, the ready hold), and on the stroke's pads. */
  stance: Fit3;
  ready: Fit3 | null;
  stroke: { legs: Fit3; trunk: TrunkFit; pins: StrikerFit['pins'] | undefined; recover: [Vec3, Vec3] | null; restEnd: number; hipsMs: number } | null;
  pins?: [FootStep, FootStep];
}
/** After the stroke, into the rest: each foot steps over RECOVER_SPAN[0] of the fade, the second from RECOVER_SPAN[1]. */
const RECOVER_SPAN = [0.6, 0.4] as const;
/** The fit fades this long after the stroke clip ends (the rest's crossfade, bat_rest inertial 320 ms, first). */
const FADE_AFTER_REST_MS = 340;
/** The hips' largest acceleration from the fit (m/s²; a smoothstep's peak is 6·D/T²): 0.25 m/s per 60 Hz frame. */
const HIPS_ACCEL_MAX = 15;
/** The trunk's lean onto the physics torso ramps in over at least this long from the input (ms). */
const TRUNK_RAMP_MIN_MS = 280;
/** The rest's crossfade (bat_rest, inertial 320 ms) has settled this long after the fade: where its feet are then. */
const RECOVER_SETTLE_MS = 450;

/** A foot's way across the stride (world ankle points, scene ms, the step's lift in m: 0 for a foot kept down). */
interface FootStep {
  from: Vec3;
  to: Vec3;
  t0: number;
  t1: number;
  lift: number;
}
/** The highest a stride's step lifts the ankle above its straight path (m). */
const STEP_LIFT_M = 0.07;

/**
 * How far the drawn pad stands proud of the physics pad's surface (m; measured on the drawn mesh, zz-pad probe): short
 * of it at the shoe (the drawn pad ends above the instep), proud along the shin, prouder again at the knee roll.
 */
const PAD_PROUD_M = { shoe: -0.015, shin: 0.05, knee: 0.04 } as const;

/** The trunk's fit: actor-frame rotations of the spine, the chest and the neck (each at most TRUNK_MAX_DEG). */
interface TrunkFit {
  spine: Quat;
  chest: Quat;
  neck: Quat;
}

const TRUNK_MAX_DEG = { lean: 30, neck: 25 } as const;
/** The trunk's lean onto the physics torso when the physics pads do not govern the feet (deg; a natural posture). */
const TRUNK_NATURAL_DEG = { lean: 10, neck: 10 } as const;
/**
 * The height (m) at which the stance shins cross the stance pads' axes. The drawn stance shin leans against the
 * physics pad's vertical capsule, so this is the height that keeps the largest gap smallest over a ball's 0.1–0.6 m
 * (probe zz-stancefit; lead ruling 05:4xZ). A test hook may change it before a script is first drawn.
 */
const STANCE_FIT = { heightM: 0.3 };
/** The head's centre in the head bone's frame (m): where the physics head sphere sits on the drawn head. */
const HEAD_CENTRE: readonly [number, number, number] = [0, 0.1, 0.02];

/** The hips follow the feet half way (the body stays over its base as the stance widens or the stride lands). */
const hipsOf = (a: Off, b: Off): Off => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });

/**
 * The legs on the pads: the hips shifted by `hips` (world), then each ankle carried by its offset from where the pose
 * (and the planted-foot plan, when it holds that foot) puts it, by leg IK. `j` is left as the result's FK.
 */
function legsOnPads(pose: SampledPose, j: Joints, planned: Float32Array | null, dL: Off, dR: Off, hips: Off, root: Vec3, heading: number, scale: number, pins: [Pin | null, Pin | null] | null = null): void {
  const c = Math.cos(heading);
  const sn = Math.sin(heading);
  pose.root = [pose.root[0] + (c * hips.x - sn * hips.z) / scale, pose.root[1], pose.root[2] + (sn * hips.x + c * hips.z) / scale];
  forwardKinematics(pose, j);
  const targets = LEG_TARGETS;
  for (let f = 0; f < 2; f++) {
    const a = jointWorld(j, f === 0 ? 'footL' : 'footR', root, heading, scale);
    const w = planned ? planned[f * 4 + 3] : 0;
    const bx = w > 0 ? a.x + (planned![f * 4] - a.x) * w : a.x;
    const by = w > 0 ? a.y + (planned![f * 4 + 1] - a.y) * w : a.y;
    const bz = w > 0 ? a.z + (planned![f * 4 + 2] - a.z) * w : a.z;
    const d = f === 0 ? dL : dR;
    const pin = pins?.[f];
    const k = pin ? pin.w : 0;
    targets[f * 4] = bx + d.x + (pin ? (pin.p.x - bx - d.x) * k : 0);
    targets[f * 4 + 1] = by + (pin ? (pin.p.y - by) * k : 0);
    targets[f * 4 + 2] = bz + d.z + (pin ? (pin.p.z - bz - d.z) * k : 0);
    targets[f * 4 + 3] = 1;
  }
  plantFeet(pose, j, targets, root, heading, scale);
}
/** A foot held at a world ankle point, a weight w of the way from where the offsets put it. */
interface Pin {
  p: Vec3;
  w: number;
}
/** A foot whose drawn ankle travels at most this far over the stride stays down (eased across, never lifted; m). */
const PLANTED_TRAVEL_M = 0.02;
const LEG_TARGETS = new Float32Array(8);

/** The rotation (actor frame) turning direction a onto b, at most maxDeg. */
function fromTo(a: readonly number[], b: readonly number[], maxDeg: number): Quat {
  const la = Math.hypot(a[0], a[1], a[2]);
  const lb = Math.hypot(b[0], b[1], b[2]);
  if (la < 1e-6 || lb < 1e-6) return [0, 0, 0, 1];
  const ax = a[0] / la, ay = a[1] / la, az = a[2] / la;
  const bx = b[0] / lb, by = b[1] / lb, bz = b[2] / lb;
  let cx = ay * bz - az * by;
  let cy = az * bx - ax * bz;
  let cz = ax * by - ay * bx;
  const sn = Math.hypot(cx, cy, cz);
  if (sn < 1e-9) return [0, 0, 0, 1];
  const ang = Math.min(Math.atan2(sn, ax * bx + ay * by + az * bz), (maxDeg * Math.PI) / 180);
  cx /= sn;
  cy /= sn;
  cz /= sn;
  const h = Math.sin(ang / 2);
  return [cx * h, cy * h, cz * h, Math.cos(ang / 2)];
}

/** q scaled by w (slerp from identity). */
function partial(q: Quat, w: number): Quat {
  const ang = 2 * Math.acos(Math.max(-1, Math.min(1, q[3])));
  const sn = Math.sin(ang / 2);
  if (sn < 1e-9) return [0, 0, 0, 1];
  const h = Math.sin((ang * w) / 2) / sn;
  return [q[0] * h, q[1] * h, q[2] * h, Math.cos((ang * w) / 2)];
}

function qmul(a: readonly number[], b: readonly number[]): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function rotateVec(q: readonly number[], v: readonly number[]): [number, number, number] {
  const r = qmul(qmul(q, [v[0], v[1], v[2], 0]), [-q[0], -q[1], -q[2], q[3]]);
  return [r[0], r[1], r[2]];
}

/** Turns bone `name` by the actor-frame rotation r (its children follow). `j` must be the pose's FK; left stale. */
function turnBone(pose: SampledPose, j: Joints, name: BoneName, r: Quat): void {
  const i = BONE_INDEX[name];
  const parent = i === 0 ? null : PARENT_OF[name];
  const P: Quat = parent ? [j.q[BONE_INDEX[parent] * 4], j.q[BONE_INDEX[parent] * 4 + 1], j.q[BONE_INDEX[parent] * 4 + 2], j.q[BONE_INDEX[parent] * 4 + 3]] : [0, 0, 0, 1];
  const Pi: Quat = [-P[0], -P[1], -P[2], P[3]];
  const local: Quat = [pose.q[i * 4], pose.q[i * 4 + 1], pose.q[i * 4 + 2], pose.q[i * 4 + 3]];
  const out = qmul(qmul(qmul(Pi, r), P), local);
  const n = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
  for (let k = 0; k < 4; k++) pose.q[i * 4 + k] = out[k] / n;
}
const PARENT_OF: Partial<Record<BoneName, BoneName>> = { spine: 'hips', chest: 'spine', neck: 'chest' };

function joint(j: Joints, name: BoneName): [number, number, number] {
  const i = BONE_INDEX[name] * 3;
  return [j.p[i], j.p[i + 1], j.p[i + 2]];
}

/** The trunk's fit at the reference frame (actor frame, scale 1): see TrunkFit. `pose` is changed. */
function trunkFit(pose: SampledPose, j: Joints, top: Vec3, head: Vec3, limits: { lean: number; neck: number } = TRUNK_MAX_DEG): TrunkFit {
  forwardKinematics(pose, j);
  // Spine and chest share the lean that carries the neck over the torso top (its height kept).
  const s0 = joint(j, 'spine');
  const n0 = joint(j, 'neck');
  const want = [top.x - s0[0], n0[1] - s0[1], top.z - s0[2]];
  const full = fromTo([n0[0] - s0[0], n0[1] - s0[1], n0[2] - s0[2]], want, limits.lean);
  const half = partial(full, 0.5);
  turnBone(pose, j, 'spine', half);
  forwardKinematics(pose, j);
  turnBone(pose, j, 'chest', half);
  forwardKinematics(pose, j);
  // The neck carries the head's centre onto the physics head.
  const n1 = joint(j, 'neck');
  const hi = BONE_INDEX.head;
  const hq = [j.q[hi * 4], j.q[hi * 4 + 1], j.q[hi * 4 + 2], j.q[hi * 4 + 3]];
  const hp = joint(j, 'head');
  const off = rotateVec(hq, HEAD_CENTRE);
  const hc = [hp[0] + off[0], hp[1] + off[1], hp[2] + off[2]];
  const neck = fromTo([hc[0] - n1[0], hc[1] - n1[1], hc[2] - n1[2]], [head.x - n1[0], head.y - n1[1], head.z - n1[2]], limits.neck);
  return { spine: half, chest: half, neck };
}

/** How far along the handle from the cap each glove holds (m; src/physics/constants.ts TOP_/LOWER_HAND_FROM_CAP). */
const GRIP_FROM_CAP = { top: 0.025, bottom: 0.125 } as const;
/** A shoulder reaches a grip point within this share of its arm (upper arm + forearm + the palm's 6 cm). */
const REACH_SHARE = 0.82;
/** The most the trunk turns (spine and chest together, deg) and the hips shift over the planted feet (m) to reach. */
const REACH_TRUNK_MAX_DEG = 80;
const REACH_HIPS_MAX_M = 0.2;

/**
 * Turns the trunk (spine and chest, each half, about the hips) towards the grip point the arm can least reach, until
 * both shoulders are within reach of their grip points; if the trunk's turn is spent, shifts the hips (at most
 * REACH_HIPS_MAX_M) towards it with the feet held where they were. Continuous in the bat (nothing happens while
 * both are in reach). Drawn form, actor frame; `j` is left as the result's FK.
 */
function reachTheBat(pose: SampledPose, j: Joints, bat: { grip: Vec3; toe: Vec3 }, mirror: boolean, root: Vec3, heading: number, scale: number, trunkMaxDeg: number = REACH_TRUNK_MAX_DEG, hipsMaxM: number = REACH_HIPS_MAX_M, applied: ReachCorrection | null = null): void {
  const dx = bat.toe.x - bat.grip.x;
  const dy = bat.toe.y - bat.grip.y;
  const dz = bat.toe.z - bat.grip.z;
  const l = Math.hypot(dx, dy, dz) || 1;
  const at = (k: number) => worldToLocal({ x: bat.grip.x + (dx / l) * k, y: bat.grip.y + (dy / l) * k, z: bat.grip.z + (dz / l) * k }, root, heading, scale);
  const hands: Array<{ side: 'L' | 'R'; t: Vec3 }> = [
    { side: mirror ? 'R' : 'L', t: at(GRIP_FROM_CAP.top) },
    { side: mirror ? 'L' : 'R', t: at(GRIP_FROM_CAP.bottom) },
  ];
  // A grip point is out of reach too far (more than the arm reaches) or too near (closer than the elbow's §9 fold,
  // 150°, lets the hand come; round 6): `near` turns the shoulder away from it instead of towards it.
  const excess = () => {
    let worst = 0;
    let which = hands[0];
    let near = false;
    for (const h of hands) {
      const sh = joint(j, `upperArm${h.side}`);
      const el = joint(j, `forearm${h.side}`);
      const wr = joint(j, `hand${h.side}`);
      const ua = Math.hypot(el[0] - sh[0], el[1] - sh[1], el[2] - sh[2]);
      const fa = Math.hypot(wr[0] - el[0], wr[1] - el[1], wr[2] - el[2]);
      const reach = REACH_SHARE * (ua + fa + 0.06);
      const fold = 1.08 * Math.sqrt(Math.max(0, ua * ua + fa * fa - 2 * ua * fa * Math.cos((30 * Math.PI) / 180)));
      const dist = Math.hypot(h.t.x - sh[0], h.t.y - sh[1], h.t.z - sh[2]);
      if (dist - reach > worst) {
        worst = dist - reach;
        which = h;
        near = false;
      }
      if (fold - dist > worst) {
        worst = fold - dist;
        which = h;
        near = true;
      }
    }
    return { worst, which, near };
  };
  forwardKinematics(pose, j);
  let used = 0;
  for (let it = 0; it < 6; it++) {
    const { worst, which, near } = excess();
    if (worst <= 1e-4) return;
    const hp = joint(j, 'hips');
    const sh = joint(j, `upperArm${which.side}`);
    const v1 = [sh[0] - hp[0], sh[1] - hp[1], sh[2] - hp[2]];
    const r1 = Math.hypot(v1[0], v1[1], v1[2]) || 1;
    // The turn that brings the shoulder about `worst` nearer (or, too near, further), within what is left of the budget.
    const ang = Math.min((worst / r1) * (180 / Math.PI) * 1.1, trunkMaxDeg - used);
    if (ang <= 1e-3) break;
    const away = [2 * sh[0] - which.t.x - hp[0], 2 * sh[1] - which.t.y - hp[1], 2 * sh[2] - which.t.z - hp[2]];
    const full = fromTo(v1, near ? away : [which.t.x - hp[0], which.t.y - hp[1], which.t.z - hp[2]], ang);
    // Round 5: the pelvis takes its share first (the hips open, the feet held, each thigh's twist within §9), then the
    // spine and the chest the rest, each within its own §9 range.
    const pel = turnPelvis(pose, j, partial(full, PELVIS_SHARE), root, heading, scale);
    if (applied) applied.pelvis = qmul(pel, applied.pelvis);
    const rest = qmul(full, [-pel[0], -pel[1], -pel[2], pel[3]]);
    const half = partial(rest, 0.5);
    const a = limitedTurn(pose, j, 'spine', half, SPINE_CHEST_MAX_DEG);
    const b = limitedTurn(pose, j, 'chest', half, SPINE_CHEST_MAX_DEG);
    used += ((2 * Math.acos(Math.min(1, Math.abs(pel[3])))) * 180) / Math.PI + ((2 * Math.acos(Math.min(1, Math.abs(half[3])))) * 180) / Math.PI * (a + b);
    if (applied) applied.half = qmul(partial(half, (a + b) / 2), applied.half);
    if (a + b < 1e-3 && Math.abs(pel[3]) > 0.99999) break;
  }
  const { worst, which, near } = excess();
  if (worst <= 1e-4) return;
  // The hips over the planted feet: the feet held where they are, the body shifted towards the grip (away, too near).
  const sh = joint(j, `upperArm${which.side}`);
  const hx = (which.t.x - sh[0]) * (near ? -1 : 1);
  const hz = (which.t.z - sh[2]) * (near ? -1 : 1);
  const hl = Math.hypot(hx, hz) || 1;
  const k = Math.min(worst, hipsMaxM);
  if (k <= 1e-5) return;
  if (applied) {
    applied.hx += (hx / hl) * k;
    applied.hz += (hz / hl) * k;
  }
  const feet = REACH_FEET;
  for (let f = 0; f < 2; f++) {
    const a = jointWorld(j, f === 0 ? 'footL' : 'footR', root, heading, scale);
    feet[f * 4] = a.x;
    feet[f * 4 + 1] = a.y;
    feet[f * 4 + 2] = a.z;
    feet[f * 4 + 3] = 1;
  }
  pose.root = [pose.root[0] + (hx / hl) * k, pose.root[1], pose.root[2] + (hz / hl) * k];
  plantFeet(pose, j, feet, root, heading, scale);
}
const REACH_FEET = new Float32Array(8);

/** §9 joint ranges the reach keeps to (deg): spine and chest each in all, the thighs' twist against the pelvis. */
const SPINE_CHEST_MAX_DEG = 75;
const THIGH_TWIST_MAX_DEG = 50;
/** The pelvis's share of a reach turn, and the most it opens in all (deg). */
const PELVIS_SHARE = 0.45;
const PELVIS_MAX_DEG = 40;
/** The planned pelvis turn fades out over this long, ending as the overlay's follow-through begins (ms). */
export const PELVIS_OUT_MS = 160;
/**
 * How much of the planned pelvis turn is still applied at scene time t: all of it until PELVIS_OUT_MS before the overlay's
 * follow-through begins (`followAt`, its `contact` marker), none from then on, eased between: the overlay's own hip turn
 * takes over there and the two never add (a sum made the hips step 2.6 m/s a frame).
 */
export function pelvisShareAt(followAt: number, t: number): number {
  return 1 - smoothstep(followAt - PELVIS_OUT_MS, followAt, t);
}

/** A bone's local rotation in all (deg). */
function boneAngle(pose: SampledPose, name: BoneName): number {
  const i = BONE_INDEX[name] * 4;
  return ((2 * Math.acos(Math.min(1, Math.abs(pose.q[i + 3])))) * 180) / Math.PI;
}

/** A thigh's twist about its own length against the pelvis (deg; the swing–twist split about the limb's y). */
function thighTwist(pose: SampledPose, name: 'thighL' | 'thighR'): number {
  const i = BONE_INDEX[name] * 4;
  const y = pose.q[i + 1];
  const w = pose.q[i + 3];
  return Math.abs(((2 * Math.atan2(Math.abs(y), Math.abs(w))) * 180) / Math.PI);
}

/** Turns `name` by r (actor frame), backed off as far as needed to keep it within maxDeg. Returns the share applied. */
function limitedTurn(pose: SampledPose, j: Joints, name: BoneName, r: Quat, maxDeg: number): number {
  const i = BONE_INDEX[name] * 4;
  const before: Quat = [pose.q[i], pose.q[i + 1], pose.q[i + 2], pose.q[i + 3]];
  forwardKinematics(pose, j);
  turnBone(pose, j, name, r);
  if (boneAngle(pose, name) <= maxDeg) {
    forwardKinematics(pose, j);
    return 1;
  }
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 10; k++) {
    const m = (lo + hi) / 2;
    for (let c = 0; c < 4; c++) pose.q[i + c] = before[c];
    forwardKinematics(pose, j);
    turnBone(pose, j, name, partial(r, m));
    if (boneAngle(pose, name) <= maxDeg) lo = m;
    else hi = m;
  }
  for (let c = 0; c < 4; c++) pose.q[i + c] = before[c];
  forwardKinematics(pose, j);
  turnBone(pose, j, name, partial(r, lo));
  forwardKinematics(pose, j);
  return lo;
}

/**
 * Opens the pelvis by r (actor frame) with the feet held where they are (leg IK), backed off until both thighs' twist
 * is within THIGH_TWIST_MAX_DEG and the pelvis within PELVIS_MAX_DEG. Returns the turn actually given. `j`: the FK.
 */
function turnPelvis(pose: SampledPose, j: Joints, r: Quat, root: Vec3, heading: number, scale: number, planned = false): Quat {
  forwardKinematics(pose, j);
  const feet = new Float32Array(8);
  for (let f = 0; f < 2; f++) {
    const a = jointWorld(j, f === 0 ? 'footL' : 'footR', root, heading, scale);
    feet[f * 4] = a.x;
    feet[f * 4 + 1] = a.y;
    feet[f * 4 + 2] = a.z;
    feet[f * 4 + 3] = 1;
  }
  const save = Float32Array.from(pose.q);
  const saveRoot: [number, number, number] = [pose.root[0], pose.root[1], pose.root[2]];
  const trial = (m: number): boolean => {
    pose.q.set(save);
    pose.root = [saveRoot[0], saveRoot[1], saveRoot[2]];
    // The pelvis has no parent: turning it reads no joint, and plantFeet works the pose's joints out afresh.
    turnBone(pose, j, 'hips', partial(r, m));
    plantFeet(pose, j, feet, root, heading, scale);
    return boneAngle(pose, 'hips') <= PELVIS_MAX_DEG && thighTwist(pose, 'thighL') <= THIGH_TWIST_MAX_DEG && thighTwist(pose, 'thighR') <= THIGH_TWIST_MAX_DEG;
  };
  // A planned turn (reachPlanOf: its limits checked once, smoothed) is given as it is: no per-frame back-off (round 6).
  if (trial(1) || planned) return r;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 8; k++) {
    const m = (lo + hi) / 2;
    if (trial(m)) lo = m;
    else hi = m;
  }
  trial(lo);
  return partial(r, lo);
}

/** A reach correction (actor frame): the half turn given to the spine and again to the chest, and the hips' shift (m). */
interface ReachCorrection {
  /** The pelvis's turn (actor frame; the feet held), applied first. */
  pelvis: Quat;
  half: Quat;
  hx: number;
  hz: number;
}

/** Applies a reach correction to a pose (the feet held where they are). `j` is left as the result's FK. */
function applyReach(pose: SampledPose, j: Joints, c: ReachCorrection, root: Vec3, heading: number, scale: number): void {
  turnPelvis(pose, j, c.pelvis, root, heading, scale, true);
  limitedTurn(pose, j, 'spine', c.half, SPINE_CHEST_MAX_DEG);
  limitedTurn(pose, j, 'chest', c.half, SPINE_CHEST_MAX_DEG);
  if (Math.abs(c.hx) + Math.abs(c.hz) < 1e-6) return;
  const feet = REACH_FEET;
  for (let f = 0; f < 2; f++) {
    const a = jointWorld(j, f === 0 ? 'footL' : 'footR', root, heading, scale);
    feet[f * 4] = a.x;
    feet[f * 4 + 1] = a.y;
    feet[f * 4 + 2] = a.z;
    feet[f * 4 + 3] = 1;
  }
  pose.root = [pose.root[0] + c.hx, pose.root[1], pose.root[2] + c.hz];
  plantFeet(pose, j, feet, root, heading, scale);
}

/** The reach over a stroke at 60 Hz (scene ms): the smoothed corrections, worked out as they are asked for. */
interface ReachPlan {
  /** The planned correction at t (linear between samples; none outside the plan). */
  at(t: number): ReachCorrection | null;
  /**
   * Makes what the corrections about scene time `from` and after it are smoothed from, in time order, until all of it is
   * made or `budgetMs` of wall time is spent (at least one sample). True once nothing is left.
   */
  warm(from: number, budgetMs: number): boolean;
}

function slerpQ(a: Quat, b: Quat, u: number): Quat {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const bb: Quat = d < 0 ? [-b[0], -b[1], -b[2], -b[3]] : [b[0], b[1], b[2], b[3]];
  d = Math.abs(d);
  if (d > 0.9995) {
    const r: Quat = [a[0] + (bb[0] - a[0]) * u, a[1] + (bb[1] - a[1]) * u, a[2] + (bb[2] - a[2]) * u, a[3] + (bb[3] - a[3]) * u];
    const n = Math.hypot(r[0], r[1], r[2], r[3]) || 1;
    return [r[0] / n, r[1] / n, r[2] / n, r[3] / n];
  }
  const th = Math.acos(d);
  const s0 = Math.sin((1 - u) * th) / Math.sin(th);
  const s1 = Math.sin(u * th) / Math.sin(th);
  return [a[0] * s0 + bb[0] * s1, a[1] * s0 + bb[1] * s1, a[2] * s0 + bb[2] * s1, a[3] * s0 + bb[3] * s1];
}

/** A rotation as a rotation vector (axis times angle). */
function rotationVector(q: Quat): number[] {
  const ang = 2 * Math.acos(Math.max(-1, Math.min(1, q[3])));
  const sn = Math.sin(ang / 2);
  return sn < 1e-9 ? [0, 0, 0] : [(q[0] / sn) * ang, (q[1] / sn) * ang, (q[2] / sn) * ang];
}

/** A raised cosine of the distance d (1 at 0, 0 at `width` and beyond). */
function kern(d: number, width: number): number {
  return 0.5 * (1 + Math.cos((Math.PI * Math.min(width, Math.abs(d))) / width));
}

/**
 * The size: the strongest weighted vector within `width` samples of i (never less than this sample's own); the direction:
 * the weighted mean of those vectors (smooth, so the turns and the shift never jump from one need's direction to another's).
 */
function envelope(vecAt: (k: number) => number[], n: number, i: number, width: number): Quat {
  let best = 0;
  const sum = [0, 0, 0];
  for (let k = Math.max(0, i - width); k <= Math.min(n - 1, i + width); k++) {
    const g = kern(k - i, width);
    const v = vecAt(k);
    best = Math.max(best, Math.hypot(v[0], v[1], v[2]) * g);
    sum[0] += v[0] * g;
    sum[1] += v[1] * g;
    sum[2] += v[2] * g;
  }
  const sl = Math.hypot(sum[0], sum[1], sum[2]);
  return sl < 1e-9 || best < 1e-9 ? [0, 0, 0, 1] : [(sum[0] / sl) * Math.sin(best / 2), (sum[1] / sl) * Math.sin(best / 2), (sum[2] / sl) * Math.sin(best / 2), Math.cos(best / 2)];
}

/**
 * Smooths the needed corrections so the trunk turns ahead of the bat and back after it, never less than a frame needs:
 * sample i's turn (as a rotation vector) and hips shift is the strongest of its neighbours within `w` samples (`wh` for the
 * hips), each weighted by a raised cosine of its distance (1 at 0, 0 at w): a smooth envelope over the needs (bounded
 * speed and acceleration), the direction kept from the sample that sets it. Reads the samples i - wh .. i + wh of the `n`.
 */
function smoothReachAt(n: number, i: number, w: number, wh: number, needAt: (k: number) => ReachCorrection, halfVecAt: (k: number) => number[], pelvisVecAt: (k: number) => number[]): ReachCorrection {
  let bestH = 0;
  let sx = 0;
  let sz = 0;
  for (let k = Math.max(0, i - wh); k <= Math.min(n - 1, i + wh); k++) {
    const gh = kern(k - i, wh);
    const c = needAt(k);
    bestH = Math.max(bestH, Math.hypot(c.hx, c.hz) * gh);
    sx += c.hx * gh;
    sz += c.hz * gh;
  }
  const hl = Math.hypot(sx, sz);
  return { pelvis: envelope(pelvisVecAt, n, i, w), half: envelope(halfVecAt, n, i, w), hx: hl < 1e-9 ? 0 : (sx / hl) * bestH, hz: hl < 1e-9 ? 0 : (sz / hl) * bestH };
}

/**
 * Probe hook (off in play): each stroke's largest planned trunk turn (spine and chest together, deg) and hips shift (m),
 * as the evaluators' reach-magnitude report reads them.
 */
const REACH_STATS: { on: boolean; byTrack: WeakMap<ActorTrack, { deg: number; pelvis: number; hips: number }> } = { on: false, byTrack: new WeakMap() };

/** The reach is planned this long either side of the frames that need it (ms): the trunk turns ahead of the bat. */
const REACH_SMOOTH_MS = 300;
/** The hips' share of the reach is planned wider still (ms): a shift of 0.2 m then accelerates at most ~8 m/s². */
const REACH_HIPS_SMOOTH_MS = 380;
/** What is left to the frame itself after the planned reach (deg of trunk, m of hips). */
const REACH_RESIDUAL = { deg: 8, hipsM: 0 } as const;

/** The trunk's fit a weight w of the way (actor frame; after the legs). `j` must be the pose's FK. */
function applyTrunk(pose: SampledPose, j: Joints, fit: TrunkFit, w: number): void {
  turnBone(pose, j, 'spine', partial(fit.spine, w));
  forwardKinematics(pose, j);
  turnBone(pose, j, 'chest', partial(fit.chest, w));
  forwardKinematics(pose, j);
  turnBone(pose, j, 'neck', partial(fit.neck, w));
}

/**
 * The ankle's §9 range (X ∈ [−40°, 60°]; round 7): a foot whose shin leans on over it further than that (X below −40°)
 * lifts its heel, turning about the ball of the foot (the sole at +0.135 m), which stays where it was, and the leg is
 * solved onto the raised ankle. A soft limit, so the heel starts to come up smoothly: from ANKLE_X_SOFT.from, never
 * past ANKLE_X_SOFT.to. Drawn form, actor frame; `j` is left as the result's FK.
 */
export function heelsUp(pose: SampledPose, j: Joints): void {
  const { from, to } = ANKLE_X_SOFT;
  for (let f = 0; f < 2; f++) {
    const side = f === 0 ? 'L' : 'R';
    const fi = BONE_INDEX[`foot${side}`] * 4;
    let want = Infinity;
    for (let it = 0; it < 3; it++) {
      const q: Quat = [pose.q[fi], pose.q[fi + 1], pose.q[fi + 2], pose.q[fi + 3]];
      const [x, y, z] = eulerXYZ(q);
      // The angle is set from the pose as it came (each pass after the first only takes up what the leg's solve moved).
      if (it === 0) {
        if (x >= from) break;
        want = from - (from - to) * Math.tanh((from - x) / (from - to));
      }
      if (Math.abs(x - want) < 0.05) break;
      const h = (a: number, k: 0 | 1 | 2): Quat => {
        const r = (a * Math.PI) / 360;
        const out: Quat = [0, 0, 0, Math.cos(r)];
        out[k] = Math.sin(r);
        return out;
      };
      const q1 = qmul(qmul(h(want, 0), h(y, 1)), h(z, 2));
      forwardKinematics(pose, j);
      const shin = BONE_INDEX[`shin${side}`] * 4;
      const S: Quat = [j.q[shin], j.q[shin + 1], j.q[shin + 2], j.q[shin + 3]];
      const a = joint(j, `foot${side}`);
      const ball0 = rotateVec(qmul(S, q), BALL_OF_FOOT);
      const ball1 = rotateVec(qmul(S, q1), BALL_OF_FOOT);
      for (let k = 0; k < 4; k++) pose.q[fi + k] = q1[k];
      // A foot in the air only turns at the ankle; one on the ground keeps its ball where it is (the ankle rises).
      if (a[1] + ball0[1] > BALL_DOWN_M) break;
      forwardKinematics(pose, j);
      const target: [number, number, number] = [a[0] + ball0[0] - ball1[0], a[1] + ball0[1] - ball1[1], a[2] + ball0[2] - ball1[2]];
      const pole = rotateVec([j.q[0], j.q[1], j.q[2], j.q[3]], [0, 0, 1]);
      twoBoneIK(pose, j, `thigh${side}`, `shin${side}`, `foot${side}`, target, 1, pole);
    }
  }
  forwardKinematics(pose, j);
}
/** The soft ankle limit (deg of the foot's X against the shin): the heel starts to rise at `from`, never past `to`. */
const ANKLE_X_SOFT = { from: -35, to: -39.5 } as const;
/** The shoe's sole points in the foot's frame (m; MOTION-SPEC §9): heel, ball of the foot, tip of the sole. */
const SOLE_POINTS: ReadonlyArray<readonly [number, number, number]> = [
  [0, -0.065, -0.05],
  [0, -0.065, 0.135],
  [0, -0.065, 0.2],
];
/** The ball of the foot in the foot's frame (m), and how near the ground it is down. */
const BALL_OF_FOOT = SOLE_POINTS[1];
const BALL_DOWN_M = 0.03;

/** Euler XYZ (deg) of a local rotation, as scripts/motion/metrics.mjs reads the §9 hinges. */
function eulerXYZ(q: Quat): [number, number, number] {
  const [x, y, z, w] = q;
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - w * z);
  const m13 = 2 * (x * z + w * y);
  const m23 = 2 * (y * z - w * x);
  const m33 = 1 - 2 * (x * x + y * y);
  const d = 180 / Math.PI;
  return [Math.atan2(-m23, m33) * d, Math.asin(Math.max(-1, Math.min(1, m13))) * d, Math.atan2(-m12, m11) * d];
}

/**
 * A batter's first steps into a run (round 7): from the set-off `at` (scene ms), per drawn leg [L, R], the run's legs
 * at 120 Hz (`ank`: their ankles, world) and the plan: a stance holds the ankle at A; a swing goes from A (where the
 * last stance held it) to B (where the run's legs put it down), along the run's own swing, corrected by an offset that
 * eases from the one at the lift to the one at the landing; the last swing ('back') eases from A onto the planted-foot
 * plan (its weight going to 0 by its end). The feet never move while they are down, so a run starts without skating.
 */
interface FirstLeg {
  at: number;
  dt: number;
  ank: [Vec3[], Vec3[]];
  /** Each foot's sole points (heel, ball, tip) from its ankle at each sample, as the run's legs pitch the shoe. */
  sole: [Vec3[][], Vec3[][]];
  feet: [FirstLegSeg[], FirstLegSeg[]];
}
interface FirstLegSeg {
  k: 'stance' | 'swing' | 'back';
  i0: number;
  i1: number;
  A: Vec3;
  B?: Vec3;
  /** A stance: the ankle at each sample from i0 (rollingStance), A at its first. */
  hold?: Vec3[];
}

/** The vectors from a foot's ankle to its three sole points, in world axes (the shoe as the clip's pose pitches it). */
function soleOffsets(j: Joints, bone: 'footL' | 'footR', heading: number, scale: number): Vec3[] {
  const o = BONE_INDEX[bone] * 4;
  const q = [j.q[o], j.q[o + 1], j.q[o + 2], j.q[o + 3]];
  return SOLE_POINTS.map((p) => {
    const r = rotateVec(q, p);
    return localToWorld(r[0], r[1], r[2], ZERO, heading, scale);
  });
}
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * The ankle's way across a planted stance (samples i0 up to i1): the shoe rolls over the ground. The lowest sole point (heel,
 * then ball, then tip, as the clip pitches the foot) is the pivot: it stays where it touched, and the ankle follows from the
 * pitch the clip gives the shoe. The ankle was pinned where it landed before, and the tip went through the turf (10 cm) as
 * the clip pitched the foot to toe off. A new pivot touches where it is when it takes over; the ankle's height eases onto
 * the pivot's over the first few samples (no step from where the swing put the foot down).
 */
function rollingStance(land: Vec3, i0: number, i1: number, sole: Vec3[][], clip: Vec3[], contactEnd: number): Vec3[] {
  const out: Vec3[] = [];
  let pivot = -1;
  let gx = 0;
  let gz = 0;
  let dy = 0;
  for (let i = i0; i < Math.max(i1, i0 + 1); i++) {
    const o = sole[i];
    let low = 0;
    for (let m = 1; m < o.length; m++) if (o[m].y < o[low].y) low = m;
    if (pivot < 0) {
      pivot = low;
      gx = land.x + o[pivot].x;
      gz = land.z + o[pivot].z;
      dy = land.y + o[pivot].y;
    } else if (low !== pivot && o[low].y < o[pivot].y - ROLL_HANDOVER_M) {
      const at = out[out.length - 1];
      pivot = low;
      gx = at.x + o[pivot].x;
      gz = at.z + o[pivot].z;
    }
    const k = Math.max(0, 1 - (i - i0) / ROLL_LAND_EASE_SAMPLES);
    // Past the clip's contact the pivot stays where it is, and the ankle rises as far as the clip's does above it.
    const rise = i >= contactEnd ? Math.max(0, clip[i].y - -o[pivot].y) : 0;
    out.push({ x: gx - o[pivot].x, y: -o[pivot].y + dy * k + rise, z: gz - o[pivot].z });
  }
  return out;
}
/**
 * Where a stance that the clip's contact ends at sample `lift` really ends: the clip's own foot is still rolling off its
 * toes then, and cleared of the turf only when its ankle is FIRST_LEG_LEAVE_M above where the pitched shoe has it on the
 * ground (at most ROLL_LEAVE_SAMPLES on, and never into the next landing).
 */
function stanceEnd(lift: number, clip: Vec3[], sole: Vec3[][], down: boolean[]): number {
  let end = lift;
  while (end < lift + ROLL_LEAVE_SAMPLES && end < clip.length - 1 && !down[end + 1]) {
    const o = sole[end];
    let low = 0;
    for (let m = 1; m < o.length; m++) if (o[m].y < o[low].y) low = m;
    if (clip[end].y - -o[low].y > FIRST_LEG_LEAVE_M) break;
    end++;
  }
  return end;
}
/** The clip's foot has left the turf once its ankle is this far above where the pitched shoe stands on it (m). */
const FIRST_LEG_LEAVE_M = 0.015;
/** A stance rolls on at most this many samples (of the 120 Hz scan) after the clip's contact ends. */
const ROLL_LEAVE_SAMPLES = 12;
/** Another sole point takes over as the pivot once it is this much lower than the pivot (m). */
const ROLL_HANDOVER_M = 0.005;
/** The ankle's height meets the pivot's over this many samples of the 120 Hz scan after the landing. */
const ROLL_LAND_EASE_SAMPLES = 6;
/** The most a first-leg swing is lifted over the run's own (m; at mid-swing, none at the lift and the landing). */
const FIRST_LEG_LIFT_M = 0.06;
/** A swinging foot's lowest sole point is this far off the turf (m) from FIRST_LEG_CLEAR_RAMP samples into the swing until as many before its landing. */
const FIRST_LEG_CLEAR_M = 0.02;
const FIRST_LEG_CLEAR_RAMP = 3;
/** The first leg lasts this long from the set-off (ms): the next swing that starts hands the feet back. */
const FIRST_LEG_MS = 700;
/** How far into the run its legs are sampled (ms), and how long the hand-back swing lasts at most (ms). */
const FIRST_LEG_SCAN_MS = 1400;
const FIRST_LEG_BACK_MS = 300;
/** The stroke's offsets of the striker's feet go out this long after the set-off, under the held feet (ms). */
const FIRST_LEG_OFFSETS_OUT_MS = 300;

/** The first-leg plan's ankle target for drawn leg f at t (world) and its weight, or null outside the plan. */
function firstLegAt(leg: FirstLeg, f: number, t: number): Pin | null {
  const x = (t - leg.at) / leg.dt;
  if (x < 0) return null;
  const segs = leg.feet[f];
  const seg = segs.find((g) => x >= g.i0 && x < g.i1) ?? null;
  if (!seg) return null;
  const ank = leg.ank[f];
  const C = (i: number): Vec3 => {
    const i0 = Math.max(0, Math.min(ank.length - 1, Math.floor(i)));
    const i1 = Math.min(ank.length - 1, i0 + 1);
    const u = Math.max(0, Math.min(1, i - i0));
    return { x: ank[i0].x + (ank[i1].x - ank[i0].x) * u, y: ank[i0].y + (ank[i1].y - ank[i0].y) * u, z: ank[i0].z + (ank[i1].z - ank[i0].z) * u };
  };
  if (seg.k === 'stance') {
    const h = seg.hold!;
    const u = Math.min(h.length - 1, Math.max(0, x - seg.i0));
    const a = Math.floor(u);
    const b = Math.min(h.length - 1, a + 1);
    const w = u - a;
    return { p: { x: h[a].x + (h[b].x - h[a].x) * w, y: h[a].y + (h[b].y - h[a].y) * w, z: h[a].z + (h[b].z - h[a].z) * w }, w: 1 };
  }
  const span = Math.max(1, seg.i1 - seg.i0);
  const sw = smoothstep(seg.i0, seg.i1, x);
  const u = Math.min(1, Math.max(0, (x - seg.i0) / span));
  // The foot clears the ground over the whole swing (the run's own early swing skims it as the gait speeds up).
  const up = FIRST_LEG_LIFT_M * Math.sin(Math.PI * u);
  const c = C(x);
  c.y += up;
  const c0 = C(seg.i0);
  const lift = { x: seg.A.x - c0.x, y: seg.A.y - c0.y, z: seg.A.z - c0.z };
  // No sole point is below the turf, and the shoe is off it by FIRST_LEG_CLEAR_M a few samples into the swing and until a few
  // before its landing: a foot pitched toe-down for the push-off took its tip through the ground, and dragged it along.
  const above = soleClearance(leg, f, x) + FIRST_LEG_CLEAR_M * Math.min(smoothstep(seg.i0, seg.i0 + FIRST_LEG_CLEAR_RAMP, x), 1 - smoothstep(seg.i1 - FIRST_LEG_CLEAR_RAMP, seg.i1, x));
  if (seg.k === 'back') return { p: { x: c.x + lift.x * (1 - sw), y: Math.max(c.y + lift.y * (1 - sw), above), z: c.z + lift.z * (1 - sw) }, w: 1 - sw };
  const c1 = C(seg.i1);
  const B = seg.B!;
  // Across the ground straight from A to B, at rest at both ends (it comes down onto B, never across it); the height
  // the run's own swing's, carried from A's to B's.
  return { p: { x: seg.A.x + (B.x - seg.A.x) * sw, y: Math.max(c.y + lift.y * (1 - sw) + (B.y - c1.y) * sw, above), z: seg.A.z + (B.z - seg.A.z) * sw }, w: 1 };
}

/** The lowest the ankle may be at sample x so that no sole point, as the run's legs pitch the shoe, is below the turf (m). */
function soleClearance(leg: FirstLeg, f: number, x: number): number {
  const sole = leg.sole[f];
  const i0 = Math.max(0, Math.min(sole.length - 1, Math.floor(x)));
  const i1 = Math.min(sole.length - 1, i0 + 1);
  const u = Math.max(0, Math.min(1, x - i0));
  let low = Infinity;
  for (let k = 0; k < sole[i0].length; k++) low = Math.min(low, sole[i0][k].y + (sole[i1][k].y - sole[i0][k].y) * u);
  return -low;
}
