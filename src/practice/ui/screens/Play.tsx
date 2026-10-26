/**
 * The live screen (landscape): the stage's canvas, the GestureSurface across the lower part (so the finger never
 * covers the delivery), a minimal scoreboard, the pre-over field radar, the coaching card after each ball, the
 * warm-up explanation, the turn-your-phone overlay before a delivery, pause, notices and the replay controls. The
 * summaries render over the same stage, so a replay can play behind them without re-creating it.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, IconButton } from '@/ui';
import { useBackHandler } from '@/app/back';
import { useApp } from '@/app/store';
import { prefersPointerFine } from '@/platform/orientation';
import { usePracticeT } from '@/i18n/practice';
import { useKit } from '../context';
import type { FlowState, PracticeFlow } from '../flow/controller';
import { CoachingCard } from '../components/CoachingCard';
import { DiagnosticPanel } from '../components/DiagnosticPanel';
import { FieldRadar, fieldCounts } from '../components/FieldRadar';
import { Scoreboard } from '../components/Scoreboard';
import { Why } from '../components/Why';
import { OutSummary, OverSummary, InningsSummary } from './Summaries';
import s from './Play.module.css';

export interface PlayProps {
  flow: PracticeFlow;
  state: FlowState;
  /** Back to the Practice menu (the innings stays saved). */
  onMenu: () => void;
  onSettings: () => void;
  /** "Build the next over" from the over summary. */
  onBuildNext: () => void;
  /** "Start new innings" from the dismissal or ten-over summary. */
  onNewInnings: () => void;
  /** Deliveries the input hint has been shown for (it fades after a few). */
  hintsShown: number;
}

export function Play({ flow, state, onMenu, onSettings, onBuildNext, onNewInnings, hintsShown }: PlayProps) {
  const t = usePracticeT();
  const { input, engine, fielderClass } = useKit();
  const setInPlay = useApp((st) => st.setInPlay);
  const { phase, screen, last } = state;
  const busy = phase === 'runup' || phase === 'live' || phase === 'playing';
  const live = screen === 'live';

  useEffect(() => {
    setInPlay(true);
    return () => setInPlay(false);
  }, [setInPlay]);

  // Android Back and Escape: never during a delivery; otherwise close the replay, pause, or (paused) leave.
  useBackHandler(true, () => {
    if (busy) return;
    if (state.replay) flow.closeReplay();
    else if (live && phase !== 'paused') flow.pause();
    else onMenu();
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return;
      if (state.replay) flow.closeReplay();
      else if (live) phase === 'paused' ? flow.resume() : flow.pause();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [busy, live, phase, state.replay, flow]);

  const GestureSurface = input.GestureSurface;
  const warmup = state.ball?.kind === 'warmup';
  const repeat = state.ball?.kind === 'repeat';
  const outside = warmup ? t.t('practice.live.warmup') : repeat ? t.t('practice.common.not_counted') : null;
  const showHint = live && !state.replay && (warmup || hintsShown < 6) && (phase === 'runup' || phase === 'live');
  const notice = state.notice ? noticeText(t, state.notice) : null;
  // A modal panel is open: its notice is shown inside it (never under it), and the HUD's copy is hidden.
  const modal = live && (phase === 'paused' || phase === 'radar' || phase === 'warmup_explain' || state.needTap || state.needLandscape);
  const panelNotice = notice ? (
    <p className={s.panelNotice} role="status" data-testid="practice-panel-notice">
      {notice}
    </p>
  ) : null;

  return (
    <div className={s.play} data-testid="practice-play" data-screen={screen} data-phase={phase} data-stage={state.quality.stage} data-tier={state.quality.tier}>
      <div className={s.stage} aria-hidden="true">
        <canvas key={state.canvasKey} ref={flow.attachCanvas} className={s.canvas} data-testid="practice-canvas" />
      </div>

      {screen === 'preparing' && <Preparing />}
      {screen === 'compat' && <Compat state={state} onClassic={() => void flow.playClassic()} onBack={onMenu} />}
      {screen === 'error' && (
        <Center>
          <section className={s.panel} data-testid="practice-error">
            <h2>{t.t('practice.error.title')}</h2>
            <p>{t.t('practice.error.body')}</p>
            <div className={s.actions}>
              <Button variant="primary" onClick={onMenu}>
                {t.t('practice.common.back')}
              </Button>
            </div>
          </section>
        </Center>
      )}

      {live && (
        <div className={s.hud}>
          <div className={s.topLeft}>
            <Scoreboard board={state.board} bowler={state.ball?.bowler ?? null} conditions={state.conditions} outsideInnings={outside} />
            {notice && !modal && (
              <p className={s.notice} role="status" data-testid="practice-notice" data-notice={state.notice ?? ''}>
                {notice}
              </p>
            )}
          </div>
          {!state.replay && (
            <div className={s.topRight}>
              <IconButton icon="pause" label={t.t('practice.live.pause')} className={s.glassButton} onClick={() => flow.pause()} disabled={busy} data-testid="practice-pause" />
            </div>
          )}
          {(warmup || state.guided) && (phase === 'runup' || phase === 'live' || phase === 'idle') && (
            <p className={s.instruction} data-testid="practice-instruction">
              {t.t('practice.live.instruction')}
            </p>
          )}

          {phase === 'radar' && state.field && (
            <Center>
              <section className={`${s.panel} ${s.radarPanel}`} data-testid="practice-radar">
                <FieldRadar field={state.field} handedness={state.handedness} />
                <div className={s.prep} style={{ justifyItems: 'start', textAlign: 'start' }}>
                  <h2>{t.t('practice.live.field_title')}</h2>
                  {panelNotice}
                  <p>{t.t('practice.live.field_summary', { ...fieldCounts(state.field, fielderClass) })}</p>
                  <Button variant="primary" size="lg" icon="bat" onClick={() => flow.fieldReady()} data-testid="practice-radar-go">
                    {t.t('practice.live.field_go')}
                  </Button>
                </div>
              </section>
            </Center>
          )}

          {phase === 'coaching' && last && !state.replay && (
            <div className={s.coach}>
              <CoachingCard result={last.result} note={last.kind === 'repeat' ? t.t('practice.common.not_counted') : last.kind === 'warmup' ? t.t('practice.live.warmup') : null}>
                {last.kind === 'repeat' ? (
                  <>
                    <Button variant="primary" onClick={() => last.record && void flow.repeatBall(last.record)} data-testid="practice-repeat-again">
                      {t.t('practice.repeat.again')}
                    </Button>
                    <Button variant="secondary" onClick={() => flow.backToSummary()} data-testid="practice-repeat-back">
                      {t.t('practice.repeat.back')}
                    </Button>
                  </>
                ) : (
                  <Button variant="primary" iconEnd="forward" onClick={() => flow.nextBall()} data-testid="practice-next-ball">
                    {t.t('practice.live.next_ball')}
                  </Button>
                )}
                <Button variant="ghost" icon="slowmo" onClick={() => flow.replayLast()} data-testid="practice-slowmo">
                  {t.t('practice.live.slowmo')}
                </Button>
              </CoachingCard>
            </div>
          )}

          {phase === 'warmup_explain' && last && (
            <Center>
              <section className={s.panel} data-testid="practice-warmup-explain">
                <h2>{t.t('practice.why.title')}</h2>
                {panelNotice}
                <CoachingCard result={last.result} note={t.t('practice.live.warmup')} testId="practice-warmup-card" />
                <Why result={last.result} family={state.ball?.bowler.family} />
                <div className={s.actions}>
                  <Button variant="accent" size="lg" onClick={() => flow.startGuidedOver()} data-testid="practice-start-over">
                    {t.t('practice.why.start_over')}
                  </Button>
                  <Button variant="ghost" icon="slowmo" onClick={() => flow.replayLast()}>
                    {t.t('practice.live.slowmo')}
                  </Button>
                </div>
              </section>
            </Center>
          )}

          {state.replay && <ReplayControls flow={flow} state={state} />}

          {phase === 'paused' && (
            <Center>
              <section className={s.panel} role="dialog" aria-modal="true" aria-labelledby="practice-paused" data-testid="practice-paused">
                <h2 id="practice-paused">{t.t('practice.live.paused')}</h2>
                {panelNotice}
                <p>{t.t('practice.live.saved')}</p>
                <div className={s.actions}>
                  <Button variant="primary" size="lg" icon="play" onClick={() => flow.resume()} data-testid="practice-resume" autoFocus>
                    {t.t('practice.live.resume')}
                  </Button>
                  <Button variant="secondary" icon="settings" onClick={onSettings}>
                    {t.t('practice.menu.settings')}
                  </Button>
                  <Button variant="ghost" icon="home" onClick={onMenu} data-testid="practice-leave">
                    {t.t('practice.live.leave')}
                  </Button>
                </div>
              </section>
            </Center>
          )}

          <GestureSurface
            enabled={state.gesture.enabled && phase === 'live'}
            deliveryKey={state.gesture.key}
            onSwingStart={flow.onSwingStart}
            onGesture={flow.onGesture}
            handedness={state.handedness}
            label={t.t('practice.live.gesture_label')}
            className={s.surface}
          >
            {showHint && <span className={s.surfaceHint}>{t.t('practice.live.hint')}</span>}
          </GestureSurface>

          {state.needLandscape && <TurnPhone onContinue={() => flow.allowPortrait()} />}
          {state.needTap && !state.needLandscape && (
            <Center>
              <section className={s.panel} role="dialog" aria-modal="true" aria-labelledby="practice-ready" data-testid="practice-tap-gate">
                <h2 id="practice-ready">{t.t('practice.live.ready_title')}</h2>
                {panelNotice}
                <p>{t.t('practice.live.instruction')}</p>
                <div className={s.actions}>
                  <Button variant="accent" size="lg" icon="bat" onClick={() => flow.tapped()} autoFocus data-testid="practice-tap-go">
                    {t.t('practice.live.ready_go')}
                  </Button>
                </div>
              </section>
            </Center>
          )}
        </div>
      )}

      {screen === 'over_summary' && <OverSummary flow={flow} state={state} onBuildNext={onBuildNext} onMenu={onMenu} />}
      {screen === 'out' && <OutSummary flow={flow} state={state} onNewInnings={onNewInnings} onMenu={onMenu} />}
      {screen === 'complete' && <InningsSummary flow={flow} state={state} onNewInnings={onNewInnings} onMenu={onMenu} />}

      <Announcer announce={state.announce} />
      <span hidden data-testid="practice-engine-ready">{engine ? 'ready' : ''}</span>
    </div>
  );
}

function noticeText(t: ReturnType<typeof usePracticeT>, n: NonNullable<FlowState['notice']>): string {
  switch (n) {
    case 'lite':
      return t.t('practice.notice.lite');
    case 'classic':
      return t.t('practice.notice.classic');
    case 'interrupted':
      return t.t('practice.live.interrupted');
    case 'resumed_leave':
      return t.t('practice.menu.resumed_leave');
  }
}

function Center({ children }: { children: ReactNode }) {
  return <div className={s.center}>{children}</div>;
}

/** Shown while the stage loads and the device check runs (up to about 6 s on a slow, software-rendered device). */
function Preparing() {
  const t = usePracticeT();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => setElapsed(Date.now() - start), 500);
    return () => window.clearInterval(id);
  }, []);
  // Honest, time-based reassurance: the check has no meaningful percentage, so the bar is indeterminate.
  const step = elapsed < 1500 ? t.t('practice.prep.step_stage') : elapsed < 3500 ? t.t('practice.prep.step_check') : t.t('practice.prep.step_slow');
  return (
    <Center>
      <section className={`${s.panel} ${s.prep}`} data-testid="practice-preparing">
        <span className={s.ball} aria-hidden="true" />
        <h2>{t.t('practice.prep.title')}</h2>
        <p>{t.t('practice.prep.body')}</p>
        <div className={s.progress} role="progressbar" aria-label={t.t('practice.prep.title')} aria-valuetext={step} />
        <p className={s.step} role="status" aria-live="polite">
          {step}
        </p>
      </section>
    </Center>
  );
}

function Compat({ state, onClassic, onBack }: { state: FlowState; onClassic: () => void; onBack: () => void }) {
  const t = usePracticeT();
  const a = state.assessment;
  const reasons = (a?.reasons ?? []).filter((r) => t.has(`practice.compat.reason.${r}`));
  return (
    <Center>
      <section className={s.panel} data-testid="practice-compat" data-reasons={(a?.reasons ?? []).join(' ')}>
        <h2>{t.t('practice.compat.title')}</h2>
        <p>{t.t('practice.compat.body')}</p>
        {reasons.length > 0 && (
          <>
            <h3 className="sr-only">{t.t('practice.compat.why')}</h3>
            <ul className={s.reasons}>
              {reasons.map((r) => (
                <li key={r}>{t.tk(`practice.compat.reason.${r}`, { fps: Math.round(a?.avgFps ?? 0) })}</li>
              ))}
            </ul>
          </>
        )}
        <div className={s.actions}>
          <Button variant="primary" size="lg" onClick={onClassic} data-testid="practice-classic" autoFocus>
            {t.t('practice.compat.play')}
          </Button>
          <Button variant="ghost" onClick={onBack}>
            {t.t('practice.common.back')}
          </Button>
        </div>
      </section>
    </Center>
  );
}

function TurnPhone({ onContinue }: { onContinue: () => void }) {
  const t = usePracticeT();
  return (
    <div className={s.turn} role="dialog" aria-modal="true" aria-labelledby="practice-turn" data-testid="practice-turn">
      <div className={s.turnInner}>
        <svg className={s.turnIcon} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="7" y="2.5" width="10" height="19" rx="2" />
          <path d="M11 18.5h2" strokeLinecap="round" />
        </svg>
        <h2 id="practice-turn" style={{ margin: 0 }}>
          {t.t('practice.live.turn_title')}
        </h2>
        <p style={{ margin: 0, color: 'var(--t-secondary)' }}>{t.t('practice.live.turn_body')}</p>
        {prefersPointerFine() && (
          <Button variant="secondary" onClick={onContinue} data-testid="practice-turn-continue">
            {t.t('practice.live.turn_continue')}
          </Button>
        )}
      </div>
    </div>
  );
}

function ReplayControls({ flow, state }: { flow: PracticeFlow; state: FlowState }) {
  const t = usePracticeT();
  const r = state.replay!;
  const item = r.items[r.index];
  const record = state.innings ? (state.innings.overs[item.overNumber - 1]?.deliveries ?? state.innings.current?.deliveries ?? []).find((d) => d.ballIndex === item.ballNumber - 1) ?? null : null;
  const title = r.kind === 'over' ? t.t('practice.replay.over', { n: item.overNumber }) : t.t('practice.replay.ball', { n: item.ballNumber });
  return (
    <>
      {r.diag && (
        <div className={s.diagPanel}>
          <DiagnosticPanel result={item.result} record={record} />
        </div>
      )}
      <div className={s.replayBar} role="toolbar" aria-label={title} data-testid="practice-replay" data-index={r.index} data-playing={r.playing ? 'true' : 'false'}>
        <span className={s.replayTitle}>{title}</span>
        {r.items.length > 1 && (
          <>
            <IconButton icon="back" label={t.t('practice.replay.prev')} onClick={() => flow.replaySelect(r.index - 1)} disabled={r.index === 0} />
            <span aria-live="polite">{t.t('practice.common.ball_n', { n: item.ballNumber })}</span>
            <IconButton icon="forward" label={t.t('practice.replay.next')} onClick={() => flow.replaySelect(r.index + 1)} disabled={r.index >= r.items.length - 1} />
          </>
        )}
        <Button variant={r.slow ? 'primary' : 'secondary'} icon="slowmo" aria-pressed={r.slow} onClick={() => flow.replayToggle('slow')} data-testid="practice-replay-slow">
          {t.t('practice.replay.slow')}
        </Button>
        <Button variant={r.diag ? 'primary' : 'secondary'} icon="target" aria-pressed={r.diag} onClick={() => flow.replayToggle('diag')} data-testid="practice-replay-diag">
          {t.t('practice.replay.diag')}
        </Button>
        {!r.playing && (
          <Button variant="secondary" icon="replay" onClick={() => flow.replaySelect(r.index)}>
            {t.t('practice.replay.again')}
          </Button>
        )}
        <Button variant="ghost" icon="close" onClick={() => flow.closeReplay()} data-testid="practice-replay-close">
          {t.t('practice.replay.close')}
        </Button>
      </div>
    </>
  );
}

/** Screen-reader announcements of each outcome (and each run-up), re-announced by id. */
function Announcer({ announce }: { announce: FlowState['announce'] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && announce) ref.current.textContent = announce.text;
  }, [announce]);
  return <div ref={ref} className="sr-only" aria-live="polite" aria-atomic="true" data-testid="practice-announce" />;
}

