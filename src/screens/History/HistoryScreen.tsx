import { useEffect, useMemo, useState } from 'react';
import type { HistoryEntry } from '@/engine/types';
import { OUTCOME_LABELS } from '@/engine/types';
import { getScenario } from '@/engine';
import { Button, ScreenShell, useApp } from '@/components/results/deps';
import layout from '@/components/results/layout.module.css';
import { ResultsSheet } from '@/components/results/ResultsSheet';
import { ScoreDisplay } from '@/components/results/ScoreDisplay';
import { DimensionBreakdown } from '@/components/results/DimensionBreakdown';
import { Checklist } from '@/components/results/Checklist';
import { ChevronIcon, ReplayIcon } from '@/components/results/icons';
import { formatDateTime, scoreBand } from '@/components/results/format';
import { KeyDecisionCard } from '@/components/results/KeyDecisionCard';
import styles from './HistoryScreen.module.css';

type Filter = 'all' | HistoryEntry['kind'];

const KIND_LABEL: Record<HistoryEntry['kind'], string> = {
  campaign: 'Campaign',
  daily: 'Daily',
  challenge: 'Challenge',
  chapter: 'Chapter',
};

const TONE: Record<ReturnType<typeof scoreBand>, string> = {
  strong: 'var(--o-safety)',
  steady: 'var(--c-electric)',
  strained: 'var(--a-saffron)',
  critical: 'var(--o-danger)',
};

function EntryDetail({ entry, onReplay }: { entry: HistoryEntry; onReplay?: (code: string) => void }) {
  const code = entry.challengeCode ?? entry.campaign?.challengeCode;
  const scores = entry.campaign?.finalScores ?? entry.chapter?.scores;
  return (
    <div className={styles.detail}>
      <div className={styles.detailHead}>
        <ScoreDisplay score={entry.score} label={entry.campaign ? 'Republic' : 'Chapter'} size="6.5rem" animated={false} />
        <div>
          <h3 className={styles.detailTitle}>{entry.outcome ? OUTCOME_LABELS[entry.outcome] : entry.title}</h3>
          <p className={layout.muted}>
            {KIND_LABEL[entry.kind]} · {formatDateTime(entry.completedAt)}
          </p>
        </div>
      </div>

      {scores && (
        <section aria-label="Six dimensions">
          <DimensionBreakdown scores={scores} startScores={entry.chapter?.startScores} animated={false} />
        </section>
      )}

      {entry.campaign?.chapters && entry.campaign.chapters.length > 0 && (
        <section>
          <h4 className={layout.sectionTitle}>Chapters</h4>
          <Checklist
            items={entry.campaign.chapters.map((c) => {
              let title = `Chapter ${c.chapter}`;
              try {
                title = getScenario(c.scenarioId).title;
              } catch {
                /* fallback */
              }
              return { id: c.scenarioId, kind: c.score >= 55 ? 'resolved' : 'unresolved', text: <strong>{title}</strong>, meta: `Chapter score ${Math.round(c.score)}` };
            })}
            emptyText=""
          />
        </section>
      )}

      {entry.campaign?.mostConsequential && <KeyDecisionCard decision={entry.campaign.mostConsequential} heading="Most consequential decision" />}
      {entry.chapter?.keyDecision && <KeyDecisionCard decision={entry.chapter.keyDecision} heading="Most consequential decision" />}

      {entry.chapter && (
        <div className={layout.grid2}>
          <section>
            <h4 className={layout.sectionTitle}>Resolved</h4>
            <Checklist items={entry.chapter.resolved.map((t, i) => ({ id: `r${i}`, kind: 'resolved', text: t }))} emptyText="Nothing fully resolved." />
          </section>
          <section>
            <h4 className={layout.sectionTitle}>Unresolved</h4>
            <Checklist items={entry.chapter.unresolved.map((t, i) => ({ id: `u${i}`, kind: 'unresolved', text: t }))} emptyText="Nothing left open." />
          </section>
        </div>
      )}

      {(entry.campaign?.missedEvidence?.length ?? entry.chapter?.missedEvidence?.length ?? 0) > 0 && (
        <section>
          <h4 className={layout.sectionTitle}>Missed evidence</h4>
          <Checklist
            items={(entry.campaign?.missedEvidence ?? entry.chapter?.missedEvidence ?? []).map((m, i) => ({ id: `${m.id}-${i}`, kind: 'missed', text: <strong>{m.title}</strong>, meta: m.note }))}
            emptyText=""
          />
        </section>
      )}

      {code && onReplay && (
        <div className={layout.row}>
          <Button variant="primary" onClick={() => onReplay(code)}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <ReplayIcon size={18} />
              Replay this crisis
            </span>
          </Button>
          <span className={layout.muted}>Code {code}</span>
        </div>
      )}
    </div>
  );
}

export function HistoryScreen() {
  const screen = useApp((s) => s.screen);
  const history = useApp((s) => s.history);
  const back = useApp((s) => s.back);
  const navigate = useApp((s) => s.navigate);
  const beginChallenge = useApp((s) => s.beginChallenge);
  const toast = useApp((s) => s.toast);
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | undefined>(screen.name === 'history' ? screen.entryId : undefined);

  useEffect(() => {
    if (screen.name === 'history' && screen.entryId) setOpenId(screen.entryId);
  }, [screen]);

  const entries = useMemo(
    () => [...history].filter((h) => filter === 'all' || h.kind === filter).sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1)),
    [history, filter],
  );
  const open = openId ? history.find((h) => h.id === openId) : undefined;

  const replay = (code: string) => {
    setOpenId(undefined);
    const ok = beginChallenge(code);
    if (!ok) toast({ text: 'This crisis could not be replayed.', kind: 'warning', duration: 2800 });
  };

  const kinds: Filter[] = ['all', 'campaign', 'daily', 'challenge', 'chapter'];

  return (
    <ScreenShell title="Earlier crises" onBack={() => back()} testId="history-screen">
      <div className={`${layout.page} ${layout.narrow}`}>
        <header className={layout.stack}>
          <h1 className={layout.h1}>Earlier crises</h1>
          <p className={layout.lead}>Every result stored on this device. Open one to review what happened or replay it with the same seed.</p>
        </header>

        {history.length > 0 && (
          <div className={styles.filters} role="group" aria-label="Filter by kind">
            {kinds.map((k) => (
              <button key={k} type="button" className={styles.filter} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {k === 'all' ? 'All' : KIND_LABEL[k]}
              </button>
            ))}
          </div>
        )}

        {entries.length === 0 ? (
          <div className={`${layout.card} ${layout.emptyState}`}>
            <h2 className={layout.h2}>{history.length === 0 ? 'No crises recorded yet' : 'Nothing matches this filter'}</h2>
            <p className={layout.body}>{history.length === 0 ? 'Finish a chapter, a daily crisis or a campaign and it will be listed here.' : 'Try another filter.'}</p>
            {history.length === 0 && (
              <Button variant="primary" onClick={() => navigate({ name: 'home' })}>
                Go home
              </Button>
            )}
          </div>
        ) : (
          <ul className={styles.list}>
            {entries.map((h) => (
              <li key={h.id}>
                <button type="button" className={styles.entry} onClick={() => setOpenId(h.id)} data-testid={`history-entry-${h.id}`} style={{ ['--tone' as string]: TONE[scoreBand(h.score)] }}>
                  <span className={styles.score} aria-label={`Score ${Math.round(h.score)}`}>
                    {Math.round(h.score)}
                  </span>
                  <span className={styles.text}>
                    <span className={styles.title}>{h.outcome ? OUTCOME_LABELS[h.outcome] : h.title}</span>
                    <span className={styles.meta}>
                      <span className={styles.kind}>{KIND_LABEL[h.kind]}</span>
                      {h.outcome ? h.title : ''} {h.outcome ? '· ' : ''}
                      {formatDateTime(h.completedAt)}
                    </span>
                  </span>
                  <ChevronIcon size={18} className={styles.chev} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ResultsSheet open={!!open} onClose={() => setOpenId(undefined)} title={open?.title ?? 'Crisis'} testId="history-detail">
        {open && <EntryDetail entry={open} onReplay={replay} />}
      </ResultsSheet>
    </ScreenShell>
  );
}
