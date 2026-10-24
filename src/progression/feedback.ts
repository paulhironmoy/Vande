import type { ChapterResult, RepublicCondition } from '@/engine/types';

/** Plain measure names for the Simple style (kept local so progression never imports the store). */
const SIMPLE_MEASURES: Record<string, string> = { freedom: 'Freedom', safety: 'Safety', trust: 'Trust', economy: 'Shops and jobs', legitimacy: 'Fairness' };

const count = (fp: string, letter: string) => fp.split('').filter((c) => c === letter).length;

/** One honest line about the strategy, derived from the fingerprint and the result. Never numbers. */
export function strategicFeedback(fingerprint: string, result: Pick<ChapterResult, 'scores' | 'stats'> | undefined, simple: boolean): string {
  const x = count(fingerprint, 'X');
  const w = count(fingerprint, 'W');
  const e = count(fingerprint, 'E');
  const d = count(fingerprint, 'D');
  const s = count(fingerprint, 'S');
  if (result?.stats.falseAccusations) return simple ? 'Acting on a fake clue cost trust.' : 'An accusation built on unchecked evidence cost freedom and trust.';
  if (x >= 1) return simple ? 'A harsh choice cost freedom and trust.' : 'A sweeping or harsh action cost freedom and trust.';
  if (w >= 2) return simple ? 'Waiting let problems grow.' : 'Waiting let the problem grow; safety and services paid for it.';
  if (e >= 2) return simple ? 'You checked clues before acting. That held.' : 'Evidence before action held the line.';
  if (d >= 2) return simple ? 'Talking first kept people with you.' : 'Dialogue first kept trust with you.';
  if (s >= 1) return simple ? 'Keeping services running kept people safe.' : 'Keeping services running protected safety and livelihoods.';
  return simple ? 'Balanced choices held the city together.' : 'Balanced choices held the Republic together.';
}

const MEASURES: (keyof RepublicCondition)[] = ['freedom', 'safety', 'trust', 'economy', 'legitimacy'];
const FULL_NAMES: Record<string, string> = { freedom: 'Freedom', safety: 'Safety', trust: 'Trust', economy: 'Economy', legitimacy: 'Legitimacy' };

/** "Trust +2 in your Republic" from the largest change; null when nothing moved. */
export function republicChangeLine(delta: Partial<RepublicCondition> | undefined, simple: boolean): string | null {
  if (!delta) return null;
  let bestKey: keyof RepublicCondition | undefined;
  let bestVal = 0;
  for (const k of MEASURES) {
    const v = delta[k];
    if (typeof v === 'number' && Math.abs(v) > Math.abs(bestVal)) {
      bestVal = v;
      bestKey = k;
    }
  }
  if (!bestKey || Math.round(bestVal) === 0) return simple ? 'Your city stayed about the same.' : 'Your Republic held steady.';
  const name = simple ? SIMPLE_MEASURES[bestKey] : FULL_NAMES[bestKey];
  const sign = bestVal > 0 ? '+' : '−';
  return `${name} ${sign}${Math.abs(Math.round(bestVal))} ${simple ? 'in your city' : 'in your Republic'}`;
}
