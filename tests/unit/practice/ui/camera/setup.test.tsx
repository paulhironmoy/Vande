/**
 * The camera's setup dialog on a fake session: consent first and nothing asked before the tap; then the permission
 * prompt, the download behind the guide, the guide with its picture and badge; any failure as one panel; and the one-tap
 * way back everywhere. It answers CONTROLS once: ready, fallback or cancelled.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTopLayer } from '@/app/back';
import { createPracticeT } from '@/i18n/practice';
import type { PointerControl } from '@/practice/ui/controls/model';
import type { CameraSetupResult } from '@/practice/ui/controls/cameraPort';
import { resetCameraController, setCameraSessionFactory } from '@/practice/ui/camera/controller';
import { Setup } from '@/practice/ui/camera/Setup';
import { getCameraUi, resetCameraUi } from '@/practice/ui/camera/store';
import { createFakeSession, type FakeSession } from './fakeSession';

const en = createPracticeT('en', null);

async function mount(o: { fallback?: PointerControl; cached?: boolean; seen?: boolean; session?: FakeSession } = {}) {
  const session = o.session ?? createFakeSession({ cached: o.cached ?? false });
  setCameraSessionFactory(() => Promise.resolve(session));
  resetCameraController();
  if (o.seen) localStorage.setItem('vc:practice:camera', JSON.stringify({ consentSeen: true, consentV: 1 }));
  const onDone = vi.fn<(r: CameraSetupResult) => void>();
  const view = render(<Setup fallback={o.fallback ?? 'mouse'} onDone={onDone} />);
  await act(async () => {
    await Promise.resolve();
  });
  return { session, onDone, view };
}

const dialog = () => screen.getByTestId('camera-setup');
const panel = () => dialog().dataset.panel;

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

describe('the consent comes first and asks for nothing', () => {
  it('says why the camera is wanted, that the video stays here and is never saved or sent, how to stop it, and the download', async () => {
    const { session } = await mount();
    expect(panel()).toBe('consent');
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    for (const key of [
      'practice.camera.consent.title',
      'practice.camera.consent.what',
      'practice.camera.consent.privacy',
      'practice.camera.consent.stop',
      'practice.camera.consent.others',
    ] as const) {
      expect(within(dialog()).getByText(en.t(key))).toBeTruthy();
    }
    expect(within(dialog()).getByTestId('camera-consent-download').textContent).toBe(
      en.t('practice.camera.consent.download', {
        mb: en.number(9.2, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      }),
    );
    // Nothing has been asked of the camera, and nothing downloaded.
    expect(session.calls.start).toBe(0);
    expect(getCameraUi().started).toBe(false);
  });

  it("has two clear choices: use the camera, or bat with the device's own control", async () => {
    await mount({ fallback: 'mouse' });
    expect(screen.getByTestId('camera-consent-allow').textContent).toBe(en.t('practice.camera.consent.allow'));
    expect(screen.getByTestId('camera-consent-fallback').textContent).toBe('Bat with mouse');
    cleanup();
    await mount({ fallback: 'touch' });
    expect(screen.getByTestId('camera-consent-fallback').textContent).toBe('Bat with touch');
  });

  it('shows no download size when the files are already stored, and the short form on a device that has seen it', async () => {
    await mount({ cached: true, seen: true });
    expect(panel()).toBe('consent');
    expect(screen.queryByTestId('camera-consent-download')).toBeNull();
    expect(screen.queryByText(en.t('practice.camera.consent.what'))).toBeNull();
    expect(screen.getByText(en.t('practice.camera.consent.privacy'))).toBeTruthy();
  });
});

describe('after "Use camera"', () => {
  it("remembers the consent, asks the session to start, and waits for the system's prompt", async () => {
    const { session } = await mount();
    await act(async () => {
      fireEvent.click(screen.getByTestId('camera-consent-allow'));
    });
    expect(localStorage.getItem('vc:practice:camera')).toContain('"consentSeen":true');
    expect(session.calls.start).toBe(1);
    expect(panel()).toBe('permission');
    expect(screen.getByRole('status').textContent).toBe(en.t('practice.camera.permission.asking'));
    expect(screen.getByTestId('camera-permission-fallback')).toBeTruthy();
  });

  it('shows the guide and the picture with the download behind it: progress, stalled, retrying', async () => {
    const { session } = await mount();
    await act(async () => {
      fireEvent.click(screen.getByTestId('camera-consent-allow'));
    });
    act(() => {
      session.set({
        stage: 'loading',
        pack: { state: 'downloading', bytesDone: 2_300_000, bytesTotal: 9_200_000, attempt: 1, maxAttempts: 2 },
      });
    });
    expect(panel()).toBe('view');
    // The guide's words, the picture, and the download together.
    expect(screen.getByTestId('camera-guide-title').textContent).toBe(en.t('practice.camera.guide.title'));
    expect(screen.getByText(en.t('practice.camera.guide.light'))).toBeTruthy();
    expect(screen.getByTestId('camera-preview')).toBeTruthy();
    expect(session.previews).toHaveLength(1);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('25');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-label')).toBe(en.t('practice.camera.download.label', { pct: 25 }));
    expect(screen.getByTestId('camera-download-mb').textContent).toBe(
      en.t('practice.camera.download.progress', { done: '2.3', total: '9.2' }),
    );
    expect(screen.getByTestId('camera-download-pct').textContent).toBe('25%');
    // "Start batting" waits for a person in frame.
    expect(screen.getByTestId('camera-guide-start').hasAttribute('disabled')).toBe(true);

    act(() => session.setPack({ state: 'stalled' }));
    expect(screen.getByTestId('camera-download-line').textContent).toBe(en.t('practice.camera.download.stalled'));
    act(() => session.setPack({ state: 'retrying', attempt: 2 }));
    expect(screen.getByTestId('camera-download-line').textContent).toBe(
      en.t('practice.camera.download.retrying', { n: 2, max: 2 }),
    );
  });

  it('shows why a download failed, and "Try again" starts it again', async () => {
    const { session } = await mount();
    await act(async () => {
      fireEvent.click(screen.getByTestId('camera-consent-allow'));
    });
    act(() =>
      session.set({
        stage: 'loading',
        pack: { state: 'downloading', bytesDone: 1, bytesTotal: 9_200_000, attempt: 1, maxAttempts: 2 },
      }),
    );
    await act(async () => {
      session.fail('offline');
      await Promise.resolve();
    });
    expect(panel()).toBe('view');
    expect(screen.getByTestId('camera-download').dataset.state).toBe('failed');
    expect(screen.getByTestId('camera-download-line').textContent).toBe(en.t('practice.camera.download.offline'));
    // The picture stays, and the player can try again or bat with the mouse.
    expect(screen.getByTestId('camera-preview')).toBeTruthy();
    expect(screen.getByTestId('camera-guide-fallback')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId('camera-download-retry'));
    });
    expect(session.calls.start).toBe(2);
    expect(screen.queryByTestId('camera-download-retry')).toBeNull();
  });

  it('says once that the files are kept for offline play, when the download finished while the guide was up', async () => {
    const { session } = await mount();
    await act(async () => {
      fireEvent.click(screen.getByTestId('camera-consent-allow'));
    });
    act(() =>
      session.set({
        stage: 'loading',
        pack: { state: 'downloading', bytesDone: 4_000_000, bytesTotal: 9_200_000, attempt: 1, maxAttempts: 2 },
      }),
    );
    act(() =>
      session.set({
        stage: 'starting',
        pack: { state: 'cached', bytesDone: 9_200_000, bytesTotal: 9_200_000, attempt: 1, maxAttempts: 2 },
      }),
    );
    expect(screen.getByTestId('camera-download-ready').textContent).toBe(en.t('practice.camera.download.ready'));
  });
});

describe('getting in position', () => {
  async function running() {
    const m = await mount({ cached: true });
    await act(async () => {
      fireEvent.click(screen.getByTestId('camera-consent-allow'));
    });
    await act(async () => {
      m.session.finish();
      await Promise.resolve();
    });
    return m;
  }

  it('tells a player who is not in frame what to do, and keeps "Start batting" off', async () => {
    const { session } = await running();
    expect(screen.getByTestId('camera-frame-badge').dataset.state).toBe('finding');
    act(() => session.setReadiness({ shoulders: true, head: true, distance: 'too_close' }));
    expect(screen.getByTestId('camera-frame-badge').dataset.state).toBe('no');
    expect(screen.getByTestId('camera-hint').textContent).toBe(en.t('practice.camera.guide.too_close'));
    act(() => session.setReadiness({ distance: 'too_far' }));
    expect(screen.getByTestId('camera-hint').textContent).toBe(en.t('practice.camera.guide.too_far'));
    act(() => session.setReadiness({ distance: 'ok', battingHand: false }));
    expect(screen.getByTestId('camera-hint').textContent).toBe(en.t('practice.camera.guide.arms_out'));
    act(() => session.setReadiness({ poorLight: true }));
    expect(screen.getByTestId('camera-hint').textContent).toBe(en.t('practice.camera.guide.dark'));
    expect(screen.getByTestId('camera-guide-start').hasAttribute('disabled')).toBe(true);
  });

  it('turns the badge green in words ("You are in frame") and lets the player start batting, which answers ready', async () => {
    const { session, onDone } = await running();
    act(() => session.seen());
    expect(screen.getByTestId('camera-frame-badge').dataset.state).toBe('yes');
    expect(screen.getByTestId('camera-frame-badge').textContent).toBe(en.t('practice.camera.frame.yes'));
    const start = screen.getByTestId('camera-guide-start');
    expect(start.hasAttribute('disabled')).toBe(false);
    expect(start.textContent).toBe(en.t('practice.camera.guide.done'));
    fireEvent.click(start);
    expect(onDone).toHaveBeenCalledWith({ kind: 'ready' });
    expect(onDone).toHaveBeenCalledTimes(1);
    // The camera stays on for the play screen that follows, but not for ever.
    expect(session.calls.stop).toBe(0);
    expect(getCameraUi().started).toBe(true);
  });

  it('announces what it sees politely, in one live region the start button points to', async () => {
    await running();
    const hint = screen.getByTestId('camera-hint');
    expect(hint.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByTestId('camera-guide-start').getAttribute('aria-describedby')).toBe(hint.id);
  });

  it('lays the distance guidance out for a laptop with the real numbers', async () => {
    await running();
    expect(screen.getByText(en.t('practice.camera.guide.laptop', { near: 1.5, far: 2.5 }))).toBeTruthy();
  });
});

describe('the way back is one tap, everywhere', () => {
  it('on the consent: nothing was ever started', async () => {
    const { onDone, session } = await mount({ fallback: 'touch' });
    fireEvent.click(screen.getByTestId('camera-consent-fallback'));
    expect(onDone).toHaveBeenCalledWith({ kind: 'fallback', to: 'touch' });
    expect(session.calls.start).toBe(0);
  });

  it('while waiting for the prompt: the start is aborted and the camera stopped', async () => {
    const { onDone, session } = await mount();
    await act(async () => {
      fireEvent.click(screen.getByTestId('camera-consent-allow'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('camera-permission-fallback'));
    });
    expect(onDone).toHaveBeenCalledWith({ kind: 'fallback', to: 'mouse' });
    expect(session.signals[0].aborted).toBe(true);
    expect(session.calls.stop).toBeGreaterThanOrEqual(1);
    expect(getCameraUi().started).toBe(false);
  });

  it('in the guide, and on a troubleshooting panel', async () => {
    const { onDone, session } = await mount({ cached: true });
    await act(async () => {
      fireEvent.click(screen.getByTestId('camera-consent-allow'));
    });
    await act(async () => {
      session.fail('busy');
      await Promise.resolve();
    });
    expect(panel()).toBe('trouble');
    expect(dialog().dataset.case).toBe('busy');
    await act(async () => {
      fireEvent.click(screen.getByTestId('camera-trouble-fallback'));
    });
    expect(onDone).toHaveBeenCalledWith({ kind: 'fallback', to: 'mouse' });
    expect(getCameraUi().started).toBe(false);
  });

  it('Escape and Android Back cancel and leave the camera off', async () => {
    const a = await mount();
    await act(async () => {
      fireEvent.click(screen.getByTestId('camera-consent-allow'));
    });
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    expect(a.onDone).toHaveBeenCalledWith({ kind: 'cancelled' });
    expect(getCameraUi().started).toBe(false);
    cleanup();
    resetCameraUi(false);
    const b = await mount();
    act(() => void closeTopLayer());
    expect(b.onDone).toHaveBeenCalledWith({ kind: 'cancelled' });
  });

  it('answers only once, however many times it is told', async () => {
    const { onDone } = await mount();
    fireEvent.click(screen.getByTestId('camera-consent-fallback'));
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('leaves no camera on when it is unmounted without an answer', async () => {
    const { session, view } = await mount();
    await act(async () => {
      fireEvent.click(screen.getByTestId('camera-consent-allow'));
    });
    view.unmount();
    expect(session.calls.stop).toBeGreaterThanOrEqual(1);
    expect(getCameraUi().started).toBe(false);
  });
});

describe('what the setup shows before the consent when the camera cannot work', () => {
  it('goes straight to the panel for an unavailable camera, with the way back', async () => {
    const session = createFakeSession();
    session.unavailableWith = 'insecure';
    const { onDone } = await mount({ session });
    expect(panel()).toBe('trouble');
    expect(dialog().dataset.case).toBe('unsupported');
    expect(screen.queryByTestId('camera-consent-allow')).toBeNull();
    fireEvent.click(screen.getByTestId('camera-trouble-fallback'));
    expect(onDone).toHaveBeenCalledWith({ kind: 'fallback', to: 'mouse' });
  });
});

describe('moving through the dialog', () => {
  it('returns focus to the dialog when the panel changes, so its new name is read', async () => {
    const { session } = await mount({ cached: true });
    const allow = screen.getByTestId('camera-consent-allow');
    allow.focus();
    await act(async () => {
      fireEvent.click(allow);
    });
    expect(panel()).toBe('permission');
    expect(document.activeElement).toBe(dialog());
    await act(async () => {
      session.finish();
      await Promise.resolve();
    });
    expect(panel()).toBe('view');
    expect(document.activeElement).toBe(dialog());
  });
});

describe('the privacy sentence leads the consent', () => {
  it('is the first line under the title; then why the camera is wanted, how to stop it, and the others', async () => {
    await mount();
    const lines = Array.from(within(dialog()).getByTestId('camera-consent').querySelectorAll('li')).map(
      (li) => li.textContent,
    );
    expect(lines.slice(0, 4)).toEqual([
      en.t('practice.camera.consent.privacy'),
      en.t('practice.camera.consent.what'),
      en.t('practice.camera.consent.stop'),
      en.t('practice.camera.consent.others'),
    ]);
  });
});
