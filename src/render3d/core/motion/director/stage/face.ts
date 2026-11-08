/**
 * The hand-over between the pose hooks and the rig (P2): `StageScene.poseActor` calls `frameBegin` just before an
 * actor's pose hooks and reads `FACE` just after `applyPose`. The hooks cannot return anything (a hook is
 * `(track, pose, t) => void`), and `SampledPose` has no room for a face, so the few numbers the shader needs travel
 * through these two module-level records. One writer and one reader per call, nothing retained between actors: the
 * stage poses one actor at a time and resets `FACE.valid` first, so a rig the Director did not touch never inherits the
 * previous actor's eyes. Nothing here allocates.
 */

/**
 * The actor being posed (set by `frameBegin`): its drawn heading, mirror and rig scale, so the hooks need no
 * `evaluateActor`; and, once the Director's life pass has sampled the plan for it, what the head pass needs after the
 * bat is in the hands (`head.on`): the channels, the plan's Reduced Motion setting, the fade, the role and whether the
 * neck and head brake on arrival (`brake`: the striker always, the bowler from `BRAKE.bowlerAfterMs` after the release).
 */
export const FRAME: {
  seq: number;
  id: string;
  t: number;
  heading: number;
  mirror: boolean;
  scale: number;
  head: {
    on: boolean;
    ch: Float32Array | null;
    rm: boolean;
    w: number;
    bowler: boolean;
    brake: boolean;
    seam: Seam | null;
  };
} = {
  seq: 0,
  id: '',
  t: Number.NaN,
  heading: 0,
  mirror: false,
  scale: 1,
  head: { on: false, ch: null, rm: false, w: 1, bowler: false, brake: false, seam: null },
};

/**
 * The seam between two scripts (P3): a delivery's script begins as a hard cut from the scene before it, whose head the
 * Director had on a ground look or the opponent. The head pass continues from that head and lets it go over the script's
 * first `SEAM.ms`: the pass adds `o * k` (degrees, role frame) to the head's turn, where `o` is the remembered head minus the
 * head the pass finds at the first frame (`pending`), and `k` falls from 1 to 0 (the runtime sets it from the script's time).
 * Live only; a replay is built from the result alone and has none, so a live ball and its replay differ in the first
 * `SEAM.ms` by at most `o`, and not at all after it. Nothing here knows the plan, the ball or the result.
 */
export interface Seam {
  pending: boolean;
  /** The head as drawn on the last frame of the scene before (yaw + left, pitch + down, roll + right, degrees). */
  h0y: number;
  h0p: number;
  h0r: number;
  /** The offset: h0 minus the head of the first frame. */
  oy: number;
  op: number;
  or: number;
  /** The share of the offset still applied (1 at the first frame, 0 from `SEAM.ms`). */
  k: number;
  /** The script time of the first frame, ms. */
  t0: number;
}
export const SEAM = { ms: 400 };

/** The binding's one smoothstep (0 below 0, 1 above 1): the runtime's fades and the head pass's pull. */
export const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** The head each role was last drawn with by the head pass (role frame, degrees): what the next script's first frames continue from. */
export const DRAWN: {
  bowler: { ok: boolean; yaw: number; pitch: number; roll: number };
  striker: { ok: boolean; yaw: number; pitch: number; roll: number };
} = {
  bowler: { ok: false, yaw: 0, pitch: 0, roll: 0 },
  striker: { ok: false, yaw: 0, pitch: 0, roll: 0 },
};

/**
 * When the bowler's neck and head start to brake on arrival: ms after the release (the stage's rate limit, players.ts `limitHead`).
 * The striker's always do. Before it a brake would take the bowler's head off the batter (it counter-rotates a trunk that turns at
 * 500 deg/s), and one that comes on while the head is still fast and near its target steps the speed (probe p4: 0 frames over the
 * change-of-speed cap from 100 ms on, 383 deg/s in one frame at 0 ms). 150 ms is where the life channels leave the bowler as well.
 */
export const BRAKE = { bowlerAfterMs: 150 };

/**
 * What the face shader takes: the lid closure of each eye (0 open .. 1 closed), the iris offset in the rig's bind frame (m), and (P3)
 * the expression mix the five weights make, in the shader's own four numbers (`uExpr`: brow, mouth curve, mouth open, eyes squeezed).
 */
export const FACE = { valid: false, id: '', lidL: -1, lidR: -1, gx: 0, gy: 0, ex: 0, ey: 0, ez: 0, ew: 0 };

export function frameBegin(id: string, t: number, heading: number, mirror: boolean, scale: number): void {
  FRAME.seq++;
  FRAME.id = id;
  FRAME.t = t;
  FRAME.heading = heading;
  FRAME.mirror = mirror;
  FRAME.scale = scale;
  FRAME.head.on = false;
  FACE.valid = false;
}
