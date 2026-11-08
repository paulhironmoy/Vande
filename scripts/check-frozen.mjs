#!/usr/bin/env node
/**
 * Verifies the physics freeze 5f: every file named in docs/FROZEN-5f.sha256 (the 25 files of src/physics/ and
 * src/render3d/practice/frame.ts) still has the recorded SHA-256. Node only (node:crypto, no shell), so it runs the same
 * in CI and on a developer machine.
 *
 *   node scripts/check-frozen.mjs                          verify the list in docs/FROZEN-5f.sha256 against this checkout
 *   node scripts/check-frozen.mjs --list <file> --root <dir>   another list or another root (the tests use a temp dir)
 *
 * Prints `N of M OK`; exit 0 when N equals M, exit 1 on any mismatch or missing file (each is named on stderr), exit 2
 * when the list is unreadable or malformed. The list is `shasum -a 256` output (`<64 hex digits>  <path>`, paths
 * relative to the root), so `shasum -a 256 -c docs/FROZEN-5f.sha256` checks the same files.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_LIST = path.join(REPO_ROOT, 'docs', 'FROZEN-5f.sha256');

/** Parses the list text into [{ sha256, file }]; throws on a blank list, a malformed line or an unsafe path. */
export function parseList(text) {
  const entries = [];
  for (const [index, raw] of text.split('\n').entries()) {
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '') continue;
    const match = /^([0-9a-f]{64}) {2}(\S.*)$/.exec(line);
    if (!match) throw new Error(`line ${index + 1} is not "<64 hex digits>  <path>": ${JSON.stringify(line)}`);
    const file = match[2];
    if (path.isAbsolute(file) || file.split('/').includes('..')) throw new Error(`line ${index + 1}: unsafe path ${file}`);
    entries.push({ sha256: match[1], file });
  }
  if (entries.length === 0) throw new Error('the list has no entries');
  return entries;
}

/** Hashes every listed file under root. Returns { total, ok, failures: [{ file, reason }] }. */
export function checkFrozen({ listFile = DEFAULT_LIST, root = REPO_ROOT } = {}) {
  const entries = parseList(readFileSync(listFile, 'utf8'));
  const failures = [];
  for (const { sha256, file } of entries) {
    let bytes;
    try {
      bytes = readFileSync(path.join(root, file));
    } catch (error) {
      failures.push({ file, reason: `missing (${error.code ?? error.message})` });
      continue;
    }
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== sha256) failures.push({ file, reason: `changed: expected ${sha256}, found ${actual}` });
  }
  return { total: entries.length, ok: entries.length - failures.length, failures };
}

function main(argv) {
  const option = (name) => (argv.includes(name) ? path.resolve(argv[argv.indexOf(name) + 1] ?? '') : undefined);
  let result;
  try {
    result = checkFrozen({ listFile: option('--list'), root: option('--root') });
  } catch (error) {
    console.error(`check-frozen: ${error.message}`);
    return 2;
  }
  for (const { file, reason } of result.failures) console.error(`FROZEN FILE ${file}: ${reason}`);
  console.log(`${result.ok} of ${result.total} OK`);
  return result.failures.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
