/**
 * A deterministic corpus of drawn-bat evaluations, hashed (SHA-256 over the little-endian float64 bytes of every
 * grip, toe and face), to prove that a performance-only change leaves the presented bat bit for bit as it was.
 *
 * `bat-exact.test.ts` compares the hashes with `tests/fixtures/bat-exact/golden.json`, which was written by this same
 * corpus on the code BEFORE the 2026-11-07 FEEL-1 changes (build 4a376ae+e5dba9cdf3db: lazy touch-down drawing in
 * `withTouch`, the hoisted guard, the shared prepared bat track). A hash that differs means a drawn bat moved.
 *
 * Covered: the uncommitted touch-down stroke (the clearance guard active and not), presses before and after the ideal
 * contact, both hands, pace and spin, a left-arm bowler; then the committed tap with its physics result, in the three
 * drawings the stage uses (presented, first person, external views), from 40 ms before the press to 700 ms after the
 * contact. No wall-clock or random input.
 *
 * Two hashes per group go in the golden file, because they depend on the physics (frozen), the script's bat track and
 * bat.ts only: `touch` and `committed` (the presented and first-person bat). The external views also depend on the
 * striker's body track (clips, humans, locomotion: other owners' code, which keeps changing), so they are not pinned
 * to a hash; `external` instead holds the same poses worked out with and without `externalBatPose`'s memo (a copy of the
 * striker track misses it), and the two must agree.
 */
import { createHash } from 'node:crypto';
import type { BatSample, BowlerProfile, NormalizedSwing } from '@/contracts/practice';
import { TAP_HOLD_MS } from '@/input';
import { autoField, batTravelMs, flight, resolveDelivery } from '@/physics';
import { externalBatPose, firstPersonBatPose, presentedBatPose, type BatTrack } from '@/render3d/practice/bat';
import { simToScene } from '@/render3d/practice/frame';
import { buildPracticeScript } from '@/render3d/practice/script';

const PACE: BowlerProfile = { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'exact-pace' };
const SPIN: BowlerProfile = { family: 'spin', spinType: 'finger', arm: 'right', lookSeed: 'exact-spin' };
const LEFT: BowlerProfile = { family: 'pace', paceBand: 'express', arm: 'left', lookSeed: 'exact-left' };

interface Pose {
  grip: { x: number; y: number; z: number };
  toe: { x: number; y: number; z: number };
  face: { x: number; y: number; z: number };
}

class PoseHash {
  private readonly hash = createHash('sha256');
  private readonly buffer = new Float64Array(9);
  count = 0;
  add(pose: Pose | null): void {
    const b = this.buffer;
    if (!pose) b.fill(Number.NaN);
    else {
      b[0] = pose.grip.x;
      b[1] = pose.grip.y;
      b[2] = pose.grip.z;
      b[3] = pose.toe.x;
      b[4] = pose.toe.y;
      b[5] = pose.toe.z;
      b[6] = pose.face.x;
      b[7] = pose.face.y;
      b[8] = pose.face.z;
    }
    this.hash.update(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
    this.count++;
  }
  digest(): string {
    return this.hash.digest('hex');
  }
}

export interface BatCorpusResult {
  /** SHA-256 per group and part (`hand:bowler:touch|committed`); a group is one hand and bowler. */
  groups: Record<string, string>;
  /** The external views per group: with `externalBatPose`'s memo (the striker track as given) and without it (a copy). */
  external: Record<string, { memo: string; fresh: string }>;
  /** Pose evaluations hashed, over all groups. */
  evaluations: number;
}

const setupOf = (bowler: BowlerProfile, hand: 'right' | 'left') => ({
  field: autoField(bowler, 'balanced', hand),
  bowler,
  conditions: 'balanced' as const,
  handedness: hand,
});

/** `thaw`: draw from a structured-clone copy of each physics bat trace, as it arrives from the physics worker. */
export function runBatCorpus(options: { thaw?: boolean } = {}): BatCorpusResult {
  const groups: Record<string, string> = {};
  const external: Record<string, { memo: string; fresh: string }> = {};
  let evaluations = 0;
  for (const hand of ['right', 'left'] as const) {
    for (const bowler of [PACE, SPIN, LEFT]) {
      const hash = new PoseHash();
      const committedHash = new PoseHash();
      const externalHash = new PoseHash();
      const freshHash = new PoseHash();
      for (const lengthM of [2, 5, 8, 11]) {
        const speedKph = bowler.family === 'spin' ? 86 : lengthM >= 8 ? 120 : 145;
        for (const lineM of [-0.5, 0.6]) {
          const setup = setupOf(bowler, hand);
          const fl = flight({
            plan: { variation: 'stock', lengthM, lineM, speedKph },
            bowler,
            conditions: 'balanced',
            seed: `exact:${hand}:${bowler.lookSeed}:${lengthM}:${lineM}`,
            handedness: hand,
          });
          const pre = buildPracticeScript({ setup, flight: fl });
          const base = pre.practice!.bat;
          const ideal = simToScene(base, fl.idealContactT);
          // 1. The uncommitted touch-down stroke: the press before and after the ideal contact, the guard working.
          for (const e of [-450, -300, -180, -90, 0, 120]) {
            const press = ideal + e;
            const track: BatTrack = {
              ...base,
              touch: { start: press, end: press + TAP_HOLD_MS, commitAt: null, state: null, ball: fl.samples },
            };
            for (let s = press - 20; s <= press + 520; s += 8) {
              hash.add(firstPersonBatPose(track, s));
              hash.add(presentedBatPose(track, s));
            }
          }
          // 2. The committed tap and its physics result, in the three drawings of the stage.
          for (const [errMs, holdMs] of [
            [-40, 24],
            [0, 70],
            [25, 130],
          ] as const) {
            const startT = fl.idealContactT - batTravelMs('defend', 0.2) / 1000 + errMs / 1000;
            const swing: NormalizedSwing = {
              kind: 'defend',
              startT,
              directionDeg: 0,
              power: 0.2,
              elevation: 0,
              footwork: 'auto',
            };
            const result = resolveDelivery({
              flight: fl,
              swing,
              field: setup.field,
              bowler,
              conditions: 'balanced',
              handedness: hand,
              assist: 'real',
              tierToleranceMs: 0,
            });
            const shown = options.thaw ? { ...result, bat: structuredClone(result.bat) as BatSample[] } : result;
            const press = simToScene(base, startT);
            const lift = press + holdMs;
            const resultAt = lift + 8;
            const live = buildPracticeScript({ setup, flight: fl, result: shown, provisionalStart: press, resultAt });
            const striker = live.actors.find((a) => a.id === 'striker')!;
            const touch = { start: press, end: press + TAP_HOLD_MS, commitAt: lift, state: null, ball: fl.samples };
            const bat: BatTrack = { ...live.practice!.bat, touch };
            const preCommit: BatTrack = { ...base, touch: { ...touch, commitAt: null } };
            const end = (live.practice!.bat.contactScene ?? live.practice!.bat.velocityPeakScene ?? press + 300) + 700;
            for (let s = press - 40; s <= end; s += 10) {
              const track =
                s < resultAt ? (s < lift ? preCommit : { ...preCommit, provisionalStart: press, touch }) : bat;
              committedHash.add(firstPersonBatPose(track, s));
              committedHash.add(presentedBatPose(track, s));
              externalHash.add(externalBatPose(track, striker, s, 1));
              freshHash.add(externalBatPose(track, { ...striker }, s, 1));
            }
            // A replay: the result alone, no touch (the swing becomes visible at the result's own swing start).
            const replay = buildPracticeScript({ setup, flight: fl, result: shown });
            const replayStriker = replay.actors.find((a) => a.id === 'striker')!;
            for (let s = press - 40; s <= end; s += 10) {
              externalHash.add(externalBatPose(replay.practice!.bat, replayStriker, s, 1));
              freshHash.add(externalBatPose(replay.practice!.bat, { ...replayStriker }, s, 1));
            }
          }
        }
      }
      evaluations += hash.count + committedHash.count;
      groups[`${hand}:${bowler.lookSeed}:touch`] = hash.digest();
      groups[`${hand}:${bowler.lookSeed}:committed`] = committedHash.digest();
      external[`${hand}:${bowler.lookSeed}`] = { memo: externalHash.digest(), fresh: freshHash.digest() };
    }
  }
  return { groups, external, evaluations };
}
