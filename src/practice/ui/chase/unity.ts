/**
 * The chase as the Unity bridge carries it (contract v7, src/contracts/unityPractice.ts): six figures and one closed
 * code, text-free, read from the same chase state as the web HUD so both show one chase. Unity composes its own
 * localized "Need X off Y" from them. It is the situation at the moment it is sent (a scene: now; a resolution: after
 * that ball), it is outside the replay digest, and it is never sent for a Coach demonstration or an abandoned chase.
 */
import { makeUnityPracticeChase, type UnityPracticeChase } from '@/contracts';
import type { ChaseState } from '@/practice/chase/types';

/** The bridge block for a chase state, or undefined (the key is then omitted) when there is none to carry. */
export function unityChaseOf(state: ChaseState | null | undefined): UnityPracticeChase | undefined {
  if (!state || state.result === 'abandoned') return undefined;
  return makeUnityPracticeChase({
    target: state.definition.target,
    maxBalls: state.definition.balls,
    runsNeeded: state.runsNeeded,
    ballsLeft: state.ballsLeft,
    outcome: state.result,
  });
}

/** `{ chase }` for a stage scene while a chase is on, else nothing (so ordinary Practice never carries the key). */
export function chaseScene(state: ChaseState | null | undefined): { chase?: UnityPracticeChase } {
  const chase = unityChaseOf(state);
  return chase ? { chase } : {};
}
