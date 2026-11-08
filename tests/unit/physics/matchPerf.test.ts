import { describe, expect, it } from 'vitest';
import { aimShot } from '@/physics/aim';
import { flightFromPath } from '@/physics/matchPath';
import { cpuMicros, skipOverBudgetWhenLoaded } from '../support/timing';
import { type BenchBall, matchBenchFixture } from './match-bench-fixture';

function runBall(b: BenchBall): void {
  const f = flightFromPath(b.path, b.opts);
  for (const a of b.aims) aimShot(a.from ?? { t: f.idealContactT, p: b.contact }, a.target, a.opts);
}

describe('match physics performance', () => {
  it('builds a ball script (flightFromPath and its aimShot calls) inside the per-ball budget', (ctx) => {
    // The budget is 3 ms per ball on an M1 Pro (scripts/match-physics-bench.mjs enforces it). This test keeps generous
    // CI headroom: each ball's best of five warm runs, median across balls, under 8 ms (the old solvers took ≈ 10 ms).
    // Each run is timed in CPU time of the thread (tests/unit/support/timing.ts), so a busy machine does not count as work.
    // The budget is exact; only an overrun on a machine above load 20 is skipped, by name (a quiet machine fails it).
    const BUDGET_MS = 8;
    const balls = matchBenchFixture();
    for (const b of balls) runBall(b);
    const best = balls.map(() => Infinity);
    for (let r = 0; r < 5; r++) {
      balls.forEach((b, i) => {
        const t0 = cpuMicros();
        runBall(b);
        best[i] = Math.min(best[i], (cpuMicros() - t0) / 1000);
      });
    }
    const sorted = [...best].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    console.info(
      `match physics: ${balls.length} balls, per-ball median ${median.toFixed(2)} ms CPU (best of 5), worst ${sorted.at(-1)!.toFixed(2)} ms`,
    );
    skipOverBudgetWhenLoaded(ctx, 'match physics, per-ball median', median, BUDGET_MS, 'ms');
    expect(median).toBeLessThan(BUDGET_MS);
  }, 120_000);
});
