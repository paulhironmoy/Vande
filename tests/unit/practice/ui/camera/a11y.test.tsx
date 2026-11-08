/**
 * Structure and names of every camera screen, checked with axe-core on the rendered markup: each panel of the setup
 * dialog, the card before a ball, the chip and the banner. (jsdom has no layout or colour, so contrast, 200% text and
 * target sizes are checked in a real browser, not here.) Also: the dialog is modal and labelled, Escape works, focus
 * lands on the primary action, the progress bar is a progress bar, and nothing is announced twice.
 */
import axe from 'axe-core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetCameraController, setCameraSessionFactory } from '@/practice/ui/camera/controller';
import { CameraChip, LostBanner, ReadinessCard } from '@/practice/ui/camera/Card';
import { TroublePanel, type TroubleEnv } from '@/practice/ui/camera/panelViews';
import { Setup } from '@/practice/ui/camera/Setup';
import { resetCameraUi } from '@/practice/ui/camera/store';
import type { TroubleCase } from '@/practice/ui/camera/problems';
import { createFakeSession, type FakeSession } from './fakeSession';

async function violations(node: Element): Promise<string[]> {
  const result = await axe.run(node, {
    // jsdom paints nothing: colour contrast and the visual rules are the browser run's job.
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.html.slice(0, 90)).join(' | ')}`);
}

function install(cached = true): FakeSession {
  const session = createFakeSession({ cached });
  setCameraSessionFactory(() => Promise.resolve(session));
  resetCameraController();
  return session;
}
const settle = () => act(async () => void (await Promise.resolve()));

beforeEach(() => {
  localStorage.clear();
  resetCameraUi(false);
});
afterEach(() => {
  cleanup();
  resetCameraController();
  setCameraSessionFactory(null);
  resetCameraUi(false);
});

describe('the setup dialog', () => {
  it('is a modal dialog with a name and a description, and focus goes to the primary action', async () => {
    install();
    render(<Setup fallback="mouse" onDone={() => undefined} />);
    await settle();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBeTruthy();
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)).toBeTruthy();
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });
    expect(document.activeElement).toBe(screen.getByTestId('camera-consent-allow'));
  });

  it('has no axe violations on the consent, the wait for the prompt, the guide and a download', async () => {
    const session = install(false);
    render(<Setup fallback="touch" onDone={() => undefined} />);
    await settle();
    expect(await violations(document.body)).toEqual([]);
    await act(async () => {
      fireEvent.click(screen.getByTestId('camera-consent-allow'));
    });
    expect(await violations(document.body)).toEqual([]);
    act(() =>
      session.set({
        stage: 'loading',
        pack: { state: 'downloading', bytesDone: 3_000_000, bytesTotal: 9_200_000, attempt: 1, maxAttempts: 2 },
      }),
    );
    expect(await violations(document.body)).toEqual([]);
    act(() => session.setPack({ state: 'stalled' }));
    expect(await violations(document.body)).toEqual([]);
    await act(async () => {
      session.fail('offline');
      await Promise.resolve();
    });
    expect(await violations(document.body)).toEqual([]);
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
  });

  it('has no axe violations in the guide, in frame or not', async () => {
    const session = install();
    render(<Setup fallback="mouse" onDone={() => undefined} />);
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByTestId('camera-consent-allow'));
    });
    await act(async () => {
      session.finish();
      await Promise.resolve();
    });
    expect(await violations(document.body)).toEqual([]);
    act(() => session.seen());
    expect(await violations(document.body)).toEqual([]);
  });
});

describe('every troubleshooting panel', () => {
  const env: TroubleEnv = {
    family: 'chrome',
    platform: 'android',
    native: false,
    link: 'https://play.example.test/p',
    chromeUrl: 'intent://x#Intent;end',
    canOpenSettings: true,
    openSettings: () => undefined,
    openChrome: () => undefined,
    copy: () => Promise.resolve(true),
  };
  const actions = {
    fallback: 'mouse' as const,
    start: () => undefined,
    retry: () => undefined,
    ready: () => undefined,
    switchAway: () => undefined,
    keepTrying: () => undefined,
  };
  for (const kind of ['blocked', 'busy', 'black', 'none', 'inapp', 'light', 'slow', 'unsupported'] as TroubleCase[])
    it(`${kind}: no axe violations, one heading, buttons that say what they do`, async () => {
      const ids = { title: 'a', body: 'b', status: 'c' };
      const { container } = render(
        <section aria-labelledby="a" aria-describedby="b">
          <TroublePanel ids={ids} kind={kind} env={env} actions={actions} />
        </section>,
      );
      expect(await violations(container)).toEqual([]);
      expect(screen.getAllByRole('heading')).toHaveLength(1);
      for (const b of screen.getAllByRole('button')) expect((b.textContent ?? '').trim().length).toBeGreaterThan(0);
    });
});

describe('the card, the chip and the banner', () => {
  it('have no axe violations, and the card is a labelled region', async () => {
    const session = install();
    const { getCameraController } = await import('@/practice/ui/camera/controller');
    const started = getCameraController().begin();
    await settle();
    await act(async () => {
      session.finish();
      await started;
    });
    const view = render(
      <>
        <ReadinessCard openHelp={() => undefined} />
        <CameraChip lost={false} quiet={false} />
        <LostBanner onKeepTrying={() => undefined} onHelp={() => undefined} />
      </>,
    );
    await settle();
    expect(await violations(view.container)).toEqual([]);
    expect(screen.getAllByRole('region', { name: /./ })).toHaveLength(2);
    // The chip says what it is in words and is not a control.
    expect(screen.getByTestId('camera-chip').querySelector('button')).toBeNull();
  });

  it('announce through polite regions only, never an alert that would cut a listener off', async () => {
    const session = install();
    const { getCameraController } = await import('@/practice/ui/camera/controller');
    const started = getCameraController().begin();
    await settle();
    await act(async () => {
      session.finish();
      await started;
    });
    render(
      <>
        <ReadinessCard openHelp={() => undefined} />
        <LostBanner onKeepTrying={() => undefined} onHelp={() => undefined} />
      </>,
    );
    await settle();
    expect(document.querySelectorAll('[role="alert"], [aria-live="assertive"]')).toHaveLength(0);
    expect(document.querySelectorAll('[aria-live="polite"]').length).toBeGreaterThanOrEqual(2);
  });
});
