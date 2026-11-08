/**
 * Camera capture (docs/PRACTICE_CAMERA_INPUT.md §3): the front camera only, about 640 x 480 at 30 fps or less, a step-down
 * ladder when a camera rejects the request, a rear camera skipped, every failure named in the words the UI has copy for.
 */
import type { CameraProblem } from './types';

/** The requests, best first. Never `exact`, never audio; a rung is tried only when the one before it was over-constrained. */
export const CAPTURE_LADDER: readonly MediaStreamConstraints[] = [
  {
    video: {
      facingMode: { ideal: 'user' },
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 30, max: 30 },
    },
    audio: false,
  },
  { video: { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
  { video: { facingMode: { ideal: 'user' }, width: { ideal: 320 }, height: { ideal: 240 } }, audio: false },
  { video: { facingMode: { ideal: 'user' } }, audio: false },
  { video: true, audio: false },
];

export class CaptureError extends Error {
  readonly problem: CameraProblem;
  constructor(problem: CameraProblem, message: string) {
    super(message);
    this.name = 'CaptureError';
    this.problem = problem;
  }
}

/** The failure a getUserMedia error means. */
export function problemOf(e: unknown): CameraProblem {
  const name = (e as { name?: string } | null)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'blocked';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'none';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') return 'overconstrained';
  return 'unsupported';
}

const REAR = /back|rear|environment/i;

export interface OpenedCamera {
  stream: MediaStream;
  settings: MediaTrackSettings;
  /** Which rung of the ladder worked (0 is the best). */
  rung: number;
}

export interface CaptureApi {
  getUserMedia(c: MediaStreamConstraints): Promise<MediaStream>;
  enumerateDevices?(): Promise<MediaDeviceInfo[]>;
}

const stop = (s: MediaStream) => s.getTracks().forEach((t) => t.stop());

/** Opens the front camera, stepping down the ladder on over-constrained requests and skipping a rear camera. */
export async function openCamera(api: CaptureApi): Promise<OpenedCamera> {
  let last: unknown = null;
  for (let rung = 0; rung < CAPTURE_LADDER.length; rung++) {
    try {
      let stream = await api.getUserMedia(CAPTURE_LADDER[rung]);
      let track = stream.getVideoTracks()[0];
      if (!track) {
        stop(stream);
        throw new CaptureError('none', 'the stream has no video track');
      }
      let settings = track.getSettings?.() ?? {};
      if (
        settings.facingMode === 'environment' ||
        (track.label && REAR.test(track.label) && settings.facingMode !== 'user')
      ) {
        // A rear camera is never used: look for a front one by device, else give up plainly.
        stop(stream);
        const devices = (await api.enumerateDevices?.().catch(() => [])) ?? [];
        const front = devices.find((d) => d.kind === 'videoinput' && d.deviceId && !REAR.test(d.label));
        if (!front) throw new CaptureError('rear_only', 'only a rear camera was found');
        stream = await api.getUserMedia({
          video: { deviceId: { exact: front.deviceId }, width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        track = stream.getVideoTracks()[0];
        settings = track?.getSettings?.() ?? {};
        if (settings.facingMode === 'environment') {
          stop(stream);
          throw new CaptureError('rear_only', 'only a rear camera was found');
        }
      }
      return { stream, settings, rung };
    } catch (e) {
      if (e instanceof CaptureError) throw e;
      last = e;
      if (problemOf(e) !== 'overconstrained') throw new CaptureError(problemOf(e), (e as Error)?.message ?? String(e));
    }
  }
  throw new CaptureError('overconstrained', (last as Error | null)?.message ?? 'the camera rejected every request');
}

export interface FrameInfo {
  /** The video's own clock metadata, when the browser gives it. */
  meta?: { captureTime?: number; presentationTime?: number; expectedDisplayTime?: number };
}

/** Calls `onFrame` for every new picture of the video (requestVideoFrameCallback; a 30 Hz timer where it does not exist). */
export function startFrameLoop(video: HTMLVideoElement, onFrame: (f: FrameInfo) => void): () => void {
  let stopped = false;
  type Rvfc = (cb: (now: number, meta: VideoFrameCallbackMetadata) => void) => number;
  const rvfc = (video as unknown as { requestVideoFrameCallback?: Rvfc }).requestVideoFrameCallback?.bind(video);
  if (rvfc) {
    const tick = (_now: number, meta: VideoFrameCallbackMetadata) => {
      if (stopped) return;
      onFrame({
        meta: {
          captureTime: meta.captureTime,
          presentationTime: meta.presentationTime,
          expectedDisplayTime: meta.expectedDisplayTime,
        },
      });
      rvfc(tick);
    };
    rvfc(tick);
    return () => {
      stopped = true;
    };
  }
  const id = setInterval(() => {
    if (!stopped && video.readyState >= 2) onFrame({});
  }, 33);
  return () => {
    stopped = true;
    clearInterval(id);
  };
}
