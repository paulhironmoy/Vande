/**
 * The cards as rendered: the dead ball shows the coach's tip (coachTip + tipSentence through coaching.ts, ports.ts and
 * the coach loop) as one sentence with exactly one action, and Coach Mode's card shows one sentence too (the W0
 * "Leave it. Leave it: …" and "Drive … . Play straighter …" came from its option words joined to the recommendation).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import type { CoachRecommendation } from '@/contracts';
import { createPracticeT } from '@/i18n/practice';
import { practiceEn } from '@/i18n/practice/en';
import { PracticeKitContext, type PracticeKit } from '@/practice/ui/context';
import type { CoachKit, GestureSurfaceProps } from '@/practice/ui/flow/types';
import type { CoachSession } from '@/practice/ui/flow/state';
import { Coach } from '@/practice/ui/screens/Coach';
import { Play } from '@/practice/ui/screens/Play';
import type { TesterApi } from '@/practice/ui/tester/useTester';
import { tipOf } from '@/practice/coach/tip';
import type { BallFacts } from '@/practice/coach/facts';
import { actionCount, actionPatterns } from './copyChecks';
import { fakeCoach } from './fakeCoach';
import { attack, quickPlay, setup, until, useFakeTimers } from './flowSetup';

const GestureProbe: ComponentType<GestureSurfaceProps> = () => <div />;
const en = createPracticeT('en', null);
const ACTIONS = actionPatterns(practiceEn as Record<string, string>);

function tester(): TesterApi {
  return {
    enabled: false,
    active: false,
    consentNeeded: false,
    begin: vi.fn(),
    decline: vi.fn(),
    current: null,
    answer: vi.fn(),
    skip: vi.fn(),
    marker: vi.fn(),
    endSession: vi.fn(),
    gesture: vi.fn(),
    nextOver: vi.fn(),
    abandon: vi.fn(),
  };
}

function kitOf(value: { engine: unknown; coach: CoachKit | null; createStage: unknown }): PracticeKit {
  return {
    engine: value.engine,
    coach: value.coach,
    createStage: value.createStage,
    input: { GestureSurface: GestureProbe },
    ground: { boundaryR: 70, ringR: 27.4, pitchHalf: 10.06, bladeM: 0.96, striker: { x: 0, z: 10.06 } },
    fielderClass: () => 'ring',
    build: {
      lengthBand: () => 'good',
      lineBand: () => 'outside_off',
      stockRange: () => [125, 135],
      variationsFor: () => ['stock'],
    },
  } as unknown as PracticeKit;
}

beforeEach(() => useFakeTimers());
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the dead-ball card shows the tip', () => {
  it('one sentence, its fact as the reason and its one action as the recommendation, after the consequence', async () => {
    const value = setup();
    value.flow.init();
    value.swings.push(attack());
    await quickPlay(value.flow);
    await until(() => value.flow.getState().phase === 'dead');
    // The outcome is at once; the coach reads only after the dead ball's consequence (INSIGHT_AFTER_DEAD_MS).
    expect(value.flow.getState().insight?.status).toBe('working');
    await until(() => value.flow.getState().insight?.status === 'ready');
    const insight = value.flow.getState().insight!;
    expect(insight.tip).not.toBeNull();
    expect(insight.tip!.action).toEqual(insight.primary!.recommendation);
    vi.spyOn(value.flow, 'attachCanvas').mockImplementation(() => undefined);
    vi.spyOn(value.flow, 'attachCoachCanvas').mockImplementation(() => undefined);
    const ready = value.flow.getState();
    const play = (state: typeof ready) => (
      <PracticeKitContext.Provider value={kitOf(value)}>
        <Play
          flow={value.flow}
          state={state}
          onHome={vi.fn()}
          onSettings={vi.fn()}
          appVersion="test"
          onNextOver={vi.fn()}
          onChooseOver={vi.fn()}
          onHarder={null}
          tester={tester()}
        />
      </PracticeKitContext.Provider>
    );
    // While the coach reads: "Reading the ball…" in the card's one live region ...
    const view = render(
      play({ ...ready, insight: { ...insight, status: 'working', analysis: null, primary: null, tip: null } }),
    );
    const region = screen.getByTestId('practice-result-words');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('Reading the ball…');
    // ... then the tip, in the same region (the same node), so a screen reader announces it.
    view.rerender(play(ready));
    expect(screen.getByTestId('practice-result-words')).toBe(region);
    const words = value.coach!.tipWords(en, insight.tip!);
    expect(region.textContent).toBe(words.sentence);
    const tip = screen.getByTestId('practice-result-tip');
    expect(tip.textContent).toBe(words.sentence);
    expect(screen.getByTestId('practice-result-reason').textContent).toBe(words.fact);
    expect(screen.getByTestId('practice-result-recommendation').textContent).toBe(words.action);
    expect(actionCount(tip.textContent!, ACTIONS)).toBe(1);
    // The whole card asks for one thing: no other line on it is an action.
    const card = screen.getByTestId('practice-result');
    const others = [...card.querySelectorAll('p')].filter((p) => p !== tip).map((p) => p.textContent ?? '');
    expect(others.filter((l) => actionCount(l, ACTIONS) > 0)).toEqual([]);
    value.flow.dispose();
  });
});

describe('praise only when earned (anti-fake rule 7)', () => {
  it('a stroke that worked with a risk the recommendation avoids: no "well played", no tick, the risk and one action', async () => {
    const coach = fakeCoach();
    const wellPlayed: CoachRecommendation = {
      kind: 'well_played',
      decision: 'attack',
      footwork: 'forward',
      shiftMs: null,
      directionDeg: 40,
      region: 'cover',
      lofted: false,
    };
    const inner = coach.analyzeBallInSlices;
    coach.analyzeBallInSlices = async (record, result, opts) => {
      const a = await inner(record, result, opts);
      return {
        ...a,
        attempted: { ...a.attempted, spread: { dismissalRisk: 0.01, expectedRuns: 1.5, risks: ['can_edge'] } },
      };
    };
    coach.primaryInsight = (a) => ({ reason: a.why[0], timingMs: null, recommendation: wellPlayed });
    coach.coachTip = (_r, a) =>
      tipOf(
        a,
        {} as BallFacts,
        {
          contact: { kind: 'middle' },
          outcome: { dismissal: null, region: 'cover' },
          coaching: { zone: 'cover', fielderRole: null },
        } as never,
      );
    const value = setup({ deps: { coach } });
    value.flow.init();
    value.swings.push(attack());
    await quickPlay(value.flow);
    await until(() => value.flow.getState().insight?.status === 'ready');
    vi.spyOn(value.flow, 'attachCanvas').mockImplementation(() => undefined);
    vi.spyOn(value.flow, 'attachCoachCanvas').mockImplementation(() => undefined);
    render(
      <PracticeKitContext.Provider value={kitOf({ ...value, coach })}>
        <Play
          flow={value.flow}
          state={value.flow.getState()}
          onHome={vi.fn()}
          onSettings={vi.fn()}
          appVersion="test"
          onNextOver={vi.fn()}
          onChooseOver={vi.fn()}
          onHarder={null}
          tester={tester()}
        />
      </PracticeKitContext.Provider>,
    );
    const tip = screen.getByTestId('practice-result-tip');
    // (The real tip module reads the fake analysis: its recommended response here is a forward block.)
    expect(tip.textContent).toBe('It worked, but that stroke can take an edge: defend on the front foot.');
    expect(tip.getAttribute('data-confirm')).toBe('false');
    expect(screen.getByTestId('practice-result').textContent).not.toMatch(
      /well played|works as well as|same way again/iu,
    );
    expect(actionCount(tip.textContent!, ACTIONS)).toBe(1);
    value.flow.dispose();
  });
});

describe('the Coach Mode card shows one sentence', () => {
  const leave: CoachRecommendation = {
    kind: 'leave_outside_off',
    decision: 'leave',
    footwork: 'forward',
    shiftMs: null,
    directionDeg: null,
    region: null,
    lofted: null,
  };

  async function session(coach: CoachKit): Promise<{ s: CoachSession; value: ReturnType<typeof setup> }> {
    const value = setup({ deps: { coach } });
    value.flow.init();
    value.swings.push(attack());
    await quickPlay(value.flow);
    await until(() => value.flow.getState().insight?.status === 'ready');
    const st = value.flow.getState();
    const base = st.insight!.analysis!;
    const s: CoachSession = {
      key: 'k',
      source: st.last!.record,
      sourceResult: st.last!.result,
      overNumber: 1,
      ballNumber: 1,
      base,
      baseTip: coach.coachTip(st.last!.record, base),
      latest: null,
      comparison: null,
      mastery: coach.startMastery('k'),
      event: null,
      attempts: [],
      back: { screen: 'live', phase: 'dead' },
    };
    return { s, value };
  }

  it('a leave reads once: the measured fact, then "leave it" (never "Leave it. Leave it: …")', async () => {
    const coach = fakeCoach();
    coach.primaryInsight = (a) => ({ reason: a.why[0], timingMs: null, recommendation: leave });
    coach.coachTip = () => ({
      mistake: 'late_movement',
      fact: { kind: 'moved', mover: 'swing', towards: 'away', cm: 19, where: 'miss', zone: null },
      action: leave,
    });
    const { s, value } = await session(coach);
    render(
      <PracticeKitContext.Provider value={kitOf({ ...value, coach })}>
        <Coach session={s} busy={false} onReplay={vi.fn()} onDemo={vi.fn()} onBack={vi.fn()} />
      </PracticeKitContext.Provider>,
    );
    const line = screen.getByTestId('practice-coach-recommendation').textContent!;
    expect(line).toBe('It swung 19 cm away in the air, and it beat the bat: leave it, it is passing off stump.');
    expect(line).not.toMatch(/leave it\. leave it/iu);
    expect(actionCount(line, ACTIONS)).toBe(1);
    expect(screen.getByTestId('practice-coach-recommendation').getAttribute('data-mistake')).toBe('late_movement');
    value.flow.dispose();
  });

  it('after an attempt it is that attempt’s own tip, still one action', async () => {
    const coach = fakeCoach();
    const { s, value } = await session(coach);
    const later: CoachRecommendation = {
      kind: 'play_earlier',
      decision: 'attack',
      footwork: 'forward',
      shiftMs: 24,
      directionDeg: 45,
      region: 'cover',
      lofted: false,
    };
    const latest = {
      result: s.sourceResult,
      analysis: s.base!,
      tip: {
        mistake: 'too_late' as const,
        fact: { kind: 'late' as const, ms: 24, faceDeg: 18, where: 'outside_edge' as const, zone: null },
        action: later,
      },
    };
    coach.primaryInsight = () => ({ reason: 'too_late', timingMs: 24, recommendation: later });
    render(
      <PracticeKitContext.Provider value={kitOf({ ...value, coach })}>
        <Coach
          session={{
            ...s,
            latest,
            comparison: { changes: ['timing_closer'], verdict: 'better', timingMs: 40, runsDelta: 0 },
          }}
          busy={false}
          onReplay={vi.fn()}
          onDemo={vi.fn()}
          onBack={vi.fn()}
        />
      </PracticeKitContext.Provider>,
    );
    const line = screen.getByTestId('practice-coach-recommendation').textContent!;
    expect(line).toBe('24 ms late, with the bat face 18° off your line: start 24 ms earlier.');
    expect(actionCount(line, ACTIONS)).toBe(1);
    value.flow.dispose();
  });
});
