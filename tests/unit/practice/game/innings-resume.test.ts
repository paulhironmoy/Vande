// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { NormalizedSwing, PracticeInningsState } from '@/contracts/practice';
import { BAT_TRAVEL_MS, autoField, replayDelivery } from '@/physics';
import { inningsReducer, inningsSummary, leaveRecord, newInnings, nextDelivery, overSummary, resumeInnings } from '@/practice/game/innings';
import { bowlerFor, buildBall, buildOver, randomOver } from '@/practice/game/overs';
import { nextFlight, playBall, replayOver, verifyRecord } from '@/practice/game/replay';

const OPTS = { id: 'resume', conditions: 'balanced' as const, assist: 'play' as const, handedness: 'right' as const };

function started(plan = randomOver({ seed: 'resume-over', conditions: 'balanced', assist: 'play', beginner: false })): PracticeInningsState {
  const s = inningsReducer(newInnings(OPTS), { type: 'chooseOver', plan, field: autoField(plan.bowler, 'balanced') });
  return inningsReducer(s, { type: 'deliveryStarted' });
}

describe('resuming an innings (no save-scumming)', () => {
  it('a delivery in flight is resolved as a leave through the physics, the same way every time', () => {
    const s = started();
    expect(s.inFlight).toEqual({ overIndex: 0, ballIndex: 0 });
    const r1 = resumeInnings(s);
    const r2 = resumeInnings(JSON.parse(JSON.stringify(s)));
    expect(r2).toEqual(r1);
    expect(r1.inFlight).toBeNull();
    expect(r1.balls).toBe(1);
    const rec = r1.current ? r1.current.deliveries[0] : r1.overs[0].deliveries[0];
    expect(rec.swing).toBeNull();
    const leave = replayDelivery(rec);
    expect(rec.runs).toBe(leave.outcome.runs);
    expect(rec.dismissal).toBe(leave.outcome.dismissal);
    expect(leave.contact.kind === 'leave' || leave.contact.kind === 'pad' || leave.contact.kind === 'body').toBe(true);
  });

  it('a ball that was going to hit the stumps still gets you out', () => {
    const bowler = bowlerFor({ family: 'pace', paceBand: 'fast', seed: 'straight' });
    const straight = buildBall({ family: 'pace', paceBand: 'fast', variation: 'stock', target: { lineM: 0, lengthM: 4 } });
    const plan = buildOver({ bowler, balls: [straight, straight, straight, straight, straight, straight], shuffle: false, seed: 'straight' });
    const s = resumeInnings(started(plan));
    expect(['out']).toContain(s.status);
    expect(['bowled', 'lbw']).toContain(s.dismissal?.record.dismissal);
  });

  it('leaves everything else alone', () => {
    const fresh = newInnings(OPTS);
    expect(resumeInnings(fresh)).toBe(fresh);
    const choosing = { ...fresh, inFlight: { overIndex: 0, ballIndex: 0 } };
    expect(resumeInnings(choosing)).toEqual({ ...fresh, inFlight: null });
  });

  it('the leave record is the next ball, unplayed', () => {
    const s = started();
    const next = nextDelivery(s)!;
    const rec = leaveRecord(next);
    expect(rec).toMatchObject({ overIndex: 0, ballIndex: 0, swing: null, tierToleranceMs: 0, seed: next.seed, plan: next.plan });
  });
});

describe('a whole over through the physics', () => {
  it('six balls, each replaying exactly, with the summary built from the replays', () => {
    let s = inningsReducer(newInnings(OPTS), { type: 'chooseOver', plan: randomOver({ seed: 'whole-over', conditions: 'balanced', assist: 'play', beginner: false }), field: autoField(randomOver({ seed: 'whole-over', conditions: 'balanced', assist: 'play', beginner: false }).bowler, 'balanced') });
    const results = [];
    for (let i = 0; i < 6 && s.status === 'batting'; i++) {
      const next = nextDelivery(s)!;
      const f = nextFlight(next);
      const power = 0.7;
      const travel = (BAT_TRAVEL_MS.attackMin + BAT_TRAVEL_MS.attackRange * power) / 1000;
      const swing: NormalizedSwing | null = i % 3 === 2 ? null : { kind: i % 3 === 0 ? 'attack' : 'defend', startT: f.idealContactT - travel, directionDeg: 25 * (i - 2), power, elevation: 0.1, footwork: 'auto' };
      const out = playBall(s, swing)!;
      results.push(out.result);
      expect(verifyRecord(out.record)).toBe(true);
      s = out.state;
    }
    const done = s.status === 'out' ? s.current ?? s.overs[s.overs.length - 1] : s.overs[0];
    expect(replayOver(done).map((r) => JSON.stringify(r))).toEqual(results.map((r) => JSON.stringify(r)));
    const sum = overSummary(done);
    expect(sum).toEqual(overSummary(done, results));
    expect(sum.runs).toBe(results.reduce((a, r) => a + r.outcome.runs, 0));
    expect(inningsSummary(s).runs).toBe(s.runs);
  });
});
