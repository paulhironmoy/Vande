/**
 * The 3D match renderer (Three.js). Lazy-loaded: nothing here is in the app shell.
 * Presentation is a pure function of (script, scene time), so replays seek and offline frames are deterministic.
 * The scene itself (stadium, players, ball, effects) is the shared StageScene, which Practice draws through too.
 */
import { Color, type WebGLRenderer } from 'three';
import { RendererUnavailableError, type RenderQuality, type RendererOptions } from '@/contracts';
import { SessionBase, type DrawInput } from '../core/session';
import { PRESETS } from '../core/quality';
import { cameraAt, planFor, type DirectorCue } from '../core/camera';
import type { BallScript } from '../core/choreo';
import { StageScene } from './stageScene';

/** GPU name from a throwaway WebGL 2 context (for choosing MSAA before the real context exists). */
function probeGpu(): string {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return '';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return '';
  }
}

export class ThreeMatchRenderer extends SessionBase {
  readonly kind = '3d' as const;
  private stage!: StageScene;
  private canvas!: HTMLCanvasElement;
  private plans = new WeakMap<BallScript, DirectorCue[]>();
  private resizeObs: ResizeObserver | null = null;
  private lostTimer: ReturnType<typeof setTimeout> | null = null;
  private contextLost = false;
  private gpu = '';
  private size = { w: 1, h: 1 };
  private lastDraw: DrawInput | null = null;

  protected gpuName(): string {
    return this.gpu;
  }

  async mount(canvas: HTMLCanvasElement, options: RendererOptions): Promise<void> {
    this.canvas = canvas;
    // MSAA cannot change after the context exists, so 'auto' decides from a GPU probe before creating it.
    if (options.quality === 'auto') this.gpu = probeGpu();
    const initialGuess: RenderQuality = options.quality === 'auto' ? this.estimate() : options.quality;
    let renderer: WebGLRenderer;
    try {
      renderer = StageScene.createRenderer(canvas, {
        antialias: options.offline ? true : PRESETS[initialGuess === 'low' || options.fps === 30 ? 'low' : initialGuess].antialias,
        preserveDrawingBuffer: Boolean(options.offline),
      });
    } catch (err) {
      const reason = err instanceof RendererUnavailableError ? err.reason : err instanceof Error ? err.message : 'no_webgl';
      this.emit('fallback', { reason: 'no_webgl', message: reason });
      throw err instanceof RendererUnavailableError ? err : new RendererUnavailableError(reason);
    }
    if (!this.gpu) {
      try {
        const gl = renderer.getContext();
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        this.gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
      } catch {
        this.gpu = '';
      }
    }
    this.initSession(options);
    this.stage = new StageScene(renderer, this.qc.preset);
    this.applyQuality(this.qc.quality);
    this.resize();
    if (typeof ResizeObserver !== 'undefined' && !options.offline) {
      this.resizeObs = new ResizeObserver(() => this.resize());
      this.resizeObs.observe(canvas);
    }
    canvas.addEventListener('webglcontextlost', this.onLost, false);
    canvas.addEventListener('webglcontextrestored', this.onRestored, false);
    // Compile shaders up front so the first ball does not hitch.
    this.stage.prewarm();
  }

  private onLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
    // Nothing can be drawn now: a shot waiting on its animation settles at once.
    this.settlePendingShot();
    if (this.lostTimer) clearTimeout(this.lostTimer);
    this.lostTimer = setTimeout(() => {
      if (this.contextLost) this.emit('fallback', { reason: 'context_lost' });
    }, 3500);
  };
  private onRestored = () => {
    this.contextLost = false;
    if (this.lostTimer) clearTimeout(this.lostTimer);
    this.applyQuality(this.qc.quality);
    if (this.lastDraw) this.draw(this.lastDraw);
  };

  private resize() {
    if (!this.stage) return;
    const off = this.options.offline;
    const w = off ? off.width : Math.max(1, this.canvas.clientWidth || this.canvas.width);
    const h = off ? off.height : Math.max(1, this.canvas.clientHeight || this.canvas.height);
    this.size = { w, h };
    const dpr = off ? 1 : Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, this.qc.preset.pixelRatio) * this.renderScale;
    this.stage.setSize(w, h, dpr);
    if (this.lastDraw && !this.isPlaying()) this.draw(this.lastDraw);
  }

  protected applyQuality(q: RenderQuality) {
    if (!this.stage) return;
    this.stage.applyPreset(PRESETS[q]);
    this.resize();
  }

  /** Adaptive resolution below 'low': render fewer pixels before giving up on 3D. */
  private renderScale = 1;
  protected reduceResolution(): boolean {
    if (this.renderScale <= 0.62) return false;
    this.renderScale = Math.max(0.6, this.renderScale * 0.8);
    this.resize();
    return true;
  }

  protected drawCalls(): number {
    return this.stage ? this.stage.drawCalls() : 0;
  }

  protected onSetup() {
    if (!this.stage) return;
    this.stage.setConditions(this.conditions, this.kits);
  }

  protected draw(input: DrawInput) {
    if (!this.stage || this.contextLost) return;
    this.lastDraw = input;
    const { script, scene: t } = input;
    let plan = this.plans.get(script);
    if (!plan) {
      plan = planFor(script, this.reducedMotion);
      this.plans.set(script, plan);
    }
    const aspect = this.size.w / this.size.h;
    const cam = this.debugCam ?? cameraAt(script, t, plan, { aspect, reducedMotion: this.reducedMotion });
    this.stage.drawScript(script, t, cam, { kits: input.kits, slow: input.slow, clockMs: input.timelineMs, reducedMotion: this.reducedMotion });
    this.stage.render();
  }

  /** Development aid: pins the camera (rig lab, art review). */
  private debugCam: { pos: { x: number; y: number; z: number }; target: { x: number; y: number; z: number }; fov: number } | null = null;
  setDebugCamera(pose: ThreeMatchRenderer['debugCam']) {
    this.debugCam = pose;
  }
  /** Development aid: draws an arbitrary script at a scene time. */
  drawDebug(script: BallScript, t: number) {
    this.draw({ script, scene: t, segment: null, timelineMs: t, slow: false, live: false, conditions: this.conditions, kits: this.kits });
  }

  dispose() {
    super.dispose();
    this.resizeObs?.disconnect();
    if (this.lostTimer) clearTimeout(this.lostTimer);
    if (this.canvas) {
      this.canvas.removeEventListener('webglcontextlost', this.onLost);
      this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    }
    this.stage?.dispose();
  }

  /** Background colour for the canvas before the first frame (matches the sky). */
  static readonly background = new Color('#0a0828');
}
