/**
 * Classic Practice: the Practice stage on Canvas 2D, for devices below the performance cutoff or without WebGL 2. It
 * implements the same PracticeStage interface and plays the same scripts, built from the same physics data, as the
 * 3D stage (practice/session.ts does the timing): the batter's view through the same camera director while the
 * delivery comes (batterView.ts), then the shared top-down painter (topDown.ts) for the field, and a top-down
 * diagnostic replay with the side-on height inset.
 */
import type { KitSpec } from '@/contracts';
import type { QualityProfileId } from '@/contracts/practice';
import { probeGpu, type GpuProbe } from '@/perf';
import { KITS } from '@/ui/avatar/traits';
import { cameraAt } from '../core/camera';
import { PRACTICE_PROFILES } from '../core/quality';
import { firstPersonBatPose } from '../practice/bat';
import { revealed, type Diagnostics } from '../practice/diagnostics';
import { simToScene } from '../practice/frame';
import { buildPracticeScript, practiceReleaseScene } from '../practice/script';
import { PracticeSessionBase, type StageFrame } from '../practice/session';
import type { PracticeBenchmarkRun, PracticeMountOptions } from '../practice/types';
import { benchmarkSetup } from '../practice/setup';
import { BatterViewPainter } from './batterView';
import { TopDownPainter, type View } from './topDown';

const HIDDEN: ReadonlySet<string> = new Set(['striker']);

export class Fallback2DPracticeStage extends PracticeSessionBase {
  readonly kind = '2d' as const;
  private canvas!: HTMLCanvasElement;
  private top: TopDownPainter | null = null;
  private eye: BatterViewPainter | null = null;
  private w = 1;
  private h = 1;
  private resizeObs: ResizeObserver | null = null;
  private kits: [KitSpec, KitSpec] = [KITS[0], KITS[1]];
  private calls = 0;
  private gpu: GpuProbe | null = null;

  async mount(canvas: HTMLCanvasElement, options: PracticeMountOptions): Promise<void> {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      this.emit('fallback', { reason: 'error', message: '2D canvas unavailable' });
      throw new Error('2D canvas unavailable');
    }
    this.canvas = canvas;
    this.top = new TopDownPainter(ctx);
    this.eye = new BatterViewPainter(ctx);
    this.profileId = options.profile;
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObs = new ResizeObserver(() => this.resize());
      this.resizeObs.observe(canvas);
    }
    this.startSession(options);
  }

  private resize() {
    if (!this.top || !this.eye) return;
    this.w = Math.max(1, this.canvas.clientWidth || this.canvas.width);
    this.h = Math.max(1, this.canvas.clientHeight || this.canvas.height);
    // Classic stays cheap: at most 2× and no more than the profile's internal height.
    const native = Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
    const dpr = Math.max(1, Math.min(native, PRACTICE_PROFILES[this.profileId].internal.max / Math.min(this.w, this.h)));
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.top.resize(this.w, this.h, dpr);
    this.eye.resize(this.w, this.h, dpr);
  }

  protected applyProfile(_id: QualityProfileId) {
    this.resize();
  }
  protected rendererName(): string {
    return 'canvas2d';
  }
  protected drawCalls(): number {
    return this.calls;
  }

  protected drawFrame(frame: StageFrame): void {
    if (!this.top || !this.eye) return;
    const p = frame.script.practice ?? null;
    const cam = cameraAt(frame.script, frame.scene, frame.plan, { aspect: this.w / this.h, reducedMotion: this.reducedMotion });
    if (cam.shot === 'batter_eye') {
      const until = p?.flight?.bounce ? simToScene(p, p.flight.bounce.t) + 260 : 0;
      this.eye.paint(frame.script, frame.scene, cam, this.kits, {
        bat: p ? firstPersonBatPose(p.bat, frame.scene) : null,
        landing: frame.mode === 'live' ? (p?.landing ?? null) : null,
        landingUntil: until,
        hidden: HIDDEN,
        visualScale: PRACTICE_PROFILES[this.profileId].ball.visualScale,
      });
      this.calls = this.eye.calls;
      return;
    }
    if (frame.diagnostics) {
      // The batting end from above, steady: the paths, the contact and the two directions over the field.
      const view: View = { cx: 0, cz: 3, scale: Math.min(this.w / 26, (this.h * 0.82) / 30) };
      this.top.paint(frame.script, frame.scene, this.kits, true, view);
      this.diagnostics(frame.diagnostics, frame.scene, view);
      this.calls = this.top.calls + 1;
      return;
    }
    this.top.paint(frame.script, frame.scene, this.kits, this.reducedMotion);
    this.calls = this.top.calls;
  }

  private diagnostics(d: Diagnostics, t: number, v: View) {
    const top = this.top!;
    const g = top.ctx;
    const path = (pts: Diagnostics['incoming'], times: number[], color: string) => {
      const n = revealed(times, t);
      if (n < 2) return;
      g.strokeStyle = color;
      g.lineWidth = 2.5;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const x = top.sx(v, pts[i].x);
        const y = top.sy(v, pts[i].z);
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.stroke();
    };
    path(d.incoming, d.incomingT, 'rgba(82,226,255,0.95)');
    path(d.outgoing, d.outgoingT, 'rgba(255,179,71,0.95)');
    path(d.batPath, d.batPathT, 'rgba(255,122,217,0.95)');
    const dot = (p: { x: number; z: number } | null, color: string, r: number, ring = false) => {
      if (!p) return;
      g.beginPath();
      g.arc(top.sx(v, p.x), top.sy(v, p.z), r, 0, Math.PI * 2);
      if (ring) {
        g.strokeStyle = color;
        g.lineWidth = 2;
        g.stroke();
      } else {
        g.fillStyle = color;
        g.fill();
      }
    };
    if (d.bounce && d.times.bounce !== null && t >= d.times.bounce) dot(d.bounce, '#52e2ff', 4, true);
    dot(d.ideal, '#ffffff', 5, true);
    if (d.contact && d.times.contact !== null && t >= d.times.contact) dot(d.contact, '#ffcf5a', 4.5);
    const at = d.times.contact ?? d.times.ideal;
    const arrow = (a: Diagnostics['intended'], color: string, dash: number[]) => {
      if (!a || t < at) return;
      g.strokeStyle = color;
      g.lineWidth = 2.5;
      g.setLineDash(dash);
      g.beginPath();
      g.moveTo(top.sx(v, a.from.x), top.sy(v, a.from.z));
      g.lineTo(top.sx(v, a.from.x + a.dir.x * a.length), top.sy(v, a.from.z + a.dir.z * a.length));
      g.stroke();
      g.setLineDash([]);
    };
    arrow(d.intended, 'rgba(255,255,255,0.9)', [6, 6]);
    arrow(d.actual, 'rgba(255,179,71,0.95)', []);
  }

  async benchmark(ms: number): Promise<PracticeBenchmarkRun> {
    const setup = this.setup ?? benchmarkSetup();
    const script = buildPracticeScript({ setup, flight: null, runUp: true, idleMs: practiceReleaseScene(setup.bowler) + 1500 });
    const before = this.contextLosses;
    const frameMs = await this.runBenchmarkScene(ms, script);
    // Classic draws no WebGL, but the classifier still wants to know what the device has.
    this.gpu ??= probeGpu();
    return { frameMs, shaderCompileMs: 0, contextLosses: this.contextLosses - before, renderer: this.gpu.renderer, webgl2: this.gpu.webgl2, hardware: this.gpu.hardware };
  }

  dispose(): void {
    super.dispose();
    this.resizeObs?.disconnect();
    this.top = null;
    this.eye = null;
  }
}
