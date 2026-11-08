/**
 * Accessibility and readability: axe (WCAG 2.x A/AA rules) on each state of a tour from launch to a result,
 * text scaling (the app's largest setting, 1.3, and a 2.0 stress) with truncation, clipping, overlap and whether
 * the type really grew, touch targets, and a keyboard-only path from launch to the first ball.
 */
import AxeBuilder from '@axe-core/playwright';
import { context, isTouchVp, hookState, log, newPage, queue, sleep, waitFor, writeJson } from '../lib/env.mjs';
import { find, press } from '../lib/driver.mjs';
import { configureBuildOver } from './flow.mjs';
import { tryPress } from './capture.mjs';

/** Visits the states and calls `at(name)` in each: launch, Practice, Predefined, settings, field, result, pause. */
export async function tour(page, args, touch, at) {
  await page.goto(args.base + '/');
  let p = null;
  let root = false;
  for (let i = 0; i < 100 && !p && !root; i++) {
    p = await find(page, 'practice');
    if (!p && i > 15) root = Boolean(await find(page, 'random', { reject: (l) => /quick/i.test(l) && !/random/i.test(l) }));
    if (!p && !root) await sleep(100);
  }
  await sleep(500);
  await at('launch');
  if (!p && !root) return;
  if (p) {
    await press(page, p, touch);
    await sleep(1200);
    await at('practice');
  }
  const random = await find(page, 'random', { reject: (l) => /quick/i.test(l) });
  if (random) {
    await press(page, random, touch);
    await sleep(900);
    await at('random-setup');
    await tryPress(page, touch, ['screen-back', 'practice-back'], [/^back$/i]);
    await sleep(800);
  }
  const pre = await find(page, 'predefined');
  if (pre) {
    await press(page, pre, touch);
    await sleep(900);
    await configureBuildOver(page, touch).catch(() => null);
    await at('predefined');
    await tryPress(page, touch, ['screen-back', 'practice-back'], [/^back$/i]);
    await sleep(800);
  }
  if (await tryPress(page, touch, ['practice-settings-open'], [/^settings$/i])) {
    await sleep(800);
    await at('settings');
    await tryPress(page, touch, ['screen-back', 'practice-back'], [/^back$/i]);
    await sleep(800);
  }
  await queue(page, { kind: 'attack', contactErrorMs: 0, directionDeg: 25, power: 0.7 });
  const q = await find(page, 'quick', { reject: (l) => /random over/i.test(l) && !/quick/i.test(l) });
  if (!q) return;
  await press(page, q, touch);
  for (let i = 0; i < 12; i++) {
    if (await page.getByTestId('practice-setup').isVisible().catch(() => false)) {
      await sleep(600);
      await at('setup');
      break;
    }
    const st = await hookState(page);
    if (st && ['radar', 'runup', 'live'].includes(st.phase)) break;
    await sleep(250);
  }
  for (let i = 0; i < 6; i++) {
    const st = await hookState(page);
    if (st && ['radar', 'runup', 'live'].includes(st.phase)) break;
    if (!(await tryPress(page, touch, ['practice-setup-play', 'practice-play-start', 'practice-start', 'practice-tap-go']))) await sleep(400);
  }
  if (await waitFor(page, ['radar'], 6000)) await at('field');
  if (await waitFor(page, ['runup'], 30_000)) {
    await sleep(500);
    await at('live-runup');
  }
  if (await waitFor(page, ['coaching', 'dead'], 40_000)) {
    await sleep(600);
    await at('result');
  }
  await sleep(500);
  if (await tryPress(page, touch, ['practice-pause'], [/^pause$/i])) {
    if (await waitFor(page, ['paused'], 6000)) {
      await sleep(400);
      await at('paused');
    }
  }
}

const axeOf = async (page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const pick = (v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, targets: v.nodes.slice(0, 4).map((n) => n.target.join(' ')), help: v.help });
  return { violations: r.violations.map(pick), incomplete: r.incomplete.length, passes: r.passes.length };
};

async function axeRun(browser, args, vp) {
  const touch = isTouchVp(vp);
  const ctx = await context(browser, vp, { hooks: { tier: 'full', timeScale: 0.5, seed: 'eval-a11y' }, storage: { 'vc:practice:settings': { v: 1, guidedDone: true, demoSeen: true } } });
  const page = await newPage(ctx, []);
  const states = {};
  try {
    await tour(page, args, touch, async (name) => {
      const [axe, controls] = await Promise.all([axeOf(page).catch((e) => ({ error: String(e).slice(0, 200) })), page.evaluate(() => window.__eval.controls())]);
      const reach = controls.filter((c) => c.reachable && !c.disabled);
      states[name] = { axe, controls: reach.length, under44: reach.filter((c) => !c.target44).map((c) => `${c.name || c.testid} ${c.rect.w}×${c.rect.h}`) };
    });
  } finally {
    await ctx.close();
  }
  return states;
}

async function textRun(browser, args, vp, scale) {
  const touch = isTouchVp(vp);
  const storage = { 'vc:practice:settings': { v: 1, guidedDone: true, demoSeen: true }, 'vc:settings': { textScale: scale > 1.3 ? 1.3 : scale } };
  const ctx = await context(browser, vp, { hooks: { tier: 'full', timeScale: 0.5, seed: 'eval-text' }, storage });
  if (scale > 1.3) await ctx.addInitScript((s) => new MutationObserver(() => document.documentElement.style.getPropertyValue('--text-scale') !== String(s) && document.documentElement.style.setProperty('--text-scale', String(s))).observe(document.documentElement, { attributes: true }), scale);
  const page = await newPage(ctx, []);
  const states = {};
  try {
    await tour(page, args, touch, async (name) => {
      states[name] = await page.evaluate(() => ({ issues: window.__eval.textIssues(), stats: window.__eval.textStats(), scale: getComputedStyle(document.documentElement).getPropertyValue('--text-scale') }));
    });
  } finally {
    await ctx.close();
  }
  return states;
}

/** Keyboard only: Tab to the forward action on each screen and press Enter, until the first ball is released. */
async function keyboardRun(browser, args, vp) {
  const ctx = await context(browser, vp, { hooks: { tier: 'full', timeScale: 1, seed: 'eval-kbd' }, storage: { 'vc:practice:settings': { v: 1, guidedDone: true, demoSeen: true } } });
  const page = await newPage(ctx, []);
  const log2 = [];
  try {
    await page.goto(args.base + '/');
    await sleep(1500);
    let tabs = 0;
    for (let step = 0; step < 6; step++) {
      const st = await hookState(page);
      if (st && ['runup', 'live'].includes(st.phase)) break;
      let pressed = false;
      for (let i = 0; i < 25 && !pressed; i++) {
        const f = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const cs = getComputedStyle(el);
          return { name: (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50), testid: el.getAttribute('data-testid'), ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 ? 'outline' : cs.boxShadow !== 'none' ? 'shadow' : 'none' };
        });
        const forward = f && /^(practice|quick|play|start|bat|random over|predefined|continue)/i.test(f.name) && !/skip|settings|build/i.test(f.name);
        if (forward) {
          log2.push({ step, focused: f, tabsBefore: tabs });
          await page.keyboard.press('Enter');
          pressed = true;
          await sleep(1200);
        } else {
          await page.keyboard.press('Tab');
          tabs++;
        }
      }
      if (!pressed) break;
    }
    const ball = await waitFor(page, ['live'], 20_000);
    return { reachedFirstBall: ball, tabs, steps: log2 };
  } finally {
    await ctx.close();
  }
}

export async function runA11y(browser, args) {
  const out = { axe: {}, text: {}, keyboard: null };
  for (const vp of args.viewports) {
    log(args, `a11y axe ${vp}`);
    out.axe[vp] = await axeRun(browser, args, vp);
  }
  for (const vp of ['640x360', '915x412'].filter((v) => args.viewports.includes(v)))
    for (const scale of [1, 1.3, 2]) {
      log(args, `a11y text ${vp} ×${scale}`);
      out.text[`${vp}@${scale}`] = await textRun(browser, args, vp, scale);
    }
  log(args, 'a11y keyboard 1280x720');
  out.keyboard = await keyboardRun(browser, args, '1280x800');
  const sum = { axeSeriousOrCritical: {}, textIssues: {}, fontGrowth: {} };
  for (const [vp, states] of Object.entries(out.axe))
    for (const [s, v] of Object.entries(states)) sum.axeSeriousOrCritical[`${vp}/${s}`] = (v.axe.violations || []).filter((x) => x.impact === 'serious' || x.impact === 'critical').map((x) => `${x.id}×${x.nodes}`);
  for (const [k, states] of Object.entries(out.text)) for (const [s, v] of Object.entries(states)) sum.textIssues[`${k}/${s}`] = v.issues.length;
  for (const vp of ['640x360', '915x412']) {
    const a = out.text[`${vp}@1`];
    const b = out.text[`${vp}@1.3`];
    if (a && b) for (const s of Object.keys(a)) if (b[s]) sum.fontGrowth[`${vp}/${s}`] = a[s].stats.medianFontPx && b[s].stats.medianFontPx ? Math.round((b[s].stats.medianFontPx / a[s].stats.medianFontPx) * 100) / 100 : null;
  }
  sum.keyboard = out.keyboard;
  const file = writeJson(args, 'a11y', { summary: sum, ...out });
  log(args, `a11y → ${file}`);
  return sum;
}
