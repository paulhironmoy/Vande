/**
 * The one normalized input model for every batting screen: touch, mouse, pen and keyboard become one NormalizedSwing
 * (docs/PRACTICE_INPUT.md).
 */
export { GestureSurface, type GestureSurfaceProps } from './GestureSurface';
export {
  calibrationOffset,
  canPlay,
  elevationOf,
  minPowerForElevation,
  moveThreshold,
  normalizeGesture,
  oneContactElevationOf,
  powerOf,
  readGesture,
  readOneContact,
  referenceLength,
  speedForPower,
  type GestureRead,
  type InputModality,
  type KeyStroke,
  type NormalizeOptions,
  type OneContactMotionPhase,
  type OneContactRead,
  type ReadEnd,
  type TrackedInput,
} from './normalize';
export { MODALITIES, calibrationError, calibrationFor, calibrationFromTaps, calibrationsFromTaps, eventModality, resolveCalibrations, withCalibration, type CalibrationSet } from './calibration';
export { TAP_HOLD_MS } from './constants';
export { GestureTracker, isShotKey, type KeyResult, type OneGesturePhase, type OneGestureState, type PointerKind, type SwingIntent, type TrackerEvents, type TrackerScheduler } from './tracker';
export { sampleStroke, traceGesture, type TraceOptions as GestureTraceOptions, type TraceResult as GestureTraceResult } from './simulate';
export { pointerIsDown } from './pressing';
export { PointerTrace, eventTime, pointerKind, coalesced, sampleIn, type TraceSample, type TraceOptions } from './pointer';
