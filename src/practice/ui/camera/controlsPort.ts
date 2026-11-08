/**
 * The camera module's one door for the control choice (src/practice/ui/controls/cameraPort.ts finds this file by name):
 * the setup screens, and the way to stop the camera at once. Loaded only when the player taps Camera, as its own chunk.
 */
import type { ControlsCameraPort } from '../controls/cameraPort';
import { getCameraController } from './controller';
import { Setup } from './Setup';

export const controlsPort: ControlsCameraPort = {
  Setup,
  stop: () => getCameraController().cancel(),
};

export default controlsPort;
