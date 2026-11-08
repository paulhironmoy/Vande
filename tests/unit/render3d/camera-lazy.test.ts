/**
 * A live result's gaze is integrated as frames read it (R-C1, lead decision 2026-11-04): play() pays only for what
 * comes before the hand-over, each frame for its own few grid steps. The table must be the same, bit for bit, however it
 * is read: frame by frame, in any order, or all at once (reading its last entry first integrates all of it in one go,
 * as the build did before), and no single frame's share of the work may be long.
 */
import { describe, expect, it } from 'vitest';
import type { DeliveryResult, Handedness, NormalizedSwing } from '@/contracts/practice';
import { practiceGaze } from '@/render3d/core/camera';
import type { BallScript } from '@/render3d/core/choreo';
import { buildPracticeScript } from '@/render3d/practice/script';
import type { PracticeSceneSetup } from '@/render3d/practice/types';
import { evalOvers, overBalls, type EvalBall } from '@/practice/game/evaluate';
import { REFERENCE_OVER } from '@/practice/game/reference';
import { resolveDelivery } from '@/physics/resolve';
import { batTravelMs } from '@/physics/bat';
import { autoField } from '@/physics/field';
import { flight as physicsFlight } from '@/physics/delivery';
import { cpuMicros, skipOverBudgetWhenLoaded } from '../support/timing';

const setupOf = (eb: EvalBall, hand: Handedness): PracticeSceneSetup => ({ field: hand === 'right' ? eb.field : autoField(eb.over.bowler, eb.conditions, 'left', eb.over.ball), bowler: eb.over.bowler, conditions: eb.conditions, handedness: hand });

interface Case {
  label: string;
  setup: PracticeSceneSetup;
  flight: ReturnType<typeof physicsFlight>;
  result: DeliveryResult;
  /** Scene ms after the release at which the result takes over (40 ms after the swing starts, or after the stumps). */
  afterRelease: number;
}

type Swing = { kind: 'attack' | 'defend'; e: number; directionDeg: number; power: number; footwork: 'auto' | 'forward' } | null;

function add(out: Case[], label: string, setup: PracticeSceneSetup, fl: Case['flight'], sw: Swing, hand: Handedness, eb: EvalBall) {
  const swing: NormalizedSwing | null = sw ? { kind: sw.kind, startT: fl.idealContactT - batTravelMs(sw.kind, sw.power) / 1000 + sw.e / 1000, directionDeg: sw.directionDeg, power: sw.power, elevation: 0, footwork: sw.footwork } : null;
  const result = resolveDelivery({ flight: fl, swing, field: setup.field, bowler: eb.over.bowler, conditions: eb.conditions, handedness: hand, assist: 'play', tierToleranceMs: 0 });
  out.push({ label, setup, flight: fl, result, afterRelease: swing ? swing.startT * 1000 + 40 : fl.stumpsT * 1000 + 300 });
}

/** The reference over (W0's swings and the drive 40 ms late): 12 hand-overs. */
function referenceCases(): Case[] {
  const out: Case[] = [];
  const drive = (e: number): Swing => ({ kind: 'attack', e, directionDeg: 55, power: 0.7, footwork: 'forward' });
  const defend = (footwork: 'auto' | 'forward'): Swing => ({ kind: 'defend', e: 0, directionDeg: 0, power: 0.2, footwork });
  const safe = [null, drive(0), defend('auto'), defend('auto'), null, defend('forward')];
  for (const eb of overBalls(REFERENCE_OVER, 'balanced')) {
    const setup = setupOf(eb, 'right');
    add(out, `ref-${eb.ballIndex + 1} safe`, setup, eb.flight, safe[eb.ballIndex], 'right', eb);
    add(out, `ref-${eb.ballIndex + 1} drive+40`, setup, eb.flight, drive(40), 'right', eb);
  }
  return out;
}

/** 48 random deliveries: two difficulties, pace and spin, two overs each, the second over left-handed. */
function randomCases(): Case[] {
  const out: Case[] = [];
  let n = 0;
  for (const difficulty of ['beginner', 'expert'] as const) {
    for (const family of ['pace', 'spin'] as const) {
      evalOvers({ difficulty, overs: 2, key: `camera-lazy|${difficulty}|${family}`, family }).forEach((over, oi) =>
        over.forEach((eb) => {
          const k = n++;
          const hand: Handedness = oi % 2 === 1 ? 'left' : 'right';
          const fl = hand === 'right' ? eb.flight : physicsFlight({ plan: eb.over.balls[eb.ballIndex], bowler: eb.over.bowler, conditions: eb.conditions, seed: eb.seed, ball: eb.over.ball, handedness: 'left' });
          const kind: 'attack' | 'defend' = k % 3 === 0 ? 'attack' : 'defend';
          const sw: Swing = k % 3 === 2 ? null : { kind, e: ((k * 37) % 81) - 40, directionDeg: ((k * 53) % 120) - 60, power: kind === 'attack' ? 0.7 : 0.2, footwork: k % 2 ? 'forward' : 'auto' };
          add(out, `${difficulty} ${family} over ${oi + 1} ball ${eb.ballIndex + 1} ${hand}${sw ? '' : ' left'}`, setupOf(eb, hand), fl, sw, hand, eb);
        }),
      );
    }
  }
  return out;
}

const REFS = referenceCases();
const CASES = [...REFS, ...randomCases()];

/** The result's script as the stage builds it at play(), handing over from its live script. */
function handover(c: Case): BallScript {
  const live = buildPracticeScript({ setup: c.setup, flight: c.flight });
  const at = live.practice!.releaseScene + c.afterRelease;
  return buildPracticeScript({ setup: c.setup, flight: c.flight, result: c.result, handover: { script: live, atScene: at } });
}

const same = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Object.is(a.x, b.x) && Object.is(a.y, b.y) && Object.is(a.z, b.z);

describe("a live result's gaze integrated as it is read (R-C1)", () => {
  it('is the same table, bit for bit, read frame by frame (in order or scrambled) as read all at once: 120 checks', () => {
    expect(CASES.length).toBe(60);
    let checks = 0;
    for (const c of CASES) {
      for (const rm of [false, true]) {
        const lazy = handover(c);
        const whole = handover(c);
        const rel = lazy.practice!.releaseScene;
        // All at once: its last entry first.
        practiceGaze(whole, rel + 20_000, rm);
        // Frame by frame at 60 fps from before the release, as the screen reads it.
        for (let t = rel - 10; t <= rel + 3000; t += 1000 / 60) expect(same(practiceGaze(lazy, t, rm), practiceGaze(whole, t, rm)), `${c.label}${rm ? ' (RM)' : ''} t=${t}`).toBe(true);
        // Scrambled: backwards, then a seeded scatter, on a fresh lazy table too.
        const scattered = handover(c);
        let s = 12345;
        const times: number[] = [];
        for (let t = rel + 2999; t >= rel; t -= 7.3) times.push(t);
        for (let k = 0; k < 400; k++) {
          s = (s * 1103515245 + 12345) % 2147483648;
          times.push(rel - 10 + (s / 2147483648) * 3010);
        }
        for (const t of times) {
          expect(same(practiceGaze(lazy, t, rm), practiceGaze(whole, t, rm)), `${c.label}${rm ? ' (RM)' : ''} scrambled t=${t}`).toBe(true);
          expect(same(practiceGaze(scattered, t, rm), practiceGaze(whole, t, rm)), `${c.label}${rm ? ' (RM)' : ''} scattered t=${t}`).toBe(true);
        }
        checks++;
      }
    }
    expect(checks).toBe(120);
  });

  it("keeps each frame's share of the work short: under 8 ms per 60 fps frame on a desktop (the reference over)", (ctx) => {
    // The budget: about twice the p95 frame (3.7 ms) measured offline at a machine load of about 10 (2026-11-04).
    // Each frame is timed as the least of three fresh runs, in CPU time of the thread (tests/unit/support/timing.ts), so a
    // stall or a busy machine is not counted as the work. The budget is exact; only an overrun on a machine above load 20 is
    // skipped, by name (a quiet machine fails it).
    const BUDGET_MS = 8;
    let worst = 0;
    let worstAt = '';
    for (const c of REFS) {
      for (const rm of [false, true]) {
        const frames = 120;
        const best = new Array<number>(frames).fill(Number.POSITIVE_INFINITY);
        for (let run = 0; run < 3; run++) {
          const s = handover(c);
          const at = s.practice!.releaseScene + c.afterRelease;
          for (let k = 0; k < frames; k++) {
            const t0 = cpuMicros();
            practiceGaze(s, at + k * (1000 / 60), rm);
            best[k] = Math.min(best[k], (cpuMicros() - t0) / 1000);
          }
        }
        const m = Math.max(...best);
        if (m > worst) {
          worst = m;
          worstAt = `${c.label}${rm ? ' (RM)' : ''}`;
        }
      }
    }
    skipOverBudgetWhenLoaded(ctx, `camera gaze, worst frame (${worstAt})`, worst, BUDGET_MS, 'ms');
    expect(worst, `worst frame ${worst.toFixed(2)} ms (${worstAt})`).toBeLessThan(BUDGET_MS);
  });
});
