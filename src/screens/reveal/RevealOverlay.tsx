import { useMemo } from 'react';
import type { MatchEventLog } from '@/contracts';
import { useT, type MessageKey } from '@/i18n';
import { ScoreBug, type BallMark, markFromOutcome } from '@/ui';
import { Avatar } from '@/ui';
import { locate, scoreAt, type Timeline } from '@/render3d/core/timeline';
import { disclosedAt, indexLog, resultShown } from './disclosure';
import { resultText } from './text';
import s from './RevealOverlay.module.css';

export interface RevealOverlayProps {
  log: MatchEventLog;
  timeline: Timeline;
  time: number;
  playing: boolean;
}

/**
 * Broadcast layer over the stage: score bug, event graphics (FOUR / SIX / OUT), speed, result card. It shows the match
 * as it stands at the replay time (never a ball still to come). It is visual only: the reveal's live region announces.
 */
export function RevealOverlay({ log, timeline, time, playing }: RevealOverlayProps) {
  const tr = useT();
  const { t } = tr;
  const at = locate(timeline, time);
  const seg = at.seg;
  const score = scoreAt(timeline, time);
  const batting = log.players[score.batting];
  const bowling = log.players[score.batting === 0 ? 1 : 0];

  const ix = useMemo(() => indexLog(log), [log]);
  // What has been played at this replay time (in Key Moments that includes the balls skipped before the one on screen).
  const now = disclosedAt(log, timeline, time);
  const balls: BallMark[] = useMemo(() => {
    const innings = seg.innings ?? score.innings;
    if (innings === 'super') {
      // One slot: the Super Ball being played now.
      if (seg.kind !== 'ball' || !seg.outcome) return [{ kind: 'upcoming' }];
      return [seg.eventIndex <= now ? markFromOutcome(seg.outcome) : { kind: 'current' }];
    }
    return Array.from({ length: 6 }, (_, k): BallMark => {
      const e = innings === 0 || innings === 1 ? ix.balls[innings][k] : undefined;
      const ev = e === undefined ? null : log.events[e];
      if (e === undefined || !ev || ev.t !== 'ball') return { kind: 'upcoming' };
      if (e <= now) return markFromOutcome(ev.outcome);
      return seg.kind === 'ball' && seg.eventIndex === e ? { kind: 'current' } : { kind: 'upcoming' };
    });
  }, [seg, now, ix, log, score.innings]);

  // Event graphic and speed readout from the current ball's overlay track.
  const graphic = seg.kind === 'ball' ? [...seg.script.overlay].reverse().find((o) => o.kind !== 'speed' && at.scene >= o.t && at.scene < o.t + 2000) : undefined;
  const speed = seg.kind === 'ball' ? seg.script.overlay.find((o) => o.kind === 'speed' && at.scene >= o.t && at.scene < o.t + 2600) : undefined;
  const target = seg.innings === 1 ? log.innings[0].runs + 1 : null;
  const showBug = seg.kind === 'ball' || seg.kind === 'innings_start' || seg.kind === 'super_start';

  return (
    <div className={s.overlay} aria-live="off">
      {showBug && (
        <div className={s.bug}>
          <ScoreBug
            batting={batting}
            bowling={bowling}
            runs={score.score?.runs ?? 0}
            wickets={score.score?.wickets ?? 0}
            balls={balls}
            target={target}
            speedKph={speed?.value ?? null}
            tag={seg.innings === 'super' ? 'super_ball' : at.slow ? 'slow_mo' : null}
          />
        </div>
      )}
      {(seg.kind === 'innings_start' || seg.kind === 'super_start' || seg.kind === 'innings_end' || seg.kind === 'intro') && (
        <div className={s.card} data-kind={seg.kind}>
          <span className={s.eyebrow}>{seg.kind === 'super_start' ? t('reveal.super_ball') : seg.kind === 'innings_end' ? t('stage.innings_break') : seg.kind === 'intro' ? t(`pitch.${log.conditions.pitch}` as MessageKey) : t('reveal.innings_n', { n: (seg.innings === 1 ? 2 : 1) })}</span>
          <span className={s.cardTitle}>
            {seg.kind === 'intro' ? (
              <>
                {log.players[0].alias} <em>{t('common.vs')}</em> {log.players[1].alias}
              </>
            ) : seg.kind === 'innings_end' ? (
              t('common.score', { runs: log.innings[seg.innings === 1 ? 1 : 0].runs, wickets: log.innings[seg.innings === 1 ? 1 : 0].wickets })
            ) : (
              t('bat.facing', { name: log.players[seg.bowling].alias })
            )}
          </span>
          {seg.kind === 'intro' && <span className={s.cardSub}>{t(`weather.${log.conditions.weather}` as MessageKey)} · {t(`pitch_hint.${log.conditions.pitch}` as MessageKey)}</span>}
          {seg.kind === 'innings_start' && seg.innings === 1 && <span className={s.cardSub}>{t('stage.target', { n: log.innings[0].runs + 1 })}</span>}
        </div>
      )}
      {graphic && (
        <div className={s.graphic} data-kind={graphic.kind} key={`${at.index}-${graphic.kind}`}>
          <span className={s.graphicMain}>
            {graphic.kind === 'four'
              ? t('stage.four')
              : graphic.kind === 'six'
                ? t('stage.six')
                : graphic.kind === 'wicket'
                  ? t('stage.wicket')
                  : graphic.kind === 'runs'
                    ? t('outcome.runs', { runs: graphic.value ?? 1 })
                    : graphic.kind === 'dot'
                      ? t('outcome.dot')
                      : ''}
          </span>
          {graphic.kind === 'wicket' && graphic.wicket && <span className={s.graphicSub}>{t(`wicket.${graphic.wicket}` as MessageKey)}</span>}
        </div>
      )}
      {/* The held breath before the result: the picture darkens at the edges while the sound builds. */}
      {seg.kind === 'result' && !resultShown(at) && <div className={s.breath} data-testid="reveal-breath" style={{ ['--u' as string]: Math.min(1, at.scene / Math.max(1, seg.beat ?? 1)).toFixed(3) }} />}
      {resultShown(at) && (
        <div className={s.result} data-testid="reveal-result-card">
          <span className={s.eyebrow}>{t('reveal.title')}</span>
          <span className={s.resultTitle}>{resultText(log.result, log, tr)}</span>
          {log.kind !== 'daily' && (
            <span className={s.potm}>
              <Avatar avatar={log.players[log.result.playerOfMatch].avatar} kit={log.players[log.result.playerOfMatch].kit} size={34} decorative />
              <span>
                <span className={s.potmLabel}>{t('reveal.player_of_match')}</span>
                <strong>{log.players[log.result.playerOfMatch].alias}</strong>
              </span>
            </span>
          )}
        </div>
      )}
      {!playing && !resultShown(at) && <span className={s.paused}>{t('reveal.paused')}</span>}
    </div>
  );
}
