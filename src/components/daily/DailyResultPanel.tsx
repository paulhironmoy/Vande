import type { ReactNode } from 'react';
import type { DailyAttemptResult, DailyRecordV2, PassportAccomplishment, RepublicCondition } from '@/engine/types';
import { OUTCOME_LABELS } from '@/engine/types';
import { SIMPLE_OUTCOMES, starsFor, useSimple } from '@/app/simple';
import { Button, Icon } from '@/components/ui';
import { Stars } from '@/components/results/Stars';
import { ScoreDisplay } from '@/components/results/ScoreDisplay';
import layout from '@/components/results/layout.module.css';
import { accomplishmentById } from '@/progression/accomplishments';
import { republicChangeLine, strategicFeedback } from '@/progression/feedback';
import { dailyIdWords } from '@/progression/dailyTime';
import { FingerprintGlyphs } from './FingerprintGlyphs';
import { FingerprintStrip } from '@/share/FingerprintStrip';
import s from './DailyResultPanel.module.css';

export interface DailyResultPanelProps {
  dailyId: string;
  official: boolean;
  result: DailyAttemptResult;
  record: DailyRecordV2;
  stats?: { decisionsMade: number; decisionsExpired: number; falseAccusations: number; disproportionateActions: number; evidenceResolved: number; unverifiedActions: number };
  republicDelta?: Partial<RepublicCondition>;
  friend?: { score: number; fingerprint: string; outcome?: string };
  newAccomplishments: PassportAccomplishment[];
  reducedMotion?: boolean;
  onShare: () => void;
  onCalendar: () => void;
  onHome: () => void;
  /** Lets the share package replace the glyph row with its `FingerprintStrip`. */
  renderFingerprint?: (fingerprint: string) => ReactNode;
  /** Community comparison, supplied by the lead when the community package is wired. */
  community?: ReactNode;
}

/** The daily result at a glance: score, official/practice, one line of feedback, pattern, three buttons. */
export function DailyResultPanel({ dailyId, official, result, record, stats, republicDelta, friend, newAccomplishments, reducedMotion, onShare, onCalendar, onHome, renderFingerprint, community }: DailyResultPanelProps) {
  const simple = useSimple();
  const outcome = simple ? SIMPLE_OUTCOMES[result.outcome].label : OUTCOME_LABELS[result.outcome];
  const feedback = strategicFeedback(result.fingerprint, stats ? { scores: result.scores, stats: { ...stats, manipulationsDetected: 0, manipulationsSucceeded: 0, evidencePreserved: 0, evidenceDestroyed: 0, rightsCorrect: 0, rightsTotal: 0 } } : undefined, simple);
  const republicLine = republicChangeLine(republicDelta, simple);
  const officialScore = record.official?.score;
  const friendLine = friend
    ? friend.score > result.score
      ? simple
        ? `Your friend scored ${friend.score}. Try again?`
        : `Your friend scored ${friend.score}. Practice is open.`
      : friend.score === result.score
        ? simple
          ? `Same as your friend: ${friend.score}.`
          : `Level with your friend at ${friend.score}.`
        : simple
          ? `You beat your friend's ${friend.score}.`
          : `Ahead of your friend's ${friend.score}.`
    : null;

  return (
    <section className={s.panel} aria-labelledby="daily-result-heading" data-testid="daily-result">
      <p className={layout.kicker}>
        {dailyIdWords(dailyId)} · {simple ? "Today's crisis" : 'Daily crisis'}
      </p>
      <div className={s.hero}>
        <ScoreDisplay score={result.score} label={simple ? 'Your score' : 'Score'} size="9rem" testId="daily-score" animated={!reducedMotion} />
        <div className={s.heroText}>
          <span className={[s.badge, official ? s.badgeOfficial : s.badgePractice].join(' ')} data-testid={official ? 'daily-official-label' : 'daily-practice-label'}>
            <Icon name={official ? 'target' : 'refresh'} size={16} />
            {official ? (simple ? 'Official result' : 'Official result') : 'Practice'}
          </span>
          <h2 className={s.outcome} id="daily-result-heading" data-testid="final-outcome" data-outcome={result.outcome}>
            {outcome}
          </h2>
          {simple && <Stars count={starsFor(result.score)} size={30} />}
          {!official && officialScore !== undefined && (
            <p className={s.sub} data-testid="daily-official-kept">
              {simple ? `Official stays ${officialScore}.` : `Your official result stays ${officialScore}.`}
            </p>
          )}
        </div>
      </div>

      <ul className={s.lines}>
        <li className={s.line} data-testid="daily-feedback">
          <Icon name="sparkle" size={18} />
          <span>{feedback}</span>
        </li>
        {republicLine && (
          <li className={s.line} data-testid="daily-republic-change">
            <Icon name="building" size={18} />
            <span>{republicLine}</span>
          </li>
        )}
        {friendLine && (
          <li className={s.line} data-testid="daily-friend-compare">
            <Icon name="users" size={18} />
            <span>{friendLine}</span>
          </li>
        )}
      </ul>

      <div className={s.pattern}>
        <span className={s.patternLabel}>{simple ? 'Your pattern' : 'Your pattern'}</span>
        <FingerprintGlyphs fingerprint={result.fingerprint} render={renderFingerprint ?? ((fp) => <FingerprintStrip fingerprint={fp} score={result.score} />)} />
      </div>

      {newAccomplishments.length > 0 && (
        <ul className={s.awards} aria-label={simple ? 'New stamps' : 'New passport accomplishments'} data-testid="passport-new">
          {newAccomplishments.map((a) => {
            const def = accomplishmentById(a.id);
            if (!def) return null;
            return (
              <li key={a.id} className={s.award}>
                <Icon name={def.icon} size={20} />
                <span>
                  <strong>{simple ? def.simpleTitle : def.title}</strong>
                  <span className={s.awardWhy}>{a.reason}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {community}

      <div className={s.actions}>
        <Button variant="primary" size="lg" icon="share" onClick={onShare} data-testid="final-challenge">
          {simple ? 'Share my pattern' : 'Share'}
        </Button>
        <Button variant="secondary" size="lg" icon="history" onClick={onCalendar} data-testid="daily-calendar">
          Calendar
        </Button>
        <Button variant="ghost" size="lg" icon="home" onClick={onHome} data-testid="final-home">
          Home
        </Button>
      </div>
    </section>
  );
}
