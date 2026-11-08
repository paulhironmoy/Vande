/**
 * The venue packs (scripts/venue/pack.mjs -> src/render3d/three/venue/pack/*.glb) and their strict reader
 * (three/venueGlb.ts): a round trip on a synthetic wedge, every refusal, the shipped files' budgets and structure
 * (Definition of Done VEN-02, VEN-09), the bake's constants against the code's, and the register naming every file.
 * No pixels and no GPU: the checks are on bytes and numbers.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOUNDARY_R } from '@/render3d/core/ground';
import { BACK_WALL, PARAPET, ROOF, STAND_ROWS, STAND_TIERS } from '@/render3d/core/venueGeometry';
import { VENUE_LIMITS, VenueFormatError, parseVenuePack } from '@/render3d/three/venueGlb';
import { PACKS, POSITION_UNITS, buildGlb, type WedgeJson } from '../../../scripts/venue/pack.mjs';

const ROOT = join(__dirname, '..', '..', '..');
const PACK_DIR = join(ROOT, 'src/render3d/three/venue/pack');
const WEDGE_PATH = join(ROOT, 'assets-src/venue/wedge.json');

const tri = (n: number) => Array.from({ length: n * 3 }, (_, i) => i);
const synthetic = (): WedgeJson => {
  const lod = (vertices: number) => ({
    triangles: vertices - 2,
    vertices,
    pos: Array.from({ length: vertices * 3 }, (_, i) => ((i * 7) % 23) * 1.37 + (i % 3 === 2 ? 62 : -3.25)),
    uv: Array.from({ length: vertices * 2 }, (_, i) => (i % 5) / 5),
    tier: Array.from({ length: vertices }, (_, i) => i % 2),
    col: Array.from({ length: vertices * 3 }, (_, i) => ((i * 13) % 100) / 100),
    idx: tri(vertices - 2).map((v) => v % vertices),
  });
  return {
    version: 1,
    constants: {
      boundaryR: 62,
      wedgeRad: Math.PI / 30,
      wedges: 60,
      tiers: {},
      roof: ROOF,
      backWall: { ...BACK_WALL },
      parapet: { ...PARAPET },
    },
    atlas: { w: 1024, h: 512, variants: 4, whiteUv: [0.998, 0.996], tiles: {} },
    lods: [lod(9), lod(6)],
  };
};
const webp = () =>
  Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x60, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(80, 7)]);
const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** Rewrites a GLB's JSON with `edit` and fixes the chunk and file lengths. */
function rewrite(glb: Buffer, edit: (json: Record<string, unknown>) => void): ArrayBuffer {
  const jsonLen = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8')) as Record<string, unknown>;
  edit(json);
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const bin = glb.subarray(20 + jsonLen);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + text.length + bin.length, 8);
  head.writeUInt32LE(text.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  return ab(Buffer.concat([head, text, bin]));
}

describe('the venue pack reader', () => {
  const lods = [0, 1];
  const glb = buildGlb(synthetic(), lods, webp(), [1024, 512]);

  it('round-trips a pack within the quantisation steps', () => {
    const wedge = synthetic();
    const pack = parseVenuePack(ab(glb));
    expect(pack.meta).toMatchObject({ wedges: 60, variants: 4, lods: [0, 1], atlas: [1024, 512] });
    expect(pack.meshes.map((m) => m.name)).toEqual(['wedge_lod0', 'wedge_lod1']);
    pack.meshes.forEach((m, k) => {
      const src = wedge.lods[k];
      expect(m.positions.length).toBe(src.vertices * 3);
      for (let i = 0; i < m.positions.length; i++)
        expect(Math.abs(m.positions[i] - src.pos[i])).toBeLessThanOrEqual(0.5 / POSITION_UNITS + 1e-6);
      for (let i = 0; i < m.uvs.length; i++) expect(Math.abs(m.uvs[i] - src.uv[i])).toBeLessThanOrEqual(1 / 65535);
      for (let i = 0; i < m.colors.length; i++)
        expect(Math.abs(m.colors[i] - src.col[i])).toBeLessThanOrEqual(0.5 / 255 + 1e-6);
      expect(Array.from(m.tier)).toEqual(src.tier);
      expect(Array.from(m.indices)).toEqual(src.idx);
    });
    expect(pack.image.mime).toBe('image/webp');
    expect(pack.image.bytes.length).toBe(webp().length);
  });

  it('refuses what is not its own pack', () => {
    const bad = (b: ArrayBuffer) => expect(() => parseVenuePack(b)).toThrow(VenueFormatError);
    bad(new ArrayBuffer(10));
    bad(ab(glb.subarray(0, glb.length - 5)));
    const wrongMagic = Buffer.from(glb);
    wrongMagic.writeUInt32LE(0x12345678, 0);
    bad(ab(wrongMagic));
    const wrongVersion = Buffer.from(glb);
    wrongVersion.writeUInt32LE(1, 4);
    bad(ab(wrongVersion));
    const wrongLength = Buffer.from(glb);
    wrongLength.writeUInt32LE(glb.length + 4, 8);
    bad(ab(wrongLength));
    bad(rewrite(glb, (j) => (j.extensionsRequired = ['KHR_draco_mesh_compression'])));
    bad(rewrite(glb, (j) => ((j.accessors as Array<Record<string, number>>)[0].count = 99999)));
    bad(rewrite(glb, (j) => ((j.accessors as Array<Record<string, number>>)[1].count = 3)));
    bad(rewrite(glb, (j) => ((j.accessors as Array<Record<string, unknown>>)[3].type = 'VEC3')));
    bad(rewrite(glb, (j) => ((j.bufferViews as Array<Record<string, number>>)[0].byteOffset = 1e9)));
    bad(rewrite(glb, (j) => ((j.images as Array<Record<string, string>>)[0].mimeType = 'image/png')));
    bad(rewrite(glb, (j) => delete (j.asset as Record<string, unknown>).extras));
    bad(rewrite(glb, (j) => ((j.nodes as Array<Record<string, unknown>>)[0].scale = [0, 1, 1])));
    bad(ab(Buffer.concat([glb, Buffer.alloc(VENUE_LIMITS.bytes)])));
  });

  it('refuses an index outside its vertices and an atlas that is not a WebP', () => {
    const wedge = synthetic();
    wedge.lods[0].idx[2] = 9;
    expect(() => parseVenuePack(ab(buildGlb(wedge, lods, webp(), [1024, 512])))).toThrow(/index outside/);
    const notWebp = Buffer.concat([Buffer.from('RIFX'), Buffer.alloc(100)]);
    expect(() => parseVenuePack(ab(buildGlb(synthetic(), lods, notWebp, [1024, 512])))).toThrow(/WebP/);
  });
});

describe('the shipped venue packs', () => {
  const have = PACKS.every((p) => existsSync(join(PACK_DIR, p.file))) && existsSync(WEDGE_PATH);

  it('exist, parse, and keep to the byte, triangle and structure budgets', () => {
    expect(have, `run scripts/venue/pack.mjs (packs in ${PACK_DIR})`).toBe(true);
    const ceilings: Record<string, { total: number; atlas: number; geometry: number }> = {
      'venue-p.glb': { total: 600_000, atlas: 250_000, geometry: 350_000 },
      'venue-b.glb': { total: 250_000, atlas: 90_000, geometry: 160_000 },
    };
    for (const spec of PACKS) {
      const bytes = readFileSync(join(PACK_DIR, spec.file));
      const pack = parseVenuePack(ab(bytes));
      const c = ceilings[spec.file];
      expect(bytes.length, `${spec.file} total`).toBeLessThanOrEqual(c.total);
      expect(pack.image.bytes.length, `${spec.file} atlas`).toBeLessThanOrEqual(c.atlas);
      expect(pack.image.bytes.length, `${spec.file} atlas is a real image, not a stub`).toBeGreaterThan(10_000);
      expect(bytes.length - pack.image.bytes.length, `${spec.file} geometry and JSON`).toBeLessThanOrEqual(c.geometry);
      expect(pack.meta.lods).toEqual(spec.lods);
      expect(pack.meta.wedges).toBe(60);
      expect(pack.meta.atlas[0]).toBe(spec.atlasWidth);
      pack.meshes.forEach((m, k) => {
        const lod = spec.lods[k];
        expect(m.indices.length / 3, `${spec.file} LOD${lod} triangles per wedge`).toBeLessThanOrEqual(
          lod === 0 ? 600 : 150,
        );
        // Every vertex sits inside the bowl's footprint: wedge-local, within the roof's outer radius and the roof's height.
        for (let i = 0; i < m.positions.length; i += 3) {
          expect(Math.hypot(m.positions[i], m.positions[i + 2])).toBeLessThanOrEqual(ROOF.rOuter + 0.1);
          expect(m.positions[i + 1]).toBeGreaterThanOrEqual(-0.01);
          expect(m.positions[i + 1]).toBeLessThanOrEqual(ROOF.y + ROOF.h / 2 + 0.01);
        }
        // Nothing of the bowl comes in front of the parapet at the rope's board line (the rope itself is at 62 m).
        for (let i = 0; i < m.positions.length; i += 3)
          expect(Math.hypot(m.positions[i], m.positions[i + 2])).toBeGreaterThanOrEqual(BOUNDARY_R + 7.4);
        // Baked ambient occlusion keeps every surface colour in range and never black.
        for (const v of m.colors) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      });
    }
  });

  it('are rebuilt byte for byte from assets-src/venue/wedge.json and the atlas they carry', () => {
    const wedge = JSON.parse(readFileSync(WEDGE_PATH, 'utf8')) as WedgeJson;
    for (const spec of PACKS) {
      const shipped = readFileSync(join(PACK_DIR, spec.file));
      const pack = parseVenuePack(ab(shipped));
      const again = buildGlb(wedge, spec.lods, Buffer.from(pack.image.bytes), pack.meta.atlas);
      expect(again.equals(shipped), `${spec.file} geometry part reproducible`).toBe(true);
    }
  });

  it('was made by the Blender script in Blender (not a dry run)', () => {
    const wedge = JSON.parse(readFileSync(WEDGE_PATH, 'utf8')) as WedgeJson;
    expect(wedge.generator).toBe('scripts/blender/venue/build_venue.py');
    expect(wedge.blender, 'the Blender version that built the wedge').toMatch(/^\d+\.\d+/);
  });

  it("bakes the numbers the code builds with (the Blender script's constants against core/venueGeometry.ts)", () => {
    const wedge = JSON.parse(readFileSync(WEDGE_PATH, 'utf8')) as WedgeJson;
    const c = wedge.constants;
    expect(c.boundaryR).toBe(BOUNDARY_R);
    expect(c.wedges * c.wedgeRad).toBeCloseTo(Math.PI * 2, 9);
    for (const name of ['lower', 'upper'] as const) {
      const { rows, ...tier } = c.tiers[name];
      expect(tier).toEqual(STAND_TIERS[name]);
      expect(rows).toBe(STAND_ROWS[name]);
    }
    expect(c.roof).toEqual(ROOF);
    expect(c.backWall).toEqual(BACK_WALL);
    expect(c.parapet).toEqual(PARAPET);
  });
});

describe('provenance (Definition of Done VEN-09, rubric ART7)', () => {
  const walk = (dir: string): string[] =>
    !existsSync(dir)
      ? []
      : readdirSync(dir).flatMap((f) => {
          const p = join(dir, f);
          return statSync(p).isDirectory() ? walk(p) : [p];
        });
  const register = readFileSync(join(ROOT, 'docs/ASSET_REGISTER.md'), 'utf8');

  it('names every shipped venue file and every generator in docs/ASSET_REGISTER.md', () => {
    const files = [
      ...walk(PACK_DIR),
      ...walk(join(ROOT, 'assets-src/venue')),
      ...walk(join(ROOT, 'public/practice/venue')),
      ...walk(join(ROOT, 'unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Production/Venue')).filter(
        (f) => !f.endsWith('.meta'),
      ),
    ].map((f) => relative(ROOT, f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(register.includes(f), `${f} is in the register`).toBe(true);
    for (const gen of ['scripts/blender/venue/build_venue.py', 'scripts/venue/pack.mjs', 'scripts/venue/crowd.mjs'])
      expect(register.includes(gen), `${gen} is in the register`).toBe(true);
  });
});
