/**
 * The camera's side of the first-ball lesson's seam (src/practice/ui/lesson/inputType.ts): whether the camera is the
 * batting input, whether a person is tracked, the camera's own dry swing (the same tracker and normalizer, never video)
 * and the silhouette that teaches the move. It is registered while a camera screen is mounted (the setup, or the play
 * screen when the camera is the control) and cleared when the last one goes, so the lesson draws its own two dots only
 * where there is no camera.
 */
import { setLessonCameraPort, lessonCameraPort, type LessonCameraPort } from '../lesson/inputType';
import { CameraCue } from './CameraCue';
import { getCameraController } from './controller';
import { getCameraUi, isTracking, subscribeCameraUi } from './store';

let holders = 0;
let installed: LessonCameraPort | null = null;

function makePort(): LessonCameraPort {
  const controller = getCameraController();
  return {
    active: () => getCameraUi().started,
    tracking: () => isTracking(getCameraUi()),
    subscribe: subscribeCameraUi,
    onSwing: (cb) => controller.onSwing(cb),
    Cue: CameraCue,
  };
}

/** Registers the camera's lesson port; returns the release. The port stays while anyone holds it. */
export function registerLessonPort(): () => void {
  holders += 1;
  if (!installed) {
    installed = makePort();
    setLessonCameraPort(installed);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    if (holders === 0 && installed) {
      // Another module may have replaced it meanwhile; only take back our own.
      if (lessonCameraPort() === installed) setLessonCameraPort(null);
      installed = null;
    }
  };
}
