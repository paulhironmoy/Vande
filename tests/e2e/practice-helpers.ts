/**
 * Helpers for the Practice journeys (the `practice` Playwright project: a VITE_PRACTICE_TEST_HOOKS=1 build). The hooks
 * (src/practice/ui/testHooks.ts) let a test fix the device tier, speed time up, queue swings on the simulation clock,
 * let a dead ball continue by itself for long journeys (`autoNext`), and wait for the controller's own phases; real
 * pointer input still goes through the GestureSurface in the input specs.
 *
 * Practice is the app's first screen (Stage 1): a start at the root opens the Practice home. A software-rendered stage
 * (SwiftShader in headless Chromium) keeps the main thread busy, so short-lived states are awaited through the
 * controller (`waitFor`) or checked afterwards through the recorder (`seen`), never by polling the DOM for a phase that
 * may last a fraction of a second.
 */
import { expect, type Page } from '@playwright/test';

export interface PracticeTestConfig {
  tier?: 'full' | 'assisted' | 'below';
  timeScale?: number;
  seed?: string;
  benchmarkMs?: number;
  /** A dead innings ball continues by itself (production always waits for the player). */
  autoNext?: boolean;
}

export type Swing =
  | 'leave'
  | { kind?: 'attack' | 'defend'; contactErrorMs: number; directionDeg?: number; power?: number; elevation?: number }
  | { kind?: 'attack' | 'defend'; startT: number; directionDeg?: number; power?: number; elevation?: number };

/** WebGL through SwiftShader in headless Chromium (as the other renderer specs do). */
export const GPU_ARGS = { launchOptions: { args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] } };

/**
 * Configures the hooks and Practice settings before any page script. By default the first-run teaching is off (as if
 * the player skipped it), so a journey starts bowling at once; `teach: true` keeps it.
 */
export async function configure(page: Page, config: PracticeTestConfig, opts: { teach?: boolean; settings?: Record<string, unknown>; /** @deprecated the first-run guided over is gone; teaching is off unless `teach`. */ guidedDone?: boolean } = {}) {
  const settings = opts.teach ? (opts.settings ?? null) : { v: 1, teach: false, demoSeen: true, ...(opts.settings ?? {}) };
  await page.addInitScript(
    ([cfg, s]) => {
      (window as unknown as { __VANDE_PRACTICE_TEST__: unknown }).__VANDE_PRACTICE_TEST__ = cfg;
      if (s) {
        try {
          if (!localStorage.getItem('vc:practice:settings')) localStorage.setItem('vc:practice:settings', JSON.stringify(s));
        } catch {
          /* storage blocked */
        }
      }
      // Every element with a data-testid that ever appears, with its text (see `seen`).
      const seen: Record<string, string> = {};
      (window as unknown as { __seen: Record<string, string> }).__seen = seen;
      const scan = () => {
        for (const el of Array.from(document.querySelectorAll('[data-testid]'))) {
          const id = el.getAttribute('data-testid')!;
          const text = (el.textContent ?? '').trim();
          if (!(id in seen) || (text && !seen[id])) seen[id] = text;
        }
      };
      new MutationObserver(scan).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    },
    [config, settings] as const,
  );
}

/** The text of an element that appeared at any time since the page loaded (null if it never did). */
export async function seen(page: Page, testId: string): Promise<string | null> {
  return page.evaluate((id) => (window as unknown as { __seen?: Record<string, string> }).__seen?.[id] ?? null, testId);
}

async function hooks(page: Page) {
  await page.waitForFunction(() => Boolean((window as unknown as { __vandePractice?: unknown }).__vandePractice), undefined, { timeout: 60_000 });
}

export async function queue(page: Page, ...swings: Swing[]) {
  await hooks(page);
  await page.evaluate((s) => (window as unknown as { __vandePractice: { queueSwing: (...x: unknown[]) => number } }).__vandePractice.queueSwing(...s), swings);
}

/** Waits for the controller to reach one of these phases or screens (its own state, not the DOM). */
export async function waitFor(page: Page, states: string[], timeoutMs = 90_000) {
  await hooks(page);
  const ok = await page.evaluate(
    ([s, ms]) => (window as unknown as { __vandePractice: { waitFor(x: string[], t: number): Promise<boolean> } }).__vandePractice.waitFor(s, ms),
    [states, timeoutMs] as const,
  );
  expect(ok, `Practice never reached ${states.join(' or ')}`).toBe(true);
}

/**
 * Inside the page, at the very moment the ball is in flight: send the app to the background and back, or reload it.
 * Done in the page itself (not as a separate command) so a loaded test machine cannot miss the in-flight window.
 */
export async function whileInFlight(page: Page, action: 'background' | 'reload') {
  await hooks(page);
  const run = page.evaluate(async (what) => {
    const api = (window as unknown as { __vandePractice: { waitFor(x: string[], t: number): Promise<boolean> } }).__vandePractice;
    if (!(await api.waitFor(['live'], 90_000))) throw new Error('never in flight');
    if (what === 'reload') {
      location.reload();
      return;
    }
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, action);
  if (action === 'reload') {
    // The page navigates away under the evaluation: that is the point.
    await run.catch(() => undefined);
    await page.waitForLoadState('load');
  } else await run;
}

export interface HookState {
  screen: string;
  phase: string;
  status: string | null;
  runs: number;
  balls: number;
  overs: number;
  inFlight: { overIndex: number; ballIndex: number } | null;
  stage: '3d' | '2d';
  tier: string;
  profile: string;
  stageReady: boolean;
  last: { kind: string; runs: number; dismissal: string | null; contact: string; swing: string | null } | null;
  insight: string | null;
  coach: { stage: number; attempts: number; mastered: boolean; verdict: string | null } | null;
  notice: string | null;
  ttfdMs: number | null;
  overKind: string | null;
  over: { source: string; family: string; shuffled: boolean; variations: string[]; lengths: number[] } | null;
  /** The timing help (ms) each innings ball was played with, by over. */
  tolerances: number[][];
  /** Balls released while the stage was not ready (must stay 0). */
  unreadyBowls: number;
  error: string | null;
}

export async function state(page: Page): Promise<HookState> {
  await hooks(page);
  return page.evaluate(() => (window as unknown as { __vandePractice: { state(): HookState } }).__vandePractice.state());
}

export async function delivered(page: Page): Promise<Record<'innings' | 'repeat', number>> {
  return page.evaluate(() => (window as unknown as { __vandePractice: { delivered(): Record<'innings' | 'repeat', number> } }).__vandePractice.delivered());
}

/** The batter's-eye regions the interface must never cover (from the stage, CSS px relative to the canvas). */
export async function protectedRegions(page: Page): Promise<Array<{ kind: string; x: number; y: number; width: number; height: number }>> {
  return page.evaluate(() => (window as unknown as { __vandePractice: { protectedRegions(): Array<{ kind: string; x: number; y: number; width: number; height: number }> } }).__vandePractice.protectedRegions());
}

export const play = (page: Page) => page.getByTestId('practice-play');

/** Opens Practice (the app's first screen) and waits for the home. */
export async function openPractice(page: Page, cfg: PracticeTestConfig, opts: { teach?: boolean; settings?: Record<string, unknown> } = {}) {
  await configure(page, cfg, opts);
  await page.goto('/');
  await expect(page.getByTestId('practice-menu')).toBeVisible({ timeout: 45_000 });
}

/** From the setup screen: Play, and the first ball is under way. */
export async function playFromSetup(page: Page) {
  await expect(page.getByTestId('practice-setup')).toBeVisible({ timeout: 45_000 });
  // Subscribe before clicking: accelerated, auto-next journeys can finish a ball before a second CDP command arrives.
  await page.evaluate(() => {
    const w = window as unknown as { __vandePractice: { waitFor(states: string[], ms: number): Promise<boolean> }; __practiceStartWait?: Promise<boolean> };
    w.__practiceStartWait = w.__vandePractice.waitFor(['runup', 'live', 'playing', 'dead', 'out', 'over_summary'], 90_000);
  });
  await page.getByTestId('practice-play-start').click();
  const begun = await page.evaluate(() => (window as unknown as { __practiceStartWait: Promise<boolean> }).__practiceStartWait);
  expect(begun, 'the requested over started').toBe(true);
}

/** From the Practice home: a Random Over (the balanced defaults), its setup, then Play. */
export async function startRandom(page: Page) {
  await page.getByTestId('practice-random').click();
  await playFromSetup(page);
}

/** Bats out an over in progress (the swings queued, autoNext on) to its summary. */
export async function toOverSummary(page: Page, timeoutMs = 180_000) {
  await waitFor(page, ['over_summary', 'out', 'error'], timeoutMs);
  expect((await state(page)).screen, 'the innings must survive all six deliveries, not end with a wicket').toBe('over_summary');
  await expect(page.getByTestId('practice-over-summary')).toBeVisible();
}

/**
 * Your own six: optionally a delivery for the coming ball, then a tap on the pitch map at the target (the game's
 * PITCH_MAP: line −0.6…0.8 m, length 0…11 m), which saves the ball and moves on to the next.
 */
export async function buildBall(page: Page, lineM: number, lengthM: number, variation?: string) {
  if (variation) {
    const toggle = page.getByTestId('practice-build-delivery-toggle');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await page.getByTestId(`practice-build-variation-${variation}`).click();
  }
  const map = page.getByTestId('practice-pitch-map');
  const box = await map.boundingBox();
  if (!box) throw new Error('no pitch map');
  const u = (lineM + 0.6) / 1.4;
  const v = lengthM / 11;
  await map.click({ position: { x: u * box.width, y: (1 - v) * box.height } });
}

/** A swing timed perfectly (zero contact error, the physics' own bat travel) in the given direction. */
export const perfect = (directionDeg = 0, power = 0.6): Swing => ({ kind: 'attack', contactErrorMs: 0, directionDeg, power });
export const block = (): Swing => ({ kind: 'defend', contactErrorMs: 0 });
