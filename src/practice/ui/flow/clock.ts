/**
 * The flow's own waits (the field radar, the coaching card before the next ball) on a clock that the test hooks
 * can speed up together with the stage, so an e2e run plays ten overs in seconds. Production always runs at 1.
 */
export interface FlowClock {
  now(): number;
  /** Waits `ms` of scaled time; cancel() resolves nothing. */
  after(ms: number, cb: () => void): () => void;
  scale: number;
}

export function createClock(scale = 1): FlowClock {
  const clock: FlowClock = {
    scale,
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    after(ms, cb) {
      const id = setTimeout(cb, Math.max(0, ms / Math.max(1, clock.scale)));
      return () => clearTimeout(id);
    },
  };
  return clock;
}
