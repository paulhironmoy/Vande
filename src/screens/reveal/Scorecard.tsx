import { useMemo } from 'react';
import type { BallOutcome, MatchEventLog } from '@/contracts';
import { useT, type MessageKey } from '@/i18n';
import { Avatar, OutcomeBadge, markFromOutcome } from '@/ui';
import { fullDisclosure, type AutoKind, type AutoMap, type Disclosure } from './disclosure';
import { outcomeText } from './text';
import s from './Scorecard.module.css';

export interface ScorecardProps {
  log: MatchEventLog;
  /** Highlight and select a ball (tactics). */
  selected?: BallOutcome | null;
  onSelect?: (o: BallOutcome) => void;
  /** What playback has disclosed (default: everything). Balls, totals and Super Balls not played yet stay hidden. */
  disclosure?: Disclosure;
  /** Balls a stand-in played, labelled "Auto". */
  auto?: AutoMap;
}

/** Both innings, ball by ball: delivery, shot, timing and result (as far as the replay has got). */
export function Scorecard({ log, selected, onSelect, disclosure, auto }: ScorecardProps) {
  const tr = useT();
  const { t } = tr;
  const d = useMemo(() => disclosure ?? fullDisclosure(log), [disclosure, log]);
  // A Daily Six attempt is one innings against the day's sealed over (innings[1] is empty by design).
  const innings = log.kind === 'daily' ? ([0] as const) : ([0, 1] as const);
  const superBalls = log.kind !== 'daily' && log.superBall.used && log.superBall.outcomes && d.superStarted ? log.superBall.outcomes.slice(0, d.superShown) : null;
  const autoTag = (kind: AutoKind | null | undefined) =>
    kind ? (
      <span className={s.auto}>
        <span aria-hidden="true">{t('auto.tag')}</span>
        <span className="sr-only">{kind === 'both' ? `${t('auto.batted')}, ${t('auto.bowled')}` : t(kind === 'batted' ? 'auto.batted' : 'auto.bowled')}</span>
      </span>
    ) : null;
  return (
    <div className={s.card}>
      {innings.map((i) => {
        const inn = log.innings[i];
        const view = d.innings[i];
        const p = log.players[inn.batter];
        const total = view.ended ? { runs: inn.runs, wickets: inn.wickets } : { runs: view.runs, wickets: view.wickets };
        return (
          <section key={i} className={s.innings} aria-labelledby={`sc-${i}`}>
            <header className={s.head}>
              <Avatar avatar={p.avatar} kit={p.kit} size={36} decorative />
              <h3 id={`sc-${i}`} className={s.name}>
                <span className={s.eyebrow}>{t('reveal.innings_n', { n: i + 1 })}</span>
                {p.alias}
              </h3>
              {view.started ? (
                <span className={s.total}>{t('common.score', total)}</span>
              ) : (
                <span className={s.total} aria-label={t('common.sealed')} role="img">
                  —
                </span>
              )}
              <span className={s.balls}>{t('common.balls', { count: view.ended ? inn.ballsFaced : view.shown })}</span>
            </header>
            {view.shown > 0 && (
              <ol className={s.list}>
                {inn.balls.slice(0, view.shown).map((o) => (
                  <li key={o.ball}>
                    <button type="button" className={s.row} aria-pressed={selected === o} onClick={() => onSelect?.(o)}>
                      <OutcomeBadge mark={markFromOutcome(o)} size="md" ball={o.ball + 1} />
                      <span className={s.what}>
                        <span className={s.delivery}>
                          {t(`variant.${o.delivery.variant}` as MessageKey)} · {t(`length.${o.delivery.length}` as MessageKey)}
                        </span>
                        <span className={s.shot}>
                          {t(`shot.${o.shot}` as MessageKey)}
                          {o.zone ? ` → ${t(`zone.${o.zone}` as MessageKey)}` : ''} · {t(`timing.${o.timing}` as MessageKey)}
                        </span>
                      </span>
                      {autoTag(auto?.main[i][o.ball])}
                      <span className={s.result}>{outcomeText(o, tr)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>
        );
      })}
      {superBalls && (
        <section className={s.innings}>
          <header className={s.head}>
            <h3 className={s.name}>
              <span className={s.eyebrow}>{t('reveal.super_ball')}</span>
            </h3>
          </header>
          {superBalls.length > 0 && (
            <ol className={s.list}>
              {superBalls.map((o, i) => (
                <li key={i}>
                  <button type="button" className={s.row} aria-pressed={selected === o} onClick={() => onSelect?.(o)}>
                    <OutcomeBadge mark={markFromOutcome(o)} size="md" />
                    <span className={s.what}>
                      <span className={s.delivery}>{log.players[log.innings[i]?.batter ?? (i as 0 | 1)].alias}</span>
                      <span className={s.shot}>
                        {t(`shot.${o.shot}` as MessageKey)} · {t(`timing.${o.timing}` as MessageKey)}
                      </span>
                    </span>
                    {autoTag(auto?.super[i as 0 | 1])}
                    <span className={s.result}>{outcomeText(o, tr)}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}
