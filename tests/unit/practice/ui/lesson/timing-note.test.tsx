/**
 * The dead ball's timing note and the "too soon" note: plain words in proportion to the error, the number the coach
 * uses, the physics' bands drawn as a scale, advice on the right side, nothing for a leave or an on-time swing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import type { AssistLevel, SwingTiming } from '@/contracts';
import { createPracticeT } from '@/i18n/practice';
import { activeBands } from '@/physics';
import { IntroPanel } from '@/practice/ui/components/Panels';
import { TooSoonNote, WatchNote, useEarlyPress } from '@/practice/ui/lesson/EarlyPress';
import { LessonTimingNote } from '@/practice/ui/lesson/TimingNote';
import type { LivePhase } from '@/practice/ui/flow/state';

const en = createPracticeT('en', null);
afterEach(cleanup);

const show = (timing: SwingTiming, timingErrorMs: number | null, assist: AssistLevel | null = 'learn') =>
  render(<LessonTimingNote contact={{ timing, timingErrorMs }} bands={assist ? activeBands(assist, 0) : null} />);

describe('the timing note', () => {
  it('says early or late and how much, in the words the copy sheet gives, with the coach’s own number', () => {
    const cases: Array<[SwingTiming, number, string]> = [
      ['solid', -40, 'early.small'],
      ['solid', 40, 'late.small'],
      ['mistimed', -80, 'early.medium'],
      ['mistimed', 80, 'late.medium'],
      ['missed', -200, 'early.large'],
      ['missed', 200, 'late.large'],
    ];
    for (const [timing, err, key] of cases) {
      cleanup();
      show(timing, err);
      expect(screen.getByTestId('lesson-timing-line').textContent).toBe(en.tk(`practice.lesson.timing.${key}`));
      expect(screen.getByTestId('lesson-timing-number').textContent).toBe(
        en.t(err < 0 ? 'practice.timing.ms_early' : 'practice.timing.ms_late', { ms: Math.abs(err) }),
      );
      expect(screen.getByTestId('lesson-timing').dataset.side).toBe(err < 0 ? 'early' : 'late');
    }
  });

  it('early advises starting later, late advises starting sooner; on time advises nothing', () => {
    show('mistimed', -70);
    expect(screen.getByTestId('lesson-timing-advice').textContent).toBe(en.tk('practice.lesson.timing.try_later'));
    cleanup();
    show('mistimed', 70);
    expect(screen.getByTestId('lesson-timing-advice').textContent).toBe(en.tk('practice.lesson.timing.try_sooner'));
    cleanup();
    show('perfect', 3);
    expect(screen.queryByTestId('lesson-timing-advice')).toBeNull();
    expect(screen.getByTestId('lesson-timing-line').textContent).toBe(en.tk('practice.lesson.timing.on_time'));
    expect(screen.getByTestId('lesson-timing-number').textContent).toBe(en.t('practice.timing.on_time'));
  });

  it('draws the delivery’s three bands only when the physics’ bands are known; the scale is not read out', () => {
    show('solid', -30);
    const scale = screen.getByTestId('lesson-timing-scale');
    expect(scale.getAttribute('aria-hidden')).toBe('true');
    expect(scale.querySelectorAll('rect')).toHaveLength(3);
    cleanup();
    show('solid', -30, null);
    expect(screen.queryByTestId('lesson-timing-scale')).toBeNull();
    expect(screen.getByTestId('lesson-timing-line')).toBeTruthy();
  });

  it('says nothing for a leave', () => {
    const { container } = show('none', null);
    expect(container.textContent).toBe('');
  });
});

describe('a press before the release', () => {
  const press = (target: Element) => {
    const e = new Event('pointerdown', { bubbles: true });
    act(() => void target.dispatchEvent(e));
  };

  it('counts a press on the batting area during the run-up, and is forgotten when the next ball starts', () => {
    const surface = document.createElement('div');
    surface.setAttribute('role', 'application');
    const button = document.createElement('button');
    document.body.append(surface, button);
    const { result, rerender } = renderHook(({ phase }: { phase: LivePhase }) => useEarlyPress(phase, true), {
      initialProps: { phase: 'idle' as LivePhase },
    });
    expect(result.current).toBe(false);
    rerender({ phase: 'runup' });
    press(button);
    expect(result.current).toBe(false);
    press(surface);
    expect(result.current).toBe(true);
    rerender({ phase: 'live' });
    press(surface);
    expect(result.current).toBe(true);
    rerender({ phase: 'dead' });
    expect(result.current).toBe(true);
    rerender({ phase: 'ready' });
    expect(result.current).toBe(false);
    surface.remove();
    button.remove();
  });

  it('counts a batting key, not a Tab, and watches nothing once teaching is off', () => {
    const { result, rerender } = renderHook(({ on }: { on: boolean }) => useEarlyPress('runup', on), {
      initialProps: { on: true },
    });
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab' })));
    expect(result.current).toBe(false);
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp' })));
    expect(result.current).toBe(true);
    rerender({ on: false });
    const off = renderHook(() => useEarlyPress('runup', false));
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })));
    expect(off.result.current).toBe(false);
  });

  it('says it once, plainly, with "try again"', () => {
    render(<TooSoonNote />);
    expect(screen.getByTestId('lesson-too-soon').textContent).toBe(
      `${en.tk('practice.lesson.too_soon')} ${en.tk('practice.lesson.try_again')}`,
    );
  });
});

describe('a press during "Watch first"', () => {
  it('gets one calm line in the demonstration panel, from a live region that was there from the start', () => {
    render(
      <IntroPanel onSkip={() => undefined} onSkipAll={() => undefined}>
        <WatchNote />
      </IntroPanel>,
    );
    const note = screen.getByTestId('lesson-watch-note');
    expect(note.getAttribute('aria-live')).toBe('polite');
    expect(note.textContent).toBe('');
    const surface = document.createElement('div');
    surface.setAttribute('role', 'application');
    document.body.append(surface);
    act(() => void surface.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(note.textContent).toBe(en.tk('practice.lesson.note.watch'));
    // The panel keeps its two ways past the demonstration.
    expect(screen.getByTestId('practice-intro-skip')).toBeTruthy();
    expect(screen.getByTestId('practice-intro-skip-all')).toBeTruthy();
    surface.remove();
  });

  it('a press on a button, or a key that plays no shot, says nothing', () => {
    render(<WatchNote />);
    const button = document.createElement('button');
    document.body.append(button);
    act(() => void button.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab' })));
    expect(screen.getByTestId('lesson-watch-note').textContent).toBe('');
    button.remove();
  });
});
