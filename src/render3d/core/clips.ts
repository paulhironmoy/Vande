/**
 * Code-authored animation clips (original work; no motion capture or third-party animation).
 *
 * Each clip is a list of keys. A key holds Euler poses (see skeleton.ts for sign conventions), a root offset in the
 * actor's local frame (x = left, y = up, z = forward), optional arm "aims" (the arm points in the actor's sagittal
 * plane at angle phi: 0 down, 90 back, 180 up, 270 forward, interpolated as angles so a bowling arm windmills the
 * long way round) and, for batters, a bat key (grip point and blade direction) that both arms reach with IK.
 * Bones a key leaves out keep the previous key's value. Sampling is pure and deterministic.
 */
import { BONE_INDEX, BONE_NAMES, type BoneName, type Euler, type Pose } from './skeleton';
import { quatFromEulerDeg, quatSlerp, type Quat } from './quat';
import { clamp, smoothstep } from './math';

export type Vec3T = readonly [number, number, number];
export interface BatKey {
  grip: Vec3T;
  /** Unit-ish vector from the grip to the toe of the bat. */
  dir: Vec3T;
}
export interface ClipKey {
  t: number;
  pose?: Pose;
  root?: Vec3T;
  aimR?: readonly [phi: number, lateral: number];
  aimL?: readonly [phi: number, lateral: number];
  bat?: BatKey;
  /** Left hand on the bat handle (two-handed grip). Default true when a bat key is present. */
  twoHands?: boolean;
}
export interface ClipDef {
  duration: number;
  loop?: boolean;
  linear?: boolean;
  keys: ClipKey[];
  /** Named moments in seconds (release, contact, catch, throw, hit, land). */
  markers?: Record<string, number>;
}

// ---------------------------------------------------------------------------------------------------------------
// Authoring helpers
// ---------------------------------------------------------------------------------------------------------------

const MIRROR: Partial<Record<BoneName, BoneName>> = {
  upperArmL: 'upperArmR',
  upperArmR: 'upperArmL',
  forearmL: 'forearmR',
  forearmR: 'forearmL',
  handL: 'handR',
  handR: 'handL',
  thighL: 'thighR',
  thighR: 'thighL',
  shinL: 'shinR',
  shinR: 'shinL',
  footL: 'footR',
  footR: 'footL',
};

/** Mirror a pose left/right (swap sides, negate Y and Z rotations). */
export function mirrorPose(p: Pose): Pose {
  const out: Pose = {};
  for (const [bone, e] of Object.entries(p) as Array<[BoneName, Euler]>) {
    const target = MIRROR[bone] ?? bone;
    out[target] = [e[0], -e[1], -e[2]];
  }
  return out;
}

function mirrorKey(k: ClipKey, t: number): ClipKey {
  return {
    t,
    pose: k.pose ? mirrorPose(k.pose) : undefined,
    root: k.root ? [-k.root[0], k.root[1], k.root[2]] : undefined,
  };
}

/** A two-phase locomotion cycle: keys A (left leg forward) and B (passing) are mirrored for the second half. */
function cycle(period: number, a: ClipKey, b: ClipKey): ClipDef {
  return {
    duration: period,
    loop: true,
    keys: [
      { ...a, t: 0 },
      { ...b, t: period * 0.25 },
      mirrorKey(a, period * 0.5),
      mirrorKey(b, period * 0.75),
      { ...a, t: period },
    ],
  };
}

const STAND: Pose = {
  hips: [0, 0, 0],
  spine: [2, 0, 0],
  chest: [1, 0, 0],
  neck: [-2, 0, 0],
  head: [0, 0, 0],
  upperArmL: [2, 0, 7],
  forearmL: [-12, 0, 0],
  handL: [0, 0, 0],
  upperArmR: [2, 0, -7],
  forearmR: [-12, 0, 0],
  handR: [0, 0, 0],
  thighL: [0, 0, 2],
  shinL: [2, 0, 0],
  footL: [0, 0, 0],
  thighR: [0, 0, -2],
  shinR: [2, 0, 0],
  footR: [0, 0, 0],
};

const RUN_A: ClipKey = {
  t: 0,
  root: [0, -0.03, 0],
  pose: {
    thighL: [-44, 0, 2],
    shinL: [14, 0, 0],
    footL: [-10, 0, 0],
    thighR: [30, 0, -2],
    shinR: [82, 0, 0],
    footR: [24, 0, 0],
    upperArmL: [40, 0, 8],
    forearmL: [-72, 0, 0],
    upperArmR: [-50, 0, -8],
    forearmR: [-88, 0, 0],
    spine: [14, -8, 0],
    chest: [4, -6, 0],
    neck: [-10, 7, 0],
    head: [-4, 6, 0],
  },
};
const RUN_B: ClipKey = {
  t: 0,
  root: [0, 0.05, 0],
  pose: {
    thighL: [6, 0, 2],
    shinL: [38, 0, 0],
    footL: [18, 0, 0],
    thighR: [-32, 0, -2],
    shinR: [108, 0, 0],
    footR: [8, 0, 0],
    upperArmL: [6, 0, 8],
    forearmL: [-66, 0, 0],
    upperArmR: [-12, 0, -8],
    forearmR: [-76, 0, 0],
    spine: [12, 0, 0],
    chest: [4, 0, 0],
    neck: [-8, 0, 0],
    head: [-4, 0, 0],
  },
};

const scalePose = (p: Pose, k: number): Pose => {
  const out: Pose = {};
  for (const [b, e] of Object.entries(p) as Array<[BoneName, Euler]>) out[b] = [e[0] * k, e[1] * k, e[2] * k];
  return out;
};

const WALK_A: ClipKey = {
  t: 0,
  root: [0, -0.012, 0],
  pose: {
    thighL: [-24, 0, 2],
    shinL: [6, 0, 0],
    footL: [-12, 0, 0],
    thighR: [14, 0, -2],
    shinR: [18, 0, 0],
    footR: [12, 0, 0],
    upperArmL: [16, 0, 7],
    forearmL: [-16, 0, 0],
    upperArmR: [-16, 0, -7],
    forearmR: [-24, 0, 0],
    spine: [3, -4, 0],
    chest: [1, -3, 0],
    neck: [-3, 3, 0],
    head: [0, 2, 0],
  },
};
const WALK_B: ClipKey = {
  t: 0,
  root: [0, 0.012, 0],
  pose: {
    thighL: [2, 0, 2],
    shinL: [10, 0, 0],
    footL: [4, 0, 0],
    thighR: [-12, 0, -2],
    shinR: [42, 0, 0],
    footR: [6, 0, 0],
    upperArmL: [0, 0, 7],
    forearmL: [-14, 0, 0],
    upperArmR: [0, 0, -7],
    forearmR: [-16, 0, 0],
    spine: [3, 0, 0],
    chest: [1, 0, 0],
    neck: [-3, 0, 0],
    head: [0, 0, 0],
  },
};

const READY: Pose = {
  thighL: [-34, 0, 12],
  thighR: [-34, 0, -12],
  shinL: [54, 0, 0],
  shinR: [54, 0, 0],
  footL: [-18, 0, 0],
  footR: [-18, 0, 0],
  spine: [34, 0, 0],
  chest: [8, 0, 0],
  neck: [-30, 0, 0],
  head: [-10, 0, 0],
  upperArmL: [-40, 0, 6],
  forearmL: [-30, 0, 0],
  upperArmR: [-40, 0, -6],
  forearmR: [-30, 0, 0],
  hips: [0, 0, 0],
};

// Batting stance (right-hander). The actor faces the off side; the bowler is on the actor's left (+X).
const STANCE_LOWER: Pose = {
  hips: [0, 0, 0],
  thighL: [-16, 0, 15],
  shinL: [24, 0, 0],
  footL: [-8, -16, 0],
  thighR: [-14, 0, -13],
  shinR: [24, 0, 0],
  footR: [-10, 8, 0],
};
const STANCE_UPPER: Pose = {
  spine: [22, 2, 0],
  chest: [8, 6, 0],
  neck: [-14, 38, 0],
  head: [-6, 32, 0],
  handL: [0, 0, 0],
  handR: [0, 0, 0],
};
const BAT_STANCE: BatKey = { grip: [0.02, 0.78, 0.25], dir: [-0.17, -0.98, 0.09] };
const STANCE_ROOT: Vec3T = [0, -0.07, 0];

const SQUAT: Pose = {
  thighL: [-98, 0, 24],
  thighR: [-98, 0, -24],
  shinL: [128, 0, 0],
  shinR: [128, 0, 0],
  footL: [-28, 0, 0],
  footR: [-28, 0, 0],
  spine: [30, 0, 0],
  chest: [6, 0, 0],
  neck: [-26, 0, 0],
  head: [-10, 0, 0],
  upperArmL: [-52, 0, 10],
  forearmL: [-32, 0, 0],
  upperArmR: [-52, 0, -10],
  forearmR: [-32, 0, 0],
};

// ---------------------------------------------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------------------------------------------

export const CLIPS = {
  idle: {
    duration: 3.2,
    loop: true,
    keys: [
      { t: 0, root: [0, 0, 0], pose: STAND },
      { t: 1.6, root: [0.012, -0.006, 0], pose: { chest: [2.5, 2, 0], upperArmL: [3, 0, 9], upperArmR: [3, 0, -6], head: [1, 4, 0] } },
      { t: 3.2, root: [0, 0, 0], pose: STAND },
    ],
  },
  walk: cycle(1.05, WALK_A, WALK_B),
  jog: cycle(0.78, { ...RUN_A, root: [0, -0.02, 0], pose: scalePose(RUN_A.pose!, 0.62) }, { ...RUN_B, root: [0, 0.025, 0], pose: scalePose(RUN_B.pose!, 0.62) }),
  run: { ...cycle(0.62, RUN_A, RUN_B), linear: true },
  ready: {
    duration: 1.4,
    loop: true,
    keys: [
      { t: 0, root: [0, -0.14, 0], pose: READY },
      { t: 0.7, root: [0, -0.12, 0], pose: { spine: [32, 0, 0], neck: [-28, 0, 0] } },
      { t: 1.4, root: [0, -0.14, 0], pose: READY },
    ],
  },
  dive: {
    duration: 1.3,
    markers: { land: 0.5 },
    keys: [
      { t: 0, root: [0, -0.14, 0], pose: READY },
      { t: 0.12, root: [-0.15, -0.24, 0], pose: { hips: [0, 0, 18], spine: [24, 0, 10], upperArmR: [-120, 0, -30], forearmR: [-10, 0, 0], thighL: [-10, 0, 20], shinL: [20, 0, 0] } },
      { t: 0.3, root: [-0.75, -0.42, 0], pose: { hips: [0, 0, 72], spine: [8, 0, 6], neck: [-10, 0, 0], upperArmR: [-172, 0, -4], forearmR: [-8, 0, 0], upperArmL: [-150, 0, 20], forearmL: [-30, 0, 0], thighL: [8, 0, 10], shinL: [18, 0, 0], thighR: [12, 0, -6], shinR: [12, 0, 0] } },
      { t: 0.5, root: [-1.25, -0.74, 0], pose: { hips: [0, 0, 86], spine: [6, 0, 4] } },
      { t: 0.9, root: [-1.35, -0.76, 0], pose: { hips: [0, 0, 84], upperArmR: [-150, 0, -10], forearmR: [-40, 0, 0], thighL: [-30, 0, 10], shinL: [60, 0, 0] } },
      { t: 1.3, root: [-1.3, -0.5, 0], pose: { hips: [0, 0, 40], spine: [40, 0, 0], thighL: [-80, 0, 10], shinL: [110, 0, 0], thighR: [10, 0, -10], shinR: [100, 0, 0] } },
    ],
  },
  catch_high: {
    duration: 1.3,
    markers: { catch: 0.45 },
    keys: [
      { t: 0, root: [0, -0.04, 0], pose: { ...STAND, neck: [-24, 0, 0], head: [-16, 0, 0], spine: [-4, 0, 0] } },
      { t: 0.3, root: [0, 0, 0], pose: { upperArmL: [-160, 0, 10], upperArmR: [-160, 0, -10], forearmL: [-24, 0, 0], forearmR: [-24, 0, 0], neck: [-28, 0, 0], head: [-18, 0, 0] } },
      { t: 0.45, root: [0, -0.04, 0], pose: { upperArmL: [-168, 0, 3], upperArmR: [-168, 0, -3], forearmL: [-40, 0, 0], forearmR: [-40, 0, 0] } },
      { t: 0.75, root: [0, -0.06, 0], pose: { upperArmL: [-62, 0, 14], upperArmR: [-62, 0, -14], forearmL: [-96, 0, 0], forearmR: [-96, 0, 0], spine: [14, 0, 0], neck: [6, 0, 0], head: [10, 0, 0] } },
      { t: 1.3, root: [0, -0.02, 0], pose: { upperArmL: [-40, 0, 12], upperArmR: [-40, 0, -12], forearmL: [-90, 0, 0], forearmR: [-90, 0, 0], spine: [6, 0, 0], neck: [0, 0, 0], head: [0, 0, 0] } },
    ],
  },
  catch_chest: {
    duration: 1.0,
    markers: { catch: 0.32 },
    keys: [
      { t: 0, root: [0, -0.12, 0], pose: READY },
      { t: 0.2, root: [0, -0.1, 0], pose: { upperArmL: [-84, 0, 8], upperArmR: [-84, 0, -8], forearmL: [-44, 0, 0], forearmR: [-44, 0, 0], spine: [18, 0, 0], neck: [-12, 0, 0] } },
      { t: 0.32, root: [0, -0.12, 0], pose: { upperArmL: [-74, 0, 4], upperArmR: [-74, 0, -4], forearmL: [-62, 0, 0], forearmR: [-62, 0, 0] } },
      { t: 1.0, root: [0, -0.03, 0], pose: { upperArmL: [-44, 0, 14], upperArmR: [-44, 0, -14], forearmL: [-100, 0, 0], forearmR: [-100, 0, 0], spine: [8, 0, 0], neck: [0, 0, 0], thighL: [-6, 0, 2], thighR: [-6, 0, -2], shinL: [10, 0, 0], shinR: [10, 0, 0], footL: [0, 0, 0], footR: [0, 0, 0] } },
    ],
  },
  pickup: {
    duration: 0.8,
    markers: { collect: 0.32 },
    keys: [
      { t: 0, root: [0, -0.1, 0], pose: { ...READY, spine: [30, 0, 0] } },
      { t: 0.32, root: [0, -0.3, 0.1], pose: { spine: [68, 0, 0], chest: [12, 0, 0], neck: [-30, 0, 0], upperArmR: [-70, 0, -6], forearmR: [-8, 0, 0], upperArmL: [-30, 0, 20], thighL: [-62, 0, 10], shinL: [78, 0, 0], thighR: [-20, 0, -8], shinR: [60, 0, 0] } },
      { t: 0.8, root: [0, -0.06, 0], pose: { spine: [16, -30, 0], chest: [4, -20, 0], neck: [-6, 30, 0], upperArmR: [30, 0, -14], forearmR: [-60, 0, 0], thighL: [-20, 0, 10], shinL: [30, 0, 0], thighR: [0, 0, -14], shinR: [20, 0, 0] } },
    ],
  },
  throw: {
    duration: 0.95,
    markers: { release: 0.48 },
    keys: [
      { t: 0, root: [0, -0.05, 0], pose: { hips: [0, -62, 0], spine: [6, -10, 0], chest: [0, -6, 0], neck: [0, 60, 0], head: [0, 12, 0], thighL: [-22, 0, 14], shinL: [16, 0, 0], thighR: [10, 0, -14], shinR: [20, 0, 0], forearmR: [-30, 0, 0], forearmL: [-20, 0, 0] }, aimR: [96, 12], aimL: [262, 6] },
      { t: 0.3, root: [0, -0.08, -0.12], pose: { spine: [-6, -12, 0], forearmR: [-70, 0, 0] }, aimR: [150, 14], aimL: [268, 4] },
      { t: 0.48, root: [0, -0.07, 0.25], pose: { hips: [0, -10, 0], spine: [22, 26, 0], chest: [6, 16, 0], neck: [-6, 10, 0], head: [0, 0, 0], forearmR: [-8, 0, 0], thighL: [-38, 0, 8], shinL: [18, 0, 0], thighR: [24, 0, -8], shinR: [40, 0, 0] }, aimR: [238, 6], aimL: [330, 14] },
      { t: 0.7, root: [0, -0.1, 0.4], pose: { spine: [36, 40, 0], chest: [10, 20, 0], forearmR: [-14, 0, 0] }, aimR: [312, -14], aimL: [20, 20] },
      { t: 0.95, root: [0, -0.04, 0.45], pose: { hips: [0, 0, 0], spine: [14, 10, 0], chest: [3, 4, 0], neck: [-4, 0, 0], thighL: [-8, 0, 4], shinL: [10, 0, 0], thighR: [4, 0, -4], shinR: [12, 0, 0] }, aimR: [340, -8], aimL: [8, 10] },
    ],
  },
  celebrate_jump: {
    duration: 1.5,
    keys: [
      { t: 0, root: [0, -0.02, 0], pose: STAND },
      { t: 0.18, root: [0, -0.16, 0], pose: { thighL: [-46, 0, 6], thighR: [-46, 0, -6], shinL: [74, 0, 0], shinR: [74, 0, 0], footL: [-20, 0, 0], footR: [-20, 0, 0], spine: [24, 0, 0] }, aimR: [50, 12], aimL: [50, 12] },
      { t: 0.36, root: [0, 0.18, 0], pose: { thighL: [-10, 0, 4], thighR: [-10, 0, -4], shinL: [16, 0, 0], shinR: [16, 0, 0], footL: [30, 0, 0], footR: [30, 0, 0], spine: [-8, 0, 0], neck: [-18, 0, 0], forearmL: [-30, 0, 0], forearmR: [-30, 0, 0] }, aimR: [178, 22], aimL: [178, 22] },
      { t: 0.55, root: [0, 0.42, 0], pose: { thighL: [-40, 0, 8], thighR: [-40, 0, -8], shinL: [80, 0, 0], shinR: [80, 0, 0], footL: [20, 0, 0], footR: [20, 0, 0], spine: [-4, 0, 0], forearmL: [-60, 0, 0], forearmR: [-60, 0, 0] }, aimR: [186, 26], aimL: [186, 26] },
      { t: 0.76, root: [0, -0.12, 0], pose: { thighL: [-40, 0, 8], thighR: [-40, 0, -8], shinL: [66, 0, 0], shinR: [66, 0, 0], footL: [-16, 0, 0], footR: [-16, 0, 0], spine: [20, 0, 0], forearmR: [-20, 0, 0] }, aimR: [150, 14], aimL: [80, 30] },
      { t: 1.0, root: [0, -0.04, 0], pose: { thighL: [-12, 0, 6], thighR: [-12, 0, -6], shinL: [20, 0, 0], shinR: [20, 0, 0], footL: [0, 0, 0], footR: [0, 0, 0], spine: [4, 0, 0], forearmR: [-70, 0, 0] }, aimR: [198, 10], aimL: [40, 24] },
      { t: 1.25, root: [0, -0.06, 0], pose: { forearmR: [-110, 0, 0] }, aimR: [120, 12], aimL: [30, 20] },
      { t: 1.5, root: [0, -0.04, 0], pose: { forearmR: [-60, 0, 0] }, aimR: [192, 10], aimL: [36, 22] },
    ],
  },
  celebrate_run: {
    ...cycle(
      0.66,
      { ...RUN_A, pose: { ...RUN_A.pose!, upperArmL: [0, 0, 82], upperArmR: [0, 0, -82], forearmL: [-8, 0, 0], forearmR: [-8, 0, 0], spine: [8, -6, 10] } },
      { ...RUN_B, pose: { ...RUN_B.pose!, upperArmL: [0, 0, 86], upperArmR: [0, 0, -86], forearmL: [-6, 0, 0], forearmR: [-6, 0, 0], spine: [6, 0, 12] } },
    ),
    linear: true,
  },
  clap: {
    duration: 0.5,
    loop: true,
    keys: [
      { t: 0, root: [0, 0, 0], pose: { ...STAND, upperArmL: [-58, 0, 26], upperArmR: [-58, 0, -26], forearmL: [-68, 0, 0], forearmR: [-68, 0, 0] } },
      { t: 0.25, pose: { upperArmL: [-58, 0, 12], upperArmR: [-58, 0, -12], forearmL: [-72, 0, 0], forearmR: [-72, 0, 0] } },
      { t: 0.5, pose: { upperArmL: [-58, 0, 26], upperArmR: [-58, 0, -26], forearmL: [-68, 0, 0], forearmR: [-68, 0, 0] } },
    ],
  },
  hands_on_head: {
    duration: 1.8,
    keys: [
      { t: 0, root: [0, -0.02, 0], pose: STAND },
      { t: 0.35, root: [0, -0.04, 0], pose: { upperArmL: [-160, 0, 42], upperArmR: [-160, 0, -42], forearmL: [-122, 0, 0], forearmR: [-122, 0, 0], spine: [-4, 0, 0], neck: [-14, 0, 0], head: [-8, 0, 0] } },
      { t: 1.2, root: [0, -0.05, 0], pose: { spine: [10, 0, 0], neck: [10, 0, 0], head: [8, 0, 0] } },
      { t: 1.8, root: [0, -0.02, 0], pose: { upperArmL: [10, 0, 22], upperArmR: [10, 0, -22], forearmL: [-80, 0, 0], forearmR: [-80, 0, 0], spine: [6, 0, 0], neck: [0, 0, 0], head: [0, 0, 0] } },
    ],
  },
  appeal: {
    duration: 1.5,
    keys: [
      { t: 0, root: [0, -0.04, 0], pose: { ...STAND, spine: [12, 0, 0] } },
      { t: 0.22, root: [0, 0.1, 0], pose: { spine: [-16, 0, 0], neck: [-20, 0, 0], head: [-10, 0, 0], thighL: [-30, 0, 6], shinL: [50, 0, 0], thighR: [10, 0, -6], shinR: [40, 0, 0], forearmL: [-12, 0, 0], forearmR: [-12, 0, 0] }, aimR: [176, 30], aimL: [176, 30] },
      { t: 0.5, root: [0, 0.02, 0], pose: { spine: [-20, 0, 0] }, aimR: [182, 34], aimL: [182, 34] },
      { t: 1.5, root: [0, -0.02, 0], pose: { spine: [-12, 0, 0], thighL: [-4, 0, 4], shinL: [8, 0, 0], thighR: [0, 0, -4], shinR: [6, 0, 0] }, aimR: [178, 28], aimL: [178, 28] },
    ],
  },
  dejected: {
    duration: 2,
    loop: true,
    keys: [
      { t: 0, root: [0, -0.02, 0], pose: { ...STAND, spine: [14, 0, 0], neck: [24, 0, 0], head: [14, 0, 0], upperArmL: [4, 0, 4], upperArmR: [4, 0, -4] } },
      { t: 1, pose: { neck: [28, 0, 0] } },
      { t: 2, pose: { neck: [24, 0, 0] } },
    ],
  },

  // ---- bowling ----------------------------------------------------------------------------------------------
  bowl_runup: {
    ...cycle(
      0.62,
      { ...RUN_A, pose: { ...RUN_A.pose!, upperArmR: [-34, 0, -6], forearmR: [-112, 0, 0], handR: [20, 0, 0] } },
      { ...RUN_B, pose: { ...RUN_B.pose!, upperArmR: [-26, 0, -6], forearmR: [-108, 0, 0] } },
    ),
    linear: true,
  },
  bowl_approach_spin: {
    ...cycle(
      0.74,
      { ...RUN_A, root: [0, -0.02, 0], pose: { ...scalePose(RUN_A.pose!, 0.6), upperArmR: [-30, 0, -8], forearmR: [-116, 0, 0] } },
      { ...RUN_B, root: [0, 0.03, 0], pose: { ...scalePose(RUN_B.pose!, 0.6), upperArmR: [-26, 0, -8], forearmR: [-112, 0, 0] } },
    ),
    linear: true,
  },
  bowl_pace_long: {
    duration: 1.65,
    markers: { release: 0.62, frontFoot: 0.54 },
    keys: [
      { t: 0, root: [0, -0.03, 0], pose: { ...RUN_A.pose!, hips: [0, 0, 0], forearmR: [-110, 0, 0] }, aimL: [40, 8], aimR: [320, 10] },
      { t: 0.16, root: [0, 0.08, 0], pose: { hips: [0, -20, 0], spine: [6, -10, 0], thighR: [-64, 0, -4], shinR: [76, 0, 0], thighL: [22, 0, 4], shinL: [44, 0, 0], forearmR: [-120, 0, 0], forearmL: [-10, 0, 0] }, aimL: [200, 8], aimR: [300, 12] },
      { t: 0.32, root: [0, 0.16, 0], pose: { hips: [0, -58, 0], spine: [-8, -18, 0], chest: [-4, -8, 0], neck: [0, 50, 0], head: [-6, 18, 0], thighL: [-50, 0, 6], shinL: [56, 0, 0], thighR: [12, 0, -4], shinR: [64, 0, 0], forearmR: [-40, 0, 0], forearmL: [-6, 0, 0] }, aimL: [196, 4], aimR: [48, 16] },
      { t: 0.45, root: [0, -0.02, 0], pose: { hips: [0, -62, 0], spine: [-14, -16, 0], thighL: [-58, 0, 4], shinL: [22, 0, 0], thighR: [18, 0, -4], shinR: [30, 0, 0], forearmR: [-6, 0, 0] }, aimL: [204, 4], aimR: [96, 12] },
      { t: 0.54, root: [0, -0.06, 0], pose: { hips: [0, -36, 0], spine: [2, -6, 0], chest: [2, 0, 0], neck: [-6, 30, 0], head: [-4, 10, 0], thighL: [-40, 0, 2], shinL: [6, 0, 0], footL: [-6, 0, 0], thighR: [32, 0, -6], shinR: [40, 0, 0], forearmL: [-40, 0, 0] }, aimL: [262, 14], aimR: [148, 8] },
      { t: 0.62, root: [0, -0.06, 0], pose: { hips: [0, -4, 0], spine: [24, 14, 0], chest: [10, 6, 0], neck: [-14, 0, 0], head: [-8, 0, 0], thighL: [-30, 0, 2], shinL: [4, 0, 0], thighR: [42, 0, -4], shinR: [58, 0, 0], forearmL: [-98, 0, 0] }, aimL: [340, 30], aimR: [196, 4] },
      { t: 0.76, root: [0, -0.1, 0], pose: { hips: [0, 18, 0], spine: [44, 30, 0], chest: [14, 10, 0], neck: [-26, -10, 0], head: [-10, 0, 0], thighL: [8, 0, 2], shinL: [22, 0, 0], thighR: [-52, 0, -4], shinR: [52, 0, 0], forearmL: [-80, 0, 0], forearmR: [-20, 0, 0] }, aimL: [20, 28], aimR: [292, -18] },
      { t: 0.96, root: [0, -0.04, 0], pose: { ...RUN_B.pose!, hips: [0, 10, 0], spine: [26, 12, 0], forearmR: [-40, 0, 0] }, aimL: [30, 16], aimR: [330, -10] },
      { t: 1.22, root: [0, -0.02, 0], pose: { ...RUN_A.pose!, hips: [0, 0, 0], spine: [14, 0, 0], forearmR: [-60, 0, 0] }, aimL: [36, 10], aimR: [348, -4] },
      { t: 1.65, root: [0, 0, 0], pose: { ...WALK_A.pose!, spine: [6, 0, 0], forearmR: [-30, 0, 0] }, aimL: [8, 7], aimR: [358, -7] },
    ],
  },
  bowl_pace_short: {
    duration: 1.45,
    markers: { release: 0.5, frontFoot: 0.43 },
    keys: [
      { t: 0, root: [0, -0.03, 0], pose: { ...RUN_A.pose!, forearmR: [-110, 0, 0] }, aimL: [40, 8], aimR: [320, 12] },
      { t: 0.14, root: [0, 0.05, 0], pose: { hips: [0, -14, 0], spine: [4, -6, 0], thighR: [-56, 0, -4], shinR: [70, 0, 0], thighL: [20, 0, 4], shinL: [40, 0, 0], forearmR: [-110, 0, 0] }, aimL: [170, 12], aimR: [310, 14] },
      { t: 0.3, root: [0, 0.07, 0], pose: { hips: [0, -32, 0], spine: [-6, -10, 0], neck: [0, 28, 0], thighL: [-46, 0, 6], shinL: [46, 0, 0], thighR: [14, 0, -4], shinR: [50, 0, 0], forearmR: [-30, 0, 0] }, aimL: [190, 10], aimR: [70, 20] },
      { t: 0.43, root: [0, -0.05, 0], pose: { hips: [0, -22, 0], spine: [4, -4, 0], neck: [-6, 18, 0], thighL: [-38, 0, 2], shinL: [8, 0, 0], thighR: [30, 0, -6], shinR: [38, 0, 0], forearmR: [-4, 0, 0], forearmL: [-40, 0, 0] }, aimL: [258, 16], aimR: [150, 14] },
      { t: 0.5, root: [0, -0.06, 0], pose: { hips: [0, 0, 0], spine: [24, 14, 0], chest: [10, 6, 0], neck: [-14, 0, 0], thighL: [-30, 0, 2], shinL: [4, 0, 0], thighR: [40, 0, -4], shinR: [56, 0, 0], forearmL: [-96, 0, 0] }, aimL: [336, 30], aimR: [200, 12] },
      { t: 0.64, root: [0, -0.1, 0], pose: { hips: [0, 16, 0], spine: [40, 28, 0], neck: [-24, -8, 0], thighL: [6, 0, 2], shinL: [20, 0, 0], thighR: [-48, 0, -4], shinR: [50, 0, 0], forearmR: [-20, 0, 0] }, aimL: [18, 26], aimR: [294, -14] },
      { t: 0.86, root: [0, -0.04, 0], pose: { ...RUN_B.pose!, hips: [0, 6, 0], spine: [24, 10, 0], forearmR: [-40, 0, 0] }, aimL: [30, 16], aimR: [334, -10] },
      { t: 1.45, root: [0, 0, 0], pose: { ...WALK_A.pose!, spine: [6, 0, 0] }, aimL: [8, 7], aimR: [358, -7] },
    ],
  },
  bowl_side_on: {
    duration: 1.6,
    markers: { release: 0.6, frontFoot: 0.52 },
    keys: [
      { t: 0, root: [0, -0.03, 0], pose: { ...RUN_A.pose!, forearmR: [-110, 0, 0] }, aimL: [40, 8], aimR: [320, 10] },
      { t: 0.16, root: [0, 0.1, 0], pose: { hips: [0, -30, 0], spine: [4, -14, 0], thighR: [-62, 0, -4], shinR: [76, 0, 0], thighL: [22, 0, 4], shinL: [44, 0, 0], forearmR: [-120, 0, 0], neck: [0, 30, 0] }, aimL: [206, 4], aimR: [292, 8] },
      { t: 0.34, root: [0, 0.14, 0], pose: { hips: [0, -84, 0], spine: [-10, -6, 0], chest: [-6, 0, 0], neck: [0, 70, 0], head: [-8, 14, 0], thighL: [-52, 0, 6], shinL: [58, 0, 0], thighR: [10, 0, -4], shinR: [66, 0, 0], forearmR: [-30, 0, 0], forearmL: [-4, 0, 0] }, aimL: [200, 2], aimR: [60, 8] },
      { t: 0.46, root: [0, -0.02, 0], pose: { hips: [0, -88, 0], spine: [-16, -4, 0], neck: [0, 74, 0], thighL: [-58, 0, 4], shinL: [18, 0, 0], thighR: [16, 0, -4], shinR: [28, 0, 0], forearmR: [-4, 0, 0] }, aimL: [210, 2], aimR: [104, 6] },
      { t: 0.52, root: [0, -0.06, 0], pose: { hips: [0, -60, 0], spine: [-4, -2, 0], neck: [-6, 52, 0], thighL: [-40, 0, 2], shinL: [6, 0, 0], thighR: [32, 0, -6], shinR: [40, 0, 0], forearmL: [-36, 0, 0] }, aimL: [256, 8], aimR: [150, 4] },
      { t: 0.6, root: [0, -0.06, 0], pose: { hips: [0, -14, 0], spine: [20, 8, 0], chest: [8, 4, 0], neck: [-12, 6, 0], head: [-8, 0, 0], thighL: [-30, 0, 2], shinL: [4, 0, 0], thighR: [42, 0, -4], shinR: [56, 0, 0], forearmL: [-100, 0, 0] }, aimL: [346, 26], aimR: [192, 2] },
      { t: 0.76, root: [0, -0.1, 0], pose: { hips: [0, 20, 0], spine: [46, 32, 0], chest: [14, 10, 0], neck: [-26, -10, 0], thighL: [8, 0, 2], shinL: [22, 0, 0], thighR: [-52, 0, -4], shinR: [52, 0, 0], forearmR: [-20, 0, 0] }, aimL: [18, 28], aimR: [290, -20] },
      { t: 0.98, root: [0, -0.04, 0], pose: { ...RUN_B.pose!, hips: [0, 8, 0], spine: [26, 12, 0], forearmR: [-40, 0, 0] }, aimL: [30, 16], aimR: [330, -10] },
      { t: 1.6, root: [0, 0, 0], pose: { ...WALK_A.pose!, spine: [6, 0, 0] }, aimL: [8, 7], aimR: [358, -7] },
    ],
  },
  bowl_off_spin: {
    duration: 1.4,
    markers: { release: 0.52, frontFoot: 0.44 },
    keys: [
      { t: 0, root: [0, -0.02, 0], pose: { ...scalePose(RUN_A.pose!, 0.6), forearmR: [-116, 0, 0], handR: [0, 50, 0] }, aimL: [30, 8], aimR: [320, 8] },
      { t: 0.18, root: [0, 0.1, 0], pose: { hips: [0, -40, 0], spine: [-2, -10, 0], neck: [0, 40, 0], thighR: [-50, 0, -4], shinR: [70, 0, 0], thighL: [14, 0, 4], shinL: [40, 0, 0], forearmR: [-120, 0, 0], handR: [0, 60, 0] }, aimL: [180, 6], aimR: [300, 6] },
      { t: 0.34, root: [0, 0.02, 0], pose: { hips: [0, -78, 0], spine: [-6, -8, 0], neck: [0, 66, 0], thighL: [-44, 0, 6], shinL: [30, 0, 0], thighR: [14, 0, -4], shinR: [30, 0, 0], forearmR: [-30, 0, 0] }, aimL: [196, 2], aimR: [92, 4] },
      { t: 0.44, root: [0, -0.06, 0], pose: { hips: [0, -50, 0], spine: [4, -2, 0], neck: [-6, 46, 0], thighL: [-36, 0, 2], shinL: [8, 0, 0], thighR: [28, 0, -6], shinR: [40, 0, 0], forearmR: [-8, 0, 0], forearmL: [-40, 0, 0] }, aimL: [250, 6], aimR: [150, 2] },
      { t: 0.52, root: [0, -0.08, 0], pose: { hips: [0, -10, 0], spine: [20, 18, 0], chest: [6, 10, 0], neck: [-12, 4, 0], thighL: [-28, 0, 2], shinL: [8, 0, 0], thighR: [38, 0, -4], shinR: [54, 0, 0], forearmL: [-100, 0, 0], handR: [10, -40, 0] }, aimL: [336, 24], aimR: [188, 0] },
      { t: 0.7, root: [0, -0.14, 0], pose: { hips: [0, 38, 0], spine: [48, 40, 0], chest: [14, 14, 0], neck: [-28, -24, 0], thighL: [-10, 0, 2], shinL: [36, 0, 0], thighR: [-46, 0, -20], shinR: [60, 0, 0], handR: [0, -50, 0], forearmR: [-30, 0, 0] }, aimL: [10, 24], aimR: [300, -24] },
      { t: 0.95, root: [0, -0.06, 0], pose: { hips: [0, 20, 0], spine: [22, 14, 0], neck: [-10, -8, 0], thighL: [-14, 0, 4], shinL: [24, 0, 0], thighR: [-6, 0, -8], shinR: [30, 0, 0], handR: [0, 0, 0] }, aimL: [20, 14], aimR: [330, -10] },
      { t: 1.4, root: [0, 0, 0], pose: { ...STAND, spine: [6, 0, 0] }, aimL: [6, 7], aimR: [358, -7] },
    ],
  },
  bowl_leg_spin: {
    duration: 1.45,
    markers: { release: 0.54, frontFoot: 0.46 },
    keys: [
      { t: 0, root: [0, -0.02, 0], pose: { ...scalePose(RUN_A.pose!, 0.6), forearmR: [-116, 0, 0], handR: [0, 0, -40] }, aimL: [30, 8], aimR: [320, 10] },
      { t: 0.2, root: [0, 0.14, 0], pose: { hips: [0, -30, 0], spine: [-4, -8, 0], neck: [0, 30, 0], thighR: [-56, 0, -4], shinR: [80, 0, 0], thighL: [20, 0, 4], shinL: [50, 0, 0], forearmR: [-110, 0, 0], handR: [0, 0, -50] }, aimL: [186, 12], aimR: [298, 14] },
      { t: 0.36, root: [0, 0.03, 0], pose: { hips: [0, -66, 0], spine: [-8, -6, 0], neck: [0, 56, 0], thighL: [-46, 0, 6], shinL: [30, 0, 0], thighR: [14, 0, -4], shinR: [32, 0, 0], forearmR: [-34, 0, 0] }, aimL: [200, 6], aimR: [96, 16] },
      { t: 0.46, root: [0, -0.06, 0], pose: { hips: [0, -40, 0], spine: [6, 0, 0], neck: [-6, 40, 0], thighL: [-36, 0, 2], shinL: [8, 0, 0], thighR: [28, 0, -6], shinR: [40, 0, 0], forearmR: [-10, 0, 0], forearmL: [-40, 0, 0] }, aimL: [248, 10], aimR: [148, 14] },
      { t: 0.54, root: [0, -0.07, 0], pose: { hips: [0, -2, 0], spine: [22, 20, 0], chest: [6, 10, 0], neck: [-12, 0, 0], thighL: [-28, 0, 2], shinL: [8, 0, 0], thighR: [38, 0, -4], shinR: [54, 0, 0], forearmL: [-100, 0, 0], handR: [0, 0, 50] }, aimL: [334, 26], aimR: [196, 14] },
      { t: 0.72, root: [0, -0.12, 0], pose: { hips: [0, 30, 0], spine: [44, 34, 0], chest: [12, 12, 0], neck: [-26, -16, 0], thighL: [-8, 0, 2], shinL: [30, 0, 0], thighR: [-44, 0, -14], shinR: [56, 0, 0], handR: [0, 0, 30], forearmR: [-30, 0, 0] }, aimL: [14, 24], aimR: [296, -20] },
      { t: 0.98, root: [0, 0.02, 0], pose: { ...RUN_B.pose!, hips: [0, 10, 0], spine: [18, 8, 0], handR: [0, 0, 0] }, aimL: [24, 14], aimR: [334, -10] },
      { t: 1.45, root: [0, 0, 0], pose: { ...STAND, spine: [6, 0, 0] }, aimL: [6, 7], aimR: [358, -7] },
    ],
  },

  // ---- wicketkeeping -----------------------------------------------------------------------------------------
  keep_crouch: {
    duration: 1.2,
    loop: true,
    keys: [
      { t: 0, root: [0, -0.5, 0], pose: SQUAT },
      { t: 0.6, root: [0, -0.49, 0], pose: { neck: [-24, 0, 0] } },
      { t: 1.2, root: [0, -0.5, 0], pose: SQUAT },
    ],
  },
  keep_take: {
    duration: 1.0,
    markers: { catch: 0.3 },
    keys: [
      { t: 0, root: [0, -0.5, 0], pose: SQUAT },
      { t: 0.18, root: [0, -0.3, 0], pose: { thighL: [-70, 0, 20], thighR: [-70, 0, -20], shinL: [96, 0, 0], shinR: [96, 0, 0], spine: [24, 0, 0], upperArmL: [-74, 0, 6], upperArmR: [-74, 0, -6], forearmL: [-36, 0, 0], forearmR: [-36, 0, 0] } },
      { t: 0.3, root: [0, -0.26, 0], pose: { upperArmL: [-66, 0, 2], upperArmR: [-66, 0, -2], forearmL: [-52, 0, 0], forearmR: [-52, 0, 0] } },
      { t: 1.0, root: [0, -0.08, 0], pose: { thighL: [-22, 0, 10], thighR: [-22, 0, -10], shinL: [32, 0, 0], shinR: [32, 0, 0], footL: [-8, 0, 0], footR: [-8, 0, 0], spine: [10, 0, 0], neck: [-6, 0, 0], head: [0, 0, 0], upperArmL: [-40, 0, 14], upperArmR: [-40, 0, -14], forearmL: [-96, 0, 0], forearmR: [-96, 0, 0] } },
    ],
  },
  keep_stump: {
    duration: 1.1,
    markers: { catch: 0.22, hit: 0.42 },
    keys: [
      { t: 0, root: [0, -0.5, 0], pose: SQUAT },
      { t: 0.22, root: [0, -0.32, 0], pose: { thighL: [-70, 0, 20], thighR: [-70, 0, -20], shinL: [96, 0, 0], shinR: [96, 0, 0], upperArmL: [-70, 0, 4], upperArmR: [-70, 0, -4], forearmL: [-48, 0, 0], forearmR: [-48, 0, 0] } },
      { t: 0.42, root: [0, -0.4, 0.15], pose: { spine: [48, 10, 0], upperArmL: [-40, 0, -10], upperArmR: [-30, 0, 10], forearmL: [-20, 0, 0], forearmR: [-20, 0, 0] } },
      { t: 1.1, root: [0, -0.1, 0.1], pose: { thighL: [-20, 0, 8], thighR: [-20, 0, -8], shinL: [30, 0, 0], shinR: [30, 0, 0], spine: [-10, 0, 0], neck: [-20, 0, 0] }, aimR: [175, 25], aimL: [175, 25] },
    ],
  },

  // ---- umpiring ----------------------------------------------------------------------------------------------
  ump_stand: {
    duration: 3,
    loop: true,
    keys: [
      { t: 0, root: [0, 0, 0], pose: { ...STAND, spine: [8, 0, 0], upperArmL: [-16, 0, -14], upperArmR: [-16, 0, 14], forearmL: [-62, 0, 0], forearmR: [-62, 0, 0] } },
      { t: 1.5, pose: { spine: [9, 0, 0], head: [2, 4, 0] } },
      { t: 3, pose: { spine: [8, 0, 0], head: [0, 0, 0] } },
    ],
  },
  ump_four: {
    duration: 2.2,
    keys: [
      { t: 0, root: [0, 0, 0], pose: { ...STAND } },
      { t: 0.3, pose: { upperArmR: [-88, 0, -40], forearmR: [-4, 0, 0] } },
      { t: 0.65, pose: { upperArmR: [-88, 0, 40] } },
      { t: 1.0, pose: { upperArmR: [-88, 0, -40] } },
      { t: 1.35, pose: { upperArmR: [-88, 0, 40] } },
      { t: 1.7, pose: { upperArmR: [-88, 0, -30] } },
      { t: 2.2, pose: { upperArmR: [-10, 0, -8], forearmR: [-20, 0, 0] } },
    ],
  },
  ump_six: {
    duration: 2.2,
    keys: [
      { t: 0, root: [0, 0, 0], pose: STAND },
      { t: 0.4, pose: { upperArmL: [-178, 0, 8], upperArmR: [-178, 0, -8], forearmL: [-4, 0, 0], forearmR: [-4, 0, 0] } },
      { t: 1.8, pose: { upperArmL: [-176, 0, 10], upperArmR: [-176, 0, -10] } },
      { t: 2.2, pose: { upperArmL: [-8, 0, 8], upperArmR: [-8, 0, -8], forearmL: [-20, 0, 0], forearmR: [-20, 0, 0] } },
    ],
  },
  ump_out: {
    duration: 2.2,
    keys: [
      { t: 0, root: [0, 0, 0], pose: { ...STAND, upperArmL: [-16, 0, -14], upperArmR: [-16, 0, 14], forearmL: [-62, 0, 0], forearmR: [-62, 0, 0] } },
      { t: 0.5, pose: { upperArmL: [-16, 0, -14], forearmL: [-62, 0, 0] } },
      { t: 0.9, pose: { upperArmR: [-176, 0, -4], forearmR: [-2, 0, 0] } },
      { t: 1.9, pose: { upperArmR: [-176, 0, -4] } },
      { t: 2.2, pose: { upperArmR: [-20, 0, -8], forearmR: [-30, 0, 0] } },
    ],
  },

  // ---- batting: lower body (footwork) -----------------------------------------------------------------------
  stance: {
    duration: 2.4,
    loop: true,
    keys: [
      { t: 0, root: STANCE_ROOT, pose: { ...STANCE_LOWER, ...STANCE_UPPER }, bat: BAT_STANCE },
      { t: 0.6, root: [0, -0.075, 0], bat: { grip: [0.02, 0.82, 0.25], dir: [-0.15, -0.98, 0.1] } },
      { t: 1.2, root: STANCE_ROOT, bat: BAT_STANCE },
      { t: 2.4, root: STANCE_ROOT, bat: BAT_STANCE },
    ],
  },
  foot_still: {
    duration: 1,
    keys: [
      { t: 0, root: STANCE_ROOT, pose: STANCE_LOWER },
      { t: 0.3, root: [0, -0.1, 0], pose: { thighL: [-20, 0, 15], shinL: [30, 0, 0], thighR: [-18, 0, -13], shinR: [30, 0, 0] } },
      { t: 1, root: [0, -0.09, 0] },
    ],
  },
  foot_forward: {
    duration: 1,
    keys: [
      { t: 0, root: STANCE_ROOT, pose: STANCE_LOWER },
      { t: 0.14, root: [0.06, -0.06, 0], pose: { thighL: [-30, 0, 22], shinL: [52, 0, 0], footL: [10, -16, 0] } },
      { t: 0.32, root: [0.3, -0.13, 0.02], pose: { hips: [0, 6, 0], thighL: [-34, 0, 34], shinL: [34, 0, 0], footL: [-10, -20, 0], thighR: [8, 0, -26], shinR: [16, 0, 0], footR: [10, 10, 0] } },
      { t: 1, root: [0.32, -0.14, 0.02] },
    ],
  },
  foot_back: {
    duration: 1,
    keys: [
      { t: 0, root: STANCE_ROOT, pose: STANCE_LOWER },
      { t: 0.16, root: [-0.08, -0.04, 0.04], pose: { thighR: [-26, 0, -22], shinR: [48, 0, 0] } },
      { t: 0.32, root: [-0.24, -0.04, 0.06], pose: { hips: [0, -8, 0], thighR: [-6, 0, -26], shinR: [14, 0, 0], footR: [-6, 14, 0], thighL: [-8, 0, 6], shinL: [18, 0, 0], footL: [6, -10, 0] } },
      { t: 1, root: [-0.24, -0.05, 0.06] },
    ],
  },
  foot_across: {
    duration: 1,
    keys: [
      { t: 0, root: STANCE_ROOT, pose: STANCE_LOWER },
      { t: 0.16, root: [-0.02, -0.05, 0.08], pose: { thighR: [-40, 0, -10], shinR: [50, 0, 0] } },
      { t: 0.32, root: [-0.04, -0.08, 0.16], pose: { hips: [0, 10, 0], thighR: [-28, 0, -4], shinR: [24, 0, 0], footR: [-8, 20, 0], thighL: [-6, 0, 16], shinL: [20, 0, 0] } },
      { t: 1, root: [-0.04, -0.08, 0.16] },
    ],
  },
  foot_charge: {
    duration: 1,
    keys: [
      { t: 0, root: STANCE_ROOT, pose: STANCE_LOWER },
      { t: 0.12, root: [0.3, -0.04, 0], pose: { hips: [0, 30, 0], thighL: [-30, 0, 20], shinL: [40, 0, 0], thighR: [10, 0, -10], shinR: [50, 0, 0] } },
      { t: 0.24, root: [0.75, 0.01, 0], pose: { hips: [0, 20, 0], thighL: [8, 0, 10], shinL: [50, 0, 0], thighR: [-30, 0, -16], shinR: [30, 0, 0] } },
      { t: 0.36, root: [1.15, -0.13, 0], pose: { hips: [0, 4, 0], thighL: [-36, 0, 32], shinL: [30, 0, 0], footL: [-10, -20, 0], thighR: [10, 0, -26], shinR: [18, 0, 0] } },
      { t: 1, root: [1.2, -0.14, 0] },
    ],
  },
  foot_sweep: {
    duration: 1.2,
    keys: [
      { t: 0, root: STANCE_ROOT, pose: STANCE_LOWER },
      { t: 0.3, root: [0.25, -0.34, 0], pose: { thighL: [-70, 0, 26], shinL: [80, 0, 0], footL: [-12, -10, 0], thighR: [24, 0, -18], shinR: [100, 0, 0], footR: [34, 0, 0] } },
      { t: 0.42, root: [0.3, -0.46, 0], pose: { thighL: [-80, 0, 28], shinL: [90, 0, 0], thighR: [30, 0, -14], shinR: [118, 0, 0] } },
      { t: 1.2, root: [0.3, -0.46, 0] },
    ],
  },

  // ---- batting: shots (upper body + bat path; contact marker = bat meets ball) --------------------------------
  bat_block: {
    duration: 1.2,
    markers: { contact: 0.42 },
    keys: [
      { t: 0, pose: STANCE_UPPER, bat: BAT_STANCE },
      { t: 0.2, pose: { spine: [20, -4, 0] }, bat: { grip: [-0.02, 0.98, 0.2], dir: [-0.5, 0.84, -0.18] } },
      { t: 0.36, pose: { spine: [30, 4, 0], neck: [-6, 32, 0], head: [6, 26, 0] }, bat: { grip: [0.2, 0.8, 0.34], dir: [0.18, -0.98, 0.05] } },
      { t: 0.42, pose: { spine: [34, 6, 0] }, bat: { grip: [0.3, 0.72, 0.36], dir: [0.34, -0.94, 0.05] } },
      { t: 1.2, pose: { spine: [32, 6, 0] }, bat: { grip: [0.3, 0.73, 0.35], dir: [0.32, -0.95, 0.05] } },
    ],
  },
  bat_push: {
    duration: 1.2,
    markers: { contact: 0.44 },
    keys: [
      { t: 0, pose: STANCE_UPPER, bat: BAT_STANCE },
      { t: 0.22, pose: { spine: [22, -6, 0] }, bat: { grip: [-0.05, 1.04, 0.18], dir: [-0.56, 0.8, -0.2] } },
      { t: 0.38, pose: { spine: [30, 6, 0], head: [6, 26, 0] }, bat: { grip: [0.18, 0.86, 0.34], dir: [-0.1, -0.99, 0.08] } },
      { t: 0.44, pose: { spine: [32, 10, 0] }, bat: { grip: [0.32, 0.76, 0.34], dir: [0.18, -0.98, 0.06] } },
      { t: 0.7, pose: { spine: [26, 14, 0] }, bat: { grip: [0.42, 0.98, 0.3], dir: [0.6, -0.78, -0.12] } },
      { t: 1.2, pose: { spine: [24, 12, 0] }, bat: { grip: [0.38, 0.92, 0.3], dir: [0.5, -0.85, -0.1] } },
    ],
  },
  bat_drive: {
    duration: 1.5,
    markers: { contact: 0.48 },
    keys: [
      { t: 0, pose: STANCE_UPPER, bat: BAT_STANCE },
      { t: 0.22, pose: { spine: [24, -12, 0], chest: [6, -4, 0] }, bat: { grip: [-0.1, 1.14, 0.16], dir: [-0.56, 0.78, -0.26] } },
      { t: 0.4, pose: { spine: [30, 2, 0], chest: [8, 4, 0], head: [4, 28, 0] }, bat: { grip: [0.14, 0.98, 0.32], dir: [-0.28, -0.95, 0.1] } },
      { t: 0.48, pose: { spine: [34, 8, 0], neck: [-4, 30, 0], head: [8, 24, 0] }, bat: { grip: [0.34, 0.78, 0.3], dir: [0.06, -0.99, 0.08] } },
      { t: 0.68, pose: { spine: [22, 20, 0], chest: [6, 12, 0] }, bat: { grip: [0.44, 1.26, 0.22], dir: [0.66, 0.68, -0.26] } },
      { t: 0.98, pose: { spine: [12, 24, 0], chest: [2, 14, 0], neck: [-14, 20, 0], head: [-6, 16, 0] }, bat: { grip: [0.3, 1.54, 0.1], dir: [0.24, 0.9, -0.36] } },
      { t: 1.5, pose: { spine: [12, 22, 0] }, bat: { grip: [0.28, 1.46, 0.12], dir: [0.26, 0.9, -0.34] } },
    ],
  },
  bat_loft: {
    duration: 1.6,
    markers: { contact: 0.5 },
    keys: [
      { t: 0, pose: STANCE_UPPER, bat: BAT_STANCE },
      { t: 0.24, pose: { spine: [20, -20, 0], chest: [4, -8, 0] }, bat: { grip: [-0.16, 1.3, 0.12], dir: [-0.76, 0.6, -0.24] } },
      { t: 0.42, pose: { spine: [26, 0, 0], chest: [6, 2, 0], head: [2, 26, 0] }, bat: { grip: [0.12, 1.04, 0.3], dir: [-0.42, -0.9, 0.08] } },
      { t: 0.5, pose: { spine: [24, 10, 0], neck: [-10, 30, 0], head: [0, 20, 0] }, bat: { grip: [0.32, 0.86, 0.28], dir: [0.22, -0.96, 0.12] } },
      { t: 0.72, pose: { spine: [6, 30, 0], chest: [-4, 16, 0], neck: [-24, 16, 0], head: [-16, 10, 0] }, bat: { grip: [0.36, 1.48, 0.12], dir: [0.5, 0.82, -0.28] } },
      { t: 1.0, pose: { spine: [-2, 36, 0], chest: [-6, 18, 0], neck: [-30, 12, 0], head: [-20, 8, 0] }, bat: { grip: [0.22, 1.68, -0.04], dir: [-0.06, 0.82, -0.56] } },
      { t: 1.6, pose: { spine: [2, 34, 0], neck: [-28, 12, 0] }, bat: { grip: [0.2, 1.62, -0.02], dir: [-0.08, 0.82, -0.56] } },
    ],
  },
  bat_cut: {
    duration: 1.4,
    markers: { contact: 0.46 },
    keys: [
      { t: 0, pose: STANCE_UPPER, bat: BAT_STANCE },
      { t: 0.22, pose: { spine: [16, -16, 0], chest: [4, -6, 0] }, bat: { grip: [-0.12, 1.3, 0.12], dir: [-0.6, 0.72, -0.34] } },
      { t: 0.38, pose: { spine: [18, -4, 0], head: [2, 22, 0] }, bat: { grip: [0.04, 1.26, 0.3], dir: [0.1, 0.2, 0.97] } },
      { t: 0.46, pose: { spine: [26, 6, 0], neck: [-8, 22, 0], head: [8, 18, 0] }, bat: { grip: [0.16, 1.06, 0.4], dir: [0.18, -0.3, 0.94] } },
      { t: 0.7, pose: { spine: [24, 14, 0] }, bat: { grip: [0.06, 1.0, 0.44], dir: [-0.3, -0.5, 0.81] } },
      { t: 1.4, pose: { spine: [18, 10, 0] }, bat: { grip: [0.02, 1.08, 0.36], dir: [-0.22, -0.6, 0.77] } },
    ],
  },
  bat_pull: {
    duration: 1.4,
    markers: { contact: 0.46 },
    keys: [
      { t: 0, pose: STANCE_UPPER, bat: BAT_STANCE },
      { t: 0.22, pose: { spine: [14, -16, 0], chest: [2, -8, 0] }, bat: { grip: [-0.12, 1.32, 0.12], dir: [-0.62, 0.74, -0.24] } },
      { t: 0.38, pose: { spine: [10, 14, 0], chest: [0, 10, 0], head: [-2, 20, 0] }, bat: { grip: [0.08, 1.22, 0.3], dir: [0.4, 0.3, 0.86] } },
      { t: 0.46, pose: { spine: [8, 34, 0], chest: [0, 18, 0], neck: [-8, 10, 0], head: [-2, 8, 0] }, bat: { grip: [0.2, 1.18, 0.24], dir: [0.94, -0.06, 0.32] } },
      { t: 0.66, pose: { spine: [8, 58, 0], chest: [0, 24, 0], neck: [-10, -10, 0] }, bat: { grip: [0.06, 1.3, 0.04], dir: [0.2, 0.3, -0.93] } },
      { t: 1.4, pose: { spine: [8, 56, 0], chest: [0, 24, 0] }, bat: { grip: [-0.04, 1.36, 0.0], dir: [-0.1, 0.5, -0.86] } },
    ],
  },
  bat_sweep: {
    duration: 1.6,
    markers: { contact: 0.56 },
    keys: [
      { t: 0, pose: STANCE_UPPER, bat: BAT_STANCE },
      { t: 0.26, pose: { spine: [26, -10, 0] }, bat: { grip: [-0.06, 1.02, 0.18], dir: [-0.62, 0.72, -0.3] } },
      { t: 0.44, pose: { spine: [38, 0, 0], head: [6, 26, 0] }, bat: { grip: [0.18, 0.62, 0.32], dir: [0.3, -0.5, 0.81] } },
      { t: 0.56, pose: { spine: [40, 14, 0], neck: [-6, 22, 0], head: [8, 18, 0] }, bat: { grip: [0.26, 0.5, 0.32], dir: [0.82, -0.36, 0.44] } },
      { t: 0.8, pose: { spine: [38, 40, 0], chest: [6, 16, 0] }, bat: { grip: [0.1, 0.58, 0.14], dir: [0.2, -0.2, -0.96] } },
      { t: 1.6, pose: { spine: [36, 40, 0] }, bat: { grip: [0.06, 0.62, 0.1], dir: [0.1, -0.2, -0.97] } },
    ],
  },
  bat_leave: {
    duration: 1.3,
    markers: { contact: 0.46 },
    keys: [
      { t: 0, pose: STANCE_UPPER, bat: BAT_STANCE },
      { t: 0.24, pose: { spine: [16, -6, 0] }, bat: { grip: [-0.08, 1.2, 0.12], dir: [-0.5, 0.8, -0.3] } },
      { t: 0.46, pose: { spine: [10, -10, 0], neck: [-6, 46, 0], head: [-4, 30, 0] }, bat: { grip: [-0.12, 1.46, 0.04], dir: [-0.24, 0.92, -0.3] } },
      { t: 1.3, pose: { spine: [10, -8, 0] }, bat: { grip: [-0.12, 1.44, 0.04], dir: [-0.24, 0.92, -0.3] } },
    ],
  },
  bat_run: {
    ...cycle(
      0.64,
      { ...RUN_A, pose: { ...RUN_A.pose!, upperArmR: [-40, 0, -8], forearmR: [-30, 0, 0] }, bat: { grip: [-0.3, 0.9, 0.3], dir: [0.1, -0.35, 0.93] }, twoHands: false },
      { ...RUN_B, pose: { ...RUN_B.pose!, upperArmR: [-40, 0, -8], forearmR: [-30, 0, 0] }, bat: { grip: [-0.3, 0.94, 0.32], dir: [0.1, -0.3, 0.95] }, twoHands: false },
    ),
    linear: true,
  },
  bat_raise: {
    duration: 1.8,
    keys: [
      { t: 0, root: [0, -0.04, 0], pose: { ...STAND, spine: [6, 0, 0] }, bat: { grip: [-0.24, 0.86, 0.12], dir: [0.1, -0.98, 0.1] }, twoHands: false },
      { t: 0.5, root: [0, -0.02, 0], pose: { spine: [-6, 0, 0], neck: [-16, 0, 0] }, bat: { grip: [-0.22, 1.98, 0.12], dir: [0.06, 0.96, 0.24] }, aimL: [176, 30], twoHands: false },
      { t: 1.4, root: [0, -0.02, 0], bat: { grip: [-0.22, 2.0, 0.1], dir: [0.12, 0.96, 0.22] }, aimL: [170, 32], twoHands: false },
      { t: 1.8, root: [0, -0.03, 0], pose: { spine: [4, 0, 0], neck: [-4, 0, 0] }, bat: { grip: [-0.24, 0.9, 0.12], dir: [0.1, -0.98, 0.1] }, aimL: [10, 8], twoHands: false },
    ],
  },
  bat_walk: {
    ...cycle(
      1.1,
      { ...WALK_A, pose: { ...WALK_A.pose!, neck: [22, 0, 0], head: [10, 0, 0], spine: [8, 0, 0], upperArmR: [-20, 0, -14], forearmR: [-50, 0, 0] }, bat: { grip: [-0.26, 0.98, 0.18], dir: [0.12, -0.2, 0.97] }, twoHands: false },
      { ...WALK_B, pose: { ...WALK_B.pose!, neck: [24, 0, 0], head: [10, 0, 0], spine: [8, 0, 0], upperArmR: [-20, 0, -14], forearmR: [-50, 0, 0] }, bat: { grip: [-0.26, 0.98, 0.18], dir: [0.12, -0.2, 0.97] }, twoHands: false },
    ),
  },
} satisfies Record<string, ClipDef>;

export type ClipId = keyof typeof CLIPS;

// ---------------------------------------------------------------------------------------------------------------
// Compilation and sampling
// ---------------------------------------------------------------------------------------------------------------

const NB = BONE_NAMES.length;

interface CompiledKey {
  t: number;
  q: Float32Array; // NB * 4
  root: [number, number, number];
  aimR: [number, number] | null;
  aimL: [number, number] | null;
  bat: { grip: [number, number, number]; dir: [number, number, number] } | null;
  twoHands: boolean;
}
interface CompiledClip {
  id: ClipId;
  duration: number;
  loop: boolean;
  linear: boolean;
  keys: CompiledKey[];
  markers: Record<string, number>;
  hasBat: boolean;
  hasAimR: boolean;
  hasAimL: boolean;
}

const compiled = new Map<ClipId, CompiledClip>();

function compile(id: ClipId): CompiledClip {
  const def = CLIPS[id] as ClipDef;
  const current: Record<string, Euler> = {};
  let root: [number, number, number] = [0, 0, 0];
  let aimR: [number, number] | null = null;
  let aimL: [number, number] | null = null;
  let bat: CompiledKey['bat'] = null;
  let twoHands = true;
  const keys: CompiledKey[] = [];
  const tmp: Quat = [0, 0, 0, 1];
  for (const k of def.keys) {
    if (k.pose) for (const [b, e] of Object.entries(k.pose) as Array<[BoneName, Euler]>) current[b] = e;
    if (k.root) root = [k.root[0], k.root[1], k.root[2]];
    if (k.aimR) aimR = [k.aimR[0], k.aimR[1]];
    if (k.aimL) aimL = [k.aimL[0], k.aimL[1]];
    if (k.bat) bat = { grip: [...k.bat.grip] as [number, number, number], dir: [...k.bat.dir] as [number, number, number] };
    if (k.twoHands !== undefined) twoHands = k.twoHands;
    const q = new Float32Array(NB * 4);
    for (let i = 0; i < NB; i++) {
      const e = current[BONE_NAMES[i]];
      quatFromEulerDeg(e ? e[0] : 0, e ? e[1] : 0, e ? e[2] : 0, tmp);
      q.set(tmp, i * 4);
    }
    keys.push({ t: k.t, q, root: [...root] as [number, number, number], aimR: aimR ? [...aimR] : null, aimL: aimL ? [...aimL] : null, bat: bat ? { grip: [...bat.grip], dir: [...bat.dir] } : null, twoHands });
  }
  return {
    id,
    duration: def.duration,
    loop: Boolean(def.loop),
    linear: Boolean(def.linear),
    keys,
    markers: def.markers ?? {},
    hasBat: keys.some((k) => k.bat),
    hasAimR: keys.some((k) => k.aimR),
    hasAimL: keys.some((k) => k.aimL),
  };
}

export function getClip(id: ClipId): CompiledClip {
  let c = compiled.get(id);
  if (!c) {
    c = compile(id);
    compiled.set(id, c);
  }
  return c;
}

export function clipDuration(id: ClipId): number {
  return (CLIPS[id] as ClipDef).duration;
}
export function clipMarker(id: ClipId, name: string, fallback = 0): number {
  return (CLIPS[id] as ClipDef).markers?.[name] ?? fallback;
}

/** A sampled pose: bone quaternions plus root offset, arm aims and bat key. */
export interface SampledPose {
  q: Float32Array;
  root: [number, number, number];
  aimR: [number, number] | null;
  aimL: [number, number] | null;
  bat: { grip: [number, number, number]; dir: [number, number, number] } | null;
  twoHands: boolean;
}

export function createPose(): SampledPose {
  const q = new Float32Array(NB * 4);
  for (let i = 0; i < NB; i++) q[i * 4 + 3] = 1;
  return { q, root: [0, 0, 0], aimR: null, aimL: null, bat: null, twoHands: true };
}

function lerp3(a: readonly number[], b: readonly number[], u: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

/** Samples a clip at `t` seconds into `out`. Looping clips wrap; others clamp. */
export function sampleClip(id: ClipId, t: number, out: SampledPose): SampledPose {
  const c = getClip(id);
  let time = t;
  if (c.loop) time = ((t % c.duration) + c.duration) % c.duration;
  else time = clamp(t, 0, c.duration);
  const keys = c.keys;
  let i = 0;
  while (i < keys.length - 2 && time > keys[i + 1].t) i++;
  const k0 = keys[i];
  const k1 = keys[Math.min(i + 1, keys.length - 1)];
  const span = k1.t - k0.t;
  let u = span > 0 ? clamp((time - k0.t) / span, 0, 1) : 0;
  if (!c.linear) u = smoothstep(0, 1, u);
  for (let b = 0; b < NB; b++) quatSlerp(k0.q.subarray(b * 4, b * 4 + 4), k1.q.subarray(b * 4, b * 4 + 4), u, out.q, b * 4);
  out.root = lerp3(k0.root, k1.root, u);
  out.aimR = k0.aimR && k1.aimR ? [k0.aimR[0] + (k1.aimR[0] - k0.aimR[0]) * u, k0.aimR[1] + (k1.aimR[1] - k0.aimR[1]) * u] : (k0.aimR ?? k1.aimR);
  out.aimL = k0.aimL && k1.aimL ? [k0.aimL[0] + (k1.aimL[0] - k0.aimL[0]) * u, k0.aimL[1] + (k1.aimL[1] - k0.aimL[1]) * u] : (k0.aimL ?? k1.aimL);
  out.bat = k0.bat && k1.bat ? { grip: lerp3(k0.bat.grip, k1.bat.grip, u), dir: lerp3(k0.bat.dir, k1.bat.dir, u) } : (k0.bat ?? k1.bat);
  out.twoHands = u < 0.5 ? k0.twoHands : k1.twoHands;
  return out;
}

/** Blends `b` into `a` by weight `w` (0 = a, 1 = b), in place on `a`. Aims and bat blend when both have them. */
export function blendPose(a: SampledPose, b: SampledPose, w: number, mask?: ReadonlySet<BoneName>): void {
  if (w <= 0) return;
  for (let i = 0; i < NB; i++) {
    if (mask && !mask.has(BONE_NAMES[i])) continue;
    quatSlerp(a.q.subarray(i * 4, i * 4 + 4), b.q.subarray(i * 4, i * 4 + 4), w, a.q, i * 4);
  }
  if (!mask || mask.has('hips')) a.root = lerp3(a.root, b.root, w);
  if (mask) return;
  a.aimR = blendAim(a.aimR, b.aimR, w);
  a.aimL = blendAim(a.aimL, b.aimL, w);
  if (a.bat && b.bat) a.bat = { grip: lerp3(a.bat.grip, b.bat.grip, w), dir: lerp3(a.bat.dir, b.bat.dir, w) };
  else if (w >= 0.5) a.bat = b.bat;
  a.twoHands = w < 0.5 ? a.twoHands : b.twoHands;
}

function blendAim(a: [number, number] | null, b: [number, number] | null, w: number): [number, number] | null {
  if (a && b) {
    let d = (b[0] - a[0]) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return [a[0] + d * w, a[1] + (b[1] - a[1]) * w];
  }
  return w >= 0.5 ? b : a;
}

const MIRROR_PAIRS: ReadonlyArray<readonly [number, number]> = (
  [
    ['upperArmL', 'upperArmR'],
    ['forearmL', 'forearmR'],
    ['handL', 'handR'],
    ['thighL', 'thighR'],
    ['shinL', 'shinR'],
    ['footL', 'footR'],
  ] as const
).map(([a, b]) => [BONE_INDEX[a], BONE_INDEX[b]] as const);

/**
 * Mirrors a sampled pose left↔right in place (a left-handed batter or a left-arm bowler from right-handed clips):
 * paired bones swap, every rotation mirrors across the actor's sagittal plane (quaternion (x, −y, −z, w)), the root
 * offset and the bat key flip sideways, and the arm aims swap sides (lateral stays "outwards").
 */
export function mirrorSampledPose(pose: SampledPose): SampledPose {
  const q = pose.q;
  for (const [a, b] of MIRROR_PAIRS) {
    for (let k = 0; k < 4; k++) {
      const t = q[a * 4 + k];
      q[a * 4 + k] = q[b * 4 + k];
      q[b * 4 + k] = t;
    }
  }
  for (let i = 0; i < NB; i++) {
    q[i * 4 + 1] = -q[i * 4 + 1];
    q[i * 4 + 2] = -q[i * 4 + 2];
  }
  pose.root = [-pose.root[0], pose.root[1], pose.root[2]];
  const aimR = pose.aimR;
  pose.aimR = pose.aimL;
  pose.aimL = aimR;
  if (pose.bat) pose.bat = { grip: [-pose.bat.grip[0], pose.bat.grip[1], pose.bat.grip[2]], dir: [-pose.bat.dir[0], pose.bat.dir[1], pose.bat.dir[2]] };
  return pose;
}

const offQ: Quat = [0, 0, 0, 1];
const idQ: Quat = [0, 0, 0, 1];
const tmpQ4 = new Float32Array(4);

/**
 * Adds a local rotation (Euler degrees, XYZ) to one bone of a sampled pose, scaled by `weight` (0..1): the bowler's
 * release cues. The bone's rotation becomes q · slerp(identity, offset, weight).
 */
export function addBoneRotation(pose: SampledPose, bone: BoneName, euler: readonly [number, number, number], weight: number): void {
  if (weight <= 0) return;
  quatFromEulerDeg(euler[0], euler[1], euler[2], offQ);
  quatSlerp(idQ, offQ, Math.min(1, weight), tmpQ4, 0);
  const i = BONE_INDEX[bone] * 4;
  const q = pose.q;
  const ax = q[i];
  const ay = q[i + 1];
  const az = q[i + 2];
  const aw = q[i + 3];
  const [bx, by, bz, bw] = tmpQ4;
  q[i] = aw * bx + ax * bw + ay * bz - az * by;
  q[i + 1] = aw * by - ax * bz + ay * bw + az * bx;
  q[i + 2] = aw * bz + ax * by - ay * bx + az * bw;
  q[i + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** Copies the lower body (hips, legs and root offset) of `src` over `dst`. */
export function overlayLower(dst: SampledPose, src: SampledPose, w = 1): void {
  for (const name of ['hips', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'] as const) {
    const i = BONE_INDEX[name];
    quatSlerp(dst.q.subarray(i * 4, i * 4 + 4), src.q.subarray(i * 4, i * 4 + 4), w, dst.q, i * 4);
  }
  dst.root = lerp3(dst.root, src.root, w);
}

export const ALL_CLIPS = Object.keys(CLIPS) as ClipId[];
