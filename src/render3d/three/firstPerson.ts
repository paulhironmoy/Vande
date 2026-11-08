/**
 * What the batter sees of themselves in first person: the bat (the physics bat, or the provisional swing before the
 * result) and the two batting gloves on its handle. The head and body are never drawn. The bat is the same mesh model
 * as every other bat (props.createBat), placed exactly on the physics pose.
 *
 * The gloves are proper batting gloves: the padded finger rolls wrap round the handle, a thumb roll lies along it, a
 * padded back of the hand carries an original VANDE mark, and a cuff with the kit's colour closes the wrist. They stay
 * inside the old glove envelope (about GLOVE_R round the handle, 15 cm along it), in the lower corner of the view,
 * clear of the ball's path. Left-handers get mirrored gloves.
 */
import {
  BufferGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { KitSpec } from '@/contracts';
import { GLOVE_R } from '@/physics/constants';
import { glovesOf } from '../practice/bat';
import type { BatPose } from '../practice/frame';
import type { Vec3 } from '../core/math';
import { PLAYER_FILL } from './players';
import { canvasArt, createBat, placeBatSpan } from './props';

export interface FirstPerson {
  group: Group;
  /**
   * Shows the bat and gloves at a pose (world), or hides them (null). The forearms lead to the two shoulders. `smear`:
   * trailing ghost bats for a swing faster than a real bat's peak (practice/bat.ts swingSmear), else none.
   */
  update(pose: BatPose | null, shoulders: { top: Vec3; bottom: Vec3 }, smear?: { poses: BatPose[]; opacity: number[] } | null): void;
  setKit(kit: KitSpec): void;
  /** Every mesh visible (for shader pre-compilation). */
  showAll(): void;
  dispose(): void;
}

/** The glove's reach round the handle and along it (the collision envelope is GLOVE_R round the handle). */
export const FP_GLOVE = Object.freeze({ radius: GLOVE_R * 0.98, length: 0.15 });

/**
 * One batting glove in its own frame: +y along the bat (towards the toe), the handle on the y axis, +z the back of
 * the hand. Returns the leather parts and the accent parts as two geometries (two materials), and the mark's place.
 */
function gloveGeometry(): { leather: BufferGeometry; accent: BufferGeometry; mark: Matrix4 } {
  const leather: BufferGeometry[] = [];
  const accent: BufferGeometry[] = [];
  const add = (list: BufferGeometry[], g: BufferGeometry) => {
    const n = g.index ? g.toNonIndexed() : g;
    n.deleteAttribute('uv');
    list.push(n);
  };
  // Four finger rolls wrapping round the handle from the back of the hand, stacked along it.
  for (let i = 0; i < 4; i++) {
    const roll = new TorusGeometry(0.031, 0.0118, 8, 14, Math.PI * 1.25);
    roll.rotateZ(Math.PI * 0.5 - Math.PI * 0.625);
    roll.rotateX(Math.PI / 2);
    roll.translate(0, -0.016 + i * 0.0245, 0.002);
    add(leather, roll);
  }
  // The palm and heel of the hand behind the rolls, the padded back of the hand, the thumb roll along the handle.
  const palm = new SphereGeometry(1, 14, 10);
  palm.scale(0.036, 0.05, 0.03);
  palm.translate(0, 0.005, -0.016);
  add(leather, palm);
  const back = new SphereGeometry(1, 14, 10);
  back.scale(0.033, 0.05, 0.02);
  back.translate(0, 0.012, 0.026);
  add(leather, back);
  const thumb = new CapsuleGeometry(0.0135, 0.05, 3, 8);
  thumb.rotateZ(0.12);
  thumb.translate(-0.03, 0.022, -0.012);
  add(leather, thumb);
  // The cuff: a short padded cylinder at the wrist with a coloured band.
  const cuff = new CylinderGeometry(0.037, 0.035, 0.034, 16, 1, false);
  cuff.rotateX(-0.25);
  cuff.translate(0.004, -0.058, 0.004);
  add(leather, cuff);
  const band = new CylinderGeometry(0.0378, 0.0378, 0.009, 16, 1, true);
  band.rotateX(-0.25);
  band.translate(0.004, -0.062, 0.004);
  add(accent, band);
  // Thin accent seams between the rolls on the back of the hand.
  for (let i = 0; i < 3; i++) {
    const seam = new TorusGeometry(0.0425, 0.0016, 4, 10, Math.PI * 0.55);
    seam.rotateZ(Math.PI * 0.5 - Math.PI * 0.275);
    seam.rotateX(Math.PI / 2);
    seam.translate(0, -0.0038 + i * 0.0245, 0.002);
    add(accent, seam);
  }
  const mark = new Matrix4().compose(new Vector3(0, 0.014, 0.0462), new Quaternion(), new Vector3(0.024, 0.024, 1));
  return { leather: mergeGeometries(leather)!, accent: mergeGeometries(accent)!, mark };
}

function paintMark(g: CanvasRenderingContext2D, w: number, h: number) {
  g.clearRect(0, 0, w, h);
  g.strokeStyle = '#1e2a78';
  g.lineWidth = w * 0.13;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(w * 0.2, h * 0.25);
  g.lineTo(w * 0.5, h * 0.78);
  g.lineTo(w * 0.8, h * 0.25);
  g.stroke();
}

const tq = new Quaternion();
const mx = new Matrix4();
const ax = new Vector3();
const ay = new Vector3();
const az = new Vector3();

export function createFirstPerson(scene: Scene): FirstPerson {
  const group = new Group();
  group.name = 'first-person';
  const bat = createBat();
  bat.castShadow = false;
  // Lit from the floodlights behind the batter the blade would read almost black: a little light of its own (its own
  // colours, so the grain and the mark stay), less by day.
  const batMat = bat.material as MeshStandardMaterial;
  batMat.emissiveMap = batMat.map;
  batMat.emissive.set('#ffffff');
  batMat.emissiveIntensity = 0.16;
  const { leather, accent, mark } = gloveGeometry();
  const gloveMat = new MeshStandardMaterial({ color: '#f3f4f6', roughness: 0.6, emissive: '#3a3d48', emissiveIntensity: 0.45 });
  const stripeMat = new MeshStandardMaterial({ color: '#19d3fa', roughness: 0.5 });
  const markMat = new MeshStandardMaterial({ map: canvasArt(64, 64, paintMark, [30, 42, 120, 0]), transparent: true, depthWrite: false, roughness: 0.5, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
  const markGeo = new PlaneGeometry(1, 1);
  const gloves = [0, 1].map(() => {
    const g = new Group();
    const body = new Mesh(leather, gloveMat);
    const trim = new Mesh(accent, stripeMat);
    const logo = new Mesh(markGeo, markMat);
    logo.matrixAutoUpdate = false;
    logo.matrix.copy(mark);
    logo.renderOrder = 2;
    g.add(body, trim, logo);
    return g;
  });
  // The smear's ghost bats: the same blade, translucent, never writing depth (shown only while the swing outruns a
  // real bat's peak; see practice/bat.ts SMEAR).
  const ghostMats = [0, 1, 2].map(() => new MeshStandardMaterial({ color: '#e9dcc0', roughness: 0.8, transparent: true, depthWrite: false, opacity: 0.2 }));
  const ghosts = ghostMats.map((m) => {
    const g = new Mesh(bat.geometry, m);
    g.renderOrder = 1;
    g.visible = false;
    return g;
  });
  group.add(bat, ...gloves, ...ghosts);
  group.visible = false;
  scene.add(group);

  /** Orients a glove: its +y along the bat towards the toe, +z the back of the hand (`back`), mirrored for left. */
  const place = (g: Group, at: Vec3, dir: Vec3, back: Vector3, mirror: boolean) => {
    ay.set(dir.x, dir.y, dir.z).normalize();
    az.copy(back).addScaledVector(ay, -back.dot(ay)).normalize();
    ax.crossVectors(ay, az);
    mx.makeBasis(ax, ay, az);
    tq.setFromRotationMatrix(mx);
    g.position.set(at.x, at.y, at.z);
    g.quaternion.copy(tq);
    g.scale.set(mirror ? -1 : 1, 1, 1);
  };
  const face = new Vector3();

  return {
    group,
    update(pose, shoulders, smear) {
      if (!pose) {
        group.visible = false;
        return;
      }
      group.visible = true;
      placeBatSpan(bat, pose.grip, pose.toe, pose.face);
      ghosts.forEach((g, i) => {
        const sp = smear?.poses[i];
        g.visible = Boolean(sp);
        if (!sp) return;
        placeBatSpan(g, sp.grip, sp.toe, sp.face);
        ghostMats[i].opacity = smear!.opacity[i];
      });
      const g = glovesOf(pose);
      const mirror = shoulders.top.x > 0;
      face.set(pose.face.x, pose.face.y, pose.face.z);
      // The top hand's back faces the way the face does; the bottom hand wraps from behind the handle.
      place(gloves[0], g.top, g.dir, face, mirror);
      place(gloves[1], g.bottom, g.dir, face.clone().negate(), !mirror);
      const lift = PLAYER_FILL.value;
      batMat.emissiveIntensity = 0.06 + 0.1 * lift;
      gloveMat.emissiveIntensity = 0.12 + 0.33 * lift;
    },
    setKit(kit) {
      stripeMat.color.set(kit.secondary);
    },
    showAll() {
      group.visible = true;
      for (const g of ghosts) g.visible = true;
    },
    dispose() {
      scene.remove(group);
      bat.geometry.dispose();
      (bat.material as MeshStandardMaterial).dispose();
      leather.dispose();
      accent.dispose();
      markGeo.dispose();
      gloveMat.dispose();
      stripeMat.dispose();
      markMat.map?.dispose();
      markMat.dispose();
      for (const m of ghostMats) m.dispose();
    },
  };
}
