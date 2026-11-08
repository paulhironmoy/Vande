// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { rngFromKey } from '@/engine/prng';
import { CHASE_DIFFICULTIES, CHASE_MAX_RUNS_PER_BALL, CHASE_MAX_TARGET } from '@/practice/chase';
import {
  DERIVATION_POLICY_VERSIONS,
  MIN_CHANCE,
  MIN_TARGET,
  TIER_FLOOR,
  QUADRATURE_Z,
  REFERENCE_POLICY,
  REFERENCE_SIGMA_MS,
  TIER_SHARE,
  optimalChase,
  pmfFromOutcomes,
  targetAtShare,
  targetsOf,
  tierTarget,
  winProbability,
  type BallChoices,
  type OutcomePmf,
} from '@/practice/chase/derive';

/** Φ, by the Abramowitz and Stegun 7.1.26 formula for erf (error below 1.5e-7). */
function phi(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return 0.5 * (1 + (z < 0 ? -erf : erf));
}

/** A random outcome table: some chance of each run value and of a dismissal, summing to one. */
function randomPmf(rng: ReturnType<typeof rngFromKey>): OutcomePmf {
  const w = [0, 1, 2, 3, 4, 5, 6].map((r) => (r === 5 ? 0 : 0.05 + rng.float() ** 2));
  const out = rng.float() * 0.1;
  const total = w.reduce((a, b) => a + b, 0) + out;
  return { run: w.map((x) => x / total), out: out / total };
}

describe("the reference batter's timing errors", () => {
  it('are 24 equally likely points of the normal curve, in order, symmetric, with zero mean', () => {
    expect(QUADRATURE_Z).toHaveLength(24);
    for (let j = 1; j < 24; j++) expect(QUADRATURE_Z[j]).toBeGreaterThan(QUADRATURE_Z[j - 1]);
    for (let j = 0; j < 12; j++) expect(QUADRATURE_Z[23 - j]).toBeCloseTo(-QUADRATURE_Z[j], 9);
    expect(QUADRATURE_Z.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 9);
  });

  it('are the quantiles Φ⁻¹((j + 0.5) / 24): each point sits at the middle of its share of the curve', () => {
    QUADRATURE_Z.forEach((z, j) => expect(phi(z)).toBeCloseTo((j + 0.5) / 24, 6));
  });

  it('are spread like the curve: about one standard deviation overall', () => {
    const variance = QUADRATURE_Z.reduce((a, z) => a + z * z, 0) / 24;
    expect(variance).toBeGreaterThan(0.85);
    expect(variance).toBeLessThan(1.05);
  });

  it('name the reference batter: 20 ms, with three shares and three floors (ruling R-34) and a minimum chance (R-44)', () => {
    expect(REFERENCE_SIGMA_MS).toBe(20);
    expect(TIER_SHARE).toEqual({ easy: 0.8, standard: 0.6, hard: 0.25 });
    // Pinned value changed from version 1 to 2 on purpose: ruling R-44 added the minimum chance and the order rule, which
    // change six Hard targets (the shares, floors and timing are the ones of version 1).
    expect(REFERENCE_POLICY).toEqual({ id: 'best-play-timing-20', version: 2 });
    expect(DERIVATION_POLICY_VERSIONS).toContain(REFERENCE_POLICY.version);
    expect(DERIVATION_POLICY_VERSIONS).toContain(1);
    expect(TIER_FLOOR).toEqual({ easy: 7, standard: 10, hard: 14 });
    expect(MIN_CHANCE).toBe(0.1);
    expect(MIN_TARGET).toBe(7);
    // No target is one ball's work: a ball scores at most six.
    expect(TIER_FLOOR.easy).toBeGreaterThan(6);
    expect(MIN_TARGET).toBe(CHASE_MAX_RUNS_PER_BALL + 1);
    for (const d of CHASE_DIFFICULTIES) expect(TIER_FLOOR[d]).toBeGreaterThanOrEqual(MIN_TARGET);
  });
});

describe('outcome tables', () => {
  it('count equally likely outcomes, a dismissal carrying no runs', () => {
    const p = pmfFromOutcomes([
      { runs: 4, out: false },
      { runs: 4, out: false },
      { runs: 0, out: true },
      { runs: 1, out: false },
    ]);
    expect(p.run[4]).toBeCloseTo(0.5, 12);
    expect(p.run[1]).toBeCloseTo(0.25, 12);
    expect(p.run[0]).toBe(0);
    expect(p.out).toBeCloseTo(0.25, 12);
    expect(p.run.reduce((a, b) => a + b, 0) + p.out).toBeCloseTo(1, 12);
  });
});

describe('best play against a target', () => {
  it('is exact: with no choice it is the chance that the runs of the balls reach the target', () => {
    // Forward convolution of one fixed response per ball, written independently of the backward program.
    const rng = rngFromKey('derive|forward');
    for (let trial = 0; trial < 40; trial++) {
      const n = 3 + rng.int(0, 5);
      const balls: BallChoices[] = Array.from({ length: n }, () => [randomPmf(rng)]);
      let alive = new Array<number>(80).fill(0);
      alive[0] = 1;
      const out = new Array<number>(80).fill(0);
      for (const [i] of balls.entries()) {
        const next = new Array<number>(80).fill(0);
        for (let t = 0; t < 60; t++) {
          if (!alive[t]) continue;
          out[t] += alive[t] * balls[i][0].out;
          for (let r = 0; r <= 6; r++) next[t + r] += alive[t] * balls[i][0].run[r];
        }
        alive = next;
      }
      const total = alive.map((a, t) => a + out[t]);
      for (const target of [1, 3, 6, 10]) {
        const expected = total.slice(target).reduce((a, b) => a + b, 0);
        expect(winProbability(balls, target)).toBeCloseTo(expected, 10);
      }
    }
  });

  it('is the best of every way of choosing, found by trying them all', () => {
    // Three balls, two responses each, a target of four: try every rule that picks a response from (ball, runs needed).
    const rng = rngFromKey('derive|exhaustive');
    for (let trial = 0; trial < 12; trial++) {
      const balls: BallChoices[] = Array.from({ length: 3 }, () => [randomPmf(rng), randomPmf(rng)]);
      const target = 4;
      // A rule is a table: for each ball and each need 1..4, which response (0 or 1). 12 choices = 4096 rules.
      let best = 0;
      for (let rule = 0; rule < 1 << 12; rule++) {
        const pick = (i: number, need: number) => (rule >> (i * 4 + (need - 1))) & 1;
        const value = (i: number, need: number): number => {
          if (need <= 0) return 1;
          if (i === 3) return 0;
          const p = balls[i][pick(i, need)];
          let v = 0;
          for (let r = 0; r <= 6; r++) if (p.run[r]) v += p.run[r] * value(i + 1, need - r);
          return v;
        };
        best = Math.max(best, value(0, target));
      }
      expect(winProbability(balls, target)).toBeCloseTo(best, 10);
    }
  });

  it('never does worse than any single response played all the way, and picks by the runs still needed', () => {
    // Response 0: safe singles. Response 1: a lottery of sixes. With few balls left and many runs to get, the lottery wins.
    const safe: OutcomePmf = { run: [0, 1, 0, 0, 0, 0, 0], out: 0 };
    const lottery: OutcomePmf = { run: [0.5, 0, 0, 0, 0, 0, 0.5], out: 0 };
    const balls: BallChoices[] = Array.from({ length: 12 }, () => [safe, lottery]);
    const o = optimalChase(balls, 12);
    // 12 safe singles reach 12 for certain; the lottery cannot beat certainty.
    expect(o.win).toBeCloseTo(1, 12);
    expect(o.choice[0][12]).toBe(0);
    // Needing 18 off 12 balls, the singles can never do it; the sixes can (3 of 12 balls).
    const o18 = optimalChase(balls, 18);
    expect(o18.win).toBeGreaterThan(0.9);
    // Needing 6 with one ball left only the lottery can do it.
    expect(o18.choice[11][6]).toBe(1);
    expect(o18.choice[11][1]).toBe(0);
  });

  it('can only fall as the target rises, and is certain for a target of zero or less', () => {
    const rng = rngFromKey('derive|monotone');
    for (let trial = 0; trial < 30; trial++) {
      const balls: BallChoices[] = Array.from({ length: 12 }, () => [randomPmf(rng), randomPmf(rng), randomPmf(rng)]);
      let last = 1;
      for (let t = 1; t <= 72; t++) {
        const w = winProbability(balls, t);
        expect(w).toBeLessThanOrEqual(last + 1e-12);
        expect(w).toBeGreaterThanOrEqual(0);
        last = w;
      }
      expect(winProbability(balls, 72)).toBeLessThan(1e-4);
    }
  });
});

describe('a target for a share', () => {
  it('is the largest target the reference batter still reaches at least that often', () => {
    const rng = rngFromKey('derive|share');
    for (let trial = 0; trial < 25; trial++) {
      const balls: BallChoices[] = Array.from({ length: 12 }, () => [randomPmf(rng), randomPmf(rng)]);
      for (const share of [0.8, 0.5, 0.25, 0.05]) {
        const t = targetAtShare(balls, share, 1);
        expect(t.floored).toBe(false);
        expect(t.win).toBeGreaterThanOrEqual(share - 1e-9);
        expect(winProbability(balls, t.target + 1)).toBeLessThan(share);
        expect(t.win).toBeCloseTo(winProbability(balls, t.target), 12);
      }
    }
  });

  it('is raised to the floor when the share is reached only below it, and says so', () => {
    // A ball set that scores one run a ball: 12 runs for sure, nothing more.
    const singles: BallChoices[] = Array.from({ length: 12 }, () => [{ run: [0, 1, 0, 0, 0, 0, 0], out: 0 }]);
    expect(targetAtShare(singles, 0.5, 1)).toMatchObject({ target: 12, win: 1, floored: false });
    const poor: BallChoices[] = Array.from({ length: 12 }, () => [{ run: [0, 0, 0, 0, 0, 0, 0], out: 1 }]);
    const t = targetAtShare(poor, 0.8, TIER_FLOOR.easy);
    expect(t).toMatchObject({ target: TIER_FLOOR.easy, win: 0, floored: true });
    // Unfloored (floor 1) the answer for a batter who can never score is the smallest target.
    expect(targetAtShare(poor, 0.8, 1).target).toBe(1);
  });

  it('gives three tiers that rise strictly as the tier gets harder', () => {
    // Strengthened for ruling R-44 (was: never fall): the order rule makes Easy < Standard < Hard hold for every ball set.
    const rng = rngFromKey('derive|tiers');
    for (let trial = 0; trial < 25; trial++) {
      const balls: BallChoices[] = Array.from({ length: 12 }, () => [randomPmf(rng), randomPmf(rng)]);
      const t = targetsOf(balls);
      expect(t.easy.target).toBeLessThan(t.standard.target);
      expect(t.standard.target).toBeLessThan(t.hard.target);
      expect(t.easy.win).toBeGreaterThanOrEqual(t.standard.win - 1e-12);
      expect(t.standard.win).toBeGreaterThanOrEqual(t.hard.win - 1e-12);
    }
  });

  it('wants exactly 12 balls', () => {
    expect(() => targetsOf([[randomPmf(rngFromKey('x'))]])).toThrow(RangeError);
  });

  it('is the same every time (no random number is drawn)', () => {
    const rng = rngFromKey('derive|same');
    const balls: BallChoices[] = Array.from({ length: 12 }, () => [randomPmf(rng), randomPmf(rng)]);
    expect(JSON.stringify(targetsOf(balls))).toBe(JSON.stringify(targetsOf(balls)));
  });
});

/** Twelve balls, each a six or a dot ball with chance one half and no wicket: the total is 6 x Binomial(12, 1/2), so every chance is exact. */
const sixOrDot = (): BallChoices[] => Array.from({ length: 12 }, () => [{ run: [0.5, 0, 0, 0, 0, 0, 0.5], out: 0 }]);
/** Twelve balls that always score one run: 12 for certain, never 13. */
const singles = (): BallChoices[] => Array.from({ length: 12 }, () => [{ run: [0, 1, 0, 0, 0, 0, 0], out: 0 }]);
/** Twelve balls on which the batter is always out: no run is ever scored. */
const wickets = (): BallChoices[] => Array.from({ length: 12 }, () => [{ run: [0, 0, 0, 0, 0, 0, 0], out: 1 }]);

describe('the minimum chance (ruling R-44)', () => {
  // sixOrDot(): P(total >= 6k) = P(Binomial(12, 1/2) >= k): k=7 1586/4096 (38.7%), k=8 794/4096 (19.4%), k=9 299/4096 (7.3%),
  // k=10 79/4096 (1.9%), k=11 13/4096. So the largest target reached at least 10% of the time is 48 (k = 8).
  it('leaves a tier alone when the reference batter reaches its share-and-floor answer at least 10% of the time', () => {
    const t = tierTarget(sixOrDot(), 0.25, 7);
    expect(t).toEqual({ target: 42, win: 1586 / 4096, floored: false, lowered: false, raised: false });
    expect(t).toEqual(targetAtShare(sixOrDot(), 0.25, 7));
    // The same for a floor that raised the answer to a target he still reaches 10% of the time (19.4%).
    expect(tierTarget(sixOrDot(), 0.25, 45)).toEqual({
      target: 45,
      win: 794 / 4096,
      floored: true,
      lowered: false,
      raised: false,
    });
  });

  it('lowers a tier to the largest target he reaches at least 10% of the time, and no further', () => {
    // A share of 1% would ask for 60 (reached 1.9% of the time): below the line, so the answer is 48 (19.4%).
    const t = tierTarget(sixOrDot(), 0.01, 7);
    expect(t).toEqual({ target: 48, win: 794 / 4096, floored: false, lowered: true, raised: false });
    expect(t.win).toBeGreaterThanOrEqual(MIN_CHANCE);
    expect(winProbability(sixOrDot(), t.target + 1)).toBeLessThan(MIN_CHANCE);
  });

  it('also lowers a target that the floor had raised (the case of the Hard seeds), and says both', () => {
    // 25% asks for 42; the floor of 60 raises it to a target reached 1.9% of the time; the rule brings it down to 48.
    expect(tierTarget(sixOrDot(), 0.25, 60)).toEqual({
      target: 48,
      win: 794 / 4096,
      floored: true,
      lowered: true,
      raised: false,
    });
  });

  it('uses the exact chance, not the rounded percent: 9.96% is below the line, 10.04% is not', () => {
    // Eleven balls give one run each; the first is a six or a dot ball. The total is 17 with chance p and 11 otherwise.
    const oneBallDecides = (p: number): BallChoices[] => [
      [{ run: [1 - p, 0, 0, 0, 0, 0, p], out: 0 }],
      ...Array.from({ length: 11 }, () => [{ run: [0, 1, 0, 0, 0, 0, 0], out: 0 }]),
    ];
    // Both chances round to 10 %, which is what a table of rounded percents would show.
    expect(Math.round(100 * 0.0996)).toBe(10);
    expect(Math.round(100 * 0.1004)).toBe(10);
    const below = tierTarget(oneBallDecides(0.0996), 0.05, 17);
    expect(below).toMatchObject({ target: 11, win: 1, lowered: true });
    const above = tierTarget(oneBallDecides(0.1004), 0.05, 17);
    expect(above.target).toBe(17);
    expect(above.win).toBeCloseTo(0.1004, 12);
    expect(above.lowered).toBe(false);
  });

  it('never goes below 7 (6 + 1), whatever floor is asked for', () => {
    // He never scores: every target has a chance of zero, so there is no target he reaches 10% of the time.
    expect(tierTarget(wickets(), 0.8, 14)).toEqual({ target: 7, win: 0, floored: true, lowered: true, raised: false });
    // Even a floor of 1 cannot let a target below 7 through; the answer stays at 7 (it cannot be lowered further).
    expect(tierTarget(wickets(), 0.8, 1)).toEqual({ target: 7, win: 0, floored: true, lowered: false, raised: false });
    expect(tierTarget(singles(), 0.8, 1).target).toBe(12);
  });
});

describe('the order rule (ruling R-44)', () => {
  it('keeps every tier of a ball set that is reached often enough exactly as the shares and floors give it', () => {
    const t = targetsOf(sixOrDot());
    expect([t.easy.target, t.standard.target, t.hard.target]).toEqual([30, 36, 42]);
    for (const d of CHASE_DIFFICULTIES) expect(t[d]).toMatchObject({ floored: false, lowered: false, raised: false });
  });

  it('puts a tier one above the easier one when the rules left them level, and says so', () => {
    // A batter who scores exactly 12 off 12 balls: Easy and Standard would both be 12 and Hard (floor 14) is out of reach.
    const t = targetsOf(singles());
    expect([t.easy.target, t.standard.target, t.hard.target]).toEqual([12, 13, 14]);
    expect(t.easy).toMatchObject({ win: 1, raised: false });
    expect(t.standard).toMatchObject({ win: 0, raised: true, lowered: false });
    // Hard: the floor raised it to 14, the minimum-chance rule lowered it to 12, the order rule put it above Standard.
    expect(t.hard).toMatchObject({ win: 0, floored: true, lowered: true, raised: true });
  });

  it('keeps the three tiers apart even when nothing can be scored', () => {
    const t = targetsOf(wickets());
    expect([t.easy.target, t.standard.target, t.hard.target]).toEqual([7, 8, 9]);
    expect([t.easy.win, t.standard.win, t.hard.win]).toEqual([0, 0, 0]);
  });
});

describe('the three tiers, checked against the rule written out plainly', () => {
  /** A ball set that scores little: mostly dot balls, so the floors are out of reach and the minimum chance matters. */
  function poorPmf(rng: ReturnType<typeof rngFromKey>, dots: number): OutcomePmf {
    const w = [0, 1, 2, 3, 4, 5, 6].map((r) => (r === 5 ? 0 : r === 0 ? dots : 0.05 + rng.float() ** 2));
    const out = rng.float() * 0.2;
    const total = w.reduce((a, b) => a + b, 0) + out;
    return { run: w.map((x) => x / total), out: out / total };
  }

  /** The rule as the ruling words it, from the chance of every target (no use of tierTarget or targetAtShare). */
  function expectedTargets(balls: BallChoices[]) {
    const chance = Array.from({ length: CHASE_MAX_TARGET + 1 }, (_, t) => (t === 0 ? 1 : winProbability(balls, t)));
    const lastReaching = (share: number) => {
      let last = 0;
      for (let t = 1; t <= CHASE_MAX_TARGET && chance[t] + 1e-12 >= share; t++) last = t;
      return last;
    };
    const tiers = ['easy', 'standard', 'hard'] as const;
    const out = {} as Record<(typeof tiers)[number], number>;
    let below = 0;
    for (const d of tiers) {
      let target = Math.max(lastReaching(TIER_SHARE[d]), TIER_FLOOR[d], MIN_TARGET);
      if (chance[target] + 1e-12 < MIN_CHANCE)
        target = Math.min(target, Math.max(lastReaching(MIN_CHANCE), MIN_TARGET));
      if (d !== 'easy' && target <= below) target = below + 1;
      out[d] = target;
      below = target;
    }
    return out;
  }

  it('gives, for 150 ball sets from rich to poor, what the ruling says, and uses every part of the rule', () => {
    const rng = rngFromKey('derive|r44');
    const seen = { lowered: 0, raised: 0, floored: 0, plain: 0, atMinimum: 0 };
    for (let trial = 0; trial < 150; trial++) {
      const dots = [0, 4, 12, 30, 80][trial % 5];
      const balls: BallChoices[] = Array.from({ length: 12 }, () => [poorPmf(rng, dots), poorPmf(rng, dots)]);
      const got = targetsOf(balls);
      const want = expectedTargets(balls);
      expect(
        { easy: got.easy.target, standard: got.standard.target, hard: got.hard.target },
        `trial ${trial} (dot weight ${dots})`,
      ).toEqual(want);
      for (const d of CHASE_DIFFICULTIES) {
        const t = got[d];
        expect(t.win).toBeCloseTo(winProbability(balls, t.target), 12);
        expect(t.target).toBeGreaterThanOrEqual(MIN_TARGET);
        // A target is reached at least 10% of the time unless it is the least a target can be, or the order rule raised it.
        if (!t.raised && t.target > MIN_TARGET) expect(t.win).toBeGreaterThanOrEqual(MIN_CHANCE - 1e-9);
        // A lowered target is the largest one that is: the next is under the line (unless the order rule raised it).
        if (t.lowered && !t.raised && t.target > MIN_TARGET)
          expect(winProbability(balls, t.target + 1)).toBeLessThan(MIN_CHANCE);
        // Untouched by the rule, a tier is the answer of the share and the floor, as in version 1.
        if (!t.lowered && !t.raised) expect(t.target).toBe(targetAtShare(balls, TIER_SHARE[d], TIER_FLOOR[d]).target);
        if (t.lowered) seen.lowered++;
        if (t.raised) seen.raised++;
        if (t.floored) seen.floored++;
        if (!t.lowered && !t.raised && !t.floored) seen.plain++;
        if (t.target === MIN_TARGET) seen.atMinimum++;
      }
      expect(got.easy.target).toBeLessThan(got.standard.target);
      expect(got.standard.target).toBeLessThan(got.hard.target);
    }
    // The trials are not vacuous: every branch of the rule ran.
    for (const [branch, n] of Object.entries(seen)) expect(n, branch).toBeGreaterThan(0);
  });
});
