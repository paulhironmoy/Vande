#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isCanonicalDevicePath,
  parseExactInstalledApkHashOutput,
  parseExactInstalledPackagePathOutput,
} from './android-installed-package-inventory.mjs';

const android16Path = '/data/app/~~qWsnrA55Yw0iipQGJRII5A==/in.vande.cricket-Z4WpG4FgUTpExiyZhSc16Q==/base.apk';
const sha256 = '3'.repeat(64);

test('accepts the randomized Android 16 data-app path emitted by pm path', () => {
  assert.equal(
    isCanonicalDevicePath(android16Path),
    true,
  );
  assert.equal(parseExactInstalledPackagePathOutput(`package:${android16Path}\n`), android16Path);
  assert.deepEqual(parseExactInstalledApkHashOutput(`${sha256}  ${android16Path}\n`, android16Path), {
    path: android16Path,
    sha256,
  });
});

test('rejects traversal, empty segments, whitespace and shell metacharacters', () => {
  for (const path of [
    '/data/app/../base.apk',
    '/data/app/./base.apk',
    '/data//app/base.apk',
    '/data/app/bad path/base.apk',
    '/data/app/token/base.apk;id',
    '/data/app/token/$(id).apk',
    'data/app/token/base.apk',
    '',
  ]) {
    assert.equal(isCanonicalDevicePath(path), false, path);
  }
});

test('requires one exact monolithic path and a lowercase hash bound to that same path', () => {
  for (const output of [
    `package:${android16Path}\npackage:/data/app/split_config.arm64_v8a.apk\n`,
    `package:${android16Path}\n\n`,
    `package:${android16Path} trailing\n`,
    'package:/data/app/../base.apk\n',
    'package:relative/base.apk\n',
  ]) {
    assert.equal(parseExactInstalledPackagePathOutput(output), null, output);
  }

  for (const output of [
    `${'A'.repeat(64)}  ${android16Path}\n`,
    `${sha256}  /data/app/other/base.apk\n`,
    `${sha256}  ${android16Path}\ntrailing`,
    `${sha256.slice(1)}  ${android16Path}\n`,
    `${sha256};id  ${android16Path}\n`,
  ]) {
    assert.equal(parseExactInstalledApkHashOutput(output, android16Path), null, output);
  }
});
