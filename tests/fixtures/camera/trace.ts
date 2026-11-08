/**
 * Reads the landmark traces in ./traces (made by scripts/camera-fixtures/measure-detection.mjs from the rendered fixture clips) and
 * expands them into the `PoseFrame` list the camera mapper takes. A trace keeps only the seven landmarks the mapper reads
 * (nose, shoulders, elbows, wrists), four numbers each; the other 26 landmarks come back as zeros with visibility 0.
 *
 * Synthetic renders only: these are what the pose engine returned on pictures VANDE rendered, not what it would return for a person.
 */
import type { PoseFrame } from '@/input/camera/types';
import { LANDMARK_COUNT, LANDMARK_STRIDE } from '@/input/camera/types';

export interface LandmarkTrace {
  format: 'VANDE-LMTRACE1';
  clip: string;
  width: number;
  height: number;
  fps: number;
  /** Which of the 33 landmarks each four-number group is. */
  indices: number[];
  frames: Array<{ t: number; lm: number[] | null }>;
}

/** The trace as mapper input: strictly increasing times (ms from `startMs`), the picture size, and 33 x 4 landmarks or null. */
export function traceToPoseFrames(trace: LandmarkTrace, startMs = 0): PoseFrame[] {
  return trace.frames.map((f) => {
    let landmarks: Float32Array | null = null;
    if (f.lm) {
      landmarks = new Float32Array(LANDMARK_COUNT * LANDMARK_STRIDE);
      trace.indices.forEach((k, j) => {
        for (let c = 0; c < LANDMARK_STRIDE; c++) landmarks![k * LANDMARK_STRIDE + c] = f.lm![j * LANDMARK_STRIDE + c];
      });
    }
    return { t: startMs + f.t, width: trace.width, height: trace.height, landmarks };
  });
}
