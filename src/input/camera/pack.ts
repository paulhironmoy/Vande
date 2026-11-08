/**
 * The camera pack: the pose engine and model the player downloads when (and only when) they choose Camera
 * (docs/PRACTICE_CAMERA_INPUT.md §2). Three files, each hash-checked, kept in app storage (IndexedDB), never precached,
 * never part of the first-ball install. The description is baked into the app at build time (scripts/camera/pack.mjs).
 */
export interface PackFile {
  /** What it is. */
  name: 'engine' | 'worker' | 'model';
  /** File name inside the pack folder. */
  file: string;
  /** Stored (downloaded) size in bytes, and its sha256. */
  bytes: number;
  sha256: string;
  /** Size after unpacking, and whether the stored file is gzip. */
  rawBytes: number;
  gzip: boolean;
}

export interface CameraPackInfo {
  /** First 12 hex of the hash of the file hashes; a new pack has a new id. */
  id: string;
  /** The pinned engine version. */
  version: string;
  /** Folder below the base URL, with a trailing slash (`models/pose/0.10.35/`). */
  dir: string;
  files: PackFile[];
  totalBytes: number;
}

export type PackState = 'absent' | 'checking' | 'downloading' | 'stalled' | 'retrying' | 'verifying' | 'cached';

export interface PackStatus {
  state: PackState;
  bytesDone: number;
  bytesTotal: number;
  attempt: number;
  maxAttempts: number;
}

export function bakedPack(): CameraPackInfo | null {
  return typeof __CAMERA_PACK__ === 'undefined' ? null : __CAMERA_PACK__;
}
export function bakedBundled(): boolean {
  return typeof __CAMERA_BUNDLED__ !== 'undefined' && __CAMERA_BUNDLED__;
}
export function bakedBase(): string {
  const url = typeof __CAMERA_BASE_URL__ === 'undefined' ? '' : __CAMERA_BASE_URL__;
  if (url) return url.endsWith('/') ? url : `${url}/`;
  return (import.meta.env?.BASE_URL as string | undefined) ?? '/';
}
