#!/usr/bin/env node
/**
 * Bakes VANDE's original Three.js procedural batter and bowler meshes into a
 * small, deterministic Unity-facing binary. This is an offline build tool:
 * Unity does not need Vite, Three.js, or a glTF importer at runtime.
 *
 * The output deliberately carries geometry/skin facts only. It is not a
 * production-art acceptance claim, and no Unity runtime binding lives here.
 */
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

export const MAGIC = 'VPM1';
export const VERSION = 1;
export const BONE_COUNT = 17;
export const HEADER_BYTES = 16;
export const VERTEX_BYTES = 44;

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), '..');
const OUTPUT_DIR = join(REPO_ROOT, 'unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/Characters');
const MANIFEST_PATH = join(OUTPUT_DIR, 'provenance.json');

const SOURCE_PATHS = [
  'scripts/export-unity-player-meshes.mjs',
  'src/render3d/three/players.ts',
  'src/render3d/core/skeleton.ts',
  'src/render3d/core/math.ts',
  'src/engine/prng.ts',
  'package.json',
  'package-lock.json',
];

const SELECTIONS = Object.freeze({
  batter: Object.freeze({ gear: 'batter', hairStyle: 0, beardMesh: false, headgear: 0, hairUnder: true }),
  bowler: Object.freeze({ gear: 'bowler', hairStyle: 0, beardMesh: false, headgear: 0, hairUnder: false }),
});
const HEAD_CENTRE = Object.freeze([0, 1.705, 0.014]);
const HAIR_PRESS_Y = 1.719;

function posixRelative(path) {
  return relative(REPO_ROOT, path).split(sep).join('/');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertInteger(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer in [${min}, ${max}], got ${value}`);
  }
}

function variantVisible(value, selection) {
  const variant = Math.round(value);
  const group = Math.floor(variant / 10);
  const option = variant - group * 10;
  if (group === 0) return true;
  if (group === 1) return option === selection.hairStyle;
  if (group === 2) return selection.beardMesh;
  if (group === 3) return option === selection.headgear;
  throw new Error(`Unsupported procedural-player variant group ${group}`);
}

function attributeAt(attribute, index, component) {
  return Number(attribute.array[index * attribute.itemSize + component]);
}

/**
 * Drops unselected shader variants and remaps referenced vertices in stable
 * first-use order. Source coordinates and attributes are copied unchanged;
 * only triangle winding is reversed for Unity's front-face convention.
 */
export function compactGeometry(geometry, selection) {
  const required = ['position', 'normal', 'bindPos', 'region', 'skinIndex', 'skinWeight', 'aVar'];
  for (const name of required) {
    if (!geometry.getAttribute(name)) throw new Error(`Three.js player geometry is missing ${name}`);
  }

  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const bindPos = geometry.getAttribute('bindPos');
  const region = geometry.getAttribute('region');
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  const variant = geometry.getAttribute('aVar');
  const sourceIndex = geometry.getIndex();
  if (!sourceIndex) throw new Error('Three.js player geometry must be indexed');
  if (sourceIndex.count % 3 !== 0) throw new Error(`Index count ${sourceIndex.count} is not triangular`);

  const sourceTriangles = [];
  for (let offset = 0; offset < sourceIndex.count; offset += 3) {
    const tri = [sourceIndex.getX(offset), sourceIndex.getX(offset + 1), sourceIndex.getX(offset + 2)];
    const visible = tri.map((index) => variantVisible(attributeAt(variant, index, 0), selection));
    if (visible.some(Boolean) && !visible.every(Boolean)) {
      throw new Error(`Triangle ${offset / 3} crosses selected and hidden procedural variants`);
    }
    if (visible[0]) sourceTriangles.push(tri);
  }

  const remap = new Map();
  const sourceVertices = [];
  const indices = [];
  const mapped = (sourceVertex) => {
    const found = remap.get(sourceVertex);
    if (found !== undefined) return found;
    const next = sourceVertices.length;
    if (next > 0xffff) throw new Error('VPM1 uses uint16 indices; compacted mesh exceeds 65,536 vertices');
    remap.set(sourceVertex, next);
    sourceVertices.push(sourceVertex);
    return next;
  };
  for (const [a, b, c] of sourceTriangles) {
    indices.push(mapped(a), mapped(c), mapped(b));
  }

  const vertices = sourceVertices.map((sourceVertex) => {
    const bones = [];
    for (let influence = 0; influence < skinWeight.itemSize; influence++) {
      const weight = attributeAt(skinWeight, sourceVertex, influence);
      const bone = Math.round(attributeAt(skinIndex, sourceVertex, influence));
      if (weight > 1e-7) bones.push({ bone, weight });
    }
    if (bones.length === 0 || bones.length > 2) {
      throw new Error(`Vertex ${sourceVertex} has ${bones.length} non-zero bone influences; VPM1 supports one or two`);
    }
    for (const { bone } of bones) assertInteger(bone, `Vertex ${sourceVertex} bone`, 0, BONE_COUNT - 1);
    const total = bones.reduce((sum, influence) => sum + influence.weight, 0);
    if (!Number.isFinite(total) || total <= 0) throw new Error(`Vertex ${sourceVertex} has invalid skin weights`);
    const weight0 = Math.round((bones[0].weight / total) * 0xffff);
    const weight1 = 0xffff - weight0;
    const regionId = Math.round(attributeAt(region, sourceVertex, 0));
    assertInteger(regionId, `Vertex ${sourceVertex} region`, 0, 0xff);
    const bindPosition = [0, 1, 2].map((component) => attributeAt(bindPos, sourceVertex, component));
    const variantId = Math.round(attributeAt(variant, sourceVertex, 0));
    let bakedPosition = [0, 1, 2].map((component) => attributeAt(position, sourceVertex, component));
    // Mirror the retained player's shader-side helmet fit in the offline mesh. Bind positions deliberately stay
    // unchanged because they remain the material's anatomical coordinate system.
    if (selection.hairUnder && Math.floor(variantId / 10) === 1 && bindPosition[1] > HAIR_PRESS_Y) {
      const delta = bindPosition.map((value, component) => value - HEAD_CENTRE[component]);
      const length = Math.hypot(...delta);
      if (length > 1e-8) {
        bakedPosition = bindPosition.map((value, component) => value - (delta[component] / length) * 0.003);
      }
    }
    return {
      position: bakedPosition,
      normal: [0, 1, 2].map((component) => attributeAt(normal, sourceVertex, component)),
      bindPos: bindPosition,
      region: regionId,
      bone0: bones[0].bone,
      bone1: bones[1]?.bone ?? 0,
      weight0,
      weight1,
    };
  });

  return { vertices, indices, sourceVertexCount: position.count, sourceIndexCount: sourceIndex.count };
}

export function encodeVpm(mesh) {
  assertInteger(mesh.vertices.length, 'vertexCount', 1, 0x10000);
  assertInteger(mesh.indices.length, 'indexCount', 3, 0xffffffff);
  if (mesh.indices.length % 3 !== 0) throw new Error('VPM1 indexCount must be divisible by three');
  const bytes = Buffer.alloc(HEADER_BYTES + mesh.vertices.length * VERTEX_BYTES + mesh.indices.length * 2);
  bytes.write(MAGIC, 0, 4, 'ascii');
  bytes.writeUInt16LE(VERSION, 4);
  bytes.writeUInt16LE(BONE_COUNT, 6);
  bytes.writeUInt32LE(mesh.vertices.length, 8);
  bytes.writeUInt32LE(mesh.indices.length, 12);
  let offset = HEADER_BYTES;
  for (const vertex of mesh.vertices) {
    for (const vector of [vertex.position, vertex.normal, vertex.bindPos]) {
      for (const value of vector) {
        if (!Number.isFinite(value)) throw new Error('VPM1 vertex contains a non-finite float');
        bytes.writeFloatLE(value, offset);
        offset += 4;
      }
    }
    bytes.writeUInt8(vertex.region, offset++);
    bytes.writeUInt8(vertex.bone0, offset++);
    bytes.writeUInt8(vertex.bone1, offset++);
    bytes.writeUInt8(0, offset++);
    bytes.writeUInt16LE(vertex.weight0, offset);
    offset += 2;
    bytes.writeUInt16LE(vertex.weight1, offset);
    offset += 2;
  }
  for (const index of mesh.indices) {
    assertInteger(index, 'index', 0, mesh.vertices.length - 1);
    bytes.writeUInt16LE(index, offset);
    offset += 2;
  }
  if (offset !== bytes.length) throw new Error(`VPM1 writer stopped at ${offset}, expected ${bytes.length}`);
  return bytes;
}

export function parseVpmHeader(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length < HEADER_BYTES) throw new Error('VPM1 payload is shorter than its header');
  const magic = bytes.toString('ascii', 0, 4);
  const version = bytes.readUInt16LE(4);
  const boneCount = bytes.readUInt16LE(6);
  const vertexCount = bytes.readUInt32LE(8);
  const indexCount = bytes.readUInt32LE(12);
  const expectedBytes = HEADER_BYTES + vertexCount * VERTEX_BYTES + indexCount * 2;
  if (magic !== MAGIC) throw new Error(`Unexpected VPM1 magic ${JSON.stringify(magic)}`);
  if (version !== VERSION) throw new Error(`Unexpected VPM1 version ${version}`);
  if (boneCount !== BONE_COUNT) throw new Error(`Unexpected VPM1 bone count ${boneCount}`);
  if (bytes.length !== expectedBytes) throw new Error(`VPM1 byte length ${bytes.length} does not match ${expectedBytes}`);
  return { magic, version, boneCount, vertexCount, indexCount, expectedBytes };
}

async function writeIfChanged(path, bytes) {
  let previous = null;
  try {
    previous = await readFile(path);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (previous && previous.equals(bytes)) return false;
  await writeFile(path, bytes);
  return true;
}

async function sourceRecords() {
  return Promise.all(
    SOURCE_PATHS.map(async (path) => {
      const bytes = await readFile(join(REPO_ROOT, path));
      return { path, sha256: sha256(bytes) };
    }),
  );
}

export async function exportUnityPlayerMeshes() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const server = await createServer({
    root: REPO_ROOT,
    configFile: join(REPO_ROOT, 'vite.config.ts'),
    appType: 'custom',
    logLevel: 'error',
    cacheDir: join(REPO_ROOT, 'node_modules/.vite-unity-player-export'),
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });

  const outputs = [];
  try {
    const playerModule = await server.ssrLoadModule('/src/render3d/three/players.ts');
    if (typeof playerModule.createRig !== 'function') throw new Error('players.ts does not export createRig');
    for (const role of ['batter', 'bowler']) {
      const selection = SELECTIONS[role];
      const rig = playerModule.createRig(selection.gear, 24);
      if (!Array.isArray(rig.meshes) || rig.meshes.length !== 2) {
        throw new Error(`${role} rig must expose exactly two LOD meshes`);
      }
      for (let lod = 0; lod < 2; lod++) {
        const compacted = compactGeometry(rig.meshes[lod].geometry, selection);
        const bytes = encodeVpm(compacted);
        const path = join(OUTPUT_DIR, `${role}-lod${lod}.bytes`);
        await writeIfChanged(path, bytes);
        outputs.push({
          path: posixRelative(path),
          role,
          lod,
          bytes: bytes.length,
          sha256: sha256(bytes),
          vertexCount: compacted.vertices.length,
          indexCount: compacted.indices.length,
          triangleCount: compacted.indices.length / 3,
          sourceVertexCount: compacted.sourceVertexCount,
          sourceIndexCount: compacted.sourceIndexCount,
          selection,
        });
      }
    }
  } finally {
    await server.close();
  }

  const manifest = {
    schema: 'vande-unity-player-mesh-provenance/v1',
    acceptance: 'UNPROVEN',
    note: 'Owned-code procedural bridge assets; not production-art or player-experience acceptance.',
    binary: {
      magic: MAGIC,
      version: VERSION,
      littleEndian: true,
      boneCount: BONE_COUNT,
      vertexBytes: VERTEX_BYTES,
      indexType: 'uint16',
      triangleWinding: 'reversed-from-three-for-unity',
    },
    sources: await sourceRecords(),
    outputs,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeIfChanged(MANIFEST_PATH, manifestBytes);
  return { manifest, manifestPath: MANIFEST_PATH };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const { manifest, manifestPath } = await exportUnityPlayerMeshes();
  for (const output of manifest.outputs) {
    process.stdout.write(`${output.path} ${output.bytes} bytes ${output.vertexCount} vertices ${output.indexCount} indices\n`);
  }
  process.stdout.write(`${posixRelative(manifestPath)}\n`);
}
