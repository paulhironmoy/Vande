#!/usr/bin/env node
/**
 * Chase targets: works out the target of every seed of the chase pool with the reference batter and writes
 * src/practice/chase/targets.ts (docs/PRACTICE_CHASE.md, "Targets"; the method is TARGET-METHOD.md).
 *
 *   node scripts/chase-targets.mjs derive --from 0 --to 8 --out <dir>   # works out seeds c000..c007 into <dir>/<seed>.json
 *   node scripts/chase-targets.mjs table --in <dir> [--write]           # merges <dir>/*.json (all 256) into the table source
 *       # (policy v2, ruling R-44: the share and the floor, then the minimum chance, then the order rule; it lists every
 *       # entry that differs from the table it replaces on stderr)
 *   node scripts/chase-targets.mjs check --seed c012 [--seed c030]      # works a seed out again and compares it with targets.ts
 *   node scripts/chase-targets.mjs validate --in <dir> --seed c012 [--innings 200] --out <file>
 *       # plays the reference batter's best-play choices through the physics with random (not quadrature) timing errors
 *       # and compares how often he reaches each target with the program's answer; also plays other batters
 *   node scripts/chase-targets.mjs converge --in <dir> --seed c012 [--points 96]
 *       # the same seed with more timing-error points: how far do the answers move?
 *   node scripts/chase-targets.mjs assists --in <dir> --seed c012 [--out <file>]
 *       # the table's targets for the reference batter at Learn and Real (the table is worked out at Play)
 *   node scripts/chase-targets.mjs hand --in <dir> --seed c012 [--out <file>]
 *       # a left-handed batter: the coach and the reference batter worked out afresh, against the right-handed targets
 *   node scripts/chase-targets.mjs fixture --in <dir> --seed c000 --out <file>
 *       # writes the unit-test fixture of tests/unit/practice/chase/reference.test.ts (the coach's options, the outcome tables
 *       # and the targets of one seed at the reference timing)
 *   node scripts/chase-targets.mjs report --in <dir> [--out <file>]
 *       # the distribution of the targets over every seed file, the reference batter's chances, and a menu of other settings
 *   node scripts/chase-targets.mjs distribution --in <dir> [--out <file>]
 *       # exact results of the reference batter's choices at several timing errors: win rate, last-ball and last-over
 *       # finishes, losses by wicket and by the balls, margins (from the stored outcome tables, no new physics)
 *   node scripts/chase-targets.mjs fairness --in <dir> [--from 0] [--seeds 200] [--seed c025 --seed c136] [--attempts 30] [--out <file>]
 *       # played through the physics: no target is one ball's work; a best-of-30 chase-aware coach policy and the coach's
 *       # recommended-only policy; nine fixed inputs: on how many seeds does each win? (--seed: only those seeds)
 *   node scripts/chase-targets.mjs min-chance-fixture --in <dir> --out <file>
 *       # writes the unit-test fixture of tests/unit/practice/chase/min-chance.test.ts: for every seed whose targets the
 *       # minimum-chance and order rules (R-44) change, the outcome tables at 20 ms and the targets before and after
 *
 * Deterministic: the same seed gives the same file on every machine (no random number, no clock in the result).
 * One seed is about 20 s of physics on a desktop core, so run it in short pieces under `nice` (the shared-machine rule):
 *   sh <scratch>/heavy.sh chase-targets node scripts/chase-targets.mjs derive --from 0 --to 8 --out <dir>
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import './simulate-loader.mjs';
import { repoRoot } from './simulate-loader.mjs';

const args = process.argv.slice(2);
const command = args[0];
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const all = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));
const run = (cmd, a = []) => {
  try {
    return execFileSync(cmd, a, { encoding: 'utf8', cwd: repoRoot }).trim();
  } catch {
    return 'unavailable';
  }
};

const C = await import('../src/practice/chase/index.ts');
const D = await import('../src/practice/chase/derive.ts');
const REF = await import('../src/practice/chase/reference.ts');
const T = await import('../src/practice/chase/targets.ts');

const DIFFS = ['easy', 'standard', 'hard'];

/** The timing errors (ms, standard deviation) kept in every new seed file besides the reference one: 0 is perfect timing. */
const EXTRA_SIGMAS = [];

/** What each option does over the timing errors of one sigma, as counts: perfect timing needs one play, the rest 24. */
function pmfEntry(balls, assist, sigma) {
  const z = sigma === 0 ? [0] : D.QUADRATURE_Z;
  const pmfs = REF.referencePmfs(balls, assist, sigma, z);
  return { points: z.length, counts: pmfs.map((ball) => ball.map((p) => D.countsOf(p, z.length))) };
}

function deriveSeed(seed, assist, bowling = 'club') {
  const def = { ...C.makeChase(seed, 'standard'), bowling };
  const t0 = performance.now();
  const balls = REF.referenceBalls(def, assist);
  const t1 = performance.now();
  const pmfs = REF.referencePmfs(balls, assist, D.REFERENCE_SIGMA_MS);
  const targets = D.targetsOf(pmfs);
  const pmfBySigma = {};
  for (const sigma of EXTRA_SIGMAS) if (sigma !== D.REFERENCE_SIGMA_MS) pmfBySigma[sigma] = pmfEntry(balls, assist, sigma);
  const t2 = performance.now();
  return {
    seed,
    assist,
    bowling,
    sigmaMs: D.REFERENCE_SIGMA_MS,
    quadraturePoints: D.QUADRATURE_Z.length,
    policy: D.REFERENCE_POLICY,
    tierShare: D.TIER_SHARE,
    tierFloor: D.TIER_FLOOR,
    minChance: D.MIN_CHANCE,
    minTarget: D.MIN_TARGET,
    targets,
    // The coach's responses for each ball, and what each does over the timing errors as counts out of 24
    // (runs 0 to 6, then out), so that a change of shares or floor needs no new physics.
    options: balls.map((b) => b.options),
    pmfCounts: pmfs.map((ball) => ball.map((p) => D.countsOf(p, D.QUADRATURE_Z.length))),
    // The same for other timing errors, keyed by sigma in ms ('0' is perfect timing, one play per option).
    pmfBySigma,
    coachMs: Math.round(t1 - t0),
    physicsMs: Math.round(t2 - t1),
  };
}

/** The outcome tables of a stored seed file for one timing error (default: the reference batter's). */
function pmfsOf(r, sigma = D.REFERENCE_SIGMA_MS) {
  let entry = r.pmfBySigma?.[String(sigma)];
  if (!entry && r.sigmaMs === sigma) entry = { points: r.quadraturePoints, counts: r.pmfCounts };
  if (!entry) throw new Error(`${r.seed}: no outcome tables for a timing error of ${sigma} ms`);
  if (sigma !== 0 && entry.points !== D.QUADRATURE_Z.length) throw new Error(`${r.seed}: ${entry.points} points, expected ${D.QUADRATURE_Z.length}`);
  return entry.counts.map((ball) => ball.map((c) => D.pmfFromCounts(c)));
}

/** The targets a stored seed file gives under the current constants (sigma, shares, floors), from its stored counts. */
function targetsFromFile(r) {
  if ((r.bowling ?? 'club') !== 'club') throw new Error(`${r.seed}: derived for ${r.bowling} bowling, the chase uses club`);
  // The stored counts (coach options, outcome tables) of policy v1 are the same under v2: v2 only reads the targets differently.
  if (!D.DERIVATION_POLICY_VERSIONS.includes(r.policy.version)) throw new Error(`${r.seed}: derived under policy v${r.policy.version}`);
  return D.targetsOf(pmfsOf(r));
}

/** The fairness numbers over rows of the `fairness` command (definition of done CHC-05). */
function fairnessSummary(rows, attempts, extra = {}) {
  const n = rows.length;
  const names = Object.keys(rows[0].fixed);
  const modes = Object.keys(rows[0].fixed[names[0]]);
  const pct = (count, total) => Math.round((1000 * count) / total) / 10;
  const summary = { seeds: n, attempts, ...extra, tiers: {} };
  for (const d of DIFFS) {
    summary.tiers[d] = {
      minTarget: Math.min(...rows.map((x) => x.targets[d])),
      targetsAtMostSix: rows.filter((x) => x.targets[d] <= 6).length,
      seedsCoachAwareNeverWins: rows.filter((x) => x.coachAware[d].wins === 0).length,
      seedsCoachRecommendedNeverWins: rows.filter((x) => x.coachRecommended[d].wins === 0).length,
      coachAwareWinShareOfTries: pct(rows.reduce((a, x) => a + x.coachAware[d].wins, 0), n * attempts),
      coachRecommendedWinShareOfTries: pct(rows.reduce((a, x) => a + x.coachRecommended[d].wins, 0), n * attempts),
      fixedInputSeedShare: Object.fromEntries(names.map((name) => [name, Object.fromEntries(modes.map((mode) => [mode, pct(rows.filter((x) => x.fixed[name][mode][d]).length, n)]))])),
    };
  }
  return summary;
}

if (command === 'derive') {
  const from = Number(arg('from', 0));
  const to = Number(arg('to', from + 1));
  const out = arg('out');
  const assist = arg('assist', 'play');
  const bowling = arg('bowling', 'club');
  if (!out) throw new Error('--out <dir> is required');
  mkdirSync(out, { recursive: true });
  for (let i = from; i < to; i++) {
    const seed = C.chaseSeedAt(i);
    const file = path.join(out, `${seed}.json`);
    if (existsSync(file)) {
      console.log(`${seed} exists`);
      continue;
    }
    const r = deriveSeed(seed, assist, bowling);
    r.measured = { uptime: run('uptime'), node: process.version, platform: `${process.platform} ${process.arch}` };
    writeFileSync(file, `${JSON.stringify(r)}\n`);
    console.log(
      `${seed} ${DIFFS.map((d) => `${d}=${r.targets[d].target}(${Math.round(100 * r.targets[d].win)}%)`).join(' ')} coach ${r.coachMs} ms physics ${r.physicsMs} ms`,
    );
  }
} else if (command === 'sigmas') {
  // Adds the outcome tables of other timing errors to seed files already written (physics only, the coach is not run again).
  const dir = arg('in');
  const from = Number(arg('from', 0));
  const to = Number(arg('to', C.CHASE_SEED_COUNT));
  const wanted = args.includes('--sigma') ? all('sigma').map(Number) : [D.REFERENCE_SIGMA_MS];
  if (!dir) throw new Error('--in <dir> is required');
  for (let i = from; i < to; i++) {
    const seed = C.chaseSeedAt(i);
    const file = path.join(dir, `${seed}.json`);
    if (!existsSync(file)) {
      console.log(`${seed} missing`);
      continue;
    }
    const r = JSON.parse(readFileSync(file, 'utf8'));
    r.pmfBySigma ??= {};
    const todo = wanted.filter((sg) => !r.pmfBySigma[String(sg)] && r.sigmaMs !== sg);
    if (!todo.length) {
      console.log(`${seed} has ${wanted.join(', ')}`);
      continue;
    }
    const def = { ...C.makeChase(seed, 'standard'), bowling: r.bowling ?? 'club' };
    const balls = REF.chaseEvalBalls(def).map((ball, k) => ({ ball, options: r.options[k] }));
    const t0 = performance.now();
    for (const sg of todo) r.pmfBySigma[String(sg)] = pmfEntry(balls, r.assist, sg);
    r.sigmaMs = r.sigmaMs ?? D.REFERENCE_SIGMA_MS;
    writeFileSync(file, `${JSON.stringify(r)}\n`);
    console.log(`${seed} added sigma ${todo.join(', ')} in ${Math.round(performance.now() - t0)} ms`);
  }
} else if (command === 'table') {
  const dir = arg('in');
  if (!dir) throw new Error('--in <dir> is required');
  const rows = [];
  for (let i = 0; i < C.CHASE_SEED_COUNT; i++) {
    const file = path.join(dir, `${C.chaseSeedAt(i)}.json`);
    if (!existsSync(file)) throw new Error(`missing ${file}`);
    rows.push(JSON.parse(readFileSync(file, 'utf8')));
  }
  const assist = rows[0].assist;
  if (rows.some((r) => r.assist !== assist)) throw new Error('mixed derivations');
  const derived = rows.map(targetsFromFile);
  const targets = Object.fromEntries(DIFFS.map((d) => [d, derived.map((t) => t[d].target)]));
  const winPercent = Object.fromEntries(DIFFS.map((d) => [d, derived.map((t) => Math.round(100 * t[d].win))]));
  const digest = createHash('sha256').update(JSON.stringify({ targets, winPercent })).digest('hex');
  // Every entry that differs from the table now in src/practice/chase/targets.ts (the one this run replaces).
  const differs = [];
  for (const d of DIFFS)
    derived.forEach((t, i) => {
      const was = { target: T.TARGET_TABLE.targets[d][i], percent: T.TARGET_TABLE.winPercent[d][i] };
      if (t[d].target !== was.target || Math.round(100 * t[d].win) !== was.percent)
        differs.push(`${C.chaseSeedAt(i)} ${d}: target ${was.target} (${was.percent}%) -> ${t[d].target} (${(100 * t[d].win).toFixed(2)}%)${t[d].lowered ? ' [minimum chance]' : ''}${t[d].raised ? ' [order rule]' : ''}`);
    });
  console.error(`${differs.length} of ${3 * rows.length} entries differ from the table being replaced (${T.TARGET_TABLE.policy.id} v${T.TARGET_TABLE.policy.version}, digest ${T.TARGET_TABLE.digest.slice(0, 8)}):`);
  for (const line of differs) console.error(`  ${line}`);
  const lines = (a) => {
    const out = [];
    for (let k = 0; k < a.length; k += 24) out.push(`      ${a.slice(k, k + 24).join(', ')},`);
    return out.join('\n');
  };
  const src = `/**
 * The target table: the runs to win for each seed of the pool (c000 to c255) at each difficulty, and the share of the
 * reference batter's innings that reach it (percent, 0 to 100). GENERATED by scripts/chase-targets.mjs from the
 * reference batter (derive.ts, reference.ts; method in TARGET-METHOD.md), never edited by hand: ask the script to check
 * it (\`node scripts/chase-targets.mjs check --seed c000\`). Do not pin a target in a test: ask \`makeChase\`.
 */
import type { ChaseDifficulty, ChasePolicyRef } from './types';

export const TARGET_TABLE: {
  policy: ChasePolicyRef;
  /** The assistance level the reference batter played at (the player's own level only changes the timing bands). */
  assist: string;
  /** The reference batter's timing error (ms) and, per difficulty, the share of his innings that reach the target. */
  sigmaMs: number;
  tierShare: Readonly<Record<ChaseDifficulty, number>>;
  /** The smallest target of each difficulty (the minimum-chance rule may go below it, never below minTarget). */
  tierFloor: Readonly<Record<ChaseDifficulty, number>>;
  /** Ruling R-44: where the share and the floor leave the reference batter below this chance, the target is the largest he reaches this often. */
  minChance: number;
  /** No target is lower than this (a ball scores at most six). */
  minTarget: number;
  /** SHA-256 of JSON.stringify({ targets, winPercent }): a hand edit changes it. */
  digest: string;
  targets: Readonly<Record<ChaseDifficulty, readonly number[]>>;
  winPercent: Readonly<Record<ChaseDifficulty, readonly number[]>>;
} = {
  policy: { id: '${D.REFERENCE_POLICY.id}', version: ${D.REFERENCE_POLICY.version} },
  assist: '${assist}',
  sigmaMs: ${D.REFERENCE_SIGMA_MS},
  tierShare: { easy: ${D.TIER_SHARE.easy}, standard: ${D.TIER_SHARE.standard}, hard: ${D.TIER_SHARE.hard} },
  tierFloor: { easy: ${D.TIER_FLOOR.easy}, standard: ${D.TIER_FLOOR.standard}, hard: ${D.TIER_FLOOR.hard} },
  minChance: ${D.MIN_CHANCE},
  minTarget: ${D.MIN_TARGET},
  digest: '${digest}',
  targets: {
${DIFFS.map((d) => `    ${d}: [\n${lines(targets[d])}\n    ],`).join('\n')}
  },
  winPercent: {
${DIFFS.map((d) => `    ${d}: [\n${lines(winPercent[d])}\n    ],`).join('\n')}
  },
};
`;
  if (args.includes('--write')) {
    writeFileSync(path.join(repoRoot, 'src/practice/chase/targets.ts'), src);
    run('npx', ['prettier', '--write', 'src/practice/chase/targets.ts']);
    console.log(`wrote src/practice/chase/targets.ts (digest ${digest})`);
  } else {
    process.stdout.write(src);
  }
} else if (command === 'validate') {
  const dir = arg('in');
  const M = Number(arg('innings', 200));
  const Mo = Number(arg('others', 100));
  const outFile = arg('out');
  if (!dir) throw new Error('--in <dir> is required');
  const EV = await import('../src/practice/game/evaluate.ts');
  const S = D.REFERENCE_SIGMA_MS;
  const REFNAME = `reference sigma ${S} (his best play)`;
  const report = [];
  for (const seed of all('seed')) {
    const r = JSON.parse(readFileSync(path.join(dir, `${seed}.json`), 'utf8'));
    const assist = r.assist;
    const def = { ...C.makeChase(seed, 'standard'), bowling: r.bowling ?? 'club' };
    const balls = REF.chaseEvalBalls(def);
    const pmfs = pmfsOf(r);
    const derived = D.targetsOf(pmfs);
    const t0 = performance.now();
    const row = { seed, assist, innings: M, otherInnings: Mo, tiers: {} };
    for (const tier of DIFFS) {
      const target = derived[tier].target;
      const opt = D.optimalChase(pmfs, target);
      /** Plays one innings with a choice of intent per (ball, runs needed); true when the target is reached. */
      const reaches = (choose, sigma, key) => {
        let need = target;
        for (let i = 0; i < balls.length; i++) {
          const intent = choose(i, need, `${key}|${i}`);
          const err = intent ? sigma * EV.gaussian(`${key}|${i}`) : 0;
          const res = EV.playBall(balls[i], intent, err, assist);
          if (res.outcome.dismissal) return false;
          need -= res.outcome.runs;
          if (need <= 0) return true;
        }
        return false;
      };
      const ref = (i, need) => r.options[i][opt.choice[i][need]].intent;
      const u = (key, n) => Math.min(1, Math.max(0, (EV.gaussian(`${key}|u${n}`) + 3) / 6));
      const policies = {
        [REFNAME]: { n: M, sigma: S, choose: ref },
        'same choices, sigma 10 (better timing)': { n: Mo, sigma: 10, choose: ref },
        'same choices, sigma 40 (typical timing)': { n: Mo, sigma: 40, choose: ref },
        'same choices, sigma 60 (looser timing)': { n: Mo, sigma: 60, choose: ref },
        'always defend': { n: Mo, sigma: 0, choose: () => ({ kind: 'defend', directionDeg: 0, elevation: 0, power: 0.2, footwork: 'auto' }) },
        'always leave': { n: Mo, sigma: 0, choose: () => null },
        'always drive straight': { n: Mo, sigma: S, choose: () => ({ kind: 'attack', directionDeg: 0, elevation: 0, power: 0.7, footwork: 'auto' }) },
        'rookie (shot ignores the ball, sigma 60)': {
          n: Mo,
          sigma: 60,
          choose: (_i, _need, key) => ({ kind: 'attack', directionDeg: -60 + 120 * u(key, 1), elevation: 0.6 * u(key, 2), power: 0.5 + 0.5 * u(key, 3), footwork: 'auto' }),
        },
        'random input': {
          n: Mo,
          sigma: 150,
          choose: (_i, _need, key) => {
            const k = u(key, 0);
            if (k < 0.15) return null;
            const fw = ['auto', 'forward', 'back', 'across'][Math.min(3, Math.floor(u(key, 5) * 4))];
            if (k < 0.3) return { kind: 'defend', directionDeg: -180 + 360 * u(key, 1), elevation: u(key, 2), power: u(key, 3), footwork: fw };
            return { kind: 'attack', directionDeg: -180 + 360 * u(key, 1), elevation: u(key, 2), power: u(key, 3), footwork: fw };
          },
          uniformError: true,
        },
      };
      const out = { target, predictedByProgram: derived[tier].win, policies: {} };
      for (const [name, p] of Object.entries(policies)) {
        if (!p.n) continue;
        let wins = 0;
        for (let k = 0; k < p.n; k++) {
          const key = `chase-validate|${seed}|${tier}|${name}|${k}`;
          const choose = p.uniformError
            ? (i, need, kk) => p.choose(i, need, kk)
            : p.choose;
          if (reaches(choose, p.sigma, key)) wins++;
        }
        const rate = wins / p.n;
        out.policies[name] = { innings: p.n, reached: wins, rate };
      }
      const obs = out.policies[REFNAME];
      const pr = derived[tier].win;
      out.zScore = (obs.rate - pr) / Math.sqrt(Math.max(1e-9, (pr * (1 - pr)) / obs.innings));
      row.tiers[tier] = out;
    }
    row.seconds = Math.round((performance.now() - t0) / 100) / 10;
    row.measured = { uptime: run('uptime'), node: process.version };
    report.push(row);
    console.log(
      `${seed} ` +
        DIFFS.map((d) => {
          const t = row.tiers[d];
          const o = t.policies[REFNAME];
          return `${d}: target ${t.target} program ${(100 * t.predictedByProgram).toFixed(1)}% played ${(100 * o.rate).toFixed(1)}% (z ${t.zScore.toFixed(2)})`;
        }).join(' | ') +
        ` ${row.seconds}s`,
    );
  }
  if (outFile) writeFileSync(outFile, `${JSON.stringify(report)}\n`);
} else if (command === 'converge') {
  const dir = arg('in');
  const points = Number(arg('points', 96));
  if (!dir) throw new Error('--in <dir> is required');
  // Inverse of the standard normal curve (Acklam's rational approximation, relative error below 1.2e-9).
  const inv = (p) => {
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
    const lo = 0.02425;
    if (p < lo) {
      const q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 1 - lo) return -inv(1 - p);
    const q = p - 0.5;
    const t = q * q;
    return ((((((a[0] * t + a[1]) * t + a[2]) * t + a[3]) * t + a[4]) * t + a[5]) * q) / (((((b[0] * t + b[1]) * t + b[2]) * t + b[3]) * t + b[4]) * t + 1);
  };
  const z = Array.from({ length: points }, (_, j) => inv((j + 0.5) / points));
  for (const seed of all('seed')) {
    const r = JSON.parse(readFileSync(path.join(dir, `${seed}.json`), 'utf8'));
    const def = { ...C.makeChase(seed, 'standard'), bowling: r.bowling ?? 'club' };
    const balls = REF.chaseEvalBalls(def).map((ball, i) => ({ ball, options: r.options[i] }));
    const t0 = performance.now();
    const fine = REF.referencePmfs(balls, r.assist, D.REFERENCE_SIGMA_MS, z);
    const coarse = pmfsOf(r);
    const tf = D.targetsOf(fine);
    const tc = D.targetsOf(coarse);
    let worst = 0;
    for (let t = 1; t <= 30; t++) worst = Math.max(worst, Math.abs(D.winProbability(fine, t) - D.winProbability(coarse, t)));
    console.log(
      `${seed} ${DIFFS.map((d) => `${d}: ${tc[d].target}->${tf[d].target}`).join(' ')} max |win(${r.quadraturePoints} points) - win(${points} points)| over targets 1..30 = ${worst.toFixed(4)} (${Math.round((performance.now() - t0) / 100) / 10}s)`,
    );
  }
} else if (command === 'assists') {
  const dir = arg('in');
  const outFile = arg('out');
  // The timing error of the batter whose chances are shown (default: the reference batter's own).
  const sigma = Number(arg('sigma', D.REFERENCE_SIGMA_MS));
  if (!dir) throw new Error('--in <dir> is required');
  const report = [];
  for (const seed of all('seed')) {
    const r = JSON.parse(readFileSync(path.join(dir, `${seed}.json`), 'utf8'));
    const def = { ...C.makeChase(seed, 'standard'), bowling: r.bowling ?? 'club' };
    const balls = REF.chaseEvalBalls(def).map((ball, i) => ({ ball, options: r.options[i] }));
    const play = pmfsOf(r);
    const targets = D.targetsOf(play);
    const t0 = performance.now();
    const row = { seed, sigma, targets: Object.fromEntries(DIFFS.map((d) => [d, targets[d].target])), winByAssist: {} };
    for (const assist of ['learn', 'play', 'real']) {
      const pmfs = assist === r.assist && sigma === D.REFERENCE_SIGMA_MS ? play : REF.referencePmfs(balls, assist, sigma);
      row.winByAssist[assist] = Object.fromEntries(DIFFS.map((d) => [d, D.winProbability(pmfs, targets[d].target)]));
    }
    row.seconds = Math.round((performance.now() - t0) / 100) / 10;
    report.push(row);
    console.log(
      `${seed} (timing ${sigma} ms) ` +
        DIFFS.map((d) => `${d} (target ${row.targets[d]}): learn ${(100 * row.winByAssist.learn[d]).toFixed(0)}% play ${(100 * row.winByAssist.play[d]).toFixed(0)}% real ${(100 * row.winByAssist.real[d]).toFixed(0)}%`).join(' | ') +
        ` ${row.seconds}s`,
    );
  }
  if (outFile) writeFileSync(outFile, `${JSON.stringify(report)}\n`);
} else if (command === 'hand') {
  const dir = arg('in');
  const outFile = arg('out');
  if (!dir) throw new Error('--in <dir> is required');
  const report = [];
  for (const seed of all('seed')) {
    const r = JSON.parse(readFileSync(path.join(dir, `${seed}.json`), 'utf8'));
    const def = { ...C.makeChase(seed, 'standard'), bowling: r.bowling ?? 'club' };
    const right = pmfsOf(r);
    const tr = D.targetsOf(right);
    const t0 = performance.now();
    const leftBalls = REF.referenceBalls(def, r.assist, 'left');
    const left = REF.referencePmfs(leftBalls, r.assist, D.REFERENCE_SIGMA_MS, D.QUADRATURE_Z, 'left');
    const tl = D.targetsOf(left);
    const row = {
      seed,
      right: Object.fromEntries(DIFFS.map((d) => [d, { target: tr[d].target, win: tr[d].win }])),
      left: Object.fromEntries(DIFFS.map((d) => [d, { target: tl[d].target, win: tl[d].win, winAtRightTarget: D.winProbability(left, tr[d].target) }])),
      seconds: Math.round((performance.now() - t0) / 100) / 10,
    };
    report.push(row);
    console.log(
      `${seed} ` +
        DIFFS.map((d) => `${d}: right ${row.right[d].target} (${(100 * row.right[d].win).toFixed(0)}%) left would get that target ${(100 * row.left[d].winAtRightTarget).toFixed(0)}% of the time, left's own target ${row.left[d].target}`).join(' | ') +
        ` ${row.seconds}s`,
    );
  }
  if (outFile) writeFileSync(outFile, `${JSON.stringify(report)}\n`);
} else if (command === 'report') {
  const dir = arg('in');
  const outFile = arg('out');
  if (!dir) throw new Error('--in <dir> is required');
  const files = [];
  for (let i = 0; i < C.CHASE_SEED_COUNT; i++) {
    const file = path.join(dir, `${C.chaseSeedAt(i)}.json`);
    if (existsSync(file)) files.push(JSON.parse(readFileSync(file, 'utf8')));
  }
  const q = (a, p) => {
    const b = [...a].sort((x, y) => x - y);
    return b[Math.min(b.length - 1, Math.max(0, Math.ceil(p * b.length) - 1))];
  };
  const stats = (a) => ({ n: a.length, min: Math.min(...a), p10: q(a, 0.1), p25: q(a, 0.25), median: q(a, 0.5), p75: q(a, 0.75), p90: q(a, 0.9), max: Math.max(...a), mean: Math.round((100 * a.reduce((x, y) => x + y, 0)) / a.length) / 100 });
  const histogram = (a) => {
    const h = {};
    for (const x of a) h[x] = (h[x] ?? 0) + 1;
    return h;
  };
  const rows = files.map((r) => ({ seed: r.seed, pmfs: pmfsOf(r), r }));
  const derived = rows.map((x) => D.targetsOf(x.pmfs));
  const report = { seeds: rows.length, sigmaMs: D.REFERENCE_SIGMA_MS, policy: D.REFERENCE_POLICY, tierShare: D.TIER_SHARE, tierFloor: D.TIER_FLOOR, minChance: D.MIN_CHANCE, minTarget: D.MIN_TARGET, tiers: {}, ordering: {}, ceiling: {}, menu: {}, timing: {} };
  for (const d of DIFFS) {
    const t = derived.map((x) => x[d].target);
    const w = derived.map((x) => Math.round(100 * x[d].win));
    report.tiers[d] = {
      target: stats(t),
      histogram: histogram(t),
      referenceWinPercent: stats(w),
      // floored: the floor raised the share's answer; lowered: then the minimum-chance rule lowered it (R-44); raised: the order rule raised it
      floorBinds: derived.filter((x) => x[d].floored).length,
      minChanceLowered: derived.filter((x) => x[d].lowered).length,
      orderRaised: derived.filter((x) => x[d].raised).length,
      belowMinChance: derived.filter((x) => x[d].win + 1e-12 < D.MIN_CHANCE).length,
      lowestReferenceWinPercent: Math.round(1000 * Math.min(...derived.map((x) => x[d].win))) / 10,
      atMostSix: t.filter((x) => x <= 6).length,
    };
  }
  report.ordering = {
    strictlyIncreasing: derived.filter((x) => x.easy.target < x.standard.target && x.standard.target < x.hard.target).length,
    equalEasyStandard: derived.filter((x) => x.easy.target === x.standard.target).length,
    equalStandardHard: derived.filter((x) => x.standard.target === x.hard.target).length,
  };
  // The tiers' targets for batters with other timing who still choose the best response every ball (an oracle-shot batter):
  // how often does each reach them? Only seeds that kept the tables for that timing count.
  report.otherTiming = {};
  for (const sg of [0, 10, 20, 40]) {
    const idx = rows.map((x, k) => [x, k]).filter(([x]) => (sg === D.REFERENCE_SIGMA_MS ? true : x.r.pmfBySigma?.[String(sg)] || x.r.sigmaMs === sg));
    if (!idx.length) continue;
    report.otherTiming[sg] = { seeds: idx.length };
    for (const d of DIFFS) {
      const wins = idx.map(([x, k]) => D.winProbability(pmfsOf(x.r, sg), derived[k][d].target));
      report.otherTiming[sg][d] = { meanPercent: Math.round(1000 * (wins.reduce((a, b) => a + b, 0) / wins.length)) / 10, minPercent: Math.round(1000 * Math.min(...wins)) / 10, maxPercent: Math.round(1000 * Math.max(...wins)) / 10 };
    }
  }
  // The ceiling: how often best play reaches a given number of runs, for several timing errors, across the seeds.
  const targetsList = [4, 6, 7, 8, 10, 12, 14, 16, 18, 20, 22, 24];
  for (const sg of [0, 20, 40]) {
    const have = rows.filter((x) => x.r.pmfBySigma?.[String(sg)] || x.r.sigmaMs === sg);
    if (!have.length) continue;
    const per = have.map((x) => pmfsOf(x.r, sg));
    report.ceiling[sg] = { seeds: have.length };
    for (const t of targetsList) {
      const wins = per.map((p) => D.winProbability(p, t));
      report.ceiling[sg][t] = { mean: Math.round(1000 * (wins.reduce((a, b) => a + b, 0) / wins.length)) / 10, min: Math.round(1000 * Math.min(...wins)) / 10, max: Math.round(1000 * Math.max(...wins)) / 10 };
    }
  }
  // A menu: the target at each share, for each timing error kept in the files.
  for (const sg of [20, 40]) {
    const have = rows.filter((x) => x.r.pmfBySigma?.[String(sg)] || x.r.sigmaMs === sg);
    if (!have.length) continue;
    const per = have.map((x) => pmfsOf(x.r, sg));
    report.menu[sg] = { seeds: have.length };
    for (const share of [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2, 0.15, 0.1, 0.05]) {
      const t = per.map((p) => D.targetAtShare(p, share, 1).target);
      report.menu[sg][share] = { min: Math.min(...t), p10: q(t, 0.1), median: q(t, 0.5), p90: q(t, 0.9), max: Math.max(...t) };
    }
  }
  report.timing = { coachMs: stats(files.map((r) => r.coachMs)), physicsMs: stats(files.map((r) => r.physicsMs)) };
  console.log(JSON.stringify(report, null, 1));
  if (outFile) writeFileSync(outFile, `${JSON.stringify(report, null, 1)}\n`);
} else if (command === 'distribution') {
  const dir = arg('in');
  const outFile = arg('out');
  if (!dir) throw new Error('--in <dir> is required');
  const files = [];
  for (let i = 0; i < C.CHASE_SEED_COUNT; i++) {
    const file = path.join(dir, `${C.chaseSeedAt(i)}.json`);
    if (existsSync(file)) files.push(JSON.parse(readFileSync(file, 'utf8')));
  }
  const SKILLS = [0, 20, 40].filter((sg) => files.every((r) => r.pmfBySigma?.[String(sg)] || r.sigmaMs === sg));
  /** Exact forward pass: his choices (from `choice`) played with the tables `pmfs`; the chances of every way it can end. */
  const forward = (pmfs, choice, target) => {
    let alive = new Map([[0, 1]]);
    const res = { win: 0, winLastBall: 0, winLastOver: 0, lostWicket: 0, lostBalls: 0, decidedLastBall: 0, decidedLastOver: 0, shortBins: { '1': 0, '2-3': 0, '4-6': 0, '7-10': 0, '11+': 0 }, spareBins: { '0': 0, '1-2': 0, '3-5': 0, '6+': 0 } };
    const bin = (x, edges) => edges.find(([lo, hi]) => x >= lo && x <= hi)[2];
    for (let i = 0; i < pmfs.length; i++) {
      const next = new Map();
      for (const [runs, mass] of alive) {
        const need = target - runs;
        const k = choice[i][need];
        const p = pmfs[i][Math.min(k, pmfs[i].length - 1)];
        // a dismissal ends it
        const out = mass * p.out;
        if (out) {
          res.lostWicket += out;
          if (i === 11) res.decidedLastBall += out;
          if (i >= 6) res.decidedLastOver += out;
          res.shortBins[bin(need, [[1, 1, '1'], [2, 3, '2-3'], [4, 6, '4-6'], [7, 10, '7-10'], [11, 99, '11+']])] += out;
        }
        for (let r = 0; r <= 6; r++) {
          if (!p.run[r]) continue;
          const m = mass * p.run[r];
          const total = runs + r;
          if (total >= target) {
            res.win += m;
            if (i === 11) res.winLastBall += m;
            if (i >= 6) res.winLastOver += m;
            if (i === 11) res.decidedLastBall += m;
            if (i >= 6) res.decidedLastOver += m;
            res.spareBins[bin(11 - i, [[0, 0, '0'], [1, 2, '1-2'], [3, 5, '3-5'], [6, 11, '6+']])] += m;
          } else if (i === 11) {
            res.lostBalls += m;
            res.decidedLastBall += m;
            res.decidedLastOver += m;
            res.shortBins[bin(target - total, [[1, 1, '1'], [2, 3, '2-3'], [4, 6, '4-6'], [7, 10, '7-10'], [11, 99, '11+']])] += m;
          } else next.set(total, (next.get(total) ?? 0) + m);
        }
      }
      alive = next;
    }
    return res;
  };
  const out = { seeds: files.length, skills: SKILLS, tiers: {} };
  for (const tier of DIFFS) {
    out.tiers[tier] = {};
    for (const sg of SKILLS) {
      const sums = {};
      for (const r of files) {
        const refPmfs = pmfsOf(r);
        const target = D.targetsOf(refPmfs)[tier].target;
        const opt = D.optimalChase(refPmfs, target);
        // his choices (index per ball and runs needed), played with the outcome tables of the skill under test
        const tables = pmfsOf(r, sg);
        const res = forward(tables, opt.choice, target);
        for (const [k, v] of Object.entries(res)) {
          if (typeof v === 'number') sums[k] = (sums[k] ?? 0) + v;
          else for (const [b, x] of Object.entries(v)) (sums[k] ??= {})[b] = (sums[k][b] ?? 0) + x;
        }
      }
      const n = files.length;
      const mean = (v) => (typeof v === 'number' ? Math.round((1000 * v) / n) / 10 : Object.fromEntries(Object.entries(v).map(([b, x]) => [b, Math.round((1000 * x) / n) / 10])));
      out.tiers[tier][sg] = Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, mean(v)]));
    }
  }
  console.log(JSON.stringify(out, null, 1));
  if (outFile) writeFileSync(outFile, `${JSON.stringify(out, null, 1)}\n`);
} else if (command === 'fairness') {
  const dir = arg('in');
  const nSeeds = Number(arg('seeds', 200));
  const attempts = Number(arg('attempts', 30));
  const outFile = arg('out');
  const from = Number(arg('from', 0));
  if (!dir) throw new Error('--in <dir> is required');
  const EV = await import('../src/practice/game/evaluate.ts');
  const FIXED = [
    ['always leave', null],
    ['forward defence', { kind: 'defend', directionDeg: 0, elevation: 0, power: 0.2, footwork: 'forward' }],
    ['back defence', { kind: 'defend', directionDeg: 0, elevation: 0, power: 0.2, footwork: 'back' }],
    ['straight drive', { kind: 'attack', directionDeg: 0, elevation: 0, power: 0.7, footwork: 'auto' }],
    ['cover drive', { kind: 'attack', directionDeg: 40, elevation: 0, power: 0.7, footwork: 'auto' }],
    ['cut', { kind: 'attack', directionDeg: 70, elevation: 0, power: 0.8, footwork: 'back' }],
    ['pull', { kind: 'attack', directionDeg: -60, elevation: 0.3, power: 0.8, footwork: 'back' }],
    ['flick', { kind: 'attack', directionDeg: -40, elevation: 0, power: 0.6, footwork: 'auto' }],
    ['lofted straight', { kind: 'attack', directionDeg: 0, elevation: 0.75, power: 0.85, footwork: 'auto' }],
    ['lofted leg side', { kind: 'attack', directionDeg: -35, elevation: 0.75, power: 0.85, footwork: 'auto' }],
  ];
  const S = D.REFERENCE_SIGMA_MS;
  /** One 12-ball innings with a choice of intent per (ball, runs so far): the cumulative runs before each ball and the ball he was out on. */
  const innings = (balls, assist, choose, sigma, key) => {
    let runs = 0;
    const path = [];
    for (let i = 0; i < balls.length; i++) {
      path.push(runs);
      const intent = choose(i, runs);
      const res = EV.playBall(balls[i], intent, intent && sigma ? sigma * EV.gaussian(`${key}|${i}`) : 0, assist);
      if (res.outcome.dismissal) return { path, outBall: i + 1, runs };
      runs += res.outcome.runs;
    }
    return { path, outBall: 0, runs };
  };
  /** Whether the innings reaches the target, and on which ball (0 if not). */
  const reach = (inn, target, nBalls) => {
    // runs after ball i+1 is path[i+1] (or the final runs for the last ball)
    for (let i = 0; i < nBalls; i++) {
      const after = i + 1 < inn.path.length ? inn.path[i + 1] : inn.runs;
      if (inn.outBall === i + 1) return 0;
      if (after >= target) return i + 1;
    }
    return 0;
  };
  const rows = [];
  const files = [];
  const only = all('seed');
  if (only.length) {
    for (const seed of only) files.push(JSON.parse(readFileSync(path.join(dir, `${seed}.json`), 'utf8')));
  } else {
    for (let i = from; i < Math.min(C.CHASE_SEED_COUNT, from + nSeeds); i++) {
      const file = path.join(dir, `${C.chaseSeedAt(i)}.json`);
      if (existsSync(file)) files.push(JSON.parse(readFileSync(file, 'utf8')));
    }
  }
  const t0 = performance.now();
  for (const r of files) {
    const assist = r.assist;
    const def = { ...C.makeChase(r.seed, 'standard'), bowling: r.bowling ?? 'club' };
    const balls = REF.chaseEvalBalls(def);
    const pmfs = pmfsOf(r);
    const targets = D.targetsOf(pmfs);
    const row = { seed: r.seed, targets: Object.fromEntries(DIFFS.map((d) => [d, targets[d].target])), fixed: {}, coachAware: {}, coachRecommended: {} };
    // nine fixed inputs, perfect timing and the reference timing (one seeded error per ball)
    for (const [name, intent] of FIXED) {
      row.fixed[name] = {};
      for (const [mode, sigma] of [['perfect timing', 0], [`sigma ${S}`, S]]) {
        const inn = innings(balls, assist, () => intent, sigma, `fairness|${r.seed}|${name}|${mode}`);
        row.fixed[name][mode] = Object.fromEntries(DIFFS.map((d) => [d, reach(inn, targets[d].target, balls.length) > 0]));
      }
    }
    // the coach's recommended response every ball, `attempts` tries (timing errors drawn afresh each try)
    const rec = (i) => r.options[i][0].intent;
    const recTries = Array.from({ length: attempts }, (_, k) => innings(balls, assist, (i) => rec(i), S, `fairness|${r.seed}|rec|${k}`));
    row.coachRecommended = Object.fromEntries(DIFFS.map((d) => [d, { wins: recTries.filter((x) => reach(x, targets[d].target, balls.length) > 0).length, tries: attempts }]));
    // the chase-aware coach policy: the best of the coach's three responses for the runs still needed (the policy the targets come from)
    for (const d of DIFFS) {
      const opt = D.optimalChase(pmfs, targets[d].target);
      let wins = 0;
      for (let k = 0; k < attempts; k++) {
        const inn = innings(balls, assist, (i, runs) => r.options[i][opt.choice[i][Math.max(1, targets[d].target - runs)]].intent, S, `fairness|${r.seed}|aware|${d}|${k}`);
        if (reach(inn, targets[d].target, balls.length) > 0) wins++;
      }
      row.coachAware[d] = { wins, tries: attempts };
    }
    rows.push(row);
    console.log(`${r.seed} targets ${DIFFS.map((d) => row.targets[d]).join('/')} coach-aware wins ${DIFFS.map((d) => row.coachAware[d].wins).join('/')} of ${attempts}, recommended-only ${DIFFS.map((d) => row.coachRecommended[d].wins).join('/')}`);
  }
  const summary = fairnessSummary(rows, attempts, { seconds: Math.round((performance.now() - t0) / 1000), uptime: run('uptime') });
  console.log(JSON.stringify(summary, null, 1));
  if (outFile) writeFileSync(outFile, `${JSON.stringify({ summary, rows })}\n`);
} else if (command === 'fairness-summary') {
  const parts = all('rows').map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const rows = parts.flatMap((p) => p.rows);
  const attempts = parts[0].summary.attempts;
  const summary = fairnessSummary(rows, attempts, { files: parts.length, uptime: run('uptime') });
  console.log(JSON.stringify(summary, null, 1));
  const outFile = arg('out');
  if (outFile) writeFileSync(outFile, `${JSON.stringify(summary, null, 1)}\n`);
} else if (command === 'fixture') {
  const dir = arg('in');
  const outFile = arg('out');
  if (!dir || !outFile) throw new Error('--in <dir> and --out <file> are required');
  const seed = arg('seed', 'c000');
  const r = JSON.parse(readFileSync(path.join(dir, `${seed}.json`), 'utf8'));
  const entry = r.pmfBySigma?.[String(D.REFERENCE_SIGMA_MS)] ?? (r.sigmaMs === D.REFERENCE_SIGMA_MS ? { points: r.quadraturePoints, counts: r.pmfCounts } : null);
  if (!entry) throw new Error(`${seed}: no tables at ${D.REFERENCE_SIGMA_MS} ms`);
  const targets = D.targetsOf(pmfsOf(r));
  const rounded = (x) => Math.round(x * 10000) / 10000;
  const fixture = {
    seed,
    assist: r.assist,
    sigmaMs: D.REFERENCE_SIGMA_MS,
    quadraturePoints: entry.points,
    policy: D.REFERENCE_POLICY,
    options: r.options,
    pmfCounts: entry.counts,
    targets: Object.fromEntries(DIFFS.map((d) => [d, { target: targets[d].target, win: rounded(targets[d].win), floored: targets[d].floored }])),
  };
  writeFileSync(outFile, JSON.stringify(fixture));
  console.log(`wrote ${outFile}`, JSON.stringify(fixture.targets));
} else if (command === 'min-chance-fixture') {
  // Every seed whose targets the minimum-chance and order rules (R-44) change, with the recorded outcome tables (the 24-point
  // counts at the reference timing) and the targets of policy v1 (`targetAtShare`) and of this policy (`targetsOf`).
  const dir = arg('in');
  const outFile = arg('out');
  if (!dir || !outFile) throw new Error('--in <dir> and --out <file> are required');
  const rounded = (x) => Math.round(x * 1e6) / 1e6;
  const seeds = [];
  for (let i = 0; i < C.CHASE_SEED_COUNT; i++) {
    const r = JSON.parse(readFileSync(path.join(dir, `${C.chaseSeedAt(i)}.json`), 'utf8'));
    const pmfs = pmfsOf(r);
    const v1 = Object.fromEntries(DIFFS.map((d) => [d, D.targetAtShare(pmfs, D.TIER_SHARE[d], D.TIER_FLOOR[d])]));
    const v2 = D.targetsOf(pmfs);
    if (!DIFFS.some((d) => v1[d].target !== v2[d].target)) continue;
    const entry = r.pmfBySigma?.[String(D.REFERENCE_SIGMA_MS)] ?? { points: r.quadraturePoints, counts: r.pmfCounts };
    seeds.push({
      seed: r.seed,
      pmfCounts: entry.counts,
      v1: Object.fromEntries(DIFFS.map((d) => [d, { target: v1[d].target, win: rounded(v1[d].win), floored: v1[d].floored }])),
      v2: Object.fromEntries(DIFFS.map((d) => [d, { target: v2[d].target, win: rounded(v2[d].win), floored: v2[d].floored, lowered: v2[d].lowered, raised: v2[d].raised }])),
    });
  }
  writeFileSync(outFile, `${JSON.stringify({ policy: D.REFERENCE_POLICY, sigmaMs: D.REFERENCE_SIGMA_MS, quadraturePoints: D.QUADRATURE_Z.length, minChance: D.MIN_CHANCE, minTarget: D.MIN_TARGET, seeds })}\n`);
  console.log(`wrote ${outFile}: ${seeds.length} seeds ${seeds.map((x) => x.seed).join(' ')}`);
} else if (command === 'check') {
  let bad = 0;
  for (const seed of all('seed')) {
    const i = C.chaseSeedIndex(seed);
    const r = deriveSeed(seed, T.TARGET_TABLE.assist);
    for (const d of DIFFS) {
      const ok = r.targets[d].target === T.TARGET_TABLE.targets[d][i] && Math.round(100 * r.targets[d].win) === T.TARGET_TABLE.winPercent[d][i];
      if (!ok) bad++;
      console.log(`${seed} ${d}: derived ${r.targets[d].target} (${Math.round(100 * r.targets[d].win)}%) table ${T.TARGET_TABLE.targets[d][i]} (${T.TARGET_TABLE.winPercent[d][i]}%) ${ok ? 'OK' : 'MISMATCH'}`);
    }
  }
  process.exit(bad ? 1 : 0);
} else {
  console.error('usage: chase-targets.mjs derive|table|check|validate|converge|assists|hand|report|sigmas|distribution|fairness|fairness-summary|fixture|min-chance-fixture (see the header of this file)');
  process.exit(2);
}
