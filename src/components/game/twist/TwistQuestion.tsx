import { useId } from 'react';
import { Icon } from '@/components/ui';
import { ActionCard, actionKindOf } from '@/components/game/cards';
import type { Twist, TwistOption } from '@/lite/contracts';
import s from './TwistQuestion.module.css';

export interface TwistQuestionProps {
  twist: Twist;
  /** Option ids in display order (the attempt's shuffled order). */
  order: readonly string[];
  /** Chosen option id once answered; the result (Right / Not quite, the why line, the best marked) shows then. */
  answer?: string;
  onAnswer: (optionId: string) => void;
  /** 'twist' when the friend answers; 'rematch' when the helper answers the friend's twist. Prefixes test ids. */
  testIdPrefix: 'twist' | 'rematch';
  /** Small line above the heading, e.g. "The twist · same idea, new place". */
  kicker: string;
  disabled?: boolean;
}

/** The twist's options in the stored order; ids missing from `order` follow in content order, unknown ids are dropped. */
export function orderedOptions(twist: Twist, order: readonly string[]): TwistOption[] {
  const byId = new Map(twist.options.map((o) => [o.id, o]));
  const out: TwistOption[] = [];
  for (const id of order) {
    const o = byId.get(id);
    if (o && !out.includes(o)) out.push(o);
  }
  for (const o of twist.options) if (!out.includes(o)) out.push(o);
  return out;
}

/**
 * One twist question: heading, situation and answer cards, then the result. Shared by the friend's twist and the
 * helper's rematch. The result is announced politely, and right or wrong is always said in words as well as shown.
 */
export function TwistQuestion({ twist, order, answer, onAnswer, testIdPrefix, kicker, disabled }: TwistQuestionProps) {
  const headingId = useId();
  const options = orderedOptions(twist, order);
  const answered = answer !== undefined && twist.options.some((o) => o.id === answer);
  const right = answered && answer === twist.best;
  const isRule = twist.kind === 'rule';
  const count = isRule ? 'wide' : String(options.length);

  const noteFor = (o: TwistOption): string | undefined => {
    if (!answered) return undefined;
    if (o.id === twist.best) return o.id === answer ? (isRule ? 'Fair answer · your pick' : 'Best move · your pick') : isRule ? 'Fair answer' : 'Best move';
    if (o.id === answer) return 'Your pick';
    return undefined;
  };

  return (
    <section
      className={s.twist}
      aria-labelledby={headingId}
      data-testid={`${testIdPrefix}-question`}
      data-twist={twist.id}
      data-answered={answered ? 'true' : 'false'}
    >
      <p className={s.kicker}>{kicker}</p>
      <h1 className={s.title} id={headingId}>
        {twist.title}
      </h1>
      <p className={s.lead}>{twist.situation}</p>
      <div className={s.hand} data-count={count}>
        {options.map((o, i) => (
          <ActionCard
            key={o.id}
            kind={isRule ? 'rule' : actionKindOf(o.tags ?? [])}
            layout={isRule ? 'wide' : 'tile'}
            hideLabel={isRule}
            title={o.title}
            note={noteFor(o)}
            onSelect={() => {
              if (!answered && !disabled) onAnswer(o.id);
            }}
            picked={answered && o.id === answer}
            faded={answered && o.id !== answer && o.id !== twist.best}
            verdict={answered ? (o.id === twist.best ? 'right' : o.id === answer ? 'wrong' : undefined) : undefined}
            disabled={Boolean(disabled) || answered}
            index={i}
            testId={`${testIdPrefix}-option-${o.id}`}
          />
        ))}
      </div>
      <div className={s.live} aria-live="polite">
        {answered ? (
          <div className={s.result} data-testid={`${testIdPrefix}-result`} data-right={right ? 'true' : 'false'}>
            <div className={s.verdictRow}>
              <span className={s.verdictBadge} data-tone={right ? 'good' : 'rule'} aria-hidden="true">
                <Icon name={right ? 'check' : 'book'} size={20} strokeWidth={2.4} />
              </span>
              <strong className={s.verdict}>{right ? 'Right!' : 'Not quite'}</strong>
            </div>
            <p className={s.why}>{twist.why}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
