#!/usr/bin/env node
/**
 * Daily Top 100 ranking simulation (engine v1 + src/engine/ranking.ts).
 *
 *   node scripts/simulate-ranking.mjs              # default pool (100 real matches per pairing)
 *   node scripts/simulate-ranking.mjs --pool=200   # bigger pool of real engine matches
 *   node scripts/simulate-ranking.mjs --days=8000 --races=100   # more resampled days and ranked races
 *
 * Builds a pool of real engine matches between honest players (skilled, average, casual) and two kinds of partner who
 * throw matches (hard: blocks everything; soft: random shots and loose bowling), scores both sides with
 * engine.matchPerformance, then resamples player days to show that (1) grinding more matches cannot buy rank and
 * (2) colluding pairs gain nothing. Exits with status 1 if either property fails.
 */
import './simulate-loader.mjs';

const R = await import('../src/engine/sim/rankingSim.ts');
const arg = (name, def) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.slice(name.length + 3)) : def;
};
const PER_PAIR = arg('pool', 100);
const DAYS = arg('days', 4000);
const RACES = arg('races', 40);
const t0 = Date.now();

const pairs = [];
for (const a of R.HONEST) for (const b of R.HONEST) if (a <= b) pairs.push([a, b]);
for (const a of ['skilled', 'average']) for (const t of ['hardTank', 'softTank']) pairs.push([a, t]);
const pool = R.buildPool(pairs, PER_PAIR);
console.log(`Daily Top 100 simulation — pool of ${pairs.length * PER_PAIR} real engine matches built in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const f = (x) => x.toFixed(1);
const failures = [];

console.log('\n== Grinding: expected day score by matches played (best three of the first five eligible count)');
console.log(`   ${'matches'.padEnd(10)}${R.HONEST.map((t) => t.padStart(18)).join('')}`);
const curves = Object.fromEntries(R.HONEST.map((t) => [t, R.grindCurve(pool, t, [1, 2, 3, 4, 5, 8, 12, 20], DAYS)]));
for (let i = 0; i < 8; i++) {
  const n = curves.skilled[i].n;
  console.log(`   ${String(n).padEnd(10)}${R.HONEST.map((t) => `${f(curves[t][i].mean)} (p90 ${f(curves[t][i].p90)})`.padStart(18)).join('')}`);
}
for (const t of R.HONEST) {
  const at5 = curves[t][4].mean;
  const at20 = curves[t][7].mean;
  console.log(`   ${t}: 20 matches vs 5 matches ${at20 >= at5 ? '+' : ''}${f(at20 - at5)} points; 5 vs 3 ${f(curves[t][4].mean - curves[t][2].mean)}`);
  if (Math.abs(at20 - at5) > 2) failures.push(`grinding changes the ${t} score beyond 5 matches (${f(at20 - at5)})`);
}
const skilled3 = curves.skilled[2].mean;
const average20 = curves.average[7].mean;
console.log(`   skill beats volume: a skilled player with 3 matches averages ${f(skilled3)}, an average player grinding 20 averages ${f(average20)}`);
if (skilled3 <= average20) failures.push('an average grinder outscores a skilled three-match player');

console.log(`\n== Who makes the Top 100 (${RACES} days × 3,000 players, mixed skill, 1–20 matches a day)`);
const race = { bySkill: {}, volumeWithinSkill: {} };
const acc = {};
for (let day = 0; day < RACES; day++) {
  const r = R.rankRace(pool, 3000, `race-${day}`);
  for (const [k, v] of Object.entries(r.bySkill)) {
    race.bySkill[k] ??= { players: 0, top: 0 };
    race.bySkill[k].players += v.players;
    race.bySkill[k].top += v.top;
  }
  for (const [t, m] of Object.entries(r.volumeWithinSkill)) for (const [n, rate] of Object.entries(m)) ((acc[t] ??= {})[n] ??= []).push(rate);
}
for (const [t, m] of Object.entries(acc)) race.volumeWithinSkill[t] = Object.fromEntries(Object.entries(m).map(([n, rs]) => [n, rs.reduce((a, b) => a + b, 0) / rs.length]));
for (const [k, v] of Object.entries(race.bySkill)) console.log(`   ${k.padEnd(8)} ${String(v.players).padStart(5)} players, ${String(v.top).padStart(3)} in the Top 100 (${f((100 * v.top) / v.players)}%)`);
for (const [t, m] of Object.entries(race.volumeWithinSkill)) console.log(`   ${t.padEnd(8)} Top 100 rate by matches played: ${Object.entries(m).map(([n, r]) => `${n}: ${f(100 * r)}%`).join(', ')}`);
const sk = race.volumeWithinSkill.skilled;
if (sk && sk[20] !== undefined && sk[5] !== undefined && sk[20] > sk[5] + 0.05) failures.push('skilled grinders (20 matches) outrank skilled players with 5 matches');

console.log('\n== Collusion: A plays two of five matches against a partner who throws them');
for (const a of ['skilled', 'average'])
  for (const tank of ['hardTank', 'softTank']) {
    const r = R.collusion(pool, a, tank, 'average', Math.round(DAYS / 2));
    const gain = (k) => r[k].a - r.honest.a;
    console.log(
      `   A ${a.padEnd(8)} partner ${tank.padEnd(9)} A honest ${f(r.honest.a)} | colluding: no baseline ${f(r.no_baseline.a)} (${gain('no_baseline') >= 0 ? '+' : ''}${f(gain('no_baseline'))}), same-day baseline ${f(r.same_day_baseline.a)} (${gain('same_day_baseline') >= 0 ? '+' : ''}${f(gain('same_day_baseline'))}), long-term baseline ${f(r.long_term_baseline.a)} (${gain('long_term_baseline') >= 0 ? '+' : ''}${f(gain('long_term_baseline'))}); pair honest ${f(r.honest.pair)} vs colluding ${f(r.long_term_baseline.pair)}`,
    );
    if (gain('long_term_baseline') > 1) failures.push(`${a} gains ${f(gain('long_term_baseline'))} by colluding with a ${tank} partner`);
    if (tank === 'hardTank' && gain('no_baseline') > 1) failures.push(`${a} gains ${f(gain('no_baseline'))} from a hard tank without a baseline`);
    if (r.long_term_baseline.pair > r.honest.pair + 1) failures.push(`the ${a}+${tank} pair gains by colluding`);
  }

console.log(`\n${failures.length ? `FAILED: ${failures.join('; ')}` : 'grinding cannot buy rank and colluding pairs gain nothing'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failures.length ? 1 : 0);
