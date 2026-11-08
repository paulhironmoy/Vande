/**
 * The 3D tiers' overhead ground picture for the field inset (three/pip.ts): one camera pass straight down, only the
 * stadium drawn, every renderer state and every hidden object restored, lights never touched, GL rows flipped so the
 * bowler's end is at the top, and captured again only when the look changes or the inset grows.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import { INSET_GROUND_MAX_PX, InsetGround, insetBlocked, meshBoxRegions } from '@/render3d/three/pip';
import { projectVisibleMeshRegions } from '@/render3d/three/protectedRegions';
import { buildPracticeScript } from '@/render3d/practice/script';
import { autoField, flight as physicsFlight } from '@/physics/index';
import { overBalls } from '@/practice/game/evaluate';
import { REFERENCE_CONDITIONS, REFERENCE_OVER } from '@/practice/game/reference';

function fakeRenderer(px = 4) {
  const state = {
    viewport: new Vector4(0, 0, 640, 360),
    scissor: new Vector4(0, 0, 640, 360),
    scissorTest: false,
    autoClear: true,
    clear: new Color(0x123456),
    alpha: 1,
  };
  const seen: { visible: Record<string, boolean>; scissorTest: boolean; camera: unknown } = {
    visible: {},
    scissorTest: false,
    camera: null,
  };
  let scene: Scene | null = null;
  const r = {
    getDrawingBufferSize: (v: Vector2) => v.set(1280, 720),
    getPixelRatio: () => 2,
    getViewport: (v: Vector4) => v.copy(state.viewport),
    getScissor: (v: Vector4) => v.copy(state.scissor),
    getScissorTest: () => state.scissorTest,
    getClearColor: (c: Color) => c.copy(state.clear),
    getClearAlpha: () => state.alpha,
    setScissorTest: (on: boolean) => void (state.scissorTest = on),
    setViewport: (x: number | Vector4, y?: number, w?: number, h?: number) =>
      void (x instanceof Vector4 ? state.viewport.copy(x) : state.viewport.set(x, y!, w!, h!)),
    setScissor: (x: number | Vector4, y?: number, w?: number, h?: number) =>
      void (x instanceof Vector4 ? state.scissor.copy(x) : state.scissor.set(x, y!, w!, h!)),
    setClearColor: (c: Color | number, a = 1) => {
      state.clear = new Color(c as Color);
      state.alpha = a;
    },
    get autoClear() {
      return state.autoClear;
    },
    set autoClear(v: boolean) {
      state.autoClear = v;
    },
    render: vi.fn((s: Scene, camera: unknown) => {
      scene = s;
      seen.camera = camera;
      seen.scissorTest = state.scissorTest;
      for (const c of s.children) seen.visible[c.name] = c.visible;
    }),
    getCurrentViewport: (v: Vector4) => v.set(0, 0, px, px),
    getContext: () => ({
      RGBA: 1,
      UNSIGNED_BYTE: 2,
      // Row y (GL, bottom-up) is filled with the value y: the picture must come out with row 0 = the top (y = px-1).
      readPixels: (_x: number, _y: number, w: number, h: number, _f: number, _t: number, out: Uint8Array) => {
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set([y, y, y, 255], (y * w + x) * 4);
      },
    }),
  };
  return { r, state, seen, scene: () => scene };
}

function sceneWith() {
  const scene = new Scene();
  const stadium = new Group();
  stadium.name = 'stadium';
  const light = new DirectionalLight();
  light.name = 'light';
  const rig = new Group();
  rig.name = 'rig';
  const ball = new Mesh();
  ball.name = 'ball';
  const off = new Group();
  off.name = 'off';
  off.visible = false;
  scene.add(stadium, light, rig, ball, off);
  return { scene, stadium, light, rig, ball, off };
}

describe('field inset ground (3D tiers)', () => {
  it('draws only the stadium from straight above, the bowler at the top, then restores everything', () => {
    const f = fakeRenderer();
    const s = sceneWith();
    const g = new InsetGround();
    // getImageData/putImageData need a 2D context, which jsdom lacks; the capture reports that it could not keep it.
    const kept = g.capture(f.r as never, s.scene, [s.stadium], 200, 'look-a');
    expect(f.r.render).toHaveBeenCalledTimes(1);
    expect(f.seen.visible).toEqual({ stadium: true, light: true, rig: false, ball: false, off: false });
    expect(f.seen.scissorTest).toBe(true);
    // Restored: visibility (including the one that was already hidden), viewport, scissor, clear colour, auto clear.
    expect([s.rig.visible, s.ball.visible, s.off.visible, s.light.visible]).toEqual([true, true, false, true]);
    expect(f.state.viewport.toArray()).toEqual([0, 0, 640, 360]);
    expect(f.state.scissor.toArray()).toEqual([0, 0, 640, 360]);
    expect(f.state.scissorTest).toBe(false);
    expect(f.state.clear.getHex()).toBe(0x123456);
    expect(f.state.autoClear).toBe(true);
    // Screen up is the bowler's end (−z), screen right +x: the batter's orientation.
    const cam = g.camera;
    const up = new Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const right = new Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const forward = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    expect(up.z).toBeCloseTo(-1, 6);
    expect(right.x).toBeCloseTo(1, 6);
    expect(forward.y).toBeCloseTo(-1, 6);
    expect(typeof kept).toBe('boolean');
  });

  it('asks for a new picture only when the look changes or the inset grows past it', () => {
    const f = fakeRenderer();
    const s = sceneWith();
    const g = new InsetGround();
    expect(g.stale(200, 'a')).toBe(true);
    g.capture(f.r as never, s.scene, [s.stadium], 200, 'a');
    expect(g.stale(200, 'a')).toBe(false);
    expect(g.stale(120, 'a')).toBe(false);
    expect(g.stale(204, 'a')).toBe(false);
    expect(g.stale(260, 'a')).toBe(true);
    expect(g.stale(200, 'b')).toBe(true);
    expect(g.stale(INSET_GROUND_MAX_PX + 500, 'a')).toBe(true);
    g.capture(f.r as never, s.scene, [s.stadium], INSET_GROUND_MAX_PX + 500, 'a');
    expect(g.stale(INSET_GROUND_MAX_PX + 900, 'a')).toBe(false);
  });

  it('restores the scene and the renderer even when the pass throws', () => {
    const f = fakeRenderer();
    f.r.render.mockImplementationOnce(() => {
      throw new Error('lost');
    });
    const s = sceneWith();
    const g = new InsetGround();
    expect(g.capture(f.r as never, s.scene, [s.stadium], 200, 'a')).toBe(false);
    expect([s.rig.visible, s.ball.visible, s.off.visible]).toEqual([true, true, false]);
    expect(f.state.scissorTest).toBe(false);
    expect(g.current()).toBeNull();
  });

  it('flips GL rows so the top of the picture is the bowler’s end', () => {
    const f = fakeRenderer(4);
    const s = sceneWith();
    const g = new InsetGround();
    const puts: Uint8ClampedArray[] = [];
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: (kind: string) => unknown };
    const original = proto.getContext;
    proto.getContext = () => ({
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData: (d: { data: Uint8ClampedArray }) => puts.push(d.data),
    });
    try {
      expect(g.capture(f.r as never, s.scene, [s.stadium], 200, 'a')).toBe(true);
    } finally {
      proto.getContext = original;
    }
    const rows = Array.from({ length: 4 }, (_, y) => puts[0][y * 16]);
    expect(rows).toEqual([3, 2, 1, 0]);
    expect(g.current()?.image.width).toBe(4);
    expect(g.captures).toBe(1);
  });
});

describe('field inset guard: it never covers what the stage protects', () => {
  const b = overBalls(REFERENCE_OVER, REFERENCE_CONDITIONS)[0];
  const field = autoField(b.over.bowler, b.conditions, 'right', b.over.ball);
  const flight = physicsFlight({
    plan: b.flight.plan,
    bowler: b.over.bowler,
    conditions: b.conditions,
    seed: b.seed,
    handedness: 'right',
    ball: b.over.ball,
  });
  const script = buildPracticeScript({
    setup: { field, bowler: b.over.bowler, conditions: b.conditions, handedness: 'right' },
    flight,
  });
  const p = script.practice!;
  const size = { w: 915, h: 412 };
  const camera = new PerspectiveCamera(48, size.w / size.h, 0.1, 1200);
  camera.position.set(p.eye.x, p.eye.y, p.eye.z);
  camera.lookAt(p.releaseWorld.x, p.releaseWorld.y * 0.6, p.releaseWorld.z);
  camera.updateMatrixWorld();

  it('is blocked over the pitch and the ball path down the middle of the batter’s view', () => {
    expect(insetBlocked(p, camera, size, { x: size.w / 2 - 40, y: size.h / 2 - 40, width: 80, height: 80 }, null)).toBe(
      true,
    );
  });

  it('is clear in the top-right corner below the rail, where the inset sits', () => {
    expect(insetBlocked(p, camera, size, { x: 780, y: 94, width: 119, height: 119 }, null)).toBe(false);
  });

  it('counts the bowler, from his drawn root', () => {
    const r = { x: 780, y: 94, width: 119, height: 119 };
    // A bowler whose body centre projects into the middle of the corner rectangle, 30 m from the lens.
    const ndc = new Vector3(
      ((r.x + r.width / 2) / size.w) * 2 - 1,
      1 - ((r.y + r.height / 2) / size.h) * 2,
      0.5,
    ).unproject(camera);
    const into = ndc.sub(camera.position).normalize().multiplyScalar(30).add(camera.position);
    expect(insetBlocked(p, camera, size, r, { x: into.x, y: into.y - 1.1, z: into.z })).toBe(true);
  });
});

describe('field inset guard: the batter’s own bat and gloves', () => {
  const size = { w: 640, h: 360 };
  const camera = new PerspectiveCamera(50, size.w / size.h, 0.05, 500);
  camera.position.set(0, 1.7, 9);
  camera.lookAt(0, 1, -9);
  camera.updateMatrixWorld();
  const firstPerson = () => {
    const g = new Group();
    g.name = 'first-person';
    // A slanted blade below and to the right of the eye, and a forearm reaching in from beside the lens.
    const blade = new Mesh(new BoxGeometry(0.11, 0.86, 0.04), new MeshBasicMaterial());
    blade.position.set(0.3, 1.2, 7.6);
    blade.rotation.set(0.5, 0.2, -0.7);
    const arm = new Mesh(new CylinderGeometry(0.04, 0.05, 0.42, 8), new MeshBasicMaterial());
    arm.position.set(0.25, 1.45, 8.3);
    arm.rotation.set(1.1, 0, -0.4);
    g.add(blade, arm);
    g.updateMatrixWorld(true);
    return g;
  };

  it('each mesh’s box region holds the exact projection of that mesh', () => {
    const g = firstPerson();
    const boxes = meshBoxRegions(g, camera, size);
    const exact = projectVisibleMeshRegions(g, 'bat', camera, size);
    expect(exact.length).toBe(2);
    expect(boxes).toHaveLength(exact.length);
    exact.forEach((e, i) => {
      const b = boxes[i];
      expect(b.x).toBeLessThanOrEqual(e.x + 1e-6);
      expect(b.y).toBeLessThanOrEqual(e.y + 1e-6);
      expect(b.x + b.width).toBeGreaterThanOrEqual(e.x + e.width - 1e-6);
      expect(b.y + b.height).toBeGreaterThanOrEqual(e.y + e.height - 1e-6);
    });
  });

  it('blocks the inset where the bat is drawn, and not where it is not; a hidden first person blocks nothing', () => {
    const g = firstPerson();
    const b = meshBoxRegions(g, camera, size)[0];
    const p = { releaseWorld: { x: 0, y: -50, z: 400 }, flight: null, result: null, mirror: false } as never;
    expect(insetBlocked(p, camera, size, { x: b.x + 1, y: b.y + 1, width: 4, height: 4 }, null, g)).toBe(true);
    expect(insetBlocked(p, camera, size, { x: 520, y: 4, width: 20, height: 20 }, null, g)).toBe(false);
    // Inside a mesh's box but off the mesh itself (the blade is slanted, its box is not): not blocked.
    const blade = g.children[0] as Mesh;
    const exact = projectVisibleMeshRegions(blade, 'bat', camera, size)[0];
    const boxed = meshBoxRegions(blade, camera, size)[0];
    if (boxed.x < exact.x - 6)
      expect(
        insetBlocked(
          p,
          camera,
          size,
          { x: boxed.x, y: exact.y + exact.height / 2, width: Math.max(1, exact.x - boxed.x - 2), height: 2 },
          null,
          blade,
        ),
      ).toBe(false);
    g.visible = false;
    expect(meshBoxRegions(g, camera, size)).toEqual([]);
  });
});
