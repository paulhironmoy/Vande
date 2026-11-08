/**
 * What the camera screens and the Practice flow know about the camera, in one tiny store: no React, no camera core, no
 * pictures. The controller (./controller.ts, loaded only when the camera is used) publishes into it; the flow's gate
 * (./gate.ts) and the screens read it. It sits in the first bundle on purpose, so it stays this small.
 *
 * `useSyncExternalStore` needs a snapshot that changes only when the state does, so `publish` compares field by field
 * and keeps the same object when nothing differs.
 */
import {
  NO_PACK,
  NO_READINESS,
  type CameraProblem,
  type PackStatus,
  type PoseReadiness,
  type SessionStage,
} from './ports';

export interface CameraUi {
  stage: SessionStage;
  /** Why the camera cannot be used now (a failure to start, or a picture that went black), or null. */
  problem: CameraProblem | null;
  pack: PackStatus;
  /** The one-time download in bytes (0 until the camera core is loaded and says). */
  packBytes: number;
  readiness: PoseReadiness;
  /** No usable person for the core's lost-tracking time. */
  lost: boolean;
  /** The player tapped "Use camera" in this visit and has not stopped it: the camera may run, and restart after a hide. */
  started: boolean;
  /** The consent of this version was shown on this device. */
  consentSeen: boolean;
  /** Too dark for too long while waiting to be seen: the "not enough light" panel is due. */
  lightHelp: boolean;
}

export const INITIAL_UI: CameraUi = {
  stage: 'idle',
  problem: null,
  pack: NO_PACK,
  packBytes: 0,
  readiness: NO_READINESS,
  lost: false,
  started: false,
  consentSeen: false,
  lightHelp: false,
};

let ui: CameraUi = INITIAL_UI;
const listeners = new Set<() => void>();

export function getCameraUi(): CameraUi {
  return ui;
}

export function subscribeCameraUi(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

/** Changes the fields given. Listeners hear about it only when a field really differs. */
export function publishCameraUi(patch: Partial<CameraUi>): void {
  let changed = false;
  for (const key of Object.keys(patch) as Array<keyof CameraUi>) {
    if (!Object.is(ui[key], patch[key])) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  ui = { ...ui, ...patch };
  for (const l of [...listeners]) l();
}

/** Tests, and a camera that has been switched off: everything back to "not started". The consent flag is kept. */
export function resetCameraUi(keepConsent = true): void {
  const consent = keepConsent ? ui.consentSeen : false;
  ui = { ...INITIAL_UI, consentSeen: consent };
  for (const l of [...listeners]) l();
}

/** The camera is running and a person is in frame and steady: the next ball may start. */
export function isSteady(s: CameraUi): boolean {
  return s.stage === 'running' && s.problem === null && !s.lost && s.readiness.ready;
}

/** A person is tracked well enough to swing (the first-ball lesson's `tracking()`). */
export function isTracking(s: CameraUi): boolean {
  return s.stage === 'running' && s.problem === null && !s.lost && s.readiness.inFrame;
}

/** The camera is on (the light is on): opening, loading, starting or running. */
export function isOn(s: CameraUi): boolean {
  return s.started && s.stage !== 'idle' && s.stage !== 'failed';
}
