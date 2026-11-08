/**
 * The play surface (landscape): the stage's canvas full screen, with the screen of the moment over it. PREPARE (the
 * setup, opaque, while the stage loads behind it), the live over (the quiet rail, the gesture surface across the
 * lower part, the compact results layer after each dead ball), Coach Mode, and the summaries. In Delivery Quiet Mode
 * nothing but the dimmed rail is shown, and nothing can be opened.
 */
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useBackHandler } from '@/app/back';
import { useApp } from '@/app/store';
import { lockLandscape } from '@/platform/orientation';
import { updatePracticeSettings } from '@/practice/store';
import { usePracticeT } from '@/i18n/practice';
import { PButton, PConfirm, sys } from '../design';
import { useKit } from '../context';
import { isQuiet, type FlowState, type PracticeFlow } from '../flow/controller';
import { StatusStrip } from '../components/StatusStrip';
import { FieldPip, FieldPipShown, type FieldPipPhase } from '../components/MiniRadar';
import { ResultLayer } from '../components/ResultLayer';
import { SessionBrief } from '../components/SessionBrief';
import { TesterPrompt } from '../tester/TesterPanels';
import type { TesterApi } from '../tester/useTester';
import { BriefSheet, Center, Hint, IntroPanel, Loading, PausePanel, ReplayBar, TurnPhone } from '../components/Panels';
import { bowlerStyle, primaryReasonLine, recommendationLine, tipLines, variationName } from '../coaching';
import { confirmedForThisBall, confirmedLine } from '../chase/scope';
import { TooSoonNote, WatchNote, useEarlyPress } from '../lesson/EarlyPress';
import { LessonTimingNote } from '../lesson/TimingNote';
import { CameraMount } from '../camera/mount';
import { TIMING_NOTE_BALLS, wantsTimingNote } from '../lesson/timing';
import { Coach } from './Coach';
import { Setup } from './Setup';
import { InningsSummary, OutSummary, OverSummary } from './Summaries';
import s from './Play.module.css';

/** The first-ball lesson: its own chunk, fetched only for a player who is about to meet it (never for a returning one). */
const loadLesson = () => import('../lesson/Lesson');
const Lesson = lazy(loadLesson);
/** The Target Chase's win and loss screen: its own chunk, fetched only when a chase has been decided. */
const ChaseResult = lazy(() => import('../chase/ChaseResult').then((m) => ({ default: m.ChaseResult })));

export interface PlayProps {
  flow: PracticeFlow;
  state: FlowState;
  /** Back to the Practice home (the innings stays saved). */
  onHome: () => void;
  onSettings: () => void;
  appVersion: string;
  /** The over summary's "Next over" (the same kind of over) and "Choose a different over". */
  onNextOver: () => void;
  onChooseOver: () => void;
  /** A harder Random Over, when there is one. */
  onHarder: (() => void) | null;
  /** The hidden tester mode (its questions show where the results layer would). */
  tester: TesterApi;
}

export function Play({ flow, state, onHome, onSettings, onNextOver, onChooseOver, onHarder, tester }: PlayProps) {
  const t = usePracticeT();
  const kit = useKit();
  const { input, coach, build } = kit;
  const setInPlay = useApp((st) => st.setInPlay);
  const [brief, setBrief] = useState(false);
  const [confirm, setConfirm] = useState<null | 'leave' | 'restart'>(null);
  const playRootRef = useRef<HTMLDivElement>(null);
  const unityKeyboardTargetRef = useRef<HTMLDivElement>(null);
  const { phase, screen, last } = state;
  const quiet = isQuiet(phase);
  const busy = flow.busy();
  const inn = state.innings;
  const midOver = Boolean(inn?.status === 'batting' && inn.current && inn.current.deliveries.length > 0);
  // A Target Chase: "Practice this ball" is off, the over is never restarted, and a second over follows the first.
  const chase = state.chase;
  const chaseOn = chase?.state.result === 'in_progress';
  const chaseMid = Boolean(chaseOn && chase && chase.state.ballsFaced > 0);
  // The first balls' teaching (the lesson card before ball 1; the timing in plain words on the dead ball).
  const teaching = flow.settings.teach && flow.settings.hintsShown < TIMING_NOTE_BALLS;
  const earlyPress = useEarlyPress(phase, teaching);
  useEffect(() => {
    if (flow.settings.teach && !flow.settings.lessonSeen && flow.deps.lesson) void loadLesson();
  }, [flow]);

  useEffect(() => {
    setInPlay(true);
    return () => setInPlay(false);
  }, [setInPlay]);
  useEffect(() => {
    if (busy) setBrief(false);
  }, [busy]);

  const leave = () => (midOver || chaseMid ? setConfirm('leave') : onHome());
  const back = () => {
    if (busy) return;
    if (brief) setBrief(false);
    else if (state.replay) flow.coachLoop.closeReplay();
    else if (screen === 'coach') flow.coachLoop.leaveCoach();
    else if (screen === 'setup') onHome();
    else if (screen === 'live' && phase === 'paused') leave();
    else if (screen === 'live') flow.pause();
    else onHome();
  };
  // Android Back and Escape: never during a delivery; otherwise close what is open, pause, then leave (confirmed).
  useBackHandler(true, back);
  const backRef = useRef(back);
  backRef.current = back;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) backRef.current();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const GestureSurface = input.GestureSurface;
  // The first session with teaching on: cricket words are glossed where they appear, and the setup starts minimal.
  const firstSession = flow.settings.teach && flow.metrics.innings === 0 && flow.metrics.deliveries < 6;
  // Footwork from where the press lands, for a player who skipped the teaching (the setup screen says how); a new
  // player keeps automatic footwork until it is taught.
  const pressFootwork = !flow.settings.teach;
  const notice = state.notice ? t.tk(`practice.notice.${state.notice}`) : null;
  // A change of timing help or of graphics, said calmly at the dead ball it arrived with (never during a delivery).
  const liveNotice =
    state.notice === 'help_changed' ||
    state.notice === 'help_less' ||
    state.notice === 'balanced' ||
    state.notice === 'classic' ||
    state.notice === 'camera_web'
      ? notice
      : null;
  const plan = inn?.current?.plan ?? state.pending?.plan ?? null;
  const ballLabel = plan ? t.tk(`practice.ball.short.${plan.ball.colour}_${plan.ball.age}`) : null;
  const inCoach = screen === 'coach' && state.coach;
  const showRail = screen === 'live' || inCoach;
  // A Unity stage owns both visible presentation and batting input. The DOM
  // remains only as a semantic accessibility mirror; showing its visual rail
  // would make WebGL and Android two different products.
  const unityStageOwnsInput = flow.stageOwnsInput();
  // Unity owns batting only while an authoritative delivery can still accept
  // the one gesture. Consequence playback, replay and the dead ball are visual
  // presentation: React owns every control and the canvas is inert there.
  const unityGameplayInput = unityStageOwnsInput && screen === 'live' && (phase === 'runup' || phase === 'live');
  useEffect(() => {
    if (!showRail || !unityGameplayInput) return;
    const onTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
      const root = playRootRef.current;
      const keyboardTarget = unityKeyboardTargetRef.current;
      if (!root || !keyboardTarget) return;
      const selector = [
        'button:not([disabled])',
        'a[href]',
        'input:not([disabled]):not([type="hidden"])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        'summary',
        '[tabindex]:not([tabindex="-1"])',
      ].join(',');
      const visible = (node: HTMLElement) => {
        if (node === keyboardTarget) return true;
        if (node.hidden || node.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
        for (let current: HTMLElement | null = node; current && current !== root; current = current.parentElement) {
          const style = window.getComputedStyle(current);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
        }
        return node.getClientRects().length > 0;
      };
      const stops = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(visible);
      if (!stops.length) return;
      const activeIndex = stops.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? activeIndex <= 0
          ? stops.length - 1
          : activeIndex - 1
        : activeIndex < 0 || activeIndex === stops.length - 1
          ? 0
          : activeIndex + 1;
      event.preventDefault();
      // Unity WebGL captures every keyboard event at window scope. Reserve Tab
      // for the semantic DOM focus order; batting keys continue to Unity.
      event.stopImmediatePropagation();
      stops[nextIndex].focus({ preventScroll: true });
    };
    window.addEventListener('keydown', onTab, true);
    return () => window.removeEventListener('keydown', onTab, true);
  }, [showRail, unityGameplayInput]);
  const deadInnings = screen === 'live' && phase === 'dead' && last;
  const pipPhase = fieldPipPhase(screen, phase, {
    unity: unityStageOwnsInput,
    replay: Boolean(state.replay),
    field: Boolean(state.field),
    stage: state.quality.stage,
  });
  // With no room for the inset below the rail (a large text size), or in a run-up where the rail and the inset would
  // exceed the run-up's screen budget, the conditions control's radar keeps the players.
  const [pipRoom, setPipRoom] = useState(true);
  const [pipQuietOver, setPipQuietOver] = useState(false);
  const pipShown = pipPhase !== null && pipRoom && !(pipPhase === 'quiet' && pipQuietOver);
  const ended = inn && inn.status !== 'batting';
  const nextLabel = chase
    ? chaseOn
      ? chase.state.ballsFaced % 6 === 0
        ? t.t('practice.chase.card.next_over')
        : t.t('practice.live.next_ball')
      : t.t('practice.chase.card.see_result')
    : ended
      ? inn.status === 'over_complete'
        ? t.t('practice.result.over_summary')
        : t.t('practice.result.see_summary')
      : t.t('practice.live.next_ball');
  useEffect(() => {
    if (!unityStageOwnsInput || screen !== 'live' || phase !== 'dead' || !last) return;
    const primary = state.insight?.status === 'ready' ? state.insight.primary : null;
    // Without a tip, a confirmation is said only when earned (anti-fake rule 7); otherwise the reason stands alone.
    const analysis = state.insight?.status === 'ready' ? state.insight.analysis : null;
    const earned =
      primary && analysis && coach
        ? coach.praiseEarned(analysis, primary.recommendation, state.insight?.tip ?? null)
        : true;
    // As on the React card: in a chase the coach's confirmation of a repeated response is about this ball (R-44 item 5).
    const forThisBall = Boolean(chase) && Boolean(primary) && earned && primary?.recommendation.kind === 'repeat_it';
    // The same one tip as the React card (its fact, then its one action), as Unity's two labelled lines.
    const words = primary && coach && state.insight?.tip ? coach.tipWords(t, state.insight.tip) : null;
    const tip = words ? tipLines(t, forThisBall ? confirmedForThisBall(t, words) : words) : null;
    const reason = tip
      ? tip.reason
      : primary
        ? primaryReasonLine(t, primary, last.result)
        : t.t('practice.result.reading');
    const recommendation = tip
      ? tip.recommendation
      : primary && earned
        ? forThisBall
          ? confirmedLine(t)
          : recommendationLine(t, primary.recommendation)
        : '';
    const practiceLabel = t.t('practice.result.practice');
    void flow.presentDeadBallUi(
      coach && !chase
        ? {
            reason,
            recommendation,
            primaryAction: 'practice_ball',
            primaryLabel: practiceLabel,
            secondaryAction: 'next_ball',
            secondaryLabel: nextLabel,
          }
        : {
            reason,
            recommendation,
            primaryAction: 'next_ball',
            primaryLabel: nextLabel,
            secondaryAction: null,
            secondaryLabel: null,
          },
    );
  }, [chase, coach, flow, last, nextLabel, phase, screen, state.insight, t, unityStageOwnsInput]);
  const detail = (() => {
    if (last && (phase === 'dead' || phase === 'paused')) {
      const b = last.result.flight.plan;
      return t.t('practice.status.last', {
        length: t.tk(`practice.length.${build.lengthBand(b.lengthM, last.record.bowler.family)}`),
        line: t.tk(`practice.lineband.${build.lineBand(b.lineM)}`),
      });
    }
    // A predefined over in its own order may show what comes next; a Random Over never does.
    const cur = inn?.current;
    if (
      cur &&
      (cur.plan.source === 'reference' || cur.plan.source === 'built') &&
      !cur.plan.shuffled &&
      cur.deliveries.length < 6
    ) {
      const b = cur.plan.balls[cur.deliveries.length];
      return t.t('practice.status.next', {
        variation: variationName(t, b.variation, cur.plan.bowler.spinType),
        length: t.tk(`practice.length.${build.lengthBand(b.lengthM, cur.plan.bowler.family)}`),
      });
    }
    return null;
  })();

  return (
    <div
      ref={playRootRef}
      className={s.play}
      data-play-root=""
      data-testid="practice-play"
      data-screen={screen}
      data-phase={phase}
      data-quiet={quiet ? 'true' : 'false'}
      data-stage={state.quality.stage}
      data-tier={state.quality.tier}
      data-unity-input={unityGameplayInput ? 'active' : 'blocked'}
    >
      <div className={s.stage} aria-hidden="true" data-testid="practice-world-stage">
        <canvas
          id="vande-unity-practice-canvas"
          key={`world:${state.canvasKey}`}
          ref={flow.attachCanvas}
          className={`${s.canvas} ${unityStageOwnsInput && !unityGameplayInput ? s.canvasInputBlocked : ''}`}
          data-testid="practice-canvas"
          data-gameplay-input={unityGameplayInput ? 'active' : 'blocked'}
        />
        <canvas
          id="vande-unity-practice-coach-canvas"
          key={`coach:${state.coachCanvasKey}`}
          ref={flow.attachCoachCanvas}
          className={`${s.canvas} ${s.coachCanvas}`}
          data-testid="practice-coach-canvas"
          aria-hidden="true"
        />
      </div>

      {screen === 'setup' && state.pending && (
        <Setup
          pending={state.pending}
          notice={state.notice}
          onRandom={(c) => {
            updatePracticeSettings({ difficulty: c.difficulty, conditions: c.conditions, bowling: c.bowling });
            flow.updateRandom(c);
          }}
          onAssist={(a) => {
            updatePracticeSettings({ assist: a });
            flow.refreshSettings();
            flow.setAssist(a);
          }}
          onPlay={() => {
            // Inside the tap: the browser allows fullscreen (and so the landscape lock) only here.
            void lockLandscape();
            void flow.play();
          }}
          onBack={onHome}
          firstSession={firstSession}
          pressFootwork={pressFootwork}
          chase={state.chase}
        />
      )}

      {pipPhase && state.field && (
        <FieldPip
          field={state.field}
          handedness={state.handedness}
          phase={pipPhase}
          side="right"
          onRoom={setPipRoom}
          onQuietOver={setPipQuietOver}
        />
      )}

      {showRail && !unityStageOwnsInput && (
        <FieldPipShown.Provider value={pipShown}>
          <StatusStrip
            board={state.board}
            status={inCoach ? { kind: 'coach', stage: state.coach!.mastery.stage } : { kind: 'practice' }}
            chase={chase ? chase.state : null}
            ballNumber={state.ball?.ballNumber ?? state.board.over.length + 1}
            field={state.field}
            intent={state.intent}
            bowler={plan?.bowler ?? state.ball?.bowler ?? null}
            conditions={state.conditions}
            ballLabel={ballLabel}
            assist={inn?.assist ?? flow.settings.assist}
            difficulty={
              plan && (plan.source === 'reference' || plan.source === 'built')
                ? undefined
                : (state.overDifficulty ?? null)
            }
            handedness={state.handedness}
            quiet={quiet || phase === 'ready'}
            live={phase === 'live' || phase === 'playing'}
            detail={deadInnings ? null : detail}
            onBrief={!busy && plan && state.field && screen === 'live' ? () => setBrief(true) : null}
            onPause={!busy && screen === 'live' && phase !== 'paused' ? () => flow.pause() : null}
          />
        </FieldPipShown.Provider>
      )}

      {showRail && unityGameplayInput && (
        <div
          ref={unityKeyboardTargetRef}
          className={s.unityKeyboardTarget}
          role="group"
          aria-label={t.t('practice.live.gesture_label')}
          tabIndex={0}
          data-testid="practice-unity-keyboard-target"
        />
      )}

      {showRail && unityStageOwnsInput && (
        <section className={s.unitySemanticHud} aria-label={t.t('practice.status.practice')}>
          <span>
            {t.t('practice.common.score', { runs: state.board.runs, wickets: state.board.wickets })}
            {' · '}
            {t.tk(`practice.pitch.${state.conditions}`)}
            {ballLabel ? ` · ${ballLabel}` : ''}
          </span>
          {chaseOn && chase && (
            <span data-testid="practice-unity-semantic-chase">
              {t.t('practice.chase.need', { runs: chase.state.runsNeeded, balls: chase.state.ballsLeft })}
            </span>
          )}
          {unityGameplayInput && (
            <button type="button" onClick={() => flow.requestUnityPause()} data-testid="practice-unity-semantic-pause">
              {t.t('practice.live.pause')}
            </button>
          )}
          {!busy && screen === 'live' && plan && state.field && (
            <>
              <span data-testid="practice-unity-semantic-setup-facts">
                {bowlerStyle(t, plan.bowler)}
                {' · '}
                {state.intent
                  ? t.tk(`practice.intent.short.${state.intent.intention}`)
                  : t.t('practice.status.practice')}
                {' · '}
                {t.tk(`practice.settings.assist.${inn?.assist ?? flow.settings.assist}`)}
              </span>
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => setBrief(true)}
                data-testid="practice-unity-semantic-brief"
              >
                {t.t('practice.brief.title')}
              </button>
            </>
          )}
        </section>
      )}

      {(screen === 'live' || screen === 'coach') && !unityStageOwnsInput && (
        <GestureSurface
          enabled={state.gesture.enabled && phase === 'live'}
          deliveryKey={state.gesture.key}
          onSwingStart={flow.onSwingStart}
          onIntent={flow.onSwingIntent}
          onCancel={flow.onGestureCancel}
          onContactState={flow.onContactState}
          onGesture={(input) => {
            tester.gesture(input);
            flow.onGesture(input);
          }}
          handedness={state.handedness}
          pressFootwork={pressFootwork}
          label={t.t('practice.live.gesture_label')}
          className={s.surface}
        />
      )}

      {phase === 'ready' && <Hint text={t.t('practice.live.hint')} accessibilityHidden={unityStageOwnsInput} />}
      {phase === 'intro' && (
        <IntroPanel onSkip={() => flow.skipTeaching(false)} onSkipAll={() => flow.skipTeaching(true)}>
          <WatchNote />
        </IntroPanel>
      )}
      {phase === 'lesson' && state.lesson && (
        <Suspense fallback={null}>
          <Lesson flow={flow} lesson={state.lesson} handedness={state.handedness} />
        </Suspense>
      )}
      {/* Camera batting only (its own lazy chunk): the card before a ball, the chip, the lost-tracking banner. */}
      <CameraMount flow={flow} state={state} />
      {screen === 'live' && phase === 'loading' && <Loading notice={notice} />}

      {deadInnings &&
        (tester.current ? (
          <TesterPrompt tester={tester} />
        ) : (
          <ResultLayer
            key={`${last.record.seed}:${last.overNumber}.${last.ballNumber}`}
            last={last}
            insight={state.insight}
            score={t.t('practice.result.score', {
              score: t.t('practice.common.score', { runs: state.board.runs, wickets: state.board.wickets }),
            })}
            nextLabel={nextLabel}
            canPractice={Boolean(coach) && !chase}
            practiceOff={chase ? t.t('practice.chase.card.no_practice') : null}
            onPractice={() => flow.acceptDeadBallAction('practice_ball')}
            onNext={() => flow.acceptDeadBallAction('next_ball')}
            onDemo={() => void flow.coachLoop.demonstrateLast()}
            onCloseUp={() => void flow.coachLoop.closeUpLast()}
            onSlowMo={() => flow.coachLoop.replayLast()}
            note={last.interrupted ? t.t('practice.notice.interrupted') : liveNotice}
            gloss={firstSession}
            teaching={
              wantsTimingNote(flow.settings.teach, flow.settings.hintsShown) ? (
                <>
                  {earlyPress && <TooSoonNote />}
                  <LessonTimingNote
                    contact={last.result.contact}
                    bands={kit.timingBands?.(last.record.assist, last.record.tierToleranceMs) ?? null}
                  />
                </>
              ) : null
            }
            edge={resultEdge(unityStageOwnsInput, state.quality.stage)}
          />
        ))}

      {inCoach &&
        !busy &&
        phase !== 'demo' &&
        (tester.current ? (
          <TesterPrompt tester={tester} />
        ) : (
          <Coach
            session={state.coach!}
            busy={busy}
            onReplay={() => void flow.coachLoop.replayExactBall()}
            onDemo={() => void flow.coachLoop.coachDemonstrate()}
            onBack={() => flow.coachLoop.leaveCoach()}
          />
        ))}
      {screen !== 'coach' && !(screen === 'live' && phase === 'dead') && tester.current && !busy && (
        <TesterPrompt tester={tester} />
      )}

      {state.replay && (
        <ReplayBar
          title={
            chase?.summary
              ? t.t('practice.chase.replay_title')
              : state.replay.items.length > 1
                ? t.t('practice.replay.over', { n: state.replay.items[0].overNumber })
                : t.t('practice.replay.ball', { n: state.replay.items[0].ballNumber })
          }
          index={state.replay.index}
          playing={state.replay.playing}
          onAgain={() => flow.coachLoop.replayAgain()}
          onClose={() => flow.coachLoop.closeReplay()}
        />
      )}

      {brief && plan && state.field && (
        <BriefSheet onClose={() => setBrief(false)}>
          <SessionBrief
            kind={state.overKind ?? 'random'}
            plan={plan}
            field={state.field}
            intent={state.intent}
            conditions={state.conditions}
            assist={inn?.assist ?? flow.settings.assist}
            handedness={state.handedness}
            difficulty={state.overDifficulty}
            map
          />
        </BriefSheet>
      )}

      {screen === 'live' && phase === 'paused' && (
        <PausePanel
          notice={notice}
          canRestart={!chase && midOver}
          onResume={() => flow.resume()}
          onRestart={() => setConfirm('restart')}
          onLeave={leave}
          onSettings={onSettings}
        />
      )}

      {screen === 'error' && (
        <Center>
          <section
            className={`${sys.card} ${s.error}`}
            role="alertdialog"
            aria-labelledby="practice-error-title"
            data-testid="practice-error"
          >
            <h2 id="practice-error-title" className={sys.section}>
              {t.t('practice.error.title')}
            </h2>
            <p className={sys.caption}>{t.t('practice.error.body')}</p>
            <PButton variant="primary" onClick={() => void flow.retry()} autoFocus data-testid="practice-error-retry">
              {t.t('practice.error.retry')}
            </PButton>
            <PButton variant="quiet" onClick={onHome} data-testid="practice-error-back">
              {t.t('practice.error.back')}
            </PButton>
          </section>
        </Center>
      )}

      {state.needLandscape && <TurnPhone onContinue={() => flow.allowPortrait()} />}

      {screen === 'over_summary' && (
        <OverSummary
          flow={flow}
          state={state}
          onHome={onHome}
          onNextOver={onNextOver}
          onChooseOver={onChooseOver}
          onHarder={onHarder}
        />
      )}
      {screen === 'out' && <OutSummary flow={flow} state={state} onHome={onHome} />}
      {screen === 'chase_result' && (
        <Suspense fallback={null}>
          <ChaseResult
            flow={flow}
            state={state}
            onAgain={() => {
              void lockLandscape();
              flow.chase.retry();
            }}
            onBack={onHome}
            onWatch={() => flow.chase.watchDecidingBall()}
            onPractise={coach ? () => flow.chase.practiseDecidingBall() : null}
          />
        </Suspense>
      )}
      {screen === 'complete' && <InningsSummary flow={flow} state={state} onHome={onHome} />}

      <PConfirm
        open={confirm === 'leave'}
        title={chase ? t.t('practice.chase.pause.leave_title') : t.t('practice.pause.leave_title')}
        body={chase ? t.t('practice.chase.pause.leave_body') : t.t('practice.pause.leave_body')}
        confirmLabel={t.t('practice.pause.leave')}
        cancelLabel={t.t('practice.common.cancel')}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          tester.abandon();
          onHome();
        }}
        testId="practice-leave-dialog"
      />
      <PConfirm
        open={confirm === 'restart'}
        title={t.t('practice.pause.restart_title')}
        body={t.t('practice.pause.restart_body')}
        confirmLabel={t.t('practice.pause.restart')}
        cancelLabel={t.t('practice.common.cancel')}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          flow.restartOver();
        }}
        testId="practice-restart-dialog"
      />
      <Announcer announce={state.announce} />
    </div>
  );
}

/**
 * The field inset (MiniRadar.tsx FieldPip): on the live screen, between balls and through each delivery (the stage
 * decides frame by frame what it shows, and hides it from the release until the fielding camera). Never in a replay,
 * a teaching view, the pause, or on Unity (which draws its own). It sits in the top-right corner below the rail on
 * every renderer, opposite the 3D dead-ball card. Classic's card takes the right half at the dead ball, and Classic's
 * main view is then the field from above (or, after a leave, the batter's view with no clear corner), so there it
 * steps out at the dead ball.
 */
export function fieldPipPhase(
  screen: FlowState['screen'],
  phase: FlowState['phase'],
  o: { unity: boolean; replay: boolean; field: boolean; stage: '3d' | '2d' },
): FieldPipPhase | null {
  if (screen !== 'live' || o.unity || o.replay || !o.field) return null;
  if (phase === 'ready') return 'calm';
  if (phase === 'runup') return 'quiet';
  if (phase === 'live' || phase === 'playing') return 'live';
  if (phase === 'dead' && resultEdge(false, o.stage) === 'left') return 'dead';
  return null;
}

/** Screen-reader announcements of each outcome (and each run-up), re-announced by id. */
/**
 * The dead ball card's edge, by renderer (measured: release/product-sequence/stage-1-practice/wedge/worker/): Unity's
 * rear-shoulder camera keeps the batter on the right, and the Three.js stage's protected regions at the dead ball are
 * a central column with its free side on the left; Classic's top-down field is centred over a full-width ball-path
 * strip, and its card sits in the right half above that strip.
 */
export function resultEdge(unity: boolean, stage: '3d' | '2d'): 'left' | 'right' {
  return !unity && stage === '2d' ? 'right' : 'left';
}

function Announcer({ announce }: { announce: FlowState['announce'] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && announce) ref.current.textContent = announce.text;
  }, [announce]);
  return <div ref={ref} className="sr-only" aria-live="polite" aria-atomic="true" data-testid="practice-announce" />;
}
