/**
 * The words of a Chase result, made from the Practice copy (COPY's `practice.chase.*` keys) and the numbers the chase
 * and the simulation recorded. Every line is a measured fact: nothing is guessed, nothing blames the player, and the
 * one sentence that says why a chase was lost is picked by rule from the balls, so the same chase reads the same way.
 */
import type { DeliveryResult } from '@/contracts';
import type { ChaseSummary } from '@/practice/chase/types';
import type { PracticeT } from '@/i18n/practice';
import { dismissalWord, reasonWords, timingWords } from '../coaching';
import { attributeShort, attributeWicket, type ChaseBallFacts } from './attribution';

export interface ChaseResultLines {
  tone: 'won' | 'lost';
  /** "Target reached" / "3 runs short". */
  title: string;
  /** A win: the balls to spare ("Won on the last ball."). Null on a loss. */
  detail: string | null;
  /** "You scored 14 off 12 balls. The target was 15." */
  score: string;
  /** A loss: ONE plain sentence on what decided it, from the simulation's own record. Null on a win, or when the balls hold no pattern to name. */
  why: string | null;
}

type Deciding = Pick<DeliveryResult, 'coaching' | 'outcome' | 'contact'>;

/** Out: how, the coach's reason, and the swing's measured timing when it was early or late. */
function wicketSentence(t: PracticeT, balls: readonly ChaseBallFacts[], deciding: Deciding | null): string | null {
  const last = balls[balls.length - 1];
  if (!last || !deciding) return null;
  const a = attributeWicket(last);
  const how = dismissalWord(t, a.dismissal);
  const reason = reasonWords(t, a.reason, deciding);
  const late = a.swung && (a.timing === 'early' || a.timing === 'late');
  const timing = late ? timingWords(t, a.timingErrorMs, deciding.contact.timing) : null;
  return timing
    ? t.t('practice.chase.why.wicket_timing', { how, reason, timing })
    : t.t('practice.chase.why.wicket', { how, reason });
}

/** The balls ran out: the group most of the dot balls belong to, when it is a pattern; else the plain count. */
function shortSentence(t: PracticeT, balls: readonly ChaseBallFacts[], target: number): string | null {
  const a = attributeShort(balls, target);
  if (a.dots === 0) return null;
  // "You defended or left 12 of the 12 balls that scored nothing" says no more than the count and reads badly: when every
  // dot ball was a defence the plain count is the sentence.
  const allDefended = a.cause === 'defence' && a.causeCount === a.dots;
  return a.cause && !allDefended
    ? t.t(`practice.chase.why.short.${a.cause}`, { n: a.causeCount, dots: a.dots })
    : t.t('practice.chase.why.short.plain', { dots: a.dots, balls: a.balls });
}

/**
 * The lines of the win or loss screen.
 * `balls` are the chase's balls in order (the last one is the deciding ball); `deciding` is its simulated result.
 */
export function chaseResultLines(
  t: PracticeT,
  sum: ChaseSummary,
  balls: readonly ChaseBallFacts[],
  deciding: Deciding | null,
): ChaseResultLines {
  const params = { runs: sum.runs, balls: sum.ballsFaced, target: sum.target };
  if (sum.result === 'won') {
    return {
      tone: 'won',
      title: t.t('practice.chase.won.title'),
      detail: t.t('practice.chase.won.spare', { left: sum.ballsLeft }),
      score: t.t('practice.chase.won.line', params),
      why: null,
    };
  }
  return {
    tone: 'lost',
    title: t.t('practice.chase.lost.title', { short: sum.runsShort }),
    detail: null,
    score: t.t('practice.chase.lost.line', params),
    why: sum.result === 'lost_wicket' ? wicketSentence(t, balls, deciding) : shortSentence(t, balls, sum.target),
  };
}
