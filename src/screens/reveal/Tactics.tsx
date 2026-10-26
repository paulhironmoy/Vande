import type { BallOutcome, OutcomeFactors } from '@/contracts';
import { useT, type MessageKey } from '@/i18n';
import { OutcomeBadge, markFromOutcome } from '@/ui';
import { explainText, outcomeText } from './text';
import s from './Tactics.module.css';

const FACTORS: Array<keyof Omit<OutcomeFactors, 'risk' | 'explainKey'>> = ['matchup', 'timing', 'execution', 'pitch', 'field', 'setup'];

/** "Why it happened": the engine's factors as diverging bars (batter side vs bowler side) and a one-line reason. */
export function Tactics({ outcome }: { outcome: BallOutcome }) {
  const tr = useT();
  const { t } = tr;
  return (
    <div className={s.tactics}>
      <div className={s.head}>
        <OutcomeBadge mark={markFromOutcome(outcome)} size="lg" />
        <div>
          <p className={s.title}>
            {t(`variant.${outcome.delivery.variant}` as MessageKey)} → {t(`shot.${outcome.shot}` as MessageKey)} · {outcomeText(outcome, tr)}
          </p>
          <p className={s.explain}>{explainText(outcome, tr)}</p>
        </div>
      </div>
      <div className={s.legend} aria-hidden="true">
        <span>◀ {t('reveal.factor_for_bowler')}</span>
        <span>{t('reveal.factor_for_batter')} ▶</span>
      </div>
      <ul className={s.bars}>
        {FACTORS.map((f) => {
          const v = Math.max(-1, Math.min(1, outcome.factors[f]));
          const side = Math.abs(v) < 0.05 ? t('reveal.factor_neutral') : v > 0 ? t('reveal.factor_for_batter') : t('reveal.factor_for_bowler');
          return (
            <li key={f} className={s.row} aria-label={`${t(`reveal.factor.${f}` as MessageKey)}: ${side}`}>
              <span className={s.name}>{t(`reveal.factor.${f}` as MessageKey)}</span>
              <span className={s.track}>
                <span className={s.mid} />
                <span className={s.fill} data-side={v >= 0 ? 'bat' : 'bowl'} style={{ width: `${Math.abs(v) * 50}%`, [v >= 0 ? 'left' : 'right']: '50%' }} />
              </span>
              <span className={s.sign}>{v > 0.05 ? '+' : v < -0.05 ? '−' : '='}</span>
            </li>
          );
        })}
        <li className={s.row} aria-label={`${t('reveal.factor.risk')}: ${Math.round(outcome.factors.risk * 100)}%`}>
          <span className={s.name}>{t('reveal.factor.risk')}</span>
          <span className={s.track}>
            <span className={s.fill} data-side="risk" style={{ width: `${outcome.factors.risk * 100}%`, left: 0 }} />
          </span>
          <span className={s.sign}>{Math.round(outcome.factors.risk * 100)}%</span>
        </li>
      </ul>
    </div>
  );
}
