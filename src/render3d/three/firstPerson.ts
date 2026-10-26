/**
 * What the batter sees of themselves in first person: the bat (the physics bat, or the provisional swing before the
 * result) and the two gloves on its handle with a hint of forearm. The head and body are never drawn. The bat is the
 * same mesh model as every other bat (props.createBat), placed exactly on the physics pose.
 */
import { CapsuleGeometry, Color, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Quaternion, Vector3, type Scene } from 'three';
import type { KitSpec } from '@/contracts';
import { GLOVE_R } from '@/physics/constants';
import { glovesOf } from '../practice/bat';
import type { BatPose } from '../practice/frame';
import type { Vec3 } from '../core/math';
import { createBat, placeBatSpan } from './props';

export interface FirstPerson {
  group: Group;
  /** Shows the bat and gloves at a pose (world), or hides them (null). The forearms lead to the two shoulders. */
  update(pose: BatPose | null, shoulders: { top: Vec3; bottom: Vec3 }): void;
  setKit(kit: KitSpec): void;
  /** Every mesh visible (for shader pre-compilation). */
  showAll(): void;
  dispose(): void;
}

const Y = new Vector3(0, 1, 0);
const tq = new Quaternion();
const a = new Vector3();
const b = new Vector3();

export function createFirstPerson(scene: Scene): FirstPerson {
  const group = new Group();
  group.name = 'first-person';
  const bat = createBat();
  bat.castShadow = false;
  // Lit from the floodlights behind the batter the blade would read almost black: a little light of its own.
  const batMat = bat.material as MeshStandardMaterial;
  batMat.emissive.set('#5a4a30');
  batMat.emissiveIntensity = 0.6;
  const gloveMat = new MeshStandardMaterial({ color: '#f4f5f8', roughness: 0.62, emissive: '#3a3d48', emissiveIntensity: 0.5 });
  const stripeMat = new MeshStandardMaterial({ color: '#19d3fa', roughness: 0.55 });
  const sleeveMat = new MeshStandardMaterial({ color: '#1E2A78', roughness: 0.8 });
  const gloveGeo = new CapsuleGeometry(GLOVE_R, 0.05, 4, 10);
  const cuffGeo = new CylinderGeometry(GLOVE_R * 0.92, GLOVE_R * 0.92, 0.035, 10);
  const armGeo = new CylinderGeometry(0.032, 0.036, 1, 8);
  armGeo.translate(0, 0.5, 0);
  const top = new Mesh(gloveGeo, gloveMat);
  const bottom = new Mesh(gloveGeo, gloveMat);
  const cuffTop = new Mesh(cuffGeo, stripeMat);
  const cuffBottom = new Mesh(cuffGeo, stripeMat);
  const armTop = new Mesh(armGeo, sleeveMat);
  const armBottom = new Mesh(armGeo, sleeveMat);
  group.add(bat, top, bottom, cuffTop, cuffBottom, armTop, armBottom);
  group.visible = false;
  scene.add(group);

  const orient = (m: Mesh, at: Vec3, along: Vec3) => {
    m.position.set(at.x, at.y, at.z);
    a.set(along.x, along.y, along.z).normalize();
    m.quaternion.copy(tq.setFromUnitVectors(Y, a));
  };
  /** A forearm from the glove towards the shoulder, at most `len` long (the rest is outside the view). */
  const arm = (m: Mesh, from: Vec3, shoulder: Vec3, len: number) => {
    a.set(shoulder.x - from.x, shoulder.y - from.y, shoulder.z - from.z);
    const d = Math.min(len, a.length());
    a.normalize();
    m.position.set(from.x, from.y, from.z);
    m.quaternion.copy(tq.setFromUnitVectors(Y, a));
    m.scale.set(1, d, 1);
  };

  return {
    group,
    update(pose, shoulders) {
      if (!pose) {
        group.visible = false;
        return;
      }
      group.visible = true;
      placeBatSpan(bat, pose.grip, pose.toe, pose.face);
      const g = glovesOf(pose);
      orient(top, g.top, g.dir);
      orient(bottom, g.bottom, g.dir);
      b.set(g.dir.x, g.dir.y, g.dir.z);
      orient(cuffTop, { x: g.top.x - b.x * 0.05, y: g.top.y - b.y * 0.05, z: g.top.z - b.z * 0.05 }, g.dir);
      orient(cuffBottom, { x: g.bottom.x + b.x * 0.05, y: g.bottom.y + b.y * 0.05, z: g.bottom.z + b.z * 0.05 }, g.dir);
      // The forearms run back below the camera, out of sight: only the gloves and the bat are drawn.
      armTop.visible = false;
      armBottom.visible = false;
      void arm;
      void shoulders;
    },
    setKit(kit) {
      stripeMat.color.set(kit.secondary);
      sleeveMat.color.copy(new Color(kit.primary)).multiplyScalar(0.85);
    },
    showAll() {
      group.visible = true;
    },
    dispose() {
      scene.remove(group);
      bat.geometry.dispose();
      (bat.material as MeshStandardMaterial).dispose();
      gloveGeo.dispose();
      cuffGeo.dispose();
      armGeo.dispose();
      gloveMat.dispose();
      stripeMat.dispose();
      sleeveMat.dispose();
    },
  };
}
