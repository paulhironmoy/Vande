/**
 * Flow metrics: steps, decisions and first-ball time from the launch screen to the first released ball, for a new
 * player (empty storage, the real device check) and a returning one (first run done, tier fixed by the hooks), in
 * each mode the build offers. Eager runs (every action pressed as soon as it shows) give the mechanical time;
 * a patient run (waits before each confirmation) gives the required taps. Configuration taps are reported apart.
 */
import { loadavg } from 'node:os';
import { context, isTouchVp, hookState, log, newPage, uptime, waitFor, writeJson, sleep } from '../lib/env.mjs';
import { find, pathToFirstBall, press } from '../lib/driver.mjs';

/** The reference over (VANDE-PRACTICE-NORTHSTAR.md): full outswinger, inswinger at the stumps, hard length, cutter, bouncer, yorker. */
export const REFERENCE_OVER = [
  { variation: 'outswing', lineM: 0.25, lengthM: 2.6 },
  { variation: 'inswing', lineM: 0.0, lengthM: 3.6 },
  { variation: 'stock', lineM: 0.15, lengthM: 7.2 },
  { variation: 'cutter', lineM: 0.1, lengthM: 6.0 },
  { variation: 'bouncer', lineM: 0.0, lengthM: 9.0 },
  { variation: 'yorker', lineM: 0.0, lengthM: 0.8 },
];

const shown = (loc) => loc.first().isVisible().catch(() => false);
const tapOn = async (loc, touch) => (touch ? loc.first().tap() : loc.first().click());

/**
 * Fills six custom deliveries (the reference over's six, entered by hand) in either editor: before the rebuild,
 * Build an Over (pitch map, delivery, Save per ball); after it, Predefined Over's "Your own six" (delivery, then a
 * pitch-map tap that commits the ball and moves on). Taps are counted as the player would make them; a delivery
 * already selected costs nothing. Returns the taps, or null when no editor is on screen.
 */
export async function configureBuildOver(page, touch) {
  const map = page.getByTestId('practice-pitch-map');
  const own = page.getByTestId('practice-build-mode-own');
  if (!(await shown(map)) && !(await shown(own))) return null;
  let taps = 0;
  const tap = async (loc) => {
    await tapOn(loc, touch);
    taps++;
    await page.waitForTimeout(150);
  };
  if ((await shown(own)) && (await own.first().getAttribute('aria-checked')) !== 'true') await tap(own);
  const pace = page.getByTestId('practice-build-family-pace');
  if ((await shown(pace)) && (await pace.first().getAttribute('aria-checked')) === 'false') await tap(pace);
  const legacy = await shown(page.getByTestId('practice-build-save'));
  const tapMap = async (b) => {
    const box = await map.first().boundingBox();
    const pos = { x: ((b.lineM + 0.6) / 1.4) * box.width, y: (1 - b.lengthM / 11) * box.height };
    if (touch) await page.touchscreen.tap(box.x + pos.x, box.y + pos.y);
    else await map.first().click({ position: pos });
    taps++;
    await page.waitForTimeout(150);
  };
  const chooseVariation = async (v) => {
    let opt = page.getByTestId(`practice-build-variation-${v}`);
    if (!(await shown(opt))) {
      const toggle = page.getByTestId('practice-build-delivery-toggle');
      if (await shown(toggle)) await tap(toggle);
    }
    opt = page.getByTestId(`practice-build-variation-${v}`);
    if ((await shown(opt)) && (await opt.first().getAttribute('aria-checked')) !== 'true') await tap(opt);
  };
  for (const [i, b] of REFERENCE_OVER.entries()) {
    if (legacy) {
      // Before the rebuild: target, delivery, then Save into the slot.
      await tapMap(b);
      await chooseVariation(b.variation);
      await tap(page.getByTestId('practice-build-save'));
      continue;
    }
    // The rebuilt editor commits an empty ball on its first change and moves on, so: make sure ball i is selected,
    // set its target (creates it), select it again if the editor moved on, then set its delivery.
    const slot = page.getByTestId(`practice-slot-${i + 1}`);
    if ((await shown(slot)) && (await slot.first().getAttribute('aria-pressed')) !== 'true') await tap(slot);
    await tapMap(b);
    if ((await shown(slot)) && (await slot.first().getAttribute('aria-pressed')) !== 'true') await tap(slot);
    await chooseVariation(b.variation);
  }
  return taps;
}

/** Predefined: before the rebuild the editor must be filled; after it the reference over is ready at once. */
export async function configurePredefined(page, touch) {
  return configureBuildOver(page, touch);
}

async function launchVisible(page, base) {
  const t0 = Date.now();
  await page.goto(base + '/');
  for (let i = 0; i < 200; i++) {
    // The launch's first forward action: Practice, or (Stage 1) the Practice home's modes at the root.
    const first = (await find(page, 'practice')) || (await find(page, 'random', { reject: (l) => /quick/i.test(l) && !/random/i.test(l) })) || (await find(page, 'predefined'));
    if (first) return { t0, visibleMs: Date.now() - t0 };
    await sleep(50);
  }
  return { t0, visibleMs: null };
}

/** One journey: launch → first ball. Returns steps, times and what the controller says. */
async function journey(browser, args, { vp, persona, mode, patient, gpu, dwellMs = 0 }) {
  const returning = persona === 'returning';
  const hooks = returning ? { tier: 'full', timeScale: 1, seed: `eval-flow-${mode}` } : { timeScale: 1, seed: `eval-flow-${mode}` };
  const storage = returning ? { 'vc:practice:settings': { v: 1, guidedDone: true, demoSeen: true } } : null;
  const ctx = await context(browser, vp, { hooks, storage });
  const errors = [];
  const page = await newPage(ctx, errors);
  const touch = isTouchVp(vp);
  try {
    const { visibleMs } = await launchVisible(page, args.base);
    const tLaunch = Date.now();
    const configure = mode === 'predefined' ? (p) => configurePredefined(p, touch) : null;
    const path = await pathToFirstBall(page, { mode, touch, configure, patient, dwellMs, t0: tLaunch });
    // The compatibility screen (software graphics): its one forward action counts as a step.
    if (!path.reached) {
      const classic = page.getByTestId('practice-classic');
      if (await classic.isVisible().catch(() => false)) {
        const alt = await page.evaluate(() => window.__eval.controls().filter((c) => c.reachable && !c.disabled).map((c) => c.name));
        const at = await press(page, { loc: classic }, touch);
        path.steps.push({ step: 'fallback', how: 'testid=practice-classic', label: 'Classic', atMs: at - tLaunch, alternatives: alt, decision: alt.length >= 2 });
        const more = await pathToFirstBall(page, { mode, touch, configure: null, patient, t0: tLaunch });
        path.steps.push(...more.steps);
        path.reached = more.reached;
      }
    }
    if (path.unavailable) return { vp, persona, mode, patient, gpu, reached: false, unavailable: path.unavailable, steps: path.steps, launchVisibleMs: visibleMs, errors };
    const live = await waitFor(page, ['live'], 60_000);
    const tBall = Date.now();
    const st = await hookState(page);
    const shownNotices = await page.evaluate(() => Array.from(document.querySelectorAll('[role=status],[role=alert]')).map((e) => e.textContent.trim()).filter(Boolean)).catch(() => []);
    return {
      vp,
      persona,
      mode,
      patient,
      gpu,
      dwellMs,
      uptime: uptime(),
      reached: live,
      launchVisibleMs: visibleMs,
      firstBallMs: live ? tBall - tLaunch : null,
      ttfdMsFromApp: st?.ttfdMs ?? null,
      taps: path.steps.length,
      configTaps: path.configTaps,
      decisions: path.steps.filter((s) => s.decision).length,
      steps: path.steps,
      stage: st?.stage ?? null,
      tier: st?.tier ?? null,
      overSource: st?.over?.source ?? null,
      notices: shownNotices,
      load: loadavg().map((x) => Math.round(x * 100) / 100),
      errors,
    };
  } catch (e) {
    return { vp, persona, mode, patient, gpu, error: String(e), errors };
  } finally {
    await ctx.close();
  }
}

/**
 * Configuration task: six custom deliveries (the reference over's six, entered by hand) in the Predefined editor,
 * then the over is started and its plan checked against what was entered. Counts every tap from the editor opening
 * to the first ball, and the mechanical time.
 */
async function configTask(browser, args, vp) {
  const touch = isTouchVp(vp);
  const ctx = await context(browser, vp, { hooks: { tier: 'full', timeScale: 1, seed: 'eval-config' }, storage: { 'vc:practice:settings': { v: 1, guidedDone: true, demoSeen: true } } });
  const page = await newPage(ctx, []);
  try {
    await page.goto(args.base + '/practice');
    await sleep(1500);
    const pre = await find(page, 'predefined');
    if (!pre) return { error: 'no Predefined action' };
    const t0 = Date.now();
    await press(page, pre, touch);
    await sleep(600);
    const taps = await configureBuildOver(page, touch);
    if (taps === null) return { error: 'no editor' };
    const tConfigured = Date.now();
    // M3: copy, edit and reorder work (the rebuilt editor's per-ball controls), checked on the slot labels.
    const label = (n) => page.getByTestId(`practice-slot-${n}`).first().getAttribute('aria-label').catch(() => null);
    const ops = {};
    const t = async (id) => {
      const l = page.getByTestId(id);
      if (!(await l.first().isVisible().catch(() => false)) || !(await l.first().isEnabled().catch(() => false))) return false;
      await (touch ? l.first().tap() : l.first().click());
      await page.waitForTimeout(200);
      return true;
    };
    if (await page.getByTestId('practice-ball-copy').first().isVisible().catch(() => false)) {
      // Edit: ball 3 becomes a slower ball.
      await t('practice-slot-3');
      const before3 = await label(3);
      const toggle = page.getByTestId('practice-build-delivery-toggle');
      if (!(await page.getByTestId('practice-build-variation-slower').first().isVisible().catch(() => false))) await t('practice-build-delivery-toggle');
      await t('practice-build-variation-slower');
      ops.edit = { before: before3, after: await label(3) };
      ops.edit.ok = Boolean(ops.edit.after && ops.edit.after !== ops.edit.before && /slower/i.test(ops.edit.after));
      // Reorder: ball 3 moves later, to 4.
      const l3 = await label(3);
      const l4 = await label(4);
      ops.reorder = { pressed: await t('practice-ball-later') };
      ops.reorder.ok = ops.reorder.pressed && (await label(4))?.replace(/Ball \d+/, '') === l3?.replace(/Ball \d+/, '') && (await label(3))?.replace(/Ball \d+/, '') === l4?.replace(/Ball \d+/, '');
      // Copy: clear ball 6, then copy ball 1 into the empty slot.
      await t('practice-slot-6');
      ops.clear = { pressed: await t('practice-ball-clear') };
      await t('practice-slot-1');
      const l1 = await label(1);
      ops.copy = { pressed: await t('practice-ball-copy') };
      ops.copy.ok = ops.copy.pressed && (await label(6))?.replace(/Ball \d+/, '') === l1?.replace(/Ball \d+/, '');
      void toggle;
    } else ops.unavailable = 'no copy/reorder controls (edit by re-saving a slot only)';
    const path = await pathToFirstBall(page, { mode: 'predefined', touch, t0 });
    const live = await waitFor(page, ['live'], 60_000);
    const st = await hookState(page);
    // After the edit (3 → slower), the reorder (3 ↔ 4) and the copy (1 → cleared 6), the over should read:
    const want = ops.copy?.ok ? ['outswing', 'inswing', 'cutter', 'slower', 'bouncer', 'outswing'] : REFERENCE_OVER.map((b) => b.variation);
    return { configTaps: taps, startTaps: path.steps.length, totalTaps: 1 + taps + path.steps.length, configMs: tConfigured - t0, scriptedAt1sPerDecisionS: taps + path.steps.length + 1, toBallMs: live ? Date.now() - t0 : null, plan: st?.over ?? null, variationsMatch: st?.over ? JSON.stringify(st.over.variations) === JSON.stringify(want) : false, wanted: want, ops, steps: path.steps.map((x) => `${x.step}:${x.label}`), uptime: uptime() };
  } catch (e) {
    return { error: String(e).slice(0, 300) };
  } finally {
    await ctx.close();
  }
}

export async function runFlow(browser, args, { gpu = 'hw', reps = 3 } = {}) {
  if (args.parts && args.parts.includes('config')) {
    if (gpu !== 'hw') return null;
    const byVp = {};
    for (const vp of args.viewports) {
      log(args, `flow config task ${vp}`);
      byVp[vp] = await configTask(browser, args, vp);
    }
    const file = writeJson(args, 'flow-config', byVp);
    log(args, `flow config task → ${file}`);
    return Object.fromEntries(Object.entries(byVp).map(([k, v]) => [k, { taps: v.totalTaps, match: v.variationsMatch, ops: v.ops, error: v.error }]));
  }
  const results = [];
  const vp = '915x412';
  const plan = [
    ['new', 'quick'],
    ['returning', 'quick'],
    ['returning', 'predefined'],
    ['returning', 'random'],
  ];
  for (const [persona, mode] of plan) {
    log(args, `flow ${gpu} ${persona}/${mode} patient`);
    results.push(await journey(browser, args, { vp, persona, mode, patient: true, gpu }));
    for (let i = 0; i < reps; i++) {
      log(args, `flow ${gpu} ${persona}/${mode} eager #${i + 1}`);
      results.push(await journey(browser, args, { vp, persona, mode, patient: false, gpu }));
    }
  }
  for (const persona of ['new', 'returning']) {
    log(args, `flow ${gpu} ${persona}/quick with a 2 s dwell per decision (F2)`);
    results.push(await journey(browser, args, { vp, persona, mode: 'quick', patient: false, gpu, dwellMs: 2000 }));
  }
  log(args, `flow ${gpu} small phone 640x360 returning/quick eager`);
  results.push(await journey(browser, args, { vp: '640x360', persona: 'returning', mode: 'quick', patient: false, gpu }));
  const median = (xs) => {
    const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  };
  const summary = {};
  for (const [persona, mode] of plan) {
    const eager = results.filter((r) => r.persona === persona && r.mode === mode && !r.patient && !r.dwellMs && r.vp === vp);
    const dwell = results.find((r) => r.persona === persona && r.mode === mode && r.dwellMs);
    const patient = results.find((r) => r.persona === persona && r.mode === mode && r.patient);
    summary[`${persona}/${mode}`] = {
      reached: eager.every((r) => r.reached),
      unavailable: patient?.unavailable ?? null,
      requiredTaps: patient?.taps ?? null,
      decisions: patient?.decisions ?? null,
      configTaps: patient?.configTaps ?? null,
      medianFirstBallMs: median(eager.map((r) => r.firstBallMs)),
      medianTtfdFromAppMs: median(eager.map((r) => r.ttfdMsFromApp)),
      dwell2sFirstBallMs: dwell?.firstBallMs ?? null,
      uptime: eager.map((r) => r.uptime),
      path: patient?.steps.map((s) => `${s.step}:${s.label || s.testid}`) ?? [],
    };
  }
  if (gpu === 'hw') {
    log(args, 'flow config task: six custom deliveries');
    summary.configTask = await configTask(browser, args, vp);
  }
  const file = writeJson(args, `flow-${gpu}`, { summary, results });
  log(args, `flow ${gpu} → ${file}`);
  return summary;
}
