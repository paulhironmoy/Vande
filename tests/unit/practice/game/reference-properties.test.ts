// @vitest-environment node
/**
 * Behaviour properties of the reference over (task 3; DUAL-CEILING-RUBRIC EX7): one swipe repeated against all six
 * balls fails on several of them, whether it is perfectly timed for each ball or started at the same moment after
 * release; reading each ball and playing the stroke it asks for survives with good contact. Every number comes from
 * resolveDelivery with real NormalizedSwings.
 */
import { describe, expect, it } from 'vitest';
import type { AssistLevel, DeliveryResult } from '@/contracts/practice';
import { resolveDelivery } from '@/physics';
import { fixedInputGrid, intentLabel, overBalls, playBall, swingOf, type Intent } from '@/practice/game/evaluate';
import { REFERENCE_BALLS, REFERENCE_CONDITIONS, REFERENCE_OVER } from '@/practice/game/reference';

const BALLS = overBalls(REFERENCE_OVER, REFERENCE_CONDITIONS);
const LEVELS: AssistLevel[] = ['play', 'real'];
const EDGES = new Set(['inside_edge', 'outside_edge', 'top_edge', 'leading_edge']);

/** A clearly poor outcome: out, beaten (miss, pad, body), edged, or a mishit that dies off the bat. */
function poor(r: DeliveryResult): boolean {
  if (r.outcome.dismissal) return true;
  const k = r.contact.kind;
  if (k === 'miss' || k === 'pad' || k === 'body' || EDGES.has(k)) return true;
  return k === 'middle' && (r.contact.exitSpeedKph ?? 0) < 70;
}

const SWIPES: Array<{ name: string; intent: Intent }> = [
  {
    name: 'lofted straight swipe',
    intent: { kind: 'attack', directionDeg: 0, elevation: 0.9, power: 0.8, footwork: 'auto' },
  },
  {
    name: 'grounded drive through the covers',
    intent: { kind: 'attack', directionDeg: 35, elevation: 0.05, power: 0.8, footwork: 'auto' },
  },
  {
    name: 'half-lofted back-foot drive',
    intent: { kind: 'attack', directionDeg: 0, elevation: 0.4, power: 0.9, footwork: 'back' },
  },
  {
    name: 'half-lofted back-foot drive to leg',
    intent: { kind: 'attack', directionDeg: -20, elevation: 0.4, power: 0.9, footwork: 'back' },
  },
];

/**
 * Independent, frozen responses for the named reference balls. Keying by id makes a reordered over fail obviously
 * instead of silently pairing a response with the wrong delivery. These stay separate from Coach so this property
 * does not certify one recommendation implementation by asking that same implementation what to play.
 */
const RIGHT: Record<(typeof REFERENCE_BALLS)[number]['id'], Intent> = {
  'ref-1': { kind: 'attack', directionDeg: 50, elevation: 0.05, power: 0.6, footwork: 'forward' }, // drive the full outswinger through cover
  'ref-2': { kind: 'attack', directionDeg: 0, elevation: 0.05, power: 0.6, footwork: 'forward' }, // play the inswinger straight
  'ref-3': { kind: 'defend', directionDeg: 0, elevation: 0, power: 0.2, footwork: 'back' }, // get behind the hard length
  'ref-4': { kind: 'defend', directionDeg: 0, elevation: 0, power: 0.2, footwork: 'back' }, // soft hands to the cutter
  'ref-5': { kind: 'attack', directionDeg: -135, elevation: 0, power: 0.55, footwork: 'back' }, // roll the wrists on the bouncer
  'ref-6': { kind: 'defend', directionDeg: 0, elevation: 0, power: 0.2, footwork: 'forward' }, // get forward and dig out the yorker
};

describe('the reference over: the same swipe fails, reading the ball succeeds', () => {
  it('a perfectly timed fixed swipe fails clearly on at least three of the six balls', () => {
    for (const assist of LEVELS)
      for (const s of SWIPES) {
        const outcomes = BALLS.map((b) => playBall(b, s.intent, 0, assist));
        expect(outcomes.filter(poor).length, `${s.name} at ${assist}`).toBeGreaterThanOrEqual(3);
      }
  });

  it('the same swipe started at the same moment after release fails on at least three of the six', () => {
    for (const assist of LEVELS)
      for (const s of SWIPES) {
        const swing = swingOf(BALLS[0], s.intent, 0); // timed for the first ball, then repeated unchanged
        const outcomes = BALLS.map((b) =>
          resolveDelivery({
            flight: b.flight,
            swing,
            field: b.field,
            bowler: b.over.bowler,
            conditions: b.conditions,
            handedness: 'right',
            assist,
            tierToleranceMs: 0,
          }),
        );
        expect(outcomes.filter(poor).length, `${s.name} at ${assist}`).toBeGreaterThanOrEqual(3);
      }
  });

  it('reading each ball and playing the stroke it asks for survives with good contact', () => {
    for (const assist of LEVELS)
      BALLS.forEach((b, i) => {
        const id = REFERENCE_BALLS[i].id;
        const r = playBall(b, RIGHT[id], 0, assist);
        expect(r.outcome.dismissal, `${id} at ${assist}`).toBeNull();
        expect(r.contact.kind, `${id} at ${assist}`).toBe('middle');
      });
  });

  it('no fixed input of the grid is the best response to four or more of the six balls (EX7)', () => {
    const value = (r: DeliveryResult) =>
      r.outcome.dismissal ? -10 : r.outcome.runs + (r.contact.kind === 'middle' ? 0.25 : 0);
    const grid = fixedInputGrid();
    const rows = grid.map((intent) => ({ intent, scores: BALLS.map((b) => value(playBall(b, intent, 0, 'play'))) }));
    const best = BALLS.map((_, i) => Math.max(...rows.map((row) => row.scores[i])));
    const ranked = rows.map((row) => ({
      ...row,
      balls: row.scores.flatMap((score, i) => (score >= best[i] - 1e-9 ? [REFERENCE_BALLS[i].id] : [])),
    }));
    const worst = ranked.reduce((left, right) => (right.balls.length > left.balls.length ? right : left));
    const detail =
      `${intentLabel(worst.intent)} tied best on ${worst.balls.length}/6 balls ` +
      `[${worst.balls.join(',')}]; scores=${JSON.stringify(worst.scores)}; perBallBest=${JSON.stringify(best)}`;
    expect(worst.balls.length, detail).toBeLessThan(4);
  }, 900_000);
});
