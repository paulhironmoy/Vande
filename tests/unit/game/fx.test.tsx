import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { __resetGameSoundsForTests, playGameSound, unlockGameAudio, type GameSound } from '@/audio/gameSounds';
import { setSoundEnabled } from '@/audio/sounds';
import { Burst, CountUp, FloatingPoints, confettiFromElement, confettiRain, fireConfetti } from '@/components/game/fx';
import { __confettiParticleCount, __resetConfettiForTests } from '@/components/game/fx/confetti';

const ALL_SOUNDS: GameSound[] = ['select', 'correct', 'great', 'wrong', 'coin', 'streak', 'squash', 'scan', 'star', 'mission', 'win', 'lose', 'flip'];

// ---------------------------------------------------------------------------
// Minimal Web Audio stand-in: enough surface for the synth graph, counting what gets scheduled.
// ---------------------------------------------------------------------------
const counts = { contexts: 0, oscillators: 0, sources: 0 };

class FakeParam {
  value = 0;
  setValueAtTime() {
    return this;
  }
  exponentialRampToValueAtTime() {
    return this;
  }
  linearRampToValueAtTime() {
    return this;
  }
}
class FakeNode {
  connect() {
    return this;
  }
  disconnect() {}
}
class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = new FakeNode();
  constructor() {
    counts.contexts++;
  }
  createGain() {
    return Object.assign(new FakeNode(), { gain: new FakeParam() });
  }
  createOscillator() {
    counts.oscillators++;
    return Object.assign(new FakeNode(), { type: 'sine', frequency: new FakeParam(), detune: new FakeParam(), onended: null, start: () => {}, stop: () => {} });
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), { type: 'lowpass', frequency: new FakeParam(), Q: new FakeParam() });
  }
  createDelay() {
    return Object.assign(new FakeNode(), { delayTime: new FakeParam() });
  }
  createDynamicsCompressor() {
    return Object.assign(new FakeNode(), { threshold: new FakeParam(), knee: new FakeParam(), ratio: new FakeParam(), attack: new FakeParam(), release: new FakeParam() });
  }
  createBuffer(_channels: number, length: number, rate: number) {
    const data = new Float32Array(length);
    return { sampleRate: rate, getChannelData: () => data };
  }
  createBufferSource() {
    counts.sources++;
    return Object.assign(new FakeNode(), { buffer: null, onended: null, start: () => {}, stop: () => {} });
  }
  resume() {
    return Promise.resolve();
  }
}

type WinAudio = { AudioContext?: unknown; webkitAudioContext?: unknown };

describe('game sounds', () => {
  beforeEach(() => {
    __resetGameSoundsForTests();
    counts.contexts = 0;
    counts.oscillators = 0;
    counts.sources = 0;
    setSoundEnabled(true);
  });
  afterEach(() => {
    delete (window as unknown as WinAudio).AudioContext;
    setSoundEnabled(true);
  });

  it('never throws when Web Audio is unavailable', () => {
    delete (window as unknown as WinAudio).AudioContext;
    expect(() => {
      unlockGameAudio();
      for (const s of ALL_SOUNDS) playGameSound(s, { step: 3, intensity: 0.5 });
    }).not.toThrow();
  });

  it('stays silent until unlocked and while sound is off', () => {
    (window as unknown as WinAudio).AudioContext = FakeAudioContext;
    playGameSound('correct'); // no gesture yet
    expect(counts.oscillators).toBe(0);
    setSoundEnabled(false);
    unlockGameAudio();
    for (const s of ALL_SOUNDS) playGameSound(s);
    expect(counts.oscillators + counts.sources).toBe(0);
  });

  it('schedules every cue once unlocked, scales by step and rate-limits identical cues', () => {
    (window as unknown as WinAudio).AudioContext = FakeAudioContext;
    unlockGameAudio();
    for (const s of ALL_SOUNDS) {
      const before = counts.oscillators + counts.sources;
      playGameSound(s, { step: 2 });
      expect(counts.oscillators + counts.sources, s).toBeGreaterThan(before);
    }
    expect(counts.contexts).toBe(1);
    const before = counts.oscillators;
    playGameSound('coin');
    playGameSound('coin'); // within 50 ms of the previous 'coin'
    expect(counts.oscillators).toBe(before);
    const silent = counts.oscillators;
    playGameSound('flip', { intensity: 0 });
    expect(counts.oscillators).toBe(silent);
  });
});

// ---------------------------------------------------------------------------
// Confetti
// ---------------------------------------------------------------------------
function fakeContext2d() {
  return {
    globalAlpha: 1,
    fillStyle: '',
    setTransform: () => {},
    clearRect: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    beginPath: () => {},
    arc: () => {},
    rect: () => {},
    roundRect: () => {},
    fill: () => {},
  };
}

describe('confetti', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    document.documentElement.setAttribute('data-motion', 'full');
  });
  afterEach(() => {
    __resetConfettiForTests();
    document.documentElement.removeAttribute('data-motion');
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('is a no-op under reduced motion', () => {
    document.documentElement.setAttribute('data-motion', 'reduced');
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    fireConfetti();
    confettiRain(1000);
    confettiFromElement(document.body);
    expect(document.querySelector('canvas[data-vande-confetti]')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('does nothing (and never throws) without a 2D canvas context', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(() => fireConfetti({ count: 50 })).not.toThrow();
    expect(document.querySelector('canvas[data-vande-confetti]')).toBeNull();
    expect(__confettiParticleCount()).toBe(0);
  });

  it('bursts, caps particles, and removes its canvas when the particles settle', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext2d() as never);
    fireConfetti({ count: 300 });
    fireConfetti({ count: 300, origin: { x: 0.2, y: 0.8 }, spread: 120, power: 1.4 });
    const canvas = document.querySelector('canvas[data-vande-confetti]') as HTMLCanvasElement | null;
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('aria-hidden')).toBe('true');
    expect(canvas?.style.pointerEvents).toBe('none');
    expect(__confettiParticleCount()).toBeLessThanOrEqual(400);
    vi.advanceTimersByTime(500);
    expect(__confettiParticleCount()).toBeGreaterThan(0);
    vi.advanceTimersByTime(6000);
    expect(__confettiParticleCount()).toBe(0);
    expect(document.querySelector('canvas[data-vande-confetti]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------
describe('CountUp, FloatingPoints and Burst', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  });
  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute('data-motion');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('CountUp jumps straight to the value under reduced motion', () => {
    document.documentElement.setAttribute('data-motion', 'reduced');
    const { getByTestId, rerender } = render(<CountUp value={10} data-testid="n" />);
    expect(getByTestId('n').textContent).toBe('10');
    rerender(<CountUp value={2266} data-testid="n" />);
    expect(getByTestId('n').textContent).toBe('2266');
  });

  it('CountUp rolls up with an ease-out and ends exactly on the value', () => {
    document.documentElement.setAttribute('data-motion', 'full');
    const { getByTestId, rerender } = render(<CountUp value={0} durationMs={400} data-testid="n" />);
    rerender(<CountUp value={1000} durationMs={400} data-testid="n" />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    const mid = Number(getByTestId('n').textContent);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1000);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(getByTestId('n').textContent).toBe('1000');
  });

  it('CountUp can count a fresh value up from zero on mount, with a custom format', () => {
    document.documentElement.setAttribute('data-motion', 'full');
    const { getByTestId } = render(<CountUp value={500} from={0} durationMs={300} format={(n) => `${n} pts`} data-testid="n" />);
    expect(getByTestId('n').textContent).toBe('0 pts');
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(getByTestId('n').textContent).toBe('500 pts');
  });

  it('FloatingPoints shows "+658", is hidden from assistive tech and calls onDone', () => {
    document.documentElement.setAttribute('data-motion', 'full');
    const onDone = vi.fn();
    const { container, queryByText } = render(<FloatingPoints amount={658} tone="great" onDone={onDone} />);
    const el = queryByText('+658');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('aria-hidden')).toBe('true');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe('');
  });

  it('Burst renders a ring and ten rays only when triggered and motion is allowed', () => {
    document.documentElement.setAttribute('data-motion', 'full');
    const { container, rerender } = render(<Burst trigger={0} />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    rerender(<Burst trigger={1} tone="great" />);
    const root = container.querySelector('[aria-hidden="true"]');
    expect(root).not.toBeNull();
    expect(root?.children.length).toBe(12); // glow + ring + 10 rays
    expect(root?.getAttribute('data-tone')).toBe('great');
    document.documentElement.setAttribute('data-motion', 'reduced');
    rerender(<Burst trigger={2} />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });
});
