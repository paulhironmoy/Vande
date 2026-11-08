/**
 * Shared types of the camera input (docs/PRACTICE_CAMERA_INPUT.md). Plain data: no DOM, loadable by Node's type
 * stripping like src/input/simulate.ts.
 */
import type { GestureSample } from '@/contracts/practice';

/**
 * One pose landmark list, flat: [x, y, z, visibility] for each of the 33 landmarks, x and y normalized to the picture
 * (0..1, y down), visibility 0..1. Index meanings are the Pose Landmarker's (LM below).
 */
export type PoseLandmarks = ArrayLike<number>;

/** The Pose Landmarker's indices that the mapper reads. */
export const LM = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
} as const;
export const LANDMARK_COUNT = 33;
export const LANDMARK_STRIDE = 4;

/** One camera frame's pose, as the mapper takes it. Never stored or sent: it lives in a short ring in memory. */
export interface PoseFrame {
  /** The frame's capture time on the main thread's performance.now() clock (ms); strictly increasing. */
  t: number;
  /** The picture size in px (so distances are isotropic). */
  width: number;
  height: number;
  /** 33 landmarks, or null when no person was found. */
  landmarks: PoseLandmarks | null;
}

/** What the mapper tells the tracker to do. The driver applies these to its own GestureTracker. */
export type TrackerCommand =
  | { type: 'down'; sample: GestureSample }
  | { type: 'move'; samples: GestureSample[] }
  | { type: 'up'; sample: GestureSample | null }
  | { type: 'cancel' };

export type DistanceState = 'ok' | 'too_close' | 'too_far' | 'unknown';

/**
 * The readiness check ("Show your upper body and your batting hand" until a stable pose is seen). Derived from the
 * latest frame by a pure function; CAMERA-UX shows it, the flow's pre-delivery pacing waits for `ready`.
 */
export interface PoseReadiness {
  /** A person is tracked: both shoulders and the batting hand are visible. */
  inFrame: boolean;
  shoulders: boolean;
  /** The batting hand (the right wrist for a right-hander, the left for a left-hander) is visible. */
  battingHand: boolean;
  /** The other hand is visible too (not required). */
  otherHand: boolean;
  head: boolean;
  distance: DistanceState;
  /** There is room above the head for the raised hands. */
  headroom: boolean;
  /** The hands are in the ready zone, in front of the body below the shoulders. */
  handsReadyZone: boolean;
  /** The hands are steady. */
  still: boolean;
  /** Everything above has held continuously for this long (ms). */
  stableMs: number;
  /** A stable pose has been seen: the delivery may start. */
  ready: boolean;
  /** The picture is too dark to track well (set by the capture side, not by the mapper). */
  poorLight: boolean;
}

export const EMPTY_READINESS: PoseReadiness = {
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

/** What one frame did, for the driver and the port. */
export interface MapperOutput {
  commands: TrackerCommand[];
  readiness: PoseReadiness;
  /** True while no valid pose has been seen for POSE.lostMs. */
  lost: boolean;
  /** A contact is open (its press has been sent and it has not been closed). */
  contactOpen: boolean;
  /** The kind of stroke the mapper decided on this frame, if it did. */
  decided: 'attack' | 'defence' | null;
}

/** The ways the camera can fail, in the words CAMERA-UX has copy for. */
export type CameraProblem =
  | 'unsupported' // no getUserMedia, no module workers, no WebAssembly SIMD, no DecompressionStream
  | 'insecure' // not a secure context
  | 'in_app_browser' // inside Instagram, Facebook, ...
  | 'blocked' // permission denied (this time or for good)
  | 'busy' // another app is using the camera (NotReadableError)
  | 'none' // no camera found
  | 'rear_only' // only a rear camera exists
  | 'black' // a black picture (privacy shutter, cover, OS toggle)
  | 'overconstrained'
  | 'offline' // the pack is not stored and there is no network
  | 'space' // not enough storage for the pack
  | 'download_failed'
  | 'verify_failed' // a downloaded file did not match its hash
  | 'engine_failed' // the worker or the model could not start
  | 'too_slow' // the measured frame rate or inference time is too poor
  | 'lost_tracking'; // no valid pose (only a phase reason, not a start failure)
