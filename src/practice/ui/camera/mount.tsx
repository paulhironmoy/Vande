/**
 * The only part of the camera's screens in the first bundle besides the flow's gate: a few lines that load the camera
 * layer, and only when the camera is the control in force on this device. Mouse and touch players never fetch it.
 */
import { lazy, Suspense, useSyncExternalStore } from 'react';
import type { FlowState, PracticeFlow } from '../flow/controller';
import { currentControl, subscribeControl } from '../controls/state';

const CameraLayer = lazy(() => import('./CameraLayer'));

export function CameraMount({ flow, state }: { flow: PracticeFlow; state: FlowState }) {
  const wanted = useSyncExternalStore(
    subscribeControl,
    () => currentControl() === 'camera',
    () => false,
  );
  if (!wanted) return null;
  return (
    <Suspense fallback={null}>
      <CameraLayer flow={flow} state={state} />
    </Suspense>
  );
}
