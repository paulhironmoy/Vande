/**
 * A small, strict reader for the venue packs written by `scripts/venue/pack.mjs` (not a general glTF loader: the venue's
 * files have one fixed layout, so this is about 2 kB instead of GLTFLoader's 14 kB gzip plus a mesh decoder).
 *
 * It reads a GLB with KHR_mesh_quantization geometry (int16 positions under a node scale, normalised uint16 UVs, normalised
 * uint8 RGBA colour, uint16 indices) and one embedded WebP image, and refuses anything else: wrong magic, version, length,
 * an unknown required extension, an accessor outside its buffer, an index outside its vertices, or a file larger than the
 * limits below. A refusal throws `VenueFormatError`; the caller keeps the procedural venue. Pure: no DOM, no three.js.
 */

export class VenueFormatError extends Error {
  constructor(message: string) {
    super(`venue pack: ${message}`);
    this.name = 'VenueFormatError';
  }
}

/** Hard limits: a pack bigger than this is not ours. */
export const VENUE_LIMITS = Object.freeze({
  bytes: 2_000_000,
  jsonBytes: 65_536,
  vertices: 20_000,
  indices: 60_000,
  meshes: 4,
});

export interface VenueMeshData {
  name: string;
  /** Metres, wedge-local (x, y, z), length 3 * vertices. */
  positions: Float32Array;
  /** glTF convention (v down), length 2 * vertices. */
  uvs: Float32Array;
  /** Surface colour times baked ambient occlusion, length 3 * vertices. */
  colors: Float32Array;
  /** 1 on crowd-tier surfaces (the shader may move them to another atlas variant), else 0. */
  tier: Uint8Array;
  indices: Uint16Array;
}

export interface VenuePackData {
  meta: {
    version: number;
    wedges: number;
    wedgeRad: number;
    variants: number;
    lods: number[];
    atlas: [number, number];
  };
  meshes: VenueMeshData[];
  /** The atlas bytes and their MIME type, ready for `createImageBitmap(new Blob([bytes], { type }))`. */
  image: { bytes: Uint8Array; mime: string };
}

interface Json {
  asset?: { extras?: { venue?: Partial<VenuePackData['meta']> & { positionUnits?: number } } };
  extensionsRequired?: string[];
  nodes?: Array<{ mesh?: number; name?: string; scale?: number[] }>;
  meshes?: Array<{ name?: string; primitives?: Array<{ attributes?: Record<string, number>; indices?: number }> }>;
  accessors?: Array<{
    bufferView?: number;
    byteOffset?: number;
    componentType?: number;
    normalized?: boolean;
    count?: number;
    type?: string;
  }>;
  bufferViews?: Array<{ buffer?: number; byteOffset?: number; byteLength?: number; byteStride?: number }>;
  images?: Array<{ mimeType?: string; bufferView?: number }>;
  buffers?: Array<{ byteLength?: number }>;
}

const KNOWN_EXTENSIONS = new Set(['KHR_mesh_quantization', 'EXT_texture_webp']);
const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const SIZES: Record<number, number> = { 5121: 1, 5122: 2, 5123: 2 };

function fail(message: string): never {
  throw new VenueFormatError(message);
}

export function parseVenuePack(buffer: ArrayBuffer): VenuePackData {
  if (buffer.byteLength < 28 || buffer.byteLength > VENUE_LIMITS.bytes)
    fail(`size ${buffer.byteLength} B is outside the limits`);
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== 0x46546c67) fail('not a GLB');
  if (dv.getUint32(4, true) !== 2) fail('not glTF 2');
  if (dv.getUint32(8, true) !== buffer.byteLength) fail('length does not match the file');
  const jsonLen = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a || jsonLen > VENUE_LIMITS.jsonBytes || 20 + jsonLen + 8 > buffer.byteLength)
    fail('bad JSON chunk');
  let json: Json;
  try {
    json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLen))) as Json;
  } catch {
    return fail('JSON does not parse');
  }
  const binAt = 20 + jsonLen;
  const binLen = dv.getUint32(binAt, true);
  if (dv.getUint32(binAt + 4, true) !== 0x004e4942 || binAt + 8 + binLen > buffer.byteLength) fail('bad BIN chunk');
  const bin = new Uint8Array(buffer, binAt + 8, binLen);
  for (const ext of json.extensionsRequired ?? [])
    if (!KNOWN_EXTENSIONS.has(ext)) fail(`required extension ${ext} is not supported`);

  const view = (i: number | undefined) => {
    const v = i === undefined ? undefined : json.bufferViews?.[i];
    if (!v || v.buffer !== 0 || v.byteOffset === undefined || v.byteLength === undefined) return fail('bad bufferView');
    if (v.byteOffset < 0 || v.byteLength < 0 || v.byteOffset + v.byteLength > bin.length)
      return fail('bufferView outside the buffer');
    return v as { byteOffset: number; byteLength: number; byteStride?: number };
  };

  /** Reads an accessor into a plain number array per component (strided, bounds-checked). */
  const read = (
    i: number | undefined,
    wantType: string,
    wantComponent: number,
  ): { data: Float64Array; count: number; normalized: boolean } => {
    const a = i === undefined ? undefined : json.accessors?.[i];
    if (!a || a.type !== wantType || a.componentType !== wantComponent || a.count === undefined)
      return fail('bad accessor');
    const v = view(a.bufferView);
    const comps = COMPONENTS[wantType];
    const size = SIZES[wantComponent];
    const stride = v.byteStride ?? comps * size;
    const start = v.byteOffset + (a.byteOffset ?? 0);
    if (
      a.count < 1 ||
      a.count > VENUE_LIMITS.indices ||
      start + stride * (a.count - 1) + comps * size > v.byteOffset + v.byteLength
    )
      return fail('accessor outside its view');
    const out = new Float64Array(a.count * comps);
    const d = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    for (let n = 0; n < a.count; n++) {
      for (let c = 0; c < comps; c++) {
        const at = start + n * stride + c * size;
        out[n * comps + c] =
          wantComponent === 5121
            ? d.getUint8(at)
            : wantComponent === 5122
              ? d.getInt16(at, true)
              : d.getUint16(at, true);
      }
    }
    return { data: out, count: a.count, normalized: a.normalized === true };
  };

  const meshes: VenueMeshData[] = [];
  const nodes = json.nodes ?? [];
  if (!nodes.length || nodes.length > VENUE_LIMITS.meshes) fail('unexpected node count');
  for (const node of nodes) {
    const mesh = node.mesh === undefined ? undefined : json.meshes?.[node.mesh];
    const prim = mesh?.primitives?.[0];
    if (!mesh || !prim?.attributes) return fail('node without a mesh');
    const scale = node.scale ?? [1, 1, 1];
    if (scale.length !== 3 || !scale.every((s) => Number.isFinite(s) && s > 0)) fail('bad node scale');
    const pos = read(prim.attributes.POSITION, 'VEC3', 5122);
    const uv = read(prim.attributes.TEXCOORD_0, 'VEC2', 5123);
    const col = read(prim.attributes.COLOR_0, 'VEC4', 5121);
    const idx = read(prim.indices, 'SCALAR', 5123);
    if (
      pos.count > VENUE_LIMITS.vertices ||
      uv.count !== pos.count ||
      col.count !== pos.count ||
      !uv.normalized ||
      !col.normalized
    )
      fail('attribute counts do not agree');
    if (idx.count % 3 !== 0) fail('indices are not triangles');
    const n = pos.count;
    const positions = new Float32Array(n * 3);
    const uvs = new Float32Array(n * 2);
    const colors = new Float32Array(n * 3);
    const tier = new Uint8Array(n);
    for (let v = 0; v < n; v++) {
      for (let c = 0; c < 3; c++) positions[v * 3 + c] = pos.data[v * 3 + c] * scale[c];
      uvs[v * 2] = uv.data[v * 2] / 65535;
      uvs[v * 2 + 1] = uv.data[v * 2 + 1] / 65535;
      for (let c = 0; c < 3; c++) colors[v * 3 + c] = col.data[v * 4 + c] / 255;
      tier[v] = col.data[v * 4 + 3] > 127 ? 1 : 0;
    }
    const indices = new Uint16Array(idx.count);
    for (let k = 0; k < idx.count; k++) {
      const value = idx.data[k];
      if (value >= n) fail('index outside the vertices');
      indices[k] = value;
    }
    meshes.push({ name: node.name ?? mesh.name ?? 'venue', positions, uvs, colors, tier, indices });
  }

  const image = json.images?.[0];
  if (!image || image.mimeType !== 'image/webp') fail('no WebP atlas');
  const iv = view(image.bufferView);
  const bytes = bin.slice(iv.byteOffset, iv.byteOffset + iv.byteLength);
  // A WebP file starts with RIFF....WEBP.
  if (
    bytes.length < 64 ||
    String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF' ||
    String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP'
  )
    fail('the atlas is not a WebP file');

  const m = json.asset?.extras?.venue ?? {};
  const atlas = (m as { atlas?: unknown }).atlas;
  if (
    typeof m.wedges !== 'number' ||
    typeof m.wedgeRad !== 'number' ||
    typeof m.variants !== 'number' ||
    !Array.isArray(m.lods) ||
    !Array.isArray(atlas)
  )
    fail('missing venue metadata');
  return {
    meta: {
      version: m.version ?? 0,
      wedges: m.wedges!,
      wedgeRad: m.wedgeRad!,
      variants: m.variants!,
      lods: m.lods as number[],
      atlas: atlas as [number, number],
    },
    meshes,
    image: { bytes, mime: image.mimeType },
  };
}
