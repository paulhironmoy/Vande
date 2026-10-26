import { describe, expect, it, vi } from 'vitest';
import type { RenderQuality, RendererOptions } from '@/contracts';
import { SessionBase, type Clock, type DrawInput } from '@/render3d/core/session';
import { fixtureDelivery, fixtureMatchLog, FIXTURE_PLAYERS } from '@/screens/dev/fixtures';

/** A session that records what it would draw. The clock throws: renderAt must never read it. */
class Recorder extends SessionBase {
  readonly kind = '3d' as const;
  frames: DrawInput[] = [];
  protected draw(input: DrawInput) {
    this.frames.push(input);
  }
  protected applyQuality(_q: RenderQuality) {}
  protected drawCalls() {
    return 0;
  }
  async mount(_c: HTMLCanvasElement, o: RendererOptions) {
    this.initSession(o);
  }
}

const throwingClock: Clock = {
  now: () => {
    throw new Error('wall clock read');
  },
  raf: () => {
    throw new Error('raf used');
  },
  caf: () => undefined,
};

describe('deterministic renderAt', () => {
  it('produces the same frame for the same time, in any order, without the wall clock', async () => {
    const r = new Recorder(throwingClock);
    await r.mount({} as HTMLCanvasElement, { quality: 'standard', reducedMotion: false, fps: 60, offline: { width: 1080, height: 1920 } });
    const { durationMs } = await r.loadReplay(fixtureMatchLog(), 'full');
    const times = [0, 12_000, 37_500, 49_000, durationMs - 1, 12_000];
    times.forEach((t) => r.renderAt(t));
    const key = (d: DrawInput) => JSON.stringify([d.script.kind, d.script.duration, d.segment?.eventIndex, Math.round(d.scene * 1000), d.slow]);
    const first = r.frames.slice(1).map(key);
    r.frames = [];
    [...times].reverse().forEach((t) => r.renderAt(t));
    const second = r.frames.map(key).reverse();
    expect(second).toEqual(first);
    expect(first[1]).toBe(first[5]);
  });

  it('emits ball events while seeking and reports the duration', async () => {
    const r = new Recorder(throwingClock);
    await r.mount({} as HTMLCanvasElement, { quality: 'low', reducedMotion: true, fps: 30 });
    const balls: unknown[] = [];
    r.on('ball', (p) => balls.push(p));
    const { durationMs } = await r.loadReplay(fixtureMatchLog(), 'key_moments');
    expect(durationMs).toBeGreaterThan(10_000);
    for (let t = 0; t < durationMs; t += 500) r.seek(t);
    expect(balls.length).toBeGreaterThan(2);
    expect(r.stats().quality).toBe('low');
  });
});

describe('live batting', () => {
  it('resolves released at the scheduled release time and finishes the shot after the seal', async () => {
    let now = 1000;
    const callbacks: Array<(t: number) => void> = [];
    const clock: Clock = { now: () => now, raf: (cb) => (callbacks.push(cb), callbacks.length), caf: () => undefined };
    const r = new Recorder(clock);
    await r.mount({} as HTMLCanvasElement, { quality: 'standard', reducedMotion: false, fps: 60 });
    await r.prepareInnings({ conditions: { pitch: 'hard', weather: 'clear' }, field: 'balanced', batter: FIXTURE_PLAYERS[0], bowler: FIXTURE_PLAYERS[1] });
    const delivery = fixtureDelivery(0, 'good_length');
    const handle = r.bowl(delivery);
    const tick = (ms: number) => {
      now += ms;
      const cb = callbacks.shift();
      cb?.(now);
    };
    let released: number | null = null;
    void handle.released.then((t) => (released = t));
    for (let i = 0; i < 200 && released === null; i++) {
      tick(16);
      await Promise.resolve();
    }
    expect(released).not.toBeNull();
    expect(released! - 1000).toBeGreaterThan(1000);
    const done = handle.showShot({ shot: 'drive', timing: 'perfect', contact: 'middle' });
    let finished = false;
    void done.then(() => (finished = true));
    for (let i = 0; i < 200 && !finished; i++) {
      tick(16);
      await Promise.resolve();
    }
    expect(finished).toBe(true);
    const last = r.frames[r.frames.length - 1];
    expect(last.live).toBe(true);
    expect(last.script.kind).toBe('live');
  });
});

describe('live shots never strand a caller', () => {
  class Live extends Recorder {
    /** What a lost WebGL context does: nothing can be drawn, so a waiting shot settles. */
    loseContext() {
      this.settlePendingShot();
    }
  }
  async function liveBall() {
    let now = 1000;
    const callbacks: Array<(t: number) => void> = [];
    const clock: Clock = { now: () => now, raf: (cb) => (callbacks.push(cb), callbacks.length), caf: () => undefined };
    const r = new Live(clock);
    await r.mount({} as HTMLCanvasElement, { quality: 'standard', reducedMotion: false, fps: 60 });
    await r.prepareInnings({ conditions: { pitch: 'hard', weather: 'clear' }, field: 'balanced', batter: FIXTURE_PLAYERS[0], bowler: FIXTURE_PLAYERS[1] });
    const handle = r.bowl(fixtureDelivery(0, 'good_length'));
    const tick = (ms: number) => {
      now += ms;
      callbacks.shift()?.(now);
    };
    let released = false;
    void handle.released.then(() => (released = true));
    for (let i = 0; i < 300 && !released; i++) {
      tick(16);
      await Promise.resolve();
    }
    expect(released).toBe(true);
    return { r, handle, tick };
  }
  const settled = (p: Promise<void>) => {
    const s = { done: false };
    void p.then(() => (s.done = true));
    return s;
  };

  it('a second showShot (the real contact replacing a prediction) settles the first caller too', async () => {
    const { handle, tick } = await liveBall();
    const first = settled(handle.showShot({ shot: 'drive', timing: 'perfect', contact: 'middle' }));
    const second = settled(handle.showShot({ shot: 'drive', timing: 'early', contact: 'thick_edge' }));
    for (let i = 0; i < 300 && !(first.done && second.done); i++) {
      tick(16);
      await Promise.resolve();
    }
    expect(first.done).toBe(true);
    expect(second.done).toBe(true);
  });

  it('the next ball, a lost context and dispose each settle a pending shot', async () => {
    const a = await liveBall();
    const nextBall = settled(a.handle.showShot({ shot: 'drive', timing: 'perfect', contact: 'middle' }));
    a.r.bowl(fixtureDelivery(1, 'good_length'));
    await Promise.resolve();
    expect(nextBall.done).toBe(true);

    const b = await liveBall();
    const lost = settled(b.handle.showShot({ shot: 'cut_pull', timing: 'good', contact: 'middle' }));
    b.r.loseContext();
    await Promise.resolve();
    expect(lost.done).toBe(true);

    const c = await liveBall();
    const one = settled(c.handle.showShot({ shot: 'drive', timing: 'perfect', contact: 'middle' }));
    const two = settled(c.handle.showShot({ shot: 'drive', timing: 'late', contact: 'miss' }));
    c.r.dispose();
    await Promise.resolve();
    expect(one.done && two.done).toBe(true);
  });

  it('settles on time even when no frame is ever drawn (a background tab)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const clock: Clock = { now: () => 5000, raf: () => 1, caf: () => undefined };
      const r = new Live(clock);
      await r.mount({} as HTMLCanvasElement, { quality: 'standard', reducedMotion: false, fps: 60 });
      await r.prepareInnings({ conditions: { pitch: 'hard', weather: 'clear' }, field: 'balanced', batter: FIXTURE_PLAYERS[0], bowler: FIXTURE_PLAYERS[1] });
      const handle = r.bowl(fixtureDelivery(0, 'good_length'));
      let released = false;
      void handle.released.then(() => (released = true));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(released).toBe(true);
      const shot = settled(handle.showShot({ shot: 'drive', timing: 'perfect', contact: 'middle' }));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(shot.done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
