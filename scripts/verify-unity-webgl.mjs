#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const defaultUnityProject = path.join(repoRoot, 'unity', 'VandePractice');
const BUILD_ID = /^[0-9a-f]{7,40}(?:\+[0-9a-f]{12})?$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ARTIFACT_NAMES = ['loader', 'data', 'framework', 'code'];
const TOP_LEVEL_KEYS = [
  'schema',
  'buildId',
  'unitySourceSha256',
  'unityVersion',
  'productVersion',
  ...ARTIFACT_NAMES,
  'streamingAssetsUrl',
].sort();

function digestBytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function digestFile(file) {
  return digestBytes(readFileSync(file));
}

function safeRelativePath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 &&
    !value.startsWith('/') && !value.includes('\\') && !value.includes('\0') &&
    value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function safeManifestUrl(value, expectedSubtree) {
  // eslint-disable-next-line no-control-regex -- the control characters are exactly what this check rejects or strips
  return safeRelativePath(value) && !/[\u0000-\u0020\u007f%?#:]/u.test(value) &&
    (expectedSubtree === undefined ||
      (value.startsWith(`${expectedSubtree}/`) && value.length > expectedSubtree.length + 1));
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function regularFiles(root, label = root) {
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`${label} must be a real directory: ${root}`);
  }
  const result = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`${label} contains a symbolic link: ${absolute}`);
      if (stat.isDirectory()) pending.push(absolute);
      else if (stat.isFile()) result.push(absolute);
      else throw new Error(`${label} contains a non-regular entry: ${absolute}`);
    }
  }
  return result;
}

function relativeUnix(root, absolute) {
  const relative = path.relative(root, absolute).split(path.sep).join('/');
  if (!safeRelativePath(relative)) throw new Error(`Unsafe relative path under ${root}: ${relative}`);
  return relative;
}

function treeManifest(root, files = regularFiles(root)) {
  return new Map(files.map((absolute) => [relativeUnix(root, absolute), digestFile(absolute)]));
}

export function unitySourceDigest(projectRoot = defaultUnityProject) {
  const roots = ['Assets/VandePractice', 'Packages', 'ProjectSettings'];
  const entries = roots.flatMap((relative) => {
    const root = path.join(projectRoot, relative);
    return regularFiles(root, `Unity source root ${relative}`).map((absolute) => ({
      relative: relativeUnix(projectRoot, absolute),
      digest: digestFile(absolute),
    }));
  }).sort((left, right) => left.relative < right.relative ? -1 : left.relative > right.relative ? 1 : 0);
  const canonical = entries.map((entry, index) => {
    const encoded = Buffer.from(entry.relative, 'utf8').toString('base64url');
    return `${String(index).padStart(6, '0')}\t${entry.digest}\t${encoded}\n`;
  }).join('');
  return digestBytes(Buffer.from(canonical, 'utf8'));
}

export function readWebGlManifest(root) {
  const file = path.join(root, 'vande-webgl-manifest.json');
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (!exactKeys(value, TOP_LEVEL_KEYS) || value.schema !== 2) {
    throw new Error(`WebGL manifest has an unsupported or non-exact schema: ${file}`);
  }
  if (!BUILD_ID.test(value.buildId)) throw new Error(`WebGL manifest buildId is invalid: ${value.buildId}`);
  if (!SHA256.test(value.unitySourceSha256)) throw new Error('WebGL manifest Unity source digest is invalid');
  if (typeof value.unityVersion !== 'string' || value.unityVersion.length === 0 || value.unityVersion.length > 64) {
    throw new Error('WebGL manifest Unity version is invalid');
  }
  if (typeof value.productVersion !== 'string' || value.productVersion.length === 0 || value.productVersion.length > 64) {
    throw new Error('WebGL manifest product version is invalid');
  }
  if (value.streamingAssetsUrl !== 'StreamingAssets') {
    throw new Error('WebGL manifest StreamingAssets URL is unsafe');
  }
  for (const name of ARTIFACT_NAMES) {
    const artifact = value[name];
    if (!exactKeys(artifact, ['sha256', 'url']) ||
        !safeManifestUrl(artifact.url, 'Build') || !SHA256.test(artifact.sha256)) {
      throw new Error(`WebGL manifest ${name} artifact is invalid`);
    }
  }
  return value;
}

export function verifyUnityWebGlRoot(root, { expectedBuildId, expectedSourceSha256 } = {}) {
  const allFiles = regularFiles(root, 'Unity WebGL export');
  const files = treeManifest(root, allFiles);
  const standaloneFiles = [...files.keys()].filter((relative) =>
    relative === 'index.html' || relative.startsWith('TemplateData/'));
  if (standaloneFiles.length > 0) {
    throw new Error(`Embedded WebGL export contains standalone wrapper files: ${standaloneFiles.join(', ')}`);
  }
  const manifest = readWebGlManifest(root);
  if (expectedBuildId !== undefined && manifest.buildId !== expectedBuildId) {
    throw new Error(`WebGL build ID mismatch: expected ${expectedBuildId}, found ${manifest.buildId}`);
  }
  if (expectedSourceSha256 !== undefined && manifest.unitySourceSha256 !== expectedSourceSha256) {
    throw new Error('WebGL Unity-source digest does not match the frozen source tree');
  }

  const declaredPaths = new Set();
  for (const name of ARTIFACT_NAMES) {
    const { url, sha256 } = manifest[name];
    declaredPaths.add(url);
    const observed = files.get(url);
    if (!observed) throw new Error(`WebGL ${name} artifact is missing: ${url}`);
    if (observed !== sha256) throw new Error(`WebGL ${name} artifact digest does not match: ${url}`);
  }
  const buildFiles = [...files.keys()].filter((relative) => relative.startsWith('Build/'));
  const unexpectedBuildFiles = buildFiles.filter((relative) => !declaredPaths.has(relative));
  if (unexpectedBuildFiles.length > 0) {
    throw new Error(`WebGL Build contains undeclared runtime files: ${unexpectedBuildFiles.join(', ')}`);
  }
  const streamingPrefix = `${manifest.streamingAssetsUrl}/`;
  const streamingFiles = [...files.keys()].filter((relative) => relative.startsWith(streamingPrefix));
  if (streamingFiles.length > 0) {
    throw new Error(`WebGL StreamingAssets are not covered by schema 2: ${streamingFiles.join(', ')}`);
  }
  return { manifest, files };
}

export function assertEquivalentWebGlTrees(reference, candidate) {
  const left = reference instanceof Map ? reference : treeManifest(reference);
  const right = candidate instanceof Map ? candidate : treeManifest(candidate);
  if (left.size !== right.size) throw new Error(`WebGL tree file-count mismatch: ${left.size} != ${right.size}`);
  for (const [relative, digest] of left) {
    if (right.get(relative) !== digest) throw new Error(`WebGL trees differ at ${relative}`);
  }
}

function currentBuildId() {
  return execFileSync(path.join(repoRoot, 'scripts/build-id.sh'), [], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
}

function parseArgs(argv) {
  const options = { roots: [], expectedBuildId: null, project: defaultUnityProject };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} needs a value`);
      return path.resolve(argv[index]);
    };
    if (arg === '--root' || arg === '--mirror') options.roots.push(take());
    else if (arg === '--project') options.project = take();
    else if (arg === '--expected-build-id') {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} needs a value`);
      options.expectedBuildId = argv[index];
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.roots.length === 0) {
    options.roots = [
      path.join(defaultUnityProject, 'Builds', 'WebGL'),
      path.join(repoRoot, 'public', 'unity'),
      path.join(repoRoot, 'dist-unity-preview', 'unity'),
    ];
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const buildIdBefore = currentBuildId();
  const expectedBuildId = options.expectedBuildId ?? buildIdBefore;
  if (!BUILD_ID.test(expectedBuildId)) throw new Error(`Expected build ID is invalid: ${expectedBuildId}`);
  const sourceBefore = unitySourceDigest(options.project);
  const verified = options.roots.map((root) => ({
    root,
    ...verifyUnityWebGlRoot(root, {
      expectedBuildId,
      expectedSourceSha256: sourceBefore,
    }),
  }));
  for (const candidate of verified.slice(1)) {
    assertEquivalentWebGlTrees(verified[0].files, candidate.files);
  }
  const sourceAfter = unitySourceDigest(options.project);
  const buildIdAfter = currentBuildId();
  if (sourceAfter !== sourceBefore || buildIdAfter !== buildIdBefore) {
    throw new Error('Source tree changed during WebGL verification');
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    buildId: expectedBuildId,
    unitySourceSha256: sourceBefore,
    roots: verified.map(({ root, files }) => ({ root, files: files.size })),
  }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Unity WebGL verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
