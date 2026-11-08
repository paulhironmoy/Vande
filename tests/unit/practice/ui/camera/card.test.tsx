/**
 * What the camera shows on the play screen: the card before a ball (while the flow waits for a batter in view), the
 * status chip, and the banner when the camera loses the player between balls. None of it is drawn while a ball is live,
 * every one has "Bat with mouse" or "Bat with touch" in one tap, and nothing here can stop the game.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPracticeT } from '@/i18n/practice';
import { lessonCameraPort, setLessonCameraPort } from '@/practice/ui/lesson/inputType';
import { setControl, storedControl } from '@/practice/ui/controls/state';
import type { PracticeFlow } from '@/practice/ui/flow/controller';
import type { FlowState, LivePhase } from '@/practice/ui/flow/state';
import CameraLayer from '@/practice/ui/camera/CameraLayer';
import { LostBanner, ReadinessCard } from '@/practice/ui/camera/Card';
import { UNMOUNT_STOP_MS, resetCameraController, setCameraSessionFactory } from '@/practice/ui/camera/controller';
import { getCameraUi, publishCameraUi, resetCameraUi } from '@/practice/ui/camera/store';
import { createFakeSession, SEEN, type FakeSession } from './fakeSession';

const en = createPracticeT('en', null);

function install(o: { cached?: boolean } = {}): FakeSession {
  const session = createFakeSession({ cached: o.cached ?? true });
  setCameraSessionFactory(() => Promise.resolve(session));
  resetCameraController();
  return session;
}
const settle = () => act(async () => void (await Promise.resolve()));

/** Starts the camera as the player's tap would and brings it to running. */
async function run(session: FakeSession) {
  const { getCameraController } = await import('@/practice/ui/camera/controller');
  const started = getCameraController().begin();
  await settle();
  await act(async () => {
    session.finish();
    await started;
  });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('vc:practice:camera', JSON.stringify({ consentSeen: true, consentV: 1 }));
  resetCameraUi(false);
});
afterEach(() => {
  cleanup();
  resetCameraController();
  setCameraSessionFactory(null);
  setLessonCameraPort(null);
  resetCameraUi(false);
  vi.useRealTimers();
});

describe('the card before a ball', () => {
  it('on a new visit it offers one tap to start the camera, the privacy line, and the way back', async () => {
    const session = install();
    const openHelp = vi.fn();
    render(<ReadinessCard openHelp={openHelp} />);
    await settle();
    expect(screen.getByTestId('camera-ready').dataset.panel).toBe('start');
    expect(screen.getByText(en.t('practice.camera.privacy.line'))).toBeTruthy();
    expect(session.calls.start).toBe(0);
    await act(async () => {
      fireEvent.click(screen.getByTestId('camera-start-button'));
    });
    expect(session.calls.start).toBe(1);
    expect(openHelp).not.toHaveBeenCalled();
  });

  it('shows the consent itself when this device has not seen it, starts nothing until the tap, and remembers it', async () => {
    localStorage.clear();
    const session = install();
    render(<ReadinessCard openHelp={() => undefined} />);
    await settle();
    expect(screen.getByTestId('camera-ready').dataset.panel).toBe('consent');
    expect(screen.getByText(en.t('practice.camera.consent.privacy'))).toBeTruthy();
    expect(screen.getByText(en.t('practice.camera.consent.what'))).toBeTruthy();
    expect(screen.getByTestId('camera-consent-fallback').textContent).toBe('Bat with mouse');
    expect(session.calls.start).toBe(0);
    await act(async () => {
      fireEvent.click(screen.getByTestId('camera-consent-allow'));
    });
    expect(session.calls.start).toBe(1);
    expect(localStorage.getItem('vc:practice:camera')).toContain('"consentSeen":true');
  });

  it('says what the next ball is waiting for, with the picture and the badge, and announces it politely once', async () => {
    const session = install();
    await run(session);
    render(<ReadinessCard openHelp={() => undefined} />);
    await settle();
    expect(screen.getByTestId('camera-ready-line').textContent).toBe(en.t('practice.camera.ready.line'));
    expect(screen.getByTestId('camera-preview')).toBeTruthy();
    expect(screen.getByTestId('camera-frame-badge')).toBeTruthy();
    const live = document.querySelector('[aria-live="polite"][aria-atomic="true"]');
    expect(live?.textContent).toBe(en.t('practice.camera.ready.announce'));
    expect(screen.getByRole('region', { name: en.t('practice.camera.ready.line') })).toBeTruthy();
    act(() => session.setReadiness({ shoulders: true, distance: 'too_far' }));
    expect(screen.getByTestId('camera-hint').textContent).toBe(en.t('practice.camera.guide.too_far'));
  });

  it('shows the download behind it while the files come, and the reason when they do not', async () => {
    const session = install({ cached: false });
    const { getCameraController } = await import('@/practice/ui/camera/controller');
    void getCameraController().begin();
    await settle();
    render(<ReadinessCard openHelp={() => undefined} />);
    act(() =>
      session.set({
        stage: 'loading',
        pack: { state: 'downloading', bytesDone: 4_600_000, bytesTotal: 9_200_000, attempt: 1, maxAttempts: 2 },
      }),
    );
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
    await act(async () => {
      session.fail('download_failed');
      await Promise.resolve();
    });
    expect(screen.getByTestId('camera-download-line').textContent).toBe(en.t('practice.camera.download.failed'));
    expect(screen.getByTestId('camera-download-retry')).toBeTruthy();
  });

  it('shows a cause as its own panel inside the card', async () => {
    const session = install();
    const { getCameraController } = await import('@/practice/ui/camera/controller');
    void getCameraController().begin();
    await settle();
    render(<ReadinessCard openHelp={() => undefined} />);
    await act(async () => {
      session.fail('busy');
      await Promise.resolve();
    });
    expect(screen.getByTestId('camera-ready').dataset.panel).toBe('trouble');
    expect(screen.getByTestId('camera-ready').dataset.case).toBe('busy');
    await act(async () => {
      fireEvent.click(screen.getByTestId('camera-trouble-retry'));
    });
    expect(session.calls.start).toBe(2);
  });

  it('"Bat with mouse" moves the control and switches the camera off, in one tap', async () => {
    const session = install();
    await run(session);
    render(<ReadinessCard openHelp={() => undefined} />);
    await settle();
    expect(setControl('camera')).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByTestId('camera-ready-fallback'));
    });
    expect(storedControl()).toBe('mouse');
    expect(session.calls.stop).toBeGreaterThanOrEqual(1);
    expect(getCameraUi().started).toBe(false);
  });

  it('"Setup help" opens the guide', async () => {
    const session = install();
    await run(session);
    const openHelp = vi.fn();
    render(<ReadinessCard openHelp={openHelp} />);
    await settle();
    fireEvent.click(screen.getByTestId('camera-ready-help'));
    expect(openHelp).toHaveBeenCalledTimes(1);
  });
});

describe('the camera layer on the play screen', () => {
  const flow = (phase: LivePhase, screenName: FlowState['screen'] = 'live') =>
    ({
      phase,
      screen: screenName,
      gesture: { enabled: false, key: '0' },
      handedness: 'right',
      last: null,
    }) as unknown as FlowState;
  const stub = {
    onSwingStart: vi.fn(),
    onSwingIntent: vi.fn(),
    onGestureCancel: vi.fn(),
    onContactState: vi.fn(),
    onGesture: vi.fn(),
    stageOwnsInput: () => false,
  } as unknown as PracticeFlow;

  it('draws the card only in the camera phase, and the chip and banner never', async () => {
    const session = install();
    await run(session);
    session.seen();
    const view = render(<CameraLayer flow={stub} state={flow('camera')} />);
    await settle();
    expect(screen.getByTestId('camera-ready')).toBeTruthy();
    expect(screen.queryByTestId('camera-chip')).toBeNull();
    view.rerender(<CameraLayer flow={stub} state={flow('dead')} />);
    expect(screen.queryByTestId('camera-ready')).toBeNull();
  });

  it('draws a quiet chip between balls, dimmer in the run-up, and nothing while a ball is live', async () => {
    const session = install();
    await run(session);
    act(() => session.seen());
    const view = render(<CameraLayer flow={stub} state={flow('dead')} />);
    await settle();
    const chip = screen.getByTestId('camera-chip');
    expect(chip.textContent).toBe(en.t('practice.camera.chip.on'));
    expect(chip.dataset.state).toBe('on');
    expect(chip.dataset.quiet).toBe('false');
    view.rerender(<CameraLayer flow={stub} state={flow('runup')} />);
    expect(screen.getByTestId('camera-chip').dataset.quiet).toBe('true');
    for (const phase of ['live', 'playing'] as const) {
      view.rerender(<CameraLayer flow={stub} state={flow(phase)} />);
      expect(screen.queryByTestId('camera-chip')).toBeNull();
      expect(screen.queryByTestId('camera-lost-banner')).toBeNull();
    }
  });

  it('draws no chip when the camera is off', async () => {
    install();
    render(<CameraLayer flow={stub} state={flow('dead')} />);
    await settle();
    expect(screen.queryByTestId('camera-chip')).toBeNull();
  });

  it('says it cannot see the player, between balls only, with the way back; "Keep trying" hides it until the next loss', async () => {
    const session = install();
    await run(session);
    act(() => session.seen());
    const view = render(<CameraLayer flow={stub} state={flow('dead')} />);
    await settle();
    expect(screen.queryByTestId('camera-lost-banner')).toBeNull();
    act(() => session.set({ lost: true }));
    expect(screen.getByTestId('camera-chip').dataset.state).toBe('lost');
    expect(screen.getByTestId('camera-chip').textContent).toBe(en.t('practice.camera.chip.lost'));
    const banner = screen.getByTestId('camera-lost-banner');
    expect(screen.getByText(en.t('practice.camera.lost.title'))).toBeTruthy();
    expect(screen.getByText(en.t('practice.camera.lost.body'))).toBeTruthy();
    expect(screen.getByTestId('camera-lost-announce').textContent).toBe(
      en.t('practice.camera.lost.announce', { control: 'mouse' }),
    );
    expect(banner.getAttribute('role')).toBe('region');
    // Not during a ball: the run-up and the live ball draw no banner.
    view.rerender(<CameraLayer flow={stub} state={flow('runup')} />);
    expect(screen.queryByTestId('camera-lost-banner')).toBeNull();
    view.rerender(<CameraLayer flow={stub} state={flow('dead')} />);
    fireEvent.click(screen.getByTestId('camera-lost-retry'));
    expect(screen.queryByTestId('camera-lost-banner')).toBeNull();
    act(() => session.set({ lost: false }));
    act(() => session.set({ lost: true }));
    expect(screen.getByTestId('camera-lost-banner')).toBeTruthy();
  });

  it('says so, once and plainly, when the camera lost the player during a ball that then counted as a leave', async () => {
    const session = install();
    await run(session);
    act(() => session.seen());
    const dead = (swing: unknown) =>
      ({ ...flow('dead'), last: { result: { swing }, interrupted: false } }) as unknown as FlowState;
    const view = render(<CameraLayer flow={stub} state={flow('runup')} />);
    await settle();
    act(() => session.set({ lost: true }));
    view.rerender(<CameraLayer flow={stub} state={flow('live')} />);
    act(() => session.set({ lost: false }));
    // The player is back in view at the dead ball: a quiet note, no banner, no buttons.
    view.rerender(<CameraLayer flow={stub} state={dead(null)} />);
    expect(screen.getByTestId('camera-lost-note').textContent).toBe(en.t('practice.camera.lost.counted'));
    expect(screen.queryByTestId('camera-lost-banner')).toBeNull();
    // A ball with a swing was not a leave, so there is nothing to explain.
    view.rerender(<CameraLayer flow={stub} state={dead({ kind: 'attack' })} />);
    expect(screen.queryByTestId('camera-lost-note')).toBeNull();
    // Still lost at the dead ball: the banner carries the line.
    act(() => session.set({ lost: true }));
    view.rerender(<CameraLayer flow={stub} state={dead(null)} />);
    expect(screen.getByTestId('camera-lost-counted')).toBeTruthy();
    expect(screen.queryByTestId('camera-lost-note')).toBeNull();
    // The next ball starts clean.
    act(() => session.set({ lost: false }));
    view.rerender(<CameraLayer flow={stub} state={flow('camera')} />);
    view.rerender(<CameraLayer flow={stub} state={dead(null)} />);
    expect(screen.queryByTestId('camera-lost-note')).toBeNull();
  });

  it("the banner's way back switches the control and turns the camera off", async () => {
    const session = install();
    await run(session);
    act(() => session.set({ lost: true }));
    render(<CameraLayer flow={stub} state={flow('dead')} />);
    await settle();
    expect(setControl('camera')).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByTestId('camera-lost-fallback'));
    });
    expect(storedControl()).toBe('mouse');
    expect(getCameraUi().started).toBe(false);
  });

  it('opens the guide from "Setup help" and the guide\'s own way back switches the control', async () => {
    const session = install();
    await run(session);
    act(() => session.set({ lost: true }));
    render(<CameraLayer flow={stub} state={flow('dead')} />);
    await settle();
    expect(setControl('camera')).toBe(true);
    fireEvent.click(screen.getByTestId('camera-lost-help'));
    await settle();
    expect(screen.getByTestId('camera-setup')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId('camera-guide-fallback'));
    });
    expect(screen.queryByTestId('camera-setup')).toBeNull();
    expect(storedControl()).toBe('mouse');
  });

  it('registers the lesson port while mounted and clears it after', async () => {
    install();
    const view = render(<CameraLayer flow={stub} state={flow('dead')} />);
    await settle();
    expect(lessonCameraPort()).not.toBeNull();
    view.unmount();
    expect(lessonCameraPort()).toBeNull();
  });

  it('switches the camera off shortly after the play screen goes, and not if it comes back at once', async () => {
    vi.useFakeTimers();
    const session = install();
    const { getCameraController } = await import('@/practice/ui/camera/controller');
    const started = getCameraController().begin();
    await vi.advanceTimersByTimeAsync(0);
    session.finish();
    await started;
    const a = render(<CameraLayer flow={stub} state={flow('dead')} />);
    a.unmount();
    const b = render(<CameraLayer flow={stub} state={flow('dead')} />);
    await vi.advanceTimersByTimeAsync(UNMOUNT_STOP_MS * 3);
    expect(session.calls.stop).toBe(0);
    b.unmount();
    await vi.advanceTimersByTimeAsync(UNMOUNT_STOP_MS + 1);
    expect(session.calls.stop).toBe(1);
    expect(getCameraUi().started).toBe(false);
  });

  it('keeps the store honest about what the card needs: a steady person is the only thing that lets the ball go', async () => {
    const session = install();
    await run(session);
    expect(getCameraUi().readiness.ready).toBe(false);
    act(() => session.setReadiness(SEEN));
    expect(getCameraUi().readiness.ready).toBe(true);
    publishCameraUi({ lost: true });
    expect(getCameraUi().lost).toBe(true);
  });
});

describe("the banner keeps clear of the dead ball's card", () => {
  it('takes the right of the screen, and the left when the card has moved to the right', async () => {
    const session = install();
    await run(session);
    act(() => session.set({ lost: true }));
    const root = document.createElement('div');
    root.setAttribute('data-play-root', '');
    document.body.appendChild(root);
    const card = document.createElement('div');
    card.setAttribute('data-place', 'left-bottom');
    root.appendChild(card);
    const view = render(<LostBanner onKeepTrying={() => undefined} onHelp={() => undefined} />, {
      container: root.appendChild(document.createElement('div')),
    });
    await settle();
    expect(screen.getByTestId('camera-lost-banner').dataset.side).toBe('right');
    await act(async () => {
      card.setAttribute('data-place', 'right-top');
      await Promise.resolve();
    });
    expect(screen.getByTestId('camera-lost-banner').dataset.side).toBe('left');
    await act(async () => {
      card.setAttribute('data-place', 'left-bottom');
      await Promise.resolve();
    });
    expect(screen.getByTestId('camera-lost-banner').dataset.side).toBe('right');
    view.unmount();
    root.remove();
  });
});
