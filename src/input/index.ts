/**
 * The one normalized input model for every batting screen: touch, mouse, pen and keyboard become one NormalizedSwing
 * (docs/PRACTICE_PRESENTATION.md, "Input mapping").
 */
export { GestureSurface, type GestureSurfaceProps } from './GestureSurface';
export { normalizeGesture, readGesture, powerOf, elevationOf, moveThreshold, type NormalizeOptions, type GestureRead } from './normalize';
export { calibrationFromTaps, calibrationError } from './calibration';
export { GestureTracker, READ_GRACE_MS, type TrackerEvents, type TrackerScheduler, type PointerKind, type KeyResult } from './tracker';
export { PointerTrace, eventTime, pointerKind, coalesced, sampleIn, type TraceSample, type TraceOptions } from './pointer';
export * as INPUT_CONSTANTS from './constants';
