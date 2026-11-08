/**
 * The dead ball card's edge, by renderer (screens/Play.tsx resultEdge, ResultLayer.module.css): Unity and the
 * first-person Three.js stage put it at the left (the rear camera's batter is on the right; the Three.js stage's
 * protected regions at the dead ball are a central column with its free side on the left), Classic at the right, in
 * the right half above its ball-path strip (tests/e2e/practice-layout.spec.ts checks the boxes in a browser; the
 * measurements are in release/product-sequence/stage-1-practice/wedge/worker/).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { PracticeKitContext, type PracticeKit } from '@/practice/ui/context';
import type { CoachKit, GestureSurfaceProps } from '@/practice/ui/flow/types';
import { Play, resultEdge } from '@/practice/ui/screens/Play';
import type { TesterApi } from '@/practice/ui/tester/useTester';
import { attack, quickPlay, setup, until, useFakeTimers } from './flowSetup';

const GestureProbe: ComponentType<GestureSurfaceProps> = () => <div />;

function tester(): TesterApi {
  return { enabled: false, active: false, consentNeeded: false, begin: vi.fn(), decline: vi.fn(), current: null, answer: vi.fn(), skip: vi.fn(), marker: vi.fn(), endSession: vi.fn(), gesture: vi.fn(), nextOver: vi.fn(), abandon: vi.fn() };
}

function kitOf(value: { engine: unknown; coach: CoachKit | null; createStage: unknown }): PracticeKit {
  return { engine: value.engine, coach: value.coach, createStage: value.createStage, input: { GestureSurface: GestureProbe }, ground: { boundaryR: 70, ringR: 27.4, pitchHalf: 10.06, bladeM: 0.96, striker: { x: 0, z: 10.06 } }, fielderClass: () => 'ring', build: { lengthBand: () => 'good', lineBand: () => 'outside_off', stockRange: () => [125, 135], variationsFor: () => ['stock'] } } as unknown as PracticeKit;
}

beforeEach(() => useFakeTimers());
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the dead ball card edge', () => {
  it('is the left for Unity and the Three.js stage, the right for Classic', () => {
    expect(resultEdge(true, '3d')).toBe('left');
    expect(resultEdge(true, '2d')).toBe('left');
    expect(resultEdge(false, '3d')).toBe('left');
    expect(resultEdge(false, '2d')).toBe('right');
  });

  for (const stage of ['3d', '2d'] as const) {
    it(`the card carries it (${stage})`, async () => {
      const value = setup();
      value.flow.init();
      value.swings.push(attack());
      await quickPlay(value.flow);
      await until(() => value.flow.getState().phase === 'dead');
      vi.spyOn(value.flow, 'attachCanvas').mockImplementation(() => undefined);
      vi.spyOn(value.flow, 'attachCoachCanvas').mockImplementation(() => undefined);
      const state = value.flow.getState();
      render(
        <PracticeKitContext.Provider value={kitOf(value)}>
          <Play flow={value.flow} state={{ ...state, quality: { ...state.quality, stage } }} onHome={vi.fn()} onSettings={vi.fn()} appVersion="test" onNextOver={vi.fn()} onChooseOver={vi.fn()} onHarder={null} tester={tester()} />
        </PracticeKitContext.Provider>,
      );
      expect(screen.getByTestId('practice-result').getAttribute('data-edge')).toBe(stage === '2d' ? 'right' : 'left');
    });
  }
});
