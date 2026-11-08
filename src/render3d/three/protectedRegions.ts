/**
 * Readability geometry, measured through the camera that actually drew the frame. These are conservative CSS-pixel
 * bounds, not HUD-safe reservations. Nothing here knows where the interface is. Offscreen/hidden geometry contributes
 * nothing; geometry crossing the near plane is clipped before perspective division. Called on demand, not per frame.
 */
import { Vector3, Vector4, type Mesh, type Object3D, type PerspectiveCamera, type SkinnedMesh } from 'three';
import type { Vec3 } from '@/contracts/practice';
import { BLADE_HALF_W, GLOVE_R } from '@/physics/constants';
import { BALL_R, PITCH_HALF, PITCH_WIDTH } from '../core/ground';
import { ballDiameterPx, PRACTICE_BALL } from '../practice/ballLook';
import { ballAt, toWorld } from '../practice/frame';
import type { PracticeInfo } from '../practice/script';
import type { ProtectedRegion, ProtectedRegionKind } from '../practice/types';
import type { PlayerRig } from './players';

export interface ProjectionViewport {
  w: number;
  h: number;
}

/** Homogeneous clip-space half-spaces: a point is visible when every signed distance is non-negative. */
const CLIP_PLANES = [
  (p: Vector4) => p.w + p.x,
  (p: Vector4) => p.w - p.x,
  (p: Vector4) => p.w + p.y,
  (p: Vector4) => p.w - p.y,
  (p: Vector4) => p.w + p.z,
  (p: Vector4) => p.w - p.z,
] as const;

/** A single connected piece. Only the viewport, never a HUD rectangle, clips its result. */
class ProjectedPiece {
  private minX = Infinity;
  private minY = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;
  constructor(
    private camera: PerspectiveCamera,
    private size: ProjectionViewport,
  ) {}

  view(p: Vec3): Vector3 {
    return new Vector3(p.x, p.y, p.z).applyMatrix4(this.camera.matrixWorldInverse);
  }

  point(p: Vector3): void {
    if (p.z > -this.camera.near || p.z < -this.camera.far) return;
    const q = p.clone().applyMatrix4(this.camera.projectionMatrix);
    const x = ((q.x + 1) * this.size.w) / 2;
    const y = ((1 - q.y) * this.size.h) / 2;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.minX = Math.min(this.minX, x);
    this.minY = Math.min(this.minY, y);
    this.maxX = Math.max(this.maxX, x);
    this.maxY = Math.max(this.maxY, y);
  }

  /**
   * Clips one convex camera-space polygon to the complete view frustum before perspective division. This must happen
   * per connected primitive: aggregating an offscreen triangle with a visible one first creates a rectangle over empty
   * screen space (for example an off-right bat blade plus its visible lower-right grip).
   */
  polygon(points: readonly Vector3[]): void {
    let clipped = points.map((p) => new Vector4(p.x, p.y, p.z, 1).applyMatrix4(this.camera.projectionMatrix));
    for (const distance of CLIP_PLANES) {
      if (!clipped.length) return;
      const next: Vector4[] = [];
      let previous = clipped[clipped.length - 1];
      let previousDistance = distance(previous);
      let previousInside = previousDistance >= 0;
      for (const current of clipped) {
        const currentDistance = distance(current);
        const currentInside = currentDistance >= 0;
        if (currentInside !== previousInside) {
          const denominator = previousDistance - currentDistance;
          if (Math.abs(denominator) > 1e-12) next.push(previous.clone().lerp(current, previousDistance / denominator));
        }
        if (currentInside) next.push(current);
        previous = current;
        previousDistance = currentDistance;
        previousInside = currentInside;
      }
      clipped = next;
    }
    for (const p of clipped) {
      if (!(p.w > 0) || !Number.isFinite(p.w)) continue;
      const x = ((p.x / p.w + 1) * this.size.w) / 2;
      const y = ((1 - p.y / p.w) * this.size.h) / 2;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      this.minX = Math.min(this.minX, x);
      this.minY = Math.min(this.minY, y);
      this.maxX = Math.max(this.maxX, x);
      this.maxY = Math.max(this.maxY, y);
    }
  }

  /** Clip a camera-space edge against both depth planes, including an edge with neither endpoint inside. */
  edge(a: Vector3, b: Vector3): void {
    let lo = 0;
    let hi = 1;
    const dz = b.z - a.z;
    if (Math.abs(dz) < 1e-12) {
      if (a.z > -this.camera.near || a.z < -this.camera.far) return;
    } else {
      const tNear = (-this.camera.near - a.z) / dz;
      const tFar = (-this.camera.far - a.z) / dz;
      lo = Math.max(lo, Math.min(tNear, tFar));
      hi = Math.min(hi, Math.max(tNear, tFar));
      if (lo > hi) return;
    }
    const add = (t: number) => {
      const p = a.clone().lerp(b, t);
      // Rounding at a clipped endpoint must not put it fractionally behind its own depth plane.
      p.z = Math.max(-this.camera.far, Math.min(-this.camera.near, p.z));
      this.point(p);
    };
    add(lo);
    add(hi);
  }

  region(kind: ProtectedRegionKind, paddingPx = 0): ProtectedRegion | null {
    const x = Math.max(0, this.minX - paddingPx);
    const y = Math.max(0, this.minY - paddingPx);
    const right = Math.min(this.size.w, this.maxX + paddingPx);
    const bottom = Math.min(this.size.h, this.maxY + paddingPx);
    return right > x && bottom > y ? { kind, x, y, width: right - x, height: bottom - y } : null;
  }
}

/** Convex world polygon, clipped to the complete view frustum before its perspective bounds are measured. */
export function projectPolygonRegion(
  points: readonly Vec3[],
  kind: ProtectedRegionKind,
  camera: PerspectiveCamera,
  size: ProjectionViewport,
): ProtectedRegion | null {
  const piece = new ProjectedPiece(camera, size);
  const view = points.map((p) => piece.view(p));
  piece.polygon(view);
  return piece.region(kind);
}

/** A physical ball/hand/contact envelope, not a screen-space composition guess. */
export function projectEnvelopeRegion(
  centre: Vec3,
  radius: number,
  kind: ProtectedRegionKind,
  camera: PerspectiveCamera,
  size: ProjectionViewport,
): ProtectedRegion | null {
  const piece = new ProjectedPiece(camera, size);
  const corners = Array.from({ length: 8 }, (_, i) =>
    piece.view({
      x: centre.x + (i & 1 ? radius : -radius),
      y: centre.y + (i & 2 ? radius : -radius),
      z: centre.z + (i & 4 ? radius : -radius),
    }),
  );
  // Faces, rather than only edges: a large face can enclose the viewport without any box edge entering the frustum.
  for (const face of [
    [0, 1, 3, 2],
    [4, 6, 7, 5],
    [0, 4, 5, 1],
    [2, 3, 7, 6],
    [0, 2, 6, 4],
    [1, 5, 7, 3],
  ])
    piece.polygon(face.map((i) => corners[i]));
  return piece.region(kind);
}

/**
 * Each visible mesh gets its own region. getVertexPosition applies skinning/morphs, so a moving hand or bat changes
 * the reported rectangle. Inactive LODs, hidden ancestors and invisible materials are excluded. The optional vertex
 * predicate excludes shader-collapsed player variants (hair/headgear), which are not actually drawn.
 */
export function projectVisibleMeshRegions(
  root: Object3D,
  kind: ProtectedRegionKind,
  camera: PerspectiveCamera,
  size: ProjectionViewport,
  visibleVertex?: (mesh: Mesh, index: number) => boolean,
): ProtectedRegion[] {
  for (let p: Object3D | null = root; p; p = p.parent) if (!p.visible) return [];
  root.updateWorldMatrix(true, false);
  // updateMatrixWorld also runs SkinnedMesh's attached-bind inverse update (updateWorldMatrix alone does not).
  root.updateMatrixWorld(true);
  const regions: ProtectedRegion[] = [];
  root.traverseVisible((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || !mesh.geometry.attributes.position) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.every((material) => !material.visible)) return;
    if ((mesh as SkinnedMesh).isSkinnedMesh) (mesh as SkinnedMesh).skeleton.update();
    const piece = new ProjectedPiece(camera, size);
    const vertices: Array<Vector3 | null> = Array.from({ length: mesh.geometry.attributes.position.count }, (_, i) => {
      if (visibleVertex && !visibleVertex(mesh, i)) return null;
      const world = mesh.getVertexPosition(i, new Vector3()).applyMatrix4(mesh.matrixWorld);
      return piece.view(world);
    });
    const index = mesh.geometry.index;
    const available = index ? index.count : vertices.length;
    const start = mesh.geometry.drawRange.start;
    const end = Math.min(available, start + mesh.geometry.drawRange.count);
    const vertex = (i: number) => vertices[index ? index.getX(i) : i];
    for (let i = start; i + 2 < end; i += 3) {
      const a = vertex(i),
        b = vertex(i + 1),
        c = vertex(i + 2);
      if (!a || !b || !c) continue;
      piece.polygon([a, b, c]);
    }
    const region = piece.region(kind);
    if (region) regions.push(region);
  });
  return regions;
}

/** Same active-variant selection as players.ts PLAYER_VARIANTS; a bowler has no hair-under-headgear deformation. */
function bowlerVertexVisible(rig: PlayerRig, mesh: Mesh, index: number): boolean {
  const variant = mesh.geometry.attributes.aVar?.getX(index) ?? 0;
  const group = Math.floor(variant / 10 + 0.001);
  const option = variant - group * 10;
  if (group === 1) return Math.abs(option - rig.uniforms.uHairStyle.value) <= 0.5;
  if (group === 2) return rig.uniforms.uBeardMesh.value >= 0.5;
  if (group >= 3) return Math.abs(option - rig.uniforms.uHeadgear.value) <= 0.5;
  return true;
}

/** Protect each physical sample-to-sample segment, not the huge empty rectangle around a curving trajectory. */
export function projectBallPathRegions(
  points: readonly Vec3[],
  camera: PerspectiveCamera,
  size: ProjectionViewport,
): ProtectedRegion[] {
  const focal = (Math.abs(camera.projectionMatrix.elements[5]) * size.h) / 2;
  const regions: ProtectedRegion[] = [];
  for (let i = 1; i < points.length; i++) {
    const piece = new ProjectedPiece(camera, size);
    const a = piece.view(points[i - 1]),
      b = piece.view(points[i]);
    piece.edge(a, b);
    const depth = Math.max(camera.near, Math.min(-a.z, -b.z));
    const region = piece.region('ball_path', ballDiameterPx(depth, focal) / 2 + PRACTICE_BALL.shade.rimPx);
    if (region) regions.push(region);
  }
  return regions;
}

export function practiceProtectedRegions(
  p: PracticeInfo,
  camera: PerspectiveCamera,
  size: ProjectionViewport,
  bowler: PlayerRig | undefined,
  firstPerson: Object3D,
): ProtectedRegion[] {
  const regions: ProtectedRegion[] = [];
  const add = (region: ProtectedRegion | null) => {
    if (region) regions.push(region);
  };
  if (bowler)
    regions.push(
      ...projectVisibleMeshRegions(bowler.root, 'bowler', camera, size, (mesh, i) =>
        bowlerVertexVisible(bowler, mesh, i),
      ),
    );
  regions.push(...projectVisibleMeshRegions(firstPerson, 'bat', camera, size));
  add(projectEnvelopeRegion(p.releaseWorld, BALL_R + GLOVE_R, 'release', camera, size));
  // Thin strips preserve the pitch's projected trapezoid, instead of reserving empty space beside its far end.
  const strips = Math.ceil((PITCH_HALF * 2) / 0.5);
  for (let i = 0; i < strips; i++) {
    const z0 = -PITCH_HALF + (i * 2 * PITCH_HALF) / strips;
    const z1 = -PITCH_HALF + ((i + 1) * 2 * PITCH_HALF) / strips;
    add(
      projectPolygonRegion(
        [
          { x: -PITCH_WIDTH / 2, y: 0, z: z0 },
          { x: PITCH_WIDTH / 2, y: 0, z: z0 },
          { x: PITCH_WIDTH / 2, y: 0, z: z1 },
          { x: -PITCH_WIDTH / 2, y: 0, z: z1 },
        ],
        'pitch',
        camera,
        size,
      ),
    );
  }
  if (p.flight) {
    const contact = p.result?.contact;
    const end = contact?.point && contact.t !== null ? contact.t : p.flight.stumpsT;
    const points = p.flight.samples.filter((sample) => sample.t < end).map((sample) => toWorld(sample.p, p.mirror));
    const last = ballAt(p.flight.samples, end);
    if (last) points.push(toWorld(last, p.mirror));
    regions.push(...projectBallPathRegions(points, camera, size));
    const meet = contact?.point ?? ballAt(p.flight.samples, p.flight.idealContactT);
    if (meet) add(projectEnvelopeRegion(toWorld(meet, p.mirror), BALL_R + BLADE_HALF_W, 'contact', camera, size));
  }
  return regions;
}
