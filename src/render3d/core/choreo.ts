/**
 * Ball choreography: turns one engine outcome (or one live delivery) into a deterministic script of actor moves,
 * ball segments, stump hits, sound/haptic events, crowd envelope, overlay graphics and slow motion.
 * The 3D renderer and the 2D fallback both play these scripts. Times are scene milliseconds from the start of the
 * ball (bowler at the top of the mark).
 */
import type {
  BallOutcome,
  BatterAnim,
  BowlerAction,
  CameraCue,
  Contact,
  DeliveryFamily,
  FieldSetting,
  FieldZone,
  PitchId,
  RevealedDelivery,
  ShotType,
  TimingGrade,
  WicketKind,
} from '@/contracts';
import { type ActorTrack, type Look, type Move, evaluateActor } from './actors';
import { type ClipId, clipDuration, clipMarker } from './clips';
import {
  BALL_R,
  BOUNDARY_R,
  CONTACT_Z,
  NON_STRIKER_POS,
  PITCH_HALF,
  POPPING,
  RELEASE,
  SQUARE_UMPIRE_POS,
  STRIKER_POS,
  UMPIRE_POS,
  ZONE_BEARING,
  type FielderSpot,
  distanceToBoundary,
  fieldSpots,
  keeperPos,
  runUpLength,
} from './ground';
import { type Vec3, DEG, add, clamp, dist2D, headingOf, lerp, lerpV, seededStream, sub, v3 } from './math';
import { type AimPathOptions, type AimedPath, type BallPathSim, type DeliveryFlight, STUMPS_FRONT_Z, aimPath, buildFlight, familyOf, flyFrom } from './trajectory';
import type { BallSample as PhysicsBallSample, PitchCondition } from '@/contracts/practice';
import type { AimMode } from '@/physics/aim';
import { CONDITIONS_FOR_PITCH } from '@/physics/matchPath';
import type { PracticeInfo } from '../practice/script';
import { ballAt } from '../practice/frame';

// ---------------------------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------------------------

export type BallSeg =
  | { k: 'hand'; t0: number; t1: number; actor: string }
  | { k: 'gone'; t0: number; t1: number }
  /**
   * The ball on a physics path (src/physics): `release` is the scene time of the simulation's t = 0; positions are in
   * the striker's own frame, mirrored back for a left-hander (Practice). The ball holds the last sample until the next
   * segment (at rest, at the rope, in the hands). Spin is the seam's rotation (radians per scene ms).
   */
  | { k: 'path'; t0: number; t1: number; samples: readonly PhysicsBallSample[]; release: number; mirror: boolean; spinAxis?: Vec3; spinRate?: number };

export type SceneEventKind =
  | 'release'
  | 'bounce'
  | 'bat'
  | 'edge'
  | 'pad'
  | 'stumps'
  | 'bails'
  | 'catch'
  | 'gloves'
  | 'fielded'
  | 'throw'
  | 'boundary'
  | 'six'
  | 'appeal'
  | 'signal'
  | 'seal'
  | 'fireworks'
  /** The held breath before a result: the crowd hushes and the sound builds (audio only). */
  | 'tension'
  /** The result lands (audio only). */
  | 'result';

export interface SceneEvent {
  t: number;
  kind: SceneEventKind;
  intensity: number;
  at?: Vec3;
}

export interface StumpHit {
  t: number;
  dir: Vec3;
  strength: number;
}

export type OverlayKind = 'speed' | 'dot' | 'runs' | 'four' | 'six' | 'wicket' | 'sealed' | 'super_ball';
export interface OverlayItem {
  t: number;
  kind: OverlayKind;
  value?: number;
  wicket?: WicketKind;
}

export interface KeyTimes {
  runStart: number;
  release: number;
  bounce: number;
  contact: number;
  /** Decisive moment (stumps hit, catch, ball crosses the rope or lands, or contact). */
  decisive: number;
  /** When the ball heads off the square (shot direction known). */
  shotEnd: number;
  celebrate: number | null;
  end: number;
}

export interface BallScript {
  kind: 'ball' | 'live' | 'ambient';
  duration: number;
  family: DeliveryFamily;
  bowlerAction: BowlerAction;
  ball: BallSeg[];
  actors: ActorTrack[];
  stumps: { striker: StumpHit | null; nonStriker: StumpHit | null };
  events: SceneEvent[];
  overlay: OverlayItem[];
  crowd: Array<[number, number]>;
  slowMo: { t0: number; t1: number; rate: number } | null;
  cameras: CameraCue[] | null;
  times: KeyTimes;
  /** Fate summary for the cameras and fx. */
  fate: BallOutcome['cues']['fate'] | { kind: 'live' } | { kind: 'ambient' };
  celebration: BallOutcome['cues']['celebration'];
  /** Actor ids that celebrate (camera focus). */
  heroes: string[];
  /** Ball travel direction after the shot, for cameras (bearing, deg). */
  shotBearing: number | null;
  sealAt: number | null;
  /** Pins the default camera (live batting idles in the batter's view). */
  camera?: 'batting_pov' | null;
  /** Ambient result scenes: the held breath before the result (scene ms; the result shows from here). */
  beat?: number;
  /** Practice deliveries: the physics data the first-person camera, the bat and the overlays are drawn from. */
  practice?: PracticeInfo;
}

export interface Cast {
  bowler: Look;
  striker: Look;
  nonStriker: Look;
  keeper: Look;
  fielders: Look[];
  umpires: [Look, Look];
}

// ---------------------------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------------------------

const PRE_MS = 450;
const RUN_SPEED: Record<BowlerAction, number> = { pace_long: 6.9, pace_short: 6.3, swing_side_on: 6.5, spin_off: 3.4, spin_leg: 3.7 };
const DELIVERY_CLIP: Record<BowlerAction, ClipId> = {
  pace_long: 'bowl_pace_long',
  pace_short: 'bowl_pace_short',
  swing_side_on: 'bowl_side_on',
  spin_off: 'bowl_off_spin',
  spin_leg: 'bowl_leg_spin',
};
const STRIDE: Record<BowlerAction, number> = { pace_long: 3.3, pace_short: 2.8, swing_side_on: 3.1, spin_off: 1.5, spin_leg: 1.7 };
const FOLLOW: Record<BowlerAction, number> = { pace_long: 7, pace_short: 6, swing_side_on: 6.5, spin_off: 2.4, spin_leg: 3 };
const SPRINT = 7.4;
const RUN_BETWEEN_MS = 2250;
const CREASE_Z = PITCH_HALF - POPPING;
const HALF_PI = Math.PI / 2;

// Launches the outcome-first flights are aimed with (aimShot solves the speed; these pick the trajectory).
/** A ball fielded on the run: its speed reaching the fielder (km/h). */
const FIELD_ARRIVE_KPH = { stop: 30, dive: 50, chase: 10 } as const;
/** A four along the ground, and one lofted that lands short of the rope (deg). */
const FOUR_ELEVATION_DEG = { along: 3, aerial: 22 } as const;
/** A six into the stands: the launch angles tried, in order, and the fastest it may leave the bat. */
const SIX_ELEVATIONS_DEG = [34, 40, 28, 46] as const;
const SIX_MAX_KPH = 200;
/** A skier hangs (range, deg); an edge carries flat and fast to the keeper or the slips. */
const SKIER_ELEVATION_DEG = [50, 62] as const;
const EDGE_ELEVATION_DEG = 4;
const CATCH_MAX_KPH = 170;
/** Played on: off the inside edge, down onto the stumps. */
const PLAYED_ON_ELEVATION_DEG = -8;
/** The catcher tosses the ball up in celebration (without spin: back-spin on a near-vertical launch would carry it off). */
const TOSS_ELEVATION_DEG = 86;
/** Live, sealed: only the first moments of the shot, launched off the bat (deg; m/s; rev/s back-spin). */
const LIVE_ELEVATION_DEG = { loft: 26, pad: 10, other: 6 } as const;
const LIVE_SPEED = { middle: 22, pad: 3, edge: 12 } as const;
const LIVE_BACKSPIN_RPS = 10;
/** Fielders throw flat, a little higher the longer the throw; a direct hit flatter still. */
const throwElevation = (d: number) => clamp(5 + 0.28 * d, 6, 22);
const directHitElevation = (d: number) => clamp(3 + 0.2 * d, 4, 12);

const TIMING_OFFSET: Record<TimingGrade, number> = {
  perfect: 0,
  good: -25,
  early: -95,
  late: 85,
  very_early: -190,
  very_late: 170,
  no_shot: 0,
  interrupted: 0,
};

const SHOT_CLIP: Record<BatterAnim, ClipId> = {
  block: 'bat_block',
  push: 'bat_push',
  drive: 'bat_drive',
  cut: 'bat_cut',
  pull: 'bat_pull',
  sweep: 'bat_sweep',
  loft: 'bat_loft',
  leave: 'bat_leave',
  miss: 'bat_drive',
  edge: 'bat_push',
};

const FOOT_CLIP: Record<BallOutcome['cues']['footwork'], ClipId> = {
  forward: 'foot_forward',
  back: 'foot_back',
  across: 'foot_across',
  charge: 'foot_charge',
  still: 'foot_still',
};

/** Same mapping as the engine's cues (bowlerActionFor), so live balls look like their replays. */
export function actionForFamily(family: DeliveryFamily, variant?: string, intensity?: number): BowlerAction {
  if (family === 'spin') return variant === 'legspin' ? 'spin_leg' : 'spin_off';
  if (family === 'swing') return 'swing_side_on';
  if (variant === 'slower') return 'pace_short';
  return intensity === 1 ? 'pace_short' : 'pace_long';
}

/** Shot animation and footwork for a live shot (no outcome yet). */
export function liveShotAnim(shot: ShotType, contact: Contact, zone: FieldZone | null, length: string): { anim: BatterAnim; footwork: BallOutcome['cues']['footwork'] } {
  const legSide = zone ? ZONE_BEARING[zone] < 0 : false;
  let anim: BatterAnim;
  let footwork: BallOutcome['cues']['footwork'];
  switch (shot) {
    case 'defend':
      anim = 'block';
      footwork = length === 'short' ? 'back' : 'forward';
      break;
    case 'rotate':
      anim = 'push';
      footwork = length === 'short' ? 'back' : 'forward';
      break;
    case 'drive':
      anim = 'drive';
      footwork = 'forward';
      break;
    case 'cut_pull':
      anim = legSide ? 'pull' : 'cut';
      footwork = legSide ? 'back' : 'across';
      break;
    case 'sweep':
      anim = 'sweep';
      footwork = 'forward';
      break;
    case 'loft':
      anim = 'loft';
      footwork = length === 'full' ? 'charge' : 'forward';
      break;
    default:
      anim = 'leave';
      footwork = 'still';
  }
  if (contact === 'miss' && anim !== 'leave') anim = 'miss';
  return { anim, footwork };
}

// ---------------------------------------------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------------------------------------------

interface Ctx {
  field: FieldSetting;
  cast: Cast;
  seed: number;
  family: DeliveryFamily;
  action: BowlerAction;
  /** The pitch the ball bounces on (the match's conditions). */
  conditions: PitchCondition;
}

class Builder {
  readonly actors = new Map<string, ActorTrack>();
  readonly ball: BallSeg[] = [];
  readonly events: SceneEvent[] = [];
  readonly overlay: OverlayItem[] = [];
  readonly crowd: Array<[number, number]> = [[0, 0.32]];
  stumps: BallScript['stumps'] = { striker: null, nonStriker: null };
  spots: FielderSpot[];
  flight: DeliveryFlight | null = null;
  times: KeyTimes = { runStart: 0, release: 0, bounce: 0, contact: 0, decisive: 0, shotEnd: 0, celebrate: null, end: 0 };
  heroes: string[] = [];
  shotBearing: number | null = null;
  slowMo: BallScript['slowMo'] = null;
  sealAt: number | null = null;
  private readonly random: () => number;

  constructor(readonly ctx: Ctx) {
    this.spots = fieldSpots(ctx.field);
    this.random = seededStream(ctx.seed);
  }

  rnd(): number {
    return this.random();
  }

  add(track: ActorTrack) {
    this.actors.set(track.id, track);
  }
  get(id: string): ActorTrack {
    const a = this.actors.get(id);
    if (!a) throw new Error(`unknown actor ${id}`);
    return a;
  }
  /** Position/heading of an actor at scene time t (evaluating its moves). */
  where(id: string, t: number): { pos: Vec3; heading: number } {
    const s = evaluateActor(this.get(id), t);
    return { pos: s.pos, heading: s.heading };
  }
  /** Cuts the actor's moves at `t` (the last move is shortened) and appends `m`. */
  then(id: string, m: Move) {
    const a = this.get(id);
    const end = this.where(id, m.t0);
    while (a.moves.length && a.moves[a.moves.length - 1].t0 >= m.t0) a.moves.pop();
    const last = a.moves[a.moves.length - 1];
    if (last && last.t1 > m.t0) {
      // Shorten the running move and pin its end to where the actor is at the cut.
      if (last.from && last.to) {
        const span = Math.max(1, last.t1 - last.t0);
        const u = clamp((m.t0 - last.t0) / span, 0, 1);
        last.to = end.pos;
        last.t1 = m.t0;
        if (u <= 0) last.from = end.pos;
      } else last.t1 = m.t0;
    }
    a.moves.push({ ...m, from: m.from ?? (m.to ? end.pos : undefined), heading: m.heading });
  }
  hold(id: string, t0: number, t1: number, clip: ClipId, extra: Partial<Move> = {}) {
    this.then(id, { t0, t1, clip, ...extra });
  }
  /** Moves an actor to `to`, choosing walk/jog/run by speed. Returns arrival time. */
  go(id: string, t0: number, to: Vec3, speed = SPRINT, extra: Partial<Move> = {}): number {
    const from = this.where(id, t0).pos;
    const d = dist2D(from, to);
    if (d < 0.05) return t0;
    const ms = (d / speed) * 1000;
    const clip: ClipId = speed > 5 ? 'run' : speed > 2.6 ? 'jog' : 'walk';
    this.then(id, { t0, t1: t0 + ms, clip, from, to, rate: speed > 5 ? speed / 7 : 1, ...extra });
    return t0 + ms;
  }
  event(t: number, kind: SceneEventKind, intensity = 1, at?: Vec3) {
    this.events.push({ t, kind, intensity, at });
  }
  crowdKey(t: number, v: number) {
    this.crowd.push([t, clamp(v, 0, 1)]);
  }
  seg(s: BallSeg) {
    this.ball.push(s);
  }
  /** The delivery's physics path from the release until scene time t1 (the bat, the stumps or the gloves); the seam changes at the pitch. */
  delivery(t1: number) {
    const f = this.flight!;
    const r = this.times.release;
    const pitch = f.pitchMs !== null ? r + f.pitchMs : Infinity;
    const path = { k: 'path' as const, samples: f.samples, release: r, mirror: false };
    this.seg({ ...path, t0: r, t1: Math.min(t1, pitch), ...f.seam.release });
    if (pitch < t1 && f.seam.afterBounce) this.seg({ ...path, t0: pitch, t1, ...f.seam.afterBounce });
  }
  /** The physics path from `from` to where the outcome says the ball goes, on this ball's pitch (drawn once followed). */
  aim(from: Vec3, p: Vec3, mode: AimMode, opts: AimPathOptions = {}): AimedPath {
    return aimPath(from, { p, mode }, { conditions: this.ctx.conditions, ...opts });
  }
  /** The ball follows a physics path launched at scene time t0. Returns when it arrives (an aimed path) or ends. */
  follow(t0: number, path: BallPathSim | AimedPath): number {
    const s = path.samples;
    const end = t0 + s[s.length - 1].t * 1000;
    this.seg({ k: 'path', t0, t1: end, samples: s, release: t0, mirror: false, ...path.seam });
    return 'tArrive' in path ? t0 + path.tArrive * 1000 : end;
  }
  /**
   * The fielder (actor id) best placed for a zone or a point. Close catchers (slips, gully) cover no zone: they only
   * count for a zone when the ball is being caught.
   */
  fielderFor(zone: FieldZone | null, point?: Vec3, catching = false): string {
    let best = 0;
    let bestScore = Infinity;
    this.spots.forEach((s, i) => {
      const zoneMatch = zone && s.zone === zone && (catching || s.kind !== 'close') ? 0 : 1;
      const d = point ? dist2D(s.pos, point) : zone ? Math.abs(ZONE_BEARING[zone] - bearingOf(s.pos)) : 0;
      const score = zoneMatch * 1000 + d;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    return `f${best}`;
  }
  build(kind: BallScript['kind'], fate: BallScript['fate'], celebration: BallScript['celebration'], cameras: CameraCue[] | null, duration: number): BallScript {
    this.times.end = duration;
    // Fill every actor until the end with its last clip.
    for (const a of this.actors.values()) {
      const last = a.moves[a.moves.length - 1];
      if (!last) a.moves.push({ t0: 0, t1: duration, clip: 'idle' });
      else if (last.t1 < duration) last.t1 = duration;
    }
    this.ball.sort((x, y) => x.t0 - y.t0);
    const lastSeg = this.ball[this.ball.length - 1];
    if (lastSeg && lastSeg.t1 < duration) lastSeg.t1 = duration;
    this.events.sort((x, y) => x.t - y.t);
    this.overlay.sort((x, y) => x.t - y.t);
    this.crowd.sort((x, y) => x[0] - y[0]);
    return {
      kind,
      duration,
      family: this.ctx.family,
      bowlerAction: this.ctx.action,
      ball: this.ball,
      actors: [...this.actors.values()],
      stumps: this.stumps,
      events: this.events,
      overlay: this.overlay,
      crowd: this.crowd,
      slowMo: this.slowMo,
      cameras,
      times: this.times,
      fate,
      celebration,
      heroes: this.heroes,
      shotBearing: this.shotBearing,
      sealAt: this.sealAt,
    };
  }
}

/** The physics surface for an engine pitch (a balanced one when unknown). */
function conditionsOf(pitch: PitchId | undefined): PitchCondition {
  return pitch ? CONDITIONS_FOR_PITCH[pitch] : 'balanced';
}

export function bearingOf(p: Vec3): number {
  return Math.atan2(p.x, CONTACT_Z - p.z) / DEG;
}

function dirOfBearing(deg: number): Vec3 {
  return v3(Math.sin(deg * DEG), 0, -Math.cos(deg * DEG));
}

function pointAt(bearingDeg: number, d: number): Vec3 {
  const dir = dirOfBearing(bearingDeg);
  return v3(dir.x * d, 0, CONTACT_Z + dir.z * d);
}

// ---------------------------------------------------------------------------------------------------------------
// Prelude: run-up, delivery and everyone's set-up, up to the moment the ball reaches the batter
// ---------------------------------------------------------------------------------------------------------------

export interface BowlerRunInput {
  action: BowlerAction;
  look: Look;
  /** Release exactly at this scene time: the visible run-up is what fits before it (default: the natural run-up). */
  releaseAt?: number;
  /** The bowler's root at release (default: the match's right-arm-over spot, on the off side). */
  releaseRoot?: Vec3;
  /** Plays the action mirrored: a left-arm bowler. */
  mirror?: boolean;
  /** Longest run-up shown (ms): a longer run starts nearer the crease, already on its way. */
  maxRunMs?: number;
  /** Stand at the top of the mark this long first (ms). */
  preMs?: number;
}

export interface BowlerRun {
  track: ActorTrack;
  /** Scene ms the run-up starts, the ball leaves the hand, and the action ends. */
  runStart: number;
  release: number;
  deliveryEnd: number;
  /** Clip seconds from the start of the delivery stride to the release. */
  releaseMarker: number;
}

/** The bowler's run-up, delivery stride and follow-through, released at a known scene time. */
export function bowlerRun(input: BowlerRunInput): BowlerRun {
  const action = input.action;
  const clip = DELIVERY_CLIP[action];
  const mRelease = clipMarker(clip, 'release', 0.6);
  let pre = input.preMs ?? PRE_MS;
  let runMs = (runUpLength(action) / RUN_SPEED[action]) * 1000;
  if (input.maxRunMs !== undefined) runMs = Math.min(runMs, input.maxRunMs);
  // Release exactly at `releaseAt` (the engine's timeline) when given: the visible run-up is what fits before it.
  if (input.releaseAt !== undefined) {
    pre = Math.min(PRE_MS, Math.max(0, input.releaseAt - mRelease * 1000 - 400));
    runMs = Math.max(250, input.releaseAt - pre - mRelease * 1000);
  }
  const runLen = (runMs / 1000) * RUN_SPEED[action];
  const releaseRoot = input.releaseRoot ?? v3(0.62, 0, RELEASE.z - 0.35);
  // The bowler runs in and follows through on the side of the stumps it bowls from.
  const side = releaseRoot.x >= 0 ? 1 : -1;
  const gather = v3(releaseRoot.x + 0.1 * side, 0, releaseRoot.z - STRIDE[action]);
  const start = v3(gather.x + side * Math.min(0.55, runLen * 0.035), 0, gather.z - runLen);
  const followEnd = v3(releaseRoot.x + 1.68 * side, 0, releaseRoot.z + FOLLOW[action]);
  const runEnd = pre + runMs;
  const release = runEnd + mRelease * 1000;
  const deliveryEnd = runEnd + clipDuration(clip) * 1000;
  const spin = action === 'spin_off' || action === 'spin_leg';
  const track: ActorTrack = {
    id: 'bowler',
    role: 'bowler',
    look: input.look,
    start,
    heading: 0,
    ...(input.mirror ? { mirror: true } : {}),
    moves: [
      { t0: 0, t1: Math.max(1, pre), clip: 'idle', heading: headingOf(gather.x - start.x, gather.z - start.z) },
      { t0: Math.max(1, pre), t1: runEnd, clip: spin ? 'bowl_approach_spin' : 'bowl_runup', from: start, to: gather, blend: pre > 0 ? 200 : 0, rate: spin ? 1 : RUN_SPEED[action] / 6.6 },
      { t0: runEnd, t1: release, clip, from: gather, to: releaseRoot, heading: 0, blend: 90 },
      { t0: release, t1: deliveryEnd, clip, clipStart: mRelease, from: releaseRoot, to: followEnd, ease: 'out', heading: 0, headingTo: 0.25 * side, blend: 0 },
    ],
  };
  return { track, runStart: pre, release, deliveryEnd, releaseMarker: mRelease };
}

function setUp(b: Builder, path: RevealedDelivery['path'] | BallOutcome['cues']['path'], releaseToContactMs?: number, releaseAt?: number) {
  const { ctx } = b;
  const run = bowlerRun({ action: ctx.action, look: ctx.cast.bowler, releaseAt });
  const pre = run.runStart;
  const release = run.release;
  b.add(run.track);

  const flight = buildFlight(path, ctx.family, releaseToContactMs, ctx.conditions);
  b.flight = flight;
  const contact = release + flight.contactMs;
  b.times.runStart = pre;
  b.times.release = release;
  // A ball the bat meets on the full (a yorker pitching under the bat, a full toss) has no bounce before contact.
  b.times.bounce = flight.bounceMs !== null ? release + flight.bounceMs : contact;
  b.times.contact = contact;
  b.seg({ k: 'hand', t0: 0, t1: release, actor: 'bowler' });
  b.event(release, 'release', path.speedKph / 150);
  if (flight.bounce && flight.bounceMs !== null) b.event(release + flight.bounceMs, 'bounce', 0.6, flight.bounce);
  b.overlay.push({ t: release + 260, kind: 'speed', value: Math.round(path.speedKph) });
  b.crowdKey(pre, 0.34);
  b.crowdKey(release - 200, 0.46);
  b.crowdKey(contact, 0.5);

  // Striker in the stance, non-striker backing up, keeper crouched, umpires set.
  b.add({ id: 'striker', role: 'batter', look: ctx.cast.striker, start: STRIKER_POS, heading: HALF_PI, moves: [{ t0: 0, t1: contact, clip: 'stance' }] });
  const backUp = add(NON_STRIKER_POS, v3(0, 0, 1.1));
  b.add({
    id: 'nonStriker',
    role: 'batter',
    look: ctx.cast.nonStriker,
    start: NON_STRIKER_POS,
    heading: 0,
    moves: [
      { t0: 0, t1: release - 500, clip: 'idle' },
      { t0: release - 500, t1: release + 200, clip: 'walk', from: NON_STRIKER_POS, to: backUp, rate: 0.9 },
      { t0: release + 200, t1: contact, clip: 'idle' },
    ],
  });
  const kp = keeperPos(ctx.family);
  b.add({ id: 'keeper', role: 'keeper', look: ctx.cast.keeper, start: kp, heading: Math.PI, moves: [{ t0: 0, t1: contact, clip: 'keep_crouch' }] });
  b.add({ id: 'umpire', role: 'umpire', look: ctx.cast.umpires[0], start: UMPIRE_POS, heading: 0, moves: [{ t0: 0, t1: contact, clip: 'ump_stand' }] });
  b.add({ id: 'umpire2', role: 'umpire', look: ctx.cast.umpires[1], start: SQUARE_UMPIRE_POS, heading: HALF_PI, moves: [{ t0: 0, t1: contact, clip: 'ump_stand' }] });

  b.spots.forEach((s, i) => {
    const id = `f${i}`;
    const toStriker = sub(v3(0, 0, CONTACT_Z), s.pos);
    const d = Math.hypot(toStriker.x, toStriker.z);
    const facing = headingOf(toStriker.x, toStriker.z);
    const walkIn = s.deep ? 3.2 : d < 9 ? 0 : 1.8;
    const end = add(s.pos, v3((toStriker.x / d) * walkIn, 0, (toStriker.z / d) * walkIn));
    const delay = b.rnd() * 300;
    const moves: Move[] =
      walkIn > 0
        ? [
            { t0: 0, t1: release - 1500 + delay, clip: 'idle', heading: facing },
            { t0: release - 1500 + delay, t1: release - 250, clip: 'walk', from: s.pos, to: end, rate: 0.85, heading: facing },
            { t0: release - 250, t1: contact, clip: 'ready', heading: facing, blend: 220 },
          ]
        : [
            { t0: 0, t1: release - 600, clip: 'idle', heading: facing },
            { t0: release - 600, t1: contact, clip: 'ready', heading: facing, blend: 260 },
          ];
    b.add({ id, role: 'fielder', look: ctx.cast.fielders[i] ?? ctx.cast.keeper, start: s.pos, heading: facing, moves });
  });
}

/** The batter's shot, timed so the swing's contact lands at `contactAt` (shifted by the timing grade). */
function shot(b: Builder, anim: BatterAnim, footwork: BallOutcome['cues']['footwork'], timing: TimingGrade, contactAt: number) {
  const clip = SHOT_CLIP[anim];
  const lower = anim === 'sweep' ? 'foot_sweep' : FOOT_CLIP[footwork];
  const marker = clipMarker(clip, 'contact', 0.45);
  const extra = anim === 'miss' ? 70 : anim === 'edge' ? 30 : 0;
  const start = Math.max(b.times.release - 120, contactAt - marker * 1000 + TIMING_OFFSET[timing] + extra);
  b.then('striker', { t0: start, t1: start + clipDuration(clip) * 1000, clip, lower, blend: 120 });
  return start + clipDuration(clip) * 1000;
}

/** A ball nothing touches: on through to the keeper, who steps across into its line to take it. */
function toKeeper(b: Builder) {
  const f = b.flight!;
  const t = b.times.contact;
  const catchAt = b.times.release + f.keeperMs;
  b.delivery(catchAt);
  b.seg({ k: 'hand', t0: catchAt, t1: catchAt + 60_000, actor: 'keeper' });
  const take = clipMarker('keep_take', 'catch', 0.3) * 1000;
  const stance = b.where('keeper', catchAt - take).pos;
  const line = v3(clamp(f.keeper.x, -1.4, 1.6), 0, stance.z);
  b.hold('keeper', catchAt - take, catchAt, 'keep_take', { blend: 80, from: stance, to: line, ease: 'out', heading: Math.PI });
  b.hold('keeper', catchAt, catchAt - take + 1000, 'keep_take', { clipStart: take / 1000, blend: 0, heading: Math.PI });
  b.hold('keeper', catchAt - take + 1000, catchAt + 4000, 'idle', { blend: 300 });
  b.event(catchAt, 'gloves', 0.6, f.keeper);
  return { t, catchAt };
}

function celebrate(b: Builder, t0: number, ids: string[], style: 'wicket' | 'boundary') {
  const bowler = b.where('bowler', t0).pos;
  if (style === 'wicket') {
    b.heroes = ['bowler'];
    // Bowler: aeroplane run then a jump; fielders and keeper converge.
    const runTo = add(bowler, v3(2.4, 0, 3.2));
    const reach = b.go('bowler', t0, runTo, 6, { clip: 'celebrate_run' });
    b.hold('bowler', reach, reach + 1500, 'celebrate_jump', { blend: 150 });
    b.hold('bowler', reach + 1500, reach + 6000, 'clap', { blend: 250 });
    let k = 0;
    for (const id of ids) {
      const ang = (k++ / Math.max(1, ids.length)) * Math.PI * 2;
      const spot = add(runTo, v3(Math.cos(ang) * 2.1, 0, Math.sin(ang) * 2.1));
      const from = b.where(id, t0).pos;
      const delay = 150 + b.rnd() * 400;
      const d = dist2D(from, spot);
      if (d > 30) {
        b.hold(id, t0 + delay, t0 + 6000, 'clap', { heading: headingOf(runTo.x - from.x, runTo.z - from.z) });
        continue;
      }
      const arrive = b.go(id, t0 + delay, spot, d > 8 ? 6.6 : 4.2);
      b.hold(id, arrive, arrive + 1500, b.rnd() > 0.5 ? 'celebrate_jump' : 'clap', { headingTo: headingOf(runTo.x - spot.x, runTo.z - spot.z) });
      b.hold(id, arrive + 1500, arrive + 6000, 'clap');
    }
  } else {
    b.heroes = ['striker'];
  }
  b.times.celebrate = t0;
}

function walkOff(b: Builder, id: string, t0: number) {
  const from = b.where(id, t0).pos;
  const exit = v3(-34, 0, from.z + 6);
  b.hold(id, t0, t0 + 900, 'dejected', { blend: 250 });
  b.then(id, { t0: t0 + 900, t1: t0 + 900 + (dist2D(from, exit) / 1.4) * 1000, clip: 'bat_walk', from, to: exit });
}

function batterRuns(b: Builder, t0: number, runs: number): number {
  // Batters run on either side of the pitch and cross mid-way.
  const laneS = 1.25;
  const laneN = -1.25;
  const s0 = b.where('striker', t0).pos;
  const n0 = b.where('nonStriker', t0).pos;
  let t = t0;
  let sz = s0.z;
  let nz = n0.z;
  b.then('striker', { t0: t, t1: t + 380, clip: 'bat_run', from: s0, to: v3(laneS, 0, CREASE_Z - 0.6) });
  b.then('nonStriker', { t0: t, t1: t + 380, clip: 'bat_run', from: n0, to: v3(laneN, 0, -CREASE_Z + 1.4) });
  t += 380;
  sz = CREASE_Z - 0.6;
  nz = -CREASE_Z + 1.4;
  for (let i = 0; i < runs; i++) {
    const sTo = i % 2 === 0 ? -CREASE_Z - 0.3 : CREASE_Z + 0.3;
    const nTo = i % 2 === 0 ? CREASE_Z + 0.3 : -CREASE_Z - 0.3;
    b.then('striker', { t0: t, t1: t + RUN_BETWEEN_MS, clip: 'bat_run', from: v3(laneS, 0, sz), to: v3(laneS, 0, sTo), ease: 'inOut' });
    b.then('nonStriker', { t0: t, t1: t + RUN_BETWEEN_MS, clip: 'bat_run', from: v3(laneN, 0, nz), to: v3(laneN, 0, nTo), ease: 'inOut' });
    t += RUN_BETWEEN_MS + 140;
    sz = sTo;
    nz = nTo;
  }
  b.hold('striker', t, t + 4000, 'idle', { blend: 260, headingTo: sz > 0 ? Math.PI : 0 });
  b.hold('nonStriker', t, t + 4000, 'idle', { blend: 260, headingTo: nz > 0 ? Math.PI : 0 });
  return t;
}

/**
 * A fielder gathers the ball at `at` and returns it to the keeper. The ball gets there through the physics: still
 * running at `arriveKph` when the fielder can be there in time, otherwise rolling to rest there and waiting for the
 * fielder. Returns when the ball reaches the fielder and when it is in the keeper's gloves.
 */
function fieldBall(b: Builder, id: string, at: Vec3, o: { dive: boolean; arriveKph: number; notBefore?: number }): { ballArrive: number; inGloves: number } {
  const contact = b.times.contact;
  const start = b.where(id, contact).pos;
  const react = contact + 160 + b.rnd() * 120;
  const d = dist2D(start, at);
  const collectClip: ClipId = o.dive ? 'dive' : 'pickup';
  const collectMarker = (o.dive ? clipMarker('dive', 'land', 0.5) : clipMarker('pickup', 'collect', 0.32)) * 1000;
  // Earliest the fielder can be there at full sprint.
  const ready = react + (d / 8.4) * 1000 + (o.dive ? 0 : 120);
  const spot = v3(at.x, BALL_R, at.z);
  const from = b.flight!.atBat;
  let ball = b.aim(from, spot, 'ground', { arriveSpeedKph: o.arriveKph });
  if (contact + ball.tArrive * 1000 < ready - 30) ball = b.aim(from, spot, 'ground');
  const ballArrive = b.follow(contact, ball);
  const collect = Math.max(ballArrive, ready);
  const c0 = collect - collectMarker;
  if (d > 0.4) {
    const runEnd = Math.max(react + 200, c0);
    b.go(id, react, at, clamp(d / Math.max(0.2, (runEnd - react) / 1000), 2.5, 8.4));
  }
  b.hold(id, c0, c0 + clipDuration(collectClip) * 1000, collectClip, { blend: 90, heading: headingOf(at.x - start.x, at.z - start.z) + (o.dive ? -HALF_PI : 0) });
  b.event(collect, 'fielded', o.dive ? 0.8 : 0.5, at);
  const throwStart = Math.max(c0 + clipDuration(collectClip) * 1000 - 120, o.notBefore ?? 0);
  const keeperAt = v3(0.2, 0, PITCH_HALF + 0.8);
  const facing = headingOf(keeperAt.x - at.x, keeperAt.z - at.z);
  b.hold(id, throwStart, throwStart + clipDuration('throw') * 1000, 'throw', { heading: facing });
  const releaseAt = throwStart + clipMarker('throw', 'release', 0.48) * 1000;
  b.seg({ k: 'hand', t0: collect, t1: releaseAt, actor: id });
  const gloves = b.follow(releaseAt, b.aim(v3(at.x, 1.9, at.z), v3(keeperAt.x, 1.0, keeperAt.z), 'carry', { elevationDeg: throwElevation(dist2D(at, keeperAt)) }));
  b.seg({ k: 'hand', t0: gloves, t1: gloves + 60_000, actor: 'keeper' });
  b.event(releaseAt, 'throw', 0.5, at);
  b.event(gloves, 'gloves', 0.5, keeperAt);
  // Keeper comes up to the stumps and takes it.
  const kArrive = b.go('keeper', contact + 300, keeperAt, 5.5);
  b.hold('keeper', Math.max(kArrive, gloves - 300), gloves + 3000, 'keep_take', { heading: Math.PI + facing, clipStart: 0, blend: 160 });
  b.hold(id, throwStart + clipDuration('throw') * 1000, throwStart + 8000, 'idle', { blend: 300 });
  return { ballArrive, inGloves: gloves };
}

/** A six into the stands: the first launch angle (of the few a big hit takes) that carries it there, else the nearest. */
function sixFlight(b: Builder, from: Vec3, seat: Vec3): AimedPath {
  let best: AimedPath | null = null;
  for (const elevationDeg of SIX_ELEVATIONS_DEG) {
    const a = b.aim(from, seat, 'carry', { elevationDeg, maxSpeedKph: SIX_MAX_KPH });
    if (a.feasible) return a;
    if (!best || a.errorM < best.errorM) best = a;
  }
  return best!;
}

function fieldersWatch(b: Builder, t0: number, except: string[]) {
  b.spots.forEach((_, i) => {
    const id = `f${i}`;
    if (except.includes(id)) return;
    b.hold(id, t0 + 300 + b.rnd() * 300, t0 + 9000, 'idle', { blend: 400 });
  });
}

function bowlerAfter(b: Builder, t0: number, mood: 'neutral' | 'frustrated') {
  const clip = DELIVERY_CLIP[b.ctx.action];
  const end = b.times.release - clipMarker(clip, 'release', 0.6) * 1000 + clipDuration(clip) * 1000;
  const t = Math.max(t0, end - 200);
  if (mood === 'frustrated') {
    b.hold('bowler', t, t + 1800, 'hands_on_head', { blend: 260 });
    b.hold('bowler', t + 1800, t + 8000, 'idle', { blend: 300 });
  } else b.hold('bowler', t, t + 8000, 'idle', { blend: 400, headingTo: Math.PI });
}

// ---------------------------------------------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------------------------------------------

export interface BallScriptInput {
  outcome: BallOutcome;
  field: FieldSetting;
  cast: Cast;
  seed: number;
  /** The engine's per-ball timeline (release and contact anchors), when available. */
  engineTimeline?: { releaseAtMs: number; contactAtMs: number; endMs: number } | null;
  /** The match pitch the ball bounces on (default: a balanced surface). */
  pitch?: PitchId;
}

export function buildBallScript(input: BallScriptInput): BallScript {
  const { outcome } = input;
  const cues = outcome.cues;
  const family = familyOf(cues.path, outcome.delivery.variant);
  const ctx: Ctx = { field: input.field, cast: input.cast, seed: input.seed, family, action: cues.bowlerAction, conditions: conditionsOf(input.pitch) };
  const b = new Builder(ctx);
  const et = input.engineTimeline ?? null;
  setUp(b, cues.path, et ? et.contactAtMs - et.releaseAtMs : undefined, et ? et.releaseAtMs : undefined);
  const f = b.flight!;
  const contact = b.times.contact;
  const fate = cues.fate;
  const anim = cues.batterAnim;
  const shotEnd = anim === 'leave' && outcome.contact === 'none' ? shot(b, 'leave', 'still', 'perfect', contact) : shot(b, anim, cues.footwork, outcome.timing, contact);
  b.times.shotEnd = shotEnd;
  const zone = (fate as { zone?: FieldZone | null }).zone ?? outcome.zone ?? null;
  let end = contact + 2000;
  const crowdPeak = clamp(cues.crowd, 0, 1);
  const contactPoint = f.atBat;
  const batEvent = (intensity: number) => {
    const kind = outcome.contact === 'thin_edge' || outcome.contact === 'thick_edge' ? 'edge' : outcome.contact === 'pad' ? 'pad' : 'bat';
    b.event(contact, kind, intensity, contactPoint);
  };

  switch (fate.kind) {
    case 'dot_block': {
      b.delivery(contact);
      // Dead bat or pad: it drops and dribbles to rest just in front.
      const rest = outcome.contact === 'pad' ? v3(contactPoint.x - 1.6, BALL_R, contactPoint.z - 1.1) : v3(contactPoint.x * 0.5 + 0.4, BALL_R, contactPoint.z - 2.7);
      b.follow(contact, b.aim(contactPoint, rest, 'ground'));
      batEvent(0.35);
      b.overlay.push({ t: contact + 300, kind: 'dot' });
      b.crowdKey(contact + 400, 0.3 + crowdPeak * 0.2);
      bowlerAfter(b, contact + 600, 'neutral');
      b.hold('keeper', contact + 200, contact + 6000, 'idle', { blend: 400 });
      fieldersWatch(b, contact, []);
      b.times.decisive = contact;
      end = contact + 1900;
      break;
    }
    case 'dot_beaten': {
      const { catchAt } = toKeeper(b);
      b.overlay.push({ t: contact + 300, kind: 'dot' });
      b.crowdKey(contact + 250, 0.32 + crowdPeak * 0.5);
      bowlerAfter(b, contact + 200, 'frustrated');
      fieldersWatch(b, contact, []);
      b.times.decisive = contact;
      end = Math.max(catchAt + 1300, contact + 1900);
      break;
    }
    case 'dot_fielded':
    case 'runs': {
      const runs = fate.kind === 'runs' ? fate.runs : 0;
      const z = zone ?? 'cover';
      b.delivery(contact);
      batEvent(runs > 0 ? 0.6 : 0.5);
      const fielder = b.fielderFor(z);
      const spot = b.where(fielder, contact).pos;
      let target: Vec3;
      let dive = false;
      if (runs === 0) {
        // Straight at a fielder, who stops it (diving if it is a firm shot).
        const side = b.rnd() > 0.5 ? 1 : -1;
        dive = b.rnd() > 0.45 && dist2D(spot, contactPoint) > 9;
        target = add(spot, v3(side * (dive ? 1.4 : 0.35), 0, 0));
      } else {
        // Into the gap, away from the zone fielder, then a chase.
        const bearing = ZONE_BEARING[z] + (b.rnd() > 0.5 ? 11 : -11);
        const reach = distanceToBoundary(z, 0, 6) * (runs === 1 ? 0.45 : runs === 2 ? 0.72 : 0.86);
        target = pointAt(bearing, reach);
      }
      const notBefore = contact + 380 + runs * (RUN_BETWEEN_MS + 140) - 900;
      b.shotBearing = bearingOf(target);
      const arriveKph = runs > 0 ? FIELD_ARRIVE_KPH.chase : dive ? FIELD_ARRIVE_KPH.dive : FIELD_ARRIVE_KPH.stop;
      const { ballArrive, inGloves } = fieldBall(b, fielder, target, { dive, arriveKph, notBefore: runs > 0 ? notBefore : 0 });
      const runsEnd = runs > 0 ? batterRuns(b, contact + 250, runs) : contact;
      if (runs === 0) b.hold('striker', shotEnd, shotEnd + 5000, 'stance', { blend: 400 });
      b.overlay.push({ t: runs > 0 ? runsEnd - 200 : ballArrive, kind: runs > 0 ? 'runs' : 'dot', value: runs });
      b.crowdKey(contact + 400, 0.42 + crowdPeak * 0.3);
      b.crowdKey(ballArrive, 0.4 + crowdPeak * 0.35);
      bowlerAfter(b, contact + 500, 'neutral');
      fieldersWatch(b, contact + 400, [fielder]);
      b.times.decisive = ballArrive;
      end = Math.max(inGloves, runsEnd) + 900;
      break;
    }
    case 'four': {
      const z = fate.zone;
      b.delivery(contact);
      batEvent(0.9);
      const bearing = ZONE_BEARING[z] + (b.rnd() - 0.5) * 18;
      const d = distanceToBoundary(z, bearing - ZONE_BEARING[z], -1.2);
      const rope = pointAt(bearing, d);
      // Along the ground, or in the air landing short of the rope: either way it runs over the rope.
      const four = b.aim(contactPoint, rope, 'bounce_then_rope', { elevationDeg: fate.bounces ? FOUR_ELEVATION_DEG.along : FOUR_ELEVATION_DEG.aerial });
      const cross = b.follow(contact, four);
      b.shotBearing = bearing;
      // The closest fielder chases and dives at the rope, just too late.
      const chaser = b.fielderFor(z, rope);
      const near = lerpV(rope, v3(0, 0, CONTACT_Z), 0.06);
      const reach = b.go(chaser, contact + 200, near, SPRINT);
      b.hold(chaser, Math.max(reach, cross - 20), cross + 1480, 'dive', { blend: 80 });
      b.hold(chaser, cross + 1480, cross + 9180, 'idle', { blend: 400 });
      b.event(cross, 'boundary', 0.9, four.arrive);
      b.overlay.push({ t: cross, kind: 'four' });
      b.crowdKey(contact + 300, 0.55);
      b.crowdKey(cross, 0.6 + crowdPeak * 0.4);
      b.crowdKey(cross + 2500, 0.45);
      b.hold('umpire', cross + 300, cross + 2500, 'ump_four', { blend: 200 });
      b.event(cross + 400, 'signal', 0.4);
      bowlerAfter(b, contact + 400, 'frustrated');
      fieldersWatch(b, contact + 200, [chaser]);
      // Batters meet mid-pitch.
      const mid = v3(0.2, 0, 1.5);
      b.hold('striker', shotEnd, shotEnd + 600, 'idle', { blend: 300 });
      b.go('striker', shotEnd + 600, mid, 1.6);
      b.go('nonStriker', contact + 900, v3(-0.5, 0, 0.7), 1.6);
      b.times.decisive = cross;
      end = cross + 2300;
      if (cues.celebration === 'boundary' || cues.celebration === 'milestone') {
        celebrate(b, cross + 200, [], 'boundary');
        b.hold('striker', cross + 1600, cross + 3400, 'bat_raise', { blend: 250 });
        end = cross + 3600;
      }
      break;
    }
    case 'six': {
      const z = fate.zone;
      b.delivery(contact);
      batEvent(1);
      const bearing = ZONE_BEARING[z] + (b.rnd() - 0.5) * 14;
      const dist = clamp(fate.distanceM || 80, distanceToBoundary(z, 0, 0) + 8, 118);
      const land = pointAt(bearing, dist);
      const r = Math.hypot(land.x, land.z);
      // Into the stands, which rise behind the rope; it lands there and is gone into the crowd.
      const standY = clamp((r - BOUNDARY_R - 4) * 0.42, 0, 18) + 0.4;
      const ms = b.follow(contact, sixFlight(b, contactPoint, v3(land.x, standY, land.z))) - contact;
      b.seg({ k: 'gone', t0: contact + ms + 200, t1: contact + ms + 60_000 });
      b.shotBearing = bearing;
      const watcher = b.fielderFor(z, land);
      const toward = pointAt(bearing, distanceToBoundary(z, 0, 3));
      b.go(watcher, contact + 250, toward, 5.5);
      b.hold(watcher, contact + ms - 300, contact + ms + 8000, 'hands_on_head', { blend: 250 });
      b.event(contact + ms, 'six', 1, land);
      b.event(contact + ms + 120, 'fireworks', 1, land);
      b.overlay.push({ t: contact + ms * 0.55, kind: 'six' });
      b.crowdKey(contact + 400, 0.7);
      b.crowdKey(contact + ms, 0.75 + crowdPeak * 0.25);
      b.crowdKey(contact + ms + 3000, 0.5);
      b.hold('umpire', contact + ms - 200, contact + ms + 2000, 'ump_six', { blend: 200 });
      b.event(contact + ms, 'signal', 0.5);
      bowlerAfter(b, contact + 400, 'frustrated');
      fieldersWatch(b, contact + 200, [watcher]);
      b.times.decisive = contact;
      end = contact + ms + 2300;
      if (cues.celebration === 'six' || cues.celebration === 'milestone' || cues.celebration === 'boundary') {
        celebrate(b, contact + ms - 400, [], 'boundary');
        b.hold('striker', Math.max(shotEnd, contact + ms - 400), contact + ms + 1500, 'bat_raise', { blend: 250 });
        end = contact + ms + 2600;
      }
      break;
    }
    case 'wicket': {
      const kind = fate.wicket;
      let decisive = contact;
      const celebrants: string[] = [...b.spots.map((_, i) => `f${i}`), 'keeper'];
      if (kind === 'bowled') {
        const stumps = v3(0, 0.38, PITCH_HALF);
        const offLine = Math.abs(f.path.lineAtBatM) > 0.16 || outcome.contact === 'thin_edge' || outcome.contact === 'thick_edge';
        let hit: number;
        let atStumps: Vec3;
        if (offLine) {
          // Played on: off the inside edge, down onto the stumps.
          b.delivery(contact);
          const on = b.aim(contactPoint, v3(clamp(contactPoint.x * 0.3, -0.09, 0.09), 0.3, STUMPS_FRONT_Z), 'carry', { elevationDeg: PLAYED_ON_ELEVATION_DEG });
          hit = b.follow(contact, on);
          atStumps = on.arrive;
          b.event(contact, 'edge', 0.5, contactPoint);
        } else {
          // Through the gate: the delivery itself reaches the stumps.
          hit = b.times.release + f.stumpsMs;
          b.delivery(hit);
          atStumps = f.at(f.stumpsMs);
        }
        // Off the stumps, it dribbles away behind them.
        b.follow(hit, b.aim(atStumps, v3(0.3, BALL_R, PITCH_HALF + 3.2), 'ground'));
        b.stumps.striker = { t: hit, dir: v3(0, 0.2, 1), strength: clamp(f.path.speedKph / 140, 0.5, 1.2) };
        b.event(hit, 'stumps', 1, stumps);
        b.event(hit + 30, 'bails', 1, stumps);
        decisive = hit;
        b.hold('keeper', hit + 100, hit + 900, 'keep_take', { clipStart: 0.3, blend: 120 });
      } else if (kind === 'caught') {
        b.delivery(contact);
        batEvent(outcome.contact === 'middle' ? 0.8 : 0.5);
        const behind = !zone || outcome.contact === 'thin_edge' || (outcome.contact === 'thick_edge' && (zone === 'third_man' || zone === 'fine_leg'));
        // An edge behind goes to the keeper or, when the field has one, a slip or gully; anything else to the fielder there.
        const slips = b.spots.some((s) => s.kind === 'close' && s.zone === 'third_man');
        const catcher = behind ? (!slips || b.rnd() > 0.4 || b.ctx.family === 'spin' ? 'keeper' : b.fielderFor('third_man', v3(1.5, 0, PITCH_HALF + 6), true)) : b.fielderFor(zone, undefined, true);
        const cStart = b.where(catcher, contact).pos;
        const far = dist2D(cStart, contactPoint) > 14;
        const catchPt = far ? add(cStart, v3((b.rnd() - 0.5) * 6, 0, (b.rnd() - 0.5) * 6)) : cStart;
        const handsY = far ? 2.15 : catcher === 'keeper' ? 0.95 : 1.15;
        // A skier hangs; an edge carries flat and fast behind; anything else is a firm, low catch.
        const elevationDeg = far ? SKIER_ELEVATION_DEG[0] + b.rnd() * (SKIER_ELEVATION_DEG[1] - SKIER_ELEVATION_DEG[0]) : behind ? EDGE_ELEVATION_DEG : undefined;
        const caughtAt = b.follow(contact, b.aim(contactPoint, v3(catchPt.x, handsY, catchPt.z), 'carry', { elevationDeg, maxSpeedKph: CATCH_MAX_KPH }));
        b.shotBearing = bearingOf(catchPt);
        const clip: ClipId = catcher === 'keeper' ? 'keep_take' : far ? 'catch_high' : 'catch_chest';
        const marker = clipMarker(clip, 'catch', 0.4) * 1000;
        if (far) b.go(catcher, contact + 250, catchPt, Math.max(2.5, dist2D(cStart, catchPt) / Math.max(0.4, (caughtAt - marker - contact - 300) / 1000)));
        b.hold(catcher, caughtAt - marker, caughtAt - marker + clipDuration(clip) * 1000, clip, { blend: 100, heading: headingOf(contactPoint.x - catchPt.x, contactPoint.z - catchPt.z) });
        // Ball tossed up in celebration.
        const toss = caughtAt + 900;
        b.seg({ k: 'hand', t0: caughtAt, t1: toss, actor: catcher });
        b.follow(toss, b.aim(v3(catchPt.x, 2.1, catchPt.z), v3(catchPt.x + 0.6, BALL_R, catchPt.z + 0.4), 'carry', { elevationDeg: TOSS_ELEVATION_DEG, spin: v3(), keep: 'all' }));
        b.event(caughtAt, 'catch', 1, catchPt);
        decisive = caughtAt;
        celebrants.splice(celebrants.indexOf(catcher), 1);
        b.hold(catcher, caughtAt - marker + clipDuration(clip) * 1000, caughtAt + 6000, 'celebrate_jump', { blend: 150 });
      } else if (kind === 'lbw') {
        b.delivery(contact);
        b.event(contact, 'pad', 0.8, contactPoint);
        // Off the pad, it drops and rolls away on the leg side.
        b.follow(contact, b.aim(contactPoint, v3(contactPoint.x - 1.5, BALL_R, contactPoint.z - 2.2), 'ground'));
        const appealAt = contact + 250;
        const clip = DELIVERY_CLIP[b.ctx.action];
        const deliveryEnd = b.times.release - clipMarker(clip, 'release', 0.6) * 1000 + clipDuration(clip) * 1000;
        b.hold('bowler', Math.max(appealAt, deliveryEnd - 500), Math.max(appealAt, deliveryEnd - 500) + 1500, 'appeal', { headingTo: Math.PI, blend: 200 });
        b.event(appealAt, 'appeal', 1);
        decisive = contact + 1250;
        b.hold('umpire', contact + 700, contact + 2900, 'ump_out', { blend: 200 });
        b.event(contact + 1250, 'signal', 1);
      } else if (kind === 'stumped') {
        const { catchAt } = toKeeper(b);
        const hitAt = catchAt + (clipMarker('keep_stump', 'hit', 0.42) - clipMarker('keep_stump', 'catch', 0.22)) * 1000;
        b.hold('keeper', catchAt - clipMarker('keep_stump', 'catch', 0.22) * 1000, hitAt + 1500, 'keep_stump', { blend: 80 });
        b.stumps.striker = { t: hitAt, dir: v3(0.3, 0.6, -0.2), strength: 0.45 };
        b.event(hitAt, 'bails', 1, v3(0, 0.71, PITCH_HALF));
        decisive = hitAt;
        b.hold('umpire2', hitAt + 500, hitAt + 2700, 'ump_out', { blend: 200 });
        celebrants.splice(celebrants.indexOf('keeper'), 1);
      } else {
        // Run out at the bowler's end with a direct hit.
        const z = zone ?? 'cover';
        b.delivery(contact);
        batEvent(0.5);
        const fielder = b.fielderFor(z);
        const spot = b.where(fielder, contact).pos;
        const pick = add(spot, v3(0.6, 0, 0.4));
        const picked = b.follow(contact, b.aim(contactPoint, v3(pick.x, BALL_R, pick.z), 'ground', { arriveSpeedKph: FIELD_ARRIVE_KPH.stop }));
        b.shotBearing = bearingOf(pick);
        b.go(fielder, contact + 150, pick, 6);
        b.hold(fielder, picked - 320, picked + 300, 'pickup', { blend: 80 });
        const target = v3(0, 0.4, -PITCH_HALF);
        const facing = headingOf(target.x - pick.x, target.z - pick.z);
        b.hold(fielder, picked + 250, picked + 1200, 'throw', { heading: facing });
        const rel = picked + 250 + clipMarker('throw', 'release', 0.48) * 1000;
        b.seg({ k: 'hand', t0: picked, t1: rel, actor: fielder });
        // A flat throw and a direct hit at the bowler's end; the ball runs on past the stumps.
        const direct = b.aim(v3(pick.x, 1.8, pick.z), target, 'carry', { elevationDeg: directHitElevation(dist2D(pick, target)) });
        const hitAt = b.follow(rel, direct);
        b.follow(hitAt, b.aim(direct.arrive, v3(-0.6, BALL_R, -PITCH_HALF - 4), 'ground'));
        b.stumps.nonStriker = { t: hitAt, dir: v3(-0.3, 0.3, -1), strength: 0.8 };
        b.event(hitAt, 'stumps', 0.9, target);
        b.event(hitAt + 20, 'bails', 1, target);
        // The striker runs and is short of his ground; the non-striker runs the other way.
        const sFrom = b.where('striker', contact + 250).pos;
        const short = v3(1.25, 0, -CREASE_Z + 1.3);
        b.then('striker', { t0: contact + 250, t1: hitAt + 60, clip: 'bat_run', from: sFrom, to: short });
        b.hold('striker', hitAt + 60, hitAt + 900, 'dive', { heading: Math.PI, blend: 80 });
        b.then('nonStriker', { t0: contact + 250, t1: hitAt, clip: 'bat_run', from: b.where('nonStriker', contact + 250).pos, to: v3(-1.25, 0, CREASE_Z - 1.5) });
        decisive = hitAt;
        celebrants.splice(celebrants.indexOf(fielder), 1);
        b.hold(fielder, picked + 1200, picked + 6000, 'celebrate_jump', { blend: 150 });
        b.hold('umpire2', hitAt + 500, hitAt + 2700, 'ump_out', { blend: 200 });
      }
      b.times.decisive = decisive;
      b.overlay.push({ t: decisive + 120, kind: 'wicket', wicket: kind });
      b.crowdKey(decisive - 80, 0.5);
      b.crowdKey(decisive + 250, 0.7 + crowdPeak * 0.3);
      b.crowdKey(decisive + 3500, 0.55);
      celebrate(b, decisive + 250, celebrants.filter((id) => id !== 'bowler'), 'wicket');
      walkOff(b, kind === 'run_out' ? 'striker' : 'striker', Math.max(decisive + 1100, shotEnd));
      b.hold('nonStriker', decisive + 600, decisive + 9000, 'dejected', { blend: 400 });
      end = decisive + 4300;
      break;
    }
  }

  b.times.end = end;
  if (cues.slowMotion) {
    const d = b.times.decisive;
    const around = fate.kind === 'six' || fate.kind === 'four' ? contact : d;
    b.slowMo = { t0: around - 260, t1: around + 520, rate: 0.3 };
  }
  const cameras = cues.cameras && cues.cameras.length ? retimeCameras(cues.cameras, et, b.times, cues.celebration !== 'none') : null;
  return b.build('ball', fate, cues.celebration, cameras && cameras.length ? cameras : null, end);
}

export interface LiveShot {
  shot: ShotType;
  timing: TimingGrade;
  contact: Contact;
  zone?: FieldZone | null;
  /** ms from release to the tap (aligns the swing with the player's tap). */
  tapMs?: number | null;
}

export interface LiveScriptInput {
  /** Release time from the start of the run-up (the engine's RUN_UP_MS for the bowler action). */
  releaseAt?: number;
  delivery: RevealedDelivery;
  /** The match pitch the ball bounces on (default: a balanced surface). */
  pitch?: PitchId;
  field: FieldSetting;
  cast: Cast;
  seed: number;
  shot?: LiveShot | null;
}

/** Live batting: the delivery, then (once known) the batter's shot and a sealed ending (no runs, no wickets). */
export function buildLiveScript(input: LiveScriptInput): BallScript {
  const d = input.delivery;
  const action = actionForFamily(d.family, d.variant, d.intensity);
  const ctx: Ctx = { field: input.field, cast: input.cast, seed: input.seed, family: d.family, action, conditions: conditionsOf(input.pitch) };
  const b = new Builder(ctx);
  setUp(b, d.path, d.timing.releaseToContactMs, input.releaseAt);
  const f = b.flight!;
  const contact = b.times.contact;
  const s = input.shot;
  const sealAt = contact + (s && s.contact === 'middle' ? 330 : 240);
  b.sealAt = sealAt;
  b.times.decisive = contact;
  if (!s) {
    b.delivery(b.times.release + f.keeperMs);
  } else {
    const { anim, footwork } = liveShotAnim(s.shot, s.contact, s.zone ?? null, d.length);
    const swingContact = s.tapMs !== null && s.tapMs !== undefined ? b.times.release + s.tapMs : contact;
    b.times.shotEnd = shot(b, anim, footwork, 'perfect', swingContact);
    if (s.contact === 'none' || s.contact === 'miss' || anim === 'leave') {
      b.delivery(b.times.release + f.keeperMs);
    } else {
      b.delivery(contact);
      const p = f.atBat;
      const zone = s.zone ?? 'mid_off';
      const bearing = ZONE_BEARING[zone] + (s.contact === 'thin_edge' ? 140 - ZONE_BEARING[zone] : s.contact === 'thick_edge' ? 25 : 0);
      const dir = dirOfBearing(bearing);
      // The result is sealed: only the shot's first moments show, launched off the bat through the integrator.
      const speed = s.contact === 'middle' ? LIVE_SPEED.middle : s.contact === 'pad' ? LIVE_SPEED.pad : LIVE_SPEED.edge;
      const e = (s.shot === 'loft' && s.contact === 'middle' ? LIVE_ELEVATION_DEG.loft : s.contact === 'pad' ? LIVE_ELEVATION_DEG.pad : LIVE_ELEVATION_DEG.other) * DEG;
      const launch = v3(dir.x * speed * Math.cos(e), speed * Math.sin(e), dir.z * speed * Math.cos(e));
      b.follow(contact, flyFrom(p, launch, (sealAt - contact) / 1000 + 0.05, { backspinRps: s.contact === 'pad' ? 0 : LIVE_BACKSPIN_RPS, conditions: ctx.conditions }));
      b.shotBearing = bearing;
      b.event(contact, s.contact === 'pad' ? 'pad' : s.contact === 'middle' ? 'bat' : 'edge', s.contact === 'middle' ? (s.timing === 'perfect' ? 1 : 0.75) : 0.45, p);
    }
  }
  b.event(sealAt, 'seal', 1);
  b.overlay.push({ t: sealAt, kind: 'sealed' });
  b.crowdKey(sealAt, 0.42);
  // Everyone freezes into a held pose shortly after the seal; nothing after it can hint at the result.
  const end = sealAt + 900;
  const last = b.ball[b.ball.length - 1];
  if (last) last.t1 = Math.min(last.t1, sealAt);
  b.seg({ k: 'gone', t0: sealAt, t1: end });
  return b.build('live', { kind: 'live' }, 'none', null, end);
}

/**
 * Between-balls and intro/result scenes: the field set, players idle, ambient crowd. A result scene can open with a
 * `beat`: the held breath before the result (the crowd hushes, the sound builds, the camera pushes in), after which
 * the result lands with a hit and the celebrations start.
 */
export function buildAmbientScript(field: FieldSetting, cast: Cast, family: DeliveryFamily, duration: number, seed: number, mood: 'intro' | 'innings' | 'result' | 'live' = 'intro', winners: 'batting' | 'bowling' | null = null, beat = 0): BallScript {
  const action = actionForFamily(family);
  const b = new Builder({ field, cast, seed, family, action, conditions: conditionsOf(undefined) });
  const spots = b.spots;
  const top = v3(1.25, 0, RELEASE.z - 0.35 - STRIDE[action] - runUpLength(action));
  b.add({ id: 'bowler', role: 'bowler', look: cast.bowler, start: top, heading: 0, moves: [{ t0: 0, t1: duration, clip: 'idle' }] });
  b.add({ id: 'striker', role: 'batter', look: cast.striker, start: STRIKER_POS, heading: HALF_PI, moves: [{ t0: 0, t1: duration, clip: 'stance' }] });
  b.add({ id: 'nonStriker', role: 'batter', look: cast.nonStriker, start: NON_STRIKER_POS, heading: 0, moves: [{ t0: 0, t1: duration, clip: 'idle' }] });
  b.add({ id: 'keeper', role: 'keeper', look: cast.keeper, start: keeperPos(family), heading: Math.PI, moves: [{ t0: 0, t1: duration, clip: 'idle' }] });
  b.add({ id: 'umpire', role: 'umpire', look: cast.umpires[0], start: UMPIRE_POS, heading: 0, moves: [{ t0: 0, t1: duration, clip: 'ump_stand' }] });
  b.add({ id: 'umpire2', role: 'umpire', look: cast.umpires[1], start: SQUARE_UMPIRE_POS, heading: HALF_PI, moves: [{ t0: 0, t1: duration, clip: 'ump_stand' }] });
  spots.forEach((s, i) => {
    const facing = headingOf(-s.pos.x, CONTACT_Z - s.pos.z);
    b.add({ id: `f${i}`, role: 'fielder', look: cast.fielders[i] ?? cast.keeper, start: s.pos, heading: facing, moves: [{ t0: 0, t1: duration, clip: b.rnd() > 0.5 ? 'idle' : 'ready', clipStart: b.rnd() * 2 }] });
  });
  b.seg({ k: 'gone', t0: 0, t1: duration });
  const hold = mood === 'result' ? Math.max(0, Math.min(beat, duration - 1000)) : 0;
  if (hold > 0) {
    // The held breath: the crowd hushes while the sound builds, then the result lands and the ground erupts.
    b.crowdKey(0, 0.5);
    b.crowdKey(hold - 250, 0.16);
    b.crowdKey(hold + 220, 0.95);
    b.event(0, 'tension', 1);
    b.event(hold, 'result', 1);
  } else b.crowdKey(0, mood === 'result' ? 0.8 : 0.4);
  b.crowdKey(duration, mood === 'result' ? 0.7 : 0.45);
  if (mood === 'result' && winners) {
    if (winners === 'bowling') {
      celebrate(b, hold + 300, spots.map((_, i) => `f${i}`).concat('keeper'), 'wicket');
    } else {
      b.heroes = ['striker', 'nonStriker'];
      b.go('striker', hold + 200, v3(0.3, 0, 1.2), 3);
      b.go('nonStriker', hold + 200, v3(-0.4, 0, 0.4), 3);
      b.hold('striker', hold + 2200, duration, 'bat_raise', { blend: 250 });
      b.hold('nonStriker', hold + 2200, duration, 'celebrate_jump', { blend: 250 });
    }
    for (let k = 0; k < 4; k++) b.event(hold + 400 + k * 900, 'fireworks', 1, v3(Math.cos(k * 1.7) * 70, 30, Math.sin(k * 1.7) * 70));
  }
  b.times = { runStart: 0, release: duration, bounce: duration, contact: duration, decisive: hold > 0 ? hold : duration * 0.4, shotEnd: duration, celebrate: mood === 'result' ? hold + 300 : null, end: duration };
  const script = b.build('ambient', { kind: 'ambient' }, mood === 'result' ? 'milestone' : 'none', null, duration);
  if (mood === 'live') script.camera = 'batting_pov';
  if (hold > 0) script.beat = hold;
  return script;
}

/**
 * Maps engine camera cues (timed on the engine's per-ball timeline) onto this choreography: release and contact
 * are identical by construction; the aftermath and celebration stretch to the animated durations.
 */
export function retimeCameras(cues: readonly CameraCue[], et: { releaseAtMs: number; contactAtMs: number; endMs: number } | null, times: KeyTimes, celebrates: boolean): CameraCue[] {
  const sorted = [...cues].filter((c) => c.durationMs > 0).sort((a, b) => a.atMs - b.atMs);
  if (!sorted.length) return [];
  const last = sorted[sorted.length - 1];
  const eEnd = et?.endMs ?? last.atMs + last.durationMs;
  const celebrationCue = celebrates ? sorted.find((c) => c.shot === 'celebration') : undefined;
  const eAfter = celebrationCue ? celebrationCue.atMs : eEnd;
  const eRelease = et?.releaseAtMs ?? times.release;
  const eContact = et?.contactAtMs ?? times.contact;
  const myAfter = times.celebrate ?? times.end;
  const anchors: Array<[number, number]> = [
    [0, 0],
    [eRelease, times.release],
    [eContact, times.contact],
    [Math.max(eContact + 1, eAfter), Math.max(times.contact + 1, myAfter)],
    [Math.max(eAfter + 1, eEnd), Math.max(myAfter + 1, times.end)],
  ];
  const map = (t: number): number => {
    for (let i = 1; i < anchors.length; i++) {
      const [e0, m0] = anchors[i - 1];
      const [e1, m1] = anchors[i];
      if (t <= e1 || i === anchors.length - 1) return m0 + ((t - e0) / Math.max(1, e1 - e0)) * (m1 - m0);
    }
    return t;
  };
  return sorted.map((c) => {
    const a = map(c.atMs);
    const z = map(c.atMs + c.durationMs);
    return { shot: c.shot, atMs: Math.round(a), durationMs: Math.max(1, Math.round(z - a)) };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Ball position
// ---------------------------------------------------------------------------------------------------------------

export interface BallSample {
  pos: Vec3;
  visible: boolean;
  /** Actor holding the ball (the 3D layer snaps it to that actor's hand). */
  heldBy: string | null;
  /** Rotation angle (radians) for the seam animation. */
  spin: number;
  inFlight: boolean;
  /** Seam rotation axis when the segment carries its own (Practice); otherwise the flight's. */
  spinAxis?: Vec3;
}

/** Ball position at scene time t. `handOf` returns an actor's hand position (3D) or null (2D approximation). */
export function sampleBall(script: BallScript, t: number, handOf?: (actor: string) => Vec3 | null): BallSample {
  const segs = script.ball;
  let seg = segs[0];
  for (const s of segs) {
    if (t >= s.t0) seg = s;
    else break;
  }
  if (!seg) return { pos: v3(), visible: false, heldBy: null, spin: 0, inFlight: false };
  switch (seg.k) {
    case 'hand': {
      const hp = handOf?.(seg.actor);
      if (hp) return { pos: hp, visible: true, heldBy: seg.actor, spin: 0, inFlight: false };
      const track = script.actors.find((a) => a.id === seg.actor);
      const st = track ? evaluateActor(track, t) : null;
      const base = st ? st.pos : v3();
      const h = st ? st.heading : 0;
      return { pos: v3(base.x - Math.cos(h) * 0.25, 1.2, base.z + Math.sin(h) * 0.25), visible: true, heldBy: seg.actor, spin: 0, inFlight: false };
    }
    case 'path': {
      const st = (t - seg.release) / 1000;
      const p = ballAt(seg.samples, st);
      if (!p) return { pos: v3(0, -10, 0), visible: false, heldBy: null, spin: 0, inFlight: false };
      // Past its last sample the ball has stopped (at rest, at the rope, in the stands) and holds there.
      const moving = st < seg.samples[seg.samples.length - 1].t;
      const spin = (moving ? t - seg.release : seg.samples[seg.samples.length - 1].t * 1000) * (seg.spinRate ?? 0);
      return { pos: v3(seg.mirror ? -p.x : p.x, p.y, p.z), visible: true, heldBy: null, spin, inFlight: moving, spinAxis: seg.spinAxis };
    }
    default:
      return { pos: v3(0, -10, 0), visible: false, heldBy: null, spin: 0, inFlight: false };
  }
}

/** Crowd excitement 0..1 at time t (smooth envelope). */
export function crowdAt(script: BallScript, t: number): number {
  const keys = script.crowd;
  if (!keys.length) return 0.35;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      const u = clamp((t - t0) / Math.max(1, t1 - t0), 0, 1);
      return lerp(v0, v1, u * u * (3 - 2 * u));
    }
  }
  return keys[keys.length - 1][1];
}
