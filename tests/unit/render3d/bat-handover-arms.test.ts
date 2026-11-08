/**
 * WEB-FIX-A2 (2026-11-07): what the longer hand-over (bat.ts BAT_RELEASE_MS 720 ms for a batter who stays at the crease, 320 ms
 * for one who sets off) and the fixed way round of its blend (see bat-handover.test.ts) do for the ARMS. The ceilings below are
 * tighter than batter-glove-flip.test.ts's and dead-ball-handover.test.ts's, which stay as they were (WEB-FIX-A's measurements at
 * a 320 ms hand-over); they hold the builder-measured results of this round, with a little room. Builder measurements, node pose
 * harness (the real StageScene striker at 60 Hz with the batters' hook and `externalBatPose`), before (BAT_RELEASE_MS 320, the
 * blend's nearer way chosen by every frame) → after:
 *
 *  - the 76 balls of `deadBallJobs()` that end early (bowled, lbw, pad, body), 11,720 frames from the physics bat's last sample:
 *    forearm or hand turns over 60° in a frame 36 → 6; arm-bone turns over 25° 794 → 205; the bat's largest step 9.5 → 6.6 cm;
 *    the palm furthest from the handle 103.5 → 42.2 mm (the bowled ball's 70 mm frame is gone);
 *  - the reel's four balls, both hands: forearm or hand turns over 60° 4 (right) and 2 (left) → 2 and 1; the top glove over 25° in
 *    a frame while he holds the bat 18 → 6;
 *  - the 96-delivery corpus (2 overs): turns over 60° 47 → 15; top glove over 25° 111 → 48; frames over §9's twist or wrist
 *    swing 2 → 0; the palm furthest from the handle in the swing 20 → 20 mm (the swing's own first move; not the hand-over).
 *
 * Still open, and not a hand-over matter: the leave's rest (the clip's own bat settling with the top glove at its wrist limit,
 * a leap to the other window, two top-glove turns of about 58°), and the physics swing's first moves (flips of the elbow
 * 60-200 ms after the input). Both are in the report of WEB-FIX-A2.
 */
import { describe, expect, it } from 'vitest';
import type { Quaternion } from 'three';
import {
  FOREARM_HAND,
  armPops,
  boneTurn,
  deadBallJobs,
  overJobs,
  reelJobs,
  turnBetween,
  walkStriker,
  withPacks,
  type Walk,
} from './batterArmsCorpus';

/** The hand-over: from the physics bat's last sample (else the dead ball) on. */
const handOverFrom = (w: Walk) => w.lastBat ?? w.dead;
const endsEarly = (w: Walk) =>
  w.job.result.outcome.dismissal === 'bowled' ||
  w.job.result.outcome.dismissal === 'lbw' ||
  w.job.result.contact.kind === 'pad' ||
  w.job.result.contact.kind === 'body';

/** The top glove's one-frame turns of its world rotation over `deg` while he holds the bat (before the input, after the stroke). */
function holdingGloveTurns(w: Walk, deg: number): number {
  let n = 0;
  const strokeEnd = w.input + 800 - w.release;
  for (let k = 1; k < w.frames.length; k++) {
    const rel = w.frames[k].rel;
    if (rel < 0) continue;
    if (rel >= w.input - w.release && rel < strokeEnd) continue;
    if (turnBetween(w.frames[k - 1].topWorld as Quaternion, w.frames[k].topWorld as Quaternion) > deg) n++;
  }
  return n;
}

describe('A2: the arms through the longer hand-over', () => {
  it('the balls that end early: the bat steps under 8 cm, 12 or fewer forearm or hand turns over 60°, and no palm more than 60 mm off the handle after the last sample', async () => {
    await withPacks(() => {
      let balls = 0;
      let frames = 0;
      let batStepMax = 0;
      let pops = 0;
      let turned25 = 0;
      let palmMax = 0;
      for (const job of deadBallJobs()) {
        const w = walkStriker(job, 0, 3500);
        if (!endsEarly(w)) continue;
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
            if (t > 60 && (FOREARM_HAND as readonly string[]).includes(w.bones[i])) pops++;
          }
        }
      }
      expect(balls, 'balls that end early').toBeGreaterThan(60);
      expect(frames, 'frames of their hand-overs').toBeGreaterThan(10000);
      expect(batStepMax * 100, "the bat's largest step in a frame (cm; 9.5 before, 6.6 after)").toBeLessThan(8);
      expect(pops, 'forearm or hand turns over 60° in a frame (36 before, 6 after)').toBeLessThanOrEqual(12);
      expect(turned25, 'arm-bone turns over 25° in a frame (794 before, 205 after)').toBeLessThanOrEqual(260);
      expect(palmMax * 1000, 'palm to handle, largest (mm; 103.5 before, 42.2 after)').toBeLessThan(60);
    });
  }, 120_000);

  it("the reel's four balls, both hands: 3 or fewer forearm or hand turns over 60° a hand, and 10 or fewer top-glove turns over 25° while he holds the bat", async () => {
    await withPacks(() => {
      let right = 0;
      let left = 0;
      let glove = 0;
      let palm = 0;
      for (const job of reelJobs()) {
        const w = walkStriker(job, 600, 3000);
        for (const f of w.frames)
          if (f.external && f.rel >= w.input - w.release - 200 && f.rel <= w.input - w.release + 1000)
            palm = Math.max(palm, f.palm[0], f.palm[1]);
        const n = armPops(w, 60).length;
        if (job.hand === 'right') right += n;
        else left += n;
        glove += holdingGloveTurns(w, 25);
      }
      expect(right, 'right-handers: forearm or hand turns over 60° in a frame (4 before, 2 after)').toBeLessThanOrEqual(
        3,
      );
      expect(left, 'left-handers: forearm or hand turns over 60° in a frame (2 before, 1 after)').toBeLessThanOrEqual(
        3,
      );
      expect(
        glove,
        'frames where the top glove turns over 25° while he holds the bat (18 before, 6 after)',
      ).toBeLessThanOrEqual(10);
      expect(palm * 1000, "palm to handle, largest, in the swing's window (mm)").toBeLessThan(8);
    });
  }, 120_000);

  it("the 96-delivery corpus (two overs, three balls, both hands, eight intents): 22 or fewer forearm or hand turns over 60°, 60 or fewer top-glove turns over 25°, none over §9's twist or wrist swing, the palm within 25 mm in the swing", async () => {
    await withPacks(() => {
      let pops = 0;
      let glove = 0;
      let over = 0;
      let palmMax = 0;
      let frames = 0;
      for (const job of overJobs(2)) {
        const w = walkStriker(job, 1800, 3500);
        frames += w.frames.length;
        pops += armPops(w, 60).length;
        glove += holdingGloveTurns(w, 25);
        for (const f of w.frames) {
          if (f.twist.some((t) => t > 110) || f.wrist.some((x) => x > 85)) over++;
          if (f.external && f.rel >= w.input - w.release - 200 && f.rel <= w.input - w.release + 1000)
            palmMax = Math.max(palmMax, f.palm[0], f.palm[1]);
        }
      }
      expect(frames, 'frames walked').toBeGreaterThan(30000);
      expect(pops, 'forearm or hand turns over 60° in a frame (47 before, 15 after)').toBeLessThanOrEqual(22);
      expect(
        glove,
        'frames where the top glove turns over 25° while he holds the bat (111 before, 48 after)',
      ).toBeLessThanOrEqual(60);
      expect(over, "frames over MOTION-SPEC §9's upper-arm twist (110°) or wrist swing (85°) (2 before, 0 after)").toBe(
        0,
      );
      expect(palmMax * 1000, 'palm to handle, largest, while the external bat is swung (mm)').toBeLessThan(25);
    });
  }, 120_000);
});
