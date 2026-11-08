import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindPracticeLifecycle } from '@/practice/ui/lifecycle';
import { loadInnings } from '@/practice/store';
import { quickPlay, setup, until, useFakeTimers } from './flowSetup';

const cleanups: Array<() => void> = [];
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
function native() {
  const callbacks = new Map<string, () => void>();
  const removals = new Map<string, ReturnType<typeof vi.fn>>();
  const app = {
    addListener: vi.fn(async (event: 'pause' | 'resume', callback: () => void) => {
      callbacks.set(event, callback);
      const remove = vi.fn(async () => {
        callbacks.delete(event);
      });
      removals.set(event, remove);
      return { remove };
    }),
  };
  return { app, callbacks, removals, emit: (event: 'pause' | 'resume') => callbacks.get(event)?.() };
}
function visibility(value: DocumentVisibilityState) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(value);
  document.dispatchEvent(new Event('visibilitychange'));
}
beforeEach(() => {
  useFakeTimers();
  visibility('visible');
});
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose());
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('Practice lifecycle bridge', () => {
  it('native foreground without a DOM event allows the next real flow delivery, preserving the leave and innings', async () => {
    const { flow, store, createStage } = setup();
    const plugin = native();
    cleanups.push(() => flow.dispose());
    cleanups.push(
      bindPracticeLifecycle(
        (hidden) => flow.setHidden(hidden),
        async () => ({ App: plugin.app }),
      ),
    );
    await flush();
    flow.init();
    await quickPlay(flow);
    await until(() => flow.getState().phase === 'live');
    const id = loadInnings(store)!.id;
    plugin.emit('pause');
    await until(() => flow.getState().phase === 'paused');
    const interrupted = loadInnings(store)!;
    expect(interrupted).toMatchObject({ id, balls: 1, inFlight: null });
    expect(interrupted.current!.deliveries[0].swing).toBeNull();
    const first = structuredClone(interrupted.current!.deliveries[0]);
    // Returning to Android foreground does not itself start another ball or dismiss the pause panel.
    plugin.emit('resume');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(flow.getState().phase).toBe('paused');
    expect(createStage.stages[0].calls().filter((call) => call === 'bowl')).toHaveLength(1);
    flow.resume();
    expect(flow.getState().phase).toBe('dead');
    flow.nextBall();
    await until(() => flow.getState().phase === 'live');
    expect(loadInnings(store)).toMatchObject({ id, balls: 1, inFlight: { overIndex: 0, ballIndex: 1 } });
    expect(loadInnings(store)!.current!.deliveries).toEqual([first]);
    await until(() => flow.getState().phase === 'dead');
    expect(loadInnings(store)).toMatchObject({ id, balls: 2, inFlight: null });
    expect(loadInnings(store)!.current!.deliveries[0]).toEqual(first);
  });

  it('Resume and Next ball cannot bowl while Android is still paused, even if the document says visible', async () => {
    const { flow, createStage } = setup();
    const plugin = native();
    cleanups.push(() => flow.dispose());
    cleanups.push(
      bindPracticeLifecycle(
        (hidden) => flow.setHidden(hidden),
        async () => ({ App: plugin.app }),
      ),
    );
    await flush();
    flow.init();
    await quickPlay(flow);
    await until(() => flow.getState().phase === 'live');
    plugin.emit('pause');
    await until(() => flow.getState().phase === 'paused');
    visibility('visible');
    flow.resume();
    flow.nextBall();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(flow.getState().phase).toBe('paused');
    expect(createStage.stages[0].calls().filter((call) => call === 'bowl')).toHaveLength(1);
    plugin.emit('resume');
    flow.resume();
    await until(() => flow.getState().phase === 'live');
    expect(createStage.stages[0].calls().filter((call) => call === 'bowl')).toHaveLength(2);
  });

  it('combines native and document visibility without duplicate hidden notifications', async () => {
    const plugin = native();
    const hidden = vi.fn();
    cleanups.push(bindPracticeLifecycle(hidden, async () => ({ App: plugin.app })));
    await flush();
    visibility('hidden');
    plugin.emit('pause');
    visibility('visible');
    expect(hidden.mock.calls).toEqual([[false], [true]]);
    plugin.emit('resume');
    expect(hidden.mock.calls).toEqual([[false], [true], [false]]);
    plugin.emit('pause');
    visibility('hidden');
    plugin.emit('resume');
    expect(hidden).toHaveBeenLastCalledWith(true);
    visibility('visible');
    expect(hidden).toHaveBeenLastCalledWith(false);
  });

  it('keeps browser-only background and foreground handling', () => {
    const hidden = vi.fn();
    cleanups.push(bindPracticeLifecycle(hidden));
    visibility('hidden');
    visibility('visible');
    expect(hidden.mock.calls).toEqual([[false], [true], [false]]);
  });

  it('removes both native listeners and document listener exactly once', async () => {
    const plugin = native();
    const hidden = vi.fn();
    const dispose = bindPracticeLifecycle(hidden, async () => ({ App: plugin.app }));
    await flush();
    const lateCallback = plugin.callbacks.get('pause')!;
    dispose();
    dispose();
    lateCallback();
    visibility('hidden');
    expect(hidden.mock.calls).toEqual([[false]]);
    for (const remove of plugin.removals.values()) expect(remove).toHaveBeenCalledTimes(1);
  });

  it('does not register after an import resolves following disposal', async () => {
    const plugin = native();
    let resolve!: (module: { App: typeof plugin.app }) => void;
    const dispose = bindPracticeLifecycle(
      vi.fn(),
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    dispose();
    resolve({ App: plugin.app });
    await flush();
    expect(plugin.app.addListener).not.toHaveBeenCalled();
  });

  it('removes handles whose asynchronous registrations complete after disposal', async () => {
    const pending: Array<(handle: { remove(): Promise<void> }) => void> = [];
    const hidden = vi.fn();
    const callbacks: Array<() => void> = [];
    const dispose = bindPracticeLifecycle(hidden, async () => ({
      App: {
        addListener: (_event, callback) => {
          callbacks.push(callback);
          return new Promise((resolve) => pending.push(resolve));
        },
      },
    }));
    await flush();
    dispose();
    const removals = pending.map((resolve) => {
      const remove = vi.fn(async () => {});
      resolve({ remove });
      return remove;
    });
    await flush();
    callbacks.forEach((callback) => callback());
    expect(removals).toHaveLength(2);
    removals.forEach((remove) => expect(remove).toHaveBeenCalledTimes(1));
    expect(hidden.mock.calls).toEqual([[false]]);
  });

  it('never assimilates the native plugin proxy as a Promise thenable', async () => {
    const plugin = native();
    const then = vi.fn(() => {
      throw new Error('App.then() is not implemented on android');
    });
    const proxy = new Proxy(plugin.app, {
      get(target, key, receiver) {
        return key === 'then' ? then : Reflect.get(target, key, receiver);
      },
    });
    const hidden = vi.fn();
    cleanups.push(bindPracticeLifecycle(hidden, async () => ({ App: proxy })));
    await flush();
    expect(then).not.toHaveBeenCalled();
    expect(plugin.app.addListener.mock.calls.map(([event]) => event)).toEqual(['pause', 'resume']);
    plugin.emit('pause');
    plugin.emit('resume');
    expect(hidden.mock.calls).toEqual([[false], [true], [false]]);
  });
});
