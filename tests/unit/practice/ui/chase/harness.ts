/** A chase driven through the real flow on the fake physics: the chase module is real, only the ball physics is fake. */
import { vi } from 'vitest';
import type { NormalizedSwing } from '@/contracts';
import { makeChase } from '@/practice/chase';
import type { PracticeFlow } from '@/practice/ui/flow/controller';
import { setup, until, type SetupOptions } from '../flowSetup';

export const POOL_SEED = 'c007';

export interface ChaseRig extends ReturnType<typeof setup> {
  swings: Array<NormalizedSwing | 'leave'>;
  /** The target of this rig's chase (read from the chase module, never pinned). */
  target: number;
}

/** A flow whose next Chase is the given pool seed and whose swings are the ones queued in `swings`. */
export function chaseRig(o: SetupOptions & { seed?: string } = {}): ChaseRig {
  const seed = o.seed ?? POOL_SEED;
  const swings: Array<NormalizedSwing | 'leave'> = [];
  const rig = setup({
    ...o,
    deps: {
      ...o.deps,
      hooks: { takeSwing: () => swings.shift() ?? null, chaseSeed: () => seed, autoNext: o.autoNext },
    },
  });
  return { ...rig, swings, target: makeChase(seed)!.target };
}

/** Opens the chase's setup and presses Play: resolves when the first ball is under way. */
export async function openChase(flow: PracticeFlow, opts: { direct?: boolean } = {}): Promise<void> {
  flow.init();
  flow.chase.start(opts.direct ? { direct: true } : {});
  await until(() => flow.getState().stageReady);
  if (!opts.direct) void flow.play();
  await until(() => ['runup', 'live', 'playing', 'dead'].includes(flow.getState().phase));
}

/** Waits for the dead ball of the n-th ball of the chase (1-based). */
export async function untilDead(flow: PracticeFlow, n: number): Promise<void> {
  await until(() => flow.getState().phase === 'dead' && flow.getState().board.balls === n);
}

/** Plays the chase ball by ball (each queued swing is one ball) until it is decided; returns the balls bowled. */
export async function playOut(flow: PracticeFlow, limit = 12): Promise<number> {
  for (let n = 1; n <= limit; n++) {
    await untilDead(flow, n);
    if (flow.getState().chase?.state.result !== 'in_progress' || n === limit) return n;
    flow.nextBall();
  }
  return limit;
}

export const flush = async (ms = 50) => {
  await vi.advanceTimersByTimeAsync(ms);
};
