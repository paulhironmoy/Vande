/**
 * The pose worker: MediaPipe Tasks Vision (Pose Landmarker Lite) in a module Web Worker, started by the page from a blob: URL
 * made of this file's bundle (docs/PRACTICE_CAMERA_INPUT.md §1). It never fetches anything: the page hands it the WASM engine
 * and the model as bytes. The engine's loader is imported statically (it sets `globalThis.ModuleFactory`), the engine is told
 * to use it with an empty `wasmLoaderPath`, and Emscripten gets `wasmBinary` from `self.Module`; MediaPipe clears both after
 * every creation, so they are set again before each attempt. This depends on internals of the pinned engine (0.10.35).
 */
import { PoseLandmarker } from '@mediapipe/tasks-vision';
import ModuleFactory from '@mediapipe/tasks-vision/vision_wasm_module_internal.js';
import { createPoseHost, type PoseEngine, type PoseKit } from './host';
import type { Delegate, FromWorker, ToWorker } from './protocol';

const scope = self as unknown as {
  postMessage(m: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  ModuleFactory?: unknown;
  Module?: unknown;
};

let lumaCanvas: OffscreenCanvas | null = null;

const kit: PoseKit = {
  now: () => performance.now(),
  async create(delegate: Delegate, engine: ArrayBuffer, model: ArrayBuffer, confidence: number): Promise<PoseEngine> {
    scope.ModuleFactory = ModuleFactory;
    scope.Module = { wasmBinary: new Uint8Array(engine) };
    const landmarker = await PoseLandmarker.createFromOptions(
      { wasmLoaderPath: '', wasmBinaryPath: 'vision_wasm_module_internal.wasm' },
      {
        baseOptions: { modelAssetBuffer: new Uint8Array(model), delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: confidence,
        minPosePresenceConfidence: confidence,
        minTrackingConfidence: confidence,
        outputSegmentationMasks: false,
      },
    );
    return {
      detect: (image, ts) => landmarker.detectForVideo(image, ts).landmarks,
      luma(image) {
        lumaCanvas ??= new OffscreenCanvas(16, 12);
        const ctx = lumaCanvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return 255;
        ctx.drawImage(image, 0, 0, 16, 12);
        const d = ctx.getImageData(0, 0, 16, 12).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        return sum / (d.length / 4);
      },
      close: () => landmarker.close(),
    };
  },
  warm(engine) {
    try {
      const blank = new OffscreenCanvas(64, 64);
      blank.getContext('2d')?.fillRect(0, 0, 64, 64);
      engine.detect(blank.transferToImageBitmap(), 1);
    } catch {
      /* a failed warm-up frame is not a failed start */
    }
  },
};

const host = createPoseHost(kit, (m, transfer) => scope.postMessage(m, transfer));
scope.onmessage = (e) => void host.handle(e.data);
