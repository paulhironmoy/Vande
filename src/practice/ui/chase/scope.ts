/**
 * What the coach says in a chase, about THIS ball only (R-44 item 5, R-45). Kept apart from the result's words so the
 * result screen's code (the loss sentences) stays in its own lazy chunk while the dead-ball card, which is always in the
 * play screen, can use these two small functions.
 */
import type { PracticeT } from '@/i18n/practice';
import { lineStart } from '../coaching';
import type { TipWordsLike } from '../flow/types';

/**
 * The coach's green-tick confirmation in a chase (R-44 item 5, R-45). "Play it the same way again" is the coach saying
 * the shot suited THIS ball; beside "Need 15 off 11 balls" it can be read as a plan for the chase, which the coach never
 * judges (the coach's choice played on every ball almost never wins a chase). In a chase it says what it is: the coach's
 * choice for this ball. The tip's fact is kept; only its action and the sentence made of the two change, so the card then
 * differs from the tip's own sentence (RK4), in a chase only.
 */
export function confirmedForThisBall(t: PracticeT, words: TipWordsLike): TipWordsLike {
  const action = t.t('practice.chase.card.confirm');
  return { fact: words.fact, action, sentence: t.t('practice.tip.sentence', { fact: words.fact, action }) };
}

/** The same confirmation as a line of its own (the card's words when there is no tip sentence to show). */
export function confirmedLine(t: PracticeT): string {
  return t.t('practice.tip.action_line', { action: lineStart(t.t('practice.chase.card.confirm'), t.intl) });
}
