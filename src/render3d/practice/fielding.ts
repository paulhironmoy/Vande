/**
 * Practice fielders: presentation-only choreography on the physics FielderPath.
 *
 * The physics decides where every fielder is at every instant (`FielderPath.samples`, linear between samples) and
 * when every fielding event happens (catch, field, throw). This module never changes either. It only chooses how the
 * body moves on that path:
 *  - the root (`Move.from`/`to`) is the path, split at every sample, so `evaluateActor(...).pos` equals the physics
 *    position at every scene time;
 *  - clips are aligned to the physics times by their markers: the hands meet the ball at the pickup, the arm releases
 *    at the throw event, the catch is taken at the catch event, the dive's hands are out at the instant the ball is
 *    reached. A clip may start before its event (anticipation: arms come up in the last strides of a run);
 *  - gaits: the cycle is chosen by ground speed (walk, jog, run; the drive cycle while a start accelerates hard) and
 *    played speed-matched (rate = v / (scale · the loop's own ground speed), clamped), so the stride timing follows
 *    the speed; the cycle phase carries across gait changes (every loop starts on the left foot strike), so a change
 *    of gait is a short phase-synced cross-fade, never a pop. Legs keep their gait under a pickup or a catch on the
 *    move;
 *  - headings: a runner faces where he is going and turns no faster than his speed allows (locomotion.ts
 *    turnRateCap); slow, he turns to where he is about to go (a plant-and-turn when the path reverses); a waiting or
 *    watching fielder turns (rate-limited) to follow the ball, a throw faces where the physics ball goes, the keeper
 *    stays square to the bowler;
 *  - the set stance: a fielder the ball is not coming to stands up out of his ready crouch once the ball has been
 *    played (or has passed the bat) and watches it; the keeper's take rises with the ball from its bounce;
 *  - after the physics path ends (the ball is dead), he walks back towards his mark (`returnTo`, or where he set);
 *  - a dive extends the drawn body from the physics position towards the ball (`Move.bodyFrom`/`bodyTo`, at most
 *    DIVE_BODY_MAX_M), so the gloves meet the ball the physics says was reached; the physics position is unchanged.
 * Pure and deterministic.
 */
import type { Fielder, FielderAction, FielderPath } from '@/contracts/practice';
import { ATHLETICS, fielderClass } from '@/physics/fielding';
import { PITCH_HALF } from '@/physics/geometry';
import type { Move } from '../core/actors';
import { type ClipId, clipDuration, clipMarker } from '../core/clips';
import { type FieldClipSet, type GaitClipDef, fieldClips, matchedRate } from '../core/fieldClips';
import { turnRateCap } from '../core/locomotion';
import { type Vec3, angleDelta, clamp, headingOf, smoothstep, v3 } from '../core/math';
import { simToScene, toWorld } from './frame';

/** Hips to fingertips in the extended dive pose (m, rig scale 1): the skeleton's spine, chest, arm and hand. */
export const DIVE_HAND_REACH_M = 1.1;
/** Largest presentation extension of a dive from the physics position (m). */
export const DIVE_BODY_MAX_M = 1.35;
/** The keeper faces the bowler (world −z). */
const KEEPER_HEADING = Math.PI;

export interface FieldingContext {
  /** The physics ball (world) at simulation time t, clamped to the record. */
  ball?: (t: number) => Vec3 | null;
  /** The physics ball's velocity (world) at t. */
  ballVelocity?: (t: number) => Vec3 | null;
  /** The wicketkeeper: crouch, shuffle, keeper dive and take. */
  keeper?: boolean;
  /** The catch is above head height (the high catch). */
  catchHigh?: boolean;
  /** Heading (radians) held before the first action. */
  heading?: number;
  /** Where the striker stands (world): faced when the ball gives no direction. */
  striker?: Vec3;
  /** A post-ball reaction on the spot from simulation time t; it waits for any run, throw or dive to finish. */
  reaction?: { t: number; clip: ClipId };
  /** Extend the last hold to this scene time (ms). */
  endScene?: number;
  /** Seconds into looping holds at the first action (deterministic per fielder, so the field does not breathe in step). */
  phase?: number;
  /** Where he walks back to once the path has ended (world; default: where the path set him). */
  returnTo?: Vec3;
  /** Simulation time the ball was played or passed the bat (default: read from the ball). */
  playT?: number;
  /** Simulation time of the delivery's bounce (default: read from the ball; none for a full toss). */
  bounceT?: number | null;
  /** The drawn rig's scale (stride length scales with it; default 1). */
  scale?: number;
}

type Face = ((t: number, at: Vec3) => number | null) | null;
interface Span {
  t0: number;
  t1: number;
  clip: ClipId;
  kind: 'hold' | 'run' | 'shot';
  /** Clip seconds at t0. */
  start: number;
  /** Clip seconds per second (a snap throw plays its wind-up faster; its release still lands on the event). */
  rate: number;
  blend: number;
  face: Face;
  /** Heading turn limit (rad/s). */
  turn: number;
  /** Presentation body extension (world metres) at t. */
  body?: (t: number) => Vec3 | null;
  /** Extra boundaries inside the span (s), for headings or a body extension that change within it. */
  step?: number;
  order: number;
}

const ONE_SHOT_AFTER = new Set<FielderAction>(['pickup', 'catch', 'drop']);
/** Actions that bring the ball to him: a fielder never relaxes out of his set stance before one of these. */
const TAKES = new Set<FielderAction>(['pickup', 'catch', 'drop', 'dive', 'throw']);
/** Below this ground speed (m/s) a "run" sample pair is a wait, drawn standing. */
const STILL_MPS = 0.3;
/** Above this ground speed (m/s) a one-shot keeps a gait's legs under it. */
const LEGS_RUN_MPS = 1.5;
/** A run's first strides are the drive cycle while he accelerates at least this hard (m/s²)... */
const DRIVE_PHASE_S = 0.55;
const DRIVE_ACCEL = 2.5;
/** ...and is already this share of the drive loop's own speed (slower, a start is drawn by speed). */
const DRIVE_MIN_SHARE = 0.5;
/** The ball within this distance (m) of a fielder is in or at his hands: he does not turn to "face" it. */
const BALL_AT_HAND_M = 1.5;
/** Fastest a throw's wind-up may play (a snap throw straight out of a late pickup): built-in, and a pack clip's. */
const SNAP_THROW_RATE = 1.8;
const PACK_THROW_WARP = 1.2;
/**
 * Every move asks for a linear heading (actors.ts `headingEase: 'linear'`): the drawn turn rate is the move's own,
 * so the turn limits below are the drawn rates. (An eased heading would peak at up to three times its mean; this
 * divisor would then keep the peak near the limit.)
 */
const HEADING_EASE_COMP = 1;
/** Hysteresis (m/s) at a gait boundary. */
const GAIT_HYST = 0.3;
/** Below this speed a runner turns to where he is about to go (s ahead): the plant-and-turn of a reversal. */
const LOOK_AHEAD_SLOW_MPS = 2.5;
const LOOK_AHEAD_S = 0.3;
/** He stands up out of the set stance this long after the ball is played or passes the bat (s), plus a per-fielder spread. */
const RELAX_AFTER_S = 0.55;
const RELAX_SPREAD_S = 0.35;
const KEEPER_RELAX_AFTER_S = 0.3;
/** The walk back after the path: unhurried, not further than needed. */
export const RETURN = { mps: 1.45, accelS: 0.6, settleS: 0.7, spreadS: 0.5, minM: 0.6, turnRate: 4 } as const;

/**
 * A fielder chased the ball when he ran at more than this share of his top speed (physics fielding.ts lets the rest of
 * the field close in at no more than 0.6 of it) and ended nearer to where the ball went by at least CHASE_GAIN_M.
 */
export const CHASE_SPEED_SHARE = 0.7;
const CHASE_GAIN_M = 2;

/**
 * Whether a physics FielderPath chased the ball to `end` (the rope crossing, in the path's own frame) by `untilT`:
 * fast running (over windows of at least 0.2 s, so the path's millimetre rounding cannot fake it) that brought him
 * nearer to it. The keeper and bowler go to their stumps, never after the ball.
 */
export function chasedBall(
  path: FielderPath,
  fielder: Fielder,
  end: { x: number; z: number },
  untilT: number,
): boolean {
  if (fielder.role === 'keeper' || fielder.role === 'bowler') return false;
  const s = path.samples;
  if (s.length < 2) return false;
  const top = ATHLETICS[fielderClass(fielder)].topSpeed;
  let peak = 0;
  for (let i = 0, j = 0; i < s.length && s[i].t <= untilT + 1e-9; i++) {
    while (j < s.length && s[j].t - s[i].t < 0.2 - 1e-9) j++;
    if (j >= s.length) break;
    peak = Math.max(peak, Math.hypot(s[j].x - s[i].x, s[j].z - s[i].z) / (s[j].t - s[i].t));
  }
  let at = s[s.length - 1];
  for (let i = 0; i + 1 < s.length; i++)
    if (s[i + 1].t >= untilT) {
      const u = s[i + 1].t > s[i].t ? Math.min(1, Math.max(0, (untilT - s[i].t) / (s[i + 1].t - s[i].t))) : 1;
      at = { ...s[i], x: s[i].x + (s[i + 1].x - s[i].x) * u, z: s[i].z + (s[i + 1].z - s[i].z) * u };
      break;
    }
  const gain = Math.hypot(s[0].x - end.x, s[0].z - end.z) - Math.hypot(at.x - end.x, at.z - end.z);
  return peak > CHASE_SPEED_SHARE * top && gain >= CHASE_GAIN_M;
}

/**
 * Stride cadence of the original run cycle (kept for callers that still use it): clip seconds per second for a run at
 * ground speed v. The choreography now plays every gait speed-matched (`gaitAt`).
 */
export function runRate(v: number, drive: boolean): number {
  return drive ? clamp(1.0 + v / 20, 1.0, 1.25) : clamp(0.9 + v / 22, 0.9, 1.3);
}

export type GaitKey = 'walk' | 'jog' | 'run' | 'sprint' | 'drive';

/** Rate clamps of each gait loop (of its own rate; MOTION-SPEC §6): outside them the next gait takes over. */
const GAIT_CLAMP: Record<GaitKey, readonly [number, number]> = {
  walk: [0.75, 1.3],
  jog: [0.75, 1.3],
  run: [0.75, 1.3],
  sprint: [0.75, 1.3],
  drive: [0.6, 1.3],
};

function gaitDef(set: FieldClipSet, k: GaitKey): GaitClipDef {
  return k === 'sprint' ? (set.sprint ?? set.run) : set[k];
}

/**
 * The gait at ground speed v (m/s) for a rig of `scale`: the loop whose own speed is nearest in ratio (boundaries at
 * the geometric means of neighbouring loops' speeds), keeping `prev` within GAIT_HYST of its boundaries.
 */
export function gaitAt(
  v: number,
  prev: GaitKey | null,
  scale = 1,
  set: FieldClipSet = fieldClips(),
): { key: GaitKey; clip: ClipId; rate: number } {
  const order: GaitKey[] = set.sprint ? ['walk', 'jog', 'run', 'sprint'] : ['walk', 'jog', 'run'];
  const sp = order.map((k) => gaitDef(set, k).speedMps * scale);
  const bounds = sp.slice(1).map((s, i) => Math.sqrt(s * sp[i]));
  const lo = (i: number) => (i === 0 ? -Infinity : bounds[i - 1]);
  const hi = (i: number) => (i === order.length - 1 ? Infinity : bounds[i]);
  let i = order.findIndex((_, k) => v < hi(k));
  if (i < 0) i = order.length - 1;
  const p = prev && prev !== 'drive' ? order.indexOf(prev) : -1;
  if (p >= 0 && v >= lo(p) - GAIT_HYST && v <= hi(p) + GAIT_HYST) i = p;
  const key = order[i];
  const def = gaitDef(set, key);
  const [a, b] = GAIT_CLAMP[key];
  return { key, clip: def.clip, rate: matchedRate(def, v, scale, a, b) };
}

/** When the ball was played or passed the bat, and when the delivery bounced (s), read from the ball (cached). */
const BALL_TIMES = new WeakMap<object, { playT: number; bounceT: number | null }>();
function ballTimes(ctx: FieldingContext): { playT: number; bounceT: number | null } {
  const key = (ctx.ballVelocity ?? ctx.ball) as object | undefined;
  const cached = key ? BALL_TIMES.get(key) : undefined;
  let found = cached;
  if (!found) {
    let playT = 0.9;
    let bounceT: number | null = null;
    const vel = ctx.ballVelocity;
    const pos = ctx.ball;
    const v0 = vel?.(0.02);
    if (vel && v0 && Math.hypot(v0.x, v0.z) > 1) {
      const h0 = Math.atan2(v0.x, v0.z);
      let prevVy = v0.y;
      for (let t = 0.03; t < 3; t += 0.01) {
        const v = vel(t);
        if (!v) break;
        if (bounceT === null && prevVy < -0.5 && v.y > 0.5) bounceT = t;
        prevVy = v.y;
        const p = pos?.(t);
        const turned =
          Math.hypot(v.x, v.z) > 0.5 && Math.abs(angleDelta(h0, Math.atan2(v.x, v.z))) > (25 * Math.PI) / 180;
        if (turned || (p && p.z >= PITCH_HALF)) {
          playT = t;
          break;
        }
      }
    }
    found = { playT, bounceT };
    if (key) BALL_TIMES.set(key, found);
  }
  return { playT: ctx.playT ?? found.playT, bounceT: ctx.bounceT !== undefined ? ctx.bounceT : found.bounceT };
}

/**
 * Moves that draw one FielderPath. Positions are the path's (world, mirrored for a left-hander); every event the
 * path carries keeps its time. See the module comment for what the body adds.
 */
export function fieldingMoves(
  path: FielderPath,
  mirror: boolean,
  releaseScene: number,
  ctx: FieldingContext = {},
): Move[] {
  const tb = { releaseScene };
  const set = fieldClips();
  const scale = ctx.scale ?? 1;
  const s = [...path.samples].sort((a, b) => a.t - b.t);
  if (s.length === 0) return [];
  const W = s.map((p) => toWorld(v3(p.x, 0, p.z), mirror));
  const T = s.map((p) => p.t);
  const tFirst = T[0];
  const tPath = T[T.length - 1];
  const tEnd = ctx.endScene !== undefined ? Math.max(tPath, (ctx.endScene - releaseScene) / 1000) : tPath;
  const phase = ctx.phase ?? 0;
  const times0 = ballTimes(ctx);

  const rootAt = (t: number): Vec3 => {
    if (t <= T[0]) return W[0];
    if (t >= tPath) return W[W.length - 1];
    let i = 0;
    while (i + 1 < T.length && T[i + 1] <= t) i++;
    const a = W[i];
    const b = W[Math.min(i + 1, W.length - 1)];
    const span = T[i + 1] - T[i];
    const u = span > 0 ? (t - T[i]) / span : 0;
    return v3(a.x + (b.x - a.x) * u, 0, a.z + (b.z - a.z) * u);
  };
  /** Ground speed (m/s) around t, over ±0.05 s. */
  const speedAt = (t: number): number => {
    const a = rootAt(t - 0.05);
    const b = rootAt(t + 0.05);
    return Math.hypot(b.x - a.x, b.z - a.z) / 0.1;
  };
  const ball = (t: number) => ctx.ball?.(t) ?? null;
  const ballEnd = ball(Number.POSITIVE_INFINITY);
  const facePoint = (p: Vec3 | null): Face =>
    p ? (_t, at) => (Math.hypot(p.x - at.x, p.z - at.z) > 0.3 ? headingOf(p.x - at.x, p.z - at.z) : null) : null;
  const faceBall: Face = (t, at) => {
    const b = ball(t);
    if (!b || Math.hypot(b.x - at.x, b.z - at.z) < BALL_AT_HAND_M) return null;
    return headingOf(b.x - at.x, b.z - at.z);
  };
  const fixed =
    (h: number): Face =>
    () =>
      h;
  /** Where a ball arriving at time t came from (world, horizontal unit), or towards the striker. */
  const incoming = (t: number, at: Vec3): Vec3 => {
    const v = ctx.ballVelocity?.(t);
    if (v && Math.hypot(v.x, v.z) > 1) {
      const n = Math.hypot(v.x, v.z);
      return v3(-v.x / n, 0, -v.z / n);
    }
    const st = ctx.striker ?? v3(0, 0, 9);
    const n = Math.hypot(st.x - at.x, st.z - at.z) || 1;
    return v3((st.x - at.x) / n, 0, (st.z - at.z) / n);
  };

  // Groups of consecutive samples with one action: [t0, t1) runs to the next group's first sample.
  const groups: Array<{ action: FielderAction; i0: number; i1: number; t0: number; t1: number }> = [];
  for (let i = 0; i < s.length;) {
    let j = i;
    while (j + 1 < s.length && s[j + 1].action === s[i].action) j++;
    groups.push({ action: s[i].action, i0: i, i1: j, t0: T[i], t1: j + 1 < s.length ? T[j + 1] : T[j] });
    i = j + 1;
  }

  const spans: Span[] = [];
  let order = 0;
  const push = (sp: Omit<Span, 'order' | 'rate'> & { rate?: number }) => {
    const rate = sp.rate ?? 1;
    // A clip aligned before the path starts begins part-way through, so its marker still lands on the physics time.
    if (sp.t0 < tFirst) {
      const cut = tFirst - sp.t0;
      sp = { ...sp, t0: tFirst, start: sp.start + cut * rate };
    }
    if (sp.t1 > sp.t0 + 1e-6) spans.push({ ...sp, rate, order: order++ });
  };
  const shot = (
    clip: ClipId,
    alignT: number,
    marker: string,
    o: Partial<Omit<Span, 'order'>> & { until?: number; lead?: number; notBefore?: number } = {},
  ) => {
    const rate = o.rate ?? 1;
    const m = clipMarker(clip, marker, 0);
    // A drawing clip with a longer lead-in (a pack clip) starts that much earlier, at negative built-in clip time, so it
    // starts at its own frame 0; never before `notBefore` (the event it reacts to).
    const lead = Math.max(m, o.lead ?? 0);
    const t0 = Math.max(alignT - lead / rate, Math.min(alignT, o.notBefore ?? -Infinity));
    const start = m - (alignT - t0) * rate;
    const t1 = Math.max(t0 + (clipDuration(clip) - start) / rate, o.until ?? 0);
    push({
      t0,
      t1,
      clip,
      kind: 'shot',
      start,
      rate,
      blend: o.blend ?? 110,
      face: o.face ?? null,
      turn: o.turn ?? 8,
      ...(o.body ? { body: o.body } : {}),
      ...(o.step ? { step: o.step } : {}),
    });
    return { t0, t1 };
  };
  /** When the ball was last gathered (s), for the throw that follows. */
  let gatheredT = -Infinity;
  const holdClip: ClipId = ctx.keeper ? set.keeper.crouch : set.ready;
  let sawRun = false;
  let lastDiveEnd = -Infinity;

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const next = groups[gi + 1];
    switch (g.action) {
      case 'set': {
        // Set for the delivery. Once the ball has been played (or has passed the bat) and is not coming to him, he
        // stands up out of the crouch and watches it; a take, a dive or a throw that follows keeps him set.
        const relaxAt =
          times0.playT + (ctx.keeper ? KEEPER_RELAX_AFTER_S : RELAX_AFTER_S + RELAX_SPREAD_S * ((phase * 0.37) % 1));
        const takeFollows = groups.slice(gi + 1).some((x) => TAKES.has(x.action) && x.t0 < relaxAt + 1.2);
        const relax = !takeFollows && (!next || !TAKES.has(next.action)) && relaxAt > g.t0 && relaxAt < g.t1 - 0.15;
        const setEnd = relax ? relaxAt : g.t1;
        push({
          t0: g.t0,
          t1: setEnd,
          clip: holdClip,
          kind: 'hold',
          start: phase,
          blend: 220,
          face: ctx.keeper ? fixed(KEEPER_HEADING) : null,
          turn: 4,
        });
        if (relax)
          push({
            t0: relaxAt,
            t1: g.t1,
            clip: set.idle,
            kind: 'hold',
            start: phase,
            blend: 420,
            face: faceBall,
            turn: 2.5,
            step: 0.2,
          });
        break;
      }
      case 'idle':
        push({
          t0: g.t0,
          t1: next ? g.t1 : tEnd,
          clip: set.idle,
          kind: 'hold',
          start: phase,
          blend: 300,
          face: faceBall,
          turn: 2.5,
          step: 0.2,
        });
        break;
      case 'run':
        sawRun = true;
        push({ t0: g.t0, t1: g.t1, clip: set.run.clip, kind: 'run', start: 0, blend: 140, face: null, turn: 9 });
        break;
      case 'celebrate': {
        // After a dive he gets up first; the physics marks the celebration, not its first frame.
        const at = Math.max(g.t0, lastDiveEnd - 0.15);
        push({
          t0: at,
          t1: Math.max(at + clipDuration(set.celebrate), next ? g.t1 : tEnd),
          clip: set.celebrate,
          kind: 'shot',
          start: 0,
          blend: 140,
          face: null,
          turn: 4,
        });
        break;
      }
      case 'throw': {
        const at = rootAt(g.t0);
        const target = facePoint(ballEnd)?.(g.t0, at) ?? null;
        // The wind-up starts once the ball is gathered: a tight window (a pickup after a fumble) gets a snap throw.
        // A pack throw's lead-in (from the gather pose) is warped at most PACK_THROW_WARP×; a window still too short
        // starts part-way in at the gather (inertialized). The release always lands on the physics release.
        const windUp = Math.max(clipMarker(set.throw.clip, set.throw.marker), set.throw.lead ?? 0);
        const cap = set.throw.lead ? PACK_THROW_WARP : SNAP_THROW_RATE;
        const rate = clamp(windUp / Math.max(windUp / cap, g.t0 - gatheredT - 0.05), 1, cap);
        shot(set.throw.clip, g.t0, set.throw.marker, {
          face: target === null ? null : fixed(target),
          turn: 9,
          blend: 120,
          rate,
          lead: set.throw.lead,
          ...(set.throw.lead ? { notBefore: gatheredT + 0.05 } : {}),
        });
        break;
      }
      case 'pickup': {
        // A clean gather: the hand meets the ball at the event. After a drop: the ball is in hand at the next action.
        const collectT = g.t0;
        gatheredT = collectT;
        const turnTo = (() => {
          const at = rootAt(collectT);
          return facePoint(ballEnd)?.(collectT, at) ?? null;
        })();
        const face: Face = turnTo === null ? null : (t) => (t >= collectT ? turnTo : null);
        shot(set.pickup.clip, collectT, set.pickup.marker, {
          face,
          turn: 6,
          until: next ? next.t0 : tEnd,
          lead: set.pickup.lead,
        });
        break;
      }
      case 'catch': {
        gatheredT = g.t0;
        if (ctx.keeper && !sawRun) {
          // The keeper rises with the ball from its bounce: the take's lead-in is stretched back to the bounce (at most
          // to 0.45 of its pace), the gloves still meet the ball at the physics take, and the rest runs at its own pace.
          const take = set.keeper.take;
          const m = clipMarker(take.clip, take.marker, 0.3);
          const until = next ? next.t0 : tEnd;
          const bounce = times0.bounceT;
          const lead = bounce !== null && bounce < g.t0 - m ? Math.min(g.t0 - bounce, m / 0.45) : m;
          if (lead > m + 1e-6) {
            push({
              t0: g.t0 - lead,
              t1: g.t0,
              clip: take.clip,
              kind: 'shot',
              start: 0,
              rate: m / lead,
              blend: 160,
              face: fixed(KEEPER_HEADING),
              turn: 8,
            });
            push({
              t0: g.t0,
              t1: Math.max(g.t0 + clipDuration(take.clip) - m, until),
              clip: take.clip,
              kind: 'shot',
              start: m,
              blend: 0,
              face: fixed(KEEPER_HEADING),
              turn: 8,
            });
          } else shot(take.clip, g.t0, take.marker, { face: fixed(KEEPER_HEADING), until, blend: 280 }); // no rise: the crouch fades into the take over its lead-in
        } else {
          const c = ctx.catchHigh || (ball(g.t0)?.y ?? 0) > 1.9 ? set.catchHigh : set.catchChest;
          const inc = incoming(g.t0, rootAt(g.t0));
          // Honest: the catch never begins before the ball is played (a close catcher has less than its lead-in): it
          // starts part-way, at the hit, with the hands still meeting the ball at the physics catch.
          shot(c.clip, g.t0, c.marker, {
            face: fixed(headingOf(inc.x, inc.z)),
            turn: 7,
            until: next ? next.t0 : tEnd,
            lead: c.lead,
            notBefore: times0.playT,
          });
        }
        break;
      }
      case 'drop': {
        const y = ball(g.t0)?.y ?? 0;
        const until = next ? next.t0 : tEnd;
        if (y < 0.45) shot(set.fumble.clip, g.t0, set.fumble.marker, { until });
        else {
          const inc = incoming(g.t0, rootAt(g.t0));
          const c = y > 1.9 ? set.catchHigh : set.catchChest;
          shot(c.clip, g.t0, c.marker, { face: fixed(headingOf(inc.x, inc.z)), turn: 7 });
          push({
            t0: g.t0 + 0.12,
            t1: Math.max(g.t0 + 0.12 + clipDuration(set.spill), until),
            clip: set.spill,
            kind: 'shot',
            start: 0,
            blend: 90,
            face: null,
            turn: 4,
          });
        }
        break;
      }
      case 'dive': {
        // The action the dive ends in (gather, catch or drop) happens at the next sample: the hands are out then.
        const ends = next && ONE_SHOT_AFTER.has(next.action) ? next : null;
        const reachT = ends ? ends.t0 : g.t1;
        if (ends && ends.action !== 'drop') gatheredT = reachT;
        const p = rootAt(reachT);
        const b = ball(reachT);
        let dx = b ? b.x - p.x : 0;
        let dz = b ? b.z - p.z : 0;
        let r = Math.hypot(dx, dz);
        if (r < 0.05) {
          const p0 = rootAt(g.t0);
          dx = p.x - p0.x;
          dz = p.z - p0.z;
          r = 0;
        }
        const n = Math.hypot(dx, dz) || 1;
        const d = v3(dx / n, 0, dz / n);
        const keeperStyle = Boolean(ctx.keeper) && !sawRun;
        let side: 'r' | 'l';
        let heading: number;
        if (keeperStyle) {
          heading = KEEPER_HEADING;
          // Facing −z the keeper's right is +x.
          side = d.x >= 0 ? 'r' : 'l';
        } else {
          // Dive square to the ball's line: the side whose facing looks most into the incoming ball.
          const inc = incoming(reachT, p);
          const hr = Math.atan2(d.z, -d.x);
          const hl = Math.atan2(-d.z, d.x);
          const fr = Math.sin(hr) * inc.x + Math.cos(hr) * inc.z;
          const fl = Math.sin(hl) * inc.x + Math.cos(hl) * inc.z;
          side = fr >= fl ? 'r' : 'l';
          heading = side === 'r' ? hr : hl;
        }
        const dv = keeperStyle ? set.keeper.diveR : set.diveR;
        const clip: ClipId = side === 'r' ? dv.clip : dv.mirror;
        const m = clipMarker(clip, dv.marker, 0.2);
        const dur = clipDuration(clip);
        // The clip's launch (take-off to the reach) is timed to the physics dive, slower for a long dive and quicker
        // for a short one, so it starts at the physics take-off (never during the run) and the hands are out at the
        // reach; the rest of the clip runs at its own pace from the reach.
        const lead = Math.max(1e-3, reachT - g.t0);
        const t0 = reachT - lead;
        const clipEnd = reachT + dur - m;
        const ext = b ? clamp(r - DIVE_HAND_REACH_M, -0.5, DIVE_BODY_MAX_M) : 0;
        // Out to the ball by the reach, held through the landing, back over the get-up.
        const body = (t: number): Vec3 | null => {
          if (ext === 0) return null;
          const k = smoothstep(t0, reachT, t) * (1 - smoothstep(reachT + dur * 0.62 - m, clipEnd, t));
          return k > 0 ? v3(d.x * ext * k, 0, d.z * ext * k) : null;
        };
        const until = ends ? (groups[gi + 2]?.t0 ?? tEnd) : g.t1;
        if (Math.abs(lead - m) > 1e-6) {
          push({
            t0,
            t1: reachT,
            clip,
            kind: 'shot',
            start: 0,
            rate: m / lead,
            blend: 70,
            face: fixed(heading),
            turn: 14,
            body,
            step: 0.05,
          });
          push({
            t0: reachT,
            t1: Math.max(clipEnd, until),
            clip,
            kind: 'shot',
            start: m,
            blend: 70,
            face: fixed(heading),
            turn: 14,
            body,
            step: 0.05,
          });
        } else shot(clip, reachT, dv.marker, { face: fixed(heading), turn: 14, blend: 70, body, step: 0.05, until });
        lastDiveEnd = clipEnd;
        if (ends) {
          if (ends.action === 'drop') {
            // Up from the dive, then the scramble for the loose ball (the fumble's lunge) until the pickup.
            const pick = groups[gi + 2];
            if (pick && pick.t0 > lastDiveEnd)
              push({
                t0: lastDiveEnd - 0.05,
                t1: pick.t0,
                clip: set.fumble.clip,
                kind: 'shot',
                start: clipMarker(set.fumble.clip, set.fumble.marker) + 0.3,
                blend: 160,
                face: null,
                turn: 4,
              });
          }
          gi++;
        }
        break;
      }
    }
  }
  let reactionEnd = -Infinity;
  if (ctx.reaction) {
    // On the spot, once nothing else is happening: never over a run, a throw, a dive or a pickup.
    const busy = spans
      .filter((sp) => sp.kind !== 'hold')
      .reduce(
        (e, sp) => Math.max(e, sp.kind === 'run' ? sp.t1 : Math.min(sp.t1, sp.t0 + clipDuration(sp.clip))),
        -Infinity,
      );
    const at = Math.max(ctx.reaction.t, busy + 0.1);
    if (at < tEnd) {
      push({
        t0: at,
        t1: tEnd,
        clip: ctx.reaction.clip,
        kind: 'shot',
        start: 0,
        blend: 260,
        face: faceBall,
        turn: 3,
        step: 0.2,
      });
      reactionEnd = at + Math.max(clipDuration(ctx.reaction.clip), 1.8);
    }
  }

  // The walk back once the path is over (the ball dead): after anything still playing, if there is time to walk.
  const home = ctx.returnTo ?? W[0];
  const last = W[W.length - 1];
  const homeM = Math.hypot(home.x - last.x, home.z - last.z);
  let tMain = tEnd;
  if (ctx.endScene !== undefined && homeM > RETURN.minM) {
    const busy = spans
      .filter((sp) => sp.kind === 'shot' && sp.clip !== ctx.reaction?.clip)
      .reduce((e, sp) => Math.max(e, Math.min(sp.t1, sp.t0 + clipDuration(sp.clip) / sp.rate)), -Infinity);
    const start = Math.max(tPath + RETURN.settleS + RETURN.spreadS * ((phase * 0.61) % 1), busy + 0.25, reactionEnd);
    if (start + 1.5 < tEnd) tMain = start;
  }
  if (tMain < tEnd) for (const sp of spans) if (sp.t1 > tMain) sp.t1 = Math.max(sp.t0, tMain);

  const pick = (t: number): Span | null => {
    let shotS: Span | null = null;
    let loopS: Span | null = null;
    for (const sp of spans) {
      if (sp.t0 > t + 1e-9 || t >= sp.t1 - 1e-9) continue;
      if (sp.kind === 'shot') {
        // Among one-shots the later physics event wins once its clip has begun (a throw over the pickup before it).
        if (!shotS || sp.order > shotS.order) shotS = sp;
      } else if (!loopS || sp.t0 > loopS.t0 || (sp.t0 === loopS.t0 && sp.order > loopS.order)) loopS = sp;
    }
    if (!shotS) return loopS;
    if (!loopS || shotS.t0 >= loopS.t0) return shotS;
    // A run that began after the one-shot interrupts it; a hold waits for it to finish.
    return loopS.kind === 'run' ? loopS : shotS;
  };

  // Interval boundaries: every sample, every span edge, and the steps inside spans that turn or extend.
  const cuts = new Set<number>(T.filter((t) => t <= tMain));
  cuts.add(tMain);
  for (const sp of spans) {
    const a = clamp(sp.t0, tFirst, tMain);
    const b = clamp(sp.t1, tFirst, tMain);
    cuts.add(a);
    cuts.add(b);
    // Never a step inside the span's opening cross-fade: a move that changes clip must outlast its blend.
    if (sp.step) for (let t = a + Math.max(sp.step, sp.blend / 1000); t < b - 1e-6; t += sp.step) cuts.add(t);
  }
  const times = [...cuts].sort((a, b) => a - b).filter((t, i, arr) => i === 0 || t - arr[i - 1] > 0.0015);

  // The run group a time falls in (for a run's age).
  const runStart = (t: number): number | null => {
    const g = groups.find((x) => x.action === 'run' && x.t0 <= t && t < x.t1 + 1e-9);
    return g ? g.t0 : null;
  };

  const moves: Move[] = [];
  let heading = ctx.heading ?? (ctx.keeper ? KEEPER_HEADING : 0);
  /** Gait cycle phase (cycles; every loop starts on its left foot strike, so phases carry across loops). */
  let cycle = 0;
  let gaitPrev: GaitKey | null = null;
  let prevKey = '';
  let prevEndTime = NaN;
  /** The cross-fade the last move asked for (before it was limited to the move's length). */
  let lastBlend = 0;
  const gaitFor = (a: number, b: number, v: number) => {
    const rs = runStart(a);
    const accel = (speedAt(b + 0.05) - speedAt(a - 0.05)) / Math.max(0.05, b - a + 0.1);
    const drive = set.drive.speedMps * scale;
    if (
      rs !== null &&
      v >= DRIVE_MIN_SHARE * drive &&
      v <= 1.05 * drive &&
      (a - rs < DRIVE_PHASE_S || accel > DRIVE_ACCEL) &&
      accel > 0.5
    ) {
      return {
        key: 'drive' as GaitKey,
        clip: set.drive.clip,
        rate: matchedRate(set.drive, v, scale, GAIT_CLAMP.drive[0], GAIT_CLAMP.drive[1]),
      };
    }
    return gaitAt(v, gaitPrev, scale, set);
  };
  const advance = (clip: ClipId, rate: number, dt: number): number => {
    const d = clipDuration(clip);
    const start = (((cycle % 1) + 1) % 1) * d;
    cycle += (dt * rate) / d;
    return start;
  };
  for (let k = 0; k + 1 < times.length; k++) {
    const a = times[k];
    const b = times[k + 1];
    const sp = pick((a + b) / 2);
    if (!sp) continue;
    const from = rootAt(a);
    const to = rootAt(b);
    const dt = b - a;
    const moved = Math.hypot(to.x - from.x, to.z - from.z);
    const v = moved / dt;
    let clip: ClipId = sp.clip;
    let clipStart = sp.start + (a - sp.t0) * sp.rate;
    let rate = sp.rate;
    let lower: ClipId | undefined;
    let lowerStart: number | undefined;
    let lowerRate: number | undefined;
    let face: Face = sp.face;
    let turn = sp.turn;
    let blend = sp.blend;
    /** Where a mover is heading (turns to where he is about to go when slow: the plant-and-turn of a reversal). */
    const travel: Face = () => {
      if (v < LOOK_AHEAD_SLOW_MPS) {
        const ahead = rootAt(Math.min(tPath, b + LOOK_AHEAD_S));
        if (Math.hypot(ahead.x - from.x, ahead.z - from.z) > 0.12) return headingOf(ahead.x - from.x, ahead.z - from.z);
      }
      return moved > 0.02 ? headingOf(to.x - from.x, to.z - from.z) : null;
    };

    if (sp.kind === 'run' || (sp.kind === 'hold' && v > STILL_MPS)) {
      if (v <= STILL_MPS) {
        // Arrived and waiting (for the ball, a throw or the rope): standing ready, watching the ball.
        clip = holdClip;
        clipStart = phase + a;
        face = faceBall;
        turn = 4;
        blend = 200;
        gaitPrev = null;
      } else if (ctx.keeper && !sawRun && sp.kind === 'hold') {
        // The keeper's step across to the line: a crouched shuffle, square to the bowler.
        clip = set.keeper.shuffle.clip;
        rate = clamp(v / 2.2, 0.8, 1.6);
        clipStart = advance(clip, rate, dt);
        face = fixed(KEEPER_HEADING);
      } else {
        const gait = gaitFor(a, b, v);
        if (gaitPrev !== null && gait.key !== gaitPrev) blend = 180;
        gaitPrev = gait.key;
        clip = gait.clip;
        rate = gait.rate;
        clipStart = advance(clip, rate, dt);
        face = travel;
        turn = turnRateCap(v);
      }
    } else if (sp.kind === 'shot' && v > LEGS_RUN_MPS && !/dive/.test(sp.clip)) {
      // Taken on the move: the arms do the pickup or the catch while the legs keep their gait.
      const gait = gaitAt(v, gaitPrev, scale, set);
      gaitPrev = gait.key;
      lower = gait.clip;
      lowerRate = gait.rate;
      lowerStart = advance(gait.clip, gait.rate, dt);
      if (!face) face = travel;
    } else if (sp.kind === 'shot' && ctx.keeper && !sawRun && v > STILL_MPS && !/dive/.test(sp.clip)) {
      // The keeper still moving across as his take begins: the shuffle's legs under the gloves.
      lower = set.keeper.shuffle.clip;
      lowerRate = clamp(v / 2.2, 0.8, 1.6);
      lowerStart = advance(lower, lowerRate, dt);
    } else gaitPrev = null;

    // Continuous clip time (same clip, no jump) needs no crossfade.
    const key = `${clip}|${lower ?? ''}`;
    const loopClip =
      clip === set.keeper.shuffle.clip ||
      [set.walk, set.jog, set.run, set.drive, set.sprint].some((g) => g?.clip === clip);
    const continuous = key === prevKey && (loopClip || Math.abs(clipStart - prevEndTime) < 1e-6);
    if (continuous) blend = 0;
    prevKey = key;
    prevEndTime = clipStart + dt * rate;

    const h0 = heading;
    const want = face?.(b, to) ?? null;
    // A dive's turn is part of its launch (explosive); every other turn is limited to a body's mean rate.
    const lim = (/dive/.test(clip) ? turn : turn / HEADING_EASE_COMP) * dt;
    if (want !== null) heading = h0 + clamp(angleDelta(h0, want), -lim, lim);
    const bodyFrom = sp.body?.(a) ?? null;
    const bodyTo = sp.body?.(b) ?? null;
    const t0 = simToScene(tb, a);
    // Standing still in the same clip carried on: the interval joins the move before it (exact, the position is
    // constant), so a cross-fade into a hold gets its whole length (a fade longer than its move would be cut off by the
    // next move, StageScene blending from the move just before: the pose would jump).
    const last = moves[moves.length - 1];
    if (
      continuous &&
      last &&
      moved < 1e-9 &&
      !bodyFrom &&
      !bodyTo &&
      !last.bodyFrom &&
      last.to &&
      Math.hypot(last.to.x - last.from!.x, last.to.z - last.from!.z) < 1e-9 &&
      Math.abs(last.to.x - from.x) + Math.abs(last.to.z - from.z) < 1e-12 &&
      (last.rate ?? 1) === rate
    ) {
      last.t1 = Math.max(last.t0 + 1, simToScene(tb, b));
      last.headingTo = heading;
      last.blend = Math.min(lastBlend, Math.floor(last.t1 - last.t0));
      continue;
    }
    // Every cross-fade completes inside its own move.
    lastBlend = blend;
    blend = Math.min(blend, Math.floor(dt * 1000));
    moves.push({
      t0,
      t1: Math.max(t0 + 1, simToScene(tb, b)),
      clip,
      from,
      to,
      ...(rate !== 1 ? { rate } : {}),
      clipStart,
      blend,
      heading: h0,
      headingTo: heading,
      headingEase: 'linear',
      ...(lower ? { lower, lowerStart, lowerRate } : {}),
      ...(bodyFrom || bodyTo ? { bodyFrom: bodyFrom ?? v3(0, 0, 0), bodyTo: bodyTo ?? v3(0, 0, 0) } : {}),
    });
  }

  if (tMain < tEnd)
    moves.push(
      ...returnMoves({
        tb,
        from: last,
        home,
        t0: tMain,
        tEnd,
        heading,
        endHeading: ctx.heading ?? null,
        phase,
        scale,
        set,
      }),
    );
  return moves;
}

/**
 * The walk back after the play (presentation only: the path is over and the ball dead): turn towards the mark, walk
 * there at an unhurried pace (speed-matched walk, accelerating and slowing over RETURN.accelS), turn to face the
 * striker and stand. Moves every 0.1 s, headings continuous from `heading`.
 */
function returnMoves(o: {
  tb: { releaseScene: number };
  from: Vec3;
  home: Vec3;
  t0: number;
  tEnd: number;
  heading: number;
  endHeading: number | null;
  phase: number;
  scale: number;
  set: FieldClipSet;
}): Move[] {
  const { tb, from, home, set } = o;
  const out: Move[] = [];
  const dx = home.x - from.x;
  const dz = home.z - from.z;
  const D = Math.hypot(dx, dz);
  const dir = headingOf(dx, dz);
  let heading = o.heading;
  let t = o.t0;
  const add = (
    t1: number,
    clip: ClipId,
    a: Vec3,
    b: Vec3,
    want: number | null,
    rate: number,
    clipStart: number,
    turn: number,
    blend: number,
  ) => {
    const h0 = heading;
    const lim = (turn / HEADING_EASE_COMP) * (t1 - t);
    if (want !== null) heading = h0 + clamp(angleDelta(h0, want), -lim, lim);
    const s0 = simToScene(tb, t);
    // Every cross-fade completes inside its own move (see fieldingMoves).
    out.push({
      t0: s0,
      t1: Math.max(s0 + 1, simToScene(tb, t1)),
      clip,
      from: a,
      to: b,
      ...(rate !== 1 ? { rate } : {}),
      clipStart,
      blend: Math.min(blend, Math.floor((t1 - t) * 1000)),
      heading: h0,
      headingTo: heading,
      headingEase: 'linear',
    });
    t = t1;
  };
  // Turn towards the mark on the spot first when it is behind him (a plant-and-turn), otherwise turn while walking.
  const turnFirst = Math.abs(angleDelta(heading, dir));
  if (turnFirst > 1.2) {
    // One eased turn on the spot, then he sets off (the last 0.6 rad turn into the walk).
    const tt = Math.min(o.tEnd, t + Math.max(0.3, ((turnFirst - 0.6) * HEADING_EASE_COMP) / RETURN.turnRate));
    const want = heading + Math.sign(angleDelta(heading, dir)) * (turnFirst - 0.6);
    add(tt, set.idle, from, from, want, 1, o.phase + t, RETURN.turnRate, 260);
  }
  // Trapezoid speed profile over D.
  const V = RETURN.mps;
  const ta = Math.min(RETURN.accelS, Math.sqrt((D * RETURN.accelS) / V));
  const vp = (V * ta) / RETURN.accelS;
  const cruise = Math.max(0, (D - vp * ta) / vp);
  const total = 2 * ta + cruise;
  const sAt = (q: number): number => {
    if (q <= 0) return 0;
    if (q < ta) return (0.5 * vp * q * q) / ta;
    if (q < ta + cruise) return 0.5 * vp * ta + vp * (q - ta);
    const r = Math.min(ta, q - ta - cruise);
    return 0.5 * vp * ta + vp * cruise + vp * r - (0.5 * vp * r * r) / ta;
  };
  const w0 = t;
  let cycle = 0;
  let first = true;
  while (t < Math.min(o.tEnd, w0 + total) - 1e-6) {
    const t1 = Math.min(o.tEnd, w0 + total, t + 0.1);
    const s0 = Math.min(D, sAt(t - w0));
    const s1 = Math.min(D, sAt(t1 - w0));
    const a = v3(from.x + (dx / (D || 1)) * s0, 0, from.z + (dz / (D || 1)) * s0);
    const b = v3(from.x + (dx / (D || 1)) * s1, 0, from.z + (dz / (D || 1)) * s1);
    const v = (s1 - s0) / (t1 - t);
    if (v <= STILL_MPS) {
      add(t1, set.idle, a, b, dir, 1, o.phase + t, RETURN.turnRate, first ? 260 : 120);
      first = false;
      continue;
    }
    const rate = matchedRate(set.walk, v, o.scale, GAIT_CLAMP.walk[0], GAIT_CLAMP.walk[1]);
    const d = clipDuration(set.walk.clip);
    const start = (((cycle % 1) + 1) % 1) * d;
    cycle += ((t1 - t) * rate) / d;
    const prev = out[out.length - 1];
    add(t1, set.walk.clip, a, b, dir, rate, start, turnRateCap(v), prev && prev.clip === set.walk.clip ? 0 : 220);
    first = false;
  }
  // Arrived: face the striker and stand.
  const at =
    t >= w0 + total - 1e-6
      ? home
      : v3(from.x + (dx / (D || 1)) * sAt(t - w0), 0, from.z + (dz / (D || 1)) * sAt(t - w0));
  let n = 0;
  while (t < o.tEnd - 1e-6 && n < 400) {
    const t1 = Math.min(o.tEnd, t + (n === 0 ? 0.45 : n < 8 ? 0.2 : 1));
    add(t1, set.idle, at, at, o.endHeading, 1, o.phase + t, 2.5, n === 0 ? 300 : 0);
    n++;
  }
  return out;
}
