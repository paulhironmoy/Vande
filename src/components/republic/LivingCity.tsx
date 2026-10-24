import type { RepublicCondition } from '@/engine/types';
import { CityScene, sceneFromCondition } from './CityScene';
import styles from './LivingCity.module.css';

interface LivingCityProps {
  condition: RepublicCondition;
  label: string;
  summary: string;
  animated?: boolean;
  /** Override measure labels (Simple play style). */
  labels?: Partial<Record<'freedom' | 'safety' | 'trust' | 'economy' | 'legitimacy', string>>;
}

const MEASURES: { key: keyof Pick<RepublicCondition, 'freedom' | 'safety' | 'trust' | 'economy' | 'legitimacy'>; label: string; tone: string }[] = [
  { key: 'freedom', label: 'Freedom', tone: 'var(--o-freedom)' },
  { key: 'safety', label: 'Safety', tone: 'var(--o-safety)' },
  { key: 'trust', label: 'Trust', tone: 'var(--o-trust)' },
  { key: 'economy', label: 'Economy', tone: 'var(--o-economy)' },
  { key: 'legitimacy', label: 'Legitimacy', tone: 'var(--o-legitimacy)' },
];

/** The persistent Republic as a living city plus five measures. */
export function LivingCity({ condition, label, summary, animated = true, labels }: LivingCityProps) {
  const detail = Math.max(0, Math.min(1, 0.3 + condition.crises * 0.07));
  const scene = sceneFromCondition(condition);
  return (
    <div>
      <div className={styles.wrap}>
        <CityScene {...scene} detail={detail} animated={animated} title={`Your Republic: ${label}. ${summary}`} className={styles.scene} />
        <div className={styles.overlay}>
          <div className={styles.condition}>
            <span className={styles.conditionLabel}>{label}</span>
            <span className={styles.conditionSub}>{summary}</span>
          </div>
        </div>
      </div>
      <ul className={styles.measures} aria-label="Republic measures" style={{ marginTop: 'var(--s-3)' }}>
        {MEASURES.map((m) => {
          const v = Math.round(condition[m.key]);
          const name = labels?.[m.key] ?? m.label;
          return (
            <li key={m.key} className={styles.measure} style={{ ['--tone' as string]: m.tone }} aria-label={`${name} ${v} out of 100`}>
              <div className={styles.measureHead} aria-hidden="true">
                <span>{name}</span>
              </div>
              <span className={styles.measureValue} aria-hidden="true">
                {v}
              </span>
              <span className={styles.bar} aria-hidden="true">
                <span className={styles.fill} style={{ ['--w' as string]: `${v}%` }} />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
