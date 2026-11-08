#!/usr/bin/env node

/**
 * Atomic no-overwrite promotion for Android release artifacts.
 *
 * Every source and target parent must be on the same filesystem. `link(2)` is
 * the exclusive primitive: an existing/racing target returns EEXIST and is
 * never replaced. On a later-pair failure, only links whose exact inode was
 * created by this invocation are removed. Sources remain for the caller's
 * invocation-owned cleanup.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  linkSync,
  lstatSync,
  readFileSync,
  realpathSync,
  unlinkSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  stableStringify,
  validatePayloadBindingSidecar,
} from './android-unity-payload-binding.mjs';

function fail(message) { throw new Error(message); }

function canonicalRegular(path, label) {
  if (typeof path !== 'string' || !path.startsWith('/') || resolve(path) !== path || /[\0\r\n]/u.test(path)) {
    fail(`${label} must be a normalized absolute path`);
  }
  const info = lstatSync(path, { bigint: true });
  if (!info.isFile() || info.isSymbolicLink() || realpathSync(path) !== path) {
    fail(`${label} must be a canonical regular non-symbolic-link file`);
  }
  const bytes = readFileSync(path);
  return { path, info, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function canonicalParent(path, label) {
  const parent = dirname(path);
  if (realpathSync(parent) !== parent) fail(`${label} parent must be canonical and contain no symbolic link`);
  const info = lstatSync(parent, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink()) fail(`${label} parent must be a regular directory`);
  return info;
}

function sameObject(info, expected) {
  return info.dev === expected.dev && info.ino === expected.ino;
}

function sameSnapshot(info, expected) {
  return sameObject(info, expected) && info.size === expected.size;
}

export function promoteExclusively(pairs, { beforeLink = null, expectedSources = null } = {}) {
  if (!Array.isArray(pairs) || pairs.length === 0) fail('promotion needs at least one source/target pair');
  if (expectedSources !== null && !(expectedSources instanceof Map)) {
    fail('expectedSources must be a Map when supplied');
  }
  const prepared = pairs.map((pair, index) => {
    if (!pair || Object.keys(pair).sort().join(',') !== 'source,target') fail(`pair ${index} is invalid`);
    const source = canonicalRegular(pair.source, `pair ${index} source`);
    if (typeof pair.target !== 'string' || !pair.target.startsWith('/')
        || resolve(pair.target) !== pair.target || /[\0\r\n]/u.test(pair.target)) {
      fail(`pair ${index} target must be a normalized absolute path`);
    }
    const parent = canonicalParent(pair.target, `pair ${index} target`);
    if (source.info.dev !== parent.dev) fail(`pair ${index} source and target are not on the same filesystem`);
    if (existsSync(pair.target)) fail(`refusing to overwrite existing release artifact: ${pair.target}`);
    const expected = expectedSources?.get(source.path);
    if (expected && (source.info.size !== BigInt(expected.bytes) || source.sha256 !== expected.sha256)) {
      fail(`pair ${index} source differs from its bound release-set identity`);
    }
    return { ...pair, source };
  });
  if (expectedSources !== null) {
    const preparedPaths = new Set(prepared.map((pair) => pair.source.path));
    for (const path of expectedSources.keys()) {
      if (!preparedPaths.has(path)) fail(`bound release-set source is absent from promotion pairs: ${path}`);
    }
  }
  const created = [];
  try {
    for (const [index, pair] of prepared.entries()) {
      beforeLink?.(pair, index);
      linkSync(pair.source.path, pair.target);
      const target = canonicalRegular(pair.target, `pair ${index} promoted target`);
      // Register the exact inode created by link(2) before checking it against
      // the prepared source. If the source path was swapped in the race, the
      // wrong link is still ours and must be removed on rejection. A later
      // replacement at the target path is protected by the inode guard below.
      created.push({ path: pair.target, info: target.info, sha256: target.sha256, source: pair.source });
      if (!sameSnapshot(target.info, pair.source.info) || target.sha256 !== pair.source.sha256) {
        fail(`pair ${index} promoted target does not share the source identity`);
      }
    }
    // Recheck every pair after the final link. A mutation of an earlier
    // hard-linked source while a later pair is promoted changes its target too
    // and must fail the transaction before success is reported.
    for (const [index, entry] of created.entries()) {
      const source = canonicalRegular(entry.source.path, `pair ${index} final source`);
      const target = canonicalRegular(entry.path, `pair ${index} final target`);
      if (!sameSnapshot(source.info, entry.source.info)
          || source.sha256 !== entry.source.sha256
          || !sameSnapshot(target.info, entry.info)
          || target.sha256 !== entry.sha256) {
        fail(`pair ${index} changed before promotion transaction completion`);
      }
    }
    return created.map((entry) => ({ path: entry.path, bytes: Number(entry.info.size), sha256: entry.sha256 }));
  } catch (error) {
    for (const entry of created.reverse()) {
      try {
        const current = lstatSync(entry.path, { bigint: true });
        if (current.isFile() && !current.isSymbolicLink() && sameObject(current, entry.info)) unlinkSync(entry.path);
      } catch {
        // A missing/replaced target is not ours to remove.
      }
    }
    throw error;
  }
}

export function promoteBoundUnitySet(
  pairs,
  bindingSource,
  { beforePromotion = null, beforeLink = null } = {},
) {
  if (!Array.isArray(pairs) || pairs.length !== 4) {
    fail('bound Unity promotion requires APK, AAB, binding and checksum pairs');
  }
  const pairSources = new Set();
  const pairTargets = new Set();
  for (const [index, pair] of pairs.entries()) {
    if (!pair || typeof pair.source !== 'string' || typeof pair.target !== 'string') {
      fail(`bound Unity pair ${index} is invalid`);
    }
    if (basename(pair.source) !== basename(pair.target)) {
      fail(`bound Unity pair ${index} source/target basenames differ`);
    }
    if (pairSources.has(pair.source) || pairTargets.has(pair.target)) {
      fail('bound Unity promotion contains duplicate sources or targets');
    }
    pairSources.add(pair.source);
    pairTargets.add(pair.target);
  }
  const binding = canonicalRegular(bindingSource, 'Unity payload-binding sidecar');
  const bindingText = binding.bytes.toString('utf8');
  if (!Buffer.from(bindingText, 'utf8').equals(binding.bytes)) {
    fail('Unity payload-binding sidecar is not UTF-8');
  }
  let sidecar;
  try {
    sidecar = validatePayloadBindingSidecar(JSON.parse(bindingText));
  } catch (error) {
    fail(`Unity payload-binding sidecar is invalid: ${error.message}`);
  }
  if (!Buffer.from(`${stableStringify(sidecar)}\n`, 'utf8').equals(binding.bytes)) {
    fail('Unity payload-binding sidecar is not canonical JSON');
  }
  const pairByBasename = new Map(pairs.map((pair) => [basename(pair.source), pair]));
  if (pairByBasename.size !== pairs.length) {
    fail('bound Unity promotion contains duplicate source basenames');
  }
  const bindingPair = pairs.find((pair) => resolve(pair.source) === binding.path);
  const apkPair = pairByBasename.get(sidecar.apk.fileName);
  const aabPair = pairByBasename.get(sidecar.aab.fileName);
  if (!bindingPair || !apkPair || !aabPair || new Set([bindingPair, apkPair, aabPair]).size !== 3) {
    fail('bound Unity promotion pairs do not match the sidecar APK/AAB/binding identities');
  }
  const checksumPair = pairs.find((pair) => ![bindingPair, apkPair, aabPair].includes(pair));
  if (!checksumPair || !basename(checksumPair.source).startsWith('SHA256SUMS-')) {
    fail('bound Unity promotion omits its SHA256SUMS artifact');
  }
  const expectedChecksum = Buffer.from(
    `${sidecar.apk.sha256}  ${sidecar.apk.fileName}\n`
      + `${sidecar.aab.sha256}  ${sidecar.aab.fileName}\n`
      + `${binding.sha256}  ${basename(binding.path)}\n`,
    'utf8',
  );
  const checksum = canonicalRegular(checksumPair.source, 'Unity release-set checksum');
  if (!checksum.bytes.equals(expectedChecksum)) {
    fail('Unity SHA256SUMS does not exactly bind the sidecar release set');
  }
  const expectedSources = new Map([
    [apkPair.source, { bytes: sidecar.apk.bytes, sha256: sidecar.apk.sha256 }],
    [aabPair.source, { bytes: sidecar.aab.bytes, sha256: sidecar.aab.sha256 }],
    [binding.path, { bytes: binding.bytes.length, sha256: binding.sha256 }],
    [checksum.path, { bytes: checksum.bytes.length, sha256: checksum.sha256 }],
  ]);
  beforePromotion?.();
  return promoteExclusively(pairs, { beforeLink, expectedSources });
}

function parseCli(argv) {
  const action = argv[0];
  const pairStart = action === 'promote-unity-set' ? 2 : 1;
  if (!['promote', 'promote-unity-set'].includes(action)
      || (action === 'promote-unity-set' && !argv[1])
      || argv.length < pairStart + 2
      || (argv.length - pairStart) % 2 !== 0) {
    fail('usage: android-exclusive-promote.mjs promote SOURCE TARGET [...] | promote-unity-set BINDING SOURCE TARGET [...]');
  }
  const pairs = [];
  for (let index = pairStart; index < argv.length; index += 2) {
    pairs.push({ source: argv[index], target: argv[index + 1] });
  }
  return { action, bindingSource: action === 'promote-unity-set' ? argv[1] : null, pairs };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const parsed = parseCli(process.argv.slice(2));
    const promoted = parsed.action === 'promote-unity-set'
      ? promoteBoundUnitySet(parsed.pairs, parsed.bindingSource)
      : promoteExclusively(parsed.pairs);
    process.stdout.write(`ANDROID_EXCLUSIVE_PROMOTION_OK ${promoted.length}\n`);
  } catch (error) {
    process.stderr.write(`ANDROID_EXCLUSIVE_PROMOTION_REJECTED ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
