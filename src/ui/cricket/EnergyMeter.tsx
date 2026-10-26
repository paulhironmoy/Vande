import { useT } from '@/i18n';
import { Icon } from '../Icon';
import s from './EnergyMeter.module.css';

export interface EnergyMeterProps {
  used: number;
  total: number;
  /** Energy the currently selected delivery costs (highlighted inside the bar). */
  pending?: number;
  label?: string;
  compact?: boolean;
}

/** Segmented energy budget with a numeric readout; over-budget is shown with an icon and text, not colour alone. */
export function EnergyMeter({ used, total, pending = 0, label, compact }: EnergyMeterProps) {
  const { t } = useT();
  const over = used > total;
  const left = Math.max(0, total - used);
  return (
    <div className={[s.meter, compact ? s.compact : ''].join(' ')} data-over={over || undefined}>
      <div className={s.head}>
        <span className={s.title}>
          <Icon name="energy" size={16} />
          {label ?? t('plan.energy')}
        </span>
        <span className={s.value} aria-live="polite">
          {over ? (
            <>
              <Icon name="alert" size={15} />
              {t('plan.energy_over', { n: used - total })}
            </>
          ) : (
            t('plan.energy_left', { left, total })
          )}
        </span>
      </div>
      <div className={s.bar} role="meter" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.min(used, total)} aria-label={t('a11y.energy_meter', { used, total })}>
        {Array.from({ length: total }, (_, i) => {
          const state = i < used - pending ? 'used' : i < used ? 'pending' : 'free';
          return <span key={i} className={s.cell} data-state={state} />;
        })}
        {over && <span className={s.overflow} style={{ width: `${Math.min(30, ((used - total) / total) * 100)}%` }} />}
      </div>
    </div>
  );
}
