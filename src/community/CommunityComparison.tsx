import { useEffect } from 'react';
import type { DailyId, RepublicOutcome, ScoreBand } from '@/engine/types';
import { OUTCOME_LABELS } from '@/engine/types';
import { SIMPLE_OUTCOMES, useSimple } from '@/app/simple';
import { STRATEGY_LABELS, type StrategyClass } from '@/share/fingerprint';
import { scoreBandOf } from '@/share/dailyCard';
import { useCommunity } from './store';
import { isCommunityActive } from './client';
import styles from './CommunityComparison.module.css';

const BANDS: ScoreBand[] = ['0-39', '40-54', '55-69', '70-84', '85-100'];

export interface CommunityComparisonProps {
  dailyId: DailyId;
  /** The player's own official score, to highlight their band. */
  mine?: number;
  contentVersion?: string;
  className?: string;
}

function asOfLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Real, anonymous community results for a day. Shows nothing invented: below the cohort threshold it says so,
 * offline it says so, and when the feature is not configured it renders nothing.
 */
export function CommunityComparison({ dailyId, mine, contentVersion, className }: CommunityComparisonProps) {
  const simple = useSimple();
  const entry = useCommunity((s) => s.entries[dailyId]);
  const load = useCommunity((s) => s.load);
  const active = isCommunityActive();

  useEffect(() => {
    if (active) void load(dailyId, { contentVersion });
  }, [active, dailyId, contentVersion, load]);

  if (!active) return null;
  const root = [styles.root, className ?? ''].filter(Boolean).join(' ');
  const heading = simple ? 'How did everyone do?' : 'Community results';

  if (!entry || entry.status === 'loading') {
    return (
      <section className={root} data-testid="community-comparison" data-state="loading" aria-live="polite">
        <h2 className={styles.heading}>{heading}</h2>
        <p className={styles.muted}>{simple ? 'Checking…' : 'Checking community results…'}</p>
      </section>
    );
  }
  if (entry.status === 'offline' && !entry.stats) {
    return (
      <section className={root} data-testid="community-comparison" data-state="offline">
        <h2 className={styles.heading}>{heading}</h2>
        <p className={styles.muted}>{simple ? 'Needs internet to show.' : 'Community results need a connection.'}</p>
      </section>
    );
  }
  if (entry.status === 'error' && !entry.stats) {
    return (
      <section className={root} data-testid="community-comparison" data-state="error">
        <h2 className={styles.heading}>{heading}</h2>
        <p className={styles.muted}>{simple ? 'Not available right now.' : 'Community results are not available right now.'}</p>
      </section>
    );
  }
  const stats = entry.stats;
  if (!stats) return null;
  const stale = entry.fromCache ? ` · ${simple ? 'as of' : 'as of'} ${asOfLabel(stats.asOf)}` : '';
  if (!stats.ready || !stats.scoreBands) {
    return (
      <section className={root} data-testid="community-comparison" data-state="not-ready">
        <h2 className={styles.heading}>{heading}</h2>
        <p className={styles.strong}>{simple ? 'Not enough results yet' : 'Not enough results yet'}</p>
        <p className={styles.muted}>
          {stats.count} {simple ? 'so far' : stats.count === 1 ? 'official result so far' : 'official results so far'} · {simple ? `needs ${stats.minCohort}` : `shown from ${stats.minCohort}`}
          {stale}
        </p>
      </section>
    );
  }
  const myBand = mine !== undefined ? scoreBandOf(mine) : undefined;
  const max = Math.max(1, ...BANDS.map((b) => stats.scoreBands?.[b] ?? 0));
  const outcomes = Object.entries(stats.outcomes ?? {})
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, 3) as [RepublicOutcome, number][];
  const strategies = Object.entries(stats.strategyMix ?? {})
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, 2) as [StrategyClass, number][];
  return (
    <section className={root} data-testid="community-comparison" data-state="ready" aria-labelledby={`cc-${dailyId}`}>
      <h2 className={styles.heading} id={`cc-${dailyId}`}>
        {heading}
      </h2>
      <ul className={styles.bands} aria-label={simple ? 'Scores of everyone' : 'Score distribution'}>
        {BANDS.map((b) => {
          const pct = stats.scoreBands?.[b] ?? 0;
          return (
            <li key={b} className={styles.band} data-mine={myBand === b ? 'true' : undefined}>
              <span className={styles.bandLabel}>{b}</span>
              <span className={styles.bar} aria-hidden="true">
                <span className={styles.fill} style={{ width: `${Math.round((pct / max) * 100)}%` }} />
              </span>
              <span className={styles.pct}>
                {Math.round(pct)}%{myBand === b ? <span className={styles.you}> {simple ? '← you' : '← you'}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
      {outcomes.length > 0 ? (
        <p className={styles.line}>
          <span className={styles.label}>{simple ? 'Most common result' : 'Most common outcomes'}:</span>{' '}
          {outcomes.map(([o, pct]) => `${simple ? (SIMPLE_OUTCOMES[o]?.label ?? OUTCOME_LABELS[o]) : OUTCOME_LABELS[o]} ${Math.round(pct)}%`).join(' · ')}
        </p>
      ) : null}
      {strategies.length > 0 ? (
        <p className={styles.line}>
          <span className={styles.label}>{simple ? 'How people played' : 'Strategies'}:</span>{' '}
          {strategies.map(([k, pct]) => `${(STRATEGY_LABELS[k] ?? STRATEGY_LABELS.mixed)[simple ? 'simple' : 'full']} ${Math.round(pct)}%`).join(' · ')}
        </p>
      ) : null}
      <p className={styles.muted}>
        {stats.count} {simple ? 'real players' : 'official results'} · {simple ? 'anonymous' : 'anonymous, real submissions'}
        {stats.median !== undefined ? ` · ${simple ? 'middle score' : 'median'} ${Math.round(stats.median)}` : ''}
        {stale}
      </p>
    </section>
  );
}
