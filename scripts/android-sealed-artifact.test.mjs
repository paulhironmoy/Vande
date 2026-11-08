#!/usr/bin/env node

import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import {
  assertArtifactIdentityStable,
  copyPrivateSealedArtifact,
  evaluateReleaseBadging,
  extractRepositoryBuildIds,
  snapshotArtifactIdentity,
  unityProofFromEntries,
  validateSealedArtifactInputs,
  verifySealedArtifact,
} from './android-sealed-artifact.mjs';
import { createHash } from 'node:crypto';

test('sealed input validation rejects relative/debug paths and malformed identities', () => {
  assert.equal(validateSealedArtifactInputs({
    apkPath: 'app-debug.apk',
    expectedSha256: 'A'.repeat(64),
    expectedBuildId: 'not-a-build',
  }).length, 4);
  assert.deepEqual(validateSealedArtifactInputs({
    apkPath: '/tmp/vande-PREVIEW-UNITY-release.apk',
    expectedSha256: '1'.repeat(64),
    expectedBuildId: '38924bd+0123456789ab',
  }), []);
});

test('Unity proof requires GUID and all three libraries in one ABI', () => {
  assert.equal(unityProofFromEntries([
    'assets/bin/Data/unity_app_guid',
    'lib/arm64-v8a/libunity.so',
    'lib/arm64-v8a/libmain.so',
    'lib/arm64-v8a/libil2cpp.so',
  ]).complete, true);
  assert.equal(unityProofFromEntries([
    'assets/bin/Data/unity_app_guid',
    'lib/arm64-v8a/libunity.so',
    'lib/x86_64/libmain.so',
    'lib/arm64-v8a/libil2cpp.so',
  ]).complete, false);
});

test('release badging refuses debuggable or wrong-package artifacts', () => {
  const good = "package: name='in.vande.cricket' versionCode='1'\nlaunchable-activity: name='in.vande.cricket.MainActivity'\n";
  assert.equal(evaluateReleaseBadging(good).pass, true);
  assert.equal(evaluateReleaseBadging(`${good}application-debuggable\n`).pass, false);
  assert.equal(evaluateReleaseBadging(good.replace('in.vande.cricket', 'example.bad')).pass, false);
});

test('embedded identity manifest rejects conflicting repository-shaped build IDs', () => {
  const expected = '38924bd+0123456789ab';
  const conflicting = 'aaaaaaaa+bbbbbbbbbbbb';
  assert.deepEqual(extractRepositoryBuildIds(`const buildId="${expected}";`), [expected]);
  assert.deepEqual(extractRepositoryBuildIds(`const buildId="${expected}"; const stale="${conflicting}";`), [expected, conflicting].sort());
  assert.deepEqual(extractRepositoryBuildIds('const random="12345678";'), []);
});

test('artifact identity detects mutate-restore even when bytes and mtime are restored', () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'vande-artifact-identity-')));
  const apk = join(scratch, 'vande-PREVIEW-UNITY-release.apk');
  writeFileSync(apk, 'original');
  const expected = snapshotArtifactIdentity(apk);
  const before = statSync(apk);
  writeFileSync(apk, 'mutated');
  writeFileSync(apk, 'original');
  utimesSync(apk, before.atime, before.mtime);
  assert.equal(createHash('sha256').update(readFileSync(apk)).digest('hex'), expected.sha256);
  assert.throws(() => assertArtifactIdentityStable(apk, expected), /identity\/hash\/directory changed/u);
});

test('private read-only copy is hash-bound and isolated from later source mutation', () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'vande-private-artifact-')));
  const source = join(scratch, 'vande-PREVIEW-UNITY-release.apk');
  const privateApk = join(scratch, 'private', 'admitted.apk');
  const bytes = Buffer.from('sealed-source');
  writeFileSync(source, bytes);
  const expectedSha256 = createHash('sha256').update(bytes).digest('hex');
  const copied = copyPrivateSealedArtifact({ sourceApkPath: source, privateApkPath: privateApk, expectedSha256 });
  writeFileSync(source, 'later-source-change');
  assert.equal(snapshotArtifactIdentity(privateApk).sha256, expectedSha256);
  assert.equal(copied.artifact.sha256, expectedSha256);
  assert.equal(statSync(privateApk).mode & 0o777, 0o400);
});

test('full verifier rejects mutation and mutate-restore performed by an external verifier', () => {
  const buildId = execFileSync('scripts/build-id.sh', [], { encoding: 'utf8' }).trim();
  for (const restore of [false, true]) {
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), `vande-verifier-toctou-${restore ? 'restore' : 'mutate'}-`)));
    const bin = join(scratch, 'bin');
    const apk = join(scratch, 'vande-PREVIEW-UNITY-release.apk');
    const output = join(scratch, 'never.json');
    const original = 'ORIGINAL-SEALED-APK';
    writeFileSync(apk, original);
    const expectedSha256 = createHash('sha256').update(original).digest('hex');
    mkdirSync(bin, { mode: 0o700 });
    const unzip = join(bin, 'unzip');
    writeFileSync(unzip, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.VANDE_MUTATE_TARGET, 'MUTATED');
${restore ? `writeFileSync(process.env.VANDE_MUTATE_TARGET, ${JSON.stringify(original)});` : ''}
process.stdout.write('assets/bin/Data/unity_app_guid\\nlib/arm64-v8a/libunity.so\\nlib/arm64-v8a/libmain.so\\nlib/arm64-v8a/libil2cpp.so\\n');
`, { mode: 0o700 });
    chmodSync(unzip, 0o700);
    const oldPath = process.env.PATH;
    const oldTarget = process.env.VANDE_MUTATE_TARGET;
    try {
      process.env.PATH = `${bin}:${oldPath}`;
      process.env.VANDE_MUTATE_TARGET = apk;
      assert.throws(() => verifySealedArtifact({
        apkPath: apk, expectedSha256, expectedBuildId: buildId, outputFile: output,
      }), /identity\/hash\/directory changed/u);
    } finally {
      process.env.PATH = oldPath;
      if (oldTarget === undefined) delete process.env.VANDE_MUTATE_TARGET;
      else process.env.VANDE_MUTATE_TARGET = oldTarget;
    }
  }
});

test('full verifier rejects a conflicting repository identity in a packaged JavaScript chunk', () => {
  const buildId = execFileSync('scripts/build-id.sh', [], { encoding: 'utf8' }).trim();
  // The chunk marks the id the way src/main.tsx does: a clean checkout's id has no "+", so only that marker identifies it.
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'vande-verifier-conflict-')));
  const bin = join(scratch, 'bin');
  const apk = join(scratch, 'vande-PREVIEW-UNITY-release.apk');
  const output = join(scratch, 'never.json');
  const original = 'ORIGINAL-SEALED-APK';
  writeFileSync(apk, original);
  mkdirSync(bin, { mode: 0o700 });
  const unzip = join(bin, 'unzip');
  writeFileSync(unzip, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '-Z1') process.stdout.write('assets/bin/Data/unity_app_guid\\nlib/arm64-v8a/libunity.so\\nlib/arm64-v8a/libmain.so\\nlib/arm64-v8a/libil2cpp.so\\nassets/public/index.html\\nassets/public/main.js\\n');
else if (args.at(-1) === 'assets/public/index.html') process.stdout.write('<script src="main.js"></script>');
else if (args.at(-1) === 'assets/public/main.js') process.stdout.write('document.documentElement.setAttribute("data-vande-build-id","${buildId}"); const stale="aaaaaaaa+bbbbbbbbbbbb";');
else process.exitCode = 2;
`, { mode: 0o700 });
  chmodSync(unzip, 0o700);
  const oldPath = process.env.PATH;
  try {
    process.env.PATH = `${bin}:${oldPath}`;
    assert.throws(() => verifySealedArtifact({
      apkPath: apk,
      expectedSha256: createHash('sha256').update(original).digest('hex'),
      expectedBuildId: buildId,
      outputFile: output,
    }), /conflicting repository build IDs/u);
  } finally {
    process.env.PATH = oldPath;
  }
});
