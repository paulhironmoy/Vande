import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { canonicalJson, readJson, REPO_ROOT, sha256Bytes, sha256File } from './lib.mjs';

const RECEIPT_NAME = 'vande-webgl-export-receipt.json';
const SIGNATURE_NAME = 'vande-webgl-export-receipt.sig.json';
const TRUST_FILE = join(REPO_ROOT, 'docs', 'evaluation', 'capture-compare', 'unity-export-trust.v1.json');
const TRUST_FILE_SHA256 = 'ff6d17b9ba4eefd63cb3773f5116e1849ff717f0c64b445c5668bbc3f94886dc';
const EXPORTER_FILE = join(REPO_ROOT, 'unity', 'VandePractice', 'Assets', 'VandePractice', 'Editor', 'VandeWebGLExporter.cs');
const SHA256 = /^[0-9a-f]{64}$/;

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function safeRelative(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && !value.startsWith('/') &&
    !value.includes('\\') && !value.includes('\0') && value.split('/').every((part) => part && part !== '.' && part !== '..');
}

function exportFiles(root) {
  const absoluteRoot = resolve(root);
  const rootInfo = lstatSync(absoluteRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Unity export root must be a real directory');
  const result = [];
  const pending = [absoluteRoot];
  while (pending.length) {
    const directory = pending.pop();
    for (const name of readdirSync(directory).sort()) {
      const absolute = join(directory, name);
      const info = lstatSync(absolute);
      if (info.isSymbolicLink()) throw new Error(`Unity export contains a symbolic link: ${absolute}`);
      if (info.isDirectory()) pending.push(absolute);
      else if (info.isFile()) {
        const path = relative(absoluteRoot, absolute).split(sep).join('/');
        if (!safeRelative(path)) throw new Error(`Unity export path is unsafe: ${path}`);
        if (![RECEIPT_NAME, SIGNATURE_NAME].includes(path)) result.push({ path, bytes: info.size, sha256: sha256File(absolute) });
      } else throw new Error(`Unity export contains a non-regular entry: ${absolute}`);
    }
  }
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

function resolveExportFile(root, path) {
  if (!safeRelative(path)) throw new Error(`Unsafe Unity payload path: ${path}`);
  const target = resolve(root, path);
  const rel = relative(resolve(root), target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Unity payload path escapes the export: ${path}`);
  const info = lstatSync(target);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Unity payload is not a regular file: ${path}`);
  return target;
}

function parseUnityDataHeader(bytes) {
  const magic = Buffer.from('UnityWebData1.0\0', 'ascii');
  if (bytes.length < 32 || !bytes.subarray(0, magic.length).equals(magic)) throw new Error('Unity data payload has invalid UnityWebData1.0 magic');
  const headerBytes = bytes.readUInt32LE(16);
  if (headerBytes < 32 || headerBytes > bytes.length) throw new Error('Unity data payload has an invalid header length');
  let cursor = 20;
  const paths = new Set();
  let entries = 0;
  while (cursor < headerBytes) {
    if (cursor + 12 > headerBytes) throw new Error('Unity data payload has a truncated entry header');
    const offset = bytes.readUInt32LE(cursor);
    const length = bytes.readUInt32LE(cursor + 4);
    const pathLength = bytes.readUInt32LE(cursor + 8);
    cursor += 12;
    if (pathLength < 1 || pathLength > 4096 || cursor + pathLength > headerBytes) throw new Error('Unity data payload has an invalid entry path length');
    const path = bytes.subarray(cursor, cursor + pathLength).toString('utf8');
    cursor += pathLength;
    if (!safeRelative(path) || paths.has(path)) throw new Error('Unity data payload has an unsafe or duplicate entry path');
    if (offset < headerBytes || length < 1 || offset + length > bytes.length) throw new Error(`Unity data entry is out of bounds: ${path}`);
    paths.add(path);
    entries += 1;
  }
  if (cursor !== headerBytes || entries === 0) throw new Error('Unity data payload has no valid bounded entries');
  return { headerBytes, entries };
}

export function validateUnityPayloadStructure(root, manifest) {
  for (const key of ['loader', 'data', 'framework', 'code']) {
    if (!manifest?.[key] || !safeRelative(manifest[key].url) || !SHA256.test(manifest[key].sha256 ?? '')) {
      throw new Error(`Unity manifest ${key} entry is invalid`);
    }
  }
  const loaderFile = resolveExportFile(root, manifest.loader.url);
  const dataFile = resolveExportFile(root, manifest.data.url);
  const frameworkFile = resolveExportFile(root, manifest.framework.url);
  const codeFile = resolveExportFile(root, manifest.code.url);
  for (const [key, file] of [['loader', loaderFile], ['data', dataFile], ['framework', frameworkFile], ['code', codeFile]]) {
    if (sha256File(file) !== manifest[key].sha256) throw new Error(`Unity ${key} payload digest mismatch`);
  }
  const loader = readFileSync(loaderFile, 'utf8');
  const framework = readFileSync(frameworkFile, 'utf8');
  if (loader.length < 256 || !/function\s+createUnityInstance\s*\(/.test(loader) || !loader.includes('WebAssembly')) {
    throw new Error('Unity loader does not have the expected Unity loader structure');
  }
  if (framework.length < 256 || !framework.includes('unityFramework') || !framework.includes('Module')) {
    throw new Error('Unity framework does not have the expected Unity/Emscripten structure');
  }
  try {
    // Parsing only; the payload is never executed.
    Function(loader);
    Function(framework);
  } catch (error) {
    throw new Error(`Unity JavaScript payload is not syntactically valid: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const wasm = readFileSync(codeFile);
  if (wasm.length < 8 || !wasm.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])) || !WebAssembly.validate(wasm)) {
    throw new Error('Unity code payload is not a valid WebAssembly v1 module');
  }
  const data = parseUnityDataHeader(readFileSync(dataFile));
  return {
    loader: { path: manifest.loader.url, bytes: statSync(loaderFile).size, sha256: sha256File(loaderFile) },
    data: { path: manifest.data.url, bytes: statSync(dataFile).size, sha256: sha256File(dataFile), ...data },
    framework: { path: manifest.framework.url, bytes: statSync(frameworkFile).size, sha256: sha256File(frameworkFile) },
    code: { path: manifest.code.url, bytes: statSync(codeFile).size, sha256: sha256File(codeFile) },
  };
}

function readPinnedTrustStore(file = TRUST_FILE) {
  if (resolve(file) !== resolve(TRUST_FILE) || sha256File(file) !== TRUST_FILE_SHA256) {
    throw new Error('Unity exporter trust store is not the pinned independently reviewed policy');
  }
  return readJson(file);
}

function validateTrustStore(value) {
  if (!exactKeys(value, ['schemaVersion', 'policyId', 'approvedKeys', 'status', 'note']) || value.schemaVersion !== 1 ||
      value.policyId !== 'vande-unity-webgl-export-ed25519-v1' || !Array.isArray(value.approvedKeys)) {
    throw new Error('Unity exporter trust store has an invalid contract');
  }
  for (const key of value.approvedKeys) {
    if (!exactKeys(key, ['keyId', 'algorithm', 'publicKeyPem', 'authority']) || key.algorithm !== 'Ed25519' ||
        typeof key.authority !== 'string' || key.authority.length < 2) throw new Error('Unity exporter trust key is invalid');
    const publicKey = createPublicKey(key.publicKeyPem);
    if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error(`Unity exporter key ${key.keyId} is not Ed25519`);
    const derivedId = sha256Bytes(publicKey.export({ type: 'spki', format: 'der' }));
    if (key.keyId !== derivedId) throw new Error(`Unity exporter key ID is not derived from its public key: ${key.keyId}`);
  }
  return value;
}

function validateReceipt(receipt, manifest, tree, exporterFile) {
  if (!exactKeys(receipt, ['schemaVersion', 'policyId', 'build', 'exporter', 'config', 'tree']) || receipt.schemaVersion !== 1 ||
      receipt.policyId !== 'vande-unity-webgl-export-ed25519-v1') throw new Error('Unity exporter receipt has an invalid contract');
  if (!exactKeys(receipt.build, ['buildId', 'unitySourceSha256', 'unityVersion', 'productVersion', 'builtAtUtc', 'buildMethod', 'result']) ||
      receipt.build.buildId !== manifest.buildId || receipt.build.unitySourceSha256 !== manifest.unitySourceSha256 ||
      receipt.build.unityVersion !== manifest.unityVersion || receipt.build.productVersion !== manifest.productVersion ||
      receipt.build.buildMethod !== 'BuildPipeline.BuildPlayer(WebGL)' || receipt.build.result !== 'Succeeded' ||
      typeof receipt.build.builtAtUtc !== 'string' || Number.isNaN(Date.parse(receipt.build.builtAtUtc)) || !receipt.build.builtAtUtc.endsWith('Z')) {
    throw new Error('Unity exporter receipt build metadata does not match the verified export');
  }
  const exporterRelative = relative(REPO_ROOT, exporterFile).split(sep).join('/');
  if (!exactKeys(receipt.exporter, ['path', 'sha256']) || receipt.exporter.path !== exporterRelative ||
      receipt.exporter.sha256 !== sha256File(exporterFile)) throw new Error('Unity exporter receipt is not bound to the reviewed exporter source');
  if (!exactKeys(receipt.config, ['loaderUrl', 'dataUrl', 'frameworkUrl', 'codeUrl', 'streamingAssetsUrl']) ||
      receipt.config.loaderUrl !== manifest.loader.url || receipt.config.dataUrl !== manifest.data.url ||
      receipt.config.frameworkUrl !== manifest.framework.url || receipt.config.codeUrl !== manifest.code.url ||
      receipt.config.streamingAssetsUrl !== manifest.streamingAssetsUrl) throw new Error('Unity exporter receipt config does not match the runtime manifest');
  if (canonicalJson(receipt.tree) !== canonicalJson(tree)) throw new Error('Unity exporter receipt does not bind the exhaustive export tree');
}

export function verifyTrustedUnityExport(root, manifest, {
  expectedBuildId,
  expectedSourceSha256,
} = {}) {
  if (expectedBuildId !== undefined && manifest.buildId !== expectedBuildId) throw new Error('Trusted Unity export build ID mismatch');
  if (expectedSourceSha256 !== undefined && manifest.unitySourceSha256 !== expectedSourceSha256) throw new Error('Trusted Unity export source digest mismatch');
  const structure = validateUnityPayloadStructure(root, manifest);
  const receiptFile = join(resolve(root), RECEIPT_NAME);
  const signatureFile = join(resolve(root), SIGNATURE_NAME);
  if (!existsSync(receiptFile) || !existsSync(signatureFile)) {
    throw new Error('Unity export lacks an independently signed exporter receipt; capture is NOT_AVAILABLE');
  }
  const receiptBytes = readFileSync(receiptFile);
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  const signature = readJson(signatureFile);
  const tree = exportFiles(root);
  validateReceipt(receipt, manifest, tree, EXPORTER_FILE);
  if (!exactKeys(signature, ['schemaVersion', 'policyId', 'keyId', 'algorithm', 'receiptSha256', 'signatureBase64']) ||
      signature.schemaVersion !== 1 || signature.policyId !== 'vande-unity-webgl-export-ed25519-v1' ||
      signature.algorithm !== 'Ed25519' || signature.receiptSha256 !== sha256Bytes(receiptBytes) ||
      typeof signature.signatureBase64 !== 'string') throw new Error('Unity exporter receipt signature envelope is invalid');
  const trust = validateTrustStore(readPinnedTrustStore());
  const approved = trust.approvedKeys.find((item) => item.keyId === signature.keyId);
  if (!approved) throw new Error(`Unity exporter receipt signer is not independently approved: ${signature.keyId}`);
  let signatureBytes;
  try {
    signatureBytes = Buffer.from(signature.signatureBase64, 'base64');
  } catch {
    throw new Error('Unity exporter receipt signature is not valid base64');
  }
  if (signatureBytes.length !== 64 || !verifySignature(null, receiptBytes, approved.publicKeyPem, signatureBytes)) {
    throw new Error('Unity exporter receipt signature verification failed');
  }
  return {
    policyId: receipt.policyId,
    keyId: signature.keyId,
    authority: approved.authority,
    receiptSha256: signature.receiptSha256,
    signatureFileSha256: sha256File(signatureFile),
    tree,
    structure,
  };
}

export const UNITY_EXPORT_TRUST_POLICY = Object.freeze({
  receiptName: RECEIPT_NAME,
  signatureName: SIGNATURE_NAME,
  trustFile: relative(REPO_ROOT, TRUST_FILE).split(sep).join('/'),
  trustFileSha256: TRUST_FILE_SHA256,
  exporterFile: relative(REPO_ROOT, EXPORTER_FILE).split(sep).join('/'),
});
