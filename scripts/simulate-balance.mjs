#!/usr/bin/env node
/**
 * Sealed Six balance and fairness simulation (engine v1).
 *
 *   node scripts/simulate-balance.mjs                       # 100,000 mixed matches + all experiments
 *   node scripts/simulate-balance.mjs --matches=20000 --cell=600   # faster
 *   node scripts/simulate-balance.mjs --json=sim-report.json       # also write the full results
 *   options: --workers=N (default: CPU count − 1), --key=<string> (changes every random draw)
 *
 * Runs the real engine (TypeScript, loaded natively by Node >= 23.6 through scripts/simulate-loader.mjs) across
 * mixed player populations, every pitch and weather, and reports outcome distributions, strategy win rates,
 * dominant-strategy detection, first-player advantage, Super Ball frequency and impossible-outcome checks. Exits
 * with status 1 when a hard fairness check fails.
 */
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import os from 'node:os';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import './simulate-loader.mjs';

const SELF = fileURLToPath(import.meta.url);

async function load() {
  const harness = await import('../src/engine/sim/harness.ts');
  const experiments = await import('../src/engine/sim/experiments.ts');
  return { H: harness, E: experiments };
}

// ---------------------------------------------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------------------------
// Main thread
// ---------------------------------------------------------------------------------------------------------------

function arg(name, def) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
}

class Pool {
  constructor(n) {
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.pending = new Map();
    this.nextId = 1;
    for (let i = 0; i < n; i++) {
      const w = new Worker(SELF);
      w.on('message', (m) => {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error));
        else p.resolve(m.result);
        this.idle.push(w);
        this.pump();
      });
      w.on('error', (e) => {
        console.error(e);
        process.exit(2);
      });
      this.workers.push(w);
      this.idle.push(w);
    }
  }
  run(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task: { ...task, id: this.nextId++ }, resolve, reject });
      this.pump();
    });
  }
  pump() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop();
      const { task, resolve, reject } = this.queue.shift();
      this.pending.set(task.id, { resolve, reject });
      w.postMessage(task);
    }
  }
  broadcast(task) {
    return Promise.all(
      this.workers.map(
        (w) =>
          new Promise((resolve, reject) => {
            const id = this.nextId++;
            this.pending.set(id, { resolve, reject });
            this.idle = this.idle.filter((x) => x !== w);
            w.postMessage({ ...task, id });
          }),
      ),
    );
  }
  close() {
    for (const w of this.workers) w.terminate();
  }
}

const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x));
const pct = (x) => `${(100 * x).toFixed(1)}%`;
const mean = (c) => c.runs / Math.max(1, c.innings);
const sd = (c) => Math.sqrt(Math.max(0, c.runsSq / Math.max(1, c.innings) - mean(c) ** 2));

async function main() {
  const { H, E } = await load();
  const MATCHES = Number(arg('matches', '100000'));
  const CELL = Number(arg('cell', '1500'));
  const KEY = arg('key', 'v1');
  const WORKERS = Number(arg('workers', String(Math.max(1, (os.availableParallelism?.() ?? os.cpus().length) - 1))));
  const JSON_OUT = arg('json', '');
  const ITER = Number(arg('iterations', '1200'));
  const t0 = Date.now();
  const pool = new Pool(WORKERS);
  const checks = [];
  const check = (name, ok, detail, hard = true) => checks.push({ name, ok, detail, hard });
  const log = (...a) => console.log(...a);

  log(`Sealed Six balance simulation — engine v1, key "${KEY}", ${MATCHES.toLocaleString()} mixed matches, ${CELL} innings per cell, ${WORKERS} workers`);

  // Phase A: strongest overs per condition (all variants and starters only), found by the optimiser.
  const pitches = ['green', 'hard', 'slow'];
  const weathers = ['clear', 'humid', 'dew'];
  const optTasks = [];
  for (const pitch of pitches) for (const weather of weathers) for (const starters of [false, true]) optTasks.push(pool.run({ type: 'optimise', cond: { pitch, weather }, starters, iterations: ITER }));
  const optimised = (await Promise.all(optTasks)).map((r) => [r.key, r.spec]);
  await pool.broadcast({ type: 'init', optimised });
  log(`optimiser: ${optimised.length} overs in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const optimisedSpec = Object.fromEntries(optimised);

  // Phase B: everything else, in parallel.
  const CHUNK = 1000;
  const mixedTasks = [];
  for (let s = 0; s < MATCHES; s += CHUNK) mixedTasks.push(pool.run({ type: 'mixed', key: KEY, start: s, count: Math.min(CHUNK, MATCHES - s), verifyEvery: 500 }));

  const bowlPolicies = [
    ...Object.keys(H.ARCHETYPES).map((a) => ({ strategy: a, skill: 'average' })),
    ...pitches.map((p) => ({ strategy: `fixed_over:${p}|all`, skill: 'average' })),
    { strategy: 'optimised', skill: 'average' },
    { strategy: 'optimised_starters', skill: 'average' },
    { strategy: 'random', skill: 'average' },
    { strategy: 'auto', skill: 'average' },
    ...['anchor', 'swinger', 'enforcer', 'trickster', 'maestro'].map((g) => ({ strategy: `ghost:${g}`, skill: 'average' })),
    { strategy: 'optimised', skill: 'unskilled' },
    { strategy: 'optimised', skill: 'skilled' },
  ];
  const label = (p) => (p.skill === 'average' ? p.strategy : `${p.strategy}/${p.skill}`);
  const cellTasks = (kind, policies) => {
    const out = {};
    for (const p of policies)
      for (const pitch of pitches) {
        const parts = [];
        for (let s = 0; s < CELL; s += 500) parts.push(pool.run({ type: kind, [kind === 'bowlCell' ? 'bowl' : 'bat']: p, pitch, key: `${KEY}|${label(p)}|${pitch}`, start: s, count: Math.min(500, CELL - s) }));
        out[`${label(p)}|${pitch}`] = Promise.all(parts).then((cs) => cs.reduce((a, b) => E.mergeCell(a, b)));
      }
    return out;
  };
  const bowlCells = cellTasks('bowlCell', bowlPolicies);
  const batPolicies = [
    ...E.FIXED_SHOTS.map((s) => ({ strategy: `fixed:${s}`, skill: 'average' })),
    { strategy: 'heuristic', skill: 'average' },
    { strategy: 'oracle', skill: 'average' },
    { strategy: 'random', skill: 'average' },
    { strategy: 'auto', skill: 'average' },
    ...['anchor', 'swinger', 'enforcer', 'trickster', 'maestro'].map((g) => ({ strategy: `ghost:${g}`, skill: 'average' })),
    { strategy: 'oracle', skill: 'unskilled' },
    { strategy: 'oracle', skill: 'skilled' },
    { strategy: 'heuristic', skill: 'unskilled' },
    { strategy: 'heuristic', skill: 'skilled' },
  ];
  const batCells = cellTasks('batCell', batPolicies);

  const H2H = Math.max(400, Math.round(CELL * 1.3));
  const h2h = (name, a, b) => {
    const parts = [];
    for (let s = 0; s < H2H; s += 500) parts.push(pool.run({ type: 'h2h', a, b, key: `${KEY}|${name}`, start: s, count: Math.min(500, H2H - s) }));
    return Promise.all(parts).then((rs) => rs.reduce((x, y) => ({ won: x.won + y.won, lost: x.lost + y.lost, tied: x.tied + y.tied, runsFor: x.runsFor + y.runsFor, runsAgainst: x.runsAgainst + y.runsAgainst })));
  };
  const human = E.AVERAGE_HUMAN;
  const ghostTasks = Object.fromEntries(
    ['anchor', 'swinger', 'enforcer', 'trickster', 'maestro'].map((g) => [g, h2h(`ghost-${g}`, human, { bat: { strategy: `ghost:${g}`, skill: 'average' }, bowl: { strategy: `ghost:${g}`, skill: 'average' } })]),
  );
  const autoTasks = {
    autoOver: h2h('auto-over', human, { bat: human.bat, bowl: { strategy: 'auto', skill: 'average' } }),
    autoXI: h2h('auto-xi', human, { bat: { strategy: 'auto', skill: 'average' }, bowl: human.bowl }),
    mirrorHuman: h2h('mirror-human', human, human),
    mirrorOracle: h2h('mirror-oracle', { bat: { strategy: 'oracle', skill: 'average' }, bowl: { strategy: 'optimised', skill: 'average' } }, { bat: { strategy: 'oracle', skill: 'average' }, bowl: { strategy: 'optimised', skill: 'average' } }),
    skilledVsAverage: h2h('skill', { bat: { strategy: 'heuristic', skill: 'skilled' }, bowl: { strategy: 'starter_mix', skill: 'skilled' } }, human),
    thinkingVsRandom: h2h('thinking', human, { bat: { strategy: 'random', skill: 'average' }, bowl: { strategy: 'random', skill: 'average' } }),
  };
  const dailyTask = pool.run({ type: 'daily', bat: { strategy: 'heuristic', skill: 'average' }, firstDay: '2026-10-01', days: Math.max(30, Math.round(CELL / 15)), perOver: 20 });
  const crossItems = [];
  for (const from of pitches) for (const to of pitches) crossItems.push({ from, to, spec: optimisedSpec[`${from}|clear|false|${ITER}`], cond: { pitch: to, weather: 'clear' } });
  const crossTask = pool.run({ type: 'overValues', items: crossItems.map((x) => ({ spec: x.spec, cond: x.cond })) });

  const mixedParts = await Promise.all(mixedTasks);
  const mixed = mixedParts.reduce((a, b) => E.mergeStats(a, b), E.emptyStats());
  const bowl = Object.fromEntries(await Promise.all(Object.entries(bowlCells).map(async ([k, p]) => [k, await p])));
  const bat = Object.fromEntries(await Promise.all(Object.entries(batCells).map(async ([k, p]) => [k, await p])));
  const ghosts = Object.fromEntries(await Promise.all(Object.entries(ghostTasks).map(async ([k, p]) => [k, await p])));
  const autos = Object.fromEntries(await Promise.all(Object.entries(autoTasks).map(async ([k, p]) => [k, await p])));
  const daily = await dailyTask;
  const crossValues = await crossTask;
  pool.close();

  // ------------------------------------------------------------------------------------------------------------
  // Report
  // ------------------------------------------------------------------------------------------------------------
  const inn = mixed.innings;
  const runsTotal = mixed.runsHist.reduce((s, v, i) => s + v * i, 0);
  const runsMean = runsTotal / inn;
  const runsSd = Math.sqrt(mixed.runsHist.reduce((s, v, i) => s + v * (i - runsMean) ** 2, 0) / inn);
  const pctile = (p) => {
    let acc = 0;
    for (let i = 0; i < mixed.runsHist.length; i++) {
      acc += mixed.runsHist[i];
      if (acc >= p * inn) return i;
    }
    return 36;
  };
  const b = mixed.balls;
  log('\n== Mixed population');
  log(`matches ${mixed.matches.toLocaleString()}, innings ${inn.toLocaleString()}, balls ${b[0].toLocaleString()}`);
  log(`innings runs: mean ${f2(runsMean)}, sd ${f2(runsSd)}, p10 ${pctile(0.1)}, median ${pctile(0.5)}, p90 ${pctile(0.9)}, max ${mixed.runsHist.reduce((m, v, i) => (v ? i : m), 0)}`);
  log(`runs histogram: ${mixed.runsHist.map((v, i) => (v ? `${i}:${pct(v / inn)}` : null)).filter(Boolean).join(' ')}`);
  log(`wickets per innings: 0 ${pct(mixed.wicketsHist[0] / inn)}, 1 ${pct(mixed.wicketsHist[1] / inn)}, 2 (all out) ${pct(mixed.wicketsHist[2] / inn)}; mean ${f2((mixed.wicketsHist[1] + 2 * mixed.wicketsHist[2]) / inn)}`);
  log(`per ball: dot ${pct(b[1] / b[0])}, 1 ${pct(b[2] / b[0])}, 2 ${pct(b[3] / b[0])}, 3 ${pct(b[4] / b[0])}, 4 ${pct(b[5] / b[0])}, 6 ${pct(b[6] / b[0])}, wicket ${pct(b[7] / b[0])}; boundaries per innings ${f2((b[5] + b[6]) / inn)} (4s ${f2(b[5] / inn)}, 6s ${f2(b[6] / inn)})`);
  const dist = (title, m) => {
    log(`-- ${title}: balls, dot, 1, 2, 3, 4, 6, W, runs/ball`);
    for (const [k, c] of Object.entries(m).sort())
      log(`   ${k.padEnd(12)} ${String(c[0]).padStart(8)}  ${[1, 2, 3, 4, 5, 6, 7].map((i) => pct(c[i] / c[0]).padStart(6)).join(' ')}  ${f2((c[2] + 2 * c[3] + 3 * c[4] + 4 * c[5] + 6 * c[6]) / c[0])}`);
  };
  dist('outcomes per delivery variant', mixed.byVariant);
  dist('outcomes per shot', mixed.byShot);
  const recTable = (title, m, mode) => {
    log(`-- ${title}`);
    for (const [k, r] of Object.entries(m).sort()) {
      const decided = r.won + r.lost + r.tied;
      log(`   ${k.padEnd(30)} innings ${String(r.innings).padStart(7)}  ${mode === 'bowl' ? 'conceded' : 'runs'} ${f2(r.runs / r.innings).padStart(5)}  wkts ${f2(r.wickets / r.innings)}  win ${pct(r.won / decided).padStart(6)}`);
    }
  };
  recTable('by pitch', mixed.byPitch);
  recTable('by weather', mixed.byWeather);
  recTable('win rate by batting strategy (whole player)', mixed.batStrategy);
  recTable('win rate by bowling strategy (whole player; runs conceded by it)', mixed.bowlStrategy, 'bowl');
  log(`-- wicket kinds: ${Object.entries(mixed.wicketKinds).map(([k, v]) => `${k} ${pct(v / b[7])}`).join(', ')}`);
  log(`-- contact: ${Object.entries(mixed.contacts).map(([k, v]) => `${k} ${pct(v / b[0])}`).join(', ')}`);
  log(`-- timing: ${Object.entries(mixed.timings).map(([k, v]) => `${k} ${pct(v / b[0])}`).join(', ')}`);
  log(`-- execution: ${Object.entries(mixed.executions).map(([k, v]) => `${k} ${pct(v / b[0])}`).join(', ')}`);

  // Fairness: seats, Super Ball, impossible outcomes, audit.
  const decided = mixed.seatWins[0] + mixed.seatWins[1];
  const seat0 = mixed.seatWins[0] / decided;
  const z = (seat0 - 0.5) / Math.sqrt(0.25 / decided);
  const md = mixed.mirror.seat0 + mixed.mirror.seat1;
  const mz = md ? (mixed.mirror.seat0 / md - 0.5) / Math.sqrt(0.25 / md) : 0;
  log('\n== Fairness');
  log(`first player (seat 0) wins ${pct(seat0)} of decided matches (z = ${f2(z)}); identical players: seat 0 ${pct(md ? mixed.mirror.seat0 / md : 0.5)} of ${md} (z = ${f2(mz)})`);
  log(`Super Ball needed (runs tied): ${pct(mixed.superBallUsed / mixed.matches)}; decided by: ${Object.entries(mixed.decidedBy).map(([k, v]) => `${k} ${pct(v / mixed.matches)}`).join(', ')}`);
  const sbr = mixed.superBallRuns;
  log(`Super Ball outcomes when used: dot ${pct(sbr[1] / sbr[0])}, 1 ${pct(sbr[2] / sbr[0])}, 2 ${pct(sbr[3] / sbr[0])}, 4 ${pct(sbr[5] / sbr[0])}, 6 ${pct(sbr[6] / sbr[0])}, W ${pct(sbr[7] / sbr[0])}`);
  log(`impossible outcomes / invalid inputs: ${mixed.anomalyCount}${mixed.anomalies.length ? ` e.g. ${mixed.anomalies.slice(0, 5).join(' | ')}` : ''}`);
  log(`full audits (commit hashes + verifyMatchLog + tamper check): ${mixed.verified} logs, ${mixed.verifyFailures.length} failures`);
  check('no impossible outcomes or invalid engine-built inputs', mixed.anomalyCount === 0, `${mixed.anomalyCount} anomalies`);
  check('every audited log verifies and tampering is detected', mixed.verifyFailures.length === 0 && mixed.verified > 0, `${mixed.verified} audited, ${mixed.verifyFailures.length} failures`);
  check('no first-player advantage (|z| < 3)', Math.abs(z) < 3, `seat 0 ${pct(seat0)}, z ${f2(z)}`);
  check('no seat bias between identical players (|z| < 3)', Math.abs(mz) < 3, `z ${f2(mz)}`);
  const sbRate = mixed.superBallUsed / mixed.matches;
  check('Super Ball frequency 2–10 %', sbRate >= 0.02 && sbRate <= 0.1, pct(sbRate), false);

  // Dominance: bowling.
  log('\n== Bowling policies vs reference batters (runs conceded per innings / wickets), per pitch');
  const bowlRows = bowlPolicies.map((p) => label(p));
  log(`   ${'policy'.padEnd(30)} ${pitches.map((p) => p.padStart(16)).join('')}`);
  for (const r of bowlRows) log(`   ${r.padEnd(30)} ${pitches.map((p) => `${f2(mean(bowl[`${r}|${p}`]))} / ${f2(bowl[`${r}|${p}`].wickets / bowl[`${r}|${p}`].innings)}`.padStart(16)).join('')}`);
  const singleOvers = bowlRows.filter((r) => r in H.ARCHETYPES || r.startsWith('fixed_over:'));
  const allComparable = bowlRows.filter((r) => !r.includes('/'));
  const bestByPitch = Object.fromEntries(pitches.map((p) => [p, Math.min(...allComparable.map((r) => mean(bowl[`${r}|${p}`])))]));
  const dominantOvers = singleOvers.filter((r) => pitches.every((p) => mean(bowl[`${r}|${p}`]) <= bestByPitch[p] * 1.03 + 0.05));
  const bestFixed = Object.fromEntries(pitches.map((p) => [p, singleOvers.reduce((a, r) => (mean(bowl[`${r}|${p}`]) < mean(bowl[`${a}|${p}`]) ? r : a))]));
  log(`best single (pitch-blind) over per pitch: ${pitches.map((p) => `${p}: ${bestFixed[p]} ${f2(mean(bowl[`${bestFixed[p]}|${p}`]))}`).join(', ')}`);
  log(`pitch-adaptive optimiser per pitch: ${pitches.map((p) => `${p}: ${f2(mean(bowl[`optimised|${p}`]))}`).join(', ')}`);
  check('no single over dominates across pitches (within 3% of the best on every pitch)', dominantOvers.length === 0, dominantOvers.length ? dominantOvers.join(', ') : 'none');
  const adaptGain = pitches.map((p) => {
    const own = mean(bowl[`fixed_over:${p}|all|${p}`]);
    const others = pitches.filter((q) => q !== p).map((q) => mean(bowl[`fixed_over:${q}|all|${p}`]));
    return others.reduce((a, x) => a + x, 0) / others.length / own - 1;
  });
  log(`pitch adaptation gain (overs built for other pitches concede this much more): ${pitches.map((p, i) => `${p} +${pct(adaptGain[i])}`).join(', ')}`);
  check('pitches change tactics (the over built for a pitch beats the other pitches\' overs there by >= 4%)', adaptGain.every((g) => g >= 0.04), adaptGain.map(pct).join(', '));
  log('cross-pitch analytic value of each pitch-optimised over (rows: optimised for; cols: played on):');
  for (const from of pitches) log(`   ${from.padEnd(6)} ${pitches.map((to) => f2(crossValues[crossItems.findIndex((x) => x.from === from && x.to === to)]).padStart(7)).join('')}`);
  const unlockGap = pitches.map((p) => mean(bowl[`optimised_starters|${p}`]) - mean(bowl[`optimised|${p}`]));
  log(`unlock advantage (starters-only optimised over concedes this many more runs): ${pitches.map((p, i) => `${p} ${f2(unlockGap[i])}`).join(', ')}`);
  check('unlocks add variety, not power (best starter over within 0.6 runs of the best over)', unlockGap.every((g) => g <= 0.6), unlockGap.map(f2).join(', '));
  const exec = pitches.map((p) => [mean(bowl[`optimised/unskilled|${p}`]), mean(bowl[`optimised|${p}`]), mean(bowl[`optimised/skilled|${p}`])]);
  log(`bowling execution skill (same optimised over; unskilled / average / skilled release): ${pitches.map((p, i) => `${p} ${exec[i].map(f2).join(' / ')}`).join(', ')}`);
  check('execution skill matters (skilled release concedes less than unskilled on every pitch)', exec.every((e) => e[2] < e[0] - 0.3), exec.map((e) => f2(e[0] - e[2])).join(', '));

  // Dominance: batting.
  log('\n== Batting policies vs reference bowling (runs per innings / wickets), per pitch');
  const batRows = batPolicies.map((p) => label(p));
  log(`   ${'policy'.padEnd(30)} ${pitches.map((p) => p.padStart(16)).join('')}`);
  for (const r of batRows) log(`   ${r.padEnd(30)} ${pitches.map((p) => `${f2(mean(bat[`${r}|${p}`]))} / ${f2(bat[`${r}|${p}`].wickets / bat[`${r}|${p}`].innings)}`.padStart(16)).join('')}`);
  const fixedRows = E.FIXED_SHOTS.map((s) => `fixed:${s}`);
  const bestFixedShot = Object.fromEntries(pitches.map((p) => [p, fixedRows.reduce((a, r) => (mean(bat[`${r}|${p}`]) > mean(bat[`${a}|${p}`]) ? r : a))]));
  log(`best fixed shot per pitch: ${pitches.map((p) => `${p}: ${bestFixedShot[p]} ${f2(mean(bat[`${bestFixedShot[p]}|${p}`]))}`).join(', ')}`);
  const oracleEdge = pitches.map((p) => mean(bat[`oracle|${p}`]) / mean(bat[`${bestFixedShot[p]}|${p}`]) - 1);
  log(`adaptive (oracle) edge over the best fixed shot: ${pitches.map((p, i) => `${p} +${pct(oracleEdge[i])}`).join(', ')}`);
  check('no fixed shot policy dominates: reading the ball beats the best fixed shot by >= 15% on every pitch', oracleEdge.every((e) => e >= 0.15), oracleEdge.map(pct).join(', '));
  check('the best fixed shot is not the same on every pitch', new Set(Object.values(bestFixedShot)).size > 1, Object.values(bestFixedShot).join(', '), false);
  const skillRows = pitches.map((p) => [mean(bat[`oracle/unskilled|${p}`]), mean(bat[`oracle|${p}`]), mean(bat[`oracle/skilled|${p}`])]);
  log(`batting timing skill (oracle choices; unskilled / average / skilled): ${pitches.map((p, i) => `${p} ${skillRows[i].map(f2).join(' / ')}`).join(', ')}`);
  check('timing skill matters (skilled outscores unskilled by >= 40% on every pitch)', skillRows.every((r) => r[2] >= r[0] * 1.4), skillRows.map((r) => pct(r[2] / r[0] - 1)).join(', '));
  const heurVsRandom = pitches.map((p) => mean(bat[`heuristic|${p}`]) / mean(bat[`random|${p}`]) - 1);
  check('strategy matters (thinking batter outscores random shots by >= 50%)', heurVsRandom.every((x) => x >= 0.5), heurVsRandom.map(pct).join(', '));

  // Ghosts, Auto Over / Auto XI, head to head.
  log('\n== Head to head (average human: thinking batter, average timing, sensible starter over)');
  const h2hRow = (name, r) => log(`   ${name.padEnd(34)} human wins ${pct(r.won / (r.won + r.lost + r.tied))}, ties ${pct(r.tied / (r.won + r.lost + r.tied))}, runs ${f2(r.runsFor / (r.won + r.lost + r.tied))} vs ${f2(r.runsAgainst / (r.won + r.lost + r.tied))}`);
  for (const [g, r] of Object.entries(ghosts)) h2hRow(`vs ghost ${g}`, r);
  h2hRow('vs Auto Over (human bats both)', autos.autoOver);
  h2hRow('vs Auto XI (human bowls both)', autos.autoXI);
  h2hRow('mirror: human vs human', autos.mirrorHuman);
  h2hRow('mirror: oracle vs oracle', autos.mirrorOracle);
  const sk = autos.skilledVsAverage;
  h2hRow('skilled human (as "human") vs average', sk);
  h2hRow('thinking human vs random player', autos.thinkingVsRandom);
  const gw = ['anchor', 'swinger', 'enforcer', 'trickster', 'maestro'].map((g) => 1 - ghosts[g].won / (ghosts[g].won + ghosts[g].lost + ghosts[g].tied));
  check('ghost difficulty is ordered (difficulty 1 < 2 < 3 by win rate against an average human)', gw[0] < Math.min(gw[1], gw[2]) && Math.max(gw[1], gw[2]) < Math.min(gw[3], gw[4]), gw.map(pct).join(', '), false);
  const humanOvers = [...Object.keys(H.ARCHETYPES), 'random'];
  const median = (xs) => {
    const a = [...xs].sort((x, y) => x - y);
    return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
  };
  const autoVsMedian = pitches.map((p) => mean(bowl[`auto|${p}`]) - median(humanOvers.map((o) => mean(bowl[`${o}|${p}`]))));
  log(`Auto Over concedes vs the median human-style over: ${pitches.map((p, i) => `${p} ${autoVsMedian[i] >= 0 ? '+' : ''}${f2(autoVsMedian[i])}`).join(', ')}`);
  check('Auto Over is balanced but never better than a typical over (concedes >= the median human-style over − 0.25)', autoVsMedian.every((d) => d >= -0.25), autoVsMedian.map(f2).join(', '), false);
  const autoXIHumanWin = autos.autoXI.won / (autos.autoXI.won + autos.autoXI.lost + autos.autoXI.tied);
  check('Auto XI is cautious, never better than batting (average human beats it 50–80%)', autoXIHumanWin >= 0.5 && autoXIHumanWin <= 0.8, pct(autoXIHumanWin), false);
  const skilledWin = sk.won / (sk.won + sk.lost + sk.tied);
  check('skill wins: a skilled human beats an average one >= 58%', skilledWin >= 0.58, pct(skilledWin));
  const thinkWin = autos.thinkingVsRandom.won / (autos.thinkingVsRandom.won + autos.thinkingVsRandom.lost + autos.thinkingVsRandom.tied);
  check('results are not arbitrary: a thinking player beats a random one >= 80%', thinkWin >= 0.8, pct(thinkWin));

  log('\n== Daily Six (thinking batter, average timing)');
  log(`   ${daily.n} innings per over; mean score A ${f2(daily.score[0])}, B ${f2(daily.score[1])}, C ${f2(daily.score[2])}; mean runs ${daily.runs.map(f2).join(' / ')}`);
  log(`   by pitch: ${Object.entries(daily.byPitch).map(([p, v]) => `${p} ${f2(v[0] / v[1])}`).join(', ')}`);
  const dmin = Math.min(...daily.score);
  const dmax = Math.max(...daily.score);
  check('the three daily overs are comparably hard (scores within 30%)', dmax <= dmin * 1.3, `${f2(dmin)}–${f2(dmax)}`, false);

  log('\n== Checks');
  for (const c of checks) log(`   ${c.ok ? 'PASS' : c.hard ? 'FAIL' : 'WARN'}  ${c.name} — ${c.detail}`);
  const failed = checks.filter((c) => !c.ok && c.hard);
  log(`\n${failed.length ? `${failed.length} hard check(s) FAILED` : 'all hard checks passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify({ key: KEY, matches: MATCHES, cell: CELL, mixed, bowl, bat, ghosts, autos, daily, crossValues, optimised, checks }, null, 1));
    log(`wrote ${JSON_OUT}`);
  }
  process.exit(failed.length ? 1 : 0);
}

// ---------------------------------------------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------------------------------------------

async function workerMain() {
  const { H, E } = await load();
  parentPort.on('message', async (msg) => {
    try {
      let result;
      switch (msg.type) {
        case 'init':
          H.importOptimised(msg.optimised);
          result = true;
          break;
        case 'optimise':
          result = { key: `${msg.cond.pitch}|${msg.cond.weather}|${msg.starters}|${msg.iterations}`, spec: H.optimisedSpec(msg.cond, msg.starters, msg.iterations) };
          break;
        case 'mixed':
          result = await E.runMixed(msg.key, msg.start, msg.count, msg.verifyEvery);
          break;
        case 'bowlCell':
          result = E.bowlingCell(msg.bowl, msg.pitch, msg.key, msg.start, msg.count);
          break;
        case 'batCell':
          result = E.battingCell(msg.bat, msg.pitch, msg.key, msg.start, msg.count);
          break;
        case 'h2h':
          result = E.headToHead(msg.a, msg.b, msg.key, msg.start, msg.count);
          break;
        case 'daily':
          result = E.dailyExperiment(msg.bat, msg.firstDay, msg.days, msg.perOver);
          break;
        case 'overValues':
          result = msg.items.map((it) => H.overValue(it.spec, it.cond));
          break;
        default:
          throw new Error(`unknown task ${msg.type}`);
      }
      parentPort.postMessage({ id: msg.id, result });
    } catch (e) {
      parentPort.postMessage({ id: msg.id, error: e instanceof Error ? e.stack : String(e) });
    }
  });
}


if (isMainThread) await main();
else await workerMain();
