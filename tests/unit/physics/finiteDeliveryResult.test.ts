// @vitest-environment node
/**
 * Property: no number anywhere in a DeliveryResult is NaN or infinite: ball, bat and fielder paths, events, contact,
 * outcome and LBW. A non-finite sample draws the ball at NaN on the stage (wedge camera REPORT §9, P-A: a carried
 * return's ball height). 1,008 seeded random deliveries (beginner/club/expert x pace/spin x right/left x Play/Real)
 * with a seeded leave, block or attack each, plus the reference over at five timings for both hands.
 */
import { describe, expect, it } from 'vitest';
import type { DeliveryResult, Handedness, NormalizedSwing } from '@/contracts/practice';
import { rngFromKey } from '@/engine/prng';
import { batTravelMs } from '@/physics/bat';
import { flight } from '@/physics/delivery';
import { autoField } from '@/physics/field';
import { resolveDelivery } from '@/physics/resolve';
import { evalOvers, overBalls, swingOf } from '@/practice/game/evaluate';
import { REFERENCE_CONDITIONS, REFERENCE_OVER } from '@/practice/game/reference';

/** Paths of the first few non-finite numbers in a value (empty when every number is finite). */
function nonFinite(value: unknown, path = 'result', out: string[] = []): string[] {
  if (out.length >= 3) return out;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) out.push(`${path} = ${value}`);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) nonFinite(item, `${path}.${key}`, out);
  }
  return out;
}

function expectFinite(result: DeliveryResult, label: string): void {
  expect(nonFinite(result), label).toEqual([]);
}

describe('every DeliveryResult is finite', () => {
  it('holds over 1,008 seeded random deliveries for both hands at Play and Real', () => {
    let checked = 0;
    for (const difficulty of ['beginner', 'club', 'expert'] as const) {
      for (const family of ['pace', 'spin'] as const) {
        for (const handedness of ['right', 'left'] as const satisfies readonly Handedness[]) {
          for (const assist of ['play', 'real'] as const) {
            const key = `phys-finite|${difficulty}|${family}|${handedness}|${assist}`;
            for (const over of evalOvers({ difficulty, overs: 7, key, assist, family })) {
              for (const ball of over) {
                const plan = ball.over.balls[ball.ballIndex];
                const fl = flight({ plan, bowler: ball.over.bowler, conditions: ball.conditions, seed: ball.seed, ball: ball.over.ball, handedness });
                const field = autoField(ball.over.bowler, ball.conditions, handedness, ball.over.ball);
                const draw = rngFromKey(`phys-finite|swing|${ball.seed}`);
                const u = draw.float();
                const kind = u < 0.15 ? null : u < 0.35 ? 'defend' as const : 'attack' as const;
                const power = kind === 'defend' ? 0.15 : [0.4, 0.7, 1][Math.floor(draw.float() * 3)];
                const swing: NormalizedSwing | null = kind === null ? null : {
                  kind,
                  startT: fl.idealContactT - batTravelMs(kind, power) / 1000 + Math.round((draw.float() * 2 - 1) * 60) / 1000,
                  directionDeg: kind === 'defend' ? 0 : Math.round(draw.float() * 300 - 150),
                  power,
                  elevation: kind === 'defend' ? 0 : [0, 0, 0.4, 0.8][Math.floor(draw.float() * 4)],
                  footwork: (['auto', 'forward', 'back'] as const)[Math.floor(draw.float() * 3)],
                };
                const result = resolveDelivery({ flight: fl, swing, field, bowler: ball.over.bowler, conditions: ball.conditions, handedness, assist, tierToleranceMs: 0 });
                expectFinite(result, `${key} ${ball.seed} ${JSON.stringify(swing)}`);
                checked++;
              }
            }
          }
        }
      }
    }
    expect(checked).toBe(1008);
  }, 600_000);

  it('holds on the reference over at five timings of the cover drive, a block and a leave, for both hands', () => {
    const drive = { kind: 'attack' as const, directionDeg: 55, elevation: 0, power: 0.7, footwork: 'forward' as const };
    const block = { kind: 'defend' as const, directionDeg: 0, elevation: 0, power: 0.2, footwork: 'auto' as const };
    for (const ball of overBalls(REFERENCE_OVER, REFERENCE_CONDITIONS)) {
      for (const handedness of ['right', 'left'] as const) {
        const fl = handedness === 'right'
          ? ball.flight
          : flight({ plan: ball.over.balls[ball.ballIndex], bowler: ball.over.bowler, conditions: ball.conditions, seed: ball.seed, ball: ball.over.ball, handedness });
        const field = autoField(ball.over.bowler, ball.conditions, handedness, ball.over.ball);
        const at = { ...ball, flight: fl };
        for (const assist of ['play', 'real'] as const) {
          const swings = [
            ...[-80, -40, 0, 40, 80].map((errorMs) => swingOf(at, drive, errorMs)),
            swingOf(at, block, 0),
            null,
          ];
          for (const swing of swings) {
            const result = resolveDelivery({ flight: fl, swing, field, bowler: ball.over.bowler, conditions: ball.conditions, handedness, assist, tierToleranceMs: 0 });
            expectFinite(result, `ref ball ${ball.ballIndex + 1} ${handedness} ${assist} ${JSON.stringify(swing)}`);
          }
        }
      }
    }
  }, 300_000);
});
