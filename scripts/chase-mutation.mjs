#!/usr/bin/env node
/**
 * Mutation check for the chase logic (definition of done CHC-13): breaks the rules on purpose, one change at a time, in a
 * copy of src/practice/chase, and runs the chase unit tests against the copy. A mutant is KILLED when a test fails.
 * The real source is never touched: a temporary vitest config sends the imports of `@/practice/chase` to the copy.
 *
 *   node scripts/chase-mutation.mjs [--only M01,M05] [--out <report.json>] [--keep]
 *
 * Run it through the shared-machine wrapper (`sh <scratch>/heavy.sh chase-mutation node scripts/chase-mutation.mjs`): each
 * mutant is one short vitest run.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { repoRoot } from './simulate-loader.mjs';

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

/** [id, file, text to find, replacement, what it breaks] */
const MUTANTS = [
  // The control: nothing is changed, so every test must pass. If it does not, the harness itself is broken and no result counts.
  ['M00', 'rules.ts', 'export const isDecided', 'export const isDecided', 'CONTROL: no change at all (the tests must pass)'],
  ['M01', 'rules.ts', 'else if (runs >= def.target) result', 'else if (runs > def.target) result', 'reaching the target exactly no longer wins'],
  ['M02', 'rules.ts', 'else if (ballsFaced >= def.balls) result', 'else if (ballsFaced > def.balls) result', 'the 12th ball no longer ends the chase'],
  ['M03', 'rules.ts', 'const ballsLeft = def.balls - ballsFaced;', 'const ballsLeft = action.dismissal ? 0 : def.balls - ballsFaced;', 'an early wicket zeroes the balls left'],
  ['M04', 'rules.ts', 'const runsNeeded = Math.max(0, def.target - runs);', 'const runsNeeded = def.target - runs;', 'runs needed can go below zero'],
  ['M05', 'rules.ts', 'Math.floor((runsNeeded * 1200 + ballsLeft) / (2 * ballsLeft))', 'Math.floor((runsNeeded * 1200) / (2 * ballsLeft))', 'the required rate rounds down instead of half up'],
  ['M06', 'rules.ts', "if (state.result !== 'in_progress') return 'chase_over';\n      const due", "const due", 'a ball is accepted after the chase is decided'],
  [
    'M07',
    'rules.ts',
    "if (action.dismissal) result = 'lost_wicket';\n      else if (runs >= def.target) result = 'won';\n      else if (ballsFaced >= def.balls) result = 'lost_balls';",
    "if (ballsFaced >= def.balls && runs < def.target) result = 'lost_balls';\n      else if (action.dismissal) result = 'lost_wicket';\n      else if (runs >= def.target) result = 'won';",
    'a wicket on the 12th ball is called a loss by the balls',
  ],
  ['M08', 'rules.ts', 'practiceThisBall: decided,', 'practiceThisBall: true,', '"Practice this ball" is allowed during a chase'],
  ['M09', 'rules.ts', 'restartOver: false,', 'restartOver: true,', '"Restart over" is allowed in a chase'],
  ['M10', 'plan.ts', "if (action.type === 'restartOver') return 'restart_not_allowed_in_chase';", '', 'the innings reducer is allowed to restart an over in a chase'],
  ['M11', 'seeds.ts', 'TARGET_TABLE.targets[difficulty]?.[i]', 'TARGET_TABLE.targets.standard[i]', 'the difficulty no longer changes the target'],
  ['M12', 'situation.ts', 'state.runsNeeded <= CHASE_MAX_RUNS_PER_BALL * state.ballsLeft', 'state.runsNeeded < CHASE_MAX_RUNS_PER_BALL * state.ballsLeft', 'a target that exactly needs a six a ball is called out of reach'],
  ['M13', 'rules.ts', 'overIndex: Math.floor(ballsFaced / CHASE_BALLS_PER_OVER)', 'overIndex: Math.ceil(ballsFaced / CHASE_BALLS_PER_OVER)', 'the ball due next is in the wrong over'],
  ['M14', 'history.ts', '.slice(0, CHASE_HISTORY_MAX)', '.slice(0, CHASE_HISTORY_MAX + 1)', 'the history keeps one result too many'],
  ['M15', 'plan.ts', "if (state.result !== 'in_progress') return 'chase_over';\n  if (action.type === 'chooseOver') {", "if (action.type === 'chooseOver') {", 'balls and overs are accepted in a chase that is decided'],
  // Ruling R-44 (policy v2): the minimum chance and the order rule of the target method.
  ['M16', 'derive.ts', 'if (base.win + 1e-12 >= MIN_CHANCE) return base;', 'return base;', 'the minimum-chance rule is switched off (a tier can leave the reference batter almost no chance)'],
  ['M17', 'derive.ts', 'if (tier.target > easier.target) return tier;', 'return tier;', 'the order rule is switched off (two tiers of a seed can share a target)'],
  ['M18', 'derive.ts', 'const least = targetAtShare(balls, MIN_CHANCE, MIN_TARGET);', 'const least = targetAtShare(balls, MIN_CHANCE, 1);', 'the minimum-chance rule may go below 7 (a target of one ball\'s work)'],
  ['M19', 'derive.ts', 'if (base.win + 1e-12 >= MIN_CHANCE) return base;', 'if (Math.round(100 * base.win) >= 100 * MIN_CHANCE) return base;', 'the minimum-chance rule reads the rounded percent, not the exact chance (9.76% passes as 10%)'],
];

const TESTS = ['rules', 'plan', 'situation', 'history', 'seeds', 'dod', 'derive', 'min-chance'].map((n) => `tests/unit/practice/chase/${n}.test.ts`);
const work = mkdtempSync(path.join(tmpdir(), 'chase-mutation-'));
const report = [];

const only = arg('only')?.split(',');
for (const [id, file, find, replace, what] of MUTANTS) {
  if (only && !only.includes(id)) continue;
  const dir = path.join(work, id);
  const copy = path.join(dir, 'chase');
  mkdirSync(copy, { recursive: true });
  for (const f of readdirSync(path.join(repoRoot, 'src/practice/chase'))) cpSync(path.join(repoRoot, 'src/practice/chase', f), path.join(copy, f));
  const target = path.join(copy, file);
  const source = readFileSync(target, 'utf8');
  if (!source.includes(find)) {
    report.push({ id, what, status: 'NOT APPLIED (text not found)' });
    console.log(`${id} NOT APPLIED: ${what}`);
    continue;
  }
  writeFileSync(target, source.replace(find, replace));
  const config = path.join(dir, 'vitest.config.mjs');
  writeFileSync(
    config,
    `// A plain object: this file lives outside the repository, where 'vitest/config' cannot be imported.
export default {
  root: ${JSON.stringify(repoRoot)},
  resolve: { alias: [
    { find: /^@\\/practice\\/chase(\\/.*)?$/, replacement: ${JSON.stringify(copy)} + '$1' },
    { find: /^@\\//, replacement: ${JSON.stringify(path.join(repoRoot, 'src'))} + '/' },
  ] },
  test: { environment: 'node', include: ${JSON.stringify(TESTS)}, setupFiles: ['./tests/setup.ts'], testTimeout: 30000, css: false },
};
`,
  );
  const r = spawnSync(path.join(repoRoot, 'node_modules/.bin/vitest'), ['run', '--config', config, '--maxWorkers=2', '--bail=1', '--reporter=default'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const out = `${r.stdout}\n${r.stderr}`;
  const ran = /Tests\s+.*(passed|failed)/.test(out);
  const failedTests = [...out.matchAll(/FAIL\s+(\S+) > (.+)/g)].map((m) => `${path.basename(m[1])} > ${m[2]}`.trim());
  const passedCount = /Tests\s+(?:\d+ failed \| )?(\d+) passed/.exec(out)?.[1] ?? '0';
  let status;
  if (id === 'M00') status = r.status === 0 && ran ? 'CONTROL PASSES' : 'HARNESS BROKEN';
  else if (!ran) status = 'HARNESS ERROR';
  else status = r.status !== 0 && failedTests.length > 0 ? 'KILLED' : 'SURVIVED';
  report.push({ id, what, status, firstFailures: failedTests.slice(0, 3), testsPassedBeforeStop: Number(passedCount) });
  console.log(`${id} ${status}: ${what}${failedTests.length ? `\n      first failing test: ${failedTests[0]}` : ''}`);
}

const real = report.filter((x) => x.id !== 'M00');
const killed = real.filter((x) => x.status === 'KILLED').length;
const control = report.find((x) => x.id === 'M00');
console.log(`\n${killed} of ${real.length} mutants killed${control ? `; control: ${control.status}` : ''}`);
if (arg('out')) writeFileSync(arg('out'), `${JSON.stringify({ mutants: report, killed, total: real.length }, null, 2)}\n`);
if (!args.includes('--keep')) rmSync(work, { recursive: true, force: true });
process.exit(killed === real.length && (!control || control.status === 'CONTROL PASSES') ? 0 : 1);
