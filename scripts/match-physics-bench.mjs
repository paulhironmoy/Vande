#!/usr/bin/env node
/**
 * Match physics micro-benchmark: the per-ball cost of the multiplayer replay physics (flightFromPath plus the
 * aimShot calls a ball script makes) on a fixed set of engine deliveries and outcome targets.
 *
 *   node scripts/match-physics-bench.mjs                 # report; exit 1 if the median ball exceeds the budget
 *   node scripts/match-physics-bench.mjs --budget=3      # per-ball budget in ms (default 3)
 *   node scripts/match-physics-bench.mjs --json
 *
 * Timings are wall-clock after a warm-up pass (JIT), the median of several repetitions per ball.
 */
import './simulate-loader.mjs';

const { matchBenchFixture } = await import('../tests/unit/physics/match-bench-fixture.ts');
const { flightFromPath } = await import('../src/physics/matchPath.ts');
const { aimShot } = await import('../src/physics/aim.ts');

const arg = (name, dflt) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.split('=')[1]) : dflt;
};
const budget = arg('budget', 3);
const reps = arg('reps', 5);
const json = process.argv.includes('--json');

const balls = matchBenchFixture();
const runBall = (b) => {
  const f = flightFromPath(b.path, b.opts);
  const from = { t: f.idealContactT, p: b.contact };
  for (const a of b.aims) aimShot(a.from ?? from, a.target, a.opts);
  return f;
};

// Warm-up (JIT), then timed repetitions.
for (const b of balls) runBall(b);
const perBall = balls.map(() => []);
const perFit = [];
const perAim = [];
for (let r = 0; r < reps; r++) {
  balls.forEach((b, i) => {
    const t0 = performance.now();
    const f = flightFromPath(b.path, b.opts);
    const t1 = performance.now();
    perFit.push(t1 - t0);
    const from = { t: f.idealContactT, p: b.contact };
    for (const a of b.aims) {
      const s = performance.now();
      aimShot(a.from ?? from, a.target, a.opts);
      perAim.push({ ms: performance.now() - s, kind: a.label });
    }
    perBall[i].push(performance.now() - t0);
  });
}
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const ballMs = perBall.map(median);
const ballMedian = median(ballMs);
const ballMean = ballMs.reduce((x, y) => x + y, 0) / ballMs.length;
const ballMax = Math.max(...ballMs);
const byKind = {};
for (const a of perAim) (byKind[a.kind] ??= []).push(a.ms);
const report = {
  balls: balls.length,
  aimsPerBall: balls.reduce((n, b) => n + b.aims.length, 0) / balls.length,
  ballMedianMs: ballMedian,
  ballMeanMs: ballMean,
  ballMaxMs: ballMax,
  fitMedianMs: median(perFit),
  fitMaxMs: Math.max(...perFit),
  aimMedianMs: median(perAim.map((a) => a.ms)),
  aimMaxMs: Math.max(...perAim.map((a) => a.ms)),
  aimByKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, { median: median(v), max: Math.max(...v) }])),
  budgetMs: budget,
  pass: ballMedian <= budget,
};
if (json) console.log(JSON.stringify(report, null, 2));
else {
  const f = (x) => x.toFixed(2);
  console.log(`Match physics benchmark: ${report.balls} balls, ${report.aimsPerBall.toFixed(1)} aims per ball, ${reps} reps (warm)`);
  console.log(`  per ball   median ${f(ballMedian)} ms   mean ${f(ballMean)} ms   max ${f(ballMax)} ms   (budget ${budget} ms: ${report.pass ? 'PASS' : 'FAIL'})`);
  console.log(`  flightFromPath   median ${f(report.fitMedianMs)} ms   max ${f(report.fitMaxMs)} ms`);
  console.log(`  aimShot          median ${f(report.aimMedianMs)} ms   max ${f(report.aimMaxMs)} ms`);
  for (const [k, v] of Object.entries(report.aimByKind)) console.log(`    ${k.padEnd(18)} median ${f(v.median)} ms   max ${f(v.max)} ms`);
}
if (!report.pass) process.exit(1);
