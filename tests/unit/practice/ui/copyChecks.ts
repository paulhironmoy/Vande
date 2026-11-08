/**
 * Copy checks shared by the card tests: the defects a region phrase can cause, and how many distinct actions a line
 * asks for (RK4: exactly one). Built from the catalogs themselves, so a new recommendation or action is covered too.
 */
import { practiceEn } from '@/i18n/practice/en';

export const GAP: Record<string, RegExp> = { en: /\bgap\b/giu, hi: /गैप/gu, 'hi-Latn': /\bgap\b/giu };
/** English phrases that only appear when a region word is forced into a frame made for a fielding position. */
export const BAD_EN =
  /\b(the|at|to|towards|through) (the )?(behind|straight)\b(?! (gap|down))|\bthe the\b|\bgap gap\b|\bany\b/iu;

/** Every defect a region phrase can cause, in one list (empty when the line reads right). */
export function regionDefects(locale: string, line: string): string[] {
  const out: string[] = [];
  const words = line
    .toLocaleLowerCase()
    .split(/\s+/u)
    .map((w) => w.replace(/[.,:;!?।]+$/u, ''));
  for (let i = 1; i < words.length; i++) if (words[i] && words[i] === words[i - 1]) out.push(`doubled "${words[i]}"`);
  if ((line.match(GAP[locale]) ?? []).length > 1) out.push('the gap twice');
  if (locale === 'en' && BAD_EN.test(line)) out.push(`region forced into a position frame: ${line.match(BAD_EN)?.[0]}`);
  if (/[{}]/u.test(line)) out.push('placeholder left');
  return out;
}

/** The action vocabulary of a locale: every recommendation, tip action and option phrase, as patterns. */
export function actionPatterns(catalog: Record<string, string>): RegExp[] {
  const all = { ...(practiceEn as Record<string, string>), ...catalog };
  const keys = Object.keys(all).filter(
    (k) => /^practice\.(rec|tip\.do)\./u.test(k) || /^practice\.option\.(leave|defend|drive|uppish|loft)$/u.test(k),
  );
  return keys.map((k) => {
    const body = all[k].replace(/[.।]$/u, '');
    const src = body
      .split(/(\{[^}]+\})/u)
      .map((part) => (part.startsWith('{') ? '.+?' : part.replace(/[.*+?^$()|[\]\\]/gu, '\\$&')))
      .join('');
    return new RegExp(src, 'giu');
  });
}

/** How many distinct actions a line asks for (overlapping matches of the vocabulary are one action). */
export function actionCount(line: string, patterns: RegExp[]): number {
  const spans: Array<[number, number]> = [];
  for (const p of patterns) for (const m of line.matchAll(p)) spans.push([m.index!, m.index! + m[0].length]);
  spans.sort((a, b) => a[0] - b[0]);
  let n = 0;
  let end = -1;
  for (const [a, b] of spans) {
    if (a >= end) n++;
    end = Math.max(end, b);
  }
  return n;
}
