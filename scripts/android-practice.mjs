// Android Practice smoke and lifecycle (run through scripts/android-practice.sh, which builds and installs a debug
// app): the real app in the emulator's or device's WebView, driven over adb with Playwright's _android API. Offline
// only, no account. It never clears app data or uninstalls: an existing Practice innings is resumed, not wiped.
//   launch choice → Practice → device check (Classic when the device is Below) → bat a ball → HOME mid-delivery and
//   back (the delivery stands as a leave) → process killed mid-delivery and relaunched (resumes; that ball is a leave)
//   → orientation, logcat crashes and ANRs.
// Usage: node scripts/android-practice.mjs <screenshot dir>
import { _android as android } from 'playwright-core';
const OUT = process.argv[2] ?? 'release/practice-android';
const PKG = 'in.vande.cricket';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [device] = await android.devices();
if (!device) throw new Error('no device');
const shell = (c) => device.shell(c).then((b) => b.toString().trim());
log('device', device.model(), 'Android', await shell('getprop ro.build.version.release'), 'API', await shell('getprop ro.build.version.sdk'));
const results = { checks: [] };
const check = (name, ok, detail = '') => { results.checks.push({ name, ok, detail }); log(ok ? '✓' : '✗', name, detail); };
const shot = async (name) => { await device.screenshot({ path: `${OUT}/${name}.png` }); log('shot', name); };

async function launch() {
  await shell(`am start -W -n ${PKG}/.MainActivity`);
  const webview = await device.webView({ pkg: PKG }, { timeout: 60_000 });
  return webview.page();
}
// A normal (cold) start: stop the process if it is running. This never touches the app's data.
await shell(`am force-stop ${PKG}`);
let page = await launch();
const playAttr = (n) => page.evaluate((a) => document.querySelector('[data-testid=practice-play]')?.getAttribute(a) ?? null, n).catch(() => null);
const visible = (id) => page.getByTestId(id).isVisible().catch(() => false);
const innings = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('vc:practice:innings') ?? 'null')?.state ?? null; } catch { return null; } }).catch(() => null);

/** From the launch choice (or wherever the app opened) to a live delivery, resuming an innings if one is open. */
async function toLiveDelivery(label) {
  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    if ((await playAttr('data-phase')) === 'live' || (await playAttr('data-phase')) === 'runup') return;
    for (const id of ['launch-practice', 'practice-classic', 'practice-resume', 'practice-continue', 'practice-random', 'practice-start-over', 'practice-radar-go', 'practice-next-ball', 'practice-next-over', 'practice-new-innings', 'practice-discard-dialog-confirm', 'practice-turn-continue']) {
      if (await visible(id)) {
        log(label, 'tap', id);
        await page.getByTestId(id).click({ timeout: 5_000 }).catch(() => {});
        await sleep(400);
        break;
      }
    }
    await sleep(250);
  }
  throw new Error(`${label}: no live delivery within 90 s`);
}
const waitPhase = (re, ms = 30_000) => page.waitForFunction((r) => new RegExp(r).test(document.querySelector('[data-testid=practice-play]')?.getAttribute('data-phase') ?? ''), re.source, { timeout: ms, polling: 'raf' });

// 1. Launch choice on a normal start.
await page.getByTestId('launch-choice').waitFor({ timeout: 60_000 });
check('launch choice shown on a normal start', true);
await shot('01-launch-choice');
await toLiveDelivery('first');
const perf = await page.evaluate(() => localStorage.getItem('vc:practice:perf'));
const a = perf ? JSON.parse(perf).assessment : null;
log('device check:', a ? `${a.tier} / ${a.profile} · ${a.avgFps} fps · p95 ${a.p95FrameMs} ms · ${a.renderer} · ${a.reasons.join(',')}` : 'none');
results.assessment = a;
const size = await shell('wm size');
const rot = await shell("dumpsys window displays | grep -m1 -o 'mCurrentRotation=[A-Z_0-9]*'").catch(() => '');
check('Practice runs in landscape', /ROTATION_(90|270)/.test(rot), rot);
log('display', size, '|', rot);
results.orientation = rot;

// 2. Bat one ball with a real touch (adb input, through Android's own input pipeline) about 0.45 s after release.
const [pw, ph] = (size.match(/(\d+)x(\d+)/) ?? [0, 1080, 2400]).slice(1).map(Number);
const landscape = /ROTATION_(90|270)|SurfaceOrientation: [13]/.test(rot);
const [sw, sh] = landscape ? [Math.max(pw, ph), Math.min(pw, ph)] : [pw, ph];
/** A tap in the middle of the gesture surface (the lower part of the play screen). */
const tap = () => shell(`input tap ${Math.round(sw * 0.5)} ${Math.round(sh * 0.82)}`);
await waitPhase(/live/, 40_000);
await sleep(380);
await tap();
await waitPhase(/coaching|warmup_explain|replay/, 30_000);
await shot('02-after-first-ball');
const card = (await page.locator('[data-testid=practice-play]').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
check('a ball was bowled and resolved with a real tap', card.length > 0, card);

// 3. HOME in the middle of a delivery, then back: the delivery stands as a leave, nothing is replayed.
await toLiveDelivery('home');
const before = await innings();
await waitPhase(/live/, 40_000);
await sleep(150);
await shell('input keyevent KEYCODE_HOME');
log('backgrounded mid-delivery');
await sleep(3_000);
await shot('03-home-screen');
await shell(`am start -W -n ${PKG}/.MainActivity`);
await sleep(2_500);
await shot('04-back-in-app');
const afterHome = await innings();
const phaseAfterHome = await playAttr('data-phase');
log('after HOME: phase', phaseAfterHome, 'balls', before?.balls, '→', afterHome?.balls, 'inFlight', afterHome?.inFlight);
check('HOME mid-delivery: the app comes back paused or on the result, with no ball in flight', !afterHome || !afterHome.inFlight, `phase ${phaseAfterHome}`);

// 4. Process killed mid-delivery (Android reclaiming memory), then relaunched: the innings resumes and that ball
//    counts as a leave (no save-scumming).
if (await visible('practice-resume')) await page.getByTestId('practice-resume').click().catch(() => {});
await toLiveDelivery('kill');
const beforeKill = await innings();
await waitPhase(/live/, 40_000);
await sleep(120);
await shell('input keyevent KEYCODE_HOME');
await sleep(800);
await shell(`am kill ${PKG}`);
log('killed', (await shell(`pidof ${PKG}`).catch(() => '')) || '(no pid)');
await sleep(1_500);
page = await launch();
await page.getByTestId('launch-choice').waitFor({ timeout: 60_000 }).catch(() => {});
await shot('05-relaunched');
await page.getByTestId('launch-practice').click({ timeout: 30_000 }).catch(() => {});
await page.getByTestId('practice-resume-card').waitFor({ timeout: 60_000 }).catch(() => {});
await shot('06-resume-card');
const afterKill = await innings();
log('kill: balls', beforeKill?.balls, '→', afterKill?.balls, 'inFlight', afterKill?.inFlight, 'status', afterKill?.status);
check('killed mid-delivery: the innings is kept and the in-flight ball was counted (as a leave)', !!afterKill && !afterKill.inFlight && (afterKill.balls > (beforeKill?.balls ?? 0) || afterKill.status !== 'batting'), `balls ${beforeKill?.balls} → ${afterKill?.balls}`);
if (await visible('practice-continue')) {
  await page.getByTestId('practice-continue').click();
  await sleep(2_000);
  await shot('07-continued');
}

// 5. Crashes and ANRs.
const crashes = await shell(`logcat -d | grep -E "FATAL EXCEPTION|ANR in ${PKG}" | head -3`);
check('no crash or ANR in logcat', !crashes, crashes);
results.webviewVersion = await shell("dumpsys package com.google.android.webview | grep -m1 versionName").catch(() => '');
console.log('RESULT', JSON.stringify(results));
await device.close();
process.exit(results.checks.every((c) => c.ok) ? 0 : 1);
