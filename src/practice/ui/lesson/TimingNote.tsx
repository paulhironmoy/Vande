/**
 * The dead ball's timing note for the first few balls: early or late and how much, in plain words, in proportion to the
 * error the physics measured (timing.ts), with the same three bands drawn as a scale when the physics' bands are known.
 * It sits inside the dead-ball card, so it never covers a delivery; it stays as long as the card does. Only a swing that
 * reached the ball's moment has a timing; a leave has none, and nothing is said.
 */
import type { TimingBands } from '@/contracts';
import { usePracticeT, type PracticeT } from '@/i18n/practice';
import { sys } from '../design';
import { timingNote, timingScale, type TimingNote as Note } from './timing';
import s from './Lesson.module.css';

function words(t: PracticeT, note: Note): string {
  return t.tk(`practice.lesson.timing.${note.key}`);
}

/** "38 ms early", "12 ms late" or "On time" (the same lines the coach's tip uses). */
export function timingNumber(t: PracticeT, note: Note): string {
  if (note.size === 'on_time' || !note.side) return t.t('practice.timing.on_time');
  return t.t(note.side === 'early' ? 'practice.timing.ms_early' : 'practice.timing.ms_late', { ms: note.ms });
}

function Scale({ note, bands }: { note: Note; bands: TimingBands }) {
  const sc = timingScale(note, bands);
  // 0 … 100 across, ideal in the middle, early on the left (earlier is to the left, like a clock).
  const x = (ms: number) => 50 + (ms / sc.halfMs) * 50;
  return (
    <svg
      className={s.scale}
      viewBox="0 0 100 12"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      data-testid="lesson-timing-scale"
      data-bands={`${sc.perfectMs},${sc.solidMs},${sc.edgeMs}`}
    >
      <rect className={s.zoneEdge} x={x(-sc.edgeMs)} y={3} width={x(sc.edgeMs) - x(-sc.edgeMs)} height={6} rx={2} />
      <rect className={s.zoneSolid} x={x(-sc.solidMs)} y={3} width={x(sc.solidMs) - x(-sc.solidMs)} height={6} rx={2} />
      <rect
        className={s.zonePerfect}
        x={x(-sc.perfectMs)}
        y={3}
        width={x(sc.perfectMs) - x(-sc.perfectMs)}
        height={6}
        rx={2}
      />
      <line className={s.tick} x1={50} x2={50} y1={1} y2={11} />
      <path className={s.marker} d={`M${50 + sc.at * 50} 6.4 l-3.2 5.2 h6.4 z`} />
    </svg>
  );
}

export interface TimingNoteProps {
  contact: Parameters<typeof timingNote>[0];
  /** The delivery's bands (the physics' activeBands for its assistance level and device allowance), when known. */
  bands?: TimingBands | null;
}

export function LessonTimingNote({ contact, bands }: TimingNoteProps) {
  const t = usePracticeT();
  const note = timingNote(contact, bands);
  if (!note) return null;
  return (
    <div
      className={s.timing}
      data-testid="lesson-timing"
      data-size={note.size}
      data-side={note.side ?? 'none'}
      data-ms={note.signedMs}
      data-physics={contact.timing}
    >
      <div className={s.timingHead}>
        <p className={`${s.timingLine} ${sys.body}`} data-testid="lesson-timing-line">
          {words(t, note)}
        </p>
        <p className={sys.caption} data-testid="lesson-timing-number">
          {timingNumber(t, note)}
        </p>
      </div>
      {bands && <Scale note={note} bands={bands} />}
      {note.size !== 'on_time' && note.side && (
        <p className={sys.caption} data-testid="lesson-timing-advice">
          {t.tk(note.side === 'early' ? 'practice.lesson.timing.try_later' : 'practice.lesson.timing.try_sooner')}
        </p>
      )}
    </div>
  );
}
