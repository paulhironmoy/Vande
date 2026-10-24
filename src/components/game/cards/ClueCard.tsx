import type { ConfidenceState } from '@/engine/types';
import { Button, Icon } from '@/components/ui';
import s from './ClueCard.module.css';

export interface ClueVerdict {
  state: ConfidenceState;
  label: string;
  note: string;
  gained: number;
}

export interface ClueCardProps {
  title: string;
  claim: string;
  source?: string;
  phase: 'idle' | 'scanning' | 'revealed';
  verdict?: ClueVerdict;
  bugAlert?: string | null;
  onScan: () => void;
  onSkip: () => void;
  onContinue: () => void;
}

const STAMP_TONE: Record<ConfidenceState, 'good' | 'bad' | 'neutral'> = {
  verified: 'good',
  corroborated: 'good',
  manipulated: 'bad',
  unverified: 'neutral',
  unknown: 'neutral',
};

/** A clue dossier you scan: a light sweeps the card, then a stamp lands with the verdict. */
export function ClueCard({ title, claim, source, phase, verdict, bugAlert, onScan, onSkip, onContinue }: ClueCardProps) {
  const tone = verdict ? STAMP_TONE[verdict.state] : undefined;
  return (
    <section className={s.card} data-phase={phase} data-tone={tone} aria-live="polite">
      {bugAlert ? (
        <p className={s.alert}>
          <Icon name="bug" size={16} /> {bugAlert}
        </p>
      ) : null}
      <header className={s.head}>
        <span className={s.badge} aria-hidden="true">
          <Icon name="document" size={22} strokeWidth={2.1} />
        </span>
        <span className={s.meta}>
          <span className={s.kicker}>{phase === 'revealed' ? 'Clue checked' : 'New clue'}</span>
          {source ? <span className={s.source}>{source}</span> : null}
        </span>
      </header>
      <h1 className={s.title}>{title}</h1>
      <p className={s.claim}>{claim}</p>

      {phase === 'scanning' ? (
        <span className={s.scan} aria-hidden="true">
          <span className={s.beam} />
        </span>
      ) : null}

      {phase === 'revealed' && verdict ? (
        <>
          <div className={s.stampWrap}>
            <span className={s.stamp} data-tone={tone} role="status">
              {verdict.state === 'manipulated' ? <Icon name="bug" size={22} strokeWidth={2.2} /> : tone === 'good' ? <Icon name="check" size={22} strokeWidth={2.6} /> : <Icon name="question" size={22} strokeWidth={2.2} />}
              {verdict.label}
            </span>
            {verdict.gained ? <span className={s.gain}>+{verdict.gained}</span> : null}
          </div>
          <p className={s.note}>{verdict.note}</p>
          <Button variant="primary" size="lg" block onClick={onContinue} data-testid="lite-next">
            Next
          </Button>
        </>
      ) : (
        <>
          <p className={s.hint}>Scan first: your next choice scores double. A fake clue is a bug worth +200.</p>
          <Button variant="primary" size="lg" block icon="eye" onClick={onScan} disabled={phase === 'scanning'} data-testid="lite-check">
            {phase === 'scanning' ? 'Scanning…' : 'Scan clue'}
          </Button>
          <Button variant="ghost" size="md" block onClick={onSkip} disabled={phase === 'scanning'} data-testid="lite-skip-clue">
            Skip
          </Button>
        </>
      )}
    </section>
  );
}
