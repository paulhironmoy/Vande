/** Orchestration tests, not GPU speed evidence. Browser launch/PERF4 gates measure the real renderer separately. */
import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, BufferGeometry, Group, InstancedBufferAttribute, InstancedBufferGeometry, InstancedMesh, LineSegments, LOD, Matrix4, Mesh, MeshBasicMaterial, MeshDepthMaterial, PerspectiveCamera, Plane, Points, Scene, SkinnedMesh, Sphere, Vector3, Vector4, type Object3D, type Texture } from 'three';
import type { QualityProfileId } from '@/contracts/practice';
import { PRACTICE_PROFILES, type QualityPreset } from '@/render3d/core/quality';
import { StageScene } from '@/render3d/three/stageScene';
import { ThreePracticeStage } from '@/render3d/three/ThreePracticeStage';
import { createBall } from '@/render3d/three/ball';
import { createEventFx, createStumps, flatTexture } from '@/render3d/three/props';
import { createRig } from '@/render3d/three/players';

/** Exercise the real StageScene prewarm methods without manufacturing a WebGL context in jsdom. */
function warmScene(id: QualityProfileId, throwAt?: 'compile' | 'render') {
  const scene = new Scene();
  const hidden = new Group();
  hidden.visible = false;
  const lod = new LOD();
  const near = new Group(), far = new Group();
  lod.addLevel(near, 0);
  lod.addLevel(far, 10);
  far.visible = false;
  scene.add(hidden, lod);
  const originalObjects: Object3D[] = [];
  scene.traverse((object) => originalObjects.push(object));
  const viewport = new Vector4(3, 4, 915, 412);
  const scissor = new Vector4(6, 8, 900, 400);
  let scissorTest = false;
  const currentViewport = viewport.clone(), currentScissor = scissor.clone();
  const uniforms = vi.fn();
  // prewarm deliberately catches renderer errors. Record first and assert OUTSIDE it so a failed test assertion
  // cannot be swallowed by that production recovery boundary.
  const observations: Array<{ visible: boolean[]; autoUpdate: boolean; culled: boolean[] }> = [];
  const draws: Array<{ viewport: number[]; scissor: number[]; scissorTest: boolean }> = [];
  const observe = () => {
    const culled: boolean[] = [];
    scene.traverse((object) => culled.push(object.frustumCulled));
    observations.push({ visible: [hidden.visible, near.visible, far.visible], autoUpdate: lod.autoUpdate, culled });
  };
  const renderer = {
    compile: vi.fn(() => {
      observe();
      if (throwAt === 'compile') throw new Error('compile failed');
    }),
    render: vi.fn(() => {
      observe();
      draws.push({ viewport: currentViewport.toArray(), scissor: currentScissor.toArray(), scissorTest });
      if (throwAt === 'render') throw new Error('draw failed');
    }),
    info: { programs: [{ getUniforms: uniforms }] },
    getViewport: (out: Vector4) => out.copy(currentViewport),
    getScissor: (out: Vector4) => out.copy(currentScissor),
    getScissorTest: () => scissorTest,
    setViewport: (v: Vector4 | number, y?: number, w?: number, h?: number) => typeof v === 'number' ? currentViewport.set(v, y!, w!, h!) : currentViewport.copy(v),
    setScissor: (v: Vector4 | number, y?: number, w?: number, h?: number) => typeof v === 'number' ? currentScissor.set(v, y!, w!, h!) : currentScissor.copy(v),
    setScissorTest: (on: boolean) => { scissorTest = on; },
  };
  const stage = Object.create(StageScene.prototype) as StageScene;
  const applyPreset = vi.fn((preset: QualityPreset) => { stage.preset = preset; });
  Object.assign(stage, { scene, camera: new PerspectiveCamera(), renderer, preset: PRACTICE_PROFILES[id].preset, applyPreset });
  const restored = () => {
    expect(observations.length).toBe(throwAt === 'compile' ? 1 : 2);
    for (const observed of observations) {
      expect(observed.visible).toEqual([true, true, true]);
      expect(observed.autoUpdate).toBe(false);
      expect(observed.culled.every((value) => !value)).toBe(true);
    }
    for (const draw of draws) expect(draw).toEqual({ viewport: [0, 0, 1, 1], scissor: [0, 0, 1, 1], scissorTest: true });
    expect(hidden.visible).toBe(false);
    expect(near.visible).toBe(true);
    expect(far.visible).toBe(false);
    expect(lod.autoUpdate).toBe(true);
    for (const object of originalObjects) expect(object.frustumCulled).toBe(true);
    expect(currentViewport).toEqual(viewport);
    expect(currentScissor).toEqual(scissor);
    expect(scissorTest).toBe(false);
  };
  return { stage, renderer, applyPreset, uniforms, restored };
}

describe('active-profile shader warm-up', () => {
  for (const id of ['lite', 'standard', 'high'] as const) {
    it(`${id}: warms all visible/hidden/LOD/depth variants once, without visiting another graphics profile`, () => {
      const c = warmScene(id);
      const active = PRACTICE_PROFILES[id].preset;
      expect(c.stage.prewarm([active])).toBeGreaterThanOrEqual(0);
      expect(c.applyPreset.mock.calls).toEqual([[active]]);
      expect(c.renderer.compile).toHaveBeenCalledTimes(1);
      expect(c.renderer.render).toHaveBeenCalledTimes(1);
      expect(c.uniforms).toHaveBeenCalledTimes(1);
      expect(c.stage.preset).toBe(active);
      c.restored();
    });
  }

  for (const failure of ['compile', 'render'] as const) {
    it(`restores visibility, LOD and viewport even when ${failure} fails`, () => {
      const c = warmScene('high', failure);
      c.stage.prewarm([PRACTICE_PROFILES.high.preset]);
      c.restored();
    });
  }

  for (const failure of [undefined, 'compile', 'render'] as const) {
    it(`preserves full instance counts, every group and shared/skinned geometry (${failure ?? 'success'})`, () => {
      const c = warmScene('standard', failure);
      const geometry = new BoxGeometry();
      // Six separated material groups remain eligible; a single drawRange.count=3 would wrongly drop five.
      const materials = geometry.groups.map(() => new MeshBasicMaterial());
      const planes = [new Plane(new Vector3(1, 0, 0), 2)];
      materials[0].clippingPlanes = planes;
      const crowd = new InstancedMesh(geometry, materials, 3600);
      crowd.castShadow = true;
      crowd.customDepthMaterial = new MeshDepthMaterial();
      crowd.instanceColor = new InstancedBufferAttribute(new Float32Array(3600 * 3), 3);
      const prop = new InstancedMesh(geometry, materials, 7);
      const empty = new InstancedMesh(geometry, materials, 0);
      const single = new InstancedMesh(geometry, materials, 1);
      const ordinary = new Mesh(geometry, materials);
      const skinned = new SkinnedMesh(geometry, materials);
      const points = new Points(geometry);
      const lines = new LineSegments(geometry);
      const emptyGeometry = new BufferGeometry().copy(geometry);
      emptyGeometry.setDrawRange(3, 0);
      const emptyRange = new InstancedMesh(emptyGeometry, materials, 4);
      // Neither instancing path may be altered by warm-up scope selection.
      const instancedGeometry = new InstancedBufferGeometry();
      instancedGeometry.setAttribute('position', geometry.getAttribute('position'));
      instancedGeometry.setIndex(geometry.index);
      for (const group of geometry.groups) instancedGeometry.addGroup(group.start, group.count, group.materialIndex);
      instancedGeometry.instanceCount = 9;
      const instancedBufferMesh = new Mesh(instancedGeometry, materials);
      const objects = [crowd, prop, empty, single, ordinary, skinned, points, lines, emptyRange, instancedBufferMesh];
      c.stage.scene.add(...objects);
      const meshes = [crowd, prop, empty, single, emptyRange];
      const counts = meshes.map((mesh) => mesh.count);
      const groups = geometry.groups;
      const ranges = [geometry.drawRange, emptyGeometry.drawRange, instancedGeometry.drawRange];
      const groupsBefore = groups.map((group) => ({ ...group }));
      const rangesBefore = ranges.map((range) => ({ ...range }));
      const matrix = crowd.instanceMatrix, colour = crowd.instanceColor, depth = crowd.customDepthMaterial;
      const observations: Array<{
        phase: string; counts: number[]; objects: typeof objects; groups: typeof groupsBefore;
        ranges: typeof rangesBefore; materialGroups: number[]; castShadow: boolean; skin: boolean;
        geometryInstances: number; sameMatrix: boolean; sameColour: boolean; sameDepth: boolean; sameClipping: boolean;
      }> = [];
      const capture = (phase: string) => observations.push({
        phase, counts: meshes.map((mesh) => mesh.count), objects: objects.filter((object) => object.parent === c.stage.scene),
        groups: geometry.groups.map((group) => ({ ...group })), ranges: ranges.map((range) => ({ ...range })),
        materialGroups: geometry.groups.filter((group) => group.count > 0).map((group) => materials.indexOf((crowd.material as typeof materials)[group.materialIndex ?? 0])),
        castShadow: crowd.castShadow, skin: skinned.isSkinnedMesh, geometryInstances: instancedGeometry.instanceCount,
        sameMatrix: crowd.instanceMatrix === matrix, sameColour: crowd.instanceColor === colour,
        sameDepth: crowd.customDepthMaterial === depth, sameClipping: materials[0].clippingPlanes === planes,
      });
      const compile = c.renderer.compile.getMockImplementation()!;
      c.renderer.compile.mockImplementation(() => { capture('compile'); compile(); });
      const render = c.renderer.render.getMockImplementation()!;
      c.renderer.render.mockImplementation(() => { capture('render'); render(); });

      c.stage.prewarm([PRACTICE_PROFILES.standard.preset]);

      expect(observations.map((o) => o.phase)).toEqual(failure === 'compile' ? ['compile'] : ['compile', 'render']);
      for (const o of observations) {
        expect(o.counts).toEqual(counts);
        expect(o.objects).toEqual(objects);
        expect(o.groups).toEqual(groupsBefore);
        expect(o.ranges).toEqual(rangesBefore);
        expect(o.materialGroups).toEqual([0, 1, 2, 3, 4, 5]);
        expect(o.castShadow && o.skin && o.sameMatrix && o.sameColour && o.sameDepth && o.sameClipping).toBe(true);
        expect(o.geometryInstances).toBe(9);
      }
      expect(meshes.map((mesh) => mesh.count)).toEqual(counts);
      expect(geometry.groups).toBe(groups);
      expect(geometry.groups).toEqual(groupsBefore);
      expect([geometry.drawRange, emptyGeometry.drawRange, instancedGeometry.drawRange]).toEqual(rangesBefore);
      expect(geometry.drawRange).toBe(ranges[0]);
      expect(emptyGeometry.drawRange).toBe(ranges[1]);
      expect(instancedGeometry.drawRange).toBe(ranges[2]);
      expect(instancedGeometry.instanceCount).toBe(9);
      expect(crowd.instanceMatrix).toBe(matrix);
      expect(crowd.instanceColor).toBe(colour);
      expect(crowd.customDepthMaterial).toBe(depth);
      expect(materials[0].clippingPlanes).toBe(planes);
      c.restored();
      for (const object of objects) if (object instanceof InstancedMesh) object.dispose();
      for (const material of materials) material.dispose();
      depth.dispose();
      geometry.dispose(); emptyGeometry.dispose(); instancedGeometry.dispose();
    });
  }

  for (const failure of [undefined, 'compile', 'render'] as const) {
    it(`never caches one-instance bounds for later live rendering (${failure ?? 'success'})`, () => {
      const c = warmScene('standard', failure);
      const geometry = new BoxGeometry();
      const material = new MeshBasicMaterial();
      const missing = new InstancedMesh(geometry, material, 3);
      const existing = new InstancedMesh(geometry, material, 2);
      missing.setMatrixAt(2, new Matrix4().makeTranslation(100, 0, 0));
      existing.setMatrixAt(1, new Matrix4().makeTranslation(-60, 0, 0));
      missing.computeBoundingSphere();
      const expectedMissing = missing.boundingSphere!.clone();
      missing.boundingSphere = null;
      existing.computeBoundingSphere();
      const originalExisting = existing.boundingSphere!;
      const expectedExisting = originalExisting.clone();
      c.stage.scene.add(missing, existing);
      const observed: Array<{ counts: number[]; bounds: Sphere[] }> = [];
      const render = c.renderer.render.getMockImplementation()!;
      c.renderer.render.mockImplementation(() => {
        // Model Three's real lazy sort-bound path, including its count-sensitive compute implementation.
        for (const mesh of [missing, existing]) if (mesh.boundingSphere === null) mesh.computeBoundingSphere();
        observed.push({ counts: [missing.count, existing.count], bounds: [missing.boundingSphere!.clone(), existing.boundingSphere!.clone()] });
        render();
      });

      c.stage.prewarm([PRACTICE_PROFILES.standard.preset]);

      expect(observed.length).toBe(failure === 'compile' ? 0 : 1);
      if (failure === 'compile') expect(missing.boundingSphere).toBeNull();
      else {
        expect(observed[0].counts).toEqual([3, 2]);
        expect(observed[0].bounds).toEqual([expectedMissing, expectedExisting]);
        expect(missing.boundingSphere).toEqual(expectedMissing);
        expect(missing.boundingSphere!.containsPoint(new Vector3(100, 0, 0))).toBe(true);
      }
      expect(existing.boundingSphere).toBe(originalExisting);
      expect(existing.boundingSphere).toEqual(expectedExisting);
      expect([missing.count, existing.count]).toEqual([3, 2]);
      c.restored();
      missing.dispose(); existing.dispose(); geometry.dispose(); material.dispose();
    });
  }

  for (const id of ['lite', 'standard', 'high'] as const) {
    for (const failure of [undefined, 'compile', 'render'] as const) {
      it(`${id}: excludes only unreachable Practice objects from compile and draw, restoring the exact scene (${failure ?? 'success'})`, () => {
        const c = warmScene(id, failure);
        const texture = flatTexture([255, 255, 255, 255]) as unknown as Texture;
        const ball = createBall(texture), events = createEventFx(texture), stumps = createStumps();
        const rig = createRig('batter', PRACTICE_PROFILES[id].preset.lodDistance);
        const ghost = rig.root.children.find((object) => object.name === 'ghost-warmup')!;
        const coachBat = new Mesh(new BoxGeometry(), new MeshBasicMaterial({ transparent: true }));
        coachBat.name = 'coach-ghost-bat';
        const unrelatedName = new Group();
        unrelatedName.name = 'ghost-warmup'; // not a registered player helper: must remain reachable
        // Nested and repeated explicit references must not disturb the original subtree or sibling ordering.
        const nested = new Group();
        ball.matchOnlyMeshes[0].add(nested);
        Object.assign(ball, { matchOnlyMeshes: [...ball.matchOnlyMeshes, nested, nested] });
        Object.assign(c.stage, { ballFx: ball, eventFx: events, stumpsFx: stumps, rigs: new Map([['batter', rig]]) });
        c.stage.scene.add(ball.group, events.group, stumps.group, rig.root, coachBat, unrelatedName);
        const before: Array<{ object: Object3D; parent: Object3D | null; children: Object3D[]; childrenRef: Object3D[]; visible: boolean; culled: boolean }> = [];
        c.stage.scene.traverse((object) => before.push({ object, parent: object.parent, children: [...object.children], childrenRef: object.children, visible: object.visible, culled: object.frustumCulled }));
        const omitted = new Set<Object3D>([...ball.matchOnlyMeshes, ...events.matchOnlyMeshes, ...stumps.ledMeshes]);
        const required = before.map(({ object }) => object).filter((object) => !omitted.has(object));
        const observations: Array<{ phase: string; objects: Object3D[] }> = [];
        const capture = (phase: string) => {
          const objects: Object3D[] = [];
          c.stage.scene.traverse((object) => objects.push(object));
          observations.push({ phase, objects });
        };
        const compile = c.renderer.compile.getMockImplementation()!;
        c.renderer.compile.mockImplementation(() => { capture('compile'); compile(); });
        const render = c.renderer.render.getMockImplementation()!;
        c.renderer.render.mockImplementation(() => { capture('render'); render(); });

        c.stage.prewarmPractice(PRACTICE_PROFILES[id].preset);

        expect(observations.map((o) => o.phase)).toEqual(failure === 'compile' ? ['compile'] : ['compile', 'render']);
        for (const { objects } of observations) {
          expect(objects).toEqual(required);
          expect(objects).toContain(coachBat);
          expect(objects).toContain(ghost); // Coach demonstration is reachable: its material must be warm at mount.
          expect(objects).toContain(unrelatedName);
          for (const mesh of rig.meshes) expect(objects).toContain(mesh); // both actual player LODs
          for (const mesh of stumps.group.children.filter((o) => !stumps.ledMeshes.includes(o as InstancedMesh))) expect(objects).toContain(mesh);
          expect(objects.some((object) => object.name === 'practice-ball-surround')).toBe(true);
          for (const object of omitted) expect(objects).not.toContain(object);
        }
        for (const saved of before) {
          expect(saved.object.parent).toBe(saved.parent);
          expect(saved.object.children).toBe(saved.childrenRef);
          expect(saved.object.children).toEqual(saved.children);
          expect(saved.object.visible).toBe(saved.visible);
          expect(saved.object.frustumCulled).toBe(saved.culled);
        }
        c.restored();
        // The same scene's GENERIC warm-up still compiles and draws the restored legacy/ghost/LED assets.
        observations.length = 0;
        c.stage.prewarm([PRACTICE_PROFILES[id].preset]);
        for (const observed of observations) expect(observed.objects).toEqual(before.map(({ object }) => object));
        ball.dispose(); events.dispose(); stumps.dispose(); texture.dispose();
        coachBat.geometry.dispose(); (coachBat.material as MeshBasicMaterial).dispose();
      });
    }
  }

  it('fully warms a newly selected profile before returning, and rewarms after context restoration', () => {
    const stage = new ThreePracticeStage();
    const order: string[] = [];
    const prewarm = vi.fn((_preset: QualityPreset) => { order.push('warm'); return 12; });
    const renderer = {
      applyPreset: vi.fn(), prewarmPractice: prewarm, setSize: vi.fn(),
      ballFx: { setStyle: vi.fn() },
      rigOf: vi.fn(() => undefined),
    };
    const canvas = document.createElement('canvas');
    canvas.width = 915;
    canvas.height = 412;
    Object.assign(stage, { stage: renderer, canvas, mounted: true });
    stage.setProfile('high');
    expect(prewarm.mock.calls).toEqual([[PRACTICE_PROFILES.high.preset]]);
    stage.setProfile('high');
    expect(prewarm).toHaveBeenCalledTimes(1);
    stage.setProfile('lite');
    expect(prewarm.mock.calls[1]).toEqual([PRACTICE_PROFILES.lite.preset]);
    // Restored GPU programs cannot inherit an application-level "already warm" bit from the lost context.
    stage.on('contextrestored', () => { order.push('restored'); });
    Object.assign(stage, { contextLost: true });
    order.length = 0;
    (stage as unknown as { onRestored(): void }).onRestored();
    expect(prewarm.mock.calls[2]).toEqual([PRACTICE_PROFILES.lite.preset]);
    expect(order).toEqual(['warm', 'restored']);
  });
});
