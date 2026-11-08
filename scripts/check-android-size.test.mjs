import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_LIMIT_BYTES,
  DEFAULT_WARNING_BYTES,
  parseArgs,
  parseDuBytes,
  parsePackagePaths,
  parsePositiveMb,
  resultForBytes,
} from './check-android-size.mjs';

describe('Android size budget', () => {
  it('uses a strict 50,000,000-byte default ceiling', () => {
    assert.equal(DEFAULT_LIMIT_BYTES, 50_000_000);
    assert.equal(DEFAULT_WARNING_BYTES, 45_000_000);
    assert.equal(parseArgs([]).limitMb, 50);
    assert.equal(parseArgs([]).warningMb, 45);
  });

  it('accepts the byte exactly at the ceiling and rejects the next byte', () => {
    assert.equal(resultForBytes('APK', 'app.apk', DEFAULT_LIMIT_BYTES, DEFAULT_LIMIT_BYTES).pass, true);
    assert.equal(resultForBytes('APK', 'app.apk', DEFAULT_LIMIT_BYTES + 1, DEFAULT_LIMIT_BYTES).pass, false);
  });

  it('warns inside the reserved-headroom band without failing', () => {
    const result = resultForBytes('APK', 'app.apk', DEFAULT_WARNING_BYTES + 1, DEFAULT_LIMIT_BYTES);
    assert.equal(result.pass, true);
    assert.equal(result.warning, true);
  });

  it('parses split APK package paths without using a device shell', () => {
    assert.deepEqual(
      parsePackagePaths('package:/data/app/id/base.apk\npackage:/data/app/id/split_config.arm64_v8a.apk\n'),
      ['/data/app/id/base.apk', '/data/app/id/split_config.arm64_v8a.apk'],
    );
  });

  it('converts du KiB blocks to bytes', () => {
    assert.equal(parseDuBytes('48828\t/data/app/id\n'), 49_999_872);
  });

  it('rejects invalid limits and package ids', () => {
    assert.throws(() => parsePositiveMb('0'), /positive number/u);
    assert.throws(() => parseArgs(['--package', 'in.vande;rm']), /invalid Android package id/u);
    assert.throws(() => parseArgs(['--warning-mb', '51']), /cannot exceed/u);
  });

  it('makes a serial imply a read-only device measurement', () => {
    const options = parseArgs(['--serial', 'emulator-5554', '--limit-mb', '49.5']);
    assert.equal(options.device, true);
    assert.equal(options.serial, 'emulator-5554');
    assert.equal(options.limitMb, 49.5);
  });
});
