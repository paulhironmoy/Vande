import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import '../engineRules';
import type { BattingInput, DeliveryTiming, FieldZone, LiveBallHandle, RevealedDelivery, ShotFeedback, ShotType } from '@/contracts';
import { SUPER_BALL_INDEX } from '@/contracts';
import { useT, type MessageKey } from '@/i18n';
import { useBackHandler } from '@/app/back';
import { useApp } from '@/app/store';
import { BallTimeline, Button, FieldMap, Icon, StatusBanner, ZonePad, nearestLegal, type BallSlot } from '@/ui';
import { playContactFeel, playSwingFeel } from '@/audio';
import { PointerTrace, eventTime } from '@/input/pointer';
import type { StageRenderer } from '@/render3d';
import { MatchStage, type LiveSetupProps } from '../stage/MatchStage';
import { buildInput, predictContact, predictTiming, swipeZone, type Gesture } from './input';
import { timingMark } from './timingMark';
import { TimingMeter } from './TimingMeter';
import s from './BattingScreen.module.css';

const SHOTS: ShotType[] = ['defend', 'rotate', 'drive', 'cut_pull', 'sweep', 'loft', 'leave'];
const LATE_LIMIT_MS = 600;
/**
 * Once the server has answered, the feedback shows within this long even if the shot animation never settles (a
 * renderer that stopped drawing must never freeze the innings). Normally the animation ends well before.
 */
const SHOT_SETTLE_LIMIT_MS = 2500;

/** Resolves when `p` settles, or after `ms` at the latest. */
function settleWithin(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (import.meta.env.DEV) console.warn('[batting] the shot animation did not settle; showing the feedback');
      resolve();
    }, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    p.then(done, done);
  });
}

export interface NextBall {
  delivery: RevealedDelivery;
  ballsLeft: number;
}

export interface BattingScreenProps {
  setup: LiveSetupProps;
  /** Reveals the next delivery (the server starts the ball's clock now). Null when the innings is complete. */
  nextBall: () => Promise<NextBall | null>;
  /** Submits the raw input; resolves with sealed feedback (timing and contact only, never runs or wickets). */
  submitShot: (input: BattingInput) => Promise<ShotFeedback>;
  onComplete: () => void;
  onExit?: () => void;
  connectivity?: 'online' | 'offline' | 'reconnecting';
  /** Balls already faced (resuming an innings). */
  ballsFaced?: number;
  /** Total balls in this innings view (6, or 1 for a Super Ball). */
  totalBalls?: number;
  /** Training: start immediately, shorter pauses. */
  quickStart?: boolean;
  /** Optional caption (mode name, opponent). */
  title?: string;
  /** Called with each ball's sealed feedback (training uses it to move on). */
  onBallFeedback?: (feedback: ShotFeedback, index: number) => void;
  /** This innings view is the Super Ball. */
  superBall?: boolean;
  /** Extra content at the top of the controls (e.g. tutorial steps). */
  banner?: ReactNode;
  /** Smaller stage so the controls fit above the fold (tutorial). */
  compact?: boolean;
  /** The innings continues with the precommitted Super Ball after the six (server innings always face it). */
  includeSuperBall?: boolean;
}

type Phase = 'loading' | 'ready' | 'fetching' | 'runup' | 'live' | 'submitting' | 'feedback' | 'done' | 'error';

/**
 * Live batting. Pick a shot, then swipe towards your target as the ball arrives: letting go is your timing.
 * Feedback is sealed: timing and contact only. Keyboard: arrow keys aim, Space plays the shot.
 */
export function BattingScreen({ setup, nextBall, submitShot, onComplete, onExit, connectivity = 'online', ballsFaced = 0, totalBalls = 6, quickStart, title, onBallFeedback, superBall, banner, compact, includeSuperBall }: BattingScreenProps) {
  const { t } = useT();
  const textScale = useApp((st) => st.settings.textScale);
  // Android Back pauses the innings (a revealed ball stays resumable) instead of leaving the match.
  useBackHandler(Boolean(onExit), () => onExit?.());
  const [phase, setPhase] = useState<Phase>('loading');
  const [shot, setShot] = useState<ShotType>('drive');
  const [zone, setZone] = useState<FieldZone | null>('cover');
  const [faced, setFaced] = useState<ShotFeedback[]>([]);
  const [feedback, setFeedback] = useState<ShotFeedback | null>(null);
  const [delivery, setDelivery] = useState<RevealedDelivery | null>(null);
  /** The shot just played, for the feedback: what was aimed where, and when the tap landed. */
  const [played, setPlayed] = useState<{ shot: ShotType; zone: FieldZone | null; tapMs: number | null; timing: DeliveryTiming } | null>(null);
  const renderer = useRef<StageRenderer | null>(null);
  const ball = useRef<{ delivery: RevealedDelivery; handle: LiveBallHandle; receivedAt: number; releasedAt: number | null; done: boolean; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  /** The press on BAT in progress, timed from its own events (the keyboard's tap is made in onKey). */
  const gesture = useRef<PointerTrace | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const hitLabelId = useId();
  const hitHintId = useId();
  const shotRef = useRef(shot);
  const zoneRef = useRef(zone);
  shotRef.current = shot;
  zoneRef.current = zone;
  // While the sealed feedback shows, the ball just played stays the current one.
  const ballIndex = ballsFaced + faced.length - (phase === 'feedback' ? 1 : 0);

  const between = phase === 'ready' || phase === 'feedback';
  const refocus = useRef(false);
  useEffect(() => {
    if ((phase === 'runup' || phase === 'live') && refocus.current) {
      refocus.current = false;
      surface.current?.focus({ preventScroll: true });
    }
  }, [phase]);

  const pickShot = (sh: ShotType) => {
    setShot(sh);
    setZone((z) => nearestLegal(sh, z));
  };

  const finishBall = useCallback(
    async (tapAt: number | null, g: Gesture | null) => {
      const b = ball.current;
      if (!b || b.done) return;
      b.done = true;
      if (b.timer) clearTimeout(b.timer);
      const tapMs = tapAt !== null && b.releasedAt !== null ? tapAt - b.releasedAt : null;
      const sh = tapMs === null ? shotRef.current : shotRef.current;
      // clientElapsedMs runs to the tap itself (its event's timestamp); with no tap, to now.
      const input = buildInput({ delivery: b.delivery, shot: sh, zone: zoneRef.current, gesture: g, tapMs, receivedAt: b.receivedAt, now: tapAt ?? performance.now() });
      const timing = predictTiming(input.tapMs, b.delivery);
      const predicted = predictContact(sh, timing);
      // The tap is felt and heard at once, before the server answers (upgraded below when the answer lands).
      if (input.tapMs !== null) playSwingFeel(predicted, timing);
      setPlayed({ shot: sh, zone: input.zone, tapMs: input.tapMs, timing: b.delivery.timing });
      setPhase('submitting');
      const pending = submitShot(input);
      // Animate at once: with the true contact if the answer is quick (local engine), otherwise a prediction.
      const quick = await Promise.race([pending.then((f) => f).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 110))]);
      const anim = { shot: sh, timing: quick?.timing ?? timing, contact: quick?.contact ?? predicted, zone: input.zone, tapMs: input.tapMs };
      let shown = b.handle.showShot(anim as Parameters<LiveBallHandle['showShot']>[0]);
      try {
        const fb = await pending;
        // The real contact differs from the prediction: re-aim the animation and wait for that one.
        if (!quick && fb.contact !== anim.contact) shown = b.handle.showShot({ ...anim, contact: fb.contact, timing: fb.timing } as Parameters<LiveBallHandle['showShot']>[0]);
        if (input.tapMs !== null) playContactFeel(fb.contact, fb.timing, predicted, timing);
        await settleWithin(shown, SHOT_SETTLE_LIMIT_MS);
        setFeedback(fb);
        setFaced((f) => {
          onBallFeedback?.(fb, f.length);
          return [...f, fb];
        });
        setPhase('feedback');
      } catch {
        setPhase('error');
      }
    },
    [submitShot],
  );

  const bowlNext = useCallback(async () => {
    const r = renderer.current;
    if (!r) return;
    setPhase('fetching');
    setFeedback(null);
    let next: NextBall | null;
    try {
      next = await nextBall();
    } catch {
      setPhase('error');
      return;
    }
    if (!next) {
      setPhase('done');
      return;
    }
    const receivedAt = performance.now();
    const handle = r.bowl(next.delivery);
    ball.current = { delivery: next.delivery, handle, receivedAt, releasedAt: null, done: false, timer: null };
    gesture.current = null;
    setDelivery(next.delivery);
    setPhase('runup');
    const releasedAt = await handle.released;
    const b = ball.current;
    if (!b || b.handle !== handle) return;
    b.releasedAt = releasedAt;
    setPhase('live');
    // No shot by the end of the window: the selected shot is sent with no tap, which the engine grades as a leave.
    // A leave is safe wide of off stump, but a straight ball can still bowl the batter or trap them LBW.
    // A tap already queued when the window closes (a busy main thread) is handled first: the no-tap answer waits one
    // task, and every tap is judged by its own event timestamp.
    const remaining = releasedAt + next.delivery.timing.releaseToContactMs + LATE_LIMIT_MS - performance.now();
    b.timer = setTimeout(() => {
      b.timer = setTimeout(() => void finishBall(null, null), 0);
    }, Math.max(0, remaining));
  }, [nextBall, finishBall]);

  const onReady = useCallback(
    (r: StageRenderer) => {
      renderer.current = r;
      setPhase('ready');
      if (quickStart) void bowlNext();
    },
    [quickStart, bowlNext],
  );

  useEffect(
    () => () => {
      if (ball.current?.timer) clearTimeout(ball.current.timer);
    },
    [],
  );

  // ---- the hit gesture: one PointerTrace per press (event timestamps, coalesced moves) ---------------------------
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (phase !== 'live' && phase !== 'runup') return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    gesture.current = new PointerTrace(e.nativeEvent, e.currentTarget.getBoundingClientRect());
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    g.move(e.nativeEvent);
    const z = swipeZone(g);
    if (z) setZone(nearestLegal(shotRef.current, z));
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    g.end(e.nativeEvent);
    // Letting go is the tap, at the event's own timestamp: the same performance.now() clock as the rendered release.
    const tapAt = eventTime(e.nativeEvent);
    const b = ball.current;
    // A release before the ball leaves the hand is not a shot.
    if (!b || b.releasedAt === null || tapAt < b.releasedAt) return;
    const z = swipeZone(g);
    if (z) setZone(nearestLegal(shotRef.current, z));
    void finishBall(tapAt, g);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    const b = ball.current;
    // The key's own timestamp, like a pointer's (eventTime falls back to now where a browser gives none).
    const at = eventTime(e.nativeEvent);
    if (!b || b.releasedAt === null || at < b.releasedAt || b.done) return;
    void finishBall(at, { pointer: 'keyboard', t0: at - 60, samples: [[0, 0.5, 0.5], [60, 0.5, 0.5]] });
  };

  const playedCount = ballsFaced + faced.length;
  const slotCount = totalBalls + (includeSuperBall ? 1 : 0);
  const slots: BallSlot[] = Array.from({ length: slotCount }, (_, i) => ({
    superBall: includeSuperBall && i === totalBalls ? true : undefined,
    mark: i < playedCount ? { kind: 'sealed' } : i === ballIndex && phase !== 'done' ? { kind: 'current' } : { kind: 'upcoming' },
  }));
  const onSuperBall = superBall || (includeSuperBall && (delivery?.ball ?? (ballIndex >= totalBalls ? SUPER_BALL_INDEX : -1)) === SUPER_BALL_INDEX);
  const status =
    phase === 'loading'
      ? t('stage.loading')
      : phase === 'ready' || phase === 'fetching'
        ? t('bat.waiting_ball')
        : phase === 'runup'
          ? t('bat.waiting_ball')
          : phase === 'live' && delivery
            ? t('bat.incoming', { variant: t(`variant.${delivery.variant}` as MessageKey) })
            : phase === 'submitting'
              ? connectivity === 'online'
                ? t('bat.sending')
                : t('bat.queued')
              : '';

  return (
    <main className={s.screen} data-compact={compact || undefined} data-testid="batting-screen" data-phase={phase}>
      <section className={s.stageWrap}>
        <MatchStage
          live={setup}
          onReady={onReady}
          overlay={
            <div className={s.hud}>
              <div className={s.topRow}>
                <div className={s.ballInfo}>
                  <h1 className={s.eyebrow}>{title ?? t('bat.title')}</h1>
                  <span className={s.ballN}>{phase === 'done' ? t('bat.innings_done') : onSuperBall ? t('bat.super_ball') : totalBalls === 1 ? t('common.ball_n', { n: 1 }) : t('bat.ball_of', { n: Math.min(ballIndex + 1, totalBalls) })}</span>
                  <span className={s.facing}>{t('bat.facing', { name: setup.bowler.alias })}</span>
                </div>
                <div className={s.fieldBox}>
                  <FieldMap field={setup.field} zone={shot === 'defend' || shot === 'leave' ? null : zone} size={78} />
                  <span className={s.fieldLabel}>{t('bat.field_label', { field: t(`field.${setup.field}` as MessageKey) })}</span>
                </div>
              </div>
              {feedback && phase === 'feedback' && (
                <div className={s.feedback} role="status" data-testid="bat-feedback">
                  <Icon name="seal" size={22} />
                  <div className={s.fbBody}>
                    <strong className={s.fbMain}>
                      {t('bat.feedback', { timing: t(`timing.${feedback.timing}` as MessageKey), contact: t(`contact.${feedback.contact}` as MessageKey) })}
                    </strong>
                    {played && <FeedbackDetail played={played} grade={feedback.timing} />}
                    <span className={s.fbSub}>{t('bat.sealed_body')}</span>
                  </div>
                </div>
              )}
              {phase === 'live' && <span className={s.hint}>{t('bat.tap_hint')}</span>}
            </div>
          }
        />
      </section>

      <section className={s.controls}>
        {banner}
        {connectivity !== 'online' && <StatusBanner status={connectivity} />}
        <div className={s.statusRow}>
          <BallTimeline slots={slots} label={t('bat.title')} size="sm" />
        </div>
        <div className={s.shots} role="radiogroup" aria-label={t('bat.shot')}>
          {SHOTS.map((sh) => (
            <button key={sh} type="button" role="radio" aria-checked={shot === sh} className={s.shot} onClick={() => pickShot(sh)} title={t(`shot_hint.${sh}` as MessageKey)} data-testid={`bat-shot-${sh}`}>
              {t(`shot.${sh}` as MessageKey)}
            </button>
          ))}
        </div>
        {phase === 'done' ? (
          <div key="done" className={s.done}>
            <Icon name="seal" size={28} />
            <div>
              <h2 className={s.doneTitle}>{t('bat.innings_done')}</h2>
              <p className={s.doneBody}>{t('bat.innings_done_body')}</p>
            </div>
            <Button variant="primary" size="lg" block onClick={onComplete} data-testid="bat-done">
              {t('common.continue')}
            </Button>
          </div>
        ) : (
          <div key="play" className={s.play}>
            <ZonePad shot={shot} value={zone} onChange={(z) => setZone(z)} size={textScale >= 1.3 ? 128 : 148} disabled={phase === 'submitting'} />
            {/* Between balls, Play / Next ball sits where BAT is: always on screen, whatever the text size. */}
            <div className={s.hitWrap}>
              <div
                ref={surface}
                className={s.hit}
                data-live={phase === 'live' || undefined}
                data-armed={phase === 'runup' || undefined}
                role="button"
                tabIndex={between ? -1 : 0}
                data-testid="bat-hit"
                aria-labelledby={hitLabelId}
                aria-describedby={hitHintId}
                aria-disabled={phase !== 'live'}
                aria-hidden={between || undefined}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={() => (gesture.current = null)}
                onKeyDown={onKey}
              >
                <Icon name="bat" size={34} />
                <span className={s.hitLabel} id={hitLabelId}>
                  {t('bat.tap')}
                </span>
              </div>
              {between && (
                <Button
                  variant="primary"
                  size="lg"
                  className={s.nextOver}
                  onClick={() => {
                    // Keyboard users carry on from BAT itself once the ball is bowled.
                    refocus.current = true;
                    void bowlNext();
                  }}
                  data-testid="bat-next"
                >
                  {phase === 'ready' ? t('common.play') : t('bat.next_ball')}
                </Button>
              )}
            </div>
          </div>
        )}
        {phase !== 'done' && (
          <p className={s.hitSub} id={hitHintId}>
            {shot === 'defend' || shot === 'leave' ? t('bat.tap_hint') : t('bat.zone_hint')}
          </p>
        )}

        <div className={s.footer}>
          {onExit && (
            <Button variant="ghost" icon="back" onClick={onExit}>
              {t('common.back')}
            </Button>
          )}
          <span className={s.status} aria-live="polite">
            {status}
          </span>
          {phase === 'error' && (
            <Button variant="primary" icon="refresh" onClick={() => void bowlNext()} data-testid="bat-retry">
              {t('common.retry')}
            </Button>
          )}
        </div>
        <p className={s.shotHint}>{t(`shot_hint.${shot}` as MessageKey)}</p>
        <p className={s.note}>{t('bat.leave_note')}</p>
      </section>
    </main>
  );
}

/** Timing, contact and where the shot was aimed, with the meter: never runs or wickets. */
function FeedbackDetail({ played, grade }: { played: { shot: ShotType; zone: FieldZone | null; tapMs: number | null; timing: DeliveryTiming }; grade: ShotFeedback['timing'] }) {
  const { t } = useT();
  const shotName = t(`shot.${played.shot}` as MessageKey);
  const aim = played.zone && played.shot !== 'defend' && played.shot !== 'leave' ? t('bat.fb_aim', { shot: shotName, zone: t(`zone.${played.zone}` as MessageKey) }) : shotName;
  const mark = timingMark(played.timing, played.tapMs, grade);
  const when = !mark ? null : Math.abs(mark.offsetMs) <= 3 ? t('bat.fb_on_time') : mark.offsetMs < 0 ? t('bat.fb_early', { ms: -mark.offsetMs }) : t('bat.fb_late', { ms: mark.offsetMs });
  return (
    <>
      <span className={s.fbAim} data-testid="bat-feedback-detail">
        {when ? `${aim} · ${when}` : aim}
      </span>
      {mark && <TimingMeter timing={played.timing} mark={mark} />}
    </>
  );
}
