/**
 * Props and effects. Everything is evaluated from scene time (no accumulated state), so seeking and offline
 * frame stepping always produce the same image: the ball trail samples the script at past times, particles are
 * seeded per burst, stumps and bails follow closed-form arcs.
 */
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  CircleGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BAIL_RISE, BALL_R, PITCH_HALF, STUMP_H, STUMP_R, STUMP_SPACING } from '../core/ground';
import { BLADE_L, BLADE_W, EDGE_T, HANDLE_L, HANDS_FROM_TOP } from '@/physics/constants';
import { type BallScript, type SceneEvent, sampleBall } from '../core/choreo';
import { clamp, easeOut, seededStream } from '../core/math';

// ---------------------------------------------------------------------------------------------------------------
// Bat
// ---------------------------------------------------------------------------------------------------------------

/**
 * The bat, built from the physics bat (src/physics/constants.ts): a HANDLE_L handle and a BLADE_L × BLADE_W blade with
 * EDGE_T edges and a raised spine, so a drawn edge is a simulated edge. Local frame: the top of the handle at the
 * origin, the toe at y = −(HANDLE_L + BLADE_L), the face towards +z.
 */
export function createBat(): Mesh {
  const blade = new BoxGeometry(BLADE_W, BLADE_L, EDGE_T, 1, 4, 1);
  // Shape the back of the blade (spine) by pushing the centre out.
  const p = blade.attributes.position as BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    const x = p.getX(i);
    if (z < 0) p.setZ(i, z - 0.018 * (1 - Math.abs(x) / (BLADE_W / 2)));
  }
  blade.translate(0, -HANDLE_L - BLADE_L / 2, 0);
  const handle = new CylinderGeometry(0.017, 0.017, HANDLE_L, 8);
  handle.translate(0, -HANDLE_L / 2, 0);
  const geo = mergeGeometries([blade.toNonIndexed(), handle.toNonIndexed()].map((g) => (g.deleteAttribute('uv'), g)))!;
  const colors = new Float32Array(geo.attributes.position.count * 3);
  const willow = new Color('#e3c48e');
  const grip = new Color('#171a3d');
  const sticker = new Color('#19d3fa');
  for (let i = 0; i < geo.attributes.position.count; i++) {
    const y = geo.attributes.position.getY(i);
    const z = geo.attributes.position.getZ(i);
    const c = y > -HANDLE_L + 0.005 ? grip : z < -0.01 && y < -HANDLE_L - 0.1 && y > -HANDLE_L - 0.3 ? sticker : willow;
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const bat = new Mesh(geo, new MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }));
  bat.castShadow = true;
  return bat;
}

const BAT_UP = new Vector3(0, -1, 0);
const tq = new Quaternion();
const tv = new Vector3();

/** Places the bat with the bottom hand at `grip` (world) and the blade along `dir`, face towards `face`. */
export function placeBat(bat: Object3D, grip: Vector3, dir: Vector3, faceHint: Vector3) {
  bat.scale.set(1, 1, 1);
  // The bottom hand's centre sits HANDS_FROM_TOP below the top of the handle (the mesh origin).
  bat.position.copy(grip).addScaledVector(dir, -HANDS_FROM_TOP);
  tq.setFromUnitVectors(BAT_UP, tv.copy(dir).normalize());
  bat.quaternion.copy(tq);
  // Twist so the blade face points as close as possible to faceHint.
  const face = new Vector3(0, 0, 1).applyQuaternion(tq);
  const want = faceHint.clone().sub(dir.clone().multiplyScalar(faceHint.dot(dir))).normalize();
  if (want.lengthSq() > 0.1) {
    const ang = Math.atan2(face.clone().cross(want).dot(dir), face.dot(want));
    bat.quaternion.premultiply(new Quaternion().setFromAxisAngle(dir, ang));
  }
}

/** Top of the bat mesh's handle and its length from there to the toe (local units, see createBat). */
const BAT_TOP_Y = 0;
const BAT_MESH_LENGTH = HANDLE_L + BLADE_L;
const spanDir = new Vector3();
const spanFace = new Vector3();

/**
 * Places the bat exactly on a physics bat: the top of the handle at `grip`, the toe at `toe` (the blade stretches
 * to the physics length), the face turned towards `face` (all world).
 */
export function placeBatSpan(bat: Object3D, grip: { x: number; y: number; z: number }, toe: { x: number; y: number; z: number }, face: { x: number; y: number; z: number }) {
  spanDir.set(toe.x - grip.x, toe.y - grip.y, toe.z - grip.z);
  const len = spanDir.length() || BAT_MESH_LENGTH;
  spanDir.divideScalar(len);
  const k = len / BAT_MESH_LENGTH;
  bat.scale.set(1, k, 1);
  bat.position.set(grip.x, grip.y, grip.z).addScaledVector(spanDir, BAT_TOP_Y * k);
  tq.setFromUnitVectors(BAT_UP, spanDir);
  bat.quaternion.copy(tq);
  const now = new Vector3(0, 0, 1).applyQuaternion(tq);
  spanFace.set(face.x, face.y, face.z);
  spanFace.sub(spanDir.clone().multiplyScalar(spanFace.dot(spanDir)));
  if (spanFace.lengthSq() > 1e-6) {
    spanFace.normalize();
    const ang = Math.atan2(now.clone().cross(spanFace).dot(spanDir), now.dot(spanFace));
    bat.quaternion.premultiply(new Quaternion().setFromAxisAngle(spanDir, ang));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Ball with seam, glow and trail
// ---------------------------------------------------------------------------------------------------------------

/**
 * How the ball is drawn. The match keeps the defaults; Practice draws it larger than its collision radius (about
 * 20–25%: readable on a phone, never used by the physics), with a dark outline for contrast against the pitch and the
 * sight screen, a ground shadow (depth and the bounce), a softer glow and a short, faint trace.
 */
export interface BallStyle {
  visualScale: number;
  outline: boolean;
  shadow: boolean;
  /** Multiplies the trace's opacity. */
  trailAlpha: number;
  /** Multiplies the trace's width. */
  trailWidth: number;
  glowOpacity: number;
  /** Glow size per metre of camera distance. */
  glowPerMetre: number;
}
export const MATCH_BALL_STYLE: BallStyle = { visualScale: 1, outline: false, shadow: false, trailAlpha: 1, trailWidth: 1, glowOpacity: 0.6, glowPerMetre: 0.018 };

export interface BallFx {
  group: Group;
  update(script: BallScript | null, t: number, handPos: (id: string) => Vector3 | null, slow: boolean, trailPoints: number, camPos: Vector3): void;
  setStyle(style: BallStyle): void;
  dispose(): void;
}

export function createBall(glowTex: Texture): BallFx {
  const group = new Group();
  const ball = new Group();
  const core = new Mesh(new SphereGeometry(BALL_R, 18, 12), new MeshStandardMaterial({ color: '#f6f4ee', roughness: 0.38, emissive: '#2a2a2a' }));
  core.castShadow = true;
  const seam = new Mesh(new TorusGeometry(BALL_R * 1.005, 0.0032, 4, 28), new MeshStandardMaterial({ color: '#1f5d3f', roughness: 0.6 }));
  ball.add(core, seam);
  const outline = new Mesh(new SphereGeometry(BALL_R, 16, 10), new MeshBasicMaterial({ color: '#07081a', side: BackSide, fog: false }));
  outline.scale.setScalar(1.18);
  outline.visible = false;
  ball.add(outline);
  const glow = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: glowTex, color: '#8ff0ff', transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.55, fog: false }));
  glow.scale.setScalar(0.5);
  const shadowGeo = new CircleGeometry(1, 20);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadow = new Mesh(shadowGeo, new MeshBasicMaterial({ map: glowTex, color: '#000000', transparent: true, depthWrite: false, opacity: 0.5, fog: false }));
  shadow.renderOrder = 2;
  shadow.visible = false;
  group.add(ball, glow, shadow);
  let style: BallStyle = MATCH_BALL_STYLE;
  const alignX = new Vector3(1, 0, 0);
  const qa = new Quaternion();
  const ownAxis = new Vector3();

  // Trail: a camera-facing ribbon through past positions (sampled from the script, so it is seek-safe).
  const MAX = 40;
  const trailGeo = new BufferGeometry();
  const positions = new Float32Array(MAX * 2 * 3);
  const alphas = new Float32Array(MAX * 2);
  trailGeo.setAttribute('position', new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage));
  trailGeo.setAttribute('alpha', new BufferAttribute(alphas, 1).setUsage(DynamicDrawUsage));
  const idx: number[] = [];
  for (let i = 0; i < MAX - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  trailGeo.setIndex(idx);
  const trailMat = new MeshBasicMaterial({ color: '#52e2ff', transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false });
  trailMat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float alpha;\nvarying float vA;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvA = alpha;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vA;').replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= vA;');
  };
  const trail = new Mesh(trailGeo, trailMat);
  trail.frustumCulled = false;
  group.add(trail);

  const pts: Vector3[] = Array.from({ length: MAX }, () => new Vector3());
  const side = new Vector3();
  const toCam = new Vector3();
  const sq = new Quaternion();

  return {
    group,
    update(script, t, handPos, slow, trailPoints, camPos) {
      if (!script) {
        group.visible = false;
        return;
      }
      const s = sampleBall(script, t, (id) => {
        const p = handPos(id);
        return p ? { x: p.x, y: p.y, z: p.z } : null;
      });
      group.visible = s.visible;
      if (!s.visible) return;
      ball.position.set(s.pos.x, s.pos.y, s.pos.z);
      ball.scale.setScalar(style.visualScale);
      if (s.spinAxis) {
        // The physics path's own seam axis: the seam ring (its axis along x) turned onto it, spinning about it.
        ownAxis.set(s.spinAxis.x, s.spinAxis.y, s.spinAxis.z).normalize();
        qa.setFromUnitVectors(alignX, ownAxis);
        sq.setFromAxisAngle(ownAxis, s.spin);
        ball.quaternion.copy(sq).multiply(qa);
      } else ball.quaternion.identity(); // in a hand
      // Seam ring orientation: upright along the line of travel.
      seam.rotation.set(0, Math.PI / 2, 0);
      glow.position.copy(ball.position);
      glow.quaternion.copy(new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(camPos, glow.position, new Vector3(0, 1, 0))));
      const dCam = camPos.distanceTo(ball.position);
      glow.scale.setScalar(clamp(dCam * style.glowPerMetre, 0.12 * style.visualScale, 1.4));
      (glow.material as MeshBasicMaterial).opacity = s.inFlight ? style.glowOpacity : style.glowOpacity * 0.5;
      if (style.shadow) {
        // A soft dark disc on the ground under the ball: crisp and strong near the ground, fainter and wider high up.
        const h = Math.max(0, s.pos.y);
        shadow.visible = s.pos.y < 12;
        shadow.position.set(s.pos.x, 0.018, s.pos.z);
        shadow.scale.setScalar(BALL_R * style.visualScale * (1.6 + h * 0.5));
        (shadow.material as MeshBasicMaterial).opacity = 0.7 * (1 - clamp(h / 7, 0, 0.85));
      }
      // Trail
      const n = Math.min(MAX, Math.max(4, Math.round(trailPoints * (slow ? 1.4 : 1))));
      const dt = slow ? 9 : 14;
      let count = 0;
      for (let i = 0; i < n; i++) {
        const st = sampleBall(script, t - i * dt);
        if (!st.visible || !st.inFlight) break;
        pts[i].set(st.pos.x, st.pos.y, st.pos.z);
        count++;
      }
      const width = clamp(dCam * 0.0045, 0.02, 0.22) * (slow ? 1.6 : 1) * style.trailWidth;
      for (let i = 0; i < MAX; i++) {
        const p = pts[Math.min(i, Math.max(0, count - 1))];
        const next = pts[Math.min(i + 1, Math.max(0, count - 1))];
        toCam.copy(camPos).sub(p).normalize();
        side.copy(next).sub(p);
        if (side.lengthSq() < 1e-10) side.set(1, 0, 0);
        side.cross(toCam).normalize();
        const k = count > 1 ? 1 - Math.min(i, count - 1) / (count - 1) : 0;
        const w = width * (0.25 + 0.75 * k);
        positions.set([p.x + side.x * w, p.y + side.y * w, p.z + side.z * w, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w], i * 6);
        const a = i < count ? k * k * (slow ? 0.9 : 0.65) * style.trailAlpha : 0;
        alphas[i * 2] = a;
        alphas[i * 2 + 1] = a;
      }
      trailGeo.attributes.position.needsUpdate = true;
      trailGeo.attributes.alpha.needsUpdate = true;
      trail.visible = count > 2;
    },
    setStyle(next) {
      style = next;
      outline.visible = next.outline;
      shadow.visible = next.shadow;
    },
    dispose() {
      core.geometry.dispose();
      seam.geometry.dispose();
      glow.geometry.dispose();
      outline.geometry.dispose();
      (outline.material as MeshBasicMaterial).dispose();
      shadowGeo.dispose();
      (shadow.material as MeshBasicMaterial).dispose();
      trailGeo.dispose();
      trailMat.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Stumps and bails
// ---------------------------------------------------------------------------------------------------------------

export interface StumpsFx {
  group: Group;
  update(script: BallScript | null, t: number): void;
  dispose(): void;
}

export function createStumps(): StumpsFx {
  const group = new Group();
  const stumpGeo = new CylinderGeometry(STUMP_R, STUMP_R, STUMP_H, 10);
  stumpGeo.translate(0, STUMP_H / 2, 0);
  const stumpMat = new MeshStandardMaterial({ color: '#f1eee4', roughness: 0.45, emissive: '#000000' });
  const stumps = new InstancedMesh(stumpGeo, stumpMat, 6);
  stumps.castShadow = true;
  // Two bails bridge the three stumps (each spans one gap, resting in the grooves).
  const bailGeo = new CylinderGeometry(0.008, 0.008, STUMP_SPACING + STUMP_R * 1.6, 6);
  bailGeo.rotateZ(Math.PI / 2);
  const bailMat = new MeshStandardMaterial({ color: '#ffd7a3', roughness: 0.4, emissive: '#ff9a2e', emissiveIntensity: 0.2 });
  const bails = new InstancedMesh(bailGeo, bailMat, 4);
  group.add(stumps, bails);
  const o = new Object3D();
  const ends: Array<{ z: number; key: 'striker' | 'nonStriker' }> = [
    { z: PITCH_HALF, key: 'striker' },
    { z: -PITCH_HALF, key: 'nonStriker' },
  ];

  const update = (script: BallScript | null, t: number) => {
    let flash = 0;
    ends.forEach((end, e) => {
      const hit = script ? script.stumps[end.key] : null;
      const dt = hit ? t - hit.t : -1;
      const rand = seededStream(e * 97 + 13);
      for (let i = 0; i < 3; i++) {
        const x = (i - 1) * STUMP_SPACING;
        o.position.set(x, 0, end.z);
        o.rotation.set(0, 0, 0);
        if (hit && dt >= 0) {
          const k = easeOut(clamp(dt / 380, 0, 1)) * hit.strength;
          const dir = (rand() - 0.5) * 0.6 + (i - 1) * 0.35;
          const tilt = (0.55 + rand() * 0.6) * k;
          o.rotation.set(Math.sign(hit.dir.z || 1) * tilt, 0, dir * k);
          if (i === 1 && hit.strength > 0.9) o.position.y = 0;
        }
        o.updateMatrix();
        stumps.setMatrixAt(e * 3 + i, o.matrix);
      }
      for (let j = 0; j < 2; j++) {
        const x = (j - 0.5) * STUMP_SPACING;
        o.position.set(x, STUMP_H + BAIL_RISE * 0.6, end.z);
        o.rotation.set(0, 0, 0);
        if (hit && dt >= 0) {
          const s = dt / 1000;
          const vx = (rand() - 0.5) * 2.4 + hit.dir.x * 2;
          const vy = 2.6 + rand() * 1.8;
          const vz = hit.dir.z * (2.2 + rand() * 1.5);
          const tLand = (vy + Math.sqrt(vy * vy + 2 * 9.81 * (STUMP_H + 0.01))) / 9.81;
          const ts = Math.min(s, tLand);
          o.position.set(x + vx * ts, Math.max(0.01, STUMP_H + BAIL_RISE * 0.6 + vy * ts - 4.905 * ts * ts), end.z + vz * ts);
          o.rotation.set(ts * 14, ts * 9, ts * 11);
          flash = Math.max(flash, dt < 1600 ? 0.5 + 0.5 * Math.sin(dt * 0.035) : 0);
        }
        o.updateMatrix();
        bails.setMatrixAt(e * 2 + j, o.matrix);
      }
    });
    stumps.instanceMatrix.needsUpdate = true;
    bails.instanceMatrix.needsUpdate = true;
    // LED stumps and bails light up when broken.
    stumpMat.emissive.setRGB(flash * 0.9, flash * 0.35, 0.02);
    bailMat.emissiveIntensity = 0.2 + flash * 2.2;
  };
  update(null, 0);
  return {
    group,
    update,
    dispose() {
      stumpGeo.dispose();
      stumpMat.dispose();
      bailGeo.dispose();
      bailMat.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Event effects: bounce mark, impact flash, sparks, fireworks, seal ring
// ---------------------------------------------------------------------------------------------------------------

export interface EventFx {
  group: Group;
  update(script: BallScript | null, t: number, camPos: Vector3, particleScale: number, reducedMotion: boolean): void;
  /**
   * How the pitch of the ball shows: the match's growing ring, or Practice's brief low dust puff (a ring left on the
   * pitch through the batter's decision would be a landing marker, which only Learn assistance may show).
   */
  setBounceMark(mark: 'ring' | 'dust'): void;
  dispose(): void;
}

const MAX_PARTICLES = 900;

export function createEventFx(glowTex: Texture): EventFx {
  const group = new Group();
  const bounce = new Mesh(new RingGeometry(0.05, 0.11, 24), new MeshBasicMaterial({ color: '#52e2ff', transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false }));
  bounce.rotation.x = -Math.PI / 2;
  const flash = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: glowTex, color: '#ffffff', transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false }));
  const seal = new Mesh(new RingGeometry(0.8, 1, 48), new MeshBasicMaterial({ color: '#52e2ff', transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, fog: false }));
  const partGeo = new PlaneGeometry(1, 1);
  const partMat = new MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: AdditiveBlending, vertexColors: false, fog: false });
  const parts = new InstancedMesh(partGeo, partMat, MAX_PARTICLES);
  parts.instanceMatrix.setUsage(DynamicDrawUsage);
  parts.frustumCulled = false;
  const colorAttr = new Float32Array(MAX_PARTICLES * 3);
  parts.instanceColor = new InstancedBufferAttribute(colorAttr, 3);
  parts.instanceColor.setUsage(DynamicDrawUsage);
  group.add(bounce, flash, seal, parts);
  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3();
  const p = new Vector3();
  const c = new Color();
  const look = new Matrix4();
  const up = new Vector3(0, 1, 0);
  const AMBER = new Color('#ffb347');
  const CYAN = new Color('#52e2ff');
  const WHITE = new Color('#ffffff');
  const PINK = new Color('#ff5d8f');
  const GREY = new Color('#9aa3b5');
  const GOLD = new Color('#ffcf5a');
  const SEAL = new Color('#52e2ff');

  const emitBurst = (e: SceneEvent, dt: number, n: number, spread: number, life: number, colors: Color[], gravity: number, size: number, start: number, seed: number): number => {
    const rand = seededStream(seed);
    let k = start;
    for (let i = 0; i < n && k < MAX_PARTICLES; i++) {
      const u = rand() * Math.PI * 2;
      const v = Math.acos(2 * rand() - 1);
      const speed = spread * (0.45 + rand() * 0.55);
      const lifeI = life * (0.7 + rand() * 0.3);
      if (dt > lifeI) continue;
      const tt = dt / 1000;
      const at = e.at ?? { x: 0, y: 1, z: 0 };
      p.set(at.x + Math.sin(v) * Math.cos(u) * speed * tt, at.y + Math.cos(v) * speed * tt - 0.5 * gravity * tt * tt, at.z + Math.sin(v) * Math.sin(u) * speed * tt);
      const fade = 1 - dt / lifeI;
      s.setScalar(size * (0.6 + fade * 0.6));
      q.setFromRotationMatrix(look);
      m.compose(p, q, s);
      parts.setMatrixAt(k, m);
      c.copy(colors[i % colors.length]).multiplyScalar(fade);
      colorAttr.set([c.r, c.g, c.b], k * 3);
      k++;
    }
    return k;
  };

  let bounceMark: 'ring' | 'dust' = 'ring';
  const DUST = new Color('#d9c29a');
  return {
    group,
    setBounceMark(mark) {
      bounceMark = mark;
    },
    update(script, t, camPos, particleScale, reducedMotion) {
      bounce.visible = false;
      flash.visible = false;
      seal.visible = false;
      let k = 0;
      look.lookAt(camPos, new Vector3(0, 0, 0), up);
      if (script) {
        for (let ei = 0; ei < script.events.length; ei++) {
          const e = script.events[ei];
          const dt = t - e.t;
          if (dt < 0) continue;
          if (e.kind === 'bounce' && bounceMark === 'dust' && dt < 260 && e.at) {
            k = emitBurst({ ...e, at: { x: e.at.x, y: 0.03, z: e.at.z } }, dt, 7, 0.9, 260, [DUST], 6, 0.035, k, ei * 31 + 37);
          } else if (e.kind === 'bounce' && bounceMark === 'ring' && dt < 650 && e.at) {
            bounce.visible = true;
            bounce.position.set(e.at.x, 0.03, e.at.z);
            const u = dt / 650;
            bounce.scale.setScalar(1 + u * 2.6);
            (bounce.material as MeshBasicMaterial).opacity = (1 - u) * 0.9;
          } else if ((e.kind === 'bat' || e.kind === 'edge') && dt < 220 && e.at) {
            flash.visible = true;
            flash.position.set(e.at.x, e.at.y, e.at.z);
            flash.quaternion.setFromRotationMatrix(new Matrix4().lookAt(camPos, flash.position, up));
            const u = dt / 220;
            flash.scale.setScalar((0.5 + u * 1.4) * (e.kind === 'bat' ? 1 : 0.6) * (0.6 + e.intensity * 0.6));
            (flash.material as MeshBasicMaterial).opacity = (1 - u) * 0.9;
            if (!reducedMotion) k = emitBurst(e, dt, Math.round(26 * particleScale * e.intensity), 4.5, 420, [WHITE, CYAN], 6, 0.06, k, ei * 31 + 7);
          } else if (e.kind === 'pad' && dt < 420 && e.at) {
            // A dull, low puff off the pad: grey-white, few and slow (nothing like the bat's bright crack).
            k = emitBurst(e, dt, Math.round(10 * particleScale) + 3, 1.2, 400, [GREY, WHITE], 2, 0.05, k, ei * 31 + 23);
          } else if (e.kind === 'catch' && dt < 700 && e.at) {
            // The catch: a gold ring opening at the hands.
            seal.visible = true;
            seal.position.set(e.at.x, e.at.y, e.at.z);
            seal.quaternion.setFromRotationMatrix(new Matrix4().lookAt(camPos, seal.position, up));
            const u = dt / 700;
            seal.scale.setScalar(0.08 + easeOut(u) * 0.9);
            (seal.material as MeshBasicMaterial).color.copy(GOLD);
            (seal.material as MeshBasicMaterial).opacity = (1 - u) * 0.9;
            if (!reducedMotion) k = emitBurst(e, dt, Math.round(18 * particleScale), 2.4, 600, [GOLD, WHITE], 3, 0.06, k, ei * 31 + 29);
          } else if ((e.kind === 'stumps' || e.kind === 'bails') && dt < 900 && !reducedMotion) {
            k = emitBurst(e, dt, Math.round(30 * particleScale), 3.2, 800, [AMBER, WHITE], 4, 0.07, k, ei * 31 + 11);
          } else if (e.kind === 'six' && dt < 1400 && !reducedMotion) {
            k = emitBurst(e, dt, Math.round(60 * particleScale), 6, 1300, [AMBER, CYAN, WHITE], 3, 0.35, k, ei * 31 + 3);
          } else if (e.kind === 'fireworks' && dt < 2600) {
            for (let b = 0; b < 3; b++) {
              const bt = dt - b * 380;
              if (bt < 0) continue;
              const at = e.at ?? { x: 0, y: 30, z: 0 };
              const burst: SceneEvent = { ...e, at: { x: at.x + (b - 1) * 18, y: Math.max(26, at.y + 14 + b * 6), z: at.z + (b - 1) * 9 } };
              k = emitBurst(burst, bt, Math.round((reducedMotion ? 30 : 90) * particleScale), 16, 1800, b % 2 ? [AMBER, WHITE] : [CYAN, PINK], 4, reducedMotion ? 0.7 : 1.1, k, ei * 31 + b * 5 + 19);
            }
          } else if (e.kind === 'seal' && dt < 900) {
            const pos = sampleBall(script, e.t - 1).pos;
            seal.visible = true;
            (seal.material as MeshBasicMaterial).color.copy(SEAL);
            seal.position.set(pos.x, pos.y, pos.z);
            seal.quaternion.setFromRotationMatrix(new Matrix4().lookAt(camPos, seal.position, up));
            const u = dt / 900;
            seal.scale.setScalar(0.05 + easeOut(u) * 0.55);
            (seal.material as MeshBasicMaterial).opacity = (1 - u) * 0.95;
          }
        }
      }
      parts.count = k;
      parts.instanceMatrix.needsUpdate = true;
      if (parts.instanceColor) parts.instanceColor.needsUpdate = true;
    },
    dispose() {
      bounce.geometry.dispose();
      flash.geometry.dispose();
      seal.geometry.dispose();
      partGeo.dispose();
      partMat.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Floodlight blob shadows (one soft shadow per tower: the night-cricket look, cheap on any GPU)
// ---------------------------------------------------------------------------------------------------------------

export interface BlobShadows {
  mesh: InstancedMesh;
  begin(): void;
  add(x: number, z: number, towers: Vector3[], perPlayer: number, size: number): void;
  end(): void;
  dispose(): void;
}

export function createBlobShadows(shadowTex: Texture, max = 128): BlobShadows {
  const geo = new PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, 0.5);
  const mat = new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, color: '#000000', opacity: 0.42, fog: false });
  const mesh = new InstancedMesh(geo, mat, max);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  let k = 0;
  const o = new Object3D();
  return {
    mesh,
    begin() {
      k = 0;
    },
    add(x, z, towers, perPlayer, size) {
      for (let i = 0; i < perPlayer && i < towers.length && k < max; i++) {
        const tw = towers[i];
        const ang = Math.atan2(x - tw.x, z - tw.z);
        o.position.set(x, 0.025 + k * 0.0004, z);
        o.rotation.set(0, ang, 0);
        o.scale.set(size * 0.75, 1, size * (perPlayer > 2 ? 2.1 : 1.6));
        o.updateMatrix();
        mesh.setMatrixAt(k++, o.matrix);
      }
    },
    end() {
      mesh.count = k;
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

