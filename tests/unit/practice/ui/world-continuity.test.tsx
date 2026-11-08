import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { PracticeKitContext, type PracticeKit } from '@/practice/ui/context';
import type { GestureSurfaceProps } from '@/practice/ui/flow/types';
import { Play } from '@/practice/ui/screens/Play';
import type { TesterApi } from '@/practice/ui/tester/useTester';
import { attack, quickPlay, setup, until, useFakeTimers } from './flowSetup';

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

function kit(value: ReturnType<typeof setup>): PracticeKit {
  return {
    engine: value.engine,
    coach: value.coach,
    createStage: value.createStage,
    input: { GestureSurface: GestureProbe },
    build: {
      lengthBand: () => 'good',
      lineBand: () => 'outside_off',
    },
  } as unknown as PracticeKit;
}

function view(value: ReturnType<typeof setup>) {
  vi.spyOn(value.flow, 'stageOwnsInput').mockReturnValue(true);
  vi.spyOn(value.flow, 'attachCanvas').mockImplementation(() => undefined);
  vi.spyOn(value.flow, 'attachCoachCanvas').mockImplementation(() => undefined);
  return render(
    <PracticeKitContext.Provider value={kit(value)}>
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
}

beforeEach(() => useFakeTimers());
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Unity world continuity and dead-ball ownership', () => {
  it('arms the Unity keyboard stop only while the delivery can accept a gesture', async () => {
    const value = setup();
    value.flow.init();
    await quickPlay(value.flow);
    await until(() => value.flow.getState().phase === 'runup' || value.flow.getState().phase === 'live');

    view(value);

    expect(screen.getByTestId('practice-play').getAttribute('data-unity-input')).toBe('active');
    expect(screen.getByTestId('practice-canvas').getAttribute('data-gameplay-input')).toBe('active');
    expect(screen.getByTestId('practice-unity-keyboard-target')).toBeTruthy();
    value.flow.dispose();
  });

  it('keeps the world mounted but inert behind one focused result action and contextual detail', async () => {
    const value = setup();
    value.flow.init();
    value.swings.push(attack());
    await quickPlay(value.flow);
    await until(() => value.flow.getState().phase === 'dead');
    await until(() => value.flow.getState().insight?.status === 'ready');

    view(value);

    const root = screen.getByTestId('practice-play');
    const canvas = screen.getByTestId('practice-canvas');
    const result = screen.getByTestId('practice-result');
    const practice = screen.getByTestId('practice-practice-ball');
    expect(root.getAttribute('data-unity-input')).toBe('blocked');
    expect(canvas.getAttribute('data-gameplay-input')).toBe('blocked');
    expect(screen.getByTestId('practice-world-stage')).toBeTruthy();
    expect(screen.queryByTestId('practice-unity-keyboard-target')).toBeNull();
    expect(result.getAttribute('role')).toBe('region');
    expect(screen.getByTestId('practice-result-reason').textContent).not.toBe('');
    expect(screen.getByTestId('practice-result-recommendation').textContent).not.toBe('');
    expect(document.activeElement).toBe(practice);

    const why = screen.getByTestId('practice-why-toggle');
    const alternatives = screen.getByTestId('practice-alternatives-toggle');
    expect(why.getAttribute('aria-controls')).toBe('practice-result-why');
    expect(alternatives.getAttribute('aria-controls')).toBe('practice-result-alternatives');
    expect(screen.getByTestId('practice-demo')).toBeTruthy();
    fireEvent.click(why);
    expect(why.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('practice-why')).toBeTruthy();
    fireEvent.click(alternatives);
    expect(why.getAttribute('aria-expanded')).toBe('false');
    expect(alternatives.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByTestId('practice-why')).toBeNull();
    expect(screen.getByTestId('practice-alternatives')).toBeTruthy();
    value.flow.dispose();
  });

  it('promotes Next ball to the sole dominant focus when Coach is unavailable', async () => {
    const value = setup({ coach: false });
    value.flow.init();
    value.swings.push(attack());
    await quickPlay(value.flow);
    await until(() => value.flow.getState().phase === 'dead');

    view(value);

    expect(screen.queryByTestId('practice-practice-ball')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('practice-next-ball'));
    expect(screen.queryByTestId('practice-why-toggle')).toBeNull();
    expect(screen.queryByTestId('practice-demo')).toBeNull();
    value.flow.dispose();
  });
});
