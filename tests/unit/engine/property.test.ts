// @vitest-environment node
/**
 * Property-based tests with our own seeded generators: any legal plan and any valid input must give legal outcomes,
 * innings must end correctly, factors must stay in range and every revealed log must verify (tampered ones must not).
 */
import { describe, expect, it } from 'vitest';
import { EXPLAIN_KEYS, engine } from '@/engine';
import { rngFromKey } from '@/engine/prng';
import { clone, logFor, randomMatch } from './helpers';

const RUNS = new Set([0, 1, 2, 3, 4, 6]);

describe('properties over 300 random matches', () => {
  const matches = Array.from({ length: 300 }, (_, k) => randomMatch(`prop|${k}`, { sigma: 30 + (k % 5) * 30, pUnanswered: (k % 7) / 40 }));

  it('every outcome is legal and every factor is in range', () => {
    for (const m of matches)
      for (const s of m.states)
        for (const o of [...s.outcomes, s.superBall]) {
          if (!o) throw new Error('missing outcome');
          expect(RUNS.has(o.runs)).toBe(true);
          expect(o.runs).toBeLessThanOrEqual(6);
          if (o.wicket) expect(o.runs).toBe(0);
          if (o.timing === 'interrupted') expect(o.wicket).toBeNull();
          if (o.dead) expect([o.runs, o.wicket]).toEqual([0, null]);
          if (o.shot === 'leave' || o.timing === 'no_shot' || o.timing === 'interrupted') expect(o.runs).toBe(0);
          for (const k of ['matchup', 'timing', 'execution', 'pitch', 'field', 'setup'] as const) expect(Math.abs(o.factors[k])).toBeLessThanOrEqual(1);
          expect(o.factors.risk).toBeGreaterThanOrEqual(0);
          expect(o.factors.risk).toBeLessThanOrEqual(1);
          expect(EXPLAIN_KEYS).toContain(o.factors.explainKey);
          expect(o.execution).toBeGreaterThanOrEqual(0);
          expect(o.execution).toBeLessThanOrEqual(1);
          expect(o.cues.crowd).toBeGreaterThanOrEqual(0);
          expect(o.cues.crowd).toBeLessThanOrEqual(1);
          expect(o.cues.cameras.length).toBeGreaterThan(0);
          let t = 0;
          for (const c of o.cues.cameras) {
            expect(c.atMs).toBeGreaterThanOrEqual(t - 1e-9);
            expect(c.durationMs).toBeGreaterThan(0);
            t = c.atMs + c.durationMs;
          }
          if (o.cues.fate.kind === 'six') expect(o.runs).toBe(6);
          if (o.cues.fate.kind === 'four') expect(o.runs).toBe(4);
          if (o.cues.fate.kind === 'wicket') expect(o.wicket).toBe(o.cues.fate.wicket);
          if (o.wicket === 'stumped') expect(o.delivery.variant === 'offspin' || o.delivery.variant === 'legspin').toBe(true);
          if (o.wicket === 'lbw') expect(o.delivery.line).not.toBe('wide_off');
        }
  });

  it('every innings ends correctly: six balls, at most two wickets, then the Super Ball', () => {
    for (const m of matches)
      for (const s of m.states) {
        expect(s.done).toBe(true);
        expect(s.outcomes).toHaveLength(6);
        expect(s.superBall).not.toBeNull();
        expect(s.wickets).toBeLessThanOrEqual(2);
        expect(s.runs).toBeLessThanOrEqual(36);
        const live = s.outcomes.filter((o) => !o.dead);
        const wicketsBeforeLast = live.slice(0, -1).filter((o) => o.wicket).length;
        expect(wicketsBeforeLast).toBeLessThan(2);
        if (live.length < 6) expect(s.wickets).toBe(2);
      }
  });

  it('every revealed log verifies, and any single tampered field fails', async () => {
    const rng = rngFromKey('prop-tamper');
    for (const m of matches.slice(0, 60)) {
      const log = await logFor(m);
      expect((await engine.verifyMatchLog(log)).ok).toBe(true);
      const bad = clone(log);
      switch (rng.int(0, 4)) {
        case 0:
          bad.innings[rng.int(0, 1)].runs += 1;
          break;
        case 1:
          bad.result.marginRuns += 1;
          break;
        case 2:
          bad.plans[rng.int(0, 1)].field = bad.plans[0].field === 'sweeper' ? 'attacking' : 'sweeper';
          break;
        case 3:
          bad.seed = bad.seed.replace(/^./, (c) => (c === 'a' ? 'b' : 'a'));
          break;
        default:
          bad.events.push({ t: 'commentary', key: 'commentary.six' });
      }
      expect((await engine.verifyMatchLog(bad)).ok).toBe(false);
    }
  });
});
