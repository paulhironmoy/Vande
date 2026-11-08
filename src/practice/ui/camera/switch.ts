/**
 * The one-tap way back from the camera's card and banner: the control in force moves to mouse or touch (CONTROLS stores
 * it and switches the camera off) and the camera is stopped here too, so the light goes off even if that module never
 * heard. False, and nothing changes, while a delivery is under way (the buttons are not drawn then).
 */
import { setControl } from '../controls/state';
import type { PointerControl } from '../controls/model';
import { getCameraController } from './controller';

export function switchAway(to: PointerControl): boolean {
  if (!setControl(to)) return false;
  getCameraController().cancel();
  return true;
}
