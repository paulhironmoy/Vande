/**
 * The dead-ball card's words (RK4, COACH1; docs/prompts/VANDE-PRACTICE-WEDGE-PROMPT.md §4 step 4): one plain reason and
 * exactly one next action, in en, hi and hi-Latn, whatever region the physics names. These are the checks that would
 * have caught the W0 copy defects (release/product-sequence/stage-1-practice/wedge/w0/REPORT.md §3.1):
 *   "Attack the the gap gap along the ground."      a region-less recommendation
 *   "Attack the behind the wicket gap …"            a region that is not a fielding position
 *   "Leave it. Leave it: it is passing off stump."  Coach Mode's option words before the recommendation
 *   "Drive on the front foot towards the gap. Play straighter, with the line."  two actions on one card
 */
import { describe, expect, it } from 'vitest';
import type { CoachOption, CoachRecommendation, CoachRecommendationKind, CoachingReason, DeliveryResult, LocaleId } from '@/contracts';
import { createPracticeT, type PracticeT } from '@/i18n/practice';
import { practiceEn } from '@/i18n/practice/en';
import { practiceHi } from '@/i18n/practice/hi';
import { practiceHiLatn } from '@/i18n/practice/hi-Latn';
import { tipActionWords, tipFactWords, tipWords, type CoachTip, type TipFact } from '@/practice/coach/tip';
import { reasonWords, readLine, recommendationLine, tipLines, tipParts } from '@/practice/ui/coaching';
import { optionWords } from '@/practice/ui/components/Alternatives';
import type { Region } from '@/practice/ui/flow/types';
import { actionCount, actionPatterns, regionDefects } from './copyChecks';
import { fakeEngine, fakeResult, plan } from './fakes';

const LOCALES: Array<[LocaleId, Record<string, string>]> = [
  ['en', practiceEn as Record<string, string>],
  ['hi', practiceHi],
  ['hi-Latn', practiceHiLatn],
];
const translators: Array<[LocaleId, PracticeT, Record<string, string>]> = LOCALES.map(([l, c]) => [l, createPracticeT(l, l === 'en' ? null : c), c]);
const REGIONS: Array<Region | null> = ['third_man', 'point', 'cover', 'mid_off', 'mid_on', 'midwicket', 'square_leg', 'fine_leg', 'straight', 'behind', null];
const KINDS: CoachRecommendationKind[] = ['repeat_it', 'well_played', 'leave_outside_off', 'leave_down_leg', 'leave_over_the_top', 'play_at_the_stumps', 'defend_forward', 'defend_back', 'attack_the_gap', 'get_forward', 'get_back', 'play_later', 'play_earlier', 'play_straighter', 'aim_for_the_gap', 'keep_it_down'];

const rec = (kind: CoachRecommendationKind, region: Region | null = 'cover', lofted = false): CoachRecommendation => ({ kind, decision: kind.startsWith('leave') ? 'leave' : kind.startsWith('defend') ? 'defend' : 'attack', footwork: 'forward', shiftMs: 31, directionDeg: null, region, lofted });

// ---- inputs for every zone-bearing line ------------------------------------------------------------------------

const engine = fakeEngine();
const flight = engine.flight({ plan: plan(), bowler: { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'x' }, conditions: 'balanced', seed: 's', handedness: 'right' });
const scored = (zone: Region | null): DeliveryResult => {
  const r = fakeResult(flight, { kind: 'attack', startT: 0.4, directionDeg: 40, power: 0.6, elevation: 0, footwork: 'auto' });
  return { ...r, coaching: { ...r.coaching, zone: zone as never }, outcome: { ...r.outcome, region: zone } };
};
const option = (region: Region | null, elevation: number): CoachOption =>
  ({ kind: 'recommended', decision: 'attack', footwork: 'forward', swing: { kind: 'attack', startT: 0.4, directionDeg: 40, power: 0.6, elevation, footwork: 'forward' }, region, expectedRuns: 1, dismissalRisk: 0, risks: [], contactT: null, contactPoint: null }) as unknown as CoachOption;
const REASONS: CoachingReason[] = ['found_the_gap', 'cleared_the_rope', 'beat_the_field'];

function zoneLines(t: PracticeT, region: Region | null): string[] {
  const lines: string[] = [];
  for (const k of ['attack_the_gap', 'aim_for_the_gap'] as const) for (const lofted of [false, true]) {
    lines.push(recommendationLine(t, rec(k, region, lofted)));
    lines.push(tipActionWords(t, rec(k, region, lofted)));
  }
  for (const reason of REASONS) {
    lines.push(reasonWords(t, reason, scored(region)));
    lines.push(tipFactWords(t, { kind: 'reason', reason, zone: region, fielder: null }));
  }
  for (const e of [0, 0.3, 0.5]) lines.push(optionWords(t, option(region, e)));
  if (region) {
    for (const e of [0, 0.3, 0.5]) lines.push(readLine(t, { kind: 'attack', directionDeg: 40, power: 0.6, elevation: e, startT: 0.4, footwork: 'forward' }, () => region));
    lines.push(tipFactWords(t, { kind: 'early', ms: 31, where: 'zone', zone: region }));
    lines.push(tipFactWords(t, { kind: 'late_where', ms: 31, where: 'zone', zone: region }));
  }
  return lines;
}

const FACTS: TipFact[] = [
  { kind: 'early', ms: 100, where: 'zone', zone: 'fine_leg' },
  { kind: 'late', ms: 68, faceDeg: 32, where: 'outside_edge', zone: null },
  { kind: 'late_where', ms: 40, where: 'caught', zone: null },
  { kind: 'moved', mover: 'swing', towards: 'away', cm: 19, where: 'miss', zone: null },
  { kind: 'too_short_to_drive', lengthM: 8 },
  { kind: 'across_line', side: 'off', cm: 12 },
  { kind: 'reason', reason: 'left_and_bowled', zone: null, fielder: null },
  { kind: 'reason', reason: 'found_the_gap', zone: 'behind', fielder: null },
  { kind: 'unwarned', risk: 'can_edge', instead: 'aim_for_the_gap' },
  { kind: 'unwarned', risk: 'into_protected_region', instead: 'defend_back' },
  { kind: 'unwarned', risk: 'can_be_caught', instead: 'leave_outside_off' },
];

/** Every praise phrase of a locale: what a confirmation (repeat_it, well_played) says. */
function praisePhrases(catalog: Record<string, string>): string[] {
  const all = { ...(practiceEn as Record<string, string>), ...catalog };
  return ['practice.rec.well_played', 'practice.rec.repeat_it', 'practice.tip.do.well_played', 'practice.tip.do.repeat_it'].map((k) => all[k].replace(/[.।]$/u, '').toLocaleLowerCase());
}

// ---- the tests -------------------------------------------------------------------------------------------------

describe('a region in a line reads right in every language, whatever region (or none) the physics names', () => {
  for (const [locale, t] of translators) {
    it(`${locale}: no doubled words, the gap at most once, no region forced into a fielding-position frame`, () => {
      const found: string[] = [];
      for (const region of REGIONS) for (const line of zoneLines(t, region)) for (const d of regionDefects(locale, line)) found.push(`${region ?? 'none'}: "${line}" (${d})`);
      expect(found).toEqual([]);
    });
  }

  it('en: the two W0 defects now read as cricket', () => {
    const t = translators[0][1];
    expect(recommendationLine(t, rec('attack_the_gap', null))).toBe('Attack the gap along the ground.');
    expect(recommendationLine(t, rec('attack_the_gap', 'behind'))).toBe('Attack the gap behind the wicket along the ground.');
    expect(recommendationLine(t, rec('aim_for_the_gap', null))).toBe('Aim for the gap.');
    expect(recommendationLine(t, rec('aim_for_the_gap', 'straight', true))).toBe('Aim over the field, straight down the ground.');
    expect(optionWords(t, option('behind', 0))).toBe('Drive on the front foot behind the wicket');
    expect(optionWords(t, option(null, 0))).toBe('Drive on the front foot into the gap');
    expect(reasonWords(t, 'found_the_gap', scored('behind'))).toBe('Found the gap behind the wicket');
    // Lines that already read right are unchanged.
    expect(recommendationLine(t, rec('attack_the_gap', 'cover'))).toBe('Attack the cover gap along the ground.');
    expect(reasonWords(t, 'found_the_gap', scored('cover'))).toBe('Found the cover gap');
  });

  it('the checks above catch the W0 lines', () => {
    expect(regionDefects('en', 'Attack the the gap gap along the ground.').length).toBeGreaterThan(0);
    expect(regionDefects('en', 'Attack the behind the wicket gap along the ground.').length).toBeGreaterThan(0);
    expect(regionDefects('en', 'Drive on the front foot towards behind the wicket').length).toBeGreaterThan(0);
    expect(regionDefects('hi', 'गैप के गैप में ज़मीनी शॉट मारें।').length).toBeGreaterThan(0);
    expect(regionDefects('hi-Latn', 'gap ke gap mein zameeni shot maaro.').length).toBeGreaterThan(0);
  });
});

describe('the tip: one sentence, one measured fact, exactly one action (RK4)', () => {
  for (const [locale, t, catalog] of translators) {
    const patterns = actionPatterns(catalog);
    it(`${locale}: every action kind with every kind of fact`, () => {
      const bad: string[] = [];
      for (const kind of KINDS) for (const region of [null, 'cover', 'behind'] as const) for (const fact of FACTS) {
        const tip: CoachTip = { mistake: 'other', fact, action: rec(kind, region) };
        const words = tipWords(t, tip);
        const n = actionCount(words.sentence, patterns);
        if (n !== 1) bad.push(`${n} actions: ${words.sentence}`);
        // One sentence: a single terminal stop, at the end.
        if ((words.sentence.match(/[.।](\s|$)/gu) ?? []).length !== 1) bad.push(`not one sentence: ${words.sentence}`);
        const parts = tipParts(t, words);
        if (parts.map((p) => p.text).join('') !== words.sentence) bad.push(`parts differ: ${words.sentence}`);
        if (parts.filter((p) => p.role === 'fact').length !== 1 || parts.filter((p) => p.role === 'action').length !== 1) bad.push(`parts not split: ${words.sentence}`);
        const lines = tipLines(t, words);
        // Unity's dead-ball card takes at most 160 characters per line, no control characters (contract v6).
        for (const l of [lines.reason, lines.recommendation]) if (l.length === 0 || l.length > 160 || /\p{Cc}/u.test(l)) bad.push(`unity line out of bounds: ${l}`);
        if (actionCount(lines.recommendation, patterns) !== 1 || actionCount(lines.reason, patterns) !== 0) bad.push(`unity lines: ${lines.reason} | ${lines.recommendation}`);
      }
      expect(bad).toEqual([]);
    });
  }

  it('en: the tip lines start as sentences', () => {
    const t = translators[0][1];
    const tip: CoachTip = { mistake: 'too_late', fact: FACTS[1], action: rec('play_earlier') };
    const words = tipWords(t, tip);
    expect(words.sentence).toBe('68 ms late, with the bat face 32° off your line: start 31 ms earlier.');
    expect(tipLines(t, words)).toEqual({ reason: '68 ms late, with the bat face 32° off your line.', recommendation: 'Start 31 ms earlier.' });
  });

  for (const [locale, t, catalog] of translators) {
    it(`${locale}: a stroke that worked with a risk the recommendation avoids is never praised (anti-fake rule 7)`, () => {
      const praise = praisePhrases(catalog);
      const INSTEAD = { attack: 'aim_for_the_gap', defend: 'defend_forward', leave: 'leave_outside_off' } as const;
      for (const kind of ['well_played', 'repeat_it'] as const) for (const decision of ['attack', 'defend', 'leave'] as const) {
        const action = { ...rec(kind, 'cover'), decision };
        for (const risk of ['can_edge', 'can_be_caught', 'can_be_bowled', 'can_be_lbw', 'into_protected_region'] as const) {
          const words = tipWords(t, { mistake: null, fact: { kind: 'unwarned', risk, instead: INSTEAD[decision] }, action });
          const said = words.sentence.toLocaleLowerCase();
          expect(praise.filter((p) => said.includes(p)), words.sentence).toEqual([]);
          expect(words.fact, words.sentence).toBe(t.tk(`practice.tip.fact.unwarned.${risk}`));
          // Its one action is the recommended response itself: the aim of the stroke, the block, or the leave.
          expect(words.action).toBe(tipActionWords(t, { ...action, kind: INSTEAD[decision] }));
          expect(actionCount(words.sentence, actionPatterns(catalog)), words.sentence).toBe(1);
        }
        // Earned, the same confirmation still says its words.
        const earned = tipWords(t, { mistake: null, fact: { kind: 'reason', reason: 'found_the_gap', zone: 'cover', fielder: null }, action });
        expect(earned.action).toBe(tipActionWords(t, action));
      }
    });
  }

  it('the action count catches the W0 cards (two actions, the doubled leave)', () => {
    const patterns = actionPatterns(practiceEn as Record<string, string>);
    expect(actionCount('Leave it. Leave it: it is passing off stump.', patterns)).toBe(2);
    expect(actionCount('Drive on the front foot towards the gap. Play straighter, with the line.', patterns)).toBe(2);
    expect(actionCount('It moved 16 cm in, and you played across it: play straighter, with the line.', patterns)).toBe(1);
  });
});
