/**
 * The batter's bat as drawn: the stance, the touch-down stroke when the finger lands (owner decision 2026-11-04, CTL1:
 * the bat starts moving at touch-down, the shot commits on lift), the provisional swing once a gesture commits, and
 * the physics bat once the result arrives. The
 * provisional swing is presentation only: a straight-bat downswing towards where the ball will be, which every
 * stroke shares in its first part. When the result lands, the drawn bat blends into the physics bat within
 * BLEND_MS, and from then on (contact included) it IS the physics bat. Replays draw the physics bat alone.
 * Positions are in the physics (striker's own) frame unless a name says world.
 */
import type { BallSample, BatSample, Vec3 } from '@/contracts/practice';
import type { OneGestureState } from '@/input';
import { BLADE_L, HANDLE_L, LOWER_HAND_FROM_CAP, SWEET_U, TOP_HAND_FROM_CAP } from '@/physics/constants';
import { batTravelMs } from '@/physics/bat';
import { ballAt, batAt, batToWorld, blendBat, sceneToSim, toWorld, type BatPose } from './frame';
import { evaluateActor, type ActorTrack } from '../core/actors';
import { CARRY_BAT_KEY, createPose, mirrorSampledPose, samplePresented } from '../core/clips';

/**
 * Provisional swing: stance to the hitting area in the physics bat's own travel time for a tap (batTravelMs: 120 ms;
 * an attack is 120 + 30·power). The kind and power are unknown at the press, so the provisional swing is a tap's;
 * the result's own bat track takes over within BLEND_MS of arriving.
 */
export const PROVISIONAL_TRAVEL_MS = batTravelMs('defend', 0);
/** Provisional follow-through after the hitting area. */
const PROVISIONAL_FOLLOW_MS = 220;
/** Provisional → physics bat. */
const BLEND_MS = 45;
/** No result for a swing (e.g. it was not usable): back to the stance. */
const RETURN_MS = 180;
/** A raw press acknowledges the grip only: lift at most 2 cm, then settle back without a stroke. */
const READY_CUE = { riseMs: 45, holdUntilMs: 160, endMs: 280, liftM: 0.02 } as const;

/**
 * The touch-down stroke (owner decision 2026-11-04, CTL1). The press is the input: from its calibrated instant (the
 * same instant a tap's physics swing starts) the bat starts at once towards the tap's straight-bat hitting pose (the
 * provisional swing's pose in the hitting area): a rigid move (the hands straight, the blade turning about them)
 * between two fixed poses, so it can never flip. Until the gesture commits it goes at most `reach` of the way, by
 * `reach`·travel/`capMs`, where travel = `capMs`·tanh(t/`capMs`) (real time at first, never past the cap), so an
 * uncommitted press never draws the bat at the ball. When the commitment arrives (a tap's lift, a swipe, a key) the drawn bat joins the committed swing over
 * `commitMs`, complete by contact. A press that outlives the tap window, or turns into a pullback or is cancelled,
 * checks back to the waiting (or loaded) pose over `checkMs`. Presentation only: the physics, the stride and the
 * result are untouched.
 *
 * Clearance (honesty): while uncommitted, the drawn bat (presented and first person) never comes within `clearM` of
 * the ball's centre (the ball's radius plus half the blade is 0.09 m) unless the bat with no input is at least as
 * near at that moment: an uncommitted press never draws a contact the waiting bat would not. When the capped stroke
 * would, it is drawn less far along (the most travel that keeps clear, by bisection), and when even its start would
 * not, the bat is drawn exactly as with no input (TouchStroke.ball; tests/unit/render3d/touchdown-bat).
 */
export const TOUCHDOWN = { capMs: 50, reach: 0.35, commitMs: 40, checkMs: 120, clearM: 0.15 } as const;

/** Live only: the touch-down stroke of the current delivery (scene ms). */
export interface TouchStroke {
  /** The calibrated press: the stroke starts here (never before the touch; a tap's physics swing starts here too). */
  start: number;
  /** Uncommitted, it checks back from here: the tap window's end, or earlier when a pullback or cancellation came. */
  end: number;
  /** When the commitment (beginSwing) arrived on the scene clock, or null while uncommitted. */
  commitAt: number | null;
  /** The contact state as it stood before the commitment (keeps a load drawn while the commitment blends in). */
  state: OneGestureState | null;
  /** The live delivery's ball (the flight's samples, physics frame): the uncommitted stroke keeps clear of it. */
  ball?: readonly BallSample[] | null;
}

/** How far along the tap's provisional swing (ms of its travel) the uncommitted stroke is `ms` after it started. */
export function touchdownTravel(ms: number): number {
  return ms <= 0 ? 0 : TOUCHDOWN.capMs * Math.tanh(ms / TOUCHDOWN.capMs);
}

/** Distance from the top of the handle to the toe and to the sweet spot (metres), from the physics bat. */
export const BAT_LENGTH = HANDLE_L + BLADE_L;
const SWEET_FROM_GRIP = HANDLE_L + BLADE_L * (1 - SWEET_U);
/** Waiting stance, bat up in a modest backlift (right-handed physics frame). */
export const STANCE: BatPose = {
  grip: { x: -0.1, y: 1.08, z: 9.02 },
  toe: { x: 0.02, y: 1.62, z: 9.62 },
  face: { x: 0.18, y: -0.62, z: -0.76 },
};

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const add = (a: Vec3, b: Vec3): Vec3 => v(a.x + b.x, a.y + b.y, a.z + b.z);
const lerp = (a: Vec3, b: Vec3, u: number): Vec3 =>
  v(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u);
const smooth = (u: number) => {
  const x = u < 0 ? 0 : u > 1 ? 1 : u;
  return x * x * (3 - 2 * x);
};
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return v(a.x / l, a.y / l, a.z / l);
};

/** Bounded ready-grip motion. It never aims at the ball or progresses into a downswing. */
function readyPose(ms: number): BatPose {
  const lift =
    ms <= 0 || ms >= READY_CUE.endMs
      ? 0
      : Math.sin((Math.min(1, ms / READY_CUE.riseMs) * Math.PI) / 2) *
        (1 - smooth((ms - READY_CUE.holdUntilMs) / (READY_CUE.endMs - READY_CUE.holdUntilMs))) *
        READY_CUE.liftM;
  return { grip: add(STANCE.grip, v(0, lift, 0)), toe: add(STANCE.toe, v(0, lift, 0)), face: { ...STANCE.face } };
}

/**
 * Presentation-only loaded stance derived from the canonical one-contact read. It is deliberately bounded: the
 * contact state can move the visible bat, but it cannot choose a shot, move the ball or alter the physics bat.
 */
export function loadedPose(state: OneGestureState): BatPose {
  const pull = clamp(state.pullbackIntent, 0, 1);
  const lateral = clamp(state.lateralAdjustment, -1, 1);
  const lift = 0.03 + 0.19 * pull;
  const grip = add(STANCE.grip, v(lateral * 0.14, lift * 0.36, pull * 0.045));
  const toe = add(STANCE.toe, v(lateral * 0.22, lift, pull * 0.14));
  const face = norm(add(STANCE.face, v(lateral * 0.1, -state.elevationIntent * 0.08, 0)));
  return { grip, toe, face };
}

/** Where a straight bat can meet the ball (physics frame), from the ball's position near the batter. */
export function reachable(ball: Vec3): Vec3 {
  return v(clamp(ball.x, -0.25, 0.95), clamp(ball.y, 0.06, 1.35), clamp(ball.z, 7.3, 9.1));
}

/** The provisional straight-bat swing at `ms` after it began, aimed at `aim` (physics frame). */
export function provisionalPose(ms: number, aim: Vec3, state: OneGestureState | null = null): BatPose {
  const origin = state ? loadedPose(state) : STANCE;
  const bearing = ((state?.forwardBearingDeg ?? 0) * Math.PI) / 180;
  // Only committed forward evidence is power. A deep load may raise aggression/elevation intent, but never invents
  // forward power before the canonical tracker measures it.
  const power = clamp(state?.pathPower ?? 0, 0, 1);
  const elevation = clamp(state?.elevationIntent ?? 0, 0, 1);
  const dirAtContact = norm(v(0.05, -0.97, -0.25));
  const contactGrip = add(
    aim,
    v(-dirAtContact.x * SWEET_FROM_GRIP, -dirAtContact.y * SWEET_FROM_GRIP, -dirAtContact.z * SWEET_FROM_GRIP),
  );
  const contactToe = add(
    contactGrip,
    v(dirAtContact.x * BAT_LENGTH, dirAtContact.y * BAT_LENGTH, dirAtContact.z * BAT_LENGTH),
  );
  const contact: BatPose = {
    grip: contactGrip,
    toe: contactToe,
    face: norm(v(Math.sin(bearing) * 0.16, 0.12 + elevation * 0.06, -1)),
  };
  if (ms <= 0) return { grip: { ...origin.grip }, toe: { ...origin.toe }, face: { ...origin.face } };
  if (ms < PROVISIONAL_TRAVEL_MS) {
    // A quick start (ease-out): the bat answers the press visibly in the very next frame.
    const u = Math.sin((Math.min(1, ms / PROVISIONAL_TRAVEL_MS) * Math.PI) / 2);
    // Hands lead and the blade follows through a slight arc (the toe drops late, as in a real downswing).
    const lift = Math.sin(u * Math.PI) * 0.12;
    const grip = add(lerp(origin.grip, contact.grip, u), v(0, lift * 0.4, 0));
    const toe = add(lerp(origin.toe, contact.toe, u * u), v(0, lift, 0));
    return { grip, toe, face: norm(lerp(origin.face, contact.face, u)) };
  }
  const f = smooth((ms - PROVISIONAL_TRAVEL_MS) / PROVISIONAL_FOLLOW_MS);
  const lateral = Math.sin(bearing) * (0.24 + power * 0.34);
  const followGrip = add(aim, v(0.12 + lateral, 1.02 + elevation * 0.24, -0.3));
  const followToe = add(followGrip, v(0.25 + lateral * 0.42, 0.5 + elevation * 0.5, 0.55 + power * 0.18));
  return {
    grip: lerp(contact.grip, followGrip, f),
    toe: lerp(contact.toe, followToe, f),
    face: norm(lerp(contact.face, v(0.3, 0.7, -0.6), f)),
  };
}

/** Everything that decides the drawn bat at a scene time. Pure data: the stage replaces it when something changes. */
export interface BatTrack {
  mirror: boolean;
  releaseScene: number;
  /** The swing's travel to the hitting area (batTravelMs: 120 ms for a tap, 120 + 30·power for an attack). */
  travelMs: number;
  /** Physics bat samples (physics frame), once the result is known; empty for a leave. */
  samples: readonly BatSample[] | null;
  /** Raw press acknowledgement only. It cannot become a swing without beginSwing's committed intent. */
  readyAt?: number | null;
  /** Latest canonical one-contact state; presentation only and never an input to physics. */
  contactState?: OneGestureState | null;
  /** Scene ms the provisional swing started (the calibrated press), or null. */
  provisionalStart: number | null;
  /** Physics-frame point the provisional swing aims at. */
  aim: Vec3;
  /** Scene ms the result arrived (the provisional blends into it from here), or null (a replay: physics only). */
  resultAt: number | null;
  /** The actual physical contact on the scene clock. A provisional handoff must finish no later than this. */
  contactScene?: number | null;
  /** Blade/handle contact only: the one trace knot where velocity may reset across the collision impulse. */
  contactImpulseScene?: number | null;
  /** Authored body/stroke velocity peak. Playback uses it only while it precedes the physical impulse. */
  velocityPeakScene?: number | null;
  /** False between balls (no delivery is coming, so the batter never lifts into the backlift). Default true. */
  delivery?: boolean;
  /** Replays: scene ms of the player's input (the result's swing start); the visible swing starts there. */
  inputScene?: number | null;
  /** Live only: the touch-down stroke (TOUCHDOWN), from the press until the committed swing takes over. */
  touch?: TouchStroke | null;
}

/** The drawn bat (world frame) at scene time `scene`. */
export function batPoseAt(track: BatTrack, scene: number): BatPose {
  const contact = track.contactState ?? null;
  const prov =
    track.provisionalStart !== null ? provisionalPose(scene - track.provisionalStart, track.aim, contact) : null;
  let pose: BatPose;
  if (track.samples) {
    const contactT = track.contactImpulseScene == null ? null : sceneToSim(track, track.contactImpulseScene);
    const velocityPeakT = track.velocityPeakScene == null ? null : sceneToSim(track, track.velocityPeakScene);
    const phys = batAt(track.samples, sceneToSim(track, scene), contactT, velocityPeakT);
    if (phys) pose = phys;
    else if (prov && track.samples.length === 0) {
      // A swing the physics did not take (unusable input): back to the stance.
      const back = track.resultAt !== null ? smooth((scene - track.resultAt) / RETURN_MS) : 1;
      pose = blendBat(prov, STANCE, back);
    } else pose = STANCE;
    const blendEnd =
      track.resultAt === null ? null : Math.min(track.resultAt + BLEND_MS, track.contactScene ?? Infinity);
    if (
      prov &&
      track.resultAt !== null &&
      blendEnd !== null &&
      blendEnd > track.resultAt &&
      scene < blendEnd &&
      track.samples.length > 0
    ) {
      pose = blendBat(prov, pose, smooth((scene - track.resultAt) / (blendEnd - track.resultAt)));
    }
  } else if (prov) pose = prov;
  else if (contact && (contact.phase === 'loading' || contact.phase === 'tracking')) pose = loadedPose(contact);
  else pose = track.readyAt != null ? readyPose(scene - track.readyAt) : STANCE;
  return batToWorld(pose, track.mirror);
}

/**
 * Freezes a physics bat trace in place: the array and each sample's grip, toe and face. No value changes. `batAt`
 * (frame.ts) keeps one prepared track (the quintic knots of all the trace's segments) per trace, but only for a deeply
 * frozen trace. The physics freezes the trace it builds; a result that arrives from the physics worker has crossed
 * postMessage and is a thawed copy, for which every `batAt` call re-derived the whole track. A reach plan calls the
 * bat 200 times in one frame (a camera cut to the striker), so that frame cost 200 track builds (PERF1, I1:
 * `polynomialDerivatives` 276 ms, `prepareBatSegments` 112 ms in the long frames). Idempotent and O(samples).
 */
export function freezeBatTrace(samples: readonly BatSample[] | null | undefined): void {
  if (!samples) return;
  for (const sample of samples) {
    if (!Object.isFrozen(sample.grip)) Object.freeze(sample.grip);
    if (!Object.isFrozen(sample.toe)) Object.freeze(sample.toe);
    if (!Object.isFrozen(sample.face)) Object.freeze(sample.face);
    if (!Object.isFrozen(sample)) Object.freeze(sample);
  }
  if (!Object.isFrozen(samples)) Object.freeze(samples);
}

/**
 * True when the player's input visibly moves the drawn bat (CTL1's "first frame showing the bat moving"): the bat as
 * live play draws it (first person, the touch-down stroke included) differs by more than 2 mm, at the toe or the
 * grip, from the bat the same frame would draw with no input at all. A grip cue alone (READY_CUE) is not counted.
 */
export function batMoved(track: BatTrack, scene: number): boolean {
  const drawn = firstPersonBatPose(track, scene);
  const idle = firstPersonBatPose(inputFree(track), scene);
  const d = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  return Math.max(d(drawn.toe, idle.toe), d(drawn.grip, idle.grip)) > 0.002;
}

/** The same track with no input at all: what the bat would do if the player never touched the screen. */
function inputFree(track: BatTrack): BatTrack {
  return {
    ...track,
    touch: null,
    readyAt: null,
    contactState: null,
    provisionalStart: null,
    inputScene: null,
    samples: null,
    resultAt: null,
    contactScene: null,
    contactImpulseScene: null,
    velocityPeakScene: null,
  };
}

/** The track as it stood before the commitment: the touch-down stroke's waiting bat, without the committed swing. */
function uncommitted(track: BatTrack, touch: TouchStroke): BatTrack {
  return { ...inputFree(track), contactState: touch.state ?? track.contactState ?? null };
}

type PoseFn = (t: BatTrack, s: number) => BatPose;
const presentedOnly: PoseFn = (t, s) => presentedBatPose(t, s);
const firstPersonPresented: PoseFn = (t, s) => presentedBatPose(t, s, undefined, FIRST_PERSON_BACKLIFT);

/** The tap's provisional swing from the press: its timing drives the first-person lift (never a direction or a power). */
function strokeTrack(before: BatTrack, touch: TouchStroke): BatTrack {
  return { ...before, contactState: null, provisionalStart: touch.start, travelMs: PROVISIONAL_TRAVEL_MS };
}

/**
 * The uncommitted stroke `travel` ms along (world): from the no-input bat in this frame towards the tap's
 * straight-bat hitting pose, reach·travel/capMs of the way. At the press that is exactly the bat the player touched;
 * following the no-input origin afterwards also makes travel zero the honest waiting bat, so a clearance hold can
 * leave and rejoin the stroke without a pop while the ordinary backlift continues underneath it.
 */
function strokePose(before: BatTrack, scene: number, pose: PoseFn, travel: number): BatPose {
  const from = pose(before, scene);
  const hit = batToWorld(provisionalPose(PROVISIONAL_TRAVEL_MS, before.aim, null), before.mirror);
  return rigidBatBlend(from, hit, (TOUCHDOWN.reach * clamp(travel, 0, TOUCHDOWN.capMs)) / TOUCHDOWN.capMs);
}

/** The uncommitted drawing at `scene` with the stroke `travel` ms along (null: no stroke, the waiting bat). */
function uncommittedPose(
  before: BatTrack,
  touch: TouchStroke,
  scene: number,
  pose: PoseFn,
  travel: number | null,
): BatPose {
  const wait = pose(before, scene);
  if (scene <= touch.start || travel === null) return wait;
  const stroke = strokePose(before, scene, pose, travel);
  const back = scene > touch.end ? smooth((scene - touch.end) / TOUCHDOWN.checkMs) : 0;
  return back >= 1 ? wait : back > 0 ? rigidBatBlend(stroke, wait, back) : stroke;
}

/** The uncommitted first-person lift weight with the stroke `travel` ms along (1 while waiting). */
function uncommittedLift(before: BatTrack, touch: TouchStroke, scene: number, travel: number | null): number {
  if (scene <= touch.start || travel === null) return 1;
  const stroke = firstPersonLiftWeight(strokeTrack(before, touch), touch.start + travel);
  const back = scene > touch.end ? smooth((scene - touch.end) / TOUCHDOWN.checkMs) : 0;
  return stroke + (1 - stroke) * back;
}

function lifted(pose: BatPose, w: number, mirror: boolean): BatPose {
  if (w <= 0) return pose;
  const l = toWorld(FIRST_PERSON_LIFT, mirror);
  return {
    grip: v(pose.grip.x + l.x * w, pose.grip.y + l.y * w, pose.grip.z + l.z * w),
    toe: v(pose.toe.x + l.x * w, pose.toe.y + l.y * w, pose.toe.z + l.z * w),
    face: { ...pose.face },
  };
}

/** Distance (m) from a point to the bat's axis, cap to toe. */
function batClearance(p: Vec3, bat: BatPose): number {
  const ab = v(bat.toe.x - bat.grip.x, bat.toe.y - bat.grip.y, bat.toe.z - bat.grip.z);
  const ap = v(p.x - bat.grip.x, p.y - bat.grip.y, p.z - bat.grip.z);
  const u = clamp(dot(ap, ab) / Math.max(1e-12, dot(ab, ab)), 0, 1);
  return Math.hypot(ap.x - ab.x * u, ap.y - ab.y * u, ap.z - ab.z * u);
}

/**
 * How far along (ms of the tap's provisional) the uncommitted stroke is drawn at `scene`: the soft-capped travel,
 * reduced to keep TOUCHDOWN's clearance from the ball in both drawings (presented and first person), or null when
 * even the stroke's start would not keep it (the waiting bat is drawn). The same value for every drawing of a frame.
 */
let travelMemo: {
  touch: TouchStroke;
  scene: number;
  mirror: boolean;
  aim: Vec3;
  state: OneGestureState | null | undefined;
  travel: number | null;
} | null = null;

function touchTravel(track: BatTrack, touch: TouchStroke, scene: number): number | null {
  const m = travelMemo;
  if (
    m &&
    m.touch === touch &&
    m.scene === scene &&
    m.mirror === track.mirror &&
    m.aim === track.aim &&
    m.state === track.contactState
  )
    return m.travel;
  const travel = guardedTravel(track, touch, scene);
  travelMemo = { touch, scene, mirror: track.mirror, aim: track.aim, state: track.contactState, travel };
  return travel;
}

/** The guard looks this far ahead along the ball's flight (ms) and retracts the stroke at most this fast (travel ms per ms). */
const GUARD = { aheadMs: 120, stepMs: 4, rate: TOUCHDOWN.capMs / 120 } as const;
/** Clearance beyond the honest threshold over which a held stroke eases fully back in after the ball has passed. */
const GUARD_RECOVERY_M = 1.2;

/**
 * What every probe of one frame's guard shares, whatever the scene or the travel: the no-input track, the tap's
 * hitting pose, and the track that gives the stroke's first-person lift weight.
 */
interface GuardRig {
  before: BatTrack;
  hit: BatPose;
  liftTrack: BatTrack;
}

function guardRig(track: BatTrack, touch: TouchStroke): GuardRig {
  const before = uncommitted(track, touch);
  return {
    before,
    hit: batToWorld(provisionalPose(PROVISIONAL_TRAVEL_MS, before.aim, null), before.mirror),
    liftTrack: strokeTrack(before, touch),
  };
}

/**
 * The uncommitted drawing at one scene as a function of the travel, in both drawings (presented and first person).
 * Exactly `uncommittedPose` and `uncommittedLift` (bit for bit: the same arithmetic in the same order), but the waiting
 * bats and the blends' end poses are worked out once per scene instead of once per probe: a frame's guard makes
 * thirty-odd scenes' worth of probes, and a blocked scene bisects.
 */
function guardDrawing(rig: GuardRig, touch: TouchStroke, scene: number, mirror: boolean) {
  const waitP = presentedOnly(rig.before, scene);
  const waitF = firstPersonPresented(rig.before, scene);
  const started = scene > touch.start;
  const strokeP = started ? new RigidBlend(waitP, rig.hit) : null;
  const strokeF = started ? new RigidBlend(waitF, rig.hit) : null;
  const back = scene > touch.end ? smooth((scene - touch.end) / TOUCHDOWN.checkMs) : 0;
  const reach = (travel: number) => (TOUCHDOWN.reach * clamp(travel, 0, TOUCHDOWN.capMs)) / TOUCHDOWN.capMs;
  const settle = (stroke: BatPose, wait: BatPose) =>
    back >= 1 ? wait : back > 0 ? rigidBatBlend(stroke, wait, back) : stroke;
  return {
    presented: (travel: number | null): BatPose =>
      !started || travel === null ? waitP : settle(strokeP!.at(reach(travel)), waitP),
    firstPerson: (travel: number | null): BatPose => {
      if (!started || travel === null) return lifted(waitF, 1, mirror);
      const stroke = firstPersonLiftWeight(rig.liftTrack, touch.start + travel);
      return lifted(settle(strokeF!.at(reach(travel)), waitF), stroke + (1 - stroke) * back, mirror);
    },
  };
}

/**
 * The most travel (0..capMs) whose uncommitted drawing at `scene` keeps the clearance from the ball at that moment in
 * both drawings, or null when even the stroke's start does not (the waiting bat is drawn).
 */
function allowedTravel(
  rig: GuardRig,
  track: BatTrack,
  touch: TouchStroke,
  scene: number,
  requested: number,
): number | null {
  const b = touch.ball ? ballAt(touch.ball, sceneToSim(track, scene)) : null;
  if (!b) return requested;
  const ball = toWorld(b, track.mirror);
  const drawing = guardDrawing(rig, touch, scene, track.mirror);
  const idleP = batClearance(ball, drawing.presented(null));
  const idleF = batClearance(ball, drawing.firstPerson(null));
  const needP = Math.min(idleP, TOUCHDOWN.clearM);
  const needF = Math.min(idleF, TOUCHDOWN.clearM);
  const distances = (travel: number) => ({
    p: batClearance(ball, drawing.presented(travel)),
    f: batClearance(ball, drawing.firstPerson(travel)),
  });
  const isClear = (d: { p: number; f: number }) => d.p >= needP && d.f >= needF;
  const clear = (travel: number) => isClear(distances(travel));
  let want = requested;
  const full = distances(want);
  if (isClear(full)) {
    // When the ball has just passed, both ends of the bat's arc can be clear while the arc between them is not. An
    // immediate return to the full stroke would then pop from the waiting bat to the far side of the ball. Ease the
    // travel back with measured clearance; at real pace the 1.2 m range keeps the bat's recovery bounded, while a
    // normal touch (the ball still far away) is exactly unchanged.
    const margin = Math.min(idleP - needP, idleF - needF, full.p - needP, full.f - needF);
    want *= clamp(margin / GUARD_RECOVERY_M, 0, 1);
    if (clear(want)) return want;
  }
  if (!clear(0)) return null;
  // Clearance along the bat's rigid arc is not monotonic: it can cross the ball and become clear again. Find the
  // first blocked part of the arc, rather than bisecting the whole range and possibly landing on a later clear island.
  // Twelve brackets keep the live path bounded; the final bisection proves the returned end of the connected clear
  // prefix at this frame.
  let lo = 0;
  let hi = want;
  for (let i = 1; i <= 12; i++) {
    const probe = (want * i) / 12;
    if (!clear(probe)) {
      hi = probe;
      break;
    }
    lo = probe;
  }
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (clear(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * The soft-capped travel, kept clear of the ball now and, looking GUARD.aheadMs along its flight, retracting towards
 * what will be allowed at no more than GUARD.rate: the bat draws back before the ball arrives instead of snapping.
 */
function guardedTravel(track: BatTrack, touch: TouchStroke, scene: number): number | null {
  const want = touchdownTravel(scene - touch.start);
  if (scene <= touch.start || !touch.ball || touch.ball.length === 0) return want;
  // Every drawn grip lies between a waiting grip and the hitting pose's (the hands travel straight), the first-person
  // lift moves it by at most |FIRST_PERSON_LIFT|, and the bat reaches BAT_LENGTH beyond it: a ball farther than that
  // plus the clearance from all such segments, over the look-ahead, cannot be met.
  const hitGrip = toWorld(provisionalPose(PROVISIONAL_TRAVEL_MS, track.aim, null).grip, track.mirror);
  const rig = guardRig(track, touch);
  const pre = rig.before;
  const far =
    BAT_LENGTH + Math.hypot(FIRST_PERSON_LIFT.x, FIRST_PERSON_LIFT.y, FIRST_PERSON_LIFT.z) + TOUCHDOWN.clearM + 0.05;
  const grips = [
    presentedBatPose(pre, touch.start).grip,
    presentedBatPose(pre, scene).grip,
    presentedBatPose(pre, touch.start, undefined, FIRST_PERSON_BACKLIFT).grip,
    presentedBatPose(pre, scene, undefined, FIRST_PERSON_BACKLIFT).grip,
  ];
  let near = false;
  for (let ahead = 0; ahead <= GUARD.aheadMs && !near; ahead += GUARD.stepMs) {
    const b = ballAt(touch.ball, sceneToSim(track, scene + ahead));
    if (!b) continue;
    const ball = toWorld(b, track.mirror);
    near = grips.some((g) => batClearance(ball, { grip: g, toe: hitGrip, face: STANCE.face }) <= far);
  }
  if (!near) return want;
  const now = allowedTravel(rig, track, touch, scene, want);
  if (now === null) return null;
  let travel = now;
  for (let ahead = GUARD.stepMs; ahead <= GUARD.aheadMs; ahead += GUARD.stepMs) {
    const later = allowedTravel(rig, track, touch, scene + ahead, touchdownTravel(scene + ahead - touch.start));
    travel = Math.min(travel, (later ?? 0) + GUARD.rate * ahead);
  }
  // A look-ahead cap is smaller than `now`, but clearance along the rigid bat's arc is not monotonic: a smaller
  // travel can put the blade between two clear parts of the arc. Validate the capped value at this frame as well;
  // allowedTravel always returns a value it actually tested clear (or the waiting bat), so anticipation can never
  // turn a safe current pose into an intervening collision.
  return allowedTravel(rig, track, touch, scene, Math.max(0, travel));
}

/**
 * The drawn bat (world) of a track carrying a touch-down stroke, from `pose` (the same drawing without one):
 *   - before the commitment: the bat leaves its waiting pose along the tap's provisional swing, soft-capped
 *     (touchdownTravel) and kept clear of the ball (touchTravel), and checks back to the waiting (or loaded) pose
 *     from `touch.end`;
 *   - from the commitment: a rigid blend from that onto the committed drawing over TOUCHDOWN.commitMs, complete by
 *     the contact, after which the committed drawing alone (the physics bat from contact on).
 */
function withTouch(track: BatTrack, touch: TouchStroke, scene: number, pose: PoseFn): BatPose {
  // The uncommitted drawing (with its clearance guard) is only worked out while it is shown: before the commitment, and
  // while it joins the committed swing. Once joined (and from contact on) the committed drawing stands alone, so a
  // reach plan or a replay frame that asks for a later time never pays for the guard.
  const open = () => uncommittedPose(uncommitted(track, touch), touch, scene, pose, touchTravel(track, touch, scene));
  if (touch.commitAt === null || scene < touch.commitAt) return open();
  const committed = pose({ ...track, touch: null }, scene);
  const end = Math.min(touch.commitAt + TOUCHDOWN.commitMs, track.contactScene ?? Number.POSITIVE_INFINITY);
  if (scene >= end) return committed;
  return rigidBatBlend(open(), committed, smooth((scene - touch.commitAt) / (end - touch.commitAt)));
}

// ---------------------------------------------------------------------------------------------------------------
// The presented bat: an orthodox grounded stance, the backlift as the bowler gathers, then the swing
// ---------------------------------------------------------------------------------------------------------------

/**
 * The orthodox stance (physics frame, right-handed; presentation only): the bat grounded just in front of the back
 * foot's toe, the handle resting towards the front thigh, the face to the bowler.
 */
export const STANCE_GROUNDED: BatPose = (() => {
  const toe = v(0.08, 0.015, 9.18);
  const d = norm(v(0.08, -0.705, 0.23));
  const grip = v(toe.x - d.x * BAT_LENGTH, toe.y - d.y * BAT_LENGTH, toe.z - d.z * BAT_LENGTH);
  const k = -d.z;
  return { grip, toe, face: norm(v(d.x * -k, d.y * -k, -1 - d.z * k)) };
})();
/**
 * The backlift, from STANCE_GROUNDED up into the swing's waiting pose (STANCE): it starts at the release and is at
 * the top 0.25 s later (scene ms relative to the release; the lead's ruling with TRACKB, COVER-DRIVE-SPEC §2). The same
 * for every ball, so it announces nothing.
 */
export const BACKLIFT = { fromMs: 0, toMs: 250 } as const;
/**
 * The top of the presented backlift (physics frame, right-handed): a compact backlift, the hands at the hip and the
 * blade level, pointing back at the keeper, the face turned down and a little open (towards point). About 40° lower
 * than the old waiting pose (STANCE, toe up beside the head), so the bat has less to turn before contact. The same for
 * every ball; the swing's provisional and physics bats take over from it at the input.
 */
export const BACKLIFT_TOP: BatPose = (() => {
  const d = norm(v(0.12, 0, 0.99));
  // TRACKB batter.vmp v3 (06:12Z): the compact top's hands are 6 cm towards the off side of the old (−0.08).
  const hands = v(-0.02, 1.02, 9.0);
  const grip = v(hands.x - d.x * 0.075, hands.y - d.y * 0.075, hands.z - d.z * 0.075);
  const f0 = v(0.3, -0.95, 0);
  const k = f0.x * d.x + f0.y * d.y + f0.z * d.z;
  return {
    grip,
    toe: v(grip.x + d.x * BAT_LENGTH, grip.y + d.y * BAT_LENGTH, grip.z + d.z * BAT_LENGTH),
    face: norm(v(f0.x - d.x * k, f0.y - d.y * k, f0.z - d.z * k)),
  };
})();
/** While the batter waits: a small tap of the bat every `periodMs`, never in the `quietMs` before the backlift. */
const BAT_TAP = { periodMs: 2300, ms: 320, liftM: 0.03, quietMs: 1100 } as const;
/** From the swing's visible start (the input), the drawn bat joins a swing that starts where it is this fast. */
const CATCH_UP_MS = 60;
/** A swing that starts away from the waiting bat (the physics' zone-entry pose): joined over input → contact instead. */
const SWING_GAP = { metres: 0.12, degrees: 20 } as const;

type Quat = [number, number, number, number];
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

/** The bat's orientation: the rotation taking +x to the blade direction (grip → toe) and +y to the face. */
function batQuat(p: BatPose): Quat {
  const a = norm(v(p.toe.x - p.grip.x, p.toe.y - p.grip.y, p.toe.z - p.grip.z));
  const f0 = p.face;
  const b = norm(v(f0.x - a.x * dot(f0, a), f0.y - a.y * dot(f0, a), f0.z - a.z * dot(f0, a)));
  const c = cross(a, b);
  // Columns a, b, c.
  const m00 = a.x,
    m01 = b.x,
    m02 = c.x,
    m10 = a.y,
    m11 = b.y,
    m12 = c.y,
    m20 = a.z,
    m21 = b.z,
    m22 = c.z;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}

function rotateQ(q: Quat, p: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const ix = w * p.x + y * p.z - z * p.y;
  const iy = w * p.y + z * p.x - x * p.z;
  const iz = w * p.z + x * p.y - y * p.x;
  const iw = -x * p.x - y * p.y - z * p.z;
  return v(
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  );
}

function slerpQ(a: Quat, b0: Quat, u: number): Quat {
  let d = a[0] * b0[0] + a[1] * b0[1] + a[2] * b0[2] + a[3] * b0[3];
  const b: Quat = d < 0 ? [-b0[0], -b0[1], -b0[2], -b0[3]] : b0;
  d = Math.abs(d);
  if (d > 0.9995) {
    const r: Quat = [
      a[0] + (b[0] - a[0]) * u,
      a[1] + (b[1] - a[1]) * u,
      a[2] + (b[2] - a[2]) * u,
      a[3] + (b[3] - a[3]) * u,
    ];
    const l = Math.hypot(...r) || 1;
    return [r[0] / l, r[1] / l, r[2] / l, r[3] / l];
  }
  const th = Math.acos(d);
  const s = Math.sin(th);
  const ka = Math.sin((1 - u) * th) / s;
  const kb = Math.sin(u * th) / s;
  return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb, a[3] * ka + b[3] * kb];
}

/** Halfway between the hands, from the cap (metres along the handle): the backlift turns the bat about the hands. */
const HANDS_FROM_CAP = (TOP_HAND_FROM_CAP + LOWER_HAND_FROM_CAP) / 2;

/** A rigid bat moved from `a` to `b` (u 0..1): the hands travel straight, the bat turns about them (slerp). */
export function rigidBatBlend(a: BatPose, b: BatPose, u: number): BatPose {
  if (u <= 0) return a;
  if (u >= 1) return b;
  const qa = batQuat(a);
  const qb = batQuat(b);
  const ha = lerp(a.grip, a.toe, HANDS_FROM_CAP / BAT_LENGTH);
  const hb = lerp(b.grip, b.toe, HANDS_FROM_CAP / BAT_LENGTH);
  const q = slerpQ(qa, qb, u);
  const dir = rotateQ(q, v(1, 0, 0));
  const face = rotateQ(q, v(0, 1, 0));
  const hands = lerp(ha, hb, u);
  const grip = v(hands.x - dir.x * HANDS_FROM_CAP, hands.y - dir.y * HANDS_FROM_CAP, hands.z - dir.z * HANDS_FROM_CAP);
  return { grip, toe: v(grip.x + dir.x * BAT_LENGTH, grip.y + dir.y * BAT_LENGTH, grip.z + dir.z * BAT_LENGTH), face };
}

/**
 * `rigidBatBlend(a, b, u)` for many u with `a` and `b` fixed: the orientations and the hands' positions are worked out
 * once. The same arithmetic in the same order as `rigidBatBlend`, so every result is bit for bit its (bat-exact.test).
 */
class RigidBlend {
  private readonly a: BatPose;
  private readonly b: BatPose;
  private readonly qa: Quat;
  private readonly qb: Quat;
  private readonly ha: Vec3;
  private readonly hb: Vec3;
  constructor(a: BatPose, b: BatPose) {
    this.a = a;
    this.b = b;
    this.qa = batQuat(a);
    this.qb = batQuat(b);
    this.ha = lerp(a.grip, a.toe, HANDS_FROM_CAP / BAT_LENGTH);
    this.hb = lerp(b.grip, b.toe, HANDS_FROM_CAP / BAT_LENGTH);
  }
  at(u: number): BatPose {
    if (u <= 0) return this.a;
    if (u >= 1) return this.b;
    const q = slerpQ(this.qa, this.qb, u);
    const dir = rotateQ(q, v(1, 0, 0));
    const face = rotateQ(q, v(0, 1, 0));
    const hands = lerp(this.ha, this.hb, u);
    const grip = v(
      hands.x - dir.x * HANDS_FROM_CAP,
      hands.y - dir.y * HANDS_FROM_CAP,
      hands.z - dir.z * HANDS_FROM_CAP,
    );
    return {
      grip,
      toe: v(grip.x + dir.x * BAT_LENGTH, grip.y + dir.y * BAT_LENGTH, grip.z + dir.z * BAT_LENGTH),
      face,
    };
  }
}

/**
 * The waiting bat (physics frame): grounded with the occasional tap, lifted into the backlift as the bowler gathers,
 * and carrying the press and load cues `batPoseAt` gives before a swing (as a displacement from STANCE).
 */
export function preSwingPose(track: BatTrack, scene: number, liftScale = 1): BatPose {
  const rel = scene - track.releaseScene;
  const delivery = track.delivery !== false;
  const lift = delivery ? smooth((rel - BACKLIFT.fromMs) / (BACKLIFT.toMs - BACKLIFT.fromMs)) * liftScale : 0;
  let base = rigidBatBlend(STANCE_GROUNDED, BACKLIFT_TOP, lift);
  if (lift <= 0 && (!delivery || rel < BACKLIFT.fromMs - BAT_TAP.quietMs)) {
    const phase = ((scene % BAT_TAP.periodMs) + BAT_TAP.periodMs) % BAT_TAP.periodMs;
    if (phase < BAT_TAP.ms) {
      const h = Math.sin((phase / BAT_TAP.ms) * Math.PI) ** 2 * BAT_TAP.liftM;
      base = { grip: add(base.grip, v(0, h, 0)), toe: add(base.toe, v(0, h, 0)), face: base.face };
    }
  }
  // The raw-press and load cues, exactly as batPoseAt shows them on STANCE, carried onto the presented bat.
  const cue = batPoseAt({ ...track, mirror: false, samples: null, provisionalStart: null }, scene);
  const dg = v(cue.grip.x - STANCE.grip.x, cue.grip.y - STANCE.grip.y, cue.grip.z - STANCE.grip.z);
  const dt = v(cue.toe.x - STANCE.toe.x, cue.toe.y - STANCE.toe.y, cue.toe.z - STANCE.toe.z);
  if (dg.x === 0 && dg.y === 0 && dg.z === 0 && dt.x === 0 && dt.y === 0 && dt.z === 0) return base;
  const grip = add(base.grip, dg);
  const d = norm(v(base.toe.x + dt.x - grip.x, base.toe.y + dt.y - grip.y, base.toe.z + dt.z - grip.z));
  const face = norm(
    add(base.face, v(cue.face.x - STANCE.face.x, cue.face.y - STANCE.face.y, cue.face.z - STANCE.face.z)),
  );
  return { grip, toe: v(grip.x + d.x * BAT_LENGTH, grip.y + d.y * BAT_LENGTH, grip.z + d.z * BAT_LENGTH), face };
}

/** Scene ms the swing visibly starts: the player's input (live: the calibrated press; a replay: the swing's start). */
export function visibleSwingStart(track: BatTrack): number | null {
  if (track.touch) return track.touch.start;
  if (track.provisionalStart !== null) return track.provisionalStart;
  if (track.inputScene != null) return track.inputScene;
  const first = track.samples?.[0];
  return first ? track.releaseScene + first.t * 1000 : null;
}

/**
 * The physics swing as the presented bat's target (world): `batPoseAt`, except that before the physics bat's first
 * sample (its zone-entry pose) the target holds that pose instead of the old waiting pose, so nothing jumps when the
 * physics track starts. Live, the provisional swing hands over to it as `batPoseAt` does (BLEND_MS).
 */
function swingTarget(track: BatTrack, scene: number): BatPose {
  const first = track.samples?.[0];
  if (first && scene < track.releaseScene + first.t * 1000) {
    const hold = batToWorld({ grip: first.grip, toe: first.toe, face: first.face }, track.mirror);
    if (track.provisionalStart !== null && track.resultAt !== null && scene < track.resultAt + BLEND_MS) {
      const prov = batToWorld(
        provisionalPose(scene - track.provisionalStart, track.aim, track.contactState ?? null),
        track.mirror,
      );
      return blendBat(prov, hold, smooth((scene - track.resultAt) / BLEND_MS));
    }
    return hold;
  }
  return batPoseAt(track, scene);
}

/** How far apart two bat poses are: the hands (m) and the blade's direction (deg). */
function batGap(a: BatPose, b: BatPose): { metres: number; degrees: number } {
  const ha = lerp(a.grip, a.toe, HANDS_FROM_CAP / BAT_LENGTH);
  const hb = lerp(b.grip, b.toe, HANDS_FROM_CAP / BAT_LENGTH);
  const da = norm(v(a.toe.x - a.grip.x, a.toe.y - a.grip.y, a.toe.z - a.grip.z));
  const db = norm(v(b.toe.x - b.grip.x, b.toe.y - b.grip.y, b.toe.z - b.grip.z));
  return {
    metres: Math.hypot(ha.x - hb.x, ha.y - hb.y, ha.z - hb.z),
    degrees: (Math.acos(Math.max(-1, Math.min(1, dot(da, db)))) * 180) / Math.PI,
  };
}

/**
 * The bat as presented (world): the orthodox stance and the backlift until the swing visibly starts at the player's
 * input, then a rigid blend from where the bat was then onto the physics swing (holding the physics' zone-entry pose
 * until its first sample), complete by the contact (or, without one, the swing's velocity peak). Never moves the
 * swing before the input; at and after contact it IS `batPoseAt` (the physics bat).
 */
export function presentedBatPose(track: BatTrack, scene: number, waitedIn?: BatPose, liftScale = 1): BatPose {
  if (track.touch) return withTouch(track, track.touch, scene, (t, s) => presentedBatPose(t, s, waitedIn, liftScale));
  const start = visibleSwingStart(track);
  if (start === null || scene < start)
    return waitedIn ?? batToWorld(preSwingPose(track, scene, liftScale), track.mirror);
  const end = track.contactScene ?? track.velocityPeakScene ?? null;
  if (end !== null && scene >= end) return batPoseAt(track, scene);
  const from = waitedIn ?? batToWorld(preSwingPose(track, start, liftScale), track.mirror);
  const target = swingTarget(track, scene);
  const gap = batGap(from, swingTarget(track, start));
  const far = gap.metres > SWING_GAP.metres || gap.degrees > SWING_GAP.degrees;
  const span = far && end !== null ? end - start : Math.min(CATCH_UP_MS, end !== null ? end - start : CATCH_UP_MS);
  const x = span > 0 ? (scene - start) / span : 1;
  // A far closing starts moving at the input (half linear, half smoothstep): its peak rate is 1.25× the mean instead
  // of smoothstep's 1.5×, and the bat answers the input in its first frame. A near one is the short smoothstep.
  const u = x >= 1 ? 1 : far ? 0.5 * Math.max(0, x) + 0.5 * smooth(x) : smooth(x);
  if (u >= 1) return target;
  return rigidBatBlend(from, target, u);
}

/** Glove centres (world): top hand near the top of the handle, bottom hand below it. */
export function glovesOf(pose: BatPose): { top: Vec3; bottom: Vec3; dir: Vec3 } {
  const dir = norm(v(pose.toe.x - pose.grip.x, pose.toe.y - pose.grip.y, pose.toe.z - pose.grip.z));
  const at = (d: number) => v(pose.grip.x + dir.x * d, pose.grip.y + dir.y * d, pose.grip.z + dir.z * d);
  return { top: at(TOP_HAND_FROM_CAP), bottom: at(LOWER_HAND_FROM_CAP), dir };
}

/** The sweet spot of a bat pose (world or physics frame, whichever the pose is in). */
export function sweetSpot(pose: BatPose): Vec3 {
  const len = Math.hypot(pose.toe.x - pose.grip.x, pose.toe.y - pose.grip.y, pose.toe.z - pose.grip.z) || BAT_LENGTH;
  return lerp(pose.grip, pose.toe, SWEET_FROM_GRIP / Math.max(len, SWEET_FROM_GRIP + 0.01));
}

/**
 * First person only, presentation only: while the batter waits and early in the swing, the bat and gloves are carried
 * by FIRST_PERSON_LIFT into the lower corner of the view (a side-on stance holds them below and beside the eyes,
 * outside any phone's view), so the bat is always in sight and answers the press in the very next frame. The lift is a
 * pure translation, so the drawn bat keeps its true orientation: the orthodox grounded stance (toe down by the back
 * foot, face to the bowler), the backlift as the bowler gathers, then the swing. The drawn bat is the presented bat
 * plus w × FIRST_PERSON_LIFT; as w falls to zero before the hitting area it becomes exactly the physics bat (contact,
 * follow-through). External cameras and replays never use it. Physics frame, right-handed (mirrored for a left-hander).
 */
export const FIRST_PERSON_LIFT: Vec3 = v(0.25, 0.66, -0.82);
/** The grounded stance as first person shows it (STANCE_GROUNDED carried by FIRST_PERSON_LIFT). */
export const FIRST_PERSON_READY: BatPose = {
  grip: add(STANCE_GROUNDED.grip, FIRST_PERSON_LIFT),
  toe: add(STANCE_GROUNDED.toe, FIRST_PERSON_LIFT),
  face: { ...STANCE_GROUNDED.face },
};
/** The ready pose fades between these fractions of the swing's travel. */
const LIFT_FADE = [0.2, 0.8] as const;

/**
 * Scene ms the swing started, for the first-person lift. Resolved physics supersedes the provisional onset as more
 * gesture samples arrive; a physics swing shifted earlier than the player's input (forgiveness) never starts the lift
 * before that input.
 */
export function swingStartScene(track: BatTrack): number | null {
  if (track.samples !== null) {
    const first = track.samples[0];
    if (!first) return null;
    const physics = track.releaseScene + first.t * 1000;
    return track.provisionalStart !== null ? Math.max(physics, track.provisionalStart) : physics;
  }
  return track.provisionalStart;
}

/** Weight of the first-person lift at a scene time: 1 while waiting, 0 from before the hitting area on. */
export function firstPersonLiftWeight(track: BatTrack, scene: number): number {
  const touch = track.touch;
  if (touch) {
    // As withTouch draws it: the uncommitted stroke's own lift (back to 1 as it checks back), joined to the
    // committed swing's over TOUCHDOWN.commitMs.
    const open = () => uncommittedLift(uncommitted(track, touch), touch, scene, touchTravel(track, touch, scene));
    if (touch.commitAt === null || scene < touch.commitAt) return open();
    const committed = firstPersonLiftWeight({ ...track, touch: null }, scene);
    const end = Math.min(touch.commitAt + TOUCHDOWN.commitMs, track.contactScene ?? Number.POSITIVE_INFINITY);
    if (scene >= end) return committed;
    const w = open();
    return w + (committed - w) * smooth((scene - touch.commitAt) / (end - touch.commitAt));
  }
  if (track.contactScene != null && scene >= track.contactScene) return 0;
  const start = swingStartScene(track);
  if (start === null) return 1;
  return 1 - smooth((scene - start - LIFT_FADE[0] * track.travelMs) / ((LIFT_FADE[1] - LIFT_FADE[0]) * track.travelMs));
}

/** The first-person bat (world): the presented bat, carried towards the lower corner of the view by the lift's weight. */
/**
 * First person shows this much of the backlift (a part-lift: the hands rise and the blade tilts back), so the raised
 * blade, which passes beside the eye, never sweeps over the HUD's top corner (practice-layout e2e); the swing then
 * closes from there exactly as from the full backlift.
 */
const FIRST_PERSON_BACKLIFT = 0.35;

export function firstPersonBatPose(track: BatTrack, scene: number): BatPose {
  const pose = presentedBatPose(track, scene, undefined, FIRST_PERSON_BACKLIFT);
  const w = firstPersonLiftWeight(track, scene);
  if (w <= 0) return pose;
  const lift = toWorld(FIRST_PERSON_LIFT, track.mirror);
  return {
    grip: v(pose.grip.x + lift.x * w, pose.grip.y + lift.y * w, pose.grip.z + lift.z * w),
    toe: v(pose.toe.x + lift.x * w, pose.toe.y + lift.y * w, pose.toe.z + lift.z * w),
    face: { ...pose.face },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The striker's bat in external views (replays, the fielding camera, the Coach demonstration)
// ---------------------------------------------------------------------------------------------------------------

/**
 * After the physics bat's last sample it is held this long (the finish), then handed to the body's clip over
 * BAT_RELEASE_MS, so a standing batter's bat has settled BAT_HOLD_MS + BAT_RELEASE_MS (1,070 ms) after the last sample.
 * The release is as long as it is because the gloves follow the bat all the way: a quicker sweep drags each arm along the
 * edge of its joint windows (upper-arm twist, wrist swing) and it leaves the window in one frame. Elbow flips in the 192
 * deliveries of WEB-FIX-A2's corpus: 176 with 320 ms, 110 with 480, 69 with 560, 49 with 640, 36 with 720 (144 of the 176
 * were in this hand-over, 4 of the 36); beyond 720 ms no more is gained (800 ms: 36).
 */
export const BAT_HOLD_MS = 350;
export const BAT_RELEASE_MS = 720;
/**
 * A striker who sets off running leaves the bat behind him, so the hand-over to the clip's carry (bat_run) is not stretched:
 * it takes at most this long once he has set off, however long BAT_RELEASE_MS is (a 640-720 ms one left a palm 28-30 mm off the
 * handle in one of the 22 running deliveries of 192; at this length it is 1 mm).
 */
export const BAT_RUN_RELEASE_MS = 320;
/** A leave: the bat stays in the backlift until this long after the release, then follows the body's clip. */
export const LEAVE_HOLD_MS = 260;

const clipA = createPose();
const clipB = createPose();
const clipL = createPose();

/**
 * The bat an actor's clips hold (world), as the stage would place it from the clip's bat key: the bottom hand's point
 * and the blade's direction in the actor frame (scaled by the rig), the face towards the bowler. Null without a key.
 */
export function clipBatPose(track: ActorTrack, scene: number, scale: number): BatPose | null {
  const st = evaluateActor(track, scene);
  const pose = samplePresented(st, clipA, clipB, clipL);
  if (track.mirror) mirrorSampledPose(pose);
  const m = track.mirror ? -1 : 1;
  const key = pose.bat ?? {
    grip: [CARRY_BAT_KEY.grip[0] * m, CARRY_BAT_KEY.grip[1], CARRY_BAT_KEY.grip[2]],
    dir: [CARRY_BAT_KEY.dir[0] * m, CARRY_BAT_KEY.dir[1], CARRY_BAT_KEY.dir[2]],
  };
  const c = Math.cos(st.heading);
  const sn = Math.sin(st.heading);
  const rot = (x: number, y: number, z: number): Vec3 => v(x * c + z * sn, y, -x * sn + z * c);
  const g = rot(key.grip[0] * scale, key.grip[1] * scale, key.grip[2] * scale);
  const lower = v(st.pos.x + (st.body?.x ?? 0) + g.x, g.y, st.pos.z + (st.body?.z ?? 0) + g.z);
  const d = norm(rot(key.dir[0], key.dir[1], key.dir[2]));
  const grip = v(
    lower.x - d.x * LOWER_HAND_FROM_CAP,
    lower.y - d.y * LOWER_HAND_FROM_CAP,
    lower.z - d.z * LOWER_HAND_FROM_CAP,
  );
  // The clip's own face when its pack carries one (MOTION-SPEC v1.2 bat.face), else towards the bowler.
  const kf = (key as { face?: readonly number[] }).face;
  const hint = kf ? rot(kf[0], kf[1], kf[2]) : rot(track.mirror ? -1 : 1, 0, 0);
  const k = dot(hint, d);
  return {
    grip,
    toe: v(grip.x + d.x * BAT_LENGTH, grip.y + d.y * BAT_LENGTH, grip.z + d.z * BAT_LENGTH),
    face: norm(v(hint.x - d.x * k, hint.y - d.y * k, hint.z - d.z * k)),
  };
}

/**
 * Scene ms the striker sets off running after the stroke: the start of his first running move (the `bat_run` arms, or
 * legs from a `vmp:loco_*` clip) that is still under way at `from`, or +Infinity when he does not run. The drawn bat
 * goes with the body from then on (hands-on-bat, WEB-HUMANS round 3), never before the physics bat's last sample.
 */
function strikerSetsOff(striker: ActorTrack, from: number): number {
  for (const m of striker.moves) {
    if (m.t1 <= from) continue;
    if (m.clip === 'bat_run' || String(m.lower ?? '').startsWith('vmp:loco_')) return m.t0;
  }
  return Number.POSITIVE_INFINITY;
}

/** The bat a batter-pack clip holds at `t` (world), or null when the clip drawn then is not one of the pack's. */
function packBatAt(striker: ActorTrack, t: number, scale: number): BatPose | null {
  return evaluateActor(striker, t).current.clip.startsWith('vmp:bat_') ? clipBatPose(striker, t, scale) : null;
}

/** The last `packBatBeforeInput` (a pure function of its arguments): a swing's whole run of frames asks for one instant. */
let packMemo: { striker: ActorTrack; scale: number; at: number; pose: BatPose | null } | null = null;

/**
 * `packBatAt` for the instant just before the input, which is the same for every frame (and every reach-plan sample)
 * of one swing. A hit returns a copy, so a caller can never change what the next frame is given.
 */
function packBatBeforeInput(striker: ActorTrack, at: number, scale: number): BatPose | null {
  const m = packMemo;
  if (!m || m.striker !== striker || m.scale !== scale || m.at !== at) {
    packMemo = { striker, scale, at, pose: packBatAt(striker, at, scale) };
    return (
      packMemo.pose && {
        grip: { ...packMemo.pose.grip },
        toe: { ...packMemo.pose.toe },
        face: { ...packMemo.pose.face },
      }
    );
  }
  return m.pose && { grip: { ...m.pose.grip }, toe: { ...m.pose.toe }, face: { ...m.pose.face } };
}

const dotQ = (a: Quat, b: Quat): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
const negQ = (a: Quat): Quat => [-a[0], -a[1], -a[2], -a[3]];

/** `slerpQ` without its choice of hemisphere: `b` is taken as the caller signed it (the long way round when dot(a, b) < 0). */
function slerpAlong(a: Quat, b: Quat, u: number): Quat {
  const d = dotQ(a, b);
  // (Nearly) the same orientation, signed either way: the short way, as slerpQ.
  if (d > 0.9995 || d < -0.9995) return slerpQ(a, b, u);
  const th = Math.acos(d);
  const s = Math.sin(th);
  const ka = Math.sin((1 - u) * th) / s;
  const kb = Math.sin(u * th) / s;
  return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb, a[3] * ka + b[3] * kb];
}

/** The last `clipQuatAt` (a pure function of its arguments): a hand-over's whole run of frames asks for one instant. */
let midMemo: { striker: ActorTrack; scale: number; at: number; q: Quat | null } | null = null;

/** The orientation of the bat the striker's clips hold at `at` (never changed by a caller), or null without one. */
function clipQuatAt(striker: ActorTrack, scale: number, at: number): Quat | null {
  const m = midMemo;
  if (m && m.striker === striker && m.scale === scale && m.at === at) return m.q;
  const pose = clipBatPose(striker, at, scale);
  const q = pose && batQuat(pose);
  midMemo = { striker, scale, at, q };
  return q;
}

/**
 * `rigidBatBlend(held, clip, u)` with the way round fixed for the whole hand-over. A quaternion slerp takes the nearer of two
 * ways round by the sign of one dot product, and where the held bat is a half turn from the clip's (a bat lifted high at the
 * finish, lowered to the rest) the clip's own move carries that product across zero in mid-blend: the blade jumped 39-138° in
 * one frame (7 of the 432 deliveries of WEB-FIX-A2's corpora with a 320 ms hand-over, 19 with 720 ms). Here `mid`, the clip's
 * bat orientation half way through the hand-over, is signed to the nearer way round there (as `rigidBatBlend` would choose it)
 * and fixes the way for every frame: each frame's clip quaternion takes the sign nearest `mid`, so the path is continuous in
 * time. Wherever the nearer way never changed this is `rigidBatBlend`, bit for bit.
 */
function handOverBlend(held: BatPose, clip: BatPose, u: number, mid: Quat | null): BatPose {
  const qa = batQuat(held);
  let ref = mid ?? qa;
  if (dotQ(ref, qa) < 0) ref = negQ(ref);
  let qb = batQuat(clip);
  if (dotQ(qb, ref) < 0) qb = negQ(qb);
  const ha = lerp(held.grip, held.toe, HANDS_FROM_CAP / BAT_LENGTH);
  const hb = lerp(clip.grip, clip.toe, HANDS_FROM_CAP / BAT_LENGTH);
  const q = slerpAlong(qa, qb, u);
  const dir = rotateQ(q, v(1, 0, 0));
  const face = rotateQ(q, v(0, 1, 0));
  const hands = lerp(ha, hb, u);
  const grip = v(hands.x - dir.x * HANDS_FROM_CAP, hands.y - dir.y * HANDS_FROM_CAP, hands.z - dir.z * HANDS_FROM_CAP);
  return { grip, toe: v(grip.x + dir.x * BAT_LENGTH, grip.y + dir.y * BAT_LENGTH, grip.z + dir.z * BAT_LENGTH), face };
}

/**
 * The striker's bat for an external camera (world): the presented bat (stance, backlift, swing: the physics bat
 * exactly from contact on), held after its last sample until BAT_HOLD_MS later or until the striker sets off running,
 * whichever is first (never before that last sample), then handed smoothly to the body's clip over BAT_RELEASE_MS (as
 * little as BAT_RUN_RELEASE_MS when he sets off running before that would be over). Null when the clip holds it alone.
 */
export function externalBatPose(bat: BatTrack, striker: ActorTrack, scene: number, scale: number): BatPose | null {
  const swung = (bat.samples !== null && bat.samples.length > 0) || bat.provisionalStart !== null;
  const last = bat.samples?.at(-1);
  const lastScene = last ? bat.releaseScene + last.t * 1000 : Number.NaN;
  const sets = swung && last ? strikerSetsOff(striker, lastScene) : Number.POSITIVE_INFINITY;
  const handOver = swung
    ? last
      ? Math.min(lastScene + BAT_HOLD_MS, Math.max(lastScene, sets))
      : Number.POSITIVE_INFINITY
    : bat.delivery === false
      ? Number.POSITIVE_INFINITY
      : bat.releaseScene + BACKLIFT.toMs + LEAVE_HOLD_MS;
  if (scene <= handOver) {
    // While a batter-pack clip is drawn before the swing, its own bat (the body was authored holding it).
    const start = visibleSwingStart(bat);
    if (start === null || scene < start) return packBatAt(striker, scene, scale) ?? presentedBatPose(bat, scene);
    // The swing closes from the bat as it was drawn just before the input.
    const from = packBatBeforeInput(striker, start - 1, scale);
    return from ? presentedBatPose(bat, scene, from) : presentedBatPose(bat, scene);
  }
  // Standing, the long release; running, the bat is not left behind him for long: at most BAT_RUN_RELEASE_MS once he sets off.
  const release = Math.max(BAT_RUN_RELEASE_MS, Math.min(BAT_RELEASE_MS, sets - handOver));
  const u = smooth((scene - handOver) / release);
  if (u >= 1) return null;
  const clip = clipBatPose(striker, scene, scale);
  return clip
    ? handOverBlend(presentedBatPose(bat, handOver), clip, u, clipQuatAt(striker, scale, handOver + release / 2))
    : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The swing smear: a fast closing reads as a fast swing, not a pop
// ---------------------------------------------------------------------------------------------------------------

/** Above this blade rate (deg/s, about a real bat's peak) the drawn swing gets a short smear of trailing ghosts. */
export const SMEAR = Object.freeze({ rateDegS: 1700, ghosts: 3, maxOpacity: 0.3, frameMs: 1000 / 60 });

const bladeDir = (p: BatPose): Vec3 => norm(v(p.toe.x - p.grip.x, p.toe.y - p.grip.y, p.toe.z - p.grip.z));

/** The blade's turning rate (deg/s) between two poses `dtMs` apart. */
export function bladeRateDegS(a: BatPose, b: BatPose, dtMs: number): number {
  const d = Math.max(-1, Math.min(1, dot(bladeDir(a), bladeDir(b))));
  return ((Math.acos(d) * 180) / Math.PI) * (1000 / dtMs);
}

/**
 * The smear for a drawn bat at scene time `scene` (`poseAt` gives the drawn bat at any time: deterministic, never from
 * frame history): when the blade turned faster than SMEAR.rateDegS over the last 60 Hz frame, SMEAR.ghosts poses
 * spaced back along that frame's sweep with fading opacity; else null. Presentation only.
 */
export function swingSmear(
  poseAt: (scene: number) => BatPose | null,
  scene: number,
): { poses: BatPose[]; opacity: number[] } | null {
  const now = poseAt(scene);
  const before = poseAt(scene - SMEAR.frameMs);
  if (!now || !before) return null;
  const rate = bladeRateDegS(before, now, SMEAR.frameMs);
  if (rate <= SMEAR.rateDegS) return null;
  const k = Math.min(1, (rate - SMEAR.rateDegS) / SMEAR.rateDegS);
  const poses: BatPose[] = [];
  const opacity: number[] = [];
  for (let i = 1; i <= SMEAR.ghosts; i++) {
    const u = i / (SMEAR.ghosts + 1);
    poses.push(rigidBatBlend(now, before, u));
    opacity.push(SMEAR.maxOpacity * (0.35 + 0.65 * k) * (1 - u));
  }
  return { poses, opacity };
}
