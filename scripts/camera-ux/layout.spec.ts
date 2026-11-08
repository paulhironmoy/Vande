/**
 * The camera's screens in a real browser (CAMERA-UX evidence, DoD G-10 and CMX-07): every state at the phone sizes and the
 * laptop, at normal and 200% text. For each: a screenshot, axe (all rules, colour contrast included), and the measures that
 * a person would notice: nothing wider than the screen, every button at least 44 px each way, the primary action on
 * screen, no text clipped in its box. Findings are written to a JSON file next to the pictures and the test fails on any.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../..', process.env.E2E_OUT ?? 'test-results-camux', 'camera-ux');
const SHOTS = process.env.CAMUX_SHOTS ?? path.join(OUT, 'shots');
mkdirSync(SHOTS, { recursive: true });

const ALL = [
  'consent',
  'consent-short',
  'permission',
  'guide-download',
  'guide-stalled',
  'guide-retrying',
  'guide-failed',
  'guide-out',
  'guide-in',
  'trouble-blocked',
  'trouble-busy',
  'trouble-black',
  'trouble-none',
  'trouble-inapp',
  'trouble-light',
  'trouble-slow',
  'trouble-unsupported',
  'card-start',
  'card-consent',
  'card-view',
  'card-download',
  'card-busy',
  'chip',
  'chip-lost',
  'banner',
  'note',
  'cue-loop',
  'cue-still',
];
const STATES = (process.env.CAMUX_STATES ?? ALL.join(',')).split(',');
const VIEWPORTS = (process.env.CAMUX_VIEWPORTS ?? '640x360,844x390,1280x800').split(',').map((v) => {
  const [width, height] = v.split('x').map(Number);
  return { width, height };
});
const SCALES = (process.env.CAMUX_SCALES ?? '1,2').split(',').map(Number);

interface Finding {
  state: string;
  viewport: string;
  scale: number;
  kind: string;
  detail: string;
}
const findings: Finding[] = [];

for (const scale of SCALES) {
  for (const vp of VIEWPORTS) {
    test(`camera screens at ${vp.width}x${vp.height}, text ${scale * 100}%`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      for (const state of STATES) {
        const url = `/scripts/camera-ux/gallery/index.html?s=${state}&scale=${scale}${state === 'cue-still' ? '&motion=reduced' : ''}`;
        await page.goto(url);
        await page.waitForSelector('[data-gallery-ready="true"]', { state: 'attached', timeout: 30_000 });
        await page.waitForTimeout(150);
        const tag = `${state}-${vp.width}x${vp.height}-${scale}x`;
        await page.screenshot({ path: path.join(SHOTS, `${tag}.png`) });
        const add = (kind: string, detail: string) =>
          findings.push({ state, viewport: `${vp.width}x${vp.height}`, scale, kind, detail });

        const axe = await new AxeBuilder({ page }).analyze();
        for (const v of axe.violations) {
          if (v.impact === 'serious' || v.impact === 'critical')
            add('axe', `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
        }

        const metrics = await page.evaluate(() => {
          const out: string[] = [];
          const w = window.innerWidth;
          const h = window.innerHeight;
          if (document.documentElement.scrollWidth > w + 1) out.push(`page wider than the screen: ${document.documentElement.scrollWidth} > ${w}`);
          const roots = Array.from(
            document.querySelectorAll<HTMLElement>('[data-testid="camera-setup"], [data-testid="camera-ready"], [data-testid="camera-lost-banner"], [data-testid="camera-lost-note"], [data-testid="camera-chip"]'),
          );
          for (const el of roots) {
            const r = el.getBoundingClientRect();
            if (r.right > w + 1 || r.left < -1) out.push(`${el.dataset.testid} sticks out sideways: ${Math.round(r.left)}..${Math.round(r.right)} of ${w}`);
            if (el.scrollWidth > el.clientWidth + 1) out.push(`${el.dataset.testid} has horizontal overflow`);
          }
          for (const b of Array.from(document.querySelectorAll<HTMLElement>('button'))) {
            const r = b.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.height < 44 || r.width < 44) out.push(`button "${(b.textContent ?? '').trim().slice(0, 30)}" is ${Math.round(r.width)}x${Math.round(r.height)}`);
          }
          // The primary action (the first primary button) is on screen without scrolling.
          const primary = document.querySelector<HTMLElement>('[class*="primary"]');
          if (primary) {
            const r = primary.getBoundingClientRect();
            if (r.bottom > h + 1 || r.top < -1) out.push(`the primary action is off screen: ${Math.round(r.top)}..${Math.round(r.bottom)} of ${h}`);
          }
          // Text clipped inside its own box.
          for (const el of Array.from(document.querySelectorAll<HTMLElement>('h1, h2, p, li, span, button'))) {
            const cs = getComputedStyle(el);
            if ((cs.overflowX === 'hidden' || cs.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 1 && (el.textContent ?? '').trim()) {
              out.push(`text clipped: "${(el.textContent ?? '').trim().slice(0, 40)}"`);
            }
          }
          return out;
        });
        for (const m of metrics) add('layout', m);
      }
      await ctx.close();
    });
  }
}

/** The same screens in Hindi and Hinglish at the smallest phone and 200% text: the longest words must still fit. */
for (const lang of (process.env.CAMUX_LANGS ?? 'hi,hi-Latn').split(',').filter(Boolean)) {
  test(`camera screens in ${lang} at 640x360, text 200%`, async ({ browser }) => {
    const vp = { width: 640, height: 360 };
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const state of STATES) {
      await page.goto(`/scripts/camera-ux/gallery/index.html?s=${state}&scale=2&lang=${lang}`);
      await page.waitForSelector('[data-gallery-ready="true"]', { state: 'attached', timeout: 30_000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(SHOTS, `${state}-640x360-2x-${lang}.png`) });
      const found = await page.evaluate(() => {
        const out: string[] = [];
        const w = window.innerWidth;
        if (document.documentElement.scrollWidth > w + 1) out.push(`page wider than the screen: ${document.documentElement.scrollWidth} > ${w}`);
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-testid="camera-setup"], [data-testid="camera-ready"], [data-testid="camera-lost-banner"], [data-testid="camera-lost-note"]'))) {
          if (el.scrollWidth > el.clientWidth + 1) out.push(`${el.dataset.testid} has horizontal overflow`);
          const r = el.getBoundingClientRect();
          if (r.right > w + 1 || r.left < -1) out.push(`${el.dataset.testid} sticks out sideways`);
        }
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('h1, h2, p, li, span, button'))) {
          const cs = getComputedStyle(el);
          if ((cs.overflowX === 'hidden' || cs.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 1 && (el.textContent ?? '').trim())
            out.push(`text clipped: "${(el.textContent ?? '').trim().slice(0, 40)}"`);
        }
        return out;
      });
      for (const detail of found) findings.push({ state, viewport: '640x360', scale: 2, kind: `layout (${lang})`, detail });
    }
    await ctx.close();
  });
}

test.afterAll(() => {
  writeFileSync(path.join(OUT, 'findings.json'), JSON.stringify(findings, null, 2));
  const summary = findings.length
    ? findings.slice(0, 60).map((f) => `${f.state} ${f.viewport} ${f.scale}x ${f.kind}: ${f.detail}`)
    : ['no findings'];
  console.log(summary.join('\n'));
  expect(findings, 'see findings.json').toEqual([]);
});
