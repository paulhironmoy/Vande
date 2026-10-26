// Android lifecycle smoke (run through scripts/android-lifecycle.sh, which builds and wires everything): the real
// app in the emulator's WebView, driven over adb with Playwright's _android API, against the local API.
// Online Daily Six: sign up, play a ball, press HOME mid-ball and come back, kill the process mid-ball and relaunch
// (the same attempt resumes), finish with a verified, counted result, and check logcat for crashes and ANRs.
// Usage: node scripts/android-lifecycle.mjs <screenshot dir>
import { _android as android } from 'playwright-core';
const OUT = process.argv[2] ?? 'release/lifecycle';
const PKG = 'in.vande.cricket';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const [device] = await android.devices();
if (!device) throw new Error('no device');
log('device', device.model());
const shell = (c) => device.shell(c).then((b) => b.toString().trim());
await shell(`pm clear ${PKG}`);
await shell(`am start -W -n ${PKG}/.MainActivity`);
let webview = await device.webView({ pkg: PKG }, { timeout: 60_000 });
let page = await webview.page();
const shot = async (name) => { await device.screenshot({ path: `${OUT}/${name}.png` }); log('shot', name); };
const phase = () => page.getByTestId('batting-screen').getAttribute('data-phase');

// First run (online): Skip at the launch choice, alias, then straight to Daily Six.
await page.getByTestId('launch-skip').click({ timeout: 60_000 });
await page.getByTestId('age-year').fill(String(new Date().getFullYear() - 30), { timeout: 60_000 });
await page.getByTestId('age-continue').click();
await page.getByTestId('age-confirm-yes').click();
await page.getByTestId('onboarding-alias').fill('Android Ace', { timeout: 30_000 });
await page.getByTestId('onboarding-submit').click();
await page.waitForURL(/\/train$/, { timeout: 30_000 });
log('signed up, training reached');
await page.evaluate(() => { history.pushState({}, '', '/daily'); dispatchEvent(new PopStateEvent('popstate')); });
await page.getByTestId('daily-start').click({ timeout: 30_000 });
const waitPhase = async (re, ms = 30_000) => { await page.waitForFunction((r) => new RegExp(r).test(document.querySelector('[data-testid=batting-screen]')?.getAttribute('data-phase') ?? ''), re.source, { timeout: ms }); };
async function playBall() {
  await waitPhase(/ready|feedback|live|done|error/, 40_000);
  let p = await phase();
  if (p === 'ready' || p === 'feedback') await page.getByTestId('bat-next').click();
  if (p === 'error') await page.getByTestId('bat-retry').click();
  await waitPhase(/live|feedback|done|error/, 40_000);
  if ((await phase()) === 'live') await page.getByTestId('bat-hit').click({ timeout: 3_000 }).catch(() => {});
  await waitPhase(/feedback|done|error/, 40_000);
}
await playBall();
await shot('01-after-ball-1');

// Ball 2 is bowled; the player presses HOME before answering, then comes back.
await page.getByTestId('bat-next').click();
await waitPhase(/runup|live|feedback/);
await shell('input keyevent KEYCODE_HOME');
log('backgrounded');
await new Promise((r) => setTimeout(r, 4000));
await shot('02-home-screen');
await shell(`am start -W -n ${PKG}/.MainActivity`);
await new Promise((r) => setTimeout(r, 2500));
await shot('03-back-in-app');
log('phase after return', await phase().catch(() => 'n/a'));

// Ball 3: the process is killed while the ball is in play (Android reclaiming memory), then relaunched.
await waitPhase(/feedback|ready|live|done|error/, 40_000);
if ((await phase()) === 'feedback' || (await phase()) === 'ready') await page.getByTestId('bat-next').click();
await waitPhase(/runup|live|feedback/);
await shell('input keyevent KEYCODE_HOME');
await new Promise((r) => setTimeout(r, 1000));
await shell(`am kill ${PKG}`);
log('killed', await shell(`pidof ${PKG}`).catch(() => '') || '(no pid)');
await new Promise((r) => setTimeout(r, 1500));
await shell(`am start -W -n ${PKG}/.MainActivity`);
webview = await device.webView({ pkg: PKG }, { timeout: 60_000 });
page = await webview.page();
await page.evaluate(() => { history.pushState({}, '', '/daily'); dispatchEvent(new PopStateEvent('popstate')); }).catch(() => {});
await page.getByTestId('daily-resume').click({ timeout: 30_000 });
log('resumed after kill');
await shot('04-resumed-after-kill');

// Finish the attempt.
for (let g = 0; g < 14; g++) {
  const p = await phase().catch(() => null);
  if (p === 'done') break;
  if (p === 'ready' || p === 'feedback') await page.getByTestId('bat-next').click();
  else if (p === 'live') { await page.getByTestId('bat-hit').click({ timeout: 3_000 }).catch(() => {}); }
  else if (p === 'error') await page.getByTestId('bat-retry').click();
  await page.waitForTimeout(700);
}
await page.getByTestId('bat-done').click({ timeout: 30_000 });
await page.getByTestId('daily-result-screen').waitFor({ timeout: 30_000 });
const proof = await page.getByTestId('daily-proof-line').getAttribute('data-ok').catch(() => null);
const result = await page.getByTestId('daily-result').innerText();
log('result:', result.replace(/\s+/g, ' ').slice(0, 160), '| proof ok:', proof);
await shot('05-result');
const crashes = await shell(`logcat -d | grep -E "FATAL EXCEPTION|ANR in ${PKG}" | head -3`);
log('crashes:', crashes || 'none');
await device.close();
