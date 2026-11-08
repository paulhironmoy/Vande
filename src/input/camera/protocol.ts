/**
 * The pose worker's messages (docs/PRACTICE_CAMERA_INPUT.md §1). Versioned: a worker and a page that disagree on
 * CAMERA_PROTOCOL refuse each other. No frame ever travels back: the worker returns landmarks (numbers) and durations only,
 * never timestamps of its own (its performance.now() has another origin than the page's).
 */
export const CAMERA_PROTOCOL = 1;

export type Delegate = 'GPU' | 'CPU';

export type ToWorker =
  | {
      type: 'init';
      v: number;
      /** The unpacked WASM engine and the model file, as bytes (transferred; no URL is ever fetched by the worker). */
      engine: ArrayBuffer;
      model: ArrayBuffer;
      /** 'auto' tries the GPU delegate and falls back to the CPU one. */
      delegate: Delegate | 'auto';
      confidence: number;
    }
  | {
      type: 'frame';
      id: number;
      /** The frame's capture time on the PAGE's clock; echoed back unchanged. */
      t: number;
      /** The picture (transferred; the worker closes it). */
      bitmap: ImageBitmap;
    }
  | { type: 'close' };

export type FromWorker =
  | { type: 'ready'; v: number; delegate: Delegate; loadMs: number; warmMs: number }
  | {
      type: 'pose';
      id: number;
      t: number;
      inferMs: number;
      /** 33 landmarks as [x, y, z, visibility] (x, y 0..1), or null when no person was found. */
      lm: Float32Array | null;
      width: number;
      height: number;
      /** Mean brightness 0..255 of a 16 x 12 shrink of the picture, now and then (black or dark picture detection). */
      luma?: number;
    }
  | { type: 'error'; stage: 'init' | 'frame'; message: string; fatal: boolean };
