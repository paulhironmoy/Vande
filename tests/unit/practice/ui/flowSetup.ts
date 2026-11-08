/** Shared set-up for the flow controller tests: a flow on fakes, fake timers, and a few driving helpers. */
import { vi } from 'vitest';
import type { AnalyticsEventName, AnalyticsProps, NormalizedSwing } from '@/contracts';
import { memoryStore, updatePracticeSettings, type KeyStore } from '@/practice/store';
import { PracticeFlow, type FlowDeps } from '@/practice/ui/flow/controller';
import { assessment, fakeCoach, fakeEngine, stageFactory } from './fakes';

export const attack = (power = 0.6, directionDeg = 30): NormalizedSwing => ({
  kind: 'attack',
  startT: 0.38,
  directionDeg,
  power,
  elevation: 0,
  footwork: 'auto',
});
export const defend = (): NormalizedSwing => ({
  kind: 'defend',
  startT: 0.38,
  directionDeg: 0,
  power: 0.2,
  elevation: 0,
  footwork: 'auto',
});
/** The fake physics' convention: an attack at 180° is caught. */
export const caught = () => attack(0.6, 180);

export interface SetupOptions {
  store?: KeyStore;
  tier?: 'full' | 'assisted' | 'below';
  fail3d?: boolean;
  lateReleaseMs?: number;
  /** Keep the first-run teaching (the demonstration and the hint); off by default so most tests bowl at once. */
  teach?: boolean;
  coach?: boolean;
  autoNext?: boolean;
  deps?: Partial<FlowDeps>;
}

export function setup(o: SetupOptions = {}) {
  const store = o.store ?? memoryStore();
  if (!o.teach && !o.store) updatePracticeSettings({ teach: false, demoSeen: true }, store);
  const engine = fakeEngine();
  const coach = o.coach === false ? null : fakeCoach();
  const createStage = stageFactory(store, { fail3d: o.fail3d, lateReleaseMs: o.lateReleaseMs });
  const events: Array<[AnalyticsEventName, AnalyticsProps | undefined]> = [];
  const swings: Array<NormalizedSwing | 'leave'> = [];
  const feels: string[] = [];
  const benchmark = vi.fn(async () => assessment(o.tier ?? 'full'));
  let n = 0;
  const flow = new PracticeFlow({
    engine,
    coach,
    createStage,
    appVersion: '1.0.0',
    store,
    benchmark,
    analytics: (e, p) => events.push([e, p]),
    hooks: { takeSwing: () => swings.shift() ?? null, autoNext: o.autoNext },
    newSeed: () => `seed${n++}`,
    newId: () => `inn${n++}`,
    isLandscape: () => true,
    frameSampler: () => ({ start() {}, stop() {}, running: false }),
    masteryFeel: (e) => feels.push(e),
    ...o.deps,
  });
  let canvasKey = -1;
  let coachCanvasKey = -1;
  const attach = () => {
    const state = flow.getState();
    if (state.canvasKey !== canvasKey) {
      canvasKey = state.canvasKey;
      flow.attachCanvas(document.createElement('canvas'));
    }
    if (state.coachCanvasKey !== coachCanvasKey) {
      coachCanvasKey = state.coachCanvasKey;
      flow.attachCoachCanvas(document.createElement('canvas'));
    }
  };
  flow.subscribe(attach);
  attach();
  return { flow, store, engine, coach, createStage, events, swings, benchmark, feels };
}

export async function until(pred: () => boolean, maxMs = 200_000): Promise<void> {
  for (let t = 0; t < maxMs; t += 50) {
    if (pred()) return;
    await vi.advanceTimersByTimeAsync(50);
  }
  throw new Error('condition not reached');
}

/** A Random Over from the home (balanced defaults): the setup screen, then Play; resolves when the first ball is under way. */
export async function quickPlay(flow: PracticeFlow): Promise<void> {
  flow.prepareOver({ kind: 'random' });
  await until(() => flow.getState().stageReady);
  void flow.play();
  await until(
    () => flow.getState().phase === 'runup' || flow.getState().phase === 'live' || flow.getState().phase === 'dead',
  );
}

export function useFakeTimers() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
}
