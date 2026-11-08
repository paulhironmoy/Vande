/**
 * The camera as a second batting surface: it arms the camera's batter the way the GestureSurface is armed, so a camera
 * swing reaches the flow through the same cues as a finger's (`onSwingStart`, `onIntent`, `onContactState`, `onGesture`,
 * `onCancel`) and ends as a NormalizedSwing from the one normalizer. Mouse, touch and keyboard stay mounted and live; the
 * first gesture of a delivery wins. Renders nothing.
 *
 * Armed only while a ball is live (`gesture.enabled` in the `live` phase) and, for the first-ball lesson, while its card
 * is open, with no cues plugged in (the lesson reads the camera's dry swing through its own seam, and nothing is bowled).
 * Where Unity owns the batting input this does nothing: the camera swing must reach Unity through its bridge.
 */
import { useEffect, useRef } from 'react';
import type { FlowState, PracticeFlow } from '../flow/controller';
import { getCameraController } from './controller';
import { useCameraUi } from './parts';

export function CameraBatLink({ flow, state }: { flow: PracticeFlow; state: FlowState }) {
  const controller = getCameraController();
  const ui = useCameraUi();
  const running = ui.stage === 'running' && ui.problem === null;
  // `running` is in the dependencies below so the batter is looked up again once the session exists.
  const bat = running ? controller.bat() : null;
  const lesson = state.phase === 'lesson';
  const live = state.gesture.enabled && state.phase === 'live' && !flow.stageOwnsInput();
  const armed = running && (lesson || live);

  useEffect(() => {
    if (!bat) return;
    bat.setHandlers(
      lesson
        ? null
        : {
            onSwingStart: flow.onSwingStart,
            onIntent: flow.onSwingIntent,
            onCancel: flow.onGestureCancel,
            onContactState: flow.onContactState,
            onGesture: flow.onGesture,
          },
    );
    return () => bat.setHandlers(null);
  }, [bat, flow, lesson]);

  useEffect(() => {
    bat?.setHandedness(state.handedness);
  }, [bat, state.handedness]);

  useEffect(() => {
    bat?.setEnabled(armed);
    return () => bat?.setEnabled(false);
  }, [bat, armed]);

  // A new delivery re-arms the batter, as a changed deliveryKey re-arms the surface (the first key is the starting one).
  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) {
      firstKey.current = false;
      return;
    }
    if (armed) bat?.rearm();
  }, [bat, armed, state.gesture.key]);

  // The lesson's try-out: one swing per arm, so the batter is armed again after each.
  useEffect(() => {
    if (!lesson || !bat) return;
    return controller.onSwing(() => bat.rearm());
  }, [lesson, bat, controller]);

  return null;
}
