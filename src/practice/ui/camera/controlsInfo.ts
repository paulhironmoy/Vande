/**
 * What the control choice may say about the camera before the player has tapped it, read at once and kept tiny (this
 * file is in the first bundle on purpose; the screens are not): whether this build can run camera batting at all, which
 * is true only where the pose pack was built in, and the size of the one-time download, for the one honest line under
 * "Camera". Nothing is loaded and nothing is asked of the device.
 */
import type { CameraInfo } from '../controls/cameraPort';
import { bakedPack, type CameraPackInfo } from '@/input/camera/pack';

/** The facts for a pack description, or for a build without one. */
export function cameraInfoOf(pack: CameraPackInfo | null): CameraInfo {
  if (!pack) return { offered: false, packMb: null };
  // Megabytes as the download is shown: one decimal, rounded to the nearest tenth.
  return { offered: true, packMb: Math.round(pack.totalBytes / 100_000) / 10 };
}

export const cameraInfo: CameraInfo = cameraInfoOf(bakedPack());
