// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  detExp,
  expectedScore,
  isRated,
  kFactor,
  matchEligibility,
  rankTop100,
  RATING_FLOOR,
  RATING_START,
  top100DayScore,
  top100MatchScore,
  TOP100,
  updateRatings,
  type Top100MatchInput,
} from '@/engine/ranking';

const perf = (t = 0.8, c = 0.5, e = 0.75) => ({ tacticalEfficiency: t, clutch: c, execution: e });
function m(over: Partial<Top100MatchInput> = {}): Top100MatchInput {
  return {
    matchId: 'm1',
    day: '2026-10-25',
    order: 0,
    kind: 'duel',
    opponentId: 'opp',
    result: 'won',
    opponentRating: 1200,
    rating: 1200,
    performance: perf(),
    opponentPerformance: perf(),
    auto: false,
    practice: false,
    lateAnswers: [0, 0],
    timingSuspicious: [false, false],
    ...over,
  };
}

describe('deterministic maths', () => {
  it('detExp matches Math.exp to 1e-12 relative error', () => {
    for (let x = -12; x <= 12; x += 0.137) expect(Math.abs(detExp(x) / Math.exp(x) - 1)).toBeLessThan(1e-12);
  });
});

describe('Elo ratings', () => {
  it('starts at 1200 with documented K-factors', () => {
    expect(RATING_START).toBe(1200);
    expect([kFactor(0), kFactor(9), kFactor(10), kFactor(29), kFactor(30), kFactor(500)]).toEqual([40, 40, 24, 24, 16, 16]);
  });

  it('expects 50 % between equals, about 91 % at +400, and is symmetric', () => {
    expect(expectedScore(1200, 1200)).toBe(0.5);
    expect(expectedScore(1600, 1200)).toBeCloseTo(0.909, 3);
    for (const [a, b] of [
      [1000, 1300],
      [1450, 1210],
      [100, 2500],
    ])
      expect(expectedScore(a, b) + expectedScore(b, a)).toBeCloseTo(1, 12);
  });

  it('moves ratings only for real duels and cup matches', () => {
    const p = [
      { rating: 1200, ratedMatches: 40 },
      { rating: 1200, ratedMatches: 40 },
    ] as [{ rating: number; ratedMatches: number }, { rating: number; ratedMatches: number }];
    expect(updateRatings(p, { kind: 'duel', auto: false, practice: false, winner: 0 }).ratings).toEqual([1208, 1192]);
    expect(updateRatings(p, { kind: 'cup', auto: false, practice: false, winner: null }).ratings).toEqual([1200, 1200]);
    for (const blocked of [
      { kind: 'duel' as const, auto: true, practice: false },
      { kind: 'cup' as const, auto: false, practice: true },
      { kind: 'ghost' as const, auto: false, practice: false },
      { kind: 'daily' as const, auto: false, practice: false },
      { kind: 'training' as const, auto: false, practice: false },
    ]) {
      expect(isRated(blocked)).toBe(false);
      expect(updateRatings(p, { ...blocked, winner: 0 })).toEqual({ ratings: [1200, 1200], rated: false });
    }
  });

  it('rewards upsets more, uses each side’s own K and never falls below the floor', () => {
    const upset = updateRatings(
      [
        { rating: 1000, ratedMatches: 50 },
        { rating: 1400, ratedMatches: 50 },
      ],
      { kind: 'duel', auto: false, practice: false, winner: 0 },
    );
    expect(upset.ratings[0] - 1000).toBeGreaterThan(14);
    const newbie = updateRatings(
      [
        { rating: 1200, ratedMatches: 2 },
        { rating: 1200, ratedMatches: 100 },
      ],
      { kind: 'duel', auto: false, practice: false, winner: 0 },
    );
    expect(newbie.ratings).toEqual([1220, 1192]);
    const floor = updateRatings(
      [
        { rating: RATING_FLOOR, ratedMatches: 0 },
        { rating: 1200, ratedMatches: 0 },
      ],
      { kind: 'duel', auto: false, practice: false, winner: 1 },
    );
    expect(floor.ratings[0]).toBe(RATING_FLOOR);
  });
});

describe('Top 100 match score', () => {
  it('combines win, opponent strength, tactics, importance, clutch and execution into 0–100', () => {
    const s = top100MatchScore(m());
    expect(s.eligible).toBe(true);
    expect(s.competitive).toBe(true);
    // 0.25·1 + 0.15·0.5 + 0.20·0.6 + 0.10·0.4 + 0.15·0.375 + 0.15·0.583…
    expect(s.score).toBeCloseTo(100 * (0.25 + 0.075 + 0.2 * 0.6 + 0.1 * 0.4 + 0.15 * 0.375 + 0.15 * (0.35 / 0.6)), 1);
    expect(top100MatchScore(m({ result: 'lost' })).score).toBeLessThan(s.score - 30);
    const perfect = top100MatchScore(m({ kind: 'cup', stage: 'final', performance: perf(1, 1, 1), opponentRating: 2000 }));
    expect(perfect.score).toBeLessThanOrEqual(100);
    expect(perfect.score).toBeGreaterThan(95);
  });

  it('values cup finals over cup groups over duels, and beating stronger opponents', () => {
    const duel = top100MatchScore(m()).score;
    const group = top100MatchScore(m({ kind: 'cup', stage: 'group' })).score;
    const final = top100MatchScore(m({ kind: 'cup', stage: 'final' })).score;
    expect(duel).toBeLessThan(group);
    expect(group).toBeLessThan(final);
    expect(top100MatchScore(m({ opponentRating: 1500 })).score).toBeGreaterThan(top100MatchScore(m({ opponentRating: 900 })).score);
  });

  it('makes matches ineligible for Auto sides, practice, late answers, failed timing audits and non-match kinds', () => {
    expect(matchEligibility(m({ auto: true }))).toEqual(['auto']);
    expect(matchEligibility(m({ practice: true }))).toEqual(['practice']);
    expect(matchEligibility(m({ lateAnswers: [2, 0] }))).toEqual(['late_answers']);
    expect(matchEligibility(m({ lateAnswers: [0, 3] }))).toEqual(['late_answers']);
    expect(matchEligibility(m({ lateAnswers: [1, 1] }))).toEqual([]);
    expect(matchEligibility(m({ timingSuspicious: [false, true] }))).toEqual(['timing_audit']);
    expect(matchEligibility(m({ kind: 'ghost' }))).toEqual(['kind']);
    expect(top100MatchScore(m({ auto: true })).score).toBe(0);
  });

  it('gives no win credit against an opponent who clearly did not try', () => {
    const tank = top100MatchScore(m({ opponentPerformance: perf(0.4, 0.3, 0.6) }));
    expect(tank.competitive).toBe(false);
    expect(tank.components.wins).toBe(0);
    expect(tank.components.opponentStrength).toBe(0);
    // Relative drop against the opponent's own baseline catches softer tanking.
    expect(top100MatchScore(m({ opponentPerformance: perf(0.6) }), 0.85).competitive).toBe(false);
    expect(top100MatchScore(m({ opponentPerformance: perf(0.7) }), 0.85).competitive).toBe(true);
  });

  it('never reads purchases, adverts or cosmetics', () => {
    const base = top100MatchScore(m());
    const bought = top100MatchScore({ ...m(), purchases: 9999, adsWatched: 50, kit: 'gold', vip: true } as unknown as Top100MatchInput);
    expect(bought).toEqual(base);
  });
});

describe('Top 100 day score', () => {
  const day = '2026-10-25';
  const series = (n: number, over: (k: number) => Partial<Top100MatchInput> = () => ({})) =>
    Array.from({ length: n }, (_, k) => m({ matchId: `m${k}`, order: k, opponentId: `opp${k}`, result: k % 2 ? 'lost' : 'won', ...over(k) }));

  it('counts the best three of the first five eligible matches', () => {
    const s = top100DayScore('me', day, series(5));
    expect(s.counted).toHaveLength(3);
    expect(s.counted.every((c) => c.components.wins === 1)).toBe(true);
    // A sixth, seventh… match can never change the score, however good.
    const more = series(5).concat(series(4).map((x, k) => ({ ...x, matchId: `late${k}`, order: 5 + k, result: 'won' as const, performance: perf(1, 1, 1), opponentRating: 2000 })));
    expect(top100DayScore('me', day, more).score).toBe(s.score);
    expect(top100DayScore('me', day, more).all.filter((x) => x.reasons.includes('outside_window'))).toHaveLength(4);
  });

  it('caps matches against the same opponent at two a day', () => {
    const s = top100DayScore('me', day, series(4, () => ({ opponentId: 'buddy', result: 'won' })));
    expect(s.counted).toHaveLength(2);
    expect(s.all.filter((x) => x.reasons.includes('repeat_opponent'))).toHaveLength(2);
  });

  it('uses play order, not array order, and ignores other days', () => {
    const shuffled = series(5).reverse();
    expect(top100DayScore('me', day, shuffled).score).toBe(top100DayScore('me', day, series(5)).score);
    expect(top100DayScore('me', '2026-10-26', series(5)).score).toBe(0);
  });
});

describe('rankTop100', () => {
  const p = (id: string, results: Array<'won' | 'lost'>, tac = 0.8) => ({
    playerId: id,
    alias: id.toUpperCase(),
    day: '2026-10-25',
    matches: results.map((r, k) => m({ matchId: `${id}-${k}`, order: k, opponentId: `${id}-opp${k}`, result: r, performance: perf(tac) })),
  });

  it('ranks by day score with stable, time-free tie-breaks', () => {
    const entries = rankTop100([p('carol', ['won', 'lost', 'lost']), p('alice', ['won', 'won', 'won']), p('bob', ['won', 'won', 'won']), p('dave', ['lost', 'lost', 'lost'], 0.6)]);
    expect(entries.map((e) => e.playerId)).toEqual(['alice', 'bob', 'carol', 'dave']);
    expect(entries.map((e) => e.rank)).toEqual([1, 2, 3, 4]);
    expect(entries[0].matchIds).toHaveLength(3);
    expect(entries[0].components.wins).toBe(3);
    expect(rankTop100([p('alice', ['won']), p('bob', ['won'])], 1)).toHaveLength(1);
    expect(rankTop100([{ playerId: 'z', alias: 'Z', day: '2026-10-25', matches: [m({ auto: true })] }])).toEqual([]);
  });

  it('a long-term effort baseline unmasks a partner who throws matches quietly', () => {
    const a = { playerId: 'A', alias: 'A', day: '2026-10-25', matches: [m({ matchId: 'x1', opponentId: 'B', opponentPerformance: perf(0.6) }), m({ matchId: 'x2', order: 1, opponentId: 'B', opponentPerformance: perf(0.6) })] };
    const without = rankTop100([a]);
    const withBaseline = rankTop100([a], 100, new Map([['B', 0.85]]));
    expect(withBaseline[0].score).toBeLessThan(without[0].score);
    expect(withBaseline[0].components.wins).toBe(0);
    expect(TOP100.window).toBe(5);
  });
});
