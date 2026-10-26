import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { BallOutcome, MatchEventLog, ReplayMode } from '@/contracts';
import { BALLS_PER_OVER } from '@/contracts/cricket';
import { useT } from '@/i18n';
import { useBackHandler } from '@/app/back';
import { Avatar, BallTimeline, Button, Icon, IconButton, OutcomeBadge, SegmentedControl, markFromOutcome, type BallMark, type BallSlot } from '@/ui';
import type { FallbackReason, StageRenderer } from '@/render3d';
import { completeTimeline, locate, onTimelineChange, replayTimeline, resultTime } from '@/render3d/core/timeline';
import { MatchStage } from '../stage/MatchStage';
import { RevealOverlay } from './RevealOverlay';
import { Scorecard } from './Scorecard';
import { Tactics } from './Tactics';
import { anchorIn, autoBalls, defaultRevealMode, disclose, disclosedAt, indexLog } from './disclosure';
import { layoutTicks, neutralTrack, type TickIn } from './track';
import { commentaryText, outcomeText, resultText } from './text';
import s from './RevealScreen.module.css';

/** Commentary that gives the result away: announced only once the result card is up (or everything is disclosed). */
const RESULT_LINES = new Set([
  'commentary.chase_won',
  'commentary.chase_short',
  'commentary.super_ball_result',
  'commentary.result_runs',
  'commentary.result_super_ball',
  'commentary.result_wickets_lost',
  'commentary.result_boundaries',
  'commentary.result_tie',
  'commentary.turning_point',
  'commentary.player_of_match',
  'commentary.daily_score',
]);
/** Commentary that gives a tie away: announced once the Super Ball's card has played. */
const TIE_LINES = new Set(['commentary.scores_level', 'commentary.super_ball_intro']);

export type RematchState = 'idle' | 'sent' | 'offered';

export interface RevealScreenProps {
  log: MatchEventLog;
  /** Which player is "me" (for wording); spectators can omit it. */
  me?: 0 | 1;
  /**
   * Where the reveal starts. Omit it for the default, `defaultRevealMode(log)` (src/screens/reveal/disclosure.ts):
   * 'key_moments' for duels, cups, Practice Ghosts and Training (wickets, boundaries and the turning point, with Full
   * replay one tap away) and 'full' for a Daily Six attempt. 'full' plays every ball. 'result_only' opens on the result
   * with everything disclosed (a "see the result" link). In every other mode, results are disclosed only as playback
   * reaches them.
   */
  initialMode?: ReplayMode;
  /** Result of engine.verifyMatchLog (commit hashes and outcomes); null while checking or unknown. */
  verified?: boolean | null;
  onRematch?: () => void;
  /** Text of the rematch action (default "Rematch"), e.g. "Rematch sent · send again" or "Asha wants a rematch · Accept". */
  rematchLabel?: string;
  /**
   * 'idle' (default): the amber hero action. 'sent': already asked, so it is quieter (secondary). 'offered': the opponent
   * asked, so it becomes the screen's primary call to action and comes first.
   */
  rematchState?: RematchState;
  onShare?: () => void;
  onClose?: () => void;
  onFallback?: (reason: FallbackReason) => void;
  /** Start playing as soon as the stage is ready (default true). */
  autoplay?: boolean;
  /** Replay time to start from (ms), e.g. from a "watch from ball 4" link. Everything before it counts as seen. */
  startAt?: number;
  /** The replay reached its end (analytics: replay_completed). */
  onEnded?: () => void;
}

type Tab = 'scorecard' | 'tactics';
const SPEEDS = [1, 0.5, 0.25] as const;

/**
 * The cinematic reveal: both sealed innings play out ball by ball, with replay controls and explanations. Nothing is
 * given away early: the delivery timeline, the scrubber marks, the scorecard, the result and Player of the Match and
 * the live region disclose only what playback has reached (Skip, the result, the end and result_only show everything),
 * and seeking backwards never hides what was already seen.
 */
export function RevealScreen({
  log,
  initialMode,
  verified = null,
  onRematch,
  rematchLabel,
  rematchState = 'idle',
  onShare,
  onClose,
  onFallback,
  autoplay = true,
  startAt = 0,
  onEnded,
}: RevealScreenProps) {
  const tr = useT();
  const { t } = tr;
  // A full-screen replay is a layer: Android Back closes it first.
  useBackHandler(Boolean(onClose), () => onClose?.());
  const [mode, setMode] = useState<ReplayMode>(initialMode ?? defaultRevealMode(log));
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [tab, setTab] = useState<Tab>('scorecard');
  const [selected, setSelected] = useState<BallOutcome | null>(null);
  const renderer = useRef<StageRenderer | null>(null);
  // The scrubber's width in px, so labelled marks can give way to each other on a narrow phone.
  const ticksRef = useRef<HTMLDivElement>(null);
  const [ticksWidth, setTicksWidth] = useState(240);
  useEffect(() => {
    const el = ticksRef.current;
    if (!el) return;
    const read = () => setTicksWidth(el.getBoundingClientRect().width || 240);
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // The very timeline object the renderer plays (replayTimeline), so `time` maps alike. It is built progressively:
  // the first frame waits for the intro and the first ball only; each later ball lands in idle time (a new version).
  const timeline = useMemo(() => replayTimeline(log, mode), [log, mode]);
  const subscribe = useCallback((cb: () => void) => onTimelineChange(timeline, cb), [timeline]);
  const version = useSyncExternalStore(subscribe, () => timeline.version);
  const duration = timeline.duration;
  // The scrubber's neutral track: every match laid out alike, so its length and proportions give nothing away.
  const trackOpts = useMemo(() => ({ innings: log.kind === 'daily' ? (1 as const) : (2 as const), superBall: log.kind !== 'daily' }), [log.kind]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const track = useMemo(() => neutralTrack(timeline, trackOpts), [timeline, trackOpts, version]);
  const ix = useMemo(() => indexLog(log), [log]);
  const auto = useMemo(() => autoBalls(log), [log]);

  // Disclosure: the furthest log event playback has reached, kept as a high-water mark across seeks and modes.
  const now = disclosedAt(log, timeline, time);
  const [seen, setSeen] = useState({ id: log.matchId, upTo: -1 });
  const upTo = Math.max(seen.id === log.matchId ? seen.upTo : -1, now);
  useEffect(() => {
    setSeen((p) => (p.id !== log.matchId ? { id: log.matchId, upTo: now } : now > p.upTo ? { id: p.id, upTo: now } : p));
  }, [log.matchId, now]);
  const revealAll = () => setSeen({ id: log.matchId, upTo: ix.last });
  const disclosure = useMemo(() => disclose(log, ix, upTo), [log, ix, upTo]);

  const onReady = useCallback(
    (r: StageRenderer) => {
      renderer.current = r;
      if (startAt > 0) {
        r.seek(startAt);
        setTime(startAt);
      }
      if (autoplay) {
        r.play(speed);
        setPlaying(true);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [autoplay],
  );

  const play = () => {
    renderer.current?.play(speed);
    setPlaying(true);
  };
  const pause = () => {
    renderer.current?.pause();
    setPlaying(false);
  };
  const seek = (ms: number) => {
    renderer.current?.seek(ms);
    setTime(ms);
  };
  const skip = () => {
    seek(resultTime(timeline));
    revealAll();
  };
  const changeSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (playing) renderer.current?.play(next);
  };
  const changeMode = (m: ReplayMode) => {
    setMode(m);
    setTime(0);
    setPlaying(autoplay);
  };

  const at = locate(timeline, time);
  // The ball on screen when its result is not disclosed yet (shown as "now" in the timeline).
  const live = at.seg.kind === 'ball' && at.seg.eventIndex > upTo ? at.seg : null;

  // Delivery timeline: six neutral slots per innings until the innings is over; outcomes only once played.
  const inningsShown = log.kind === 'daily' ? ([0] as const) : ([0, 1] as const);
  const rows = inningsShown.map((i) => {
    const view = disclosure.innings[i];
    const balls = log.innings[i]?.balls ?? [];
    const slots: BallSlot[] = [];
    for (let k = 0; k < (view.ended ? balls.length : BALLS_PER_OVER); k++) {
      const mark: BallMark = k < view.shown ? markFromOutcome(balls[k]) : live && ix.balls[i][k] === live.eventIndex ? { kind: 'current' } : { kind: 'upcoming' };
      const kind = auto.main[i][k];
      // "Auto" under the badge, and the same said to screen readers (batted or bowled automatically).
      const note = kind ? (kind === 'both' ? `${t('auto.batted')}, ${t('auto.bowled')}` : t(kind === 'batted' ? 'auto.batted' : 'auto.bowled')) : undefined;
      slots.push({ mark, caption: kind ? t('auto.tag') : undefined, note });
    }
    const activeIndex = at.seg.kind === 'ball' && at.seg.innings === i ? ix.balls[i].indexOf(at.seg.eventIndex) : -1;
    return { i, slots, active: activeIndex >= 0 ? activeIndex : null };
  });
  const seekToBall = (inn: 0 | 1, idx: number) => {
    const e = ix.balls[inn][idx];
    if (e === undefined) return;
    const shown = disclosure.isShown(inn, idx);
    // An upcoming ball stays sealed: tapping it does nothing (the same whether or not it will be bowled).
    if (!shown && live?.eventIndex !== e) return;
    // Exact times for a jump: any ball still building is built now.
    completeTimeline(timeline);
    const seg = timeline.segments.find((x) => x.kind === 'ball' && x.eventIndex === e);
    if (seg) seek(seg.t0 + 1);
    if (shown) setSelected(log.innings[inn].balls[idx]);
  };

  // "Why it happened": the chosen ball, else the ball on screen once decided, else the latest ball played.
  const latestShown = useMemo(() => {
    let best = -1;
    for (const list of [ix.balls[0], ix.balls[1], ix.supers]) for (const e of list) if (e <= upTo && e > best) best = e;
    const ev = best >= 0 ? log.events[best] : null;
    return ev && ev.t === 'ball' ? ev.outcome : null;
  }, [ix, log, upTo]);
  const onScreen = at.seg.kind === 'ball' && at.seg.outcome && at.seg.eventIndex <= upTo ? at.seg.outcome : null;
  const tacticsBall = selected ?? onScreen ?? latestShown;

  // Live region: the line for the moment on screen, never ahead of it (commentary, else the ball or the result).
  // Lines that carry the result ("The chase falls 5 runs short.") wait for the result card, and the Super Ball's
  // "Locked together" for its own card, even during the held breath just before them.
  const anchor = mode === 'result_only' ? ix.result : anchorIn(log, at);
  const resultUp = mode === 'result_only' || disclosure.complete;
  const superUp = resultUp || disclosure.superStarted;
  const announcement = useMemo(() => {
    if (anchor < 0) return '';
    const may = (e: (typeof log.events)[number]) => e.t !== 'commentary' || (RESULT_LINES.has(e.key) ? resultUp : TIE_LINES.has(e.key) ? superUp : true);
    const own = log.events[anchor];
    const next = log.events[anchor + 1];
    if (next?.t === 'commentary' && may(next)) {
      const text = commentaryText(next, log, tr);
      if (text) return text;
    }
    if (own?.t === 'ball') return own.innings === 'super' ? `${t('reveal.super_ball')}: ${outcomeText(own.outcome, tr)}` : t('a11y.ball_state_result', { n: own.ball + 1, result: outcomeText(own.outcome, tr) });
    if (own?.t === 'result' && resultUp) return resultText(own.result, log, tr);
    for (let i = Math.min(anchor, log.events.length - 1); i >= 0; i--) {
      const e = log.events[i];
      if (e.t === 'commentary' && may(e)) {
        const text = commentaryText(e, log, tr);
        if (text) return text;
      }
    }
    return '';
  }, [anchor, log, tr, t, resultUp, superUp]);

  const mm = (ms: number) => {
    const sec = Math.floor(ms / 1000);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  };

  const potm = log.players[log.result.playerOfMatch];
  const shareButton = onShare && (
    <Button variant="secondary" size="lg" icon="share" onClick={onShare} data-testid="reveal-share">
      {t('common.share')}
    </Button>
  );
  const rematchButton = onRematch && (
    <Button variant={rematchState === 'offered' ? 'primary' : rematchState === 'sent' ? 'secondary' : 'accent'} size="lg" icon="rematch" onClick={onRematch} data-testid="reveal-rematch" data-state={rematchState}>
      {rematchLabel ?? t('common.rematch')}
    </Button>
  );

  return (
    <main className={s.screen} data-testid="reveal-screen">
      <h1 className="sr-only">{t('reveal.title')}</h1>
      <section className={s.stageWrap} aria-label={t('stage.label')}>
        <MatchStage
          replay={{ log, mode }}
          onReady={onReady}
          onTime={setTime}
          onEnd={() => {
            setPlaying(false);
            revealAll();
            onEnded?.();
          }}
          onFallback={onFallback}
          overlay={<RevealOverlay log={log} timeline={timeline} time={time} playing={playing} />}
        />
        {onClose && <IconButton className={s.close} icon="close" label={t('common.close')} onClick={onClose} variant="secondary" />}
      </section>

      <section className={s.controls} aria-label={t('reveal.title')}>
        <div className={s.transport}>
          <IconButton icon={playing ? 'pause' : 'play'} label={playing ? t('common.pause') : t('common.play')} variant="primary" size="lg" onClick={playing ? pause : play} data-testid="reveal-play" />
          <div className={s.scrub}>
            <input
              type="range"
              min={0}
              max={1000}
              step={1}
              value={Math.round(track.pos(time) * 1000)}
              onChange={(e) => seek((completeTimeline(timeline) ? neutralTrack(timeline, trackOpts) : track).time(Number(e.target.value) / 1000))}
              aria-label={t('a11y.timeline_seek')}
              aria-valuetext={disclosure.complete ? t('a11y.replay_position', { current: mm(time), total: mm(duration) }) : t('a11y.replay_elapsed', { current: mm(time) })}
              className={s.range}
              style={{ ['--p' as string]: `${track.pos(time) * 100}%` }}
              data-testid="reveal-scrub"
            />
            {/* Fixed zones: the second innings and a Super Ball zone that is always there, needed or not. */}
            <div className={s.zones} aria-hidden="true">
              {track.zones.map((z, i) => (
                <span key={i} className={s.zone} style={{ left: `${z * 100}%` }} />
              ))}
            </div>
            {/* Marks only for balls already played: no count, position or outcome of a ball still to come. Labels that
                would touch on a narrow track give way to the more telling one (see layoutTicks). */}
            <div className={s.ticks} aria-hidden="true" data-testid="reveal-ticks" ref={ticksRef}>
              {layoutTicks(
                timeline.segments.flatMap((seg): TickIn[] => {
                  if (seg.kind !== 'ball' || !seg.outcome || seg.eventIndex > upTo) return [];
                  const o = seg.outcome;
                  return [{ pos: track.pos(seg.t0), kind: o.wicket ? 'wicket' : o.runs === 6 ? 'six' : o.runs === 4 ? 'four' : 'ball' }];
                }),
                ticksWidth,
              ).map((tick, i) => (
                <span key={i} className={s.tick} data-kind={tick.kind} data-label={tick.label || undefined} style={{ left: `${tick.pos * 100}%` }}>
                  {tick.label ? (tick.kind === 'wicket' ? t('outcome.short.wicket') : tick.kind === 'six' ? '6' : '4') : null}
                </span>
              ))}
            </div>
            <div className={s.times}>
              <span data-testid="reveal-elapsed">{mm(time)}</span>
              {/* The total only once the result is known: a longer or shorter replay would hint at it. */}
              {disclosure.complete && <span data-testid="reveal-total">{mm(duration)}</span>}
            </div>
          </div>
          <Button variant={speed === 1 ? 'secondary' : 'primary'} icon="slowmo" onClick={changeSpeed} aria-label={`${t('reveal.slow_mo')}: ${t('reveal.speed', { x: speed })}`}>
            {t('reveal.speed', { x: speed })}
          </Button>
        </div>
        <div className={s.modeRow}>
          <SegmentedControl<ReplayMode>
            className={s.modes}
            label={t('reveal.title')}
            value={mode === 'result_only' ? 'full' : mode}
            onChange={changeMode}
            testId="reveal-mode"
            options={[
              { value: 'full', label: t('reveal.watch') },
              { value: 'key_moments', label: t('reveal.key_moments') },
            ]}
          />
          <Button variant="secondary" icon="skip" onClick={skip} aria-label={t('reveal.skip')} data-testid="reveal-skip">
            {t('reveal.skip_short')}
          </Button>
        </div>
        <p className={s.commentary} aria-live="polite" aria-atomic="true" data-empty={announcement ? undefined : 'true'} data-testid="reveal-live">
          {announcement && <Icon name="message" size={16} />}
          <span>{announcement}</span>
        </p>
        <div className={s.timeline} data-testid="reveal-timeline">
          <h2 className={s.h}>{t('reveal.timeline')}</h2>
          {rows.map((r) => (
            <div key={r.i} className={s.tlRow}>
              <span className={s.tlName}>
                {t('reveal.innings_n', { n: r.i + 1 })} · {log.players[log.innings[r.i].batter].alias}
              </span>
              <BallTimeline slots={r.slots} active={r.active} onSelect={(idx) => seekToBall(r.i, idx)} label={t('reveal.innings_n', { n: r.i + 1 })} size="sm" />
            </div>
          ))}
        </div>
      </section>

      {(rematchButton || shareButton) && (
        <footer className={s.footer}>
          {rematchState === 'offered' ? (
            <>
              {rematchButton}
              {shareButton}
            </>
          ) : (
            <>
              {shareButton}
              {rematchButton}
            </>
          )}
        </footer>
      )}

      <section className={s.details}>
        {disclosure.complete && (
          <div className={s.summary} data-testid="reveal-summary">
            <p className={s.summaryLine}>{resultText(log.result, log, tr)}</p>
            {log.kind !== 'daily' && potm && (
              <p className={s.potm}>
                <Avatar avatar={potm.avatar} kit={potm.kit} size={28} decorative />
                <span>
                  {t('reveal.player_of_match')}: <strong>{potm.alias}</strong>
                </span>
              </p>
            )}
          </div>
        )}
        <div className={s.tabs} role="tablist" aria-label={t('reveal.title')}>
          <button role="tab" type="button" aria-selected={tab === 'scorecard'} className={s.tab} onClick={() => setTab('scorecard')}>
            {t('reveal.scorecard')}
          </button>
          <button role="tab" type="button" aria-selected={tab === 'tactics'} className={s.tab} onClick={() => setTab('tactics')}>
            {t('reveal.tactics')}
          </button>
        </div>
        <div role="tabpanel">
          {tab === 'scorecard' ? (
            <Scorecard
              log={log}
              disclosure={disclosure}
              auto={auto}
              selected={selected}
              onSelect={(o) => {
                setSelected(o);
                setTab('tactics');
              }}
            />
          ) : tacticsBall ? (
            <Tactics outcome={tacticsBall} />
          ) : (
            <p className={s.empty}>
              <span aria-hidden="true">
                <OutcomeBadge mark={{ kind: 'upcoming' }} size="md" />
              </span>
              <span>{t('a11y.ball_state_upcoming', { n: 1 })}</span>
            </p>
          )}
        </div>
        <p className={s.verify}>
          {verified === true && (
            <>
              <Icon name="seal" size={16} /> {t('reveal.commit_verified')} ·{' '}
            </>
          )}
          {verified === false && (
            <>
              <Icon name="alert" size={16} /> {t('reveal.verify_failed')} ·{' '}
            </>
          )}
          {t('reveal.engine', { v: log.engine, seed: log.seed.slice(0, 8) })}
        </p>
      </section>
    </main>
  );
}
