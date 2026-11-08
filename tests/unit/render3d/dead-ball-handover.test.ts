/**
 * F5 (the motion reel, 2026-11-07): after a BOWLED ball the batter's arms and bat jumped to a new pose over a few frames
 * (reel clip 01, ball 4, 11.80–11.92 s: the bat swung across four frames in a shot where he fills the edge of the picture; the
 * checkpoint tree had the bat appear in his hands between two frames). The Unity side had the same class of bug: the dead-ball
 * recovery re-posed the hero in the frame the stroke was drawn.
 *
 * What the web's dead-ball hand-over does (script.ts, bat.ts `externalBatPose`): the drawn bat is held 350 ms after the physics
 * bat's last sample, handed to the body's clip over 320 ms, and then is the clip's own key; the gloves close round it all the
 * way (players.holdBat). Nothing in it re-poses the batter in one frame: the bat never steps more than 4 cm a frame there
 * (these tests hold it to the gate's 10 cm). The jump the reel saw was the arms (the F4 flips: 139°, 152°, 148° and 121° of
 * hand at 11.48–11.57 s of clip 02c, the same four frames), so this file walks the hand-over of balls that end early (bowled,
 * lbw, pad, body: pace and spin, right- and left-arm bowlers, both hands) and holds the arms to the F4 fix.
 *
 * Builder measurements on the 76 such balls of this file's corpus (11,720 frames from the physics bat's last sample), before → after:
 * forearm or hand turns over 60° in a frame 277 → 36; arm bone turns over 25° 1,216 → 794; the bat's largest step 9.5 cm → 9.5 cm
 * (10 cm is the gate; not touched); the palm furthest from the handle 177 mm → 104 mm. On the 95 such balls of the 240-ball sweep
 * (evidence under release/.../humans/webfix/A/): turns over 60° 328 → 49, frames with a palm more than 5 mm off the handle
 * 1,493 → 1,131. Still open: the arms follow the bat's sweep to the rest and some frames of it turn a bone 25–60° (see
 * batter-glove-flip.test.ts for why), and on bowled balls one frame in 17,500 has a palm 70 mm off the handle where the
 * checkpoint's worst was 52 mm.
 */
import { describe, expect, it } from 'vitest';
import { FOREARM_HAND, boneTurn, deadBallJobs, reelJobs, walkStriker, withPacks, type Walk } from './batterArmsCorpus';

/** The hand-over: from the physics bat's last sample (else the dead ball) on. */
const handOverFrom = (w: Walk) => w.lastBat ?? w.dead;
const ends = (w: Walk) =>
  w.job.result.outcome.dismissal === 'bowled' ||
  w.job.result.outcome.dismissal === 'lbw' ||
  w.job.result.contact.kind === 'pad' ||
  w.job.result.contact.kind === 'body';

describe('F5: the dead-ball hand-over of balls that end early', () => {
  it('moves the bat no more than 10 cm between frames, turns no forearm or hand more than 60° in one, and keeps the palms near the handle (the builder-measured ceilings)', async () => {
    await withPacks(() => {
      let balls = 0;
      let frames = 0;
      let batStepMax = 0;
      let pops = 0;
      let turned25 = 0;
      let palmMax = 0;
      const pose: string[] = [];
      for (const job of deadBallJobs()) {
        const w = walkStriker(job, 0, 3500);
        if (!ends(w)) continue;
        balls++;
        const from = handOverFrom(w);
        for (let k = 1; k < w.frames.length; k++) {
          const f = w.frames[k];
          if (f.rel < from) continue;
          frames++;
          batStepMax = Math.max(batStepMax, f.cap.distanceTo(w.frames[k - 1].cap));
          palmMax = Math.max(palmMax, f.palm[0], f.palm[1]);
          for (let i = 5; i <= 10; i++) {
            const t = boneTurn(w.frames[k - 1], f, i);
            if (t > 25) turned25++;
            if (t > 60 && (FOREARM_HAND as readonly string[]).includes(w.bones[i])) {
              pops++;
              if (pose.length < 6)
                pose.push(`${job.key} ${w.bones[i]} ${t.toFixed(0)}° at release+${f.rel.toFixed(0)}`);
            }
          }
        }
      }
      expect(balls, 'balls that end early in the corpus').toBeGreaterThan(40);
      expect(frames, 'frames of their hand-overs').toBeGreaterThan(8000);
      expect(batStepMax * 100, "the bat's largest step in a frame in the hand-over (cm; the gate is 10)").toBeLessThan(
        10,
      );
      expect(
        pops,
        `forearm or hand turns over 60° in a frame (before the fix: see the file's header); the worst: ${pose.join('; ')}`,
      ).toBeLessThanOrEqual(45);
      expect(
        turned25,
        "arm bone turns over 25° in a frame (open: the arms follow the bat's sweep to the rest)",
      ).toBeLessThanOrEqual(850);
      expect(palmMax * 1000, 'palm to handle, largest in the hand-over (mm)').toBeLessThan(125);
    });
  }, 120_000);

  it("turns no forearm or hand over 60° in a frame after the stumps are hit, in the reel's bowled ball (it flipped 139°, 152°, 148° and 121° at release + 1.83, 1.87, 1.92 and 2.12 s)", async () => {
    await withPacks(() => {
      for (const job of reelJobs().filter((j) => j.intent === 'D4-bowled-late')) {
        const w = walkStriker(job, 600, 3000);
        const seen: string[] = [];
        for (let k = 1; k < w.frames.length; k++) {
          if (w.frames[k].rel < w.dead) continue;
          for (const nm of FOREARM_HAND) {
            const t = boneTurn(w.frames[k - 1], w.frames[k], w.bones.indexOf(nm));
            if (t > 60) seen.push(`${nm} ${t.toFixed(0)}° at release+${w.frames[k].rel.toFixed(0)}`);
          }
        }
        expect(seen, `${job.key}: forearm or hand turns over 60° in a frame after the dead ball`).toEqual([]);
      }
    });
  });
});
