/**
 * WEB-FIX-A2 (2026-11-07): the striker's bat in the external views settles into the body's clip over a hand-over, and the
 * gloves follow it all the way. Two things were wrong with it, both builder-measured on the 192 deliveries of WEB-HUMANS' corpus
 * (4 overs x 3 balls x 2 hands x 8 intents) and WEB-FIX-A's 240-delivery sweep (4 bowlers, 5 lengths, both hands, 6 intents):
 *
 *  1. The hand-over was 320 ms, and a quick sweep from the finish to the rest drags each arm along the edge of its joint windows
 *     (upper-arm twist, wrist swing): it leaves the window in one frame. Elbow flips (an elbow moving 10 cm more than its hand in
 *     a frame) in the 192 deliveries: 176 at 320 ms, 110 at 480, 69 at 560, 49 at 640, 36 at 720, 36 at 800; of the 36 at 720,
 *     4 are in the hold and hand-over of a standing batter (144 of the 176 were). So a standing batter's bat is now held 350 ms
 *     after its last sample and handed over in 720 ms (settled 1,070 ms after the last sample), and a batter who sets off running
 *     keeps 320 ms: with the long one his bat lagged 28-30 mm off the glove in one run (the body leaves it behind), with 320 ms 1 mm.
 *  2. `rigidBatBlend` slerps the bat's orientation and takes the nearer of two ways round by the sign of one dot product. Where the
 *     held bat is a half turn from the clip's (the bat lifted high at the finish, lowered to the rest: 7 of 432 deliveries at 320 ms,
 *     19 at 720 ms) the clip's own move takes that product across zero in mid-blend and the blade jumped 39-138° in one frame. The
 *     hand-over now fixes the way round once (bat.ts `handOverBlend`: the clip's orientation half way through decides it) and every
 *     frame follows the same way: the largest blade turn in a frame of a hand-over is 14-19° (the swing's own moves).
 *
 * `rigidBatBlend` itself is untouched (bat-exact.test.ts pins it); the hand-over is a presentation behaviour, never physics: the
 * bat is the physics bat until its last sample and for BAT_HOLD_MS after it.
 */
import { describe, expect, it } from 'vitest';
import {
  BACKLIFT,
  BAT_HOLD_MS,
  BAT_RELEASE_MS,
  BAT_RUN_RELEASE_MS,
  LEAVE_HOLD_MS,
  clipBatPose,
  externalBatPose,
  presentedBatPose,
  rigidBatBlend,
} from '@/render3d/practice/bat';
import type { BatPose } from '@/render3d/practice/frame';
import { FRAME_MS, deadBallJobs, overJobs, withPacks, type Job } from './batterArmsCorpus';

interface Timing {
  job: Job;
  /** The scene ms the hand-over starts, how long it takes, and whether the batter sets off running before it would be over. */
  handOver: number;
  release: number;
  runs: boolean;
}

/** The hand-over as the documentation states it (BAT_HOLD_MS, BAT_RELEASE_MS, BAT_RUN_RELEASE_MS, LEAVE_HOLD_MS), or null for a swing without a trace. */
function timingOf(job: Job): Timing | null {
  const p = job.script.practice!;
  const striker = job.script.actors.find((a) => a.id === 'striker')!;
  const last = p.bat.samples?.at(-1);
  if (!last) {
    if (
      p.bat.delivery === false ||
      (p.bat.samples !== null && p.bat.samples.length > 0) ||
      p.bat.provisionalStart !== null
    )
      return null;
    return { job, handOver: p.bat.releaseScene + BACKLIFT.toMs + LEAVE_HOLD_MS, release: BAT_RELEASE_MS, runs: false };
  }
  const lastScene = p.bat.releaseScene + last.t * 1000;
  const sets =
    striker.moves.find(
      (m) => m.t1 > lastScene && (m.clip === 'bat_run' || String(m.lower ?? '').startsWith('vmp:loco_')),
    )?.t0 ?? Number.POSITIVE_INFINITY;
  const handOver = Math.min(lastScene + BAT_HOLD_MS, Math.max(lastScene, sets));
  const release = Math.max(BAT_RUN_RELEASE_MS, Math.min(BAT_RELEASE_MS, sets - handOver));
  return { job, handOver, release, runs: release < BAT_RELEASE_MS };
}

const bladeOf = (p: BatPose) => {
  const x = p.toe.x - p.grip.x;
  const y = p.toe.y - p.grip.y;
  const z = p.toe.z - p.grip.z;
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l] as const;
};
const bladeTurn = (a: BatPose, b: BatPose) => {
  const [ax, ay, az] = bladeOf(a);
  const [bx, by, bz] = bladeOf(b);
  return (Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz))) * 180) / Math.PI;
};
const capStep = (a: BatPose, b: BatPose) => Math.hypot(a.grip.x - b.grip.x, a.grip.y - b.grip.y, a.grip.z - b.grip.z);

/** The deliveries every test below walks: the 192 of WEB-HUMANS' corpus and the 128 that end early or miss (spin and pace, both hands). */
const corpus = (): Job[] => [...overJobs(4), ...deadBallJobs()];

describe("the striker's bat in the external views: the hand-over to the body's clip", () => {
  it("turns the blade no more than 25° between two frames of a hand-over (it jumped 39-138° in 19 of 432 deliveries when the held bat was a half turn from the clip's)", async () => {
    await withPacks(() => {
      const offenders: string[] = [];
      let walked = 0;
      let frames = 0;
      let blade = 0;
      let step = 0;
      for (const job of corpus()) {
        const tm = timingOf(job);
        if (!tm) continue;
        const p = job.script.practice!;
        const striker = job.script.actors.find((a) => a.id === 'striker')!;
        walked++;
        let prev: BatPose | null = null;
        for (let t = tm.handOver; t < tm.handOver + tm.release; t += FRAME_MS) {
          const now = externalBatPose(p.bat, striker, t, 1);
          if (prev && now) {
            frames++;
            const turn = bladeTurn(prev, now);
            blade = Math.max(blade, turn);
            step = Math.max(step, capStep(prev, now));
            if (turn > 25)
              offenders.push(`${job.key} at release+${(t - p.releaseScene).toFixed(0)} ms: ${turn.toFixed(0)}°`);
          }
          prev = now;
        }
      }
      expect(walked, 'deliveries with a hand-over').toBeGreaterThan(280);
      expect(frames, 'frames of hand-overs').toBeGreaterThan(9000);
      expect(
        offenders,
        `blade turns over 25° in a frame (the worst case measured after the fix: ${blade.toFixed(1)}°)`,
      ).toEqual([]);
      expect(blade, 'the largest blade turn in a frame of a hand-over (deg)').toBeLessThan(20);
      expect(step * 100, "the bat's largest step in a frame of a hand-over (cm; the gate is 10)").toBeLessThan(10);
    });
  }, 120_000);

  it('settles BAT_HOLD_MS + BAT_RELEASE_MS (1,070 ms) after the last sample for a standing batter, and within BAT_RUN_RELEASE_MS of setting off for a runner', async () => {
    await withPacks(() => {
      let stays = 0;
      let runs = 0;
      let leaves = 0;
      for (const job of corpus()) {
        const tm = timingOf(job);
        if (!tm) continue;
        const p = job.script.practice!;
        const striker = job.script.actors.find((a) => a.id === 'striker')!;
        expect(
          externalBatPose(p.bat, striker, tm.handOver + tm.release - 1, 1),
          `${job.key}: still blending 1 ms before the end of the hand-over`,
        ).not.toBeNull();
        expect(
          externalBatPose(p.bat, striker, tm.handOver + tm.release + 1, 1),
          `${job.key}: the clip's own bat 1 ms after the end of the hand-over`,
        ).toBeNull();
        const last = p.bat.samples?.at(-1);
        if (tm.runs) {
          runs++;
          expect(tm.release, `${job.key}: a runner's release`).toBe(BAT_RUN_RELEASE_MS);
        } else if (last) {
          stays++;
          expect(
            tm.handOver + tm.release - (p.bat.releaseScene + last.t * 1000),
            `${job.key}: ms from the physics bat's last sample to the settled bat`,
          ).toBeCloseTo(BAT_HOLD_MS + BAT_RELEASE_MS, 6);
        } else leaves++;
      }
      expect(stays, 'standing batters').toBeGreaterThan(150);
      expect(runs, 'batters who set off running before a standing hand-over would be over').toBeGreaterThan(15);
      expect(leaves, 'leaves').toBeGreaterThan(20);
      expect(
        BAT_HOLD_MS + BAT_RELEASE_MS,
        'the settle time is a presentation choice: it is not to creep towards slow motion',
      ).toBeLessThanOrEqual(1100);
      expect(BAT_RUN_RELEASE_MS, "a runner's hand-over is the quicker one").toBeLessThan(BAT_RELEASE_MS);
    });
  }, 120_000);

  it("is rigidBatBlend, bit for bit, wherever rigidBatBlend's own nearer way never changed (only the half-turn cases differ)", async () => {
    await withPacks(() => {
      let same = 0;
      let flipping = 0;
      let moved = 0;
      for (const job of corpus()) {
        const tm = timingOf(job);
        if (!tm || tm.runs) continue;
        const p = job.script.practice!;
        const striker = job.script.actors.find((a) => a.id === 'striker')!;
        const held = presentedBatPose(p.bat, tm.handOver);
        const old: BatPose[] = [];
        const now: Array<BatPose | null> = [];
        for (let t = tm.handOver + FRAME_MS; t < tm.handOver + tm.release; t += FRAME_MS) {
          const x = (t - tm.handOver) / tm.release;
          const clip = clipBatPose(striker, t, 1)!;
          old.push(rigidBatBlend(held, clip, x * x * (3 - 2 * x)));
          now.push(externalBatPose(p.bat, striker, t, 1));
        }
        let worst = 0;
        for (let k = 1; k < old.length; k++) worst = Math.max(worst, bladeTurn(old[k - 1], old[k]));
        if (worst > 25) {
          flipping++;
          continue;
        }
        same++;
        for (let k = 0; k < old.length; k++) {
          const a = old[k];
          const b = now[k]!;
          for (const c of ['grip', 'toe', 'face'] as const)
            for (const axis of ['x', 'y', 'z'] as const) moved = Math.max(moved, Math.abs(a[c][axis] - b[c][axis]));
        }
      }
      expect(same, 'standing deliveries whose old path never flipped').toBeGreaterThan(200);
      expect(flipping, 'standing deliveries whose old path flipped (the cases the fix is for)').toBeGreaterThan(8);
      expect(
        moved,
        'largest difference of any coordinate between the old and the new path where the old one never flipped (m)',
      ).toBeLessThan(1e-12);
    });
  }, 120_000);

  it("changes no value by remembering the clip's half-way bat: a striker track that misses the memo is given the same bat (frames of different hand-overs interleaved)", async () => {
    await withPacks(() => {
      const jobs = corpus()
        .filter((j) => timingOf(j) && !timingOf(j)!.runs)
        .filter((_, i) => i % 23 === 0);
      expect(jobs.length, 'deliveries compared').toBeGreaterThan(8);
      const at = (j: Job, k: number) => {
        const tm = timingOf(j)!;
        return tm.handOver + ((k + 1) / 8) * tm.release;
      };
      const fresh = (j: Job, k: number) => {
        const p = j.script.practice!;
        const striker = j.script.actors.find((a) => a.id === 'striker')!;
        return externalBatPose(p.bat, { ...striker }, at(j, k), 1);
      };
      // Frames of different hand-overs interleaved: each must equal what a track that misses every memo is given.
      for (let k = 0; k < 7; k++) {
        for (const j of jobs) {
          const p = j.script.practice!;
          const striker = j.script.actors.find((a) => a.id === 'striker')!;
          expect(externalBatPose(p.bat, striker, at(j, k), 1), `${j.key} at step ${k}`).toEqual(fresh(j, k));
        }
      }
    });
  }, 120_000);
});
