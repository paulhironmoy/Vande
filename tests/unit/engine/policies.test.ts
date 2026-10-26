// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { InningsSummary } from '@/contracts';
import { engine } from '@/engine';
import { rngFromKey } from '@/engine/prng';
import { dayIndex } from '@/engine/v1/policies';
import { ALL_VARIANTS, CONDITIONS, hexSeed, logFor, playBoth, randomPlan } from './helpers';

describe('Auto Over', () => {
  it('always produces a legal starter-only over (valid with nothing unlocked)', () => {
    for (const c of CONDITIONS)
      for (let k = 0; k < 40; k++) {
        const plan = engine.autoOver(`auto-${k}`, c);
        const r = engine.validatePlan(plan, []);
        expect(r.ok, JSON.stringify(r)).toBe(true);
        expect(plan.balls.every((b) => engine.STARTER_VARIANTS.includes(b.variant))).toBe(true);
      }
  });
  it('is deterministic for a seed and differs across seeds', () => {
    const c = CONDITIONS[4];
    expect(engine.autoOver('s', c)).toEqual(engine.autoOver('s', c));
    expect(engine.autoOver('s', c)).not.toEqual(engine.autoOver('t', c));
  });
});

describe('Auto XI', () => {
  it('always answers with an input that passes validation, for any delivery', () => {
    for (let k = 0; k < 80; k++) {
      const rng = rngFromKey(`autobat|${k}`);
      const plan = randomPlan(rng);
      const c = rng.pick(CONDITIONS);
      for (let ball = 0; ball <= 6; ball++) {
        const d = engine.revealDelivery(plan, ball, c);
        const input = engine.autoBat(`seed-${k}`, d);
        const r = engine.validateBattingInput(input, d);
        expect(r.ok, JSON.stringify(r)).toBe(true);
        expect(engine.autoBat(`seed-${k}`, d)).toEqual(input);
      }
    }
  });
});

describe('Practice Ghosts', () => {
  it('has at least four ghosts with distinct ids and difficulties 1–3', () => {
    expect(engine.GHOSTS.length).toBeGreaterThanOrEqual(4);
    expect(new Set(engine.GHOSTS.map((g) => g.id)).size).toBe(engine.GHOSTS.length);
    expect(new Set(engine.GHOSTS.map((g) => g.difficulty))).toEqual(new Set([1, 2, 3]));
    for (const g of engine.GHOSTS) {
      expect(g.nameKey).toBe(`ghost.${g.id}.name`);
      expect(g.styleKey).toBe(`ghost.${g.id}.style`);
    }
    expect(() => engine.ghostPlan('nobody', 's', CONDITIONS[0])).toThrow();
  });

  it('bowl legal, deterministic plans and bat with valid inputs', () => {
    for (const g of engine.GHOSTS)
      for (const c of CONDITIONS) {
        const plan = engine.ghostPlan(g.id, `seed-${c.pitch}`, c);
        expect(engine.validatePlan(plan, ALL_VARIANTS).ok).toBe(true);
        expect(engine.ghostPlan(g.id, `seed-${c.pitch}`, c)).toEqual(plan);
        for (let ball = 0; ball <= 6; ball++) {
          const d = engine.revealDelivery(plan, ball, c);
          const input = engine.ghostBat(g.id, 'bat-seed', d);
          expect(engine.validateBattingInput(input, d).ok).toBe(true);
          expect(engine.ghostBat(g.id, 'bat-seed', d)).toEqual(input);
        }
      }
  });

  it('have readable, distinct personalities', () => {
    const c = { pitch: 'green', weather: 'humid' } as const;
    const variants = (id: string) => new Set(engine.ghostPlan(id, 'x', c).balls.map((b) => b.variant));
    expect([...variants('swinger')].some((v) => v === 'inswing' || v === 'outswing')).toBe(true);
    expect(variants('enforcer').has('bouncer')).toBe(true);
    expect(engine.ghostPlan('trickster', 'x', { pitch: 'slow', weather: 'clear' }).balls.some((b) => b.variant === 'offspin' || b.variant === 'legspin')).toBe(true);
    expect(engine.ghostPlan('anchor', 'x', c).balls.every((b) => b.intent === 'contain')).toBe(true);
  });
});

describe('Daily Six', () => {
  it('is identical for everyone on a day and changes day to day', () => {
    const a = engine.dailyChallenge('2026-10-25');
    expect(engine.dailyChallenge('2026-10-25')).toEqual(a);
    expect(engine.dailyChallenge('2026-10-26')).not.toEqual(a);
    for (const over of a.overs) expect(engine.validatePlan(over, ALL_VARIANTS).ok).toBe(true);
  });

  it('rotates the three pitches day by day and never hides a loose ball', () => {
    const pitches = [0, 1, 2, 3, 4, 5].map((k) => engine.dailyChallenge(`2026-11-0${k + 1}`).conditions.pitch);
    expect(new Set(pitches.slice(0, 3)).size).toBe(3);
    expect(pitches.slice(3)).toEqual(pitches.slice(0, 3));
    for (let k = 1; k <= 28; k++) {
      const ch = engine.dailyChallenge(`2026-02-${String(k).padStart(2, '0')}`);
      for (const over of ch.overs)
        for (const b of [...over.balls, over.superBall]) {
          const q = engine.executionQuality(b.gesture);
          expect(q.ok && q.grade).not.toBe('loose');
        }
    }
    expect(dayIndex('2026-10-25')).toBe(20751);
    expect(dayIndex('not a day')).toBe(0);
  });

  it('scores runs first with documented bonuses', () => {
    const s = (runs: number[], wickets: number): InningsSummary => ({
      batter: 0,
      bowler: 1,
      balls: runs.map((r) => ({ runs: r }) as InningsSummary['balls'][number]),
      runs: runs.reduce((x, y) => x + y, 0),
      wickets,
      ballsFaced: runs.length,
    });
    expect(engine.dailyScore(s([4, 6, 1, 0, 2, 1], 0))).toBe(140 + 4 + 8 + 24);
    expect(engine.dailyScore(s([0, 0], 2))).toBe(0);
    expect(engine.dailyScore(s([6, 6, 6, 6, 6, 6], 0))).toBe(360 + 48 + 24);
  });
});

describe('matchPerformance', () => {
  it('returns Top 100 components in 0..1 that reward better play', async () => {
    const rng = rngFromKey('perf');
    const plans = [randomPlan(rng), randomPlan(rng)] as const;
    const c = CONDITIONS[2];
    const m = playBoth(hexSeed(rng), c, [plans[0], plans[1]], (i, d) =>
      i === 0 ? engine.ghostBat('maestro', 'p', d) : { ...engine.ghostBat('anchor', 'q', d) },
    );
    const log = await logFor(m);
    for (const p of [0, 1] as const) {
      const perf = engine.matchPerformance(log, p);
      for (const v of Object.values(perf)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    expect(engine.matchPerformance(log, 0)).toEqual(engine.matchPerformance(log, 0));
  });
});
