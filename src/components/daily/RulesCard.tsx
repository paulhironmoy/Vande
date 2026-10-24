import { RULES, ruleText } from '@/app/rules';
import { useSimple } from '@/app/simple';
import { Icon } from '@/components/ui';
import s from './RulesCard.module.css';

export interface RulesCardProps {
  /** Compact rows for sheets and the cold open. */
  compact?: boolean;
  className?: string;
  /** Accessible heading; hidden visually when `hideHeading`. */
  heading?: string;
  hideHeading?: boolean;
}

/** The one cheatsheet: seven icon + phrase rows. No paragraphs anywhere else explain the rules. */
export function RulesCard({ compact, className, heading = 'Rules at a glance', hideHeading }: RulesCardProps) {
  const simple = useSimple();
  return (
    <section className={[s.card, compact ? s.compact : '', className ?? ''].filter(Boolean).join(' ')} aria-label={heading} data-testid="rules-card">
      {!hideHeading && <h2 className={s.heading}>{heading}</h2>}
      <ul className={s.list}>
        {RULES.map((line) => (
          <li key={line.id} className={s.row} data-rule={line.id}>
            <span className={s.icon} aria-hidden="true">
              <Icon name={line.icon} size={compact ? 18 : 22} />
            </span>
            <span className={s.label}>{line.label}</span>
            <span className={s.text}>{ruleText(line, simple)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
