import { useId } from 'react';
import type { KeyDecision } from '@/engine/types';
import layout from './layout.module.css';
import { StatusIcon } from './icons';
import { SIMPLE_FLAGS } from '@/app/simple';
import styles from './KeyDecisionCard.module.css';

const FLAG_LABEL: Record<KeyDecision['flags'][number], string> = {
  'false-accusation': 'False accusation',
  disproportionate: 'Disproportionate force',
  'unverified-basis': 'Acted on unverified evidence',
  auto: 'Decided by the clock',
};

export function KeyDecisionCard({ decision, heading, simple = false }: { decision: KeyDecision; heading: string; simple?: boolean }) {
  const id = useId();
  const flagLabel = (f: KeyDecision['flags'][number]) => (simple ? SIMPLE_FLAGS[f] : FLAG_LABEL[f]);
  return (
    <section className={layout.card} aria-labelledby={id}>
      <h2 className={layout.sectionTitle} id={id}>
        {heading}
      </h2>
      <div className={styles.keyDecision}>
        <p className={styles.keyTitle}>{decision.title}</p>
        <p className={styles.keyOption}>{decision.optionTitle}</p>
        {decision.flags.length > 0 && (
          <div className={styles.flagRow}>
            {decision.flags.map((f) => (
              <span key={f} className={[styles.flag, f === 'auto' ? styles.flagNeutral : ''].join(' ')}>
                <StatusIcon kind={f === 'auto' ? 'info' : 'harmed'} size={14} />
                {flagLabel(f)}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
