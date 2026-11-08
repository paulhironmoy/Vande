import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import type { NormalizedSwing } from '@/contracts';
import { PracticeKitContext, type PracticeKit } from '@/practice/ui/context';
import type { GestureSurfaceProps } from '@/practice/ui/flow/types';
import { Play } from '@/practice/ui/screens/Play';
import type { TesterApi } from '@/practice/ui/tester/useTester';
import { attack, defend, quickPlay, setup, until, useFakeTimers } from './flowSetup';

const GestureProbe: ComponentType<GestureSurfaceProps> = () => <div data-testid="host-gesture-probe" />;

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

function kit(
  engine: ReturnType<typeof setup>['engine'],
  coach: ReturnType<typeof setup>['coach'],
  createStage: ReturnType<typeof setup>['createStage'],
): PracticeKit {
  return {
    engine,
    coach,
    createStage,
    input: { GestureSurface: GestureProbe },
    build: {
      lengthBand: () => 'good',
      lineBand: () => 'outside_off',
    },
  } as unknown as PracticeKit;
}

function view(flow: ReturnType<typeof setup>['flow'], value: PracticeKit) {
  vi.spyOn(flow, 'stageOwnsInput').mockReturnValue(true);
  vi.spyOn(flow, 'attachCanvas').mockImplementation(() => undefined);
  vi.spyOn(flow, 'attachCoachCanvas').mockImplementation(() => undefined);
  return render(
    <PracticeKitContext.Provider value={value}>
      <Play
        flow={flow}
        state={flow.getState()}
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
}

beforeEach(() => useFakeTimers());
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('dead-ball swing marker', () => {
  it('does not surface a result swing before the ball is dead', async () => {
    const { flow, engine, coach, createStage } = setup();
    flow.init();
    await quickPlay(flow);
    await until(() => flow.getState().phase === 'live');

    view(flow, kit(engine, coach, createStage));

    expect(screen.queryByTestId('practice-result')).toBeNull();
    expect(document.querySelector('[data-swing]')).toBeNull();
    flow.dispose();
  });

  it.each<{ expected: 'attack' | 'defend' | 'leave'; swing: NormalizedSwing | 'leave' }>([
    { expected: 'attack', swing: attack() },
    { expected: 'defend', swing: defend() },
    { expected: 'leave', swing: 'leave' },
  ])('exposes the authoritative $expected result only after dead ball', async ({ expected, swing }) => {
    const { flow, engine, coach, createStage, swings } = setup();
    flow.init();
    swings.push(swing);
    await quickPlay(flow);
    await until(() => flow.getState().phase === 'dead');

    view(flow, kit(engine, coach, createStage));

    expect(flow.getState().last?.result.swing?.kind ?? 'leave').toBe(expected);
    expect(screen.getByTestId('practice-result').getAttribute('data-swing')).toBe(expected);
    expect(document.querySelectorAll('[data-swing]')).toHaveLength(1);
    flow.dispose();
  });
});
