import type { Twist } from '@/lite/contracts';

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

/** One twist question: heading, situation, answer cards, then the result. */
export function TwistQuestion(props: TwistQuestionProps) {
  void props;
  return null;
}
