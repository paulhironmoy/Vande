/**
 * "Clear Practice data" for the camera: it switches the camera off if it is on, forgets what this visit knew (the consent
 * seen, the pack's status) and deletes the downloaded pack from this device. The stored consent and the chosen control are
 * removed by clearPracticeData() itself (they live in Practice's own keys). Lazy on purpose: the camera's controller loads
 * only if a camera was ever started, and the pack's store (one small module) only when the player clears.
 */
import { getCameraUi, resetCameraUi } from './store';

export async function forgetCamera(): Promise<void> {
  if (getCameraUi().started) {
    const { getCameraController } = await import('./controller');
    getCameraController().cancel();
  }
  resetCameraUi(false);
  try {
    const { forgetCameraPack } = await import('@/input/camera/store');
    await forgetCameraPack();
  } catch {
    /* nothing stored, or storage blocked: nothing to forget */
  }
}
