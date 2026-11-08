import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { PracticeKitContext, type PracticeKit } from '@/practice/ui/context';
import { Play } from '@/practice/ui/screens/Play';
import type { GestureSurfaceProps } from '@/practice/ui/flow/types';
import type { TesterApi } from '@/practice/ui/tester/useTester';
import { quickPlay, setup, until, useFakeTimers } from './flowSetup';

const tester: TesterApi = {
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

const GestureProbe: ComponentType<GestureSurfaceProps> = () => (
  <div data-testid="host-gesture-probe" />
);

beforeEach(() => useFakeTimers());
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Unity-owned Play surface', () => {
  it('routes the focusable semantic Pause through the native deferred-settle authority and resumes the retained stage', async () => {
    const { flow, engine, coach, createStage } = setup();
    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    const stage = flow.host.stage;
    if (!stage) throw new Error('stage was not prepared');
    Object.defineProperty(stage, 'ownsInput', { configurable: true, value: true });
    let stageVisible = true;
    const pauses: string[] = [];
    const resumes: string[] = [];
    stage.pause = vi.fn(async (reason = 'background') => {
      pauses.push(reason);
      stageVisible = false;
      return true;
    });
    stage.resume = vi.fn(async (reason = 'foreground') => {
      resumes.push(reason);
      if (reason !== 'foreground') stageVisible = true;
      return true;
    });
    void flow.play();
    await until(() => flow.getState().phase === 'runup' || flow.getState().phase === 'live');
    vi.spyOn(flow, 'attachCanvas').mockImplementation(() => undefined);
    vi.spyOn(flow, 'attachCoachCanvas').mockImplementation(() => undefined);
    const kit = {
      engine,
      coach,
      createStage,
      input: { GestureSurface: GestureProbe },
      ground: { boundaryR: 70, ringR: 27.4, pitchHalf: 10.06, bladeM: 0.96, striker: { x: 0, z: 10.06 } },
      fielderClass: () => 'ring',
      build: {
        lengthBand: () => 'good',
        lineBand: () => 'outside_off',
        variationsFor: () => ['stock'],
        stockRange: () => [125, 135],
      },
    } as unknown as PracticeKit;

    render(
      <PracticeKitContext.Provider value={kit}>
        <Play
          flow={flow}
          state={flow.getState()}
          onHome={vi.fn()}
          onSettings={vi.fn()}
          appVersion="test"
          onNextOver={vi.fn()}
          onChooseOver={vi.fn()}
          onHarder={null}
          tester={tester}
        />
      </PracticeKitContext.Provider>,
    );

    const pause = screen.getByTestId('practice-unity-semantic-pause') as HTMLButtonElement;
    expect(pause.disabled).toBe(false);
    pause.focus();
    expect(document.activeElement).toBe(pause);
    // A native <button> is the keyboard/TalkBack activation target; click is the activation event both emit.
    fireEvent.click(pause);
    await until(() => flow.getState().phase === 'paused');
    expect(flow.getState().last).toMatchObject({ interrupted: true });
    expect(flow.getState().last?.record.swing).toBeNull();
    expect(flow.getState().innings?.balls).toBe(1);
    expect(pauses).toEqual(['player']);
    expect(stageVisible).toBe(false);

    flow.resume();
    await until(() => flow.getState().phase === 'dead');
    expect(resumes).toEqual(['player']);
    expect(stageVisible).toBe(true);
    flow.dispose();
  });

  it('uses the localized host hint as the visible one-gesture teaching authority during ready', async () => {
    const { flow, engine, coach, createStage } = setup({ teach: true });
    flow.init();
    flow.prepareOver({ kind: 'random' });
    await until(() => flow.getState().stageReady);
    void flow.play();
    await until(() => flow.getState().phase === 'ready');
    vi.spyOn(flow, 'stageOwnsInput').mockReturnValue(true);
    vi.spyOn(flow, 'attachCanvas').mockImplementation(() => undefined);
    vi.spyOn(flow, 'attachCoachCanvas').mockImplementation(() => undefined);
    const kit = {
      engine,
      coach,
      createStage,
      input: { GestureSurface: GestureProbe },
      ground: { boundaryR: 70, ringR: 27.4, pitchHalf: 10.06, bladeM: 0.96, striker: { x: 0, z: 10.06 } },
      fielderClass: () => 'ring',
      build: {
        lengthBand: () => 'good',
        lineBand: () => 'outside_off',
        variationsFor: () => ['stock'],
        stockRange: () => [125, 135],
      },
    } as unknown as PracticeKit;

    render(
      <PracticeKitContext.Provider value={kit}>
        <Play
          flow={flow}
          state={flow.getState()}
          onHome={vi.fn()}
          onSettings={vi.fn()}
          appVersion="test"
          onNextOver={vi.fn()}
          onChooseOver={vi.fn()}
          onHarder={null}
          tester={tester}
        />
      </PracticeKitContext.Provider>,
    );

    expect(screen.getByTestId('practice-hint').textContent).toBe(
      'Pull back · Watch · Flick forward · Do nothing to leave',
    );
    expect(screen.getByTestId('practice-hint').getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByTestId('host-gesture-probe')).toBeNull();
    flow.dispose();
  });

  it('draws no duplicate web HUD or live input target at dead ball and retains semantic score', async () => {
    const { flow, engine, coach, createStage } = setup();
    flow.init();
    await quickPlay(flow);
    await until(() => flow.getState().phase === 'dead');
    await until(() => flow.getState().insight?.status === 'ready');
    vi.spyOn(flow, 'stageOwnsInput').mockReturnValue(true);
    vi.spyOn(flow, 'attachCanvas').mockImplementation(() => undefined);
    vi.spyOn(flow, 'attachCoachCanvas').mockImplementation(() => undefined);
    const deadBallUi = vi.spyOn(flow, 'presentDeadBallUi').mockResolvedValue(true);
    const state = flow.getState();
    const kit = {
      engine,
      coach,
      createStage,
      input: { GestureSurface: GestureProbe },
      ground: { boundaryR: 70, ringR: 27.4, pitchHalf: 10.06, bladeM: 0.96, striker: { x: 0, z: 10.06 } },
      fielderClass: () => 'ring',
      build: {
        lengthBand: () => 'good',
        lineBand: () => 'outside_off',
        variationsFor: () => ['stock'],
        stockRange: () => [125, 135],
      },
    } as unknown as PracticeKit;

    const rendered = render(
      <PracticeKitContext.Provider value={kit}>
        <Play
          flow={flow}
          state={{ ...state, insight: { key: state.insight!.key, status: 'working', analysis: null, primary: null, tip: null } }}
          onHome={vi.fn()}
          onSettings={vi.fn()}
          appVersion="test"
          onNextOver={vi.fn()}
          onChooseOver={vi.fn()}
          onHarder={null}
          tester={tester}
        />
      </PracticeKitContext.Provider>,
    );

    expect(deadBallUi).toHaveBeenLastCalledWith({
      reason: 'Reading the ball…',
      recommendation: '',
      primaryAction: 'practice_ball',
      primaryLabel: 'Practice this ball',
      secondaryAction: 'next_ball',
      secondaryLabel: 'Next ball',
    });
    rendered.rerender(
      <PracticeKitContext.Provider value={kit}>
        <Play
          flow={flow}
          state={state}
          onHome={vi.fn()}
          onSettings={vi.fn()}
          appVersion="test"
          onNextOver={vi.fn()}
          onChooseOver={vi.fn()}
          onHarder={null}
          tester={tester}
        />
      </PracticeKitContext.Provider>,
    );
    expect(deadBallUi.mock.calls.at(-1)?.[0]).toMatchObject({
      recommendation: expect.any(String),
      primaryAction: 'practice_ball',
      secondaryAction: 'next_ball',
    });
    expect(deadBallUi.mock.calls.at(-1)?.[0].recommendation).not.toBe('');

    expect(screen.queryByTestId('practice-status')).toBeNull();
    expect(screen.queryByTestId('practice-conditions')).toBeNull();
    expect(screen.queryByTestId('practice-pause')).toBeNull();
    expect(screen.queryByTestId('host-gesture-probe')).toBeNull();

    expect(screen.queryByTestId('practice-unity-keyboard-target')).toBeNull();
    expect(screen.queryByTestId('practice-unity-semantic-pause')).toBeNull();
    expect(screen.getAllByText(/0\/0/).length).toBeGreaterThan(0);
    const semanticBrief = screen.getByTestId('practice-unity-semantic-brief');
    expect(semanticBrief.getAttribute('aria-haspopup')).toBe('dialog');
    expect(screen.getByTestId('practice-unity-semantic-setup-facts').textContent).toContain('bowler');
    fireEvent.click(semanticBrief);
    expect(screen.getByTestId('practice-brief')).toBeTruthy();

    const css = readFileSync(
      'src/practice/ui/screens/Play.module.css',
      'utf8',
    );
    expect(css).toMatch(/\.unitySemanticHud button\s*\{[^}]*min-width:\s*48px;[^}]*min-height:\s*48px;/su);
    expect(css).toMatch(/\.unityKeyboardTarget:focus-visible\s*\{[^}]*outline:\s*3px solid #fff;/su);
    flow.dispose();
  });
});

