#!/usr/bin/env node

import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await context.newPage();
const consoleMessages = [];
const pauses = [];

page.on('console', (message) => consoleMessages.push({ type: message.type(), text: message.text() }));
page.on('pageerror', (error) => consoleMessages.push({ type: 'pageerror', text: error.stack ?? error.message }));

await page.addInitScript(() => {
  try {
    localStorage.clear();
    localStorage.setItem('vc:practice:settings', JSON.stringify({ v: 1, teach: true, demoSeen: false }));
  } catch {
    // about:blank has no usable storage; the script runs again in the app origin.
  }
  const trace = [];
  window.__vandeDemoTrace = trace;
  const record = (kind, value) => trace.push({ at: performance.now(), kind, value });
  let webHost;
  Object.defineProperty(window, 'VandeUnityPracticeWebHost', {
    configurable: true,
    get: () => webHost,
    set: (value) => {
      webHost = value;
      record('web-host-installed', true);
      if (!value || typeof value.emitFromUnity !== 'function') return;
      const emit = value.emitFromUnity.bind(value);
      value.emitFromUnity = (operationId, packet) => {
        let decoded = packet;
        try { decoded = JSON.parse(packet); } catch { /* retain raw packet */ }
        record('unity-inbound', { operationId, packet: decoded });
        return emit(operationId, packet);
      };
    },
  });
  const scan = () => {
    const play = document.querySelector('[data-testid="practice-play"]');
    const value = play ? {
      screen: play.getAttribute('data-screen'),
      phase: play.getAttribute('data-phase'),
      input: play.getAttribute('data-unity-input'),
      intro: Boolean(document.querySelector('[data-testid="practice-intro"]')),
    } : null;
    const last = trace.length ? trace[trace.length - 1] : null;
    if (value && (!last || last.kind !== 'ui' || JSON.stringify(last.value) !== JSON.stringify(value))) record('ui', value);
  };
  new MutationObserver(scan).observe(document, { subtree: true, childList: true, attributes: true });
});

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.getByTestId('practice-menu').waitFor({ state: 'visible', timeout: 120_000 });
await page.getByTestId('practice-random').click();
await page.getByTestId('practice-setup').waitFor({ state: 'visible', timeout: 120_000 });

const cdp = await context.newCDPSession(page);
await cdp.send('Debugger.enable');
await cdp.send('Debugger.setPauseOnExceptions', { state: 'all' });
cdp.on('Debugger.paused', async (event) => {
  pauses.push({
    reason: event.reason,
    data: event.data,
    frames: event.callFrames.slice(0, 8).map((frame) => ({
      functionName: frame.functionName,
      url: frame.url,
      line: frame.location.lineNumber + 1,
      column: frame.location.columnNumber + 1,
    })),
  });
  try { await cdp.send('Debugger.resume'); } catch { /* navigation or shutdown */ }
});

await page.getByTestId('practice-play-start').click();
await page.getByTestId('practice-intro').waitFor({ state: 'visible', timeout: 120_000 });
let demoAcknowledged = false;
let skipReachedLive = false;
let skipFailure = null;
try {
  await page.waitForFunction(() => (window.__vandeDemoTrace ?? []).some((entry) =>
    entry.kind === 'unity-inbound' &&
    typeof entry.value?.packet?.body === 'string' &&
    entry.value.packet.body.includes('host.demonstration')),
  undefined, { timeout: 30_000 });
  demoAcknowledged = true;
} catch {
  // Preserve and print the failed run's packet/exception evidence below.
}
if (demoAcknowledged) {
  await page.waitForTimeout(1_000);
  await page.getByTestId('practice-intro-skip').click();
  try {
    await page.waitForFunction(() => {
      const play = document.querySelector('[data-testid="practice-play"]');
      return play && ['runup', 'live', 'playing', 'dead'].includes(play.getAttribute('data-phase'));
    }, undefined, { timeout: 30_000 });
    skipReachedLive = true;
    await page.waitForTimeout(4_000);
  } catch (error) {
    skipFailure = error instanceof Error ? error.message : String(error);
  }
}
await cdp.send('Debugger.setPauseOnExceptions', { state: 'none' });

const trace = await page.evaluate(() => window.__vandeDemoTrace ?? []);
const summaryTrace = trace.map((entry) => {
  if (entry.kind !== 'unity-inbound') return entry;
  let body = entry.value?.packet?.body;
  try { body = JSON.parse(body); } catch { /* retain raw body */ }
  return {
    at: entry.at,
    kind: entry.kind,
    value: typeof body === 'object' && body ? {
      type: body.type,
      deliveryId: body.deliveryId,
      acknowledgedMessageId: body.payload?.acknowledgedMessageId ?? null,
      code: body.payload?.code ?? null,
      fatal: body.payload?.fatal ?? null,
    } : body,
  };
});
const play = await page.getByTestId('practice-play').evaluate((element) => ({
  screen: element.getAttribute('data-screen'),
  phase: element.getAttribute('data-phase'),
  input: element.getAttribute('data-unity-input'),
  text: element.textContent,
}));
const relevantPauses = pauses.filter((pause) => pause.data?.description?.includes('Unity Practice'));
const relevantConsole = consoleMessages.filter((message) => message.type === 'error' || message.type === 'pageerror');
process.stdout.write(`${JSON.stringify({ demoAcknowledged, skipReachedLive, skipFailure, trace: summaryTrace, pauses: relevantPauses, play, consoleMessages: relevantConsole }, null, 2)}\n`);
await browser.close();
