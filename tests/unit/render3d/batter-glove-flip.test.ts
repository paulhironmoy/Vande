/**
 * F4 (the motion reel, 2026-11-07): the striker's gloves flipped in one frame. A hand or a forearm turned 90 to 173° between two
 * 60 Hz frames, in the hand-over to the rest 1.4–2.1 s after the release (clip 02c at 2.42, 2.45, 2.50 s), at the contact of the
 * forward defence (4.10 s), and, the most visible, in the standing batter after THE LEAVE (8.05 s), whose top glove changed
 * orientation from frame to frame while he held the bat.
 *
 * Why (found with the drawn bones and the arm solve's own intermediate values, 2026-11-07):
 *  1. `clips.inertiaBat` rebuilt the bat key of every inertial switch as { grip, dir } and DROPPED the clip's `bat.face`
 *     (MOTION-SPEC v1.2), and `clips.blendPose` switched a crossfade between a clip with a face and one without at half-way.
 *     The bat then turned about its own blade by up to 73° in one frame (the leave's switch at the input, again 130 ms later
 *     when the offset ran out), and the gloves, which close round the handle with their back to the face, turned with it.
 *  2. `players.holdBat` ignored the face of the clip's key (always the hint towards the bowler), another 73° when the external bat
 *     handed over to the key.
 *  3. `players.relaxGrip` turned a glove round the handle to the nearer end of the wrist's arc by the SIGN of `want`: where the
 *     forearm lies opposite the glove (`want` near ±180°, the rest pose of both arms) the two ends are equally near and the glove
 *     turned 120° in one frame as `want` crossed the sign, and the arm after it; the wrist-only passes did it again. And
 *     `reachIK` searched the elbow's plane for a turn inside the two ranges 5° at a time up to ±180° and leapt to the other
 *     window (145° of forearm) when the turn in use was a hair outside them.
 * The fix keeps the face through every switch (clips.ts, players.holdBat), makes the glove's roll a state that drifts and is held
 * inside the wrist's arc on the circle, and keeps the arms clear of the edges of their ranges so they have no reason to leave
 * the window they are in (players.seekClearance). Builder-measured, not evaluator-verified; no human has judged it.
 *
 * What is still open, stated by the tests below as ceilings, not as zeros: in the hand-over to the rest the (elbow, glove-roll)
 * pairs that keep both ranges and the hand on the handle split into windows and one can vanish; without a look ahead the arm is
 * then left in the one that closed and takes the other in one frame (a forearm turn of 100–130° in a few frames of a few
 * deliveries). docs/PRACTICE_PRESENTATION.md, "The arms and the first steps of a run".
 */
import { describe, expect, it } from 'vitest';
import type { Quaternion } from 'three';
import { blendPose, createPose } from '@/render3d/core/clips';
import { externalBatPose } from '@/render3d/practice/bat';
import { FRAME_MS, KITS_BOTH, armPops, overJobs, reelJobs, stageHook, stubStage, turnBetween, walkStriker, withPacks, type Frame, type Walk } from './batterArmsCorpus';

/** The angle between two unit vectors (deg). */
const between = (a: { dot(b: never): number }, b: unknown) => (Math.acos(Math.max(-1, Math.min(1, a.dot(b as never)))) * 180) / Math.PI;
const dirOf = (f: Frame) => f.toe.clone().sub(f.cap).normalize();

/** The top glove's largest one-frame turn of its world rotation while he holds the bat (before the input, after the stroke). */
function holdingGloveTurns(w: Walk, fromRel: number, deg: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const strokeEnd = w.input + 800 - w.release;
  for (let k = 1; k < w.frames.length; k++) {
    const rel = w.frames[k].rel;
    if (rel < fromRel) continue;
    if (rel >= w.input - w.release && rel < strokeEnd) continue;
    const t = turnBetween(w.frames[k - 1].topWorld as Quaternion, w.frames[k].topWorld as Quaternion);
    if (t > deg) out.push([rel, t]);
  }
  return out;
}

describe('F4: the bat keeps its face through every switch of the body\'s clips', () => {
  it('the leave\'s bat turns about its blade no faster than the blade itself turns (it jumped 73° at the input, again at the end of the inertial window)', async () => {
    await withPacks(() => {
      for (const job of reelJobs().filter((j) => j.intent === 'D3-leave')) {
        const w = walkStriker(job, 300, 1800);
        let worst = 0;
        let at = 0;
        for (let k = 1; k < w.frames.length; k++) {
          const faceTurn = between(w.frames[k - 1].face, w.frames[k].face);
          const bladeTurn = between(dirOf(w.frames[k - 1]), dirOf(w.frames[k]));
          if (faceTurn - bladeTurn > worst) {
            worst = faceTurn - bladeTurn;
            at = w.frames[k].rel;
          }
        }
        expect(worst, `${job.key}: face turn beyond the blade's, worst at release+${at.toFixed(0)} ms (deg)`).toBeLessThan(20);
      }
    });
  });

  it('a crossfade from a clip that carries a face to one that does not turns the face with the weight, not all at once at half-way (it jumped 73° at w = 0.5)', () => {
    const key = (face?: [number, number, number]) => {
      const p = createPose();
      p.bat = { grip: [-0.25, 0.85, 0.08], dir: [0.12, -0.99, 0], ...(face ? { face } : {}) };
      return p;
    };
    const authored: [number, number, number] = [0.036, -0.954, 0.297];
    let previous: [number, number, number] | null = null;
    let worst = 0;
    for (let k = 0; k <= 20; k++) {
      const a = key(authored);
      blendPose(a, key(), k / 20);
      const f = a.bat!.face;
      expect(f, `a face at w = ${k / 20}`).toBeDefined();
      if (previous) worst = Math.max(worst, (Math.acos(Math.max(-1, Math.min(1, previous[0] * f![0] + previous[1] * f![1] + previous[2] * f![2]))) * 180) / Math.PI);
      previous = f as [number, number, number];
    }
    expect(worst, 'the face\'s largest turn between two steps of 0.05 of the weight (deg)').toBeLessThan(10);
  });

  it('draws the clip\'s own face once the external bat has handed over to the clip\'s key (it drew the hint, 73° off, since holdBat ignored the face)', async () => {
    await withPacks(() => {
      let frames = 0;
      for (const job of reelJobs().filter((j) => j.intent === 'D3-leave' || j.intent === 'D4-bowled-late')) {
        const w = walkStriker(job, 300, 2600);
        for (const f of w.frames) {
          if (f.external || !f.keyFace) continue;
          expect(between(f.face, f.keyFace), `${job.key} at release+${f.rel.toFixed(0)} ms: the drawn face against the clip's (deg)`).toBeLessThan(3);
          frames++;
        }
      }
      expect(frames, 'frames drawn from the clip\'s own key').toBeGreaterThan(100);
    });
  });
});

describe('F4: a frame posed twice', () => {
  it('draws the same arms the second time (the motion reel\'s camera poses every frame twice: the trunk\'s lean was then not held to its speed in the second pass, and the next frame started from the unheld lean)', async () => {
    await withPacks(() => {
      for (const job of reelJobs(['right']).filter((j) => j.intent === 'D2-forward-defence')) {
        const p = job.script.practice!;
        const striker = job.script.actors.find((a) => a.id === 'striker')!;
        const hook = stageHook(job.script);
        const stage = stubStage();
        const input = p.releaseScene + job.swing!.startT * 1000; // the swing's start: the first frames with a lean to hold
        let worst = 0;
        let frames = 0;
        for (let t = input - 100; t <= input + 300; t += FRAME_MS) {
          const bp = externalBatPose(p.bat, striker, t, stage.rigOf('striker')?.scale ?? 1);
          stage.poseActor(striker, t, KITS_BOTH, bp, hook);
          const first = stage.rigOf('striker')!.bones.map((b) => b.quaternion.clone());
          stage.poseActor(striker, t, KITS_BOTH, bp, hook);
          stage.rigOf('striker')!.bones.forEach((b, i) => {
            worst = Math.max(worst, turnBetween(first[i], b.quaternion));
          });
          frames++;
        }
        expect(frames, 'frames posed twice').toBeGreaterThan(20);
        expect(worst, `${job.key}: the largest turn of any bone between the first and the second pass of one frame (deg)`).toBeLessThan(0.25);
      }
    });
  });
});

describe('F4: the motion reel\'s four balls, both hands', () => {
  it('the leave and the bowled ball have no forearm or hand turn of more than 60° in a frame, and the top glove never turns more than 65° while he holds the bat (it flipped 173° and 163° at 8.05 s, 139°, 152°, 148°, 121° at 11.48–11.57 s)', async () => {
    await withPacks(() => {
      for (const job of reelJobs().filter((j) => j.intent === 'D3-leave' || j.intent === 'D4-bowled-late')) {
        const w = walkStriker(job, 600, 3000);
        const pops = armPops(w, 60);
        expect(pops.map(([rel, bone, t]) => `${bone} ${t.toFixed(0)}° at release+${rel.toFixed(0)}`), `${job.key}: forearm or hand turns over 60° in a frame`).toEqual([]);
        const glove = holdingGloveTurns(w, 0, 65);
        expect(glove, `${job.key}: top glove world turns over 65° in a frame while holding`).toEqual([]);
      }
    });
  });

  it('the four balls together keep to the builder-measured ceilings (forearm or hand turns over 60° in a frame: 14 for the right-hander and 14 for the left before, 4 and 2 after)', async () => {
    await withPacks(() => {
      let right = 0;
      let left = 0;
      let glove = 0;
      let palm = 0;
      for (const job of reelJobs()) {
        const w = walkStriker(job, 600, 3000);
        for (const f of w.frames) if (f.external && f.rel >= w.input - w.release - 200 && f.rel <= w.input - w.release + 1000) palm = Math.max(palm, f.palm[0], f.palm[1]);
        const n = armPops(w, 60).length;
        if (job.hand === 'right') right += n;
        else left += n;
        glove += holdingGloveTurns(w, 0, 25).length;
      }
      expect(right, 'right-handers: forearm or hand turns over 60° in a frame').toBeLessThanOrEqual(7);
      expect(left, 'left-handers: forearm or hand turns over 60° in a frame').toBeLessThanOrEqual(7);
      expect(glove, 'frames where the top glove turns over 25° while he holds the bat (26 before, 18 after)').toBeLessThanOrEqual(22);
      expect(palm * 1000, 'palm to handle, largest, in the swing\'s window (mm; the checkpoint 5, a drifting roll without the reach-aware turn 61 at the forward defence\'s first move, 2 after)').toBeLessThan(8);
    });
  });
});

describe('F4: the 96-delivery corpus (two overs, three balls, both hands, eight intents)', () => {
  it('keeps the arms\' one-frame turns, the top glove while he holds the bat, the §9 ranges and the hands on the handle inside the builder-measured ceilings', async () => {
    await withPacks(() => {
      let pops = 0;
      let glove = 0;
      let over = 0;
      let palmMax = 0;
      let frames = 0;
      let allStill = 0;
      for (const job of overJobs(2)) {
        const w = walkStriker(job, 1800, 3500);
        frames += w.frames.length;
        pops += armPops(w, 60).length;
        glove += holdingGloveTurns(w, 0, 25).length;
        for (const f of w.frames) {
          if (f.twist.some((t) => t > 110) || f.wrist.some((x) => x > 85)) over++;
          if (f.external && f.rel >= w.input - w.release - 200 && f.rel <= w.input - w.release + 1000) palmMax = Math.max(palmMax, f.palm[0], f.palm[1]);
          if (f.rel > w.input - w.release + 1000 && !f.external) allStill++;
        }
      }
      expect(frames, 'frames walked').toBeGreaterThan(30000);
      expect(allStill, 'frames drawn from the clip\'s own key').toBeGreaterThan(5000);
      expect(pops, 'forearm or hand turns over 60° in a frame (298 before, 47 after)').toBeLessThanOrEqual(60);
      expect(glove, 'frames where the top glove turns over 25° while he holds the bat (272 before, 111 after)').toBeLessThanOrEqual(130);
      expect(over, 'frames over MOTION-SPEC §9\'s upper-arm twist (110°) or wrist swing (85°) (64 before, 2 after)').toBeLessThanOrEqual(8);
      expect(palmMax * 1000, 'palm to handle, largest, while the external bat is swung (mm; 48 before, 20 after)').toBeLessThan(25);
    });
  }, 120_000);
});

