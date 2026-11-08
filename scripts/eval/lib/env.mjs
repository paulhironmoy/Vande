/**
 * Evaluation environment: arguments, output folders, the browser (hardware GPU or SwiftShader), contexts per
 * viewport, the probes and the Practice test hooks. Used by scripts/eval/run.mjs; see docs/EVALUATION.md.
 *
 * Evidence goes to release/eval/<label>/ (gitignored). Nothing here changes product code or the served build.
 */
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { loadavg, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(here, '..', '..', '..');
export const PROBES = [join(here, 'probe-dom.js'), join(here, 'probe-stage.js'), join(here, 'probe-ball.js')];

/**
 * The locked rubric's landscape viewports (release/player-experience/ceiling-rubric.md §3), plus the original brief's
 * 1280×720 and 2400×1080 and the portrait check. Phones get touch and a 2× pixel ratio; the rest a mouse.
 */
export const VIEWPORTS = {
  '640x360': { viewport: { width: 640, height: 360 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  '844x390': { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  '915x412': { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  '1280x800': { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false },
  '1920x1080': { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false },
  '1280x720': { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false },
  '2400x1080': { viewport: { width: 2400, height: 1080 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false },
  '390x844': { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
};
export const LOCKED_VIEWPORTS = ['640x360', '844x390', '915x412', '1280x800', '1920x1080'];
export const isTouchVp = (vp) => Boolean(VIEWPORTS[vp]?.hasTouch);

/** `uptime` (load averages) for every timing record (rubric R10: the machine is shared and loaded). */
export function uptime() {
  try {
    return execSync('uptime', { encoding: 'utf8' }).trim();
  } catch {
    return `loadavg ${loadavg().map((x) => x.toFixed(2)).join(' ')}`;
  }
}

export function parseArgs(argv = process.argv.slice(2)) {
  const a = { base: 'http://localhost:4213', label: 'after', only: null, viewports: LOCKED_VIEWPORTS, gpu: 'hw', video: true, buildId: null };
  for (let i = 0; i < argv.length; i++) {
    const [k, v] = argv[i].includes('=') ? argv[i].split(/=(.*)/s) : [argv[i], argv[i + 1]];
    const take = () => (argv[i].includes('=') ? v : (i++, v));
    if (k === '--base') a.base = take();
    else if (k === '--label') a.label = take();
    else if (k === '--only') a.only = take().split(',');
    else if (k === '--viewports') a.viewports = take().split(',');
    else if (k === '--gpu') a.gpu = take();
    else if (k === '--no-video') a.video = false;
    else if (k === '--build-id') a.buildId = take();
    else if (k === '--parts') a.parts = take().split(',');
  }
  // Evidence lives only under the Rookie Examiner's folder (release/player-experience/rookie/**).
  a.out = join(REPO, 'release', 'player-experience', 'rookie', 'runs', a.label);
  return a;
}

/** Bulk captures (screenshots, video, close-ups) stay out of release/ (AGENTS.md): EVAL_BULK, else the temp dir. */
export function bulkDir(args, ...parts) {
  const d = join(process.env.EVAL_BULK || join(tmpdir(), 'vande-eval-bulk'), args.label, ...parts);
  mkdirSync(d, { recursive: true });
  return d;
}

export function outDir(args, ...parts) {
  const d = join(args.out, ...parts);
  mkdirSync(d, { recursive: true });
  return d;
}

export function writeJson(args, name, data) {
  const f = join(outDir(args, 'metrics'), `${name}.json`);
  writeFileSync(f, JSON.stringify(data, null, 2));
  return f;
}

export function log(args, line) {
  const f = join(outDir(args), 'log.txt');
  const s = `[${new Date().toISOString()}] [load ${loadavg().map((x) => x.toFixed(1)).join(' ')}] ${line}`;
  appendFileSync(f, s + '\n');
  console.log(s);
}

/** Hardware GPU (full Chromium, new headless: ANGLE Metal on this Mac) or SwiftShader (headless shell). */
export async function launch(gpu = 'hw') {
  if (gpu === 'sw') return chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  return chromium.launch({ channel: 'chromium', args: ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
}

/**
 * A fresh context (empty storage) for one viewport, with the probes, the hooks configuration and optional seeded
 * storage. `storage` maps localStorage keys to values set before any page script runs (first load only).
 */
export async function context(browser, vpName, { hooks = null, storage = null, video = null, reducedMotion = 'no-preference' } = {}) {
  const vp = VIEWPORTS[vpName];
  const ctx = await browser.newContext({ ...vp, colorScheme: 'dark', reducedMotion, ...(video ? { recordVideo: { dir: video, size: vp.viewport } } : {}) });
  for (const p of PROBES) await ctx.addInitScript({ path: p });
  await ctx.addInitScript(
    ([cfg, store]) => {
      if (cfg) window.__VANDE_PRACTICE_TEST__ = cfg;
      if (store && !sessionStorage.getItem('__eval_seeded')) {
        try {
          for (const [k, v] of Object.entries(store)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
          sessionStorage.setItem('__eval_seeded', '1');
        } catch {
          /* storage blocked */
        }
      }
    },
    [hooks, storage],
  );
  return ctx;
}

export async function newPage(ctx, errors = []) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text().slice(0, 300)}`));
  return page;
}

// ---- the Practice test hooks (src/practice/ui/testHooks.ts), present in VITE_PRACTICE_TEST_HOOKS=1 builds ----

export async function hooksReady(page, timeout = 60_000) {
  return page
    .waitForFunction(() => Boolean(window.__vandePractice), undefined, { timeout })
    .then(() => true)
    .catch(() => false);
}

/** Phase names of both trees (before: radar, coaching, warmup_explain; rebuilt: loading, ready, dead, demo, closeup). */
export const PHASE_NAMES = ['idle', 'radar', 'runup', 'live', 'playing', 'coaching', 'warmup_explain', 'replay', 'paused', 'loading', 'intro', 'ready', 'dead', 'demo', 'closeup'];

/**
 * Waits for one of the controller's phases or screens; false on timeout (never throws). The hooks' own waitFor
 * (exact, subscription-based) races a 16 ms poll of state() that knows both trees' phase names, so a stale phase
 * list in a build's test hooks cannot make a wait hang.
 */
export async function waitFor(page, states, timeoutMs = 60_000) {
  if (!(await hooksReady(page, Math.min(timeoutMs, 60_000)))) return false;
  return page
    .evaluate(
      ([names, ms, phases]) =>
        new Promise((resolve) => {
          const api = window.__vandePractice;
          const hit = () => {
            const s = api.state();
            if (!s) return false;
            return names.some((n) => (n === 'tap_gate' || n === 'turn' ? false : phases.includes(n) ? s.phase === n : s.screen === n));
          };
          let done = false;
          let iv = 0;
          let to = 0;
          const finish = (v) => {
            if (done) return;
            done = true;
            clearInterval(iv);
            clearTimeout(to);
            resolve(v);
          };
          if (hit()) return finish(true);
          iv = setInterval(() => hit() && finish(true), 16);
          to = setTimeout(() => finish(false), ms);
          api.waitFor(names, ms).then((v) => v && finish(true), () => undefined);
        }),
      [states, timeoutMs, PHASE_NAMES],
    )
    .catch(() => false);
}

export async function hookState(page) {
  return page.evaluate(() => (window.__vandePractice ? window.__vandePractice.state() : null)).catch(() => null);
}

export async function queue(page, ...swings) {
  if (!(await hooksReady(page))) return 0;
  return page.evaluate((s) => window.__vandePractice.queueSwing(...s), swings);
}

/** Screenshot plus the DOM census for one named state. */
export async function snap(page, args, vpName, name, extra = {}) {
  const dir = bulkDir(args, 'shots', vpName);
  const file = join(dir, `${name}.png`);
  await page.screenshot({ path: file, animations: 'allow' }).catch(() => undefined);
  const census = await page
    .evaluate(() => ({
      controls: window.__eval.controls(),
      text: window.__eval.textStats(),
      issues: window.__eval.textIssues(),
      anim: window.__eval.animations(),
      url: location.pathname,
      phase: document.querySelector('[data-testid="practice-play"]')?.getAttribute('data-phase') || null,
      // Everything a player can read or hear: rendered text plus accessible names (F8, RK2 scans).
      visibleText: (document.body.innerText || '').replace(/\s+\n/g, '\n').slice(0, 6000),
      labels: Array.from(document.querySelectorAll('[aria-label],[title],[alt]')).map((e) => e.getAttribute('aria-label') || e.getAttribute('title') || e.getAttribute('alt')).filter(Boolean).slice(0, 80),
      headings: Array.from(document.querySelectorAll('h1,h2,[role=heading]')).filter((h) => h.getBoundingClientRect().width > 0).map((h) => h.textContent.trim()).slice(0, 10),
      style: window.__eval.styleStats ? window.__eval.styleStats() : null,
    }))
    .catch((e) => ({ error: String(e) }));
  return { name, viewport: vpName, file, ...census, ...extra, exists: existsSync(file) };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
