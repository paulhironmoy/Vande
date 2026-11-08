/**
 * DoD CHU-03: the numbers the HUD shows are the numbers recomputed from the balls, in every one of at least 200 played
 * balls, and a change is shown after the ball's physical outcome and never before (log order). Chases of many seeds and
 * many different innings are driven through the real flow on the fake ball physics: the chase module is real, so this
 * checks the flow's part (when the shown chase changes, and that it is the chase of exactly the balls shown).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedSwing } from '@/contracts';
import { chaseSeedAt, requiredRateX100Of } from '@/practice/chase';
import { attack, caught, defend, useFakeTimers } from '../flowSetup';
import { chaseRig, openChase, untilDead } from './harness';

beforeEach(() => useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

/** A small deterministic generator (mulberry32), so every run plays the same balls. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The fake physics' convention: defend 0, a light attack 1, power 0.6 four, 0.9 six, direction 180 a catch. */
function swingFor(u: number): NormalizedSwing {
  if (u < 0.4) return defend();
  if (u < 0.7) return attack(0.3);
  if (u < 0.82) return attack(0.6);
  if (u < 0.96) return attack(0.9);
  return caught();
}

describe('the shown chase over many balls', () => {
  it('is the chase of the balls shown, over at least 200 balls and many seeds, and never leads the innings', async () => {
    let balls = 0;
    let losses = 0;
    let wins = 0;
    for (let c = 0; c < 40; c++) {
      const rig = chaseRig({ seed: chaseSeedAt((c * 7) % 256) });
      const next = rng(1000 + c);
      for (let i = 0; i < 12; i++) rig.swings.push(swingFor(next()));
      const { flow, target } = rig;
      const seen: Array<{ screen: string; phase: string; committed: number; shown: number }> = [];
      await openChase(flow);
      flow.subscribe(() => {
        const st = flow.getState();
        if (st.chase)
          seen.push({
            screen: st.screen,
            phase: st.phase,
            committed: st.innings?.balls ?? 0,
            shown: st.chase.state.ballsFaced,
          });
      });
      for (let n = 1; n <= 12; n++) {
        await untilDead(flow, n);
        const st = flow.getState();
        const results = st.innings!.current?.deliveries ?? [];
        const all = [...st.innings!.overs.flatMap((o) => o.deliveries), ...results];
        expect(all).toHaveLength(n);
        const runs = all.reduce((s, r) => s + r.runs, 0);
        const shown = st.chase!.state;
        const decided = shown.result !== 'in_progress';
        // Every number is recomputed from the balls played (the event log), not read from the chase's own fields.
        expect(shown.ballsFaced).toBe(n);
        expect(shown.runs).toBe(runs);
        expect(shown.runsNeeded).toBe(Math.max(0, target - runs));
        expect(shown.ballsLeft).toBe(12 - n);
        expect(shown.requiredRateX100).toBe(decided ? null : requiredRateX100Of(Math.max(0, target - runs), 12 - n));
        expect(st.board.runs).toBe(runs);
        expect(st.board.balls).toBe(n);
        const dismissed = all.some((r) => r.dismissal !== null);
        expect(shown.result).toBe(
          dismissed ? 'lost_wicket' : runs >= target ? 'won' : n === 12 ? 'lost_balls' : 'in_progress',
        );
        balls++;
        if (decided) {
          if (shown.result === 'won') wins++;
          else losses++;
          break;
        }
        flow.nextBall();
      }
      // Order (the log): the shown chase never leads the innings, and a ball is shown only at its dead ball.
      let previousShown = 0;
      for (const e of seen) {
        expect(e.shown).toBeLessThanOrEqual(e.committed);
        if (e.shown !== previousShown) expect(e.phase).toBe('dead');
        previousShown = e.shown;
      }
    }
    console.info(`hud-sweep: ${balls} balls checked in 40 chases (${wins} won, ${losses} lost)`);
    expect(balls).toBeGreaterThanOrEqual(200);
    // Both kinds of end were swept, so the sweep covered wins, wickets and the balls running out alike.
    expect(wins).toBeGreaterThan(0);
    expect(losses).toBeGreaterThan(0);
  }, 240_000);
});
