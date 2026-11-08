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
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  Vector4,
  WebGLRenderer,
  type Object3D,
  type Texture,
} from 'three';
import { RendererUnavailableError, type Conditions, type KitSpec } from '@/contracts';
import type { QualityPreset } from '../core/quality';
import { evaluateActor, type ActorTrack } from '../core/actors';
import { aimWeight, createPose, mirrorSampledPose, samplePresented, setWeightedAims, type SampledPose } from '../core/clips';
import type { CameraPose } from '../core/camera';
import { crowdAt, sampleBall, type BallScript } from '../core/choreo';
import type { BatPose } from '../practice/frame';
import type { PracticeInfo } from '../practice/script';
import { createStadium, glowTexture, towerPos, TOWER_ANGLES, type Stadium, type StadiumSignage } from './stadium';
import { applyAim, applyDirectedHead, applyPose, ballInHand, boneWorld, createRig, dressRig, holdBat, limitArms, setRigFace, setRigShadowPolicy, type Gear, type PlayerRig } from './players';
import { FACE, frameBegin } from '../core/motion/director/stage/face';
import { createBat, createBlobShadows, createEventFx, createStumps, type BlobShadows, type EventFx, type StumpsFx } from './props';
import { createBall, type BallFx } from './ball';
import { emotionAt, type EmotionState } from '../practice/emotion';
import { insetMoment, insetTarget, paintFieldInset, type InsetMoment } from '../fallback2d/topDown';
import { InsetGround, insetBlocked } from './pip';

function shadowTexture(): Texture {
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

// ---------------------------------------------------------------------------------------------------------------
// The release reach: the last centimetres between the drawn palm and the physics release point
// ---------------------------------------------------------------------------------------------------------------

/**
 * The physics release point is authoritative, while the drawn palm at the release marker is a few centimetres off it
 * (a delivery's cue turns the wrist, a yorker or a bouncer leaves the hand lower or higher than the stock ball, a speed
 * moves the point). That residual is taken up as a ramp that is 0 until `leadMs` before the release, 1 at the release
 * (the ball then leaves from exactly the first flight sample) and 0 again `tailMs` after it. It is applied by the
 * trunk's side flexion (at most `trunkMaxDeg` in all, split over spine and chest: it lifts or lowers the shoulder, which
 * a straight arm cannot do by itself) and the shoulder's turn. The elbow, the wrist and the clip's palm path are never
 * touched, so the bowling arm stays the authored, legal one (the old block dragged the hand to the point and folded the
 * elbow to 100°). The feet and the hips are the planted-feet plan's and stay where it puts them.
 */
export const RELEASE_REACH = { leadMs: 200, tailMs: 160, trunkMaxDeg: 6 } as const;

const smooth01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** The residual's weight at scene time t: a C1 ramp to 1 at the release, a C1 ramp back to 0 after it. */
export function releaseReachWeight(t: number, releaseScene: number): number {
  return t <= releaseScene ? smooth01((t - (releaseScene - RELEASE_REACH.leadMs)) / RELEASE_REACH.leadMs) : 1 - smooth01((t - releaseScene) / RELEASE_REACH.tailMs);
}

const reachQ = new Quaternion();
const reachParentQ = new Quaternion();
const reachWorldQ = new Quaternion();
const reachA = new Vector3();
const reachB = new Vector3();
const reachShoulder = new Vector3();

/** Turns a bone about its own origin by a world-space rotation; its subtree follows. */
function turnBoneWorld(bone: Object3D, q: Quaternion) {
  bone.getWorldQuaternion(reachWorldQ).premultiply(q);
  bone.parent!.getWorldQuaternion(reachParentQ).invert();
  bone.quaternion.copy(reachParentQ.multiply(reachWorldQ));
  bone.updateWorldMatrix(false, true);
}

/**
 * Moves the ball in a bowler's palm by `w · delta` (world) with the trunk's side flexion and the shoulder alone: the
 * flexion puts the shoulder where the straight arm's length reaches the wanted point, the shoulder then turns the
 * arm (rigidly: the elbow angle, the forearm and the hand keep their authored rotations) onto it. Returns the miss (m)
 * left when the flexion is at its limit.
 */
export function reachRelease(rig: PlayerRig, side: 'L' | 'R', delta: Vector3, w: number): number {
  const upper = rig.boneMap[`upperArm${side}`];
  const spine = rig.boneMap.spine;
  const chest = rig.boneMap.chest;
  const palm = ballInHand(rig, side);
  const want = palm.clone().addScaledVector(delta, w);
  const radius = boneWorld(rig, `upperArm${side}`, reachShoulder).distanceTo(palm);
  const heading = rig.root.rotation.y;
  const axis = new Vector3(Math.sin(heading), 0, Math.cos(heading));
  const keepSpine = spine.quaternion.clone();
  const keepChest = chest.quaternion.clone();
  const flex = (rad: number) => {
    reachQ.setFromAxisAngle(axis, rad / 2);
    turnBoneWorld(spine, reachQ);
    turnBoneWorld(chest, reachQ);
  };
  // The shoulder's distance to the wanted point, less the arm's reach, after a side flexion of `rad` (then undone).
  const miss = (rad: number) => {
    flex(rad);
    const d = boneWorld(rig, `upperArm${side}`, reachShoulder).distanceTo(want) - radius;
    spine.quaternion.copy(keepSpine);
    chest.quaternion.copy(keepChest);
    spine.updateWorldMatrix(false, true);
    return d;
  };
  const limit = (RELEASE_REACH.trunkMaxDeg * Math.PI) / 180;
  const clampRad = (x: number) => Math.max(-limit, Math.min(limit, x));
  let rad = 0;
  let left = miss(0);
  if (Math.abs(left) > 2e-4) {
    const step = limit / RELEASE_REACH.trunkMaxDeg;
    const slope = (miss(step) - left) / step;
    if (Math.abs(slope) > 1e-3) {
      let a = clampRad(-left / slope);
      let g = miss(a);
      if (Math.abs(g) > 2e-4 && Math.abs(a) > 1e-6 && Math.abs(a) < limit) {
        const s2 = (g - left) / a;
        if (Math.abs(s2) > 1e-3) {
          const b = clampRad(a - g / s2);
          const h = miss(b);
          if (Math.abs(h) < Math.abs(g)) {
            a = b;
            g = h;
          }
        }
      }
      if (Math.abs(g) < Math.abs(left)) {
        rad = a;
        left = g;
      }
    }
  }
  if (rad !== 0) flex(rad);
  // The shoulder's turn: the palm's direction from the shoulder onto the wanted point's.
  ballInHand(rig, side, reachA);
  boneWorld(rig, `upperArm${side}`, reachShoulder);
  reachA.sub(reachShoulder).normalize();
  reachB.copy(want).sub(reachShoulder).normalize();
  reachQ.setFromUnitVectors(reachA, reachB);
  turnBoneWorld(upper, reachQ);
  return Math.abs(left);
}

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
  /** The live soundscape's causal crowd state; replays derive the same phases from their own script clock. */
  emotion?: Pick<EmotionState, 'arousal' | 'valence' | 'expectation'>;
  /** Training inspection only: preserve the same ball and physics rotation, but allow its surface to fill the view. */
  ballCloseUp?: boolean;
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
  private cssHeight = 1;
  /** The field inset (render()): the Practice script and scene time this frame was posed at, and what it showed. */
  private insetScript: BallScript | null = null;
  private insetT = 0;
  private insetShown: InsetMoment | null = null;
  private insetGround: InsetGround | null = null;
  /** The inset stays aside until this time (performance ms) once protected geometry reached it: no flicker. */
  private insetAsideUntil = 0;
  /** The Practice stage's first-person bat, gloves and forearms (firstPerson.ts names its group), for the guard. */
  private insetFirstPerson: Object3D | null = null;
  /**
   * The release residual per delivery script (and the pose hook it was measured with): the physics release point less
   * the palm as drawn at the release. Created on first use (the repo's tests build a StageScene without its constructor).
   */
  private reachDelta?: WeakMap<BallScript, { hook: ScriptDrawOptions['poseHook']; delta: Vector3 }>;
  /** Scene time (ms) from which the bowler's arms are held to the speed cap (`limitArms`): once the release reach has let go of them. */
  private armsFreeAt = Number.POSITIVE_INFINITY;
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
    /** Practice draws neutral boundary boards; the match keeps its own lines. */
    signage: StadiumSignage = 'match',
  ) {
    this.preset = preset;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.type = PCFShadowMap;
    this.stadium = createStadium(this.scene, preset, signage);
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
      setRigShadowPolicy(rig, shadows);
    }
  }

  setSize(w: number, h: number, pixelRatio: number) {
    this.cssHeight = Math.max(1, h);
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
   *
   * With `presets` (Practice passes just its active profile, at mount or between balls, F-017), it draws one frame per preset into a
   * 1×1 viewport with everything shown: both levels of every player's LOD, every hidden effect, no frustum culling, and
   * the shadow pass. renderer.compile() alone compiles one variant per material (the first object's) and never the
   * shadow pass's depth programs, and a preset changes the programs (shadows on or off), so a step down between balls
   * must warm its variants before the next run-up. Three.js keeps each material's programs per variant/context and
   * reuses them on later visits. There is no cache outside the renderer to become stale on context restoration.
   * The current preset is drawn last and stays. Unselected profiles need not delay a player's first ball.
   */
  prewarm(presets?: readonly QualityPreset[]): number {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      if (presets && presets.length) {
        const current = this.preset;
        const order = [...presets.filter((p) => p !== current && p.quality !== current.quality), current];
        const restore = this.showEverything();
        try {
          for (const p of order) {
            this.applyPreset(p);
            this.renderer.compile(this.scene, this.camera);
            this.renderTiny();
          }
        } finally {
          restore();
          if (this.preset !== current) this.applyPreset(current);
        }
      } else this.renderer.compile(this.scene, this.camera);
      for (const program of this.renderer.info.programs ?? []) (program as { getUniforms?: () => unknown }).getUniforms?.();
    } catch {
      /* an optimisation only */
    }
    return (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  }

  /**
   * Warm only assets reachable in the current Practice renderer. The generic match/dev warm-up remains unchanged.
   * Practice uses wooden stumps, its ball surround, Coach overlay bats and the full-rig Coach ghost, never the legacy
   * glow/ring/flash. If an excluded effect becomes reachable, remove its exclusion before enabling that feature.
   * Three.compile traverses invisible objects, so visibility alone cannot avoid their first-use program cost.
   */
  prewarmPractice(preset: QualityPreset): number {
    const excluded = new Set<Object3D>([
      ...this.ballFx.matchOnlyMeshes,
      ...this.eventFx.matchOnlyMeshes,
      ...this.stumpsFx.ledMeshes,
    ]);
    const entries: Array<{ object: Object3D; parent: Object3D; index: number }> = [];
    for (const object of excluded) {
      let ancestor = object.parent;
      while (ancestor && !excluded.has(ancestor)) ancestor = ancestor.parent;
      // Removing an ancestor already excludes its descendants, whose own parent/ordering stays untouched.
      if (!ancestor && object.parent) entries.push({ object, parent: object.parent, index: object.parent.children.indexOf(object) });
    }
    const detached: typeof entries = [];
    try {
      for (const entry of entries) {
        // Synchronous private traversal scope, not a lifetime change: retain arrays/assets and emit no add/remove
        // events. Save all indices first so adjacent exclusions can be restored to their exact original slots.
        entry.parent.children.splice(entry.parent.children.indexOf(entry.object), 1);
        entry.object.parent = null;
        detached.push(entry);
      }
      return this.prewarm([preset]);
    } finally {
      for (const { object, parent, index } of detached.sort((a, b) => a.index - b.index)) {
        parent.children.splice(index, 0, object);
        object.parent = parent;
      }
    }
  }

  /** Programs the renderer holds (compiled and linked so far). */
  programCount(): number {
    return this.renderer.info.programs?.length ?? 0;
  }

  /**
   * Everything drawable, for one warm-up frame: every object shown and never culled (its own frustum test would skip
   * what the warm-up camera does not see), every LOD drawing all its levels. Returns the undo.
   */
  private showEverything(): () => void {
    const saved: Array<[{ visible: boolean; frustumCulled: boolean }, boolean, boolean]> = [];
    const lods: Array<[{ autoUpdate: boolean }, boolean]> = [];
    this.scene.traverse((o) => {
      saved.push([o, o.visible, o.frustumCulled]);
      o.visible = true;
      o.frustumCulled = false;
      const lod = o as unknown as { isLOD?: boolean; autoUpdate: boolean };
      if (lod.isLOD) {
        lods.push([lod, lod.autoUpdate]);
        lod.autoUpdate = false;
      }
    });
    return () => {
      for (const [o, visible, culled] of saved) {
        o.visible = visible;
        o.frustumCulled = culled;
      }
      for (const [lod, auto] of lods) lod.autoUpdate = auto;
    };
  }

  /** Every included object/material group at its real count. Main viewport 1×1; shadows keep their actual map. */
  private renderTiny() {
    const r = this.renderer;
    const viewport = r.getViewport(new Vector4());
    const scissor = r.getScissor(new Vector4());
    const scissorTest = r.getScissorTest();
    try {
      r.setViewport(0, 0, 1, 1);
      r.setScissor(0, 0, 1, 1);
      r.setScissorTest(true);
      r.render(this.scene, this.camera);
    } finally {
      r.setViewport(viewport);
      r.setScissor(scissor);
      r.setScissorTest(scissorTest);
    }
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

  /** Poses one actor at scene time t. */
  poseActor(track: ActorTrack, t: number, kits: [KitSpec, KitSpec], batOverride: BatPose | null, hook?: ScriptDrawOptions['poseHook']) {
    const rig = this.rig(track);
    const mirror = Boolean(track.mirror);
    this.mirrored.set(track.id, mirror);
    dressRig(rig, track.look, kits[track.look.team]);
    const st = evaluateActor(track, t);
    // The presented pose: the current clip crossfaded from whatever was on screen (nested crossfades included).
    const was = setWeightedAims(track.id === 'bowler');
    const pose = samplePresented(st, this.pose, this.poseB, this.lower);
    setWeightedAims(was);
    // The face-and-life Director's hooks (bowler and striker only) read the drawn heading and rig scale from here and leave
    // the lids and the iris for the shader in FACE (director/stage/face.ts); a rig they did not touch goes back to its own blink.
    frameBegin(track.id, t, st.heading, mirror, rig.scale);
    hook?.(track, pose, t);
    if (mirror) mirrorSampledPose(pose);
    // `st.body` is a presentation-only extension (a dive towards the ball); `st.pos` stays the physics position.
    rig.root.position.set(st.pos.x + (st.body?.x ?? 0), 0, st.pos.z + (st.body?.z ?? 0));
    rig.root.rotation.set(0, st.heading, 0);
    applyPose(rig, pose);
    rig.root.updateMatrixWorld(true);
    if (pose.aimR) applyAim(rig, 'R', pose.aimR[0], pose.aimR[1], aimWeight(pose.aimR));
    if (pose.aimL) applyAim(rig, 'L', pose.aimL[0], pose.aimL[1], aimWeight(pose.aimL));
    // The bowler's arms are held to the packs' speed cap once the release is behind him (the reach has let go of them by then).
    if (track.id === 'bowler' && t >= this.armsFreeAt) limitArms(rig, t);
    const isBatter = track.id === 'striker' || track.id === 'nonStriker';
    if (isBatter) {
      // The bat (physics, the clip's key, or carried) and both gloves closed round its handle: players.holdBat.
      const bat = this.bat(track.id);
      bat.visible = true;
      holdBat(rig, bat, batOverride, pose, mirror);
    }
    // The Director's head pass, on the finished bones: the glove solve above leans the batter's chest and spine to the
    // handle, so only now does the head point where it points. It also fills FACE: the lids and the iris for the shader
    // (an actor the Director did not sample goes back to its own periodic blink).
    applyDirectedHead(rig);
    setRigFace(rig, FACE);
    this.blobs.add(st.pos.x + (st.body?.x ?? 0), st.pos.z + (st.body?.z ?? 0), this.towers, this.preset.blobShadows, rig.scale);
  }

  /** The hand that holds the ball for an actor (the bowling hand of a mirrored, left-arm bowler is its left). */
  handOf(id: string): Vector3 | null {
    // `<actor>:throw`: the actor's throwing hand (the keeper holding the ball for a throw, like any fielder).
    const throwing = id.endsWith(':throw');
    const actor = throwing ? id.slice(0, -':throw'.length) : id;
    const rig = this.rigs.get(actor);
    if (!rig || !rig.root.visible) return null;
    const mirror = this.mirrored.get(actor) ?? false;
    // The ball in the palm (players.ts BALL_IN_HAND: the same point as MOTION-BOWL's and UNITY's).
    const p = ballInHand(rig, mirror ? 'L' : 'R');
    if (actor === 'keeper' && !throwing) return ballInHand(rig, mirror ? 'R' : 'L').add(p).multiplyScalar(0.5);
    return p;
  }

  /**
   * The release residual at scene time t, or null outside the ramp (or when there is none): the physics release point
   * less the palm as the bowler is drawn at the release instant (pose and hooks only, no reach). It is a function of the
   * script alone, measured once per script and pose hook.
   */
  private releaseReachAt(script: BallScript, p: PracticeInfo, t: number, o: ScriptDrawOptions): { delta: Vector3; w: number } | null {
    const w = releaseReachWeight(t, p.releaseScene);
    if (w <= 0) return null;
    const cache = (this.reachDelta ??= new WeakMap());
    let hit = cache.get(script);
    if (!hit || hit.hook !== o.poseHook) {
      const track = script.actors.find((a) => a.id === 'bowler');
      if (!track) return null;
      this.poseActor(track, p.releaseScene, o.kits, null, o.poseHook);
      const palm = ballInHand(this.rig(track), p.bowlerLeftArm ? 'L' : 'R');
      hit = { hook: o.poseHook, delta: new Vector3(p.releaseWorld.x - palm.x, p.releaseWorld.y - palm.y, p.releaseWorld.z - palm.z) };
      cache.set(script, hit);
    }
    return hit.delta.lengthSq() < 1e-8 ? null : { delta: hit.delta, w };
  }

  /**
   * Poses the whole script at scene time t and points the camera (the caller renders). Everything is evaluated from
   * scene time, so the same (script, t, camera) always gives the same frame.
   */
  drawScript(script: BallScript, t: number, cam: CameraPose, o: ScriptDrawOptions) {
    this.insetScript = script.practice ? script : null;
    this.insetT = t;
    this.armsFreeAt = script.practice?.flight ? script.practice.releaseScene + RELEASE_REACH.tailMs : Number.POSITIVE_INFINITY;
    const used = new Set<string>();
    // A delivery in its last moments before the release (a scene between balls has no release): the residual to take up.
    const reach = script.practice?.flight && !o.hidden?.has('bowler') ? this.releaseReachAt(script, script.practice, t, o) : null;
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

    // The physics release point is authoritative (the ball leaves from exactly the first flight sample), while the
    // drawn palm at the release marker is a few centimetres off it. The bowling arm's own clip is never bent to reach
    // it: the residual is ramped in by the trunk and the shoulder (reachRelease), and only for a delivery.
    const practice = script.practice;
    if (reach && practice) {
      const bowler = this.rigs.get('bowler');
      if (bowler?.root.visible) reachRelease(bowler, practice.bowlerLeftArm ? 'L' : 'R', reach.delta, reach.w);
    }

    // The director's pre-release ball-close target is the future release point, while the rendered ball is still
    // attached to the bowler's currently posed hand. Translate the complete camera pose to that exact same hand
    // sample used by BallFx: relative offset, orientation and FOV stay unchanged, and after release the delta is zero.
    const handAt = (id: string) => this.handOf(id);
    const closeUpBall = o.ballCloseUp ? sampleBall(script, t, handAt) : null;
    const dx = closeUpBall?.visible ? closeUpBall.pos.x - cam.target.x : 0;
    const dy = closeUpBall?.visible ? closeUpBall.pos.y - cam.target.y : 0;
    const dz = closeUpBall?.visible ? closeUpBall.pos.z - cam.target.z : 0;
    this.camera.position.set(cam.pos.x + dx, cam.pos.y + dy, cam.pos.z + dz);
    this.camera.lookAt(cam.target.x + dx, cam.target.y + dy, cam.target.z + dz);
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
    this.ballFx.update(script, t, handAt, o.slow, this.preset.trailPoints, this.camera.position, { camera: this.camera, height: this.cssHeight, closeUp: o.ballCloseUp });
    this.stumpsFx.update(script, t);
    this.eventFx.update(script, t, this.camera.position, this.preset.particles, o.reducedMotion);

    // Stadium life: crowd, boards flash on boundaries and wickets.
    const emotion = o.emotion ?? (script.practice ? emotionAt(script.practice.emotion, t) : null);
    const crowd = emotion?.arousal ?? crowdAt(script, t);
    this.stadium.setTime(o.clockMs);
    this.stadium.setExcitement(crowd);
    if (emotion) this.stadium.setCrowdMood(emotion.valence, emotion.expectation);
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
    const script = this.insetScript;
    const canvas = this.renderer.domElement as HTMLCanvasElement | undefined;
    // The field inset (fallback2d/topDown.ts; the Practice screen provides it). Premium and Balanced draw the real
    // ground under it from an overhead camera (three/pip.ts), captured between balls only, before this frame's own
    // render clears the buffer; Lite keeps the plain field. Players and the ball are placed from the physics. The
    // inset can never cost the frame itself: whatever it throws, the stage renders and it simply shows nothing.
    let target: ReturnType<typeof insetTarget>;
    const real = this.preset.quality !== 'low';
    try {
      target = script && canvas ? insetTarget(canvas) : null;
      if (target && real && (this.insetShown === 'calm' || this.insetShown === 'full')) {
        const px = target.canvas.clientWidth * Math.min(2, typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1);
        const look = this.insetLook();
        this.insetGround ??= new InsetGround();
        if (px > 0 && this.insetGround.stale(px, look)) this.insetGround.capture(this.renderer, this.scene, [this.stadium.group], px, look);
      }
    } catch {
      target = null;
    }
    this.renderer.render(this.scene, this.camera);
    try {
      // Whatever the camera does, the inset never covers what the stage protects (protectedRegions.ts): when the
      // batter's own bat and gloves, the pitch, the ball's path, the release, the contact or the bowler reach its
      // rectangle through this frame's camera, it steps aside, and stays aside for 300 ms so a sweeping camera cannot
      // make it flicker.
      let blocked = false;
      const p = script?.practice;
      if (target && script && p && canvas && insetMoment(script, this.insetT) !== 'hidden') {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (now < this.insetAsideUntil) blocked = true;
        else {
          const c = canvas.getBoundingClientRect();
          const b = target.root.getBoundingClientRect();
          const bowler = this.rigs.get('bowler');
          if (this.insetFirstPerson?.parent !== this.scene) this.insetFirstPerson = this.scene.getObjectByName('first-person') ?? null;
          if (b.width > 0 && c.width > 0 && insetBlocked(p, this.camera, { w: c.width, h: c.height }, { x: b.left - c.left, y: b.top - c.top, width: b.width, height: b.height }, bowler?.root.visible ? bowler.root.position : null, this.insetFirstPerson)) {
            blocked = true;
            this.insetAsideUntil = now + 300;
          }
        }
      }
      this.insetShown = target && script && canvas ? paintFieldInset(canvas, script, this.insetT, { ground: real ? (this.insetGround?.current() ?? null) : null, blocked }) : null;
    } catch {
      this.insetShown = null;
    }
  }

  /** What the overhead ground picture depends on: the tier's shadows, the light and sky, the pitch, the sight screens. */
  private insetLook(): string {
    const s = this.stadium.inspect();
    return `${this.preset.quality}|${this.preset.shadowMap}|${JSON.stringify(s.environment)}|${JSON.stringify(s.pitch)}|${s.sightScreen.tone}`;
  }

  dispose() {
    this.insetGround?.dispose();
    this.insetScript = null;
    this.stadium.dispose();
    this.ballFx.dispose();
    this.stumpsFx.dispose();
    this.eventFx.dispose();
    this.blobs.dispose();
    this.glowTex.dispose();
    for (const rig of this.rigs.values()) {
      rig.material.dispose();
      rig.ghostMaterial.dispose();
    }
    for (const bat of this.bats.values()) {
      bat.geometry.dispose();
      (bat.material as { dispose(): void }).dispose();
    }
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.scene.clear();
  }
}
