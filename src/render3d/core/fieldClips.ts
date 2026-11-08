/**
 * Fielder and keeper clip wiring (presentation only). One table names the clip for every body action the fielding
 * choreography (practice/fielding.ts) and the field pose layers draw, with the marker each one is aligned on and, for
 * the gait loops, the ground speed the cycle covers at rate 1 (so a loop is played speed-matched, MOTION-SPEC §6:
 * rate = v / (scale · speedMps), clamped, cross-faded to the next gait outside the clamp).
 *
 * Today the table is the built-in code clips (clips.ts). MOTION's VMP1 packs (`locomotion`, `fielder`, `keeper`,
 * MOTION-SPEC §11) replace entries once they are loaded and registered as clip ids: `useFieldClips()` swaps the table
 * and nothing else changes. Gait speeds of the built-in loops were measured by forward kinematics (the planted
 * ankle's backward speed at rate 1; tests/unit/render3d/fieldMotion.test.ts keeps them honest).
 *
 * Also here: the pose hook StageScene applies to the keeper and the fielders (foot planting, lean, banking, gloves to
 * the ball, weight shifts; core/locomotion.ts), the keeper's per-frame state for the PIP, and `composeHooks`.
 */
import { PITCH_HALF } from '@/physics/geometry';
import { ballAt, ballVelocityAt, simToScene, toWorld } from '../practice/frame';
import { type ActorState, type ActorTrack, evaluateActor, lookScale } from './actors';
import { type ClipId, type SampledPose, blendPose, clipDuration, clipMarker, createPose, overlayLower, sampleClip } from './clips';
import type { BallScript } from './choreo';
import { BONE_INDEX, type BoneName } from './skeleton';
import { type Vec3, hash32, smoothstep } from './math';
import { ANKLE_REST_Y, BODY_REACH_LIMITS, FootPlan, GROUND_BALL_M, HAND_MARKERS, INERT, LEG_RELEASE_S, PLAN_OPTIONS, STEP_STRIDE, StepPlan, applyBoneOffset, bakeAims, bodyReach, hermiteDeviation, inertialize, plantAny, plantFeetLocked, releaseLeg, rootAt, type Joints, bodyLayers, createJoints, forwardKinematics, gaitPose, handsTo, isGaitClip, lookAt, plantFeet, rootMotion } from './locomotion';

export interface GaitClipDef {
  clip: ClipId;
  /** Ground speed (m/s, rig scale 1) the loop covers at rate 1. */
  speedMps: number;
}

export interface FieldClipSet {
  idle: ClipId;
  /** The fielder's set, ready stance at the delivery. */
  ready: ClipId;
  walk: GaitClipDef;
  jog: GaitClipDef;
  run: GaitClipDef;
  /** The hard-accelerating first strides. */
  drive: GaitClipDef;
  /** Sprint (null: the run loop, quickened). */
  sprint: GaitClipDef | null;
  /** `lead`: the drawing clip's own time from its start to the marker, when longer than the built-in's (packs). */
  pickup: { clip: ClipId; marker: string; lead?: number };
  throw: { clip: ClipId; marker: string; lead?: number };
  fumble: { clip: ClipId; marker: string };
  spill: ClipId;
  catchHigh: { clip: ClipId; marker: string; lead?: number };
  catchChest: { clip: ClipId; marker: string; lead?: number };
  diveR: { clip: ClipId; mirror: ClipId; marker: string };
  celebrate: ClipId;
  keeper: {
    crouch: ClipId;
    shuffle: GaitClipDef;
    take: { clip: ClipId; marker: string };
    diveR: { clip: ClipId; mirror: ClipId; marker: string };
  };
}

/** The built-in code clips (clips.ts). */
export const BUILTIN_FIELD_CLIPS: FieldClipSet = {
  idle: 'idle',
  ready: 'ready',
  walk: { clip: 'walk', speedMps: 1.4 },
  jog: { clip: 'jog', speedMps: 3.7 },
  run: { clip: 'run', speedMps: 5.7 },
  drive: { clip: 'run_drive', speedMps: 6.0 },
  sprint: null,
  pickup: { clip: 'field_pickup', marker: 'collect' },
  throw: { clip: 'field_throw', marker: 'release' },
  fumble: { clip: 'field_fumble', marker: 'touch' },
  spill: 'field_spill',
  catchHigh: { clip: 'catch_high', marker: 'catch' },
  catchChest: { clip: 'catch_chest', marker: 'catch' },
  diveR: { clip: 'field_dive_r', mirror: 'field_dive_l', marker: 'reach' },
  celebrate: 'celebrate_jump',
  keeper: {
    crouch: 'keep_crouch',
    shuffle: { clip: 'keep_shuffle', speedMps: 0.77 },
    take: { clip: 'keep_take', marker: 'catch' },
    diveR: { clip: 'keep_dive_r', mirror: 'keep_dive_l', marker: 'reach' },
  },
};

let active: FieldClipSet = BUILTIN_FIELD_CLIPS;

/** The clip table the choreography draws with now. */
export function fieldClips(): FieldClipSet {
  return active;
}

/**
 * Swap in another table (MOTION's packs, once loaded and registered as clip ids), or back to the built-ins with
 * null. Scripts built afterwards use it; a script already built keeps the clips it was built with.
 */
export function useFieldClips(set: FieldClipSet | null): void {
  active = set ?? BUILTIN_FIELD_CLIPS;
}

/** Speed-matched loop rate (MOTION-SPEC §6), clamped to [lo, hi] of the clip's own rate. */
export function matchedRate(g: GaitClipDef, v: number, scale = 1, lo = 0.7, hi = 1.35): number {
  const r = v / Math.max(1e-6, scale * g.speedMps);
  return r < lo ? lo : r > hi ? hi : r;
}

// ---------------------------------------------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------------------------------------------

export type PoseHook = (track: ActorTrack, pose: SampledPose, t: number) => void;

/** One hook that runs each given hook in order (undefined ones skipped); undefined when none is given. */
export function composeHooks(...hooks: Array<PoseHook | undefined | null>): PoseHook | undefined {
  const list = hooks.filter((h): h is PoseHook => typeof h === 'function');
  if (list.length === 0) return undefined;
  if (list.length === 1) return list[0];
  return (track, pose, t) => {
    for (const h of list) h(track, pose, t);
  };
}

/** Whether a track is drawn by the field layers (the keeper and the fielders; never the bowler, batters or umpires). */
const isFieldTrack = (track: ActorTrack): boolean => track.id === 'keeper' || track.id.startsWith('fielder:');

// ---------------------------------------------------------------------------------------------------------------
// The keeper's state for the PIP
// ---------------------------------------------------------------------------------------------------------------

export interface KeeperState {
  /** Ground position (world; the physics position, plus a dive's drawn extension in `drawn`). */
  pos: Vec3;
  drawn: Vec3;
  heading: number;
  clip: ClipId;
  clipTime: number;
  /** What he is doing, for a label or an icon. */
  phase: 'idle' | 'crouch' | 'rise' | 'shuffle' | 'take' | 'dive' | 'run' | 'other';
  /** Hips height above his crouch (0 deep crouch, 1 standing), from the clip's root offset. */
  standing: number;
}

const KEEPER_PHASE: Partial<Record<string, KeeperState['phase']>> = {
  idle: 'idle',
  keep_crouch: 'crouch',
  keep_shuffle: 'shuffle',
  keep_take: 'take',
  keep_dive_r: 'dive',
  keep_dive_l: 'dive',
  walk: 'run',
  jog: 'run',
  run: 'run',
  run_drive: 'run',
};

/**
 * The keeper at scene time t (null when the script has no keeper): the physics position, the drawn position (a dive's
 * extension towards the ball), heading, clip and a coarse phase. Pure; the PIP can call it every frame.
 */
export function keeperStateAt(script: BallScript, t: number): KeeperState | null {
  const track = script.actors.find((a) => a.id === 'keeper');
  if (!track) return null;
  const st = evaluateActor(track, t);
  const clip = st.current.clip;
  let phase: KeeperState['phase'] = KEEPER_PHASE[clip] ?? 'other';
  // The take clip before its catch marker is the rise with the ball.
  if (clip === active.keeper.take.clip && st.current.time < 0.6 * 0.3) phase = 'rise';
  const crouch = clip === active.keeper.crouch || clip === active.keeper.shuffle.clip;
  const standing = crouch ? 0 : clip === active.keeper.take.clip ? Math.min(1, Math.max(0, st.current.time / 1.0)) : 1;
  return {
    pos: st.pos,
    drawn: { x: st.pos.x + (st.body?.x ?? 0), y: 0, z: st.pos.z + (st.body?.z ?? 0) },
    heading: st.heading,
    clip,
    clipTime: st.current.time,
    phase,
    standing,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The field pose hook
// ---------------------------------------------------------------------------------------------------------------

interface BaseScratch {
  a: SampledPose;
  b: SampledPose;
  lower: SampledPose;
  g: SampledPose;
  h: SampledPose;
  s0: SampledPose;
  s1: SampledPose;
  d0: SampledPose;
  d1: SampledPose;
  dm: SampledPose;
  j: Joints;
}
const createBaseScratch = (): BaseScratch => ({ a: createPose(), b: createPose(), lower: createPose(), g: createPose(), h: createPose(), s0: createPose(), s1: createPose(), d0: createPose(), d1: createPose(), dm: createPose(), j: createJoints() });

/**
 * The scene time of the last clip switch (a move that asked for a cross-fade) within INERT.s before t, or null.
 * Pure: read from the moves.
 */
function switchBefore(track: ActorTrack, t: number): { at: number; s: number } | null {
  const moves = track.moves;
  let lo = 0;
  let hi = moves.length - 1;
  if (hi < 1) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (moves[mid].t0 <= t) lo = mid;
    else hi = mid - 1;
  }
  // The switch decays over its own requested fade (at least INERT.s), so a deliberate slow change stays slow.
  for (let k = lo; k > 0 && moves[k].t0 > t - INERT_MAX_MS; k--) {
    const b = moves[k].blend ?? 140;
    if (b <= 0 || moves[k].t0 > t) continue;
    const dur = Math.max(INERT.s, b / 1000);
    return t - moves[k].t0 < dur * 1000 ? { at: moves[k].t0, s: dur } : null;
  }
  return null;
}
const INERT_MAX_MS = 700;

/** Scratch poses for the inertialization at each depth of chained switches. */
const INERT_POOL: Array<{ s0: SampledPose; s1: SampledPose; d0: SampledPose; d1: SampledPose; dm: SampledPose; low: SampledPose }> = [];
const inertScratch = (depth: number) => (INERT_POOL[depth] ??= { s0: createPose(), s1: createPose(), d0: createPose(), d1: createPose(), dm: createPose(), low: createPose() });
const INERT_DEPTH = 3;

/** The clip state at x as drawn (pack substitution, lower layer), without inertia, into out. */
const RAW_JOINTS = createJoints();
const ovQ: number[] = [0, 0, 0, 1];
const ovR: number[] = [0, 0, 0, 1];

/**
 * An action's upper body over a gait's legs: the legs and the pelvis from the gait, the spine counter-rotated so the
 * action's trunk keeps its own orientation (it no longer swings with the gait's pelvis), the hips' height the lower of
 * the two (a scoop on the run stays low).
 */
function overlayActionLegs(dst: SampledPose, legs: SampledPose) {
  const h = 0;
  const sp = BONE_INDEX.spine * 4;
  // spine' = (hips_legs⁻¹ · hips_action) · spine_action
  const ax = -legs.q[h];
  const ay = -legs.q[h + 1];
  const az = -legs.q[h + 2];
  const aw = legs.q[h + 3];
  const bx = dst.q[h];
  const by = dst.q[h + 1];
  const bz = dst.q[h + 2];
  const bw = dst.q[h + 3];
  ovQ[0] = aw * bx + ax * bw + ay * bz - az * by;
  ovQ[1] = aw * by - ax * bz + ay * bw + az * bx;
  ovQ[2] = aw * bz + ax * by - ay * bx + az * bw;
  ovQ[3] = aw * bw - ax * bx - ay * by - az * bz;
  const cx = dst.q[sp];
  const cy = dst.q[sp + 1];
  const cz = dst.q[sp + 2];
  const cw = dst.q[sp + 3];
  ovR[0] = ovQ[3] * cx + ovQ[0] * cw + ovQ[1] * cz - ovQ[2] * cy;
  ovR[1] = ovQ[3] * cy - ovQ[0] * cz + ovQ[1] * cw + ovQ[2] * cx;
  ovR[2] = ovQ[3] * cz + ovQ[0] * cy - ovQ[1] * cx + ovQ[2] * cw;
  ovR[3] = ovQ[3] * cw - ovQ[0] * cx - ovQ[1] * cy - ovQ[2] * cz;
  const y = Math.min(dst.root[1], legs.root[1]);
  overlayLower(dst, legs);
  dst.q[sp] = ovR[0];
  dst.q[sp + 1] = ovR[1];
  dst.q[sp + 2] = ovR[2];
  dst.q[sp + 3] = ovR[3];
  dst.root[1] = y;
}
function rawStateAt(track: ActorTrack, x: number, out: SampledPose, c: SampleCtx, lc: SampleCtx, low: SampledPose) {
  const s2 = evaluateActor(track, x);
  const cx: SampleCtx = { ...c, t: x, gaitUnder: Boolean(s2.current.lower && isGaitClip(s2.current.lower)), fullBody: false };
  sampleState(s2.current.clip, s2.current.time, out, cx);
  if (s2.current.lower && !cx.fullBody) overlayActionLegs(out, sampleState(s2.current.lower, s2.current.lowerTime ?? 0, low, { ...lc, t: x }));
  bakeAims(out, RAW_JOINTS);
}

/**
 * Adds to `pose` (the current clip at t) the decaying offset of the last switch, if t is inside its fade: the source is
 * the pose as presented just before the switch (itself inertialized, so switches in quick succession chain without a
 * jump), the destination the new clip.
 */
function applyInertia(track: ActorTrack, t: number, pose: SampledPose, c: SampleCtx, lc: SampleCtx, scratch: BaseScratch, depth: number) {
  const swi = depth < INERT_DEPTH ? switchBefore(track, t) : null;
  if (!swi) return;
  const sw = swi.at;
  const h = 1000 / 60;
  const k = inertScratch(depth);
  // Presented just before the switch and one frame earlier (with any earlier switch's own decaying offset).
  rawStateAt(track, sw - 1, k.s1, c, lc, k.low);
  applyInertia(track, sw - 1, k.s1, c, lc, scratch, depth + 1);
  rawStateAt(track, sw - 1 - h, k.s0, c, lc, k.low);
  applyInertia(track, sw - 1 - h, k.s0, c, lc, scratch, depth + 1);
  // The new clip at the switch and one frame on; one frame before, extrapolated back.
  rawStateAt(track, sw, k.d0, c, lc, k.low);
  rawStateAt(track, sw + h, k.d1, c, lc, k.low);
  extrapolateBack(k.d0, k.d1, k.dm);
  inertialize(k.s0, k.s1, k.dm, k.d0, h / 1000, (t - sw) / 1000, pose, INERT.omega * (INERT.s / swi.s));
}

/** dst one frame before the switch, extrapolated from the first two frames after it (q and root, per component). */
function extrapolateBack(d0: SampledPose, d1: SampledPose, out: SampledPose) {
  for (let i = 0; i < d0.q.length; i += 4) {
    // out = d0 · (d1⁻¹ · d0)  (one step back at the same angular rate)
    const ax = -d1.q[i];
    const ay = -d1.q[i + 1];
    const az = -d1.q[i + 2];
    const aw = d1.q[i + 3];
    const bx = d0.q[i];
    const by = d0.q[i + 1];
    const bz = d0.q[i + 2];
    const bw = d0.q[i + 3];
    const rx = aw * bx + ax * bw + ay * bz - az * by;
    const ry = aw * by - ax * bz + ay * bw + az * bx;
    const rz = aw * bz + ax * by - ay * bx + az * bw;
    const rw = aw * bw - ax * bx - ay * by - az * bz;
    out.q[i] = bw * rx + bx * rw + by * rz - bz * ry;
    out.q[i + 1] = bw * ry - bx * rz + by * rw + bz * rx;
    out.q[i + 2] = bw * rz + bx * ry - by * rx + bz * rw;
    out.q[i + 3] = bw * rw - bx * rx - by * ry - bz * rz;
  }
  out.root = [2 * d0.root[0] - d1.root[0], 2 * d0.root[1] - d1.root[1], 2 * d0.root[2] - d1.root[2]];
}

// ---------------------------------------------------------------------------------------------------------------
// MOTION's VMP1 packs (MOTION-SPEC §5–§6): substituted for the built-in clips while drawn
// ---------------------------------------------------------------------------------------------------------------

/**
 * The part of a decoded VMP1 clip (scripts/motion/vmp.ts `MotionClip`) the field layers read. Structural, so this file
 * does not pull the decoder into the app's type graph or its bundle: the decoder is passed to `loadFieldMotion`.
 */
export interface MotionClip {
  name: string;
  loop: boolean;
  duration: number;
  speedMps: number;
  markers: Record<string, number>;
  /** Frames per second and count, and the ground track (F × [x, z, yawDeg]): for distance-matched starts and stops. */
  rate?: number;
  frameCount?: number;
  ground?: Float32Array;
  travel?: { x: number; z: number; yawDeg: number };
}

/** The decoder's two entry points the loader uses (scripts/motion/vmp.ts `parsePack` and `sampleMotion`). */
interface MotionDecoder<C extends MotionClip = MotionClip> {
  parsePack(bytes: ArrayBuffer | Uint8Array): { clips: Map<string, C> };
  sampleMotion(clip: C, t: number, out: SampledPose): { contacts: number };
}

/** The decoded clips and the decoder's sampler (scripts/motion/vmp.ts), once loaded. */
export interface FieldMotion {
  clips: ReadonlyMap<string, MotionClip>;
  /** sampleMotion: writes the pose, returns the contact bits of the nearer frame. */
  sample: (clip: MotionClip, t: number, out: SampledPose) => number;
}
let motion: FieldMotion | null = null;
/** The packs last registered, drawn only while PLAN_OPTIONS.fieldPacks is on. */
let registered: FieldMotion | null = null;

/** Turns the field hook's use of the registered packs on or off (scripts built afterwards; evaluation). */
export function setFieldPacks(on: boolean): void {
  PLAN_OPTIONS.fieldPacks = on;
  registerFieldMotion(registered);
}

/**
 * Which pack clip draws a built-in clip, and how its time maps: a loop wraps in its own time (holds) or by phase (the
 * gaits, speed-blended; every gait loop starts on the left foot strike); a one-shot is shifted so its marker lands
 * exactly where the built-in's marker does, which the choreography has put on the physics event.
 */
const SUBSTITUTE: Partial<Record<ClipId, { id: string; marker?: readonly [builtin: string, pack: string] }>> = {
  idle: { id: 'loco_idle' },
  ready: { id: 'fld_ready' },
  field_pickup: { id: 'fld_pickup_2h', marker: ['collect', 'collect'] },
  field_throw: { id: 'fld_throw_over', marker: ['release', 'release'] },
  catch_high: { id: 'fld_catch_high', marker: ['catch', 'catch'] },
  catch_chest: { id: 'fld_catch_low', marker: ['catch', 'catch'] },
  field_dive_r: { id: 'fld_dive_fast_r', marker: ['reach', 'reach'] },
  field_dive_l: { id: 'fld_dive_fast_l', marker: ['reach', 'reach'] },
  celebrate_jump: { id: 'fld_celebrate' },
  keep_crouch: { id: 'kp_crouch_back' },
  keep_shuffle: { id: 'kp_shuffle_r' },
  keep_take: { id: 'kp_take_waist_r', marker: ['catch', 'take'] },
  keep_dive_r: { id: 'kp_dive_r', marker: ['reach', 'reach'] },
  keep_dive_l: { id: 'kp_dive_l', marker: ['reach', 'reach'] },
};

/**
 * Registers decoded pack clips (by id) and the decoder's sampler; null goes back to the built-ins. A script's hook keeps
 * the table it was created with, so a script never changes clips mid-play.
 */
export function registerFieldMotion(m: FieldMotion | null): void {
  registered = m && m.clips.size ? m : null;
  motion = PLAN_OPTIONS.fieldPacks ? registered : null;
  // The choreography advances each gait's phase speed-matched to the loop that draws it: with the packs' gaits, their
  // own stride per cycle (speedMps × duration) over the built-in cycle the moves are timed in.
  const loop = (id: string) => {
    const c = motion?.clips.get(id);
    return c && c.loop && c.speedMps > 0 ? c : null;
  };
  const per = (builtin: GaitClipDef, id: string): GaitClipDef => {
    const c = loop(id);
    return c ? { clip: builtin.clip, speedMps: (c.speedMps * c.duration) / clipDuration(builtin.clip) } : builtin;
  };
  const sprint = loop('loco_sprint');
  const mark = (id: string, name: string) => motion?.clips.get(id)?.markers[name];
  const withLead = <T extends { lead?: number }>(e: T, ...ms: Array<number | undefined>): T => {
    const lead = Math.max(0, ...ms.filter((x): x is number => x !== undefined));
    return lead > 0 ? { ...e, lead } : e;
  };
  const leads = motion
    ? {
        pickup: withLead(BUILTIN_FIELD_CLIPS.pickup, mark('fld_pickup_2h', 'collect')),
        throw: withLead(BUILTIN_FIELD_CLIPS.throw, mark('fld_throw_over', 'release')),
        catchHigh: withLead(BUILTIN_FIELD_CLIPS.catchHigh, mark('fld_catch_high', 'catch')),
        catchChest: withLead(BUILTIN_FIELD_CLIPS.catchChest, mark('fld_catch_low', 'catch'), mark('fld_catch_high', 'catch')),
      }
    : {};
  active = motion && PLAN_OPTIONS.packGaits
    ? {
        ...BUILTIN_FIELD_CLIPS,
        walk: per(BUILTIN_FIELD_CLIPS.walk, 'loco_walk'),
        jog: per(BUILTIN_FIELD_CLIPS.jog, 'loco_jog'),
        run: per(BUILTIN_FIELD_CLIPS.run, 'loco_run'),
        drive: per(BUILTIN_FIELD_CLIPS.drive, 'loco_run'),
        sprint: sprint ? { clip: BUILTIN_FIELD_CLIPS.run.clip, speedMps: (sprint.speedMps * sprint.duration) / clipDuration(BUILTIN_FIELD_CLIPS.run.clip) } : null,
        ...leads,
      }
    : motion
      ? { ...BUILTIN_FIELD_CLIPS, ...leads }
      : BUILTIN_FIELD_CLIPS;
}

/** Clip time at which a one-shot's ground track has travelled `d` metres forward (scale 1); clamped to the clip. */
function groundTime(clip: MotionClip, d: number): number {
  const g = clip.ground;
  const F = clip.frameCount ?? 0;
  const rate = clip.rate ?? 0;
  if (!g || F < 2 || !rate) return 0;
  if (d <= g[1]) {
    // Still standing at the start: the last frame before it moves.
    let k = 0;
    while (k + 1 < F && g[(k + 1) * 3 + 1] <= g[1] + 1e-4) k++;
    return k / rate;
  }
  for (let k = 0; k + 1 < F; k++) {
    const a = g[k * 3 + 1];
    const b = g[(k + 1) * 3 + 1];
    if (d <= b) return (k + (b > a ? (d - a) / (b - a) : 0)) / rate;
  }
  return (F - 1) / rate;
}

/**
 * Fetches and decodes the field packs (`<base>locomotion.vmp`, `fielder.vmp`, `keeper.vmp`; any may be missing) and
 * registers them. Call it at the stage's mount or prewarm, never inside a delivery (no load during play), with the
 * decoder module, e.g. `loadFieldMotion(base, await import('../../../scripts/motion/vmp'))` (a separate chunk).
 * Resolves to the number of clips registered (0: the built-ins stay).
 */
export async function loadFieldMotion<C extends MotionClip>(base: string, vmp: MotionDecoder<C>, fetchBytes: (url: string) => Promise<ArrayBuffer | null> = defaultFetch): Promise<number> {
  const clips = new Map<string, C>();
  for (const pack of ['locomotion', 'fielder', 'fielder_actions', 'keeper']) {
    try {
      const bytes = await fetchBytes(`${base}${pack}.vmp`);
      if (!bytes) continue;
      for (const [id, clip] of vmp.parsePack(bytes).clips) clips.set(id, clip);
    } catch {
      /* a missing or bad pack leaves its clips to the built-ins */
    }
  }
  registerFieldMotion({ clips, sample: (clip, t, out) => vmp.sampleMotion(clip as C, t, out).contacts });
  return clips.size;
}

async function defaultFetch(url: string): Promise<ArrayBuffer | null> {
  const r = await fetch(url);
  return r.ok ? r.arrayBuffer() : null;
}

/** The pack clip time for a built-in clip state (see SUBSTITUTE): loops keep the time, one-shots align their markers. */
export function packTime(builtin: ClipId, time: number, clip: MotionClip): number {
  const sub = SUBSTITUTE[builtin];
  if (clip.loop || !sub?.marker) return time;
  const pm = clip.markers[sub.marker[1]];
  if (pm === undefined) return time;
  const bm = clipMarker(builtin, sub.marker[0], 0);
  // A dive's launch is the physics take-off to the reach (the choreography warps it): the pack's whole launch, frame 0
  // at the take-off, fills it.
  if (DIVES.has(builtin) && time < bm && bm > 0) {
    // Only the pack's take-off → reach section is warped onto the physics launch (its gather before the take-off would
    // anticipate the dive): frame 0 for the keeper's dive, 0.32 s for the fielder's (MOTION-FIELD2).
    const off = DIVE_TAKEOFF[clip.name] ?? 0;
    return off + ((pm - off) * Math.max(0, time)) / bm;
  }
  return pm + (time - bm);
}
const DIVES = new Set<ClipId>(['field_dive_r', 'field_dive_l', 'keep_dive_r', 'keep_dive_l']);
/** Where the pack dive's take-off is (s; the near foot leaving the ground). */
const DIVE_TAKEOFF: Record<string, number> = { fld_dive_r: 0.32, fld_dive_l: 0.32, fld_dive_fast_r: 0.32, fld_dive_fast_l: 0.32 };

/** A run's start from standing or stop to standing (scene ms), whether it is fast enough for the sprint clips. */
interface RunEnd {
  t: number;
  fast: boolean;
  /** Start: when the start clip has covered its distance, and the move's gait phase then (the loops' offset). */
  exitT: number;
  exitPhase: number | null;
}
/** Per-track pack choices: clip overrides (the keeper's; '' = no pack clip), the walk in, runs, the walk back. */
interface PackPicks {
  clips: Partial<Record<ClipId, string>>;
  walkInEnd: number;
  release: number;
  returnFrom: number;
  /** The keeper's take: the share of its lead-in drawn as the rise from the bounce (0: no rise, the take alone). */
  riseShare: number;
  starts: RunEnd[];
  stops: RunEnd[];
}
const NO_PICKS: PackPicks = { clips: {}, walkInEnd: -Infinity, release: -Infinity, returnFrom: Infinity, riseShare: 0, starts: [], stops: [] };
/** The sprint start and stop clips are for runs that reach this speed (m/s); slower runs keep the loops. */
const SPRINT_CLIPS_MPS = 4.5;

interface SampleCtx {
  v: number;
  aF: number;
  legsOnly: boolean;
  motion: FieldMotion | null;
  pick: PackPicks;
  track: ActorTrack;
  t: number;
  scale: number;
  g: SampledPose;
  h: SampledPose;
  /** Sampling a lower-body layer (legs under a one-shot). */
  lower?: boolean;
  /** The action has a gait's legs under it (on the run), and the root's ground speed (m/s). */
  gaitUnder?: boolean;
  speed: number;
  /** Set when the clip drawn is full-body (the lower layer is not overlaid). */
  fullBody?: boolean;
  /** Contact bits of the pack clip drawn (when one is), for the foot plan. */
  contacts?: number;
}

/** Ground distance along a track's path from a to b (scene ms; a ≤ b), sampled every 40 ms. */
function pathDistance(track: ActorTrack, a: number, b: number): number {
  let d = 0;
  let p = rootAt(track, a);
  for (let t = a + 40; ; t += 40) {
    const q = rootAt(track, Math.min(t, b));
    d += Math.hypot(q.x - p.x, q.z - p.z);
    p = q;
    if (t >= b) break;
  }
  return d;
}

/**
 * The pack gait loop for a built-in gait clip at one phase: the loop whose stride the choreography timed the move's
 * cycle for (walk, jog, run; the drive cycle on the run's stride; the run at sprint speed on the sprint loop), so the
 * drawn stride matches the ground speed. Gait changes are the moves' own phase-synced cross-fades. False: no loop.
 */
function sampleLoops(mot: FieldMotion, phase: number, c: SampleCtx, out: SampledPose, clip: ClipId): boolean {
  const id = clip === 'walk' ? 'loco_walk' : clip === 'jog' ? 'loco_jog' : clip === 'run' && active.sprint && c.v * c.scale >= SPRINT_FROM_MPS * c.scale ? 'loco_sprint' : 'loco_run';
  const loop = mot.clips.get(id) ?? mot.clips.get('loco_run');
  if (!loop || !loop.loop || !(loop.speedMps > 0)) return false;
  c.contacts = mot.sample(loop, phase * loop.duration, out);
  return true;
}
/** The sprint loop draws a run from this speed (m/s, scale 1): the geometric mean of the pack's run and sprint speeds. */
const SPRINT_FROM_MPS = Math.sqrt(5.6 * 7.8);

function copyPose(src: SampledPose, dst: SampledPose) {
  dst.q.set(src.q);
  dst.root = [src.root[0], src.root[1], src.root[2]];
  dst.aimR = src.aimR;
  dst.aimL = src.aimL;
  dst.bat = src.bat;
  dst.twoHands = src.twoHands;
}

/** Samples one clip state: a pack clip when one is registered for it, a gait loop as the smooth speed-blended gait. */
/**
 * The actions the packs draw when PLAN_OPTIONS.packActionsOnly is on. On the run (a gait under the action) only the
 * pickup draws from the pack, as the full-body running pickup; a throw draws from it only once he is (nearly) stopped.
 */
const PACK_ACTIONS = new Set<ClipId>(['ready', 'field_pickup', 'field_throw', 'catch_high', 'catch_chest', 'field_dive_r', 'field_dive_l', 'keep_crouch', 'keep_take', 'keep_dive_r', 'keep_dive_l']);
/**
 * Whether a pickup on the run draws the pack's full-body running pickup. Off: measured on the physics corpus it pops
 * more than the built-in pickup over the gait (field_pickup/run 135 against 33; WEB-FIELD final, 2026-11-04).
 */
const RUN_PICKUP_FULL_BODY = false;
/** The running pickup's own speed (m/s, MOTION) and its time warp's limits. */
const PICKUP_1H = { id: 'fld_pickup_1h', mps: 3.5, warp: [0.75, 1.3] as const };
/** A pack throw only below this ground speed (m/s): on the move, the built-in throw over the gait. */
const PACK_THROW_MAX_MPS = 1;

function sampleState(clip: ClipId, time: number, out: SampledPose, c: SampleCtx): SampledPose {
  let mot = c.motion && (!PLAN_OPTIONS.packActionsOnly || PACK_ACTIONS.has(clip)) ? c.motion : null;
  if (mot && PLAN_OPTIONS.packActionsOnly && !c.lower) {
    // A pickup on the run: the pack's full-body running pickup, time-warped to the physics speed around its gather
    // (exact at the physics collect); any other action on the run, or a throw still on the move, stays built-in.
    if (RUN_PICKUP_FULL_BODY && c.gaitUnder && clip === 'field_pickup') {
      const run = mot.clips.get(PICKUP_1H.id);
      const bm = clipMarker(clip, 'collect', 0.3);
      const pm = run?.markers.collect;
      if (run && pm !== undefined) {
        const rate = Math.min(PICKUP_1H.warp[1], Math.max(PICKUP_1H.warp[0], (c.speed / c.scale) / PICKUP_1H.mps));
        c.contacts = mot.sample(run, pm + (time - bm) * rate, out);
        c.fullBody = true;
        return out;
      }
    }
    if (c.gaitUnder || (clip === 'field_throw' && c.speed >= PACK_THROW_MAX_MPS)) mot = null;
  }
  if (mot && clip === 'walk' && c.t >= c.pick.returnFrom) {
    // The walk back after the dead ball.
    const rt = mot.clips.get('fld_return');
    if (rt && rt.loop) {
      c.contacts = mot.sample(rt, ((((time / clipDuration(clip)) % 1) + 1) % 1) * rt.duration, out);
      return out;
    }
  }
  if (mot && clip === 'walk' && c.t < c.pick.walkInEnd + 600 && c.t < c.pick.release) {
    // The walk in with the bowler (and its fade into the set).
    const wi = mot.clips.get('fld_walk_in');
    if (wi && wi.loop) {
      c.contacts = mot.sample(wi, ((((time / clipDuration(clip)) % 1) + 1) % 1) * wi.duration, out);
      return out;
    }
  }
  if (mot && clip === 'ready' && c.t >= c.pick.walkInEnd) {
    // Out of the walk in into the set: the clip carries on from where its own steps stop, so the split-step lands
    // just after the release (generic: it never looks at where the ball will go).
    const set = mot.clips.get('fld_set');
    const travel = set?.travel?.z ?? 0;
    if (set && !set.loop && set.ground) {
      const from = groundTime(set, travel - 0.005);
      const ts = from + (c.t - c.pick.walkInEnd) / 1000;
      if (ts < set.duration) {
        c.contacts = mot.sample(set, ts, out);
        const ready = mot.clips.get(c.pick.clips.ready ?? 'fld_ready');
        const w = smoothstep(set.duration - 0.25, set.duration, ts);
        if (ready && w > 0) {
          mot.sample(ready, time, c.h);
          blendPose(out, c.h, w);
        }
        return out;
      }
    }
  }
  if (isGaitClip(clip) && !(mot && PLAN_OPTIONS.packGaits)) {
    gaitPose(c.v, (((time / clipDuration(clip)) % 1) + 1) % 1, c.aF, out, c.legsOnly);
    return out;
  }
  if (isGaitClip(clip)) {
    const phase = (((time / clipDuration(clip)) % 1) + 1) % 1;
    // A start from standing and a stop to standing: the pack's one-shots, time-warped so their ground track covers the
    // physics path's own distance (the feet keep to the ground), cross-fading into and out of the loops.
    const start = mot?.clips.get('fld_sprint_start') ?? mot?.clips.get('loco_start');
    const stop = mot?.clips.get('fld_decel_stop') ?? mot?.clips.get('loco_stop');
    let s0: RunEnd | null = null;
    for (const s of c.pick.starts) if (s.t <= c.t) s0 = s;
    let e0: RunEnd | null = null;
    for (const e of c.pick.stops)
      if (e.t >= c.t) {
        e0 = e;
        break;
      }
    // After a start clip the loops carry on from its last left strike (its phase 0), not from the move's own phase.
    // Throughout the run (the blend into the loops included), so the loops meet the start clip at its last strike.
    let drawPhase = phase;
    if (PLAN_OPTIONS.packStartStop && s0 && s0.exitPhase !== null && !c.pick.stops.some((e) => e.t > s0!.t && e.t < c.t)) drawPhase = (((phase - s0.exitPhase) % 1) + 1) % 1;
    // A start or a stop is the whole body's (never the legs under a pickup or a throw on the move).
    if (mot && PLAN_OPTIONS.packStartStop && !c.lower && start?.ground && start.travel && s0 && s0.fast) {
      const d = pathDistance(c.track, s0.t, c.t) / c.scale;
      const L = start.travel.z;
      if (d < L && !c.pick.stops.some((e) => e.t > s0!.t && e.t < c.t)) {
        c.contacts = mot.sample(start, groundTime(start, d), out);
        const w = smoothstep(L - 0.5, L, d);
        if (w > 0) {
          sampleLoops(mot, drawPhase, c, c.h, clip);
          blendPose(out, c.h, w);
        }
        return out;
      }
    }
    if (mot && PLAN_OPTIONS.packStartStop && !c.lower && stop?.ground && stop.travel && e0 && e0.fast) {
      const r = pathDistance(c.track, c.t, e0.t) / c.scale;
      const L = stop.travel.z;
      if (r < L && !c.pick.starts.some((s) => s.t > c.t && s.t < e0!.t)) {
        const contacts = mot.sample(stop, groundTime(stop, L - r), out);
        const w = smoothstep(L, L - 0.6, r);
        if (w < 1) {
          sampleLoops(mot, drawPhase, c, c.h, clip);
          blendPose(c.h, out, w);
          copyPose(c.h, out);
        }
        c.contacts = contacts;
        return out;
      }
    }
    if (mot && sampleLoops(mot, drawPhase, c, out, clip)) return out;
    gaitPose(c.v, phase, c.aF, out, c.legsOnly);
    return out;
  }
  const sub = SUBSTITUTE[clip];
  const packId = c.pick.clips[clip] ?? sub?.id;
  const packClip = mot && sub && packId ? mot.clips.get(packId) : undefined;
  if (mot && !packClip && clip === active.keeper.shuffle.clip) {
    // No keeper shuffle shipped yet: the locomotion pack's side step-close, on the shuffle's own cycle (phase-synced),
    // its contact bits stepping the feet.
    const side = (c.pick.clips.keep_shuffle ?? '').endsWith('_l') ? 'l' : 'r';
    const strafe = mot.clips.get(`loco_strafe_${side}`);
    if (strafe && strafe.loop) {
      c.contacts = mot.sample(strafe, ((((time / clipDuration(clip)) % 1) + 1) % 1) * strafe.duration, out);
      return out;
    }
  }
  if (mot && packClip && clip === active.keeper.take.clip && c.pick.riseShare > 0) {
    // The keeper's rise with the ball from its bounce: the take's lead-in (the choreography stretched it back to the
    // bounce) is the pack's rise (bounce → set), then the take's own lead-in to the gloves at the physics take.
    const rise = mot.clips.get('kp_rise');
    const bm = clipMarker(clip, active.keeper.take.marker, 0.3);
    if (rise && time < bm && rise.markers.bounce !== undefined) {
      const f = Math.max(0, time) / bm;
      if (f < c.pick.riseShare) {
        // From the bounce to the rise's end, whose pose is the take's frame 0 (MOTION-KEEPER: a 0.04° seam).
        c.contacts = mot.sample(rise, rise.markers.bounce + (rise.duration - rise.markers.bounce) * (f / c.pick.riseShare), out);
        return out;
      }
      const pm = packClip.markers.take ?? 0;
      c.contacts = mot.sample(packClip, (pm * (f - c.pick.riseShare)) / (1 - c.pick.riseShare), out);
      return out;
    }
  }
  // The fast dive flows into its scramble at its last frame (MOTION-FIELD2: exact in pose and velocity), on his feet
  // at the physics take + DIVE.recoverS; without the fast pair, the dive and its get-up.
  const dive = mot && sub && DIVES.has(clip) ? (mot.clips.get(packId!) ?? mot.clips.get(packId!.replace('_fast', ''))) : undefined;
  if (mot && dive) {
    const pt = packTime(clip, time, dive);
    const next = dive.name.includes('_fast') ? mot.clips.get(dive.name.replace('dive_fast', 'dive_scramble')) : mot.clips.get(dive.name.replace('dive', 'getup'));
    if (next && pt > dive.duration) c.contacts = mot.sample(next, Math.min(next.duration, pt - dive.duration), out);
    else c.contacts = mot.sample(dive, pt, out);
    return out;
  }
  if (mot && packClip) {
    c.contacts = mot.sample(packClip, packTime(clip, time, packClip), out);
    return out;
  }
  return sampleClip(clip, time, out);
}

/**
 * The base pose of a field track at t, as the field hook draws it: the move's clip (a pack clip when MOTION's packs
 * are registered; a gait loop drawn as the speed-blended gait at the root's own speed), its lower layer, the
 * cross-fade, then lean, banking and weight shift. Pure.
 */
function fieldBasePose(
  track: ActorTrack,
  t: number,
  scratch: BaseScratch,
  scale: number,
  phase: number,
  sway: boolean,
  legsOnly = false,
  mot: FieldMotion | null = null,
  pick: PackPicks = NO_PICKS,
): { pose: SampledPose; st: ActorState; gait: { phase: number; v: number } | null; contacts?: number } {
  const st = evaluateActor(track, t);
  const needsGait = isGaitClip(st.current.clip) || (st.current.lower && isGaitClip(st.current.lower)) || (st.previous && (isGaitClip(st.previous.clip) || (st.previous.lower && isGaitClip(st.previous.lower))));
  const m = rootMotion(track, t);
  let v = 0;
  let aF = 0;
  if (needsGait) {
    v = Math.hypot(m.vx, m.vz) / scale;
    aF = (m.ax * Math.sin(st.heading) + m.az * Math.cos(st.heading)) / scale;
  }
  const gaitUnder = Boolean(st.current.lower && isGaitClip(st.current.lower));
  const c: SampleCtx = { v, aF, legsOnly, motion: mot, pick, track, t, scale, g: scratch.g, h: scratch.h, gaitUnder, speed: Math.hypot(m.vx, m.vz) };
  const pose = sampleState(st.current.clip, st.current.time, scratch.a, c);
  const contacts = c.contacts;
  const lc: SampleCtx = { ...c, lower: true };
  if (st.current.lower && !c.fullBody) overlayActionLegs(pose, sampleState(st.current.lower, st.current.lowerTime ?? 0, scratch.lower, lc));
  // Arm aims baked into the upper arms (as the stage would apply them), so every layer below works on the drawn arm.
  bakeAims(pose, scratch.j);
  // A clip switch within its fade: inertialized (the presented pose's offset and its rate at the switch decay,
  // critically damped) in place of the moves' linear cross-fade.
  applyInertia(track, t, pose, c, lc, scratch, 0);
  bodyLayers(track, pose, t, st.current.clip, sway ? phase : NaN, st, m, legsOnly);
  if (PLAN_OPTIONS.smoothRoot) {
    // The C1 root: the hips carried along the smooth curve through the physics samples (exact at each of them).
    const d = hermiteDeviation(track, t);
    if (d) {
      const cs = Math.cos(st.heading);
      const sn = Math.sin(st.heading);
      pose.root[0] += (cs * d.x - sn * d.z) / scale;
      pose.root[2] += (sn * d.x + cs * d.z) / scale;
    }
  }
  // Stepping cycles for the foot plan: the gaits, and the keeper's crouched shuffle (stepping at a walk's timing).
  const steps = (cl: ClipId) => isGaitClip(cl) || cl === active.keeper.shuffle.clip;
  const gc = steps(st.current.clip) ? st.current : st.current.lower && steps(st.current.lower) ? { clip: st.current.lower, time: st.current.lowerTime ?? 0 } : null;
  const gait = gc ? { phase: (((gc.time / clipDuration(gc.clip)) % 1) + 1) % 1, v: isGaitClip(gc.clip) ? v || Math.hypot(m.vx, m.vz) / scale : 1 } : null;
  // The current clip's contact bits reach the foot plan through a cross-fade too (without them the plan would fall back
  // to its height rule mid-fade, unplanting a pack crouch's feet, which stand on their toes: a leg-wide jump).
  return { pose, st, gait, ...(contacts !== undefined ? { contacts } : {}) };
}

/**
 * Where a delivery's planted-foot plans start, and the layer fades in over PLAN_FADE_IN_MS from there. A plan is built
 * forward from its start, a few microseconds per track per 60 Hz step, the first time a frame needs it:
 *  - the delivery's first script (before the result) starts before the walk in and builds as it plays, a step a frame;
 *  - the result script arrives at contact and must catch up at once, so it starts just before the release (its walk
 *    in, seen again only in a replay, is drawn from the clips alone).
 */
const PLAN_BEFORE_RELEASE_MS = 1900;
const PLAN_BEFORE_RELEASE_RESULT_MS = 0;
const PLAN_FADE_IN_MS = 300;

/** Holds a run can stop into (a stop clip plays into them; a pickup, catch or dive has its own clip). */
const STAND_AFTER = new Set<ClipId>(['idle', 'ready', 'keep_crouch', 'hands_on_hips', 'clap']);

/** The take and release markers (HAND_MARKERS) whose fades may cover t (marker within [t − 420, t + 600] ms), with each clip's start. */
function markersNear(track: ActorTrack, t: number): Array<{ clip: ClipId; t: number; start: number }> {
  const out: Array<{ clip: ClipId; t: number; start: number }> = [];
  const moves = track.moves;
  let lo = 0;
  let hi = moves.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (moves[mid].t0 <= t) lo = mid;
    else hi = mid - 1;
  }
  for (let k = Math.max(0, lo - 10); k < moves.length && k < lo + 10; k++) {
    const mv = moves[k];
    const hm = HAND_MARKERS[mv.clip];
    if (!hm) continue;
    const m = clipMarker(mv.clip, hm.marker, Number.NaN);
    if (Number.isNaN(m)) continue;
    const rate = mv.rate ?? 1;
    const c0 = mv.clipStart ?? 0;
    const c1 = c0 + ((mv.t1 - mv.t0) / 1000) * rate;
    if (m < c0 - 1e-6 || m > c1 + 1e-6) continue;
    const mt = mv.t0 + ((m - c0) / rate) * 1000;
    if (mt < t - 420 || mt > t + 600 || out.some((o) => o.clip === mv.clip && Math.abs(o.t - mt) < 1)) continue;
    // Where the clip's run of moves began (its own approach).
    let k0 = k;
    while (k0 > 0 && moves[k0 - 1].clip === mv.clip) k0--;
    out.push({ clip: mv.clip, t: mt, start: moves[k0].t0 });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Takes and releases the whole-body reach could not bring within arm's reach (for the harness's log; bounded). */
const lastReachShort: Array<{ track: string; t: number; m: number }> = [];
/** The trunk bones a whole-body reach bends. */
const TRUNK_BONES: readonly BoneName[] = ['hips', 'spine', 'chest'];
/** The arm bones a hand correction moves. */
const ARM_BONES: Record<'both' | 'right', readonly BoneName[]> = {
  both: ['upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR'],
  right: ['upperArmR', 'forearmR', 'handR'],
};
/** Takes keep the authored action height; live locomotion still uses the deeper anti-singularity knee flex. */
const TAKE_LEG_GEOMETRY = [0.98, 0.99] as const;

/** Clips the eyes do not follow the ball through (a throw, a celebration, a dive, a reaction). */
const NO_LOOK = /throw|celebrate|clap|hands_on|dive|dejected|appeal/;

export interface FieldHookOptions {
  /** Reduced Motion: no weight shift or head tracking (the planted feet and the takes stay). */
  reducedMotion?: boolean;
}

/**
 * The pose hook for the keeper and the fielders of one script (StageScene `poseHook`, composed with any other):
 * the smooth gait, lean and banking, weight shift, planted feet, eyes on the ball and hands to it at a take. Other
 * actors pass through untouched. Pure in (track, t): the planted-foot plan of each track is built forward from a
 * fixed anchor (400 ms before the release of a delivery, else the script's start) and cached for the script.
 */
const HOOKS = new WeakMap<BallScript, { reducedMotion: boolean; hook: PoseHook }>();

/**
 * The field hook for a script, created once per script (and Reduced Motion setting) and reused every frame: its
 * planted-foot plans are built forward as the script plays. This is the one the stage should call per frame.
 */
export function fieldPoseHookFor(script: BallScript, opts: FieldHookOptions = {}): PoseHook {
  const reducedMotion = Boolean(opts.reducedMotion);
  const cached = HOOKS.get(script);
  if (cached && cached.reducedMotion === reducedMotion) return cached.hook;
  const hook = fieldPoseHook(script, opts);
  HOOKS.set(script, { reducedMotion, hook });
  return hook;
}

export function fieldPoseHook(script: BallScript, opts: FieldHookOptions = {}): PoseHook {
  const p = script.practice ?? null;
  const result = p?.result ?? null;
  const anchor = p && p.flight ? Math.max(0, p.releaseScene - (result ? PLAN_BEFORE_RELEASE_RESULT_MS : PLAN_BEFORE_RELEASE_MS)) : 0;
  const sway = !opts.reducedMotion;
  // The packs registered when this script's hook is made draw it throughout.
  const mot = motion;
  /**
   * Per-track pack choices: when the walk in ends; when each run from standing starts and each run to standing stops;
   * and for the keeper his crouch (up to spin or back to pace) and his take's height and side.
   */
  const packPicks = (track: ActorTrack): PackPicks => {
    const moving = (m: ActorTrack['moves'][number]) => Boolean(m.from && m.to && Math.hypot(m.to.x - m.from.x, m.to.z - m.from.z) > 1e-6);
    let walkInEnd = -Infinity;
    const starts: RunEnd[] = [];
    const stops: RunEnd[] = [];
    const rel = p?.releaseScene ?? 0;
    const dead = p?.deadScene ?? Infinity;
    let returnFrom = Infinity;
    const speed = (m: ActorTrack['moves'][number]) => (moving(m) ? Math.hypot(m.to!.x - m.from!.x, m.to!.z - m.from!.z) / ((m.t1 - m.t0) / 1000) : 0);
    // Runs between a start and a stop, with their peak speed.
    const startClip = mot?.clips.get('fld_sprint_start') ?? mot?.clips.get('loco_start');
    for (let i = 0; i < track.moves.length; i++) {
      const m = track.moves[i];
      if (m.clip === 'walk' && m.t1 <= rel + 1) walkInEnd = m.t1;
      if (m.t0 < rel) continue;
      if (m.clip === 'walk' && m.t0 >= dead && returnFrom === Infinity) returnFrom = m.t0;
      const prev = track.moves[i - 1];
      const next = track.moves[i + 1];
      if (isGaitClip(m.clip) && moving(m) && prev && !moving(prev) && !isGaitClip(prev.clip)) {
        let peak = 0;
        for (let k = i; k < track.moves.length && isGaitClip(track.moves[k].clip) && moving(track.moves[k]); k++) peak = Math.max(peak, speed(track.moves[k]));
        const fast = peak >= SPRINT_CLIPS_MPS * scaleOf(track);
        let exitT = Infinity;
        let exitPhase: number | null = null;
        if (fast && startClip?.travel) {
          // Where the start clip's distance is covered (40 ms steps), and the move's gait phase there.
          const L = startClip.travel.z * scaleOf(track);
          let d = 0;
          let q = rootAt(track, m.t0);
          for (let t = m.t0 + 40; t < m.t0 + 4000; t += 40) {
            const r = rootAt(track, t);
            d += Math.hypot(r.x - q.x, r.z - q.z);
            q = r;
            if (d >= L) {
              exitT = t;
              const st = evaluateActor(track, t);
              const g = isGaitClip(st.current.clip) ? st.current : st.current.lower && isGaitClip(st.current.lower) ? { clip: st.current.lower, time: st.current.lowerTime ?? 0 } : null;
              exitPhase = g ? (((g.time / clipDuration(g.clip)) % 1) + 1) % 1 : null;
              break;
            }
          }
        }
        starts.push({ t: m.t0, fast, exitT, exitPhase });
      }
      if (isGaitClip(m.clip) && moving(m) && next && !moving(next) && STAND_AFTER.has(next.clip)) {
        let peak = 0;
        for (let k = i; k >= 0 && isGaitClip(track.moves[k].clip) && moving(track.moves[k]); k--) peak = Math.max(peak, speed(track.moves[k]));
        stops.push({ t: m.t1, fast: peak >= SPRINT_CLIPS_MPS * scaleOf(track), exitT: Infinity, exitPhase: null });
      }
    }
    return { clips: { ...fielderPicks(track), ...keeperPicks(track) }, walkInEnd, release: rel, returnFrom, riseShare: riseShareOf(track), starts, stops };
  };
  const scaleOf = (track: ActorTrack) => lookScale(track.look);
  /**
   * The keeper's take with a bounce before it: the part of its lead-in after the bounce that is the rise, leaving the
   * take its own lead-in at about its own pace (at least half to the rise, which a keeper standing up plays quickly:
   * he stays low until the ball pitches). No bounce (a full toss), or none before the take: the take alone.
   */
  const riseShareOf = (track: ActorTrack): number => {
    if (track.id !== 'keeper' || !p || !result) return 0;
    const take = result.events.find((e) => e.kind === 'keeper_take' || (e.kind === 'catch' && e.fielderId === 'keeper'));
    const bounce = result.flight.bounce?.t;
    if (!take || bounce === undefined || bounce >= take.t) return 0;
    const m = clipMarker(active.keeper.take.clip, active.keeper.take.marker, 0.3);
    const lead = Math.min(take.t - bounce, m / 0.45);
    const pm = mot?.clips.get(keeperPicks(track).keep_take ?? '')?.markers.take ?? 0.28;
    return Math.min(0.85, Math.max(0.5, 1 - pm / Math.max(lead, 1e-3)));
  };
  /** A fielder's catch: the pack's low or high catch by the ball's height; a long barrier for a straight ground ball. */
  const fielderPicks = (track: ActorTrack): Partial<Record<ClipId, string>> => {
    if (!result || !p) return {};
    const id = track.id.startsWith('fielder:') ? track.id.slice('fielder:'.length) : track.id;
    const out: Partial<Record<ClipId, string>> = {};
    const c = result.events.find((e): e is Extract<typeof e, { kind: 'catch' }> => e.kind === 'catch' && e.fielderId === id);
    // Catches below 1 m: the low catch (fingers down); at chest height and above: the high catch (fingers up).
    if (c && c.p.y >= 1.0) out.catch_chest = 'fld_catch_high';
    // The throw whose hand at release is nearest the physics release point, height first (overarm high in front of the
    // head, the flick low beside the right foot; MOTION-FIELD2); a tie goes to the flick within 12 m, overarm beyond.
    const th = result.events.find((e): e is Extract<typeof e, { kind: 'throw' }> => e.kind === 'throw' && e.fielderId === id);
    if (th) {
      const s0 = scaleOf(track);
      const y = th.p.y;
      const over = Math.abs(y - 1.63 * s0);
      const flick = Math.abs(y - 0.6 * s0);
      const end = result.ball[result.ball.length - 1]?.p;
      const len = end ? Math.hypot(end.x - th.p.x, end.z - th.p.z) : Infinity;
      if (flick < over - 0.05 || (Math.abs(flick - over) <= 0.05 && len <= 12)) out.field_throw = 'fld_flick_under';
    }
    // A ground ball fielded straight on, at standing pace: the long barrier (else the two-handed pickup).
    const f = result.events.find((e): e is Extract<typeof e, { kind: 'field' }> => e.kind === 'field' && e.fielderId === id);
    if (f && f.p.y < 0.3) {
      const t = simToScene(p, f.t);
      const v = ballVelocityAt(result.ball, f.t);
      const st = evaluateActor(track, t);
      const m = rootMotion(track, t);
      if (v && Math.hypot(v.x, v.z) > 2 && Math.hypot(m.vx, m.vz) < 1.5) {
        const w = toWorld(v, p.mirror);
        const facing = Math.sin(st.heading) * -w.x + Math.cos(st.heading) * -w.z;
        if (facing / Math.hypot(w.x, w.z) > Math.cos((25 * Math.PI) / 180)) out.field_pickup = 'fld_long_barrier';
      }
    }
    return out;
  };
  const keeperPicks = (track: ActorTrack): Partial<Record<ClipId, string>> => {
    if (track.id !== 'keeper' || !p) return {};
    const at = evaluateActor(track, p.releaseScene).pos;
    const up = Math.abs(at.z) - PITCH_HALF < 3;
    const out: Partial<Record<ClipId, string>> = { keep_crouch: up ? 'kp_crouch_up' : 'kp_crouch_back' };
    const take = result?.events.find((e) => e.kind === 'keeper_take' || (e.kind === 'catch' && e.fielderId === 'keeper'));
    if (take && 'p' in take) {
      const ball = toWorld(take.p, p.mirror);
      const k = evaluateActor(track, simToScene(p, take.t));
      // Facing the bowler his right is world +x (heading π): the ball's side in his own frame.
      const lateral = -Math.cos(k.heading) * (ball.x - k.pos.x) + Math.sin(k.heading) * (ball.z - k.pos.z);
      const side = lateral < 0 ? 'l' : 'r';
      out.keep_take = `kp_take_${ball.y < 0.95 ? 'waist' : 'chest'}_${side}`;
      out.keep_shuffle = `kp_shuffle_${side}`;
    }
    return out;
  };
  const ballWorld = (sceneT: number): Vec3 | null => {
    if (!p || !result || sceneT < p.releaseScene) return null;
    const b = ballAt(result.ball, (sceneT - p.releaseScene) / 1000);
    return b ? toWorld(b, p.mirror) : null;
  };
  interface State {
    track: ActorTrack;
    scale: number;
    phase: number;
    plan: FootPlan | StepPlan;
    pick: PackPicks;
    joints: Joints;
    joints2: Joints;
    base: BaseScratch;
    base2: BaseScratch;
    clipAt: SampledPose;
    clipAt2: SampledPose;
    fix: Array<{ base: BaseScratch; joints: Joints; targets: Float32Array; clip: SampledPose; clip2: SampledPose }>;
    targets: Float32Array;
    targets2: Float32Array;
  }
  // The keeper's miss: the physics' keeper_take carries shortM when the ball is past his gloves (by that much; dead only
  // because there are no byes). One source of truth: the event.
  const keeperMiss = ((): { t: number; shortM: number } | null => {
    if (!p || !result) return null;
    const ev = result.events.find((e): e is Extract<typeof e, { kind: 'keeper_take' }> => e.kind === 'keeper_take');
    if (!ev || !(ev.shortM && ev.shortM > 0) || result.events.some((e) => e.kind === 'throw' && e.t < ev.t)) return null;
    return { t: simToScene(p, ev.t), shortM: ev.shortM };
  })();
  const states = new Map<string, State>();
  const stateOf = (track: ActorTrack): State => {
    let s = states.get(track.id);
    if (s && s.track === track) return s;
    const scale = lookScale(track.look);
    const phase = (hash32(track.id) % 1000) / 500;
    const planScratch = createBaseScratch();
    const pick = mot ? packPicks(track) : NO_PICKS;
    const baseAt = (t: number) => fieldBasePose(track, t, planScratch, scale, phase, sway, true, mot, pick);
    const plan = PLAN_OPTIONS.stepPlan ? new StepPlan(track, anchor, scale, baseAt) : new FootPlan(track, anchor, scale, baseAt);
    const n = plan instanceof StepPlan ? 2 * STEP_STRIDE : 10;
    s = { track, scale, phase, plan, pick, joints: createJoints(), joints2: createJoints(), base: createBaseScratch(), base2: createBaseScratch(), clipAt: createPose(), clipAt2: createPose(), fix: [0, 1].map(() => ({ base: createBaseScratch(), joints: createJoints(), targets: new Float32Array(n), clip: createPose(), clip2: createPose() })), targets: new Float32Array(n), targets2: new Float32Array(n) };
    states.set(track.id, s);
    return s;
  };
  const hook: PoseHook = (track, pose, t) => {
    if (!isFieldTrack(track) || track.mirror) return;
    const s = stateOf(track);
    const { pose: base, st, contacts: baseContacts } = fieldBasePose(track, t, s.base, s.scale, s.phase, sway, false, mot, s.pick);
    pose.q.set(base.q);
    pose.root = [base.root[0], base.root[1], base.root[2]];
    pose.aimR = base.aimR;
    pose.aimL = base.aimL;
    pose.bat = base.bat;
    pose.twoHands = base.twoHands;
    const root = { x: st.pos.x + (st.body?.x ?? 0), y: 0, z: st.pos.z + (st.body?.z ?? 0) };
    // The hands on the physics ball at a take and a release (the drawn ball leaves and rejoins the physics there):
    // the correction is worked out on the pose at the marker (the trunk bending and the hips dropping when the arm
    // alone cannot reach, then the arms) and rides, as rotation offsets, on the clip's own motion around it, faded in
    // and out, exact at the marker. The trunk and the hips go in before the feet are planted, the arms after.
    const armFixes: Array<{ pose: SampledPose; clip: SampledPose; bones: readonly BoneName[]; w: number }> = [];
    /** How far a scoop has dropped the hips now (world m): a swinging foot comes down with them (keeps its shape). */
    let scoopDrop = 0;
    if (p) {
      // Every take or release whose fade covers t, whatever clip is current (a correction never vanishes at a switch).
      let n = 0;
      for (const mk of markersNear(track, t)) {
        const hm = HAND_MARKERS[mk.clip]!;
        const mt = mk.t;
        let ball = ballWorld(mt);
        // The keeper's take of the delivery that the physics says is past his gloves (keeper_take.shortM, the ball dead
        // only because there are no byes): his gloves stop shortM short of it and never close on it.
        if (ball && track.id === 'keeper' && keeperMiss && Math.abs(mt - keeperMiss.t) < 1) {
          const k0 = evaluateActor(track, mt).pos;
          const dx = ball.x - k0.x;
          const dz = ball.z - k0.z;
          const dh = Math.hypot(dx, dz) || 1;
          const back = Math.min(keeperMiss.shortM, dh);
          ball = { x: ball.x - (dx / dh) * back, y: ball.y, z: ball.z - (dz / dh) * back };
        }
        // The arms over the last 260 ms; the trunk over the clip's own approach (from its start, at most 600 ms), both
        // easing out after the marker (critically damped).
        const out = 1 - smoothstep(mt + 80, mt + 300, t);
        const w = smoothstep(mt - 260, mt, t) * out;
        const wTrunk = smoothstep(Math.max(mt - 600, Math.min(mk.start, mt - 260)), mt, t) * (1 - smoothstep(mt + 80, mt + 420, t));
        if (!ball || Math.max(w, wTrunk) <= 1e-3 || n >= 2) continue;
        const k = s.fix[n++];
        const at = fieldBasePose(track, mt, k.base, s.scale, s.phase, sway, false, mot, s.pick);
        const r2 = { x: at.st.pos.x + (at.st.body?.x ?? 0), y: 0, z: at.st.pos.z + (at.st.body?.z ?? 0) };
        const keeper = track.id === 'keeper';
        const tt = s.plan.at(mt, k.targets);
        const takeMarker = hm.marker !== 'release';
        const markerLegGeometry = takeMarker ? TAKE_LEG_GEOMETRY : undefined;
        if (tt) plantAny(at.pose, k.joints, tt, r2, at.st.heading, s.scale, markerLegGeometry);
        else forwardKinematics(at.pose, k.joints);
        k.clip.q.set(at.pose.q);
        const rootY = at.pose.root[1];
        // The deeper scoop for a ground ball, and for the throwing hand meeting the physics release point (which can sit
        // low and wide of the throw's own arm).
        const deep = (ball.y < GROUND_BALL_M * s.scale && hm.marker !== 'release') || hm.marker === 'release';
        const reach = bodyReach(at.pose, k.joints, ball, r2, at.st.heading, s.scale, hm.both && keeper ? 'mid' : 'R', tt, deep ? BODY_REACH_LIMITS.ground : BODY_REACH_LIMITS.normal, markerLegGeometry, takeMarker ? 0.93 : 0.86);
        if (reach.short > 0 && Math.abs(t - mt) < 9 && lastReachShort.length < 2000) lastReachShort.push({ track: track.id, t: mt, m: reach.short });
        // The trunk's bend and the hips' drop, on the pose now (before the feet are planted).
        applyBoneOffset(pose, at.pose, k.clip, TRUNK_BONES, wTrunk);
        const dropNow = (rootY - at.pose.root[1]) * wTrunk;
        pose.root[1] -= dropNow;
        scoopDrop = Math.max(scoopDrop, dropNow * s.scale);
        k.clip2.q.set(at.pose.q);
        if (handsTo(at.pose, k.joints, ball, r2, at.st.heading, s.scale, 1, hm.both, keeper)) armFixes.push({ pose: at.pose, clip: k.clip2, bones: ARM_BONES[hm.both ? 'both' : 'right'], w });
      }
    }
    const targets = s.plan.at(t, s.targets);
    if (targets && s.plan instanceof StepPlan) {
      // Footsteps: each foot locked on the turf from landing to lift, swinging between (faded in over the plan's start).
      const k = smoothstep(anchor, anchor + PLAN_FADE_IN_MS, t);
      if (k < 1) for (let f = 0; f < 2; f++) targets[f * STEP_STRIDE + 3] *= k;
      if (scoopDrop > 0) {
        const ground = ANKLE_REST_Y * s.scale;
        for (let f = 0; f < 2; f++) if (targets[f * STEP_STRIDE + 1] > ground + 0.02) targets[f * STEP_STRIDE + 1] = Math.max(ground, targets[f * STEP_STRIDE + 1] - scoopDrop);
      }
      plantFeetLocked(pose, s.joints, targets, root, st.heading, s.scale);
    } else if (targets) {
      // The planted feet fade in over the plan's first moments (no step in the pose where the plan starts).
      const k = smoothstep(anchor, anchor + PLAN_FADE_IN_MS, t);
      if (k < 1) for (let f = 0; f < 2; f++) targets[f * 4 + 3] *= k;
      // A leg just off its plant is not IK'd towards its swing: it is the clip's leg plus the planted shape's offset at
      // the lift-off, decaying (no snap of the knee); the other leg is planted as usual.
      if (scoopDrop > 0) {
        const ground = ANKLE_REST_Y * s.scale;
        for (let f = 0; f < 2; f++) if (targets[f * 4 + 1] > ground + 0.02) targets[f * 4 + 1] = Math.max(ground, targets[f * 4 + 1] - scoopDrop);
      }
      // A pack hold with both feet down in the clip, standing still: the clip's own feet (no planting over them).
      if (PLAN_OPTIONS.packHoldOwnFeet && baseContacts !== undefined && (baseContacts & 3) === 3 && !st.previous && STAND_AFTER.has(st.current.clip)) {
        const m = rootMotion(track, t);
        if (Math.hypot(m.vx, m.vz) < 0.05) {
          targets[3] = 0;
          targets[7] = 0;
        }
      }
      const releasing = [false, false];
      for (let f = 0; f < 2; f++) {
        const tl = targets[8 + f];
        releasing[f] = Number.isFinite(tl) && t >= tl && t - tl < LEG_RELEASE_S * 1000;
        if (releasing[f]) targets[f * 4 + 3] = 0;
      }
      plantFeet(pose, s.joints, targets, root, st.heading, s.scale);
      for (let f = 0; f < 2; f++) {
        if (!releasing[f]) continue;
        const tl = targets[8 + f];
        const at = fieldBasePose(track, tl, s.base2, s.scale, s.phase, sway, false, mot, s.pick);
        s.clipAt.q.set(at.pose.q);
        const tt = s.plan.at(tl, s.targets2);
        if (!tt) continue;
        const r2 = { x: at.st.pos.x + (at.st.body?.x ?? 0), y: 0, z: at.st.pos.z + (at.st.body?.z ?? 0) };
        plantFeet(at.pose, s.joints2, tt, r2, at.st.heading, s.scale);
        releaseLeg(pose, at.pose, s.clipAt, f === 0 ? 'L' : 'R', (t - tl) / 1000);
      }
      forwardKinematics(pose, s.joints);
    } else forwardKinematics(pose, s.joints);
    if (sway && !NO_LOOK.test(st.current.clip)) {
      const ball = ballWorld(t - 120);
      // Eyes go to the ball as it leaves the hand (over 0.3 s), a moment behind it.
      if (ball && p) lookAt(pose, s.joints, ball, root, st.heading, s.scale, smoothstep(p.releaseScene + 120, p.releaseScene + 420, t));
    }
    for (const f of armFixes) applyBoneOffset(pose, f.pose, f.clip, f.bones, f.w);
  };
  return hook;
}
