/**
 * A live result's gaze is held inside the peaks of what the screen showed (camera.ts); those peaks are measured by a
 * scan that goes on while it is read and in the spare time of frames (PERF-2, 2026-11-07): `play()` pays for the windows
 * to the ideal contact only, and the rest is measured by `advanceGaze` slices, by what reading pays, or by the first step
 * that needs it. Whichever does the measuring, the table must be the same, bit for bit (camera-lazy.test.ts holds the
 * read orders; here the spare-time slices, and what is left to do when).
 */
import { describe, expect, it } from 'vitest';
import type { DeliveryResult, Handedness, NormalizedSwing } from '@/contracts/practice';
import { advanceGaze, practiceGaze, prewarmPracticeGaze } from '@/render3d/core/camera';
import type { BallScript } from '@/render3d/core/choreo';
import { buildPracticeScript } from '@/render3d/practice/script';
import type { PracticeSceneSetup } from '@/render3d/practice/types';
import { overBalls, type EvalBall } from '@/practice/game/evaluate';
import { REFERENCE_OVER } from '@/practice/game/reference';
import { resolveDelivery } from '@/physics/resolve';
import { batTravelMs } from '@/physics/bat';
import { autoField } from '@/physics/field';

const setupOf = (eb: EvalBall, hand: Handedness): PracticeSceneSetup => ({
  field: hand === 'right' ? eb.field : autoField(eb.over.bowler, eb.conditions, 'left', eb.over.ball),
  bowler: eb.over.bowler,
  conditions: eb.conditions,
  handedness: hand,
});

interface Case {
  label: string;
  setup: PracticeSceneSetup;
  eb: EvalBall;
  result: DeliveryResult;
  /** Scene ms after the release at which the result takes over. */
  afterRelease: number;
  swung: boolean;
}

function cases(): Case[] {
  const out: Case[] = [];
  for (const eb of overBalls(REFERENCE_OVER, 'balanced')) {
    const setup = setupOf(eb, 'right');
    for (const [tag, kind, e] of [
      ['drive', 'attack', 40],
      ['drive early', 'attack', -40],
      ['leave', null, 0],
    ] as const) {
      const swing: NormalizedSwing | null = kind
        ? {
            kind,
            startT: eb.flight.idealContactT - batTravelMs(kind, 0.7) / 1000 + e / 1000,
            directionDeg: 55,
            power: 0.7,
            elevation: 0,
            footwork: 'forward',
          }
        : null;
      const result = resolveDelivery({
        flight: eb.flight,
        swing,
        field: eb.field,
        bowler: eb.over.bowler,
        conditions: eb.conditions,
        handedness: 'right',
        assist: 'play',
        tierToleranceMs: 0,
      });
      out.push({
        label: `ref-${eb.ballIndex + 1} ${tag}`,
        setup,
        eb,
        result,
        afterRelease: swing ? swing.startT * 1000 + 40 : eb.flight.stumpsT * 1000 + 300,
        swung: swing !== null,
      });
    }
  }
  return out;
}
const CASES = cases();

function handover(c: Case): BallScript {
  const live = buildPracticeScript({ setup: c.setup, flight: c.eb.flight });
  const at = live.practice!.releaseScene + c.afterRelease;
  return buildPracticeScript({
    setup: c.setup,
    flight: c.eb.flight,
    result: c.result,
    handover: { script: live, atScene: at },
  });
}

const same = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Object.is(a.x, b.x) && Object.is(a.y, b.y) && Object.is(a.z, b.z);

describe("a live result's gaze scan", () => {
  it('is left for spare time after a swing (the windows to the ideal contact are measured), and done at once for a leave', () => {
    let swings = 0;
    let waiting = 0;
    for (const c of CASES) {
      const s = handover(c);
      prewarmPracticeGaze(s, false);
      // 0 units asks only whether anything is left.
      const left = advanceGaze(s, false, 0);
      if (c.swung) {
        swings++;
        if (left) waiting++;
      } else
        expect(left, `${c.label}: a leave's hand-over is past the ideal contact: all of it is measured`).toBe(false);
    }
    expect(swings).toBe(12);
    expect(waiting, 'swings whose scan waits').toBeGreaterThanOrEqual(9);
    // A script with no live result has none to go on with.
    const idle = buildPracticeScript({ setup: CASES[0].setup, flight: null });
    prewarmPracticeGaze(idle, false);
    expect(advanceGaze(idle, false, 1000)).toBe(false);
  });

  it('is the same table, bit for bit, whoever measures its peaks: spare-time slices of any size, reading, or the step that needs them', () => {
    let checks = 0;
    for (const c of CASES) {
      for (const rm of [false, true]) {
        const whole = handover(c);
        const sliced = handover(c);
        const tiny = handover(c);
        const rel = whole.practice!.releaseScene;
        // Reference: the last entry first, so every window is measured by the step that needs it.
        practiceGaze(whole, rel + 20_000, rm);
        // Spare time: slices of 150 units until nothing is left, then read frame by frame.
        prewarmPracticeGaze(sliced, rm);
        let slices = 0;
        while (advanceGaze(sliced, rm, 150)) slices++;
        expect(advanceGaze(sliced, rm, 150)).toBe(false);
        // Spare time in slices of one unit, a few of them, and the rest by reading.
        prewarmPracticeGaze(tiny, rm);
        for (let k = 0; k < 40; k++) advanceGaze(tiny, rm, 1);
        for (let t = rel - 10; t <= rel + 9100; t += 1000 / 30) {
          const want = practiceGaze(whole, t, rm);
          expect(same(practiceGaze(sliced, t, rm), want), `${c.label}${rm ? ' (RM)' : ''} sliced t=${t}`).toBe(true);
          expect(same(practiceGaze(tiny, t, rm), want), `${c.label}${rm ? ' (RM)' : ''} tiny t=${t}`).toBe(true);
        }
        if (!c.swung) expect(slices, `${c.label}: a leave has none left`).toBe(0);
        checks++;
      }
    }
    expect(checks).toBe(CASES.length * 2);
  }, 240_000);
});
