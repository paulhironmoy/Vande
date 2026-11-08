/**
 * The 3D Practice stage: first-person batting through the one renderer (StageScene, the match renderer's scene) and
 * the one camera director (core/camera.ts, practicePlan). Lazy-loaded with the rest of the 3D code.
 *
 * Per frame: the session gives a script and a scene time (the simulation at this frame's own timestamp); the camera
 * director gives the shot; the batter's own body is hidden in first person while the bat (physics, or the
 * provisional swing before the result) and the gloves are drawn exactly where the physics bat is; the bowler's
 * release cues, the Learn landing cue and the replay diagnostics are layered on top. Readability settings (a larger,
 * outlined ball with a ground shadow and a short faint trace) hold in every profile.
 */
import { Mesh, MeshStandardMaterial, type WebGLRenderer } from 'three';
import type { KitSpec } from '@/contracts';
import type { BowlerProfile } from '@/contracts/practice';
import type { BallScript } from '../core/choreo';
import type { BallFlight, DeliveryResult, QualityProfileId, Vec3 } from '@/contracts/practice';
import { isSoftwareRenderer, readGpuRenderer } from '@/perf';
import { KITS } from '@/ui/avatar/traits';
import { BATTER_EYE, advanceGaze, cameraAt, occludingActors, practicePlan, prewarmPracticeGaze } from '../core/camera';
import { bowlerRun, runupActionOf } from '../core/choreo';
import { addBoneRotation, createPose, samplePresented } from '../core/clips';
import { composeHooks, fieldPoseHookFor } from '../core/fieldClips';
import { commitMotion, loadMotionPacks } from '../core/motion/library';
import { humansPoseHook, humansPoseHookFor } from '../core/motion/humansHook';
import { DirectorRuntime } from '../core/motion/director';
import { canComposeBouncer, canComposeRunup } from '../core/motion/bowlerRunup';
import { PRACTICE_PROFILES, practicePixelRatio, type PracticeProfile } from '../core/quality';
import { evaluateActor, lookScale, type ActorTrack } from '../core/actors';
import { warmHumans } from '../core/motion/humansHook';
import { externalBatPose, firstPersonBatPose, freezeBatTrace, swingSmear } from '../practice/bat';
import { batGeometry, placeBatSpan } from './props';
import { releaseCue, releaseCueWeight } from '../practice/cues';
import { presentedBounce } from '../practice/feedback';
import { simToScene, toWorld } from '../practice/frame';
import {
  buildPracticeScript,
  buildPracticeScriptSteps,
  practiceAction,
  practiceCast,
  practiceReleaseScene,
  type PracticeInfo,
  type ReleaseHands,
} from '../practice/script';
import { PracticeSessionBase, type ScriptKind, type StageFrame } from '../practice/session';
import {
  DEFAULT_ENVIRONMENT,
  DEFAULT_STAGE_BALL,
  type DeliveryContext,
  type PracticeBenchmarkRun,
  type PracticeMountOptions,
  type PracticeSceneSetup,
  type ProtectedRegion,
} from '../practice/types';
import { benchmarkSetup, conditionsFor } from '../practice/setup';
import type { Diagnostics } from '../practice/diagnostics';
import { createFirstPerson, type FirstPerson } from './firstPerson';
import { createOverlays, type PracticeOverlays } from './overlays';
import { ballInHand, setRigGhost } from './players';
import type { BallStyle } from './ball';
import { StageScene, type ScriptDrawOptions } from './stageScene';
import { practiceProtectedRegions } from './protectedRegions';

const FIRST_PERSON_HIDDEN: ReadonlySet<string> = new Set(['striker']);
/** The first spare slots of a new script the Director's bakes leave to the frame the player's input shows in (`idleWork`). */
const DIRECTOR_HOLD_SLOTS = 2;
/** What a frame's spare time gives a live result's gaze scan (camera.ts advanceGaze) at most (ms), and the scan units it takes at a time. */
const GAZE_SLICE_MS = 2;
const GAZE_SLICE_UNITS = 150;
/** Coach demonstration treatment: restrained and readable against every pitch, never an additive glow. */
export const COACH_GHOST = Object.freeze({ color: '#7fe0ff', opacity: 0.42 });
/** Ball inspection keeps the real holder/hand as context, but lets the opaque seam and shine read through it. */
export const COACH_CLOSEUP_HOLDER = Object.freeze({ color: '#d7efff', opacity: 0.16 });

/** Applies (or actively removes) the Coach treatment from the real striker rig. Exported for a no-WebGL regression. */
export function setCoachDemonstrationGhost(stage: Pick<StageScene, 'rigOf'>, active: boolean): boolean {
  const striker = stage.rigOf('striker');
  if (!striker) return false;
  setRigGhost(striker, active ? COACH_GHOST : null);
  return true;
}

/** Applies (or actively removes) the inspection-only treatment from the exact actor holding the ball. */
export function setCoachCloseUpHolder(stage: Pick<StageScene, 'rigOf'>, holder: string, active: boolean): boolean {
  const rig = stage.rigOf(holder);
  if (!rig) return false;
  setRigGhost(rig, active ? COACH_CLOSEUP_HOLDER : null);
  return true;
}

/** Practice's ball: one CSS-pixel size and surround on all tiers, with a ground shadow and faint trace. */
export function practiceBallStyle(p: PracticeProfile): BallStyle {
  return {
    visualScale: p.ball.visualScale,
    outline: true,
    shadow: true,
    trailAlpha: p.ball.trailAlpha,
    trailWidth: 0.45,
    glowOpacity: 0,
    glowPerMetre: 0,
    practice: true,
  };
}

/** External-shot occluders, except the ball-close holder whose current hand is both visible and authoritative. */
export function presentationOccluders(
  script: StageFrame['script'],
  scene: number,
  cam: ReturnType<typeof cameraAt>,
  closeUp: boolean,
): string[] {
  const holder = closeUp ? script.ball.find((segment) => segment.k === 'hand')?.actor : undefined;
  return occludingActors(script, scene, cam, 1.5, holder ? new Set([holder]) : undefined);
}

/** Where the first-person forearms lead: the front (top-hand) and back (bottom-hand) shoulders, world. */
function shoulders(mirror: boolean): { top: Vec3; bottom: Vec3 } {
  return {
    top: toWorld({ x: -0.12, y: BATTER_EYE.height - 0.3, z: BATTER_EYE.z - 0.06 }, mirror),
    bottom: toWorld({ x: -0.24, y: BATTER_EYE.height - 0.34, z: BATTER_EYE.z + 0.24 }, mirror),
  };
}

/**
 * The ball in the bowler's hand at his release marker (where the stage draws it held: StageScene.handOf), on his own
 * rig at his look's height, root at the origin, posed as the stage poses him (with the planted-feet hook, so a hip
 * drop at the release is in it): what ThreePracticeStage.releaseHand gives the script. Exported for the tests.
 */
export function measureReleaseBall(
  stage: StageScene,
  bowler: BowlerProfile,
  kits: [KitSpec, KitSpec],
  variant?: 'bouncer',
): Vec3 | null {
  const run = bowlerRun({
    action: practiceAction(bowler),
    look: practiceCast(bowler).bowler,
    releaseRoot: { x: 0, y: 0, z: 0 },
    ...(variant ? { variant } : {}),
  });
  const track: ActorTrack = { ...run.track, id: 'bowler:measure', mirror: false };
  const stockCue = releaseCue(practiceAction(bowler), 'stock');
  const cued: ScriptDrawOptions['poseHook'] = (tr, pose, t) => {
    if (!stockCue || tr.id !== 'bowler:measure') return;
    const w = releaseCueWeight(t, run.release);
    addBoneRotation(pose, 'handR', stockCue.hand, w);
    if (stockCue.chest) addBoneRotation(pose, 'chest', stockCue.chest, w);
  };
  const hook = composeHooks(cued, humansPoseHook({ actors: [track] } as unknown as BallScript, { prior: cued }));
  stage.poseActor(track, run.release, kits, null, hook);
  const rig = stage.rigOf(track.id);
  if (!rig) return null;
  rig.root.visible = false;
  rig.root.updateMatrixWorld(true);
  const h = ballInHand(rig, 'R');
  return { x: h.x, y: h.y, z: h.z };
}

/** A bouncer's extra trunk extension and side-flexion away from the bowling arm at the release (deg, each). */
export const BOUNCER_TRUNK_DEG = 5;

/** The bouncer lean's weight: 0 → 1 over the 300 ms before the release, back to 0 over the 320 ms after (C1 at both ends). */
export function releaseLiftWeight(t: number, releaseScene: number): number {
  const s = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  return t <= releaseScene ? s((t - (releaseScene - 300)) / 300) : 1 - s((t - releaseScene) / 320);
}

/** Scene ms of the first bat, edge, pad or body touch (the moment an unpresented bounce's ring is taken away). */
function firstTouchScene(p: PracticeInfo, result: NonNullable<PracticeInfo['result']>): number | null {
  const e = result.events.find(
    (x) => x.kind === 'pad' || (x.kind === 'contact' && x.contact !== 'miss' && x.contact !== 'leave'),
  );
  return e ? simToScene(p, e.t) : null;
}

export class ThreePracticeStage extends PracticeSessionBase {
  readonly kind = '3d' as const;
  private stage: StageScene | null = null;
  private canvas!: HTMLCanvasElement;
  private fp!: FirstPerson;
  private overlays!: PracticeOverlays;
  private gpu = '';
  private shaderCompileMs = 0;
  private size = { w: 1, h: 1 };
  private resizeObs: ResizeObserver | null = null;
  private contextLost = false;
  private kits: [KitSpec, KitSpec] = [KITS[0], KITS[1]];
  private hands = new Map<string, Vec3>();
  private shownDiagnostics: Diagnostics | null = null;
  private closeUpGhostHolder: string | null = null;
  private extGhosts: Mesh[] = [];
  private hookCache = new WeakMap<
    StageFrame['script'],
    { reducedMotion: boolean; hook: ScriptDrawOptions['poseHook'] }
  >();
  /**
   * The face-and-life Director for the bowler and the striker (core/motion/director/stage/runtime.ts): plans baked off the
   * frame path in the spare time of frames; a life pass (breath, sway) in the pose hooks and a head pass (the head in space,
   * the eyes) on the finished bones at the end of StageScene.poseActor; blinks and gaze through the players' shader. `director.enabled`
   * is its one switch (off: every rig draws as it did before the Director).
   */
  readonly director = new DirectorRuntime();
  /** The geometry/camera below belong to this actually rendered frame, never a guessed future layout. */
  private drawnPractice: PracticeInfo | null = null;

  async mount(canvas: HTMLCanvasElement, options: PracticeMountOptions): Promise<void> {
    this.canvas = canvas;
    const profile = PRACTICE_PROFILES[options.profile];
    let renderer: WebGLRenderer;
    try {
      // MSAA is fixed when the context is made: the starting profile decides it.
      renderer = StageScene.createRenderer(canvas, {
        antialias: profile.preset.antialias,
        preserveDrawingBuffer: false,
      });
    } catch (err) {
      this.emit('fallback', { reason: 'no_webgl', message: err instanceof Error ? err.message : String(err) });
      throw err;
    }
    this.gpu = readGpuRenderer(renderer.getContext());
    const stage = new StageScene(renderer, profile.preset, 'practice');
    this.stage = stage;
    stage.eventFx.setBounceMark('dust');
    stage.eventFx.setPractice(true);
    this.fp = createFirstPerson(stage.scene);
    this.fp.setKit(this.kits[0]);
    this.overlays = createOverlays(stage.scene, stage.glowTex);
    this.profileId = options.profile;
    stage.setConditions(conditionsFor(this.setup?.conditions ?? 'balanced'), this.kits);
    this.applyProfile(options.profile);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObs = new ResizeObserver(() => this.resize());
      this.resizeObs.observe(canvas);
    }
    canvas.addEventListener('webglcontextlost', this.onLost, false);
    canvas.addEventListener('webglcontextrestored', this.onRestored, false);
    // Build every player and warm the reachable Practice shaders (ball, trace, gloves, effects and Coach overlays)
    // before the first delivery. Dormant match/dev-only variants are outside this renderer's warm-up scope.
    const setup = this.setup ?? benchmarkSetup();
    const warm = buildPracticeScript({ setup, flight: null, releaseHand: this.releaseHand(setup) });
    stage.drawScript(
      warm,
      0,
      { pos: { x: 0, y: 1.7, z: 9 }, target: { x: 0, y: 1, z: -9 }, fov: 48 },
      { kits: this.kits, slow: false, clockMs: 0, reducedMotion: false },
    );
    // The human motion packs: fetched once, in parallel, in the background with the 3D stage. They never delay the
    // first ball: a pack not decoded by a run-up leaves that ball to the built-ins, and loaded packs join between balls
    // (setScene / bowl commit them, never mid-delivery).
    void loadMotionPacks();
    // The external view's smear ghosts (shared bat geometry, translucent; hidden until a swing outruns a real bat).
    this.extGhosts = [0, 1, 2].map(() => {
      const g = new Mesh(
        batGeometry(),
        new MeshStandardMaterial({
          color: '#e9dcc0',
          roughness: 0.8,
          transparent: true,
          depthWrite: false,
          opacity: 0.2,
        }),
      );
      g.renderOrder = 1;
      stage.scene.add(g);
      return g;
    });
    this.fp.showAll();
    this.overlays.showAll();
    // Warm every drawable variant of the ACTIVE profile, including hidden effects, both LODs and the shadow pass.
    // Preparing unused profiles here blocked cold startup on software GPUs. A later profile is warmed between balls
    // by applyProfile, before its first run-up. The device check measures the entire active-profile warm-up.
    this.shaderCompileMs = stage.prewarmPractice(profile.preset);
    this.overlays.hideAll();
    for (const g of this.extGhosts) g.visible = false;
    this.fp.update(null, shoulders(false));
    this.startSession({ ...options, profile: options.profile });
    if (this.setup) this.setScene(this.setup);
  }

  setScene(setup: PracticeSceneSetup): void {
    // Between balls: motion packs that have finished loading take effect now (never during a delivery).
    commitMotion();
    super.setScene(setup);
    const stage = this.stage;
    if (!stage) return;
    stage.setConditions(conditionsFor(setup.conditions), this.kits);
    stage.stadium.setPracticePitch(setup.conditions);
    stage.stadium.setSightScreens((setup.ball ?? DEFAULT_STAGE_BALL).colour === 'white' ? 'dark' : 'white');
    stage.ballFx.setColour((setup.ball ?? DEFAULT_STAGE_BALL).colour);
    stage.stadium.setEnvironment(setup.environment ?? DEFAULT_ENVIRONMENT);
    stage.renderer.toneMappingExposure = stage.stadium.exposure();
  }

  bowl(flight: BallFlight, context: DeliveryContext = {}): Promise<{ releasePerfMs: number }> {
    // A delivery's first script: the motion packs it is drawn with are fixed here for the whole ball.
    commitMotion();
    return super.bowl(flight, context);
  }

  protected onQuiet(on: boolean): void {
    this.stage?.stadium.setQuiet(on);
  }

  setFocusAid(on: boolean): void {
    super.setFocusAid(on);
    this.stage?.ballFx.setStyle({ ...practiceBallStyle(PRACTICE_PROFILES[this.profileId]), focusAid: on });
  }

  private onLost = (e: Event) => {
    e.preventDefault();
    this.clearCoachPresentation();
    this.contextLost = true;
    this.onContextLost();
  };
  private onRestored = () => {
    this.clearCoachPresentation();
    this.contextLost = false;
    this.applyProfile(this.profileId);
    this.onContextRestored();
  };

  private resize() {
    if (!this.stage) return;
    const w = Math.max(1, this.canvas.clientWidth || this.canvas.width);
    const h = Math.max(1, this.canvas.clientHeight || this.canvas.height);
    this.size = { w, h };
    const dpr = practicePixelRatio(
      PRACTICE_PROFILES[this.profileId],
      Math.min(w, h),
      typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
    );
    this.stage.setSize(w, h, dpr);
  }

  protected applyProfile(id: QualityProfileId) {
    if (!this.stage) return;
    const p = PRACTICE_PROFILES[id];
    this.stage.applyPreset(p.preset);
    this.stage.ballFx.setStyle({ ...practiceBallStyle(p), focusAid: this.focusAid });
    this.resize();
    // Between balls only (the session queues a change made during a delivery). Showing every variant also warms
    // hidden/depth programs, which compile() alone misses. Three's own context-local cache reuses existing programs;
    // no separate "already warm" flag can survive context loss or miss newly created materials. Context restoration
    // takes this same path before announcing readiness.
    if (this.mounted) this.stage.prewarmPractice(p.preset);
  }

  protected rendererName(): string {
    return this.gpu;
  }
  protected drawCalls(): number {
    return this.stage ? this.stage.drawCalls() : 0;
  }

  protectedRegions(): ProtectedRegion[] {
    if (!this.stage || !this.drawnPractice || this.contextLost) return [];
    return practiceProtectedRegions(
      this.drawnPractice,
      this.stage.camera,
      this.size,
      this.stage.rigOf('bowler'),
      this.fp.group,
    );
  }

  /** The bowling hand at release relative to the bowler's root, measured on the bowler's own rig (cached). */
  protected releaseHand(setup: PracticeSceneSetup): Vec3 | undefined {
    const stage = this.stage;
    if (!stage) return undefined;
    const action = practiceAction(setup.bowler);
    const bouncer = runupActionOf(action) === 'pace' && canComposeBouncer();
    const key = `${action}|${setup.bowler.lookSeed}|${canComposeRunup(runupActionOf(action)) ? 'composed' : 'builtin'}${bouncer ? '|bouncer' : ''}`;
    const hit = this.hands.get(key);
    if (hit) return hit;
    const stock = measureReleaseBall(stage, setup.bowler, this.kits);
    if (!stock) return undefined;
    const b = bouncer ? measureReleaseBall(stage, setup.bowler, this.kits, 'bouncer') : null;
    const v: ReleaseHands = b ? { ...stock, bouncer: b } : stock;
    this.hands.set(key, v);
    return v;
  }

  /**
   * The bowler around the release (applied before a left-arm bowler is mirrored): this delivery's wrist and back cue,
   * rising before the release and gone soon after (practice/cues.ts), and, for a bouncer the stock clip has to throw
   * (MOTION-BOWL's bouncer clip carries its own back and wrist), a little more trunk extension and side-flexion away
   * from the bowling arm. Nothing else: the bowling arm keeps the authored clip's elbow, and the last centimetres to the
   * physics release point (a cue turns the wrist; a yorker or a bouncer leaves the hand lower or higher) are the
   * stage's release reach (stageScene.ts reachRelease), by the trunk and the shoulder, never by bending the elbow. The
   * feet stay planted and the body is never lifted. A scene between balls (no flight) has no release and no cue.
   */
  private cueHook(p: PracticeInfo): ScriptDrawOptions['poseHook'] {
    if (!p.flight) return undefined;
    // MOTION-BOWL's bouncer delivery has its wrist and back cue in the clip: nothing is added on top.
    const cue = p.bouncerClip ? null : releaseCue(p.action, p.variation);
    const lean = p.variation === 'bouncer' && !p.bouncerClip && (p.releaseLift ?? 0) > 1e-3;
    if (!cue && !lean) return undefined;
    return (track, pose, t) => {
      if (track.id !== 'bowler') return;
      if (cue) {
        const wc = releaseCueWeight(t, p.releaseScene);
        if (wc > 0) {
          addBoneRotation(pose, 'handR', cue.hand, wc);
          if (cue.chest) addBoneRotation(pose, 'chest', cue.chest, wc);
        }
      }
      if (lean) {
        const wl = releaseLiftWeight(t, p.releaseScene);
        if (wl > 0) {
          const half = BOUNCER_TRUNK_DEG / 2;
          addBoneRotation(pose, 'spine', [-half, 0, -half], wl);
          addBoneRotation(pose, 'chest', [-half, 0, -half], wl);
        }
      }
    };
  }

  /**
   * The pose hooks of one script, built once and reused every frame: the bowler's release cue and rise, then the
   * field (keeper, fielders) and the humans (bowler, batters: planted feet), each pure in (track, t).
   */
  private poseHooks(script: StageFrame['script'], p: PracticeInfo): ScriptDrawOptions['poseHook'] {
    const hit = this.hookCache.get(script);
    if (hit && hit.reducedMotion === this.reducedMotion) return hit.hook;
    const cue = this.cueHook(p);
    // The striker's trunk reaches the bat the stage will put in his hands (the external views' presented bat).
    const batOf = (track: ActorTrack, t: number) => {
      if (track.id !== 'striker') return null;
      const b = externalBatPose(p.bat, track, t, lookScale(track.look));
      return b ? { grip: b.grip, toe: b.toe } : null;
    };
    // The Director's life pass (breath, sway) follows the release cue and comes before the field and the planted feet and
    // the arm IK, so the feet stay where they landed and the gloves on the handle while the body breathes. Its head pass is
    // not a pose hook: the humans hook fits the striker's trunk and neck to the physics body and turns him to the bat, and
    // the stage's glove solve then leans his chest and spine to the handle, so it runs on the finished bones at the end of
    // StageScene.poseActor (players.applyDirectedHead). Neither pass is in the plant's own base pose (`prior`) or in
    // measureReleaseBall: the planted feet and the release hand are the same with or without the Director.
    const dir = this.director?.hooksFor(script);
    const hook = composeHooks(
      cue,
      dir?.life,
      fieldPoseHookFor(script, { reducedMotion: this.reducedMotion }),
      humansPoseHookFor(script, cue ? { prior: cue, batOf } : { batOf }),
    );
    this.hookCache.set(script, { reducedMotion: this.reducedMotion, hook });
    return hook;
  }

  /** One owner for both translucent teaching treatments, including unusual holder→striker transitions. */
  private applyCoachPresentation(stage: StageScene, frame: StageFrame) {
    const nextHolder = frame.closeUpFlight
      ? (frame.script.ball.find((segment) => segment.k === 'hand')?.actor ?? null)
      : null;
    // Restore the previous holder first: if it happens to be the striker, the demonstration below must win.
    if (this.closeUpGhostHolder && this.closeUpGhostHolder !== nextHolder)
      setCoachCloseUpHolder(stage, this.closeUpGhostHolder, false);
    setCoachDemonstrationGhost(stage, frame.coachOption !== null);
    if (nextHolder) setCoachCloseUpHolder(stage, nextHolder, true);
    this.closeUpGhostHolder = nextHolder;
  }

  private clearCoachPresentation() {
    const stage = this.stage;
    if (!stage) return;
    if (this.closeUpGhostHolder) setCoachCloseUpHolder(stage, this.closeUpGhostHolder, false);
    this.closeUpGhostHolder = null;
    setCoachDemonstrationGhost(stage, false);
  }

  /** Scripts whose striker plans are built (or have none to build). */
  private readonly warmed = new WeakSet<object>();
  /** The script the Director's spare-time bakes last saw, and the spare slots they still leave alone at its start. */
  private dirScript: object | null = null;
  private dirHold = 0;
  /** The dry run of the result path (`warmResult`), taken a slice of a frame's spare time at a time; null when none is left to do. */
  private warmJob: Generator<void, void, void> | null = null;
  private warmOnce = false;

  /**
   * Spare time of the frame just drawn, `budgetMs` of it. For a live result: the Director's plans, then the gaze its
   * camera reads (the peaks it is held inside are measured here, ahead of the frame that needs them), then the
   * striker's reach plan, a few ms per frame while the first-person camera is still on the bat: the camera cut to him
   * (the first frame that poses him) otherwise builds all of it in one frame, 60 ms and more on a phone (PERF1). Before
   * a result, what is left goes to the dry run of the result path.
   */
  protected idleWork(frame: StageFrame, budgetMs: number): void {
    const p = frame.script.practice;
    const result = frame.mode === 'live' && Boolean(p?.result);
    let left = budgetMs;
    // The Director's plans in two parts (P3). First what has a deadline coming: a result's plans must be in before the contact
    // and take about a millisecond each, between balls the long ones can wait; the gaze and the striker's reach plan below get
    // the rest. Not in the first spare slots of a script: the frame after the swing is the one the player's input shows in, and the
    // plans have until the contact, many frames on. (A plan not in by then is baked in the frame that reaches it, a few slices
    // at the most: it serves while it is baked.) The rest of those plans, and the scene between balls, takes what the gaze and the
    // reach plan leave: the picture of the camera cut comes first, the tail of a plan is only needed as the playhead gets to it.
    const d = this.director;
    let hold = false;
    if (d.busy) {
      if (frame.script !== this.dirScript) {
        this.dirScript = frame.script;
        this.dirHold = DIRECTOR_HOLD_SLOTS;
      }
      if (this.dirHold > 0) {
        this.dirHold--;
        hold = true;
      } else if (d.urgent) left -= this.directorWork(true, Math.min(left, 2.5), frame.script);
    }
    left -= this.otherWork(frame, result, left);
    if (d.busy && !hold && left >= 0.3) this.directorWork(false, Math.min(left, 2.5), frame.script);
  }

  /**
   * How tall the bowler's and the striker's heads are on screen (CSS px), for the Director's level of detail: their distance from the
   * camera, the lens and the canvas height (0.23 m a head). The expressions are only mixed for a head of 38 px or more; a frame late is fine.
   */
  private directorDetail(stage: StageScene): void {
    const cam = stage.camera;
    const k = this.size.h / (2 * Math.tan((cam.fov * Math.PI) / 360));
    for (const id of ['bowler', 'striker'] as const) {
      const rig = stage.rigOf(id);
      if (!rig || !rig.root.visible) continue;
      const r = rig.root.position;
      const d = Math.hypot(r.x - cam.position.x, 1.6 * rig.scale - cam.position.y, r.z - cam.position.z);
      this.director.setHeadPx(id, (0.23 * rig.scale * k) / Math.max(0.3, d));
    }
  }

  /** The Director's bakes for at most `ms` (at least one slice): the ones with a deadline coming (`urgent`) or the rest; the time it took. */
  private directorWork(urgent: boolean, ms: number, script: StageFrame['script']): number {
    const t0 = performance.now();
    if (urgent) this.director.workUrgent(ms, () => performance.now(), script);
    else this.director.workRest(ms, () => performance.now(), script);
    return performance.now() - t0;
  }

  /**
   * What a frame's spare time does besides the Director's plans: the result's gaze, the dry run of the result path, the
   * striker's stride decision and then his reach plan; the time it took. His moves wait on the decision (script.ts
   * deferStride) and anything that evaluates him makes it whole: the camera's cut to him, the field inset's marker for him
   * at the dead ball. It is made here on the planted-feet hook the frames use, so the plans it makes are theirs. His reach
   * plan is for the frame the camera cuts to him only: a script that never cuts (a miss, a leave, a pad: the batter's eye
   * to the end) never poses him, and builds none.
   */
  private otherWork(frame: StageFrame, result: boolean, left: number): number {
    const p = frame.script.practice;
    const t0 = performance.now();
    if (result && left >= 0.3) this.gazeWork(frame.script, Math.min(left, GAZE_SLICE_MS));
    if (!result) {
      if (this.warmJob && left >= 0.5) this.warmWork(left);
      return performance.now() - t0;
    }
    if (left < 0.3 || !p || this.warmed.has(frame.script)) return performance.now() - t0;
    const striker = frame.script.actors.find((a) => a.id === 'striker');
    if (!striker) {
      this.warmed.add(frame.script);
      return performance.now() - t0;
    }
    this.poseHooks(frame.script, p);
    const stride = p.stride;
    if (
      stride &&
      !stride.done &&
      !stride.advance(Math.max(0.3, left - (performance.now() - t0)), humansPoseHookFor(frame.script))
    )
      return performance.now() - t0;
    if (!Number.isFinite(p.firstPersonUntil) || p.external === 'none' || !striker.physicsBody) {
      this.warmed.add(frame.script);
      return performance.now() - t0;
    }
    const spent = performance.now() - t0;
    // (The reach plan starts with the next frame's spare time when the gaze and the decision have taken this one's.)
    if (spent >= left) return spent;
    if (warmHumans(frame.script, striker, left - spent, p.firstPersonUntil)) this.warmed.add(frame.script);
    return performance.now() - t0;
  }

  /** Measures a live result's gaze peaks for up to `ms` (at least one slice); the time it took. */
  private gazeWork(script: StageFrame['script'], ms: number): number {
    const t0 = performance.now();
    while (advanceGaze(script, this.reducedMotion, GAZE_SLICE_UNITS) && performance.now() - t0 < ms) {
      /* spare time */
    }
    return performance.now() - t0;
  }

  /**
   * A throwaway result of the coming over's first ball (the flow resolves one to warm the physics and drops it): the
   * result path is run once on it, in slices of spare time, before the first real result has to use it, so that one does
   * not pay for compiling it (the first delivery after a page loads took 133-250 ms in `play()` at 4x). The dry run
   * builds the scripts, the gaze, the camera and the bat, and poses every actor on a scratch skeleton, exactly as the
   * frames after a result do, but draws nothing and touches nothing: not the live delivery, the Director, the sounds, the
   * records or the coach. A real delivery's result ends it; it runs once.
   */
  warmResult(result: DeliveryResult, flight: BallFlight, setup: PracticeSceneSetup): void {
    if (this.warmOnce || !this.stage) return;
    this.warmOnce = true;
    this.warmJob = this.warmSteps(result, flight, setup);
  }

  private warmWork(budgetMs: number): void {
    const job = this.warmJob;
    if (!job) return;
    const t0 = performance.now();
    try {
      do {
        if (job.next().done) {
          this.warmJob = null;
          return;
        }
      } while (performance.now() - t0 < budgetMs - 0.2);
    } catch {
      /* warming is best effort: it never breaks a frame */
      this.warmJob = null;
    }
  }

  private *warmSteps(
    result: DeliveryResult,
    flight: BallFlight,
    setup: PracticeSceneSetup,
  ): Generator<void, void, void> {
    const rm = this.reducedMotion;
    const releaseHand = this.releaseHand(setup);
    yield;
    // The delivery on screen when the result arrives, and the result's script taking over from it, as play() builds them.
    const live = yield* buildPracticeScriptSteps({ setup, flight, learnCue: this.learnCue, releaseHand, sliced: true });
    yield;
    prewarmPracticeGaze(live, rm);
    yield;
    const release = live.practice!.releaseScene;
    freezeBatTrace(result.bat);
    const press = result.swing ? simToScene({ releaseScene: release }, result.swing.startT) : null;
    const at = (press ?? release + 600) + 40;
    const script = yield* buildPracticeScriptSteps({
      setup,
      flight,
      result,
      provisionalStart: press,
      contactState: null,
      resultAt: press === null ? null : at,
      handover: { script: live, atScene: at },
      learnCue: this.learnCue,
      releaseHand,
    });
    yield;
    prewarmPracticeGaze(script, rm);
    yield;
    // Six frames of the camera, the first-person bat and the external one (one thing a slice: the first of each compiles it).
    const p = script.practice!;
    // The striker's stride decision first, a slice at a time on the script's own hook, as a real result's is (never skipped here:
    // the throwaway may be a miss, and the code is what is being warmed); the external bat below reads the striker, which would make it whole.
    this.poseHooks(script, p);
    while (p.stride && !p.stride.advance(0, humansPoseHookFor(script))) yield;
    const plan = practicePlan(script, rm);
    const ctx = { aspect: this.size.w / Math.max(1, this.size.h), reducedMotion: rm };
    const striker = script.actors.find((a) => a.id === 'striker');
    const frames = Array.from({ length: 6 }, (_, k) => at + k * (1000 / 60));
    for (const t of frames) {
      cameraAt(script, t, plan, ctx);
      yield;
    }
    for (const t of frames) {
      firstPersonBatPose(p.bat, t);
      yield;
    }
    for (const t of frames) {
      if (striker) externalBatPose(p.bat, striker, t, 1);
      yield;
    }
    // The gaze's scan, a few hundred units a slice, as the frames' spare time will take it.
    while (advanceGaze(script, rm, 300)) yield;
    // Every actor posed at the result's moment (the planted-feet plans and field hooks of this script; no skeleton drawn).
    const hook = this.poseHooks(script, p);
    const a = createPose();
    const b = createPose();
    const lw = createPose();
    for (const track of script.actors) {
      if (track.id === 'striker') continue;
      yield;
      const st = evaluateActor(track, at);
      const pose = samplePresented(st, a, b, lw);
      hook?.(track, pose, at);
    }
    // The striker's reach plan, built in the same slices a real result's is (warmHumans).
    if (striker?.physicsBody) while (!warmHumans(script, striker, 1.5, p.firstPersonUntil)) yield;
  }

  /** The dry run stops the moment a real delivery's result arrives. */
  protected onScript(script: StageFrame['script'], kind: ScriptKind, prev: StageFrame['script'] | null): void {
    if (kind === 'result') {
      this.warmJob = null;
      // The spare time of the frames that follow measures its gaze (idleWork): reading it then pays for little of that.
      advanceGaze(script, this.reducedMotion, 0);
    }
    try {
      if (this.director.reducedMotion !== this.reducedMotion) this.director.setReducedMotion(this.reducedMotion);
      this.director.register(script, kind, prev);
    } catch {
      /* the Director never breaks a delivery: the script is drawn as it always was */
    }
  }

  protected onReducedMotion(on: boolean): void {
    try {
      this.director.setReducedMotion(on);
    } catch {
      /* as above */
    }
  }

  protected drawFrame(frame: StageFrame): void {
    const stage = this.stage;
    if (!stage || this.contextLost) return;
    const aspect = this.size.w / Math.max(1, this.size.h);
    const cam = cameraAt(frame.script, frame.scene, frame.plan, { aspect, reducedMotion: this.reducedMotion });
    const p = frame.script.practice ?? null;
    const firstPerson = cam.shot === 'batter_eye';
    // External views: the presented bat (orthodox stance, backlift, then the physics swing, exact from contact on),
    // handed to the body's clip after the stroke; the gloves close round it (players.holdBat).
    const strikerTrack = !firstPerson && p ? frame.script.actors.find((a) => a.id === 'striker') : undefined;
    const pose =
      p && strikerTrack ? externalBatPose(p.bat, strikerTrack, frame.scene, stage.rigOf('striker')?.scale ?? 1) : null;
    // External shots never show a player filling the foreground: anyone within 1.5 m of the lens is left out. The
    // close-up is the one exception for its holder: StageScene needs that currently posed hand as the authoritative
    // ball position, and the player must actually see the hand the ball is leaving rather than a floating surface.
    const near = firstPerson ? [] : presentationOccluders(frame.script, frame.scene, cam, frame.closeUpFlight !== null);
    const hidden = firstPerson ? FIRST_PERSON_HIDDEN : near.length ? new Set(near) : undefined;
    stage.drawScript(frame.script, frame.scene, cam, {
      kits: this.kits,
      slow: frame.slow,
      clockMs: frame.clockMs,
      reducedMotion: this.reducedMotion,
      hidden,
      bat: pose ? { actor: 'striker', pose } : null,
      poseHook: p ? this.poseHooks(frame.script, p) : undefined,
      emotion: frame.mode === 'live' ? this.activeSink()?.emotionNow?.(frame.clockMs) : undefined,
      ballCloseUp: frame.closeUpFlight !== null,
    });
    this.directorDetail(stage);
    // Both teaching treatments are applied only after the real pose and held-ball sample. The demonstration shows
    // the complete ghost striker; ball inspection leaves the exact holder in low-opacity context so the opaque ball
    // surface remains readable. Every other frame actively restores solid materials, ordering and shadow policy.
    this.applyCoachPresentation(stage, frame);
    // The swing smear (not on the lite tier, never under Reduced Motion): ghost bats trailing a swing that turns faster
    // than a real bat's peak, so a fast catch-up reads as a fast swing. Same pose otherwise; deterministic in time.
    const smearOn = !this.reducedMotion && this.profileId !== 'lite' && p !== null;
    const fpSmear = smearOn && firstPerson && p ? swingSmear((t) => firstPersonBatPose(p.bat, t), frame.scene) : null;
    this.fp.update(
      firstPerson && p ? firstPersonBatPose(p.bat, frame.scene) : null,
      shoulders(Boolean(p?.mirror)),
      fpSmear,
    );
    const extSmear =
      smearOn && !firstPerson && p && strikerTrack && pose
        ? swingSmear((t) => externalBatPose(p.bat, strikerTrack, t, stage.rigOf('striker')?.scale ?? 1), frame.scene)
        : null;
    this.extGhosts.forEach((g, i) => {
      const sp = extSmear?.poses[i];
      g.visible = Boolean(sp);
      if (!sp) return;
      placeBatSpan(g, sp.grip, sp.toe, sp.face);
      (g.material as MeshStandardMaterial).opacity = extSmear!.opacity[i];
    });
    // The Learn ring marks where the ball will pitch; once the result shows the bat (or pad) met it first, the ring
    // goes at that contact (COH4: a bounce the presented ball never makes is never marked).
    const bounce = p?.flight?.bounce ?? null;
    const unpresented = Boolean(p?.result && bounce && !presentedBounce(p.result, bounce));
    const hideAt = unpresented && p?.result ? firstTouchScene(p, p.result) : null;
    if (p && frame.mode === 'live' && !(hideAt !== null && frame.scene >= hideAt))
      this.overlays.landing(p.landing, frame.scene, p.releaseScene, bounce ? simToScene(p, bounce.t) : null);
    else this.overlays.landing(null, frame.scene, 0, null);
    this.overlays.edgeFlash(firstPerson ? frame.script : null, frame.scene, firstPerson ? stage.camera : null);
    if (frame.diagnostics !== this.shownDiagnostics) {
      this.overlays.setDiagnostics(frame.diagnostics, frame.bands);
      this.shownDiagnostics = frame.diagnostics;
    }
    if (frame.diagnostics) this.overlays.update(frame.scene);
    stage.render();
    this.drawnPractice = p;
  }

  async benchmark(ms: number): Promise<PracticeBenchmarkRun> {
    const setup = this.setup ?? benchmarkSetup();
    // The real Practice scene: the bowler running in and bowling, the field set, the batter's eye.
    const script = buildPracticeScript({
      setup,
      flight: null,
      runUp: true,
      idleMs: practiceReleaseScene(setup.bowler) + 1500,
      releaseHand: this.releaseHand(setup),
    });
    const before = this.contextLosses;
    const frameMs = await this.runBenchmarkScene(ms, script);
    return {
      frameMs,
      shaderCompileMs: Math.round(this.shaderCompileMs * 10) / 10,
      contextLosses: this.contextLosses - before,
      renderer: this.gpu,
      webgl2: true,
      hardware: !isSoftwareRenderer(this.gpu),
    };
  }

  dispose(): void {
    super.dispose();
    this.warmJob = null;
    this.resizeObs?.disconnect();
    if (this.canvas) {
      this.canvas.removeEventListener('webglcontextlost', this.onLost);
      this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    }
    this.clearCoachPresentation();
    for (const g of this.extGhosts) (g.material as MeshStandardMaterial).dispose();
    this.extGhosts = [];
    this.fp?.dispose();
    this.overlays?.dispose();
    this.stage?.dispose();
    this.stage = null;
    this.drawnPractice = null;
  }
}
