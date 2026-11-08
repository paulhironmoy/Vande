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

type Vec3T = readonly [number, number, number];
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

/** Mirrors a whole one-shot clip left↔right (poses and root; markers kept): a dive to the right becomes one to the left. */
function mirrorClip(def: ClipDef): ClipDef {
  return {
    ...def,
    keys: def.keys.map((k) => ({
      ...mirrorKey(k, k.t),
      ...(k.aimR ? { aimL: k.aimR } : {}),
      ...(k.aimL ? { aimR: k.aimL } : {}),
    })),
  };
}

// ---- Practice fielding (presentation only) -----------------------------------------------------------------
// The physics FielderPath carries every fielder's ground position; these clips animate the body on that path. Their
// root offsets are vertical only (|x|, |z| ≤ 8 cm), so the drawn hips stay on the physics position: a dive's travel
// comes from the path, never from the clip. Markers name the instant the clip is aligned to a physics time.

/** Accelerating from rest: shorter, quicker, lower strides with more forward lean (same 0.62 s period as `run`). */
const DRIVE_A: ClipKey = {
  t: 0,
  root: [0, -0.07, 0],
  pose: {
    ...RUN_A.pose!,
    thighL: [-52, 0, 2],
    shinL: [22, 0, 0],
    thighR: [22, 0, -2],
    shinR: [70, 0, 0],
    upperArmL: [54, 0, 8],
    forearmL: [-84, 0, 0],
    upperArmR: [-64, 0, -8],
    forearmR: [-92, 0, 0],
    spine: [32, -8, 0],
    chest: [6, -6, 0],
    neck: [-24, 7, 0],
    head: [-8, 6, 0],
  },
};
const DRIVE_B: ClipKey = {
  t: 0,
  root: [0, 0.0, 0],
  pose: {
    ...RUN_B.pose!,
    thighR: [-40, 0, -2],
    shinR: [96, 0, 0],
    spine: [30, 0, 0],
    chest: [6, 0, 0],
    neck: [-22, 0, 0],
    head: [-8, 0, 0],
  },
};

/** A low, attacking gather: the hand meets the ball at `collect`, then the fielder rises side-on, ball hand back. */
const FIELD_PICKUP: ClipDef = {
  duration: 0.75,
  markers: { collect: 0.3 },
  keys: [
    { t: 0, root: [0, -0.16, 0], pose: { ...READY, spine: [36, 0, 0] } },
    {
      t: 0.3,
      root: [0, -0.42, 0],
      pose: {
        hips: [0, 0, 0],
        spine: [62, 0, 0],
        chest: [10, 0, 0],
        neck: [-34, 0, 0],
        head: [-8, 0, 0],
        upperArmR: [-64, 0, -6],
        forearmR: [-6, 0, 0],
        handR: [10, 0, 0],
        upperArmL: [-40, 0, 16],
        forearmL: [-22, 0, 0],
        thighL: [-78, 0, 10],
        shinL: [100, 0, 0],
        footL: [-20, 0, 0],
        thighR: [-26, 0, -8],
        shinR: [76, 0, 0],
        footR: [10, 0, 0],
      },
    },
    {
      t: 0.52,
      root: [0, -0.2, 0],
      pose: {
        hips: [0, -40, 0],
        spine: [26, -20, 0],
        chest: [6, -14, 0],
        neck: [-12, 40, 0],
        head: [-4, 10, 0],
        upperArmR: [10, 0, -20],
        forearmR: [-70, 0, 0],
        handR: [0, 0, 0],
        thighL: [-40, 0, 12],
        shinL: [50, 0, 0],
        thighR: [-6, 0, -12],
        shinR: [30, 0, 0],
      },
    },
    {
      t: 0.75,
      root: [0, -0.08, 0],
      pose: {
        hips: [0, -58, 0],
        spine: [10, -12, 0],
        chest: [2, -6, 0],
        neck: [0, 56, 0],
        head: [0, 10, 0],
        upperArmR: [30, 0, -16],
        forearmR: [-80, 0, 0],
        upperArmL: [-50, 0, 10],
        forearmL: [-30, 0, 0],
        thighL: [-22, 0, 14],
        shinL: [20, 0, 0],
        footL: [0, 0, 0],
        thighR: [8, 0, -14],
        shinR: [20, 0, 0],
        footR: [0, 0, 0],
      },
    },
  ],
};

/** A throw with a wind-up: side-on, the ball arm back and up, the front arm at the target, release at `release`. */
const FIELD_THROW: ClipDef = {
  duration: 0.92,
  markers: { release: 0.42 },
  keys: [
    {
      t: 0,
      root: [0, -0.06, 0],
      pose: {
        hips: [0, -62, 0],
        spine: [6, -10, 0],
        chest: [0, -6, 0],
        neck: [0, 60, 0],
        head: [0, 12, 0],
        thighL: [-22, 0, 14],
        shinL: [16, 0, 0],
        thighR: [10, 0, -14],
        shinR: [20, 0, 0],
        forearmR: [-30, 0, 0],
        forearmL: [-20, 0, 0],
      },
      aimR: [96, 12],
      aimL: [262, 6],
    },
    {
      t: 0.26,
      root: [0, -0.1, -0.05],
      pose: {
        hips: [0, -70, 0],
        spine: [-8, -14, 0],
        chest: [-2, -8, 0],
        forearmR: [-74, 0, 0],
        thighL: [-30, 0, 16],
        shinL: [26, 0, 0],
        thighR: [16, 0, -14],
        shinR: [34, 0, 0],
      },
      aimR: [152, 16],
      aimL: [272, 4],
    },
    {
      t: 0.42,
      root: [0, -0.08, 0.06],
      pose: {
        hips: [0, -10, 0],
        spine: [22, 26, 0],
        chest: [6, 16, 0],
        neck: [-6, 10, 0],
        head: [0, 0, 0],
        forearmR: [-8, 0, 0],
        thighL: [-38, 0, 8],
        shinL: [18, 0, 0],
        thighR: [24, 0, -8],
        shinR: [40, 0, 0],
      },
      aimR: [238, 6],
      aimL: [330, 14],
    },
    {
      t: 0.62,
      root: [0, -0.12, 0.08],
      pose: { spine: [38, 40, 0], chest: [10, 20, 0], forearmR: [-14, 0, 0], thighR: [40, 0, -6], shinR: [70, 0, 0] },
      aimR: [314, -14],
      aimL: [20, 20],
    },
    {
      t: 0.92,
      root: [0, -0.04, 0.06],
      pose: {
        hips: [0, 0, 0],
        spine: [14, 10, 0],
        chest: [3, 4, 0],
        neck: [-4, 0, 0],
        thighL: [-8, 0, 4],
        shinL: [10, 0, 0],
        thighR: [4, 0, -4],
        shinR: [12, 0, 0],
      },
      aimR: [340, -8],
      aimL: [8, 10],
    },
  ],
};

/** A ground misfield: hands meet the ball at `touch`, it squirts out, the fielder recoils, then lunges and scrambles low for it. */
const FIELD_FUMBLE: ClipDef = {
  duration: 1.3,
  markers: { touch: 0.22 },
  keys: [
    { t: 0, root: [0, -0.16, 0], pose: { ...READY, spine: [40, 0, 0] } },
    {
      t: 0.22,
      root: [0, -0.4, 0],
      pose: {
        spine: [64, 0, 0],
        chest: [10, 0, 0],
        neck: [-36, 0, 0],
        head: [-6, 0, 0],
        upperArmL: [-60, 0, 12],
        upperArmR: [-60, 0, -12],
        forearmL: [-6, 0, 0],
        forearmR: [-6, 0, 0],
        thighL: [-70, 0, 14],
        shinL: [96, 0, 0],
        thighR: [-40, 0, -12],
        shinR: [84, 0, 0],
        footL: [-18, 0, 0],
        footR: [-10, 0, 0],
      },
    },
    {
      t: 0.36,
      root: [0, -0.32, 0],
      pose: {
        spine: [46, 0, 6],
        neck: [-18, 0, 0],
        head: [6, -10, 0],
        upperArmL: [-82, 0, 42],
        upperArmR: [-88, 0, -38],
        forearmL: [-30, 0, 0],
        forearmR: [-26, 0, 0],
      },
    },
    {
      t: 0.62,
      root: [0, -0.46, 0],
      pose: {
        hips: [0, 20, 0],
        spine: [70, 18, 0],
        chest: [12, 10, 0],
        neck: [-30, -14, 0],
        head: [4, -10, 0],
        upperArmR: [-64, 0, -20],
        forearmR: [-4, 0, 0],
        upperArmL: [-30, 0, 26],
        forearmL: [-30, 0, 0],
        thighL: [-84, 0, 16],
        shinL: [110, 0, 0],
        thighR: [-20, 0, -16],
        shinR: [90, 0, 0],
      },
    },
    {
      t: 0.95,
      root: [0, -0.44, 0],
      pose: {
        hips: [0, 10, 0],
        spine: [66, 8, 0],
        chest: [10, 4, 0],
        neck: [-34, -6, 0],
        head: [0, -4, 0],
        upperArmR: [-70, 0, -10],
        forearmR: [-8, 0, 0],
        upperArmL: [-40, 0, 20],
        forearmL: [-24, 0, 0],
        thighL: [-70, 0, 14],
        shinL: [104, 0, 0],
        thighR: [-36, 0, -14],
        shinR: [96, 0, 0],
      },
    },
    {
      t: 1.3,
      root: [0, -0.42, 0],
      pose: {
        hips: [0, 0, 0],
        spine: [64, 0, 0],
        chest: [10, 0, 0],
        neck: [-36, 0, 0],
        head: [-6, 0, 0],
        upperArmR: [-66, 0, -6],
        forearmR: [-6, 0, 0],
        upperArmL: [-42, 0, 16],
        forearmL: [-20, 0, 0],
      },
    },
  ],
};

/** A catch put down: from the catching pose the hands spread as the ball spills, then the fielder folds down to it. */
const FIELD_SPILL: ClipDef = {
  duration: 0.9,
  keys: [
    {
      t: 0,
      root: [0, -0.12, 0],
      pose: {
        ...READY,
        upperArmL: [-74, 0, 4],
        upperArmR: [-74, 0, -4],
        forearmL: [-62, 0, 0],
        forearmR: [-62, 0, 0],
        spine: [18, 0, 0],
        neck: [-12, 0, 0],
      },
    },
    {
      t: 0.18,
      root: [0, -0.16, 0],
      pose: {
        upperArmL: [-58, 0, 32],
        upperArmR: [-58, 0, -32],
        forearmL: [-40, 0, 0],
        forearmR: [-40, 0, 0],
        spine: [26, 0, 0],
        neck: [8, 0, 0],
        head: [10, 0, 0],
      },
    },
    {
      t: 0.5,
      root: [0, -0.36, 0],
      pose: {
        spine: [58, 0, 0],
        chest: [10, 0, 0],
        neck: [-24, 0, 0],
        head: [-4, 0, 0],
        upperArmL: [-46, 0, 14],
        upperArmR: [-56, 0, -10],
        forearmL: [-14, 0, 0],
        forearmR: [-10, 0, 0],
        thighL: [-62, 0, 12],
        shinL: [90, 0, 0],
        thighR: [-36, 0, -12],
        shinR: [80, 0, 0],
      },
    },
    {
      t: 0.9,
      root: [0, -0.4, 0],
      pose: { spine: [62, 0, 0], neck: [-32, 0, 0], upperArmR: [-62, 0, -6], forearmR: [-6, 0, 0] },
    },
  ],
};

/**
 * A full-length dive to the fielder's right: launch, hands out at `reach`, land on the side, gather, up onto a knee and
 * rising side-on to throw. The hips stay over the root, so the physics path alone carries him towards the ball.
 */
const FIELD_DIVE_R: ClipDef = {
  duration: 0.98,
  markers: { reach: 0.2 },
  keys: [
    { t: 0, root: [0, -0.16, 0], pose: READY },
    {
      t: 0.08,
      root: [0, -0.3, 0],
      pose: {
        hips: [0, 0, 24],
        spine: [26, 0, 12],
        upperArmR: [-130, 0, -30],
        forearmR: [-10, 0, 0],
        upperArmL: [-110, 0, 10],
        forearmL: [-20, 0, 0],
        thighL: [-20, 0, 24],
        shinL: [30, 0, 0],
        thighR: [-40, 0, -10],
        shinR: [60, 0, 0],
      },
    },
    {
      t: 0.2,
      root: [0, -0.56, 0],
      pose: {
        hips: [0, 0, 78],
        spine: [6, 0, 8],
        chest: [0, 0, 4],
        neck: [-14, 0, -6],
        head: [-6, 0, -6],
        upperArmR: [-172, 0, -6],
        forearmR: [-6, 0, 0],
        upperArmL: [-160, 0, 14],
        forearmL: [-16, 0, 0],
        thighL: [6, 0, 12],
        shinL: [16, 0, 0],
        thighR: [10, 0, -4],
        shinR: [14, 0, 0],
      },
    },
    { t: 0.34, root: [0, -0.76, 0], pose: { hips: [0, 0, 88], spine: [4, 0, 4] } },
    {
      t: 0.5,
      root: [0, -0.76, 0],
      pose: {
        hips: [0, 0, 86],
        upperArmR: [-150, 0, -10],
        forearmR: [-50, 0, 0],
        upperArmL: [-120, 0, 20],
        forearmL: [-60, 0, 0],
        thighL: [-34, 0, 10],
        shinL: [70, 0, 0],
      },
    },
    {
      t: 0.74,
      root: [0, -0.5, 0],
      pose: {
        hips: [0, 0, 30],
        spine: [40, 0, 4],
        chest: [6, 0, 0],
        neck: [-20, 0, 0],
        head: [0, 0, 0],
        upperArmR: [-30, 0, -20],
        forearmR: [-70, 0, 0],
        upperArmL: [-40, 0, 20],
        forearmL: [-30, 0, 0],
        thighL: [-84, 0, 10],
        shinL: [118, 0, 0],
        thighR: [12, 0, -10],
        shinR: [110, 0, 0],
        footR: [30, 0, 0],
      },
    },
    {
      t: 0.98,
      root: [0, -0.24, 0],
      pose: {
        hips: [0, -30, 6],
        spine: [28, -14, 0],
        chest: [6, -8, 0],
        neck: [-10, 30, 0],
        head: [0, 6, 0],
        upperArmR: [20, 0, -16],
        forearmR: [-70, 0, 0],
        upperArmL: [-46, 0, 12],
        forearmL: [-30, 0, 0],
        thighL: [-56, 0, 12],
        shinL: [70, 0, 0],
        thighR: [-10, 0, -12],
        shinR: [56, 0, 0],
        footR: [0, 0, 0],
      },
    },
  ],
};

/** The keeper's dive to his right from the crouch: gloves out at `reach`, on his side with the ball, then up. */
const KEEP_DIVE_R: ClipDef = {
  duration: 1.1,
  markers: { reach: 0.15 },
  keys: [
    { t: 0, root: [0, -0.48, 0], pose: SQUAT },
    {
      t: 0.07,
      root: [0, -0.46, 0],
      pose: {
        hips: [0, 0, 26],
        spine: [26, 0, 14],
        upperArmR: [-120, 0, -34],
        forearmR: [-14, 0, 0],
        upperArmL: [-110, 0, 0],
        forearmL: [-20, 0, 0],
        thighL: [-60, 0, 30],
        shinL: [80, 0, 0],
        thighR: [-80, 0, -10],
        shinR: [110, 0, 0],
      },
    },
    {
      t: 0.15,
      root: [0, -0.6, 0],
      pose: {
        hips: [0, 0, 74],
        spine: [8, 0, 8],
        neck: [-16, 0, -6],
        head: [-6, 0, -6],
        upperArmR: [-168, 0, -8],
        forearmR: [-10, 0, 0],
        upperArmL: [-156, 0, 18],
        forearmL: [-20, 0, 0],
        thighL: [-10, 0, 14],
        shinL: [30, 0, 0],
        thighR: [-6, 0, -6],
        shinR: [24, 0, 0],
      },
    },
    { t: 0.3, root: [0, -0.76, 0], pose: { hips: [0, 0, 88], spine: [4, 0, 4] } },
    {
      t: 0.6,
      root: [0, -0.74, 0],
      pose: {
        hips: [0, 0, 84],
        upperArmR: [-140, 0, -16],
        forearmR: [-70, 0, 0],
        upperArmL: [-130, 0, 10],
        forearmL: [-70, 0, 0],
        thighL: [-40, 0, 10],
        shinL: [80, 0, 0],
      },
    },
    {
      t: 1.1,
      root: [0, -0.3, 0],
      pose: {
        hips: [0, 0, 10],
        spine: [30, 0, 0],
        neck: [-14, 0, 0],
        head: [0, 0, 0],
        upperArmR: [-60, 0, -12],
        forearmR: [-60, 0, 0],
        upperArmL: [-60, 0, 12],
        forearmL: [-60, 0, 0],
        thighL: [-70, 0, 16],
        shinL: [100, 0, 0],
        thighR: [-60, 0, -16],
        shinR: [100, 0, 0],
      },
    },
  ],
};

/** The keeper's crouched side-step (a shuffle to the line, still facing the bowler). */
const KEEP_SHUFFLE_A: ClipKey = {
  t: 0,
  root: [0, -0.4, 0],
  pose: {
    ...SQUAT,
    thighL: [-80, 0, 36],
    thighR: [-80, 0, -12],
    shinL: [108, 0, 0],
    shinR: [108, 0, 0],
    spine: [30, 0, 0],
    upperArmL: [-62, 0, 10],
    upperArmR: [-62, 0, -10],
    forearmL: [-40, 0, 0],
    forearmR: [-40, 0, 0],
  },
};
const KEEP_SHUFFLE_B: ClipKey = {
  t: 0,
  root: [0, -0.36, 0],
  pose: { thighL: [-76, 0, 22], thighR: [-76, 0, -22], shinL: [100, 0, 0], shinR: [100, 0, 0] },
};

/** Hands on hips, head down: a chase that did not get there. */
const HANDS_ON_HIPS: ClipDef = {
  duration: 2.4,
  loop: true,
  keys: [
    {
      t: 0,
      root: [0, -0.01, 0],
      pose: {
        ...STAND,
        spine: [8, 0, 0],
        neck: [18, 0, 0],
        head: [8, 0, 0],
        upperArmL: [-14, 0, 40],
        upperArmR: [-14, 0, -40],
        forearmL: [-92, 0, 0],
        forearmR: [-92, 0, 0],
      },
    },
    { t: 1.2, root: [0, -0.015, 0], pose: { chest: [3, 4, 0], neck: [22, 6, 0] } },
    { t: 2.4, root: [0, -0.01, 0], pose: { chest: [1, 0, 0], neck: [18, 0, 0] } },
  ],
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
      {
        t: 1.6,
        root: [0.012, -0.006, 0],
        pose: { chest: [2.5, 2, 0], upperArmL: [3, 0, 9], upperArmR: [3, 0, -6], head: [1, 4, 0] },
      },
      { t: 3.2, root: [0, 0, 0], pose: STAND },
    ],
  },
  walk: cycle(1.05, WALK_A, WALK_B),
  jog: cycle(
    0.78,
    { ...RUN_A, root: [0, -0.02, 0], pose: scalePose(RUN_A.pose!, 0.62) },
    { ...RUN_B, root: [0, 0.025, 0], pose: scalePose(RUN_B.pose!, 0.62) },
  ),
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
      {
        t: 0.12,
        root: [-0.15, -0.24, 0],
        pose: {
          hips: [0, 0, 18],
          spine: [24, 0, 10],
          upperArmR: [-120, 0, -30],
          forearmR: [-10, 0, 0],
          thighL: [-10, 0, 20],
          shinL: [20, 0, 0],
        },
      },
      {
        t: 0.3,
        root: [-0.75, -0.42, 0],
        pose: {
          hips: [0, 0, 72],
          spine: [8, 0, 6],
          neck: [-10, 0, 0],
          upperArmR: [-172, 0, -4],
          forearmR: [-8, 0, 0],
          upperArmL: [-150, 0, 20],
          forearmL: [-30, 0, 0],
          thighL: [8, 0, 10],
          shinL: [18, 0, 0],
          thighR: [12, 0, -6],
          shinR: [12, 0, 0],
        },
      },
      { t: 0.5, root: [-1.25, -0.74, 0], pose: { hips: [0, 0, 86], spine: [6, 0, 4] } },
      {
        t: 0.9,
        root: [-1.35, -0.76, 0],
        pose: {
          hips: [0, 0, 84],
          upperArmR: [-150, 0, -10],
          forearmR: [-40, 0, 0],
          thighL: [-30, 0, 10],
          shinL: [60, 0, 0],
        },
      },
      {
        t: 1.3,
        root: [-1.3, -0.5, 0],
        pose: {
          hips: [0, 0, 40],
          spine: [40, 0, 0],
          thighL: [-80, 0, 10],
          shinL: [110, 0, 0],
          thighR: [10, 0, -10],
          shinR: [100, 0, 0],
        },
      },
    ],
  },
  catch_high: {
    duration: 1.3,
    markers: { catch: 0.45 },
    keys: [
      { t: 0, root: [0, -0.04, 0], pose: { ...STAND, neck: [-24, 0, 0], head: [-16, 0, 0], spine: [-4, 0, 0] } },
      {
        t: 0.3,
        root: [0, 0, 0],
        pose: {
          upperArmL: [-160, 0, 10],
          upperArmR: [-160, 0, -10],
          forearmL: [-24, 0, 0],
          forearmR: [-24, 0, 0],
          neck: [-28, 0, 0],
          head: [-18, 0, 0],
        },
      },
      {
        t: 0.45,
        root: [0, -0.04, 0],
        pose: { upperArmL: [-168, 0, 3], upperArmR: [-168, 0, -3], forearmL: [-40, 0, 0], forearmR: [-40, 0, 0] },
      },
      {
        t: 0.75,
        root: [0, -0.06, 0],
        pose: {
          upperArmL: [-62, 0, 14],
          upperArmR: [-62, 0, -14],
          forearmL: [-96, 0, 0],
          forearmR: [-96, 0, 0],
          spine: [14, 0, 0],
          neck: [6, 0, 0],
          head: [10, 0, 0],
        },
      },
      {
        t: 1.3,
        root: [0, -0.02, 0],
        pose: {
          upperArmL: [-40, 0, 12],
          upperArmR: [-40, 0, -12],
          forearmL: [-90, 0, 0],
          forearmR: [-90, 0, 0],
          spine: [6, 0, 0],
          neck: [0, 0, 0],
          head: [0, 0, 0],
        },
      },
    ],
  },
  catch_chest: {
    duration: 1.0,
    markers: { catch: 0.32 },
    keys: [
      { t: 0, root: [0, -0.12, 0], pose: READY },
      {
        t: 0.2,
        root: [0, -0.1, 0],
        pose: {
          upperArmL: [-84, 0, 8],
          upperArmR: [-84, 0, -8],
          forearmL: [-44, 0, 0],
          forearmR: [-44, 0, 0],
          spine: [18, 0, 0],
          neck: [-12, 0, 0],
        },
      },
      {
        t: 0.32,
        root: [0, -0.12, 0],
        pose: { upperArmL: [-74, 0, 4], upperArmR: [-74, 0, -4], forearmL: [-62, 0, 0], forearmR: [-62, 0, 0] },
      },
      {
        t: 1.0,
        root: [0, -0.03, 0],
        pose: {
          upperArmL: [-44, 0, 14],
          upperArmR: [-44, 0, -14],
          forearmL: [-100, 0, 0],
          forearmR: [-100, 0, 0],
          spine: [8, 0, 0],
          neck: [0, 0, 0],
          thighL: [-6, 0, 2],
          thighR: [-6, 0, -2],
          shinL: [10, 0, 0],
          shinR: [10, 0, 0],
          footL: [0, 0, 0],
          footR: [0, 0, 0],
        },
      },
    ],
  },
  pickup: {
    duration: 0.8,
    markers: { collect: 0.32 },
    keys: [
      { t: 0, root: [0, -0.1, 0], pose: { ...READY, spine: [30, 0, 0] } },
      {
        t: 0.32,
        root: [0, -0.3, 0.1],
        pose: {
          spine: [68, 0, 0],
          chest: [12, 0, 0],
          neck: [-30, 0, 0],
          upperArmR: [-70, 0, -6],
          forearmR: [-8, 0, 0],
          upperArmL: [-30, 0, 20],
          thighL: [-62, 0, 10],
          shinL: [78, 0, 0],
          thighR: [-20, 0, -8],
          shinR: [60, 0, 0],
        },
      },
      {
        t: 0.8,
        root: [0, -0.06, 0],
        pose: {
          spine: [16, -30, 0],
          chest: [4, -20, 0],
          neck: [-6, 30, 0],
          upperArmR: [30, 0, -14],
          forearmR: [-60, 0, 0],
          thighL: [-20, 0, 10],
          shinL: [30, 0, 0],
          thighR: [0, 0, -14],
          shinR: [20, 0, 0],
        },
      },
    ],
  },
  throw: {
    duration: 0.95,
    markers: { release: 0.48 },
    keys: [
      {
        t: 0,
        root: [0, -0.05, 0],
        pose: {
          hips: [0, -62, 0],
          spine: [6, -10, 0],
          chest: [0, -6, 0],
          neck: [0, 60, 0],
          head: [0, 12, 0],
          thighL: [-22, 0, 14],
          shinL: [16, 0, 0],
          thighR: [10, 0, -14],
          shinR: [20, 0, 0],
          forearmR: [-30, 0, 0],
          forearmL: [-20, 0, 0],
        },
        aimR: [96, 12],
        aimL: [262, 6],
      },
      {
        t: 0.3,
        root: [0, -0.08, -0.12],
        pose: { spine: [-6, -12, 0], forearmR: [-70, 0, 0] },
        aimR: [150, 14],
        aimL: [268, 4],
      },
      {
        t: 0.48,
        root: [0, -0.07, 0.25],
        pose: {
          hips: [0, -10, 0],
          spine: [22, 26, 0],
          chest: [6, 16, 0],
          neck: [-6, 10, 0],
          head: [0, 0, 0],
          forearmR: [-8, 0, 0],
          thighL: [-38, 0, 8],
          shinL: [18, 0, 0],
          thighR: [24, 0, -8],
          shinR: [40, 0, 0],
        },
        aimR: [238, 6],
        aimL: [330, 14],
      },
      {
        t: 0.7,
        root: [0, -0.1, 0.4],
        pose: { spine: [36, 40, 0], chest: [10, 20, 0], forearmR: [-14, 0, 0] },
        aimR: [312, -14],
        aimL: [20, 20],
      },
      {
        t: 0.95,
        root: [0, -0.04, 0.45],
        pose: {
          hips: [0, 0, 0],
          spine: [14, 10, 0],
          chest: [3, 4, 0],
          neck: [-4, 0, 0],
          thighL: [-8, 0, 4],
          shinL: [10, 0, 0],
          thighR: [4, 0, -4],
          shinR: [12, 0, 0],
        },
        aimR: [340, -8],
        aimL: [8, 10],
      },
    ],
  },
  celebrate_jump: {
    duration: 1.5,
    keys: [
      { t: 0, root: [0, -0.02, 0], pose: STAND },
      {
        t: 0.18,
        root: [0, -0.16, 0],
        pose: {
          thighL: [-46, 0, 6],
          thighR: [-46, 0, -6],
          shinL: [74, 0, 0],
          shinR: [74, 0, 0],
          footL: [-20, 0, 0],
          footR: [-20, 0, 0],
          spine: [24, 0, 0],
        },
        aimR: [50, 12],
        aimL: [50, 12],
      },
      {
        t: 0.36,
        root: [0, 0.18, 0],
        pose: {
          thighL: [-10, 0, 4],
          thighR: [-10, 0, -4],
          shinL: [16, 0, 0],
          shinR: [16, 0, 0],
          footL: [30, 0, 0],
          footR: [30, 0, 0],
          spine: [-8, 0, 0],
          neck: [-18, 0, 0],
          forearmL: [-30, 0, 0],
          forearmR: [-30, 0, 0],
        },
        aimR: [178, 22],
        aimL: [178, 22],
      },
      {
        t: 0.55,
        root: [0, 0.42, 0],
        pose: {
          thighL: [-40, 0, 8],
          thighR: [-40, 0, -8],
          shinL: [80, 0, 0],
          shinR: [80, 0, 0],
          footL: [20, 0, 0],
          footR: [20, 0, 0],
          spine: [-4, 0, 0],
          forearmL: [-60, 0, 0],
          forearmR: [-60, 0, 0],
        },
        aimR: [186, 26],
        aimL: [186, 26],
      },
      {
        t: 0.76,
        root: [0, -0.12, 0],
        pose: {
          thighL: [-40, 0, 8],
          thighR: [-40, 0, -8],
          shinL: [66, 0, 0],
          shinR: [66, 0, 0],
          footL: [-16, 0, 0],
          footR: [-16, 0, 0],
          spine: [20, 0, 0],
          forearmR: [-20, 0, 0],
        },
        aimR: [150, 14],
        aimL: [80, 30],
      },
      {
        t: 1.0,
        root: [0, -0.04, 0],
        pose: {
          thighL: [-12, 0, 6],
          thighR: [-12, 0, -6],
          shinL: [20, 0, 0],
          shinR: [20, 0, 0],
          footL: [0, 0, 0],
          footR: [0, 0, 0],
          spine: [4, 0, 0],
          forearmR: [-70, 0, 0],
        },
        aimR: [198, 10],
        aimL: [40, 24],
      },
      { t: 1.25, root: [0, -0.06, 0], pose: { forearmR: [-110, 0, 0] }, aimR: [120, 12], aimL: [30, 20] },
      { t: 1.5, root: [0, -0.04, 0], pose: { forearmR: [-60, 0, 0] }, aimR: [192, 10], aimL: [36, 22] },
    ],
  },
  celebrate_run: {
    ...cycle(
      0.66,
      {
        ...RUN_A,
        pose: {
          ...RUN_A.pose!,
          upperArmL: [0, 0, 82],
          upperArmR: [0, 0, -82],
          forearmL: [-8, 0, 0],
          forearmR: [-8, 0, 0],
          spine: [8, -6, 10],
        },
      },
      {
        ...RUN_B,
        pose: {
          ...RUN_B.pose!,
          upperArmL: [0, 0, 86],
          upperArmR: [0, 0, -86],
          forearmL: [-6, 0, 0],
          forearmR: [-6, 0, 0],
          spine: [6, 0, 12],
        },
      },
    ),
    linear: true,
  },
  clap: {
    duration: 0.5,
    loop: true,
    keys: [
      {
        t: 0,
        root: [0, 0, 0],
        pose: {
          ...STAND,
          upperArmL: [-58, 0, 26],
          upperArmR: [-58, 0, -26],
          forearmL: [-68, 0, 0],
          forearmR: [-68, 0, 0],
        },
      },
      {
        t: 0.25,
        pose: { upperArmL: [-58, 0, 12], upperArmR: [-58, 0, -12], forearmL: [-72, 0, 0], forearmR: [-72, 0, 0] },
      },
      {
        t: 0.5,
        pose: { upperArmL: [-58, 0, 26], upperArmR: [-58, 0, -26], forearmL: [-68, 0, 0], forearmR: [-68, 0, 0] },
      },
    ],
  },
  hands_on_head: {
    duration: 1.8,
    keys: [
      { t: 0, root: [0, -0.02, 0], pose: STAND },
      {
        t: 0.35,
        root: [0, -0.04, 0],
        pose: {
          upperArmL: [-160, 0, 42],
          upperArmR: [-160, 0, -42],
          forearmL: [-122, 0, 0],
          forearmR: [-122, 0, 0],
          spine: [-4, 0, 0],
          neck: [-14, 0, 0],
          head: [-8, 0, 0],
        },
      },
      { t: 1.2, root: [0, -0.05, 0], pose: { spine: [10, 0, 0], neck: [10, 0, 0], head: [8, 0, 0] } },
      {
        t: 1.8,
        root: [0, -0.02, 0],
        pose: {
          upperArmL: [10, 0, 22],
          upperArmR: [10, 0, -22],
          forearmL: [-80, 0, 0],
          forearmR: [-80, 0, 0],
          spine: [6, 0, 0],
          neck: [0, 0, 0],
          head: [0, 0, 0],
        },
      },
    ],
  },
  appeal: {
    duration: 1.5,
    keys: [
      { t: 0, root: [0, -0.04, 0], pose: { ...STAND, spine: [12, 0, 0] } },
      {
        t: 0.22,
        root: [0, 0.1, 0],
        pose: {
          spine: [-16, 0, 0],
          neck: [-20, 0, 0],
          head: [-10, 0, 0],
          thighL: [-30, 0, 6],
          shinL: [50, 0, 0],
          thighR: [10, 0, -6],
          shinR: [40, 0, 0],
          forearmL: [-12, 0, 0],
          forearmR: [-12, 0, 0],
        },
        aimR: [176, 30],
        aimL: [176, 30],
      },
      { t: 0.5, root: [0, 0.02, 0], pose: { spine: [-20, 0, 0] }, aimR: [182, 34], aimL: [182, 34] },
      {
        t: 1.5,
        root: [0, -0.02, 0],
        pose: { spine: [-12, 0, 0], thighL: [-4, 0, 4], shinL: [8, 0, 0], thighR: [0, 0, -4], shinR: [6, 0, 0] },
        aimR: [178, 28],
        aimL: [178, 28],
      },
    ],
  },
  dejected: {
    duration: 2,
    loop: true,
    keys: [
      {
        t: 0,
        root: [0, -0.02, 0],
        pose: {
          ...STAND,
          spine: [14, 0, 0],
          neck: [24, 0, 0],
          head: [14, 0, 0],
          upperArmL: [4, 0, 4],
          upperArmR: [4, 0, -4],
        },
      },
      { t: 1, pose: { neck: [28, 0, 0] } },
      { t: 2, pose: { neck: [24, 0, 0] } },
    ],
  },
  hands_on_hips: HANDS_ON_HIPS,

  // ---- Practice fielding on the physics path (see FIELD_* above) ----------------------------------------------
  run_drive: { ...cycle(0.62, DRIVE_A, DRIVE_B), linear: true },
  field_pickup: FIELD_PICKUP,
  field_throw: FIELD_THROW,
  field_fumble: FIELD_FUMBLE,
  field_spill: FIELD_SPILL,
  field_dive_r: FIELD_DIVE_R,
  field_dive_l: mirrorClip(FIELD_DIVE_R),
  keep_dive_r: KEEP_DIVE_R,
  keep_dive_l: mirrorClip(KEEP_DIVE_R),
  keep_shuffle: cycle(0.36, KEEP_SHUFFLE_A, KEEP_SHUFFLE_B),

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
      {
        ...RUN_A,
        root: [0, -0.02, 0],
        pose: { ...scalePose(RUN_A.pose!, 0.6), upperArmR: [-30, 0, -8], forearmR: [-116, 0, 0] },
      },
      {
        ...RUN_B,
        root: [0, 0.03, 0],
        pose: { ...scalePose(RUN_B.pose!, 0.6), upperArmR: [-26, 0, -8], forearmR: [-112, 0, 0] },
      },
    ),
    linear: true,
  },
  bowl_pace_long: {
    duration: 1.65,
    markers: { release: 0.62, frontFoot: 0.54 },
    keys: [
      {
        t: 0,
        root: [0, -0.03, 0],
        pose: { ...RUN_A.pose!, hips: [0, 0, 0], forearmR: [-110, 0, 0] },
        aimL: [40, 8],
        aimR: [320, 10],
      },
      {
        t: 0.16,
        root: [0, 0.08, 0],
        pose: {
          hips: [0, -20, 0],
          spine: [6, -10, 0],
          thighR: [-64, 0, -4],
          shinR: [76, 0, 0],
          thighL: [22, 0, 4],
          shinL: [44, 0, 0],
          forearmR: [-120, 0, 0],
          forearmL: [-10, 0, 0],
        },
        aimL: [200, 8],
        aimR: [300, 12],
      },
      {
        t: 0.32,
        root: [0, 0.16, 0],
        pose: {
          hips: [0, -58, 0],
          spine: [-8, -18, 0],
          chest: [-4, -8, 0],
          neck: [0, 50, 0],
          head: [-6, 18, 0],
          thighL: [-50, 0, 6],
          shinL: [56, 0, 0],
          thighR: [12, 0, -4],
          shinR: [64, 0, 0],
          forearmR: [-40, 0, 0],
          forearmL: [-6, 0, 0],
        },
        aimL: [196, 4],
        aimR: [48, 16],
      },
      {
        t: 0.45,
        root: [0, -0.02, 0],
        pose: {
          hips: [0, -62, 0],
          spine: [-14, -16, 0],
          thighL: [-58, 0, 4],
          shinL: [22, 0, 0],
          thighR: [18, 0, -4],
          shinR: [30, 0, 0],
          forearmR: [-6, 0, 0],
        },
        aimL: [204, 4],
        aimR: [96, 12],
      },
      {
        t: 0.54,
        root: [0, -0.06, 0],
        pose: {
          hips: [0, -36, 0],
          spine: [2, -6, 0],
          chest: [2, 0, 0],
          neck: [-6, 30, 0],
          head: [-4, 10, 0],
          thighL: [-40, 0, 2],
          shinL: [6, 0, 0],
          footL: [-6, 0, 0],
          thighR: [32, 0, -6],
          shinR: [40, 0, 0],
          forearmL: [-40, 0, 0],
        },
        aimL: [262, 14],
        aimR: [148, 8],
      },
      {
        t: 0.62,
        root: [0, -0.06, 0],
        pose: {
          hips: [0, -4, 0],
          spine: [24, 14, 0],
          chest: [10, 6, 0],
          neck: [-14, 0, 0],
          head: [-8, 0, 0],
          thighL: [-30, 0, 2],
          shinL: [4, 0, 0],
          thighR: [42, 0, -4],
          shinR: [58, 0, 0],
          forearmL: [-98, 0, 0],
        },
        aimL: [340, 30],
        aimR: [196, 4],
      },
      {
        t: 0.76,
        root: [0, -0.1, 0],
        pose: {
          hips: [0, 18, 0],
          spine: [44, 30, 0],
          chest: [14, 10, 0],
          neck: [-26, -10, 0],
          head: [-10, 0, 0],
          thighL: [8, 0, 2],
          shinL: [22, 0, 0],
          thighR: [-52, 0, -4],
          shinR: [52, 0, 0],
          forearmL: [-80, 0, 0],
          forearmR: [-20, 0, 0],
        },
        aimL: [20, 28],
        aimR: [292, -18],
      },
      {
        t: 0.96,
        root: [0, -0.04, 0],
        pose: { ...RUN_B.pose!, hips: [0, 10, 0], spine: [26, 12, 0], forearmR: [-40, 0, 0] },
        aimL: [30, 16],
        aimR: [330, -10],
      },
      {
        t: 1.22,
        root: [0, -0.02, 0],
        pose: { ...RUN_A.pose!, hips: [0, 0, 0], spine: [14, 0, 0], forearmR: [-60, 0, 0] },
        aimL: [36, 10],
        aimR: [348, -4],
      },
      {
        t: 1.65,
        root: [0, 0, 0],
        pose: { ...WALK_A.pose!, spine: [6, 0, 0], forearmR: [-30, 0, 0] },
        aimL: [8, 7],
        aimR: [358, -7],
      },
    ],
  },
  bowl_pace_short: {
    duration: 1.45,
    markers: { release: 0.5, frontFoot: 0.43 },
    keys: [
      { t: 0, root: [0, -0.03, 0], pose: { ...RUN_A.pose!, forearmR: [-110, 0, 0] }, aimL: [40, 8], aimR: [320, 12] },
      {
        t: 0.14,
        root: [0, 0.05, 0],
        pose: {
          hips: [0, -14, 0],
          spine: [4, -6, 0],
          thighR: [-56, 0, -4],
          shinR: [70, 0, 0],
          thighL: [20, 0, 4],
          shinL: [40, 0, 0],
          forearmR: [-110, 0, 0],
        },
        aimL: [170, 12],
        aimR: [310, 14],
      },
      {
        t: 0.3,
        root: [0, 0.07, 0],
        pose: {
          hips: [0, -32, 0],
          spine: [-6, -10, 0],
          neck: [0, 28, 0],
          thighL: [-46, 0, 6],
          shinL: [46, 0, 0],
          thighR: [14, 0, -4],
          shinR: [50, 0, 0],
          forearmR: [-30, 0, 0],
        },
        aimL: [190, 10],
        aimR: [70, 20],
      },
      {
        t: 0.43,
        root: [0, -0.05, 0],
        pose: {
          hips: [0, -22, 0],
          spine: [4, -4, 0],
          neck: [-6, 18, 0],
          thighL: [-38, 0, 2],
          shinL: [8, 0, 0],
          thighR: [30, 0, -6],
          shinR: [38, 0, 0],
          forearmR: [-4, 0, 0],
          forearmL: [-40, 0, 0],
        },
        aimL: [258, 16],
        aimR: [150, 14],
      },
      {
        t: 0.5,
        root: [0, -0.06, 0],
        pose: {
          hips: [0, 0, 0],
          spine: [24, 14, 0],
          chest: [10, 6, 0],
          neck: [-14, 0, 0],
          thighL: [-30, 0, 2],
          shinL: [4, 0, 0],
          thighR: [40, 0, -4],
          shinR: [56, 0, 0],
          forearmL: [-96, 0, 0],
        },
        aimL: [336, 30],
        aimR: [200, 12],
      },
      {
        t: 0.64,
        root: [0, -0.1, 0],
        pose: {
          hips: [0, 16, 0],
          spine: [40, 28, 0],
          neck: [-24, -8, 0],
          thighL: [6, 0, 2],
          shinL: [20, 0, 0],
          thighR: [-48, 0, -4],
          shinR: [50, 0, 0],
          forearmR: [-20, 0, 0],
        },
        aimL: [18, 26],
        aimR: [294, -14],
      },
      {
        t: 0.86,
        root: [0, -0.04, 0],
        pose: { ...RUN_B.pose!, hips: [0, 6, 0], spine: [24, 10, 0], forearmR: [-40, 0, 0] },
        aimL: [30, 16],
        aimR: [334, -10],
      },
      { t: 1.45, root: [0, 0, 0], pose: { ...WALK_A.pose!, spine: [6, 0, 0] }, aimL: [8, 7], aimR: [358, -7] },
    ],
  },
  bowl_side_on: {
    duration: 1.6,
    markers: { release: 0.6, frontFoot: 0.52 },
    keys: [
      { t: 0, root: [0, -0.03, 0], pose: { ...RUN_A.pose!, forearmR: [-110, 0, 0] }, aimL: [40, 8], aimR: [320, 10] },
      {
        t: 0.16,
        root: [0, 0.1, 0],
        pose: {
          hips: [0, -30, 0],
          spine: [4, -14, 0],
          thighR: [-62, 0, -4],
          shinR: [76, 0, 0],
          thighL: [22, 0, 4],
          shinL: [44, 0, 0],
          forearmR: [-120, 0, 0],
          neck: [0, 30, 0],
        },
        aimL: [206, 4],
        aimR: [292, 8],
      },
      {
        t: 0.34,
        root: [0, 0.14, 0],
        pose: {
          hips: [0, -84, 0],
          spine: [-10, -6, 0],
          chest: [-6, 0, 0],
          neck: [0, 70, 0],
          head: [-8, 14, 0],
          thighL: [-52, 0, 6],
          shinL: [58, 0, 0],
          thighR: [10, 0, -4],
          shinR: [66, 0, 0],
          forearmR: [-30, 0, 0],
          forearmL: [-4, 0, 0],
        },
        aimL: [200, 2],
        aimR: [60, 8],
      },
      {
        t: 0.46,
        root: [0, -0.02, 0],
        pose: {
          hips: [0, -88, 0],
          spine: [-16, -4, 0],
          neck: [0, 74, 0],
          thighL: [-58, 0, 4],
          shinL: [18, 0, 0],
          thighR: [16, 0, -4],
          shinR: [28, 0, 0],
          forearmR: [-4, 0, 0],
        },
        aimL: [210, 2],
        aimR: [104, 6],
      },
      {
        t: 0.52,
        root: [0, -0.06, 0],
        pose: {
          hips: [0, -60, 0],
          spine: [-4, -2, 0],
          neck: [-6, 52, 0],
          thighL: [-40, 0, 2],
          shinL: [6, 0, 0],
          thighR: [32, 0, -6],
          shinR: [40, 0, 0],
          forearmL: [-36, 0, 0],
        },
        aimL: [256, 8],
        aimR: [150, 4],
      },
      {
        t: 0.6,
        root: [0, -0.06, 0],
        pose: {
          hips: [0, -14, 0],
          spine: [20, 8, 0],
          chest: [8, 4, 0],
          neck: [-12, 6, 0],
          head: [-8, 0, 0],
          thighL: [-30, 0, 2],
          shinL: [4, 0, 0],
          thighR: [42, 0, -4],
          shinR: [56, 0, 0],
          forearmL: [-100, 0, 0],
        },
        aimL: [346, 26],
        aimR: [192, 2],
      },
      {
        t: 0.76,
        root: [0, -0.1, 0],
        pose: {
          hips: [0, 20, 0],
          spine: [46, 32, 0],
          chest: [14, 10, 0],
          neck: [-26, -10, 0],
          thighL: [8, 0, 2],
          shinL: [22, 0, 0],
          thighR: [-52, 0, -4],
          shinR: [52, 0, 0],
          forearmR: [-20, 0, 0],
        },
        aimL: [18, 28],
        aimR: [290, -20],
      },
      {
        t: 0.98,
        root: [0, -0.04, 0],
        pose: { ...RUN_B.pose!, hips: [0, 8, 0], spine: [26, 12, 0], forearmR: [-40, 0, 0] },
        aimL: [30, 16],
        aimR: [330, -10],
      },
      { t: 1.6, root: [0, 0, 0], pose: { ...WALK_A.pose!, spine: [6, 0, 0] }, aimL: [8, 7], aimR: [358, -7] },
    ],
  },
  bowl_off_spin: {
    duration: 1.4,
    markers: { release: 0.52, frontFoot: 0.44 },
    keys: [
      {
        t: 0,
        root: [0, -0.02, 0],
        pose: { ...scalePose(RUN_A.pose!, 0.6), forearmR: [-116, 0, 0], handR: [0, 50, 0] },
        aimL: [30, 8],
        aimR: [320, 8],
      },
      {
        t: 0.18,
        root: [0, 0.1, 0],
        pose: {
          hips: [0, -40, 0],
          spine: [-2, -10, 0],
          neck: [0, 40, 0],
          thighR: [-50, 0, -4],
          shinR: [70, 0, 0],
          thighL: [14, 0, 4],
          shinL: [40, 0, 0],
          forearmR: [-120, 0, 0],
          handR: [0, 60, 0],
        },
        aimL: [180, 6],
        aimR: [300, 6],
      },
      {
        t: 0.34,
        root: [0, 0.02, 0],
        pose: {
          hips: [0, -78, 0],
          spine: [-6, -8, 0],
          neck: [0, 66, 0],
          thighL: [-44, 0, 6],
          shinL: [30, 0, 0],
          thighR: [14, 0, -4],
          shinR: [30, 0, 0],
          forearmR: [-30, 0, 0],
        },
        aimL: [196, 2],
        aimR: [92, 4],
      },
      {
        t: 0.44,
        root: [0, -0.06, 0],
        pose: {
          hips: [0, -50, 0],
          spine: [4, -2, 0],
          neck: [-6, 46, 0],
          thighL: [-36, 0, 2],
          shinL: [8, 0, 0],
          thighR: [28, 0, -6],
          shinR: [40, 0, 0],
          forearmR: [-8, 0, 0],
          forearmL: [-40, 0, 0],
        },
        aimL: [250, 6],
        aimR: [150, 2],
      },
      {
        t: 0.52,
        root: [0, -0.08, 0],
        pose: {
          hips: [0, -10, 0],
          spine: [20, 18, 0],
          chest: [6, 10, 0],
          neck: [-12, 4, 0],
          thighL: [-28, 0, 2],
          shinL: [8, 0, 0],
          thighR: [38, 0, -4],
          shinR: [54, 0, 0],
          forearmL: [-100, 0, 0],
          handR: [10, -40, 0],
        },
        aimL: [336, 24],
        aimR: [188, 0],
      },
      {
        t: 0.7,
        root: [0, -0.14, 0],
        pose: {
          hips: [0, 38, 0],
          spine: [48, 40, 0],
          chest: [14, 14, 0],
          neck: [-28, -24, 0],
          thighL: [-10, 0, 2],
          shinL: [36, 0, 0],
          thighR: [-46, 0, -20],
          shinR: [60, 0, 0],
          handR: [0, -50, 0],
          forearmR: [-30, 0, 0],
        },
        aimL: [10, 24],
        aimR: [300, -24],
      },
      {
        t: 0.95,
        root: [0, -0.06, 0],
        pose: {
          hips: [0, 20, 0],
          spine: [22, 14, 0],
          neck: [-10, -8, 0],
          thighL: [-14, 0, 4],
          shinL: [24, 0, 0],
          thighR: [-6, 0, -8],
          shinR: [30, 0, 0],
          handR: [0, 0, 0],
        },
        aimL: [20, 14],
        aimR: [330, -10],
      },
      { t: 1.4, root: [0, 0, 0], pose: { ...STAND, spine: [6, 0, 0] }, aimL: [6, 7], aimR: [358, -7] },
    ],
  },
  bowl_leg_spin: {
    duration: 1.45,
    markers: { release: 0.54, frontFoot: 0.46 },
    keys: [
      {
        t: 0,
        root: [0, -0.02, 0],
        pose: { ...scalePose(RUN_A.pose!, 0.6), forearmR: [-116, 0, 0], handR: [0, 0, -40] },
        aimL: [30, 8],
        aimR: [320, 10],
      },
      {
        t: 0.2,
        root: [0, 0.14, 0],
        pose: {
          hips: [0, -30, 0],
          spine: [-4, -8, 0],
          neck: [0, 30, 0],
          thighR: [-56, 0, -4],
          shinR: [80, 0, 0],
          thighL: [20, 0, 4],
          shinL: [50, 0, 0],
          forearmR: [-110, 0, 0],
          handR: [0, 0, -50],
        },
        aimL: [186, 12],
        aimR: [298, 14],
      },
      {
        t: 0.36,
        root: [0, 0.03, 0],
        pose: {
          hips: [0, -66, 0],
          spine: [-8, -6, 0],
          neck: [0, 56, 0],
          thighL: [-46, 0, 6],
          shinL: [30, 0, 0],
          thighR: [14, 0, -4],
          shinR: [32, 0, 0],
          forearmR: [-34, 0, 0],
        },
        aimL: [200, 6],
        aimR: [96, 16],
      },
      {
        t: 0.46,
        root: [0, -0.06, 0],
        pose: {
          hips: [0, -40, 0],
          spine: [6, 0, 0],
          neck: [-6, 40, 0],
          thighL: [-36, 0, 2],
          shinL: [8, 0, 0],
          thighR: [28, 0, -6],
          shinR: [40, 0, 0],
          forearmR: [-10, 0, 0],
          forearmL: [-40, 0, 0],
        },
        aimL: [248, 10],
        aimR: [148, 14],
      },
      {
        t: 0.54,
        root: [0, -0.07, 0],
        pose: {
          hips: [0, -2, 0],
          spine: [22, 20, 0],
          chest: [6, 10, 0],
          neck: [-12, 0, 0],
          thighL: [-28, 0, 2],
          shinL: [8, 0, 0],
          thighR: [38, 0, -4],
          shinR: [54, 0, 0],
          forearmL: [-100, 0, 0],
          handR: [0, 0, 50],
        },
        aimL: [334, 26],
        aimR: [196, 14],
      },
      {
        t: 0.72,
        root: [0, -0.12, 0],
        pose: {
          hips: [0, 30, 0],
          spine: [44, 34, 0],
          chest: [12, 12, 0],
          neck: [-26, -16, 0],
          thighL: [-8, 0, 2],
          shinL: [30, 0, 0],
          thighR: [-44, 0, -14],
          shinR: [56, 0, 0],
          handR: [0, 0, 30],
          forearmR: [-30, 0, 0],
        },
        aimL: [14, 24],
        aimR: [296, -20],
      },
      {
        t: 0.98,
        root: [0, 0.02, 0],
        pose: { ...RUN_B.pose!, hips: [0, 10, 0], spine: [18, 8, 0], handR: [0, 0, 0] },
        aimL: [24, 14],
        aimR: [334, -10],
      },
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
      {
        t: 0.18,
        root: [0, -0.3, 0],
        pose: {
          thighL: [-70, 0, 20],
          thighR: [-70, 0, -20],
          shinL: [96, 0, 0],
          shinR: [96, 0, 0],
          spine: [24, 0, 0],
          upperArmL: [-74, 0, 6],
          upperArmR: [-74, 0, -6],
          forearmL: [-36, 0, 0],
          forearmR: [-36, 0, 0],
        },
      },
      {
        t: 0.3,
        root: [0, -0.26, 0],
        pose: { upperArmL: [-66, 0, 2], upperArmR: [-66, 0, -2], forearmL: [-52, 0, 0], forearmR: [-52, 0, 0] },
      },
      {
        t: 1.0,
        root: [0, -0.08, 0],
        pose: {
          thighL: [-22, 0, 10],
          thighR: [-22, 0, -10],
          shinL: [32, 0, 0],
          shinR: [32, 0, 0],
          footL: [-8, 0, 0],
          footR: [-8, 0, 0],
          spine: [10, 0, 0],
          neck: [-6, 0, 0],
          head: [0, 0, 0],
          upperArmL: [-40, 0, 14],
          upperArmR: [-40, 0, -14],
          forearmL: [-96, 0, 0],
          forearmR: [-96, 0, 0],
        },
      },
    ],
  },
  keep_stump: {
    duration: 1.1,
    markers: { catch: 0.22, hit: 0.42 },
    keys: [
      { t: 0, root: [0, -0.5, 0], pose: SQUAT },
      {
        t: 0.22,
        root: [0, -0.32, 0],
        pose: {
          thighL: [-70, 0, 20],
          thighR: [-70, 0, -20],
          shinL: [96, 0, 0],
          shinR: [96, 0, 0],
          upperArmL: [-70, 0, 4],
          upperArmR: [-70, 0, -4],
          forearmL: [-48, 0, 0],
          forearmR: [-48, 0, 0],
        },
      },
      {
        t: 0.42,
        root: [0, -0.4, 0.15],
        pose: {
          spine: [48, 10, 0],
          upperArmL: [-40, 0, -10],
          upperArmR: [-30, 0, 10],
          forearmL: [-20, 0, 0],
          forearmR: [-20, 0, 0],
        },
      },
      {
        t: 1.1,
        root: [0, -0.1, 0.1],
        pose: {
          thighL: [-20, 0, 8],
          thighR: [-20, 0, -8],
          shinL: [30, 0, 0],
          shinR: [30, 0, 0],
          spine: [-10, 0, 0],
          neck: [-20, 0, 0],
        },
        aimR: [175, 25],
        aimL: [175, 25],
      },
    ],
  },

  // ---- umpiring ----------------------------------------------------------------------------------------------
  ump_stand: {
    duration: 3,
    loop: true,
    keys: [
      {
        t: 0,
        root: [0, 0, 0],
        pose: {
          ...STAND,
          spine: [8, 0, 0],
          upperArmL: [-16, 0, -14],
          upperArmR: [-16, 0, 14],
          forearmL: [-62, 0, 0],
          forearmR: [-62, 0, 0],
        },
      },
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
      {
        t: 0.4,
        pose: { upperArmL: [-178, 0, 8], upperArmR: [-178, 0, -8], forearmL: [-4, 0, 0], forearmR: [-4, 0, 0] },
      },
      { t: 1.8, pose: { upperArmL: [-176, 0, 10], upperArmR: [-176, 0, -10] } },
      { t: 2.2, pose: { upperArmL: [-8, 0, 8], upperArmR: [-8, 0, -8], forearmL: [-20, 0, 0], forearmR: [-20, 0, 0] } },
    ],
  },
  ump_out: {
    duration: 2.2,
    keys: [
      {
        t: 0,
        root: [0, 0, 0],
        pose: {
          ...STAND,
          upperArmL: [-16, 0, -14],
          upperArmR: [-16, 0, 14],
          forearmL: [-62, 0, 0],
          forearmR: [-62, 0, 0],
        },
      },
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
      {
        t: 0.3,
        root: [0, -0.1, 0],
        pose: { thighL: [-20, 0, 15], shinL: [30, 0, 0], thighR: [-18, 0, -13], shinR: [30, 0, 0] },
      },
      { t: 1, root: [0, -0.09, 0] },
    ],
  },
  foot_forward: {
    duration: 1,
    keys: [
      { t: 0, root: STANCE_ROOT, pose: STANCE_LOWER },
      { t: 0.14, root: [0.06, -0.06, 0], pose: { thighL: [-30, 0, 22], shinL: [52, 0, 0], footL: [10, -16, 0] } },
      {
        t: 0.32,
        root: [0.3, -0.13, 0.02],
        pose: {
          hips: [0, 6, 0],
          thighL: [-34, 0, 34],
          shinL: [34, 0, 0],
          footL: [-10, -20, 0],
          thighR: [8, 0, -26],
          shinR: [16, 0, 0],
          footR: [10, 10, 0],
        },
      },
      { t: 1, root: [0.32, -0.14, 0.02] },
    ],
  },
  foot_back: {
    duration: 1,
    keys: [
      { t: 0, root: STANCE_ROOT, pose: STANCE_LOWER },
      { t: 0.16, root: [-0.08, -0.04, 0.04], pose: { thighR: [-26, 0, -22], shinR: [48, 0, 0] } },
      {
        t: 0.32,
        root: [-0.24, -0.04, 0.06],
        pose: {
          hips: [0, -8, 0],
          thighR: [-6, 0, -26],
          shinR: [14, 0, 0],
          footR: [-6, 14, 0],
          thighL: [-8, 0, 6],
          shinL: [18, 0, 0],
          footL: [6, -10, 0],
        },
      },
      { t: 1, root: [-0.24, -0.05, 0.06] },
    ],
  },
  foot_across: {
    duration: 1,
    keys: [
      { t: 0, root: STANCE_ROOT, pose: STANCE_LOWER },
      { t: 0.16, root: [-0.02, -0.05, 0.08], pose: { thighR: [-40, 0, -10], shinR: [50, 0, 0] } },
      {
        t: 0.32,
        root: [-0.04, -0.08, 0.16],
        pose: {
          hips: [0, 10, 0],
          thighR: [-28, 0, -4],
          shinR: [24, 0, 0],
          footR: [-8, 20, 0],
          thighL: [-6, 0, 16],
          shinL: [20, 0, 0],
        },
      },
      { t: 1, root: [-0.04, -0.08, 0.16] },
    ],
  },
  foot_charge: {
    duration: 1,
    keys: [
      { t: 0, root: STANCE_ROOT, pose: STANCE_LOWER },
      {
        t: 0.12,
        root: [0.3, -0.04, 0],
        pose: { hips: [0, 30, 0], thighL: [-30, 0, 20], shinL: [40, 0, 0], thighR: [10, 0, -10], shinR: [50, 0, 0] },
      },
      {
        t: 0.24,
        root: [0.75, 0.01, 0],
        pose: { hips: [0, 20, 0], thighL: [8, 0, 10], shinL: [50, 0, 0], thighR: [-30, 0, -16], shinR: [30, 0, 0] },
      },
      {
        t: 0.36,
        root: [1.15, -0.13, 0],
        pose: {
          hips: [0, 4, 0],
          thighL: [-36, 0, 32],
          shinL: [30, 0, 0],
          footL: [-10, -20, 0],
          thighR: [10, 0, -26],
          shinR: [18, 0, 0],
        },
      },
      { t: 1, root: [1.2, -0.14, 0] },
    ],
  },
  foot_sweep: {
    duration: 1.2,
    keys: [
      { t: 0, root: STANCE_ROOT, pose: STANCE_LOWER },
      {
        t: 0.3,
        root: [0.25, -0.34, 0],
        pose: {
          thighL: [-70, 0, 26],
          shinL: [80, 0, 0],
          footL: [-12, -10, 0],
          thighR: [24, 0, -18],
          shinR: [100, 0, 0],
          footR: [34, 0, 0],
        },
      },
      {
        t: 0.42,
        root: [0.3, -0.46, 0],
        pose: { thighL: [-80, 0, 28], shinL: [90, 0, 0], thighR: [30, 0, -14], shinR: [118, 0, 0] },
      },
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
      {
        t: 0.36,
        pose: { spine: [30, 4, 0], neck: [-6, 32, 0], head: [6, 26, 0] },
        bat: { grip: [0.2, 0.8, 0.34], dir: [0.18, -0.98, 0.05] },
      },
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
      {
        t: 0.38,
        pose: { spine: [30, 6, 0], head: [6, 26, 0] },
        bat: { grip: [0.18, 0.86, 0.34], dir: [-0.1, -0.99, 0.08] },
      },
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
      {
        t: 0.22,
        pose: { spine: [24, -12, 0], chest: [6, -4, 0] },
        bat: { grip: [-0.1, 1.14, 0.16], dir: [-0.56, 0.78, -0.26] },
      },
      {
        t: 0.4,
        pose: { spine: [30, 2, 0], chest: [8, 4, 0], head: [4, 28, 0] },
        bat: { grip: [0.14, 0.98, 0.32], dir: [-0.28, -0.95, 0.1] },
      },
      {
        t: 0.48,
        pose: { spine: [34, 8, 0], neck: [-4, 30, 0], head: [8, 24, 0] },
        bat: { grip: [0.34, 0.78, 0.3], dir: [0.06, -0.99, 0.08] },
      },
      {
        t: 0.68,
        pose: { spine: [22, 20, 0], chest: [6, 12, 0] },
        bat: { grip: [0.44, 1.26, 0.22], dir: [0.66, 0.68, -0.26] },
      },
      {
        t: 0.98,
        pose: { spine: [12, 24, 0], chest: [2, 14, 0], neck: [-14, 20, 0], head: [-6, 16, 0] },
        bat: { grip: [0.3, 1.54, 0.1], dir: [0.24, 0.9, -0.36] },
      },
      { t: 1.5, pose: { spine: [12, 22, 0] }, bat: { grip: [0.28, 1.46, 0.12], dir: [0.26, 0.9, -0.34] } },
    ],
  },
  bat_loft: {
    duration: 1.6,
    markers: { contact: 0.5 },
    keys: [
      { t: 0, pose: STANCE_UPPER, bat: BAT_STANCE },
      {
        t: 0.24,
        pose: { spine: [20, -20, 0], chest: [4, -8, 0] },
        bat: { grip: [-0.16, 1.3, 0.12], dir: [-0.76, 0.6, -0.24] },
      },
      {
        t: 0.42,
        pose: { spine: [26, 0, 0], chest: [6, 2, 0], head: [2, 26, 0] },
        bat: { grip: [0.12, 1.04, 0.3], dir: [-0.42, -0.9, 0.08] },
      },
      {
        t: 0.5,
        pose: { spine: [24, 10, 0], neck: [-10, 30, 0], head: [0, 20, 0] },
        bat: { grip: [0.32, 0.86, 0.28], dir: [0.22, -0.96, 0.12] },
      },
      {
        t: 0.72,
        pose: { spine: [6, 30, 0], chest: [-4, 16, 0], neck: [-24, 16, 0], head: [-16, 10, 0] },
        bat: { grip: [0.36, 1.48, 0.12], dir: [0.5, 0.82, -0.28] },
      },
      {
        t: 1.0,
        pose: { spine: [-2, 36, 0], chest: [-6, 18, 0], neck: [-30, 12, 0], head: [-20, 8, 0] },
        bat: { grip: [0.22, 1.68, -0.04], dir: [-0.06, 0.82, -0.56] },
      },
      {
        t: 1.6,
        pose: { spine: [2, 34, 0], neck: [-28, 12, 0] },
        bat: { grip: [0.2, 1.62, -0.02], dir: [-0.08, 0.82, -0.56] },
      },
    ],
  },
  bat_cut: {
    duration: 1.4,
    markers: { contact: 0.46 },
    keys: [
      { t: 0, pose: STANCE_UPPER, bat: BAT_STANCE },
      {
        t: 0.22,
        pose: { spine: [16, -16, 0], chest: [4, -6, 0] },
        bat: { grip: [-0.12, 1.3, 0.12], dir: [-0.6, 0.72, -0.34] },
      },
      {
        t: 0.38,
        pose: { spine: [18, -4, 0], head: [2, 22, 0] },
        bat: { grip: [0.04, 1.26, 0.3], dir: [0.1, 0.2, 0.97] },
      },
      {
        t: 0.46,
        pose: { spine: [26, 6, 0], neck: [-8, 22, 0], head: [8, 18, 0] },
        bat: { grip: [0.16, 1.06, 0.4], dir: [0.18, -0.3, 0.94] },
      },
      { t: 0.7, pose: { spine: [24, 14, 0] }, bat: { grip: [0.06, 1.0, 0.44], dir: [-0.3, -0.5, 0.81] } },
      { t: 1.4, pose: { spine: [18, 10, 0] }, bat: { grip: [0.02, 1.08, 0.36], dir: [-0.22, -0.6, 0.77] } },
    ],
  },
  bat_pull: {
    duration: 1.4,
    markers: { contact: 0.46 },
    keys: [
      { t: 0, pose: STANCE_UPPER, bat: BAT_STANCE },
      {
        t: 0.22,
        pose: { spine: [14, -16, 0], chest: [2, -8, 0] },
        bat: { grip: [-0.12, 1.32, 0.12], dir: [-0.62, 0.74, -0.24] },
      },
      {
        t: 0.38,
        pose: { spine: [10, 14, 0], chest: [0, 10, 0], head: [-2, 20, 0] },
        bat: { grip: [0.08, 1.22, 0.3], dir: [0.4, 0.3, 0.86] },
      },
      {
        t: 0.46,
        pose: { spine: [8, 34, 0], chest: [0, 18, 0], neck: [-8, 10, 0], head: [-2, 8, 0] },
        bat: { grip: [0.2, 1.18, 0.24], dir: [0.94, -0.06, 0.32] },
      },
      {
        t: 0.66,
        pose: { spine: [8, 58, 0], chest: [0, 24, 0], neck: [-10, -10, 0] },
        bat: { grip: [0.06, 1.3, 0.04], dir: [0.2, 0.3, -0.93] },
      },
      {
        t: 1.4,
        pose: { spine: [8, 56, 0], chest: [0, 24, 0] },
        bat: { grip: [-0.04, 1.36, 0.0], dir: [-0.1, 0.5, -0.86] },
      },
    ],
  },
  bat_sweep: {
    duration: 1.6,
    markers: { contact: 0.56 },
    keys: [
      { t: 0, pose: STANCE_UPPER, bat: BAT_STANCE },
      { t: 0.26, pose: { spine: [26, -10, 0] }, bat: { grip: [-0.06, 1.02, 0.18], dir: [-0.62, 0.72, -0.3] } },
      {
        t: 0.44,
        pose: { spine: [38, 0, 0], head: [6, 26, 0] },
        bat: { grip: [0.18, 0.62, 0.32], dir: [0.3, -0.5, 0.81] },
      },
      {
        t: 0.56,
        pose: { spine: [40, 14, 0], neck: [-6, 22, 0], head: [8, 18, 0] },
        bat: { grip: [0.26, 0.5, 0.32], dir: [0.82, -0.36, 0.44] },
      },
      {
        t: 0.8,
        pose: { spine: [38, 40, 0], chest: [6, 16, 0] },
        bat: { grip: [0.1, 0.58, 0.14], dir: [0.2, -0.2, -0.96] },
      },
      { t: 1.6, pose: { spine: [36, 40, 0] }, bat: { grip: [0.06, 0.62, 0.1], dir: [0.1, -0.2, -0.97] } },
    ],
  },
  bat_leave: {
    duration: 1.3,
    markers: { contact: 0.46 },
    keys: [
      { t: 0, pose: STANCE_UPPER, bat: BAT_STANCE },
      { t: 0.24, pose: { spine: [16, -6, 0] }, bat: { grip: [-0.08, 1.2, 0.12], dir: [-0.5, 0.8, -0.3] } },
      {
        t: 0.46,
        pose: { spine: [10, -10, 0], neck: [-6, 46, 0], head: [-4, 30, 0] },
        bat: { grip: [-0.12, 1.46, 0.04], dir: [-0.24, 0.92, -0.3] },
      },
      { t: 1.3, pose: { spine: [10, -8, 0] }, bat: { grip: [-0.12, 1.44, 0.04], dir: [-0.24, 0.92, -0.3] } },
    ],
  },
  bat_run: {
    ...cycle(
      0.64,
      {
        ...RUN_A,
        pose: { ...RUN_A.pose!, upperArmR: [-40, 0, -8], forearmR: [-30, 0, 0] },
        bat: { grip: [-0.3, 0.9, 0.3], dir: [0.1, -0.35, 0.93] },
        twoHands: false,
      },
      {
        ...RUN_B,
        pose: { ...RUN_B.pose!, upperArmR: [-40, 0, -8], forearmR: [-30, 0, 0] },
        bat: { grip: [-0.3, 0.94, 0.32], dir: [0.1, -0.3, 0.95] },
        twoHands: false,
      },
    ),
    linear: true,
  },
  // A batter at ease between deliveries and after a stroke: upright, knees soft, both hands resting on the handle of
  // the grounded bat in front of him (a slow breath in the chest).
  bat_rest: {
    duration: 3.6,
    loop: true,
    keys: [
      {
        t: 0,
        root: [0, -0.015, 0],
        pose: {
          ...STAND,
          spine: [6, 0, 0],
          chest: [3, 0, 0],
          neck: [-6, 0, 0],
          thighL: [-4, 0, 4],
          shinL: [8, 0, 0],
          thighR: [-2, 0, -4],
          shinR: [6, 0, 0],
        },
        bat: { grip: [-0.06, 0.74, 0.34], dir: [0.06, -0.97, 0.22] },
      },
      {
        t: 1.8,
        root: [0.008, -0.02, 0],
        pose: { chest: [4.5, 1, 0], neck: [-7, 2, 0] },
        bat: { grip: [-0.06, 0.745, 0.34], dir: [0.06, -0.97, 0.22] },
      },
      {
        t: 3.6,
        root: [0, -0.015, 0],
        pose: {
          ...STAND,
          spine: [6, 0, 0],
          chest: [3, 0, 0],
          neck: [-6, 0, 0],
          thighL: [-4, 0, 4],
          shinL: [8, 0, 0],
          thighR: [-2, 0, -4],
          shinR: [6, 0, 0],
        },
        bat: { grip: [-0.06, 0.74, 0.34], dir: [0.06, -0.97, 0.22] },
      },
    ],
  },
  // Running between the wickets, the last strides into the crease: leaning down, the bat stretched out in the bottom
  // hand and slid along the turf over the line (the legs come from the run underneath).
  bat_slide: {
    duration: 0.5,
    keys: [
      {
        t: 0,
        pose: {
          spine: [40, 0, 0],
          chest: [10, 0, 0],
          neck: [-30, 0, 0],
          head: [-10, 0, 0],
          upperArmR: [-66, 0, -8],
          forearmR: [-10, 0, 0],
          handR: [0, 0, 0],
          upperArmL: [24, 0, 16],
          forearmL: [-46, 0, 0],
        },
        bat: { grip: [-0.28, 0.5, 0.64], dir: [0.04, -0.6, 0.8] },
        twoHands: false,
      },
      {
        t: 0.5,
        pose: { spine: [44, 0, 0], chest: [12, 0, 0], neck: [-32, 0, 0] },
        bat: { grip: [-0.28, 0.47, 0.68], dir: [0.04, -0.58, 0.81] },
        twoHands: false,
      },
    ],
  },
  bat_raise: {
    duration: 1.8,
    keys: [
      {
        t: 0,
        root: [0, -0.04, 0],
        pose: { ...STAND, spine: [6, 0, 0] },
        bat: { grip: [-0.24, 0.86, 0.12], dir: [0.1, -0.98, 0.1] },
        twoHands: false,
      },
      {
        t: 0.5,
        root: [0, -0.02, 0],
        pose: { spine: [-6, 0, 0], neck: [-16, 0, 0] },
        bat: { grip: [-0.22, 1.98, 0.12], dir: [0.06, 0.96, 0.24] },
        aimL: [176, 30],
        twoHands: false,
      },
      {
        t: 1.4,
        root: [0, -0.02, 0],
        bat: { grip: [-0.22, 2.0, 0.1], dir: [0.12, 0.96, 0.22] },
        aimL: [170, 32],
        twoHands: false,
      },
      {
        t: 1.8,
        root: [0, -0.03, 0],
        pose: { spine: [4, 0, 0], neck: [-4, 0, 0] },
        bat: { grip: [-0.24, 0.9, 0.12], dir: [0.1, -0.98, 0.1] },
        aimL: [10, 8],
        twoHands: false,
      },
    ],
  },
  bat_walk: {
    ...cycle(
      1.1,
      {
        ...WALK_A,
        pose: {
          ...WALK_A.pose!,
          neck: [22, 0, 0],
          head: [10, 0, 0],
          spine: [8, 0, 0],
          upperArmR: [-20, 0, -14],
          forearmR: [-50, 0, 0],
        },
        bat: { grip: [-0.26, 0.98, 0.18], dir: [0.12, -0.2, 0.97] },
        twoHands: false,
      },
      {
        ...WALK_B,
        pose: {
          ...WALK_B.pose!,
          neck: [24, 0, 0],
          head: [10, 0, 0],
          spine: [8, 0, 0],
          upperArmR: [-20, 0, -14],
          forearmR: [-50, 0, 0],
        },
        bat: { grip: [-0.26, 0.98, 0.18], dir: [0.12, -0.2, 0.97] },
        twoHands: false,
      },
    ),
  },
} satisfies Record<string, ClipDef>;

/** A clip authored in code (this file). */
export type BuiltinClipId = keyof typeof CLIPS;
/** A clip from a VMP1 motion pack (MOTION-SPEC), by its pack id: `vmp:loco_walk`. Loaded lazily (core/motion). */
export type MotionClipId = `vmp:${string}`;
export type ClipId = BuiltinClipId | MotionClipId;

/** A pack clip as the sampler sees it (core/motion/library registers these from the decoded packs). */
export interface MotionSource {
  duration: number;
  loop: boolean;
  /** Mean ground speed of a gait loop at rate 1 (m/s, scale 1), else 0. */
  speedMps: number;
  markers: Readonly<Record<string, number>>;
  /** Writes the clip's pose at t (s) into `out` (every bone, the hips offset, the bat key when it has one). */
  sample(t: number, out: SampledPose): void;
  /** The clip's contact bits at t (MOTION-SPEC §5.3: bit0 footL, bit1 footR, …). */
  contacts?(t: number): number;
  /** The clip's ground track at t (m, deg; MOTION-SPEC §5.3), loops accumulating their travel. */
  ground?(t: number): { x: number; z: number; yawDeg: number };
  /** The bat is held in the bottom hand only: the top hand is free (a celebration, a walk-off; core/motion/library ONE_HAND_BAT_CLIPS). */
  oneHand?: boolean;
}

/** Clips composed at run time from pack clips (a fitted run-up), by id; they live as long as the packs they use. */
const composed = new Map<string, MotionSource>();

/** Registers a composed clip under `vmp:<name>` (replacing one of the same name). */
export function registerComposedMotion(name: string, src: MotionSource): void {
  composed.set(name, src);
}

let motionSources: ReadonlyMap<string, MotionSource> = new Map();

/**
 * The pack clips scripts may name (`vmp:<id>`), replaced as a whole between deliveries (core/motion/library
 * commitMotion), never during one. Null clears them.
 */
export function setMotionSources(sources: ReadonlyMap<string, MotionSource> | null): void {
  motionSources = sources ?? new Map();
  composed.clear();
}

/** The registered pack (or composed) clip of a motion clip id, if any. */
export function motionSource(id: string): MotionSource | undefined {
  if (!id.startsWith('vmp:')) return undefined;
  const name = id.slice(4);
  return motionSources.get(name) ?? composed.get(name);
}

/** True when a pack clip is registered (scripts choose it, else a built-in stand-in, when they are built). */
export function hasMotionClip(name: string): boolean {
  return motionSources.has(name);
}

/** The built-in clip that stands in for a pack clip that is not loaded (a script built with one keeps working). */
const MOTION_STAND_IN: Readonly<Record<string, BuiltinClipId>> = {
  loco_idle: 'idle',
  loco_walk: 'walk',
  loco_jog: 'jog',
  loco_run: 'run',
  loco_sprint: 'run',
  loco_start: 'run_drive',
  loco_stop: 'jog',
  bat_stance_live: 'stance',
  bat_trigger: 'stance',
  bat_backlift: 'stance',
  bat_ready_hold: 'stance',
};

function builtinOf(id: ClipId): BuiltinClipId {
  return id.startsWith('vmp:') ? (MOTION_STAND_IN[id.slice(4)] ?? 'idle') : (id as BuiltinClipId);
}

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

const compiled = new Map<BuiltinClipId, CompiledClip>();

function compile(id: BuiltinClipId): CompiledClip {
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
    if (k.bat)
      bat = { grip: [...k.bat.grip] as [number, number, number], dir: [...k.bat.dir] as [number, number, number] };
    if (k.twoHands !== undefined) twoHands = k.twoHands;
    const q = new Float32Array(NB * 4);
    for (let i = 0; i < NB; i++) {
      const e = current[BONE_NAMES[i]];
      quatFromEulerDeg(e ? e[0] : 0, e ? e[1] : 0, e ? e[2] : 0, tmp);
      q.set(tmp, i * 4);
    }
    keys.push({
      t: k.t,
      q,
      root: [...root] as [number, number, number],
      aimR: aimR ? [...aimR] : null,
      aimL: aimL ? [...aimL] : null,
      bat: bat ? { grip: [...bat.grip], dir: [...bat.dir] } : null,
      twoHands,
    });
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

export function getClip(clipId: ClipId): CompiledClip {
  const id = builtinOf(clipId);
  let c = compiled.get(id);
  if (!c) {
    c = compile(id);
    compiled.set(id, c);
  }
  return c;
}

export function clipDuration(id: ClipId): number {
  const m = motionSource(id);
  return m ? m.duration : (CLIPS[builtinOf(id)] as ClipDef).duration;
}
export function clipMarker(id: ClipId, name: string, fallback = 0): number {
  const m = motionSource(id);
  return (m ? m.markers[name] : (CLIPS[builtinOf(id)] as ClipDef).markers?.[name]) ?? fallback;
}

/** A sampled pose: bone quaternions plus root offset, arm aims and bat key. */
export interface SampledPose {
  q: Float32Array;
  root: [number, number, number];
  /**
   * The arm aims: [phi, lateral]. An aim that is only partly in force carries its weight 0..1 with it (`aimWeight`, absent: 1): a
   * cross-fade between a clip that aims an arm and one that does not holds the aim at its share of the fade, so the arm swings from
   * one to the other with it (players.applyAim turns the arm that part of the way); the aim used to switch whole at the half-way frame.
   */
  aimR: [number, number] | null;
  aimL: [number, number] | null;
  bat: { grip: [number, number, number]; dir: [number, number, number]; face?: [number, number, number] } | null;
  twoHands: boolean;
  /**
   * How much the top hand is on the handle (0..1; crossfades between one- and two-handed clips pass through it, so the
   * free hand is let go of the bat, or takes it, smoothly). Absent: `twoHands` ? 1 : 0.
   */
  topHand?: number;
  /**
   * The scene time (ms) this pose is drawn for, set by the batters' pose hook just before the stage holds the bat, so an
   * arm can carry its elbow over from the frame before (players.reachIK). Absent: a pose without a frame behind it.
   */
  stamp?: number;
}

/**
 * A batter's bat when a clip has no bat key of its own (standing, walking): carried in the bottom hand, toe down and a
 * little forward (actor frame, right-handed). Crossfades to and from a clip with a bat key blend through it, so the
 * bat never jumps between the two.
 */
export const CARRY_BAT_KEY: Readonly<{
  grip: readonly [number, number, number];
  dir: readonly [number, number, number];
}> = Object.freeze({
  grip: [-0.25, 0.85, 0.08] as const,
  dir: [0.12 / 0.9929, -0.98 / 0.9929, 0.0 / 0.9929] as const,
});

export function createPose(): SampledPose {
  const q = new Float32Array(NB * 4);
  for (let i = 0; i < NB; i++) q[i * 4 + 3] = 1;
  return { q, root: [0, 0, 0], aimR: null, aimL: null, bat: null, twoHands: true };
}

function lerp3(a: readonly number[], b: readonly number[], u: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

/**
 * A direction turned from `a` towards `b` (u 0..1) at a constant rate (slerp of unit vectors). Near-opposite
 * directions (a bat going from toe-up to toe-down) turn through the actor's sagittal plane (about its x axis), never
 * through a degenerate near-zero average.
 */
function slerpDir(a0: readonly number[], b0: readonly number[], u: number): [number, number, number] {
  const la = Math.hypot(a0[0], a0[1], a0[2]) || 1;
  const lb = Math.hypot(b0[0], b0[1], b0[2]) || 1;
  const a = [a0[0] / la, a0[1] / la, a0[2] / la];
  const b = [b0[0] / lb, b0[1] / lb, b0[2] / lb];
  const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const th = Math.acos(d);
  if (th < 1e-4) return lerp3(a, b, u);
  let axis = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  let n = Math.hypot(axis[0], axis[1], axis[2]);
  if (n < 0.08) {
    // Nearly opposite: turn about the actor's x axis (projected off a).
    axis = [1 - a[0] * a[0], -a[0] * a[1], -a[0] * a[2]];
    n = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  }
  const k = [axis[0] / n, axis[1] / n, axis[2] / n];
  const ang = th * u;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const kxa = [k[1] * a[2] - k[2] * a[1], k[2] * a[0] - k[0] * a[2], k[0] * a[1] - k[1] * a[0]];
  const kd = k[0] * a[0] + k[1] * a[1] + k[2] * a[2];
  return [
    a[0] * c + kxa[0] * s + k[0] * kd * (1 - c),
    a[1] * c + kxa[1] * s + k[1] * kd * (1 - c),
    a[2] * c + kxa[2] * s + k[2] * kd * (1 - c),
  ];
}

/** Samples a clip at `t` seconds into `out`. Looping clips wrap; others clamp. A pack clip samples its pack. */
export function sampleClip(id: ClipId, t: number, out: SampledPose): SampledPose {
  const m = motionSource(id);
  if (m) {
    m.sample(t, out);
    out.topHand = out.bat && !m.oneHand ? 1 : 0;
    return out;
  }
  const c = getClip(id);
  const time = c.loop ? ((t % c.duration) + c.duration) % c.duration : clamp(t, 0, c.duration);
  const keys = c.keys;
  let i = 0;
  while (i < keys.length - 2 && time > keys[i + 1].t) i++;
  const k0 = keys[i];
  const k1 = keys[Math.min(i + 1, keys.length - 1)];
  const span = k1.t - k0.t;
  let u = span > 0 ? clamp((time - k0.t) / span, 0, 1) : 0;
  if (!c.linear) u = smoothstep(0, 1, u);
  for (let b = 0; b < NB; b++)
    quatSlerp(k0.q.subarray(b * 4, b * 4 + 4), k1.q.subarray(b * 4, b * 4 + 4), u, out.q, b * 4);
  out.root = lerp3(k0.root, k1.root, u);
  if (weightedAims) {
    out.aimR = keyAim(k0.aimR, k1.aimR, u);
    out.aimL = keyAim(k0.aimL, k1.aimL, u);
  } else {
    out.aimR =
      k0.aimR && k1.aimR
        ? [k0.aimR[0] + (k1.aimR[0] - k0.aimR[0]) * u, k0.aimR[1] + (k1.aimR[1] - k0.aimR[1]) * u]
        : (k0.aimR ?? k1.aimR);
    out.aimL =
      k0.aimL && k1.aimL
        ? [k0.aimL[0] + (k1.aimL[0] - k0.aimL[0]) * u, k0.aimL[1] + (k1.aimL[1] - k0.aimL[1]) * u]
        : (k0.aimL ?? k1.aimL);
  }
  out.bat =
    k0.bat && k1.bat
      ? { grip: lerp3(k0.bat.grip, k1.bat.grip, u), dir: lerp3(k0.bat.dir, k1.bat.dir, u) }
      : (k0.bat ?? k1.bat);
  out.twoHands = u < 0.5 ? k0.twoHands : k1.twoHands;
  out.topHand = (k0.twoHands ? 1 : 0) + ((k1.twoHands ? 1 : 0) - (k0.twoHands ? 1 : 0)) * u;
  return out;
}

/**
 * The face a bat key has when it carries none: the one square to the blade that points the way the actor faces the bowler (+x
 * in the actor's frame, before the mirror), which is what holdBat gives such a key. A blade pointing along that axis has no such
 * face (the blade is square to it nowhere); the actor's +z stands in.
 */
function hintFace(dir: readonly number[]): [number, number, number] {
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const d = [dir[0] / l, dir[1] / l, dir[2] / l];
  const h = [1 - d[0] * d[0], -d[0] * d[1], -d[0] * d[2]];
  const n = Math.hypot(h[0], h[1], h[2]);
  return n < 1e-6 ? [0, 0, 1] : [h[0] / n, h[1] / n, h[2] / n];
}

/** A key's face: its own, else the hint (see hintFace). */
function keyFace(k: { dir: readonly number[]; face?: readonly number[] }): [number, number, number] {
  const f = k.face;
  if (!f) return hintFace(k.dir);
  const l = Math.hypot(f[0], f[1], f[2]) || 1;
  return [f[0] / l, f[1] / l, f[2] / l];
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
  a.aimR = weightedAims ? keyAim(a.aimR, b.aimR, w) : blendAim(a.aimR, b.aimR, w);
  a.aimL = weightedAims ? keyAim(a.aimL, b.aimL, w) : blendAim(a.aimL, b.aimL, w);
  if (a.bat && b.bat) {
    const fa = a.bat.face;
    const fb = b.bat.face;
    // Round 9: a face on one side only blends with the other side's hint (hintFace), never switches at half-way: the bat turned about
    // its blade by up to 70° in the one frame where the weight crossed 0.5 (the crossfade of a clip with a face into one without).
    const face = fa || fb ? slerpDir(fa ?? hintFace(a.bat.dir), fb ?? hintFace(b.bat.dir), w) : null;
    a.bat = {
      grip: lerp3(a.bat.grip, b.bat.grip, w),
      dir: slerpDir(a.bat.dir, b.bat.dir, w),
      ...(face ? { face } : {}),
    };
  } else if (a.bat || b.bat) {
    // One side carries the bat without a key of its own: blend through the carried key, never a jump.
    const ka = a.bat ?? CARRY_BAT_KEY;
    const kb = b.bat ?? CARRY_BAT_KEY;
    a.bat = { grip: lerp3(ka.grip, kb.grip, w), dir: slerpDir(ka.dir, kb.dir, w) };
  }
  const ha = a.topHand ?? (a.bat ? (a.twoHands ? 1 : 0) : 0);
  const hb = b.topHand ?? (b.bat ? (b.twoHands ? 1 : 0) : 0);
  a.topHand = ha + (hb - ha) * w;
  a.twoHands = w < 0.5 ? a.twoHands : b.twoHands;
}

/** Where a partly weighted aim keeps its weight (a property of the aim itself, so a pose that copies or swaps its aims takes it along). */
const AIM_WEIGHT = Symbol('aimWeight');

/** How much of an arm aim is in force: 1 unless a cross-fade holds it back. */
export function aimWeight(aim: readonly [number, number]): number {
  return (aim as { [AIM_WEIGHT]?: number })[AIM_WEIGHT] ?? 1;
}

/** An aim at a weight; a whole one is the plain pair every clip's own aims are. */
function aimOf(phi: number, lateral: number, weight: number): [number, number] {
  const a: [number, number] = [phi, lateral];
  if (weight < 1) (a as { [AIM_WEIGHT]?: number })[AIM_WEIGHT] = weight < 0 ? 0 : weight;
  return a;
}

/**
 * The aim between two keys (or two poses) at share `u`. Both aim: the angle goes the short way round (a key at 20 after one at 330 is
 * 50 degrees on, not 310 back through straight up), and the weight between theirs. One aims: the aim is in force at its share, so the
 * arm leaves (or comes to) the clip's own pose with it instead of being on the aim from the first frame of the segment.
 */
function keyAim(a: [number, number] | null, b: [number, number] | null, u: number): [number, number] | null {
  if (a && b) {
    let d = (b[0] - a[0]) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    const wa = aimWeight(a);
    const wb = aimWeight(b);
    return aimOf(a[0] + d * u, a[1] + (b[1] - a[1]) * u, wa + (wb - wa) * u);
  }
  if (b) return aimOf(b[0], b[1], aimWeight(b) * u);
  if (a) return aimOf(a[0], a[1], aimWeight(a) * (1 - u));
  return null;
}

/**
 * Blends two poses' aims by `w` (0 = a, 1 = b) the way every actor but the bowler is drawn: a clip that aims an arm against one that does
 * not switches the whole aim at the half-way frame.
 */
function blendAim(a: [number, number] | null, b: [number, number] | null, w: number): [number, number] | null {
  if (a && b) {
    let d = (b[0] - a[0]) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return [a[0] + d * w, a[1] + (b[1] - a[1]) * w];
  }
  return w >= 0.5 ? b : a;
}

let weightedAims = false;
/**
 * Turns the weighted, short-way arm aims (`keyAim`) on or off for the poses sampled from now on; returns what it was. The stage has
 * them on for the bowler only, whose built-in fielding and celebration clips they were made for (a throw's front arm swung through
 * straight up, a cross-fade to a clip that does not aim an arm put the arm down in one frame); the keeper and the fielders, whose
 * arms the same clips draw, are left as they were until they are looked at.
 */
export function setWeightedAims(on: boolean): boolean {
  const was = weightedAims;
  weightedAims = on;
  return was;
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
  if (pose.bat) {
    const f = pose.bat.face;
    pose.bat = {
      grip: [-pose.bat.grip[0], pose.bat.grip[1], pose.bat.grip[2]],
      dir: [-pose.bat.dir[0], pose.bat.dir[1], pose.bat.dir[2]],
      ...(f ? { face: [-f[0], f[1], f[2]] as [number, number, number] } : {}),
    };
  }
  return pose;
}

const offQ: Quat = [0, 0, 0, 1];
const idQ: Quat = [0, 0, 0, 1];
const tmpQ4 = new Float32Array(4);

/**
 * Adds a local rotation (Euler degrees, XYZ) to one bone of a sampled pose, scaled by `weight` (0..1): the bowler's
 * release cues. The bone's rotation becomes q · slerp(identity, offset, weight).
 */
export function addBoneRotation(
  pose: SampledPose,
  bone: BoneName,
  euler: readonly [number, number, number],
  weight: number,
): void {
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
const LEG_MASK = ['hips', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'] as const;
/** TRACKB's stroke overlays (pack batter_strokes; SOURCE.md): hips, spine, chest, neck, head and both legs. */
const BODY_MASK = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'thighL',
  'shinL',
  'footL',
  'thighR',
  'shinR',
  'footR',
] as const;
/** Lower-layer clips that carry the trunk and head as well as the legs (the arms stay on the base clip). */
const BODY_OVERLAYS: ReadonlySet<string> = new Set([
  'vmp:bat_drive',
  'vmp:bat_fwd_defence',
  'vmp:bat_backfoot_punch',
  'vmp:bat_pull',
  'vmp:bat_back_defence',
  'vmp:bat_leave',
]);

export function overlayLower(dst: SampledPose, src: SampledPose, w = 1, body = false): void {
  for (const name of body ? BODY_MASK : LEG_MASK) {
    const i = BONE_INDEX[name];
    quatSlerp(dst.q.subarray(i * 4, i * 4 + 4), src.q.subarray(i * 4, i * 4 + 4), w, dst.q, i * 4);
  }
  dst.root = lerp3(dst.root, src.root, w);
}

export const ALL_CLIPS = Object.keys(CLIPS) as BuiltinClipId[];

/** The clip state an actor shows (structurally `ClipState` / `ActorState` from actors.ts). */
interface PresentedClip {
  clip: ClipId;
  time: number;
  lower?: ClipId;
  lowerTime?: number;
}
interface PresentedState {
  current: PresentedClip;
  previous: PresentedClip | null;
  weight: number;
  stack?: ReadonlyArray<{ clip: PresentedClip; weight: number }>;
  inertia?: {
    from: ReadonlyArray<{ clip: PresentedClip; weight: number }>;
    fromBefore: ReadonlyArray<{ clip: PresentedClip; weight: number }>;
    to: PresentedClip;
    toBefore: PresentedClip;
    tau: number;
    ms: number;
  };
}

let inertiaScratch: SampledPose[] | null = null;

function sampleStack(
  stack: ReadonlyArray<{ clip: PresentedClip; weight: number }>,
  out: SampledPose,
  tmp: SampledPose,
  lower: SampledPose,
): SampledPose {
  sampleLayer(stack[0].clip, out, lower);
  for (let k = 1; k < stack.length; k++) {
    sampleLayer(stack[k].clip, tmp, lower);
    blendPose(out, tmp, stack[k].weight);
  }
  return out;
}

/** q = a · b⁻¹ as a rotation vector (axis × angle), into r at offset o. */
function logDelta(a: Float32Array, b: Float32Array, i: number, r: Float64Array, o: number) {
  const ax = a[i],
    ay = a[i + 1],
    az = a[i + 2],
    aw = a[i + 3];
  const bx = -b[i],
    by = -b[i + 1],
    bz = -b[i + 2],
    bw = b[i + 3];
  let x = aw * bx + ax * bw + ay * bz - az * by;
  let y = aw * by - ax * bz + ay * bw + az * bx;
  let z = aw * bz + ax * by - ay * bx + az * bw;
  let w = aw * bw - ax * bx - ay * by - az * bz;
  if (w < 0) {
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }
  const s = Math.hypot(x, y, z);
  const ang = 2 * Math.atan2(s, w);
  const k = s > 1e-9 ? ang / s : 2;
  r[o] = x * k;
  r[o + 1] = y * k;
  r[o + 2] = z * k;
}

/**
 * Inertialization (Move.inertial): the difference between what was presented at the switch and the new clip there,
 * with its velocity, decays by a critically damped curve x(τ) = (x0 + (v0 + ω x0) τ) e^(−ωτ) over the window, applied
 * on top of the new clip (rotations as rotation vectors, the root offset as a vector). Pure in the state.
 */
function applyInertia(st: NonNullable<PresentedState['inertia']>, out: SampledPose, lower: SampledPose) {
  const sc = (inertiaScratch ??= [createPose(), createPose(), createPose(), createPose(), createPose()]);
  const a0 = sampleStack(st.from, sc[0], sc[4], lower);
  const a1 = sampleStack(st.fromBefore, sc[1], sc[4], lower);
  const b0 = sampleLayer(st.to, sc[2], lower);
  const b1 = sampleLayer(st.toBefore, sc[3], lower);
  const dt = 1 / 60;
  const tau = st.tau / 1000;
  const omega = 6.6 / (st.ms / 1000);
  const e = Math.exp(-omega * tau);
  const r0 = new Float64Array(3);
  const r1 = new Float64Array(3);
  for (let i = 0; i < NB * 4; i += 4) {
    logDelta(a0.q, b0.q, i, r0, 0);
    logDelta(a1.q, b1.q, i, r1, 0);
    const rx = (r0[0] + ((r0[0] - r1[0]) / dt + omega * r0[0]) * tau) * e;
    const ry = (r0[1] + ((r0[1] - r1[1]) / dt + omega * r0[1]) * tau) * e;
    const rz = (r0[2] + ((r0[2] - r1[2]) / dt + omega * r0[2]) * tau) * e;
    const ang = Math.hypot(rx, ry, rz);
    if (ang < 1e-7) continue;
    const s = Math.sin(ang / 2) / ang;
    const dx = rx * s,
      dy = ry * s,
      dz = rz * s,
      dw = Math.cos(ang / 2);
    const qx = out.q[i],
      qy = out.q[i + 1],
      qz = out.q[i + 2],
      qw = out.q[i + 3];
    out.q[i] = dw * qx + dx * qw + dy * qz - dz * qy;
    out.q[i + 1] = dw * qy - dx * qz + dy * qw + dz * qx;
    out.q[i + 2] = dw * qz + dx * qy - dy * qx + dz * qw;
    out.q[i + 3] = dw * qw - dx * qx - dy * qy - dz * qz;
  }
  const root = [0, 1, 2].map((k) => {
    const x0 = a0.root[k] - b0.root[k];
    const x1 = a1.root[k] - b1.root[k];
    return (x0 + ((x0 - x1) / dt + omega * x0) * tau) * e;
  });
  out.root = [out.root[0] + root[0], out.root[1] + root[1], out.root[2] + root[2]];
  // Into a run the bat key stays the clip's: the external bat hands over to it, and the top hand eases off (players.ts).
  if (st.to.clip !== 'bat_run') inertiaBat(a0, a1, b0, b1, out, tau, omega, dt, e);
}

/** The bat key a pose holds (grip point and blade direction, actor frame), the carried key when it has none. */
const batKey = (p: SampledPose): { grip: readonly number[]; dir: readonly number[] } => p.bat ?? CARRY_BAT_KEY;

/** The rotation vector (axis × angle, actor frame) that turns the blade direction b onto a. Near-opposite turns about x. */
function bladeDelta(a0: readonly number[], b0: readonly number[], r: Float64Array): void {
  const la = Math.hypot(a0[0], a0[1], a0[2]) || 1;
  const lb = Math.hypot(b0[0], b0[1], b0[2]) || 1;
  const a = [a0[0] / la, a0[1] / la, a0[2] / la];
  const b = [b0[0] / lb, b0[1] / lb, b0[2] / lb];
  const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const c = [b[1] * a[2] - b[2] * a[1], b[2] * a[0] - b[0] * a[2], b[0] * a[1] - b[1] * a[0]];
  let sn = Math.hypot(c[0], c[1], c[2]);
  let axis = c;
  if (sn < 0.08 && d < 0) {
    // Nearly opposite (a bat going from toe-up to toe-down): through the actor's sagittal plane, as slerpDir does.
    axis = [1 - b[0] * b[0], -b[0] * b[1], -b[0] * b[2]];
    sn = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  }
  const ang = Math.atan2(Math.hypot(c[0], c[1], c[2]), d);
  const k = sn > 1e-9 ? ang / sn : 0;
  r[0] = axis[0] * k;
  r[1] = axis[1] * k;
  r[2] = axis[2] * k;
}

/**
 * The bat key and the top hand's hold decay with the bones (round 8): the key on screen at the switch minus the new
 * clip's, with its velocity, on the same critically damped curve, so the gloves' targets carry on from where they were
 * instead of jumping to the new clip's key with the first frame (the stroke's end into the rest moved the key 0.8 m in
 * one frame and the arms with it). Without a key on either side nothing is changed.
 */
function inertiaBat(
  a0: SampledPose,
  a1: SampledPose,
  b0: SampledPose,
  b1: SampledPose,
  out: SampledPose,
  tau: number,
  omega: number,
  dt: number,
  e: number,
): void {
  if (!a0.bat && !b0.bat && !out.bat) return;
  const decay = (x0: number, x1: number) => (x0 + ((x0 - x1) / dt + omega * x0) * tau) * e;
  const ka0 = batKey(a0),
    ka1 = batKey(a1),
    kb0 = batKey(b0),
    kb1 = batKey(b1),
    kn = batKey(out);
  const grip: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) grip[k] = kn.grip[k] + decay(ka0.grip[k] - kb0.grip[k], ka1.grip[k] - kb1.grip[k]);
  const r0 = new Float64Array(3);
  const r1 = new Float64Array(3);
  bladeDelta(ka0.dir, kb0.dir, r0);
  bladeDelta(ka1.dir, kb1.dir, r1);
  const rv = [decay(r0[0], r1[0]), decay(r0[1], r1[1]), decay(r0[2], r1[2])];
  const dir = rotateAbout(kn.dir, rv);
  // Round 9: the bat's face (MOTION-SPEC v1.2 bat.face) decays with the blade: it was dropped here, so a bat whose clip carries a face
  // turned about its blade by up to 70° in the first frame of every inertial switch (the leave, the stroke's end) and back in the
  // frame the offset ran out. A face that no clip of the four carries stays undefined, as before (holdBat then gives the hint).
  const authored = Boolean(a0.bat?.face || a1.bat?.face || b0.bat?.face || b1.bat?.face || out.bat?.face);
  let face: [number, number, number] | null = null;
  let rollMoved = 0;
  if (authored) {
    const roll = (da: readonly number[], fa: readonly number[], db: readonly number[], fb: readonly number[]) => {
      const r = new Float64Array(3);
      bladeDelta(da, db, r);
      const f = rotateAbout(fb, [r[0], r[1], r[2]]);
      const l = Math.hypot(da[0], da[1], da[2]) || 1;
      const u = [da[0] / l, da[1] / l, da[2] / l];
      const cx = f[1] * fa[2] - f[2] * fa[1];
      const cy = f[2] * fa[0] - f[0] * fa[2];
      const cz = f[0] * fa[1] - f[1] * fa[0];
      return Math.atan2(cx * u[0] + cy * u[1] + cz * u[2], f[0] * fa[0] + f[1] * fa[1] + f[2] * fa[2]);
    };
    const x0 = roll(ka0.dir, keyFace(ka0), kb0.dir, keyFace(kb0));
    const x1 = roll(ka1.dir, keyFace(ka1), kb1.dir, keyFace(kb1));
    rollMoved = decay(x0, x1);
    const withBlade = rotateAbout(keyFace(kn), rv);
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    face = rotateAbout(withBlade, [(dir[0] / l) * rollMoved, (dir[1] / l) * rollMoved, (dir[2] / l) * rollMoved]);
  }
  const hold = (p: SampledPose) => p.topHand ?? (p.bat ? (p.twoHands ? 1 : 0) : 0);
  const top = hold(out) + decay(hold(a0) - hold(b0), hold(a1) - hold(b1));
  const moved =
    Math.hypot(grip[0] - kn.grip[0], grip[1] - kn.grip[1], grip[2] - kn.grip[2]) +
    Math.hypot(rv[0], rv[1], rv[2]) +
    Math.abs(top - hold(out)) +
    Math.abs(rollMoved);
  // The new clip's key is left as it is once the offset has gone (a clip with no key carries its own: see holdBat).
  if (moved < 1e-3 && !out.bat) return;
  out.bat = { grip, dir, ...(face ? { face } : {}) };
  out.topHand = Math.max(0, Math.min(1, top));
}

/** `v` turned by the rotation vector r (axis × angle), unit length kept. */
function rotateAbout(v: readonly number[], r: readonly number[]): [number, number, number] {
  const ang = Math.hypot(r[0], r[1], r[2]);
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  const u = [v[0] / l, v[1] / l, v[2] / l];
  if (ang < 1e-9) return [u[0], u[1], u[2]];
  const k = [r[0] / ang, r[1] / ang, r[2] / ang];
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const kd = k[0] * u[0] + k[1] * u[1] + k[2] * u[2];
  return [
    u[0] * c + (k[1] * u[2] - k[2] * u[1]) * s + k[0] * kd * (1 - c),
    u[1] * c + (k[2] * u[0] - k[0] * u[2]) * s + k[1] * kd * (1 - c),
    u[2] * c + (k[0] * u[1] - k[1] * u[0]) * s + k[2] * kd * (1 - c),
  ];
}

function sampleLayer(c: PresentedClip, out: SampledPose, lower: SampledPose): SampledPose {
  sampleClip(c.clip, c.time, out);
  if (c.lower) overlayLower(out, sampleClip(c.lower, c.lowerTime ?? 0, lower), 1, BODY_OVERLAYS.has(c.lower));
  return out;
}

function copyPose(src: SampledPose, dst: SampledPose) {
  dst.q.set(src.q);
  dst.root = [src.root[0], src.root[1], src.root[2]];
  dst.aimR = src.aimR;
  dst.aimL = src.aimL;
  dst.bat = src.bat;
  dst.twoHands = src.twoHands;
  dst.topHand = src.topHand;
}

/**
 * The pose an actor presents at its evaluated state, into `out`: the current clip (with its footwork layer), crossfaded
 * from the pose actually on screen when it began. A move that starts while an earlier crossfade is still running
 * blends from that blended pose (`stack`), never from the bare previous clip, so nothing pops.
 */
export function samplePresented(
  st: PresentedState,
  out: SampledPose,
  scratch: SampledPose,
  lower: SampledPose,
): SampledPose {
  if (st.inertia) {
    sampleLayer(st.current, out, lower);
    applyInertia(st.inertia, out, lower);
    return out;
  }
  if (st.stack && st.stack.length > 1) {
    sampleLayer(st.stack[0].clip, scratch, lower);
    for (let k = 1; k < st.stack.length; k++) {
      sampleLayer(st.stack[k].clip, out, lower);
      blendPose(scratch, out, st.stack[k].weight);
    }
    copyPose(scratch, out);
    return out;
  }
  sampleLayer(st.current, out, lower);
  if (st.previous && st.weight < 1) {
    sampleLayer(st.previous, scratch, lower);
    blendPose(scratch, out, st.weight);
    copyPose(scratch, out);
  }
  return out;
}
