#!/usr/bin/env node

// Read-only replay for the security regressions added after the preserved v2
// independent retest. It intentionally does not edit, replace, or reinterpret
// any v1/v2 report or reproduction artifact.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const EXPECTED = Object.freeze({
  'docs/evaluation/capture-compare/registration.v1.json': '09d600346e28523248573b0d42d3cde1492e86dfe95da8d70cb0886d7ecabc8a',
  'docs/evaluation/capture-compare/registration.v2.json': '79d2b8e7ee9ae521a49986980676579b4bb03f43150d65be812e127040a07178',
  'docs/evaluation/capture-compare/registration.v3.json': 'c2f08f63bfe4d3fe65ef26ec3a9a9273eb4f785fdac96bc6ff75c52895c31949',
  'docs/evaluation/capture-compare/visual-method.v1.json': '8a9f86be086096c8e8ed7ca1b6975d0bad1890ccc83e27b36a37d6f73135111f',
  'docs/evaluation/capture-compare/unity-export-trust.v1.json': 'ff6d17b9ba4eefd63cb3773f5116e1849ff717f0c64b445c5668bbc3f94886dc',
});

function sha256(file) {
  return createHash('sha256').update(readFileSync(resolve(REPO, file))).digest('hex');
}

function run(name, command, args) {
  const result = spawnSync(command, args, {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 10 * 60_000,
    maxBuffer: 16 * 1024 * 1024,
    env: process.env,
  });
  return {
    name,
    command: [command, ...args],
    status: result.status,
    signal: result.signal,
    stdout: String(result.stdout ?? '').slice(-8_000),
    stderr: String(result.stderr ?? '').slice(-8_000),
    ok: !result.error && result.signal === null && result.status === 0,
    error: result.error?.message ?? null,
  };
}

const preservedV2 = [
  'docs/evaluation/capture-compare/reviews/retest-v2/retest-v2.mjs',
  'docs/evaluation/capture-compare/reviews/retest-v2/INDEPENDENT-RETEST-V2-2026-10-29.md',
  'docs/evaluation/capture-compare/reviews/retest-v2/independent-retest-v2-2026-10-29.json',
];
const missingPreserved = preservedV2.filter((file) => !existsSync(resolve(REPO, file)));
const hashes = Object.fromEntries(Object.keys(EXPECTED).map((file) => [file, sha256(file)]));
const hashFailures = Object.entries(EXPECTED)
  .filter(([file, expected]) => hashes[file] !== expected)
  .map(([file, expected]) => ({ file, expected, observed: hashes[file] }));

const commands = [
  run('typecheck', 'npm', ['run', 'typecheck']),
  run('capture-compare-focused-tests', 'npx', [
    'vitest', 'run',
    'tests/unit/evaluation/capture-compare.test.ts',
    'tests/unit/evaluation/capture-compare-adversarial.test.ts',
    'tests/unit/evaluation/capture-compare-normalize.test.ts',
    '--maxWorkers=2',
  ]),
];
const report = {
  schemaVersion: 1,
  replay: 'capture-compare-retest-v3',
  generatedAtUtc: new Date().toISOString(),
  readOnly: true,
  preservedV2: {
    files: preservedV2,
    missing: missingPreserved,
    sha256: Object.fromEntries(preservedV2.filter((file) => existsSync(resolve(REPO, file))).map((file) => [file, sha256(file)])),
  },
  frozenArtifacts: { sha256: hashes, failures: hashFailures },
  commands,
  ok: missingPreserved.length === 0 && hashFailures.length === 0 && commands.every((item) => item.ok),
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;
