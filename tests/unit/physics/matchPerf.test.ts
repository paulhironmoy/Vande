import { describe, expect, it } from 'vitest';
import { aimShot } from '@/physics/aim';
import { flightFromPath } from '@/physics/matchPath';
import { type BenchBall, matchBenchFixture } from './match-bench-fixture';

function runBall(b: BenchBall): void {
  const f = flightFromPath(b.path, b.opts);
  for (const a of b.aims) aimShot(a.from ?? { t: f.idealContactT, p: b.contact }, a.target, a.opts);
}

describe('match physics performance', () => {
  it('builds a ball script (flightFromPath and its aimShot calls) inside the per-ball budget', () => {
    // The budget is 3 ms per ball on an M1 Pro (scripts/match-physics-bench.mjs enforces it). This test keeps generous
    // CI headroom: each ball's best of five warm runs, median across balls, under 8 ms (the old solvers took ≈ 10 ms).
    const balls = matchBenchFixture();
    for (const b of balls) runBall(b);
    const best = balls.map(() => Infinity);
    for (let r = 0; r < 5; r++) {
      balls.forEach((b, i) => {
        const t0 = performance.now();
        runBall(b);
        best[i] = Math.min(best[i], performance.now() - t0);
      });
    }
    const sorted = [...best].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    console.info(`match physics: ${balls.length} balls, per-ball median ${median.toFixed(2)} ms (best of 5), worst ${sorted.at(-1)!.toFixed(2)} ms`);
    expect(median).toBeLessThan(8);
  }, 120_000);
});
