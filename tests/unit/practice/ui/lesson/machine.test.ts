/** The first-ball lesson's state machine: it waits, it reads back, it never penalises, and it ends only by choice. */
import { describe, expect, it } from 'vitest';
import type { OneGestureState } from '@/input';
import { eventOfContact, eventOfSwing, isLessonOver, lessonReducer, startLesson } from '@/practice/ui/lesson/machine';

const hit = { kind: 'attack' as const, directionDeg: 12, power: 0.7, elevation: 0 };

describe('the lesson waits', () => {
  it('starts waiting on the input it was given and stays so with no events at all', () => {
    const s = startLesson('mouse');
    expect(s).toMatchObject({ status: 'waiting', input: 'mouse', note: null, read: null, tries: 0, cameraLost: false });
    expect(s).toMatchObject({ acts: 0, shownAtPerfMs: 0 });
    expect(startLesson('touch', 1234.5).shownAtPerfMs).toBe(1234.5);
    expect(isLessonOver(s)).toBe(false);
  });

  it('a dry hit is read back and counted, and the card then offers the ball as the next step', () => {
    let s = startLesson('touch');
    s = lessonReducer(s, { type: 'hit', read: hit });
    expect(s).toMatchObject({ status: 'tried', tries: 1, read: hit, note: null });
    s = lessonReducer(s, { type: 'hit', read: { ...hit, directionDeg: -20 } });
    expect(s).toMatchObject({ status: 'tried', tries: 2, read: { directionDeg: -20 } });
  });
});

describe('acting at the wrong moment: one plain note, no cost, the card stays', () => {
  it('a tap is a defence, said as such; a pull-back let go says to flick; Space is the keyboard defence', () => {
    expect(lessonReducer(startLesson('touch'), { type: 'block' })).toMatchObject({ status: 'waiting', note: 'tap' });
    expect(lessonReducer(startLesson('pen'), { type: 'block' })).toMatchObject({ note: 'tap' });
    expect(lessonReducer(startLesson('keyboard'), { type: 'block' })).toMatchObject({ note: 'key_defend' });
    expect(lessonReducer(startLesson('mouse'), { type: 'pulled' })).toMatchObject({ status: 'waiting', note: 'pull' });
  });

  it('counts every move made on the card (hits and wrong-moment moves), for the test hooks', () => {
    let s = startLesson('touch');
    s = lessonReducer(s, { type: 'block' });
    s = lessonReducer(s, { type: 'pulled' });
    s = lessonReducer(s, { type: 'hit', read: hit });
    expect(s).toMatchObject({ acts: 3, tries: 1 });
    // Choosing another input, or the camera losing the player, is not a move.
    s = lessonReducer(s, { type: 'input', input: 'mouse' });
    expect(s.acts).toBe(3);
  });

  it('a note does not undo a try, and the next hit clears it', () => {
    let s = lessonReducer(startLesson('touch'), { type: 'hit', read: hit });
    s = lessonReducer(s, { type: 'block' });
    expect(s).toMatchObject({ status: 'tried', tries: 1, note: 'tap', read: hit });
    s = lessonReducer(s, { type: 'hit', read: hit });
    expect(s).toMatchObject({ note: null, tries: 2 });
  });

  it('there is no timer and no penalty in the machine: an unrelated "input" event of the same kind is the identity', () => {
    const s = startLesson('touch');
    expect(lessonReducer(s, { type: 'input', input: 'touch' })).toBe(s);
    expect(lessonReducer(s, { type: 'tracking', tracking: false })).toBe(s);
  });
});

describe('the card follows the input in use', () => {
  it('another input re-teaches that input and drops a note about the old one', () => {
    let s = lessonReducer(startLesson('touch'), { type: 'block' });
    expect(s.note).toBe('tap');
    s = lessonReducer(s, { type: 'input', input: 'keyboard' });
    expect(s).toMatchObject({ input: 'keyboard', note: null, status: 'waiting' });
  });

  it('camera tracking lost shows the camera note and keeps the card waiting; found clears it', () => {
    let s = startLesson('camera');
    s = lessonReducer(s, { type: 'tracking', tracking: false });
    expect(s).toMatchObject({ status: 'waiting', cameraLost: true, note: 'camera' });
    s = lessonReducer(s, { type: 'tracking', tracking: true });
    expect(s).toMatchObject({ cameraLost: false, note: null });
  });
});

describe('the lesson ends only by choice', () => {
  it('"Bowl the first ball" ends it as bowl; "Skip all teaching" ends it as skipped; nothing moves it afterwards', () => {
    const bowl = lessonReducer(lessonReducer(startLesson('touch'), { type: 'hit', read: hit }), { type: 'bowl' });
    expect(bowl.status).toBe('bowl');
    expect(isLessonOver(bowl)).toBe(true);
    expect(lessonReducer(bowl, { type: 'skipAll' })).toBe(bowl);
    expect(lessonReducer(bowl, { type: 'hit', read: hit })).toBe(bowl);
    const skipped = lessonReducer(startLesson('mouse'), { type: 'skipAll' });
    expect(skipped.status).toBe('skipped');
    expect(isLessonOver(skipped)).toBe(true);
  });

  it('the bowl is allowed with no try at all (the try-out is optional)', () => {
    expect(lessonReducer(startLesson('touch'), { type: 'bowl' }).status).toBe('bowl');
  });
});

describe('what the surface reports becomes events', () => {
  it('an attack is a hit, a defence a block, a leave nothing', () => {
    expect(eventOfSwing({ ...hit })).toEqual({ type: 'hit', read: hit });
    expect(eventOfSwing({ kind: 'defend', directionDeg: 0, power: 0.2, elevation: 0 })).toEqual({ type: 'block' });
    expect(eventOfSwing(null)).toBeNull();
  });

  it('only a pull-back let go without a flick is "pulled"', () => {
    const phase = (p: OneGestureState['phase']) => eventOfContact({ phase: p });
    expect(phase('intentional_leave')).toEqual({ type: 'pulled' });
    for (const p of ['ready', 'waiting', 'loading', 'tracking', 'committing', 'released', 'cancelled'] as const)
      expect(phase(p)).toBeNull();
  });
});
