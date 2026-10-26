/** The minimal scoreboard: score, overs, this over's balls (shaped badges), the bowler and the pitch. */
import { BallTimeline, type BallSlot } from '@/ui';
import type { BowlerProfile, PitchCondition } from '@/contracts';
import { usePracticeT } from '@/i18n/practice';
import { markOf, oversText } from '../coaching';
import type { FlowState } from '../flow/controller';
import s from './Hud.module.css';

export function bowlerText(t: ReturnType<typeof usePracticeT>, b: BowlerProfile): string {
  const style = b.family === 'pace' ? (b.paceBand ?? 'fast') : (b.spinType ?? 'finger');
  return t.t('practice.bowler.label', { arm: b.arm, style });
}

export interface ScoreboardProps {
  board: FlowState['board'];
  bowler: BowlerProfile | null;
  conditions: PitchCondition;
  /** Hide the over's balls (the warm-up and repeats are outside the innings). */
  outsideInnings?: string | null;
}

export function Scoreboard({ board, bowler, conditions, outsideInnings }: ScoreboardProps) {
  const t = usePracticeT();
  const overs = oversText(board.balls);
  const slots: BallSlot[] = Array.from({ length: 6 }, (_, i) => {
    const b = board.over[i];
    if (b) return { mark: markOf(b) };
    return { mark: { kind: i === board.over.length ? 'current' : 'upcoming' } };
  });
  return (
    <section className={s.board} aria-label={t.t('practice.live.score_label', { runs: board.runs, wickets: board.wickets, overs })} data-testid="practice-scoreboard">
      <div className={s.scoreLine}>
        <span className={s.score} data-testid="practice-score">
          {t.t('practice.common.score', { runs: board.runs, wickets: board.wickets })}
        </span>
        <span className={s.overs}>{t.t('practice.common.overs', { overs })}</span>
      </div>
      {outsideInnings ? <span className={s.context}>{outsideInnings}</span> : <BallTimeline slots={slots} size="sm" label={t.t('practice.live.ball_of', { n: Math.min(6, board.over.length + 1) })} />}
      {bowler && (
        <span className={s.context}>
          {bowlerText(t, bowler)} · {t.tk(`practice.pitch.${conditions}`)}
        </span>
      )}
    </section>
  );
}
