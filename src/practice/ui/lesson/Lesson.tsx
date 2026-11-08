/**
 * The first-ball lesson card (before ball 1 only; src/practice/ui/lesson/machine.ts is its state). It teaches the move
 * the player's own input makes, with a ghost that loops and waits, and lets them try it on the real batting area: a dry
 * swing read by the same tracker and normalizer as a real one, but only to say back what it saw. No ball is bowled
 * until the player chooses to bowl; if they do nothing the ghost simply goes on; a move that is not a hit gets one plain
 * sentence, and costs nothing. It sits where the live ball cannot be: nothing here exists once the bowler runs in.
 *
 * It listens to the input in use (a mouse that moves, a pen, a key, a finger, the camera) and teaches that one.
 * Reduced Motion draws the move as a still. The words are real text, announced once through a polite live region.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { GestureInput, Handedness } from '@/contracts';
import { isShotKey, type OneGestureState } from '@/input';
import { useApp } from '@/app/store';
import { usePracticeT } from '@/i18n/practice';
import { PButton, sys } from '../design';
import { useKit } from '../context';
import { intentReadLine } from '../coaching';
import type { PracticeFlow } from '../flow/controller';
import { Ghost, Words } from './Ghost';
import { lessonCameraPort, lessonInputOfPointerType, subscribeLessonCamera, type LessonInput } from './inputType';
import { eventOfContact, eventOfSwing, type LessonState } from './machine';
import s from './Lesson.module.css';

export interface LessonProps {
  flow: PracticeFlow;
  lesson: LessonState;
  handedness: Handedness;
}

export default function Lesson({ flow, lesson, handedness }: LessonProps) {
  const t = usePracticeT();
  const { input: inputKit, engine } = useKit();
  const reducedMotion = useApp((st) => st.reducedMotion);
  const GestureSurface = inputKit.GestureSurface;
  const [attempt, setAttempt] = useState(0);
  /** A finger or mouse gesture was emitted (as soon as its first 40 ms were read, before the lift): arm again once it lifts. */
  const rearmOnRelease = useRef(false);
  const live = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const readLine = useRef<HTMLParagraphElement>(null);
  const noteLine = useRef<HTMLParagraphElement>(null);
  // Keyboard users land on the card's words (which scroll, so they take the focus), so the next Tab is its first button.
  useEffect(() => card.current?.focus({ preventScroll: true }), []);

  // Space and Enter are batting keys (a defence), and the batting surface cancels them so a shot never scrolls the page. On
  // one of the card's own buttons they must stay a click: this listener is registered first (a layout effect), so it sees
  // the key before the surface does and keeps it from the surface, leaving the button's own activation alone.
  useLayoutEffect(() => {
    const guard = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
      if (document.activeElement?.closest('[data-lesson-actions]')) e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', guard, true);
    return () => window.removeEventListener('keydown', guard, true);
  }, []);

  // The input in use decides what the card teaches: a mouse that moves, a pen over the glass, a key, a finger.
  useEffect(() => {
    const adopt = (input: LessonInput | null) => {
      if (input) flow.lessonEvent({ type: 'input', input });
    };
    const onPointer = (e: PointerEvent) => adopt(lessonInputOfPointerType(e.pointerType));
    const onKey = (e: KeyboardEvent) => {
      if (isShotKey(e.code)) adopt('keyboard');
    };
    const syncCamera = () => {
      const port = lessonCameraPort();
      if (!port?.active()) return;
      adopt('camera');
      flow.lessonEvent({ type: 'tracking', tracking: port.tracking() });
    };
    window.addEventListener('pointermove', onPointer, { capture: true, passive: true });
    window.addEventListener('pointerdown', onPointer, { capture: true, passive: true });
    window.addEventListener('keydown', onKey, { capture: true, passive: true });
    syncCamera();
    const off = subscribeLessonCamera(syncCamera);
    // The camera's own dry swing (its tracker and the same normalizer), when it can make one while the card is open.
    const offSwing = lessonCameraPort()?.onSwing?.((swing) => {
      const event = eventOfSwing(swing);
      if (event) flow.lessonEvent(event);
    });
    return () => {
      offSwing?.();
      window.removeEventListener('pointermove', onPointer, { capture: true });
      window.removeEventListener('pointerdown', onPointer, { capture: true });
      window.removeEventListener('keydown', onKey, { capture: true });
      off();
    };
  }, [flow]);

  const input = lesson.input;
  // The move in two steps (the keyboard has its two extras): COPY's lines for the input in use.
  const steps =
    input === 'keyboard'
      ? ['load', 'strike', 'defend', 'loft'].map((k) => t.tk(`practice.lesson.keyboard.${k}`))
      : [t.tk(`practice.lesson.${input}.load`), t.tk(`practice.lesson.${input}.strike`)];
  const read = lesson.read
    ? t.t('practice.read_as.you_played', { read: intentReadLine(t, lesson.read, engine.regionOf) })
    : null;
  const note = lesson.note ? t.tk(`practice.lesson.note.${lesson.note}`) : null;
  const tried = lesson.status === 'tried';
  const labels = {
    direction: t.tk('practice.lesson.sets.direction'),
    power: t.tk('practice.lesson.sets.power'),
    loft: t.tk('practice.lesson.sets.loft'),
  };
  const hints = {
    direction: t.tk('practice.lesson.sets.direction_hint'),
    power: t.tk('practice.lesson.sets.power_hint'),
    loft: t.tk('practice.lesson.sets.loft_hint'),
  };

  // One polite announcement: the whole lesson as text when it opens (and when the input changes), then each note or
  // read-back.
  const spoken =
    note ?? (read ? `${read} ${t.tk('practice.lesson.after')}` : t.tk(`practice.lesson.announce.${input}`));
  useEffect(() => {
    if (live.current) live.current.textContent = spoken;
  }, [spoken]);

  // The answer to a try comes below the steps. On a short screen at large text it can sit past the end of the words window, so after
  // every move (and when a note such as "the camera cannot see you" appears) the card scrolls just enough to show it: the note when
  // there is one, else the read-back. Nothing else moves.
  useEffect(() => {
    (noteLine.current ?? readLine.current)?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
  }, [lesson.acts, lesson.note]);

  // The next try needs the surface armed again, but not while the same stroke is still moving: re-armed under a finger that
  // is still down, the rest of one flick would read as a second swing. A key has no contact to wait for.
  useEffect(() => {
    const release = () => {
      if (!rearmOnRelease.current) return;
      rearmOnRelease.current = false;
      setAttempt((n) => n + 1);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, []);

  const onGesture = (g: GestureInput) => {
    if (g.pointer === 'keyboard') setAttempt((n) => n + 1);
    else rearmOnRelease.current = true;
    // Space or Enter on one of the card's own buttons is that button's click, not a defensive shot.
    if (g.pointer === 'keyboard' && !g.key && document.activeElement?.closest('[data-lesson-actions]')) return;
    const swing = engine.normalizeGesture(g, { releasePerfMs: 0, calibrationMs: 0, handedness });
    const event = eventOfSwing(swing);
    if (event) flow.lessonEvent(event);
  };
  const onContact = (state: OneGestureState) => {
    const event = eventOfContact(state);
    if (!event) return;
    // A pull-back let go is a deliberate leave: the tracker is then spent, so the next try needs it armed again.
    setAttempt((n) => n + 1);
    flow.lessonEvent(event);
  };

  return (
    <section
      className={s.root}
      role="region"
      aria-labelledby="lesson-title"
      aria-describedby="lesson-do lesson-try"
      data-testid="lesson"
      data-input={input}
      data-status={lesson.status}
      data-tries={lesson.tries}
    >
      <GestureSurface
        enabled
        deliveryKey={attempt}
        onGesture={onGesture}
        onContactState={onContact}
        handedness={handedness}
        label={t.t('practice.live.gesture_label')}
        className={s.surface}
      >
        <div className={s.ghostWrap}>
          <div className={s.plate}>
            <Ghost
              input={input}
              handedness={handedness}
              play={!reducedMotion}
              label={t.tk(`practice.lesson.ghost.${input}`)}
            />
            <Words labels={labels} hints={hints} input={input} play={!reducedMotion} />
          </div>
        </div>
      </GestureSurface>

      <div className={s.card} data-testid="lesson-card">
        <div ref={card} className={s.cardBody} data-testid="lesson-card-body" tabIndex={0}>
          <h2 id="lesson-title" className={sys.section}>
            {t.tk('practice.lesson.title')}
          </h2>
          <ol id="lesson-do" className={s.steps} data-testid="lesson-do">
            {steps.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
          <p id="lesson-try" className={sys.caption} data-testid="lesson-try">
            {tried ? t.tk('practice.lesson.after') : t.tk('practice.lesson.try')}
          </p>
          {read && (
            <p ref={readLine} className={s.read} data-testid="lesson-read">
              {read}
            </p>
          )}
          {note && (
            <p ref={noteLine} className={s.note} data-testid="lesson-note">
              {note}
            </p>
          )}
          {!read && !note && (
            <p className={sys.caption} data-testid="lesson-wait">
              {t.tk('practice.lesson.idle')}
            </p>
          )}
        </div>
        <div className={s.actions} data-lesson-actions="">
          <PButton
            variant={tried ? 'primary' : 'secondary'}
            onClick={() => flow.lessonEvent({ type: 'bowl' })}
            data-testid="lesson-bowl"
          >
            {t.tk('practice.lesson.bowl')}
          </PButton>
          <PButton variant="quiet" onClick={() => flow.skipTeaching(true)} data-testid="lesson-skip-all">
            {t.t('practice.intro.skip_all')}
          </PButton>
        </div>
      </div>
      <div ref={live} className="sr-only" aria-live="polite" aria-atomic="true" data-testid="lesson-announce" />
    </section>
  );
}
