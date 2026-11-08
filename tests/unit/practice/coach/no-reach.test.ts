// @vitest-environment node
/**
 * Lead rulings (A) and (B), 2026-11-04, on the physics evaluator's finding (wedge/eval-phys-5e/VERDICT.md §4): 627 of
 * 1,755 results are labelled perfect or solid with no bat contact at all (a miss, the pad, the body). Of those, 62 lie
 * inside the bat window and 9 are in Real. The timing label is an honest timing fact and stays in Why?. The card's tip
 * must not read as a good shot or as a timing fault. It says plainly that the bat never reached or met the ball, and
 * gives one stroke-choice action: never a timing action, and never "keep it along the ground" for a ball never hit.
 *
 * The balls and swings are the evaluator's own old grid (their sys1.mjs `tupleOf`, rebuilt here from the same seeds),
 * on tuples covering every class they found:
 *   - the bat window (1015, 1018);
 *   - late movement (1003);
 *   - out of reach, as aimed or with no aim (1000, 1024, 1031);
 *   - across the line, across the movement, the length, beaten for pace, the pad, and "keep it down" on a miss.
 * The census of all 627 runs in the final chain (S/coach/tools/nocontact.mjs).
 */
import { describe, expect, it } from 'vitest';
import type { DeliveryRecord, NormalizedSwing } from '@/contracts/practice';
import { formatMessage } from '@/i18n/format';
import { practiceEn } from '@/i18n/practice/en';
import { practiceHi } from '@/i18n/practice/hi';
import { practiceHiLatn } from '@/i18n/practice/hi-Latn';
import { autoField, flight as flightOf, resolveDelivery } from '@/physics';
import { batTravelMs, idealTimeFor } from '@/physics/bat';
import { ballSeed, randomOver } from '@/practice/game';
import { gaussian } from '@/practice/game/evaluate';
import { analyzeBall, coachTip, praiseEarned, tipSentence, type TipTranslator } from '@/practice/coach';

const strict = (catalog: Record<string, string>, intl: string): TipTranslator => ({
  tk(key, params) {
    if (!(key in catalog)) throw new Error(`missing copy ${key}`);
    return formatMessage(catalog[key], params, intl);
  },
});
const EN = strict(practiceEn as Record<string, string>, 'en-IN');
const OTHERS = [strict(practiceHi, 'hi-IN'), strict(practiceHiLatn, 'en-IN')];

/** What says the bat never reached or met the ball: the new facts, the movement that beat it, the physics' "beaten". */
const UNMET = /never reached|beat the bat|hit the pad|hit your body|hit the stumps|out LBW|^Beaten (by|for)|^Missed a straight ball|^Struck on the pad/;
const BAT = new Set(['middle', 'inside_edge', 'outside_edge', 'top_edge', 'leading_edge']);

// ---- The evaluator's tuple (eval-phys-5e/evidence/tools/sys1.mjs.txt, tupleOf), unchanged ----
const PITCHES = ['balanced', 'green', 'hard', 'turning'] as const;
const DIFFS = ['beginner', 'club', 'expert'] as const;
const FW = ['auto', 'forward', 'back', 'across', 'down_track'] as const;
const g = (k: string) => gaussian(`eval-phys-det|${k}`);
const u = (k: string) => Math.min(1, Math.max(0, (g(k) + 3) / 6));
function tupleOf(i: number) {
  const conditions = PITCHES[i % 4];
  const difficulty = DIFFS[Math.floor(i / 4) % 3];
  const family = i % 2 ? 'spin' : 'pace';
  const handedness = Math.floor(i / 2) % 2 ? 'left' : 'right';
  const over = randomOver({ seed: `eval-phys-det|over|${Math.floor(i / 6)}|${family}`, conditions, assist: 'real', difficulty, family });
  const ballIndex = i % 6;
  const plan = over.balls[ballIndex];
  const seed = ballSeed(over, ballIndex);
  const field = autoField(over.bowler, conditions, handedness, over.ball);
  const flight = flightOf({ plan, bowler: over.bowler, conditions, seed, handedness, ball: over.ball });
  let swing: NormalizedSwing | null = null;
  if (u(`${i}|leave`) > 0.1) {
    const kind = u(`${i}|kind`) < 0.25 ? 'defend' : 'attack';
    const footwork = FW[Math.min(4, Math.floor(u(`${i}|fw`) * 5))];
    const power = kind === 'defend' ? 0.2 : +(0.3 + 0.7 * u(`${i}|pw`)).toFixed(3);
    const err = 40 * g(`${i}|err`);
    const ideal = idealTimeFor(flight, footwork);
    swing = { kind, startT: +(ideal - batTravelMs(kind, power) / 1000 + err / 1000).toFixed(4), directionDeg: kind === 'defend' ? 0 : Math.round(-170 + 340 * u(`${i}|dir`)), power, elevation: kind === 'defend' ? 0 : +u(`${i}|el`).toFixed(2), footwork } as NormalizedSwing;
  }
  return { over, plan, seed, field, flight, swing, conditions, handedness } as const;
}

describe('a swing timed inside the band that the bat never met: the tip says so (rulings (A) and (B))', () => {
  it('on the evaluator\'s own balls: every tip says the bat never reached or met it, never a timing fact or action, never praise', () => {
    const cases: string[] = [];
    let unreachedFacts = 0;
    for (const i of [1000, 1003, 1015, 1018, 1024, 1031]) {
      const x = tupleOf(i);
      if (!x.swing) continue;
      for (const assist of ['learn', 'play', 'real'] as const) for (const tier of [0, 12, 20]) {
        const r = resolveDelivery({ flight: x.flight, swing: x.swing, field: x.field, bowler: x.over.bowler, conditions: x.conditions, handedness: x.handedness, assist, tierToleranceMs: tier });
        if (BAT.has(r.contact.kind) || !(r.contact.timing === 'perfect' || r.contact.timing === 'solid')) continue;
        const record = { version: 3, overIndex: Math.floor(i / 6), ballIndex: i % 6, bowler: x.over.bowler, plan: x.plan, seed: x.seed, conditions: x.conditions, ball: x.over.ball, field: x.field, handedness: x.handedness, assist, tierToleranceMs: tier, swing: x.swing, runs: r.outcome.runs, dismissal: r.outcome.dismissal } as DeliveryRecord;
        const an = analyzeBall(record);
        const tip = coachTip(record, an);
        const en = tipSentence(EN, tip);
        const where = `${i} ${assist}/${tier} ${r.contact.timing} ${r.contact.kind} (${r.coaching.reason}): "${en}"`;
        cases.push(where);
        if (tip.fact.kind === 'no_reach') unreachedFacts++;
        expect(an.attempted.contact, where).toBe(r.contact.kind);
        expect(en, where).toMatch(UNMET);
        expect(['early', 'late', 'late_where'], where).not.toContain(tip.fact.kind);
        expect(['play_earlier', 'play_later', 'keep_it_down', 'repeat_it', 'well_played'], where).not.toContain(tip.action.kind);
        expect(praiseEarned(an, tip.action, tip) && (tip.action.kind === 'repeat_it' || tip.action.kind === 'well_played'), where).toBe(false);
        for (const t of OTHERS) expect(() => tipSentence(t, tip), where).not.toThrow();
      }
    }
    // On 5e (FROZEN-5e census, S/coach/nocontact-5e.jsonl), these tuples hold 42 such results. Before the rulings, 21
    // of their tips said neither that the bat missed nor why, and 5 were told to keep it down. Every one of those 21
    // now carries a "never reached" fact.
    expect(cases.length).toBeGreaterThanOrEqual(30);
    expect(unreachedFacts).toBeGreaterThanOrEqual(15);
  }, 400_000);
});
