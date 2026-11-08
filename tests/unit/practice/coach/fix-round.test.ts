// @vitest-environment node
/**
 * The independent evaluators' fix round of 2026-11-03 (wedge/eval-coach/VERDICT.md, wedge/eval-sound-rules/VERDICT.md):
 *
 *   O9b  no down-the-track option (recommended, safest or higher-scoring) until stumpings exist: EPX-R7 measured the
 *        stranded exposure at 20–33% while the coach still offered it (candidates.ts).
 *   D-1  the execution spread is dense (every 5 ms across ±2σ, the old points a subset), and a displayed risk is the
 *        weighted estimate over it: Play/0 ref-6's lofted straight hit had shown "0% risk" while it is caught 22–38 ms
 *        early, between the old sample points.
 *   O-3  the tip leads with the physics' own named reason: when the physics names the timing, the timing comes first.
 */
import { describe, expect, it } from 'vitest';
import type { CoachAnalysis, DeliveryRecord } from '@/contracts/practice';
import { autoField, practiceFlight } from '@/physics';
import { REFERENCE_BALLS, ballSeed, randomOver, repeatDelivery } from '@/practice/game';
import { analyzeBall, tipOf } from '@/practice/coach';
import { candidatesFor, idealTimes, swingOf, type Candidate } from '@/practice/coach/candidates';
import type { BallFacts } from '@/practice/coach/facts';
import { EXECUTION_SPREAD, spreadOf } from '@/practice/coach/simulate';
import { referenceRecord } from './fixtures';

describe('O9b: the coach never offers down the track while stumpings do not exist', () => {
  /** The evaluators' EPX-R7 reproduction over (a beginner spin over at Real), as a record per ball. */
  function spinOver(assist: 'real' | 'play'): DeliveryRecord[] {
    const over = randomOver({
      seed: 'eval-phys-epx-r7|beginner|0',
      conditions: 'balanced',
      assist,
      difficulty: 'beginner',
      family: 'spin',
    });
    const field = autoField(over.bowler, 'balanced', 'right', over.ball);
    return over.balls.map((plan, b) => ({
      ...referenceRecord('ref-1', assist),
      bowler: over.bowler,
      plan,
      seed: ballSeed(over, b),
      conditions: 'balanced',
      ball: over.ball,
      field,
      ballIndex: b,
    }));
  }

  it('the reproduction ball (ball 1) and its whole over offer no down-the-track option, at Real and Play', () => {
    for (const assist of ['real', 'play'] as const) {
      const balls = spinOver(assist);
      expect(balls[0].bowler.family).toBe('spin');
      for (const [b, record] of balls.entries()) {
        const options = analyzeBall(record).options;
        expect(options.length, `${assist} ball ${b}`).toBeGreaterThan(0);
        for (const o of options) expect(o.footwork, `${assist} ball ${b} ${o.kind}`).not.toBe('down_track');
      }
    }
  }, 240_000);

  it('no down-the-track candidate is ever simulated, for a flighted spinner on a good or full length', () => {
    const field = { gaps: [] } as unknown as Parameters<typeof candidatesFor>[1];
    for (const lengthBand of ['good', 'full'] as const) {
      const f = {
        family: 'spin',
        lengthBand,
        autoFootwork: 'forward',
        lineBand: 'off_stump',
        mover: null,
        playedMoveM: 0,
        lineAtStumpsM: 0.05,
        wouldHitStumps: true,
        full: lengthBand === 'full',
        short: false,
      } as unknown as BallFacts;
      expect(candidatesFor(f, field).filter((c) => c.footwork === 'down_track')).toEqual([]);
    }
  });
});

describe('D-1: a dense execution spread, and a displayed risk equal to its weighted estimate', () => {
  const stroke: Candidate = {
    id: 's',
    index: 0,
    decision: 'attack',
    kind: 'attack',
    footwork: 'auto',
    directionDeg: 0,
    elevation: 0,
    power: 0.55,
  };
  const block: Candidate = { ...stroke, id: 'b', decision: 'defend', kind: 'defend', power: 0.2 };

  it('every 5 ms across ±2σ at the aim, the aim offsets every 10 ms within ±1σ, the old points a subset, Gaussian and symmetric', () => {
    const pts = spreadOf(stroke);
    const at = (aim: number) =>
      pts
        .filter((p) => p.aimDeg === aim)
        .map((p) => p.dtMs)
        .sort((a, b) => a - b);
    expect(at(0)).toEqual(Array.from({ length: 17 }, (_, i) => -40 + 5 * i));
    for (const aim of [-10, 10]) expect(at(aim)).toEqual([-20, -10, 0, 10, 20]);
    expect(pts.length).toBe(27);
    expect(
      spreadOf(block)
        .map((p) => p.dtMs)
        .sort((a, b) => a - b),
    ).toEqual(Array.from({ length: 17 }, (_, i) => -40 + 5 * i));
    expect(spreadOf({ ...stroke, kind: null, decision: 'leave' }).length).toBe(1);
    for (const p of pts)
      if (p.aimDeg !== 0) expect(Math.abs(p.dtMs)).toBeLessThanOrEqual(EXECUTION_SPREAD.timingSigmaMs);
    // The coarse screen (finalists only; every shown option is certified densely) is the old timing points at the aim.
    expect(
      spreadOf(stroke, 'coarse')
        .map((p) => `${p.dtMs}/${p.aimDeg}`)
        .sort(),
    ).toEqual(['-20/0', '-40/0', '0/0', '20/0', '40/0']);
    const key = (dt: number, aim: number) => pts.find((p) => p.dtMs === dt && p.aimDeg === aim);
    for (const [dt, aim] of [
      [0, 0],
      [20, 0],
      [-20, 0],
      [40, 0],
      [-40, 0],
      [0, 10],
      [0, -10],
      [20, 10],
      [-20, -10],
    ] as const)
      expect(key(dt, aim), `old point ${dt}/${aim}`).toBeDefined();
    for (const p of pts) {
      expect(key(-p.dtMs, -p.aimDeg)!.weight).toBe(p.weight);
      const k = p.dtMs / EXECUTION_SPREAD.timingSigmaMs;
      expect(p.weight / (p.aimDeg === 0 ? 0.5 : 0.25)).toBeCloseTo(Math.exp((-k * k) / 2), 12);
    }
  });

  it('on the reference over, every option shows the weighted dense estimate, and a shown 0% risk survives every point', () => {
    // Replays each option's own spread through the game's exact-ball path, independently of the coach's memo.
    for (const assist of ['play', 'real'] as const) {
      for (const rb of REFERENCE_BALLS) {
        const record = referenceRecord(rb.id, assist);
        const an: CoachAnalysis = analyzeBall(record);
        const ideal = idealTimes(practiceFlight(record));
        for (const o of an.options) {
          if (!o.swing) continue;
          const c: Candidate = {
            id: 'o',
            index: 0,
            decision: o.decision,
            kind: o.swing.kind,
            footwork: o.swing.footwork,
            directionDeg: o.swing.directionDeg,
            elevation: o.swing.elevation,
            power: o.swing.power,
          };
          let w = 0;
          let out = 0;
          let runs = 0;
          for (const p of spreadOf(c)) {
            const r = repeatDelivery(record, swingOf(c, ideal, p.dtMs, p.aimDeg));
            w += p.weight;
            if (r.outcome.dismissal) out += p.weight;
            else runs += p.weight * r.outcome.runs;
            if (o.dismissalRisk === 0)
              expect(
                r.outcome.dismissal,
                `${assist} ${rb.id} ${o.kind} shown 0% risk, out at ${p.dtMs} ms / ${p.aimDeg}°`,
              ).toBeNull();
          }
          expect(o.dismissalRisk, `${assist} ${rb.id} ${o.kind} risk`).toBe(Math.round((out / w) * 1000) / 1000 || 0);
          expect(o.expectedRuns, `${assist} ${rb.id} ${o.kind} runs`).toBe(Math.round((runs / w) * 100) / 100 || 0);
        }
      }
    }
  }, 240_000);
});

describe('O-3: the tip leads with the physics own named reason', () => {
  // A full outswinger on the stumps line driven across the line at −70°; the coach would block forward.
  const FACTS = {
    family: 'pace',
    lengthM: 3,
    lengthBand: 'full',
    full: true,
    short: false,
    mover: 'swing',
    playedMoveM: 0.188,
    lineAtStumpsM: 0.36,
    wideOfStumpsM: 0.21,
    wouldHitStumps: false,
  } as unknown as BallFacts;
  const analysis = (timing: 'perfect' | 'mistimed', timingErrorMs: number) =>
    ({
      version: 3,
      ball: {
        variation: 'outswing',
        speedKph: 137.5,
        lengthM: 3,
        lineAtStumpsM: 0.36,
        airMovementM: 0.188,
        pitchMovementM: 0,
        heightAtBatM: 0.18,
        wouldHitStumps: false,
      },
      read: {
        length: 'right',
        line: 'wrong',
        pace: timing === 'perfect' ? 'right' : 'wrong',
        movement: 'unclear',
        bounce: 'unclear',
      },
      attempted: {
        decision: 'attack',
        footwork: 'forward',
        directionDeg: -70,
        elevation: 0,
        power: 0.55,
        timingErrorMs,
        contact: 'miss',
        timing,
        runs: 0,
        dismissal: null,
        spread: { dismissalRisk: 0, expectedRuns: 0, risks: [] },
      },
      why: ['missed_straight_ball'],
      options: [
        {
          kind: 'recommended',
          decision: 'defend',
          footwork: 'forward',
          swing: { kind: 'defend', startT: 0.4, directionDeg: 0, power: 0.2, elevation: 0, footwork: 'forward' },
          outcome: {
            runs: 0,
            boundary: null,
            dismissal: null,
            fielderId: null,
            endBearingDeg: null,
            endDistanceM: null,
            region: null,
          },
          contact: 'middle',
          contactPoint: null,
          contactT: 0.5,
          dismissalRisk: 0,
          expectedRuns: 0.1,
          region: null,
          risks: [],
        },
      ],
    }) as unknown as CoachAnalysis;
  const attempt = (reason: string) =>
    ({
      contact: { kind: 'miss', faceBearingDeg: 63, intendedBearingDeg: 60 },
      outcome: { dismissal: null, region: null },
      coaching: { reason, zone: null, fielderRole: null },
    }) as unknown as Parameters<typeof tipOf>[2];

  it('a mistimed swing: the timing first, even when the ball was the wrong ball (the evaluators’ Play/0 ref-6 +63 ms case)', () => {
    expect(tipOf(analysis('mistimed', 63), FACTS, attempt('missed_straight_ball')).fact).toMatchObject({
      kind: 'late',
      ms: 63,
    });
    expect(tipOf(analysis('mistimed', -63), FACTS, attempt('missed_straight_ball')).fact).toMatchObject({
      kind: 'early',
      ms: 63,
    });
  });

  // Lead ruling (B), 2026-11-04. These two cases are a perfect-labelled swing that the bat never met (contact 'miss').
  // Before: the fact was across_line, "It was 21 cm wide of off stump, and you played across the line". After: it is
  // no_reach 'off', "It was 21 cm wide of off stump, and the bat never reached it". It still leads with the line it was
  // played across (O-3), and it now says plainly that the bat never met the ball (B).
  it('a swing timed inside the band, physics naming no timing: the wrong ball explains the change of decision', () => {
    expect(tipOf(analysis('perfect', 4), FACTS, attempt('missed_straight_ball')).fact).toEqual({
      kind: 'no_reach',
      why: 'off',
      cm: 21,
      lengthM: null,
    });
  });

  it('the physics naming the line across which it was played leads with that line', () => {
    expect(tipOf(analysis('perfect', 4), FACTS, attempt('played_across_the_line')).fact).toEqual({
      kind: 'no_reach',
      why: 'off',
      cm: 21,
      lengthM: null,
    });
  });

  it('any action leads with the named timing: "play straighter" after a mistimed drive across the movement (Play/15 ref-6)', () => {
    // An inswinging yorker; the 45° drive went across the movement 78 ms early and was caught; the coach plays a
    // straight lofted hit. Before, the fact was "It moved 8 cm in, and you played across it"; the physics named timing.
    const inswing = {
      family: 'pace',
      lengthM: 0.9,
      lengthBand: 'yorker',
      full: true,
      short: false,
      mover: 'swing',
      playedMoveM: -0.08,
      lineAtStumpsM: 0.02,
      wideOfStumpsM: -0.13,
      wouldHitStumps: true,
    } as unknown as BallFacts;
    const an = {
      ...analysis('mistimed', -78),
      ball: {
        variation: 'yorker',
        speedKph: 139.5,
        lengthM: 0.9,
        lineAtStumpsM: 0.02,
        airMovementM: -0.08,
        pitchMovementM: 0,
        heightAtBatM: 0.2,
        wouldHitStumps: true,
      },
      read: { length: 'right', line: 'right', pace: 'wrong', movement: 'wrong', bounce: 'unclear' },
      attempted: { ...analysis('mistimed', -78).attempted, directionDeg: 45, contact: 'middle', dismissal: 'caught' },
      why: ['caught_in_the_ring'],
      options: [
        {
          ...analysis('mistimed', -78).options[0],
          decision: 'attack',
          swing: { kind: 'attack', startT: 0.4, directionDeg: 0, power: 0.8, elevation: 0.55, footwork: 'forward' },
          region: 'straight',
          expectedRuns: 3.9,
        },
      ],
    } as unknown as CoachAnalysis;
    const caught = {
      contact: { kind: 'middle', bladeU: 0.22, batSpeedKph: 80 },
      outcome: { dismissal: 'caught', region: 'mid_on' },
      coaching: { reason: 'caught_in_the_ring', zone: null, fielderRole: 'mid_on' },
    } as unknown as Parameters<typeof tipOf>[2];
    const tip = tipOf(an, inswing, caught);
    expect(tip.action.kind).toBe('play_straighter');
    expect(tip.fact).toMatchObject({ kind: 'early', ms: 78, where: 'caught' });
  });

  // Lead ruling (B), 2026-11-04.
  // - Before: this case was a perfect-labelled miss, with the fact "12 ms late, …".
  // - Ruling (B) says that a "N ms late" fact beside a perfect label on a ball the bat never met is a contradiction. That
  //   ruling covers `beaten_by_pace` explicitly, and the same holds for `too_late`. So the miss now says the line and
  //   that the bat never reached it.
  // - O-3's "inside the band too" still holds wherever the bat met the ball: off the outside edge, the timing leads.
  it('the physics naming the timing by its reason (too late) leads with the timing, inside the band too, when the bat met it', () => {
    const edged = {
      ...analysis('perfect', 12),
      attempted: { ...analysis('perfect', 12).attempted, contact: 'outside_edge' },
    } as unknown as CoachAnalysis;
    const edge = {
      ...attempt('too_late'),
      contact: { kind: 'outside_edge', faceBearingDeg: 63, intendedBearingDeg: 60 },
    } as unknown as Parameters<typeof tipOf>[2];
    expect(tipOf(edged, FACTS, edge).fact).toMatchObject({ kind: 'late', ms: 12 });
    expect(tipOf(analysis('perfect', 12), FACTS, attempt('too_late')).fact).toEqual({
      kind: 'no_reach',
      why: 'off',
      cm: 21,
      lengthM: null,
    });
  });
});
