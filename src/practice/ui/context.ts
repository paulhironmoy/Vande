/**
 * The Practice UI's dependencies in one context: the engine, the predefined-over kit, the coach, input, audio and the
 * stage factory bound in ./ports.ts (or fixtures in tests), plus the ground geometry the field maps draw. Screens read
 * it with useKit(); the flow controller lives in the app component and is passed down.
 */
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { AssistLevel, Fielder, TimingBands } from '@/contracts';
import type { AudioKit, BuildKit, CoachKit, InputKit, PracticeEngine, StageFactory } from './flow/types';
import type { OffThreadWork } from './flow/offThread';
import type { FlowState, PracticeFlow } from './flow/controller';
import type { StageRegion } from './flow/stageTypes';

/** Ground geometry for drawings (metres, the physics frame; the physics owns the numbers). */
export interface GroundGeometry {
  boundaryR: number;
  /** The 30-yard ring's radius about the pitch centre. */
  ringR: number;
  /** Half the pitch length (stumps to the centre). */
  pitchHalf: number;
  /** Blade length, toe to the top of the blade (for "cm from the toe"). */
  bladeM: number;
  /** Where bearings and distances "from the striker" are measured (the physics' STRIKER_REF). */
  striker: { x: number; z: number };
}

export type FielderClass = 'keeper' | 'bowler' | 'close' | 'ring' | 'deep';

export interface PracticeKit {
  engine: PracticeEngine;
  build: BuildKit;
  coach: CoachKit | null;
  input: InputKit;
  audio: AudioKit | null;
  createStage: StageFactory;
  /** A work thread for one visit (the live ball's physics and the coach's readings off the main thread), or none. */
  createWork?: () => OffThreadWork | null;
  ground: GroundGeometry;
  fielderClass(f: Fielder): FielderClass;
  /** Virtual bat travel from swing start to the contact zone (ms), from the physics; used by the test hooks. */
  batTravelMs(kind: 'defend' | 'attack', power: number): number;
  /** The timing bands a delivery was judged by (the physics' activeBands); the lesson's timing scale draws them. */
  timingBands?(assist: AssistLevel, toleranceMs: number): TimingBands;
}

export const PracticeKitContext = createContext<PracticeKit | null>(null);

export function useKit(): PracticeKit {
  const kit = useContext(PracticeKitContext);
  if (!kit) throw new Error('practice: no PracticeKit provided');
  return kit;
}

/**
 * The stage's protected regions now, for the dead ball's card to keep off the ball's path (components/
 * useCardPlacement.ts): given by the app for the Three.js stage only (Classic and Unity place their cards by renderer).
 */
export const StageRegionsContext = createContext<(() => readonly StageRegion[]) | null>(null);

export function useStageRegions(): (() => readonly StageRegion[]) | null {
  return useContext(StageRegionsContext);
}

/** The controller's state, re-rendering on every change. */
export function useFlowState(flow: PracticeFlow): FlowState {
  return useSyncExternalStore(flow.subscribe, flow.getState, flow.getState);
}
