/**
 * The camera's life in a Practice visit, kept away from React so it can be tested with a fake session. It starts the
 * camera only from the player's tap, mirrors the session's status into the store (./store.ts), and stops the camera
 * whenever it should not be on: the player cancels or switches away, the page is hidden, play is left, or nothing started
 * using it after the setup finished. It holds a Screen Wake Lock while the camera runs (the web; Android's flag is
 * ANDROID's) so the picture does not sleep mid-over.
 *
 * Nothing here reads a picture: the session shows its stream in a video element and tells this controller only what it
 * found (the core's PoseReadiness) and what failed (a CameraProblem). Consent never starts the camera by itself.
 */
import { isNativePlatform } from '@/platform';
import type { NormalizedSwing } from '@/contracts';
import { rememberConsent, consentSeen } from './consent';
import { currentUserAgent, readEnvironment, type CameraEnvironment } from './environment';
import {
  NO_READINESS,
  type CameraBat,
  type CameraProblem,
  type CameraSession,
  type CameraSessionStatus,
  type PoseReadiness,
} from './ports';
import { problemOfError } from './problems';
import { getCameraUi, publishCameraUi } from './store';

/** In the dark and not yet seen for this long: the "not enough light" panel is offered. */
export const LIGHT_HELP_MS = 8000;
/** After the setup says "ready", the camera stays on this long waiting for a play screen to use it. */
export const IDLE_STOP_MS = 20_000;
/** A play screen that unmounts (the player went home) stops the camera after this grace, so a remount can cancel it. */
export const UNMOUNT_STOP_MS = 400;

export interface PageLink {
  hidden(): boolean;
  onChange(cb: () => void): () => void;
}

export interface WakeLockLike {
  request(type: 'screen'): Promise<{ release(): Promise<void> }>;
}

export interface ControllerDeps {
  /** Loads the camera core and makes its session. Null where this build has none. */
  makeSession(): Promise<CameraSession | null>;
  env(): CameraEnvironment;
  consent: { seen(): boolean; remember(): boolean };
  setTimer(cb: () => void, ms: number): () => void;
  page: PageLink;
  wakeLock: WakeLockLike | null;
}

export function defaultDeps(makeSession: () => Promise<CameraSession | null>): ControllerDeps {
  return {
    makeSession,
    env: () => readEnvironment(currentUserAgent(), isNativePlatform()),
    consent: { seen: () => consentSeen(), remember: () => rememberConsent() },
    setTimer: (cb, ms) => {
      const id = setTimeout(cb, ms);
      return () => clearTimeout(id);
    },
    page: {
      hidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
      onChange: (cb) => {
        if (typeof document === 'undefined') return () => undefined;
        document.addEventListener('visibilitychange', cb);
        return () => document.removeEventListener('visibilitychange', cb);
      },
    },
    wakeLock:
      typeof navigator !== 'undefined' && 'wakeLock' in navigator
        ? (navigator as unknown as { wakeLock: WakeLockLike }).wakeLock
        : null,
  };
}

export interface CameraController {
  /** Loads the core and learns what the consent needs to say (the download size, whether it is already stored). */
  prepare(): Promise<void>;
  /** The consent screen was shown and answered "Use camera". */
  acceptConsent(): void;
  /** Starts the camera (call from the tap). Resolves when it is running or has failed; the store says which. */
  begin(): Promise<void>;
  /** Starts again after a failure the player has dealt with. */
  retry(): Promise<void>;
  /** Backs out: stops the download, the stream and the worker, and forgets that the camera was started. */
  cancel(): void;
  stop(): void;
  attachPreview(video: HTMLVideoElement): () => void;
  /** The batter the flow arms for a live ball (null until the camera core is loaded). */
  bat(): CameraBat | null;
  /** The setup finished with "ready": keep the camera on for a play screen, but only for a while. */
  expectPlay(): void;
  playMounted(): void;
  playUnmounted(): void;
  /** A setup dialog is open (so a change of control is not a reason to stop the camera yet). */
  setupOpened(): () => void;
  onSwing(cb: (swing: NormalizedSwing) => void): () => void;
  /** Android shell only: the way to this app's settings page, when the camera core can open it. */
  canOpenSettings(): boolean;
  openSettings(): Promise<boolean>;
  /** "Keep trying" in the light panel: the panel goes away and comes back only after another long dark wait. */
  dismissLightHelp(): void;
  dispose(): void;
}

function sameButSteadyTime(a: PoseReadiness, b: PoseReadiness): boolean {
  return (Object.keys(a) as Array<keyof PoseReadiness>).every((k) => k === 'stableMs' || a[k] === b[k]);
}

export function createCameraController(deps: ControllerDeps): CameraController {
  let session: CameraSession | null = null;
  let sessionPromise: Promise<CameraSession | null> | null = null;
  let unsubscribeSession: (() => void) | null = null;
  let abort: AbortController | null = null;
  let starting: Promise<void> | null = null;
  /** Bumped whenever a start is dropped (cancel, stop, a hidden page), so a late one never publishes over a newer state. */
  let runId = 0;
  let thrown: CameraProblem | null = null;
  let resumeOnShow = false;
  let setups = 0;
  /** Play screens that are up now (the camera layer mounted on the play screen). */
  let plays = 0;
  let darkCancel: (() => void) | null = null;
  let idleCancel: (() => void) | null = null;
  let unmountCancel: (() => void) | null = null;
  let lock: { release(): Promise<void> } | null = null;
  let offPage: (() => void) | null = null;
  let offSwing: (() => void) | null = null;
  const swingListeners = new Set<(swing: NormalizedSwing) => void>();
  let disposed = false;

  const clearIdle = () => {
    idleCancel?.();
    idleCancel = null;
  };
  const clearUnmount = () => {
    unmountCancel?.();
    unmountCancel = null;
  };
  const clearDark = () => {
    darkCancel?.();
    darkCancel = null;
  };

  /** Copies the session's status into the store, and watches for a picture that stays too dark to find anyone in. */
  const sync = (s: CameraSessionStatus) => {
    const dark = s.stage === 'running' && s.readiness.poorLight && !s.readiness.ready;
    if (dark && !darkCancel && !getCameraUi().lightHelp) {
      darkCancel = deps.setTimer(() => {
        darkCancel = null;
        publishCameraUi({ lightHelp: true });
      }, LIGHT_HELP_MS);
    } else if (!dark) {
      clearDark();
    }
    // How long a pose has been steady counts up with every frame and nothing on screen shows it: it alone is not news.
    const before = getCameraUi().readiness;
    const readiness = sameButSteadyTime(before, s.readiness) ? before : s.readiness;
    publishCameraUi({
      stage: s.stage,
      problem: s.problem ?? thrown,
      pack: s.pack,
      readiness,
      lost: s.lost,
      ...(dark ? {} : { lightHelp: false }),
    });
  };

  const attachSwing = () => {
    if (!session?.onSwing || offSwing || swingListeners.size === 0) return;
    offSwing = session.onSwing((swing) => {
      for (const l of [...swingListeners]) l(swing);
    });
  };

  const ensureSession = (): Promise<CameraSession | null> => {
    sessionPromise ??= deps.makeSession().then(
      (s) => {
        session = s;
        if (s && !disposed) {
          unsubscribeSession = s.subscribe(() => sync(s.status()));
          attachSwing();
          // The pack on this device is part of the status from the start (the download panel reads it).
          const status = s.status();
          publishCameraUi({ pack: status.pack });
        }
        return s;
      },
      () => {
        session = null;
        return null;
      },
    );
    return sessionPromise;
  };

  const releaseLock = () => {
    const held = lock;
    lock = null;
    if (held) void held.release().catch(() => undefined);
  };
  const takeLock = async () => {
    if (!deps.wakeLock || lock) return;
    try {
      lock = await deps.wakeLock.request('screen');
    } catch {
      lock = null;
    }
  };

  const stopSession = (keepStarted: boolean) => {
    runId += 1;
    starting = null;
    abort?.abort();
    abort = null;
    clearDark();
    releaseLock();
    try {
      session?.stop();
    } catch {
      /* a session that cannot stop is already not running */
    }
    thrown = null;
    publishCameraUi({
      stage: 'idle',
      problem: null,
      readiness: NO_READINESS,
      lost: false,
      lightHelp: false,
      started: keepStarted,
      ...(session ? { pack: session.status().pack } : {}),
    });
  };

  const onPageChange = () => {
    if (disposed) return;
    const ui = getCameraUi();
    if (deps.page.hidden()) {
      // The picture is for the player looking at it: it stops with the page and comes back with it.
      if (ui.started && ui.stage !== 'idle' && ui.stage !== 'failed') {
        resumeOnShow = true;
        stopSession(true);
      }
      releaseLock();
    } else if (resumeOnShow) {
      resumeOnShow = false;
      void controller.begin();
    }
  };

  const listenPage = () => {
    offPage ??= deps.page.onChange(onPageChange);
  };

  const controller: CameraController = {
    async prepare() {
      const env = deps.env();
      if (env.inApp) {
        publishCameraUi({ problem: 'in_app_browser', consentSeen: deps.consent.seen() });
        return;
      }
      const s = await ensureSession();
      const problem: CameraProblem | null = s ? s.unavailable() : 'unsupported';
      const cached = s ? await s.packCached().catch(() => false) : false;
      const status = s?.status();
      // Once the camera has been started the session's own status is the truth: this only teaches the consent what it needs.
      const idle = !getCameraUi().started;
      publishCameraUi({
        consentSeen: deps.consent.seen(),
        packBytes: s?.packBytes() ?? 0,
        ...(idle && problem ? { problem } : {}),
        ...(idle && status ? { pack: cached ? { ...status.pack, state: 'cached' as const } : status.pack } : {}),
      });
    },

    acceptConsent() {
      deps.consent.remember();
      publishCameraUi({ consentSeen: true });
    },

    begin() {
      if (starting) return starting;
      const ui = getCameraUi();
      if (ui.stage === 'running' && ui.problem === null) return Promise.resolve();
      const my = ++runId;
      const run = (async () => {
        clearIdle();
        clearUnmount();
        listenPage();
        thrown = null;
        publishCameraUi({ started: true, problem: null, lightHelp: false });
        if (deps.env().inApp) {
          thrown = 'in_app_browser';
          publishCameraUi({ stage: 'failed', problem: 'in_app_browser' });
          return;
        }
        const s = await ensureSession();
        // Cancelled (or asked again) while the core was loading: nothing to start.
        if (disposed || my !== runId || !getCameraUi().started) return;
        const unavailable = s ? s.unavailable() : 'unsupported';
        if (!s || unavailable) {
          thrown = unavailable ?? 'unsupported';
          publishCameraUi({ stage: 'failed', problem: thrown });
          return;
        }
        attachSwing();
        const mine = new AbortController();
        abort = mine;
        try {
          await s.start(mine.signal);
        } catch (e) {
          if (mine.signal.aborted || my !== runId) return;
          thrown = problemOfError(e);
          sync({ ...s.status(), stage: 'failed', problem: s.status().problem ?? thrown });
          return;
        }
        if (mine.signal.aborted || my !== runId) return;
        abort = null;
        sync(s.status());
        void takeLock();
      })();
      const tracked: Promise<void> = run.finally(() => {
        if (starting === tracked) starting = null;
      });
      starting = tracked;
      return tracked;
    },

    retry() {
      // A picture that went wrong while the camera was running (black, too slow): the core says it is still running, so
      // "Try again" starts it over, and the check begins again from nothing.
      const ui = getCameraUi();
      if (ui.stage === 'running' && ui.problem) stopSession(true);
      return controller.begin();
    },

    cancel() {
      resumeOnShow = false;
      clearIdle();
      clearUnmount();
      stopSession(false);
    },

    stop() {
      controller.cancel();
    },

    attachPreview(video) {
      return session ? session.attachPreview(video) : () => undefined;
    },

    bat() {
      return session?.bat ?? null;
    },

    expectPlay() {
      // A play screen that is already up is using the camera: nothing to wait for.
      if (plays > 0) return;
      clearIdle();
      idleCancel = deps.setTimer(() => {
        idleCancel = null;
        if (setups === 0 && plays === 0) controller.cancel();
      }, IDLE_STOP_MS);
    },

    playMounted() {
      plays += 1;
      clearIdle();
      clearUnmount();
    },

    playUnmounted() {
      plays = Math.max(0, plays - 1);
      if (plays > 0) return;
      clearUnmount();
      unmountCancel = deps.setTimer(() => {
        unmountCancel = null;
        if (setups === 0 && plays === 0) controller.cancel();
      }, UNMOUNT_STOP_MS);
    },

    setupOpened() {
      setups += 1;
      let closed = false;
      return () => {
        if (closed) return;
        closed = true;
        setups = Math.max(0, setups - 1);
      };
    },

    onSwing(cb) {
      swingListeners.add(cb);
      attachSwing();
      return () => {
        swingListeners.delete(cb);
        if (swingListeners.size === 0) {
          offSwing?.();
          offSwing = null;
        }
      };
    },

    canOpenSettings() {
      return typeof session?.openSettings === 'function';
    },

    dismissLightHelp() {
      clearDark();
      publishCameraUi({ lightHelp: false });
    },

    async openSettings() {
      const s = await ensureSession();
      if (!s?.openSettings) return false;
      try {
        await s.openSettings();
        return true;
      } catch {
        return false;
      }
    },

    dispose() {
      disposed = true;
      resumeOnShow = false;
      clearIdle();
      clearUnmount();
      clearDark();
      offPage?.();
      offPage = null;
      offSwing?.();
      offSwing = null;
      unsubscribeSession?.();
      unsubscribeSession = null;
      stopSession(false);
    },
  };
  return controller;
}

// ---- the one controller of a Practice visit ---------------------------------------------------------------------

type SessionFactory = () => Promise<CameraSession | null>;

/**
 * The camera core's session, made on demand. The core publishes `createCameraSession` from `src/input/camera/index.ts`;
 * this finds it by glob, so the screens compile and say "not available" before the core exists, and nothing of the core
 * is in the first bundle either way.
 */
type CoreModule = { createCameraSession?: () => CameraSession | Promise<CameraSession> };
const coreModules = import.meta.glob<CoreModule>('../../../input/camera/index.ts');

let factoryOverride: SessionFactory | null = null;

/** Tests, and a build that bundles a different core: replace how the session is made. */
export function setCameraSessionFactory(factory: SessionFactory | null): void {
  factoryOverride = factory;
}

/** True when this build has a camera core to start (the screens are otherwise honest about it). */
export function cameraCoreBuilt(): boolean {
  return factoryOverride !== null || Object.keys(coreModules).length > 0;
}

const defaultSession: SessionFactory = async () => {
  const [load] = Object.values(coreModules);
  if (!load) return null;
  try {
    const mod = await load();
    return mod.createCameraSession ? await mod.createCameraSession() : null;
  } catch {
    return null;
  }
};

let shared: CameraController | null = null;

export function getCameraController(): CameraController {
  shared ??= createCameraController(defaultDeps(() => (factoryOverride ?? defaultSession)()));
  return shared;
}

/** Tests: forget the shared controller (it is disposed). */
export function resetCameraController(): void {
  shared?.dispose();
  shared = null;
}
