/**
 * Practice, screen by screen: the menu, Build an Over, settings, the timing check, diagnostics and play. The flow
 * controller (./flow/controller.ts) runs the innings; this component owns which screen shows, the landscape lock
 * around play, the app's pause and resume, and the viewport's orientation.
 */
import { useEffect, useRef, useState } from 'react';
import type { AnalyticsEventName, AnalyticsProps, PracticeOverPlan } from '@/contracts';
import { useApp } from '@/app/store';
import { isNativePlatform } from '@/platform';
import { isLandscapeViewport, lockLandscape, onViewportOrientation, unlockOrientation } from '@/platform/orientation';
import { loadPracticeSettings, updatePracticeSettings } from '@/practice/store';
import { usePracticeT } from '@/i18n/practice';
import { PracticeFlow, type FlowHooks, type LastBall } from './flow/controller';
import { useFlowState, useKit } from './context';
import { coachingLines } from './coaching';
import { audioWarmed, prepareAudioUnlock } from './audioWarm';
import { BuildOver } from './screens/BuildOver';
import { Calibration } from './screens/Calibration';
import { Diagnostics } from './screens/Diagnostics';
import { Menu } from './screens/Menu';
import { Play } from './screens/Play';
import { PracticeSettings } from './screens/PracticeSettings';
import s from './screens/Play.module.css';

export interface PracticeAppProps {
  appVersion: string;
  analytics?: (event: AnalyticsEventName, props?: AnalyticsProps) => void;
  hooks?: FlowHooks | null;
  /** performance.now() when Practice was chosen (the launch tap), for time to first delivery. */
  openedAt?: number;
  /** Leave Practice (back to the app). */
  onExit: () => void;
  /** Test builds: the controller, for the hooks. */
  onFlow?: (flow: PracticeFlow | null) => void;
}

type View = 'menu' | 'build' | 'settings' | 'calibration' | 'diagnostics';
type Overlay = null | 'settings' | 'build' | 'calibration' | 'diagnostics';

function newSeed(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function PracticeApp({ appVersion, analytics, hooks, openedAt, onExit, onFlow }: PracticeAppProps) {
  const kit = useKit();
  const t = usePracticeT();
  const reducedMotion = useApp((st) => st.reducedMotion);
  const reduced = useRef(reducedMotion);
  reduced.current = reducedMotion;
  const [flow, setFlow] = useState<PracticeFlow | null>(null);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<View>('menu');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [, setTick] = useState(0);

  // One controller per visit (created in the effect, so a development double-mount gets a fresh one).
  useEffect(() => {
    prepareAudioUnlock();
    const f = new PracticeFlow({
      audioWarmed,
      engine: kit.engine,
      createStage: kit.createStage,
      appVersion,
      analytics,
      hooks,
      openedAt,
      reducedMotion: () => reduced.current,
      isLandscape: isLandscapeViewport,
      newSeed,
      words: {
        runup: (n) => t.t('practice.live.announce_runup', { n }),
        outcome: (last: LastBall, board) => {
          const c = coachingLines(t, last.result);
          const params = { headline: c.head, reason: c.reason, result: c.result, runs: board.runs, wickets: board.wickets };
          return last.kind === 'innings' ? t.t('practice.live.announce', params) : t.t('practice.live.announce_warmup', params);
        },
      },
    });
    setFlow(f);
    onFlow?.(f);
    const start = f.init();
    if (start === 'guided') {
      setPlaying(true);
      void f.startGuided();
    } else if (start === 'summary') setPlaying(true);
    return () => {
      onFlow?.(null);
      f.dispose();
      void unlockOrientation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The app went to the background (Android pause, a tab switch, the screen locking).
  useEffect(() => {
    if (!flow) return;
    const vis = () => flow.setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', vis);
    let remove: (() => void) | null = null;
    let gone = false;
    if (isNativePlatform())
      void import('@capacitor/app').then(async ({ App }) => {
        const h = await App.addListener('pause', () => flow.setHidden(true));
        if (gone) void h.remove();
        else remove = () => void h.remove();
      });
    return () => {
      gone = true;
      document.removeEventListener('visibilitychange', vis);
      remove?.();
    };
  }, [flow]);

  useEffect(() => (flow ? onViewportOrientation((landscape) => flow.setLandscape(landscape)) : undefined), [flow]);

  if (!flow) return null;
  return <PracticeScreens flow={flow} playing={playing} setPlaying={setPlaying} view={view} setView={setView} overlay={overlay} setOverlay={setOverlay} onExit={onExit} refresh={() => setTick((n) => n + 1)} />;
}

interface ScreensProps {
  flow: PracticeFlow;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  view: View;
  setView: (v: View) => void;
  overlay: Overlay;
  setOverlay: (o: Overlay) => void;
  onExit: () => void;
  refresh: () => void;
}

function PracticeScreens({ flow, playing, setPlaying, view, setView, overlay, setOverlay, onExit, refresh }: ScreensProps) {
  const state = useFlowState(flow);
  const settings = loadPracticeSettings();

  /** Starts play from a tap: the landscape request must happen inside the tap (fullscreen needs it on the web). */
  const play = (start: () => void) => {
    void lockLandscape();
    setOverlay(null);
    setPlaying(true);
    start();
  };
  const toMenu = () => {
    flow.leave();
    void unlockOrientation();
    setOverlay(null);
    setPlaying(false);
    setView('menu');
  };
  const seed = () => newSeed();
  const diagnostics = (
    <Diagnostics
      assessment={state.assessment}
      metrics={flow.localMetrics()}
      recentFps={flow.sessionFps()}
      lastInputToBatMs={flow.lastInputToBatMs()}
      onReset={refresh}
      onBack={() => (playing ? setOverlay(null) : setView('settings'))}
    />
  );
  const settingsScreen = (
    <PracticeSettings
      assessment={state.assessment}
      inningsInProgress={Boolean(flow.resumable())}
      onChanged={() => flow.refreshSettings()}
      onRerunCheck={() => flow.rerunDeviceCheck()}
      onCalibrate={() => (playing ? setOverlay('calibration') : setView('calibration'))}
      onDiagnostics={() => (playing ? setOverlay('diagnostics') : setView('diagnostics'))}
      onCleared={() => {
        flow.discardInnings();
        refresh();
      }}
      onBack={() => (playing ? setOverlay(null) : setView('menu'))}
    />
  );

  if (playing) {
    const inn = state.innings;
    return (
      <>
        <div inert={overlay !== null ? true : undefined} style={{ display: 'contents' }}>
          <Play
            flow={flow}
            state={state}
            hintsShown={settings.hintsShown}
            onMenu={toMenu}
            onSettings={() => setOverlay('settings')}
            onBuildNext={() => setOverlay('build')}
            onNewInnings={() => {
              void unlockOrientation();
              flow.leave();
              setPlaying(false);
              setView('menu');
            }}
          />
        </div>
        {overlay && (
          <div className={s.play} style={{ zIndex: 'var(--z-sheet)', overflowY: 'auto', touchAction: 'auto', background: 'var(--bg-app)' }}>
            {overlay === 'settings' && settingsScreen}
            {overlay === 'calibration' && <Calibration onBack={() => setOverlay('settings')} />}
            {overlay === 'diagnostics' && diagnostics}
            {overlay === 'build' && inn && (
              <BuildOver
                assist={inn.assist}
                handedness={inn.handedness}
                nextOver
                seed={seed}
                onBack={() => setOverlay(null)}
                onStart={(plan: PracticeOverPlan) => {
                  setOverlay(null);
                  void flow.startBuilt(plan);
                }}
              />
            )}
          </div>
        )}
      </>
    );
  }

  switch (view) {
    case 'build':
      return (
        <BuildOver
          assist={settings.assist}
          handedness={settings.handedness}
          nextOver={false}
          seed={seed}
          onBack={() => setView('menu')}
          onStart={(plan) => play(() => void flow.startBuilt(plan))}
        />
      );
    case 'settings':
      return settingsScreen;
    case 'calibration':
      return <Calibration onBack={() => setView('settings')} />;
    case 'diagnostics':
      return diagnostics;
    default:
      return (
        <Menu
          resumable={flow.resumable()}
          resumedLeave={state.notice === 'resumed_leave'}
          conditions={settings.conditions}
          storageOk={state.storageOk}
          onPitch={(p) => {
            updatePracticeSettings({ conditions: p });
            flow.refreshSettings();
            refresh();
          }}
          onRandom={() => play(() => void flow.startRandom())}
          onBuild={() => setView('build')}
          onContinue={() => play(() => void flow.continueInnings())}
          onDiscard={() => {
            flow.discardInnings();
            refresh();
          }}
          onSettings={() => setView('settings')}
          onCalibrate={() => setView('calibration')}
          onBack={onExit}
        />
      );
  }
}
