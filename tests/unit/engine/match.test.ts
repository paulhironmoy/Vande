// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BallOutcome, InningsSummary, MatchEvent } from '@/contracts';
import { COMMENTARY_KEYS, engine, EXPLAIN_KEYS } from '@/engine';
import { decideResult, potmPoints, turningPoint } from '@/engine/v1/match';
import { logFor, randomMatch } from './helpers';

const ball = (runs: BallOutcome['runs'], wicket = false): BallOutcome => ({ runs, wicket: wicket ? 'bowled' : null }) as BallOutcome;
const inn = (batter: 0 | 1, balls: BallOutcome[]): InningsSummary => ({
  batter,
  bowler: batter === 0 ? 1 : 0,
  balls,
  runs: balls.reduce((s, b) => s + b.runs, 0),
  wickets: balls.filter((b) => b.wicket).length,
  ballsFaced: balls.length,
});

describe('result ladder', () => {
  it('runs decide first', () => {
    expect(decideResult([inn(0, [ball(4), ball(1)]), inn(1, [ball(2)])], [ball(0), ball(6)])).toEqual({ winner: 0, tie: false, decidedBy: 'runs', marginRuns: 3 });
  });
  it('then the Super Ball, counted only on a tie', () => {
    expect(decideResult([inn(0, [ball(4)]), inn(1, [ball(2), ball(2)])], [ball(1), ball(4)])).toEqual({ winner: 1, tie: false, decidedBy: 'super_ball', marginRuns: 3 });
  });
  it('then fewer wickets lost, then more boundaries, then a tie', () => {
    expect(decideResult([inn(0, [ball(4), ball(0, true)]), inn(1, [ball(2), ball(2)])], [ball(1), ball(1)]).decidedBy).toBe('wickets_lost');
    expect(decideResult([inn(0, [ball(4), ball(0, true)]), inn(1, [ball(2), ball(2)])], [ball(1), ball(1)]).winner).toBe(1);
    expect(decideResult([inn(0, [ball(4)]), inn(1, [ball(2), ball(2)])], [ball(0), ball(0)])).toEqual({ winner: 0, tie: false, decidedBy: 'boundaries', marginRuns: 0 });
    expect(decideResult([inn(0, [ball(2), ball(2)]), inn(1, [ball(1), ball(3)])], [ball(6), ball(6)])).toEqual({ winner: null, tie: true, decidedBy: 'tie', marginRuns: 0 });
  });
});

describe('Player of the Match and turning point', () => {
  it('scores runs, wickets, dots and the win', () => {
    // Player 0 scored 10 and conceded 6 for two wickets and three dots; player 1 scored 6 and took no wickets.
    const i0 = inn(0, [ball(4), ball(6)]);
    const i1 = inn(1, [ball(0, true), ball(0), ball(2), ball(0), ball(4), ball(0, true)]);
    const [p0, p1] = potmPoints([i0, i1], [ball(0), ball(0)], false, 0);
    expect(p0).toBe(10 + 16 + 2 - 3 + 4);
    expect(p1).toBe(6 + 0 + 0 - 5);
  });

  it('points at the ball that swung the match towards the winner', () => {
    const tp = turningPoint([inn(0, [ball(1), ball(1), ball(6), ball(1), ball(0), ball(1)]), inn(1, [ball(1), ball(0, true), ball(0, true)])], [ball(0), ball(0)], false, 0);
    expect(tp.innings).toBe(1);
    expect([1, 2]).toContain(tp.index);
  });
});

describe('buildMatchLog', () => {
  it('builds an ordered, spoiler-ready timeline from both innings', async () => {
    for (let k = 0; k < 40; k++) {
      const m = randomMatch(`log|${k}`);
      const log = await logFor(m);
      expect(log.engine).toBe(engine.ENGINE_VERSION);
      expect(log.schema).toBe(1);
      expect(log.innings.map((i) => i.batter)).toEqual([0, 1]);
      // Events: innings 0, then the chase, optional Super Ball, then the result.
      const kinds = log.events.map((e) => e.t);
      expect(kinds[0]).toBe('innings_start');
      expect(kinds.filter((t) => t === 'innings_start')).toHaveLength(2);
      expect(kinds.filter((t) => t === 'result')).toHaveLength(1);
      const balls = log.events.filter((e): e is Extract<MatchEvent, { t: 'ball' }> => e.t === 'ball');
      expect(balls.some((b) => b.outcome.dead)).toBe(false);
      expect(balls.filter((b) => b.innings === 0)).toHaveLength(log.innings[0].ballsFaced);
      expect(balls.filter((b) => b.innings === 'super')).toHaveLength(log.superBall.used ? 2 : 0);
      const tp = log.events[log.result.turningPointEvent];
      expect(tp.t).toBe('ball');
      expect(log.events[log.events.length - 1].t).toBe('commentary');
      for (const e of log.events) if (e.t === 'commentary') expect(COMMENTARY_KEYS).toContain(e.key);
      for (const b of balls) expect(EXPLAIN_KEYS).toContain(b.outcome.factors.explainKey);
      // Running score is consistent with the summaries.
      const last0 = balls.filter((b) => b.innings === 0).pop();
      if (last0) expect(last0.score.runs).toBe(log.innings[0].runs);
      // Inputs: every answered ball, keyed by its own ball index.
      for (const i of [0, 1] as const) {
        const answered = m.inputs[i].filter((x) => x !== null);
        expect(log.inputs[i]).toHaveLength(answered.length);
        expect(log.inputs[i].map((x) => x.ball)).toEqual([...log.inputs[i].map((x) => x.ball)].sort((a, b) => a - b));
      }
      expect(log.result.tie).toBe(log.result.winner === null);
      expect(log.superBall.used).toBe(log.innings[0].runs === log.innings[1].runs);
      expect(log.superBall.outcomes).toHaveLength(2);
    }
  });

  it('refuses to build from an unfinished innings', async () => {
    const m = randomMatch('unfinished');
    await expect(logFor({ ...m, states: [engine.startInnings(0), m.states[1]] })).rejects.toThrow();
  });
});
