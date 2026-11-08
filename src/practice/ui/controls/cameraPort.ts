/**
 * The seam between the control choice (CONTROLS) and the camera's own screens (CAMERA-UX, src/practice/ui/camera).
 *
 * The choice screen never opens the camera itself. When the player picks Camera it shows the camera module's `Setup`
 * (the consent, then the browser or Android prompt, the one-time download, the getting-in-position guide) and waits for
 * its answer. Only an answer of "ready" makes the camera the stored control, so "remembered on this device" means "it
 * worked here". Every other answer keeps the player batting: "Bat with mouse" or "Bat with touch" is one tap in the
 * camera screens, and backing out returns to the choice.
 *
 * The camera module takes part by existing, in two files (found with globs, so this compiles and the choice works,
 * with no camera option, before they exist):
 * - `src/practice/ui/camera/controlsInfo.ts` exports `cameraInfo` ({ offered, packMb }): tiny, pure, read at once. It
 *   says whether this build offers the camera (the pose files are not in every build) and how many megabytes the
 *   one-time download is, for the one honest line under "Camera".
 * - `src/practice/ui/camera/controlsPort.ts` exports `controlsPort`: the screens, loaded only when Camera is tapped, so
 *   the first ball never pays for them.
 */
import type { ComponentType } from 'react';
import type { PointerControl } from './model';

export type CameraSetupResult =
  /** Consent given, permission granted, the files cached and a person is in frame: the camera will be used. */
  | { kind: 'ready' }
  /** The player chose to bat without the camera ("Bat with mouse" / "Bat with touch"), anywhere in the camera screens. */
  | { kind: 'fallback'; to: PointerControl }
  /** The player backed out (back, Escape): nothing changes. */
  | { kind: 'cancelled' };

export interface CameraSetupProps {
  /** The pointer control a "Bat with ..." button there switches to: the device's default (mouse on the web, touch on Android). */
  fallback: PointerControl;
  /** Called once, when the camera screens are finished with. The caller unmounts `Setup`. */
  onDone: (result: CameraSetupResult) => void;
}

export interface ControlsCameraPort {
  /** The camera's consent, permission, download and getting-in-position screens, as one component. */
  Setup: ComponentType<CameraSetupProps>;
  /** Stops the camera at once (the control moved away from it, or Practice closed). Safe to call when it is not running. */
  stop(): void;
}

export interface CameraInfo {
  /** This build can use the camera (false where the pose files are not part of the build: the option is then not shown). */
  offered: boolean;
  /** The one-time download in megabytes, as built (one decimal); null if unknown, in which case the line names no size. */
  packMb: number | null;
}

type InfoModule = { cameraInfo?: CameraInfo };
type PortModule = { controlsPort?: ControlsCameraPort; default?: ControlsCameraPort };

const infoModules = import.meta.glob<InfoModule>('../camera/controlsInfo.ts', { eager: true });
const portModules = import.meta.glob<PortModule>('../camera/controlsPort.ts');

let loaded: ControlsCameraPort | null = null;
let pending: Promise<ControlsCameraPort | null> | null = null;
let override: { info: CameraInfo | null; port: ControlsCameraPort | null } | undefined;

/** The camera module's facts, or null when this build has no camera module. */
export function cameraInfo(): CameraInfo | null {
  if (override) return override.info;
  const [mod] = Object.values(infoModules);
  if (mod?.cameraInfo) return mod.cameraInfo;
  // The screens exist but have not said how big their download is: offered, with no size claimed.
  return Object.keys(portModules).length > 0 ? { offered: true, packMb: null } : null;
}

/** True when this build offers the camera as a control. */
export function cameraBuilt(): boolean {
  return cameraInfo()?.offered === true;
}

/** Loads the camera screens on demand (never before the player taps Camera). Null when this build has none. */
export function loadCameraPort(): Promise<ControlsCameraPort | null> {
  if (override) return Promise.resolve(override.port);
  if (loaded) return Promise.resolve(loaded);
  const [load] = Object.values(portModules);
  if (!load) return Promise.resolve(null);
  pending ??= load().then(
    (m) => {
      loaded = m.controlsPort ?? m.default ?? null;
      return loaded;
    },
    () => {
      pending = null;
      return null;
    },
  );
  return pending;
}

/** The camera screens if they have been loaded (so a switch away from the camera can stop it without waiting). */
export function cameraPortNow(): ControlsCameraPort | null {
  return override ? override.port : loaded;
}

/** Tests: stand in for the camera module ({ info: null, port: null } is a build without one); undefined restores the lookup. */
export function setCameraForTests(
  stand: { info: CameraInfo | null; port: ControlsCameraPort | null } | undefined,
): void {
  override = stand;
}
