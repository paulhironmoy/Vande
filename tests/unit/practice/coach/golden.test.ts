/**
 * The golden over: Coach Mode against the reference over (src/practice/game/reference.ts), the quality benchmark.
 * Behaviour only, so it holds whatever the physics' calibration: every recommended response really survives with
 * good contact when replayed, and the classic bad responses are explained with the right reason.
 */
import { describe, expect, it } from 'vitest';
import type { AssistLevel, CoachAnalysis, DeliveryRecord, NormalizedSwing } from '@/contracts/practice';
import { practiceFlight } from '@/physics';
import { REFERENCE_BALLS } from '@/practice/game';
import { analyzeBall, primaryInsight } from '@/practice/coach';
import { idealTimes, swingOf, type Candidate } from '@/practice/coach/candidates';
import { AIMED_WITHIN_DEG, pick, wentWhereAimed } from '@/practice/coach/options';
import { slowFend } from '@/practice/coach/quality';
import { spreadOf, type CoachResult, type Evaluated, type Tally } from '@/practice/coach/simulate';
import { play, referenceRecord, replayOption, swingFor, type SwingOpts } from './fixtures';

function attempt(record: DeliveryRecord, o: SwingOpts | null): CoachAnalysis {
  const swing: NormalizedSwing | null = o ? swingFor(record, o) : null;
  const { record: r, result } = play(record, swing);
  return analyzeBall(r, result);
}
const bad = (a: CoachAnalysis) => a.attempted.dismissal !== null || a.attempted.contact !== 'middle';

for (const assist of ['play', 'real'] as AssistLevel[]) {
  describe(`golden: the reference over (${assist})`, () => {
    it('every recommended response survives with good contact when it is replayed', () => {
      const rows: string[] = [];
      for (const rb of REFERENCE_BALLS) {
        const record = referenceRecord(rb.id, assist);
        const a = analyzeBall(record);
        const rec = a.options[0];
        const r = replayOption(record, rec.swing);
        expect(r.outcome.dismissal, rb.id).toBeNull();
        if (rec.decision === 'leave') {
          expect(a.ball.wouldHitStumps, rb.id).toBe(false);
          expect(r.contact.kind, rb.id).toBe('leave');
        } else expect(r.contact.kind, rb.id).toBe('middle');
        // A recommended stroke goes where it is aimed (W0 #6): never a deflection off the toe behind the stumps.
        if (rec.decision === 'attack') expect(wentWhereAimed(r.contact), `${rb.id} aimed ${r.contact.intendedBearingDeg}°, left at ${r.contact.exitBearingDeg}°`).toBe(true);
        // ... and is never a slow fend (lead ruling 2026-11-03): at least half the bat speed it asks for.
        if (rec.decision === 'attack') expect(slowFend({ decision: 'attack', power: rec.swing!.power, directionDeg: rec.swing!.directionDeg, footwork: rec.footwork }, r.contact), `${rb.id} met at ${r.contact.batSpeedKph} km/h`).toBe(false);
        expect(r.outcome).toEqual(rec.outcome);
        rows.push(
          `${rb.id} ${rb.variation.padEnd(8)} → ${rec.decision} ${rec.footwork}${rec.swing && rec.decision === 'attack' ? ` ${rec.swing.directionDeg}° e${rec.swing.elevation} p${rec.swing.power}` : ''}: ${rec.contact} ${rec.outcome.runs} (E ${rec.expectedRuns}, risk ${rec.dismissalRisk}) | ` +
            a.options
              .slice(1)
              .map((o) => `${o.kind} ${o.decision}${o.swing && o.decision === 'attack' ? ` ${o.swing.directionDeg}°${o.swing.elevation >= 0.45 ? ' lofted' : ''}` : ''} E ${o.expectedRuns} risk ${o.dismissalRisk}`)
              .join(' | '),
        );
      }
      console.info(`golden (${assist}):\n  ${rows.join('\n  ')}`);
    });

    it('the recommended response keeps the hard coaching rules: no misread in it, clear of protected arcs unless only a protected aim is robust', () => {
      // Owner decision 2026-11-03 (wedge prompt §10, "Coach"): a robust stroke outranks the protected-arc rule. Before
      // it, this test required every recommended attack to be clear of protected arcs, which failed at Play ref-2 once
      // options.ts put a response that works across its whole execution spread first (coaching REPORT, decision 9).
      // Now a recommended attack may be aimed into a protected arc only when it works at every point of its spread
      // (re-simulated here, never dismissed and always off the middle); the tier order itself is tested below with
      // fixed candidates. On the repaired physics (bat.ts f10202f3, 2026-11-03) no reference ball recommends an attack.
      for (const rb of REFERENCE_BALLS) {
        const record = referenceRecord(rb.id, assist);
        const a = analyzeBall(record);
        const rec = a.options[0];
        if (a.ball.wouldHitStumps) expect(rec.decision, rb.id).not.toBe('leave');
        if (rec.decision !== 'attack' || !rec.risks.includes('into_protected_region')) continue;
        const c: Candidate = { id: 'rec', index: 0, decision: 'attack', kind: 'attack', footwork: rec.swing!.footwork, directionDeg: rec.swing!.directionDeg, elevation: rec.swing!.elevation, power: rec.swing!.power };
        const ideal = idealTimes(practiceFlight(record));
        for (const p of spreadOf(c)) {
          const r = replayOption(record, swingOf(c, ideal, p.dtMs, p.aimDeg));
          expect(r.outcome.dismissal, `${rb.id} protected aim at ${p.dtMs} ms / ${p.aimDeg}°`).toBeNull();
          expect(r.contact.kind, `${rb.id} protected aim at ${p.dtMs} ms / ${p.aimDeg}°`).toBe('middle');
        }
      }
      // The coach never recommends a response its own read would call a misread.
      for (const rb of REFERENCE_BALLS) {
        const record = referenceRecord(rb.id, assist);
        const rec = analyzeBall(record).options[0];
        const { record: r, result } = play(record, rec.swing);
        const done = analyzeBall(r, result);
        for (const [k, v] of Object.entries(done.read)) expect(v, `${rb.id} ${k}`).not.toBe('wrong');
      }
    });

    it('leaving the inswinger: bowled, explained by the swing it did not play', () => {
      const a = attempt(referenceRecord('ref-2', assist), null);
      expect(a.attempted.dismissal).toBe('bowled');
      expect(a.why[0]).toBe('left_and_bowled');
      expect(a.why).toContain('beaten_by_swing');
      expect(a.read.line).toBe('wrong');
      expect(a.read.movement).toBe('wrong');
      expect(primaryInsight(a).recommendation.kind).toBe('play_at_the_stumps');
    });

    it('leaving the yorker and the cutter on the stumps: bowled, play at it', () => {
      for (const id of ['ref-4', 'ref-6'] as const) {
        const a = attempt(referenceRecord(id, assist), null);
        expect(a.why[0], id).toBe('left_and_bowled');
        expect(a.read.line, id).toBe('wrong');
        expect(primaryInsight(a).recommendation.kind, id).toBe('play_at_the_stumps');
      }
    });

    it('playing forward to the bouncer: a misread of the length and bounce, explained by the bounce', () => {
      const record = referenceRecord('ref-5', assist);
      let explained = 0;
      for (const errorMs of [-25, 0, 25, 50]) {
        for (const kind of ['attack', 'defend'] as const) {
          const a = attempt(record, { kind, directionDeg: 0, footwork: 'forward', errorMs });
          expect(a.read.length).toBe('wrong');
          expect(a.read.bounce).toBe('wrong');
          // The answer is never to get forward: go back (or leave, sway or play it from the back foot).
          const rec = primaryInsight(a).recommendation;
          expect(rec.kind).not.toBe('get_forward');
          expect(rec.decision === 'leave' || rec.footwork === 'back').toBe(true);
          if (kind === 'attack' && rec.decision === 'attack') expect(rec.kind).toBe('get_back');
          if (bad(a)) {
            expect(a.why[0]).toBe('beaten_by_bounce');
            explained++;
          }
        }
      }
      expect(explained).toBeGreaterThan(0);
    });

    it('pulling the full outswinger across the line, and getting forward to the hard length, are misreads', () => {
      const pull = attempt(referenceRecord('ref-1', assist), { directionDeg: -70 });
      expect(pull.read.line).toBe('wrong');
      expect(pull.read.movement).toBe('wrong');
      expect(primaryInsight(pull).recommendation.kind).not.toBe('repeat_it');
      const lunge = attempt(referenceRecord('ref-3', assist), { kind: 'defend', footwork: 'forward' });
      expect(lunge.read.length).toBe('wrong');
    });
  });
}

describe('owner decision 2026-11-03: a robust stroke outranks the protected-arc rule (options.ts pick)', () => {
  // Fixed candidates, so the tier order is tested whatever the physics' calibration: tally weights sum to 1.
  const centre = (runs: number) => ({ contact: { kind: 'middle', exitBearingDeg: 47, intendedBearingDeg: 45 }, outcome: { runs, dismissal: null }, footwork: 'forward', coaching: { reason: 'found_the_gap' } }) as unknown as CoachResult;
  const tally = (out: number, clean: number, runs: number): Tally => ({ w: 1, out, runs, clean, edges: 0, caught: out > 0 ? 1 : 0, bowled: 0, lbw: 0 });
  const attack = (index: number, protectedAim: boolean, t: Tally): Evaluated => ({
    c: { id: `attack:${index}`, index, decision: 'attack', kind: 'attack', footwork: 'forward', directionDeg: 45, elevation: 0, power: 0.55 },
    swing: null,
    centre: centre(1),
    played: 'forward',
    orthodox: true,
    withLine: true,
    readOk: true,
    protectedAim,
    tally: t,
  });

  it('a response that works at every point of its spread comes first, even aimed into a protected arc', () => {
    const robustProtected = attack(1, true, tally(0, 1, 0.6));
    // Clear of the protected arcs and worth more, but caught in 5% of its spread: within the risk cap, not robust.
    const clearButCatchable = attack(2, false, tally(0.05, 0.9, 3));
    expect(pick([clearButCatchable, robustProtected]).recommended).toBe(robustProtected);
  });

  it('among responses that work across their spread, one clear of the protected arcs is preferred', () => {
    const robustProtected = attack(1, true, tally(0, 1, 1.2));
    const robustClear = attack(2, false, tally(0, 1, 0.4));
    expect(pick([robustProtected, robustClear]).recommended).toBe(robustClear);
  });
});

describe('a recommended stroke goes where it is aimed (W0 #6; options.ts AIMED_WITHIN_DEG)', () => {
  // Measured on the repaired physics (COACH2-RERUN.md, item 7): the coach recommended a back-foot lofted straight hit
  // to three yorkers (ref-6 at Learn and at Play with 15 ms) whose ideal point came off the toe end of the blade
  // (bladeU -0.037) and left 173° from its aim, behind the stumps. The physics calls that a face contact; the recorded
  // bearings say it was a deflection, so it is not clean contact at the ideal point.
  const evaluated = (decision: 'attack' | 'defend', index: number, exitBearingDeg: number | null, runs: number): Evaluated => ({
    c: { id: `${decision}:${index}`, index, decision, kind: decision, footwork: 'back', directionDeg: 0, elevation: decision === 'attack' ? 0.55 : 0, power: decision === 'attack' ? 0.8 : 0.2 },
    swing: null,
    centre: { contact: { kind: 'middle', exitBearingDeg, intendedBearingDeg: 0 }, outcome: { runs, dismissal: null }, footwork: 'back', coaching: { reason: 'found_the_gap' } } as unknown as CoachResult,
    played: 'back',
    orthodox: decision === 'defend',
    withLine: true,
    readOk: true,
    protectedAim: false,
    tally: { w: 1, out: 0, runs, clean: 1, edges: 0, caught: 0, bowled: 0, lbw: 0 },
  });

  it('a stroke whose ball leaves backwards from its aim is not sound at its ideal point', () => {
    expect(AIMED_WITHIN_DEG).toBe(90);
    expect(wentWhereAimed({ exitBearingDeg: 173, intendedBearingDeg: 0 })).toBe(false);
    expect(wentWhereAimed({ exitBearingDeg: 88, intendedBearingDeg: 0 })).toBe(true);
    expect(wentWhereAimed({ exitBearingDeg: -150, intendedBearingDeg: 45 })).toBe(false);
    expect(wentWhereAimed({ exitBearingDeg: null, intendedBearingDeg: 0 })).toBe(true);
    const toeDeflection = evaluated('attack', 1, 173, 1);
    const block = evaluated('defend', 2, 4, 0);
    expect(pick([toeDeflection, block]).recommended).toBe(block);
    // Along its aim, the same stroke is worth more and is recommended.
    expect(pick([evaluated('attack', 1, 3, 1), block]).recommended.c.decision).toBe('attack');
  });

  it('a stroke met at under half its requested bat speed is never recommended nor offered as more runs (lead ruling 2026-11-03)', () => {
    // The ref-3 back-foot stroke at 84° on the phase-3 tree: 23–28 km/h of the 76–107 km/h it asks for.
    const slow = (index: number, kph: number) => {
      const e = evaluated('attack', index, 3, 1);
      return { ...e, centre: { ...e.centre, contact: { ...e.centre.contact, batSpeedKph: kph } } } as Evaluated;
    };
    const block = evaluated('defend', 2, 4, 0);
    // power 0.8, back foot, 0°: a back drive, a checked punch: 0.75 × 27.2 m/s = 73.4 km/h requested.
    expect(pick([slow(1, 25), block]).recommended).toBe(block);
    expect(pick([slow(1, 25), block]).higherScoring).toBeNull();
    expect(pick([slow(1, 60), block]).recommended.c.decision).toBe('attack');
  });

  it('the higher-scoring alternative is never a deflection either (lead decision 2026-11-03)', () => {
    // A riskier block-beating stroke that scores more but leaves backwards from its aim is not offered as "More runs".
    const block = evaluated('defend', 2, 4, 0);
    const toeDeflection = { ...evaluated('attack', 1, 173, 1), tally: { w: 1, out: 0.05, runs: 1, clean: 0.95, edges: 0, caught: 1, bowled: 0, lbw: 0 } };
    expect(pick([toeDeflection, block]).higherScoring).toBeNull();
    const alongAim = { ...evaluated('attack', 1, 3, 1), tally: toeDeflection.tally };
    expect(pick([alongAim, block]).higherScoring).toBe(alongAim);
  });
});
