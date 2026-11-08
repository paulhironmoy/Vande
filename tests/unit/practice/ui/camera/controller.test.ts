/**
 * The camera's life in a visit, on a fake session: it starts only from a tap, mirrors the session's status, stops
 * whenever it should not be on (cancel, the page hiding, play being left, nothing using it after the setup), and keeps
 * the screen awake while it runs. Time is driven by hand.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NormalizedSwing } from '@/contracts';
import { memoryStore, PRACTICE_KEYS } from '@/practice/store';
import {
  IDLE_STOP_MS,
  LIGHT_HELP_MS,
  UNMOUNT_STOP_MS,
  createCameraController,
  type CameraController,
  type ControllerDeps,
} from '@/practice/ui/camera/controller';
import { consentSeen, rememberConsent } from '@/practice/ui/camera/consent';
import type { CameraEnvironment } from '@/practice/ui/camera/environment';
import { getCameraUi, resetCameraUi } from '@/practice/ui/camera/store';
import { createFakeSession, SEEN, type FakeSession } from './fakeSession';

const DESKTOP: CameraEnvironment = { family: 'chrome', platform: 'desktop', inApp: null };

interface Rig {
  controller: CameraController;
  session: FakeSession | null;
  deps: ControllerDeps;
  /** Fires every timer set so far whose delay is at most `ms` (and not cancelled). */
  advance(ms: number): void;
  setHidden(hidden: boolean): void;
  locks: { taken: number; released: number };
  env: CameraEnvironment;
  consent: ReturnType<typeof memoryStore>;
}

function rig(o: { session?: FakeSession | null; env?: CameraEnvironment; wakeLock?: boolean } = {}): Rig {
  const session = o.session === undefined ? createFakeSession() : o.session;
  const timers: Array<{ at: number; cb: () => void; live: boolean }> = [];
  let now = 0;
  let hidden = false;
  const pageListeners = new Set<() => void>();
  const locks = { taken: 0, released: 0 };
  const consent = memoryStore();
  const state: Rig = {
    controller: undefined as unknown as CameraController,
    session,
    deps: undefined as unknown as ControllerDeps,
    advance(ms) {
      now += ms;
      for (const t of [...timers]) {
        if (t.live && t.at <= now) {
          t.live = false;
          t.cb();
        }
      }
    },
    setHidden(h) {
      hidden = h;
      pageListeners.forEach((l) => l());
    },
    locks,
    env: o.env ?? DESKTOP,
    consent,
  };
  state.deps = {
    makeSession: () => Promise.resolve(session),
    env: () => state.env,
    consent: { seen: () => consentSeen(consent), remember: () => rememberConsent(consent) },
    setTimer: (cb, ms) => {
      const t = { at: now + ms, cb, live: true };
      timers.push(t);
      return () => {
        t.live = false;
      };
    },
    page: {
      hidden: () => hidden,
      onChange: (cb) => {
        pageListeners.add(cb);
        return () => void pageListeners.delete(cb);
      },
    },
    wakeLock:
      o.wakeLock === false
        ? null
        : {
            request: () => {
              locks.taken += 1;
              return Promise.resolve({
                release: () => {
                  locks.released += 1;
                  return Promise.resolve();
                },
              });
            },
          },
  };
  state.controller = createCameraController(state.deps);
  return state;
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

let current: Rig | null = null;
const make = (o?: Parameters<typeof rig>[0]) => (current = rig(o));
beforeEach(() => resetCameraUi(false));
afterEach(() => {
  current?.controller.dispose();
  current = null;
  resetCameraUi(false);
});

describe('prepare: what the consent needs to know', () => {
  it('learns whether the pack is stored and how big it is, and the consent flag, without starting anything', async () => {
    const r = make({ session: createFakeSession({ cached: false, bytes: 9_200_000 }) });
    rememberConsent(r.consent);
    await r.controller.prepare();
    expect(getCameraUi()).toMatchObject({ started: false, problem: null, consentSeen: true });
    expect(getCameraUi().packBytes).toBe(9_200_000);
    expect(getCameraUi().pack.state).not.toBe('cached');
    expect(r.session!.calls.start).toBe(0);
  });

  it('says nothing to download when the pack is already stored', async () => {
    const r = make({ session: createFakeSession({ cached: true }) });
    await r.controller.prepare();
    expect(getCameraUi().pack.state).toBe('cached');
  });

  it('puts an in-app browser, a missing core and an unavailable camera on the screen before any consent', async () => {
    const inApp = make({ env: { ...DESKTOP, inApp: 'Instagram' } });
    await inApp.controller.prepare();
    expect(getCameraUi().problem).toBe('in_app_browser');
    expect(inApp.session!.calls.start).toBe(0);
    inApp.controller.dispose();

    resetCameraUi(false);
    const none = make({ session: null });
    await none.controller.prepare();
    expect(getCameraUi().problem).toBe('unsupported');
    none.controller.dispose();

    resetCameraUi(false);
    const insecure = createFakeSession();
    insecure.unavailableWith = 'insecure';
    const r = make({ session: insecure });
    await r.controller.prepare();
    expect(getCameraUi().problem).toBe('insecure');
  });

  it('remembers the consent when it is accepted', () => {
    const r = make();
    expect(consentSeen(r.consent)).toBe(false);
    r.controller.acceptConsent();
    expect(consentSeen(r.consent)).toBe(true);
    expect(getCameraUi().consentSeen).toBe(true);
    expect(JSON.parse(r.consent.getItem(PRACTICE_KEYS.camera)!)).toMatchObject({ consentSeen: true });
  });
});

describe('begin: only from the tap', () => {
  it('starts the session with an abort signal, mirrors its status, and holds a wake lock once it runs', async () => {
    const r = make();
    const s = r.session!;
    expect(s.calls.start).toBe(0);
    const started = r.controller.begin();
    await flush();
    expect(s.calls.start).toBe(1);
    expect(getCameraUi()).toMatchObject({ started: true, stage: 'opening', problem: null });
    s.set({
      stage: 'loading',
      pack: { state: 'downloading', bytesDone: 1_000_000, bytesTotal: 9_200_000, attempt: 1, maxAttempts: 2 },
    });
    expect(getCameraUi().stage).toBe('loading');
    expect(getCameraUi().pack.bytesDone).toBe(1_000_000);
    s.finish();
    s.seen();
    await started;
    expect(getCameraUi()).toMatchObject({ started: true, stage: 'running', problem: null, lost: false });
    expect(getCameraUi().readiness).toEqual(SEEN);
    await flush();
    expect(r.locks.taken).toBe(1);
  });

  it('is one start however many times it is asked while it is on its way', async () => {
    const r = make();
    const a = r.controller.begin();
    const b = r.controller.begin();
    await flush();
    expect(r.session!.calls.start).toBe(1);
    r.session!.finish();
    await Promise.all([a, b]);
    // Running with no problem: asking again does nothing.
    await r.controller.begin();
    expect(r.session!.calls.start).toBe(1);
  });

  it('shows a failure the session names, and "Try again" starts it again with the problem cleared', async () => {
    const r = make();
    const first = r.controller.begin();
    await flush();
    r.session!.fail('blocked');
    await first;
    expect(getCameraUi()).toMatchObject({ started: true, stage: 'failed', problem: 'blocked' });
    const second = r.controller.retry();
    await flush();
    expect(r.session!.calls.start).toBe(2);
    expect(getCameraUi().problem).toBeNull();
    r.session!.finish();
    await second;
    expect(getCameraUi().stage).toBe('running');
  });

  it("understands a browser's own error thrown by the session", async () => {
    const s = createFakeSession();
    s.start = () => Promise.reject(Object.assign(new Error('x'), { name: 'NotReadableError' }));
    const r = make({ session: s });
    await r.controller.begin();
    expect(getCameraUi()).toMatchObject({ stage: 'failed', problem: 'busy' });
  });

  it("never starts inside another app's browser, and says why", async () => {
    const r = make({ env: { ...DESKTOP, inApp: 'Facebook' } });
    await r.controller.begin();
    expect(r.session!.calls.start).toBe(0);
    expect(getCameraUi()).toMatchObject({ started: true, stage: 'failed', problem: 'in_app_browser' });
  });

  it('says the camera is not available where there is no core', async () => {
    const r = make({ session: null });
    await r.controller.begin();
    expect(getCameraUi()).toMatchObject({ stage: 'failed', problem: 'unsupported' });
  });
});

describe('cancel: the light goes off', () => {
  it('aborts a start in progress, stops the session, forgets the start and shows no failure for the abort', async () => {
    const r = make();
    const started = r.controller.begin();
    await flush();
    const signal = r.session!.signals[0];
    r.controller.cancel();
    await started;
    expect(signal.aborted).toBe(true);
    expect(r.session!.calls.stop).toBe(1);
    expect(getCameraUi()).toMatchObject({ started: false, stage: 'idle', problem: null, lost: false });
  });

  it('releases the wake lock and clears what the camera saw', async () => {
    const r = make();
    const started = r.controller.begin();
    await flush();
    r.session!.finish();
    r.session!.seen();
    await started;
    await flush();
    r.controller.stop();
    expect(r.locks.released).toBe(1);
    expect(getCameraUi().readiness.ready).toBe(false);
    expect(getCameraUi().started).toBe(false);
  });

  it('works without a wake lock (a browser that has none)', async () => {
    const r = make({ wakeLock: false });
    const started = r.controller.begin();
    await flush();
    r.session!.finish();
    await started;
    expect(getCameraUi().stage).toBe('running');
  });
});

describe('the page hides', () => {
  it('stops the camera with the page and brings it back with the page, without a new tap', async () => {
    const r = make();
    const started = r.controller.begin();
    await flush();
    r.session!.finish();
    await started;
    r.setHidden(true);
    expect(r.session!.calls.stop).toBe(1);
    expect(getCameraUi()).toMatchObject({ started: true, stage: 'idle' });
    r.setHidden(false);
    await flush();
    expect(r.session!.calls.start).toBe(2);
  });

  it('does nothing for a camera that was never started', async () => {
    const r = make();
    await r.controller.prepare();
    r.setHidden(true);
    r.setHidden(false);
    await flush();
    expect(r.session!.calls.start).toBe(0);
    expect(r.session!.calls.stop).toBe(0);
  });

  it('does not bring back a camera the player stopped while the page was hidden', async () => {
    const r = make();
    const started = r.controller.begin();
    await flush();
    r.session!.finish();
    await started;
    r.setHidden(true);
    r.controller.cancel();
    r.setHidden(false);
    await flush();
    expect(r.session!.calls.start).toBe(1);
  });
});

describe('the camera does not outstay its use', () => {
  async function running(r: Rig) {
    const started = r.controller.begin();
    await flush();
    r.session!.finish();
    await started;
  }

  it('stops IDLE_STOP_MS after the setup finished if no play screen used it', async () => {
    const r = make();
    await running(r);
    r.controller.expectPlay();
    r.advance(IDLE_STOP_MS - 1);
    expect(r.session!.calls.stop).toBe(0);
    r.advance(1);
    expect(r.session!.calls.stop).toBe(1);
    expect(getCameraUi().started).toBe(false);
  });

  it('stays on when a play screen mounts in time, and stops shortly after play is left', async () => {
    const r = make();
    await running(r);
    r.controller.expectPlay();
    r.controller.playMounted();
    r.advance(IDLE_STOP_MS * 2);
    expect(r.session!.calls.stop).toBe(0);
    r.controller.playUnmounted();
    r.advance(UNMOUNT_STOP_MS - 1);
    expect(r.session!.calls.stop).toBe(0);
    r.advance(1);
    expect(r.session!.calls.stop).toBe(1);
  });

  it('survives a remount (development double mount) without stopping', async () => {
    const r = make();
    await running(r);
    r.controller.playMounted();
    r.controller.playUnmounted();
    r.controller.playMounted();
    r.advance(UNMOUNT_STOP_MS * 5);
    expect(r.session!.calls.stop).toBe(0);
  });

  it('does not stop under an open setup dialog', async () => {
    const r = make();
    await running(r);
    const close = r.controller.setupOpened();
    r.controller.expectPlay();
    r.advance(IDLE_STOP_MS * 2);
    expect(r.session!.calls.stop).toBe(0);
    close();
    close();
  });
});

describe('a picture too dark to find anyone in', () => {
  it('offers the light panel after a long dark wait, and takes it back when the light improves', async () => {
    const r = make();
    const started = r.controller.begin();
    await flush();
    r.session!.finish();
    await started;
    r.session!.setReadiness({ poorLight: true });
    expect(getCameraUi().lightHelp).toBe(false);
    r.advance(LIGHT_HELP_MS - 1);
    expect(getCameraUi().lightHelp).toBe(false);
    r.advance(1);
    expect(getCameraUi().lightHelp).toBe(true);
    r.session!.setReadiness({ poorLight: false });
    expect(getCameraUi().lightHelp).toBe(false);
  });

  it('does not offer it to a player who is seen despite the dark, and "Keep trying" sends it away for another wait', async () => {
    const r = make();
    const started = r.controller.begin();
    await flush();
    r.session!.finish();
    await started;
    r.session!.setReadiness({ ...SEEN, poorLight: true });
    r.advance(LIGHT_HELP_MS * 2);
    expect(getCameraUi().lightHelp).toBe(false);
    r.session!.setReadiness({ ready: false });
    r.advance(LIGHT_HELP_MS);
    expect(getCameraUi().lightHelp).toBe(true);
    r.controller.dismissLightHelp();
    expect(getCameraUi().lightHelp).toBe(false);
    r.session!.setReadiness({ inFrame: false });
    r.advance(LIGHT_HELP_MS);
    expect(getCameraUi().lightHelp).toBe(true);
  });
});

describe('the dry swing and the settings page', () => {
  const swing: NormalizedSwing = {
    kind: 'attack',
    startT: 0.4,
    directionDeg: 10,
    power: 0.6,
    elevation: 0,
    footwork: 'auto',
  };

  it("hands the lesson the camera's own swing, and lets go of the session when the last listener goes", async () => {
    const r = make();
    const got: NormalizedSwing[] = [];
    const off = r.controller.onSwing((s) => got.push(s));
    await r.controller.prepare();
    r.session!.emitSwing(swing);
    expect(got).toEqual([swing]);
    off();
    r.session!.emitSwing(swing);
    expect(got).toHaveLength(1);
  });

  it("knows whether the app's settings page can be opened, and opens it", async () => {
    const r = make({ session: createFakeSession({ openSettings: true }) });
    await r.controller.prepare();
    expect(r.controller.canOpenSettings()).toBe(true);
    await expect(r.controller.openSettings()).resolves.toBe(true);
    expect(r.session!.calls.openSettings).toBe(1);
    r.controller.dispose();
    const plain = make();
    await plain.controller.prepare();
    expect(plain.controller.canOpenSettings()).toBe(false);
    await expect(plain.controller.openSettings()).resolves.toBe(false);
  });
});

describe('stopping and starting again, quickly', () => {
  it('a start that was cancelled never publishes over the one that follows', async () => {
    const r = make();
    const first = r.controller.begin();
    await flush();
    r.controller.cancel();
    const second = r.controller.begin();
    await flush();
    // The first start was aborted; the second is a new one, the only one alive.
    expect(r.session!.calls.start).toBe(2);
    expect(r.session!.signals[0].aborted).toBe(true);
    expect(r.session!.signals[1].aborted).toBe(false);
    r.session!.finish();
    await Promise.all([first, second]);
    expect(getCameraUi()).toMatchObject({ started: true, stage: 'running', problem: null });
  });

  it('a cancel while the core is still loading starts nothing', async () => {
    const r = make();
    const started = r.controller.begin();
    r.controller.cancel();
    await started;
    await flush();
    expect(r.session!.calls.start).toBe(0);
    expect(getCameraUi().started).toBe(false);
  });
});

describe('"Try again" on a picture that went wrong while running', () => {
  it('starts the camera over (a black picture stays "running" in the core until it is restarted)', async () => {
    const r = make();
    const started = r.controller.begin();
    await flush();
    r.session!.finish();
    await started;
    r.session!.set({ problem: 'black' });
    expect(getCameraUi()).toMatchObject({ stage: 'running', problem: 'black' });
    const again = r.controller.retry();
    await flush();
    expect(r.session!.calls.stop).toBe(1);
    expect(r.session!.calls.start).toBe(2);
    r.session!.finish();
    await again;
    expect(getCameraUi()).toMatchObject({ started: true, stage: 'running', problem: null });
  });
});

describe('a pose that is merely steadier', () => {
  it('is not news: counting up the steady time alone never wakes the screens', async () => {
    const r = make();
    const started = r.controller.begin();
    await flush();
    r.session!.finish();
    await started;
    r.session!.seen();
    const before = getCameraUi().readiness;
    let heard = 0;
    const { subscribeCameraUi } = await import('@/practice/ui/camera/store');
    const off = subscribeCameraUi(() => (heard += 1));
    for (let i = 1; i <= 20; i++) r.session!.setReadiness({ stableMs: 500 + i * 33 });
    expect(heard).toBe(0);
    expect(getCameraUi().readiness).toBe(before);
    // A change that matters still is.
    r.session!.setReadiness({ ready: false });
    expect(heard).toBe(1);
    off();
  });
});

describe('a setup opened from the play screen', () => {
  it('does not start the clock that stops an unused camera: the play screen is using it', async () => {
    const r = make();
    const started = r.controller.begin();
    await flush();
    r.session!.finish();
    await started;
    r.controller.playMounted();
    // "Setup help" on the card, then "Start batting": the setup says ready while play is up.
    r.controller.expectPlay();
    r.advance(IDLE_STOP_MS * 3);
    expect(r.session!.calls.stop).toBe(0);
    expect(getCameraUi().started).toBe(true);
    // Leaving play still stops it.
    r.controller.playUnmounted();
    r.advance(UNMOUNT_STOP_MS);
    expect(r.session!.calls.stop).toBe(1);
  });
});
