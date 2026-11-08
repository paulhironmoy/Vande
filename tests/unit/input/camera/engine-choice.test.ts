// @vitest-environment node
/**
 * The camera is not "running" (and so the flow's gate stays closed, and the batter is not armed) until the pose engine has
 * CHOSEN between the GPU and the CPU engine: after the 30th processed picture with the GPU engine kept, or when the CPU engine
 * is running after the swap, or 6 s after the first engine started at the latest (the game never stalls). CAM-DIAG-1: with a slow
 * GPU engine the swap took the pose away for about a second right when the first ball could go live.
 */
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CameraPackInfo } from '@/input/camera/pack';
import { CAMERA_PROTOCOL, type FromWorker, type ToWorker } from '@/input/camera/protocol';
import { createCameraSession, type WorkerLike } from '@/input/camera/session';
import { memoryStore } from '@/input/camera/store';
import { isSteady } from '@/practice/ui/camera/store';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

function tinyPack(): { info: CameraPackInfo; fetchPack: typeof fetch } {
  const raw = {
    engine: new Uint8Array(32).fill(1),
    worker: new Uint8Array(32).fill(2),
    model: new Uint8Array(32).fill(3),
  };
  const files = new Map<string, Uint8Array>();
  const list = (['engine', 'worker', 'model'] as const).map((name) => {
    const gzip = name !== 'model';
    const stored = gzip ? new Uint8Array(gzipSync(raw[name])) : raw[name];
    files.set(`${name}.bin`, stored);
    return { name, file: `${name}.bin`, bytes: stored.length, sha256: sha(stored), rawBytes: raw[name].length, gzip };
  });
  const info: CameraPackInfo = {
    id: 'choice-pack',
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

/**
 * A session with a scripted pose worker: the first engine says GPU and takes `gpuMs` per picture, the next one says CPU and takes
 * 12 ms; `holdCpuReady` keeps the CPU engine's "ready" back until `releaseCpu()` (the swap in progress).
 */
function rig(o: {
  gpuMs: number;
  firstDelegate?: 'GPU' | 'CPU';
  holdCpuReady?: boolean;
  delegateOption?: 'auto' | 'GPU' | 'CPU';
}) {
  const { info, fetchPack } = tinyPack();
  const inits: string[] = [];
  const workers: WorkerLike[] = [];
  const pending: Array<() => void> = [];
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
    const index = workers.length;
    const w: WorkerLike = {
      onmessage: null,
      onerror: null,
      terminate: vi.fn(),
      postMessage(m: ToWorker) {
        queueMicrotask(() => {
          if (m.type === 'init') {
            inits.push(m.delegate);
            const d = index === 0 ? (o.firstDelegate ?? 'GPU') : 'CPU';
            const send = () =>
              w.onmessage?.({
                data: { type: 'ready', v: CAMERA_PROTOCOL, delegate: d, loadMs: 1, warmMs: 1 },
              } as MessageEvent<FromWorker>);
            if (index > 0 && o.holdCpuReady) pending.push(send);
            else send();
          } else if (m.type === 'frame') {
            w.onmessage?.({
              data: {
                type: 'pose',
                id: m.id,
                t: m.t,
                inferMs: index === 0 ? o.gpuMs : 12,
                lm: null,
                width: 640,
                height: 480,
              },
            } as MessageEvent<FromWorker>);
          }
        });
      },
    };
    workers.push(w);
    return w;
  };
  let clock = 0;
  const session = createCameraSession({
    info,
    base: '/',
    store: memoryStore(),
    fetch: fetchPack,
    api: { getUserMedia: async () => media },
    makeVideo: () => video,
    makeBitmap: async () => ({ width: 1, height: 1, close: () => undefined }) as unknown as ImageBitmap,
    createWorker: mk,
    nativeAccess: null,
    now: () => clock,
    delegate: o.delegateOption,
  });
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:test', revokeObjectURL: () => undefined }));
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));
  return {
    session,
    inits,
    workers,
    deliver: async (n: number) => {
      for (let i = 0; i < n; i++) {
        clock += 33;
        frameCb.cb?.(clock, { captureTime: clock });
        await tick();
      }
    },
    /** Waits until the first engine runs and the picture loop has started. */
    firstEngineUp: async () => {
      for (let i = 0; i < 200 && frameCb.cb === null; i++) await tick();
      expect(frameCb.cb).not.toBeNull();
    },
    releaseCpu: async () => {
      for (const send of pending.splice(0)) send();
      await tick();
    },
    tick,
  };
}

/** The flow's gate asks `isSteady` of the camera UI: with a person in frame and steady (no problem, not lost, ready forced on) it opens only when the session stage is 'running'. */
const gateOpen = (session: ReturnType<typeof createCameraSession>): boolean => {
  const st = session.status();
  return isSteady({
    stage: st.stage,
    problem: null,
    lost: false,
    readiness: { ...st.readiness, ready: true },
  } as never);
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the camera is not running until the engine choice is final', () => {
  it('a slow GPU engine: stays starting through the swap, and runs only when the CPU engine runs', async () => {
    const r = rig({ gpuMs: 90, holdCpuReady: true });
    let started = false;
    const p = r.session.start().then(() => (started = true));
    await r.firstEngineUp();
    expect(r.session.status().stage).toBe('starting');
    expect(gateOpen(r.session)).toBe(false);
    await r.deliver(29);
    expect(r.session.status().stage).toBe('starting');
    expect(gateOpen(r.session)).toBe(false);
    await r.deliver(1); // the 30th picture: the GPU engine is too slow, the swap begins
    for (let i = 0; i < 400 && r.inits.length < 2; i++) await r.tick(); // the CPU engine's start message goes out
    expect(r.inits).toEqual(['auto', 'CPU']);
    expect(r.session.status().stage).toBe('starting');
    expect(gateOpen(r.session)).toBe(false);
    expect(started).toBe(false);
    await r.releaseCpu(); // the CPU engine is up
    await p;
    expect(started).toBe(true);
    expect(r.session.status().stage).toBe('running');
    expect(gateOpen(r.session)).toBe(true);
    expect(r.session.stats().delegate).toBe('CPU');
    r.session.stop();
  });

  it('a fast GPU engine: stays starting for 29 pictures and runs right after the 30th, with no swap', async () => {
    const r = rig({ gpuMs: 12 });
    const p = r.session.start();
    await r.firstEngineUp();
    await r.deliver(29);
    expect(r.session.status().stage).toBe('starting');
    expect(gateOpen(r.session)).toBe(false);
    await r.deliver(1);
    await p;
    expect(r.session.status().stage).toBe('running');
    expect(gateOpen(r.session)).toBe(true);
    expect(r.inits).toEqual(['auto']);
    expect(r.session.stats().delegate).toBe('GPU');
    r.session.stop();
  });

  it('a CPU engine from the start, or a forced delegate, runs at once: there is nothing to choose', async () => {
    const a = rig({ gpuMs: 90, firstDelegate: 'CPU' });
    await a.session.start();
    expect(a.session.status().stage).toBe('running');
    a.session.stop();
    const b = rig({ gpuMs: 90, delegateOption: 'GPU' });
    await b.session.start();
    expect(b.session.status().stage).toBe('running');
    b.session.stop();
  });

  it("an explicit 'auto' is the default choice: the same wait, the same swap", async () => {
    const r = rig({ gpuMs: 90, delegateOption: 'auto' });
    const p = r.session.start();
    await r.firstEngineUp();
    await r.deliver(29);
    expect(r.session.status().stage).toBe('starting');
    await r.deliver(5);
    await p;
    expect(r.inits).toEqual(['auto', 'CPU']);
    expect(r.session.status().stage).toBe('running');
    r.session.stop();
  });

  it('the game never stalls: 6 s after the first engine started the camera runs even if no choice was made', async () => {
    vi.useFakeTimers();
    const r = rig({ gpuMs: 90 });
    let started = false;
    const p = r.session.start().then(() => (started = true));
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1);
    expect(r.session.status().stage).toBe('starting');
    await vi.advanceTimersByTimeAsync(5800);
    expect(r.session.status().stage).toBe('starting');
    expect(started).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    await p;
    expect(r.session.status().stage).toBe('running');
    r.session.stop();
  });

  it('stopping while it waits ends the start without a running camera', async () => {
    const r = rig({ gpuMs: 12 });
    const p = r.session.start();
    await r.firstEngineUp();
    await r.deliver(5);
    r.session.stop();
    await p;
    expect(r.session.status().stage).toBe('idle');
  });

  it('after a swap the next start asks for the CPU engine directly and runs at once', async () => {
    const r = rig({ gpuMs: 90 });
    const first = r.session.start();
    await r.firstEngineUp();
    await r.deliver(32);
    await first;
    expect(r.session.status().stage).toBe('running');
    r.session.stop();
    await r.session.start();
    expect(r.inits).toEqual(['auto', 'CPU', 'CPU']);
    expect(r.session.status().stage).toBe('running');
    r.session.stop();
  });
});
