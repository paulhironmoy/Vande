/**
 * Practice, screen by screen: the home (choose an over), the predefined-over editor, settings, the timing check and
 * diagnostics; and the play surface (setup, the live over, Coach Mode, the summaries) whenever the flow has a screen
 * of its own. The play surface stays mounted while its stage is (between innings too), under the ordinary screens, so
 * the stage's shaders and first render are paid once per visit. This component owns which screen shows, the
 * landscape lock around play (requested inside the Play tap), the app's pause and resume, and orientation.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnalyticsEventName, AnalyticsProps } from '@/contracts';
import { useApp } from '@/app/store';
import { isNativePlatform } from '@/platform';
import { isLandscapeViewport, lockLandscape, onViewportOrientation, unlockOrientation } from '@/platform/orientation';
import { loadDraft, loadPracticeSettings, updatePracticeSettings } from '@/practice/store';
import type { Difficulty } from '@/contracts';
import { usePracticeT, type PracticeT } from '@/i18n/practice';
import { PracticeFlow, type FlowHooks, type FlowWords, type LastBall } from './flow/controller';
import { randomHex } from './flow/core';
import { StageRegionsContext, useFlowState, useKit } from './context';
import { outcomeWord, reasonWords } from './coaching';
import { prepareAudioUnlock } from './audioWarm';
import { acceptDefaultControl, setBattingGestureExclusion, startControls, subscribeControl } from './controls';
import { cameraGate } from './camera/gate';
import { defaultLessonInput } from './lesson/inputType';
import { bindPracticeLifecycle } from './lifecycle';
import { sys } from './design';
import { Calibration } from './screens/Calibration';
import { Diagnostics } from './screens/Diagnostics';
import { Home } from './screens/Home';
import { Play } from './screens/Play';
import { Predefined } from './screens/Predefined';
import { PracticeSettings } from './screens/PracticeSettings';
import { planFromDraft } from './screens/buildPlan';
import { FacilitatorPanel, TesterConsent } from './tester/TesterPanels';
import { useTester } from './tester/useTester';

export interface PracticeAppProps {
  appVersion: string;
  analytics?: (event: AnalyticsEventName, props?: AnalyticsProps) => void;
  hooks?: FlowHooks | null;
  /** performance.now() when Practice was chosen (the launch tap), for time to first delivery. */
  openedAt?: number;
  /** Leave Practice (deep links only: Practice is the app's first screen). */
  onExit?: () => void;
  /** Test builds: the controller, for the hooks. */
  onFlow?: (flow: PracticeFlow | null) => void;
}

type View = 'home' | 'predefined' | 'settings' | 'calibration' | 'diagnostics';
type Overlay = null | 'settings' | 'calibration' | 'diagnostics';

/**
 * The lines the flow speaks, politely, for screen readers: each ball's run-up and outcome, and in a chase what is needed
 * (the target with the first ball, then after each ball as the stage has shown it, and how the chase ended).
 */
function practiceWords(t: PracticeT): FlowWords {
  return {
    runup: (n, chase) => {
      const run = t.t('practice.live.announce_runup', { n });
      return chase && chase.ballsFaced === 0
        ? `${run} ${t.t('practice.chase.announce_start', { runs: chase.runsNeeded, balls: chase.ballsLeft })}`
        : run;
    },
    outcome: (last: LastBall, board) =>
      t.t('practice.live.announce', {
        result: outcomeWord(t, last.result.outcome).word,
        reason: reasonWords(t, last.result.coaching.reason, last.result),
        runs: board.runs,
        wickets: board.wickets,
      }),
    chase: (c) => {
      if (c.result === 'won') return t.t('practice.chase.announce_won', { runs: c.runs, balls: c.ballsFaced });
      if (c.result === 'lost_wicket' || c.result === 'lost_balls')
        return t.t('practice.chase.announce_lost', { short: c.runsNeeded });
      if (c.result !== 'in_progress') return '';
      return c.ballsLeft === 1
        ? t.t('practice.chase.announce_last', { runs: c.runsNeeded })
        : t.t('practice.chase.announce', { runs: c.runsNeeded, balls: c.ballsLeft });
    },
  };
}

export function PracticeApp({ appVersion, analytics, hooks, openedAt, onFlow }: PracticeAppProps) {
  const kit = useKit();
  const t = usePracticeT();
  const reducedMotion = useApp((st) => st.reducedMotion);
  const reduced = useRef(reducedMotion);
  reduced.current = reducedMotion;
  const [flow, setFlow] = useState<PracticeFlow | null>(null);

  // One controller per visit (created in the effect, so a development double-mount gets a fresh one).
  useEffect(() => {
    prepareAudioUnlock();
    const f = new PracticeFlow({
      engine: kit.engine,
      coach: kit.coach,
      work: hooks?.work === 'off' ? null : (kit.createWork?.() ?? null),
      createStage: kit.createStage,
      appVersion,
      analytics,
      hooks,
      openedAt,
      reducedMotion: () => reduced.current,
      isLandscape: isLandscapeViewport,
      newSeed: () => randomHex(),
      lesson: { input: () => defaultLessonInput() },
      camera: cameraGate,
      masteryFeel: (e) => kit.audio?.masteryFeel(e),
      deliveryContext: kit.audio ? (s) => kit.audio!.deliveryContext(s) : undefined,
      words: practiceWords(t),
    });
    setFlow(f);
    onFlow?.(f);
    f.init();
    return () => {
      onFlow?.(null);
      f.dispose();
      void unlockOrientation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the flow is created once on mount and disposed on unmount; it closes over the values of the first render
  }, []);

  // The stage is intentionally mounted once per visit. Refresh its native cue and the flow's future announcements
  // in place when the app language (or its asynchronously loaded catalog) changes.
  useEffect(() => {
    if (!flow) return;
    flow.setLanguage(t.locale, t.t('practice.live.hint'), practiceWords(t));
  }, [flow, t]);

  // The app went to the background (Android pause, a tab switch, the screen locking).
  useEffect(() => {
    if (!flow) return;
    return bindPracticeLifecycle(
      (hidden) => flow.setHidden(hidden),
      isNativePlatform() ? () => import('@capacitor/app') : undefined,
    );
  }, [flow]);

  useEffect(() => (flow ? onViewportOrientation((landscape) => flow.setLandscape(landscape)) : undefined), [flow]);

  // The chosen control ("How do you want to bat?"): the first-ball lesson teaches it, only the finger feels haptics, and
  // it can be switched between balls, never while a delivery is under way.
  useEffect(() => {
    if (!flow) return;
    const stop = startControls(() => !flow.busy());
    const off = subscribeControl(() => flow.refreshSettings());
    return () => {
      off();
      stop();
    };
  }, [flow]);

  if (!flow) return null;
  return (
    <div className={sys.root} style={{ display: 'contents' }}>
      <PracticeScreens flow={flow} appVersion={appVersion} />
    </div>
  );
}

function PracticeScreens({ flow, appVersion }: { flow: PracticeFlow; appVersion: string }) {
  const state = useFlowState(flow);
  const kit = useKit();
  const [view, setView] = useState<View>('home');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [, setTick] = useState(0);
  const refresh = () => setTick((n) => n + 1);
  const settings = loadPracticeSettings();
  const playing = state.screen !== 'idle';
  const inn = state.innings;
  const between = flow.betweenOvers();
  const tester = useTester(flow, state, appVersion);
  // The dead ball's card keeps off the ball's path on the Three.js stage (EVAL-WORLD K3; components/useCardPlacement.ts).
  const threeStage = state.quality.stage === '3d' && !flow.stageOwnsInput();
  const stageRegions = useMemo(() => (threeStage ? () => flow.protectedRegions() : null), [flow, threeStage]);
  const testerLayer = (
    <>
      {tester.consentNeeded && !playing && <TesterConsent tester={tester} />}
      {tester.active && <FacilitatorPanel tester={tester} hidden={flow.busy()} />}
    </>
  );

  // The first ball bowled with the setup's "How do you want to bat?" row untouched is an answer: the default is kept.
  useEffect(() => {
    if (state.screen === 'live') acceptDefaultControl();
  }, [state.screen]);

  // While a delivery is under way (or about to be) the Android shell leaves the screen's side edges to the batting
  // surface, so the system Back swipe cannot steal a stroke. Cleared the moment batting is not on.
  const batting = state.screen === 'live' && flow.busy();
  useEffect(() => {
    void setBattingGestureExclusion(batting);
  }, [batting]);
  useEffect(() => () => void setBattingGestureExclusion(false), []);

  const toHome = () => {
    if (state.screen === 'chase_result') flow.closeFinished();
    flow.leave();
    void unlockOrientation();
    setOverlay(null);
    setView('home');
  };
  const nextOver = () => {
    const kind = state.overKind ?? 'random';
    if (kind !== 'built') {
      flow.prepareOver({ kind });
      return;
    }
    // The player's own six again (a fresh seed, so a shuffled over shuffles anew), or the editor when there is none.
    const draft = loadDraft();
    let plan: ReturnType<typeof planFromDraft> | null;
    try {
      plan = draft
        ? planFromDraft(kit.build, draft, {
            assist: inn?.assist ?? settings.assist,
            conditions: inn?.conditions ?? 'balanced',
            seed: flow.seed(),
          })
        : null;
    } catch {
      plan = null;
    }
    if (plan) flow.prepareOver({ kind: 'built', plan });
    else {
      setView('predefined');
      flow.chooseNextOver();
    }
  };
  const harder: Difficulty | null =
    settings.difficulty === 'beginner' ? 'club' : settings.difficulty === 'club' ? 'expert' : null;
  const onHarder = harder
    ? () => {
        void lockLandscape();
        updatePracticeSettings({ difficulty: harder });
        flow.refreshSettings();
        flow.prepareOver({
          kind: 'random',
          random: { difficulty: harder, conditions: inn?.conditions ?? settings.conditions, bowling: settings.bowling },
        });
      }
    : null;
  const settingsScreen = (inPlay: boolean) => (
    <PracticeSettings
      assessment={state.assessment}
      inningsInProgress={Boolean(flow.resumable())}
      audio={kit.audio}
      onChanged={() => flow.refreshSettings()}
      onRerunCheck={() => flow.rerunDeviceCheck()}
      onCalibrate={() => (inPlay ? setOverlay('calibration') : setView('calibration'))}
      onDiagnostics={() => (inPlay ? setOverlay('diagnostics') : setView('diagnostics'))}
      onCleared={() => {
        flow.discardInnings();
        refresh();
      }}
      onBack={() => (inPlay ? setOverlay(null) : setView('home'))}
    />
  );
  const diagnostics = (inPlay: boolean) => (
    <Diagnostics
      assessment={state.assessment}
      metrics={flow.metrics}
      recentFps={flow.sessionFps()}
      lastInputToBatMs={flow.lastInputToBatMs()}
      onReset={refresh}
      onBack={() => (inPlay ? setOverlay('settings') : setView('settings'))}
    />
  );
  const play = (
    <div inert={overlay !== null || !playing ? true : undefined} style={{ display: 'contents' }}>
      <StageRegionsContext.Provider value={stageRegions}>
        <Play
          flow={flow}
          state={state}
          appVersion={appVersion}
          tester={tester}
          onHome={() => {
            if (state.screen === 'over_summary') tester.nextOver('exit');
            toHome();
          }}
          onSettings={() => setOverlay('settings')}
          onNextOver={() => {
            tester.nextOver('same');
            void lockLandscape();
            nextOver();
          }}
          onChooseOver={() => {
            tester.nextOver('different');
            flow.chooseNextOver();
          }}
          onHarder={
            onHarder
              ? () => {
                  tester.nextOver('harder');
                  onHarder();
                }
              : null
          }
        />
      </StageRegionsContext.Provider>
    </div>
  );

  if (playing) {
    return (
      <>
        {play}
        {testerLayer}
        {overlay && (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 'var(--z-sheet)', overflowY: 'auto', touchAction: 'auto' }}
          >
            {overlay === 'settings' && settingsScreen(true)}
            {overlay === 'calibration' && <Calibration onBack={() => setOverlay('settings')} />}
            {overlay === 'diagnostics' && diagnostics(true)}
          </div>
        )}
      </>
    );
  }

  let screen;
  switch (view) {
    case 'predefined':
      screen = (
        <Predefined
          assist={inn?.assist ?? settings.assist}
          handedness={inn?.handedness ?? settings.handedness}
          conditions={inn?.conditions ?? 'balanced'}
          seed={() => flow.seed()}
          onReference={() => {
            setView('home');
            flow.prepareOver({ kind: 'reference' });
          }}
          onOwn={(plan) => {
            setView('home');
            flow.prepareOver({ kind: 'built', plan });
          }}
          onBack={() => setView('home')}
        />
      );
      break;
    case 'settings':
      screen = settingsScreen(false);
      break;
    case 'calibration':
      screen = <Calibration onBack={() => setView('settings')} />;
      break;
    case 'diagnostics':
      screen = diagnostics(false);
      break;
    default:
      screen = (
        <Home
          mode={between ? 'next' : 'new'}
          resumable={flow.resumable()}
          notice={state.notice}
          storageOk={state.storageOk}
          chaseResume={flow.chase.resumeInfo()}
          onChoose={(kind) => {
            if (kind === 'predefined') setView('predefined');
            else if (kind === 'chase') {
              void lockLandscape();
              flow.chase.start();
            } else
              flow.prepareOver({
                kind: 'random',
                random: { difficulty: settings.difficulty, conditions: settings.conditions, bowling: settings.bowling },
              });
          }}
          onContinue={() => flow.continueInnings()}
          onDiscard={() => {
            flow.discardInnings();
            refresh();
          }}
          onSettings={() => setView('settings')}
          onBack={between ? () => flow.continueInnings() : null}
        />
      );
  }
  return (
    <>
      {state.stageReady && play}
      <div style={{ position: 'relative', zIndex: 2 }}>{screen}</div>
      {testerLayer}
    </>
  );
}
