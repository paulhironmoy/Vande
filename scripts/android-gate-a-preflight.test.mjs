#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGateAArgs, preflightGateA } from './android-gate-a-preflight.mjs';

const env = {
  ARTIFACT_MODE: 'sealed',
  UNITY: '1',
  HOOKS: '0',
  REQUIRE_PACKAGE_ABSENT: '1',
  APK_PATH: '/private/tmp/vande-PREVIEW-UNITY-release.apk',
  EXPECTED_APK_SHA256: 'a'.repeat(64),
  EXPECTED_BUILD_ID: '38924bd+0123456789ab',
  ANDROID_SERIAL: 'emulator-5584',
  UNITY_PAYLOAD_BINDING_PATH: '/private/tmp/vande-PREVIEW-UNITY-release-payload-binding.json',
  EXPECTED_UNITY_PAYLOAD_BINDING_SHA256: 'b'.repeat(64),
  GATE_A_EVIDENCE_OUT: '/private/tmp/vande-gate-a-evidence',
};

test('wrapper preflight accepts only the bounded Gate-A one-ball argument set', () => {
  assert.doesNotThrow(() => preflightGateA({
    env,
    argv: ['--gate-a-first-ball', '--skip-lifecycle', '--patience', '90', '--label', 'gate-a'],
  }));
  assert.throws(() => parseGateAArgs(['--unknown']), /unsupported/u);
  assert.throws(() => parseGateAArgs(['--label', '../escape']), /unsafe/u);
  assert.throws(() => parseGateAArgs(['--patience', '601']), /1 through 600/u);
});

test('every invalid Gate-A flag/environment combination rejects in pure preflight', () => {
  const validArgs = ['--gate-a-first-ball', '--skip-lifecycle'];
  for (const [envPatch, args, pattern] of [
    [{ HOOKS: '1' }, validArgs, /HOOKS=0/u],
    [{ UNITY: '0' }, validArgs, /UNITY=1/u],
    [{ ANDROID_SERIAL: 'bad serial' }, validArgs, /missing or unsafe/u],
    [{ REQUIRE_PACKAGE_ABSENT: '0' }, validArgs, /REQUIRE_PACKAGE_ABSENT=1/u],
    [{ ARTIFACT_MODE: 'debug' }, validArgs, /ARTIFACT_MODE=sealed/u],
    [{}, ['--gate-a-first-ball'], /skip-lifecycle/u],
    [{}, [...validArgs, '--perf'], /cannot run --perf/u],
    [{}, [...validArgs, '--recheck'], /cannot run --recheck/u],
    [{}, [...validArgs, '--allow-unity-fallback'], /refuses.*fallback/u],
    [{}, ['--skip-lifecycle'], /reserved for --gate-a-first-ball/u],
    [{ UNITY_PAYLOAD_BINDING_PATH: '' }, validArgs, /UNITY_PAYLOAD_BINDING_PATH.*absolute/u],
    [{ UNITY_PAYLOAD_BINDING_PATH: 'relative.json' }, validArgs, /UNITY_PAYLOAD_BINDING_PATH.*absolute/u],
    [{ UNITY_PAYLOAD_BINDING_PATH: '/private/tmp/a/../binding.json' }, validArgs, /canonical absolute/u],
    [{ EXPECTED_UNITY_PAYLOAD_BINDING_SHA256: 'B'.repeat(64) }, validArgs, /64 lowercase/u],
    [{ APK_PATH: '/private/tmp/unsafe name.apk' }, validArgs, /basename is unsafe/u],
    [{ GATE_A_EVIDENCE_OUT: '/private/tmp/a/../evidence' }, validArgs, /output must be a canonical absolute/u],
    [{ GATE_A_EVIDENCE_OUT: 'relative/evidence' }, validArgs, /output must be a canonical absolute/u],
  ]) {
    assert.throws(() => preflightGateA({ env: { ...env, ...envPatch }, argv: args }), pattern);
  }
});
