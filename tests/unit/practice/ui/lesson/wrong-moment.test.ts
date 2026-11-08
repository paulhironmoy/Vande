/**
 * Acting at the wrong moment (LES-05): the rule, written down and checked in 30 trials per moment.
 *
 *   A press or a key before the bowler lets go, on the card, during the run-up, or once the ball has passed is not a shot.
 *   The flow ignores it: the ball is bowled and scored exactly as it would be with no input at all (a leave), the innings
 *   ledger shows that one delivery and nothing else, and nothing is re-bowled or counted twice. The dead ball says what
 *   happened in plain words (the lesson's too-soon note), and "Practice this ball" retries the identical ball without
 *   touching the score (that is Coach Mode's rule, tested with it).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GestureInput } from '@/contracts';
import { traceGesture } from '@/input';
import { memoryStore, updatePracticeSettings } from '@/practice/store';
import { teachingSamples } from '@/practice/ui/lesson/ghostMove';
import { setup, until, useFakeTimers } from '../flowSetup';

beforeEach(useFakeTimers);
afterEach(() => vi.useRealTimers());

const SURFACE = { width: 915, height: 190 };
const press = (): GestureInput =>
  traceGesture({ surface: SURFACE, samples: teachingSamples({ surface: SURFACE }) }).gesture!;

type Moment = 'card' | 'ready' | 'runup' | 'passed' | 'dead';
const TRIALS = 30;

/** One ball of a Random Over with the lesson UI present; `act` is what the player does at `moment`, if anything. */
async function oneBall(trial: number, moment: Moment, act: boolean) {
  const store = memoryStore();
  // Teaching on and the demonstration seen: the card (first run) or the ready hint (returning, hint not yet shown out).
  updatePracticeSettings({ teach: true, demoSeen: true, lessonSeen: moment !== 'card', hintsShown: 0 }, store);
  const { flow } = setup({
    store,
    teach: true,
    deps: { lesson: { input: () => 'mouse' as const }, newSeed: () => `wrong-${trial}`, newId: () => `inn-${trial}` },
  });
  flow.init();
  flow.prepareOver({ kind: 'random' });
  await until(() => flow.getState().stageReady);
  void flow.play();
  const phaseOf = { card: 'lesson', ready: 'ready', runup: 'runup', passed: 'playing', dead: 'dead' } as const;
  const doIt = () => {
    flow.onSwingStart(performance.now(), 'touch');
    flow.onSwingIntent({ atPerfMs: performance.now(), pointer: 'touch' });
    flow.onGesture(press());
  };
  if (moment === 'card') {
    await until(() => flow.getState().phase === 'lesson');
    if (act) doIt();
    // The card is still open and nothing was bowled by it.
    expect(flow.getState().phase).toBe('lesson');
    expect(flow.getState().innings?.balls).toBe(0);
    flow.lessonEvent({ type: 'bowl' });
  } else if (moment !== 'dead') {
    await until(() => flow.getState().phase === phaseOf[moment]);
    if (act) doIt();
  }
  await until(() => flow.getState().phase === 'dead');
  if (moment === 'dead' && act) doIt();
  await vi.advanceTimersByTimeAsync(300);
  const st = flow.getState();
  const out = {
    last: JSON.stringify({ record: st.last?.record, result: st.last?.result }),
    runs: st.innings?.runs,
    balls: st.innings?.balls,
    ledger: st.innings?.current?.deliveries.length ?? st.innings?.overs.at(-1)?.deliveries.length,
    phase: st.phase,
  };
  flow.dispose();
  return out;
}

describe(`a press at the wrong moment changes nothing (${TRIALS} trials per moment)`, () => {
  for (const moment of ['card', 'ready', 'runup', 'passed', 'dead'] as Moment[])
    it(`${moment}: the ball, its result, the score and the ledger are exactly those of no input`, async () => {
      for (let trial = 0; trial < TRIALS; trial++) {
        const quiet = await oneBall(trial, moment, false);
        const pressed = await oneBall(trial, moment, true);
        expect(pressed.last, `trial ${trial}`).toBe(quiet.last);
        expect(pressed).toMatchObject({ runs: quiet.runs, balls: quiet.balls, ledger: 1, phase: 'dead' });
        expect(quiet.ledger).toBe(1);
        // No input at all is a leave: the swing record is empty, so nothing was played.
        expect(JSON.parse(pressed.last).record.swing).toBeNull();
      }
    }, 120_000);
});
