/**
 * The worker's side of the protocol, free of any worker global so it runs in tests as it runs in the worker
 * (./pose.worker.ts only connects it to `self` and to the real MediaPipe engine). Docs/PRACTICE_CAMERA_INPUT.md §1.
 */
import { CAMERA_PROTOCOL, type Delegate, type FromWorker, type ToWorker } from './protocol';
import { LANDMARK_COUNT, LANDMARK_STRIDE } from './types';

/** What the host needs from a pose engine: one detection per picture, with increasing timestamps. */
export interface PoseEngine {
  detect(
    image: ImageBitmap,
    timestampMs: number,
  ): Array<ReadonlyArray<{ x: number; y: number; z: number; visibility?: number }>>;
  /** Mean brightness 0..255 of a small shrink of the picture, when the engine's host can read one (optional). */
  luma?(image: ImageBitmap): number;
  close(): void;
}

export interface PoseKit {
  /** Creates an engine with the given delegate from the unpacked bytes. Rejects when that delegate cannot start. */
  create(delegate: Delegate, engine: ArrayBuffer, model: ArrayBuffer, confidence: number): Promise<PoseEngine>;
  /** One detection on a blank picture so the first real frame is not slow (the model's graph and shaders are built). */
  warm?(engine: PoseEngine): void;
  now(): number;
}

export interface PoseHost {
  handle(msg: ToWorker): Promise<void>;
}

const LUMA_EVERY = 15;
const FATAL_AFTER = 3;
const text = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

export function createPoseHost(kit: PoseKit, post: (m: FromWorker, transfer?: Transferable[]) => void): PoseHost {
  let engine: PoseEngine | null = null;
  let lastTs = 0;
  let frames = 0;
  let failures = 0;

  async function init(msg: Extract<ToWorker, { type: 'init' }>) {
    if (msg.v !== CAMERA_PROTOCOL) {
      post({
        type: 'error',
        stage: 'init',
        message: `protocol ${msg.v} (this worker speaks ${CAMERA_PROTOCOL})`,
        fatal: true,
      });
      return;
    }
    const order: Delegate[] = msg.delegate === 'auto' ? ['GPU', 'CPU'] : [msg.delegate];
    const t0 = kit.now();
    let lastError: unknown = null;
    for (const d of order) {
      try {
        engine = await kit.create(d, msg.engine, msg.model, msg.confidence);
        const t1 = kit.now();
        kit.warm?.(engine);
        post({ type: 'ready', v: CAMERA_PROTOCOL, delegate: d, loadMs: t1 - t0, warmMs: kit.now() - t1 });
        return;
      } catch (e) {
        lastError = e;
        engine = null;
      }
    }
    post({ type: 'error', stage: 'init', message: text(lastError), fatal: true });
  }

  function frame(msg: Extract<ToWorker, { type: 'frame' }>) {
    const bitmap = msg.bitmap;
    const { width, height } = bitmap;
    try {
      if (!engine) throw new Error('not ready');
      lastTs = Math.max(lastTs + 1, Math.round(msg.t));
      const t0 = kit.now();
      const poses = engine.detect(bitmap, lastTs);
      const inferMs = kit.now() - t0;
      const first = poses[0];
      let lm: Float32Array | null = null;
      if (first && first.length >= LANDMARK_COUNT) {
        lm = new Float32Array(LANDMARK_COUNT * LANDMARK_STRIDE);
        for (let i = 0; i < LANDMARK_COUNT; i++) {
          const p = first[i];
          lm[i * 4] = p.x;
          lm[i * 4 + 1] = p.y;
          lm[i * 4 + 2] = p.z;
          lm[i * 4 + 3] = p.visibility ?? 0;
        }
      }
      const luma = frames++ % LUMA_EVERY === 0 ? engine.luma?.(bitmap) : undefined;
      failures = 0;
      post({ type: 'pose', id: msg.id, t: msg.t, inferMs, lm, width, height, luma }, lm ? [lm.buffer] : []);
    } catch (e) {
      failures++;
      post({ type: 'error', stage: 'frame', message: text(e), fatal: failures >= FATAL_AFTER });
      // The page waits for one answer per frame: an empty pose keeps its pipeline moving.
      post({ type: 'pose', id: msg.id, t: msg.t, inferMs: 0, lm: null, width, height });
    } finally {
      bitmap.close?.();
    }
  }

  return {
    async handle(msg) {
      if (msg.type === 'init') await init(msg);
      else if (msg.type === 'frame') frame(msg);
      else {
        engine?.close();
        engine = null;
      }
    },
  };
}
