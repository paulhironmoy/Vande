/**
 * The Android shell's camera permission helper (RULINGS R-14): status, request and "open settings" only, no capture. On the web
 * there is no plugin and the page just calls getUserMedia. Specified by ANDROID-1 section 5; registered here with Capacitor's
 * own registerPlugin.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

export type CameraPermission = 'granted' | 'prompt' | 'prompt-with-rationale' | 'denied';

export interface VandeCameraAccessPlugin {
  /** No dialog. 'denied' = the system will not ask again: only Settings can fix it. */
  getStatus(): Promise<{ camera: CameraPermission; hasFrontCamera: boolean; hasAnyCamera: boolean }>;
  /** Shows the system dialog when it can; resolves after the player answers. */
  request(): Promise<{ camera: CameraPermission }>;
  /** Opens this app's page in the system Settings. */
  openSettings(): Promise<{ opened: boolean }>;
}

let plugin: VandeCameraAccessPlugin | null | undefined;

/** The helper inside the Android shell, else null (the web). */
export function nativeCameraAccess(): VandeCameraAccessPlugin | null {
  if (plugin !== undefined) return plugin;
  try {
    plugin = Capacitor.isNativePlatform() ? registerPlugin<VandeCameraAccessPlugin>('VandeCameraAccess') : null;
  } catch {
    plugin = null;
  }
  return plugin;
}
