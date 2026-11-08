/**
 * The Target Chase on the Practice flow: the real chase module (src/practice/chase) on the fake ball physics. What the
 * flow adds around the rules is checked here: the setup, the shown chase (never ahead of the board), the second over
 * with no summary between, the end, "Try this chase again", the refusals that keep a score safe, leaving and coming
 * back, and that the same seed and the same swings always give the same chase.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRACTICE_SIM_VERSION, type DeliveryRecord } from '@/contracts';
import { inningsReducer, nextDelivery } from '@/practice/game';
import { chaseOver, chaseSummary, makeChase, startChaseInnings, type ChaseDefinition } from '@/practice/chase';
import { PRACTICE_KEYS, memoryStore, updatePracticeSettings } from '@/practice/store';
import { loadChaseHistory, loadSavedChase, saveChase } from '@/practice/ui/chase/store';
import type { StageScene } from '@/practice/ui/flow/types';
import { FakeStage } from '../fakes';
import { attack, caught, defend, setup, until, useFakeTimers } from '../flowSetup';
import { POOL_SEED, chaseRig, openChase, playOut, untilDead } from './harness';

/** A stage that keeps the scenes it was given (the flow sets one for each over, and for a native stage for each ball). */
class SceneStage extends FakeStage {
  readonly scenes: StageScene[] = [];
  setScene(scene?: StageScene): void {
    if (scene) this.scenes.push(scene);
    super.setScene();
  }
}

beforeEach(() => useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const six = () => attack(0.9);
const sixes = (target: number) => Array.from({ length: Math.ceil(target / 6) }, () => six());

describe('opening a chase', () => {
  it('opens the setup of a pool seed at Standard difficulty, with nothing committed yet', () => {
    const { flow, store, target } = chaseRig();
    flow.init();
    flow.chase.start();
    const st = flow.getState();
    expect(st.screen).toBe('setup');
    expect(st.chase?.state.definition).toMatchObject({
      seed: POOL_SEED,
      difficulty: 'standard',
      balls: 12,
      wickets: 1,
    });
    expect(st.chase?.state.definition.target).toBe(target);
    expect(st.chase?.state.runsNeeded).toBe(target);
    expect(st.chase?.state.ballsLeft).toBe(12);
    expect(st.innings).toBeNull();
    expect(store.getItem(PRACTICE_KEYS.innings)).toBeNull();
    expect(store.getItem(PRACTICE_KEYS.chase)).toBeNull();
    expect(st.pending?.plan).toEqual(chaseOver(st.chase!.state.definition, 0, 'right').plan);
  });

  it('draws a new seed each time from the flow seed source, and never the one just played', () => {
    const { flow } = setup({ deps: { hooks: { takeSwing: () => null } } });
    flow.init();
    const seeds = new Set<string>();
    for (let i = 0; i < 6; i++) {
      flow.chase.start();
      seeds.add(flow.getState().chase!.state.definition.seed);
    }
    expect(seeds.size).toBeGreaterThan(1);
    let last = flow.getState().chase!.state.definition.seed;
    for (let i = 0; i < 20; i++) {
      flow.chase.start();
      const now = flow.getState().chase!.state.definition.seed;
      expect(now).not.toBe(last);
      last = now;
    }
  });

  it('Back from the setup leaves no chase behind', () => {
    const { flow, store } = chaseRig();
    flow.init();
    flow.chase.start();
    flow.leave();
    expect(flow.getState().chase).toBeNull();
    expect(flow.getState().screen).toBe('idle');
    expect(store.getItem(PRACTICE_KEYS.chase)).toBeNull();
  });

  it('Play commits the chase innings under the chase key, never as a Practice innings', async () => {
    const { flow, store, swings } = chaseRig();
    swings.push(defend());
    await openChase(flow);
    expect(store.getItem(PRACTICE_KEYS.chase)).not.toBeNull();
    expect(store.getItem(PRACTICE_KEYS.innings)).toBeNull();
    const saved = loadSavedChase(store);
    expect(saved?.saved.definition.seed).toBe(POOL_SEED);
    expect(flow.getState().overKind).toBe('random');
    expect(flow.getState().overDifficulty).toBe('club');
  });

  it('a left-hander has the chase mirrored: his innings, his field and his stage; the rail reads the same', async () => {
    const store = memoryStore();
    updatePracticeSettings({ teach: false, demoSeen: true, handedness: 'left' }, store);
    const { flow, swings } = chaseRig({ store });
    swings.push(defend());
    await openChase(flow);
    const st = flow.getState();
    const def = st.chase!.state.definition;
    expect(st.innings?.handedness).toBe('left');
    expect(st.handedness).toBe('left');
    expect(st.innings?.current?.field).toEqual(chaseOver(def, 0, 'left').field);
    // His bowler is the mirror image of the right-hander's (the other arm), as the physics' frame expects.
    expect(chaseOver(def, 0, 'left').plan.bowler.arm).not.toBe(chaseOver(def, 0, 'right').plan.bowler.arm);
    // Only the batter's side changes (CHASE-CORE mirrors the bowler's arm for him): the six balls, the target and the
    // numbers the HUD shows are the right-hander's.
    expect(st.innings?.current?.plan).toEqual(chaseOver(def, 0, 'left').plan);
    expect(st.innings?.current?.plan.balls).toEqual(chaseOver(def, 0, 'right').plan.balls);
    expect(st.chase?.state.runsNeeded).toBe(def.target);
  });

  it('starting a Random Over afterwards is an ordinary over again', () => {
    const { flow } = chaseRig();
    flow.init();
    flow.chase.start();
    flow.prepareOver({ kind: 'random' });
    expect(flow.getState().chase).toBeNull();
  });
});

describe('the shown chase', () => {
  it('changes when the stage has shown the ball, never before', async () => {
    const { flow, swings, target } = chaseRig();
    swings.push(six());
    await openChase(flow);
    await until(() => flow.getState().phase === 'playing');
    // The ball is committed (saved), but the board and the chase still show what was before it.
    expect(flow.getState().innings?.balls).toBe(1);
    expect(flow.getState().board.balls).toBe(0);
    expect(flow.getState().chase?.state.ballsFaced).toBe(0);
    expect(flow.getState().chase?.state.runsNeeded).toBe(target);
    await untilDead(flow, 1);
    const c = flow.getState().chase!.state;
    expect(c.ballsFaced).toBe(1);
    expect(c.runs).toBe(6);
    expect(c.runsNeeded).toBe(Math.max(0, target - 6));
    expect(c.ballsLeft).toBe(11);
  });

  it('gives the crowd the chase to feel (the runs to win), and the first ball announces the target', async () => {
    const context = vi.fn(() => ({ y: 0, width: 1, height: 1 }));
    const words = {
      runup: vi.fn((n: number, c?: { runsNeeded: number } | null) => `ball ${n}${c ? ` target ${c.runsNeeded}` : ''}`),
      outcome: vi.fn(() => 'outcome'),
      chase: vi.fn((c: { runsNeeded: number }) => `need ${c.runsNeeded}`),
    };
    const { flow, swings, target } = chaseRig({ deps: { deliveryContext: context as never, words } });
    swings.push(attack(0.6), attack(0.6));
    await openChase(flow);
    expect(context).toHaveBeenCalledWith(expect.objectContaining({ target, runs: 0, ballsLeft: 12, wicketsInHand: 1 }));
    expect(words.runup).toHaveBeenCalledWith(1, expect.objectContaining({ runsNeeded: target, ballsFaced: 0 }));
    await untilDead(flow, 1);
    expect(flow.getState().announce?.text).toBe(`outcome need ${target - 4}`);
  });
});

describe('the end of a chase', () => {
  it('a win: the target reached ends it at once, is recorded, and the deciding ball is replayed', async () => {
    const moments = vi.fn();
    const { flow, swings, store, target, createStage } = chaseRig();
    swings.push(...sixes(target));
    await openChase(flow);
    // The stage's result clips are handed the moment once, when the deciding ball is dead (a real stage has the method).
    Object.assign(createStage.stages[0], { presentChaseMoment: moments });
    const replay = vi.spyOn(createStage.stages[0], 'replay');
    const balls = await playOut(flow);
    expect(balls).toBe(Math.ceil(target / 6));
    const st = flow.getState();
    expect(st.chase?.state.result).toBe('won');
    expect(st.chase?.summary).toMatchObject({ result: 'won', target, ballsFaced: balls });
    // Decided at the dead ball: kept in the local history, and the result moment handed on once.
    expect(loadChaseHistory(store).entries[0]).toMatchObject({ seed: POOL_SEED, result: 'won' });
    expect(moments).toHaveBeenCalledTimes(1);
    expect(moments).toHaveBeenCalledWith('won');
    // "See result": the screen of the result, the innings closed, the deciding ball watched.
    const live = flow.getState().last!.result;
    flow.nextBall();
    await until(() => flow.getState().screen === 'chase_result' || flow.getState().phase === 'replay');
    expect(flow.getState().innings?.status).toBe('complete');
    await until(() => createStage.stages[0].calls().includes('replay'));
    // The replay is of the very result the live ball had (not a second simulation), carries the moment, and ends by
    // itself and comes back to the result.
    expect(replay).toHaveBeenCalledTimes(1);
    const [replayed, options] = replay.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(replayed).toBe(live);
    expect(options).toMatchObject({ chaseMoment: 'won', diagnostics: false });
    expect(flow.getState().replay).not.toBeNull();
    await until(() => flow.getState().screen === 'chase_result' && flow.getState().replay === null);
    expect(flow.getState().chase?.state.result).toBe('won');
  });

  it('a wicket ends it as lost_wicket on that ball', async () => {
    const { flow, swings, target } = chaseRig();
    swings.push(defend(), caught());
    await openChase(flow);
    expect(await playOut(flow)).toBe(2);
    const st = flow.getState();
    expect(st.chase?.state.result).toBe('lost_wicket');
    expect(st.chase?.summary).toMatchObject({
      result: 'lost_wicket',
      runsShort: target,
      decidingBall: { ballNumber: 2 },
    });
    expect(st.innings?.status).toBe('out');
    flow.nextBall();
    expect(flow.getState().screen).toBe('chase_result');
  });

  it('twelve balls without the target lose it, and the second over follows the first with no summary between', async () => {
    const { flow, swings, target } = chaseRig();
    const def = makeChase(POOL_SEED) as ChaseDefinition;
    swings.push(...Array.from({ length: 12 }, () => defend()));
    await openChase(flow);
    const screens = new Set<string>();
    flow.subscribe(() => screens.add(flow.getState().screen));
    expect(await playOut(flow)).toBe(12);
    expect(screens.has('over_summary')).toBe(false);
    const st = flow.getState();
    expect(st.innings?.overs).toHaveLength(2);
    expect(st.innings?.overs[0].plan).toEqual(chaseOver(def, 0, 'right').plan);
    expect(st.innings?.overs[1].plan).toEqual(chaseOver(def, 1, 'right').plan);
    expect(st.chase?.state).toMatchObject({ result: 'lost_balls', runs: 0, runsNeeded: target, ballsLeft: 0 });
    expect(st.chase?.summary).toMatchObject({ result: 'lost_balls', runsShort: target });
  });

  it('the dead ball after ball 6 goes on into the second over', async () => {
    const { flow, swings } = chaseRig();
    swings.push(...Array.from({ length: 7 }, () => defend()));
    await openChase(flow);
    await playOut(flow, 6);
    expect(flow.getState().innings?.status).toBe('over_complete');
    flow.nextBall();
    await until(() => flow.getState().innings?.status === 'batting' && flow.getState().innings?.overs.length === 1);
    expect(flow.getState().screen).toBe('live');
    expect(flow.getState().board.over).toHaveLength(0);
    await untilDead(flow, 7);
    expect(flow.getState().innings?.current?.deliveries).toHaveLength(1);
  });

  it('the second over is set on the stage before its first ball: its bowler, its field and the chase as it then stands', async () => {
    const store = memoryStore();
    updatePracticeSettings({ teach: false, demoSeen: true }, store);
    const stage = new SceneStage('3d', store);
    const { flow, swings } = chaseRig({ store, deps: { createStage: async () => stage } });
    swings.push(...Array.from({ length: 7 }, () => defend()));
    await openChase(flow);
    await playOut(flow, 6);
    const def = flow.getState().chase!.state.definition;
    const first = stage.scenes.at(-1)!;
    expect(first.field).toEqual(chaseOver(def, 0, 'right').field);
    expect(first.bowler).toEqual(chaseOver(def, 0, 'right').plan.bowler);
    expect(first.chase).toMatchObject({ ballsLeft: 12, outcome: 'in_progress' });
    const before = stage.scenes.length;
    flow.nextBall();
    await untilDead(flow, 7);
    expect(stage.scenes.length).toBeGreaterThan(before);
    const second = stage.scenes.at(-1)!;
    expect(second.field).toEqual(chaseOver(def, 1, 'right').field);
    expect(second.bowler).toEqual(chaseOver(def, 1, 'right').plan.bowler);
    expect(second.chase).toMatchObject({ ballsLeft: 6, runsNeeded: def.target, outcome: 'in_progress' });
  });
});

describe('what a chase refuses', () => {
  it('"Practice this ball" does nothing while the chase is on, and an over is never restarted', async () => {
    const { flow, swings } = chaseRig();
    swings.push(defend(), defend());
    await openChase(flow);
    await untilDead(flow, 1);
    flow.acceptDeadBallAction('practice_ball');
    await vi.advanceTimersByTimeAsync(200);
    expect(flow.getState().screen).toBe('live');
    expect(flow.getState().coach).toBeNull();
    expect(flow.restartOver()).toBe(false);
    expect(flow.getState().innings?.balls).toBe(1);
    expect(flow.chase.allowed()).toMatchObject({ practiceThisBall: false, restartOver: false, bowl: true });
  });

  it('after the result the deciding ball can be practised, and that changes nothing in the chase', async () => {
    const { flow, swings, createStage } = chaseRig();
    swings.push(caught());
    await openChase(flow);
    await playOut(flow);
    flow.nextBall();
    // The deciding ball is replayed first, and comes back to the result by itself.
    await until(() => createStage.stages[0].calls().includes('replay'));
    await until(() => flow.getState().screen === 'chase_result' && flow.getState().replay === null);
    const before = JSON.stringify(flow.getState().chase);
    expect(flow.chase.allowed()?.practiceThisBall).toBe(true);
    flow.chase.practiseDecidingBall();
    await until(() => flow.getState().screen === 'coach');
    flow.coachLoop.leaveCoach();
    expect(flow.getState().screen).toBe('chase_result');
    expect(JSON.stringify(flow.getState().chase)).toBe(before);
    expect(flow.getState().innings?.status).toBe('out');
  });
});

describe('Try this chase again', () => {
  it('is the same seed, the same target and the same balls, a fresh attempt straight to ball 1', async () => {
    const { flow, swings, store, target } = chaseRig();
    swings.push(caught());
    await openChase(flow);
    await playOut(flow);
    const first = flow.getState();
    const firstOver = first.innings!.overs[0]?.plan ?? first.innings!.current?.plan;
    expect(first.chase?.state.result).toBe('lost_wicket');
    flow.nextBall();
    await until(() => flow.getState().screen === 'chase_result');
    swings.push(defend());
    flow.chase.retry();
    await until(() => ['runup', 'live', 'playing', 'dead'].includes(flow.getState().phase));
    const again = flow.getState();
    expect(again.chase?.state.definition).toMatchObject({ seed: POOL_SEED, target });
    expect(again.chase?.state.ballsFaced).toBe(0);
    expect(again.innings?.id).not.toBe(first.innings?.id);
    expect(again.innings?.current?.plan).toEqual(firstOver);
    expect(again.chase?.previous).toMatchObject({ seed: POOL_SEED, result: 'lost_wicket' });
    expect(loadChaseHistory(store).entries).toHaveLength(1);
  });

  it('gives the same chase for the same swings, byte for byte, and a different one for another seed', async () => {
    const play = async (seed: string) => {
      const { flow, swings, target } = chaseRig({ seed });
      swings.push(attack(0.6), defend(), attack(0.9), defend(), attack(0.6), caught());
      await openChase(flow);
      await playOut(flow);
      return { state: JSON.stringify(flow.getState().chase?.state), target };
    };
    const a = await play('c011');
    const b = await play('c011');
    expect(b.state).toBe(a.state);
    const c = await play('c012');
    expect(c.state).not.toBe(a.state);
  });
});

describe('leaving and coming back', () => {
  it('Leave mid-chase keeps it saved to continue; the home offers it', async () => {
    const { flow, swings, store, target } = chaseRig();
    swings.push(defend(), defend());
    await openChase(flow);
    await untilDead(flow, 1);
    flow.leave();
    expect(flow.getState().screen).toBe('idle');
    expect(flow.getState().chase).not.toBeNull();
    expect(store.getItem(PRACTICE_KEYS.chase)).not.toBeNull();
    expect(flow.resumable()).not.toBeNull();
    expect(flow.chase.resumeInfo()).toEqual({ runsNeeded: target, ballsLeft: 11 });
  });

  it('starting something else from the home drops it: no result, nothing saved', async () => {
    const { flow, swings, store } = chaseRig();
    swings.push(defend(), defend());
    await openChase(flow);
    await untilDead(flow, 1);
    flow.leave();
    flow.discardInnings();
    expect(flow.getState().chase).toBeNull();
    expect(flow.getState().innings).toBeNull();
    expect(flow.getState().screen).toBe('idle');
    expect(store.getItem(PRACTICE_KEYS.chase)).toBeNull();
    expect(loadChaseHistory(store).entries).toHaveLength(0);
  });

  /** A chase on disk, as the real rules would have saved it: records that the chase's innings accepts. */
  function savedChase(def: ChaseDefinition, runs: number[], extra?: { inFlight?: boolean }) {
    let innings = startChaseInnings(def, { id: 'saved-1', assist: 'learn', handedness: 'right' });
    for (const r of runs) {
      innings = inningsReducer(innings, { type: 'deliveryStarted' });
      const next = nextDelivery(innings)!;
      const record: DeliveryRecord = {
        version: PRACTICE_SIM_VERSION,
        ...next,
        tierToleranceMs: 0,
        swing: null,
        runs: r as DeliveryRecord['runs'],
        dismissal: null,
      };
      innings = inningsReducer(innings, { type: 'deliveryResolved', record });
      if (innings.status === 'over_complete') {
        innings = inningsReducer(innings, { type: 'nextOver' });
        const setup2 = chaseOver(def, innings.overs.length, 'right');
        innings = inningsReducer(innings, { type: 'chooseOver', plan: setup2.plan, field: setup2.field });
      }
    }
    if (extra?.inFlight) innings = inningsReducer(innings, { type: 'deliveryStarted' });
    return innings;
  }

  it('a kill mid-chase comes back as the same chase, with the home offering to continue', () => {
    const store = memoryStore();
    const def = makeChase('c003') as ChaseDefinition;
    saveChase(def, savedChase(def, [1, 0, 2]), store);
    const { flow } = setup({ store });
    expect(flow.init()).toBe('menu');
    const st = flow.getState();
    expect(st.chase?.state).toMatchObject({ result: 'in_progress', runs: 3, ballsFaced: 3, ballsLeft: 9 });
    expect(flow.chase.resumeInfo()).toEqual({ runsNeeded: def.target - 3, ballsLeft: 9 });
    flow.continueInnings();
    expect(flow.getState().screen).toBe('setup');
    expect(flow.getState().pending).toMatchObject({ continuing: true, bowled: 3 });
  });

  it('a ball in flight when the app went away is a leave on resume, as in Practice', () => {
    const store = memoryStore();
    const def = makeChase('c004') as ChaseDefinition;
    saveChase(def, savedChase(def, [1], { inFlight: true }), store);
    const { flow } = setup({ store });
    flow.init();
    const st = flow.getState();
    expect(st.chase?.state.ballsFaced).toBe(2);
    expect(st.innings?.inFlight).toBeNull();
    expect(st.notice).toBe('resumed_leave');
  });

  it('a chase decided as the app closed comes back as its result', () => {
    const store = memoryStore();
    const def = makeChase('c005') as ChaseDefinition;
    saveChase(
      def,
      savedChase(
        def,
        Array.from({ length: Math.ceil(def.target / 6) }, () => 6),
      ),
      store,
    );
    const { flow } = setup({ store });
    expect(flow.init()).toBe('summary');
    const st = flow.getState();
    expect(st.screen).toBe('chase_result');
    expect(st.chase?.summary).toMatchObject({ result: 'won', seed: 'c005' });
    expect(chaseSummary(st.chase!.state, 'learn')?.result).toBe('won');
  });

  it('a save from another version or a damaged one is forgotten, calmly', () => {
    const damaged = memoryStore();
    damaged.setItem(PRACTICE_KEYS.chase, '{"v":1,"saved":{"nonsense":true}}');
    const a = setup({ store: damaged });
    expect(a.flow.init()).toBe('menu');
    expect(a.flow.getState().notice).toBe('unreadable');
    expect(damaged.getItem(PRACTICE_KEYS.chase)).toBeNull();

    const store = memoryStore();
    const def = makeChase('c006') as ChaseDefinition;
    const innings = savedChase(def, [1]);
    saveChase(def, { ...innings, version: 99 as never }, store);
    const b = setup({ store });
    expect(b.flow.init()).toBe('menu');
    expect(b.flow.getState().notice).toBe('updated');
    expect(b.flow.getState().chase).toBeNull();
    expect(store.getItem(PRACTICE_KEYS.chase)).toBeNull();
  });
});
