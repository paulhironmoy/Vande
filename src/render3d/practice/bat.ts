/**
 * The batter's bat as drawn: the stance, the provisional swing shown from the moment the press lands (so the bat
 * answers in one frame, before the gesture is even read), and the physics bat once the result arrives. The
 * provisional swing is presentation only: a straight-bat downswing towards where the ball will be, which every
 * stroke shares in its first part. When the result lands, the drawn bat blends into the physics bat within
 * BLEND_MS, and from then on (contact included) it IS the physics bat. Replays draw the physics bat alone.
 * Positions are in the physics (striker's own) frame unless a name says world.
 */
import type { BatSample, Vec3 } from '@/contracts/practice';
import { BLADE_L, HANDLE_L, HANDS_FROM_TOP, SWEET_U } from '@/physics/constants';
import { batTravelMs } from '@/physics/bat';
import { batAt, batToWorld, blendBat, sceneToSim, toWorld, type BatPose } from './frame';

/**
 * Provisional swing: stance to the hitting area in the physics bat's own travel time for a tap (batTravelMs: 120 ms;
 * an attack is 120 + 30·power). The kind and power are unknown at the press, so the provisional swing is a tap's;
 * the result's own bat track takes over within BLEND_MS of arriving.
 */
export const PROVISIONAL_TRAVEL_MS = batTravelMs('defend', 0);
/** Provisional follow-through after the hitting area. */
export const PROVISIONAL_FOLLOW_MS = 220;
/** Provisional → physics bat. */
export const BLEND_MS = 45;
/** No result for a swing (e.g. it was not usable): back to the stance. */
export const RETURN_MS = 180;

/** Distance from the top of the handle to the toe and to the sweet spot (metres), from the physics bat. */
export const BAT_LENGTH = HANDLE_L + BLADE_L;
export const SWEET_FROM_GRIP = HANDLE_L + BLADE_L * (1 - SWEET_U);
/** The top hand's centre below the top of the handle (the bottom hand is at HANDS_FROM_TOP). */
export const TOP_HAND_FROM_TOP = 0.035;

/** Waiting stance, bat up in a modest backlift (right-handed physics frame). */
export const STANCE: BatPose = {
  grip: { x: -0.1, y: 1.08, z: 9.02 },
  toe: { x: 0.02, y: 1.62, z: 9.62 },
  face: { x: 0.18, y: -0.62, z: -0.76 },
};

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const add = (a: Vec3, b: Vec3): Vec3 => v(a.x + b.x, a.y + b.y, a.z + b.z);
const lerp = (a: Vec3, b: Vec3, u: number): Vec3 => v(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u);
const smooth = (u: number) => {
  const x = u < 0 ? 0 : u > 1 ? 1 : u;
  return x * x * (3 - 2 * x);
};
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return v(a.x / l, a.y / l, a.z / l);
};

/** Where a straight bat can meet the ball (physics frame), from the ball's position near the batter. */
export function reachable(ball: Vec3): Vec3 {
  return v(clamp(ball.x, -0.25, 0.95), clamp(ball.y, 0.06, 1.35), clamp(ball.z, 7.3, 9.1));
}

/** The provisional straight-bat swing at `ms` after it began, aimed at `aim` (physics frame). */
export function provisionalPose(ms: number, aim: Vec3): BatPose {
  const dirAtContact = norm(v(0.05, -0.97, -0.25));
  const contactGrip = add(aim, v(-dirAtContact.x * SWEET_FROM_GRIP, -dirAtContact.y * SWEET_FROM_GRIP, -dirAtContact.z * SWEET_FROM_GRIP));
  const contactToe = add(contactGrip, v(dirAtContact.x * BAT_LENGTH, dirAtContact.y * BAT_LENGTH, dirAtContact.z * BAT_LENGTH));
  const contact: BatPose = { grip: contactGrip, toe: contactToe, face: norm(v(0.04, 0.12, -1)) };
  if (ms <= 0) return { grip: { ...STANCE.grip }, toe: { ...STANCE.toe }, face: { ...STANCE.face } };
  if (ms < PROVISIONAL_TRAVEL_MS) {
    // A quick start (ease-out): the bat answers the press visibly in the very next frame.
    const u = Math.sin((Math.min(1, ms / PROVISIONAL_TRAVEL_MS) * Math.PI) / 2);
    // Hands lead and the blade follows through a slight arc (the toe drops late, as in a real downswing).
    const lift = Math.sin(u * Math.PI) * 0.12;
    const grip = add(lerp(STANCE.grip, contact.grip, u), v(0, lift * 0.4, 0));
    const toe = add(lerp(STANCE.toe, contact.toe, u * u), v(0, lift, 0));
    return { grip, toe, face: norm(lerp(STANCE.face, contact.face, u)) };
  }
  const f = smooth((ms - PROVISIONAL_TRAVEL_MS) / PROVISIONAL_FOLLOW_MS);
  const followGrip = add(aim, v(0.12, 1.05, -0.32));
  const followToe = add(followGrip, v(0.25, 0.55, 0.62));
  return { grip: lerp(contact.grip, followGrip, f), toe: lerp(contact.toe, followToe, f), face: norm(lerp(contact.face, v(0.3, 0.7, -0.6), f)) };
}

/** Everything that decides the drawn bat at a scene time. Pure data: the stage replaces it when something changes. */
export interface BatTrack {
  mirror: boolean;
  releaseScene: number;
  /** The swing's travel to the hitting area (batTravelMs: 120 ms for a tap, 120 + 30·power for an attack). */
  travelMs: number;
  /** Physics bat samples (physics frame), once the result is known; empty for a leave. */
  samples: readonly BatSample[] | null;
  /** Scene ms the provisional swing started (the calibrated press), or null. */
  provisionalStart: number | null;
  /** Physics-frame point the provisional swing aims at. */
  aim: Vec3;
  /** Scene ms the result arrived (the provisional blends into it from here), or null (a replay: physics only). */
  resultAt: number | null;
}

/** The drawn bat (world frame) at scene time `scene`. */
export function batPoseAt(track: BatTrack, scene: number): BatPose {
  const prov = track.provisionalStart !== null ? provisionalPose(scene - track.provisionalStart, track.aim) : null;
  let pose: BatPose;
  if (track.samples) {
    const phys = batAt(track.samples, sceneToSim(track, scene));
    if (phys) pose = phys;
    else if (prov && track.samples.length === 0) {
      // A swing the physics did not take (unusable input): back to the stance.
      const back = track.resultAt !== null ? smooth((scene - track.resultAt) / RETURN_MS) : 1;
      pose = blendBat(prov, STANCE, back);
    } else pose = prov ?? STANCE;
    if (prov && track.resultAt !== null && scene < track.resultAt + BLEND_MS && track.samples.length > 0) {
      pose = blendBat(prov, pose, smooth((scene - track.resultAt) / BLEND_MS));
    }
  } else pose = prov ?? STANCE;
  return batToWorld(pose, track.mirror);
}

/** True when the drawn bat differs from the stance (the first frame of a swing, for the input-to-bat latency). */
export function batMoved(track: BatTrack, scene: number): boolean {
  const p = batPoseAt(track, scene);
  const s = toWorld(STANCE.toe, track.mirror);
  return Math.hypot(p.toe.x - s.x, p.toe.y - s.y, p.toe.z - s.z) > 0.002;
}

/** Glove centres (world): top hand near the top of the handle, bottom hand below it. */
export function glovesOf(pose: BatPose): { top: Vec3; bottom: Vec3; dir: Vec3 } {
  const dir = norm(v(pose.toe.x - pose.grip.x, pose.toe.y - pose.grip.y, pose.toe.z - pose.grip.z));
  const at = (d: number) => v(pose.grip.x + dir.x * d, pose.grip.y + dir.y * d, pose.grip.z + dir.z * d);
  return { top: at(TOP_HAND_FROM_TOP), bottom: at(HANDS_FROM_TOP), dir };
}

/** The sweet spot of a bat pose (world or physics frame, whichever the pose is in). */
export function sweetSpot(pose: BatPose): Vec3 {
  const len = Math.hypot(pose.toe.x - pose.grip.x, pose.toe.y - pose.grip.y, pose.toe.z - pose.grip.z) || BAT_LENGTH;
  return lerp(pose.grip, pose.toe, SWEET_FROM_GRIP / Math.max(len, SWEET_FROM_GRIP + 0.01));
}

/**
 * First person only, presentation only: while the batter waits and early in the swing, the bat and gloves are drawn
 * in a ready pose in the lower corner of the view (a side-on stance holds them below and beside the eyes, outside
 * any phone's view), so the bat is always in sight and answers the press in the very next frame. The drawn bat is
 * the true bat plus w × (READY − STANCE): it moves with the swing from the first frame, and as w falls to zero before
 * the hitting area it becomes exactly the physics bat (contact, follow-through). External cameras and replays never
 * use it. Physics frame, right-handed (mirrored for a left-hander).
 */
export const FIRST_PERSON_READY: BatPose = (() => {
  const grip = v(0.25, 1.22, 8.15);
  const d = norm(v(0.35, 0.75, 0.45));
  return { grip, toe: v(grip.x + d.x * BAT_LENGTH, grip.y + d.y * BAT_LENGTH, grip.z + d.z * BAT_LENGTH), face: norm(v(-0.35, 0.1, 0.93)) };
})();
/** The ready pose fades between these fractions of the swing's travel. */
export const LIFT_FADE = [0.2, 0.8] as const;

/** Scene ms the drawn swing started (the provisional press, else the physics bat's first sample), or null. */
export function swingStartScene(track: BatTrack): number | null {
  if (track.provisionalStart !== null) return track.provisionalStart;
  const first = track.samples?.[0];
  return first ? track.releaseScene + first.t * 1000 : null;
}

/** Weight of the first-person lift at a scene time: 1 while waiting, 0 from before the hitting area on. */
export function firstPersonLiftWeight(track: BatTrack, scene: number): number {
  const start = swingStartScene(track);
  if (start === null) return 1;
  return 1 - smooth((scene - start - LIFT_FADE[0] * track.travelMs) / ((LIFT_FADE[1] - LIFT_FADE[0]) * track.travelMs));
}

/** The first-person bat (world): the drawn bat, carried towards the ready pose by the lift's weight. */
export function firstPersonBatPose(track: BatTrack, scene: number): BatPose {
  const pose = batPoseAt(track, scene);
  const w = firstPersonLiftWeight(track, scene);
  if (w <= 0) return pose;
  const ready = batToWorld(FIRST_PERSON_READY, track.mirror);
  const stance = batToWorld(STANCE, track.mirror);
  const grip = v(pose.grip.x + (ready.grip.x - stance.grip.x) * w, pose.grip.y + (ready.grip.y - stance.grip.y) * w, pose.grip.z + (ready.grip.z - stance.grip.z) * w);
  const toward = v(pose.toe.x + (ready.toe.x - stance.toe.x) * w - grip.x, pose.toe.y + (ready.toe.y - stance.toe.y) * w - grip.y, pose.toe.z + (ready.toe.z - stance.toe.z) * w - grip.z);
  const len = Math.hypot(pose.toe.x - pose.grip.x, pose.toe.y - pose.grip.y, pose.toe.z - pose.grip.z) || BAT_LENGTH;
  const d = norm(toward);
  return {
    grip,
    toe: v(grip.x + d.x * len, grip.y + d.y * len, grip.z + d.z * len),
    face: norm(v(pose.face.x + (ready.face.x - stance.face.x) * w, pose.face.y + (ready.face.y - stance.face.y) * w, pose.face.z + (ready.face.z - stance.face.z) * w)),
  };
}
