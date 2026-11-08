/**
 * The Practice flow's one question to the camera: may the next ball start? It is a small object in the first bundle (the
 * camera's screens and core stay in their own lazy chunks), read by the flow before every ball (pre-delivery pacing only:
 * a delivery in flight is never touched).
 *
 * `wanted` is true while the camera is the control in force on this device (CONTROLS owns that choice); `ready` is true
 * when it is not wanted, or when the camera is running and a person is in frame and steady. When the camera is the
 * control and is not ready, the flow waits in its `camera` phase and the camera layer shows why, with one tap to mouse or
 * touch, so the game never stalls.
 */
import { currentControl, subscribeControl } from '../controls/state';
import { getCameraUi, isSteady, subscribeCameraUi } from './store';

export interface CameraGate {
  /** The camera is the control in force. */
  wanted(): boolean;
  /** No wait is needed: the camera is not the control, or a person is in frame and steady. */
  ready(): boolean;
  /** Called after either answer may have changed. Returns the unsubscribe. */
  subscribe(cb: () => void): () => void;
}

export const cameraGate: CameraGate = {
  wanted: () => currentControl() === 'camera',
  ready: () => currentControl() !== 'camera' || isSteady(getCameraUi()),
  subscribe: (cb) => {
    const a = subscribeControl(cb);
    const b = subscribeCameraUi(cb);
    return () => {
      a();
      b();
    };
  },
};
