// @vitest-environment node
/**
 * Definition-of-done rows for the chase logic that need more than one file's tests (CHC-03, CHC-06, CHC-08): the target
 * and the deliveries do not depend on what was played before, an independent re-derivation of every field from the log of
 * hundreds of chases, and the same deliveries for every input policy.
 */
import { describe, expect, it } from 'vitest';
import type { Dismissal } from '@/contracts/practice';
import { rngFromKey } from '@/engine/prng';
import { sha256Hex } from '@/engine/sha256';
import { nextDelivery, nextFlight } from '@/practice/game';
import {
  CHASE_DIFFICULTIES,
  CHASE_MAX_TARGET,
  chaseFromInnings,
  chaseOvers,
  chaseSeedAt,
  chaseSummary,
  emptyChaseHistory,
  makeChase,
  recordChaseResult,
  startChaseInnings,
  type BallRuns,
  type ChaseDefinition,
} from '@/practice/chase';
import { BATTERS } from './batters';
import { playChase, syntheticInnings } from './helpers';

const PROBE_SEEDS = ['c000', 'c100', 'c255'];

/** Everything about a chase that is fixed before the first ball: the definition, both overs and the first delivery. */
function fixedPart(seed: string, difficulty: (typeof CHASE_DIFFICULTIES)[number]) {
  const def = makeChase(seed, difficulty)!;
  const innings = startChaseInnings(def, { id: 'probe', assist: 'play', handedness: 'right' });
  const next = nextDelivery(innings)!;
  return JSON.stringify({ def, overs: chaseOvers(def, 'right'), first: next, flight: nextFlight(next).release });
}

describe('CHC-03: the target and the deliveries come from the seed and the difficulty alone', () => {
  it('are the same after 20 earlier chases, won and lost, and a full history', () => {
    const before = PROBE_SEEDS.flatMap((s) => CHASE_DIFFICULTIES.map((d) => fixedPart(s, d)));
    let history = emptyChaseHistory();
    let wins = 0;
    let wickets = 0;
    let balls = 0;
    for (let i = 0; i < 20; i++) {
      const seed = chaseSeedAt((i * 37) % 256);
      const kind = i % 4; // win, wicket, balls, real physics
      const def: ChaseDefinition = { ...makeChase(seed, CHASE_DIFFICULTIES[i % 3])!, target: kind === 2 ? 72 : 4 };
      const innings =
        kind === 0
          ? syntheticInnings(def, [{ runs: 1 }, { runs: 6 }])
          : kind === 1
            ? syntheticInnings(def, [{ runs: 2 }, { runs: 0, dismissal: 'bowled' }])
            : kind === 2
              ? syntheticInnings(def, Array(12).fill({ runs: 1 }))
              : playChase(def, BATTERS[3 + (i % 8)][1]).innings;
      const state = chaseFromInnings(def, innings);
      if (state.result === 'won') wins++;
      if (state.result === 'lost_wicket') wickets++;
      if (state.result === 'lost_balls') balls++;
      const summary = chaseSummary(state, 'play');
      if (summary) history = recordChaseResult(history, summary, 1_000 + i);
    }
    // The twenty really were won and lost.
    expect(wins).toBeGreaterThanOrEqual(5);
    expect(wickets).toBeGreaterThanOrEqual(5);
    expect(balls).toBeGreaterThanOrEqual(5);
    expect(history.entries.length).toBeGreaterThanOrEqual(10);
    const after = PROBE_SEEDS.flatMap((s) => CHASE_DIFFICULTIES.map((d) => fixedPart(s, d)));
    expect(after).toEqual(before);
  });

  it('are not reachable by anything about play: the functions that make a chase take a seed and a difficulty only', () => {
    expect(makeChase.length).toBeLessThanOrEqual(2);
    expect(chaseOvers.length).toBeLessThanOrEqual(2);
  });
});

/** The chase's rules written again from the definition of done, with exact integers and no code in common. */
function oracle(target: number, log: ReadonlyArray<{ runs: number; wicket: boolean }>) {
  let runs = 0;
  let faced = 0;
  let result: 'in_progress' | 'won' | 'lost_wicket' | 'lost_balls' = 'in_progress';
  let deciding = 0;
  for (const b of log) {
    if (result !== 'in_progress') break;
    faced++;
    runs += b.runs;
    if (b.wicket) result = 'lost_wicket';
    else if (runs >= target) result = 'won';
    else if (faced === 12) result = 'lost_balls';
    if (result !== 'in_progress') deciding = faced;
  }
  const needed = Math.max(0, target - runs);
  const left = 12 - faced;
  // Round half up of 600 * needed / left, in hundredths of a run per over, by exact integer division.
  const rate =
    result === 'in_progress' && needed > 0 && left > 0
      ? Number((2n * 600n * BigInt(needed) + BigInt(left)) / (2n * BigInt(left)))
      : null;
  return { runs, faced, result, deciding, needed, left, rate };
}

describe('CHC-06: every field re-derived from the log of a chase (300 simulated chases)', () => {
  const RUNS: BallRuns[] = [0, 0, 0, 0, 1, 1, 1, 2, 3, 4, 6];
  const HOW: Dismissal[] = ['bowled', 'caught', 'caught_behind', 'lbw'];

  it('agrees with the independent rules after every ball, for runs, balls, result, deciding ball and required rate', () => {
    let decided = 0;
    for (let i = 0; i < 300; i++) {
      const rng = rngFromKey(`chc06|${i}`);
      const target = 1 + rng.int(0, CHASE_MAX_TARGET - 1);
      const def = { ...makeChase(chaseSeedAt(i % 256))!, target };
      const log: Array<{ runs: BallRuns; wicket: boolean; how: Dismissal | null }> = [];
      for (let k = 0; k < 12; k++) {
        const wicket = rng.float() < 0.09;
        log.push({
          runs: wicket ? 0 : RUNS[rng.int(0, RUNS.length - 1)],
          wicket,
          how: wicket ? HOW[rng.int(0, 3)] : null,
        });
      }
      // The innings the log makes (the balls after the end are never bowled), read back as a chase.
      const outcomes = log.map((b) => ({ runs: b.runs, dismissal: b.how }));
      const upTo = oracle(target, log);
      const bowled = upTo.result === 'in_progress' ? 12 : upTo.deciding;
      const innings = syntheticInnings(def, outcomes.slice(0, bowled));
      const s = chaseFromInnings(def, innings);
      expect(s.result, `chase ${i}`).toBe(upTo.result);
      expect(s.runs).toBe(upTo.runs);
      expect(s.ballsFaced).toBe(upTo.faced);
      expect(s.ballsLeft).toBe(upTo.left);
      expect(s.runsNeeded).toBe(upTo.needed);
      expect(s.requiredRateX100).toBe(upTo.rate);
      expect(s.decidingBall?.ballNumber ?? 0).toBe(upTo.deciding);
      expect(s.wicketsLost).toBe(upTo.result === 'lost_wicket' ? 1 : 0);
      if (upTo.result !== 'in_progress') decided++;
      // Every prefix too: after each ball the chase is what the rules say of the balls so far.
      for (let n = 1; n <= bowled; n++) {
        const o = oracle(target, log.slice(0, n));
        const p = chaseFromInnings(def, syntheticInnings(def, outcomes.slice(0, n)));
        expect([p.result, p.runs, p.ballsFaced, p.ballsLeft, p.runsNeeded, p.requiredRateX100]).toEqual([
          o.result,
          o.runs,
          o.faced,
          o.left,
          o.needed,
          o.rate,
        ]);
      }
    }
    expect(decided).toBeGreaterThan(150);
  });

  it('has its named cases, each on its own', () => {
    // A ball is its runs, or 'W' for a wicket.
    type B = BallRuns | 'W';
    const def = (t: number) => ({ ...makeChase('c001')!, target: t });
    const run = (t: number, ...b: B[]) =>
      chaseFromInnings(
        def(t),
        syntheticInnings(
          def(t),
          b.map((x) => (x === 'W' ? { runs: 0 as BallRuns, dismissal: 'bowled' as const } : { runs: x })),
        ),
      );
    const dots = (n: number): B[] => Array.from({ length: n }, () => 0);
    expect(run(6, 6)).toMatchObject({ result: 'won', ballsFaced: 1 }); // the winning run ends it
    expect(run(9, 1, 'W')).toMatchObject({ result: 'lost_wicket', ballsFaced: 2 }); // a wicket on ball 2
    expect(run(9, 'W')).toMatchObject({ result: 'lost_wicket', ballsFaced: 1 }); // a wicket on ball 1
    expect(run(9, ...dots(11), 'W')).toMatchObject({ result: 'lost_wicket', ballsFaced: 12 }); // a wicket on ball 12
    expect(run(9, ...dots(11), 0).result).toBe('lost_balls');
    expect(run(6, ...dots(11), 6).result).toBe('won'); // a boundary on the last ball that reaches the target
    expect(run(6, ...dots(11), 4).result).toBe('lost_balls');
    expect(run(8, 4, 4).result).toBe('won'); // exactly the target
    expect(run(9, 4, 4)).toMatchObject({ result: 'in_progress', runsNeeded: 1 }); // one short is not enough yet
    expect(run(9, ...dots(10), 4, 4).result).toBe('lost_balls'); // ... and one short after 12 balls is a loss
    expect(run(7, 6, 6).runsNeeded).toBe(0); // never below zero
    expect(run(9, 1, 'W').ballsLeft).toBe(10); // not zeroed by an early wicket
    expect(run(9, 1).requiredRateX100).toBe(Math.floor((8 * 1200 + 11) / 22));
    expect(run(9, 'W').requiredRateX100).toBeNull(); // only while in progress
  });
});

describe('CHC-08: every input policy faces the same deliveries', () => {
  /** What a delivery is, before anyone bats at it: the plan, the bowler, the field, the seeds and the flight. */
  const identity = (r: {
    plan: unknown;
    bowler: unknown;
    field: unknown;
    seed: string;
    ball: unknown;
    conditions: unknown;
  }) => sha256Hex(JSON.stringify([r.plan, r.bowler, r.field, r.seed, r.ball, r.conditions]));

  it('22 input policies bowled at one seed see the same plans, fields, seeds and balls, as far as each lasts', () => {
    expect(BATTERS.length).toBeGreaterThanOrEqual(20);
    const def: ChaseDefinition = { ...makeChase('c050')!, target: CHASE_MAX_TARGET };
    const runs = BATTERS.map(([name, batter]) => ({ name, played: playChase(def, batter, { id: name }) }));
    const longest = runs.reduce((a, b) => (b.played.records.length > a.played.records.length ? b : a));
    expect(longest.played.records.length).toBeGreaterThan(6);
    const reference = longest.played.records.map(identity);
    for (const { name, played } of runs) {
      played.records.forEach((r, i) => expect(identity(r), `${name} ball ${i + 1}`).toBe(reference[i]));
    }
    // The policies really did bat differently.
    expect(
      new Set(runs.map((r) => JSON.stringify(r.played.records.map((x) => [x.runs, x.dismissal])))).size,
    ).toBeGreaterThan(8);
  });

  it('all 12 balls are the same for 20 policies that last the whole chase (scores written in, no physics)', () => {
    const def: ChaseDefinition = { ...makeChase('c050')!, target: CHASE_MAX_TARGET };
    const sequences = new Set<string>();
    const scores = new Set<string>();
    for (let k = 0; k < 20; k++) {
      const rng = rngFromKey(`chc08|${k}`);
      const outcomes = Array.from({ length: 12 }, () => ({ runs: ([0, 1, 2, 3, 4, 6] as const)[rng.int(0, 5)] }));
      scores.add(JSON.stringify(outcomes));
      const seen: string[] = [];
      for (let b = 0; b < 12; b++) {
        // The innings after b balls with the next one started: the delivery that policy is about to face.
        const innings = syntheticInnings(def, outcomes.slice(0, b), { id: `p${k}`, inFlight: true });
        const next = nextDelivery(innings);
        if (!next) throw new Error(`no ball due after ${b}`);
        seen.push(
          sha256Hex(
            JSON.stringify([
              next.plan,
              next.bowler,
              next.field,
              next.seed,
              next.ball,
              next.conditions,
              nextFlight(next),
            ]),
          ),
        );
      }
      sequences.add(seen.join(','));
    }
    expect(scores.size).toBe(20);
    expect(sequences.size).toBe(1);
  });

  it('"Try this chase again" faces the same sequence', () => {
    const def = makeChase('c077', 'hard')!;
    const first = playChase(def, BATTERS[3][1], { id: 'first' });
    const again = playChase(def, BATTERS[14][1], { id: 'again' });
    const n = Math.min(first.records.length, again.records.length);
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) expect(identity(first.records[i])).toBe(identity(again.records[i]));
  });
});
