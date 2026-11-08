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
 * The sideload "everything" build (scripts/build-android.sh --preview --everything) carries two OPTIONAL payloads that a default
 * build must not: the camera pack and the baked venue. --addon camera / --addon venue names the payload this artifact is allowed
 * to carry. The 50,000,000-byte ceiling is then applied to everything EXCEPT the verified payload, both numbers are always printed
 * (the ceiling result without the add-on, and the add-on bytes on their own lines), and the artifact is labelled
 * "SIDELOAD-EVERYTHING, NOT A RELEASE". The exemption is narrow by construction (see accountAddons): only a -PREVIEW- artifact that
 * carries the matching name tag, only files the pack's own MANIFEST.json declares (sizes and sha256 verified) or the venue's GLB
 * files, each within a small cap; anything else in the artifact, inside or outside those folders, counts against the ceiling.
 *
 * The Unity-linked sideload build carries a second, smaller venue (ruling R-48): an export made with VANDE_UNITY_VENUE=1 adds a few
 * compiled data files (meshes and an atlas) to the Unity player data and writes .vande-venue-addon.properties beside the export. That
 * receipt names the four SOURCE files, which a player build does not store as FBX or PNG, so the compiled files are found by comparing
 * the export's .vande-export.properties with that of a default export of the SAME source tree (--unity-default-export): the files
 * only the venue export has, under unityLibrary/src/main/assets, are looked up in the artifact by name, their sha256 is compared
 * with the receipt, and their stored bytes are exempt within a cap. Files the venue export merely changes, or adds elsewhere, and
 * every case where the comparison cannot be made, stay in the remainder that the ceiling is applied to (conservative).
 *
 * Examples:
 *   node scripts/check-android-size.mjs --apk app-release.apk --aab app-release.aab
 *   node scripts/check-android-size.mjs --apk x-PREVIEW-UNITY-EVERYTHING-<id>-release.apk --addon camera --addon venue
 *   node scripts/check-android-size.mjs --apk x-PREVIEW-UNITY-EVERYTHING-<id>-release.apk --addon venue \
 *     --unity-export unity/VandePractice/Builds/Android --unity-default-export unity/VandePractice/Builds/Android.final-default
 *   node scripts/check-android-size.mjs --apk app-release.apk --device --serial SERIAL
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseUnityExportReceipt } from './android-unity-payload-binding.mjs';
import { OPTIONAL_PAYLOADS } from './check-android-release-compat.mjs';

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
  --addon NAME        camera or venue (repeatable): this -PREVIEW- sideload artifact may carry that optional payload; the
                      ceiling then applies to the rest, and both numbers are printed (SIDELOAD-EVERYTHING, NOT A RELEASE)
  --unity-export DIR  (with --addon venue) the Unity Android export the artifact was built from: its .vande-export.properties and,
                      for the sideload venue, its .vande-venue-addon.properties
  --unity-default-export DIR
                      (with --unity-export) an export of the same source tree made WITHOUT VANDE_UNITY_VENUE; the venue's compiled
                      data files are the ones only --unity-export has. Without it they stay in the remainder (conservative)
  --unity-venue-receipt PATH
                      (with --unity-export) where the venue receipt is when it is not inside the export folder (default:
                      <unity-export>/.vande-venue-addon.properties); the sealed Gradle check rejects extra files in the export folder
  --unzip PATH        unzip executable for --addon (default: unzip on PATH)
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
    addons: [],
    unityExport: undefined,
    unityDefaultExport: undefined,
    unityVenueReceipt: undefined,
    unzip: 'unzip',
    device: false,
    serial: undefined,
    packageId: DEFAULT_PACKAGE,
    adb: undefined,
    json: false,
    help: false,
  };

  const valueOptions = new Set(['--apk', '--aab', '--limit-mb', '--warning-mb', '--serial', '--package', '--adb', '--addon', '--unzip', '--unity-export', '--unity-default-export', '--unity-venue-receipt']);
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
      else if (argument === '--addon') {
        if (!Object.hasOwn(ADDONS, value)) throw new Error(`--addon must be one of ${Object.keys(ADDONS).join(', ')}, received '${value}'`);
        if (!options.addons.includes(value)) options.addons.push(value);
      } else if (argument === '--unzip') options.unzip = value;
      else if (argument === '--unity-export') options.unityExport = value;
      else if (argument === '--unity-default-export') options.unityDefaultExport = value;
      else if (argument === '--unity-venue-receipt') options.unityVenueReceipt = value;
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
  if (options.unityExport && !options.addons.includes('venue')) throw new Error('--unity-export needs --addon venue');
  if (options.unityDefaultExport && !options.unityExport) throw new Error('--unity-default-export needs --unity-export');
  if (options.unityVenueReceipt && !options.unityExport) throw new Error('--unity-venue-receipt needs --unity-export');
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

export const SIDELOAD_LABEL = 'SIDELOAD-EVERYTHING, NOT A RELEASE';

/**
 * The optional payloads a sideload build may carry. `pattern` finds their entries (shared with the compatibility checker, which
 * refuses them in a default build); `nameTag` is the tag scripts/build-android.sh puts in the artifact name when the matching
 * flag was used; `maxStoredBytes` keeps the exemption small whatever a manifest claims.
 */
export const ADDONS = Object.freeze({
  camera: Object.freeze({
    id: 'camera',
    title: 'camera pack (pose engine, worker and model)',
    pattern: OPTIONAL_PAYLOADS.camera,
    nameTag: /-(?:EVERYTHING|CAMERA)(?:-|\.)/u,
    maxStoredBytes: 16_000_000,
  }),
  venue: Object.freeze({
    id: 'venue',
    title: 'baked venue (GLB files)',
    pattern: OPTIONAL_PAYLOADS.venue,
    nameTag: /-(?:EVERYTHING|VENUE)(?:-|\.)/u,
    maxStoredBytes: 4_000_000,
  }),
});

const POSE_MANIFEST = /^(?:base\/)?assets\/public\/models\/pose\/[^/]+\/MANIFEST\.json$/u;
const SAFE_FILE_NAME = /^[A-Za-z0-9._-]+$/u;
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

/** Rows of `unzip -v` (Length Method Size Cmpr Date Time CRC-32 Name): stored bytes are the "Size" column. */
export function parseUnzipListing(stdout) {
  const rows = [];
  for (const line of stdout.split(/\r?\n/u)) {
    const match = line.match(/^\s*(\d+)\s+(\S+)\s+(\d+)\s+-?\d+%\s+\d{2,4}-\d{2}-\d{2,4}\s+\d{2}:\d{2}\s+[0-9a-fA-F]{8}\s+(.+)$/u);
    if (match) rows.push({ name: match[4], rawBytes: Number(match[1]), storedBytes: Number(match[3]), method: match[2] });
  }
  return rows;
}

function acceptCameraPack(matches, readEntry, problems) {
  const manifests = matches.filter((entry) => POSE_MANIFEST.test(entry.name));
  if (manifests.length !== 1) {
    problems.push(`camera pack: expected exactly one models/pose/<id>/MANIFEST.json, found ${manifests.length}; none of the pack is exempt`);
    return [];
  }
  const manifestEntry = manifests[0];
  const dir = manifestEntry.name.slice(0, manifestEntry.name.lastIndexOf('/') + 1);
  let manifest;
  try {
    manifest = JSON.parse(readEntry(manifestEntry.name).toString('utf8'));
  } catch (error) {
    problems.push(`camera pack: MANIFEST.json cannot be read (${error instanceof Error ? error.message : String(error)}); none of the pack is exempt`);
    return [];
  }
  if (!Array.isArray(manifest?.files) || manifest.files.length === 0) {
    problems.push('camera pack: MANIFEST.json lists no files; none of the pack is exempt');
    return [];
  }
  const accepted = [manifestEntry];
  for (const file of manifest.files) {
    const name = typeof file?.path === 'string' && SAFE_FILE_NAME.test(file.path) ? `${dir}${file.path}` : null;
    const entry = name ? matches.find((candidate) => candidate.name === name) : undefined;
    if (!entry) {
      problems.push(`camera pack: MANIFEST.json declares ${JSON.stringify(file?.path)} but the artifact has no such file`);
    } else if (!Number.isSafeInteger(file.bytes) || entry.rawBytes !== file.bytes) {
      problems.push(`camera pack: ${file.path} is ${entry.rawBytes} bytes, the manifest says ${file.bytes}; it counts against the ceiling`);
    } else if (typeof file.sha256 !== 'string' || sha256(readEntry(entry.name)) !== file.sha256.toLowerCase()) {
      problems.push(`camera pack: ${file.path} does not match the manifest's sha256; it counts against the ceiling`);
    } else {
      accepted.push(entry);
    }
  }
  const declared = new Set(accepted.map((entry) => entry.name));
  const undeclared = matches.filter((entry) => !declared.has(entry.name));
  if (undeclared.length > 0) {
    problems.push(`camera pack: ${undeclared.length} file${undeclared.length === 1 ? '' : 's'} not declared by MANIFEST.json count against the ceiling: ${undeclared.slice(0, 3).map((entry) => entry.name).join(', ')}`);
  }
  return accepted;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The Unity venue add-on (ruling R-48). See the header of this file for how its compiled data files are found.
// ---------------------------------------------------------------------------------------------------------------------------

export const EXPORT_RECEIPT_FILE = '.vande-export.properties';
export const VENUE_RECEIPT_FILE = '.vande-venue-addon.properties';
export const VENUE_RECEIPT_SCHEMA = 'vande-venue-addon-1';
/** The Unity player data of an export; the Gradle build packs it as assets/<rest> (APK) or base/assets/<rest> (AAB). */
export const UNITY_ASSETS_ROOT = 'unityLibrary/src/main/assets/';
/** Where the venue's source files sit in the Unity project (the export receipt's source list holds their sha256). */
const VENUE_SOURCE_DIR = 'Assets/VandePractice/Runtime/Presentation/Production/Venue/';
/** About 115 KB of compiled files were measured on the final sideload export (2026-11-08); the cap keeps the exemption from becoming a hiding place. */
export const UNITY_VENUE_MAX_STORED_BYTES = 1_000_000;
const UNITY_VENUE_TITLE = 'Unity venue (compiled data files found by comparing export receipts)';
const SHA256_HEX = /^[0-9a-f]{64}$/u;

/** Parses .vande-venue-addon.properties as VandeVenueAddonTool.Receipt() writes it. Throws an Error with a plain message on anything else. */
export function parseVenueReceipt(text) {
  if (!text.endsWith('\n') || text.includes('\r') || text.includes('\0')) {
    throw new Error('venue receipt must use LF-terminated single-line records');
  }
  const values = new Map();
  for (const [index, line] of text.slice(0, -1).split('\n').entries()) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9._-]*)=(\S+)$/u);
    if (!match) throw new Error(`venue receipt line ${index + 1} is malformed`);
    if (values.has(match[1])) throw new Error(`venue receipt has a duplicate key ${match[1]}`);
    values.set(match[1], match[2]);
  }
  if (values.get('schema') !== VENUE_RECEIPT_SCHEMA) throw new Error(`venue receipt schema must be ${VENUE_RECEIPT_SCHEMA}`);
  if (values.get('sideload') !== 'true') throw new Error('venue receipt must say sideload=true: the venue is never part of a release');
  const names = new Set();
  for (const key of values.keys()) {
    if (key === 'schema' || key === 'sideload' || key === 'sourceBytes') continue;
    const match = key.match(/^file\.([A-Za-z0-9][A-Za-z0-9._-]*)\.(bytes|sha256)$/u);
    if (!match) throw new Error(`venue receipt has an unknown key ${key}`);
    names.add(match[1]);
  }
  if (names.size === 0) throw new Error('venue receipt lists no files');
  const files = [];
  for (const name of [...names].sort()) {
    for (const suffix of ['bytes', 'sha256']) {
      if (!values.has(`file.${name}.${suffix}`)) throw new Error(`venue receipt is missing file.${name}.${suffix}`);
    }
    const bytes = values.get(`file.${name}.bytes`);
    if (!/^[1-9][0-9]{0,9}$/u.test(bytes)) throw new Error(`venue receipt file.${name}.bytes is not a positive whole number`);
    const hash = values.get(`file.${name}.sha256`);
    if (!SHA256_HEX.test(hash)) throw new Error(`venue receipt file.${name}.sha256 is not 64 lowercase hex digits`);
    files.push({ name, bytes: Number(bytes), sha256: hash });
  }
  const sourceBytes = values.get('sourceBytes');
  if (sourceBytes === undefined || !/^[0-9]{1,10}$/u.test(sourceBytes)) throw new Error('venue receipt sourceBytes is missing or not a whole number');
  const sum = files.reduce((total, file) => total + file.bytes, 0);
  if (Number(sourceBytes) !== sum) throw new Error(`venue receipt sourceBytes ${sourceBytes} is not the sum of the file bytes ${sum}`);
  return { schema: VENUE_RECEIPT_SCHEMA, sideload: true, files, sourceBytes: sum };
}

function readExportReceipt(dir, label) {
  const path = join(dir, EXPORT_RECEIPT_FILE);
  if (!existsSync(path)) throw new Error(`${label} ${dir} has no ${EXPORT_RECEIPT_FILE}`);
  return parseUnityExportReceipt(readFileSync(path));
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * What the Unity export that an artifact was built from says about the venue add-on. Reads folders, never an artifact.
 *  - present: false      the export has no .vande-venue-addon.properties, so it is a default export and carries no venue;
 *  - identified: false   the venue receipt is valid but no default export was given, so the compiled files cannot be told apart;
 *  - assets              the data files only the venue export has under unityLibrary/src/main/assets (path relative to it, with sha256);
 *  - changed / otherAdded  files the venue export changed, or added outside the assets folder: never exempt;
 *  - problems            anything wrong with the receipts or the pair of exports; the artifact then fails and nothing is exempt.
 */
export function loadUnityVenueClaim({ exportDir, defaultExportDir, venueReceiptPath }) {
  const dir = resolve(exportDir);
  const exported = readExportReceipt(dir, '--unity-export');
  const claim = { exportDir: dir, present: false, receipt: null, identified: false, assets: [], changed: [], otherAdded: [], problems: [] };
  const venuePath = venueReceiptPath ? resolve(venueReceiptPath) : join(dir, VENUE_RECEIPT_FILE);
  if (venueReceiptPath && !existsSync(venuePath)) throw new Error(`--unity-venue-receipt ${venuePath} does not exist`);
  if (!existsSync(venuePath)) return claim;
  claim.present = true;
  let venue;
  try {
    venue = parseVenueReceipt(readFileSync(venuePath, 'utf8'));
  } catch (error) {
    claim.problems.push(`${VENUE_RECEIPT_FILE} cannot be used (${error instanceof Error ? error.message : String(error)}); none of the Unity venue is exempt`);
    return claim;
  }
  claim.receipt = { fileCount: venue.files.length, sourceBytes: venue.sourceBytes, sha256: sha256(readFileSync(venuePath)) };
  // The receipt must be about the source tree this export was made from: its four files are the ones in the export receipt's source list.
  const sources = new Map(exported.sourceEntries.map((entry) => [entry.path, entry.sha256]));
  for (const file of venue.files) {
    if (sources.get(`${VENUE_SOURCE_DIR}${file.name}`) !== file.sha256) {
      claim.problems.push(`the venue receipt's ${file.name} is not the file in the source tree that the export was bound to; none of the Unity venue is exempt`);
    }
  }
  if (claim.problems.length > 0 || !defaultExportDir) return claim;

  const reference = resolve(defaultExportDir);
  if (existsSync(join(reference, VENUE_RECEIPT_FILE))) {
    claim.problems.push(`--unity-default-export carries a venue add-on (${reference}); it must be an export made without VANDE_UNITY_VENUE`);
    return claim;
  }
  let base;
  try {
    base = readExportReceipt(reference, '--unity-default-export');
  } catch (error) {
    claim.problems.push(`the default export receipt cannot be used (${error instanceof Error ? error.message : String(error)}); none of the Unity venue is exempt`);
    return claim;
  }
  if (base.sourceTreeSha256 !== exported.sourceTreeSha256) {
    claim.problems.push(`the default export is not an export of the same source tree (sourceTreeSha256 ${base.sourceTreeSha256} against ${exported.sourceTreeSha256}); none of the Unity venue is exempt`);
    return claim;
  }
  const before = new Map(base.exportEntries.map((entry) => [entry.path, entry.sha256]));
  const after = new Set(exported.exportEntries.map((entry) => entry.path));
  const lacking = base.exportEntries.filter((entry) => !after.has(entry.path)).map((entry) => entry.path);
  if (lacking.length > 0) {
    claim.problems.push(`the default export has ${plural(lacking.length, 'file')} the venue export lacks: ${lacking.slice(0, 3).join(', ')}; the pair is not default and venue of one tree`);
    return claim;
  }
  for (const entry of exported.exportEntries) {
    const known = before.get(entry.path);
    if (known === entry.sha256) continue;
    if (known !== undefined) claim.changed.push(entry.path.startsWith(UNITY_ASSETS_ROOT) ? entry.path.slice(UNITY_ASSETS_ROOT.length) : entry.path);
    else if (entry.path.startsWith(UNITY_ASSETS_ROOT)) claim.assets.push({ path: entry.path.slice(UNITY_ASSETS_ROOT.length), sha256: entry.sha256 });
    else claim.otherAdded.push(entry.path);
  }
  if (claim.assets.length === 0) claim.problems.push('the venue receipt is present but the venue export adds no data file to the default export; nothing can be exempt');
  claim.identified = true;
  return claim;
}

/** The artifact side: each venue data file must be in the artifact under the packed name with the receipt's sha256. Returns the entries that are. */
function acceptUnityVenueAssets(assets, entries, readEntry, problems) {
  const prefix = entries.some((entry) => entry.name.startsWith('base/')) ? 'base/' : '';
  const accepted = [];
  for (const asset of assets) {
    const name = `${prefix}assets/${asset.path}`;
    const entry = entries.find((candidate) => candidate.name === name);
    if (!entry) {
      problems.push(`Unity venue: the export receipt lists ${asset.path} but the artifact has no ${name}`);
      continue;
    }
    let hash;
    try {
      hash = sha256(readEntry(name));
    } catch (error) {
      problems.push(`Unity venue: ${name} cannot be read (${error instanceof Error ? error.message : String(error)}); it counts against the ceiling`);
      continue;
    }
    if (hash !== asset.sha256) problems.push(`Unity venue: ${name} does not match the export receipt's sha256; it counts against the ceiling`);
    else accepted.push(entry);
  }
  return accepted;
}

/**
 * The narrow exemption of the sideload build (ruling R-15). Returns the verdict inputs; never mutates its arguments.
 *  - only an artifact whose name says -PREVIEW- (what build-android.sh --preview writes) is ever exempted: a release-named file
 *    with the payload gets no exemption and a problem;
 *  - each requested add-on also needs its name tag (-EVERYTHING-, -CAMERA-, -VENUE-), so the flag that built the file must match;
 *  - camera: only files the pack's MANIFEST.json declares, byte count and sha256 verified, plus that manifest; venue: the GLB files
 *    of the web payload; each within a stored-byte cap;
 *  - everything else, inside those folders or anywhere, stays in the remainder that the ceiling is applied to.
 */
export function accountAddons({ artifactName, artifactBytes, entries, addons, readEntry, unityVenue = null }) {
  const problems = [];
  const items = [];
  const exempt = new Map();
  const preview = /-PREVIEW-/u.test(artifactName);
  if (!preview) {
    problems.push(`${artifactName} is not a -PREVIEW- artifact: add-on accounting is only for the sideload build, so nothing is exempt and the whole file counts`);
  }
  for (const id of addons) {
    const spec = ADDONS[id];
    const item = { id, title: spec.title, files: [], rawBytes: 0, storedBytes: 0, verified: false };
    items.push(item);
    if (!preview) continue;
    if (!spec.nameTag.test(artifactName)) {
      problems.push(`${artifactName} does not carry the ${id} tag (build with --everything, or --${id === 'camera' ? 'camera-bundle' : 'venue-bake'}); the ${id} add-on is not exempt`);
      continue;
    }
    const matches = entries.filter((entry) => spec.pattern.test(entry.name));
    if (matches.length === 0) {
      problems.push(`the ${id} add-on was declared but the artifact carries none of its files`);
      continue;
    }
    const before = problems.length;
    const accepted = id === 'camera' ? acceptCameraPack(matches, readEntry, problems) : matches;
    const storedBytes = accepted.reduce((sum, entry) => sum + entry.storedBytes, 0);
    if (storedBytes > spec.maxStoredBytes) {
      problems.push(`the ${id} add-on is ${storedBytes} stored bytes, above its cap of ${spec.maxStoredBytes}; none of it is exempt`);
      continue;
    }
    for (const entry of accepted) exempt.set(entry.name, entry);
    item.files = accepted.map((entry) => ({ name: entry.name, rawBytes: entry.rawBytes, storedBytes: entry.storedBytes }));
    item.rawBytes = accepted.reduce((sum, entry) => sum + entry.rawBytes, 0);
    item.storedBytes = storedBytes;
    item.verified = problems.length === before;
  }
  if (unityVenue && preview && addons.includes('venue') && ADDONS.venue.nameTag.test(artifactName)) {
    const item = { id: 'venue-unity', title: UNITY_VENUE_TITLE, files: [], rawBytes: 0, storedBytes: 0, verified: false };
    items.push(item);
    const before = problems.length;
    problems.push(...unityVenue.problems);
    if (!unityVenue.present) {
      item.note = `the bound Unity export carries no venue add-on (no ${VENUE_RECEIPT_FILE}); nothing to exempt`;
    } else if (unityVenue.problems.length === 0 && !unityVenue.identified) {
      item.note = `receipt valid (${plural(unityVenue.receipt.fileCount, 'source file')}, ${unityVenue.receipt.sourceBytes} source bytes), but its compiled data files cannot be told apart from the rest of the Unity data without --unity-default-export; they stay in the remainder (conservative)`;
    } else if (unityVenue.problems.length === 0) {
      const accepted = acceptUnityVenueAssets(unityVenue.assets, entries, readEntry, problems);
      const storedBytes = accepted.reduce((sum, entry) => sum + entry.storedBytes, 0);
      if (storedBytes > UNITY_VENUE_MAX_STORED_BYTES) {
        problems.push(`the Unity venue add-on is ${storedBytes} stored bytes, above its cap of ${UNITY_VENUE_MAX_STORED_BYTES}; none of it is exempt`);
      } else {
        for (const entry of accepted) exempt.set(entry.name, entry);
        item.files = accepted.map((entry) => ({ name: entry.name, rawBytes: entry.rawBytes, storedBytes: entry.storedBytes }));
        item.rawBytes = accepted.reduce((sum, entry) => sum + entry.rawBytes, 0);
        item.storedBytes = storedBytes;
        item.verified = problems.length === before;
      }
    }
  }
  const exemptStoredBytes = [...exempt.values()].reduce((sum, entry) => sum + entry.storedBytes, 0);
  return {
    label: SIDELOAD_LABEL,
    totalBytes: artifactBytes,
    exemptStoredBytes,
    remainderBytes: artifactBytes - exemptStoredBytes,
    items,
    problems,
    ...(unityVenue ? { unityVenue } : {}),
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

function listZipEntries(unzip, path) {
  const result = spawnSync(unzip, ['-v', path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`could not run ${unzip}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`could not list ${path}: ${(result.stderr || result.stdout || '').trim() || `exit ${result.status}`}`);
  const rows = parseUnzipListing(result.stdout);
  if (rows.length === 0) throw new Error(`${path} lists no entries`);
  return rows;
}

function readZipEntry(unzip, path, name) {
  if (!/^[A-Za-z0-9._/-]+$/u.test(name)) throw new Error(`will not read the unusual entry name ${JSON.stringify(name)}`);
  const result = spawnSync(unzip, ['-p', path, name], { maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`could not run ${unzip}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`could not read ${name} from ${path}`);
  return result.stdout;
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
  const unityVenue = options.unityExport
    ? loadUnityVenueClaim({ exportDir: options.unityExport, defaultExportDir: options.unityDefaultExport, venueReceiptPath: options.unityVenueReceipt })
    : null;
  const results = [];
  for (const [label, candidate] of candidates) {
    const path = resolve(candidate);
    if (!existsSync(path)) {
      if (explicit) throw new Error(`${label} does not exist: ${path}`);
      continue;
    }
    const stats = statSync(path);
    if (!stats.isFile()) throw new Error(`${label} is not a regular file: ${path}`);
    if (options.addons.length === 0) {
      results.push(resultForBytes(label, path, stats.size, limitBytes, warningBytes));
      continue;
    }
    const accounting = accountAddons({
      artifactName: basename(path),
      artifactBytes: stats.size,
      entries: listZipEntries(options.unzip, path),
      addons: options.addons,
      readEntry: (name) => readZipEntry(options.unzip, path, name),
      unityVenue,
    });
    const ceiling = resultForBytes(label, path, accounting.remainderBytes, limitBytes, warningBytes);
    results.push({
      ...ceiling,
      bytes: stats.size,
      ceilingBytes: accounting.remainderBytes,
      pass: ceiling.pass && accounting.problems.length === 0,
      addons: accounting,
    });
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
      sideload: options.addons.length > 0 ? SIDELOAD_LABEL : null,
      artifacts,
      installed,
      installedSizeProof: 'UNPROVEN. Requires Play Console estimated install size and/or full fresh-device StorageStats including mandatory post-launch data.',
      pass,
    },
    json: options.json,
  };
}

/** The report as lines of text (exported so the wording of the sideload report is tested). */
export function reportLines(result) {
  const out = [];
  const say = (line) => out.push(line);
  if (result.help) {
    say(usage());
    return out;
  }
  if (result.json) {
    say(JSON.stringify(result.report, null, 2));
    return out;
  }

  const { report } = result;
  say(`Android size ceiling: ${report.limit.decimalMb} MB (${report.limit.bytes} bytes); headroom warning above ${report.warning.decimalMb} MB`);
  say('Artifact preflight (necessary, not installed-size proof):');
  for (const item of report.artifacts) {
    const verdict = item.pass ? (item.warning ? 'WARN' : 'PASS') : 'FAIL';
    if (!item.addons) {
      say(`  ${verdict}  ${item.label}: ${formatMb(item.bytes)}  ${item.path}`);
      continue;
    }
    // Sideload build: always both numbers, the add-ons on their own lines (ruling R-15).
    say(`  ${verdict}  ${item.label}: ${SIDELOAD_LABEL}  ${item.path}`);
    say(`        ceiling check WITHOUT the declared add-ons: ${item.ceilingBytes} bytes (${formatMb(item.ceilingBytes)}); ${item.remainingBytes >= 0 ? `${item.remainingBytes} bytes below` : `${-item.remainingBytes} bytes ABOVE`} the ${item.limitBytes}-byte ceiling${item.warning ? '; above the headroom warning line' : ''}`);
    for (const addon of item.addons.items) {
      const detail = addon.note ?? (addon.verified ? 'declared and verified' : 'NOT verified, counted against the ceiling');
      say(`        add-on ${addon.id} (${addon.title}): ${addon.files.length} file${addon.files.length === 1 ? '' : 's'}, ${addon.storedBytes} bytes stored (${addon.rawBytes} raw), ${detail}`);
    }
    const unity = item.addons.unityVenue;
    if (unity?.receipt) {
      say(`        Unity venue receipt: ${plural(unity.receipt.fileCount, 'source file')}, ${unity.receipt.sourceBytes} source bytes (sha256 ${unity.receipt.sha256.slice(0, 12)}...); export ${unity.exportDir}`);
      if (unity.changed.length > 0) say(`        Unity files changed, counted in the remainder: ${unity.changed.join(', ')}`);
      if (unity.otherAdded.length > 0) say(`        Unity venue export files added outside unityLibrary/src/main/assets, not exempt: ${unity.otherAdded.join(', ')}`);
    }
    say(`        total WITH the add-ons: ${item.bytes} bytes (${formatMb(item.bytes)}); not compared with the ceiling`);
    for (const problem of item.addons.problems) say(`        PROBLEM: ${problem}`);
  }
  if (report.installed) {
    const item = report.installed;
    say('On-device installed-package measurement:');
    const verdict = item.pass ? (item.warning ? 'WARN' : 'PASS') : 'FAIL';
    say(`  ${verdict}  ${formatMb(item.bytes)}  ${item.path}`);
    say(`  Device: ${item.device.manufacturer} ${item.device.model}; API ${item.device.sdk}; ${item.device.abi}; serial ${item.device.serial}`);
    say(`  Install: first=${item.install.firstInstallTime ?? 'unknown'}; updated=${item.install.lastUpdateTime ?? 'unknown'}`);
    say(`  CAUTION: ${item.install.caveat}`);
  } else {
    say('Partial on-device code measurement: NOT RUN (use --device on an already-installed build).');
  }
  say(`Installed-size launch proof: ${report.installedSizeProof}`);
  if (report.sideload) {
    say(report.pass
      ? `PASS (${report.sideload}): everything except the declared add-ons is within the ${report.limit.bytes}-byte ceiling. This artifact is not an upload candidate and does not show the first-ball install size.`
      : `FAIL (${report.sideload}): the ceiling is exceeded without the add-ons, or an add-on could not be verified (see the lines above).`);
    return out;
  }
  say(report.pass ? 'PASS: measured size gates are within budget.' : 'FAIL: the 50 MB Android size ceiling was exceeded.');
  return out;
}

function printReport(result) {
  console.log(reportLines(result).join('\n'));
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
