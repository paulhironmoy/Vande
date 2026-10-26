import type { AvatarSpec, KitSpec } from '@/contracts';
import { useT } from '@/i18n';
import { Avatar } from '../avatar/Avatar';
import { OutcomeBadge, type BallMark } from './OutcomeBadge';
import s from './ScoreBug.module.css';

export interface ScoreBugSide {
  alias: string;
  avatar: AvatarSpec;
  kit: KitSpec;
}

export interface ScoreBugProps {
  batting: ScoreBugSide;
  bowling: ScoreBugSide;
  runs: number | null;
  wickets: number | null;
  /** Balls of the current over (6, plus an optional Super Ball). */
  balls: BallMark[];
  target?: number | null;
  speedKph?: number | null;
  tag?: 'super_ball' | 'slow_mo' | 'sealed' | null;
}

/** Broadcast-inspired (original) score bug for the match stage. */
export function ScoreBug({ batting, bowling, runs, wickets, balls, target, speedKph, tag }: ScoreBugProps) {
  const { t } = useT();
  const sealed = runs === null;
  return (
    <div className={s.bug}>
      <div className={s.top}>
        <span className={s.team}>
          <Avatar avatar={batting.avatar} kit={batting.kit} size={28} decorative />
          <span className={s.alias}>{batting.alias}</span>
        </span>
        <span className={s.score} aria-label={sealed ? t('common.sealed') : t('common.score', { runs: runs ?? 0, wickets: wickets ?? 0 })}>
          {sealed ? '—' : `${runs}/${wickets}`}
        </span>
        {target ? <span className={s.target}>{t('stage.target', { n: target })}</span> : null}
        <span className={s.vs}>{t('common.vs')}</span>
        <span className={s.bowler}>
          <Avatar avatar={bowling.avatar} kit={bowling.kit} size={22} decorative />
          <span className={s.alias2}>{bowling.alias}</span>
        </span>
      </div>
      <div className={s.bottom}>
        <span className={s.balls}>
          {balls.map((m, i) => (
            <OutcomeBadge key={i} mark={m} size="sm" ball={i + 1} />
          ))}
        </span>
        {tag && <span className={s.tag} data-tag={tag}>{tag === 'super_ball' ? t('stage.super_ball') : tag === 'slow_mo' ? t('reveal.slow_mo') : t('common.sealed')}</span>}
        {speedKph ? <span className={s.speed}>{t('stage.speed_kph', { kph: Math.round(speedKph) })}</span> : null}
      </div>
    </div>
  );
}
