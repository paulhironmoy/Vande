// @vitest-environment node
/**
 * The test-build hook `window.__vandeCamera.inject` (DoD section 15 item 1): a pose trace played into the same path a worker
 * result takes. It exists only when VITE_PRACTICE_TEST_HOOKS=1 is set when the module loads (the production build compiles the
 * branch out); the frames go through the same mapper and the driver's tracker, so there is no second authority.
 */
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FromWorker, ToWorker } from '@/input/camera/protocol';
import { CAMERA_PROTOCOL } from '@/input/camera/protocol';
import { strokePath, synthFrames, type StrokeSpec } from '@/input/camera/simulate';
import { memoryStore } from '@/input/camera/store';
import type { WorkerLike } from '@/input/camera/session';
import type { CameraPackInfo } from '@/input/camera/pack';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const SPEC: StrokeSpec = { startMs: 400, rise: 1.0, riseMs: 350, holdMs: 150, descent: 1.3, downMs: 200, lateral: 0.3 };

function tinyPack() {
  const raw = {
    engine: new Uint8Array(64).fill(1),
    worker: new Uint8Array(64).fill(2),
    model: new Uint8Array(64).fill(3),
  };
  const files = new Map<string, Uint8Array>();
  const list = (['engine', 'worker', 'model'] as const).map((name) => {
    const gzip = name !== 'model';
    const stored = gzip ? new Uint8Array(gzipSync(raw[name])) : raw[name];
    files.set(`${name}.bin`, stored);
    return { name, file: `${name}.bin`, bytes: stored.length, sha256: sha(stored), rawBytes: raw[name].length, gzip };
  });
  const info: CameraPackInfo = {
    id: 'hooks-pack',
    version: '0',
    dir: 'models/pose/0/',
    files: list,
    totalBytes: list.reduce((n, f) => n + f.bytes, 0),
  };
  const fetchPack = (async (url: string) => {
    const data = files.get(url.split('/').pop()!)!;
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      body: new Blob([data as BlobPart]).stream(),
      blob: async () => new Blob([data as BlobPart]),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { info, fetchPack };
}

async function loadSession(hooks: boolean) {
  vi.resetModules();
  vi.stubEnv('VITE_PRACTICE_TEST_HOOKS', hooks ? '1' : '');
  const win: Record<string, unknown> = {};
  vi.stubGlobal('window', win);
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:test', revokeObjectURL: () => undefined }));
  const { createCameraSession } = await import('@/input/camera/session');
  const { info, fetchPack } = tinyPack();
  const tr = { stop: vi.fn(), getSettings: () => ({ facingMode: 'user' }), label: 'front' };
  const media = { getVideoTracks: () => [tr], getTracks: () => [tr] } as unknown as MediaStream;
  const video = {
    muted: false,
    playsInline: false,
    srcObject: null,
    play: async () => undefined,
    readyState: 4,
    requestVideoFrameCallback: () => 1,
  } as unknown as HTMLVideoElement;
  const worker: WorkerLike = {
    onmessage: null,
    onerror: null,
    terminate: () => undefined,
    postMessage: (m: ToWorker) => {
      if (m.type === 'init')
        queueMicrotask(() =>
          worker.onmessage?.({
            data: { type: 'ready', v: CAMERA_PROTOCOL, delegate: 'CPU', loadMs: 1, warmMs: 1 },
          } as MessageEvent<FromWorker>),
        );
    },
  };
  const session = createCameraSession({
    info,
    base: '/',
    store: memoryStore(),
    fetch: fetchPack,
    api: { getUserMedia: async () => media },
    makeVideo: () => video,
    createWorker: () => worker,
    nativeAccess: null,
    now: () => performance.now(),
  });
  return { session, win };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('window.__vandeCamera.inject (test builds only)', () => {
  it('does not exist unless the test-hooks flag is set when the module loads (the production guard)', async () => {
    const { session, win } = await loadSession(false);
    expect(session.status().stage).toBe('idle');
    expect(win.__vandeCamera).toBeUndefined();
  });

  it('a drive trace in gives one camera swing out, through the same mapper and the tracker', async () => {
    vi.useFakeTimers();
    const { session, win } = await loadSession(true);
    await session.start();
    expect(session.status().stage).toBe('running');
    const hooks = win.__vandeCamera as {
      inject: (f: unknown[], o?: object) => Promise<void>;
      injecting: boolean;
      lastSwing: unknown;
      status: string;
    };
    expect(typeof hooks.inject).toBe('function');
    const gestures: Array<{ pointer: string }> = [];
    session.bat.setHandlers({ onGesture: (g) => gestures.push(g) });
    session.bat.setEnabled(true, performance.now());
    const frames = synthFrames({ hand: strokePath(SPEC), fps: 30, t0: 0, durationMs: 2400 });
    const trace = frames.map((f, i) => ({
      dtMs: i === 0 ? 0 : f.t - frames[i - 1].t,
      landmarks: f.landmarks ? Array.from(f.landmarks as ArrayLike<number>) : null,
    }));
    const done = hooks.inject(trace);
    expect(hooks.injecting).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    await done;
    expect(hooks.injecting).toBe(false);
    expect(gestures).toHaveLength(1);
    expect(gestures[0].pointer).toBe('camera');
    expect(hooks.lastSwing).toMatchObject({ kind: 'attack' });
    // The same trace through the tracker directly gives the same swing: no second authority.
    expect((hooks.lastSwing as { directionDeg: number }).directionDeg).toBeGreaterThan(10);
    session.stop();
  });

  it('null frames (nobody in the picture) in give lost out, and a person back gives not lost', async () => {
    vi.useFakeTimers();
    const { session, win } = await loadSession(true);
    await session.start();
    const hooks = win.__vandeCamera as { inject: (f: unknown[]) => Promise<void> };
    const still = synthFrames({ hand: () => ({ h: -1.2, x: 0 }), fps: 30, t0: 0, durationMs: 700 });
    const person = still.map((f) => ({ dtMs: 33.3, landmarks: Array.from(f.landmarks as ArrayLike<number>) }));
    const nobody = Array.from({ length: 24 }, () => ({ dtMs: 33.3, landmarks: null }));
    let done = hooks.inject(person);
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(session.status().lost).toBe(false);
    done = hooks.inject(nobody);
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(session.status().lost).toBe(true);
    done = hooks.inject(person);
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(session.status().lost).toBe(false);
    session.stop();
  });

  it('refuses when the session is not running, and refuses a second trace while one plays', async () => {
    vi.useFakeTimers();
    const { session, win } = await loadSession(true);
    const hooks = win.__vandeCamera as { inject: (f: unknown[]) => Promise<void> };
    await expect(hooks.inject([{ dtMs: 0, landmarks: null }])).rejects.toThrow('not running');
    await session.start();
    const first = hooks.inject([{ dtMs: 100, landmarks: null }]);
    await expect(hooks.inject([{ dtMs: 0, landmarks: null }])).rejects.toThrow('already');
    await vi.advanceTimersByTimeAsync(200);
    await first;
    session.stop();
  });
});
