#!/usr/bin/env node

/** Side-effect-free wrapper preflight. This must run before artifact or ADB work. */

import { basename, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertGateAFirstBallConfiguration } from './android-gate-a.mjs';

const booleanFlags = new Set([
  '--gate-a-first-ball',
  '--skip-lifecycle',
  '--perf',
  '--recheck',
  '--allow-unity-fallback',
]);
const valueFlags = new Set(['--patience', '--label']);

export function parseGateAArgs(argv) {
  const present = new Set();
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (booleanFlags.has(name)) {
      if (present.has(name)) throw new Error(`duplicate Gate-A option ${name}`);
      present.add(name);
      continue;
    }
    if (valueFlags.has(name)) {
      if (present.has(name)) throw new Error(`duplicate Gate-A option ${name}`);
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`);
      present.add(name);
      values[name] = value;
      index += 1;
      continue;
    }
    throw new Error(`unsupported Gate-A option ${name}`);
  }
  if (values['--patience'] !== undefined
      && (!/^[1-9][0-9]{0,2}$/u.test(values['--patience']) || Number(values['--patience']) > 600)) {
    throw new Error('--patience must be an integer from 1 through 600 seconds');
  }
  if (values['--label'] !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(values['--label'])) {
    throw new Error('--label is unsafe');
  }
  return { present, values };
}

export function preflightGateA({ env, argv }) {
  const parsed = parseGateAArgs(argv);
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(env.ANDROID_SERIAL ?? '')) throw new Error('ANDROID_SERIAL is missing or unsafe');
  if (/[\r\n\0]/u.test(env.APK_PATH ?? '')) throw new Error('APK_PATH contains a forbidden control character');
  assertGateAFirstBallConfiguration({
    enabled: parsed.present.has('--gate-a-first-ball'),
    hooks: env.HOOKS === '1',
    unityRequested: env.UNITY === '1',
    allowUnityFallback: parsed.present.has('--allow-unity-fallback'),
    skipLifecycle: parsed.present.has('--skip-lifecycle'),
    perf: parsed.present.has('--perf'),
    recheck: parsed.present.has('--recheck'),
    artifactMode: env.ARTIFACT_MODE ?? 'debug',
    requirePackageAbsent: env.REQUIRE_PACKAGE_ABSENT === '1',
    apkPath: env.APK_PATH ?? '',
    expectedApkSha256: env.EXPECTED_APK_SHA256 ?? '',
    expectedBuildId: env.EXPECTED_BUILD_ID ?? '',
    unityPayloadBindingPath: env.UNITY_PAYLOAD_BINDING_PATH ?? '',
    expectedUnityPayloadBindingSha256: env.EXPECTED_UNITY_PAYLOAD_BINDING_SHA256 ?? '',
  });
  if (env.ARTIFACT_MODE === 'sealed' && !parsed.present.has('--gate-a-first-ball')) {
    throw new Error('ARTIFACT_MODE=sealed is reserved for --gate-a-first-ball evidence');
  }
  if (env.ARTIFACT_MODE === 'sealed') {
    const evidenceOut = env.GATE_A_EVIDENCE_OUT ?? '';
    if (!isAbsolute(evidenceOut) || /[\r\n\0]/u.test(evidenceOut) || resolve(evidenceOut) !== evidenceOut) {
      throw new Error('Gate-A evidence output must be a canonical absolute path without control characters');
    }
    const sidecarPath = env.UNITY_PAYLOAD_BINDING_PATH ?? '';
    if (!isAbsolute(sidecarPath) || /[\r\n\0]/u.test(sidecarPath) || resolve(sidecarPath) !== sidecarPath) {
      throw new Error('UNITY_PAYLOAD_BINDING_PATH must be a canonical absolute path without control characters');
    }
    if (!/^[0-9a-f]{64}$/u.test(env.EXPECTED_UNITY_PAYLOAD_BINDING_SHA256 ?? '')) {
      throw new Error('EXPECTED_UNITY_PAYLOAD_BINDING_SHA256 must be 64 lowercase hexadecimal characters');
    }
    const apkName = basename(env.APK_PATH ?? '');
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*\.apk$/u.test(apkName)) {
      throw new Error('APK_PATH basename is unsafe for the private sealed copy');
    }
  }
  return parsed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    preflightGateA({ env: process.env, argv: process.argv.slice(2) });
    console.log('ANDROID_GATE_A_PREFLIGHT_OK');
  } catch (error) {
    console.error(`ANDROID_GATE_A_PREFLIGHT_REJECTED ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
