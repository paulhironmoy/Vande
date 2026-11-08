/**
 * D-1 display honesty (lead ruling, 2026-11-04): a risk is never shown as "0%" or as no risk. The coach's estimate is
 * a weighted grid (every 5 ms over ±2σ, simulate.ts EXECUTION_SPREAD), and a grid cannot see a failure thinner than
 * its spacing. On the evaluators' finer grid, 10 of 33 recommended swings shown at 0% fail at 0.08–1.74%
 * (COACH2-FINAL.md §7d). So a whole-percent risk of 0 reads "under 2%" in en, hi and hi-Latn. No coach line claims
 * certainty ("safe", "no risk", "never out") either.
 *
 * The options are rendered by the shipped Alternatives component, in each launch locale, for the coach's real
 * analyses of the reference over.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { act } from 'react';
import type { CoachAnalysis, LocaleId } from '@/contracts';
import { useApp } from '@/app/store';
import { createPracticeT, loadPracticeCatalog } from '@/i18n/practice';
import { coachEn } from '@/i18n/practice/en/coach';
import { coachHi } from '@/i18n/practice/hi/coach';
import { coachHiLatn } from '@/i18n/practice/hi-Latn/coach';
import { REFERENCE_BALLS } from '@/practice/game';
import { analyzeBall } from '@/practice/coach';
import { Alternatives } from '@/practice/ui/components/Alternatives';
import { referenceRecord } from './fixtures';

const LOCALES = ['en', 'hi', 'hi-Latn'] as const satisfies readonly LocaleId[];
/** How each locale says "under 2%". */
const UNDER: Record<(typeof LOCALES)[number], string> = { en: 'under 2%', hi: '2% से कम', 'hi-Latn': '2% se kam' };
/** A risk shown as zero: "0%", "0 %" or "0.0%", never part of a larger number ("10%", "2.0%"). */
const ZERO_RISK = /(^|[^\d.,])0(?:[.,]0+)?\s?%/;
/** Certainty claims, per locale. "Safest" (सबसे सुरक्षित, Sabse safe) is a comparison between the shown options, not a claim of no risk. */
const CERTAIN: Record<(typeof LOCALES)[number], RegExp> = {
  en: /\b(safe|no risk|zero risk|risk[- ]free|never (?:be |get )?out|can(?:not|'t|’t) (?:be|get) out|guarantee\w*)\b/i,
  hi: /कोई जोखिम नहीं|जोखिम नहीं|बिना जोखिम|शून्य जोखिम|कभी आउट नहीं|आउट नहीं हो सकते/,
  'hi-Latn': /\b(koi risk nahi|risk nahi|bina risk|zero risk|kabhi out nahi|out nahi ho sakte|safe hai)\b/i,
};
const COACH_COPY: Record<(typeof LOCALES)[number], Record<string, string>> = { en: coachEn, hi: coachHi, 'hi-Latn': coachHiLatn };

/** The reference over at Play and Real: real analyses, every one with options the coach shows at a grid-zero risk. */
const analyses: Array<{ label: string; analysis: CoachAnalysis }> = (['play', 'real'] as const).flatMap((assist) =>
  REFERENCE_BALLS.map((rb) => ({ label: `${assist} ${rb.id}`, analysis: analyzeBall(referenceRecord(rb.id, assist)) })),
);

async function inLocale(locale: LocaleId): Promise<void> {
  await loadPracticeCatalog(locale);
  act(() => useApp.setState((s) => ({ settings: { ...s.settings, locale } })));
}

function shown(analysis: CoachAnalysis): string[] {
  const { container, unmount } = render(<Alternatives analysis={analysis} />);
  const items = [...container.querySelectorAll('li')].map((li) => li.textContent ?? '');
  unmount();
  return items;
}

afterAll(() => {
  cleanup();
  act(() => useApp.setState((s) => ({ settings: { ...s.settings, locale: 'en' } })));
});

describe('D-1: no recommendation or option is ever displayed with a 0% risk', () => {
  it('the risk line: a whole percent of 0 is "under 2%", any other the measured percent, in en, hi and hi-Latn', () => {
    for (const locale of LOCALES) {
      const t = createPracticeT(locale, COACH_COPY[locale]);
      const zero = t.t('practice.option.numbers', { runs: '0.0', risk: 0 });
      expect(zero, locale).toContain(UNDER[locale]);
      expect(zero, locale).not.toMatch(ZERO_RISK);
      expect(t.t('practice.option.numbers', { runs: '3.5', risk: 7 }), locale).toContain('7%');
      expect(t.t('practice.option.numbers', { runs: '3.5', risk: 1 }), locale).toContain('1%');
      expect(t.t('practice.option.numbers', { runs: '3.5', risk: 10 }), locale).toContain('10%');
    }
  });

  it('the shipped Alternatives, on the reference over at Play and Real, never shows 0%: a grid-zero risk reads "under 2%"', async () => {
    let gridZero = 0;
    for (const locale of LOCALES) {
      await inLocale(locale);
      for (const { label, analysis } of analyses) {
        const items = shown(analysis);
        expect(items.length, `${locale} ${label}`).toBe(analysis.options.length);
        analysis.options.forEach((o, i) => {
          const where = `${locale} ${label} ${o.kind} (risk ${o.dismissalRisk})`;
          expect(items[i], where).not.toMatch(ZERO_RISK);
          expect(items[i], where).not.toMatch(CERTAIN[locale]);
          if (Math.round(o.dismissalRisk * 100) === 0) {
            gridZero++;
            expect(items[i], where).toContain(UNDER[locale]);
          } else expect(items[i], where).toContain(`${Math.round(o.dismissalRisk * 100)}%`);
        });
      }
    }
    // The reference over has grid-zero options at every level (every block and leave, and most recommendations).
    expect(gridZero).toBeGreaterThanOrEqual(3 * 12);
  }, 120_000);

  it('a risk too small to round to 1% (0.4%) is "under 2%" too, and 7.3% is "7%"', async () => {
    const base = analyses[0].analysis;
    const options = [
      { ...base.options[0], dismissalRisk: 0.004 },
      { ...base.options[0], kind: 'higher_scoring' as const, dismissalRisk: 0.073 },
    ];
    for (const locale of LOCALES) {
      await inLocale(locale);
      const [small, some] = shown({ ...base, options });
      expect(small, locale).toContain(UNDER[locale]);
      expect(small, locale).not.toMatch(ZERO_RISK);
      expect(some, locale).toContain('7%');
    }
  });

  it('no coach line claims certainty ("safe", "no risk", "never out") in en, hi or hi-Latn', () => {
    for (const locale of LOCALES) {
      const found = Object.entries(COACH_COPY[locale]).filter(([, v]) => CERTAIN[locale].test(v));
      expect(found.map(([k, v]) => `${locale}: ${k}: ${v}`)).toEqual([]);
    }
  });
});
