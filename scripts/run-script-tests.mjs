#!/usr/bin/env node
/**
 * Runs every *.test.mjs file under scripts/ with node:test, two files at a time, so no script test is left without a runner.
 *
 *   npm run scripts:test               run them all
 *   npm run scripts:test -- --list     print what runs and what is excluded, with the reason for each exclusion
 *   npm run scripts:test -- --test-name-pattern=<regex>      any other argument goes to `node --test`
 *
 * The runner finds the files itself, so a new test is picked up by its name. A file that cannot pass on a clean checkout
 * must be named in EXCLUDED with the reason; nothing is left out silently. A test that skips itself inside a file (for
 * example when a pinned source is not on this machine) prints its own reason in the report.
 *
 * Needs Node 22.22.2+ or 23.6+ (package.json "engines"): several tests import TypeScript sources directly.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Left out of this runner: path from the repository root -> why. Each still runs wherever its prerequisite exists. */
const EXCLUDED = {
  'scripts/audio/placeholders.test.mjs':
    'renders MP3s that must equal the shipped files byte for byte, which needs the ffmpeg 9.x that made them (their encoder ' +
    'tag is Lavc63.1); run it on a machine with that ffmpeg: `npm run audio:tools:test`',
  'scripts/audio/ingest-recordings.test.mjs':
    'renders MP3s with ffmpeg and compares them with the shipped files; needs the same ffmpeg 9.x: `npm run audio:tools:test`',
  'scripts/audio/freesound-search.test.mjs':
    'compares a local report under the ignored release/ folder (sound/FREESOUND-SEARCH.md) with the generator output, so it ' +
    'only passes on the machine that holds that report: `npm run audio:tools:test`',
  'scripts/export-unity-production-human.test.mjs':
    'one assertion checks the size and SHA-256 of package.json and package-lock.json against the pins in ' +
    'docs/licenses/makehuman-v1.3.0/production-human-provenance.json (the Unity Characters/provenance.json pins them too); ' +
    'every edit of those two files stales the pins, and both are stale now. The pins need regenerating or dropping; the ' +
    'file\'s other tests pass (`node --test scripts/export-unity-production-human.test.mjs`)',
};

const files = readdirSync(path.join(root, 'scripts'), { recursive: true })
  .map((file) => `scripts/${String(file).split(path.sep).join('/')}`)
  .filter((file) => file.endsWith('.test.mjs') && !file.split('/').includes('node_modules'))
  .sort();

const stale = Object.keys(EXCLUDED).filter((file) => !files.includes(file));
if (stale.length > 0) {
  console.error(`scripts/run-script-tests.mjs: EXCLUDED names files that no longer exist: ${stale.join(', ')}`);
  process.exit(2);
}
const included = files.filter((file) => !(file in EXCLUDED));
if (included.length === 0) {
  console.error('scripts/run-script-tests.mjs: no scripts/**/*.test.mjs file found');
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.includes('--list')) {
  console.log(`Run (${included.length}):\n${included.map((file) => `  ${file}`).join('\n')}`);
  console.log(`\nExcluded (${Object.keys(EXCLUDED).length}):`);
  for (const [file, why] of Object.entries(EXCLUDED)) console.log(`  ${file}\n    ${why}`);
  process.exit(0);
}

console.log(
  `scripts:test: ${included.length} files; ${Object.keys(EXCLUDED).length} excluded with a reason (npm run scripts:test -- --list)`,
);
const run = spawnSync(
  process.execPath,
  ['--test', '--test-reporter=spec', '--test-concurrency=2', ...args, ...included],
  { cwd: root, stdio: 'inherit' },
);
if (run.error) {
  console.error(run.error.message);
  process.exit(2);
}
process.exit(run.status ?? 1);
