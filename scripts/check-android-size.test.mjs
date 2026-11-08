import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { deflateRawSync } from 'node:zlib';

import {
  ADDONS,
  DEFAULT_LIMIT_BYTES,
  DEFAULT_WARNING_BYTES,
  SIDELOAD_LABEL,
  UNITY_VENUE_MAX_STORED_BYTES,
  parseArgs,
  parseDuBytes,
  parsePackagePaths,
  parsePositiveMb,
  parseUnzipListing,
  parseVenueReceipt,
  reportLines,
  resultForBytes,
  run,
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

// ---------------------------------------------------------------------------------------------------------------------------
// The sideload "everything" build (ruling R-15): a narrow, named exemption for the camera pack and the baked venue. These tests
// build real zip files (store or deflate) and run the real command, with a 1,000,000-byte ceiling to keep them small.
// ---------------------------------------------------------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A minimal zip writer: [{ name, data, deflate? }] -> Buffer that Info-ZIP unzip reads. */
function zipBytes(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const raw = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const data = file.deflate ? deflateRawSync(raw, { level: 9 }) : raw;
    const name = Buffer.from(file.name);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(file.deflate ? 8 : 0, 8);
    header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(crc32(raw), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(file.deflate ? 8 : 0, 10);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc32(raw), 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    parts.push(header, name, data);
    central.push(entry, name);
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

/** Bytes that do not compress, so stored and raw sizes agree whatever the method. */
function noise(length, seed) {
  const buffer = Buffer.alloc(length);
  let state = seed >>> 0 || 1;
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    buffer[i] = state >>> 24;
  }
  return buffer;
}

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
const workDir = mkdtempSync(join(tmpdir(), 'vande-size-test-'));
after(() => rmSync(workDir, { recursive: true, force: true }));

const PACK = {
  'engine.bin': noise(300_000, 1),
  'worker.bin': noise(100_000, 2),
  'model.bin': noise(500_000, 3),
};
const VENUE = { 'assets/venue-p-Hq81xZ.glb': noise(110_000, 4), 'assets/venue-b-Zk29aQ.glb': noise(45_000, 5) };
const BASE = { 'assets/index-test.js': noise(600_000, 6), 'AndroidManifest.xml': Buffer.from('<manifest/>') };

/** Entries for one artifact; prefix is '' for an APK and 'base/' for an AAB. */
function entriesFor({ prefix = '', pack = PACK, manifestFiles, venue = VENUE, base = BASE, extraPose = {}, extraPlain = {} } = {}) {
  const dir = `${prefix}assets/public/models/pose/0.10.35-test/`;
  const declared = manifestFiles ?? Object.entries(pack).map(([path, data]) => ({ path, bytes: data.length, sha256: sha(data) }));
  const files = [];
  for (const [name, data] of Object.entries(base)) files.push({ name: name.startsWith('assets/') ? `${prefix}assets/public/${name}` : `${prefix}${name}`, data });
  for (const [name, data] of Object.entries(pack)) files.push({ name: `${dir}${name}`, data });
  for (const [name, data] of Object.entries(extraPose)) files.push({ name: `${dir}${name}`, data });
  files.push({ name: `${dir}MANIFEST.json`, data: JSON.stringify({ version: '0.10.35', files: declared }, null, 2) });
  for (const [name, data] of Object.entries(venue)) files.push({ name: `${prefix}assets/public/${name}`, data });
  for (const [name, data] of Object.entries(extraPlain)) files.push({ name: `${prefix}${name}`, data });
  return files;
}

let counter = 0;
function artifact(fileName, files) {
  counter += 1;
  const path = join(workDir, `${counter}-${fileName}`);
  writeFileSync(path, zipBytes(files));
  return path;
}

const SIDELOAD_APK = 'vande-cricket-1.0.0-1-b12356b-dirty-abc-PREVIEW-UNITY-EVERYTHING-0123456789abcdef-release.apk';
const SIDELOAD_AAB = SIDELOAD_APK.replace(/\.apk$/u, '.aab');
const CEILING = ['--limit-mb', '1', '--warning-mb', '0.9'];
const BOTH = ['--addon', 'camera', '--addon', 'venue'];

describe('Android size budget: the sideload "everything" exemption (R-15)', () => {
  it('reads the rows of unzip -v, including a negative compression ratio', () => {
    const rows = parseUnzipListing(`Archive:  x.apk
 Length   Method    Size  Cmpr    Date    Time   CRC-32   Name
--------  ------  ------- ---- ---------- ----- --------  ----
      46  Defl:N       48  -4% 01-01-1981 01:01 b8ff6554  META-INF/version-control-info.textproto
   19144  Defl:N     4344  77% 01-01-1981 01:01 256d2b7e  AndroidManifest.xml
 2750340  Stored  2750340   0% 2026-11-08 09:30 e0822a83  my classes.dex
--------          -------  ---                            -------
65610654         48375572  26%                            903 files
`);
    assert.deepEqual(rows.map((row) => [row.name, row.rawBytes, row.storedBytes]), [
      ['META-INF/version-control-info.textproto', 46, 48],
      ['AndroidManifest.xml', 19144, 4344],
      ['my classes.dex', 2750340, 2750340],
    ]);
  });

  it('knows only the camera and venue add-ons and takes them from the command line', () => {
    assert.deepEqual(Object.keys(ADDONS), ['camera', 'venue']);
    assert.deepEqual(parseArgs([]).addons, []);
    assert.deepEqual(parseArgs(['--addon', 'camera', '--addon', 'venue', '--addon', 'camera']).addons, ['camera', 'venue']);
    assert.throws(() => parseArgs(['--addon', 'everything']), /--addon must be one of camera, venue/u);
    assert.throws(() => parseArgs(['--addon']), /requires a value/u);
  });

  it('exempts only the verified add-ons of a -PREVIEW- artifact and prints both numbers, in an APK and in an AAB', () => {
    const apk = artifact(SIDELOAD_APK, entriesFor());
    const aab = artifact(SIDELOAD_AAB, entriesFor({ prefix: 'base/' }));
    const result = run(['--apk', apk, '--aab', aab, ...BOTH, ...CEILING]);
    assert.equal(result.exitCode, 0);
    assert.equal(result.report.sideload, SIDELOAD_LABEL);
    for (const item of result.report.artifacts) {
      assert.equal(item.pass, true);
      assert.equal(item.addons.problems.length, 0);
      const camera = item.addons.items.find((addon) => addon.id === 'camera');
      const venue = item.addons.items.find((addon) => addon.id === 'venue');
      assert.equal(camera.files.length, 4);
      assert.equal(camera.rawBytes, 300_000 + 100_000 + 500_000 + camera.files.find((file) => file.name.endsWith('MANIFEST.json')).rawBytes);
      assert.equal(camera.verified, true);
      assert.equal(venue.storedBytes, 155_000);
      assert.equal(item.ceilingBytes + camera.storedBytes + venue.storedBytes, item.bytes);
      assert.ok(item.bytes > 1_000_000, 'the total is over the ceiling, which is the point of the exemption');
      assert.ok(item.ceilingBytes <= 1_000_000, 'what is left is within it');
    }
    const text = reportLines(result).join('\n');
    assert.match(text, /SIDELOAD-EVERYTHING, NOT A RELEASE/u);
    assert.match(text, /ceiling check WITHOUT the declared add-ons: \d+ bytes/u);
    assert.match(text, /add-on camera \(.*\): 4 files, \d+ bytes stored \(\d+ raw\), declared and verified/u);
    assert.match(text, /add-on venue \(.*\): 2 files, 155000 bytes stored/u);
    assert.match(text, /total WITH the add-ons: \d+ bytes/u);
    assert.match(text, /PASS \(SIDELOAD-EVERYTHING, NOT A RELEASE\)/u);
    assert.doesNotMatch(text, /PROBLEM/u);
  });

  it('still fails the same artifact when no add-on is declared (an undeclared payload counts in full)', () => {
    const apk = artifact(SIDELOAD_APK, entriesFor());
    const result = run(['--apk', apk, ...CEILING]);
    assert.equal(result.exitCode, 1);
    assert.equal(result.report.sideload, null);
    assert.equal(result.report.artifacts[0].addons, undefined);
    assert.ok(result.report.artifacts[0].bytes > 1_000_000);
  });

  it('refuses the exemption for a release-named artifact: the whole file counts and a problem is raised', () => {
    const release = artifact('vande-cricket-1.0.0-1-b12356b-release.apk', entriesFor());
    const result = run(['--apk', release, ...BOTH, ...CEILING]);
    const item = result.report.artifacts[0];
    assert.equal(result.exitCode, 1);
    assert.equal(item.pass, false);
    assert.equal(item.ceilingBytes, item.bytes);
    assert.equal(item.addons.exemptStoredBytes, 0);
    assert.match(item.addons.problems[0], /not a -PREVIEW- artifact/u);
    assert.match(reportLines(result).join('\n'), /FAIL \(SIDELOAD-EVERYTHING, NOT A RELEASE\)/u);
    // Even a release-named file that carries the add-on tag in its name gets no exemption: only -PREVIEW- decides.
    const tagged = artifact('vande-cricket-1.0.0-1-b12356b-UNITY-EVERYTHING-0123456789abcdef-release.apk', entriesFor());
    const taggedResult = run(['--apk', tagged, ...BOTH, ...CEILING]);
    assert.equal(taggedResult.exitCode, 1);
    assert.equal(taggedResult.report.artifacts[0].addons.exemptStoredBytes, 0);
    assert.equal(taggedResult.report.artifacts[0].ceilingBytes, taggedResult.report.artifacts[0].bytes);
  });

  it('refuses an add-on whose build-flag tag is missing from the name', () => {
    const untagged = artifact('vande-cricket-1.0.0-1-b12356b-PREVIEW-release.apk', entriesFor());
    const result = run(['--apk', untagged, ...BOTH, ...CEILING]);
    const item = result.report.artifacts[0];
    assert.equal(result.exitCode, 1);
    assert.equal(item.addons.exemptStoredBytes, 0);
    assert.equal(item.addons.problems.filter((problem) => /does not carry the (camera|venue) tag/u.test(problem)).length, 2);
    const cameraOnly = artifact('vande-cricket-1.0.0-1-b12356b-PREVIEW-CAMERA-release.apk', entriesFor());
    const mixed = run(['--apk', cameraOnly, ...BOTH, ...CEILING]);
    assert.equal(mixed.exitCode, 1);
    assert.match(mixed.report.artifacts[0].addons.problems.join(' '), /does not carry the venue tag/u);
  });

  it('counts a file inside the pack folder that the manifest does not declare against the ceiling', () => {
    const apk = artifact(SIDELOAD_APK, entriesFor({ extraPose: { 'extra.bin': noise(450_000, 9) } }));
    const result = run(['--apk', apk, ...BOTH, ...CEILING]);
    const item = result.report.artifacts[0];
    assert.equal(result.exitCode, 1);
    assert.match(item.addons.problems.join(' '), /not declared by MANIFEST\.json count against the ceiling: .*extra\.bin/u);
    assert.ok(item.ceilingBytes > 1_000_000, 'the undeclared bytes stayed in the remainder');
  });

  it('cannot hide baseline bytes: a large file outside the add-on folders stays in the remainder', () => {
    const apk = artifact(SIDELOAD_APK, entriesFor({ base: { ...BASE, 'assets/big-chunk.js': noise(500_000, 11) } }));
    const result = run(['--apk', apk, ...BOTH, ...CEILING]);
    const item = result.report.artifacts[0];
    assert.equal(result.exitCode, 1);
    assert.equal(item.addons.problems.length, 0, 'the add-ons themselves are fine');
    assert.ok(item.ceilingBytes > 1_000_000);
    assert.equal(item.pass, false);
  });

  it('does not exempt a pack file whose size or sha256 differs from the manifest', () => {
    const wrongBytes = Object.entries(PACK).map(([path, data]) => ({ path, bytes: path === 'model.bin' ? data.length + 1 : data.length, sha256: sha(data) }));
    const a = run(['--apk', artifact(SIDELOAD_APK, entriesFor({ manifestFiles: wrongBytes })), '--addon', 'camera', ...CEILING]);
    assert.equal(a.exitCode, 1);
    assert.match(a.report.artifacts[0].addons.problems.join(' '), /model\.bin is 500000 bytes, the manifest says 500001/u);
    const wrongHash = Object.entries(PACK).map(([path, data]) => ({ path, bytes: data.length, sha256: path === 'engine.bin' ? '0'.repeat(64) : sha(data) }));
    const b = run(['--apk', artifact(SIDELOAD_APK, entriesFor({ manifestFiles: wrongHash })), '--addon', 'camera', ...CEILING]);
    assert.equal(b.exitCode, 1);
    assert.match(b.report.artifacts[0].addons.problems.join(' '), /engine\.bin does not match the manifest's sha256/u);
    assert.equal(b.report.artifacts[0].addons.items[0].verified, false);
  });

  it('fails when a declared add-on is not in the artifact, and when the manifest is missing', () => {
    const noVenue = run(['--apk', artifact(SIDELOAD_APK, entriesFor({ venue: {} })), ...BOTH, ...CEILING]);
    assert.equal(noVenue.exitCode, 1);
    assert.match(noVenue.report.artifacts[0].addons.problems.join(' '), /venue add-on was declared but the artifact carries none/u);
    const files = entriesFor().filter((file) => !file.name.endsWith('MANIFEST.json'));
    const noManifest = run(['--apk', artifact(SIDELOAD_APK, files), '--addon', 'camera', ...CEILING]);
    assert.equal(noManifest.exitCode, 1);
    assert.match(noManifest.report.artifacts[0].addons.problems.join(' '), /exactly one models\/pose\/<id>\/MANIFEST\.json, found 0/u);
  });

  it('caps the venue exemption so it cannot grow into a hiding place', () => {
    const huge = { 'assets/venue-p-Hq81xZ.glb': noise(4_000_001, 12) };
    const result = run(['--apk', artifact(SIDELOAD_APK, entriesFor({ venue: huge })), '--addon', 'venue', ...CEILING]);
    assert.equal(result.exitCode, 1);
    assert.match(result.report.artifacts[0].addons.problems.join(' '), /venue add-on is 4000001 stored bytes, above its cap of 4000000/u);
    assert.ok(result.report.artifacts[0].ceilingBytes > 4_000_000);
  });

  it('measures the exemption in stored (compressed) bytes, so a compressible pack is not over-credited', () => {
    const squashable = { 'engine.bin': Buffer.alloc(300_000, 7), 'worker.bin': Buffer.alloc(100_000, 8), 'model.bin': Buffer.alloc(500_000, 9) };
    const files = entriesFor({ pack: squashable }).map((file) => ({ ...file, deflate: file.name.includes('/models/pose/') && !file.name.endsWith('.json') }));
    const result = run(['--apk', artifact(SIDELOAD_APK, files), '--addon', 'camera', ...CEILING]);
    const camera = result.report.artifacts[0].addons.items[0];
    assert.equal(camera.verified, true);
    assert.ok(camera.storedBytes < 20_000, 'stored far below the 900,000 raw bytes');
    assert.equal(result.report.artifacts[0].ceilingBytes + camera.storedBytes, result.report.artifacts[0].bytes);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// The Unity venue add-on (ruling R-48): the sideload export made with VANDE_UNITY_VENUE=1 carries the venue as compiled data files.
// The venue receipt (.vande-venue-addon.properties) names the four SOURCE files, which a player build does not store as FBX or PNG,
// so the compiled files are found by comparing the export receipt with that of a default export of the same source tree. These
// tests build real receipts, real export folders and real zips.
// ---------------------------------------------------------------------------------------------------------------------------

const b64u = (text) => Buffer.from(text, 'utf8').toString('base64url');
const VENUE_SRC_DIR = 'Assets/VandePractice/Runtime/Presentation/Production/Venue';
const UNITY_ASSETS = 'unityLibrary/src/main/assets/';

function treeDigest(entries) {
  return sha(Buffer.from(entries.map((entry, index) => `${String(index).padStart(6, '0')}\t0\t${entry.sha}\t${b64u(entry.path)}\n`).join('')));
}
function receiptEntries(files) {
  return Object.entries(files)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, data]) => ({ path, sha: sha(data) }));
}
/** A real `.vande-export.properties` (schema 3): the tree digests are computed the way the Unity exporter computes them. */
function exportReceiptText({ source, exported }) {
  const src = receiptEntries(source);
  const out = receiptEntries(exported);
  const lines = [
    'schema=3',
    'editorVersion=6000.3.27f1',
    'target=Android',
    'scriptingBackend=IL2CPP',
    'architectures=ARM64',
    'minSdk=28',
    `sourceFileCount=${src.length}`,
    `sourceTreeSha256=${treeDigest(src)}`,
    `exportFileCount=${out.length}`,
    `exportTreeSha256=${treeDigest(out)}`,
    ...src.map((entry, index) => `sourceFile${String(index).padStart(6, '0')}=0:${entry.sha}:${b64u(entry.path)}`),
    ...out.map((entry, index) => `exportFile${String(index).padStart(6, '0')}=0:${entry.sha}:${b64u(entry.path)}`),
  ];
  return `${lines.join('\n')}\n`;
}
/** A `.vande-venue-addon.properties` as VandeVenueAddonTool.Receipt() writes it (names sorted, then sourceBytes). */
function venueReceiptText(files, { schema = 'vande-venue-addon-1', sideload = 'true', sourceBytes } = {}) {
  const names = Object.keys(files).sort();
  const lines = [`schema=${schema}`, `sideload=${sideload}`];
  for (const name of names) lines.push(`file.${name}.bytes=${files[name].length}`, `file.${name}.sha256=${sha(files[name])}`);
  lines.push(`sourceBytes=${sourceBytes ?? names.reduce((sum, name) => sum + files[name].length, 0)}`);
  return `${lines.join('\n')}\n`;
}

const VENUE_SOURCES = { 'venue-atlas.png': noise(5_300, 51), 'wedge-lod0.fbx': noise(2_100, 52), 'wedge-lod1.fbx': noise(1_300, 53), 'wedge-lod2.fbx': noise(1_250, 54) };
const TREE_SOURCE = {
  'Assets/Other/a.cs': noise(300, 55),
  ...Object.fromEntries(Object.entries(VENUE_SOURCES).map(([name, data]) => [`${VENUE_SRC_DIR}/${name}`, data])),
};
const DEFAULT_EXPORT_FILES = {
  'unityLibrary/build.gradle': Buffer.from('apply plugin: "com.android.library"'),
  'unityLibrary/src/main/jniLibs/arm64-v8a/libunity.so': noise(5_000, 56),
  [`${UNITY_ASSETS}bin/Data/globalgamemanagers`]: noise(4_500, 57),
  [`${UNITY_ASSETS}bin/Data/00aa00aa`]: noise(8_000, 58),
};
const UNITY_VENUE_DATA = {
  [`${UNITY_ASSETS}bin/Data/4238fb0b`]: noise(2_125, 61),
  [`${UNITY_ASSETS}bin/Data/70d43d7a`]: noise(214, 62),
  [`${UNITY_ASSETS}bin/Data/993556f6`]: noise(8_766, 63),
  [`${UNITY_ASSETS}bin/Data/d25df2b8`]: noise(302, 64),
  [`${UNITY_ASSETS}bin/Data/d986eca9`]: noise(52, 65),
};
const UNITY_VENUE_IDS = ['4238fb0b', '70d43d7a', '993556f6', 'd25df2b8', 'd986eca9'];
const UNITY_VENUE_DATA_BYTES = 2_125 + 214 + 8_766 + 302 + 52;
const VENUE_EXPORT_FILES = { ...DEFAULT_EXPORT_FILES, [`${UNITY_ASSETS}bin/Data/globalgamemanagers`]: noise(4_538, 66), ...UNITY_VENUE_DATA };

function unityExport(name, { exported, source = TREE_SOURCE, venue = null } = {}) {
  const dir = join(workDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.vande-export.properties'), exportReceiptText({ source, exported }));
  if (venue !== null) writeFileSync(join(dir, '.vande-venue-addon.properties'), venue);
  return dir;
}
const DEFAULT_EXPORT = unityExport('unity-default', { exported: DEFAULT_EXPORT_FILES });
const VENUE_EXPORT = unityExport('unity-venue', { exported: VENUE_EXPORT_FILES, venue: venueReceiptText(VENUE_SOURCES) });

/** What the Gradle build packs from an export: unityLibrary/src/main/assets/<x> becomes assets/<x> (APK) or base/assets/<x> (AAB). */
const packedUnityAssets = (exported) =>
  Object.fromEntries(Object.entries(exported).filter(([path]) => path.startsWith(UNITY_ASSETS)).map(([path, data]) => [path.slice('unityLibrary/src/main/'.length), data]));
const UNITY_FLAGS = ['--unity-export', VENUE_EXPORT, '--unity-default-export', DEFAULT_EXPORT];
const unityItem = (artifactResult) => artifactResult.addons.items.find((addon) => addon.id === 'venue-unity');

const REAL_VENUE_RECEIPT = `schema=vande-venue-addon-1
sideload=true
file.venue-atlas.png.bytes=53699
file.venue-atlas.png.sha256=7b43ebc90c1d215f0d64e9e5e3197426fdcd52b4a062f58fabb9ab1d1ecc9063
file.wedge-lod0.fbx.bytes=21420
file.wedge-lod0.fbx.sha256=333f979b106696316b8b6bd8632cd28095b4a7f38996075302ae68c04ccda4e3
file.wedge-lod1.fbx.bytes=13036
file.wedge-lod1.fbx.sha256=40468bf2c4c0821c46811a9af8344daa2025a2e3380abd884ccb4bced1149619
file.wedge-lod2.fbx.bytes=12540
file.wedge-lod2.fbx.sha256=b8c366492fd4bdad3152b6a1c3f55ca158de8a4c81e38dcce154e22d3be8a96b
sourceBytes=100695
`;

describe('Android size budget: the venue receipt of the Unity export', () => {
  it('reads the receipt exactly as the Unity exporter wrote it for the final sideload export', () => {
    const receipt = parseVenueReceipt(REAL_VENUE_RECEIPT);
    assert.equal(receipt.schema, 'vande-venue-addon-1');
    assert.equal(receipt.sideload, true);
    assert.deepEqual(receipt.files.map((file) => [file.name, file.bytes]), [
      ['venue-atlas.png', 53_699],
      ['wedge-lod0.fbx', 21_420],
      ['wedge-lod1.fbx', 13_036],
      ['wedge-lod2.fbx', 12_540],
    ]);
    assert.equal(receipt.files[0].sha256, '7b43ebc90c1d215f0d64e9e5e3197426fdcd52b4a062f58fabb9ab1d1ecc9063');
    assert.equal(receipt.sourceBytes, 100_695);
  });

  it('refuses a receipt that is not the sideload schema, does not add up, or has anything unexpected in it', () => {
    const bad = (text, pattern) => assert.throws(() => parseVenueReceipt(text), pattern);
    bad(REAL_VENUE_RECEIPT.replace('vande-venue-addon-1', 'vande-venue-addon-2'), /schema must be vande-venue-addon-1/u);
    bad(REAL_VENUE_RECEIPT.replace('sideload=true', 'sideload=false'), /sideload=true/u);
    bad(REAL_VENUE_RECEIPT.replace('sourceBytes=100695', 'sourceBytes=100696'), /sourceBytes 100696 is not the sum of the file bytes 100695/u);
    bad(REAL_VENUE_RECEIPT.replace('333f979b106696316b8b6bd8632cd28095b4a7f38996075302ae68c04ccda4e3', 'xyz'), /sha256 is not 64 lowercase hex digits/u);
    bad(REAL_VENUE_RECEIPT.replace('file.wedge-lod1.fbx.bytes=13036\n', ''), /missing file\.wedge-lod1\.fbx\.bytes/u);
    bad(`${REAL_VENUE_RECEIPT}extra=1\n`, /unknown key extra/u);
    bad(`${REAL_VENUE_RECEIPT}sideload=true\n`, /duplicate key sideload/u);
    bad(REAL_VENUE_RECEIPT.replace(/\n/gu, '\r\n'), /LF-terminated/u);
    bad(REAL_VENUE_RECEIPT.replace('file.wedge-lod0.fbx.bytes=21420', 'file.wedge-lod0.fbx.bytes=-5'), /bytes is not a positive whole number/u);
    bad('schema=vande-venue-addon-1\nsideload=true\nsourceBytes=0\n', /lists no files/u);
  });
});

describe('Android size budget: the Unity venue data files of a sideload build (R-48)', () => {
  const sideloadWith = (extraPlain, prefix = '') => artifact(prefix === '' ? SIDELOAD_APK : SIDELOAD_AAB, entriesFor({ prefix, extraPlain }));
  const data = packedUnityAssets(VENUE_EXPORT_FILES);

  it('exempts exactly the five compiled venue files, in an APK and in an AAB, and leaves the changed globalgamemanagers in the remainder', () => {
    const apk = sideloadWith(data);
    const aab = sideloadWith(data, 'base/');
    const result = run(['--apk', apk, '--aab', aab, ...BOTH, ...UNITY_FLAGS, ...CEILING]);
    assert.equal(result.exitCode, 0);
    for (const item of result.report.artifacts) {
      assert.deepEqual(item.addons.problems, []);
      const unity = unityItem(item);
      const prefix = item.label.startsWith('AAB') ? 'base/' : '';
      assert.deepEqual(
        unity.files.map((file) => file.name).sort(),
        UNITY_VENUE_IDS.map((id) => `${prefix}assets/bin/Data/${id}`).sort(),
      );
      assert.equal(unity.files.length, 5);
      assert.equal(unity.rawBytes, UNITY_VENUE_DATA_BYTES);
      assert.equal(unity.storedBytes, UNITY_VENUE_DATA_BYTES);
      assert.equal(unity.verified, true);
      assert.ok(!unity.files.some((file) => file.name.endsWith('globalgamemanagers')), 'a file that only changed is not exempt');
      const camera = item.addons.items.find((addon) => addon.id === 'camera');
      const venue = item.addons.items.find((addon) => addon.id === 'venue');
      assert.equal(item.ceilingBytes + camera.storedBytes + venue.storedBytes + unity.storedBytes, item.bytes);
      assert.deepEqual(item.addons.unityVenue.changed, ['bin/Data/globalgamemanagers']);
      assert.equal(item.addons.unityVenue.receipt.fileCount, 4);
      assert.equal(item.addons.unityVenue.receipt.sourceBytes, 5_300 + 2_100 + 1_300 + 1_250);
    }
    const text = reportLines(result).join('\n');
    assert.match(text, /add-on venue-unity \(.*\): 5 files, 11459 bytes stored \(11459 raw\), declared and verified/u);
    assert.match(text, /Unity venue receipt: 4 source files, 9950 source bytes/u);
    assert.match(text, /changed, counted in the remainder: bin\/Data\/globalgamemanagers/u);
    assert.doesNotMatch(text, /PROBLEM/u);
  });

  it('counts the same files in the remainder when the default export is not given (nothing can be told apart): conservative, no failure', () => {
    const apk = sideloadWith(data);
    const exempt = run(['--apk', apk, ...BOTH, ...UNITY_FLAGS, ...CEILING]).report.artifacts[0];
    const result = run(['--apk', apk, ...BOTH, '--unity-export', VENUE_EXPORT, ...CEILING]);
    const item = result.report.artifacts[0];
    assert.equal(result.exitCode, 0);
    assert.deepEqual(item.addons.problems, []);
    assert.equal(unityItem(item).files.length, 0);
    assert.equal(unityItem(item).verified, false);
    assert.equal(item.ceilingBytes, exempt.ceilingBytes + UNITY_VENUE_DATA_BYTES, 'the venue files stayed in what the ceiling is applied to');
    const text = reportLines(result).join('\n');
    assert.match(text, /compiled data files cannot be told apart from the rest of the Unity data without --unity-default-export; they stay in the remainder \(conservative\)/u);
    assert.doesNotMatch(text, /PROBLEM/u);
  });

  it('says so when the bound Unity export carries no venue add-on, and exempts nothing for it', () => {
    const plain = unityExport('unity-plain', { exported: DEFAULT_EXPORT_FILES });
    const apk = sideloadWith(packedUnityAssets(DEFAULT_EXPORT_FILES));
    const result = run(['--apk', apk, ...BOTH, '--unity-export', plain, ...CEILING]);
    const item = result.report.artifacts[0];
    assert.equal(result.exitCode, 0);
    assert.equal(unityItem(item).files.length, 0);
    assert.match(reportLines(result).join('\n'), /the bound Unity export carries no venue add-on \(no \.vande-venue-addon\.properties\); nothing to exempt/u);
  });

  it('does not exempt a venue file whose bytes differ from the export receipt, or that the artifact lacks', () => {
    const tampered = { ...data, 'assets/bin/Data/993556f6': noise(8_766, 99) };
    const a = run(['--apk', sideloadWith(tampered), ...BOTH, ...UNITY_FLAGS, ...CEILING]);
    assert.equal(a.exitCode, 1);
    assert.match(a.report.artifacts[0].addons.problems.join(' '), /assets\/bin\/Data\/993556f6 does not match the export receipt's sha256; it counts against the ceiling/u);
    assert.equal(unityItem(a.report.artifacts[0]).files.length, 4, 'the four intact files are still exempt');
    assert.equal(unityItem(a.report.artifacts[0]).verified, false);
    const missing = Object.fromEntries(Object.entries(data).filter(([name]) => name !== 'assets/bin/Data/4238fb0b'));
    const b = run(['--apk', sideloadWith(missing), ...BOTH, ...UNITY_FLAGS, ...CEILING]);
    assert.equal(b.exitCode, 1);
    assert.match(b.report.artifacts[0].addons.problems.join(' '), /lists bin\/Data\/4238fb0b but the artifact has no assets\/bin\/Data\/4238fb0b/u);
  });

  it('refuses a venue receipt that is not the one of this source tree, and a reference export that is not a default export of it', () => {
    const wrongSource = { ...VENUE_SOURCES, 'wedge-lod0.fbx': noise(2_100, 77) };
    const otherReceipt = unityExport('unity-venue-badreceipt', { exported: VENUE_EXPORT_FILES, venue: venueReceiptText(wrongSource) });
    const apk = sideloadWith(data);
    const a = run(['--apk', apk, ...BOTH, '--unity-export', otherReceipt, '--unity-default-export', DEFAULT_EXPORT, ...CEILING]);
    assert.equal(a.exitCode, 1);
    assert.match(a.report.artifacts[0].addons.problems.join(' '), /wedge-lod0\.fbx is not the file in the source tree that the export was bound to/u);
    assert.equal(unityItem(a.report.artifacts[0]).files.length, 0, 'nothing is exempt from a receipt that does not match');

    const carriesVenue = run(['--apk', apk, ...BOTH, '--unity-export', VENUE_EXPORT, '--unity-default-export', VENUE_EXPORT, ...CEILING]);
    assert.equal(carriesVenue.exitCode, 1);
    assert.match(carriesVenue.report.artifacts[0].addons.problems.join(' '), /--unity-default-export carries a venue add-on/u);

    const otherTree = unityExport('unity-default-othertree', { exported: DEFAULT_EXPORT_FILES, source: { ...TREE_SOURCE, 'Assets/Other/b.cs': noise(40, 78) } });
    const differentTree = run(['--apk', apk, ...BOTH, '--unity-export', VENUE_EXPORT, '--unity-default-export', otherTree, ...CEILING]);
    assert.equal(differentTree.exitCode, 1);
    assert.match(differentTree.report.artifacts[0].addons.problems.join(' '), /not an export of the same source tree/u);

    const fewer = { ...DEFAULT_EXPORT_FILES, 'unityLibrary/src/main/jniLibs/arm64-v8a/libextra.so': noise(100, 79) };
    const withExtra = unityExport('unity-default-extra', { exported: fewer });
    const removed = run(['--apk', apk, ...BOTH, '--unity-export', VENUE_EXPORT, '--unity-default-export', withExtra, ...CEILING]);
    assert.equal(removed.exitCode, 1);
    assert.match(removed.report.artifacts[0].addons.problems.join(' '), /the default export has 1 file the venue export lacks: unityLibrary\/src\/main\/jniLibs\/arm64-v8a\/libextra\.so/u);
  });

  it('caps the Unity venue exemption, and exempts only data files (code or libraries that the venue export adds stay in the remainder)', () => {
    const huge = { ...VENUE_EXPORT_FILES, [`${UNITY_ASSETS}bin/Data/f00dbeef`]: noise(UNITY_VENUE_MAX_STORED_BYTES, 80) };
    const hugeExport = unityExport('unity-venue-huge', { exported: huge, venue: venueReceiptText(VENUE_SOURCES) });
    const result = run(['--apk', sideloadWith(packedUnityAssets(huge)), ...BOTH, '--unity-export', hugeExport, '--unity-default-export', DEFAULT_EXPORT, ...CEILING]);
    assert.equal(result.exitCode, 1);
    assert.match(result.report.artifacts[0].addons.problems.join(' '), new RegExp(`the Unity venue add-on is ${UNITY_VENUE_MAX_STORED_BYTES + UNITY_VENUE_DATA_BYTES} stored bytes, above its cap of ${UNITY_VENUE_MAX_STORED_BYTES}; none of it is exempt`, 'u'));

    const withCode = { ...VENUE_EXPORT_FILES, 'unityLibrary/src/main/jniLibs/arm64-v8a/libvenue.so': noise(900, 81) };
    const codeExport = unityExport('unity-venue-code', { exported: withCode, venue: venueReceiptText(VENUE_SOURCES) });
    const code = run(['--apk', sideloadWith(data), ...BOTH, '--unity-export', codeExport, '--unity-default-export', DEFAULT_EXPORT, ...CEILING]);
    assert.equal(code.exitCode, 0);
    assert.equal(unityItem(code.report.artifacts[0]).files.length, 5);
    assert.deepEqual(code.report.artifacts[0].addons.unityVenue.otherAdded, ['unityLibrary/src/main/jniLibs/arm64-v8a/libvenue.so']);
    assert.match(reportLines(code).join('\n'), /added outside unityLibrary\/src\/main\/assets, not exempt: unityLibrary\/src\/main\/jniLibs\/arm64-v8a\/libvenue\.so/u);
  });

  it('reads the venue receipt from beside the export folder when it is not inside it (the sealed Gradle check rejects extra files in the folder)', () => {
    const beside = unityExport('unity-venue-beside', { exported: VENUE_EXPORT_FILES });
    const receiptPath = `${beside}.vande-venue-addon.properties`;
    writeFileSync(receiptPath, venueReceiptText(VENUE_SOURCES));
    const apk = sideloadWith(data);
    const result = run(['--apk', apk, ...BOTH, '--unity-export', beside, '--unity-venue-receipt', receiptPath, '--unity-default-export', DEFAULT_EXPORT, ...CEILING]);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.report.artifacts[0].addons.problems, []);
    assert.equal(unityItem(result.report.artifacts[0]).files.length, 5);
    assert.equal(unityItem(result.report.artifacts[0]).verified, true);
    const without = run(['--apk', apk, ...BOTH, '--unity-export', beside, '--unity-default-export', DEFAULT_EXPORT, ...CEILING]);
    assert.equal(unityItem(without.report.artifacts[0]).files.length, 0, 'without the option the folder holds no receipt: nothing to exempt');
    assert.throws(() => run(['--apk', apk, '--addon', 'venue', '--unity-export', beside, '--unity-venue-receipt', join(workDir, 'no-such.properties'), ...CEILING]), /does not exist/u);
    assert.throws(() => parseArgs(['--addon', 'venue', '--unity-venue-receipt', receiptPath]), /--unity-venue-receipt needs --unity-export/u);
  });

  it('gives a release-named artifact no Unity exemption either, and needs --addon venue and a real folder', () => {
    const release = artifact('vande-cricket-1.0.0-1-b12356b-UNITY-release.apk', entriesFor({ extraPlain: data }));
    const result = run(['--apk', release, ...BOTH, ...UNITY_FLAGS, ...CEILING]);
    const item = result.report.artifacts[0];
    assert.equal(result.exitCode, 1);
    assert.equal(item.addons.exemptStoredBytes, 0);
    assert.equal(item.ceilingBytes, item.bytes);
    // Each of the two guards (the -PREVIEW- name and the venue tag) must hold on its own.
    const taggedRelease = artifact('vande-cricket-1.0.0-1-b12356b-UNITY-EVERYTHING-0123456789abcdef-release.apk', entriesFor({ extraPlain: data }));
    const tagged = run(['--apk', taggedRelease, ...BOTH, ...UNITY_FLAGS, ...CEILING]).report.artifacts[0];
    assert.equal(tagged.addons.exemptStoredBytes, 0);
    assert.equal(unityItem(tagged), undefined);
    const untaggedPreview = artifact('vande-cricket-1.0.0-1-b12356b-PREVIEW-UNITY-0123456789abcdef-release.apk', entriesFor({ extraPlain: data }));
    const untagged = run(['--apk', untaggedPreview, ...BOTH, ...UNITY_FLAGS, ...CEILING]).report.artifacts[0];
    assert.equal(untagged.addons.exemptStoredBytes, 0);
    assert.equal(unityItem(untagged), undefined);
    assert.throws(() => parseArgs(['--unity-export', VENUE_EXPORT]), /--unity-export needs --addon venue/u);
    assert.throws(() => parseArgs(['--addon', 'camera', '--unity-export', VENUE_EXPORT]), /--unity-export needs --addon venue/u);
    assert.throws(() => parseArgs(['--addon', 'venue', '--unity-default-export', DEFAULT_EXPORT]), /--unity-default-export needs --unity-export/u);
    assert.throws(() => run(['--apk', sideloadWith(data), '--addon', 'venue', '--unity-export', join(workDir, 'no-such-export'), ...CEILING]), /has no \.vande-export\.properties/u);
  });
});

describe('build-android.sh and the sideload payload flags (text of the script, like the sealed-build checks in android-evidence.test.mjs)', () => {
  const script = readFileSync(new URL('./build-android.sh', import.meta.url), 'utf8');

  it('refuses every payload flag without --preview, and a model host together with --camera-bundle', () => {
    assert.match(script, /--camera-bundle\) CAMERA_BUNDLE=1 ;;/u);
    assert.match(script, /--venue-bake\) VENUE_BAKE=1 ;;/u);
    assert.match(script, /--everything\) CAMERA_BUNDLE=1; VENUE_BAKE=1 ;;/u);
    assert.match(script, /if \[\[ \$SIDELOAD == 1 && \$PREVIEW == 0 \]\]; then[\s\S]*?exit 2\nfi/u);
    assert.match(script, /CAMERA_BUNDLE == 1 && -n "\$\{VITE_CAMERA_MODEL_BASE_URL:-\}"[\s\S]*?exit 2/u);
  });

  it('names the artifact after the payload flags and declares an add-on only for its own flag', () => {
    assert.match(script, /CAMERA_BUNDLE == 1 && \$VENUE_BAKE == 1 \]\]; then TAG="\$TAG-EVERYTHING"/u);
    assert.match(script, /elif \[\[ \$CAMERA_BUNDLE == 1 \]\]; then TAG="\$TAG-CAMERA"/u);
    assert.match(script, /elif \[\[ \$VENUE_BAKE == 1 \]\]; then TAG="\$TAG-VENUE"/u);
    assert.match(script, /if \[\[ \$CAMERA_BUNDLE == 1 \]\]; then SIZE_ADDON_ARGS\+=\(--addon camera\); COMPAT_ADDON_ARGS\+=\(--allow-camera-payload\); fi/u);
    assert.match(script, /if \[\[ \$VENUE_BAKE == 1 \]\]; then SIZE_ADDON_ARGS\+=\(--addon venue\); COMPAT_ADDON_ARGS\+=\(--allow-venue-payload\); fi/u);
    for (const declaration of ['--addon camera', '--addon venue', '--allow-camera-payload', '--allow-venue-payload']) {
      assert.equal(script.split(declaration).length, 2, `${declaration} appears once in the script, under its own flag`);
    }
  });

  it('builds the web payload with both switches, records them in the sealed Unity invocation and checks dist before Gradle', () => {
    assert.match(script, /VITE_CAMERA_BUNDLED="\$CAMERA_BUNDLE" VITE_VENUE_BAKED="\$VENUE_BAKE"/u);
    assert.match(script, /--web-env "VITE_CAMERA_BUNDLED=\$CAMERA_BUNDLE"/u);
    assert.match(script, /--web-env "VITE_VENUE_BAKED=\$VENUE_BAKE"/u);
    assert.match(script, /CAMERA_BUNDLE == 0 && -d dist\/models \]\] && find dist\/models -type f/u);
    assert.match(script, /VENUE_BAKE == 0 && \$HAS_GLB == 1/u);
  });

  it('hands the Unity export folders and the venue receipt to the size check for the sideload venue build only', () => {
    assert.match(script, /UNITY_EXPORT_DIR="\$ROOT\/unity\/VandePractice\/Builds\/Android"/u);
    assert.match(script, /for candidate in "\$UNITY_EXPORT_DIR\/\.vande-venue-addon\.properties" "\$UNITY_EXPORT_DIR\.vande-venue-addon\.properties"; do/u);
    assert.match(script, /if \[\[ \$UNITY == 1 && \$VENUE_BAKE == 1 \]\]; then\n {2}SIZE_ADDON_ARGS\+=\(--unity-export "\$UNITY_EXPORT_DIR"\)/u);
    assert.match(script, /SIZE_ADDON_ARGS\+=\(--unity-venue-receipt "\$UNITY_VENUE_RECEIPT"\)/u);
    assert.match(script, /SIZE_ADDON_ARGS\+=\(--unity-default-export "\$ROOT\/unity\/VandePractice\/Builds\/Android\.final-default"\)/u);
    for (const flag of ['--unity-export', '--unity-venue-receipt', '--unity-default-export']) {
      assert.equal(script.split(flag).length, 2, `${flag} is passed once, under the sideload venue condition`);
    }
  });

  it('refuses to bind an export that carries the venue add-on in anything but a --preview build with the venue flag', () => {
    // A copy of the script in a scratch tree: the guard runs before the build id, the web build or Gradle, so nothing else is touched.
    const root = join(workDir, 'guard-tree');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    mkdirSync(join(root, 'unity/VandePractice/Builds/Android'), { recursive: true });
    copyFileSync(new URL('./build-android.sh', import.meta.url), join(root, 'scripts/build-android.sh'));
    const inside = join(root, 'unity/VandePractice/Builds/Android/.vande-venue-addon.properties');
    const beside = join(root, 'unity/VandePractice/Builds/Android.vande-venue-addon.properties');
    const attempt = (...flags) => spawnSync('bash', [join(root, 'scripts/build-android.sh'), ...flags], { encoding: 'utf8', env: { ...process.env, APP_LINKS_HOST: 'example.test' } });
    for (const receipt of [inside, beside]) {
      writeFileSync(receipt, venueReceiptText(VENUE_SOURCES));
      for (const flags of [['--unity'], ['--preview', '--unity'], ['--preview', '--unity', '--camera-bundle']]) {
        const refused = attempt(...flags);
        assert.equal(refused.status, 2, `${flags.join(' ')} must be refused (receipt ${receipt === inside ? 'inside' : 'beside'} the folder)`);
        assert.match(refused.stderr, /carries the sideload venue add-on .* not a --preview build with --venue-bake or --everything/u);
      }
      for (const flags of [['--preview', '--unity', '--everything'], ['--preview', '--unity', '--venue-bake']]) {
        const passed = attempt(...flags);
        assert.doesNotMatch(passed.stderr, /carries the sideload venue add-on/u, `${flags.join(' ')} gets past the guard`);
        assert.ok(existsSync(receipt), `${flags.join(' ')}: the script fails further on in this scratch tree and the receipt is back where it was`);
      }
      rmSync(receipt);
    }
    assert.doesNotMatch(attempt('--unity').stderr, /carries the sideload venue add-on/u, 'a default export is not refused');
  });

  it('moves the venue receipt beside the export for the Gradle run and puts it back on every way out (R-56)', async () => {
    assert.match(script, /# --- venue receipt move: begin/u);
    assert.match(script, /# --- venue receipt move: end/u);
    assert.match(script, /cleanup_candidates\(\) \{\n {2}venue_receipt_restore \|\| true\n/u, 'the EXIT cleanup puts the receipt back first');
    for (const [signal, code] of [['INT', 130], ['TERM', 143], ['HUP', 129]]) {
      assert.match(script, new RegExp(`trap 'exit ${code}' ${signal}\n`, 'u'), `${signal} ends the script through exit, so the EXIT trap runs`);
    }
    assert.match(script, /trap cleanup_candidates EXIT[\s\S]*?if \[\[ \$UNITY == 1 \]\]; then\n {2}venue_receipt_aside\n/u, 'the move comes after the trap is armed');

    // The real script in a scratch tree: build-id and node are stubs, so it reaches `VERSION=$(node -p ...)` right after the move.
    const scratch = (name, nodeBody) => {
      const root = join(workDir, name);
      mkdirSync(join(root, 'scripts'), { recursive: true });
      mkdirSync(join(root, 'android'), { recursive: true });
      mkdirSync(join(root, 'bin'), { recursive: true });
      mkdirSync(join(root, 'unity/VandePractice/Builds/Android'), { recursive: true });
      copyFileSync(new URL('./build-android.sh', import.meta.url), join(root, 'scripts/build-android.sh'));
      writeFileSync(join(root, 'scripts/build-id.sh'), '#!/bin/sh\necho abcdef1\n', { mode: 0o755 });
      writeFileSync(join(root, 'bin/node'), `#!/bin/sh\n${nodeBody}\n`, { mode: 0o755 });
      const real = realpathSync(root);
      return {
        root: real,
        inside: join(real, 'unity/VandePractice/Builds/Android/.vande-venue-addon.properties'),
        beside: join(real, 'unity/VandePractice/Builds/Android.vande-venue-addon.properties'),
        env: { ...process.env, PATH: `${join(real, 'bin')}:${process.env.PATH}` },
      };
    };
    const FLAGS = ['--preview', '--unity', '--everything'];

    // 1. a build that fails right after the move (node exits 1): the receipt is back inside
    const failing = scratch('move-failing', 'exit 1');
    writeFileSync(failing.inside, venueReceiptText(VENUE_SOURCES));
    const failed = spawnSync('bash', [join(failing.root, 'scripts/build-android.sh'), ...FLAGS], { encoding: 'utf8', env: failing.env });
    assert.notEqual(failed.status, 0);
    assert.match(failed.stdout, /venue receipt moved beside the Unity export for the Gradle run/u);
    assert.match(failed.stdout, /venue receipt put back inside the Unity export/u);
    assert.ok(existsSync(failing.inside) && !existsSync(failing.beside), 'failed build: receipt back inside, nothing left beside');
    assert.equal(readFileSync(failing.inside, 'utf8'), venueReceiptText(VENUE_SOURCES), 'the receipt is unchanged');

    // 2. a build that is interrupted while it runs (node sleeps; the whole process group gets the signal, as Ctrl-C does)
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const tree = scratch(`move-${signal}`, 'exec sleep 30');
      writeFileSync(tree.inside, venueReceiptText(VENUE_SOURCES));
      const child = spawn('bash', [join(tree.root, 'scripts/build-android.sh'), ...FLAGS], { env: tree.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (chunk) => { out += chunk; });
      const exited = new Promise((resolve) => child.on('exit', (code, sig) => resolve({ code, sig })));
      const deadline = Date.now() + 15_000;
      while (!existsSync(tree.beside) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
      assert.ok(existsSync(tree.beside) && !existsSync(tree.inside), `${signal}: while the build runs the receipt sits beside the export`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      process.kill(-child.pid, signal);
      const result = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 15_000))]);
      if (result.timeout) process.kill(-child.pid, 'SIGKILL');
      assert.ok(!result.timeout, `${signal}: the script ends`);
      assert.ok(existsSync(tree.inside) && !existsSync(tree.beside), `${signal}: interrupted build: receipt back inside, nothing left beside`);
      assert.match(out, /venue receipt put back inside the Unity export/u);
    }

    // 3. a default export (no receipt) and a non-Unity build never move anything
    const plain = scratch('move-plain', 'exit 1');
    const none = spawnSync('bash', [join(plain.root, 'scripts/build-android.sh'), ...FLAGS], { encoding: 'utf8', env: plain.env });
    assert.doesNotMatch(none.stdout, /venue receipt moved/u);
    assert.ok(!existsSync(plain.inside) && !existsSync(plain.beside));
    const nonUnity = scratch('move-nonunity', 'exit 1');
    writeFileSync(nonUnity.inside, venueReceiptText(VENUE_SOURCES));
    spawnSync('bash', [join(nonUnity.root, 'scripts/build-android.sh'), '--preview', '--venue-bake'], { encoding: 'utf8', env: nonUnity.env });
    assert.ok(existsSync(nonUnity.inside) && !existsSync(nonUnity.beside), 'without --unity the export is not bound, so the receipt is left alone');
  });

  it('the move and restore functions themselves: already beside, both present, and a restore that will not overwrite', () => {
    const begin = script.indexOf('# --- venue receipt move: begin');
    const end = script.indexOf('# --- venue receipt move: end');
    const block = script.slice(begin, end);
    const run = (name, setup, body) => {
      const dir = join(workDir, `fn-${name}`);
      mkdirSync(join(dir, 'Builds/Android'), { recursive: true });
      setup(dir);
      const file = join(dir, 'run.sh');
      writeFileSync(file, `set -uo pipefail\nUNITY_EXPORT_DIR="${dir}/Builds/Android"\n${block}\n${body}\n`);
      return { ...spawnSync('bash', [file], { encoding: 'utf8' }), dir };
    };
    const put = (path, text = 'x\n') => writeFileSync(path, text);
    // a receipt that is already beside: aside does nothing, and restore does not carry it inside (it did not move it)
    const beside = run('beside', (dir) => put(join(dir, 'Builds/Android.vande-venue-addon.properties')), 'venue_receipt_aside; echo "aside rc=$?"; venue_receipt_restore; echo "restore rc=$?"');
    assert.match(beside.stdout, /aside rc=0/u);
    assert.match(beside.stdout, /restore rc=0/u);
    assert.ok(existsSync(join(beside.dir, 'Builds/Android.vande-venue-addon.properties')) && !existsSync(join(beside.dir, 'Builds/Android/.vande-venue-addon.properties')));
    // both present: refuse, move nothing
    const both = run('both', (dir) => { put(join(dir, 'Builds/Android/.vande-venue-addon.properties'), 'inside\n'); put(join(dir, 'Builds/Android.vande-venue-addon.properties'), 'beside\n'); }, 'venue_receipt_aside; echo "aside rc=$?"');
    assert.match(both.stdout, /aside rc=1/u);
    assert.match(both.stderr, /exists both inside .* and beside/u);
    assert.equal(readFileSync(join(both.dir, 'Builds/Android/.vande-venue-addon.properties'), 'utf8'), 'inside\n');
    assert.equal(readFileSync(join(both.dir, 'Builds/Android.vande-venue-addon.properties'), 'utf8'), 'beside\n');
    // a second restore (the EXIT trap after an explicit restore) is a quiet no-op
    const twice = run('twice', (dir) => put(join(dir, 'Builds/Android/.vande-venue-addon.properties'), 'r\n'), 'venue_receipt_aside; venue_receipt_restore; venue_receipt_restore; echo "second rc=$?"');
    assert.match(twice.stdout, /second rc=0/u);
    assert.doesNotMatch(twice.stderr, /not putting/u);
    assert.ok(existsSync(join(twice.dir, 'Builds/Android/.vande-venue-addon.properties')) && !existsSync(join(twice.dir, 'Builds/Android.vande-venue-addon.properties')));
    // restore will not overwrite a file that appeared inside meanwhile
    const clash = run('clash', (dir) => put(join(dir, 'Builds/Android/.vande-venue-addon.properties'), 'original\n'), 'venue_receipt_aside; echo new > "$VENUE_RECEIPT_INSIDE"; venue_receipt_restore; echo "restore rc=$?"');
    assert.match(clash.stdout, /restore rc=1/u);
    assert.match(clash.stderr, /not putting the venue receipt back/u);
    assert.equal(readFileSync(join(clash.dir, 'Builds/Android/.vande-venue-addon.properties'), 'utf8'), 'new\n');
    assert.equal(readFileSync(join(clash.dir, 'Builds/Android.vande-venue-addon.properties'), 'utf8'), 'original\n', 'the moved receipt is kept, not lost');
  });

  it('keeps the 45 MB warning, the 50 MB ceiling and the compatibility preflight on every build', () => {
    assert.match(script, /check-android-size\.mjs" --warning-mb 45 --limit-mb 50/u);
    assert.match(script, /check-android-release-compat\.mjs"/u);
    assert.doesNotMatch(script, /--limit-mb (?!50\b)\d/u);
  });
});
