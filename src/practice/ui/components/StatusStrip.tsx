/**
 * The quiet peripheral rail (constitution §4–5; the production brief's status strip). Left: the score, wickets,
 * over and ball, this over's balls, Practice or Coach, and captions for essential sounds. Right: one control that
 * names the conditions (pitch, ball, bowler style and pace, field preset, assistance) beside a compact radar and,
 * between balls, opens the complete setup; then pause. In Delivery Quiet Mode it dims, freezes and cannot be used;
 * while the ball is live (release to dead ball) it is not drawn at all, captions apart, because near contact the
 * pitch, the bat and the ball reach the corners. Both clusters stay in the top corners, clear of the bowler, the
 * release, the pitch, the ball path and the bat.
 */
import { useLayoutEffect, useRef } from 'react';
import type { AssistLevel, BowlerProfile, Difficulty, FieldIntent, FieldLayout, Handedness, PitchCondition } from '@/contracts';
import { usePracticeT } from '@/i18n/practice';
import { PIconButton, sys } from '../design';
import { useKit } from '../context';
import { bowlerStyle, markText, oversText, paceRangeText } from '../coaching';
import type { Board } from '../flow/state';
import { MiniRadar } from './MiniRadar';
import { Captions } from './Captions';
import s from './Live.module.css';

export interface StatusStripProps {
  board: Board;
  /** 'practice' for innings balls, a stage number for Coach Mode attempts. */
  status: { kind: 'practice' } | { kind: 'coach'; stage: number };
  ballNumber: number;
  field: FieldLayout | null;
  intent: FieldIntent | null;
  bowler: BowlerProfile | null;
  conditions: PitchCondition;
  ballLabel: string | null;
  assist: AssistLevel;
  /** The Random Over's difficulty (undefined for a fixed over; null when unknown, so no range is claimed). */
  difficulty: Difficulty | null | undefined;
  handedness: Handedness;
  quiet: boolean;
  /**
   * The ball is live (release to dead ball). The live layout: the rail steps out of the picture at once (no motion)
   * and returns at the dead ball; captions for essential sounds stay. Near contact the camera follows the ball to the
   * bat, so the pitch, the bat and the ball reach every corner of the frame (the measured protected regions at
   * 915×412: release/product-sequence/stage-1-practice/wedge/flow/), and nothing may cover them (constitution §3).
   */
  live?: boolean;
  /** Between balls: the last ball's length and line, or (a predefined over in order) the next ball. Never a random ball before release. */
  detail: string | null;
  /** Between balls only: opens the complete setup. */
  onBrief: (() => void) | null;
  onPause: (() => void) | null;
}

export function StatusStrip(p: StatusStripProps) {
  const t = usePracticeT();
  const { build } = useKit();
  const overs = oversText(p.board.balls);
  const score = t.t('practice.common.score', { runs: p.board.runs, wickets: p.board.wickets });
  const marks = Array.from({ length: 6 }, (_, i) => p.board.over[i] ?? null);
  const status = p.status.kind === 'coach' ? t.t('practice.status.coach', { stage: p.status.stage }) : t.t('practice.status.practice');
  const pitch = t.tk(`practice.pitch.${p.conditions}`);
  const style = p.bowler ? (p.difficulty === null ? bowlerStyle(t, p.bowler) : `${bowlerStyle(t, p.bowler)} · ${paceRangeText(t, build, p.bowler, p.difficulty)}`) : '';
  const preset = p.intent ? t.tk(`practice.intent.short.${p.intent.intention}`) : '';
  const rail = useRailBottom<HTMLDivElement>('--p-rail-bottom');
  const railLeft = useRailBottom<HTMLElement>('--p-rail-left-bottom');
  return (
    <>
      {/* Between balls the score cluster also opens the complete setup (a pointer convenience: the conditions button is
          the control for keyboards and screen readers). During a delivery it ignores the pointer, like the rest. */}
      <section
        ref={railLeft}
        className={s.stripLeft}
        data-quiet={p.quiet ? 'true' : 'false'}
        data-live={p.live ? 'true' : 'false'}
        data-tappable={p.onBrief ? 'true' : 'false'}
        onClick={p.onBrief ?? undefined}
        aria-label={t.t('practice.live.score_label', { runs: p.board.runs, wickets: p.board.wickets, overs })}
        data-testid="practice-status"
      >
        <div className={s.scoreLine}>
          <span className={s.score} data-testid="practice-score">
            {score}
          </span>
          <span className={s.overs}>{t.t('practice.common.overs', { overs })}</span>
        </div>
        <ol className={s.marks} aria-label={t.t('practice.live.ball_of', { n: Math.min(6, p.ballNumber) })}>
          {marks.map((m, i) => (
            <li key={i} className={s.mark} data-state={m ? (m.dismissal ? 'out' : m.runs >= 4 ? 'boundary' : 'done') : i === p.board.over.length ? 'current' : 'todo'}>
              {m ? markText(m) : ''}
            </li>
          ))}
        </ol>
        <span className={s.status} data-testid="practice-status-mode">
          {status}
        </span>
        <Captions />
      </section>
      <div className={s.stripRight} data-quiet={p.quiet ? 'true' : 'false'} data-live={p.live ? 'true' : 'false'} ref={rail}>
        {/* Its name is exactly the words it shows (label in name, WCAG 2.5.3); what it does is its description. */}
        <button type="button" className={s.conditions} onClick={p.onBrief ?? undefined} disabled={!p.onBrief} aria-describedby="practice-conditions-does" aria-haspopup="dialog" data-testid="practice-conditions">
          {p.field && <MiniRadar field={p.field} handedness={p.handedness} />}
          <span className={s.condText}>
            <span className={s.condMain}>
              {pitch}
              {p.ballLabel ? ` · ${p.ballLabel}` : ''}
            </span>
            <span className={s.condSub}>{style}</span>
            <span className={s.condSub}>
              {preset}
              {preset ? ' · ' : ''}
              {t.tk(`practice.settings.assist.${p.assist}`)}
            </span>
            {p.detail && !p.quiet && (
              <span className={s.condSub} data-testid="practice-status-detail">
                {p.detail}
              </span>
            )}
          </span>
          <span id="practice-conditions-does" className={sys.srOnly}>
            {t.t('practice.status.conditions_does')}
          </span>
        </button>
        <PIconButton icon="pause" label={t.t('practice.live.pause')} className={s.pause} onClick={p.onPause ?? undefined} disabled={!p.onPause} data-testid="practice-pause" />
      </div>
    </>
  );
}

/**
 * A corner of the rail's measured bottom edge, published on the play view (--p-rail-bottom for the right corner,
 * --p-rail-left-bottom for the left), so the dead ball's card always sits below the corner it is under, whatever the
 * text size or language makes its height.
 */
function useRailBottom<E extends HTMLElement>(name: string) {
  const ref = useRef<E>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.closest<HTMLElement>('[data-play-root]');
    if (!el || !host) return;
    const measure = () => host.style.setProperty(name, `${Math.ceil(el.getBoundingClientRect().bottom - host.getBoundingClientRect().top)}px`);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [name]);
  return ref;
}
