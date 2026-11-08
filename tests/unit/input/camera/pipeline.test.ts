// @vitest-environment node
/**
 * The camera pipeline around the mapper, with fakes: the worker host and its GPU-to-CPU fallback, the pack loader (progress,
 * stall, retry, tamper, cancel, cache), the capture ladder and the whole session from a tap on "Use camera" to a swing.
 * No real camera, no real model: those are the smoke test's job (scripts/camera/smoke.mjs).
 */
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { CAPTURE_LADDER, CaptureError, openCamera, problemOf } from '@/input/camera/capture';
import { createPoseHost, type PoseEngine, type PoseKit } from '@/input/camera/host';
import { PackError, PackLoader } from '@/input/camera/loader';
import type { CameraPackInfo, PackFile } from '@/input/camera/pack';
import { CAMERA_PROTOCOL, type FromWorker, type ToWorker } from '@/input/camera/protocol';
import { createCameraSession, type WorkerLike } from '@/input/camera/session';
import { strokePath, synthFrames, type StrokeSpec } from '@/input/camera/simulate';
import { memoryStore } from '@/input/camera/store';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const bytes = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);

function makePack(): { info: CameraPackInfo; files: Map<string, Uint8Array>; raw: Record<string, Uint8Array> } {
  const raw = { engine: bytes(3000, 1), worker: bytes(900, 2), model: bytes(2000, 3) };
  const files = new Map<string, Uint8Array>();
  const list: PackFile[] = (['engine', 'worker', 'model'] as const).map((name) => {
    const gzip = name !== 'model';
    const stored = gzip ? new Uint8Array(gzipSync(raw[name])) : raw[name];
    files.set(`${name}.bin`, stored);
    return { name, file: `${name}.bin`, bytes: stored.length, sha256: sha(stored), rawBytes: raw[name].length, gzip };
  });
  return {
    info: {
      id: 'test-pack-01',
      version: '0.0.0',
      dir: 'models/pose/0.0.0/',
      files: list,
      totalBytes: list.reduce((n, f) => n + f.bytes, 0),
    },
    files,
    raw,
  };
}

/** A fetch that streams a file in chunks; `behave` can stall, fail or corrupt a request. */
function fakeFetch(
  pack: ReturnType<typeof makePack>,
  behave: (n: number, file: string) => 'ok' | 'stall' | 'fail' | 'corrupt' = () => 'ok',
) {
  const calls: string[] = [];
  const f = (async (url: string, init?: { signal?: AbortSignal }) => {
    const file = url.split('/').pop()!;
    calls.push(file);
    const how = behave(calls.length, file);
    if (how === 'fail') throw new TypeError('network down');
    const data = new Uint8Array(pack.files.get(file)!);
    if (how === 'corrupt') data[data.length >> 1] ^= 0xff;
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(c) {
        if (how === 'stall' && i > 0) {
          await new Promise<void>((_, reject) =>
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
          );
        }
        if (i >= data.length) return c.close();
        c.enqueue(data.slice(i, i + 700));
        i += 700;
      },
    });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      body: stream,
      blob: async () => new Blob([data]),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('worker host', () => {
  const lm = Array.from({ length: 33 }, (_, i) => ({ x: i / 40, y: 0.5, z: 0, visibility: 0.9 }));
  const bitmap = (): ImageBitmap => ({ width: 384, height: 288, close: vi.fn() }) as unknown as ImageBitmap;
  const engine = (): PoseEngine => ({ detect: vi.fn(() => [lm]), close: vi.fn() });
  const init = (delegate: 'auto' | 'GPU' | 'CPU' = 'auto'): ToWorker => ({
    type: 'init',
    v: CAMERA_PROTOCOL,
    engine: new ArrayBuffer(1),
    model: new ArrayBuffer(1),
    delegate,
    confidence: 0.55,
  });

  it('tries the GPU delegate and falls back to the CPU one, and says which it chose', async () => {
    const out: FromWorker[] = [];
    const tried: string[] = [];
    const kit: PoseKit = {
      now: () => 0,
      create: async (d) => {
        tried.push(d);
        if (d === 'GPU') throw new Error('no WebGL2 in the worker');
        return engine();
      },
    };
    await createPoseHost(kit, (m) => out.push(m)).handle(init());
    expect(tried).toEqual(['GPU', 'CPU']);
    expect(out[0]).toMatchObject({ type: 'ready', delegate: 'CPU', v: CAMERA_PROTOCOL });
  });

  it('refuses a page that speaks another protocol, and reports a failed start as fatal', async () => {
    const out: FromWorker[] = [];
    const host = createPoseHost({ now: () => 0, create: async () => engine() }, (m) => out.push(m));
    await host.handle({ ...(init() as Extract<ToWorker, { type: 'init' }>), v: 99 });
    expect(out[0]).toMatchObject({ type: 'error', stage: 'init', fatal: true });
    const bad: FromWorker[] = [];
    await createPoseHost({ now: () => 0, create: async () => Promise.reject(new Error('nope')) }, (m) =>
      bad.push(m),
    ).handle(init('CPU'));
    expect(bad[0]).toMatchObject({ type: 'error', fatal: true });
  });

  it('answers every frame once, with strictly increasing engine timestamps, closes the picture, and returns numbers only', async () => {
    const out: FromWorker[] = [];
    const e = engine();
    const host = createPoseHost(
      {
        now: (() => {
          let t = 0;
          return () => (t += 7);
        })(),
        create: async () => e,
      },
      (m) => out.push(m),
    );
    await host.handle(init('CPU'));
    const b1 = bitmap();
    const b2 = bitmap();
    await host.handle({ type: 'frame', id: 1, t: 100.2, bitmap: b1 });
    await host.handle({ type: 'frame', id: 2, t: 100.4, bitmap: b2 });
    const poses = out.filter((m): m is Extract<FromWorker, { type: 'pose' }> => m.type === 'pose');
    expect(poses.map((p) => p.id)).toEqual([1, 2]);
    expect(poses[0].t).toBe(100.2);
    expect(poses[0].lm).toBeInstanceOf(Float32Array);
    expect(poses[0].lm?.length).toBe(132);
    expect(poses[0].inferMs).toBe(7);
    const ts = (e.detect as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1] as number);
    expect(ts[1]).toBeGreaterThan(ts[0]);
    expect(b1.close).toHaveBeenCalled();
    expect(b2.close).toHaveBeenCalled();
  });

  it('keeps the pipeline moving when a frame fails, and gives up after three in a row', async () => {
    const out: FromWorker[] = [];
    const e: PoseEngine = {
      detect: () => {
        throw new Error('boom');
      },
      close: vi.fn(),
    };
    const host = createPoseHost({ now: () => 0, create: async () => e }, (m) => out.push(m));
    await host.handle(init('CPU'));
    for (let i = 1; i <= 3; i++) await host.handle({ type: 'frame', id: i, t: i, bitmap: bitmap() });
    expect(out.filter((m) => m.type === 'pose')).toHaveLength(3);
    expect(out.filter((m) => m.type === 'error' && m.fatal)).toHaveLength(1);
  });
});

describe('pack loader', () => {
  const setup = (
    behave?: Parameters<typeof fakeFetch>[1],
    o: { stallMs?: number; online?: boolean; free?: number | null } = {},
  ) => {
    const pack = makePack();
    const net = fakeFetch(pack, behave);
    const store = memoryStore();
    const loader = new PackLoader({
      info: pack.info,
      base: '/',
      store,
      fetch: net.f,
      stallMs: o.stallMs ?? 200,
      online: () => o.online ?? true,
      freeBytes: async () => o.free ?? null,
    });
    return { pack, net, store, loader };
  };

  it('downloads once with exact progress, stores verified files, and then costs 0 bytes', async () => {
    const { pack, net, store, loader } = setup();
    expect(await loader.isCached()).toBe(false);
    const seen: number[] = [];
    loader.subscribe(() => seen.push(loader.status().bytesDone));
    await loader.ensure();
    expect(loader.status()).toMatchObject({
      state: 'cached',
      bytesDone: pack.info.totalBytes,
      bytesTotal: pack.info.totalBytes,
    });
    expect(seen.some((n) => n > 0 && n < pack.info.totalBytes)).toBe(true);
    expect(Math.max(...seen)).toBe(pack.info.totalBytes);
    expect(net.calls).toEqual(['engine.bin', 'worker.bin', 'model.bin']);
    expect(store.map.size).toBe(3);
    await loader.ensure();
    expect(net.calls).toHaveLength(3);
    expect(await loader.isCached()).toBe(true);
    const unpacked = await loader.read();
    expect(new Uint8Array(unpacked.engine)).toEqual(pack.raw.engine);
    expect(new Uint8Array(unpacked.worker)).toEqual(pack.raw.worker);
    expect(new Uint8Array(unpacked.model)).toEqual(pack.raw.model);
  });

  it('refuses a tampered file after the retry and keeps nothing', async () => {
    const { net, store, loader } = setup((_n, file) => (file === 'engine.bin' ? 'corrupt' : 'ok'));
    await expect(loader.ensure()).rejects.toMatchObject({ name: 'PackError', problem: 'verify_failed' });
    expect(net.calls.filter((f) => f === 'engine.bin')).toHaveLength(2);
    expect(store.map.size).toBe(0);
    expect(loader.status().state).toBe('absent');
  });

  it('retries once after a stall or a network failure and then succeeds', async () => {
    const stalled = setup((n) => (n === 1 ? 'stall' : 'ok'), { stallMs: 60 });
    const states: string[] = [];
    stalled.loader.subscribe(() => states.push(stalled.loader.status().state));
    await stalled.loader.ensure();
    expect(states).toContain('stalled');
    expect(states).toContain('retrying');
    expect(stalled.loader.status().state).toBe('cached');
    const failed = setup((n) => (n === 1 ? 'fail' : 'ok'));
    await failed.loader.ensure();
    expect(failed.loader.status().state).toBe('cached');
  });

  it('gives up with a calm problem when both attempts fail, when offline, and when there is no room', async () => {
    await expect(setup(() => 'fail').loader.ensure()).rejects.toMatchObject({ problem: 'download_failed' });
    await expect(setup(undefined, { online: false }).loader.ensure()).rejects.toBeInstanceOf(PackError);
    await expect(setup(undefined, { online: false }).loader.ensure()).rejects.toMatchObject({ problem: 'offline' });
    await expect(setup(undefined, { free: 10 }).loader.ensure()).rejects.toMatchObject({ problem: 'space' });
  });

  it('cancels on request without keeping a partial file, and drops entries of older pack ids', async () => {
    const { store, loader, net } = setup((n) => (n === 1 ? 'stall' : 'ok'), { stallMs: 5000 });
    store.map.set('old-pack/engine', new Blob([new Uint8Array(4)]));
    const ctl = new AbortController();
    const run = loader.ensure(ctl.signal);
    await new Promise((r) => setTimeout(r, 30));
    ctl.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(net.calls).toHaveLength(1);
    expect([...store.map.keys()].some((k) => k.startsWith('test-pack-01/'))).toBe(false);
    expect(store.map.has('old-pack/engine')).toBe(false);
  });

  it('a bundled build reads same-origin files every time and never touches storage', async () => {
    const pack = makePack();
    const net = fakeFetch(pack);
    const loader = new PackLoader({ info: pack.info, base: '/', store: null, bundled: true, fetch: net.f });
    await loader.ensure();
    expect(net.calls).toHaveLength(0);
    expect(await loader.isCached()).toBe(true);
    const unpacked = await loader.read();
    expect(new Uint8Array(unpacked.model)).toEqual(pack.raw.model);
  });
});

describe('capture', () => {
  const track = (facingMode?: string, label = 'cam') => ({ getSettings: () => ({ facingMode }), label, stop: vi.fn() });
  const stream = (t: ReturnType<typeof track>) =>
    ({ getVideoTracks: () => [t], getTracks: () => [t] }) as unknown as MediaStream;
  const err = (name: string) => Object.assign(new Error(name), { name });

  it('steps down the ladder when a camera rejects the request, and never asks for audio or an exact camera', async () => {
    const asked: MediaStreamConstraints[] = [];
    const t = track('user');
    const opened = await openCamera({
      getUserMedia: async (c) => {
        asked.push(c);
        if (asked.length < 3) throw err('OverconstrainedError');
        return stream(t);
      },
    });
    expect(opened.rung).toBe(2);
    expect(asked).toEqual(CAPTURE_LADDER.slice(0, 3));
    for (const c of CAPTURE_LADDER) expect(c.audio).toBe(false);
    expect(JSON.stringify(CAPTURE_LADDER)).not.toContain('exact');
  });

  it('skips a rear camera for a front one, and stops when only a rear one exists', async () => {
    const rear = track('environment', 'back camera');
    const front = track('user', 'front camera');
    let n = 0;
    const ok = await openCamera({
      getUserMedia: async () => stream(n++ === 0 ? rear : front),
      enumerateDevices: async () =>
        [
          { kind: 'videoinput', deviceId: 'b', label: 'back camera' },
          { kind: 'videoinput', deviceId: 'f', label: 'front camera' },
        ] as MediaDeviceInfo[],
    });
    expect(ok.settings.facingMode).toBe('user');
    expect(rear.stop).toHaveBeenCalled();
    await expect(
      openCamera({ getUserMedia: async () => stream(track('environment', 'back')), enumerateDevices: async () => [] }),
    ).rejects.toMatchObject({ problem: 'rear_only' });
  });

  it('names every failure in the words the UI has copy for', async () => {
    expect(problemOf(err('NotAllowedError'))).toBe('blocked');
    expect(problemOf(err('NotFoundError'))).toBe('none');
    expect(problemOf(err('NotReadableError'))).toBe('busy');
    expect(problemOf(err('SomethingElse'))).toBe('unsupported');
    await expect(
      openCamera({ getUserMedia: async () => Promise.reject(err('NotAllowedError')) }),
    ).rejects.toBeInstanceOf(CaptureError);
    await expect(
      openCamera({ getUserMedia: async () => Promise.reject(err('NotReadableError')) }),
    ).rejects.toMatchObject({ problem: 'busy' });
  });
});

describe('session: from the tap to a swing', () => {
  const SPEC: StrokeSpec = {
    startMs: 400,
    rise: 1.0,
    riseMs: 350,
    holdMs: 150,
    descent: 1.3,
    downMs: 200,
    lateral: 0.3,
  };

  function rig() {
    const pack = makePack();
    const net = fakeFetch(pack);
    const frames = synthFrames({ hand: strokePath(SPEC), fps: 30, t0: 0, durationMs: 2400 });
    const byT = new Map(frames.map((f) => [Math.round(f.t * 10), f]));
    let clockMs = 0;
    const tr = { stop: vi.fn(), getSettings: () => ({ facingMode: 'user' }), label: 'front', readyState: 'live' };
    const media = { getVideoTracks: () => [tr], getTracks: () => [tr] } as unknown as MediaStream;
    let rvfc: ((now: number, meta: { captureTime: number }) => void) | null = null;
    const video = {
      muted: false,
      playsInline: false,
      srcObject: null,
      play: async () => undefined,
      readyState: 4,
      requestVideoFrameCallback: (cb: typeof rvfc) => {
        rvfc = cb;
        return 1;
      },
    } as unknown as HTMLVideoElement;
    const worker: WorkerLike & { sent: ToWorker[] } = {
      sent: [],
      onmessage: null,
      onerror: null,
      terminate: vi.fn(),
      postMessage(m) {
        worker.sent.push(m);
        queueMicrotask(() => {
          if (m.type === 'init')
            worker.onmessage?.({
              data: { type: 'ready', v: CAMERA_PROTOCOL, delegate: 'CPU', loadMs: 5, warmMs: 1 },
            } as MessageEvent<FromWorker>);
          else if (m.type === 'frame') {
            const f = byT.get(Math.round(m.t * 10));
            worker.onmessage?.({
              data: {
                type: 'pose',
                id: m.id,
                t: m.t,
                inferMs: 9,
                lm: f?.landmarks ? Float32Array.from(f.landmarks as ArrayLike<number>) : null,
                width: 640,
                height: 480,
              },
            } as MessageEvent<FromWorker>);
          }
        });
      },
    };
    const session = createCameraSession({
      info: pack.info,
      base: '/',
      store: memoryStore(),
      fetch: net.f,
      api: { getUserMedia: async () => media },
      makeVideo: () => video,
      makeBitmap: async () => ({ width: 384, height: 288, close: () => undefined }) as unknown as ImageBitmap,
      createWorker: () => worker,
      nativeAccess: null,
      now: () => clockMs,
    });
    // jsdom-free blob URLs: the session only needs these two functions.
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:test', revokeObjectURL: () => undefined }));
    const deliver = async (upToMs: number) => {
      for (const f of frames) {
        if (f.t > upToMs) break;
        clockMs = f.t;
        rvfc?.(f.t, { captureTime: f.t });
        await new Promise((r) => setTimeout(r, 0));
      }
    };
    return { session, pack, worker, tr, deliver, net, setClock: (t: number) => (clockMs = t) };
  }

  it('goes idle, opening, loading, starting, running; downloads once; and a stroke becomes one camera swing', async () => {
    const { session, worker, tr, deliver, net, setClock } = rig();
    expect(session.status().stage).toBe('idle');
    const stages: string[] = [];
    const orig = session.status;
    void orig;
    session.subscribe(() => stages.push(session.status().stage));
    expect(await session.packCached()).toBe(false);
    expect(session.unavailable()).toBeNull();
    await session.start();
    expect(session.status().stage).toBe('running');
    expect(await session.packCached()).toBe(true);
    expect(net.calls).toEqual(['engine.bin', 'worker.bin', 'model.bin']);
    const init = worker.sent[0] as Extract<ToWorker, { type: 'init' }>;
    expect(init.delegate).toBe('auto');
    expect(init.engine.byteLength).toBe(3000);
    expect(init.model.byteLength).toBe(2000);

    const swings: unknown[] = [];
    const gestures: Array<{ pointer: string }> = [];
    session.onSwing((s) => swings.push(s));
    session.bat.setHandlers({ onGesture: (g) => gestures.push(g) });
    setClock(0);
    session.bat.setEnabled(true, 0);
    await deliver(2400);
    expect(gestures).toHaveLength(1);
    expect(gestures[0].pointer).toBe('camera');
    expect(swings).toHaveLength(1);
    expect(session.stats()).toMatchObject({ delegate: 'CPU' });
    expect(session.stats().processed).toBeGreaterThan(40);
    expect(session.stats().inferenceMs.p50).toBe(9);

    session.stop();
    expect(tr.stop).toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalled();
    expect(session.status().stage).toBe('idle');
    session.stop();
    expect(session.status().stage).toBe('idle');
  });

  it('goes from a slow GPU delegate to the CPU one once, after the first 30 frames', async () => {
    const pack = makePack();
    const net = fakeFetch(pack);
    const inits: Array<{ delegate: string }> = [];
    const frameCb: { cb: ((now: number, meta: { captureTime: number }) => void) | null } = { cb: null };
    const video = {
      muted: false,
      playsInline: false,
      srcObject: null,
      play: async () => undefined,
      readyState: 4,
      requestVideoFrameCallback: (cb: NonNullable<(typeof frameCb)['cb']>) => {
        frameCb.cb = cb;
        return 1;
      },
    } as unknown as HTMLVideoElement;
    const tr = { stop: vi.fn(), getSettings: () => ({ facingMode: 'user' }), label: 'front' };
    const media = { getVideoTracks: () => [tr], getTracks: () => [tr] } as unknown as MediaStream;
    const mk = (): WorkerLike => {
      const w: WorkerLike = {
        onmessage: null,
        onerror: null,
        terminate: vi.fn(),
        postMessage(m) {
          queueMicrotask(() => {
            if (m.type === 'init') {
              inits.push({ delegate: m.delegate });
              const d = inits.length === 1 ? 'GPU' : 'CPU';
              w.onmessage?.({
                data: { type: 'ready', v: CAMERA_PROTOCOL, delegate: d, loadMs: 1, warmMs: 1 },
              } as MessageEvent<FromWorker>);
            } else if (m.type === 'frame') {
              w.onmessage?.({
                data: {
                  type: 'pose',
                  id: m.id,
                  t: m.t,
                  inferMs: inits.length === 1 ? 90 : 12,
                  lm: null,
                  width: 640,
                  height: 480,
                },
              } as MessageEvent<FromWorker>);
            }
          });
        },
      };
      return w;
    };
    let clock = 0;
    const session = createCameraSession({
      info: pack.info,
      base: '/',
      store: memoryStore(),
      fetch: net.f,
      api: { getUserMedia: async () => media },
      makeVideo: () => video,
      makeBitmap: async () => ({ width: 1, height: 1, close: () => undefined }) as unknown as ImageBitmap,
      createWorker: mk,
      nativeAccess: null,
      now: () => clock,
    });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:test', revokeObjectURL: () => undefined }));
    // start() waits for the GPU-or-CPU choice (the 30th picture), so the pictures arrive while it waits (engine-choice.test.ts).
    const started = session.start();
    for (let i = 0; i < 200 && frameCb.cb === null; i++) await new Promise((r) => setTimeout(r, 0));
    expect(session.stats().delegate).toBe('GPU');
    for (let i = 0; i < 80; i++) {
      clock += 33;
      frameCb.cb?.(clock, { captureTime: clock });
      await new Promise((r) => setTimeout(r, 0));
    }
    await started;
    expect(inits.map((i) => i.delegate)).toEqual(['auto', 'CPU']);
    expect(session.stats().delegate).toBe('CPU');
    expect(session.status().stage).toBe('running');
    session.stop();
  });

  it('a camera that is blocked fails fast, before the pack is downloaded, and the failure names the problem', async () => {
    const pack = makePack();
    const net = fakeFetch(pack);
    const session = createCameraSession({
      info: pack.info,
      store: memoryStore(),
      fetch: net.f,
      api: { getUserMedia: async () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })) },
      createWorker: () => ({
        postMessage: () => undefined,
        terminate: () => undefined,
        onmessage: null,
        onerror: null,
      }),
      nativeAccess: null,
    });
    await expect(session.start()).rejects.toMatchObject({ problem: 'blocked' });
    expect(net.calls).toHaveLength(0);
    expect(session.status()).toMatchObject({ stage: 'failed', problem: 'blocked' });
  });

  it('is unavailable where the build has no pack', () => {
    const session = createCameraSession({ info: null, store: memoryStore() });
    expect(session.unavailable()).toBe('unsupported');
    expect(session.packBytes()).toBe(0);
  });
});

describe('session: the Android permission helper (VandeCameraAccess)', () => {
  const parts = () => {
    const pack = makePack();
    const net = fakeFetch(pack);
    const asked: string[] = [];
    const tr = { stop: vi.fn(), getSettings: () => ({ facingMode: 'user' }), label: 'front' };
    const media = { getVideoTracks: () => [tr], getTracks: () => [tr] } as unknown as MediaStream;
    const gum = vi.fn(async () => media);
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
      postMessage: (m) => {
        if (m.type === 'init')
          queueMicrotask(() =>
            worker.onmessage?.({
              data: { type: 'ready', v: CAMERA_PROTOCOL, delegate: 'CPU', loadMs: 1, warmMs: 1 },
            } as MessageEvent<FromWorker>),
          );
      },
    };
    const make = (
      nativeAccess: Parameters<typeof createCameraSession>[0] extends infer O
        ? O extends { nativeAccess?: infer N }
          ? N
          : never
        : never,
    ) => {
      vi.stubGlobal(
        'URL',
        Object.assign(URL, { createObjectURL: () => 'blob:test', revokeObjectURL: () => undefined }),
      );
      return createCameraSession({
        info: pack.info,
        base: '/',
        store: memoryStore(),
        fetch: net.f,
        api: { getUserMedia: gum },
        makeVideo: () => video,
        createWorker: () => worker,
        nativeAccess,
      });
    };
    return { make, gum, asked, net };
  };

  it('a permission that is denied for good stops before the camera and before the download, with the blocked problem', async () => {
    const { make, gum, net } = parts();
    const s = make({
      getStatus: async () => ({ camera: 'denied', hasFrontCamera: true, hasAnyCamera: true }),
      request: async () => ({ camera: 'denied' }),
      openSettings: async () => ({ opened: true }),
    });
    await expect(s.start()).rejects.toMatchObject({ problem: 'blocked' });
    expect(gum).not.toHaveBeenCalled();
    expect(net.calls).toHaveLength(0);
    expect(await s.permission?.()).toBe('denied');
  });

  it('asks once when the system can still ask, and goes on when the player allows it', async () => {
    const { make, gum } = parts();
    const request = vi.fn(async () => ({ camera: 'granted' as const }));
    const s = make({
      getStatus: async () => ({ camera: 'prompt-with-rationale', hasFrontCamera: true, hasAnyCamera: true }),
      request,
      openSettings: async () => ({ opened: true }),
    });
    await s.start();
    expect(request).toHaveBeenCalledTimes(1);
    expect(gum).toHaveBeenCalled();
    expect(s.status().stage).toBe('running');
    expect(await s.permission?.()).toBe('prompt');
    s.stop();
  });

  it('a phone with no camera fails as none, and opening the settings is passed through', async () => {
    const { make } = parts();
    const openSettings = vi.fn(async () => ({ opened: true }));
    const s = make({
      getStatus: async () => ({ camera: 'granted', hasFrontCamera: false, hasAnyCamera: false }),
      request: async () => ({ camera: 'granted' }),
      openSettings,
    });
    await expect(s.start()).rejects.toMatchObject({ problem: 'none' });
    await s.openSettings?.();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });
});
