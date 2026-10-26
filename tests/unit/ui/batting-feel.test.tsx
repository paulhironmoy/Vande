/**
 * Batting feel: the tap is felt and heard before the server answers, the answer upgrades it (the middle of the bat
 * hardest), the feedback says timing, contact and where the shot was aimed with a timing meter (never runs or
 * wickets), and sound and vibration follow their own settings and the page being hidden.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { BattingInput, DeliveryTiming, ShotFeedback } from '@/contracts';
import { engine } from '@/engine';
import { timingMark } from '@/screens/batting/timingMark';
import { loadI18n, renderUi } from './helpers';
import { createFakeRenderer } from './fakeRenderer';
import { FIXTURE_PLAYERS } from '@/screens/dev/fixtures';

const feel = vi.hoisted(() => ({ log: [] as Array<[string, ...unknown[]]> }));
let now = 10_000;
let releaseAt = 0;
const fake = { current: createFakeRenderer(() => releaseAt) };

vi.mock('@/render3d', async () => {
  const actual = await vi.importActual<typeof import('@/render3d')>('@/render3d');
  return { ...actual, createMatchRenderer: async () => fake.current, webglAvailable: () => true };
});
vi.mock('@/audio', async () => {
  const actual = await vi.importActual<typeof import('@/audio')>('@/audio');
  class Silent {
    cue() {}
    crowd() {}
    dispose() {}
  }
  return {
    ...actual,
    MatchAudio: Silent,
    playSealChime: () => undefined,
    playSwingFeel: (...a: unknown[]) => feel.log.push(['swing', ...a]),
    playContactFeel: (...a: unknown[]) => feel.log.push(['contact', ...a]),
  };
});

import { BattingScreen } from '@/screens/batting/BattingScreen';

const T: DeliveryTiming = { releaseToContactMs: 600, perfectMs: 30, goodMs: 70, edgeMs: 140 };

beforeAll(async () => {
  await loadI18n();
});
beforeEach(() => {
  now = 10_000;
  feel.log = [];
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  fake.current = createFakeRenderer(() => releaseAt);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('timing mark', () => {
  it('measures the tap against the ideal moment and keeps it inside the sealed grade', () => {
    expect(timingMark(T, 600, 'perfect')).toEqual({ offsetMs: 0, pos: 0.5 });
    expect(timingMark(T, 612, 'perfect')?.offsetMs).toBe(12);
    // The server said perfect: a client reading of 50 ms late is shown at the edge of perfect, never beyond it.
    expect(timingMark(T, 650, 'perfect')?.offsetMs).toBe(30);
    expect(timingMark(T, 560, 'good')?.offsetMs).toBe(-40);
    // The server said late although the client read early: the mark goes to the late band.
    expect(timingMark(T, 580, 'late')?.offsetMs).toBe(71);
    expect(timingMark(T, 400, 'very_early')?.offsetMs).toBe(-200);
    expect(timingMark(T, 400, 'very_early')!.pos).toBeGreaterThanOrEqual(0.02);
    expect(timingMark(T, 610, 'early')!.pos).toBeLessThan(0.5);
    expect(timingMark(T, null, 'no_shot')).toBeNull();
    expect(timingMark(T, 600, 'interrupted')).toBeNull();
  });
});

describe('batting feel', () => {
  async function playIdealBall(answer: () => Promise<ShotFeedback>) {
    const delivery = engine.revealDelivery(engine.ghostPlan(engine.GHOSTS[0].id, 'test', { pitch: 'hard', weather: 'clear' }), 0, { pitch: 'hard', weather: 'clear' });
    renderUi(<BattingScreen setup={{ conditions: { pitch: 'hard', weather: 'clear' }, field: 'balanced', batter: FIXTURE_PLAYERS[0], bowler: FIXTURE_PLAYERS[1] }} nextBall={vi.fn(async () => ({ delivery, ballsLeft: 5 }))} submitShot={vi.fn(answer)} onComplete={vi.fn()} />);
    await waitFor(() => screen.getByRole('button', { name: 'Play' }));
    releaseAt = now + 2000;
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    const surface = screen.getByRole('button', { name: 'Bat' });
    await waitFor(() => expect(surface.getAttribute('data-live')).toBe('true'));
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 300, height: 160, right: 300, bottom: 160, x: 0, y: 0, toJSON: () => ({}) });
    now = releaseAt + delivery.timing.releaseToContactMs - 180;
    fireEvent.pointerDown(surface, { clientX: 150, clientY: 110, pointerType: 'touch', pointerId: 1 });
    for (let i = 1; i <= 6; i++) {
      now += 30;
      fireEvent.pointerMove(surface, { clientX: 150 + i * 12, clientY: 110 - i * 9, pointerType: 'touch', pointerId: 1 });
    }
    now = releaseAt + delivery.timing.releaseToContactMs;
    await act(async () => {
      fireEvent.pointerUp(surface, { clientX: 225, clientY: 55, pointerType: 'touch', pointerId: 1 });
    });
    return delivery;
  }

  it('feels the tap at once, upgrades on the answer, and explains timing, contact and aim', async () => {
    let answer: (f: ShotFeedback) => void = () => undefined;
    await playIdealBall(() => new Promise<ShotFeedback>((r) => (answer = r)));
    // Before any answer: the tap's own haptic and predicted crack.
    expect(feel.log).toEqual([['swing', 'middle', 'perfect']]);
    expect(screen.getByTestId('batting-screen').getAttribute('data-phase')).toBe('submitting');
    await act(async () => answer({ ball: 0, timing: 'perfect', contact: 'middle' }));
    await waitFor(() => expect(screen.getByTestId('batting-screen').getAttribute('data-phase')).toBe('feedback'));
    expect(feel.log[1]).toEqual(['contact', 'middle', 'perfect', 'middle', 'perfect']);
    expect(screen.getByText('Perfect · Middle of the bat')).toBeTruthy();
    expect(screen.getByTestId('bat-feedback-detail').textContent).toMatch(/^Drive towards (Cover|Mid-off|Point) · Right on time$/);
    const meter = screen.getByTestId('bat-timing-meter');
    expect(meter.getAttribute('aria-hidden')).toBe('true');
    expect(meter.textContent).toBe('EarlyPerfectLate');
    // Still sealed: no runs, no wickets.
    expect(screen.getByTestId('bat-feedback').textContent?.replace('Runs and wickets stay hidden until the reveal.', '')).not.toMatch(/\d+\s*runs?|wicket|out\b|four|six/i);
  });

  it('an edge the tap did not predict is felt and named when the answer lands', async () => {
    await playIdealBall(async () => ({ ball: 0, timing: 'late', contact: 'thick_edge' }));
    await waitFor(() => expect(screen.getByTestId('batting-screen').getAttribute('data-phase')).toBe('feedback'));
    expect(feel.log).toEqual([
      ['swing', 'middle', 'perfect'],
      ['contact', 'thick_edge', 'late', 'middle', 'perfect'],
    ]);
    expect(screen.getByTestId('bat-feedback-detail').textContent).toMatch(/· \d+ ms late$/);
  });
});

describe('the tap and its trace are timed from the events, never from when a handler ran', () => {
  /** A pointer event with its own timestamp, as a browser stamps it (jsdom stamps epoch time, which counts as missing). */
  function stamped(type: string, x: number, y: number, t: number): PointerEvent {
    const e = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: 'touch', pointerId: 1 });
    Object.defineProperty(e, 'timeStamp', { value: t });
    return e;
  }

  /** Bowls one ball and waits until it is live; BAT is 300 × 170 CSS px at (10, 20). */
  async function liveBall() {
    const delivery = engine.revealDelivery(engine.ghostPlan(engine.GHOSTS[0].id, 'test', { pitch: 'hard', weather: 'clear' }), 0, { pitch: 'hard', weather: 'clear' });
    const submitted: BattingInput[] = [];
    const submitShot = vi.fn(async (input: BattingInput): Promise<ShotFeedback> => {
      submitted.push(input);
      return { ball: 0, timing: 'perfect', contact: 'middle' };
    });
    renderUi(<BattingScreen setup={{ conditions: { pitch: 'hard', weather: 'clear' }, field: 'balanced', batter: FIXTURE_PLAYERS[0], bowler: FIXTURE_PLAYERS[1] }} nextBall={vi.fn(async () => ({ delivery, ballsLeft: 5 }))} submitShot={submitShot} onComplete={vi.fn()} />);
    await waitFor(() => screen.getByRole('button', { name: 'Play' }));
    const receivedAt = now;
    releaseAt = now + 2000;
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    const surface = screen.getByRole('button', { name: 'Bat' });
    await waitFor(() => expect(surface.getAttribute('data-live')).toBe('true'));
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 300, height: 170, right: 310, bottom: 190, x: 10, y: 20, toJSON: () => ({}) });
    return { delivery, surface, submitted, submitShot, receivedAt };
  }

  it('tapMs is the up event\'s timestamp minus the rendered release; the trace is [ms since the press (0.1 ms), x, y (4 decimals)]', async () => {
    const { delivery, surface, submitted, receivedAt } = await liveBall();
    const ideal = releaseAt + delivery.timing.releaseToContactMs;
    const t0 = ideal - 150.04;
    // Every handler runs late, each by a different amount (a busy main thread): handler time would skew all of it.
    now = t0 + 40;
    fireEvent(surface, stamped('pointerdown', 160, 130, t0));
    [16.66, 33.33, 50.01, 66.68, 83.34, 100.02].forEach((dt, i) => {
      now = t0 + dt + 3;
      fireEvent(surface, stamped('pointermove', 172 + 12 * i, 121 - 9 * i, t0 + dt));
    });
    const up = ideal + 2.26;
    now = up + 25;
    await act(async () => {
      fireEvent(surface, stamped('pointerup', 235, 75, up));
    });
    await waitFor(() => expect(submitted).toHaveLength(1));
    const input = submitted[0];
    expect(input.tapMs).toBe(Math.round((up - releaseAt) * 10) / 10);
    expect(input.clientElapsedMs).toBe(Math.round(up - receivedAt));
    expect(input.trace).toEqual({
      pointer: 'touch',
      samples: [
        [0, 0.5, 0.6471],
        [16.7, 0.54, 0.5941],
        [33.3, 0.58, 0.5412],
        [50, 0.62, 0.4882],
        [66.7, 0.66, 0.4353],
        [83.3, 0.7, 0.3824],
        [100, 0.74, 0.3294],
        [152.3, 0.75, 0.3235],
      ],
    });
    const check = engine.validateBattingInput(input, delivery);
    expect(check.ok ? 'ok' : check.errors.join(',')).toBe('ok');
  });

  it('a release stamped before the ball left the hand is not a shot, even when its handler runs after', async () => {
    const { surface, submitShot } = await liveBall();
    now = releaseAt + 30;
    fireEvent(surface, stamped('pointerdown', 160, 130, releaseAt - 60));
    await act(async () => {
      fireEvent(surface, stamped('pointerup', 160, 130, releaseAt - 20));
    });
    expect(submitShot).not.toHaveBeenCalled();
    expect(screen.getByTestId('batting-screen').getAttribute('data-phase')).toBe('live');
  });

  it('Space plays the shot at the key event\'s own timestamp, with the fixed keyboard trace', async () => {
    const { delivery, surface, submitted } = await liveBall();
    const pressed = releaseAt + delivery.timing.releaseToContactMs + 7.04;
    // The handler runs late (a busy main thread); the press itself is what counts.
    now = pressed + 35;
    const key = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    Object.defineProperty(key, 'timeStamp', { value: pressed });
    await act(async () => {
      fireEvent(surface, key);
    });
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0].tapMs).toBe(Math.round((pressed - releaseAt) * 10) / 10);
    expect(submitted[0].trace).toEqual({ pointer: 'keyboard', samples: [[0, 0.5, 0.5], [60, 0.5, 0.5]] });
    const check = engine.validateBattingInput(submitted[0], delivery);
    expect(check.ok ? 'ok' : check.errors.join(',')).toBe('ok');
  });

  it('Space without a usable event timestamp (jsdom stamps epoch time) falls back to the handler\'s time', async () => {
    const { delivery, surface, submitted } = await liveBall();
    now = releaseAt + delivery.timing.releaseToContactMs + 7.04;
    await act(async () => {
      fireEvent.keyDown(surface, { key: ' ' });
    });
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0].tapMs).toBe(Math.round((now - releaseAt) * 10) / 10);
    expect(submitted[0].trace).toEqual({ pointer: 'keyboard', samples: [[0, 0.5, 0.5], [60, 0.5, 0.5]] });
    const check = engine.validateBattingInput(submitted[0], delivery);
    expect(check.ok ? 'ok' : check.errors.join(',')).toBe('ok');
  });
});

describe('haptic patterns', () => {
  it('one readable pattern per outcome; nothing for a leave, a miss or the pad', async () => {
    const { feelFor, FEEL_PATTERNS } = await import('@/audio/feel');
    expect(feelFor('thick_edge', 'late')).toBe('tick');
    expect(feelFor('thin_edge', 'early')).toBe('tick');
    expect(feelFor('middle', 'good')).toBe('pulse');
    expect(feelFor('middle', 'perfect')).toBe('double');
    expect(feelFor('none', 'no_shot')).toBeNull();
    expect(feelFor('miss', 'very_late')).toBeNull();
    expect(feelFor('pad', 'late')).toBeNull();
    // An edge is one tick, not a burst; perfect's second beat is at least 60 ms after its first pulse.
    expect(FEEL_PATTERNS.tick.web).toEqual([10]);
    expect(FEEL_PATTERNS.pulse.web).toEqual([24]);
    expect(FEEL_PATTERNS.double.web[1]).toBeGreaterThanOrEqual(60);
  });

  it('the scheduler never starts a pattern within 60 ms of the last one, and the latest outcome wins', async () => {
    const { createFeelScheduler, FEEL_GAP_MS } = await import('@/audio/feel');
    let clock = 0;
    const timers: Array<{ at: number; fn: () => void; id: number }> = [];
    let nextId = 1;
    const emitted: Array<[number, string]> = [];
    const s = createFeelScheduler({
      now: () => clock,
      setTimer: (fn, ms) => {
        const id = nextId++;
        timers.push({ at: clock + ms, fn, id });
        return id;
      },
      clearTimer: (id) => {
        const i = timers.findIndex((x) => x.id === id);
        if (i >= 0) timers.splice(i, 1);
      },
      emit: (p) => emitted.push([clock, p]),
    });
    const advance = (ms: number) => {
      const end = clock + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        clock = next.at;
        next.fn();
      }
      clock = end;
    };
    // The tap's predicted pulse, then the answer 10 ms later says perfect: the double waits until 24 + 60 ms.
    s.play('pulse');
    advance(10);
    s.play('double');
    expect(emitted).toEqual([[0, 'pulse']]);
    advance(200);
    expect(emitted).toEqual([
      [0, 'pulse'],
      [24 + FEEL_GAP_MS, 'double'],
    ]);
    // A waiting pattern is replaced by a newer one: only the newer plays.
    clock = 1000;
    s.play('tick');
    advance(5);
    s.play('pulse');
    advance(5);
    s.play('double');
    advance(300);
    expect(emitted.slice(2)).toEqual([
      [1000, 'tick'],
      [1000 + 10 + FEEL_GAP_MS, 'double'],
    ]);
    // Well apart: at once.
    clock = 5000;
    s.play('tick');
    expect(emitted.at(-1)).toEqual([5000, 'tick']);
  });

  it('an edge on the tap and in the answer is one tick in all (it used to be three buzzes)', async () => {
    vi.useFakeTimers();
    try {
      const audio = await vi.importActual<typeof import('@/audio')>('@/audio');
      const vibrate = vi.fn(() => true);
      Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
      audio.syncAudioSettings({ sound: false, haptics: true });
      now = 500_000_000;
      audio.playSwingFeel('thick_edge', 'late');
      audio.playContactFeel('thick_edge', 'late', 'thick_edge', 'late');
      vi.advanceTimersByTime(500);
      expect(vibrate.mock.calls).toEqual([[[10]]]);
      // Predicted middle, the answer says edge: the pulse, then the tick a clear 60 ms after it.
      vibrate.mockClear();
      now += 1000;
      audio.playSwingFeel('middle', 'good');
      audio.playContactFeel('thick_edge', 'late', 'middle', 'good');
      expect(vibrate.mock.calls).toEqual([[[24]]]);
      vi.advanceTimersByTime(83);
      expect(vibrate.mock.calls).toHaveLength(1);
      vi.advanceTimersByTime(2);
      expect(vibrate.mock.calls).toEqual([[[24]], [[10]]]);
      // A leave: nothing at all.
      vibrate.mockClear();
      now += 1000;
      audio.playSwingFeel('none', 'no_shot');
      audio.playContactFeel('none', 'no_shot', 'none', 'no_shot');
      vi.advanceTimersByTime(500);
      expect(vibrate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('sound and vibration settings', () => {
  it('the batter feel and the scene cues each follow the Vibration setting; live contact is not doubled', async () => {
    const audio = await vi.importActual<typeof import('@/audio')>('@/audio');
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    audio.syncAudioSettings({ sound: false, haptics: true });
    // Far from any pattern an earlier test played (the scheduler keeps a 60 ms gap across calls).
    now = 1_000_000_000;
    audio.playSwingFeel('middle', 'perfect');
    expect(vibrate).toHaveBeenLastCalledWith([32, 70, 14]);
    vibrate.mockClear();
    // Live batting: the scene's own bat cue stays silent (the tap already played it); replays keep it.
    new audio.MatchAudio({ liveContact: true }).cue('bat', 1, 1);
    expect(vibrate).not.toHaveBeenCalled();
    new audio.MatchAudio().cue('bat', 1, 1);
    expect(vibrate).toHaveBeenCalledWith(16);
    vibrate.mockClear();
    audio.syncAudioSettings({ sound: false, haptics: false });
    now += 1000;
    audio.playSwingFeel('middle', 'perfect');
    audio.playContactFeel('middle', 'perfect', 'middle', 'perfect');
    new audio.MatchAudio().cue('stumps', 1, 1);
    expect(vibrate).not.toHaveBeenCalled();
    audio.syncAudioSettings({ sound: true, haptics: true });
  });
});
