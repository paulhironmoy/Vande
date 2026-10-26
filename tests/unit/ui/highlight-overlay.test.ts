/**
 * The highlight composer's names: the video draws the moderated display names from the render input
 * (`HighlightRenderInput.aliases`) everywhere, never the match-time aliases in the log, and refuses an input without them.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { HighlightRenderInput } from '@/contracts';
import { createTranslator } from '@/i18n/translator';
import { ensureI18n } from '@/i18n/sources';
import type { Translator } from '@/i18n';
import { buildTimeline, timelineTimeOf } from '@/render3d/core/timeline';
import { planHighlight } from '@/highlight/plan';
import { displayNames, drawOverlay, type OverlayAssets } from '@/highlight/overlay';
import { resultText } from '@/screens/reveal/text';
import { fixtureMatchLog } from '@/screens/dev/fixtures';

/** A 2D context that records every string drawn (fill and stroke) and ignores the painting. */
function recordingContext(): { ctx: CanvasRenderingContext2D; texts: string[] } {
  const texts: string[] = [];
  const state: Record<string | symbol, unknown> = { globalAlpha: 1, font: '10px sans-serif' };
  const gradient = { addColorStop: () => undefined };
  const methods: Record<string, (...args: unknown[]) => unknown> = {
    fillText: (text) => void texts.push(String(text)),
    strokeText: (text) => void texts.push(String(text)),
    measureText: (text) => ({ width: String(text).length * 18 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  };
  const ctx = new Proxy(state, {
    get: (target, prop) => (prop in methods ? methods[prop as string] : prop in target ? target[prop] : () => undefined),
    set: (target, prop, value) => {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}

let t: Translator;
beforeAll(async () => {
  vi.stubGlobal(
    'Path2D',
    class {
      rect() {}
    },
  );
  const { english } = await ensureI18n('en');
  t = createTranslator('en', english, english);
});

const log = fixtureMatchLog();
const tl = buildTimeline(log, 'full');
const plan = planHighlight(log, tl, { standings: false, timelineTimeOf });
const input = (aliases: [string, string]): HighlightRenderInput => ({ jobId: 'job-test', log, aliases, locale: 'en', fixtureLabel: 'Friend Duel', day: '2026-10-25', ranks: [7, null], standings: null, cta: { url: 'https://vande.example/h/abc123' } });

/** Every string drawn across the cut: each scene once its names have faded in, and each ball while its caption shows. */
function drawnTexts(aliases: [string, string]): string[] {
  const assets: OverlayAssets = { t, log, tl, input: input(aliases), plan, avatars: [null, null], qr: null, day: '25 Oct 2026' };
  const { ctx, texts } = recordingContext();
  plan.scenes.forEach((scene, index) => {
    const local = Math.min(scene.kind === 'ball' ? 1200 : 1700, scene.t1 - scene.t0 - 1);
    drawOverlay(ctx, assets, scene, index, local, (scene.r0 ?? 0) + local);
  });
  return texts;
}

describe('highlight names', () => {
  const matchTime = log.players.map((p) => p.alias);

  it('draws the moderated names from the input on every card, never the match-time aliases', () => {
    const texts = drawnTexts(['Moderated One', 'Moderated Two']);
    const all = texts.join('\n');
    expect(all).toContain('Moderated One');
    expect(all).toContain('Moderated Two');
    for (const old of matchTime) expect(all).not.toContain(old);
    // Intro, score bug and result cards each show both names; the ball caption shows the matchup.
    expect(texts.filter((x) => x === 'Moderated One').length).toBeGreaterThanOrEqual(3);
    expect(texts.some((x) => x.includes('Moderated One') && x.includes('Moderated Two'))).toBe(true);
  });

  it('changing the aliases changes the drawn names (result line and player of the match included)', () => {
    const before = drawnTexts(['Moderated One', 'Moderated Two']).join('\n');
    const after = drawnTexts(['Renamed Ace', 'Renamed Bee']).join('\n');
    expect(after).not.toEqual(before);
    expect(after).not.toContain('Moderated One');
    expect(after).not.toContain('Moderated Two');
    expect(after).toContain('Renamed Ace');
    expect(after).toContain('Renamed Bee');
    expect(after).toContain(resultText(log.result, log, t, ['Renamed Ace', 'Renamed Bee']));
    expect(after).not.toContain(resultText(log.result, log, t));
  });

  it('refuses an input without two moderated names', () => {
    expect(displayNames(input(['Moderated One', 'Moderated Two']))).toEqual(['Moderated One', 'Moderated Two']);
    expect(() => displayNames({} as HighlightRenderInput)).toThrow(/moderated aliases/);
    expect(() => displayNames(input(['Moderated One', ' '] as [string, string]))).toThrow();
    expect(() => displayNames({ aliases: ['Only one'] } as unknown as HighlightRenderInput)).toThrow();
  });
});
