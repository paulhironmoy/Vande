/**
 * Rules at a glance — the one cheatsheet every screen draws from.
 * Seven lines, icon + a few words each. No paragraphs. Both play styles share the structure;
 * Simple uses the shorter phrasing. Keep each `full` line ≤ 9 words and each `simple` line ≤ 7 words.
 */
import type { IconName } from '@/components/ui/Icon';

export interface RuleLine {
  id: 'goal' | 'clock' | 'choices' | 'clues' | 'score' | 'result' | 'share';
  icon: IconName;
  label: string;
  full: string;
  simple: string;
}

export const RULES: readonly RuleLine[] = [
  { id: 'goal', icon: 'scale', label: 'Goal', full: 'Keep the city free and safe at once.', simple: 'Keep everyone free AND safe.' },
  { id: 'clock', icon: 'clock', label: 'Clock', full: 'About three minutes. Pause any time.', simple: 'Three minutes. The clock waits for you.' },
  { id: 'choices', icon: 'check', label: 'Choices', full: 'Fair and specific beats harsh and sweeping.', simple: 'Fair beats harsh.' },
  { id: 'clues', icon: 'eye', label: 'Clues', full: 'Check evidence before acting on it.', simple: 'Check clues before you act.' },
  { id: 'score', icon: 'pulse', label: 'Score', full: 'Six measures, one score. Balance wins.', simple: 'Six bars make one score. Balance wins.' },
  { id: 'result', icon: 'target', label: 'Result', full: 'First finish is official. Replays are practice.', simple: 'First try counts. Replays are practice.' },
  { id: 'share', icon: 'share', label: 'Share', full: 'Send your pattern; friends play the same day.', simple: 'Send your pattern. Friends play the same day.' },
] as const;

export function ruleText(line: RuleLine, simple: boolean): string {
  return simple ? line.simple : line.full;
}
