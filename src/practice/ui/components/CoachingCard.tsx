/** The concise card after each ball: how it was timed, why it went where it did, and the result. */
import type { ReactNode } from 'react';
import type { DeliveryResult } from '@/contracts';
import { OutcomeBadge } from '@/ui';
import { usePracticeT } from '@/i18n/practice';
import { coachingLines, lbwNotOut, markOf, timingWords } from '../coaching';
import s from './Hud.module.css';

export interface CoachingCardProps {
  result: DeliveryResult;
  /** "Practice ball · does not count" and similar. */
  note?: string | null;
  children?: ReactNode;
  testId?: string;
}

export function CoachingCard({ result, note, children, testId = 'practice-coaching' }: CoachingCardProps) {
  const t = usePracticeT();
  const c = coachingLines(t, result);
  const timing = result.swing ? timingWords(t, result.contact.timingErrorMs, result.contact.timing) : null;
  const notOut = lbwNotOut(t, result.coaching.lbw);
  return (
    <section className={s.card} data-tone={c.tone} data-headline={c.headline} data-testid={testId} data-outcome={result.outcome.dismissal ? 'out' : String(result.outcome.runs)} aria-label={`${c.head}. ${c.reason}. ${c.result}.`}>
      <span className={s.head}>{c.head}</span>
      <span className={s.reason}>{c.reason}</span>
      <span className={s.result}>
        <OutcomeBadge mark={markOf({ runs: result.outcome.runs, dismissal: result.outcome.dismissal })} size="sm" />
        {c.result}
      </span>
      {(timing || note || notOut) && <span className={s.detail}>{[notOut, timing, note].filter(Boolean).join(' · ')}</span>}
      {children && <div className={s.actions}>{children}</div>}
    </section>
  );
}
