#!/usr/bin/env node

/**
 * Enforces VANDE's Android size ceiling without changing a device.
 *
 * The 50 MB artifact check is a necessary preflight, not proof of installed
 * size. --device adds a partial measurement of the allocated bytes in the
 * installed package code directory (base/configuration APKs, extracted native
 * libraries and package-local compiled artifacts). It excludes mutable data,
 * cache and potentially ART storage, so it is not launch certification. The
 * script deliberately never installs, uninstalls, launches or clears app data.
 *
 * Examples:
 *   node scripts/check-android-size.mjs --apk app-release.apk --aab app-release.aab
 *   node scripts/check-android-size.mjs --apk app-release.apk --device --serial SERIAL
 */

import { existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_LIMIT_MB = 50;
export const DEFAULT_LIMIT_BYTES = DEFAULT_LIMIT_MB * 1_000_000;
export const DEFAULT_WARNING_MB = 45;
export const DEFAULT_WARNING_BYTES = DEFAULT_WARNING_MB * 1_000_000;
export const DEFAULT_PACKAGE = 'in.vande.cricket';

const DEFAULT_APK = 'android/app/build/outputs/apk/release/app-release.apk';
const DEFAULT_AAB = 'android/app/build/outputs/bundle/release/app-release.aab';

function usage() {
  return `Usage: node scripts/check-android-size.mjs [options]

Options:
  --apk PATH          release APK to check (default: ${DEFAULT_APK}, if present)
  --aab PATH          release AAB to check (default: ${DEFAULT_AAB}, if present)
  --limit-mb NUMBER   decimal-megabyte ceiling (default: ${DEFAULT_LIMIT_MB})
  --warning-mb NUMBER headroom warning threshold (default: ${DEFAULT_WARNING_MB})
  --device            also measure the installed package code directory (partial)
  --serial SERIAL     adb device serial (implies --device)
  --package ID        installed application id (default: ${DEFAULT_PACKAGE})
  --adb PATH          adb executable (otherwise SDK environment or PATH)
  --json              emit machine-readable JSON
  --help              show this help

The device check is read-only and partial. Launch proof still requires Play
Console's estimated install size and/or full fresh-device StorageStats including
mandatory post-launch data. This script never installs, uninstalls, launches or
clears the app.`;
}

export function parsePositiveMb(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--limit-mb must be a positive number, received '${value}'`);
  }
  return parsed;
}

export function parseArgs(argv) {
  const options = {
    apk: undefined,
    aab: undefined,
    limitMb: DEFAULT_LIMIT_MB,
    warningMb: DEFAULT_WARNING_MB,
    device: false,
    serial: undefined,
    packageId: DEFAULT_PACKAGE,
    adb: undefined,
    json: false,
    help: false,
  };

  const valueOptions = new Set(['--apk', '--aab', '--limit-mb', '--warning-mb', '--serial', '--package', '--adb']);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (valueOptions.has(argument)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${argument} requires a value`);
      }
      index += 1;
      if (argument === '--apk') options.apk = value;
      else if (argument === '--aab') options.aab = value;
      else if (argument === '--limit-mb') options.limitMb = parsePositiveMb(value);
      else if (argument === '--warning-mb') options.warningMb = parsePositiveMb(value);
      else if (argument === '--serial') {
        options.serial = value;
        options.device = true;
      } else if (argument === '--package') options.packageId = value;
      else options.adb = value;
      continue;
    }
    if (argument === '--device') options.device = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`unknown option '${argument}'`);
  }

  if (!/^[A-Za-z][A-Za-z0-9_.]*$/.test(options.packageId)) {
    throw new Error(`invalid Android package id '${options.packageId}'`);
  }
  if (options.warningMb > options.limitMb) {
    throw new Error('--warning-mb cannot exceed --limit-mb');
  }
  return options;
}

export function resultForBytes(label, path, bytes, limitBytes, warningBytes = DEFAULT_WARNING_BYTES) {
  return {
    label,
    path,
    bytes,
    limitBytes,
    pass: bytes <= limitBytes,
    warning: bytes > warningBytes && bytes <= limitBytes,
    warningBytes,
    remainingBytes: limitBytes - bytes,
  };
}

export function parsePackagePaths(stdout) {
  const paths = stdout
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      if (!line.startsWith('package:/')) {
        throw new Error(`unexpected 'pm path' output: ${line}`);
      }
      return line.slice('package:'.length);
    });
  if (paths.length === 0) throw new Error('the package is not installed on the selected device');
  return paths;
}

export function parseDuBytes(stdout) {
  const match = stdout.trim().match(/^(\d+)(?:\s|$)/u);
  if (!match) throw new Error(`unexpected 'du -k' output: ${stdout.trim() || '<empty>'}`);
  return Number(match[1]) * 1024;
}

function formatMb(bytes) {
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

function artifactResults(options, limitBytes, warningBytes) {
  const explicit = Boolean(options.apk || options.aab);
  const candidates = explicit
    ? [
        ...(options.apk ? [['APK artifact', options.apk]] : []),
        ...(options.aab ? [['AAB artifact', options.aab]] : []),
      ]
    : [
        ['APK artifact', DEFAULT_APK],
        ['AAB artifact', DEFAULT_AAB],
      ];
  const results = [];
  for (const [label, candidate] of candidates) {
    const path = resolve(candidate);
    if (!existsSync(path)) {
      if (explicit) throw new Error(`${label} does not exist: ${path}`);
      continue;
    }
    const stats = statSync(path);
    if (!stats.isFile()) throw new Error(`${label} is not a regular file: ${path}`);
    results.push(resultForBytes(label, path, stats.size, limitBytes, warningBytes));
  }
  return results;
}

function defaultAdb() {
  for (const root of [process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME]) {
    if (!root) continue;
    const candidate = resolve(root, 'platform-tools', 'adb');
    if (existsSync(candidate)) return candidate;
  }
  return 'adb';
}

function adbCommand(adb, serial, args, options = {}) {
  const prefix = serial ? ['-s', serial] : [];
  const result = spawnSync(adb, [...prefix, ...args], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw new Error(`could not run adb: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`adb ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

function adbProperty(adb, serial, property) {
  return adbCommand(adb, serial, ['shell', 'getprop', property]).trim();
}

function installedPackageResult(options, limitBytes, warningBytes) {
  const adb = options.adb ?? defaultAdb();
  const packageOutput = adbCommand(adb, options.serial, ['shell', 'pm', 'path', options.packageId]);
  const packagePaths = parsePackagePaths(packageOutput);
  const roots = [...new Set(packagePaths.map((path) => dirname(path)))];
  let bytes = 0;
  for (const root of roots) {
    bytes += parseDuBytes(adbCommand(adb, options.serial, ['shell', 'du', '-sk', root]));
  }

  const details = adbCommand(adb, options.serial, ['shell', 'dumpsys', 'package', options.packageId]);
  const firstInstallTime = details.match(/firstInstallTime=(.+)/u)?.[1]?.trim() ?? null;
  const lastUpdateTime = details.match(/lastUpdateTime=(.+)/u)?.[1]?.trim() ?? null;

  return {
    ...resultForBytes('Installed package code (partial)', roots.join(', '), bytes, limitBytes, warningBytes),
    metric: 'allocated bytes from du -k over the installed package code director' + (roots.length === 1 ? 'y' : 'ies'),
    packageId: options.packageId,
    packagePaths,
    device: {
      serial: options.serial ?? 'adb-default',
      manufacturer: adbProperty(adb, options.serial, 'ro.product.manufacturer'),
      model: adbProperty(adb, options.serial, 'ro.product.model'),
      sdk: adbProperty(adb, options.serial, 'ro.build.version.sdk'),
      abi: adbProperty(adb, options.serial, 'ro.product.cpu.abi'),
    },
    install: {
      firstInstallTime,
      lastUpdateTime,
      appearsNeverUpdated: Boolean(firstInstallTime && firstInstallTime === lastUpdateTime),
      caveat: 'This is not installed-size certification: mutable data, cache and potentially ART storage are excluded.',
    },
  };
}

export function run(argv) {
  const options = parseArgs(argv);
  if (options.help) return { help: true, exitCode: 0 };

  const limitBytes = Math.floor(options.limitMb * 1_000_000);
  const warningBytes = Math.floor(options.warningMb * 1_000_000);
  const artifacts = artifactResults(options, limitBytes, warningBytes);
  if (artifacts.length === 0 && !options.device) {
    throw new Error('no APK or AAB was found; pass --apk/--aab, or request --device');
  }
  const installed = options.device ? installedPackageResult(options, limitBytes, warningBytes) : null;
  const pass = artifacts.every((item) => item.pass) && (!installed || installed.pass);
  return {
    help: false,
    exitCode: pass ? 0 : 1,
    report: {
      schema: 1,
      limit: {
        decimalMb: options.limitMb,
        bytes: limitBytes,
      },
      warning: {
        decimalMb: options.warningMb,
        bytes: warningBytes,
      },
      artifacts,
      installed,
      installedSizeProof: 'UNPROVEN. Requires Play Console estimated install size and/or full fresh-device StorageStats including mandatory post-launch data.',
      pass,
    },
    json: options.json,
  };
}

function printReport(result) {
  if (result.help) {
    console.log(usage());
    return;
  }
  if (result.json) {
    console.log(JSON.stringify(result.report, null, 2));
    return;
  }

  const { report } = result;
  console.log(`Android size ceiling: ${report.limit.decimalMb} MB (${report.limit.bytes} bytes); headroom warning above ${report.warning.decimalMb} MB`);
  console.log('Artifact preflight (necessary, not installed-size proof):');
  for (const item of report.artifacts) {
    const verdict = item.pass ? (item.warning ? 'WARN' : 'PASS') : 'FAIL';
    console.log(`  ${verdict}  ${item.label}: ${formatMb(item.bytes)}  ${item.path}`);
  }
  if (report.installed) {
    const item = report.installed;
    console.log('On-device installed-package measurement:');
    const verdict = item.pass ? (item.warning ? 'WARN' : 'PASS') : 'FAIL';
    console.log(`  ${verdict}  ${formatMb(item.bytes)}  ${item.path}`);
    console.log(`  Device: ${item.device.manufacturer} ${item.device.model}; API ${item.device.sdk}; ${item.device.abi}; serial ${item.device.serial}`);
    console.log(`  Install: first=${item.install.firstInstallTime ?? 'unknown'}; updated=${item.install.lastUpdateTime ?? 'unknown'}`);
    console.log(`  CAUTION: ${item.install.caveat}`);
  } else {
    console.log('Partial on-device code measurement: NOT RUN (use --device on an already-installed build).');
  }
  console.log(`Installed-size launch proof: ${report.installedSizeProof}`);
  console.log(report.pass ? 'PASS: measured size gates are within budget.' : 'FAIL: the 50 MB Android size ceiling was exceeded.');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = run(process.argv.slice(2));
    printReport(result);
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(`Android size check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
