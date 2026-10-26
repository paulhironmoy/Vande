import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { BattingInput, OverPlan, SealedSixEngineApi, ShotFeedback } from '@/contracts';
import { engine } from '@/engine';
import { renderUi } from './helpers';
import { createFakeRenderer } from './fakeRenderer';
import { fixtureDelivery, fixtureMatchLog, FIXTURE_PLAYERS } from '@/screens/dev/fixtures';

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
  return { ...actual, MatchAudio: Silent, playSealChime: () => undefined };
});

import { OnboardingScreen, validateAlias } from '@/screens/onboarding/OnboardingScreen';
import { BowlingPlannerScreen } from '@/screens/planner/BowlingPlannerScreen';
import { BattingScreen } from '@/screens/batting/BattingScreen';
import { RevealScreen } from '@/screens/reveal/RevealScreen';
import { buildInput } from '@/screens/batting/input';

beforeEach(() => {
  now = 10_000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  fake.current = createFakeRenderer(() => releaseAt);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Onboarding', () => {
  it('validates the alias and completes with a generated avatar, kit and locale', () => {
    expect(validateAlias('ab')).toBe('short');
    expect(validateAlias('a'.repeat(17))).toBe('long');
    expect(validateAlias('bad<name>')).toBe('chars');
    expect(validateAlias('स्विंग किंग')).toBeNull();
    const onComplete = vi.fn();
    renderUi(<OnboardingScreen onComplete={onComplete} initialSeed="seed-1" />);
    fireEvent.click(screen.getByRole('button', { name: /Start training/ }));
    expect(screen.getByRole('alert').textContent).toMatch(/At least 3/);
    fireEvent.change(screen.getByRole('textbox', { name: 'Alias' }), { target: { value: 'Swing King' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kit 3' }));
    fireEvent.click(screen.getByRole('button', { name: /Start training/ }));
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ alias: 'Swing King', avatar: { seed: 'seed-1' }, locale: 'en' }));
    // The third starter kit (server palette: id "starter", two palette colours and a pattern).
    expect(onComplete.mock.calls[0][0].kit).toEqual({ id: 'starter', primary: '#0E7C86', secondary: '#C9A227', pattern: 'hoops' });
  });
});

describe('Bowling planner', () => {
  const fakeEngine = {
    ...engine,
    OVER_ENERGY_BUDGET: 15,
    energyCost: (d) => ({ yorker: 3, good_length: 1, bouncer: 2, slower: 2, inswing: 2, outswing: 2, offspin: 1, legspin: 1 })[d.variant] + d.intensity - 1,
    validatePlan: (plan: OverPlan) => ({ ok: true as const, plan }),
  } as SealedSixEngineApi;

  it('needs a release for all seven balls, then seals the over after confirmation', async () => {
    const onLock = vi.fn(async (_plan: OverPlan) => ({ commitHash: 'abcdef0123456789abcdef' }));
    renderUi(<BowlingPlannerScreen conditions={{ pitch: 'green', weather: 'humid' }} unlocked={['good_length', 'yorker', 'bouncer', 'offspin']} onLock={onLock} engine={fakeEngine} />);
    expect(screen.getByText('2 of 15 left')).toBeTruthy();
    const lock = screen.getByRole('button', { name: /Lock over/ });
    expect(lock).toHaveProperty('disabled', true);
    expect(screen.getByText(/7 balls need a gesture/)).toBeTruthy();
    const tabs = screen.getAllByRole('button').filter((b) => b.className.includes('tab'));
    for (let i = 0; i < 7; i++) {
      fireEvent.click(tabs[i]);
      const meter = screen.getByRole('button', { name: /Release gesture|release|%/i });
      fireEvent.keyDown(meter, { key: ' ' });
      now += 760 + i * 9;
      fireEvent.keyUp(meter, { key: ' ' });
    }
    await waitFor(() => expect(screen.getByRole('button', { name: /Lock over/ })).toHaveProperty('disabled', false));
    fireEvent.click(screen.getByRole('button', { name: /Lock over/ }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Lock over' }));
    await waitFor(() => expect(onLock).toHaveBeenCalledTimes(1));
    const plan = onLock.mock.calls[0][0] as OverPlan;
    expect(plan.balls).toHaveLength(6);
    expect(plan.superBall.gesture.samples.length).toBeGreaterThanOrEqual(2);
    expect(plan.field).toBe('balanced');
    await waitFor(() => expect(screen.getByText('Over locked')).toBeTruthy());
  });

  it('locks variants that are not unlocked', () => {
    renderUi(<BowlingPlannerScreen conditions={{ pitch: 'hard', weather: 'clear' }} unlocked={['good_length']} onLock={vi.fn()} engine={fakeEngine} />);
    expect(screen.getByRole('button', { name: /Leg-spin/ })).toHaveProperty('disabled', true);
  });
});


describe('Batting', () => {
  it('turns one swipe into a valid engine input and shows sealed feedback only', async () => {
    const delivery = engine.revealDelivery(engine.ghostPlan(engine.GHOSTS[0].id, 'test', { pitch: 'hard', weather: 'clear' }), 0, { pitch: 'hard', weather: 'clear' });
    const nextBall = vi.fn(async () => ({ delivery, ballsLeft: 5 }));
    const submitted: BattingInput[] = [];
    const submitShot = vi.fn(async (input: BattingInput): Promise<ShotFeedback> => {
      submitted.push(input);
      return { ball: 0, timing: 'perfect', contact: 'middle' };
    });
    renderUi(<BattingScreen setup={{ conditions: { pitch: 'hard', weather: 'clear' }, field: 'balanced', batter: FIXTURE_PLAYERS[0], bowler: FIXTURE_PLAYERS[1] }} nextBall={nextBall} submitShot={submitShot} onComplete={vi.fn()} />);
    await waitFor(() => screen.getByRole('button', { name: 'Play' }));
    releaseAt = now + 2000;
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    const surface = screen.getByRole('button', { name: 'Bat' });
    await waitFor(() => expect(surface.getAttribute('data-live')).toBe('true'));
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 300, height: 160, right: 300, bottom: 160, x: 0, y: 0, toJSON: () => ({}) });
    // Swipe up-right (towards cover / mid-off) and let go at the ideal contact moment.
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
    await waitFor(() => expect(submitShot).toHaveBeenCalledTimes(1));
    const input = submitted[0];
    expect(input.tapMs).toBeCloseTo(delivery.timing.releaseToContactMs, 0);
    expect(input.shot).toBe('drive');
    const check = engine.validateBattingInput(input, delivery);
    expect(check.ok ? 'ok' : check.errors.join(',')).toBe('ok');
    await waitFor(() => expect(screen.getByText(/Perfect · Middle of the bat/)).toBeTruthy());
    expect(screen.getByText(/Runs and wickets stay hidden/)).toBeTruthy();
    expect(screen.queryByText(/runs?\b.*\d/i)).toBeNull();
  });

  /** Plays one ball with an ideal swipe; the renderer's shot promises and the server answer are up to the test. */
  async function playOneBall(o: { showShot: () => Promise<void>; answer: () => Promise<ShotFeedback> }) {
    const delivery = engine.revealDelivery(engine.ghostPlan(engine.GHOSTS[0].id, 'test', { pitch: 'hard', weather: 'clear' }), 0, { pitch: 'hard', weather: 'clear' });
    const bowl = fake.current.bowl;
    fake.current.bowl = (d) => ({ ...bowl(d), showShot: o.showShot });
    renderUi(<BattingScreen setup={{ conditions: { pitch: 'hard', weather: 'clear' }, field: 'balanced', batter: FIXTURE_PLAYERS[0], bowler: FIXTURE_PLAYERS[1] }} nextBall={vi.fn(async () => ({ delivery, ballsLeft: 5 }))} submitShot={vi.fn(o.answer)} onComplete={vi.fn()} />);
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
  }
  const slowAnswer = (fb: ShotFeedback, ms = 160) => () => new Promise<ShotFeedback>((resolve) => setTimeout(() => resolve(fb), ms));

  it('a slow answer whose contact differs from the prediction still reaches the feedback (no freeze on "Saving")', async () => {
    // Like the old renderer: a second showShot replaced the first one's resolver, so the first promise never settled.
    let latest: (() => void) | null = null;
    const showShot = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          latest = resolve;
          // The animation outlasts the slow answer, so the first one is still running when the second call comes.
          setTimeout(() => latest === resolve && resolve(), 400);
        }),
    );
    await playOneBall({ showShot, answer: slowAnswer({ ball: 0, timing: 'early', contact: 'thick_edge' }) });
    await waitFor(() => expect(screen.getByTestId('batting-screen').getAttribute('data-phase')).toBe('feedback'), { timeout: 2000 });
    expect(showShot).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Early · Thick edge/)).toBeTruthy();
  });

  it('once the server has answered, the feedback shows even if the animation never settles', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await playOneBall({ showShot: () => new Promise<void>(() => undefined), answer: slowAnswer({ ball: 0, timing: 'perfect', contact: 'middle' }) });
    expect(screen.getByTestId('batting-screen').getAttribute('data-phase')).toBe('submitting');
    await waitFor(() => expect(screen.getByTestId('batting-screen').getAttribute('data-phase')).toBe('feedback'), { timeout: 4000 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('did not settle'));
  });

  it('builds tap-only inputs for defend and a no-shot input when there is no gesture', () => {
    const d = fixtureDelivery(0);
    const tap = buildInput({ delivery: d, shot: 'defend', zone: 'cover', gesture: { pointer: 'touch', t0: 0, samples: [[0, 0.5, 0.5], [70, 0.5, 0.51]] }, tapMs: d.timing.releaseToContactMs, receivedAt: 0, now: 3000 });
    expect(tap.zone).toBeNull();
    const none = buildInput({ delivery: d, shot: 'drive', zone: 'cover', gesture: null, tapMs: null, receivedAt: 0, now: 3000 });
    expect(none.tapMs).toBeNull();
    expect(none.trace.samples).toEqual([]);
  });
});

describe('Reveal', () => {
  it('shows both innings, explains a ball, and drives the replay controls', async () => {
    const onRematch = vi.fn();
    const onShare = vi.fn();
    renderUi(<RevealScreen log={fixtureMatchLog()} verified onRematch={onRematch} onShare={onShare} autoplay={false} />);
    await waitFor(() => expect(fake.current.calls.some(([c]) => c === 'loadReplay')).toBe(true));
    expect(screen.getAllByText('Swing King').length).toBeGreaterThan(0);
    // Nothing is given away before playback: a duel opens in Key moments and the totals stay hidden.
    expect(screen.getByRole('radio', { name: 'Key moments' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText('11/1')).toBeNull();
    expect(screen.getByText(/matched their sealed commits/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Skip to result/ }));
    expect(fake.current.calls.some(([c]) => c === 'seek')).toBe(true);
    expect(screen.getByText('11/1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(fake.current.calls.some(([c, a]) => c === 'play' && a[0] === 1)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Slow motion/ }));
    fireEvent.click(screen.getAllByRole('button', { name: /Yorker/ })[0]);
    expect(screen.getByRole('tab', { name: 'Why it happened', selected: true })).toBeTruthy();
    expect(screen.getAllByText(/Helped the batter|Helped the bowler/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('radio', { name: 'Full replay' }));
    await waitFor(() => expect(fake.current.calls.filter(([c]) => c === 'loadReplay').length).toBeGreaterThan(1));
    // Switching modes restarts playback but keeps everything already seen.
    expect(screen.getByTestId('reveal-summary').textContent).toMatch(/won by/);
    fireEvent.click(screen.getByRole('tab', { name: 'Scorecard' }));
    expect(screen.getByText('11/1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Rematch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(onRematch).toHaveBeenCalled();
    expect(onShare).toHaveBeenCalled();
  });
});
