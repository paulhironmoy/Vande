/**
 * Helpers for the Practice journeys (the `practice` Playwright project: a VITE_PRACTICE_TEST_HOOKS=1 build on 4176).
 * The hooks (src/practice/ui/testHooks.ts) let a test fix the device tier, speed time up, queue swings on the
 * simulation clock and wait for the controller's own phases; real pointer input still goes through the
 * GestureSurface in the input specs.
 *
 * A software-rendered stage (SwiftShader in headless Chromium) keeps the main thread busy, so short-lived states are
 * awaited through the controller (`waitFor`) or checked afterwards through the recorder (`seen`), never by polling
 * the DOM for a phase that may last a fraction of a second.
 */
import { expect, type Page } from '@playwright/test';

export interface PracticeTestConfig {
  tier?: 'full' | 'assisted' | 'below';
  timeScale?: number;
  seed?: string;
  benchmarkMs?: number;
}

export type Swing =
  | 'leave'
  | { kind?: 'attack' | 'defend'; contactErrorMs: number; directionDeg?: number; power?: number; elevation?: number }
  | { kind?: 'attack' | 'defend'; startT: number; directionDeg?: number; power?: number; elevation?: number };

/** WebGL through SwiftShader in headless Chromium (as the other renderer specs do). */
export const GPU_ARGS = { launchOptions: { args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] } };

/** Configures the hooks (and, optionally, Practice settings such as the finished first-time flow) before any page script. */
export async function configure(page: Page, config: PracticeTestConfig, opts: { guidedDone?: boolean; settings?: Record<string, unknown> } = {}) {
  await page.addInitScript(
    ([cfg, settings]) => {
      (window as unknown as { __VANDE_PRACTICE_TEST__: unknown }).__VANDE_PRACTICE_TEST__ = cfg;
      if (settings) {
        try {
          if (!localStorage.getItem('vc:practice:settings')) localStorage.setItem('vc:practice:settings', JSON.stringify(settings));
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
    [config, opts.guidedDone ? { v: 1, guidedDone: true, ...(opts.settings ?? {}) } : (opts.settings ?? null)] as const,
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
  last: { kind: string; runs: number; dismissal: string | null; contact: string; swing: string | null } | null;
  notice: string | null;
  ttfdMs: number | null;
  over: { source: string; family: string; shuffled: boolean; variations: string[]; lengths: number[] } | null;
}

export async function state(page: Page): Promise<HookState> {
  await hooks(page);
  return page.evaluate(() => (window as unknown as { __vandePractice: { state(): HookState } }).__vandePractice.state());
}

export async function delivered(page: Page): Promise<Record<'innings' | 'warmup' | 'repeat', number>> {
  return page.evaluate(() => (window as unknown as { __vandePractice: { delivered(): Record<'innings' | 'warmup' | 'repeat', number> } }).__vandePractice.delivered());
}

export const play = (page: Page) => page.getByTestId('practice-play');

/** Practice opened with no press yet asks for one "Start batting" tap before the first ball (the audio unlock). */
export async function startBatting(page: Page) {
  await waitFor(page, ['tap_gate']).catch(() => undefined);
  await page.getByTestId('practice-tap-go').click();
}

/** From the Practice menu: Quick random over; the field radar shows, then the first ball is bowled. */
export async function startRandom(page: Page) {
  await page.getByTestId('practice-random').click();
  await waitFor(page, ['runup', 'live', 'playing', 'coaching']);
  expect(await seen(page, 'practice-radar')).not.toBeNull();
}

/** Bats out an over in progress (the swings must already be queued) to its summary. */
export async function toOverSummary(page: Page, timeoutMs = 180_000) {
  await waitFor(page, ['over_summary'], timeoutMs);
  await expect(page.getByTestId('practice-over-summary')).toBeVisible();
}

/** Taps the Build an Over pitch map at a target (the game's PITCH_MAP: line −0.6…0.8 m, length 0…11 m). */
export async function buildBall(page: Page, lineM: number, lengthM: number, variation: string) {
  const map = page.getByTestId('practice-pitch-map');
  const box = await map.boundingBox();
  if (!box) throw new Error('no pitch map');
  const u = (lineM + 0.6) / 1.4;
  const v = lengthM / 11;
  await map.click({ position: { x: u * box.width, y: (1 - v) * box.height } });
  await page.getByTestId(`practice-build-variation-${variation}`).click();
  await page.getByTestId('practice-build-save').click();
}

/** A swing timed perfectly (zero contact error, the physics' own bat travel) in the given direction. */
export const perfect = (directionDeg = 0, power = 0.6): Swing => ({ kind: 'attack', contactErrorMs: 0, directionDeg, power });
export const block = (): Swing => ({ kind: 'defend', contactErrorMs: 0 });
