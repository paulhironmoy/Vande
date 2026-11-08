/**
 * The baked venue's scene objects (three/venueBaked.ts) built from the shipped packs: how many wedges, where, at which level of
 * detail, how many draw calls and triangles, that no light is added (rubric ART5, Definition of Done VEN-07), that the material's
 * shader patch still fits the three.js shader it patches (a renamed chunk would break it silently on a device), and that the
 * venue modules touch nothing of the physics or the rules (VEN-05). No GPU: the shader is checked as text.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Matrix4, MeshBasicMaterial, ShaderLib, type InstancedMesh } from 'three';
import { describe, expect, it } from 'vitest';
import { SIGHT_SCREEN_GAP_HALF } from '@/render3d/core/venueGeometry';
import { LOD0_SPAN, VENUE_PROGRAM_KEY, buildBakedVenue, gapWedges } from '@/render3d/three/venueBaked';
import { parseVenuePack } from '@/render3d/three/venueGlb';

const ROOT = join(__dirname, '..', '..', '..');
const PACK_DIR = join(ROOT, 'src/render3d/three/venue/pack');
const load = (file: string) => {
  const b = readFileSync(join(PACK_DIR, file));
  return parseVenuePack(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
};
const UNIFORMS = Object.fromEntries(
  ['uTime', 'uExcite', 'uPhones', 'uFront', 'uBack', 'uPaintFrom', 'uAmbient'].map((k) => [k, { value: 0 }]),
);
const bitmap = { width: 1024, height: 512, close: () => undefined } as unknown as ImageBitmap;
const deg = (r: number) => ((((r * 180) / Math.PI) % 360) + 360) % 360;

function azimuths(mesh: InstancedMesh): number[] {
  const m = new Matrix4();
  return Array.from({ length: mesh.count }, (_, i) => {
    mesh.getMatrixAt(i, m);
    return deg(Math.atan2(m.elements[8], m.elements[0]));
  });
}

describe('the wedge ring', () => {
  it('leaves three wedges out behind each end for the sight screens', () => {
    const gap = gapWedges(60, (Math.PI * 2) / 60);
    expect([...gap].sort((a, b) => a - b)).toEqual([0, 1, 29, 30, 31, 59]);
    // Their edges cover the screen's gap: 1.5 wedges of 6 degrees each side of the axis is more than the 8.7 degrees needed.
    expect(1.5 * 6).toBeGreaterThan((SIGHT_SCREEN_GAP_HALF * 180) / Math.PI);
  });

  it('builds Premium as 18 stepped wedges near the bowler end, 36 simple ones elsewhere and 6 tier-less gap wedges', () => {
    const pack = load('venue-p.glb');
    const venue = buildBakedVenue(pack, bitmap, UNIFORMS);
    const [lod0, lod1, lod2] = venue.group.children as InstancedMesh[];
    expect(venue.group.children.map((c) => c.name)).toEqual(['venue-lod0', 'venue-lod1', 'venue-lod2']);
    expect([lod0.count, lod1.count, lod2.count]).toEqual([18, 36, 6]);
    const near = azimuths(lod0);
    for (const a of near) expect(Math.abs(a - 180)).toBeLessThanOrEqual((LOD0_SPAN * 180) / Math.PI + 1e-6);
    const all = [...near, ...azimuths(lod1)].sort((a, b) => a - b);
    expect(all).toHaveLength(54);
    expect(new Set(all.map((a) => Math.round(a))).size).toBe(54); // no wedge twice
    for (const a of all) expect(Math.abs(a / 6 - Math.round(a / 6))).toBeLessThan(1e-6); // on the 6 degree grid
    for (const out of [0, 6, 354, 174, 180, 186]) expect(all.some((a) => Math.abs(a - out) < 1e-6)).toBe(false);
    // The gap wedges (behind the sight screens) are exactly the six left out of the tiers.
    expect(
      azimuths(lod2)
        .map((a) => (Math.round(a * 1e3) / 1e3) % 360)
        .sort((a, b) => a - b),
    ).toEqual([0, 6, 174, 180, 186, 354]);
    const s = venue.stats();
    expect(s.drawCalls).toBe(3);
    const tris = (k: number) => pack.meshes[k].indices.length / 3;
    expect(s.triangles).toBe(18 * tris(0) + 36 * tris(1) + 6 * tris(2));
    expect(s.triangles).toBeLessThanOrEqual(45_000);
    venue.dispose();
  });

  it('builds Balanced as 54 simple wedges and the 6 gap wedges in two draw calls', () => {
    const venue = buildBakedVenue(load('venue-b.glb'), bitmap, UNIFORMS);
    expect(venue.group.children).toHaveLength(2);
    expect((venue.group.children as InstancedMesh[]).map((c) => c.count)).toEqual([54, 6]);
    expect(venue.stats()).toMatchObject({ drawCalls: 2 });
    expect(venue.stats().triangles).toBeLessThanOrEqual(15_000);
    venue.dispose();
  });

  it('spreads the crowd variants over the atlas and adds no light (one key light, rubric ART5)', () => {
    const venue = buildBakedVenue(load('venue-p.glb'), bitmap, UNIFORMS);
    const seen = new Set<number>();
    venue.group.traverse((o) => {
      expect((o as { isLight?: boolean }).isLight).not.toBe(true);
      const g = (o as InstancedMesh).geometry;
      const v = g?.getAttribute('aVariant');
      if (v) for (let i = 0; i < v.count; i++) seen.add(v.getX(i));
    });
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
    venue.dispose();
  });

  it('refuses a stand-in without the uniforms it shares', () => {
    expect(() => buildBakedVenue(load('venue-b.glb'), bitmap, { uTime: { value: 0 } })).toThrow(/uniform/);
  });
});

describe('the material', () => {
  it('patches the shader three.js ships without losing a chunk it hooks into', () => {
    const venue = buildBakedVenue(load('venue-b.glb'), bitmap, UNIFORMS);
    const mesh = venue.group.children[0] as InstancedMesh;
    const mat = mesh.material as MeshBasicMaterial;
    expect(mat.customProgramCacheKey()).toBe(VENUE_PROGRAM_KEY);
    expect(mat.fog).toBe(true);
    expect(mat.vertexColors).toBe(true);
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: ShaderLib.basic.vertexShader,
      fragmentShader: ShaderLib.basic.fragmentShader,
    };
    const before = { ...shader };
    mat.onBeforeCompile(shader as never, undefined as never);
    for (const chunk of ['common', 'uv_vertex']) expect(before.vertexShader).toContain(`#include <${chunk}>`);
    for (const chunk of ['common', 'clipping_planes_fragment', 'color_fragment'])
      expect(before.fragmentShader).toContain(`#include <${chunk}>`);
    expect(shader.vertexShader).toContain('attribute float aVariant');
    expect(shader.vertexShader).toContain('vMapUv.x += aTier * aVariant');
    expect(shader.fragmentShader).toContain('bayer4(gl_FragCoord.xy) >= uFade');
    expect(shader.fragmentShader).toContain('uPaintFrom');
    for (const name of ['uFade', 'uTime', 'uExcite', 'uPhones', 'uFront', 'uBack', 'uPaintFrom', 'uAmbient'])
      expect(shader.uniforms[name], name).toBeDefined();
    // The uniforms are the stand-in's own objects, shared by reference, so environment changes reach the venue.
    expect(shader.uniforms.uAmbient).toBe(UNIFORMS.uAmbient);
    venue.dispose();
  });

  it('starts fully dissolved and is faded in by setFade', () => {
    const venue = buildBakedVenue(load('venue-b.glb'), bitmap, UNIFORMS);
    const mat = (venue.group.children[0] as InstancedMesh).material as MeshBasicMaterial;
    const shader = {
      uniforms: {} as Record<string, { value: number }>,
      vertexShader: ShaderLib.basic.vertexShader,
      fragmentShader: ShaderLib.basic.fragmentShader,
    };
    mat.onBeforeCompile(shader as never, undefined as never);
    expect(shader.uniforms.uFade.value).toBe(0);
    venue.setFade(0.4);
    expect(shader.uniforms.uFade.value).toBeCloseTo(0.4, 6);
    venue.setFade(7);
    expect(shader.uniforms.uFade.value).toBe(1);
    venue.dispose();
  });
});

describe('the venue modules stay presentation (Definition of Done VEN-05, red lines 1 to 3)', () => {
  it('import nothing of the physics, the engine, the rules or the flow', () => {
    const files = [
      ...readdirSync(join(ROOT, 'src/render3d/three'))
        .filter((f) => /^venue.*\.ts$/.test(f))
        .map((f) => join(ROOT, 'src/render3d/three', f)),
      join(ROOT, 'src/render3d/core/venueGeometry.ts'),
      join(ROOT, 'src/render3d/fallback2d/venuePaint.ts'),
    ];
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const f of files) {
      const imports = [...readFileSync(f, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      for (const spec of imports)
        expect(spec, `${f} imports ${spec}`).not.toMatch(/^@\/(physics|engine|practice|screens|api|store)/);
    }
  });
});
