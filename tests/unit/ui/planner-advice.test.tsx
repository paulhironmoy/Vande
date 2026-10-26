/**
 * Planner advice (wave F): locked deliveries say how they are earned, the pitch and weather tip sits at the top, and the
 * lock dialog summarises the over with the engine's honest reads. Copy comes from the engine catalogs.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Conditions, DeliveryVariant } from '@/contracts';
import { engine } from '@/engine';
import { overSummary } from '@/engine/advice';
import { rngFromKey } from '@/engine/prng';
import { synthExecutionTrace } from '@/engine/v1/traces';
import { createTranslator } from '@/i18n/translator';
import type { Translator } from '@/i18n';
import { ensureI18n } from '@/i18n/sources';
import { BowlingPlannerScreen } from '@/screens/planner/BowlingPlannerScreen';
import { loadI18n, renderUi } from './helpers';

vi.mock('@/audio', async () => {
  const actual = await vi.importActual<typeof import('@/audio')>('@/audio');
  return { ...actual, playSealChime: () => undefined };
});

let tr: Translator;
beforeAll(async () => {
  await loadI18n('hi', 'hi-Latn');
  const { english } = await ensureI18n('en');
  tr = createTranslator('en', english, english);
});
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const STARTERS = engine.STARTER_VARIANTS;
const ball = (variant: DeliveryVariant, line: 'wide_off' | 'off' | 'middle' | 'leg', length: 'full' | 'good' | 'short', intensity: 1 | 2 | 3, intent: 'attack' | 'contain' | 'setup', k: number) => ({
  variant,
  line,
  length,
  intensity,
  intent,
  gesture: synthExecutionTrace(rngFromKey(`test/planner|${k}`), 780 + k * 9),
  grade: 'good' as const,
});
/** A complete stored draft (every ball has its one release), so the over can be locked straight away. */
function storeDraft(key: string) {
  const draft = {
    field: 'balanced' as const,
    balls: [
      ball('good_length', 'off', 'good', 2, 'contain', 0),
      ball('bouncer', 'middle', 'short', 1, 'setup', 1),
      ball('yorker', 'middle', 'full', 1, 'attack', 2),
      ball('offspin', 'off', 'good', 2, 'contain', 3),
      ball('good_length', 'wide_off', 'good', 1, 'attack', 4),
      ball('offspin', 'middle', 'good', 1, 'contain', 5),
    ],
    superBall: ball('yorker', 'middle', 'full', 1, 'attack', 6),
  };
  localStorage.setItem(`vc:plan:${key}`, JSON.stringify(draft));
  return draft;
}

describe('locked deliveries say how they are earned', () => {
  it('each locked card shows its achievement; starters show their family; the note says unlocks are never bought', () => {
    renderUi(<BowlingPlannerScreen conditions={{ pitch: 'hard', weather: 'clear' }} unlocked={STARTERS} onLock={vi.fn()} />);
    const card = (v: DeliveryVariant) => screen.getByTestId(`plan-variant-${v}`);
    expect(card('legspin').textContent).toContain('Unlock: take a wicket with off-spin');
    expect(card('slower').textContent).toContain('Unlock: keep a batter to 6 runs or fewer in your over');
    expect(card('inswing').textContent).toContain('Unlock: hit the stumps (bowled or LBW)');
    expect(card('outswing').textContent).toContain('Unlock: get a batter caught');
    for (const v of ['legspin', 'slower', 'inswing', 'outswing'] as const) expect(card(v)).toHaveProperty('disabled', true);
    for (const v of STARTERS) {
      expect(card(v).textContent).not.toContain('Unlock');
      expect(card(v)).toHaveProperty('disabled', false);
    }
    expect(screen.getByText('You earn these in Friend Duels and Group Cups. They can never be bought.')).toBeTruthy();
  });

  it('with everything unlocked there are no unlock hints', () => {
    renderUi(<BowlingPlannerScreen conditions={{ pitch: 'hard', weather: 'clear' }} unlocked={['good_length', 'yorker', 'bouncer', 'slower', 'inswing', 'outswing', 'offspin', 'legspin']} onLock={vi.fn()} />);
    expect(screen.queryByText(/^Unlock:/)).toBeNull();
    expect(screen.queryByText(/never be bought/)).toBeNull();
  });
});

describe('the pitch tip', () => {
  it('names what works on this pitch, and the weather when it matters', () => {
    renderUi(<BowlingPlannerScreen conditions={{ pitch: 'green', weather: 'humid' }} unlocked={STARTERS} onLock={vi.fn()} />);
    const tip = screen.getByTestId('plan-pitch-tip');
    expect(tip.textContent).toContain(tr.t('advice.pitch.green'));
    expect(tip.textContent).toContain(tr.t('advice.weather.humid'));
    cleanup();
    renderUi(<BowlingPlannerScreen conditions={{ pitch: 'hard', weather: 'clear' }} unlocked={STARTERS} onLock={vi.fn()} />);
    const hard = screen.getByTestId('plan-pitch-tip');
    expect(hard.textContent).toBe(tr.t('advice.pitch.hard'));
  });

  it('speaks Hindi (आप) and Hinglish (tum)', () => {
    renderUi(<BowlingPlannerScreen conditions={{ pitch: 'slow', weather: 'dew' }} unlocked={STARTERS} onLock={vi.fn()} />, { locale: 'hi' });
    expect(screen.getByTestId('plan-pitch-tip').textContent).toContain('धीमी पिच');
    expect(screen.getByTestId('plan-variant-legspin').textContent).toContain('ऑफ़-स्पिन से विकेट लें');
    cleanup();
    renderUi(<BowlingPlannerScreen conditions={{ pitch: 'slow', weather: 'dew' }} unlocked={STARTERS} onLock={vi.fn()} />, { locale: 'hi-Latn' });
    expect(screen.getByTestId('plan-variant-legspin').textContent).toContain('off-spin se wicket lo');
  });
});

describe('the over summary before locking', () => {
  it('shows the mix, energy, field, lengths, Super Ball and the engine reads, then seals as before', async () => {
    const draft = storeDraft('match-sum');
    const conditions: Conditions = { pitch: 'hard', weather: 'clear' };
    const onLock = vi.fn(async () => ({ commitHash: 'abc123def4567890' }));
    renderUi(<BowlingPlannerScreen conditions={conditions} unlocked={STARTERS} onLock={onLock} draftKey="match-sum" />);
    const lock = screen.getByTestId('plan-lock');
    await waitFor(() => expect(lock).toHaveProperty('disabled', false));
    fireEvent.click(lock);
    const dialog = screen.getByTestId('plan-lock-dialog');
    const summary = within(dialog).getByTestId('plan-summary');
    const expected = overSummary(draft, conditions, { unlocked: STARTERS });
    expect(summary.textContent).toContain(`Your over: ${expected.families.pace} pace · ${expected.families.spin} spin · energy ${expected.energy.used}/15 · balanced field`);
    expect(summary.textContent).toContain(`${expected.lengths.full} full · ${expected.lengths.good} good length · ${expected.lengths.short} short`);
    expect(summary.textContent).toContain('Super Ball: Yorker');
    // The two most important reads (the dialog stays compact).
    for (const r of expected.reads.slice(0, 2)) expect(summary.textContent).toContain(tr.t(r.key as never, r.params));
    expect(summary.getAttribute('tabindex')).toBe('0');
    expect(expected.reads.length).toBeGreaterThan(0);
    expect(summary.textContent).toContain("A guide from the game's model, not a promise.");
    // Sealing is unchanged.
    fireEvent.click(within(dialog).getByTestId('plan-lock-dialog-confirm'));
    await waitFor(() => expect(onLock).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem('vc:plan:match-sum')).toBeNull();
  });

  it('every target is at least the standard tap size (no small buttons)', () => {
    renderUi(<BowlingPlannerScreen conditions={{ pitch: 'hard', weather: 'clear' }} unlocked={STARTERS} onLock={vi.fn()} coach />);
    const ok = screen.getByTestId('plan-coach-ok');
    expect(ok.className).not.toMatch(/(^|[\s_])sm([\s_]|$)/);
    fireEvent.click(screen.getByTestId('plan-ball-1'));
    const copy = screen.getByRole('button', { name: /Copy previous|previous/i });
    expect(copy.className).not.toMatch(/(^|[\s_])sm([\s_]|$)/);
  });
});
