/**
 * Practice choreography: the scene setup, the delivery's BallFlight and (once known) its DeliveryResult become one
 * BallScript, the same model the match renderer draws (so the stadium, players, ball, stumps and effects are the
 * one renderer's). Everything the physics decided is taken as given: the ball follows the physics samples, the bat
 * the physics bat, fielders their FielderPaths; the choreography only adds what the physics does not model (the
 * bowler's run-up and action, the umpires, the batters' running, the keeper's take). Pure and deterministic.
 */
import type { BowlerAction, DeliveryFamily } from '@/contracts';
import type {
  BallFlight,
  BallSample,
  BowlerProfile,
  DeliveryResult,
  DeliveryVariation,
  Fielder,
  FielderAction,
  FielderPath,
  Vec3 as PVec3,
} from '@/contracts/practice';
import type { ActorTrack, Look, Move } from '../core/actors';
import { bowlerRun, type BallScript, type BallSeg } from '../core/choreo';
import { type ClipId, clipDuration, clipMarker } from '../core/clips';
import { NON_STRIKER_POS, PITCH_HALF, POPPING, RELEASE, SQUARE_UMPIRE_POS, UMPIRE_POS } from '../core/ground';
import { type Vec3, clamp, hash32, headingOf, v3 } from '../core/math';
import { seamSpin } from '../core/trajectory';
import { batterBody, batTravelMs } from '@/physics/bat';
import { type BatTrack, PROVISIONAL_TRAVEL_MS, reachable } from './bat';
import { feedbackCues, sceneEventsOf, type FeedbackCue } from './feedback';
import { ballAt, ballVelocityAt, simToScene, toWorld } from './frame';
import type { PracticeSceneSetup } from './types';

// ---------------------------------------------------------------------------------------------------------------
// The data the practice cameras, the bat and the overlays read
// ---------------------------------------------------------------------------------------------------------------

export interface PracticeInfo {
  /** A left-hander: physics positions are mirrored back for drawing. */
  mirror: boolean;
  /** The batter's eye (world): in the physics stance head, 1.65–1.75 m above the crease. */
  eye: Vec3;
  /** Scene ms of the release (simulation t = 0). */
  releaseScene: number;
  /** Where the ball leaves the hand (world): the first-person gaze is set on it. */
  releaseWorld: Vec3;
  flight: BallFlight | null;
  result: DeliveryResult | null;
  bat: BatTrack;
  /** Scene ms of the bat, edge, pad or body contact, else null. */
  contactScene: number | null;
  /** First person until this scene time (Infinity: stay first-person), then the external camera. */
  firstPersonUntil: number;
  external: 'fielding' | 'stumps' | 'none';
  /** Learn assistance: where the ball pitches (world), from the release on. */
  landing: Vec3 | null;
  variation: DeliveryVariation | null;
  action: BowlerAction;
  /** The bowler bowls left-arm (its clips play mirrored). */
  bowlerLeftArm: boolean;
  cues: FeedbackCue[];
  deadScene: number | null;
  /** Actors the first-person camera does not draw (the batter's own body). */
  firstPersonHidden: string[];
}

// ---------------------------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------------------------

/** Run-up: a moment at the top of the mark, then at most this much visible run-up (ms), so every ball comes quickly. */
export const PRACTICE_RUN = { preMs: 300, maxRunMs: { pace: 1500, spin: 900 } } as const;
/** First person holds this long after the bat meets the ball (the gentle head-follow), then the fielding camera. */
export const HEAD_FOLLOW_MS = 450;
/** After the stumps are hit, first person holds this long before the camera shows the broken wicket. */
export const BOWLED_HOLD_MS = 160;
/** Scene kept after dead ball (the camera holds while the coaching shows). */
export const AFTER_DEAD_MS = 6000;
/** The physics batter in the stance (src/physics/bat.ts batterBody): the same body the pad and LBW collisions use. */
const STANCE_BODY = batterBody(null);
/** The batter's stance root (physics frame): the centre between the feet. */
export const STANCE_ROOT: Vec3 = v3(STANCE_BODY.stance.x, 0, STANCE_BODY.stance.z);
/** The eye sits this far above the physics head's centre, and always inside the brief's 1.65–1.75 m. */
export const EYE_ABOVE_HEAD_CENTRE = 0.06;
export const EYE_HEIGHT_RANGE = [1.65, 1.75] as const;

/** The batter's eye (world) for a handedness: in the physics stance head. */
export function batterEye(mirror: boolean): Vec3 {
  const h = STANCE_BODY.head.c;
  return toWorld(v3(h.x, clamp(h.y + EYE_ABOVE_HEAD_CENTRE, EYE_HEIGHT_RANGE[0], EYE_HEIGHT_RANGE[1]), h.z), mirror);
}
const CREASE_Z = PITCH_HALF - POPPING;

/**
 * Bowling hand at the release marker, relative to the bowler's root at heading 0 (right arm, rig scale 1). The 3D
 * stage measures the real rig and passes its own; these defaults keep the 2D stage and tests close.
 */
export const NOMINAL_RELEASE_HAND: Record<BowlerAction, Vec3> = {
  pace_long: v3(-0.27, 2.12, 0.34),
  pace_short: v3(-0.27, 2.1, 0.32),
  swing_side_on: v3(-0.25, 2.1, 0.33),
  spin_off: v3(-0.24, 2.0, 0.3),
  spin_leg: v3(-0.24, 2.02, 0.3),
};

// ---------------------------------------------------------------------------------------------------------------
// Bowler
// ---------------------------------------------------------------------------------------------------------------

/** One action per bowler for the whole over: the family and pace show, the variation does not. */
export function practiceAction(b: BowlerProfile): BowlerAction {
  if (b.family === 'spin') return b.spinType === 'wrist' ? 'spin_leg' : 'spin_off';
  if (b.paceBand === 'express') return 'pace_long';
  if (b.paceBand === 'controlled') return 'swing_side_on';
  return hash32(b.lookSeed) % 2 ? 'pace_long' : 'pace_short';
}

export const familyOf = (b: BowlerProfile): DeliveryFamily => (b.family === 'spin' ? 'spin' : 'pace');

function runOptions(b: BowlerProfile) {
  return { preMs: PRACTICE_RUN.preMs, maxRunMs: b.family === 'spin' ? PRACTICE_RUN.maxRunMs.spin : PRACTICE_RUN.maxRunMs.pace };
}

/** Scene ms from the start of the run-up to the release, for a bowler (the same for every ball of the over). */
export function practiceReleaseScene(b: BowlerProfile): number {
  return bowlerRun({ action: practiceAction(b), look: { seed: b.lookSeed, team: 1, gear: 'bowler' }, ...runOptions(b) }).release;
}

/**
 * The release point before a flight is known (world). Over the wicket the bowling arm is next to the stumps, so in
 * the real world it depends only on the real arm (the physics frame mirrors it for a left-hander, and drawing
 * mirrors it back).
 */
function nominalRelease(b: BowlerProfile): Vec3 {
  return v3(b.arm === 'left' ? -RELEASE.x : RELEASE.x, RELEASE.y, RELEASE.z);
}

// ---------------------------------------------------------------------------------------------------------------
// Looks
// ---------------------------------------------------------------------------------------------------------------

export interface PracticeCast {
  bowler: Look;
  striker: Look;
  nonStriker: Look;
  keeper: Look;
  fielder(id: string): Look;
  umpires: [Look, Look];
}

export function practiceCast(b: BowlerProfile): PracticeCast {
  return {
    bowler: { seed: b.lookSeed, team: 1, gear: 'bowler', hero: true },
    striker: { seed: 'practice:batter', team: 0, gear: 'batter', hero: true },
    nonStriker: { seed: 'practice:partner', team: 0, gear: 'batter' },
    keeper: { seed: `${b.lookSeed}:keeper`, team: 1, gear: 'keeper' },
    fielder: (id) => ({ seed: `${b.lookSeed}:${id}`, team: 1, gear: 'fielder' }),
    umpires: [
      { seed: `umpire:${b.lookSeed}:0`, team: 0, gear: 'umpire' },
      { seed: `umpire:${b.lookSeed}:1`, team: 0, gear: 'umpire' },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Fielder paths → actor moves
// ---------------------------------------------------------------------------------------------------------------

const ACTION_CLIP: Record<FielderAction, ClipId> = {
  set: 'ready',
  run: 'run',
  dive: 'dive',
  catch: 'catch_chest',
  drop: 'catch_chest',
  pickup: 'pickup',
  throw: 'throw',
  celebrate: 'celebrate_jump',
  idle: 'idle',
};

/** One-shot clips play once from the segment start; looping ones keep their phase. */
const ONE_SHOT = new Set<FielderAction>(['dive', 'catch', 'drop', 'pickup', 'throw', 'celebrate']);

/**
 * Moves that follow a FielderPath from scene time `from` on (positions in world). Runs keep their stride phase
 * across samples; one-shot actions (dive, catch, pickup, throw, celebrate) play once; a catch above head height
 * uses the high catch.
 */
export function pathMoves(path: FielderPath, mirror: boolean, releaseScene: number, opts: { catchHigh?: boolean; faceTowards?: (t: number) => Vec3 | null } = {}): Move[] {
  const tb = { releaseScene };
  const s = [...path.samples].sort((a, b) => a.t - b.t);
  const moves: Move[] = [];
  let runPhase = 0;
  let i = 0;
  while (i < s.length) {
    const action = s[i].action;
    let j = i;
    while (j + 1 < s.length && s[j + 1].action === action) j++;
    const segEnd = j + 1 < s.length ? j + 1 : j;
    const clip: ClipId = action === 'catch' && opts.catchHigh ? 'catch_high' : ACTION_CLIP[action];
    const t0 = simToScene(tb, s[i].t);
    if (ONE_SHOT.has(action)) {
      const from = toWorld(v3(s[i].x, 0, s[i].z), mirror);
      const to = toWorld(v3(s[segEnd].x, 0, s[segEnd].z), mirror);
      const t1 = Math.max(t0 + 1, simToScene(tb, s[segEnd].t), t0 + (action === 'throw' || action === 'celebrate' ? clipDuration(clip) * 1000 : 0));
      const face = opts.faceTowards?.(s[i].t);
      const heading = face ? headingOf(face.x - from.x, face.z - from.z) : undefined;
      moves.push({ t0, t1, clip, from, to, blend: 90, ...(heading !== undefined ? { heading } : {}) });
    } else {
      for (let k = i; k < segEnd || k === i; k++) {
        const a = s[k];
        const b = s[Math.min(k + 1, segEnd)];
        const from = toWorld(v3(a.x, 0, a.z), mirror);
        const to = toWorld(v3(b.x, 0, b.z), mirror);
        const ta = simToScene(tb, a.t);
        const tbScene = Math.max(ta + 1, simToScene(tb, b.t));
        const speed = Math.hypot(to.x - from.x, to.z - from.z) / Math.max(0.001, (tbScene - ta) / 1000);
        const running = action === 'run';
        const rate = running ? clamp(speed / 7, 0.45, 1.25) : 1;
        const face = !running ? opts.faceTowards?.(a.t) : null;
        moves.push({
          t0: ta,
          t1: tbScene,
          clip,
          from,
          to,
          rate,
          clipStart: running ? runPhase : undefined,
          blend: k === i ? 140 : 0,
          ...(face ? { heading: headingOf(face.x - from.x, face.z - from.z) } : {}),
        });
        if (running) runPhase += ((tbScene - ta) / 1000) * rate;
        if (b === a) break;
      }
      if (action !== 'run') runPhase = 0;
    }
    i = j + 1;
  }
  return moves;
}

// ---------------------------------------------------------------------------------------------------------------
// The batter's stroke (presentation: the physics bat is drawn regardless)
// ---------------------------------------------------------------------------------------------------------------

const FOOT_CLIP = { forward: 'foot_forward', back: 'foot_back', across: 'foot_across', down_track: 'foot_charge' } as const;

/**
 * A legitimate stroke animation for the swing and the delivery: the upper body from the swing and the line and
 * length, the stride from the footwork the physics actually played (never the swing's 'auto'). It never changes
 * where the ball goes: the drawn bat is the physics bat.
 */
export function strokeFor(result: DeliveryResult): { clip: ClipId; lower: ClipId } {
  const swing = result.swing;
  const lengthM = result.flight.bounce ? PITCH_HALF - result.flight.bounce.p.z : 0;
  const short = lengthM > 6.5;
  const stride: ClipId = FOOT_CLIP[result.footwork] ?? 'foot_still';
  if (!swing) return { clip: 'bat_leave', lower: 'foot_still' };
  if (swing.kind === 'defend') return { clip: 'bat_block', lower: stride };
  const d = swing.directionDeg;
  if (swing.elevation >= 0.45) return { clip: 'bat_loft', lower: stride };
  if (d > 65 && d < 130) return { clip: 'bat_cut', lower: stride };
  if (d < -45 && short) return { clip: 'bat_pull', lower: stride };
  if (d < -95 && !short && result.footwork === 'forward') return { clip: 'bat_sweep', lower: 'foot_sweep' };
  if (Math.abs(d) <= 50 && !short) return { clip: 'bat_drive', lower: stride };
  return { clip: 'bat_push', lower: stride };
}

// ---------------------------------------------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------------------------------------------

export interface PracticeBuildInput {
  setup: PracticeSceneSetup;
  /** The delivery (null: the scene between balls). */
  flight: BallFlight | null;
  result?: DeliveryResult | null;
  /** Scene ms the provisional swing started (live only). */
  provisionalStart?: number | null;
  /** Scene ms the result arrived (live only; replays leave it out and draw the physics bat alone). */
  resultAt?: number | null;
  learnCue?: boolean;
  /** Bowling hand at release relative to the bowler's root (actor frame, right arm, the rig's own scale). */
  releaseHand?: Vec3;
  /** Length of the between-balls scene (ms). */
  idleMs?: number;
  /** Between balls, the bowler runs in and bowls with the ball still in hand (the benchmark's scene). */
  runUp?: boolean;
}

const HALF_PI = Math.PI / 2;

function firstEvent<K extends DeliveryResult['events'][number]['kind']>(r: DeliveryResult, kind: K): Extract<DeliveryResult['events'][number], { kind: K }> | undefined {
  return r.events.find((e) => e.kind === kind) as Extract<DeliveryResult['events'][number], { kind: K }> | undefined;
}

/** Builds the Practice scene at one moment of knowledge: between balls, mid-delivery, or with the result. */
export function buildPracticeScript(input: PracticeBuildInput): BallScript {
  const { setup, flight } = input;
  const result = input.result ?? null;
  const mirror = setup.handedness === 'left';
  const bowler = setup.bowler;
  const action = practiceAction(bowler);
  const family = familyOf(bowler);
  const cast = practiceCast(bowler);
  const leftArm = bowler.arm === 'left';
  const releaseWorld = flight ? toWorld(flight.release.p, mirror) : nominalRelease(bowler);
  const hand = input.releaseHand ?? NOMINAL_RELEASE_HAND[action];
  const handX = leftArm ? -hand.x : hand.x;
  const releaseRoot = v3(releaseWorld.x - handX, 0, releaseWorld.z - hand.z);
  const actors: ActorTrack[] = [];
  const balls: BallSeg[] = [];
  const idle = !flight;

  // Bowler: at the top of the mark between balls; otherwise the run-up, the action and the follow-through.
  const run = bowlerRun({ action, look: cast.bowler, releaseRoot, mirror: leftArm, ...runOptions(bowler) });
  const releaseScene = run.release;
  const duration = idle
    ? (input.idleMs ?? 60_000)
    : result
      ? Math.max(simToScene({ releaseScene }, result.deadT) + AFTER_DEAD_MS, releaseScene + 4000)
      : releaseScene + Math.max(4000, ((flight.samples.at(-1)?.t ?? 1) + 2.5) * 1000);
  if (idle && !input.runUp) {
    actors.push({ ...run.track, moves: [{ t0: 0, t1: duration, clip: 'idle', heading: run.track.moves[0].heading }] });
  } else actors.push(run.track);
  const bowlerTrack = actors[0];

  // Fielders (the keeper and the bowler have their own tracks).
  const paths = new Map<string, FielderPath>((result?.fielders ?? []).map((p) => [p.fielderId, p]));
  const keeperField = setup.field.fielders.find((f) => f.role === 'keeper');
  const bowlerField = setup.field.fielders.find((f) => f.role === 'bowler');
  const striker = toWorld(v3(0, 0, CREASE_Z), mirror);
  const catchEvent = result ? firstEvent(result, 'catch') : undefined;
  const ballFace = (t: number): Vec3 | null => {
    if (!result) return null;
    const p = ballAt(result.ball, t);
    return p ? toWorld(p, mirror) : null;
  };
  const fielderTrack = (f: Fielder, id: string, look: Look, before: ClipId): ActorTrack => {
    const pos = toWorld(v3(f.x, 0, f.z), mirror);
    const facing = headingOf(striker.x - pos.x, striker.z - pos.z);
    const moves: Move[] = idle
      ? [{ t0: 0, t1: duration, clip: before === 'keep_crouch' ? 'keep_crouch' : 'idle', heading: facing, clipStart: (hash32(id) % 1000) / 500 }]
      : [
          { t0: 0, t1: Math.max(1, releaseScene - 700), clip: before === 'keep_crouch' ? 'keep_crouch' : 'idle', heading: facing },
          { t0: Math.max(1, releaseScene - 700), t1: duration, clip: before, heading: facing, blend: 260 },
        ];
    const path = paths.get(f.id);
    if (path && !idle) {
      const pm = pathMoves(path, mirror, releaseScene, { catchHigh: catchEvent?.fielderId === f.id && catchEvent.p.y > 1.9, faceTowards: ballFace });
      if (pm.length) {
        const cut = pm[0].t0;
        const kept = moves.filter((m) => m.t0 < cut).map((m) => ({ ...m, t1: Math.min(m.t1, cut) }));
        moves.splice(0, moves.length, ...kept, ...pm);
        const last = moves[moves.length - 1];
        if (last.t1 < duration) moves.push({ t0: last.t1, t1: duration, clip: 'idle', blend: 300 });
      }
    }
    return { id, role: id === 'keeper' ? 'keeper' : 'fielder', look, start: pos, heading: facing, moves };
  };
  for (const f of setup.field.fielders) {
    if (f.role === 'bowler') continue;
    if (f.role === 'keeper') actors.push(fielderTrack(f, 'keeper', cast.keeper, 'keep_crouch'));
    else actors.push(fielderTrack(f, `fielder:${f.id}`, cast.fielder(f.id), 'ready'));
  }
  // The bowler fields its own bowling when the physics sends it after the ball.
  if (result && bowlerField) {
    const path = paths.get(bowlerField.id);
    if (path) {
      const pm = pathMoves(path, mirror, releaseScene, { catchHigh: catchEvent?.fielderId === bowlerField.id && catchEvent.p.y > 1.9, faceTowards: ballFace }).filter((m) => m.t0 >= run.deliveryEnd - 150);
      if (pm.length) bowlerTrack.moves.push(...pm);
    }
  }

  // The keeper takes the ball when the physics says so (unless its own path already covers it).
  const take = result ? firstEvent(result, 'keeper_take') : undefined;
  const keeper = actors.find((a) => a.id === 'keeper');
  if (keeper && take && !paths.has(keeperField?.id ?? '')) {
    const at = simToScene({ releaseScene }, take.t) - clipMarker('keep_take', 'catch', 0.3) * 1000;
    keeper.moves = keeper.moves.filter((m) => m.t0 < at).map((m) => ({ ...m, t1: Math.min(m.t1, at) }));
    keeper.moves.push({ t0: at, t1: at + 1000, clip: 'keep_take', blend: 80 }, { t0: at + 1000, t1: duration, clip: 'idle', blend: 300 });
  }

  // Batters: the striker (hidden from the first-person camera) and a running partner at the other end.
  const stanceWorld = toWorld(STANCE_ROOT, mirror);
  const strikerTrack: ActorTrack = {
    id: 'striker',
    role: 'batter',
    look: cast.striker,
    start: stanceWorld,
    heading: mirror ? -HALF_PI : HALF_PI,
    ...(mirror ? { mirror: true } : {}),
    moves: [{ t0: 0, t1: duration, clip: 'stance' }],
  };
  const nsStart = toWorld(NON_STRIKER_POS, mirror);
  const nsTrack: ActorTrack = {
    id: 'nonStriker',
    role: 'batter',
    look: cast.nonStriker,
    start: nsStart,
    heading: 0,
    ...(mirror ? { mirror: true } : {}),
    moves: idle
      ? [{ t0: 0, t1: duration, clip: 'idle' }]
      : [
          { t0: 0, t1: Math.max(1, releaseScene - 500), clip: 'idle' },
          { t0: Math.max(1, releaseScene - 500), t1: releaseScene + 200, clip: 'walk', from: nsStart, to: toWorld(v3(NON_STRIKER_POS.x, 0, NON_STRIKER_POS.z + 1.1), mirror), rate: 0.9 },
          { t0: releaseScene + 200, t1: duration, clip: 'idle' },
        ],
  };
  actors.push(strikerTrack, nsTrack);
  actors.push(
    { id: 'umpire', role: 'umpire', look: cast.umpires[0], start: toWorld(UMPIRE_POS, mirror), heading: 0, moves: [{ t0: 0, t1: duration, clip: 'ump_stand' }] },
    { id: 'umpire2', role: 'umpire', look: cast.umpires[1], start: toWorld(SQUARE_UMPIRE_POS, mirror), heading: mirror ? -HALF_PI : HALF_PI, moves: [{ t0: 0, t1: duration, clip: 'ump_stand' }] },
  );

  // The ball: in the bowler's hand, then the physics path (the flight until the result is known, then the result).
  let cues: FeedbackCue[] = [];
  let contactScene: number | null = null;
  let firstPersonUntil = Number.POSITIVE_INFINITY;
  let external: PracticeInfo['external'] = 'none';
  let deadScene: number | null = null;
  const events: BallScript['events'] = [];
  const stumps: BallScript['stumps'] = { striker: null, nonStriker: null };
  const crowd: Array<[number, number]> = [[0, 0.34]];
  if (idle) {
    balls.push({ k: 'hand', t0: 0, t1: duration, actor: 'bowler' });
    crowd.push([duration, 0.36]);
  } else {
    const samples: readonly BallSample[] = result ? result.ball : flight.samples;
    balls.push({ k: 'hand', t0: 0, t1: releaseScene, actor: 'bowler' });
    // The release spin until the pitch, then the spin it comes off the pitch with.
    const bounceAt = flight.bounce && flight.spin.afterBounce ? simToScene({ releaseScene }, flight.bounce.t) : duration;
    balls.push({ k: 'path', t0: releaseScene, t1: bounceAt, samples, release: releaseScene, mirror, ...seamSpin(flight.spin.release, family, mirror) });
    if (bounceAt < duration && flight.spin.afterBounce) balls.push({ k: 'path', t0: bounceAt, t1: duration, samples, release: releaseScene, mirror, ...seamSpin(flight.spin.afterBounce, family, mirror) });
    crowd.push([Math.max(1, releaseScene - 200), 0.46]);
    if (!result) {
      // Until the result lands, the delivery's own events (release, pitch) still sound on time.
      events.push({ t: releaseScene, kind: 'release', intensity: Math.min(1.1, flight.release.speedKph / 150) });
      if (flight.bounce) events.push({ t: simToScene({ releaseScene }, flight.bounce.t), kind: 'bounce', intensity: 0.6, at: toWorld(flight.bounce.p, mirror) });
    } else {
      cues = feedbackCues(result, releaseScene, mirror);
      events.push(...sceneEventsOf(cues));
      deadScene = simToScene({ releaseScene }, result.deadT);
      const c = result.contact;
      const touched = c.t !== null && c.kind !== 'miss' && c.kind !== 'leave';
      contactScene = touched ? simToScene({ releaseScene }, c.t!) : null;
      const stumpsHit = firstEvent(result, 'stumps');
      if (stumpsHit) {
        const at = simToScene({ releaseScene }, stumpsHit.t);
        const vel = ballVelocityAt(result.ball, stumpsHit.t) ?? { x: 0, y: 0, z: 1 };
        const dir = toWorld(vel as PVec3, mirror);
        const l = Math.hypot(dir.x, dir.z) || 1;
        stumps.striker = { t: at, dir: v3(dir.x / l, 0, dir.z / l), strength: 1 };
        firstPersonUntil = at + BOWLED_HOLD_MS;
        external = 'stumps';
      } else if (touched && (c.kind === 'middle' || c.kind.endsWith('_edge'))) {
        firstPersonUntil = contactScene! + HEAD_FOLLOW_MS;
        external = 'fielding';
      }
      // Batters: the stroke, aligned so its contact marker meets the physics contact (or the ideal moment).
      if (result.swing) {
        const { clip, lower } = strokeFor(result);
        const meet = simToScene({ releaseScene }, c.t ?? result.flight.idealContactT);
        const start = Math.max(releaseScene, meet - clipMarker(clip, 'contact', 0.45) * 1000);
        strikerTrack.moves = [
          { t0: 0, t1: start, clip: 'stance' },
          { t0: start, t1: start + clipDuration(clip) * 1000, clip, lower, blend: 90 },
          { t0: start + clipDuration(clip) * 1000, t1: duration, clip: 'idle', blend: 300 },
        ];
      }
      const runs = result.events.filter((e): e is Extract<DeliveryResult['events'][number], { kind: 'run' }> => e.kind === 'run').sort((a, b) => a.t - b.t);
      if (runs.length) {
        const laneS = toWorld(v3(1.25, 0, 0), mirror).x;
        const laneN = -laneS;
        let t = (contactScene ?? releaseScene + 600) + 300;
        let sAt = v3(laneS, 0, CREASE_Z - 0.4);
        let nAt = v3(laneN, 0, -CREASE_Z + 1.2);
        const sMoves: Move[] = [{ t0: t, t1: t + 380, clip: 'bat_run', from: stanceWorld, to: sAt }];
        const nMoves: Move[] = [{ t0: t, t1: t + 380, clip: 'bat_run', from: toWorld(v3(NON_STRIKER_POS.x, 0, NON_STRIKER_POS.z + 1.1), mirror), to: nAt }];
        t += 380;
        runs.forEach((r, k) => {
          const end = Math.max(t + 600, simToScene({ releaseScene }, r.t));
          const sTo = v3(laneS, 0, k % 2 === 0 ? -CREASE_Z - 0.3 : CREASE_Z + 0.3);
          const nTo = v3(laneN, 0, k % 2 === 0 ? CREASE_Z + 0.3 : -CREASE_Z - 0.3);
          sMoves.push({ t0: t, t1: end, clip: 'bat_run', from: sAt, to: sTo, ease: 'inOut', blend: 0 });
          nMoves.push({ t0: t, t1: end, clip: 'bat_run', from: nAt, to: nTo, ease: 'inOut', blend: 0 });
          sAt = sTo;
          nAt = nTo;
          t = end + 120;
        });
        sMoves.push({ t0: t, t1: duration, clip: 'idle', blend: 260, headingTo: sAt.z > 0 ? Math.PI : 0 });
        nMoves.push({ t0: t, t1: duration, clip: 'idle', blend: 260, headingTo: nAt.z > 0 ? Math.PI : 0 });
        strikerTrack.moves = strikerTrack.moves.filter((m) => m.t0 < sMoves[0].t0).map((m) => ({ ...m, t1: Math.min(m.t1, sMoves[0].t0) }));
        strikerTrack.moves.push(...sMoves);
        nsTrack.moves = nsTrack.moves.filter((m) => m.t0 < nMoves[0].t0).map((m) => ({ ...m, t1: Math.min(m.t1, nMoves[0].t0) }));
        nsTrack.moves.push(...nMoves);
      }
      // Umpire signals and the crowd.
      const boundary = firstEvent(result, 'boundary');
      const dismissal = result.outcome.dismissal;
      const umpire = actors.find((a) => a.id === 'umpire')!;
      if (boundary) {
        const at = simToScene({ releaseScene }, boundary.t);
        crowd.push([at, 0.96], [at + 3500, 0.62]);
        umpire.moves = [{ t0: 0, t1: at + 600, clip: 'ump_stand' }, { t0: at + 600, t1: duration, clip: boundary.runs === 6 ? 'ump_six' : 'ump_four', blend: 200 }];
      } else if (dismissal) {
        const at = simToScene({ releaseScene }, (stumpsHit ?? catchEvent)?.t ?? result.deadT);
        crowd.push([at, 0.92], [at + 3500, 0.6]);
        if (dismissal !== 'bowled') umpire.moves = [{ t0: 0, t1: at + 900, clip: 'ump_stand' }, { t0: at + 900, t1: duration, clip: 'ump_out', blend: 200 }];
      } else {
        if (contactScene !== null) crowd.push([contactScene, 0.5]);
        crowd.push([deadScene + 300, 0.4]);
      }
    }
    crowd.push([duration, 0.4]);
  }
  crowd.sort((a, b) => a[0] - b[0]);
  events.sort((a, b) => a.t - b.t);

  const aimSim = flight ? ballAt(flight.samples, flight.idealContactT) : null;
  const bat: BatTrack = {
    mirror,
    releaseScene,
    travelMs: result?.swing ? batTravelMs(result.swing.kind, result.swing.power) : PROVISIONAL_TRAVEL_MS,
    samples: result ? result.bat : null,
    provisionalStart: input.provisionalStart ?? null,
    aim: reachable(aimSim ?? v3(0.1, 0.5, CREASE_Z - 0.6)),
    resultAt: input.resultAt ?? null,
  };
  const practice: PracticeInfo = {
    mirror,
    eye: batterEye(mirror),
    releaseScene,
    releaseWorld,
    flight,
    result,
    bat,
    contactScene,
    firstPersonUntil,
    external,
    landing: input.learnCue && flight?.bounce ? toWorld(flight.bounce.p, mirror) : null,
    variation: flight ? flight.plan.variation : null,
    action,
    bowlerLeftArm: leftArm,
    cues,
    deadScene,
    firstPersonHidden: ['striker'],
  };
  const contact = contactScene ?? (flight ? simToScene({ releaseScene }, flight.idealContactT) : duration);
  const bounceScene = flight?.bounce ? simToScene({ releaseScene }, flight.bounce.t) : contact;
  return {
    kind: 'live',
    duration,
    family,
    bowlerAction: action,
    ball: balls,
    actors,
    stumps,
    events,
    overlay: [],
    crowd,
    slowMo: null,
    cameras: null,
    times: { runStart: run.runStart, release: releaseScene, bounce: bounceScene, contact, decisive: deadScene ?? contact, shotEnd: contact, celebrate: null, end: duration },
    fate: { kind: 'live' },
    celebration: 'none',
    heroes: [],
    shotBearing: result?.contact.exitBearingDeg !== null && result?.contact.exitBearingDeg !== undefined ? (mirror ? -result.contact.exitBearingDeg : result.contact.exitBearingDeg) : null,
    sealAt: null,
    practice,
  };
}

