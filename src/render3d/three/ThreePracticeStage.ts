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
import type { WebGLRenderer } from 'three';
import type { KitSpec } from '@/contracts';
import type { QualityProfileId, Vec3 } from '@/contracts/practice';
import { isSoftwareRenderer, readGpuRenderer } from '@/perf';
import { KITS } from '@/ui/avatar/traits';
import { BATTER_EYE, cameraAt, occludingActors } from '../core/camera';
import { bowlerRun } from '../core/choreo';
import { addBoneRotation } from '../core/clips';
import { PRACTICE_PROFILES, practicePixelRatio, type PracticeProfile } from '../core/quality';
import type { ActorTrack } from '../core/actors';
import { batPoseAt, firstPersonBatPose } from '../practice/bat';
import { releaseCue, releaseCueWeight } from '../practice/cues';
import { simToScene, toWorld } from '../practice/frame';
import { buildPracticeScript, practiceAction, practiceCast, practiceReleaseScene, type PracticeInfo } from '../practice/script';
import { PracticeSessionBase, type StageFrame } from '../practice/session';
import type { PracticeBenchmarkRun, PracticeMountOptions, PracticeSceneSetup } from '../practice/types';
import { benchmarkSetup, conditionsFor } from '../practice/setup';
import type { Diagnostics } from '../practice/diagnostics';
import { createFirstPerson, type FirstPerson } from './firstPerson';
import { createOverlays, type PracticeOverlays } from './overlays';
import { boneWorld } from './players';
import type { BallStyle } from './props';
import { StageScene, type ScriptDrawOptions } from './stageScene';

const FIRST_PERSON_HIDDEN: ReadonlySet<string> = new Set(['striker']);
/** The physics bat stays on the striker's hands this long after its last sample, then the clip takes over. */
const BAT_HOLD_MS = 350;

/** Practice's ball: larger than its collision radius, outlined, with a ground shadow, a soft glow and a faint trace. */
export function practiceBallStyle(p: PracticeProfile): BallStyle {
  return { visualScale: p.ball.visualScale, outline: true, shadow: true, trailAlpha: p.ball.trailAlpha, trailWidth: 0.45, glowOpacity: 0.3, glowPerMetre: 0.011 };
}

/** Where the first-person forearms lead: the front (top-hand) and back (bottom-hand) shoulders, world. */
function shoulders(mirror: boolean): { top: Vec3; bottom: Vec3 } {
  return {
    top: toWorld({ x: -0.12, y: BATTER_EYE.height - 0.3, z: BATTER_EYE.z - 0.06 }, mirror),
    bottom: toWorld({ x: -0.24, y: BATTER_EYE.height - 0.34, z: BATTER_EYE.z + 0.24 }, mirror),
  };
}

function batEndScene(p: PracticeInfo): number {
  const last = p.bat.samples?.at(-1);
  return last ? simToScene(p, last.t) : Number.NEGATIVE_INFINITY;
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

  async mount(canvas: HTMLCanvasElement, options: PracticeMountOptions): Promise<void> {
    this.canvas = canvas;
    const profile = PRACTICE_PROFILES[options.profile];
    let renderer: WebGLRenderer;
    try {
      // MSAA is fixed when the context is made: the starting profile decides it.
      renderer = StageScene.createRenderer(canvas, { antialias: profile.preset.antialias, preserveDrawingBuffer: false });
    } catch (err) {
      this.emit('fallback', { reason: 'no_webgl', message: err instanceof Error ? err.message : String(err) });
      throw err;
    }
    this.gpu = readGpuRenderer(renderer.getContext());
    const stage = new StageScene(renderer, profile.preset);
    this.stage = stage;
    stage.eventFx.setBounceMark('dust');
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
    // Build every player and compile every shader now (players, ball, trace, flashes, gloves, overlays), so no
    // delivery ever hitches on a first use. The time it takes is the benchmark's shader compile time.
    const setup = this.setup ?? benchmarkSetup();
    const warm = buildPracticeScript({ setup, flight: null, releaseHand: this.releaseHand(setup) });
    stage.drawScript(warm, 0, { pos: { x: 0, y: 1.7, z: 9 }, target: { x: 0, y: 1, z: -9 }, fov: 48 }, { kits: this.kits, slow: false, clockMs: 0, reducedMotion: false });
    this.fp.showAll();
    this.overlays.showAll();
    this.shaderCompileMs = stage.prewarm();
    this.overlays.hideAll();
    this.fp.update(null, shoulders(false));
    this.startSession({ ...options, profile: options.profile });
    if (this.setup) this.setScene(this.setup);
  }

  setScene(setup: PracticeSceneSetup): void {
    super.setScene(setup);
    this.stage?.setConditions(conditionsFor(setup.conditions), this.kits);
  }

  private onLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
    this.onContextLost();
  };
  private onRestored = () => {
    this.contextLost = false;
    this.applyProfile(this.profileId);
    this.onContextRestored();
  };

  private resize() {
    if (!this.stage) return;
    const w = Math.max(1, this.canvas.clientWidth || this.canvas.width);
    const h = Math.max(1, this.canvas.clientHeight || this.canvas.height);
    this.size = { w, h };
    const dpr = practicePixelRatio(PRACTICE_PROFILES[this.profileId], Math.min(w, h), typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
    this.stage.setSize(w, h, dpr);
  }

  protected applyProfile(id: QualityProfileId) {
    if (!this.stage) return;
    const p = PRACTICE_PROFILES[id];
    this.stage.applyPreset(p.preset);
    this.stage.ballFx.setStyle(practiceBallStyle(p));
    this.resize();
  }

  protected rendererName(): string {
    return this.gpu;
  }
  protected drawCalls(): number {
    return this.stage ? this.stage.drawCalls() : 0;
  }

  /** The bowling hand at release relative to the bowler's root, measured on the bowler's own rig (cached). */
  protected releaseHand(setup: PracticeSceneSetup): Vec3 | undefined {
    const stage = this.stage;
    if (!stage) return undefined;
    const action = practiceAction(setup.bowler);
    const key = `${action}|${setup.bowler.lookSeed}`;
    const hit = this.hands.get(key);
    if (hit) return hit;
    const run = bowlerRun({ action, look: practiceCast(setup.bowler).bowler, releaseRoot: { x: 0, y: 0, z: 0 } });
    const track: ActorTrack = { ...run.track, id: 'bowler:measure', mirror: false };
    stage.poseActor(track, run.release, this.kits, null);
    const rig = stage.rigOf(track.id);
    if (!rig) return undefined;
    rig.root.visible = false;
    const h = boneWorld(rig, 'handR');
    const v = { x: h.x, y: h.y, z: h.z };
    this.hands.set(key, v);
    return v;
  }

  /** The bowler's wrist and back cue around the release (applied before a left-arm bowler is mirrored). */
  private cueHook(p: PracticeInfo): ScriptDrawOptions['poseHook'] {
    const cue = releaseCue(p.action, p.variation);
    if (!cue) return undefined;
    return (track, pose, t) => {
      if (track.id !== 'bowler') return;
      const w = releaseCueWeight(t, p.releaseScene);
      if (w <= 0) return;
      addBoneRotation(pose, 'handR', cue.hand, w);
      if (cue.chest) addBoneRotation(pose, 'chest', cue.chest, w);
    };
  }

  protected drawFrame(frame: StageFrame): void {
    const stage = this.stage;
    if (!stage || this.contextLost) return;
    const aspect = this.size.w / Math.max(1, this.size.h);
    const cam = cameraAt(frame.script, frame.scene, frame.plan, { aspect, reducedMotion: this.reducedMotion });
    const p = frame.script.practice ?? null;
    const firstPerson = cam.shot === 'batter_eye';
    const pose = p ? batPoseAt(p.bat, frame.scene) : null;
    const swung = p ? (p.bat.samples !== null && p.bat.samples.length > 0) || p.bat.provisionalStart !== null : false;
    const holdBat = Boolean(p && swung && frame.scene <= (p.bat.samples?.length ? batEndScene(p) : Number.POSITIVE_INFINITY) + BAT_HOLD_MS);
    // External shots never show a player filling the foreground: anyone within 1.5 m of the lens is left out.
    const near = firstPerson ? [] : occludingActors(frame.script, frame.scene, cam, 1.5);
    const hidden = firstPerson ? FIRST_PERSON_HIDDEN : near.length ? new Set(near) : undefined;
    stage.drawScript(frame.script, frame.scene, cam, {
      kits: this.kits,
      slow: frame.slow,
      clockMs: frame.clockMs,
      reducedMotion: this.reducedMotion,
      hidden,
      bat: !firstPerson && holdBat && pose ? { actor: 'striker', pose } : null,
      poseHook: p ? this.cueHook(p) : undefined,
    });
    this.fp.update(firstPerson && p ? firstPersonBatPose(p.bat, frame.scene) : null, shoulders(Boolean(p?.mirror)));
    if (p && frame.mode === 'live') this.overlays.landing(p.landing, frame.scene, p.releaseScene, p.flight?.bounce ? simToScene(p, p.flight.bounce.t) : null);
    else this.overlays.landing(null, frame.scene, 0, null);
    this.overlays.edgeFlash(firstPerson ? frame.script : null, frame.scene, firstPerson ? stage.camera : null);
    if (frame.diagnostics !== this.shownDiagnostics) {
      this.overlays.setDiagnostics(frame.diagnostics, frame.bands);
      this.shownDiagnostics = frame.diagnostics;
    }
    if (frame.diagnostics) this.overlays.update(frame.scene);
    stage.render();
  }

  async benchmark(ms: number): Promise<PracticeBenchmarkRun> {
    const setup = this.setup ?? benchmarkSetup();
    // The real Practice scene: the bowler running in and bowling, the field set, the batter's eye.
    const script = buildPracticeScript({ setup, flight: null, runUp: true, idleMs: practiceReleaseScene(setup.bowler) + 1500, releaseHand: this.releaseHand(setup) });
    const before = this.contextLosses;
    const frameMs = await this.runBenchmarkScene(ms, script);
    return { frameMs, shaderCompileMs: Math.round(this.shaderCompileMs * 10) / 10, contextLosses: this.contextLosses - before, renderer: this.gpu, webgl2: true, hardware: !isSoftwareRenderer(this.gpu) };
  }

  dispose(): void {
    super.dispose();
    this.resizeObs?.disconnect();
    if (this.canvas) {
      this.canvas.removeEventListener('webglcontextlost', this.onLost);
      this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    }
    this.fp?.dispose();
    this.overlays?.dispose();
    this.stage?.dispose();
    this.stage = null;
  }
}
