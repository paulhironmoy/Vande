/** Small pure helpers both Practice stages share (no rendering code: the 2D stage must not pull in three.js). */
import type { Conditions } from '@/contracts';
import type { Fielder, FieldLayout, PitchCondition } from '@/contracts/practice';
import { PITCH_HALF, fieldSpots, keeperPos } from '../core/ground';
import type { PracticeSceneSetup } from './types';

/** The stadium's pitch look for a Practice condition. */
export function conditionsFor(p: PitchCondition): Conditions {
  return { pitch: p === 'green' ? 'green' : p === 'turning' ? 'slow' : 'hard', weather: 'clear' };
}

/** A field for the benchmark scene when no over has been set yet (the match's balanced spots; rendering cost only). */
export function benchmarkSetup(): PracticeSceneSetup {
  const kp = keeperPos('pace');
  const fielders: Fielder[] = [
    { id: 'keeper', role: 'keeper', x: kp.x, z: kp.z },
    { id: 'bowler', role: 'bowler', x: 0.6, z: -PITCH_HALF + 1 },
    ...fieldSpots('balanced').map((s, i): Fielder => ({ id: `f${i}`, role: 'cover', x: s.pos.x, z: s.pos.z })),
  ];
  const field: FieldLayout = { id: 'benchmark', fielders };
  return { field, bowler: { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'benchmark' }, conditions: 'balanced', handedness: 'right' };
}
