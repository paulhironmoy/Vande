import { useEffect, useRef } from 'react';
import type { DecisionOption, DecisionState, ScenarioDecision } from '@/engine/types';
import { PlayIcon } from './icons';
import { urgencyLabel } from './format';
import { SIMPLE_URGENCY, simpleRule, simpleWarningText } from './simpleCopy';
import styles from './DecisionCard.module.css';

export interface OptionWarning {
  level: 'none' | 'caution' | 'warning';
  text: string;
}

export interface DecisionCardProps {
  decision: ScenarioDecision;
  state: DecisionState;
  tick: number;
  districtName?: string;
  warnings: Record<string, OptionWarning>;
  onChoose: (optionId: string) => void;
  /** Move keyboard focus to the card heading when it appears. */
  autoFocus?: boolean;
  disabled?: boolean;
  compact?: boolean;
  /** Simple play style: plain words, bigger buttons, no legal citations. */
  simple?: boolean;
}

export function DecisionCard({ decision, state, tick, districtName, warnings, onChoose, autoFocus, disabled, compact, simple }: DecisionCardProps) {
  const sd = simple ? decision.simple : undefined;
  const title = sd?.title ?? decision.title;
  const situation = sd?.situation ?? decision.situation;
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    const active = document.activeElement;
    if (!active || active === document.body) headingRef.current?.focus({ preventScroll: true });
  }, [autoFocus, decision.id]);

  const total = Math.max(1, state.expiresAt - state.appearedAt);
  const left = Math.max(0, state.expiresAt - tick);
  const frac = Math.max(0, Math.min(1, left / total));
  const R = 11;
  const C = 2 * Math.PI * R;

  return (
    <article className={[styles.card, compact ? styles.compact : '', simple ? styles.simple : ''].filter(Boolean).join(' ')} data-testid={`decision-card-${decision.id}`} data-urgency={decision.urgency} data-simple={simple ? 'true' : undefined} aria-labelledby={`dec-${decision.id}`}>
      <header className={styles.header}>
        <div className={styles.chips}>
          <span className={styles.urgency} data-urgency={decision.urgency}>
            <PlayIcon name={decision.urgency === 'high' ? 'warning' : 'clock'} size={13} />
            {simple ? SIMPLE_URGENCY[decision.urgency] : urgencyLabel(decision.urgency)}
          </span>
          {districtName ? (
            <span className={styles.district}>
              <PlayIcon name="pin" size={13} />
              {districtName}
            </span>
          ) : null}
        </div>
        <span className={styles.timeRing} role="img" aria-label={`${simple ? 'Time to choose' : 'Time to decide'}: ${left} second${left === 1 ? '' : 's'}`} data-low={left <= 10 ? 'true' : undefined}>
          <svg viewBox="0 0 28 28" aria-hidden="true" focusable="false">
            <circle cx="14" cy="14" r={R} className={styles.ringTrack} />
            <circle cx="14" cy="14" r={R} className={styles.ringFill} style={{ strokeDasharray: `${C} ${C}`, strokeDashoffset: C * (1 - frac) }} />
          </svg>
          {left <= 10 ? <span className={styles.ringNum}>{left}</span> : null}
        </span>
      </header>
      <h3 id={`dec-${decision.id}`} ref={headingRef} tabIndex={-1} className={styles.title}>
        {title}
      </h3>
      <p className={styles.situation}>{situation}</p>
      <ul className={styles.options} aria-label={simple ? 'Your choices' : 'Options'}>
        {decision.options.map((opt: DecisionOption) => {
          const w = warnings[opt.id];
          const warnId = w && w.level !== 'none' ? `warn-${decision.id}-${opt.id}` : undefined;
          const so = sd?.options[opt.id];
          const optTitle = so?.title ?? opt.title;
          const optPreview = so?.preview ?? opt.preview;
          const rule = simple ? simpleRule(opt.authority) : undefined;
          return (
            <li key={opt.id}>
              <button
                type="button"
                className={styles.option}
                data-testid={`decision-option-${opt.id}`}
                onClick={() => onChoose(opt.id)}
                disabled={disabled}
                aria-describedby={warnId}
                data-warning={w && w.level !== 'none' ? w.level : undefined}
              >
                <span className={styles.optTitle}>{optTitle}</span>
                <span className={styles.optPreview}>{optPreview}</span>
                {!simple ? (
                  <span className={styles.optAuthority}>
                    <PlayIcon name="scale" size={14} />
                    <span>{opt.authority}</span>
                  </span>
                ) : rule ? (
                  <span className={styles.optAuthority} data-rule="true">
                    <PlayIcon name="scale" size={14} />
                    <span>{rule}</span>
                  </span>
                ) : null}
                {warnId ? (
                  <span id={warnId} className={styles.warning} data-level={w.level} data-testid="confidence-warning">
                    <PlayIcon name={w.level === 'warning' ? 'warning' : 'question'} size={14} />
                    <span>{simple ? simpleWarningText(w.text) : w.text}</span>
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
