/**
 * O-4 (eval-coach VERDICT): Coach Mode's card and the comparison beside it must agree. The coach's measured comparison
 * of the attempt with the one before decides: when it says 'worse' ("Not yet."), the card shows no tick, no green and
 * no confirming words ("play it the same way again"); it says the tip's own fact with the recommended response itself,
 * as the coach does whenever praise is withheld. Reproduces the evaluator's case: the recommended stroke 10 ms late,
 * clean, 0 runs, hit straight to the bowler, after an attempt that scored 6.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import type { AttemptComparison, CoachAnalysis, CoachRecommendation, PrimaryInsight } from '@/contracts';
import { createPracticeT } from '@/i18n/practice';
import { compareAttempts, type CoachTip } from '@/practice/coach';
import { tipActionWords } from '@/practice/coach/tip';
import { PracticeKitContext, type PracticeKit } from '@/practice/ui/context';
import { cardTip } from '@/practice/ui/coaching';
import type { CoachSession, LastBall } from '@/practice/ui/flow/state';
import type { CoachKit, GestureSurfaceProps } from '@/practice/ui/flow/types';
import { Coach } from '@/practice/ui/screens/Coach';
import { attack, quickPlay, setup, until, useFakeTimers } from './flowSetup';

const GestureProbe: ComponentType<GestureSurfaceProps> = () => <div />;
const en = createPracticeT('en', null);

function kitOf(value: { engine: unknown; coach: CoachKit | null; createStage: unknown }): PracticeKit {
  return { engine: value.engine, coach: value.coach, createStage: value.createStage, input: { GestureSurface: GestureProbe }, ground: { boundaryR: 70, ringR: 27.4, pitchHalf: 10.06, bladeM: 0.96, striker: { x: 0, z: 10.06 } }, fielderClass: () => 'ring', build: { lengthBand: () => 'good', lineBand: () => 'outside_off', stockRange: () => [125, 135], variationsFor: () => ['stock'] } } as unknown as PracticeKit;
}

const REPEAT: CoachRecommendation = { kind: 'repeat_it', decision: 'attack', footwork: 'forward', shiftMs: null, directionDeg: 0, region: 'straight', lofted: false };

/** The recommended straight drive, off the middle, not out, at this timing error and for these runs. */
function attempt(base: CoachAnalysis, timingErrorMs: number, runs: 0 | 6): CoachAnalysis {
  return {
    ...base,
    read: { ...base.read, length: 'right' },
    attempted: { ...base.attempted, decision: 'attack', footwork: 'forward', directionDeg: 0, elevation: 0, power: 0.7, contact: 'middle', timing: 'solid', timingErrorMs, runs, dismissal: null, spread: null },
    options: base.options.map((o, i) => (i === 0 ? { ...o, decision: 'attack' as const, footwork: 'forward' as const, risks: [] } : o)),
  };
}

/** The coach's tip for the newer attempt: hit straight to the bowler, play it the same way again (clean contact). */
const TIP: CoachTip = { mistake: null, fact: { kind: 'reason', reason: 'hit_to_fielder', zone: null, fielder: 'bowler' }, action: REPEAT, cleanContact: true };

beforeEach(() => useFakeTimers());
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

async function card(verdictFrom: (prev: CoachAnalysis, next: CoachAnalysis) => AttemptComparison) {
  const value = setup();
  value.flow.init();
  value.swings.push(attack(0.7, 0));
  await quickPlay(value.flow);
  await until(() => value.flow.getState().phase === 'dead');
  const last = value.flow.getState().last as LastBall;
  const base = value.coach!.analyzeBall(last.record, last.result);
  const previous = attempt(base, 0, 6);
  const next = attempt(base, 10, 0);
  const comparison = verdictFrom(previous, next);
  const coach = { ...value.coach!, primaryInsight: () => ({ reason: 'hit_to_fielder', timingMs: 10, recommendation: REPEAT }) as PrimaryInsight };
  const session: CoachSession = { key: 'k', source: last.record, sourceResult: last.result, overNumber: 1, ballNumber: 1, base: previous, baseTip: TIP, latest: { result: last.result, analysis: next, tip: TIP }, comparison, mastery: coach.startMastery('k'), event: null, attempts: [true, true], back: { screen: 'live', phase: 'dead' } };
  render(
    <PracticeKitContext.Provider value={kitOf({ ...value, coach })}>
      <Coach session={session} busy={false} onReplay={vi.fn()} onDemo={vi.fn()} onBack={vi.fn()} />
    </PracticeKitContext.Provider>,
  );
  return { comparison, next };
}

describe('O-4: the Coach card agrees with the measured comparison', () => {
  it('"Not yet." beside it: no tick, no green, no "play it the same way again"; the recommended response instead', async () => {
    // The coach's own measured comparison (clean both times): 10 ms further from ideal timing and 6 runs fewer.
    const { comparison } = await card((p, n) => compareAttempts(p, n, { previous: true, next: true }));
    expect(comparison.verdict).toBe('worse');
    expect(comparison.changes).toEqual(['timing_further', 'fewer_runs']);
    expect(screen.getByTestId('practice-compare').getAttribute('data-verdict')).toBe('worse');
    expect(screen.getByTestId('practice-compare').textContent).toContain('Not yet.');
    const line = screen.getByTestId('practice-coach-recommendation');
    expect(line.getAttribute('data-confirm')).toBe('false');
    expect(line.textContent).not.toContain(en.t('practice.tip.do.repeat_it'));
    // The same measured fact, then the recommended response itself (its aim), as the coach says withheld praise.
    expect(line.textContent).toContain(tipActionWords(en, { ...REPEAT, kind: 'aim_for_the_gap' }));
  });

  it('when the comparison is not "worse", the confirmation stands as the coach formed it', async () => {
    const { comparison } = await card((p) => compareAttempts(p, p, { previous: true, next: true }));
    expect(comparison.verdict).toBe('same');
    const line = screen.getByTestId('practice-coach-recommendation');
    expect(line.getAttribute('data-confirm')).toBe('true');
    expect(line.textContent).toContain(en.t('practice.tip.do.repeat_it'));
  });

  it('cardTip: only a confirmation beside a "worse" verdict changes, to the recommended response itself', () => {
    const worse: AttemptComparison = { changes: ['fewer_runs'], verdict: 'worse', timingMs: 0, runsDelta: -6 };
    const better: AttemptComparison = { changes: ['more_runs'], verdict: 'better', timingMs: 0, runsDelta: 6 };
    const an = { ball: { wouldHitStumps: false } } as unknown as CoachAnalysis;
    expect(cardTip(TIP, an, better)).toEqual({ tip: TIP, withheld: false });
    expect(cardTip(TIP, an, null)).toEqual({ tip: TIP, withheld: false });
    expect(cardTip(TIP, an, worse).tip.action.kind).toBe('aim_for_the_gap');
    expect(cardTip({ ...TIP, action: { ...REPEAT, decision: 'defend', footwork: 'back' } }, an, worse).tip.action.kind).toBe('defend_back');
    const correction: CoachTip = { ...TIP, action: { ...REPEAT, kind: 'play_earlier', shiftMs: 20 } };
    expect(cardTip(correction, an, worse)).toEqual({ tip: correction, withheld: false });
  });
});
