import { afterEach, describe, expect, it, vi } from 'vitest';

/** A fake AudioContext that counts constructions and resumes. */
function fakeAudio() {
  const made: string[] = [];
  const node = () => ({ connect: (n: unknown) => n, gain: { value: 1, setTargetAtTime: () => undefined }, threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 1 }, attack: { value: 0 }, release: { value: 0 } });
  class Ctx {
    state = 'suspended';
    sampleRate = 48000;
    currentTime = 0;
    destination = {};
    constructor() {
      made.push('ctx');
    }
    createGain = node;
    createDynamicsCompressor = node;
    createBuffer(_c: number, len: number) {
      const data = new Float32Array(len);
      return { getChannelData: () => data };
    }
    resume() {
      made.push('resume');
      this.state = 'running';
      return Promise.resolve();
    }
    suspend() {
      return Promise.resolve();
    }
  }
  return { Ctx, made };
}

describe('match audio preparation', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it('builds the audio graph in idle time, so the first gesture only resumes it', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { Ctx, made } = fakeAudio();
    (window as unknown as { AudioContext: unknown }).AudioContext = Ctx;
    const audio = await import('@/audio/match');
    audio.installMatchAudioUnlock();
    expect(made).toEqual([]);
    vi.advanceTimersByTime(1600);
    expect(made).toEqual(['ctx']);
    window.dispatchEvent(new Event('pointerdown'));
    expect(made).toEqual(['ctx', 'resume']);
  });
});
