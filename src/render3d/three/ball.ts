/**
 * The Practice and match ball: a sphere with a raised seam, its shadow, a short trace and (match only) a soft glow.
 * Evaluated from scene time alone (the trace samples the script at past times), so seeking and offline frames match.
 */
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Texture,
  type PerspectiveCamera,
} from 'three';
import { BALL_R } from '../core/ground';
import { type BallScript, sampleBall } from '../core/choreo';
import { clamp, type Vec3 } from '../core/math';
import { ballDiameterPx, closeUpBallDiameterPx, PRACTICE_BALL, traceAlpha, traceWidthPx } from '../practice/ballLook';
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
  /** Use the common CSS-pixel ball, surround and trace shared with Classic. */
  practice?: boolean;
  focusAid?: boolean;
}
const MATCH_BALL_STYLE: BallStyle = { visualScale: 1, outline: false, shadow: false, trailAlpha: 1, trailWidth: 1, glowOpacity: 0.6, glowPerMetre: 0.018 };

export interface BallFx {
  group: Group;
  /** Legacy outline/glow: Practice uses the CSS-pixel surround and never enables these meshes. */
  readonly matchOnlyMeshes: readonly Mesh[];
  update(script: BallScript | null, t: number, handPos: (id: string) => Vector3 | null, slow: boolean, trailPoints: number, camPos: Vector3, view?: { camera: PerspectiveCamera; height: number; closeUp?: boolean }): void;
  setStyle(style: BallStyle): void;
  setColour(colour: 'red' | 'white'): void;
  dispose(): void;
}

export function createBall(glowTex: Texture): BallFx {
  const group = new Group();
  const ball = new Group();
  ball.name = 'cricket-ball';
  // Two real hemispheres, rather than a painted lighting trick: local -x is the maintained/shiny side and local +x
  // is the weathered side. Both, the seam and the scuffs are children of `ball`, so the one physics quaternion below
  // turns the complete surface together around the simulation's spin axis.
  const polishedMaterial = new MeshStandardMaterial({ color: '#faf9f4', roughness: 0.2, metalness: 0.02 });
  polishedMaterial.name = 'ball-polished-material';
  const roughMaterial = new MeshStandardMaterial({ color: '#dedbd2', roughness: 0.82, metalness: 0 });
  roughMaterial.name = 'ball-rough-material';
  const polished = new Mesh(new SphereGeometry(BALL_R, 24, 16, Math.PI, Math.PI), polishedMaterial);
  polished.name = 'ball-polished-half';
  const rough = new Mesh(new SphereGeometry(BALL_R, 24, 16, 0, Math.PI), roughMaterial);
  rough.name = 'ball-rough-half';
  // SphereGeometry's phi halves meet on local z=0; turn that common great circle onto x=0, the raised seam's plane.
  polished.rotation.y = rough.rotation.y = Math.PI / 2;
  polished.castShadow = rough.castShadow = true;
  const seam = new Mesh(new TorusGeometry(BALL_R * 1.005, 0.0032, 4, 28), new MeshStandardMaterial({ color: '#1f5d3f', roughness: 0.6 }));
  seam.name = 'ball-raised-seam';
  seam.rotation.set(0, Math.PI / 2, 0);
  const scuffMaterial = new MeshStandardMaterial({ color: '#77716a', roughness: 1, metalness: 0 });
  scuffMaterial.name = 'ball-scuff-material';
  const scuffs = [
    { y: 0.012, z: 0.006, ry: -0.12, arc: 0.42 },
    { y: -0.009, z: -0.011, ry: 0.08, arc: 0.34 },
    { y: 0.002, z: -0.018, ry: 0.18, arc: 0.28 },
  ].map((mark, index) => {
    const mesh = new Mesh(new TorusGeometry(BALL_R * 1.008, 0.00065, 3, 8, mark.arc), scuffMaterial);
    mesh.name = `ball-scuff-${index + 1}`;
    // Short, irregular marks live on the rough hemisphere only. Their local placement never changes independently;
    // the parent physics rotation carries them with the seam and the two sides.
    mesh.rotation.set(Math.PI / 2, mark.ry, index * 0.42 - 0.2);
    mesh.position.set(BALL_R * 0.006, mark.y, mark.z);
    return mesh;
  });
  ball.add(polished, rough, seam, ...scuffs);
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
  // Camera-facing dark surround, measured in CSS pixels. The transparent centre leaves the lit ball untouched.
  // This material is created up front, including the optional focus ring, so toggling it cannot compile a shader.
  const shadeMat = new ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { radius: { value: 2 }, extent: { value: 14 }, focus: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `varying vec2 vUv; uniform float radius; uniform float extent; uniform float focus;
      void main(){
        float px=length(vUv-0.5)*2.0*extent-radius;
        if(px<0.0) discard;
        float a=px<=${PRACTICE_BALL.shade.rimPx.toFixed(2)} ? ${PRACTICE_BALL.shade.rimOpacity.toFixed(2)} : ${PRACTICE_BALL.shade.opacity.toFixed(2)}*(1.0-smoothstep(${PRACTICE_BALL.shade.rimPx.toFixed(2)},${PRACTICE_BALL.shade.px.toFixed(2)},px));
        float ring=focus*(1.0-smoothstep(0.3,${PRACTICE_BALL.focus.widthPx.toFixed(2)},abs(px-${PRACTICE_BALL.focus.gapPx.toFixed(2)})))*${PRACTICE_BALL.focus.opacity.toFixed(2)};
        gl_FragColor=vec4(mix(vec3(0.0196,0.0235,0.0588),vec3(0.914,0.984,1.0),step(a,ring)),max(a,ring));
      }`,
  });
  const shade = new Mesh(new PlaneGeometry(1, 1), shadeMat);
  shade.name = 'practice-ball-surround';
  shade.visible = false;
  group.add(shade);
  let style: BallStyle = MATCH_BALL_STYLE;
  const polishedPole = new Vector3(-1, 0, 0);
  const qa = new Quaternion();
  const ownAxis = new Vector3();
  const basisX = new Vector3();
  const basisY = new Vector3();
  const basisZ = new Vector3();
  const basisMatrix = new Matrix4();

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
  const viewPos = new Vector3();

  return {
    group,
    matchOnlyMeshes: [outline, glow],
    update(script, t, handPos, slow, trailPoints, camPos, view) {
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
      const usePixels = Boolean(style.practice && view);
      const focal = view ? view.height / (2 * Math.tan(view.camera.fov * Math.PI / 360)) : 1;
      const depth = view ? Math.max(0.05, -viewPos.copy(ball.position).applyMatrix4(view.camera.matrixWorldInverse).z) : 1;
      const diameter = view?.closeUp ? closeUpBallDiameterPx(view.height) : ballDiameterPx(depth, focal);
      const metresPerPixel = depth / focal;
      ball.scale.setScalar(usePixels ? diameter * metresPerPixel / (2 * BALL_R) : style.visualScale);
      shade.visible = usePixels && (s.inFlight || Boolean(view?.closeUp));
      if (shade.visible && view) {
        const extent = diameter / 2 + PRACTICE_BALL.shade.px;
        shade.position.copy(ball.position);
        shade.quaternion.copy(view.camera.quaternion);
        shade.scale.setScalar(2 * extent * metresPerPixel);
        shadeMat.uniforms.radius.value = diameter / 2;
        shadeMat.uniforms.extent.value = extent;
        shadeMat.uniforms.focus.value = style.focusAid ? 1 : 0;
      }
      let releaseSpinAxis: Vec3 | undefined;
      let releaseShineAxis: Vec3 | undefined;
      let releaseSurfaceTangent: Vec3 | undefined;
      if (view?.closeUp) {
        for (const segment of script.ball) {
          if (segment.k === 'path' && segment.spinAxis) {
            releaseSpinAxis = segment.spinAxis;
            releaseShineAxis = segment.shineAxis;
            releaseSurfaceTangent = segment.surfaceTangent;
            break;
          }
        }
      }
      const spinAxis = s.spinAxis ?? releaseSpinAxis;
      const shineAxis = s.shineAxis ?? releaseShineAxis;
      const surfaceTangent = s.surfaceTangent ?? releaseSurfaceTangent;
      if (spinAxis && shineAxis) {
        // At release local −X (the polished pole) is the exact BallFlight.shine direction. The complete rigid surface
        // then rotates around ballRotation(flight), so a cutter's distinct seam axis visibly wobbles rather than being
        // collapsed onto spin. Since shine is ± the seam normal, the raised great circle is aligned at the same time.
        if (surfaceTangent) {
          // Two non-collinear material axes preserve the complete rigid orientation. Local −X is polished, +Y is the
          // carried texture tangent; the third axis is reconstructed orthonormally rather than chosen anew at bounce.
          basisX.set(-shineAxis.x, -shineAxis.y, -shineAxis.z).normalize();
          basisY.set(surfaceTangent.x, surfaceTangent.y, surfaceTangent.z);
          basisY.addScaledVector(basisX, -basisY.dot(basisX)).normalize();
          basisZ.crossVectors(basisX, basisY).normalize();
          basisY.crossVectors(basisZ, basisX).normalize();
          basisMatrix.makeBasis(basisX, basisY, basisZ);
          qa.setFromRotationMatrix(basisMatrix);
        } else {
          // Legacy/match paths carry no material tangent: retain their prior pole-only orientation exactly.
          qa.setFromUnitVectors(polishedPole, ownAxis.set(shineAxis.x, shineAxis.y, shineAxis.z).normalize());
        }
        ownAxis.set(spinAxis.x, spinAxis.y, spinAxis.z).normalize();
        sq.setFromAxisAngle(ownAxis, s.spin);
        ball.quaternion.copy(sq).multiply(qa);
      } else ball.quaternion.identity(); // in a hand
      glow.position.copy(ball.position);
      glow.quaternion.copy(new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(camPos, glow.position, new Vector3(0, 1, 0))));
      const dCam = camPos.distanceTo(ball.position);
      glow.scale.setScalar(clamp(dCam * style.glowPerMetre, 0.12 * style.visualScale, 1.4));
      (glow.material as MeshBasicMaterial).opacity = s.inFlight ? style.glowOpacity : style.glowOpacity * 0.5;
      glow.visible = !style.practice && style.glowOpacity > 0;
      if (style.shadow) {
        // A soft dark disc on the ground under the ball: crisp and strong near the ground, fainter and wider high up.
        const h = Math.max(0, s.pos.y);
        shadow.visible = s.pos.y < 12;
        shadow.position.set(s.pos.x, 0.018, s.pos.z);
        shadow.scale.setScalar(BALL_R * style.visualScale * (1.6 + h * 0.5));
        (shadow.material as MeshBasicMaterial).opacity = 0.7 * (1 - clamp(h / 7, 0, 0.85));
      }
      // Trail
      const n = style.practice ? PRACTICE_BALL.trace.samples : Math.min(MAX, Math.max(4, Math.round(trailPoints * (slow ? 1.4 : 1))));
      const dt = style.practice ? PRACTICE_BALL.trace.stepMs : slow ? 9 : 14;
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
        const sampleDepth = view ? Math.max(0.05, -viewPos.copy(p).applyMatrix4(view.camera.matrixWorldInverse).z) : depth;
        const w = usePixels ? traceWidthPx(i, count, diameter) * sampleDepth / focal / 2 : width * (0.25 + 0.75 * k);
        positions.set([p.x + side.x * w, p.y + side.y * w, p.z + side.z * w, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w], i * 6);
        const a = i < count ? style.practice ? traceAlpha(i, count) : k * k * (slow ? 0.9 : 0.65) * style.trailAlpha : 0;
        alphas[i * 2] = a;
        alphas[i * 2 + 1] = a;
      }
      trailGeo.attributes.position.needsUpdate = true;
      trailGeo.attributes.alpha.needsUpdate = true;
      trail.visible = count > 2;
    },
    setStyle(next) {
      style = next;
      outline.visible = next.outline && !next.practice;
      shadow.visible = next.shadow;
    },
    setColour(colour) {
      polishedMaterial.color.set(colour === 'red' ? '#b52b34' : '#faf9f4');
      roughMaterial.color.set(colour === 'red' ? '#8d1f28' : '#dedbd2');
      seam.material.color.set(colour === 'red' ? '#e1c6a3' : '#1f5d3f');
      scuffMaterial.color.set(colour === 'red' ? '#51151b' : '#77716a');
    },
    dispose() {
      polished.geometry.dispose();
      rough.geometry.dispose();
      polishedMaterial.dispose();
      roughMaterial.dispose();
      seam.geometry.dispose();
      seam.material.dispose();
      for (const scuff of scuffs) scuff.geometry.dispose();
      scuffMaterial.dispose();
      glow.geometry.dispose();
      glow.material.dispose();
      shade.geometry.dispose();
      shadeMat.dispose();
      outline.geometry.dispose();
      (outline.material as MeshBasicMaterial).dispose();
      shadowGeo.dispose();
      (shadow.material as MeshBasicMaterial).dispose();
      trailGeo.dispose();
      trailMat.dispose();
    },
  };
}
