/**
 * IDLE-ARMS (the motion reel v2, 2026-11-07): the batter standing between balls turned his arms 14.6 deg/s per bone (reel clip
 * 03c, 12 s; 8.6 in reel v1), and 40% of it (6 deg/s) was not the body following its own breath and sway but a ripple of the top arm.
 *
 * Why (node pose harness, the stage's real path between balls, then the solver's own values frame by frame): the top glove of
 * a batter's stance has the upper arm's twist 6° from the edge of its range (99° of 105°), less than the CLEAR_AIM_DEG (10°) the
 * arms keep, so `players.seekClearance` searches that arm again on every frame he stands, from the plane the elbow was left in,
 * brought 3° back towards the pole's by ELBOW_HOME_DEG_PER_S, and puts it where the clearance reaches 10°. The search was a
 * golden section of 6 steps (two scores each) on a 15° bracket, good to ±0.4°: the plane it landed on wandered by that much from
 * one frame to the next, in a cycle of six frames, and the upper arm and the glove followed, 0.4° and 0.7° a frame, both ways:
 * 83% of the added power above 5 Hz, a step a frame, so the ripple grew with the frame rate (23.4 deg/s on a 120 Hz screen).
 * Found to 0.01° (10 more steps, a new score for each) for a pick that stays (no roll move, the plane within 10° of where the
 * memory has it), the same plane is picked every frame he stands still. Every other pick keeps the 6 steps: how a window is left
 * is pinned frame by frame by batter-glove-flip.test.ts and dead-ball-handover.test.ts (a fine search for those too took the
 * left-hander's bowled ball out of its closing twist window in one frame, 61° of the top hand, instead of in three, 37°, 30° and 9°).
 *
 * The tests pose the real `StageScene` with the Director's life, the batters' hook and the external bat, exactly as the stage draws
 * the scene between balls (no WebGL), and measure the drawn arm bones over 3–15 s. Builder-measured on this machine, not
 * evaluator-verified; no human has judged the motion. The numbers the bounds were set from are in the comments.
 */
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import type { BowlerProfile, Handedness } from '@/contracts/practice';
import { autoField } from '@/physics';
import { DirectorRuntime } from '@/render3d/core/motion/director';
import { BONE_NAMES } from '@/render3d/core/skeleton';
import { externalBatPose } from '@/render3d/practice/bat';
import { buildPracticeScript } from '@/render3d/practice/script';
import { ThreePracticeStage, measureReleaseBall } from '@/render3d/three/ThreePracticeStage';
import { KITS_BOTH, stubStage, withPacks } from './batterArmsCorpus';

const ARM_BONES = ['upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR'] as const;
type ArmBone = (typeof ARM_BONES)[number];

/** The drawn arm bones of the striker standing between balls: [frame][bone] local rotations, from `fromS` to `toS` seconds of the scene. */
function standingArms(
  bowler: BowlerProfile,
  hand: Handedness,
  fps: number,
  fromS: number,
  toS: number,
): Quaternion[][] {
  const field = autoField(bowler, 'balanced', hand);
  const setup = { field, bowler, conditions: 'balanced' as const, handedness: hand };
  const script = buildPracticeScript({
    setup,
    flight: null,
    releaseHand: measureReleaseBall(stubStage(), bowler, KITS_BOTH) as never,
  });
  // The Director's scene between balls (ThreePracticeStage.setScene registers it as 'idle'), its plans whole.
  const director = new DirectorRuntime();
  director.register(script, 'idle', null);
  director.finish(script);
  const proto = ThreePracticeStage.prototype as unknown as {
    poseHooks(s: unknown, p: unknown): never;
    cueHook: unknown;
  };
  const hook = proto.poseHooks.call(
    { hookCache: new WeakMap(), reducedMotion: false, cueHook: proto.cueHook, director },
    script,
    script.practice!,
  );
  const striker = script.actors.find((a) => a.id === 'striker')!;
  const hidden = new Set(script.actors.filter((a) => a.id !== 'striker').map((a) => a.id));
  const cam = { pos: { x: 0, y: 1.7, z: 12 }, target: { x: 0, y: 1, z: 0 }, fov: 30 } as never;
  const stage = stubStage();
  const index = ARM_BONES.map((b) => BONE_NAMES.indexOf(b));
  const out: Quaternion[][] = [];
  const dt = 1000 / fps;
  for (let k = 0; k * dt <= toS * 1000 + 1e-6; k++) {
    const t = k * dt;
    const bat = externalBatPose(script.practice!.bat, striker, t, stage.rigOf('striker')?.scale ?? 1);
    stage.drawScript(script, t, cam, {
      kits: KITS_BOTH,
      slow: false,
      clockMs: t,
      reducedMotion: false,
      hidden,
      bat: bat ? { actor: 'striker', pose: bat } : null,
      poseHook: hook,
    });
    if (t < fromS * 1000 - 1e-6) continue;
    const rig = stage.rigOf('striker')!;
    out.push(index.map((i) => rig.bones[i].quaternion.clone()));
  }
  return out;
}

const DEG = 180 / Math.PI;

/** The mean rotation of the six arm bones (deg/s per bone): the sum of their one-frame turns over the time. */
function meanRate(frames: Quaternion[][], fps: number): number {
  let sum = 0;
  for (let k = 1; k < frames.length; k++)
    for (let b = 0; b < ARM_BONES.length; b++)
      sum += 2 * Math.acos(Math.min(1, Math.abs(frames[k - 1][b].dot(frames[k][b])))) * DEG;
  return (sum / (frames.length - 1) / ARM_BONES.length) * fps;
}

/** The rotation vector (deg) of `q` about `about`, the shortest way. */
function rotationAbout(about: Quaternion, q: Quaternion): Vector3 {
  const r = about.clone().invert().multiply(q);
  if (r.w < 0) r.set(-r.x, -r.y, -r.z, -r.w);
  const s = Math.hypot(r.x, r.y, r.z);
  const angle = 2 * Math.atan2(s, r.w) * DEG;
  return s < 1e-12 ? new Vector3() : new Vector3(r.x, r.y, r.z).multiplyScalar(angle / s);
}

/**
 * How much one bone's turn changes from one frame to the next: the mean of |r[k+1] - 2 r[k] + r[k-1]| (deg per frame²) over its
 * rotation vector. A bone that is steady, or follows a slow breath and sway, has next to none; a ripple (a step a frame, then
 * back) has twice its step.
 */
function turnChange(frames: Quaternion[][], bone: ArmBone): number {
  const b = ARM_BONES.indexOf(bone);
  const mid = frames[frames.length >> 1][b];
  const r = frames.map((f) => rotationAbout(mid, f[b]));
  let sum = 0;
  for (let k = 1; k < r.length - 1; k++)
    sum += r[k + 1]
      .clone()
      .sub(r[k].clone().multiplyScalar(2))
      .add(r[k - 1])
      .length();
  return sum / (r.length - 2);
}

/** The arm of the top hand (the left of a right-hander, the right of a left-hander). */
const topArm = (hand: Handedness): { upper: ArmBone; hand: ArmBone } =>
  hand === 'right' ? { upper: 'upperArmL', hand: 'handL' } : { upper: 'upperArmR', hand: 'handR' };

const PACE: BowlerProfile = { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'idle-arms-a' };
const SPIN: BowlerProfile = { family: 'spin', spinType: 'finger', arm: 'right', lookSeed: 'idle-arms-f' };
/** Four scenes between balls: a pace and a spin bowler's, a right- and a left-handed striker (the Director's draws differ with the bowler's look seed). */
const SCENES: Array<[string, BowlerProfile, Handedness]> = [
  ['pace, right-hander', PACE, 'right'],
  ['pace, left-hander', { ...PACE, lookSeed: 'idle-arms-e' }, 'left'],
  ['spin, right-hander', SPIN, 'right'],
  ['spin, left-hander', { ...SPIN, lookSeed: 'idle-arms-g' }, 'left'],
];

describe("IDLE-ARMS: the standing batter's arms between balls", () => {
  it('turn no more than 11 deg/s per bone and have no ripple (they rippled: 12.5–15.2 deg/s, the top upper arm 0.44–0.48 and the top glove 1.0–1.2 deg/frame² of change in the turn; fixed: 6.8–9.5, 0.07–0.11, 0.19–0.43)', async () => {
    await withPacks(() => {
      for (const [name, bowler, hand] of SCENES) {
        const frames = standingArms(bowler, hand, 60, 3, 15);
        expect(frames.length, name).toBe(721);
        const top = topArm(hand);
        const rate = meanRate(frames, 60);
        const upper = turnChange(frames, top.upper);
        const glove = turnChange(frames, top.hand);
        // The body's own breath and sway, and the clip's stance: 6.8–9.5 deg/s measured. The ripple took it to 12.5–15.2.
        expect.soft(rate, `${name}: arm rotation ${rate.toFixed(2)} deg/s`).toBeLessThan(11);
        // The top arm is where the clearance search lands every frame. Measured 0.07–0.11 (0.44–0.48 with the 6-step search, 0.21 with 8).
        expect.soft(upper, `${name}: ${top.upper} change of turn ${upper.toFixed(3)} deg/frame²`).toBeLessThan(0.17);
        // Measured 0.19–0.43 (1.0–1.2 before).
        expect.soft(glove, `${name}: ${top.hand} change of turn ${glove.toFixed(3)} deg/frame²`).toBeLessThan(0.6);
      }
    });
  }, 60_000);

  it('turn no faster on a 120 Hz screen than on a 60 Hz one (the ripple was a step a frame: 14.8 deg/s at 60 Hz, 23.4 at 120 Hz; fixed 8.7 and 9.5)', async () => {
    await withPacks(() => {
      const at60 = meanRate(standingArms(PACE, 'right', 60, 3, 15), 60);
      const at120 = meanRate(standingArms(PACE, 'right', 120, 3, 15), 120);
      expect(at120, `60 Hz ${at60.toFixed(2)}, 120 Hz ${at120.toFixed(2)} deg/s`).toBeLessThan(1.3 * at60);
    });
  }, 60_000);
});
