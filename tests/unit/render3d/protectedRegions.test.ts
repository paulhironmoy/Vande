import { describe, expect, it } from 'vitest';
import { Bone, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three';
import type { ProtectedRegion } from '@/render3d/practice/types';
import { cameraAt, practicePlan } from '@/render3d/core/camera';
import { firstPersonBatPose } from '@/render3d/practice/bat';
import { toWorld } from '@/render3d/practice/frame';
import { createFirstPerson } from '@/render3d/three/firstPerson';
import { createRig } from '@/render3d/three/players';
import { ThreePracticeStage } from '@/render3d/three/ThreePracticeStage';
import { practiceProtectedRegions, projectBallPathRegions, projectEnvelopeRegion, projectPolygonRegion, projectVisibleMeshRegions } from '@/render3d/three/protectedRegions';
import { caseScript, deliveryCases, project, VIEWPORTS } from './readabilityHarness';

const viewport = { w: 1000, h: 500 };
const camera = () => {
  const c = new PerspectiveCamera(90, 2, 0.1, 100);
  c.updateMatrixWorld();
  return c;
};
const contains = (r: ProtectedRegion, x: number, y: number) => x >= r.x - 1e-6 && x <= r.x + r.width + 1e-6 && y >= r.y - 1e-6 && y <= r.y + r.height + 1e-6;
const finite = (regions: ProtectedRegion[], size = viewport) => {
  for (const r of regions) {
    expect([r.x, r.y, r.width, r.height].every(Number.isFinite)).toBe(true);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
    expect(r.x + r.width).toBeLessThanOrEqual(size.w + 1e-6);
    expect(r.y + r.height).toBeLessThanOrEqual(size.h + 1e-6);
  }
};

describe('camera-derived protected geometry', () => {
  it('matches an analytic pinhole projection and follows mesh movement, visibility and camera resize', () => {
    const c = camera();
    const mesh = new Mesh(new PlaneGeometry(2, 2), new MeshBasicMaterial());
    mesh.position.z = -5;
    const measured = () => projectVisibleMeshRegions(mesh, 'bat', c, viewport);
    const before = measured()[0];
    expect(before.x).toBeCloseTo(450, 8);
    expect(before.y).toBeCloseTo(200, 8);
    expect(before.width).toBeCloseTo(100, 8);
    expect(before.height).toBeCloseTo(100, 8);
    mesh.position.x = 2;
    expect(measured()[0].x).toBeCloseTo(550, 8);
    c.aspect = 1;
    c.updateProjectionMatrix();
    const resized = projectVisibleMeshRegions(mesh, 'bat', c, { w: 500, h: 500 })[0];
    expect(resized.x).toBeCloseTo(300, 8);
    expect(resized.width).toBeCloseTo(100, 8);
    const parent = new Group();
    parent.add(mesh);
    parent.visible = false;
    expect(measured()).toEqual([]);
    parent.visible = true;
    mesh.material.visible = false;
    expect(measured()).toEqual([]);
    mesh.material.visible = true;
    mesh.visible = false;
    expect(measured()).toEqual([]);
  });

  it('uses the current skinned pose, not the bind-pose or actor root bounds', () => {
    const geometry = new PlaneGeometry(2, 2);
    const count = geometry.attributes.position.count;
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(count * 4), 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(Array.from({ length: count * 4 }, (_, i) => i % 4 === 0 ? 1 : 0), 4));
    const bone = new Bone();
    const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
    mesh.add(bone);
    mesh.bind(new Skeleton([bone]));
    mesh.position.z = -5;
    const before = projectVisibleMeshRegions(mesh, 'bowler', camera(), viewport)[0];
    bone.position.x = 1;
    const after = projectVisibleMeshRegions(mesh, 'bowler', camera(), viewport)[0];
    expect(after.x - before.x).toBeCloseTo(50, 8);
    expect(after.width).toBeCloseTo(before.width, 8);
  });

  it('clips crossing triangles and envelopes before division, excluding geometry entirely behind the lens or far plane', () => {
    const c = camera();
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([-0.01, -0.01, 0.1, 0.01, -0.01, -2, 0, 0.01, -2], 3));
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    const crossing = projectVisibleMeshRegions(mesh, 'bat', c, viewport);
    expect(crossing).toHaveLength(1);
    finite(crossing);
    const envelope = projectEnvelopeRegion({ x: 0, y: 0, z: -0.1 }, 0.2, 'contact', c, viewport);
    expect(envelope).not.toBeNull();
    finite([envelope!]);
    mesh.position.z = 10;
    expect(projectVisibleMeshRegions(mesh, 'bat', c, viewport)).toEqual([]);
    mesh.position.z = -200;
    expect(projectVisibleMeshRegions(mesh, 'bat', c, viewport)).toEqual([]);
    expect(projectEnvelopeRegion({ x: 0, y: 0, z: 2 }, 0.1, 'release', c, viewport)).toBeNull();
    expect(projectPolygonRegion([{ x: -1, y: 0, z: 2 }, { x: 1, y: 0, z: 2 }, { x: 0, y: 1, z: 2 }], 'pitch', c, viewport)).toBeNull();
  });

  it('does not let an offscreen triangle in a visible mesh reserve the empty top rail, for either side', () => {
    const c = camera();
    for (const side of [-1, 1]) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([
        side * 1, -0.6, -1, side * 1.5, -0.6, -1, side * 1.25, -0.8, -1,
        side * 3, 2, -1, side * 4, 2, -1, side * 3.5, 3, -1,
      ], 3));
      const regions = projectVisibleMeshRegions(new Mesh(geometry, new MeshBasicMaterial()), 'bat', c, viewport);
      expect(regions).toHaveLength(1);
      finite(regions);
      expect(regions[0].y, side < 0 ? 'left-hand mirror' : 'right-hand').toBeCloseTo(400, 4);
      expect(regions[0].y + regions[0].height).toBeCloseTo(450, 4);
    }
  });

  it('clips a triangle crossing a side plane to finite viewport bounds', () => {
    const c = camera();
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([1, -0.5, -1, 3, -0.5, -1, 1, 0.5, -1], 3));
    const regions = projectVisibleMeshRegions(new Mesh(geometry, new MeshBasicMaterial()), 'bat', c, viewport);
    expect(regions).toHaveLength(1);
    finite(regions);
    expect(regions[0].x + regions[0].width).toBeCloseTo(viewport.w, 8);
  });

  it('protects a bent path segment by segment without reserving the empty middle of its combined bounding box', () => {
    const points = [{ x: -2, y: -2, z: -5 }, { x: -2, y: 2, z: -5 }, { x: 2, y: 2, z: -5 }];
    const regions = projectBallPathRegions(points, camera(), viewport);
    expect(regions).toHaveLength(2);
    expect(regions.some((r) => contains(r, 500, 250))).toBe(false);
    expect(regions.some((r) => contains(r, 400, 250))).toBe(true);
    expect(regions.some((r) => contains(r, 500, 150))).toBe(true);
    finite(regions);
  });
});

describe('Practice first-person protected-region integration', () => {
  it('covers the actual release, visible incoming samples and bat geometry for both hands and every supported aspect', () => {
    const fp = createFirstPerson(new Scene());
    const rig = createRig('bowler', 15);
    for (const c of deliveryCases().filter((item) => item.name.startsWith('pace good'))) {
      const { script, flight } = caseScript(c);
      const p = script.practice!;
      // A real skinned rig, placed at the delivery's bowler end; projection is tested independently of clip sampling.
      rig.root.position.set(p.releaseWorld.x, 0, p.releaseWorld.z);
      fp.update(firstPersonBatPose(p.bat, p.releaseScene), { top: toWorld({ x: -0.12, y: 1.4, z: 9 }, p.mirror), bottom: toWorld({ x: -0.24, y: 1.3, z: 9.2 }, p.mirror) });
      for (const vp of VIEWPORTS) {
        const pose = cameraAt(script, p.releaseScene, practicePlan(script, false), { aspect: vp.w / vp.h, reducedMotion: false });
        const cam = new PerspectiveCamera(pose.fov, vp.w / vp.h, 0.1, 1200);
        cam.position.copy(pose.pos as Vector3);
        cam.lookAt(pose.target.x, pose.target.y, pose.target.z);
        cam.updateMatrixWorld();
        rig.lod.update(cam);
        const regions = practiceProtectedRegions(p, cam, vp, rig, fp.group);
        finite(regions, vp);
        for (const kind of ['bowler', 'release', 'pitch', 'ball_path', 'bat']) expect(regions.some((r) => r.kind === kind), `${c.name} ${vp.name}: ${kind}`).toBe(true);
        const release = project(pose, p.releaseWorld, vp.w / vp.h)!;
        expect(regions.some((r) => r.kind === 'release' && contains(r, (release.x + 1) * vp.w / 2, (1 - release.y) * vp.h / 2))).toBe(true);
        for (const sample of flight.samples.filter((sample) => sample.t <= flight.stumpsT)) {
          const q = project(pose, toWorld(sample.p, p.mirror), vp.w / vp.h);
          if (!q || q.depth < cam.near || Math.abs(q.x) > 1 || Math.abs(q.y) > 1) continue;
          expect(regions.some((r) => r.kind === 'ball_path' && contains(r, (q.x + 1) * vp.w / 2, (1 - q.y) * vp.h / 2))).toBe(true);
        }
        // The public stage adapter must use this camera, actual objects and current CSS size, not the base [] stub.
        const stage = new ThreePracticeStage();
        Object.assign(stage, { stage: { camera: cam, rigOf: () => rig }, fp, drawnPractice: p, size: vp });
        expect(stage.protectedRegions()).toEqual(regions);
        Object.assign(stage, { contextLost: true });
        expect(stage.protectedRegions()).toEqual([]);
      }
    }
    fp.dispose();
  });

  it('reports the actual contact point when visible, rather than making a fixed lower-screen box', () => {
    const { script } = caseScript(deliveryCases()[0]);
    const p = script.practice!;
    const cam = new PerspectiveCamera(60, 2, 0.1, 1200);
    cam.position.set(0, 8, 15);
    cam.lookAt(0, 0, 5);
    cam.updateMatrixWorld();
    const regions = practiceProtectedRegions(p, cam, viewport, undefined, new Group());
    const contact = regions.filter((r) => r.kind === 'contact');
    expect(contact).toHaveLength(1);
    finite(contact);
    cam.position.x = 3;
    cam.updateMatrixWorld();
    const moved = practiceProtectedRegions(p, cam, viewport, undefined, new Group()).find((r) => r.kind === 'contact')!;
    expect(moved.x).not.toBe(contact[0].x);
  });
});
