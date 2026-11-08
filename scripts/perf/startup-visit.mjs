/**
 * Real production UI startup. Retains state/error evidence on failure and uses visible, status-matched recovery.
 * Derived from the independently reviewed Stage 0 supplemental method; no seed, cache or innings mutations.
 */
import { execFileSync } from 'node:child_process';
import { loadavg } from 'node:os';
import { round } from './practice-lib.mjs';
import { persistedSnapshot, proveNextRelease, proveRecoveredLeave, proveStableInFlight, routeFor } from './startup-state.mjs';

const INNINGS_KEY = 'vc:practice:innings';
const utc = () => new Date().toISOString();
const load = () => ({ uptime: execFileSync('uptime', { encoding: 'utf8' }).trim(), loadAverage: loadavg() });
const serialisableError = (error) => ({ name: error?.name ?? 'Error', message: String(error?.message ?? error), stack: String(error?.stack ?? '').slice(0, 4000) });

export async function measureStartupVisit({ context, url, cpu = 1, network = null, previous = null }) {
  const roots = ['practice-menu', 'practice-out-summary', 'practice-innings-summary', 'practice-over-summary', 'practice-paused', 'practice-setup'];
  const forward = ['practice-play-start', 'practice-intro-skip-all', 'practice-tap-go', 'practice-radar-go', 'practice-classic', 'practice-turn-continue', 'practice-resume'];

  async function readPersisted(page) {
    return page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    }, INNINGS_KEY);
  }

  async function waitRoot(page, timeout = 120_000) {
    const handle = await page.waitForFunction(
      (ids) => ids.find((id) => {
        const element = document.querySelector(`[data-testid="${id}"]`);
        return element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
      }) ?? null,
      roots,
      { timeout },
    );
    return handle.jsonValue();
  }

  async function waitExactRoot(page, id, timeout = 120_000) {
    await page.waitForFunction(
      (testId) => {
        const element = document.querySelector(`[data-testid="${testId}"]`);
        return Boolean(element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
      },
      id,
      { timeout },
    );
    return id;
  }

  async function click(page, id, visit, { required = true, allowDisappear = false } = {}) {
    const locator = page.getByTestId(id).first();
    const attempt = { id, observedAt: round(await page.evaluate(() => performance.now())), required, allowDisappear, status: 'observed' };
    visit.actionAttempts.push(attempt);
    if (!(await locator.isVisible().catch(() => false)) || !(await locator.isEnabled().catch(() => false))) {
      attempt.status = 'unavailable-before-dispatch';
      if (!required) return false;
      throw new Error(`Required visible action is unavailable: ${id}`);
    }
    const at = await page.evaluate(() => performance.now());
    try { await locator.click({ timeout: 30_000, noWaitAfter: true }); }
    catch (error) {
      // A transient teaching control may legitimately finish between passive observation and the click. Do not retry it.
      attempt.error = serialisableError(error);
      if (allowDisappear && !(await locator.isVisible().catch(() => false))) {
        attempt.status = 'transient-finished-before-dispatch-completed';
        return false;
      }
      attempt.status = 'dispatch-failed';
      throw error;
    }
    visit.actions.push({ id, at: round(at), completed: round(await page.evaluate(() => performance.now())) });
    attempt.status = 'dispatched';
    return true;
  }

  async function observeRelease(page, visit, timeout = 240_000) {
    const clicked = new Set(visit.actions.map((action) => action.id));
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const observation = await page.evaluate((ids) => {
        const phases = window.__perf?.phases ?? [];
        const release = phases.find((phase) => phase[2] === 'live') ?? null;
        if (release) return { release, id: null };
        for (const id of ids) {
          const element = document.querySelector(`[data-testid="${id}"]`);
          if (element && !element.disabled && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden') return { release: null, id };
        }
        return { release: null, id: null };
      }, forward.filter((id) => !clicked.has(id)));
      if (observation.release) {
        visit.release = observation.release;
        visit.releaseObservedAt = round(await page.evaluate(() => performance.now()));
        return;
      }
      if (observation.id) {
        if (await click(page, observation.id, visit, { required: false, allowDisappear: observation.id === 'practice-intro-skip-all' })) clicked.add(observation.id);
      } else await page.waitForTimeout(20);
    }
    throw new Error(`No release within ${timeout} ms; actions: ${visit.actions.map((action) => action.id).join(', ')}`);
  }

  async function collectPage(page, visit) {
    const pageData = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      return {
        phases: window.__perf?.phases ?? [],
        releases: (window.__perf?.phases ?? []).filter((phase) => phase[2] === 'live'),
        firstInput: window.__startupFirstInput ?? null,
        navigation: nav ? { domInteractive: nav.domInteractive, load: nav.loadEventEnd, transferKb: Math.round((nav.transferSize ?? 0) / 1024) } : null,
        resourcesKb: Math.round(performance.getEntriesByType('resource').reduce((sum, entry) => sum + (entry.transferSize ?? 0), 0) / 1024),
        settings: JSON.parse(localStorage.getItem('vc:practice:settings') ?? 'null'),
        appSettings: JSON.parse(localStorage.getItem('vc:settings') ?? 'null'),
        visibility: document.visibilityState,
      };
    });
    Object.assign(visit, pageData);
    visit.fallbackActions = visit.actions.filter((action) => action.id === 'practice-classic');
  }

  async function openPage(label) {
    const visit = { label, started: utc(), loadBefore: load(), firstScreen: null, home: null, route: null, actionAttempts: [], actions: [], release: null, releaseObservedAt: null, persistedAtRelease: null, errors: [], lateErrors: [], closeErrors: [], finished: null, loadAfter: null, ok: false };
    const page = await context.newPage();
    const errors = visit.errors;
    page.on('pageerror', (error) => errors.push({ at: utc(), kind: 'pageerror', message: String(error).slice(0, 500) }));
    page.on('crash', () => errors.push({ at: utc(), kind: 'pagecrash', message: 'Playwright page crashed' }));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push({ at: utc(), kind: 'console', message: message.text().slice(0, 500) });
    });
    await page.addInitScript(() => {
      window.__startupFirstInput = null;
      try {
        new PerformanceObserver((list) => {
          const entry = list.getEntries()[0];
          if (entry) window.__startupFirstInput = { start: entry.startTime, processing: entry.processingStart };
        }).observe({ type: 'first-input', buffered: true });
      } catch { /* unsupported */ }
    });
    try {
      const cdp = await context.newCDPSession(page);
      if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
      if (network) {
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', { offline: false, ...network });
      }
      await page.goto(`${url}/`, { waitUntil: 'commit' });
      visit.root = await waitRoot(page);
      visit.firstScreen = round(await page.evaluate(() => performance.now()));
      return { page, visit };
    } catch (error) {
      visit.failure = serialisableError(error);
      try { await collectPage(page, visit); } catch (collectError) { visit.errors.push({ at: utc(), kind: 'collection', message: String(collectError).slice(0, 500) }); }
      try { await page.close(); } catch (closeError) { visit.closeErrors.push(serialisableError(closeError)); }
      visit.finished = utc(); visit.loadAfter = load();
      return { page: null, visit };
    }
  }

  async function coldVisit() {
    const opened = await openPage('cold');
    const { page, visit } = opened;
    if (!page) return visit;
    try {
      if (visit.root !== 'practice-menu') throw new Error(`Fresh context opened unexpected root: ${visit.root}`);
      if ((await readPersisted(page)) !== null) throw new Error('Fresh context unexpectedly contains a saved innings');
      visit.home = visit.firstScreen;
      visit.route = routeFor(null);
      await click(page, visit.route.firstAction, visit);
      await observeRelease(page, visit);
      visit.persistedFullAtRelease = await readPersisted(page);
      visit.persistedAtRelease = persistedSnapshot(visit.persistedFullAtRelease);
      if (!visit.persistedAtRelease?.inFlight) throw new Error('Cold first release was not persisted in flight');
      if (visit.persistedAtRelease.inFlight.overIndex !== 0 || visit.persistedAtRelease.inFlight.ballIndex !== 0) throw new Error('Cold first release was not delivery 0.0');
      if (visit.persistedAtRelease.balls !== 0) throw new Error('Cold first release has a nonzero resolved ball count');
      if (visit.persistedAtRelease.records.length !== 0) throw new Error('Cold first release already has resolved records');
      visit.errorCountAtRelease = visit.errors.length;
      await collectPage(page, visit);
      if (!Number.isFinite(visit.firstInput?.processing)) throw new Error('Cold first input was not observed');
      if (visit.releases.length !== 1) throw new Error(`Cold visit observed ${visit.releases.length} live releases instead of exactly one`);
      visit.persistedFullBeforeClose = await readPersisted(page);
      visit.persistedBeforeClose = persistedSnapshot(visit.persistedFullBeforeClose);
      visit.inFlightUntilClose = proveStableInFlight(visit.persistedAtRelease, visit.persistedBeforeClose);
      visit.ok = visit.errors.length === 0;
    } catch (error) {
      visit.failure = serialisableError(error);
      try { await collectPage(page, visit); } catch (collectError) { visit.errors.push({ at: utc(), kind: 'collection', message: String(collectError).slice(0, 500) }); }
    } finally {
      try { await page.close(); } catch (error) { visit.closeErrors.push(serialisableError(error)); }
      if (typeof visit.errorCountAtRelease === 'number') visit.lateErrors = visit.errors.slice(visit.errorCountAtRelease);
      visit.finished = utc(); visit.loadAfter = load();
      if (visit.closeErrors.length || visit.errors.length) visit.ok = false;
    }
    return visit;
  }

  async function returningVisit(cold) {
    const opened = await openPage('returning');
    const { page, visit } = opened;
    if (!page) return visit;
    try {
      visit.persistedFullAfterInit = await readPersisted(page);
      const recovered = persistedSnapshot(visit.persistedFullAfterInit);
      visit.persistedAfterInit = recovered;
      visit.recoveryProof = proveRecoveredLeave(cold.persistedAtRelease, recovered);
      const route = routeFor(recovered);
      visit.route = route;
      if (visit.root !== route.root) throw new Error(`Persisted ${recovered.status} requires ${route.root}, observed ${visit.root}`);
      if (visit.root === 'practice-menu') visit.home = visit.firstScreen;
      await click(page, route.firstAction, visit);
      if (route.name.startsWith('terminal-')) {
        await waitExactRoot(page, 'practice-menu');
        visit.home = round(await page.evaluate(() => performance.now()));
        await click(page, 'practice-random', visit);
      }
      await observeRelease(page, visit);
      visit.persistedFullAtRelease = await readPersisted(page);
      visit.persistedAtRelease = persistedSnapshot(visit.persistedFullAtRelease);
      visit.nextReleaseProof = proveNextRelease(recovered, visit.persistedAtRelease, route);
      visit.errorCountAtRelease = visit.errors.length;
      await collectPage(page, visit);
      if (!Number.isFinite(visit.firstInput?.processing)) throw new Error('Returning first input was not observed');
      if (visit.releases.length !== 1) throw new Error(`Returning visit observed ${visit.releases.length} live releases instead of exactly one`);
      visit.persistedFullBeforeClose = await readPersisted(page);
      visit.persistedBeforeClose = persistedSnapshot(visit.persistedFullBeforeClose);
      visit.inFlightUntilClose = proveStableInFlight(visit.persistedAtRelease, visit.persistedBeforeClose);
      visit.ok = visit.errors.length === 0;
    } catch (error) {
      visit.failure = serialisableError(error);
      try { await collectPage(page, visit); } catch (collectError) { visit.errors.push({ at: utc(), kind: 'collection', message: String(collectError).slice(0, 500) }); }
    } finally {
      try { await page.close(); } catch (error) { visit.closeErrors.push(serialisableError(error)); }
      if (typeof visit.errorCountAtRelease === 'number') visit.lateErrors = visit.errors.slice(visit.errorCountAtRelease);
      visit.finished = utc(); visit.loadAfter = load();
      if (visit.closeErrors.length || visit.errors.length) visit.ok = false;
    }
    return visit;
  }

  const visit = previous ? await returningVisit(previous) : await coldVisit();
  // Keep numeric metrics separate from raw page-clock observations and complete state records.
  const play = visit.actions.find((action) => action.id === 'practice-play-start');
  visit.t = {
    firstScreen: visit.firstScreen,
    home: visit.home,
    interactive: visit.firstInput?.processing ?? null,
    practiceTap: visit.actions[0]?.at ?? null,
    setup: play?.at ?? null,
    playTap: play?.completed ?? null,
    runup: visit.phases?.find((phase) => phase[2] === 'runup')?.[0] ?? null,
    release: visit.release?.[0] ?? null,
  };
  visit.continued = visit.route?.sameInnings ?? false;
  visit.returning = Boolean(previous);
  visit.practiceToRelease = Number.isFinite(visit.t.release) && Number.isFinite(visit.t.practiceTap)
    ? round(visit.t.release - visit.t.practiceTap) : null;
  return visit;
}
