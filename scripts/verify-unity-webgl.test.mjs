import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  assertEquivalentWebGlTrees,
  unitySourceDigest,
  verifyUnityWebGlRoot,
} from './verify-unity-webgl.mjs';

const BUILD_ID = 'abcdef0+123456789abc';
const scratch = [];

function write(root, relative, contents) {
  const destination = path.join(root, relative);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, contents);
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'vande-webgl-verifier-'));
  scratch.push(root);
  const project = path.join(root, 'unity', 'VandePractice');
  write(project, 'Assets/VandePractice/runtime.asset', 'runtime\n');
  write(project, 'Packages/manifest.json', '{"dependencies":{}}\n');
  write(project, 'ProjectSettings/ProjectVersion.txt', 'm_EditorVersion: 6000.3.27f1\n');
  const sourceDigest = unitySourceDigest(project);
  const output = path.join(root, 'export');
  const artifacts = {
    loader: 'Build/VandePractice.loader.js',
    data: 'Build/VandePractice.data',
    framework: 'Build/VandePractice.framework.js',
    code: 'Build/VandePractice.wasm',
  };
  for (const [name, relative] of Object.entries(artifacts)) write(output, relative, `${name}\n`);
  const manifest = {
    schema: 2,
    buildId: BUILD_ID,
    unitySourceSha256: sourceDigest,
    unityVersion: '6000.3.27f1',
    productVersion: '1.0',
    loader: { url: artifacts.loader, sha256: sha256(path.join(output, artifacts.loader)) },
    data: { url: artifacts.data, sha256: sha256(path.join(output, artifacts.data)) },
    framework: { url: artifacts.framework, sha256: sha256(path.join(output, artifacts.framework)) },
    code: { url: artifacts.code, sha256: sha256(path.join(output, artifacts.code)) },
    streamingAssetsUrl: 'StreamingAssets',
  };
  write(output, 'vande-webgl-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  return { project, output, sourceDigest };
}

afterEach(() => {
  for (const root of scratch.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Unity WebGL packaging verifier', () => {
  it('accepts a complete schema-2 export bound to the frozen source and build', () => {
    const value = fixture();
    const verified = verifyUnityWebGlRoot(value.output, {
      expectedBuildId: BUILD_ID,
      expectedSourceSha256: value.sourceDigest,
    });
    assert.equal(verified.manifest.buildId, BUILD_ID);
    assert.equal(verified.files.has('Build/VandePractice.wasm'), true);
  });

  it('rejects an altered runtime artifact', () => {
    const value = fixture();
    write(value.output, 'Build/VandePractice.wasm', 'altered\n');
    assert.throws(() => verifyUnityWebGlRoot(value.output, {
      expectedBuildId: BUILD_ID,
      expectedSourceSha256: value.sourceDigest,
    }), /digest does not match/u);
  });

  it('rejects Unity standalone wrapper files from the embedded export', () => {
    const index = fixture();
    write(index.output, 'index.html', '<!doctype html>\n');
    assert.throws(() => verifyUnityWebGlRoot(index.output), /standalone wrapper files/u);

    const template = fixture();
    write(template.output, 'TemplateData/style.css', 'body{}\n');
    assert.throws(() => verifyUnityWebGlRoot(template.output), /standalone wrapper files/u);
  });

  it('rejects stale source identity and a wrong build identity', () => {
    const value = fixture();
    assert.throws(() => verifyUnityWebGlRoot(value.output, {
      expectedBuildId: '1234567+abcdefabcdef',
      expectedSourceSha256: value.sourceDigest,
    }), /build ID mismatch/u);
    assert.throws(() => verifyUnityWebGlRoot(value.output, {
      expectedBuildId: BUILD_ID,
      expectedSourceSha256: 'f'.repeat(64),
    }), /source digest/u);
  });

  it('rejects traversal URLs, undeclared runtime files and symbolic links', () => {
    const unsafeUrls = [
      '../loader.js',
      '%2e%2e/loader.js',
      '%252e%252e/loader.js',
      'Build/%2e/loader.js',
      'Build%2floader.js',
      'Build%5cloader.js',
      'Build/VandePractice.loader.js?raw=1',
      'Build/VandePractice.loader.js#loader',
      'https:loader.js',
      'Other/loader.js',
    ];
    for (const unsafeUrl of unsafeUrls) {
      const traversal = fixture();
      const manifestPath = path.join(traversal.output, 'vande-webgl-manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifest.loader.url = unsafeUrl;
      writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
      assert.throws(() => verifyUnityWebGlRoot(traversal.output), /loader artifact is invalid/u);
    }

    for (const unsafeUrl of ['%2e%2e/StreamingAssets', 'Build/StreamingAssets']) {
      const traversal = fixture();
      const manifestPath = path.join(traversal.output, 'vande-webgl-manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifest.streamingAssetsUrl = unsafeUrl;
      writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
      assert.throws(() => verifyUnityWebGlRoot(traversal.output), /StreamingAssets URL is unsafe/u);
    }

    const extra = fixture();
    write(extra.output, 'Build/unexpected.bin', 'unexpected\n');
    assert.throws(() => verifyUnityWebGlRoot(extra.output), /undeclared runtime files/u);

    const linked = fixture();
    symlinkSync(path.join(linked.output, 'vande-webgl-manifest.json'), path.join(linked.output, 'linked-manifest.json'));
    assert.throws(() => verifyUnityWebGlRoot(linked.output), /symbolic link/u);
  });

  it('requires publication mirrors to be byte-equivalent', () => {
    const left = fixture();
    const right = fixture();
    assert.doesNotThrow(() => assertEquivalentWebGlTrees(left.output, right.output));
    write(right.output, 'Build/VandePractice.data', 'changed\n');
    assert.throws(() => assertEquivalentWebGlTrees(left.output, right.output), /differ/u);
  });
});
