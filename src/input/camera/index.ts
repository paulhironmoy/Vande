/**
 * Camera batting input (docs/PRACTICE_CAMERA_INPUT.md): pose landmarks become the samples of one virtual contact fed to the
 * existing GestureTracker, so a camera swing is a NormalizedSwing from normalizeGesture like every other input.
 */
export * from './constants';
export * from './types';
export { observe, visibilityWeight, type Observation, type ObserveOptions } from './landmarks';
export { PoseMapper, type MapperOptions } from './mapper';
export { CameraBatter, type CameraBatterEvents, type CameraBatterOptions, type CameraBatterStatus } from './driver';
export { MAX_FRAME_AGE_MS, MAX_FRAME_FUTURE_MS, MIN_FRAME_STEP_MS, normalizeFrameTime, type FrameMeta } from './time';
export { CAMERA_PROTOCOL, type FromWorker, type ToWorker } from './protocol';
export { createPoseHost, type PoseEngine, type PoseKit } from './host';
export { bakedPack, type CameraPackInfo, type PackFile, type PackState, type PackStatus } from './pack';
export { PackError, PackLoader, canUnpack, gunzip, sha256Hex } from './loader';
export { forgetCameraPack, indexedDbStore, memoryStore, type PackStore } from './store';
export { CAPTURE_LADDER, CaptureError, openCamera, problemOf, startFrameLoop } from './capture';
export {
  createCameraSession,
  type CameraBat,
  type CameraSession,
  type CameraSessionOptions,
  type CameraSessionStatus,
  type SessionStage,
  type WorkerLike,
} from './session';
export { nativeCameraAccess, type CameraPermission, type VandeCameraAccessPlugin } from './nativeAccess';
export { Ring, percentile, type CameraStats } from './stats';
