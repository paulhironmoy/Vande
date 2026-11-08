/**
 * The chase as the Unity bridge carries it: the same figures as the web HUD, in a scene (the situation now) and in a
 * resolution (the situation after that ball); never in ordinary Practice and never for a Coach attempt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chaseReducer, makeChase, startChase, type ChaseDefinition } from '@/practice/chase';
import { chaseScene, unityChaseOf } from '@/practice/ui/chase/unity';
import { attack, defend, quickPlay, setup, until, useFakeTimers } from '../flowSetup';
import { chaseRig, untilDead } from './harness';

beforeEach(() => useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const def = makeChase('c040') as ChaseDefinition;

describe('the bridge block of a chase', () => {
  it('carries the target, the length, what is needed and the code, from the chase state', () => {
    const start = unityChaseOf(startChase(def))!;
    expect(start).toMatchObject({
      target: def.target,
      maxBalls: 12,
      runsNeeded: def.target,
      ballsLeft: 12,
      outcome: 'in_progress',
    });
    expect(start.requiredRateX100).toBe(Math.floor((def.target * 1200 + 12) / 24));
    const after = chaseReducer(startChase(def), { type: 'ball', overIndex: 0, ballIndex: 0, runs: 4, dismissal: null });
    expect(unityChaseOf(after)).toMatchObject({ runsNeeded: def.target - 4, ballsLeft: 11, outcome: 'in_progress' });
  });

  it('is decided with no rate, and nothing at all for an abandoned chase or outside a chase', () => {
    const out = chaseReducer(startChase(def), {
      type: 'ball',
      overIndex: 0,
      ballIndex: 0,
      runs: 0,
      dismissal: 'bowled',
    });
    expect(unityChaseOf(out)).toMatchObject({ outcome: 'lost_wicket', requiredRateX100: null, ballsLeft: 11 });
    expect(unityChaseOf(chaseReducer(startChase(def), { type: 'abandon' }))).toBeUndefined();
    expect(unityChaseOf(null)).toBeUndefined();
    expect(chaseScene(null)).toEqual({});
    expect('chase' in chaseScene(undefined)).toBe(false);
    expect(chaseScene(startChase(def)).chase?.outcome).toBe('in_progress');
  });
});

describe('what the stage is given', () => {
  it('every scene of a chase carries the situation now; a Practice scene never has the key', async () => {
    const rig = chaseRig({ seed: 'c040' });
    rig.flow.init();
    rig.flow.chase.start();
    await until(() => rig.flow.getState().stageReady);
    const stage = rig.createStage.stages[0];
    const scenes = vi.spyOn(stage, 'setScene');
    rig.swings.push(defend(), defend());
    void rig.flow.play();
    await untilDead(rig.flow, 1);
    expect(scenes).toHaveBeenCalled();
    const sent = scenes.mock.calls.map((c) => (c as unknown as [Record<string, unknown>])[0]);
    for (const scene of sent)
      expect(scene.chase).toMatchObject({ target: rig.target, maxBalls: 12, outcome: 'in_progress' });
    expect(sent[sent.length - 1].chase).toMatchObject({ runsNeeded: rig.target, ballsLeft: 12 });

    const practice = setup();
    practice.flow.init();
    practice.swings.push(attack());
    await quickPlay(practice.flow);
    const ordinary = vi.spyOn(practice.createStage.stages[0], 'setScene');
    await until(() => practice.flow.getState().phase === 'dead');
    practice.flow.nextBall();
    await until(() => ordinary.mock.calls.length > 0 || practice.flow.getState().phase === 'runup');
    for (const call of ordinary.mock.calls) expect('chase' in (call as unknown as [object])[0]).toBe(false);
  });
});
