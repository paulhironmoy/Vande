/**
 * The one Three.js scene behind every 3D presentation: the WebGL renderer, the stadium, the players, the ball, the
 * stumps and the effects, and the posing of one choreography script at one scene time. The match renderer
 * (ThreeMatchRenderer: live batting, replays, highlights) and the Practice stage (ThreePracticeStage: first-person
 * batting) both draw through it. Everything is a function of (script, scene time), so offline frames and replays
 * are deterministic.
 */
import {
  ACESFilmicToneMapping,
  CanvasTexture,
  Mesh,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Texture,
} from 'three';
import { RendererUnavailableError, type Conditions, type KitSpec } from '@/contracts';
import type { QualityPreset } from '../core/quality';
import { evaluateActor, type ActorTrack } from '../core/actors';
import { blendPose, createPose, mirrorSampledPose, overlayLower, sampleClip, type SampledPose } from '../core/clips';
import type { CameraPose } from '../core/camera';
import { crowdAt, type BallScript } from '../core/choreo';
import type { BatPose } from '../practice/frame';
import { HANDS_FROM_TOP } from '@/physics/constants';
import { TOP_HAND_FROM_TOP } from '../practice/bat';
import { createStadium, glowTexture, towerPos, TOWER_ANGLES, type Stadium } from './stadium';
import { applyAim, applyPose, boneWorld, createRig, dressRig, reachIK, type Gear, type PlayerRig } from './players';
import { createBall, createBat, createBlobShadows, createEventFx, createStumps, placeBat, placeBatSpan, type BallFx, type BlobShadows, type EventFx, type StumpsFx } from './props';

export function shadowTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 18, 2, 32, 40, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

const GEAR_FOR: Record<string, Gear> = { striker: 'batter', nonStriker: 'batter', keeper: 'keeper', bowler: 'bowler', umpire: 'umpire', umpire2: 'umpire' };

export interface StageRendererOptions {
  antialias: boolean;
  preserveDrawingBuffer: boolean;
}

export interface ScriptDrawOptions {
  kits: [KitSpec, KitSpec];
  slow: boolean;
  /** Stadium clock (sky, crowd, boards), ms. */
  clockMs: number;
  reducedMotion: boolean;
  /** Actors left out of this frame (the first-person batter's own body). */
  hidden?: ReadonlySet<string>;
  /** A bat placed from physics (world) for one actor, its hands reaching for the handle. */
  bat?: { actor: string; pose: BatPose } | null;
  /** Adjusts an actor's sampled pose before it is mirrored and applied (the bowler's release cues). */
  poseHook?: (track: ActorTrack, pose: SampledPose, t: number) => void;
}

export class StageScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(30, 1, 0.1, 1200);
  readonly stadium: Stadium;
  readonly ballFx: BallFx;
  readonly stumpsFx: StumpsFx;
  readonly eventFx: EventFx;
  readonly blobs: BlobShadows;
  readonly glowTex: Texture;
  private readonly rigs = new Map<string, PlayerRig>();
  private readonly bats = new Map<string, Mesh>();
  private readonly mirrored = new Map<string, boolean>();
  private readonly pose: SampledPose = createPose();
  private readonly poseB: SampledPose = createPose();
  private readonly lower: SampledPose = createPose();
  private readonly towers: Vector3[] = TOWER_ANGLES.map(towerPos);
  preset: QualityPreset;

  /** Creates the WebGL renderer, or throws RendererUnavailableError. */
  static createRenderer(canvas: HTMLCanvasElement, o: StageRendererOptions): WebGLRenderer {
    try {
      return new WebGLRenderer({ canvas, antialias: o.antialias, powerPreference: 'high-performance', preserveDrawingBuffer: o.preserveDrawingBuffer, alpha: false });
    } catch (err) {
      throw new RendererUnavailableError(err instanceof Error ? err.message : 'no_webgl');
    }
  }

  constructor(
    readonly renderer: WebGLRenderer,
    preset: QualityPreset,
  ) {
    this.preset = preset;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.type = PCFShadowMap;
    this.stadium = createStadium(this.scene, preset);
    this.glowTex = glowTexture();
    this.ballFx = createBall(this.glowTex);
    this.stumpsFx = createStumps();
    this.eventFx = createEventFx(this.glowTex);
    this.blobs = createBlobShadows(shadowTexture());
    this.scene.add(this.ballFx.group, this.stumpsFx.group, this.eventFx.group, this.blobs.mesh);
  }

  /** Applies a preset: shadows, crowd, light shafts, player detail. */
  applyPreset(p: QualityPreset) {
    this.preset = p;
    const shadows = p.shadowMap > 0;
    this.renderer.shadowMap.enabled = shadows;
    this.stadium.keyLight.castShadow = shadows;
    if (shadows) {
      this.stadium.keyLight.shadow.mapSize.set(p.shadowMap, p.shadowMap);
      this.stadium.keyLight.shadow.map?.dispose();
      this.stadium.keyLight.shadow.map = null as unknown as typeof this.stadium.keyLight.shadow.map;
    }
    this.stadium.setQuality(p);
    for (const rig of this.rigs.values()) {
      rig.lod.levels[1].distance = p.lodDistance;
      rig.meshes[0].castShadow = shadows;
    }
  }

  setSize(w: number, h: number, pixelRatio: number) {
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setConditions(c: Conditions, kits: [KitSpec, KitSpec]) {
    this.stadium.setConditions(c);
    this.stadium.setTeams(kits[0], kits[1]);
  }

  /**
   * Compiles every material in the scene and finishes linking now, while the stage loads. Drivers (SwiftShader above
   * all) defer the real work to a program's first use, which for the ball trail, the impact flash, the seal ring and
   * the particles is the moment of contact: a 100–650 ms stall exactly when the timing matters. Touching each program
   * here moves that cost to the load. Returns how long it took (ms).
   */
  prewarm(): number {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      this.renderer.compile(this.scene, this.camera);
      for (const program of this.renderer.info.programs ?? []) (program as { getUniforms?: () => unknown }).getUniforms?.();
    } catch {
      /* an optimisation only */
    }
    return (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  }

  drawCalls(): number {
    return this.renderer.info.render.calls;
  }

  private rig(track: ActorTrack): PlayerRig {
    let rig = this.rigs.get(track.id);
    const gear: Gear = GEAR_FOR[track.id] ?? 'fielder';
    if (!rig || rig.gear !== gear) {
      if (rig) this.scene.remove(rig.root);
      rig = createRig(gear, this.preset.lodDistance);
      this.rigs.set(track.id, rig);
      this.scene.add(rig.root);
    }
    return rig;
  }

  /** The rig for an actor id, if it has been created (for measurements such as the bowler's release hand). */
  rigOf(id: string): PlayerRig | undefined {
    return this.rigs.get(id);
  }

  private bat(id: string): Mesh {
    let b = this.bats.get(id);
    if (!b) {
      b = createBat();
      this.bats.set(id, b);
      this.scene.add(b);
    }
    return b;
  }

  private copyPose(src: SampledPose, dst: SampledPose) {
    dst.q.set(src.q);
    dst.root = [...src.root] as [number, number, number];
    dst.aimR = src.aimR;
    dst.aimL = src.aimL;
    dst.bat = src.bat;
    dst.twoHands = src.twoHands;
  }

  /** Poses one actor at scene time t. */
  poseActor(track: ActorTrack, t: number, kits: [KitSpec, KitSpec], batOverride: BatPose | null, hook?: ScriptDrawOptions['poseHook']) {
    const rig = this.rig(track);
    const mirror = Boolean(track.mirror);
    this.mirrored.set(track.id, mirror);
    dressRig(rig, track.look, kits[track.look.team]);
    const st = evaluateActor(track, t);
    const pose = sampleClip(st.current.clip, st.current.time, this.pose);
    if (st.current.lower) overlayLower(pose, sampleClip(st.current.lower, st.current.lowerTime ?? 0, this.lower));
    if (st.previous && st.weight < 1) {
      const prev = sampleClip(st.previous.clip, st.previous.time, this.poseB);
      if (st.previous.lower) overlayLower(prev, sampleClip(st.previous.lower, st.previous.lowerTime ?? 0, this.lower));
      blendPose(prev, pose, st.weight);
      this.copyPose(prev, pose);
    }
    hook?.(track, pose, t);
    if (mirror) mirrorSampledPose(pose);
    rig.root.position.set(st.pos.x, 0, st.pos.z);
    rig.root.rotation.set(0, st.heading, 0);
    applyPose(rig, pose);
    rig.root.updateMatrixWorld(true);
    if (pose.aimR) applyAim(rig, 'R', pose.aimR[0], pose.aimR[1]);
    if (pose.aimL) applyAim(rig, 'L', pose.aimL[0], pose.aimL[1]);
    const isBatter = track.id === 'striker' || track.id === 'nonStriker';
    if (isBatter) {
      const bat = this.bat(track.id);
      bat.visible = true;
      const m = mirror ? -1 : 1;
      const bottom = mirror ? 'L' : 'R';
      const top = mirror ? 'R' : 'L';
      const s = rig.scale;
      if (batOverride) {
        // The physics bat: placed exactly, the hands reach for its handle.
        placeBatSpan(bat, batOverride.grip, batOverride.toe, batOverride.face);
        const g = new Vector3(batOverride.grip.x, batOverride.grip.y, batOverride.grip.z);
        const dir = new Vector3(batOverride.toe.x - g.x, batOverride.toe.y - g.y, batOverride.toe.z - g.z).normalize();
        reachIK(rig, bottom, g.clone().addScaledVector(dir, HANDS_FROM_TOP), rig.root.localToWorld(new Vector3(-0.45 * m, 0.9, -0.1).multiplyScalar(s)));
        reachIK(rig, top, g.clone().addScaledVector(dir, TOP_HAND_FROM_TOP), rig.root.localToWorld(new Vector3(0.55 * m, 0.9, 0.05).multiplyScalar(s)));
      } else if (pose.bat) {
        const grip = new Vector3(pose.bat.grip[0], pose.bat.grip[1], pose.bat.grip[2]).multiplyScalar(s);
        const dir = new Vector3(pose.bat.dir[0], pose.bat.dir[1], pose.bat.dir[2]).normalize();
        rig.root.localToWorld(grip);
        dir.applyQuaternion(rig.root.quaternion);
        const towardsBowler = new Vector3(m, 0, 0).applyQuaternion(rig.root.quaternion);
        placeBat(bat, grip, dir, towardsBowler);
        const poleR = rig.root.localToWorld(new Vector3(-0.45 * m, 0.9, -0.1).multiplyScalar(s));
        reachIK(rig, bottom, grip, poleR);
        if (pose.twoHands) {
          const topAt = grip.clone().addScaledVector(dir, -(HANDS_FROM_TOP - TOP_HAND_FROM_TOP));
          const poleL = rig.root.localToWorld(new Vector3(0.55 * m, 0.9, 0.05).multiplyScalar(s));
          reachIK(rig, top, topAt, poleL);
        }
      } else {
        // Carried in the bottom hand, toe down.
        const grip = boneWorld(rig, mirror ? 'handL' : 'handR').add(new Vector3(0, -0.04, 0));
        placeBat(bat, grip, new Vector3(0.12 * m, -0.98, 0.15).applyQuaternion(rig.root.quaternion).normalize(), new Vector3(0, 0, 1).applyQuaternion(rig.root.quaternion));
      }
    }
    this.blobs.add(st.pos.x, st.pos.z, this.towers, this.preset.blobShadows, rig.scale);
  }

  /** The hand that holds the ball for an actor (the bowling hand of a mirrored, left-arm bowler is its left). */
  handOf(id: string): Vector3 | null {
    const rig = this.rigs.get(id);
    if (!rig || !rig.root.visible) return null;
    const mirror = this.mirrored.get(id) ?? false;
    const p = boneWorld(rig, mirror ? 'handL' : 'handR');
    if (id === 'keeper') return boneWorld(rig, mirror ? 'handR' : 'handL').add(p).multiplyScalar(0.5);
    return p;
  }

  /**
   * Poses the whole script at scene time t and points the camera (the caller renders). Everything is evaluated from
   * scene time, so the same (script, t, camera) always gives the same frame.
   */
  drawScript(script: BallScript, t: number, cam: CameraPose, o: ScriptDrawOptions) {
    const used = new Set<string>();
    this.blobs.begin();
    for (const track of script.actors) {
      // An actor the camera must not show is not posed at all (the first-person batter's own body).
      if (o.hidden?.has(track.id)) continue;
      this.poseActor(track, t, o.kits, o.bat && o.bat.actor === track.id ? o.bat.pose : null, o.poseHook);
      used.add(track.id);
    }
    for (const [id, rig] of this.rigs) rig.root.visible = used.has(id);
    for (const [id, bat] of this.bats) bat.visible = used.has(id);
    this.blobs.end();

    this.camera.position.set(cam.pos.x, cam.pos.y, cam.pos.z);
    this.camera.lookAt(cam.target.x, cam.target.y, cam.target.z);
    if (Math.abs(this.camera.fov - cam.fov) > 0.01) {
      this.camera.fov = cam.fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
    for (const rig of this.rigs.values()) {
      if (!rig.root.visible) continue;
      rig.lod.update(this.camera);
      // three.js (r186) can skip a shared skeleton's update for one frame after a shadow pass (its frame counter
      // increments between projection and the shadow map), which would skin with last frame's bones. Updating
      // explicitly keeps every frame exact, which offline renderAt relies on.
      rig.skeleton.update();
    }

    // Ball, stumps, effects
    this.ballFx.update(script, t, (id) => this.handOf(id), o.slow, this.preset.trailPoints, this.camera.position);
    this.stumpsFx.update(script, t);
    this.eventFx.update(script, t, this.camera.position, this.preset.particles, o.reducedMotion);

    // Stadium life: crowd, boards flash on boundaries and wickets.
    const crowd = crowdAt(script, t);
    this.stadium.setTime(o.clockMs);
    this.stadium.setExcitement(crowd);
    let flash = 0;
    let color: 'cyan' | 'amber' | 'wicket' = 'cyan';
    for (const e of script.events) {
      const dt = t - e.t;
      if (dt < 0 || dt > 2600) continue;
      if (e.kind === 'boundary' || e.kind === 'six' || e.kind === 'stumps' || e.kind === 'catch' || (e.kind === 'signal' && e.intensity > 0.9)) {
        flash = Math.max(flash, 1 - dt / 2600);
        color = e.kind === 'six' ? 'amber' : e.kind === 'boundary' ? 'cyan' : 'wicket';
      }
    }
    this.stadium.setBoardFlash(o.reducedMotion ? flash * 0.5 : flash, color);
    const glows = this.stadium.group.userData.glows as Mesh[] | undefined;
    if (glows) for (const g of glows) g.quaternion.copy(this.camera.quaternion);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.stadium.dispose();
    this.ballFx.dispose();
    this.stumpsFx.dispose();
    this.eventFx.dispose();
    this.blobs.dispose();
    this.glowTex.dispose();
    for (const rig of this.rigs.values()) rig.material.dispose();
    for (const bat of this.bats.values()) {
      bat.geometry.dispose();
      (bat.material as { dispose(): void }).dispose();
    }
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.scene.clear();
  }
}
