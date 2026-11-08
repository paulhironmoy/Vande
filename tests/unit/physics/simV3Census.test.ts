import { describe, expect, it } from 'vitest';
import { batPoseAdmissibility } from '@/physics/admissibility';
import { batPose } from '@/physics/bat';
import { LEGSPIN, OFFSPIN, PACE, fly, play } from './physics-helpers';

const NON_BAT_KINDS = new Set(['miss', 'pad', 'body', 'leave']);

describe('simulation-v3 anatomical contact census', () => {
  it('freezes the deterministic disposition of the legacy worst cases', () => {
    const cases = [
      { name: 'reach', bowler: PACE, speedKph: 136, lengthM: 2.5, lineM: 0.05, directionDeg: -70, errorMs: -140 },
      { name: 'pre-start', bowler: PACE, speedKph: 136, lengthM: 9, lineM: -0.12, directionDeg: -70, errorMs: 200 },
      { name: 'neck', bowler: PACE, speedKph: 136, lengthM: 10.5, lineM: 0.25, directionDeg: -70, errorMs: 0 },
      { name: 'ground', bowler: OFFSPIN, speedKph: 84, lengthM: 1.2, lineM: 0.05, directionDeg: -70, errorMs: -80 },
    ] as const;
    const observed = cases.map((entry) => {
      const flight = fly(
        { variation: 'stock', lengthM: entry.lengthM, lineM: entry.lineM, speedKph: entry.speedKph },
        entry.bowler,
        'balanced',
        'post-contact-audit',
      );
      const result = play(flight, entry.errorMs, {
        directionDeg: entry.directionDeg,
        power: 0.7,
        elevation: 0.2,
      });
      const gap =
        result.track && result.contact.t !== null && !NON_BAT_KINDS.has(result.contact.kind)
          ? batPoseAdmissibility(batPose(result.track, result.contact.t), result.track.body)
          : null;
      return { name: entry.name, kind: result.contact.kind, t: result.contact.t, startT: result.track?.startT, gap };
    });
    // Refrozen 2026-11-03 (PHYS, anatomy repair; wedge physics REPORT). The former values predated the torso/pad margins
    // and the anthropometric reach, and no longer matched the working tree either. 'neck' now takes the top edge with
    // a 79 mm torso margin and the hands 0.32 m from the shoulders.
    // Refrozen again 2026-11-03 (PHYS phase 3, lead decisions: C1 smooth bat-speed peak through contact; continuous
    // limit-stroke fallback). 'neck', the pull at a 10.5 m ball just above the pull's reach, was a top edge at its
    // limit (t 0.5651452925974177, torso margin 79.2 mm); the fallback now meets the ball at the fastest certified speed
    // at its own aim, so it is a middle at t 0.5491845629103193 with a 60.4 mm torso margin. 'ground' (a 1.2 m ball) is
    // now played off the forward stride by automatic footwork (PHYS phase 4: yorker lengths are smothered, not dug out
    // from the back plane): still a miss, at t 0.759 (was 0.778) from a swing starting at 0.5497 s (was 0.5868 s).
    // 'reach' and 'pre-start' are unchanged.
    // Refrozen again (PHYS2 phase 5: the body solve also constrains the hand reach at the worst dense sample; a
    // mistimed swing replays its on-time plan; same-geometry speed ceiling; rounded toe). 'neck' is still a middle, now
    // at t 0.5490219415534932 (was 0.5491845629103193) from a root that keeps the hands 0.468 m from the shoulders: its
    // binding margin is now the reach (101.9 mm; torso 103.3 mm, was 60.4 mm). 'ground' is still a miss, at t
    // 0.734 (was 0.759): the replayed forward-stride swing passes the 1.2 m ball 25 ms earlier.
    // Refrozen again (PHYS2 5d: an anatomy-capped stroke solves its face for the speed it plays, on a request-independent
    // ceiling grid; the continuous admission bound now uses an upper curvature bound). 'neck' is still a middle, at t
    // 0.5491844728676311 (5c: 0.5490219415534932), close to phase 4 (t 0.5491845629103193, torso margin 60.4 mm): its
    // binding margin is the torso again, 60.5 mm (5c: the reach, 101.9 mm). 'reach', 'pre-start' and 'ground' are
    // unchanged.
    expect(observed).toEqual([
      { name: 'reach', kind: 'miss', t: 0.467, startT: 0.19253116567077277, gap: null },
      { name: 'pre-start', kind: 'miss', t: null, startT: 0.5918605583298631, gap: null },
      {
        name: 'neck',
        kind: 'middle',
        t: 0.5491844728676311,
        startT: 0.408762340756764,
        gap: {
          gap: 0.060529804866542886,
          reachGap: 0.11957831166162569,
          helmetGap: 0.07911445512545721,
          neckGap: 0.12724038454453618,
          torsoGap: 0.060529804866542886,
          padGap: 0.8592279942602067,
          toeGap: 1.348719818213486,
          reach: 0.45042168833837426,
        },
      },
      { name: 'ground', kind: 'miss', t: 0.734, startT: 0.5497034856589909, gap: null },
    ]);
  });

  it('admits only safe, activated bat contacts across the frozen 7,560-case grid', () => {
    const bowlers = [
      [PACE, 136],
      [OFFSPIN, 84],
      [LEGSPIN, 84],
    ] as const;
    const lengths = [1.2, 2.5, 4, 5.5, 6.5, 7.5, 9, 10.5];
    const lines = [-0.3, -0.12, 0.05, 0.25, 0.45];
    const directions = [-70, -45, -20, 0, 20, 45, 70];
    const errors = [-200, -140, -80, -40, 0, 40, 80, 140, 200];
    const counts: Record<string, number> = {};
    let acceptedBat = 0;
    let minimumAcceptedGap = Infinity;
    let outcomeHash = 0x811c9dc5;
    let acceptedGameplayHash = 0x811c9dc5;
    for (const [bowler, speedKph] of bowlers) {
      for (const lengthM of lengths) {
        for (const lineM of lines) {
          const flight = fly(
            { variation: 'stock', lengthM, lineM, speedKph },
            bowler,
            'balanced',
            'post-contact-audit',
          );
          for (const directionDeg of directions) {
            for (const errorMs of errors) {
              const result = play(flight, errorMs, { directionDeg, power: 0.7, elevation: 0.2 }, 'real');
              counts[result.contact.kind] = (counts[result.contact.kind] ?? 0) + 1;
              for (const character of `${result.contact.kind}\n`) {
                outcomeHash = Math.imul(outcomeHash ^ character.charCodeAt(0), 0x01000193);
              }
              if (!NON_BAT_KINDS.has(result.contact.kind)) {
                acceptedBat++;
                expect(result.track).not.toBeNull();
                expect(result.contact.t).not.toBeNull();
                expect(result.contact.t!).toBeGreaterThanOrEqual(result.track!.startT);
                const gap = batPoseAdmissibility(batPose(result.track!, result.contact.t!), result.track!.body).gap;
                minimumAcceptedGap = Math.min(minimumAcceptedGap, gap);
                expect(gap).toBeGreaterThanOrEqual(-1e-12);
                const gameplay = {
                  contact: result.contact,
                  exit: result.exit,
                  impact: result.impact,
                  miss: result.miss,
                  footwork: result.footwork,
                  idealT: result.idealT,
                  quality: result.quality,
                };
                for (const character of `${JSON.stringify(gameplay)}\n`) {
                  acceptedGameplayHash = Math.imul(acceptedGameplayHash ^ character.charCodeAt(0), 0x01000193);
                }
              }
            }
          }
        }
      }
    }
    // Refrozen 2026-11-03 (PHYS anatomy repair, phase 2): the original census (60% misses) froze the collapsed planner.
    // Phase 2 replaced the parked whiff with the requested stroke at its limit, so far-mistimed swings now miss honestly.
    // Refrozen again 2026-11-03 (PHYS phase 3, lead decisions: C1 smooth bat-speed peak, with the acceleration caps
    // scaled to its peak factor, and the continuous limit-stroke fallback that meets the ball at the fastest certified
    // speed before moving its aim). The bat keeps its speed through contact, so it sweeps further past the planned pose:
    // at the far offsets of this grid a few more swings pass the ball. Before (phase 2): miss 4445, middle 1109,
    // inside_edge 127, pad 722, outside_edge 62, leading_edge 160, body 858, top_edge 77; acceptedBat 1535; minimum
    // accepted gap 0.00038288922652243707; hashes 34398d8d/e24bfb12. Every accepted contact still clears the anatomy
    // gate (minimum 0.21 mm). Refrozen again for PHYS phase 4 (automatic footwork smothers yorker lengths on the
    // forward stride): the grid's 1.2 m lengths are now played forward, so pads fall 721 → 595 and middles rise
    // 1101 → 1169 (phase-3 values: miss 4481, middle 1101, inside_edge 127, pad 721, outside_edge 47, leading_edge 155,
    // body 855, top_edge 73; acceptedBat 1503; hashes eed2b3cd/90a748f2).
    // Refrozen again for PHYS2 phase 5 (phase-4 values: miss 4513, middle 1169, inside_edge 132, pad 595,
    // outside_edge 56, leading_edge 167, body 855, top_edge 73; acceptedBat 1597; minimum gap 0.00020976968447652955;
    // hashes 85363774/8cfd88). (1) The body solve now also constrains the hand reach at the worst dense sample, so
    // requested-speed strokes that failed by 1-3 mm of reach in the follow-through are certified (and their roots sit on
    // the gate: the minimum accepted clearance is now 1.7288143139282397e-11 m, still >= the gate's -1e-9).
    // (2) A mistimed swing replays its on-time plan (contact location, face roll, aim, split, speed; same-geometry
    // ceiling). Measured on the tree with (1) and (2) only: miss 4472, middle 1170, inside_edge 128, pad 650,
    // outside_edge 58, leading_edge 169, body 843, top_edge 70. (3) The rounded toe moves a few contacts (miss 4482,
    // middle 1167, inside 126, outside 56, leading 166), and the toe-cap ruling relabels a vertical bat's toe-end hit
    // within the blade's width as a middle (it took an inside/outside/leading edge from the sign of a near-zero offset
    // across the blade): middles 1260, inside 85, outside 23, leading 147.
    // Refrozen again for PHYS2 phase 5b (2026-11-03; phase-5 values: miss 4482, middle 1260, inside_edge 85, pad 650,
    // outside_edge 23, leading_edge 147, body 843, top_edge 70; acceptedBat 1585; hashes 33d848e/ae1c5291). Admission
    // is now continuous between the 0.5 ms lattice samples (bat.ts continuousAdmissible): a track whose anatomy gap
    // dipped up to 0.024 mm below the gate between two samples is no longer certified, so its stroke is planned again
    // (another root, location or speed). On this grid the counts move: miss 4482 -> 4480, middle 1260 -> 1264,
    // pad 650 -> 651, outside_edge 23 -> 22, body 843 -> 841; acceptedBat 1585 -> 1588. The minimum accepted
    // clearance at contact is unchanged.
    // Refrozen again for PHYS2 5d (5b/5c values: miss 4480, middle 1264, inside_edge 85, pad 651, outside_edge 22,
    // leading_edge 147, body 841, top_edge 70; acceptedBat 1588; minimum gap 1.7288143139282397e-11; hashes
    // e14b8bec/8fe0a8d7). A stroke capped below its requested speed now solves its face for the speed it plays (before,
    // the face was set for the requested speed, so a stroke capped at a few m/s left the bat at the wrong bearing, or
    // fended the ball on the middle): with a face solved for the slow bat some capped strokes no longer reach the ball,
    // so misses rise (4480 -> 4524) and pads fall (651 -> 627); middles 1260, edges inside 83, outside 23,
    // leading 145, top 65, body 833; acceptedBat 1576. The corrected continuous admission bound (an upper curvature bound;
    // the 5b lower bound let a 2 um dip through) leaves every accepted contact with at least 4.67e-07 m of clearance.
    // Refrozen again for PHYS2 5f (5d/5e values: miss 4524, middle 1260, inside_edge 83, pad 627, outside_edge 23,
    // leading_edge 145, body 833, top_edge 65; acceptedBat 1576; hashes a97a8fde/75b0266d). Causality: no input changes
    // anything before it. This grid's late swings (+140 and +200 ms) begin after the ball has reached the batter; before
    // their input the batter is the stance, so a ball that meets the stance pads first is that pad impact, resolved as
    // the leave (pads 627 -> 805, misses 4524 -> 4367); and a stride's pads or body that stood in the ball's path before
    // the swing began no longer touch it (they take their place at the swing's start). Middles 1260 -> 1252, body
    // 833 -> 823, inside 83 -> 82, top 65 -> 63; acceptedBat 1576 -> 1565. Every accepted contact keeps its clearance
    // (minimum unchanged).
    expect(counts).toEqual({
      miss: 4367,
      middle: 1252,
      inside_edge: 82,
      pad: 805,
      outside_edge: 23,
      leading_edge: 145,
      body: 823,
      top_edge: 63,
    });
    expect(acceptedBat).toBe(1565);
    expect(minimumAcceptedGap).toBe(4.666003484421477e-7);
    expect((outcomeHash >>> 0).toString(16)).toBe('5f533ecc');
    expect((acceptedGameplayHash >>> 0).toString(16)).toBe('a35f5dc5');
    // Superseded on 2026-11-03 (see above). It was frozen from the independent two-pass body-frame corpus: 7,560/7,560 in each pass, zero gate failures,
    // normalized deterministic SHA-256 6a07da648010122175206005a0e6bfcee6202db390102983818f081f5e018882.
  }, 420_000);
});
