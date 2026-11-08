/**
 * CameraSession: the camera, the pack, the pose worker and the batter, behind one port (docs/PRACTICE_CAMERA_INPUT.md).
 * CAMERA-UX's screens read status() and call start() and stop(); the Practice flow arms `bat` like a GestureSurface.
 * It never stores or sends a picture: each one is posted to the worker, which closes it; only landmarks come back.
 */
import type { GestureInput, Handedness, NormalizedSwing } from '@/contracts/practice';
import { normalizeGesture } from '../normalize';
import { CAPTURE } from './constants';
import { CameraBatter, type CameraBatterEvents, type CameraBatterStatus } from './driver';
import { openCamera, startFrameLoop, CaptureError, problemOf, type CaptureApi, type FrameInfo } from './capture';
import { canUnpack, PackError, PackLoader } from './loader';
import { nativeCameraAccess, type VandeCameraAccessPlugin } from './nativeAccess';
import { bakedBase, bakedBundled, bakedPack, type CameraPackInfo, type PackStatus } from './pack';
import { CAMERA_PROTOCOL, type Delegate, type FromWorker, type ToWorker } from './protocol';
import { Ring, type CameraStats } from './stats';
import { indexedDbStore, type PackStore } from './store';
import { normalizeFrameTime } from './time';
import { EMPTY_READINESS, type CameraProblem, type PoseReadiness } from './types';

export type SessionStage = 'idle' | 'opening' | 'loading' | 'starting' | 'running' | 'failed';

export interface CameraSessionStatus {
  stage: SessionStage;
  /** Set when stage is 'failed', and while running if the picture goes black or the camera is too slow. */
  problem: CameraProblem | null;
  pack: PackStatus;
  readiness: PoseReadiness;
  lost: boolean;
}

/** What the Practice flow arms, like GestureSurface's props. */
export interface CameraBat {
  setHandlers(h: Partial<CameraBatterEvents> | null): void;
  setEnabled(on: boolean, atPerfMs?: number): void;
  rearm(atPerfMs?: number): void;
  setHandedness(h: Handedness): void;
}

export interface CameraSession {
  status(): CameraSessionStatus;
  subscribe(cb: () => void): () => void;
  unavailable(): CameraProblem | null;
  packBytes(): number;
  packCached(): Promise<boolean>;
  start(signal?: AbortSignal): Promise<void>;
  stop(): void;
  attachPreview(video: HTMLVideoElement): () => void;
  permission?(): Promise<'granted' | 'prompt' | 'denied' | 'blocked' | null>;
  openSettings?(): Promise<void>;
  /** The lesson's dry swing: the NormalizedSwing of a camera swing made while the batter is armed. */
  onSwing(cb: (swing: NormalizedSwing) => void): () => void;
  bat: CameraBat;
  stats(): CameraStats;
}

export interface WorkerLike {
  postMessage(m: ToWorker, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

export interface CameraSessionOptions {
  info?: CameraPackInfo | null;
  base?: string;
  bundled?: boolean;
  store?: PackStore | null;
  api?: CaptureApi;
  fetch?: typeof fetch;
  createWorker?: (blobUrl: string) => WorkerLike;
  makeBitmap?: (video: HTMLVideoElement) => Promise<ImageBitmap>;
  makeVideo?: () => HTMLVideoElement;
  nativeAccess?: VandeCameraAccessPlugin | null;
  now?: () => number;
  /** The calibration offset (ms) a camera swing gets in the dry swing (the flow applies its own for live swings). */
  calibrationMs?: () => number;
  /** Test hook: how long the engine may take to start (ms). */
  startTimeoutMs?: number;
  /** Which delegate to use: 'auto' tries the GPU one and falls back to the CPU one (the default). */
  delegate?: Delegate | 'auto';
  /** Diagnostics (the smoke test): every pose result, as numbers only. */
  onPose?: (lm: Float32Array | null, inferMs: number) => void;
}

const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
]);
const NOTIFY_MS = 100;
/** A GPU delegate whose median inference time is above this (ms) after 30 frames is swapped for the CPU one. */
const SLOW_GPU_MS = 30;
/** The longest the camera waits, from the first engine starting, for the GPU-or-CPU choice to be final (the game never stalls). */
const CHOICE_CEILING_MS = 6000;
const WATCHDOG_MS = 100;

const sameReadiness = (a: PoseReadiness, b: PoseReadiness) =>
  (Object.keys(a) as Array<keyof PoseReadiness>).every((k) => a[k] === b[k]);

const HOOKS = import.meta.env.VITE_PRACTICE_TEST_HOOKS === '1';

declare global {
  interface Window {
    /** TEST BUILDS ONLY (VITE_PRACTICE_TEST_HOOKS=1): what the camera pipeline is doing, for the camera e2e. */
    __vandeCamera?: Record<string, unknown>;
  }
}

export function createCameraSession(opts: CameraSessionOptions = {}): CameraSession {
  const info = opts.info === undefined ? bakedPack() : opts.info;
  const bundled = opts.bundled ?? bakedBundled();
  const store = opts.store === undefined ? indexedDbStore() : opts.store;
  const clock = opts.now ?? (() => performance.now());
  const loader = info
    ? new PackLoader({
        info,
        base: opts.base ?? bakedBase(),
        store,
        bundled,
        fetch: opts.fetch,
        online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
        freeBytes: async () => {
          try {
            const e = await navigator.storage?.estimate?.();
            return e?.quota != null && e.usage != null ? e.quota - e.usage : null;
          } catch {
            return null;
          }
        },
      })
    : null;
  const emptyPack: PackStatus = { state: 'absent', bytesDone: 0, bytesTotal: 0, attempt: 0, maxAttempts: 2 };

  let status: CameraSessionStatus = {
    stage: 'idle',
    problem: null,
    pack: loader?.status() ?? emptyPack,
    readiness: EMPTY_READINESS,
    lost: false,
  };
  const subs = new Set<() => void>();
  let notifyTimer: ReturnType<typeof setTimeout> | null = null;
  function update(patch: Partial<CameraSessionStatus>) {
    const next = { ...status, ...patch };
    if (
      next.stage === status.stage &&
      next.problem === status.problem &&
      next.pack === status.pack &&
      next.lost === status.lost &&
      sameReadiness(next.readiness, status.readiness)
    )
      return;
    status = next;
    if (notifyTimer === null)
      notifyTimer = setTimeout(() => {
        notifyTimer = null;
        for (const cb of [...subs]) cb();
      }, NOTIFY_MS);
  }
  loader?.subscribe(() => update({ pack: loader.status() }));

  // The batter: the one GestureTracker for the camera, whose cues go to whatever the flow plugged in.
  let handlers: Partial<CameraBatterEvents> | null = null;
  let handedness: Handedness = 'right';
  let armedAt = 0;
  let lastSwing: NormalizedSwing | null = null;
  const swingListeners = new Set<(s: NormalizedSwing) => void>();
  const batter = new CameraBatter(
    {
      onSwingStart: (t, p, f) => handlers?.onSwingStart?.(t, p, f),
      onIntent: (i) => handlers?.onIntent?.(i),
      onCancel: () => handlers?.onCancel?.(),
      onContactState: (s) => handlers?.onContactState?.(s),
      onGesture: (g: GestureInput) => {
        handlers?.onGesture?.(g);
        if (swingListeners.size || HOOKS) {
          const cal = opts.calibrationMs?.() ?? 0;
          const swing = normalizeGesture(g, {
            releasePerfMs: armedAt,
            calibrationMs: cal,
            calibrations: { camera: cal },
            handedness,
          });
          lastSwing = swing;
          if (swing) for (const cb of [...swingListeners]) cb(swing);
        }
      },
      onStatus: (s: CameraBatterStatus) => update({ readiness: s.readiness, lost: s.lost }),
    },
    { sourceMirrored: false, now: clock },
  );
  const bat: CameraBat = {
    setHandlers: (h) => void (handlers = h),
    setEnabled: (on, at) => {
      if (on) armedAt = at ?? clock();
      batter.setEnabled(on, at);
    },
    rearm: (at) => {
      armedAt = at ?? clock();
      batter.rearm(at);
    },
    setHandedness: (h) => {
      handedness = h;
      batter.setHandedness(h);
    },
  };

  // Pipeline state.
  let stream: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;
  let worker: WorkerLike | null = null;
  let stopFrames: (() => void) | null = null;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  let frameId = 0;
  let lastT = Number.NEGATIVE_INFINITY;
  let delegate: Delegate | null = null;
  const counters = { delivered: 0, processed: 0, dropped: 0 };
  const infer = new Ring(240);
  const pipeline = new Ring(240);
  const times = new Ring(60);
  let dark = 0;
  let sessionToken = 0;
  /** A caller that names GPU or CPU forces it; 'auto' (or nothing) is the default choice, so the speed check applies. */
  const forcedDelegate = opts.delegate === 'GPU' || opts.delegate === 'CPU' ? opts.delegate : undefined;
  let switchedToCpu = false;
  /** A GPU engine was too slow on this device once: later starts ask for the CPU engine directly. */
  let preferCpu = false;
  /** Resolves the wait in start() for the engine choice (the GPU engine kept, or the CPU engine running), and its 6 s ceiling. */
  let settleChoice: (() => void) | null = null;
  let choiceTimer: ReturnType<typeof setTimeout> | null = null;
  /** TEST BUILDS ONLY: a pose trace is being played in (see the `inject` hook); worker results are dropped meanwhile. */
  let injecting = false;

  const api: CaptureApi = opts.api ?? {
    getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
    enumerateDevices: () => navigator.mediaDevices.enumerateDevices(),
  };

  function unavailable(): CameraProblem | null {
    if (!info) return 'unsupported';
    if (typeof window !== 'undefined' && window.isSecureContext === false) return 'insecure';
    if (!opts.api && (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia)) return 'unsupported';
    if (typeof Worker === 'undefined' && !opts.createWorker) return 'unsupported';
    if (!canUnpack() && !opts.createWorker) return 'unsupported';
    try {
      if (typeof WebAssembly === 'undefined' || !WebAssembly.validate(SIMD_PROBE)) return 'unsupported';
    } catch {
      return 'unsupported';
    }
    return null;
  }

  function choiceFinal() {
    if (choiceTimer !== null) clearTimeout(choiceTimer);
    choiceTimer = null;
    const done = settleChoice;
    settleChoice = null;
    done?.();
  }

  function teardown() {
    choiceFinal();
    stopFrames?.();
    stopFrames = null;
    if (watchdog !== null) clearInterval(watchdog);
    watchdog = null;
    worker?.terminate();
    worker = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video = null;
    inFlight = false;
    delegate = null;
    dark = 0;
    batter.setEnabled(false);
  }

  function fail(e: unknown): never {
    const problem: CameraProblem =
      e instanceof PackError || e instanceof CaptureError
        ? e.problem
        : ((e as { problem?: CameraProblem })?.problem ?? problemOf(e));
    teardown();
    update({ stage: 'failed', problem, pack: loader?.status() ?? emptyPack });
    const err = new Error(e instanceof Error ? e.message : String(e)) as Error & { problem: CameraProblem };
    err.problem = problem;
    throw err;
  }

  function onPose(m: Extract<FromWorker, { type: 'pose' }>, token: number) {
    if (token !== sessionToken) return;
    inFlight = false;
    if (injecting) return;
    counters.processed++;
    infer.push(m.inferMs);
    const now = clock();
    pipeline.push(now - m.t);
    times.push(m.t);
    if (m.luma !== undefined) {
      dark = m.luma < CAPTURE.blackMean ? dark + 1 : 0;
      batter.setPoorLight(m.luma < CAPTURE.dimMean);
      if (dark >= 2 && status.problem !== 'black') update({ problem: 'black' });
      else if (dark === 0 && status.problem === 'black') update({ problem: null });
    }
    batter.push({ t: m.t, width: m.width, height: m.height, landmarks: m.lm });
    opts.onPose?.(m.lm, m.inferMs);
    // A GPU delegate on a machine with no real GPU (software graphics) can be several times slower than the CPU one: measure
    // the first frames and, once, go to the CPU delegate when the GPU one is too slow (GPU first, CPU as the fallback).
    // Until that choice is final (the GPU engine kept, or the CPU engine running) the session is still 'starting', so no ball is
    // let go in the middle of a swap (CAM-DIAG-1).
    if (delegate === 'GPU' && !switchedToCpu && !forcedDelegate && counters.processed === 30) {
      if (infer.p(50) > SLOW_GPU_MS) {
        switchedToCpu = true;
        preferCpu = true;
        void restartOnCpu(token);
      } else choiceFinal();
    }
    if (status.stage === 'running' && status.problem !== 'black' && processedEnough()) {
      const slow = fps() < CAPTURE.minFps || infer.p(50) > CAPTURE.maxInferenceMsP50;
      if (slow && status.problem !== 'too_slow') update({ problem: 'too_slow' });
      else if (!slow && status.problem === 'too_slow') update({ problem: null });
    }
  }
  const processedEnough = () => counters.processed >= 60 && counters.processed % 15 === 0;
  function fps(): number {
    if (times.length < 10) return 0;
    const span = times.p(100) - times.p(0);
    return span > 0 ? ((times.length - 1) * 1000) / span : 0;
  }

  async function restartOnCpu(token: number) {
    const old = worker;
    worker = null;
    inFlight = false;
    old?.terminate();
    infer.clear();
    times.clear();
    try {
      if (!loader) return;
      const pack = await loader.read();
      if (token !== sessionToken) return;
      await startWorker(pack.worker, pack.engine, pack.model, token, 'CPU');
    } catch (e) {
      if (token === sessionToken) {
        teardown();
        update({ stage: 'failed', problem: (e as { problem?: CameraProblem })?.problem ?? 'engine_failed' });
      }
    } finally {
      choiceFinal();
    }
  }

  async function makeBitmap(v: HTMLVideoElement): Promise<ImageBitmap> {
    if (opts.makeBitmap) return opts.makeBitmap(v);
    return createImageBitmap(v, { resizeWidth: CAPTURE.modelWidth, resizeQuality: 'low' });
  }

  function onFrame(f: FrameInfo) {
    counters.delivered++;
    const t = normalizeFrameTime(f.meta, clock(), lastT);
    lastT = t;
    if (!worker || !video || inFlight || injecting) {
      counters.dropped++;
      return;
    }
    inFlight = true;
    const w = worker;
    const token = sessionToken;
    void makeBitmap(video).then(
      (bitmap) => {
        if (token !== sessionToken || !worker) return bitmap.close?.();
        w.postMessage({ type: 'frame', id: ++frameId, t, bitmap }, [bitmap]);
      },
      () => {
        if (token === sessionToken) inFlight = false;
      },
    );
  }

  async function startWorker(
    code: ArrayBuffer,
    engine: ArrayBuffer,
    model: ArrayBuffer,
    token: number,
    which?: Delegate | 'auto',
  ): Promise<void> {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const w: WorkerLike = opts.createWorker
      ? opts.createWorker(url)
      : (new Worker(url, { type: 'module' }) as unknown as WorkerLike);
    worker = w;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new PackError('engine_failed', 'the pose engine did not start in time')),
        opts.startTimeoutMs ?? 30_000,
      );
      w.onerror = () => {
        clearTimeout(timer);
        reject(new PackError('engine_failed', 'the pose worker failed'));
      };
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready') {
          clearTimeout(timer);
          delegate = m.delegate;
          resolve();
        } else if (m.type === 'error' && m.stage === 'init') {
          clearTimeout(timer);
          reject(new PackError('engine_failed', m.message));
        } else if (m.type === 'pose') onPose(m, token);
        else if (m.type === 'error' && m.fatal) update({ stage: 'failed', problem: 'engine_failed' });
      };
      w.postMessage(
        {
          type: 'init',
          v: CAMERA_PROTOCOL,
          engine,
          model,
          delegate: which ?? forcedDelegate ?? (preferCpu ? 'CPU' : 'auto'),
          confidence: 0.55,
        },
        [engine, model],
      );
    }).finally(() => URL.revokeObjectURL(url));
  }

  async function start(signal?: AbortSignal): Promise<void> {
    if (status.stage === 'running') return;
    const why = unavailable();
    if (why) {
      update({ stage: 'failed', problem: why });
      const err = new Error(`camera unavailable: ${why}`) as Error & { problem: CameraProblem };
      err.problem = why;
      throw err;
    }
    const token = ++sessionToken;
    switchedToCpu = false;
    const onAbort = () => {
      sessionToken++;
      teardown();
      update({ stage: 'idle', problem: null });
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    update({ stage: 'opening', problem: null });
    try {
      const native = opts.nativeAccess === undefined ? nativeCameraAccess() : opts.nativeAccess;
      if (native) {
        const s = await native.getStatus();
        if (!s.hasAnyCamera) throw new CaptureError('none', 'no camera');
        if (s.camera === 'denied') throw new CaptureError('blocked', 'camera permission denied');
        if (s.camera !== 'granted' && (await native.request()).camera !== 'granted')
          throw new CaptureError('blocked', 'camera permission denied');
      }
      const opened = await openCamera(api);
      stream = opened.stream;
      video = opts.makeVideo ? opts.makeVideo() : document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play?.().catch(() => undefined);
      if (token !== sessionToken) return;
      update({ stage: 'loading' });
      if (!loader) throw new PackError('unsupported', 'no camera pack in this build');
      await loader.ensure(signal);
      const pack = await loader.read();
      if (token !== sessionToken) return;
      update({ stage: 'starting' });
      await startWorker(pack.worker, pack.engine, pack.model, token);
      if (token !== sessionToken) return;
      stopFrames = startFrameLoop(video, onFrame);
      watchdog = setInterval(() => batter.tick(clock()), WATCHDOG_MS);
      // GPU first: wait here, still 'starting', for the 30-picture speed check to choose (6 s at most).
      if (delegate === 'GPU' && !forcedDelegate && !switchedToCpu) {
        await new Promise<void>((resolve) => {
          settleChoice = resolve;
          choiceTimer = setTimeout(choiceFinal, CHOICE_CEILING_MS);
        });
        if (token !== sessionToken || status.stage !== 'starting') return;
      }
      update({ stage: 'running' });
    } catch (e) {
      if (token !== sessionToken) return;
      if (e instanceof DOMException && e.name === 'AbortError') {
        teardown();
        update({ stage: 'idle', problem: null });
        return;
      }
      fail(e);
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  function stop() {
    sessionToken++;
    teardown();
    counters.delivered = counters.processed = counters.dropped = 0;
    infer.clear();
    pipeline.clear();
    times.clear();
    update({ stage: 'idle', problem: null, readiness: EMPTY_READINESS, lost: false });
  }

  const session: CameraSession = {
    status: () => status,
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    unavailable,
    packBytes: () => info?.totalBytes ?? 0,
    packCached: async () => (loader ? loader.isCached() : false),
    start,
    stop,
    attachPreview(v) {
      if (stream) {
        v.srcObject = stream;
        v.muted = true;
        v.playsInline = true;
        void v.play?.().catch(() => undefined);
      }
      return () => {
        if (v.srcObject === stream) v.srcObject = null;
      };
    },
    permission: async () => {
      const n = opts.nativeAccess === undefined ? nativeCameraAccess() : opts.nativeAccess;
      if (!n) return null;
      const s = await n.getStatus();
      return s.camera === 'prompt-with-rationale' ? 'prompt' : s.camera;
    },
    openSettings: async () =>
      void (await (opts.nativeAccess === undefined ? nativeCameraAccess() : opts.nativeAccess)?.openSettings()),
    onSwing(cb) {
      swingListeners.add(cb);
      return () => swingListeners.delete(cb);
    },
    bat,
    stats: () => ({
      ...counters,
      delegate,
      inferenceMs: { p50: infer.p(50), p95: infer.p(95), p99: infer.p(99) },
      fps: fps(),
      pipelineMs: { p50: pipeline.p(50), p95: pipeline.p(95) },
    }),
  };

  if (HOOKS && typeof window !== 'undefined') {
    const hooks: Record<string, unknown> = {};
    const get = (k: string, f: () => unknown) => Object.defineProperty(hooks, k, { get: f, enumerable: true });
    get('status', () =>
      status.stage === 'failed'
        ? 'error'
        : status.stage === 'loading'
          ? 'loading_pack'
          : status.lost && status.stage === 'running'
            ? 'lost'
            : status.stage,
    );
    get('problem', () => status.problem);
    get('readiness', () => status.readiness);
    get('frames', () => ({ ...counters }));
    get('delegate', () => delegate);
    get('inferenceMs', () => infer.p(50));
    get('lastSwing', () => lastSwing);
    get('packId', () => info?.id ?? null);
    get('injecting', () => injecting);
    // inject(frames, { width, height }): play a recorded or synthetic pose trace into the SAME path a worker result takes (the
    // mapper, the driver's tracker, readiness, lost) while the session is running. dtMs is the time since the previous frame
    // (for the first frame, since the call); a frame's capture time is its scheduled time, so a late timer keeps true spacing.
    // landmarks is flat 33 x [x, y, z, visibility], or null for nobody in the picture. Resolves after the last frame.
    const inject = async (
      frames: ReadonlyArray<{ dtMs: number; landmarks: number[] | null }>,
      o: { width?: number; height?: number } = {},
    ): Promise<void> => {
      if (status.stage !== 'running') throw new Error('the camera session is not running');
      if (injecting) throw new Error('a pose trace is already being played in');
      injecting = true;
      inFlight = false;
      let due = clock();
      try {
        for (const f of frames) {
          due += Math.max(0, f.dtMs);
          const wait = due - clock();
          if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
          if (status.stage !== 'running') break;
          const t = normalizeFrameTime({ captureTime: due }, clock(), lastT);
          lastT = t;
          const lm = f.landmarks ? Float32Array.from(f.landmarks) : null;
          batter.push({ t, width: o.width ?? 640, height: o.height ?? 480, landmarks: lm });
          opts.onPose?.(lm, 0);
        }
      } finally {
        injecting = false;
      }
    };
    Object.defineProperty(hooks, 'inject', { value: inject, enumerable: true });
    window.__vandeCamera = hooks;
  }
  return session;
}
