/**
 * What the camera shows on the play screen: the card before a ball (the flow waits in its `camera` phase until a person
 * is in frame and steady, so nothing here ever touches a delivery), the small status chip, and the banner when the camera
 * loses the player between balls. Every one of them offers "Bat with mouse" or "Bat with touch" in one tap, and none is
 * drawn while a ball is live.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePracticeT } from '@/i18n/practice';
import { isNativePlatform } from '@/platform';
import { useStableId } from '@/ui';
import { PButton, sys } from '../design';
import { consentSeen } from './consent';
import { getCameraController } from './controller';
import { currentUserAgent, readEnvironment } from './environment';
import { panelFor } from './panels';
import { PanelHost, type PanelActions } from './panelViews';
import { switchLabel, useCameraUi, useFallbackControl, useWaited } from './parts';
import { switchAway } from './switch';
import { pageTroubleEnv } from './troubleEnv';
import s from './camera.module.css';

/** The card before a ball: why the next ball waits, a small picture, and the way back. */
export function ReadinessCard({ openHelp }: { openHelp: () => void }) {
  const controller = getCameraController();
  const ui = useCameraUi();
  const fallback = useFallbackControl();
  const title = useStableId('camera-ready-title');
  const body = useStableId('camera-ready-body');
  const status = useStableId('camera-ready-status');
  const t = usePracticeT();
  const desktop = useMemo(() => readEnvironment(currentUserAgent(), isNativePlatform()).platform === 'desktop', []);
  const env = useMemo(() => pageTroubleEnv(controller), [controller]);
  const announce = useRef<HTMLDivElement>(null);
  const [seenBefore] = useState(() => consentSeen());

  useEffect(() => {
    void controller.prepare();
  }, [controller]);
  // Said once, politely, when the card appears: what the next ball is waiting for.
  useEffect(() => {
    if (announce.current) announce.current.textContent = t.t('practice.camera.ready.announce');
  }, [t]);

  const waited = useWaited(ui.stage === 'running' && !ui.readiness.inFrame);
  const panel = panelFor({ ...ui, consentSeen: ui.consentSeen || seenBefore }, 'card', waited);
  const actions: PanelActions = {
    fallback,
    // The tap on "Use camera" is the answer to the consent the card shows (or showed before), and starts the camera.
    start: () => {
      controller.acceptConsent();
      void controller.begin();
    },
    retry: () => void controller.retry(),
    ready: () => undefined,
    switchAway: () => void switchAway(fallback),
    help: openHelp,
    keepTrying: () => controller.dismissLightHelp(),
  };
  const live = ui.stage === 'loading' || ui.stage === 'starting' || ui.stage === 'running';

  return (
    <section
      className={s.card}
      role="region"
      aria-labelledby={title}
      aria-describedby={body}
      data-testid="camera-ready"
      data-panel={panel.kind}
      data-case={panel.kind === 'trouble' ? panel.case : undefined}
    >
      <PanelHost
        panel={panel}
        mode="card"
        ids={{ title, body, status }}
        actions={actions}
        env={env}
        live={live}
        desktop={desktop}
        downloadMb={null}
      />
      <div ref={announce} className="sr-only" aria-live="polite" aria-atomic="true" />
    </section>
  );
}

/** "Camera on" / "Can't see you": a quiet pill in the rail's corner, between balls only, never a control. */
export function CameraChip({ lost, quiet }: { lost: boolean; quiet: boolean }) {
  const t = usePracticeT();
  return (
    <span
      className={s.chip}
      data-state={lost ? 'lost' : 'on'}
      data-quiet={quiet ? 'true' : 'false'}
      data-testid="camera-chip"
    >
      <span className={s.dot} aria-hidden="true" />
      <span>{t.t(lost ? 'practice.camera.chip.lost' : 'practice.camera.chip.on')}</span>
    </span>
  );
}

/** The camera lost the player between balls: say so, and offer the way back. Non-blocking; the game goes on. */
/**
 * Which side of the screen the banner takes: the dead ball's card keeps the bottom of the left column and moves to the right
 * after some balls (it says where in `data-place`), so the banner goes to the other side and never covers its buttons.
 */
function useFreeSide(): 'left' | 'right' {
  const [side, setSide] = useState<'left' | 'right'>('right');
  useEffect(() => {
    const root = document.querySelector('[data-play-root]');
    if (!root) return;
    const read = () => {
      const place = root.querySelector<HTMLElement>('[data-place]')?.dataset.place ?? '';
      setSide(place.startsWith('right') ? 'left' : 'right');
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-place'] });
    return () => observer.disconnect();
  }, []);
  return side;
}

export function LostBanner({
  onKeepTrying,
  onHelp,
  counted = false,
}: {
  onKeepTrying: () => void;
  onHelp: () => void;
  /** The ball just played counted as a leave because the camera lost the player during it. */
  counted?: boolean;
}) {
  const t = usePracticeT();
  const fallback = useFallbackControl();
  const side = useFreeSide();
  const live = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live.current) {
      live.current.textContent = t.t('practice.camera.lost.announce', {
        control: t.t(`practice.input.${fallback}`).toLocaleLowerCase(t.intl),
      });
    }
  }, [t, fallback]);
  return (
    <section
      className={s.banner}
      role="region"
      aria-labelledby="camera-lost-title"
      data-side={side}
      data-testid="camera-lost-banner"
    >
      <h2 id="camera-lost-title" className={sys.section}>
        {t.t('practice.camera.lost.title')}
      </h2>
      {counted && (
        <p className={sys.body} data-testid="camera-lost-counted">
          {t.t('practice.camera.lost.counted')}
        </p>
      )}
      <p className={sys.body}>{t.t('practice.camera.lost.body')}</p>
      <div className={s.bannerActions}>
        <PButton variant="secondary" onClick={() => void switchAway(fallback)} data-testid="camera-lost-fallback">
          {switchLabel(t, fallback)}
        </PButton>
        <PButton variant="quiet" onClick={onKeepTrying} data-testid="camera-lost-retry">
          {t.t('practice.camera.lost.retry')}
        </PButton>
        <PButton variant="quiet" onClick={onHelp} data-testid="camera-lost-help">
          {t.t('practice.camera.lost.help')}
        </PButton>
      </div>
      <div ref={live} className="sr-only" aria-live="polite" aria-atomic="true" data-testid="camera-lost-announce" />
    </section>
  );
}

/**
 * The camera had lost the player during the ball that was just played, and that ball counted as a leave: said once, in
 * plain words, between balls, when the player is in view again (while still lost, the banner says it).
 */
export function LostNote() {
  const t = usePracticeT();
  const side = useFreeSide();
  return (
    <p className={s.lostNote} role="status" data-side={side} data-testid="camera-lost-note">
      {t.t('practice.camera.lost.counted')}
    </p>
  );
}
