/**
 * The camera's setup, as CONTROLS mounts it when the player taps Camera ("How do you want to bat?"): the consent, then
 * (only after "Use camera") the system's permission prompt, the one-time download behind the guide, the getting-in-
 * position guide with a mirrored preview and an "in frame" badge, and, when anything fails, one troubleshooting panel
 * with its own plain steps. Every panel has "Bat with mouse" or "Bat with touch" in one tap.
 *
 * It answers once through `onDone`: `ready` (consent given, permission granted, the files cached, a person in frame and
 * the player tapped "Start batting"; the camera stays on for the play screen that follows), `fallback` (the player chose
 * to bat without the camera) or `cancelled` (back or Escape). Anything but `ready` leaves the camera off.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap, useStableId } from '@/ui';
import { useBackHandler } from '@/app/back';
import { isNativePlatform } from '@/platform';
import type { CameraSetupProps } from '../controls/cameraPort';
import { sys } from '../design';
import { consentSeen } from './consent';
import { getCameraController } from './controller';
import { currentUserAgent, readEnvironment } from './environment';
import { registerLessonPort } from './lessonPort';
import { panelFor } from './panels';
import { PanelHost, type PanelActions } from './panelViews';
import { useCameraUi, useWaited } from './parts';
import { pageTroubleEnv } from './troubleEnv';
import s from './camera.module.css';

export function Setup({ fallback, onDone }: CameraSetupProps) {
  const controller = getCameraController();
  const ui = useCameraUi();
  const title = useStableId('camera-title');
  const body = useStableId('camera-body');
  const status = useStableId('camera-status');
  const ids = { title, body, status };
  const dialog = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const [seenBefore] = useState(() => consentSeen());
  const finished = useRef(false);
  const desktop = useMemo(() => readEnvironment(currentUserAgent(), isNativePlatform()).platform === 'desktop', []);
  const env = useMemo(() => pageTroubleEnv(controller), [controller]);

  const done = (result: Parameters<CameraSetupProps['onDone']>[0]) => {
    if (finished.current) return;
    finished.current = true;
    onDone(result);
  };

  useEffect(() => {
    const closed = controller.setupOpened();
    const unregister = registerLessonPort();
    void controller.prepare();
    return () => {
      closed();
      unregister();
      // Unmounted by its parent without an answer: the camera must not be left on.
      if (!finished.current) controller.cancel();
    };
  }, [controller]);

  const cancel = () => {
    controller.cancel();
    done({ kind: 'cancelled' });
  };
  useBackHandler(true, cancel);
  useFocusTrap(dialog, true, cancel, primary);

  const waited = useWaited(ui.stage === 'running' && !ui.readiness.inFrame);
  const panel = panelFor({ ...ui, consentSeen: ui.consentSeen || seenBefore }, 'setup', waited);
  // A new panel is a new page of the dialog: focus returns to the dialog, so a screen reader reads its new name.
  const lastKind = useRef(panel.kind);
  useEffect(() => {
    if (lastKind.current === panel.kind) return;
    lastKind.current = panel.kind;
    dialog.current?.focus({ preventScroll: true });
  }, [panel.kind]);
  const live = ui.stage === 'loading' || ui.stage === 'starting' || ui.stage === 'running';

  const actions: PanelActions = {
    fallback,
    start: () => {
      controller.acceptConsent();
      void controller.begin();
    },
    retry: () => void controller.retry(),
    ready: () => {
      controller.expectPlay();
      done({ kind: 'ready' });
    },
    switchAway: () => {
      controller.cancel();
      done({ kind: 'fallback', to: fallback });
    },
    keepTrying: () => controller.dismissLightHelp(),
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className={`${sys.root} ${s.backdrop}`} data-testid="camera-setup-backdrop">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title}
        aria-describedby={body}
        tabIndex={-1}
        className={s.sheet}
        data-testid="camera-setup"
        data-panel={panel.kind}
        data-case={panel.kind === 'trouble' ? panel.case : undefined}
        data-stage={ui.stage}
      >
        <PanelHost
          panel={panel}
          mode="setup"
          ids={ids}
          actions={actions}
          env={env}
          live={live}
          desktop={desktop}
          downloadMb={ui.pack.state === 'cached' || ui.packBytes <= 0 ? null : ui.packBytes / 1_000_000}
          primaryRef={primary}
        />
      </div>
    </div>,
    document.body,
  );
}
