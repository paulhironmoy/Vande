import type { DeliveryTiming } from '@/contracts';
import { useT } from '@/i18n';
import { meterBands, type TimingMark } from './timingMark';
import s from './TimingMeter.module.css';

/**
 * Early ← perfect → late, with a marker where the tap landed. Decorative for screen readers: the same reading is in
 * the feedback text next to it.
 */
export function TimingMeter({ timing, mark }: { timing: DeliveryTiming; mark: TimingMark }) {
  const { t } = useT();
  const b = meterBands(timing);
  const pct = (f: number) => `${(50 + f * 50).toFixed(2)}%`;
  const lo = (f: number) => `${(50 - f * 50).toFixed(2)}%`;
  const tone = Math.abs(mark.offsetMs) <= timing.perfectMs ? 'perfect' : Math.abs(mark.offsetMs) <= timing.goodMs ? 'good' : Math.abs(mark.offsetMs) <= timing.edgeMs ? 'edge' : 'wide';
  return (
    <div className={s.meter} aria-hidden="true" data-testid="bat-timing-meter" data-tone={tone}>
      <div
        className={s.bar}
        style={{
          ['--p0' as string]: lo(b.perfect),
          ['--p1' as string]: pct(b.perfect),
          ['--g0' as string]: lo(b.good),
          ['--g1' as string]: pct(b.good),
          ['--e0' as string]: lo(b.edge),
          ['--e1' as string]: pct(b.edge),
        }}
      >
        <span className={s.mark} style={{ left: `${(mark.pos * 100).toFixed(2)}%` }} />
      </div>
      <div className={s.labels}>
        <span>{t('timing.early')}</span>
        <span>{t('timing.perfect')}</span>
        <span>{t('timing.late')}</span>
      </div>
    </div>
  );
}
