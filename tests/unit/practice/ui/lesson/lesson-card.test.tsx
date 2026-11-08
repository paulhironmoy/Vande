/**
 * The lesson card: the input in use decides what it teaches; the ghost loops (or stands still under Reduced Motion);
 * a dry swing is read by the real normalizer and only reported; the card announces itself as text; nothing here
 * starts a ball except the player's "Bowl the first ball".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { useApp } from '@/app/store';
import type { GestureInput, Handedness } from '@/contracts';
import { createPracticeT } from '@/i18n/practice';
import { normalizeGesture, traceGesture, type OneGestureState } from '@/input';
import { regionOf } from '@/physics';
import { PracticeKitContext, type PracticeKit } from '@/practice/ui/context';
import type { PracticeFlow } from '@/practice/ui/flow/controller';
import type { GestureSurfaceProps } from '@/practice/ui/flow/types';
import { teachingSamples } from '@/practice/ui/lesson/ghostMove';
import { setLessonCameraPort, type LessonInput } from '@/practice/ui/lesson/inputType';
import Lesson from '@/practice/ui/lesson/Lesson';
import { lessonReducer, startLesson, type LessonEvent, type LessonState } from '@/practice/ui/lesson/machine';

const en = createPracticeT('en', null);
let surface: GestureSurfaceProps | null = null;
const Probe: ComponentType<GestureSurfaceProps> = (props) => {
  surface = props;
  return <div data-testid="surface-probe">{props.children}</div>;
};
const kit = { engine: { normalizeGesture, regionOf }, input: { GestureSurface: Probe } } as unknown as PracticeKit;

function mount(lesson: LessonState, hand: Handedness = 'right') {
  const events: LessonEvent[] = [];
  const skipTeaching = vi.fn();
  const flow = { lessonEvent: (e: LessonEvent) => events.push(e), skipTeaching } as unknown as PracticeFlow;
  const view = render(
    <PracticeKitContext.Provider value={kit}>
      <Lesson flow={flow} lesson={lesson} handedness={hand} />
    </PracticeKitContext.Provider>,
  );
  return { events, skipTeaching, flow, view };
}

beforeEach(() => {
  surface = null;
  useApp.setState({ reducedMotion: false });
});
afterEach(() => {
  cleanup();
  setLessonCameraPort(null);
  useApp.setState({ reducedMotion: false });
});

const INPUTS: LessonInput[] = ['touch', 'mouse', 'pen', 'keyboard', 'camera'];

describe('what the card teaches', () => {
  for (const input of INPUTS)
    it(`${input}: the title, its steps, the three words and the way out, as text`, () => {
      mount(startLesson(input));
      const card = screen.getByTestId('lesson');
      expect(card.dataset.input).toBe(input);
      expect(screen.getByText(en.tk('practice.lesson.title'))).toBeTruthy();
      const keys = input === 'keyboard' ? ['load', 'strike', 'defend', 'loft'] : ['load', 'strike'];
      const steps = Array.from(screen.getByTestId('lesson-do').querySelectorAll('li')).map((li) => li.textContent);
      expect(steps).toEqual(keys.map((k) => en.tk(`practice.lesson.${input}.${k}`)));
      // At most three short words; the keyboard has no power word (its power is fixed).
      const words = Array.from(screen.getByTestId('lesson-words').querySelectorAll('li')).map((li) => li.dataset.word);
      expect(words).toEqual(input === 'keyboard' ? ['loft', 'direction'] : ['loft', 'power', 'direction']);
      expect(screen.getByTestId('lesson-ghost').dataset.ghost).toBe(input);
      expect(screen.getByTestId('lesson-bowl').textContent).toBe(en.tk('practice.lesson.bowl'));
      expect(screen.getByTestId('lesson-skip-all').textContent).toBe(en.t('practice.intro.skip_all'));
      expect(screen.getByTestId('lesson-wait').textContent).toBe(en.tk('practice.lesson.idle'));
    });

  it('announces the whole lesson as text through one polite live region', () => {
    mount(startLesson('mouse'));
    const live = screen.getByTestId('lesson-announce');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toBe(en.tk('practice.lesson.announce.mouse'));
  });

  it('is a labelled region whose batting area carries the same accessible name as the live one', () => {
    mount(startLesson('touch'));
    const region = screen.getByRole('region', { name: en.tk('practice.lesson.title') });
    expect(region).toBeTruthy();
    expect(surface?.label).toBe(en.t('practice.live.gesture_label'));
    expect(surface?.enabled).toBe(true);
  });
});

describe('Reduced Motion draws the move as a still, and says so', () => {
  it('loops by default, decoration only', () => {
    mount(startLesson('touch'));
    const ghost = screen.getByTestId('lesson-ghost');
    expect(ghost.dataset.motion).toBe('loop');
    expect(ghost.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('is a still picture with a description, its two steps numbered', () => {
    useApp.setState({ reducedMotion: true });
    mount(startLesson('touch'));
    const ghost = screen.getByTestId('lesson-ghost');
    expect(ghost.dataset.motion).toBe('still');
    // The two steps are numbered on the lines (the same 1 and 2 as the words), and the three points are plain dots.
    expect(Array.from(ghost.querySelectorAll('text')).map((t) => t.textContent)).toEqual(['1', '2']);
    expect(ghost.querySelectorAll('circle')).toHaveLength(5);
    const labelled = screen.getByRole('img', { name: en.tk('practice.lesson.ghost.touch') });
    expect(labelled).toBeTruthy();
  });
});

describe('a dry swing is read by the real normalizer and only reported', () => {
  const swingOf = (hand: Handedness): GestureInput => {
    const size = { width: 915, height: 190 };
    return traceGesture({
      surface: size,
      samples: teachingSamples({ surface: size, handedness: hand }),
      handedness: hand,
    }).gesture!;
  };

  it('the ghost’s own stroke is a hit (a firm drive to the off side); the surface is armed again once the finger lifts', () => {
    const { events } = mount(startLesson('touch'));
    const before = surface!.deliveryKey;
    act(() => surface!.onGesture(swingOf('right')));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'hit', read: { kind: 'attack' } });
    const read = (events[0] as Extract<LessonEvent, { type: 'hit' }>).read;
    expect(read.directionDeg).toBeGreaterThan(10);
    expect(read.directionDeg).toBeLessThan(14);
    // Emitted before the lift: arming it again now would read the rest of the same flick as a second swing.
    expect(surface!.deliveryKey).toBe(before);
    act(() => void window.dispatchEvent(new Event('pointerup')));
    expect(surface!.deliveryKey).not.toBe(before);
    // One lift re-arms once.
    const armed = surface!.deliveryKey;
    act(() => void window.dispatchEvent(new Event('pointerup')));
    expect(surface!.deliveryKey).toBe(armed);
  });

  it('a key has no contact to wait for: it is armed again at once', () => {
    mount(startLesson('keyboard'));
    const before = surface!.deliveryKey;
    const key: GestureInput = {
      pointer: 'keyboard',
      samples: [{ t: 5, x: 0, y: 0 }],
      surface: { width: 1, height: 1 },
      key: { kind: 'attack', screenBearingDeg: 0, loft: false },
    };
    act(() => surface!.onGesture(key));
    expect(surface!.deliveryKey).not.toBe(before);
  });

  it('a left-hander’s stroke is the same hit, to their off side', () => {
    const { events } = mount(startLesson('touch'), 'left');
    act(() => surface!.onGesture(swingOf('left')));
    const read = (events[0] as Extract<LessonEvent, { type: 'hit' }>).read;
    expect(read.directionDeg).toBeGreaterThan(10);
    expect(read.directionDeg).toBeLessThan(14);
  });

  it('a quick tap is a defence: a block, said plainly (the lesson state turns it into a note)', () => {
    const { events } = mount(startLesson('touch'));
    const tap = traceGesture({
      surface: { width: 915, height: 190 },
      samples: [
        { t: 1000, x: 400, y: 100 },
        { t: 1060, x: 400, y: 100 },
      ],
    }).gesture!;
    act(() => surface!.onGesture(tap));
    expect(events).toEqual([{ type: 'block' }]);
  });

  it('a pull-back let go without a flick is "pulled", and the surface is armed again (the tracker spends itself on a leave)', () => {
    const { events } = mount(startLesson('mouse'));
    const before = surface!.deliveryKey;
    act(() => surface!.onContactState?.({ phase: 'loading' } as OneGestureState));
    expect(surface!.deliveryKey).toBe(before);
    act(() => surface!.onContactState?.({ phase: 'intentional_leave' } as OneGestureState));
    expect(events).toEqual([{ type: 'pulled' }]);
    expect(surface!.deliveryKey).not.toBe(before);
  });

  it('Space or Enter on one of the card’s own buttons is that button’s click, not a defensive shot', () => {
    const { events } = mount(startLesson('keyboard'));
    screen.getByTestId('lesson-bowl').focus();
    const space: GestureInput = {
      pointer: 'keyboard',
      samples: [{ t: 5, x: 0, y: 0 }],
      surface: { width: 1, height: 1 },
    };
    act(() => surface!.onGesture(space));
    expect(events).toEqual([]);
    (document.activeElement as HTMLElement).blur();
    act(() => surface!.onGesture(space));
    expect(events).toEqual([{ type: 'block' }]);
  });

  it('Space and Enter on a card button reach nobody else (so the button can be pressed), anywhere else they do', () => {
    mount(startLesson('keyboard'));
    const heard = vi.fn();
    window.addEventListener('keydown', heard, true);
    try {
      const bowl = screen.getByTestId('lesson-bowl');
      bowl.focus();
      for (const code of ['Space', 'Enter']) {
        const e = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true });
        act(() => void bowl.dispatchEvent(e));
        // Not cancelled: the browser's own activation of the focused button goes ahead.
        expect(e.defaultPrevented).toBe(false);
      }
      expect(heard).not.toHaveBeenCalled();
      bowl.blur();
      act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })));
      expect(heard).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', heard, true);
    }
  });

  it('reads back what it saw in the dead ball’s own words, and then offers the ball', () => {
    const tried: LessonState = {
      ...startLesson('touch'),
      status: 'tried',
      tries: 1,
      read: { kind: 'attack', directionDeg: 12, power: 0.7, elevation: 0 },
    };
    mount(tried);
    expect(screen.getByTestId('lesson-read').textContent).toMatch(/^You played: /);
    expect(screen.getByTestId('lesson-try').textContent).toBe(en.tk('practice.lesson.after'));
  });

  it('shows one plain note for a move that is not a hit', () => {
    mount({ ...startLesson('touch'), note: 'tap' });
    expect(screen.getByTestId('lesson-note').textContent).toBe(en.tk('practice.lesson.note.tap'));
  });
});

describe('the way out', () => {
  it('"Bowl the first ball" asks the flow to bowl; "Skip all teaching" skips all teaching for good', () => {
    const { events, skipTeaching } = mount(startLesson('touch'));
    fireEvent.click(screen.getByTestId('lesson-bowl'));
    expect(events).toEqual([{ type: 'bowl' }]);
    fireEvent.click(screen.getByTestId('lesson-skip-all'));
    expect(skipTeaching).toHaveBeenCalledWith(true);
  });
});

describe('the card follows the input the player uses', () => {
  const pointerOf = (type: string, name: 'pointermove' | 'pointerdown' = 'pointermove') => {
    const e = new Event(name) as Event & { pointerType: string };
    e.pointerType = type;
    return e;
  };

  it('a moving mouse, a pen, a touch and an arrow key each re-teach their own input', () => {
    const { events } = mount(startLesson('touch'));
    act(() => void window.dispatchEvent(pointerOf('mouse')));
    act(() => void window.dispatchEvent(pointerOf('pen')));
    act(() => void window.dispatchEvent(pointerOf('touch', 'pointerdown')));
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp' })));
    expect(events.map((e) => (e.type === 'input' ? e.input : e.type))).toEqual(['mouse', 'pen', 'touch', 'keyboard']);
  });

  it('a key that plays no shot (Tab) does not switch to the keyboard card', () => {
    const { events } = mount(startLesson('touch'));
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab' })));
    expect(events).toEqual([]);
  });

  it('a chosen camera is taught as the camera; tracking lost is reported to the card', () => {
    setLessonCameraPort({ active: () => true, tracking: () => false, subscribe: () => () => {} });
    const { events } = mount(startLesson('touch'));
    expect(events).toEqual([
      { type: 'input', input: 'camera' },
      { type: 'tracking', tracking: false },
    ]);
  });
});

describe('the lesson is silent: no vibration, no sound (haptics are the touch swing’s, never the lesson’s)', () => {
  it('mounting, a dry hit, a tap, a pull-back, the input changing and "Bowl the first ball" never vibrate', () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    try {
      const { events } = mount(startLesson('touch'));
      const size = { width: 915, height: 190 };
      const hitGesture = traceGesture({ surface: size, samples: teachingSamples({ surface: size }) }).gesture!;
      act(() => surface!.onGesture(hitGesture));
      act(() => surface!.onContactState?.({ phase: 'intentional_leave' } as OneGestureState));
      const e = new Event('pointermove') as Event & { pointerType: string };
      e.pointerType = 'mouse';
      act(() => void window.dispatchEvent(e));
      fireEvent.click(screen.getByTestId('lesson-bowl'));
      expect(events.length).toBeGreaterThan(0);
      expect(vibrate).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(navigator, 'vibrate');
    }
  });

  it('the lesson’s source has no haptic or audio call at all', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(__dirname, '../../../../../src/practice/ui/lesson');
    for (const f of readdirSync(dir).filter((n) => /\.(ts|tsx)$/.test(n))) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/vibrate|haptic|AudioContext|@\/audio|new Audio\(/i);
    }
  });
});

describe('the answer to a try is scrolled into view (a short window at large text)', () => {
  const seenBy: Element[] = [];
  const scroll = vi.fn(function (this: Element, _arg?: unknown) {
    seenBy.push(this);
  });
  beforeEach(() => {
    seenBy.length = 0;
    scroll.mockClear();
    // jsdom has no scrollIntoView.
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scroll, configurable: true, writable: true });
  });
  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });

  it('scrolls nothing before a try, then the read-back after a hit, then the correction after a tap', () => {
    const { view } = mount(startLesson('touch'));
    expect(scroll).not.toHaveBeenCalled();
    const flow = { lessonEvent: () => undefined, skipTeaching: () => undefined } as unknown as PracticeFlow;
    const ui = (lesson: LessonState) => (
      <PracticeKitContext.Provider value={kit}>
        <Lesson flow={flow} lesson={lesson} handedness="right" />
      </PracticeKitContext.Provider>
    );
    const hit = lessonReducer(startLesson('touch'), {
      type: 'hit',
      read: { kind: 'attack', directionDeg: 12, power: 0.5, elevation: 0 },
    });
    view.rerender(ui(hit));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(seenBy[0]).toBe(screen.getByTestId('lesson-read'));
    expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest', behavior: 'auto' });
    view.rerender(ui(lessonReducer(hit, { type: 'block' })));
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(seenBy[1]).toBe(screen.getByTestId('lesson-note'));
  });
});
