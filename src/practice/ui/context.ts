/**
 * The Practice UI's dependencies in one context: the engine, Build an Over kit, input kit and stage factory bound in
 * ./ports.ts (or fixtures in tests), plus the ground geometry the radar and wagon wheel draw. Screens read it with
 * useKit(); the flow controller lives in the route and is passed down.
 */
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Fielder } from '@/contracts';
import type { BuildKit, InputKit, PracticeEngine, StageFactory } from './flow/types';
import type { FlowState, PracticeFlow } from './flow/controller';

/** Ground geometry for drawings (metres, the physics frame; the physics owns the numbers). */
export interface GroundGeometry {
  boundaryR: number;
  /** The 30-yard ring's radius about the pitch centre. */
  ringR: number;
  /** Half the pitch length (stumps to the centre). */
  pitchHalf: number;
  /** Blade length, toe to the top of the blade (for "cm from the toe"). */
  bladeM: number;
}

/** Region boundaries (bearing from the striker, degrees; src/physics REGION_EDGES). */
export interface RegionEdges {
  straight: number;
  midOff: number;
  cover: number;
  point: number;
  behind: number;
}

export type FielderClass = 'keeper' | 'bowler' | 'close' | 'ring' | 'deep';

export interface PracticeKit {
  engine: PracticeEngine;
  build: BuildKit;
  input: InputKit;
  createStage: StageFactory;
  ground: GroundGeometry;
  regionEdges: RegionEdges;
  fielderClass(f: Fielder): FielderClass;
  /** Virtual bat travel from swing start to the contact zone (ms), from the physics; used by the test hooks. */
  batTravelMs(kind: 'defend' | 'attack', power: number): number;
}

export const PracticeKitContext = createContext<PracticeKit | null>(null);

export function useKit(): PracticeKit {
  const kit = useContext(PracticeKitContext);
  if (!kit) throw new Error('practice: no PracticeKit provided');
  return kit;
}

/** The controller's state, re-rendering on every change. */
export function useFlowState(flow: PracticeFlow): FlowState {
  return useSyncExternalStore(flow.subscribe, flow.getState, flow.getState);
}
