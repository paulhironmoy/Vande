/**
 * The field inset's ground on the 3D tiers (Premium and Balanced): a second camera straight above the field renders
 * the real stadium's ground (the grass and its mowing, the pitch for the conditions, the creases and stumps, the rope
 * and the boards) into a corner of the drawing buffer, and the picture is read back once and kept. The 2D inset
 * painter (fallback2d/topDown.ts) draws it under the players and the ball, which it places from the physics on every
 * frame.
 *
 * Why overhead, and why the players are markers: from straight above every fielder is visible at one scale with no
 * occlusion and no perspective, the bearings and distances read as a field chart, and the batter's orientation is
 * kept (the bowler at the top). A broadcast high-wide angle hides the keeper and the slips behind the batter and
 * shrinks the far side. At inset scale (about 1 px per metre on a 640×360 screen) a 0.5 m wide player model is under
 * one pixel, so the rigs, the ball and the effects are left out of this pass and drawn as markers instead.
 *
 * Why read back instead of a pass every frame: the ground does not change during a delivery. Rendering it again on
 * every frame would double the scene's culling and draw cost for an identical picture. It is captured between balls
 * (never during a delivery) whenever the inset's size, the tier or the stadium's look changes. The camera never
 * moves, so Reduced Motion needs nothing more.
 */
import { Box3, Color, OrthographicCamera, Vector2, Vector3, Vector4, type Mesh, type Object3D, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three';
import type { Vec3 } from '@/contracts/practice';
import { BLADE_HALF_W, GLOVE_R } from '@/physics/constants';
import { BALL_R, PITCH_HALF, PITCH_WIDTH } from '../core/ground';
import { INSET_FIELD_R } from '../fallback2d/topDown';
import { ballAt, toWorld } from '../practice/frame';
import type { PracticeInfo } from '../practice/script';
import type { ProtectedRegion } from '../practice/types';
import { projectBallPathRegions, projectEnvelopeRegion, projectPolygonRegion, projectVisibleMeshRegions, type ProjectionViewport } from './protectedRegions';

/** The largest picture kept (device px a side): enough for a 160 CSS px inset at 2×. */
export const INSET_GROUND_MAX_PX = 320;

export class InsetGround {
  /** Straight down onto the pitch's centre; screen up is the bowler's end (−z), screen right is +x. */
  readonly camera = new OrthographicCamera(-INSET_FIELD_R, INSET_FIELD_R, INSET_FIELD_R, -INSET_FIELD_R, -400, 40);
  private picture: { image: HTMLCanvasElement; key: string } | null = null;
  private look = '';
  private px = 0;
  /** Captures made (for tests and the evidence). */
  captures = 0;

  constructor() {
    // Just above the grass with a near plane far behind it: the view depth of the ground is 3 m, so the stadium's
    // distance fog never washes the picture, and nothing above the field is clipped away.
    this.camera.position.set(0, 3, 0);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld(true);
  }

  /** The last captured ground, for the painter. */
  current(): { image: HTMLCanvasElement; key: string } | null {
    return this.picture;
  }

  /**
   * True when a capture is still needed: the stadium's look changed, or the inset grew past the picture's size (a
   * smaller inset just scales the picture down, so the run-up's quieter inset never asks for one).
   */
  stale(px: number, look: string): boolean {
    return look !== this.look || Math.min(px, INSET_GROUND_MAX_PX) > this.px + 8;
  }

  /**
   * Renders the ground from above into the bottom-left corner of the drawing buffer and reads it back. Only the
   * objects in `keep` (the stadium) are drawn: every other child of the scene (players, bats, ball, stumps, effects,
   * the first-person gloves, overlays) is hidden for the pass, and lights are never touched (a light's visibility
   * changes the shader programs). Call it before the frame's own render, which then clears the whole buffer: nothing of it is ever seen
   * there. Every renderer state it changes is restored. Returns true when it captured.
   */
  capture(renderer: WebGLRenderer, scene: Scene, keep: readonly Object3D[], px: number, look: string): boolean {
    // Asked once per look and size, whatever happens below (a failed read is not retried every frame).
    this.look = look;
    this.px = Math.min(px, INSET_GROUND_MAX_PX);
    const buffer = renderer.getDrawingBufferSize(new Vector2());
    const side = Math.floor(Math.min(px, INSET_GROUND_MAX_PX, buffer.x, buffer.y));
    if (side < 16) return false;
    const ratio = renderer.getPixelRatio();
    const viewport = renderer.getViewport(new Vector4());
    const scissor = renderer.getScissor(new Vector4());
    const scissorTest = renderer.getScissorTest();
    const autoClear = renderer.autoClear;
    const clearColor = renderer.getClearColor(new Color());
    const clearAlpha = renderer.getClearAlpha();
    const hidden: Object3D[] = [];
    for (const child of scene.children) {
      if (keep.includes(child) || !child.visible || (child as { isLight?: boolean }).isLight) continue;
      child.visible = false;
      hidden.push(child);
    }
    let pixels: Uint8Array | null;
    let w = 0;
    let h = 0;
    try {
      renderer.setScissorTest(true);
      renderer.setViewport(0, 0, side / ratio, side / ratio);
      renderer.setScissor(0, 0, side / ratio, side / ratio);
      renderer.setClearColor(0x0b0d12, 1);
      renderer.autoClear = true;
      renderer.render(scene, this.camera);
      const vp = renderer.getCurrentViewport(new Vector4());
      w = Math.round(vp.z);
      h = Math.round(vp.w);
      const gl = renderer.getContext();
      pixels = new Uint8Array(w * h * 4);
      gl.readPixels(Math.round(vp.x), Math.round(vp.y), w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    } catch {
      pixels = null;
    } finally {
      for (const child of hidden) child.visible = true;
      renderer.setClearColor(clearColor, clearAlpha);
      renderer.autoClear = autoClear;
      renderer.setViewport(viewport);
      renderer.setScissor(scissor);
      renderer.setScissorTest(scissorTest);
    }
    if (!pixels || w < 1 || h < 1 || typeof document === 'undefined') return false;
    const image = document.createElement('canvas');
    image.width = w;
    image.height = h;
    const g = image.getContext('2d');
    if (!g) return false;
    // GL rows run bottom-up: flip them, so the bowler's end is at the top of the picture.
    const data = g.createImageData(w, h);
    const row = w * 4;
    for (let y = 0; y < h; y++) data.data.set(pixels.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    g.putImageData(data, 0, 0);
    this.captures++;
    this.picture = { image, key: `ground:${this.captures}` };
    return true;
  }

  dispose(): void {
    this.picture = null;
    this.look = '';
    this.px = 0;
  }
}

/** The bowler for the guard: an envelope round his drawn root, generous enough to hold his whole action. */
const BOWLER_ENVELOPE = { aboveRoot: 1.1, radius: 1.3 } as const;

/** The ball's path to the bat (world), as the stage protects it, sampled once per script. */
const pathCache = new WeakMap<PracticeInfo, Vec3[]>();
function protectedPath(p: PracticeInfo): Vec3[] {
  let out = pathCache.get(p);
  if (out) return out;
  out = [];
  if (p.flight) {
    const contact = p.result?.contact;
    const end = contact?.point && contact.t !== null ? contact.t : p.flight.stumpsT;
    const samples = p.flight.samples.filter((s) => s.t < end);
    // Every third sample: a few milliseconds of flight, well inside the ball's own padding.
    for (let i = 0; i < samples.length; i += 3) out.push(toWorld(samples[i].p, p.mirror));
    const last = ballAt(p.flight.samples, end);
    if (last) out.push(toWorld(last, p.mirror));
  }
  pathCache.set(p, out);
  return out;
}

/**
 * Whether anything the stage protects reaches the inset's rectangle (CSS px in the canvas) through this frame's camera:
 * the batter's own bat and gloves (first person), the pitch, the ball's path to the bat, the release, the contact and
 * the bowler. Measured on the batter's-eye views
 * the inset never meets them; the fielding camera can sweep the pitch through a corner (a left-hander's last frames
 * before the dead ball). The same projections as the stage's own regions (protectedRegions.ts), with the bowler's mesh
 * replaced by an envelope round his drawn root, and each first-person mesh measured exactly only when its oriented
 * bounding box reaches the inset, so it is cheap enough for every frame. The first hit answers.
 */
export function insetBlocked(p: PracticeInfo, camera: PerspectiveCamera, size: ProjectionViewport, rect: { x: number; y: number; width: number; height: number }, bowler: Vec3 | null, firstPerson: Object3D | null = null): boolean {
  const hit = (r: ProtectedRegion | null) => r !== null && r.x < rect.x + rect.width && rect.x < r.x + r.width && r.y < rect.y + rect.height && rect.y < r.y + r.height;
  // The batter's own bat, gloves and forearms (the stage's 'bat' regions), whatever shape they are drawn in: each
  // mesh's oriented box first (cheap); only a mesh whose box reaches the inset is measured exactly, vertex by vertex,
  // as the stage measures it, so a forearm's box corner never hides the inset where the arm itself is not.
  if (firstPerson) {
    for (const { mesh, region } of meshBoxes(firstPerson, camera, size)) {
      if (hit(region) && projectVisibleMeshRegions(mesh, 'bat', camera, size).some(hit)) return true;
    }
  }
  if (hit(projectEnvelopeRegion(p.releaseWorld, BALL_R + GLOVE_R, 'release', camera, size))) return true;
  if (bowler && hit(projectEnvelopeRegion({ x: bowler.x, y: bowler.y + BOWLER_ENVELOPE.aboveRoot, z: bowler.z }, BOWLER_ENVELOPE.radius, 'bowler', camera, size))) return true;
  const strips = Math.ceil((PITCH_HALF * 2) / 0.5);
  for (let i = 0; i < strips; i++) {
    const z0 = -PITCH_HALF + (i * 2 * PITCH_HALF) / strips;
    const z1 = -PITCH_HALF + ((i + 1) * 2 * PITCH_HALF) / strips;
    const strip = [
      { x: -PITCH_WIDTH / 2, y: 0, z: z0 },
      { x: PITCH_WIDTH / 2, y: 0, z: z0 },
      { x: PITCH_WIDTH / 2, y: 0, z: z1 },
      { x: -PITCH_WIDTH / 2, y: 0, z: z1 },
    ];
    if (hit(projectPolygonRegion(strip, 'pitch', camera, size))) return true;
  }
  if (p.flight) {
    for (const r of projectBallPathRegions(protectedPath(p), camera, size)) if (hit(r)) return true;
    const contact = p.result?.contact;
    const meet = contact?.point ?? ballAt(p.flight.samples, p.flight.idealContactT);
    if (meet && hit(projectEnvelopeRegion(toWorld(meet, p.mirror), BALL_R + BLADE_HALF_W, 'contact', camera, size))) return true;
  }
  return false;
}

const FACES = [
  [0, 1, 3, 2],
  [4, 6, 7, 5],
  [0, 4, 5, 1],
  [2, 3, 7, 6],
  [0, 2, 6, 4],
  [1, 5, 7, 3],
] as const;
const corner = Array.from({ length: 8 }, () => new Vector3());
const box = new Box3();

/**
 * One screen rectangle per visible mesh under `root`: its geometry's bounding box in the mesh's own frame, carried to
 * the world by the mesh's matrix (an oriented box, so a slanted bat or forearm stays tight), its six faces clipped to
 * the view frustum and projected (protectedRegions.ts projectPolygonRegion). It always contains the mesh's own
 * projection, at the cost of six small polygons per mesh instead of every vertex.
 */
export function meshBoxRegions(root: Object3D, camera: PerspectiveCamera, size: ProjectionViewport): ProtectedRegion[] {
  return meshBoxes(root, camera, size).map((b) => b.region);
}

function meshBoxes(root: Object3D, camera: PerspectiveCamera, size: ProjectionViewport): Array<{ mesh: Mesh; region: ProtectedRegion }> {
  for (let o: Object3D | null = root; o; o = o.parent) if (!o.visible) return [];
  root.updateWorldMatrix(true, true);
  const out: Array<{ mesh: Mesh; region: ProtectedRegion }> = [];
  root.traverseVisible((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    box.copy(mesh.geometry.boundingBox!);
    if (box.isEmpty()) return;
    for (let i = 0; i < 8; i++) corner[i].set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(mesh.matrixWorld);
    let r: ProtectedRegion | null = null;
    for (const face of FACES) {
      const f = projectPolygonRegion(face.map((i) => corner[i]), 'bat', camera, size);
      if (!f) continue;
      if (!r) r = { ...f };
      else {
        const x1 = Math.max(r.x + r.width, f.x + f.width);
        const y1 = Math.max(r.y + r.height, f.y + f.height);
        r.x = Math.min(r.x, f.x);
        r.y = Math.min(r.y, f.y);
        r.width = x1 - r.x;
        r.height = y1 - r.y;
      }
    }
    if (r) out.push({ mesh, region: r });
  });
  return out;
}
