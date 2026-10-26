/**
 * Lightweight 2D presentation (Canvas 2D) for devices without WebGL, after a lost context, or when the device is
 * too slow for 3D. It plays the same choreography scripts as the 3D renderer through the shared top-down painter
 * (topDown.ts): a floodlit field that zooms on the pitch for the delivery and follows the ball after the shot, plus a
 * side-on inset showing the ball's height (length and bounce stay readable). Deterministic, cheap, no external assets.
 */
import type { RenderQuality, RendererOptions } from '@/contracts';
import { SessionBase, type DrawInput } from '../core/session';
import { TopDownPainter } from './topDown';

export class Fallback2DRenderer extends SessionBase {
  readonly kind = '2d' as const;
  private canvas!: HTMLCanvasElement;
  private painter: TopDownPainter | null = null;
  private resizeObs: ResizeObserver | null = null;
  private last: DrawInput | null = null;

  async mount(canvas: HTMLCanvasElement, options: RendererOptions): Promise<void> {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.canvas = canvas;
    this.painter = new TopDownPainter(ctx);
    this.initSession({ ...options, quality: 'low', fps: 30 });
    this.resize();
    if (typeof ResizeObserver !== 'undefined' && !options.offline) {
      this.resizeObs = new ResizeObserver(() => this.resize());
      this.resizeObs.observe(canvas);
    }
  }

  private resize() {
    if (!this.painter) return;
    const off = this.options.offline;
    const w = off ? off.width : Math.max(1, this.canvas.clientWidth || this.canvas.width);
    const h = off ? off.height : Math.max(1, this.canvas.clientHeight || this.canvas.height);
    const dpr = off ? 1 : Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.painter.resize(w, h, dpr);
    if (this.last) this.draw(this.last);
  }

  protected applyQuality(_q: RenderQuality) {}
  protected drawCalls(): number {
    return this.painter ? this.painter.calls : 0;
  }

  protected draw(input: DrawInput): void {
    if (!this.painter) return;
    this.last = input;
    this.painter.paint(input.script, input.scene, input.kits, this.reducedMotion);
  }

  dispose(): void {
    super.dispose();
    this.resizeObs?.disconnect();
    this.painter = null;
  }
}
