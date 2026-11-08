/**
 * Troubleshooting: every cause has its own plain steps, and every panel ends in "Bat with mouse" or "Bat with touch" in
 * one tap. The steps for a blocked camera are the ones for the player's own browser; an in-app browser gets a link that
 * opens Chrome where that can work and a copy-link button everywhere, and says so.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPracticeT } from '@/i18n/practice';
import type { BrowserFamily } from '@/practice/ui/camera/environment';
import { TroublePanel, type PanelActions, type TroubleEnv } from '@/practice/ui/camera/panelViews';
import { canRetry, type TroubleCase } from '@/practice/ui/camera/problems';

const en = createPracticeT('en', null);
const ids = { title: 'tt', body: 'tb', status: 'ts' };

function envOf(o: Partial<TroubleEnv> = {}): TroubleEnv & {
  openSettings: ReturnType<typeof vi.fn>;
  openChrome: ReturnType<typeof vi.fn>;
  copy: ReturnType<typeof vi.fn>;
} {
  return {
    family: 'chrome',
    platform: 'desktop',
    native: false,
    link: 'https://play.example.test/practice',
    chromeUrl: 'intent://play.example.test/practice#Intent;scheme=https;package=com.android.chrome;end',
    canOpenSettings: false,
    openSettings: vi.fn(),
    openChrome: vi.fn(),
    copy: vi.fn(() => Promise.resolve(true)),
    ...o,
  } as never;
}

function actionsOf(fallback: 'mouse' | 'touch' = 'mouse') {
  return {
    fallback,
    start: vi.fn(),
    retry: vi.fn(),
    ready: vi.fn(),
    switchAway: vi.fn(),
    help: vi.fn(),
    keepTrying: vi.fn(),
  } satisfies PanelActions;
}

const show = (kind: TroubleCase, env = envOf(), actions = actionsOf()) =>
  render(<TroublePanel ids={ids} kind={kind} env={env} actions={actions} />);

afterEach(cleanup);

const CASES: TroubleCase[] = ['blocked', 'busy', 'black', 'none', 'inapp', 'light', 'slow', 'unsupported'];

describe('every cause', () => {
  for (const kind of CASES) {
    it(`${kind}: its own title and plain words, and the way back in one tap`, () => {
      const actions = actionsOf('touch');
      show(kind, envOf(), actions);
      expect(screen.getByTestId('camera-trouble-title').textContent).toBe(
        en.tk(`practice.camera.trouble.${kind}.title`),
      );
      expect(screen.getByText(en.tk(`practice.camera.trouble.${kind}.body`))).toBeTruthy();
      expect(screen.getByTestId('camera-trouble').dataset.case).toBe(kind);
      const back = screen.getByTestId('camera-trouble-fallback');
      expect(back.textContent).toBe('Bat with touch');
      fireEvent.click(back);
      expect(actions.switchAway).toHaveBeenCalledTimes(1);
    });
  }

  it('offers "Try again" where trying again can help, and not where the page or the device is the problem', () => {
    for (const kind of CASES) {
      cleanup();
      const actions = actionsOf();
      show(kind, envOf(), actions);
      const retry = screen.queryByTestId('camera-trouble-retry');
      const expected = canRetry({ kind: 'trouble', case: kind });
      // The in-app panel offers the link instead; the light panel's button says "Keep trying".
      expect(Boolean(retry), kind).toBe(expected && kind !== 'inapp');
      if (retry) {
        expect(retry.textContent).toBe(
          kind === 'light' ? en.t('practice.camera.lost.retry') : en.t('practice.error.retry'),
        );
        fireEvent.click(retry);
        expect(kind === 'light' ? actions.keepTrying : actions.retry).toHaveBeenCalledTimes(1);
      }
    }
  });

  it('makes the way back the main action when there is nothing else to press', () => {
    show('slow');
    expect(screen.getByTestId('camera-trouble-fallback').className).toContain('primary');
    cleanup();
    show('busy');
    expect(screen.getByTestId('camera-trouble-fallback').className).not.toContain('primary');
  });
});

describe('a blocked camera: the steps for this browser', () => {
  const FAMILIES: BrowserFamily[] = ['chrome', 'edge', 'firefox', 'safari', 'android', 'android_browser', 'other'];
  for (const family of FAMILIES) {
    it(`${family}`, () => {
      show('blocked', envOf({ family }));
      const steps = screen.getByTestId('camera-trouble-steps').querySelectorAll('li');
      expect(steps).toHaveLength(1);
      expect(steps[0].textContent).toBe(en.t(`practice.camera.trouble.blocked.${family}`));
    });
  }

  it("opens the app's settings page only where the camera core can", () => {
    show('blocked', envOf({ family: 'android', native: true, canOpenSettings: false }));
    expect(screen.queryByTestId('camera-trouble-settings')).toBeNull();
    cleanup();
    const env = envOf({ family: 'android', native: true, canOpenSettings: true });
    show('blocked', env);
    fireEvent.click(screen.getByTestId('camera-trouble-settings'));
    expect(env.openSettings).toHaveBeenCalledTimes(1);
  });
});

describe('a black picture', () => {
  it('names the privacy shutter and the on/off key or setting', () => {
    show('black');
    const steps = Array.from(screen.getByTestId('camera-trouble-steps').querySelectorAll('li')).map(
      (li) => li.textContent,
    );
    expect(steps).toEqual([
      en.t('practice.camera.trouble.black.shutter'),
      en.t('practice.camera.trouble.black.toggle'),
    ]);
  });
});

describe("inside another app's browser", () => {
  it('on Android: "Open in Chrome" is the main action, "Copy link" is beside it, and the way back is quiet', () => {
    const env = envOf({ platform: 'android' });
    show('inapp', env);
    const open = screen.getByTestId('camera-trouble-open-chrome');
    expect(open.textContent).toBe(en.t('practice.camera.trouble.inapp.open'));
    fireEvent.click(open);
    expect(env.openChrome).toHaveBeenCalledWith(env.chromeUrl);
    expect(screen.getByTestId('camera-trouble-copy').textContent).toBe(en.t('practice.camera.trouble.inapp.copy'));
    expect(screen.getByTestId('camera-trouble-fallback').className).toContain('quiet');
  });

  it('on an iPhone: only "Copy link" (no link can open Safari from here), and the way back', () => {
    show('inapp', envOf({ platform: 'ios', chromeUrl: null }));
    expect(screen.queryByTestId('camera-trouble-open-chrome')).toBeNull();
    expect(screen.getByTestId('camera-trouble-copy')).toBeTruthy();
    expect(screen.getByTestId('camera-trouble-fallback')).toBeTruthy();
  });

  it('copies the link and says so, politely', async () => {
    const env = envOf({ platform: 'ios', chromeUrl: null });
    show('inapp', env);
    fireEvent.click(screen.getByTestId('camera-trouble-copy'));
    await waitFor(() => expect(screen.getByText(en.t('practice.camera.trouble.inapp.copied'))).toBeTruthy());
    expect(env.copy).toHaveBeenCalledWith('https://play.example.test/practice');
    expect(screen.getByTestId('camera-trouble-copied').getAttribute('aria-live')).toBe('polite');
  });

  it('shows the link to copy by hand when the browser will not copy for it', async () => {
    const env = envOf({ platform: 'ios', chromeUrl: null, copy: vi.fn(() => Promise.resolve(false)) as never });
    show('inapp', env);
    fireEvent.click(screen.getByTestId('camera-trouble-copy'));
    const field = await screen.findByTestId('camera-trouble-link');
    expect((field as HTMLInputElement).value).toBe('https://play.example.test/practice');
    expect(field.hasAttribute('readonly')).toBe(true);
  });
});
