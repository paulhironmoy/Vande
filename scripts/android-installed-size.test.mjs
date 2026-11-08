#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';
import { assessStableSamples, parseStorageStats, validateFirstPlayableTiming } from './android-installed-size.mjs';

const primary = [
  'code: 43753472 bytes',
  'data: 12259328 bytes',
  'cache: 815104 bytes',
  'apk: 40000000 bytes',
].join('\n');

test('API-36 primary rows use BigInt code+data and never add cache twice', () => {
  const parsed = parseStorageStats(primary);
  assert.equal(parsed.code, 43_753_472n);
  assert.equal(parsed.data, 12_259_328n);
  assert.equal(parsed.cache, 815_104n);
  assert.equal(parsed.freshInstalledBytes, 56_012_800n);
  assert.equal(parsed.optionalBreakdown, 'COMPLETE');
});

test('exact observed API-36 human-readable suffixes preserve authoritative integer bytes', () => {
  const parsed = parseStorageStats([
    'code: 43753472 bytes (41.73 Mb)',
    'data: 12259328 bytes (11.69 Mb)',
    'cache: 815104 bytes (796.00 Kb)',
  ].join('\n'));
  assert.equal(parsed.freshInstalledBytes, 56_012_800n);
  assert.throws(() => parseStorageStats([
    'code: 43753472 bytes (41.72 Mb)',
    'data: 12259328 bytes (11.69 Mb)',
    'cache: 815104 bytes (796.00 Kb)',
  ].join('\n')), /suffix does not match/u);
});

test('post-primary optional SecurityException is tolerated and labelled partial', () => {
  const detail = 'java.lang.SecurityException: requires permission';
  const parsed = parseStorageStats(`${primary}\nException occurred while executing 'get-package-storage-stats':\n${detail}`, {
    status: 255,
    stderr: `${detail}\n`,
  });
  assert.equal(parsed.freshInstalledBytes, 56_012_800n);
  assert.equal(parsed.optionalBreakdown, 'PARTIAL_AFTER_PRIMARY_SECURITY_EXCEPTION');
  assert.equal(parsed.optionalBreakdownGrammar, 'API36_COMMAND_SECURITY_EXCEPTION_V1');
});

test('observed API-36 failure prefixes are exact and cross-stream details must match', () => {
  const detail = 'java.lang.SecurityException: Package android.uid.shell:2000 from UID 2000 blocked by mode 1';
  const parsed = parseStorageStats(`${primary}\nFailure [failed to get storage stats], reason: ${detail}`, {
    status: 255,
    stderr: `Failed to get storage stats, reason: ${detail}\n`,
  });
  assert.equal(parsed.optionalBreakdown, 'PARTIAL_AFTER_PRIMARY_SECURITY_EXCEPTION');
  assert.equal(parsed.optionalBreakdownGrammar, 'API36_STORAGE_FAILURE_REASON_V1');
  assert.throws(() => parseStorageStats(`${primary}\nFailure [failed to get storage stats], reason: ${detail}`, {
    status: 255,
    stderr: 'Failed to get storage stats, reason: java.lang.SecurityException: different detail\n',
  }), /do not match across stdout and stderr/u);
  assert.throws(() => parseStorageStats(primary, {
    status: 255,
    stderr: 'unrecognized arbitrary prose java.lang.SecurityException: unrelated\n',
  }), /unrecognized StorageStats stderr/u);
  assert.throws(() => parseStorageStats(`${primary}\nFailure [failed to get storage stats], reason: ${detail}`, {
    status: 255,
    stderr: `${detail}\n`,
  }), /record grammar does not match/u);
});

test('exact API-36 primary-then-optional SecurityException stream is partial, not failed or complete', () => {
  const stdout = [
    'code: 43753472 bytes (41.73 Mb)',
    'data: 12259328 bytes (11.69 Mb)',
    'cache: 815104 bytes (796.00 Kb)',
    "Exception occurred while executing 'get-package-storage-stats':",
    'java.lang.SecurityException: requires permission',
  ].join('\n');
  const parsed = parseStorageStats(stdout, {
    status: 255,
    stderr: 'java.lang.SecurityException: requires permission\n',
  });
  assert.equal(parsed.freshInstalledBytes, 56_012_800n);
  assert.equal(parsed.optionalBreakdown, 'PARTIAL_AFTER_PRIMARY_SECURITY_EXCEPTION');
});

test('missing, duplicate, reordered, invalid-cache and unrelated failures reject', () => {
  assert.throws(() => parseStorageStats('code: 1 bytes\ndata: 2 bytes\n'), /missing mandatory cache/u);
  assert.throws(() => parseStorageStats('code: 1 bytes\ncode: 1 bytes\ndata: 2 bytes\ncache: 0 bytes\n'), /duplicate code/u);
  assert.throws(() => parseStorageStats('data: 2 bytes\ncode: 1 bytes\ncache: 0 bytes\n'), /not in code\/data\/cache order/u);
  assert.throws(() => parseStorageStats('code: 1 bytes\ndata: 2 bytes\ncache: 3 bytes\n'), /exceeds data/u);
  assert.throws(() => parseStorageStats(primary, { status: 1, stderr: 'java.lang.IllegalStateException: broken' }), /expected.*255/u);
});

test('SecurityException policy requires status 255 and diagnostics only after primary rows', () => {
  assert.throws(() => parseStorageStats(primary, {
    status: 0,
    stderr: 'java.lang.SecurityException: denied\n',
  }), /successful.*exception/u);
  assert.throws(() => parseStorageStats(`java.lang.SecurityException: denied\n${primary}`, {
    status: 255,
  }), /before all mandatory/u);
  assert.throws(() => parseStorageStats(primary, {
    status: 254,
    stderr: 'java.lang.SecurityException: denied\n',
  }), /expected.*255/u);
  assert.throws(() => parseStorageStats(primary, {
    status: 255,
    stderr: 'java.lang.SecurityException: denied\n',
  }), /recognized post-primary stdout failure record/u);
});

test('negative, signed-long overflow and code-plus-data overflow fail closed', () => {
  assert.throws(() => parseStorageStats('code: -1 bytes\ndata: 0 bytes\ncache: 0 bytes\n'), /missing mandatory code/u);
  assert.throws(() => parseStorageStats('code: 9223372036854775808 bytes\ndata: 0 bytes\ncache: 0 bytes\n'), /signed Android long/u);
  assert.throws(() => parseStorageStats('code: 9223372036854775807 bytes\ndata: 1 bytes\ncache: 0 bytes\n'), /code \+ data/u);
});

test('two identical code/data samples are stable even when cache diagnostics differ', () => {
  const first = parseStorageStats(primary);
  const second = parseStorageStats(primary.replace('cache: 815104', 'cache: 815105'));
  const result = assessStableSamples([first, second]);
  assert.equal(result.stable, true);
  assert.equal(result.freshInstalledBytes, 56_012_800n);
  assert.equal(result.localThresholdPass, false);
});

test('unstable code/data samples remain UNPROVEN rather than selecting the smaller value', () => {
  const first = parseStorageStats(primary);
  const second = parseStorageStats(primary.replace('data: 12259328', 'data: 12259329'));
  const result = assessStableSamples([first, second]);
  assert.equal(result.stable, false);
  assert.equal(result.freshInstalledBytes, null);
  assert.equal(result.localThresholdPass, null);
  assert.equal(result.status, 'UNSTABLE_UNPROVEN');
});

test('stale/reinstalled boundary timing cannot drive a current local measurement', () => {
  assert.match(validateFirstPlayableTiming({
    boundaryUtc: '2020-01-01T00:00:00.000Z',
    installStartedUtc: '2026-10-29T02:00:00.000Z',
    installFinishedUtc: '2026-10-29T02:00:01.000Z',
    nowMs: Date.parse('2026-10-29T02:01:00.000Z'),
  }).join('; '), /precedes install|stale/u);
  assert.deepEqual(validateFirstPlayableTiming({
    boundaryUtc: '2026-10-29T02:00:02.000Z',
    installStartedUtc: '2026-10-29T02:00:00.000Z',
    installFinishedUtc: '2026-10-29T02:00:01.000Z',
    nowMs: Date.parse('2026-10-29T02:01:00.000Z'),
  }), []);
});
