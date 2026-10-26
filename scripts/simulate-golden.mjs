#!/usr/bin/env node
/**
 * Golden replay fixture for engine v1.
 *
 *   node scripts/simulate-golden.mjs           # verify the committed fixture with the engine (and compare a regeneration)
 *   node scripts/simulate-golden.mjs --write   # (re)write tests/unit/engine/fixtures/golden-v1.json
 *
 * Write it ONCE when v1 is frozen. After that, never rewrite it: the fixture is what proves that old replays still
 * verify. A rule change that alters outcomes must become engine version 2 (with its own golden file).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from './simulate-loader.mjs';

const { goldenLogs } = await import('../src/engine/sim/golden.ts');
const { engine } = await import('../src/engine/index.ts');
const { sha256Hex } = await import('../src/engine/sha256.ts');
const { canonicalJson } = await import('../src/engine/canonical.ts');

const file = path.join(repoRoot, 'tests/unit/engine/fixtures/golden-v1.json');
const logs = await goldenLogs();
for (const log of logs) {
  const v = await engine.verifyMatchLog(log);
  if (!v.ok) throw new Error(`golden log ${log.matchId} does not verify: ${v.errors.join(',')}`);
}
const body = { engine: 1, note: 'Frozen engine-v1 replays. Never regenerate: a rule change that alters outcomes is a new engine version.', logs };
// One compact line per log keeps the file small and diffs readable.
const text = `{"engine":1,"note":${JSON.stringify(body.note)},"logs":[\n${logs.map((l) => JSON.stringify(l)).join(',\n')}\n]}\n`;
const digest = sha256Hex(canonicalJson(body));

if (process.argv.includes('--write')) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  console.log(`wrote ${path.relative(repoRoot, file)} (${logs.length} logs, ${text.length} bytes, canonical sha256 ${digest})`);
} else if (!existsSync(file)) {
  console.log(`no fixture yet; run with --write. canonical sha256 would be ${digest}`);
} else {
  // The real compatibility check: every committed v1 replay must still verify with the engine.
  const committed = JSON.parse(readFileSync(file, 'utf8'));
  const failures = [];
  for (const log of committed.logs) {
    const v = await engine.verifyMatchLog(log);
    if (!v.ok) failures.push(`${log.matchId}: ${v.errors.join(',')}`);
  }
  const committedDigest = sha256Hex(canonicalJson(committed));
  if (failures.length) console.log(`committed replays FAIL to verify (v1 rules changed: make it engine version 2):\n  ${failures.join('\n  ')}`);
  else console.log(`committed fixture verifies (${committed.logs.length} logs, canonical sha256 ${committedDigest})`);
  // Informational: regenerating uses the ghosts and Auto Over, which may evolve without changing any rule.
  console.log(canonicalJson(committed) === canonicalJson(body) ? 'regeneration is identical' : 'regeneration differs (policies changed; the committed fixture stays the reference)');
  process.exit(failures.length ? 1 : 0);
}
