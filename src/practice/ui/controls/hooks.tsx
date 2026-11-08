/**
 * React side of the control choice: the control in force, the device as the choice sees it, and the camera's own
 * screens opened on demand.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { loadCameraPort, type CameraSetupResult, type ControlsCameraPort } from './cameraPort';
import { defaultControl, type ControlEnv, type ControlId } from './model';
import { currentControl, currentEnv, noCameraDevice, subscribeControl } from './state';
import s from './controls.module.css';

/** The control in force on this device (re-renders when it changes). */
export function useControl(): ControlId {
  return useSyncExternalStore(
    subscribeControl,
    () => currentControl(),
    () => currentControl(),
  );
}

/** The device as the choice sees it. The list of cameras arrives a moment later and only ever switches the camera off. */
export function useControlEnv(): ControlEnv {
  const [noCamera, setNoCamera] = useState(false);
  useEffect(() => {
    let alive = true;
    void noCameraDevice().then((none) => alive && setNoCamera(none));
    return () => {
      alive = false;
    };
  }, []);
  return useMemo(() => ({ ...currentEnv(), noCamera }), [noCamera]);
}

export interface CameraSetupHandle {
  /** Opens the camera's consent and setup screens (loads them first; nothing of the camera exists before this). */
  open: () => void;
  /** True while the screens are loading or showing. */
  active: boolean;
  /** Render this once, anywhere: the camera's screens in a layer above everything, or nothing. */
  element: ReactNode;
}

/**
 * Opens the camera's own screens and reports how they ended. `onResult` runs once per opening; a build whose camera
 * screens cannot be loaded ends as "cancelled" (the player is still batting with what they had).
 */
export function useCameraSetup(env: ControlEnv, onResult: (r: CameraSetupResult) => void): CameraSetupHandle {
  const [port, setPort] = useState<ControlsCameraPort | 'loading' | null>(null);
  const latest = useRef(onResult);
  latest.current = onResult;
  const open = useCallback(() => {
    setPort('loading');
    void loadCameraPort().then((p) => {
      setPort(p);
      if (!p) latest.current({ kind: 'cancelled' });
    });
  }, []);
  const finish = useCallback((r: CameraSetupResult) => {
    setPort(null);
    latest.current(r);
  }, []);
  const Setup = port && port !== 'loading' ? port.Setup : null;
  return {
    open,
    active: port !== null,
    element: Setup ? (
      <div className={s.setupLayer} data-testid="practice-camera-setup-layer">
        <Setup fallback={defaultControl(env)} onDone={finish} />
      </div>
    ) : null,
  };
}
