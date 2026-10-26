// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { AssistLevel, BowlerFamily, DeliveryVariation, PitchCondition, PracticeOverPlan } from '@/contracts/practice';
import { PACE_BANDS_KPH, PACE_KPH, SPIN_KPH, YORKER_MAX_LENGTH } from '@/physics/constants';
import {
  BOUNCER_ARRIVAL_M,
  BOUNCER_MIN_LENGTH_M,
  BUILD_LIMITS,
  arrivalHeight,
  LEARN_PACE_KPH,
  LEARN_SPIN_KPH,
  PACE_VARIATIONS,
  SPEED_LIMITS_KPH,
  SPIN_STOCK_KPH,
  SPIN_VARIATIONS,
  ballSeed,
  bowlerFor,
  buildBall,
  buildOver,
  fairSequence,
  guidedStart,
  lengthBand,
  lineBand,
  randomOver,
  tapFromTarget,
  targetFromTap,
  validateOver,
  variationSpec,
  variationsFor,
} from '@/practice/game/overs';

const CONDITIONS: PitchCondition[] = ['balanced', 'green', 'hard', 'turning'];
const ASSISTS: AssistLevel[] = ['learn', 'play', 'real'];
const kindOf = (o: PracticeOverPlan, v: DeliveryVariation) => variationSpec(o.bowler.family, v)!.kind;

describe('Quick Random Over', () => {
  it('is deterministic in its seed and inputs', () => {
    for (let i = 0; i < 50; i++) {
      const opts = { seed: `det-${i}`, conditions: CONDITIONS[i % 4], assist: ASSISTS[i % 3], beginner: i % 2 === 0 };
      expect(randomOver(opts)).toEqual(randomOver({ ...opts }));
    }
    const a = randomOver({ seed: 'a', conditions: 'balanced', assist: 'play', beginner: false });
    const b = randomOver({ seed: 'b', conditions: 'balanced', assist: 'play', beginner: false });
    expect(a).not.toEqual(b);
  }, 120_000);

  it('over thousands of seeds: legal, six balls, one family, a balanced stock-heavy mix', () => {
    const families = { pace: 0, spin: 0 };
    for (let i = 0; i < 4000; i++) {
      const beginner = i % 3 === 0;
      const over = randomOver({ seed: `sweep-${i}`, conditions: CONDITIONS[i % 4], assist: ASSISTS[(i >> 2) % 3], beginner });
      const v = validateOver(over);
      expect(v.errors, `seed ${i}`).toEqual([]);
      expect(over.balls).toHaveLength(6);
      expect(over.source).toBe('random');
      families[over.bowler.family]++;
      const allowed = variationsFor(over.bowler.family, over.bowler.spinType);
      for (const b of over.balls) expect(allowed).toContain(b.variation);
      const kinds = over.balls.map((b) => kindOf(over, b.variation));
      const changes = kinds.filter((k) => k === 'change').length;
      expect(changes).toBeGreaterThanOrEqual(1);
      expect(changes).toBeLessThanOrEqual(beginner ? 1 : 2);
      expect(kinds.filter((k) => k === 'stock').length).toBeGreaterThanOrEqual(2);
      expect(over.balls.filter((b) => b.variation === 'bouncer').length).toBeLessThanOrEqual(1);
      // Never six extremes: at most two bouncers or yorkers, ever.
      expect(over.balls.filter((b) => b.variation === 'bouncer' || b.variation === 'yorker').length).toBeLessThanOrEqual(2);
      expect(fairSequence(over.balls.map((b) => b.variation), over.bowler.family, beginner)).toBe(true);
    }
    expect(families.pace).toBeGreaterThan(1000);
    expect(families.spin).toBeGreaterThan(1000);
  }, 120_000);

  it('gives a beginner a readable over: stock first, no change-ups back to back, at most one extreme', () => {
    for (let i = 0; i < 1500; i++) {
      const over = randomOver({ seed: `beg-${i}`, conditions: CONDITIONS[i % 4], assist: ASSISTS[i % 3], beginner: true });
      expect(over.balls[0].variation).toBe('stock');
      expect(over.bowler.arm).toBe('right');
      for (let k = 1; k < 6; k++) expect(kindOf(over, over.balls[k].variation) === 'change' && kindOf(over, over.balls[k - 1].variation) === 'change').toBe(false);
      expect(over.balls.filter((b) => b.variation === 'bouncer' || b.variation === 'yorker').length).toBeLessThanOrEqual(1);
      if (over.bowler.family === 'spin' && over.bowler.spinType && i % 3 === 0) expect(over.balls.some((b) => b.variation === 'wrong_un')).toBe(false);
    }
  }, 120_000);

  it('respects a requested family and leans to spin on a turner, to pace on a green top', () => {
    for (const family of ['pace', 'spin'] as BowlerFamily[]) for (let i = 0; i < 200; i++) expect(randomOver({ seed: `fam-${i}`, conditions: 'balanced', assist: 'play', family, beginner: false }).bowler.family).toBe(family);
    // 400 overs a pitch: the expected shares (0.65, 0.40, 0.25) are more than 4σ apart.
    const share = (c: PitchCondition) => Array.from({ length: 400 }, (_, i) => randomOver({ seed: `share-${i}`, conditions: c, assist: 'play', beginner: false })).filter((o) => o.bowler.family === 'spin').length;
    expect(share('turning')).toBeGreaterThan(share('balanced'));
    expect(share('balanced')).toBeGreaterThan(share('green'));
  }, 120_000);

  it('bowls honest speeds: pace bands at Play and Real, genuinely slower at Learn', () => {
    for (let i = 0; i < 600; i++) {
      const assist = ASSISTS[i % 3];
      const over = randomOver({ seed: `kph-${i}`, conditions: 'balanced', assist, beginner: false });
      const stock = over.balls.filter((b) => b.variation === 'stock').map((b) => b.speedKph);
      const range = over.bowler.family === 'pace' ? (assist === 'learn' ? LEARN_PACE_KPH : PACE_BANDS_KPH[over.bowler.paceBand!]) : assist === 'learn' ? LEARN_SPIN_KPH : SPIN_STOCK_KPH[over.bowler.spinType!];
      for (const s of stock) {
        expect(s).toBeGreaterThanOrEqual(range[0] - 1.01);
        expect(s).toBeLessThanOrEqual(range[1] + 1.01);
      }
      if (assist === 'learn' && over.bowler.family === 'pace') {
        expect(over.bowler.paceBand).toBe('controlled');
        for (const b of over.balls) expect(b.speedKph).toBeLessThan(120);
      }
      // A slower ball is 0.8 × the bowler's base speed (at most min(stock) + 1, given the ±1 km/h jitter), ±1 km/h,
      // and never below PACE_KPH's floor.
      for (const b of over.balls.filter((x) => x.variation === 'slower')) expect(b.speedKph).toBeLessThanOrEqual(Math.max(PACE_KPH[0], 0.8 * (Math.min(...stock) + 1) + 1));
      for (const b of over.balls.filter((x) => x.variation === 'slower')) expect(b.speedKph).toBeLessThan(Math.min(...stock) - 8);
    }
  }, 120_000);

  it('never asks for a speed the physics does not model', () => {
    for (const r of Object.values(SPIN_STOCK_KPH)) {
      expect(r[0]).toBeGreaterThanOrEqual(SPIN_KPH[0]);
      expect(r[1]).toBeLessThanOrEqual(SPIN_KPH[1]);
    }
    expect(SPEED_LIMITS_KPH.spin).toEqual(SPIN_KPH);
    expect(SPEED_LIMITS_KPH.pace).toEqual(PACE_KPH);
    for (let i = 0; i < 1200; i++) {
      const over = randomOver({ seed: `range-${i}`, conditions: CONDITIONS[i % 4], assist: ASSISTS[i % 3], beginner: i % 2 === 0 });
      const lim = SPEED_LIMITS_KPH[over.bowler.family];
      for (const b of over.balls) {
        expect(b.speedKph).toBeGreaterThanOrEqual(lim[0]);
        expect(b.speedKph).toBeLessThanOrEqual(lim[1]);
      }
    }
  }, 120_000);

  it('pace overs bowl pace variations and spin overs legitimate spin variations for the spin type', () => {
    for (let i = 0; i < 800; i++) {
      const over = randomOver({ seed: `types-${i}`, conditions: CONDITIONS[i % 4], assist: 'real', beginner: false });
      for (const b of over.balls) {
        if (over.bowler.family === 'pace') expect(Object.keys(PACE_VARIATIONS)).toContain(b.variation);
        else {
          expect(Object.keys(SPIN_VARIATIONS)).toContain(b.variation);
          if (over.bowler.spinType === 'finger') expect(b.variation).not.toBe('topspinner');
          if (over.bowler.spinType === 'wrist') expect(b.variation).not.toBe('arm_ball');
        }
        if (b.variation === 'bouncer') expect(b.lengthM).toBeGreaterThanOrEqual(BOUNCER_MIN_LENGTH_M);
        if (b.variation === 'yorker') expect(b.lengthM).toBeLessThanOrEqual(YORKER_MAX_LENGTH);
      }
    }
  }, 120_000);

  it('bowls real bouncers: every generated bouncer arrives between shoulder and head height (through the flight)', () => {
    let checked = 0;
    for (let i = 0; i < 600 && checked < 60; i++) {
      const conditions = CONDITIONS[i % 4];
      const over = randomOver({ seed: `bouncer-${i}`, conditions, assist: ASSISTS[1 + (i % 2)], family: 'pace', beginner: false });
      over.balls.forEach((b, k) => {
        if (b.variation !== 'bouncer') return;
        checked++;
        const h = arrivalHeight(b, over.bowler, conditions, ballSeed(over, k));
        expect(h, `seed ${i} ball ${k} on ${conditions}`).toBeGreaterThan(BOUNCER_ARRIVAL_M[0]);
        expect(h).toBeLessThan(BOUNCER_ARRIVAL_M[1]);
        expect(b.lengthM).toBeGreaterThanOrEqual(BOUNCER_MIN_LENGTH_M);
      });
    }
    expect(checked).toBeGreaterThanOrEqual(30);
  }, 120_000);

  it('a beginner at Learn is never bounced', () => {
    for (let i = 0; i < 400; i++) {
      const over = randomOver({ seed: `learn-${i}`, conditions: CONDITIONS[i % 4], assist: 'learn', family: 'pace', beginner: true });
      expect(over.balls.some((b) => b.variation === 'bouncer')).toBe(false);
    }
  }, 120_000);

  it('derives a distinct, stable physics seed for each ball', () => {
    const over = randomOver({ seed: 'seeds', conditions: 'balanced', assist: 'play', beginner: false });
    const seeds = [0, 1, 2, 3, 4, 5].map((i) => ballSeed(over, i));
    expect(new Set(seeds).size).toBe(6);
    expect(ballSeed(over, 3)).toBe(seeds[3]);
    expect(ballSeed({ seed: 'other' }, 3)).not.toBe(seeds[3]);
  });
});

describe('guided start', () => {
  it('a non-scoring warm-up stock ball, then a gentle Learn over from the same bowler', () => {
    const g = guidedStart('first');
    expect(g).toEqual(guidedStart('first'));
    expect(g.warmup.plan.variation).toBe('stock');
    expect(g.warmup.plan.speedKph).toBeLessThan(120);
    expect(typeof g.warmup.seed).toBe('string');
    expect(g.warmup.bowler).toEqual(g.over.bowler);
    expect(g.over.source).toBe('guided');
    expect(g.over.bowler).toMatchObject({ family: 'pace', paceBand: 'controlled', arm: 'right' });
    expect(validateOver(g.over).ok).toBe(true);
    for (const b of g.over.balls) expect(variationSpec('pace', b.variation)!.kind).not.toBe('change');
    expect(g.over.balls[0].variation).toBe('stock');
  });
});

describe('Build an Over', () => {
  it('lists the variations per family and spin type', () => {
    expect(variationsFor('pace')).toEqual(['stock', 'outswing', 'inswing', 'seam', 'cutter', 'slower', 'bouncer', 'yorker']);
    expect(variationsFor('spin', 'finger')).toContain('arm_ball');
    expect(variationsFor('spin', 'wrist')).toContain('topspinner');
    expect(variationsFor('spin', 'finger')[0]).toBe('stock');
  });

  it('clamps a tapped target into the legal area and gives an honest speed', () => {
    const b = buildBall({ family: 'pace', target: { lineM: 2, lengthM: 30 }, variation: 'stock', paceBand: 'express' });
    expect(b.lineM).toBe(BUILD_LIMITS.pace.lineM[1]);
    expect(b.lengthM).toBeLessThanOrEqual(BUILD_LIMITS.pace.lengthM[1]);
    expect(b.speedKph).toBeGreaterThanOrEqual(PACE_BANDS_KPH.express[0]);
    expect(b.speedKph).toBeLessThanOrEqual(PACE_BANDS_KPH.express[1]);
    const bouncer = buildBall({ family: 'pace', target: { lineM: 0, lengthM: 2 }, variation: 'bouncer', paceBand: 'fast' });
    expect(bouncer.lengthM).toBeGreaterThanOrEqual(BOUNCER_MIN_LENGTH_M);
    const yorker = buildBall({ family: 'pace', target: { lineM: 0, lengthM: 6 }, variation: 'yorker', paceBand: 'fast' });
    expect(yorker.lengthM).toBeLessThanOrEqual(YORKER_MAX_LENGTH);
    const slower = buildBall({ family: 'pace', target: { lineM: 0.1, lengthM: 5 }, variation: 'slower', paceBand: 'fast' });
    expect(slower.speedKph).toBeLessThan(buildBall({ family: 'pace', target: { lineM: 0.1, lengthM: 5 }, variation: 'stock', paceBand: 'fast' }).speedKph - 15);
    const learn = buildBall({ family: 'pace', target: { lineM: 0.1, lengthM: 5 }, variation: 'stock', paceBand: 'fast', assist: 'learn' });
    expect(learn.speedKph).toBeLessThan(PACE_BANDS_KPH.controlled[0]);
    expect(() => buildBall({ family: 'pace', target: { lineM: 0, lengthM: 5 }, variation: 'googly' as DeliveryVariation })).toThrow();
    expect(() => buildBall({ family: 'spin', spinType: 'finger', target: { lineM: 0, lengthM: 4 }, variation: 'bouncer' })).toThrow();
    expect(buildBall({ family: 'spin', spinType: 'wrist', target: { lineM: 0.1, lengthM: 4 }, variation: 'wrong_un' }).speedKph).toBeLessThan(100);
  });

  it('maps pitch-map taps to targets and back', () => {
    for (const [u, v] of [[0.3, 0.5], [0.5, 0.2], [0.7, 0.6]]) {
      const t = targetFromTap(u, v, 'pace');
      const back = tapFromTarget(t);
      expect(back.u).toBeCloseTo(u, 1);
      expect(back.v).toBeCloseTo(v, 1);
    }
    const spinTap = targetFromTap(0.5, 0.95, 'spin');
    expect(spinTap.lengthM).toBe(BUILD_LIMITS.spin.lengthM[1]);
    expect(lengthBand(0.8, 'pace')).toBe('yorker');
    expect(lengthBand(6, 'pace')).toBe('good');
    expect(lengthBand(9, 'pace')).toBe('bouncer');
    expect(lineBand(0)).toBe('middle');
    expect(lineBand(0.25)).toBe('outside_off');
    expect(lineBand(-0.25)).toBe('down_leg');
  });

  it('locks six balls in order, or shuffled once and reproducibly', () => {
    const bowler = bowlerFor({ family: 'pace', paceBand: 'fast', seed: 'b1' });
    const balls = (['stock', 'outswing', 'bouncer', 'stock', 'yorker', 'slower'] as const).map((variation, i) => buildBall({ family: 'pace', paceBand: 'fast', variation, target: { lineM: 0.05 * i, lengthM: 5 } }));
    const exact = buildOver({ bowler, balls, shuffle: false, seed: 'b1' });
    // In order; only the bouncer's length is solved (to arrive head-high), everything else is as built.
    expect(exact.balls.map((b) => ({ ...b, lengthM: b.variation === 'bouncer' ? 0 : b.lengthM }))).toEqual(balls.map((b) => ({ ...b, lengthM: b.variation === 'bouncer' ? 0 : b.lengthM })));
    expect(exact.source).toBe('built');
    expect(exact.shuffled).toBeUndefined();
    const s1 = buildOver({ bowler, balls, shuffle: true, seed: 'b1' });
    expect(s1).toEqual(buildOver({ bowler, balls, shuffle: true, seed: 'b1' }));
    expect(s1.shuffled).toBe(true);
    const key = (b: { variation: string; lineM: number; speedKph: number; lengthM: number }) => `${b.variation}|${b.lineM}|${b.speedKph}|${b.variation === 'bouncer' ? '' : b.lengthM}`;
    expect([...s1.balls].map(key).sort()).toEqual([...balls].map(key).sort());
    const shuffledSomewhere = ['b1', 'b2', 'b3', 'b4'].some((seed) => buildOver({ bowler, balls, shuffle: true, seed }).balls.map(key).join() !== balls.map(key).join());
    expect(shuffledSomewhere).toBe(true);
    expect(() => buildOver({ bowler, balls: balls.slice(0, 5), shuffle: false, seed: 'x' })).toThrow();
  });

  it('a built bouncer is solved to arrive between shoulder and head height on the innings pitch', () => {
    for (const conditions of CONDITIONS) {
      for (const paceBand of ['controlled', 'fast', 'express'] as const) {
        const bowler = bowlerFor({ family: 'pace', paceBand, seed: `bb-${paceBand}` });
        const bouncer = buildBall({ family: 'pace', paceBand, variation: 'bouncer', target: { lineM: 0.05, lengthM: 8 } });
        const stock = buildBall({ family: 'pace', paceBand, variation: 'stock', target: { lineM: 0.1, lengthM: 6 } });
        const over = buildOver({ bowler, balls: [stock, bouncer, stock, stock, stock, stock], shuffle: false, seed: `bb-${conditions}-${paceBand}`, conditions });
        const h = arrivalHeight(over.balls[1], bowler, conditions, ballSeed(over, 1));
        expect(h, `${conditions} ${paceBand}`).toBeGreaterThan(BOUNCER_ARRIVAL_M[0]);
        expect(h).toBeLessThan(BOUNCER_ARRIVAL_M[1]);
        expect(over.balls[1].lineM).toBe(0.05);
        expect(over.balls[0]).toEqual(stock);
      }
    }
  }, 120_000);

  it('validateOver rejects an illegal over: mixed families, extremes, dishonest speeds', () => {
    const bowler = bowlerFor({ family: 'pace', paceBand: 'fast', seed: 'v' });
    const ok = buildOver({ bowler, balls: Array.from({ length: 6 }, () => buildBall({ family: 'pace', paceBand: 'fast', variation: 'stock', target: { lineM: 0.1, lengthM: 6 } })), shuffle: false, seed: 'v' });
    expect(validateOver(ok)).toEqual({ ok: true, errors: [] });
    const spinBall = { variation: 'flighted' as const, lengthM: 3, lineM: 0.1, speedKph: 80 };
    expect(validateOver({ ...ok, balls: [spinBall, ...ok.balls.slice(1)] as PracticeOverPlan['balls'] }).errors).toContain('ball0:variation');
    const bouncer = { variation: 'bouncer' as const, lengthM: 9, lineM: 0, speedKph: 138 };
    expect(validateOver({ ...ok, balls: [bouncer, bouncer, bouncer, ...ok.balls.slice(3)] as PracticeOverPlan['balls'] }).errors).toContain('too_many_bouncers');
    expect(validateOver({ ...ok, balls: [{ ...ok.balls[0], speedKph: 175 }, ...ok.balls.slice(1)] as PracticeOverPlan['balls'] }).errors).toContain('ball0:speed');
    expect(validateOver({ ...ok, balls: [{ ...ok.balls[0], lineM: 1.5 }, ...ok.balls.slice(1)] as PracticeOverPlan['balls'] }).errors).toContain('ball0:line');
    expect(validateOver({ ...ok, balls: ok.balls.slice(0, 5) as unknown as PracticeOverPlan['balls'] }).ok).toBe(false);
    expect(validateOver({ ...ok, bowler: { ...ok.bowler, spinType: 'finger' } }).errors).toContain('pace_bowler_profile');
  });
});
