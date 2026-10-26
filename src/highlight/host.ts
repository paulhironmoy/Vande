/**
 * HighlightRenderHost (src/contracts/highlights.ts): composes the official highlight Short from a validated replay.
 * The 3D renderer plays its offline mode (fixed size, no wall clock, no adaptive quality) into a hidden canvas; each
 * frame is copied into the visible 2D canvas and the broadcast overlay is drawn on top. `frame(t)` depends only on
 * the input and t. No network code: everything comes from the input and the bundled fonts and code.
 */
import type { HighlightRenderHost, HighlightRenderInput, LocaleId } from '@/contracts';
import { createTranslator } from '@/i18n/translator';
import { ensureI18n } from '@/i18n/sources';
import { createMatchRenderer } from '@/render3d';
import type { StageRenderer } from '@/render3d';
import { buildTimeline, timelineTimeOf, type Timeline } from '@/render3d/core/timeline';
import { avatarImage } from '@/ui/avatar/avatarSvg';
import { renderHighlightAudio, wavBase64, type PcmAudio } from './audio';
import { displayNames, drawOverlay, H, W, type OverlayAssets } from './overlay';
import { FPS, planHighlight, sceneAt, type HighlightPlan } from './plan';

export interface HighlightHostOptions {
  /** The visible canvas the frames are composed into. */
  canvas: HTMLCanvasElement;
  /** Output scale (1 = 1080x1920 for the official render; 0.5 for the in-app preview). */
  scale?: number;
  /** Force the 2D replay (weak devices in the preview). */
  fallback?: boolean;
}

export interface HighlightHost extends HighlightRenderHost {
  plan(): HighlightPlan | null;
  /** How the last soundtrack was mastered (loudness, true peak, the bed's balance, gain and limiting). */
  audioReport(): PcmAudio['loudness'] | null;
  dispose(): void;
}

const SUPPORTED: LocaleId[] = ['en', 'hi', 'hi-Latn', 'bn', 'te', 'mr', 'ta', 'gu', 'kn', 'ml', 'pa'];

async function fontsReady(locale: LocaleId): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const loads = [500, 600, 700, 750, 820, 900].map((w) => document.fonts.load(`${w} 40px "Manrope Variable"`, 'VANDE Cricket 0123456789'));
  if (locale === 'hi' || locale === 'mr') loads.push(document.fonts.load('700 40px "Noto Sans Devanagari"', 'अआइ'), document.fonts.load('500 40px "Noto Sans Devanagari"', 'अआइ'));
  await Promise.all(loads).catch(() => undefined);
  await document.fonts.ready;
}

async function qrFor(url: string): Promise<{ path: Path2D; n: number } | null> {
  try {
    const { encode } = await import('uqr');
    const qr = encode(url, { ecc: 'Q', border: 1 });
    const n = qr.size;
    const hole = Math.ceil(n * 0.12);
    const c = n / 2;
    const path = new Path2D();
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (!qr.data[y][x]) continue;
        if (Math.abs(x + 0.5 - c) < hole && Math.abs(y + 0.5 - c) < hole) continue;
        path.rect(x, y, 1.02, 1.02);
      }
    return { path, n };
  } catch {
    return null;
  }
}

function dayLabel(day: string, intl: string): string {
  try {
    return new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(`${day}T12:00:00+05:30`));
  } catch {
    return day;
  }
}

export function createHighlightHost(o: HighlightHostOptions): HighlightHost {
  const scale = o.scale ?? 1;
  const out = o.canvas;
  out.width = Math.round(W * scale);
  out.height = Math.round(H * scale);
  const ctx = out.getContext('2d');
  const gl = document.createElement('canvas');
  let renderer: StageRenderer | null = null;
  let assets: OverlayAssets | null = null;
  let plan: HighlightPlan | null = null;
  let tl: Timeline | null = null;
  let mastered: PcmAudio['loudness'] | null = null;

  return {
    async load(input: HighlightRenderInput) {
      // The video shows only the moderated names from the input; without them there is nothing safe to draw.
      displayNames(input);
      const locale: LocaleId = SUPPORTED.includes(input.locale) ? input.locale : 'en';
      const [{ english, catalog }, avatars, qr] = await Promise.all([
        ensureI18n(locale),
        Promise.all(input.log.players.map((p) => avatarImage(p.avatar, p.kit, 480).catch(() => null))) as Promise<[HTMLImageElement | null, HTMLImageElement | null]>,
        qrFor(input.cta.url),
        fontsReady(locale),
      ]);
      const t = createTranslator(locale, catalog, english);
      renderer?.dispose();
      renderer = await createMatchRenderer({ fallback: o.fallback });
      gl.width = out.width;
      gl.height = out.height;
      await renderer.mount(gl, { quality: 'standard', reducedMotion: false, fps: 30, offline: { width: out.width, height: out.height } });
      await renderer.loadReplay(input.log, 'full');
      tl = renderer.timeline() ?? buildTimeline(input.log, 'full');
      plan = planHighlight(input.log, tl, { standings: Boolean(input.standings && input.standings.length > 0), timelineTimeOf });
      assets = { t, log: input.log, tl, input, plan, avatars, qr, day: dayLabel(input.day, t.intl) };
      return { durationMs: plan.durationMs, fps: FPS };
    },

    async frame(tMs: number) {
      if (!plan || !assets || !renderer || !ctx) throw new Error('load() first');
      const at = sceneAt(plan, tMs);
      renderer.renderAt(at.replay);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(gl, 0, 0, out.width, out.height);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      drawOverlay(ctx, assets, at.scene, at.index, at.local, at.replay);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // Let the compositor present the canvas before the caller captures it.
      await new Promise<void>((resolve) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => resolve()) : resolve()));
    },

    async audio() {
      if (!plan || !tl || typeof OfflineAudioContext === 'undefined') return null;
      try {
        const pcm = await renderHighlightAudio(plan, tl);
        mastered = pcm.loudness;
        return wavBase64(pcm);
      } catch {
        return null;
      }
    },

    plan: () => plan,

    audioReport: () => mastered,

    dispose() {
      renderer?.dispose();
      renderer = null;
      assets = null;
      plan = null;
    },
  };
}
