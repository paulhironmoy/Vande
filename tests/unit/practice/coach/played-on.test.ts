// @vitest-environment node
/**
 * A ball played on off the middle of the bat (physics REPORT item 4: on the reference cutter, ref-4 at Real, a back-foot
 * block 24 ms early drops dead off the face and rolls back onto the stumps). The physics' scoring.ts runs its "what beat
 * the bat" diagnosis for every ball played on, so it names the cutter's seam (`beaten_by_seam`) although the bat met the
 * ball squarely. The coach must not repeat that as the cause: it is not a misread of the movement (read.ts), the tip's
 * fact is the measured timing and that it was played on, never "beaten by the seam" or the movement (tip.ts), and when
 * the attempt was the recommended stroke itself the one action is the timing that differs from the demonstration
 * (insight.ts recommendationFor, step 3).
 */
import { describe, expect, it } from 'vitest';
import type { CoachAnalysis, ContactKind, DeliveryRecord, NormalizedSwing } from '@/contracts/practice';
import { formatMessage } from '@/i18n/format';
import { practiceEn } from '@/i18n/practice/en';
import { practiceHi } from '@/i18n/practice/hi';
import { practiceHiLatn } from '@/i18n/practice/hi-Latn';
import {
  analyzeBall,
  coachTip,
  primaryInsight,
  tipFactWords,
  tipOf,
  tipSentence,
  type TipTranslator,
} from '@/practice/coach';
import type { BallFacts } from '@/practice/coach/facts';
import { inferRead } from '@/practice/coach/read';
import { play, referenceRecord, swingFor } from './fixtures';

const strict = (catalog: Record<string, string>, intl: string): TipTranslator => ({
  tk(key, params) {
    if (!(key in catalog)) throw new Error(`missing copy ${key}`);
    return formatMessage(catalog[key], params, intl);
  },
});
const LOCALES = [
  strict(practiceEn as Record<string, string>, 'en-IN'),
  strict(practiceHi, 'hi-IN'),
  strict(practiceHiLatn, 'en-IN'),
];
/** The words a tip must never use for a ball played on off the middle: the physics' "beaten" names and the movement facts. */
const BEATEN_KEYS = [
  'beaten_by_swing',
  'beaten_by_seam',
  'beaten_by_turn',
  'beaten_by_pace',
  'beaten_by_bounce',
  'missed_straight_ball',
].map((r) => `practice.coach.${r}`);
const ON_THE_BAT: ReadonlySet<ContactKind> = new Set<ContactKind>([
  'middle',
  'inside_edge',
  'outside_edge',
  'top_edge',
  'leading_edge',
]);

describe('a ball played on off the middle of the bat', () => {
  // The case as physics REPORT item 4 recorded it (recorded fields only, so this holds whatever the calibration): the
  // recommended back-foot block, played 24 ms early inside the perfect band, off the middle, bowled.
  const known = {
    version: 3,
    ball: {
      variation: 'cutter',
      speedKph: 126.9,
      lengthM: 6,
      lineAtStumpsM: 0.1,
      airMovementM: 0,
      pitchMovementM: 0.09,
      heightAtBatM: 0.65,
      wouldHitStumps: true,
    },
    read: { length: 'right', line: 'right', pace: 'right', movement: 'right', bounce: 'unclear' },
    attempted: {
      decision: 'defend',
      footwork: 'back',
      directionDeg: 0,
      elevation: 0,
      power: 0.2,
      timingErrorMs: -24,
      contact: 'middle',
      timing: 'perfect',
      runs: 0,
      dismissal: 'bowled',
      spread: { dismissalRisk: 0, expectedRuns: 0, risks: [] },
    },
    why: ['beaten_by_seam'],
    options: [
      {
        kind: 'recommended',
        decision: 'defend',
        footwork: 'back',
        swing: { kind: 'defend', startT: 0.36, directionDeg: 0, power: 0.2, elevation: 0, footwork: 'back' },
        outcome: {
          runs: 0,
          boundary: null,
          dismissal: null,
          fielderId: null,
          endBearingDeg: null,
          endDistanceM: null,
          region: null,
        },
        contact: 'middle',
        contactPoint: null,
        contactT: 0.55,
        dismissalRisk: 0,
        expectedRuns: 0,
        region: null,
        risks: [],
      },
    ],
  } as unknown as CoachAnalysis;
  const attempt = {
    contact: { kind: 'middle' },
    outcome: { dismissal: 'bowled', region: 'behind' },
    coaching: { reason: 'beaten_by_seam', zone: null, fielderRole: null },
  } as unknown as Parameters<typeof tipOf>[2];

  it('is not a misread of the movement, while a bat the movement beat is', () => {
    const facts = {
      family: 'pace',
      mover: 'cut',
      playedMoveM: 0.09,
      wouldHitStumps: true,
      lineAtStumpsM: 0.1,
      movementM: 0.09,
      wideOfStumpsM: -0.05,
      heightAtBatM: 0.65,
      short: false,
      full: false,
      lengthBand: 'good',
      autoFootwork: 'back',
    } as unknown as BallFacts;
    const swing: NormalizedSwing = {
      kind: 'defend',
      startT: 0.36,
      directionDeg: 0,
      power: 0.2,
      elevation: 0,
      footwork: 'back',
    };
    const result = (kind: ContactKind) =>
      ({
        contact: { kind, timing: 'perfect' },
        outcome: { dismissal: 'bowled' },
        footwork: 'back',
        coaching: { reason: 'beaten_by_seam' },
      }) as unknown as Parameters<typeof inferRead>[2];
    expect(inferRead(facts, swing, result('middle')).movement).toBe('right');
    expect(inferRead(facts, swing, result('outside_edge')).movement).toBe('wrong');
  });

  it('the tip says the measured timing and that it was played on, and the action is that timing', () => {
    const rec = primaryInsight(known).recommendation;
    expect(rec).toMatchObject({ kind: 'play_later', shiftMs: 24, decision: 'defend', footwork: 'back' });
    const tip = tipOf(known, {} as BallFacts, attempt);
    expect(tip.fact).toEqual({ kind: 'early', ms: 24, where: 'played_on', zone: null });
    expect(tip.mistake).toBe('too_early');
    expect(tipSentence(LOCALES[0], tip)).toBe('24 ms early, and you played it onto the stumps: start 24 ms later.');
    for (const t of LOCALES) for (const k of BEATEN_KEYS) expect(tipSentence(t, tip).includes(t.tk(k)), k).toBe(false);
  });

  it('with the physics naming it played_on (contract, 2026-11-03), the tip is the same measured sentence', () => {
    const named = { ...known, why: ['played_on'] } as CoachAnalysis;
    const tip = tipOf(
      named,
      {} as BallFacts,
      { ...attempt, coaching: { reason: 'played_on', zone: null, fielderRole: null } } as unknown as Parameters<
        typeof tipOf
      >[2],
    );
    expect(tipSentence(LOCALES[0], tip)).toBe('24 ms early, and you played it onto the stumps: start 24 ms later.');
    const forward = { ...named, attempted: { ...named.attempted, footwork: 'forward' } } as CoachAnalysis;
    expect(tipSentence(LOCALES[0], tipOf(forward, {} as BallFacts, attempt))).toBe(
      '24 ms early, and you played it onto the stumps: defend on the back foot.',
    );
    for (const t of LOCALES) expect(t.tk('practice.coach.played_on').length).toBeGreaterThan(0);
  });

  it('a different block, played on: the fact is still the timing and the played-on, never the seam', () => {
    // The player blocked forward where the coach would block back: the action is the coach's block.
    const forward = { ...known, attempted: { ...known.attempted, footwork: 'forward' } } as CoachAnalysis;
    const rec = primaryInsight(forward).recommendation;
    expect(rec.kind).toBe('defend_back');
    const tip = tipOf(forward, {} as BallFacts, attempt);
    expect(tip.fact).toEqual({ kind: 'early', ms: 24, where: 'played_on', zone: null });
    expect(tipSentence(LOCALES[0], tip)).toBe(
      '24 ms early, and you played it onto the stumps: defend on the back foot.',
    );
  });

  it('on the reference over, every ball played on off the middle is explained by its timing, and the timing tip works', () => {
    // The real physics: blocks and drives at the full outswinger and the cutter across the timing range. Each attempt
    // played on off the middle is analysed by the coach exactly as the app does.
    let checked = 0;
    for (const id of ['ref-1', 'ref-4'] as const) {
      for (const assist of ['play', 'real'] as const) {
        const base: DeliveryRecord = referenceRecord(id, assist);
        for (const footwork of ['back', 'forward'] as const) {
          for (let errorMs = -80; errorMs <= 80; errorMs += 4) {
            const { record, result } = play(base, swingFor(base, { kind: 'defend', footwork, errorMs }));
            if (
              result.outcome.dismissal !== 'bowled' ||
              !ON_THE_BAT.has(result.contact.kind) ||
              result.contact.kind !== 'middle'
            )
              continue;
            const an = analyzeBall(record, result);
            const tip = coachTip(record, an);
            const label = `${id} ${assist} ${footwork} block ${errorMs} ms (${result.contact.kind}, physics ${result.coaching.reason})`;
            checked++;
            expect(an.read.movement, label).not.toBe('wrong');
            expect(tip.fact.kind, label).not.toBe('moved');
            if (tip.fact.kind === 'reason')
              expect(BEATEN_KEYS, label).not.toContain(`practice.coach.${tip.fact.reason}`);
            for (const t of LOCALES)
              for (const k of BEATEN_KEYS)
                expect(tipFactWords(t, tip.fact).includes(t.tk(k)), `${label}: ${k}`).toBe(false);
            const k = tip.action.kind;
            if (k === 'play_later' || k === 'play_earlier') {
              // Applied literally, the timing tip moves the same block to (near) its ideal point: it survives off the middle.
              const moved = {
                ...record.swing!,
                startT:
                  Math.round(
                    (record.swing!.startT + ((k === 'play_later' ? 1 : -1) * tip.action.shiftMs!) / 1000) * 1e4,
                  ) / 1e4,
              };
              const again = play(base, moved).result;
              expect(again.outcome.dismissal, `${label}: ${k} ${tip.action.shiftMs} ms`).toBeNull();
              expect(again.contact.kind, `${label}: ${k} ${tip.action.shiftMs} ms`).toBe('middle');
            }
          }
        }
      }
    }
    // Physics REPORT item 4's case and its kind (ref-1's early blocks, ref-4's −24 ms) exist on the repaired physics.
    // If a later physics change removes every one of them, rebuild this sweep from a new census; never drop the check.
    expect(checked, 'no ball played on off the middle in the sweep: rebuild it from a census').toBeGreaterThan(0);
  }, 120_000);
});
