/**
 * Practice's 3D overlays. Live: the Learn landing cue (where the ball will pitch, from its release on; never a
 * permanent marker, never outside Learn). Replay: the diagnostics — the ball's incoming path (cyan) and where it
 * pitched, its outgoing path (amber), the timing window along the path when known (green: solid, bright: perfect),
 * the ideal contact (white ring) against the actual contact (gold), the bat's sweet-spot path (pink) with ghost bats,
 * the bat face at contact (mint arrow), and the intended direction (white dashes) against the actual one (amber).
 * Each part appears as the replay reaches it. Geometry only: the HUD over the canvas does the words.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
  type Scene,
  type Texture,
} from 'three';
import type { TimingBands } from '@/contracts/practice';
import { BALL_R, PITCH_HALF } from '../core/ground';
import { STUMPS_TOP, STUMPS_W } from '@/physics/constants';
import type { Vec3 } from '../core/math';
import { revealed, type Diagnostics } from '../practice/diagnostics';
import { createBat, placeBatSpan } from './props';

export interface PracticeOverlays {
  group: Group;
  /**
   * First person: the contact happens almost under the eyes, below the view, so its flash is shown at the bottom edge
   * of the view where the contact is (clamped inside it), keyed to the contact's scene time like its sound.
   */
  edgeFlash(script: { events: ReadonlyArray<{ t: number; kind: string; intensity: number; at?: Vec3 }> } | null, t: number, camera: PerspectiveCamera | null): void;
  /** Learn's landing cue: shown from release until just after the pitch (live only). */
  landing(at: Vec3 | null, t: number, releaseScene: number, bounceScene: number | null): void;
  /** Builds the replay overlays (null clears them). */
  setDiagnostics(d: Diagnostics | null, bands?: TimingBands | null): void;
  /** Reveals the replay overlays up to scene time t. */
  update(t: number): void;
  /** Every part visible (for shader pre-compilation). */
  showAll(): void;
  hideAll(): void;
  dispose(): void;
}

const UP = new Vector3(0, 1, 0);
const tq = new Quaternion();

/** A tube along a polyline, one ring of `radial` vertices per point, so point i's segment is index-ranged i. */
function polylineTube(points: readonly Vec3[], radius: number, radial = 6): BufferGeometry {
  const n = points.length;
  const pos = new Float32Array(Math.max(1, n) * radial * 3);
  const t = new Vector3();
  const nrm = new Vector3();
  const bin = new Vector3();
  const ref = new Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    t.set(b.x - a.x, b.y - a.y, b.z - a.z);
    if (t.lengthSq() < 1e-12) t.set(0, 0, 1);
    t.normalize();
    ref.set(0, 1, 0);
    if (Math.abs(t.dot(ref)) > 0.95) ref.set(1, 0, 0);
    nrm.crossVectors(t, ref).normalize();
    bin.crossVectors(t, nrm).normalize();
    for (let r = 0; r < radial; r++) {
      const ang = (r / radial) * Math.PI * 2;
      const c = Math.cos(ang) * radius;
      const s = Math.sin(ang) * radius;
      const k = (i * radial + r) * 3;
      pos[k] = points[i].x + nrm.x * c + bin.x * s;
      pos[k + 1] = points[i].y + nrm.y * c + bin.y * s;
      pos[k + 2] = points[i].z + nrm.z * c + bin.z * s;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let r = 0; r < radial; r++) {
      const a = i * radial + r;
      const b = i * radial + ((r + 1) % radial);
      const c = (i + 1) * radial + r;
      const d = (i + 1) * radial + ((r + 1) % radial);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.setDrawRange(0, 0);
  return g;
}

/** Shows the first `count` points of a polyline tube. */
function reveal(g: BufferGeometry, count: number, radial = 6) {
  g.setDrawRange(0, Math.max(0, count - 1) * radial * 6);
}

export function createOverlays(scene: Scene, flashMap: Texture | null = null): PracticeOverlays {
  const group = new Group();
  group.name = 'practice-overlays';
  scene.add(group);
  const basic = (color: string, opacity = 0.9, additive = false) =>
    new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, fog: false, side: DoubleSide, ...(additive ? { blending: AdditiveBlending } : {}) });
  const mats = {
    incoming: basic('#52e2ff', 0.85),
    outgoing: basic('#ffb347', 0.85),
    window: basic('#5dff9b', 0.32, true),
    perfect: basic('#c9ffd9', 0.55, true),
    bat: basic('#ff7ad9', 0.85),
    ideal: new MeshBasicMaterial({ color: '#ffffff', wireframe: true, transparent: true, opacity: 0.9, depthWrite: false, fog: false }),
    contact: basic('#ffcf5a', 1),
    face: basic('#7ef0c5', 0.95),
    intended: basic('#ffffff', 0.85),
    actual: basic('#ffb347', 0.9),
    ring: basic('#52e2ff', 0.9, true),
    landing: basic('#7ef0c5', 0.9, true),
    ghost: new MeshStandardMaterial({ color: '#e3c48e', transparent: true, opacity: 0.22, depthWrite: false, roughness: 0.6 }),
    body: basic('#ffffff', 0.16),
    lbwOut: basic('#ff4d6a', 0.9),
    lbwNot: basic('#ffffff', 0.85),
    stumps: basic('#ffffff', 0.12),
  };
  const ringGeo = new RingGeometry(0.075, 0.12, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const markerGeo = new SphereGeometry(BALL_R * 1.55, 14, 10);
  const shaftGeo = new CylinderGeometry(1, 1, 1, 8);
  shaftGeo.translate(0, 0.5, 0);
  const headGeo = new ConeGeometry(1, 1, 10);
  headGeo.translate(0, 0.5, 0);
  const batGeoSource = createBat();

  // Live: the contact flash at the edge of the view.
  const flashMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending, fog: false });
  const flashGeo = new PlaneGeometry(1, 1);
  const flashMesh = new Mesh(flashGeo, flashMat);
  flashMesh.visible = false;
  flashMesh.renderOrder = 10;
  flashMesh.frustumCulled = false;
  group.add(flashMesh);
  const ndcV = new Vector3();
  const FLASH_COLOR: Record<string, string> = { bat: '#fff6d8', edge: '#d8f6ff', pad: '#aab4c8' };

  // Live: the landing cue.
  const landing = new Mesh(ringGeo, mats.landing);
  landing.visible = false;
  landing.renderOrder = 3;
  group.add(landing);

  // Replay parts (rebuilt per replay).
  const parts = new Group();
  group.add(parts);
  let d: Diagnostics | null = null;
  let tubes: Array<{ g: BufferGeometry; times: number[] }> = [];
  let markers: Array<{ m: { visible: boolean }; at: number }> = [];
  let built: BufferGeometry[] = [];
  // One tiny mesh per material, shown only while the stage pre-compiles its shaders.
  const warm = new Group();
  for (const m of Object.values(mats)) warm.add(new Mesh(markerGeo, m));
  warm.visible = false;
  group.add(warm);

  const arrow = (from: Vec3, dir: Vec3, length: number, radius: number, mat: MeshBasicMaterial, at: number) => {
    const g = new Group();
    const shaft = new Mesh(shaftGeo, mat);
    const head = new Mesh(headGeo, mat);
    const v = new Vector3(dir.x, dir.y, dir.z).normalize();
    tq.setFromUnitVectors(UP, v);
    shaft.scale.set(radius, Math.max(0.01, length - radius * 6), radius);
    head.scale.set(radius * 3, radius * 6, radius * 3);
    head.position.copy(v.clone().multiplyScalar(length - radius * 6));
    shaft.quaternion.copy(tq);
    head.quaternion.copy(tq);
    g.add(shaft, head);
    g.position.set(from.x, from.y, from.z);
    parts.add(g);
    markers.push({ m: g, at });
  };

  const clear = () => {
    for (const g of built) g.dispose();
    built = [];
    tubes = [];
    markers = [];
    parts.clear();
  };

  return {
    group,
    edgeFlash(script, t, camera) {
      flashMesh.visible = false;
      if (!script || !camera) return;
      for (const e of script.events) {
        const dt = t - e.t;
        if (dt < 0 || dt > 220 || !e.at || (e.kind !== 'bat' && e.kind !== 'edge' && e.kind !== 'pad')) continue;
        ndcV.set(e.at.x, e.at.y, e.at.z).project(camera);
        // Inside the view the scene's own flash shows it; only an off-screen contact needs the edge flash.
        const inside = ndcV.z < 1 && Math.abs(ndcV.x) <= 1 && Math.abs(ndcV.y) <= 1;
        if (inside) return;
        const behind = ndcV.z >= 1;
        const x = Math.max(-0.85, Math.min(0.85, behind ? -ndcV.x : ndcV.x));
        ndcV.set(x, -0.93, 0.2).unproject(camera);
        const u = dt / 220;
        flashMesh.visible = true;
        flashMesh.position.copy(ndcV);
        flashMesh.quaternion.copy(camera.quaternion);
        const d = ndcV.distanceTo(camera.position);
        const size = d * (e.kind === 'bat' ? 0.55 : 0.32) * (0.6 + e.intensity * 0.6) * (0.7 + u * 0.6);
        flashMesh.scale.set(size * 1.8, size, 1);
        flashMat.color.set(FLASH_COLOR[e.kind]);
        flashMat.map = flashMap;
        flashMat.opacity = (1 - u) * (e.kind === 'bat' ? 0.95 : 0.6);
        return;
      }
    },
    landing(at, t, releaseScene, bounceScene) {
      if (!at || t < releaseScene) {
        landing.visible = false;
        return;
      }
      const until = (bounceScene ?? releaseScene + 600) + 260;
      landing.visible = t < until;
      if (!landing.visible) return;
      landing.position.set(at.x, 0.03, at.z);
      const fade = t > until - 260 ? (until - t) / 260 : 1;
      mats.landing.opacity = 0.85 * fade;
      landing.scale.setScalar(1 + 0.15 * Math.sin((t - releaseScene) * 0.012));
    },
    setDiagnostics(next, bands) {
      clear();
      d = next;
      if (!d) return;
      const tube = (points: Vec3[], times: number[], radius: number, mat: MeshBasicMaterial) => {
        if (points.length < 2) return;
        const g = polylineTube(points, radius);
        built.push(g);
        const m = new Mesh(g, mat);
        m.frustumCulled = false;
        m.renderOrder = 4;
        parts.add(m);
        tubes.push({ g, times });
      };
      tube(d.incoming, d.incomingT, 0.012, mats.incoming);
      tube(d.outgoing, d.outgoingT, 0.012, mats.outgoing);
      tube(d.batPath, d.batPathT, 0.01, mats.bat);
      if (bands) {
        // The timing window along the incoming path: where the ball was while a swing would still be solid / perfect.
        const pick = (ms: number) => {
          const pts: Vec3[] = [];
          const ts: number[] = [];
          d!.incoming.forEach((p, i) => {
            if (Math.abs(d!.incomingT[i] - d!.times.ideal) <= ms) {
              pts.push(p);
              ts.push(d!.incomingT[i]);
            }
          });
          return { pts, ts };
        };
        const solid = pick(bands.solidMs);
        tube(solid.pts, solid.ts, 0.03, mats.window);
        const perfect = pick(bands.perfectMs);
        tube(perfect.pts, perfect.ts, 0.04, mats.perfect);
      }
      if (d.bounce && d.times.bounce !== null) {
        const r = new Mesh(ringGeo, mats.ring);
        r.position.set(d.bounce.x, 0.03, d.bounce.z);
        parts.add(r);
        markers.push({ m: r, at: d.times.bounce });
      }
      if (d.ideal) {
        const m = new Mesh(markerGeo, mats.ideal);
        m.position.set(d.ideal.x, d.ideal.y, d.ideal.z);
        parts.add(m);
        markers.push({ m, at: d.times.release });
      }
      if (d.contact && d.times.contact !== null) {
        const m = new Mesh(markerGeo, mats.contact);
        m.position.set(d.contact.x, d.contact.y, d.contact.z);
        parts.add(m);
        markers.push({ m, at: d.times.contact });
        if (d.face) arrow(d.contact, d.face, 0.45, 0.008, mats.face, d.times.contact);
      }
      d.batGhosts.forEach((pose, i) => {
        const g = new Mesh(batGeoSource.geometry, mats.ghost);
        placeBatSpan(g, pose.grip, pose.toe, pose.face);
        parts.add(g);
        markers.push({ m: g, at: d!.batGhostT[i] ?? d!.times.release });
      });
      if (d.body) {
        // The batter's body exactly as the pad and LBW collisions used it.
        for (const k of d.body) {
          const len = Math.hypot(k.b.x - k.a.x, k.b.y - k.a.y, k.b.z - k.a.z);
          const g = new CapsuleGeometry(k.r, Math.max(0.0001, len), 4, 10);
          built.push(g);
          const m = new Mesh(g, mats.body);
          m.position.set((k.a.x + k.b.x) / 2, (k.a.y + k.b.y) / 2, (k.a.z + k.b.z) / 2);
          if (len > 1e-4) m.quaternion.setFromUnitVectors(UP, new Vector3(k.b.x - k.a.x, k.b.y - k.a.y, k.b.z - k.a.z).normalize());
          parts.add(m);
          markers.push({ m, at: d.times.release });
        }
      }
      if (d.lbw) {
        // Where it hit the pad, and the unimpeded flight to the stumps plane: red when hitting, white when missing.
        const mat = d.lbw.out ? mats.lbwOut : mats.lbwNot;
        const impact = new Mesh(markerGeo, mat);
        impact.position.set(d.lbw.impact.x, d.lbw.impact.y, d.lbw.impact.z);
        parts.add(impact);
        markers.push({ m: impact, at: d.lbw.at });
        if (d.lbw.path.length > 1) {
          const g = polylineTube(d.lbw.path, 0.011);
          reveal(g, d.lbw.path.length);
          built.push(g);
          const m = new Mesh(g, mat);
          m.frustumCulled = false;
          parts.add(m);
          markers.push({ m, at: d.lbw.at + 80 });
        }
        const proj = new Mesh(markerGeo, mat);
        proj.position.set(d.lbw.projected.x, d.lbw.projected.y, d.lbw.projected.z);
        parts.add(proj);
        markers.push({ m: proj, at: d.lbw.at + 160 });
        const sg = new BoxGeometry(STUMPS_W, STUMPS_TOP, 0.01);
        built.push(sg);
        const stumps = new Mesh(sg, mats.stumps);
        stumps.position.set(0, STUMPS_TOP / 2, PITCH_HALF);
        parts.add(stumps);
        markers.push({ m: stumps, at: d.lbw.at + 80 });
      }
      const at = d.times.contact ?? d.times.ideal;
      if (d.intended) {
        // Dashes along the ground: what the player asked for.
        for (let k = 0; k < 8; k++) {
          const from = { x: d.intended.from.x + d.intended.dir.x * k * 1.5, y: 0.04, z: d.intended.from.z + d.intended.dir.z * k * 1.5 };
          arrow(from, d.intended.dir, k === 7 ? 1.2 : 0.8, 0.035, mats.intended, at);
        }
      }
      if (d.actual) arrow({ x: d.actual.from.x, y: 0.05, z: d.actual.from.z }, d.actual.dir, d.actual.length, 0.05, mats.actual, at + 120);
    },
    update(t) {
      if (!d) return;
      for (const tb of tubes) reveal(tb.g, revealed(tb.times, t));
      for (const m of markers) m.m.visible = t >= m.at;
    },
    showAll() {
      landing.visible = true;
      warm.visible = true;
      flashMesh.visible = true;
      flashMat.map = flashMap;
      group.visible = true;
    },
    hideAll() {
      landing.visible = false;
      warm.visible = false;
      flashMesh.visible = false;
      clear();
      d = null;
    },
    dispose() {
      clear();
      scene.remove(group);
      flashGeo.dispose();
      flashMat.dispose();
      ringGeo.dispose();
      markerGeo.dispose();
      shaftGeo.dispose();
      headGeo.dispose();
      batGeoSource.geometry.dispose();
      (batGeoSource.material as MeshStandardMaterial).dispose();
      for (const m of Object.values(mats)) m.dispose();
    },
  };
}
