/**
 * Chase result moments (ASSETS-MOTION): what the striker and the bowler do AFTER the physics has decided the deciding
 * ball of a chase. Pure and deterministic: the moves are a function of the track, the ball's DeliveryResult and the
 * moment, so a replay of the deciding ball draws the same moment as the live ball.
 *
 *   won          striker `bat_celebrate_win` (the winning run), bowler `bowl_disappointed`
 *   lost_wicket  striker `bat_walk_off`, bowler `bowl_celebrate_defend`
 *   lost_balls   the same as lost_wicket (the 12th ball bowled, the target not reached)
 *
 * Honesty (MOTION-SPEC section 6, SYS1/FAIR5/CTL8): nothing here starts before the physics event that earns it (the last
 * run, the boundary, the dismissal or the dead ball, plus a reaction latency) or before the actor's own move has ended
 * (his stroke, his run's pull-up, his follow-through); nothing moves a ball, a bat, a fielder or a result. The pack is
 * `result_moments` (scripts/blender/motion/result_moments.py); when it is not loaded the built-in clips the code
 * already had for these beats stand in, never a jump.
 */
import { evaluateActor, truncateMoves, type ActorTrack, type Move } from '../core/actors';
import { clipDuration, clipMarker, hasMotionClip, motionSource, type ClipId } from '../core/clips';
import { type Vec3, angleDelta, lerpAngle, v3 } from '../core/math';
import type { DeliveryResult } from '@/contracts/practice';
import type { BallScript } from '../core/choreo';
import { simToScene } from './frame';

export type ChaseMoment = 'won' | 'lost_wicket' | 'lost_balls';

/** The pack's clip ids (MOTION-SPEC section 11). */
export const MOMENT_CLIPS = {
  strikerWon: 'bat_celebrate_win',
  strikerLost: 'bat_walk_off',
  bowlerDefended: 'bowl_celebrate_defend',
  bowlerBeaten: 'bowl_disappointed',
} as const;

/** What stands in for each clip when the pack is not loaded (built-ins the stage already had). */
const STAND_IN: Readonly<Record<(typeof MOMENT_CLIPS)[keyof typeof MOMENT_CLIPS], ClipId>> = {
  bat_celebrate_win: 'bat_raise',
  bat_walk_off: 'dejected',
  bowl_celebrate_defend: 'clap',
  bowl_disappointed: 'dejected',
};

/**
 * Reaction latencies after the deciding physics event (scene ms): a person sees it first, and a reaction never starts sooner
 * than 180 ms after the outcome (the Director's honesty rule, PRACTICE_PRESENTATION). The clips open with their own short
 * register beat (0.3 to 0.4 s), so these are the least that reads as watching it happen.
 */
export const MOMENT_LATENCY_MS = {
  won: { boundary: 200, runs: 300, bowler: 450 },
  lost_wicket: { striker: 250, bowler: 400 },
  lost_balls: { striker: 400, bowler: 600 },
} as const;

/** A moment that would start closer than this to the end of the scene is not drawn (the clip would be cut at once). */
const MIN_ROOM_MS = 600;

const lastOf = <T>(a: readonly T[]): T | undefined => a[a.length - 1];

/** The physics instant that decides the moment (simulation s): the last run, the boundary, the dismissal or the dead ball. */
export function momentEventT(result: DeliveryResult, moment: ChaseMoment): { t: number; boundary: boolean } {
  const at = (kind: DeliveryResult['events'][number]['kind']) => result.events.find((e) => e.kind === kind)?.t;
  const runs = result.events.filter((e) => e.kind === 'run').map((e) => e.t);
  const lastRun = runs.length ? Math.max(...runs) : undefined;
  if (moment === 'lost_wicket') {
    const d = result.outcome.dismissal;
    const t =
      d === 'bowled'
        ? (at('stumps') ?? result.deadT)
        : d === 'lbw'
          ? result.deadT + 0.4
          : (at('catch') ?? at('keeper_take') ?? result.deadT);
    return { t, boundary: false };
  }
  if (moment === 'won') {
    if (lastRun !== undefined) return { t: lastRun, boundary: false };
    const b = at('boundary');
    return { t: b ?? result.deadT, boundary: b !== undefined };
  }
  // lost_balls: not out; the last ball's runs (if any) are done and the ball is dead.
  return { t: Math.max(result.deadT, lastRun ?? 0), boundary: false };
}

/** Where a track's own business ends: the start of its final resting move (a trailing idle hold), else the end of its last move (scene ms). */
export function restAt(moves: readonly Move[]): number {
  const m = lastOf(moves);
  if (!m) return 0;
  return m.clip === 'bat_rest' || m.clip === 'idle' || m.clip === 'ready' ? m.t0 : m.t1;
}

/**
 * The bowler's moves without the walk back `addWalkBack` appends (an idle pause, `bowl_walk_back` or the walk cycle, an idle
 * hold), or all of them when there is none. The same moves the build had before it added the walk.
 */
export function stripWalkBack(moves: readonly Move[]): readonly Move[] {
  const i = moves.length - 1;
  const clip = (k: number) => String(moves[k]?.clip ?? '');
  if (
    i >= 2 &&
    clip(i) === 'idle' &&
    (clip(i - 1) === 'vmp:bowl_walk_back' || clip(i - 1) === 'walk') &&
    clip(i - 2) === 'idle'
  )
    return moves.slice(0, i - 2);
  return moves;
}

function clipId(name: (typeof MOMENT_CLIPS)[keyof typeof MOMENT_CLIPS]): ClipId {
  return hasMotionClip(name) ? (`vmp:${name}` as const) : STAND_IN[name];
}

/** The marker frame a Reduced Motion consumer holds in place of a clip (MOTION-SPEC section 6): the peak or the slump. */
const REDUCED_MARKER: Readonly<Record<(typeof MOMENT_CLIPS)[keyof typeof MOMENT_CLIPS], string>> = {
  bat_celebrate_win: 'peak',
  bat_walk_off: 'slump',
  bowl_celebrate_defend: 'peak',
  bowl_disappointed: 'slump',
};

/** `clipStart` and `rate` that hold a pack clip on its Reduced Motion marker frame (nothing for a stand-in). */
function held(name: (typeof MOMENT_CLIPS)[keyof typeof MOMENT_CLIPS]): { clipStart?: number; rate?: number } {
  return hasMotionClip(name) ? { clipStart: clipMarker(`vmp:${name}`, REDUCED_MARKER[name], 0), rate: 0 } : {};
}

/**
 * The track cut at `cutFrom` (default `start`), with `idle` holding the place from the end of what is kept to `start` when the
 * actor's own moves have ended sooner (he stands where he is, as he was heading), and where and how he is at `cutFrom`.
 *
 * A move that was still running at the cut is shortened, and a move that turns his heading over its own span (the rest after a run,
 * the bowler's `ready`) used to finish its turn sooner than it had on screen: a left-hander jumped up to 171 degrees in the frame a
 * live ball's moment was put in, and the clip started from a heading the kept moves never reached (a 28.6 degree root snap, the head
 * turning at 2,400 deg/s in the world; MOTION-FIX MF-03, MF-09). `keepHeading` has the cut move keep the span of the whole move
 * (Move.headingSpan), so every frame before the cut is drawn as it was; `here` is read from the KEPT moves all the same, so the
 * clip starts from what they draw.
 */
function cutAt(
  track: ActorTrack,
  start: number,
  cutFrom = start,
): { kept: Move[]; here: ReturnType<typeof evaluateActor> } {
  const kept = truncateMoves(track, cutFrom, { keepHeading: true });
  const here = evaluateActor({ ...track, moves: kept }, cutFrom);
  const end = lastOf(kept)?.t1 ?? 0;
  if (end < start - 0.5) kept.push({ t0: end, t1: start, clip: 'idle', from: here.pos, to: here.pos, blend: 300 });
  return { kept, here };
}

export interface MomentInput {
  /** The actor's track with every move it will have (runs and stroke merged), scene ms. */
  track: ActorTrack;
  result: DeliveryResult;
  releaseScene: number;
  /** The scene's duration (ms): the moment plays to the end of it and holds its last frame. */
  duration: number;
  moment: ChaseMoment;
  /**
   * The bowler's follow-through end (scene ms; the Director's `followEnd`): the end of HIS OWN business. What he does after it
   * (the physics sends him after the ball, then walks him back) is cut at the moment's start. Default: the end of his last move.
   */
  followEnd?: number | null;
  /** Reduced Motion: the clip is replaced by its marker frame (`peak` or `slump`), held over the same window (MOTION-SPEC section 6). */
  reducedMotion?: boolean;
  /**
   * Not before this scene time (ms; default 0). A replay builds the moment into the script and starts it at the physics
   * event; a live ball whose chase is decided only once the dead ball is shown (presentChaseMoment) starts it from now.
   */
  notBefore?: number;
}

export interface MomentMoves {
  /** The track's moves from its start to the end of the scene, with the moment's moves in place of what followed `start`. */
  moves: Move[];
  /** Scene ms the moment's first move starts. */
  start: number;
  /** The index in `moves` of that first move. */
  first: number;
}

/**
 * A clip-driven stretch: the clip's own ground track, placed at `origin` along `heading`, as short Hermite moves so
 * the root speed is continuous (the pattern of practice/nonStriker.ts `clipDriven`, MOTION-SPEC section 6). `mirror`
 * negates the ground's x, the canonical mirror.
 */
function groundMoves(clip: `vmp:${string}`, t0: number, origin: Vec3, heading: number, mirror: boolean): Move[] {
  const src = motionSource(clip)!;
  const g0 = src.ground!(0);
  const c = Math.cos(heading);
  const sn = Math.sin(heading);
  const at = (ct: number): Vec3 => {
    const g = src.ground!(ct);
    const x = (g.x - g0.x) * (mirror ? -1 : 1);
    const z = g.z - g0.z;
    return v3(origin.x + x * c + z * sn, 0, origin.z - x * sn + z * c);
  };
  const dur = src.duration;
  const speed = (ct: number) => {
    const lo = Math.max(0, ct - 0.004);
    const hi = Math.min(dur, ct + 0.004);
    const a = at(lo);
    const b = at(hi);
    return Math.hypot(b.x - a.x, b.z - a.z) / Math.max(1e-6, hi - lo);
  };
  const out: Move[] = [];
  const step = 1 / 30;
  // Where he stands until the clip's first step: ONE move that carries the inertial hand-over from what he was doing (a move
  // after it would end the inertia early: it only runs while its own move does), then the walk as short Hermite moves.
  const origin0 = at(0);
  let still = 0;
  while (still + step < dur && Math.hypot(at(still + step).x - origin0.x, at(still + step).z - origin0.z) < 0.002)
    still += step;
  if (still >= step)
    out.push({ t0, t1: t0 + still * 1000, clip, clipStart: 0, from: origin0, to: origin0, heading, inertial: 260 });
  for (let cc = still; cc < dur - 1e-6; cc += step) {
    const c1 = Math.min(dur, cc + step);
    out.push({
      t0: t0 + cc * 1000,
      t1: t0 + c1 * 1000,
      clip,
      clipStart: cc,
      from: at(cc),
      to: at(c1),
      speed: [speed(cc), speed(c1)],
      heading,
      ...(still < step && cc === 0 ? { inertial: 260 } : { blend: 0 }),
    });
  }
  return out;
}

/** The striker's moment: `bat_celebrate_win` (won) or `bat_walk_off` (lost), after his stroke or run is over. Null: no room. */
export function strikerMoment(o: MomentInput): MomentMoves | null {
  const { track, result, releaseScene, duration, moment } = o;
  const ev = momentEventT(result, moment);
  const eventScene = simToScene({ releaseScene }, ev.t);
  const lat =
    moment === 'won'
      ? ev.boundary
        ? MOMENT_LATENCY_MS.won.boundary
        : MOMENT_LATENCY_MS.won.runs
      : MOMENT_LATENCY_MS[moment].striker;
  // His own business ends when his final rest has settled: the rest hands over from the stroke by an inertial blend of its own
  // (300 to 800 ms). A clip that begins while that blend is still running popped (measured, MOTION-FIX MF-04; the cause is not
  // diagnosed): a leave, whose rest begins 3 ms before the clip, turned the top arm 62 degrees and the hand 168 in the frames after the
  // switch, and a bowled batter's head turned at 770 to 850 deg/s in the world; both are gone when the clip waits for the rest.
  const finalMove = lastOf(track.moves);
  const settled = finalMove?.clip === 'bat_rest' ? finalMove.t0 + (finalMove.inertial ?? 0) : 0;
  const start = Math.max(restAt(track.moves), settled, eventScene + lat, o.notBefore ?? 0);
  if (!(start < duration - MIN_ROOM_MS)) return null;
  const { kept, here } = cutAt(track, start);
  const mirror = Boolean(track.mirror);
  const first = kept.length;
  if (moment === 'won') {
    const id = clipId(MOMENT_CLIPS.strikerWon);
    kept.push({
      t0: start,
      t1: Math.max(start + 1, duration),
      clip: id,
      from: here.pos,
      to: here.pos,
      inertial: 260,
      ...(o.reducedMotion ? held(MOMENT_CLIPS.strikerWon) : {}),
    });
    return { moves: kept, start, first };
  }
  const walk = `vmp:${MOMENT_CLIPS.strikerLost}` as const;
  if (o.reducedMotion && hasMotionClip(MOMENT_CLIPS.strikerLost)) {
    // Reduced Motion: he stands where he is in the slump, no walk.
    kept.push({
      t0: start,
      t1: Math.max(start + 1, duration),
      clip: walk,
      from: here.pos,
      to: here.pos,
      inertial: 260,
      ...held(MOMENT_CLIPS.strikerLost),
    });
    return { moves: kept, start, first };
  }
  if (hasMotionClip(MOMENT_CLIPS.strikerLost) && motionSource(walk)?.ground) {
    // Straight ahead from where he stands, the way he faced in his stance (his off side): never along the pitch. His
    // heading turns to it over the standing beat (usually he is side-on already and there is nothing to turn).
    const ahead = track.heading;
    const walkMoves = groundMoves(walk, start, here.pos, ahead, mirror);
    const dh = angleDelta(here.heading, ahead);
    if (Math.abs(dh) > 1e-3) {
      const turnMs = 900;
      const h = (t: number) => {
        const u = Math.min(1, Math.max(0, (t - start) / turnMs));
        return lerpAngle(here.heading, ahead, u * u * (3 - 2 * u));
      };
      for (const m of walkMoves) {
        m.heading = h(m.t0);
        m.headingTo = h(m.t1);
        m.headingEase = 'linear';
      }
    }
    kept.push(...walkMoves);
    const end = lastOf(walkMoves)!.t1;
    if (end < duration)
      kept.push({ t0: end, t1: duration, clip: walk, clipStart: clipDuration(walk), heading: ahead, blend: 0 });
    return { moves: kept, start, first };
  }
  kept.push({
    t0: start,
    t1: Math.max(start + 1, duration),
    clip: STAND_IN[MOMENT_CLIPS.strikerLost],
    from: here.pos,
    to: here.pos,
    blend: 300,
  });
  return { moves: kept, start, first };
}

/**
 * The bowler's moment: after his follow-through is over (the Director's `followEnd`) and 400 ms or more after the event.
 *
 * His built-in wicket celebration (the physics path's `celebrate_jump`, his arms aimed) is what this moment replaces: a pack clip
 * cannot take over from an aimed arm without a pop (a 130 degree upper arm), so the track is cut where that jump would BEGIN (not
 * part-way through it), he stands idle from there, and the clip starts at the moment's start, after the follow-through. A celebration
 * that is already on screen (a live ball: it began before `notBefore`) is let finish, never cut.
 */
export function bowlerMoment(o: MomentInput): MomentMoves | null {
  const { track, result, releaseScene, duration, moment } = o;
  const ev = momentEventT(result, moment);
  const eventScene = simToScene({ releaseScene }, ev.t);
  const lat = moment === 'won' ? MOMENT_LATENCY_MS.won.bowler : MOMENT_LATENCY_MS[moment].bowler;
  // A script built without the moment already walks him back to his mark (a live ball whose chase is decided late): his own
  // business ends where that walk's pause begins, and the walk is dropped from the moment on.
  const bowlerClip = moment === 'won' ? MOMENT_CLIPS.bowlerBeaten : MOMENT_CLIPS.bowlerDefended;
  // Pack clips only: with no bowler clip (the pack missing, or his clips cut, decision D2) he walks back as ever.
  if (!hasMotionClip(bowlerClip)) return null;
  const own = stripWalkBack(track.moves);
  // His own business ends with his follow-through: `followEnd` (the Director's), else the end of the last run-up clip of his track,
  // else of his last move. The physics path may cut the run-up clip sooner (where the built-in celebration begins), but he is not
  // done until his follow-through is.
  const runEnd = Math.max(0, ...own.filter((m) => String(m.clip).startsWith('vmp:runup_')).map((m) => m.t1));
  const notBefore = o.notBefore ?? 0;
  let start = Math.max(o.followEnd ?? (runEnd > 0 ? runEnd : restAt(own)), eventScene + lat, notBefore);
  let cutFrom = start;
  const celebration = track.moves.find((m) => String(m.clip).startsWith('celebrate_') && m.t0 < start - 1);
  if (celebration) {
    if (celebration.t0 < notBefore - 1) start = Math.max(start, celebration.t1);
    else cutFrom = celebration.t0;
  }
  if (!(start < duration - MIN_ROOM_MS)) return null;
  const { kept, here } = cutAt(
    {
      ...track,
      moves: own.length === track.moves.length ? track.moves : truncateMoves(track, start, { keepHeading: true }),
    },
    start,
    cutFrom,
  );
  const first = kept.length;
  kept.push({
    t0: start,
    t1: Math.max(start + 1, duration),
    clip: `vmp:${bowlerClip}` as const,
    from: here.pos,
    to: here.pos,
    inertial: 260,
    ...(o.reducedMotion ? held(bowlerClip) : {}),
  });
  return { moves: kept, start, first };
}

/**
 * A live ball whose chase was decided after its result script was built: the striker's and the bowler's moments are put into
 * that script's tracks now, from `notBefore` (scene ms) or the physics event and the actors' own business, whichever is later.
 * Nothing before `notBefore` is touched, so the frames already drawn stay as they were. Returns whether anything was added.
 */
export function applyChaseMoment(
  script: BallScript,
  moment: ChaseMoment,
  notBefore: number,
  reducedMotion = false,
): boolean {
  const p = script.practice;
  const result = p?.result;
  if (!p || !result) return false;
  let added = false;
  const striker = script.actors.find((a) => a.id === 'striker');
  if (striker) {
    const m = strikerMoment({
      track: striker,
      result,
      releaseScene: p.releaseScene,
      duration: script.duration,
      moment,
      notBefore,
      reducedMotion,
    });
    if (m) {
      striker.moves = m.moves;
      if (striker.physicsBody)
        striker.physicsBody = { ...striker.physicsBody, releaseAt: Math.min(striker.physicsBody.releaseAt, m.start) };
      added = true;
    }
  }
  const bowler = script.actors.find((a) => a.id === 'bowler');
  if (bowler) {
    const m = bowlerMoment({
      track: bowler,
      result,
      releaseScene: p.releaseScene,
      duration: script.duration,
      moment,
      notBefore,
      reducedMotion,
      followEnd: p.director.bowler.followEnd,
    });
    if (m) {
      bowler.moves = m.moves;
      added = true;
    }
  }
  return added;
}
