// @vitest-environment node
/**
 * CHC-02: the golden set. `fixtures/golden.json` holds 320 (seed, difficulty, input policy, assistance, hand) tuples and the
 * canonical result of each (made by `node scripts/chase-golden.mjs generate`). The same tuples give the same results in
 * Node (here: a sample, the rest by `chase-golden.mjs check`) and in headless Chromium (`chase-golden.mjs chromium`).
 * A new target table, a physics change or a rule change moves the hashes: regenerate the set then, on purpose.
 */
import { describe, expect, it } from 'vitest';
import { BATTERS } from './batters';
import { goldenTuples, runTuple, type GoldenResult, type GoldenTuple } from './golden';
import golden from './fixtures/golden.json';

const rows = golden.rows as Array<GoldenTuple & GoldenResult>;

describe('the golden set (CHC-02)', () => {
  it('is 320 tuples (at least 315 different) that cover every pool seed, every policy, difficulty, assistance and both hands', () => {
    expect(rows).toHaveLength(320);
    // Drawn tuples can coincide by chance (two of the 320 do); the set is still at least 315 different ones.
    expect(
      new Set(rows.map((r) => JSON.stringify([r.seed, r.difficulty, r.policy, r.assist, r.hand]))).size,
    ).toBeGreaterThanOrEqual(315);
    expect(new Set(rows.map((r) => r.seed)).size).toBeGreaterThanOrEqual(250);
    expect(new Set(rows.map((r) => r.policy)).size).toBe(BATTERS.length);
    expect(new Set(rows.map((r) => r.difficulty))).toEqual(new Set(['easy', 'standard', 'hard']));
    expect(new Set(rows.map((r) => r.assist))).toEqual(new Set(['learn', 'play', 'real']));
    expect(new Set(rows.map((r) => r.hand))).toEqual(new Set(['left', 'right']));
    expect(new Set(rows.map((r) => r.result)).size).toBeGreaterThanOrEqual(3);
  });

  it('is what the tuple generator makes', () => {
    const again = goldenTuples(320);
    again.forEach((t, i) =>
      expect([t.seed, t.difficulty, t.policy, t.assist, t.hand]).toEqual([
        rows[i].seed,
        rows[i].difficulty,
        rows[i].policy,
        rows[i].assist,
        rows[i].hand,
      ]),
    );
  });

  it('plays again to the recorded results (a sample of 24 spread across the set)', () => {
    for (let k = 0; k < 24; k++) {
      const row = rows[Math.floor((k * rows.length) / 24)];
      const got = runTuple(row);
      expect(got, `${row.seed} ${row.difficulty} ${row.policy} ${row.assist} ${row.hand}`).toEqual({
        result: row.result,
        runs: row.runs,
        ballsFaced: row.ballsFaced,
        hash: row.hash,
      });
    }
  });
});
