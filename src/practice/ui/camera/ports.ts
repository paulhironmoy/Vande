/**
 * What the camera screens need from the camera core (src/input/camera), as one small port. The screens never touch a
 * stream, a frame, a landmark or a worker: they ask the session to start, stop and show its picture, and they read its
 * status. Nothing here carries a picture, and nothing here is ever stored or sent.
 *
 * The types of what the core knows about the person (PoseReadiness) and about failures (CameraProblem) are the core's
 * own; this file only names the session around them. Until the core publishes its session, the tests drive a fake that
 * implements this interface (tests/unit/practice/ui/camera/fakeSession.ts); the adapter (./adapter.ts) is the one
 * place that bends a real session to this shape.
 */
import type { Handedness, NormalizedSwing } from '@/contracts';
import type { CameraBatterEvents } from '@/input/camera/driver';
import type { CameraProblem, PoseReadiness } from '@/input/camera/types';

export type { CameraProblem, PoseReadiness };

/** The pack (the engine and the model) on this device: nothing is downloaded until the player picks Camera. */
export type PackState = 'absent' | 'checking' | 'downloading' | 'stalled' | 'retrying' | 'verifying' | 'cached';

export interface PackStatus {
  state: PackState;
  /** Bytes received, and the size of the whole pack as stored (known before the download starts). */
  bytesDone: number;
  bytesTotal: number;
  /** Which attempt this is (1 is the first) and how many there are. */
  attempt: number;
  maxAttempts: number;
}

/**
 * Where the session is. `opening` is the permission and the stream, `loading` the pack, `starting` the worker and the
 * model; `running` means pictures are being read.
 */
export type SessionStage = 'idle' | 'opening' | 'loading' | 'starting' | 'running' | 'failed';

export interface CameraSessionStatus {
  stage: SessionStage;
  /** Set when the stage is `failed`, and while running if the picture goes black or the device is too slow. */
  problem: CameraProblem | null;
  pack: PackStatus;
  /** The latest reading of the person in the picture (all false before the first frame). */
  readiness: PoseReadiness;
  /** No usable person for the core's lost-tracking time (about 0.3 s). False before running. */
  lost: boolean;
}

/**
 * What the Practice flow arms for a live ball, like a GestureSurface's props: the cues to call, who is batting, and when a
 * delivery is live. The camera calls `onSwingStart` at the first rise of the hands, then the tracker's own cues.
 */
export interface CameraBat {
  setHandlers(h: Partial<CameraBatterEvents> | null): void;
  setEnabled(on: boolean, atPerfMs?: number): void;
  rearm(atPerfMs?: number): void;
  setHandedness(h: Handedness): void;
}

export interface CameraSession {
  /** A new object only when something changed (callers compare by reference). */
  status(): CameraSessionStatus;
  /** Coalesced by the core: never one call per frame. */
  subscribe(cb: () => void): () => void;
  /** Known without asking for anything: why the camera cannot work here ('unsupported', 'insecure'), or null. */
  unavailable(): CameraProblem | null;
  /** The pack's size in bytes, for "about {mb} MB". */
  packBytes(): number;
  /** Whether the pack is already stored on this device. */
  packCached(): Promise<boolean>;
  /**
   * One call, from the player's tap on "Use camera": permission and the stream first (so a "no" costs no download),
   * then the pack (download, retries, check, store; nothing when cached), then the worker and the model. Aborting the
   * signal cancels the download and stops the stream. It rejects with an error carrying `.problem`; calling it again
   * after a failure retries from the step that failed.
   */
  start(signal?: AbortSignal): Promise<void>;
  /** The camera light goes off and the worker stops. Safe at any time; the stored pack stays. */
  stop(): void;
  /** Shows the same stream in a video element (muted, inline). The picture is never copied by the screens. */
  attachPreview(video: HTMLVideoElement): () => void;
  /** Android shell only: the system's answer about the camera permission, or null where it cannot be asked. */
  permission?(): Promise<'granted' | 'prompt' | 'denied' | 'blocked' | null>;
  /** Android shell only: opens this app's settings page. */
  openSettings?(): Promise<void>;
  /** The first-ball lesson's dry swing (the camera's own tracker and the same normalizer; never video). */
  onSwing?(cb: (swing: NormalizedSwing) => void): () => void;
  /** The batter the flow arms for a live ball (absent in a fake that only shows screens). */
  bat?: CameraBat;
}

/** No person seen yet: every field false. Typed by the core's PoseReadiness, so a change there is a compile error here. */
export const NO_READINESS: PoseReadiness = {
  inFrame: false,
  shoulders: false,
  battingHand: false,
  otherHand: false,
  head: false,
  distance: 'unknown',
  headroom: false,
  handsReadyZone: false,
  still: false,
  stableMs: 0,
  ready: false,
  poorLight: false,
};

export const NO_PACK: PackStatus = { state: 'absent', bytesDone: 0, bytesTotal: 0, attempt: 1, maxAttempts: 1 };

/** A session that does nothing, for code that must hold something before the real one is made. */
export const NO_STATUS: CameraSessionStatus = {
  stage: 'idle',
  problem: null,
  pack: NO_PACK,
  readiness: NO_READINESS,
  lost: false,
};
