import type { ActionTag } from '@/engine/types';
import type { IconName } from '@/components/ui/Icon';

/** Game-facing card types. Neutral hues: colour never signals "right" or "wrong" before you choose. */
export type ActionKind = 'talk' | 'check' | 'protect' | 'enforce' | 'restrict' | 'wait' | 'rule';

export const ACTION_META: Record<ActionKind, { label: string; icon: IconName; color: string; deep: string }> = {
  talk: { label: 'Talk', icon: 'message', color: '#62D6FF', deep: '#0F6FA8' },
  check: { label: 'Investigate', icon: 'eye', color: '#38A0FF', deep: '#1650B8' },
  protect: { label: 'Protect', icon: 'shield', color: '#2ED3C4', deep: '#0E7F77' },
  enforce: { label: 'Enforce', icon: 'scale', color: '#7B8CFF', deep: '#3443B5' },
  restrict: { label: 'Restrict', icon: 'lock', color: '#F0A24A', deep: '#A35B12' },
  wait: { label: 'Wait', icon: 'clock', color: '#AAB6C8', deep: '#4C5D78' },
  rule: { label: 'Your ruling', icon: 'book', color: '#A9E4FF', deep: '#2E6E92' },
};

/**
 * What each kind of move fundamentally does, and what it costs. Shown on every card so a player can reason
 * from cause and effect instead of guessing. Plain words; no scores.
 */
export const ACTION_LOGIC: Record<Exclude<ActionKind, 'rule'>, { gain: string; cost: string }> = {
  talk: { gain: 'People feel heard', cost: 'Takes time' },
  check: { gain: 'Finds out what is true', cost: 'Slower to act' },
  protect: { gain: 'Keeps people safe', cost: 'Needs people and effort' },
  enforce: { gain: 'Stops the rule-breakers', cost: 'Must pick the right people' },
  restrict: { gain: 'Fast control', cost: 'Stops innocent people too' },
  wait: { gain: 'Costs nothing now', cost: 'Problems can grow' },
};

export function actionKindOf(tags: readonly ActionTag[]): ActionKind {
  const has = (...t: ActionTag[]) => t.some((x) => tags.includes(x));
  if (has('disproportionate', 'suppressive', 'censorship')) return 'restrict';
  if (has('wait')) return 'wait';
  if (has('force', 'detention')) return 'enforce';
  if (has('investigative', 'legal-process', 'accusation')) return 'check';
  if (has('service', 'relief', 'protect-assembly', 'protect-press')) return 'protect';
  return 'talk';
}
